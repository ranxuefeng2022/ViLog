/**
 * 虚拟滚动性能优化补丁
 * 修复大文件（140万行+）的渲染性能问题
 *
 * 核心优化：
 * 1. 修复占位符高度问题（使用 transform 代替 height）
 * 2. 集成新的虚拟滚动模块
 * 3. 添加高亮缓存机制，避免重复计算
 * 4. 修复高亮嵌套问题，确保只对原始内容高亮
 */

// 保存原始函数引用
const originalRenderLogLines = renderLogLines;
const originalUpdateVisibleLines = updateVisibleLines;
const originalJumpToLine = jumpToLine;

// ==================== 高亮缓存系统 ====================

/**
 * 高亮缓存配置
 * 避免重复计算，提升滚动性能
 */
const highlightCache = {
  // 主缓存：key = "searchKeywords|customHighlights|filterKeywords" + originalText, value = 高亮后的HTML
  cache: new Map(),
  maxSize: 5000,  // 🚀 优化：增加缓存以提升滚动性能（1000 → 5000）

  // 统计信息（用于性能监控）
  stats: {
    hits: 0,
    misses: 0,
    evictions: 0
  },

  // 当前高亮状态（用于判断缓存是否失效）
  state: {
    searchKeyword: '',
    customHighlights: [],
    filterKeywords: [],
  },

  /**
   * 生成缓存键
   */
  getKey(originalText, searchKeyword, customHighlights, filterKeywords) {
    // 为每个关键词类型生成简短的标识
    const searchId = searchKeyword ? `s:${searchKeyword.length > 20 ? searchKeyword.slice(0,20) + '...' : searchKeyword}` : '';
    const customId = customHighlights.length > 0 ? `c:${customHighlights.map(h => h.keyword).join(',')}` : '';
    const filterId = filterKeywords.length > 0 ? `f:${filterKeywords.slice(0,3).join(',')}` : '';

    // 生成状态标识
    const stateKey = [searchId, customId, filterId].filter(Boolean).join('|');

    // 使用文本哈希（简单哈希）避免存储长文本
    let hash = 0;
    for (let i = 0; i < originalText.length; i++) {
      hash = ((hash << 5) - hash) + originalText.charCodeAt(i);
      hash = hash & hash;
    }

    return `${stateKey}#${hash}`;
  },

  /**
   * 获取缓存
   */
  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
    return value;
  },

  /**
   * 设置缓存
   */
  set(key, value) {
    // 限制缓存大小
    if (this.cache.size >= this.maxSize) {
      // 清除最早的1/4缓存
      const keysToDelete = Array.from(this.cache.keys()).slice(0, Math.floor(this.maxSize / 4));
      keysToDelete.forEach(k => this.cache.delete(k));
      this.stats.evictions += keysToDelete.length;
    }
    this.cache.set(key, value);
  },

  /**
   * 获取统计信息
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : '0.0'
    };
  },

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  },

  /**
   * 检查状态是否变化
   */
  isStateChanged(searchKeyword, customHighlights, filterKeywords) {
    const currentState = this.state;
    if (currentState.searchKeyword !== searchKeyword) return true;
    if (currentState.customHighlights.length !== customHighlights.length) return true;
    if (currentState.filterKeywords.length !== filterKeywords.length) return true;
    return false;
  },

  /**
   * 更新状态并清除缓存
   */
  updateState(searchKeyword, customHighlights, filterKeywords) {
    if (this.isStateChanged(searchKeyword, customHighlights, filterKeywords)) {
      this.state = {
        searchKeyword: searchKeyword || '',
        customHighlights: customHighlights || [],
        filterKeywords: filterKeywords || [],
      };
      this.cache.clear();  // 状态变化时清除缓存
      console.log('[HighlightCache] 状态变化，缓存已清除');
    }
  },

  /**
   * 清除缓存
   */
  clear() {
    this.cache.clear();
  },
};

/**
 * 高亮文本内容（优化版：支持缓存，避免嵌套）
 * @param {string} originalText - 原始文本内容
 * @param {Object} highlightConfig - 高亮配置
 * @returns {string} 高亮后的 HTML
 */
