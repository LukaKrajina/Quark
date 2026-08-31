<<<<<<< HEAD
#pragma once
#include <vector>
#include <random>
#include <cmath>
#include <iostream>
#include "qhal/IQuantumBackend.hpp"
#include "numqk/Numqk.hpp"

namespace quarkrsp::control
{

    // 经验：观测 / 动作 / 奖励
    struct Experience
    {
        std::vector<double> observation;
        std::vector<double> action;
        double reward = 0.0;
    };

    class QuantumRLAgent
    {
    private:
        qhal::IQuantumBackend *backend_ = nullptr; // 可选量子后端（量子估计）
        numqk::Tensor<double> policy_weights_;     // 策略权重（观测→动作线性映射）
        std::vector<Experience> replay_buffer_;
        std::mt19937 rng_;
        double learning_rate_ = 0.01;
        size_t obs_dim_ = 0;
        size_t act_dim_ = 0;

    public:
        QuantumRLAgent(size_t obs_dim, size_t act_dim, double lr = 0.01)
            : obs_dim_(obs_dim), act_dim_(act_dim), learning_rate_(lr),
              policy_weights_(numqk::Tensor<double>({obs_dim, act_dim}, false)),
              rng_(std::random_device{}())
        {
            // 随机初始化策略权重(不是最好的方法但最简)
            std::uniform_real_distribution<double> dist(-0.1, 0.1);
            for (size_t i = 0; i < policy_weights_.size(); ++i)
                policy_weights_.data()[i] = dist(rng_);
        }

        void set_backend(qhal::IQuantumBackend *be) { backend_ = be; }

        // 策略：观测 → 动作（线性映射 + 可选量子噪声）
        std::vector<double> act(const std::vector<double> &obs)
        {
            std::vector<double> action(act_dim_, 0.0);
            for (size_t a = 0; a < act_dim_; ++a)
                for (size_t o = 0; o < obs_dim_; ++o)
                    action[a] += policy_weights_.data()[o * act_dim_ + a] * obs[o];
            return action;
        }

        // 量子估计动作：将观测编码到量子态，测量得到动作
        // 借由真实 QM/QVM 后端
        // 每个观测维度经 H + Rz(angle) 制备叠加态，
        // angle = atan(obs_i) * 2 归一化到 [-pi, pi]。
        // 测量结果（0/1）作为对经典策略的量子探索扰动。
        std::vector<double> act_quantum(const std::vector<double> &obs)
        {
            std::vector<double> base = act(obs); // 经典策略输出
            if (!backend_)
                return base;

            size_t n = std::min(obs.size(), static_cast<size_t>(16));
            if (n == 0)
                return base;

            // 观测编码 → 量子态
            backend_->allocate_qubits(n);
            for (size_t i = 0; i < n; ++i)
            {
                double angle = std::atan(obs[i]) * 2.0; // 映射到 [-pi, pi]
                backend_->apply_h(i);
                backend_->apply_rz(i, angle);
            }

            // 量子测量 → 探索扰动（±explore_scale，按测量结果 0/1 决定方向）
            double explore_scale = 0.05;
            std::vector<double> action = base;
            for (size_t a = 0; a < act_dim_ && a < n; ++a)
            {
                int m = backend_->measure(a);
                action[a] += (m == 1) ? explore_scale : -explore_scale;
            }
            return action;
        }

        void store(const std::vector<double> &obs, const std::vector<double> &action, double reward)
        {
            replay_buffer_.push_back({obs, action, reward});
            if (replay_buffer_.size() > 10000)
                replay_buffer_.erase(replay_buffer_.begin());
        }

        size_t buffer_size() const { return replay_buffer_.size(); }

        // 简化策略更新（用最近经验做监督式修正）
        void train(int epochs)
        {
            if (replay_buffer_.empty())
                return;
            std::cout << "[quarkRSP.rl] Training agent (" << epochs << " epochs, "
                      << replay_buffer_.size() << " samples)...\n";
            for (int e = 0; e < epochs; ++e)
            {
                for (const auto &exp : replay_buffer_)
                {
                    std::vector<double> pred = act(exp.observation);
                    for (size_t a = 0; a < act_dim_; ++a)
                    {
                        // 误差 = 目标（实际动作） - 预测
                        double error = exp.action[a] - pred[a];
                        for (size_t o = 0; o < obs_dim_; ++o)
                        {
                            policy_weights_.data()[o * act_dim_ + a] +=
                                learning_rate_ * error * exp.observation[o];
                        }
                    }
                }
            }
        }
    };
=======
#pragma once
#include <vector>
#include <random>
#include <cmath>
#include <algorithm>
#include <iostream>
#include "hardware/observability.hpp"
#include "qhal/IQuantumBackend.hpp"
#include "numqk/Numqk.hpp"

namespace quarkrsp::control
{

