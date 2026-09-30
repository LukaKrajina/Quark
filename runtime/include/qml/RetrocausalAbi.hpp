#pragma once
//
// RetrocausalAbi.hpp —— 量子通道逆因果容量（回程能力）语言层 ABI 桥接
//
// 把 spacetime/RetrocausalCapacity.hpp 的核心量暴露为 qk 语言层可调用的 extern "C"
// 函数。对应 TQNF 第四支柱「因果」（见 docs/qk-topological-quantum-learning.md）。
//
//   kind 参数（int32）映射预置信道：
//     0 = 去极化 depolarizing（p = 去极化概率）
//     1 = 退相 dephasing（p = 退相概率）
//     2 = 比特翻转 bit-flip（p = X 概率）
//     3 = 振幅阻尼 amplitude-damping（p = γ 衰变率）
//     4 = 幺正 Hadamard（p 忽略）
//     5 = 比特-相位翻转 bit-phase-flip（p = Y 概率）
//
//   qk_retrocausal_imax(kind, p)               -> double  max-information I_max
//   qk_retrocausal_idoe(kind, p)               -> double  Doeblin information I_doe
//   qk_retrocausal_q_capacity(kind, p)         -> double  渐近逆因果量子容量 Q_retro
//   qk_retrocausal_c_capacity(kind, p)         -> double  渐近逆因果经典容量 C_retro
//   qk_retrocausal_q_one_shot(kind, p, eps)    -> double  单次逆因果量子容量 Q^ε
//   qk_retrocausal_gain(kind, p)               -> double  回程增益 Q_retro / Q_forward
//   qk_retrocausal_deformed(kind, p, q)        -> double  q-变形逆因果容量（q∈[−1,1]）
//
// 纯 numqk + spacetime 依赖，后端无关。
//
#include "../qhal/Export.hpp"
#include "../spacetime/RetrocausalCapacity.hpp"
#include <cstdint>

#ifndef QUARK_HOST_EXPORT
#define QUARK_HOST_EXPORT extern "C" QUARK_RT_API
#endif

namespace qml
{
    // 按 kind 构造预置信道（非法 kind 回退去极化）
    inline quark::spacetime::QuantumChannel make_retrocausal_channel(int kind, double p)
    {
        if (kind < 0 || kind > 5)
            return quark::spacetime::QuantumChannel::depolarizing(p);
        return quark::spacetime::QuantumChannel::make(kind, p);
    }
}

extern "C"
{
    QUARK_HOST_EXPORT double qk_retrocausal_imax(int32_t kind, double p);
    QUARK_HOST_EXPORT double qk_retrocausal_idoe(int32_t kind, double p);
    QUARK_HOST_EXPORT double qk_retrocausal_q_capacity(int32_t kind, double p);
    QUARK_HOST_EXPORT double qk_retrocausal_c_capacity(int32_t kind, double p);
    QUARK_HOST_EXPORT double qk_retrocausal_q_one_shot(int32_t kind, double p, double eps);
    QUARK_HOST_EXPORT double qk_retrocausal_gain(int32_t kind, double p);
    QUARK_HOST_EXPORT double qk_retrocausal_deformed(int32_t kind, double p, double q);
}

#if defined(QUARK_RT_BUILD)
double qk_retrocausal_imax(int32_t kind, double p)
{
    const auto N = qml::make_retrocausal_channel(kind, p);
    return quark::spacetime::retrocausal_info(N).imax;
}

double qk_retrocausal_idoe(int32_t kind, double p)
{
    const auto N = qml::make_retrocausal_channel(kind, p);
    return quark::spacetime::retrocausal_info(N).idoe;
}

double qk_retrocausal_q_capacity(int32_t kind, double p)
{
    const auto N = qml::make_retrocausal_channel(kind, p);
    return quark::spacetime::retrocausal_capacity(N).q_asymptotic;
}

double qk_retrocausal_c_capacity(int32_t kind, double p)
{
    const auto N = qml::make_retrocausal_channel(kind, p);
    return quark::spacetime::retrocausal_capacity(N).c_asymptotic;
}

double qk_retrocausal_q_one_shot(int32_t kind, double p, double eps)
{
    const auto N = qml::make_retrocausal_channel(kind, p);
    return quark::spacetime::retrocausal_capacity(N, eps).q_one_shot;
}

double qk_retrocausal_gain(int32_t kind, double p)
{
    const auto N = qml::make_retrocausal_channel(kind, p);
    return quark::spacetime::retrocausal_capacity(N).gain;
}

double qk_retrocausal_deformed(int32_t kind, double p, double q)
{
    const auto N = qml::make_retrocausal_channel(kind, p);
    return quark::spacetime::q_retrocausal_capacity(N, q);
}
#endif