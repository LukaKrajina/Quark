#pragma once
//
// qchain :: 服务层 —— QChainService（量子区块链服务编排器）
//
// 将「后量子密码 / 量子密钥分发 / 量子拜占庭共识 / 量子货币」组装为
// 一个可直接使用的量子区块链服务。其他开发者基于本服务即可创建各种量子币种与
// 量子区块链服务：
//
//   • 钱包：后量子密钥对（Merkle 多次签名）+ 量子安全地址
//   • 铸币 / 转账：coinbase 与 UTXO 交易（后量子签名），记账式余额（原生代币）
//   • 出块：量子 PoW / 量子 PoS / QDBA 最终性
//   • 密钥：QKD（BB84/E91/诱骗态）建立网络共享密钥
//   • 验链：哈希链 + 默克尔根 + 签名自洽校验
//
// 两种后端接入模式：
//   1) 独立创建（C++ 开发者）：QChainService(Config) 自建 QVM/QM 并拥有其生命周期。
//   2) 复用外部后端（qk 桥接）：QChainService(IQuantumBackend*, Config) 绑定 runtime
//      的 global_qm，使 qchain 与 qk 的 alloc/measure 共享同一量子后端。
//
#include "../common.hpp"
#include "../primitives/hash.hpp"
#include "../primitives/pqc.hpp"
#include "../primitives/qkd.hpp"
#include "../primitives/qds.hpp"
#include "../primitives/causality.hpp"
#include "../primitives/spacetime_cipher.hpp"
#include "../ledger/chain.hpp"
#include "../consensus/consensus.hpp"
#include "../token/quantum_coin.hpp"
#include "../../qhal/QM.hpp"
#include "../../qhal/QVM.hpp"
#include "../../qhal/Export.hpp"
#include <iostream>
#include <memory>
#include <unordered_map>
#include <chrono>
#include <mutex>

namespace qchain
{

    class QUARK_RT_API QChainService
    {
    public:
        struct Config
        {
            bool use_real_quantum_machine = false;
            qhal::HardwareModality hardware = qhal::HardwareModality::Superconducting;
            pqc::KemScheme kem_scheme = pqc::KemScheme::LWE_REFERENCE;
            pqc::SigScheme sig_scheme = pqc::SigScheme::MERKLE_XMSS;
            size_t merkle_height = 4; // 钱包签名树的叶数 = 2^height 次签名
            consensus::ConsensusProtocol consensus = consensus::ConsensusProtocol::QuantumPoW;
            unsigned pow_difficulty = 1;
            bool qkd_enabled = true;
        };

        // 钱包：后量子签名器（多态，支持 ML-DSA / UOV / Lamport）+ 密钥 + 量子安全地址。
        struct Wallet
        {
            std::unique_ptr<pqc::ISignatureScheme> scheme;
            Bytes secret_key;
            Bytes public_key;
            ledger::Address address;
        };

    private:
        Config config;
        qhal::IQuantumBackend *backend = nullptr;             // 非拥有（复用 global_qm）
        std::unique_ptr<qhal::IQuantumBackend> owned_backend; // 独立创建时拥有
        qhal::QM *qm_ptr = nullptr;
        qhal::QVM *qvm_ptr = nullptr;

        ledger::QChain chain;
        std::vector<Wallet> wallets;
        std::unordered_map<ledger::Address, Bytes, Hash256Hasher> address_to_pk;

        std::vector<ledger::SignedTransaction> mempool;
        token::QuantumToken native_token;
        pqc::LweKem kem;
        Bytes network_key;                        // 由 QKD 建立的网络共享密钥
        causality::CausalityGuard causal_guard;   // 快子场因果哨兵（防超时空）

        mutable std::mutex mtx_; // 保护 wallets / mempool / native_token / chain（线程安全）

        static uint64_t now_ms()
        {
            using namespace std::chrono;
            return static_cast<uint64_t>(
                duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());
        }

    public:
        // 独立创建后端（C++ 开发者直接使用，拥有后端生命周期）。
        explicit QChainService(const Config &cfg)
            : config(cfg), native_token({"QuantumCoin", "QKC", 0})
        {
            if (cfg.use_real_quantum_machine)
            {
                auto qm = std::make_unique<qhal::QM>(cfg.hardware, 0);
                qm_ptr = qm.get();
                backend = qm.get();
                owned_backend = std::move(qm);
            }
            else
            {
                auto qvm = std::make_unique<qhal::QVM>();
                qvm_ptr = qvm.get();
                backend = qvm.get();
                owned_backend = std::move(qvm);
            }
            chain.init_genesis(0);
            std::cout << "[qchain] Quantum blockchain service online (backend: "
                      << (cfg.use_real_quantum_machine ? "QM" : "QVM") << ").\n";
        }

