/**
 * 虚拟滚动性能优化补丁
 * 主日志框仅做纯文本展示，去除搜索高亮、选区保存等非必要逻辑
 *
 * 核心优化：
 * 1. textContent 唯一渲染路径（比 innerHTML 快 50x）
 * 2. 去除每帧选区保存/恢复（消除 TreeWalker DOM 遍历）
 * 3. 去除自定义高亮分支
 * 4. 保留 permanent-highlight（过滤面板点击跳转高亮）
 * 5. 搜索匹配行关键词高亮（仅当前跳转行，使用 innerHTML）
 */

// 保存原始函数引用
const originalRenderLogLines = renderLogLines;
const originalUpdateVisibleLines = updateVisibleLines;
const originalJumpToLine = jumpToLine;

// ==================== 工具函数（保留，供其他模块通过 window 全局使用） ====================

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

// ==================== 高亮缓存（保留引用，供过滤面板等使用） ====================
const highlightCache = window.App && window.App.VirtualScroll && window.App.VirtualScroll.highlightCache
  ? window.App.VirtualScroll.highlightCache
  : { get: () => undefined, set: () => {}, updateState: () => {}, clear: () => {}, getKey: () => '' };

/**
 * 高亮文本内容（保留，过滤面板等模块通过 window.highlightContent 调用）
 */
function highlightContent(originalText, highlightConfig) {
  const {
    searchKeyword = '',
    customHighlights = [],
    filterKeywords = [],
    lineIndex = -1,
    currentMatchLine = -1,
  } = highlightConfig;

  if (!originalText) return '';

  const cacheKey = highlightCache.getKey(originalText, searchKeyword, customHighlights, filterKeywords);
  const cached = highlightCache.get(cacheKey);
  if (cached !== undefined) return cached;

  highlightCache.updateState(searchKeyword, customHighlights, filterKeywords);

  let result = escapeHtml(originalText);
  const highlightRanges = [];

  if (searchKeyword && searchKeyword.trim()) {
    try {
      const regex = new RegExp(escapeRegex(searchKeyword), 'gi');
      let match;
      while ((match = regex.exec(originalText)) !== null) {
        highlightRanges.push({ start: match.index, end: match.index + match[0].length, type: 'search', text: match[0] });
      }
    } catch (e) {
      const lowerText = originalText.toLowerCase();
      const lowerKeyword = searchKeyword.toLowerCase();
      let idx = 0;
      while ((idx = lowerText.indexOf(lowerKeyword, idx)) !== -1) {
        highlightRanges.push({ start: idx, end: idx + searchKeyword.length, type: 'search', text: originalText.slice(idx, idx + searchKeyword.length) });
        idx++;
      }
    }
  }

  for (const highlight of customHighlights) {
    if (!highlight.keyword) continue;
    try {
      const regex = new RegExp(escapeRegex(highlight.keyword), 'gi');
      let match;
      while ((match = regex.exec(originalText)) !== null) {
        highlightRanges.push({ start: match.index, end: match.index + match[0].length, type: 'custom', color: highlight.color });
      }
    } catch (e) {
      const lowerText = originalText.toLowerCase();
      const lowerKeyword = highlight.keyword.toLowerCase();
      let idx = 0;
      while ((idx = lowerText.indexOf(lowerKeyword, idx)) !== -1) {
        highlightRanges.push({ start: idx, end: idx + highlight.keyword.length, type: 'custom', color: highlight.color });
        idx++;
      }
    }
  }

  for (let k = 0; k < Math.min(filterKeywords.length, 3); k++) {
    const keyword = filterKeywords[k];
    if (!keyword) continue;
    try {
      const regex = new RegExp(escapeRegex(keyword), 'gi');
      let match;
      while ((match = regex.exec(originalText)) !== null) {
        highlightRanges.push({ start: match.index, end: match.index + match[0].length, type: 'filter', classIndex: k });
      }
    } catch (e) {
      const lowerText = originalText.toLowerCase();
      const lowerKeyword = keyword.toLowerCase();
      let idx = 0;
      while ((idx = lowerText.indexOf(lowerKeyword, idx)) !== -1) {
        highlightRanges.push({ start: idx, end: idx + keyword.length, type: 'filter', classIndex: k });
        idx++;
      }
    }
  }

  const mergedRanges = mergeHighlightRanges(highlightRanges, originalText);

  for (let i = mergedRanges.length - 1; i >= 0; i--) {
    const range = mergedRanges[i];
    const before = result.slice(0, range.htmlStart);
    const matched = result.slice(range.htmlStart, range.htmlEnd);
    const after = result.slice(range.htmlEnd);
    let highlightClass = '';
    let style = '';
    if (range.type === 'search') {
      highlightClass = lineIndex === currentMatchLine ? 'current-search-highlight' : 'search-highlight';
    } else if (range.type === 'custom') {
      highlightClass = 'custom-highlight';
      style = `background-color: ${range.color}80;`;
    } else if (range.type === 'filter') {
      highlightClass = getFilterHighlightClass(range.classIndex);
    }
    const tag = style ? `<span class="${highlightClass}" style="${style}">` : `<span class="${highlightClass}">`;
    result = before + tag + matched + '</span>' + after;
  }

  highlightCache.set(cacheKey, result);
  return result;
}

