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

// Valid receive channels for on/removeListener whitelist
const VALID_RECEIVE_CHANNELS = [
  'import-file-from-taskbar', 'uart-log-data', 'directory-changed',
  'archive-file-extracted', 'keyword-changed', 'extract-progress'
];

// Invoke channel mapping: { apiMethod: 'ipc-channel-name' }
// All follow: method(...args) => ipcRenderer.invoke(channel, ...args)
const INVOKE_CHANNELS = {
  // Window management
  createNewWindow: 'create-new-window',
  openUartLogWindow: 'open-uart-log-window',
  focusWindow: 'focus-window',
  getWindowList: 'get-window-list',
  getWindowPreview: 'get-window-preview',
  onlineUpdate: 'online-update',
  // File operations
  fileExists: 'file-exists',
  openFileWithDefaultApp: 'open-file-with-default-app',
  openPath: 'open-path',
  deleteFile: 'delete-file',
  openWithApp: 'open-with-app',
  openTerminal: 'open-terminal',
  openHtmlWindow: 'open-html-window',
  downloadRemoteFile: 'download-remote-file',
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
  exportArchiveFilesForRipgrep: 'export-archive-files-for-ripgrep',
  // Archive filter config
  getArchiveFilterConfig: 'get-archive-filter-config',
  saveArchiveFilterConfig: 'save-archive-filter-config',
  resetArchiveFilterConfig: 'reset-archive-filter-config',
  // Debug helpers
  openExtractDir: 'open-extract-dir',
  listExtractDirs: 'list-extract-dirs',
  cleanupAllExtractDirs: 'cleanup-all-extract-dirs',
  getDebugLogFiles: 'get-debug-log-files',
  openDebugLogsDir: 'open-debug-logs-dir',
  // Remote share
  startLocalShare: 'start-local-share',
  stopLocalShare: 'stop-local-share',
  getLocalShareStatus: 'get-local-share-status',
  connectRemote: 'connect-remote',
  readRemoteFile: 'read-remote-file',
  getRemoteTree: 'get-remote-tree',
  listRemoteArchive: 'list-remote-archive',
  // Update
  updateCode: 'update-code',
  checkUpdateServer: 'check-update-server',
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
