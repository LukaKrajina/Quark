#pragma once
//
// qchain :: 账本层 —— 量子链（QChain）
//
// 量子区块链本体：由哈希指针 + 量子纠缠链接串联的区块序列。
// 提供创世块、区块追加（结构校验）、全链校验与分叉解决（最长/最大累积难度）。
//
#include "../common.hpp"
#include "../primitives/hash.hpp"
#include "block.hpp"
#include <iostream>
#include <vector>
#include <functional>
#include <set>
#include <utility>

namespace qchain::ledger
{

    using qchain::Byte;
    using qchain::Bytes;
    using qchain::Hash256;
    using crypto::sha256;

    class QChain
    {
    private:
        std::vector<Block> blocks;
        // 已花费输出集合（UTXO 双花检测）：(前序交易 txid, 输出索引)
        std::set<std::pair<Hash256, uint32_t>> spent_outputs;

        // UTXO 双花校验：区块内交易的每个输入都不得引用已花费的输出。
        bool validate_utxo(const Block &block) const
        {
            for (const auto &st : block.transactions)
                for (const auto &in : st.tx.inputs)
                    if (!(in.prev_txid == Hash256{}) &&
                        spent_outputs.count({in.prev_txid, in.output_index}) != 0)
                    {
                        std::cerr << "[qchain] append rejected: double-spend detected.\n";
                        return false;
                    }
            return true;
        }

    public:
        QChain() = default;

        // 创建创世块。
        static Block make_genesis(uint64_t timestamp = 0)
        {
            Block g;
            g.header.version = 1;
            g.header.prev_hash = Hash256{}; // 全零
            g.header.timestamp = timestamp;
            g.header.nonce = 0;
            g.finalize();
            return g;
        }
        
        // 初始化为只有创世块的链。
        void init_genesis(uint64_t timestamp = 0)
        {
            blocks.clear();
            blocks.push_back(make_genesis(timestamp));
        }

        size_t height() const { return blocks.size(); }
        const Block &at(size_t i) const { return blocks.at(i); }
        const Block &tip() const { return blocks.back(); }
        const std::vector<Block> &get_blocks() const { return blocks; }

        // 追加区块（结构校验：前哈希、默克尔根、区块哈希自洽）。
        bool append(const Block &block)
        {
            if (blocks.empty())
            {
                // 若为空，先放创世块。
                blocks.push_back(make_genesis(0));
            }
            const Block &prev = blocks.back();
            if (!std::equal(block.header.prev_hash.begin(), block.header.prev_hash.end(),
                            prev.hash().begin()))
            {
                std::cerr << "[qchain] append rejected: prev_hash mismatch.\n";
                return false;
            }
            // 校验默克尔根与交易一致。
            Hash256 computed = block.compute_merkle_root();
            if (!std::equal(computed.begin(), computed.end(), block.header.merkle_root.begin()))
            {
                std::cerr << "[qchain] append rejected: merkle root mismatch.\n";
                return false;
            }
            // UTXO 双花校验。
            if (!validate_utxo(block))
                return false;
            // 标记本区块交易的输入为「已花费」（coinbase 无输入，跳过）。
            for (const auto &st : block.transactions)
                for (const auto &in : st.tx.inputs)
                    if (!(in.prev_txid == Hash256{}))
                        spent_outputs.insert({in.prev_txid, in.output_index});
            blocks.push_back(block);
            return true;
        }

        // 查询某输出是否已被花费。
        bool is_output_spent(const Hash256 &txid, uint32_t index) const
        {
            return spent_outputs.count({txid, index}) != 0;
        }

        // 全链结构校验（哈希链完整 + 每块默克尔根自洽）。
        bool validate() const
        {
            if (blocks.empty())
                return false;
            for (size_t i = 1; i < blocks.size(); ++i)
            {
                const Block &prev = blocks[i - 1];
                const Block &cur = blocks[i];
                if (!std::equal(cur.header.prev_hash.begin(), cur.header.prev_hash.end(),
                                prev.hash().begin()))
                    return false;
                if (!std::equal(cur.header.merkle_root.begin(), cur.header.merkle_root.end(),
                                cur.compute_merkle_root().begin()))
                    return false;
            }
            return true;
        }

        // 分叉解决：从候选中选择「高度更高，或同高时累积 nonce 更大」的链。
        // 返回获胜链的拷贝（供共识层替换本地视图）。
        static std::vector<Block> resolve_fork(const std::vector<Block> &a,
                                               const std::vector<Block> &b)
        {
            auto weight = [](const std::vector<Block> &c) -> uint64_t {
                uint64_t w = 0;
                for (const auto &blk : c)
                    w += blk.header.nonce + 1; // 简单累积工作量
                return w;
            };
            if (a.size() != b.size())
                return a.size() > b.size() ? a : b;
            return weight(a) >= weight(b) ? a : b;
        }
        
        void replace(const std::vector<Block> &new_blocks) { blocks = new_blocks; }
    };
}