function mergeHighlightRanges(ranges, originalText) {
  if (ranges.length === 0) return [];
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  let current = ranges[0];
  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i];
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
      if (next.type === 'search' && current.type !== 'search') current.type = 'search';
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  const htmlEscapedText = escapeHtml(originalText);
  function getHtmlIndex(originalIndex) {
    let htmlIndex = 0, originalPos = 0;
    while (originalPos < originalIndex && htmlIndex < htmlEscapedText.length) {
      const char = originalText[originalPos];
      if (char === '&') htmlIndex += 5;
      else if (char === '<' || char === '>') htmlIndex += 4;
      else if (char === '"') htmlIndex += 6;
      else if (char === "'") htmlIndex += 5;
      else htmlIndex += 1;
      originalPos++;
    }
    return htmlIndex;
  }
  return merged.map(range => ({ ...range, htmlStart: getHtmlIndex(range.start), htmlEnd: getHtmlIndex(range.end) }));
}

// ==================== 核心渲染函数（精简版） ====================

/**
 * 获取有效总行数（兼容 chunk 模式和 load 模式）
 */
function getEffectiveTotalLines() {
  if (window.fileLoadMode === 'chunk') {
    return window.chunkTotalLines || 0;
  }
  return originalLines ? originalLines.length : 0;
}

/**
 * 分片模式专用：异步加载完成后，刷新所有显示"..."的可见行
 */
function chunkRefreshVisibleText(loadedIndices) {
  if (!domPool || !domPool.activeElements) return;
  var _matchLine = (typeof totalMatchCount !== 'undefined' && totalMatchCount > 0
    && typeof currentMatchIndex !== 'undefined' && typeof searchMatches !== 'undefined')
    ? searchMatches[currentMatchIndex] : -1;
  var _kw = typeof searchKeyword !== 'undefined' ? searchKeyword : '';
  domPool.activeElements.forEach(function(el, idx) {
    if (el.textContent === '...') {
      var content = window.App.ChunkCache ? window.App.ChunkCache.get(idx) : null;
      if (content) {
        if (idx === _matchLine && _kw) {
          el.innerHTML = applyBatchHighlight(content, {
            searchKeyword: _kw,
            customHighlights: [],
            currentMatchLine: _matchLine,
            lineIndex: idx
          });
        } else {
          el.textContent = content;
        }
      }
    }
  });
}

/**
 * renderLogLines — 文件加载时初始化虚拟滚动
 */
