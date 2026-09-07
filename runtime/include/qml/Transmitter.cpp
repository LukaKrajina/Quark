#include "../qhal/QVM.hpp"
#include "../qlm/QLM.hpp"
#include "QKMFormat.hpp"
#include "../../src/QDataEncoder.hpp"

#include "../qml/Inference.hpp"
#include <iostream>
#include <iomanip>
#include <vector>
#include <string>
#include <memory>
#include <filesystem>
#include <algorithm>
#include <functional>
#include <thread>
#include <mutex>
#include <atomic>
#include <cstring>
#include <sstream>
#include <fstream>
#include <unordered_map>

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#define NK_IMPLEMENTATION
#define NK_GLFW_VULKAN_IMPLEMENTATION
#include "../gui/src/nuklear_config.h"
#include "../gui/i18n.hpp"
#include "../gui/src/font_loader.h"
#include "Nuklear/nuklear_glfw_vulkan.h"

#ifdef _WIN32
#include <windows.h>
#include <CommCtrl.h>
#include <commdlg.h>
#include <winsock2.h>
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;
using namespace qgui;

class QuarkTrainerGUI;
struct TrainingConfiguration;
struct NetworkNode;

enum class OperationMode
{
    LOCAL_MODE,
    SHARED_MODE,
    QUANTUM_NETWORK_MODE
};

enum class MiddelBottomIdentify
{
    LEFT_ARROW,
    RIGHT_ARROW,
    DELETES,
    REFRESH
};

struct TrainingConfiguration
{
    std::string model_name;
    int epochs = 25;
    double learning_rate = 0.02;
    int qubits = 16;
    int layers = 6;
    std::string output_path = "./output/";
    std::vector<std::string> training_files;
};

struct NetworkNode
{
    std::string id;
    std::string address;
    int port;
    bool is_active;
    int latency_ms;
    float quantum_fidelity;
};

struct FileItem
{
    fs::path path;
    bool is_directory;
    int is_selected;
    uintmax_t size;
    std::string modified_time;
};

class GUIComponent
{
protected:
    QuarkTrainerGUI *parent;
    const char *title_;
    struct nk_rect bounds_;
    bool visible_ = true;

public:
    GUIComponent(QuarkTrainerGUI *p, const char *title, struct nk_rect bounds)
        : parent(p), title_(title), bounds_(bounds) {}

    virtual ~GUIComponent() = default;

    void render(struct nk_context *ctx)
    {
        if (!visible_)
            return;
        // 支持移动、缩放（拖边）、最小化、关闭
        nk_flags flags = NK_WINDOW_BORDER | NK_WINDOW_TITLE | NK_WINDOW_MOVABLE |
                         NK_WINDOW_SCALABLE | NK_WINDOW_MINIMIZABLE | NK_WINDOW_CLOSABLE;
        if (nk_begin(ctx, title_, bounds_, flags))
        {
            render_content(ctx);
        }
        nk_end(ctx);
    }

    virtual void update() {}

    const char *title() const { return title_; }
    void set_visible(bool v) { visible_ = v; }
    bool visible() const { return visible_; }

protected:
    virtual void render_content(struct nk_context *ctx) = 0;
};

class TopBar : public GUIComponent
{
private:
    std::string current_file;
    std::vector<std::string> recent_files;
    char search_buffer[256];

public:
    // 菜单回调（由 QuarkTrainerGUI 在构造时注入）
    std::function<void()> on_new;
    std::function<void()> on_open;
    std::function<void()> on_save;
    std::function<void()> on_export;
    std::function<void()> on_select_all;
    std::function<void()> on_deselect_all;
    std::function<void()> on_invert;
    std::function<void()> on_refresh;
    std::function<void()> on_toggle_left;
    std::function<void()> on_toggle_right;
    std::function<void()> on_show_all;
    std::function<void()> on_start_training;
    std::function<void()> on_stop_training;
    std::function<void()> on_configure;
    std::function<void(OperationMode)> on_set_mode;
    std::function<void()> on_about;
    std::function<void()> on_documentation;
    std::function<void()> on_shortcuts;

    TopBar(QuarkTrainerGUI *p) : GUIComponent(p, "Quark Trainer", nk_rect(0, 0, 1280, 70))
    {
        recent_files = {"chaos_fluid_predictor.qkm", "quantum_model_1.qkm"};
        memset(search_buffer, 0, sizeof(search_buffer));
    }

protected:
    void render_content(struct nk_context *ctx) override
    {
        nk_menubar_begin(ctx);
        nk_layout_row_begin(ctx, NK_STATIC, 25, 8);
        nk_layout_row_push(ctx, 45);
        if (nk_menu_begin_label(ctx, tr("File"), NK_TEXT_LEFT, nk_vec2(140, 200)))
        {
            nk_layout_row_dynamic(ctx, 20, 1);
            if (nk_menu_item_label(ctx, tr("New"), NK_TEXT_LEFT) && on_new)
                on_new();
            if (nk_menu_item_label(ctx, tr("Open..."), NK_TEXT_LEFT) && on_open)
                on_open();
            if (nk_menu_item_label(ctx, tr("Save"), NK_TEXT_LEFT) && on_save)
                on_save();
            if (nk_menu_item_label(ctx, tr("Export"), NK_TEXT_LEFT) && on_export)
                on_export();
            nk_menu_item_label(ctx, tr("Recent Files"), NK_TEXT_LEFT);
            for (const auto &rf : recent_files)
                nk_menu_item_label(ctx, rf.c_str(), NK_TEXT_LEFT);
            nk_menu_end(ctx);
        }

        nk_layout_row_push(ctx, 45);
        if (nk_menu_begin_label(ctx, tr("Edit"), NK_TEXT_LEFT, nk_vec2(140, 150)))
        {
            nk_layout_row_dynamic(ctx, 20, 1);
            if (nk_menu_item_label(ctx, tr("Select All"), NK_TEXT_LEFT) && on_select_all)
                on_select_all();
            if (nk_menu_item_label(ctx, tr("Deselect All"), NK_TEXT_LEFT) && on_deselect_all)
                on_deselect_all();
            if (nk_menu_item_label(ctx, tr("Invert Selection"), NK_TEXT_LEFT) && on_invert)
                on_invert();
            nk_menu_end(ctx);
        }

        nk_layout_row_push(ctx, 50);
        if (nk_menu_begin_label(ctx, tr("View"), NK_TEXT_LEFT, nk_vec2(140, 120)))
        {
            nk_layout_row_dynamic(ctx, 20, 1);
            if (nk_menu_item_label(ctx, tr("Refresh"), NK_TEXT_LEFT) && on_refresh)
                on_refresh();
            if (nk_menu_item_label(ctx, tr("Toggle Left"), NK_TEXT_LEFT) && on_toggle_left)
                on_toggle_left();
            if (nk_menu_item_label(ctx, tr("Toggle Right"), NK_TEXT_LEFT) && on_toggle_right)
                on_toggle_right();
            if (nk_menu_item_label(ctx, tr("Show All Panels"), NK_TEXT_LEFT) && on_show_all)
                on_show_all();
            nk_menu_end(ctx);
        }

        nk_layout_row_push(ctx, 75);
        if (nk_menu_begin_label(ctx, tr("Training"), NK_TEXT_LEFT, nk_vec2(160, 120)))
        {
            nk_layout_row_dynamic(ctx, 20, 1);
            if (nk_menu_item_label(ctx, tr("Start Training"), NK_TEXT_LEFT) && on_start_training)
                on_start_training();
            if (nk_menu_item_label(ctx, tr("Stop Training"), NK_TEXT_LEFT) && on_stop_training)
                on_stop_training();
            if (nk_menu_item_label(ctx, tr("Configure..."), NK_TEXT_LEFT) && on_configure)
                on_configure();
            nk_menu_end(ctx);
        }

        nk_layout_row_push(ctx, 70);
        if (nk_menu_begin_label(ctx, tr("Network"), NK_TEXT_LEFT, nk_vec2(170, 120)))
        {
            nk_layout_row_dynamic(ctx, 20, 1);
            if (nk_menu_item_label(ctx, tr("Local Mode (LM)"), NK_TEXT_LEFT) && on_set_mode)
                on_set_mode(OperationMode::LOCAL_MODE);
            if (nk_menu_item_label(ctx, tr("Shared Mode (SM)"), NK_TEXT_LEFT) && on_set_mode)
                on_set_mode(OperationMode::SHARED_MODE);
            if (nk_menu_item_label(ctx, tr("Quantum Net (QNM)"), NK_TEXT_LEFT) && on_set_mode)
                on_set_mode(OperationMode::QUANTUM_NETWORK_MODE);
            nk_menu_end(ctx);
        }

        nk_layout_row_push(ctx, 70);
        if (nk_menu_begin_label(ctx, tr("Language"), NK_TEXT_LEFT, nk_vec2(160, 200)))
        {
            nk_layout_row_dynamic(ctx, 20, 1);
            Lang current = current_lang();
            const LangEntry *langs = available_langs();
            for (int i = 0; i < available_lang_count(); ++i)
            {
                std::string label = (langs[i].lang == current) ? "> " : "  ";
                label += langs[i].label;
                if (nk_menu_item_label(ctx, label.c_str(), NK_TEXT_LEFT))
                    set_lang(langs[i].lang);
            }
            nk_menu_end(ctx);
        }

        nk_layout_row_push(ctx, 50);
        if (nk_menu_begin_label(ctx, tr("Help"), NK_TEXT_LEFT, nk_vec2(200, 120)))
        {
            nk_layout_row_dynamic(ctx, 20, 1);
            if (nk_menu_item_label(ctx, tr("About QQNT"), NK_TEXT_LEFT) && on_about)
                on_about();
            if (nk_menu_item_label(ctx, tr("Documentation"), NK_TEXT_LEFT) && on_documentation)
                on_documentation();
            if (nk_menu_item_label(ctx, tr("Keyboard Shortcuts"), NK_TEXT_LEFT) && on_shortcuts)
                on_shortcuts();
            nk_menu_end(ctx);
        }

        nk_layout_row_push(ctx, 230);
        nk_edit_string_zero_terminated(ctx, NK_EDIT_FIELD,
                                       search_buffer, sizeof(search_buffer), nk_filter_default);

        nk_layout_row_end(ctx);
        nk_menubar_end(ctx);
    }

