<<<<<<< HEAD
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
=======
import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
import * as path from 'path';
import * as fs from 'fs';

let win: BrowserWindow | null = null;

<<<<<<< HEAD
=======
// ── 主进程文案（窗口标题 / 对话框标题）──
type Locale = 'en' | 'zh' | 'ru' | 'fr' | 'de';
const MAIN_STRINGS: Record<
    Locale,
    {
        windowTitle: string;
        dirtySuffix: string;
        openTitle: string;
        saveTitle: string;
        qkFilter: string;
        allFilter: string;
        daemonError: string;
        closeTitle: string;
        closeSave: string;
        closeDiscard: string;
        closeCancel: string;
    }
> = {
    en: {
        windowTitle: 'QuarkSE — qk Editor',
        dirtySuffix: ' (unsaved)',
        openTitle: 'Open qk file',
        saveTitle: 'Save qk file',
        qkFilter: 'Quark Script',
        allFilter: 'All Files',
        daemonError: "Daemon connection failed: {message}\nIs 'runtime --daemon' running?",
        closeTitle: 'Unsaved changes',
        closeSave: 'Save',
        closeDiscard: 'Discard',
        closeCancel: 'Cancel',
    },
    zh: {
        windowTitle: 'QuarkSE — qk 编辑器',
        dirtySuffix: ' (未保存)',
        openTitle: '打开 qk 文件',
        saveTitle: '保存 qk 文件',
        qkFilter: 'Quark 脚本',
        allFilter: '所有文件',
        daemonError: "守护进程连接失败：{message}\n请确认 'runtime --daemon' 已在运行",
        closeTitle: '有未保存的更改',
        closeSave: '保存',
        closeDiscard: '不保存',
        closeCancel: '取消',
    },
    ru: {
        windowTitle: 'QuarkSE — редактор qk',
        dirtySuffix: ' (не сохранено)',
        openTitle: 'Открыть файл qk',
        saveTitle: 'Сохранить файл qk',
        qkFilter: 'Скрипт Quark',
        allFilter: 'Все файлы',
        daemonError: "Не удалось подключиться к демону: {message}\nУбедитесь, что 'runtime --daemon' запущен",
        closeTitle: 'Есть несохранённые изменения',
        closeSave: 'Сохранить',
        closeDiscard: 'Не сохранять',
        closeCancel: 'Отмена',
    },
    fr: {
        windowTitle: 'QuarkSE — éditeur qk',
        dirtySuffix: ' (non enregistré)',
        openTitle: 'Ouvrir un fichier qk',
        saveTitle: 'Enregistrer le fichier qk',
        qkFilter: 'Script Quark',
        allFilter: 'Tous les fichiers',
        daemonError:
            "Échec de connexion au démon : {message}\nVérifiez que 'runtime --daemon' est en cours d'exécution",
        closeTitle: 'Modifications non enregistrées',
        closeSave: 'Enregistrer',
        closeDiscard: 'Ne pas enregistrer',
        closeCancel: 'Annuler',
    },
    de: {
        windowTitle: 'QuarkSE — qk-Editor',
        dirtySuffix: ' (ungespeichert)',
        openTitle: 'qk-Datei öffnen',
        saveTitle: 'qk-Datei speichern',
        qkFilter: 'Quark-Skript',
        allFilter: 'Alle Dateien',
        daemonError:
            "Verbindung zum Daemon fehlgeschlagen: {message}\nStellen Sie sicher, dass 'runtime --daemon' läuft",
        closeTitle: 'Ungespeicherte Änderungen',
        closeSave: 'Speichern',
        closeDiscard: 'Verwerfen',
        closeCancel: 'Abbrechen',
    },
};

// ── 菜单栏文案 ──
const MENU_STRINGS: Record<
    Locale,
    {
        file: string;
        new: string;
        open: string;
        save: string;
        quit: string;
        edit: string;
        view: string;
        run: string;
        devtools: string;
        undo: string;
        redo: string;
        cut: string;
        copy: string;
        paste: string;
        selectAll: string;
        reload: string;
    }
