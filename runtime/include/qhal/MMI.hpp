#pragma once
#include "SandboxJIT.hpp"
#include "Qcrypt.hpp"

#include <string>
#include <vector>
#include <sstream>
#include <cstring>
#include <cstdlib>
#include <cstdint>
#include <stdexcept>
#include <map>
#include <memory>
#include <set>
#include <functional>

namespace qhal
{
    namespace json
    {
        struct Value;
        using Array = std::vector<Value>;
        using Object = std::map<std::string, Value>;
        struct Value
        {
            enum Kind
            {
                Null,
                Bool,
                Number,
                Str,
                Arr,
                Obj
            } kind = Null;

            bool b = false;
            double num = 0;
            int64_t inum = 0;
            bool is_int = false;
            std::string str;
            Array arr;
            Object obj;
            Value() : kind(Null) {}
            Value(bool v) : kind(Bool), b(v) {}
            Value(int v) : kind(Number), num((double)v), inum((int64_t)v), is_int(true) {}
            Value(long long v) : kind(Number), num((double)v), inum((int64_t)v), is_int(true) {}
            Value(unsigned long long v) : kind(Number), num((double)v), inum((int64_t)v), is_int(true) {}
            Value(double v) : kind(Number), num(v) {}
            Value(float v) : kind(Number), num((double)v) {}
            Value(const char *s) : kind(Str), str(s ? s : "") {}
            Value(const std::string &s) : kind(Str), str(s) {}
            Value(Array a) : kind(Arr), arr(std::move(a)) {}
            Value(Object o) : kind(Obj), obj(std::move(o)) {}
            bool is_null() const { return kind == Null; }
            bool is_bool() const { return kind == Bool; }
            bool is_number() const { return kind == Number; }
            bool is_string() const { return kind == Str; }
            bool is_array() const { return kind == Arr; }
            bool is_object() const { return kind == Obj; }
            bool bool_value() const { return b; }
            double number() const { return is_int ? (double)inum : num; }
            int int_value() const { return (int)(is_int ? inum : (int64_t)num); }
            int64_t int64_value() const { return is_int ? inum : (int64_t)num; }
            const std::string &string() const { return str; }
            const Array &array() const { return arr; }
            Array &array() { return arr; }
            const Object &object() const { return obj; }
            Object &object() { return obj; }
            bool has(const std::string &key) const { return obj.count(key) != 0; }
            const Value &at(const std::string &key) const
            {
                auto it = obj.find(key);
                if (it == obj.end())
                    throw std::runtime_error("JSON: missing key '" + key + "'");
                return it->second;
            }
            Value &at(const std::string &key)
            {
                auto it = obj.find(key);
                if (it == obj.end())
                    throw std::runtime_error("JSON: missing key '" + key + "'");
                return it->second;
            }
            const Value &operator[](size_t i) const { return arr[i]; }
            Value &operator[](size_t i) { return arr[i]; }
        };

        static int hex_val(char c)
        {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        }

        static void append_utf8(std::string &out, uint32_t cp)
        {
            if (cp <= 0x7F)
            {
                out += (char)cp;
            }
            else if (cp <= 0x7FF)
            {
                out += (char)(0xC0 | (cp >> 6));
                out += (char)(0x80 | (cp & 0x3F));
            }
            else if (cp <= 0xFFFF)
            {
                out += (char)(0xE0 | (cp >> 12));
                out += (char)(0x80 | ((cp >> 6) & 0x3F));
                out += (char)(0x80 | (cp & 0x3F));
            }
            else
            {
                out += (char)(0xF0 | (cp >> 18));
                out += (char)(0x80 | ((cp >> 12) & 0x3F));
                out += (char)(0x80 | ((cp >> 6) & 0x3F));
                out += (char)(0x80 | (cp & 0x3F));
            }
        }

        inline std::string escape_string(const std::string &s)
        {
            static const char hex_digits[] = "0123456789abcdef";
            std::string out;
            out.reserve(s.size() + 2);
            out += '"';
            for (unsigned char c : s)
            {
                switch (c)
                {
                case '"': out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\b': out += "\\b"; break;
                case '\f': out += "\\f"; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default:
                    if (c < 0x20)
                    {
                        char buf[7] = {'\\', 'u', '0', '0', '0', '0', '\0'};
                        buf[4] = hex_digits[(c >> 4) & 0xF];
                        buf[5] = hex_digits[c & 0xF];
                        out += buf;
                    }
                    else
                        out += (char)c;
                }
            }
            out += '"';
            return out;
        }