    void addRecentFile(const std::string &file)
    {
        recent_files.insert(recent_files.begin(), file);
        if (recent_files.size() > 10)
            recent_files.pop_back();
    }
};

class LeftSidebar : public GUIComponent
{
private:
    std::vector<FileItem> items;
    std::string current_path;
    int select_all_flag = 0;
    std::chrono::steady_clock::time_point last_click_time;
    size_t last_clicked_index = SIZE_MAX;
    std::vector<std::string> getAvailableDrives()
    {
        std::vector<std::string> drives;
#ifdef _WIN32
        char buf[256];
        GetLogicalDriveStringsA(sizeof(buf), buf);
        for (char *p = buf; *p; p += strlen(p) + 1)
            drives.push_back(std::string(p));
#else
        drives.push_back("/");
#endif
        return drives;
    }

public:
    LeftSidebar(QuarkTrainerGUI *p) : GUIComponent(p, "Files", nk_rect(10, 70, 300, 460)), select_all_flag(false)
    {
        current_path = fs::current_path().string();
        refreshDirectory();
    }

    void refreshDirectory()
    {
        items.clear();
        if (!fs::exists(current_path))
            return;

        for (const auto &entry : fs::directory_iterator(current_path))
        {
            FileItem item;
            item.path = entry.path();
            item.is_directory = entry.is_directory();
            item.is_selected = false;

            if (item.is_directory)
            {
                item.size = 0;
            }
            else
            {
                try
                {
                    item.size = fs::file_size(entry.path());
                }
                catch (...)
                {
                    item.size = 0;
                }
            }

            auto ftime = fs::last_write_time(entry.path());
            auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
            std::time_t cftime = std::chrono::system_clock::to_time_t(sctp);
            item.modified_time = std::ctime(&cftime);

            items.push_back(item);
        }

        std::sort(items.begin(), items.end(), [](const FileItem &a, const FileItem &b)
                  {
            if (a.is_directory != b.is_directory) return a.is_directory > b.is_directory;
            return a.path.filename() < b.path.filename(); });
    }

protected:
    void render_content(struct nk_context *ctx) override
    {
        nk_layout_row_dynamic(ctx, 25, 1);
        nk_label(ctx, tr("Drive / Directory"), NK_TEXT_LEFT);

        nk_layout_row_begin(ctx, NK_STATIC, 25, 2);
        nk_layout_row_push(ctx, 40);
        if (nk_button_label(ctx, tr("Up")))
            navigateUp();
        nk_layout_row_push(ctx, 180);
        char path_buf[512];
        snprintf(path_buf, sizeof(path_buf), "%s", current_path.c_str());
        nk_label(ctx, path_buf, NK_TEXT_LEFT);
        nk_layout_row_end(ctx);
        nk_layout_row_dynamic(ctx, 25, 1);
        auto drives = getAvailableDrives();
        if (nk_combo_begin_label(ctx, drives.empty() ? "(none)" : drives[0].c_str(), nk_vec2(200, 150)))
        {
            nk_layout_row_dynamic(ctx, 20, 1);
            for (const auto &d : drives)
            {
                if (nk_combo_item_label(ctx, d.c_str(), NK_TEXT_LEFT))
                    navigateTo(d);
            }
            nk_combo_end(ctx);
        }

        nk_layout_row_begin(ctx, NK_STATIC, 25, 2);
        nk_layout_row_push(ctx, 100);
        if (nk_button_label(ctx, tr("Select All")))
        {
            select_all_flag = !select_all_flag;
            for (auto &item : items)
                item.is_selected = select_all_flag;
        }
        nk_layout_row_push(ctx, 100);
        if (nk_button_label(ctx, tr("Deselect")))
        {
            for (auto &item : items)
                item.is_selected = false;
            select_all_flag = false;
        }
        nk_layout_row_end(ctx);
        nk_layout_row_dynamic(ctx, 350, 1);
        if (nk_group_begin(ctx, "LeftFileList", NK_WINDOW_BORDER))
        {
            nk_layout_row_begin(ctx, NK_STATIC, 20, 4);
            nk_layout_row_push(ctx, 25);
            nk_layout_row_push(ctx, 20);
            nk_layout_row_push(ctx, 120);
            nk_layout_row_push(ctx, 60);
            nk_layout_row_end(ctx);

            for (size_t i = 0; i < items.size(); ++i)
            {
                auto &item = items[i];
                nk_layout_row_begin(ctx, NK_STATIC, 20, 4);
                nk_layout_row_push(ctx, 25);
                nk_checkbox_label(ctx, "", &item.is_selected);
                nk_layout_row_push(ctx, 20);
                nk_label(ctx, item.is_directory ? "[D]" : "[F]", NK_TEXT_LEFT);
                nk_layout_row_push(ctx, 120);
                std::string name = item.path.filename().string();
                if (name.empty())
                    name = item.path.string();
                if (nk_selectable_label(ctx, name.c_str(), NK_TEXT_LEFT, &item.is_selected))
                {
                }

                nk_layout_row_push(ctx, 60);
                if (item.is_directory)
                    nk_label(ctx, "-", NK_TEXT_RIGHT);
                else
                {
                    char size_buf[32];
                    if (item.size < 1024)
                        snprintf(size_buf, sizeof(size_buf), "%llu B", (unsigned long long)item.size);
                    else if (item.size < 1024 * 1024)
                        snprintf(size_buf, sizeof(size_buf), "%.1f KB", item.size / 1024.0);
                    else
                        snprintf(size_buf, sizeof(size_buf), "%.1f MB", item.size / (1024.0 * 1024.0));
                    nk_label(ctx, size_buf, NK_TEXT_RIGHT);
                }

                nk_layout_row_end(ctx);
                if (item.is_directory && nk_widget_is_mouse_clicked(ctx, NK_BUTTON_LEFT))
                {
                    auto now = std::chrono::steady_clock::now();
                    if (last_clicked_index == i)
                    {
                        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_click_time);
                        if (elapsed.count() < 400)
                        {
                            navigateTo(items[i].path.string());
                            last_clicked_index = SIZE_MAX;
                        }
                        else
                        {
                            last_click_time = now;
                        }
                    }
                    else
                    {
                        last_clicked_index = i;
                        last_click_time = now;
                    }
                }
            }
            nk_group_end(ctx);
        }
    }

