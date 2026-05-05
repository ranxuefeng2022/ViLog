/**
 * 常量定义模块
 * 包含所有常量、配置和默认值
 */

(function() {
  'use strict';

  // 生产模式日志控制：localStorage 设置 debugMode=true 启用详细日志
  var isDebug = (function() {
    try { return localStorage.getItem('debugMode') === 'true'; } catch (e) { return false; }
  })();

  if (!isDebug) {
    var noop = function() {};
    // 生产模式下禁用 log 和 debug，保留 warn/error 用于问题排查
    var _orig = { log: console.log, debug: console.debug, info: console.info };
    console.log = noop;
    console.debug = noop;
    // info 在原始代码中使用较少，按采样保留
    var infoCount = 0;
    console.info = function() {
      infoCount++;
      if (infoCount % 50 === 0) _orig.info.apply(console, arguments);
    };
    // 暴露临时开启调试的方法
    window.enableDebugLog = function() {
      console.log = _orig.log;
      console.debug = _orig.debug;
      console.info = _orig.info;
      try { localStorage.setItem('debugMode', 'true'); } catch (e) {}
      console.log('[Debug] 详细日志已启用');
    };
  }

window.App = window.App || {};
window.App.Constants = {
  // 默认高亮规则
  defaultHighlights: [
    // { keyword: 'battery', color: '#ff0000' },
    // { keyword: 'charge', color: '#00ff00' }
  ],

  // 过滤关键词高亮颜色类名
  filterHighlightClasses: [
    "filter-highlight-0",
    "filter-highlight-1",
    "filter-highlight-2",
    "filter-highlight-3",
    "filter-highlight-4",
    "filter-highlight-5",
    "filter-highlight-6",
    "filter-highlight-7",
    "filter-highlight-8",
    "filter-highlight-9",
    "filter-highlight-10",
    "filter-highlight-11",
    "filter-highlight-12",
    "filter-highlight-13",
    "filter-highlight-14",
    "filter-highlight-15",
    "filter-highlight-16",
    "filter-highlight-17",
    "filter-highlight-18",
    "filter-highlight-19",
  ],

  // 二级过滤关键词高亮颜色类名
  secondaryFilterHighlightClasses: [
    "secondary-filter-highlight-0",
    "secondary-filter-highlight-1",
    "secondary-filter-highlight-2",
    "secondary-filter-highlight-3",
    "secondary-filter-highlight-4",
    "secondary-filter-highlight-5",
    "secondary-filter-highlight-6",
    "secondary-filter-highlight-7",
    "secondary-filter-highlight-8",
    "secondary-filter-highlight-9",
    "secondary-filter-highlight-10",
    "secondary-filter-highlight-11",
    "secondary-filter-highlight-12",
    "secondary-filter-highlight-13",
    "secondary-filter-highlight-14",
    "secondary-filter-highlight-15",
    "secondary-filter-highlight-16",
    "secondary-filter-highlight-17",
    "secondary-filter-highlight-18",
    "secondary-filter-highlight-19",
  ],

  // 虚拟滚动配置
  virtualScroll: {
    bufferSize: 50,
    lineHeight: 20,
    buffer: 50
  },

  // 文件树虚拟滚动
  fileTreeVirtualBuffer: 40,

  // 存储键名
  STORAGE_KEYS: {
    bookmarks: "logtool_bookmarks_v1",
    fileTreeDockedWidth: "aitool.fileTree.dockedWidthPx",
    fileTreeFloatingWidth: "aitool.fileTree.floatingWidthPx",
    filteredPanel: "filteredPanel.state",
    aiAssistantPanel: "aiAssistantPanel.state"
  },

  // 文件限制
  MAX_FILES: 5000,
  MAX_TOTAL_SIZE: 10000 * 1024 * 1024, // 10GB
  BATCH_SIZE: 5
};

})();

