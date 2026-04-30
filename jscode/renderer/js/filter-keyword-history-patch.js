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

  // 获取原始函数（仅用于 showFilterSuggestions 和 handleFilterKeyDown 的降级回退）
  var originalShowFilterSuggestions = typeof showFilterSuggestions === 'function' ? showFilterSuggestions : null;
  var originalHandleFilterKeyDown = typeof handleFilterKeyDown === 'function' ? handleFilterKeyDown : null;

  // 延迟绑定：openDialogUnified 在模块加载后才可用
  var _openDialogUnified = null;

  // ========== 禁用旧代码的 showFilterHistory（防止用旧 filterHistory 数组渲染） ==========
  // original-script.js 中有两处 showFilterHistory 定义（第 5794 行和第 12705 行），
  // 以及第 12820 行 textarea focus 监听器调用它。
  // 这些都会用旧的 filterHistory 数组（从 localStorage 加载，含组合关键词如 "aaa|bbb"）
  // 而非从 filter-keywords.json 文件加载的拆分关键词。
  // 这里将 showFilterHistory 替换为空函数，阻止旧代码渲染错误数据。
  // patch 的 openDialogUnified 中会通过 module.loadKeywords() 从文件加载后渲染。
  window.showFilterHistory = function() {};

  // ========== 覆写数据源函数 ==========

  window.getAppFilterHistory = function() {
    if (window.App && window.App.FilterKeywordHistory) {
      return window.App.FilterKeywordHistory.getKeywords();
    }
    return [];
  };

  // ========== 覆盖 addToFilterHistory ==========

  window.addToFilterHistory = async function(filterText) {
    // 不再调用旧的 originalAddToFilterHistory（它会写 localStorage），
    // 直接通过 FilterKeywordHistory 模块写入 JSON 文件。
    try {
      var mod = window.App && window.App.FilterKeywordHistory;
      if (mod && mod.addKeywordsFromInput) {
        await mod.addKeywordsFromInput(filterText);
      }
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
    var searchStatusEl = document.getElementById('filterSearchStatus');

    if (!searchInput || !historyList || !suggestions || !textarea || !chipContainer) {
      console.warn('[FilterKeywordHistory Patch] 未找到 DOM 元素');
      return;
    }

    var currentMatchedItems = [];
    var highlightedIndex = -1;
    var selectedIndices = {};
    var currentQuery = '';
    var groupMode = false;  // 分组模式切换

    // 拖选状态
    var dragSelecting = false;
    var dragStartIndex = -1;
    var dragMode = 'add';

    // ========== 虚拟列表配置 ==========
    var ITEM_HEIGHT = 32;   // 每个关键词项高度(px)
    var BUFFER_SIZE = 10;   // 上下缓冲区项数

    // ========== 优化3: getListHeight 缓存（仅在 resize 时失效） ==========
    var _cachedListHeight = null;

    /**
     * 动态计算列表可见区域高度（带缓存）
     * 对话框整体占 66vh，减去 header(28px)、searchRow(约40px)、padding(18px)、suggestions padding(8px)
     */
    function getListHeight() {
      if (_cachedListHeight !== null) return _cachedListHeight;
      var viewportH = window.innerHeight;
      var dialogH = Math.floor(viewportH * 0.66);
      // header: 28px, search-row: ~40px, padding: 10+8=18px, suggestions padding: 4+4=8px
      var reserved = 28 + 40 + 18 + 8;
      _cachedListHeight = Math.max(200, dialogH - reserved);
      return _cachedListHeight;
    }
    var virtualContainer = null; // 撑高度的容器
    var virtualContent = null;   // 实际渲染的容器
    var virtualListReady = false; // 是否已初始化虚拟列表

    // 初始化虚拟列表 DOM 结构（只执行一次）
    function initVirtualList() {
      if (virtualListReady) {
        // 已初始化，只清空内容并重置滚动位置
        virtualContainer.style.height = '0px';
        virtualContent.innerHTML = '';
        historyList.scrollTop = 0;
        return;
      }
      virtualListReady = true;
      // 分组模式销毁了 DOM 后重建，需要重新绑定事件
      _delegatedBound = false;

      // 不设置内联 height/maxHeight，由 CSS flex:1 控制容器高度，避免与 flex 布局冲突
      historyList.style.overflowY = 'auto';
      historyList.style.overflowX = 'hidden';
      historyList.style.position = 'relative';
      historyList.innerHTML = '';

      // 撑高度的容器
      virtualContainer = document.createElement('div');
      virtualContainer.style.cssText = 'position:relative;width:100%;';
      historyList.appendChild(virtualContainer);

      // 实际渲染内容的容器
      virtualContent = document.createElement('div');
      virtualContent.style.cssText = 'position:absolute;top:0;left:0;right:0;';
      virtualContainer.appendChild(virtualContent);

      // 事件委托（只绑定一次）
      bindDelegatedEvents();

      // 滚动事件（rAF 节流，避免 60Hz 频繁触发 innerHTML 重建）
      var scrollRafId = 0;
      historyList.addEventListener('scroll', function() {
        if (scrollRafId) return;
        scrollRafId = requestAnimationFrame(function() {
          scrollRafId = 0;
          renderVirtualItems();
        });
      }, { passive: true });

      // 窗口大小变化时重新渲染（rAF 节流，同时失效 getListHeight 缓存）
      var resizeRafId = 0;
      window.addEventListener('resize', function() {
        _cachedListHeight = null;
        if (resizeRafId) return;
        resizeRafId = requestAnimationFrame(function() {
          resizeRafId = 0;
          renderVirtualItems();
        });
      });
    }

    // ========== 事件委托（只绑定一次，替代逐元素绑定） ==========
    var _delegatedBound = false;
    function bindDelegatedEvents() {
      if (_delegatedBound) return;
      _delegatedBound = true;

      virtualContent.addEventListener('mousedown', function(e) {
        if (e.target.classList.contains('keyword-delete-btn')) return;
        if (e.button !== 0) return;
        var item = e.target.closest('.filter-history-item');
        if (!item) return;
        e.preventDefault();
        var idx = parseInt(item.dataset.index, 10);
        if (isNaN(idx)) return;
        mouseDownActive = true;
        dragStartIndex = idx;
        dragMode = isKeywordInTextarea(currentMatchedItems[idx]) ? 'remove' : 'add';
        selectedIndices = {};
        pendingClickIdx = idx;
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
      });

      virtualContent.addEventListener('click', function(e) {
        // 删除按钮
        var delBtn = e.target.closest('.keyword-delete-btn');
        if (delBtn) {
          e.stopPropagation();
          var kw = delBtn.dataset.keyword;
          if (kw) deleteKeyword(kw);
          refocusSearch();
          return;
        }
        // 关键词项点击
        var item = e.target.closest('.filter-history-item');
        if (!item) return;
        e.stopPropagation();
        var idx = parseInt(item.dataset.index, 10);
        if (isNaN(idx)) return;
        if (pendingClickIdx >= 0 && pendingClickIdx === idx) {
          pendingClickIdx = -1;
          toggleKeywordInTextarea(currentMatchedItems[idx]);
          searchInput.value = '';
          currentQuery = '';
          doSearch();
          refocusSearch();
        }
      });
    }

    // 渲染可见区域的虚拟项
    function renderVirtualItems() {
      if (!virtualContent || !virtualContainer) return;
      var totalItems = currentMatchedItems.length;
      if (totalItems === 0) {
        virtualContainer.style.height = '0px';
        virtualContent.innerHTML = '<div class="filter-history-item" style="position:relative;">无匹配结果</div>';
        return;
      }

      var scroller = historyList;
      var scrollTop = scroller.scrollTop;
      var viewHeight = scroller.clientHeight || getListHeight();

      // 计算可见范围
      var startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE);
      var endIdx = Math.min(totalItems, Math.ceil((scrollTop + viewHeight) / ITEM_HEIGHT) + BUFFER_SIZE);

      // 撑总高度
      virtualContainer.style.height = (totalItems * ITEM_HEIGHT) + 'px';
      // 内容区偏移
      virtualContent.style.top = (startIdx * ITEM_HEIGHT) + 'px';

      // 只渲染可见部分
      var html = '';
      for (var i = startIdx; i < endIdx; i++) {
        var kw = currentMatchedItems[i];
        var isSelected = selectedIndices[i] ? ' multi-selected' : '';
        var isInTextarea = isKeywordInTextarea(kw) ? ' in-textarea' : '';
        var isHighlighted = (i === highlightedIndex) ? ' selected' : '';
        html += '<div class="filter-history-item' + isSelected + isInTextarea + isHighlighted + '" '
          + 'data-index="' + i + '" style="height:' + ITEM_HEIGHT + 'px;box-sizing:border-box;">'
          + '<span class="keyword-index">' + (i + 1) + '</span>'
          + '<div class="keyword">' + highlightMatchText(kw, currentQuery) + '</div>'
          + '<span class="keyword-delete-btn" data-keyword="' + escapeHtml(kw) + '" title="删除">&times;</span>'
          + '</div>';
      }
      virtualContent.innerHTML = html;
    }

    // 拖选状态变量
    var mouseDownActive = false;  // 鼠标按下中
    var pendingClickIdx = -1;     // 等待 click 处理的单选索引
    var mouseDownX = 0, mouseDownY = 0; // mousedown 坐标（拖拽阈值判断）
    var DRAG_THRESHOLD = 5;       // 超过 5px 才算拖拽，避免点击抖动误判

    // document 级 mousemove：基于坐标阈值区分点击与拖拽
    document.addEventListener('mousemove', function(e) {
      if (!mouseDownActive) return;

      // 未进入拖拽模式时，检查移动距离是否超过阈值
      if (!dragSelecting) {
        var dx = e.clientX - mouseDownX;
        var dy = e.clientY - mouseDownY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
        dragSelecting = true;
        pendingClickIdx = -1;
      }

      // 根据鼠标 Y 坐标计算当前悬停的关键词索引
      var listRect = historyList.getBoundingClientRect();
      var y = e.clientY - listRect.top + historyList.scrollTop;
      var currentIdx = Math.floor(y / ITEM_HEIGHT);
      currentIdx = Math.max(0, Math.min(currentIdx, currentMatchedItems.length - 1));

      selectedIndices = {};
      var from = Math.min(dragStartIndex, currentIdx);
      var to = Math.max(dragStartIndex, currentIdx);
      for (var r = from; r <= to; r++) {
        selectedIndices[r] = true;
      }
      renderVirtualItems();
    });

    // mouseup 结束拖选（注意：mouseup 在 click 之前触发，不能清除 pendingClickIdx）
    document.addEventListener('mouseup', function() {
      mouseDownActive = false;
      if (!dragSelecting) return; // 单选：不处理，留给 click
      dragSelecting = false;
      var count = Object.keys(selectedIndices).length;
      if (count > 1) {
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
        selectedIndices = {};
        renderVirtualItems();
        refocusSearch();
      } else {
        selectedIndices = {};
      }
    });

    // ========== P0-1: 统一 — 拦截 textarea 的 focus/keydown ==========

    // 拦截 textarea focus（阻止 original-script.js:12820 的旧处理器）
    // 不再在这里自动聚焦 searchInput，改由 openDialogUnified 在 loadKeywords 完成后聚焦，
    // 避免 loadKeywords 异步加载完成前就用旧内存数据渲染列表
    textarea.addEventListener('focus', function(e) {
      e.stopImmediatePropagation();
      e.preventDefault();
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
      if (!textarea._initialized) {
        if (filterBox) textarea.value = filterBox.value || '';
        textarea._initialized = true;
      }

      filterDialog.classList.add('visible');
      renderChips();

      // 先用内存数据立即渲染（瞬间响应）
      showHistoryList();

      // 后台从 DB 重新加载最新数据 + 按需加载 transitions
      module.loadKeywords().then(function() {
        // 加载 textarea 中所有关键词的马尔可夫转移缓存
        var ctx = module.getTextareaContext();
        var transPromises = ctx.map(function(kw) {
          return module.updateTransitionsCache(kw);
        });
        Promise.all(transPromises).then(function() {
          var freshKeywords = module.fuzzyMatch('', module.getKeywords());
          if (freshKeywords.length !== currentMatchedItems.length) {
            currentMatchedItems = freshKeywords;
            renderVirtualItems();
          }
        });
      });
    }

    function showHistoryList() {
      invalidateSearchCache(); // 关键词列表重新加载，缓存失效
      var allKeywords = module.getKeywords();
      currentMatchedItems = module.fuzzyMatch('', allKeywords);
      highlightedIndex = -1;
      selectedIndices = {};
      searchInput.value = '';
      currentQuery = '';

      // 先显示容器，确保 historyList 有正确的 clientHeight
      suggestions.style.display = '';
      suggestions.classList.remove('hidden');

      initVirtualList();
      renderVirtualItems();
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
      updateSearchStatus('');
      if (textarea.value.trim() === '' && typeof cleanFilterData === 'function') {
        cleanFilterData();
      }
      // 关闭对话框时也关闭 chip 右键菜单
      var menu = document.getElementById('chipContextMenu');
      if (menu) menu.style.display = 'none';
      chipContextTarget = null;
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
        var menu = document.getElementById('chipContextMenu');
        if (menu) menu.style.display = 'none';
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

    // ========== 右键菜单：复制 & 加入数据库 ==========
    var chipContextMenu = document.createElement('div');
    chipContextMenu.id = 'chipContextMenu';
    chipContextMenu.style.cssText = 'display:none;position:fixed;z-index:10004;background:#fff;border:1px solid #e0e0e0;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);padding:6px 0;min-width:150px;font-size:13px;font-family:inherit;';
    chipContextMenu.innerHTML =
      '<div class="chip-menu-item" data-action="copy" style="padding:8px 18px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background 0.15s;" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'transparent\'">' +
        '<span style="font-size:14px;">📋</span><span>复制</span>' +
      '</div>' +
      '<div class="chip-menu-item" data-action="save" style="padding:8px 18px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background 0.15s;" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'transparent\'">' +
        '<span style="font-size:14px;">💾</span><span>加入数据库</span>' +
      '</div>';
    document.body.appendChild(chipContextMenu);

    var chipContextTarget = null; // 记录当前右键的 chip 数据

    function hideChipContextMenu() {
      chipContextMenu.style.display = 'none';
      chipContextTarget = null;
    }

    // 点击其他地方关闭菜单
    document.addEventListener('click', hideChipContextMenu);

    // 菜单项点击处理
    chipContextMenu.addEventListener('click', function(e) {
      e.stopPropagation();
      var item = e.target.closest('.chip-menu-item');
      if (!item || !chipContextTarget) return;
      var action = item.dataset.action;
      var text = chipContextTarget;

      if (action === 'copy') {
        // 复制到剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(function() {
            fallbackCopy(text);
          });
        } else {
          fallbackCopy(text);
        }
        showChipMenuToast('已复制: ' + text);
      } else if (action === 'save') {
        // 加入数据库
        module.addKeyword(text).then(function() {
          showChipMenuToast('已加入数据库: ' + text);
        }).catch(function() {
          showChipMenuToast('保存失败: ' + text);
        });
      }
      hideChipContextMenu();
    });

    function fallbackCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    function showChipMenuToast(msg) {
      var toast = document.createElement('div');
      toast.textContent = msg;
      toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:10002;'
        + 'background:rgba(0,0,0,0.8);color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;'
        + 'pointer-events:none;animation:chipToastIn 0.3s ease,chipToastOut 0.3s 1.2s ease forwards;';
      document.body.appendChild(toast);
      setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 1600);
    }

    // 右键事件
    chipContainer.addEventListener('contextmenu', function(e) {
      var chip = e.target.closest('.filter-chip');
      if (!chip) {
        hideChipContextMenu();
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      var chipText = chip.querySelector('.chip-text');
      chipContextTarget = chipText ? chipText.textContent.trim() : chip.textContent.trim();

      // 定位菜单在 chip 上方居中
      var rect = chip.getBoundingClientRect();
      var menuW = 160;
      var menuH = 80;
      var x = rect.left + rect.width / 2 - menuW / 2;
      var y = rect.top - menuH - 6; // 6px 间距

      // 防止溢出屏幕边界
      if (x < 8) x = 8;
      if (x + menuW > window.innerWidth - 8) x = window.innerWidth - menuW - 8;
      // 如果上方空间不够，显示在下方
      if (y < 8) y = rect.bottom + 6;

      chipContextMenu.style.left = x + 'px';
      chipContextMenu.style.top = y + 'px';
      chipContextMenu.style.display = 'block';
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
        invalidateTextareaCache();
        renderChips();
        refreshInTextareaState();
      }
    }

    // ========== 关键词追加/移除/切换 ==========

    function appendToTextarea(keyword) {
      if (isKeywordInTextarea(keyword)) return false;
      var current = textarea.value.trim();
      textarea.value = !current ? keyword : current + '|' + keyword;
      invalidateTextareaCache();
      invalidateSearchCache(); // textarea 变化影响评分权重
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
      invalidateTextareaCache();
      invalidateSearchCache(); // textarea 变化影响评分权重
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

    // ========== textarea 内容缓存 Set（滚动期间复用） ==========
    var _textareaSetCache = null;
    var _textareaSetCacheValue = '';
    function getTextareaKeywordSet() {
      var current = textarea.value.trim();
      if (current === _textareaSetCacheValue && _textareaSetCache) return _textareaSetCache;
      _textareaSetCacheValue = current;
      _textareaSetCache = {};
      if (!current) return _textareaSetCache;
      var parts = current.split(/(?<!\\)\|/);
      for (var i = 0; i < parts.length; i++) {
        var t = parts[i].trim();
        if (t) _textareaSetCache[t] = true;
      }
      return _textareaSetCache;
    }
    function invalidateTextareaCache() {
      _textareaSetCache = null;
      _textareaSetCacheValue = '';
    }

    function isKeywordInTextarea(keyword) {
      return !!getTextareaKeywordSet()[keyword];
    }

    function highlightMatchText(keyword, query) {
      if (!query) return escapeHtml(keyword);
      var lowerK = keyword.toLowerCase();
      var lowerQ = query.toLowerCase();

      // 尝试连续子串匹配（优先精确子串高亮）
      var compactQ = lowerQ.replace(/\s+/g, '');
      var idx = lowerK.indexOf(lowerQ);
      if (idx !== -1) {
        return escapeHtml(keyword.substring(0, idx))
          + '<span class="match-highlight">' + escapeHtml(keyword.substring(idx, idx + lowerQ.length)) + '</span>'
          + escapeHtml(keyword.substring(idx + lowerQ.length));
      }
      // 尝试紧凑版本连续子串
      if (compactQ !== lowerQ) {
        idx = lowerK.indexOf(compactQ);
        if (idx !== -1) {
          return escapeHtml(keyword.substring(0, idx))
            + '<span class="match-highlight">' + escapeHtml(keyword.substring(idx, idx + compactQ.length)) + '</span>'
            + escapeHtml(keyword.substring(idx + compactQ.length));
        }
      }

      // 多 token 子序列高亮：将 query 按空格拆分，对每个 token 独立高亮匹配的字符
      var tokens = lowerQ.split(/\s+/).filter(function(t) { return t.length > 0; });
      if (tokens.length > 1) {
        // 收集所有需要高亮的字符位置
        var highlightPositions = {};
        for (var ti = 0; ti < tokens.length; ti++) {
          var token = tokens[ti];
          var qi = 0;
          for (var ci = 0; ci < lowerK.length && qi < token.length; ci++) {
            if (lowerK[ci] === token[qi]) {
              highlightPositions[ci] = true;
              qi++;
            }
          }
        }
        var result = '';
        for (var ci2 = 0; ci2 < keyword.length; ci2++) {
          if (highlightPositions[ci2]) {
            result += '<span class="match-highlight">' + escapeHtml(keyword[ci2]) + '</span>';
          } else {
            result += escapeHtml(keyword[ci2]);
          }
        }
        return result;
      }

      // 单 token 子序列高亮（原始逻辑）
      var result2 = '';
      var qi2 = 0;
      for (var ci3 = 0; ci3 < keyword.length && qi2 < lowerQ.length; ci3++) {
        if (lowerK[ci3] === lowerQ[qi2]) {
          result2 += '<span class="match-highlight">' + escapeHtml(keyword[ci3]) + '</span>';
          qi2++;
        } else {
          result2 += escapeHtml(keyword[ci3]);
        }
      }
      if (ci3 < keyword.length) result2 += escapeHtml(keyword.substring(ci3));
      return result2;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ========== 删除关键词 ==========

    function deleteKeyword(keyword) {
      if (module.removeKeyword) module.removeKeyword(keyword);
      // 同步清理 textarea 中该关键词的芯片
      if (isKeywordInTextarea(keyword)) {
        removeFromTextarea(keyword);
      }
      var idx = currentMatchedItems.indexOf(keyword);
      if (idx !== -1) currentMatchedItems.splice(idx, 1);
      delete selectedIndices[idx];
      invalidateSearchCache(); // 关键词数据变化，缓存失效
      renderVirtualItems();
    }

    // ========== 高亮状态管理 ==========

    function updateHighlight() {
      renderVirtualItems();
      // 滚动到高亮项可见
      if (highlightedIndex >= 0) {
        var targetTop = highlightedIndex * ITEM_HEIGHT;
        var viewTop = historyList.scrollTop;
        var viewBottom = viewTop + historyList.clientHeight;
        if (targetTop < viewTop || targetTop + ITEM_HEIGHT > viewBottom) {
          historyList.scrollTop = targetTop - historyList.clientHeight / 2 + ITEM_HEIGHT / 2;
        }
      }
    }

    function selectHighlighted() {
      if (highlightedIndex >= 0 && highlightedIndex < currentMatchedItems.length) {
        toggleKeywordInTextarea(currentMatchedItems[highlightedIndex]);
        searchInput.value = '';
        currentQuery = '';
        doSearch();
        refocusSearch();
        return true;
      }
      return false;
    }

    function refreshInTextareaState() {
      renderVirtualItems();
    }

    // ========== 搜索输入事件（150ms 防抖，fzf → SQL → JS/Worker 三级优先） ==========

    var searchTimer = null;
    // fzf 不做永久禁用，每次搜索都优先尝试，失败则单次降级到 SQL

    // ========== 优化1: 搜索缓存（5秒 TTL LRU） ==========
    var searchCache = {};       // { query: { results, timestamp } }
    var searchCacheMaxSize = 20; // 最多缓存 20 个查询
    var searchCacheTTL = 5000;   // 5 秒过期

    function invalidateSearchCache() {
      searchCache = {};
    }

    function getCachedSearch(query) {
      var entry = searchCache[query];
      if (!entry) return null;
      if (Date.now() - entry.timestamp > searchCacheTTL) {
        delete searchCache[query];
        return null;
      }
      // 命中后移到"最新"（时间戳刷新）
      entry.timestamp = Date.now();
      return entry.results;
    }

    function setCachedSearch(query, results) {
      // LRU 淘汰：超过最大容量时删最旧的
      var keys = Object.keys(searchCache);
      if (keys.length >= searchCacheMaxSize) {
        var oldest = null;
        var oldestKey = null;
        for (var i = 0; i < keys.length; i++) {
          if (!oldest || searchCache[keys[i]].timestamp < oldest) {
            oldest = searchCache[keys[i]].timestamp;
            oldestKey = keys[i];
          }
        }
        if (oldestKey) delete searchCache[oldestKey];
      }
      searchCache[query] = { results: results, timestamp: Date.now() };
    }

    // ========== 优化2: Web Worker 模糊匹配 ==========
    var fuzzyMatchWorker = null;
    var fuzzyMatchWorkerBusy = false;
    var _pendingWorkerQuery = null; // 记录当前等待 worker 处理的 query

    function initFuzzyMatchWorker() {
      if (fuzzyMatchWorker) return;
      try {
        fuzzyMatchWorker = new Worker('../workers/fuzzy-match-worker.js');
        fuzzyMatchWorker.onmessage = function(e) {
          fuzzyMatchWorkerBusy = false;
          var msg = e.data;
          if (msg.type === 'fuzzyMatchResult') {
            var results = msg.data.results;
            // 只有当 query 仍匹配时才更新（防止过期结果覆盖）
            if (_pendingWorkerQuery === currentQuery || _pendingWorkerQuery === null) {
              currentMatchedItems = results;
              updateSearchStatus('Worker', currentMatchedItems.length, msg.data.elapsed);
              renderSearchResults();
              setCachedSearch(currentQuery, results.slice());
            }
            _pendingWorkerQuery = null;
          }
        };
        fuzzyMatchWorker.onerror = function(err) {
          console.warn('[FilterSearch] Worker 出错, 降级到主线程:', err);
          fuzzyMatchWorkerBusy = false;
          fuzzyMatchWorker = null;
          // 降级到主线程
          if (_pendingWorkerQuery === currentQuery) {
            _pendingWorkerQuery = null;
            runMainThreadFuzzyMatch();
          }
        };
        console.log('[FilterSearch] 模糊匹配 Worker 已初始化');
      } catch (e) {
        console.warn('[FilterSearch] 无法创建 Worker, 使用主线程:', e);
        fuzzyMatchWorker = null;
      }
    }

    /**
     * 主线程模糊匹配（Worker 不可用或关键词数量较小时的降级方案）
     */
    function runMainThreadFuzzyMatch(startTime) {
      var jsStart = Date.now();
      currentMatchedItems = module.fuzzyMatch(currentQuery, module.getKeywords());
      var jsElapsed = Date.now() - jsStart;
      var totalElapsed = Date.now() - (startTime || jsStart);
      console.log('[FilterSearch] JS 内存匹配, query="' + currentQuery + '", 匹配=' + currentMatchedItems.length + '条, 耗时=' + jsElapsed + 'ms');
      updateSearchStatus('JS', currentMatchedItems.length, totalElapsed);
      renderSearchResults();
      setCachedSearch(currentQuery, currentMatchedItems.slice());
    }

    /**
     * Worker 或主线程模糊匹配（第三优先级降级）
     * 关键词数量 > 500 且 Worker 可用时走 Worker，否则走主线程
     */
    function runFuzzyMatch(startTime) {
      var keywords = module.getKeywords();
      var WORKER_THRESHOLD = 500;

      if (keywords.length > WORKER_THRESHOLD && fuzzyMatchWorker && !fuzzyMatchWorkerBusy) {
        // 走 Worker
        fuzzyMatchWorkerBusy = true;
        _pendingWorkerQuery = currentQuery;
        var textarea = document.getElementById('filterDialogTextarea');
        var textareaContext = module.getTextareaContext();
        var textareaSet = getTextareaKeywordSet();
        var kwObjs = module.getKeywordObjects();
        fuzzyMatchWorker.postMessage({
          type: 'fuzzyMatch',
          data: {
            query: currentQuery,
            keywords: kwObjs.slice(),
            textareaContext: textareaContext,
            textareaSet: textareaSet,
            now: Date.now()
          }
        });
      } else {
        // 走主线程
        runMainThreadFuzzyMatch(startTime);
      }
    }

    /**
     * 对匹配结果做客户端综合评分排序
     * @param {string[]} matchedTexts - 匹配到的关键词文本数组
     */
    function scoreAndSortResults(matchedTexts) {
      var kwMap = module.getKwObjMap();
      var textareaContext = module.getTextareaContext();
      var textareaSet = getTextareaKeywordSet();
      var now = Date.now();
      var lowerQ = currentQuery.toLowerCase();
      var tokens = lowerQ.split(/\s+/).filter(function(t) { return t.length > 0; });
      var compactQ = tokens.join('');
      var result = [];
      for (var ri = 0; ri < matchedTexts.length; ri++) {
        var text = matchedTexts[ri];
        var lc = text.toLowerCase();
        var matchScore = 0;
        if (lc === compactQ || lc === lowerQ) matchScore = 50000;
        else if (lc.indexOf(compactQ) === 0 || lc.indexOf(lowerQ) === 0) matchScore = 30000 + (compactQ.length / lc.length) * 5000;
        else if (lc.indexOf(compactQ) !== -1) matchScore = 10000 + (compactQ.length / lc.length) * 3000;
        else matchScore = 10000 + (lowerQ.length / lc.length) * 2000;
        var kwObj = kwMap[text];
        var base = module.relevanceScore(kwObj, textareaContext, now);
        // 已选入 textarea 的关键词大幅降权，排到后面
        if (textareaSet[text]) matchScore -= 40000;
        result.push({ keyword: text, score: matchScore + base });
      }
      result.sort(function(a, b) { return b.score - a.score; });
      return result.map(function(x) { return x.keyword; });
    }

    /**
     * 渲染搜索结果到虚拟列表
     */
    function renderSearchResults() {
      highlightedIndex = -1;
      selectedIndices = {};
      initVirtualList();
      renderVirtualItems();
      suggestions.style.display = '';
      suggestions.classList.remove('hidden');
    }

    function updateSearchStatus(engine, count, elapsed) {
      if (!searchStatusEl) return;
      if (!engine) {
        searchStatusEl.textContent = '';
        return;
      }
      searchStatusEl.textContent = engine + ' ' + count + '条 ' + elapsed + 'ms';
    }

    function doSearch() {
      currentQuery = searchInput.value.trim();

      // ===== 优化1: 缓存检查 =====
      var cached = getCachedSearch(currentQuery);
      if (cached) {
        currentMatchedItems = cached;
        updateSearchStatus('cache', currentMatchedItems.length, 0);
        renderSearchResults();
        return;
      }

      // 初始化 Worker（延迟加载，首次搜索时创建）
      initFuzzyMatchWorker();

      if (currentQuery) {
        // ===== 第一优先：fzf 模糊搜索 =====
        var searchStartTime = Date.now();
        module.searchFromFzf(currentQuery).then(function(fzfResult) {
          var elapsed = Date.now() - searchStartTime;
          if (fzfResult && !fzfResult.fallback && fzfResult.matched && fzfResult.matched.length > 0) {
            // fzf 成功，对其结果做客户端评分排序
            console.log('[FilterSearch] fzf 命中, query="' + currentQuery + '", 匹配=' + fzfResult.matched.length + '条, 耗时=' + elapsed + 'ms');
            currentMatchedItems = scoreAndSortResults(fzfResult.matched);
            updateSearchStatus('fzf', fzfResult.matched.length, elapsed);
            renderSearchResults();
            setCachedSearch(currentQuery, currentMatchedItems.slice());
            return;
          }
          // fzf 单次失败，降级到 SQL（下次搜索仍会优先尝试 fzf）
          if (fzfResult && fzfResult.fallback) {
            console.log('[FilterSearch] fzf 暂不可用, 降级到 SQL, 原因: ' + (fzfResult.error || '未找到 fzf.exe'));
          } else {
            console.log('[FilterSearch] fzf 无结果, 降级到 SQL');
          }
          // ===== 第二优先：SQL 搜索 =====
          fallbackToSQL(searchStartTime);
        });
      } else {
        // 无搜索词：用内存数据排序
        currentMatchedItems = module.fuzzyMatch('', module.getKeywords());
        updateSearchStatus('');
        renderSearchResults();
        setCachedSearch('', currentMatchedItems.slice());
      }
    }

    /**
     * SQL 降级搜索（fzf 不可用或无结果时）
     */
    function fallbackToSQL(startTime) {
      var sqlStart = Date.now();
      module.searchFromDB(currentQuery, 300).then(function(dbResults) {
        var sqlElapsed = Date.now() - sqlStart;
        var totalElapsed = Date.now() - startTime;
        if (dbResults && dbResults.length > 0) {
          console.log('[FilterSearch] SQL 命中, query="' + currentQuery + '", 匹配=' + dbResults.length + '条, 耗时=' + sqlElapsed + 'ms');
          var texts = [];
          for (var ri = 0; ri < dbResults.length; ri++) {
            texts.push(dbResults[ri].text);
          }
          currentMatchedItems = scoreAndSortResults(texts);
          updateSearchStatus('SQL', dbResults.length, totalElapsed);
          setCachedSearch(currentQuery, currentMatchedItems.slice());
        } else {
          // ===== 第三优先：Worker/JS 内存模糊匹配 =====
          console.log('[FilterSearch] SQL 无结果, 降级到 JS/Worker, query="' + currentQuery + '", 耗时=' + sqlElapsed + 'ms');
          runFuzzyMatch(startTime);
        }
        if (dbResults && dbResults.length > 0) {
          renderSearchResults();
        }
        // runFuzzyMatch 内部会调用 renderSearchResults
      });
    }

    searchInput.addEventListener('input', function() {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(doSearch, 150);
    });

    searchInput.addEventListener('focus', function() {
      if (currentMatchedItems.length === 0) {
        doSearch();
      }
      suggestions.style.display = '';
      suggestions.classList.remove('hidden');
    });

    // ========== 键盘事件 ==========

    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (searchInput.value.trim() !== '') {
          searchInput.value = '';
          doSearch();
        } else if (textarea.value.trim() !== '') {
          textarea.value = '';
          renderChips();
          refreshInTextareaState();
        } else {
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
          doSearch();
          searchInput.focus();
        }
        return;
      }

      // Ctrl+J 下移 / Ctrl+K 上移（与 ArrowDown/ArrowUp 等效）
      if (e.ctrlKey && e.key === 'j') {
        e.preventDefault();
        if (currentMatchedItems.length > 0) {
          highlightedIndex = Math.min(highlightedIndex + 1, currentMatchedItems.length - 1);
          updateHighlight();
        }
        return;
      }
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        if (highlightedIndex > 0) {
          highlightedIndex--;
          updateHighlight();
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
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
          selectedIndices = {};
          refreshInTextareaState();
          refocusSearch();
        } else if (highlightedIndex >= 0) {
          selectHighlighted();
        } else {
          var rawInput = searchInput.value.trim();
          if (rawInput) {
            var inputParts = rawInput.split(/(?<!\\)\|/).map(function(s) { return s.replace(/\\\|/g, '|').trim(); }).filter(Boolean);
            var appended = batchAppendToTextarea(inputParts);
            if (appended > 0) {
              renderChips();
              refreshInTextareaState();
              // Shift+Enter 才写入 DB，普通 Enter 仅加到 chip bar
              if (e.shiftKey) {
                module.addKeywordsFromInput(rawInput);
              }
            }
            searchInput.value = '';
            currentQuery = '';
            doSearch();
            refocusSearch();
          } else {
            applyAndClose();
          }
        }
        return;
      }
      e.stopPropagation();
    });

    // ========== 分组模式切换 ==========

    // 动态创建分组切换按钮
    var groupToggle = document.createElement('button');
    groupToggle.className = 'group-mode-toggle';
    groupToggle.textContent = '分组';
    groupToggle.title = '切换分组视图';
    searchInput.parentNode.insertBefore(groupToggle, searchInput);

    groupToggle.addEventListener('click', function() {
      groupMode = !groupMode;
      this.classList.toggle('active', groupMode);
      refocusSearch();
      if (groupMode) {
        renderGroupList();
      } else {
        // 切回关键词模式时，需要重建虚拟列表 DOM
        // （renderGroupList 用 innerHTML 替换了 historyList，销毁了 virtualContainer/virtualContent）
        virtualListReady = false;
        showHistoryList();
      }
    });

    // ========== 分组列表渲染 ==========

    function renderGroupList() {
      suggestions.style.display = '';
      suggestions.classList.remove('hidden');
      historyList.style.overflowY = 'auto';
      historyList.style.height = getListHeight() + 'px';

      // 先显示加载提示
      historyList.innerHTML = '<div class="group-empty">加载中...</div>';

      console.log('[GroupView] 开始加载分组数据...');

      // 通过 IDB 模块加载组合历史
      var comboPromise = (window.App && window.App.IDB && window.App.IDB.isReady())
        ? window.App.IDB.loadCombos()
        : Promise.resolve({ success: false });

      comboPromise.then(function(comboResult) {
        console.log('[GroupView] 组合数据加载完成:', comboResult);

        var html = '';

        // 历史组合（从 filter_combos 表）
        if (comboResult && comboResult.success && comboResult.data && comboResult.data.length > 0) {
          html += '';
          for (var ci = 0; ci < comboResult.data.length; ci++) {
            var combo = comboResult.data[ci];
            var cpreview = combo.keywords_original;
            html += '<div class="group-card group-card-combo" data-keywords="' + escapeHtml(combo.keywords_original) + '" data-combo-sorted="' + escapeHtml(combo.keywords_sorted) + '">'
              + '<div class="group-card-header">'
              + '<span class="group-card-name" style="font-weight:400">' + escapeHtml(cpreview) + '</span>'
              + '<span class="group-card-delete" data-combo-sorted="' + escapeHtml(combo.keywords_sorted) + '">&times;</span>'
              + '</div>'
              + '</div>';
          }
        }

        if (!html) {
          html = '<div class="group-empty">暂无分组，使用多关键词过滤后自动保存</div>';
        }

        historyList.innerHTML = html;
        bindGroupCardEvents();
        console.log('[GroupView] 渲染完成');
      });
    }

    function bindGroupCardEvents() {
      var cards = historyList.querySelectorAll('.group-card');
      for (var ci = 0; ci < cards.length; ci++) {
        (function(card) {
          // 避免重复绑定
          if (card._groupBound) return;
          card._groupBound = true;
          card.addEventListener('click', function(e) {
            // 点击删除按钮（历史组合）
            if (e.target.classList.contains('group-card-delete') && e.target.dataset.comboSorted) {
              e.stopPropagation();
              var keywordsSorted = e.target.dataset.comboSorted;
              if (window.App && window.App.IDB) {
                window.App.IDB.deleteCombo(keywordsSorted).then(function() { renderGroupList(); });
              }
              return;
            }
            // 点击卡片 → 先清空 textarea，再填入新关键词
            var kws = card.dataset.keywords;
            if (kws) {
              textarea.value = '';
              var kwParts = kws.split(/(?<!\\)\|/).map(function(s) { return s.replace(/\\\|/g, '|').trim(); }).filter(Boolean);
              batchAppendToTextarea(kwParts);
              renderChips();
              refreshInTextareaState();
              refocusSearch();
            }
          });
        })(cards[ci]);
      }
    }

    // ========== 自动保存关键词组合 ==========

    // 重写 applyAndClose，在确认过滤时自动保存多关键词组合
    var _originalApplyAndClose = applyAndClose;
    applyAndClose = function() {
      var value = textarea.value.trim();
      if (value) {
        var parts = value.split(/(?<!\\)\|/).map(function(s) { return s.replace(/\\\|/g, '|').trim(); }).filter(Boolean);
        if (parts.length >= 2 && window.App && window.App.IDB && window.App.IDB.isReady()) {
          var sortedParts = parts.slice().sort();
          var comboHash = sortedParts.join('\0');
          window.App.IDB.saveCombo({
            comboHash: comboHash,
            keywordsSorted: sortedParts.join('|'),
            keywordsOriginal: value
          });
        }
      }
      _originalApplyAndClose();
    };

    console.log('[FilterKeywordHistory Patch] 补丁已应用');
  }).catch(function(e) {
    console.error('[FilterKeywordHistory Patch] 初始化失败:', e);
  });

  console.log('[FilterKeywordHistory Patch] 补丁已加载');
})();
