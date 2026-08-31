<<<<<<< HEAD
#include "../include/qhal/RuntimeApi.h"

#include "../include/qhal/QM.hpp"
#include "../include/qhal/QVM.hpp"
#include "../include/qhal/VisualizationService.hpp"
#include "../include/qhal/JIT.hpp"
#include "../include/qhal/Compiler.hpp"
#include "../include/qhal/MMI.hpp"
#include "../include/qml/Inference.hpp"
#include "../include/gui/protocol.hpp"

#include "llvm/Support/SourceMgr.h"
#include "llvm/IRReader/IRReader.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"

#include <mutex>
#include <string>
#include <memory>
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstring>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <sys/select.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <cerrno>
#endif

qhal::IQuantumBackend *global_qm = nullptr;
std::string global_string_buffer;

namespace
{
    bool is_fpga_host_available(const std::string &ip, int port)
    {
#ifdef _WIN32
        WSADATA wsaData;
        if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0)
            return false;
        SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (sock == INVALID_SOCKET)
        {
            WSACleanup();
            return false;
        }
#else
        int sock = socket(AF_INET, SOCK_STREAM, 0);
        if (sock < 0)
            return false;
#endif

        sockaddr_in serverAddress{};
        serverAddress.sin_family = AF_INET;
        serverAddress.sin_port = htons(static_cast<u_short>(port));
        inet_pton(AF_INET, ip.c_str(), &serverAddress.sin_addr);

        // 非阻塞 connect + 超时（约 200ms），避免对不可达地址长时间阻塞
        bool connected = false;
#ifdef _WIN32
        u_long nonblock = 1;
        ioctlsocket(sock, FIONBIO, &nonblock);
        int result = connect(sock, (struct sockaddr *)&serverAddress, sizeof(serverAddress));
        if (result == 0)
        {
            connected = true;
        }
        else if (WSAGetLastError() == WSAEWOULDBLOCK)
        {
            fd_set wfds, efds;
            FD_ZERO(&wfds);
            FD_ZERO(&efds);
            FD_SET(sock, &wfds);
            FD_SET(sock, &efds);
            timeval tv{};
            tv.tv_sec = 0;
            tv.tv_usec = 200000;
            int sel = select(0, nullptr, &wfds, &efds, &tv);
            if (sel > 0 && FD_ISSET(sock, &wfds) && !FD_ISSET(sock, &efds))
                connected = true;
        }
        nonblock = 0;
        ioctlsocket(sock, FIONBIO, &nonblock);
#else
        int flags = fcntl(sock, F_GETFL, 0);
        fcntl(sock, F_SETFL, flags | O_NONBLOCK);
        int result = connect(sock, (struct sockaddr *)&serverAddress, sizeof(serverAddress));
        if (result == 0)
        {
            connected = true;
        }
        else if (errno == EINPROGRESS)
        {
            fd_set wfds, efds;
            FD_ZERO(&wfds);
            FD_ZERO(&efds);
            FD_SET(sock, &wfds);
            FD_SET(sock, &efds);
            timeval tv{};
            tv.tv_sec = 0;
            tv.tv_usec = 200000;
            int sel = select(sock + 1, nullptr, &wfds, &efds, &tv);
            if (sel > 0 && FD_ISSET(sock, &wfds) && !FD_ISSET(sock, &efds))
                connected = true;
        }
        fcntl(sock, F_SETFL, flags);
#endif

        bool is_valid = false;
        if (connected)
        {
            char ping = static_cast<char>(0x99);
            send(sock, &ping, 1, 0);
            char pong = 0x00;
            int bytes_received = recv(sock, &pong, 1, 0);

            if (bytes_received > 0 && pong == static_cast<char>(0xAA))
            {
                is_valid = true;
            }
        }

#ifdef _WIN32
        closesocket(sock);
        WSACleanup();
#else
        close(sock);
#endif
        return is_valid;
    }

    std::string &result_buffer()
    {
        thread_local std::string buf;
        return buf;
    }

}