public:
    void navigateTo(const std::string &path)
    {
        if (fs::exists(path) && fs::is_directory(path))
        {
            current_path = path;
            refreshDirectory();
        }
    }

    void navigateUp()
    {
        auto parent = fs::path(current_path).parent_path();
        if (!parent.empty())
            navigateTo(parent.string());
    }

    std::vector<FileItem> getSelectedItems()
    {
        std::vector<FileItem> selected;
        for (const auto &item : items)
            if (item.is_selected)
                selected.push_back(item);
        return selected;
    }

    void toggleSelectAll()
    {
        select_all_flag = !select_all_flag;
        for (auto &item : items)
        {
            item.is_selected = select_all_flag;
        }
    }

    void toggleSelection(size_t index)
    {
        if (index < items.size())
        {
            items[index].is_selected = !items[index].is_selected;
        }
    }

    void selectAll()
    {
        select_all_flag = true;
        for (auto &item : items)
            item.is_selected = true;
    }

    void deselectAll()
    {
        select_all_flag = false;
        for (auto &item : items)
            item.is_selected = false;
    }

    void invertSelection()
    {
        for (auto &item : items)
            item.is_selected = !item.is_selected;
        select_all_flag = false;
    }

    std::string getCurrentPath() const { return current_path; }
};

class RightSidebarUpper : public GUIComponent
{
private:
    std::vector<FileItem> tmp_items;
    std::string tmp_path;

public:
    RightSidebarUpper(QuarkTrainerGUI *p) : GUIComponent(p, "Training Data", nk_rect(450, 70, 420, 250))
    {
        tmp_path = fs::temp_directory_path().string() + "/training_data";
        fs::create_directories(tmp_path);
        refreshTmpDirectory();
    }

    void refreshTmpDirectory()
    {
        tmp_items.clear();
        if (!fs::exists(tmp_path))
            fs::create_directories(tmp_path);

        for (const auto &entry : fs::directory_iterator(tmp_path))
        {
            FileItem item;
            item.path = entry.path();
            item.is_directory = entry.is_directory();
            item.is_selected = false;

            if (!item.is_directory)
            {
                try
                {
                    item.size = fs::file_size(entry.path());
                }
                catch (...)
                {
                    item.size = 0;
                }
            }

            tmp_items.push_back(item);
        }
    }

protected:
    void render_content(struct nk_context *ctx) override
    {
        nk_layout_row_dynamic(ctx, 20, 1);
        nk_label(ctx, tr("Training Data"), NK_TEXT_LEFT);

        nk_layout_row_dynamic(ctx, 20, 1);
        char path_buf[512];
        snprintf(path_buf, sizeof(path_buf), tr("Path: %s"), tmp_path.c_str());
        nk_label(ctx, path_buf, NK_TEXT_LEFT);
        nk_layout_row_dynamic(ctx, 22, 1);
        if (nk_button_label(ctx, tr("Clear")))
            clearTmp();
        nk_layout_row_dynamic(ctx, 150, 1);
        if (nk_group_begin(ctx, "DataList", NK_WINDOW_BORDER))
        {
            nk_layout_row_begin(ctx, NK_STATIC, 18, 4);
            nk_layout_row_push(ctx, 25);
            nk_layout_row_push(ctx, 20);
            nk_layout_row_push(ctx, 120);
            nk_layout_row_push(ctx, 60);
            nk_layout_row_end(ctx);

            for (auto &item : tmp_items)
            {
                nk_layout_row_begin(ctx, NK_STATIC, 18, 4);

                nk_layout_row_push(ctx, 25);
                nk_checkbox_label(ctx, "", &item.is_selected);

                nk_layout_row_push(ctx, 20);
                nk_label(ctx, item.is_directory ? "[D]" : "[F]", NK_TEXT_LEFT);

                nk_layout_row_push(ctx, 120);
                std::string name = item.path.filename().string();
                nk_label(ctx, name.c_str(), NK_TEXT_LEFT);

                nk_layout_row_push(ctx, 60);
                if (item.is_directory)
                    nk_label(ctx, "-", NK_TEXT_RIGHT);
                else
                {
                    char sz[32];
                    snprintf(sz, sizeof(sz), "%llu B", (unsigned long long)item.size);
                    nk_label(ctx, sz, NK_TEXT_RIGHT);
                }

                nk_layout_row_end(ctx);
            }
            nk_group_end(ctx);
        }
    }

public:
    void copyToTmp(const std::vector<FileItem> &items)
    {
        for (const auto &item : items)
        {
            try
            {
                auto dest = fs::path(tmp_path) / item.path.filename();
                if (item.is_directory)
                    fs::copy(item.path, dest, fs::copy_options::recursive | fs::copy_options::overwrite_existing);
                else
                    fs::copy_file(item.path, dest, fs::copy_options::overwrite_existing);
            }
            catch (const std::exception &e)
            {
                std::cerr << "Error copying " << item.path << ": " << e.what() << "\n";
            }
        }
        refreshTmpDirectory();
    }

    void clearTmp()
    {
        try
        {
            for (const auto &entry : fs::directory_iterator(tmp_path))
                fs::remove_all(entry.path());
            refreshTmpDirectory();
        }
        catch (const std::exception &e)
        {
            std::cerr << "Error clearing tmp: " << e.what() << "\n";
        }
    }

    std::vector<FileItem> getTmpItems() { return tmp_items; }
    std::vector<FileItem> &getTmpItemsRef() { return tmp_items; }
    std::string getTmpPath() const { return tmp_path; }
};

class RightSidebarLower : public GUIComponent
{
private:
    TrainingConfiguration config;
    char model_name_buf[128];
    char output_path_buf[256];

public:
    std::function<void()> on_save_config;

    RightSidebarLower(QuarkTrainerGUI *p) : GUIComponent(p, "Training Parameters", nk_rect(450, 330, 420, 260))
    {
        config.model_name = "model_0";
        config.epochs = 25;
        config.learning_rate = 0.02;
        config.qubits = 16;
        config.layers = 6;
        config.output_path = "./output/";
        syncBuffers();
    }

    void syncBuffers()
    {
        memset(model_name_buf, 0, sizeof(model_name_buf));
        strncpy(model_name_buf, config.model_name.c_str(), sizeof(model_name_buf) - 1);
        memset(output_path_buf, 0, sizeof(output_path_buf));
        strncpy(output_path_buf, config.output_path.c_str(), sizeof(output_path_buf) - 1);
    }

protected:
    void render_content(struct nk_context *ctx) override
    {
        nk_layout_row_dynamic(ctx, 20, 1);
        nk_label(ctx, tr("Training Parameters"), NK_TEXT_LEFT);
        nk_layout_row_begin(ctx, NK_STATIC, 25, 2);
        nk_layout_row_push(ctx, 90);
        nk_label(ctx, tr("Model:"), NK_TEXT_LEFT);
        nk_layout_row_push(ctx, 140);
        nk_edit_string_zero_terminated(ctx, NK_EDIT_FIELD, model_name_buf, sizeof(model_name_buf), nk_filter_default);
        nk_layout_row_end(ctx);
        nk_layout_row_begin(ctx, NK_STATIC, 25, 2);
        nk_layout_row_push(ctx, 90);
        nk_label(ctx, tr("Epochs:"), NK_TEXT_LEFT);
        nk_layout_row_push(ctx, 140);
        nk_property_int(ctx, "##epochs", 1, &config.epochs, 1000, 1, 1.0f);
        nk_layout_row_end(ctx);
        float lr = (float)config.learning_rate;
        nk_layout_row_begin(ctx, NK_STATIC, 25, 2);
        nk_layout_row_push(ctx, 90);
        nk_label(ctx, tr("Learn Rate:"), NK_TEXT_LEFT);
        nk_layout_row_push(ctx, 140);
        nk_property_float(ctx, "##lr", 0.0001f, &lr, 10.0f, 0.001f, 0.01f);
        config.learning_rate = lr;
        nk_layout_row_end(ctx);
        nk_layout_row_begin(ctx, NK_STATIC, 25, 2);
        nk_layout_row_push(ctx, 90);
        nk_label(ctx, tr("Qubits:"), NK_TEXT_LEFT);
        nk_layout_row_push(ctx, 140);
        nk_property_int(ctx, "##qubits", 1, &config.qubits, 64, 1, 1.0f);
        nk_layout_row_end(ctx);
        nk_layout_row_begin(ctx, NK_STATIC, 25, 2);
        nk_layout_row_push(ctx, 90);
        nk_label(ctx, tr("Layers:"), NK_TEXT_LEFT);
        nk_layout_row_push(ctx, 140);
        nk_property_int(ctx, "##layers", 1, &config.layers, 100, 1, 1.0f);
        nk_layout_row_end(ctx);
        nk_layout_row_begin(ctx, NK_STATIC, 25, 2);
        nk_layout_row_push(ctx, 90);
        nk_label(ctx, tr("Output:"), NK_TEXT_LEFT);
        nk_layout_row_push(ctx, 140);
        nk_edit_string_zero_terminated(ctx, NK_EDIT_FIELD,
                                       output_path_buf, sizeof(output_path_buf), nk_filter_default);
        nk_layout_row_end(ctx);
        nk_layout_row_dynamic(ctx, 30, 1);
        if (nk_button_label(ctx, tr("Start Training")))
        {
            config.model_name = model_name_buf;
            config.output_path = output_path_buf;
            startTrainingRequested = true;
        }

        nk_layout_row_dynamic(ctx, 30, 1);
        if (nk_button_label(ctx, tr("Save Config")))
        {
            config.model_name = model_name_buf;
            config.output_path = output_path_buf;
            if (on_save_config)
                on_save_config();
        }
    }

public:
    bool startTrainingRequested = false;

