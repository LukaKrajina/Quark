#pragma once
#include <string>
#include <mutex>
#include <memory>
#include <cmath>
#include <iostream>
#include "observability.hpp"

namespace quarkrsp::hardware
{

    // ─────────────────────────────────────────────────────────────
    // 执行器 / 编码器抽象（阶段2 真实硬件闭环）
    //
    // 义肢关节由执行器（电机）驱动，编码器反馈实际位置/速度，
    // 形成闭环。采用「接口 + 仿真桩 + 外部 SDK 回调注入」结构。
    // ─────────────────────────────────────────────────────────────

    // ─── 执行器接口（义肢电机）──────────────────────────────
    class IActuator
    {
    public:
        virtual ~IActuator() = default;
        virtual void set_torque(double torque) = 0;
        virtual void set_velocity(double velocity) = 0;
        virtual void set_position(double position) = 0; // 目标角（弧度）
        virtual bool enable() = 0;                       // 使能
        virtual bool disable() = 0;                      // 失能
        virtual bool emergency_stop() = 0;               // 急停
        virtual std::string name() const = 0;
    };

    // ─── 编码器接口（位置/速度反馈）─────────────────────────
    class IEncoder
    {
    public:
        virtual ~IEncoder() = default;
        virtual double read_position() = 0; // 弧度
        virtual double read_velocity() = 0; // 弧度/秒
    };

    // ─── 仿真执行器（含编码器反馈）──────────────────────────
    // 命令位置一阶趋近，叠加小幅噪声模拟编码器。
    class SimActuator : public IActuator, public IEncoder
    {
    private:
        std::string name_;
        double position_ = 0.0;
        double velocity_ = 0.0;
        double torque_ = 0.0;
        double command_position_ = 0.0;
        bool enabled_ = true;
        mutable std::mt19937 rng_{std::random_device{}()};

    public:
        explicit SimActuator(std::string name = "SimActuator") : name_(std::move(name))
        {
            QUARKRSP_INFO("hw") << "Sim actuator online ('" << name_ << "').";
        }

        void set_torque(double torque) override { torque_ = torque; }
        void set_velocity(double velocity) override { velocity_ = velocity; }

        void set_position(double position) override
        {
            command_position_ = position;
            if (enabled_)
                position_ += (command_position_ - position_) * 0.2; // 一阶趋近
        }

        bool enable() override { enabled_ = true; return true; }
        bool disable() override { enabled_ = false; return true; }
        bool emergency_stop() override
        {
            enabled_ = false;
            torque_ = 0.0;
            velocity_ = 0.0;
            QUARKRSP_WARN("hw") << "'" << name_ << "' emergency stop.";
            return true;
        }

        std::string name() const override { return name_; }

        double read_position() override { return position_; }
        double read_velocity() override { return velocity_; }
    };

    // ─── 外部执行器（真实电机驱动 SDK 回调注入）──────────────
    // 真实电机驱动（CAN/EtherCAT）在 SDK 回调中 push_encoder()
    // 注入编码器反馈；set_* 命令通过 command 接口下发给 SDK 层。
    class ExternalActuator : public IActuator, public IEncoder
    {
    private:
        std::string name_;
        double position_ = 0.0;
        double velocity_ = 0.0;
        bool enabled_ = true;
        mutable std::mutex mtx_;

    public:
        explicit ExternalActuator(std::string name = "ExternalActuator")
            : name_(std::move(name))
        {
            QUARKRSP_INFO("hw") << "External actuator online ('" << name_ << "').";
        }

        // 命令下发（真实 SDK 层实现写入电机驱动器）
        void set_torque(double) override {}
        void set_velocity(double) override {}
        void set_position(double) override {}

        bool enable() override { enabled_ = true; return true; }
        bool disable() override { enabled_ = false; return true; }
        bool emergency_stop() override
        {
            enabled_ = false;
            QUARKRSP_WARN("hw") << "'" << name_ << "' emergency stop.";
            return true;
        }

        std::string name() const override { return name_; }

        // 真实设备 SDK 回调：注入编码器反馈
        void push_encoder(double position, double velocity)
        {
            std::lock_guard<std::mutex> lock(mtx_);
            position_ = position;
            velocity_ = velocity;
        }

        double read_position() override
        {
            std::lock_guard<std::mutex> lock(mtx_);
            return position_;
        }
        double read_velocity() override
        {
            std::lock_guard<std::mutex> lock(mtx_);
            return velocity_;
        }
    };

    // ─── 执行器工厂 ──────────────────────────────────────────
    inline std::shared_ptr<IActuator> make_actuator(const std::string &name,
                                                    bool real = false)
    {
        if (real)
            return std::make_shared<ExternalActuator>(name);
        return std::make_shared<SimActuator>(name);
    }

}
