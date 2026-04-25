/**
 * 关键词持久化存储模块
 * 通过 IPC 将关键词保存到 app/mem/filter-keywords.json 文件
 * 同时备份到 localStorage 作为降级
 */

(function() {
  'use strict';

  var STORAGE_KEY = 'logViewerFilterKeywords';
  var ready = false;

  function init() {
    ready = !!(window.electronAPI && window.electronAPI.readKeywordFile);
    console.log('[KeywordStorage] 初始化完成, IPC 可用:', ready);
    return Promise.resolve();
  }

  /**
   * 从文件读取关键词（IPC 优先，localStorage 降级）
   * 兼容旧代码中 getFilters() 的调用方式
   */
  function getFilters() {
    // 优先用 IPC 读文件
    if (ready && window.electronAPI && window.electronAPI.readKeywordFile) {
      return window.electronAPI.readKeywordFile().then(function(result) {
        if (result.success && result.data && result.data.keywords) {
          console.log('[KeywordStorage] 从文件加载关键词:', result.data.keywords.length);
          var obj = {};
          obj[STORAGE_KEY] = result.data;
          return obj;
        }
        // 文件无数据，降级读 localStorage
        return readFromLocalStorage();
      }).catch(function() {
        return readFromLocalStorage();
      });
    }
    return Promise.resolve(readFromLocalStorage());
  }

  function readFromLocalStorage() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        var obj = {};
        obj[STORAGE_KEY] = { keywords: Array.isArray(parsed) ? parsed : [], timestamp: Date.now() };
        return obj;
      }
    } catch (e) {}
    return {};
  }

  /**
   * 保存关键词到文件（IPC）+ localStorage（备份）
   * 兼容旧代码中 saveFilter(key, value) 的调用方式
   */
  function saveFilter(key, value) {
    // 备份到 localStorage
    try {
      if (value && value.keywords) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value.keywords));
      }
    } catch (e) {}

    // 写入文件
    if (ready && window.electronAPI && window.electronAPI.writeKeywordFile) {
      return window.electronAPI.writeKeywordFile(value).then(function(result) {
        if (!result.success) {
          console.warn('[KeywordStorage] 写入文件失败:', result.error);
        }
      }).catch(function(e) {
        console.warn('[KeywordStorage] 写入文件异常:', e);
      });
    }
    return Promise.resolve();
  }

  function isReady() { return ready; }

  window.App = window.App || {};
  window.App.IDB = {
    init: init,
    getFilters: getFilters,
    saveFilter: saveFilter,
    isReady: isReady
  };

  console.log('[KeywordStorage] 模块已加载');
})();
