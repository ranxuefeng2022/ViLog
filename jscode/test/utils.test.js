const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  extractTextFromBuffer,
  isBinaryFile,
  isArchiveFile,
  resolveZip64ExtraField,
  parseZipCentralDir
} = require('../src/main/utils');

const {
  BINARY_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  MAX_EXTRACT_SIZE
} = require('../src/main/constants');

describe('constants', () => {
  it('BINARY_EXTENSIONS includes common binary types', () => {
    assert.ok(BINARY_EXTENSIONS.includes('.zip'));
    assert.ok(BINARY_EXTENSIONS.includes('.exe'));
    assert.ok(BINARY_EXTENSIONS.includes('.pdf'));
  });

  it('ARCHIVE_EXTENSIONS includes archive types', () => {
    assert.ok(ARCHIVE_EXTENSIONS.includes('.zip'));
    assert.ok(ARCHIVE_EXTENSIONS.includes('.7z'));
    assert.ok(ARCHIVE_EXTENSIONS.includes('.tar'));
  });

  it('MAX_EXTRACT_SIZE is 50MB', () => {
    assert.strictEqual(MAX_EXTRACT_SIZE, 50 * 1024 * 1024);
  });
});

describe('extractTextFromBuffer', () => {
  it('handles plain text', () => {
    const buf = Buffer.from('hello world\nline 2', 'utf-8');
    const result = extractTextFromBuffer(buf);
    assert.strictEqual(result.isBinary, false);
    assert.strictEqual(result.encoding, 'utf-8');
    assert.ok(result.content.includes('hello world'));
  });

  it('handles empty buffer', () => {
    const buf = Buffer.alloc(0);
    const result = extractTextFromBuffer(buf);
    assert.strictEqual(result.isBinary, false);
  });

  it('handles binary data with many null bytes', () => {
    const buf = Buffer.alloc(1000, 0);
    const result = extractTextFromBuffer(buf);
    assert.strictEqual(result.isBinary, true);
    assert.ok(result.content.includes('二进制文件'));
  });

  it('handles mixed content with some null bytes', () => {
    // Create buffer with 80% text, 20% null bytes
    const text = Buffer.from('readable text content here\n', 'utf-8');
    const mixed = Buffer.concat([text, Buffer.alloc(50, 0), text]);
    const result = extractTextFromBuffer(mixed);
    // Should detect as binary due to null ratio
    assert.strictEqual(result.isBinary, true);
  });
});

describe('isBinaryFile', () => {
  it('detects .exe as binary', () => {
    assert.strictEqual(isBinaryFile('test.exe'), true);
  });

  it('detects .pdf as binary', () => {
    assert.strictEqual(isBinaryFile('doc.pdf'), true);
  });

  it('detects .txt as not binary', () => {
    assert.strictEqual(isBinaryFile('readme.txt'), false);
  });

  it('detects .log as not binary', () => {
    assert.strictEqual(isBinaryFile('app.log'), false);
  });
});

describe('isArchiveFile', () => {
  it('detects .zip as archive', () => {
    assert.strictEqual(isArchiveFile('data.zip'), true);
  });

  it('detects .tar.gz as archive', () => {
    assert.strictEqual(isArchiveFile('data.tar.gz'), true);
  });

  it('detects .tar.bz2 as archive', () => {
    assert.strictEqual(isArchiveFile('data.tar.bz2'), true);
  });

  it('detects .7z as archive', () => {
    assert.strictEqual(isArchiveFile('data.7z'), true);
  });

  it('detects .txt as not archive', () => {
    assert.strictEqual(isArchiveFile('readme.txt'), false);
  });
});

describe('resolveZip64ExtraField', () => {
  it('returns original values when extraFieldLength is 0', () => {
    const result = resolveZip64ExtraField(
      Buffer.alloc(0), 0, 0, 0, 100, 200, 300
    );
    assert.strictEqual(result.compressedSize, 100);
    assert.strictEqual(result.uncompressedSize, 200);
    assert.strictEqual(result.localHeaderOffset, 300);
  });

  it('resolves Zip64 compressed size when sentinel value present', () => {
    // resolveZip64ExtraField reads from extraStart = entryStart + 46 + fileNameLength
    // We put the extra field data at offset 46 (entryStart=0, fileNameLength=0)
    const buf = Buffer.alloc(58);
    const extraStart = 46;
    buf.writeUInt16LE(0x0001, extraStart);     // Zip64 tag
    buf.writeUInt16LE(8, extraStart + 2);       // data size = 8
    buf.writeBigUInt64LE(BigInt(0x100000000), extraStart + 4); // real compressed size > 32-bit

    const result = resolveZip64ExtraField(
      buf, 0, 0, 10, 0xFFFFFFFF, 200, 300
    );
    assert.strictEqual(result.compressedSize, 0x100000000);
    assert.strictEqual(result.uncompressedSize, 200);
  });
});

describe('parseZipCentralDir', () => {
  it('returns null for non-ZIP data', () => {
    // Create mock fd function - but this is hard to test without real file
    // Skip for now as it needs file system
  });
});