    void setConfig(const TrainingConfiguration &cfg)
    {
        config = cfg;
        syncBuffers();
    }

    TrainingConfiguration &getConfig()
    {
        config.model_name = model_name_buf;
        config.output_path = output_path_buf;
        return config;
    }
};

class MiddleBar : public GUIComponent
{
private:
    std::function<void()> onLeftArrow;
    std::function<void()> onRightArrow;
    std::function<void()> onDelete;
    std::function<void()> onRefresh;

public:
    MiddleBar(QuarkTrainerGUI *p) : GUIComponent(p, "Actions", nk_rect(320, 70, 120, 460)) {}

    void setCallbacks(std::function<void()> left, std::function<void()> right,
                      std::function<void()> del, std::function<void()> refresh)
    {
        onLeftArrow = left;
        onRightArrow = right;
        onDelete = del;
        onRefresh = refresh;
    }

protected:
    void render_content(struct nk_context *ctx) override
    {
        nk_layout_row_dynamic(ctx, 15, 1);
        nk_label(ctx, tr("Actions"), NK_TEXT_CENTERED);
        nk_layout_row_dynamic(ctx, 35, 1);
        if (nk_button_label(ctx, "<<"))
        {
            if (onLeftArrow)
                onLeftArrow();
        }

        if (nk_button_label(ctx, ">>"))
        {
            if (onRightArrow)
                onRightArrow();
        }

        if (nk_button_label(ctx, tr("Delete")))
        {
            if (onDelete)
                onDelete();
        }

        if (nk_button_label(ctx, tr("Refresh")))
        {
            if (onRefresh)
                onRefresh();
        }

        nk_layout_row_dynamic(ctx, 15, 1);
        nk_label(ctx, "", NK_TEXT_LEFT);
        nk_label(ctx, "<< : tmp->left", NK_TEXT_CENTERED);
        nk_label(ctx, ">> : left->tmp", NK_TEXT_CENTERED);
    }

    void triggerLeftArrow()
    {
        if (onLeftArrow)
            onLeftArrow();
    }
    void triggerRightArrow()
    {
        if (onRightArrow)
            onRightArrow();
    }
    void triggerDelete()
    {
        if (onDelete)
            onDelete();
    }
    void triggerRefresh()
    {
        if (onRefresh)
            onRefresh();
    }
};

class BottomBar : public GUIComponent
{
private:
    OperationMode current_mode;
    std::vector<NetworkNode> network_nodes;
    std::atomic<bool> network_scanning;
    std::thread network_thread;
    std::mutex nodes_mutex;

public:
    BottomBar(QuarkTrainerGUI *p) : GUIComponent(p, "Mode", nk_rect(10, 540, 860, 80)), current_mode(OperationMode::LOCAL_MODE), network_scanning(false) {}

    ~BottomBar()
    {
        network_scanning = false;
        if (network_thread.joinable())
            network_thread.join();
    }

protected:
    void render_content(struct nk_context *ctx) override
    {
        nk_layout_row_dynamic(ctx, 5, 1);
        nk_layout_row_begin(ctx, NK_STATIC, 30, 5);
        nk_layout_row_push(ctx, 60);
        nk_label(ctx, tr("Mode:"), NK_TEXT_LEFT);
        nk_layout_row_push(ctx, 180);
        int is_lm = (current_mode == OperationMode::LOCAL_MODE);
        if (nk_selectable_label(ctx, tr("LM (Local Mode)"), NK_TEXT_CENTERED, &is_lm))
        {
            if (is_lm)
                setMode(OperationMode::LOCAL_MODE);
        }

        nk_layout_row_push(ctx, 200);
        int is_sm = (current_mode == OperationMode::SHARED_MODE);
        if (nk_selectable_label(ctx, tr("SM (Shared Mode)"), NK_TEXT_CENTERED, &is_sm))
        {
            if (is_sm)
                setMode(OperationMode::SHARED_MODE);
        }

        nk_layout_row_push(ctx, 240);
        int is_qnm = (current_mode == OperationMode::QUANTUM_NETWORK_MODE);
        if (nk_selectable_label(ctx, tr("QNM (Quantum Network Mode)"), NK_TEXT_CENTERED, &is_qnm))
        {
            if (is_qnm)
                setMode(OperationMode::QUANTUM_NETWORK_MODE);
        }

        nk_layout_row_end(ctx);

        if (current_mode != OperationMode::LOCAL_MODE)
        {
            nk_layout_row_begin(ctx, NK_STATIC, 20, 3);
            nk_layout_row_push(ctx, 150);
            {
                std::lock_guard<std::mutex> lock(nodes_mutex);
                char buf[64];
                snprintf(buf, sizeof(buf), tr("Active Nodes: %zu"), network_nodes.size());
                nk_label(ctx, buf, NK_TEXT_LEFT);
            }
            nk_layout_row_push(ctx, 200);
            nk_label(ctx, network_scanning ? tr("Status: Scanning...") : tr("Status: Ready"), NK_TEXT_LEFT);
            nk_layout_row_push(ctx, 300);
            {
                std::lock_guard<std::mutex> lock(nodes_mutex);
                if (!network_nodes.empty())
                {
                    const auto &n = network_nodes[0];
                    char node_buf[128];
                    snprintf(node_buf, sizeof(node_buf), "%s @ %s:%d (%.3f)",
                             n.id.c_str(), n.address.c_str(), n.port, n.quantum_fidelity);
                    nk_label(ctx, node_buf, NK_TEXT_LEFT);
                }
                else
                {
                    nk_label(ctx, "", NK_TEXT_LEFT);
                }
            }
            nk_layout_row_end(ctx);
        }
        else
        {
            nk_layout_row_dynamic(ctx, 20, 1);
            nk_label(ctx, tr("Local drive mode — read/write from local filesystem"), NK_TEXT_LEFT);
        }
    }

public:
    void setMode(OperationMode mode)
    {
        current_mode = mode;
        if (mode == OperationMode::SHARED_MODE)
        {
            startP2PScan();
        }
        else if (mode == OperationMode::QUANTUM_NETWORK_MODE)
        {
            startQuantumNetworkScan();
        }
        else
        {
            stopNetworkScan();
        }
    }

    OperationMode getMode() const { return current_mode; }

    std::vector<NetworkNode> getNetworkNodes()
    {
        std::lock_guard<std::mutex> lock(nodes_mutex);
        return network_nodes;
    }

private:
    void startP2PScan()
    {
        network_scanning = true;
        if (network_thread.joinable())
            network_thread.join();
        network_thread = std::thread([this]()
                                     {
            while (network_scanning && current_mode == OperationMode::SHARED_MODE) {
                std::this_thread::sleep_for(std::chrono::seconds(2));
                if (network_nodes.size() < 10) {
                    NetworkNode node;
                    node.id = "node_" + std::to_string(network_nodes.size());
                    node.address = "192.168.1." + std::to_string(100 + network_nodes.size());
                    node.port = 8888 + network_nodes.size();
                    node.is_active = true;
                    node.latency_ms = rand() % 100 + 10;
                    node.quantum_fidelity = 0.95 + (rand() % 50) / 1000.0;
                    network_nodes.push_back(node);
                }
            } });
    }

