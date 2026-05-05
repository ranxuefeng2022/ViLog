/**
 * 真正的虚拟滚动模块
 * 负责高性能渲染百万级日志
 */

window.App = window.App || {};
window.App.VirtualScroll = {
  // 配置
  config: {
    lineHeight: 19,        // 行高 (px)
    bufferSize: 150,       // 缓冲区大小（上下各150行）
    poolSize: 400,         // DOM池初始大小
  },

  // 状态
  state: {
    totalLines: 0,         // 总行数
    visibleStart: -1,      // 可见起始索引
    visibleEnd: -1,        // 可见结束索引
    lastScrollTop: 0,      // 上次滚动位置
    isInitialized: false,  // 是否已初始化
  },

  // DOM 池
  domPool: null,
  poolElements: [],        // 池中的元素
  activeElements: new Map(), // 当前活跃的元素: index -> element

  // 容器引用
  container: null,
  scrollContainer: null,
  placeholder: null,

  // 缓存
  htmlCache: new Map(),
  maxCacheSize: 500,

  /**
   * 初始化虚拟滚动
   * @param {HTMLElement} scrollContainer - 滚动容器（outer）
   * @param {HTMLElement} contentContainer - 内容容器（inner）
   */
  init: function(scrollContainer, contentContainer) {
    // 防止重复初始化
    if (this.state.isInitialized) {
      console.log('Virtual Scroll already initialized, skipping...');
      return;
    }

    this.container = contentContainer;
    this.scrollContainer = scrollContainer;

    // 🚀 性能优化：动态计算bufferSize
    this._updateBufferSize();

    // 初始化 DOM 池
    this._initDOMPool();

    // 绑定滚动事件
    this._bindScrollEvent();

    // 绑定窗口大小变化事件
    this._bindResizeEvent();

    this.state.isInitialized = true;
    console.log('✓ Virtual Scroll initialized');
  },

  /**
   * 🚀 动态计算最优bufferSize
   * 根据可见区域动态调整缓冲区大小
   */
  _updateBufferSize: function() {
    const visibleLines = Math.ceil(this.scrollContainer.clientHeight / this.config.lineHeight);

    // 🚀 优化：缓冲区设置为可见区域的100%（原50%）以提升滚动流畅度
    // 这样可以大幅减少快速滚动时的白屏
    const optimalBuffer = Math.ceil(visibleLines * 1.0);

    // 限制在合理范围内：最小100，最大300
    this.config.bufferSize = Math.max(100, Math.min(300, optimalBuffer));

    // 同时更新DOM池大小
    const optimalPoolSize = visibleLines + this.config.bufferSize * 2;
    this.config.poolSize = Math.max(200, Math.min(800, optimalPoolSize));

    console.log(`[VirtualScroll] 动态bufferSize: ${this.config.bufferSize}, poolSize: ${this.config.poolSize} (可见行: ${visibleLines})`);
  },

  /**
   * 渲染可见区域内容（保留用于事件监听）
   * @param {number} start - 起始索引
   * @param {number} end - 结束索引
   */
  _renderVisibleContent: function(start, end) {
    // 此方法保留用于可能的扩展
  },

  /**
   * 初始化 DOM 池
   */
  _initDOMPool: function() {
    this.poolElements = [];
    this.activeElements.clear();

    // 预创建 DOM 元素
    for (let i = 0; i < this.config.poolSize; i++) {
      const element = this._createPoolElement();
      this.poolElements.push(element);
      this.container.appendChild(element);
    }
  },

  /**
   * 创建单个池元素
   */
  _createPoolElement: function() {
    const element = document.createElement('div');
    element.className = 'log-line';
    element.style.cssText = 'position:absolute;width:max-content;min-width:100%;display:none;left:0;';
    element.style.contentVisibility = 'auto'; // 关键：CSS优化，跳过视口外渲染
    element.style.willChange = 'transform'; // 提示浏览器创建GPU合成层
    return element;
  },

  /**
   * 获取池元素用于显示指定行
   */
  _acquireElement: function(index) {
    // 检查是否已有活跃元素
    if (this.activeElements.has(index)) {
      return this.activeElements.get(index);
    }

    // 从池中获取或创建新元素
    let element;
    if (this.poolElements.length > 0) {
      element = this.poolElements.pop();
    } else {
      element = this._createPoolElement();
      this.container.appendChild(element);
    }

    // 设置基本信息
    element.style.display = 'block';
    element.dataset.index = String(index);
    // 🚀 使用 transform 替代 top，启用 GPU 合成层
    element.style.transform = `translateY(${Math.floor(index * this.config.lineHeight)}px)`;

    // 加入活跃集合
    this.activeElements.set(index, element);

    return element;
  },

  /**
   * 回收元素到池中
   */
  _releaseElement: function(index) {
    const element = this.activeElements.get(index);
    if (element) {
      element.style.display = 'none';
      element.textContent = '';
      element.className = 'log-line';
      element.removeAttribute('data-line-number');
      this.activeElements.delete(index);
      this.poolElements.push(element);
    }
  },

  /**
   * 绑定滚动事件（带节流 + 基于滚动速度的缓冲区自适应）
   *
   * 使用滚动位移速度而非时间间隔来判断快速滚动，
   * 兼容 60Hz/120Hz/144Hz 等各种刷新率显示器。
   */
  _bindScrollEvent: function() {
    let rafId = null;
    let lastScrollTop = 0;
    let lastScrollTime = 0;
    let lastLineSpeed = 0;
    const originalBufferSize = this.config.bufferSize;

    this.scrollContainer.addEventListener('scroll', () => {
      const now = performance.now();
      const currentScrollTop = this.scrollContainer.scrollTop;

      // 基于位移速度判断是否快速滚动（行/秒），而非固定时间间隔
      const dt = now - lastScrollTime;
      const dy = Math.abs(currentScrollTop - lastScrollTop);
      const lineSpeed = dt > 0 ? (dy / this.config.lineHeight) / (dt / 1000) : 0;

      // 指数移动平均平滑速度，减少抖动
      lastLineSpeed = lastLineSpeed * 0.7 + lineSpeed * 0.3;

      lastScrollTop = currentScrollTop;
      lastScrollTime = now;

      if (rafId) return;

      rafId = requestAnimationFrame(() => {
        // 速度 > 200 行/秒视为快速滚动，临时扩大缓冲区
        // 速度 > 800 行/秒视为极快滚动，最大化缓冲区
        if (lastLineSpeed > 800) {
          this.config.bufferSize = Math.min(500, Math.ceil(originalBufferSize * 2));
        } else if (lastLineSpeed > 200) {
          this.config.bufferSize = Math.min(400, Math.ceil(originalBufferSize * 1.5));
        } else {
          this.config.bufferSize = originalBufferSize;
        }
        this._updateVisibleRange();
        rafId = null;
      });
    }, { passive: true });
  },

  /**
   * 绑定窗口大小变化事件
   */
  _bindResizeEvent: function() {
    let resizeRaf = null;

    window.addEventListener('resize', () => {
      if (resizeRaf) return;

      resizeRaf = requestAnimationFrame(() => {
        // 🚀 窗口大小变化时重新计算bufferSize
        this._updateBufferSize();
        this._updateVisibleRange();
        resizeRaf = null;
      });
    });
  },

  /**
   * 计算并更新可见范围
   */
  _updateVisibleRange: function() {
    if (this.state.totalLines === 0) return;

    // 🚀 当 DOMPool 活跃时，跳过元素回收（避免与 DOMPool 争抢 DOM）
    // DOMPool 通过 acquire/release 管理自己的池子，VirtualScroll 不再重复管理
    if (window.domPool) {
      // 仅跟踪可见范围（供 buffer 优化使用），不做 DOM 操作
      const scrollTop = this.scrollContainer.scrollTop;
      const clientHeight = this.scrollContainer.clientHeight;
      const buffer = this.config.bufferSize;
      const newStart = Math.max(0, Math.floor(scrollTop / this.config.lineHeight) - buffer);
      const newEnd = Math.min(
        this.state.totalLines - 1,
        Math.ceil((scrollTop + clientHeight) / this.config.lineHeight) + buffer
      );
      this.state.visibleStart = newStart;
      this.state.visibleEnd = newEnd;
      return;
    }

    const scrollTop = this.scrollContainer.scrollTop;
    const clientHeight = this.scrollContainer.clientHeight;

    // 计算可见范围
    const buffer = this.config.bufferSize;
    const newStart = Math.max(0, Math.floor(scrollTop / this.config.lineHeight) - buffer);
    const newEnd = Math.min(
      this.state.totalLines - 1,
      Math.ceil((scrollTop + clientHeight) / this.config.lineHeight) + buffer
    );

    // 如果范围没变，跳过更新
    if (newStart === this.state.visibleStart && newEnd === this.state.visibleEnd) {
      return;
    }

    const oldStart = this.state.visibleStart;
    const oldEnd = this.state.visibleEnd;

    this.state.visibleStart = newStart;
    this.state.visibleEnd = newEnd;

    // 回收不再可见的元素
    if (oldStart >= 0 && oldEnd >= 0) {
      // 回收上方移出的元素
      if (newStart > oldStart) {
        for (let i = oldStart; i < newStart; i++) {
          this._releaseElement(i);
        }
      }
      // 回收下方移出的元素
      if (newEnd < oldEnd) {
        for (let i = newEnd + 1; i <= oldEnd; i++) {
          this._releaseElement(i);
        }
      }
    }

    // 通知外部更新可见行内容
    this._notifyVisibleChange(newStart, newEnd);
  },

  /**
   * 通知外部可见范围变化，需要更新内容
   */
  _notifyVisibleChange: function(start, end) {
    // 触发自定义事件，供外部监听
    const event = new CustomEvent('virtualScrollVisibleChange', {
      detail: { start, end }
    });
    window.dispatchEvent(event);
  },

  /**
   * 设置总行数
   */
  setTotalLines: function(count) {
    this.state.totalLines = count;

    // 更新占位符高度（使用合理的大小，避免过大）
    // 对于超大文件，使用 CSS 变换来模拟滚动，而不是真实的像素高度
    if (this.placeholder) {
      this._updatePlaceholderHeight();
    } else {
      this._createPlaceholder();
    }
  },

  /**
   * 创建/更新占位符
   */
  _createPlaceholder: function() {
    this.placeholder = document.createElement('div');
    this.placeholder.className = 'virtual-scroll-placeholder';
    this.placeholder.style.cssText = 'position:absolute;width:1px;height:0;';
    this.container.insertBefore(this.placeholder, this.container.firstChild);
    this._updatePlaceholderHeight();
  },

  /**
   * 更新占位符高度
   * 关键优化：对于超大文件，使用 transform 代替 height
   */
  _updatePlaceholderHeight: function() {
    if (!this.placeholder) return;

    const totalHeight = this.state.totalLines * this.config.lineHeight;

    if (totalHeight > 10000000) {
      // 对于超大文件，使用 transform 来避免浏览器性能问题
      this.placeholder.style.height = '1px';
      this.placeholder.style.transform = `scaleY(${totalHeight})`;
      this.placeholder.style.transformOrigin = 'top';
    } else {
      // 对于正常大小，直接设置高度
      this.placeholder.style.height = totalHeight + 'px';
      this.placeholder.style.transform = 'none';
    }
  },

  /**
   * 滚动到指定行
   * @param {number} lineIndex - 行索引（0开始）
   * @param {string} position - 'start' | 'center' | 'end'
   */
  scrollToLine: function(lineIndex, position = 'center') {
    if (lineIndex < 0 || lineIndex >= this.state.totalLines) return;

    const lineTop = lineIndex * this.config.lineHeight;
    const clientHeight = this.scrollContainer.clientHeight;
    const maxScrollTop = this.scrollContainer.scrollHeight - clientHeight;

    let targetScrollTop;
    switch (position) {
      case 'start':
        targetScrollTop = lineTop;
        break;
      case 'end':
        targetScrollTop = Math.min(lineTop - clientHeight + this.config.lineHeight, maxScrollTop);
        break;
      case 'center':
      default:
        targetScrollTop = Math.max(0, lineTop - clientHeight / 2);
        break;
    }

    targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));

    // 设置滚动位置
    this.scrollContainer.scrollTop = targetScrollTop;
  },

  /**
   * 获取当前可见范围
   */
  getVisibleRange: function() {
    return {
      start: this.state.visibleStart,
      end: this.state.visibleEnd
    };
  },

  /**
   * 清空所有元素
   */
  clear: function() {
    // 回收所有活跃元素
    for (const index of this.activeElements.keys()) {
      this._releaseElement(index);
    }
    this.activeElements.clear();

    this.state.totalLines = 0;
    this.state.visibleStart = -1;
    this.state.visibleEnd = -1;

    // 重置占位符
    if (this.placeholder) {
      this.placeholder.style.height = '0';
      this.placeholder.style.transform = 'none';
    }
  },

  /**
   * 获取当前活跃元素数量
   */
  getActiveCount: function() {
    return this.activeElements.size;
  },

  /**
   * 更新行高配置
   */
  setLineHeight: function(height) {
    this.config.lineHeight = height;
    // 更新所有活跃元素的位置（使用 transform 而非 top，利用 GPU 合成层）
    for (const [index, element] of this.activeElements) {
      element.style.transform = `translateY(${Math.floor(index * height)}px)`;
    }
    // 更新占位符
    this._updatePlaceholderHeight();
  }
};