> = {
    en: {
        file: 'File',
        new: 'New',
        open: 'Open',
        save: 'Save',
        quit: 'Quit',
        edit: 'Edit',
        view: 'View',
        run: 'Run',
        devtools: 'Toggle Developer Tools',
        undo: 'Undo',
        redo: 'Redo',
        cut: 'Cut',
        copy: 'Copy',
        paste: 'Paste',
        selectAll: 'Select All',
        reload: 'Reload',
    },
    zh: {
        file: '文件',
        new: '新建',
        open: '打开',
        save: '保存',
        quit: '退出',
        edit: '编辑',
        view: '视图',
        run: '运行',
        devtools: '开发者工具',
        undo: '撤销',
        redo: '重做',
        cut: '剪切',
        copy: '复制',
        paste: '粘贴',
        selectAll: '全选',
        reload: '重新加载',
    },
    ru: {
        file: 'Файл',
        new: 'Создать',
        open: 'Открыть',
        save: 'Сохранить',
        quit: 'Выход',
        edit: 'Правка',
        view: 'Вид',
        run: 'Запустить',
        devtools: 'Инструменты разработчика',
        undo: 'Отменить',
        redo: 'Повторить',
        cut: 'Вырезать',
        copy: 'Копировать',
        paste: 'Вставить',
        selectAll: 'Выделить всё',
        reload: 'Перезагрузить',
    },
    fr: {
        file: 'Fichier',
        new: 'Nouveau',
        open: 'Ouvrir',
        save: 'Enregistrer',
        quit: 'Quitter',
        edit: 'Édition',
        view: 'Affichage',
        run: 'Exécuter',
        devtools: 'Outils de développement',
        undo: 'Annuler',
        redo: 'Rétablir',
        cut: 'Couper',
        copy: 'Copier',
        paste: 'Coller',
        selectAll: 'Tout sélectionner',
        reload: 'Recharger',
    },
    de: {
        file: 'Datei',
        new: 'Neu',
        open: 'Öffnen',
        save: 'Speichern',
        quit: 'Beenden',
        edit: 'Bearbeiten',
        view: 'Ansicht',
        run: 'Ausführen',
        devtools: 'Entwicklertools',
        undo: 'Rückgängig',
        redo: 'Wiederholen',
        cut: 'Ausschneiden',
        copy: 'Kopieren',
        paste: 'Einfügen',
        selectAll: 'Alles auswählen',
        reload: 'Neu laden',
    },
};

function detectLocale(): Locale {
    const l = (app.getLocale() || 'en').toLowerCase();
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('ru')) return 'ru';
    if (l.startsWith('fr')) return 'fr';
    if (l.startsWith('de')) return 'de';
    return 'en';
}

let currentLocale: Locale = 'en';
let isDirty = false;
let pendingCloseAfterSave = false;

function applyWindowTitle() {
    if (!win) return;
    const s = MAIN_STRINGS[currentLocale];
    win.setTitle(isDirty ? s.windowTitle + s.dirtySuffix : s.windowTitle);
}

function sendMenu(action: string) {
    if (win) win.webContents.send('quarkSE:menu', action);
}

function buildMenu() {
    const m = MENU_STRINGS[currentLocale];
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: m.file,
                submenu: [
                    { label: m.new, click: () => sendMenu('new') },
                    { label: m.open, click: () => sendMenu('open') },
                    { label: m.save, click: () => sendMenu('save') },
                    { type: 'separator' },
                    { role: 'quit', label: m.quit },
                ],
            },
            {
                label: m.edit,
                submenu: [
                    { role: 'undo', label: m.undo },
                    { role: 'redo', label: m.redo },
                    { type: 'separator' },
                    { role: 'cut', label: m.cut },
                    { role: 'copy', label: m.copy },
                    { role: 'paste', label: m.paste },
                    { role: 'selectAll', label: m.selectAll },
                ],
            },
            {
                label: m.view,
                submenu: [
                    { label: m.run, click: () => sendMenu('run') },
                    { type: 'separator' },
                    { role: 'reload', label: m.reload },
                    { role: 'toggleDevTools', label: m.devtools },
                ],
            },
        ])
    );
}

