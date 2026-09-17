@echo off
setlocal

rem ============================================================================
rem  Windows 构建脚本（quark_rt）
rem ----------------------------------------------------------------------------
rem  前置依赖（需按本机路径修改）：
rem    - Visual Studio Build Tools（提供 vcvars64.bat）
rem    - LLVM（clang-cl 或 LLVMConfig.cmake）
rem    - vcpkg（提供工具链文件）
rem    - Kokkos（提供 KokkosConfig.cmake）
rem    - CUDA Toolkit（可选，Kokkos CUDA 后端）
rem ============================================================================

rem 切换到脚本所在目录（项目根），避免硬编码绝对路径
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem  依赖路径（请按本机修改）
rem ---------------------------------------------------------------------------
set "VCVARS64=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set "CLANG_CL=C:\Program Files\LLVM\bin\clang-cl.exe"
set "KOKKOS_DIR=C:\Libraries\kokkos\lib\cmake\Kokkos"
set "CUDA_PATH=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.9"
rem vcpkg 根目录（默认与项目同级，可覆盖）
set "VCPKG_ROOT=%~dp0vcpkg"

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
      -DCMAKE_TOOLCHAIN_FILE="%VCPKG_ROOT:\=/%/scripts/buildsystems/vcpkg.cmake" ^
      -DLLVM_DIR="%VCPKG_ROOT:\=/%/installed/x64-windows/share/llvm" ^
      -DKokkos_DIR="%KOKKOS_DIR:\=/%" ^
      -DCMAKE_CXX_FLAGS="/clang:--cuda-path=%CUDA_PATH:\=/%" ^
      -DCMAKE_BUILD_TYPE=Release
    if errorlevel 1 ( echo CONFIGURE_FAILED & exit /b 1 )
)

echo === BUILD quark_rt ===
cmake --build runtime\build --target quark_rt -j 8
if errorlevel 1 ( echo BUILD_FAILED & exit /b 1 )

echo === DONE ===
endlocal
