# ─── stb_image 检测（vendor/stb/stb_image.h）──────────────
set(STB_IMAGE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../vendor/stb)
set(STB_IMAGE_HEADER ${STB_IMAGE_DIR}/stb_image.h)
if(EXISTS ${STB_IMAGE_HEADER})
    set(QUARKRSP_HAS_STB_IMAGE TRUE)
    message(STATUS "stb_image found: ${STB_IMAGE_HEADER}")
else()
    # stb_image 为 vendored 依赖(仓库内已提供),缺失即硬失败,
    # 避免「静默降级」导致 JPEG/PNG 纹理解码在生产环境悄悄失效。
    message(FATAL_ERROR "stb_image.h not found at ${STB_IMAGE_HEADER}. "
                        "This vendored dependency is required for JPEG/PNG texture decoding. "
                        "Restore it by downloading https://github.com/nothings/stb "
                        "(stb_image.h) into vendor/stb/")
endif()

# quarkRSP
add_executable(quarkRSP
    src/main.cpp
    src/vulkan_context.cpp
    src/qk_jit_host.cpp
)
if(QUARKRSP_HAS_STB_IMAGE)
    target_sources(quarkRSP PRIVATE src/stb_image_impl.cpp)
    target_compile_definitions(quarkRSP PRIVATE QUARKRSP_USE_STB_IMAGE)
endif()
target_include_directories(quarkRSP PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include
    ${VENDOR_DIR}
    ${STB_IMAGE_DIR}
)
target_link_libraries(quarkRSP PRIVATE quark_rt Kokkos::kokkos ${Vulkan_LIBRARIES} ${GLFW_LIB})
if(WIN32)
    target_link_libraries(quarkRSP PRIVATE ws2_32 gdi32)
    # GUI 程序：无控制台窗口
    set_target_properties(quarkRSP PROPERTIES WIN32_EXECUTABLE TRUE)
    if(MSVC)
        target_link_options(quarkRSP PRIVATE /ENTRY:mainCRTStartup)
    endif()
elseif(UNIX AND NOT APPLE)
    target_link_libraries(quarkRSP PRIVATE m pthread dl)
endif()
quark_sign_target(quarkRSP)

# ─── 着色器编译──────────
find_program(GLSLC glslc HINTS "$ENV{VULKAN_SDK}/Bin")
if(GLSLC)
    set(SHADER_OUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/shaders)
    foreach(s mesh.vert mesh.frag sky.vert sky.frag line.vert line.frag)
        add_custom_command(
            OUTPUT ${SHADER_OUT_DIR}/${s}.spv
            COMMAND ${GLSLC} --target-env=vulkan1.0 ${CMAKE_CURRENT_SOURCE_DIR}/shaders/${s} -o ${SHADER_OUT_DIR}/${s}.spv
            DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/shaders/${s}
            COMMENT "Compiling shader ${s}"
        )
    endforeach()
    add_custom_target(quarkRSP_shaders ALL
        DEPENDS ${SHADER_OUT_DIR}/mesh.vert.spv ${SHADER_OUT_DIR}/mesh.frag.spv
                ${SHADER_OUT_DIR}/sky.vert.spv ${SHADER_OUT_DIR}/sky.frag.spv
                ${SHADER_OUT_DIR}/line.vert.spv ${SHADER_OUT_DIR}/line.frag.spv)
    add_dependencies(quarkRSP quarkRSP_shaders)
else()
    message(WARNING "glslc not found — build shaders manually (mesh.vert/mesh.frag -> SPIR-V)")
endif()

# ─── 单元测试 ───────────────────────────────────────────
enable_testing()
add_executable(quarkRSP_tests
    tests/test_main.cpp
    tests/test_math.cpp
    tests/test_physics.cpp
    tests/test_cylinder_collision.cpp
    tests/test_joints.cpp
    tests/test_skeleton_bind.cpp
    tests/test_robot_json.cpp
    tests/test_chaos_mesh.cpp
    tests/test_mesh_generator.cpp
    tests/test_gate_commutation.cpp
    tests/test_graph.cpp
    tests/test_pcg.cpp
    tests/test_qcdrc.cpp
    tests/test_qpu_circuit.cpp
    tests/test_json.cpp
    tests/test_rl.cpp
    tests/test_device.cpp
    tests/test_glb.cpp
    tests/test_bridge.cpp
    tests/test_consciousness.cpp
    tests/test_rl_pipeline.cpp
    tests/test_mocap_device.cpp
    tests/test_gltf_material.cpp
    tests/test_texture_decoder.cpp
    tests/test_brain_bridge.cpp
    tests/test_gltf_uv.cpp
    tests/test_jpeg_decoder.cpp
    tests/test_field_mesh.cpp
    tests/test_prosthetic.cpp
    tests/test_prosthetic_driver.cpp
    tests/test_hardware.cpp
    tests/test_safety.cpp
    tests/test_hil.cpp
)
target_include_directories(quarkRSP_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include
    ${VENDOR_DIR}
)
# test_robot_json/test_chaos_mesh经 physics_kernel → QVM 间接依赖 Kokkos
target_link_libraries(quarkRSP_tests PRIVATE quark_rt Kokkos::kokkos)
add_test(NAME quarkRSP_tests COMMAND quarkRSP_tests)

