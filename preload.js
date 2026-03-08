const { contextBridge, ipcRenderer } = require('electron');

// 调试：确认 preload.js 已加载
console.log('=== preload.js 已加载 ===');
console.log('contextBridge 类型:', typeof contextBridge);
console.log('ipcRenderer 类型:', typeof ipcRenderer);

// 暴露窗口控制API到渲染进程
try {
  contextBridge.exposeInMainWorld('electronAPI', {
    windowControl: {
      minimize: () => ipcRenderer.send('window-minimize'),
      minimizeAll: () => ipcRenderer.send('window-minimize-all'),
      maximize: () => ipcRenderer.invoke('window-maximize'),
      close: () => ipcRenderer.send('window-close'),
      isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
      getBounds: () => ipcRenderer.invoke('window-get-bounds'),
      setBounds: (bounds) => ipcRenderer.invoke('window-set-bounds', bounds)
    },
    createNewWindow: (options) => ipcRenderer.invoke('create-new-window', options),
    openUartLogWindow: () => ipcRenderer.invoke('open-uart-log-window'),
    focusWindow: (windowId) => ipcRenderer.invoke('focus-window', windowId),
    getWindowList: () => ipcRenderer.invoke('get-window-list'),
    getWindowPreview: (windowId) => ipcRenderer.invoke('get-window-preview', windowId),
    onlineUpdate: () => ipcRenderer.invoke('online-update'),
    // 检查文件是否存在 - 通过 IPC 调用主进程
    fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
    // 使用系统默认程序打开文件 - 通过 IPC 调用主进程
    openFileWithDefaultApp: (filePath) => ipcRenderer.invoke('open-file-with-default-app', filePath),
    // 🔧 打开文件路径（在资源管理器中选中文件）
    openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
    // 🔧 用指定程序打开文件
    openWithApp: (appPath, filePath) => ipcRenderer.invoke('open-with-app', appPath, filePath),
    // 打开 WezTerm 终端
    openTerminal: (dirPath) => ipcRenderer.invoke('open-terminal', dirPath),
    // 🚀 打开HTML文件窗口
    openHtmlWindow: (filePath) => ipcRenderer.invoke('open-html-window', filePath),
    // 🚀 下载远程文件到临时目录（用于打开远程HTML文件）
    downloadRemoteFile: (remoteUrl, fileName) => ipcRenderer.invoke('download-remote-file', remoteUrl, fileName),
    // 读取文件内容 - 支持 WinRAR 拖拽
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    // 读取多个文件内容
    readFiles: (filePaths) => ipcRenderer.invoke('read-files', filePaths),
    // 读取文件夹（递归）
    readFolder: (folderPath) => ipcRenderer.invoke('read-folder', folderPath),
    // 列出文件夹内容（不递归，不读取文件内容，用于懒加载）
    listFolder: (folderPath, options) => ipcRenderer.invoke('list-folder', folderPath, options),
    // 🚀 智能搜索文件夹 - 在所有驱动器上搜索指定名称的文件夹
    searchFolder: (folderName) => ipcRenderer.invoke('search-folder', folderName),
    // 显示文件夹选择对话框 - 当找到多个同名文件夹时使用
    showFolderSelectionDialog: (options) => ipcRenderer.invoke('show-folder-selection-dialog', options),
    // 获取拖拽文件的完整路径
    getDroppedPath: () => ipcRenderer.invoke('get-dropped-path'),
    // 获取当前工作目录
    getCwd: () => ipcRenderer.invoke('get-cwd'),
    // 使用klog转换UTC时间（通过临时文件）
    convertUtcUsingKlog: (content) => ipcRenderer.invoke('convert-utc-using-temp-file', content),
    // 使用klog_parallel并行转换UTC时间
    convertUtcParallel: (options) => ipcRenderer.invoke('convert-utc-parallel', options),
    // 复制文件到临时目录（用于WinRAR等工具的拖拽）
    copyFilesToTemp: (filePaths) => ipcRenderer.invoke('copy-files-to-temp', filePaths),
    // 解析WinRAR相对路径（WinRAR拖拽时提供的是相对路径）
    resolveWinRarPath: (relativePath, isDirectory) => ipcRenderer.invoke('resolve-winrar-path', relativePath, isDirectory),
    // 记录最近访问的目录
    addRecentDirectory: (dirPath) => ipcRenderer.invoke('add-recent-directory', dirPath),
    // 🚀 获取可用的数据盘驱动器列表（用于文件树预暴露）
    getDataDrives: () => ipcRenderer.invoke('get-data-drives'),
    // 🚀 列出目录内容（用于文件树展开）
    listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),
    // 🚀 列出压缩包内容（用于展开本地压缩包）
    listArchive: (archivePath) => ipcRenderer.invoke('list-archive', archivePath),
    // 保存日志到文件
    saveLog: (level, message, data) => ipcRenderer.invoke('save-log', { level, message, data }),
    // 获取日志文件路径
    getLogFilePath: () => ipcRenderer.invoke('get-log-file-path'),
    // 🔧 从压缩包中提取单个文件内容
    extractFileFromArchive: (archivePath, filePath) => ipcRenderer.invoke('extract-file-from-archive', archivePath, filePath),
    // 🚀 解压压缩包到指定目录
    extractArchive: (archivePath, targetPath) => ipcRenderer.invoke('extract-archive', archivePath, targetPath),
    // 🚀 临时目录管理 - 用于文件树选中时的自动解压
    createTempExtractDir: () => ipcRenderer.invoke('create-temp-extract-dir'),
    clearTempExtractDir: () => ipcRenderer.invoke('clear-temp-extract-dir'),
    extractToTempDir: (archivePath, relativePath) => ipcRenderer.invoke('extract-to-temp-dir', archivePath, relativePath),
    deleteTempExtractDir: () => ipcRenderer.invoke('delete-temp-extract-dir'),
    getTempExtractDir: () => ipcRenderer.invoke('get-temp-extract-dir'),
    // 获取系统资源信息（CPU和内存占用率）
    getSystemStats: () => ipcRenderer.invoke('get-system-stats'),
    // 🚀 文件系统监听 - 监听目录变化
    watchDirectory: (dirPath) => ipcRenderer.invoke('watch-directory', dirPath),
    // 🚀 文件系统监听 - 停止监听目录
    unwatchDirectory: (dirPath) => ipcRenderer.invoke('unwatch-directory', dirPath),
    // 🔧 调用 Everything es.exe 命令行工具
    callES: (options) => ipcRenderer.invoke('call-es', options),
    // 🚀 调用 ripgrep rg.exe 命令行工具
    callRG: (options) => ipcRenderer.invoke('call-rg', options),
    // 🔧 检查所有工具的状态
    checkToolsStatus: () => ipcRenderer.invoke('check-tools-status'),
    // 🚀 导出压缩包中的文件到临时文件，用于 ripgrep 过滤
    exportArchiveFilesForRipgrep: (archiveFiles) => ipcRenderer.invoke('export-archive-files-for-ripgrep', archiveFiles),
    // 🔧 压缩包过滤配置管理
    // 获取配置
    getArchiveFilterConfig: () => ipcRenderer.invoke('get-archive-filter-config'),
    // 保存配置
    saveArchiveFilterConfig: (config) => ipcRenderer.invoke('save-archive-filter-config', config),
    // 重置配置
    resetArchiveFilterConfig: () => ipcRenderer.invoke('reset-archive-filter-config'),
    // 🔧 调试辅助功能
    // 打开解压目录
    openExtractDir: () => ipcRenderer.invoke('open-extract-dir'),
    // 列出所有解压目录
    listExtractDirs: () => ipcRenderer.invoke('list-extract-dirs'),
    // 清理所有解压目录
    cleanupAllExtractDirs: () => ipcRenderer.invoke('cleanup-all-extract-dirs'),
    // 获取调试日志文件列表
    getDebugLogFiles: () => ipcRenderer.invoke('get-debug-log-files'),
    // 打开调试日志目录
    openDebugLogsDir: () => ipcRenderer.invoke('open-debug-logs-dir'),
    // 监听主进程发送的消息
    on: (channel, callback) => {
      // 白名单机制，只允许特定的频道
      const validChannels = ['import-file-from-taskbar', 'uart-log-data', 'directory-changed'];
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
      }
    },
    // 移除监听器
    removeListener: (channel, callback) => {
      const validChannels = ['import-file-from-taskbar', 'uart-log-data', 'directory-changed'];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, callback);
      }
    },
    // 🚀 远程目录共享
    // 启动本地共享服务器
    startLocalShare: (options) => ipcRenderer.invoke('start-local-share', options),
    // 停止本地共享服务器
    stopLocalShare: () => ipcRenderer.invoke('stop-local-share'),
    // 获取本地共享状态
    getLocalShareStatus: () => ipcRenderer.invoke('get-local-share-status'),
    // 连接到远程共享
    connectRemote: (options) => ipcRenderer.invoke('connect-remote', options),
    // 读取远程文件
    readRemoteFile: (options) => ipcRenderer.invoke('read-remote-file', options),
    // 获取远程目录树
    getRemoteTree: (options) => ipcRenderer.invoke('get-remote-tree', options),
    // 🚀 列出远程压缩包内容
    listRemoteArchive: (options) => ipcRenderer.invoke('list-remote-archive', options),
    // 🔄 代码更新
    // 更新代码
    updateCode: (options) => ipcRenderer.invoke('update-code', options),
    // 检查更新服务器状态
    checkUpdateServer: (options) => ipcRenderer.invoke('check-update-server', options)
  });
  console.log('electronAPI 已成功暴露到 window 对象');
} catch (error) {
  console.error('暴露 electronAPI 时出错:', error);
}