struct quark_runtime
{
    std::unique_ptr<qhal::IQuantumBackend> backend;
    std::unique_ptr<qhal::JIT> jit;
    std::unique_ptr<qhal::VisualizationService> viz;
    std::mutex mutex;
};

quark_runtime *quark_runtime_create(void)
{
    try
    {
        auto *rt = new quark_runtime();

        if (is_fpga_host_available("192.168.1.100", 50051))
        {
            std::cout << "[Quark JIT] Hardware detected! Starting quantum machine, SuperconductingBackend." << std::endl;
            rt->backend = std::make_unique<qhal::QM>(qhal::HardwareModality::Superconducting, 0);
        }
        else
        {
            std::cout << "[Quark JIT] Hardware offline. Falling back to local QVM." << std::endl;
            rt->backend = std::make_unique<qhal::QVM>();
        }

        global_qm = rt->backend.get();
        rt->jit = std::make_unique<qhal::JIT>(global_qm);
        rt->viz = std::make_unique<qhal::VisualizationService>();

        return rt;
    }
    catch (const std::exception &e)
    {
        std::cerr << "Fatal JIT Initialization Error: " << e.what() << '\n';
        return nullptr;
    }
}

void quark_runtime_destroy(quark_runtime *rt)
{
    if (!rt)
        return;
    {
        std::lock_guard<std::mutex> lock(rt->mutex);
        rt->viz->stop();
        rt->jit.reset();
        rt->backend.reset();
        global_qm = nullptr;
    }
    delete rt;
}

void quark_runtime_viz_start(quark_runtime *rt)
{
    if (rt)
        rt->viz->start();
}

void quark_runtime_viz_stop(quark_runtime *rt)
{
    if (rt)
        rt->viz->stop();
}

const char *quark_runtime_compile(quark_runtime *rt, const char *ir)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !ir)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    llvm::SMDiagnostic error;
    auto context = std::make_unique<llvm::LLVMContext>();
    auto mem_buffer = llvm::MemoryBuffer::getMemBuffer(ir);
    auto module = llvm::parseIR(*mem_buffer, error, *context);

    if (!module)
    {
        std::string err_str;
        llvm::raw_string_ostream os(err_str);
        error.print("QuarkJIT", os);
        out = "RESPONSE: ERROR - Invalid IR Payload\n";
        out += os.str();
    }
    else
    {
        rt->jit->add_ir_module(std::move(module), std::move(context));
        out = "RESPONSE: SUCCESS - Module Compiled\n";
    }

    return out.c_str();
}

const char *quark_runtime_execute_int(quark_runtime *rt, const char *func_name)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !func_name)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    auto func = rt->jit->get_function<int()>(func_name);
    if (func)
    {
        int ret = func();
        if (!global_string_buffer.empty())
        {
            out = global_string_buffer;
            global_string_buffer.clear();
        }
        else
        {
            out = "RESPONSE: SUCCESS - Executed " + std::string(func_name) + " (Returned: " + std::to_string(ret) + ")\n";
        }
    }
    else
    {
        out = "RESPONSE: ERROR - Function " + std::string(func_name) + " not found in JIT\n";
    }

    return out.c_str();
}

const char *quark_runtime_execute_float(quark_runtime *rt, const char *func_name)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !func_name)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    auto func = rt->jit->get_function<float()>(func_name);
    if (func)
    {
        out = "RESPONSE: SUCCESS - Executed " + std::string(func_name) + " (Returned: " + std::to_string(func()) + ")\n";
    }
    else
    {
        out = "RESPONSE: ERROR - Function " + std::string(func_name) + " not found in JIT\n";
    }

    return out.c_str();
}

const char *quark_runtime_execute_void(quark_runtime *rt, const char *func_name)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !func_name)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    auto func = rt->jit->get_function<void()>(func_name);
    if (func)
    {
        func();
        out = "RESPONSE: SUCCESS - Executed " + std::string(func_name) + "\n";
    }
    else
    {
        out = "RESPONSE: ERROR - Function " + std::string(func_name) + " not found in JIT\n";
    }

    return out.c_str();
}