# ─── RL 端到端 demo ──────────────────────────────────────
add_executable(quarkRSP_rl_demo
    src/rl_demo.cpp
)
target_include_directories(quarkRSP_rl_demo PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include
    ${VENDOR_DIR}
)
target_link_libraries(quarkRSP_rl_demo PRIVATE quark_rt Kokkos::kokkos)
if(WIN32)
    target_link_libraries(quarkRSP_rl_demo PRIVATE ws2_32)
endif()

# ─── 性能基准 benchmark──────────────────────────────
add_executable(quarkRSP_benchmark
    src/benchmark.cpp
)
target_include_directories(quarkRSP_benchmark PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include
    ${VENDOR_DIR}
)
target_link_libraries(quarkRSP_benchmark PRIVATE quark_rt Kokkos::kokkos)
if(WIN32)
    target_link_libraries(quarkRSP_benchmark PRIVATE ws2_32)
endif()

# ─── Linux rpath：从构建目录 / 自身目录加载 libquark_rt.so ───────────
if(UNIX AND NOT APPLE)
    set_target_properties(quarkRSP quarkRSP_tests quarkRSP_rl_demo PROPERTIES
        BUILD_RPATH "$<TARGET_FILE_DIR:quark_rt>"
        INSTALL_RPATH "\$ORIGIN")
endif()

# ============================================================
# QUARKRSP GUI —— Qt Widgets 量子机器人仿真平台 UI
# ============================================================
# Qt 6.11.2 MSVC 版位于 "C:/Qt/6.11.2/msvc2022_64"
if(WIN32 AND NOT Qt6_DIR)
    unset(Qt6_DIR CACHE)
    set(Qt6_DIR "C:/Qt/6.11.2/msvc2022_64/lib/cmake/Qt6")
