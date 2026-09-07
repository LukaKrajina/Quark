#pragma once
#include <vector>
#include <complex>
#include <unordered_map>
#include <string>
#include <memory>
#include <functional>
#include <algorithm>
#include <iostream>
#include <iomanip>
#include "../IQuantumBackend.hpp"

// someone header file is invalid, add these manually
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#ifndef M_PI_2
#define M_PI_2 1.5707963267948966
#endif

namespace qhal
{
    class LimTDD
    {
    private:
        struct Node
        {
            uint32_t id;
            std::vector<std::shared_ptr<Node>> edges;
            std::vector<std::complex<double>> xp_stabilizer_map;
        };
        std::shared_ptr<Node> root;

        std::shared_ptr<Node> contract_recursive(std::shared_ptr<Node> current)
        {
            if (!current || current->edges.empty())
                return current;
            std::vector<std::shared_ptr<Node>> contract_edges;
            for (auto &edge : current->edges)
            {
                auto contracted_child = contract_recursive(edge);
                if (contracted_child && is_isomorphic_xp(current->xp_stabilizer_map, contracted_child->xp_stabilizer_map))
                {
                    for (size_t i = 0; i < contracted_child->xp_stabilizer_map.size(); ++i)
                    {
                        if (i < current->xp_stabilizer_map.size())
                        {
                            current->xp_stabilizer_map[i] *= contracted_child->xp_stabilizer_map[i];
                        }
                    }
                    contract_edges.insert(contract_edges.end(),
                                          contracted_child->edges.begin(),
                                          contracted_child->edges.end());
                }
                else
                {
                    contract_edges.push_back(contracted_child);
                }
            }
            current->edges = contract_edges;
            return current;
        }

        bool is_isomorphic_xp(const std::vector<std::complex<double>> &map1,
                              const std::vector<std::complex<double>> &map2) const
        {
            if (map1.size() != map2.size() || map1.empty())
                return false;
            std::complex<double> ratio = map1[0] / (map2[0] + 1e-12);
            for (size_t i = 1; i < map1.size(); ++i)
            {
                if (std::abs(map1[i] - ratio * map2[i]) > 1e-9)
                    return false;
            }
            return true;
        }

        void normalize_recursive(std::shared_ptr<Node> node, double &accumulated_norm)
        {
            if (!node)
                return;

            double local_norm = 0.0;
            for (const auto &val : node->xp_stabilizer_map)
            {
                local_norm += std::norm(val);
            }
            local_norm = std::sqrt(local_norm);

            if (local_norm > 1e-12)
            {
                for (auto &val : node->xp_stabilizer_map)
                {
                    val /= local_norm;
                }
                accumulated_norm *= local_norm;
            }

            for (auto &edge : node->edges)
            {
                normalize_recursive(edge, accumulated_norm);
            }
        }

    public:
        LimTDD() : root(std::make_shared<Node>()) {};

        void apply_tensor_contraction()
        {
            if (root)
            {
                root = contract_recursive(root);
            }
        };

        void normalize()
        {
            double global_norm_factor = 1.0;
            normalize_recursive(root, global_norm_factor);
        };

        void slice(uint32_t target_node_id)
        {
            if (!root)
                return;
            std::vector<std::shared_ptr<Node>> current_level = {root};
            while (!current_level.empty())
            {
                std::vector<std::shared_ptr<Node>> next_level;
                for (auto &node : current_level)
                {
                    auto it = std::remove_if(node->edges.begin(), node->edges.end(),
                                             [target_node_id](const std::shared_ptr<Node> &child)
                                             {
                                                 return child && child->id == target_node_id;
                                             });
                    node->edges.erase(it, node->edges.end());

                    for (auto &child : node->edges)
                    {
                        next_level.push_back(child);
                    }
                }
                current_level = next_level;
            }
        };
    };

    enum class ZXColor
    {
        Z,
        X,
        Hadamard,
        Boundary
    };

    struct ZXNode
    {
        size_t id;
        ZXColor color;
        double phase;
        std::vector<size_t> neighbors;
    };

    class QuantumCircuitCache
    {
    private:
        std::unordered_map<std::string, std::string> deterministic_cache;
        std::unordered_map<size_t, ZXNode> zx_graph_internal;