        inline std::string format_number(const Value &v)
        {
            std::ostringstream os;
            if (v.is_int)
            {
                os << v.inum;
            }
            else
            {
                os.precision(17);
                os << v.num;
            }
            return os.str();
        }

        inline void serialize_impl(const Value &v, std::string &out, int indent, int level)
        {
            switch (v.kind)
            {
            case Value::Null:
                out += "null";
                return;
            case Value::Bool:
                out += (v.b ? "true" : "false");
                return;
            case Value::Number:
                out += format_number(v);
                return;
            case Value::Str:
                out += escape_string(v.str);
                return;
            case Value::Arr:
            {
                out += '[';
                if (!v.arr.empty())
                {
                    for (size_t i = 0; i < v.arr.size(); ++i)
                    {
                        if (i > 0) out += ',';
                        if (indent >= 0)
                        {
                            out += '\n';
                            out.append((size_t)(indent * (level + 1)), ' ');
                        }
                        serialize_impl(v.arr[i], out, indent, level + 1);
                    }
                    if (indent >= 0)
                    {
                        out += '\n';
                        out.append((size_t)(indent * level), ' ');
                    }
                }
                out += ']';
                return;
            }
            case Value::Obj:
            {
                out += '{';
                if (!v.obj.empty())
                {
                    size_t i = 0;
                    for (const auto &kv : v.obj)
                    {
                        if (i > 0) out += ',';
                        if (indent >= 0)
                        {
                            out += '\n';
                            out.append((size_t)(indent * (level + 1)), ' ');
                        }
                        out += escape_string(kv.first);
                        out += (indent >= 0 ? ": " : ":");
                        serialize_impl(kv.second, out, indent, level + 1);
                        ++i;
                    }
                    if (indent >= 0)
                    {
                        out += '\n';
                        out.append((size_t)(indent * level), ' ');
                    }
                }
                out += '}';
                return;
            }
            }
        }

        inline std::string serialize(const Value &v, int indent = -1)
        {
            std::string out;
            serialize_impl(v, out, indent, 0);
            return out;
        }

        inline std::string stringify(const Value &v, int indent = -1) { return serialize(v, indent); }

        struct Parser
        {
            const std::string &s;
            size_t p = 0;

            Parser(const std::string &src) : s(src) {}

            void skip_ws()
            {
                while (p < s.size() && (s[p] == ' ' || s[p] == '\t' || s[p] == '\n' || s[p] == '\r'))
                    ++p;
            }
            char peek()
            {
                skip_ws();
                return p < s.size() ? s[p] : '\0';
            }
            char get()
            {
                skip_ws();
                return p < s.size() ? s[p++] : '\0';
            }

            Value parse_value()
            {
                Value v;
                char c = peek();
                if (c == '{')
                    v = parse_object();
                else if (c == '[')
                    v = parse_array();
                else if (c == '"')
                {
                    v.kind = Value::Str;
                    v.str = parse_string();
                }
                else if (c == 't')
                {
                    expect("true");
                    v.kind = Value::Bool;
                    v.b = true;
                }
                else if (c == 'f')
                {
                    expect("false");
                    v.kind = Value::Bool;
                    v.b = false;
                }
                else if (c == 'n')
                {
                    expect("null");
                    v.kind = Value::Null;
                }
                else
                {
                    v.kind = Value::Number;
                    v.num = parse_number(v.is_int, v.inum);
                }
                return v;
            }

            Value parse_object()
            {
                Value v;
                v.kind = Value::Obj;
                get(); // '{'
                if (peek() == '}')
                {
                    get();
                    return v;
                }
                while (true)
                {
                    std::string key = parse_string();
                    if (get() != ':')
                        throw std::runtime_error("JSON: expected ':'");
                    v.obj[key] = parse_value();
                    char c = get();
                    if (c == '}')
                        break;
                    if (c != ',')
                        throw std::runtime_error("JSON: expected ',' or '}'");
                }
                return v;
            }