    void startQuantumNetworkScan()
    {
        network_scanning = true;
        if (network_thread.joinable())
            network_thread.join();
        network_thread = std::thread([this]()
                                     {
            while (network_scanning && current_mode == OperationMode::QUANTUM_NETWORK_MODE) {
                std::this_thread::sleep_for(std::chrono::seconds(3));
                if (network_nodes.size() < 5) {
                    NetworkNode node;
                    node.id = "qnode_" + std::to_string(network_nodes.size());
                    node.address = "10.0.0." + std::to_string(10 + network_nodes.size());
                    node.port = 7777 + network_nodes.size();
                    node.is_active = true;
                    node.latency_ms = rand() % 5 + 1;
                    node.quantum_fidelity = 0.99 + (rand() % 10) / 1000.0;
                    network_nodes.push_back(node);
                }
            } });
    }

    void stopNetworkScan()
    {
        network_scanning = false;
        if (network_thread.joinable())
        {
            network_thread.join();
        }
        std::lock_guard<std::mutex> lock(nodes_mutex);
        network_nodes.clear();
    }
};

class QuarkTrainerGUI
{
private:
    qhal::QVM virtual_machine;
    std::unique_ptr<qlm::QLM> learning_machine;
    std::unique_ptr<TopBar> top_bar;
    std::unique_ptr<LeftSidebar> left_sidebar;
    std::unique_ptr<MiddleBar> middle_bar;
    std::unique_ptr<RightSidebarUpper> right_upper;
    std::unique_ptr<RightSidebarLower> right_lower;
    std::unique_ptr<BottomBar> bottom_bar;
    std::atomic<bool> is_running;
    std::atomic<bool> is_training;
    std::thread training_thread;
    std::mutex gui_mutex;
    std::unordered_map<int, int> prev_keys_;
    bool show_left_sidebar = true;
    bool show_right_sidebar = true;
    bool show_about_popup = false;
    bool show_shortcuts_popup = false;
    bool show_doc_popup = false;

    GLFWwindow *glfw_window = nullptr;
    VkInstance vk_instance = VK_NULL_HANDLE;
    VkSurfaceKHR vk_surface = VK_NULL_HANDLE;
    VkPhysicalDevice vk_physical_device = VK_NULL_HANDLE;
    VkDevice vk_device = VK_NULL_HANDLE;
    VkQueue vk_queue = VK_NULL_HANDLE;
    VkSwapchainKHR vk_swapchain = VK_NULL_HANDLE;
    std::vector<VkImageView> swapchain_image_views;
    std::vector<VkImage> swapchain_images;
    VkSemaphore image_available_semaphore = VK_NULL_HANDLE;
    uint32_t graphics_queue_family = 0;
    struct nk_context *nk_ctx = nullptr;

    static constexpr int WINDOW_WIDTH = 1280;
    static constexpr int WINDOW_HEIGHT = 800;
    static constexpr VkDeviceSize MAX_VERTEX_BUFFER = 512 * 1024;
    static constexpr VkDeviceSize MAX_INDEX_BUFFER = 128 * 1024;

public:
    QuarkTrainerGUI() : is_running(true), is_training(false)
    {
        global_qm = &virtual_machine;
        top_bar = std::make_unique<TopBar>(this);
        left_sidebar = std::make_unique<LeftSidebar>(this);
        middle_bar = std::make_unique<MiddleBar>(this);
        right_upper = std::make_unique<RightSidebarUpper>(this);
        right_lower = std::make_unique<RightSidebarLower>(this);
        bottom_bar = std::make_unique<BottomBar>(this);

        middle_bar->setCallbacks(
            [this]()
            { copyLeftToTmp(); },
            [this]()
            { copyTmpToLeft(); },
            [this]()
            { deleteSelected(); },
            [this]()
            { refreshAll(); });

        top_bar->on_new = [this]() { newProject(); };
        top_bar->on_open = [this]() { openFileDialog(); };
        top_bar->on_save = [this]() { saveConfigToFile(); };
        top_bar->on_export = [this]() { exportModel(); };
        top_bar->on_select_all = [this]() { selectAll(); };
        top_bar->on_deselect_all = [this]() { deselectAll(); };
        top_bar->on_invert = [this]() { invertSelection(); };
        top_bar->on_refresh = [this]() { refreshAll(); };
        top_bar->on_toggle_left = [this]() { toggleLeftSidebar(); };
        top_bar->on_toggle_right = [this]() { toggleRightSidebar(); };
        top_bar->on_show_all = [this]() { showAllPanels(); };
        top_bar->on_start_training = [this]() { startTraining(); };
        top_bar->on_stop_training = [this]() { stopTraining(); };
        top_bar->on_configure = [this]() { configureTraining(); };
        top_bar->on_set_mode = [this](OperationMode m) { setModeFromMenu(m); };
        top_bar->on_about = [this]() { showAbout(); };
        top_bar->on_documentation = [this]() { showDocumentation(); };
        top_bar->on_shortcuts = [this]() { showShortcuts(); };
        right_lower->on_save_config = [this]() { saveConfigToFile(); };

        learning_machine = std::make_unique<qlm::QLM>(&virtual_machine, 16, 6);
    }

    ~QuarkTrainerGUI()
    {
        is_running = false;
        if (training_thread.joinable())
            training_thread.join();
        cleanupVulkan();
    }

    VkInstance createVulkanInstance()
    {
        VkApplicationInfo appInfo{};
        appInfo.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
        appInfo.pApplicationName = "Quark Trainer";
        appInfo.applicationVersion = VK_MAKE_VERSION(2, 0, 0);
        appInfo.apiVersion = VK_API_VERSION_1_0;

        VkInstanceCreateInfo createInfo{};
        createInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
        createInfo.pApplicationInfo = &appInfo;

        uint32_t glfwExtensionCount = 0;
        const char **glfwExtensions = glfwGetRequiredInstanceExtensions(&glfwExtensionCount);
        createInfo.enabledExtensionCount = glfwExtensionCount;
        createInfo.ppEnabledExtensionNames = glfwExtensions;

        VkInstance instance;
        if (vkCreateInstance(&createInfo, nullptr, &instance) != VK_SUCCESS)
            throw std::runtime_error("Failed to create Vulkan instance!");
        return instance;
    }

    VkPhysicalDevice pickPhysicalDevice(VkInstance instance)
    {
        uint32_t deviceCount = 0;
        vkEnumeratePhysicalDevices(instance, &deviceCount, nullptr);
        if (deviceCount == 0)
            throw std::runtime_error("Failed to find GPUs with Vulkan support!");
        std::vector<VkPhysicalDevice> devices(deviceCount);
        vkEnumeratePhysicalDevices(instance, &deviceCount, devices.data());
        return devices[0];
    }

    uint32_t findGraphicsQueueFamily(VkPhysicalDevice device)
    {
        uint32_t queueFamilyCount = 0;
        vkGetPhysicalDeviceQueueFamilyProperties(device, &queueFamilyCount, nullptr);
        std::vector<VkQueueFamilyProperties> queueFamilies(queueFamilyCount);
        vkGetPhysicalDeviceQueueFamilyProperties(device, &queueFamilyCount, queueFamilies.data());
        for (uint32_t i = 0; i < queueFamilyCount; i++)
            if (queueFamilies[i].queueFlags & VK_QUEUE_GRAPHICS_BIT)
                return i;
        throw std::runtime_error("Failed to find a graphics queue family!");
    }

    VkDevice createLogicalDevice(VkPhysicalDevice physicalDevice, uint32_t queueFamilyIndex)
    {
        VkDeviceQueueCreateInfo queueCreateInfo{};
        queueCreateInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
        queueCreateInfo.queueFamilyIndex = queueFamilyIndex;
        queueCreateInfo.queueCount = 1;
        float queuePriority = 1.0f;
        queueCreateInfo.pQueuePriorities = &queuePriority;

        VkPhysicalDeviceFeatures deviceFeatures{};
        VkDeviceCreateInfo createInfo{};
        createInfo.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
        createInfo.pQueueCreateInfos = &queueCreateInfo;
        createInfo.queueCreateInfoCount = 1;
        createInfo.pEnabledFeatures = &deviceFeatures;

        const std::vector<const char *> deviceExtensions = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
        createInfo.enabledExtensionCount = static_cast<uint32_t>(deviceExtensions.size());
        createInfo.ppEnabledExtensionNames = deviceExtensions.data();

        VkDevice device;
        if (vkCreateDevice(physicalDevice, &createInfo, nullptr, &device) != VK_SUCCESS)
            throw std::runtime_error("Failed to create logical device!");

        vkGetDeviceQueue(device, queueFamilyIndex, 0, &vk_queue);
        return device;
    }

