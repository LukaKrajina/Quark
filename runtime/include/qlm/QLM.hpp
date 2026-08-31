<<<<<<< HEAD
#pragma once
#include "../numqk/Numqk.hpp"
#include "../qhal/IQuantumBackend.hpp"
#include "../qml/Layer.hpp"
#include "../qml/QKMFormat.hpp"
#include "../../src/QObject.hpp"
#include "../../src/QDataEncoder.hpp"
#include <memory>
#include <vector>
#include <cmath>
#include <random>
#include <string>
#include <unordered_map>
#include <iostream>

namespace qlm
{
    class QUARK_RT_API QLM
    {
    private:
        qhal::IQuantumBackend *backend;
        size_t num_layers;
        std::vector<double> lapse_functions;

    public:
        QLM(qhal::IQuantumBackend *be, size_t qubits, size_t layers)
            : backend(be), num_layers(layers)
        {
            for (size_t i = 0; i < layers; ++i)
            {
                lapse_functions.push_back(std::exp(-0.1 * static_cast<double>(i)));
            }
        }

        double circuit_ansatz(std::shared_ptr<quark::QObject> input_data, numqk::Tensor<double> &params)
        {
            const auto& active_qubits = input_data->get_ids();
            size_t n_q = active_qubits.size();
            if (n_q != 0)
            {
                return 0.0;
            }

            uint8_t target_token = *static_cast<uint8_t*>(input_data->qlm_data);
            size_t param_idx = 0;
            std::mt19937 rng(42);
            std::uniform_real_distribution<double> dropout_dist(0.0, 1.0);

            for (size_t t = 0; t < num_layers; ++t)
            {
                double N_t = lapse_functions[t];

                for (size_t i = 0; i < n_q; ++i) {
                    if (param_idx < params.size()) {
                        backend->apply_rz(active_qubits[i], params.data()[param_idx++] * N_t);
                    }
                }

                for (size_t i = 0; i < 8; ++i) {
                    if (dropout_dist(rng) > 0.15) {
                        backend->apply_cnot(active_qubits[i], active_qubits[i + 8]);
                    }
                    if (param_idx < params.size()) {
                        backend->apply_rz(active_qubits[i + 8], params.data()[param_idx++] * N_t);
                    }
                }
            }

            double loss = 0.0;
            for (size_t i = 0; i < 8; ++i)
            {
                int measured_bit = backend->measure(active_qubits[i + 8]);
                int target_bit = (target_token >> i) & 1;
                
                if (measured_bit != target_bit) {
                    loss += 1.0;
                }
            }
            
            return loss / 8.0;
        }

        void apply_qng_update(numqk::Tensor<double> &params, double learning_rate)
        {
            auto grad = params.get_grad();

            for (size_t i = 0; i < params.size(); ++i)
            {
                double g_ii = 0.25;
                double natural_grad = grad->data()[i] / g_ii;
                params.data()[i] -= learning_rate * natural_grad;
            }
        }

        void apply_qdp_noise(numqk::Tensor<double> &params, double epsilon)
        {
            std::random_device rd;
            std::mt19937 gen(rd());
            std::normal_distribution<double> sub_gaussian(0.0, epsilon);

            for (size_t i = 0; i < params.size(); ++i)
            {
                params.data()[i] += sub_gaussian(gen);
            }
        }

