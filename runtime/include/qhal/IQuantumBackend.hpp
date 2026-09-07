#pragma once
#include <cstddef>
#include <vector>
#include <string>
#include <complex>

#ifndef _USE_MATH_DEFINES
#define _USE_MATH_DEFINES
#endif
#include <cmath>

#include "Export.hpp"

namespace qhal
{

    class QUARK_RT_API IQuantumBackend
    {
    public:
        virtual ~IQuantumBackend() = default;
        virtual void allocate_qubits(size_t num_qubits) = 0;
        virtual void release_qubit(size_t qubit_id) = 0;
        virtual void lock_hardware_id(size_t qubit_id) = 0;
        virtual void unlock_hardware_id(size_t qubit_id) = 0;
        virtual int measure(size_t qubit_id) = 0;

        // 非破坏 Z 期望 ⟨Z⟩ = P(0) - P(1) ∈ [-1, 1]。
        // 默认实现用单次坍缩近似（2*measure-1），会破坏态；
        // 维护态矢量的后端（如 QVM）应重写为真正的非破坏测量。
        // 用于「离散/连续双通道」中的连续期望通道（流匹配软信号）。
        virtual double expectation_z(size_t qubit_id)
        {
            return 2.0 * measure(qubit_id) - 1.0;
        }

        virtual void apply_h(size_t qubit_id) {}
        virtual void apply_x(size_t qubit_id) = 0;
        virtual void apply_rz(size_t qubit_id, double angle) = 0;
        virtual void apply_cnot(size_t control, size_t target) = 0;
        virtual void apply_toffoli(size_t control1, size_t control2, size_t target) = 0;
        virtual void apply_swap(size_t a, size_t b)
        {
            if (a == b)
                return;
            apply_cnot(a, b);
            apply_cnot(b, a);
            apply_cnot(a, b);
        }

        virtual void apply_qft(size_t lo, size_t hi)
        {
            for (int i = static_cast<int>(hi); i >= static_cast<int>(lo); --i)
            {
                apply_h(static_cast<size_t>(i));
                for (int j = static_cast<int>(lo); j < i; ++j)
                {
                    double theta = 2.0 * M_PI / std::pow(2.0, i - j + 1);
                    apply_rz(static_cast<size_t>(j), theta / 2.0);
                    apply_cnot(static_cast<size_t>(i), static_cast<size_t>(j));
                    apply_rz(static_cast<size_t>(j), -theta / 2.0);
                    apply_cnot(static_cast<size_t>(i), static_cast<size_t>(j));
                }
            }
        }

        virtual int measure_basis(size_t qubit_id, char basis)
        {
            if (basis == 'X' || basis == 'x')
                apply_h(qubit_id);
            else if (basis == 'Y' || basis == 'y')
            {
                apply_rz(qubit_id, M_PI / 2.0);
                apply_h(qubit_id);
            }
            return measure(qubit_id);
        }

        // 任意基构建：把 |0⟩ 旋转到布洛赫方向 (θ, φ) 的 + 本征态
        //   |b₀⟩ = cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩
        // θ ∈ [0, π] 为极角，φ ∈ [0, 2π) 为方位角。
        // 标准基特例：Z 基 = (0,0)；X 基 = (π/2,0)；Y 基 = (π/2,π/2)。
        //
        // 默认实现用门分解（差一个全局相位，物理可观测等价）：
        //   |b₀⟩ = Rz(φ)·Ry(θ)|0⟩，Ry(θ) = Rz(π/2)·H·Rz(θ)·H·Rz(-π/2)。
        // 维护态矢量的后端（如 QVM）应重写为精确的 2×2 酉矩阵实现。
        virtual void apply_basis(size_t qubit_id, double theta, double phi)
        {
            apply_rz(qubit_id, -M_PI / 2.0);
            apply_h(qubit_id);
            apply_rz(qubit_id, theta);
            apply_h(qubit_id);
            apply_rz(qubit_id, M_PI / 2.0);
            apply_rz(qubit_id, phi);
        }

        virtual void apply_braid(size_t a, size_t b)
        {
            apply_swap(a, b);
        }

        // 读取当前态向量（计算基振幅）与量子比特数。
        // 用于可视化服务（qvm_visualizer）实时反映 qk 代码的执行状态。
        // 默认返回空；维护态矢量的后端（如 QVM）应重写。
        virtual std::vector<std::complex<double>> get_state_vector() const { return {}; }
        virtual size_t get_num_qubits() const { return 0; }
    };
}