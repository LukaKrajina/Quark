# Third-Party Notices / 第三方组件协议

本项目使用了以下第三方开源组件。这些组件归其各自作者所有，并遵循各自的许可证。
本项目（Quark）本身以 MIT 许可证发布，详见根目录 [LICENSE](./LICENSE)。

The Quark project is distributed under the MIT License (see [LICENSE](./LICENSE)).
The following third-party components are distributed under their own licenses.

## Node.js / VS Code 扩展

| 包 Package | 许可证 License |
| --- | --- |
| vscode-languageclient | MIT |
| vscode-languageserver | MIT |
| vscode-languageserver-textdocument | MIT |
| @types/node | MIT |
| @types/vscode | MIT |
| @types/mocha | MIT |
| @vscode/test-electron | MIT |
| mocha | MIT |
| typescript | Apache-2.0 |

## Web UI（quark-web-ui）

| 包 Package | 许可证 License |
| --- | --- |
| vite | MIT |
| vite-plugin-pwa | MIT |
| tailwindcss | MIT |
| @tailwindcss/vite | MIT |
| autoprefixer | MIT |
| postcss | MIT |
| typescript | Apache-2.0 |
| dexie | Apache-2.0 |
| fake-indexeddb | Apache-2.0 |
| eslint | MIT |
| eslint-config-prettier | MIT |
| globals | MIT |
| prettier | MIT |
| typescript-eslint | MIT |
| vitest | MIT |

## 安装器 Installer（Go）

| 包 Package | 许可证 License |
| --- | --- |
| golang.org/x/sys | BSD-3-Clause |

## quarkSE 编辑器 Editor（Electron）

| 包 Package | 许可证 License |
| --- | --- |
| electron | MIT |
| codemirror | MIT |
| @codemirror/lang-javascript | MIT |
| @codemirror/state | MIT |
| @codemirror/theme-one-dark | MIT |
| esbuild | MIT |
| eslint | MIT |
| eslint-config-prettier | MIT |
| globals | MIT |
| prettier | MIT |
| typescript-eslint | MIT |

## quarkRSP 仿真平台 Simulation Platform（可选依赖 Optional）

| 组件 Component | 许可证 License |
| --- | --- |
| Qt 6 | LGPL-3.0（含 Qt-LGPL-exception）或商业许可（版权：The Qt Company，仅在构建 `quarkRSP_gui` 时动态链接） |
| OpenCV | Apache-2.0（仅在启用 `QUARKRSP_USE_OPENCV` 时链接） |
| stb_image | MIT 或 Unlicense（公共领域）双许可（版权：Sean Barrett，仅在 `vendor/stb/` 放置时使用） |

## C++ 运行时 Runtime（C++20）

| 组件 Component | 许可证 License |
| --- | --- |
| LLVM | Apache-2.0 WITH LLVM-exception |
| Kokkos | BSD-3-Clause（部分捆绑组件遵循各自宽松许可证） |
| Vulkan SDK / Vulkan-Headers | Apache-2.0（The Khronos Group Inc.） |

## vendored 库 Vendored libraries

| 组件 Component | 位置 Location | 许可证 License |
| --- | --- | --- |
| GLFW | `vendor/GLFW/` | zlib/libpng License（版权：Marcus Geelnard、Camilla Löwy，详见 `vendor/GLFW/LICENSE.md`） |
| Nuklear | `vendor/Nuklear/` | MIT 或 Unlicense（公共领域）双许可，任选其一（版权：Micha Mettke，详见 `vendor/Nuklear/LICENSE`） |

## 说明 Notes

- 上述许可证文本以各组件随附的 `LICENSE` / `NOTICE` 文件为准；本文件仅作汇总说明。
- 使用、分发或再分发本项目时，请一并保留各第三方组件的版权与许可声明。
