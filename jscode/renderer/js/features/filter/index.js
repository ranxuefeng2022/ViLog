/**
 * 过滤系统模块
 *
 * Phase 1: 包装层 — 定义清晰API，内部调用全局函数
 * Phase 2: 合并 filter-worker-patch.js 和 ripgrep-filter-patch.js 到此处
 *
 * 依赖的全局变量/函数（由 original-script.js + patch 文件提供）：
 *   - applyFilter(), resetFilter()
 *   - currentFilter, secondaryFilter
 *   - filteredPanelAllLines, filteredPanelAllOriginalIndices
 */

window.App = window.App || {};
window.App.Filter = {
  /**
   * 执行过滤
   */
  apply(keyword) {
    if (keyword !== undefined && window.filterBox) {
      window.filterBox.value = keyword;
    }
    if (typeof window.applyFilter === 'function') {
      window.applyFilter();
    }
  },

  /**
   * 重置过滤
   */
  reset() {
    if (typeof window.resetFilter === 'function') {
      window.resetFilter();
    }
  },

  /**
   * 执行二级过滤
   */
  applySecondary(keyword) {
    if (typeof window.applySecondaryFilter === 'function') {
      window.applySecondaryFilter(keyword);
    }
  },

  /**
   * 重置二级过滤
   */
  resetSecondary() {
    if (typeof window.resetSecondaryFilter === 'function') {
      window.resetSecondaryFilter();
    }
  },

  /**
   * 获取当前过滤状态
   */
  getState() {
    return {
      primary: window.currentFilter || {},
      secondary: window.secondaryFilter || {},
      isFiltering: !!window.isFiltering,
      totalLines: (window.filteredPanelAllLines || []).length,
    };
  },

  /**
   * 添加到过滤历史
   */
  addToHistory(keyword) {
    if (typeof window.addToFilterHistory === 'function') {
      window.addToFilterHistory(keyword);
    }
  },

  init() {
    console.log('[Filter] Module ready');
  }
};
