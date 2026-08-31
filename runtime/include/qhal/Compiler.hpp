#pragma once

#include <string>
#include <iostream>
#include <system_error>
#include <vector>
#include <optional>
#include <sstream>
#include <cstdlib>

#include "Export.hpp"
#include "llvm/IR/Module.h"
#include "llvm/IR/LegacyPassManager.h"
#include "llvm/Support/TargetSelect.h"
#include "llvm/Target/TargetMachine.h"
#include "llvm/Target/TargetOptions.h"
#include "llvm/MC/TargetRegistry.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/TargetParser/Host.h"
#include "llvm/TargetParser/Triple.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/Program.h"

#if defined(__linux__) || defined(__APPLE__)
#include <dlfcn.h>
#endif

namespace quark
{

    namespace
    {
        void anchor() {}

        std::string locate_runtime_lib_dir()
        {
#if defined(__linux__) || defined(__APPLE__)
            Dl_info info{};
            if (dladdr(reinterpret_cast<void *>(&anchor), &info) && info.dli_fname)
            {
                std::string full(info.dli_fname);
                std::size_t pos = full.find_last_of("/\\");
                return (pos == std::string::npos) ? std::string{} : full.substr(0, pos);
            }
#endif
            return {};
        }
    }


    class QUARK_RT_API AOTCompiler
    {
    public:
        static bool compile_to_binary(llvm::Module *module, const std::string &arch, const std::string &mode, const std::string &output_name)
        {
            llvm::InitializeAllTargetInfos();
            llvm::InitializeAllTargets();
            llvm::InitializeAllTargetMCs();
            llvm::InitializeAllAsmParsers();
            llvm::InitializeAllAsmPrinters();
            std::string target_triple;
#ifdef _WIN32
            if (arch == "x64")
                target_triple = "x86_64-pc-windows-msvc";
            else if (arch == "x32")
                target_triple = "i386-pc-windows-msvc";
            else if (arch == "arm64")
                target_triple = "aarch64-pc-windows-msvc";
#else
            if (arch == "x64")
                target_triple = "x86_64-pc-linux-gnu";
            else if (arch == "x32")
                target_triple = "i386-pc-linux-gnu";
            else if (arch == "arm64")
                target_triple = "aarch64-linux-gnu";
#endif
            if (target_triple.empty())
            {
                target_triple = llvm::sys::getDefaultTargetTriple();
            }
            llvm::Triple triple(target_triple);

            std::string error;
            auto target = llvm::TargetRegistry::lookupTarget(target_triple, error);
            if (!target)
            {
                llvm::errs() << "[AOT Error] " << error << "\n";
                return false;
            }

            llvm::TargetOptions opt;
            std::optional<llvm::Reloc::Model> reloc_model = std::nullopt;
            if (mode == "-m")
            {
                reloc_model = llvm::Reloc::PIC_;
            }

            auto target_machine = target->createTargetMachine(triple, "generic", "", opt, reloc_model);
            module->setDataLayout(target_machine->createDataLayout());
            module->setTargetTriple(triple);
            std::string obj_filename = output_name + ".o";
            std::error_code ec;
            llvm::raw_fd_ostream dest(obj_filename, ec, llvm::sys::fs::OF_None);

            if (ec)
            {
                llvm::errs() << "[AOT Error] Could not open file: " << ec.message() << "\n";
                return false;
            }

            llvm::legacy::PassManager pass;
            if (target_machine->addPassesToEmitFile(pass, dest, nullptr, llvm::CodeGenFileType::ObjectFile))
            {
                llvm::errs() << "[AOT Error] TargetMachine can't emit a file of this type.\n";
                return false;
            }

            pass.run(*module);
            dest.flush();
            dest.close();
            std::string ext = "";
            if (mode == "-m")
            {
#ifdef _WIN32
                ext = ".dll";
#elif __APPLE__
                ext = ".dylib";
#else
                ext = ".so";
#endif
            }
            else
            {
#ifdef _WIN32
                ext = ".exe";
#endif
            }

            std::string final_output = output_name + ext;
            std::cout << "[Quark AOT] LLVM Object file '" << obj_filename << "' generated.\n";
            std::cout << "[Quark AOT] Spawning system linker for -> " << final_output << "\n";
            std::vector<llvm::StringRef> candidate_linkers = {
#ifdef _WIN32
                "clang++.exe", "clang.exe", "g++.exe", "gcc.exe"
#else
                "clang++", "clang", "g++", "gcc"
#endif
            };

            llvm::ErrorOr<std::string> linker_path = std::errc::no_such_file_or_directory;
            for (const auto &candidate : candidate_linkers)
            {
                linker_path = llvm::sys::findProgramByName(candidate);
                if (linker_path)
                    break;
            }

            if (!linker_path)
            {
                llvm::errs() << "[AOT Error] Linker failed: No suitable C++ linker (clang/gcc) found in system PATH.\n";
                return false;
            }

            std::vector<llvm::StringRef> linker_args;
            linker_args.push_back(linker_path.get());

            if (mode == "-m")
            {
                linker_args.push_back("-shared");
            }

            if (arch == "x32")
                linker_args.push_back("-m32");

            linker_args.push_back(obj_filename);
            linker_args.push_back("-o");
            linker_args.push_back(final_output);
            std::string lib_dir = locate_runtime_lib_dir();
            std::string lib_dir_link_arg;
            std::string rpath_arg;

            if (!lib_dir.empty())
                lib_dir_link_arg = "-L" + lib_dir;

#if defined(__APPLE__)
            rpath_arg = "-Wl,-rpath,@loader_path";
#elif !defined(_WIN32)
            rpath_arg = "-Wl,-rpath,$ORIGIN";
#endif

            if (!lib_dir.empty() && !rpath_arg.empty())
                rpath_arg += ":" + lib_dir;

            if (!lib_dir_link_arg.empty())
                linker_args.push_back(lib_dir_link_arg);
            linker_args.push_back("-L.");
            linker_args.push_back("-lquark_rt");
            // 针对QCOS允许通过环境变量追加额外链接库（如 libqcos_hal）
            if (const char *extra = std::getenv("QUARK_AOT_EXTRA_LIBS"))
            {
                std::istringstream iss(extra);
                std::string tok;
                while (iss >> tok)
                    linker_args.push_back(tok);
            }
            if (!rpath_arg.empty())
                linker_args.push_back(rpath_arg);

            std::string err_msg;

            int link_res = llvm::sys::ExecuteAndWait(
                linker_path.get(),
                linker_args,
                std::nullopt,
                {},
                0,
                0,
                &err_msg);

            if (link_res != 0)
            {
                llvm::errs() << "[AOT Error] Linker failed (Exit " << link_res << "): " << err_msg << "\n";
                return false;
            }

            llvm::sys::fs::remove(obj_filename);
            std::cout << "[Quark AOT] Successfully compiled and linked: " << final_output << "\n";
            return true;
        }
    };
}