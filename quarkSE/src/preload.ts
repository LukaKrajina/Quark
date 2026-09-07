import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('quarkSE', {
    runScript: (code: string) => ipcRenderer.invoke('quarkSE:run', code),
    openFileDialog: () => ipcRenderer.invoke('quarkSE:open'),
    saveFileDialog: (path: string | null, content: string) => ipcRenderer.invoke('quarkSE:save', path, content),
    setDirty: (dirty: boolean) => ipcRenderer.send('quarkSE:setDirty', dirty),
    setLocale: (locale: string) => ipcRenderer.send('quarkSE:setLocale', locale),
    onMenu: (callback: (action: string) => void) => {
        ipcRenderer.on('quarkSE:menu', (_event, action) => callback(action));
    },
    onRequestSave: (callback: () => void) => {
        ipcRenderer.on('quarkSE:requestSave', () => callback());
    },
    notifySaveDone: () => ipcRenderer.send('quarkSE:saveDone'),
    confirmDiscard: () => ipcRenderer.invoke('quarkSE:confirmDiscard') as Promise<'save' | 'discard' | 'cancel'>,
});
