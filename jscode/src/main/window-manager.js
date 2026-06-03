/**
 * Window Manager — BrowserWindow lifecycle, tray, shortcuts
 *
 * Responsibilities:
 *   - createWindow() — BrowserWindow factory with preload, icon, bounds
 *   - Window control IPC: minimize, maximize, close, resize, setBounds
 *   - Multi-window: createNewWindow, focusWindow, getWindowList, getWindowPreview
 *   - Special windows: vlog-chart
 *   - createTray() — system tray with window management menu
 *   - Export shared state: windows[], mainWindow, pendingFiles, appIsQuitting
 *
 * IPC channels: window-minimize, window-maximize, window-close, window-is-maximized,
 *   window-resize, window-set-bounds, window-get-bounds, create-new-window,
 *   open-vlog-chart-window, focus-window, get-window-list (11)
 *
 * Dependencies: utils (focusWindowSafe)
 * Used by: index.js (orchestrator), keyword-db (getWindows), file-operations (getWindows)
 */

const path = require('path');
const fs = require('fs');
const { BrowserWindow, Menu, Tray, ipcMain, app } = require('electron');
const { focusWindowSafe } = require('./utils');
const projectRoot = path.resolve(__dirname, '..', '..');

// ===================================================================
// State
// ===================================================================

let mainWindow;
let tray = null;
let windows = [];
let windowIdCounter = 0;
let pendingFiles = [];
let appIsQuitting = false;

// Delay import for temp-dir-manager to avoid circular deps
let getRendererTempDirs = () => new Map();
function setRendererTempDirsGetter(fn) {
  getRendererTempDirs = fn;
}


function createWindow(options = {}) {
  // 分配窗口序号（用于显示标题）
  const windowNumber = windows.length + 1;
  const windowTitle = '窗口' + windowNumber;

  // 创建浏览器窗口
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    frame: false, // 无边框窗口
    autoHideMenuBar: true, // 自动隐藏菜单栏
    backgroundColor: '#1e1e1e', // 背景色，配合主题
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // 关闭沙箱以允许 --max-old-space-size 生效（已有 contextIsolation 保护）
      webSecurity: false, // 允许加载本地文件
      allowRunningInsecureContent: true,
      preload: path.join(projectRoot, 'preload.js'), // 添加 preload 脚本

      // 🚀 内存优化选项
      spellcheck: false, // 禁用拼写检查
      plugins: false, // 禁用插件（如 Flash）
      webGL: false, // 禁用 WebGL（如果不需要 3D）
      // 注意：禁用某些功能可能影响性能，根据实际需求调整
    },
    icon: path.join(projectRoot, 'icons', 'icon.ico'), // Windows 图标（如果存在）
    show: false, // 先不显示，等加载完成后再显示
    title: options.title || windowTitle // 设置窗口标题
  });

  // 分配窗口ID
  const windowId = ++windowIdCounter;
  win.windowId = windowId;
  win.windowNumber = windowNumber; // 存储窗口序号

  // 获取 index.html 的路径（拆分后的新版本）
  const htmlPath = path.join(projectRoot, 'index.html');
  const preloadPath = path.join(projectRoot, 'preload.js');

  // 调试：打印路径信息
  console.log('=== 创建窗口 ===');
  console.log('html 路径:', htmlPath);
  console.log('preload 路径:', preloadPath);
  console.log('preload 文件存在:', fs.existsSync(preloadPath));

  // 检查文件是否存在
  if (fs.existsSync(htmlPath)) {
    // 加载 index.html 文件（拆分后的新版本）
    if (process.env.NODE_ENV === 'development') {
      win.loadFile(htmlPath, { query: { debug: '' } });
    } else {
      win.loadFile(htmlPath);
    }
  } else {
    // 如果文件不存在，显示错误页面
    win.loadURL('data:text/html,<h1>错误：找不到 index.html 文件</h1>');
  }

  // 窗口准备好后显示
  win.once('ready-to-show', () => {
    // 开发模式下不再自动打开开发者工具
    // 如需调试，请按 F12 手动打开
    win.maximize();
    win.show();
  });

  // 监听原生窗口的拖拽事件（使用事件拦截）
  win.on('blur', () => {
    // 窗口失去焦点时重置
  });

  // 使用 executeJavaScript 尝试获取拖拽数据
  let pendingDrop = null;

  // 注册快捷键打开开发者工具 (Ctrl+Shift+I, F12)
  win.on('app-command', (e, cmd) => {
    // Windows浏览器命令
    if (cmd === 'browser-devtools-focus') {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools();
      }
    }
  });

  // DevTools 独立窗口始终置顶
  win.webContents.on('devtools-opened', () => {
    const applyTop = () => {
      const allWindows = BrowserWindow.getAllWindows();
      for (const w of allWindows) {
        if (!windows.includes(w)) {
          w.setAlwaysOnTop(true, 'floating');
          return w;
        }
      }
      return null;
    };
    setTimeout(applyTop, 200);

    // 主窗口获得焦点时重新提升 DevTools
    const onFocus = () => {
      const dtw = applyTop();
      if (dtw) dtw.focus();
    };
    win.on('focus', onFocus);
    win.webContents.once('devtools-closed', () => {
      win.removeListener('focus', onFocus);
    });
  });

  // 监听来自渲染进程的消息
  win.webContents.on('did-finish-load', () => {
    console.log('页面加载完成');
    // 设置 IPC 通信
    setupIPCForWindow(win);
    // 发送窗口ID到渲染进程
    win.webContents.send('window-init', { windowId, windowNumber, title: windowTitle });
    // 通知所有窗口更新窗口列表
    broadcastWindowList();
  });

  // 窗口关闭时从列表中移除
  win.on('closed', () => {
    windows = windows.filter(w => w.windowId !== windowId);
    broadcastWindowList();
    // 如果这是主窗口
    if (win === mainWindow) {
      mainWindow = null;
    }
    // 清理该窗口关联的临时目录
    try {
      const rendererId = win.webContents?.id;
      if (rendererId) {
        const tempDirs = getRendererTempDirs();
        if (tempDirs.has(rendererId)) {
          const tempDir = tempDirs.get(rendererId);
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
          tempDirs.delete(rendererId);
        }
      }
    } catch (e) {
      console.error('[cleanup] 清理临时目录失败:', e);
    }
    // 清理该窗口关联的分片临时目录
    try {
      const rendererId = win.webContents?.id;
      if (rendererId) {
        const { cleanupForWindow } = require('./chunk-file-reader');
        cleanupForWindow(rendererId);
      }
    } catch (e) {
      console.error('[cleanup] 清理分片临时目录失败:', e);
    }
    // 清理该窗口关联的 copy-to-temp 临时目录
    try {
      const rendererId = win.webContents?.id;
      if (rendererId) {
        const { rendererCopyTempDirs } = require('./file-operations');
        if (rendererCopyTempDirs.has(rendererId)) {
          const copyTempDir = rendererCopyTempDirs.get(rendererId);
          if (fs.existsSync(copyTempDir)) {
            fs.rmSync(copyTempDir, { recursive: true, force: true });
          }
          rendererCopyTempDirs.delete(rendererId);
        }
      }
    } catch (e) {
      console.error('[cleanup] 清理 copy-to-temp 临时目录失败:', e);
    }
  });

  // 添加到窗口列表
  windows.push(win);

  // 如果是第一个窗口，设为主窗口
  if (!mainWindow) {
    mainWindow = win;
  }

  return win;
}

