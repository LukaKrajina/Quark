#pragma once
#include <vector>
#include <functional>
#include <utility>
#include <cstddef>

namespace qlm
{

    // ─────────────────────────────────────────────────────────────
    // 端点参数化流（新公式 3/4，论文 GraspMF 的欧氏空间投影）
    //
    // 网络直接预测干净目标 Ĥ_1 = X_θ(H_t, t)，平均速度与流映射
    // 由闭式推导（态期望空间近似为欧氏，见设计文档 7.3 的退化）：
    //   ū_θ = (Ĥ_1 - H_t) / (1 - t)                    （平均速度）
    //   Φ_θ(H_s, s, t) = H_s + (t-s)/(1-s)·(Ĥ_1 - H_s) （诱导流映射）
    //
    // 半群一致性（新公式 4）：Φ(s,t) = Φ(r,t) ∘ Φ(s,r)，保证任意
    // 步数采样结果一致（路径积分与端点无关）。
    // ─────────────────────────────────────────────────────────────
    class MeanFlowHead
    {
    public:
        // 端点预测器：给定插值态 H_t 与流时间 t，返回干净目标 Ĥ_1
        using EndpointPredictor =
            std::function<std::vector<double>(const std::vector<double> &, double)>;

    private:
        EndpointPredictor predictor_;

    public:
        explicit MeanFlowHead(EndpointPredictor pred) : predictor_(std::move(pred)) {}

        // 端点预测（新公式 8）
        std::vector<double> predict_endpoint(const std::vector<double> &H_t, double t) const
        {
            return predictor_(H_t, t);
        }

        // 诱导流映射（新公式 10 的欧氏版）：从时间 s 流动到 t
        std::vector<double> flow(const std::vector<double> &H_s,
                                 double s, double t) const
        {
            std::vector<double> H1 = predictor_(H_s, s);
            std::vector<double> out(H_s.size());
            double denom = 1.0 - s;
            if (denom < 1e-12)
                denom = 1e-12;
            double alpha = (t - s) / denom;
            for (size_t i = 0; i < out.size(); ++i)
                out[i] = H_s[i] + alpha * (H1[i] - H_s[i]);
            return out;
        }

        // 半群一致性损失（新公式 4）：
        //   L_semi = ‖ Φ(r,t)∘Φ(s,r)(H_s) - Φ(s,t)(H_s) ‖²
        double semi_group_loss(const std::vector<double> &H_s,
                               double s, double r, double t) const
        {
            auto H_r = flow(H_s, s, r);
            auto H_t_via_r = flow(H_r, r, t);
            auto H_t_direct = flow(H_s, s, t);
            double loss = 0.0;
            for (size_t i = 0; i < H_s.size(); ++i)
            {
                double d = H_t_via_r[i] - H_t_direct[i];
                loss += d * d;
            }
            return loss;
        }
    };

} // namespace qlm
