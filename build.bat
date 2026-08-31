<<<<<<< HEAD
@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 ( echo VCVARS_FAILED & exit /b 1 )
cd /d D:\BH_Project\quark-vscode

if not exist runtime\build (
    echo === CONFIGURE ===
    cmake -S runtime -B runtime\build -G Ninja ^
      -DCMAKE_CXX_COMPILER="C:/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/VC/Tools/Llvm/x64/bin/clang-cl.exe" ^
      -DCMAKE_TOOLCHAIN_FILE="D:/BH_Project/quark-vscode/vcpkg/scripts/buildsystems/vcpkg.cmake" ^
      -DLLVM_DIR="D:/BH_Project/quark-vscode/vcpkg/installed/x64-windows/share/llvm" ^
      -DKokkos_DIR="C:/Libraries/kokkos/lib/cmake/Kokkos" ^
      -DCMAKE_CXX_FLAGS="/clang:--cuda-path=C:/PROGRA~1/NVIDIA~2/CUDA/v12.9" ^
      -DCMAKE_BUILD_TYPE=Release
    if errorlevel 1 ( echo CONFIGURE_FAILED & exit /b 1 )
)

echo === BUILD quark_rt ===
cmake --build runtime\build --target quark_rt -j 8
if errorlevel 1 ( echo BUILD_FAILED & exit /b 1 )

echo === DONE ===
endlocal
=======
@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 ( echo VCVARS_FAILED & exit /b 1 )
cd /d D:\BH_Project\quark-vscode

if not exist runtime\build (
    echo === CONFIGURE ===
    cmake -S runtime -B runtime\build -G Ninja ^
      -DCMAKE_CXX_COMPILER="C:/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/VC/Tools/Llvm/x64/bin/clang-cl.exe" ^
      -DCMAKE_TOOLCHAIN_FILE="D:/BH_Project/quark-vscode/vcpkg/scripts/buildsystems/vcpkg.cmake" ^
      -DLLVM_DIR="D:/BH_Project/quark-vscode/vcpkg/installed/x64-windows/share/llvm" ^
      -DKokkos_DIR="C:/Libraries/kokkos/lib/cmake/Kokkos" ^
      -DCMAKE_CXX_FLAGS="/clang:--cuda-path=C:/PROGRA~1/NVIDIA~2/CUDA/v12.9" ^
      -DCMAKE_BUILD_TYPE=Release
    if errorlevel 1 ( echo CONFIGURE_FAILED & exit /b 1 )
)

echo === BUILD quark_rt ===
cmake --build runtime\build --target quark_rt -j 8
if errorlevel 1 ( echo BUILD_FAILED & exit /b 1 )

echo === DONE ===
endlocal
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
