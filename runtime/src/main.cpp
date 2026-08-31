<<<<<<< HEAD
#include <iostream>
#include <string>
#include <memory>
#include <sstream>
#include <vector>
#include <thread>
#include <map>
#include <mutex>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <cstdio>
#else
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <cstdio>
#include <cstdlib>
#include <limits.h>
#endif

#include "../include/qhal/RuntimeApi.h"

#define DAEMON_PORT 50052
#define BUFFER_SIZE 65536

// 已加载的 .mmi 模块句柄表
static std::map<int, quark_mmi *> g_mmi_modules;
static int g_mmi_next_id = 1;
static std::mutex g_mmi_mutex;

void process_stream(std::istream &in_stream, std::ostream &out_stream, quark_runtime *rt)
{
    std::string command;
    while (std::getline(in_stream, command))
    {
        if (command == "EXIT")
            break;

        if (command == "PING")
        {
            out_stream << "RESPONSE: PONG\n";
        }
        else if (command == "GET_SNAPSHOT")
        {
            out_stream << quark_runtime_snapshot(rt);
        }
        else if (command == "COMPILE")
        {
            std::string ir_payload;
            std::string line;

            while (std::getline(in_stream, line))
            {
                if (line == "END_COMPILE")
                    break;
                ir_payload += line + "\n";
            }

            out_stream << quark_runtime_compile(rt, ir_payload.c_str());
        }
        else if (command.rfind("AOT_COMPILE ", 0) == 0)
        {
            std::stringstream cmd_ss(command);
            std::string action, arch, mode, filename;
            cmd_ss >> action >> arch >> mode >> filename;

            std::string ir_payload;
            std::string line;

            while (std::getline(in_stream, line))
            {
                if (line == "END_COMPILE")
                    break;
                ir_payload += line + "\n";
            }

            out_stream << quark_runtime_aot_compile(rt, arch.c_str(), mode.c_str(),
                                                    filename.c_str(), ir_payload.c_str());
        }
        else if (command.rfind("EXECUTE ", 0) == 0)
        {
            std::stringstream cmd_ss(command);
            std::string action, command_type, func_name;
            cmd_ss >> action >> command_type >> func_name;

            if (func_name.empty())
            {
                func_name = command_type;
                command_type = "int32";
            }

            if (command_type == "int32" || command_type == "int")
            {
                out_stream << quark_runtime_execute_int(rt, func_name.c_str());
            }
            else if (command_type == "void")
            {
                out_stream << quark_runtime_execute_void(rt, func_name.c_str());
            }
            else if (command_type == "float")
            {
                out_stream << quark_runtime_execute_float(rt, func_name.c_str());
            }
            else
            {
                out_stream << "RESPONSE: ERROR - Unsupported return type '" << command_type
                           << "' for function " << func_name << "\n";
            }
        }
        else if (command.rfind("LOAD_MMI ", 0) == 0)
        {
            std::string path = command.substr(9);
            std::lock_guard<std::mutex> lk(g_mmi_mutex);
            quark_mmi *m = quark_runtime_load_mmi(rt, path.c_str());
            if (m)
            {
                int id = g_mmi_next_id++;
                g_mmi_modules[id] = m;
                out_stream << "RESPONSE: MMI_LOADED " << id << "\n";
            }
            else
            {
                out_stream << "RESPONSE: ERROR - MMI load failed\n";
            }
        }
        else if (command.rfind("MMI_INVOKE ", 0) == 0)
        {
            std::stringstream cmd_ss(command);
            std::string action;
            int id = 0;
            std::string func_name;
            cmd_ss >> action >> id >> func_name;

            std::string args_json;
            std::getline(cmd_ss, args_json);
            size_t pos = args_json.find_first_not_of(" \t");
            args_json = (pos == std::string::npos) ? "" : args_json.substr(pos);

            std::lock_guard<std::mutex> lk(g_mmi_mutex);
            auto it = g_mmi_modules.find(id);
            if (it != g_mmi_modules.end())
            {
                out_stream << quark_runtime_mmi_invoke(it->second, func_name.c_str(), args_json.c_str());
            }
            else
            {
                out_stream << "RESPONSE: ERROR - MMI handle not found\n";
            }
        }
        else if (command.rfind("MMI_UNLOAD ", 0) == 0)
        {
            int id = std::stoi(command.substr(11));
            std::lock_guard<std::mutex> lk(g_mmi_mutex);
            auto it = g_mmi_modules.find(id);
            if (it != g_mmi_modules.end())
            {
                quark_runtime_mmi_unload(it->second);
                g_mmi_modules.erase(it);
                out_stream << "RESPONSE: MMI_UNLOADED\n";
            }
            else
            {
                out_stream << "RESPONSE: ERROR - MMI handle not found\n";
            }
        }
    }
}

