/**
 * Canvas 日志渲染器集成补丁
 * 将 Canvas 渲染器集成到主应用中
 *
 * 这个补丁会：
 * 1. 初始化 Canvas 渲染器
 * 2. 覆盖原有的 DOM 渲染函数
 * 3. 保持所有现有功能（搜索、过滤、书签等）
 */

// 全局 Canvas 渲染器实例
let canvasLogRenderer = null;
let useCanvasRenderer = true; // 可以通过这个开关切换回 DOM 渲染

/**
 * 初始化 Canvas 日志渲染器
 */
function initCanvasLogRenderer() {
  if (canvasLogRenderer) {
    console.log('[CanvasLogRendererPatch] 渲染器已初始化，跳过');
    return;
  }

  console.log('[CanvasLogRendererPatch] 初始化 Canvas 日志渲染器...');

  // 创建渲染器实例
  canvasLogRenderer = new CanvasLogRenderer();

  // 初始化渲染器
  const success = canvasLogRenderer.init('outerContainer', 'mainLogCanvas');

  if (success) {
    console.log('[CanvasLogRendererPatch] ✓ Canvas 渲染器初始化成功');

    // 设置回调
    canvasLogRenderer.onLineClick = (lineIndex) => {
      console.log('[CanvasLogRendererPatch] 行点击:', lineIndex);
      // 可以在这里处理行点击事件
    };

    canvasLogRenderer.onLineRightClick = (lineIndex, event) => {
      // 右键点击事件
      window.logContextMenuLineIndex = lineIndex;
    };

    // 如果有现有数据，加载到 Canvas 渲染器
    if (typeof originalLines !== 'undefined' && originalLines.length > 0) {
      console.log('[CanvasLogRendererPatch] 加载现有数据:', originalLines.length, '行');
      canvasLogRenderer.setData(originalLines);

      // 同步书签状态
      if (typeof bookmarkedIndexSet !== 'undefined') {
        canvasLogRenderer.setBookmarks(bookmarkedIndexSet);
      }
    }
  } else {
    console.error('[CanvasLogRendererPatch] ✗ Canvas 渲染器初始化失败');
    useCanvasRenderer = false;
  }
}

/**
 * 覆盖 renderLogLines 函数
 */
const originalRenderLogLines = window.renderLogLines;
window.renderLogLines = function(...args) {
  if (!useCanvasRenderer || !canvasLogRenderer) {
    return originalRenderLogLines ? originalRenderLogLines.apply(this, args) : undefined;
  }

  // Canvas 渲染器不需要渲染每行，只需要设置数据
  // 这个函数在加载新数据时被调用
  console.log('[CanvasLogRendererPatch] renderLogLines 被调用，行数:', args[0]);
};

/**
 * 覆盖 jumpToLine 函数以支持 Canvas 渲染器
 */
const originalJumpToLine = window.jumpToLine;
window.jumpToLine = function(lineIndex, position) {
  if (!useCanvasRenderer || !canvasLogRenderer) {
    return originalJumpToLine ? originalJumpToLine.apply(this, arguments) : undefined;
  }

  canvasLogRenderer.scrollToLine(lineIndex, position);
};

/**
 * 覆盖 toggleBookmark 函数
 */
const originalToggleBookmark = window.toggleBookmark;
window.toggleBookmark = function(lineIndex) {
  if (!useCanvasRenderer || !canvasLogRenderer) {
    return originalToggleBookmark ? originalToggleBookmark.apply(this, arguments) : undefined;
  }

  const added = canvasLogRenderer.toggleBookmark(lineIndex);

  // 同步到原始书签系统
  if (typeof bookmarkedIndexSet !== 'undefined') {
    if (added) {
      bookmarkedIndexSet.add(lineIndex);
    } else {
      bookmarkedIndexSet.delete(lineIndex);
    }
  }

  // 更新书签面板
  if (typeof updateBookmarksPanel === 'function') {
    updateBookmarksPanel();
  }

  return added;
};

/**
 * 覆盖 highlightText 函数以支持 Canvas 渲染器
 */
