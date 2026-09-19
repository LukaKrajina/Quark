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
        // 精确 Z 门。默认用 Z = H·X·H（无全局相位）；
        // 维护态矢量的后端（如 QVM）应重写为直接相位翻转以获得更高效率。
        virtual void apply_z(size_t qubit_id)
        {
            apply_h(qubit_id);
            apply_x(qubit_id);
            apply_h(qubit_id);
        }
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

        // ─── 受控门（可逆编织 @[steer] 的运行时实现，用基础门分解到全局相位）───
        // 受控 Rz：CRz(θ) = Rz(θ/2)[t] · CNOT(c,t) · Rz(-θ/2)[t] · CNOT(c,t)
        virtual void apply_crz(size_t control, size_t target, double angle)
        {
            apply_rz(target, angle / 2.0);
            apply_cnot(control, target);
            apply_rz(target, -angle / 2.0);
            apply_cnot(control, target);
        }
        // 受控 H：H = Rz(π/2)·Rx(π/2)·Rz(π/2)，CH = CRz(π/2)·(H·CRz(π/2)·H)·CRz(π/2)
        virtual void apply_ch(size_t control, size_t target)
        {
            apply_crz(control, target, M_PI / 2.0);
            apply_h(target);
            apply_crz(control, target, M_PI / 2.0);
            apply_h(target);
            apply_crz(control, target, M_PI / 2.0);
        }
        // 受控 X（控制位导引 X）= CNOT；受控 CNOT = Toffoli
        virtual void apply_cx(size_t control, size_t target)
        {
            apply_cnot(control, target);
        }
        // 受控 swap（Fredkin）：CSWAP = CNOT(b,a) · Toffoli(c,a,b) · CNOT(b,a)
        virtual void apply_cswap(size_t control, size_t a, size_t b)
        {
            if (a == b)
                return;
            apply_cnot(b, a);
            apply_toffoli(control, a, b);
            apply_cnot(b, a);
        }
        // 受控 Toffoli（C³X）：无 ancilla 分解（Qiskit C3XGate 相对相位版本）。
        // c 为额外控制位，a/b 为原 Toffoli 控制位，t 为目标。
        virtual void apply_c_toffoli(size_t c, size_t a, size_t b, size_t t)
        {
            apply_h(t);
            apply_rz(t, M_PI / 8.0);
            apply_cnot(c, t);
            apply_rz(t, -M_PI / 8.0);
            apply_h(t);
            apply_toffoli(a, b, t);
            apply_rz(t, -M_PI / 8.0);
            apply_cnot(c, t);
            apply_rz(t, M_PI / 8.0);
            apply_h(t);
            apply_toffoli(a, b, t);
            apply_rz(t, M_PI / 8.0);
            apply_cnot(c, t);
            apply_rz(t, -M_PI / 8.0);
            apply_h(t);
            apply_toffoli(a, b, t);
        }

        // ─── 噪声通道注入（@[noise]/@[coherence] 元数据 → 运行时）──────────
        // channel: 0=depolarizing, 1=dephasing(phase_flip), 2=amplitude_damping, 3=bit_flip
        // param：噪声强度（depolarizing/dephasing/bit_flip 为概率 p，amplitude_damping 为 γ）。
        // 默认空实现；维护态矢量的后端（QVM 等）应重写为对应的噪声通道。
        virtual void apply_noise(size_t qubit_id, int channel, double param)
        {
            (void)qubit_id;
            (void)channel;
            (void)param;
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

        // 逆 QFT（iQFT）：QFT 的门序反转 + 角度取负（可逆对偶 U†）。
        virtual void apply_iqft(size_t lo, size_t hi)
        {
            for (int i = static_cast<int>(lo); i <= static_cast<int>(hi); ++i)
            {
                for (int j = i - 1; j >= static_cast<int>(lo); --j)
                {
                    double theta = 2.0 * M_PI / std::pow(2.0, i - j + 1);
                    // CRz†(i, j, θ) = CNOT(i,j)·Rz(j,θ/2)·CNOT(i,j)·Rz(j,-θ/2)
                    apply_cnot(static_cast<size_t>(i), static_cast<size_t>(j));
                    apply_rz(static_cast<size_t>(j), theta / 2.0);
                    apply_cnot(static_cast<size_t>(i), static_cast<size_t>(j));
                    apply_rz(static_cast<size_t>(j), -theta / 2.0);
                }
                apply_h(static_cast<size_t>(i));
            }
        }

        // 受控 QFT（cqft）：整个 QFT 受 control 导引。
        //   H(i) → ch(control, i)
        //   CRz(i,j,θ) → ccrz(control,i,j,θ) = Rz(j,θ/2)·Toffoli(control,i,j)·Rz(j,-θ/2)·Toffoli(control,i,j)
        virtual void apply_cqft(size_t control, size_t lo, size_t hi)
        {
            for (int i = static_cast<int>(hi); i >= static_cast<int>(lo); --i)
            {
                apply_ch(control, static_cast<size_t>(i));
                for (int j = static_cast<int>(lo); j < i; ++j)
                {
                    double theta = 2.0 * M_PI / std::pow(2.0, i - j + 1);
                    apply_rz(static_cast<size_t>(j), theta / 2.0);
                    apply_toffoli(control, static_cast<size_t>(i), static_cast<size_t>(j));
                    apply_rz(static_cast<size_t>(j), -theta / 2.0);
                    apply_toffoli(control, static_cast<size_t>(i), static_cast<size_t>(j));
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

        // 受控 braid（c_braid）：默认 = 受控 swap（Fredkin），与 braid 默认 = swap 一致。
        // 维护精确 Yang-Baxter √SWAP 的后端（如 QVM）应重写为受控 √SWAP。
        virtual void apply_cbraid(size_t control, size_t a, size_t b)
        {
            apply_cswap(control, a, b);
        }

        // 读取当前态向量（计算基振幅）与量子比特数。
        // 用于可视化服务（qvm_visualizer）实时反映 qk 代码的执行状态。
        // 默认返回空；维护态矢量的后端（如 QVM）应重写。
        virtual std::vector<std::complex<double>> get_state_vector() const { return {}; }
        virtual size_t get_num_qubits() const { return 0; }
    };
}