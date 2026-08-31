#include <string>
#include <iostream>
#include "app.h"

#define DAEMON_HOST "127.0.0.1"
#define DAEMON_PORT 50052

int main() {
    qgui::App app;
    if (!app.init("Quark QVM Visualizer", 1280, 1080, DAEMON_HOST, DAEMON_PORT)) {
        std::cerr << "[GUI] Failed to initialize visualizer\n";
        return -1;
    }
    app.run();
    app.shutdown();
    return 0;
}