function setupIPCForWindow(win) {
  // 窗口特定的 IPC 处理可以在这里添加
}

// 广播窗口列表到所有窗口
function broadcastWindowList() {
  const windowList = windows.map(w => ({
    id: w.windowId,
    windowNumber: w.windowNumber,
    title: '窗口' + w.windowNumber,
    isFocused: w.isFocused()
  }));

  windows.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-list-updated', windowList);
    }
  });
}

function focusWindow(windowId) {
  const win = windows.find(w => w.windowId === windowId);
  focusWindowSafe(win);
}


function createTray() {
  try {
    // 尝试使用自定义图标
    const iconPath = path.join(projectRoot, 'icons', 'icon.png');
    const iconIco = path.join(projectRoot, 'icons', 'icon.ico');
    
    let iconFile = null;
    if (fs.existsSync(iconPath)) {
      iconFile = iconPath;
    } else if (fs.existsSync(iconIco)) {
      iconFile = iconIco;
    }
    
    // 如果没有图标文件，跳过托盘创建（某些平台需要图标）
    if (!iconFile && process.platform === 'linux') {
      console.log('跳过系统托盘：未找到图标文件');
      return;
    }
    
    tray = new Tray(iconFile || app.getAppPath());
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusWindowSafe(focusedWindow);
          } else if (windows.length > 0) {
            focusWindowSafe(windows[0]);
          } else {
            createWindow();
          }
        }
      },
      {
        label: '最小化到托盘',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusedWindow.minimize();
          } else if (windows.length > 0) {
            windows[0].minimize();
          }
        }
      },
      {
        label: '新建窗口',
        click: () => {
          createWindow();
        }
      },
      { type: 'separator' },
      {
        label: '开发者工具',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            if (focusedWindow.webContents.isDevToolsOpened()) {
              focusedWindow.webContents.closeDevTools();
            } else {
              focusedWindow.webContents.openDevTools();
            }
          }
        }
      },
      { type: 'separator' },
      {
        label: '退出应用',
        click: () => {
          appIsQuitting = true;
          // 关闭所有窗口
          windows.forEach(win => {
            if (!win.isDestroyed()) {
              win.destroy();
            }
          });
          app.quit();
        }
      }
    ]);

    tray.setToolTip('日志查看器 - 高性能日志分析工具');
    tray.setContextMenu(contextMenu);

    // 双击托盘图标显示/隐藏窗口
    tray.on('double-click', () => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
        if (focusedWindow.isVisible()) {
          focusedWindow.hide();
        } else {
          focusWindowSafe(focusedWindow);
        }
      } else if (windows.length > 0) {
        focusWindowSafe(windows[0]);
      } else {
        createWindow();
      }
    });

    // 单击托盘图标显示/隐藏窗口
    tray.on('click', () => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
        if (focusedWindow.isVisible()) {
          focusedWindow.minimize();
        } else {
          focusWindowSafe(focusedWindow);
        }
      } else if (windows.length > 0) {
        focusWindowSafe(windows[0]);
      } else {
        createWindow();
      }
    });
  } catch (error) {
    console.error('创建系统托盘失败:', error);
    // 托盘创建失败不影响主应用运行
  }
}

