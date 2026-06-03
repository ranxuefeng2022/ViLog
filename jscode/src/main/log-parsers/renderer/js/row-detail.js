(function () {
  'use strict';

  var panel = document.getElementById('rowDetail');
  var body = panel ? panel.querySelector('.rd-body') : null;
  var _open = false;
  var _lastRow = -1;
  var _scrollRaf = 0;

  function isOpen() { return _open; }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function _layout() {
    if (!panel || !_open) return;
    var br = document.querySelector('.body-row');
    if (!br) return;
    var brRect = br.getBoundingClientRect();
    panel.style.top = Math.round(brRect.top) + 'px';
    panel.style.bottom = '0px';
  }

  function _close() {
    if (!_open) return;
    _open = false;
    panel.classList.remove('open');
    document.getElementById('detailBtn').classList.remove('tb-btn-on');
    var tw = document.querySelector('.table-wrap');
    if (tw) tw.style.paddingRight = '';
    if (typeof drawCanvas === 'function') drawCanvas();
  }

  function toggle() {
    if (_open) { _close(); return; }
    var lp = document.getElementById('linkPanel');
    if (lp && lp.classList.contains('open') && lp.classList.contains('lp-mode-bottom')) {
      return;
    }
    _open = true;
    panel.classList.add('open');
    document.getElementById('detailBtn').classList.add('tb-btn-on');
    _lastRow = -1;
    _layout();
    var tw = document.querySelector('.table-wrap');
    if (tw) tw.style.paddingRight = '280px';
    var row = (typeof hoverR !== 'undefined' && hoverR >= 0) ? hoverR : -1;
    if (row >= 0) render(row);
    else clear();
    if (typeof drawCanvas === 'function') drawCanvas();
  }

  function clear() {
    if (body) body.innerHTML = '<div class="rd-empty">悬停行查看详情</div>';
  }

  function render(rowIdx) {
    if (!body || !_open) return;
    if (rowIdx === _lastRow) return;
    _lastRow = rowIdx;
    var loc = (typeof tabLocal !== 'undefined') ? tabLocal[activeTab] : null;
    if (!loc || !loc.rows || !loc.rows[rowIdx]) {
      body.innerHTML = '<div class="rd-empty">行 ' + (rowIdx + 1) + ' 未加载</div>';
      return;
    }
    var rd = loc.rows[rowIdx];
    var t = (typeof TABS !== 'undefined') ? TABS[activeTab] : null;
    if (!t) return;
    var headers = t.headers || [];
    var keys = t.keys || [];
    var html = '';
    for (var i = 0; i < headers.length; i++) {
      var val = (rd[i] !== undefined && rd[i] !== null) ? String(rd[i]) : '';
      var display = val === '' ? '—' : esc(val);
      var valCls = val === '' ? 'rd-val rd-val-empty' : 'rd-val';
      if (val && keys[i] === 'ts_raw') {
        var n = Number(rd[i]);
        if (!isNaN(n)) { display = esc((n / 1000000).toFixed(6)); valCls = 'rd-val'; }
      }
      html += '<div class="rd-field">'
        + '<span class="rd-label">' + esc(headers[i]) + '</span>'
        + '<span class="' + valCls + '">' + display + '</span>'
        + '</div>';
    }
    if (!html) html = '<div class="rd-empty">无数据</div>';
    body.innerHTML = html;
  }

  function onHoverRow(rowIdx) {
    if (!_open) return;
    if (rowIdx >= 0) render(rowIdx);
    else clear();
  }

  function getTopVisibleRow() {
    if (typeof container === 'undefined' || !container) return -1;
    var ss = (typeof scrollScale !== 'undefined') ? scrollScale : ROW_H;
    var row = Math.floor(container.scrollTop / ss);
    var total = (typeof totalRows !== 'undefined') ? totalRows : 0;
    if (row >= total) row = total - 1;
    return row >= 0 ? row : -1;
  }

  function onScroll() {
    if (!_open) return;
    if (!_scrollRaf) {
      _scrollRaf = requestAnimationFrame(function () {
        _scrollRaf = 0;
        var row = getTopVisibleRow();
        if (row >= 0) render(row);
      });
    }
  }

  if (typeof container !== 'undefined' && container) {
    container.addEventListener('scroll', onScroll);
  }

  window.addEventListener('resize', function () { _layout(); });

  window.App = window.App || {};
  window.App.RowDetail = {
    toggle: toggle,
    close: _close,
    isOpen: isOpen,
    onHoverRow: onHoverRow,
    adjustHeight: _layout
  };
})();