            Value parse_array()
            {
                Value v;
                v.kind = Value::Arr;
                get(); // '['
                if (peek() == ']')
                {
                    get();
                    return v;
                }
                while (true)
                {
                    v.arr.push_back(parse_value());
                    char c = get();
                    if (c == ']')
                        break;
                    if (c != ',')
                        throw std::runtime_error("JSON: expected ',' or ']'");
                }
                return v;
            }

            std::string parse_string()
            {
                get(); // '"'
                std::string out;
                while (p < s.size() && s[p] != '"')
                {
                    if (s[p] == '\\' && p + 1 < s.size())
                    {
                        ++p;
                        char e = s[p++];
                        switch (e)
                        {
                        case '"': out += '"'; break;
                        case '\\': out += '\\'; break;
                        case '/': out += '/'; break;
                        case 'b': out += '\b'; break;
                        case 'f': out += '\f'; break;
                        case 'n': out += '\n'; break;
                        case 'r': out += '\r'; break;
                        case 't': out += '\t'; break;
                        case 'u':
                        {
                            if (p + 4 > s.size())
                                throw std::runtime_error("JSON: bad \\u escape");
                            uint32_t cp = 0;
                            for (int i = 0; i < 4; ++i)
                            {
                                int h = hex_val(s[p++]);
                                if (h < 0)
                                    throw std::runtime_error("JSON: bad \\u escape");
                                cp = (cp << 4) | (uint32_t)h;
                            }

                            if (cp >= 0xD800 && cp <= 0xDBFF &&
                                p + 1 < s.size() && s[p] == '\\' && s[p + 1] == 'u')
                            {
                                p += 2;
                                uint32_t lo = 0;
                                for (int i = 0; i < 4; ++i)
                                {
                                    if (p >= s.size())
                                        throw std::runtime_error("JSON: bad surrogate");
                                    int h = hex_val(s[p++]);
                                    if (h < 0)
                                        throw std::runtime_error("JSON: bad surrogate");
                                    lo = (lo << 4) | (uint32_t)h;
                                }
                                if (lo >= 0xDC00 && lo <= 0xDFFF)
                                    cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                            }
                            append_utf8(out, cp);
                            break;
                        }
                        default:
                            throw std::runtime_error(std::string("JSON: bad escape '\\") + e + "'");
                        }
                    }
                    else
                        out += s[p++];
                }
                get(); // '"'
                return out;
            }

            double parse_number(bool &is_int, int64_t &int_val)
            {
                size_t start = p;
                bool floating = false;
                while (p < s.size() && (std::isdigit((unsigned char)s[p]) ||
                                        s[p] == '-' || s[p] == '+' || s[p] == '.' || s[p] == 'e' || s[p] == 'E'))
                {
                    if (s[p] == '.' || s[p] == 'e' || s[p] == 'E')
                        floating = true;
                    ++p;
                }
                std::string numstr = s.substr(start, p - start);
                if (floating)
                {
                    is_int = false;
                    return std::strtod(numstr.c_str(), nullptr);
                }
                is_int = true;
                int_val = std::strtoll(numstr.c_str(), nullptr, 10);
                return (double)int_val;
            }

            void expect(const char *lit)
            {
                for (const char *q = lit; *q; ++q)
                    if (get() != *q)
                        throw std::runtime_error("JSON: unexpected token");
            }
        };

        inline Value parse(const std::string &s) { return Parser(s).parse_value(); }
    }

    struct MMIExport
    {
        std::string name;
        std::vector<std::string> params;
        std::string ret;
    };

    // ─── QOBF v2 二进制 header：类型标签 ────
    enum TypeTag : uint8_t
    {
        T_I8 = 0, T_I16 = 1, T_I32 = 2, T_I64 = 3,
        T_U8 = 4, T_U16 = 5, T_U32 = 6, T_U64 = 7,
        T_FLOAT = 8, T_DOUBLE = 9, T_VOID = 10, T_CHAR = 11,
        T_I8P = 12,      // i8*（string / cap<T>）
        T_QUBITP = 13,   // %Qubit*
        T_QOBJECTP = 14, // %QObject*
        T_QMODELP = 15,  // %QModel*
        T_LATTICEP = 16, // %Lattice*
        T_FORMP = 17     // %form.<Name>*（后跟 u16 长度前缀 + form 名）
    };

