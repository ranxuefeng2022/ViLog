/**
 * Preload Script — exposes electronAPI to renderer via contextBridge
 *
 * IPC invoke channels are declared in INVOKE_CHANNELS and auto-wrapped.
 * Special handlers (send-based, listener-based, parameter-transforming)
 * are written manually below.
 *
 * If adding a new IPC channel:
 *   1. Register handler in src/main/{module}.js
 *   2. Add entry to INVOKE_CHANNELS below (or write manual handler)
 *   3. Add channel to VALID_RECEIVE_CHANNELS if renderer needs to listen
 */

const { contextBridge, ipcRenderer } = require('electron');

// Debug 模式：暴露标志给渲染进程
contextBridge.exposeInMainWorld('__isDev', process.env.NODE_ENV === 'development');

// Valid receive channels for on/removeListener whitelist
const VALID_RECEIVE_CHANNELS = [
  'import-file-from-taskbar', 'directory-changed',
  'archive-file-extracted', 'keyword-changed', 'extract-progress',
  'csv-export-progress', 'chunk-index-progress', 'chunk-converted'
];

// Invoke channel mapping: { apiMethod: 'ipc-channel-name' }
// All follow: method(...args) => ipcRenderer.invoke(channel, ...args)
const INVOKE_CHANNELS = {
  // Window management
  createNewWindow: 'create-new-window',
  focusWindow: 'focus-window',
  getWindowList: 'get-window-list',
  getWindowPreview: 'get-window-preview',
  // File operations
  fileExists: 'file-exists',
  openFileWithDefaultApp: 'open-file-with-default-app',
  openPath: 'open-path',
  deleteFile: 'delete-file',
  openWithApp: 'open-with-app',
  openTerminal: 'open-terminal',
  openHtmlWindow: 'open-html-window',
  readFile: 'read-file',
  readFileStreaming: 'read-file-streaming',
  readFiles: 'read-files',
  readFolder: 'read-folder',
  listFolder: 'list-folder',
  searchFolder: 'search-folder',
  showFolderSelectionDialog: 'show-folder-selection-dialog',
  getDroppedPath: 'get-dropped-path',
  getCwd: 'get-cwd',
  copyFilesToTemp: 'copy-files-to-temp',
  resolveWinRarPath: 'resolve-winrar-path',
  addRecentDirectory: 'add-recent-directory',
  getDataDrives: 'get-data-drives',
  listDirectory: 'list-directory',
  // Archives
  listArchive: 'list-archive',
  listZipNative: 'list-zip-native',
  extractZipNative: 'extract-zip-native',
  extractFileFromArchive: 'extract-file-from-archive',
  streamExtractFromArchive: 'stream-extract-from-archive',
  extractArchive: 'extract-archive',
  extractArchiveWithProgress: 'extract-archive-progress',
  createTempExtractDir: 'create-temp-extract-dir',
  clearTempExtractDir: 'clear-temp-extract-dir',
  extractToTempDir: 'extract-to-temp-dir',
  deleteTempExtractDir: 'delete-temp-extract-dir',
  getTempExtractDir: 'get-temp-extract-dir',
  // Log CSV analysis
  exportCsvAnalysis: 'export-csv-analysis',
  getAnalysisKeywords: 'get-analysis-keywords',
  // Logging
  getLogFilePath: 'get-log-file-path',
  // System
  getSystemStats: 'get-system-stats',
  watchDirectory: 'watch-directory',
  unwatchDirectory: 'unwatch-directory',
  // External tools
  callES: 'call-es',
  callRG: 'call-rg',
  callRGBatch: 'call-rg-batch',
  checkToolsStatus: 'check-tools-status',
  // Chunk file reading (分片模式)
  buildLineIndex: 'build-line-index',
  readLinesRange: 'read-lines-range',
  readFilterTempAsText: 'read-filter-temp-as-text',
  buildIndexForFiles: 'build-index-for-files',
  buildIndexFromContent: 'build-index-from-content',
  extractToChunkTmp: 'extract-to-chunk-tmp',
  extractToChunkTmpBatch: 'extract-to-chunk-tmp-batch',
  convertKernelChunkFiles: 'convert-kernel-chunk-files',
  cleanupChunkTemp: 'cleanup-chunk-temp',
  writeLinesToFilterTemp: 'write-lines-to-filter-temp',
  filterChunkStream: 'filter-chunk-stream',
  readFilterIndices: 'read-filter-indices',
  exportArchiveFilesForRipgrep: 'export-archive-files-for-ripgrep',
  // Chunk-tmp file listing (for time conversion etc.)
  listChunkTmpFiles: 'list-chunk-tmp-files',
  aiShellExec: 'ai-shell-exec',
  aiSystemExec: 'ai-system-exec',
  aiFileRead: 'ai-file-read',
  aiFileWrite: 'ai-file-write',
  aiGetConfig: 'ai-get-config',
  aiCheckTools: 'ai-check-tools',
  aiScanEnv: 'ai-scan-env',
  // Filter cancellation
  cancelFilter: 'cancel-filter',
  // Archive filter config
  getArchiveFilterConfig: 'get-archive-filter-config',
  saveArchiveFilterConfig: 'save-archive-filter-config',
  resetArchiveFilterConfig: 'reset-archive-filter-config',
  // Android time conversion
  convertAndroidTime: 'convert-android-time',
  // Debug helpers
  openExtractDir: 'open-extract-dir',
  listExtractDirs: 'list-extract-dirs',
  cleanupAllExtractDirs: 'cleanup-all-extract-dirs',
  getDebugLogFiles: 'get-debug-log-files',
  openDebugLogsDir: 'open-debug-logs-dir',
  // Keyword persistence (SQLite)
  keywordLoadAll: 'keyword-load-all',
  keywordUpsertBatch: 'keyword-upsert-batch',
  keywordDelete: 'keyword-delete',
  keywordTrim: 'keyword-trim',
  keywordBroadcast: 'keyword-broadcast',
  keywordSaveTransitions: 'keyword-save-transitions',
  keywordGetTransitions: 'keyword-get-transitions',
  keywordSearch: 'keyword-search',
  keywordSearchFzf: 'keyword-search-fzf',
  keywordSaveCombo: 'keyword-save-combo',
  keywordLoadCombos: 'keyword-load-combos',
  keywordDeleteCombo: 'keyword-delete-combo',
  keywordSearchCombos: 'keyword-search-combos',
  // Config store (通用配置持久化)
  configGet: 'config-get',
  configSet: 'config-set',
  configDelete: 'config-delete',
  configGetAll: 'config-get-all',
};

