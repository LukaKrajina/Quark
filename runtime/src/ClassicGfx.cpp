// ============================================================
// Classic Graphics Engine（经典图形引擎）—— cgfx_* 通用 2D 图形原语
// 与 cgui 共享同一 RenderContext（Nuklear + GLFW + Vulkan），单窗口。
// 颜色：int32 十六进制 0xRRGGBB。
// ============================================================
#include "qhal/ClassicGfx.hpp"
#include "qhal/ClassicGui.hpp"
#include "gui/src/render_context.h"
#include "nuklear_config.h"

namespace
{
    struct nk_command_buffer *get_canvas()
    {
        // 按窗口名每帧动态查找背景窗口的画布。
        // Nuklear 的命令缓冲用 swap 机制管理，&win->buffer 的内容每帧变化，
        // 缓存指针会指向已交换失效的内存（命令堆积 → 渲染冻结）。
        auto &st = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(st.impl);
        if (!rc)
            return nullptr;
        auto *win = nk_window_find(rc->ctx(), st.title);
        if (!win)
            return nullptr;
        return &win->buffer;
    }

    // 0xRRGGBB → nk_color
    struct nk_color color(int32_t c)
    {
        int r = (c >> 16) & 0xFF;
        int g = (c >> 8) & 0xFF;
        int b = c & 0xFF;
        return nk_rgb(r, g, b);
    }

    // 0xRRGGBB + alpha(0-255) → nk_color（带 alpha 混合）
    struct nk_color color_a(int32_t c, int32_t alpha)
    {
        int r = (c >> 16) & 0xFF;
        int g = (c >> 8) & 0xFF;
        int b = c & 0xFF;
        int a = alpha < 0 ? 0 : (alpha > 255 ? 255 : alpha);
        return nk_rgba(r, g, b, a);
    }
} // namespace

extern "C"
{
    QUARK_HOST_EXPORT void qk_cgfx_rect(int32_t x, int32_t y, int32_t w, int32_t h, int32_t c)
    {
        auto *canvas = get_canvas();
        if (!canvas)
            return;
        nk_fill_rect(canvas, nk_rect((float)x, (float)y, (float)w, (float)h), 0.0f, color(c));
    }

    QUARK_HOST_EXPORT void qk_cgfx_line(int32_t x0, int32_t y0, int32_t x1, int32_t y1, int32_t thickness, int32_t c)
    {
        auto *canvas = get_canvas();
        if (!canvas)
            return;
        nk_stroke_line(canvas, (float)x0, (float)y0, (float)x1, (float)y1,
                       thickness > 0 ? (float)thickness : 1.0f, color(c));
    }

    QUARK_HOST_EXPORT void qk_cgfx_ellipse(int32_t cx, int32_t cy, int32_t rx, int32_t ry, int32_t c)
    {
        auto *canvas = get_canvas();
        if (!canvas)
            return;
        nk_fill_circle(canvas,
                       nk_rect((float)(cx - rx), (float)(cy - ry), (float)(rx * 2), (float)(ry * 2)),
                       color(c));
    }

    QUARK_HOST_EXPORT void qk_cgfx_triangle(int32_t x0, int32_t y0, int32_t x1, int32_t y1, int32_t x2, int32_t y2, int32_t c)
    {
        auto *canvas = get_canvas();
        if (!canvas)
            return;
        nk_fill_triangle(canvas, (float)x0, (float)y0, (float)x1, (float)y1, (float)x2, (float)y2, color(c));
    }

    // ─── 带 alpha 的原语 ────────────────────────────────────────
    QUARK_HOST_EXPORT void qk_cgfx_rect_a(int32_t x, int32_t y, int32_t w, int32_t h, int32_t c, int32_t alpha)
    {
        auto *canvas = get_canvas();
        if (!canvas)
            return;
        nk_fill_rect(canvas, nk_rect((float)x, (float)y, (float)w, (float)h), 0.0f, color_a(c, alpha));
    }

    QUARK_HOST_EXPORT void qk_cgfx_line_a(int32_t x0, int32_t y0, int32_t x1, int32_t y1, int32_t thickness, int32_t c, int32_t alpha)
    {
        auto *canvas = get_canvas();
        if (!canvas)
            return;
        nk_stroke_line(canvas, (float)x0, (float)y0, (float)x1, (float)y1,
                       thickness > 0 ? (float)thickness : 1.0f, color_a(c, alpha));
    }

    QUARK_HOST_EXPORT void qk_cgfx_ellipse_a(int32_t cx, int32_t cy, int32_t rx, int32_t ry, int32_t c, int32_t alpha)
    {
        auto *canvas = get_canvas();
        if (!canvas)
            return;
        nk_fill_circle(canvas,
                       nk_rect((float)(cx - rx), (float)(cy - ry), (float)(rx * 2), (float)(ry * 2)),
                       color_a(c, alpha));
    }

    QUARK_HOST_EXPORT void qk_cgfx_triangle_a(int32_t x0, int32_t y0, int32_t x1, int32_t y1, int32_t x2, int32_t y2, int32_t c, int32_t alpha)
    {
        auto *canvas = get_canvas();
        if (!canvas)
            return;
        nk_fill_triangle(canvas, (float)x0, (float)y0, (float)x1, (float)y1, (float)x2, (float)y2, color_a(c, alpha));
    }
}
