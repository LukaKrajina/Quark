<<<<<<< HEAD
#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <iostream>

namespace vedaros::qk
{

    // ─── qk 语言可定义的意识构件 ─────────────────────────────
    enum class MentalConstruct
    {
        Consciousness, // 意识
        Thought,       // 思想
        Decision,      // 决策
        Message,       // 消息
        Service,       // 服务
        Action         // 动作
    };

    // 编译目标
    enum class CodegenTarget
    {
        RealQuantumDevice,    // 真实量子设备 → 门序列
        QuantumVirtualMachine // QVM → C++ 代码
    };

    // 由 qk 源定义的类型化构件
    struct QkDefinition
    {
        MentalConstruct kind = MentalConstruct::Message;
        std::string name;
        std::string qk_source;   // qk 语言片段
        std::string type_schema; // 类型模式（保证跨语言类型安全）
    };

    // 按意识构件种类生成 C++ 声明/定义名
    static const char *cpp_construct(MentalConstruct c)
    {
        switch (c)
        {
        case MentalConstruct::Consciousness:
            return "Consciousness";
        case MentalConstruct::Thought:
            return "Thought";
        case MentalConstruct::Decision:
            return "Decision";
        case MentalConstruct::Message:
            return "Message";
        case MentalConstruct::Service:
            return "Service";
        case MentalConstruct::Action:
            return "Action";
        }
        return "Unknown";
    }

    // 构件种类的小写名称（日志 / 代码生成通用）
    static const char *construct_name(MentalConstruct c)
    {
        switch (c)
        {
        case MentalConstruct::Consciousness:
            return "consciousness";
        case MentalConstruct::Thought:
            return "thought";
        case MentalConstruct::Decision:
            return "decision";
        case MentalConstruct::Message:
            return "message";
        case MentalConstruct::Service:
            return "service";
        case MentalConstruct::Action:
            return "action";
        }
        return "unknown";
    }

    // 将 qk 源码逐行转为注释块，嵌入生成代码
    static std::string comment_block(const std::string &qk)
    {
        std::string out;
        size_t start = 0;
        while (start < qk.size())
        {
            size_t end = qk.find('\n', start);
            if (end == std::string::npos)
                end = qk.size();
            out += "//   " + qk.substr(start, end - start) + "\n";
            start = end + 1;
        }
        return out;
    }

    // ─── 编译时代码生成（按目标分派）─────────────────────────
    template <CodegenTarget Target>
    struct Codegen;

    template <>
    struct Codegen<CodegenTarget::QuantumVirtualMachine>
    {
        static std::string generate(const QkDefinition &def)
        {
            std::string o;
            o += "// ── [vedaRos QVM] " + std::string(construct_name(def.kind)) + " '" + def.name + "' (schema: " + def.type_schema + ") ──\n";
            o += "// qk source:\n";
            o += comment_block(def.qk_source);
            o += "struct " + def.name + "_" + cpp_construct(def.kind) + " {\n";
            o += "    // type_schema: " + def.type_schema + "\n";
            o += "};\n";
            return o;
        }
    };

    template <>
    struct Codegen<CodegenTarget::RealQuantumDevice>
    {
        static std::string generate(const QkDefinition &def)
        {
            std::string o;
            o += "// ── [vedaRos Real-Device] " + std::string(construct_name(def.kind)) + " '" + def.name + "' (schema: " + def.type_schema + ") ──\n";
            o += "// gate sequence:\n";
            o += comment_block(def.qk_source);
            o += "// schedule: allocate -> encode -> measure\n";
            return o;
        }
    };

    // ─── 类型安全注册表（跨语言、跨节点）─────────────────────
    class QkRegistry
    {
    private:
        mutable std::mutex mtx;
        std::unordered_map<std::string, QkDefinition> defs;

    public:
        void define(const QkDefinition &def)
        {
            std::lock_guard<std::mutex> lock(mtx);
            defs[def.name] = def;
            std::cout << "[vedaRos.qk] Defined " << construct_name(def.kind)
                      << " '" << def.name << "' (schema: " << def.type_schema << ").\n";
        }

        template <CodegenTarget Target>
        std::string codegen(const std::string &name) const
        {
            std::lock_guard<std::mutex> lock(mtx);
            auto it = defs.find(name);
            if (it == defs.end())
                return "// [vedaRos.qk] definition '" + name + "' not found\n";
            return Codegen<Target>::generate(it->second);
        }
    };
=======
#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <iostream>

namespace vedaros::qk
{

