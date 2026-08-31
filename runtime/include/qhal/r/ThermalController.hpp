<<<<<<< HEAD
#pragma once
// QM（量子真机）真实硬件温控子系统。
//
// 提供三类功能：
//   - 抽象真实温度传感器（ITemperatureSensor），支持低温温度计（RuO2 /
//     Cernox）、热敏电阻或 Lakeshore / Oxford 等温度控制器的驱动。
//   - 为不同硬件模态提供目标工作温度（超导稀释制冷机 ~15 mK，Cs 气室 30 °C
//   等）。
//   - PID 闭环稳定：读取真实温度 -> 计算误差 -> 输出加热功率。
//
// 提供三类传感器：
//   - CryostatThermometer   带噪声占位（无硬件时可运行/测试）
//   - Lakeshore336Sensor    真实低温驱动（串口/USB/GPIB，见 .cpp）
//   - OxfordMercurySensor   真实低温驱动（Oxford Mercury / MercuryiTC）
// 各真实控制器共用 SerialCommandSensor 基类与 ISerialPort 串口抽象；新增控制器
// 只要继承 SerialCommandSensor 和实现 read_kelvin()，无需改动
// ThermalController。

#include <iostream>
#include <memory>
#include <random>
#include <string>


#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace qhal {

enum class TemperatureUnit { Kelvin, Millikelvin, Celsius };

struct Temperature {
  double kelvin = 0.0;

  double to(TemperatureUnit unit) const {
    if (unit == TemperatureUnit::Celsius)
      return kelvin - 273.15;
    if (unit == TemperatureUnit::Millikelvin)
      return kelvin * 1000.0;
    return kelvin;
  }
};

struct ThermalSetpoint {
  static constexpr double SuperconductingMixChamber_K =
      0.015;                                            // ~15 mK 稀释制冷机
  static constexpr double TrappedIonChamber_K = 300.0;  // 离子阱真空腔（室温）
  static constexpr double NeutralAtomChamber_K = 300.0; // 中性原子腔（室温）
  static constexpr double CsVaporCell_K = 303.15;       // Cs 气室 30 °C（论文）
};

class ITemperatureSensor {
public:
  virtual ~ITemperatureSensor() = default;
  virtual double read_kelvin() = 0;
  virtual const char *name() const = 0;
};

// ─── 占位实现：带噪声的低温温度计 ────────────────────────────────
//
// 模拟 RuO2 氧化钌低温温度计的读数：基准温度 + 高斯测量噪声。
// 生产部署时，用真实驱动类替换（同样实现 ITemperatureSensor）。
class CryostatThermometer : public ITemperatureSensor {
private:
  double baseline_k;
  double noise_k;
  std::mt19937 rng{12345u};

public:
  explicit CryostatThermometer(double baseline_kelvin,
                               double noise_kelvin = 0.0002)
      : baseline_k(baseline_kelvin), noise_k(noise_kelvin) {}

  const char *name() const override { return "RuO2_MXC"; }

  double read_kelvin() override {
    std::normal_distribution<double> n(0.0, noise_k);
    return baseline_k + n(rng);
  }
};

// ─── 串口抽象接口（RS-232 / USB 虚拟串口 / GPIB 适配器） ─────────
//
// USB 接口在操作系统层即虚拟串口设备（/dev/ttyUSB* 或 COM*），与 RS-232
// 统一按字节流处理；GPIB 则通过 Prologix GPIB-USB 适配器（本身就是串口设备，
// 直接以 "++" 前缀命令寻址）接入。
class ISerialPort {
public:
  virtual ~ISerialPort() = default;
  virtual bool open(const std::string &device) = 0;
  virtual void close() = 0;
  virtual bool is_open() const = 0;
  virtual int write(const std::string &data) = 0;
  virtual std::string read_line(double timeout_ms = 1000.0) = 0;
};