#ifdef _WIN32
typedef SOCKET SocketHandle;
#define INVALID_SOCKET_HANDLE INVALID_SOCKET
#define CLOSE_SOCKET_HANDLE(s) closesocket(s)
#else
typedef int SocketHandle;
#define INVALID_SOCKET_HANDLE (-1)
#define CLOSE_SOCKET_HANDLE(s) close(s)
#endif

void handle_connection(SocketHandle client_socket, quark_runtime *rt)
{
    std::vector<char> buffer(BUFFER_SIZE);
    std::string incoming_payload;

    while (true)
    {
        int bytes_read = recv(client_socket, buffer.data(), BUFFER_SIZE - 1, 0);
        if (bytes_read <= 0)
            break;

        buffer[bytes_read] = '\0';
        incoming_payload += buffer.data();
        if (incoming_payload.find("EXIT\n") != std::string::npos)
            break;
    }

    std::stringstream in_stream(incoming_payload);
    std::stringstream out_stream;
    try
    {
        process_stream(in_stream, out_stream, rt);
    }
    catch (const std::exception &e)
    {
        out_stream << "[QHAL ERROR] " << e.what() << "\n";
    }

    std::string response_str = out_stream.str();
    send(client_socket, response_str.c_str(), static_cast<int>(response_str.length()), 0);
    CLOSE_SOCKET_HANDLE(client_socket);
}

void run_daemon(quark_runtime *rt)
{
#ifdef _WIN32
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);
#endif

    SocketHandle server_fd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in address{};
    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, (const char *)&opt, sizeof(opt));

    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(DAEMON_PORT);

    bind(server_fd, (struct sockaddr *)&address, sizeof(address));
    listen(server_fd, 3);

    std::cout << "[Quark Daemon] Service online. Listening on port " << DAEMON_PORT << "..." << std::endl;

    while (true)
    {
        struct sockaddr_in client_addr{};
#ifdef _WIN32
        int addrlen = sizeof(client_addr);
        SocketHandle client_socket = accept(server_fd, (struct sockaddr *)&client_addr, &addrlen);
        if (client_socket == INVALID_SOCKET_HANDLE)
            continue;
#else
        socklen_t addrlen = sizeof(client_addr);
        SocketHandle client_socket = accept(server_fd, (struct sockaddr *)&client_addr, &addrlen);
        if (client_socket < 0)
            continue;
#endif

        std::thread(handle_connection, client_socket, rt).detach();
    }
}

#ifdef _WIN32
static std::wstring get_exe_path()
{
    wchar_t buf[MAX_PATH];
    GetModuleFileNameW(NULL, buf, MAX_PATH);
    return std::wstring(buf);
}

static bool install_autostart()
{
    std::wstring cmd = L"\"" + get_exe_path() + L"\" --daemon";
    HKEY key;
    if (RegOpenKeyExW(HKEY_CURRENT_USER,
                      L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                      0, KEY_SET_VALUE, &key) != ERROR_SUCCESS)
        return false;
    LSTATUS st = RegSetValueExW(key, L"QuarkRuntime", 0, REG_SZ,
                                (const BYTE *)cmd.c_str(),
                                (DWORD)((cmd.size() + 1) * sizeof(wchar_t)));
    RegCloseKey(key);
    return st == ERROR_SUCCESS;
}

static bool uninstall_autostart()
{
    HKEY key;
    if (RegOpenKeyExW(HKEY_CURRENT_USER,
                      L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                      0, KEY_SET_VALUE, &key) != ERROR_SUCCESS)
        return false;
    LSTATUS st = RegDeleteValueW(key, L"QuarkRuntime");
    RegCloseKey(key);
    return st == ERROR_SUCCESS || st == ERROR_FILE_NOT_FOUND;
}