// ===================================================================
// Build API — auto-generate invoke wrappers from mapping
// ===================================================================

const api = {};
for (const [method, channel] of Object.entries(INVOKE_CHANNELS)) {
  api[method] = (...args) => ipcRenderer.invoke(channel, ...args);
}

// ===================================================================
// Manual handlers — non-standard patterns
// ===================================================================

// Window control — mix of send (fire-and-forget) and invoke
api.windowControl = {
  minimize: () => ipcRenderer.send('window-minimize'),
  minimizeAll: () => ipcRenderer.send('window-minimize-all'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  getBounds: () => ipcRenderer.invoke('window-get-bounds'),
  setBounds: (bounds) => ipcRenderer.invoke('window-set-bounds', bounds)
};

// saveLog — transforms 3 args into single object
api.saveLog = (level, message, data) =>
  ipcRenderer.invoke('save-log', { level, message, data });

// File stream chunk listener
api.receiveFileChunk = (callback) => {
  const handler = (event, lines) => callback(lines);
  ipcRenderer.on('file-stream-chunk', handler);
  return handler;
};

api.removeFileChunkListener = (handler) => {
  ipcRenderer.removeListener('file-stream-chunk', handler);
};

// Whitelisted receive channels
api.on = (channel, callback) => {
  if (VALID_RECEIVE_CHANNELS.includes(channel)) {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  }
};

api.removeListener = (channel, callback) => {
  if (VALID_RECEIVE_CHANNELS.includes(channel)) {
    ipcRenderer.removeListener(channel, callback);
  }
};

// ===================================================================
// Expose to renderer
// ===================================================================

try {
  contextBridge.exposeInMainWorld('electronAPI', api);
  console.log('electronAPI exposed successfully');
} catch (error) {
  console.error('Failed to expose electronAPI:', error);
}
