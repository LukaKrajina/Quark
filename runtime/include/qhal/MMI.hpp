#pragma once
#include "SandboxJIT.hpp"

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
            if (data.size() < 12)
                throw std::runtime_error("Invalid .mmi: file too short");
            if (data.substr(0, 4) != "QKMM")
                throw std::runtime_error("Invalid .mmi: bad magic");

            uint32_t version = read_u32(data, 4);
            if (version != 1)
                throw std::runtime_error("Unsupported .mmi version");

            uint32_t header_len = read_u32(data, 8);
            if (12 + header_len > data.size())
                throw std::runtime_error("Invalid .mmi: header out of bounds");

            std::string header_json = data.substr(12, header_len);
            std::string ir = data.substr(12 + header_len);

            json::Value header = json::parse(header_json);
            if (header.kind != json::Value::Obj)
                throw std::runtime_error("MMI: bad header");

            std::set<std::string> permissions;
            auto pit = header.obj.find("permissions");
            if (pit != header.obj.end() && pit->second.kind == json::Value::Arr)
                for (const auto &p : pit->second.arr)
                    if (p.kind == json::Value::Str)
                        permissions.insert(p.str);

            auto eit = header.obj.find("exports");
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
                    exports_.push_back(ex);
                    export_map_[ex.name] = ex;
                }
            }

            std::string full_ir = ir + build_thunks_ir();

            jit_ = std::make_unique<SandboxJIT>(permissions);
            jit_->add_ir(full_ir);

            auto iit = header.obj.find("imports");
            if (iit != header.obj.end() && iit->second.kind == json::Value::Arr)
            {
                for (const auto &imp : iit->second.arr)
                {
                    if (imp.kind != json::Value::Obj)
                        continue;
                    auto ait = imp.obj.find("alias");
                    auto pit2 = imp.obj.find("path");
                    if (ait == imp.obj.end() || ait->second.kind != json::Value::Str)
                        continue;
                    if (pit2 == imp.obj.end() || pit2->second.kind != json::Value::Str)
                        continue;
                    std::string alias = ait->second.str;
                    std::string dep_path = pit2->second.str;

                    if (!loader)
                        throw std::runtime_error("MMI: import '" + dep_path + "' requires a dependency loader");

                    auto dep = loader(dep_path, self_dir_);
                    if (!dep)
                        throw std::runtime_error("MMI: failed to load import '" + dep_path + "'");
                    deps_.push_back(dep);

                    for (const auto &ex : dep->exports_)
                    {
                        void *addr = dep->lookup_export_address(ex.name);
                        if (addr)
                            jit_->bind_symbol(alias + "_" + ex.name, addr);
                    }
                }
            }
        }

        static uint32_t read_u32(const std::string &data, size_t off)
        {
            return (uint32_t)(unsigned char)data[off] |
                   ((uint32_t)(unsigned char)data[off + 1] << 8) |
                   ((uint32_t)(unsigned char)data[off + 2] << 16) |
                   ((uint32_t)(unsigned char)data[off + 3] << 24);
        }
        
        std::string build_thunks_ir()
        {
            std::ostringstream os;
            for (const auto &ex : exports_)
            {
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
                    else
                    {
                        throw std::runtime_error("MMI: unsupported export param type '" + pt + "'");
                    }
                }

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