    void createSwapchain()
    {
        VkSurfaceCapabilitiesKHR capabilities;
        vkGetPhysicalDeviceSurfaceCapabilitiesKHR(vk_physical_device, vk_surface, &capabilities);

        VkSwapchainCreateInfoKHR swapchainInfo{};
        swapchainInfo.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
        swapchainInfo.surface = vk_surface;
        swapchainInfo.minImageCount = capabilities.minImageCount + 1;
        swapchainInfo.imageFormat = VK_FORMAT_B8G8R8A8_UNORM;
        swapchainInfo.imageColorSpace = VK_COLOR_SPACE_SRGB_NONLINEAR_KHR;
        swapchainInfo.imageExtent = capabilities.currentExtent;
        swapchainInfo.imageArrayLayers = 1;
        swapchainInfo.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
        swapchainInfo.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
        swapchainInfo.preTransform = capabilities.currentTransform;
        swapchainInfo.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
        swapchainInfo.presentMode = VK_PRESENT_MODE_FIFO_KHR;
        swapchainInfo.clipped = VK_TRUE;

        if (vkCreateSwapchainKHR(vk_device, &swapchainInfo, nullptr, &vk_swapchain) != VK_SUCCESS)
            throw std::runtime_error("Failed to create swapchain!");

        uint32_t imageCount;
        vkGetSwapchainImagesKHR(vk_device, vk_swapchain, &imageCount, nullptr);
        swapchain_images.resize(imageCount);
        vkGetSwapchainImagesKHR(vk_device, vk_swapchain, &imageCount, swapchain_images.data());
        swapchain_image_views.resize(imageCount);

        for (size_t i = 0; i < imageCount; i++)
        {
            VkImageViewCreateInfo viewInfo{};
            viewInfo.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
            viewInfo.image = swapchain_images[i];
            viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
            viewInfo.format = VK_FORMAT_B8G8R8A8_UNORM;
            viewInfo.components = {VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY,
                                   VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY};
            viewInfo.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

            if (vkCreateImageView(vk_device, &viewInfo, nullptr, &swapchain_image_views[i]) != VK_SUCCESS)
                throw std::runtime_error("Failed to create image views!");
        }
    }

    void initVulkan()
    {
        if (!glfwInit())
            throw std::runtime_error("Failed to initialize GLFW!");

        glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
        glfw_window = glfwCreateWindow(WINDOW_WIDTH, WINDOW_HEIGHT, "Trainer: Quantum Attention Model Trainer", nullptr, nullptr);
        if (!glfw_window)
        {
            glfwTerminate();
            throw std::runtime_error("Failed to create GLFW window!");
        }

        vk_instance = createVulkanInstance();
        if (glfwCreateWindowSurface(vk_instance, glfw_window, nullptr, &vk_surface) != VK_SUCCESS)
            throw std::runtime_error("Failed to create window surface!");

        vk_physical_device = pickPhysicalDevice(vk_instance);
        graphics_queue_family = findGraphicsQueueFamily(vk_physical_device);

        VkBool32 presentSupport = false;
        vkGetPhysicalDeviceSurfaceSupportKHR(vk_physical_device, graphics_queue_family, vk_surface, &presentSupport);
        if (!presentSupport)
            throw std::runtime_error("Selected queue does not support presentation!");

        vk_device = createLogicalDevice(vk_physical_device, graphics_queue_family);
        createSwapchain();

        VkSemaphoreCreateInfo semaphoreInfo{};
        semaphoreInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;
        vkCreateSemaphore(vk_device, &semaphoreInfo, nullptr, &image_available_semaphore);

        nk_ctx = nk_glfw3_init(
            glfw_window, vk_device, vk_physical_device, graphics_queue_family,
            swapchain_image_views.data(), (uint32_t)swapchain_image_views.size(),
            VK_FORMAT_B8G8R8A8_UNORM, NK_GLFW3_INSTALL_CALLBACKS,
            MAX_VERTEX_BUFFER, MAX_INDEX_BUFFER);

        struct nk_font_atlas *atlas;
        nk_glfw3_font_stash_begin(&atlas);
        load_i18n_fonts(atlas); // 多语言字形（CJK + Cyrillic + Latin）
        nk_glfw3_font_stash_end(vk_queue);

        nk_style_default(nk_ctx);
        apply_quantum_theme(nk_ctx);
    }

    void cleanupVulkan()
    {
        if (nk_ctx)
        {
            nk_glfw3_shutdown();
            nk_ctx = nullptr;
        }
        if (vk_device)
        {
            if (image_available_semaphore)
                vkDestroySemaphore(vk_device, image_available_semaphore, nullptr);
            for (auto iv : swapchain_image_views)
                vkDestroyImageView(vk_device, iv, nullptr);
            if (vk_swapchain)
                vkDestroySwapchainKHR(vk_device, vk_swapchain, nullptr);
            vkDestroyDevice(vk_device, nullptr);
        }
        if (vk_surface)
            vkDestroySurfaceKHR(vk_instance, vk_surface, nullptr);
        if (vk_instance)
            vkDestroyInstance(vk_instance, nullptr);
        if (glfw_window)
        {
            glfwDestroyWindow(glfw_window);
            glfwTerminate();
        }
    }

    void run()
    {
        initVulkan();

        while (!glfwWindowShouldClose(glfw_window))
        {
            glfwPollEvents();
            processKeyboardShortcuts();
            nk_glfw3_new_frame();
            render();
            if (right_lower->startTrainingRequested && !is_training)
            {
                right_lower->startTrainingRequested = false;
                startTraining();
            }

            uint32_t imageIndex;
            vkAcquireNextImageKHR(vk_device, vk_swapchain, UINT64_MAX, image_available_semaphore, VK_NULL_HANDLE, &imageIndex);
            VkSemaphore renderFinished = nk_glfw3_render(vk_queue, imageIndex, image_available_semaphore, NK_ANTI_ALIASING_ON);
            VkPresentInfoKHR presentInfo{};
            presentInfo.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
            presentInfo.waitSemaphoreCount = 1;
            presentInfo.pWaitSemaphores = &renderFinished;
            VkSwapchainKHR swapchains[] = {vk_swapchain};
            presentInfo.swapchainCount = 1;
            presentInfo.pSwapchains = swapchains;
            presentInfo.pImageIndices = &imageIndex;
            vkQueuePresentKHR(vk_queue, &presentInfo);
            vkQueueWaitIdle(vk_queue);
        }
    }

private:
    // 量子深色主题：深蓝背景 + 青色/紫色强调
    static void apply_quantum_theme(struct nk_context *ctx)
    {
        struct nk_color t[NK_COLOR_COUNT];
        t[NK_COLOR_TEXT]                    = nk_rgba(212, 224, 238, 255);
        t[NK_COLOR_WINDOW]                  = nk_rgba(20, 24, 36, 255);
        t[NK_COLOR_HEADER]                  = nk_rgba(30, 36, 54, 255);
        t[NK_COLOR_BORDER]                  = nk_rgba(56, 68, 98, 255);
        t[NK_COLOR_BUTTON]                  = nk_rgba(44, 54, 80, 255);
        t[NK_COLOR_BUTTON_HOVER]            = nk_rgba(64, 78, 114, 255);
        t[NK_COLOR_BUTTON_ACTIVE]           = nk_rgba(86, 104, 148, 255);
        t[NK_COLOR_TOGGLE]                  = nk_rgba(45, 212, 191, 255);
        t[NK_COLOR_TOGGLE_HOVER]            = nk_rgba(94, 234, 212, 255);
        t[NK_COLOR_TOGGLE_CURSOR]           = nk_rgba(224, 236, 246, 255);
        t[NK_COLOR_SELECT]                  = nk_rgba(167, 139, 250, 110);
        t[NK_COLOR_SELECT_ACTIVE]           = nk_rgba(167, 139, 250, 175);
        t[NK_COLOR_SLIDER]                  = nk_rgba(44, 54, 80, 255);
        t[NK_COLOR_SLIDER_CURSOR]           = nk_rgba(45, 212, 191, 255);
        t[NK_COLOR_SLIDER_CURSOR_HOVER]     = nk_rgba(94, 234, 212, 255);
        t[NK_COLOR_SLIDER_CURSOR_ACTIVE]    = nk_rgba(153, 246, 228, 255);
        t[NK_COLOR_PROPERTY]                = nk_rgba(44, 54, 80, 255);
        t[NK_COLOR_EDIT]                    = nk_rgba(26, 32, 50, 255);
        t[NK_COLOR_EDIT_CURSOR]             = nk_rgba(45, 212, 191, 255);
        t[NK_COLOR_COMBO]                   = nk_rgba(44, 54, 80, 255);
        t[NK_COLOR_CHART]                   = nk_rgba(44, 54, 80, 255);
        t[NK_COLOR_CHART_COLOR]             = nk_rgba(45, 212, 191, 255);
        t[NK_COLOR_CHART_COLOR_HIGHLIGHT]   = nk_rgba(167, 139, 250, 255);
        t[NK_COLOR_SCROLLBAR]               = nk_rgba(30, 36, 54, 255);
        t[NK_COLOR_SCROLLBAR_CURSOR]        = nk_rgba(64, 78, 114, 255);
        t[NK_COLOR_SCROLLBAR_CURSOR_HOVER]  = nk_rgba(86, 104, 148, 255);
        t[NK_COLOR_SCROLLBAR_CURSOR_ACTIVE] = nk_rgba(45, 212, 191, 255);
        t[NK_COLOR_TAB_HEADER]              = nk_rgba(30, 36, 54, 255);
        t[NK_COLOR_KNOB]                    = nk_rgba(44, 54, 80, 255);
        t[NK_COLOR_KNOB_CURSOR]             = nk_rgba(45, 212, 191, 255);
        t[NK_COLOR_KNOB_CURSOR_HOVER]       = nk_rgba(94, 234, 212, 255);
        t[NK_COLOR_KNOB_CURSOR_ACTIVE]      = nk_rgba(153, 246, 228, 255);
        nk_style_from_table(ctx, t);
    }

