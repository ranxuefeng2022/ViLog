/**
 * 过滤关键词历史补丁 v2
 * 覆盖 original-script.js 中的相关函数，使用新的 FilterKeywordHistory 模块
 *
 * 功能：
 * P0-1: 统一新旧两套逻辑（捕获阶段事件拦截）
 * P0-2: textarea 标签化显示（chip UI）
 * P1-1: 过滤预设
 * P1-3: NOT 排除语义（在 original-script.js 中处理）
 * P2-1: 共现推荐
 * P2-2: 匹配行数预览
 * P2-3: 清理工具
 * P3:   正则模式
 */

(function() {
  'use strict';

  console.log('[FilterKeywordHistory Patch] 应用补丁...');

  // 等待 FilterKeywordHistory 模块加载完成
  function waitForModule() {
    return new Promise(function(resolve) {
      var check = function() {
        if (window.App && window.App.FilterKeywordHistory) {
          resolve(window.App.FilterKeywordHistory);
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  // 获取原始函数
  var originalAddToFilterHistory = typeof addToFilterHistory === 'function' ? addToFilterHistory : null;
  var originalShowFilterSuggestions = typeof showFilterSuggestions === 'function' ? showFilterSuggestions : null;
  var originalHandleFilterKeyDown = typeof handleFilterKeyDown === 'function' ? handleFilterKeyDown : null;

  // 延迟绑定：openDialogUnified 在模块加载后才可用
  var _openDialogUnified = null;

  // ========== 覆写数据源函数 ==========

  window.getAppFilterHistory = function() {
    if (window.App && window.App.FilterKeywordHistory) {
      return window.App.FilterKeywordHistory.getKeywords();
    }
    return [];
  };

  // ========== 覆盖 addToFilterHistory ==========

  window.addToFilterHistory = async function(filterText) {
    if (originalAddToFilterHistory) {
      originalAddToFilterHistory(filterText);
    }
    try {
      var mod = await waitForModule();
      await mod.addKeywordsFromInput(filterText);
    } catch (e) {
      console.error('[FilterKeywordHistory Patch] 保存关键词失败:', e);
    }
  };

  // ========== 覆盖 showFilterSuggestions（工具栏下拉） ==========

  window.showFilterSuggestions = function() {
    try {
      var mod = window.App && window.App.FilterKeywordHistory;
      if (!mod) {
        if (originalShowFilterSuggestions) originalShowFilterSuggestions();
        return;
      }
      var filterBox = document.getElementById('filterBox');
      var filterSuggestions = document.getElementById('filterSuggestions');
      if (!filterBox || !filterSuggestions) return;

      var count = mod.showSuggestions(filterBox, filterSuggestions, function(selectedKeyword) {
        if (typeof applyFilter === 'function') applyFilter();
      });
      window.filterSuggestionsVisible = count > 0;
    } catch (e) {
      console.error('[FilterKeywordHistory Patch] 显示建议失败:', e);
      if (originalShowFilterSuggestions) originalShowFilterSuggestions();
    }
  };

  // ========== 覆盖 handleFilterKeyDown（工具栏键盘导航） ==========

  window.handleFilterKeyDown = function(e) {
    if (!window.filterSuggestionsVisible) {
      if (originalHandleFilterKeyDown) return originalHandleFilterKeyDown(e);
      return;
    }
    var filterSuggestions = document.getElementById('filterSuggestions');
    if (!filterSuggestions) return;
    var mod = window.App && window.App.FilterKeywordHistory;
    if (!mod) {
      if (originalHandleFilterKeyDown) return originalHandleFilterKeyDown(e);
      return;
    }
    window.selectedSuggestionIndex = mod.handleKeyDown(
      e, filterSuggestions,
      window.selectedSuggestionIndex != null ? window.selectedSuggestionIndex : -1
    );
  };

  // ========== P0-1: 统一新旧逻辑 — 拦截 'f' 键和 expandFilterBtn ==========

  // 拦截 'f' 键（阻止 original-script.js:5647 的旧处理器）
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'f') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (_openDialogUnified) {
        _openDialogUnified();
      } else {
        // 模块尚未加载，回退到旧逻辑
        var filterDialog = document.getElementById('filterDialog');
        if (filterDialog) filterDialog.classList.add('visible');
      }
    }
  }, true); // 捕获阶段

  // ========== 对话框搜索输入框事件绑定（核心逻辑） ==========

  waitForModule().then(function(module) {
    console.log('[FilterKeywordHistory Patch] 绑定搜索输入框事件...');

    var searchInput = document.getElementById('filterHistorySearchInput');
    var historyList = document.getElementById('filterHistoryList');
    var suggestions = document.getElementById('filterHistorySuggestions');
    var textarea = document.getElementById('filterDialogTextarea');
    var chipContainer = document.getElementById('filterChipContainer');
    var chipBar = document.getElementById('filterChipBar');
    var regexToggle = document.getElementById('regexModeToggle');

    if (!searchInput || !historyList || !suggestions || !textarea || !chipContainer) {
      console.warn('[FilterKeywordHistory Patch] 未找到 DOM 元素');
      return;
    }

    var currentMatchedItems = [];
    var highlightedIndex = -1;
    var selectedIndices = {};
    var currentQuery = '';
    var regexMode = false;

    // 拖选状态
    var dragSelecting = false;
    var dragStartIndex = -1;
    var dragMode = 'add'; // 'add' 或 'remove'，取决于起始项是否已选中

    // ========== P0-1: 统一 — 拦截 textarea 的 focus/keydown ==========

    // 拦截 textarea focus（阻止 original-script.js:12820 的旧处理器）
    textarea.addEventListener('focus', function(e) {
      e.stopImmediatePropagation();
      // 将焦点转移到搜索输入框，统一走 patch 逻辑
      setTimeout(function() { searchInput.focus(); }, 0);
    }, true);

    // 拦截 textarea keydown（阻止 original-script.js:12767 的旧处理器）
    textarea.addEventListener('keydown', function(e) {
      e.stopImmediatePropagation();
      // 所有键盘操作路由到搜索输入框
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        applyAndClose();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
      }
    }, true);

    // 拦截 expandFilterBtn click
    var expandBtn = document.getElementById('expandFilterBtn');
    if (expandBtn) {
      expandBtn.addEventListener('click', function(e) {
        e.stopImmediatePropagation();
        e.preventDefault();
        openDialogUnified();
      }, true);
    }

    // 拦截 closeFilterDialog click
    var closeBtn = document.getElementById('closeFilterDialog');
    if (closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.stopImmediatePropagation();
        e.preventDefault();
        closeDialog();
      }, true);
    }

    // 拦截 clearFilterDialog click
    var clearBtn = document.getElementById('clearFilterDialog');
    if (clearBtn) {
      clearBtn.addEventListener('click', function(e) {
        e.stopImmediatePropagation();
        e.preventDefault();
        textarea.value = '';
        var filterBox = document.getElementById('filterBox');
        if (filterBox) filterBox.value = '';
        if (typeof cleanFilterData === 'function') cleanFilterData();
        if (typeof renderLogLines === 'function') renderLogLines();
        if (typeof updateVisibleLines === 'function') updateVisibleLines();
        renderChips();
      }, true);
    }

    // 拦截 applyFilterDialog click
    var applyBtn = document.getElementById('applyFilterDialog');
    if (applyBtn) {
      applyBtn.addEventListener('click', function(e) {
        e.stopImmediatePropagation();
        e.preventDefault();
        applyAndClose();
      }, true);
    }

    // 拦截对话框背景点击关闭
    var filterDialog = document.getElementById('filterDialog');
    if (filterDialog) {
      filterDialog.addEventListener('click', function(e) {
        if (e.target === filterDialog) {
          e.stopImmediatePropagation();
          closeDialog();
        }
      }, true);
    }

    // ========== 对话框打开/关闭/应用 ==========

    function openDialogUnified() {
      var filterBox = document.getElementById('filterBox');
      // 保留已有的关键词选择，仅在首次打开时从 filterBox 同步
      if (!textarea._initialized) {
        if (filterBox) textarea.value = filterBox.value || '';
        textarea._initialized = true;
      }

      filterDialog.classList.add('visible');
      renderChips();

      // 重新加载关键词（即使失败也显示已有数据）
      module.loadKeywords().then(function() {
        showHistoryList();
      }).catch(function() {
        showHistoryList();
      });
    }

    function showHistoryList() {
      var allKeywords = module.getKeywords();
      var matched = module.fuzzyMatch('', allKeywords);
      renderHistoryList(matched);
      // 清除旧代码可能设置的 inline display 样式，用 class 控制
      suggestions.style.display = '';
      suggestions.classList.remove('hidden');

      searchInput.value = '';
      currentQuery = '';
      searchInput.focus();
    }

    // 暴露给外层 'f' 键拦截器
    _openDialogUnified = openDialogUnified;

    function closeDialog() {
      filterDialog.classList.remove('visible');
      suggestions.classList.add('hidden');
      suggestions.style.display = '';
      highlightedIndex = -1;
      selectedIndices = {};
      if (textarea.value.trim() === '' && typeof cleanFilterData === 'function') {
        cleanFilterData();
      }
    }

    function applyAndClose() {
      var filterBox = document.getElementById('filterBox');
      if (filterBox) filterBox.value = textarea.value;
      if (typeof applyFilter === 'function') applyFilter();
      closeDialog();
    }

    // 统一聚焦搜索框
    function refocusSearch() {
      setTimeout(function() { searchInput.focus(); }, 0);
    }

    // ========== P0-2: Chip 标签化显示 ==========

    function renderChips() {
      chipContainer.innerHTML = '';
      var value = textarea.value.trim();

      if (!value) {
        if (chipBar) chipBar.classList.remove('visible');
        return;
      }

      if (chipBar) chipBar.classList.add('visible');

      // 一键清除按钮
      var clearAll = document.createElement('span');
      clearAll.className = 'chip-clear-all';
      clearAll.textContent = '✕';
      clearAll.title = '清除所有关键词';
      clearAll.addEventListener('click', function(e) {
        e.stopPropagation();
        textarea.value = '';
        renderChips();
        refreshInTextareaState();
        refocusSearch();
      });
      chipContainer.appendChild(clearAll);

      var parts = value.split(/(?<!\\)\|/);
      for (var i = 0; i < parts.length; i++) {
        var text = parts[i].trim().replace(/\\\|/g, '|');
        if (!text) continue;

        var isNegative = text.charAt(0) === '-' || text.charAt(0) === '!';
        var chip = document.createElement('span');
        chip.className = 'filter-chip ' + (isNegative ? 'negative' : 'positive');
        chip.dataset.index = i;
        chip.innerHTML = '<span class="chip-text">' + escapeHtml(text) + '</span>';
        chipContainer.appendChild(chip);
      }
    }

    chipContainer.addEventListener('click', function(e) {
      // 点击 chip 直接取消选中（带气泡戳破动画）
      var chip = e.target.closest('.filter-chip');
      if (chip) {
        var index = parseInt(chip.dataset.index);
        // 获取chip位置用于粒子效果
        var rect = chip.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var bgColor = getComputedStyle(chip).background || 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';

        // 触发戳破动画
        chip.classList.add('chip-popping');
        // 生成碎片粒子
        spawnPopParticles(cx, cy, bgColor, chipContainer.parentElement);

        setTimeout(function() {
          removeKeywordFromTextareaByIndex(index);
          refocusSearch();
        }, 200);
      } else if (e.target.classList.contains('chip-clear-all')) {
        refocusSearch();
      }
    });

    // 气泡戳破粒子效果
    function spawnPopParticles(cx, cy, bgColor, parentEl) {
      var particleCount = 8;
      for (var i = 0; i < particleCount; i++) {
        var p = document.createElement('span');
        p.className = 'chip-pop-particle';
        var angle = (Math.PI * 2 / particleCount) * i + (Math.random() - 0.5) * 0.5;
        var dist = 20 + Math.random() * 30;
        var dx = Math.cos(angle) * dist;
        var dy = Math.sin(angle) * dist;
        var size = 3 + Math.random() * 4;
        p.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;width:' + size + 'px;height:' + size + 'px;'
          + '--dx:' + dx + 'px;--dy:' + dy + 'px;'
          + 'background:' + (i % 2 === 0 ? '#4facfe' : '#00f2fe') + ';';
        parentEl.appendChild(p);
        // 动画结束后移除粒子
        (function(el) {
          setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
        })(p);
      }
    }

    function removeKeywordFromTextareaByIndex(index) {
      var value = textarea.value.trim();
      if (!value) return;
      var parts = value.split(/(?<!\\)\|/);
      if (index >= 0 && index < parts.length) {
        parts.splice(index, 1);
        textarea.value = parts.join('|');
        renderChips();
        refreshInTextareaState();
      }
    }

    // ========== 关键词追加/移除/切换 ==========

    function isKeywordInTextarea(keyword) {
      var current = textarea.value.trim();
      if (!current) return false;
      var parts = current.split(/(?<!\\)\|/);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].trim() === keyword) return true;
      }
      return false;
    }

    function appendToTextarea(keyword) {
      if (isKeywordInTextarea(keyword)) return false;
      var current = textarea.value.trim();
      textarea.value = !current ? keyword : current + '|' + keyword;
      renderChips();
      return true;
    }

    function removeFromTextarea(keyword) {
      var current = textarea.value.trim();
      if (!current) return false;
      var parts = current.split(/(?<!\\)\|/);
      var newParts = [];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].trim() !== keyword) newParts.push(parts[i].trim());
      }
      textarea.value = newParts.join('|');
      renderChips();
      return true;
    }

    function toggleKeywordInTextarea(keyword) {
      if (isKeywordInTextarea(keyword)) {
        removeFromTextarea(keyword);
        return 'removed';
      } else {
        appendToTextarea(keyword);
        return 'added';
      }
    }

    function batchAppendToTextarea(kws) {
      var appended = 0;
      for (var i = 0; i < kws.length; i++) {
        if (appendToTextarea(kws[i])) appended++;
      }
      return appended;
    }

    // ========== 匹配高亮 ==========

    function highlightMatchText(keyword, query) {
      if (!query) return escapeHtml(keyword);
      var lowerK = keyword.toLowerCase();
      var lowerQ = query.toLowerCase();

      // 正则模式：整段高亮
      if (regexMode) {
        try {
          var re = new RegExp('(' + lowerQ + ')', 'i');
          return escapeHtml(keyword).replace(re, '<span class="match-highlight">$1</span>');
        } catch(e) { return escapeHtml(keyword); }
      }

      var idx = lowerK.indexOf(lowerQ);
      if (idx !== -1) {
        return escapeHtml(keyword.substring(0, idx))
          + '<span class="match-highlight">' + escapeHtml(keyword.substring(idx, idx + query.length)) + '</span>'
          + escapeHtml(keyword.substring(idx + query.length));
      }

      var result = '';
      var qi = 0;
      for (var ci = 0; ci < keyword.length && qi < lowerQ.length; ci++) {
        if (lowerK[ci] === lowerQ[qi]) {
          result += '<span class="match-highlight">' + escapeHtml(keyword[ci]) + '</span>';
          qi++;
        } else {
          result += escapeHtml(keyword[ci]);
        }
      }
      if (ci < keyword.length) result += escapeHtml(keyword.substring(ci));
      return result;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ========== 删除关键词 ==========

    function deleteKeyword(keyword) {
      if (module.removeKeyword) module.removeKeyword(keyword);
      var idx = currentMatchedItems.indexOf(keyword);
      if (idx !== -1) currentMatchedItems.splice(idx, 1);
      delete selectedIndices[idx];
      renderHistoryList(currentMatchedItems);
    }

    // ========== 高亮状态管理 ==========

    function updateHighlight() {
      var items = historyList.querySelectorAll('.filter-history-item');
      for (var i = 0; i < items.length; i++) {
        if (i === highlightedIndex) {
          items[i].classList.add('selected');
          items[i].scrollIntoView({ block: 'nearest' });
        } else {
          items[i].classList.remove('selected');
        }
      }
    }

    function selectHighlighted() {
      if (highlightedIndex >= 0 && highlightedIndex < currentMatchedItems.length) {
        toggleKeywordInTextarea(currentMatchedItems[highlightedIndex]);
        refreshInTextareaState();
        refocusSearch();
        return true;
      }
      return false;
    }

    function refreshInTextareaState() {
      var elements = historyList.querySelectorAll('.filter-history-item');
      for (var i = 0; i < elements.length; i++) {
        var kw = currentMatchedItems[i];
        if (!kw) continue;
        if (isKeywordInTextarea(kw)) {
          elements[i].classList.add('in-textarea');
        } else {
          elements[i].classList.remove('in-textarea');
        }
      }
    }

    // ========== 渲染列表 ==========

    function renderHistoryList(items) {
      currentMatchedItems = items || [];
      highlightedIndex = -1;

      if (!currentMatchedItems || currentMatchedItems.length === 0) {
        historyList.innerHTML = '<div class="filter-history-item">无匹配结果</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < currentMatchedItems.length; i++) {
        var kw = currentMatchedItems[i];
        var isSelected = selectedIndices[i] ? ' multi-selected' : '';
        var inTextarea = isKeywordInTextarea(kw) ? ' in-textarea' : '';
        html += '<div class="filter-history-item' + isSelected + inTextarea + '" data-index="' + i + '">'
          + '<div class="keyword">' + highlightMatchText(kw, currentQuery) + '</div>'
          + '<span class="keyword-delete-btn" data-keyword="' + escapeHtml(kw) + '" title="删除">&times;</span>'
          + '</div>';
      }
      historyList.innerHTML = html;

      // 绑定拖选事件
      var elements = historyList.querySelectorAll('.filter-history-item');
      for (var j = 0; j < elements.length; j++) {
        (function(el, idx) {
          el.addEventListener('mousedown', function(e) {
            if (e.target.classList.contains('keyword-delete-btn')) return;
            if (e.button !== 0) return; // 只响应左键
            e.preventDefault(); // 阻止选中文字
            dragSelecting = true;
            dragStartIndex = idx;
            // 判断起始项是否已选中，决定拖选模式
            dragMode = isKeywordInTextarea(currentMatchedItems[idx]) ? 'remove' : 'add';
            selectedIndices = {};
            selectedIndices[idx] = true;
            updateDragVisual();
          });

          el.addEventListener('mouseenter', function() {
            if (!dragSelecting) return;
            // 扩展选区
            selectedIndices = {};
            var from = Math.min(dragStartIndex, idx);
            var to = Math.max(dragStartIndex, idx);
            for (var r = from; r <= to; r++) {
              selectedIndices[r] = true;
            }
            updateDragVisual();
          });

          el.addEventListener('click', function(e) {
            if (e.target.classList.contains('keyword-delete-btn')) return;
            // 单击：toggle 单个关键词（多选已由 mouseup 处理）
            if (Object.keys(selectedIndices).length === 0) {
              toggleKeywordInTextarea(currentMatchedItems[idx]);
              refreshInTextareaState();
              refocusSearch();
            }
          });
        })(elements[j], j);
      }

      // mouseup 结束拖选并确认
      document.addEventListener('mouseup', function() {
        if (dragSelecting) {
          dragSelecting = false;
          var count = Object.keys(selectedIndices).length;
          if (count > 1) {
            // 多选拖选
            var dragItems = [];
            for (var k in selectedIndices) {
              var ki = parseInt(k);
              if (ki < currentMatchedItems.length) dragItems.push(currentMatchedItems[ki]);
            }
            if (dragMode === 'add') {
              batchAppendToTextarea(dragItems);
            } else {
              for (var di = 0; di < dragItems.length; di++) {
                removeFromTextarea(dragItems[di]);
              }
            }
            refreshInTextareaState();
            selectedIndices = {};
            var allItems = historyList.querySelectorAll('.filter-history-item');
            for (var m = 0; m < allItems.length; m++) {
              allItems[m].classList.remove('multi-selected');
              allItems[m].classList.remove('drag-remove');
            }
            refocusSearch();
          } else {
            // 单选：清空 selectedIndices，留给 click 处理
            selectedIndices = {};
            var allItems2 = historyList.querySelectorAll('.filter-history-item');
            for (var n = 0; n < allItems2.length; n++) {
              allItems2[n].classList.remove('multi-selected');
              allItems2[n].classList.remove('drag-remove');
            }
          }
        }
      });

      // 拖选时的视觉反馈
      function updateDragVisual() {
        var removeClass = dragMode === 'remove';
        var items = historyList.querySelectorAll('.filter-history-item');
        for (var i = 0; i < items.length; i++) {
          if (selectedIndices[i]) {
            items[i].classList.add('multi-selected');
            if (removeClass) items[i].classList.add('drag-remove');
          } else {
            items[i].classList.remove('multi-selected');
            items[i].classList.remove('drag-remove');
          }
        }
      }

      // 删除按钮
      var deleteBtns = historyList.querySelectorAll('.keyword-delete-btn');
      for (var d = 0; d < deleteBtns.length; d++) {
        (function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var kw = btn.dataset.keyword;
            if (kw) deleteKeyword(kw);
            refocusSearch();
          });
        })(deleteBtns[d]);
      }

    }

    // ========== 搜索输入事件 ==========

    searchInput.addEventListener('input', function() {
      currentQuery = searchInput.value.trim();
      var allKeywords = module.getKeywords();
      var matched = regexMode
        ? module.regexMatch(currentQuery, allKeywords)
        : module.fuzzyMatch(currentQuery, allKeywords);
      selectedIndices = {};
      renderHistoryList(matched);
      suggestions.style.display = '';
      suggestions.classList.remove('hidden');
    });

    searchInput.addEventListener('focus', function() {
      currentQuery = searchInput.value.trim();
      var allKeywords = module.getKeywords();
      var matched = regexMode
        ? module.regexMatch(currentQuery, allKeywords)
        : module.fuzzyMatch(currentQuery, allKeywords);
      renderHistoryList(matched);
      suggestions.style.display = '';
      suggestions.classList.remove('hidden');
    });

    // ========== 键盘事件 ==========

    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (searchInput.value.trim() !== '') {
          // 清空搜索内容，保留列表
          searchInput.value = '';
          currentQuery = '';
          var allKeywords = module.getKeywords();
          var matched = module.fuzzyMatch('', allKeywords);
          renderHistoryList(matched);
          highlightedIndex = -1;
        } else {
          // 搜索框已空，关闭对话框
          closeDialog();
        }
        e.stopPropagation();
        return;
      }

      // Tab 补全
      if (e.key === 'Tab') {
        e.preventDefault();
        if (currentMatchedItems.length > 0) {
          var targetIdx = (highlightedIndex >= 0) ? highlightedIndex : 0;
          toggleKeywordInTextarea(currentMatchedItems[targetIdx]);
          searchInput.value = '';
          currentQuery = '';
          var matched = regexMode
            ? module.regexMatch('', module.getKeywords())
            : module.fuzzyMatch('', module.getKeywords());
          renderHistoryList(matched);
          searchInput.focus();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (suggestions.classList.contains('hidden')) {
          currentQuery = searchInput.value.trim();
          var matched = regexMode
            ? module.regexMatch(currentQuery, module.getKeywords())
            : module.fuzzyMatch(currentQuery, module.getKeywords());
          renderHistoryList(matched);
          suggestions.style.display = '';
          suggestions.classList.remove('hidden');
        }
        if (currentMatchedItems.length > 0) {
          highlightedIndex = Math.min(highlightedIndex + 1, currentMatchedItems.length - 1);
          updateHighlight();
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (highlightedIndex > 0) {
          highlightedIndex--;
          updateHighlight();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+Enter: 应用并关闭
          applyAndClose();
          return;
        }
        var hasMulti = Object.keys(selectedIndices).length > 0;
        if (hasMulti) {
          var toAppend = [];
          for (var k in selectedIndices) {
            var ki = parseInt(k);
            if (ki < currentMatchedItems.length) toAppend.push(currentMatchedItems[ki]);
          }
          batchAppendToTextarea(toAppend);
          var allItems = historyList.querySelectorAll('.filter-history-item');
          for (var m = 0; m < allItems.length; m++) allItems[m].classList.remove('multi-selected');
          selectedIndices = {};
          refreshInTextareaState();
          refocusSearch();
        } else if (highlightedIndex >= 0) {
          // 有高亮项：toggle 高亮的关键词
          selectHighlighted();
        } else {
          // 无高亮项：将搜索框文本作为新关键词直接添加
          var rawInput = searchInput.value.trim();
          if (rawInput) {
            // 支持管道符分隔的多关键词输入
            var inputParts = rawInput.split(/(?<!\\)\|/).map(function(s) { return s.replace(/\\\|/g, '|').trim(); }).filter(Boolean);
            var appended = batchAppendToTextarea(inputParts);
            if (appended > 0) {
              // 同时保存到历史
              module.addKeywordsFromInput(rawInput);
              renderChips();
              refreshInTextareaState();
            }
            // 清空搜索框，重新显示历史列表
            searchInput.value = '';
            currentQuery = '';
            var allKeywords = module.getKeywords();
            var matched = module.fuzzyMatch('', allKeywords);
            renderHistoryList(matched);
            refocusSearch();
          } else {
            // 空搜索框 + 无高亮 = 应用过滤
            applyAndClose();
          }
        }
        return;
      }
      e.stopPropagation();
    });

    // ========== P3: 正则模式切换 ==========

    if (regexToggle) {
      regexToggle.addEventListener('click', function() {
        regexMode = !regexMode;
        this.classList.toggle('active', regexMode);
        // 重新搜索
        currentQuery = searchInput.value.trim();
        var allKeywords = module.getKeywords();
        var matched = regexMode
          ? module.regexMatch(currentQuery, allKeywords)
          : module.fuzzyMatch(currentQuery, allKeywords);
        renderHistoryList(matched);
      });
    }

    console.log('[FilterKeywordHistory Patch] 补丁已应用');
  }).catch(function(e) {
    console.error('[FilterKeywordHistory Patch] 初始化失败:', e);
  });

  console.log('[FilterKeywordHistory Patch] 补丁已加载');
})();
