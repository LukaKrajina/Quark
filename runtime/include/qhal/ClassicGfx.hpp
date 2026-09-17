#pragma once
//
// Classic Graphics Engine（经典图形引擎）—— cgfx_* 内建函数的 C ABI
//
// 面向 qk 语言的「经典」2D 图形渲染原语（区别于量子图形引擎 qgfx_*）。
// 与 cgui 共享同一 RenderContext（Nuklear + GLFW + Vulkan），单窗口。
// 坐标单位：窗口像素（原点左上）；颜色：单个 int32 十六进制 0xRRGGBB。
//
// 通用原语（与具体应用无关）：
//   cgfx_rect / cgfx_line / cgfx_ellipse / cgfx_triangle
//
#include "RuntimeApi.h"
#include <cstdint>

#ifndef QUARK_HOST_EXPORT
#define QUARK_HOST_EXPORT extern "C" QUARK_RT_API
#endif

namespace qhal
{
    struct ClassicGfxState
    {
        int32_t initialized = 0;
    };

    inline ClassicGfxState &cgfx_state()
    {
        static ClassicGfxState s;
        return s;
    }
} // namespace qhal

extern "C"
{
    // 填充矩形（x,y 左上；w,h 宽高；color 0xRRGGBB）
    QUARK_HOST_EXPORT void qk_cgfx_rect(int32_t x, int32_t y, int32_t w, int32_t h, int32_t color);
    // 直线（x0,y0 起点；x1,y1 终点；thickness 线宽像素；color 0xRRGGBB）
    QUARK_HOST_EXPORT void qk_cgfx_line(int32_t x0, int32_t y0, int32_t x1, int32_t y1, int32_t thickness, int32_t color);
    // 填充椭圆（cx,cy 中心；rx,ry 半轴；color 0xRRGGBB）
    QUARK_HOST_EXPORT void qk_cgfx_ellipse(int32_t cx, int32_t cy, int32_t rx, int32_t ry, int32_t color);
    // 填充三角形（三个顶点；color 0xRRGGBB）
    QUARK_HOST_EXPORT void qk_cgfx_triangle(int32_t x0, int32_t y0, int32_t x1, int32_t y1, int32_t x2, int32_t y2, int32_t color);

    // ─── 带 alpha 的原语（alpha 0-255：0 全透明，255 不透明）──────────
    // 供粒子特效等做淡出/拖尾（Nuklear 后端已启用 SRC_ALPHA 混合）。
    QUARK_HOST_EXPORT void qk_cgfx_rect_a(int32_t x, int32_t y, int32_t w, int32_t h, int32_t color, int32_t alpha);
    QUARK_HOST_EXPORT void qk_cgfx_line_a(int32_t x0, int32_t y0, int32_t x1, int32_t y1, int32_t thickness, int32_t color, int32_t alpha);
    QUARK_HOST_EXPORT void qk_cgfx_ellipse_a(int32_t cx, int32_t cy, int32_t rx, int32_t ry, int32_t color, int32_t alpha);
    QUARK_HOST_EXPORT void qk_cgfx_triangle_a(int32_t x0, int32_t y0, int32_t x1, int32_t y1, int32_t x2, int32_t y2, int32_t color, int32_t alpha);
}
