/**
 * 右键菜单模块
 */

window.App = window.App || {};

window.App.ContextMenu = (() => {
  'use strict';

  return {
    showLog(event, lineIndex) {
      if (typeof window.showLogContextMenu === 'function') window.showLogContextMenu(event, lineIndex);
    },
    hideLog() {
      if (typeof window.hideLogContextMenu === 'function') window.hideLogContextMenu();
    },
    showFileTree(event, item) {
      if (typeof window.showFileTreeContextMenu === 'function') window.showFileTreeContextMenu(event, item);
    },
    hideFileTree() {
      if (typeof window.hideFileTreeContextMenu === 'function') window.hideFileTreeContextMenu();
    },
    init() {
      console.log('[ContextMenu] Ready');
    }
  };
})();