// ─── 串口命令式温度传感器基类 ───────────────────────────────────
//
// 封装串口连接管理（connect/disconnect/is_connected）与 Prologix GPIB
// 适配器初始化，子类只需要实现 read_kelvin() 的命令构造与响应解析。
// 实现见 src/ThermalController.cpp。
class SerialCommandSensor : public ITemperatureSensor {
protected:
  std::unique_ptr<ISerialPort> port;
  std::string device;
  int gpib_address = 0; // >0 时就用 Prologix GPIB 适配器寻址

public:
  SerialCommandSensor(std::unique_ptr<ISerialPort> p,
                      const std::string &device_path, int gpib_addr = 0);
  ~SerialCommandSensor() override;

  bool connect();
  void disconnect();
  bool is_connected() const;
};

// ─── Lakeshore 336 温度控制器（真实低温驱动） ────────────────────
//
// ASCII 文本命令集：
//   KRDG? <ch>   读取通道 <ch> 的温度（Kelvin），返回如 "273.150"
//   SETP <val>   设置加热设定点（K）
//   SETP?        读取加热设定点
class Lakeshore336Sensor : public SerialCommandSensor {
private:
  char channel = 'A';

public:
  Lakeshore336Sensor(std::unique_ptr<ISerialPort> p,
                     const std::string &device_path, char input_channel = 'A',
                     int gpib_addr = 0);

  const char *name() const override;
  double read_kelvin() override;
};

// ─── Oxford Mercury / MercuryiTC 温度控制器（真实低温驱动） ──────
//
// MercuryiTC 使用 ISOBUS 命令（默认读温度命令）：
//   READ:DEV:MB1.T1:TEMP:SIG:TEMP   ->  STAT:DEV:MB1.T1:TEMP:SIG:TEMP:4.56K
// 老型号 Mercury 可用更简命令，由构造时传入的完整命令字符串决定。
class OxfordMercurySensor : public SerialCommandSensor {
private:
  std::string read_cmd;

public:
  OxfordMercurySensor(std::unique_ptr<ISerialPort> p,
                      const std::string &device_path,
                      const std::string &temp_read_cmd, int gpib_addr = 0);

  const char *name() const override;
  double read_kelvin() override;
};

// ─── 工厂：按平台创建真实串口 + 具体控制器 ────────────────────────
std::unique_ptr<Lakeshore336Sensor>
make_lakeshore336_sensor(const std::string &device_path, char channel = 'A',
                         int gpib_addr = 0);

std::unique_ptr<OxfordMercurySensor>
make_oxford_mercuryitc_sensor(const std::string &device_path,
                              int thermometer_id = 1, int gpib_addr = 0);

// ─── PID 加热控制器 ──────────────────────────────────────────────
class HeaterPID {
private:
  double kp, ki, kd;
  double integral = 0.0;
  double prev_error = 0.0;

public:
  HeaterPID(double p, double i, double d) : kp(p), ki(i), kd(d) {}

  double update(double error, double dt_seconds) {
    if (dt_seconds <= 0.0)
      dt_seconds = 1.0;
    integral += error * dt_seconds;
    double derivative = (error - prev_error) / dt_seconds;
    prev_error = error;
    return kp * error + ki * integral + kd * derivative;
  }
};

// ─── 真实硬件热控制器 ────────────────────────────────────────────
class ThermalController {
private:
  std::unique_ptr<ITemperatureSensor> sensor;
  HeaterPID pid;
  double target_k;

public:
  ThermalController(std::unique_ptr<ITemperatureSensor> s, double target_kelvin)
      : sensor(std::move(s)), pid(1.0, 0.1, 0.05), target_k(target_kelvin) {}

  double read_kelvin() const { return sensor->read_kelvin(); }
  double target_kelvin() const { return target_k; }

  void set_target_kelvin(double k) { target_k = k; }

