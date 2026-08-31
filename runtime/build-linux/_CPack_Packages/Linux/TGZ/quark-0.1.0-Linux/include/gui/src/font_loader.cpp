#include "font_loader.h"

#include <cstdio>
#include <filesystem>

namespace qgui
{

namespace
{

bool file_exists(const std::string &p)
{
    if (p.empty())
        return false;
    std::error_code ec;
    return std::filesystem::is_regular_file(p, ec);
}

// 覆盖 CJK + Latin 的字体候选（按平台，优先级自上而下）
const char *kCjkCandidates[] = {
    // Linux（Noto CJK 为理想选择，同时含 Latin/CJK）
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    // Windows
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/simsun.ttc",
    // macOS
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
};

// 覆盖 Cyrillic 的字体候选
const char *kCyrillicCandidates[] = {
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFNS.ttf",
};

} // namespace

bool find_i18n_font(std::string &out_cjk, std::string &out_cyrillic)
{
    out_cjk.clear();
    out_cyrillic.clear();
    for (const char *c : kCjkCandidates)
    {
        if (file_exists(c))
        {
            out_cjk = c;
            break;
        }
    }
    for (const char *c : kCyrillicCandidates)
    {
        if (file_exists(c))
        {
            out_cyrillic = c;
            break;
        }
    }
    return !out_cjk.empty() || !out_cyrillic.empty();
}

void load_i18n_fonts(struct nk_font_atlas *atlas)
{
    if (!atlas)
        return;

    const float height = 16.0f;

    // Latin + 常用标点 + CJK 标点 + CJK 表意文字（用于 CJK 主字体）
    static const nk_rune kLatinCjkRanges[] = {
        0x0020, 0x00FF, // Basic Latin + Latin-1 Supplement（英/法/德）
        0x2010, 0x2015, // 连字符 / 破折号
        0x2018, 0x201F, // 引号
        0x3000, 0x303F, // CJK 标点
        0x4E00, 0x9FFF, // CJK 统一表意文字（中文）
        0
    };

    // Latin + Cyrillic（当只有 Cyrillic 字体可用时作为主字体）
    static const nk_rune kLatinCyrillicRanges[] = {
        0x0020, 0x00FF, // Basic Latin + Latin-1 Supplement
        0x0400, 0x045F, // Cyrillic（俄语）
        0x2010, 0x2015,
        0x2018, 0x201F,
        0
    };

    std::string cjk, cyr;
    find_i18n_font(cjk, cyr);

    if (!cjk.empty())
    {
        // 1) 主字体：CJK 字体（通常同时含 Latin）
        struct nk_font_config cfg = nk_font_config(height);
        cfg.range = kLatinCjkRanges;
        nk_font_atlas_add_from_file(atlas, cjk.c_str(), height, &cfg);

        // 2) 合并 Cyrillic 字体（CJK 字体通常缺 Cyrillic）
        if (!cyr.empty())
        {
            struct nk_font_config cfg_cyr = nk_font_config(height);
            cfg_cyr.merge_mode = nk_true;
            cfg_cyr.range = nk_font_cyrillic_glyph_ranges();
            nk_font_atlas_add_from_file(atlas, cyr.c_str(), height, &cfg_cyr);
        }
    }
    else if (!cyr.empty())
    {
        // 3) 无 CJK 字体：以 Cyrillic 字体为主字体（覆盖 Latin + Cyrillic）
        struct nk_font_config cfg = nk_font_config(height);
        cfg.range = kLatinCyrillicRanges;
        nk_font_atlas_add_from_file(atlas, cyr.c_str(), height, &cfg);
    }
    else
    {
        // 4) 兜底：Nuklear 内置默认字体（仅 ASCII）
        nk_font_atlas_add_default(atlas, height, nullptr);
    }
}

} // namespace qgui
