/**
 * 压缩包操作 - 列出、提取、流式提取
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { execSync, spawn } = require('child_process');
const { ipcMain } = require('electron');
const { find7z, isArchiveFile, parseZipCentralDir, resolveZip64ExtraField, extractZipEntryNative, extractTextFromBuffer } = require('./utils');

// ===================================================================
// IPC Handlers
// ===================================================================

ipcMain.handle('list-archive', async (event, archivePath) => {

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

// 🚀 解压压缩包到指定目录（带进度报告）
ipcMain.handle('extract-archive-progress', async (event, archivePath, targetPath) => {

  try {
    console.log(`[extract-progress] 开始解压: ${archivePath} -> ${targetPath}`);

    if (!fs.existsSync(archivePath)) {
      return { success: false, error: '压缩包不存在' };
    }

    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    const ext = path.extname(archivePath).toLowerCase();
    const fileName = path.basename(archivePath).toLowerCase();
    const use7z = isArchiveFile(archivePath);

    let sevenZipPath = null;
    if (use7z) {
      sevenZipPath = find7z();
    }

    // Build args for spawn
    let cmd, args;
    if (use7z && sevenZipPath) {
      cmd = sevenZipPath;
      args = ['x', '-y', '-bsp1', `-o${targetPath}`, archivePath];
    } else if (ext === '.tar' || ext === '.tgz' || fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
      cmd = 'tar';
      if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
        args = ['-xzf', archivePath, '-C', targetPath];
      } else {
        args = ['-xf', archivePath, '-C', targetPath];
      }
    } else if (ext === '.gz' && !fileName.endsWith('.tar.gz')) {
      cmd = 'gunzip';
      args = ['-c', archivePath];
    } else {
      return { success: false, error: '不支持的压缩格式或 7z 未安装' };
    }

    console.log(`[extract-progress] 执行: ${cmd} ${args.join(' ')}`);

    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          // 7z -bsp1 输出格式: " 23% 15 - filename"
          const match = line.match(/^\s*(\d+)%/);
          if (match) {
            const percent = parseInt(match[1], 10);
            const fileName = line.replace(/^\s*\d+%\s*\d+\s*-\s*/, '').trim();
            event.sender.send('extract-progress', { percent, fileName });
          }
        }
      });

      child.stderr.on('data', (data) => {
        // 7z also outputs progress to stderr sometimes
        const str = data.toString();
        const lines = str.split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*(\d+)%/);
          if (match) {
            const percent = parseInt(match[1], 10);
            event.sender.send('extract-progress', { percent, fileName: '' });
          }
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`[extract-progress] 解压成功`);
          resolve({ success: true });
        } else {
          console.error(`[extract-progress] 解压失败, exit code: ${code}`);
          resolve({ success: false, error: `解压进程异常退出 (code=${code})` });
        }
      });

      child.on('error', (err) => {
        console.error(`[extract-progress] spawn 错误:`, err);
        resolve({ success: false, error: err.message });
      });
    });
  } catch (error) {
    console.error('[extract-progress] 解压失败:', error);
    return { success: false, error: error.message };
  }
});


// ===================================================================
// Utility
// ===================================================================

async function extractArchiveToDir(archivePath, targetPath) {

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

// ===================================================================
// Module registration
// ===================================================================

function registerIpcHandlers() {
  // All IPC handlers are registered at module load time above
}

module.exports = {
  registerIpcHandlers,
  extractArchiveToDir
};