        qml::QKMModel<double> train_and_export(int epochs, double lr, const std::string &export_path, std::vector<std::shared_ptr<quark::QObject>>& dataset)
        {
            size_t n_q = dataset[0]->size();
            size_t total_params = num_layers * (n_q + 8); 
            numqk::Tensor<double> theta({total_params}, true);

            for (size_t i = 0; i < total_params; ++i)
            {
                theta.data()[i] = 0.01 * static_cast<double>(i);
            }

            auto bound_circuit = [this](qhal::IQuantumBackend *be, std::shared_ptr<quark::QObject> data, numqk::Tensor<double> &p)
            {
                return this->circuit_ansatz(data, p);
            };
            qml::QuantumLayer<double> layer(backend, bound_circuit);

            std::cout << "[QLM] Initiating Quantum Attention Optimization...\n";
            for (int e = 0; e < epochs; ++e)
            {
                double epoch_loss = 0.0;
                for (auto& sample : dataset) {
                    numqk::Tensor<double> out = layer.forward(sample, theta);
                    out.backward();
                    apply_qng_update(theta, lr);
                    epoch_loss += out.data()[0];
                    sample->reset_to_ground_state();
                }
                std::cout << "      Epoch " << e+1 << "/" << epochs << " | Hamming Loss: " << (epoch_loss / dataset.size()) << "\n";
            }

            std::cout << "[QLM] Applying ITA Sub-Gaussian Privacy Perturbation...\n";
            apply_qdp_noise(theta, 0.015);
            std::unordered_map<std::string, std::string> meta;
            meta["model.architecture"] = "QQNT";
            meta["topology.type"] = "Cross_Attention_16Q";
            meta["qdp.epsilon"] = "0.015";
            meta["qng.metric"] = "Diagonal_Fubini_Study";
            meta["context.window"] = "2_Tokens";
            
            qml::QKMModel<double> finalized_model(theta, meta);
            qml::ModelExporter<double>::save(export_path, finalized_model);

            return finalized_model;
        }
    };
=======
#pragma once
#include "../numqk/Numqk.hpp"
#include "../qhal/IQuantumBackend.hpp"
#include "../qml/Layer.hpp"
#include "../qml/QKMFormat.hpp"
#include "../../src/QObject.hpp"
#include "../../src/QDataEncoder.hpp"
#include <memory>
#include <vector>
#include <cmath>
#include <random>
#include <string>
#include <unordered_map>
#include <iostream>

namespace qlm
{
    class QUARK_RT_API QLM
    {
    private:
        qhal::IQuantumBackend *backend;
        size_t num_layers;
        size_t num_qubits_;   // 修复：原先 qubits 参数未保存，导致层参数布局脱钩
        std::vector<double> lapse_functions;

    public:
        QLM(qhal::IQuantumBackend *be, size_t qubits, size_t layers)
            : backend(be), num_layers(layers), num_qubits_(qubits)
        {
            for (size_t i = 0; i < layers; ++i)
            {
                lapse_functions.push_back(std::exp(-0.1 * static_cast<double>(i)));
            }
        }

        double circuit_ansatz(std::shared_ptr<quark::QObject> input_data, numqk::Tensor<double> &params)
        {
            const auto& active_qubits = input_data->get_ids();
            size_t n_q = active_qubits.size();
            if (n_q == 0)   // 修复：原为 n_q != 0，发现逻辑反向导致训练不可达
            {
                return 0.0;
            }

            uint8_t target_token = *static_cast<uint8_t*>(input_data->qlm_data);
            size_t param_idx = 0;
            std::mt19937 rng(42);
            std::uniform_real_distribution<double> dropout_dist(0.0, 1.0);

            for (size_t t = 0; t < num_layers; ++t)
            {
                double N_t = lapse_functions[t];

                for (size_t i = 0; i < n_q; ++i) {
                    if (param_idx < params.size()) {
                        backend->apply_rz(active_qubits[i], params.data()[param_idx++] * N_t);
                    }
                }

                for (size_t i = 0; i < 8; ++i) {
                    if (dropout_dist(rng) > 0.15) {
                        backend->apply_cnot(active_qubits[i], active_qubits[i + 8]);
                    }
                    if (param_idx < params.size()) {
                        backend->apply_rz(active_qubits[i + 8], params.data()[param_idx++] * N_t);
                    }
                }
            }

            double loss = 0.0;
            for (size_t i = 0; i < 8; ++i)
            {
                int measured_bit = backend->measure(active_qubits[i + 8]);
                int target_bit = (target_token >> i) & 1;
                
                if (measured_bit != target_bit) {
                    loss += 1.0;
                }
            }
            
            return loss / 8.0;
        }

