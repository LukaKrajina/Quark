<<<<<<< HEAD
#include <QApplication>
#include <QSurfaceFormat>
#include <QFile>
#include <QTextStream>
#include <exception>

#include "main_window.h"
#include "project_browser.h"
#include "loading_screen.h"
#include "simulation_host.hpp"

static void log_file(const QString &msg)
{
    QFile f("D:/BH_Project/quark-vscode/qt_log.txt");
    if (f.open(QIODevice::Append | QIODevice::Text))
    {
        QTextStream ts(&f);
        ts << msg << "\n";
        f.close();
    }
}

static void msg_handler(QtMsgType type, const QMessageLogContext &ctx, const QString &msg)
{
    (void)type;
    (void)ctx;
    log_file(msg);
}

#ifndef QUARKRSP_SHADER_DIR
#define QUARKRSP_SHADER_DIR "shaders"
#endif

int main(int argc, char *argv[])
{
    qInstallMessageHandler(msg_handler);
    log_file("=== quarkRSP_gui start ===");

    QApplication app(argc, argv);
    app.setApplicationName("Quark RSP");
    app.setOrganizationName("QuarkProject");

    try
    {
        // 第一阶段：工程浏览器
        quarkrsp::gui::ProjectBrowser browser;
        browser.show();
        log_file("ProjectBrowser shown");

        QObject::connect(&browser, &quarkrsp::gui::ProjectBrowser::launchRequested,
            [&](const quarkrsp::gui::SimulationConfig &cfg) {
                log_file(QString("launch requested: %1").arg(QString::fromStdString(cfg.project_name)));

                // 第二阶段：加载界面
                auto *loading = new quarkrsp::gui::LoadingScreen(cfg);

                QObject::connect(loading, &quarkrsp::gui::LoadingScreen::finished,
                    [&, loading](quarkrsp::gui::SimulationHost *host) {
                        log_file("Loading finished, creating MainWindow");
                        // 第三阶段：仿真主面（配置从 host 取，避免使用已析构的 cfg 引用）
                        auto *win = new quarkrsp::gui::MainWindow(QUARKRSP_SHADER_DIR, host->config(), host);
                        win->setAttribute(Qt::WA_DeleteOnClose);
                        win->show();
                        // 主面关闭 → 返回工程浏览器
                        QObject::connect(win, &QObject::destroyed, &browser,
                                         [&browser]() { browser.show(); });
                        loading->deleteLater();
                        browser.hide();
                    });

                QObject::connect(loading, &quarkrsp::gui::LoadingScreen::failed,
                    [&, loading](const QString &step, const QString &reason) {
                        log_file(QString("LOAD FAILED: %1 - %2").arg(step, reason));
                        loading->deleteLater();
                        browser.show();
                    });

                QObject::connect(loading, &quarkrsp::gui::LoadingScreen::cancelled,
                    [&, loading]() {
                        log_file("Loading cancelled");
                        loading->deleteLater();
                        browser.show();
                    });

                loading->show();
                browser.hide();
                loading->start();
            });

        return app.exec();
    }
    catch (const std::exception &e)
    {
        log_file(QString("EXCEPTION: %1").arg(e.what()));
        return 1;
    }
    catch (...)
    {
        log_file("UNKNOWN EXCEPTION");
        return 2;
    }
}
=======
#include <QApplication>
#include <QSurfaceFormat>
#include <exception>

#include "main_window.h"
#include "project_browser.h"
#include "loading_screen.h"
#include "theme_manager.h"
#include "log_manager.h"
#include "crash_handler.h"
#include "simulation_host.hpp"
#include "i18n/i18n.h"

