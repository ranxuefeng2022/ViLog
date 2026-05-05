/**
 * 文件树模块
 */

window.App = window.App || {};

window.App.FileTree = (() => {
  'use strict';

  return {
    load(path) {
      if (typeof window.loadFileTree === 'function') window.loadFileTree(path);
    },
    refresh() {
      if (typeof window.refreshFileTree === 'function') window.refreshFileTree();
    },
    search(term) {
      if (typeof window.searchFileTree === 'function') window.searchFileTree(term);
    },
    getData() {
      return window.fileTreeData || [];
    },
    init() {
      console.log('[FileTree] Ready');
    }
  };
})();