        // ── 连续期望通道，输出 8 维 ⟨Z⟩，不坍缩态 ──────────
        // 门序列与 circuit_ansatz 完全一致，区别仅在最后读取的是
        // 非破坏 Z 期望 ⟨Z⟩ ∈ [-1,1] 而非坍缩比特，作为流匹配软信号。
        // 签名匹配 qml::VectorQuantumLayer 的 circuit_fn。
        void circuit_expectation(std::shared_ptr<quark::QObject> input_data,
                                 numqk::Tensor<double> &params,
                                 double *out)
        {
            const auto &active_qubits = input_data->get_ids();
            size_t n_q = active_qubits.size();
            if (n_q == 0)
            {
                for (size_t j = 0; j < 8; ++j) out[j] = 0.0;
                return;
            }

            size_t param_idx = 0;
            std::mt19937 rng(42);
            std::uniform_real_distribution<double> dropout_dist(0.0, 1.0);

            for (size_t t = 0; t < num_layers; ++t)
            {
                double N_t = lapse_functions[t];
                for (size_t i = 0; i < n_q; ++i)
                {
                    if (param_idx < params.size())
                        backend->apply_rz(active_qubits[i], params.data()[param_idx++] * N_t);
                }
                for (size_t i = 0; i < 8; ++i)
                {
                    if (dropout_dist(rng) > 0.15)
                        backend->apply_cnot(active_qubits[i], active_qubits[i + 8]);
                    if (param_idx < params.size())
                        backend->apply_rz(active_qubits[i + 8], params.data()[param_idx++] * N_t);
                }
            }

            for (size_t j = 0; j < 8; ++j)
                out[j] = backend->expectation_z(active_qubits[j + 8]);
        }

        // ── Fubini-Study 对角度量 ──────────────────────────
        // 替换硬编码 g_ii = 0.25：真实 FS 度量对角元在单 qubit RZ 门
        // 无纠缠段为 1/4，纠缠后按该层 lapse 平方衰减（解析近似）。
        // 第 i 个参数属于第 layer = i / (num_qubits_ + 8) 层。
        double fs_metric_diagonal(size_t param_index) const
        {
            size_t per_layer = num_qubits_ + 8;
            size_t layer = (per_layer > 0) ? (param_index / per_layer) : 0;
            double N_t = (layer < lapse_functions.size()) ? lapse_functions[layer] : 1.0;
            double g_ii = 0.25 * N_t * N_t;
            return (g_ii < 1e-12) ? 1e-12 : g_ii;
        }

        void apply_qng_update(numqk::Tensor<double> &params, double learning_rate)
        {
            auto grad = params.get_grad();

            for (size_t i = 0; i < params.size(); ++i)
            {
                double g_ii = fs_metric_diagonal(i);   // 真实 FS 度量
                double natural_grad = grad->data()[i] / g_ii;
                params.data()[i] -= learning_rate * natural_grad;
                grad->data()[i] = 0.0;                 // 清零，避免跨步梯度累积
            }
        }

        void apply_qdp_noise(numqk::Tensor<double> &params, double epsilon)
        {
            std::random_device rd;
            std::mt19937 gen(rd());
            std::normal_distribution<double> sub_gaussian(0.0, epsilon);

            for (size_t i = 0; i < params.size(); ++i)
            {
                params.data()[i] += sub_gaussian(gen);
            }
        }

        qml::QKMModel<double> train_and_export(int epochs, double lr, const std::string &export_path, std::vector<std::shared_ptr<quark::QObject>>& dataset)
        {
            size_t n_q = dataset[0]->size();
            size_t total_params = num_layers * (n_q + 8); 
            numqk::Tensor<double> theta({total_params}, true);

            for (size_t i = 0; i < total_params; ++i)
            {
                theta.data()[i] = 0.01 * static_cast<double>(i);
            }

            auto bound_circuit = [this](qhal::IQuantumBackend *be, std::shared_ptr<quark::QObject> data, numqk::Tensor<double> &p)
            {
                return this->circuit_ansatz(data, p);
            };
            qml::QuantumLayer<double> layer(backend, bound_circuit);

            std::cout << "[QLM] Initiating Quantum Attention Optimization...\n";
            for (int e = 0; e < epochs; ++e)
            {
                double epoch_loss = 0.0;
                for (auto& sample : dataset) {
                    numqk::Tensor<double> out = layer.forward(sample, theta);
                    out.backward();
                    apply_qng_update(theta, lr);
                    epoch_loss += out.data()[0];
                    sample->reset_to_ground_state();
                }
                std::cout << "      Epoch " << e+1 << "/" << epochs << " | Hamming Loss: " << (epoch_loss / dataset.size()) << "\n";
            }

            std::cout << "[QLM] Applying ITA Sub-Gaussian Privacy Perturbation...\n";
            apply_qdp_noise(theta, 0.015);
            std::unordered_map<std::string, std::string> meta;
            meta["model.architecture"] = "QQNT";
            meta["topology.type"] = "Cross_Attention_16Q";
            meta["qdp.epsilon"] = "0.015";
            meta["qng.metric"] = "Diagonal_Fubini_Study";
            meta["context.window"] = "2_Tokens";
            
            qml::QKMModel<double> finalized_model(theta, meta);
            qml::ModelExporter<double>::save(export_path, finalized_model);

            return finalized_model;
        }