static void redirect_to_log()
{
    wchar_t dir[MAX_PATH];
    if (GetEnvironmentVariableW(L"LOCALAPPDATA", dir, MAX_PATH) == 0)
        return;
    std::wstring log_dir = std::wstring(dir) + L"\\Quark";
    CreateDirectoryW(log_dir.c_str(), NULL);
    std::wstring log_path = log_dir + L"\\runtime.log";
    if (_wfreopen(log_path.c_str(), L"a", stdout) != NULL)
        _wfreopen(log_path.c_str(), L"a", stderr);
}
#else
static std::string get_exe_path()
{
    char buf[PATH_MAX];
    ssize_t n = readlink("/proc/self/exe", buf, PATH_MAX);
    if (n <= 0)
        return "runtime";
    return std::string(buf, n);
}

static bool install_autostart()
{
    const char *home = getenv("HOME");
    if (!home)
        return false;

    std::string exe = get_exe_path();
    std::string exe_dir = exe.substr(0, exe.find_last_of('/'));
    std::string unit_dir = std::string(home) + "/.config/systemd/user";
    std::string unit_path = unit_dir + "/quark-runtime.service";

    std::string mkdir_cmd = "mkdir -p \"" + unit_dir + "\"";
    system(mkdir_cmd.c_str());

    std::string unit =
        "[Unit]\n"
        "Description=Quark Runtime Daemon (Quantum JIT Service)\n"
        "After=network-online.target\n"
        "Wants=network-online.target\n"
        "\n"
        "[Service]\n"
        "Type=simple\n"
        "ExecStart=" +
        exe + " --daemon\n"
              "Environment=LD_LIBRARY_PATH=" +
        exe_dir + "\n"
                  "Restart=on-failure\n"
                  "RestartSec=3\n"
                  "\n"
                  "[Install]\n"
                  "WantedBy=default.target\n";

    FILE *f = fopen(unit_path.c_str(), "w");
    if (!f)
        return false;
    fputs(unit.c_str(), f);
    fclose(f);
    system("systemctl --user daemon-reload");
    system("systemctl --user enable quark-runtime.service");
    system("systemctl --user start quark-runtime.service");
    const char *user = getenv("USER");
    if (user)
    {
        std::string linger_cmd = std::string("loginctl enable-linger \"") + user + "\"";
        system(linger_cmd.c_str());
    }

    FILE *check = fopen(unit_path.c_str(), "r");
    if (check)
    {
        fclose(check);
        return true;
    }
    return false;
}

static bool uninstall_autostart()
{
    system("systemctl --user stop quark-runtime.service");
    system("systemctl --user disable quark-runtime.service");
    system("systemctl --user daemon-reload");

    const char *home = getenv("HOME");
    if (home)
    {
        std::string unit_path = std::string(home) + "/.config/systemd/user/quark-runtime.service";
        remove(unit_path.c_str());
    }
    return true;
}
#endif