    // 键盘快捷键（GLFW 轮询 + 边沿触发，避免每帧重复）
    void processKeyboardShortcuts()
    {
        if (!glfw_window)
            return;

        auto key_pressed = [this](int key) -> bool {
            int cur = glfwGetKey(glfw_window, key);
            int &prev = prev_keys_[key];
            bool pressed = (cur == GLFW_PRESS && prev != GLFW_PRESS);
            prev = cur;
            return pressed;
        };

        bool ctrl = (glfwGetKey(glfw_window, GLFW_KEY_LEFT_CONTROL) == GLFW_PRESS ||
                     glfwGetKey(glfw_window, GLFW_KEY_RIGHT_CONTROL) == GLFW_PRESS);

        if (key_pressed(GLFW_KEY_DELETE))
            deleteSelected();
        if (key_pressed(GLFW_KEY_F5) || (ctrl && key_pressed(GLFW_KEY_R)))
            refreshAll();
        if (ctrl && key_pressed(GLFW_KEY_A))
            left_sidebar->toggleSelectAll();
        if (ctrl && key_pressed(GLFW_KEY_ENTER))
            startTraining();
        if (key_pressed(GLFW_KEY_F9))
            startTraining();
    }

    void render()
    {
        std::lock_guard<std::mutex> lock(gui_mutex);
        top_bar->render(nk_ctx);
        if (show_left_sidebar)
            left_sidebar->render(nk_ctx);
        middle_bar->render(nk_ctx);
        if (show_right_sidebar)
        {
            right_upper->render(nk_ctx);
            right_lower->render(nk_ctx);
        }
        bottom_bar->render(nk_ctx);

        renderPopups();
    }

    void renderPopups()
    {
        if (show_about_popup)
        {
            if (nk_begin(nk_ctx, tr("About"), nk_rect(400, 240, 480, 320),
                         NK_WINDOW_BORDER | NK_WINDOW_TITLE | NK_WINDOW_MOVABLE | NK_WINDOW_CLOSABLE))
            {
                nk_layout_row_dynamic(nk_ctx, 24, 1);
                nk_label(nk_ctx, "Quark Trainer", NK_TEXT_CENTERED);
                nk_label(nk_ctx, "Quantum Attention Model Trainer", NK_TEXT_CENTERED);
                nk_label(nk_ctx, "Version 2.0.0", NK_TEXT_CENTERED);
                nk_layout_row_dynamic(nk_ctx, 12, 1);
                nk_layout_row_dynamic(nk_ctx, 20, 1);
                nk_label(nk_ctx, tr("Quantum robot simulation platform (Quark)"), NK_TEXT_CENTERED);
                nk_label(nk_ctx, tr("Vulkan + Nuklear + GLFW GUI"), NK_TEXT_CENTERED);
                nk_layout_row_dynamic(nk_ctx, 12, 1);
                nk_layout_row_dynamic(nk_ctx, 40, 1);
                if (nk_button_label(nk_ctx, "OK"))
                    show_about_popup = false;
            }
            nk_end(nk_ctx);
        }

        if (show_doc_popup)
        {
            if (nk_begin(nk_ctx, tr("Documentation"), nk_rect(400, 240, 480, 320),
                         NK_WINDOW_BORDER | NK_WINDOW_TITLE | NK_WINDOW_MOVABLE | NK_WINDOW_CLOSABLE))
            {
                nk_layout_row_dynamic(nk_ctx, 20, 1);
                nk_label(nk_ctx, tr("1. Select training files in the left panel"), NK_TEXT_LEFT);
                nk_label(nk_ctx, tr("2. Use '<<' to move them to training data"), NK_TEXT_LEFT);
                nk_label(nk_ctx, tr("3. Configure parameters in the right panel"), NK_TEXT_LEFT);
                nk_label(nk_ctx, tr("4. Press 'Start Training' or F9"), NK_TEXT_LEFT);
                nk_layout_row_dynamic(nk_ctx, 40, 1);
                if (nk_button_label(nk_ctx, "OK"))
                    show_doc_popup = false;
            }
            nk_end(nk_ctx);
        }

        if (show_shortcuts_popup)
        {
            if (nk_begin(nk_ctx, tr("Keyboard Shortcuts"), nk_rect(400, 240, 480, 340),
                         NK_WINDOW_BORDER | NK_WINDOW_TITLE | NK_WINDOW_MOVABLE | NK_WINDOW_CLOSABLE))
            {
                nk_layout_row_dynamic(nk_ctx, 20, 1);
                nk_label(nk_ctx, "Delete        : delete selected items", NK_TEXT_LEFT);
                nk_label(nk_ctx, "F5 / Ctrl+R   : refresh file lists", NK_TEXT_LEFT);
                nk_label(nk_ctx, "Ctrl+A        : select all", NK_TEXT_LEFT);
                nk_label(nk_ctx, "Ctrl+Enter/F9 : start training", NK_TEXT_LEFT);
                nk_layout_row_dynamic(nk_ctx, 40, 1);
                if (nk_button_label(nk_ctx, "OK"))
                    show_shortcuts_popup = false;
            }
            nk_end(nk_ctx);
        }
    }

    // ---- 文件操作 ----
    void newProject()
    {
        right_upper->clearTmp();
        std::cout << "[GUI] New project: training data cleared\n";
    }

    void openFileDialog()
    {
#ifdef _WIN32
        OPENFILENAMEA ofn{};
        char file_buf[MAX_PATH] = {0};
        ofn.lStructSize = sizeof(ofn);
        ofn.hwndOwner = nullptr;
        ofn.lpstrFilter = "All Files\0*.*\0";
        ofn.lpstrFile = file_buf;
        ofn.nMaxFile = sizeof(file_buf);
        ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
        if (GetOpenFileNameA(&ofn))
        {
            FileItem item;
            item.path = fs::path(file_buf);
            item.is_directory = fs::is_directory(item.path);
            item.is_selected = true;
            item.size = 0;
            right_upper->copyToTmp({item});
            std::cout << "[GUI] Opened file: " << file_buf << "\n";
        }
#else
        std::cout << "[GUI] Open file dialog is only supported on Windows\n";
#endif
    }

