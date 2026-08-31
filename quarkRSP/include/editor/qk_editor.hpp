<<<<<<< HEAD
#pragma once
#include <string>
#include <cstring>
#include <cstdint>

#include "qk_jit_host.hpp"

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#else
#include <sys/socket.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <unistd.h>
#endif

namespace quarkrsp::editor
{

    // ─── 编译 / 执行结果 ────────────────────────────────────────────
    enum class CompileStatus
    {
        Success,
        EmptyBuffer,
        DaemonUnreachable,
        CompileError,
    };

    // ─── 编译后端选择 ───────────────────────────────────────────────
    enum class Backend
    {
        Daemon,
        Embedded,
    };

    struct CompileResult
    {
        CompileStatus status = CompileStatus::EmptyBuffer;
        std::string message;
        bool ok() const { return status == CompileStatus::Success; }
    };

    struct ExecuteResult
    {
        bool ok = false;
        std::string output;
        long long int_value = 0;
        double float_value = 0.0;
        std::string message;
    };

    // 超轻量 qk 脚本编辑器（内置）—— 支持两种编译后端：
    //   1) Daemon   连接 quark 守护进程（thin client）
    //   2) Embedded 进程内复用 runtime 的 JIT（qhal::JIT + QVM）
    class QkEditor
    {
    private:
        std::string buffer_;             // 当前持有的 qk 源码 / LLVM IR 文本
        std::string host_ = "127.0.0.1"; // daemon 地址
        int port_ = 50052;               // daemon 端口（与 runtime 的 DAEMON_PORT 一致）
        int timeout_ms_ = 8000;          // 收发超时
        std::string last_error_;

        Backend backend_ = Backend::Daemon; // 当前编译后端

        // ── RAII socket 封装 ────────────────────────────────────────
        struct Socket
        {
#ifdef _WIN32
            using Handle = SOCKET;
            static constexpr Handle kInvalid = INVALID_SOCKET;
            Handle fd = kInvalid;
#else
            using Handle = int;
            static constexpr Handle kInvalid = -1;
            Handle fd = kInvalid;
#endif
            Socket() = default;
            ~Socket() { close(); }
            Socket(const Socket &) = delete;
            Socket &operator=(const Socket &) = delete;

            void close()
            {
                if (fd == kInvalid)
                    return;
#ifdef _WIN32
                closesocket(fd);
#else
                ::close(fd);
#endif
                fd = kInvalid;
            }
        };

