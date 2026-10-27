#!/usr/bin/env node

const assert = require('assert');
const { LIMITS, validateArchive, withParseTimeout } = require('../js/zip-safety.js');

function writeUint16(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = value >>> 8;
}

function writeUint32(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = value >>> 8;
    bytes[offset + 2] = value >>> 16;
    bytes[offset + 3] = value >>> 24;
}

// 只构造 ZIP 目录，不压入大内容；足以覆盖防护逻辑又不会拖慢测试。
function createZipDirectory(entries) {
    const names = entries.map((_, index) => `entry-${String(index).padStart(4, '0')}`);
    const localLength = names.reduce((total, name) => total + 30 + Buffer.byteLength(name), 0);
    const centralLength = names.reduce((total, name) => total + 46 + Buffer.byteLength(name), 0);
    const bytes = Buffer.alloc(localLength + centralLength + 22);
    const localOffsets = [];
    let offset = 0;

    entries.forEach((entry, index) => {
        const name = Buffer.from(names[index]);
        localOffsets.push(offset);
        writeUint32(bytes, offset, 0x04034b50);
        writeUint16(bytes, offset + 4, 20);
        writeUint32(bytes, offset + 18, entry.compressedBytes);
        writeUint32(bytes, offset + 22, entry.uncompressedBytes);
        writeUint16(bytes, offset + 26, name.length);
        name.copy(bytes, offset + 30);
        offset += 30 + name.length;
    });

    const centralDirectoryOffset = offset;
    entries.forEach((entry, index) => {
        const name = Buffer.from(names[index]);
        writeUint32(bytes, offset, 0x02014b50);
        writeUint16(bytes, offset + 4, 20);
        writeUint16(bytes, offset + 6, 20);
        writeUint32(bytes, offset + 20, entry.compressedBytes);
        writeUint32(bytes, offset + 24, entry.uncompressedBytes);
        writeUint16(bytes, offset + 28, name.length);
        writeUint32(bytes, offset + 42, localOffsets[index]);
        name.copy(bytes, offset + 46);
        offset += 46 + name.length;
    });

    const centralDirectorySize = offset - centralDirectoryOffset;
    writeUint32(bytes, offset, 0x06054b50);
    writeUint16(bytes, offset + 8, entries.length);
    writeUint16(bytes, offset + 10, entries.length);
    writeUint32(bytes, offset + 12, centralDirectorySize);
    writeUint32(bytes, offset + 16, centralDirectoryOffset);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function main() {
    assert.deepStrictEqual(
        validateArchive(createZipDirectory([{ compressedBytes: 10, uncompressedBytes: 100 }])),
        { entryCount: 1, totalUncompressedBytes: 100 }
    );
    assert.throws(
        () => validateArchive(createZipDirectory(Array.from({ length: LIMITS.maxEntries + 1 }, () => ({ compressedBytes: 0, uncompressedBytes: 0 })))),
        /超过 .*条目/
    );
    assert.throws(
        () => validateArchive(createZipDirectory([{ compressedBytes: 1, uncompressedBytes: LIMITS.maxEntryUncompressedBytes + 1 }])),
        /单个条目/
    );
    assert.throws(
        () => validateArchive(createZipDirectory([{ compressedBytes: 1, uncompressedBytes: LIMITS.maxCompressionRatio + 1 }])),
        /异常压缩/
    );
    assert.throws(
        () => validateArchive(new ArrayBuffer(11), Object.assign({}, LIMITS, { maxArchiveBytes: 10 })),
        /超过 .*MB 上限/
    );
    await assert.rejects(withParseTimeout(new Promise(() => {}), 10), /目录解析超过 0 秒/);

    console.log('ZIP 安全检查通过：正常目录与文件、条目、解压体积、压缩比与解析超时上限均已验证。');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
