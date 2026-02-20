/**
 * 应用核心模块
 * 初始化和主要逻辑
 */

window.App = window.App || {};

// 应用初始化
window.App.init = function() {
  console.log('=== App Initializing ===');

  // 初始化模块
  window.App.DOM.init();
  window.App.VirtualScroll.init();
  window.App.LogViewer.init();
  window.App.FileTree.init();
  window.App.Filter.init();
  window.App.Search.init();
  window.App.Bookmarks.init();
  window.App.ContextMenu.init();
  window.App.KeyboardShortcuts.init();
  window.App.WindowControl.init();

  console.log('=== App Initialized ===');
};

// 当DOM加载完成后自动初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.App.init();
  });
} else {
  window.App.init();
}

console.log('✓ App Core module loaded');
