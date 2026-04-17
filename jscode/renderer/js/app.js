/**
 * VivoLog 应用入口（重构版）
 *
 * 替代旧的 renderer/js/main.js
 * 不再使用 document.write()，改为在 index.html 中按顺序加载脚本
 *
 * 架构分层：
 *   Layer 0: 独立模块（日志拦截器、错误处理）— 自执行，无需初始化
 *   Layer 1: 核心基础设施（constants, event-bus, state, dom-cache, helpers）
 *   Layer 2: Worker管理器、外部工具集成
 *   Layer 3: 功能模块包装层（bookmarks, filter, search, etc.）
 *   Layer 4: 遗留代码（original-script.js）
 *   Layer 5: Patch文件（覆盖遗留代码的函数）
 *   Layer 6: Bridge（同步新旧状态）+ 本文件（初始化）
 */

window.App = window.App || {};

(function() {
  'use strict';

  console.log('=== VivoLog Modular Version ===');

  // 版本信息
  window.App.version = '2.0.0-modular';

  // 公开 API
  window.App.API = {
    getState:     () => window.App.State,
    getUtils:     () => window.App.Utils,
    getConstants: () => window.App.Constants,
    getDOM:       () => window.App.DOM,
    getEventBus:  () => window.App.EventBus,
    version:      window.App.version,

    // 功能模块快捷访问
    bookmarks:    () => window.App.Bookmarks,
    contextMenu:  () => window.App.ContextMenu,
    search:       () => window.App.Search,
    filter:       () => window.App.Filter,
    renderer:     () => window.App.LogRenderer,
    fileTree:     () => window.App.FileTree,
    loader:       () => window.App.LogLoader,
    ui:           () => window.App.UI,
    quickLinks:   () => window.App.QuickLinks,
    remoteShare:  () => window.App.RemoteShare,
  };

  /**
   * 应用初始化（在所有脚本加载完成后执行）
   */
  function initApp() {
    console.log('[App] Initializing modules...');

    // 1. 初始化 DOM 缓存
    if (window.App.DOM && window.App.DOM.init) {
      window.App.DOM.init();
    }

    // 2. 初始化功能模块（Phase 1 中这些只是打印日志，Phase 2 会做真正的事）
    const modules = [
      'Bookmarks', 'ContextMenu', 'Search', 'Filter',
      'LogRenderer', 'FileTree', 'LogLoader', 'UI',
      'QuickLinks', 'RemoteShare'
    ];

    for (const name of modules) {
      if (window.App[name] && window.App[name].init) {
        try {
          window.App[name].init();
        } catch (e) {
          console.error(`[App] Module ${name} init failed:`, e);
        }
      }
    }

    // 3. 启动桥接层同步
    if (window.App.Bridge && window.App.Bridge.start) {
      // 延迟启动，等待 original-script.js 完成初始化
      setTimeout(() => {
        window.App.Bridge.start();
      }, 200);
    }

    console.log('[App] All modules initialized');
    console.log(`[App] Version: ${window.App.version}`);
  }

  // DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    // DOMContentLoaded 已触发（脚本在 body 末尾加载时）
    initApp();
  }

  // 窗口加载完成后做额外同步
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (window.App.Bridge && window.App.Bridge.syncOnce) {
        window.App.Bridge.syncOnce();
      }
    }, 500);
  });

})();
