// ============================================================================
// qchain 自测（核心验证）
//
// 覆盖不依赖 Kokkos 的 qchain 核心层：
//   • 密码学原语：SHA3 / HMAC / HKDF / ML-KEM-768 / LweKem / Csprng
//   • 语义哈希：UnicodeHash256（汉字→拼音→SHA-256）
//   • 因果哨兵：CausalityGuard（快子场能量守恒 + KK 对称）
//   • 时空加密：SpacetimeCipher（OFB/CTR 往返）
//   • 账本完整性：UTXO 双花检测、签名自包含
//
// 编译：clang++ -std=c++20 -D_USE_MATH_DEFINES -DQUARK_RT_BUILD
//        -I runtime/include runtime/src/qchain_selftest.cpp
// ============================================================================
#include <cassert>
#include <cctype>
#include <iostream>
#include <string>
#include <vector>

#include "qchain/primitives/hash.hpp"
#include "qchain/primitives/sha3.hpp"
#include "qchain/primitives/pqc.hpp"
#include "qchain/primitives/ml_kem_kat.hpp"
#include "qchain/primitives/ml_dsa.hpp"
#include "qchain/primitives/ml_dsa_kat.hpp"
#include "qchain/primitives/causality.hpp"
#include "qchain/primitives/spacetime_cipher.hpp"
#include "qchain/ledger/transaction.hpp"
#include "qchain/ledger/block.hpp"
#include "qchain/ledger/chain.hpp"
#include "utils/UnicodeHash256.hpp"

static int g_failures = 0;

#define CHECK(cond)                                                            \
    do                                                                         \
    {                                                                          \
        if (!(cond))                                                           \
        {                                                                      \
            ++g_failures;                                                      \
            std::cerr << "FAIL: " << #cond << " (line " << __LINE__ << ")\n";  \
        }                                                                      \
    } while (0)

using qchain::Bytes;
using qchain::to_hex;

