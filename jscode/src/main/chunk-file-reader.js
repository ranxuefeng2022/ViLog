/**
 * Chunk File Reader — builds line-offset indices and reads lines on demand
 *
 * Workflow:
 *   1. Disk files: build index directly on original file (no copy)
 *   2. Memory content: write to mem/chunk-tmp/ temp file, then index
 *   3. Read lines on demand via line-offset index
 *   4. Clean up chunk-tmp/ on each new load or app quit
 *
 * IPC channels:
 *   build-line-index          — index a disk file (direct or copy)
 *   read-lines-range          — read specific line range
 *   build-index-for-files     — batch: index multiple disk files
 *   build-index-from-content  — write memory content to temp + index
 *   extract-to-chunk-tmp      — extract archive file to disk + index
 *   extract-to-chunk-tmp-batch — extract multiple archive files in batch
 *   cleanup-chunk-temp        — clean chunk-tmp/ directory
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { ipcMain } = require('electron');
const { isKernelFile } = require('./android-time-converter');

const projectRoot = path.resolve(__dirname, '..', '..');
var toolsRoot = projectRoot;
if (process.resourcesPath && process.resourcesPath !== projectRoot) {
  if (fs.existsSync(path.join(process.resourcesPath, 'rg.exe'))) {
    toolsRoot = process.resourcesPath;
  }
}

// Subdirectory under mem/ for chunk mode temp files — only this gets cleaned
const CHUNK_TEMP_DIR = path.join(projectRoot, 'mem', 'chunk-tmp');
const FILTER_TEMP_DIR = path.join(projectRoot, 'mem', 'filter-tmp');

// Module-level state
// indexStorage: filePath → { tempPath, offsets, granularity, totalLines, fileSize }
const indexStorage = new Map();

// fd pool — reuse file descriptors to avoid repeated open/close during scrolling
const fdPool = new Map(); // filePath → { fd, lastAccess }
const FD_POOL_MAX = 8;

function getFd(filePath) {
  if (fdPool.has(filePath)) {
    const entry = fdPool.get(filePath);
    entry.lastAccess = Date.now();
    return entry.fd;
  }
  if (fdPool.size >= FD_POOL_MAX) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, val] of fdPool) {
      if (val.lastAccess < oldestTime) { oldestTime = val.lastAccess; oldestKey = key; }
    }
    if (oldestKey !== null) {
      try { fs.closeSync(fdPool.get(oldestKey).fd); } catch (e) {}
      fdPool.delete(oldestKey);
    }
  }
  const fd = fs.openSync(filePath, 'r');
  fdPool.set(filePath, { fd, lastAccess: Date.now() });
  return fd;
}

function closeFdPool() {
  for (const [, entry] of fdPool) {
    try { fs.closeSync(entry.fd); } catch (e) {}
  }
  fdPool.clear();
}

// Shared read buffer — reuse across readLinesFromTemp calls (single-threaded, no contention)
const SHARED_READ_BUF = Buffer.alloc(64 * 1024);

// Track current generation for cleanup
let currentGeneration = 0;

// Active rg processes for cancellation
let activeFilterSession = null; // { generation, processes: Set<ChildProcess> }

function cancelActiveFilter() {
  if (!activeFilterSession) return;
  for (const proc of activeFilterSession.processes) {
    try { proc.kill(); } catch (_) {}
  }
  activeFilterSession.processes.clear();
  activeFilterSession = null;
  console.log('[chunk] 已取消活跃的过滤进程');
}

ipcMain.handle('cancel-filter', async () => {
  cancelActiveFilter();
  return { success: true };
});

// Adaptive granularity thresholds
const GRANULARITY_THRESHOLDS = [
  { maxLines: 1000000, granularity: 1 },     // < 1M lines: per-line, ~8MB
  { maxLines: 10000000, granularity: 10 },    // 1M-10M: every 10th line
  { maxLines: Infinity, granularity: 1000 },  // > 10M: every 1000th line
];

function getGranularity(totalLines) {
  for (const t of GRANULARITY_THRESHOLDS) {
    if (totalLines <= t.maxLines) return t.granularity;
  }
  return 1000;
}

/**
 * Ensure the temp directory exists. Accepts optional subDir for alternative locations.
 */
function ensureTempDir(subDir) {
  const dir = subDir ? path.join(projectRoot, 'mem', subDir) : CHUNK_TEMP_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Ensure a per-window temp directory exists: base/wc{rendererId}/
 */
function ensureWindowTempDir(rendererId, subDir) {
  const base = subDir ? path.join(projectRoot, 'mem', subDir) : CHUNK_TEMP_DIR;
  const dir = path.join(base, 'wc' + rendererId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Delete all temp files from a previous generation
 */
function cleanupOldGenerations(keepGeneration) {
  const tempDir = ensureTempDir();
  try {
    const entries = fs.readdirSync(tempDir);
    let deleted = 0;
    for (const entry of entries) {
      const match = entry.match(/^gen(\d+)-/);
      if (match) {
        const gen = parseInt(match[1], 10);
        if (gen < keepGeneration) {
          fs.unlinkSync(path.join(tempDir, entry));
          deleted++;
        }
      }
    }
    if (deleted > 0) {
      console.log(`[chunk] 已清理 ${deleted} 个旧临时文件 (保留 generation ${keepGeneration})`);
    }
  } catch (e) {
    console.warn('[chunk] 清理旧临时文件失败:', e.message);
  }
}

/**
 * Clean up temp files for a specific renderer (per-window isolation)
 * @param {number} rendererId - webContents ID
 * @param {object} [options] - { filterOnly: true } to only clean filter-tmp
 */
function cleanupForWindow(rendererId, options) {
  const filterDir = path.join(FILTER_TEMP_DIR, 'wc' + rendererId);
  const chunkDir = path.join(CHUNK_TEMP_DIR, 'wc' + rendererId);
  const windowDirs = (options && options.filterOnly)
    ? [filterDir]
    : [chunkDir, filterDir];
  closeFdPool();
  for (const windowDir of windowDirs) {
    if (fs.existsSync(windowDir)) {
      try {
        fs.rmSync(windowDir, { recursive: true, force: true });
        console.log(`[chunk] 已清理窗口 ${rendererId} 的临时目录: ${windowDir}`);
      } catch (e) {
        console.warn(`[chunk] 清理窗口临时目录失败 ${windowDir}:`, e.message);
      }
    }
  }
  for (const [key, value] of indexStorage) {
    if (value.tempPath) {
      for (const windowDir of windowDirs) {
        if (value.tempPath.startsWith(windowDir)) {
          indexStorage.delete(key);
          break;
        }
      }
    }
  }
}

/**
 * Delete all temp files in chunk-tmp/ and filter-tmp/ (app quit)
 */
function cleanupAll() {
  closeFdPool();
  for (const tempDir of [CHUNK_TEMP_DIR, FILTER_TEMP_DIR]) {
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`[chunk] 已清理 ${path.basename(tempDir)}/`);
      } catch (e) {
        console.warn(`[chunk] 清理 ${tempDir} 失败:`, e.message);
      }
    }
  }
  indexStorage.clear();
}

