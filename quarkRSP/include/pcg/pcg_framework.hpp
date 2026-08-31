<<<<<<< HEAD
#pragma once
#include <cstdint>
#include <random>
#include <iostream>

namespace quarkrsp::pcg
{

    // 程序化内容生成（种子驱动的确定性生成）
    class PCGFramework
    {
    private:
        std::mt19937 rng_;

    public:
        explicit PCGFramework(uint32_t seed) : rng_(seed)
        {
            std::cout << "[quarkRSP.pcg] PCG framework seeded (" << seed << ").\n";
        }
        double next_unit() { return std::uniform_real_distribution<double>(0, 1)(rng_); }
        int next_int(int lo, int hi) { return std::uniform_int_distribution<int>(lo, hi)(rng_); }
    };
=======
#pragma once
#include <cstdint>
#include <random>
#include <iostream>
#include "hardware/observability.hpp"

namespace quarkrsp::pcg
{

    // 程序化内容生成（种子驱动的确定性生成）
    class PCGFramework
    {
    private:
        std::mt19937 rng_;

    public:
        explicit PCGFramework(uint32_t seed) : rng_(seed)
        {
            QUARKRSP_INFO("pcg") << "PCG framework seeded (" << seed << ").";
        }
        double next_unit() { return std::uniform_real_distribution<double>(0, 1)(rng_); }
        int next_int(int lo, int hi) { return std::uniform_int_distribution<int>(lo, hi)(rng_); }
    };
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}