    // 二进制 reader（小端；字符串 = u16 长度前缀 + utf8 字节）。
    struct BinaryReader
    {
        const uint8_t *p;
        const uint8_t *end;

        BinaryReader(const uint8_t *data, size_t len) : p(data), end(data + len) {}

        void require(size_t n) const
        {
            if ((size_t)(end - p) < n)
                throw std::runtime_error("MMI: truncated binary header");
        }
        uint8_t u8() { require(1); return *p++; }
        uint16_t u16()
        {
            require(2);
            uint16_t v = (uint16_t)p[0] | ((uint16_t)p[1] << 8);
            p += 2;
            return v;
        }
        std::string str()
        {
            uint16_t n = u16();
            require(n);
            std::string s((const char *)p, n);
            p += n;
            return s;
        }
    };

    // 类型标签 → LLVM 类型字符串（与 TS 侧 typeTag 对称）。
    inline std::string type_to_llvm(uint8_t tag, const std::string &form)
    {
        switch (tag)
        {
        case T_I8: return "i8";
        case T_I16: return "i16";
        case T_I32: return "i32";
        case T_I64: return "i64";
        case T_U8: return "uint8";
        case T_U16: return "uint16";
        case T_U32: return "uint32";
        case T_U64: return "uint64";
        case T_FLOAT: return "float";
        case T_DOUBLE: return "double";
        case T_VOID: return "void";
        case T_CHAR: return "char";
        case T_I8P: return "i8*";
        case T_QUBITP: return "%Qubit*";
        case T_QOBJECTP: return "%QObject*";
        case T_QMODELP: return "%QModel*";
        case T_LATTICEP: return "%Lattice*";
        case T_FORMP: return "%form." + form + "*";
        default: throw std::runtime_error("MMI: unknown type tag");
        }
    }

    // 从二进制 reader 读一个类型（返回 LLVM 类型字符串）。
    static std::string read_type(BinaryReader &r)
    {
        uint8_t tag = r.u8();
        if (tag == T_FORMP)
            return type_to_llvm(tag, r.str());
        return type_to_llvm(tag, std::string());
    }

    // ─── 二进制 writer + LLVM→标签 + JSON header→二进制（供导出用）────
    struct BinaryWriter
    {
        qhal::qcrypt::Bytes out;
        void u8(uint8_t v) { out.push_back(v); }
        void u16(uint16_t v) { out.push_back((uint8_t)(v & 0xFF)); out.push_back((uint8_t)(v >> 8)); }
        void str(const std::string &s) { u16((uint16_t)s.size()); out.insert(out.end(), s.begin(), s.end()); }
    };

    // LLVM 类型字符串 → (类型标签, form 名)。
    inline std::pair<uint8_t, std::string> llvm_to_tag(const std::string &t)
    {
        if (t == "i8") return {T_I8, ""};
        if (t == "i16") return {T_I16, ""};
        if (t == "i32") return {T_I32, ""};
        if (t == "i64") return {T_I64, ""};
        if (t == "uint8") return {T_U8, ""};
        if (t == "uint16") return {T_U16, ""};
        if (t == "uint32") return {T_U32, ""};
        if (t == "uint64") return {T_U64, ""};
        if (t == "float") return {T_FLOAT, ""};
        if (t == "double") return {T_DOUBLE, ""};
        if (t == "void") return {T_VOID, ""};
        if (t == "char") return {T_CHAR, ""};
        if (t == "i8*") return {T_I8P, ""};
        if (t == "%Qubit*") return {T_QUBITP, ""};
        if (t == "%QObject*") return {T_QOBJECTP, ""};
        if (t == "%QModel*") return {T_QMODELP, ""};
        if (t == "%Lattice*") return {T_LATTICEP, ""};
        if (t.size() > 7 && t.rfind("%form.", 0) == 0 && t.back() == '*')
            return {T_FORMP, t.substr(6, t.size() - 7)};
        throw std::runtime_error("MMI: unknown LLVM type '" + t + "'");
    }