        // ── 一次「请求 + 响应」事务──
        bool transact(const std::string &request, std::string &response)
        {
            response.clear();
            last_error_.clear();

#ifdef _WIN32
            static bool wsa_ready = false;
            if (!wsa_ready)
            {
                WSADATA wsa;
                wsa_ready = (WSAStartup(MAKEWORD(2, 2), &wsa) == 0);
                if (!wsa_ready)
                {
                    last_error_ = "WSAStartup failed";
                    return false;
                }
            }
#endif

            Socket sock;
#ifdef _WIN32
            sock.fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
#else
            sock.fd = socket(AF_INET, SOCK_STREAM, 0);
#endif
            if (sock.fd == Socket::kInvalid)
            {
                last_error_ = "socket() failed";
                return false;
            }

            sockaddr_in addr{};
            addr.sin_family = AF_INET;
            addr.sin_port = htons(static_cast<uint16_t>(port_));
            inet_pton(AF_INET, host_.c_str(), &addr.sin_addr);

#ifdef _WIN32
            if (connect(sock.fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) != 0)
            {
                last_error_ = "daemon unreachable at " + host_ + ":" + std::to_string(port_);
                return false;
            }
            DWORD to = static_cast<DWORD>(timeout_ms_);
            setsockopt(sock.fd, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char *>(&to), sizeof(to));
            setsockopt(sock.fd, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char *>(&to), sizeof(to));
#else
            if (connect(sock.fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) != 0)
            {
                last_error_ = "daemon unreachable at " + host_ + ":" + std::to_string(port_);
                return false;
            }
            timeval tv{timeout_ms_ / 1000, (timeout_ms_ % 1000) * 1000};
            setsockopt(sock.fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
            setsockopt(sock.fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
#endif

            // 守护进程会读到 EXIT\n 就结束处理
            const std::string payload = request + "EXIT\n";
            const char *p = payload.data();
            size_t remaining = payload.size();
            while (remaining > 0)
            {
                int sent = static_cast<int>(send(sock.fd, p, static_cast<int>(remaining), 0));
                if (sent <= 0)
                {
                    last_error_ = "send() failed";
                    return false;
                }
                p += sent;
                remaining -= static_cast<size_t>(sent);
            }

            char buf[4096];
            int n;
            while ((n = recv(sock.fd, buf, sizeof(buf) - 1, 0)) > 0)
            {
                buf[n] = '\0';
                response += buf;
            }
            return true;
        }

        CompileResult send_compile(const std::string &header, const std::string &payload)
        {
            CompileResult r;
            if (payload.empty())
            {
                r.status = CompileStatus::EmptyBuffer;
                r.message = "Editor buffer is empty; nothing to compile.";
                return r;
            }

            std::string response;
            if (!transact(header + "\n" + payload + "\nEND_COMPILE\n", response))
            {
                r.status = CompileStatus::DaemonUnreachable;
                r.message = last_error_;
                return r;
            }

            if (response.find("SUCCESS") != std::string::npos)
            {
                r.status = CompileStatus::Success;
            }
            else
            {
                r.status = CompileStatus::CompileError;
            }
            r.message = response.empty() ? "No response from daemon." : response;
            return r;
        }

        // 内嵌后端编译（JitResult -> CompileResult）
        CompileResult embedded_compile(const std::string &payload)
        {
            CompileResult r;
            if (payload.empty())
            {
                r.status = CompileStatus::EmptyBuffer;
                r.message = "Editor buffer is empty; nothing to compile.";
                return r;
            }

            JitResult jr = embedded_jit_compile(payload);
            if (jr.ok)
            {
                r.status = CompileStatus::Success;
            }
            else
            {
                r.status = CompileStatus::CompileError;
            }
            r.message = jr.message;
            return r;
        }

        // 内嵌后端执行（JitResult -> ExecuteResult）
        ExecuteResult embedded_execute(const JitResult &jr)
        {
            ExecuteResult r;
            r.ok = jr.ok;
            r.int_value = jr.ret;
            r.float_value = jr.fret;
            r.message = jr.message;
            r.output = jr.message;
            return r;
        }

    public:
        // ── 缓冲区管理 ───────────────────────────────────────────────
        void set_text(const std::string &src) { buffer_ = src; }
        const std::string &text() const { return buffer_; }
        void clear() { buffer_.clear(); }
        bool empty() const { return buffer_.empty(); }
        size_t size() const { return buffer_.size(); }

        // ── 连接 / 后端配置 ──────────────────────────────────────────
        void set_daemon(const std::string &host, int port)
        {
            host_ = host;
            port_ = port;
        }
        void set_timeout(int ms) { timeout_ms_ = ms; }
        void set_backend(Backend b) { backend_ = b; }
        Backend backend() const { return backend_; }
        const std::string &last_error() const { return last_error_; }

        // ── 编译 ─────────────────────────────────────────────────────
        // 复用 runtime 的 JIT：按所选后端，把 buffer_（LLVM IR）交给
        // daemon 或内嵌 JIT 编译。
        // 说明：qk 源码 -> IR 的前端目前由 TS 语言服务器(server/src/ir.ts)完成，
        //       C++ 侧此处直接消费 IR。
        CompileResult compile()
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_compile(buffer_);
            }
            return send_compile("COMPILE", buffer_);
        }

