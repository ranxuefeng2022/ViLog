/**
 * 远程目录共享 IPC 包装
 */

const { ipcMain } = require('electron');
const { startLocalServer, stopLocalServer, getLocalServerInfo } = require('./remote-share-server');
const { listRemoteDirectory, readRemoteFile, getRemoteTree } = require('./remote-client');
const { find7z } = require('./utils');

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

function registerIpcHandlers() {
  // All IPC handlers are registered at module load time above
}

module.exports = { registerIpcHandlers };