function renderLogLines() {
  try {


    var effectiveTotal = getEffectiveTotalLines();
    if (!inner) {
      console.error('[renderLogLines] inner element not found!');
      return;
    }
    if (effectiveTotal === 0) return;

    inner.innerHTML = "";
    lastVisibleStart = -1;
    lastVisibleEnd = -1;

    var screenVisibleLines = Math.ceil(outer.clientHeight / lineHeight);
    var poolSize = screenVisibleLines + bufferSize * 2;

    if (!domPool || Math.abs(domPool.initialSize - poolSize) > 50) {
      if (domPool) domPool.clear();
      domPool = new DOMPool(inner, poolSize);
    } else {
      domPool.releaseAll();
    }

    var placeholder = document.createElement("div");
    placeholder.className = "log-placeholder";
    placeholder.id = "logPlaceholder";
    var safeHeightInfo = computeSafeScrollHeight(effectiveTotal);
    placeholder.style.height = safeHeightInfo.height + "px";

    if (virtualScrollScale > 1) {
      console.log('[renderLogLines] 超大文件模式: ' + effectiveTotal + ' 行, scale=' + virtualScrollScale.toFixed(4));
    }

    inner.appendChild(placeholder);

    // Register chunk cache callback for DOM refresh after async loads
    if (window.fileLoadMode === 'chunk' && window.App && window.App.ChunkCache) {
      window.App.ChunkCache.onLoadComplete = chunkRefreshVisibleText;
    }

    // 注册主日志行点击持久高亮（只注册一次）
    if (!outer._lineClickHandlerInstalled) {
      outer._lineClickHandlerInstalled = true;
      outer.addEventListener('click', function(e) {
        var line = e.target.closest('.log-line');
        if (!line) return;
        var idx = parseInt(line.dataset.index, 10);
        if (isNaN(idx)) return;
        currentPermanentHighlightIndex = idx;
        if (typeof selectedOriginalIndex !== 'undefined') selectedOriginalIndex = idx;
        // O(1) class swap via domPool
        if (domPool && domPool.activeElements) {
          domPool.activeElements.forEach(function(el, i) {
            if (i === idx) {
              el.classList.add('permanent-highlight');
            } else {
              el.classList.remove('permanent-highlight');
            }
          });
        }
        // 更新过滤面板头部显示当前行所属文件
        if (typeof getFileNameForLineIndex === 'function' && typeof updateFilteredPanelHeaderWithFile === 'function') {
          var fp = getFileNameForLineIndex(idx);
          if (fp) updateFilteredPanelHeaderWithFile(fp);
        }
      });
    }

    updateVisibleLines();
  } catch (error) {
    console.error('[renderLogLines] Error:', error);
  }
}

// Fast scroll detection — tracks scroll velocity
var _lastScrollTop = 0;
var _lastScrollTime = 0;
var _isFastScrolling = false;
var _scrollStopTimer = null;
var _deferredRaf = null;

/**
 * updateVisibleLines — 滚动热路径（精简版）
 * 仅做纯文本渲染 + permanent-highlight，无搜索高亮、无选区保存
 * 支持 chunk 模式的异步按需加载
 *
 * 优化：快速滚动时跳过内容渲染，只做 DOM 定位，减少每帧开销
 */
