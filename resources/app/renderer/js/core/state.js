/**
 * 状态管理模块
 * 集中管理应用状态
 */

window.App = window.App || {};
window.App.State = {
  // 日志数据
  originalLines: [],
  fileHeaders: [],

  // 当前显示
  visibleLines: [],
  visibleStart: 0,
  visibleEnd: 0,

  // 搜索状态
  currentSearchIndex: -1,
  searchResults: [],
  searchKeyword: "",

  // 过滤状态
  currentFilter: {
    filteredLines: [],
    filteredToOriginalIndex: [],
    filterKeywords: [],
    totalLines: 0,
  },

  // 二级过滤状态
  secondaryFilter: {
    isActive: false,
    filterText: "",
    filterKeywords: [],
    filteredLines: [],
    filteredToOriginalIndex: [],
    filteredToPrimaryIndex: [],
  },

  // UI状态
  isFullscreen: false,
  isFiltering: false,
  isFirstFilter: true,
  isFilterPanelMaximized: false,
  isAiAssistantPanelMaximized: false,
  wasFilterPanelVisibleBeforeFocus: false,

  // 文件树状态
  fileTreeData: [],
  fileTreeHierarchy: [],
  fileTreeAllVisibleIndices: [],
  visibleFileTreeItems: [],
  visibleFileTreeItemsSet: new Set(),
  fileTreeSearchTerm: "",

  // 书签状态
  bookmarkedIndexSet: new Set(),
  bookmarks: [],

  // 其他
  currentFile: null,
  customHighlights: [],
  focusOnFilteredPanel: false,
  focusOnMainLog: false,
  filteredPanelScrollPosition: 0,

  // 虚拟滚动状态
  filteredPanelAllLines: [],
  filteredPanelAllOriginalIndices: [],
  filteredPanelAllPrimaryIndices: [],
  filteredPanelVisibleStart: 0,
  filteredPanelVisibleEnd: 0,

  // 过滤面板状态
  filteredPanelState: {
    isMaximized: false,
    position: null
  },

  // AI助手面板状态
  aiAssistantPanelState: {
    isMaximized: false,
    position: null
  }
};

console.log('✓ State module loaded');
