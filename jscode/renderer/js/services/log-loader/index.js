/**
 * 日志加载模块
 */

window.App = window.App || {};

window.App.LogLoader = (() => {
  'use strict';

  return {
    loadFiles(files) {
      if (typeof window.handleFileDrop === 'function') window.handleFileDrop(files);
    },
    loadPath(filePath) {
      if (typeof window.loadFileFromPath === 'function') window.loadFileFromPath(filePath);
    },
    getCurrentFiles() { return window.currentFiles || []; },
    getOriginalLines() { return window.originalLines || []; },
    init() {
      console.log('[LogLoader] Ready');
    }
  };
})();
