const koffi = require('koffi');
const path = require('path');
const fs = require('fs');

// 加载 kernel32.dll
const kernel32 = koffi.load('kernel32.dll');

// 定义 Windows API 函数
const CreateFileW = kernel32.func('CreateFileW', 'void *', ['void *', 'uint32', 'uint32', 'void *', 'uint32', 'uint32', 'void *']);
const CreateFileMappingW = kernel32.func('CreateFileMappingW', 'void *', ['void *', 'void *', 'uint32', 'uint32', 'uint32', 'void *']);
const MapViewOfFile = kernel32.func('MapViewOfFile', 'void *', ['void *', 'uint32', 'uint32', 'uint32', 'uint64']);
const UnmapViewOfFile = kernel32.func('UnmapViewOfFile', 'int', ['void *']);
const CloseHandle = kernel32.func('CloseHandle', 'int', ['void *']);
const GetFileSizeEx = kernel32.func('GetFileSizeEx', 'int', ['void *', 'void *']);
const GetLastError = kernel32.func('GetLastError', 'uint32', []);

const INVALID_HANDLE_VALUE = -1;
const PAGE_READONLY = 0x02;
const FILE_MAP_READ = 0x0004;
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_ACCESS_DENIED = 5;
const ERROR_INVALID_HANDLE = 6;
const ERROR_NOT_ENOUGH_MEMORY = 8;

const WindowsError = {
    [ERROR_FILE_NOT_FOUND]: '找不到指定的文件',
    [ERROR_ACCESS_DENIED]: '访问被拒绝',
    [ERROR_INVALID_HANDLE]: '无效的文件句柄',
    [ERROR_NOT_ENOUGH_MEMORY]: '内存不足',
};

function getLastErrorMessage(code) {
    return WindowsError[code] || `Windows 错误代码: ${code}`;
}

const GENERIC_READ = 0x80000000;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_WRITE = 0x00000002;
const FILE_SHARE_DELETE = 0x00000004;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;

class MemoryMappedFile {
    constructor() {
        this.fileHandle = null;
        this.mappingHandle = null;
        this.viewPtr = null;
        this.viewSize = 0;
        this.fileSize = 0;
        this.filePath = null;
        this.mappedOffset = 0;
        this.mappedSize = 0;
        // 使用 fs 读取作为后备方案
        this.fallbackFd = null;
    }

    open(filePath) {
        try {
            this.filePath = filePath;
            
            // 打开文件句柄（用于内存映射）
            const widePath = Buffer.from(filePath + '\0', 'ucs2');
            
            this.fileHandle = CreateFileW(
                widePath,
                GENERIC_READ,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                null
            );

            if (!this.fileHandle) {
                const errorCode = GetLastError();
                throw new Error(`无法打开文件: ${getLastErrorMessage(errorCode)}`);
            }

            // 获取文件大小
            const sizeBuffer = Buffer.alloc(8);
            const result = GetFileSizeEx(this.fileHandle, sizeBuffer);
            
            if (!result) {
                const errorCode = GetLastError();
                this.close();
                throw new Error(`无法获取文件大小: ${getLastErrorMessage(errorCode)}`);
            }

            this.fileSize = sizeBuffer.readBigInt64LE(0);
            
            // 同时打开文件描述符（用于后备读取）
            try {
                this.fallbackFd = fs.openSync(filePath, 'r');
            } catch (e) {
                console.warn('无法打开后备文件描述符:', e.message);
            }
            
            return {
                success: true,
                fileSize: Number(this.fileSize)
            };
        } catch (error) {
            this.close();
            throw error;
        }
    }

    createMapping(maxSize = null) {
        try {
            if (!this.fileHandle) {
                throw new Error('文件未打开');
            }

            const maxMapSize = 256 * 1024 * 1024;
            const fileSizeNum = Number(this.fileSize);
            const sizeToMap = maxSize ? BigInt(maxSize) : 
                              (fileSizeNum <= maxMapSize ? this.fileSize : BigInt(maxMapSize));
            
            const sizeHigh = Number(sizeToMap >> BigInt(32));
            const sizeLow = Number(sizeToMap & BigInt(0xFFFFFFFF));

            this.mappingHandle = CreateFileMappingW(
                this.fileHandle,
                null,
                PAGE_READONLY,
                sizeHigh,
                sizeLow,
                null
            );

            if (!this.mappingHandle) {
                const errorCode = GetLastError();
                throw new Error(`无法创建文件映射: ${getLastErrorMessage(errorCode)}`);
            }

            return true;
        } catch (error) {
            throw error;
        }
    }