// ===================================================================
// Highlight caching system
// ===================================================================

window.App.VirtualScroll.highlightCache = {
  cache: new Map(),
  maxSize: 5000,
  stats: { hits: 0, misses: 0, evictions: 0 },
  state: { searchKeyword: '', customHighlights: [], filterKeywords: [] },

  getKey(originalText, searchKeyword, customHighlights, filterKeywords) {
    const searchId = searchKeyword ? `s:${searchKeyword.length > 20 ? searchKeyword.slice(0,20) + '...' : searchKeyword}` : '';
    const customId = customHighlights.length > 0 ? `c:${customHighlights.map(h => h.keyword).join(',')}` : '';
    const filterId = filterKeywords.length > 0 ? `f:${filterKeywords.slice(0,3).join(',')}` : '';
    const stateKey = [searchId, customId, filterId].filter(Boolean).join('|');
    let hash = 0;
    for (let i = 0; i < originalText.length; i++) {
      hash = ((hash << 5) - hash) + originalText.charCodeAt(i);
      hash = hash & hash;
    }
    return `${stateKey}#${hash}`;
  },

  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) { this.stats.hits++; } else { this.stats.misses++; }
    return value;
  },

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const keysToDelete = Array.from(this.cache.keys()).slice(0, Math.floor(this.maxSize / 4));
      keysToDelete.forEach(k => this.cache.delete(k));
      this.stats.evictions += keysToDelete.length;
    }
    this.cache.set(key, value);
  },

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return { ...this.stats, size: this.cache.size, hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : '0.0' };
  },

  resetStats() { this.stats = { hits: 0, misses: 0, evictions: 0 }; },

  isStateChanged(searchKeyword, customHighlights, filterKeywords) {
    const s = this.state;
    if (s.searchKeyword !== searchKeyword) return true;
    if (s.customHighlights.length !== (customHighlights || []).length) return true;
    if (s.filterKeywords.length !== (filterKeywords || []).length) return true;
    return false;
  },

  updateState(searchKeyword, customHighlights, filterKeywords) {
    if (this.isStateChanged(searchKeyword, customHighlights, filterKeywords)) {
      this.state = { searchKeyword: searchKeyword || '', customHighlights: customHighlights || [], filterKeywords: filterKeywords || [] };
      this.cache.clear();
      console.log('[HighlightCache] 状态变化，缓存已清除');
    }
  },

  clear() { this.cache.clear(); }
};

