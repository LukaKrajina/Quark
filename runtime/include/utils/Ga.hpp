#pragma once
#include <vector>
#include <complex>
#include <memory>
#include <stdexcept>
#include <thread>
#include <iostream>

#ifdef __AVX512F__
#include <immintrin.h>
#endif

#include "Kokkos_Core.hpp"
#include "NuclearNorm.hpp"
#include "../qhal/GpuBackend.hpp"

namespace ga
{
    namespace cpu
    {
        template <typename T>
        class AlignedAllocator
        {
        public:
            using value_type = T;
            AlignedAllocator() = default;
            template <typename U>
            constexpr AlignedAllocator(const AlignedAllocator<U> &) noexcept {}

            T *allocate(std::size_t n)
            {
                void *ptr = nullptr;
                size_t alignment = 64;
                size_t size = n * sizeof(T);
#if defined(_MSC_VER) || defined(__MINGW32__)
                ptr = _aligned_malloc(size, alignment);
#else
                if (posix_memalign(&ptr, alignment, size) != 0)
                    throw std::bad_alloc();
#endif
                if (!ptr)
                    throw std::bad_alloc();
                return static_cast<T *>(ptr);
            }

            void deallocate(T *p, std::size_t) noexcept
            {
#if defined(_MSC_VER) || defined(__MINGW32__)
                _aligned_free(p);
#else
                free(p);
#endif
            }
        };

        struct NUMAContext
        {
            static void pin_thread_to_core(std::thread &t, int core_id)
            {
                // Android bionic 无 pthread_setaffinity_np（glibc 特有），移动端跳过亲和性设置。
#if defined(__linux__) && !defined(__ANDROID__)
                cpu_set_t cpuset;
                CPU_ZERO(&cpuset);
                CPU_SET(core_id, &cpuset);
                pthread_setaffinity_np(t.native_handle(), sizeof(cpu_set_t), &cpuset);
#endif
            }

            template <typename T>
            static void first_touch_initialization(std::vector<T, AlignedAllocator<T>> &state_vector)
            {
                size_t size = state_vector.size();
#pragma omp parallel for schedule(static)
                for (size_t i = 0; i < size; ++i)
                {
                    state_vector[i] = T(0);
                }
            }
        };
    }

    namespace simd
    {
        class VectorEngine
        {
        public:
            static void apply_fma_rotation(
                std::complex<float> *__restrict state,
                size_t length,
                float cos_theta,
                float sin_theta)
            {
#if defined(QUARK_SIMD_AVX512)
                __m512 v_cos = _mm512_set1_ps(cos_theta);
                __m512 v_sin = _mm512_set1_ps(sin_theta);
                for (size_t i = 0; i < length * 2; i += 16)
                {
                    _mm_prefetch(reinterpret_cast<const char *>(&state[i + 32]), _MM_HINT_T0);
                    __m512 v_state = _mm512_load_ps(reinterpret_cast<float *>(&state[i]));
                    __m512 v_state_swapped = _mm512_permute_ps(v_state, _MM_SHUFFLE(2, 3, 0, 1));
                    __m512 v_res1 = _mm512_mul_ps(v_state, v_cos);
                    __m512 v_final = _mm512_fmadd_ps(v_state_swapped, v_sin, v_res1);
                    _mm512_store_ps(reinterpret_cast<float *>(&state[i]), v_final);
                }
#elif defined(QUARK_SIMD_LASX) || defined(QUARK_SIMD_LSX)
                // 龙芯 LSX（128 位）/ LASX（256 位）向量扩展：
                // 手写 intrinsic 内核（__lsx_vfmadd_s / __lasx_vfmadd_ps）尚未落地，
                // 且无法在本机（x86）验证，故不引入未经验证的 intrinsic。
                // 改用 OpenMP SIMD 提示，由编译器按目标架构自动向量化 —— 正确性
                // 与标量一致，且在支持 LSX/LASX 的龙芯上可获得向量加速。
#pragma omp simd
                for (size_t i = 0; i < length; ++i)
                {
                    std::complex<float> val = state[i];
                    state[i] = std::complex<float>(
                        val.real() * cos_theta - val.imag() * sin_theta,
                        val.real() * sin_theta + val.imag() * cos_theta);
                }
#else
                for (size_t i = 0; i < length; ++i)
                {
                    std::complex<float> val = state[i];
                    state[i] = std::complex<float>(
                        val.real() * cos_theta - val.imag() * sin_theta,
                        val.real() * sin_theta + val.imag() * cos_theta);
                }
#endif
            }
        };
    }

    namespace gpu
    {
        using Complex64 = Kokkos::complex<double>;
        using View1D = Kokkos::View<Complex64 *>;
        using View2D = Kokkos::View<Complex64 **>;

        struct DiaQLayout
        {
            Kokkos::View<int *> active_diagonals;
            Kokkos::View<Complex64 *> matrix_data;
            size_t matrix_size;
            size_t num_diagonals;

