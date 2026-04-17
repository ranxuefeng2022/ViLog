/**
 * 桥接层 - 新模块与旧全局变量之间的双向同步
 *
 * 问题：original-script.js 使用 window.xxx 全局变量，
 *       新模块使用 App.State.get/set()。
 *       两者需要保持同步。
 *
 * 解决：bridge.js 在 original-script.js 加载后，
 *       将全局变量同步到 App.State，
 *       并定期反向同步以捕获旧代码的直接修改。
 *
 * 当 original-script.js 完全被模块化替代后，此文件可删除。
 */

window.App = window.App || {};

window.App.Bridge = (() => {
  'use strict';

  // 需要同步的全局变量列表
  const GLOBAL_KEYS = [
    'originalLines',
    'currentFiles',
    'fileHeaders',
    'filterBox',
    'outer',
    'inner',
    'isFiltering',
    'isFullscreen',
    'searchKeyword',
    'searchMatches',
    'currentMatchIndex',
    'totalMatchCount',
    'selectedOriginalIndex',
    'lastClickedOriginalIndex',
    'lastClickedFilteredIndex',
    'currentFilter',
    'secondaryFilter',
    'bookmarkedIndexSet',
    'filteredPanelAllLines',
    'filteredPanelAllOriginalIndices',
    'filteredPanelAllPrimaryIndices',
    'filteredPanelVisibleStart',
    'filteredPanelVisibleEnd',
    'filteredPanelScrollPosition',
    'customHighlights',
  ];

  let syncTimer = null;
  let isActive = false;

  /**
   * 将 App.State 的值同步到全局变量
   * （新模块修改 state → 旧代码能读到）
   */
  function syncStateToGlobal() {
    if (!window.App || !window.App.State) return;
    for (const key of GLOBAL_KEYS) {
      const val = window.App.State.get(key);
      if (val !== undefined) {
        window[key] = val;
      }
    }
  }

  /**
   * 将全局变量的值同步到 App.State
   * （旧代码修改 window.xxx → 新模块能读到）
   */
  function syncGlobalToState() {
    if (!window.App || !window.App.State) return;
    for (const key of GLOBAL_KEYS) {
      if (window[key] !== undefined) {
        window.App.State.set(key, window[key]);
      }
    }
  }

  return {
    /**
     * 启动双向同步（在 original-script.js 加载完成后调用）
     */
    start() {
      if (isActive) return;
      isActive = true;

      // 立即同步一次（把旧代码已初始化的全局变量拉到 State）
      syncGlobalToState();

      // 定期同步（捕获旧代码的动态修改）
      syncTimer = setInterval(() => {
        syncGlobalToState();
      }, 500);

      console.log('[Bridge] 双向同步已启动');
    },

    /**
     * 停止同步
     */
    stop() {
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
      isActive = false;
      console.log('[Bridge] 同步已停止');
    },

    /**
     * 手动触发一次性同步
     */
    syncOnce() {
      syncGlobalToState();
      syncStateToGlobal();
    },

    /**
     * 检查同步状态
     */
    isActive() {
      return isActive;
    }
  };
})();
