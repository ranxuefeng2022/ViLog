/**
 * Log Viewer - 主入口文件（模块化版本）
 *
 * 采用渐进式模块化策略：
 * Phase 1: 创建模块框架 + 加载原始代码（当前阶段）
 * Phase 2: 逐步将功能迁移到模块中
 * Phase 3: 完全模块化
 */

console.log('=== Log Viewer Modular Version ===');
console.log('Phase 1: Module Framework + Legacy Code');

// ============================================================================
// Step 1: 加载工具和核心模块（立即执行）
// ============================================================================
console.log('\n[1/3] Loading utility modules...');

// 这里使用 document.write 确保按顺序同步加载
document.write('<script src="renderer/js/utils/constants.js"><\/script>');
document.write('<script src="renderer/js/utils/helpers.js"><\/script>');
document.write('<script src="renderer/js/core/state.js"><\/script>');
document.write('<script src="renderer/js/core/dom-elements.js"><\/script>');

console.log('Utility modules loaded ✓');

// ============================================================================
// Step 2: 加载功能模块框架（同步）
// ============================================================================
console.log('\n[2/3] Loading feature module frameworks...');

document.write('<script src="renderer/js/features/virtual-scroll.js"><\/script>');
document.write('<script src="renderer/js/features/log-viewer.js"><\/script>');
document.write('<script src="renderer/js/features/file-tree.js"><\/script>');
document.write('<script src="renderer/js/features/filter.js"><\/script>');
document.write('<script src="renderer/js/features/search.js"><\/script>');
document.write('<script src="renderer/js/features/bookmarks.js"><\/script>');
document.write('<script src="renderer/js/features/context-menu.js"><\/script>');
document.write('<script src="renderer/js/core/keyboard-shortcuts.js"><\/script>');
document.write('<script src="renderer/js/core/window-control.js"><\/script>');
// 🚀 性能优化：加载高亮Worker管理器
document.write('<script src="renderer/js/highlight-worker-manager.js"><\/script>');

console.log('Feature module frameworks loaded ✓');

// ============================================================================
// Step 3: 加载原始JavaScript代码（保持功能完整）
// ============================================================================
console.log('\n[3/3] Loading legacy code for full functionality...');
document.write('<script src="renderer/js/original-script.js"><\/script>');

console.log('Legacy code loaded ✓');

// ============================================================================
// 模块化说明
// ============================================================================
console.log('\n=== Module Loading Complete ===');
console.log(`
📦 Current Architecture:

1. Framework Layer (New)
   ├─ Constants    - Configuration and defaults
   ├─ Helpers      - Utility functions
   ├─ State        - Application state
   └─ DOM Elements - Element references

2. Feature Modules (Framework Only, to be implemented)
   ├─ Virtual Scroll - High-performance rendering
   ├─ Log Viewer     - Log display
   ├─ File Tree      - File browser
   ├─ Filter         - Log filtering
   ├─ Search         - Log search
   ├─ Bookmarks      - Bookmark management
   ├─ Context Menu   - Right-click menus
   ├─ Keyboard       - Shortcut handling
   └─ Window Control - Window operations

3. Legacy Layer (Current Implementation)
   └─ original-script.js - Full functionality (398KB)

🔄 Migration Plan:
  ✓ Phase 1 (Current): Framework + Legacy (2025-01-02)
  → Phase 2 (Next): Migrate utility functions to modules
  → Phase 3 (Future): Migrate feature modules one by one
  → Phase 4 (Final): Remove legacy code, pure modules

📝 Notes:
  - All current functionality is preserved
  - No breaking changes to existing features
  - New modules are ready for gradual migration
  - Can test modules incrementally
`);

// 在原始代码加载后，尝试初始化新模块框架
window.addEventListener('load', () => {
  console.log('\n=== Initializing Modular Framework ===');

  // 延迟初始化，确保原始代码已经执行
  setTimeout(() => {
    // 检查是否已定义全局变量
    if (typeof window.originalLines !== 'undefined') {
      console.log('Legacy code detected, creating bridges...');

      // 将原始代码中的全局变量同步到新模块
      if (window.App && window.App.State) {
        // 同步状态
        window.App.State.originalLines = window.originalLines || [];
        window.App.State.customHighlights = window.customHighlights || [];
        // ... 可以继续添加更多状态同步
      }

      console.log('Bridge created ✓');
    }

    // 标记新版本
    window.App.version = '2.0.0-modular';
    console.log('App version:', window.App.version);
    console.log('✓ Modular framework ready');
  }, 100);
});

// 导出API供外部使用
// 确保 window.App 存在
window.App = window.App || {};
window.App.API = {
  // 获取应用状态
  getState: () => window.App.State,

  // 获取工具函数
  getUtils: () => window.App.Utils,

  // 获取常量
  getConstants: () => window.App.Constants,

  // 获取DOM元素
  getDOM: () => window.App.DOM,

  // 版本信息
  version: '2.0.0-modular'
};
