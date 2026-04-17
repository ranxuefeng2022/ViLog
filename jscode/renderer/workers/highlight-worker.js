/**
 * 高亮计算 Worker - 优化版
 * 将高亮计算从主线程移到Worker线程，避免阻塞UI
 *
 * 支持两种高亮模式：
 * 1. batchHighlight - 批量高亮（与主线程 applyBatchHighlight 逻辑一致）
 * 2. highlight - 简单高亮（正则模式）
 */

// ========== 工具函数 ==========

/**
 * HTML转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 正则转义
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ========== 高亮计算核心逻辑 ==========

/**
 * 批量高亮函数 - 与主线程 applyBatchHighlight 逻辑完全一致
 * @param {string} text - 原始文本
 * @param {Object} config - 高亮配置
 * @param {number} lineIndex - 行索引
 * @returns {string} 高亮后的HTML
 */
function applyBatchHighlight(text, config, lineIndex) {
  if (!text) return '';

  const {
    searchKeyword = '',
    searchHighlightClass = 'search-highlight',
    currentSearchHighlightClass = 'current-search-highlight',
    customHighlights = [],
    currentMatchLine = -1
  } = config;

  // 收集所有需要高亮的范围
  const ranges = [];

  // 1. 🔧 移除搜索关键词高亮（用户不希望搜索关键词被高亮）
  // 搜索功能仍然正常工作，只是不显示高亮效果

  // 2. 自定义高亮范围
  for (let i = 0; i < customHighlights.length; i++) {
    const h = customHighlights[i];
    if (!h.keyword) continue;
    const keywordLen = h.keyword.length;
    let pos = 0;
    while (pos < text.length) {
      const index = text.indexOf(h.keyword, pos);
      if (index === -1) break;
      ranges.push({
        start: index,
        end: index + keywordLen,
        type: 'custom',
        priority: 2,
        color: h.color
      });
      pos = index + keywordLen;
    }
  }

  // 如果没有高亮范围，直接返回原文
  if (ranges.length === 0) return text;

  // 按起始位置排序
  ranges.sort((a, b) => a.start - b.start);

  // 合并重叠的范围（按优先级保留）
  const mergedRanges = [];
  for (const range of ranges) {
    let overlapping = false;
    for (const existing of mergedRanges) {
      if (range.start < existing.end && range.end > existing.start) {
        overlapping = true;
        if (range.priority > existing.priority) {
          Object.assign(existing, range);
        }
        break;
      }
    }
    if (!overlapping) {
      mergedRanges.push(range);
    }
  }

  // 构建高亮后的HTML
  let result = '';
  let lastPos = 0;

  for (const range of mergedRanges) {
    if (range.start > lastPos) {
      result += escapeHtml(text.substring(lastPos, range.start));
    }

    const matchText = text.substring(range.start, range.end);
    if (range.type === 'search') {
      const className = range.isCurrent ? currentSearchHighlightClass : searchHighlightClass;
      result += `<span class="${className}">${escapeHtml(matchText)}</span>`;
    } else if (range.type === 'custom') {
      result += `<span class="custom-highlight" style="background-color: ${range.color}80;">${escapeHtml(matchText)}</span>`;
    }

    lastPos = range.end;
  }

  if (lastPos < text.length) {
    result += escapeHtml(text.substring(lastPos));
  }

  return result;
}

/**
 * 批量处理多行高亮
 */
function batchHighlightLines(lines, config) {
  const results = new Array(lines.length);
  const startTime = performance.now();

  for (let i = 0; i < lines.length; i++) {
    results[i] = applyBatchHighlight(lines[i], config, i);

    // 每500行报告一次进度
    if ((i + 1) % 500 === 0) {
      self.postMessage({
        type: 'progress',
        taskId: config.taskId,
        current: i + 1,
        total: lines.length
      });
    }
  }

  const elapsed = performance.now() - startTime;

  return {
    results,
    stats: {
      lineCount: lines.length,
      elapsed: elapsed.toFixed(2)
    }
  };
}

// ========== 简单高亮模式（正则） ==========