  // 读取真实温度，PID 输出加热功率（实际部署写入 DAC）
  double stabilize(double dt_seconds = 1.0) {
    double current = sensor->read_kelvin();
    double heater_power = pid.update(target_k - current, dt_seconds);
    std::cout << "[ThermalController] " << sensor->name()
              << " T=" << current * 1000.0 << " mK"
              << " (target " << target_k * 1000.0 << " mK)"
              << " heater=" << heater_power << " W\n";
    return current;
  }
};
=======
#pragma once
// QM（量子真机）真实硬件温控子系统。
//
// 提供三类功能：
//   - 抽象真实温度传感器（ITemperatureSensor），支持低温温度计（RuO2 /
//     Cernox）、热敏电阻或 Lakeshore / Oxford 等温度控制器的驱动。
//   - 为不同硬件模态提供目标工作温度（超导稀释制冷机 ~15 mK，Cs 气室 30 °C
//   等）。
//   - PID 闭环稳定：读取真实温度 -> 计算误差 -> 输出加热功率。
//
// 提供三类传感器：
//   - CryostatThermometer   带噪声占位（无硬件时可运行/测试）
//   - Lakeshore336Sensor    真实低温驱动（串口/USB/GPIB，见 .cpp）
//   - OxfordMercurySensor   真实低温驱动（Oxford Mercury / MercuryiTC）
// 各真实控制器共用 SerialCommandSensor 基类与 ISerialPort 串口抽象；新增控制器
// 只要继承 SerialCommandSensor 和实现 read_kelvin()，无需改动
// ThermalController。

#include <iostream>
#include <memory>
#include <random>
#include <string>


#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace qhal {

enum class TemperatureUnit { Kelvin, Millikelvin, Celsius };

struct Temperature {
  double kelvin = 0.0;

  double to(TemperatureUnit unit) const {
    if (unit == TemperatureUnit::Celsius)
      return kelvin - 273.15;
    if (unit == TemperatureUnit::Millikelvin)
      return kelvin * 1000.0;
    return kelvin;
  }
};

struct ThermalSetpoint {
  static constexpr double SuperconductingMixChamber_K =
      0.015;                                            // ~15 mK 稀释制冷机
  static constexpr double TrappedIonChamber_K = 300.0;  // 离子阱真空腔（室温）
  static constexpr double NeutralAtomChamber_K = 300.0; // 中性原子腔（室温）
  static constexpr double CsVaporCell_K = 303.15;       // Cs 气室 30 °C（论文）
};

class ITemperatureSensor {
public:
  virtual ~ITemperatureSensor() = default;
  virtual double read_kelvin() = 0;
  virtual const char *name() const = 0;
};

// ─── 占位实现：带噪声的低温温度计 ────────────────────────────────
//
// 模拟 RuO2 氧化钌低温温度计的读数：基准温度 + 高斯测量噪声。
// 生产部署时，用真实驱动类替换（同样实现 ITemperatureSensor）。
class CryostatThermometer : public ITemperatureSensor {
private:
  double baseline_k;
  double noise_k;
  std::mt19937 rng{12345u};

public:
  explicit CryostatThermometer(double baseline_kelvin,
                               double noise_kelvin = 0.0002)
      : baseline_k(baseline_kelvin), noise_k(noise_kelvin) {}

  const char *name() const override { return "RuO2_MXC"; }

  double read_kelvin() override {
    std::normal_distribution<double> n(0.0, noise_k);
    return baseline_k + n(rng);
  }
};

// ─── 串口抽象接口（RS-232 / USB 虚拟串口 / GPIB 适配器） ─────────
//
// USB 接口在操作系统层即虚拟串口设备（/dev/ttyUSB* 或 COM*），与 RS-232
// 统一按字节流处理；GPIB 则通过 Prologix GPIB-USB 适配器（本身就是串口设备，
// 直接以 "++" 前缀命令寻址）接入。
class ISerialPort {
public:
  virtual ~ISerialPort() = default;
  virtual bool open(const std::string &device) = 0;
  virtual void close() = 0;
  virtual bool is_open() const = 0;
  virtual int write(const std::string &data) = 0;
  virtual std::string read_line(double timeout_ms = 1000.0) = 0;
};

