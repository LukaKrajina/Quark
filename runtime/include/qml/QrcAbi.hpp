#pragma once
//
// QrcAbi.hpp —— QRC 量子储备池的 C ABI 桥接层
//
// 把 qml::QuantumReservoir（P1）暴露为 qk 语言层可调用的 extern "C" 函数，
// 对应 ir.ts 声明的 @qk_qrc_new / @qk_qrc_train / @qk_qrc_probe / @qk_qrc_predict。
//
// 语义：
//   qk_qrc_new(qubits, layers)      -> 创建储备池（out_dim=1，标量预测演示）
//   qk_qrc_train(res, epochs, lr)   -> 用合成正弦时序训练线性读出（验证无贫瘠高原）
//   qk_qrc_probe(res, data)         -> 测量 data 的量子态作为输入，返回 ⟨Z⟩ 特征
//                                       编码回 QObject（num_qubits 个 qubit）
//   qk_qrc_predict(res, data)       -> 返回读出预测（out_dim 个 qubit 编码）
//
#include "Reservoir.hpp"
#include "Inference.hpp"

// ABI 层的 QReservoir 句柄（不透明；隐藏符号，避免与 Qt 的 ::QObject 等冲突）
struct __attribute__((visibility("hidden"))) QReservoirHandle
{
    qml::QuantumReservoir *impl = nullptr;
};

extern "C"
{
    QUARK_HOST_EXPORT QReservoirHandle *qk_qrc_new(int32_t qubits, int32_t layers);
    QUARK_HOST_EXPORT void qk_qrc_train(QReservoirHandle *res, int32_t epochs, double lr);
    QUARK_HOST_EXPORT QObject *qk_qrc_probe(QReservoirHandle *res, QObject *data);
    QUARK_HOST_EXPORT QObject *qk_qrc_predict(QReservoirHandle *res, QObject *data);
    QUARK_HOST_EXPORT void qk_qrc_release(QReservoirHandle *res);
}

#if defined(QUARK_RT_BUILD)

QReservoirHandle *qk_qrc_new(int32_t qubits, int32_t layers)
{
    if (!global_qm || qubits <= 0)
        return nullptr;
    auto *h = new QReservoirHandle();
    // out_dim=1：演示任务为标量时序预测
    h->impl = new qml::QuantumReservoir(global_qm,
                                        static_cast<size_t>(qubits),
                                        static_cast<size_t>(layers),
                                        /*out_dim=*/1);
    std::cout << "[QRC ABI] Reservoir created (" << qubits << " qubits, "
              << layers << " layers).\n";
    return h;
}

void qk_qrc_train(QReservoirHandle *res, int32_t epochs, double lr)
{
    if (!res || !res->impl)
        return;

    // 合成时序训练数据：正弦预测任务（QRC 经典演示，验证无贫瘠高原）
    size_t nq = res->impl->qubits();
    size_t N = 200;
    std::vector<std::vector<double>> inputs, targets;
    inputs.reserve(N);
    targets.reserve(N);
    for (size_t s = 0; s < N; ++s)
    {
        std::vector<double> in(nq, 0.0);
        for (size_t i = 0; i < nq; ++i)
            in[i] = 0.5 + 0.5 * std::sin(0.05 * static_cast<double>(s) + 0.3 * static_cast<double>(i));
        std::vector<double> tgt(1, std::sin(0.05 * static_cast<double>(s + 1)));
        inputs.push_back(std::move(in));
        targets.push_back(std::move(tgt));
    }

    res->impl->train(inputs, targets, epochs, lr);
}

namespace
{
    // 把 ⟨Z⟩ 特征向量编码为 QObject（每维一个 qubit，相位编码）
    QObject *encode_features_to_object(const std::vector<double> &feats)
    {
        if (!global_qm)
            return nullptr;
        size_t n = feats.size();
        QObject *out = new QObject();
        global_qm->allocate_qubits(n);
        for (size_t i = 0; i < n; ++i)
        {
            size_t qid = next_available_qubit.fetch_add(1);
            out->hardware_ids.push_back(qid);
            // 特征 [-1,1] -> 相位 [0, 2π]
            double angle = (feats[i] + 1.0) * M_PI;
            global_qm->apply_h(qid);
            global_qm->apply_rz(qid, angle);
        }
        out->qlm_data = nullptr;
        out->data_kind = QOBJ_DATA_NONE;
        return out;
    }
}

QObject *qk_qrc_probe(QReservoirHandle *res, QObject *data)
{
    if (!res || !res->impl)
        return nullptr;
    size_t nq = res->impl->qubits();

    // 从 data 的量子态测量经典 bits 作为储备池输入
    std::vector<double> input(nq, 0.0);
    if (data)
    {
        for (size_t i = 0; i < data->hardware_ids.size() && i < nq; ++i)
        {
            int b = global_qm->measure(data->hardware_ids[i]);
            input[i] = b ? 1.0 : 0.0;
        }
    }

    auto feats = res->impl->evolve(input);
    return encode_features_to_object(feats);
}

QObject *qk_qrc_predict(QReservoirHandle *res, QObject *data)
{
    if (!res || !res->impl)
        return nullptr;
    size_t nq = res->impl->qubits();

    std::vector<double> input(nq, 0.0);
    if (data)
    {
        for (size_t i = 0; i < data->hardware_ids.size() && i < nq; ++i)
        {
            int b = global_qm->measure(data->hardware_ids[i]);
            input[i] = b ? 1.0 : 0.0;
        }
    }

    auto pred = res->impl->predict(input); // out_dim 维
    return encode_features_to_object(pred);
}

void qk_qrc_release(QReservoirHandle *res)
{
    if (!res)
        return;
    // 析构 QuantumReservoir：回收储备池 qubit（坍缩到 |0⟩ 后 release）
    delete res->impl;
    res->impl = nullptr;
    delete res;
    std::cout << "[QRC ABI] Reservoir released.\n";
}

#endif