const char *quark_runtime_aot_compile(quark_runtime *rt,
                                      const char *arch,
                                      const char *mode,
                                      const char *output_name,
                                      const char *ir)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !arch || !mode || !output_name || !ir)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    llvm::SMDiagnostic error;
    auto context = std::make_unique<llvm::LLVMContext>();
    auto mem_buffer = llvm::MemoryBuffer::getMemBuffer(ir);
    auto module = llvm::parseIR(*mem_buffer, error, *context);

    if (!module)
    {
        std::string err_str;
        llvm::raw_string_ostream os(err_str);
        error.print("Quark AOT", os);
        out = "RESPONSE: ERROR - Invalid IR Payload\n";
        out += os.str();
    }
    else
    {
        bool success = quark::AOTCompiler::compile_to_binary(module.get(), arch, mode, output_name);
        if (success)
        {
            out = "RESPONSE: SUCCESS - AOT Compilation Finished (" + std::string(output_name) + ")\n";
        }
        else
        {
            out = "RESPONSE: ERROR - AOT Compilation Failed\n";
        }
    }

    return out.c_str();
}

const char *quark_runtime_snapshot(quark_runtime *rt)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    out = qgui::serialize(rt->viz->snapshot());
    return out.c_str();
}

struct quark_mmi
{
    std::shared_ptr<qhal::MMIModule> module;
};

static uint32_t write_u32_le(std::string &buf, uint32_t v)
{
    buf.push_back((char)(v & 0xFF));
    buf.push_back((char)((v >> 8) & 0xFF));
    buf.push_back((char)((v >> 16) & 0xFF));
    buf.push_back((char)((v >> 24) & 0xFF));
    return v;
}

const char *quark_runtime_export_mmi(quark_runtime *rt,
                                     const char *header_json,
                                     const char *ir,
                                     const char *output_path)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !header_json || !ir || !output_path)
    {
        out = "RESPONSE: ERROR - Invalid arguments\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    std::string header(header_json);
    std::string payload(ir);
    std::string data;
    data += "QKMM";
    write_u32_le(data, 1);
    write_u32_le(data, (uint32_t)header.size());
    data += header;
    data += payload;

    std::ofstream ofs(output_path, std::ios::binary);
    if (!ofs)
    {
        out = "RESPONSE: ERROR - Cannot open output file\n";
        return out.c_str();
    }
    ofs.write(data.data(), (std::streamsize)data.size());
    ofs.close();

    out = "RESPONSE: SUCCESS - Exported MMI (" + std::string(output_path) + ")\n";
    return out.c_str();
}

namespace
{
    std::string dir_of(const std::string &p)
    {
        size_t pos = p.find_last_of("/\\");
        if (pos == std::string::npos)
            return ".";
        if (pos == 0)
            return "/";
        return p.substr(0, pos);
    }
}

quark_mmi *quark_runtime_load_mmi(quark_runtime *rt, const char *path)
{
    if (!rt || !path)
        return nullptr;

    std::lock_guard<std::mutex> lock(rt->mutex);
    auto cache = std::make_shared<std::map<std::string, std::shared_ptr<qhal::MMIModule>>>();

    std::function<std::shared_ptr<qhal::MMIModule>(const std::string &, const std::string &)> load =
        [&](const std::string &p, const std::string &parent_dir) -> std::shared_ptr<qhal::MMIModule>
    {
        bool is_abs = (!p.empty() && (p[0] == '/' || p[0] == '\\')) ||
                      (p.size() > 1 && p[1] == ':');
        std::string resolved = is_abs ? p : (parent_dir + "/" + p);
        auto hit = cache->find(resolved);
        if (hit != cache->end())
            return hit->second;

        std::ifstream ifs(resolved, std::ios::binary);
        if (!ifs)
            return nullptr;
        std::stringstream ss;
        ss << ifs.rdbuf();

        std::string self_dir = dir_of(resolved);
        auto mod = std::make_shared<qhal::MMIModule>(ss.str(), self_dir, load);
        (*cache)[resolved] = mod;
        return mod;
    };

    try
    {
        std::string top_dir = dir_of(path);
        auto mod = load(path, top_dir);
        if (!mod)
            return nullptr;

        auto *m = new quark_mmi();
        m->module = mod;
        return m;
    }
    catch (const std::exception &e)
    {
        std::cerr << "[MMI] load failed: " << e.what() << "\n";
        return nullptr;
    }
}

