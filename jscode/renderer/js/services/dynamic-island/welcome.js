/**
 * Dynamic Island — Welcome 子模块
 * 启动时逐字打字动画，使用文本模式
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  var LINES = [
    '欢迎使用 VL 日志分析工具',
    '我是由 AI 驱动开发的多功能和性能强大的日志分析工具',
    '支持日志的分片加载 + 虚拟滚动 + Rg 过滤',
    '对于 G 级别的日志占用极少内存',
    '就能快速查看 / 查找 / 过滤 / 智能跳转 / UTC 时间戳转化等各种功能',
    '还支持充放电各种日志的自动化解析，绘图，统计等',
    '我的功能几乎可以被无限拓展',
    '使用过程中有遇到问题或者需求请联系冉雪峰（工号：11143232）',
    '感谢您的使用，祝您生活愉快！'
  ];

  var CHAR_DELAY = 45;
  var LINE_DELAY = 350;
  var COMPLETE_WAIT = 2500;
  var FADE_DURATION = 500;

  window.App._DI.createWelcome = function(deps) {
    var _card = null;
    var _content = null;
    var _lineIdx = 0;
    var _charIdx = 0;
    var _charTimer = null;
    var _lineTimer = null;
    var _completeTimer = null;
    var _stopped = false;
    var _fileTreeObserver = null;

    function init(cardEl) {
      _card = cardEl;
    }

    function start() {
      if (_stopped || !_card) return;
      if (deps && deps.requestText) deps.requestText();
      _content = document.createElement('div');
      _content.id = 'diWelcomeContent';
      _card.appendChild(_content);
      _card.classList.add('di-welcome');
      addLine();
      typeChar();
      _watchFileTree();
    }

    function _watchFileTree() {
      var ftc = document.getElementById('fileTreeContainer');
      if (!ftc) return;
      _fileTreeObserver = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].type === 'attributes' && ftc.classList.contains('visible')) {
            stop();
            return;
          }
        }
      });
      _fileTreeObserver.observe(ftc, { attributes: true, attributeFilter: ['class'] });
    }

    function _unwatchFileTree() {
      if (_fileTreeObserver) { _fileTreeObserver.disconnect(); _fileTreeObserver = null; }
    }

    function addLine() {
      var line = document.createElement('div');
      line.className = 'di-welcome-line';
      if (_lineIdx === 0) line.classList.add('di-welcome-line--title');
      var text = document.createElement('span');
      line.appendChild(text);
      var cursor = document.createElement('span');
      cursor.className = 'di-welcome-cursor';
      line.appendChild(cursor);
      _content.appendChild(line);
    }

    function typeChar() {
      if (_stopped) return;
      if (_lineIdx >= LINES.length) { onAllDone(); return; }

      var lineText = LINES[_lineIdx];
      if (_charIdx < lineText.length) {
        var lineEl = _content.children[_lineIdx];
        if (lineEl && lineEl.firstChild) {
          lineEl.firstChild.textContent += lineText[_charIdx];
        }
        _charIdx++;
        _content.scrollTop = _content.scrollHeight;
        _charTimer = setTimeout(typeChar, CHAR_DELAY);
      } else {
        var cursor = _content.children[_lineIdx]
          ? _content.children[_lineIdx].querySelector('.di-welcome-cursor')
          : null;
        if (cursor) cursor.remove();
        _lineIdx++;
        _charIdx = 0;
        if (_lineIdx < LINES.length) {
          addLine();
          _lineTimer = setTimeout(typeChar, LINE_DELAY);
        } else {
          onAllDone();
        }
      }
    }

    function onAllDone() {
      var lastLine = _content.children[_content.children.length - 1];
      if (lastLine) {
        var cursor = lastLine.querySelector('.di-welcome-cursor');
        if (cursor) cursor.remove();
      }
      _completeTimer = setTimeout(function() {
        if (!_stopped) fadeOut();
      }, COMPLETE_WAIT);
    }

    function fadeOut() {
      if (!_content) return;
      _content.classList.add('di-welcome-fadeout');
      setTimeout(function() {
        cleanup();
        if (deps && deps.onComplete) deps.onComplete();
      }, FADE_DURATION);
    }

    function stop() {
      _stopped = true;
      _unwatchFileTree();
      clearTimers();
      cleanup();
      if (deps && deps.onComplete) deps.onComplete();
    }

    function cleanup() {
      if (_content && _content.parentNode) _content.parentNode.removeChild(_content);
      _content = null;
      if (_card) _card.classList.remove('di-welcome');
    }

    function clearTimers() {
      if (_charTimer) { clearTimeout(_charTimer); _charTimer = null; }
      if (_lineTimer) { clearTimeout(_lineTimer); _lineTimer = null; }
      if (_completeTimer) { clearTimeout(_completeTimer); _completeTimer = null; }
    }

    function destroy() {
      _unwatchFileTree();
      stop();
      _card = null;
    }

    return { init: init, start: start, stop: stop, destroy: destroy };
  };
})();