function updateVisibleLines() {
  var effectiveTotal = getEffectiveTotalLines();
  if (effectiveTotal === 0) return;


  var isChunk = window.fileLoadMode === 'chunk';
  var scrollTop = outer.scrollTop;
  var clientHeight = outer.clientHeight;

  // Fast scroll detection
  var now = Date.now();
  var dt = now - _lastScrollTime;
  if (dt > 0 && _lastScrollTime > 0) {
    var velocity = Math.abs(scrollTop - _lastScrollTop) / dt; // px/ms
    _isFastScrolling = velocity > 10;
  }
  _lastScrollTop = scrollTop;
  _lastScrollTime = now;

  var firstVisibleLine = scrollTopToLine(scrollTop);
  var lastVisibleLine;
  if (virtualScrollScale > 1) {
    lastVisibleLine = Math.min(effectiveTotal - 1, firstVisibleLine + Math.ceil(clientHeight / lineHeight));
  } else {
    lastVisibleLine = scrollTopToLine(scrollTop + clientHeight);
  }

  // Fast scroll: shrink buffer to reduce DOM work per frame
  var activeBuffer = _isFastScrolling ? Math.min(20, bufferSize) : bufferSize;

  var newVisibleStart = Math.max(0, firstVisibleLine - activeBuffer);
  var newVisibleEnd = Math.min(effectiveTotal - 1, lastVisibleLine + activeBuffer);

  if (newVisibleStart === lastVisibleStart && newVisibleEnd === lastVisibleEnd) return;

  // DOM池回收滚动出的元素（必须在更新 lastVisible 之前）
  if (domPool && lastVisibleStart >= 0 && lastVisibleEnd >= 0) {
    if (newVisibleStart > lastVisibleStart) {
      domPool.releaseRange(lastVisibleStart, newVisibleStart - 1);
    }
    if (newVisibleEnd < lastVisibleEnd) {
      domPool.releaseRange(newVisibleEnd + 1, lastVisibleEnd);
    }
  }

  visibleStart = newVisibleStart;
  visibleEnd = newVisibleEnd;
  lastVisibleStart = visibleStart;
  lastVisibleEnd = visibleEnd;

  var fragment = document.createDocumentFragment();

  var compressionAnchor = 0;
  var compressionFirstLine = 0;
  if (virtualScrollScale > 1) {
    compressionFirstLine = firstVisibleLine;
    compressionAnchor = scrollTop;
  }

  var highlightIdx = currentPermanentHighlightIndex;
  var _searchKeyword = typeof searchKeyword !== 'undefined' ? searchKeyword : '';
  var _searchMatchLine = (typeof totalMatchCount !== 'undefined' && totalMatchCount > 0
    && typeof currentMatchIndex !== 'undefined' && typeof searchMatches !== 'undefined')
    ? searchMatches[currentMatchIndex] : -1;

  for (var i = visibleStart; i <= visibleEnd; i++) {
    // Check if element is already active in the pool
    var alreadyActive = domPool && domPool.activeElements && domPool.activeElements.has(i);

    if (alreadyActive) {
      // Already-visible element: update position + search highlight state
      var existingLine = domPool.activeElements.get(i);
      if (virtualScrollScale > 1) {
        existingLine.style.transform = 'translateY(' + (compressionAnchor + (i - compressionFirstLine) * lineHeight) + 'px)';
      } else {
        existingLine.style.transform = 'translateY(' + lineToScrollTop(i) + 'px)';
      }
      // Re-apply content if search highlight state changed for this line
      if (!existingLine.classList.contains('file-header') && _searchKeyword) {
        var needsHighlight = (i === _searchMatchLine);
        var hasHighlight = existingLine.innerHTML !== existingLine.textContent;
        if (needsHighlight && !hasHighlight) {
          var existingContent = isChunk
            ? (window.App.ChunkCache ? window.App.ChunkCache.get(i) : null) || '...'
            : (originalLines ? originalLines[i] : '');
          if (existingContent) {
            existingLine.innerHTML = applyBatchHighlight(existingContent, {
              searchKeyword: _searchKeyword,
              customHighlights: [],
              currentMatchLine: _searchMatchLine,
              lineIndex: i
            });
          }
        } else if (!needsHighlight && hasHighlight) {
          var rawContent = isChunk
            ? (window.App.ChunkCache ? window.App.ChunkCache.get(i) : null) || '...'
            : (originalLines ? originalLines[i] : '');
          if (rawContent) existingLine.textContent = rawContent;
        }
      }
      continue;
    }

    // New element — full initialization
    var lineContent;
    if (isChunk) {
      lineContent = window.App.ChunkCache ? window.App.ChunkCache.get(i) : null;
      if (!lineContent) {
        lineContent = '...';
      }
    } else {
      lineContent = originalLines[i];
    }
    if (!lineContent && lineContent !== '') continue;

    var isFileHeader = lineContent.charCodeAt(0) === 61;

    var line = domPool
      ? domPool.acquire(i, isFileHeader ? "file-header" : "log-line")
      : (function() {
          var el = document.createElement("div");
          el.className = isFileHeader ? "file-header" : "log-line";
          el.dataset.index = String(i);
          el.style.cssText = "position:absolute;width:max-content;min-width:100%;left:0;";
          return el;
        })();

    if (!isFileHeader && i === highlightIdx) {
      line.classList.add("permanent-highlight");
    }

    // 定位
    if (virtualScrollScale > 1) {
      line.style.transform = 'translateY(' + (compressionAnchor + (i - compressionFirstLine) * lineHeight) + 'px)';
      line.style.height = lineHeight + "px";
      line.style.lineHeight = lineHeight + "px";
    } else {
      line.style.transform = 'translateY(' + lineToScrollTop(i) + 'px)';
    }

    line.dataset.lineNumber = i + 1;

    if (!isFileHeader && i === _searchMatchLine && _searchKeyword) {
      line.innerHTML = applyBatchHighlight(lineContent, {
        searchKeyword: _searchKeyword,
        customHighlights: [],
        currentMatchLine: _searchMatchLine,
        lineIndex: i
      });
    } else {
      line.textContent = lineContent;
    }

    if (!line.parentElement || line.parentElement !== inner) {
      fragment.appendChild(line);
    }
  }

  if (fragment.children.length > 0) {
    inner.appendChild(fragment);
  }

  // Chunk mode: proactive loading (don't refresh text on every scroll frame)
  if (isChunk && window.App.ChunkCache) {
    window.App.ChunkCache.setScrollCenter(Math.floor((firstVisibleLine + lastVisibleLine) / 2));
    window.App.ChunkCache.ensureRange(visibleStart, Math.min(effectiveTotal - 1, visibleEnd));
  }

  // Defer heavy work to idle time: scroll progress + chunk text refresh
  if (!_deferredRaf) {
    _deferredRaf = requestAnimationFrame(function () {
      _deferredRaf = null;
      if (typeof updateScrollProgress === 'function') updateScrollProgress();
      if (isChunk) chunkRefreshVisibleText();
    });
  }

  // Scroll-stop detection: after fast scrolling stops, do full re-render with buffer
  if (_scrollStopTimer) clearTimeout(_scrollStopTimer);
  var stopDelay = _isFastScrolling ? 150 : 300;
  _scrollStopTimer = setTimeout(function () {
    _isFastScrolling = false;
    _scrollStopTimer = null;
    lastVisibleStart = -1;
    lastVisibleEnd = -1;
    updateVisibleLines();
  }, stopDelay);
}

