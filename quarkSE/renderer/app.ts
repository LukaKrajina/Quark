import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
<<<<<<< HEAD
=======
import { initI18n, setLocale, t, type Locale } from './i18n';
>>>>>>> 2f6d6f3 (	new file:   .clang-format)

declare global {
    interface Window {
        quarkSE: {
            runScript(code: string): Promise<{ ok: boolean; output: string }>;
<<<<<<< HEAD
            openFileDialog(): Promise<{ path: string; content: string } | null>;
            saveFileDialog(path: string | null, content: string): Promise<string | null>;
            setDirty(dirty: boolean): void;
=======
            openFileDialog(): Promise<{ path: string; content: string } | { error: string } | null>;
            saveFileDialog(path: string | null, content: string): Promise<string | { error: string } | null>;
            setDirty(dirty: boolean): void;
            setLocale(locale: string): void;
            onMenu(callback: (action: string) => void): void;
            onRequestSave(callback: () => void): void;
            notifySaveDone(): void;
            confirmDiscard(): Promise<'save' | 'discard' | 'cancel'>;
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
        };
    }
}

let currentFile: string | null = null;
let isDirty = false;

const fileLabel = document.getElementById('status-file')!;
const diagLabel = document.getElementById('status-diag')!;

function updateFileLabel() {
<<<<<<< HEAD
    let name = currentFile ? currentFile.split(/[\\/]/).pop() : '未命名';
=======
    let name = currentFile ? currentFile.split(/[\\/]/).pop()! : t('status.untitled');
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    if (isDirty) name += ' •';
    fileLabel.textContent = name;
}

function setDirty(d: boolean) {
    isDirty = d;
    updateFileLabel();
    if (window.quarkSE.setDirty) window.quarkSE.setDirty(d);
}

function setDiag(text: string, ok: boolean | null) {
    diagLabel.textContent = text;
<<<<<<< HEAD
    diagLabel.className = ok === null ? '' : (ok ? 'ok' : 'error');
=======
    diagLabel.className = ok === null ? '' : ok ? 'ok' : 'error';
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}

const shellEl = document.getElementById('shell')!;
function shellPrint(text: string) {
    shellEl.textContent += text;
    shellEl.scrollTop = shellEl.scrollHeight;
}
<<<<<<< HEAD
function shellClear() { shellEl.textContent = ''; }
=======
function shellClear() {
    shellEl.textContent = '';
}
>>>>>>> 2f6d6f3 (	new file:   .clang-format)

const editorParent = document.getElementById('editor')!;
const startState = EditorState.create({
    doc: 'int32 quark_main() {\n    return 0;\n}\n',
    extensions: [
        basicSetup,
        javascript(),
        oneDark,
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                setDirty(true);
<<<<<<< HEAD
                setDiag('已修改', null);
            }
        })
    ]
=======
                setDiag(t('status.modified'), null);
            }
        }),
    ],
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
});
const view = new EditorView({ state: startState, parent: editorParent });

function setEditorContent(text: string) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

document.getElementById('btn-open')!.addEventListener('click', async () => {
    const res = await window.quarkSE.openFileDialog();
    if (!res) return;
<<<<<<< HEAD
    currentFile = res.path;
    setEditorContent(res.content);
    setDirty(false);
    setDiag('已打开', true);
    shellPrint(`[QuarkSE] Opened ${res.path}\n`);
});

document.getElementById('btn-save')!.addEventListener('click', async () => {
    const content = view.state.doc.toString();
    const saved = await window.quarkSE.saveFileDialog(currentFile, content);
    if (saved) {
        currentFile = saved;
        setDirty(false);
        setDiag('已保存', true);
        shellPrint(`[QuarkSE] Saved ${saved}\n`);
    }
=======
    if ('error' in res) {
        setDiag(res.error, false);
        shellPrint(`[QuarkSE] ${res.error}\n`);
        return;
    }
    currentFile = res.path;
    setEditorContent(res.content);
    setDirty(false);
    setDiag(t('status.opened'), true);
    shellPrint(`[QuarkSE] ${t('shell.opened')} ${res.path}\n`);
});

async function doSave(): Promise<boolean> {
    const content = view.state.doc.toString();
    const saved = await window.quarkSE.saveFileDialog(currentFile, content);
    if (saved && typeof saved === 'string') {
        currentFile = saved;
        setDirty(false);
        setDiag(t('status.saved'), true);
        shellPrint(`[QuarkSE] ${t('shell.saved')} ${saved}\n`);
        return true;
    } else if (saved && typeof saved === 'object') {
        setDiag((saved as { error: string }).error, false);
        shellPrint(`[QuarkSE] ${(saved as { error: string }).error}\n`);
    }
    return false;
}

document.getElementById('btn-save')!.addEventListener('click', () => {
    doSave();
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
});

document.getElementById('btn-run')!.addEventListener('click', async () => {
    shellClear();
<<<<<<< HEAD
    shellPrint('[QuarkSE] Compiling...\n');
    setDiag('编译中...', null);
    const res = await window.quarkSE.runScript(view.state.doc.toString());
    shellPrint(res.output + '\n');
    if (res.ok) {
        setDiag('编译成功', true);
    } else {
        setDiag('编译失败', false);
=======
    shellPrint(`[QuarkSE] ${t('shell.compiling')}\n`);
    setDiag(t('status.compiling'), null);
    const res = await window.quarkSE.runScript(view.state.doc.toString());
    shellPrint(res.output + '\n');
    if (res.ok) {
        setDiag(t('status.success'), true);
    } else {
        setDiag(t('status.fail'), false);
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    }
});

document.getElementById('btn-clear')!.addEventListener('click', () => {
    shellClear();
});

<<<<<<< HEAD
updateFileLabel();
=======
const langSelect = document.getElementById('lang-select') as HTMLSelectElement;
langSelect.addEventListener('change', () => {
    setLocale(langSelect.value as Locale);
    updateFileLabel();
});

const locale = initI18n();
langSelect.value = locale;
updateFileLabel();

// 快捷键
document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 's') {  //Ctrl/Cmd+S 保存
        e.preventDefault();
        (document.getElementById('btn-save') as HTMLButtonElement).click();
    } else if (key === 'o') {   //Ctrl/Cmd+O 打开
        e.preventDefault();
        (document.getElementById('btn-open') as HTMLButtonElement).click();
    } else if (key === 'enter') {   //Ctrl/Cmd+Enter 运行
        e.preventDefault();
        (document.getElementById('btn-run') as HTMLButtonElement).click();
    }
});

async function startNew() {
    if (isDirty) {
        const choice = await window.quarkSE.confirmDiscard();
        if (choice === 'cancel') return;
        if (choice === 'save') {
            const ok = await doSave();
            if (!ok) return; // 保存失败或取消保存对话框，则不新建
        }
    }
    currentFile = null;
    setEditorContent('');
    setDirty(false);
    setDiag('', null);
    shellClear();
}

// 菜单栏动作（File / View）
window.quarkSE.onMenu((action) => {
    if (action === 'new') startNew();
    else if (action === 'open') (document.getElementById('btn-open') as HTMLButtonElement).click();
    else if (action === 'save') (document.getElementById('btn-save') as HTMLButtonElement).click();
    else if (action === 'run') (document.getElementById('btn-run') as HTMLButtonElement).click();
});

// 关闭前「保存后关闭」请求
window.quarkSE.onRequestSave(async () => {
    await doSave();
    window.quarkSE.notifySaveDone();
});
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
