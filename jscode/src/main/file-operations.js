/**
 * File Operations — largest IPC module, handles all file/directory I/O
 *
 * Responsibilities:
 *   - File read: read-file, read-file-streaming, read-files
 *   - File ops: file-exists, open-file-with-default-app, open-path, delete-file, open-with-app
 *   - Directory: list-folder, read-folder, list-directory, get-data-drives
 *   - Search: search-folder (Everything + ripgrep), call-rg-batch
 *   - Special: open-html-window, download-remote-file, open-terminal (WezTerm)
 *   - UI: show-folder-selection-dialog, copy-files-to-temp, resolve-winrar-path
 *   - Misc: get-cwd, get-system-stats, get-dropped-path, get-window-preview
 *   - setupIPC(mainWindow) — parse-large-file (Worker), watch-file/unwatch-file (chokidar)
 *
 * IPC channels: 24 total — see index.html preload.js for full list
 *
 * Dependencies: utils, tool-finder, window-manager (getWindows for preview)
 * State: droppedFilePath, recentDirectories, fileWatchers
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { execSync, spawn, exec } = require('child_process');
const { Worker } = require('worker_threads');
const { ipcMain, app, BrowserWindow, shell, dialog } = require('electron');
const { extractTextFromBuffer, copyDirRecursive, isArchiveFile, find7z } = require('./utils');
const { find7zExecutable } = require('./tool-finder');
const { MAX_RECENT_DIRS } = require('./constants');
const { getWindows } = require('./window-manager');
const chokidar = (() => { try { return require('chokidar'); } catch(e) { return null; } })();
const projectRoot = path.resolve(__dirname, '..', '..');

// ===================================================================
// State
// ===================================================================

let droppedFilePath = '';
let recentDirectories = [];
const fileWatchers = new Map();

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

// ===================================================================
// IPC: Window-level file setup
// ===================================================================


function setupIPC(mainWindow) {
  
  // 处理大文件解析请求
  ipcMain.handle('parse-large-file', async (event, filePath) => {
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(projectRoot, 'workers', 'log-parser-worker.js'), {
          workerData: { filePath }
        });

        worker.on('message', (data) => {
          if (data.type === 'progress') {
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
    } catch (error) {
      console.error('[parse-large-file] failed:', error);
      return { success: false, error: error.message };
    }
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
    try {
      const watcher = fileWatchers.get(filePath);
      if (watcher) {
        watcher.close();
        fileWatchers.delete(filePath);
      }
      return { success: true };
    } catch (error) {
      console.error('[unwatch-file] failed:', error);
      return { success: false, error: error.message };
    }
  });
}

// ===================================================================
// IPC: File operations (lines 1652-2117)
// ===================================================================


ipcMain.handle('file-exists', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return {
      success: true,
      exists: stats.isFile(),
      size: stats.size
    };
  } catch (e) {
    return {
      success: true,
      exists: false,
      size: 0
    };
  }
});


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


ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    let absolutePath = filePath;
    if (!path.isAbsolute(filePath)) {
      absolutePath = path.resolve(filePath);
    }
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: '文件不存在: ' + absolutePath };
    }
    try {
      await shell.trashItem(absolutePath);
    } catch (trashError) {
      // shell.trashItem 有时虽抛异常但文件实际已删除，检查文件是否还存在
      if (!fs.existsSync(absolutePath)) {
        return { success: true };
      }
      throw trashError;
    }
    return { success: true };
  } catch (error) {
    console.error('删除文件失败:', error);
    return { success: false, error: error.message };
  }
});

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

ipcMain.handle('open-terminal', async (event, dirPath) => {
  try {
    console.log('=== 尝试打开 WezTerm 终端 ===');

    // WezTerm 可执行文件路径
    const weztermPath = path.join(projectRoot, 'WezTerm', 'wezterm-gui.exe');
    const weztermDir = path.join(projectRoot, 'WezTerm');

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

// ===================================================================
// IPC: File reading (lines 2522-2645)
// ===================================================================

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

// 🔧 流式读取大文件 - 逐块推送，内存仅需 ~64KB chunk buffer
ipcMain.handle('read-file-streaming', async (event, filePath) => {
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      return { success: false, error: '路径不是文件' };
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: '无法找到对应的窗口' };
    }

    const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 流式读取支持更大的文件 (5GB)
    if (stats.size > MAX_FILE_SIZE) {
      return { success: false, error: `文件过大 (${(stats.size / 1024 / 1024).toFixed(1)}MB)` };
    }

    const CHUNK_SIZE = 64 * 1024; // 64KB chunks
    const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
    let accumulatedBuffer = '';
    let lineCount = 0;
    let isBinary = false;

    // 采样检测二进制（读取前 32KB 采样）
    let sampleBuffer = Buffer.alloc(0);

    return new Promise((resolve, reject) => {
      let firstSampleDone = false;

      stream.on('data', (chunk) => {
        // 首次采样检测二进制
        if (!firstSampleDone) {
          sampleBuffer = Buffer.concat([sampleBuffer, chunk]);
          if (sampleBuffer.length >= 32768) {
            let nullCount = 0;
            for (let i = 0; i < Math.min(sampleBuffer.length, 32768); i++) {
              if (sampleBuffer[i] === 0) nullCount++;
            }
            isBinary = (nullCount / sampleBuffer.length) > 0.5;
            firstSampleDone = true;

            if (isBinary) {
              stream.destroy();
              win.webContents.send('file-stream-chunk', ['[二进制文件，请使用过滤模式搜索]']);
              resolve({ success: true, size: stats.size, isBinary: true });
              return;
            }
          }
        }

        const text = chunk.toString('utf-8');
        accumulatedBuffer += text;
        const lines = accumulatedBuffer.split('\n');
        accumulatedBuffer = lines.pop(); // 保留不完整的最后一行

        if (lines.length > 0) {
          lineCount += lines.length;
          win.webContents.send('file-stream-chunk', lines);
        }
      });

      stream.on('end', () => {
        // 发送剩余的 buffer 内容
        if (accumulatedBuffer) {
          lineCount++;
          win.webContents.send('file-stream-chunk', [accumulatedBuffer]);
        }
        // 发送结束标记
        win.webContents.send('file-stream-chunk', ['__STREAM_END__', String(lineCount)]);
        resolve({ success: true, size: stats.size, lineCount });
      });

      stream.on('error', (err) => {
        console.error('流式读取文件失败:', err);
        reject(err);
      });
    });
  } catch (error) {
    console.error('流式读取文件失败:', error);
    return { success: false, error: error.message };
  }
});

// ===================================================================
// IPC: File list/read/search (lines 3211-3877)
// ===================================================================

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
        const worker = new Worker(path.join(projectRoot, 'workers', 'directory-scanner.js'), {
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
  try {
    addRecentDirectory(dirPath);
    return { success: true };
  } catch (error) {
    console.error('[add-recent-directory] failed:', error);
    return { success: false, error: error.message };
  }
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

// ===================================================================
// IPC: Dialog, file copy, WinRAR (lines 5591-5999)
// ===================================================================

ipcMain.handle('show-folder-selection-dialog', async (event, options) => {
  try {
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
    return { cancelled: true };
  } else {
    return {
      cancelled: false,
      selectedPath: matches[result.response]
    };
  }
  } catch (error) {
    console.error('[show-folder-selection-dialog] failed:', error);
    return { cancelled: true, error: error.message };
  }
});


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

// ===================================================================
// IPC: Misc (lines 6044-6180)
// ===================================================================

ipcMain.handle('get-cwd', async () => {
  try {
    return process.cwd();
  } catch (error) {
    console.error('[get-cwd] failed:', error);
    return '';
  }
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
  try {
    return droppedFilePath || '';
  } catch (error) {
    console.error('[get-dropped-path] failed:', error);
    return '';
  }
});

// 获取窗口预览内容
ipcMain.handle('get-window-preview', async (event, windowId) => {
  const win = getWindows().find(w => w.windowId === windowId);
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

// ===================================================================
// Module registration
// ===================================================================

function registerIpcHandlers() {
  // All IPC handlers are registered at module load time above
}

module.exports = {
  registerIpcHandlers,
  getDroppedFilePath: () => droppedFilePath,
  getRecentDirectories: () => recentDirectories,
  getFileWatchers: () => fileWatchers,
  setupIPC,
  addRecentDirectory
};
