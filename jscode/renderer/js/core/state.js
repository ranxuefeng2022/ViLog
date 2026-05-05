/**
 * 状态管理模块（重构版）
 *
 * 集中管理应用状态，通过 getter/setter 访问，
 * 变更时自动通过 EventBus 发出通知。
 *
 * 同时将状态同步到全局变量（window.xxx），
 * 确保 original-script.js 中的旧代码不受影响。
 *
 * 用法：
 *   App.State.get('originalLines')
 *   App.State.set('originalLines', [...])
 *   App.State.on('originalLines', (newVal, oldVal) => { ... })
 */

window.App = window.App || {};

window.App.State = (() => {
  'use strict';

  // Unified legacy global variable keys — single source of truth
  // Used by bridge.js for bidirectional sync and by syncFromGlobal() below
  const LEGACY_GLOBAL_KEYS = [
    'originalLines', 'currentFiles', 'fileHeaders',
    'isFiltering', 'isFullscreen',
    'searchKeyword', 'searchMatches', 'currentMatchIndex', 'totalMatchCount',
    'searchResults', 'currentSearchIndex',
    'selectedOriginalIndex', 'selectedLineIndex',
    'lastClickedOriginalIndex', 'lastClickedFilteredIndex',
    'currentFilter', 'secondaryFilter',
    'bookmarkedIndexSet',
    'filteredPanelAllLines', 'filteredPanelAllOriginalIndices',
    'filteredPanelAllPrimaryIndices',
    'filteredPanelVisibleStart', 'filteredPanelVisibleEnd',
    'filteredPanelScrollPosition',
    'customHighlights',
  ];

  // 内部状态存储
  const _state = {
    // === 日志数据 ===
    originalLines: [],
    currentFiles: [],
    fileHeaders: [],

    // === 当前显示 ===
    visibleLines: [],
    visibleStart: 0,
    visibleEnd: 0,

    // === 搜索状态 ===
    currentSearchIndex: -1,
    searchResults: [],
    searchKeyword: '',
    totalMatchCount: 0,

    // === 过滤状态 ===
    currentFilter: {
      filteredLines: [],
      filteredToOriginalIndex: [],
      filterKeywords: [],
      totalLines: 0,
    },

    // === 二级过滤状态 ===
    secondaryFilter: {
      isActive: false,
      filterText: '',
      filterKeywords: [],
      filteredLines: [],
      filteredToOriginalIndex: [],
      filteredToPrimaryIndex: [],
    },

    // === UI 状态 ===
    isFullscreen: false,
    isFiltering: false,
    isFirstFilter: true,
    isFilterPanelMaximized: false,
    isAiAssistantPanelMaximized: false,
    wasFilterPanelVisibleBeforeFocus: false,
    selectedLineIndex: -1,

    // === 文件树状态 ===
    fileTreeData: [],
    fileTreeHierarchy: [],
    fileTreeAllVisibleIndices: [],
    visibleFileTreeItems: [],
    visibleFileTreeItemsSet: new Set(),
    fileTreeSearchTerm: '',

    // === 书签状态 ===
    bookmarkedIndexSet: new Set(),
    bookmarks: [],

    // === 其他 ===
    currentFile: null,
    customHighlights: [],
    focusOnFilteredPanel: false,
    focusOnMainLog: false,
    filteredPanelScrollPosition: 0,
    lastClickedOriginalIndex: -1,
    lastClickedFilteredIndex: -1,

    // === 虚拟滚动状态 ===
    filteredPanelAllLines: [],
    filteredPanelAllOriginalIndices: [],
    filteredPanelAllPrimaryIndices: [],
    filteredPanelVisibleStart: 0,
    filteredPanelVisibleEnd: 0,

    // === 面板状态 ===
    filteredPanelState: {
      isMaximized: false,
      position: null,
    },
    aiAssistantPanelState: {
      isMaximized: false,
      position: null,
    },
  };

  // 状态变更监听器（轻量级，不需要完整EventBus）
  const _watchers = {};

  return {
    /**
     * 获取状态值
     * @param {string} key
     * @returns {*}
     */
    get(key) {
      return _state[key];
    },

    /**
     * 设置状态值，同时同步到全局变量
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
      const old = _state[key];
      _state[key] = value;

      // 同步到全局变量（桥接旧代码）
      if (typeof window !== 'undefined') {
        window[key] = value;
      }

      // 通知 watcher
      if (_watchers[key]) {
        for (const cb of _watchers[key]) {
          try { cb(value, old); } catch (e) { console.error(`[State] watcher error on "${key}":`, e); }
        }
      }

      // 通知 EventBus
      if (window.App && window.App.EventBus && old !== value) {
        window.App.EventBus.emit('state:changed:' + key, { key, old, value });
      }
    },

    /**
     * 监听某个状态的变化
     * @param {string} key
     * @param {Function} callback (newValue, oldValue)
     * @returns {Function} 取消监听函数
     */
    on(key, callback) {
      if (!_watchers[key]) _watchers[key] = [];
      _watchers[key].push(callback);
      return () => {
        _watchers[key] = _watchers[key].filter(cb => cb !== callback);
      };
    },

    /**
     * 获取所有状态的快照（只读拷贝）
     */
    getAll() {
      const snapshot = {};
      for (const key of Object.keys(_state)) {
        const val = _state[key];
        if (val instanceof Set) {
          snapshot[key] = new Set(val);
        } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          snapshot[key] = Object.assign({}, val);
        } else {
          snapshot[key] = val;
        }
      }
      return snapshot;
    },

    /**
     * 批量设置状态（不触发多次通知）
     */
    batchSet(updates) {
      const changedKeys = [];
      for (const [key, value] of Object.entries(updates)) {
        const old = _state[key];
        _state[key] = value;
        if (typeof window !== 'undefined') {
          window[key] = value;
        }
        if (old !== value) changedKeys.push(key);
      }
      // 统一通知一次
      if (window.App && window.App.EventBus && changedKeys.length > 0) {
        window.App.EventBus.emit('state:batchChanged', { keys: changedKeys, updates });
      }
    },

    /**
     * 从全局变量同步回状态（旧代码可能直接修改了 window.xxx）
     */
    syncFromGlobal() {
      for (const key of LEGACY_GLOBAL_KEYS) {
        if (window[key] !== undefined) {
          _state[key] = window[key];
        }
      }
    },

    LEGACY_GLOBAL_KEYS
  };
})();
