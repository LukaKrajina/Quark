#pragma once
#include <vector>
#include <string>
#include <mutex>

namespace qhal {
    struct GateEvent
    {
        std::string gate_name;
        int target_qubit;
        int control_qubit;
        int step_index;
    };
    
    class CircuitTelemetry {
    private:
        std::vector<GateEvent> event_log;
        std::mutex log_mutex;
        int current_step = 0;

    public:
        static CircuitTelemetry& get_instance() {
            static CircuitTelemetry instance;
            return instance;
        }

        void log_gate(const std::string& name, int target, int control = -1) {
            std::lock_guard<std::mutex> lock(log_mutex);
            event_log.push_back({name, target, control, current_step++});
        }

        std::vector<GateEvent> get_log() {
            std::lock_guard<std::mutex> lock(log_mutex);
            return event_log;
        }
        
        void clear() {
            std::lock_guard<std::mutex> lock(log_mutex);
            event_log.clear();
            current_step = 0;
        }
    };
}