function highlightContent(originalText, highlightConfig) {
  const {
    searchKeyword = '',
    customHighlights = [],
    filterKeywords = [],
    lineIndex = -1,
    currentMatchLine = -1,
  } = highlightConfig;

  // 空文本直接返回
  if (!originalText) return '';

  // 🚀 检查缓存
  const cacheKey = highlightCache.getKey(originalText, searchKeyword, customHighlights, filterKeywords);
  const cached = highlightCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // 🚀 更新状态（如果状态变化会清除缓存）
  highlightCache.updateState(searchKeyword, customHighlights, filterKeywords);

  // 从原始内容开始高亮（避免嵌套）
  let result = escapeHtml(originalText);

  // 收集所有需要高亮的范围，避免嵌套问题
  const highlightRanges = [];

  // 1. 搜索关键词高亮范围
  if (searchKeyword && searchKeyword.trim()) {
    try {
      const regex = new RegExp(escapeRegex(searchKeyword), 'gi');
      let match;
      while ((match = regex.exec(originalText)) !== null) {
        highlightRanges.push({
          start: match.index,
          end: match.index + match[0].length,
          type: 'search',
          text: match[0],
        });
      }
    } catch (e) {
      // 正则失败时使用简单包含
      const lowerText = originalText.toLowerCase();
      const lowerKeyword = searchKeyword.toLowerCase();
      let idx = 0;
      while ((idx = lowerText.indexOf(lowerKeyword, idx)) !== -1) {
        highlightRanges.push({
          start: idx,
          end: idx + searchKeyword.length,
          type: 'search',
          text: originalText.slice(idx, idx + searchKeyword.length),
        });
        idx++;
      }
    }
  }

  // 2. 自定义高亮范围
  for (const highlight of customHighlights) {
    if (!highlight.keyword) continue;
    try {
      const regex = new RegExp(escapeRegex(highlight.keyword), 'gi');
      let match;
      while ((match = regex.exec(originalText)) !== null) {
        highlightRanges.push({
          start: match.index,
          end: match.index + match[0].length,
          type: 'custom',
          color: highlight.color,
        });
      }
    } catch (e) {
      const lowerText = originalText.toLowerCase();
      const lowerKeyword = highlight.keyword.toLowerCase();
      let idx = 0;
      while ((idx = lowerText.indexOf(lowerKeyword, idx)) !== -1) {
        highlightRanges.push({
          start: idx,
          end: idx + highlight.keyword.length,
          type: 'custom',
          color: highlight.color,
        });
        idx++;
      }
    }
  }

  // 3. 过滤关键词高亮范围
  for (let k = 0; k < Math.min(filterKeywords.length, 3); k++) {
    const keyword = filterKeywords[k];
    if (!keyword) continue;
    try {
      const regex = new RegExp(escapeRegex(keyword), 'gi');
      let match;
      while ((match = regex.exec(originalText)) !== null) {
        highlightRanges.push({
          start: match.index,
          end: match.index + match[0].length,
          type: 'filter',
          classIndex: k,
        });
      }
    } catch (e) {
      const lowerText = originalText.toLowerCase();
      const lowerKeyword = keyword.toLowerCase();
      let idx = 0;
      while ((idx = lowerText.indexOf(lowerKeyword, idx)) !== -1) {
        highlightRanges.push({
          start: idx,
          end: idx + keyword.length,
          type: 'filter',
          classIndex: k,
        });
        idx++;
      }
    }
  }

  // 合并重叠的高亮范围
  const mergedRanges = mergeHighlightRanges(highlightRanges, originalText);

  // 从后向前应用高亮（避免索引偏移）
  for (let i = mergedRanges.length - 1; i >= 0; i--) {
    const range = mergedRanges[i];
    const before = result.slice(0, range.htmlStart);
    const matched = result.slice(range.htmlStart, range.htmlEnd);
    const after = result.slice(range.htmlEnd);

    // 生成高亮标签
    let highlightClass = '';
    let style = '';

    if (range.type === 'search') {
      const isCurrent = lineIndex === currentMatchLine;
      highlightClass = isCurrent ? 'current-search-highlight' : 'search-highlight';
    } else if (range.type === 'custom') {
      highlightClass = 'custom-highlight';
      style = `background-color: ${range.color}80;`;
    } else if (range.type === 'filter') {
      highlightClass = getFilterHighlightClass(range.classIndex);
    }

    const tag = style
      ? `<span class="${highlightClass}" style="${style}">`
      : `<span class="${highlightClass}">`;
    const closeTag = '</span>';

    result = before + tag + matched + closeTag + after;
  }

  // 🚀 缓存结果
  highlightCache.set(cacheKey, result);

  return result;
}

