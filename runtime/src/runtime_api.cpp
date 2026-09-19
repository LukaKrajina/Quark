#include "../include/qhal/RuntimeApi.h"

#include "../include/qhal/QM.hpp"
#include "../include/qhal/QVM.hpp"
#include "../include/qhal/VisualizationService.hpp"
#include "../include/qhal/JIT.hpp"
#include "../include/qhal/Compiler.hpp"
#include "../include/qhal/MMI.hpp"
#include "../include/qhal/MirModuleBuilder.hpp"
#include "../include/qml/Inference.hpp"
#include "../include/qml/QrcAbi.hpp"
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
#include <thread>
#include <map>
#include <vector>
#include <functional>

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

#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

qhal::IQuantumBackend *global_qm = nullptr;
std::string global_string_buffer;

// 活跃 runtime（供 IR 生成的 qk_topology_entry 经 quark_runtime_run_topology 访问 JIT）
static quark_runtime *g_active_runtime = nullptr;

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
    // 已绑定的 .mmi 模块（保持生命周期，避免导出符号地址悬垂）
    std::vector<std::shared_ptr<qhal::MMIModule>> bound_mmis;
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
            else if (m == "photon" || m == "photonic") modality = qhal::HardwareModality::Photonic;
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
        rt->viz = std::make_unique<qhal::VisualizationService>(rt->backend.get());
        g_active_runtime = rt;

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
        g_active_runtime = nullptr;
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

const char *quark_runtime_compile_mir(quark_runtime *rt, const char *mir_json)
{
    std::string &out = result_buffer();
    out.clear();

    if (!rt || !mir_json)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }

    std::lock_guard<std::mutex> lock(rt->mutex);

    try
    {
        qhal::MirModuleBuilder builder;
        qhal::BuiltMirModule built = builder.build(mir_json);
        rt->jit->add_ir_module(std::move(built.module), std::move(built.context));
        out = "RESPONSE: SUCCESS - MIR Module Compiled\n";
    }
    catch (const std::exception &e)
    {
        out = "RESPONSE: ERROR - MIR compile failed: ";
        out += e.what();
        out += "\n";
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

// ─── QChain 量子区块链服务 ABI ───────────────────────────────────────────
// 内部复用 qchain_bridge 的单例 QChainService（绑定 global_qm 后端）。

const char *quark_runtime_qchain_wallet(quark_runtime *rt)
{
    std::string &out = result_buffer();
    out.clear();
    if (!rt)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }
    std::lock_guard<std::mutex> lock(rt->mutex);
    auto &w = qchain_bridge::service().create_wallet();
    out = qchain::to_hex(w.address);
    return out.c_str();
}

const char *quark_runtime_qchain_mint(quark_runtime *rt, const char *addr, uint64_t amount)
{
    std::string &out = result_buffer();
    out.clear();
    if (!rt || !addr)
    {
        out = "RESPONSE: ERROR - Invalid arguments\n";
        return out.c_str();
    }
    std::lock_guard<std::mutex> lock(rt->mutex);
    qchain_bridge::service().mint_to_address(qchain_bridge::parse_address(addr), amount);
    out = "RESPONSE: SUCCESS - Minted " + std::to_string(amount) + " to " + std::string(addr) + "\n";
    return out.c_str();
}

const char *quark_runtime_qchain_transfer(quark_runtime *rt, const char *from, const char *to, uint64_t amount)
{
    std::string &out = result_buffer();
    out.clear();
    if (!rt || !from || !to)
    {
        out = "RESPONSE: ERROR - Invalid arguments\n";
        return out.c_str();
    }
    std::lock_guard<std::mutex> lock(rt->mutex);
    bool ok = qchain_bridge::service().transfer_addresses(
        qchain_bridge::parse_address(from), qchain_bridge::parse_address(to), amount);
    out = ok ? "RESPONSE: SUCCESS - Transferred\n"
             : "RESPONSE: ERROR - Transfer failed (insufficient balance)\n";
    return out.c_str();
}