static void test_hash_family()
{
    using qchain::crypto::sha3_256;
    using qchain::crypto::hmac_sha256;
    using qchain::crypto::hkdf_sha256;
    using qchain::crypto::sha256;

    CHECK(to_hex(sha256(Bytes{'a', 'b', 'c'})) ==
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    CHECK(to_hex(sha3_256(Bytes{})) ==
          "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a");

    Bytes key(20, 0x0b);
    Bytes data = {'H', 'i', ' ', 'T', 'h', 'e', 'r', 'e'};
    CHECK(to_hex(hmac_sha256(key, data)) ==
          "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");

    Bytes ikm = {1, 2, 3}, salt = {0xaa, 0xbb}, info = {'i', 'n', 'f', 'o'};
    CHECK(hkdf_sha256(ikm, salt, info, 32) == hkdf_sha256(ikm, salt, info, 32));
}

static void test_mlkem()
{
    auto [ek, dk] = qchain::pqc::MlKem768::keygen();
    CHECK(ek.size() == 1184 && dk.size() == 2400);
    auto [ct, ss1] = qchain::pqc::MlKem768::encaps(ek);
    CHECK(ct.size() == 1088 && ss1.size() == 32);
    CHECK(qchain::pqc::MlKem768::decaps(dk, ct) == ss1);
}

static void test_mlkem_kat()
{
    using qchain::from_hex;
    using qchain::to_hex;

    // hex 统一转大写（KAT 为大写，to_hex 输出小写）。
    auto upper = [](std::string s) {
        for (auto &c : s)
            c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        return s;
    };

    // KeyGen KAT：d || z → (ek, dk)（逐字节比对 FIPS 203）
    Bytes coins = from_hex(qchain_kat::D());
    Bytes z = from_hex(qchain_kat::Z());
    coins.insert(coins.end(), z.begin(), z.end());
    auto [ek, dk] = qchain::pqc::MlKem768::keygen_derand(coins);
    CHECK(upper(to_hex(ek)) == qchain_kat::EK());
    CHECK(upper(to_hex(dk)) == qchain_kat::DK());

    // Encaps KAT：ek, m → (ct, ss)
    auto [ct, ss] = qchain::pqc::MlKem768::encaps_derand(
        from_hex(qchain_kat::ENC_EK()), from_hex(qchain_kat::M()));
    CHECK(upper(to_hex(ct)) == qchain_kat::C());
    CHECK(upper(to_hex(ss)) == qchain_kat::K());

    // Decaps KAT：dk, ct → ss
    Bytes ss2 = qchain::pqc::MlKem768::decaps(
        from_hex(qchain_kat::ENC_DK()), from_hex(qchain_kat::C()));
    CHECK(upper(to_hex(ss2)) == qchain_kat::K());
}

static void test_mldsa()
{
    auto [pk, sk] = qchain::pqc::MlDsa65::keygen();
    CHECK(pk.size() == 1952 && sk.size() == 4032);
    Bytes msg = {'q', 'c', 'h', 'a', 'i', 'n'};
    Bytes sig = qchain::pqc::MlDsa65::sign(sk, msg);
    CHECK(sig.size() == 3309);
    CHECK(qchain::pqc::MlDsa65::verify(pk, msg, sig));
    Bytes bad = msg;
    bad[0] ^= 1;
    CHECK(!qchain::pqc::MlDsa65::verify(pk, bad, sig)); // 篡改检测
}

static void test_mldsa_kat()
{
    using qchain::from_hex;
    using qchain::to_hex;
    auto upper = [](std::string s) {
        for (auto &c : s)
            c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        return s;
    };

    // KeyGen KAT：seed → (pk, sk)（逐字节比对 FIPS 204）
    auto [pk, sk] = qchain::pqc::MlDsa65::keygen_derand(from_hex(qchain_kat::DSA_SEED()));
    CHECK(upper(to_hex(pk)) == qchain_kat::DSA_PK());
    CHECK(upper(to_hex(sk)) == qchain_kat::DSA_SK());
}

static void test_sig_factory()
{
    using qchain::pqc::SigScheme;
    // 三种签名方案（多态工厂）：ML-DSA-65 / UOV / Lamport
    for (auto s : {SigScheme::ML_DSA, SigScheme::UOV, SigScheme::LAMPORT_OTS})
    {
        auto scheme = qchain::pqc::make_sig_scheme(s);
        auto [sk, pk] = scheme->keygen();
        Bytes msg = {'f', 'a', 'c', 't', 'o', 'r', 'y'};
        Bytes sig = scheme->sign(sk, msg);
        CHECK(scheme->verify(pk, msg, sig));
        Bytes bad = msg;
        bad[0] ^= 1;
        CHECK(!scheme->verify(pk, bad, sig)); // 篡改检测
    }
}

static void test_uov()
{
    auto [sk, pk] = qchain::pqc::UovSignature::keygen();
    Bytes msg = {'u', 'o', 'v', '-', 'm', 'q'};
    Bytes sig = qchain::pqc::UovSignature::sign(sk, msg);
    CHECK(sig.size() == qchain::pqc::UovParams::N);
    CHECK(qchain::pqc::UovSignature::verify(pk, msg, sig));
    Bytes bad = msg;
    bad[0] ^= 1;
    CHECK(!qchain::pqc::UovSignature::verify(pk, bad, sig)); // 篡改检测
}

static void test_lwe_kem()
{
    qchain::pqc::LweKem kem;
    auto [sk, pk] = kem.keygen();
    auto [ct, ss1] = kem.encaps(pk);
    CHECK(kem.decaps(sk, ct) == ss1);
}

static void test_csprng()
{
    qchain::Csprng a(Bytes{1, 2, 3, 4});
    qchain::Csprng b(Bytes{1, 2, 3, 4});
    qchain::Csprng c(Bytes{5, 6, 7, 8});
    CHECK(a.random_bytes(64) == b.random_bytes(64));
    CHECK(a.random_bytes(64) != c.random_bytes(64));
}

static void test_unicode_hash()
{
    using qhal::transliterate;
    using qhal::unicode_hash256;
    CHECK(transliterate("我") == "wo");
    CHECK(transliterate("我爱你") == "woaini");
    CHECK(unicode_hash256("我") == unicode_hash256("wo"));
    CHECK(unicode_hash256("你好") == unicode_hash256("nihao"));
    CHECK(transliterate("♥") == "heart");
}

static void test_causality_guard()
{
    qchain::causality::CausalityGuard guard;
    CHECK(guard.verify());
    for (int i = 0; i < 100; ++i)
        guard.step();
    CHECK(guard.verify_energy());
    CHECK(guard.verify_kaluza_klein());
    CHECK(guard.fingerprint() != qchain::causality::CausalityGuard().fingerprint());
}

static void test_spacetime_cipher()
{
    using qchain::spacetime_crypto::SpacetimeCipher;
    using qchain::spacetime_crypto::CipherMode;
    Bytes msg(1000);
    for (size_t i = 0; i < msg.size(); ++i)
        msg[i] = static_cast<uint8_t>((i * 37 + 11) & 0xFF);

    SpacetimeCipher e1(12345, CipherMode::OFB), d1(12345, CipherMode::OFB);
    CHECK(d1.decrypt(e1.encrypt(msg)) == msg);
    SpacetimeCipher e2(12345, CipherMode::CTR), d2(12345, CipherMode::CTR);
    CHECK(d2.decrypt(e2.encrypt(msg)) == msg);
}

static void test_utxo_and_signature()
{
    using qchain::ledger::QChain;
    using qchain::ledger::Block;
    using qchain::ledger::Transaction;
    using qchain::ledger::TxInput;
    using qchain::ledger::TxOutput;
    using qchain::ledger::SignedTransaction;
    using qchain::pqc::LamportOts;

    LamportOts ots;
    auto [sk, pk] = ots.keygen();
    qchain::ledger::Address addr = qchain::crypto::derive_address(pk);

    // 构造一个引用输出 (txid, 0) 的交易并签名。
    Transaction tx;
    TxInput in;
    in.prev_txid = qchain::crypto::sha256(Bytes{'u', 't', 'x', 'o'});
    in.output_index = 0;
    tx.inputs.push_back(in);
    tx.outputs.push_back({addr, 100});
    tx.timestamp = 1;

    SignedTransaction st;
    st.tx = tx;
    st.public_key = pk;
    st.signature = ots.sign(sk, qchain::to_bytes(tx.txid()));
    CHECK(st.verify(ots)); // 自包含签名验证

    // 区块 1：花费 (txid, 0)。
    Block b1;
    b1.header.prev_hash = QChain::make_genesis().hash();
    b1.transactions.push_back(st);
    b1.finalize();

    QChain chain;
    chain.init_genesis();
    CHECK(chain.append(b1));
    CHECK(chain.is_output_spent(in.prev_txid, 0)); // 已标记花费

    // 区块 2：再次花费同一输出 → 双花应被拒绝。
    Block b2;
    b2.header.prev_hash = b1.hash();
    SignedTransaction st2 = st; // 复制同一输入（双花）
    b2.transactions.push_back(st2);
    b2.finalize();
    CHECK(!chain.append(b2)); // 双花检测拒绝
    CHECK(chain.validate());
}

int main()
{
    test_hash_family();
    test_mlkem();
    test_mlkem_kat();
    test_mldsa();
    test_mldsa_kat();
    test_uov();
    test_sig_factory();
    test_lwe_kem();
    test_csprng();
    test_unicode_hash();
    test_causality_guard();
    test_spacetime_cipher();
    test_utxo_and_signature();

    if (g_failures == 0)
    {
        std::cout << "ALL QCHAIN SELFTESTS PASSED\n";
        return 0;
    }
    std::cout << g_failures << " QCHAIN TEST(S) FAILED\n";
    return 1;
}