        // ── 态空间流匹配损失 ────────────────────────────
        // 端点参数化 + 态空间线性插值使 L_fm 退化为「时间加权的端点回归」：
        //   L_fm = (1/8) Σ_j (x̂_1[j] - x_1[j])² ,  x_1 = 2·target - 1 ∈ {±1}
        // 返回损失标量，梯度由调用方构造 g_out 后经向量化 backward 回传。
        static double flow_match_loss(const double *pred, uint8_t target_token)
        {
            double loss = 0.0;
            for (size_t j = 0; j < 8; ++j)
            {
                double x1 = 2.0 * ((target_token >> j) & 1) - 1.0;
                double diff = pred[j] - x1;
                loss += diff * diff;
            }
            return loss / 8.0;
        }

        // ── 连续通道训练：态空间流匹配 ───────────────
        // 用 VectorQuantumLayer 输出 8 维 ⟨Z⟩ 期望，流匹配损失为端点回归，
        // 梯度通过向量化 parameter-shift 内积回传。
        // 绕过 Tensor::backward() 中 grad=1 的硬编码，直接调用
        // grad_fn->apply_backward(g_out)，其中 g_out = ∂L_fm/∂⟨Z⟩。
        void train_flow(std::vector<std::shared_ptr<quark::QObject>> &dataset,
                        int epochs, double lr)
        {
            size_t n_q = dataset.empty() ? num_qubits_ : dataset[0]->size();
            size_t total_params = num_layers * (n_q + 8);
            numqk::Tensor<double> theta({total_params}, true);
            for (size_t i = 0; i < total_params; ++i)
                theta.data()[i] = 0.01 * static_cast<double>(i);

            qml::VectorQuantumLayer<double> layer(
                backend,
                [this](qhal::IQuantumBackend *,
                       std::shared_ptr<quark::QObject> d,
                       numqk::Tensor<double> &p, double *out) {
                    this->circuit_expectation(d, p, out);
                },
                8);

            std::cout << "[QLM] Initiating State-Space Flow-Matching Optimization...\n";
            for (int e = 0; e < epochs; ++e)
            {
                double epoch_loss = 0.0;
                for (auto &sample : dataset)
                {
                    sample->reset_to_ground_state();
                    auto out = layer.forward(sample, theta);   // Tensor({8}) = ⟨Z⟩

                    uint8_t target_token = *static_cast<uint8_t *>(sample->qlm_data);

                    numqk::Tensor<double> g_out({8}, false);   // ∂L_fm/∂⟨Z⟩
                    double loss = 0.0;
                    for (size_t j = 0; j < 8; ++j)
                    {
                        double x1 = 2.0 * ((target_token >> j) & 1) - 1.0;
                        double diff = out.data()[j] - x1;
                        g_out.data()[j] = 2.0 * diff / 8.0;     // 平方误差梯度
                        loss += diff * diff;
                    }
                    loss /= 8.0;
                    epoch_loss += loss;

                    if (out.get_grad_fn())
                        out.get_grad_fn()->apply_backward(g_out);

                    apply_qng_update(theta, lr);
                    sample->reset_to_ground_state();
                }
                std::cout << "      [FLOW] Epoch " << e + 1 << "/" << epochs
                          << " | Flow-Match Loss: " << (epoch_loss / dataset.size()) << "\n";
            }
        }
    };
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}