// ===================================================================
// Index building — runs in Worker thread to avoid blocking main process
// ===================================================================

/**
 * Build line-offset index for a file. Runs in a Worker thread.
 * Returns Promise<{ offsets, granularity, totalLines, fileSize }>
 */
function buildIndexAsync(filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const workerCode = `
      const fs = require('fs');

      const GRANULARITY_THRESHOLDS = [
        { maxLines: 1000000, granularity: 1 },
        { maxLines: 10000000, granularity: 10 },
        { maxLines: Infinity, granularity: 1000 },
      ];

      function getGranularity(totalLines) {
        for (const t of GRANULARITY_THRESHOLDS) {
          if (totalLines <= t.maxLines) return t.granularity;
        }
        return 1000;
      }

      const filePath = require('worker_threads').workerData.filePath;
      const parentPort = require('worker_threads').parentPort;
      try {
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const CHUNK_SIZE = 2 * 1024 * 1024;
        // 保守预分配：最多 1M 条（8MB），避免大文件一次性分配数百 MB
        const initialSize = Math.min(1_000_000, Math.max(1024, Math.ceil(fileSize / 80)));
        let totalLines = 0;
        let rawOffsets = new Float64Array(initialSize);
        rawOffsets[0] = 0;
        let offsetPtr = 1;

        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(CHUNK_SIZE);
        let byteOffset = 0;
        let lastReportedPercent = 0;

        try {
          let bytesRead;
          while ((bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, null)) > 0) {
            // Use Buffer.indexOf (V8 SIMD) instead of byte-by-byte scan
            let pos = 0;
            while (true) {
              const idx = buf.indexOf(0x0A, pos, bytesRead);
              if (idx === -1 || idx >= bytesRead) break;
              totalLines++;
              if (offsetPtr >= rawOffsets.length) {
                const newLen = rawOffsets.length * 2;
                const newBuf = new Float64Array(newLen);
                newBuf.set(rawOffsets);
                rawOffsets = newBuf;
              }
              rawOffsets[offsetPtr++] = byteOffset + idx + 1;
              pos = idx + 1;
            }
            byteOffset += bytesRead;

            if (fileSize > 0) {
              const pct = Math.floor(byteOffset / fileSize * 100);
              if (pct >= lastReportedPercent + 5) {
                parentPort.postMessage({ progress: pct });
                lastReportedPercent = pct;
              }
            }
          }
          if (byteOffset > 0 && rawOffsets[Math.max(0, offsetPtr - 1)] < byteOffset) {
            totalLines++;
          }
        } finally {
          fs.closeSync(fd);
        }

        const granularity = getGranularity(totalLines);
        let offsets;
        if (granularity === 1) {
          offsets = rawOffsets.slice(0, offsetPtr);
        } else {
          const sampledLen = Math.ceil(offsetPtr / granularity) + 1;
          offsets = new Float64Array(sampledLen);
          for (let i = 0; i < sampledLen - 1; i++) {
            const srcIdx = i * granularity;
            offsets[i] = srcIdx < offsetPtr ? rawOffsets[srcIdx] : rawOffsets[offsetPtr - 1];
          }
          offsets[sampledLen - 1] = rawOffsets[offsetPtr - 1];
        }

        // Transfer ArrayBuffer (zero-copy) instead of Array.from
        const transferBuf = offsets.buffer.slice(0);
        parentPort.postMessage({
          offsets: transferBuf,
          granularity,
          totalLines,
          fileSize,
        }, [transferBuf]);
      } catch (err) {
        parentPort.postMessage({ error: err.message });
      }
    `;

    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { filePath },
    });

    worker.on('message', (data) => {
      if (data.progress !== undefined) {
        if (onProgress) onProgress(data.progress);
        return;
      }
      if (data.error) {
        reject(new Error(data.error));
      } else {
        // Received as transferred ArrayBuffer
        data.offsets = new Float64Array(data.offsets);
        resolve(data);
      }
      worker.terminate();
    });

    worker.on('error', (err) => {
      reject(err);
      worker.terminate();
    });
  });
}

/**
 * Read a range of lines from a file using its pre-built index.
 * Stays synchronous — reads are fast (only visible range).
 */
function readLinesFromTemp(tempPath, indexData, startLine, count) {
  const { offsets, granularity, totalLines } = indexData;
  const endLine = Math.min(startLine + count - 1, totalLines - 1);
  if (startLine < 0 || startLine >= totalLines) {
    return { lines: [], actualStart: startLine };
  }

  const sampleIdx = Math.floor(startLine / granularity);
  const startByte = sampleIdx < offsets.length ? offsets[sampleIdx] : offsets[offsets.length - 1];

  const fd = getFd(tempPath);
  const buf = SHARED_READ_BUF;

  const lines = [];
  let currentLine = sampleIdx * granularity;
  let lineBuf = '';
  let bytePos = startByte;

  let bytesRead;
  outer:
  while ((bytesRead = fs.readSync(fd, buf, 0, SHARED_READ_BUF.length, bytePos)) > 0) {
    const text = buf.toString('utf-8', 0, bytesRead);
    let pos = 0;
    while (true) {
      const nlIdx = text.indexOf('\n', pos);
      if (nlIdx === -1) {
        lineBuf += text.substring(pos);
        break;
      }
      lineBuf += text.substring(pos, nlIdx);
      if (currentLine >= startLine && currentLine <= endLine) {
        lines.push(lineBuf);
      }
      currentLine++;
      lineBuf = '';
      if (currentLine > endLine) break outer;
      pos = nlIdx + 1;
    }
    bytePos += bytesRead;
  }
  if (lineBuf && currentLine >= startLine && currentLine <= endLine) {
    lines.push(lineBuf);
  }

  return { lines, actualStart: startLine };
}

/**
 * 大缓冲区同步复制文件 → 已打开的 fd（用于流水线合并）
 * 单次 read + write 循环，比 stream pipe 快 3-5x（避免事件循环开销和默认 64KB 块）
 */
function copyFileWithLargeBuf(srcPath, destFd, bufSize) {
  const srcFd = fs.openSync(srcPath, 'r');
  const buf = Buffer.alloc(bufSize || 1024 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(srcFd, buf, 0, buf.length, null)) > 0) {
      fs.writeSync(destFd, buf, 0, bytesRead);
    }
  } finally {
    fs.closeSync(srcFd);
  }
}

// ===================================================================
// IPC Handlers
// ===================================================================

