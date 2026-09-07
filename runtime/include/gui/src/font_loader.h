#pragma once
#include "nuklear_config.h"
#include <string>

namespace qgui
{

    bool find_i18n_font(std::string &out_cjk, std::string &out_cyrillic);

    void load_i18n_fonts(struct nk_font_atlas *atlas);

}