endif()
find_package(Qt6 QUIET COMPONENTS Widgets Gui Multimedia Test Concurrent)
if(Qt6_FOUND)
    set(CMAKE_AUTOMOC ON)
    set(CMAKE_AUTORCC ON)
    set(CMAKE_AUTOUIC ON)

    # ─── 仿真内核静态库（含真实 PhysicsKernel/Teleop/RL/QVM）────────
    # 单独成库并链接 Kokkos，避免 Kokkos 的 CUDA 编译规则污染 Qt 代码
    add_library(quarkRSP_sim STATIC
        gui/src/simulation_host.cpp
    )
    target_include_directories(quarkRSP_sim PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include
        ${CMAKE_CURRENT_SOURCE_DIR}/gui/qt
        ${VENDOR_DIR}
    )
    target_link_libraries(quarkRSP_sim PRIVATE quark_rt Kokkos::kokkos)
    # 注入 chaos 测试模型路径（若存在则优先加载，否则回退程序化立方体）
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../_tmp_test.glb")
        target_compile_definitions(quarkRSP_sim PRIVATE
            QUARKRSP_TEST_GLB_PATH="${CMAKE_CURRENT_SOURCE_DIR}/../_tmp_test.glb")
        message(STATUS "chaos mesh: will load _tmp_test.glb")
    endif()

    # ─── Qt GUI 可执行（QVulkanWindow 的真 3D 视口 + QTabWidget 面板）──
    add_executable(quarkRSP_gui
        gui/qt/main.cpp
        gui/qt/main_window.cpp
        gui/qt/vulkan_viewport.cpp
        gui/qt/panels.cpp
        gui/qt/project_browser.cpp
        gui/qt/loading_screen.cpp
        gui/qt/project_store.cpp
        gui/qt/content_browser.cpp
        gui/qt/script_editor.cpp
        gui/qt/asset_viewers.cpp
        gui/qt/asset_types.cpp
        gui/qt/theme_manager.cpp
        gui/qt/log_manager.cpp
        gui/qt/crash_handler.cpp
        gui/qt/settings_dialog.cpp
        gui/qt/find_replace_dialog.cpp
        gui/qt/i18n/i18n.cpp
        src/qk_jit_host.cpp
        resources.qrc
    )
    target_include_directories(quarkRSP_gui PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include
        ${VENDOR_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/gui/qt
        ${CMAKE_CURRENT_SOURCE_DIR}/gui/src
    )
    # QVulkanWindow 需要 Qt6::Gui（含 Vulkan 支持）+ Vulkan SDK
    # OpenSSL（libcrypto）：插件包 Ed25519 签名校验
    find_package(OpenSSL QUIET)
    target_link_libraries(quarkRSP_gui PRIVATE Qt6::Widgets Qt6::Gui Qt6::Multimedia Qt6::Concurrent quarkRSP_sim ${Vulkan_LIBRARIES})
    if(OpenSSL_FOUND)
        target_link_libraries(quarkRSP_gui PRIVATE OpenSSL::Crypto)
    else()
        target_link_libraries(quarkRSP_gui PRIVATE crypto)
    endif()
    # quarkRSP_gui 是纯 Qt/Vulkan 代码，必须用 host 编译器（g++）编译。
    # 全局 CXX 编译器是 nvcc_wrapper（供 Kokkos CUDA 用），但它会把 .cpp 也
    # 交给 nvcc，导致 Qt 代码的 STL ABI 与 Qt 库（g++ 编译）不匹配，运行时
    # 触发 free(): invalid pointer 崩溃。--host-only 让 nvcc_wrapper 改用 g++。
    target_compile_options(quarkRSP_gui PRIVATE --host-only)
    if(WIN32)
        set_target_properties(quarkRSP_gui PROPERTIES WIN32_EXECUTABLE TRUE)
        if(MSVC)
            target_link_options(quarkRSP_gui PRIVATE /ENTRY:mainCRTStartup)
        endif()
    endif()

    # 注入 shader 绝对路径 + 依赖 shader 编译
    # 注意：值不带引号，避免 nvcc_wrapper --host-only 传参时引号错位；
    # 源码侧用字符串化宏把它转成字符串字面量。
    target_compile_definitions(quarkRSP_gui PRIVATE
        QUARKRSP_SHADER_DIR=${CMAKE_CURRENT_BINARY_DIR}/shaders)
    if(TARGET quarkRSP_shaders)
        add_dependencies(quarkRSP_gui quarkRSP_shaders)
    endif()

    # ─── Qt 运行时部署（windeployqt）──────────────────────────────
    # 自动复制 Qt DLL + 平台插件（qwindows.dll）等到输出目录，
    # 解决「Qt 平台插件没有被初始化」问题。
    if(WIN32)
        find_program(WINDEPLOYQT_EXE windeployqt HINTS
            "C:/Qt/6.11.2/msvc2022_64/bin")
        if(WINDEPLOYQT_EXE)
            add_custom_command(TARGET quarkRSP_gui POST_BUILD
                COMMAND ${WINDEPLOYQT_EXE}
                    --release --no-translations --no-system-d3d-compiler
                    --no-opengl-sw
                    "$<TARGET_FILE:quarkRSP_gui>"
                COMMENT "Deploying Qt runtime (windeployqt)")
        else()
            message(WARNING "windeployqt not found — Qt DLLs must be deployed manually")
        endif()

        # ─── 代码签名（解决 WDAC 拦截）────────────────────────────
        # 在 windeployqt 之后签名（签名必须在 DLL 部署后，否则被覆盖）。
        find_program(POWERSHELL_EXE powershell)
        if(POWERSHELL_EXE AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/sign.ps1")
            add_custom_command(TARGET quarkRSP_gui POST_BUILD
                COMMAND ${POWERSHELL_EXE} -ExecutionPolicy Bypass -File
                    "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/sign.ps1"
                    -Targets "$<TARGET_FILE:quarkRSP_gui>"
                COMMENT "Code signing quarkRSP_gui.exe")
        endif()
    endif()

    # ─── GUI 纯逻辑模块单元测试（Qt Test）────────────────────────
    # 覆盖 LogManager / project_store(JSON 序列化) / asset_types / ThemeManager，
    # 不依赖 render / Vulkan / Kokkos，仅链接 Qt6::Core/Widgets/Test。
    add_executable(quarkRSP_gui_tests
        tests/gui_test_main.cpp
        tests/test_log_manager.cpp
        tests/test_project_store.cpp
        tests/test_asset_types.cpp
        tests/test_theme_manager.cpp
        gui/qt/log_manager.cpp
        gui/qt/project_store.cpp
        gui/qt/theme_manager.cpp
        gui/qt/asset_types.cpp
        gui/qt/i18n/i18n.cpp
    )
    target_include_directories(quarkRSP_gui_tests PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include
        ${CMAKE_CURRENT_SOURCE_DIR}/gui/qt
        ${CMAKE_CURRENT_SOURCE_DIR}/tests
        ${VENDOR_DIR}
    )
    target_link_libraries(quarkRSP_gui_tests PRIVATE Qt6::Core Qt6::Widgets Qt6::Test)
    add_test(NAME quarkRSP_gui_tests COMMAND quarkRSP_gui_tests)
    # 纯逻辑测试，headless CI 环境下用 offscreen 平台即可运行
    set_tests_properties(quarkRSP_gui_tests PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")

    message(STATUS "Qt6 found: quarkRSP_gui (Qt 仿真平台 UI) enabled")
else()
    message(WARNING "Qt6 not found — quarkRSP_gui disabled. "
                    "Set Qt6_DIR to C:/Qt/6.11.2/msvc2022_64/lib/cmake/Qt6")
endif()

# ============================================================
# 安装规则: quarkRSP 可执行文件 + 公共头文件
# ============================================================
install(TARGETS quarkRSP quarkRSP_rl_demo quarkRSP_benchmark
        RUNTIME DESTINATION bin)
if(TARGET quarkRSP_gui)
    install(TARGETS quarkRSP_gui RUNTIME DESTINATION bin)
endif()
install(DIRECTORY include/ DESTINATION include/quarkRSP)
