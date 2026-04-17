/**
 * 日志加载模块
 *
 * Phase 1: 包装层
 * Phase 2: 将 original-script.js 中加载代码迁移到此处
 *
 * 依赖的全局函数（由 original-script.js 提供）：
 *   - loadFiles(files), loadFileFromPath(path)
 *   - loadArchive(path), extractAndLoadArchive(path)
 */

window.App = window.App || {};
window.App.LogLoader = {
  /**
   * 从 File 对象数组加载
   */
  loadFiles(files) {
    if (typeof window.handleFileDrop === 'function') {
      window.handleFileDrop(files);
    }
  },

  /**
   * 从路径加载
   */
  loadPath(filePath) {
    if (typeof window.loadFileFromPath === 'function') {
      window.loadFileFromPath(filePath);
    }
  },

  /**
   * 获取当前加载的文件信息
   */
  getCurrentFiles() {
    return window.currentFiles || [];
  },

  /**
   * 获取原始行数据
   */
  getOriginalLines() {
    return window.originalLines || [];
  },

  init() {
    console.log('[LogLoader] Module ready');
  }
};