int main(int argc, char *argv[])
{
    bool daemon_mode = false;
    for (int i = 1; i < argc; ++i)
    {
        std::string arg = argv[i];
        if (arg == "--daemon")
        {
            daemon_mode = true;
        }
        else if (arg == "--install-autostart")
        {
            bool ok = install_autostart();
            return ok ? 0 : 1;
        }
        else if (arg == "--uninstall-autostart")
        {
            bool ok = uninstall_autostart();
            return ok ? 0 : 1;
        }
    }

#ifdef _WIN32
    if (daemon_mode)
        redirect_to_log();
#endif

    std::setvbuf(stdout, NULL, _IONBF, 0);
    std::setvbuf(stderr, NULL, _IONBF, 0);

    std::cout << "[Quark JIT] Scanning network for Quantum FPGA Host..." << std::endl;

    quark_runtime *rt = quark_runtime_create();
    if (!rt)
    {
        return 1;
    }

    if (daemon_mode)
    {
        quark_runtime_viz_start(rt);
        run_daemon(rt);
        quark_runtime_viz_stop(rt);
    }
    else
    {
        std::cout << "READY" << std::endl;
        process_stream(std::cin, std::cout, rt);
    }

    quark_runtime_destroy(rt);
    return 0;
=======
#include <iostream>
#include <string>
#include <memory>
#include <sstream>
#include <vector>
#include <thread>
#include <map>
#include <mutex>
#include <filesystem>
#include <cstdint>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <cstdio>
#else
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdio>
#include <cstdlib>
#include <limits.h>
#endif

#include "../include/qhal/RuntimeApi.h"

#define DAEMON_PORT 50052
#define BUFFER_SIZE 65536

static std::map<int, quark_mmi *> g_mmi_modules;
static int g_mmi_next_id = 1;
static std::mutex g_mmi_mutex;

void process_stream(std::istream &in_stream, std::ostream &out_stream, quark_runtime *rt)
{
    std::string command;
    while (std::getline(in_stream, command))
    {
        if (command == "EXIT")
            break;

        if (command == "PING")
        {
            out_stream << "RESPONSE: PONG\n";
        }
        else if (command == "GET_SNAPSHOT")
        {
            out_stream << quark_runtime_snapshot(rt);
        }
        else if (command == "COMPILE")
        {
            std::string ir_payload;
            std::string line;

            while (std::getline(in_stream, line))
            {
                if (line == "END_COMPILE")
                    break;
                ir_payload += line + "\n";
            }

            out_stream << quark_runtime_compile(rt, ir_payload.c_str());
        }
        else if (command == "VERIFY")
        {
            std::string vc_protocol;
            std::string line;

            while (std::getline(in_stream, line))
            {
                if (line == "END_VERIFY")
                    break;
                vc_protocol += line + "\n";
            }

            out_stream << quark_runtime_verify(rt, vc_protocol.c_str());
        }
        else if (command.rfind("AOT_COMPILE ", 0) == 0)
        {
            std::stringstream cmd_ss(command);
            std::string action, arch, mode, filename;
            cmd_ss >> action >> arch >> mode >> filename;

            std::string ir_payload;
            std::string line;

            while (std::getline(in_stream, line))
            {
                if (line == "END_COMPILE")
                    break;
                ir_payload += line + "\n";
            }

            out_stream << quark_runtime_aot_compile(rt, arch.c_str(), mode.c_str(),
                                                    filename.c_str(), ir_payload.c_str());
        }
        else if (command.rfind("EXECUTE ", 0) == 0)
        {
            std::stringstream cmd_ss(command);
            std::string action, command_type, func_name;
            cmd_ss >> action >> command_type >> func_name;

            if (func_name.empty())
            {
                func_name = command_type;
                command_type = "int32";
            }

            if (command_type == "int32" || command_type == "int")
            {
                out_stream << quark_runtime_execute_int(rt, func_name.c_str());
            }
            else if (command_type == "void")
            {
                out_stream << quark_runtime_execute_void(rt, func_name.c_str());
            }
            else if (command_type == "float")
            {
                out_stream << quark_runtime_execute_float(rt, func_name.c_str());
            }
            else
            {
                out_stream << "RESPONSE: ERROR - Unsupported return type '" << command_type
                           << "' for function " << func_name << "\n";
            }
        }
        else if (command.rfind("LOAD_MMI ", 0) == 0)
        {
            std::string path = command.substr(9);
            std::lock_guard<std::mutex> lk(g_mmi_mutex);
            quark_mmi *m = quark_runtime_load_mmi(rt, path.c_str());
            if (m)
            {
                int id = g_mmi_next_id++;
                g_mmi_modules[id] = m;
                out_stream << "RESPONSE: MMI_LOADED " << id << "\n";
            }
            else
            {
                out_stream << "RESPONSE: ERROR - MMI load failed\n";
            }
        }
        else if (command.rfind("MMI_INVOKE ", 0) == 0)
        {
            std::stringstream cmd_ss(command);
            std::string action;
            int id = 0;
            std::string func_name;
            cmd_ss >> action >> id >> func_name;

            std::string args_json;
            std::getline(cmd_ss, args_json);
            size_t pos = args_json.find_first_not_of(" \t");
            args_json = (pos == std::string::npos) ? "" : args_json.substr(pos);

            std::lock_guard<std::mutex> lk(g_mmi_mutex);
            auto it = g_mmi_modules.find(id);
            if (it != g_mmi_modules.end())
            {
                out_stream << quark_runtime_mmi_invoke(it->second, func_name.c_str(), args_json.c_str());
            }
            else
            {
                out_stream << "RESPONSE: ERROR - MMI handle not found\n";
            }
        }
        else if (command.rfind("MMI_UNLOAD ", 0) == 0)
        {
            int id = std::stoi(command.substr(11));
            std::lock_guard<std::mutex> lk(g_mmi_mutex);
            auto it = g_mmi_modules.find(id);
            if (it != g_mmi_modules.end())
            {
                quark_runtime_mmi_unload(it->second);
                g_mmi_modules.erase(it);
                out_stream << "RESPONSE: MMI_UNLOADED\n";
            }
            else
            {
                out_stream << "RESPONSE: ERROR - MMI handle not found\n";
            }
        }
    }
}

// ─── 二进制协议(长度前缀 + 命令字节)──────────────────────
// 帧格式: [uint32 大端长度][payload],payload 首字节为命令。
// 相比旧的文本行协议,长度前缀消除边界歧义(IR 内容含哨兵行也不破坏),
// 命令字节消除字符串比较开销;HELLO 帧用于版本协商。
enum ProtocolCommand : uint8_t
{
    CMD_HELLO = 0x00,        // 握手: payload[1..] = "QUARK_PROTO_V1"
    CMD_COMPILE = 0x01,      // payload[1..] = LLVM IR
    CMD_EXECUTE = 0x02,      // payload[1..] = "return_type func_name"
    CMD_VERIFY = 0x03,       // payload[1..] = VC protocol
    CMD_AOT_COMPILE = 0x04,  // payload[1..] = "arch mode name\nIR"
    CMD_LOAD_MMI = 0x05,     // payload[1..] = path
    CMD_MMI_INVOKE = 0x06,   // payload[1..] = "id func_name args_json"
    CMD_MMI_UNLOAD = 0x07,   // payload[1..] = "id"
    CMD_PING = 0x08,
    CMD_GET_SNAPSHOT = 0x09,
    CMD_EXIT = 0xFF
};

static const char *kProtocolVersion = "QUARK_PROTO_V1";

// 按命令字节分发执行,结果追加到 out。
void process_command(const std::string &payload, std::string &out, quark_runtime *rt)
{
    if (payload.empty())
        return;
    uint8_t cmd = static_cast<uint8_t>(payload[0]);
    const std::string body = payload.substr(1);

    switch (cmd)
    {
    case CMD_PING:
        out += "RESPONSE: PONG\n";
        break;
    case CMD_GET_SNAPSHOT:
        out += quark_runtime_snapshot(rt);
        break;
    case CMD_COMPILE:
        out += quark_runtime_compile(rt, body.c_str());
        break;
    case CMD_VERIFY:
        out += quark_runtime_verify(rt, body.c_str());
        break;
    case CMD_AOT_COMPILE:
    {
        size_t nl = body.find('\n');
        std::string head = (nl == std::string::npos) ? body : body.substr(0, nl);
        std::string ir = (nl == std::string::npos) ? std::string() : body.substr(nl + 1);
        std::stringstream ss(head);
        std::string arch, mode, filename;
        ss >> arch >> mode >> filename;
        out += quark_runtime_aot_compile(rt, arch.c_str(), mode.c_str(), filename.c_str(), ir.c_str());
        break;
    }
    case CMD_EXECUTE:
    {
        std::stringstream ss(body);
        std::string ret_type, func_name;
        ss >> ret_type >> func_name;
        if (func_name.empty())
        {
            func_name = ret_type;
            ret_type = "int32";
        }
        if (ret_type == "int32" || ret_type == "int")
            out += quark_runtime_execute_int(rt, func_name.c_str());
        else if (ret_type == "void")
            out += quark_runtime_execute_void(rt, func_name.c_str());
        else if (ret_type == "float")
            out += quark_runtime_execute_float(rt, func_name.c_str());
        else
            out += "RESPONSE: ERROR - Unsupported return type '" + ret_type + "' for function " + func_name + "\n";
        break;
    }
    case CMD_LOAD_MMI:
    {
        std::lock_guard<std::mutex> lk(g_mmi_mutex);
        quark_mmi *m = quark_runtime_load_mmi(rt, body.c_str());
        if (m)
        {
            int id = g_mmi_next_id++;
            g_mmi_modules[id] = m;
            out += "RESPONSE: MMI_LOADED " + std::to_string(id) + "\n";
        }
        else
        {
            out += "RESPONSE: ERROR - MMI load failed\n";
        }
        break;
    }
    case CMD_MMI_INVOKE:
    {
        std::stringstream ss(body);
        int id = 0;
        std::string func_name;
        ss >> id >> func_name;
        std::string args_json;
        std::getline(ss, args_json);
        size_t pos = args_json.find_first_not_of(" \t");
        args_json = (pos == std::string::npos) ? std::string() : args_json.substr(pos);
        std::lock_guard<std::mutex> lk(g_mmi_mutex);
        auto it = g_mmi_modules.find(id);
        if (it != g_mmi_modules.end())
            out += quark_runtime_mmi_invoke(it->second, func_name.c_str(), args_json.c_str());
        else
            out += "RESPONSE: ERROR - MMI handle not found\n";
        break;
    }
    case CMD_MMI_UNLOAD:
    {
        int id = std::stoi(body);
        std::lock_guard<std::mutex> lk(g_mmi_mutex);
        auto it = g_mmi_modules.find(id);
        if (it != g_mmi_modules.end())
        {
            quark_runtime_mmi_unload(it->second);
            g_mmi_modules.erase(it);
            out += "RESPONSE: MMI_UNLOADED\n";
        }
        else
        {
            out += "RESPONSE: ERROR - MMI handle not found\n";
        }
        break;
    }
    default:
        out += "RESPONSE: ERROR - Unknown command 0x" + std::to_string(static_cast<int>(cmd)) + "\n";
        break;
    }
}

#ifdef _WIN32
typedef SOCKET SocketHandle;
#define INVALID_SOCKET_HANDLE INVALID_SOCKET
#define CLOSE_SOCKET_HANDLE(s) closesocket(s)
#else
typedef int SocketHandle;
#define INVALID_SOCKET_HANDLE (-1)
#define CLOSE_SOCKET_HANDLE(s) close(s)
#endif

// 读满 n 字节(处理 TCP 分片)
static bool read_exact(SocketHandle sock, void *buf, size_t n)
{
    char *p = static_cast<char *>(buf);
    size_t got = 0;
    while (got < n)
    {
        int r = recv(sock, p + got, static_cast<int>(n - got), 0);
        if (r <= 0)
            return false;
        got += static_cast<size_t>(r);
    }
    return true;
}

// 读一帧(4 字节大端长度 + payload)
static bool read_frame(SocketHandle sock, std::string &payload)
{
    uint8_t lenbuf[4];
    if (!read_exact(sock, lenbuf, 4))
        return false;
    uint32_t len = (static_cast<uint32_t>(lenbuf[0]) << 24) |
                   (static_cast<uint32_t>(lenbuf[1]) << 16) |
                   (static_cast<uint32_t>(lenbuf[2]) << 8) |
                   static_cast<uint32_t>(lenbuf[3]);
    if (len > 64u * 1024u * 1024u) // 防御:单帧最大 64MB
        return false;
    payload.resize(len);
    if (len > 0 && !read_exact(sock, payload.data(), len))
        return false;
    return true;
}

// 写一帧(4 字节大端长度 + payload)
static bool write_frame(SocketHandle sock, const std::string &payload)
{
    uint32_t len = static_cast<uint32_t>(payload.size());
    uint8_t lenbuf[4] = {
        static_cast<uint8_t>((len >> 24) & 0xFF),
        static_cast<uint8_t>((len >> 16) & 0xFF),
        static_cast<uint8_t>((len >> 8) & 0xFF),
        static_cast<uint8_t>(len & 0xFF)};

    size_t sent = 0;
    while (sent < 4)
    {
        int r = send(sock, reinterpret_cast<const char *>(lenbuf) + sent,
                     4 - static_cast<int>(sent), 0);
        if (r <= 0)
            return false;
        sent += static_cast<size_t>(r);
    }
    sent = 0;
    while (sent < payload.size())
    {
        int r = send(sock, payload.data() + sent,
                     static_cast<int>(payload.size() - sent), 0);
        if (r <= 0)
            return false;
        sent += static_cast<size_t>(r);
    }
    return true;
}

void handle_connection(SocketHandle client_socket, quark_runtime *rt)
{
    std::string frame;
    std::string response;

    while (read_frame(client_socket, frame))
    {
        if (frame.empty())
            break;
        uint8_t cmd = static_cast<uint8_t>(frame[0]);
        if (cmd == CMD_EXIT)
            break;

        // 握手:校验版本(向后兼容:未发送 HELLO 也继续处理)
        if (cmd == CMD_HELLO)
        {
            if (frame.substr(1) != kProtocolVersion)
            {
                write_frame(client_socket, "PROTO_ERR: version mismatch");
                CLOSE_SOCKET_HANDLE(client_socket);
                return;
            }
            continue;
        }

        try
        {
            process_command(frame, response, rt);
        }
        catch (const std::exception &e)
        {
            response += std::string("[QHAL ERROR] ") + e.what() + "\n";
        }
    }

    if (!response.empty())
        write_frame(client_socket, response);
    CLOSE_SOCKET_HANDLE(client_socket);
}

void run_daemon(quark_runtime *rt)
{
#ifdef _WIN32
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);
#endif

    SocketHandle server_fd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in address{};
    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, (const char *)&opt, sizeof(opt));

    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(DAEMON_PORT);

    bind(server_fd, (struct sockaddr *)&address, sizeof(address));
    listen(server_fd, 3);

    std::cout << "[Quark Daemon] Service online. Listening on port " << DAEMON_PORT << "..." << std::endl;

    while (true)
    {
        struct sockaddr_in client_addr{};
#ifdef _WIN32
        int addrlen = sizeof(client_addr);
        SocketHandle client_socket = accept(server_fd, (struct sockaddr *)&client_addr, &addrlen);
        if (client_socket == INVALID_SOCKET_HANDLE)
            continue;
#else
        socklen_t addrlen = sizeof(client_addr);
        SocketHandle client_socket = accept(server_fd, (struct sockaddr *)&client_addr, &addrlen);
        if (client_socket < 0)
            continue;
#endif

        std::thread(handle_connection, client_socket, rt).detach();
    }
}

