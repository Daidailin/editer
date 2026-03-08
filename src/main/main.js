const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { MemoryMappedFileManager } = require('./memory-map');

let mainWindow;
let currentFilePath = null;
let fileManager = null;
let isOpeningFile = false;

// 保存原始的 console 函数
const originalLog = console.log;
const originalError = console.error;

// 创建日志文件
const logFilePath = path.join(app.getPath('userData'), 'fastedit-debug.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function writeLogToFile(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    logStream.write(logMessage);
}

// 重定向 console.log
console.log = function(...args) {
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
    writeLogToFile('LOG', message);
    originalLog.apply(console, args);
};

// 重定向 console.error
console.error = function(...args) {
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
    writeLogToFile('ERROR', message);
    originalError.apply(console, args);
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    
    // 自动打开开发者工具以便调试
    mainWindow.webContents.openDevTools();

    const menuTemplate = [
        {
            label: '文件',
            submenu: [
                {
                    label: '打开',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => openFile()
                },
                {
                    label: '保存',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => mainWindow.webContents.send('save-file')
                },
                {
                    label: '另存为',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => saveFileAs()
                },
                { type: 'separator' },
                {
                    label: '退出',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => app.quit()
                }
            ]
        },
        {
            label: '编辑',
            submenu: [
                {
                    label: '撤销',
                    accelerator: 'CmdOrCtrl+Z',
                    click: () => mainWindow.webContents.send('undo')
                },
                {
                    label: '重做',
                    accelerator: 'CmdOrCtrl+Y',
                    click: () => mainWindow.webContents.send('redo')
                },
                { type: 'separator' },
                {
                    label: '剪切',
                    accelerator: 'CmdOrCtrl+X',
                    click: () => mainWindow.webContents.send('cut')
                },
                {
                    label: '复制',
                    accelerator: 'CmdOrCtrl+C',
                    click: () => mainWindow.webContents.send('copy')
                },
                {
                    label: '粘贴',
                    accelerator: 'CmdOrCtrl+V',
                    click: () => mainWindow.webContents.send('paste')
                }
            ]
        },
        {
            label: '视图',
            submenu: [
                {
                    label: '放大',
                    accelerator: 'CmdOrCtrl+Plus',
                    click: () => mainWindow.webContents.send('zoom-in')
                },
                {
                    label: '缩小',
                    accelerator: 'CmdOrCtrl+-',
                    click: () => mainWindow.webContents.send('zoom-out')
                },
                {
                    label: '重置缩放',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => mainWindow.webContents.send('zoom-reset')
                },
                { type: 'separator' },
                {
                    label: '开发者工具',
                    accelerator: 'F12',
                    click: () => mainWindow.webContents.toggleDevTools()
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

async function openFile() {
    // 防止重复打开文件
    if (isOpeningFile) {
        console.log('文件正在打开中，忽略重复请求');
        return;
    }
    
    isOpeningFile = true;
    
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [
                { name: '文本文件', extensions: ['txt', 'log', 'json', 'xml', 'html', 'css', 'js', 'md'] },
                { name: '所有文件', extensions: ['*'] }
            ]
        });

        if (result.canceled || result.filePaths.length === 0) {
            isOpeningFile = false;
            return;
        }
        
        const filePath = result.filePaths[0];
        currentFilePath = filePath;
        
        try {
            if (fileManager) {
                fileManager.close();
            }
            
            fileManager = new MemoryMappedFileManager();
            
            mainWindow.webContents.send('loading-progress', {
                message: '正在使用内存映射打开文件...',
                percent: 0
            });
            
            const openResult = fileManager.openFile(filePath, (percent, current, total) => {
                mainWindow.webContents.send('loading-progress', {
                    message: `正在构建行索引 (${current}/${total})...`,
                    percent: percent
                });
            });
            
            mainWindow.setTitle(`${path.basename(filePath)} - FastEdit`);
            
            console.log('Sending file-opened event:', openResult);
            
            // 发送文件打开事件
            const fileData = {
                filePath: filePath,
                fileSize: openResult.fileSize,
                totalLines: openResult.totalLines,
                fileName: path.basename(filePath)
            };
            
            // 如果页面正在加载，等待加载完成后再发送
            if (mainWindow.webContents.isLoading()) {
                mainWindow.webContents.once('did-finish-load', () => {
                    console.log('Page finished loading, sending file-opened event');
                    mainWindow.webContents.send('file-opened', fileData);
                    isOpeningFile = false;
                });
            } else {
                // 页面已经加载完成，直接发送
                mainWindow.webContents.send('file-opened', fileData);
                isOpeningFile = false;
            }
        } catch (error) {
            console.error('打开文件失败:', error);
            dialog.showErrorBox('打开文件失败', error.message);
            if (fileManager) {
                fileManager.close();
                fileManager = null;
            }
            isOpeningFile = false;
        }
    } catch (error) {
        console.error('选择文件对话框出错:', error);
        isOpeningFile = false;
    }
}

async function saveFileAs() {
    const result = await dialog.showSaveDialog(mainWindow, {
        filters: [
            { name: '文本文件', extensions: ['txt'] },
            { name: '所有文件', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        currentFilePath = result.filePath;
        mainWindow.webContents.send('save-file-as', result.filePath);
    }
}

ipcMain.handle('read-file-lines', async (event, { startLine, endLine }) => {
    try {
        console.log('read-file-lines called:', startLine, endLine);
        if (!fileManager) {
            throw new Error('文件未打开');
        }
        
        const lines = fileManager.readLines(startLine, endLine);
        console.log('read-file-lines returning', lines.length, 'lines');
        return lines;
    } catch (error) {
        console.error('读取行失败:', error);
        throw error;
    }
});

ipcMain.handle('read-line', async (event, lineNumber) => {
    try {
        if (!fileManager) {
            throw new Error('文件未打开');
        }
        
        const content = fileManager.readLine(lineNumber);
        return { lineNum: lineNumber, content: content };
    } catch (error) {
        console.error(`读取第 ${lineNumber} 行失败:`, error);
        throw error;
    }
});

ipcMain.handle('get-file-info', async (event, filePath) => {
    try {
        if (fileManager && fileManager.fileSize > 0) {
            return {
                size: fileManager.fileSize,
                totalLines: fileManager.getLineCount(),
                isFile: true
            };
        }
        
        return new Promise((resolve, reject) => {
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        size: stats.size,
                        isFile: stats.isFile()
                    });
                }
            });
        });
    } catch (error) {
        throw error;
    }
});

ipcMain.handle('offset-to-line', async (event, offset) => {
    try {
        if (!fileManager) {
            throw new Error('文件未打开');
        }
        
        const lineNumber = fileManager.offsetToLine(offset);
        return { lineNumber };
    } catch (error) {
        console.error('偏移量转换失败:', error);
        throw error;
    }
});

ipcMain.handle('save-file-content', async (event, { filePath, content }) => {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, content, 'utf-8', (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(true);
            }
        });
    });
});

ipcMain.handle('save-new-file', async (event, { filePath, content }) => {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, content, 'utf-8', (err) => {
            if (err) {
                reject(err);
            } else {
                currentFilePath = filePath;
                mainWindow.setTitle(`${path.basename(filePath)} - FastEdit`);
                resolve(true);
            }
        });
    });
});

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
