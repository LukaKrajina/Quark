#pragma once
#include <string>
#include <vector>
#include <bitset>
#include <cmath>
#include <stdexcept>
#include "../include/qhal/IQuantumBackend.hpp"
#include "../include/numqk/Numqk.hpp"
#include "QObject.hpp"
namespace quark
{
    namespace qml
    {
        class QUARK_RT_API QDataEncoder
        {
        private:
            qhal::IQuantumBackend *backend;

        public:
            QDataEncoder(qhal::IQuantumBackend *target_backend) : backend(target_backend) {}

            std::shared_ptr<QDataState> text_to_basis(const std::string &text)
            {
                std::vector<bool> bit_stream;

                for (char c : text)
                {
                    std::bitset<8> bits(c);
                    for (int i = 7; i >= 0; --i)
                    {
                        bit_stream.push_back(bits[i]);
                    }
                }

                size_t num_qubits = bit_stream.size();
                backend->allocate_qubits(num_qubits);
                std::vector<size_t> qubits_ids(num_qubits);

                for (size_t i = 0; i < num_qubits; ++i)
                {
                    qubits_ids[i] = i;
                    if (bit_stream[i])
                    {
                        backend->apply_x(i);
                    }
                }

                return std::make_shared<QDataState>(backend, qubits_ids);
            }

            std::shared_ptr<QDataState> image_to_angles(const numqk::Tensor<double> &normalized_image)
            {
                size_t num_qubits = normalized_image.size();
                backend->allocate_qubits(num_qubits);
                std::vector<size_t> qubit_ids(num_qubits);
                const double *pixels = normalized_image.data();

                for (size_t i = 0; i < num_qubits; ++i)
                {
                    qubit_ids[i] = i;

                    backend->apply_rz(i, M_PI / 2.0);
                    backend->apply_x(i);
                    backend->apply_rz(i, M_PI / 2.0);
                    double rotation_angle = pixels[i] * M_PI;
                    backend->apply_rz(i, rotation_angle);
                }
                
                return std::make_shared<QDataState>(backend, qubit_ids);
            }
        };
    }
}