// ===================================================================
// Module registration
// ===================================================================

function registerIpcHandlers() {
  ipcMain.on('window-minimize', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) focusedWindow.minimize();
  });

  ipcMain.on('window-minimize-all', () => {
    windows.forEach(win => {
      if (!win.isDestroyed()) {
        win.minimize();
      }
    });
  });

  ipcMain.handle('window-maximize', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      if (focusedWindow.isMaximized()) {
        focusedWindow.unmaximize();
      } else {
        focusedWindow.maximize();
      }
    }
  });

  ipcMain.on('window-close', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow && windows.length > 1) {
      // 如果有多个窗口，只关闭当前窗口
      focusedWindow.close();
    } else if (focusedWindow) {
      // 如果只有一个窗口，关闭应用
      appIsQuitting = true;
      focusedWindow.close();
    }
  });

  ipcMain.handle('window-is-maximized', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    return focusedWindow ? focusedWindow.isMaximized() : false;
  });

  // 调整窗口大小
  ipcMain.on('window-resize', (event, width, height) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.setSize(width, height);
    }
  });

  // 设置窗口边界（位置和大小）
  ipcMain.handle('window-set-bounds', (event, bounds) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.setBounds(bounds);
    }
  });

  // 获取窗口边界
  ipcMain.handle('window-get-bounds', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    return focusedWindow ? focusedWindow.getBounds() : null;
  });

  // 创建新窗口
  ipcMain.handle('create-new-window', (event, options) => {
    const newWindow = createWindow(options);
    return { windowId: newWindow.windowId };
  });

  // 打开vlog图表可视化窗口
  ipcMain.handle('open-vlog-chart-window', async (event, data) => {
    try {
      const win = createWindow({
        title: 'Vlog电池数据可视化',
        width: 1400,
        height: 900,
        webPreferences: {
          contextIsolation: true,
          preload: path.join(projectRoot, 'preload-vlog-chart.js')
        }
      });

      // 加载HTML文件
      const htmlPath = path.join(projectRoot, 'vlog-chart.html');
      await win.loadFile(htmlPath);

      // 等待窗口加载完成后发送数据
      win.webContents.on('did-finish-load', () => {
        win.webContents.send('vlog-data', data);
      });

      return { success: true, windowId: win.windowId };
    } catch (error) {
      console.error('打开vlog图表窗口失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 切换到指定窗口
  ipcMain.handle('focus-window', (event, windowId) => {
    focusWindow(windowId);
  });

  // 获取窗口列表
  ipcMain.handle('get-window-list', () => {
    return windows.map(w => ({
      id: w.windowId,
      windowNumber: w.windowNumber,
      title: '窗口' + w.windowNumber,
      isFocused: w.isFocused()
    }));
  });
}

module.exports = {
  registerIpcHandlers,
  setRendererTempDirsGetter,
  getMainWindow: () => mainWindow,
  getWindows: () => windows,
  getWindowIdCounter: () => windowIdCounter,
  getPendingFiles: () => pendingFiles,
  getTray: () => tray,
  createWindow,
  broadcastWindowList,
  focusWindow,
  createTray,
  // Export for mutation
  set mainWindow(val) { mainWindow = val; },
  set pendingFiles(val) { pendingFiles = val; },
  get appIsQuitting() { return appIsQuitting; },
  set appIsQuitting(val) { appIsQuitting = val; }
};
