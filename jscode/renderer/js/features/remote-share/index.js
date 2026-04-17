/**
 * 远程共享模块
 *
 * Phase 1: 包装层
 * Phase 2: 将 original-script.js 中远程共享代码迁移到此处
 */

window.App = window.App || {};
window.App.RemoteShare = {
  /**
   * 启动本地共享
   */
  startLocalShare(path, port) {
    if (window.electronAPI && window.electronAPI.startLocalShare) {
      return window.electronAPI.startLocalShare(path, port);
    }
  },

  /**
   * 停止本地共享
   */
  stopLocalShare() {
    if (window.electronAPI && window.electronAPI.stopLocalShare) {
      return window.electronAPI.stopLocalShare();
    }
  },

  /**
   * 连接远程目录
   */
  connectRemote(ip, port, path) {
    if (window.electronAPI && window.electronAPI.connectRemote) {
      return window.electronAPI.connectRemote(ip, port, path);
    }
  },

  init() {
    console.log('[RemoteShare] Module ready');
  }
};
