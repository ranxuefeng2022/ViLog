/**
 * 搜索工具 - es.exe / rg.exe / batch search
 */

const fs = require('fs');
const { execSync, spawn } = require('child_process');
const { ipcMain } = require('electron');
const { findEsExecutable, findRgExecutable, findFzfExecutable, find7zExecutable } = require('./tool-finder');

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
        const args = [
          pattern,
          '--line-number',
          '--with-filename',
          '--no-heading',
          '--color', 'never',
          '-a',
        ];
        if (caseInsensitive) args.push('-i');
        args.push('--');
        for (const f of batchFiles) args.push(f);

        const rgProcess = spawn(execPath, args, {
          windowsHide: true,
          env: { ...process.env }
        });

        // 流式解析：逐行处理 stdout，避免 Buffer.concat OOM
        const tempMap = new Map();
        let tail = '';
        const MAX_RESULTS = 2000000;

        function parseLine(line) {
          for (let j = 1; j < line.length - 1; j++) {
            if (line.charCodeAt(j) !== 0x3A) continue;
            let numEnd = j + 1;
            while (numEnd < line.length) {
              const c = line.charCodeAt(numEnd);
              if (c >= 0x30 && c <= 0x39) numEnd++;
              else break;
            }
            if (numEnd > j + 1 && (numEnd >= line.length || line.charCodeAt(numEnd) === 0x3A)) {
              const filePath = line.substring(0, j);
              let lineNum = 0;
              for (let k = j + 1; k < numEnd; k++) {
                lineNum = lineNum * 10 + (line.charCodeAt(k) - 0x30);
              }
              const content = includeContent ? line.substring(numEnd + 1) : '';
              let arr = tempMap.get(filePath);
              if (!arr) { arr = []; tempMap.set(filePath, arr); }
              arr.push({ lineNum, content });
              return;
            }
          }
        }

        let totalResults = 0;
        rgProcess.stdout.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          const lines = text.split('\n');
          lines[0] = tail + lines[0];
          tail = lines.pop();
          for (let i = 0; i < lines.length; i++) {
            if (totalResults >= MAX_RESULTS) break;
            if (lines[i].length > 0) {
              parseLine(lines[i]);
              totalResults++;
            }
          }
        });

        const timeoutHandle = setTimeout(() => {
          rgProcess.kill();
          finish();
        }, 60000);

        function finish() {
          if (tail && tail.length > 0 && totalResults < MAX_RESULTS) {
            parseLine(tail);
            tail = '';
          }
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
        }

        rgProcess.on('close', (code) => {
          clearTimeout(timeoutHandle);
          if (code !== 0 && code !== 1) {
            resolve([]);
            return;
          }
          finish();
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

    // 🚀 P2: 并发限制器 — 最多 4 个 rg 进程同时运行，避免 CPU 颠簸和 I/O 争抢
    const MAX_CONCURRENT = 4;
    const totalBatches = Math.ceil(files.length / MAX_ARGS_PER_BATCH);

    async function runWithConcurrencyLimit() {
      const results = [];
      let running = 0;
      let nextBatch = 0;

      return new Promise((resolve) => {
        function startNext() {
          while (running < MAX_CONCURRENT && nextBatch < totalBatches) {
            const batchIdx = nextBatch++;
            running++;
            const startIdx = batchIdx * MAX_ARGS_PER_BATCH;
            const endIdx = Math.min(startIdx + MAX_ARGS_PER_BATCH, files.length);
            const batchFiles = files.slice(startIdx, endIdx);
            searchFileBatch(batchFiles).then((batchResult) => {
              results[batchIdx] = batchResult;
              running--;
              if (nextBatch < totalBatches || running > 0) {
                startNext();
              } else {
                resolve(results);
              }
            });
          }
        }
        startNext();
      });
    }

    const batchResultsArray = await runWithConcurrencyLimit();
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

function registerIpcHandlers() {
  // All IPC handlers are registered at module load time above
}

module.exports = { registerIpcHandlers };