const char *quark_runtime_mmi_invoke(quark_mmi *m,
                                     const char *func_name,
                                     const char *args_json)
{
    std::string &out = result_buffer();
    out.clear();

    if (!m || !func_name || !args_json)
    {
        out = "RESPONSE: ERROR - Invalid arguments\n";
        return out.c_str();
    }

    try
    {
        out = m->module->invoke(func_name, args_json);
    }
    catch (const std::exception &e)
    {
        out = "RESPONSE: ERROR - ";
        out += e.what();
        out += "\n";
    }
    return out.c_str();
}

void quark_runtime_mmi_unload(quark_mmi *m)
{
    delete m;
=======
#include "../include/qhal/RuntimeApi.h"

#include "../include/qhal/QM.hpp"
#include "../include/qhal/QVM.hpp"
#include "../include/qhal/VisualizationService.hpp"
#include "../include/qhal/JIT.hpp"
#include "../include/qhal/Compiler.hpp"
#include "../include/qhal/MMI.hpp"
#include "../include/qml/Inference.hpp"
#include "../include/gui/protocol.hpp"
#include "../include/verify/IntervalAbstract.hpp"

#include "llvm/Support/SourceMgr.h"
#include "llvm/IRReader/IRReader.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"

#include <mutex>
#include <string>
#include <memory>
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstring>
#include <cstdlib>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <sys/select.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <cerrno>
#endif

qhal::IQuantumBackend *global_qm = nullptr;
std::string global_string_buffer;

namespace
{
    bool is_fpga_host_available(const std::string &ip, int port)
    {
#ifdef _WIN32
        WSADATA wsaData;
        if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0)
            return false;
        SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (sock == INVALID_SOCKET)
        {
            WSACleanup();
            return false;
        }
#else
        int sock = socket(AF_INET, SOCK_STREAM, 0);
        if (sock < 0)
            return false;
#endif

        sockaddr_in serverAddress{};
        serverAddress.sin_family = AF_INET;
        serverAddress.sin_port = htons(static_cast<u_short>(port));
        inet_pton(AF_INET, ip.c_str(), &serverAddress.sin_addr);
        bool connected = false;
#ifdef _WIN32
        u_long nonblock = 1;
        ioctlsocket(sock, FIONBIO, &nonblock);
        int result = connect(sock, (struct sockaddr *)&serverAddress, sizeof(serverAddress));
        if (result == 0)
        {
            connected = true;
        }
        else if (WSAGetLastError() == WSAEWOULDBLOCK)
        {
            fd_set wfds, efds;
            FD_ZERO(&wfds);
            FD_ZERO(&efds);
            FD_SET(sock, &wfds);
            FD_SET(sock, &efds);
            timeval tv{};
            tv.tv_sec = 0;
            tv.tv_usec = 200000;
            int sel = select(0, nullptr, &wfds, &efds, &tv);
            if (sel > 0 && FD_ISSET(sock, &wfds) && !FD_ISSET(sock, &efds))
                connected = true;
        }
        nonblock = 0;
        ioctlsocket(sock, FIONBIO, &nonblock);
#else
        int flags = fcntl(sock, F_GETFL, 0);
        fcntl(sock, F_SETFL, flags | O_NONBLOCK);
        int result = connect(sock, (struct sockaddr *)&serverAddress, sizeof(serverAddress));
        if (result == 0)
        {
            connected = true;
        }
        else if (errno == EINPROGRESS)
        {
            fd_set wfds, efds;
            FD_ZERO(&wfds);
            FD_ZERO(&efds);
            FD_SET(sock, &wfds);
            FD_SET(sock, &efds);
            timeval tv{};
            tv.tv_sec = 0;
            tv.tv_usec = 200000;
            int sel = select(sock + 1, nullptr, &wfds, &efds, &tv);
            if (sel > 0 && FD_ISSET(sock, &wfds) && !FD_ISSET(sock, &efds))
                connected = true;
        }
        fcntl(sock, F_SETFL, flags);
#endif

        bool is_valid = false;
        if (connected)
        {
            char ping = static_cast<char>(0x99);
            send(sock, &ping, 1, 0);
            char pong = 0x00;
            int bytes_received = recv(sock, &pong, 1, 0);

            if (bytes_received > 0 && pong == static_cast<char>(0xAA))
            {
                is_valid = true;
            }
        }

#ifdef _WIN32
        closesocket(sock);
        WSACleanup();
#else
        close(sock);
#endif
        return is_valid;
    }

    std::string &result_buffer()
    {
        thread_local std::string buf;
        return buf;
    }

}

