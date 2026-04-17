/**
 * 文件树模块
 *
 * Phase 1: 包装层 — 定义清晰API
 * Phase 2: 将 original-script.js 中文件树代码迁移到此处
 *
 * 依赖的全局函数（由 original-script.js 提供）：
 *   - loadFileTree(path), refreshFileTree()
 *   - fileTreeData, fileTreeHierarchy
 */

window.App = window.App || {};
window.App.FileTree = {
  /**
   * 加载文件树
   */
  load(path) {
    if (typeof window.loadFileTree === 'function') {
      window.loadFileTree(path);
    }
  },

  /**
   * 刷新文件树
   */
  refresh() {
    if (typeof window.refreshFileTree === 'function') {
      window.refreshFileTree();
    }
  },

  /**
   * 搜索文件树
   */
  search(term) {
    if (typeof window.searchFileTree === 'function') {
      window.searchFileTree(term);
    }
  },

  /**
   * 获取文件树数据
   */
  getData() {
    return window.fileTreeData || [];
  },

  init() {
    console.log('[FileTree] Module ready');
  }
};
