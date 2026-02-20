/**
 * CSV 表格渲染器 - 高性能 Canvas 渲染方案
 *
 * 功能：
 * 1. 默认只显示前15列，减少DOM/Canvas渲染压力
 * 2. 使用 Web Worker 并行解析 CSV
 * 3. Canvas 虚拟滚动，支持大数据量
 * 4. 支持列宽调整和水平滚动
 */

(function() {
  // ========== 内联 Worker 管理器功能 ==========
  // 直接创建 Worker，不依赖外部 worker-manager.js
  // ========== Papa Parse CSV 解析 ==========
  const CSVParser = {
    // 检测分隔符
    detectDelimiter(text) {
      const firstLine = text.split('\n')[0] || '';
      const delimiters = [',', ';', '\t', '|'];
      let maxCount = 0;
      let detected = ',';

      for (const d of delimiters) {
        const count = (firstLine.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
        if (count > maxCount) {
          maxCount = count;
          detected = d;
        }
      }
      return detected;
    },

    // 使用 Papa Parse 解析
    parse(text, onProgress) {
      return new Promise((resolve) => {
        const startTime = performance.now();

        Papa.parse(text, {
          delimiter: this.detectDelimiter(text),
          skipEmptyLines: true,
          worker: false,  // 主线程解析，更稳定
          complete: (results) => {
            const elapsed = performance.now() - startTime;
            console.log(`[CSV Parser] 解析完成: ${results.data.length}行, 耗时 ${elapsed.toFixed(1)}ms`);

            // 补齐列数
            const maxColumns = Math.max(...results.data.map(r => r.length));
            const normalized = results.data.map(row => {
              while (row.length < maxColumns) row.push('');
              return row;
            });

            resolve({
              success: true,
              data: normalized,
              maxColumns: maxColumns,
              elapsed: elapsed
            });
          },
          error: (error) => {
            resolve({ success: false, error: error.message });
          }
        });
      });
    }
  };
  // ========== Papa Parse 结束 ==========

  const CONFIG = {
    DEFAULT_VISIBLE_COLUMNS: 9999,  // 🔧 默认显示所有列
    ROW_HEIGHT: 26,
    HEADER_HEIGHT: 28,
    MIN_COLUMN_WIDTH: 0,  // 允许列宽收缩到0，便于隐藏列
    DEFAULT_COLUMN_WIDTH: 120,
    CELL_PADDING_X: 6
  };

  let canvas = null;
  let ctx = null;
  let container = null;
  let csvData = null;
  let visibleColumns = CONFIG.DEFAULT_VISIBLE_COLUMNS;
  let columnWidths = [];
  let scrollX = 0;
  let scrollY = 0;
  let containerWidth = 0;
  let containerHeight = 0;
  let hoveredCell = null;
  let selectedCell = null;
  let isDragging = false;
  let dragColumnIndex = -1;
  let totalWidth = 0;
  let dragOrigWidths = null;  // 拖动开始时的原始列宽

  // 面板拖拽和调整大小状态
  let panelDragging = false;
  let panelDragOffset = { x: 0, y: 0 };
  let resizing = null;
  let resizeStart = { x: 0, y: 0, w: 0, h: 0, l: 0, t: 0 };

  // 滚动条状态
  let isDraggingVScroll = false;
  let isDraggingHScroll = false;
  let vScrollStartY = 0;
  let hScrollStartX = 0;
  const scrollSize = 12;

  // 列选择相关
  let selectedColumns = new Set();  // 选中的列索引
  let columnSelectorVisible = false;
  let originalColumnWidths = [];  // 保存原始列宽，用于恢复隐藏的列

  // 列数据类型
  let columnTypes = [];  // 记录每列的数据类型 ('number', 'text', 'date')


  // 简单的消息提示函数
  function showMessage(msg) {
    // 尝试使用全局的 showMessage
    if (typeof window.showMessage === 'function') {
      window.showMessage(msg);
    } else {
      // 使用 alert 作为后备
      alert(msg);
    }
  }

  // 恢复所有隐藏的列
  function restoreAllColumns() {
    if (!csvData || originalColumnWidths.length === 0) return;

    // 恢复所有原始列宽
    columnWidths = [...originalColumnWidths];

    // 重置选中状态
    selectedColumns = new Set();
    for (let i = 0; i < columnWidths.length; i++) {
      if (columnWidths[i] > 0) {
        selectedColumns.add(i);
      }
    }

    // 更新可见列数
    visibleColumns = csvData.totalColumns;  // 🔧 显示所有列

    // 更新信息显示
    const info = document.getElementById('csvTableInfo');
    if (info) {
      info.textContent = `${csvData.totalRows}行 × ${csvData.totalColumns}列 (${visibleColumns}列/共${csvData.totalColumns}列)`;
    }

    // 重置滚动位置
    scrollX = 0;
    scrollY = 0;

    // 重绘
    hideContextMenu();
    requestAnimationFrame(render);
  }

  // 右键菜单功能
  function showContextMenu(x, y) {
    const menu = document.getElementById('csvTableContextMenu');
    if (!menu) return;

    // 隐藏其他菜单
    hideColumnSelector();

    // 计算菜单位置，确保不超出屏幕
    const menuWidth = 150;
    const menuHeight = 40;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    let posX = Math.min(x, screenWidth - menuWidth - 10);
    let posY = Math.min(y, screenHeight - menuHeight - 10);

    menu.style.left = posX + 'px';
    menu.style.top = posY + 'px';
    menu.classList.add('visible');
  }

  function hideContextMenu() {
    const menu = document.getElementById('csvTableContextMenu');
    if (menu) {
      menu.classList.remove('visible');
    }
  }

  // 列选择弹窗功能
  function showColumnSelector(x, y) {
    if (!csvData || !csvData.headers) return;

    const selector = document.getElementById('csvColumnSelector');
    const columnList = document.getElementById('csvColumnList');
    if (!selector || !columnList) return;

    // 每次打开时清空之前的选择，只勾选time列
    selectedColumns.clear();

    // 自动勾选time列（包含time或时间的列）
    for (let i = 0; i < csvData.headers.length; i++) {
      const header = csvData.headers[i] || '';
      if (header.toLowerCase().includes('time') || header.toLowerCase().includes('时间')) {
        selectedColumns.add(i);
      }
    }

    // 生成列列表
    columnList.innerHTML = '';
    csvData.headers.forEach((header, index) => {
      const item = document.createElement('div');
      item.className = 'csv-column-item' + (selectedColumns.has(index) ? ' selected' : '');
      item.innerHTML = `
        <input type="checkbox" ${selectedColumns.has(index) ? 'checked' : ''}>
        <span class="column-name" title="${header}">${header || `列${index + 1}`}</span>
        <span class="column-index">#${index + 1}</span>
      `;
      item.addEventListener('click', () => toggleColumn(index));
      columnList.appendChild(item);
    });

    // 计算弹窗位置（使用屏幕高度的85%）
    const selectorWidth = 320;
    const selectorHeight = window.innerHeight * 0.85;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    let posX = Math.min(x, screenWidth - selectorWidth - 20);
    let posY = Math.min(y, screenHeight - selectorHeight - 20);
    posX = Math.max(10, posX);
    posY = Math.max(10, posY);

    selector.style.left = posX + 'px';
    selector.style.top = posY + 'px';
    selector.style.height = selectorHeight + 'px';
    selector.style.maxHeight = selectorHeight + 'px';
    selector.classList.add('visible');
    selector.style.display = 'flex';
    selector.style.flexDirection = 'column';

    hideContextMenu();
    columnSelectorVisible = true;
  }

  function hideColumnSelector() {
    const selector = document.getElementById('csvColumnSelector');
    if (selector) {
      selector.classList.remove('visible');
      selector.style.display = 'none';
    }
    columnSelectorVisible = false;
  }

  function toggleColumn(index) {
    if (selectedColumns.has(index)) {
      selectedColumns.delete(index);
    } else {
      selectedColumns.add(index);
    }
    updateColumnSelectorUI();
  }

  function updateColumnSelectorUI() {
    const columnList = document.getElementById('csvColumnList');
    if (!columnList) return;

    const items = columnList.querySelectorAll('.csv-column-item');
    items.forEach((item, index) => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      if (selectedColumns.has(index)) {
        item.classList.add('selected');
        if (checkbox) checkbox.checked = true;
      } else {
        item.classList.remove('selected');
        if (checkbox) checkbox.checked = false;
      }
    });
  }

  function selectAllColumns() {
    if (!csvData) return;
    for (let i = 0; i < csvData.headers.length; i++) {
      selectedColumns.add(i);
    }
    updateColumnSelectorUI();
  }

  function deselectAllColumns() {
    selectedColumns.clear();
    updateColumnSelectorUI();
  }

  function confirmColumnSelection() {
    if (selectedColumns.size === 0) {
      showMessage('请至少选择一列');
      return;
    }

    // 如果有原始列宽，先保存（用于恢复）
    if (originalColumnWidths.length === 0 && columnWidths.length > 0) {
      originalColumnWidths = [...columnWidths];
    }

    // 根据选中的列重新计算列宽
    const sortedColumns = Array.from(selectedColumns).sort((a, b) => a - b);

    // 更新可见列数：取最大列索引 + 1（确保所有选中的列都能显示）
    const maxColumnIndex = sortedColumns[sortedColumns.length - 1];
    visibleColumns = Math.min(maxColumnIndex + 1, csvData.totalColumns);

    // 重新初始化列宽，只为选中的列设置宽度
    const newColumnWidths = [];
    for (let i = 0; i < csvData.totalColumns; i++) {
      if (sortedColumns.includes(i)) {
        const headerLen = csvData.headers[i]?.length || 0;
        const maxContentLen = Math.max(headerLen, ...csvData.rows.slice(0, 100).map(r => String(r[i] || '').length));
        newColumnWidths[i] = Math.max(CONFIG.MIN_COLUMN_WIDTH, Math.min(CONFIG.DEFAULT_COLUMN_WIDTH * 2, maxContentLen * 8 + CONFIG.CELL_PADDING_X * 2));
      } else {
        newColumnWidths[i] = 0;  // 未选中的列设为0
      }
    }
    columnWidths = newColumnWidths;

    // 更新信息显示
    const info = document.getElementById('csvTableInfo');
    if (info) {
      info.textContent = `${csvData.totalRows}行 × ${csvData.totalColumns}列 (保留 ${selectedColumns.size} 列)`;
    }

    // 重置滚动位置
    scrollX = 0;
    scrollY = 0;

    // 隐藏弹窗并重绘
    hideColumnSelector();
    requestAnimationFrame(render);
  }

  // 绑定列选择弹窗事件
  function bindColumnSelectorEvents() {
    const closeBtn = document.getElementById('csvColumnSelectorClose');
    const selectAllBtn = document.getElementById('csvSelectAllColumns');
    const deselectAllBtn = document.getElementById('csvDeselectAllColumns');
    const confirmBtn = document.getElementById('csvConfirmColumns');
    const keepColumnsBtn = document.getElementById('csvKeepColumns');

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideColumnSelector();
      });
    }

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectAllColumns();
      });
    }

    if (deselectAllBtn) {
      deselectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deselectAllColumns();
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmColumnSelection();
      });
    }

    if (keepColumnsBtn) {
      keepColumnsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();  // 隐藏右键菜单
        const menu = document.getElementById('csvTableContextMenu');
        const rect = menu.getBoundingClientRect();
        showColumnSelector(rect.left + rect.width, rect.top);
      });
    }

    // 恢复所有列按钮
    const restoreColumnsBtn = document.getElementById('csvRestoreColumns');
    if (restoreColumnsBtn) {
      restoreColumnsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();  // 隐藏右键菜单
        restoreAllColumns();
      });
    }

    // 导出CSV按钮
    const exportBtn = document.getElementById('csvExportCSV');
    if (exportBtn) {
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        exportToCSV();
      });
    }

    // 🔧 绘制曲线图按钮
    const plotChartBtn = document.getElementById('csvPlotChart');
    if (plotChartBtn) {
      plotChartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        showBatteryChart();
      });
    }

    // 🔧 关闭图表弹窗
    const chartDialogClose = document.getElementById('csvChartDialogClose');
    if (chartDialogClose) {
      chartDialogClose.addEventListener('click', hideBatteryChart);
    }
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', doInit);
    } else {
      setTimeout(doInit, 0);
    }
  }

  function doInit() {
    container = document.getElementById('csvTableContainer');
    if (!container) {
      setTimeout(doInit, 50);
      return;
    }

    canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d', { alpha: false });

    // CSVParser 不需要初始化，Papa Parse 已全局可用
    bindPanelEvents();
    bindEvents();
    bindColumnSelectorEvents();

    console.log('[CSV Renderer] 初始化完成');
  }

  // 面板拖拽和调整大小
  function bindPanelEvents() {
    const panel = document.getElementById('csvTablePanel');
    if (!panel) return;

    // 头部拖拽和点击切换全屏
    const header = document.getElementById('csvTablePanelHeader');
    if (header) {
      let isClick = false;  // 区分点击和拖拽
      let dragStartPos = { x: 0, y: 0 };

      header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isClick = true;  // 标记为可能的点击
        dragStartPos = { x: e.clientX, y: e.clientY };
        panelDragging = true;
        const rect = panel.getBoundingClientRect();
        panelDragOffset.x = e.clientX - rect.left;
        panelDragOffset.y = e.clientY - rect.top;
        panel.style.transform = 'none';
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
      });

      // 鼠标移动时判断是拖拽还是点击
      document.addEventListener('mousemove', (e) => {
        if (panelDragging && isClick) {
          const moveDistance = Math.sqrt(
            Math.pow(e.clientX - dragStartPos.x, 2) +
            Math.pow(e.clientY - dragStartPos.y, 2)
          );
          // 移动超过5像素视为拖拽，不是点击
          if (moveDistance > 5) {
            isClick = false;
          }
        }
      }, { capture: true });

      // 鼠标释放时，如果是点击则切换全屏
      header.addEventListener('mouseup', (e) => {
        if (isClick && e.target.tagName !== 'BUTTON') {
          // 点击头部任意区域（除了按钮），切换全屏
          toggleFullscreen();
        }
        isClick = false;
      });
    }

    // 调整大小手柄
    const handles = panel.querySelectorAll('.panel-resize-handle');
    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resizing = handle.dataset.direction;
        const rect = panel.getBoundingClientRect();
        resizeStart = {
          x: e.clientX,
          y: e.clientY,
          w: rect.width,
          h: rect.height,
          l: rect.left,
          t: rect.top
        };
      });
    });

    // 全局鼠标移动和释放
    document.addEventListener('mousemove', handlePanelResize);
    document.addEventListener('mouseup', () => {
      panelDragging = false;
      resizing = null;
    });

    // 点击其他地方关闭右键菜单和列选择弹窗
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('csvTableContextMenu');
      const selector = document.getElementById('csvColumnSelector');

      // 如果点击在菜单或选择器内部，或者点击的是菜单按钮，不关闭
      if (menu && (menu.contains(e.target) || e.target.closest('#csvKeepColumns') || e.target.closest('#csvRestoreColumns'))) {
        return;
      }
      if (selector && selector.contains(e.target)) return;

      // 关闭菜单和选择器
      hideContextMenu();
      hideColumnSelector();
    });
  }

  // 单击头部切换全屏/还原
  function toggleFullscreen() {
    const panel = document.getElementById('csvTablePanel');
    if (!panel) return;

    if (panel.classList.contains('fullscreen')) {
      // 还原为默认大小
      panel.classList.remove('fullscreen');
      panel.style.width = '80vw';
      panel.style.height = '70vh';
      panel.style.top = '50%';
      panel.style.left = '50%';
      panel.style.transform = 'translate(-50%, -50%)';
    } else {
      // 全屏（占满整个屏幕）
      panel.classList.add('fullscreen');
      panel.style.width = '100vw';
      panel.style.height = '100vh';
      panel.style.top = '0';
      panel.style.left = '0';
      panel.style.transform = 'none';
    }

    // 触发重绘
    setTimeout(() => {
      updateContainerSize();
      requestAnimationFrame(render);
    }, 10);
  }

  function handlePanelResize(e) {
    const panel = document.getElementById('csvTablePanel');
    if (!panel) return;

    if (panelDragging) {
      panel.style.left = (e.clientX - panelDragOffset.x) + 'px';
      panel.style.top = (e.clientY - panelDragOffset.y) + 'px';
    }

    if (resizing) {
      const dx = e.clientX - resizeStart.x;
      const dy = e.clientY - resizeStart.y;

      switch (resizing) {
        case 'e':
          panel.style.width = Math.max(400, resizeStart.w + dx) + 'px';
          break;
        case 's':
          panel.style.height = Math.max(300, resizeStart.h + dy) + 'px';
          break;
        case 'w':
          const newW = Math.max(400, resizeStart.w - dx);
          panel.style.width = newW + 'px';
          panel.style.left = (resizeStart.l + (resizeStart.w - newW)) + 'px';
          break;
        case 'n':
          const newH = Math.max(300, resizeStart.h - dy);
          panel.style.height = newH + 'px';
          panel.style.top = (resizeStart.t + (resizeStart.h - newH)) + 'px';
          break;
        case 'se':
          panel.style.width = Math.max(400, resizeStart.w + dx) + 'px';
          panel.style.height = Math.max(300, resizeStart.h + dy) + 'px';
          break;
        case 'sw':
          const w2 = Math.max(400, resizeStart.w - dx);
          panel.style.width = w2 + 'px';
          panel.style.left = (resizeStart.l + (resizeStart.w - w2)) + 'px';
          panel.style.height = Math.max(300, resizeStart.h + dy) + 'px';
          break;
        case 'ne':
          panel.style.width = Math.max(400, resizeStart.w + dx) + 'px';
          const h2 = Math.max(300, resizeStart.h - dy);
          panel.style.height = h2 + 'px';
          panel.style.top = (resizeStart.t + (resizeStart.h - h2)) + 'px';
          break;
        case 'nw':
          const w3 = Math.max(400, resizeStart.w - dx);
          panel.style.width = w3 + 'px';
          panel.style.left = (resizeStart.l + (resizeStart.w - w3)) + 'px';
          const h3 = Math.max(300, resizeStart.h - dy);
          panel.style.height = h3 + 'px';
          panel.style.top = (resizeStart.t + (resizeStart.h - h3)) + 'px';
          break;
      }

      // 触发重绘
      if (csvData) {
        setTimeout(() => {
          updateContainerSize();
          requestAnimationFrame(render);
        }, 10);
      }
    }
  }

  function bindEvents() {
    container.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('dblclick', handleDoubleClick);
    canvas.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('resize', handleResize);

    // 滚动条拖动
    document.addEventListener('mouseup', () => {
      isDraggingVScroll = false;
      isDraggingHScroll = false;
    });

    document.addEventListener('mousemove', handleScrollbarDrag);
  }

  function handleContextMenu(e) {
    e.preventDefault();
    if (csvData) {
      showContextMenu(e.clientX, e.clientY);
    }
  }

  function handleWheel(e) {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;

    // 默认垂直滚动，按住 Alt 或在底部区域时水平滚动
    if (e.altKey || (mouseY > containerHeight - 25 && containerWidth < totalWidth)) {
      // 水平滚动
      const delta = e.deltaY > 0 ? 50 : -50;
      scrollX = Math.max(0, Math.min(scrollX + delta, Math.max(0, totalWidth - containerWidth) + 20));
    } else {
      // 垂直滚动（表头固定，只滚动数据区域）
      const dataHeight = csvData.rows.length * CONFIG.ROW_HEIGHT;
      const maxScroll = Math.max(0, dataHeight - (containerHeight - CONFIG.HEADER_HEIGHT));
      const delta = e.deltaY > 0 ? CONFIG.ROW_HEIGHT * 3 : -CONFIG.ROW_HEIGHT * 3;
      scrollY = Math.max(0, Math.min(scrollY + delta, maxScroll));
    }
    requestAnimationFrame(render);
  }

  function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollX;
    const y = e.clientY - rect.top + scrollY;

    if (isDragging && dragColumnIndex >= 0 && dragOrigWidths) {
      // 拖动列边框：可以覆盖前面的列

      // 计算拖动列左边框的当前位置（只计算可见的、宽度>0的列）
      let leftEdge = 0;
      for (let i = 0; i < dragColumnIndex; i++) {
        leftEdge += columnWidths[i];
      }

      const mouseX = e.clientX - rect.left + scrollX;

      if (mouseX > leftEdge) {
        // 鼠标在左边框右边：正常调整宽度
        columnWidths[dragColumnIndex] = Math.max(CONFIG.MIN_COLUMN_WIDTH, mouseX - leftEdge);
      } else {
        // 鼠标在左边框左边：需要覆盖前面的列
        // 找出鼠标位置落在哪一列
        let accumX = 0;
        let targetColIndex = -1;
        for (let i = 0; i < dragColumnIndex; i++) {
          const nextAccumX = accumX + columnWidths[i];
          if (mouseX >= accumX && mouseX < nextAccumX) {
            targetColIndex = i;
            break;
          }
          accumX = nextAccumX;
        }

        // 将目标列之后、拖动列之前的所有列宽度设为0（完全隐藏）
        for (let i = targetColIndex + 1; i < dragColumnIndex; i++) {
          columnWidths[i] = 0;
        }

        // 目标列可能被部分覆盖
        if (targetColIndex >= 0) {
          columnWidths[targetColIndex] = Math.max(0, mouseX - accumX);
        }

        // 拖动列保持原始宽度
        columnWidths[dragColumnIndex] = dragOrigWidths[dragColumnIndex];
      }

      requestAnimationFrame(render);
      return;
    }

    let colIdx = -1;
    let colStartX = getColumnStart(0) + scrollX;
    for (let i = 0; i < visibleColumns && i < columnWidths.length; i++) {
      if (x >= colStartX && x < colStartX + columnWidths[i]) {
        colIdx = i;
        break;
      }
      colStartX += columnWidths[i];
    }

    const headerHeight = CONFIG.HEADER_HEIGHT;
    const rowIdx = y < headerHeight ? -1 : Math.floor((y - headerHeight) / CONFIG.ROW_HEIGHT);

    hoveredCell = { col: colIdx, row: rowIdx };
    canvas.style.cursor = colIdx >= 0 ? 'text' : 'default';
    requestAnimationFrame(render);

    // 检查是否在列边框附近（用于调整列宽）
    for (let i = 0; i < visibleColumns && i < columnWidths.length; i++) {
      const borderX = getColumnStart(i) + columnWidths[i] + scrollX;
      // 只有当列宽>0时才显示调整手柄
      if (Math.abs(x - borderX) < 5 && columnWidths[i] > 0) {
        canvas.style.cursor = 'col-resize';
        break;
      }
    }
  }

  function handleMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const headerHeight = CONFIG.HEADER_HEIGHT;
    const dataHeight = csvData.rows.length * CONFIG.ROW_HEIGHT;
    const showVScroll = containerHeight - headerHeight < dataHeight;
    const showHScroll = containerWidth < totalWidth;

    // 检查是否在垂直滚动条区域（右侧，从表头下方开始）
    if (showVScroll) {
      const vTrackX = containerWidth - scrollSize;
      const trackHeight = containerHeight - headerHeight - scrollSize;
      const ratio = (containerHeight - headerHeight) / dataHeight;
      const sliderHeight = Math.max(30, (containerHeight - headerHeight) * ratio);
      const sliderY = headerHeight + (scrollY / dataHeight) * trackHeight;

      if (x >= vTrackX && y >= headerHeight) {
        if (y >= sliderY && y <= sliderY + sliderHeight) {
          // 点击在滑块上，开始拖动
          isDraggingVScroll = true;
          vScrollStartY = y - sliderY;
          e.preventDefault();
          return;
        } else {
          // 点击在滚动条轨道上，跳转到对应位置
          const targetY = Math.max(headerHeight, Math.min(y, containerHeight - scrollSize));
          const relativeY = targetY - headerHeight;
          scrollY = (relativeY / trackHeight) * dataHeight;
          scrollY = Math.max(0, Math.min(scrollY, dataHeight - (containerHeight - headerHeight)));
          requestAnimationFrame(render);
          return;
        }
      }
    }

    // 检查是否在水平滚动条区域（底部）
    if (showHScroll) {
      const hTrackY = containerHeight - scrollSize;
      const ratio = containerWidth / totalWidth;
      const sliderWidth = Math.max(30, containerWidth * ratio);
      const sliderX = (scrollX / totalWidth) * (containerWidth - scrollSize);

      if (y >= hTrackY) {
        if (x >= sliderX && x <= sliderX + sliderWidth) {
          // 点击在滑块上，开始拖动
          isDraggingHScroll = true;
          hScrollStartX = x - sliderX;
          e.preventDefault();
          return;
        } else {
          // 点击在滚动条轨道上
          const trackWidth = containerWidth - scrollSize;
          const targetX = Math.max(0, Math.min(x, trackWidth - scrollSize));
          scrollX = (targetX / trackWidth) * totalWidth;
          scrollX = Math.max(0, Math.min(scrollX, totalWidth - containerWidth));
          requestAnimationFrame(render);
          return;
        }
      }
    }

    // 列宽调整拖动
    for (let i = 0; i < visibleColumns && i < columnWidths.length; i++) {
      const borderX = getColumnStart(i) + columnWidths[i] - scrollX;
      if (Math.abs(x - borderX) < 5 && columnWidths[i] > 0) {
        isDragging = true;
        dragColumnIndex = i;
        dragOrigWidths = [...columnWidths];  // 保存原始列宽
        canvas.style.cursor = 'col-resize';
        return;
      }
    }

    // 计算点击的列索引
    let colIdx = -1;
    let colStartX = getColumnStart(0) - scrollX;
    for (let i = 0; i < visibleColumns && i < columnWidths.length; i++) {
      if (x >= colStartX && x < colStartX + columnWidths[i]) {
        colIdx = i;
        break;
      }
      colStartX += columnWidths[i];
    }

    // headerHeight 已在函数开头声明，直接使用
    const rowIdx = y < headerHeight ? -1 : Math.floor((y - headerHeight) / CONFIG.ROW_HEIGHT);

    if (colIdx >= 0 && rowIdx >= 0 && csvData) {
      selectedCell = { col: colIdx, row: rowIdx };
      requestAnimationFrame(render);
    }
  }

  function handleMouseUp() {
    isDragging = false;
    isDraggingVScroll = false;
    isDraggingHScroll = false;
    dragColumnIndex = -1;
    dragOrigWidths = null;  // 重置原始列宽
  }

  function handleScrollbarDrag(e) {
    if (!csvData) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 垂直滚动条拖动（从表头下方开始）
    if (isDraggingVScroll) {
      const headerHeight = CONFIG.HEADER_HEIGHT;
      const dataHeight = csvData.rows.length * CONFIG.ROW_HEIGHT;
      const trackHeight = containerHeight - headerHeight - scrollSize;
      const ratio = (containerHeight - headerHeight) / dataHeight;
      const sliderHeight = Math.max(30, (containerHeight - headerHeight) * ratio);
      const newSliderY = y - vScrollStartY;
      const clampedY = Math.max(headerHeight, Math.min(newSliderY, headerHeight + trackHeight - sliderHeight));
      const relativeY = clampedY - headerHeight;
      scrollY = (relativeY / trackHeight) * dataHeight;
      scrollY = Math.max(0, Math.min(scrollY, dataHeight - (containerHeight - headerHeight)));
      requestAnimationFrame(render);
    }

    // 水平滚动条拖动
    if (isDraggingHScroll) {
      const trackWidth = containerWidth - scrollSize;
      const ratio = containerWidth / totalWidth;
      const sliderWidth = Math.max(30, containerWidth * ratio);
      const newSliderX = x - hScrollStartX;
      const clampedX = Math.max(0, Math.min(newSliderX, trackWidth - sliderWidth));
      scrollX = (clampedX / trackWidth) * totalWidth;
      scrollX = Math.max(0, Math.min(scrollX, totalWidth - containerWidth));
      requestAnimationFrame(render);
    }
  }

  function handleMouseLeave() {
    hoveredCell = null;
    requestAnimationFrame(render);
  }

  function handleDoubleClick(e) {
    if (!csvData) return;

    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top + scrollY;

    // 如果点击的是表头区域，展开更多列
    if (y < CONFIG.HEADER_HEIGHT) {
      expandColumns();
    }
  }

  function expandColumns() {
    if (visibleColumns < csvData.totalColumns) {
      const oldVisible = visibleColumns;
      visibleColumns = Math.min(visibleColumns + 10, csvData.totalColumns);
      initColumnWidths();
      requestAnimationFrame(render);

      // 显示提示
      const info = document.getElementById('csvTableInfo');
      if (info) {
        info.textContent = `${csvData.totalRows}行 × ${csvData.totalColumns}列 (${oldVisible}→${visibleColumns}列)`;
      }
    }
  }

  // 暴露给外部的展开函数
  window.expandCSVColumns = expandColumns;

  function handleResize() {
    if (csvData) {
      updateContainerSize();
      requestAnimationFrame(render);
    }
  }

  function getColumnStart(colIndex) {
    let start = 0;
    for (let i = 0; i < colIndex && i < columnWidths.length; i++) {
      start += columnWidths[i];
    }
    return start;
  }

  function initColumnWidths() {
    if (!csvData) return;
    columnWidths = [];
    for (let i = 0; i < csvData.totalColumns; i++) {
      if (i < visibleColumns) {
        const headerLen = csvData.headers[i]?.length || 0;
        const maxContentLen = Math.max(headerLen, ...csvData.rows.slice(0, 100).map(r => String(r[i] || '').length));
        columnWidths[i] = Math.max(CONFIG.MIN_COLUMN_WIDTH, Math.min(CONFIG.DEFAULT_COLUMN_WIDTH * 2, maxContentLen * 8 + CONFIG.CELL_PADDING_X * 2));
      } else {
        columnWidths[i] = CONFIG.DEFAULT_COLUMN_WIDTH;
      }
    }
    // 保存原始列宽，用于恢复隐藏的列
    originalColumnWidths = [...columnWidths];
  }

  function updateContainerSize() {
    if (!container) return;
    const dpr = window.devicePixelRatio || 1;

    // 重置变换矩阵，确保每次都是干净的状态
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    containerWidth = container.clientWidth;
    containerHeight = container.clientHeight;

    // 设置实际像素大小
    canvas.width = Math.ceil(containerWidth * dpr);
    canvas.height = Math.ceil(containerHeight * dpr);

    // 应用缩放
    ctx.scale(dpr, dpr);

    // 强制重绘
    if (csvData) {
      requestAnimationFrame(render);
    }
  }

  // 强制更新容器尺寸（用于面板大小变化后，如最大化）
  function forceUpdateContainerSize() {
    if (!container) return;
    const dpr = window.devicePixelRatio || 1;

    // 重置变换矩阵
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 强制获取最新的容器尺寸
    containerWidth = container.clientWidth;
    containerHeight = container.clientHeight;

    canvas.width = Math.ceil(containerWidth * dpr);
    canvas.height = Math.ceil(containerHeight * dpr);
    ctx.scale(dpr, dpr);

    // 重置滚动位置
    scrollX = 0;
    scrollY = 0;

    if (csvData) {
      initColumnWidths();
      requestAnimationFrame(render);
    }
  }

  // 暴露给外部调用的重置函数
  window.resetCSVCanvas = forceUpdateContainerSize;

  function render() {
    if (!ctx || !csvData) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, containerWidth, containerHeight);

    const startRow = Math.floor(scrollY / CONFIG.ROW_HEIGHT);
    const endRow = Math.min(csvData.rows.length, Math.ceil((scrollY + containerHeight) / CONFIG.ROW_HEIGHT) + 5);
    totalWidth = columnWidths.slice(0, visibleColumns).reduce((a, b) => a + b, 0);

    // 先绘制数据行（会在表头下方）
    for (let row = startRow; row < endRow; row++) {
      drawRow(row);
    }

    // 最后绘制表头（确保在最上层）
    drawHeader();
    drawScrollbars(totalWidth);
  }

  function drawHeader() {
    const headerHeight = CONFIG.HEADER_HEIGHT;

    // 背景灰白色
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, containerWidth, headerHeight);

    // 绘制每列表头浅绿色高亮
    let x = -scrollX;
    for (let i = 0; i < visibleColumns && i < columnWidths.length; i++) {
      const colWidth = columnWidths[i];
      // 当前列浅绿色高亮
      if (hoveredCell && hoveredCell.col === i) {
        ctx.fillStyle = '#c8e6c9';
      } else {
        ctx.fillStyle = '#e8f5e9';
      }
      ctx.fillRect(x, 0, colWidth, headerHeight);
      x += colWidth;
    }

    // 绘制表头文字（跳过0宽度的列）
    ctx.fillStyle = '#333333';
    ctx.font = '500 11px sans-serif';
    ctx.textBaseline = 'middle';

    x = -scrollX;
    for (let i = 0; i < visibleColumns && i < csvData.headers.length; i++) {
      const colWidth = columnWidths[i];
      // 跳过0宽度的列
      if (colWidth <= 0) {
        x += colWidth;
        continue;
      }
      const text = csvData.headers[i] || `列${i + 1}`;
      let displayText = text;
      const maxWidth = colWidth - CONFIG.CELL_PADDING_X * 2;
      if (ctx.measureText(text).width > maxWidth) {
        while (ctx.measureText(displayText + '...').width > maxWidth && displayText.length > 0) {
          displayText = displayText.slice(0, -1);
        }
        displayText += '...';
      }
      ctx.fillText(displayText, x + CONFIG.CELL_PADDING_X, headerHeight / 2);
      x += colWidth;
    }

    // 底部边框
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, headerHeight);
    ctx.lineTo(containerWidth, headerHeight);
    ctx.stroke();
  }

  function drawRow(rowIndex) {
    const y = CONFIG.HEADER_HEIGHT + (rowIndex - Math.floor(scrollY / CONFIG.ROW_HEIGHT)) * CONFIG.ROW_HEIGHT - (scrollY % CONFIG.ROW_HEIGHT);
    const row = csvData.rows[rowIndex];

    if (rowIndex % 2 === 1) {
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(0, y, containerWidth, CONFIG.ROW_HEIGHT);
    }

    if (selectedCell && selectedCell.row === rowIndex) {
      ctx.fillStyle = 'rgba(102, 126, 234, 0.1)';
      ctx.fillRect(0, y, containerWidth, CONFIG.ROW_HEIGHT);
    }

    if (hoveredCell && hoveredCell.row === rowIndex) {
      ctx.fillStyle = 'rgba(102, 126, 234, 0.05)';
      ctx.fillRect(0, y, containerWidth, CONFIG.ROW_HEIGHT);
    }

    let x = -scrollX;
    ctx.fillStyle = '#333333';
    ctx.font = '12px Consolas, Monaco, monospace';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < visibleColumns && i < row.length; i++) {
      const colWidth = columnWidths[i];
      // 跳过0宽度的列
      if (colWidth <= 0) {
        x += colWidth;
        continue;
      }

      const text = String(row[i] || '');
      let displayText = text;
      const maxWidth = colWidth - CONFIG.CELL_PADDING_X * 2;

      // 处理文本截断
      if (ctx.measureText(text).width > maxWidth) {
        while (ctx.measureText(displayText + '...').width > maxWidth && displayText.length > 0) {
          displayText = displayText.slice(0, -1);
        }
        displayText += '...';
      }

      // 数值列右对齐，文本列左对齐
      const isNumberColumn = columnTypes[i] === 'number';
      let textX;
      if (isNumberColumn) {
        textX = x + colWidth - CONFIG.CELL_PADDING_X - ctx.measureText(displayText).width;
      } else {
        textX = x + CONFIG.CELL_PADDING_X;
      }

      ctx.fillText(displayText, textX, y + CONFIG.ROW_HEIGHT / 2);
      x += colWidth;
    }

    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 1;
    ctx.beginPath();
    x = -scrollX;
    for (let i = 0; i < visibleColumns && i < columnWidths.length; i++) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + CONFIG.ROW_HEIGHT);
      x += columnWidths[i];
    }
    ctx.moveTo(0, y + CONFIG.ROW_HEIGHT);
    ctx.lineTo(Math.min(totalWidth, containerWidth), y + CONFIG.ROW_HEIGHT);
    ctx.stroke();
  }

  function drawScrollbars(totalWidth) {
    const headerHeight = CONFIG.HEADER_HEIGHT;
    const dataHeight = csvData.rows.length * CONFIG.ROW_HEIGHT;
    const trackVHeight = containerHeight - headerHeight - scrollSize;
    const trackHWidth = containerWidth - scrollSize;

    // 垂直滚动条（右侧，从表头下方开始）
    if (containerHeight - headerHeight < dataHeight) {
      const ratio = (containerHeight - headerHeight) / dataHeight;
      const sliderHeight = Math.max(30, (containerHeight - headerHeight) * ratio);
      const sliderY = headerHeight + (scrollY / dataHeight) * trackVHeight;
      // 轨道（从表头下方开始）
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(containerWidth - scrollSize, headerHeight, scrollSize, containerHeight - headerHeight);
      // 滑块
      ctx.fillStyle = '#c0c0c0';
      ctx.fillRect(containerWidth - scrollSize, sliderY, scrollSize, sliderHeight);
    }

    // 水平滚动条（底部）
    if (containerWidth < totalWidth) {
      const ratio = containerWidth / totalWidth;
      const sliderWidth = Math.max(30, containerWidth * ratio);
      const sliderX = (scrollX / totalWidth) * trackHWidth;
      // 轨道
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, containerHeight - scrollSize, containerWidth, scrollSize);
      // 滑块
      ctx.fillStyle = '#c0c0c0';
      ctx.fillRect(sliderX, containerHeight - scrollSize, sliderWidth, scrollSize);
    }
  }

  function parseCSVWithWorker(lines) {
    return new Promise(async (resolve) => {
      try {
        // 将行数组合并为文本
        const text = lines.join('\n');

        // 使用 Papa Parse 解析
        const result = await CSVParser.parse(text);

        if (!result.success) {
          throw new Error(result.error);
        }

        resolve({
          headers: result.data[0] || [],
          rows: result.data.slice(1),
          totalRows: result.data.length,
          totalColumns: result.maxColumns
        });
      } catch (e) {
        console.warn('[CSV] Papa Parse 失败:', e);
        resolve({
          headers: [],
          rows: [],
          totalRows: 0,
          totalColumns: 0
        });
      }
    });
  }

  async function showCSVTable(lines, options = {}) {
    // 🔧 不再重置选中列状态，稍后会默认选中所有列

    originalColumnWidths = [];  // 重置原始列宽

    csvData = await parseCSVWithWorker(lines);
    console.log(`[CSV Renderer] 解析完成: ${csvData.totalRows}行`);

    // 🔧 默认选中所有列
    selectedColumns = new Set();
    for (let i = 0; i < csvData.totalColumns; i++) {
      selectedColumns.add(i);
    }

    visibleColumns = csvData.totalColumns;  // 显示所有列
    console.log(`[CSV Renderer] 开始渲染，显示所有 ${visibleColumns} 列`);

    // 检测每列的数据类型
    detectColumnTypes();

    const panel = document.getElementById('csvTablePanel');
    const placeholder = document.getElementById('csvTablePlaceholder');
    const info = document.getElementById('csvTableInfo');

    if (!panel || !placeholder) {
      console.error('[CSV Renderer] 面板元素未找到');
      return;
    }

    // 默认全屏显示（占满整个屏幕）
    panel.classList.add('fullscreen');
    panel.classList.add('visible');
    panel.style.display = 'flex';
    panel.style.width = '100vw';
    panel.style.height = '100vh';
    panel.style.top = '0';
    panel.style.left = '0';
    panel.style.transform = 'none';

    placeholder.style.display = 'none';
    container.classList.add('has-data');

    if (info) {
      info.textContent = `${csvData.totalRows}行 × ${csvData.totalColumns}列 (${visibleColumns}列/共${csvData.totalColumns}列)`;
    }

    await new Promise(r => setTimeout(r, 150));
    updateContainerSize();
    console.log(`[CSV Renderer] 容器: ${containerWidth}x${containerHeight}`);

    if (containerWidth > 0 && containerHeight > 0) {
      initColumnWidths();
      scrollX = 0;
      scrollY = 0;
      requestAnimationFrame(render);
      console.log('[CSV Renderer] Canvas 渲染完成');
    } else {
      console.warn('[CSV Renderer] 容器大小异常');
    }
  }

  function hideCSVTable() {
    csvData = null;
    if (container) container.classList.remove('has-data');
  }

  // ========== 功能1: 导出为CSV ==========
  function exportToCSV() {
    if (!csvData) return;

    // 构建CSV内容
    let csvContent = '';

    // 添加表头
    csvContent += csvData.headers.map(h => `"${String(h || '').replace(/"/g, '""')}"`).join(',') + '\n';

    // 添加数据行
    for (const row of csvData.rows) {
      csvContent += row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',') + '\n';
    }

    // 创建Blob并下载
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `export_${new Date().getTime()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showMessage(`已导出 ${csvData.totalRows} 行数据`);
  }

  // ========== 功能2: 检测列类型（用于右对齐）==========
  function detectColumnTypes() {
    if (!csvData) return;

    columnTypes = [];
    for (let colIndex = 0; colIndex < csvData.totalColumns; colIndex++) {
      let numberCount = 0;
      let totalRows = 0;

      // 采样前100行检测
      const sampleSize = Math.min(100, csvData.rows.length);
      for (let rowIndex = 0; rowIndex < sampleSize; rowIndex++) {
        const cellValue = csvData.rows[rowIndex][colIndex];
        if (cellValue === null || cellValue === undefined || cellValue === '') continue;

        totalRows++;
        // 检测是否为数值
        if (typeof cellValue === 'number' || (!isNaN(cellValue) && cellValue !== '')) {
          numberCount++;
        }
      }

      // 如果超过80%的值是数值，则认为是数值列
      if (totalRows > 0 && numberCount / totalRows > 0.8) {
        columnTypes[colIndex] = 'number';
      } else {
        columnTypes[colIndex] = 'text';
      }
    }

    console.log('[CSV Renderer] 列类型检测完成:', columnTypes);
  }

  // 检查 PapaParse 是否已加载
  if (typeof Papa === 'undefined') {
    console.error('[CSV Renderer] PapaParse 库未加载，请确保 PapaParse 已正确引入');
  }

  // ========== 🔧 通用曲线图绘制功能 ==========
  let chartCanvas = null;
  let chartCtx = null;
  let chartData = null;
  let zoomLevel = 1;
  let offsetX = 0;
  let mousePos = { x: -1, y: -1 };
  let isResizing = false;
  let resizePosition = '';
  let chartResizeStart = { x: 0, y: 0, width: 0, height: 0 };

  // 列配置：每列的显示状态、Y轴范围、单位、颜色
  let columnConfigs = [];

  // 预定义颜色列表
  const CHART_COLORS = [
    '#22c55e', '#3b82f6', '#ef4444', '#f59e0b', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
  ];

  function showBatteryChart() {
    if (!csvData || !csvData.headers || !csvData.rows) {
      showMessage('没有可用的数据');
      return;
    }

    // 显示弹窗
    const dialog = document.getElementById('csvChartDialog');
    if (dialog) {
      dialog.style.display = 'flex';
    }

    // 重置缩放
    zoomLevel = 1;
    offsetX = 0;
    mousePos = { x: -1, y: -1 };

    // 初始化列配置
    initializeColumnConfigs();

    // 等待DOM渲染完成后设置Canvas
    setTimeout(() => {
      chartCanvas = document.getElementById('csvChartCanvas');
      if (!chartCanvas) return;

      // 设置Canvas尺寸
      const rect = chartCanvas.parentElement.getBoundingClientRect();
      chartCanvas.width = rect.width - 40;
      chartCanvas.height = Math.min(600, window.innerHeight * 0.6);
      chartCtx = chartCanvas.getContext('2d');

      // 绑定事件
      chartCanvas.addEventListener('wheel', handleChartWheel, { passive: false });
      chartCanvas.addEventListener('mousemove', handleChartMouseMove);
      chartCanvas.addEventListener('mouseleave', () => {
        mousePos = { x: -1, y: -1 };
        drawChart();
      });

      // 绑定配置按钮
      const configBtn = document.getElementById('csvChartConfigBtn');
      if (configBtn) {
        configBtn.addEventListener('click', showConfigPanel);
      }

      // 绑定头部拖动功能
      bindChartDialogDrag();

      // 绑定大小调整手柄
      bindResizeHandles();

      // 直接显示配置面板
      showConfigPanel();
    }, 100);
  }

  function bindResizeHandles() {
    const handles = document.querySelectorAll('.resize-handle');
    const content = document.getElementById('csvChartDialogContent');
    if (!content) return;

    console.log(`[bindResizeHandles] Found ${handles.length} resize handles`);

    handles.forEach((handle, index) => {
      console.log(`[bindResizeHandles] Handle ${index}: position=${handle.dataset.position}`);
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        isResizing = true;
        resizePosition = handle.dataset.position;
        chartResizeStart = {
          x: e.clientX,
          y: e.clientY,
          width: content.offsetWidth,
          height: content.offsetHeight
        };

        console.log(`[bindResizeHandles] Started resizing: position=${resizePosition}, startSize=${chartResizeStart.width}x${chartResizeStart.height}`);

        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);
      });
    });
  }

  // 图表对话框拖动功能
  let isDraggingChart = false;
  let chartDragOffset = { x: 0, y: 0 };

  function bindChartDialogDrag() {
    const header = document.getElementById('csvChartDialogHeader');
    const content = document.getElementById('csvChartDialogContent');
    if (!header || !content) return;

    header.addEventListener('mousedown', (e) => {
      // 不在按钮上时才开始拖动
      if (e.target.tagName === 'BUTTON') return;

      e.preventDefault();
      isDraggingChart = true;

      const rect = content.getBoundingClientRect();
      chartDragOffset.x = e.clientX - rect.left;
      chartDragOffset.y = e.clientY - rect.top;

      // 将对话框改为固定定位以便拖动
      content.style.position = 'fixed';
      content.style.margin = '0';
      content.style.transform = 'none';

      document.addEventListener('mousemove', handleChartDragMove);
      document.addEventListener('mouseup', handleChartDragEnd);
    });
  }

  function handleChartDragMove(e) {
    if (!isDraggingChart) return;

    const content = document.getElementById('csvChartDialogContent');
    if (!content) return;

    const newLeft = e.clientX - chartDragOffset.x;
    const newTop = e.clientY - chartDragOffset.y;

    // 限制在视口内
    const maxX = window.innerWidth - content.offsetWidth;
    const maxY = window.innerHeight - content.offsetHeight;

    content.style.left = Math.max(0, Math.min(maxX, newLeft)) + 'px';
    content.style.top = Math.max(0, Math.min(maxY, newTop)) + 'px';
  }

  function handleChartDragEnd() {
    isDraggingChart = false;
    document.removeEventListener('mousemove', handleChartDragMove);
    document.removeEventListener('mouseup', handleChartDragEnd);
  }

  function handleResizeMove(e) {
    if (!isResizing) return;

    const content = document.getElementById('csvChartDialogContent');
    if (!content) return;

    const deltaX = e.clientX - chartResizeStart.x;
    const deltaY = e.clientY - chartResizeStart.y;
    let newWidth = chartResizeStart.width;
    let newHeight = chartResizeStart.height;

    console.log(`[Resize] position=${resizePosition}, deltaX=${deltaX}, deltaY=${deltaY}, startW=${chartResizeStart.width}, startH=${chartResizeStart.height}`);

    switch (resizePosition) {
      case 'n': // 上边
        newHeight = chartResizeStart.height - deltaY;
        break;
      case 'e': // 右边
        newWidth = chartResizeStart.width + deltaX;
        console.log(`[Resize] E edge: newWidth=${newWidth}`);
        break;
      case 's': // 下边
        newHeight = chartResizeStart.height + deltaY;
        break;
      case 'w': // 左边
        newWidth = chartResizeStart.width - deltaX;
        console.log(`[Resize] W edge: newWidth=${newWidth}`);
        break;
      case 'se': // 右下角
        newWidth = chartResizeStart.width + deltaX;
        newHeight = chartResizeStart.height + deltaY;
        break;
      case 'sw': // 左下角
        newWidth = chartResizeStart.width - deltaX;
        newHeight = chartResizeStart.height + deltaY;
        break;
      case 'ne': // 右上角
        newWidth = chartResizeStart.width + deltaX;
        newHeight = chartResizeStart.height - deltaY;
        break;
      case 'nw': // 左上角
        newWidth = chartResizeStart.width - deltaX;
        newHeight = chartResizeStart.height - deltaY;
        break;
    }

    // 限制最小尺寸
    newWidth = Math.max(400, newWidth);
    newHeight = Math.max(300, newHeight);
    newWidth = Math.min(window.innerWidth * 0.98, newWidth);
    newHeight = Math.min(window.innerHeight * 0.9, newHeight);

    console.log(`[Resize] Final: width=${newWidth}, height=${newHeight}`);
    content.style.width = newWidth + 'px';
    content.style.height = newHeight + 'px';

    // 重新设置Canvas尺寸并重绘
    if (chartCanvas) {
      chartCanvas.width = chartCanvas.parentElement.offsetWidth - 40;
      chartCanvas.height = chartCanvas.parentElement.offsetHeight - 100;
      drawChart();
    }
  }

  function handleResizeEnd() {
    isResizing = false;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  }

  function initializeColumnConfigs() {
    columnConfigs = [];

    csvData.headers.forEach((header, index) => {
      // 提取该列的所有数值数据
      const values = [];
      for (let i = 0; i < Math.min(csvData.rows.length, 1000); i++) {
        const val = parseFloat(csvData.rows[i][index]);
        if (!isNaN(val)) {
          values.push(val);
        }
      }

      if (values.length === 0) return;

      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);

      // 自动检测单位
      let unit = '';
      const headerLower = String(header).toLowerCase();
      if (headerLower.includes('v') || headerLower.includes('volt')) {
        unit = 'mV';
      } else if (headerLower.includes('i') || headerLower.includes('curr')) {
        unit = 'mA';
      } else if (headerLower.includes('temp')) {
        unit = '°C';
      } else if (headerLower.includes('p') || headerLower.includes('power')) {
        unit = 'mW';
      }

      columnConfigs.push({
        index: index,
        name: header,
        visible: false,  // 默认不显示
        color: CHART_COLORS[columnConfigs.length % CHART_COLORS.length],
        unit: unit,
        yMin: minVal,
        yMax: maxVal,
        autoRange: true,
        data: []
      });

      // 提取完整数据
      const config = columnConfigs[columnConfigs.length - 1];
      for (let i = 0; i < csvData.rows.length; i++) {
        const val = parseFloat(csvData.rows[i][index]);
        config.data.push(isNaN(val) ? null : val);
      }
    });

    console.log('[CSV Chart] 列配置初始化完成:', columnConfigs);
  }

  function showConfigPanel() {
    const panel = document.getElementById('csvChartConfigPanel');
    if (!panel) return;

    panel.style.display = 'flex';
    renderConfigList();

    // 绑定关闭按钮
    const closeBtn = document.getElementById('csvChartConfigClose');
    if (closeBtn) {
      closeBtn.onclick = () => {
        panel.style.display = 'none';
      };
    }

    // 绑定重置按钮
    const resetBtn = document.getElementById('csvChartConfigReset');
    if (resetBtn) {
      resetBtn.onclick = resetColumnConfigs;
    };

    // 绑定应用按钮
    const applyBtn = document.getElementById('csvChartConfigApply');
    if (applyBtn) {
      applyBtn.onclick = applyColumnConfigs;
    }

    // 点击面板外部关闭
    panel.onclick = (e) => {
      if (e.target === panel) {
        panel.style.display = 'none';
      }
    };
  }

  function renderConfigList() {
    const listContainer = document.getElementById('csvChartConfigList');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    columnConfigs.forEach((config, index) => {
      const item = document.createElement('div');
      item.className = 'csv-chart-column-config';

      const dataRange = `${Math.min(...config.data.filter(v => v !== null)).toFixed(2)} ~ ${Math.max(...config.data.filter(v => v !== null)).toFixed(2)}`;

      item.innerHTML = `
        <input type="checkbox" class="csv-chart-column-checkbox" ${config.visible ? 'checked' : ''} data-index="${index}">
        <div class="csv-chart-column-info">
          <div class="csv-chart-column-name">${config.name}</div>
          <div class="csv-chart-column-meta">数据范围: ${dataRange}</div>
        </div>
        <div class="csv-chart-column-settings">
          <select class="csv-chart-column-select" data-index="${index}" data-field="unit">
            <option value="" ${!config.unit ? 'selected' : ''}>无单位</option>
            <option value="mV" ${config.unit === 'mV' ? 'selected' : ''}>mV</option>
            <option value="mA" ${config.unit === 'mA' ? 'selected' : ''}>mA</option>
            <option value="°C" ${config.unit === '°C' ? 'selected' : ''}>°C</option>
            <option value="mW" ${config.unit === 'mW' ? 'selected' : ''}>mW</option>
            <option value="V" ${config.unit === 'V' ? 'selected' : ''}>V</option>
            <option value="A" ${config.unit === 'A' ? 'selected' : ''}>A</option>
            <option value="W" ${config.unit === 'W' ? 'selected' : ''}>W</option>
            <option value="%" ${config.unit === '%' ? 'selected' : ''}>%</option>
            <option value="custom">自定义...</option>
          </select>
          <input type="number" class="csv-chart-column-input" data-index="${index}" data-field="yMin" placeholder="最小值" value="${config.yMin.toFixed(2)}">
          <input type="number" class="csv-chart-column-input" data-index="${index}" data-field="yMax" placeholder="最大值" value="${config.yMax.toFixed(2)}">
          <div class="csv-chart-column-color" style="background: ${config.color}" data-index="${index}" title="点击更换颜色"></div>
        </div>
      `;

      listContainer.appendChild(item);
    });

    // 绑定事件
    listContainer.querySelectorAll('.csv-chart-column-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        columnConfigs[index].visible = e.target.checked;
      });
    });

    listContainer.querySelectorAll('.csv-chart-column-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        const value = e.target.value;

        if (value === 'custom') {
          const customUnit = prompt('请输入自定义单位:', columnConfigs[index].unit);
          if (customUnit !== null) {
            columnConfigs[index].unit = customUnit;
          }
          e.target.value = ''; // 重置选择
        } else {
          columnConfigs[index].unit = value;
        }
      });
    });

    listContainer.querySelectorAll('.csv-chart-column-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        const field = e.target.dataset.field;
        const value = parseFloat(e.target.value);

        if (!isNaN(value)) {
          columnConfigs[index][field] = value;
          columnConfigs[index].autoRange = false;
        }
      });
    });

    listContainer.querySelectorAll('.csv-chart-column-color').forEach(colorBox => {
      colorBox.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        const currentIndex = CHART_COLORS.indexOf(columnConfigs[index].color);
        const nextIndex = (currentIndex + 1) % CHART_COLORS.length;
        columnConfigs[index].color = CHART_COLORS[nextIndex];
        e.target.style.background = CHART_COLORS[nextIndex];
      });
    });
  }

  function resetColumnConfigs() {
    columnConfigs.forEach(config => {
      config.visible = false;
      config.autoRange = true;

      // 重新计算范围
      const values = config.data.filter(v => v !== null);
      if (values.length > 0) {
        config.yMin = Math.min(...values);
        config.yMax = Math.max(...values);
      }
    });

    renderConfigList();
  }

  function applyColumnConfigs() {
    const panel = document.getElementById('csvChartConfigPanel');
    if (panel) {
      panel.style.display = 'none';
    }

    // 创建快速切换开关
    createQuickToggles();

    drawChart();
  }

  function createQuickToggles() {
    const togglesContainer = document.getElementById('csvChartQuickToggles');
    if (!togglesContainer) return;

    togglesContainer.innerHTML = '';

    // 为所有配置的列创建快速开关（只显示用户选择的列）
    const selectedConfigs = columnConfigs.filter(c => c.visible);

    if (selectedConfigs.length === 0) {
      togglesContainer.innerHTML = '<span style="font-size: 11px; color: #155724;">点击"配置"选择列</span>';
      return;
    }

    selectedConfigs.forEach((config) => {
      const toggle = document.createElement('label');
      toggle.className = 'csv-chart-quick-toggle';
      toggle.innerHTML = `
        <input type="checkbox" checked data-index="${config.index}">
        <div class="csv-chart-quick-toggle-color" style="background: ${config.color}"></div>
        <span class="csv-chart-quick-toggle-label">${config.name}</span>
      `;

      toggle.querySelector('input').addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        columnConfigs[index].visible = e.target.checked;
        drawChart();
      });

      togglesContainer.appendChild(toggle);
    });
  }

  function hideBatteryChart() {
    const dialog = document.getElementById('csvChartDialog');
    const configPanel = document.getElementById('csvChartConfigPanel');

    if (dialog) {
      dialog.style.display = 'none';
    }
    if (configPanel) {
      configPanel.style.display = 'none';
    }

    // 移除事件监听
    if (chartCanvas) {
      chartCanvas.removeEventListener('wheel', handleChartWheel);
      chartCanvas.removeEventListener('mousemove', handleChartMouseMove);
    }
    chartData = null;
    columnConfigs = [];
  }

  function handleChartWheel(e) {
    e.preventDefault();

    const rect = chartCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const padding = { top: 40, right: 100, bottom: 50, left: 70 };
    const chartWidth = chartCanvas.width - padding.left - padding.right;

    const oldZoomLevel = zoomLevel;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomLevel *= delta;
    zoomLevel = Math.max(1, Math.min(zoomLevel, 50));

    // 调整 offsetX，使得鼠标位置的数据点保持不变（以鼠标为中心向两边缩放）
    const dataPoints = csvData.rows.length;
    const oldVisiblePoints = Math.min(dataPoints, Math.ceil(dataPoints / oldZoomLevel));
    const newVisiblePoints = Math.min(dataPoints, Math.ceil(dataPoints / zoomLevel));

    // 当前视图起始索引和鼠标位置对应的数据点
    const oldStartIndex = Math.floor(offsetX / chartWidth * dataPoints / oldZoomLevel);
    const mouseRatio = Math.max(0, Math.min(1, (mouseX - padding.left) / chartWidth));
    const mouseDataIndex = oldStartIndex + mouseRatio * oldVisiblePoints;

    // 缩放后，调整 offsetX 使得鼠标位置的数据点保持在鼠标下方
    const newStartIndex = mouseDataIndex - mouseRatio * newVisiblePoints;
    offsetX = newStartIndex * chartWidth / dataPoints * zoomLevel;

    drawChart();
  }

  function handleChartMouseMove(e) {
    const rect = chartCanvas.getBoundingClientRect();
    mousePos = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    drawChart();
  }

  function drawChart() {
    if (!chartCtx || !csvData) return;

    const width = chartCanvas.width;
    const height = chartCanvas.height;
    const padding = { top: 40, right: 100, bottom: 50, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // 清空画布
    chartCtx.clearRect(0, 0, width, height);
    chartCtx.fillStyle = '#fafafa';
    chartCtx.fillRect(0, 0, width, height);

    const visibleConfigs = columnConfigs.filter(c => c.visible && c.data.length > 0);
    if (visibleConfigs.length === 0) {
      chartCtx.fillStyle = '#999';
      chartCtx.font = '16px Arial';
      chartCtx.textAlign = 'center';
      chartCtx.fillText('请点击"配置曲线"选择要显示的列', width / 2, height / 2);
      return;
    }

    const dataPoints = csvData.rows.length;
    const visiblePoints = Math.min(dataPoints, Math.ceil(dataPoints / zoomLevel));
    const startIndex = Math.min(dataPoints - visiblePoints, Math.floor(offsetX / chartWidth * dataPoints / zoomLevel));

    // 绘制网格线
    chartCtx.strokeStyle = '#e0e0e0';
    chartCtx.lineWidth = 1;
    chartCtx.setLineDash([5, 5]);

    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (chartHeight / 5) * i;
      chartCtx.beginPath();
      chartCtx.moveTo(padding.left, y);
      chartCtx.lineTo(width - padding.right, y);
      chartCtx.stroke();
    }
    chartCtx.setLineDash([]);

    // 为每条曲线分配Y轴位置
    const yAxes = [];
    if (visibleConfigs.length === 1) {
      yAxes.push({ position: 'left', color: visibleConfigs[0].color });
    } else if (visibleConfigs.length === 2) {
      yAxes.push({ position: 'left', color: visibleConfigs[0].color });
      yAxes.push({ position: 'right', color: visibleConfigs[1].color });
    } else {
      yAxes.push({ position: 'left', color: visibleConfigs[0].color });
      for (let i = 1; i < visibleConfigs.length - 1; i++) {
        yAxes.push({ position: 'inner', color: visibleConfigs[i].color, offset: 10 + (i - 1) * 60 });
      }
      yAxes.push({ position: 'right', color: visibleConfigs[visibleConfigs.length - 1].color });
    }

    // 绘制Y轴标签
    chartCtx.font = '11px Arial';
    chartCtx.textBaseline = 'middle';

    visibleConfigs.forEach((config, idx) => {
      const axis = yAxes[idx];
      chartCtx.fillStyle = axis.color;

      if (axis.position === 'left') {
        chartCtx.textAlign = 'right';
        for (let i = 0; i <= 5; i++) {
          const value = config.yMax - ((config.yMax - config.yMin) / 5) * i;
          const y = padding.top + (chartHeight / 5) * i;
          chartCtx.fillText(value.toFixed(1) + (config.unit || ''), padding.left - 10, y);
        }
      } else if (axis.position === 'right') {
        chartCtx.textAlign = 'left';
        for (let i = 0; i <= 5; i++) {
          const value = config.yMax - ((config.yMax - config.yMin) / 5) * i;
          const y = padding.top + (chartHeight / 5) * i;
          chartCtx.fillText(value.toFixed(1) + (config.unit || ''), width - padding.right + 10, y);
        }
      } else {
        chartCtx.textAlign = 'left';
        for (let i = 0; i <= 5; i++) {
          const value = config.yMax - ((config.yMax - config.yMin) / 5) * i;
          const y = padding.top + (chartHeight / 5) * i;
          chartCtx.fillText(value.toFixed(1) + (config.unit || ''), padding.left + axis.offset, y);
        }
      }
    });

    // 绘制X轴标签
    chartCtx.fillStyle = '#666';
    chartCtx.textAlign = 'center';
    chartCtx.textBaseline = 'top';
    const xStep = Math.max(1, Math.floor(visiblePoints / 10));
    for (let i = 0; i < visiblePoints; i += xStep) {
      const dataIndex = startIndex + i;
      if (dataIndex >= dataPoints) break;
      const x = padding.left + (chartWidth / visiblePoints) * i;
      chartCtx.fillText(dataIndex.toString(), x, height - padding.bottom + 10);
    }

    // 绘制曲线
    const drawLine = (data, color, minVal, maxVal) => {
      if (data.length === 0 || maxVal === minVal) return;

      chartCtx.beginPath();
      chartCtx.strokeStyle = color;
      chartCtx.lineWidth = 2;

      for (let i = 0; i < visiblePoints; i++) {
        const dataIndex = startIndex + i;
        if (dataIndex >= data.length) break;
        if (data[dataIndex] === null) continue;

        const x = padding.left + (chartWidth / visiblePoints) * i;
        const normalizedValue = (data[dataIndex] - minVal) / (maxVal - minVal);
        const y = padding.top + chartHeight * (1 - normalizedValue);

        if (i === 0) {
          chartCtx.moveTo(x, y);
        } else {
          chartCtx.lineTo(x, y);
        }
      }
      chartCtx.stroke();
    };

    visibleConfigs.forEach(config => {
      drawLine(config.data, config.color, config.yMin, config.yMax);
    });

    // 绘制鼠标悬停信息
    if (mousePos.x >= padding.left && mousePos.x <= width - padding.right &&
        mousePos.y >= padding.top && mousePos.y <= height - padding.bottom) {

      const dataIndex = Math.round(((mousePos.x - padding.left) / chartWidth) * visiblePoints) + startIndex;
      if (dataIndex >= 0 && dataIndex < dataPoints) {
        const x = padding.left + ((dataIndex - startIndex) / visiblePoints) * chartWidth;

        // 绘制垂直指示线
        chartCtx.beginPath();
        chartCtx.strokeStyle = 'rgba(0,0,0,0.3)';
        chartCtx.lineWidth = 1;
        chartCtx.setLineDash([5, 5]);
        chartCtx.moveTo(x, padding.top);
        chartCtx.lineTo(x, height - padding.bottom);
        chartCtx.stroke();
        chartCtx.setLineDash([]);

        // 绘制数据点
        visibleConfigs.forEach(config => {
          if (dataIndex >= config.data.length || config.data[dataIndex] === null) return;

          const normalizedValue = (config.data[dataIndex] - config.yMin) / (config.yMax - config.yMin);
          const y = padding.top + chartHeight * (1 - normalizedValue);

          chartCtx.beginPath();
          chartCtx.fillStyle = config.color;
          chartCtx.arc(x, y, 5, 0, Math.PI * 2);
          chartCtx.fill();
          chartCtx.strokeStyle = 'white';
          chartCtx.lineWidth = 2;
          chartCtx.stroke();
        });

        // 显示数据提示框
        const tooltip = [];
        visibleConfigs.forEach(config => {
          if (dataIndex < config.data.length && config.data[dataIndex] !== null) {
            tooltip.push(`${config.name}: ${config.data[dataIndex].toFixed(2)}${config.unit}`);
          }
        });

        // 如果没有数据，不显示tooltip
        if (tooltip.length === 0) return;

        const tooltipPadding = 8;
        const tooltipWidth = 240;
        const tooltipHeight = tooltip.length * 20 + tooltipPadding * 2;
        let tooltipX = mousePos.x + 15;
        let tooltipY = mousePos.y + 15;

        if (tooltipX + tooltipWidth > width) {
          tooltipX = mousePos.x - tooltipWidth - 15;
        }
        if (tooltipY + tooltipHeight > height) {
          tooltipY = mousePos.y - tooltipHeight - 15;
        }

        chartCtx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        chartCtx.beginPath();
        chartCtx.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 6);
        chartCtx.fill();

        chartCtx.fillStyle = 'white';
        chartCtx.font = '13px Arial';
        chartCtx.textAlign = 'left';
        chartCtx.textBaseline = 'top';

        tooltip.forEach((line, i) => {
          chartCtx.fillText(line, tooltipX + tooltipPadding, tooltipY + tooltipPadding + i * 20);
        });
      }
    }

    // 绘制图例（底部只显示可见曲线的简单图例）
    const legend = document.getElementById('csvChartLegend');
    if (legend) {
      legend.innerHTML = '';

      visibleConfigs.forEach(config => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
          <div class="legend-color" style="background: ${config.color}"></div>
          <span>${config.name}</span>
          <span style="color: #999; font-size: 12px;">(${config.data.filter(v => v !== null).length}点)</span>
        `;
        legend.appendChild(item);
      });

      // 添加操作提示
      const hint = document.createElement('div');
      hint.className = 'legend-item';
      hint.style.marginLeft = '20px';
      hint.style.fontSize = '12px';
      hint.style.color = '#999';
      hint.innerHTML = '💡 滚轮缩放 | 鼠标悬停查看数值';
      legend.appendChild(hint);
    }
  }

  init();

  window.CSVTableRenderer = {
    show: showCSVTable,
    hide: hideCSVTable
  };

  console.log('[CSV Renderer] CSVTableRenderer 已挂载到 window');
})();