        // 显式编译一段给定的 IR（不依赖 buffer_）。
        CompileResult compile_ir(const std::string &ir)
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_compile(ir);
            }
            return send_compile("COMPILE", ir);
        }

        // AOT 编译：AOT_COMPILE <arch> <mode> <filename>（仅 daemon 后端支持）
        CompileResult aot_compile(const std::string &arch,
                                  const std::string &mode,
                                  const std::string &filename)
        {
            if (backend_ == Backend::Embedded)
            {
                CompileResult r;
                r.status = CompileStatus::CompileError;
                r.message = "AOT compilation is only available with the daemon backend.";
                return r;
            }
            if (buffer_.empty())
            {
                CompileResult r;
                r.status = CompileStatus::EmptyBuffer;
                r.message = "Editor buffer is empty; nothing to compile.";
                return r;
            }
            return send_compile("AOT_COMPILE " + arch + " " + mode + " " + filename, buffer_);
        }

        // ── 执行 ─────────────────────────────────────────────────────
        ExecuteResult execute_int(const std::string &func = "quark_main")
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_execute(embedded_jit_execute_int(func));
            }

            ExecuteResult r;
            std::string response;
            if (!transact("EXECUTE int32 " + func + "\n", response))
            {
                r.message = last_error_;
                return r;
            }
            r.output = response;
            r.ok = response.find("SUCCESS") != std::string::npos;
            r.message = response;

            auto pos = response.find("(Returned: ");
            if (pos != std::string::npos)
            {
                r.int_value = std::stoll(response.substr(pos + 11));
            }
            return r;
        }

        ExecuteResult execute_float(const std::string &func)
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_execute(embedded_jit_execute_float(func));
            }

            ExecuteResult r;
            std::string response;
            if (!transact("EXECUTE float " + func + "\n", response))
            {
                r.message = last_error_;
                return r;
            }
            r.output = response;
            r.ok = response.find("SUCCESS") != std::string::npos;
            r.message = response;

            auto pos = response.find("(Returned: ");
            if (pos != std::string::npos)
            {
                r.float_value = std::stod(response.substr(pos + 11));
            }
            return r;
        }

        ExecuteResult execute_void(const std::string &func)
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_execute(embedded_jit_execute_void(func));
            }

            ExecuteResult r;
            std::string response;
            if (!transact("EXECUTE void " + func + "\n", response))
            {
                r.message = last_error_;
                return r;
            }
            r.output = response;
            r.ok = response.find("SUCCESS") != std::string::npos;
            r.message = response;
            return r;
        }

        // 编译 + 执行一步完成。
        ExecuteResult compile_and_run(const std::string &func = "quark_main")
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_execute(embedded_jit_compile_and_run(buffer_, func));
            }
            if (buffer_.empty())
            {
                ExecuteResult r;
                r.message = "Editor buffer is empty; nothing to run.";
                return r;
            }

            ExecuteResult r;
            std::string response;
            std::string req = "COMPILE\n" + buffer_ + "\nEND_COMPILE\n"
                                                      "EXECUTE int32 " +
                              func + "\n";
            if (!transact(req, response))
            {
                r.message = last_error_;
                return r;
            }
            r.output = response;
            r.ok = response.find("SUCCESS") != std::string::npos;
            r.message = response;

            auto pos = response.find("(Returned: ");
            if (pos != std::string::npos)
            {
                r.int_value = std::stoll(response.substr(pos + 11));
            }
            return r;
        }

        // ── 响应检查 / 状态 ──────────────────────────────────────────
        bool ping()
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_jit_available();
            }
            std::string response;
            if (!transact("PING\n", response))
                return false;
            return response.find("PONG") != std::string::npos;
        }

        std::string snapshot()
        {
            if (backend_ == Backend::Embedded)
            {
                last_error_ = "snapshot is only available with the daemon backend.";
                return "";
            }
            std::string response;
            if (!transact("GET_SNAPSHOT\n", response))
            {
                last_error_ = last_error_.empty() ? "snapshot failed" : last_error_;
                return "";
            }
            return response;
        }
    };