#ifdef _WIN32
static std::wstring get_exe_path()
{
    wchar_t buf[MAX_PATH];
    GetModuleFileNameW(NULL, buf, MAX_PATH);
    return std::wstring(buf);
}

static bool install_autostart()
{
    std::wstring cmd = L"\"" + get_exe_path() + L"\" --daemon";
    HKEY key;
    if (RegOpenKeyExW(HKEY_CURRENT_USER,
                      L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                      0, KEY_SET_VALUE, &key) != ERROR_SUCCESS)
        return false;
    LSTATUS st = RegSetValueExW(key, L"QuarkRuntime", 0, REG_SZ,
                                (const BYTE *)cmd.c_str(),
                                (DWORD)((cmd.size() + 1) * sizeof(wchar_t)));
    RegCloseKey(key);
    return st == ERROR_SUCCESS;
}

static bool uninstall_autostart()
{
    HKEY key;
    if (RegOpenKeyExW(HKEY_CURRENT_USER,
                      L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                      0, KEY_SET_VALUE, &key) != ERROR_SUCCESS)
        return false;
    LSTATUS st = RegDeleteValueW(key, L"QuarkRuntime");
    RegCloseKey(key);
    return st == ERROR_SUCCESS || st == ERROR_FILE_NOT_FOUND;
}

