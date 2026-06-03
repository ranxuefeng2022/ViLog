/**
 * Dynamic Island — Progress 子模块
 * 管理进度显示、阶段注册表、IPC 监听
 * 通过 deps 与模式管理器交互
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  window.App._DI.createProgress = function(deps) {
    var _fill = null;
    var _label = null;
    var _card = null;
    var _active = false;
    var _color = '';
    var _timer = null;
    var _staleTimer = null;
    var _phaseHandlers = {};

    var PHASE_LABELS = {
      copying: '复制文件',
      writing: '写入文件',
      extracting: '解压文件',
      indexing: '建立索引',
      converting: '时间转换',
      filtering: '流式过滤',
      merging: '合并结果'
    };

    var PHASE_COLORS = {
      copying:   { bg: 'rgba(66,133,244,0.7)',  glow: 'rgba(66,133,244,0.25)' },
      writing:   { bg: 'rgba(66,133,244,0.7)',  glow: 'rgba(66,133,244,0.25)' },
      extracting:{ bg: 'rgba(175,82,222,0.7)',   glow: 'rgba(175,82,222,0.25)' },
      indexing:  { bg: 'rgba(88,86,214,0.7)',    glow: 'rgba(88,86,214,0.25)' },
      converting:{ bg: 'rgba(0,199,190,0.7)',    glow: 'rgba(0,199,190,0.25)' },
      filtering: { bg: 'rgba(52,199,89,0.7)',    glow: 'rgba(52,199,89,0.25)' },
      merging:   { bg: 'rgba(255,149,0,0.7)',    glow: 'rgba(255,149,0,0.25)' }
    };
    var _currentPhase = '';
    var _currentLabel = '';
    var _defaultColor = { bg: 'rgba(255,149,0,0.65)', glow: 'rgba(255,149,0,0.25)' };

    _phaseHandlers.filtering = function(data, label) {
      label += ' · ' + (data.matchCount || 0) + ' 个匹配';
      show(-1, label);
    };

    _phaseHandlers.merging = function() {
      return;
    };

    function init(cardEl) {
      _card = cardEl;
      var progressWrap = document.createElement('div');
      progressWrap.id = 'diProgressWrap';
      var progressLabel = document.createElement('span');
      progressLabel.id = 'diProgressLabel';
      progressWrap.appendChild(progressLabel);
      var track = document.createElement('div');
      track.id = 'diProgressTrack';
      _fill = document.createElement('div');
      _fill.id = 'diProgressFill';
      track.appendChild(_fill);
      progressWrap.appendChild(track);
      cardEl.appendChild(progressWrap);
      _label = progressLabel;

      if (window.electronAPI && window.electronAPI.on) {
        window.electronAPI.on('chunk-index-progress', function(data) {
          handleProgress(data);
        });
      }
    }

    function handleProgress(data) {
      if (!data) return;
      _currentPhase = data.phase || '';
      var label = PHASE_LABELS[data.phase] || data.phase || '加载中';
      var pct = data.percent || 0;
      var handler = _phaseHandlers[data.phase];
      if (handler) {
        handler(data, label);
      } else {
        show(pct, label);
      }
      if (_timer) clearTimeout(_timer);
      if (_staleTimer) clearTimeout(_staleTimer);
      if (pct >= 100) {
        _timer = setTimeout(function() {
          hide();
          _timer = null;
        }, 800);
      } else {
        _staleTimer = setTimeout(function() {
          hide();
          _staleTimer = null;
        }, 5000);
      }
    }

    function show(percent, label) {
      var card = deps && deps.getCard ? deps.getCard() : _card;
      var el = deps && deps.getEl ? deps.getEl() : null;
      if (!card) return;

      _active = true;

      var hovering = deps && deps.isHoverActive && deps.isHoverActive();

      card.classList.add('di-show-progress', 'di-loading');
      if (!hovering) {
        var c = PHASE_COLORS[_currentPhase] || _defaultColor;
        card.style.background = c.bg;
        card.style.boxShadow = '0 0 10px ' + c.glow;
      }
      if (!hovering && el) el.classList.add('di-container-loading');

      if (_fill) {
        if (percent < 0) {
          _fill.style.width = '30%';
          _fill.style.left = '0';
          _fill.style.animation = 'diIndeterminate 1.2s ease-in-out infinite';
        } else {
          _fill.style.animation = '';
          _fill.style.left = '0';
          _fill.style.width = Math.min(100, Math.max(0, percent)) + '%';
        }
        if (!_color) _color = 'rgba(255,255,255,0.9)';
        _fill.style.background = _color;
      }
      if (_label) {
        var newLabel = label || (percent < 0 ? '处理中...' : Math.round(percent) + '%');
        if (newLabel !== _currentLabel) {
          _currentLabel = newLabel;
          _label.textContent = newLabel;
        }
      }
      var infoEl = deps && deps.getInfo ? deps.getInfo() : null;
      if (infoEl) infoEl.textContent = _currentLabel || _currentPhase || '加载中';
    }

    function hide() {
      var card = deps && deps.getCard ? deps.getCard() : _card;
      var el = deps && deps.getEl ? deps.getEl() : null;
      if (!card || !card.classList.contains('di-show-progress')) return;
      if (_timer) { clearTimeout(_timer); _timer = null; }
      if (_staleTimer) { clearTimeout(_staleTimer); _staleTimer = null; }

      // 完成动画
      card.classList.remove('di-loading');
      card.classList.add('di-completing');

      setTimeout(function() {
        _active = false;
        card.classList.remove('di-show-progress', 'di-completing');
        card.style.background = '';
        card.style.boxShadow = '';
        if (el) el.classList.remove('di-container-loading');
        _color = '';
        _currentPhase = '';
        if (_fill) {
          _fill.style.width = '0%';
          _fill.style.animation = '';
        }

        // 通知主模块动画完成（由主模块释放文本模式引用）
        if (deps && deps.onHidden) deps.onHidden();
      }, 400);
    }

    function isActive() {
      return _active;
    }

    function registerPhaseHandler(phase, handler) {
      _phaseHandlers[phase] = handler;
    }

    function destroy() {
      if (_timer) { clearTimeout(_timer); _timer = null; }
      if (_staleTimer) { clearTimeout(_staleTimer); _staleTimer = null; }
      _active = false;
      var wrap = document.getElementById('diProgressWrap');
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
      _fill = null;
      _label = null;
      _card = null;
    }

    return {
      init: init,
      show: show,
      hide: hide,
      isActive: isActive,
      handleProgress: handleProgress,
      registerPhaseHandler: registerPhaseHandler,
      destroy: destroy
    };
  };
})();
