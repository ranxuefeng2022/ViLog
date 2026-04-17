/**
 * 书签管理模块
 *
 * Phase 1: 包装层 — 定义清晰API，内部调用 original-script.js 的全局函数
 * Phase 2: 将 original-script.js 中书签相关代码迁移到此处
 *
 * 依赖的全局变量/函数（由 original-script.js 提供）：
 *   - toggleBookmark(lineIndex)
 *   - jumpToBookmark(index)
 *   - updateBookmarksPanel()
 *   - bookmarkedIndexSet (Set)
 *   - bookmarks (Array)
 */

window.App = window.App || {};
window.App.Bookmarks = {
  /**
   * 切换某行的书签状态
   */
  toggle(lineIndex) {
    if (typeof window.toggleBookmark === 'function') {
      window.toggleBookmark(lineIndex);
    }
  },

  /**
   * 跳转到指定书签
   */
  jumpTo(index) {
    if (typeof window.jumpToBookmark === 'function') {
      window.jumpToBookmark(index);
    }
  },

  /**
   * 获取所有书签
   */
  getAll() {
    return window.bookmarks || [];
  },

  /**
   * 获取书签索引集合
   */
  getIndexSet() {
    return window.bookmarkedIndexSet || new Set();
  },

  /**
   * 判断某行是否有书签
   */
  has(lineIndex) {
    return (window.bookmarkedIndexSet || new Set()).has(lineIndex);
  },

  /**
   * 刷新书签面板
   */
  refreshPanel() {
    if (typeof window.updateBookmarksPanel === 'function') {
      window.updateBookmarksPanel();
    }
  },

  /**
   * 初始化（预留）
   */
  init() {
    console.log('[Bookmarks] Module ready');
  }
};