static void redirect_to_log()
{
    wchar_t dir[MAX_PATH];
    if (GetEnvironmentVariableW(L"LOCALAPPDATA", dir, MAX_PATH) == 0)
        return;
    std::wstring log_dir = std::wstring(dir) + L"\\Quark";
    CreateDirectoryW(log_dir.c_str(), NULL);
    std::wstring log_path = log_dir + L"\\runtime.log";
    if (_wfreopen(log_path.c_str(), L"a", stdout) != NULL)
        _wfreopen(log_path.c_str(), L"a", stderr);
}
#else
static std::string get_exe_path()
{
    char buf[PATH_MAX];
    ssize_t n = readlink("/proc/self/exe", buf, PATH_MAX);
    if (n <= 0)
        return "runtime";
    return std::string(buf, n);
}

static bool run_command(const std::vector<std::string> &args)
{
    if (args.empty())
        return false;
    pid_t pid = fork();
    if (pid == 0)
    {
        std::vector<char *> argv;
        argv.reserve(args.size() + 1);
        for (const auto &a : args)
            argv.push_back(const_cast<char *>(a.c_str()));
        argv.push_back(nullptr);
        execvp(argv[0], argv.data());
        _exit(127); // exec 失败
    }
    if (pid < 0)
        return false;
    int status = 0;
    waitpid(pid, &status, 0);
    return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

static bool install_autostart()
{
    const char *home = getenv("HOME");
    if (!home)
        return false;

    std::string exe = get_exe_path();
    std::string exe_dir = exe.substr(0, exe.find_last_of('/'));
    std::string unit_dir = std::string(home) + "/.config/systemd/user";
    std::string unit_path = unit_dir + "/quark-runtime.service";
    std::error_code ec;
    std::filesystem::create_directories(unit_dir, ec);
    if (ec)
        return false;

    std::string unit =
        "[Unit]\n"
        "Description=Quark Runtime Daemon (Quantum JIT Service)\n"
        "After=network-online.target\n"
        "Wants=network-online.target\n"
        "\n"
        "[Service]\n"
        "Type=simple\n"
        "ExecStart=" +
        exe + " --daemon\n"
              "Environment=LD_LIBRARY_PATH=" +
        exe_dir + "\n"
                  "Restart=on-failure\n"
                  "RestartSec=3\n"
                  "\n"
                  "[Install]\n"
                  "WantedBy=default.target\n";

    FILE *f = fopen(unit_path.c_str(), "w");
    if (!f)
        return false;
    fputs(unit.c_str(), f);
    fclose(f);
    run_command({"systemctl", "--user", "daemon-reload"});
    run_command({"systemctl", "--user", "enable", "quark-runtime.service"});
    run_command({"systemctl", "--user", "start", "quark-runtime.service"});
    const char *user = getenv("USER");
    if (user)
    {
        run_command({"loginctl", "enable-linger", user});
    }

    FILE *check = fopen(unit_path.c_str(), "r");
    if (check)
    {
        fclose(check);
        return true;
    }
    return false;
}

static bool uninstall_autostart()
{
    run_command({"systemctl", "--user", "stop", "quark-runtime.service"});
    run_command({"systemctl", "--user", "disable", "quark-runtime.service"});
    run_command({"systemctl", "--user", "daemon-reload"});

    const char *home = getenv("HOME");
    if (home)
    {
        std::string unit_path = std::string(home) + "/.config/systemd/user/quark-runtime.service";
        remove(unit_path.c_str());
    }
    return true;
}
#endif

int main(int argc, char *argv[])
{
    bool daemon_mode = false;
    for (int i = 1; i < argc; ++i)
    {
        std::string arg = argv[i];
        if (arg == "--daemon")
        {
            daemon_mode = true;
        }
        else if (arg == "--install-autostart")
        {
            bool ok = install_autostart();
            return ok ? 0 : 1;
        }
        else if (arg == "--uninstall-autostart")
        {
            bool ok = uninstall_autostart();
            return ok ? 0 : 1;
        }
    }

#ifdef _WIN32
    if (daemon_mode)
        redirect_to_log();
#endif

    std::setvbuf(stdout, NULL, _IONBF, 0);
    std::setvbuf(stderr, NULL, _IONBF, 0);

    std::cout << "[Quark JIT] Scanning network for Quantum FPGA Host..." << std::endl;

    quark_runtime *rt = quark_runtime_create();
    if (!rt)
    {
        return 1;
    }

    if (daemon_mode)
    {
        quark_runtime_viz_start(rt);
        run_daemon(rt);
        quark_runtime_viz_stop(rt);
    }
    else
    {
        std::cout << "READY" << std::endl;
        process_stream(std::cin, std::cout, rt);
    }

    quark_runtime_destroy(rt);
    return 0;
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}