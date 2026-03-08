import { VirtualScrollList } from './virtual-scroll.js';
import { LineNumberWidthManager } from './line-number-width.js';

class LargeFileEditor {
    constructor() {
        this.currentFilePath = null;
        this.fileSize = 0;
        this.totalLines = 0;
        this.currentLine = 1;
        this.currentCol = 1;
        this.fontSize = 16;
        this.lineHeight = 24;
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndoSteps = 100;

        this.contentVirtualList = null;
        this.lineNumberVirtualList = null;
        this.lineNumberWidthManager = null;

        this.init();
    }

    init() {
        this.editorContainer = document.getElementById('editor-container');
        this.lineNumbersEl = document.getElementById('line-numbers');
        this.lineNumbersContentEl = document.getElementById('line-numbers-content');
        this.editorScrollEl = document.getElementById('editor-scroll');
        this.editorContentEl = document.getElementById('editor-content');
        this.cursorEl = document.getElementById('cursor');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.loadingText = document.getElementById('loading-text');
        this.loadingProgressBar = document.getElementById('loading-progress-bar');
        this.welcomeScreen = document.getElementById('welcome-screen');
        this.statusFile = document.getElementById('status-file');
        this.statusSize = document.getElementById('status-size');
        this.statusPosition = document.getElementById('status-position');
        this.statusLines = document.getElementById('status-lines');

        this.setupEventListeners();
        this.setupIPC();

        console.log('Editor initialized:', 'LargeFileEditor');
        console.log('electronAPI available:', typeof window.electronAPI);
        console.log('onFileAvailable:', typeof window.electronAPI?.onFileOpened);
    }

