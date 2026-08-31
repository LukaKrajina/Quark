#pragma once

#include <iostream>
#include <string>
#include <vector>
#include <fstream>
#include <cstring>
#include <unordered_map>
#include <cmath>

#include "../qhal/Export.hpp"

#ifndef QUARK_HOST_EXPORT
#define QUARK_HOST_EXPORT extern "C" QUARK_RT_API
#endif

#include "../qhal/QM.hpp"
#include "../../src/QObject.hpp"
#include "../qml/QKMFormat.hpp"

#ifndef QUARK_ABI_TYPES_DEFINED
#define QUARK_ABI_TYPES_DEFINED

enum QObjectDataKind : int
{
    QOBJ_DATA_NONE = 0,
    QOBJ_DATA_SHARED = 1, // std::shared_ptr<quark::QObject>*
    QOBJ_DATA_STRING = 2  // std::string*
};

// 注意：此结构体是全局命名空间 ::QObject，与 Qt 的 ::QObject 同名。
// 若导出其符号（隐式析构 _ZN7QObjectD2Ev）会与 Qt6Core 冲突，导致 Qt 对象
// 析构被错误绑定到本结构体而触发 free(): invalid pointer 崩溃。
// 用 visibility("hidden") 隐藏符号，仅通过 extern "C" 接口以指针传递。
struct __attribute__((visibility("hidden"))) QObject
{
    std::vector<size_t> hardware_ids;
    void *qlm_data = nullptr;
    int data_kind = QOBJ_DATA_NONE;
};

struct QModelJob
{
    void *prompt_data;
    int epochs;
    double lr;
};

inline size_t next_available_qubit = 0;
#endif

extern QUARK_RT_API qhal::IQuantumBackend *global_qm;
extern QUARK_RT_API std::string global_string_buffer;

namespace qqnt
{
    class Tokenizer
    {
    private:
        std::unordered_map<uint8_t, std::string> id_to_token;
        std::unordered_map<std::string, uint8_t> token_to_id;

    public:
        Tokenizer()
        {
            for (int i = 0; i < 128; ++i)
            {
                std::string ch(1, static_cast<char>(i));
                id_to_token[i] = ch;
                token_to_id[ch] = i;
            }

            std::vector<std::string> subwords = {
                " chaos", " fluid", " quantum", " state", " phase",
                " space", " time", " entropy", " dynamics", " prediction",
                " anomaly", " detected", " stable", " unstable", " metric",
                " tensor", " field", " particle", " wave", " collapse",
                " The", " system", " is", " exhibiting", " non-linear",
                " resonance", " pattern", " coherent", " decoherence", " matrix",
                " probability", " distribution", " entanglement", " manifold"};

            for (size_t i = 0; i < subwords.size(); ++i)
            {
                uint8_t id = 128 + i;
                id_to_token[id] = subwords[i];
                token_to_id[subwords[i]] = id;
            }

            for (int i = 128 + subwords.size(); i < 256; ++i)
            {
                char hex[5];
                snprintf(hex, sizeof(hex), "<%02X>", i);
                id_to_token[i] = std::string(hex);
                token_to_id[std::string(hex)] = i;
            }
        }

        std::string decode(uint8_t id)
        {
            return id_to_token[id];
        }

        std::vector<uint8_t> encode(const std::string &text)
        {
            std::vector<uint8_t> tokens;
            for (char c : text)
            {
                tokens.push_back(static_cast<uint8_t>(c));
            }
            return tokens;
        }
    };

    static Tokenizer global_tokenizer;
}

extern "C"
{
    QUARK_HOST_EXPORT QModelJob *qk_qlm_load(const char *filepath);
    QUARK_HOST_EXPORT QObject *qk_encode_string(const char *prompt);
    QUARK_HOST_EXPORT void qk_qlm_forward(QModelJob *model, QObject *input);
    QUARK_HOST_EXPORT const char *qk_decode_string(QObject *output);
}

