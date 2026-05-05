/**
 * 搜索系统模块
 *
 * 集成了索引加速搜索 + 原有全局函数的兼容层。
 * 当 original-script.js 完全移除后，兼容层方法将被删除。
 */

window.App = window.App || {};

window.App.Search = (() => {
  'use strict';

  // ── 索引器 ──────────────────────────────────────────────
  let indexer = null;
  let useIndex = true;

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

  // ── 回调 ────────────────────────────────────────────────
  function onIndexProgress(data) {
    window.dispatchEvent(new CustomEvent('searchIndexProgress', { detail: data }));
  }
  function onIndexComplete(data) {
    console.log(`[Search] Index built: ${data.totalLines} lines in ${data.buildTime.toFixed(2)}ms`);
    window.dispatchEvent(new CustomEvent('searchIndexComplete', { detail: data }));
  }

  // ── 公共 API ────────────────────────────────────────────
  return {
    // === 索引相关 ===
    init() {
      if (window.LogIndexer) {
        indexer = new LogIndexer({
          batchSize: 10000, batchDelay: 5, maxCacheLines: 50000,
          enablePersistence: true, storagePrefix: 'logSearch_',
        });
        indexer.on('progress', onIndexProgress);
        indexer.on('complete', onIndexComplete);
        indexer.on('error', (e) => console.error('[Search] Index error:', e));
        indexer.loadIndex().then(loaded => {
          if (loaded) console.log('[Search] Index loaded from storage');
        });
      }
      console.log('[Search] Module ready');
      if (window.App.EventBus) window.App.EventBus.emit('search:ready');
    },

    buildIndex(lines, forceRebuild = false) {
      if (!indexer || !useIndex) return;
      if (!forceRebuild && indexer.state.indexedLines > 0) {
        const start = indexer.state.totalLines;
        if (start < lines.length) {
          indexer.appendLines(lines.slice(start), start);
          return;
        }
      }
      indexer.buildIndex(lines).catch(e => console.error('[Search] Build failed:', e));
    },

    async search(keyword, lines = null) {
      if (!keyword || keyword.trim() === '') {
        searchResults = []; currentKeyword = ''; currentMatchIndex = -1;
        return [];
      }
      currentKeyword = keyword;

      if (indexer && useIndex) {
        try {
          const results = await indexer.search(keyword);
          searchResults = results;
          currentMatchIndex = results.length > 0 ? 0 : -1;
          if (window.App.EventBus) window.App.EventBus.emit('search:performed', { keyword, results });
          return results;
        } catch (e) {
          console.warn('[Search] Indexed search failed, falling back:', e);
        }
      }
      if (lines) return linearSearch(keyword, lines);
      return [];
    },

    nextMatch() {
      if (searchResults.length === 0) return -1;
      currentMatchIndex = (currentMatchIndex + 1) % searchResults.length;
      return searchResults[currentMatchIndex];
    },
    prevMatch() {
      if (searchResults.length === 0) return -1;
      currentMatchIndex = (currentMatchIndex - 1 + searchResults.length) % searchResults.length;
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
    toggleIndex() { useIndex = !useIndex; return useIndex; },
    getIndexStats() { return indexer ? indexer.getStats() : null; },
    clearIndex() { if (indexer) indexer.clear(); },

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
