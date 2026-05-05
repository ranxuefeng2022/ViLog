/**
 * UI 组件模块
 */

window.App = window.App || {};

window.App.UI = (() => {
  'use strict';

  return {
    showMessage(msg, duration) {
      if (typeof window.showMessage === 'function') window.showMessage(msg, duration);
    },
    showProgress(percent) {
      if (typeof window.showProgressBar === 'function') window.showProgressBar(percent);
    },
    hideProgress() {
      if (typeof window.hideProgressBar === 'function') window.hideProgressBar();
    },
    updateLayout() {
      if (typeof window.updateLayout === 'function') window.updateLayout();
    },
    toggleFullscreen() {
      if (typeof window.toggleFullscreen === 'function') window.toggleFullscreen();
    },
    zoomIn() {
      if (typeof window.increaseFontSize === 'function') window.increaseFontSize();
    },
    zoomOut() {
      if (typeof window.decreaseFontSize === 'function') window.decreaseFontSize();
    },
    addHighlight(keyword, color) {
      if (typeof window.highlightText === 'function') window.highlightText(keyword, color);
    },
    clearHighlights() {
      if (typeof window.clearHighlights === 'function') window.clearHighlights();
    },
    init() {
      console.log('[UI] Ready');
    }
  };
})();
