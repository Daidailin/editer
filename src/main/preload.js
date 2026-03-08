const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 新的内存映射文件 API
    readFileLines: (startLine, endLine) => ipcRenderer.invoke('read-file-lines', { startLine, endLine }),
    readLine: (lineNumber) => ipcRenderer.invoke('read-line', lineNumber),
    getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
    offsetToLine: (offset) => ipcRenderer.invoke('offset-to-line', offset),
    
    // 文件保存 API
    saveFileContent: (filePath, content) => ipcRenderer.invoke('save-file-content', { filePath, content }),
    saveNewFile: (filePath, content) => ipcRenderer.invoke('save-new-file', { filePath, content }),
    
    // 事件监听
    onFileOpened: (callback) => ipcRenderer.on('file-opened', (event, data) => callback(data)),
    onLoadingProgress: (callback) => ipcRenderer.on('loading-progress', (event, data) => callback(data)),
    onSaveFile: (callback) => ipcRenderer.on('save-file', () => callback()),
    onSaveFileAs: (callback) => ipcRenderer.on('save-file-as', (event, filePath) => callback(filePath)),
    onUndo: (callback) => ipcRenderer.on('undo', () => callback()),
    onRedo: (callback) => ipcRenderer.on('redo', () => callback()),
    onCut: (callback) => ipcRenderer.on('cut', () => callback()),
    onCopy: (callback) => ipcRenderer.on('copy', () => callback()),
    onPaste: (callback) => ipcRenderer.on('paste', () => callback()),
    onZoomIn: (callback) => ipcRenderer.on('zoom-in', () => callback()),
    onZoomOut: (callback) => ipcRenderer.on('zoom-out', () => callback()),
    onZoomReset: (callback) => ipcRenderer.on('zoom-reset', () => callback())
});