struct quark_runtime
{
    std::unique_ptr<qhal::IQuantumBackend> backend;
    std::unique_ptr<qhal::JIT> jit;
    std::unique_ptr<qhal::VisualizationService> viz;
    std::mutex mutex;
};

quark_runtime *quark_runtime_create(void)
{
    try
    {
        // Kokkos 必须在使用任何 View / parallel_for 之前初始化（GPU 后端需要）
        if (!Kokkos::is_initialized())
            Kokkos::initialize();

        auto *rt = new quark_runtime();

        const char *backend_env = std::getenv("QUARK_BACKEND");
        const char *endpoint_env = std::getenv("QUARK_QPU_ENDPOINT");
        const char *node_env = std::getenv("QUARK_QPU_NODE");

        if (backend_env && std::string(backend_env) == "qvm")
        {
            std::cout << "[Quark JIT] Backend forced to local QVM." << std::endl;
            rt->backend = std::make_unique<qhal::QVM>();
        }
        else if (backend_env && std::string(backend_env).rfind("qm:", 0) == 0)
        {
            std::string m = std::string(backend_env).substr(3);
            qhal::HardwareModality modality = qhal::HardwareModality::Superconducting;
            if (m == "ion" || m == "trappedion") modality = qhal::HardwareModality::TrappedIon;
            else if (m == "atom" || m == "neutralatom") modality = qhal::HardwareModality::NeutralAtom;
            size_t node = node_env ? static_cast<size_t>(std::strtoul(node_env, nullptr, 10)) : 0;
            std::cout << "[Quark JIT] Backend forced to QM (" << m << ", node " << node << ")." << std::endl;
            rt->backend = std::make_unique<qhal::QM>(modality, node);
        }
        else
        {
            std::string endpoint = endpoint_env ? std::string(endpoint_env) : std::string("192.168.1.100:50051");
            std::string ip = endpoint;
            int port = 50051;
            auto colon = endpoint.rfind(':');
            if (colon != std::string::npos)
            {
                ip = endpoint.substr(0, colon);
                port = std::atoi(endpoint.substr(colon + 1).c_str());
            }
            if (is_fpga_host_available(ip, port))
            {
                std::cout << "[Quark JIT] Hardware detected! Starting quantum machine, SuperconductingBackend." << std::endl;
                rt->backend = std::make_unique<qhal::QM>(qhal::HardwareModality::Superconducting, 0);
            }
            else
            {
                std::cout << "[Quark JIT] Hardware offline. Falling back to local QVM." << std::endl;
                rt->backend = std::make_unique<qhal::QVM>();
            }
        }

        global_qm = rt->backend.get();
        rt->jit = std::make_unique<qhal::JIT>(global_qm);
        rt->viz = std::make_unique<qhal::VisualizationService>();

        return rt;
    }
    catch (const std::exception &e)
    {
        std::cerr << "Fatal JIT Initialization Error: " << e.what() << '\n';
        return nullptr;
    }
}

void quark_runtime_destroy(quark_runtime *rt)
{
    if (!rt)
        return;
    {
        std::lock_guard<std::mutex> lock(rt->mutex);
        rt->viz->stop();
        rt->jit.reset();
        rt->backend.reset();
        global_qm = nullptr;
    }
    delete rt;
    if (Kokkos::is_initialized())
        Kokkos::finalize();
}

