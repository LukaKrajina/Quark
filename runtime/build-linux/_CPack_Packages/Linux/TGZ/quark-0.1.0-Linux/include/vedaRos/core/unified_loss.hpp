#pragma once
#include <vector>
#include <numeric>
#include <algorithm>
#include <utility>

namespace vedaros::core
{

    // ─────────────────────────────────────────────────────────────
    // 自适应损失权重（新公式 13：梯度范数反比归一化 + EMA）
    //
    // 统一总损失（新公式）：
    //   L_total = λ_fm·L_fm + λ_semi·L_semi + λ_grpo·L_grpo
    //           + λ_ifp·L_ifp + λ_mf·L_mf + λ_topo·L_topo + λ_metric·R_metric
    //
    // 每个训练步根据各损失的梯度范数 n_i = ‖∇_θ L_i‖ 动态调节 λ_i，
    // 使各损失贡献均衡。这是完整 GradNorm（Chen et al. 2018）的简化版，
    // 省去外层反向传播，适配 quantum parameter-shift 的高计算成本。
    // ─────────────────────────────────────────────────────────────
    class AdaptiveLossWeights
    {
    private:
        std::vector<double> lambda_;       // 当前权重
        std::vector<double> lambda_base_;  // 默认超参
        double beta_ = 0.1;                // EMA 平滑系数

    public:
        explicit AdaptiveLossWeights(std::vector<double> base)
            : lambda_(base), lambda_base_(std::move(base)) {}

        // 输入各损失梯度范数，反比归一化 + EMA 软更新（新公式 13）
        void update(const std::vector<double> &grad_norms)
        {
            if (grad_norms.empty())
                return;
            double mean = std::accumulate(grad_norms.begin(), grad_norms.end(), 0.0)
                          / grad_norms.size();
            for (size_t i = 0; i < grad_norms.size(); ++i)
            {
                double n_i = std::max(grad_norms[i], 1e-8); // 防除零
                double lambda_new = lambda_base_[i] * (mean / n_i);
                lambda_[i] = (1.0 - beta_) * lambda_[i] + beta_ * lambda_new;
            }
        }

        const std::vector<double> &weights() const { return lambda_; }

        double weight(size_t i) const
        {
            return (i < lambda_.size()) ? lambda_[i] : 1.0;
        }

        // 统一总损失：L_total = Σ_i λ_i · L_i
        double combine(const std::vector<double> &losses) const
        {
            double total = 0.0;
            for (size_t i = 0; i < losses.size() && i < lambda_.size(); ++i)
                total += lambda_[i] * losses[i];
            return total;
        }
    };

    // 默认超参（可调）：λ_fm=1.0, λ_semi=0.1, λ_grpo=0.5, λ_ifp=0.3,
    //                 λ_mf=1.0, λ_topo=0.05, λ_metric=0.01
    inline std::vector<double> default_loss_weights()
    {
        return {1.0, 0.1, 0.5, 0.3, 1.0, 0.05, 0.01};
    }

} // namespace vedaros::core
