const { app, BrowserWindow, Menu, Tray, ipcMain, shell, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Worker } = require('worker_threads');
const { spawn, exec } = require('child_process');
const os = require('os');

// =====================================================================
// 🚀 公共常量与工具函数
// =====================================================================

/** 二进制文件扩展名（用于判断是否用 base64 编码） */
const BINARY_EXTENSIONS = [
  '.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.tgz',
  '.exe', '.dll', '.so', '.dylib',
  '.png', '.jpg', '.jpeg', '.gif', '.pdf',
  '.doc', '.docx', '.xls', '.xlsx', '.mp3', '.mp4', '.avi'
];

/** 压缩包扩展名（用于判断是否是归档文件） */
const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.tar', '.gz', '.tgz', '.rar', '.bz2', '.xz'];

/**
 * 从 Buffer 中提取可读文本（支持包含部分二进制内容的文件）
 * - 计算前 32KB 的 null 字节比率判断文件类型
 * - 纯文本文件：直接 UTF-8 解码
 * - 混合/二进制文件：逐行提取可读文本行，跳过纯二进制行
 * @param {Buffer} buffer
 * @returns {{ content: string, encoding: string, isBinary: boolean }}
 */
function extractTextFromBuffer(buffer) {
  // 采样前 32KB 判断 null 字节比率
  const sampleLen = Math.min(buffer.length, 32768);
  let nullCount = 0;
  for (let i = 0; i < sampleLen; i++) {
    if (buffer[i] === 0) nullCount++;
  }
  const nullRatio = sampleLen > 0 ? nullCount / sampleLen : 0;

  // 纯文本文件（null 字节极少）：直接 UTF-8 解码
  if (nullRatio < 0.01) {
    return { content: buffer.toString('utf-8'), encoding: 'utf-8', isBinary: false };
  }

  // 混合/二进制文件：尝试 UTF-8 解码，替换不可显示字符
  const text = buffer.toString('utf-8');

  // 按行过滤：只保留可读文本行（至少含一个可打印字符）
  const lines = text.split('\n');
  const textLines = [];
  let skippedCount = 0;
  for (const line of lines) {
    // 统计不可打印字符比率（排除换行/制表符等常用控制字符）
    let nonPrintable = 0;
    for (let i = 0; i < line.length; i++) {
      const code = line.charCodeAt(i);
      // 允许：TAB(9), LF(10), CR(13), 可打印 ASCII(32-126), 以及 Unicode(>=160)
      if (code < 32 && code !== 9) {
        nonPrintable++;
      }
    }
    const lineLen = line.length || 1;
    // 如果不可打印字符占比超过 30%，视为二进制行跳过
    if (nonPrintable / lineLen > 0.3) {
      skippedCount++;
      continue;
    }
    // 清理行中残留的替换字符(FFFD)和零宽字符
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

/** 7z 路径缓存：undefined=未搜索, null=未找到, string=路径 */
let _cached7zPath = undefined;

/**
 * 查找 7z 可执行文件路径（带缓存）
 * @returns {string|null} 7z 路径，找不到返回 null
 */
function find7z() {
  if (_cached7zPath !== undefined) return _cached7zPath;

  const basePath = process.resourcesPath || __dirname || process.cwd();
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
      // 使用 --help 参数测试，避免无参数执行时返回非零退出码导致误判
      execSync(`"${testPath}" --help`, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      _cached7zPath = testPath;
      console.log(`[find7z] 找到 7z: ${testPath}`);
      return testPath;
    } catch (e) {
      // --help 也可能返回非零退出码，尝试用文件存在性作为回退检测
      // 对于本地路径（非系统 PATH 中的命令），如果文件存在就认为是有效的
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

  // 查找 EOCD 签名: 0x06054b50 (PK\x05\x06)
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

  // Zip64 检测：16/32 位最大值为哨兵值，需从 Zip64 EOCD 读取真实值
  if (cdEntryCount === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
    // Zip64 EOCD Locator 在常规 EOCD 之前 20 字节，签名 0x07064b50
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
    if (tag === 0x0001) { // Zip64 extended information
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
  const zlib = require('zlib');
  const MAX_EXTRACT_SIZE = 50 * 1024 * 1024;

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

    // 标准化目标路径
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

      // Zip64 扩展字段解析
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

    // 读取本地文件头
    const lfhBuffer = Buffer.alloc(30);
    fs.readSync(fd, lfhBuffer, 0, 30, localHeaderOffset);
    if (lfhBuffer.readUInt32LE(0) !== 0x04034b50) {
      return { success: false, error: '本地文件头签名无效' };
    }

    const lfhFileNameLength = lfhBuffer.readUInt16LE(26);
    const lfhExtraFieldLength = lfhBuffer.readUInt16LE(28);
    const dataOffset = localHeaderOffset + 30 + lfhFileNameLength + lfhExtraFieldLength;

    // 读取并解压
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

    // 使用统一的文本提取函数处理（支持混合二进制/文本文件）
    const { content, encoding, isBinary } = extractTextFromBuffer(resultBuffer);
    return { success: true, content, encoding, isBinary };
  } finally {
    fs.closeSync(fd);
  }
}

// =====================================================================
// 🚀 远程目录共享服务器模块
// =====================================================================
// 本地服务器：用于共享本地目录给远程用户
// 远程客户端：用于访问远程用户共享的目录

let localServer = null;
let localServerPort = 0;
let localSharePath = '';
let localServerConnections = new Set(); // 跟踪活跃连接

// 递归获取目录内容
function getDirectoryContents(dirPath, basePath = '') {
  const result = {
    directories: [],
    files: []
  };

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        result.directories.push({
          name: entry.name,
          path: relativePath
        });
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          result.files.push({
            name: entry.name,
            path: relativePath,
            size: stats.size,
            mtime: stats.mtime.toISOString()
          });
        } catch (e) {
          // 忽略无法访问的文件
        }
      }
    }
  } catch (error) {
    console.error(`[远程共享] 读取目录失败: ${dirPath}`, error.message);
  }

  // 排序：目录在前，文件在后，各按名称排序
  result.directories.sort((a, b) => a.name.localeCompare(b.name));
  result.files.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}

// 递归获取完整目录树（用于首次加载）
function getDirectoryTree(dirPath, basePath = '', depth = 3, currentDepth = 0) {
  if (currentDepth >= depth) {
    return { directories: [], files: [] };
  }

  const result = getDirectoryContents(dirPath, basePath);

  // 递归获取子目录
  for (const dir of result.directories) {
    const fullPath = path.join(dirPath, dir.name);
    const children = getDirectoryTree(fullPath, dir.name, depth, currentDepth + 1);
    dir.children = children;
  }

  return result;
}

// 启动本地共享服务器
function startLocalServer(sharePath, port = 8080) {
  return new Promise((resolve, reject) => {
    if (localServer) {
      // 已经运行，先停止
      stopLocalServer();
    }

    localSharePath = sharePath;

    // 创建 HTTP 服务器
    localServer = http.createServer((req, res) => {
      // CORS 头
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      try {
        const url = new URL(req.url, `http://localhost:${localServerPort}`);
        const action = url.pathname;
        const queryPath = url.searchParams.get('path') || '';

        console.log(`[远程共享] 请求: ${action}, path: ${queryPath}`);

        if (action === '/api/info') {
          // 获取共享信息
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            sharePath: localSharePath,
            rootName: path.basename(localSharePath)
          }));
        } else if (action === '/api/list') {
          // 获取目录列表
          const targetPath = queryPath ? path.join(localSharePath, queryPath) : localSharePath;
          const contents = getDirectoryContents(targetPath, queryPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            path: queryPath,
            ...contents
          }));
        } else if (action === '/api/tree') {
          // 获取完整目录树（用于首次加载）
          const targetPath = queryPath ? path.join(localSharePath, queryPath) : localSharePath;
          const tree = getDirectoryTree(targetPath, queryPath, 3, 0);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            path: queryPath,
            ...tree
          }));
        } else if (action === '/api/read') {
          // 读取文件内容
          const targetPath = queryPath ? path.join(localSharePath, queryPath) : localSharePath;
          if (!queryPath || !fs.existsSync(targetPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '文件不存在' }));
            return;
          }

          const stats = fs.statSync(targetPath);
          const size = stats.size;

          // 🚀 检查文件扩展名，判断是否是二进制文件
          const isBinary = isBinaryFile(targetPath);

          // 对于大文件或二进制文件，使用 base64 编码
          if (size > 10 * 1024 * 1024 || isBinary) {
            // 读取为 Buffer 并转换为 base64
            const content = fs.readFileSync(targetPath); // 不指定编码，返回 Buffer
            const base64Content = content.toString('base64');
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'X-Content-Transfer-Encoding': 'base64'
            });
            res.end(JSON.stringify({
              success: true,
              content: base64Content,
              encoding: 'base64',
              size: size
            }));
          } else {
            // 小文件文本文件直接读取
            const content = fs.readFileSync(targetPath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(content);
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '未知操作' }));
        }
      } catch (error) {
        console.error('[远程共享] 处理请求失败:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    });

    localServer.on('connection', (conn) => {
      localServerConnections.add(conn);
      conn.on('close', () => localServerConnections.delete(conn));
    });

    localServer.on('error', (err) => {
      console.error('[远程共享] 服务器错误:', err);
      reject(err);
    });

    // 尝试绑定端口
    localServer.listen(port, '0.0.0.0', () => {
      localServerPort = localServer.address().port;
      console.log(`[远程共享] 服务器已启动: 0.0.0.0:${localServerPort}`);
      console.log(`[远程共享] 共享目录: ${localSharePath}`);
      resolve({
        port: localServerPort,
        ip: getLocalIP()
      });
    });

    // 如果端口被占用，自动尝试其他端口
    localServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        localServer.close();
        localServer.listen(0, '0.0.0.0', () => {
          localServerPort = localServer.address().port;
          console.log(`[远程共享] 服务器已启动: 0.0.0.0:${localServerPort}`);
          console.log(`[远程共享] 共享目录: ${localSharePath}`);
          resolve({
            port: localServerPort,
            ip: getLocalIP()
          });
        });
      }
    });
  });
}

// 停止本地服务器
function stopLocalServer() {
  return new Promise((resolve) => {
    if (localServer) {
      // 关闭所有活跃连接
      for (const conn of localServerConnections) {
        conn.destroy();
      }
      localServerConnections.clear();

      localServer.close(() => {
        console.log('[远程共享] 服务器已停止');
        localServer = null;
        localServerPort = 0;
        localSharePath = '';
        resolve(true);
      });
    } else {
      resolve(true);
    }
  });
}

// 获取本机 IP 地址
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// 检查本地服务器是否运行
function isLocalServerRunning() {
  return localServer !== null;
}

// 获取本地服务器信息
function getLocalServerInfo() {
  if (!localServer) {
    return null;
  }
  return {
    running: true,
    port: localServerPort,
    ip: getLocalIP(),
    sharePath: localSharePath
  };
}

// =====================================================================
// 🚀 远程连接客户端模块
// =====================================================================

function listRemoteDirectory(ip, port, remotePath = '') {
  return new Promise((resolve, reject) => {
    const url = `http://${ip}:${port}/api/list?path=${encodeURIComponent(remotePath)}`;

    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(new Error('解析响应失败'));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

function readRemoteFile(ip, port, remotePath) {
  return new Promise((resolve, reject) => {
    const url = `http://${ip}:${port}/api/read?path=${encodeURIComponent(remotePath)}`;

    http.get(url, (res) => {
      if (res.statusCode === 404) {
        resolve({ success: false, error: '文件不存在' });
        return;
      }

      // 检查 Content-Type
      const contentType = res.headers['content-type'];
      const chunks = [];

      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);

        // 如果返回的是 JSON（二进制文件）
        if (contentType && contentType.includes('application/json')) {
          try {
            const result = JSON.parse(data.toString('utf8'));
            resolve(result);
          } catch (e) {
            reject(new Error('解析响应失败'));
          }
        } else {
          // 文本文件，直接返回内容
          const content = data.toString('utf8');
          resolve({ success: true, content });
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

function getRemoteTree(ip, port, remotePath = '') {
  return new Promise((resolve, reject) => {
    const url = `http://${ip}:${port}/api/tree?path=${encodeURIComponent(remotePath)}`;

    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(new Error('解析响应失败'));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// 全局变量：存储最近拖拽的文件路径
let droppedFilePath = '';

// 🔧 全局变量：存储最近访问的目录路径（用于智能搜索优先级）
// 最多保存 10 个最近访问的目录
let recentDirectories = [];
const MAX_RECENT_DIRS = 10;

// 记录最近访问的目录
function addRecentDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return;

  // 规范化路径
  dirPath = path.resolve(dirPath);

  // 移除已存在的相同路径（会把旧的移到前面）
  recentDirectories = recentDirectories.filter(d => d !== dirPath);

  // 添加到开头
  recentDirectories.unshift(dirPath);

  // 限制数量
  if (recentDirectories.length > MAX_RECENT_DIRS) {
    recentDirectories = recentDirectories.slice(0, MAX_RECENT_DIRS);
  }

  console.log(`📂 记录最近访问目录: ${dirPath}`);
  console.log(`📂 最近目录列表:`, recentDirectories);
}

// 从文件路径中提取父目录
function extractParentDirectory(filePath) {
  if (!filePath) return null;

  const parsedPath = path.parse(filePath);
  if (parsedPath.dir) {
    return parsedPath.dir;
  }
  return null;
}

// =====================================================================
// 🚀 内存优化配置 - 在 app ready 之前设置
// =====================================================================

// V8 堆内存设置（与 renderer 中 MAX_MEMORY_MB=600 对齐）
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1024');

// 禁用不必要的 GPU 功能
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-software-rasterizer');

// 禁用不需要的功能
app.commandLine.appendSwitch('disable-print-preview');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// 启用 V8 代码缓存（加速重复加载）
app.commandLine.appendSwitch('v8-cache-options', 'code');
app.commandLine.appendSwitch('enable-features', 'V8CacheStrategiesForCacheStorage,PartiallyV8CacheCompile');

// 减少渲染进程内存占用
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor,UseSkiaRenderer');

// 禁用后台任务和预加载
app.commandLine.appendSwitch('no-bg-cache-no-preload');

// =====================================================================
// 🚀 单实例模式 - 防止多开占用内存
// =====================================================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('⚠️ 已有实例运行，退出当前实例');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('📂 收到文件，传递到现有窗口');
    // 文件会传递到现有实例，阻止第二个实例启动
    if (windows.length > 0) {
      focusWindowSafe(BrowserWindow.getFocusedWindow() || windows[0]);
    }
  });
}

// =====================================================================

// 尝试加载 chokidar，如果不存在则禁用文件监控功能
let chokidar = null;
try {
  chokidar = require('chokidar');
} catch (error) {
  console.warn('chokidar 模块未找到，文件监控功能将被禁用');
}

let mainWindow;
let tray = null;
let fileWatchers = new Map(); // 文件监控器映射
let appIsQuiting = false; // 应用是否正在退出
let windows = []; // 存储所有窗口
let windowIdCounter = 0; // 窗口ID计数器
let pendingFiles = []; // 待处理的文件（窗口最小化时拖放的文件）
let engineProcess = null; // Windows 服务端进程
const ENGINE_PORT = 8082; // 服务端端口
let cachedPythonCommand = null; // 缓存的Python命令，避免重复检测
global.uartProcessMap = new Map(); // 窗口ID到UART进程的映射

// 日志系统
let logFilePath = null;
let logWriteStream = null;
const LOG_MAX_SIZE = 10 * 1024 * 1024; // 10MB

// 初始化日志系统
function initLogSystem() {
  const os = require('os');
  const logsDir = path.join(app.getPath('userData'), 'logs');

  // 确保日志目录存在
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // 创建日志文件（带时间戳）
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  logFilePath = path.join(logsDir, `logview_${timestamp}.log`);

  // 创建写入流
  logWriteStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  // 拦截主进程的console
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args) => {
    originalLog.apply(console, args);
    writeToLog('INFO', args);
  };

  console.error = (...args) => {
    originalError.apply(console, args);
    writeToLog('ERROR', args);
  };

  console.warn = (...args) => {
    originalWarn.apply(console, args);
    writeToLog('WARN', args);
  };

  // 记录启动信息
  writeToLog('SYSTEM', ['=== LogView 启动 ===']);
  writeToLog('SYSTEM', [`日志文件: ${logFilePath}`]);
  writeToLog('SYSTEM', [`平台: ${os.platform()}`, `架构: ${os.arch()}`, `Node: ${process.version}`]);
}

// 写入日志
function writeToLog(level, args) {
  if (!logWriteStream) return;

  try {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const logLine = `[${timestamp}] [${level}] ${message}\n`;

    // 检查文件大小，超过限制则创建新文件
    try {
      const stats = fs.statSync(logFilePath);
      if (stats.size > LOG_MAX_SIZE) {
        logWriteStream.close();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        logFilePath = path.join(app.getPath('userData'), 'logs', `logview_${timestamp}.log`);
        logWriteStream = fs.createWriteStream(logFilePath, { flags: 'a' });
      }
    } catch (e) {
      // 文件不存在，不需要检查大小
    }

    logWriteStream.write(logLine);
  } catch (error) {
    // 日志写入失败，不要打印错误避免无限循环
  }
}

// 关闭日志系统
function closeLogSystem() {
  if (logWriteStream) {
    writeToLog('SYSTEM', ['=== LogView 关闭 ===']);
    logWriteStream.end();
    logWriteStream = null;
  }
}

// 检测Python命令（性能优化：启动时检测一次并缓存）
function detectPythonCommand() {
  if (cachedPythonCommand) {
    console.log(`使用缓存的Python命令: ${cachedPythonCommand}`);
    return cachedPythonCommand;
  }

  const pythonCommands = ['python3', 'python', 'python3.exe', 'python.exe'];
  const { execSync } = require('child_process');

  for (const cmd of pythonCommands) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 2000 });
      cachedPythonCommand = cmd;
      console.log(`✓ 检测到Python命令: ${cachedPythonCommand}`);
      return cachedPythonCommand;
    } catch (e) {
      continue;
    }
  }

  console.warn('⚠️ 未找到Python命令，UTC转换功能可能不可用');
  return null;
}

// 启动 Windows 服务端进程
function startEngineProcess() {
  // 检查是否是 Windows 平台
  if (process.platform !== 'win32') {
    console.log('非 Windows 平台，跳过启动服务端进程');
    return;
  }

  // 检查 vivo_log_engine.exe 是否存在
  const enginePath = path.join(__dirname, 'vivo_log_engine.exe');

  if (!fs.existsSync(enginePath)) {
    console.warn('服务端程序不存在:', enginePath);
    console.warn('请运行 build-engine.bat 编译服务端程序');
    return;
  }

  // 检查端口是否被占用（只检查 LISTENING 状态）
  exec(`netstat -ano | findstr "LISTENING" | findstr ":${ENGINE_PORT}"`, (error, stdout) => {
    if (stdout && stdout.trim()) {
      console.log(`端口 ${ENGINE_PORT} 已被占用，跳过启动服务端`);
      return;
    }

    // 启动服务端进程
    console.log('正在启动服务端进程...');
    engineProcess = spawn(enginePath, [ENGINE_PORT.toString()], {
      windowsHide: true, // 隐藏控制台窗口
      detached: false
    });

    engineProcess.on('error', (err) => {
      console.error('启动服务端进程失败:', err);
    });

    engineProcess.stdout.on('data', (data) => {
      console.log('[服务端]', data.toString());
    });

    engineProcess.stderr.on('data', (data) => {
      console.error('[服务端错误]', data.toString());
    });

    engineProcess.on('close', (code) => {
      console.log(`服务端进程退出，代码: ${code}`);
      engineProcess = null;
    });

    // 等待一小段时间后检查进程是否启动成功
    setTimeout(() => {
      if (engineProcess && !engineProcess.killed) {
        console.log(`服务端进程已启动，PID: ${engineProcess.pid}`);
      }
    }, 1000);
  });
}

// 停止服务端进程
function stopEngineProcess() {
  if (engineProcess && !engineProcess.killed) {
    console.log('正在停止服务端进程...');
    engineProcess.kill('SIGTERM');
    // 如果进程在 5 秒内没有退出，强制杀死
    setTimeout(() => {
      if (engineProcess && !engineProcess.killed) {
        console.log('强制停止服务端进程...');
        engineProcess.kill('SIGKILL');
      }
    }, 5000);
  }
}

function createWindow(options = {}) {
  // 分配窗口序号（用于显示标题）
  const windowNumber = windows.length + 1;
  const windowTitle = '窗口' + windowNumber;

  // 创建浏览器窗口
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    frame: false, // 无边框窗口
    autoHideMenuBar: true, // 自动隐藏菜单栏
    backgroundColor: '#1e1e1e', // 背景色，配合主题
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true, // 🚀 启用沙箱模式（安全 + 内存优化）
      webSecurity: false, // 允许加载本地文件
      allowRunningInsecureContent: true,
      preload: path.join(__dirname, 'preload.js'), // 添加 preload 脚本

      // 🚀 内存优化选项
      spellcheck: false, // 禁用拼写检查
      plugins: false, // 禁用插件（如 Flash）
      webGL: false, // 禁用 WebGL（如果不需要 3D）
      // 注意：禁用某些功能可能影响性能，根据实际需求调整
    },
    icon: path.join(__dirname, 'icons', 'icon.ico'), // Windows 图标（如果存在）
    show: false, // 先不显示，等加载完成后再显示
    title: options.title || windowTitle // 设置窗口标题
  });

  // 分配窗口ID
  const windowId = ++windowIdCounter;
  win.windowId = windowId;
  win.windowNumber = windowNumber; // 存储窗口序号

  // 获取 index.html 的路径（拆分后的新版本）
  const htmlPath = path.join(__dirname, 'index.html');
  const preloadPath = path.join(__dirname, 'preload.js');

  // 调试：打印路径信息
  console.log('=== 创建窗口 ===');
  console.log('__dirname:', __dirname);
  console.log('html 路径:', htmlPath);
  console.log('preload 路径:', preloadPath);
  console.log('preload 文件存在:', fs.existsSync(preloadPath));

  // 检查文件是否存在
  if (fs.existsSync(htmlPath)) {
    // 加载 index.html 文件（拆分后的新版本）
    win.loadFile(htmlPath);
  } else {
    // 如果文件不存在，显示错误页面
    win.loadURL('data:text/html,<h1>错误：找不到 index.html 文件</h1>');
  }

  // 窗口准备好后显示
  win.once('ready-to-show', () => {
    // 开发模式下不再自动打开开发者工具
    // 如需调试，请按 F12 手动打开
    win.maximize();
    win.show();
  });

  // 监听原生窗口的拖拽事件（使用事件拦截）
  win.on('blur', () => {
    // 窗口失去焦点时重置
  });

  // 使用 executeJavaScript 尝试获取拖拽数据
  let pendingDrop = null;

  // 注册快捷键打开开发者工具 (Ctrl+Shift+I, F12)
  win.on('app-command', (e, cmd) => {
    // Windows浏览器命令
    if (cmd === 'browser-devtools-focus') {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools();
      }
    }
  });

  // 监听来自渲染进程的消息
  win.webContents.on('did-finish-load', () => {
    console.log('页面加载完成，开始检查 electronAPI...');
    // 延迟检查，给 preload 脚本一些时间
    setTimeout(() => {
      win.webContents.executeJavaScript('typeof window.electronAPI')
        .then(result => {
          console.log('渲染进程中的 electronAPI 类型:', result);
        })
        .catch(err => {
          console.error('检查 electronAPI 时出错:', err);
        });
    }, 100);

    // 设置 IPC 通信
    setupIPCForWindow(win);
    // 发送窗口ID到渲染进程
    win.webContents.send('window-init', { windowId, windowNumber, title: windowTitle });
    // 通知所有窗口更新窗口列表
    broadcastWindowList();
  });

  // 窗口关闭时从列表中移除
  win.on('closed', () => {
    windows = windows.filter(w => w.windowId !== windowId);
    broadcastWindowList();
    // 如果这是主窗口
    if (win === mainWindow) {
      mainWindow = null;
    }
    // 清理该窗口关联的临时目录
    try {
      const rendererId = win.webContents?.id;
      if (rendererId && rendererTempDirs.has(rendererId)) {
        const tempDir = rendererTempDirs.get(rendererId);
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
        rendererTempDirs.delete(rendererId);
      }
    } catch (e) {
      console.error('[cleanup] 清理临时目录失败:', e);
    }
  });

  // 添加到窗口列表
  windows.push(win);

  // 如果是第一个窗口，设为主窗口
  if (!mainWindow) {
    mainWindow = win;
  }

  return win;
}

