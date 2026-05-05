/**
 * 搜索工具 - es.exe / rg.exe / batch search
 */

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

function registerIpcHandlers() {
  // All IPC handlers are registered at module load time above
}

module.exports = { registerIpcHandlers };