const char *quark_runtime_qchain_balance(quark_runtime *rt, const char *addr)
{
    std::string &out = result_buffer();
    out.clear();
    if (!rt || !addr)
    {
        out = "RESPONSE: ERROR - Invalid arguments\n";
        return out.c_str();
    }
    std::lock_guard<std::mutex> lock(rt->mutex);
    uint64_t bal = qchain_bridge::service().balance_of_address(qchain_bridge::parse_address(addr));
    out = std::to_string(bal);
    return out.c_str();
}

const char *quark_runtime_qchain_mine(quark_runtime *rt)
{
    std::string &out = result_buffer();
    out.clear();
    if (!rt)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }
    std::lock_guard<std::mutex> lock(rt->mutex);
    qchain_bridge::service().mine_block();
    out = std::to_string(qchain_bridge::service().get_chain().height());
    return out.c_str();
}

const char *quark_runtime_qchain_height(quark_runtime *rt)
{
    std::string &out = result_buffer();
    out.clear();
    if (!rt)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }
    std::lock_guard<std::mutex> lock(rt->mutex);
    out = std::to_string(qchain_bridge::service().get_chain().height());
    return out.c_str();
}

const char *quark_runtime_qchain_verify(quark_runtime *rt)
{
    std::string &out = result_buffer();
    out.clear();
    if (!rt)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }
    std::lock_guard<std::mutex> lock(rt->mutex);
    out = qchain_bridge::service().verify_chain()
              ? "RESPONSE: SUCCESS - Chain valid\n"
              : "RESPONSE: ERROR - Chain invalid\n";
    return out.c_str();
}

const char *quark_runtime_qchain_qkd(quark_runtime *rt, int32_t rounds)
{
    std::string &out = result_buffer();
    out.clear();
    if (!rt)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }
    std::lock_guard<std::mutex> lock(rt->mutex);
    auto res = qchain_bridge::service().establish_qkd(static_cast<size_t>(rounds > 0 ? rounds : 64));
    out = qchain::to_hex(res.shared_key);
    return out.c_str();
}

const char *quark_runtime_qchain_qdba(quark_runtime *rt, int32_t parties)
{
    std::string &out = result_buffer();
    out.clear();
    if (!rt)
    {
        out = "RESPONSE: ERROR - Invalid Runtime Instance\n";
        return out.c_str();
    }
    std::lock_guard<std::mutex> lock(rt->mutex);
    auto res = qchain_bridge::service().run_qdba(static_cast<size_t>(parties), {}, 20);
    out = res.agreement ? "1" : "0";
    return out.c_str();
}

struct quark_mmi
{
    std::shared_ptr<qhal::MMIModule> module;
};

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

    // QOBF v2：二进制 header + ChaCha20 流加密 + HMAC 完整性（打开为乱码）。
    std::string module_name;
    qhal::qcrypt::Bytes binary_payload = qhal::mmi_header_to_binary(header_json, module_name);
    const char *ir_data = ir;
    binary_payload.insert(binary_payload.end(), ir_data, ir_data + std::strlen(ir_data));
    qhal::qcrypt::Bytes data = qhal::qcrypt::pack_mmi_v2(module_name, binary_payload);

    std::ofstream ofs(output_path, std::ios::binary);
    if (!ofs)
    {
        out = "RESPONSE: ERROR - Cannot open output file\n";
        return out.c_str();
    }
    ofs.write((const char *)data.data(), (std::streamsize)data.size());
    ofs.close();

    out = "RESPONSE: SUCCESS - Exported encrypted MMI (" + std::string(output_path) + ")\n";
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
        // path 可为相对/绝对路径；相对路径以当前工作目录为基准（避免目录重复拼接）
        auto mod = load(path, ".");
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

int32_t quark_runtime_load_native(quark_runtime *rt, const char *path)
{
    (void)rt;
    if (!path)
        return 0;
#ifdef _WIN32
    HMODULE h = LoadLibraryA(path);
    return h ? 1 : 0;
#else
    void *h = dlopen(path, RTLD_NOW | RTLD_GLOBAL);
    return h ? 1 : 0;
#endif
}

void quark_runtime_register_native_symbol(quark_runtime *rt, const char *name, void *addr)
{
    (void)rt;
    if (name && addr)
        qhal::register_native_symbol(name, addr);
}

