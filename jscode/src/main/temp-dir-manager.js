/**
 * 临时目录管理 - 用于文件树选中时的自动解压
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // eslint-disable-line no-redeclare
const { ipcMain } = require('electron');
const { extractArchiveToDir } = require('./archive-handler');
const projectRoot = path.resolve(__dirname, '..', '..');
const fsp = fs.promises;

// 存储渲染进程的临时目录信息
const rendererTempDirs = new Map();


ipcMain.handle('create-temp-extract-dir', async (event) => {
  try {
    let appDir;
    if (process.resourcesPath) {
      appDir = process.resourcesPath;
    } else {
      appDir = projectRoot;
    }

    const baseTempDir = path.join(appDir, 'temp_extract');

    // 确保基础临时目录存在
    await fsp.mkdir(baseTempDir, { recursive: true });

    // 生成唯一的临时目录名
    const uniqueId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const tempDirPath = path.join(baseTempDir, `session-${uniqueId}`);

    await fsp.mkdir(tempDirPath, { recursive: true });

    // 获取渲染进程的 ID
    const rendererId = event.sender.id;

    // 如果该渲染进程已有临时目录，先清空
    if (rendererTempDirs.has(rendererId)) {
      const oldDir = rendererTempDirs.get(rendererId);
      try {
        await fsp.rm(oldDir, { recursive: true, force: true });
        console.log(`[temp-extract] 已清理旧临时目录: ${oldDir}`);
      } catch { /* 忽略清理失败 */ }
    }

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
  try {
    const rendererId = event.sender.id;
    const tempDir = rendererTempDirs.get(rendererId);

    if (!tempDir) {
      return { success: true };
    }

    try {
      await fsp.access(tempDir);
    } catch {
      return { success: true };
    }

    // 清空目录内容
    const files = await fsp.readdir(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stat = await fsp.stat(filePath);
      if (stat.isDirectory()) {
        await fsp.rm(filePath, { recursive: true, force: true });
      } else {
        await fsp.unlink(filePath);
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
  try {
    const rendererId = event.sender.id;
    const tempDir = rendererTempDirs.get(rendererId);

    if (!tempDir) {
      return { success: false, error: '临时目录不存在，请先创建临时目录' };
    }

    if (relativePath) {
      const archiveName = path.basename(archivePath);
      const extractDir = path.join(tempDir, archiveName);

      await fsp.mkdir(extractDir, { recursive: true });

      console.log(`[temp-extract] 解压 ${archivePath} -> ${extractDir}`);

      const result = await extractArchiveToDir(archivePath, extractDir);
      if (!result.success) {
        return result;
      }

      const extractedFilePath = path.join(extractDir, relativePath);



      return {
        success: true,
        extractedPath: extractedFilePath,
        extractDir: extractDir
      };
    } else {
      const archiveName = path.basename(archivePath, path.extname(archivePath));
      const extractDir = path.join(tempDir, archiveName);

      await fsp.mkdir(extractDir, { recursive: true });

      console.log(`[temp-extract] 解压 ${archivePath} -> ${extractDir}`);

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
  try {
    const rendererId = event.sender.id;
    const tempDir = rendererTempDirs.get(rendererId);

    if (!tempDir) {
      return { success: true };
    }

    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
      console.log(`[temp-extract] 已删除临时目录: ${tempDir}`);
    } catch { /* 忽略删除失败 */ }

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
