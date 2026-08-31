#pragma once
#include "../components/window.h"
#include "../i18n.hpp"
#include <complex>
#include <cmath>
#include <cstdio>
#include <limits.h>

namespace qgui
{

    // 单量子比特布洛赫球投影。
    // 计算选定量子比特的约化密度矩阵，并在XY平面上绘制其(x, y, z)布洛赫向量。
    class BlochSphereWindow : public IWindow
    {
    public:
        const char *title() const override { return tr("Bloch Sphere"); }

        void render(nk_context *ctx, const StateSnapshot &snap, float dt) override
        {
            (void)dt;
            if (nk_begin(ctx, title(), nk_rect(30, 370, 460, 340),
                         NK_WINDOW_BORDER | NK_WINDOW_TITLE | NK_WINDOW_MOVABLE | NK_WINDOW_SCALABLE))
            {
                int nq = static_cast<int>(snap.num_qubits);
                if (nq <= 0 || snap.amplitudes.empty())
                {
                    nk_layout_row_dynamic(ctx, 20, 1);
                    nk_label(ctx, tr("Waiting for state data..."), NK_TEXT_LEFT);
                    nk_end(ctx);
                    return;
                }
                if (qubit_ >= nq)
                    qubit_ = 0;

                nk_layout_row_dynamic(ctx, 24, 2);
                char sel[32];
                snprintf(sel, sizeof(sel), tr("Qubit: %d"), qubit_);
                nk_label(ctx, sel, NK_TEXT_LEFT);
                if (nk_button_label(ctx, "<"))
                {
                    if (qubit_ > 0)
                        qubit_--;
                }
                if (nk_button_label(ctx, ">"))
                {
                    if (qubit_ + 1 < nq)
                        qubit_++;
                }
                size_t mask = 1ULL << qubit_;
                double rho00 = 0.0, rho11 = 0.0;
                std::complex<double> rho01{0.0, 0.0};
                size_t n = snap.amplitudes.size();
                for (size_t i = 0; i < n; ++i)
                {
                    const auto &a = snap.amplitudes[i];
                    if (i & mask)
                    {
                        rho11 += std::norm(a);
                    }
                    else
                    {
                        rho00 += std::norm(a);
                        size_t j = i | mask;
                        if (j < n)
                            rho01 += a * std::conj(snap.amplitudes[j]);
                    }
                }
                double bx = 2.0 * rho01.real();
                double by = 2.0 * rho01.imag();
                double bz = rho00 - rho11;

                nk_layout_space_begin(ctx, NK_STATIC, 220, INT_MAX);
                struct nk_command_buffer *canvas = nk_window_get_canvas(ctx);
                struct nk_rect region = nk_layout_space_bounds(ctx);

                float cx = region.x + 100.0f;
                float cy = region.y + 110.0f;
                float r = 85.0f;

                nk_stroke_circle(canvas, nk_rect(cx - r, cy - r, 2 * r, 2 * r), 1.5f, nk_rgb(120, 120, 120));
                nk_stroke_line(canvas, cx - r, cy, cx + r, cy, 1.0f, nk_rgb(70, 70, 70));
                nk_stroke_line(canvas, cx, cy - r, cx, cy + r, 1.0f, nk_rgb(70, 70, 70));

                float px = cx + static_cast<float>(bx * r);
                float py = cy - static_cast<float>(by * r);
                nk_stroke_line(canvas, cx, cy, px, py, 1.5f, nk_rgb(230, 120, 60));
                nk_fill_circle(canvas, nk_rect(px - 5, py - 5, 10, 10), nk_rgb(230, 120, 60));
                nk_layout_space_end(ctx);

                nk_layout_row_dynamic(ctx, 18, 1);
                char vx[64], vy[64], vz[64];
                snprintf(vx, sizeof(vx), "<x> = %+.4f", bx);
                snprintf(vy, sizeof(vy), "<y> = %+.4f", by);
                snprintf(vz, sizeof(vz), "<z> = %+.4f", bz);
                nk_label(ctx, vx, NK_TEXT_LEFT);
                nk_label(ctx, vy, NK_TEXT_LEFT);
                nk_label(ctx, vz, NK_TEXT_LEFT);

                double theta = std::acos(std::max(-1.0, std::min(1.0, bz)));
                double phi = std::atan2(by, bx);
                char ang[96];
                snprintf(ang, sizeof(ang), "theta = %.3f rad,  phi = %.3f rad", theta, phi);
                nk_label(ctx, ang, NK_TEXT_LEFT);
            }
            nk_end(ctx);
        }

    private:
        int qubit_ = 0;
    };
}