function _escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _getFilterHighlightClass(keywordIndex) {
  const classes = [
    'filter-highlight-0', 'filter-highlight-1', 'filter-highlight-2', 'filter-highlight-3',
    'filter-highlight-4', 'filter-highlight-5', 'filter-highlight-6', 'filter-highlight-7',
    'filter-highlight-8', 'filter-highlight-9', 'filter-highlight-10', 'filter-highlight-11',
    'filter-highlight-12', 'filter-highlight-13', 'filter-highlight-14', 'filter-highlight-15',
    'filter-highlight-16', 'filter-highlight-17', 'filter-highlight-18', 'filter-highlight-19'
  ];
  return classes[keywordIndex % classes.length];
}

function _mergeHighlightRanges(ranges, originalText) {
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
  const htmlEscapedText = _escapeHtml(originalText);
  function getHtmlIndex(originalIndex) {
    let htmlIndex = 0;
    let originalPos = 0;
    while (originalPos < originalIndex && htmlIndex < htmlEscapedText.length) {
      const char = originalText[originalPos];
      if (char === '&') { htmlIndex += 5; }
      else if (char === '<') { htmlIndex += 4; }
      else if (char === '>') { htmlIndex += 4; }
      else if (char === '"') { htmlIndex += 6; }
      else if (char === "'") { htmlIndex += 5; }
      else { htmlIndex += 1; }
      originalPos++;
    }
    return htmlIndex;
  }
  return merged.map(range => ({
    ...range,
    htmlStart: getHtmlIndex(range.start),
    htmlEnd: getHtmlIndex(range.end),
  }));
}