void quark_runtime_viz_start(quark_runtime *rt)
{
    if (rt)
        rt->viz->start();
}

void quark_runtime_viz_stop(quark_runtime *rt)
{
    if (rt)
        rt->viz->stop();
}

const char *quark_runtime_compile(quark_runtime *rt, const char *ir)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !ir)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    llvm::SMDiagnostic error;
    auto context = std::make_unique<llvm::LLVMContext>();
    auto mem_buffer = llvm::MemoryBuffer::getMemBuffer(ir);
    auto module = llvm::parseIR(*mem_buffer, error, *context);

    if (!module)
    {
        std::string err_str;
        llvm::raw_string_ostream os(err_str);
        error.print("QuarkJIT", os);
        out = "RESPONSE: ERROR - Invalid IR Payload\n";
        out += os.str();
    }
    else
    {
        rt->jit->add_ir_module(std::move(module), std::move(context));
        out = "RESPONSE: SUCCESS - Module Compiled\n";
    }

    return out.c_str();
}

const char *quark_runtime_execute_int(quark_runtime *rt, const char *func_name)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !func_name)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    auto func = rt->jit->get_function<int()>(func_name);
    if (func)
    {
        int ret = func();
        if (!global_string_buffer.empty())
        {
            out = global_string_buffer;
            global_string_buffer.clear();
        }
        else
        {
            out = "RESPONSE: SUCCESS - Executed " + std::string(func_name) + " (Returned: " + std::to_string(ret) + ")\n";
        }
    }
    else
    {
        out = "RESPONSE: ERROR - Function " + std::string(func_name) + " not found in JIT\n";
    }

    return out.c_str();
}

const char *quark_runtime_execute_float(quark_runtime *rt, const char *func_name)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !func_name)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    auto func = rt->jit->get_function<float()>(func_name);
    if (func)
    {
        out = "RESPONSE: SUCCESS - Executed " + std::string(func_name) + " (Returned: " + std::to_string(func()) + ")\n";
    }
    else
    {
        out = "RESPONSE: ERROR - Function " + std::string(func_name) + " not found in JIT\n";
    }

    return out.c_str();
}

const char *quark_runtime_execute_void(quark_runtime *rt, const char *func_name)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !func_name)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    auto func = rt->jit->get_function<void()>(func_name);
    if (func)
    {
        func();
        out = "RESPONSE: SUCCESS - Executed " + std::string(func_name) + "\n";
    }
    else
    {
        out = "RESPONSE: ERROR - Function " + std::string(func_name) + " not found in JIT\n";
    }

    return out.c_str();
}

const char *quark_runtime_aot_compile(quark_runtime *rt,
                                      const char *arch,
                                      const char *mode,
                                      const char *output_name,
                                      const char *ir)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !arch || !mode || !output_name || !ir)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    llvm::SMDiagnostic error;
    auto context = std::make_unique<llvm::LLVMContext>();
    auto mem_buffer = llvm::MemoryBuffer::getMemBuffer(ir);
    auto module = llvm::parseIR(*mem_buffer, error, *context);

    if (!module)
    {
        std::string err_str;
        llvm::raw_string_ostream os(err_str);
        error.print("Quark AOT", os);
        out = "RESPONSE: ERROR - Invalid IR Payload\n";
        out += os.str();
    }
    else
    {
        bool success = quark::AOTCompiler::compile_to_binary(module.get(), arch, mode, output_name);
        if (success)
        {
            out = "RESPONSE: SUCCESS - AOT Compilation Finished (" + std::string(output_name) + ")\n";
        }
        else
        {
            out = "RESPONSE: ERROR - AOT Compilation Failed\n";
        }
    }

    return out.c_str();
}

const char *quark_runtime_snapshot(quark_runtime *rt)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    out = qgui::serialize(rt->viz->snapshot());
    return out.c_str();
}

