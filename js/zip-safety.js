/* global globalThis */
(function exposeEpubZipSafety(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.EpubZipSafety = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createEpubZipSafety() {
    'use strict';

    // 这些值覆盖常见 EPUB，同时把移动设备上最危险的内存与 CPU 放大面收住。
    const LIMITS = Object.freeze({
        maxArchiveBytes: 100 * 1024 * 1024,
        maxEntries: 3000,
        maxEntryUncompressedBytes: 50 * 1024 * 1024,
        maxTotalUncompressedBytes: 250 * 1024 * 1024,
        maxCompressionRatio: 100,
        parseTimeoutMs: 15_000
    });
    const EOCD_SIGNATURE = 0x06054b50;
    const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
    const UINT32_MAX = 0xffffffff;

    function safetyError(message) {
        const error = new Error(message);
        error.name = 'EpubSafetyError';
        return error;
    }

    function findEndOfCentralDirectory(view) {
        const minimumOffset = Math.max(0, view.byteLength - 0xffff - 22);
        for (let offset = view.byteLength - 22; offset >= minimumOffset; offset--) {
            if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
            const commentLength = view.getUint16(offset + 20, true);
            if (offset + 22 + commentLength === view.byteLength) return offset;
        }
        throw safetyError('无法读取 EPUB 的 ZIP 目录，请确认文件完整。');
    }

    function validateArchive(arrayBuffer, limits = LIMITS) {
        if (!(arrayBuffer instanceof ArrayBuffer)) {
            throw safetyError('无法读取 EPUB 文件数据。');
        }
        if (arrayBuffer.byteLength > limits.maxArchiveBytes) {
            throw safetyError(`EPUB 文件超过 ${(limits.maxArchiveBytes / 1024 / 1024).toFixed(0)} MB 上限。`);
        }
        if (arrayBuffer.byteLength < 22) {
            throw safetyError('EPUB 文件不是有效的 ZIP 文件。');
        }

        const view = new DataView(arrayBuffer);
        const eocdOffset = findEndOfCentralDirectory(view);
        const diskNumber = view.getUint16(eocdOffset + 4, true);
        const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
        const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
        const entryCount = view.getUint16(eocdOffset + 10, true);
        const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
        const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

        if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
            throw safetyError('不支持跨磁盘 EPUB ZIP 文件。');
        }
        if (entryCount === 0xffff || centralDirectorySize === UINT32_MAX || centralDirectoryOffset === UINT32_MAX) {
            throw safetyError('不支持 ZIP64 EPUB 文件，请使用常规 EPUB 文件。');
        }
        if (entryCount > limits.maxEntries) {
            throw safetyError(`EPUB 包含超过 ${limits.maxEntries} 个条目，已拒绝解析。`);
        }

        const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
        if (centralDirectoryOffset > view.byteLength || centralDirectoryEnd > view.byteLength || centralDirectoryEnd < centralDirectoryOffset) {
            throw safetyError('EPUB 的 ZIP 目录损坏。');
        }

        let offset = centralDirectoryOffset;
        let totalUncompressedBytes = 0;
        for (let index = 0; index < entryCount; index++) {
            if (offset + 46 > centralDirectoryEnd || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
                throw safetyError('EPUB 的 ZIP 条目目录损坏。');
            }

            const compressedBytes = view.getUint32(offset + 20, true);
            const uncompressedBytes = view.getUint32(offset + 24, true);
            const filenameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const recordLength = 46 + filenameLength + extraLength + commentLength;

            if (compressedBytes === UINT32_MAX || uncompressedBytes === UINT32_MAX) {
                throw safetyError('不支持含 ZIP64 条目的 EPUB 文件。');
            }
            if (offset + recordLength > centralDirectoryEnd || offset + recordLength < offset) {
                throw safetyError('EPUB 的 ZIP 条目长度无效。');
            }
            if (uncompressedBytes > limits.maxEntryUncompressedBytes) {
                throw safetyError(`EPUB 含有超过 ${(limits.maxEntryUncompressedBytes / 1024 / 1024).toFixed(0)} MB 的单个条目。`);
            }
            if (compressedBytes === 0 && uncompressedBytes > 0) {
                throw safetyError('EPUB 含有异常的空压缩条目。');
            }
            if (compressedBytes > 0 && uncompressedBytes / compressedBytes > limits.maxCompressionRatio) {
                throw safetyError(`EPUB 含有超过 ${limits.maxCompressionRatio}:1 的异常压缩条目。`);
            }

            totalUncompressedBytes += uncompressedBytes;
            if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
                throw safetyError(`EPUB 解压后预计超过 ${(limits.maxTotalUncompressedBytes / 1024 / 1024).toFixed(0)} MB，已拒绝解析。`);
            }
            offset += recordLength;
        }

        if (offset !== centralDirectoryEnd) {
            throw safetyError('EPUB 的 ZIP 目录长度不一致。');
        }
        return { entryCount, totalUncompressedBytes };
    }

    function withParseTimeout(promise, timeoutMs = LIMITS.parseTimeoutMs) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(safetyError(`EPUB 目录解析超过 ${Math.round(timeoutMs / 1000)} 秒，已停止打开。`)), timeoutMs);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    return { LIMITS, validateArchive, withParseTimeout };
}));
