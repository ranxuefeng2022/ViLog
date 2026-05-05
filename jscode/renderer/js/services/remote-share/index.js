/**
 * 远程共享模块
 */

window.App = window.App || {};

window.App.RemoteShare = (() => {
  'use strict';

  return {
    startLocalShare(path, port) {
      return window.electronAPI ? window.electronAPI.startLocalShare({ path, port }) : Promise.reject('electronAPI not available');
    },
    stopLocalShare() {
      return window.electronAPI ? window.electronAPI.stopLocalShare() : Promise.reject('electronAPI not available');
    },
    connectRemote(ip, port, remotePath) {
      return window.electronAPI ? window.electronAPI.connectRemote({ ip, port, path: remotePath }) : Promise.reject('electronAPI not available');
    },
    getLocalShareStatus() {
      return window.electronAPI ? window.electronAPI.getLocalShareStatus() : null;
    },
    init() {
      console.log('[RemoteShare] Ready');
    }
  };
})();
