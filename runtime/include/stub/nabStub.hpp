#pragma once

#include <vector>
#include <map>
#include <cstddef>
#include <cmath>
#include <iostream>

// 量子硬件分发接口（SLM / AOD 光镊）。
// 默认实现为「软件仿真」：真实硬件未接入时，把下发内容记录到可查询的
// 状态（SLM 帧缓冲 / 光镊深度表）并做相位范围校验，供单元测试与离线验证，
// 而非静默忽略。具体后端（如 NeutralAtomBackend）可 override 接入真实硬件驱动。

namespace Stub {
    class Dispatch {
    public:
        virtual ~Dispatch() = default;

        // 软件仿真状态（可被单元测试查询，验证下发内容）。
        //   last_slm_frame[y][x] = 像素相位（弧度，[0, 2π)）
        //   tweezer_depths[id]    = 该 qubit 光镊阱深（累加）
        std::vector<std::vector<double>> last_slm_frame;
        std::map<size_t, double> tweezer_depths;

        // 将相位掩码下发到 SLM 硬件（软件仿真：记录 + 校验）。
        virtual void dispatch_buffer_to_slm_hardware(const std::vector<std::vector<double>>& phase_mask) {
            last_slm_frame = phase_mask;

            // 相位范围校验：超出 [0, 2π) 的像素计数并告警（硬件帧缓冲会 wrap）。
            constexpr double kTwoPi = 6.283185307179586;
            size_t out_of_range = 0;
            for (const auto& row : phase_mask)
                for (double p : row)
                    if (!(p >= 0.0 && p < kTwoPi))
                        ++out_of_range;

            const size_t h = phase_mask.size();
            const size_t w = phase_mask.empty() ? 0 : phase_mask[0].size();
            std::cout << "[Stub::Dispatch] SLM frame captured (software simulation): "
                      << w << "x" << h;
            if (out_of_range)
                std::cerr << "  [warn] " << out_of_range << " pixel(s) phase out of [0, 2pi)";
            std::cout << "\n";
        }

        // 增大指定 qubit 的光镊阱深（软件仿真：累加记录）。
        virtual void increase_tweezer_depth(size_t qubit_id) {
            tweezer_depths[qubit_id] += 1.0;
        }
    };
}
