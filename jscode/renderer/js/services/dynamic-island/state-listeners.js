/**
 * Dynamic Island — State Listeners 子模块
 * 所有文字展示均为临时（过滤/搜索/进度），不再持久显示文件信息
 * 完成展示后 3 秒自动恢复表情模式
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  window.App._DI.createStateListeners = function(deps) {
    var _infoEl = deps && deps.infoEl || null;
    var _addUnsub = deps && deps.addUnsub || null;
    var _requestText = deps && deps.requestText || function() {};
    var _releaseText = deps && deps.releaseText || function() {};

    var _restoreTimer = null;

    function _setText(txt) {
      if (_infoEl) _infoEl.textContent = txt || '';
    }

    // 请求文本模式 + 显示文字，3 秒后自动释放 → 恢复表情
    function _showTemp(txt) {
      _requestText();
      _setText(txt);
      if (_restoreTimer) clearTimeout(_restoreTimer);
      _restoreTimer = setTimeout(function() {
        _restoreTimer = null;
        _releaseText();
        _setText('');
      }, 3000);
    }

    // 立即释放 → 表情模式
    function _restoreFace() {
      if (_restoreTimer) { clearTimeout(_restoreTimer); _restoreTimer = null; }
      _releaseText();
      _setText('');
    }

    function init() {
      var State = window.App && window.App.State;
      var EventBus = window.App && window.App.EventBus;
      if (!State) return;

      // 文件/行变化 → 不显示文件信息，直接到表情模式
      _addUnsub(State.on('fileHeaders', function() {
        _restoreFace();
      }));

      _addUnsub(State.on('originalLines', function() {
        _restoreFace();
      }));

      _addUnsub(State.on('isFiltering', function(val) {
        if (val) {
          _showTemp('过滤中...');
        } else {
          _restoreFace();
        }
      }));

      if (EventBus) {
        _addUnsub(EventBus.on('filter:applied', function(data) {
          if (!_infoEl) return;
          var total = (State.get('originalLines') || []).length;
          var filtered = data && data.results ? data.results.length : 0;
          _showTemp('已过滤 ' + filtered.toLocaleString() + ' / ' + total.toLocaleString() + ' 行');
        }));
      }

      _addUnsub(State.on('totalMatchCount', function(val) {
        if (!_infoEl) return;
        if (val > 0) {
          _showTemp((State.get('searchKeyword') || '') + ': ' + val + ' 个结果');
        } else {
          _restoreFace();
        }
      }));

      _addUnsub(State.on('searchKeyword', function(val) {
        if (_infoEl && (!val || val.trim() === '')) _restoreFace();
      }));

      // 初始化：直接到表情模式
      _restoreFace();
    }

    function destroy() {
      _restoreFace();
      _infoEl = null;
    }

    // updateFileNameDisplay 保留供 toast 的 skipRestore=false 路径调用
    function updateFileNameDisplay() {
      _restoreFace();
    }

    return { init: init, destroy: destroy, updateFileNameDisplay: updateFileNameDisplay };
  };
})();