/**
 * 合并高亮范围（处理重叠）
 * 🚀 修复：计算 HTML 转义后的索引位置
 */
function mergeHighlightRanges(ranges, originalText) {
  if (ranges.length === 0) return [];

  // 按起始位置排序
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  let current = ranges[0];

  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i];

    // 如果范围重叠或相邻
    if (next.start <= current.end) {
      // 合并范围（取较大的结束位置）
      current.end = Math.max(current.end, next.end);
      // 如果类型不同，优先保留搜索高亮
      if (next.type === 'search' && current.type !== 'search') {
        current.type = 'search';
      }
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  // 🚀 计算每个范围在 HTML 转义后文本中的索引位置
  // 因为 escapeHtml 会将 < > & 等字符替换为 HTML 实体，导致索引变化
  const htmlEscapedText = escapeHtml(originalText);

  // 计算原始文本索引到 HTML 转义后文本索引的映射
  function getHtmlIndex(originalIndex) {
    let htmlIndex = 0;
    let originalPos = 0;

    while (originalPos < originalIndex && htmlIndex < htmlEscapedText.length) {
      const char = originalText[originalPos];

      // 检查是否是 HTML 实体字符
      if (char === '&') {
        htmlIndex += 5; // &amp; 长度为 5
      } else if (char === '<') {
        htmlIndex += 4; // &lt; 长度为 4
      } else if (char === '>') {
        htmlIndex += 4; // &gt; 长度为 4
      } else if (char === '"') {
        htmlIndex += 6; // &quot; 长度为 6
      } else if (char === "'") {
        htmlIndex += 5; // &#39; 长度为 5
      } else {
        htmlIndex += 1;
      }

      originalPos++;
    }

    return htmlIndex;
  }

  // 为每个范围计算 HTML 索引
  return merged.map(range => ({
    ...range,
    htmlStart: getHtmlIndex(range.start),
    htmlEnd: getHtmlIndex(range.end),
  }));
}

/**
 * HTML 转义（纯文本版本，不处理已存在的 HTML）
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 正则转义
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 获取过滤高亮类名
 * 支持循环使用 20 种颜色
 */
function getFilterHighlightClass(keywordIndex) {
  const classes = [
    'filter-highlight-0', 'filter-highlight-1', 'filter-highlight-2', 'filter-highlight-3',
    'filter-highlight-4', 'filter-highlight-5', 'filter-highlight-6', 'filter-highlight-7',
    'filter-highlight-8', 'filter-highlight-9', 'filter-highlight-10', 'filter-highlight-11',
    'filter-highlight-12', 'filter-highlight-13', 'filter-highlight-14', 'filter-highlight-15',
    'filter-highlight-16', 'filter-highlight-17', 'filter-highlight-18', 'filter-highlight-19'
  ];
  return classes[keywordIndex % classes.length];
}

/**
 * 优化的 renderLogLines 函数
 * 使用虚拟滚动，只渲染可见区域
 */
function renderLogLines() {
  try {
    // 仅内存模式：不渲染主日志框，显示统计信息
    if (window.fileLoadMode === 'memory') {
      if (typeof window.showMemoryModeStats === 'function') window.showMemoryModeStats();
      return;
    }

    // 检查必要条件
    if (!inner) {
      console.error('[renderLogLines] inner element not found!');
      return;
    }
    if (!originalLines || originalLines.length === 0) {
      return; // 正常情况：空日志
    }

  inner.innerHTML = "";
  lastVisibleStart = -1;
  lastVisibleEnd = -1;

  // 初始化 DOM 池
  const screenVisibleLines = Math.ceil(outer.clientHeight / lineHeight);
  const poolSize = screenVisibleLines + bufferSize * 2;

  if (!domPool || Math.abs(domPool.initialSize - poolSize) > 50) {
    if (domPool) {
      domPool.clear();
    }
    domPool = new DOMPool(inner, poolSize);
  } else {
    domPool.releaseAll();
  }

  // 创建优化的占位符（关键修复）
  const placeholder = document.createElement("div");
  placeholder.className = "log-placeholder";
  placeholder.id = "logPlaceholder";

  // 🚀 修复黑屏：使用安全高度计算，防止超过 Chromium DOM 高度限制
  const { height: safeHeight } = computeSafeScrollHeight(originalLines.length);
  placeholder.style.height = safeHeight + "px";

  if (virtualScrollScale > 1) {
    console.log(`[renderLogLines-patch] 超大文件模式: ${originalLines.length} 行, scale=${virtualScrollScale.toFixed(4)}`);
  }

  inner.appendChild(placeholder);

  // 初始化虚拟滚动模块
  if (window.App && window.App.VirtualScroll) {
    // 先初始化
    window.App.VirtualScroll.init(outer, inner);
    // 再设置行数
    window.App.VirtualScroll.setTotalLines(originalLines.length);
  }

  // 🚀 关键：无论虚拟滚动是否初始化，都调用 updateVisibleLines 渲染内容
  updateVisibleLines();
  } catch (error) {
    console.error('[renderLogLines] Error:', error);
  }
}