    mapView(offset, size) {
        try {
            if (!this.mappingHandle) {
                throw new Error('文件映射未创建');
            }

            this.unmapView();

            const offsetBig = BigInt(offset);
            const offsetHigh = Number(offsetBig >> BigInt(32));
            const offsetLow = Number(offsetBig & BigInt(0xFFFFFFFF));

            this.viewPtr = MapViewOfFile(
                this.mappingHandle,
                FILE_MAP_READ,
                offsetHigh,
                offsetLow,
                size
            );

            if (!this.viewPtr) {
                const errorCode = GetLastError();
                throw new Error(`无法映射视图: ${getLastErrorMessage(errorCode)}`);
            }

            this.mappedOffset = offset;
            this.mappedSize = size;

            return {
                ptr: this.viewPtr,
                offset: offset,
                size: size
            };
        } catch (error) {
            throw error;
        }
    }

    readBuffer(offset, length) {
        try {
            const fileSizeNum = Number(this.fileSize);
            if (offset + length > fileSizeNum) {
                length = fileSizeNum - offset;
            }
            
            if (length <= 0) {
                return Buffer.alloc(0);
            }
            
            // 使用 fs.readSync 作为后备方案读取文件
            // 这比内存映射更可靠
            if (this.fallbackFd !== null) {
                const buffer = Buffer.alloc(length);
                const bytesRead = fs.readSync(this.fallbackFd, buffer, 0, length, offset);
                if (bytesRead < length) {
                    return buffer.slice(0, bytesRead);
                }
                return buffer;
            }
            
            // 如果没有后备文件描述符，尝试使用内存映射
            if (!this.viewPtr || offset < this.mappedOffset || offset + length > this.mappedOffset + this.mappedSize) {
                const remainingSize = fileSizeNum - offset;
                const viewSize = Math.min(64 * 1024 * 1024, remainingSize);
                this.mapView(offset, viewSize);
            }

            // 使用 koffi 读取内存数据
            const relativeOffset = offset - this.mappedOffset;
            const ByteArray = koffi.array('uint8', length);
            const data = koffi.decode(this.viewPtr, ByteArray, relativeOffset);
            
            const buffer = Buffer.alloc(length);
            if (data && data.length > 0) {
                for (let i = 0; i < Math.min(data.length, length); i++) {
                    buffer[i] = data[i];
                }
            }
            
            return buffer;
        } catch (error) {
            throw new Error(`读取缓冲区失败: ${error.message}`);
        }
    }

    readString(offset, length, encoding = 'utf-8') {
        const buffer = this.readBuffer(offset, length);
        return buffer.toString(encoding);
    }

    unmapView() {
        if (this.viewPtr) {
            try {
                UnmapViewOfFile(this.viewPtr);
            } catch (e) {
                console.warn('解除视图映射时出错:', e.message);
            }
            this.viewPtr = null;
            this.mappedOffset = 0;
            this.mappedSize = 0;
        }
    }

    close() {
        this.unmapView();

        if (this.mappingHandle) {
            try {
                CloseHandle(this.mappingHandle);
            } catch (e) {
                console.warn('关闭映射句柄时出错:', e.message);
            }
            this.mappingHandle = null;
        }

        if (this.fileHandle) {
            try {
                CloseHandle(this.fileHandle);
            } catch (e) {
                console.warn('关闭文件句柄时出错:', e.message);
            }
            this.fileHandle = null;
        }
        
        if (this.fallbackFd !== null) {
            try {
                fs.closeSync(this.fallbackFd);
            } catch (e) {
                console.warn('关闭后备文件描述符时出错:', e.message);
            }
            this.fallbackFd = null;
        }

        this.fileSize = 0;
        this.filePath = null;
    }
}

class LineIndexBuilder {
    constructor(memoryMappedFile) {
        this.mmf = memoryMappedFile;
        this.lineOffsets = [0];
        this.chunkSize = 64 * 1024 * 1024;
    }

