#pragma once
// ============================================================================
// Ta.hpp —— 多维拓扑线程分析（TTA）
//
// qk 语言引入 @layer(time, thread, coord[, cost][, deadline]) 多维拓扑标签，
// 把程序组织为 (time × thread × coord) 的执行拓扑。服务端 TopologyBuilder 已
// 完成「同 coord 叠加成时序链 / 异 coord 空间并置 / 调用传播延迟」的静态推导，
// Ta主要在运行时侧补充拓扑线程优化分析（可扩）：
//
//   1. 虚拟拓扑线程（VTT）
//        layer 的 coord 下的子集——共享同一 coord（或其前缀投影）的块，按 time
//        串行堆叠成一条「虚拟线程」，是跨 coord 空间切片得到的执行单元。
//        coord 维度可被「前缀投影」压缩，从而得到不同粗细粒度的虚拟线程。
//
//   2. 拓扑间纠错能力（TEC）
//        两条虚拟线程在 coord 格点上的 L1（曼哈顿）距离即「码距 d」。按面码
//        （surface code）理论：码距 d 的编码可纠正 ⌊(d−1)/2⌋ 个错误、检测 d−1
//        个错误。据此量化拓扑区域之间的纠错能力（d 越大，逻辑 qubit 隔离越强）。
//
//   3. 拓扑线程间残差并发（RC）
//        线程内部串行（堆叠链）、线程之间并行（空间并置）。用 work-span 模型：
//        关键路径 = 最长虚拟线程的总成本；残差并发度 = 总工作量 / 关键路径
//        （可并行度下界，Amdahl 律风格），并给出每个 time 层的可并发宽度，
//        指导运行时「层间顺序、层内并行」的调度粒度。
// ============================================================================

#include <vector>
#include <string>
#include <map>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <limits>

namespace ta {

// ─── 拓扑块：对应 @layer(time, thread, coord, cost, deadline) ──────────────
struct Block {
    std::string name;          // 块名（函数名）
    int         time   = 0;    // 锚点时间（coord 时序链上的启动槽位）
    int         thread = 0;    // 逻辑线程 id（同线程串行、异线程可并行）
    std::vector<int> coord;    // N 维运行层坐标
    int         cost     = 1;  // 执行成本（默认 1）
    int         deadline = 0;  // 时间束缚上限（0 = 无 deadline）
};

// ─── 运行形状：(time, thread, coord[0..n-1]) 各维大小 ───────────────────────
struct Shape {
    int time   = 0;
    int thread = 0;
    std::vector<int> coord;    // 每维 = max(coord[i]) + 1
};

// ─── 虚拟拓扑线程：coord 下的子集（共享 coord 的块，按 time 串行堆叠）──────
struct VirtualThread {
    std::vector<int>    coord;       // 该虚拟线程的 coord（前缀投影后）
    int                 thread = -1; // 代表线程 id（同 coord 同 thread 时）
    std::vector<size_t> blocks;      // 块下标（按 time 升序）
    int                 anchor = 0;  // 最小 time（首块启动槽位）
    int                 span   = 0;  // 时间跨度 = max_time − anchor + 1
    int                 total_cost = 0; // 总成本（= 该线程的关键路径贡献）
};

// ─── 拓扑间纠错能力：码距 + 可纠/可检错误数 ────────────────────────────────
struct ErrorCorrection {
    int distance    = 0;   // 码距 d = coord 的 L1 距离
    int correctable = 0;   // 可纠正错误数 ⌊(d−1)/2⌋
    int detectable  = 0;   // 可检测错误数 d−1
};

// ─── 残差并发画像 ───────────────────────────────────────────────────────────
struct ConcurrencyProfile {
    int              critical_path = 0;    // 关键路径 = 最长虚拟线程总成本
    int              total_work    = 0;    // 总工作量 = Σ cost
    double           residual_parallelism = 0.0; // 残差并发度 = total_work / critical_path
    std::vector<int> per_time_width;       // 每个 time 槽的可并发块数（跨线程）
    int              max_width = 0;        // 最大并发宽度
};

// ─── 逻辑 qubit 布局（按码距）───────────────────────────────────────────────
struct LogicalQubitLayout {
    std::vector<int> qubit_id;               // 虚拟线程 → 逻辑 qubit id（coord 序）
    std::vector<std::vector<int>> distance;  // 码距矩阵（对称，对角线 0）
    int min_distance = 0;                    // 最小码距（全局纠错瓶颈）
    std::vector<std::vector<size_t>> independent_sets; // 独立集：同集内两两码距 >= 阈值，可并行
};

// ─── 拓扑分析器 ─────────────────────────────────────────────────────────────
class TopologyAnalyzer {
public:
    TopologyAnalyzer() = default;
    explicit TopologyAnalyzer(std::vector<Block> blocks) : blocks_(std::move(blocks)) {}

