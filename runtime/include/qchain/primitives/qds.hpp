#pragma once
//
// qchain :: 量子数字签名（QDS）原语
//
// 参考 Gottesman–Chuang 量子数字签名的核心思想：
//   • 量子单向函数 QOWF：经典密钥 k → 量子态 |f(k)>，难以反演且不可克隆。
//   • 公钥 = 量子态 |f(k)> 的多个副本（分发给验证者，每次验证消耗一份）。
//   • 签名 = 揭示部分经典密钥；验证者测量量子公钥并与揭示值比对。
//
// 与经典（后量子）签名不同，QDS 的不可伪造性源自量子不可克隆定理，而非计算困难
// 假设，因此具备信息论安全。这儿给出可在 qhal::IQuantumBackend 上制备/测量的参考模型；
// 生产环境的 QDS 需量子存储器与测量设备无关（MDI）扩展。
//
#include "../common.hpp"
#include "hash.hpp"
#include "../../qhal/IQuantumBackend.hpp"

namespace qchain::qds
{

    using qchain::Byte;
    using qchain::Bytes;
    using qchain::Rng;
    using crypto::sha256;

    // 量子态制备描述：m 个量子比特，每个由 (基, 值) 决定。
    //   basis=false → Z 基（|0>/|1>），true → X 基（|+>/|->）。
    struct PreparationSpec
    {
        std::vector<bool> basis;
        std::vector<bool> value;
        size_t size() const { return basis.size(); }
    };

    // ─── 量子单向函数（QOWF）──────────────────────────────────────────
    //
    // 由经典密钥经 SHA-256 扩展出 2m 比特，作为 m 个比特的 (基, 值)。
    // 这是「经典 → 量子态制备描述」的可复现映射；真实 QDS 的 QOWF 应使用更严格的
    // 量子单向构造，此处以哈希扩展作为可运行的参考模型。
    class QuantumOneWayFunction
    {
    public:
        static PreparationSpec evaluate(const Bytes &key, size_t m)
        {
            Bytes stream;
            Bytes counter;
            // 用计数器 + 密钥迭代哈希，生成足够长的确定性比特流。
            for (uint64_t c = 0; stream.size() < 2 * m; ++c)
            {
                Bytes block = key;
                for (int i = 0; i < 8; ++i)
                    block.push_back(Byte((c >> (8 * i)) & 0xFF));
                Bytes h;
                for (Byte b : sha256(block))
                    h.push_back(b);
                stream.insert(stream.end(), h.begin(), h.end());
            }
            PreparationSpec spec;
            spec.basis.resize(m);
            spec.value.resize(m);
            for (size_t i = 0; i < m; ++i)
            {
                spec.basis[i] = (stream[2 * i] & 1) != 0;
                spec.value[i] = (stream[2 * i + 1] & 1) != 0;
            }
            return spec;
        }
    };

    // ─── 量子数字签名 ─────────────────────────────────────────────────
    class QuantumDigitalSignature
    {
    public:
        struct SigningKey
        {
            Bytes secret;              // 经典秘密
            PreparationSpec public_spec; // 量子公钥的制备描述
        };

        // 生成一次性签名密钥：m 比特量子公钥。
        static SigningKey keygen(size_t m)
        {
            Rng rng;
            SigningKey kp;
            kp.secret = rng.random_bytes(32);
            kp.public_spec = QuantumOneWayFunction::evaluate(kp.secret, m);
            return kp;
        }

        // 在量子后端上制备量子公钥 |f(k)>（分配 m 个量子比特并编码）。
        // 返回分配的起始量子比特 id。
        static size_t prepare_public_state(qhal::IQuantumBackend *backend, const PreparationSpec &spec)
        {
            size_t m = spec.size();
            backend->allocate_qubits(m);
            for (size_t i = 0; i < m; ++i)
            {
                if (spec.value[i])
                    backend->apply_x(i);
                if (spec.basis[i])
                    backend->apply_h(i);
            }
            return 0;
        }

        // 签名：对 message 哈希，逐比特揭示秘密扩展比特流，形成经典签名。
        static Bytes sign(const SigningKey &kp, const Bytes &message)
        {
            Bytes stream;
            Bytes counter;
            for (uint64_t c = 0; stream.size() < kp.public_spec.size(); ++c)
            {
                Bytes block = kp.secret;
                for (int i = 0; i < 8; ++i)
                    block.push_back(Byte((c >> (8 * i)) & 0xFF));
                Bytes h;
                for (Byte b : sha256(block))
                    h.push_back(b);
                stream.insert(stream.end(), h.begin(), h.end());
            }
            Hash256 digest = sha256(message);
            Bytes sig;
            // 签名 = 消息摘要 ⊕ 公开态值（模拟「揭示与消息相关的密钥位」）。
            for (size_t i = 0; i < kp.public_spec.size(); ++i)
            {
                int vb = kp.public_spec.value[i] ? 1 : 0;
                int mb = (digest[i / 8] >> (7 - i % 8)) & 1;
                sig.push_back(Byte((vb ^ mb) & 1));
            }
            return sig;
        }

        // 验证：在量子后端上制备 |f(k)>，按公开基测量，与（签名 ⊕ 消息摘要）比对。
        // 注意：每次验证消耗量子公钥（破坏性测量）——这正是 QDS 的「有限次验证」特性。
        static bool verify(qhal::IQuantumBackend *backend, const SigningKey &kp,
                           const Bytes &message, const Bytes &signature)
        {
            size_t m = kp.public_spec.size();
            if (signature.size() != m)
                return false;
            backend->allocate_qubits(m);
            Hash256 digest = sha256(message);
            size_t accept = 0;
            for (size_t i = 0; i < m; ++i)
            {
                // 制备 |f(k)> 的第 i 比特。
                if (kp.public_spec.value[i])
                    backend->apply_x(i);
                if (kp.public_spec.basis[i])
                    backend->apply_h(i);

                // 测量（X 基先 H）。
                if (kp.public_spec.basis[i])
                    backend->apply_h(i);
                int outcome = backend->measure(i);

                int expected = signature[i] ^ ((digest[i / 8] >> (7 - i % 8)) & 1);
                if (outcome == expected)
                    ++accept;
            }
            for (size_t i = 0; i < m; ++i)
                backend->release_qubit(i);
            // 允许统计容差：合法噪声下大部分应一致。
            double ratio = m == 0 ? 0.0 : double(accept) / double(m);
            return ratio >= 0.95;
        }
    };

}