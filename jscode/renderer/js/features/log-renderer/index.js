/**
 * 日志渲染模块
 *
 * Phase 1: 包装层 — 定义清晰API
 * Phase 2: 合并 virtual-scroll-patch.js 和 canvas-log-renderer-patch.js
 *
 * 依赖的全局函数（由 original-script.js + patch 文件提供）：
 *   - renderLogLines(), updateVisibleLines()
 *   - jumpToLine(), jumpToOriginalLine()
 */

window.App = window.App || {};
window.App.LogRenderer = {
  /**
   * 刷新渲染
   */
  refresh() {
    if (typeof window.renderLogLines === 'function') {
      window.renderLogLines();
    }
  },

  /**
   * 更新可见行
   */
  updateVisible() {
    if (typeof window.updateVisibleLines === 'function') {
      window.updateVisibleLines();
    }
  },

  /**
   * 跳转到指定行
   */
  jumpToLine(lineIndex) {
    if (typeof window.jumpToLine === 'function') {
      window.jumpToLine(lineIndex);
    }
  },

  /**
   * 跳转到原始行号
   */
  jumpToOriginal(lineIndex) {
    if (typeof window.jumpToOriginalLine === 'function') {
      window.jumpToOriginalLine(lineIndex);
    }
  },

  /**
   * 获取/设置渲染模式
   */
  getMode() {
    if (typeof window.getRenderMode === 'function') {
      return window.getRenderMode();
    }
    return 'dom';
  },

  toggleMode() {
    if (typeof window.toggleRenderMode === 'function') {
      window.toggleRenderMode();
    }
  },

  init() {
    console.log('[LogRenderer] Module ready');
  }
};