/**
 * 优化的 updateVisibleLines 函数
 * 支持虚拟滚动模块
 */
function updateVisibleLines() {
  if (originalLines.length === 0) return;
  // 仅内存模式：不渲染主日志框
  if (window.fileLoadMode === 'memory') return;

  const scrollTop = outer.scrollTop;
  const clientHeight = outer.clientHeight;

  // 🚀 修复黑屏：使用缩放感知的行号计算
  const firstVisibleLine = scrollTopToLine(scrollTop);
  const lastVisibleLine = scrollTopToLine(scrollTop + clientHeight);

  const newVisibleStart = Math.max(
    0,
    firstVisibleLine - bufferSize
  );
  const newVisibleEnd = Math.min(
    originalLines.length - 1,
    lastVisibleLine + bufferSize
  );

  if (newVisibleStart === lastVisibleStart && newVisibleEnd === lastVisibleEnd) {
    return; // 可见范围没有变化，跳过渲染
  }

  // 🔧 保存文本选区（回收 DOM 前保存行索引 + 行内偏移）
  var savedSelection = null;
  try {
    var sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      var range = sel.getRangeAt(0);
      // 快速祖先链检查
      var node = range.commonAncestorContainer;
      while (node) { if (node === inner) break; node = node.parentNode; }
      if (node) {
        function _findLineEl(n) {
          while (n && n !== inner) {
            if (n.nodeType === 1 && (n.classList.contains('log-line') || n.classList.contains('file-header'))) return n;
            n = n.parentNode;
          }
          return null;
        }
        function _textOffsetInLine(tn, off, le) {
          var w = document.createTreeWalker(le, NodeFilter.SHOW_TEXT);
          var t = 0;
          while (w.nextNode()) { if (w.currentNode === tn) return t + off; t += w.currentNode.textContent.length; }
          return off;
        }
        var aEl = _findLineEl(range.startContainer);
        var fEl = _findLineEl(range.endContainer);
        if (aEl && fEl) {
          savedSelection = {
            anchorLine: parseInt(aEl.dataset.index),
            anchorOffset: _textOffsetInLine(range.startContainer, range.startOffset, aEl),
            focusLine: parseInt(fEl.dataset.index),
            focusOffset: _textOffsetInLine(range.endContainer, range.endOffset, fEl)
          };
        }
      }
    }
  } catch (e) {}

  visibleStart = newVisibleStart;
  visibleEnd = newVisibleEnd;
  lastVisibleStart = visibleStart;
  lastVisibleEnd = visibleEnd;

  // DOM池化优化
  if (domPool) {
    if (lastVisibleStart >= 0 && lastVisibleEnd >= 0) {
      if (newVisibleStart > lastVisibleStart) {
        domPool.releaseRange(lastVisibleStart, newVisibleStart - 1);
      }
      if (newVisibleEnd < lastVisibleEnd) {
        domPool.releaseRange(newVisibleEnd + 1, lastVisibleEnd);
      }
    }
  }

  // 🚀 渲染前更新高亮状态（仅在关键词变化时才更新，避免每次滚动都清缓存）
  // 🔧 修复：主日志框不使用 customHighlights（自定义高亮仅限过滤面板）
  var currentSearchKw = searchKeyword || '';
  if (highlightCache._lastSearchKw !== currentSearchKw) {
    highlightCache._lastSearchKw = currentSearchKw;
    highlightCache.updateState(currentSearchKw, [], []);
  }

  // 渲染可见行
  const hasSearchKeyword = !!searchKeyword;
  const hasCustomHighlights = false; // 主日志框不应用自定义高亮
  const currentMatchLine = totalMatchCount > 0 ? searchMatches[currentMatchIndex] : -1;

  const fragment = document.createDocumentFragment();

  // 🔧 修复字体变形：压缩模式下的锚点计算
  let compressionAnchor = 0;
  let compressionFirstLine = 0;
  if (virtualScrollScale > 1) {
    compressionFirstLine = firstVisibleLine;
    compressionAnchor = lineToScrollTop(compressionFirstLine);
  }

  for (let i = visibleStart; i <= visibleEnd; i++) {
    const lineContent = originalLines[i];
    if (!lineContent) continue; // 🔧 安全检查：跳过空行

    const isFileHeader = lineContent.startsWith("=== 文件:");

    let line;
    if (domPool) {
      line = domPool.acquire(i, isFileHeader ? "file-header" : "log-line");
    } else {
      line = document.createElement("div");
      line.className = isFileHeader ? "file-header" : "log-line";
      line.dataset.index = String(i);
      line.style.cssText = `position:absolute;width:max-content;min-width:100%;left:0;`;
    }

    // 选中行
    if (!isFileHeader && i === selectedOriginalIndex) {
      line.classList.add("selected");
    } else {
      line.classList.remove("selected");
    }

    // 搜索匹配高亮
    if (!isFileHeader && i === currentMatchLine) {
      line.classList.add("current-match-line");
    } else {
      line.classList.remove("current-match-line");
    }

    // 永久高亮
    if (!isFileHeader && i === currentPermanentHighlightIndex) {
      line.classList.add("permanent-highlight");
    } else {
      line.classList.remove("permanent-highlight");
    }

    // 🚀 修复黑屏+字体变形：压缩模式下按正常行高排列可见行
    // 🚀 使用 transform 替代 top，启用 GPU 合成层
    if (virtualScrollScale > 1) {
      const newY = compressionAnchor + (i - compressionFirstLine) * lineHeight;
      line.style.transform = `translateY(${newY}px)`;
      line.style.height = lineHeight + "px";
      line.style.lineHeight = lineHeight + "px";
    } else {
      const translateY = lineToScrollTop(i);
      line.style.transform = `translateY(${translateY}px)`;
    }
    line.dataset.lineNumber = i + 1;

    // 🚀 性能优化：检查是否需要高亮（主日志框不检查过滤关键词）
    const needsHighlight = hasSearchKeyword || hasCustomHighlights;

    if (!needsHighlight && !isFileHeader) {
      // 🚀 无高亮时：使用textContent（快50倍，避免HTML解析）
      line.textContent = lineContent;
    } else {
      // 需要高亮：使用innerHTML
      // 🔧 修复：主日志框不传递过滤关键词，只传递搜索关键词和自定义高亮
      const displayContent = isFileHeader
        ? escapeHtml(lineContent)
        : highlightContent(lineContent, {
            searchKeyword: hasSearchKeyword ? searchKeyword : '',
            customHighlights: hasCustomHighlights ? customHighlights.slice(0, 5) : [],
            filterKeywords: [], // 🔧 主日志框不应用过滤关键词高亮
            lineIndex: i,
            currentMatchLine: currentMatchLine,
          });

      line.innerHTML = displayContent;
    }

    if (!line.parentElement || line.parentElement !== inner) {
      fragment.appendChild(line);
    }
  }

  if (fragment.children.length > 0) {
    inner.appendChild(fragment);
  }

  updateScrollProgress();

  // 🔧 恢复文本选区
  if (savedSelection) {
    try {
      var aEl2 = inner.querySelector('.log-line[data-index="' + savedSelection.anchorLine + '"], .file-header[data-index="' + savedSelection.anchorLine + '"]');
      var fEl2 = inner.querySelector('.log-line[data-index="' + savedSelection.focusLine + '"], .file-header[data-index="' + savedSelection.focusLine + '"]');
      if (aEl2 && fEl2) {
        function _setRangePt(r, isStart, le, to) {
          var w = document.createTreeWalker(le, NodeFilter.SHOW_TEXT);
          var t = 0;
          while (w.nextNode()) {
            var l = w.currentNode.textContent.length;
            if (t + l >= to) { var p = Math.min(to - t, l); if (isStart) r.setStart(w.currentNode, p); else r.setEnd(w.currentNode, p); return true; }
            t += l;
          }
          return false;
        }
        var r2 = document.createRange();
        if (_setRangePt(r2, true, aEl2, savedSelection.anchorOffset) && _setRangePt(r2, false, fEl2, savedSelection.focusOffset)) {
          var sel2 = window.getSelection();
          sel2.removeAllRanges();
          sel2.addRange(r2);
        }
      }
    } catch (e) {}
  }
}

