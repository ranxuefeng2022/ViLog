/**
 * Vlog图表窗口的预加载脚本
 */

const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的IPC通信API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  onVlogData: (callback) => {
    ipcRenderer.on('vlog-data', (event, data) => {
      callback(data);
    });
  }
});