            void optimize_for_spgemm(const std::vector<std::vector<std::complex<double>>> &dense_matrix)
            {
                matrix_size = dense_matrix.size();
                int n = static_cast<int>(matrix_size);

                std::vector<int> h_diags;
                std::vector<Complex64> h_data;

                for (int d = -n + 1; d < n; ++d)
                {
                    bool is_active = false;
                    std::vector<Complex64> diag_elements(n, {0.0, 0.0});

                    for (int i = 0; i < n; ++i)
                    {
                        int j = i + d;
                        if (j >= 0 && j < n && std::abs(dense_matrix[i][j]) > 1e-12)
                        {
                            is_active = true;
                            diag_elements[i] = Complex64(dense_matrix[i][j].real(), dense_matrix[i][j].imag());
                        }
                    }

                    if (is_active)
                    {
                        h_diags.push_back(d);
                        h_data.insert(h_data.end(), diag_elements.begin(), diag_elements.end());
                    }
                }

                num_diagonals = h_diags.size();
                active_diagonals = Kokkos::View<int *>("ActiveDiagonals", num_diagonals);
                matrix_data = Kokkos::View<Complex64 *>("MatrixData", h_data.size());
                auto mirror_diags = Kokkos::create_mirror_view(active_diagonals);
                for (size_t i = 0; i < num_diagonals; ++i)
                    mirror_diags(i) = h_diags[i];
                Kokkos::deep_copy(active_diagonals, mirror_diags);
                auto mirror_data = Kokkos::create_mirror_view(matrix_data);
                for (size_t i = 0; i < h_data.size(); ++i)
                    mirror_data(i) = h_data[i];
                Kokkos::deep_copy(matrix_data, mirror_data);
                std::cout << "[Kokkos DiaQ] Packed " << matrix_size << "x" << matrix_size
                          << " matrix into " << num_diagonals << " active diagonals.\n";
            }
        };

        struct QuantumGate
        {
            std::vector<int> targets;
            std::vector<std::vector<std::complex<double>>> matrix;
        };

        class DAGOptimizer
        {
        public:
            static void sparsity_aware_gate_fusion(std::vector<QuantumGate> &gate_sequence)
            {
                if (gate_sequence.size() < 2)
                    return;
                std::vector<QuantumGate> fused_sequence;
                QuantumGate current_accumulator = gate_sequence[0];
                for (size_t i = 1; i < gate_sequence.size(); ++i)
                {
                    if (current_accumulator.targets == gate_sequence[i].targets)
                    {
                        size_t dim = current_accumulator.matrix.size();
                        std::vector<std::vector<std::complex<double>>> fused_matrix(dim, std::vector<std::complex<double>>(dim, 0.0));

                        for (size_t row = 0; row < dim; ++row)
                        {
                            for (size_t col = 0; col < dim; ++col)
                            {
                                for (size_t k = 0; k < dim; ++k)
                                {
                                    fused_matrix[row][col] += gate_sequence[i].matrix[row][k] * current_accumulator.matrix[k][col];
                                }
                            }
                        }
                        current_accumulator.matrix = std::move(fused_matrix);
                    }
                    else
                    {
                        fused_sequence.push_back(current_accumulator);
                        current_accumulator = gate_sequence[i];
                    }
                }
                fused_sequence.push_back(current_accumulator);

                std::cout << "[DAG Fusion] Reduced DAG sequence from "
                          << gate_sequence.size() << " to " << fused_sequence.size() << " operations.\n";
                gate_sequence = std::move(fused_sequence);
            }

            inline static double poa_bound_ = 2.5; // 占位默认值，需按实测标定

            static double potential_function(const std::vector<QuantumGate>& seq) {
                double phi = 0.0;
                for (const auto& g : seq) phi += channel_importance(g);
                return phi;
            }

            static double channel_importance(const QuantumGate& g) {
                double fro2 = 0.0;
                for (const auto& row : g.matrix)
                    for (const auto& c : row) fro2 += std::norm(c);
                return fro2;
            }

            static double icm_importance(const std::vector<std::vector<double>>& R, size_t f) {
                return icm_channel_importance(R, f);
            }
            
            // 价格无政府状态（Price of Anarchy）上界。
            // 原先硬编码为 2.5 且从未被调用 —— 该数值既无理论推导也无实验标定，
            // 直接暴露为常量会被误当作有保证的界。改为可配置：应由资源博弈模块
            // 按实测标定后注入；默认 2.5 仅为保持历史行为，不代表任何保证。
            static double price_of_anarchy_bound() { return poa_bound_; }
            static void set_price_of_anarchy_bound(double bound) { poa_bound_ = bound; }
        };

