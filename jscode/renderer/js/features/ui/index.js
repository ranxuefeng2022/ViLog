/**
 * UI组件模块（标题栏、工具栏、快捷键、字体缩放等）
 *
 * Phase 1: 包装层
 * Phase 2: 将 original-script.js 中UI代码迁移到此处
 */

window.App = window.App || {};
window.App.UI = {
  /**
   * 显示消息提示
   */
  showMessage(msg, duration) {
    if (typeof window.showMessage === 'function') {
      window.showMessage(msg, duration);
    }
  },

  /**
   * 显示/隐藏进度条
   */
  showProgress(percent) {
    if (typeof window.showProgressBar === 'function') {
      window.showProgressBar(percent);
    }
  },

  hideProgress() {
    if (typeof window.hideProgressBar === 'function') {
      window.hideProgressBar();
    }
  },

  /**
   * 更新布局
   */
  updateLayout() {
    if (typeof window.updateLayout === 'function') {
      window.updateLayout();
    }
  },

  /**
   * 切换全屏
   */
  toggleFullscreen() {
    if (typeof window.toggleFullscreen === 'function') {
      window.toggleFullscreen();
    }
  },

  /**
   * 字体缩放
   */
  zoomIn() {
    if (typeof window.increaseFontSize === 'function') {
      window.increaseFontSize();
    }
  },

  zoomOut() {
    if (typeof window.decreaseFontSize === 'function') {
      window.decreaseFontSize();
    }
  },

  /**
   * 自定义高亮
   */
  addHighlight(keyword, color) {
    if (typeof window.highlightText === 'function') {
      window.highlightText(keyword, color);
    }
  },

  clearHighlights() {
    if (typeof window.clearHighlights === 'function') {
      window.clearHighlights();
    }
  },

  init() {
    console.log('[UI] Module ready');
  }
};
