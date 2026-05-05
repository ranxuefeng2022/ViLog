/**
 * 过滤系统模块
 *
 * 集成了索引加速过滤 + 原有全局函数的兼容层。
 * 当 original-script.js 完全移除后，兼容层方法将被删除。
 */

window.App = window.App || {};

window.App.Filter = (() => {
  'use strict';

  // ── 索引器 ──────────────────────────────────────────────
  let indexer = null;
  let useIndex = true;

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

  function _setUnion(sets) {
    const union = new Set();
    for (const set of sets) {
      for (const item of set) union.add(item);
    }
    return union;
  }

  // ── 线性过滤（降级方案）─────────────────────────────────
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

  // ── 回调 ────────────────────────────────────────────────
  function onIndexProgress(data) {
    window.dispatchEvent(new CustomEvent('filterIndexProgress', { detail: data }));
  }

  function onIndexComplete(data) {
    console.log(`[Filter] Index built: ${data.totalLines} lines in ${data.buildTime.toFixed(2)}ms`);
    window.dispatchEvent(new CustomEvent('filterIndexComplete', { detail: data }));
  }

  // ── 公共 API ────────────────────────────────────────────
  return {
    // === 索引相关 ===
    init() {
      if (window.LogIndexer) {
        indexer = new LogIndexer({
          batchSize: 10000, batchDelay: 5, maxCacheLines: 50000,
          enablePersistence: true, storagePrefix: 'logFilter_',
        });
        indexer.on('progress', onIndexProgress);
        indexer.on('complete', onIndexComplete);
        indexer.on('error', (e) => console.error('[Filter] Index error:', e));
        indexer.loadIndex().then(loaded => {
          if (loaded) console.log('[Filter] Index loaded from storage');
        });
      }
      console.log('[Filter] Module ready');
      if (window.App.EventBus) window.App.EventBus.emit('filter:ready');
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
      indexer.buildIndex(lines).catch(e => console.error('[Filter] Build failed:', e));
    },

    async applyFilter(filterOptions, lines = null) {
      const startTime = performance.now();
      const { keywords = [], logLevels = [], startTime: st = null, endTime: et = null } = filterOptions;
      Object.assign(currentFilter, { keywords, logLevels, startTime: st, endTime: et });

      if (indexer && useIndex) {
        try {
          const conditions = {};
          if (keywords.length > 0) conditions.keyword = keywords.join('|');
          if (logLevels.length > 0) conditions.level = logLevels[0];
          if (st && et) { conditions.startTime = st; conditions.endTime = et; }

          let results = await indexer.combineFilters(conditions);
          if (logLevels.length > 1) {
            const levelSets = logLevels.map(l => new Set(indexer.filterByLevel(l)));
            results = results.filter(line => _setUnion(levelSets).has(line));
          }

          filteredToOriginalIndex = results;
          filteredLines = results.map(i => lines ? lines[i] : `Line ${i}`);
          console.log(`[Filter] Indexed: ${results.length} results in ${(performance.now() - startTime).toFixed(2)}ms`);
          if (window.App.EventBus) window.App.EventBus.emit('filter:applied', { results });
          return results;
        } catch (e) {
          console.warn('[Filter] Indexed filter failed, falling back:', e);
        }
      }

      if (lines) {
        const results = linearFilter(filterOptions, lines);
        filteredToOriginalIndex = results;
        filteredLines = results.map(i => lines[i]);
        if (window.App.EventBus) window.App.EventBus.emit('filter:applied', { results });
        return results;
      }
      return [];
    },

    filterByLevel(level) { return indexer ? indexer.filterByLevel(level) : []; },
    filterByTimeRange(start, end) { return indexer ? indexer.filterByTimeRange(start, end) : []; },
    getFilterStats() { return { total: filteredToOriginalIndex.length, ...currentFilter }; },

    clear() {
      Object.assign(currentFilter, { keywords: [], logLevels: [], startTime: null, endTime: null });
      filteredLines = [];
      filteredToOriginalIndex = [];
    },

    toggleIndex() { useIndex = !useIndex; return useIndex; },
    getIndexStats() { return indexer ? indexer.getStats() : null; },
    clearIndex() { if (indexer) indexer.clear(); },

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
