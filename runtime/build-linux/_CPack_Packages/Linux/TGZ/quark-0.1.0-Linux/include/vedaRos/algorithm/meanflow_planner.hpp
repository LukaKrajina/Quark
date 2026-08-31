#pragma once
#include <vector>
#include <functional>
#include <utility>
#include <iostream>
#include "../../qhal/IQuantumBackend.hpp"

namespace vedaros::algorithm
{

    // ─────────────────────────────────────────────────────────────
    // 乘积李群 G = SO(3)×R^3 上的 MeanFlow 位姿/抓取规划（新公式 8）
    //
    // 端点参数化：网络直接预测干净目标位姿 Ĥ_1（6 维 = so(3) 李代数
    // 坐标 3 + 平移 3），平均速度与流映射由闭式推导，因子分解为：
    //   旋转：so(3) log 坐标线性插值 = SO(3) 测地插值（公式 12）
    //   平移：线性插值（公式 13）
    // 推理：T 步迭代（公式 24），T = 1..5 即可采样可靠位姿，
    //       避免低步数下扩散/流采样器的大步截断误差。
    //
    // 端点预测器默认恒等（占位），实际使用时可注入由 QLM 的
    // VectorQuantumLayer + parameter-shift 骨架实现的量子网络
    // （输出 6 维连续期望 ⟨Z⟩ 作为 so(3)⊕R^3 坐标）。
    // ─────────────────────────────────────────────────────────────
    class MeanFlowPlanner
    {
    public:
        static constexpr size_t kDim = 6; // so(3) 3 维 + 平移 3 维

        // 端点预测器：给定插值位姿 H_t 与流时间 t，返回干净目标 Ĥ_1
        using EndpointPredictor =
            std::function<std::vector<double>(const std::vector<double> &, double)>;

    private:
        qhal::IQuantumBackend *backend_;
        EndpointPredictor predictor_;

        static std::vector<double> identity_predictor(const std::vector<double> &H, double)
        {
            return H;
        }

    public:
        explicit MeanFlowPlanner(qhal::IQuantumBackend *backend,
                                 EndpointPredictor pred = nullptr)
            : backend_(backend),
              predictor_(pred ? std::move(pred) : identity_predictor)
        {
            std::cout << "[vedaRos.mf] Lie-group MeanFlow planner online (SO(3)xR^3).\n";
        }

        // 端点预测（新公式 8 的 Ĥ_1 = X_θ(H_t, t)）
        std::vector<double> predict_endpoint(const std::vector<double> &H_t, double t) const
        {
            return predictor_(H_t, t);
        }

        // 诱导流映射（新公式 8 因子分解）：
        //   out[i] = H_s[i] + alpha · (Ĥ_1[i] - H_s[i])，alpha = (t-s)/(t_end-s)
        // so(3) 坐标线性插值等价于测地插值，平移线性插值。
        std::vector<double> flow(const std::vector<double> &H_s,
                                 double s, double t, double t_end = 1.0) const
        {
            std::vector<double> H1 = predict_endpoint(H_s, s);
            std::vector<double> out(kDim);
            double denom = t_end - s;
            if (denom < 1e-12)
                denom = 1e-12;
            double alpha = (t - s) / denom;
            for (size_t i = 0; i < kDim; ++i)
                out[i] = H_s[i] + alpha * (H1[i] - H_s[i]);
            return out;
        }

        // T 步推理迭代（新公式 24）：H_{k+1} = Φ_θ(H_k, t_k, t_{k+1})
        std::vector<double> sample(const std::vector<double> &H0, int T = 5) const
        {
            std::vector<double> H = H0;
            for (int k = 0; k < T; ++k)
            {
                double t_k = static_cast<double>(k) / T;
                double t_k1 = static_cast<double>(k + 1) / T;
                H = flow(H, t_k, t_k1);
            }
            return H;
        }
    };
}