/**
 * 简单高亮内容 - 使用正则表达式
 */
function highlightContent(originalText, options) {
  const {
    searchKeyword = '',
    customHighlights = [],
    filterKeywords = []
  } = options;

  // 快速路径：如果没有任何高亮需求，直接返回转义后的文本
  if (!searchKeyword && customHighlights.length === 0 && filterKeywords.length === 0) {
    return {
      text: originalText,
      hasHighlight: false
    };
  }

  // 转义HTML
  let result = escapeHtml(originalText);
  const hasHighlight = true;

  // 收集所有高亮关键词
  const allKeywords = [];

  // 1. 🔧 移除搜索关键词高亮（用户不希望搜索关键词被高亮）
  // 搜索功能仍然正常工作，只是不显示高亮效果

  // 2. 自定义高亮
  if (customHighlights.length > 0) {
    customHighlights.forEach((hl, idx) => {
      if (hl.keyword && hl.keyword.trim()) {
        try {
          allKeywords.push({
            regex: new RegExp(escapeRegex(hl.keyword), 'gi'),
            class: `custom-highlight-${(idx % 5) + 1}`
          });
        } catch (e) {
          console.error('Invalid custom highlight regex:', hl.keyword, e);
        }
      }
    });
  }

  // 3. 过滤关键词（最多3个）
  if (filterKeywords.length > 0) {
    filterKeywords.slice(0, 3).forEach((kw, idx) => {
      if (kw && kw.trim()) {
        try {
          allKeywords.push({
            regex: new RegExp(escapeRegex(kw), 'gi'),
            class: `filter-highlight-${(idx % 3) + 1}`
          });
        } catch (e) {
          console.error('Invalid filter keyword regex:', kw, e);
        }
      }
    });
  }

  // 快速路径：如果没有有效关键词，返回转义后的文本
  if (allKeywords.length === 0) {
    return {
      text: result,
      hasHighlight: false
    };
  }

  // 应用高亮
  for (const {regex, class: className} of allKeywords) {
    regex.lastIndex = 0;
    result = result.replace(regex, `<mark class="${className}">$&</mark>`);
  }

  return {
    text: result,
    hasHighlight: true
  };
}

/**
 * 批量简单高亮
 */
function batchHighlightSimple(lines, options) {
  const results = [];
  const startTime = performance.now();

  for (let i = 0; i < lines.length; i++) {
    const result = highlightContent(lines[i], options);
    results.push(result);

    if ((i + 1) % 1000 === 0) {
      self.postMessage({
        type: 'progress',
        taskId: options.taskId,
        current: i + 1,
        total: lines.length
      });
    }
  }

  const elapsed = performance.now() - startTime;

  return {
    type: 'complete',
    results: results,
    time: elapsed.toFixed(2)
  };
}

// ========== 消息处理 ==========

self.addEventListener('message', (e) => {
  const { type, taskId } = e.data;

  switch (type) {
    case 'batchHighlight':
      // 批量高亮（与主线程逻辑一致）
      try {
        const { lines, config } = e.data;
        const result = batchHighlightLines(lines, {...config, taskId});
        self.postMessage({
          type: 'batchHighlightComplete',
          taskId,
          ...result
        });
      } catch (error) {
        self.postMessage({
          type: 'batchHighlightError',
          taskId,
          error: error.message,
          stack: error.stack
        });
      }
      break;

    case 'highlight':
      // 简单高亮（正则模式）
      try {
        const { lines, options } = e.data;
        const result = batchHighlightSimple(lines, {...options, taskId});
        self.postMessage({
          type: 'complete',
          taskId,
          ...result
        });
      } catch (error) {
        self.postMessage({
          type: 'error',
          taskId,
          error: error.message,
          stack: error.stack
        });
      }
      break;

    case 'ping':
      // 心跳检测
      self.postMessage({ type: 'pong', taskId });
      break;

    default:
      console.warn('[HighlightWorker] Unknown message type:', type);
  }
});

// 启动时报告状态
self.postMessage({ type: 'ready' });
console.log('✓ Highlight Worker loaded (enhanced version)');
