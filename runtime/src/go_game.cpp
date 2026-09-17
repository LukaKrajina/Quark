// ============================================================
// The Spirit of Go —— 游戏启动器（双击启动）
// 加载主程序 game.mmi 并调用其入口 quark_main（GUI 主循环）。
// 所有 .qk 已编译为 .mmi，产物不含源码。
// ============================================================
#include "qhal/RuntimeApi.h"
#include <cstdio>
#include <string>
#ifdef _WIN32
#include <windows.h>
#endif

int main(int argc, char *argv[])
{
    std::string game_path = "game/game.mmi";
    if (argc > 1)
        game_path = argv[1];

    fprintf(stderr, "[Spirit of Go] loading %s\n", game_path.c_str());

    quark_runtime *rt = quark_runtime_create();
    if (!rt)
    {
        fprintf(stderr, "[Spirit of Go] Failed to create runtime\n");
        return 1;
    }

    // 加载原生扩展库（MCTS / Steam），并登记其导出符号供 .mmi 内 extern 解析
#ifdef _WIN32
    if (quark_runtime_load_native(rt, "go_ai_mcts.dll"))
    {
        HMODULE hm = GetModuleHandleA("go_ai_mcts.dll");
        if (hm)
            quark_runtime_register_native_symbol(rt, "mcts_choose_move",
                (void *)GetProcAddress(hm, "mcts_choose_move"));
    }
    if (quark_runtime_load_native(rt, "steam_qk.dll"))
    {
        HMODULE hm = GetModuleHandleA("steam_qk.dll");
        if (hm)
        {
            const char *syms[] = {"steam_native_init", "steam_native_lobby_create",
                                  "steam_native_lobby_join", "steam_native_peer_ready",
                                  "steam_native_poll", "steam_native_send"};
            for (const char *s : syms)
                quark_runtime_register_native_symbol(rt, s, (void *)GetProcAddress(hm, s));
        }
    }
    if (quark_runtime_load_native(rt, "classic_ai.dll"))
    {
        HMODULE hm = GetModuleHandleA("classic_ai.dll");
        if (hm)
            quark_runtime_register_native_symbol(rt, "ai_classic_move",
                (void *)GetProcAddress(hm, "ai_classic_move"));
    }
#endif

    quark_mmi *game = quark_runtime_load_mmi(rt, game_path.c_str());
    if (!game)
    {
        fprintf(stderr, "[Spirit of Go] Failed to load game .mmi: %s\n", game_path.c_str());
        quark_runtime_destroy(rt);
        return 1;
    }

    fprintf(stderr, "[T1] mmi loaded, invoking quark_main...\n");
    const char *ret = quark_runtime_mmi_invoke(game, "quark_main", "[]");
    (void)ret;
    fprintf(stderr, "[T2] quark_main returned\n");

    quark_runtime_mmi_unload(game);
    quark_runtime_destroy(rt);
    return 0;
}