ipcMain.handle('build-line-index', async (event, { filePath, direct }) => {
  try {
    // Note: cleanup is done by cleanLogData calling cleanupChunkTemp once per batch

    let targetPath = filePath;

    // 复制源文件到临时目录，异步复制避免阻塞主进程
    if (direct) {
      const rendererId = event.sender.id;
      const tempDir = ensureWindowTempDir(rendererId);
      const hash = crypto.randomBytes(4).toString('hex');
      const baseName = path.basename(filePath);
      const safeName = `gen${currentGeneration}-${hash}-${baseName}.tmp`;
      targetPath = path.join(tempDir, safeName);

      // 异步复制，大文件不阻塞主进程
      const srcSize = fs.statSync(filePath).size;
      event.sender.send('chunk-index-progress', {
        percent: 0,
        currentFile: path.basename(filePath),
        phase: 'copying',
      });
      await fs.promises.copyFile(filePath, targetPath);
      console.log(`[chunk] 复制源文件到临时目录: ${targetPath} (${(srcSize / 1024 / 1024).toFixed(1)}MB)`);
    }

    console.log(`[chunk] 索引文件: ${targetPath}`);

    const indexData = await buildIndexAsync(targetPath, (percent) => {
      event.sender.send('chunk-index-progress', {
        percent,
        currentFile: path.basename(filePath),
        phase: 'indexing',
      });
    });
    indexData.tempPath = targetPath;
    indexStorage.set(targetPath, indexData);

    // Ensure final 100% progress is sent (worker only reports every 5%)
    event.sender.send('chunk-index-progress', {
      percent: 100,
      currentFile: path.basename(filePath),
      phase: 'indexing',
      totalLines: indexData.totalLines,
    });

    return {
      success: true,
      totalLines: indexData.totalLines,
      granularity: indexData.granularity,
      fileSize: indexData.fileSize,
      offsetCount: indexData.offsets.length,
      tempPath: targetPath,
      isKernel: isKernelFile(filePath),
    };
  } catch (error) {
    console.error('[build-line-index] Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-lines-range', async (event, { requests }) => {
  try {
    // Merge consecutive requests for the same file into one read
    const merged = [];
    for (const req of requests) {
      const prev = merged[merged.length - 1];
      if (prev && prev.filePath === req.filePath &&
          req.startLine <= prev.startLine + prev.count) {
        // Extend prev to cover both ranges
        const newEnd = Math.max(prev.startLine + prev.count, req.startLine + req.count);
        prev.count = newEnd - prev.startLine;
      } else {
        merged.push({ filePath: req.filePath, startLine: req.startLine, count: req.count });
      }
    }
    const results = [];
    for (const req of merged) {
      const stored = indexStorage.get(req.filePath);
      if (!stored) {
        results.push({ filePath: req.filePath, lines: [], actualStart: req.startLine });
        continue;
      }
      const { lines, actualStart } = readLinesFromTemp(stored.tempPath, stored, req.startLine, req.count);
      results.push({ filePath: req.filePath, lines, actualStart });
    }
    return { success: true, results };
  } catch (error) {
    console.error('[read-lines-range] Error:', error);
    return { success: false, error: error.message };
  }
});

// Read all or a range of lines from a filter temp file (for copy/export)
ipcMain.handle('read-filter-temp-as-text', async (event, { filePath, startLine, count }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }
    const stored = indexStorage.get(filePath);
    if (!stored) {
      return { success: false, error: 'No index for this temp file' };
    }
    const s = startLine || 0;
    const c = count || stored.totalLines;
    const { lines } = readLinesFromTemp(filePath, stored, s, c);
    return { success: true, text: lines.join('\n'), lineCount: lines.length };
  } catch (error) {
    console.error('[read-filter-temp-as-text] Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('build-index-for-files', async (event, { filePaths }) => {
  try {
    const files = [];
    for (let idx = 0; idx < filePaths.length; idx++) {
      const fp = filePaths[idx];
      const filePercent = Math.floor(idx / filePaths.length * 100);

      const indexData = await buildIndexAsync(fp, (scanPercent) => {
        event.sender.send('chunk-index-progress', {
          percent: filePercent + Math.floor(scanPercent / filePaths.length),
          currentFile: path.basename(fp),
          fileIndex: idx,
          fileCount: filePaths.length,
          phase: 'indexing',
        });
      });
      indexData.tempPath = fp;
      indexStorage.set(fp, indexData);

      files.push({
        filePath: fp,
        fileName: path.basename(fp),
        totalLines: indexData.totalLines,
        fileSize: indexData.fileSize,
      });
    }

    // Ensure final 100% progress is sent
    event.sender.send('chunk-index-progress', {
      percent: 100,
      phase: 'indexing',
    });

    return { success: true, files };
  } catch (error) {
    console.error('[build-index-for-files] Error:', error);
    return { success: false, error: error.message };
  }
});

/**
 * build-index-from-content — write in-memory content to mem/chunk-tmp/ and index.
 * Used for pasted content, preloaded files.
 */
ipcMain.handle('build-index-from-content', async (event, { contents }) => {
  try {
    const rendererId = event.sender.id;
    const results = [];
    for (let ci = 0; ci < contents.length; ci++) {
      const item = contents[ci];
      const tempDir = ensureWindowTempDir(rendererId, item.tempSubDir || undefined);
      const hash = crypto.randomBytes(4).toString('hex');
      let baseName = item.fileName || 'content';
      baseName = baseName.replace(/[/\\]/g, '_').replace(/[:*?"<>|]/g, '_');
      const safeName = `gen${currentGeneration}-${hash}-${baseName}.tmp`;
      const tempPath = path.join(tempDir, safeName);

      event.sender.send('chunk-index-progress', {
        percent: Math.floor(ci / contents.length * 50),
        currentFile: baseName,
        phase: 'writing',
      });

      fs.writeFileSync(tempPath, item.content, 'utf-8');
      console.log(`[chunk] 已写入内存内容到临时文件: ${tempPath} (${(Buffer.byteLength(item.content, 'utf-8') / 1024 / 1024).toFixed(1)}MB)`);

      const indexData = await buildIndexAsync(tempPath, (scanPercent) => {
        event.sender.send('chunk-index-progress', {
          percent: Math.floor(ci / contents.length * 100) + Math.floor(scanPercent / contents.length),
          currentFile: baseName,
          phase: 'indexing',
        });
      });
      indexData.tempPath = tempPath;
      indexStorage.set(tempPath, indexData);

      results.push({
        tempPath,
        fileName: item.fileName,
        totalLines: indexData.totalLines,
        fileSize: indexData.fileSize,
        isKernel: isKernelFile(baseName),
      });
    }

    // Ensure final 100% progress is sent
    event.sender.send('chunk-index-progress', {
      percent: 100,
      phase: 'indexing',
    });

    return { success: true, files: results };
  } catch (error) {
    console.error('[build-index-from-content] Error:', error);
    return { success: false, error: error.message };
  }
});

/**
 * extract-to-chunk-tmp — extract a file from archive directly to mem/chunk-tmp/,
 * then build index. Avoids loading entire content into memory.
 * Uses existing archive extraction utilities.
 *
 * Input: { archivePath, innerPath, fileName }
 * Returns: { tempPath, fileName, totalLines, fileSize }
 */
ipcMain.handle('extract-to-chunk-tmp', async (event, { archivePath, innerPath, fileName }) => {
  try {
    const rendererId = event.sender.id;
    const tempDir = ensureWindowTempDir(rendererId);
    const hash = crypto.randomBytes(4).toString('hex');
    let baseName = fileName || path.basename(innerPath) || 'extracted';
    baseName = baseName.replace(/[/\\]/g, '_').replace(/[:*?"<>|]/g, '_');
    const safeName = `gen${currentGeneration}-${hash}-${baseName}.tmp`;
    const tempPath = path.join(tempDir, safeName);

    event.sender.send('chunk-index-progress', {
      percent: 0,
      currentFile: baseName,
      phase: 'extracting',
    });

    // Use the app's archive extraction to extract content, then write to disk
    const { extractZipEntryNative } = require('./utils');
    const ext = path.extname(archivePath).toLowerCase();

    let extracted = false;

    // Try native ZIP extraction first (fastest)
    if (ext === '.zip') {
      const result = extractZipEntryNative(archivePath, innerPath);
      if (result && result.success && result.content) {
        fs.writeFileSync(tempPath, result.content, 'utf-8');
        extracted = true;
      }
    }

    // Fallback: use 7z command-line — extract directly to tempPath on disk
    if (!extracted) {
      const { find7z } = require('./utils');
      const sevenZipPath = find7z();
      if (sevenZipPath) {
        const { execFileSync } = require('child_process');
        try {
          // Use 7z e -o<dir> to extract to the chunk-tmp directory
          // Then rename to our target tempPath
          const tmpExtractDir = path.join(tempDir, `gen${currentGeneration}-extract-${hash}`);
          fs.mkdirSync(tmpExtractDir, { recursive: true });
          execFileSync(sevenZipPath, [
            'e', '-y', `-o${tmpExtractDir}`, archivePath, innerPath
          ], { timeout: 60000 });
          // 7z strips path separators, find the extracted file
          const extractedFiles = fs.readdirSync(tmpExtractDir);
          if (extractedFiles.length > 0) {
            const extractedPath = path.join(tmpExtractDir, extractedFiles[0]);
            fs.renameSync(extractedPath, tempPath);
            // Clean up the temp extract dir
            try { fs.rmdirSync(tmpExtractDir); } catch (_) {}
            extracted = true;
          }
        } catch (e7z) {
          console.warn('[extract-to-chunk-tmp] 7z extraction failed:', e7z.message);
        }
      }
    }

    if (!extracted) {
      return { success: false, error: '无法从压缩包提取文件: ' + innerPath };
    }

    console.log(`[chunk] 已解压到临时文件: ${tempPath} (${(fs.statSync(tempPath).size / 1024 / 1024).toFixed(1)}MB)`);

    // Build index asynchronously
    const indexData = await buildIndexAsync(tempPath, (percent) => {
      event.sender.send('chunk-index-progress', {
        percent,
        currentFile: baseName,
        phase: 'indexing',
      });
    });
    indexData.tempPath = tempPath;
    indexStorage.set(tempPath, indexData);

    // Ensure final 100% progress is sent
    event.sender.send('chunk-index-progress', {
      percent: 100,
      currentFile: baseName,
      phase: 'indexing',
      totalLines: indexData.totalLines,
    });

    return {
      success: true,
      tempPath,
      fileName: fileName || path.basename(innerPath),
      totalLines: indexData.totalLines,
      fileSize: indexData.fileSize,
      isKernel: isKernelFile(baseName),
    };
  } catch (error) {
    console.error('[extract-to-chunk-tmp] Error:', error);
    return { success: false, error: error.message };
  }
});

/**
 * extract-to-chunk-tmp-batch — extract multiple files from archives in batch.
 * Groups files by archivePath, extracts each group in a single 7z call,
 * then builds index per file. ~3-10x faster than per-file extraction.
 *
 * Input: { files: [{ archivePath, innerPath, fileName }] }
 * Returns: { results: [{ success, tempPath, fileName, totalLines, fileSize } | { success: false, error }] }
 */
ipcMain.handle('extract-to-chunk-tmp-batch', async (event, { files }) => {
  const results = new Array(files.length).fill(null);

  if (!files || files.length === 0) return { results };

  // Group files by archivePath
  const groups = new Map();
  files.forEach((f, i) => {
    const key = f.archivePath;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...f, index: i });
  });

  const rendererId = event.sender.id;
  const tempDir = ensureWindowTempDir(rendererId);
  const { extractZipEntryNative, find7z } = require('./utils');
  const sevenZipPath = find7z();

  for (const [archivePath, group] of groups) {
    const ext = path.extname(archivePath).toLowerCase();

    if (ext === '.zip') {
      // ZIP: native per-file extraction (already fast, no process needed)
      for (const item of group) {
        results[item.index] = await extractSingleToChunkTmp(
          event, item, tempDir, extractZipEntryNative
        );
      }
      continue;
    }

    // .7z / .rar / other: batch extract all files in one 7z call
    if (!sevenZipPath) {
      for (const item of group) {
        results[item.index] = { success: false, error: '7z 未安装' };
      }
      continue;
    }

    const batchHash = crypto.randomBytes(4).toString('hex');
    const batchTmpDir = path.join(tempDir, `gen${currentGeneration}-batch-${batchHash}`);

    try {
      fs.mkdirSync(batchTmpDir, { recursive: true });

      event.sender.send('chunk-index-progress', {
        percent: 0,
        currentFile: `${group.length} files from ${path.basename(archivePath)}`,
        phase: 'extracting',
      });

      // Single 7z call for all files in this archive
      const innerPaths = group.map(g => g.innerPath);
      const { execFileSync } = require('child_process');
      execFileSync(sevenZipPath, [
        'x', '-y', `-o${batchTmpDir}`, archivePath, ...innerPaths
      ], { timeout: 120000 });

      console.log(`[chunk-batch] 7z extracted ${innerPaths.length} files from ${archivePath}`);

      // Process each extracted file
      for (let gi = 0; gi < group.length; gi++) {
        const item = group[gi];
        const baseName = (item.fileName || path.basename(item.innerPath) || 'extracted')
          .replace(/[/\\]/g, '_').replace(/[:*?"<>|]/g, '_');

        try {
          // Locate extracted file (3-level search)
          let extractedPath = locateExtractedFile(batchTmpDir, item.innerPath);

          if (!extractedPath) {
            results[item.index] = { success: false, error: `文件未找到: ${item.innerPath}` };
            continue;
          }

          // Move to chunk-tmp with unique name
          const fileHash = crypto.randomBytes(4).toString('hex');
          const safeName = `gen${currentGeneration}-${fileHash}-${baseName}.tmp`;
          const chunkPath = path.join(tempDir, safeName);
          fs.renameSync(extractedPath, chunkPath);

          // Build index
          const indexData = await buildIndexAsync(chunkPath, (percent) => {
            event.sender.send('chunk-index-progress', {
              percent: Math.round(((gi + percent / 100) / group.length) * 100),
              currentFile: baseName,
              phase: 'indexing',
            });
          });
          indexData.tempPath = chunkPath;
          indexStorage.set(chunkPath, indexData);

          results[item.index] = {
            success: true,
            tempPath: chunkPath,
            fileName: item.fileName || path.basename(item.innerPath),
            totalLines: indexData.totalLines,
            fileSize: indexData.fileSize,
            isKernel: isKernelFile(baseName),
          };

          console.log(`[chunk-batch] indexed: ${baseName} (${indexData.totalLines} lines)`);
        } catch (itemError) {
          console.error(`[chunk-batch] failed: ${item.innerPath}`, itemError.message);
          results[item.index] = { success: false, error: itemError.message };
        }
      }
    } catch (batchError) {
      // Batch extraction failed — fall back to per-file extraction
      console.warn(`[chunk-batch] batch 7z failed, fallback per-file: ${batchError.message}`);

      // Clean up failed batch dir
      try { fs.rmSync(batchTmpDir, { recursive: true, force: true }); } catch (_) {}

      for (const item of group) {
        try {
          results[item.index] = await extractSingleToChunkTmp(
            event, item, tempDir, extractZipEntryNative, sevenZipPath
          );
        } catch (e2) {
          results[item.index] = { success: false, error: e2.message };
        }
      }
      continue;
    }

    // Clean up batch temp dir
    try { fs.rmSync(batchTmpDir, { recursive: true, force: true }); } catch (_) {}

    event.sender.send('chunk-index-progress', {
      percent: 100,
      currentFile: `${group.length} files`,
      phase: 'indexing',
    });
  }

  return { results };
});

/**
 * convert-kernel-chunk-files — Worker 线程并行转换 kernel 文件并重建索引
 * 多文件并行，不阻塞主进程
 *
 * Input: { files: [{ tempPath, fileName }] }  (仅 isKernel=true 的文件)
 * Returns: { convertedFiles: number, updatedFiles: Array }
 */
ipcMain.handle('convert-kernel-chunk-files', async (event, { files }) => {
  if (!files || files.length === 0) return { convertedFiles: 0, updatedFiles: [] };

  const sender = event.sender;
  const updatedFiles = [];
  const workerScriptPath = path.join(__dirname, 'android-time-worker.js');

  let completed = 0;
  const total = files.length;

  const workerPromises = files.map(({ tempPath, fileName }) => {
    return new Promise((resolve) => {
      const worker = new Worker(workerScriptPath, {
        workerData: { filePath: tempPath },
      });
      worker.on('message', (result) => {
        completed++;
        sender.send('chunk-index-progress', {
          percent: Math.round(completed / total * 100),
          currentFile: fileName || tempPath,
          phase: 'converting',
        });

        if (result.error) {
          console.error(`[chunk-convert] 转换失败: ${fileName}`, result.error);
          resolve(null);
          return;
        }

        if (result.convertedCount > 0) {
          console.log(`[chunk-convert] android time 转换: ${fileName}, ${result.convertedCount} 行, ${result.anchorCount} 个锚点`);
          buildIndexAsync(tempPath).then((indexData) => {
            indexData.tempPath = tempPath;
            const oldIndex = indexStorage.get(tempPath);
            indexStorage.set(tempPath, indexData);
            updatedFiles.push({
              tempPath,
              fileName,
              totalLines: indexData.totalLines,
              lineCountChanged: !oldIndex || oldIndex.totalLines !== indexData.totalLines,
            });
            resolve({ tempPath, fileName, totalLines: indexData.totalLines });
          }).catch((idxErr) => {
            console.error(`[chunk-convert] 重建索引失败: ${fileName}`, idxErr.message);
            resolve(null);
          });
        } else {
          resolve(null);
        }
      });
      worker.on('error', (err) => {
        completed++;
        console.error(`[chunk-convert] Worker 错误: ${fileName}`, err.message);
        resolve(null);
      });
    });
  });

  await Promise.all(workerPromises);

  sender.send('chunk-index-progress', { percent: 100, phase: 'converting' });

  return { convertedFiles: updatedFiles.length, updatedFiles };
});

/**
 * Extract a single file from archive to chunk-tmp (used by both handlers).
 */
async function extractSingleToChunkTmp(event, item, tempDir, extractZipEntryNative, sevenZipPath) {
  const { archivePath, innerPath, fileName } = item;
  const hash = crypto.randomBytes(4).toString('hex');
  let baseName = fileName || path.basename(innerPath) || 'extracted';
  baseName = baseName.replace(/[/\\]/g, '_').replace(/[:*?"<>|]/g, '_');
  const safeName = `gen${currentGeneration}-${hash}-${baseName}.tmp`;
  const chunkPath = path.join(tempDir, safeName);

  event.sender.send('chunk-index-progress', {
    percent: 0,
    currentFile: baseName,
    phase: 'extracting',
  });

  const ext = path.extname(archivePath).toLowerCase();
  let extracted = false;

  // Try native ZIP extraction first (fastest)
  if (ext === '.zip') {
    const result = extractZipEntryNative(archivePath, innerPath);
    if (result && result.success && result.content) {
      fs.writeFileSync(chunkPath, result.content, 'utf-8');
      extracted = true;
    }
  }

  // Fallback: use 7z command-line
  if (!extracted && sevenZipPath) {
    const { execFileSync } = require('child_process');
    try {
      const tmpExtractDir = path.join(tempDir, `gen${currentGeneration}-extract-${hash}`);
      fs.mkdirSync(tmpExtractDir, { recursive: true });
      execFileSync(sevenZipPath, [
        'e', '-y', `-o${tmpExtractDir}`, archivePath, innerPath
      ], { timeout: 60000 });
      const extractedFiles = fs.readdirSync(tmpExtractDir);
      if (extractedFiles.length > 0) {
        const extractedFilePath = path.join(tmpExtractDir, extractedFiles[0]);
        fs.renameSync(extractedFilePath, chunkPath);
        try { fs.rmdirSync(tmpExtractDir); } catch (_) {}
        extracted = true;
      }
    } catch (e7z) {
      console.warn('[extract-single] 7z failed:', e7z.message);
    }
  }

  if (!extracted) {
    return { success: false, error: '无法从压缩包提取文件: ' + innerPath };
  }

  // Build index
  const indexData = await buildIndexAsync(chunkPath, (percent) => {
    event.sender.send('chunk-index-progress', {
      percent,
      currentFile: baseName,
      phase: 'indexing',
    });
  });
  if (!indexData) {
    return { success: false, error: '索引构建失败: ' + innerPath };
  }

  indexData.tempPath = chunkPath;
  indexStorage.set(chunkPath, indexData);

  return {
    success: true,
    tempPath: chunkPath,
    fileName: fileName || path.basename(innerPath),
    totalLines: indexData.totalLines,
    fileSize: indexData.fileSize,
    isKernel: isKernelFile(baseName),
  };
}

/**
 * Locate an extracted file in a directory using 3-level search:
 * 1. Full innerPath relative to tmpDir
 * 2. Basename only
 * 3. Recursive search for first regular file
 */
function locateExtractedFile(tmpDir, innerPath) {
  // 1. Try full path (7z x preserves directory structure)
  const fullPath = path.join(tmpDir, innerPath.replace(/\\/g, '/'));
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) return fullPath;

  // 2. Try basename only
  const base = path.basename(innerPath);
  const basePath = path.join(tmpDir, base);
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) return basePath;

  // 3. Recursive search
  return findFirstFileRecursive(tmpDir);
}

function findFirstFileRecursive(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) return full;
      if (entry.isDirectory()) {
        const found = findFirstFileRecursive(full);
        if (found) return found;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * write-lines-to-filter-temp — 分批流式写入过滤结果到临时文件。
 * 首次调用创建文件，中间调用追加写入，done=true 时关闭文件并建索引。
 * 避免 join('\n') 产生巨大字符串导致渲染进程 OOM。
 */
const filterWriteState = new Map();

ipcMain.handle('write-lines-to-filter-temp', async (event, { batch, batchLineCount, done }) => {
  const rendererId = event.sender.id;
  let state = filterWriteState.get(rendererId);

  try {
    if (!state) {
      const tempDir = ensureWindowTempDir(rendererId, 'filter-tmp');
      const hash = crypto.randomBytes(4).toString('hex');
      const tempPath = path.join(tempDir, `gen${currentGeneration}-${hash}-filter-result.tmp`);
      const fd = fs.openSync(tempPath, 'w');
      state = { tempPath, fd, lineCount: 0 };
      filterWriteState.set(rendererId, state);
    }

    if (batch && batch.length > 0) {
      fs.writeSync(state.fd, batch);
      state.lineCount += batchLineCount || 0;
    }

    if (done) {
      fs.closeSync(state.fd);
      filterWriteState.delete(rendererId);

      event.sender.send('chunk-index-progress', {
        percent: 0,
        currentFile: 'filter-result',
        phase: 'indexing',
      });

      const indexData = await buildIndexAsync(state.tempPath, (percent) => {
        event.sender.send('chunk-index-progress', {
          percent,
          currentFile: 'filter-result',
          phase: 'indexing',
        });
      });
      indexData.tempPath = state.tempPath;
      indexStorage.set(state.tempPath, indexData);

      return {
        success: true,
        tempPath: state.tempPath,
        totalLines: indexData.totalLines,
        fileSize: indexData.fileSize,
      };
    }

    return { success: true, tempPath: state.tempPath, partialCount: state.lineCount };
  } catch (error) {
    if (state && state.fd) {
      try { fs.closeSync(state.fd); } catch (_) {}
      try { fs.unlinkSync(state.tempPath); } catch (_) {}
    }
    filterWriteState.delete(rendererId);
    console.error('[write-lines-to-filter-temp] Error:', error);
    return { success: false, error: error.message };
  }
});

/**
 * filter-chunk-stream — 主进程并行流式直写。
 * 每批 rg 写独立临时文件（无内存累积），全部完成后 stream-pipe 拼接。
 * 渲染进程零内容传输，主进程不累积行内容字符串。
 */
ipcMain.handle('filter-chunk-stream', async (event, options) => {
  const { pattern, files, caseInsensitive, headers, skipCleanup, suppressProgress } = options;
  const rendererId = event.sender.id;

  const send = suppressProgress
    ? function() {}
    : function(data) { event.sender.send('chunk-index-progress', data); };

  try {
    const rgPath = path.join(toolsRoot, 'rg.exe');
    if (!fs.existsSync(rgPath)) return { success: false, error: 'rg.exe 未找到' };

    if (!skipCleanup) {
      cleanupForWindow(rendererId, { filterOnly: true });
    }

    // Register this filter session for cancellation
    const filterGeneration = ++currentGeneration;
    const session = { generation: filterGeneration, processes: new Set() };
    activeFilterSession = session;

    const tempDir = ensureWindowTempDir(rendererId, 'filter-tmp');
    const hash = crypto.randomBytes(4).toString('hex');
    const tempPath = path.join(tempDir, `gen${currentGeneration}-${hash}-filter-stream.tmp`);

    // header 查找表: filePath → header
    const headerMap = new Map();
    for (const h of headers) {
      headerMap.set(h.filePath || h.fileName, h);
    }

    let combinedMatchCount = 0;
    let lastProgressTime = Date.now();
    const PROGRESS_INTERVAL = 1000;  // 每秒推送进度（含耗时显示）

    const { spawn } = require('child_process');

    // 动态分批：基于命令行长度而非固定文件数
    // rg 内部多线程，单个 rg 进程 CPU 利用率最高；仅在命令行超长时才分批
    const MAX_CMDLINE = 28000; // Windows 限制 32768，留安全余量
    const fixedArgsLen = 120;   // rg 固定参数 + pattern 的估算长度
    const batchFileGroups = [];
    let currentBatch = [];
    let currentLen = fixedArgsLen;
    for (const f of files) {
      const need = f.length + 3; // 路径 + 空格和引号
      if (currentLen + need > MAX_CMDLINE && currentBatch.length > 0) {
        batchFileGroups.push(currentBatch);
        currentBatch = [];
        currentLen = fixedArgsLen;
      }
      currentBatch.push(f);
      currentLen += need;
    }
    if (currentBatch.length > 0) batchFileGroups.push(currentBatch);

    const batchCount = batchFileGroups.length;

    // 进度推送（调用方已做节流，这里直接发送）
    function pushProgress() {
      send({
        phase: 'filtering', matchCount: combinedMatchCount,
      });
    }

    /**
     * 处理一批文件：spawn rg，按文件顺序缓冲结果，保证输出顺序与输入一致。
     * 索引用 Int32Array（4B/条），避免 JS 数组（8B/条）的 2x 内存。
     * 返回的 indices 是 Int32Array slice（无额外拷贝）。
     */
    function processOneBatchToPart(batchFiles, batchIndex) {
      const partPath = tempPath + '.part' + batchIndex;

      return new Promise((resolve) => {
        const args = [pattern, '--line-number', '--with-filename', '--null',
          '--no-heading', '--color', 'never', '-a'];
        if (caseInsensitive) args.push('-i');
        args.push('--', ...batchFiles);

        const rg = spawn(rgPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        if (activeFilterSession === session) activeFilterSession.processes.add(rg);
        let tail = '';

        // Per-file buffer: filePath → { headerLine, entries: [{content, originalIndex, byteLen}] }
        const perFileData = new Map();

        // 解析一行 rg 输出并缓冲到对应文件
        function bufferLine(l) {
          if (!l) return;
          const nullIdx = l.indexOf('\0');
          if (nullIdx === -1) return;
          const filePath = l.substring(0, nullIdx);
          const rest = l.substring(nullIdx + 1);
          const colonIdx = rest.indexOf(':');
          if (colonIdx === -1) return;
          const lineNum = parseInt(rest.substring(0, colonIdx), 10);
          if (isNaN(lineNum)) return;
          const content = rest.substring(colonIdx + 1);

          let fileData = perFileData.get(filePath);
          if (!fileData) {
            fileData = { headerLine: null, entries: [] };
            perFileData.set(filePath, fileData);
          }

          // 首次遇到该文件时，插入文件头
          if (fileData.entries.length === 0 && !fileData.headerLine) {
            const header = headerMap.get(filePath);
            if (header) {
              fileData.headerLine = '=== 文件: ' + (header.fileName || path.basename(filePath)) +
                ' (' + (header.lineCount || 0) + ' 行) ===\n';
            }
          }

          const ol = content + '\n';
          fileData.entries.push({
            content: ol,
            originalIndex: headerMap.has(filePath) ? headerMap.get(filePath).startIndex + lineNum : -1,
            byteLen: Buffer.byteLength(ol, 'utf-8'),
          });
          combinedMatchCount++;
        }

        rg.stdout.on('data', (chunk) => {
          const text = tail + chunk.toString('utf-8');
          const lines = text.split('\n');
          tail = lines.pop();

          for (const l of lines) {
            bufferLine(l);
          }

          const now = Date.now();
          if (now - lastProgressTime >= PROGRESS_INTERVAL) {
            lastProgressTime = now;
            pushProgress();
          }
        });

        rg.stderr.on('data', () => {});
        rg.on('close', () => {
          session.processes.delete(rg);
          // 处理尾部残留
          if (tail) bufferLine(tail);

          // 按 batchFiles 原始顺序写入 .part 文件，保证输出顺序正确
          let fd;
          try { fd = fs.openSync(partPath, 'w'); } catch (e) {
            resolve({ indices: new Int32Array(0), lineOffsets: new Float64Array(0), lineCount: 0, fileSize: 0, partPath, batchIndex });
            return;
          }

          const indices = [];
          const byteLens = [];
          let batchLineCount = 0;
          let totalFileSize = 0;
          const WRITE_BATCH = 50000;
          let writeBuf = [];

          function writeChunk(str) {
            writeBuf.push(str);
            if (writeBuf.length >= WRITE_BATCH) {
              fs.writeSync(fd, writeBuf.join(''));
              writeBuf.length = 0;
            }
          }

          for (const filePath of batchFiles) {
            const fileData = perFileData.get(filePath);
            if (!fileData) continue;

            // 写入文件头
            if (fileData.headerLine) {
              writeChunk(fileData.headerLine);
              indices.push(-1);
              const hlByteLen = Buffer.byteLength(fileData.headerLine, 'utf-8');
              byteLens.push(hlByteLen);
              totalFileSize += hlByteLen;
              batchLineCount++;
            }

            // 写入该文件的所有匹配行
            for (const entry of fileData.entries) {
              writeChunk(entry.content);
              indices.push(entry.originalIndex);
              byteLens.push(entry.byteLen);
              totalFileSize += entry.byteLen;
              batchLineCount++;
            }
          }

          // 刷出剩余缓冲
          if (writeBuf.length > 0) {
            fs.writeSync(fd, writeBuf.join(''));
            writeBuf.length = 0;
          }

          fs.closeSync(fd);

          // 释放 perFileData 内存
          perFileData.clear();

          // 构建偏移数组
          const lo = new Float64Array(byteLens.length);
          let bp = 0;
          for (let i = 0; i < byteLens.length; i++) {
            lo[i] = bp;
            bp += byteLens[i];
          }

          resolve({
            indices: new Int32Array(indices),
            lineOffsets: lo,
            lineCount: batchLineCount,
            fileSize: totalFileSize,
            partPath,
            batchIndex,
          });
        });

        rg.on('error', (err) => {
          console.warn('[filter-chunk-stream] rg error for batch', batchIndex, ':', err.message);
          try { fs.unlinkSync(partPath); } catch (_) {}
          resolve({ indices: new Int32Array(0), lineOffsets: new Float64Array(0), lineCount: 0, fileSize: 0, partPath, batchIndex });
        });
      });
    }

    // ===== 并行启动所有 batch（流水线合并：不等全部结束，按顺序逐个合并）=====
    // 🚀 P2: 并发限制器 — 最多 4 个 rg 进程同时运行，避免 CPU 颠簸
    // 按需启动 batch，不一次性全部触发。合并按顺序 await，剩余 batch 后台运行。
    const MAX_CONCURRENT = 4;
    const batchPromises = new Array(batchCount);
    let nextBatchToStart = 0;

    function launchNextBatch() {
      while (nextBatchToStart < batchCount) {
        const i = nextBatchToStart++;
        batchPromises[i] = processOneBatchToPart(batchFileGroups[i], i);
        if (nextBatchToStart - (nextBatchToStart - i - 1) >= MAX_CONCURRENT) break;
      }
    }
    launchNextBatch();

    // 包装 await：每次 await 后启动下一批（如果还有未启动的）
    async function awaitBatch(i) {
      // 如果该批次还没启动（理论上不会，但做防御），先启动
      if (!batchPromises[i]) {
        batchPromises[i] = processOneBatchToPart(batchFileGroups[i], i);
      }
      const result = await batchPromises[i];
      launchNextBatch();
      return result;
    }

    // 预先打开最终输出文件
    const idxPath = tempPath.replace(/\.tmp$/, '.idx');
    const finalFd = fs.openSync(tempPath, 'w');
    const idxFd = fs.openSync(idxPath, 'w');
    const COPY_BUF_SIZE = 1024 * 1024; // 1MB 大缓冲区，减少 read/write 调用次数

    let totalLines = 0;
    let totalFileSize = 0;
    let cumOffset = 0;
    let globalLineIdx = 0;
    let allEmpty = true;

    // 累积偏移量元数据（延迟到知道 totalLines 后再构建采样数组）
    const batchOffsetData = [];

    try {
      for (let i = 0; i < batchCount; i++) {
        // 等待第 i 批完成：
        // - 如果 batch i 已提前完成 → await 立即返回 → merge 与剩余 batch 的 rg 重叠
        // - 如果 batch i 还在跑 → await 等待 → 其他已完成的 batch 结果暂存，不阻塞
        const r = await awaitBatch(i);

        if (r.lineCount === 0) {
          try { fs.unlinkSync(r.partPath); } catch (_) {}
          continue;
        }

        allEmpty = false;
        totalLines += r.lineCount;
        totalFileSize += r.fileSize;

        // 复制 part 文件内容 → 最终 temp 文件（1MB 大缓冲区，比 stream pipe 快 3-5x）
        copyFileWithLargeBuf(r.partPath, finalFd, COPY_BUF_SIZE);

        // 立即删除 part 文件（不等所有 batch 结束）
        try { fs.unlinkSync(r.partPath); } catch (_) {}

        // 追加索引进 .idx 文件（流式写入，不需要内存中构建全量 Int32Array）
        fs.writeSync(idxFd, Buffer.from(r.indices.buffer, r.indices.byteOffset, r.indices.byteLength));

        // 记录偏移元数据（延迟构建采样数组）
        batchOffsetData.push({ lineOffsets: r.lineOffsets, startLine: globalLineIdx, cumOffset });
        globalLineIdx += r.lineOffsets.length;
        cumOffset += r.fileSize;

        // 立即释放本批次的 TypedArray 内存
        r.indices = null;
        r.lineOffsets = null;

        // 流水线合并进度
        send({
          phase: 'merging', merged: i + 1, total: batchCount, matchCount: combinedMatchCount,
        });
      }
    } finally {
      fs.closeSync(finalFd);
      fs.closeSync(idxFd);
    }

    // 零匹配 → 清理并返回
    if (allEmpty) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
      try { fs.unlinkSync(idxPath); } catch (_) {}
      for (const bd of batchOffsetData) { bd.lineOffsets = null; }
      return { success: true, tempPath: null, totalLines: 0, fileSize: 0,
               indexFile: null, matchCount: 0 };
    }

    // ===== 构建采样偏移量（纯 CPU 操作，在合并 I/O 全部完成后执行）=====
    send({
      phase: 'indexing', percent: 0, totalLines: totalLines,
    });

    const granularity = getGranularity(totalLines);
    const sampledLen = granularity === 1 ? totalLines : Math.ceil(totalLines / granularity) + 1;
    const offsets = new Float64Array(sampledLen);
    let sampledIdx = 0;
    let indexedBatches = 0;

    for (const bd of batchOffsetData) {
      const lo = bd.lineOffsets;
      const co = bd.cumOffset;
      const sl = bd.startLine;
      for (let j = 0; j < lo.length; j++) {
        const gIdx = sl + j;
        if (granularity === 1) {
          offsets[gIdx] = lo[j] + co;
        } else if (gIdx % granularity === 0) {
          offsets[sampledIdx++] = lo[j] + co;
        }
      }
      bd.lineOffsets = null; // 逐个释放
      indexedBatches++;
      // 索引构建进度
      send({
        phase: 'indexing',
        percent: Math.floor((indexedBatches) / batchOffsetData.length * 100),
        totalLines: totalLines,
      });
    }
    if (granularity !== 1) {
      offsets[sampledIdx] = cumOffset;
    }
    batchOffsetData.length = 0;

    indexStorage.set(tempPath, { tempPath, offsets, granularity, totalLines, fileSize: totalFileSize, indexFile: idxPath });

    // 索引构建完成通知
    send({
      phase: 'indexing', percent: 100, totalLines: totalLines,
    });

    // 读取 .idx 文件带回渲染进程（跳过渲染进程的首次磁盘 IPC 往返）
    let idxForRenderer = null;
    try {
      const raw = fs.readFileSync(idxPath);
      idxForRenderer = new Int32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    } catch (e) {
      console.warn('[filter-chunk-stream] 读取索引失败:', e.message);
    }

    // 最终推送一次进度确保渲染进程拿到最终数字
    send({
      phase: 'filtering', matchCount: combinedMatchCount,
    });

    if (activeFilterSession === session) activeFilterSession = null;

    return {
      success: true,
      tempPath,
      totalLines,
      fileSize: totalFileSize,
      indexFile: idxPath,
      matchCount: combinedMatchCount,
      indices: idxForRenderer, // 直接传递，渲染进程无需再读磁盘
    };
  } catch (error) {
    if (activeFilterSession === session) activeFilterSession = null;
    console.error('[filter-chunk-stream] Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cleanup-chunk-temp', async (event, options) => {
  try {
    const rendererId = event.sender.id;
    cleanupForWindow(rendererId, options);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 按需读取 .idx 文件中的 originalIndices（单条或范围）
ipcMain.handle('read-filter-indices', async (event, options) => {
  try {
    const { indexFile, start, count } = options;
    if (!indexFile || !fs.existsSync(indexFile)) {
      return { success: false, error: 'index file not found' };
    }

    const stat = fs.statSync(indexFile);
    const totalIndices = Math.floor(stat.size / 4); // Int32Array = 4 bytes each

    if (typeof start === 'number' && typeof count === 'number') {
      // 范围读取
      const s = Math.max(0, start);
      const c = Math.min(count, totalIndices - s);
      if (c <= 0) return { success: true, indices: new Int32Array(0), total: totalIndices };
      const buf = Buffer.alloc(c * 4);
      const fd = fs.openSync(indexFile, 'r');
      fs.readSync(fd, buf, 0, c * 4, s * 4);
      fs.closeSync(fd);
      return { success: true, indices: new Int32Array(buf.buffer, buf.byteOffset, c), total: totalIndices };
    }

    // 全量读取（用于小文件）
    const buf = fs.readFileSync(indexFile);
    return { success: true, indices: new Int32Array(buf.buffer, buf.byteOffset, buf.length / 4), total: totalIndices };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/**
 * list-chunk-tmp-files — 扫描当前渲染进程的 chunk-tmp/wc<id>/ 下所有 .tmp 文件
 * 每个窗口有独立的 wc<rendererId> 子目录，只返回当前进程的文件
 * 用于时间转换等需要在临时文件上操作的功能
 */
ipcMain.handle('list-chunk-tmp-files', async (event) => {
  try {
    const wcDir = path.join(CHUNK_TEMP_DIR, 'wc' + event.sender.id);
    const result = [];
    if (!fs.existsSync(wcDir)) return { success: true, files: [] };
    function scan(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.tmp')) {
          result.push(fullPath);
        }
      }
    }
    scan(wcDir);
    console.log('[list-chunk-tmp-files] wc' + event.sender.id + ' 找到', result.length, '个临时文件');
    return { success: true, files: result };
  } catch (error) {
    console.error('[list-chunk-tmp-files] 扫描失败:', error.message);
    return { success: false, error: error.message, files: [] };
  }
});

function registerIpcHandlers() {
  // All IPC handlers are registered at module load time above
}

// Cleanup on app quit
process.on('exit', () => {
  cleanupAll();
});

module.exports = { registerIpcHandlers, cleanupForWindow };
