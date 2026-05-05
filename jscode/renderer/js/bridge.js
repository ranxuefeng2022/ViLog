/**
 * 桥接层 - 新模块与旧全局变量之间的双向同步
 *
 * 旧代码直接修改 window.xxx 全局变量，
 * 新模块通过 App.State 操作状态。
 * 桥接层确保两者保持同步。
 *
 * 当 original-script.js 完全模块化后，此文件可删除。
 */

window.App = window.App || {};

window.App.Bridge = (() => {
  'use strict';

  // Use the unified key list from App.State (single source of truth)
  const GLOBAL_KEYS = window.App.State.LEGACY_GLOBAL_KEYS;

  let syncTimer = null;
  let isActive = false;
  let _dirty = false;

  /**
   * 将 App.State 的值同步到全局变量
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
   * 将全局变量的值同步到 App.State（仅同步已变更的值）
   */
  function syncGlobalToState() {
    if (!window.App || !window.App.State) return;
    for (const key of GLOBAL_KEYS) {
      if (window[key] !== undefined) {
        const oldVal = window.App.State.get(key);
        if (oldVal !== window[key]) {
          window.App.State.set(key, window[key]);
        }
      }
    }
  }

  return {
    /**
     * 新模块修改状态后调用，触发立即同步到全局变量
     */
    notifyStateChanged() {
      _dirty = true;
      syncStateToGlobal();
    },

    /**
     * 启动双向同步
     */
    start() {
      if (isActive) return;
      isActive = true;

      syncGlobalToState();

      // 低频轮询兜底（2秒），捕获旧代码直接修改的全局变量
      syncTimer = setInterval(() => {
        syncGlobalToState();
      }, 2000);

      // 监听 EventBus 事件，按需触发快速同步
      if (window.App.EventBus) {
        window.App.EventBus.on('state:changed', () => {
          syncStateToGlobal();
        });
        window.App.EventBus.on('filter:applied', () => {
          syncGlobalToState();
          syncStateToGlobal();
        });
        window.App.EventBus.on('search:performed', () => {
          syncGlobalToState();
        });
        window.App.EventBus.on('file:loaded', () => {
          setTimeout(syncGlobalToState, 100);
        });
      }

      console.log('[Bridge] 双向同步已启动（事件驱动 + 2s 低频轮询兜底）');
    },

    stop() {
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
      isActive = false;
    },

    syncOnce() {
      syncGlobalToState();
      syncStateToGlobal();
    },

    isActive() {
      return isActive;
    }
  };
})();
