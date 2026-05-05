/**
 * 公共工具函数
 */

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { execSync } = require('child_process');
const { BINARY_EXTENSIONS, ARCHIVE_EXTENSIONS, MAX_EXTRACT_SIZE } = require('./constants');
const projectRoot = path.resolve(__dirname, '..', '..');

/** 7z 路径缓存：undefined=未搜索, null=未找到, string=路径 */
let _cached7zPath = undefined;

/**
 * 查找 7z 可执行文件路径（带缓存）
 * @returns {string|null} 7z 路径，找不到返回 null
 */
function find7z() {
  if (_cached7zPath !== undefined) return _cached7zPath;

  const basePath = process.resourcesPath || projectRoot || process.cwd();
  const possiblePaths = [
    path.join(basePath, '7z', '7za.exe'),
    path.join(basePath, 'app', '7z', '7za.exe'),
    path.join(basePath, 'app', '7za.exe'),
    path.join(basePath, 'tools', '7z.exe'),
    path.join(process.cwd(), 'app', '7z', '7za.exe'),
    path.join(process.cwd(), '7z', '7za.exe'),
    path.join(process.cwd(), '7za.exe'),
    path.join(process.cwd(), 'tools', '7z.exe'),
    path.join(basePath, '7za.exe'),
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    '7z',
    '7za'
  ];

  for (const testPath of possiblePaths) {
    try {
      if (testPath !== '7z' && testPath !== '7za' && !fs.existsSync(testPath)) continue;
      execSync(`"${testPath}" --help`, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      _cached7zPath = testPath;
      console.log(`[find7z] 找到 7z: ${testPath}`);
      return testPath;
    } catch (e) {
      if (testPath !== '7z' && testPath !== '7za' && fs.existsSync(testPath)) {
        _cached7zPath = testPath;
        console.log(`[find7z] 通过文件存在性确认 7z: ${testPath}`);
        return testPath;
      }
      continue;
    }
  }

  console.log(`[find7z] 未找到 7z`);
  _cached7zPath = null;
  return null;
}

/**
 * 从 Buffer 中提取可读文本（支持包含部分二进制内容的文件）
 * @param {Buffer} buffer
 * @returns {{ content: string, encoding: string, isBinary: boolean }}
 */
function extractTextFromBuffer(buffer) {
  const sampleLen = Math.min(buffer.length, 32768);
  let nullCount = 0;
  for (let i = 0; i < sampleLen; i++) {
    if (buffer[i] === 0) nullCount++;
  }
  const nullRatio = sampleLen > 0 ? nullCount / sampleLen : 0;

  if (nullRatio < 0.01) {
    return { content: buffer.toString('utf-8'), encoding: 'utf-8', isBinary: false };
  }

  const text = buffer.toString('utf-8');
  const lines = text.split('\n');
  const textLines = [];
  let skippedCount = 0;
  for (const line of lines) {
    let nonPrintable = 0;
    for (let i = 0; i < line.length; i++) {
      const code = line.charCodeAt(i);
      if (code < 32 && code !== 9) {
        nonPrintable++;
      }
    }
    const lineLen = line.length || 1;
    if (nonPrintable / lineLen > 0.3) {
      skippedCount++;
      continue;
    }
    const cleaned = line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    if (cleaned.length > 0) {
      textLines.push(cleaned);
    }
  }

  if (textLines.length === 0) {
    return {
      content: `[二进制文件，无可读文本内容] (${(buffer.length / 1024).toFixed(1)}KB)`,
      encoding: 'binary',
      isBinary: true
    };
  }

  const prefix = skippedCount > 0
    ? `[混合文件，已提取 ${textLines.length} 行可读文本，跳过 ${skippedCount} 行二进制内容]\n`
    : '';
  return {
    content: prefix + textLines.join('\n'),
    encoding: 'utf-8',
    isBinary: true
  };
}

/**
 * 判断文件是否为二进制文件
 * @param {string} filePath - 文件路径
 */
function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.includes(ext);
}

/**
 * 判断文件是否为压缩包文件（含复合扩展名 .tar.gz 等）
 * @param {string} filePath - 文件路径
 */
function isArchiveFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const lower = filePath.toLowerCase();
  return ARCHIVE_EXTENSIONS.includes(ext) || lower.endsWith('.tar.gz') || lower.endsWith('.tar.bz2');
}