const originalHighlightText = window.highlightText;
window.highlightText = function(keyword, color) {
  if (!useCanvasRenderer || !canvasLogRenderer) {
    return originalHighlightText ? originalHighlightText.apply(this, arguments) : undefined;
  }

  canvasLogRenderer.addHighlight(keyword, color);
};

/**
 * 覆盖 clearHighlights 函数
 */
const originalClearHighlights = window.clearHighlights;
window.clearHighlights = function() {
  if (!useCanvasRenderer || !canvasLogRenderer) {
    return originalClearHighlights ? originalClearHighlights.apply(this, arguments) : undefined;
  }

  canvasLogRenderer.clearHighlights();
};

/**
 * 监听数据变化并同步到 Canvas 渲染器
 */
function syncDataToCanvasRenderer() {
  if (!useCanvasRenderer || !canvasLogRenderer) return;

  if (typeof originalLines !== 'undefined' && originalLines.length > 0) {
    // 检查数据是否变化
    const currentCount = canvasLogRenderer.getLineCount();
    if (currentCount !== originalLines.length) {
      console.log('[CanvasLogRendererPatch] 数据变化，重新加载:', originalLines.length, '行');
      canvasLogRenderer.setData(originalLines);
    }
  }
}

/**
 * 监听搜索关键词变化
 */
function syncSearchToCanvasRenderer() {
  if (!useCanvasRenderer || !canvasLogRenderer) return;

  if (typeof searchBox !== 'undefined' && searchBox) {
    const keyword = searchBox.value;
    if (keyword && keyword !== canvasLogRenderer.searchKeyword) {
      canvasLogRenderer.setSearchKeyword(keyword);
    }
  }
}

/**
 * 定期同步状态
 */
let syncInterval = null;
function startSyncInterval() {
  if (syncInterval) return;

  syncInterval = setInterval(() => {
    syncDataToCanvasRenderer();
    syncSearchToCanvasRenderer();
  }, 500); // 每500ms同步一次
}

function stopSyncInterval() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/**
 * 切换渲染模式
 */
window.toggleRenderMode = function() {
  useCanvasRenderer = !useCanvasRenderer;

  if (useCanvasRenderer) {
    console.log('[CanvasLogRendererPatch] 切换到 Canvas 渲染模式');
    if (canvasLogRenderer && typeof originalLines !== 'undefined') {
      canvasLogRenderer.setData(originalLines);
    }
  } else {
    console.log('[CanvasLogRendererPatch] 切换到 DOM 渲染模式');
    // 需要重新渲染 DOM
    if (typeof originalRenderLogLines === 'function') {
      originalRenderLogLines();
    }
  }

  return useCanvasRenderer;
};

/**
 * 获取当前渲染模式
 */
window.getRenderMode = function() {
  return useCanvasRenderer ? 'canvas' : 'dom';
};

/**
 * 导出 Canvas 渲染器实例
 */
window.getCanvasLogRenderer = function() {
  return canvasLogRenderer;
};

// ==================== 初始化 ====================

// 等待 DOM 加载完成
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initCanvasLogRenderer, 100);
  });
} else {
  // DOM 已经加载完成
  setTimeout(initCanvasLogRenderer, 100);
}

// 监听窗口加载完成
window.addEventListener('load', () => {
  setTimeout(() => {
    initCanvasLogRenderer();
    startSyncInterval();
  }, 500);
});

// 监听文件加载完成事件（通过自定义事件）
window.addEventListener('logDataLoaded', (e) => {
  console.log('[CanvasLogRendererPatch] logDataLoaded 事件:', e.detail);
  if (useCanvasRenderer && canvasLogRenderer) {
    canvasLogRenderer.setData(e.detail.lines);
  }
});

// 监听搜索事件
window.addEventListener('searchChanged', (e) => {
  console.log('[CanvasLogRendererPatch] searchChanged 事件:', e.detail);
  if (useCanvasRenderer && canvasLogRenderer) {
    canvasLogRenderer.setSearchKeyword(e.detail.keyword);
  }
});

console.log('[CanvasLogRendererPatch] 补丁已加载');
