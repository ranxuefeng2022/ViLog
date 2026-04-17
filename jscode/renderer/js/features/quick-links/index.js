/**
 * 快捷链接面板模块
 *
 * Phase 1: 包装层
 * Phase 2: 将 original-script.js 中快捷链接代码迁移到此处
 */

window.App = window.App || {};
window.App.QuickLinks = {
  /**
   * 切换面板显示
   */
  toggle() {
    if (typeof window.toggleQuickLinksPanel === 'function') {
      window.toggleQuickLinksPanel();
    }
  },

  /**
   * 添加快捷链接
   */
  add(name, path) {
    if (typeof window.addQuickLink === 'function') {
      window.addQuickLink(name, path);
    }
  },

  init() {
    console.log('[QuickLinks] Module ready');
  }
};