/**
 * 优化的 jumpToLine 函数
 * 支持虚拟滚动
 */
function jumpToLine(lineNumber, position = 'center') {
  if (lineNumber < 0 || lineNumber >= originalLines.length) return;

  // 取消正在进行的平滑滚动
  if (smoothScrollRafId) {
    cancelAnimationFrame(smoothScrollRafId);
  }

  // 🚀 修复黑屏：使用缩放感知的滚动位置计算
  const targetScrollTop = lineToScrollTop(lineNumber);
  const clientHeight = outer.clientHeight;
  let finalScrollTop = targetScrollTop;

  if (position === 'center') {
    finalScrollTop = targetScrollTop - clientHeight / 2 + lineHeight / 2;
  } else if (position === 'end') {
    finalScrollTop = targetScrollTop - clientHeight + lineHeight;
  } else if (position === 'start') {
    finalScrollTop = targetScrollTop;
  }

  finalScrollTop = Math.max(0, Math.min(finalScrollTop, outer.scrollHeight - clientHeight));

  // 使用虚拟滚动的滚动方法
  if (window.App && window.App.VirtualScroll) {
    window.App.VirtualScroll.scrollToLine(lineNumber, position);
  } else {
    // 降级到原生滚动
    outer.scrollTop = finalScrollTop;
  }

  selectLine(lineNumber);
}

