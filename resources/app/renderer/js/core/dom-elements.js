/**
 * DOM元素引用模块
 * 集中管理所有DOM元素的引用
 */

window.App = window.App || {};
window.App.DOM = {};

// 延迟初始化，确保DOM已加载
window.App.DOM.init = function() {
  // 主容器
  this.inner = document.getElementById("innerContainer");
  this.outer = document.getElementById("outerContainer");
  this.filterBox = document.getElementById("filterBox");
  this.fileInfo = document.getElementById("fileInfo");
  this.progressBar = document.getElementById("progressBar");
  this.progressFill = document.getElementById("progressFill");
  this.fileCount = document.getElementById("fileCount");
  this.searchStatus = document.getElementById("searchStatus");
  this.shortcutHint = document.getElementById("shortcutHint");

  // 搜索相关
  this.searchBox = document.getElementById("searchBox");
  this.prevBtn = document.getElementById("prevBtn");
  this.nextBtn = document.getElementById("nextBtn");

  // 文件树相关
  this.fileTreeContainer = document.getElementById("fileTreeContainer");
  this.fileTreeResizer = document.getElementById("fileTreeResizer");
  this.fileTreeSearch = document.getElementById("fileTreeSearch");
  this.fileTreeList = document.getElementById("fileTreeList");
  this.fileTreeCount = document.getElementById("fileTreeCount");
  this.fileTreeCollapseBtn = document.getElementById("fileTreeCollapseBtn");
  this.fileTreeFloatingOverlay = document.getElementById("fileTreeFloatingOverlay");
  this.fileTreeContextMenu = document.getElementById("fileTreeContextMenu");
  this.importFileInput = document.getElementById("importFileInput");
  this.importFolderInput = document.getElementById("importFolderInput");

  // 过滤面板相关
  this.filteredPanel = document.getElementById("filteredPanel");
  this.filteredPanelContent = document.getElementById("filteredPanelContent");
  this.filteredPanelHeader = document.getElementById("filteredPanelHeader");
  this.filteredPanelClose = document.getElementById("filteredPanelClose");
  this.filteredCount = document.getElementById("filteredCount");
  this.filteredPanelPlaceholder = document.getElementById("filteredPanelPlaceholder");
  this.filteredPanelVirtualContent = document.getElementById("filteredPanelVirtualContent");
  this.filteredPanelSearchBox = document.getElementById("filteredPanelSearchBox");
  this.filteredPanelSearchSuggestions = document.getElementById("filteredPanelSearchSuggestions");
  this.filteredPanelSearchStatus = document.getElementById("filteredPanelSearchStatus");
  this.filteredPanelPrevBtn = document.getElementById("filteredPanelPrevBtn");
  this.filteredPanelNextBtn = document.getElementById("filteredPanelNextBtn");
  this.filteredPanelFilterBox = document.getElementById("filteredPanelFilterBox");
  this.filteredPanelFilterBtn = document.getElementById("filteredPanelFilterBtn");
  this.filteredPanelClearFilterBtn = document.getElementById("filteredPanelClearFilterBtn");
  this.filteredPanelFilterStatus = document.getElementById("filteredPanelFilterStatus");
  this.filteredPanelRegexStatus = document.getElementById("filteredPanelRegexStatus");
  this.secondaryFilterStatus = document.getElementById("secondaryFilterStatus");

  // 书签相关
  this.bookmarksPanel = document.getElementById("bookmarksPanel");
  this.bookmarksList = document.getElementById("bookmarksList");
  this.bookmarksSearch = document.getElementById("bookmarksSearch");
  this.bookmarksCount = document.getElementById("bookmarksCount");

  // AI助手相关
  this.aiAssistantPanel = document.getElementById("aiAssistantPanel");
  this.aiAssistantHeader = document.getElementById("aiAssistantHeader");
  this.aiAssistantClose = document.getElementById("aiAssistantClose");
  this.aiAssistantFrame = document.getElementById("aiAssistantFrame");
  this.aiAssistantToolbarBtn = document.getElementById("aiAssistantToolbarBtn");

  // 过滤建议
  this.filterSuggestions = document.getElementById("filterSuggestions");

  console.log('✓ DOM elements initialized');
};

console.log('✓ DOM Elements module loaded');