    void saveConfigToFile()
    {
        auto &cfg = right_lower->getConfig();
        fs::create_directories(cfg.output_path);
        std::string cfg_path = cfg.output_path + "/training_config.json";
        std::ofstream out(cfg_path);
        if (out.is_open())
        {
            out << "{\n"
                << "  \"model_name\": \"" << cfg.model_name << "\",\n"
                << "  \"epochs\": " << cfg.epochs << ",\n"
                << "  \"learning_rate\": " << cfg.learning_rate << ",\n"
                << "  \"qubits\": " << cfg.qubits << ",\n"
                << "  \"layers\": " << cfg.layers << ",\n"
                << "  \"output_path\": \"" << cfg.output_path << "\"\n"
                << "}\n";
            out.close();
            std::cout << "[GUI] Config saved to: " << cfg_path << "\n";
        }
        else
        {
            std::cerr << "[GUI] Failed to save config to: " << cfg_path << "\n";
        }
    }

    void exportModel()
    {
        auto &cfg = right_lower->getConfig();
        std::string model_path = cfg.output_path + cfg.model_name + ".qkm";
        std::cout << "[GUI] Model will export to: " << model_path
                  << " (run Start Training to generate)\n";
    }

    // ---- 编辑 ----
    void selectAll() { left_sidebar->selectAll(); }
    void deselectAll() { left_sidebar->deselectAll(); }
    void invertSelection() { left_sidebar->invertSelection(); }

    // ---- 视图 ----
    void toggleLeftSidebar() { show_left_sidebar = !show_left_sidebar; }
    void toggleRightSidebar() { show_right_sidebar = !show_right_sidebar; }

    // 显示所有面板（关闭/隐藏后重新打开）
    void showAllPanels()
    {
        show_left_sidebar = true;
        show_right_sidebar = true;
        top_bar->set_visible(true);
        left_sidebar->set_visible(true);
        middle_bar->set_visible(true);
        right_upper->set_visible(true);
        right_lower->set_visible(true);
        bottom_bar->set_visible(true);
        nk_window_show(nk_ctx, top_bar->title(), NK_SHOWN);
        nk_window_show(nk_ctx, left_sidebar->title(), NK_SHOWN);
        nk_window_show(nk_ctx, middle_bar->title(), NK_SHOWN);
        nk_window_show(nk_ctx, right_upper->title(), NK_SHOWN);
        nk_window_show(nk_ctx, right_lower->title(), NK_SHOWN);
        nk_window_show(nk_ctx, bottom_bar->title(), NK_SHOWN);
    }

    // ---- 训练 ----
    void stopTraining()
    {
        if (is_training)
        {
            is_training = false;
            std::cout << "[Training] Stop requested (current epoch will finish)\n";
        }
        else
        {
            std::cout << "[Training] No training in progress\n";
        }
    }

    void configureTraining()
    {
        std::cout << "[GUI] Configure training in the right panel (Training Parameters)\n";
    }

    // ---- 网络 ----
    void setModeFromMenu(OperationMode m) { bottom_bar->setMode(m); }

    // ---- 帮助 ----
    void showAbout() { show_about_popup = true; }
    void showDocumentation() { show_doc_popup = true; }
    void showShortcuts() { show_shortcuts_popup = true; }

    void copyLeftToTmp()
    {
        std::lock_guard<std::mutex> lock(gui_mutex);
        auto selected = left_sidebar->getSelectedItems();
        if (!selected.empty())
        {
            right_upper->copyToTmp(selected);
            std::cout << "[GUI] Copied " << selected.size() << " items to tmp\n";
        }
    }

    void copyTmpToLeft()
    {
        std::lock_guard<std::mutex> lock(gui_mutex);
        auto &tmp_items = right_upper->getTmpItemsRef();
        std::string dest = left_sidebar->getCurrentPath();
        for (const auto &item : tmp_items)
        {
            if (!item.is_selected)
                continue;
            try
            {
                auto dest_path = fs::path(dest) / item.path.filename();
                if (item.is_directory)
                    fs::copy(item.path, dest_path, fs::copy_options::recursive | fs::copy_options::overwrite_existing);
                else
                    fs::copy_file(item.path, dest_path, fs::copy_options::overwrite_existing);
            }
            catch (const std::exception &e)
            {
                std::cerr << "Error copying: " << e.what() << "\n";
            }
        }
        left_sidebar->refreshDirectory();
    }

    void deleteSelected()
    {
        std::lock_guard<std::mutex> lock(gui_mutex);
        auto selected = left_sidebar->getSelectedItems();
        for (const auto &item : selected)
        {
            try
            {
                if (item.is_directory)
                {
                    fs::remove_all(item.path);
                }
                else
                {
                    fs::remove(item.path);
                }
            }
            catch (const std::exception &e)
            {
                std::cerr << "Error deleting: " << e.what() << "\n";
            }
        }

        auto &tmp_items = right_upper->getTmpItemsRef();
        for (auto &item : tmp_items)
        {
            if (item.is_selected)
            {
                try
                {
                    if (item.is_directory)
                        fs::remove_all(item.path);
                    else
                        fs::remove(item.path);
                }
                catch (const std::exception &e)
                {
                    std::cerr << "Error deleting tmp: " << e.what() << "\n";
                }
            }
        }

        left_sidebar->refreshDirectory();
        right_upper->refreshTmpDirectory();
    }

    void refreshAll()
    {
        std::lock_guard<std::mutex> lock(gui_mutex);
        left_sidebar->refreshDirectory();
        right_upper->refreshTmpDirectory();
    }

    void startTraining()
    {
        if (is_training)
            return;

        is_training = true;
        training_thread = std::thread([this]()
                                      {
            std::cout << "\n[Training] Starting quantum model training...\n";
            auto& config = right_lower->getConfig();
            auto tmp_items = right_upper->getTmpItems();
            config.training_files.clear();
            
            for (const auto& item : tmp_items) {
                if (!item.is_directory) {
                    config.training_files.push_back(item.path.string());
                }
            }
            
            if (config.training_files.empty()) {
                std::cout << "[Error] No training files in tmp folder\n";
                is_training = false;
                return;
            }

            std::vector<std::shared_ptr<quark::QObject>> dataset;
            
            for (const auto& file : config.training_files) {
                std::ifstream input(file);
                if (!input.is_open()) continue;
                
                std::stringstream buffer;
                buffer << input.rdbuf();
                std::string text = buffer.str();
                auto tokens = qqnt::global_tokenizer.encode(text);
                for (size_t i = 2; i < tokens.size(); ++i) {
                    auto sample = std::make_shared<quark::QDataState>(
                        &virtual_machine,
                        std::vector<size_t>{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}
                    );
                    
                    for (size_t bit = 0; bit < 8; ++bit) {
                        if ((tokens[i-2] >> bit) & 1) virtual_machine.apply_x(bit);
                        if ((tokens[i-1] >> bit) & 1) virtual_machine.apply_x(bit + 8);
                    }
                    
                    sample->qlm_data = new uint8_t(tokens[i]);
                    dataset.push_back(sample);
                }
            }
            
            std::string output_file = config.output_path + config.model_name + ".qkm";
            learning_machine->train_and_export(config.epochs, config.learning_rate, output_file, dataset);
            
            for (auto& sample : dataset) {
                delete static_cast<uint8_t*>(sample->qlm_data);
                sample->qlm_data = nullptr;
            }
            
            std::cout << "[Training] Completed! Model saved to: " << output_file << "\n";
            is_training = false; });
    }
};

#ifdef _WIN32
static LONG WINAPI tx_crash_handler(EXCEPTION_POINTERS *ep)
{
    if (ep && ep->ExceptionRecord)
    {
        FILE *f = fopen("tx_crash_dump.txt", "a");
        if (f)
        {
            HMODULE base = GetModuleHandleW(NULL);
            fprintf(f, "[CRASH] 0x%08lX at %p base %p rva 0x%llX\n",
                    ep->ExceptionRecord->ExceptionCode,
                    ep->ExceptionRecord->ExceptionAddress,
                    base,
                    (unsigned long long)((uintptr_t)ep->ExceptionRecord->ExceptionAddress - (uintptr_t)base));
            fclose(f);
        }
    }
    return EXCEPTION_CONTINUE_SEARCH;
}
#endif

int main()
{
#ifdef _WIN32
    AddVectoredExceptionHandler(1, tx_crash_handler);
#endif
    try
    {
        set_lang(detect_lang()); // 界面语言自动检测（持久化值 / 系统 locale）
        QuarkTrainerGUI gui;
        gui.run();
    }
    catch (const std::exception &e)
    {
        std::cerr << "Fatal error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}