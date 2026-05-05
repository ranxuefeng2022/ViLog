/**
 * VivoLog 应用入口
 *
 * 架构分层：
 *   Layer 1: 核心基础设施（constants, event-bus, state, dom-cache, helpers）
 *   Layer 2: Worker管理器
 *   Layer 3: 功能模块
 *   Layer 4: 服务模块（模块化 API）
 *   Layer 5: 遗留代码（original-script.js 拆分 + patch）
 *   Layer 6: Bridge + 本入口
 */

window.App = window.App || {};

(function() {
  'use strict';

  console.log('=== VivoLog v3.0 ===');

  window.App.version = '3.0.0';

  // 公开 API
  window.App.API = {
    getState:     () => window.App.State,
    getUtils:     () => window.App.Utils,
    getConstants: () => window.App.Constants,
    getDOM:       () => window.App.DOM,
    getEventBus:  () => window.App.EventBus,
    version:      window.App.version,

    filter:       () => window.App.Filter,
    search:       () => window.App.Search,
    renderer:     () => window.App.LogRenderer,
    fileTree:     () => window.App.FileTree,
    loader:       () => window.App.LogLoader,
    ui:           () => window.App.UI,
    quickLinks:   () => window.App.QuickLinks,
    remoteShare:  () => window.App.RemoteShare,
    contextMenu:  () => window.App.ContextMenu,
    keywordHistory: () => window.App.FilterKeywordHistory,
  };

  async function initApp() {
    console.log('[App] Initializing...');

    // 0. 初始化 IndexedDB
    if (window.App.IDB && window.App.IDB.init) {
      try {
        await window.App.IDB.init();
        console.log('[App] IDB initialized');
      } catch (e) {
        console.warn('[App] IDB init failed:', e);
      }
    }

    // 1. 初始化过滤关键词历史（依赖 IDB）
    if (window.App.FilterKeywordHistory && window.App.FilterKeywordHistory.init) {
      try {
        await window.App.FilterKeywordHistory.init();
        console.log('[App] FilterKeywordHistory initialized');
      } catch (e) {
        console.warn('[App] FilterKeywordHistory init failed:', e);
      }
    }

    // 2. 初始化 DOM 缓存
    if (window.App.DOM && window.App.DOM.init) {
      window.App.DOM.init();
    }

    // 3. 初始化服务模块
    const modules = [
      'Filter', 'Search', 'LogRenderer', 'FileTree',
      'LogLoader', 'UI', 'ContextMenu', 'QuickLinks', 'RemoteShare'
    ];

    for (const name of modules) {
      if (window.App[name] && window.App[name].init) {
        try {
          window.App[name].init();
        } catch (e) {
          console.error(`[App] ${name} init failed:`, e);
        }
      }
    }

    // 4. 启动桥接层（延迟等待遗留代码初始化）
    if (window.App.Bridge && window.App.Bridge.start) {
      setTimeout(() => window.App.Bridge.start(), 200);
    }

    console.log(`[App] Ready (v${window.App.version})`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

  window.addEventListener('load', () => {
    setTimeout(() => {
      if (window.App.Bridge && window.App.Bridge.syncOnce) {
        window.App.Bridge.syncOnce();
      }
    }, 500);
  });

})();