    // 经验：观测 / 动作 / 奖励
    struct Experience
    {
        std::vector<double> observation;
        std::vector<double> action;
        double reward = 0.0;
    };

    class QuantumRLAgent
    {
    private:
        qhal::IQuantumBackend *backend_ = nullptr; // 可选量子后端（量子估计）
        numqk::Tensor<double> policy_weights_;     // 策略权重（观测→动作线性映射）
        std::vector<Experience> replay_buffer_;
        std::mt19937 rng_;
        double learning_rate_ = 0.01;
        size_t obs_dim_ = 0;
        size_t act_dim_ = 0;

    public:
        QuantumRLAgent(size_t obs_dim, size_t act_dim, double lr = 0.01)
            : obs_dim_(obs_dim), act_dim_(act_dim), learning_rate_(lr),
              policy_weights_(numqk::Tensor<double>({obs_dim, act_dim}, false)),
              rng_(std::random_device{}())
        {
            // 随机初始化策略权重(不是最好的方法但最简)
            std::uniform_real_distribution<double> dist(-0.1, 0.1);
            for (size_t i = 0; i < policy_weights_.size(); ++i)
                policy_weights_.data()[i] = dist(rng_);
        }

        void set_backend(qhal::IQuantumBackend *be) { backend_ = be; }

        // 策略：观测 → 动作（线性映射 + 可选量子噪声）
        std::vector<double> act(const std::vector<double> &obs)
        {
            std::vector<double> action(act_dim_, 0.0);
            // 防御：观测维度不足时按有效长度截断，避免越界读
            size_t o_lim = std::min(obs.size(), obs_dim_);
            for (size_t a = 0; a < act_dim_; ++a)
                for (size_t o = 0; o < o_lim; ++o)
                    action[a] += policy_weights_.data()[o * act_dim_ + a] * obs[o];
            return action;
        }

        // 量子估计动作：将观测编码到量子态，测量得到动作
        // 借由真实 QM/QVM 后端
        // 每个观测维度经 H + Rz(angle) 制备叠加态，
        // angle = atan(obs_i) * 2 归一化到 [-pi, pi]。
        // 测量结果（0/1）作为对经典策略的量子探索扰动。
        std::vector<double> act_quantum(const std::vector<double> &obs)
        {
            std::vector<double> base = act(obs); // 经典策略输出
            if (!backend_)
                return base;

            size_t n = std::min(obs.size(), static_cast<size_t>(16));
            if (n == 0)
                return base;

            // 观测编码 → 量子态
            backend_->allocate_qubits(n);
            for (size_t i = 0; i < n; ++i)
            {
                double angle = std::atan(obs[i]) * 2.0; // 映射到 [-pi, pi]
                backend_->apply_h(i);
                backend_->apply_rz(i, angle);
            }

            // 量子测量 → 探索扰动（±explore_scale，按测量结果 0/1 决定方向）
            double explore_scale = 0.05;
            std::vector<double> action = base;
            for (size_t a = 0; a < act_dim_ && a < n; ++a)
            {
                int m = backend_->measure(a);
                action[a] += (m == 1) ? explore_scale : -explore_scale;
            }
            return action;
        }

        void store(const std::vector<double> &obs, const std::vector<double> &action, double reward)
        {
            replay_buffer_.push_back({obs, action, reward});
            if (replay_buffer_.size() > 10000)
                replay_buffer_.erase(replay_buffer_.begin());
        }

        size_t buffer_size() const { return replay_buffer_.size(); }

        // 简化策略更新（用最近经验做监督式修正）
        void train(int epochs)
        {
            if (replay_buffer_.empty())
                return;
            QUARKRSP_INFO("rl") << "Training agent (" << epochs << " epochs, "
                                << replay_buffer_.size() << " samples)...";
            for (int e = 0; e < epochs; ++e)
            {
                for (const auto &exp : replay_buffer_)
                {
                    // 防御：维度不符的经验样本跳过，避免越界读
                    if (exp.observation.size() < obs_dim_ || exp.action.size() < act_dim_)
                        continue;
                    std::vector<double> pred = act(exp.observation);
                    for (size_t a = 0; a < act_dim_; ++a)
                    {
                        // 误差 = 目标（实际动作） - 预测
                        double error = exp.action[a] - pred[a];
                        for (size_t o = 0; o < obs_dim_; ++o)
                        {
                            policy_weights_.data()[o * act_dim_ + a] +=
                                learning_rate_ * error * exp.observation[o];
                        }
                    }
                }
            }
        }
    };
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}