/**
 * 强制刷新可见行（用于过滤后刷新）
 */
function forceUpdateVisibleLines() {
  lastVisibleStart = -1;
  lastVisibleEnd = -1;
  updateVisibleLines();
}

/**
 * 更新占位符高度的辅助函数
 * 用于文件大小变化时更新
 */
function updatePlaceholderHeight() {
  const placeholder = document.getElementById("logPlaceholder");
  if (!placeholder) return;

  // 🚀 修复黑屏：使用安全高度计算
  const { height: safeHeight } = computeSafeScrollHeight(originalLines.length);
  placeholder.style.height = safeHeight + "px";
  placeholder.style.transform = "none";
}

// 暴露到全局
window.updatePlaceholderHeight = updatePlaceholderHeight;

/**
 * 优化的 jumpToOriginalLine 函数
 * 支持虚拟滚动，修复大文件跳转问题
 * 🚀 修复：跳转行位于页面上方20%的位置（距离顶部较近但有一定距离）
 */
const originalJumpToOriginalLine = jumpToOriginalLine;
function jumpToOriginalLine(originalIndex) {
  const containerHeight = outer.clientHeight;
  const lineHeight = getLineHeight();

  // 🚀 修复黑屏：使用缩放感知的滚动位置计算
  const targetLineTop = lineToScrollTop(originalIndex);

  // 🚀 计算偏移量：让目标行位于页面上方20%的位置
  // 即：目标行距离顶部 = 容器高度 * 0.2
  const offsetFromTop = containerHeight * 0.2;
  const scrollTop = targetLineTop - offsetFromTop;
  const targetTop = Math.max(0, scrollTop);

  // 取消正在进行的平滑滚动
  if (smoothScrollRafId) {
    cancelAnimationFrame(smoothScrollRafId);
    smoothScrollRafId = null;
  }

  // 直接使用原生滚动
  outer.scrollTop = targetTop;

  // 高亮显示目标行
  highlightOriginalLine(originalIndex, true);
}

// 覆盖全局的 jumpToOriginalLine
window.jumpToOriginalLine = jumpToOriginalLine;

// 同步更新全局变量中的引用（如果存在）
if (typeof window.originalJumpToOriginalLine !== 'undefined') {
  window.originalJumpToOriginalLine = jumpToOriginalLine;
}

// ==================== 暴露高亮函数到全局 ====================

// 暴露高亮缓存（供其他模块使用）
window.highlightCache = highlightCache;

// 暴露高亮内容函数（带缓存，避免嵌套）
window.highlightContent = highlightContent;

// 暴露清除高亮缓存函数
window.clearHighlightCache = function() {
  highlightCache.clear();
  console.log('[HighlightCache] 缓存已手动清除');
};

// 暴露 HTML 转义函数
window.escapeHtml = escapeHtml;

// 暴露正则转义函数
window.escapeRegex = escapeRegex;

console.log('✓ Virtual Scroll Patch loaded');