    buildIndex(progressCallback = null) {
        try {
            const fileSize = Number(this.mmf.fileSize);
            const totalChunks = Math.ceil(fileSize / this.chunkSize);
            
            for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                const chunkOffset = chunkIndex * this.chunkSize;
                const chunkSize = Math.min(this.chunkSize, fileSize - chunkOffset);
                
                const buffer = this.mmf.readBuffer(chunkOffset, chunkSize);
                
                for (let i = 0; i < buffer.length; i++) {
                    if (buffer[i] === 0x0A) {
                        this.lineOffsets.push(chunkOffset + i + 1);
                    }
                }

                if (progressCallback) {
                    const progress = Math.round((chunkIndex + 1) / totalChunks * 100);
                    progressCallback(progress, chunkIndex + 1, totalChunks);
                }
            }

            if (this.lineOffsets[this.lineOffsets.length - 1] >= fileSize && this.lineOffsets.length > 1) {
                this.lineOffsets.pop();
            }

            return {
                totalLines: this.lineOffsets.length,
                lineOffsets: this.lineOffsets
            };
        } catch (error) {
            throw new Error(`构建行索引失败: ${error.message}`);
        }
    }

    getLineOffset(lineNumber) {
        if (lineNumber < 1 || lineNumber > this.lineOffsets.length) {
            throw new Error(`行号超出范围: ${lineNumber}`);
        }
        return this.lineOffsets[lineNumber - 1];
    }

    getLineLength(lineNumber) {
        const startOffset = this.getLineOffset(lineNumber);
        const endOffset = lineNumber < this.lineOffsets.length 
            ? this.lineOffsets[lineNumber] 
            : Number(this.mmf.fileSize);
        return endOffset - startOffset;
    }

    offsetToLine(offset) {
        let left = 0;
        let right = this.lineOffsets.length - 1;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (this.lineOffsets[mid] <= offset) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        return right + 1;
    }
}

class MemoryMappedFileManager {
    constructor() {
        this.mmf = new MemoryMappedFile();
        this.lineIndex = null;
        this.cache = new Map();
        this.maxCacheSize = 1000;
    }

    openFile(filePath, progressCallback = null) {
        try {
            const result = this.mmf.open(filePath);
            
            this.mmf.createMapping();
            
            const builder = new LineIndexBuilder(this.mmf);
            const indexResult = builder.buildIndex(progressCallback);
            
            this.lineIndex = builder;
            
            return {
                success: true,
                fileSize: result.fileSize,
                totalLines: indexResult.totalLines
            };
        } catch (error) {
            this.close();
            throw error;
        }
    }

    readLine(lineNumber) {
        try {
            const cacheKey = `line_${lineNumber}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            const offset = this.lineIndex.getLineOffset(lineNumber);
            const length = this.lineIndex.getLineLength(lineNumber);
            
            const buffer = this.mmf.readBuffer(offset, length);
            
            let content = buffer.toString('utf-8');
            content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            if (content.endsWith('\n')) {
                content = content.slice(0, -1);
            }

            this.addToCache(cacheKey, content);
            
            return content;
        } catch (error) {
            throw new Error(`读取第 ${lineNumber} 行失败: ${error.message}`);
        }
    }

    readLines(startLine, endLine) {
        const lines = [];
        for (let i = startLine; i <= endLine; i++) {
            try {
                const content = this.readLine(i);
                lines.push({ lineNum: i, content: content });
            } catch (error) {
                lines.push({ lineNum: i, content: '', error: error.message });
            }
        }
        return lines;
    }

    getLineCount() {
        return this.lineIndex ? this.lineIndex.lineOffsets.length : 0;
    }

    offsetToLine(offset) {
        return this.lineIndex ? this.lineIndex.offsetToLine(offset) : 1;
    }

    addToCache(key, value) {
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    clearCache() {
        this.cache.clear();
    }

    close() {
        this.clearCache();
        this.lineIndex = null;
        this.mmf.close();
    }
}

module.exports = {
    MemoryMappedFile,
    LineIndexBuilder,
    MemoryMappedFileManager,
    WindowsError,
    getLastErrorMessage
};
