/**
 * 二级过滤面板 Canvas 渲染器
 * 高性能虚拟滚动，支持大数据量
 */

(function() {
  const CONFIG = {
    ROW_HEIGHT: 22,
    FONT_SIZE: 14,
    LINE_NUMBER_WIDTH: 0,
    SCROLLBAR_SIZE: 12,
    PADDING_X: 8
  };

  let canvas = null;
  let ctx = null;
  let container = null;

  // 数据
  let data = [];           // 行内容
  let primaryIndices = []; // 主过滤器索引
  let originalIndices = []; // 原始索引
  let lineNumbers = [];    // 行号
  let keywords = [];       // 过滤关键词（用于高亮）

  // 自定义高亮关键词
  let highlightKeywords = []; // [{ keyword: 'error', color: 'rgba(255, 0, 0, 0.3)' }]
  const highlightColors = [
    'rgba(255, 99, 71, 0.35)',    // 番茄红
    'rgba(32, 178, 170, 0.35)',   // 浅海洋绿
    'rgba(138, 43, 226, 0.35)',   // 蓝紫色
    'rgba(255, 165, 0, 0.35)',    // 橙色
    'rgba(50, 205, 50, 0.35)',    // 酸橙绿
    'rgba(0, 191, 255, 0.35)',    // 深天蓝
    'rgba(255, 20, 147, 0.35)',   // 深粉色
    'rgba(106, 90, 205, 0.35)',   // 板岩蓝
  ];

  // 滚动状态
  let scrollX = 0;
  let scrollY = 0;
  let containerWidth = 0;
  let containerHeight = 0;
  let totalWidth = 0;
  let contentWidth = 0;

  // 交互状态
  let hoveredRow = -1;
  let selectedRow = -1;
  let isDraggingVScroll = false;
  let isDraggingHScroll = false;
  let vScrollStartY = 0;
  let hScrollStartX = 0;

  // 性能优化：渲染调度
  let isRenderScheduled = false;
  let isRenderingPaused = false;

  function init() {
    container = document.getElementById('secondaryFilterSidebarContent');
    if (!container) {
      console.error('[SecondaryFilterCanvas] 找不到容器元素');
      return;
    }

    // 隐藏原有的虚拟内容
    const virtualContent = document.getElementById('secondaryFilterSidebarVirtualContent');
    if (virtualContent) {
      virtualContent.style.display = 'none';
    }

    // 创建Canvas
    canvas = document.createElement('canvas');
    canvas.id = 'secondaryFilterCanvas';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    ctx = canvas.getContext('2d', { alpha: false });

    bindEvents();

    // 暴露全局API
    window.SecondaryFilterCanvas = {
      setData,
      clear,
      scrollToTop,
      pauseRendering,
      resumeRendering,
      forceUpdate,
      getScrollPosition,
      setScrollPosition,
      addHighlightKeyword,
      removeHighlightKeyword,
      clearHighlightKeywords,
      getHighlightKeywords
    };

    console.log('[SecondaryFilterCanvas] 初始化完成');
  }

  function updateContainerSize() {
    if (!container || !canvas) return;

    // 重置变换矩阵
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    containerWidth = container.clientWidth;
    containerHeight = container.clientHeight;

    // 设置Canvas的实际像素大小和CSS显示大小为相同值，避免浏览器缩放
    canvas.width = containerWidth;
    canvas.height = containerHeight;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = containerHeight + 'px';

    scheduleRender();
  }

  function bindEvents() {
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // 全局滚动条事件
    document.addEventListener('mouseup', () => {
      isDraggingVScroll = false;
      isDraggingHScroll = false;
    });

    document.addEventListener('mousemove', handleScrollbarDrag);

    // 窗口调整大小
    window.addEventListener('resize', () => {
      if (!isRenderingPaused) {
        updateContainerSize();
      }
    });
  }

  function handleWheel(e) {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;

    // Alt+滚轮 或 在底部区域时水平滚动
    if (e.altKey || (mouseY > containerHeight - 25 && contentWidth > containerWidth - CONFIG.SCROLLBAR_SIZE)) {
      // 水平滚动 - 增加步长，每次滚动更多内容
      const delta = e.deltaY > 0 ? 150 : -150;
      const maxScroll = Math.max(0, contentWidth - (containerWidth - CONFIG.SCROLLBAR_SIZE));
      scrollX = Math.max(0, Math.min(scrollX + delta, maxScroll));
    } else {
      // 垂直滚动
      const dataHeight = data.length * CONFIG.ROW_HEIGHT;
      const maxScroll = Math.max(0, dataHeight - containerHeight);
      const delta = e.deltaY > 0 ? CONFIG.ROW_HEIGHT * 3 : -CONFIG.ROW_HEIGHT * 3;
      scrollY = Math.max(0, Math.min(scrollY + delta, maxScroll));
    }

    scheduleRender();
  }

  function handleMouseMove(e) {
    if (isDraggingVScroll || isDraggingHScroll) return;

    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top + scrollY;

    const row = Math.floor(y / CONFIG.ROW_HEIGHT);

    if (row !== hoveredRow && row >= 0 && row < data.length) {
      hoveredRow = row;
      scheduleRender();
    }
  }

  function handleMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const dataHeight = data.length * CONFIG.ROW_HEIGHT;
    const showVScroll = containerHeight < dataHeight;
    const showHScroll = contentWidth > containerWidth;

    // 检查是否在垂直滚动条区域
    if (showVScroll) {
      const vTrackX = containerWidth - CONFIG.SCROLLBAR_SIZE;
      const ratio = containerHeight / dataHeight;
      const sliderHeight = Math.max(30, containerHeight * ratio);
      const sliderY = (scrollY / dataHeight) * (containerHeight - CONFIG.SCROLLBAR_SIZE);

      if (x >= vTrackX) {
        if (y >= sliderY && y <= sliderY + sliderHeight) {
          isDraggingVScroll = true;
          vScrollStartY = y - sliderY;
          e.preventDefault();
          return;
        } else {
          const targetY = Math.max(0, Math.min(y, containerHeight - CONFIG.SCROLLBAR_SIZE));
          scrollY = (targetY / (containerHeight - CONFIG.SCROLLBAR_SIZE)) * dataHeight;
          scrollY = Math.max(0, Math.min(scrollY, dataHeight - containerHeight));
          scheduleRender();
          return;
        }
      }
    }

    // 检查是否在水平滚动条区域
    if (showHScroll) {
      const hTrackY = containerHeight - CONFIG.SCROLLBAR_SIZE;
      const maxScroll = Math.max(0, contentWidth - (containerWidth - CONFIG.SCROLLBAR_SIZE));
      const trackWidth = containerWidth - CONFIG.SCROLLBAR_SIZE;
      const ratio = (containerWidth - CONFIG.SCROLLBAR_SIZE) / contentWidth;
      const sliderWidth = Math.max(30, trackWidth * ratio);
      const sliderX = (scrollX / maxScroll) * trackWidth;

      if (y >= hTrackY) {
        if (x >= sliderX && x <= sliderX + sliderWidth) {
          isDraggingHScroll = true;
          hScrollStartX = x - sliderX;
          e.preventDefault();
          return;
        } else {
          const targetX = Math.max(0, Math.min(x, trackWidth));
          scrollX = (targetX / trackWidth) * maxScroll;
          scrollX = Math.max(0, Math.min(scrollX, maxScroll));
          scheduleRender();
          return;
        }
      }
    }

    // 点击行 - 跳转到主过滤器
    const row = Math.floor((y + scrollY) / CONFIG.ROW_HEIGHT);
    if (row >= 0 && row < data.length) {
      selectedRow = row;

      // 调用跳转函数 - 使用多重延迟确保虚拟滚动完成
      if (typeof window.jumpToPrimaryFilterLine === 'function') {
        const primaryIndex = primaryIndices[row];

        // 使用更长的延迟链确保DOM完全更新
        setTimeout(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                window.jumpToPrimaryFilterLine(primaryIndex);

                // 额外延迟后再尝试一次，确保高亮成功
                setTimeout(() => {
                  if (typeof window.restoreHighlight === 'function') {
                    window.restoreHighlight();
                  }
                }, 150);
              });
            });
          });
        }, 50);
      }

      scheduleRender();
    }
  }

  function handleMouseUp() {
    isDraggingVScroll = false;
    isDraggingHScroll = false;
  }

  function handleScrollbarDrag(e) {
    if (!data.length) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 垂直滚动条拖动
    if (isDraggingVScroll) {
      const dataHeight = data.length * CONFIG.ROW_HEIGHT;
      const trackHeight = containerHeight - CONFIG.SCROLLBAR_SIZE;
      const ratio = containerHeight / dataHeight;
      const sliderHeight = Math.max(30, containerHeight * ratio);
      const newSliderY = y - vScrollStartY;
      const clampedY = Math.max(0, Math.min(newSliderY, trackHeight - sliderHeight));
      scrollY = (clampedY / trackHeight) * dataHeight;
      scrollY = Math.max(0, Math.min(scrollY, dataHeight - containerHeight));
      scheduleRender();
    }

    // 水平滚动条拖动
    if (isDraggingHScroll) {
      const maxScroll = Math.max(0, contentWidth - (containerWidth - CONFIG.SCROLLBAR_SIZE));
      const trackWidth = containerWidth - CONFIG.SCROLLBAR_SIZE;
      const ratio = (containerWidth - CONFIG.SCROLLBAR_SIZE) / contentWidth;
      const sliderWidth = Math.max(30, trackWidth * ratio);
      const newSliderX = x - hScrollStartX;
      const clampedX = Math.max(0, Math.min(newSliderX, trackWidth - sliderWidth));
      scrollX = (clampedX / trackWidth) * maxScroll;
      scrollX = Math.max(0, Math.min(scrollX, maxScroll));
      scheduleRender();
    }
  }

  function handleMouseLeave() {
    hoveredRow = -1;
    scheduleRender();
  }

  function setData(lines, pIndices, oIndices) {
    data = lines;
    primaryIndices = pIndices;
    originalIndices = oIndices;

    // 计算行号
    lineNumbers = oIndices.map((idx, i) => idx + 1);

    // 计算内容宽度
    contentWidth = CONFIG.PADDING_X * 2;
    ctx.font = `${CONFIG.FONT_SIZE}px Consolas, Monaco, monospace`;
    for (const line of lines) {
      const text = typeof line === 'string' ? line : String(line);
      const textWidth = ctx.measureText(text).width;
      contentWidth = Math.max(contentWidth, textWidth + CONFIG.PADDING_X * 3);
    }

    totalWidth = contentWidth + CONFIG.SCROLLBAR_SIZE;

    // 重置滚动位置
    scrollX = 0;
    scrollY = 0;
    hoveredRow = -1;
    selectedRow = -1;

    // 只有当容器有尺寸时才渲染
    if (containerWidth > 0 && containerHeight > 0) {
      scheduleRender();
    }

    console.log(`[SecondaryFilterCanvas] 加载数据: ${lines.length} 行`);
  }

  function clear() {
    data = [];
    primaryIndices = [];
    originalIndices = [];
    lineNumbers = [];
    keywords = [];
    scrollX = 0;
    scrollY = 0;
    hoveredRow = -1;
    selectedRow = -1;
    contentWidth = 0;
    totalWidth = 0;
    scheduleRender();
  }

  function scrollToTop() {
    scrollX = 0;
    scrollY = 0;
    scheduleRender();
  }

  function pauseRendering() {
    isRenderingPaused = true;
  }

  function resumeRendering() {
    isRenderingPaused = false;
    updateContainerSize();
  }

  function forceUpdate() {
    updateContainerSize();
  }

  function getScrollPosition() {
    return {
      x: scrollX,
      y: scrollY
    };
  }

  function setScrollPosition(x, y) {
    scrollX = x !== undefined ? x : scrollX;
    scrollY = y !== undefined ? y : scrollY;
    scheduleRender();
  }

  function addHighlightKeyword(keyword, customColor) {
    if (!keyword || keyword.trim() === '') return null;

    // 检查是否已存在
    const existing = highlightKeywords.find(h => h.keyword === keyword);
    if (existing) return existing;

    // 使用自定义颜色或默认颜色（循环使用）
    let color;
    if (customColor) {
      // 将十六进制颜色转换为rgba
      color = hexToRgba(customColor, 0.35);
    } else {
      const colorIndex = highlightKeywords.length % highlightColors.length;
      color = highlightColors[colorIndex];
    }

    const highlight = {
      keyword,
      color: color,
      index: highlightKeywords.length
    };
    highlightKeywords.push(highlight);
    scheduleRender();
    return highlight;
  }

  // 十六进制转rgba
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function removeHighlightKeyword(keyword) {
    const index = highlightKeywords.findIndex(h => h.keyword === keyword);
    if (index !== -1) {
      highlightKeywords.splice(index, 1);
      scheduleRender();
      return true;
    }
    return false;
  }

  function clearHighlightKeywords() {
    highlightKeywords = [];
    scheduleRender();
  }

  function getHighlightKeywords() {
    return highlightKeywords.map(h => ({ keyword: h.keyword, color: h.color }));
  }

  function scheduleRender() {
    if (isRenderingPaused) return;
    if (!isRenderScheduled) {
      isRenderScheduled = true;
      requestAnimationFrame(() => {
        render();
        isRenderScheduled = false;
      });
    }
  }

  function render() {
    if (!ctx || !container) return;

    // 清空画布
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, containerWidth, containerHeight);

    if (data.length === 0) {
      // 空状态提示
      ctx.fillStyle = '#999999';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', containerWidth / 2, containerHeight / 2);
      return;
    }

    // 计算可见行范围
    const startRow = Math.floor(scrollY / CONFIG.ROW_HEIGHT);
    const endRow = Math.min(data.length, Math.ceil((scrollY + containerHeight) / CONFIG.ROW_HEIGHT) + 1);

    // 绘制行
    for (let row = startRow; row < endRow; row++) {
      drawRow(row);
    }

    // 绘制滚动条
    drawScrollbars();
  }

  function drawRow(rowIndex) {
    const y = (rowIndex * CONFIG.ROW_HEIGHT) - scrollY;
    const line = data[rowIndex];
    const text = typeof line === 'string' ? line : String(line);

    // 背景色
    if (rowIndex === selectedRow) {
      ctx.fillStyle = 'rgba(255, 150, 100, 0.35)';
      ctx.fillRect(0, y, containerWidth, CONFIG.ROW_HEIGHT);
    } else if (rowIndex === hoveredRow) {
      ctx.fillStyle = 'rgba(255, 200, 150, 0.25)';
      ctx.fillRect(0, y, containerWidth, CONFIG.ROW_HEIGHT);
    } else if (rowIndex % 2 === 1) {
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, y, containerWidth, CONFIG.ROW_HEIGHT);
    }

    // 绘制底部横线分隔线
    ctx.strokeStyle = '#eeeeee';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + CONFIG.ROW_HEIGHT);
    ctx.lineTo(Math.min(totalWidth, containerWidth), y + CONFIG.ROW_HEIGHT);
    ctx.stroke();

    // 绘制内容
    ctx.fillStyle = '#000000';
    ctx.font = `${CONFIG.FONT_SIZE}px Consolas, Monaco, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const textX = CONFIG.PADDING_X - scrollX;
    const maxWidth = contentWidth - CONFIG.PADDING_X;

    // 绘制关键词高亮背景
    if (highlightKeywords.length > 0) {
      highlightKeywords.forEach(highlight => {
        const keyword = highlight.keyword;
        let startPos = 0;
        while ((startPos = text.indexOf(keyword, startPos)) !== -1) {
          // 计算关键词的宽度
          const beforeText = text.substring(0, startPos);
          const beforeWidth = ctx.measureText(beforeText).width;
          const keywordWidth = ctx.measureText(keyword).width;

          // 计算位置
          const highlightX = textX + beforeWidth;
          const highlightY = y + 2;
          const highlightHeight = CONFIG.ROW_HEIGHT - 4;

          // 绘制高亮背景
          ctx.fillStyle = highlight.color;
          ctx.fillRect(highlightX, highlightY, keywordWidth, highlightHeight);

          startPos += keyword.length;
        }
      });
    }

    // 重置文字颜色为黑色（重要！）
    ctx.fillStyle = '#000000';

    // 文本截断处理
    let displayText = text;
    if (ctx.measureText(text).width > maxWidth) {
      while (ctx.measureText(displayText + '...').width > maxWidth && displayText.length > 0) {
        displayText = displayText.slice(0, -1);
      }
      displayText += '...';
    }

    ctx.fillText(displayText, textX, y + CONFIG.ROW_HEIGHT / 2);
  }

  function drawScrollbars() {
    const dataHeight = data.length * CONFIG.ROW_HEIGHT;
    const showVScroll = containerHeight < dataHeight;
    const showHScroll = contentWidth > containerWidth - CONFIG.SCROLLBAR_SIZE;

    // 垂直滚动条
    if (showVScroll) {
      const trackHeight = containerHeight - (showHScroll ? CONFIG.SCROLLBAR_SIZE : 0);
      const ratio = containerHeight / dataHeight;
      const sliderHeight = Math.max(30, containerHeight * ratio);
      const sliderY = (scrollY / dataHeight) * trackHeight;

      // 轨道
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(containerWidth - CONFIG.SCROLLBAR_SIZE, 0, CONFIG.SCROLLBAR_SIZE, trackHeight);

      // 滑块
      ctx.fillStyle = '#c0c0c0';
      ctx.fillRect(containerWidth - CONFIG.SCROLLBAR_SIZE, sliderY, CONFIG.SCROLLBAR_SIZE, sliderHeight);
    }

    // 水平滚动条
    if (showHScroll) {
      const maxScroll = Math.max(0, contentWidth - (containerWidth - CONFIG.SCROLLBAR_SIZE));
      const trackWidth = containerWidth - (showVScroll ? CONFIG.SCROLLBAR_SIZE : 0);
      const ratio = (containerWidth - CONFIG.SCROLLBAR_SIZE) / contentWidth;
      const sliderWidth = Math.max(30, trackWidth * ratio);
      const sliderX = (scrollX / maxScroll) * trackWidth;
      const trackY = containerHeight - CONFIG.SCROLLBAR_SIZE;

      // 轨道
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, trackY, trackWidth, CONFIG.SCROLLBAR_SIZE);

      // 滑块
      ctx.fillStyle = '#c0c0c0';
      ctx.fillRect(sliderX, trackY, sliderWidth, CONFIG.SCROLLBAR_SIZE);
    }
  }

  // 初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
