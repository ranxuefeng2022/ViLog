/**
 * DynamicIsland — 灵动岛（主模块）
 *
 * 三模式架构（可扩展）：
 *   文本模式 text      — 药丸形状，显示进度/提示/文件名（优先级 20）
 *   功能模式 function  — 鼠标悬停，圆形丝滑展开为弧形面板展示按钮（优先级 10）
 *   表情模式 face      — 空闲时圆形表情动画（优先级 0）
 *
 * 模式管理器：基于优先级的参考计数，文本 > 功能 > 表情
 * 子模块：progress.js, buttons.js, help.js, state-listeners.js, welcome.js
 * 公共 API：window.App.DynamicIsland
 */
(function() {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     模式管理器
     ═══════════════════════════════════════════════════════════════════ */

  var _modes = {};
  var _pending = {};
  var _activeMode = null;

  function registerMode(name, config) {
    _modes[name] = config;
  }

  function requestMode(name) {
    _pending[name] = (_pending[name] || 0) + 1;
    _evaluateModes();
  }

  function releaseMode(name) {
    if (_pending[name] > 0) _pending[name]--;
    if (_pending[name] <= 0) delete _pending[name];
    _evaluateModes();
  }

  function getActiveMode() {
    return _activeMode;
  }

  function _evaluateModes() {
    var best = null;
    var bestPri = -999;
    for (var n in _pending) {
      if (_pending[n] > 0 && _modes[n] && _modes[n].priority > bestPri) {
        best = n;
        bestPri = _modes[n].priority;
      }
    }
    if (!best) best = 'face';

    if (best !== _activeMode) {
      var old = _activeMode;
      if (old && _modes[old] && _modes[old].onDeactivate) _modes[old].onDeactivate();
      _activeMode = best;
      console.log('[DynamicIsland] 模式切换:', old, '→', best,
        'pending:', JSON.stringify(_pending));
      if (_modes[best] && _modes[best].onActivate) _modes[best].onActivate();
    }
  }

  function _setupModes() {
    registerMode('face', {
      priority: 0,
      onActivate: function() {
        if (_card) {
          _card.classList.add('di-mode-face');
          _card.classList.remove('di-mode-text', 'di-show-progress', 'di-welcome', 'di-loading', 'di-completing');
          // 保留 hover 状态：鼠标还在上方时不应清除 di-mode-hover
        }
        _showFaceAnimation();
      },
      onDeactivate: function() {
        _hideFaceAnimation();
      }
    });
    _pending['face'] = 1;

    registerMode('text', {
      priority: 20,
      onActivate: function() {
        if (_card) {
          _card.classList.remove('di-mode-face');
          _card.classList.add('di-mode-text');
        }
      },
      onDeactivate: function() {
        if (_card) {
          _card.classList.remove('di-mode-text', 'di-show-progress', 'di-welcome', 'di-loading', 'di-completing');
        }
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     DOM
     ═══════════════════════════════════════════════════════════════════ */

  var _el = null;
  var _card = null;
  var _info = null;
  var _btnRow = null;

  var _face = null;
  var _faceTimer = null;
  var _moodIdx = 0;

  var _progress = null;
  var _buttons = null;
  var _help = null;
  var _aiChat = null;
  var _stateListeners = null;
  var _welcome = null;

  var _unsubs = [];
  var _toastTimer = null;
  var _toastRestoreTimer = null;

  /* ═══════════════════════════════════════════════════════════════════
     表情动画
     ═══════════════════════════════════════════════════════════════════ */

  var MOODS = [
    { c: '', d: 3500 },
    { c: 'di-face--happy', d: 2800 },
    { c: '', d: 4500 },
    { c: 'di-face--look-l', d: 2200 },
    { c: '', d: 3000 },
    { c: 'di-face--look-r', d: 2200 },
    { c: '', d: 5000 },
    { c: 'di-face--wink', d: 2500 },
    { c: '', d: 3500 },
    { c: 'di-face--happy', d: 2800 },
    { c: '', d: 4000 },
    { c: 'di-face--surprised', d: 1800 },
    { c: '', d: 3000 },
    { c: 'di-face--look-l', d: 2200 },
    { c: '', d: 4500 },
    { c: 'di-face--sleepy', d: 3000 },
    { c: '', d: 2000 },
    { c: 'di-face--love', d: 3000 },
    { c: '', d: 3500 },
    { c: 'di-face--wink', d: 2500 },
    { c: '', d: 5000 }
  ];

  function _showFaceAnimation() {
    if (!_face) return;
    if (_faceTimer) { clearTimeout(_faceTimer); _faceTimer = null; }
    _moodIdx = 0;
    _face.className = 'di-face';
    _cycleMood();
  }

  function _hideFaceAnimation() {
    if (_faceTimer) { clearTimeout(_faceTimer); _faceTimer = null; }
  }

  function _cycleMood() {
    if (!_face || _activeMode !== 'face') return;
    var m = MOODS[_moodIdx % MOODS.length];
    _face.className = 'di-face' + (m.c ? ' ' + m.c : '');
    _moodIdx++;
    _faceTimer = setTimeout(_cycleMood, m.d);
  }

  /* ═══════════════════════════════════════════════════════════════════
     创建 DOM
     ═══════════════════════════════════════════════════════════════════ */

  function createPupil() {
    var p = document.createElement('span');
    p.className = 'di-face-pupil';
    return p;
  }

  function createDOM() {
    _el = document.createElement('div');
    _el.id = 'dynamicIsland';

    _card = document.createElement('div');
    _card.id = 'diCard';

    _info = document.createElement('span');
    _info.id = 'diInfo';
    _card.appendChild(_info);

    /* 表情 */
    _face = document.createElement('span');
    _face.id = 'diFace';
    _face.className = 'di-face';
    var eyes = document.createElement('span');
    eyes.className = 'di-face-eyes';
    var el = document.createElement('span');
    el.className = 'di-face-eye di-face-eye--l';
    el.appendChild(createPupil());
    eyes.appendChild(el);
    var er = document.createElement('span');
    er.className = 'di-face-eye di-face-eye--r';
    er.appendChild(createPupil());
    eyes.appendChild(er);
    _face.appendChild(eyes);
    _face.appendChild(document.createElement('span')).className = 'di-face-mouth';
    _card.appendChild(_face);

    /* 功能按钮行（在 card 内部，默认隐藏） */
    _btnRow = document.createElement('span');
    _btnRow.className = 'di-btn-row';
    _card.appendChild(_btnRow);

    _el.appendChild(_card);

    var wc = document.getElementById('windowControls');
    if (wc && wc.nextSibling) {
      wc.parentNode.insertBefore(_el, wc.nextSibling);
    } else if (wc) {
      wc.parentNode.appendChild(_el);
    } else {
      document.body.appendChild(_el);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Text mode helpers — 对称引用计数
     _requestText / _releaseText 必须成对调用（始终 +1 / -1）
     _toastRefs : toast 持有的引用数（中断时清理旧引用）
     _progressRefHeld : progress 是否持有引用（防止重复请求）
     ═══════════════════════════════════════════════════════════════════ */

  var _toastRefs = 0;
  var _progressRefHeld = false;

  function setInfo(text) {
    if (_welcome) { _welcome.stop(); _welcome = null; }
    if (_info) _info.textContent = text || '';
  }

  // 始终递增加入文本模式，调用方负责配对 _releaseText()
  function _requestText() {
    requestMode('text');
  }

  function _releaseText() {
    releaseMode('text');
  }

  function toast(text, duration, skipRestore) {
    if (_welcome) { _welcome.stop(); _welcome = null; }
    if (!_info) return;
    _info.textContent = text;
    // 如果上一个 toast 还未触发，先释放其引用，防止泄漏
    if (_toastTimer && _toastRefs > 0) {
      _toastRefs--;
      _releaseText();
    }
    if (_toastTimer) clearTimeout(_toastTimer);
    if (_toastRestoreTimer) clearTimeout(_toastRestoreTimer);
    _requestText();
    _toastRefs++;
    _toastTimer = setTimeout(function() {
      _toastTimer = null;
      if (_toastRefs > 0) {
        _toastRefs--;
        _releaseText();
      }
      if (skipRestore) return;
      _toastRestoreTimer = setTimeout(function() {
        _toastRestoreTimer = null;
        if (_stateListeners && _stateListeners.updateFileNameDisplay) {
          _stateListeners.updateFileNameDisplay();
        }
      }, 150);
    }, duration || 2000);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Hover (功能模式)
     ═══════════════════════════════════════════════════════════════════ */

  var _hoverActive = false;
  var _hoverTimer = null;

  function _onMouseEnter() {
    if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
    if (_welcome) { _welcome.stop(); _welcome = null; }
    if (_hoverActive) return;
    _hoverTimer = setTimeout(function() {
      _hoverTimer = null;
      _hoverActive = true;
      if (_card) _card.classList.add('di-mode-hover');
    }, 80);
  }

  function _onMouseLeave() {
    if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
    _hoverActive = false;
    if (_card) _card.classList.remove('di-mode-hover');
  }

  /* ═══════════════════════════════════════════════════════════════════
     Init / Destroy
     ═══════════════════════════════════════════════════════════════════ */

  function init() {
    if (_el) return;

    createDOM();
    _setupModes();

    var _DI = window.App._DI || {};
    _progress = _DI.createProgress ? _DI.createProgress({
      getEl: function() { return _el; },
      getCard: function() { return _card; },
      getInfo: function() { return _info; },
      isHoverActive: function() { return _hoverActive; },
      onHidden: function() {
        if (_progressRefHeld) { _releaseText(); _progressRefHeld = false; }
      }
    }) : null;
    _buttons  = _DI.createButtons  ? _DI.createButtons({
      getContainer: function() { return _btnRow; },
      openHelp: function() { if (_help) _help.open(); },
      openAiChat: function() { if (_aiChat) _aiChat.open(); },
      onConvertTime: _createConvertHandler(),
      onButtonChange: function() {
        if (_card && _hoverActive) {
          _card.style.minWidth = '0px';
          void _card.offsetWidth;
          _card.style.minWidth = '';
        }
      }
    }) : null;
    _help     = _DI.createHelp     ? _DI.createHelp() : null;
    _aiChat   = _DI.createAiChat   ? _DI.createAiChat() : null;
    _stateListeners = _DI.createStateListeners ? _DI.createStateListeners({
      infoEl: _info,
      addUnsub: function(fn) { _unsubs.push(fn); },
      requestText: _requestText,
      releaseText: _releaseText,
      isTextModeActive: function() { return _pending['text'] > 0; },
      toast: toast
    }) : null;
    _welcome  = _DI.createWelcome  ? _DI.createWelcome({
      onComplete: function() {
        _welcome = null;
        _releaseText();
        if (_stateListeners && _stateListeners.updateFileNameDisplay) {
          _stateListeners.updateFileNameDisplay();
        }
      },
      requestText: _requestText,
      getCard: function() { return _card; }
    }) : null;
    delete window.App._DI;

    if (_progress) _progress.init(_card);
    if (_buttons) _buttons.init(_btnRow);
    if (_help) _help.init();
    if (_aiChat) _aiChat.init();
    if (_stateListeners) _stateListeners.init();
    if (_welcome) { _welcome.init(_card); _welcome.start(); }

    _el.addEventListener('mouseenter', _onMouseEnter);
    _el.addEventListener('mouseleave', _onMouseLeave);

    console.log('[DynamicIsland] initialized — mode manager ready');
  }

  function _createConvertHandler() {
    return function() {
      // 始终扫描当前渲染进程的 chunk-tmp 目录获取临时文件
      if (!window.electronAPI || !window.electronAPI.listChunkTmpFiles) {
        toast('请先打开文件', 2000);
        return;
      }
      if (_info) _info.textContent = '扫描中...';
      window.electronAPI.listChunkTmpFiles().then(function(scanResult) {
        if (!scanResult || !scanResult.success || !scanResult.files || scanResult.files.length === 0) {
          toast('请先打开文件', 2000);
          return;
        }
        var paths = scanResult.files;
        console.log('[DynamicIsland] chunk-tmp 扫描到', paths.length, '个文件');

        if (_info) _info.textContent = '时间转换中...';
        var payload = paths.length === 1 ? paths[0] : { files: paths };
        window.electronAPI.convertAndroidTime(payload).then(function(result) {
          if (!result || !result.success) {
            toast('转换失败', 2000);
            return;
          }
          if (result.totalConverted === 0) {
            toast('无需转换', 2000, true);
            return;
          }
          console.log('[DynamicIsland] 时间转换完成:', result.totalConverted, '行');

          var convertedPaths = [];
          if (result.results) {
            for (var ri = 0; ri < result.results.length; ri++) {
              if (result.results[ri].convertedCount > 0) {
                convertedPaths.push(result.results[ri].path);
              }
            }
          }
          _reloadAfterConvert(convertedPaths.length > 0 ? convertedPaths : paths);
        }).catch(function(err) {
          console.error('[DynamicIsland] 时间转换失败:', err);
          toast('转换失败', 2000);
        });
      }).catch(function(err) {
        console.error('[DynamicIsland] 扫描 chunk-tmp 失败:', err);
        toast('请先打开文件', 2000);
      });
    };
  }

  /* 重建索引 + 清空内存 + 从磁盘重新加载 → 完成后恢复表情模式 */
  function _reloadAfterConvert(filePaths) {
    if (!window.electronAPI || !window.electronAPI.buildIndexForFiles) {
      toast('已转换，请重新打开文件查看', 3000);
      return;
    }
    if (_info) _info.textContent = '重建索引中...';
    window.electronAPI.buildIndexForFiles({ filePaths: filePaths }).then(function(idxResult) {
      if (!idxResult || !idxResult.success) {
        toast('索引重建失败，请重新打开文件', 3000);
        return;
      }
      var newHeaders = [];
      var globalIdx = 0;
      for (var fi = 0; fi < idxResult.files.length; fi++) {
        var f = idxResult.files[fi];
        newHeaders.push({
          fileName: f.fileName,
          filePath: f.filePath,
          lineCount: f.totalLines,
          startIndex: globalIdx
        });
        globalIdx += 1 + f.totalLines;
      }
      var totalLines = globalIdx;

      window.fileHeaders = newHeaders;
      window.originalLines = [];
      window.chunkTotalLines = totalLines;

      if (window.App && window.App.ChunkCache) {
        window.App.ChunkCache.init(newHeaders, totalLines);
        var firstScreenEnd = Math.min(100, totalLines - 1);
        window.App.ChunkCache.ensureRangeImmediate(0, firstScreenEnd).then(function() {
          if (typeof window.resetFilter === 'function') window.resetFilter(false);
          if (typeof window.renderLogLines === 'function') window.renderLogLines();
          var outer = document.getElementById('outerContainer');
          if (outer) outer.scrollTop = 0;
          console.log('[DynamicIsland] 重新加载完成，', totalLines, '行');
        });
      }

      // 强制清理进度状态（防止 di-loading / di-container-loading 残留）
      if (_progress) _progress.hide();
      if (_card) _card.classList.remove('di-loading', 'di-show-progress', 'di-completing');
      if (_el) _el.classList.remove('di-container-loading');
      if (_progressRefHeld) { _releaseText(); _progressRefHeld = false; }

      toast('已转换并重新加载', 2500, true);
    }).catch(function(err) {
      console.error('[DynamicIsland] 索引重建失败:', err);
      toast('已转换，请重新打开文件查看', 3000);
    });
  }

  function destroy() {
    if (_welcome) _welcome.destroy();
    if (_progress) _progress.destroy();
    if (_buttons) _buttons.destroy();
    if (_help) _help.destroy();
    if (_aiChat) _aiChat.destroy();
    if (_stateListeners) _stateListeners.destroy();
    for (var i = 0; i < _unsubs.length; i++) {
      if (typeof _unsubs[i] === 'function') _unsubs[i]();
    }
    _unsubs = [];
    if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
    if (_toastRestoreTimer) { clearTimeout(_toastRestoreTimer); _toastRestoreTimer = null; }
    if (_faceTimer) { clearTimeout(_faceTimer); _faceTimer = null; }
    if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
    if (_el) {
      _el.removeEventListener('mouseenter', _onMouseEnter);
      _el.removeEventListener('mouseleave', _onMouseLeave);
      if (_el.parentNode) _el.parentNode.removeChild(_el);
    }
    _el = null; _card = null; _info = null; _btnRow = null;
    _face = null; _progress = null; _buttons = null;
    _help = null; _aiChat = null; _stateListeners = null; _welcome = null;
    _modes = {}; _pending = {}; _activeMode = null; _hoverActive = false;
  }

  /* ═══════════════════════════════════════════════════════════════════
     Public API
     ═══════════════════════════════════════════════════════════════════ */

  window.App = window.App || {};
  window.App.DynamicIsland = Object.freeze({
    init: init,
    destroy: destroy,

    setInfo: setInfo,
    toast: toast,
    showProgress: function(pct, label) {
      if (_welcome) { _welcome.stop(); _welcome = null; }
      if (!_progressRefHeld) { _requestText(); _progressRefHeld = true; }
      if (_progress) _progress.show(pct, label);
    },
    hideProgress: function() {
      // progress.js 内部会在动画完成后通过 deps 释放
      if (_progress) _progress.hide();
    },

    addButton: function(cfg) {
      if (_buttons) _buttons.addButton(cfg);
    },
    removeButton: function(action) {
      if (_buttons) _buttons.removeButton(action);
    },

    registerMode: registerMode,
    requestMode: requestMode,
    releaseMode: releaseMode,
    getActiveMode: getActiveMode
  });
})();
