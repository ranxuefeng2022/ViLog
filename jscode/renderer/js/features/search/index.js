/**
 * 搜索系统模块
 *
 * Phase 1: 包装层 — 定义清晰API，内部调用 original-script.js 的全局函数
 * Phase 2: 将 original-script.js 中搜索代码迁移到此处
 *
 * 依赖的全局变量/函数（由 original-script.js 提供）：
 *   - searchKeyword, searchMatches, currentMatchIndex, totalMatchCount
 *   - performSearch(), findPrev(), findNext(), resetSearch()
 */

window.App = window.App || {};
window.App.Search = {
  /**
   * 执行搜索
   */
  perform(keyword) {
    if (typeof window.performSearch === 'function') {
      window.performSearch(keyword);
    }
  },

  /**
   * 上一个匹配
   */
  prev() {
    if (typeof window.findPrev === 'function') {
      window.findPrev();
    }
  },

  /**
   * 下一个匹配
   */
  next() {
    if (typeof window.findNext === 'function') {
      window.findNext();
    }
  },

  /**
   * 重置搜索
   */
  reset() {
    if (typeof window.resetSearch === 'function') {
      window.resetSearch();
    }
  },

  /**
   * 获取当前搜索状态
   */
  getState() {
    return {
      keyword: window.searchKeyword || '',
      matches: window.searchMatches || [],
      currentIndex: window.currentMatchIndex || -1,
      totalCount: window.totalMatchCount || 0,
    };
  },

  init() {
    console.log('[Search] Module ready');
  }
};