#if defined(QUARK_RT_BUILD)
QModelJob *qk_qlm_load(const char *filepath)
{
    std::cout << "[QML Inference] Deserializing model from: " << filepath << "\n";
    QModelJob *job = new QModelJob();
    try
    {
        auto loaded_model = qml::ModelExporter<double>::load(filepath);
        auto *weights = new std::vector<double>(loaded_model.tensor.size());
        std::memcpy(weights->data(), loaded_model.tensor.data(), loaded_model.tensor.size() * sizeof(double));
        job->prompt_data = weights;
        std::cout << "[QML Inference] Target Model Online.\n";

        for (const auto &kv : loaded_model.metadata)
        {
            std::cout << "                -> " << kv.first << ": " << kv.second << "\n";
        }

        std::cout << "                -> Active Parameters: " << weights->size() << "\n";
    }
    catch (const std::exception &e)
    {
        std::cerr << "[QML Inference Error] Failed to parse QKM file: " << e.what() << "\n";
        auto *mock_weights = new std::vector<double>{0.15, 1.57, 3.14, 0.42};
        job->prompt_data = mock_weights;
    }

    return job;
}

QObject *qk_encode_string(const char *prompt)
{
    std::cout << "[QQNT] Tokenizing semantic prompt via Quantum-Native Tokenizer...\n";
    std::string prompt_str(prompt);
    std::vector<uint8_t> tokens = qqnt::global_tokenizer.encode(prompt_str);
    QObject *tensor = new QObject();
    size_t n_q = 8 * 2;
    global_qm->allocate_qubits(n_q);
    for (size_t i = 0; i < n_q; ++i)
    {
        size_t q_id = next_available_qubit++;
        tensor->hardware_ids.push_back(q_id);
    }

    tensor->qlm_data = new std::string(prompt);
    tensor->data_kind = QOBJ_DATA_STRING;
    return tensor;
}

void qk_qlm_forward(QModelJob *model, QObject *input)
{
    std::cout << "[QML Inference] Executing 16-Qubit Quantum Attention Generation...\n";
    auto *weights = static_cast<std::vector<double> *>(model->prompt_data);
    size_t n_q = input->hardware_ids.size();
    std::string *generated_sequence = static_cast<std::string *>(input->qlm_data);
    int max_new_tokens = 24;

    std::vector<uint8_t> current_tokens = qqnt::global_tokenizer.encode(*generated_sequence);
    uint8_t ctx_t1 = current_tokens.size() > 1 ? current_tokens[current_tokens.size() - 2] : 0;
    uint8_t ctx_t2 = current_tokens.size() > 0 ? current_tokens.back() : 0;

    for (size_t i = 0; i < 8; ++i)
    {
        if ((ctx_t1 >> i) & 1)
            global_qm->apply_x(input->hardware_ids[i]);
        if ((ctx_t2 >> i) & 1)
            global_qm->apply_x(input->hardware_ids[i + 8]);
    }

    size_t param_idx = 0;
    size_t num_layers = (weights->size() > 0) ? (weights->size() / (n_q + 8)) : 1;
    if (num_layers == 0)
        num_layers = 1;

    for (size_t t = 0; t < num_layers; ++t)
    {
        double N_t = std::exp(-0.1 * static_cast<double>(t));

        for (size_t i = 0; i < n_q; ++i)
        {
            if (param_idx < weights->size())
            {
                global_qm->apply_rz(input->hardware_ids[i], (*weights)[param_idx++] * N_t);
            }
        }

        for (size_t i = 0; i < 8; ++i)
        {
            global_qm->apply_cnot(input->hardware_ids[i], input->hardware_ids[i + 8]);
            if (param_idx < weights->size())
            {
                global_qm->apply_rz(input->hardware_ids[i + 8], (*weights)[param_idx++] * N_t);
            }
        }
    }

    uint8_t measured_token = 0;
    for (size_t i = 0; i < 8; ++i)
    {
        int bit = global_qm->measure(input->hardware_ids[i + 8]);
        if (bit == 1)
        {
            measured_token |= (1 << i);
        }

        if (bit == 1)
            global_qm->apply_x(input->hardware_ids[i + 8]);
        if (global_qm->measure(input->hardware_ids[i]) == 1)
            global_qm->apply_x(input->hardware_ids[i]);
    }

    std::string decoded_text = qqnt::global_tokenizer.decode(measured_token);
    std::cout << decoded_text << std::flush;
    *generated_sequence += decoded_text;
}

const char *qk_decode_string(QObject *output)
{
    std::cout << "[QQNT] Returning semantically decoded quantum context...\n";
    std::string *generated_sequence = static_cast<std::string *>(output->qlm_data);

    static thread_local std::string safe_return_buffer;
    safe_return_buffer = *generated_sequence;
    global_string_buffer = safe_return_buffer;

    delete generated_sequence;
    output->qlm_data = nullptr;

    return safe_return_buffer.c_str();
}
#endif