/**
 * jumpToLine — 跳转到指定行（goto 功能）
 */
function jumpToLine(lineNumber, position) {
  var maxLines = getEffectiveTotalLines();
  if (lineNumber < 0 || lineNumber >= maxLines) return;

  if (smoothScrollRafId) {
    cancelAnimationFrame(smoothScrollRafId);
  }

  var targetScrollTop = lineToScrollTop(lineNumber);
  var clientHeight = outer.clientHeight;
  var vscale = (typeof window.virtualScrollScale !== 'undefined' && window.virtualScrollScale > 1) ? window.virtualScrollScale : 1;
  var finalScrollTop = targetScrollTop;

  if (position === 'center') {
    finalScrollTop = targetScrollTop - (clientHeight / 2 - lineHeight / 2) / vscale;
  } else if (position === 'end') {
    finalScrollTop = targetScrollTop - (clientHeight - lineHeight) / vscale;
  }

  finalScrollTop = Math.max(0, Math.min(finalScrollTop, outer.scrollHeight - clientHeight));
  outer.scrollTop = finalScrollTop;

  if (typeof selectLine === 'function') selectLine(lineNumber);
}

/**
 * 强制刷新可见行
 */
function forceUpdateVisibleLines() {
  lastVisibleStart = -1;
  lastVisibleEnd = -1;
  updateVisibleLines();
}

/**
 * 更新占位符高度
 */
function updatePlaceholderHeight() {
  var placeholder = document.getElementById("logPlaceholder");
  if (!placeholder) return;
  var effectiveTotal = getEffectiveTotalLines();
  var safeHeightInfo = computeSafeScrollHeight(effectiveTotal);
  placeholder.style.height = safeHeightInfo.height + "px";
  placeholder.style.transform = "none";
}

window.updatePlaceholderHeight = updatePlaceholderHeight;

/**
 * jumpToOriginalLine — 过滤面板点击跳转到主日志行
 */
const originalJumpToOriginalLine = jumpToOriginalLine;
function jumpToOriginalLine(originalIndex) {
  const containerHeight = outer.clientHeight;
  const targetLineTop = lineToScrollTop(originalIndex);
  // 压缩模式下物理像素偏移需除以 scale，否则跳转偏移数百行
  var vscale = (typeof window.virtualScrollScale !== 'undefined' && window.virtualScrollScale > 1) ? window.virtualScrollScale : 1;
  const offsetFromTop = containerHeight * 0.2 / vscale;
  const targetTop = Math.max(0, targetLineTop - offsetFromTop);

  if (smoothScrollRafId) {
    cancelAnimationFrame(smoothScrollRafId);
    smoothScrollRafId = null;
  }

  outer.scrollTop = targetTop;
  highlightOriginalLine(originalIndex, true);
}

window.jumpToOriginalLine = jumpToOriginalLine;
if (typeof window.originalJumpToOriginalLine !== 'undefined') {
  window.originalJumpToOriginalLine = jumpToOriginalLine;
}

// ==================== 全局暴露（供其他模块使用） ====================
window.highlightCache = highlightCache;
window.highlightContent = highlightContent;
window.escapeHtml = escapeHtml;
window.escapeRegex = escapeRegex;

window.clearHighlightCache = function() {
  highlightCache.clear();
};

console.log('✓ Virtual Scroll Patch loaded (optimized for plain-text display)');
