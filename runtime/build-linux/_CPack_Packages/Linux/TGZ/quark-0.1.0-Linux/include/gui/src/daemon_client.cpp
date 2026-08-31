#include "daemon_client.h"
#include <chrono>
#include <cstring>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#else
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#endif

namespace qgui {

static bool fetch_snapshot(const std::string& host, int port, StateSnapshot& out) {
#ifdef _WIN32
    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) return false;
#else
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) return false;
#endif

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<unsigned short>(port));
    inet_pton(AF_INET, host.c_str(), &addr.sin_addr);

#ifdef _WIN32
    if (connect(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        closesocket(sock);
        return false;
    }
    DWORD timeout = 2000;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeout), sizeof(timeout));
#else
    if (connect(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        close(sock);
        return false;
    }
    timeval tv{2, 0};
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const void*>(&tv), sizeof(tv));
#endif

    const char* request = "GET_SNAPSHOT\nEXIT\n";
    send(sock, request, static_cast<int>(strlen(request)), 0);

    std::string data;
    char buf[4096];
    int n;
    while ((n = recv(sock, buf, sizeof(buf) - 1, 0)) > 0) {
        buf[n] = '\0';
        data += buf;
        if (data.find("END_SNAPSHOT") != std::string::npos) break;
    }

#ifdef _WIN32
    closesocket(sock);
#else
    close(sock);
#endif

    return deserialize(data, out);
}

void DaemonClient::run(const std::string& host, int port) {
#ifdef _WIN32
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);
#endif

    while (running_) {
        StateSnapshot snap;
        if (fetch_snapshot(host, port, snap)) {
            connected_ = true;
            uint64_t gen = snap.generation;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                snapshot_ = std::move(snap);
            }
            generation_ = gen;
        } else {
            connected_ = false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

#ifdef _WIN32
    WSACleanup();
#endif
}

void DaemonClient::start(const std::string& host, int port) {
    if (running_.exchange(true)) return;
    worker_ = std::thread([this, host, port] { run(host, port); });
}

void DaemonClient::stop() {
    running_ = false;
    if (worker_.joinable()) worker_.join();
}

} // namespace qgui
