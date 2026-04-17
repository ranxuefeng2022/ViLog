/**
 * 右键菜单模块
 *
 * Phase 1: 包装层 — 定义清晰API，内部调用 original-script.js 的全局函数
 * Phase 2: 将 original-script.js 中右键菜单代码迁移到此处
 *
 * 依赖的全局函数（由 original-script.js 提供）：
 *   - showLogContextMenu(event, lineIndex)
 *   - hideLogContextMenu()
 *   - showFileTreeContextMenu(event, item)
 *   - hideFileTreeContextMenu()
 */

window.App = window.App || {};
window.App.ContextMenu = {
  /**
   * 显示日志区域右键菜单
   */
  showLog(event, lineIndex) {
    if (typeof window.showLogContextMenu === 'function') {
      window.showLogContextMenu(event, lineIndex);
    }
  },

  /**
   * 隐藏日志区域右键菜单
   */
  hideLog() {
    if (typeof window.hideLogContextMenu === 'function') {
      window.hideLogContextMenu();
    }
  },

  /**
   * 显示文件树右键菜单
   */
  showFileTree(event, item) {
    if (typeof window.showFileTreeContextMenu === 'function') {
      window.showFileTreeContextMenu(event, item);
    }
  },

  /**
   * 隐藏文件树右键菜单
   */
  hideFileTree() {
    if (typeof window.hideFileTreeContextMenu === 'function') {
      window.hideFileTreeContextMenu();
    }
  },

  init() {
    console.log('[ContextMenu] Module ready');
  }
};
