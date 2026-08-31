<<<<<<< HEAD
#pragma once
#include <QWidget>
#include <QSyntaxHighlighter>
#include <QCompleter>
#include <QVector>
#include <QString>
#include <QRegularExpression>
#include <QTextCharFormat>

class QTextDocument;
class QLabel;
class QPlainTextEdit;
class QProcess;

namespace quarkrsp::gui
{

    class CodeEditor;

    // ─── qk 脚本语法高亮器 ──────────────────────────────────────
    class QkHighlighter : public QSyntaxHighlighter
    {
        Q_OBJECT
    public:
        explicit QkHighlighter(QTextDocument *parent = nullptr);

    protected:
        void highlightBlock(const QString &text) override;

    private:
        struct Rule
        {
            QRegularExpression pattern;
            QTextCharFormat format;
        };
        QVector<Rule> rules_;
    };

    // ─── qk 脚本编辑器窗口（新窗口编写 .qk）────────────────────
    class ScriptEditorWindow : public QWidget
    {
        Q_OBJECT
    public:
        ScriptEditorWindow(const QString &path, QWidget *parent = nullptr);

    signals:
        void dirtyChanged(const QString &path, bool dirty); // 通知内容浏览器更新角标

    private:
        void load_content();
        void save_content();
        void on_text_changed();
        void update_status();
        void run_script(); // 对接 qk 解释器执行

        QString path_;
        QString original_content_;
        bool dirty_ = false;

        CodeEditor *editor_ = nullptr;
        QLabel *status_label_ = nullptr;
        QCompleter *completer_ = nullptr;
        QPlainTextEdit *output_ = nullptr;
        QProcess *process_ = nullptr;
    };

    // 供其他模块复用的 qk 关键字/内建函数列表
    const QStringList &qk_keywords();
=======
#pragma once
#include <QWidget>
#include <QSyntaxHighlighter>
#include <QCompleter>
#include <QVector>
#include <QString>
#include <QRegularExpression>
#include <QTextCharFormat>

class QTextDocument;
class QLabel;
class QPlainTextEdit;
class QProcess;

namespace quarkrsp::gui
{

    class CodeEditor;

    // ─── qk 脚本语法高亮器 ──────────────────────────────────────
    class QkHighlighter : public QSyntaxHighlighter
    {
        Q_OBJECT
    public:
        explicit QkHighlighter(QTextDocument *parent = nullptr);

        void set_dark_mode(bool dark); // 白天/夜间语法高亮配色

    protected:
        void highlightBlock(const QString &text) override;

    private:
        void rebuild(); // 根据 dark_ 重建 rules_
        struct Rule
        {
            QRegularExpression pattern;
            QTextCharFormat format;
        };
        QVector<Rule> rules_;
        bool dark_ = true;
    };

    // ─── qk 脚本编辑器窗口（新窗口编写 .qk）────────────────────
    class ScriptEditorWindow : public QWidget
    {
        Q_OBJECT
    public:
        ScriptEditorWindow(const QString &path, QWidget *parent = nullptr);

    signals:
        void dirtyChanged(const QString &path, bool dirty); // 通知内容浏览器更新角标

    protected:
        void closeEvent(QCloseEvent *event) override; // 未保存更改确认

    private:
        void load_content();
        void save_content();
        void on_text_changed();
        void update_status();
        void run_script();     // 保存 + 异步探测 daemon 后执行
        void execute_script(); // 实际启动 qk 解释器

        QString path_;
        QString original_content_;
        bool dirty_ = false;

        CodeEditor *editor_ = nullptr;
        QLabel *status_label_ = nullptr;
        QCompleter *completer_ = nullptr;
        QPlainTextEdit *output_ = nullptr;
        QProcess *process_ = nullptr;
    };

    // 供其他模块复用的 qk 关键字/内建函数列表
    const QStringList &qk_keywords();
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}