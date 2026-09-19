@echo off
setlocal

rem ============================================================================
rem  Windows 构建脚本（quark_rt）
rem ----------------------------------------------------------------------------
rem  前置依赖（需按本机路径修改）：
rem    - Visual Studio（提供 vcvars64.bat）
rem    - LLVM（clang-cl 或 LLVMConfig.cmake）
rem    - Kokkos（提供 KokkosConfig.cmake）
rem ============================================================================

rem 切换到脚本所在目录（项目根），避免硬编码绝对路径
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem  依赖路径（请按本机修改）
rem ---------------------------------------------------------------------------
set "VCVARS64=C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat"
set "CLANG_CL=C:\Program Files\LLVM\bin\clang-cl.exe"
set "LLVM_DIR=C:\Libraries\LLVM\lib\cmake\llvm"
set "KOKKOS_DIR=C:\Libraries\kokkos\lib\cmake\Kokkos"

rem ---------------------------------------------------------------------------
rem  vcvars64 初始化
rem ---------------------------------------------------------------------------
if not exist "%VCVARS64%" (
    echo [build.bat] 未找到 vcvars64.bat：%VCVARS64%
    echo [build.bat] 请修改 build.bat 中的 VCVARS64 路径后重试。
    exit /b 1
)
call "%VCVARS64%"
if errorlevel 1 ( echo VCVARS_FAILED & exit /b 1 )

rem ---------------------------------------------------------------------------
rem  CMake 配置
rem ---------------------------------------------------------------------------
if not exist runtime\build (
    echo === CONFIGURE ===
    cmake -S runtime -B runtime\build -G Ninja ^
      -DCMAKE_CXX_COMPILER="%CLANG_CL%" ^
      -DLLVM_DIR="%LLVM_DIR:\=/%" ^
      -DKokkos_DIR="%KOKKOS_DIR:\=/%" ^
      -DCMAKE_BUILD_TYPE=Release
    if errorlevel 1 ( echo CONFIGURE_FAILED & exit /b 1 )
)

echo === BUILD quark_rt ===
cmake --build runtime\build --target quark_rt -j 8
if errorlevel 1 ( echo BUILD_FAILED & exit /b 1 )

echo === DONE ===
endlocal