=======
#pragma once
#include <string>
#include <cstring>
#include <cstdint>

#include "qk_jit_host.hpp"

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#else
#include <sys/socket.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <unistd.h>
#endif

namespace quarkrsp::editor
{

    // ─── 编译 / 执行结果 ────────────────────────────────────────────
    enum class CompileStatus
    {
        Success,
        EmptyBuffer,
        DaemonUnreachable,
        CompileError,
    };

    // ─── 编译后端选择 ───────────────────────────────────────────────
    enum class Backend
    {
        Daemon,
        Embedded,
    };

    struct CompileResult
    {
        CompileStatus status = CompileStatus::EmptyBuffer;
        std::string message;
        bool ok() const { return status == CompileStatus::Success; }
    };

    struct ExecuteResult
    {
        bool ok = false;
        std::string output;
        long long int_value = 0;
        double float_value = 0.0;
        std::string message;
    };

    // 超轻量 qk 脚本编辑器（内置）—— 支持两种编译后端：
    //   1) Daemon   连接 quark 守护进程（thin client）
    //   2) Embedded 进程内复用 runtime 的 JIT（qhal::JIT + QVM）
    class QkEditor
    {
    private:
        std::string buffer_;             // 当前持有的 qk 源码 / LLVM IR 文本
        std::string host_ = "127.0.0.1"; // daemon 地址
        int port_ = 50052;               // daemon 端口（与 runtime 的 DAEMON_PORT 一致）
        int timeout_ms_ = 8000;          // 收发超时
        std::string last_error_;

        Backend backend_ = Backend::Daemon; // 当前编译后端

        // ── RAII socket 封装 ────────────────────────────────────────
        struct Socket
        {
#ifdef _WIN32
            using Handle = SOCKET;
            static constexpr Handle kInvalid = INVALID_SOCKET;
            Handle fd = kInvalid;
#else
            using Handle = int;
            static constexpr Handle kInvalid = -1;
            Handle fd = kInvalid;
#endif
            Socket() = default;
            ~Socket() { close(); }
            Socket(const Socket &) = delete;
            Socket &operator=(const Socket &) = delete;

            void close()
            {
                if (fd == kInvalid)
                    return;
#ifdef _WIN32
                closesocket(fd);
#else
                ::close(fd);
#endif
                fd = kInvalid;
            }
        };

