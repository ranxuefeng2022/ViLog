/**
 * App Orchestrator — application lifecycle + module wiring
 *
 * Responsibilities:
 *   - Debug mode setup + enable-debug-log IPC
 *   - V8 memory optimization flags
 *   - Single-instance lock
 *   - Require 16 feature modules, wire cross-module getters
 *   - Call all registerIpcHandlers()
 *   - app.whenReady() → init logging, engine, tray, window
 *   - App events: open-file, window-all-closed, before-quit, will-quit
 *
 * IPC channels: enable-debug-log (1)
 * Dependencies: all 16 modules under src/main/
 * Entry point: main.js → require('./src/main/index.js')
 */

const { app, BrowserWindow, Menu, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// ===================================================================
// Debug mode setup (before anything else)
// ===================================================================

const IS_DEBUG = app.commandLine.hasSwitch('debug') || process.env.NODE_ENV === 'development';
if (!IS_DEBUG) {
  const noop = () => {};
  const _orig = { log: console.log, debug: console.debug, info: console.info };
  let infoCount = 0;
  console.log = noop;
  console.debug = noop;
  console.info = function() {
    infoCount++;
    if (infoCount % 20 === 0) _orig.info.apply(console, arguments);
  };
  ipcMain.handle('enable-debug-log', () => {
    console.log = _orig.log;
    console.debug = _orig.debug;
    console.info = _orig.info;
    console.log('[Debug] 主进程详细日志已启用');
    return true;
  });
}

// ===================================================================
// Memory optimization (before app ready)
// ===================================================================

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1024');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-print-preview');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('v8-cache-options', 'code');
app.commandLine.appendSwitch('enable-features', 'V8CacheStrategiesForCacheStorage,PartiallyV8CacheCompile');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor,UseSkiaRenderer');
app.commandLine.appendSwitch('no-bg-cache-no-preload');

// ===================================================================
// Single instance lock
// ===================================================================

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('⚠️ 已有实例运行，退出当前实例');
  app.quit();
}

// ===================================================================
// Import modules
// ===================================================================

const logging = require('./logging');
const engine = require('./engine');
const windowManager = require('./window-manager');
const fileOperations = require('./file-operations');
const toolFinder = require('./tool-finder'); // Just for loading
const keywordDB = require('./keyword-db');
const remoteShareServer = require('./remote-share-server');
const remoteClient = require('./remote-client');
const directoryWatcher = require('./directory-watcher');
const archiveHandler = require('./archive-handler');
const tempDirManager = require('./temp-dir-manager');
const searchTools = require('./search-tools');
const remoteShareIPC = require('./remote-share-ipc');
const autoUpdate = require('./auto-update');
const { focusWindowSafe } = require('./utils');

// ===================================================================
// Wire cross-module getters (resolve circular deps)
// ===================================================================

windowManager.setRendererTempDirsGetter(() => tempDirManager.rendererTempDirs);
keywordDB.setWindowsGetter(() => windowManager.getWindows());

// ===================================================================
// Register all IPC handlers
// ===================================================================

logging.registerIpcHandlers();
windowManager.registerIpcHandlers();
keywordDB.registerIpcHandlers();
directoryWatcher.registerIpcHandlers();
archiveHandler.registerIpcHandlers();
tempDirManager.registerIpcHandlers();
fileOperations.registerIpcHandlers();
searchTools.registerIpcHandlers();
remoteShareIPC.registerIpcHandlers();
autoUpdate.registerIpcHandlers();

// ===================================================================
// App lifecycle
// ===================================================================

if (gotTheLock) {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('📂 收到文件，传递到现有窗口');
    const wins = windowManager.getWindows();
    if (wins.length > 0) {
      focusWindowSafe(BrowserWindow.getFocusedWindow() || wins[0]);
    }
  });
}

app.whenReady().then(() => {
  if (!gotTheLock) return;

  logging.initLogSystem();
  engine.detectPythonCommand();
  Menu.setApplicationMenu(null);
  windowManager.createTray();
  engine.startEngineProcess();

  windowManager.createWindow();

  // Setup file-related IPC that needs mainWindow reference
  const mainWindow = windowManager.getMainWindow();
  if (mainWindow) {
    fileOperations.setupIPC(mainWindow);
  }

  // Global shortcuts for DevTools
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
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createWindow();
    } else {
      BrowserWindow.getAllWindows().forEach(win => focusWindowSafe(win));

      const pendingFiles = windowManager.getPendingFiles();
      if (pendingFiles.length > 0) {
        const filesToImport = [...pendingFiles];
        windowManager.pendingFiles = [];

        setTimeout(() => {
          filesToImport.forEach(filePath => {
            BrowserWindow.getAllWindows().forEach(win => {
              if (win.webContents && !win.webContents.isDestroyed()) {
                win.webContents.send('import-file-from-taskbar', filePath);
              }
            });
          });
        }, 300);
      }
    }
  });
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();

  const allWindows = BrowserWindow.getAllWindows();

  if (allWindows.length === 0) {
    windowManager.pendingFiles.push(filePath);
    return;
  }

  const allMinimized = allWindows.every(win => win.isMinimized());

  if (allMinimized) {
    windowManager.pendingFiles.push(filePath);
  } else {
    allWindows.forEach(win => {
      if (!win.isMinimized() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('import-file-from-taskbar', filePath);
      }
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  logging.closeLogSystem();
});

app.on('will-quit', () => {
  directoryWatcher.stopAllWatchers();
  remoteShareServer.stopLocalServer();
  const keywordDBInstance = keywordDB.getKeywordDB();
  if (keywordDBInstance) {
    try { keywordDBInstance.close(); } catch(e) { /* 忽略 */ }
  }
  globalShortcut.unregisterAll();
  engine.stopEngineProcess();

  // Clean up all renderer temp dirs
  for (const [rendererId, tempDir] of tempDirManager.rendererTempDirs) {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      // 忽略清理错误
    }
  }
  tempDirManager.rendererTempDirs.clear();
});