// 为单个窗口设置IPC通信
// 注意：窗口控制的 IPC 处理器已经在文件顶部全局注册，这里可以留空或添加窗口特定的处理
function setupIPCForWindow(win) {
  // 窗口特定的 IPC 处理可以在这里添加
  // 大部分 IPC 处理器已经在全局注册，无需重复注册
}

// 广播窗口列表到所有窗口
function broadcastWindowList() {
  const windowList = windows.map(w => ({
    id: w.windowId,
    windowNumber: w.windowNumber,
    title: '窗口' + w.windowNumber,
    isFocused: w.isFocused()
  }));

  windows.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-list-updated', windowList);
    }
  });
}

// 切换到指定窗口
function focusWindow(windowId) {
  const win = windows.find(w => w.windowId === windowId);
  focusWindowSafe(win);
}

// 设置 IPC 通信
function setupIPC() {
  if (!mainWindow) {
    return; // 窗口未创建，跳过
  }
  
  // 处理大文件解析请求
  ipcMain.handle('parse-large-file', async (event, filePath) => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'workers', 'log-parser-worker.js'), {
        workerData: { filePath }
      });
      
      const results = [];
      
      worker.on('message', (data) => {
        if (data.type === 'progress') {
          // 发送进度到渲染进程
          mainWindow.webContents.send('parse-progress', data.progress);
        } else if (data.type === 'complete') {
          resolve(data.result);
          worker.terminate();
        } else if (data.type === 'error') {
          reject(new Error(data.error));
          worker.terminate();
        }
      });
      
      worker.on('error', (error) => {
        reject(error);
        worker.terminate();
      });
    });
  });
  
  // 处理文件监控请求
  ipcMain.handle('watch-file', (event, filePath) => {
    if (!chokidar) {
      console.warn('文件监控功能不可用：chokidar 模块未加载');
      return;
    }
    
    if (fileWatchers.has(filePath)) {
      return; // 已经在监控
    }
    
    try {
      const watcher = chokidar.watch(filePath, {
        persistent: true,
        ignoreInitial: true
      });
      
      watcher.on('change', (path) => {
        // 文件变化时通知渲染进程
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-changed', { filePath: path });
        }
      });
      
      watcher.on('unlink', (path) => {
        // 文件删除时通知渲染进程
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-deleted', { filePath: path });
        }
        fileWatchers.delete(path);
        watcher.close();
      });
      
      fileWatchers.set(filePath, watcher);
    } catch (error) {
      console.error('文件监控失败:', error);
    }
  });
  
  // 停止文件监控
  ipcMain.handle('unwatch-file', (event, filePath) => {
    const watcher = fileWatchers.get(filePath);
    if (watcher) {
      watcher.close();
      fileWatchers.delete(filePath);
    }
  });
}

// 全局IPC处理器（在app.whenReady之前注册）

// 窗口控制 IPC 通信
ipcMain.on('window-minimize', () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) focusedWindow.minimize();
});

ipcMain.on('window-minimize-all', () => {
  windows.forEach(win => {
    if (!win.isDestroyed()) {
      win.minimize();
    }
  });
});

ipcMain.handle('window-maximize', () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) {
    if (focusedWindow.isMaximized()) {
      focusedWindow.unmaximize();
    } else {
      focusedWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && windows.length > 1) {
    // 如果有多个窗口，只关闭当前窗口
    focusedWindow.close();
  } else if (focusedWindow) {
    // 如果只有一个窗口，关闭应用
    appIsQuiting = true;
    focusedWindow.close();
  }
});

ipcMain.handle('window-is-maximized', () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  return focusedWindow ? focusedWindow.isMaximized() : false;
});

// 调整窗口大小
ipcMain.on('window-resize', (event, width, height) => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) {
    focusedWindow.setSize(width, height);
  }
});

// 设置窗口边界（位置和大小）
ipcMain.handle('window-set-bounds', (event, bounds) => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) {
    focusedWindow.setBounds(bounds);
  }
});

// 获取窗口边界
ipcMain.handle('window-get-bounds', () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  return focusedWindow ? focusedWindow.getBounds() : null;
});

// 创建新窗口
ipcMain.handle('create-new-window', (event, options) => {
  const newWindow = createWindow(options);
  return { windowId: newWindow.windowId };
});

// 打开vlog图表可视化窗口
ipcMain.handle('open-vlog-chart-window', async (event, data) => {
  try {
    const win = createWindow({
      title: 'Vlog电池数据可视化',
      width: 1400,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, 'preload-vlog-chart.js')
      }
    });

    // 加载HTML文件
    const htmlPath = path.join(__dirname, 'vlog-chart.html');
    await win.loadFile(htmlPath);

    // 等待窗口加载完成后发送数据
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('vlog-data', data);
    });

    return { success: true, windowId: win.windowId };
  } catch (error) {
    console.error('打开vlog图表窗口失败:', error);
    return { success: false, error: error.message };
  }
});

// 打开串口日志窗口
ipcMain.handle('open-uart-log-window', async (event) => {
  let win;
  let logWriteStream = null;

  try {
    win = createWindow({
      title: '串口日志分析器',
      width: 1200,
      height: 800
    });

    const windowId = win.windowId;

    // 创建日志保存目录和文件
    const logDir = 'C:\\串口日志';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19).replace('T', '_');
    const logFileName = `uart_log_${timestamp}.txt`;
    const logFilePath = path.join(logDir, logFileName);

    try {
      // 确保目录存在
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // 创建写入流
      logWriteStream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf8' });
      console.log('串口日志文件:', logFilePath);
    } catch (error) {
      console.error('创建日志文件失败:', error);
    }

    // 窗口关闭时清理进程和文件流（立即绑定）
    win.on('closed', () => {
      // 关闭文件写入流
      if (logWriteStream) {
        try {
          logWriteStream.end();
          console.log('日志文件已保存:', logFilePath);
        } catch (e) {
          console.error('关闭日志文件失败:', e);
        }
      }

      // 终止串口进程
      if (global.uartProcessMap.has(windowId)) {
        const process = global.uartProcessMap.get(windowId);
        try {
          process.kill();
        } catch (e) {
          console.error('终止串口进程失败:', e);
        }
        global.uartProcessMap.delete(windowId);
      }
    });

    // 使用 Promise.race 设置超时，避免永久等待
    const loadPromise = new Promise((resolve) => {
      // 检查窗口是否已经加载完成
      if (!win.webContents.isLoading()) {
        resolve();
        return;
      }

      // 如果还在加载，等待 did-finish-load 事件
      win.once('did-finish-load', () => {
        resolve();
      });
    });

    // 设置超时保护（3秒）
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve(), 3000);
    });

    // 等待任意一个 Promise 完成
    await Promise.race([loadPromise, timeoutPromise]);

    // 再等待一小段时间确保 JS 初始化完成
    await new Promise(resolve => setTimeout(resolve, 500));

    // 自动启动串口日志接收
    const { spawn } = require('child_process');
    const uartScriptPath = 'uart.py'; // 使用相对路径

    // 检查uart.py是否存在
    const fullUartPath = path.join(__dirname, uartScriptPath);
    if (!fs.existsSync(fullUartPath)) {
      return { windowId, success: false, error: 'uart.py脚本不存在' };
    }

    // 使用检测到的Python命令
    const pythonCommand = detectPythonCommand();
    if (!pythonCommand) {
      return { windowId, success: false, error: '未找到Python命令' };
    }

    const uartProcess = spawn(pythonCommand, [uartScriptPath], {
      cwd: __dirname,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'] // 确保标准输出和错误输出是管道
    });

    console.log('串口日志进程已启动，PID:', uartProcess.pid);

    // 存储进程引用
    global.uartProcessMap.set(windowId, uartProcess);

    // 监听标准输出
    uartProcess.stdout.on('data', (data) => {
      const text = data.toString();
      // 实时将新数据发送到窗口
      if (!win.isDestroyed()) {
        win.webContents.send('uart-log-data', text);
      }
      // 同时写入文件
      if (logWriteStream) {
        logWriteStream.write(text);
      }
    });

    // 监听标准错误
    uartProcess.stderr.on('data', (data) => {
      const errorText = data.toString();
      // 将 stderr 也当作日志数据发送
      if (!win.isDestroyed()) {
        win.webContents.send('uart-log-data', errorText);
      }
      // 同时写入文件
      if (logWriteStream) {
        logWriteStream.write(errorText);
      }
    });

    uartProcess.on('close', (code) => {
      console.log(`串口进程退出，代码: ${code}`);
      global.uartProcessMap.delete(windowId);
    });

    uartProcess.on('error', (error) => {
      console.error('串口进程错误:', error);
    });

    return { windowId, success: true, message: '串口日志接收已启动' };
  } catch (error) {
    console.error('启动串口失败:', error);
    return { success: false, error: error.message };
  }
});

// 切换到指定窗口
ipcMain.handle('focus-window', (event, windowId) => {
  focusWindow(windowId);
});

// 获取窗口列表
ipcMain.handle('get-window-list', () => {
  return windows.map(w => ({
    id: w.windowId,
    windowNumber: w.windowNumber,
    title: '窗口' + w.windowNumber,
    isFocused: w.isFocused()
  }));
});

// 检查文件是否存在
ipcMain.handle('file-exists', async (event, filePath) => {
  return {
    success: true,
    exists: fs.existsSync(filePath)
  };
});

// 使用系统默认程序打开文件
ipcMain.handle('open-file-with-default-app', async (event, filePath) => {
  try {
    console.log('尝试打开文件:', filePath);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `文件不存在: ${filePath}`
      };
    }

    // 使用系统默认程序打开文件
    const error = await shell.openPath(filePath);

    if (error) {
      console.error('shell.openPath 返回错误:', error);
      return {
        success: false,
        error: `系统无法打开此文件类型。可能原因：\n1. 未安装Excel或CSV阅读器\n2. CSV文件类型未关联\n\n详细错误: ${error}`
      };
    }

    console.log('文件已成功打开');
    return { success: true };
  } catch (error) {
    console.error('打开文件时发生异常:', error);
    return {
      success: false,
      error: `打开文件失败: ${error.message}`
    };
  }
});

// 🔧 打开文件路径（在资源管理器中选中文件）
ipcMain.handle('open-path', async (event, filePath) => {
  try {
    console.log('打开文件路径:', filePath);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `文件不存在: ${filePath}`
      };
    }

    // 在Windows上使用explorer /select命令打开路径并选中文件
    const { exec } = require('child_process');

    // 转换路径格式：将正斜杠转换为反斜杠（Windows需要）
    const windowsPath = filePath.replace(/\//g, '\\');

    await new Promise((resolve, reject) => {
      exec(`explorer /select,"${windowsPath}"`, (error, stdout, stderr) => {
        // 🔧 explorer 命令即使成功也可能返回错误码
        // 只要没有抛出异常，就认为成功
        if (error && error.code !== 0) {
          // 某些情况下Explorer会返回错误但实际已打开，所以只记录不抛出
          console.warn('Explorer命令返回警告:', error.message);
        }
        resolve(); // 总是resolve，因为Explorer通常会尝试打开
      });
    });

    console.log('已打开文件路径');
    return { success: true };
  } catch (error) {
    console.error('打开文件路径时发生异常:', error);
    return {
      success: false,
      error: `打开路径失败: ${error.message}`
    };
  }
});

// 🔧 用指定程序打开文件
ipcMain.handle('open-with-app', async (event, appPath, filePath) => {
  try {
    console.log('用程序打开文件:', appPath, filePath);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `文件不存在: ${filePath}`
      };
    }

    // 检查程序是否存在
    if (!fs.existsSync(appPath)) {
      return {
        success: false,
        error: `程序不存在: ${appPath}`
      };
    }

    const { spawn } = require('child_process');

    // 使用 detached 模式启动程序，使其独立运行
    spawn(appPath, [filePath], {
      detached: true,
      stdio: 'ignore'
    }).unref();

    console.log('已用指定程序打开文件');
    return { success: true };
  } catch (error) {
    console.error('用程序打开文件失败:', error);
    return {
      success: false,
      error: `打开文件失败: ${error.message}`
    };
  }
});