const char *quark_runtime_bind_mmi(quark_runtime *rt, const char *alias, const char *path)
{
    std::string &out = result_buffer();
    out.clear();
    if (!rt || !alias || !path)
    {
        out = "RESPONSE: ERROR - Invalid arguments\n";
        return out.c_str();
    }
    try
    {
        std::ifstream ifs(path, std::ios::binary);
        if (!ifs)
        {
            out = "RESPONSE: ERROR - bind_mmi: cannot open file\n";
            return out.c_str();
        }
        std::stringstream ss;
        ss << ifs.rdbuf();

        std::lock_guard<std::mutex> lock(rt->mutex);
        auto mod = std::make_shared<qhal::MMIModule>(ss.str(), dir_of(path), nullptr);
        rt->bound_mmis.push_back(mod); // 保持生命周期，避免导出地址悬垂
        int bound = 0;
        std::string detail;
        detail += "exports=" + std::to_string(mod->exports().size());
        for (const auto &ex : mod->exports())
        {
            void *addr = mod->lookup_export_address(ex.name);
            detail += std::string(" ") + ex.name + (addr ? ":ok" : ":MISS");
            if (addr)
            {
                rt->jit->bind_symbol(std::string(alias) + "_" + ex.name, addr);
                bound++;
            }
        }
        out = "RESPONSE: MMI_BOUND " + std::to_string(bound) + " (" + detail + ")\n";
    }
    catch (const std::exception &e)
    {
        out = "RESPONSE: ERROR - bind_mmi failed: ";
        out += e.what();
        out += "\n";
    }
    return out.c_str();
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
}

// ============================================================================
// 多维标签函数执行拓扑（@layer）调度器
//
// 解析调度表 JSON，通过活跃 runtime 的 JIT 查找各块符号，按 time 分层、
// 同层并行调度执行。块内调用传播延迟（子函数 = 父时钟 + Δt）已由编译期
// TopologyBuilder 静态校验，且函数体内部的调用顺序由 CPU 顺序执行自然保证；
// 运行时只需保证「层间顺序、层内并行」。
// ============================================================================
int32_t quark_runtime_run_topology(const char *json)
{
    if (!json)
        return -1;

    quark_runtime *rt = g_active_runtime;
    if (!rt || !rt->jit)
        return -1;

    try
    {
        qhal::json::Value doc = qhal::json::parse(std::string(json));
        if (!doc.is_object() || !doc.has("blocks") || !doc.at("blocks").is_array())
            return -1;

        struct Block
        {
            std::string name;
            int time = 0;
            int thread = 0;
        };
        std::vector<Block> blocks;

        for (const auto &bv : doc.at("blocks").array())
        {
            if (!bv.is_object() || !bv.has("name"))
                continue;
            Block b;
            b.name = bv.at("name").string();
            if (bv.has("time"))
                b.time = bv.at("time").int_value();
            if (bv.has("thread"))
                b.thread = bv.at("thread").int_value();
            blocks.push_back(std::move(b));
        }

        if (blocks.empty())
            return 0;

        // 预查找所有块函数（主线程串行，避免并发 LLJIT lookup）
        std::map<std::string, std::function<int()>> funcs;
        for (const auto &b : blocks)
        {
            auto fn = rt->jit->get_function<int()>(b.name);
            if (fn)
                funcs[b.name] = fn;
        }

        // 按 time 分组，保证叠加链（同 coord 不同 time）的时序顺序
        std::map<int, std::vector<const Block *>> by_time;
        for (const auto &b : blocks)
            by_time[b.time].push_back(&b);

        for (const auto &entry : by_time)
        {
            const std::vector<const Block *> &layer = entry.second;
            if (layer.size() == 1)
            {
                auto it = funcs.find(layer[0]->name);
                if (it != funcs.end())
                    it->second();
            }
            else
            {
                // 同 time 层并行（异 thread / 异 coord 的块）
                std::vector<std::thread> threads;
                threads.reserve(layer.size());
                for (const Block *b : layer)
                {
                    threads.emplace_back([&funcs, name = b->name]()
                    {
                        auto it = funcs.find(name);
                        if (it != funcs.end())
                            it->second();
                    });
                }
                for (auto &th : threads)
                    th.join();
            }
        }
        return 0;
    }
    catch (const std::exception &e)
    {
        std::cerr << "[Topology] error: " << e.what() << std::endl;
        return -1;
    }
}