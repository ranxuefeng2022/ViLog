/**
 * 过滤系统模块
 *
 * 兼容层委托给全局函数，当 original-script.js 完全移除后删除。
 */

window.App = window.App || {};

window.App.Filter = (() => {
  'use strict';

  const currentFilter = {
    keywords: [],
    logLevels: [],
    startTime: null,
    endTime: null,
  };

  let filteredLines = [];
  let filteredToOriginalIndex = [];

  // ── 工具函数 ────────────────────────────────────────────
  function unescapeHtml(text) {
    const div = document.createElement('div');
    div.innerHTML = text;
    return div.textContent || div.innerText || '';
  }

  // ── 线性过滤 ──────────────────────────────────────────
  function linearFilter(filterOptions, lines) {
    const startTime = performance.now();
    const results = [];
    const { keywords, logLevels, startTime: startT, endTime: endT } = filterOptions;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let matches = true;

      if (keywords && keywords.length > 0) {
        const keywordMatches = keywords.some(keyword => {
          try {
            return new RegExp(keyword, 'i').test(line);
          } catch (e) {
            return line.toLowerCase().includes(keyword.toLowerCase());
          }
        });
        if (!keywordMatches) matches = false;
      }

      if (matches && logLevels && logLevels.length > 0) {
        const levelMatch = line.match(/\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL)\b/i);
        if (levelMatch) {
          if (!logLevels.includes(levelMatch[1].toUpperCase())) matches = false;
        } else {
          matches = false;
        }
      }

      if (matches && startT && endT) {
        const timeMatch = line.match(/\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})\b/);
        if (timeMatch) {
          if (timeMatch[1] < startT || timeMatch[1] > endT) matches = false;
        } else {
          matches = false;
        }
      }

      if (matches) results.push(i);
    }

    console.log(`[Filter] Linear: ${results.length} results in ${(performance.now() - startTime).toFixed(2)}ms`);
    return results;
  }

  // ── 公共 API ────────────────────────────────────────────
  return {
    init() {
      console.log('[Filter] Module ready');
      if (window.App.EventBus) window.App.EventBus.emit('filter:ready');
    },

    async applyFilter(filterOptions, lines = null) {
      const { keywords = [], logLevels = [], startTime: st = null, endTime: et = null } = filterOptions;
      Object.assign(currentFilter, { keywords, logLevels, startTime: st, endTime: et });

      if (lines) {
        const results = linearFilter(filterOptions, lines);
        filteredToOriginalIndex = results;
        filteredLines = results.map(i => lines[i]);
        if (window.App.EventBus) window.App.EventBus.emit('filter:applied', { results });
        return results;
      }
      return [];
    },

    getFilterStats() { return { total: filteredToOriginalIndex.length, ...currentFilter }; },

    clear() {
      Object.assign(currentFilter, { keywords: [], logLevels: [], startTime: null, endTime: null });
      filteredLines = [];
      filteredToOriginalIndex = [];
    },

    // === 兼容旧 API（委托给全局函数，original-script.js 移除后删除） ===
    apply(keyword) {
      if (keyword !== undefined && window.filterBox) window.filterBox.value = keyword;
      if (typeof window.applyFilter === 'function') window.applyFilter();
    },
    reset() { if (typeof window.resetFilter === 'function') window.resetFilter(); },
    applySecondary(keyword) { if (typeof window.applySecondaryFilter === 'function') window.applySecondaryFilter(keyword); },
    resetSecondary() { if (typeof window.resetSecondaryFilter === 'function') window.resetSecondaryFilter(); },
    getState() {
      return {
        primary: window.currentFilter || {},
        secondary: window.secondaryFilter || {},
        isFiltering: !!window.isFiltering,
        totalLines: (window.filteredPanelAllLines || []).length,
      };
    },
    addToHistory(keyword) { if (typeof window.addToFilterHistory === 'function') window.addToFilterHistory(keyword); },
  };
})();
