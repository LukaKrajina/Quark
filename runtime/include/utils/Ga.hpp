<<<<<<< HEAD
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
#if defined(__linux__)
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
#ifdef __AVX512F__
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
                            diag_elements[i] = {dense_matrix[i][j].real(), dense_matrix[i][j].imag()};
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
            
            static constexpr double price_of_anarchy_bound() { return 2.5; }
        };

        class KokkosInterface
        {
        public:
            static void offload_to_statevec(std::complex<double> *host_state_vector, uint32_t num_qubits, const QuantumGate &gate)
            {
                size_t sv_size = 1ULL << num_qubits;
                size_t dim = gate.matrix.size();
                size_t target_qubit = gate.targets[0];
                View1D d_sv("DeviceStateVector", sv_size);
                auto h_sv = Kokkos::create_mirror_view(d_sv);

                for (size_t i = 0; i < sv_size; ++i)
                {
                    h_sv(i) = Complex64(host_state_vector[i].real(), host_state_vector[i].imag());
                }
                Kokkos::deep_copy(d_sv, h_sv);

                View2D d_matrix("DeviceGateMatrix", dim, dim);
                auto h_matrix = Kokkos::create_mirror_view(d_matrix);

                for (size_t r = 0; r < dim; ++r)
                {
                    for (size_t c = 0; c < dim; ++c)
                    {
                        h_matrix(r, c) = Complex64(gate.matrix[r][c].real(), gate.matrix[r][c].imag());
                    }
                }
                Kokkos::deep_copy(d_matrix, h_matrix);
                size_t half_sv_size = sv_size >> 1;
                uint32_t mask = 1U << target_qubit;

                Kokkos::parallel_for("ApplyQuantumGate", Kokkos::RangePolicy<int>(0, half_sv_size), KOKKOS_LAMBDA(const int i) {
                    uint32_t idx0 = (i & ~(mask - 1)) << 1 | (i & (mask - 1));
                    uint32_t idx1 = idx0 | mask;

                    Complex64 val0 = d_sv(idx0);
                    Complex64 val1 = d_sv(idx1);
                    d_sv(idx0) = d_matrix(0, 0) * val0 + d_matrix(0, 1) * val1;
                    d_sv(idx1) = d_matrix(1, 0) * val0 + d_matrix(1, 1) * val1; });

                Kokkos::fence();
                Kokkos::deep_copy(h_sv, d_sv);

                for (size_t i = 0; i < sv_size; ++i)
                {
                    host_state_vector[i] = std::complex<double>(h_sv(i).real(), h_sv(i).imag());
                }
            }
        };
    }
=======
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
#if defined(__linux__)
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
#ifdef __AVX512F__
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
            
            static constexpr double price_of_anarchy_bound() { return 2.5; }
        };

        class KokkosInterface
        {
        public:
            static void offload_to_statevec(std::complex<double> *host_state_vector, uint32_t num_qubits, const QuantumGate &gate)
            {
                size_t sv_size = 1ULL << num_qubits;
                size_t dim = gate.matrix.size();
                size_t target_qubit = gate.targets[0];
                View1D d_sv("DeviceStateVector", sv_size);
                auto h_sv = Kokkos::create_mirror_view(d_sv);

                for (size_t i = 0; i < sv_size; ++i)
                {
                    h_sv(i) = Complex64(host_state_vector[i].real(), host_state_vector[i].imag());
                }
                Kokkos::deep_copy(d_sv, h_sv);

                View2D d_matrix("DeviceGateMatrix", dim, dim);
                auto h_matrix = Kokkos::create_mirror_view(d_matrix);

                for (size_t r = 0; r < dim; ++r)
                {
                    for (size_t c = 0; c < dim; ++c)
                    {
                        h_matrix(r, c) = Complex64(gate.matrix[r][c].real(), gate.matrix[r][c].imag());
                    }
                }
                Kokkos::deep_copy(d_matrix, h_matrix);
                size_t half_sv_size = sv_size >> 1;
                uint32_t mask = 1U << target_qubit;

                Kokkos::parallel_for("ApplyQuantumGate", Kokkos::RangePolicy<int>(0, half_sv_size), KOKKOS_LAMBDA(const int i) {
                    uint32_t idx0 = (i & ~(mask - 1)) << 1 | (i & (mask - 1));
                    uint32_t idx1 = idx0 | mask;

                    Complex64 val0 = d_sv(idx0);
                    Complex64 val1 = d_sv(idx1);
                    d_sv(idx0) = d_matrix(0, 0) * val0 + d_matrix(0, 1) * val1;
                    d_sv(idx1) = d_matrix(1, 0) * val0 + d_matrix(1, 1) * val1; });

                Kokkos::fence();
                Kokkos::deep_copy(h_sv, d_sv);

                for (size_t i = 0; i < sv_size; ++i)
                {
                    host_state_vector[i] = std::complex<double>(h_sv(i).real(), h_sv(i).imag());
                }
            }
        };
    }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}