    // 将 JSON header（TS 侧 JSON.stringify(MMIHeader)）转二进制 header；
    // module_name 输出为明文模块名（用于密钥派生）。
    inline qhal::qcrypt::Bytes mmi_header_to_binary(const std::string &header_json, std::string &module_name)
    {
        json::Value header = json::parse(header_json);
        if (header.kind != json::Value::Obj)
            throw std::runtime_error("MMI: bad header JSON");

        auto get_str = [&](const char *key) -> std::string
        {
            auto it = header.obj.find(key);
            return (it != header.obj.end() && it->second.kind == json::Value::Str) ? it->second.str : std::string();
        };
        module_name = get_str("name");

        BinaryWriter w;
        w.str(get_str("version"));

        // exports
        auto eit = header.obj.find("exports");
        std::vector<MMIExport> exps;
        if (eit != header.obj.end() && eit->second.kind == json::Value::Arr)
        {
            for (const auto &e : eit->second.arr)
            {
                if (e.kind != json::Value::Obj)
                    continue;
                MMIExport ex;
                auto nit = e.obj.find("name");
                if (nit != e.obj.end() && nit->second.kind == json::Value::Str)
                    ex.name = nit->second.str;
                auto rit = e.obj.find("ret");
                if (rit != e.obj.end() && rit->second.kind == json::Value::Str)
                    ex.ret = rit->second.str;
                auto prit = e.obj.find("params");
                if (prit != e.obj.end() && prit->second.kind == json::Value::Arr)
                    for (const auto &p : prit->second.arr)
                        if (p.kind == json::Value::Str)
                            ex.params.push_back(p.str);
                exps.push_back(ex);
            }
        }
        w.u16((uint16_t)exps.size());
        for (const auto &ex : exps)
        {
            w.str(ex.name);
            auto rt = llvm_to_tag(ex.ret);
            w.u8(rt.first);
            if (rt.first == T_FORMP)
                w.str(rt.second);
            w.u8((uint8_t)ex.params.size());
            for (const auto &p : ex.params)
            {
                auto pt = llvm_to_tag(p);
                w.u8(pt.first);
                if (pt.first == T_FORMP)
                    w.str(pt.second);
            }
        }

        // permissions
        auto pit = header.obj.find("permissions");
        std::vector<std::string> perms;
        if (pit != header.obj.end() && pit->second.kind == json::Value::Arr)
            for (const auto &p : pit->second.arr)
                if (p.kind == json::Value::Str)
                    perms.push_back(p.str);
        w.u16((uint16_t)perms.size());
        for (const auto &p : perms)
            w.str(p);

        // imports
        auto iit = header.obj.find("imports");
        struct Imp { std::string alias, path; };
        std::vector<Imp> imps;
        if (iit != header.obj.end() && iit->second.kind == json::Value::Arr)
        {
            for (const auto &im : iit->second.arr)
            {
                if (im.kind != json::Value::Obj)
                    continue;
                Imp x;
                auto ait = im.obj.find("alias");
                if (ait != im.obj.end() && ait->second.kind == json::Value::Str)
                    x.alias = ait->second.str;
                auto pit2 = im.obj.find("path");
                if (pit2 != im.obj.end() && pit2->second.kind == json::Value::Str)
                    x.path = pit2->second.str;
                imps.push_back(x);
            }
        }
        w.u16((uint16_t)imps.size());
        for (const auto &im : imps)
        {
            w.str(im.alias);
            w.str(im.path);
        }

        return w.out;
    }

    static inline int64_t double_to_i64(double d)
    {
        int64_t r;
        std::memcpy(&r, &d, 8);
        return r;
    }
    static inline double i64_to_double(int64_t v)
    {
        double d;
        std::memcpy(&d, &v, 8);
        return d;
    }

    class QUARK_RT_API MMIModule
    {
    public:
        using DependencyLoader = std::function<std::shared_ptr<MMIModule>(const std::string &path, const std::string &parent_dir)>;

    private:
        std::unique_ptr<SandboxJIT> jit_;
        std::vector<MMIExport> exports_;
        std::map<std::string, MMIExport> export_map_;
        std::vector<std::shared_ptr<MMIModule>> deps_;
        std::string self_dir_;

        static constexpr int MAX_ARGS = 4;