window.App.VirtualScroll.highlightContent = function(originalText, highlightConfig) {
  const { searchKeyword = '', customHighlights = [], filterKeywords = [], lineIndex = -1, currentMatchLine = -1 } = highlightConfig || {};
  if (!originalText) return '';

  const cacheKey = this.highlightCache.getKey(originalText, searchKeyword, customHighlights, filterKeywords);
  const cached = this.highlightCache.get(cacheKey);
  if (cached !== undefined) return cached;

  this.highlightCache.updateState(searchKeyword, customHighlights, filterKeywords);

  let result = _escapeHtml(originalText);
  const highlightRanges = [];

  if (searchKeyword && searchKeyword.trim()) {
    try {
      const regex = new RegExp(_escapeRegex(searchKeyword), 'gi');
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
      const regex = new RegExp(_escapeRegex(highlight.keyword), 'gi');
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
      const regex = new RegExp(_escapeRegex(keyword), 'gi');
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

  const mergedRanges = _mergeHighlightRanges(highlightRanges, originalText);

  for (let i = mergedRanges.length - 1; i >= 0; i--) {
    const range = mergedRanges[i];
    const before = result.slice(0, range.htmlStart);
    const matched = result.slice(range.htmlStart, range.htmlEnd);
    const after = result.slice(range.htmlEnd);
    let highlightClass = '';
    let style = '';
    if (range.type === 'search') {
      highlightClass = (lineIndex === currentMatchLine) ? 'current-search-highlight' : 'search-highlight';
    } else if (range.type === 'custom') {
      highlightClass = 'custom-highlight';
      style = `background-color: ${range.color}80;`;
    } else if (range.type === 'filter') {
      highlightClass = _getFilterHighlightClass(range.classIndex);
    }
    const tag = style ? `<span class="${highlightClass}" style="${style}">` : `<span class="${highlightClass}">`;
    result = before + tag + matched + '</span>' + after;
  }

  this.highlightCache.set(cacheKey, result);
  return result;
};

console.log('✓ Virtual Scroll module loaded (with highlight system)');