        // ── 一次「请求 + 响应」事务──
        bool transact(const std::string &request, std::string &response)
        {
            response.clear();
            last_error_.clear();

#ifdef _WIN32
            static bool wsa_ready = false;
            if (!wsa_ready)
            {
                WSADATA wsa;
                wsa_ready = (WSAStartup(MAKEWORD(2, 2), &wsa) == 0);
                if (!wsa_ready)
                {
                    last_error_ = "WSAStartup failed";
                    return false;
                }
            }
#endif

            Socket sock;
#ifdef _WIN32
            sock.fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
#else
            sock.fd = socket(AF_INET, SOCK_STREAM, 0);
#endif
            if (sock.fd == Socket::kInvalid)
            {
                last_error_ = "socket() failed";
                return false;
            }

            sockaddr_in addr{};
            addr.sin_family = AF_INET;
            addr.sin_port = htons(static_cast<uint16_t>(port_));
            inet_pton(AF_INET, host_.c_str(), &addr.sin_addr);

#ifdef _WIN32
            if (connect(sock.fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) != 0)
            {
                last_error_ = "daemon unreachable at " + host_ + ":" + std::to_string(port_);
                return false;
            }
            DWORD to = static_cast<DWORD>(timeout_ms_);
            setsockopt(sock.fd, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char *>(&to), sizeof(to));
            setsockopt(sock.fd, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char *>(&to), sizeof(to));
#else
            if (connect(sock.fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) != 0)
            {
                last_error_ = "daemon unreachable at " + host_ + ":" + std::to_string(port_);
                return false;
            }
            timeval tv{timeout_ms_ / 1000, (timeout_ms_ % 1000) * 1000};
            setsockopt(sock.fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
            setsockopt(sock.fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
#endif

            // 守护进程会读到 EXIT\n 就结束处理
            const std::string payload = request + "EXIT\n";
            const char *p = payload.data();
            size_t remaining = payload.size();
            while (remaining > 0)
            {
                int sent = static_cast<int>(send(sock.fd, p, static_cast<int>(remaining), 0));
                if (sent <= 0)
                {
                    last_error_ = "send() failed";
                    return false;
                }
                p += sent;
                remaining -= static_cast<size_t>(sent);
            }

            char buf[4096];
            int n;
            while ((n = recv(sock.fd, buf, sizeof(buf) - 1, 0)) > 0)
            {
                buf[n] = '\0';
                response += buf;
            }
            return true;
        }

        CompileResult send_compile(const std::string &header, const std::string &payload)
        {
            CompileResult r;
            if (payload.empty())
            {
                r.status = CompileStatus::EmptyBuffer;
                r.message = "Editor buffer is empty; nothing to compile.";
                return r;
            }

            std::string response;
            if (!transact(header + "\n" + payload + "\nEND_COMPILE\n", response))
            {
                r.status = CompileStatus::DaemonUnreachable;
                r.message = last_error_;
                return r;
            }

            if (response.find("SUCCESS") != std::string::npos)
            {
                r.status = CompileStatus::Success;
            }
            else
            {
                r.status = CompileStatus::CompileError;
            }
            r.message = response.empty() ? "No response from daemon." : response;
            return r;
        }

        // 内嵌后端编译（JitResult -> CompileResult）
        CompileResult embedded_compile(const std::string &payload)
        {
            CompileResult r;
            if (payload.empty())
            {
                r.status = CompileStatus::EmptyBuffer;
                r.message = "Editor buffer is empty; nothing to compile.";
                return r;
            }

            JitResult jr = embedded_jit_compile(payload);
            if (jr.ok)
            {
                r.status = CompileStatus::Success;
            }
            else
            {
                r.status = CompileStatus::CompileError;
            }
            r.message = jr.message;
            return r;
        }

        // 内嵌后端执行（JitResult -> ExecuteResult）
        ExecuteResult embedded_execute(const JitResult &jr)
        {
            ExecuteResult r;
            r.ok = jr.ok;
            r.int_value = jr.ret;
            r.float_value = jr.fret;
            r.message = jr.message;
            r.output = jr.message;
            return r;
        }

    public:
        // ── 缓冲区管理 ───────────────────────────────────────────────
        void set_text(const std::string &src) { buffer_ = src; }
        const std::string &text() const { return buffer_; }
        void clear() { buffer_.clear(); }
        bool empty() const { return buffer_.empty(); }
        size_t size() const { return buffer_.size(); }

        // ── 连接 / 后端配置 ──────────────────────────────────────────
        void set_daemon(const std::string &host, int port)
        {
            host_ = host;
            port_ = port;
        }
        void set_timeout(int ms) { timeout_ms_ = ms; }
        void set_backend(Backend b) { backend_ = b; }
        Backend backend() const { return backend_; }
        const std::string &last_error() const { return last_error_; }

        // ── 编译 ─────────────────────────────────────────────────────
        // 复用 runtime 的 JIT：按所选后端，把 buffer_（LLVM IR）交给
        // daemon 或内嵌 JIT 编译。
        // qk 源码 -> IR 的前端目前由 TS 语言服务器(server/src/ir.ts)完成，
        //       C++ 侧此处直接消费 IR。
        CompileResult compile()
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_compile(buffer_);
            }
            return send_compile("COMPILE", buffer_);
        }