    public:
        explicit MMIModule(const std::string &data, const std::string &self_dir = "",
                           const DependencyLoader &loader = nullptr)
            : self_dir_(self_dir)
        {
            parse(data, loader);
        }
        
        void *lookup_export_address(const std::string &func_name)
        {
            return jit_ ? jit_->lookup_address(func_name) : nullptr;
        }

        const std::vector<MMIExport> &exports() const { return exports_; }

        std::string invoke(const std::string &func_name, const std::string &args_json)
        {
            auto it = export_map_.find(func_name);
            if (it == export_map_.end())
                throw std::runtime_error("MMI: exported function not found: " + func_name);

            const MMIExport &ex = it->second;

            json::Value args = json::parse(args_json);
            if (!args.is_array())
                throw std::runtime_error("MMI: args must be a JSON array");

            int n = (int)args.array().size();
            if (n > MAX_ARGS)
                throw std::runtime_error("MMI: too many args (max " + std::to_string(MAX_ARGS) + ")");
            if (n != (int)ex.params.size())
                throw std::runtime_error("MMI: arg count mismatch for '" + func_name + "'");

            int64_t slot[MAX_ARGS] = {0, 0, 0, 0};
            for (int i = 0; i < n; ++i)
            {
                const json::Value &a = args.array()[i];
                const std::string &pt = ex.params[i];
                if (pt == "double" || pt == "float")
                {
                    if (!a.is_number())
                        throw std::runtime_error("MMI: expected number arg");
                    slot[i] = double_to_i64(a.number());
                }
                else
                {
                    if (!a.is_number())
                        throw std::runtime_error("MMI: expected number arg");
                    slot[i] = (int64_t)a.number();
                }
            }

            auto thunk = jit_->get_function<int64_t(int64_t, int64_t, int64_t, int64_t)>("mmi_thunk_" + func_name);
            if (!thunk)
                throw std::runtime_error("MMI: thunk not found for '" + func_name + "'");

            int64_t ret = thunk(slot[0], slot[1], slot[2], slot[3]);

            if (ex.ret == "double" || ex.ret == "float")
                return json::serialize(json::Value(i64_to_double(ret)));
            return json::serialize(json::Value((long long)ret));
        }

    private:
        void parse(const std::string &data, const DependencyLoader &loader)
        {
            // QOBF v2：验 HMAC + ChaCha20 解密 → binary_header ‖ ir。
            qhal::qcrypt::Bytes file_data(data.begin(), data.end());
            qhal::qcrypt::Bytes plain = qhal::qcrypt::unpack_mmi_v2(file_data);
            parse_binary(plain, loader);
        }