const char *quark_runtime_verify(quark_runtime *rt, const char *vc_protocol)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !vc_protocol)
    {
        out = "VERIFY_ERROR invalid arguments\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);
    out = qhal::verify::verifyProtocolCombined(std::string(vc_protocol));
    return out.c_str();
}

struct quark_mmi
{
    std::shared_ptr<qhal::MMIModule> module;
};

static uint32_t write_u32_le(std::string &buf, uint32_t v)
{
    buf.push_back((char)(v & 0xFF));
    buf.push_back((char)((v >> 8) & 0xFF));
    buf.push_back((char)((v >> 16) & 0xFF));
    buf.push_back((char)((v >> 24) & 0xFF));
    return v;
}

const char *quark_runtime_export_mmi(quark_runtime *rt,
                                     const char *header_json,
                                     const char *ir,
                                     const char *output_path)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !header_json || !ir || !output_path)
    {
        out = "RESPONSE: ERROR - Invalid arguments\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    std::string header(header_json);
    std::string payload(ir);
    std::string data;
    data += "QKMM";
    write_u32_le(data, 1);
    write_u32_le(data, (uint32_t)header.size());
    data += header;
    data += payload;

    std::ofstream ofs(output_path, std::ios::binary);
    if (!ofs)
    {
        out = "RESPONSE: ERROR - Cannot open output file\n";
        return out.c_str();
    }
    ofs.write(data.data(), (std::streamsize)data.size());
    ofs.close();

    out = "RESPONSE: SUCCESS - Exported MMI (" + std::string(output_path) + ")\n";
    return out.c_str();
}

namespace
{
    std::string dir_of(const std::string &p)
    {
        size_t pos = p.find_last_of("/\\");
        if (pos == std::string::npos)
            return ".";
        if (pos == 0)
            return "/";
        return p.substr(0, pos);
    }
}

quark_mmi *quark_runtime_load_mmi(quark_runtime *rt, const char *path)
{
    if (!rt || !path)
        return nullptr;

    std::lock_guard<std::mutex> lock(rt->mutex);
    auto cache = std::make_shared<std::map<std::string, std::shared_ptr<qhal::MMIModule>>>();

    std::function<std::shared_ptr<qhal::MMIModule>(const std::string &, const std::string &)> load =
        [&](const std::string &p, const std::string &parent_dir) -> std::shared_ptr<qhal::MMIModule>
    {
        bool is_abs = (!p.empty() && (p[0] == '/' || p[0] == '\\')) ||
                      (p.size() > 1 && p[1] == ':');
        std::string resolved = is_abs ? p : (parent_dir + "/" + p);
        auto hit = cache->find(resolved);
        if (hit != cache->end())
            return hit->second;

        std::ifstream ifs(resolved, std::ios::binary);
        if (!ifs)
            return nullptr;
        std::stringstream ss;
        ss << ifs.rdbuf();

        std::string self_dir = dir_of(resolved);
        auto mod = std::make_shared<qhal::MMIModule>(ss.str(), self_dir, load);
        (*cache)[resolved] = mod;
        return mod;
    };

    try
    {
        std::string top_dir = dir_of(path);
        auto mod = load(path, top_dir);
        if (!mod)
            return nullptr;

        auto *m = new quark_mmi();
        m->module = mod;
        return m;
    }
    catch (const std::exception &e)
    {
        std::cerr << "[MMI] load failed: " << e.what() << "\n";
        return nullptr;
    }
}

const char *quark_runtime_mmi_invoke(quark_mmi *m,
                                     const char *func_name,
                                     const char *args_json)
{
    std::string &out = result_buffer();
    out.clear();

    if (!m || !func_name || !args_json)
    {
        out = "RESPONSE: ERROR - Invalid arguments\n";
        return out.c_str();
    }

    try
    {
        out = m->module->invoke(func_name, args_json);
    }
    catch (const std::exception &e)
    {
        out = "RESPONSE: ERROR - ";
        out += e.what();
        out += "\n";
    }
    return out.c_str();
}

void quark_runtime_mmi_unload(quark_mmi *m)
{
    delete m;
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}