        void parse_ir_to_graph(const std::string &ciruit_ir)
        {
            zx_graph_internal.clear();
            zx_graph_internal[0] = {0, ZXColor::Boundary, 0.0, {1}};
            zx_graph_internal[1] = {1, ZXColor::Z, M_PI_2, {0, 2}};
            zx_graph_internal[2] = {2, ZXColor::Boundary, 0.0, {1}};
        }

        std::string serialize_graph() const
        {
            std::stringstream ss;
            for (const auto &[id, node] : zx_graph_internal)
            {
                ss << id << ":" << static_cast<int>(node.color) << ":"
                   << std::fixed << std::setprecision(4) << node.phase << "[";
                for (size_t n : node.neighbors)
                    ss << n << ",";
                ss << "];";
            }
            return ss.str();
        }

    public:
        QuantumCircuitCache() = default;

        std::string apply_zx_calculus_reduction(const std::string &circuit_ir)
        {
            parse_ir_to_graph(circuit_ir);

            bool simplified = true;
            while (simplified)
            {
                simplified = false;
                for (auto it = zx_graph_internal.begin(); it != zx_graph_internal.end(); ++it)
                {
                    size_t current_id = it->first;
                    ZXNode &current = it->second;

                    if (current.color == ZXColor::Boundary || current.color == ZXColor::Hadamard)
                        continue;

                    for (size_t neighbor_id : current.neighbors)
                    {
                        ZXNode &neighbor = zx_graph_internal[neighbor_id];
                        if (current.color == neighbor.color)
                        {
                            current.phase = std::fmod(current.phase + neighbor.phase, 2 * M_PI);
                            for (size_t nn_id : neighbor.neighbors)
                            {
                                if (nn_id != current_id)
                                {
                                    current.neighbors.push_back(nn_id);
                                    auto &nn_node = zx_graph_internal[nn_id];
                                    std::replace(nn_node.neighbors.begin(), nn_node.neighbors.end(), neighbor_id, current_id);
                                }
                            }
                            current.neighbors.erase(std::remove(current.neighbors.begin(), current.neighbors.end(), neighbor_id), current.neighbors.end());
                            zx_graph_internal.erase(neighbor_id);
                            simplified = true;
                            break;
                        }
                    }
                    if (simplified)
                        break;
                }

                for (auto it = zx_graph_internal.begin(); it != zx_graph_internal.end(); ++it)
                {
                    if (it->second.phase == 0.0 && it->second.neighbors.size() == 2 &&
                        it->second.color != ZXColor::Boundary)
                    {

                        size_t left = it->second.neighbors[0];
                        size_t right = it->second.neighbors[1];

                        auto &left_node = zx_graph_internal[left];
                        auto &right_node = zx_graph_internal[right];

                        std::replace(left_node.neighbors.begin(), left_node.neighbors.end(), it->first, right);
                        std::replace(right_node.neighbors.begin(), right_node.neighbors.end(), it->first, left);

                        zx_graph_internal.erase(it);
                        simplified = true;
                        break;
                    }
                }
            }

            return serialize_graph();
        }

        std::string weisfeiler_leman_hash(const std::string &zx_graph_serialized)
        {
            std::unordered_map<size_t, size_t> node_labels;
            std::hash<std::string> string_hasher;

            for (const auto &[id, node] : zx_graph_internal)
            {
                std::stringstream init_label;
                init_label << static_cast<int>(node.color) << "_" << node.neighbors.size();
                node_labels[id] = string_hasher(init_label.str());
            }

            int max_iterations = 5;
            for (int iter = 0; iter < max_iterations; ++iter)
            {
                std::unordered_map<size_t, size_t> new_labels;
                bool changed = false;

                for (const auto &[id, node] : zx_graph_internal)
                {
                    std::vector<size_t> neighbor_labels;
                    for (size_t n_id : node.neighbors)
                    {
                        neighbor_labels.push_back(node_labels[n_id]);
                    }
                    std::sort(neighbor_labels.begin(), neighbor_labels.end());

                    std::stringstream combined_label;
                    combined_label << node_labels[id] << "|";
                    for (size_t l : neighbor_labels)
                        combined_label << l << ",";

                    size_t new_hash = string_hasher(combined_label.str());
                    new_labels[id] = new_hash;

                    if (new_hash != node_labels[id])
                        changed = true;
                }

                node_labels = new_labels;
                if (!changed)
                    break;
            }

            std::vector<size_t> final_multiset;
            for (const auto &[id, label] : node_labels)
                final_multiset.push_back(label);
            std::sort(final_multiset.begin(), final_multiset.end());

            std::stringstream final_hash_stream;
            final_hash_stream << "WL_";
            for (size_t label : final_multiset)
                final_hash_stream << std::hex << label;

            return final_hash_stream.str();
        }

