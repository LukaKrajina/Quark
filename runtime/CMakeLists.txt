<<<<<<< HEAD
cmake_minimum_required(VERSION 3.10)
project(runtime VERSION 0.1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

add_compile_definitions(NOMINMAX)
add_compile_definitions(_USE_MATH_DEFINES)
add_compile_definitions(NDEBUG)

if(MSVC)
    add_compile_definitions(_CRT_SECURE_NO_WARNINGS)
    add_compile_options(/EHsc)
else()
    add_compile_options(-fPIC)
    set(CMAKE_POSITION_INDEPENDENT_CODE ON)
endif()

# ==========================================
# 1. DEPENDENCIES
# ==========================================

# LLVM
find_package(LLVM REQUIRED CONFIG)
include_directories(${LLVM_INCLUDE_DIRS})
link_directories(${LLVM_LIBRARY_DIRS})

llvm_map_components_to_libnames(llvm_libs
    Core
    ExecutionEngine
    IRReader
    OrcJIT
    Support
    native
    Target
)

# Vulkan & GLFW
find_package(Vulkan REQUIRED)
include_directories(${Vulkan_INCLUDE_DIRS})
set(VENDOR_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../vendor")
include_directories(${VENDOR_DIR})
include_directories(${VENDOR_DIR}/GLFW/)
include_directories(${VENDOR_DIR}/Nuklear/)

# GLFW：Windows 使用 vendor 预编译库，Linux 由 vcpkg x64-linux 提供。
if(WIN32)
    link_directories(${VENDOR_DIR}/GLFW/lib-vc2026)
    set(GLFW_LIB glfw3)
else()
    set(GLFW_LIB glfw3)
endif()

# Kokkos：Windows 默认从 C:/Libraries/kokkos 查找；Linux 通过 vcpkg 或
# -DKokkos_DIR=<path> 提供。可通过 -DKokkos_ROOT / -DKokkos_DIR 覆盖。
if(WIN32 AND NOT Kokkos_DIR)
    unset(Kokkos_DIR CACHE)
    set(Kokkos_DIR "C:/Libraries/kokkos/lib/cmake/Kokkos")
endif()
find_package(Kokkos REQUIRED)
set_property(GLOBAL PROPERTY RULE_LAUNCH_COMPILE "")
set_property(GLOBAL PROPERTY RULE_LAUNCH_LINK "")

# Global Includes
include_directories(include)

# ─── 代码签名辅助函数（WDAC 拦截 → 构建后自动签名）──────────
function(quark_sign_target TARGET_NAME)
    if(WIN32)
        find_program(POWERSHELL_EXE powershell)
        if(POWERSHELL_EXE AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/sign.ps1")
            add_custom_command(TARGET ${TARGET_NAME} POST_BUILD
                COMMAND ${POWERSHELL_EXE} -ExecutionPolicy Bypass -File
                    "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/sign.ps1"
                    -Targets "$<TARGET_FILE:${TARGET_NAME}>"
                COMMENT "Code signing ${TARGET_NAME}.exe")
        endif()
    endif()
endfunction()

# ==========================================
# 2. TARGET: QUARK_RT_HOST 主机专用静态库（温控/WMI/串口）
#     含 Windows COM(SEH)/串口代码，不能被 Kokkos 的 CUDA 编译规则处理，
#     故单独成库且不链接 Kokkos。
# ==========================================
add_library(quark_rt_host STATIC
    src/ThermalSimulation.cpp
    src/ThermalController.cpp
)
target_include_directories(quark_rt_host PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
if(WIN32)
    # wbemuuid/ole32/oleaut32: WMI 温度读取（COM）
    target_link_libraries(quark_rt_host PRIVATE wbemuuid ole32 oleaut32)
elseif(UNIX AND NOT APPLE)
    target_link_libraries(quark_rt_host PRIVATE pthread m)
endif()

# ==========================================
# 3. TARGET: QUARK_RT 共享库（量子核心）
#     包含LLVM + Kokkos，产出 libquark_rt.dll / libquark_rt.so
# ==========================================
add_library(quark_rt SHARED
    src/runtime_api.cpp
    src/AtomicVaporORAM.cpp
)
target_compile_definitions(quark_rt PRIVATE QUARK_RT_BUILD)
target_include_directories(quark_rt PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(quark_rt PRIVATE quark_rt_host ${llvm_libs})
target_link_libraries(quark_rt PRIVATE Kokkos::kokkos)
if(WIN32)
    target_link_libraries(quark_rt PRIVATE ws2_32)
elseif(UNIX AND NOT APPLE)
    target_link_libraries(quark_rt PRIVATE pthread dl m)
endif()

# ==========================================
# 4. TARGET: RUNTIME 壳子
#    仅含 socket daemon + stdin 交互，通过 C ABI 调用 quark_rt
# ==========================================
add_executable(runtime
    src/main.cpp
)
target_include_directories(runtime PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(runtime PRIVATE quark_rt)
if(WIN32)
    target_link_libraries(runtime PRIVATE ws2_32 advapi32)
    # 无控制台窗口（后台服务 / 由管道驱动）
    set_target_properties(runtime PROPERTIES WIN32_EXECUTABLE TRUE)
    if(MSVC)
        # subsystem:windows 默认找 WinMain，显式指定 main 入口
        target_link_options(runtime PRIVATE /ENTRY:mainCRTStartup)
    endif()
elseif(UNIX AND NOT APPLE)
    target_link_libraries(runtime PRIVATE pthread)
endif()
quark_sign_target(runtime)

# ==========================================
# 5. TARGET: QLM TRANSMITTER
# ==========================================
add_executable(transmitter ${CMAKE_CURRENT_SOURCE_DIR}/include/qml/Transmitter.cpp)
target_include_directories(transmitter PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(transmitter PRIVATE quark_rt Kokkos::kokkos)
target_link_libraries(transmitter PRIVATE ${Vulkan_LIBRARIES} ${GLFW_LIB})
if(WIN32)
    target_link_libraries(transmitter PRIVATE ws2_32 gdi32)
elseif(UNIX AND NOT APPLE)
    target_link_libraries(transmitter PRIVATE m pthread dl)
endif()

if (MSVC)
    set_target_properties(transmitter PROPERTIES ENABLE_EXPORTS TRUE)
endif()
if(WIN32)
    # GUI 程序：无控制台窗口
    set_target_properties(transmitter PROPERTIES WIN32_EXECUTABLE TRUE)
    if(MSVC)
        target_link_options(transmitter PRIVATE /ENTRY:mainCRTStartup)
    endif()
endif()
quark_sign_target(transmitter)

# ==========================================
# 6. TARGET: QVM VISUALIZER
# ==========================================
add_executable(qvm_visualizer 
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/src/main_gui.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/src/render_context.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/src/app.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/src/daemon_client.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/components/circuit_grid.cpp
)
target_include_directories(qvm_visualizer PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(qvm_visualizer PRIVATE ${Vulkan_LIBRARIES} ${GLFW_LIB})

if(WIN32)
    target_link_libraries(qvm_visualizer PRIVATE ws2_32 gdi32)
    # GUI 程序：无控制台窗口
    set_target_properties(qvm_visualizer PROPERTIES WIN32_EXECUTABLE TRUE)
    if(MSVC)
        target_link_options(qvm_visualizer PRIVATE /ENTRY:mainCRTStartup)
    endif()
elseif(UNIX AND NOT APPLE)
    target_link_libraries(qvm_visualizer PRIVATE m pthread dl)
endif()
quark_sign_target(qvm_visualizer)

# ==========================================
# 7. TARGET: QUARKRSP
# ==========================================
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../quarkRSP quarkRSP)

# ==========================================
# 7b. TARGET: SPACETIME DEMO（快子场+切片数值基准）
#     header-only 模板，仅依赖 C++ 标准库，无额外第三方依赖。
# ==========================================
add_executable(spacetime_demo src/spacetime_demo.cpp)
target_include_directories(spacetime_demo PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
if(MSVC)
    target_compile_options(spacetime_demo PRIVATE /O2)
else()
    target_compile_options(spacetime_demo PRIVATE -O2)
endif()

add_executable(spacetime_demo2 src/spacetime_demo2.cpp)
target_include_directories(spacetime_demo2 PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
if(MSVC)
    target_compile_options(spacetime_demo2 PRIVATE /O2)
else()
    target_compile_options(spacetime_demo2 PRIVATE -O2)
endif()

add_executable(nucleation_demo src/nucleation_demo.cpp)
target_include_directories(nucleation_demo PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
if(MSVC)
    target_compile_options(nucleation_demo PRIVATE /O2)
else()
    target_compile_options(nucleation_demo PRIVATE -O2)
endif()

add_executable(spacetime_demo3 src/spacetime_demo3.cpp)
target_include_directories(spacetime_demo3 PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
if(MSVC)
    target_compile_options(spacetime_demo3 PRIVATE /O2)
else()
    target_compile_options(spacetime_demo3 PRIVATE -O2)
endif()

# ==========================================
# 8. Linux rpath：让可执行文件从构建目录 / 自身目录加载 libquark_rt.so
# ==========================================
if(UNIX AND NOT APPLE)
    set_target_properties(runtime transmitter qvm_visualizer PROPERTIES
        BUILD_RPATH "$<TARGET_FILE_DIR:quark_rt>"
        INSTALL_RPATH "\$ORIGIN")
endif()
=======
cmake_minimum_required(VERSION 3.10)
project(runtime VERSION 0.1.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ─── 生产化构建选项 ──────────────────────────────────
# Sanitizer:ASan + UBSan,用于 CI/本地排查内存与未定义行为
option(QUARKRSP_SANITIZE "Build with AddressSanitizer + UndefinedBehaviorSanitizer" OFF)
if(QUARKRSP_SANITIZE)
    if(MSVC)
        add_compile_options(/fsanitize=address)
    else()
        add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
        add_link_options(-fsanitize=address,undefined)
    endif()
    message(STATUS "Sanitizers (ASan/UBSan) ENABLED")
endif()

# 代码覆盖率(gcov/lcov):QUARKRSP_COVERAGE=ON 时用 --coverage + O0 便于行覆盖
option(QUARKRSP_COVERAGE "Enable code coverage (gcov/lcov)" OFF)
if(QUARKRSP_COVERAGE)
    if(MSVC)
        message(WARNING "MSVC coverage requires /profile; use clang/gcc --coverage instead")
    else()
        add_compile_options(--coverage -O0 -g)
        add_link_options(--coverage)
    endif()
    message(STATUS "Code coverage (gcov/lcov) ENABLED")
endif()

# 基础编译告警(-Werror 待告警清零后启用)
if(NOT MSVC)
    add_compile_options(-Wall -Wextra)
endif()

add_compile_definitions(NOMINMAX)
add_compile_definitions(_USE_MATH_DEFINES)
add_compile_definitions(NDEBUG)

if(MSVC)
    add_compile_definitions(_CRT_SECURE_NO_WARNINGS)
    add_compile_options(/EHsc)
else()
    add_compile_options(-fPIC)
    set(CMAKE_POSITION_INDEPENDENT_CODE ON)
endif()

# ==========================================
# 1. DEPENDENCIES
# ==========================================

# LLVM
find_package(LLVM REQUIRED CONFIG)
include_directories(${LLVM_INCLUDE_DIRS})
link_directories(${LLVM_LIBRARY_DIRS})

if(WIN32)
    llvm_map_components_to_libnames(llvm_libs
        Core
        ExecutionEngine
        IRReader
        OrcJIT
        Support
        native
        Target
    )
else()
    # Linux（如 Arch）提供合并的 libLLVM.so，包含全部组件；分立组件库不存在
    set(llvm_libs LLVM)
endif()

# Vulkan & GLFW
find_package(Vulkan REQUIRED)
include_directories(${Vulkan_INCLUDE_DIRS})
set(VENDOR_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../vendor")
include_directories(${VENDOR_DIR})
include_directories(${VENDOR_DIR}/GLFW/)
include_directories(${VENDOR_DIR}/Nuklear/)

# GLFW：Windows 使用 vendor 预编译库，Linux 由 vcpkg x64-linux 提供。
if(WIN32)
    link_directories(${VENDOR_DIR}/GLFW/lib-vc2026)
    set(GLFW_LIB glfw3)
else()
    set(GLFW_LIB glfw3)
endif()

# Kokkos：Windows 默认从 C:/Libraries/kokkos 查找；Linux 通过 vcpkg 或
# -DKokkos_DIR=<path> 提供。可通过 -DKokkos_ROOT / -DKokkos_DIR 覆盖。
if(WIN32 AND NOT Kokkos_DIR)
    unset(Kokkos_DIR CACHE)
    set(Kokkos_DIR "C:/Libraries/kokkos/lib/cmake/Kokkos")
endif()
find_package(Kokkos REQUIRED)
set_property(GLOBAL PROPERTY RULE_LAUNCH_COMPILE "")
set_property(GLOBAL PROPERTY RULE_LAUNCH_LINK "")

# Global Includes
include_directories(include)

# ─── 代码签名辅助函数（WDAC 拦截 → 构建后自动签名）──────────
function(quark_sign_target TARGET_NAME)
    if(WIN32)
        find_program(POWERSHELL_EXE powershell)
        if(POWERSHELL_EXE AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/sign.ps1")
            add_custom_command(TARGET ${TARGET_NAME} POST_BUILD
                COMMAND ${POWERSHELL_EXE} -ExecutionPolicy Bypass -File
                    "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/sign.ps1"
                    -Targets "$<TARGET_FILE:${TARGET_NAME}>"
                COMMENT "Code signing ${TARGET_NAME}.exe")
        endif()
    endif()
endfunction()

# ==========================================
# 2. TARGET: QUARK_RT_HOST 主机专用静态库（温控/WMI/串口）
#     含 Windows COM(SEH)/串口代码，不能被 Kokkos 的 CUDA 编译规则处理，
#     故单独成库且不链接 Kokkos。
# ==========================================
add_library(quark_rt_host STATIC
    src/ThermalSimulation.cpp
    src/ThermalController.cpp
)
target_include_directories(quark_rt_host PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
if(WIN32)
    # wbemuuid/ole32/oleaut32: WMI 温度读取（COM）
    target_link_libraries(quark_rt_host PRIVATE wbemuuid ole32 oleaut32)
elseif(UNIX AND NOT APPLE)
    target_link_libraries(quark_rt_host PRIVATE pthread m)
endif()

# ==========================================
# 3. TARGET: QUARK_RT 共享库（量子核心）
#     包含LLVM + Kokkos，产出 libquark_rt.dll / libquark_rt.so
# ==========================================
add_library(quark_rt SHARED
    src/runtime_api.cpp
    src/AtomicVaporORAM.cpp
)
target_compile_definitions(quark_rt PRIVATE QUARK_RT_BUILD)
target_include_directories(quark_rt PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(quark_rt PRIVATE quark_rt_host ${llvm_libs})
target_link_libraries(quark_rt PRIVATE Kokkos::kokkos)
if(WIN32)
    target_link_libraries(quark_rt PRIVATE ws2_32)
elseif(UNIX AND NOT APPLE)
    target_link_libraries(quark_rt PRIVATE pthread dl m)
endif()

# ==========================================
# 4. TARGET: RUNTIME 壳子
#    仅含 socket daemon + stdin 交互，通过 C ABI 调用 quark_rt
# ==========================================
add_executable(runtime
    src/main.cpp
)
target_include_directories(runtime PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(runtime PRIVATE quark_rt)
if(WIN32)
    target_link_libraries(runtime PRIVATE ws2_32 advapi32)
    # 无控制台窗口（后台服务 / 由管道驱动）
    set_target_properties(runtime PROPERTIES WIN32_EXECUTABLE TRUE)
    if(MSVC)
        # subsystem:windows 默认找 WinMain，显式指定 main 入口
        target_link_options(runtime PRIVATE /ENTRY:mainCRTStartup)
    endif()
elseif(UNIX AND NOT APPLE)
    target_link_libraries(runtime PRIVATE pthread)
endif()
quark_sign_target(runtime)

# ==========================================
# 5. TARGET: QLM TRANSMITTER
# ==========================================
add_executable(transmitter
    ${CMAKE_CURRENT_SOURCE_DIR}/include/qml/Transmitter.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/i18n.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/src/font_loader.cpp
)
target_include_directories(transmitter PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(transmitter PRIVATE quark_rt Kokkos::kokkos)
target_link_libraries(transmitter PRIVATE ${Vulkan_LIBRARIES} ${GLFW_LIB})
if(WIN32)
    target_link_libraries(transmitter PRIVATE ws2_32 gdi32)
elseif(UNIX AND NOT APPLE)
    target_link_libraries(transmitter PRIVATE m pthread dl)
endif()

if (MSVC)
    set_target_properties(transmitter PROPERTIES ENABLE_EXPORTS TRUE)
endif()
if(WIN32)
    # GUI 程序：无控制台窗口
    set_target_properties(transmitter PROPERTIES WIN32_EXECUTABLE TRUE)
    if(MSVC)
        target_link_options(transmitter PRIVATE /ENTRY:mainCRTStartup)
    endif()
endif()
quark_sign_target(transmitter)

# ==========================================
# 6. TARGET: QVM VISUALIZER
# ==========================================
add_executable(qvm_visualizer 
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/src/main_gui.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/src/render_context.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/src/app.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/src/daemon_client.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/src/font_loader.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/components/circuit_grid.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gui/i18n.cpp
)
target_include_directories(qvm_visualizer PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(qvm_visualizer PRIVATE ${Vulkan_LIBRARIES} ${GLFW_LIB})

if(WIN32)
    target_link_libraries(qvm_visualizer PRIVATE ws2_32 gdi32)
    # GUI 程序：无控制台窗口
    set_target_properties(qvm_visualizer PROPERTIES WIN32_EXECUTABLE TRUE)
    if(MSVC)
        target_link_options(qvm_visualizer PRIVATE /ENTRY:mainCRTStartup)
    endif()
elseif(UNIX AND NOT APPLE)
    target_link_libraries(qvm_visualizer PRIVATE m pthread dl)
endif()
quark_sign_target(qvm_visualizer)

# ==========================================
# 7. TARGET: QUARKRSP
# ==========================================
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../quarkRSP quarkRSP)

# ==========================================
# 8. TARGET: SPACETIME DEMO（快子场+切片数值基准）
#     header-only 模板，仅依赖 C++ 标准库，无额外第三方依赖。
# ==========================================
add_executable(spacetime_demo src/spacetime_demo.cpp)
target_include_directories(spacetime_demo PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
if(MSVC)
    target_compile_options(spacetime_demo PRIVATE /O2)
else()
    target_compile_options(spacetime_demo PRIVATE -O2)
endif()

add_executable(spacetime_demo2 src/spacetime_demo2.cpp)
target_include_directories(spacetime_demo2 PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
if(MSVC)
    target_compile_options(spacetime_demo2 PRIVATE /O2)
else()
    target_compile_options(spacetime_demo2 PRIVATE -O2)
endif()

add_executable(nucleation_demo src/nucleation_demo.cpp)
target_include_directories(nucleation_demo PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
if(MSVC)
    target_compile_options(nucleation_demo PRIVATE /O2)
else()
    target_compile_options(nucleation_demo PRIVATE -O2)
endif()

add_executable(spacetime_demo3 src/spacetime_demo3.cpp)
target_include_directories(spacetime_demo3 PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
if(MSVC)
    target_compile_options(spacetime_demo3 PRIVATE /O2)
else()
    target_compile_options(spacetime_demo3 PRIVATE -O2)
endif()

# ==========================================
# 9. Linux rpath：让可执行文件从构建目录 / 自身目录加载 libquark_rt.so
# ==========================================
if(UNIX AND NOT APPLE)
    set_target_properties(runtime transmitter qvm_visualizer PROPERTIES
        BUILD_RPATH "$<TARGET_FILE_DIR:quark_rt>"
        INSTALL_RPATH "\$ORIGIN")
endif()

# 打包:跳过 install 阶段的 RPATH 改写,避免 CPack 打包阶段
# RPATH_CHANGE 因 RPATH 冒号格式不匹配而失败(nvcc_wrapper 环境特有)。
# 代价:安装后的程序依赖系统 LD_LIBRARY_PATH 定位 libquark_rt.so。
set(CMAKE_SKIP_INSTALL_RPATH ON CACHE BOOL "Skip RPATH rewrite during install" FORCE)
set(CMAKE_SKIP_RPATH ON CACHE BOOL "Skip all RPATH generation" FORCE)

# ==========================================
# 10. 安装规则 + CPack 打包
# ==========================================
install(TARGETS quark_rt quark_rt_host
        RUNTIME DESTINATION bin
        LIBRARY DESTINATION lib
        ARCHIVE DESTINATION lib)
install(TARGETS runtime transmitter qvm_visualizer RUNTIME DESTINATION bin)
install(DIRECTORY include/ DESTINATION include)

# 打包元数据
set(CPACK_PACKAGE_NAME "quark")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Quark quantum robot simulation platform (quarkRSP)")
set(CPACK_PACKAGE_VENDOR "Quark")
set(CPACK_PACKAGE_CONTACT "quark@example.com")
set(CPACK_GENERATOR "TGZ")
if(UNIX AND NOT APPLE)
    list(APPEND CPACK_GENERATOR "DEB")
    set(CPACK_DEBIAN_PACKAGE_MAINTAINER "Quark <quark@example.com>")
endif()
include(CPack)
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
