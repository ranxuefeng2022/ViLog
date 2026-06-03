/**
 * Dynamic Island — Buttons 子模块
 * 创建纯文字药丸按钮，嵌入 card 内部
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  window.App._DI.createButtons = function(deps) {
    var _container = null;

    var BUTTONS = [
      { action: 'search',     label: '搜索' },
      { action: 'filter',     label: '过滤' },
      { action: 'help',       label: '指南' },
      { action: 'convertTime',label: '时间转换' },
      { action: 'aiChat',     label: 'AI' }
    ];

    var _actionHandlers = {
      search: function() {
        var sb = document.getElementById('searchBox');
        var bar = document.getElementById('searchFloatingBar');
        if (bar) bar.classList.add('visible');
        if (sb) { sb.focus(); sb.select(); }
      },
      filter: function() {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
      },
      help: function() {
        if (deps && deps.openHelp) deps.openHelp();
      },
      convertTime: function() {
        if (deps && deps.onConvertTime) deps.onConvertTime();
      },
      aiChat: function() {
        if (deps && deps.openAiChat) deps.openAiChat();
      }
    };

    function createButton(cfg) {
      var btn = document.createElement('button');
      btn.className = 'di-pill-btn';
      btn.dataset.action = cfg.action;
      btn.textContent = cfg.label;
      return btn;
    }

    function init(containerEl) {
      _container = containerEl;
      for (var i = 0; i < BUTTONS.length; i++) {
        _container.appendChild(createButton(BUTTONS[i]));
      }

      _container.addEventListener('click', function(e) {
        var btn = e.target.closest('.di-pill-btn');
        if (!btn) return;
        var handler = _actionHandlers[btn.dataset.action];
        if (handler) handler();
      });
    }

    function addButton(cfg) {
      if (!_container) return;
      _container.appendChild(createButton(cfg));
      if (deps && deps.onButtonChange) deps.onButtonChange();
    }

    function removeButton(action) {
      if (!_container) return;
      var btn = _container.querySelector('.di-pill-btn[data-action="' + action + '"]');
      if (btn) { btn.remove(); if (deps && deps.onButtonChange) deps.onButtonChange(); }
    }

    function registerAction(action, handler) {
      _actionHandlers[action] = handler;
    }

    function destroy() {
      _container = null;
    }

    return {
      init: init,
      addButton: addButton,
      removeButton: removeButton,
      registerAction: registerAction,
      destroy: destroy
    };
  };
})();
