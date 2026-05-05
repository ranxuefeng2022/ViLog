/**
 * 临时目录管理 - 用于文件树选中时的自动解压
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { ipcMain } = require('electron');
const { extractArchiveToDir } = require('./archive-handler');
const projectRoot = path.resolve(__dirname, '..', '..');

// 存储渲染进程的临时目录信息
const rendererTempDirs = new Map();


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
      appDir = projectRoot;
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

function registerIpcHandlers() {
  // All IPC handlers are registered at module load time above
}

module.exports = {
  registerIpcHandlers,
  rendererTempDirs
};