/**
 * 聚焦窗口（恢复最小化 + show + focus）
 * @param {Electron.BrowserWindow} win
 */
function focusWindowSafe(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * 递归复制目录
 * @param {string} source - 源路径（文件或目录）
 * @param {string} target - 目标路径
 */
function copyDirRecursive(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyDirRecursive(path.join(source, entry.name), path.join(target, entry.name));
    }
  } else {
    fs.copyFileSync(source, target);
  }
}

/**
 * 解析 ZIP 中央目录信息（含 Zip64 支持）
 * @param {number} fd - 已打开的文件描述符
 * @param {number} fileSize - 文件大小
 * @returns {{ cdEntryCount, cdSize, cdOffset }|null}
 */
function parseZipCentralDir(fd, fileSize) {
  const MAX_EOCD_SEARCH = 65557;
  const searchSize = Math.min(MAX_EOCD_SEARCH, fileSize);
  const tailBuffer = Buffer.alloc(searchSize);
  fs.readSync(fd, tailBuffer, 0, searchSize, fileSize - searchSize);

  let eocdOffset = -1;
  for (let i = tailBuffer.length - 22; i >= 0; i--) {
    if (tailBuffer[i] === 0x50 && tailBuffer[i + 1] === 0x4B &&
        tailBuffer[i + 2] === 0x05 && tailBuffer[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  let cdEntryCount = tailBuffer.readUInt16LE(eocdOffset + 10);
  let cdSize = tailBuffer.readUInt32LE(eocdOffset + 12);
  let cdOffset = tailBuffer.readUInt32LE(eocdOffset + 16);

  if (cdEntryCount === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
    const locatorOffset = eocdOffset - 20;
    if (locatorOffset >= 0 && tailBuffer.readUInt32LE(locatorOffset) === 0x07064b50) {
      const zip64EocdOffset = Number(tailBuffer.readBigUInt64LE(locatorOffset + 8));
      const zip64Buf = Buffer.alloc(56);
      fs.readSync(fd, zip64Buf, 0, 56, zip64EocdOffset);
      if (zip64Buf.readUInt32LE(0) === 0x06064b50) {
        cdEntryCount = Number(zip64Buf.readBigUInt64LE(24));
        cdSize = Number(zip64Buf.readBigUInt64LE(40));
        cdOffset = Number(zip64Buf.readBigUInt64LE(48));
      }
    }
  }

  return { cdEntryCount, cdSize, cdOffset };
}

/**
 * 解析中央目录条目的 Zip64 扩展字段，还原真实的大小和偏移
 */
function resolveZip64ExtraField(cdBuffer, entryStart, fileNameLength, extraFieldLength,
                                 compressedSize, uncompressedSize, localHeaderOffset) {
  if (extraFieldLength === 0) {
    return { compressedSize, uncompressedSize, localHeaderOffset };
  }

  const extraStart = entryStart + 46 + fileNameLength;
  const extraEnd = extraStart + extraFieldLength;
  let pos = extraStart;

  while (pos + 4 <= extraEnd) {
    const tag = cdBuffer.readUInt16LE(pos);
    const dataSize = cdBuffer.readUInt16LE(pos + 2);
    pos += 4;
    if (tag === 0x0001) {
      let fieldPos = pos;
      if (uncompressedSize === 0xFFFFFFFF && fieldPos + 8 <= pos + dataSize) {
        uncompressedSize = Number(cdBuffer.readBigUInt64LE(fieldPos));
        fieldPos += 8;
      }
      if (compressedSize === 0xFFFFFFFF && fieldPos + 8 <= pos + dataSize) {
        compressedSize = Number(cdBuffer.readBigUInt64LE(fieldPos));
        fieldPos += 8;
      }
      if (localHeaderOffset === 0xFFFFFFFF && fieldPos + 8 <= pos + dataSize) {
        localHeaderOffset = Number(cdBuffer.readBigUInt64LE(fieldPos));
        fieldPos += 8;
      }
      break;
    }
    pos += dataSize;
  }

  return { compressedSize, uncompressedSize, localHeaderOffset };
}

/**
 * 原生 ZIP 单文件提取核心逻辑（供 extract-zip-native 和 extract-file-from-archive 共用）
 */
function extractZipEntryNative(archivePath, filePath) {
  if (!fs.existsSync(archivePath)) {
    return { success: false, error: '压缩包不存在' };
  }

  const fileSize = fs.statSync(archivePath).size;
  const fd = fs.openSync(archivePath, 'r');

  try {
    const eocd = parseZipCentralDir(fd, fileSize);
    if (!eocd) return { success: false, error: '不是有效的 ZIP 文件' };

    const { cdEntryCount, cdSize, cdOffset } = eocd;
    const cdBuffer = Buffer.alloc(cdSize);
    fs.readSync(fd, cdBuffer, 0, cdSize, cdOffset);

    const targetPath = filePath.replace(/^\/+/, '').replace(/\\/g, '/');
    let localHeaderOffset = -1;
    let foundCompressedSize = 0;
    let foundUncompressedSize = 0;
    let foundCompressionMethod = 0;

    let pos = 0;
    for (let i = 0; i < cdEntryCount && pos < cdBuffer.length; i++) {
      if (cdBuffer.readUInt32LE(pos) !== 0x02014b50) break;

      let compressionMethod = cdBuffer.readUInt16LE(pos + 10);
      let compressedSize = cdBuffer.readUInt32LE(pos + 20);
      let uncompressedSize = cdBuffer.readUInt32LE(pos + 24);
      const fileNameLength = cdBuffer.readUInt16LE(pos + 28);
      const extraFieldLength = cdBuffer.readUInt16LE(pos + 30);
      const fileCommentLength = cdBuffer.readUInt16LE(pos + 32);
      let localHeaderOff = cdBuffer.readUInt32LE(pos + 42);

      if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localHeaderOff === 0xFFFFFFFF) {
        const resolved = resolveZip64ExtraField(cdBuffer, pos, fileNameLength, extraFieldLength,
          compressedSize, uncompressedSize, localHeaderOff);
        compressedSize = resolved.compressedSize;
        uncompressedSize = resolved.uncompressedSize;
        localHeaderOff = resolved.localHeaderOffset;
      }

      const entryName = cdBuffer.toString('utf8', pos + 46, pos + 46 + fileNameLength);
      const normalizedEntry = entryName.replace(/^\/+/, '').replace(/\\/g, '/');

      if (normalizedEntry === targetPath ||
          normalizedEntry.toLowerCase() === targetPath.toLowerCase()) {
        localHeaderOffset = localHeaderOff;
        foundCompressedSize = compressedSize;
        foundUncompressedSize = uncompressedSize;
        foundCompressionMethod = compressionMethod;
        break;
      }

      pos += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }

    if (localHeaderOffset === -1) {
      return { success: false, error: `文件未找到: ${filePath}` };
    }

    if (foundUncompressedSize > MAX_EXTRACT_SIZE) {
      return { success: false, error: `文件过大 (${(foundUncompressedSize / 1024 / 1024).toFixed(1)}MB)，单文件提取上限 50MB。请安装 7z。` };
    }

    const lfhBuffer = Buffer.alloc(30);
    fs.readSync(fd, lfhBuffer, 0, 30, localHeaderOffset);
    if (lfhBuffer.readUInt32LE(0) !== 0x04034b50) {
      return { success: false, error: '本地文件头签名无效' };
    }

    const lfhFileNameLength = lfhBuffer.readUInt16LE(26);
    const lfhExtraFieldLength = lfhBuffer.readUInt16LE(28);
    const dataOffset = localHeaderOffset + 30 + lfhFileNameLength + lfhExtraFieldLength;

    const compressedData = Buffer.alloc(foundCompressedSize);
    fs.readSync(fd, compressedData, 0, foundCompressedSize, dataOffset);

    let resultBuffer;
    if (foundCompressionMethod === 0) {
      resultBuffer = compressedData;
    } else if (foundCompressionMethod === 8) {
      resultBuffer = zlib.inflateRawSync(compressedData);
    } else {
      return { success: false, error: `不支持的压缩方式: ${foundCompressionMethod}，请安装 7z` };
    }

    const { content, encoding, isBinary } = extractTextFromBuffer(resultBuffer);
    return { success: true, content, encoding, isBinary };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  find7z,
  extractTextFromBuffer,
  isBinaryFile,
  isArchiveFile,
  focusWindowSafe,
  copyDirRecursive,
  parseZipCentralDir,
  resolveZip64ExtraField,
  extractZipEntryNative
};
