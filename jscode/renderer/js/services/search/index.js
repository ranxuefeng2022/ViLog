/**
 * 搜索系统模块
 *
 * 兼容层委托给全局函数，当 original-script.js 完全移除后删除。
 */

window.App = window.App || {};

window.App.Search = (() => {
  'use strict';

  let currentKeyword = '';
  let searchResults = [];
  let currentMatchIndex = -1;

  // ── 工具函数 ────────────────────────────────────────────
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── 线性搜索（降级方案）─────────────────────────────────
  function linearSearch(keyword, lines) {
    const startTime = performance.now();
    const results = [];
    try {
      let regex;
      try {
        const parts = keyword.split('|');
        regex = new RegExp(parts.map(p => escapeRegExp(p)).join('|'), 'gi');
      } catch (e) {
        regex = new RegExp(escapeRegExp(keyword), 'gi');
      }
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) results.push(i);
      }
    } catch (e) {
      console.error('[Search] Linear search error:', e);
    }
    searchResults = results;
    currentMatchIndex = results.length > 0 ? 0 : -1;
    console.log(`[Search] Linear: "${keyword}" found ${results.length} in ${(performance.now() - startTime).toFixed(2)}ms`);
    return results;
  }

  // ── 公共 API ────────────────────────────────────────────
  return {
    init() {
      console.log('[Search] Module ready');
      if (window.App.EventBus) window.App.EventBus.emit('search:ready');
    },

    async search(keyword, lines = null) {
      if (!keyword || keyword.trim() === '') {
        searchResults = []; currentKeyword = ''; currentMatchIndex = -1;
        return [];
      }
      currentKeyword = keyword;

      if (lines) return linearSearch(keyword, lines);
      return [];
    },

    nextMatch() {
      if (searchResults.length === 0) return -1;
      if (currentMatchIndex < searchResults.length - 1) currentMatchIndex++;
      return searchResults[currentMatchIndex];
    },
    prevMatch() {
      if (searchResults.length === 0) return -1;
      if (currentMatchIndex > 0) currentMatchIndex--;
      return searchResults[currentMatchIndex];
    },
    jumpToMatch(idx) {
      if (idx < 0 || idx >= searchResults.length) return -1;
      currentMatchIndex = idx;
      return searchResults[idx];
    },
    getCurrentMatch() {
      if (searchResults.length === 0 || currentMatchIndex < 0) return null;
      return { index: currentMatchIndex, total: searchResults.length, lineNumber: searchResults[currentMatchIndex] };
    },
    clear() { currentKeyword = ''; searchResults = []; currentMatchIndex = -1; },

    // === 兼容旧 API（委托给全局函数） ===
    perform(keyword) { if (typeof window.performSearch === 'function') window.performSearch(keyword); },
    prev() { if (typeof window.findPrev === 'function') window.findPrev(); },
    next() { if (typeof window.findNext === 'function') window.findNext(); },
    reset() { if (typeof window.resetSearch === 'function') window.resetSearch(); },
    getState() {
      return {
        keyword: window.searchKeyword || '',
        matches: window.searchMatches || [],
        currentIndex: window.currentMatchIndex || -1,
        totalCount: window.totalMatchCount || 0,
      };
    },
  };
})();