// ─── 串口命令式温度传感器基类 ───────────────────────────────────
//
// 封装串口连接管理（connect/disconnect/is_connected）与 Prologix GPIB
// 适配器初始化，子类只需要实现 read_kelvin() 的命令构造与响应解析。
// 实现见 src/ThermalController.cpp。
class SerialCommandSensor : public ITemperatureSensor {
protected:
  std::unique_ptr<ISerialPort> port;
  std::string device;
  int gpib_address = 0; // >0 时就用 Prologix GPIB 适配器寻址

public:
  SerialCommandSensor(std::unique_ptr<ISerialPort> p,
                      const std::string &device_path, int gpib_addr = 0);
  ~SerialCommandSensor() override;

  bool connect();
  void disconnect();
  bool is_connected() const;
};

// ─── Lakeshore 336 温度控制器（真实低温驱动） ────────────────────
//
// ASCII 文本命令集：
//   KRDG? <ch>   读取通道 <ch> 的温度（Kelvin），返回如 "273.150"
//   SETP <val>   设置加热设定点（K）
//   SETP?        读取加热设定点
class Lakeshore336Sensor : public SerialCommandSensor {
private:
  char channel = 'A';

public:
  Lakeshore336Sensor(std::unique_ptr<ISerialPort> p,
                     const std::string &device_path, char input_channel = 'A',
                     int gpib_addr = 0);

  const char *name() const override;
  double read_kelvin() override;
};

// ─── Oxford Mercury / MercuryiTC 温度控制器（真实低温驱动） ──────
//
// MercuryiTC 使用 ISOBUS 命令（默认读温度命令）：
//   READ:DEV:MB1.T1:TEMP:SIG:TEMP   ->  STAT:DEV:MB1.T1:TEMP:SIG:TEMP:4.56K
// 老型号 Mercury 可用更简命令，由构造时传入的完整命令字符串决定。
class OxfordMercurySensor : public SerialCommandSensor {
private:
  std::string read_cmd;

public:
  OxfordMercurySensor(std::unique_ptr<ISerialPort> p,
                      const std::string &device_path,
                      const std::string &temp_read_cmd, int gpib_addr = 0);

  const char *name() const override;
  double read_kelvin() override;
};

// ─── 工厂：按平台创建真实串口 + 具体控制器 ────────────────────────
std::unique_ptr<Lakeshore336Sensor>
make_lakeshore336_sensor(const std::string &device_path, char channel = 'A',
                         int gpib_addr = 0);

std::unique_ptr<OxfordMercurySensor>
make_oxford_mercuryitc_sensor(const std::string &device_path,
                              int thermometer_id = 1, int gpib_addr = 0);

// ─── PID 加热控制器 ──────────────────────────────────────────────
class HeaterPID {
private:
  double kp, ki, kd;
  double integral = 0.0;
  double prev_error = 0.0;

public:
  HeaterPID(double p, double i, double d) : kp(p), ki(i), kd(d) {}

  double update(double error, double dt_seconds) {
    if (dt_seconds <= 0.0)
      dt_seconds = 1.0;
    integral += error * dt_seconds;
    double derivative = (error - prev_error) / dt_seconds;
    prev_error = error;
    return kp * error + ki * integral + kd * derivative;
  }
};

// ─── 真实硬件热控制器 ────────────────────────────────────────────
class ThermalController {
private:
  std::unique_ptr<ITemperatureSensor> sensor;
  HeaterPID pid;
  double target_k;

public:
  ThermalController(std::unique_ptr<ITemperatureSensor> s, double target_kelvin)
      : sensor(std::move(s)), pid(1.0, 0.1, 0.05), target_k(target_kelvin) {}

  double read_kelvin() const { return sensor->read_kelvin(); }
  double target_kelvin() const { return target_k; }

  void set_target_kelvin(double k) { target_k = k; }

  // 读取真实温度，PID 输出加热功率（实际部署写入 DAC）
  double stabilize(double dt_seconds = 1.0) {
    double current = sensor->read_kelvin();
    double heater_power = pid.update(target_k - current, dt_seconds);
    std::cout << "[ThermalController] " << sensor->name()
              << " T=" << current * 1000.0 << " mK"
              << " (target " << target_k * 1000.0 << " mK)"
              << " heater=" << heater_power << " W\n";
    return current;
  }
};
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}