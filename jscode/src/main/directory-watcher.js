/**
 * 文件系统监听器管理
 */

const fs = require('fs');
const { ipcMain, BrowserWindow } = require('electron');

const fsWatchers = new Map();

function stopAllWatchers() {
  for (const [watchedPath, watcher] of fsWatchers) {
    try {
      watcher.close();
    } catch (e) {
      // 忽略错误
    }
  }
  fsWatchers.clear();
  console.log('[文件监听] 已停止所有监听器');
}

function registerIpcHandlers() {
  ipcMain.handle('watch-directory', async (event, dirPath) => {
    try {
      if (fsWatchers.has(dirPath)) {
        fsWatchers.get(dirPath).close();
        fsWatchers.delete(dirPath);
      }

      if (!fs.existsSync(dirPath)) {
        return { success: false, error: '目录不存在' };
      }

      const watcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
        if (!filename) {
          console.log(`[文件监听] ${dirPath} 批量变化 (无具体文件名)`);
          filename = null;
        } else {
          console.log(`[文件监听] ${dirPath} 变化: ${eventType} ${filename}`);
        }

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

      var watcherErrorCount = 0;
      watcher.on('error', (error) => {
        console.error(`[文件监听] ${dirPath} 错误:`, error);
        if (error && (error.code === 'ENOSPC' || error.message && error.message.includes('ENOSPC'))) {
          watcherErrorCount++;
          if (watcherErrorCount <= 3) {
            console.log(`[文件监听] ENOSPC，尝试重建监听 ${dirPath}`);
            setTimeout(() => {
              if (fs.existsSync(dirPath)) {
                try { watcher.close(); } catch (e) {}
                fsWatchers.delete(dirPath);
                BrowserWindow.getAllWindows().forEach(win => {
                  if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
                    win.webContents.send('directory-changed', {
                      dirPath, eventType: 'reopen', filename: null
                    });
                  }
                });
              }
            }, 2000);
          }
        }
      });

      fsWatchers.set(dirPath, watcher);

      return { success: true };
    } catch (error) {
      console.error('[文件监听] 启动失败:', error);
      return { success: false, error: error.message };
    }
  });

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
}

module.exports = {
  registerIpcHandlers,
  stopAllWatchers,
  getFsWatchers: () => fsWatchers
};