// 全局消息处理器：把 Qt 日志接入自研 LogManager（级别过滤 + 文件轮转 + 线程安全）。
static void msg_handler(QtMsgType type, const QMessageLogContext &ctx, const QString &msg)
{
    using namespace quarkrsp::gui;
    LogManager::Level l;
    switch (type)
    {
    case QtDebugMsg:
        l = LogManager::Level::Debug;
        break;
    case QtInfoMsg:
        l = LogManager::Level::Info;
        break;
    case QtWarningMsg:
        l = LogManager::Level::Warning;
        break;
    case QtCriticalMsg:
        l = LogManager::Level::Error;
        break;
    case QtFatalMsg:
        l = LogManager::Level::Fatal;
        break;
    default:
        l = LogManager::Level::Info;
        break;
    }
    const QString category = ctx.category ? QString::fromUtf8(ctx.category) : QStringLiteral("qt");
    LogManager::instance().write(l, category, msg);
}

#ifndef QUARKRSP_SHADER_DIR
#define QUARKRSP_SHADER_DIR shaders
#endif
// 编译定义值不带引号（避免 nvcc_wrapper 传参引号错位），这里字符串化使用
#define QUARKRSP_STR_IMPL(x) #x
#define QUARKRSP_STR(x) QUARKRSP_STR_IMPL(x)

int main(int argc, char *argv[])
{
    qInstallMessageHandler(msg_handler);

    QApplication app(argc, argv);
    app.setApplicationName("Quark RSP");
    app.setOrganizationName("QuarkProject");

    // 初始化日志（依赖 applicationName，需在 QApplication 之后）
    quarkrsp::gui::LogManager::instance().init();
    QKLOG_INFO("app", "=== quarkRSP_gui start ===");

    // 安装崩溃处理器（信号 + 堆栈回溯到日志，见 crash_handler.cpp）
    quarkrsp::gui::CrashHandler::install();

    // 初始化多语言（自动检测：QSettings 持久化值 → 系统 locale）
    quarkrsp::gui::I18n::instance();
    // 应用主题（默认夜间，QSettings 持久化用户选择）
    quarkrsp::gui::ThemeManager::instance().apply(app);

    try
    {
        // 工程浏览器
        quarkrsp::gui::ProjectBrowser browser;
        browser.show();
        QKLOG_INFO("app", "ProjectBrowser shown");

        QObject::connect(&browser, &quarkrsp::gui::ProjectBrowser::launchRequested,
            [&](const quarkrsp::gui::SimulationConfig &cfg) {
                QKLOG_INFO("app", QString("launch requested: %1").arg(QString::fromStdString(cfg.project_name)));

                // 加载界面
                auto *loading = new quarkrsp::gui::LoadingScreen(cfg);

                QObject::connect(loading, &quarkrsp::gui::LoadingScreen::finished,
                    [&, loading](quarkrsp::gui::SimulationHost *host) {
                        QKLOG_INFO("app", "Loading finished, creating MainWindow");
                        // 仿真主面（配置从 host 取，避免使用已析构的 cfg 引用）
                        auto *win = new quarkrsp::gui::MainWindow(QUARKRSP_STR(QUARKRSP_SHADER_DIR), host->config(), host);
                        win->setAttribute(Qt::WA_DeleteOnClose);
                        win->show();
                        // 主面关闭 → 返回工程浏览器
                        QObject::connect(win, &QObject::destroyed, &browser,
                                         [&browser]() { browser.show(); });
                        loading->deleteLater();
                        browser.hide();
                    });

                QObject::connect(loading, &quarkrsp::gui::LoadingScreen::failed,
                    [&, loading](const QString &step, const QString &reason) {
                        QKLOG_ERROR("app", QString("LOAD FAILED: %1 - %2").arg(step, reason));
                        loading->deleteLater();
                        browser.show();
                    });

                QObject::connect(loading, &quarkrsp::gui::LoadingScreen::cancelled,
                    [&, loading]() {
                        QKLOG_INFO("app", "Loading cancelled");
                        loading->deleteLater();
                        browser.show();
                    });

                loading->show();
                browser.hide();
                loading->start();
            });

        return app.exec();
    }
    catch (const std::exception &e)
    {
        QKLOG_ERROR("app", QString("EXCEPTION: %1").arg(e.what()));
        return 1;
    }
    catch (...)
    {
        QKLOG_ERROR("app", "UNKNOWN EXCEPTION");
        return 2;
    }
}
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