        // 复用外部后端（qk 桥接用 runtime 的 global_qm），不拥有其生命周期。
        QChainService(qhal::IQuantumBackend *external_backend, const Config &cfg)
            : config(cfg), native_token({"QuantumCoin", "QKC", 0}), backend(external_backend)
        {
            chain.init_genesis(0);
            std::cout << "[qchain] Quantum blockchain service attached to external backend.\n";
        }

        qhal::IQuantumBackend *get_backend() { return backend; }
        ledger::QChain &get_chain() { return chain; }
        const Config &get_config() const { return config; }
        token::QuantumToken &native_coin() { return native_token; }
        const std::vector<ledger::SignedTransaction> &get_mempool() const { return mempool; }
        size_t wallet_count() const { return wallets.size(); }
        Wallet &get_wallet(size_t index) { return wallets.at(index); }
        const Wallet &get_wallet(size_t index) const { return wallets.at(index); }

        // ─── 钱包 ─────────────────────────────────────────────────────
        Wallet &create_wallet()
        {
            std::lock_guard<std::mutex> lock(mtx_);
            wallets.emplace_back();
            Wallet &w = wallets.back();
            w.scheme = pqc::make_sig_scheme(config.sig_scheme);
            auto [sk, pk] = w.scheme->keygen();
            w.secret_key = std::move(sk);
            w.public_key = std::move(pk);
            w.address = crypto::derive_address(w.public_key);
            address_to_pk[w.address] = w.public_key;
            std::cout << "[qchain] wallet created (" << static_cast<int>(config.sig_scheme)
                      << "): " << to_hex(w.address) << "\n";
            return w;
        }

        // ─── QKD 网络密钥 ─────────────────────────────────────────────
        qkd::QkdResult establish_qkd(size_t num_rounds = 64)
        {
            auto res = qkd::BB84::run(backend, num_rounds);
            network_key = res.shared_key;
            std::cout << "[qchain] QKD established (QBER=" << res.error_rate
                      << ", key=" << to_hex(network_key).substr(0, 16) << "...)\n";
            return res;
        }

        // ─── 铸币（完整签名交易版，供 C++ 开发者）────────────────────
        // 铸币：生成 coinbase 交易（无输入，单输出到收款地址），记账并进入内存池。
        ledger::SignedTransaction mint(Wallet &to, uint64_t amount)
        {
            std::lock_guard<std::mutex> lock(mtx_);
            ledger::Transaction tx;
            ledger::TxOutput out{to.address, amount};
            tx.outputs.push_back(out);
            tx.timestamp = now_ms();

            ledger::SignedTransaction st;
            st.tx = std::move(tx);
            st.public_key = to.public_key;
            st.signature = to.scheme->sign(to.secret_key, qchain::to_bytes(st.tx.txid()));

            native_token.mint(to.address, amount);
            mempool.push_back(st);
            return st;
        }

        // ─── 转账（完整签名交易版，供 C++ 开发者）────────────────────
        // 转账：生成 UTXO 交易（1 输入 1 输出 + 找零），记账并进入内存池。
        bool transfer(Wallet &from, const ledger::Address &to, uint64_t amount)
        {
            std::lock_guard<std::mutex> lock(mtx_);
            if (native_token.balance_of(from.address) < amount)
            {
                std::cerr << "[qchain] transfer rejected: insufficient balance.\n";
                return false;
            }
            ledger::Transaction tx;
            ledger::TxInput in;
            in.prev_txid = Hash256{}; // 简化：记账式余额为权威，输入引用留空
            in.output_index = 0;
            tx.inputs.push_back(in);
            ledger::TxOutput out1{to, amount};
            tx.outputs.push_back(out1);
            uint64_t change = native_token.balance_of(from.address) - amount;
            if (change > 0)
                tx.outputs.push_back({from.address, change});
            tx.timestamp = now_ms();

            ledger::SignedTransaction st;
            st.tx = std::move(tx);
            st.public_key = from.public_key;
            st.signature = from.scheme->sign(from.secret_key, qchain::to_bytes(st.tx.txid()));

            native_token.transfer(from.address, to, amount);
            mempool.push_back(st);
            return true;
        }

        // ─── 按地址操作（供 qk 语言桥接：qk 仅持有地址字符串）───────
        // 简化记账式余额操作，不生成签名交易（完整签名流程见上方的 mint/transfer）。

