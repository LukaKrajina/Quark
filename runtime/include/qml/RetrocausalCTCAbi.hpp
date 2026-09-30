#pragma once
//
// RetrocausalCTCAbi.hpp —— 快子 KK 双空间嘈杂 CTC 通信语言层 ABI 桥接
//
// 把 spacetime/RetrocausalCTC.hpp 的「n 个 DD 维度嘈杂封闭类时曲线」通信能力暴露为
// qk 语言层可调用的 extern "C" 函数。对应 @layer 标签的多维 coord 拓扑：
//   coord 维度 = 额外维（DD 维度）数 n，每个额外维是半径 R=1 的紧致圆 S¹，
//   Wilson line θ 统一（破坏 ±n 模式对称）。
//
//   qk_retrocausal_ctc_q_capacity(n, theta, mu2, lambda) -> double  逆因果量子容量 Q_retro
//   qk_retrocausal_ctc_c_capacity(n, theta, mu2, lambda) -> double  逆因果经典容量 C_retro
//   qk_retrocausal_ctc_gain(n, theta, mu2, lambda)        -> double  回程增益 Q_retro/Q_forward
//   qk_retrocausal_ctc_dephasing(theta)                   -> double  退相噪声（Wilson line 映射）
//
//   参数：n = 额外维数（coord 维度）；theta = Wilson line；mu2/lambda = 快子势 V = −½μ²φ² + ¼λφ⁴。
//
// 纯 numqk + spacetime 依赖，后端无关。
//
#include "../qhal/Export.hpp"
#include "../spacetime/RetrocausalCTC.hpp"
#include <cstdint>
#include <vector>

#ifndef QUARK_HOST_EXPORT
#define QUARK_HOST_EXPORT extern "C" QUARK_RT_API
#endif

namespace qml
{
    // n 个均匀额外维（R=1，θ=theta）的 KK 空间
    inline quark::spacetime::KaluzaKleinND make_uniform_kk(int n, double theta)
    {
        if (n < 1)
            n = 1;
        return quark::spacetime::KaluzaKleinND(
            std::vector<double>(static_cast<size_t>(n), 1.0),
            std::vector<double>(static_cast<size_t>(n), theta));
    }
}

extern "C"
{
    QUARK_HOST_EXPORT double qk_retrocausal_ctc_q_capacity(int32_t n, double theta, double mu2, double lambda);
    QUARK_HOST_EXPORT double qk_retrocausal_ctc_c_capacity(int32_t n, double theta, double mu2, double lambda);
    QUARK_HOST_EXPORT double qk_retrocausal_ctc_gain(int32_t n, double theta, double mu2, double lambda);
    QUARK_HOST_EXPORT double qk_retrocausal_ctc_dephasing(double theta);
}

#if defined(QUARK_RT_BUILD)
double qk_retrocausal_ctc_q_capacity(int32_t n, double theta, double mu2, double lambda)
{
    const auto kk = qml::make_uniform_kk(n, theta);
    return quark::spacetime::retrocausal_capacity(
               quark::spacetime::tachyon_ctc_channel(kk, mu2, lambda))
        .q_asymptotic;
}

double qk_retrocausal_ctc_c_capacity(int32_t n, double theta, double mu2, double lambda)
{
    const auto kk = qml::make_uniform_kk(n, theta);
    return quark::spacetime::retrocausal_capacity(
               quark::spacetime::tachyon_ctc_channel(kk, mu2, lambda))
        .c_asymptotic;
}

double qk_retrocausal_ctc_gain(int32_t n, double theta, double mu2, double lambda)
{
    const auto kk = qml::make_uniform_kk(n, theta);
    return quark::spacetime::retrocausal_capacity(
               quark::spacetime::tachyon_ctc_channel(kk, mu2, lambda))
        .gain;
}

double qk_retrocausal_ctc_dephasing(double theta)
{
    const auto kk = qml::make_uniform_kk(1, theta);
    return quark::spacetime::tachyon_ctc_noise(kk, 1.0, 1.0).dephasing;
}
#endif