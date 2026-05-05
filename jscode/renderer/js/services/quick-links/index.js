/**
 * 快捷链接面板模块
 */

window.App = window.App || {};

window.App.QuickLinks = (() => {
  'use strict';

  return {
    toggle() {
      if (typeof window.toggleQuickLinksPanel === 'function') window.toggleQuickLinksPanel();
    },
    add(name, path) {
      if (typeof window.addQuickLink === 'function') window.addQuickLink(name, path);
    },
    init() {
      console.log('[QuickLinks] Ready');
    }
  };
})();