// 🚀 打开HTML文件窗口
ipcMain.handle('open-html-window', async (event, filePath) => {
  try {
    console.log('[打开HTML] ========== 开始处理 ==========');
    console.log('[打开HTML] 原始路径:', filePath);
    console.log('[打开HTML] 当前工作目录:', process.cwd());

    // 🚀 将相对路径转换为绝对路径
    let absolutePath = filePath;
    if (!path.isAbsolute(filePath)) {
      absolutePath = path.resolve(filePath);
      console.log('[打开HTML] 转换为绝对路径:', absolutePath);
    }

    // 检查文件是否存在
    if (!fs.existsSync(absolutePath)) {
      console.error('[打开HTML] ✗ 文件不存在:', absolutePath);
      return {
        success: false,
        error: `文件不存在: ${absolutePath}`
      };
    }
    console.log('[打开HTML] ✓ 文件存在');

    // 从文件路径提取文件名（作为窗口标题）
    const fileName = path.basename(absolutePath);
    console.log('[打开HTML] 文件名:', fileName);
    console.log('[打开HTML] 文件大小:', fs.statSync(absolutePath).size, '字节');

    // 创建新的BrowserWindow加载HTML文件
    const htmlWindow = new BrowserWindow({
      title: `HTML预览 - ${fileName}`,
      width: 1400,
      height: 900,
      show: true,  // 🚀 直接显示窗口，方便调试
      backgroundColor: '#ffffff',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        webSecurity: false,  // 🚀 禁用web安全，避免CORS问题
        allowRunningInsecureContent: true
      }
    });

    console.log('[打开HTML] ✓ BrowserWindow已创建');
    console.log('[打开HTML] 窗口ID:', htmlWindow.id);

    // 监听各种事件
    htmlWindow.webContents.on('did-start-loading', () => {
      console.log('[打开HTML] 开始加载...');
    });

    htmlWindow.webContents.on('did-navigate', (event, url) => {
      console.log('[打开HTML] 导航到:', url);
    });

    htmlWindow.webContents.on('did-finish-load', () => {
      console.log('[打开HTML] ✓ 加载完成');
    });

    htmlWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error('[打开HTML] ✗ 加载失败:');
      console.error('[打开HTML]   - errorCode:', errorCode);
      console.error('[打开HTML]   - errorDescription:', errorDescription);
      console.error('[打开HTML]   - validatedURL:', validatedURL);
      console.error('[打开HTML]   - isMainFrame:', isMainFrame);
    });

    htmlWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[打开HTML-Console] ${level}: ${message}`);
    });

    // 加载HTML文件（使用绝对路径）
    console.log('[打开HTML] 开始加载文件:', absolutePath);
    await htmlWindow.loadFile(absolutePath);
    console.log('[打开HTML] ✓ loadFile调用完成');

    // 窗口关闭时清理
    htmlWindow.on('closed', () => {
      console.log('[打开HTML] 窗口已关闭');
    });

    console.log('[打开HTML] ========== 处理完成 ==========');

    return {
      success: true,
      message: 'HTML窗口已创建'
    };
  } catch (error) {
    console.error('[打开HTML] ========== 异常 ==========');
    console.error('[打开HTML] 错误类型:', error.name);
    console.error('[打开HTML] 错误消息:', error.message);
    console.error('[打开HTML] 错误堆栈:', error.stack);
    return {
      success: false,
      error: `创建HTML窗口失败: ${error.message}`
    };
  }
});

// 🚀 下载远程文件到临时目录（用于打开远程HTML文件）
ipcMain.handle('download-remote-file', async (event, remoteUrl, fileName) => {
  const https = require('https');
  const http = require('http');

  // 🚀 内部函数：实际执行下载（支持递归重定向）
  async function downloadFile(url, name, maxRedirects = 5) {
    if (maxRedirects <= 0) {
      throw new Error('重定向次数过多');
    }

    console.log('[下载远程文件] URL:', url);
    console.log('[下载远程文件] 文件名:', name);

    // 创建临时目录
    const tempDir = path.join(os.tmpdir(), 'log-viewer-html');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    console.log('[下载远程文件] 临时目录:', tempDir);

    // 生成唯一的临时文件名
    const timestamp = Date.now();
    const ext = path.extname(name) || '.html';
    const baseName = path.basename(name, ext);
    const tempFileName = `${baseName}-${timestamp}${ext}`;
    const tempFilePath = path.join(tempDir, tempFileName);
    console.log('[下载远程文件] 临时文件路径:', tempFilePath);

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      console.log('[下载远程文件] 开始下载...');
      const request = protocol.get(url, (response) => {
        // 处理HTTP重定向
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
          const redirectUrl = response.headers.location;
          console.log('[下载远程文件] 重定向到:', redirectUrl, `(剩余重定向: ${maxRedirects - 1})`);

          // 递归处理重定向
          downloadFile(redirectUrl, name, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          console.error('[下载远程文件] ✗ HTTP错误:', response.statusCode);
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const fileStream = fs.createWriteStream(tempFilePath);
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          console.log('[下载远程文件] ✓ 下载完成, 大小:', downloadedBytes, '字节');
          resolve({
            success: true,
            tempPath: tempFilePath,
            size: downloadedBytes
          });
        });

        fileStream.on('error', (error) => {
          console.error('[下载远程文件] ✗ 写入文件失败:', error);
          fs.unlink(tempFilePath, () => {}); // 删除不完整的文件
          reject(error);
        });
      });

      request.on('error', (error) => {
        console.error('[下载远程文件] ✗ 下载失败:', error);
        reject(error);
      });

      request.setTimeout(30000, () => {
        console.error('[下载远程文件] ✗ 下载超时（30秒）');
        request.destroy();
        reject(new Error('下载超时（30秒）'));
      });
    });
  }

  try {
    console.log('[下载远程文件] ========== 开始处理 ==========');
    const result = await downloadFile(remoteUrl, fileName);
    console.log('[下载远程文件] ========== 处理完成 ==========');
    return result;
  } catch (error) {
    console.error('[下载远程文件] ========== 异常 ==========');
    console.error('[下载远程文件] 错误类型:', error.name);
    console.error('[下载远程文件] 错误消息:', error.message);
    console.error('[下载远程文件] 错误堆栈:', error.stack);
    return {
      success: false,
      error: `下载远程文件失败: ${error.message}`
    };
  }
});

// 打开 WezTerm 终端
ipcMain.handle('open-terminal', async (event, dirPath) => {
  try {
    console.log('=== 尝试打开 WezTerm 终端 ===');

    // WezTerm 可执行文件路径
    const weztermPath = path.join(__dirname, 'WezTerm', 'wezterm-gui.exe');
    const weztermDir = path.join(__dirname, 'WezTerm');

    console.log('WezTerm 路径:', weztermPath);
    console.log('WezTerm 目录:', weztermDir);

    // 检查 WezTerm 是否存在
    if (!fs.existsSync(weztermPath)) {
      console.error('WezTerm 可执行文件不存在');
      return {
        success: false,
        error: `WezTerm 不存在: ${weztermPath}`
      };
    }

    // 检查配置文件是否存在
    const configFile = path.join(weztermDir, 'wezterm.lua');
    console.log('配置文件路径:', configFile);
    console.log('配置文件存在:', fs.existsSync(configFile));

    // 检查壁纸目录是否存在
    const wallpaperDir = path.join(weztermDir, '壁纸');
    console.log('壁纸目录路径:', wallpaperDir);
    console.log('壁纸目录存在:', fs.existsSync(wallpaperDir));

    // 准备启动选项 - 先尝试不使用 detached 来捕获错误
    const spawnOptions = {
      cwd: weztermDir,
      env: {
        ...process.env,
        // 设置 WezTerm 配置目录为 WezTerm 文件所在目录
        WEZTERM_CONFIG_DIR: weztermDir,
      },
      // 不使用 detached 和 stdio: 'ignore'，以便捕获错误
      stdio: ['ignore', 'pipe', 'pipe']
    };

    console.log('启动参数:', JSON.stringify(spawnOptions, null, 2));

    // 启动 WezTerm
    const terminal = spawn(weztermPath, [], spawnOptions);

    // 监听输出以捕获错误信息
    let stderrOutput = '';
    terminal.stderr.on('data', (data) => {
      stderrOutput += data.toString();
      console.error('[WezTerm stderr]', data.toString());
    });

    terminal.stdout.on('data', (data) => {
      console.log('[WezTerm stdout]', data.toString());
    });

    // 监听错误
    terminal.on('error', (err) => {
      console.error('[WezTerm 进程错误]', err);
    });

    // 监听退出
    terminal.on('close', (code) => {
      console.log('[WezTerm 退出] 退出码:', code);
      if (code !== 0 && code !== null) {
        console.error('[WezTerm 错误输出]', stderrOutput);
      }
    });

    // 等待一小段时间，如果没有立即退出则认为启动成功
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 检查进程是否还在运行
    if (terminal.exitCode === null) {
      console.log('✓ WezTerm 启动成功，PID:', terminal.pid);
      // 分离进程使其独立运行
      terminal.unref();
      return { success: true };
    } else {
      console.error('✗ WezTerm 启动失败，退出码:', terminal.exitCode);
      return {
        success: false,
        error: `WezTerm 启动失败，退出码: ${terminal.exitCode}\n错误信息: ${stderrOutput}`
      };
    }
  } catch (error) {
    console.error('打开终端异常:', error);
    return {
      success: false,
      error: `打开终端失败: ${error.message}`
    };
  }
});

// 读取文件内容 - 支持 WinRAR 拖拽（异步版本，不阻塞主进程）
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    // 异步检查文件是否存在
    try {
      const statResult = await fs.promises.stat(filePath);
      if (!statResult.isFile()) {
        return { success: false, error: `路径不是文件: ${filePath}` };
      }
    } catch (e) {
      return { success: false, error: `文件不存在: ${filePath}` };
    }

    // 异步获取文件大小
    const stats = await fs.promises.stat(filePath);
    const MAX_FILE_SIZE = 512 * 1024 * 1024; // 512MB

    if (stats.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `文件过大 (${(stats.size / 1024 / 1024).toFixed(1)}MB)，最大支持 ${MAX_FILE_SIZE / 1024 / 1024}MB。\n建议使用过滤模式（文件树搜索栏切换为"过滤"模式）直接在磁盘上搜索。`
      };
    }

    // 统一读取为 Buffer，通过内容分析提取文本
    const buffer = await fs.promises.readFile(filePath);
    const { content, encoding, isBinary } = extractTextFromBuffer(buffer);

    return {
      success: true,
      content: content,
      encoding: encoding,
      isBinary: isBinary || false,
      path: filePath,
      size: stats.size
    };
  } catch (error) {
    console.error('读取文件失败:', error);
    return { success: false, error: `读取文件失败: ${error.message}` };
  }
});

// =====================================================================
// 🔧 工具查找函数 - 统一使用相对路径
// =====================================================================

/**
 * 查找工具可执行文件（基于应用目录的相对路径查找）
 * @param {string} toolName - 工具名称（如 'es.exe', 'rg.exe', 'fzf.exe'）
 * @returns {string|null} 找到的完整路径，未找到返回 null
 */
function findToolExecutable(toolName) {
  const path = require('path');
  const fs = require('fs');

  // 获取应用基础目录
  const appDir = process.resourcesPath || path.dirname(__dirname);
  const cwd = process.cwd();

  // 统一的查找路径顺序（按优先级）
  const searchPaths = [
    // 1. 应用目录下的 tools 文件夹
    path.join(appDir, 'tools', toolName),
    // 2. 应用根目录
    path.join(appDir, toolName),
    // 3. 当前工作目录的 tools 文件夹
    path.join(cwd, 'tools', toolName),
    // 4. 当前工作目录根目录
    path.join(cwd, toolName),
    // 5. 系统环境变量 PATH
    toolName
  ];

  for (const testPath of searchPaths) {
    // 对于 PATH 中的查找，需要测试是否能执行
    if (testPath === toolName) {
      try {
        const { spawn } = require('child_process');
        spawn(testPath, ['--version'], { windowsHide: true, stdio: 'ignore' })
          .on('error', () => {});
        return toolName;
      } catch (e) {
        continue;
      }
    }

    // 对于具体路径，检查文件是否存在
    if (fs.existsSync(testPath)) {
      return testPath;
    }
  }

  return null;
}

/**
 * 获取工具可执行文件的路径
 * @param {string} toolName - 工具名称
 * @param {string[]} defaultInstallPaths - 默认安装路径（作为备用）
 * @returns {string|null} 找到的完整路径
 */
function getToolPath(toolName, defaultInstallPaths = []) {
  const path = require('path');
  const fs = require('fs');

  // 首先尝试相对路径查找
  const relativePath = findToolExecutable(toolName);
  if (relativePath) {
    console.log(`[工具] 找到 ${toolName}: ${relativePath} (相对路径)`);
    return relativePath;
  }

  // 然后尝试默认安装路径
  for (const installPath of defaultInstallPaths) {
    if (fs.existsSync(installPath)) {
      console.log(`[工具] 找到 ${toolName}: ${installPath} (系统安装)`);
      return installPath;
    }
  }

  console.warn(`[工具] 未找到 ${toolName}`);
  return null;
}

// 🔧 查找 es.exe 可执行文件
function findEsExecutable() {
  const defaultPaths = [
    'C:\\Program Files\\Everything\\es.exe',
    'C:\\Program Files (x86)\\Everything\\es.exe'
  ];
  return getToolPath('es.exe', defaultPaths);
}

// 🔧 查找 rg.exe 可执行文件
function findRgExecutable() {
  const defaultPaths = [
    'C:\\Program Files\\ripgrep\\rg.exe',
    'C:\\Program Files (x86)\\ripgrep\\rg.exe'
  ];
  return getToolPath('rg.exe', defaultPaths);
}

// 🔧 查找 fzf.exe 可执行文件
function findFzfExecutable() {
  // fzf 通常没有默认安装路径，主要靠相对路径
  return findToolExecutable('fzf.exe');
}

// 🔧 查找 7z.exe 可执行文件（复用公共 find7z）
function find7zExecutable() {
  return find7z() || getToolPath('7z.exe', [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    '7z.exe'
  ]);
}

/**
 * 检查所有工具的状态
 */
ipcMain.handle('check-tools-status', async () => {
  const tools = [
    { name: 'es.exe', finder: findEsExecutable },
    { name: 'rg.exe', finder: findRgExecutable },
    { name: 'fzf.exe', finder: findFzfExecutable },
    { name: '7z.exe', finder: find7zExecutable }
  ];

  const status = {};
  for (const tool of tools) {
    const toolPath = tool.finder();
    status[tool.name] = {
      found: !!toolPath,
      path: toolPath || null
    };
  }

  return { success: true, status };
});

// 🔧 调用 Everything es.exe 命令行工具进行文件搜索
ipcMain.handle('call-es', async (event, options) => {
  const { args = [] } = options;

  try {
    // 自动查找 es.exe
    const execPath = findEsExecutable();

    if (!execPath) {
      return {
        success: false,
        error: '未找到 es.exe\n请安装 Everything 或将 es.exe 放到工具目录中\n下载: https://www.voidtools.com/'
      };
    }

    console.log('[call-es] 调用 es.exe, 路径:', execPath, '参数:', args);

    return new Promise((resolve) => {
      const { spawn } = require('child_process');

      // 🔧 Windows 下使用 chcp 65001 设置 UTF-8 编码，然后调用 es.exe
      const isWindows = process.platform === 'win32';
      let esProcess;

      if (isWindows) {
        // Windows: 使用 cmd /c 执行 chcp 65001 && es.exe ...
        esProcess = spawn('cmd', ['/c', 'chcp', '65001', '>', 'nul', '&&', execPath, ...args], {
          windowsHide: true,
          env: { ...process.env }
        });
      } else {
        // 非 Windows: 直接调用
        esProcess = spawn(execPath, args, {
          windowsHide: true,
          env: { ...process.env, LANG: 'en_US.UTF-8' }
        });
      }

      let stdout = '';
      let stderr = '';

      esProcess.stdout.on('data', (data) => {
        // 显式使用 UTF-8 解码
        stdout += data.toString('utf8');
      });

      esProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      esProcess.on('close', (code) => {
        console.log(`[call-es] es.exe 退出，代码: ${code}`);
        console.log(`[call-es] stdout 长度: ${stdout.length}`);
        console.log(`[call-es] stderr: ${stderr}`);

        if (code === 0) {
          resolve({
            success: true,
            stdout: stdout,
            stderr: stderr,
            exitCode: code
          });
        } else {
          resolve({
            success: false,
            error: stderr || `es.exe 退出代码: ${code}`,
            stdout: stdout,
            exitCode: code
          });
        }
      });

      esProcess.on('error', (error) => {
        console.error('[call-es] es.exe 执行错误:', error);
        resolve({
          success: false,
          error: `执行失败: ${error.message}`
        });
      });

      // 10秒超时
      setTimeout(() => {
        esProcess.kill();
        resolve({
          success: false,
          error: '执行超时（10秒）'
        });
      }, 10000);
    });

  } catch (error) {
    console.error('[call-es] 调用 es.exe 异常:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 🚀 调用 ripgrep rg.exe 命令行工具进行极速文本搜索
ipcMain.handle('call-rg', async (event, options) => {
  const { execPath = './rg.exe', args = [], cwd = null } = options;

  try {
    console.log('[call-rg] 调用 rg.exe, 参数:', args);

    // 检查 rg.exe 是否存在
    if (!fs.existsSync(execPath)) {
      return {
        success: false,
        error: `rg.exe 不存在: ${execPath}\n请确保 rg.exe 在当前目录或指定正确路径`
      };
    }

    return new Promise((resolve) => {
      const { spawn } = require('child_process');

      const spawnOptions = {
        windowsHide: true,
        env: { ...process.env }
      };

      if (cwd) {
        spawnOptions.cwd = cwd;
      }

      const rgProcess = spawn(execPath, args, spawnOptions);

      // 用数组收集 chunks，避免字符串反复拼接导致的内存重分配
      const stdoutChunks = [];
      const stderrChunks = [];

      rgProcess.stdout.on('data', (data) => {
        stdoutChunks.push(data);
      });

      rgProcess.stderr.on('data', (data) => {
        stderrChunks.push(data);
      });

      rgProcess.on('close', (code) => {
        clearTimeout(timeoutHandle);

        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');

        console.log(`[call-rg] rg.exe 退出，代码: ${code}`);
        console.log(`[call-rg] stdout 长度: ${stdout.length}`);
        console.log(`[call-rg] stderr: ${stderr}`);

        if (code === 0 || code === 1) {
          resolve({
            success: true,
            stdout: stdout,
            stderr: stderr,
            exitCode: code
          });
        } else {
          resolve({
            success: false,
            error: stderr || `rg.exe 退出代码: ${code}`,
            stdout: stdout,
            exitCode: code
          });
        }
      });

      rgProcess.on('error', (error) => {
        clearTimeout(timeoutHandle);
        console.error('[call-rg] rg.exe 执行错误:', error);
        resolve({
          success: false,
          error: `执行失败: ${error.message}`
        });
      });

      // 30秒超时，进程正常退出时 clearTimeout 避免泄漏
      const timeoutHandle = setTimeout(() => {
        rgProcess.kill();
        resolve({
          success: false,
          error: '执行超时（30秒）'
        });
      }, 30000);
    });

  } catch (error) {
    console.error('[call-rg] 调用 rg.exe 异常:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 🚀 高性能 ripgrep 搜索：单进程搜多文件，结果打包为 Int32Array 减少 IPC 开销
// 优化：避免为每个文件单独 spawn 进程，改为单 rg 进程搜所有文件
ipcMain.handle('call-rg-batch', async (event, options) => {
  const { execPath = './rg.exe', pattern = '', files = [], includeContent = false, caseInsensitive = false } = options;

  try {
    if (!fs.existsSync(execPath)) {
      return { success: false, error: `rg.exe 不存在: ${execPath}` };
    }
    if (files.length === 0) {
      return { success: true, files: [], lineNums: new Int32Array(0) };
    }

    const { spawn } = require('child_process');

    // 🚀 从 Buffer 中提取一个行号：在 [lineStart, end) 之间解析冒号前的数字
    function parseLineNum(buf, lineStart, end) {
      let num = 0;
      let valid = false;
      for (let j = lineStart; j < end; j++) {
        const c = buf[j];
        if (c === 0x3A) break; // ':'
        if (c >= 0x30 && c <= 0x39) {
          num = num * 10 + (c - 0x30);
          valid = true;
        } else {
          valid = false;
          break;
        }
      }
      return valid ? num : -1;
    }

    /**
     * 🚀 用单个 rg 进程搜索一组文件
     * 输出格式（带 --with-filename --no-heading）：
     *   filepath:行号:内容
     * 按文件名分组解析行号
     */
    function searchFileBatch(batchFiles) {
      return new Promise((resolve) => {
        // 用 --with-filename 让 rg 输出文件路径前缀
        const args = [
          pattern,
          '--line-number',
          '--with-filename',
          '--no-heading',
          '--color', 'never',
          '-a',
        ];
        // 🚀 大小写不敏感标志（与 Worker 路径的 toLowerCase 行为一致）
        if (caseInsensitive) args.push('-i');
        args.push('--');
        // 追加所有文件路径
        for (const f of batchFiles) args.push(f);

        const rgProcess = spawn(execPath, args, {
          windowsHide: true,
          env: { ...process.env }
        });

        const chunks = [];
        rgProcess.stdout.on('data', (d) => chunks.push(d));

        const timeoutHandle = setTimeout(() => {
          rgProcess.kill();
          resolve([]);
        }, 60000);

        rgProcess.on('close', (code) => {
          clearTimeout(timeoutHandle);
          if (code !== 0 && code !== 1) {
            resolve([]);
            return;
          }

          const buf = Buffer.concat(chunks);

          // 🚀 解析 "filepath:行号:内容" 格式，按 filepath 分组
          // 注意：Windows 路径含冒号（如 E:\path\file:123:content）
          // 需要找到 ":数字:" 模式来定位行号，而非找第一个冒号

          if (buf.length === 0) {
            resolve([]);
            return;
          }

          const tempMap = new Map(); // filePath -> [{lineNum, content}]
          let lineStart = 0;

          /**
           * 从一行输出中找到行号分隔符的位置
           * 查找 ":数字:" 模式，返回 {colonPos, lineNum, nextColon}
           */
          function findLineNumSeparator(lineStart, lineEnd) {
            for (let j = lineStart + 1; j < lineEnd - 1; j++) {
              if (buf[j] !== 0x3A) continue;
              let numEnd = j + 1;
              while (numEnd < lineEnd && buf[numEnd] >= 0x30 && buf[numEnd] <= 0x39) {
                numEnd++;
              }
              if (numEnd > j + 1 && (numEnd >= lineEnd || buf[numEnd] === 0x3A)) {
                let lineNum = 0;
                for (let k = j + 1; k < numEnd; k++) {
                  lineNum = lineNum * 10 + (buf[k] - 0x30);
                }
                return { colonPos: j, lineNum: lineNum, nextColon: numEnd };
              }
            }
            return null;
          }

          for (let i = 0; i < buf.length; i++) {
            if (buf[i] === 0x0A) { // '\n'
              const sep = findLineNumSeparator(lineStart, i);
              if (sep) {
                const filePath = buf.toString('utf8', lineStart, sep.colonPos);
                // 🚀 仅在过滤模式下提取行内容，加载模式跳过以减少字符串分配
                const content = includeContent
                  ? buf.toString('utf8', sep.nextColon + 1 < i ? sep.nextColon + 1 : i, i)
                  : '';
                let arr = tempMap.get(filePath);
                if (!arr) { arr = []; tempMap.set(filePath, arr); }
                arr.push({ lineNum: sep.lineNum, content });
              }
              lineStart = i + 1;
            }
          }
          // 处理最后一行（无换行符结尾）
          if (lineStart < buf.length) {
            const sep = findLineNumSeparator(lineStart, buf.length);
            if (sep) {
              const filePath = buf.toString('utf8', lineStart, sep.colonPos);
              const content = includeContent
                ? buf.toString('utf8', sep.nextColon + 1 < buf.length ? sep.nextColon + 1 : buf.length, buf.length)
                : '';
              let arr = tempMap.get(filePath);
              if (!arr) { arr = []; tempMap.set(filePath, arr); }
              arr.push({ lineNum: sep.lineNum, content });
            }
          }

          // 转换为结果数组（同时包含行号和行内容）
          const results = [];
          for (const [filePath, entries] of tempMap) {
            const lineNums = new Int32Array(entries.length);
            const lineContents = new Array(entries.length);
            for (let k = 0; k < entries.length; k++) {
              lineNums[k] = entries[k].lineNum;
              lineContents[k] = entries[k].content;
            }
            results.push({ filePath, lineNums, lineContents });
          }
          resolve(results);
        });

        rgProcess.on('error', () => {
          clearTimeout(timeoutHandle);
          resolve([]);
        });
      });
    }

    // 🚀 分批处理：Windows 命令行参数长度限制约 32000 字符
    // 每批最多 MAX_ARGS_PER_BATCH 个文件路径
    const MAX_ARGS_PER_BATCH = 64;
    const allResults = [];

    // 🚀 并行执行所有批次，充分利用 CPU（rg 内部 mmap + 多线程）
    const totalBatches = Math.ceil(files.length / MAX_ARGS_PER_BATCH);
    const batchPromises = [];
    for (let batch = 0; batch < totalBatches; batch++) {
      const startIdx = batch * MAX_ARGS_PER_BATCH;
      const endIdx = Math.min(startIdx + MAX_ARGS_PER_BATCH, files.length);
      const batchFiles = files.slice(startIdx, endIdx);
      batchPromises.push(searchFileBatch(batchFiles));
    }
    const batchResultsArray = await Promise.all(batchPromises);
    for (const batchResults of batchResultsArray) {
      allResults.push(...batchResults);
    }

    // 🚀 打包为单个 Int32Array + 文件元数据
    // 仅在 includeContent=true 时（过滤模式）才打包行内容，避免 IPC 开销
    let totalLines = 0;
    const fileEntries = [];
    for (const r of allResults) {
      if (r) {
        fileEntries.push({ path: r.filePath, offset: totalLines, count: r.lineNums.length });
        totalLines += r.lineNums.length;
      }
    }

    const flatLineNums = new Int32Array(totalLines);
    let writeOffset = 0;
    for (const r of allResults) {
      if (r) {
        flatLineNums.set(r.lineNums, writeOffset);
        writeOffset += r.lineNums.length;
      }
    }

    const response = { success: true, files: fileEntries, lineNums: flatLineNums };

    // 仅在过滤模式下传输行内容（节省 IPC 序列化时间）
    if (includeContent) {
      const flatLineContents = new Array(totalLines);
      writeOffset = 0;
      for (const r of allResults) {
        if (r) {
          for (let k = 0; k < r.lineContents.length; k++) {
            flatLineContents[writeOffset + k] = r.lineContents[k];
          }
          writeOffset += r.lineNums.length;
        }
      }
      response.lineContents = flatLineContents;
    }

    console.log(`[call-rg-batch] 搜索完成: ${files.length} 个文件, ${fileEntries.length} 个有匹配, ${totalLines} 行`);
    return response;

  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 批量读取文件内容
ipcMain.handle('read-files', async (event, filePaths) => {
  try {
    const results = [];
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

    for (const filePath of filePaths) {
      try {
        if (!fs.existsSync(filePath)) {
          results.push({
            path: filePath,
            success: false,
            error: '文件不存在'
          });
          continue;
        }

        const stats = fs.statSync(filePath);
        if (!stats.isFile()) {
          results.push({
            path: filePath,
            success: false,
            error: '路径不是文件'
          });
          continue;
        }

        if (stats.size > MAX_FILE_SIZE) {
          results.push({
            path: filePath,
            success: false,
            error: `文件过大 (${(stats.size / 1024 / 1024).toFixed(2)}MB)`
          });
          continue;
        }

        // 🔧 统一读取为 Buffer，通过内容分析提取文本（支持二进制文件中的文本）
        const buffer = fs.readFileSync(filePath);
        const { content, encoding, isBinary } = extractTextFromBuffer(buffer);

        results.push({
          path: filePath,
          success: true,
          content: content,
          size: stats.size,
          encoding: encoding,
          isBinary: isBinary || false
        });
      } catch (error) {
        results.push({
          path: filePath,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  } catch (error) {
    console.error('批量读取文件失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 读取文件夹（递归）- 支持粘贴文件夹
// 🚀 增强：支持 Bandizip 临时文件夹搜索
ipcMain.handle('list-folder', async (event, folderPath, options = {}) => {
  try {
    // 如果路径不存在，且启用了 Bandizip 搜索，则尝试在 Bandizip 临时目录中搜索
    if (!fs.existsSync(folderPath) && options.searchBandizipTemp) {
      console.log(`📂 路径不存在，尝试搜索 Bandizip 临时目录: ${folderPath}`);

      const folderName = require('path').basename(folderPath);
      const userWorkDir = process.env.USERPROFILE || process.env.HOME || '.';
      const searchPaths = [
        path.join(userWorkDir, 'AppData', 'Local', 'Temp'),
        path.join(userWorkDir, 'AppData', 'Local', 'Bandizip', 'Temp'),
        path.join(userWorkDir, 'AppData', 'Local', 'Temp', 'Bandizip'),
        os.tmpdir()
      ];

      for (const searchDir of searchPaths) {
        if (!fs.existsSync(searchDir)) continue;

        try {
          console.log(`  🔍 在 Bandizip 目录中搜索: ${searchDir}`);
          const entries = fs.readdirSync(searchDir, { withFileTypes: true });

          for (const entry of entries) {
            if (entry.isDirectory()) {
              const fullPath = path.join(searchDir, entry.name);

              // 检查目录名是否匹配（可能是完整路径的最后部分）
              if (entry.name === folderName) {
                console.log(`✅ 找到匹配的 Bandizip 临时文件夹: ${fullPath}`);
                folderPath = fullPath;
                break;
              }

              // 也检查子目录（Bandizip 可能在子目录中创建临时文件夹）
              try {
                const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
                for (const subEntry of subEntries) {
                  if (subEntry.isDirectory() && subEntry.name === folderName) {
                    const subFullPath = path.join(fullPath, subEntry.name);
                    console.log(`✅ 找到匹配的 Bandizip 子文件夹: ${subFullPath}`);
                    folderPath = subFullPath;
                    break;
                  }
                }
                if (fs.existsSync(folderPath)) break;
              } catch (e) {
                // 忽略子目录读取错误
              }
            }
            if (fs.existsSync(folderPath)) break;
          }

          if (fs.existsSync(folderPath)) break;
        } catch (e) {
          console.log(`  ⚠️ 搜索目录失败: ${searchDir} - ${e.message}`);
        }
      }
    }

    if (!fs.existsSync(folderPath)) {
      return {
        success: false,
        error: `路径不存在: ${folderPath}`
      };
    }

    const stats = fs.statSync(folderPath);
    if (!stats.isDirectory()) {
      return {
        success: false,
        error: `路径不是文件夹: ${folderPath}`
      };
    }

    const results = [];

    // 只读取文件夹的直接子项（不递归，不读取文件内容）
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = require('path').join(folderPath, entry.name);

      try {
        const entryStats = fs.statSync(fullPath);

        if (entry.isDirectory()) {
          // 子文件夹：只记录名称
          results.push({
            path: fullPath,
            name: entry.name,
            isDirectory: true,
            success: true
          });
        } else if (entry.isFile()) {
          // 文件：只记录名称和大小，不读取内容
          results.push({
            path: fullPath,
            name: entry.name,
            isDirectory: false,
            size: entryStats.size,
            success: true
          });
        }
      } catch (error) {
        results.push({
          path: fullPath,
          name: entry.name,
          success: false,
          error: error.message
        });
      }
    }

    console.log(`📂 列出文件夹完成: ${folderPath}, ${results.length} 个条目`);

    // 🔧 记录最近访问的目录（用于智能搜索）
    addRecentDirectory(folderPath);

    return results;
  } catch (error) {
    console.error('列出文件夹失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('read-folder', async (event, folderOrFilePath) => {
  try {
    if (!fs.existsSync(folderOrFilePath)) {
      return {
        success: false,
        error: `路径不存在: ${folderOrFilePath}`
      };
    }

    const stats = fs.statSync(folderOrFilePath);
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    const results = [];

    // 递归读取文件夹中的所有文件
    const readDirectory = (dirPath) => {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = require('path').join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // 递归读取子文件夹
          readDirectory(fullPath);
        } else if (entry.isFile()) {
          try {
            const fileStats = fs.statSync(fullPath);

            // 跳过过大的文件
            if (fileStats.size > MAX_FILE_SIZE) {
              console.log(`⚠️ 跳过过大文件: ${fullPath} (${(fileStats.size / 1024 / 1024).toFixed(2)}MB)`);
              results.push({
                path: fullPath,
                success: false,
                error: `文件过大 (${(fileStats.size / 1024 / 1024).toFixed(2)}MB)`
              });
              continue;
            }

            // 尝试读取文本文件
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              results.push({
                path: fullPath,
                success: true,
                content: content,
                size: fileStats.size
              });
            } catch (readError) {
              // 可能是二进制文件，跳过
              console.log(`⚠️ 跳过二进制文件: ${fullPath}`);
              results.push({
                path: fullPath,
                success: false,
                error: '无法读取文件（可能是二进制文件）'
              });
            }
          } catch (error) {
            results.push({
              path: fullPath,
              success: false,
              error: error.message
            });
          }
        }
      }
    };

    // 检查是文件还是文件夹
    if (stats.isFile()) {
      // 如果是单个文件，直接读取
      try {
        const content = fs.readFileSync(folderOrFilePath, 'utf-8');
        results.push({
          path: folderOrFilePath,
          success: true,
          content: content,
          size: stats.size
        });
      } catch (error) {
        results.push({
          path: folderOrFilePath,
          success: false,
          error: error.message
        });
      }
    } else if (stats.isDirectory()) {
      // 如果是文件夹，递归读取
      readDirectory(folderOrFilePath);
    }

    console.log(`📁 读取文件夹完成: ${results.length} 个文件`);
    return results;
  } catch (error) {
    console.error('读取文件夹失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 🚀 智能搜索文件夹 - 在所有驱动器上搜索指定名称的文件夹
ipcMain.handle('search-folder', async (event, folderName) => {
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const { execSync } = require('child_process');

  try {
    console.log(`🔍 智能搜索文件夹: ${folderName}`);

    // 1. 获取所有可用的驱动器（Windows）
    let drives = [];
    try {
      if (process.platform === 'win32') {
        const output = execSync('wmic logicaldisk get name', { encoding: 'utf-8' });
        drives = output.split('\n')
          .map(line => line.trim())
          .filter(line => line && line.match(/^[A-Z]:$/))
          .map(drive => drive + '\\');
      } else {
        // Linux/Mac: 只搜索根目录和用户目录
        drives = ['/', path.join(os.homedir())];
      }
      console.log(`📂 找到 ${drives.length} 个驱动器:`, drives);
    } catch (e) {
      console.log('⚠️ 获取驱动器列表失败，使用默认列表');
      drives = ['C:\\', 'D:\\', 'E:\\', 'F:\\', 'G:\\', 'H:\\'];
    }

    // 2. 🚀 使用多线程并行扫描 D/E/F 盘的目录树（最多5层深度）
    const MAX_DEPTH = 5;
    const dataDrives = drives.filter(d => ['D', 'E', 'F', 'G', 'H'].includes(d.charAt(0)));

    if (dataDrives.length === 0) {
      return {
        success: false,
        error: `未找到可扫描的驱动器（D/E/F 盘）`
      };
    }

    console.log(`🚀 使用 ${dataDrives.length} 个线程并行扫描 ${dataDrives.join(', ')}，最大深度 ${MAX_DEPTH}...`);

    // 创建 Worker Promise
    const workerPromises = dataDrives.map(drive => {
      return new Promise((resolve) => {
        const worker = new Worker(path.join(__dirname, 'workers', 'directory-scanner.js'), {
          workerData: { drivePath: drive, folderName, maxDepth: MAX_DEPTH }
        });

        let resolved = false;

        // 超时保护：10 秒后强制返回
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            worker.terminate();
            console.log(`⚠️ ${drive} 扫描超时，跳过`);
            resolve({ drive, matches: [], dirsScanned: 0, timeout: true });
          }
        }, 10000);

        worker.on('message', (result) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(result);
          }
        });

        worker.on('error', (error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.error(`❌ ${drive} 扫描出错:`, error.message);
            resolve({ drive, matches: [], dirsScanned: 0, error: error.message });
          }
        });

        worker.on('exit', (code) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            if (code !== 0) {
              console.error(`❌ ${drive} Worker 异常退出，代码: ${code}`);
              resolve({ drive, matches: [], dirsScanned: 0, error: `Worker exit code: ${code}` });
            }
          }
        });
      });
    });

    // 等待所有 Worker 完成
    const results = await Promise.all(workerPromises);

    // 合并结果
    const matchedFolders = [];
    let totalDirsScanned = 0;

    for (const result of results) {
      if (result.success !== false && result.matches) {
        matchedFolders.push(...result.matches);
        totalDirsScanned += result.dirsScanned || 0;
        console.log(`✅ ${result.drive}: 找到 ${result.matches?.length || 0} 个匹配，扫描 ${result.dirsScanned || 0} 个目录`);
      } else if (result.timeout) {
        console.log(`⏱️ ${result.drive}: 扫描超时`);
      } else if (result.error) {
        console.log(`❌ ${result.drive}: ${result.error}`);
      }
    }

    console.log(`🔍 多线程扫描完成，共扫描 ${totalDirsScanned} 个目录，找到 ${matchedFolders.length} 个匹配:`, matchedFolders);

    // 4. 根据搜索结果排序并返回
    if (matchedFolders.length === 0) {
      console.log(`❌ 未找到文件夹: ${folderName}`);
      return {
        success: false,
        error: `未找到文件夹: ${folderName}，请使用"打开文件夹"按钮选择完整路径`
      };
    }

    // 🔧 对匹配的文件夹进行排序，优先级：
    // 1. 不在临时目录中的路径（包含 demolog, logs 等用户数据目录）
    // 2. 最近访问的目录
    // 3. 其他驱动器根目录下的路径
    // 4. 临时目录（最低优先级）
    const tempDirPattern = /\\Temp\\|\/tmp\//i;
    const userDataPattern = /\\(demolog|logs|log|Documents|Downloads|Desktop)\//i;

    matchedFolders.sort((a, b) => {
      const aIsTemp = tempDirPattern.test(a);
      const bIsTemp = tempDirPattern.test(b);
      const aIsUserData = userDataPattern.test(a);
      const bIsUserData = userDataPattern.test(b);

      // 用户数据目录优先于所有
      if (aIsUserData && !bIsUserData) return -1;
      if (!aIsUserData && bIsUserData) return 1;

      // 非临时目录优先于临时目录
      if (!aIsTemp && bIsTemp) return -1;
      if (aIsTemp && !bIsTemp) return 1;

      // 临时目录最后
      if (aIsTemp && bIsTemp) return 0;

      // 都是非临时目录，检查是否在最近访问的目录中
      const aRecentIndex = recentDirectories.findIndex(d => a.startsWith(d));
      const bRecentIndex = recentDirectories.findIndex(d => b.startsWith(d));

      if (aRecentIndex >= 0 && bRecentIndex < 0) return -1;
      if (aRecentIndex < 0 && bRecentIndex >= 0) return 1;
      if (aRecentIndex >= 0 && bRecentIndex >= 0) return aRecentIndex - bRecentIndex;

      // 按驱动器字母排序（D:, E:, ... 优先于 C:）
      const aDrive = a.charAt(0);
      const bDrive = b.charAt(0);
      if (aDrive === 'C' && bDrive !== 'C') return 1;
      if (aDrive !== 'C' && bDrive === 'C') return -1;

      return a.localeCompare(b);
    });

    console.log(`📊 排序后的匹配文件夹:`, matchedFolders);

    if (matchedFolders.length === 1) {
      // 只找到一个，直接返回
      console.log(`✅ 唯一匹配: ${matchedFolders[0]}`);
      return {
        success: true,
        path: matchedFolders[0]
      };
    } else {
      // 找到多个，返回所有匹配项让用户选择
      console.log(`⚠️ 找到 ${matchedFolders.length} 个同名文件夹:`, matchedFolders);
      return {
        success: true,
        multipleMatches: true,
        matches: matchedFolders,
        // 默认选择第一个（已排序，优先级最高）
        path: matchedFolders[0]
      };
    }
  } catch (error) {
    console.error('搜索文件夹失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 记录最近访问的目录 - 供渲染进程调用
ipcMain.handle('add-recent-directory', async (event, dirPath) => {
  addRecentDirectory(dirPath);
  return { success: true };
});

// 🚀 获取可用的数据盘驱动器列表（用于文件树预暴露）
ipcMain.handle('get-data-drives', async (event, options = {}) => {
  try {
    console.log('[get-data-drives] 开始获取驱动器列表...', options);
    const { includeSystemDrive = false } = options;
    const drives = [];
    const platform = process.platform;

    if (platform === 'win32') {
      // 🔧 Windows: 使用 PowerShell 命令获取所有逻辑驱动器
      try {
        const { execSync } = require('child_process');
        // 使用 PowerShell Get-PSDrive 获取所有驱动器（兼容 Windows 11）
        // 用单引号包裹正则，避免与外层双引号冲突
        const psCommand = "Get-PSDrive -PSProvider FileSystem | Where-Object {$_.Name -match '^[A-Z]$'} | Select-Object -ExpandProperty Name";
        const output = execSync(`powershell -NoProfile -Command "${psCommand}"`, { encoding: 'utf8', windowsHide: true });
        console.log('[get-data-drives] PowerShell 输出:', output);

        // 解析输出，每行一个驱动器字母
        const lines = output.split('\n').map(line => line.trim()).filter(line => line);
        console.log('[get-data-drives] 解析后的驱动器列表:', lines);

        for (const line of lines) {
          const letter = line.toUpperCase();

          // 检查是否是单个字母
          if (/^[A-Z]$/.test(letter)) {
            // 如果不包含系统盘，跳过 C 盘
            if (!includeSystemDrive && letter === 'C') {
              console.log(`[get-data-drives] 跳过系统盘: ${letter}`);
              continue;
            }

            const drivePath = letter + ':';
            drives.push({
              name: letter + ':',
              path: drivePath + '\\',
              label: letter + ' 盘'
            });
            console.log(`[get-data-drives] 添加驱动器: ${letter}`);
          }
        }
      } catch (e) {
        console.error('[get-data-drives] PowerShell 命令失败，使用回退方法:', e.message);

        // 回退方法：枚举 A-Z 盘
        const possibleDrives = includeSystemDrive
          ? ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']
          : ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

        for (const letter of possibleDrives) {
          const drivePath = letter + ':';

          try {
            // 只检查驱动器是否存在，不尝试读取（避免权限问题）
            if (fs.existsSync(drivePath)) {
              drives.push({
                name: letter + ':',
                path: drivePath + '\\',
                label: letter + ' 盘'
              });
              console.log(`[get-data-drives] 回退方法添加驱动器: ${letter}`);
            }
          } catch (e2) {
            // 跳过不可访问的驱动器
            console.log(`[get-data-drives] 跳过不可访问的驱动器: ${letter} (${e2.message})`);
          }
        }
      }
    } else {
      // Linux/macOS: 扫描 /mnt 或 /Volumes
      const mountPoints = platform === 'darwin' ? ['/Volumes'] : ['/mnt', '/media'];

      for (const mountBase of mountPoints) {
        if (!fs.existsSync(mountBase)) continue;

        try {
          const entries = fs.readdirSync(mountBase, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const fullPath = path.join(mountBase, entry.name);
              drives.push({
                name: entry.name,
                path: fullPath,
                label: entry.name
              });
            }
          }
        } catch (e) {
          // 忽略错误
        }
      }
    }

    // 按驱动器字母排序
    drives.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`[get-data-drives] 完成，发现 ${drives.length} 个驱动器:`, drives.map(d => d.name));
    return { success: true, drives };
  } catch (error) {
    console.error('[get-data-drives] 错误:', error);
    return { success: false, error: error.message, drives: [] };
  }
});

// 🚀 列出目录内容（用于文件树展开）
ipcMain.handle('list-directory', async (event, dirPath) => {
  try {
    console.log(`[list-directory] 开始列出目录: ${dirPath}`);

    if (!fs.existsSync(dirPath)) {
      console.log(`[list-directory] 目录不存在: ${dirPath}`);
      return { success: false, error: '目录不存在', items: [] };
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    console.log(`[list-directory] 找到 ${entries.length} 个条目`);

    const items = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        const stats = fs.statSync(fullPath);
        let itemType = entry.isDirectory() ? 'folder' : 'file';

        // 🚀 识别压缩包类型
        if (!entry.isDirectory()) {
          if (isArchiveFile(entry.name)) {
            itemType = 'archive';
          }
        }

        items.push({
          name: entry.name,
          path: fullPath,
          type: itemType,
          size: stats.size || 0,
          isArchive: itemType === 'archive'
        });
      } catch (e) {
        // 跳过无法访问的条目
      }
    }

    // 排序：文件夹和压缩包在前，普通文件在后，使用 Windows 资源管理器风格的排序
    // 创建排序器（缓存以提高性能）
    const collator = new Intl.Collator(undefined, {
      numeric: true,    // 数字按数值大小排序（file1, file2, file10）
      sensitivity: 'base',  // 忽略大小写和重音
      caseFirst: 'lower'    // 小写字母优先（与 Windows 一致）
    });

    items.sort((a, b) => {
      // 压缩包和文件夹优先级相同，都在文件前面
      const aIsFolder = a.type === 'folder' || a.type === 'archive';
      const bIsFolder = b.type === 'folder' || b.type === 'archive';

      if (aIsFolder && !bIsFolder) return -1;
      if (!aIsFolder && bIsFolder) return 1;

      // 同类型按名称排序（使用自然排序）
      return collator.compare(a.name, b.name);
    });

    console.log(`[list-directory] 成功，返回 ${items.length} 个项`);
    return { success: true, items };
  } catch (error) {
    console.error('[list-directory] 错误:', error);
    return { success: false, error: error.message, items: [] };
  }
});

// 🚀 列出本地压缩包内容 - 支持展开本地 .zip/.7z/.tar.gz 等压缩包
ipcMain.handle('list-archive', async (event, archivePath) => {
  const { execSync } = require('child_process');
  const path = require('path');
  const fs = require('fs');

  try {
    console.log(`[list-archive] 开始列出压缩包: ${archivePath}`);

    if (!fs.existsSync(archivePath)) {
      console.log(`[list-archive] 压缩包不存在: ${archivePath}`);
      return { success: false, error: '压缩包不存在', files: [] };
    }

    // 检测文件类型以决定使用哪个命令
    const ext = path.extname(archivePath).toLowerCase();
    const fileName = path.basename(archivePath).toLowerCase();

    let command = '';
    let use7z = false;
    let sevenZipPath = find7z();
    let has7z = !!sevenZipPath;

    console.log(`[list-archive] 7z 查找结果: has7z=${has7z}, sevenZipPath=${sevenZipPath}`);

    // 根据扩展名选择命令
    if (ext === '.zip' || fileName.endsWith('.zip')) {
      // ZIP 文件：优先使用 7z，回退到原生 ZIP 解析
      if (has7z) {
        use7z = true;
        command = `"${sevenZipPath}" l -ba -y "${archivePath}"`;
      } else {
        // ZIP 文件无 7z：使用原生 ZIP 解析器
        const fd = fs.openSync(archivePath, 'r');
        try {
          const stat = fs.statSync(archivePath);
          const eocd = parseZipCentralDir(fd, stat.size);
          if (eocd) {
            const cdBuffer = Buffer.alloc(eocd.cdSize);
            fs.readSync(fd, cdBuffer, 0, eocd.cdSize, eocd.cdOffset);
            const files = [];
            let pos = 0;
            for (let i = 0; i < eocd.cdEntryCount && pos < cdBuffer.length; i++) {
              if (cdBuffer.readUInt32LE(pos) !== 0x02014b50) break;
              let compressedSize = cdBuffer.readUInt32LE(pos + 20);
              let uncompressedSize = cdBuffer.readUInt32LE(pos + 24);
              const fileNameLength = cdBuffer.readUInt16LE(pos + 28);
              const extraFieldLength = cdBuffer.readUInt16LE(pos + 30);
              const fileCommentLength = cdBuffer.readUInt16LE(pos + 32);
              const externalAttributes = cdBuffer.readUInt32LE(pos + 38);
              let localHeaderOffset = cdBuffer.readUInt32LE(pos + 42);
              if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localHeaderOffset === 0xFFFFFFFF) {
                const resolved = resolveZip64ExtraField(cdBuffer, pos, fileNameLength, extraFieldLength,
                  compressedSize, uncompressedSize, localHeaderOffset);
                compressedSize = resolved.compressedSize;
                uncompressedSize = resolved.uncompressedSize;
              }
              const fn = cdBuffer.toString('utf8', pos + 46, pos + 46 + fileNameLength);
              const isDir = fn.endsWith('/') || ((externalAttributes >>> 16) & 0x4000) !== 0;
              if (fn && !fn.startsWith('__MACOSX')) {
                files.push({ path: fn, isDirectory: isDir, size: isDir ? 0 : uncompressedSize, compressedSize });
              }
              pos += 46 + fileNameLength + extraFieldLength + fileCommentLength;
            }
            return { success: true, files };
          }
        } finally {
          fs.closeSync(fd);
        }
        return { success: false, error: 'ZIP 解析失败', files: [] };
      }
    } else if (ext === '.7z' || fileName.endsWith('.7z')) {
      // 7z 格式必须使用 7z
      if (!has7z) {
        return { success: false, error: '7z 未安装，无法打开 .7z 文件。请将 7z.exe 放到 app 目录下。', files: [] };
      }
      use7z = true;
      command = `"${sevenZipPath}" l -ba -y "${archivePath}"`;
    } else if (ext === '.tar' || ext === '.tgz' || fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
      // tar 格式：.tar 不需要 -z，.tgz/.tar.gz 需要 -z
      if (ext === '.tar') {
        command = `tar -tf "${archivePath}"`;
      } else {
        command = `tar -tzf "${archivePath}"`;
      }
    } else if (ext === '.gz' && !fileName.endsWith('.tar.gz')) {
      // 单独的 .gz 文件（非 tar.gz）：只包含一个文件，报告解压后的文件名
      const baseName = path.basename(archivePath, '.gz');
      return { success: true, files: [{ path: baseName, isDirectory: false, size: 0, compressedSize: 0 }] };
    } else if (ext === '.rar') {
      // RAR 格式必须使用 7z
      if (!has7z) {
        return { success: false, error: '7z 未安装，无法打开 .rar 文件。请将 7z.exe 放到 app 目录下。', files: [] };
      }
      use7z = true;
      command = `"${sevenZipPath}" l -ba -y "${archivePath}"`;
    } else {
      // 默认尝试 7z，然后 tar
      if (has7z) {
        use7z = true;
        command = `"${sevenZipPath}" l -ba -y "${archivePath}"`;
      } else {
        command = `tar -tf "${archivePath}"`;
      }
    }

    if (!command) {
      return { success: false, error: '不支持的压缩格式', files: [] };
    }

    console.log(`[list-archive] 使用 ${use7z ? '7z' : 'tar'}，执行命令: ${command}`);

    // 执行命令获取输出
    let output = '';
    try {
      output = execSync(command, {
        encoding: 'utf-8',
        windowsHide: true,
        maxBuffer: 50 * 1024 * 1024 // 50MB buffer
      });
    } catch (error) {
      // 如果 tar 失败，尝试 7z
      if (!use7z && has7z) {
        console.log('[list-archive] tar 失败，尝试使用 7z');
        command = `"${sevenZipPath}" l -ba -y "${archivePath}"`;
        output = execSync(command, {
          encoding: 'utf-8',
          windowsHide: true,
          maxBuffer: 50 * 1024 * 1024
        });
        use7z = true;
      } else {
        throw error;
      }
    }

    // 解析输出
    const files = [];

    console.log(`[list-archive] 原始输出长度: ${output.length} 字符, 行数: ${output.split('\n').length}`);
    console.log(`[list-archive] 前800字符预览:\n${output.substring(0, 800)}`);

    if (use7z) {
      // 解析 7z 输出格式：
      // 2025-01-10 14:23:45 D....            0            0  folder
      // 2025-01-10 14:23:45 ....A         1234         5678  file.txt
      const lines = output.split('\n');
      console.log(`[list-archive] 总行数: ${lines.length}`);
      let parsedCount = 0;
      let skippedCount = 0;

      for (const line of lines) {
        const trimmedLine = line.trim();
        // 跳过标题行和空行
        if (!trimmedLine ||
            trimmedLine.startsWith('---') ||
            trimmedLine.startsWith('7-Zip') ||
            trimmedLine.includes('Type = ') ||
            trimmedLine.includes('Solid =') ||
            /^\d+ file/i.test(trimmedLine)) {
          skippedCount++;
          continue;
        }

        // 🔧 使用更可靠的方法：先检查是否以日期开头，然后分割字符串
        // 格式：日期 时间 属性 大小 压缩大小 路径
        if (!/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(trimmedLine)) {
          skippedCount++;
          continue;
        }

        // 移除日期时间部分（前19个字符）
        let remainingLine = trimmedLine.substring(19).trim();

        // 提取属性（5个字符）
        const attributes = remainingLine.substring(0, 5);
        remainingLine = remainingLine.substring(5).trim();

        // 提取大小（到下一个空白或行尾）
        const sizeMatch = remainingLine.match(/^(\d+)/);
        if (!sizeMatch) {
          skippedCount++;
          continue;
        }
        const size = parseInt(sizeMatch[1], 10);
        remainingLine = remainingLine.substring(sizeMatch[1].length).trim();

        // 跳过压缩后大小（如果有）
        const compressedSizeMatch = remainingLine.match(/^(\d+)/);
        if (compressedSizeMatch) {
          remainingLine = remainingLine.substring(compressedSizeMatch[1].length).trim();
        }

        // 剩余部分是文件路径
        let filePath = remainingLine.trim();

        if (!filePath) {
          skippedCount++;
          continue;
        }

        // 🔧 7z 在 Windows 上使用反斜杠，统一转换为正斜杠
        filePath = filePath.replace(/\\/g, '/');

        // 🔧 去除重复的斜杠
        filePath = filePath.replace(/\/+/g, '/');

        // 判断是否为目录（以 / 结尾 或 属性以 D 开头）
        const isDirectory = filePath.endsWith('/') || attributes.startsWith('D');
        // 去掉末尾的 /
        const cleanPath = filePath.endsWith('/') ? filePath.slice(0, -1) : filePath;

        files.push({
          path: cleanPath,
          name: path.basename(cleanPath),
          isDirectory: isDirectory,
          size: isDirectory ? 0 : size
        });
        parsedCount++;
      }
      console.log(`[list-archive] 7z 解析完成: 解析 ${parsedCount} 个，跳过 ${skippedCount} 行`);
    } else {
      // 解析 tar 输出格式（每行一个文件路径）
      const lines = output.split('\n');
      let parsedCount = 0;

      for (const line of lines) {
        let filePath = line.trim();
        if (!filePath) continue;

        // 处理 ./ 前缀
        if (filePath.startsWith('./')) {
          filePath = filePath.substring(2);
        }

        // tar 不显示大小信息，需要从路径推断是否为目录
        const isDirectory = filePath.endsWith('/');
        const cleanPath = isDirectory ? filePath.slice(0, -1) : filePath;

        // 跳过空路径
        if (!cleanPath) continue;

        files.push({
          path: cleanPath,
          name: path.basename(cleanPath),
          isDirectory: isDirectory,
          size: 0 // tar -t 不显示大小
        });
        parsedCount++;
      }
      console.log(`[list-archive] tar 解析完成: 解析 ${parsedCount} 个文件`);
    }

    console.log(`[list-archive] 成功，找到 ${files.length} 个文件/文件夹`);
    return { success: true, files };
  } catch (error) {
    console.error('[list-archive] 错误:', error);
    return { success: false, error: error.message, files: [] };
  }
});

/**
 * 🚀 原生解析 ZIP 中央目录（无需 7z / 无需加载整个文件）
 * ZIP 格式将中央目录放在文件末尾，只读取尾部即可列出所有文件
 * 适用于 7z 不可用时作为 ZIP 文件的回退方案
 */
ipcMain.handle('list-zip-native', async (event, archivePath) => {
  try {
    if (!fs.existsSync(archivePath)) {
      return { success: false, error: '压缩包不存在', files: [] };
    }

    const fileSize = fs.statSync(archivePath).size;
    const fd = fs.openSync(archivePath, 'r');

    try {
      // 解析 EOCD（含 Zip64 支持）
      const eocd = parseZipCentralDir(fd, fileSize);
      if (!eocd) {
        return { success: false, error: '不是有效的 ZIP 文件（未找到 EOCD）', files: [] };
      }

      const { cdEntryCount, cdSize, cdOffset } = eocd;
      if (cdEntryCount === 0) {
        return { success: true, files: [] };
      }

      // 读取整个中央目录
      const cdBuffer = Buffer.alloc(cdSize);
      fs.readSync(fd, cdBuffer, 0, cdSize, cdOffset);

      // 解析中央目录条目
      const files = [];
      let pos = 0;

      for (let i = 0; i < cdEntryCount && pos < cdBuffer.length; i++) {
        if (cdBuffer.readUInt32LE(pos) !== 0x02014b50) break;

        const compressionMethod = cdBuffer.readUInt16LE(pos + 10);
        let compressedSize = cdBuffer.readUInt32LE(pos + 20);
        let uncompressedSize = cdBuffer.readUInt32LE(pos + 24);
        const fileNameLength = cdBuffer.readUInt16LE(pos + 28);
        const extraFieldLength = cdBuffer.readUInt16LE(pos + 30);
        const fileCommentLength = cdBuffer.readUInt16LE(pos + 32);
        const externalAttributes = cdBuffer.readUInt32LE(pos + 38);
        let localHeaderOffset = cdBuffer.readUInt32LE(pos + 42);

        const fileName = cdBuffer.toString('utf8', pos + 46, pos + 46 + fileNameLength);

        // Zip64 扩展字段解析
        if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localHeaderOffset === 0xFFFFFFFF) {
          const resolved = resolveZip64ExtraField(cdBuffer, pos, fileNameLength, extraFieldLength,
            compressedSize, uncompressedSize, localHeaderOffset);
          compressedSize = resolved.compressedSize;
          uncompressedSize = resolved.uncompressedSize;
        }

        // 判断是否是目录：
        // 1. 文件名以 / 结尾（标准 ZIP 目录标记）
        // 2. External attributes 高 16 位的 Unix 文件类型字段为 S_IFDIR (0x4000)
        const isDirectory = fileName.endsWith('/') ||
          ((externalAttributes >>> 16) & 0x4000) !== 0;

        if (fileName && !fileName.startsWith('__MACOSX')) {
          files.push({
            path: fileName,
            isDirectory: isDirectory,
            size: isDirectory ? 0 : uncompressedSize,
            compressedSize: compressedSize,
            date: null
          });
        }

        pos += 46 + fileNameLength + extraFieldLength + fileCommentLength;
      }

      console.log(`[list-zip-native] 成功解析 ZIP，共 ${files.length} 个条目`);
      return { success: true, files };
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    console.error('[list-zip-native] 错误:', error);
    return { success: false, error: error.message, files: [] };
  }
});

/**
 * 🚀 原生从 ZIP 文件中提取单个文件（无需 7z）
 * 直接解析 ZIP 本地文件头，定位并解压指定文件
 */
ipcMain.handle('extract-zip-native', async (event, archivePath, filePath) => {
  try {
    return extractZipEntryNative(archivePath, filePath);
  } catch (error) {
    console.error('[extract-zip-native] 错误:', error);
    return { success: false, error: error.message };
  }
});

// 🔧 从压缩包中提取单个文件内容
ipcMain.handle('extract-file-from-archive', async (event, archivePath, filePath) => {
  const { execSync } = require('child_process');
  const path = require('path');
  const fs = require('fs');
  const os = require('os');

  try {
    console.log(`[extract-file-from-archive] 开始提取: ${archivePath} 中的 ${filePath}`);

    if (!fs.existsSync(archivePath)) {
      return { success: false, error: '压缩包不存在' };
    }

    // 检测文件类型以决定使用哪个命令
    const ext = path.extname(archivePath).toLowerCase();
    const fileName = path.basename(archivePath).toLowerCase();

    let sevenZipPath = find7z();
    let has7z = !!sevenZipPath;

    // 根据扩展名决定命令
    const use7z = isArchiveFile(archivePath);
    if (use7z) {
      console.log(`[extract-file-from-archive] 使用 7z 提取，扩展名: ${ext}`);
    }

    if (!use7z || !has7z) {
      // ZIP 文件：回退到原生 ZIP 提取
      if (ext === '.zip') {
        console.log(`[extract-file-from-archive] 7z 不可用，使用原生 ZIP 提取`);
        return extractZipEntryNative(archivePath, filePath);
      }
      // tar.gz 文件：回退到流式提取
      const lower = archivePath.toLowerCase();
      if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
        console.log(`[extract-file-from-archive] 7z 不可用，使用流式 tar.gz 提取`);
        const streamResult = await new Promise((resolve) => {
          const zlib = require('zlib');
          const targetPath = filePath.replace(/^\/+/, '').replace(/\\/g, '/');
          const targetLower = targetPath.toLowerCase();

          if (!fs.existsSync(archivePath)) {
            resolve({ success: false, error: '压缩包不存在' });
            return;
          }

          const rawStream = fs.createReadStream(archivePath, { highWaterMark: 1024 * 1024 });
          const decompressStream = zlib.createGunzip();
          rawStream.pipe(decompressStream);

          let state = 'header';
          let headerBuf = Buffer.alloc(512);
          let headerPos = 0;
          let dataBuf = null;
          let dataPos = 0;
          let dataSize = 0;
          let currentFileName = '';
          let pendingLongName = null;
          let resolved = false;

          function doResolve(val) {
            if (!resolved) {
              resolved = true;
              resolve(val);
            }
          }

          decompressStream.on('data', (chunk) => {
            let offset = 0;
            while (offset < chunk.length) {
              if (state === 'header') {
                const needed = 512 - headerPos;
                const available = chunk.length - offset;
                const copyLen = Math.min(needed, available);
                chunk.copy(headerBuf, headerPos, offset, offset + copyLen);
                headerPos += copyLen;
                offset += copyLen;

                if (headerPos === 512) {
                  if (headerBuf.readUInt8(0) === 0) {
                    state = 'done';
                    rawStream.destroy();
                    return;
                  }

                  const typeflag = String.fromCharCode(headerBuf[156]);

                  const sizeStr = headerBuf.toString('utf-8', 124, 136).replace(/\0+$/, '').trim();
                  let fileSize = 0;
                  if (sizeStr) {
                    if (headerBuf[124] >= 0x80) {
                      for (let i = 125; i < 136; i++) fileSize = fileSize * 256 + headerBuf[i];
                    } else {
                      fileSize = parseInt(sizeStr, 8) || 0;
                    }
                  }

                  // GNU 长文件名扩展
                  if (typeflag === 'L') {
                    if (fileSize > 0 && fileSize < 65536) {
                      dataSize = fileSize;
                      dataBuf = Buffer.alloc(fileSize);
                      dataPos = 0;
                      state = 'metadata';
                    } else {
                      dataSize = fileSize;
                      dataBuf = null;
                      state = 'padding';
                    }
                    headerPos = 0;
                    continue;
                  }

                  const name = headerBuf.toString('utf-8', 0, 100).replace(/\0+$/, '');
                  let fullName;
                  const ustarMagic = headerBuf.toString('ascii', 257, 263);
                  if (ustarMagic.startsWith('ustar') || ustarMagic.startsWith('ustar ')) {
                    const prefixStr = headerBuf.toString('utf-8', 345, 500).replace(/\0+$/, '');
                    fullName = prefixStr ? prefixStr + '/' + name : name;
                  } else {
                    fullName = name;
                  }

                  // 使用 GNU 长文件名
                  if (pendingLongName !== null) {
                    fullName = pendingLongName;
                    pendingLongName = null;
                  }

                  fullName = fullName.replace(/^\.\/+/, '').replace(/\\/g, '/');
                  if (fullName.endsWith('/')) fullName = fullName.slice(0, -1);
                  currentFileName = fullName;

                  const isRegularFile = typeflag === '0' || typeflag === '\0' || typeflag === '';
                  const isPaxHeader = typeflag === 'x' || typeflag === 'g';

                  if (!isRegularFile || fileSize === 0 || isPaxHeader) {
                    dataSize = fileSize;
                    dataBuf = null;
                    state = 'padding';
                    headerPos = 0;
                    continue;
                  }

                  const normalizedCurrent = currentFileName.replace(/^\/+/, '');
                  const isTarget = normalizedCurrent === targetPath ||
                    normalizedCurrent.toLowerCase() === targetLower;

                  if (isTarget && fileSize > 0) {
                    dataSize = fileSize;
                    dataBuf = Buffer.alloc(fileSize);
                    dataPos = 0;
                    state = 'data';
                  } else {
                    dataSize = fileSize;
                    dataBuf = null;
                    state = 'padding';
                  }
                  headerPos = 0;
                }
              } else if (state === 'metadata') {
                const needed = dataSize - dataPos;
                const available = chunk.length - offset;
                const copyLen = Math.min(needed, available);
                chunk.copy(dataBuf, dataPos, offset, offset + copyLen);
                dataPos += copyLen;
                offset += copyLen;

                if (dataPos === dataSize) {
                  pendingLongName = dataBuf.toString('utf-8').replace(/\0+$/, '');
                  dataBuf = null;
                  const padding = (512 - (dataSize % 512)) % 512;
                  if (padding === 0) {
                    state = 'header';
                    headerPos = 0;
                  } else {
                    dataSize = padding;
                    state = 'padding';
                  }
                }
              } else if (state === 'data') {
                const needed = dataSize - dataPos;
                const available = chunk.length - offset;
                const copyLen = Math.min(needed, available);
                chunk.copy(dataBuf, dataPos, offset, offset + copyLen);
                dataPos += copyLen;
                offset += copyLen;

                if (dataPos === dataSize) {
                  const { content } = extractTextFromBuffer(dataBuf);
                  doResolve({ success: true, content });
                  rawStream.destroy();
                  return;
                }
              } else if (state === 'padding') {
                const skip = Math.min(dataSize, chunk.length - offset);
                offset += skip;
                dataSize -= skip;
                if (dataSize === 0) {
                  state = 'header';
                  headerPos = 0;
                }
              } else if (state === 'done') {
                return;
              }
            }
          });

          decompressStream.on('end', () => {
            doResolve({ success: false, error: `文件未在压缩包中找到: ${filePath}` });
          });

          decompressStream.on('close', () => {
            doResolve({ success: false, error: `文件未在压缩包中找到: ${filePath}` });
          });

          decompressStream.on('error', (err) => {
            doResolve({ success: false, error: err.message });
          });

          rawStream.on('error', (err) => {
            doResolve({ success: false, error: err.message });
          });
        });
        return streamResult;
      }
      return { success: false, error: '不支持的压缩格式或 7z 未安装' };
    }

    // 创建临时目录
    const tempDir = os.tmpdir();
    const tempId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    const tempExtractDir = path.join(tempDir, `logview_extract_${tempId}`);
    fs.mkdirSync(tempExtractDir, { recursive: true });

    // 使用 7z 提取单个文件到临时目录
    // 使用 x 命令（保留目录结构）而非 e 命令，避免 .7z 格式下 e+spf 组合导致解压异常
    const command = `"${sevenZipPath}" x -y -o"${tempExtractDir}" "${archivePath}" "${filePath}"`;
    console.log(`[extract-file-from-archive] 执行命令: ${command}`);

    let stderrOutput = '';
    let hasSymlinkError = false;

    try {
      const result = execSync(command, {
        encoding: 'utf-8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 100 * 1024 * 1024 // 100MB buffer
      });
    } catch (error) {
      stderrOutput = error.stderr ? error.stderr.toString() : '';
      // 检查是否只是符号链接错误（7z 安全功能）
      // 如果错误只包含 "Dangerous link path was ignored"，仍然尝试读取已提取的文件
      const lines = stderrOutput.split('\n').filter(l => l.trim());
      const hasOnlySymlinkErrors = lines.every(line =>
        line.includes('Dangerous link path was ignored') ||
        line.includes('Everything is Ok') ||
        line.trim() === ''
      );

      if (hasOnlySymlinkErrors && lines.some(l => l.includes('Dangerous link path was ignored'))) {
        hasSymlinkError = true;
        console.log(`[extract-file-from-archive] 检测到符号链接错误，尝试继续读取已提取的文件`);
      } else {
        // 其他类型的错误，清理临时目录并抛出
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
        throw error;
      }
    }

    // 读取提取的文件
    // 使用 x 命令时，7z 保留目录结构，文件路径即为 filePath 在 tempExtractDir 下的映射
    let extractedFilePath = path.join(tempExtractDir, filePath.replace(/\\/g, '/'));

    // 如果按原路径找到的是目录（7z 可能只解压了父目录），或者不存在，尝试其他方式定位
    if (fs.existsSync(extractedFilePath) && fs.statSync(extractedFilePath).isDirectory()) {
      console.log(`[extract-file-from-archive] 路径指向目录，尝试递归查找实际文件`);
      extractedFilePath = null;
    }
    if (!extractedFilePath || !fs.existsSync(extractedFilePath)) {
      // 尝试只取文件名
      const baseName = path.basename(filePath);
      const candidate = path.join(tempExtractDir, baseName);
      if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
        extractedFilePath = candidate;
      }
    }

    // 递归搜索临时目录中的所有文件，找到非目录的第一个文件
    if (!extractedFilePath || !fs.existsSync(extractedFilePath) || fs.statSync(extractedFilePath).isDirectory()) {
      console.log(`[extract-file-from-archive] 按路径未找到文件，递归搜索临时目录`);
      function findFirstFile(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile()) return fullPath;
          if (entry.isDirectory()) {
            const found = findFirstFile(fullPath);
            if (found) return found;
          }
        }
        return null;
      }
      const found = findFirstFile(tempExtractDir);
      if (found) {
        extractedFilePath = found;
        console.log(`[extract-file-from-archive] 递归找到文件: ${found}`);
      }
    }

    if (!extractedFilePath || !fs.existsSync(extractedFilePath) || fs.statSync(extractedFilePath).isDirectory()) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
      return { success: false, error: `提取失败，文件未找到: ${filePath}` };
    }

    // 路径遍历防护：确保文件在临时目录内
    const resolvedPath = path.resolve(extractedFilePath);
    if (!resolvedPath.startsWith(path.resolve(tempExtractDir))) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
      return { success: false, error: '文件路径异常，已拒绝访问' };
    }

    let content;
    let isBinary = false;
    try {
      // 使用 Buffer 读取，支持从二进制文件中提取文本
      const buffer = fs.readFileSync(resolvedPath);
      const extracted = extractTextFromBuffer(buffer);
      content = extracted.content;
      isBinary = extracted.isBinary;
    } finally {
      // 清理临时目录（即使 readFileSync 抛异常也不泄漏）
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }

    console.log(`[extract-file-from-archive] 成功提取文件，内容长度: ${content.length}`);
    return {
      success: true,
      content,
      symlinkWarning: hasSymlinkError,
      symlinkMessage: hasSymlinkError
        ? '注意：此压缩包包含指向外部的符号链接，部分文件可能未被正确提取。'
        : undefined
    };
  } catch (error) {
    console.error('[extract-file-from-archive] 错误:', error);
    return { success: false, error: error.message };
  }
});

// 🚀 流式批量提取 tar.gz / tar.bz2 文件（单次解压，内存中收集目标文件）
ipcMain.handle('stream-extract-from-archive', async (event, archivePath, filePaths) => {
  const zlib = require('zlib');

  try {
    if (!fs.existsSync(archivePath)) {
      return { success: false, error: '压缩包不存在' };
    }

    const lower = archivePath.toLowerCase();
    const isTarGz = lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
    const isTarBz2 = lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2');

    // 对于非 tar.gz/tar.bz2 格式（如 .zip, .7z, .rar）
    if (!isTarGz && !isTarBz2) {
      const ext = path.extname(archivePath).toLowerCase();
      const fileName = archivePath.toLowerCase();

      // 🚀 ZIP 文件：始终使用原生 ZIP 解析，逐文件推送
      if (ext === '.zip' || fileName.endsWith('.zip')) {
        const zlib = require('zlib');
        const MAX_EXTRACT_SIZE = 50 * 1024 * 1024;
        const fd = fs.openSync(archivePath, 'r');
        try {
          const fileSize = fs.statSync(archivePath).size;
          const eocd = parseZipCentralDir(fd, fileSize);
          if (!eocd) {
            return { success: false, error: '不是有效的 ZIP 文件' };
          }

          const { cdEntryCount, cdSize, cdOffset } = eocd;
          const cdBuffer = Buffer.alloc(cdSize);
          fs.readSync(fd, cdBuffer, 0, cdSize, cdOffset);

          // 按文件树顺序建立有序目标列表
          const targetMap = new Map();
          for (const fp of filePaths) {
            targetMap.set(fp.replace(/^\/+/, '').replace(/\\/g, '/').toLowerCase(), fp);
          }

          let pos = 0;
          let extractedCount = 0;
          const foundKeys = new Set();

          for (let i = 0; i < cdEntryCount && pos < cdBuffer.length; i++) {
            if (cdBuffer.readUInt32LE(pos) !== 0x02014b50) break;

            const compressionMethod = cdBuffer.readUInt16LE(pos + 10);
            let compressedSize = cdBuffer.readUInt32LE(pos + 20);
            let uncompressedSize = cdBuffer.readUInt32LE(pos + 24);
            const fnLen = cdBuffer.readUInt16LE(pos + 28);
            const extraLen = cdBuffer.readUInt16LE(pos + 30);
            const commentLen = cdBuffer.readUInt16LE(pos + 32);
            let localHeaderOff = cdBuffer.readUInt32LE(pos + 42);

            if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localHeaderOff === 0xFFFFFFFF) {
              const r = resolveZip64ExtraField(cdBuffer, pos, fnLen, extraLen, compressedSize, uncompressedSize, localHeaderOff);
              compressedSize = r.compressedSize;
              uncompressedSize = r.uncompressedSize;
              localHeaderOff = r.localHeaderOffset;
            }

            const entryName = cdBuffer.toString('utf8', pos + 46, pos + 46 + fnLen).replace(/^\/+/, '').replace(/\\/g, '/');
            const matchedKey = targetMap.get(entryName.toLowerCase());

            if (matchedKey !== undefined && !foundKeys.has(matchedKey)) {
              foundKeys.add(matchedKey);
              let fileResult;
              if (uncompressedSize <= MAX_EXTRACT_SIZE) {
                try {
                  const lfhBuf = Buffer.alloc(30);
                  fs.readSync(fd, lfhBuf, 0, 30, localHeaderOff);
                  const dataOff = localHeaderOff + 30 + lfhBuf.readUInt16LE(26) + lfhBuf.readUInt16LE(28);
                  const compData = Buffer.alloc(compressedSize);
                  fs.readSync(fd, compData, 0, compressedSize, dataOff);

                  let resultBuf;
                  if (compressionMethod === 0) resultBuf = compData;
                  else if (compressionMethod === 8) resultBuf = zlib.inflateRawSync(compData);
                  else { pos += 46 + fnLen + extraLen + commentLen; continue; }

                  const { content } = extractTextFromBuffer(resultBuf);
                  fileResult = { success: true, content };
                  extractedCount++;
                } catch (err) {
                  fileResult = { success: false, error: err.message };
                }
              } else {
                fileResult = { success: false, error: '文件过大' };
              }
              // 逐文件推送给渲染进程
              event.sender.send('archive-file-extracted', { filePath: matchedKey, result: fileResult, index: filePaths.indexOf(matchedKey) });
            }
            pos += 46 + fnLen + extraLen + commentLen;
          }

          // 对未找到的文件推送失败
          for (let idx = 0; idx < filePaths.length; idx++) {
            if (!foundKeys.has(filePaths[idx])) {
              event.sender.send('archive-file-extracted', { filePath: filePaths[idx], result: { success: false, error: `文件未找到: ${filePaths[idx]}` }, index: idx });
            }
          }
        } finally {
          fs.closeSync(fd);
        }
        return { success: true, fileCount: filePaths.length };
      }

      // 🚀 非 ZIP 格式（.7z, .rar 等）：一次性 7z 提取所有文件，逐文件推送
      const { execSync } = require('child_process');
      const sevenZipPath = find7z();
      const has7z = !!sevenZipPath;

      if (!has7z) {
        for (let idx = 0; idx < filePaths.length; idx++) {
          event.sender.send('archive-file-extracted', { filePath: filePaths[idx], result: { success: false, error: '不支持的压缩格式或 7z 未安装' }, index: idx });
        }
        return { success: true, fileCount: filePaths.length };
      }

      const tempDir = os.tmpdir();
      const tempId = Date.now().toString(36) + Math.random().toString(36).substring(2);
      const tempExtractDir = path.join(tempDir, `logview_extract_${tempId}`);
      fs.mkdirSync(tempExtractDir, { recursive: true });

      try {
        // 一次性提取所有文件到同一个临时目录
        const fileArgs = filePaths.map(fp => `"${fp}"`).join(' ');
        const command = `"${sevenZipPath}" x -y -o"${tempExtractDir}" "${archivePath}" ${fileArgs}`;
        console.log(`[stream-extract] 批量提取命令: ${command}`);
        execSync(command, { encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 100 * 1024 * 1024 });

        // 按文件树顺序逐个读取并推送
        for (let idx = 0; idx < filePaths.length; idx++) {
          const fp = filePaths[idx];
          let extractedFilePath = path.join(tempExtractDir, fp.replace(/\\/g, '/'));

          if (!fs.existsSync(extractedFilePath) || fs.statSync(extractedFilePath).isDirectory()) {
            const candidate = path.join(tempExtractDir, path.basename(fp));
            if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
              extractedFilePath = candidate;
            }
          }

          // 递归查找
          if (!fs.existsSync(extractedFilePath) || fs.statSync(extractedFilePath).isDirectory()) {
            function _findFirstFile(dir) {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isFile()) return full;
                if (entry.isDirectory()) { const f = _findFirstFile(full); if (f) return f; }
              }
              return null;
            }
            const found = _findFirstFile(tempExtractDir);
            if (found) extractedFilePath = found;
          }

          let fileResult;
          if (fs.existsSync(extractedFilePath) && !fs.statSync(extractedFilePath).isDirectory()) {
            const buffer = fs.readFileSync(extractedFilePath);
            const { content } = extractTextFromBuffer(buffer);
            fileResult = { success: true, content };
          } else {
            fileResult = { success: false, error: `文件未找到: ${fp}` };
          }
          // 逐文件推送，携带文件树顺序索引
          event.sender.send('archive-file-extracted', { filePath: fp, result: fileResult, index: idx });
        }
      } catch (err) {
        // 批量提取失败，回退到逐个提取
        console.log(`[stream-extract] 批量提取失败，回退逐个提取: ${err.message}`);
        for (let idx = 0; idx < filePaths.length; idx++) {
          const fp = filePaths[idx];
          let fileResult;
          try {
            const tmpId2 = Date.now().toString(36) + Math.random().toString(36).substring(2);
            const tmpDir2 = path.join(tempDir, `logview_extract_${tmpId2}`);
            fs.mkdirSync(tmpDir2, { recursive: true });
            try {
              execSync(`"${sevenZipPath}" x -y -o"${tmpDir2}" "${archivePath}" "${fp}"`, { encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 100 * 1024 * 1024 });
              function _findFile(dir) {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                  const full = path.join(dir, entry.name);
                  if (entry.isFile()) return full;
                  if (entry.isDirectory()) { const f = _findFile(full); if (f) return f; }
                }
                return null;
              }
              const found = _findFile(tmpDir2);
              if (found) {
                const buffer = fs.readFileSync(found);
                const { content } = extractTextFromBuffer(buffer);
                fileResult = { success: true, content };
              } else {
                fileResult = { success: false, error: `文件未找到: ${fp}` };
              }
            } finally {
              fs.rmSync(tmpDir2, { recursive: true, force: true });
            }
          } catch (e2) {
            fileResult = { success: false, error: e2.message };
          }
          event.sender.send('archive-file-extracted', { filePath: fp, result: fileResult, index: idx });
        }
      } finally {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }

      return { success: true, fileCount: filePaths.length };
    }

    // 标准化目标文件路径集合（用于快速匹配）
    const targetSet = new Set();
    const targetLowerMap = new Map(); // lowercase -> original
    for (const fp of filePaths) {
      const normalized = fp.replace(/^\/+/, '').replace(/\\/g, '/');
      targetSet.add(normalized);
      targetLowerMap.set(normalized.toLowerCase(), normalized);
    }

    const results = {};
    let remaining = filePaths.length;

    await new Promise((resolve, reject) => {
      const rawStream = fs.createReadStream(archivePath, { highWaterMark: 1024 * 1024 });
      let decompressStream;

      if (isTarGz) {
        decompressStream = zlib.createGunzip();
      } else {
        // tar.bz2: 使用系统 tar 命令一次性提取所有目标文件（单次解压）
        rawStream.destroy();
        (async () => {
          const os = require('os');
          const { execSync } = require('child_process');
          const tmpDir = os.tmpdir();
          const tmpId = Date.now().toString(36) + Math.random().toString(36).substring(2);
          const tmpExtractDir = path.join(tmpDir, `logview_extract_${tmpId}`);
          fs.mkdirSync(tmpExtractDir, { recursive: true });
          try {
            // 构造文件列表参数，一次解压提取所有目标文件
            const fileArgs = filePaths.map(fp => `"${fp}"`).join(' ');
            execSync(`tar -xf "${archivePath}" -C "${tmpExtractDir}" ${fileArgs}`, {
              encoding: 'utf-8',
              windowsHide: true,
              timeout: 60000
            });
            for (const fp of filePaths) {
              // tar 可能保留子目录结构
              const baseName = fp.replace(/\\/g, '/').split('/').pop();
              const candidates = [
                path.join(tmpExtractDir, fp.replace(/\\/g, '/')),
                path.join(tmpExtractDir, baseName)
              ];
              let found = false;
              for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                  const buffer = fs.readFileSync(candidate);
                  const { content } = extractTextFromBuffer(buffer);
                  results[fp] = { success: true, content };
                  found = true;
                  break;
                }
              }
              if (!found) {
                results[fp] = { success: false, error: `文件未找到: ${fp}` };
              }
            }
          } catch (err) {
            for (const fp of filePaths) {
              if (!results[fp]) {
                results[fp] = { success: false, error: err.message };
              }
            }
          } finally {
            fs.rmSync(tmpExtractDir, { recursive: true, force: true });
          }
          resolve();
        })();
        return;
      }

      const tarStream = decompressStream;
      rawStream.pipe(decompressStream);

      // tar 流解析状态
      let state = 'header'; // 'header' | 'data' | 'padding'
      let headerBuf = Buffer.alloc(512);
      let headerPos = 0;
      let dataBuf = null;
      let dataPos = 0;
      let dataSize = 0;
      let currentFileName = '';
      let pendingLongName = null;  // GNU @@LongLink 长文件名
      let pendingLongLink = null;  // GNU @@LongLink 长链接名
      let resolved = false;

      function doResolve() {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }

      tarStream.on('data', (chunk) => {
        let offset = 0;
        while (offset < chunk.length) {
          if (state === 'header') {
            const needed = 512 - headerPos;
            const available = chunk.length - offset;
            const copyLen = Math.min(needed, available);
            chunk.copy(headerBuf, headerPos, offset, offset + copyLen);
            headerPos += copyLen;
            offset += copyLen;

            if (headerPos === 512) {
              // 检查是否为空块（tar 结束标记）
              if (headerBuf.readUInt8(0) === 0) {
                state = 'done';
                rawStream.destroy();
                return;
              }

              // 解析 typeflag（字节偏移 156）
              const typeflag = String.fromCharCode(headerBuf[156]);

              // 解析文件大小（八进制字符串）
              const sizeStr = headerBuf.toString('utf-8', 124, 136).replace(/\0+$/, '').trim();
              let fileSize = 0;
              if (sizeStr) {
                if (headerBuf[124] >= 0x80) {
                  for (let i = 125; i < 136; i++) {
                    fileSize = fileSize * 256 + headerBuf[i];
                  }
                } else {
                  fileSize = parseInt(sizeStr, 8) || 0;
                }
              }

              // GNU 长文件名扩展：typeflag 'L' 表示下一个数据块是长文件名
              // typeflag 'K' 表示长链接名
              if (typeflag === 'L' || typeflag === 'K') {
                if (fileSize > 0 && fileSize < 65536) {
                  dataSize = fileSize;
                  dataBuf = Buffer.alloc(fileSize);
                  dataPos = 0;
                  state = 'metadata'; // 特殊状态：收集长文件名数据
                } else {
                  // 跳过异常的长文件名
                  dataSize = fileSize;
                  dataBuf = null;
                  state = 'padding';
                }
                headerPos = 0;
                continue;
              }

              // 解析 tar 头部文件名
              const name = headerBuf.toString('utf-8', 0, 100).replace(/\0+$/, '');

              // UStar 格式：前缀 + 名字
              let fullName;
              const ustarMagic = headerBuf.toString('ascii', 257, 263);
              if (ustarMagic.startsWith('ustar') || ustarMagic.startsWith('ustar ')) {
                const prefixStr = headerBuf.toString('utf-8', 345, 500).replace(/\0+$/, '');
                fullName = prefixStr ? prefixStr + '/' + name : name;
              } else {
                fullName = name;
              }

              // 如果有 GNU 长文件名，优先使用
              if (typeflag !== 'K' && pendingLongName !== null) {
                fullName = pendingLongName;
                pendingLongName = null;
              }
              if (pendingLongLink !== null) {
                pendingLongLink = null;
              }

              // 标准化路径
              fullName = fullName.replace(/^\.\/+/, '').replace(/\\/g, '/');
              // 去除尾部斜杠（目录项）
              if (fullName.endsWith('/')) {
                fullName = fullName.slice(0, -1);
              }

              currentFileName = fullName;

              // 跳过目录、符号链接等非文件类型
              const isRegularFile = typeflag === '0' || typeflag === '\0' || typeflag === '';
              // PAX 扩展头 (x/g) 也跳过
              const isPaxHeader = typeflag === 'x' || typeflag === 'g';

              if (!isRegularFile || fileSize === 0 || isPaxHeader) {
                // 跳过此条目的数据
                dataSize = fileSize;
                dataBuf = null;
                state = 'padding';
                headerPos = 0;
                continue;
              }

              // 判断是否为目标文件
              const normalizedCurrent = currentFileName.replace(/^\/+/, '');
              const isTarget = targetSet.has(normalizedCurrent) ||
                targetLowerMap.has(normalizedCurrent.toLowerCase());

              if (isTarget && fileSize > 0) {
                dataSize = fileSize;
                dataBuf = Buffer.alloc(fileSize);
                dataPos = 0;
                state = 'data';
              } else {
                // 跳过此文件的数据
                dataSize = fileSize;
                dataBuf = null;
                state = 'padding';
              }

              headerPos = 0;
            }
          } else if (state === 'metadata') {
            // 收集 GNU 长文件名/长链接名数据
            const needed = dataSize - dataPos;
            const available = chunk.length - offset;
            const copyLen = Math.min(needed, available);
            chunk.copy(dataBuf, dataPos, offset, offset + copyLen);
            dataPos += copyLen;
            offset += copyLen;

            if (dataPos === dataSize) {
              // 提取长文件名（去掉尾部 null）
              const longName = dataBuf.toString('utf-8').replace(/\0+$/, '');
              const typeflag = String.fromCharCode(headerBuf[156]);
              if (typeflag === 'L') {
                pendingLongName = longName;
              } else if (typeflag === 'K') {
                pendingLongLink = longName;
              }
              dataBuf = null;

              // tar 块对齐填充
              const padding = (512 - (dataSize % 512)) % 512;
              if (padding === 0) {
                state = 'header';
                headerPos = 0;
              } else {
                dataSize = padding;
                state = 'padding';
              }
            }
          } else if (state === 'data') {
            const needed = dataSize - dataPos;
            const available = chunk.length - offset;
            const copyLen = Math.min(needed, available);
            chunk.copy(dataBuf, dataPos, offset, offset + copyLen);
            dataPos += copyLen;
            offset += copyLen;

            if (dataPos === dataSize) {
              // 文件数据读取完毕
              const normalizedCurrent = currentFileName.replace(/^\/+/, '');
              const matchKey = targetSet.has(normalizedCurrent)
                ? normalizedCurrent
                : targetLowerMap.get(normalizedCurrent.toLowerCase());

              if (matchKey) {
                const { content } = extractTextFromBuffer(dataBuf);
                results[matchKey] = { success: true, content };
                remaining--;
              }
              dataBuf = null;

              // 所有目标文件已找到，提前终止
              if (remaining <= 0) {
                state = 'done';
                rawStream.destroy();
                return;
              }

              // tar 块对齐填充
              const padding = (512 - (dataSize % 512)) % 512;
              if (padding === 0) {
                state = 'header';
                headerPos = 0;
              } else {
                dataSize = padding;
                state = 'padding';
              }
            }
          } else if (state === 'padding') {
            const skip = Math.min(dataSize, chunk.length - offset);
            offset += skip;
            dataSize -= skip;
            if (dataSize === 0) {
              state = 'header';
              headerPos = 0;
            }
          } else if (state === 'done') {
            return;
          }
        }
      });

      tarStream.on('end', () => {
        doResolve();
      });

      tarStream.on('close', () => {
        doResolve();
      });

      tarStream.on('error', (err) => {
        console.error('[stream-extract-from-archive] 解压流错误:', err);
        if (!resolved) reject(err);
      });

      rawStream.on('error', (err) => {
        console.error('[stream-extract-from-archive] 读取文件错误:', err);
        if (!resolved) reject(err);
      });
    });

    // 对于未找到的文件，填充错误
    for (const fp of filePaths) {
      const normalized = fp.replace(/^\/+/, '').replace(/\\/g, '/');
      if (!results[normalized] && !results[fp]) {
        results[fp] = { success: false, error: `文件未在压缩包中找到: ${fp}` };
      }
    }

    console.log(`[stream-extract-from-archive] 完成: 提取 ${filePaths.length} 个文件，成功 ${filePaths.length - remaining} 个`);
    return { success: true, results };
  } catch (error) {
    console.error('[stream-extract-from-archive] 错误:', error);
    return { success: false, error: error.message };
  }
});

// 🚀 解压压缩包到指定目录
ipcMain.handle('extract-archive', async (event, archivePath, targetPath) => {
  const { execSync } = require('child_process');
  const path = require('path');
  const fs = require('fs');

  try {
    console.log(`[extract-archive] 开始解压: ${archivePath} -> ${targetPath}`);

    if (!fs.existsSync(archivePath)) {
      return { success: false, error: '压缩包不存在' };
    }

    // 确保目标目录存在
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    // 检测文件类型以决定使用哪个命令
    const ext = path.extname(archivePath).toLowerCase();
    const fileName = path.basename(archivePath).toLowerCase();

    let sevenZipPath = find7z();
    let has7z = !!sevenZipPath;

    // 根据扩展名决定命令
    const use7z = isArchiveFile(archivePath);

    let command = '';
    if (use7z && has7z) {
      // 使用 7z 解压：x 表示完整路径解压（保持目录结构）
      command = `"${sevenZipPath}" x -y -o"${targetPath}" "${archivePath}"`;
    } else if (ext === '.tar' || ext === '.tgz' || fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
      // tar 格式
      if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
        command = `tar -xzf "${archivePath}" -C "${targetPath}"`;
      } else {
        command = `tar -xf "${archivePath}" -C "${targetPath}"`;
      }
    } else if (ext === '.gz' && !fileName.endsWith('.tar.gz')) {
      // 单独的 .gz 文件
      const outputFileName = path.basename(archivePath, '.gz');
      command = `gunzip -c "${archivePath}" > "${path.join(targetPath, outputFileName)}"`;
    } else {
      return { success: false, error: '不支持的压缩格式或 7z 未安装' };
    }

    console.log(`[extract-archive] 执行解压命令: ${command}`);

    // 执行解压命令
    execSync(command, {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 100 * 1024 * 1024 // 100MB buffer
    });

    console.log(`[extract-archive] 解压成功`);
    return { success: true };
  } catch (error) {
    console.error('[extract-archive] 解压失败:', error);
    return { success: false, error: error.message };
  }
});

// ============================================
// 🚀 临时目录管理 - 用于文件树选中时的自动解压
// ============================================

// 存储渲染进程的临时目录信息
const rendererTempDirs = new Map();

/**
 * 为渲染进程创建独一无二的临时目录
 */
ipcMain.handle('create-temp-extract-dir', async (event) => {
  const path = require('path');
  const fs = require('fs');
  const crypto = require('crypto');

  try {
    // 🔧 修复：正确计算应用目录
    // 在开发模式下：__dirname 是 resources/app，需要向上两级到达 ViLog 根目录
    // 在打包后：process.resourcesPath 指向 resources 目录
    let appDir;
    if (process.resourcesPath) {
      // 打包后的应用
      appDir = process.resourcesPath;
    } else {
      // 开发模式：从 __dirname (resources/app) 向上两级到项目根目录
      appDir = path.resolve(__dirname, '..', '..');
    }

    const baseTempDir = path.join(appDir, 'temp_extract');

    // 确保基础临时目录存在
    if (!fs.existsSync(baseTempDir)) {
      fs.mkdirSync(baseTempDir, { recursive: true });
    }

    // 生成唯一的临时目录名（使用时间戳 + 随机数）
    const uniqueId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const tempDirPath = path.join(baseTempDir, `session-${uniqueId}`);

    // 创建临时目录
    fs.mkdirSync(tempDirPath, { recursive: true });

    // 获取渲染进程的 ID（使用 webContents 的 ID）
    const rendererId = event.sender.id;

    // 如果该渲染进程已有临时目录，先清空
    if (rendererTempDirs.has(rendererId)) {
      const oldDir = rendererTempDirs.get(rendererId);
      if (fs.existsSync(oldDir)) {
        fs.rmSync(oldDir, { recursive: true, force: true });
        console.log(`[temp-extract] 已清理旧临时目录: ${oldDir}`);
      }
    }

    // 保存新的临时目录路径
    rendererTempDirs.set(rendererId, tempDirPath);

    console.log(`[temp-extract] 应用目录: ${appDir}`);
    console.log(`[temp-extract] 创建临时目录: ${tempDirPath}`);
    return { success: true, tempDir: tempDirPath };
  } catch (error) {
    console.error('[temp-extract] 创建临时目录失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 清空临时目录中的所有文件（保留目录本身）
 */
ipcMain.handle('clear-temp-extract-dir', async (event) => {
  const path = require('path');
  const fs = require('fs');

  try {
    const rendererId = event.sender.id;
    const tempDir = rendererTempDirs.get(rendererId);

    if (!tempDir) {
      console.log(`[temp-extract] 渲染进程 ${rendererId} 没有临时目录`);
      return { success: true };
    }

    if (!fs.existsSync(tempDir)) {
      console.log(`[temp-extract] 临时目录不存在: ${tempDir}`);
      return { success: true };
    }

    // 清空目录内容
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }

    console.log(`[temp-extract] 已清空临时目录: ${tempDir} (${files.length} 项)`);
    return { success: true };
  } catch (error) {
    console.error('[temp-extract] 清空临时目录失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 解压文件到临时目录
 */
ipcMain.handle('extract-to-temp-dir', async (event, archivePath, relativePath) => {
  const path = require('path');
  const fs = require('fs');
  const { execSync } = require('child_process');

  try {
    const rendererId = event.sender.id;
    const tempDir = rendererTempDirs.get(rendererId);

    if (!tempDir) {
      return { success: false, error: '临时目录不存在，请先创建临时目录' };
    }

    // 如果是压缩包内的文件，需要先解压整个压缩包
    if (relativePath) {
      // 这是一个压缩包内的文件，需要解压整个压缩包
      const archiveName = path.basename(archivePath);
      const extractDir = path.join(tempDir, archiveName);

      // 确保目标目录存在
      if (!fs.existsSync(extractDir)) {
        fs.mkdirSync(extractDir, { recursive: true });
      }

      console.log(`[temp-extract] 解压 ${archivePath} -> ${extractDir}`);

      // 调用现有的解压功能
      const result = await extractArchiveToDir(archivePath, extractDir);
      if (!result.success) {
        return result;
      }

      // 返回解压后的文件路径
      const extractedFilePath = path.join(extractDir, relativePath);
      return {
        success: true,
        extractedPath: extractedFilePath,
        extractDir: extractDir
      };
    } else {
      // 这是一个普通的压缩包文件，直接解压
      const archiveName = path.basename(archivePath, path.extname(archivePath));
      const extractDir = path.join(tempDir, archiveName);

      // 确保目标目录存在
      if (!fs.existsSync(extractDir)) {
        fs.mkdirSync(extractDir, { recursive: true });
      }

      console.log(`[temp-extract] 解压 ${archivePath} -> ${extractDir}`);

      // 调用现有的解压功能
      const result = await extractArchiveToDir(archivePath, extractDir);
      if (!result.success) {
        return result;
      }

      return {
        success: true,
        extractDir: extractDir
      };
    }
  } catch (error) {
    console.error('[temp-extract] 解压到临时目录失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 删除临时目录（渲染进程关闭时调用）
 */
ipcMain.handle('delete-temp-extract-dir', async (event) => {
  const path = require('path');
  const fs = require('fs');

  try {
    const rendererId = event.sender.id;
    const tempDir = rendererTempDirs.get(rendererId);

    if (!tempDir) {
      return { success: true };
    }

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`[temp-extract] 已删除临时目录: ${tempDir}`);
    }

    rendererTempDirs.delete(rendererId);
    return { success: true };
  } catch (error) {
    console.error('[temp-extract] 删除临时目录失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 获取临时目录路径
 */
ipcMain.handle('get-temp-extract-dir', async (event) => {
  try {
    const rendererId = event.sender.id;
    const tempDir = rendererTempDirs.get(rendererId);

    if (!tempDir) {
      return { success: false, error: '临时目录不存在' };
    }

    return { success: true, tempDir: tempDir };
  } catch (error) {
    console.error('[temp-extract] 获取临时目录失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 通用解压函数（从 extract-archive IPC 处理器中提取）
 */
async function extractArchiveToDir(archivePath, targetPath) {
  const { execSync } = require('child_process');
  const path = require('path');
  const fs = require('fs');

  try {
    if (!fs.existsSync(archivePath)) {
      return { success: false, error: '压缩包不存在' };
    }

    // 确保目标目录存在
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    // 检测文件类型以决定使用哪个命令
    const ext = path.extname(archivePath).toLowerCase();
    const fileName = path.basename(archivePath).toLowerCase();

    let sevenZipPath = find7z();
    let has7z = !!sevenZipPath;

    // 根据扩展名决定命令
    const use7z = isArchiveFile(archivePath);

    let command = '';
    if (use7z && has7z) {
      // 使用 7z 解压：x 表示完整路径解压（保持目录结构）
      command = `"${sevenZipPath}" x -y -o"${targetPath}" "${archivePath}"`;
    } else if (ext === '.tar' || ext === '.tgz' || fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
      // tar 格式
      if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
        command = `tar -xzf "${archivePath}" -C "${targetPath}"`;
      } else {
        command = `tar -xf "${archivePath}" -C "${targetPath}"`;
      }
    } else if (ext === '.gz' && !fileName.endsWith('.tar.gz')) {
      // 单独的 .gz 文件
      const outputFileName = path.basename(archivePath, '.gz');
      command = `gunzip -c "${archivePath}" > "${path.join(targetPath, outputFileName)}"`;
    } else {
      return { success: false, error: '不支持的压缩格式或 7z 未安装' };
    }

    console.log(`[extract-archive] 执行解压命令: ${command}`);

    // 执行解压命令
    execSync(command, {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 100 * 1024 * 1024 // 100MB buffer
    });

    console.log(`[extract-archive] 解压成功`);
    return { success: true };
  } catch (error) {
    console.error('[extract-archive] 解压失败:', error);
    return { success: false, error: error.message };
  }
}

// ============================================

// 显示文件夹选择对话框 - 当找到多个同名文件夹时使用
ipcMain.handle('show-folder-selection-dialog', async (event, options) => {
  const { folderName, matches } = options;

  if (!matches || matches.length === 0) {
    return { cancelled: true };
  }

  // 如果只有一个匹配，直接返回
  if (matches.length === 1) {
    return { cancelled: false, selectedPath: matches[0] };
  }

  // 构建选择按钮
  const buttons = matches.map((m, i) => `${i + 1}. ${m}`);
  buttons.push('取消');

  // 显示对话框
  const result = await dialog.showMessageBox({
    type: 'question',
    title: '选择文件夹',
    message: `找到多个同名文件夹 "${folderName}"`,
    detail: `请选择要展开的文件夹：\n\n${matches.map((m, i) => `${i + 1}. ${m}`).join('\n')}`,
    buttons: buttons,
    defaultId: 0,
    cancelId: matches.length,
    noLink: true
  });

  if (result.response === matches.length) {
    // 用户点击了取消
    return { cancelled: true };
  } else {
    // 用户选择了一个文件夹
    return {
      cancelled: false,
      selectedPath: matches[result.response]
    };
  }
});

// 复制文件到临时目录 - 用于WinRAR等工具的拖拽
ipcMain.handle('copy-files-to-temp', async (event, filePaths) => {
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  const fs = require('fs');

  try {
    console.log('📦 开始复制文件到临时目录:', filePaths);

    // 创建临时目录
    const tempDir = os.tmpdir();
    const tempId = crypto.randomBytes(8).toString('hex');
    const tempSubDir = path.join(tempDir, `logview_winrar_${tempId}`);

    // 确保临时目录存在
    if (!fs.existsSync(tempSubDir)) {
      fs.mkdirSync(tempSubDir, { recursive: true });
    }

    console.log('✅ 临时目录创建成功:', tempSubDir);

    // 复制文件
    const copiedFiles = [];
    for (const sourcePath of filePaths) {
      try {
        if (!fs.existsSync(sourcePath)) {
          console.warn('⚠️ 源文件不存在:', sourcePath);
          continue;
        }

        const stats = fs.statSync(sourcePath);
        const fileName = path.basename(sourcePath);
        const targetPath = path.join(tempSubDir, fileName);

        if (stats.isFile()) {
          // 复制文件
          fs.copyFileSync(sourcePath, targetPath);
          copiedFiles.push(targetPath);
          console.log(`✅ 已复制文件: ${fileName}`);
        } else if (stats.isDirectory()) {
          // 递归复制目录
          copyDirectorySync(sourcePath, targetPath);
          copiedFiles.push(targetPath);
          console.log(`✅ 已复制目录: ${fileName}`);
        }
      } catch (error) {
        console.error(`❌ 复制失败: ${sourcePath}`, error);
      }
    }

    console.log(`📦 复制完成: ${copiedFiles.length} 个文件/文件夹`);

    return {
      success: true,
      tempDir: tempSubDir,
      files: copiedFiles
    };
  } catch (error) {
    console.error('复制文件到临时目录失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 递归复制目录的辅助函数（使用公共 copyDirRecursive）
const copyDirectorySync = copyDirRecursive;

// 递归在目录中搜索文件
function searchFileInDirectory(dirPath, fileName) {
  const fs = require('fs');
  const path = require('path');

  try {
    const maxDepth = 5; // 最大搜索深度，避免搜索太深
    const results = [];
    let searchedDirs = 0;
    let searchedFiles = 0;

    console.log(`🔎 开始递归搜索: 目录=${dirPath}, 文件名=${fileName}, 最大深度=${maxDepth}`);

    function searchRecursive(currentPath, currentDepth) {
      if (currentDepth > maxDepth) return;

      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        searchedDirs++;

        // 记录每个扫描的目录（前10个）
        if (searchedDirs <= 10) {
          console.log(`  📂 扫描目录 [${currentDepth}]: ${currentPath}, 条目数: ${entries.length}`);
        }

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          if (entry.isDirectory()) {
            // 递归搜索子目录
            searchRecursive(fullPath, currentDepth + 1);
          } else if (entry.isFile()) {
            searchedFiles++;
            if (entry.name === fileName) {
              // 找到匹配的文件
              try {
                const stats = fs.statSync(fullPath);
                results.push({
                  fullPath: fullPath,
                  mtime: stats.mtime,
                  size: stats.size
                });
                console.log(`  ✅ 找到匹配文件: ${fullPath}`);
              } catch (e) {
                console.error(`  ⚠️ 获取文件状态失败: ${fullPath}`, e.message);
              }
            }
          }
        }
      } catch (e) {
        console.warn(`  ⚠️ 无法访问目录: ${currentPath}`, e.message);
      }
    }

    searchRecursive(dirPath, 0);

    console.log(`🔊 搜索完成: 扫描了 ${searchedDirs} 个目录, ${searchedFiles} 个文件, 找到 ${results.length} 个匹配`);

    if (results.length > 0) {
      // 如果找到多个文件，选择最新的
      results.sort((a, b) => b.mtime - a.mtime);
      const latest = results[0];

      console.log(`🎯 选择的文件: ${latest.fullPath} (修改时间: ${latest.mtime})`);

      return {
        found: true,
        fullPath: latest.fullPath,
        isDirectory: false,
        size: latest.size,
        matchCount: results.length
      };
    }

    console.log(`❌ 未找到文件: ${fileName}`);
    return { found: false };
  } catch (error) {
    console.error('搜索文件失败:', error);
    return { found: false };
  }
}

// 递归复制目录（使用公共 copyDirRecursive）
const copyDirectoryRecursive = copyDirRecursive;

// 解析WinRAR相对路径 - WinRAR拖拽时提供的路径是相对路径，需要结合临时目录解析
ipcMain.handle('resolve-winrar-path', async (event, relativePath, isDirectory) => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');

  try {
    console.log('=== WinRAR 路径解析开始 ===');
    console.log('🔍 尝试解析WinRAR相对路径:', relativePath);
    console.log('📂 是否为目录:', isDirectory);

    // 检查是否是相对路径（没有盘符）
    if (!relativePath || /^[A-Za-z]:/.test(relativePath)) {
      console.log('⚠️ 不是相对路径，跳过处理');
      return {
        success: false,
        originalPath: relativePath,
        error: '不是相对路径'
      };
    }

    // 获取系统临时目录
    const tempDir = os.tmpdir();
    console.log('📁 系统临时目录:', tempDir);

    // 提取相对路径的第一段（文件夹名）
    const segments = relativePath.split(path.sep).filter(s => s.length > 0);
    if (segments.length === 0) {
      return {
        success: false,
        originalPath: relativePath,
        error: '无效的相对路径'
      };
    }

    const firstSegment = segments[0];
    console.log('🔍 查找文件夹:', firstSegment);

    // === 🚀 特殊处理：先尝试在用户工作目录中搜索（适用于 Bandizip） ===
    console.log('🔍 尝试在工作目录中搜索 (Bandizip 支持)...');
    const userWorkDir = process.env.USERPROFILE || process.env.HOME || '.';
    const searchPaths = [
      path.join(userWorkDir, 'AppData', 'Local', 'Temp'),
      path.join(userWorkDir, 'AppData', 'Local', 'Bandizip', 'Temp'),
      os.tmpdir()
    ];

    for (const searchDir of searchPaths) {
      if (!fs.existsSync(searchDir)) continue;

      console.log(`  🔍 搜索目录: ${searchDir}`);
      try {
        const searchResult = searchFileInDirectory(searchDir, firstSegment);
        if (searchResult.found) {
          console.log(`✅ 找到匹配路径 (Bandizip): ${searchResult.fullPath}`);
          return {
            success: true,
            originalPath: relativePath,
            fullPath: searchResult.fullPath,
            isDirectory: searchResult.isDirectory,
            size: searchResult.size,
            isBandizip: true
          };
        }
      } catch (e) {
        // 忽略搜索错误，继续下一个目录
      }
    }

    // === WinRAR 特殊处理：搜索 Rar$DR*.rartemp 目录 ===
    console.log('🔍 搜索 WinRAR 临时目录 (Rar$DR*.rartemp)...');
    const tempEntries = fs.readdirSync(tempDir, { withFileTypes: true });
    const winRarTempDirs = tempEntries
      .filter(e => e.isDirectory() && /^Rar\$DR.*\.rartemp$/.test(e.name))
      .map(e => e.name);

    console.log(`📂 找到 ${winRarTempDirs.length} 个 WinRAR 临时目录:`, winRarTempDirs);

    let foundWinRarPath = null;
    let matchedWinRarDir = null;

    // 在每个 WinRAR 临时目录中搜索匹配的路径
    for (const winRarDir of winRarTempDirs) {
      const winRarBasePath = path.join(tempDir, winRarDir);
      const testPath = path.join(winRarBasePath, relativePath);

      console.log(`  🔍 检查路径: ${testPath}`);

      if (fs.existsSync(testPath)) {
        foundWinRarPath = testPath;
        matchedWinRarDir = winRarBasePath;
        console.log(`✅ 找到匹配路径: ${foundWinRarPath}`);
        break;
      }
    }

    if (foundWinRarPath) {
      // === 找到 WinRAR 临时路径，直接使用不复制 ===
      console.log('✅ 找到WinRAR临时路径，直接使用');

      const stats = fs.statSync(foundWinRarPath);
      const isActuallyDirectory = stats.isDirectory();

      console.log(`📂 路径类型检查: ${foundWinRarPath}`);
      console.log(`  - 传入isDirectory: ${isDirectory}`);
      console.log(`  - 实际是目录: ${isActuallyDirectory}`);

      // 获取相对于WinRAR临时目录的路径
      const relativeFilePath = path.relative(matchedWinRarDir, foundWinRarPath);
      const pathSegments = relativeFilePath.split(path.sep);

      // 查找用户相对路径的最后一段在完整路径中的位置
      let targetSegmentIndex = pathSegments.length - 1; // 默认使用完整路径
      for (let i = 0; i < pathSegments.length; i++) {
        if (pathSegments[i] === segments[segments.length - 1]) {
          targetSegmentIndex = i;
          break;
        }
      }

      // 构建要返回的路径（WinRAR临时目录中的实际路径）
      const returnPath = path.join(matchedWinRarDir, pathSegments.slice(0, targetSegmentIndex + 1).join(path.sep));

      console.log(`📂 返回路径: ${returnPath}`);
      console.log(`📂 路径段数: ${targetSegmentIndex + 1}/${pathSegments.length}`);

      return {
        success: true,
        originalPath: relativePath,
        fullPath: returnPath,
        isDirectory: true, // 作为目录处理，供文件树懒加载
        size: stats.size,
        isWinRAR: true,
        persistentTempDir: returnPath // 直接使用WinRAR临时目录
      };
    }

    // === 如果不是 WinRAR，使用原有逻辑 ===
    console.log('⚠️ 未找到 WinRAR 临时目录，使用原有逻辑...');

    // 策略1: 尝试文件夹名匹配
    let matchedFolder = null;
    for (const entry of tempEntries) {
      if (entry.isDirectory() && entry.name === firstSegment) {
        matchedFolder = entry.name;
        break;
      }
    }

    // 如果没有完全匹配，尝试模糊匹配
    if (!matchedFolder) {
      for (const entry of tempEntries) {
        if (entry.isDirectory() && entry.name.startsWith(firstSegment.substring(0, 10))) {
          matchedFolder = entry.name;
          console.log('✅ 找到模糊匹配的文件夹:', matchedFolder);
          break;
        }
      }
    }

    // 策略2: 递归搜索
    if (!matchedFolder) {
      console.log('⚠️ 文件夹名匹配失败，尝试递归搜索...');
      const fileName = segments[segments.length - 1];
      const searchResult = searchFileInDirectory(tempDir, fileName);

      if (searchResult.found) {
        console.log('✅ 通过递归搜索找到:', searchResult.fullPath);
        return {
          success: true,
          originalPath: relativePath,
          fullPath: searchResult.fullPath,
          isDirectory: searchResult.isDirectory,
          size: searchResult.size,
          searchMethod: 'recursive'
        };
      } else {
        console.log('❌ 未找到匹配文件');
        return {
          success: false,
          originalPath: relativePath,
          error: '未找到匹配的文件'
        };
      }
    }

    const fullPath = path.join(tempDir, matchedFolder, ...segments.slice(1));

    if (!fs.existsSync(fullPath)) {
      return {
        success: false,
        originalPath: relativePath,
        error: '文件不存在'
      };
    }

    const stats = fs.statSync(fullPath);

    return {
      success: true,
      originalPath: relativePath,
      fullPath: fullPath,
      isDirectory: stats.isDirectory(),
      size: stats.size
    };
  } catch (error) {
    console.error('解析WinRAR路径失败:', error);
    return {
      success: false,
      originalPath: relativePath,
      error: error.message
    };
  }
});

// 保存渲染进程日志
ipcMain.handle('save-log', async (event, { level, message, data }) => {
  try {
    if (!logWriteStream) {
      return { success: false, error: '日志系统未初始化' };
    }

    const timestamp = new Date().toISOString();
    let logMessage = message;

    // 处理数据对象
    if (data) {
      if (typeof data === 'object') {
        try {
          logMessage += ' ' + JSON.stringify(data, null, 2);
        } catch (e) {
          logMessage += ' ' + String(data);
        }
      } else {
        logMessage += ' ' + String(data);
      }
    }

    const logLine = `[${timestamp}] [RENDERER:${level}] ${logMessage}\n`;
    logWriteStream.write(logLine);

    return { success: true };
  } catch (error) {
    console.error('保存日志失败:', error);
    return { success: false, error: error.message };
  }
});

// 获取日志文件路径
ipcMain.handle('get-log-file-path', async () => {
  return {
    success: true,
    logFilePath: logFilePath,
    logsDir: path.join(app.getPath('userData'), 'logs')
  };
});

// 获取当前工作目录
ipcMain.handle('get-cwd', async () => {
  return process.cwd();
});

// 获取系统资源信息（CPU和内存占用率）
ipcMain.handle('get-system-stats', async () => {
  try {
    // 获取系统内存信息
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

    // 获取CPU使用率（通过计算两次CPU时间差）
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    // 简单计算：当前瞬间CPU使用率
    // 注意：这不是精确的实时使用率，需要采样两次时间点计算
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const cpuPercent = (100 - (100 * idle / total)).toFixed(1);

    // 获取所有Electron进程的内存使用总和
    let electronMemMB = 0;

    if (process.platform === 'win32') {
      // Windows: 使用 tasklist 命令获取所有 electron.exe 进程的内存
      try {
        const { execSync } = require('child_process');
        const tasklistOutput = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO CSV', {
          encoding: 'utf8',
          windowsHide: true
        });

        // 解析 tasklist 输出，计算总内存
        const lines = tasklistOutput.split('\n').slice(1); // 跳过标题行
        let totalMemKB = 0;
        let processCount = 0;

        for (const line of lines) {
          if (!line.trim()) continue;

          // CSV格式: "electron.exe","12345 K" 或 "electron.exe","123.456 K" (某些区域使用点作为千位分隔符)
          // 使用更灵活的正则，匹配逗号或点作为千位分隔符
          const match = line.match(/"electron\.exe","([\d,\.]+) K"/);
          if (match) {
            // 移除所有千位分隔符（逗号或点）
            const memKB = parseInt(match[1].replace(/[,\.]/g, ''), 10);
            if (!isNaN(memKB)) {
              totalMemKB += memKB;
              processCount++;
            }
          }
        }

        // 如果 tasklist 没有获取到任何进程内存，使用当前进程内存作为后备
        if (totalMemKB > 0) {
          electronMemMB = (totalMemKB / 1024).toFixed(0);
        } else {
          // 静默回退到当前进程内存，避免刷屏日志
          const processMem = process.memoryUsage();
          electronMemMB = (processMem.rss / 1024 / 1024).toFixed(0);
        }
      } catch (error) {
        // 静默回退到使用当前进程内存
        const processMem = process.memoryUsage();
        electronMemMB = (processMem.rss / 1024 / 1024).toFixed(0);
      }
    } else {
      // 非 Windows 平台：使用当前进程内存（实际应该用 ps 命令获取所有进程）
      const processMem = process.memoryUsage();
      electronMemMB = (processMem.rss / 1024 / 1024).toFixed(0);
    }

    return {
      cpuPercent: Math.max(0, Math.min(100, cpuPercent)), // 限制在0-100范围
      memPercent: parseFloat(memPercent),
      usedMemMB: (usedMem / 1024 / 1024).toFixed(0),
      totalMemMB: (totalMem / 1024 / 1024).toFixed(0),
      electronMemMB: electronMemMB // Electron进程内存占用
    };
  } catch (error) {
    console.error('获取系统资源信息失败:', error);
    return {
      cpuPercent: 0,
      memPercent: 0,
      usedMemMB: 0,
      totalMemMB: 0,
      electronMemMB: 0
    };
  }
});

// 获取拖拽文件的完整路径（供懒加载使用）
ipcMain.handle('get-dropped-path', async () => {
  return droppedFilePath || '';
});

// 获取窗口预览内容
ipcMain.handle('get-window-preview', async (event, windowId) => {
  const win = windows.find(w => w.windowId === windowId);
  if (!win || win.isDestroyed()) {
    return { lines: [] };
  }

  try {
    // 尝试从窗口获取预览内容
    const result = await win.webContents.executeJavaScript(`
      (() => {
        // 获取当前显示的行（最多10行）
        const lines = [];
        const logContent = document.getElementById('logContent');
        if (logContent && logContent.children) {
          const children = logContent.children;
          const start = Math.max(0, children.length - 20);
          for (let i = start; i < Math.min(children.length, start + 10); i++) {
            if (children[i] && children[i].textContent) {
              lines.push(children[i].textContent.trim().substring(0, 100));
            }
          }
        }
        return { lines: lines };
      })()
    `);
    return result;
  } catch (error) {
    return { lines: ['无法获取预览内容'] };
  }
});

// 创建系统托盘
function createTray() {
  try {
    // 尝试使用自定义图标
    const iconPath = path.join(__dirname, 'icons', 'icon.png');
    const iconIco = path.join(__dirname, 'icons', 'icon.ico');
    
    let iconFile = null;
    if (fs.existsSync(iconPath)) {
      iconFile = iconPath;
    } else if (fs.existsSync(iconIco)) {
      iconFile = iconIco;
    }
    
    // 如果没有图标文件，跳过托盘创建（某些平台需要图标）
    if (!iconFile && process.platform === 'linux') {
      console.log('跳过系统托盘：未找到图标文件');
      return;
    }
    
    tray = new Tray(iconFile || app.getAppPath());
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusWindowSafe(focusedWindow);
          } else if (windows.length > 0) {
            focusWindowSafe(windows[0]);
          } else {
            createWindow();
          }
        }
      },
      {
        label: '最小化到托盘',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusedWindow.minimize();
          } else if (windows.length > 0) {
            windows[0].minimize();
          }
        }
      },
      {
        label: '新建窗口',
        click: () => {
          createWindow();
        }
      },
      { type: 'separator' },
      {
        label: '开发者工具',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            if (focusedWindow.webContents.isDevToolsOpened()) {
              focusedWindow.webContents.closeDevTools();
            } else {
              focusedWindow.webContents.openDevTools();
            }
          }
        }
      },
      { type: 'separator' },
      {
        label: '退出应用',
        click: () => {
          appIsQuitting = true;
          // 关闭所有窗口
          windows.forEach(win => {
            if (!win.isDestroyed()) {
              win.destroy();
            }
          });
          app.quit();
        }
      }
    ]);

    tray.setToolTip('日志查看器 - 高性能日志分析工具');
    tray.setContextMenu(contextMenu);

    // 双击托盘图标显示/隐藏窗口
    tray.on('double-click', () => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
        if (focusedWindow.isVisible()) {
          focusedWindow.hide();
        } else {
          focusWindowSafe(focusedWindow);
        }
      } else if (windows.length > 0) {
        focusWindowSafe(windows[0]);
      } else {
        createWindow();
      }
    });

    // 单击托盘图标显示/隐藏窗口
    tray.on('click', () => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
        if (focusedWindow.isVisible()) {
          focusedWindow.minimize();
        } else {
          focusWindowSafe(focusedWindow);
        }
      } else if (windows.length > 0) {
        focusWindowSafe(windows[0]);
      } else {
        createWindow();
      }
    });
  } catch (error) {
    console.error('创建系统托盘失败:', error);
    // 托盘创建失败不影响主应用运行
  }
}

// Electron 初始化完成后创建窗口
app.whenReady().then(() => {
  // 只有单实例模式才初始化
  if (gotTheLock) {
    // 初始化日志系统（必须在最前面）
    initLogSystem();

    // 检测Python命令（性能优化：启动时检测一次）
    detectPythonCommand();

    // 移除菜单栏
    Menu.setApplicationMenu(null);

    // 创建系统托盘（可选）
    createTray();

    // 启动 Windows 服务端进程
    startEngineProcess();

    createWindow();

    // 注册全局快捷键打开开发者工具 (Ctrl+Shift+I)
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      if (focusedWindow.webContents.isDevToolsOpened()) {
        focusedWindow.webContents.closeDevTools();
      } else {
        focusedWindow.webContents.openDevTools();
      }
    }
  });

  // 注册 Ctrl+Shift+J 打开开发者工具的控制台面板
  globalShortcut.register('CommandOrControl+Shift+J', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      if (focusedWindow.webContents.isDevToolsOpened()) {
        focusedWindow.webContents.closeDevTools();
      } else {
        focusedWindow.webContents.openDevTools();
      }
    }
  });

  // 注册F12打开开发者工具
  globalShortcut.register('F12', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      if (focusedWindow.webContents.isDevToolsOpened()) {
        focusedWindow.webContents.closeDevTools();
      } else {
        focusedWindow.webContents.openDevTools();
      }
    }
  });

  app.on('activate', () => {
    // 在 macOS 上，当点击 dock 图标并且没有其他窗口打开时，
    // 通常在应用程序中重新创建一个窗口
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      // 恢复最小化的窗口
      BrowserWindow.getAllWindows().forEach(win => focusWindowSafe(win));

      // 处理待导入的文件
      if (pendingFiles.length > 0) {
        const filesToImport = [...pendingFiles];
        pendingFiles = []; // 清空待处理文件列表

        // 延迟发送消息，确保窗口已完全恢复
        setTimeout(() => {
          filesToImport.forEach(filePath => {
            // 发送文件路径给渲染进程处理
            allWindows.forEach(win => {
              if (win.webContents && !win.webContents.isDestroyed()) {
                win.webContents.send('import-file-from-taskbar', filePath);
              }
            });
          });
        }, 300);
      }
    }
  });
  } // 🚀 单实例模式结束
});

// 处理从任务栏拖放文件到最小化窗口的事件
app.on('open-file', (event, path) => {
  event.preventDefault();

  // 检查是否有窗口
  const allWindows = BrowserWindow.getAllWindows();

  if (allWindows.length === 0) {
    // 如果没有窗口，创建一个并将文件保存到待处理列表
    pendingFiles.push(path);
    return;
  }

  // 检查所有窗口是否都已最小化
  const allMinimized = allWindows.every(win => win.isMinimized());

  if (allMinimized) {
    // 所有窗口都已最小化，保存文件到待处理列表
    pendingFiles.push(path);
    // 窗口恢复时会自动处理这些文件（在 activate 事件中）
  } else {
    // 有窗口可见，直接处理文件
    allWindows.forEach(win => {
      if (!win.isMinimized() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('import-file-from-taskbar', path);
      }
    });
  }
});

// 当所有窗口都被关闭时退出应用（除了 macOS）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前关闭日志系统
app.on('before-quit', () => {
  closeLogSystem();
});

// 🚀 文件系统监听器管理
const fsWatchers = new Map(); // path -> fs.FSWatcher

// 监听目录变化
ipcMain.handle('watch-directory', async (event, dirPath) => {
  try {
    // 如果已经在监听，先停止
    if (fsWatchers.has(dirPath)) {
      fsWatchers.get(dirPath).close();
      fsWatchers.delete(dirPath);
    }

    // 检查目录是否存在
    if (!fs.existsSync(dirPath)) {
      return { success: false, error: '目录不存在' };
    }

    // 创建监听器
    const watcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
      if (!filename) return;

      console.log(`[文件监听] ${dirPath} 变化: ${eventType} ${filename}`);

      // 通知所有窗口
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send('directory-changed', {
            dirPath,
            eventType,
            filename
          });
        }
      });
    });

    watcher.on('error', (error) => {
      console.error(`[文件监听] 错误:`, error);
    });

    fsWatchers.set(dirPath, watcher);

    return { success: true };
  } catch (error) {
    console.error('[文件监听] 启动失败:', error);
    return { success: false, error: error.message };
  }
});

// 停止监听目录
ipcMain.handle('unwatch-directory', async (event, dirPath) => {
  try {
    if (fsWatchers.has(dirPath)) {
      fsWatchers.get(dirPath).close();
      fsWatchers.delete(dirPath);
      console.log(`[文件监听] 已停止监听: ${dirPath}`);
      return { success: true };
    }
    return { success: false, error: '未找到监听器' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// =====================================================================
// 🚀 远程目录共享 API
// =====================================================================

// 启动本地共享服务器
ipcMain.handle('start-local-share', async (event, { sharePath, port }) => {
  try {
    console.log(`[远程共享] 启动服务器: ${sharePath}, port: ${port}`);
    const result = await startLocalServer(sharePath, port || 8080);
    return { success: true, ...result };
  } catch (error) {
    console.error('[远程共享] 启动失败:', error);
    return { success: false, error: error.message };
  }
});

// 停止本地共享服务器
ipcMain.handle('stop-local-share', async () => {
  try {
    await stopLocalServer();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取本地共享状态
ipcMain.handle('get-local-share-status', () => {
  const info = getLocalServerInfo();
  if (info) {
    return { success: true, ...info };
  }
  return { success: false, running: false };
});

// 连接到远程共享
ipcMain.handle('connect-remote', async (event, { ip, port, remotePath }) => {
  try {
    console.log(`[远程连接] 连接到 ${ip}:${port}, path: ${remotePath}`);
    const result = await listRemoteDirectory(ip, port, remotePath || '');
    return result;
  } catch (error) {
    console.error('[远程连接] 失败:', error);
    return { success: false, error: error.message };
  }
});

// 读取远程文件
ipcMain.handle('read-remote-file', async (event, { ip, port, filePath }) => {
  try {
    console.log(`[远程读取] ${ip}:${port} -> ${filePath}`);
    const result = await readRemoteFile(ip, port, filePath);
    return result;
  } catch (error) {
    console.error('[远程读取] 失败:', error);
    return { success: false, error: error.message };
  }
});

// 获取远程目录树（首次加载）
ipcMain.handle('get-remote-tree', async (event, { ip, port, remotePath }) => {
  try {
    console.log(`[远程树] 获取 ${ip}:${port} -> ${remotePath}`);
    const result = await getRemoteTree(ip, port, remotePath || '');
    return result;
  } catch (error) {
    console.error('[远程树] 失败:', error);
    return { success: false, error: error.message };
  }
});

// 🚀 列出远程压缩包内容（完全使用 7z）
ipcMain.handle('list-remote-archive', async (event, { ip, port, filePath }) => {
  const { execSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const fs = require('fs');

  try {
    console.log(`[远程压缩包] 列出内容 ${ip}:${port} -> ${filePath}`);

    // 1. 从远程服务器读取压缩包内容
    const readResult = await readRemoteFile(ip, port, filePath);
    console.log(`[远程压缩包] 读取结果: success=${readResult.success}, hasContent=${!!readResult.content}, contentLength=${readResult.content?.length || 0}`);

    if (!readResult.success) {
      return { success: false, error: readResult.error || '读取远程压缩包失败', items: [] };
    }

    // 2. 保存到临时文件
    const tempDir = os.tmpdir();
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(tempDir, `remote-archive-${Date.now()}-${fileName}`);

    // 检查 content 是否已经是 base64
    let buffer;
    if (readResult.encoding === 'base64') {
      // 服务器已经返回 base64，转换回 Buffer
      buffer = Buffer.from(readResult.content, 'base64');
      console.log(`[远程压缩包] 从 base64 转换为 Buffer，大小: ${buffer.length}`);
    } else {
      // 服务器返回的是文本（不应该发生），尝试转换
      console.warn(`[远程压缩包] 警告：content 不是 base64 编码，encoding=${readResult.encoding}`);
      buffer = Buffer.from(readResult.content, 'utf8');
    }

    fs.writeFileSync(tempFilePath, buffer);
    console.log(`[远程压缩包] 已保存到临时文件: ${tempFilePath}, 实际大小: ${buffer.length}`);

    // 验证文件是否有效（读取前几个字节）
    const header = fs.readFileSync(tempFilePath).slice(0, 4);
    console.log(`[远程压缩包] 文件头: ${header.toString('hex')}`);

    // ZIP 文件头应该是 50 4B 03 04 (PK..)
    // 7z 文件头应该是 37 7A BC AF (7z..)
    const isZip = header[0] === 0x50 && header[1] === 0x4B;
    const is7z = header[0] === 0x37 && header[1] === 0x7A && header[2] === 0xBC && header[3] === 0xAF;
    console.log(`[远程压缩包] 文件类型检测: isZip=${isZip}, is7z=${is7z}`);

    // 3. 查找 7z 可执行文件
    const sevenZipPath = find7z();
    if (!sevenZipPath) {
      fs.unlinkSync(tempFilePath);
      return { success: false, error: '未找到 7z 工具，请确保 7z.exe 在 app/7z/ 目录下', items: [] };
    }

    // 4. 执行 7z 命令列出内容
    const command = `"${sevenZipPath}" l -ba -slt "${tempFilePath}"`;
    console.log(`[远程压缩包] 执行命令: ${command}`);

    const output = execSync(command, { encoding: 'utf8', windowsHide: true });

    // 5. 解析输出
    const lines = output.split('\n');
    const items = [];

    // 调试：打印前50行
    console.log(`[远程压缩包] 7z 输出（前50行）:`);
    for (let i = 0; i < Math.min(50, lines.length); i++) {
      console.log(`  ${i}: ${lines[i]}`);
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('Path = ')) {
        const itemPath = line.substring(7).trim();

        // 查找下一个 Size 行
        let size = 0;
        if (i + 1 < lines.length && lines[i + 1].startsWith('Size = ')) {
          const sizeLine = lines[i + 1];
          size = parseInt(sizeLine.substring(7).trim()) || 0;
        }

        // 查找 Attributes 行判断是否是目录
        let isDirectory = false;
        let foundAttributes = false;
        // 搜索后续的 Attributes 行（可能在不同的位置）
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          if (lines[j].startsWith('Attributes = ')) {
            const attrLine = lines[j];
            const attrs = attrLine.substring(14).trim();
            isDirectory = attrs.includes('D');
            foundAttributes = true;
            // 调试：打印前几个项目的属性判断
            if (items.length < 5) {
              console.log(`[远程压缩包] 项目 "${itemPath}": Attributes="${attrs}", isDirectory=${isDirectory}`);
            }
            break;
          }
        }

        if (!foundAttributes && items.length < 5) {
          console.log(`[远程压缩包] 警告：项目 "${itemPath}" 未找到 Attributes 行`);
        }

        items.push({
          path: itemPath,
          isDirectory: isDirectory,
          size: size
        });
      }
    }

    // 6. 删除临时文件
    try {
      fs.unlinkSync(tempFilePath);
      console.log(`[远程压缩包] 已删除临时文件`);
    } catch (e) {
      console.warn('[远程压缩包] 删除临时文件失败:', e.message);
    }

    console.log(`[远程压缩包] 成功列出 ${items.length} 个项目`);
    return { success: true, items: items };
  } catch (error) {
    console.error('[远程压缩包] 失败:', error);
    return { success: false, error: error.message, items: [] };
  }
});

// =====================================================================
// 🔄 代码更新模块
// =====================================================================

/**
 * 从远程服务器下载并更新代码
 */
ipcMain.handle('update-code', async (event, { serverUrl }) => {
  const https = require('https');
  const http = require('http');
  const os = require('os');
  const path = require('path');
  const fs = require('fs');

  console.log(`[代码更新] 开始从 ${serverUrl} 更新代码`);

  try {
    // 1. 验证服务器 URL
    let url;
    try {
      url = new URL(serverUrl);
    } catch (e) {
      return { success: false, error: '无效的服务器地址' };
    }

    // 2. 下载 ZIP 文件
    const downloadUrl = `${url.origin}/download`;
    console.log(`[代码更新] 正在下载: ${downloadUrl}`);

    const zipBuffer = await new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;

      client.get(downloadUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });

    console.log(`[代码更新] 下载完成，大小: ${zipBuffer.length} bytes`);

    // 3. 保存到临时文件
    const tempDir = os.tmpdir();
    const tempZipPath = path.join(tempDir, `code-update-${Date.now()}.zip`);
    fs.writeFileSync(tempZipPath, zipBuffer);
    console.log(`[代码更新] 已保存到临时文件: ${tempZipPath}`);

    // 4. 解压并覆盖
    console.log(`[代码更新] 开始解压...`);
    const appDir = __dirname;

    await new Promise((resolve, reject) => {
      const { spawn, exec } = require('child_process');

      if (process.platform === 'win32') {
        // Windows: 使用 7za.exe
        const sevenZipPath = find7z();
        if (!sevenZipPath) {
          reject(new Error('未找到 7z 工具，请确保 7za.exe 在 7z 目录下'));
          return;
        }

        // 使用 7z 解压到 app 目录，覆盖所有文件
        const unzipCommand = spawn(sevenZipPath, [
          'x',
          tempZipPath,
          `-o${appDir}`,
          '-y',
          '-aoa' // 覆盖所有文件
        ]);

        unzipCommand.stdout.on('data', (data) => {
          console.log(`[代码更新] ${data.toString().trim()}`);
        });

        unzipCommand.stderr.on('data', (data) => {
          console.error(`[代码更新] ${data.toString().trim()}`);
        });

        unzipCommand.on('close', (code) => {
          if (code === 0) {
            console.log(`[代码更新] 解压完成`);
            resolve();
          } else {
            reject(new Error(`解压失败，退出码: ${code}`));
          }
        });

        unzipCommand.on('error', reject);
      } else {
        // Linux/Mac: 使用 unzip 命令
        console.log(`[代码更新] 使用 unzip 解压...`);

        exec(`unzip -o "${tempZipPath}" -d "${appDir}"`, (error, stdout, stderr) => {
          if (error) {
            console.error(`[代码更新] 解压失败:`, error);
            reject(new Error(`解压失败: ${error.message}`));
            return;
          }
          console.log(`[代码更新] 解压完成`);
          if (stdout) console.log(`[代码更新] ${stdout}`);
          resolve();
        });
      }
    });

    // 5. 清理临时文件
    try {
      fs.unlinkSync(tempZipPath);
      console.log(`[代码更新] 已清理临时文件`);
    } catch (e) {
      console.warn(`[代码更新] 清理临时文件失败:`, e.message);
    }

    console.log(`[代码更新] ✅ 更新完成！`);
    return {
      success: true,
      message: '代码更新完成，请重启应用'
    };

  } catch (error) {
    console.error(`[代码更新] ❌ 失败:`, error);
    return { success: false, error: error.message };
  }
});

/**
 * 检查更新服务器状态
 */
ipcMain.handle('check-update-server', async (event, { serverUrl }) => {
  const https = require('https');
  const http = require('http');

  console.log(`[代码更新] 检查服务器: ${serverUrl}`);

  try {
    let url;
    try {
      url = new URL(serverUrl);
    } catch (e) {
      return { success: false, error: '无效的服务器地址' };
    }

    const infoUrl = `${url.origin}/info`;
    console.log(`[代码更新] 获取服务器信息: ${infoUrl}`);

    const info = await new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;

      client.get(infoUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('解析响应失败'));
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    });

    console.log(`[代码更新] 服务器信息:`, info);
    return { success: true, info };

  } catch (error) {
    console.error(`[代码更新] 检查服务器失败:`, error);
    return { success: false, error: error.message };
  }
});

// 停止所有监听器
function stopAllWatchers() {
  for (const [path, watcher] of fsWatchers) {
    try {
      watcher.close();
    } catch (e) {
      // 忽略错误
    }
  }
  fsWatchers.clear();
  console.log('[文件监听] 已停止所有监听器');
}

// 应用退出前注销所有快捷键并停止服务端进程
app.on('will-quit', () => {
  stopAllWatchers(); // 停止文件监听器
  stopLocalServer(); // 停止远程共享服务器
  globalShortcut.unregisterAll();
  stopEngineProcess();
  // 清理所有窗口的临时目录
  for (const [rendererId, tempDir] of rendererTempDirs) {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      // 忽略清理错误
    }
  }
  rendererTempDirs.clear();
});
