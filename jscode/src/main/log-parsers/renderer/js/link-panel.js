(function () {
  'use strict';

  var lpPanel = document.getElementById('linkPanel');
  var lpTabBar = document.getElementById('lpTabBar');
  var lpContent = document.getElementById('lpContent');

  var FIXED_KEYS = ['source_file']; // only file path is hidden; time columns are shown
  var ROW_H = 32;

  var linkedTabs = {};
  var colSelections = {};
  var timeIndexCache = {};
  var _timeRowMap = {};        // tabIdx → Map<rowIdx, sec> for O(1) lookup
  var lastRowIdx = -1;
  var lastScrollTop = -1;
  var pendingRow = -1;
  var updateRaf = 0;
  var navSeq = 0;
  // Scroll stabilization: debounce rapid updates during scroll
  var _scrollStableTimer = null;
  var SCROLL_DEBOUNCE_MS = 30;
  var _lastRenderRow = -1;
  var _lastKnownHoverRow = -1; // survives mouseleave reset
  // Active tab — always shows both row + column modes
  var _activeTab = -1;

  var panelPosX = null, panelPosY = null;
  var _panelMode = 'bottom'; // 'bottom' | 'right'
  var _rowDetailWasOpen = false;
  var lastMouseX = 0, lastMouseY = 0;

  function _rdWidth() {
    return (window.App && window.App.RowDetail && window.App.RowDetail.isOpen()) ? 280 : 0;
  }

  function syncTablePadding() {
    var tableWrap = document.querySelector('.table-wrap');
    if (!tableWrap) return;
    var rdW = _rdWidth();
    if (!lpPanel.classList.contains('open')) {
      tableWrap.style.paddingBottom = '';
      tableWrap.style.paddingRight = rdW ? rdW + 'px' : '';
      _notifyRowDetail();
      return;
    }
    if (_panelMode === 'right') {
      tableWrap.style.paddingBottom = '';
      var lpRect = lpPanel.getBoundingClientRect();
      var br = document.querySelector('.body-row');
      var brRect = br ? br.getBoundingClientRect() : null;
      if (brRect && lpRect.left < brRect.right) {
        tableWrap.style.paddingRight = (brRect.right - lpRect.left + rdW) + 'px';
      }
    } else {
      tableWrap.style.paddingRight = '';
      var lpRect = lpPanel.getBoundingClientRect();
      var br = document.querySelector('.body-row');
      var brRect = br ? br.getBoundingClientRect() : null;
      if (brRect && lpRect.top < brRect.bottom) {
        tableWrap.style.paddingBottom = (brRect.bottom - lpRect.top) + 'px';
      }
    }
    _notifyRowDetail();
  }

  function _notifyRowDetail() {
    if (window.App && window.App.RowDetail && window.App.RowDetail.adjustHeight) {
      window.App.RowDetail.adjustHeight();
    }
  }

  function setPanelMode(mode) {
    _panelMode = mode;
    var topBar = document.querySelector('.lp-resize-top');
    var leftBar = document.querySelector('.lp-resize-left');
    lpPanel.classList.remove('lp-mode-bottom', 'lp-mode-right');

    if (mode === 'right') {
      lpPanel.classList.add('lp-mode-right');
      lpPanel.style.top = '0px';
      lpPanel.style.left = Math.round(window.innerWidth * 0.5) + 'px';
      lpPanel.style.right = 'auto';
      lpPanel.style.width = Math.round(window.innerWidth * 0.5) + 'px';
      lpPanel.style.height = window.innerHeight + 'px';
      lpPanel.style.bottom = 'auto';
      panelPosX = parseInt(lpPanel.style.left);
      if (topBar) topBar.style.display = 'none';
      if (leftBar) leftBar.style.display = '';
    } else {
      lpPanel.classList.add('lp-mode-bottom');
      lpPanel.style.top = Math.round(window.innerHeight * 0.55) + 'px';
      lpPanel.style.left = '0px';
      lpPanel.style.right = '0px';
      lpPanel.style.width = 'auto';
      lpPanel.style.height = Math.round(window.innerHeight * 0.45) + 'px';
      lpPanel.style.bottom = 'auto';
      panelPosY = parseInt(lpPanel.style.top);
      if (topBar) topBar.style.display = '';
      if (leftBar) leftBar.style.display = 'none';
    }
    syncTablePadding();
  }

  // Eagerly load time indices when a tab is linked
  function preloadTimeIndex(tabIdx) {
    if (timeIndexCache[tabIdx]) return;
    getTimeIndex(tabIdx);
  }

  document.addEventListener('mousemove', function (e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

  // Resize bars: top edge (bottom mode) and left edge (right mode)
  (function() {
    // Top bar for height adjustment (bottom mode)
    var topBar = document.createElement('div');
    topBar.className = 'lp-resize-top';
    topBar.addEventListener('mousedown', function(e) {
      if (_panelMode !== 'bottom') return;
      e.preventDefault(); e.stopPropagation();
      var startY = e.clientY;
      var startTop = lpPanel.getBoundingClientRect().top;
      document.body.style.cursor = 'n-resize';
      document.body.style.userSelect = 'none';
      function onMove(ev) {
        var newTop = startTop + (ev.clientY - startY);
        newTop = Math.max(80, Math.min(window.innerHeight - 120, newTop));
        lpPanel.style.top = newTop + 'px';
        lpPanel.style.height = (window.innerHeight - newTop) + 'px';
        panelPosY = newTop;
        syncTablePadding();
      }
      function onUp() {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        syncTablePadding();
        // Use _lastKnownHoverRow fallback (mouse may be on resize bar, not main canvas)
        var row = (typeof hoverR !== 'undefined' && hoverR >= 0) ? hoverR : _lastKnownHoverRow;
        if (_activeTab >= 0 && row >= 0) {
          _lastRenderRow = -1; lastRowIdx = -1; lastScrollTop = -1;
          pendingRow = row;
          navigateToTime(activeTab, row);
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    lpPanel.insertBefore(topBar, lpPanel.firstChild);

    // Left bar for width adjustment (right mode)
    var leftBar = document.createElement('div');
    leftBar.className = 'lp-resize-left';
    leftBar.style.display = 'none';
    leftBar.addEventListener('mousedown', function(e) {
      if (_panelMode !== 'right') return;
      e.preventDefault(); e.stopPropagation();
      var startX = e.clientX;
      var startLeft = lpPanel.getBoundingClientRect().left;
      document.body.style.cursor = 'w-resize';
      document.body.style.userSelect = 'none';
      function onMove(ev) {
        var newLeft = startLeft + (ev.clientX - startX);
        newLeft = Math.max(200, Math.min(window.innerWidth - 200, newLeft));
        lpPanel.style.left = newLeft + 'px';
        lpPanel.style.width = (window.innerWidth - newLeft) + 'px';
        panelPosX = newLeft;
        syncTablePadding();
      }
      function onUp() {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        syncTablePadding();
        var row = (typeof hoverR !== 'undefined' && hoverR >= 0) ? hoverR : _lastKnownHoverRow;
        if (_activeTab >= 0 && row >= 0) {
          _lastRenderRow = -1; lastRowIdx = -1; lastScrollTop = -1;
          pendingRow = row;
          navigateToTime(activeTab, row);
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    lpPanel.insertBefore(leftBar, lpPanel.firstChild);
  })();

  initWheelScroll();

  function initWheelScroll() {
    // Alt+wheel horizontal scroll on the column canvas
    lpContent.addEventListener('wheel', function (e) {
      if (!e.altKey) return;
      var canvas = e.target.closest('canvas');
      if (!canvas || !canvas.id || canvas.id.indexOf('cmCanvas_') !== 0) return;
      e.preventDefault();
      var dx = e.deltaY;
      canvas._cmScrollLeft = (canvas._cmScrollLeft || 0) + dx;
      var selCols = canvas._cmSelCols || [];
      var colWidths = canvas._cmColWidths;
      var totalColW = CM_RN_W;
      for (var swi = 0; swi < selCols.length; swi++) {
        totalColW += (colWidths ? colWidths[swi] : CM_COL_W);
      }
      var maxSl = Math.max(0, totalColW - (canvas.clientWidth || 300));
      if (canvas._cmScrollLeft < 0) canvas._cmScrollLeft = 0;
      if (canvas._cmScrollLeft > maxSl) canvas._cmScrollLeft = maxSl;
      if (!cmRafMap[canvas.id]) {
        cmRafMap[canvas.id] = requestAnimationFrame(function () {
          cmRafMap[canvas.id] = 0;
          drawCmCanvas(canvas);
        });
      }
    }, { passive: false });
  }

  function closePanel() {
    lpPanel.classList.remove('open');
    syncTablePadding();
    // Restore row detail if it was auto-closed
    if (_rowDetailWasOpen) {
      var db = document.getElementById('detailBtn');
      if (db) db.click();
      _rowDetailWasOpen = false;
    }
    // Unlink all tabs
    linkedTabs = {};
    colSelections = {};
    _activeTab = -1;
    _lastKnownHoverRow = -1;
    timeIndexCache = {};
    _timeRowMap = {};
    if (typeof drawCanvas === 'function') drawCanvas();
  }

  function toggleLinkPanel() {
    if (lpPanel.classList.contains('open')) {
      closePanel();
    } else {
      lpPanel.classList.add('open');
      lpContent.innerHTML = '<div class="lp-empty">点击上方标签选择关联表</div>';
      setPanelMode(_panelMode);
      // Close row detail when opening link panel in bottom mode
      if (_panelMode === 'bottom' && window.App && window.App.RowDetail && window.App.RowDetail.isOpen()) {
        _rowDetailWasOpen = true;
        document.getElementById('detailBtn').click();
      }
      // Pre-warm all time indices and auto-select first available tab
      var firstTab = -1;
      for (var i = 0; i < TABS.length; i++) {
        if (getTimeFieldIdx(i)) {
          preloadTimeIndex(i);
          if (firstTab < 0) firstTab = i;
        }
      }
      buildTabBar();
      if (firstTab >= 0) selectTab(firstTab);
      if (_lastKnownHoverRow < 0) _lastKnownHoverRow = 0;
      onHoverRow(_lastKnownHoverRow);
      lastRowIdx = -1;
    }
  }

  function buildTabBar() {
    var rowCollapsed = lpContent.querySelector('.lp-split-right.lp-split-right-collapsed');
    var colCollapsed = lpContent.querySelector('.lp-split-left.lp-split-left-collapsed');
    // Control buttons on the far left
    var html = ''
      + '<span class="lp-tool-btn" id="lpClose" title="关闭">×</span>'
      + '<span class="lp-tool-btn' + (rowCollapsed ? '' : ' lp-tool-btn-on') + '" id="lpRowBtn" title="行详情">▦</span>'
      + '<span class="lp-tool-btn' + (colCollapsed ? '' : ' lp-tool-btn-on') + '" id="lpColBtn" title="上下文表格">▤</span>'
      + '<span class="lp-tool-btn" id="lpModeBtn" title="切换布局">' + (_panelMode === 'right' ? '⤢' : '⤡') + '</span>'
      + '<span class="lp-tool-btn" id="lpPickBtn" title="选择列">☰</span>'
      + '<span class="lp-tab-sep"></span>';
    // Single dropdown for all tabs
    var activeName = (_activeTab >= 0 && TABS[_activeTab]) ? TABS[_activeTab].name : '选择标签';
    html += '<span class="lp-tab-dd" id="lpTabDd">'
      + '<span class="lp-tab-dd-btn" id="lpTabDdBtn"><span id="lpTabDdLabel">' + esc(activeName) + '</span><span class="lp-arrow">▼</span></span>'
      + '<span class="lp-tab-dd-menu" id="lpTabDdMenu" style="display:none"></span>'
      + '</span>';
    lpTabBar.innerHTML = html;

    // Populate dropdown menu
    var menu = document.getElementById('lpTabDdMenu');
    for (var i = 0; i < TABS.length; i++) {
      if (!getTimeFieldIdx(i)) continue;
      var isActive = !!linkedTabs[i];
      var item = document.createElement('div');
      item.className = 'lp-tab-dd-item' + (isActive ? ' active' : '');
      item.setAttribute('data-tab', i);
      item.innerHTML = esc(TABS[i].name);
      item.addEventListener('click', function () {
        selectTab(parseInt(this.getAttribute('data-tab')));
        menu.style.display = 'none';
      });
      menu.appendChild(item);
    }

    // Dropdown toggle
    var ddBtn = document.getElementById('lpTabDdBtn');
    var ddMenu = document.getElementById('lpTabDdMenu');
    if (ddBtn && ddMenu) {
      ddBtn.onclick = function (e) {
        e.stopPropagation();
        ddMenu.style.display = ddMenu.style.display === 'block' ? 'none' : 'block';
        return false;
      };
      document.addEventListener('click', function (e) {
        if (ddMenu.style.display === 'block' && !ddBtn.contains(e.target)) {
          ddMenu.style.display = 'none';
        }
      });
      // Wheel on tab label to switch tabs, no wrap (onwheel avoids listener stacking)
      ddBtn.onwheel = function (e) {
        var wheelTabs = [];
        for (var wi = 0; wi < TABS.length; wi++) {
          if (getTimeFieldIdx(wi)) wheelTabs.push(wi);
        }
        if (wheelTabs.length <= 1) return;
        e.preventDefault();
        e.stopPropagation();
        var curIdx = wheelTabs.indexOf(_activeTab);
        if (curIdx < 0) { selectTab(wheelTabs[0]); return; }
        var nextIdx = e.deltaY > 0 ? curIdx + 1 : curIdx - 1;
        if (nextIdx < 0 || nextIdx >= wheelTabs.length) return;
        selectTab(wheelTabs[nextIdx]);
      };
    }

    var modeBtn = document.getElementById('lpModeBtn');
    if (modeBtn) modeBtn.addEventListener('click', function () {
      var newMode = _panelMode === 'bottom' ? 'right' : 'bottom';
      // Close row detail when entering bottom mode
      if (newMode === 'bottom' && window.App && window.App.RowDetail && window.App.RowDetail.isOpen()) {
        _rowDetailWasOpen = true;
        document.getElementById('detailBtn').click();
      }
      // Restore row detail when entering right mode
      if (newMode === 'right' && _rowDetailWasOpen) {
        document.getElementById('detailBtn').click();
        _rowDetailWasOpen = false;
      }
      setPanelMode(newMode);
      buildTabBar();
      // Re-render after mode switch
      var row = (typeof hoverR !== 'undefined' && hoverR >= 0) ? hoverR : _lastKnownHoverRow;
      if (_activeTab >= 0 && row >= 0) {
        _lastRenderRow = -1; lastRowIdx = -1; lastScrollTop = -1;
        pendingRow = row;
        navigateToTime(activeTab, row);
      }
    });

    var closeBtn = document.getElementById('lpClose');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      closePanel();
    });

    // Section toggle buttons
    var rowBtn = document.getElementById('lpRowBtn');
    var colBtn = document.getElementById('lpColBtn');
    if (rowBtn) rowBtn.addEventListener('click', function() { toggleSection('right'); });
    if (colBtn) colBtn.addEventListener('click', function() { toggleSection('left'); });

    // Column picker button
    var pickBtn = document.getElementById('lpPickBtn');
    if (pickBtn) pickBtn.addEventListener('click', function() {
      if (_activeTab < 0) return;
      var rect = pickBtn.getBoundingClientRect();
      _showColPicker(_activeTab, { getBoundingClientRect: function() { return { left: rect.left, bottom: rect.bottom }; } });
    });
  }

  function selectTab(idx) {
    linkedTabs = {};
    linkedTabs[idx] = true;
    if (!colSelections[idx] || colSelections[idx].length === 0) {
      colSelections[idx] = getAllDataCols(idx);
    }
    preloadTimeIndex(idx);
    _activeTab = idx;
    buildTabBar();
    showActiveContent();
    lastRowIdx = -1;
    _lastRenderRow = -1;
    lastScrollTop = -1;
    if (_scrollStableTimer) { clearTimeout(_scrollStableTimer); _scrollStableTimer = null; }
    var row = (typeof hoverR !== 'undefined' && hoverR >= 0) ? hoverR : (_lastKnownHoverRow >= 0 ? _lastKnownHoverRow : 0);
    if (row >= 0) {
      pendingRow = row;
      requestAnimationFrame(function () {
        setTimeout(function () {
          if (pendingRow >= 0) navigateToTime(activeTab, pendingRow);
        }, 0);
      });
    }
  }

  function toggleSection(side) {
    var split = lpContent.querySelector('.lp-split');
    if (!split) return;
    var left = split.querySelector('.lp-split-left');
    var right = split.querySelector('.lp-split-right');

    if (side === 'left' && left) {
      left.classList.toggle('lp-split-left-collapsed');
    } else if (side === 'right' && right) {
      right.classList.toggle('lp-split-right-collapsed');
    }

    // Update fill
    var leftCol = left && left.classList.contains('lp-split-left-collapsed');
    var rightCol = right && right.classList.contains('lp-split-right-collapsed');
    if (leftCol && !rightCol) right.classList.add('lp-split-fill');
    else right.classList.remove('lp-split-fill');
    if (rightCol && !leftCol) left.classList.add('lp-split-fill');
    else left.classList.remove('lp-split-fill');

    // Refresh tab bar to update arrow indicators
    buildTabBar();
  }

  // Return all data column indices (excluding fixed prefix keys)
  function getAllDataCols(tabIdx) {
    var keys = TABS[tabIdx].keys || [];
    var fixedSet = {};
    for (var fi = 0; fi < FIXED_KEYS.length; fi++) fixedSet[FIXED_KEYS[fi]] = 1;
    var cols = [];
    for (var i = 0; i < keys.length; i++) {
      if (!fixedSet[keys[i]]) cols.push(i);
    }
    return cols;
  }

  // ---- Split layout: column table (left) + row details (right) side by side ----
  function showActiveContent() {
    if (_activeTab < 0) {
      lpContent.innerHTML = '<div class="lp-empty">点击上方标签选择关联表</div>';
      return;
    }
    if (!lpContent.querySelector('.lp-split')) {
      lpContent.innerHTML = ''
        + '<div class="lp-split">'
        + '  <div class="lp-split-left">'
        + '    <div class="lp-col-body lp-table-body"></div>'
        + '  </div>'
        + '  <div class="lp-split-divider"></div>'
        + '  <div class="lp-split-right">'
        + '    <div class="lp-row-body lp-table-body"></div>'
        + '  </div>'
        + '</div>';
    }
    // Clear only row body; col body is managed by renderColMode
    var rowBody = lpContent.querySelector('.lp-row-body');
    if (rowBody) rowBody.innerHTML = '';
    lastRowIdx = -1;
    _lastRenderRow = -1;
  }

  function _showColPicker(tabIdx, anchor) {
    var rect = anchor.getBoundingClientRect();
    showColPickerAt(tabIdx, rect.left, rect.bottom);
  }

  function showColPickerAt(tabIdx, screenX, screenY) {
    var existing = document.getElementById('lpColPicker');
    if (existing) existing.remove();
    var t = TABS[tabIdx];
    var keys = t.keys || [];
    if (!colSelections[tabIdx]) colSelections[tabIdx] = getAllDataCols(tabIdx);
    var sel = colSelections[tabIdx] || [];
    var colSet = {};
    for (var ci = 0; ci < sel.length; ci++) colSet[sel[ci]] = true;
    var html = '<div class="lp-cp-actions">'
      + '<span class="lp-cp-btn" data-action="all">全选</span>'
      + '<span class="lp-cp-btn" data-action="none">全不选</span>'
      + '</div>';
    var fixedSet = {};
    for (var fi = 0; fi < FIXED_KEYS.length; fi++) fixedSet[FIXED_KEYS[fi]] = 1;
    for (var i = 0; i < keys.length; i++) {
      if (fixedSet[keys[i]]) continue;
      var checked = colSet[i] ? ' checked' : '';
      html += '<label class="lp-cp-item"><input type="checkbox" data-ci="' + i + '"' + checked + '>' + esc(t.headers[i]) + '</label>';
    }
    var popup = document.createElement('div');
    popup.id = 'lpColPicker';
    popup.className = 'lp-col-picker lp-col-picker-fixed';
    popup.innerHTML = html;
    popup.style.left = screenX + 'px';
    popup.style.top = screenY + 'px';
    document.body.appendChild(popup);

    var popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth) popup.style.left = (screenX - popupRect.width) + 'px';
    if (popupRect.bottom > window.innerHeight) popup.style.top = (screenY - popupRect.height) + 'px';

    function applySelection() {
      var newCols = [];
      var checks = popup.querySelectorAll('.lp-cp-item input');
      for (var ci2 = 0; ci2 < checks.length; ci2++) {
        if (checks[ci2].checked) newCols.push(parseInt(checks[ci2].getAttribute('data-ci')));
      }
      colSelections[tabIdx] = newCols;
      showActiveContent();
      lastRowIdx = -1;
      _lastRenderRow = -1;
      // Force immediate re-render — bypass debounce
      if (_scrollStableTimer) { clearTimeout(_scrollStableTimer); _scrollStableTimer = null; }
      var row = (typeof hoverR !== 'undefined' && hoverR >= 0) ? hoverR : _lastKnownHoverRow;
      if (row >= 0) {
        pendingRow = row;
        navigateToTime(activeTab, row);
      }
    }

    var btns = popup.querySelectorAll('.lp-cp-btn');
    for (var bi = 0; bi < btns.length; bi++) {
      btns[bi].addEventListener('click', function () {
        var action = this.getAttribute('data-action');
        var cbs = popup.querySelectorAll('.lp-cp-item input');
        for (var cbi = 0; cbi < cbs.length; cbi++) cbs[cbi].checked = action === 'all';
        applySelection();
      });
    }

    var inputs = popup.querySelectorAll('.lp-cp-item input');
    for (var ii = 0; ii < inputs.length; ii++) {
      inputs[ii].addEventListener('change', function () {
        applySelection();
      });
    }

    setTimeout(function () {
      function closeOnLeave(e) {
        if (!popup.contains(e.target) && !(e.target.id === 'lpPickBtn')) {
          popup.remove();
          lpTabBar.removeEventListener('mouseenter', closeOnLeave);
        }
      }
      lpTabBar.addEventListener('mouseenter', closeOnLeave);
    }, 0);
  }

  var _timeIndexPromises = {};  // tabIdx → Promise (prevents duplicate concurrent requests)

  function getTimeIndex(tabIdx) {
    if (timeIndexCache[tabIdx]) return Promise.resolve(timeIndexCache[tabIdx]);
    if (_timeIndexPromises[tabIdx]) return _timeIndexPromises[tabIdx];

    var promise = DA.getTimeIndex(tabIdx).then(function (res) {
      if (!res || !res.success || !res.index) return null;
      var idx = res.index;
      // Batch parseTime to avoid blocking UI on large indices (>50K entries)
      if (idx.length < 5000) {
        for (var i = 0; i < idx.length; i++) {
          idx[i].sec = parseTime(idx[i].time);
        }
        timeIndexCache[tabIdx] = idx;
        _buildTimeRowMap(tabIdx, idx);
        _timeIndexPromises[tabIdx] = null;
        return idx;
      }
      return new Promise(function(resolveParse) {
        var BATCH = 5000;
        var pos = 0;
        var total = idx.length;
        function nextBatch() {
          var start = performance.now();
          var end = Math.min(pos + BATCH, total);
          for (var i = pos; i < end; i++) {
            idx[i].sec = parseTime(idx[i].time);
          }
          pos = end;
          if (pos < total) {
            var elapsed = performance.now() - start;
            setTimeout(nextBatch, elapsed < 8 ? 0 : Math.max(0, Math.floor(16 - elapsed)));
          } else {
            timeIndexCache[tabIdx] = idx;
            _buildTimeRowMap(tabIdx, idx);
            _timeIndexPromises[tabIdx] = null;
            resolveParse(idx);
          }
        }
        nextBatch();
      });
    }).catch(function () { _timeIndexPromises[tabIdx] = null; return null; });

    _timeIndexPromises[tabIdx] = promise;
    return promise;
  }

  function binarySearchTime(index, targetTime) {
    if (!index || index.length === 0) return -1;
    var target = parseTime(targetTime);
    if (target === null) return index[0] ? index[0].row : -1;
    var lo = 0, hi = index.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      var mv = index[mid].sec;
      if (mv === null || mv < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) {
      var dv = index[lo].sec;
      var pv = index[lo - 1].sec;
      if (dv !== null && pv !== null && Math.abs(pv - target) <= Math.abs(dv - target)) lo--;
    }
    return index[lo].row;
  }

  // Time fields in priority order for matching
  var TIME_FIELDS = ['timestamp', 'ts_raw'];

  function parseTime(s) {
    if (!s && s !== 0) return null;
    var str = String(s);
    // Check for formatted date-time string (android_time)
    var m = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
    if (m) {
      var sec = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
      if (m[7]) sec += parseInt(m[7].padEnd(3, '0').substring(0, 3), 10) / 1000;
      return sec;
    }
    var n = Number(s);
    return isNaN(n) ? null : n;
  }

  function _buildTimeRowMap(tabIdx, index) {
    var rm = new Map();
    for (var i = 0; i < index.length; i++) {
      rm.set(index[i].row, index[i]);
    }
    _timeRowMap[tabIdx] = rm;
  }

  // Find which time field a tab has, in priority order
  function getTimeFieldIdx(tabIdx) {
    var keys = TABS[tabIdx].keys || [];
    for (var ti = 0; ti < TIME_FIELDS.length; ti++) {
      var idx = keys.indexOf(TIME_FIELDS[ti]);
      if (idx >= 0) return { idx: idx, field: TIME_FIELDS[ti] };
    }
    return null;
  }

  // Get normalized time value (seconds) for a row
  function getRowTime(tabIdx, rowIdx) {
    var loc = tabLocal[tabIdx];
    var info = getTimeFieldIdx(tabIdx);
    if (!info) return null;
    if (loc && loc.rows && loc.rows[rowIdx]) {
      var v = loc.rows[rowIdx][info.idx];
      if (v !== undefined && v !== null && v !== '') {
        if (info.field === 'ts_raw') return String(Number(v) / 1000000);
        return String(v);
      }
    }
    // O(1) lookup via row→entry Map (built alongside timeIndexCache)
    var rm = _timeRowMap[tabIdx];
    if (rm) {
      var entry = rm.get(rowIdx);
      if (entry) return entry.time;
    }
    // Fallback: linear scan (should not happen after cache warm)
    var idx = timeIndexCache[tabIdx];
    if (idx) {
      for (var i = 0; i < idx.length; i++) {
        if (idx[i].row === rowIdx) return idx[i].time;
      }
    }
    return null;
  }

  function fetchRow(tabIdx, rowIdx) {
    return DA.getRow(tabIdx, rowIdx).then(function(res) {
      if (!res || !res.success) return null;
      return res.row;
    });
  }

  function fetchRowsRange(tabIdx, from, to) {
    return DA.getRowsRange(tabIdx, from, to).then(function(res) {
      if (!res || !res.success) return null;
      return res;
    });
  }

  function _getHoverPixelOffset() {
    if (typeof hoverR === 'undefined' || hoverR < 0) return -1;
    var st = typeof container !== 'undefined' ? container.scrollTop : 0;
    var ss = typeof scrollScale !== 'undefined' ? scrollScale : ROW_H;
    var fv = Math.floor(st / ss);
    var subOff = (st / ss - fv) * ROW_H;
    var y = (hoverR - fv) * ROW_H - subOff + ROW_H / 2;
    return y;
  }

  function getHoverRowPixelInMain() {
    if (typeof hoverR === 'undefined' || hoverR < 0) return -1;
    var st = typeof container !== 'undefined' ? container.scrollTop : 0;
    var ss = typeof scrollScale !== 'undefined' ? scrollScale : ROW_H;
    var fv = Math.floor(st / ss);
    var subOff = (st / ss - fv) * ROW_H;
    return (hoverR - fv) * ROW_H - subOff;
  }

  function navigateToTime(sourceTabIdx, rowIdx) {
    var seq = ++navSeq;
    lastRowIdx = rowIdx;
    if (!lpPanel.classList.contains('open')) return;
    var tabIdx = _activeTab;
    if (tabIdx < 0) return;

    var timeValue = getRowTime(sourceTabIdx, rowIdx);
    if (!timeValue && !timeIndexCache[sourceTabIdx]) {
      getTimeIndex(sourceTabIdx).then(function () {
        if (seq === navSeq) navigateToTime(sourceTabIdx, rowIdx);
      });
      return;
    }
    // Fallback: if the default row has no time, use first entry from cached index
    if (!timeValue && timeIndexCache[sourceTabIdx] && timeIndexCache[sourceTabIdx].length > 0) {
      timeValue = timeIndexCache[sourceTabIdx][0].time;
    }
    if (!timeValue) return;

    var rowBody = lpContent.querySelector('.lp-row-body');
    var colBody = lpContent.querySelector('.lp-col-body');

    getTimeIndex(tabIdx).then(function (index) {
      if (seq !== navSeq) return;
      if (!index || index.length === 0) {
        if (rowBody && rowBody.innerHTML.indexOf('lp-field') < 0) {
          rowBody.innerHTML = '<div class="lp-empty">无时间索引</div>';
        }
        return;
      }
      var targetRow = binarySearchTime(index, timeValue);
      if (targetRow < 0) {
        if (rowBody && rowBody.innerHTML.indexOf('lp-field') < 0) {
          rowBody.innerHTML = '<div class="lp-empty">无匹配</div>';
        }
        return;
      }

      // Always render row details; skip col table if user is exploring freely
      fetchRow(tabIdx, targetRow).then(function (row) {
        if (seq !== navSeq) return;
        if (row && rowBody) renderRowMode(rowBody, tabIdx, row);
        else if (rowBody && !rowBody.querySelector('canvas')) rowBody.innerHTML = '<div class="lp-empty">无数据</div>';
      });
      if (colBody) renderColMode(colBody, tabIdx, targetRow, seq);
    });
  }

  function renderRowMode(body, tabIdx, row) {
    body.style.overflowY = 'auto';
    var t = TABS[tabIdx];
    var keys = t.keys || [];
    var headers = t.headers;
    var fixedSet = {};
    for (var fi = 0; fi < FIXED_KEYS.length; fi++) fixedSet[FIXED_KEYS[fi]] = 1;
    var html = '';
    for (var i = 0; i < headers.length; i++) {
      var key = keys[i] || '';
      var isFixed = fixedSet[key] ? 1 : 0;
      var val = row[i] !== undefined && row[i] !== null ? String(row[i]) : '';
      var valCls = val === '' ? 'lp-field-val lp-field-val-empty' : 'lp-field-val';
      var display = val === '' ? '—' : esc(val);
      var rowCls = isFixed ? 'lp-field lp-field-fixed' : 'lp-field';
      html += '<div class="' + rowCls + '">'
        + '<span class="lp-field-label">' + esc(headers[i]) + '</span>'
        + '<span class="' + valCls + '">' + display + '</span>'
        + '</div>';
    }
    if (!html) html = '<div class="lp-empty">无可见列</div>';
    body.innerHTML = html;
  }

  var cmRafMap = {};
  var CM_COL_W = 120;
  var CM_ROW_H = 32;
  var CM_RN_W = 40;
  var CM_HDR_H = 28;
  var CM_FONT = '12px "SF Mono","Consolas","Courier New",monospace';
  var CM_HDR_FONT = '11px -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif';
  var _cmMeasureCanvas = null;

  function measureColWidths(headers, selCols, rows) {
    if (!_cmMeasureCanvas) _cmMeasureCanvas = document.createElement('canvas');
    var ctx = _cmMeasureCanvas.getContext('2d');
    var widths = [];
    for (var ci = 0; ci < selCols.length; ci++) {
      ctx.font = CM_HDR_FONT;
      var hw = ctx.measureText(headers[selCols[ci]] || '').width + 16;
      ctx.font = CM_FONT;
      var maxVW = 0;
      var sampleLen = Math.min(rows.length, 30);
      for (var ri = 0; ri < sampleLen; ri++) {
        var row = rows[ri] || [];
        var val = row[selCols[ci]] !== undefined && row[selCols[ci]] !== null ? String(row[selCols[ci]]) : '';
        var vw = ctx.measureText(val || '—').width + 16;
        if (vw > maxVW) maxVW = vw;
      }
      var w = Math.max(hw, maxVW, 60);
      widths.push(w);
    }
    return widths;
  }

  // Default column mode height; adapts to available space when panel is resized
  var CM_MAX_ROWS = 40; // cap at 40 rows to limit buffer fetch size

  function getCmBodyHeight(body) {
    var maxH = CM_HDR_H + CM_MAX_ROWS * CM_ROW_H; // 24 + 1280 = 1304px
    var panelH = lpPanel.clientHeight;
    if (panelH < 80) return maxH;
    var tabBar = document.querySelector('.lp-tab-bar');
    var tabBarH = tabBar ? tabBar.offsetHeight : 32;
    var contentH = panelH - tabBarH - 1; // minus border
    if (contentH < 80) return maxH;
    if (contentH > 60) return Math.min(maxH, Math.max(CM_HDR_H + 3 * CM_ROW_H, contentH));
    return maxH;
  }

  // Track in-flight fetches per tab to avoid overlapping requests
  var _fetchingRange = {};  // tabIdx → {from, to, promise}

  function renderColMode(body, tabIdx, targetRow, seq) {
    body.style.overflowY = 'hidden';
    var t = TABS[tabIdx];
    var _keys = t.keys || [];
    var headers = t.headers;
    var selCols = colSelections[tabIdx] || [];
    if (selCols.length === 0) {
      body.innerHTML = '<div class="lp-empty">右键标签选择列…</div>';
      return;
    }

    var bodyH = getCmBodyHeight(body);
    var visibleRows = Math.min(CM_MAX_ROWS, Math.max(5, Math.floor((bodyH - CM_HDR_H) / CM_ROW_H)));
    var halfVisible = Math.floor((visibleRows - 1) / 2);
    var bufferRows = visibleRows * 5; // plenty of context above/below the matched row
    var targetY = CM_HDR_H + halfVisible * CM_ROW_H;

    var aboveCount = halfVisible + bufferRows;
    var belowCount = (visibleRows - halfVisible - 1) + bufferRows;
    var from = targetRow - aboveCount;
    var to = targetRow + belowCount;
    if (from < 0) { to += -from; from = 0; }
    if (to >= t.count) { from -= (to - t.count + 1); to = t.count - 1; if (from < 0) from = 0; }

    var canvasId = 'cmCanvas_' + tabIdx;
    var canvas = document.getElementById(canvasId);

    var dpr = window.devicePixelRatio || 1;
    var cw = (body.parentElement && body.parentElement.clientWidth) || body.clientWidth || 300;
    var newLogicalW = Math.ceil(cw * dpr);
    var newLogicalH = Math.ceil(bodyH * dpr);
    var needResize = false;
    if (canvas) {
      needResize = (canvas.width !== newLogicalW || canvas.height !== newLogicalH);
      if (needResize) {
        canvas.width = newLogicalW;
        canvas.height = newLogicalH;
        canvas._cmColWidths = null; // force re-measure on resize
      }
      canvas.style.width = cw + 'px';
      canvas.style.height = bodyH + 'px';
    }

    // Detect column selection change
    var colsChanged = false;
    if (canvas && canvas._cmSelCols) {
      if (canvas._cmSelCols.length !== selCols.length) colsChanged = true;
      else for (var ci = 0; ci < selCols.length; ci++) {
        if (canvas._cmSelCols[ci] !== selCols[ci]) { colsChanged = true; break; }
      }
    }

    // Column change with loaded data: just remeasure and redraw, no fetch needed
    if (colsChanged && canvas && canvas._cmData) {
      canvas._cmSelCols = selCols;
      canvas._cmColWidths = measureColWidths(headers, selCols, canvas._cmData.rows);
      canvas._cmTargetRow = targetRow;
      canvas._cmTargetY = targetY;
      canvas.dataset.targetRow = targetRow;
      canvas.dataset.seq = seq;
      if (!cmRafMap[canvasId]) {
        cmRafMap[canvasId] = requestAnimationFrame(function () {
          cmRafMap[canvasId] = 0;
          drawCmCanvas(canvas);
        });
      }
      return;
    }

    if (!needResize && !colsChanged && canvas && canvas._cmData) {
      var oldFrom = canvas._cmFrom;
      var oldTo = oldFrom + canvas._cmData.rows.length - 1;
      var margin = Math.floor((to - from) * 0.2);
      if (from >= oldFrom - margin && to <= oldTo + margin) {
        canvas._cmTargetRow = targetRow;
        canvas._cmTargetY = targetY;
        canvas.dataset.targetRow = targetRow;
        canvas.dataset.seq = seq;
        if (!cmRafMap[canvasId]) {
          cmRafMap[canvasId] = requestAnimationFrame(function () {
            cmRafMap[canvasId] = 0;
            drawCmCanvas(canvas);
          });
        }
        return;
      }
    }

    // Check if there's an in-flight fetch that covers this range
    var inflight = _fetchingRange[tabIdx];
    if (!needResize && canvas && inflight && from >= inflight.from && to <= inflight.to) {
      canvas._cmTargetRow = targetRow;
      canvas._cmTargetY = targetY;
      canvas.dataset.targetRow = targetRow;
      canvas.dataset.seq = seq;
      inflight.promise.then(function() {
        if (parseInt(canvas.dataset.seq) === seq) {
          if (!cmRafMap[canvasId]) {
            cmRafMap[canvasId] = requestAnimationFrame(function () {
              cmRafMap[canvasId] = 0;
              drawCmCanvas(canvas);
            });
          }
        }
      });
      return;
    }

    // Create canvas if needed; hide other canvases (from previous tabs)
    if (!canvas) {
      body.innerHTML = '';
      canvas = document.createElement('canvas');
      canvas.id = canvasId;
      canvas.style.display = 'block';
      body.appendChild(canvas);
    }
    // Hide sibling canvases from other tabs (they share the same body)
    var allCanvases = body.querySelectorAll('canvas');
    for (var ac = 0; ac < allCanvases.length; ac++) {
      allCanvases[ac].style.display = allCanvases[ac].id === canvasId ? 'block' : 'none';
    }

    canvas.dataset.tabIdx = tabIdx;
    canvas.dataset.selCols = selCols.join(',');
    canvas.dataset.from = from;
    canvas.dataset.to = to;
    canvas.dataset.targetRow = targetRow;
    canvas.dataset.seq = seq;
    canvas.dataset.headers = headers.join('\x00');
    canvas.dataset.totalRows = visibleRows;
    if (needResize) canvas._cmColWidths = null;

    // Keep showing old data during fetch if we have it
    if (!needResize && canvas._cmData) {
      canvas._cmPendingRow = targetRow;
    }

    var fetchPromise = fetchRowsRange(tabIdx, from, to).then(function (res) {
      if (parseInt(canvas.dataset.seq) !== seq) return;
      if (!res || !res.rows || res.rows.length === 0) {
        body.innerHTML = '<div class="lp-empty">无数据</div>';
        return;
      }
      canvas._cmData = res;
      canvas._cmSelCols = selCols;
      canvas._cmTargetRow = targetRow;
      canvas._cmTargetY = targetY;
      canvas._cmFrom = res.from;
      canvas._cmHeaders = headers;
      canvas._cmScrollLeft = canvas._cmScrollLeft || 0;
      if (needResize || !canvas._cmColWidths) {
        canvas._cmColWidths = measureColWidths(headers, selCols, res.rows);
      }
      // Post-render: correct canvas dimensions if DOM layout wasn't ready earlier
      var finalCw = (body.parentElement && body.parentElement.clientWidth) || body.clientWidth || 300;
      var finalCh = getCmBodyHeight(body);
      var finalDpr = window.devicePixelRatio || 1;
      var finalLw = Math.ceil(finalCw * finalDpr);
      var finalLh = Math.ceil(finalCh * finalDpr);
      var remeasure = false;
      if (canvas.width !== finalLw || canvas.height !== finalLh) {
        canvas.width = finalLw;
        canvas.height = finalLh;
        canvas.style.width = finalCw + 'px';
        canvas.style.height = finalCh + 'px';
        // Recalculate centering for new height
        var newVis = Math.min(CM_MAX_ROWS, Math.max(5, Math.floor((finalCh - CM_HDR_H) / CM_ROW_H)));
        canvas._cmTargetY = CM_HDR_H + Math.floor((newVis - 1) / 2) * CM_ROW_H;
        remeasure = true;
      }
      if (remeasure || !canvas._cmColWidths) {
        canvas._cmColWidths = measureColWidths(headers, selCols, res.rows);
      }
      canvas._cmPendingRow = -1;
      drawCmCanvas(canvas);
    });

    _fetchingRange[tabIdx] = { from: from, to: to, promise: fetchPromise };
  }

  function drawCmCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.width / dpr;
    var ch = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    var data = canvas._cmData;
    if (!data || !data.rows) {
      // Show subtle loading state if data was cleared but fetch is pending
      if (canvas._cmPendingRow >= 0) {
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = '#ccc';
        ctx.font = '13px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('加载中...', cw / 2, ch / 2);
      }
      return;
    }
    var selCols = canvas._cmSelCols;
    var targetRow = canvas._cmTargetRow;
    var targetY = canvas._cmTargetY;
    var from = data.from;
    var headers = canvas._cmHeaders;
    var sl = canvas._cmScrollLeft || 0;
    var rowH = CM_ROW_H;
    var rnW = CM_RN_W;
    var hdrH = CM_HDR_H;
    var targetLocalIdx = targetRow - from;
    var st = 0;
    if (targetY >= 0 && targetLocalIdx >= 0 && targetLocalIdx < data.rows.length) {
      st = Math.max(0, hdrH + targetLocalIdx * rowH - targetY);
    }
    canvas._cmScrollTop = st;
    var colWidths = canvas._cmColWidths;
    var totalColW = rnW;
    var colX = [];
    for (var xi = 0; xi < selCols.length; xi++) {
      colX.push(totalColW);
      totalColW += (colWidths ? colWidths[xi] : CM_COL_W);
    }

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, hdrH);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, hdrH, cw, ch - hdrH);

    var firstCol = 0;
    var lastCol = selCols.length - 1;
    for (var fci = 0; fci < selCols.length; fci++) {
      if (colX[fci] + (colWidths ? colWidths[fci] : CM_COL_W) - sl >= 0) { firstCol = fci; break; }
    }
    for (var lci = selCols.length - 1; lci >= 0; lci--) {
      if (colX[lci] - sl <= cw) { lastCol = lci; break; }
    }
    var firstRow = Math.max(0, Math.floor(st / rowH));
    var lastRow = Math.min(data.rows.length - 1, Math.ceil((st + ch - hdrH) / rowH));

    ctx.font = CM_FONT;
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, hdrH, cw, ch - hdrH);
    ctx.clip();
    for (var ri = firstRow; ri <= lastRow; ri++) {
      var absRow = from + ri;
      var isTarget = absRow === targetRow;
      var ry = hdrH + ri * rowH - st;

      if (isTarget) {
        ctx.fillStyle = 'rgba(0,122,255,0.08)';
        ctx.fillRect(0, ry, cw, rowH);
      }

      var row = data.rows[ri] || [];
      for (var ci2 = firstCol; ci2 <= lastCol; ci2++) {
        var colW2 = colWidths ? colWidths[ci2] : CM_COL_W;
        var cx2 = colX[ci2] - sl;
        if (cx2 + colW2 < 0 || cx2 > cw) continue;
        var colIdx = selCols[ci2];
        var rawVal = row[colIdx];
        var val = rawVal !== undefined && rawVal !== null ? String(rawVal) : '';
        // Format ts_raw as seconds with decimal: 411389424 → 411.389424
        var tabKeys = TABS[canvas.dataset.tabIdx] ? TABS[canvas.dataset.tabIdx].keys : null;
        if (val && tabKeys && tabKeys[colIdx] === 'ts_raw') {
          var n = Number(rawVal);
          if (!isNaN(n)) val = (n / 1000000).toFixed(6);
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx2, ry, colW2, rowH);
        ctx.clip();
        ctx.fillStyle = isTarget ? '#007AFF' : '#1D1D1F';
        if (isTarget) ctx.font = 'bold ' + CM_FONT;
        else ctx.font = CM_FONT;
        ctx.fillText(val || '—', cx2 + 4, ry + rowH / 2);
        ctx.restore();
      }

      // Fixed row number column — drawn AFTER data cells so it covers overflow
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, ry, rnW, rowH);
      ctx.clip();
      ctx.fillStyle = isTarget ? '#E5F0FF' : '#fff';
      ctx.fillRect(0, ry, rnW, rowH);
      ctx.fillStyle = isTarget ? '#007AFF' : '#86868B';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.fillText(String(absRow + 1), rnW - 6, ry + rowH / 2);
      ctx.textAlign = 'left';
      ctx.restore();

      if (!isTarget) {
        ctx.fillStyle = 'rgba(0,0,0,0.03)';
        ctx.fillRect(0, ry + rowH - 1, cw, 1);
      }
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    for (var ci3 = 0; ci3 <= selCols.length; ci3++) {
      var lx = ci3 < selCols.length ? colX[ci3] - sl : totalColW - sl;
      if (lx > rnW && lx < cw) {
        ctx.fillRect(lx - 1, hdrH, 1, ch - hdrH);
      }
    }

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, hdrH);
    ctx.font = CM_HDR_FONT;
    ctx.textBaseline = 'top';
    for (var ci = firstCol; ci <= lastCol; ci++) {
      var colW = colWidths ? colWidths[ci] : CM_COL_W;
      var cx = colX[ci] - sl;
      if (cx + colW < 0 || cx > cw) continue;
      var hdrText = headers[selCols[ci]] || '';
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, 0, colW, hdrH);
      ctx.clip();
      ctx.fillStyle = '#86868B';
      ctx.fillText(hdrText, cx + 4, 6);
      ctx.restore();
    }
    // Row number header drawn AFTER column headers to cover overflow
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, rnW, hdrH);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rnW, hdrH);
    ctx.fillStyle = '#86868B';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('#', rnW - 6, 6);
    ctx.textAlign = 'left';
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, hdrH - 1, cw, 1);

    // Fixed row number column divider line
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(rnW - 1, 0, 1, ch);
  }

  function _highlightTargetRow(body, targetRow) {
    var canvas = body.querySelector('canvas');
    if (canvas && canvas._cmData) {
      if (canvas._cmTargetRow === targetRow) return;
      canvas._cmTargetRow = targetRow;
      if (!cmRafMap[canvas.id]) {
        cmRafMap[canvas.id] = requestAnimationFrame(function () {
          cmRafMap[canvas.id] = 0;
          drawCmCanvas(canvas);
        });
      }
      return;
    }
    var grid = body.querySelector('.lp-cm-grid');
    if (!grid) return;
    var gf = parseInt(grid.dataset.from) || 0;
    var colCount = grid.querySelectorAll('.lp-cm-hdr').length;
    if (colCount === 0) return;
    var targetIdx = targetRow - gf;
    if (targetIdx < 0) return;
    var prevTarget = grid.querySelector('.lp-cm-target');
    if (prevTarget) {
      var prevIdx = Array.prototype.indexOf.call(grid.children, prevTarget) - colCount;
      if (Math.floor(prevIdx / colCount) === targetIdx) return;
      prevTarget.classList.remove('lp-cm-target', 'lp-cm-val-target');
      var siblings = grid.children;
      for (var pi = prevIdx; pi < prevIdx + colCount && pi + colCount < siblings.length; pi++) {
        siblings[pi + colCount].classList.remove('lp-cm-target', 'lp-cm-val-target');
      }
    }
    var base = colCount + targetIdx * colCount;
    var children = grid.children;
    for (var ci = 0; ci < colCount && base + ci < children.length; ci++) {
      var cell = children[base + ci];
      cell.classList.add('lp-cm-target');
      if (ci > 0) cell.classList.add('lp-cm-val-target');
    }
  }

  function onHoverRow(rowIdx) {
    if (!lpPanel.classList.contains('open')) return;
    if (rowIdx >= 0) _lastKnownHoverRow = rowIdx;
    if (rowIdx < 0) {
      lastRowIdx = -1;
      _lastRenderRow = -1;
      return;
    }

    // Skip if row hasn't changed and scroll hasn't moved
    if (rowIdx === lastRowIdx) {
      var curST = typeof container !== 'undefined' ? container.scrollTop : 0;
      if (curST === lastScrollTop) return;
    }
    lastScrollTop = typeof container !== 'undefined' ? container.scrollTop : 0;
    lastRowIdx = rowIdx;

    // During rapid scroll: debounce to reduce flicker and IPC churn.
    // When scroll stops for SCROLL_DEBOUNCE_MS, render the final position.
    if (_scrollStableTimer) clearTimeout(_scrollStableTimer);
    _scrollStableTimer = setTimeout(function () {
      _scrollStableTimer = null;
      pendingRow = rowIdx;
      if (_lastRenderRow !== pendingRow) {
        _lastRenderRow = pendingRow;
        navigateToTime(activeTab, pendingRow);
      }
    }, SCROLL_DEBOUNCE_MS);

    // Also do an immediate lightweight update via RAF for responsiveness,
    // but only if data is already cached (fast path — no fetch needed)
    if (!updateRaf) {
      updateRaf = requestAnimationFrame(function () {
        updateRaf = 0;
        // If debounce timer is still running (user is scrolling), skip the
        // heavyweight navigate — the debounced call will handle it
        if (_scrollStableTimer) return;
        pendingRow = rowIdx;
        if (_lastRenderRow !== pendingRow) {
          _lastRenderRow = pendingRow;
          navigateToTime(activeTab, pendingRow);
        }
      });
    }
  }

  function onScroll() {
    if (!lpPanel.classList.contains('open')) return;
    if (_activeTab < 0) return;
    if (typeof hoverR === 'undefined' || hoverR < 0) return;
    _lastRenderRow = -1;
    var row = (typeof hoverR !== 'undefined' && hoverR >= 0) ? hoverR : _lastKnownHoverRow;
    if (row >= 0) onHoverRow(row);
  }

  window.App = window.App || {};
  window.App.LinkPanel = {
    toggle: toggleLinkPanel,
    onHoverRow: onHoverRow,
    onScroll: onScroll,
    isOpen: function () { return lpPanel.classList.contains('open'); }
  };
})();
