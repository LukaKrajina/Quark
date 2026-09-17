// ============================================================
// Classic GUI（经典图形界面）—— cgui_* 的真实 Nuklear 实现
// 复用 qvm_visualizer 的 RenderContext（Nuklear + GLFW + Vulkan）。
// ============================================================
#include "qhal/ClassicGui.hpp"
#include "gui/src/render_context.h"
#include "nuklear_config.h"
#include <cstring>
#include <cstdio>
#include <chrono>
// 手动声明 Beep，避免 #include <windows.h> 引入 min/max 等宏污染
#ifdef _WIN32
extern "C" __declspec(dllimport) int __stdcall Beep(unsigned long dwFreq, unsigned long dwDuration);
#endif

namespace
{
    // 帧耗时剖析：帧间隔 gap = qk逻辑 + end_frame + 未计入空隙
    std::chrono::steady_clock::time_point g_frame_begin;
    std::chrono::steady_clock::time_point g_last_begin;
    std::chrono::steady_clock::time_point g_last_begin_prev;
    double g_qk_us = 0, g_render_us = 0, g_gap_us = 0;
    int g_prof_frames = 0;
    int g_begin_count = 0;
    void prof_report()
    {
        if (++g_prof_frames >= 20)
        {
            std::fprintf(stderr, "[PROF] gap=%.0fus qk=%.0fus render=%.0fus (%.1f fps)\n",
                         g_gap_us / g_prof_frames, g_qk_us / g_prof_frames,
                         g_render_us / g_prof_frames,
                         1000000.0 / (g_gap_us / g_prof_frames));
            g_qk_us = g_render_us = g_gap_us = 0;
            g_prof_frames = 0;
        }
    }
}