        bool lookup(const std::string &circuit_ir)
        {
            std::string canonical_graph = apply_zx_calculus_reduction(circuit_ir);
            std::string hash = weisfeiler_leman_hash(canonical_graph);
            return deterministic_cache.find(hash) != deterministic_cache.end();
        }
    };

    struct InteractionGate
    {
        int control_qubit;
        int target_qubit;
        double interaction_strength;
    };

    class IsoQGNN
    {
    private:
        std::vector<double> learnable_parameters;
        std::unordered_map<int, int> atom_to_qubit_map;
        std::vector<InteractionGate> hardware_execution_schedule;

    public:
        IsoQGNN() : learnable_parameters(64, 0.05) {}

        void map_molecular_geometry(const std::vector<std::pair<int, int>> &chemical_bonds)
        {
            int hardware_qubit_id = 0;
            atom_to_qubit_map.clear();
            hardware_execution_schedule.clear();

            for (const auto &bond : chemical_bonds)
            {
                if (atom_to_qubit_map.find(bond.first) == atom_to_qubit_map.end())
                {
                    atom_to_qubit_map[bond.first] = hardware_qubit_id++;
                }
                if (atom_to_qubit_map.find(bond.second) == atom_to_qubit_map.end())
                {
                    atom_to_qubit_map[bond.second] = hardware_qubit_id++;
                }
            }

            int bond_index = 0;

            for (const auto &bond : chemical_bonds)
            {
                int q_c = atom_to_qubit_map[bond.first];
                int q_t = atom_to_qubit_map[bond.second];
                double shared_weight = learnable_parameters[bond_index % 64];
                hardware_execution_schedule.push_back({q_c, q_t, shared_weight});
                bond_index++;
            }
        }
    };

    struct PauliTerm
    {
        uint64_t x_mask;
        uint64_t z_mask;
        double sign;
    };

    struct StabilizerFrame
    {
        std::vector<PauliTerm> generators;
        std::complex<double> amplitude;
    };

    struct CliffordTableau {
        size_t num_qubits;
        std::vector<uint64_t> x_destab;
        std::vector<uint64_t> z_destab;
        std::vector<uint64_t> x_stab;
        std::vector<uint64_t> z_stab;
        std::vector<int> r_destab;
        std::vector<int> r_stab;

        CliffordTableau(size_t n) : num_qubits(n),
            x_destab(n, 0),
            z_destab(n, 0),
            x_stab(n, 0),
            z_stab(n, 0),
            r_destab(n, 0),
            r_stab(n, 0)
            {
                for(size_t i = 0; i < n; ++i){
                    x_destab[i] = (1ULL << i);
                    z_stab[i] = (1ULL << i);
                }
            }
        
        void apply_pauli(uint64_t x_mask, uint64_t z_mask, double sign){
            for (size_t i = 0; i < num_qubits; ++i) {
                int anticommutes_destab = __builtin_popcountll(
                    (x_mask & z_destab[i]) ^ (z_mask & x_destab[i])
                ) % 2;
                
                if (anticommutes_destab) {
                    r_destab[i] ^= 1;
                }

                int anticommutes_stab = __builtin_popcountll(
                    (x_mask & z_stab[i]) ^ (z_mask & x_stab[i])
                ) % 2;
                
                if (anticommutes_stab) {
                    r_stab[i] ^= 1;
                }
            }
        }
    };

    class VirtualizationEngine
    {
    private:
        std::vector<StabilizerFrame> active_virtual_gadgets;
        std::complex<double> global_virtual_amplitude = {0.0, 0.0};
    public:
        void decompose_magic_states(size_t target_gate_id)
        {
            active_virtual_gadgets.clear();
            size_t optimal_stabilizer_rank = 4;
            for (size_t rank = 0; rank < optimal_stabilizer_rank; ++rank)
            {
                StabilizerFrame frame;
                frame.amplitude = std::complex<double>(0.5, (rank % 2 == 0) ? 0.0 : 0.5);
                PauliTerm g1 = {1ULL << rank, 0, 1.0};
                PauliTerm g2 = {0, 1ULL << ((rank + 1) % optimal_stabilizer_rank), 1.0};
                frame.generators.push_back(g1);
                frame.generators.push_back(g2);
                active_virtual_gadgets.push_back(frame);
            }
            simulate_stabilizer_sum(active_virtual_gadgets);
        }