    setupEventListeners() {
        this.editorScrollEl.addEventListener('scroll', () => {
            requestAnimationFrame(() => this.syncScroll());
        });

        window.addEventListener('resize', () => {
            this.onResize();
        });

        this.editorScrollEl.addEventListener('click', (e) => {
            this.handleClick(e);
        });

        document.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
        });
    }

    setupIPC() {
        if (window.electronAPI) {
            window.electronAPI.onFileOpened((data) => {
                console.log('onFileOpened called:', data);
                this.onFileOpened(data);
            });

            window.electronAPI.onLoadingProgress((data) => {
                this.showLoading(data.message, data.percent);
            });

            window.electronAPI.onSaveFile(() => {
                this.saveFile();
            });

            window.electronAPI.onSaveFileAs((filePath) => {
                this.saveFileAs(filePath);
            });

            window.electronAPI.onUndo(() => this.undo());
            window.electronAPI.onRedo(() => this.redo());
            window.electronAPI.onCut(() => this.cut());
            window.electronAPI.onCopy(() => this.copy());
            window.electronAPI.onPaste(() => this.paste());
            window.electronAPI.onZoomIn(() => this.zoomIn());
            window.electronAPI.onZoomOut(() => this.zoomOut());
            window.electronAPI.onZoomReset(() => this.zoomReset());
        }
    }

    async onFileOpened(data) {
        console.log('File opened:', data);
        this.hideLoading();
        this.welcomeScreen.classList.add('hidden');

        this.currentFilePath = data.filePath;
        this.fileSize = data.fileSize;
        this.totalLines = data.totalLines;

        this.updateStatusBar(data.fileName);

        // 初始化动态行号宽度管理器
        this.lineNumberWidthManager = new LineNumberWidthManager({
            minWidth: 40,
            padding: 20,
            extraDigits: 1
        });
        this.updateLineNumberFont();

        // 初始化虚拟滚动列表
        this.initVirtualScroll();

        // 计算初始可视区域的最大行号并设置宽度
        const viewportHeight = this.editorScrollEl.clientHeight;
        const initialVisibleEndLine = Math.min(this.totalLines, Math.ceil(viewportHeight / this.lineHeight));
        this.forceUpdateLineNumberWidth(initialVisibleEndLine);

        // 同步滚动以渲染初始内容
        this.syncScroll();

        this.currentLine = 1;
        this.currentCol = 1;
        this.updateCursorPosition(1, 1);
    }

    initVirtualScroll() {
        // 内容虚拟滚动列表
        this.contentVirtualList = new VirtualScrollList({
            container: this.editorScrollEl,
            itemHeight: this.lineHeight,
            totalItems: this.totalLines,
            renderItem: (index) => this.renderContentLine(index),
            bufferSize: 10
        });

        // 行号虚拟滚动列表
        this.lineNumberVirtualList = new VirtualScrollList({
            container: this.lineNumbersEl,
            itemHeight: this.lineHeight,
            totalItems: this.totalLines,
            renderItem: (index) => this.renderLineNumber(index),
            bufferSize: 10
        });
    }

    renderContentLine(index) {
        const lineNum = index + 1;
        const lineEl = document.createElement('div');
        lineEl.className = 'line';
        lineEl.dataset.lineNum = lineNum;
        lineEl.textContent = '';

        // 异步加载行内容
        this.loadLineRange(lineNum, lineNum).then(lines => {
            if (lines.length > 0) {
                lineEl.textContent = lines[0].content;
            }
        }).catch(err => {
            console.error('加载行内容失败:', err);
        });

        return lineEl;
    }

    renderLineNumber(index) {
        const lineNum = index + 1;
        const lineEl = document.createElement('div');
        lineEl.className = 'line';
        lineEl.textContent = lineNum;
        return lineEl;
    }

    async loadLineRange(startLine, endLine) {
        console.log('loadLineRange called:', startLine, endLine);
        try {
            const lines = await window.electronAPI.readFileLines(startLine, endLine);
            console.log('loadLineRange result:', lines.length, 'lines');
            return lines;
        } catch (error) {
            console.error('加载行失败:', error);
            return [];
        }
    }

    syncScroll() {
        if (!this.contentVirtualList || !this.lineNumberVirtualList) return;

        const scrollTop = this.editorScrollEl.scrollTop;
        const viewportHeight = this.editorScrollEl.clientHeight;

        // 计算可视区域的行号范围
        const visibleStartLine = Math.floor(scrollTop / this.lineHeight) + 1;
        const visibleEndLine = Math.min(
            this.totalLines,
            Math.ceil((scrollTop + viewportHeight) / this.lineHeight)
        );

        // 更新行号宽度（基于可视区域的最大行号）
        this.updateVisibleLineNumberWidth(visibleEndLine);

        // 同步内容列表
        this.contentVirtualList.setScrollTop(scrollTop);
        this.contentVirtualList.setContainerHeight(viewportHeight);

        // 同步行号列表
        this.lineNumberVirtualList.setScrollTop(scrollTop);
        this.lineNumberVirtualList.setContainerHeight(this.lineNumbersEl.clientHeight);

        // 同步行号容器的滚动位置
        this.lineNumbersEl.scrollTop = scrollTop;

        // 更新当前行号
        this.currentLine = visibleStartLine;
        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    /**
     * 根据可视区域的最大行号更新行号容器宽度
     * @param {number} visibleMaxLineNum - 可视区域最大行号
     */
    updateVisibleLineNumberWidth(visibleMaxLineNum) {
        const result = this.lineNumberWidthManager.update(visibleMaxLineNum);

        if (result) {
            const { newWidth } = result;

            // 更新行号容器宽度
            this.lineNumbersEl.style.width = `${newWidth}px`;

            // 触发重绘以确保布局正确
            this.lineNumbersEl.offsetHeight;
        }
    }

    /**
     * 强制更新行号宽度（不考虑缓存）
     * @param {number} visibleMaxLineNum - 可视区域最大行号
     */
    forceUpdateLineNumberWidth(visibleMaxLineNum) {
        if (!this.lineNumberWidthManager) return;

        const result = this.lineNumberWidthManager.forceUpdate(visibleMaxLineNum);

        if (result) {
            const { newWidth } = result;

            // 更新行号容器宽度
            this.lineNumbersEl.style.width = `${newWidth}px`;
        }
    }

    /**
     * 更新行号字体设置
     */
    updateLineNumberFont() {
        if (!this.lineNumberWidthManager) return;

        const font = `${this.fontSize}px Consolas, "Courier New", monospace`;
        this.lineNumberWidthManager.setFont(font);
    }

    handleClick(e) {
        const rect = this.editorScrollEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top + this.editorScrollEl.scrollTop;

        const line = Math.floor(y / this.lineHeight) + 1;
        const col = Math.floor(x / this.measureCharWidth()) + 1;

        this.currentLine = Math.min(Math.max(1, line), this.totalLines);
        this.currentCol = Math.max(1, col);

        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    handleKeyDown(e) {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 'o':
                    e.preventDefault();
                    break;
                case 's':
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.saveFileAs();
                    } else {
                        this.saveFile();
                    }
                    break;
                case 'z':
                    e.preventDefault();
                    this.undo();
                    break;
                case 'y':
                    e.preventDefault();
                    this.redo();
                    break;
                case 'x':
                    e.preventDefault();
                    this.cut();
                    break;
                case 'c':
                    e.preventDefault();
                    this.copy();
                    break;
                case 'v':
                    e.preventDefault();
                    this.paste();
                    break;
                case '+':
                case '=':
                    e.preventDefault();
                    this.zoomIn();
                    break;
                case '-':
                    e.preventDefault();
                    this.zoomOut();
                    break;
                case '0':
                    e.preventDefault();
                    this.zoomReset();
                    break;
            }
            return;
        }

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this.moveCursorUp();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.moveCursorDown();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.moveCursorLeft();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.moveCursorRight();
                break;
            case 'Home':
                e.preventDefault();
                this.currentCol = 1;
                this.updateCursorPosition(this.currentLine, this.currentCol);
                break;
            case 'End':
                e.preventDefault();
                this.moveCursorToEnd();
                break;
            case 'PageUp':
                e.preventDefault();
                this.moveCursorPageUp();
                break;
            case 'PageDown':
                e.preventDefault();
                this.moveCursorPageDown();
                break;
        }
    }

    moveCursorUp() {
        if (this.currentLine > 1) {
            this.currentLine--;
            this.ensureLineInView();
            this.updateCursorPosition(this.currentLine, this.currentCol);
        }
    }

    moveCursorDown() {
        if (this.currentLine < this.totalLines) {
            this.currentLine++;
            this.ensureLineInView();
            this.updateCursorPosition(this.currentLine, this.currentCol);
        }
    }

    moveCursorLeft() {
        if (this.currentCol > 1) {
            this.currentCol--;
            this.updateCursorPosition(this.currentLine, this.currentCol);
        } else if (this.currentLine > 1) {
            this.currentLine--;
            this.moveCursorToEnd();
        }
    }

    moveCursorRight() {
        this.currentCol++;
        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    moveCursorToEnd() {
        const lineEl = this.contentVirtualList?.getItemElement(this.currentLine - 1);
        const lineContent = lineEl ? lineEl.textContent : '';
        this.currentCol = lineContent.length + 1;
        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    moveCursorPageUp() {
        const pageLines = Math.floor(this.editorScrollEl.clientHeight / this.lineHeight);
        this.currentLine = Math.max(1, this.currentLine - pageLines);
        this.ensureLineInView();
        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    moveCursorPageDown() {
        const pageLines = Math.floor(this.editorScrollEl.clientHeight / this.lineHeight);
        this.currentLine = Math.min(this.totalLines, this.currentLine + pageLines);
        this.ensureLineInView();
        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    ensureLineInView() {
        const cursorY = (this.currentLine - 1) * this.lineHeight;
        const scrollTop = this.editorScrollEl.scrollTop;
        const viewportHeight = this.editorScrollEl.clientHeight;

        if (cursorY < scrollTop) {
            this.editorScrollEl.scrollTop = cursorY;
        } else if (cursorY > scrollTop + viewportHeight - this.lineHeight) {
            this.editorScrollEl.scrollTop = cursorY - viewportHeight + this.lineHeight;
        }
    }

    updateCursorPosition(line, col) {
        this.currentLine = line;
        this.currentCol = col;

        const charWidth = this.measureCharWidth();
        const x = (col - 1) * charWidth;
        const y = (line - 1) * this.lineHeight;

        this.cursorEl.style.display = 'block';
        this.cursorEl.style.left = x + 'px';
        this.cursorEl.style.top = (y - this.editorScrollEl.scrollTop + 3) + 'px';

        this.updateStatusPosition();
    }

    measureCharWidth() {
        const testEl = document.createElement('span');
        testEl.textContent = 'M';
        testEl.style.fontFamily = 'Consolas, "Courier New", monospace';
        testEl.style.fontSize = this.fontSize + 'px';
        testEl.style.visibility = 'hidden';
        testEl.style.position = 'absolute';
        document.body.appendChild(testEl);
        const width = testEl.offsetWidth;
        document.body.removeChild(testEl);
        return width;
    }

    updateStatusBar(fileName) {
        this.statusFile.textContent = fileName || '未打开文件';
        this.statusSize.textContent = this.formatFileSize(this.fileSize);
        this.statusLines.textContent = `行数: ${this.totalLines.toLocaleString()}`;
    }

    updateStatusPosition() {
        this.statusPosition.textContent = `行 ${this.currentLine.toLocaleString()}, 列 ${this.currentCol}`;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showLoading(message, percent = 0) {
        this.loadingOverlay.classList.remove('hidden');
        this.loadingText.textContent = message;
        this.loadingProgressBar.style.width = percent + '%';
    }

    hideLoading() {
        this.loadingOverlay.classList.add('hidden');
    }

    onResize() {
        if (this.contentVirtualList) {
            this.syncScroll();
        }
    }

    // 编辑功能（待实现）
    undo() {
        if (this.undoStack.length === 0) return;
        const state = this.undoStack.pop();
        this.redoStack.push(state);
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const state = this.redoStack.pop();
        this.undoStack.push(state);
    }

    cut() {
        // 待实现
    }

    copy() {
        // 待实现
    }

    paste() {
        // 待实现
    }

    saveFile() {
        // 待实现
    }

    saveFileAs(filePath) {
        // 待实现
    }

    // 缩放功能
    zoomIn() {
        this.fontSize = Math.min(32, this.fontSize + 2);
        this.applyZoom();
    }

    zoomOut() {
        this.fontSize = Math.max(10, this.fontSize - 2);
        this.applyZoom();
    }

    zoomReset() {
        this.fontSize = 16;
        this.applyZoom();
    }

    applyZoom() {
        document.documentElement.style.fontSize = this.fontSize + 'px';
        this.lineHeight = Math.round(this.fontSize * 1.5);

        // 更新行号字体并重新计算宽度（基于当前可视区域）
        this.updateLineNumberFont();
        if (this.totalLines > 0) {
            const scrollTop = this.editorScrollEl.scrollTop;
            const viewportHeight = this.editorScrollEl.clientHeight;
            const visibleEndLine = Math.min(
                this.totalLines,
                Math.ceil((scrollTop + viewportHeight) / this.lineHeight)
            );
            this.forceUpdateLineNumberWidth(visibleEndLine);
        }

        // 更新虚拟列表的行高
        if (this.contentVirtualList) {
            this.contentVirtualList.itemHeight = this.lineHeight;
            this.lineNumberVirtualList.itemHeight = this.lineHeight;
            this.syncScroll();
        }
    }
}

// 初始化编辑器
document.addEventListener('DOMContentLoaded', () => {
    window.editor = new LargeFileEditor();
});