    void set_blocks(std::vector<Block> blocks) { blocks_ = std::move(blocks); }
    const std::vector<Block>& blocks() const { return blocks_; }
    size_t size() const { return blocks_.size(); }

    // 运行形状聚合
    Shape shape() const {
        Shape s;
        for (const auto& b : blocks_) {
            s.time   = std::max(s.time,   b.time + 1);
            s.thread = std::max(s.thread, b.thread + 1);
            if (s.coord.size() < b.coord.size()) s.coord.resize(b.coord.size(), 0);
            for (size_t i = 0; i < b.coord.size(); ++i)
                s.coord[i] = std::max(s.coord[i], b.coord[i] + 1);
        }
        return s;
    }

    // 虚拟拓扑线程构建。
    //    coord_prefix: -1 → 全部 coord 维度（精确 coord，最细粒度）；
    //                  k ≥ 0 → 只用前 k 维做前缀投影（粗粒度虚拟线程）。
    std::vector<VirtualThread> build_virtual_threads(int coord_prefix = -1) const {
        std::map<std::vector<int>, VirtualThread> groups;
        for (size_t i = 0; i < blocks_.size(); ++i) {
            const Block& b = blocks_[i];
            std::vector<int> key = b.coord;
            if (coord_prefix >= 0 && static_cast<int>(key.size()) > coord_prefix)
                key.resize(static_cast<size_t>(coord_prefix));

            auto it = groups.find(key);
            if (it == groups.end()) {
                VirtualThread vt;
                vt.coord   = key;
                vt.thread  = b.thread;
                vt.anchor  = b.time;
                it = groups.emplace(key, std::move(vt)).first;
            }
            it->second.blocks.push_back(i);
        }

        std::vector<VirtualThread> out;
        out.reserve(groups.size());
        for (auto& [key, vt] : groups) {
            // 组内按 time 升序（堆叠链的时序顺序）
            std::sort(vt.blocks.begin(), vt.blocks.end(), [this](size_t x, size_t y) {
                return blocks_[x].time < blocks_[y].time;
            });
            vt.anchor     = vt.blocks.empty() ? 0 : blocks_[vt.blocks.front()].time;
            const int max_t = vt.blocks.empty() ? 0 : blocks_[vt.blocks.back()].time;
            vt.span       = vt.blocks.empty() ? 0 : (max_t - vt.anchor + 1);
            vt.total_cost = 0;
            for (size_t id : vt.blocks) vt.total_cost += blocks_[id].cost;
            out.push_back(std::move(vt));
        }
        return out;
    }

    // 拓扑间纠错能力：两虚拟线程的码距 + 可纠/可检错误数。
    static ErrorCorrection error_correction(const VirtualThread& a, const VirtualThread& b) {
        ErrorCorrection ec;
        const size_t n = std::max(a.coord.size(), b.coord.size());
        for (size_t i = 0; i < n; ++i) {
            const int x = (i < a.coord.size()) ? a.coord[i] : 0;
            const int y = (i < b.coord.size()) ? b.coord[i] : 0;
            ec.distance += std::abs(x - y);
        }
        // 面码：码距 d 可纠正 ⌊(d−1)/2⌋ 个错误、检测 d−1 个错误。
        ec.correctable = std::max(0, (ec.distance - 1) / 2);
        ec.detectable  = std::max(0, ec.distance - 1);
        return ec;
    }