        class KokkosInterface
        {
        public:
            // 通用 N×N 门 offload：支持单 qubit（2×2）与多 qubit（4×4、8×8…）门。
            // 原理：把态矢量按「非目标 qubit」分组，每个组内对「目标 qubit」的
            // dim=2^n_targets 个基底施加 dim×dim 矩阵。targets[0] 视为最高位，
            // 与 gate.matrix 的基底序一致（如 CNOT 的 matrix 基底为 |control,target⟩）。
            template <typename ExecSpace, typename MemSpace>
            static void offload_to_statevec_impl(std::complex<double> *host_state_vector, uint32_t num_qubits, const QuantumGate &gate)
            {
                constexpr size_t MAX_TARGETS = 8; // 支持到 8-qubit 门（256×256）
                size_t sv_size = 1ULL << num_qubits;
                size_t n_targets = gate.targets.size();
                size_t dim = gate.matrix.size();

                if (n_targets == 0 || n_targets > MAX_TARGETS)
                    throw std::invalid_argument("offload_to_statevec: unsupported target count.");
                if (dim != (1ULL << n_targets))
                    throw std::invalid_argument("offload_to_statevec: matrix dim must equal 2^n_targets.");

                // 目标位掩码 + 目标索引（固定数组，trivially copyable，可安全按值捕获进 lambda）
                uint32_t mask = 0;
                int targets[MAX_TARGETS];
                for (size_t i = 0; i < n_targets; ++i)
                {
                    targets[i] = gate.targets[i];
                    mask |= (1U << targets[i]);
                }

                Kokkos::View<Complex64 *, MemSpace> d_sv("DeviceStateVector", sv_size);
                auto h_sv = Kokkos::create_mirror_view(d_sv);
                for (size_t i = 0; i < sv_size; ++i)
                    h_sv(i) = Complex64(host_state_vector[i].real(), host_state_vector[i].imag());
                Kokkos::deep_copy(d_sv, h_sv);

                Kokkos::View<Complex64 **, MemSpace> d_matrix("DeviceGateMatrix", dim, dim);
                auto h_matrix = Kokkos::create_mirror_view(d_matrix);
                for (size_t r = 0; r < dim; ++r)
                    for (size_t c = 0; c < dim; ++c)
                        h_matrix(r, c) = Complex64(gate.matrix[r][c].real(), gate.matrix[r][c].imag());
                Kokkos::deep_copy(d_matrix, h_matrix);

                const size_t num_groups = sv_size >> n_targets; // 非目标位的组合数
                const uint32_t nq = num_qubits;
                const uint32_t nt = static_cast<uint32_t>(n_targets);
                const uint32_t dm = static_cast<uint32_t>(dim);
                const uint32_t mmask = mask;

                Kokkos::parallel_for("ApplyQuantumGate", Kokkos::RangePolicy<ExecSpace>(0, num_groups), KOKKOS_LAMBDA(const int g) {
                    // 1) 由组号 g 还原 base（非目标位按原序排列）
                    uint32_t base = 0, bit = 0;
                    for (uint32_t pos = 0; pos < nq; ++pos)
                    {
                        if (!(mmask & (1U << pos)))
                        {
                            if (g & (1U << bit))
                                base |= (1U << pos);
                            ++bit;
                        }
                    }

                    // 2) 读取 dim 个振幅（目标位的 dim 个基底；c 的 bit(nt-1-i) 对应 targets[i]）
                    double vr[MAX_TARGETS], vi[MAX_TARGETS];
                    for (uint32_t c = 0; c < dm; ++c)
                    {
                        uint32_t idx = base;
                        for (uint32_t t = 0; t < nt; ++t)
                            if (c & (1U << (nt - 1 - t)))
                                idx |= (1U << targets[t]);
                        vr[c] = d_sv(idx).real();
                        vi[c] = d_sv(idx).imag();
                    }

                    // 3) 施加 dim×dim 矩阵
                    for (uint32_t r = 0; r < dm; ++r)
                    {
                        double re = 0.0, im = 0.0;
                        for (uint32_t c = 0; c < dm; ++c)
                        {
                            const Complex64 m = d_matrix(r, c);
                            re += m.real() * vr[c] - m.imag() * vi[c];
                            im += m.real() * vi[c] + m.imag() * vr[c];
                        }
                        uint32_t idx = base;
                        for (uint32_t t = 0; t < nt; ++t)
                            if (r & (1U << (nt - 1 - t)))
                                idx |= (1U << targets[t]);
                        d_sv(idx) = Complex64(re, im);
                    }
                });

                Kokkos::fence();
                Kokkos::deep_copy(h_sv, d_sv);
                for (size_t i = 0; i < sv_size; ++i)
                    host_state_vector[i] = std::complex<double>(h_sv(i).real(), h_sv(i).imag());
            }

            // 运行时派发：有 GPU 走 CUDA 后端，无 GPU 回退默认 host 执行空间。
            // 用条件编译适配 Kokkos 实际启用的后端（仅 Threads 时无 Cuda/OpenMP 命名空间）。
            static void offload_to_statevec(std::complex<double> *host_state_vector, uint32_t num_qubits, const QuantumGate &gate)
            {
#if defined(KOKKOS_ENABLE_CUDA)
                if (quark::gpu_backend_available())
                    offload_to_statevec_impl<Kokkos::Cuda, Kokkos::CudaSpace>(host_state_vector, num_qubits, gate);
                else
                    offload_to_statevec_impl<Kokkos::DefaultExecutionSpace, Kokkos::HostSpace>(host_state_vector, num_qubits, gate);
#else
                offload_to_statevec_impl<Kokkos::DefaultExecutionSpace, Kokkos::HostSpace>(host_state_vector, num_qubits, gate);
#endif
            }
        };
    }
}