>>>>>>> 2f6d6f3 (	new file:   .clang-format)
function createWindow() {
    win = new BrowserWindow({
        width: 1100,
        height: 760,
<<<<<<< HEAD
        title: 'QuarkSE — qk 编辑器',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
    win.on('closed', () => { win = null; });
}

ipcMain.handle('quarkSE:run', async (_event: any, code: string) => {
=======
        title: MAIN_STRINGS[currentLocale].windowTitle,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'index.html'));
    win.on('close', (e) => {
        if (!isDirty) return;
        const s = MAIN_STRINGS[currentLocale];
        const choice = dialog.showMessageBoxSync(win!, {
            type: 'warning',
            buttons: [s.closeSave, s.closeDiscard, s.closeCancel],
            defaultId: 2,
            cancelId: 2,
            message: s.closeTitle,
            detail: s.dirtySuffix,
        });
        if (choice === 2) {
            e.preventDefault();
            return;
        } // 取消
        if (choice === 0) {
            // 保存后关闭
            e.preventDefault();
            pendingCloseAfterSave = true;
            win!.webContents.send('quarkSE:requestSave');
        }
    });
    win.on('closed', () => {
        win = null;
    });
}

ipcMain.handle('quarkSE:run', async (_event, code: string) => {
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    const { compileQk } = await import('./pipeline');
    const { runOnDaemon } = await import('./runner');
    const res = compileQk(code);
    if (!res.ok) return { ok: false, output: res.errors.join('\n') };
    try {
        const out = await runOnDaemon(res.llvmIR!);
        return { ok: true, output: out };
<<<<<<< HEAD
    } catch (e: any) {
        return { ok: false, output: `Daemon connection failed: ${e.message}\nIs 'runtime --daemon' running?` };
=======
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, output: MAIN_STRINGS[currentLocale].daemonError.replace('{message}', msg) };
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    }
});

ipcMain.handle('quarkSE:open', async () => {
    if (!win) return null;
<<<<<<< HEAD
    const result = await dialog.showOpenDialog(win, {
        title: '打开 qk 文件',
        filters: [
            { name: 'Quark Script', extensions: ['qk'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
=======
    const s = MAIN_STRINGS[currentLocale];
    const result = await dialog.showOpenDialog(win, {
        title: s.openTitle,
        filters: [
            { name: s.qkFilter, extensions: ['qk'] },
            { name: s.allFilter, extensions: ['*'] },
        ],
        properties: ['openFile'],
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { path: filePath, content };
<<<<<<< HEAD
    } catch (e: any) {
        return null;
    }
});

ipcMain.handle('quarkSE:save', async (_event: any, currentPath: string | null, content: string) => {
    if (!win) return null;
    let filePath = currentPath;
    if (!filePath) {
        const result = await dialog.showSaveDialog(win, {
            title: '保存 qk 文件',
            defaultPath: 'untitled.qk',
            filters: [{ name: 'Quark Script', extensions: ['qk'] }]
=======
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
});

ipcMain.handle('quarkSE:save', async (_event, currentPath: string | null, content: string) => {
    if (!win) return null;
    let filePath = currentPath;
    if (!filePath) {
        const s = MAIN_STRINGS[currentLocale];
        const result = await dialog.showSaveDialog(win, {
            title: s.saveTitle,
            defaultPath: 'untitled.qk',
            filters: [{ name: s.qkFilter, extensions: ['qk'] }],
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
        });
        if (result.canceled || !result.filePath) return null;
        filePath = result.filePath;
    }
    try {
        fs.writeFileSync(filePath, content, 'utf-8');
        return filePath;
<<<<<<< HEAD
    } catch (e: any) {
        return null;
    }
});

ipcMain.on('quarkSE:setDirty', (_event: any, dirty: boolean) => {
    if (win) {
        win.setTitle(dirty ? 'QuarkSE — qk 编辑器 (未保存)' : 'QuarkSE — qk 编辑器');
    }
});

app.whenReady().then(() => {
=======
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
});

ipcMain.on('quarkSE:setDirty', (_event, dirty: boolean) => {
    isDirty = dirty;
    applyWindowTitle();
});

ipcMain.on('quarkSE:setLocale', (_event, locale: string) => {
    if (locale in MAIN_STRINGS) {
        currentLocale = locale as Locale;
        applyWindowTitle();
        buildMenu();
    }
});

ipcMain.on('quarkSE:saveDone', () => {
    if (!pendingCloseAfterSave) return;
    pendingCloseAfterSave = false;
    if (win && !isDirty) win.close();
});

ipcMain.handle('quarkSE:confirmDiscard', async () => {
    if (!win) return 'cancel';
    const s = MAIN_STRINGS[currentLocale];
    const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: [s.closeSave, s.closeDiscard, s.closeCancel],
        defaultId: 2,
        cancelId: 2,
        message: s.closeTitle,
        detail: s.dirtySuffix,
    });
    return choice === 0 ? 'save' : choice === 1 ? 'discard' : 'cancel';
});

app.whenReady().then(() => {
    currentLocale = detectLocale();
    buildMenu();
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
<<<<<<< HEAD
});
=======
});
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
