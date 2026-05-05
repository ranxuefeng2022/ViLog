/**
 * 日志渲染模块
 */

window.App = window.App || {};

window.App.LogRenderer = (() => {
  'use strict';

  return {
    refresh() {
      if (typeof window.renderLogLines === 'function') window.renderLogLines();
    },
    updateVisible() {
      if (typeof window.updateVisibleLines === 'function') window.updateVisibleLines();
    },
    jumpToLine(lineIndex) {
      if (typeof window.jumpToLine === 'function') window.jumpToLine(lineIndex);
    },
    jumpToOriginal(lineIndex) {
      if (typeof window.jumpToOriginalLine === 'function') window.jumpToOriginalLine(lineIndex);
    },
    getMode() {
      return typeof window.getRenderMode === 'function' ? window.getRenderMode() : 'dom';
    },
    toggleMode() {
      if (typeof window.toggleRenderMode === 'function') window.toggleRenderMode();
    },
    init() {
      console.log('[LogRenderer] Ready');
    }
  };
})();