        // 铸币到指定地址。
        bool mint_to_address(const ledger::Address &addr, uint64_t amount)
        {
            native_token.mint(addr, amount);
            return true;
        }

        // 地址间转账。
        bool transfer_addresses(const ledger::Address &from, const ledger::Address &to, uint64_t amount)
        {
            return native_token.transfer(from, to, amount);
        }

        // 查询余额。
        uint64_t balance_of_address(const ledger::Address &addr) const
        {
            return native_token.balance_of(addr);
        }

        // ─── 出块 ─────────────────────────────────────────────────────
        // 将内存池打包为区块，运行共识（量子 PoW），追加到链上。
        ledger::Block mine_block()
        {
            std::lock_guard<std::mutex> lock(mtx_);
            ledger::Block blk;
            blk.header.version = 1;
            blk.header.prev_hash = chain.tip().hash();
            blk.header.timestamp = now_ms();
            // 注入 QKD 量子熵（若已建立）。
            blk.header.qkd_entropy = network_key.empty() ? crypto::sha256(Bytes{}) : crypto::sha256(network_key);
            // 量子纠缠链接指纹：由前区块哈希与 QKD 量子熵共同确定（GHZ 态哈希模拟），
            // 在 PoW 之前确定，保证其参与工作量证明的哈希输入。
            Bytes ent;
            ent.insert(ent.end(), blk.header.prev_hash.begin(), blk.header.prev_hash.end());
            ent.insert(ent.end(), blk.header.qkd_entropy.begin(), blk.header.qkd_entropy.end());
            blk.header.entanglement_root = crypto::sha256(ent);
            // 快子场因果指纹（防超时空）：在 PoW 之前确定，参与区块哈希。
            blk.header.causal_root = causal_guard.fingerprint();

            blk.transactions = std::move(mempool);
            blk.finalize();

            if (config.consensus == consensus::ConsensusProtocol::QuantumPoW)
            {
                if (!consensus::ConsensusEngine::quantum_pow(blk, config.pow_difficulty))
                    std::cerr << "[qchain] PoW: difficulty not met within iteration budget.\n";
            }

            if (!chain.append(blk))
                std::cerr << "[qchain] block append failed.\n";
            else
                std::cout << "[qchain] block #" << chain.height() - 1
                          << " mined (" << blk.transactions.size() << " tx).\n";
            mempool.clear();

            // 因果链与区块链同频演化：出块后推进快子场，并校验因果律
            // （能量守恒 + 额外维 KK 对称），检测到超时空干预即告警。
            causal_guard.step();
            if (!causal_guard.verify())
                std::cerr << "[qchain] CAUSALITY VIOLATION DETECTED (超时空干预)!\n";
            return blk;
        }

        // ─── 验链 ─────────────────────────────────────────────────────
        bool verify_chain() const { return chain.validate(); }

        // 校验区块内交易签名（自包含：公钥随交易携带，无需外部映射）。
        bool verify_block_signatures(const ledger::Block &blk) const
        {
            auto scheme = pqc::make_sig_scheme(config.sig_scheme);
            for (const auto &st : blk.transactions)
            {
                if (st.public_key.empty() || st.signature.empty())
                    return false;
                if (!scheme->verify(st.public_key,
                                    qchain::to_bytes(st.tx.txid()),
                                    st.signature))
                    return false;
            }
            return true;
        }

        // ─── 余额查询（按地址）───────────────────────────────────────
        uint64_t balance_of(const ledger::Address &address) const
        {
            return native_token.balance_of(address);
        }

        // ─── 量子拜占庭最终性 ─────────────────────────────────────────
        consensus::QbaResult run_qdba(size_t n_parties, const std::set<size_t> &corrupt,
                                      size_t num_rounds)
        {
            return consensus::QuantumByzantineAgreement::run(backend, n_parties,
                                                             corrupt, num_rounds);
        }

        // ─── 量子货币（Wiesner 不可克隆钞票）──────────────────────────
        // 铸币：在共享后端上制备 n_qubits 量子态，返回钞票描述（含序列号/基/值/起始 id）。
        // 起始 id 取后端当前 qubit 总数，避免与 qk 的 alloc 分配的 qubit 重叠。
        token::QuantumMoney::Banknote mint_quantum_coin(size_t n_qubits)
        {
            size_t start = backend->get_num_qubits();
            return token::QuantumMoney::mint(backend, n_qubits, start);
        }

        // 验证量子钞票（按记录基测量并比对）。
        bool verify_quantum_coin(const token::QuantumMoney::Banknote &note)
        {
            return token::QuantumMoney::verify(backend, note);
        }
    };

}