        // 显式编译一段给定的 IR（不依赖 buffer_）。
        CompileResult compile_ir(const std::string &ir)
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_compile(ir);
            }
            return send_compile("COMPILE", ir);
        }

        // AOT 编译：AOT_COMPILE <arch> <mode> <filename>（仅 daemon 后端支持）
        CompileResult aot_compile(const std::string &arch,
                                  const std::string &mode,
                                  const std::string &filename)
        {
            if (backend_ == Backend::Embedded)
            {
                CompileResult r;
                r.status = CompileStatus::CompileError;
                r.message = "AOT compilation is only available with the daemon backend.";
                return r;
            }
            if (buffer_.empty())
            {
                CompileResult r;
                r.status = CompileStatus::EmptyBuffer;
                r.message = "Editor buffer is empty; nothing to compile.";
                return r;
            }
            return send_compile("AOT_COMPILE " + arch + " " + mode + " " + filename, buffer_);
        }

        // ── 执行 ─────────────────────────────────────────────────────
        ExecuteResult execute_int(const std::string &func = "quark_main")
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_execute(embedded_jit_execute_int(func));
            }

            ExecuteResult r;
            std::string response;
            if (!transact("EXECUTE int32 " + func + "\n", response))
            {
                r.message = last_error_;
                return r;
            }
            r.output = response;
            r.ok = response.find("SUCCESS") != std::string::npos;
            r.message = response;

            auto pos = response.find("(Returned: ");
            if (pos != std::string::npos)
            {
                r.int_value = std::stoll(response.substr(pos + 11));
            }
            return r;
        }

        ExecuteResult execute_float(const std::string &func)
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_execute(embedded_jit_execute_float(func));
            }

            ExecuteResult r;
            std::string response;
            if (!transact("EXECUTE float " + func + "\n", response))
            {
                r.message = last_error_;
                return r;
            }
            r.output = response;
            r.ok = response.find("SUCCESS") != std::string::npos;
            r.message = response;

            auto pos = response.find("(Returned: ");
            if (pos != std::string::npos)
            {
                r.float_value = std::stod(response.substr(pos + 11));
            }
            return r;
        }

        ExecuteResult execute_void(const std::string &func)
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_execute(embedded_jit_execute_void(func));
            }

            ExecuteResult r;
            std::string response;
            if (!transact("EXECUTE void " + func + "\n", response))
            {
                r.message = last_error_;
                return r;
            }
            r.output = response;
            r.ok = response.find("SUCCESS") != std::string::npos;
            r.message = response;
            return r;
        }

        // 编译 + 执行一步完成。
        ExecuteResult compile_and_run(const std::string &func = "quark_main")
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_execute(embedded_jit_compile_and_run(buffer_, func));
            }
            if (buffer_.empty())
            {
                ExecuteResult r;
                r.message = "Editor buffer is empty; nothing to run.";
                return r;
            }

            ExecuteResult r;
            std::string response;
            std::string req = "COMPILE\n" + buffer_ + "\nEND_COMPILE\n"
                                                      "EXECUTE int32 " +
                              func + "\n";
            if (!transact(req, response))
            {
                r.message = last_error_;
                return r;
            }
            r.output = response;
            r.ok = response.find("SUCCESS") != std::string::npos;
            r.message = response;

            auto pos = response.find("(Returned: ");
            if (pos != std::string::npos)
            {
                r.int_value = std::stoll(response.substr(pos + 11));
            }
            return r;
        }

        // ── 响应检查 / 状态 ──────────────────────────────────────────
        bool ping()
        {
            if (backend_ == Backend::Embedded)
            {
                return embedded_jit_available();
            }
            std::string response;
            if (!transact("PING\n", response))
                return false;
            return response.find("PONG") != std::string::npos;
        }

        std::string snapshot()
        {
            if (backend_ == Backend::Embedded)
            {
                last_error_ = "snapshot is only available with the daemon backend.";
                return "";
            }
            std::string response;
            if (!transact("GET_SNAPSHOT\n", response))
            {
                last_error_ = last_error_.empty() ? "snapshot failed" : last_error_;
                return "";
            }
            return response;
        }
    };
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}