    // 码距矩阵（对称，对角线为 0）。
    std::vector<std::vector<int>> distance_matrix(const std::vector<VirtualThread>& threads) const {
        const size_t n = threads.size();
        std::vector<std::vector<int>> m(n, std::vector<int>(n, 0));
        for (size_t i = 0; i < n; ++i)
            for (size_t j = i + 1; j < n; ++j) {
                const int d = error_correction(threads[i], threads[j]).distance;
                m[i][j] = m[j][i] = d;
            }
        return m;
    }

    // 拓扑线程间残差并发：work-span 模型 + 逐 time 层并发宽度。
    ConcurrencyProfile residual_concurrency(const std::vector<VirtualThread>& threads) const {
        ConcurrencyProfile p;
        for (const auto& vt : threads) {
            p.critical_path = std::max(p.critical_path, vt.total_cost);
            for (size_t id : vt.blocks) p.total_work += blocks_[id].cost;
        }
        // 残差并发度 = 总工作量 / 关键路径（可并行度下界）。
        if (p.critical_path > 0)
            p.residual_parallelism = static_cast<double>(p.total_work) / static_cast<double>(p.critical_path);

        // 每个 time 槽的可并发块数（跨虚拟线程，异 coord 同 time 即可并行）。
        std::map<int, int> width;
        int max_t = 0;
        for (const auto& vt : threads)
            for (size_t id : vt.blocks) {
                const int t = blocks_[id].time;
                width[t]++;
                max_t = std::max(max_t, t);
            }
        p.per_time_width.assign(static_cast<size_t>(max_t) + 1, 0);
        for (const auto& [t, w] : width) p.per_time_width[static_cast<size_t>(t)] = w;
        for (int w : p.per_time_width) p.max_width = std::max(p.max_width, w);
        return p;
    }

    // 便捷：两条虚拟线程之间的残差并发（可重叠执行的下限 = min(两线程成本)，
    // 异 coord 无依赖可完全重叠；同 coord 属同一条链，残差并发为 0）。
    static int pairwise_residual_concurrency(const VirtualThread& a, const VirtualThread& b) {
        if (a.coord == b.coord) return 0;      // 同 coord：串行堆叠，无并发
        return std::min(a.total_cost, b.total_cost);
    }

    // 逻辑 qubit 布局（按码距）：
    //    每个虚拟线程 = 一个逻辑 qubit；码距 = coord 的 L1 距离。
    //    用贪心着色把虚拟线程划分为独立集：同集内两两码距 >= min_distance
    //    （可安全并行，串扰可忽略），不同集之间串行执行。
    LogicalQubitLayout logical_qubit_layout(const std::vector<VirtualThread>& threads,
                                            int min_distance = 1) const {
        LogicalQubitLayout L;
        const size_t n = threads.size();
        L.qubit_id.resize(n);
        for (size_t i = 0; i < n; ++i) L.qubit_id[i] = static_cast<int>(i);
        L.distance = distance_matrix(threads);

        L.min_distance = std::numeric_limits<int>::max();
        for (size_t i = 0; i < n; ++i)
            for (size_t j = i + 1; j < n; ++j)
                L.min_distance = std::min(L.min_distance, L.distance[i][j]);
        if (L.min_distance == std::numeric_limits<int>::max()) L.min_distance = 0; // 单线程

        std::vector<std::vector<size_t>> sets;
        for (size_t i = 0; i < n; ++i) {
            bool placed = false;
            for (auto& s : sets) {
                bool ok = true;
                for (size_t j : s)
                    if (L.distance[i][j] < min_distance) { ok = false; break; }
                if (ok) { s.push_back(i); placed = true; break; }
            }
            if (!placed) sets.push_back({i});
        }
        L.independent_sets = std::move(sets);
        return L;
    }

private:
    std::vector<Block> blocks_;
};

}