extern "C"
{
    QUARK_HOST_EXPORT int32_t qk_cgui_init(int32_t w, int32_t h, const char *title)
    {
        auto &s = qhal::cgui_state();
        if (s.impl)
            return 1;
        auto *rc = new qgui::RenderContext();
        if (rc->init(title ? title : "Classic GUI", w > 0 ? w : 640, h > 0 ? h : 480))
        {
            s.impl = rc;
            s.initialized = 1;
            s.width = w > 0 ? w : 640;
            s.height = h > 0 ? h : 480;
            if (title)
                strncpy(s.title, title, sizeof(s.title) - 1);
            return 1;
        }
        delete rc;
        return 0;
    }

    QUARK_HOST_EXPORT int32_t qk_cgui_should_close()
    {
        static int sc_count = 0;
        if (++sc_count % 500 == 0)
            std::fprintf(stderr, "[PROF] should_close calls: %d\n", sc_count);
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        return rc ? (rc->should_close() ? 1 : 0) : 1;
    }

    QUARK_HOST_EXPORT void qk_cgui_begin_frame()
    {
        auto now = std::chrono::steady_clock::now();
        g_gap_us += std::chrono::duration_cast<std::chrono::microseconds>(now - g_last_begin).count();
        g_last_begin = now;
        g_frame_begin = now;
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc)
            return;
        rc->begin_frame();
        // 默认窗口作为背景画布（无输入，不抢鼠标）；分区由 cgui_panel 控制。
        // cgfx 经 nk_window_find(此名) 每帧动态取 &win->buffer（swap 机制下指针会变，不可缓存）。
        nk_begin(rc->ctx(), s.title,
                 nk_rect(0, 0, (float)s.width, (float)s.height),
                 NK_WINDOW_BORDER | NK_WINDOW_NO_SCROLLBAR | NK_WINDOW_NO_INPUT);
        {
            int n = ++g_begin_count;
            if (n <= 200)
            {
                double gapMs = (now - g_last_begin_prev).count() / 1e6;
                std::fprintf(stderr, "[F] frame %d gap %.2fms\n", n, gapMs);
            }
        }
        g_last_begin_prev = now;
    }

    QUARK_HOST_EXPORT void qk_cgui_end_frame()
    {
        auto t0 = std::chrono::steady_clock::now();
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc)
            return;
        nk_end(rc->ctx());
        rc->end_frame();
        auto t1 = std::chrono::steady_clock::now();
        g_qk_us += std::chrono::duration_cast<std::chrono::microseconds>(t0 - g_frame_begin).count();
        g_render_us += std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
        prof_report();
    }

    QUARK_HOST_EXPORT int32_t qk_cgui_button(const char *label)
    {
        std::fprintf(stderr, "[BTN>] %s\n", label ? label : "(null)");
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc)
            return 0;
        int32_t r = nk_button_label(rc->ctx(), label) ? 1 : 0;
        std::fprintf(stderr, "[BTN<] %s = %d\n", label ? label : "(null)", r);
        return r;
    }

    QUARK_HOST_EXPORT void qk_cgui_text(const char *text)
    {
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc)
            return;
        nk_label(rc->ctx(), text, NK_TEXT_LEFT);
    }

    QUARK_HOST_EXPORT void qk_cgui_text_int(int32_t value)
    {
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc)
            return;
        char buf[32];
        snprintf(buf, sizeof(buf), "%d", value);
        nk_label(rc->ctx(), buf, NK_TEXT_LEFT);
    }

    QUARK_HOST_EXPORT int32_t qk_cgui_mouse_x()
    {
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc || !rc->window())
            return s.mouse_x;
        double x, y;
        glfwGetCursorPos(rc->window(), &x, &y);
        return (int32_t)x;
    }

    QUARK_HOST_EXPORT int32_t qk_cgui_mouse_y()
    {
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc || !rc->window())
            return s.mouse_y;
        double x, y;
        glfwGetCursorPos(rc->window(), &x, &y);
        return (int32_t)y;
    }

    QUARK_HOST_EXPORT int32_t qk_cgui_mouse_left_clicked()
    {
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc || !rc->window())
            return s.left_clicked;
        return glfwGetMouseButton(rc->window(), GLFW_MOUSE_BUTTON_LEFT) == GLFW_PRESS ? 1 : 0;
    }

    QUARK_HOST_EXPORT void qk_cgui_beep(int32_t frequency, int32_t duration_ms)
    {
        // 音效反馈（技能触发等）；同步蜂鸣，短时长不阻塞游戏循环
        std::fprintf(stderr, "[BEEP] %d\n", frequency);
#ifdef _WIN32
        Beep(frequency > 0 ? frequency : 800, duration_ms > 0 ? duration_ms : 100);
#else
        (void)frequency;
        (void)duration_ms;
        std::printf("\a");
        std::fflush(stdout);
#endif
    }

    QUARK_HOST_EXPORT int32_t qk_cgui_width()
    {
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (rc && rc->window())
        {
            int w, h;
            glfwGetWindowSize(rc->window(), &w, &h);
            return w;
        }
        return s.width;
    }

    QUARK_HOST_EXPORT int32_t qk_cgui_height()
    {
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (rc && rc->window())
        {
            int w, h;
            glfwGetWindowSize(rc->window(), &w, &h);
            return h;
        }
        return s.height;
    }

    // 开一个面板窗口（分区布局：顶部 HUD / 中央棋盘 / 底部操作）
    QUARK_HOST_EXPORT void qk_cgui_panel(int32_t x, int32_t y, int32_t w, int32_t h, const char *title)
    {
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc)
            return;
        nk_begin(rc->ctx(), title, nk_rect((float)x, (float)y, (float)w, (float)h),
                 NK_WINDOW_BORDER | NK_WINDOW_NO_SCROLLBAR);
    }

    QUARK_HOST_EXPORT void qk_cgui_panel_end()
    {
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc)
            return;
        nk_end(rc->ctx());
    }

    // 设置当前行为多列布局（横排按钮）
    QUARK_HOST_EXPORT void qk_cgui_row(int32_t cols, int32_t height)
    {
        auto &s = qhal::cgui_state();
        auto *rc = static_cast<qgui::RenderContext *>(s.impl);
        if (!rc)
            return;
        nk_layout_row_dynamic(rc->ctx(), (float)(height > 0 ? height : 34), cols > 0 ? cols : 1);
    }
}
