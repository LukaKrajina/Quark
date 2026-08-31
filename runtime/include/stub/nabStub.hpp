<<<<<<< HEAD
#pragma once

#include <vector>
#include <cstddef>
#include <iostream>

namespace Stub {
    // 量子硬件分发接口（SLM / AOD 光镊）。
    // 默认实现为安全的 no-op 降级：真实硬件未接入时被静默忽略并打印提示。
    // 具体后端（如 NeutralAtomBackend）可 override 接入真实硬件驱动。
    class Dispatch {
    public:
        virtual ~Dispatch() = default;

        // 将相位掩码下发到 SLM 硬件。phase_mask[y][x] 为像素相位（弧度）。
        virtual void dispatch_buffer_to_slm_hardware(const std::vector<std::vector<double>>& phase_mask) {
            (void)phase_mask;
            std::cout << "[Stub::Dispatch] SLM dispatch ignored (no hardware attached).\n";
        }

        // 增大指定 qubit 的光镊阱深（荧光读出阶段）。
        virtual void increase_tweezer_depth(size_t qubit_id) {
            (void)qubit_id;
            std::cout << "[Stub::Dispatch] Tweezer depth increase ignored (no hardware attached).\n";
        }
    };
}
=======
#pragma once

#include <vector>
#include <cstddef>
#include <iostream>

// 量子硬件分发接口（SLM / AOD 光镊）。
// 默认实现为安全的 no-op 降级：真实硬件未接入时被静默忽略并打印提示。
// 具体后端（如 NeutralAtomBackend）可 override 接入真实硬件驱动。

namespace Stub {
    class Dispatch {
    public:
        virtual ~Dispatch() = default;

        // 将相位掩码下发到 SLM 硬件。phase_mask[y][x] 为像素相位（弧度）。
        virtual void dispatch_buffer_to_slm_hardware(const std::vector<std::vector<double>>& phase_mask) {
            (void)phase_mask;
            std::cout << "[Stub::Dispatch] SLM dispatch ignored (no hardware attached).\n";
        }

        // 增大指定 qubit 的光镊阱深（荧光读出阶段）。
        virtual void increase_tweezer_depth(size_t qubit_id) {
            (void)qubit_id;
            std::cout << "[Stub::Dispatch] Tweezer depth increase ignored (no hardware attached).\n";
        }
    };
}
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