    private:
        void simulate_stabilizer_sum(const std::vector<StabilizerFrame> &frames)
        {
            std::complex<double> cumulative_state = {0.0, 0.0};
            const size_t MAX_GADGET_QUBITS = 64; 

            for (const auto& frame : frames) {
                std::complex<double> frame_contribution = frame.amplitude;
                CliffordTableau tracker(MAX_GADGET_QUBITS);

                for (const auto& generator : frame.generators) {
                    tracker.apply_pauli(generator.x_mask, generator.z_mask, generator.sign);

                    if (generator.sign < 0.0) {
                        frame_contribution *= -1.0;
                    }

                    double generator_norm = std::sqrt(
                        __builtin_popcountll(generator.x_mask) + 
                        __builtin_popcountll(generator.z_mask)
                    );
                    
                    if (generator_norm > 0) {
                        frame_contribution /= generator_norm; 
                    }
                }
                int global_phase_parity = 0;
                for (size_t i = 0; i < MAX_GADGET_QUBITS; ++i) {
                    global_phase_parity ^= tracker.r_stab[i];
                }

                if (global_phase_parity) {
                    frame_contribution *= -1.0;
                }

                cumulative_state += frame_contribution;
            }
            global_virtual_amplitude *= cumulative_state;
        }
    };

    class ErrorBudgetGame
    {
    private:
        struct CompilationModule
        {
            std::string name;
            double weight;
            double current_tolerance;
            double calculate_utility() const
            {
                return weight * std::log(current_tolerance * 1e-12);
            }
        };
        std::vector<CompilationModule> modules;

    public:
        ErrorBudgetGame()
        {
            modules = {
                {"Logical_Operation", 1.0, 0.0},
                {"T_State_Distillation", 2.5, 0.0},
                {"Rotation_Synthesis", 1.2, 0.0}};
        }

        void execute_ibr_allocation(double total_budget)
        {
            double total_weight = 0.0;
            for (const auto &mod : modules)
                total_weight += mod.weight;
            bool converged = false;
            int max_iterations = 200;
            double epsilon = 1e-7;

            for (auto &module : modules)
            {
                module.current_tolerance = total_budget / modules.size();
            }

            for (int iter = 0; iter < max_iterations && !converged; ++iter)
            {
                converged = true;
                for (size_t i = 0; i < modules.size(); ++i)
                {
                    double budget_used_by_others = 0.0;
                    for (size_t j = 0; j < modules.size(); ++j)
                    {
                        if (i != j)
                        {
                            budget_used_by_others += modules[j].current_tolerance;
                        }
                    }
                    double available_budget = total_budget - budget_used_by_others;
                    double best_response = total_budget * (modules[i].weight / total_weight);
                }
            }
        }
    };

    class KarmaQVPU : public IQuantumBackend
    {
    private:
        LimTDD virtualized_state;
        QuantumCircuitCache qcc;
        IsoQGNN qgnn;
        VirtualizationEngine gv_engine;
        ErrorBudgetGame budget_allocator;

        size_t physical_qubit_limit = 45000;
        size_t active_qubits = 0;

    public:
        KarmaQVPU()
        {
            budget_allocator.execute_ibr_allocation(1.0);
        };

        void allocate_qubits(size_t num_qubits) override
        {
            active_qubits = num_qubits;
        }

        void release_qubit(size_t qubit_id) override {}
        void lock_hardware_id(size_t qubit_id) override {}
        void unlock_hardware_id(size_t qubit_id) override {}
        int measure(size_t qubit_id) override { return 0; }
        void apply_x(size_t qubit_id) override {}
        void apply_rz(size_t qubit_id, double angle) override {}
        void apply_cnot(size_t control, size_t target) override {}
        void apply_toffoli(size_t control1, size_t control2, size_t target) override
        {
            gv_engine.decompose_magic_states(target);
        }
    };

}