        void parse_binary(const qhal::qcrypt::Bytes &plain, const DependencyLoader &loader)
        {
            BinaryReader r(plain.data(), plain.size());
            r.str(); // 模块版本字符串（明文 name 已用于密钥派生，此处仅消费）

            // exports
            uint16_t export_count = r.u16();
            for (uint16_t i = 0; i < export_count; ++i)
            {
                MMIExport ex;
                ex.name = r.str();
                ex.ret = read_type(r);
                uint8_t pc = r.u8();
                for (uint8_t j = 0; j < pc; ++j)
                    ex.params.push_back(read_type(r));
                exports_.push_back(ex);
                export_map_[ex.name] = ex;
            }

            // permissions
            uint16_t perm_count = r.u16();
            std::set<std::string> permissions;
            for (uint16_t i = 0; i < perm_count; ++i)
                permissions.insert(r.str());

            // imports（先收集，JIT 就绪后再加载）
            struct ImportInfo { std::string alias, path; };
            std::vector<ImportInfo> imports;
            uint16_t import_count = r.u16();
            for (uint16_t i = 0; i < import_count; ++i)
                imports.push_back({r.str(), r.str()});

            // ir = 剩余字节（LLVM IR 文本）
            std::string ir((const char *)r.p, (const char *)r.end);

            std::string full_ir = ir + build_thunks_ir();

            jit_ = std::make_unique<SandboxJIT>(permissions);
            jit_->add_ir(full_ir);

            for (const auto &imp : imports)
            {
                if (!loader)
                    throw std::runtime_error("MMI: import '" + imp.path + "' requires a dependency loader");

                auto dep = loader(imp.path, self_dir_);
                if (!dep)
                    throw std::runtime_error("MMI: failed to load import '" + imp.path + "'");
                deps_.push_back(dep);

                for (const auto &ex : dep->exports_)
                {
                    void *addr = dep->lookup_export_address(ex.name);
                    if (addr)
                        jit_->bind_symbol(imp.alias + "_" + ex.name, addr);
                }
            }
        }

        
        std::string build_thunks_ir()
        {
            std::ostringstream os;
            for (const auto &ex : exports_)
            {
                // 超过 MAX_ARGS 参数的函数跳过 thunk（MMI_INVOKE 不支持；
                // 主程序 import 走 bind_symbol 用导出地址，无需 thunk）
                if (ex.params.size() > MAX_ARGS)
                    continue;
                os << "\ndefine i64 @mmi_thunk_" << ex.name << "(i64 %a0, i64 %a1, i64 %a2, i64 %a3) {\n";
                os << "entry:\n";

                std::vector<std::string> call_args;
                for (size_t i = 0; i < ex.params.size(); ++i)
                {
                    const std::string &pt = ex.params[i];
                    if (pt == "i8" || pt == "i16" || pt == "i32" || pt == "uint8" || pt == "uint16" || pt == "uint32")
                    {
                        os << "  %p" << i << " = trunc i64 %a" << i << " to " << pt << "\n";
                        call_args.push_back(pt + " %p" + std::to_string(i));
                    }
                    else if (pt == "i64" || pt == "uint64")
                    {
                        call_args.push_back("i64 %a" + std::to_string(i));
                    }
                    else if (pt == "double")
                    {
                        os << "  %p" << i << " = bitcast i64 %a" << i << " to double\n";
                        call_args.push_back("double %p" + std::to_string(i));
                    }
                    else if (pt == "float")
                    {
                        os << "  %p" << i << " = trunc i64 %a" << i << " to i32\n";
                        os << "  %pf" << i << " = bitcast i32 %p" << i << " to float\n";
                        call_args.push_back("float %pf" + std::to_string(i));
                    }
                    else if (pt.find('*') != std::string::npos)
                    {
                        // 指针类型（form / lattice / string 等）：i64 → 指针
                        os << "  %p" << i << " = inttoptr i64 %a" << i << " to " << pt << "\n";
                        call_args.push_back(pt + " %p" + std::to_string(i));
                    }
                    else
                    {
                        throw std::runtime_error("MMI: unsupported export param type '" + pt + "'");
                    }
                }

                if (ex.ret == "void")
                    os << "  call void @" << ex.name << "(";
                else
                    os << "  %r = call " << ex.ret << " @" << ex.name << "(";
                for (size_t i = 0; i < call_args.size(); ++i)
                {
                    if (i)
                        os << ", ";
                    os << call_args[i];
                }
                os << ")\n";

                if (ex.ret == "void")
                {
                    os << "  ret i64 0\n";
                }
                else if (ex.ret == "i8" || ex.ret == "i16" || ex.ret == "i32" ||
                         ex.ret == "uint8" || ex.ret == "uint16" || ex.ret == "uint32")
                {
                    os << "  %r64 = zext " << ex.ret << " %r to i64\n";
                    os << "  ret i64 %r64\n";
                }
                else if (ex.ret == "i64" || ex.ret == "uint64")
                {
                    os << "  ret i64 %r\n";
                }
                else if (ex.ret == "double")
                {
                    os << "  %r64 = bitcast double %r to i64\n";
                    os << "  ret i64 %r64\n";
                }
                else if (ex.ret == "float")
                {
                    os << "  %r32 = bitcast float %r to i32\n";
                    os << "  %r64 = zext i32 %r32 to i64\n";
                    os << "  ret i64 %r64\n";
                }
                else if (ex.ret.find('*') != std::string::npos)
                {
                    // 指针类型（form / lattice / string 等）：指针 → i64
                    os << "  %r64 = ptrtoint " << ex.ret << " %r to i64\n";
                    os << "  ret i64 %r64\n";
                }
                else
                {
                    throw std::runtime_error("MMI: unsupported export ret type '" + ex.ret + "'");
                }

                os << "}\n";
            }
            return os.str();
        }
    };
}