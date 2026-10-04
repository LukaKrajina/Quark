#pragma once
#include <vector>
#include <functional>
#include <utility>
#include <iostream>
#include "../../qhal/IQuantumBackend.hpp"

namespace vedaros::algorithm
{

    // ─────────────────────────────────────────────────────────────
    // 乘积李群 G = SO(3)×R^3 上的 MeanFlow 位姿/抓取规划
    //
    // 端点参数化：网络直接预测干净目标位姿 Ĥ_1（6 维 = so(3) 李代数
    // 坐标 3 + 平移 3），平均速度与流映射由闭式推导，因子分解为：
    //   旋转：so(3) log 坐标线性插值 = SO(3) 测地插值
    //   平移：线性插值
    // 推理：T 步迭代，T = 1..5 即可采样可靠位姿，
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
        /** 是否注入了真实端点预测器（false = 恒等占位） */
        bool injected_ = false;

        // 恒等占位：Ĥ_1 = H_t。注意其后果 —— flow() 中 H1 == H_s，
        // 于是 out == H_s，即流映射退化为「原地不动」的空操作。
        // 原先这是静默默认，规划器看起来在运行却毫无位移；现显式告警。
        static std::vector<double> identity_predictor(const std::vector<double> &H, double)
        {
            return H;
        }

    public:
        explicit MeanFlowPlanner(qhal::IQuantumBackend *backend,
                                 EndpointPredictor pred = nullptr)
            : backend_(backend),
              predictor_(pred ? std::move(pred) : identity_predictor),
              injected_(pred != nullptr)
        {
            if (!injected_) {
                std::cerr << "[vedaRos.mf][warn] no endpoint predictor injected — "
                          << "falling back to the IDENTITY placeholder (H_1 = H_t). "
                          << "This makes flow() a no-op (zero displacement); inject a real "
                          << "predictor (e.g. QLM VectorQuantumLayer + parameter-shift, "
                          << "outputting 6-D <Z> expectations as so(3)+R^3) for meaningful planning.\n";
            }
            std::cout << "[vedaRos.mf] Lie-group MeanFlow planner online (SO(3)xR^3).\n";
        }

        /** 是否注入了真实端点预测器；false 表示恒等占位（规划无位移）。 */
        bool has_predictor() const { return injected_; }

        // 端点预测
        // Ĥ_1 = X_θ(H_t, t)
        std::vector<double> predict_endpoint(const std::vector<double> &H_t, double t) const
        {
            return predictor_(H_t, t);
        }

        // 诱导流映射
        // out[i] = H_s[i] + alpha · (Ĥ_1[i] - H_s[i])，alpha = (t-s)/(t_end-s)
        // so(3) 坐标线性插值等价于测地插值，平移线性插值
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

        // T 步推理迭代
        // H_{k+1} = Φ_θ(H_k, t_k, t_{k+1})
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