    // ─── qk 语言可定义的意识构件 ─────────────────────────────
    enum class MentalConstruct
    {
        Consciousness, // 意识
        Thought,       // 思想
        Decision,      // 决策
        Message,       // 消息
        Service,       // 服务
        Action         // 动作
    };

    // 编译目标
    enum class CodegenTarget
    {
        RealQuantumDevice,    // 真实量子设备 → 门序列
        QuantumVirtualMachine // QVM → C++ 代码
    };

    // 由 qk 源定义的类型化构件
    struct QkDefinition
    {
        MentalConstruct kind = MentalConstruct::Message;
        std::string name;
        std::string qk_source;   // qk 语言片段
        std::string type_schema; // 类型模式（保证跨语言类型安全）
    };

    // 按意识构件种类生成 C++ 声明/定义名
    static const char *cpp_construct(MentalConstruct c)
    {
        switch (c)
        {
        case MentalConstruct::Consciousness:
            return "Consciousness";
        case MentalConstruct::Thought:
            return "Thought";
        case MentalConstruct::Decision:
            return "Decision";
        case MentalConstruct::Message:
            return "Message";
        case MentalConstruct::Service:
            return "Service";
        case MentalConstruct::Action:
            return "Action";
        }
        return "Unknown";
    }

    // 构件种类的小写名称（日志 / 代码生成通用）
    static const char *construct_name(MentalConstruct c)
    {
        switch (c)
        {
        case MentalConstruct::Consciousness:
            return "consciousness";
        case MentalConstruct::Thought:
            return "thought";
        case MentalConstruct::Decision:
            return "decision";
        case MentalConstruct::Message:
            return "message";
        case MentalConstruct::Service:
            return "service";
        case MentalConstruct::Action:
            return "action";
        }
        return "unknown";
    }

    // 将 qk 源码逐行转为注释块，嵌入生成代码
    static std::string comment_block(const std::string &qk)
    {
        std::string out;
        size_t start = 0;
        while (start < qk.size())
        {
            size_t end = qk.find('\n', start);
            if (end == std::string::npos)
                end = qk.size();
            out += "//   " + qk.substr(start, end - start) + "\n";
            start = end + 1;
        }
        return out;
    }

    // ─── 编译时代码生成（按目标分派）─────────────────────────
    template <CodegenTarget Target>
    struct Codegen;

    template <>
    struct Codegen<CodegenTarget::QuantumVirtualMachine>
    {
        static std::string generate(const QkDefinition &def)
        {
            std::string o;
            o += "// ── [vedaRos QVM] " + std::string(construct_name(def.kind)) + " '" + def.name + "' (schema: " + def.type_schema + ") ──\n";
            o += "// qk source:\n";
            o += comment_block(def.qk_source);
            o += "struct " + def.name + "_" + cpp_construct(def.kind) + " {\n";
            o += "    // type_schema: " + def.type_schema + "\n";
            o += "};\n";
            return o;
        }
    };

    template <>
    struct Codegen<CodegenTarget::RealQuantumDevice>
    {
        static std::string generate(const QkDefinition &def)
        {
            std::string o;
            o += "// ── [vedaRos Real-Device] " + std::string(construct_name(def.kind)) + " '" + def.name + "' (schema: " + def.type_schema + ") ──\n";
            o += "// gate sequence:\n";
            o += comment_block(def.qk_source);
            o += "// schedule: allocate -> encode -> measure\n";
            return o;
        }
    };

    // ─── 类型安全注册表（跨语言、跨节点）─────────────────────
    class QkRegistry
    {
    private:
        mutable std::mutex mtx;
        std::unordered_map<std::string, QkDefinition> defs;

    public:
        void define(const QkDefinition &def)
        {
            std::lock_guard<std::mutex> lock(mtx);
            defs[def.name] = def;
            std::cout << "[vedaRos.qk] Defined " << construct_name(def.kind)
                      << " '" << def.name << "' (schema: " << def.type_schema << ").\n";
        }

        template <CodegenTarget Target>
        std::string codegen(const std::string &name) const
        {
            std::lock_guard<std::mutex> lock(mtx);
            auto it = defs.find(name);
            if (it == defs.end())
                return "// [vedaRos.qk] definition '" + name + "' not found\n";
            return Codegen<Target>::generate(it->second);
        }
    };
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}