#pragma once
#include <thread>
#include <atomic>
#include <mutex>
#include <string>
#include "../protocol.hpp"

namespace qgui {

// Background polling client that repeatedly issues GET_SNAPSHOT requests to the
// Quark daemon over a short-lived TCP connection and caches the latest snapshot
// for the render thread.
class DaemonClient {
public:
    DaemonClient() = default;
    ~DaemonClient() { stop(); }

    DaemonClient(const DaemonClient&) = delete;
    DaemonClient& operator=(const DaemonClient&) = delete;

    void start(const std::string& host, int port);
    void stop();

    StateSnapshot snapshot() {
        std::lock_guard<std::mutex> lock(mutex_);
        return snapshot_;
    }

    bool connected() const { return connected_.load(); }
    uint64_t generation() const { return generation_.load(); }

private:
    void run(const std::string& host, int port);

    std::thread worker_;
    std::atomic<bool> running_{false};
    std::atomic<bool> connected_{false};
    std::atomic<uint64_t> generation_{0};
    std::mutex mutex_;
    StateSnapshot snapshot_;
};

} // namespace qgui
