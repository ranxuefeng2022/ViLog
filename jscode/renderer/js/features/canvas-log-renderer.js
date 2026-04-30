/**
 * Canvas日志渲染器
 * 使用Canvas渲染主日志框，大幅降低内存占用
 *
 * 优化：
 * - 脏区域滚动复用：垂直滚动时仅绘制新增行
 * - LogLineStore 分块内存管理：视口远离的块自动压缩释放
 * - 移除高频 wheel 事件中的 console.log
 */

(function() {
  'use strict';

  /**
   * 日志行分块存储：自动压缩远离视口的数据块，降低内存占用
   * - 每个块 50000 行，超出视口窗口的块自动打包为紧凑字符串
   * - 访问时自动解包，LRU 淘汰策略
   */
  class LogLineStore {
    constructor(chunkSize = 50000) {
      this.chunkSize = chunkSize;
      this.chunks = [];           // { lines: string[] | null, packed: string | null }
      this.totalLines = 0;
      this.maxHotChunks = 20;     // 最多同时保持解压的块数
      this.hotChunkIndices = [];  // LRU 热块索引
    }

    setData(data) {
      this.totalLines = data.length;
      this.chunks = [];
      this.hotChunkIndices = [];

      for (let i = 0; i < data.length; i += this.chunkSize) {
        const end = Math.min(i + this.chunkSize, data.length);
        this.chunks.push({
          lines: data.slice(i, end),
          packed: null
        });
      }

      // 所有块初始都是热的
      for (let i = 0; i < this.chunks.length; i++) {
        this.hotChunkIndices.push(i);
      }

      console.log(`[LogLineStore] ${this.totalLines} 行, ${this.chunks.length} 个块 (${this.chunkSize} 行/块)`);
    }

    get length() { return this.totalLines; }

    getLine(index) {
      if (index < 0 || index >= this.totalLines) return '';

      const chunkIdx = Math.floor(index / this.chunkSize);
      const offset = index % this.chunkSize;
      const chunk = this.chunks[chunkIdx];
      if (!chunk) return '';

      // 如果块已被压缩，解压它
      if (chunk.packed !== null && chunk.lines === null) {
        chunk.lines = chunk.packed.split('\n');
        chunk.packed = null;

        // LRU 管理：加入热块列表
        this._markHot(chunkIdx);
        this._evictColdIfNeeded();
      } else {
        this._markHot(chunkIdx);
      }

      return (chunk.lines && chunk.lines[offset]) ? chunk.lines[offset] : '';
    }

    getChunkCount() { return this.chunks.length; }

    /**
     * 标记块为最近使用
     */
    _markHot(chunkIdx) {
      const pos = this.hotChunkIndices.indexOf(chunkIdx);
      if (pos !== -1) {
        this.hotChunkIndices.splice(pos, 1);
      }
      this.hotChunkIndices.push(chunkIdx);
    }

    /**
     * 压缩超出视口范围的块以释放内存
     * @param {number} viewportChunkStart - 视口起始块索引
     * @param {number} viewportChunkEnd   - 视口结束块索引
     */
    evictDistant(viewportChunkStart, viewportChunkEnd) {
      const keepRange = Math.max(2, Math.floor(this.maxHotChunks / 2));
      const start = Math.max(0, viewportChunkStart - keepRange);
      const end = Math.min(this.chunks.length - 1, viewportChunkEnd + keepRange);

      for (let i = 0; i < this.chunks.length; i++) {
        if (i >= start && i <= end) continue; // 保留视口附近的块
        const chunk = this.chunks[i];
        if (chunk && chunk.lines !== null && chunk.packed === null) {
          // 压缩为单个字符串（用换行分隔，日志行本身不含换行）
          chunk.packed = chunk.lines.join('\n');
          chunk.lines = null;

          // 从热块列表移除
          const pos = this.hotChunkIndices.indexOf(i);
          if (pos !== -1) {
            this.hotChunkIndices.splice(pos, 1);
          }
        }
      }
    }

    /**
     * LRU 淘汰：热块超过上限时压缩最久未使用的块
     */
    _evictColdIfNeeded() {
      while (this.hotChunkIndices.length > this.maxHotChunks) {
        const coldIdx = this.hotChunkIndices.shift();
        const chunk = this.chunks[coldIdx];
        if (chunk && chunk.lines !== null) {
          chunk.packed = chunk.lines.join('\n');
          chunk.lines = null;
        }
      }
    }

    /**
     * 统计内存使用（调试用）
     */
    getMemoryStats() {
      let hotBytes = 0, packedBytes = 0, hotCount = 0, packedCount = 0;
      for (const chunk of this.chunks) {
        if (chunk.lines !== null) {
          hotCount++;
          for (const line of chunk.lines) {
            hotBytes += line.length * 2; // UTF-16 估算
          }
        } else if (chunk.packed !== null) {
          packedCount++;
          packedBytes += chunk.packed.length * 2;
        }
      }
      return {
        chunks: this.chunks.length,
        hotChunks: hotCount,
        packedChunks: packedCount,
        hotBytesMB: (hotBytes / (1024 * 1024)).toFixed(1),
        packedBytesMB: (packedBytes / (1024 * 1024)).toFixed(1)
      };
    }

    clear() {
      this.chunks = [];
      this.totalLines = 0;
      this.hotChunkIndices = [];
    }
  }

  class CanvasLogRenderer {
    constructor() {
      this.canvas = null;
      this.ctx = null;
      this.lineStore = new LogLineStore();
      this.data = []; // 兼容旧接口，指向 lineStore
      this.lineHeight = 19;
      this.fontSize = 14;
      this.fontFamily = '"JetBrains Mono", "Monaco", "Menlo", "Ubuntu Mono", monospace';
      this.font = `${this.fontSize}px ${this.fontFamily}`;

      // 滚动状态
      this.scrollTop = 0;
      this.scrollLeft = 0;
      this.maxScrollLeft = 0;

      // 性能优化：缓存文本宽度
      this.textWidthCache = new Map();
      this.maxCacheSize = 1000;

      // 可见范围
      this.visibleStart = 0;
      this.visibleEnd = 0;

      // 脏区域优化：跟踪上次渲染的 scrollTop
      this._lastRenderScrollTop = -1;
      this._lastRenderScrollLeft = -1;

      // 回调函数
      this.onScroll = null;
      this.onLineClick = null;

      this.initialized = false;

      // 定期压缩远离视口的块（每 5 秒）
      this._evictTimer = null;
    }

    /**
     * 初始化Canvas渲染器
     */
    init(outerContainerId, canvasId) {
      const outer = document.getElementById(outerContainerId);
      if (!outer) {
        console.error('[CanvasLogRenderer] outerContainer not found');
        return false;
      }

      // 记录外层容器
      this.outerContainer = outer;

      // 创建Canvas元素
      this.canvas = document.createElement('canvas');
      this.canvas.id = canvasId;

      // 创建滚动区域占位符（普通流元素，提供滚动高度）
      this.scrollSpacer = document.createElement('div');
      this.scrollSpacer.className = 'canvas-log-scroll-spacer';

      // 替换innerContainer
      const inner = document.getElementById('innerContainer');
      if (inner) {
        outer.innerHTML = '';
        outer.appendChild(this.canvas);
        outer.appendChild(this.scrollSpacer);
      } else {
        outer.appendChild(this.canvas);
        outer.appendChild(this.scrollSpacer);
      }

      // 获取Canvas上下文
      this.ctx = this.canvas.getContext('2d', { alpha: false });

      // 设置Canvas尺寸
      this.resizeCanvas();

      // 绑定事件
      this.bindEvents(outer);

      // 监听窗口大小变化
      window.addEventListener('resize', () => {
        this.resizeCanvas();
      });

      this.initialized = true;
      console.log('[CanvasLogRenderer] ✓ 初始化完成');

      return true;
    }

    /**
     * 设置日志数据（使用分块存储）
     */
    setData(data) {
      this.lineStore.setData(data || []);

      // 兼容旧接口：this.data.length 仍可使用
      Object.defineProperty(this, 'data', {
        get: () => ({ length: this.lineStore.length }),
        configurable: true
      });

      console.log(`[CanvasLogRenderer] setData: ${this.lineStore.length} 行 (${this.lineStore.getChunkCount()} 个块)`);

      // 预计算最大宽度
      this._calculateMaxLineWidth();

      this.updateScrollHeight();
      this.render();

      // 启动定期压缩（在数据加载 3 秒后开始）
      this._scheduleEviction();
    }

    /**
     * 启动定期块压缩
     */
    _scheduleEviction() {
      if (this._evictTimer) clearTimeout(this._evictTimer);
      this._evictTimer = setTimeout(() => {
        const viewportChunkStart = Math.floor(this.visibleStart / this.lineStore.chunkSize);
        const viewportChunkEnd = Math.floor(this.visibleEnd / this.lineStore.chunkSize);
        this.lineStore.evictDistant(viewportChunkStart, viewportChunkEnd);
        const stats = this.lineStore.getMemoryStats();
        console.log(`[CanvasLogRenderer] 内存压缩: 热块${stats.hotChunks}/${stats.chunks}, 热数据${stats.hotBytesMB}MB, 压缩${stats.packedBytesMB}MB`);
      }, 3000);
    }

    /**
     * 预计算最大宽度
     */
    _calculateMaxLineWidth() {
      let maxWidth = 0;

      const totalLines = this.lineStore.length;
      const checkAll = totalLines < 10000;
      const step = checkAll ? 1 : Math.max(1, Math.floor(totalLines / 5000));

      for (let i = 0; i < totalLines; i += step) {
        const text = this.lineStore.getLine(i);
        if (text) {
          const width = this.measureText(text);
          if (width > maxWidth) {
            maxWidth = width;
          }
        }
      }

      // 加上左边距
      this.maxLineWidth = maxWidth + 20;
      console.log(`[CanvasLogRenderer] 最大宽度: ${this.maxLineWidth}px`);
    }

    /**
     * 调整Canvas尺寸
     */
    resizeCanvas() {
      if (!this.canvas || !this.outerContainer) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = this.outerContainer.getBoundingClientRect();

      // 设置Canvas的显示尺寸（CSS像素）
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';

      // 设置Canvas的实际尺寸（设备像素）
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;

      // 缩放上下文以匹配DPR
      this.ctx.scale(dpr, dpr);

      // 重置脏区域跟踪（尺寸变了需要全量重绘）
      this._lastRenderScrollTop = -1;
      this._lastRenderScrollLeft = -1;

      // 只在首次初始化时输出日志
      if (!this._hasResized) {
        console.log(`[CanvasLogRenderer] resizeCanvas: ${rect.width}x${rect.height} (DPR: ${dpr})`);
        this._hasResized = true;
      }

      this.render();
    }

    /**
     * 更新滚动高度
     */
    updateScrollHeight() {
      if (!this.canvas || !this.scrollSpacer) return;

      const totalHeight = this.lineStore.length * this.lineHeight;

      if (totalHeight > 10000000) {
        this.scrollSpacer.style.transformOrigin = 'top';
        this.scrollSpacer.style.transform = `scaleY(${totalHeight})`;
        this.scrollSpacer.style.height = '1px';
      } else {
        this.scrollSpacer.style.transform = 'none';
        this.scrollSpacer.style.height = `${totalHeight}px`;
      }
    }

    /**
     * 绑定滚动和点击事件
     */
    bindEvents(outer) {
      // 纵向滚动（outer容器）
      outer.addEventListener('scroll', () => {
        const newScrollTop = outer.scrollTop;
        if (Math.abs(newScrollTop - this.scrollTop) > 1) {
          this.scrollTop = newScrollTop;
          this.render();
        }
      });

      // 横向滚动
      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();

        if (e.deltaX !== 0) {
          this.scrollLeft = Math.max(0, Math.min(this.maxScrollLeft, this.scrollLeft + e.deltaX));
          this.render();
        }

        if (e.deltaY !== 0) {
          const newScrollTop = Math.max(0, Math.min(
            outer.scrollHeight - outer.clientHeight,
            outer.scrollTop + e.deltaY
          ));
          outer.scrollTop = newScrollTop;
        }
      }, { passive: false });

      // 点击事件（获取行号）
      this.canvas.addEventListener('click', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const lineIndex = Math.floor((y + this.scrollTop) / this.lineHeight);

        if (lineIndex >= 0 && lineIndex < this.lineStore.length) {
          if (this.onLineClick) {
            this.onLineClick(lineIndex);
          }
        }
      });
    }

    /**
     * 计算文本宽度（带缓存）
     */
    measureText(text) {
      if (this.textWidthCache.has(text)) {
        return this.textWidthCache.get(text);
      }

      this.ctx.font = this.font;
      const width = this.ctx.measureText(text).width;

      if (this.textWidthCache.size >= this.maxCacheSize) {
        const firstKey = this.textWidthCache.keys().next().value;
        this.textWidthCache.delete(firstKey);
      }
      this.textWidthCache.set(text, width);

      return width;
    }

    /**
     * 获取最长行的宽度
     */
    getMaxLineWidth() {
      return this.maxLineWidth || 0;
    }

    /**
     * 渲染可见区域
     *
     * 脏区域优化策略：
     * - 纯垂直滚动：复用画布已有内容，只绘制新增/变化的行
     * - 水平滚动或大幅度跳转：全量重绘
     */
    render() {
      if (!this.ctx || !this.canvas || !this.outerContainer) {
        return;
      }

      const rect = this.outerContainer.getBoundingClientRect();
      const viewportWidth = rect.width;
      const viewportHeight = rect.height;

      if (viewportWidth === 0 || viewportHeight === 0) {
        this.resizeCanvas();
        return;
      }

      const totalLines = this.lineStore.length;
      if (totalLines === 0) {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, viewportWidth, viewportHeight);
        return;
      }

      // 计算可见行范围
      const startLine = Math.floor(this.scrollTop / this.lineHeight);
      const endLine = Math.min(
        totalLines,
        Math.ceil((this.scrollTop + viewportHeight) / this.lineHeight)
      );

      const prevStart = this.visibleStart;
      const prevEnd = this.visibleEnd;
      this.visibleStart = startLine;
      this.visibleEnd = endLine;

      // 判断是否可以复用画布（脏区域优化）
      const isHorizontalScroll = this._lastRenderScrollLeft !== this.scrollLeft;
      const scrollDelta = this.scrollTop - this._lastRenderScrollTop;
      const isSmallVerticalScroll = !isHorizontalScroll &&
        Math.abs(scrollDelta) > 0 &&
        Math.abs(scrollDelta) < viewportHeight * 0.8; // 小于 80% 视口高度

      this.ctx.font = this.font;
      this.ctx.textBaseline = 'top';

      if (isSmallVerticalScroll && this._lastRenderScrollTop >= 0) {
        // === 脏区域优化路径：复用画布已有像素 ===
        const pixelDelta = Math.round(scrollDelta);
        this._shiftAndDrawNewLines(pixelDelta, viewportWidth, viewportHeight, startLine, endLine, prevStart, prevEnd);
      } else {
        // === 全量重绘路径 ===
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, viewportWidth, viewportHeight);

        for (let i = startLine; i < endLine; i++) {
          const text = this.lineStore.getLine(i);
          const y = (i * this.lineHeight) - this.scrollTop;

          this.ctx.fillStyle = '#000000';
          this.ctx.fillText(text, 10 - this.scrollLeft, y);
        }
      }

      this._lastRenderScrollTop = this.scrollTop;
      this._lastRenderScrollLeft = this.scrollLeft;

      // 更新最大横向滚动距离
      this.maxScrollLeft = Math.max(0, this.maxLineWidth - viewportWidth + 50);

      // 定期压缩远离视口的块
      this._scheduleEviction();
    }

    /**
     * 脏区域优化：平移画布内容 + 仅绘制新增行
     */
    _shiftAndDrawNewLines(pixelDelta, viewportWidth, viewportHeight, startLine, endLine, prevStart, prevEnd) {
      // 使用临时 canvas 来安全地实现自复制
      if (!this._tempCanvas) {
        this._tempCanvas = document.createElement('canvas');
      }
      const tempCanvas = this._tempCanvas;
      const dpr = window.devicePixelRatio || 1;
      tempCanvas.width = this.canvas.width;
      tempCanvas.height = this.canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.scale(dpr, dpr);

      // 复制当前画布内容到临时画布
      tempCtx.drawImage(this.canvas, 0, 0);

      // 清空主画布
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, viewportWidth, viewportHeight);

      if (pixelDelta > 0) {
        // 向下滚动：绘制旧内容向上偏移后的可视部分
        const srcY = pixelDelta;
        const srcH = viewportHeight - pixelDelta;
        if (srcH > 0) {
          this.ctx.drawImage(
            tempCanvas,
            0, srcY, viewportWidth, srcH,       // 源区域（CSS坐标）
            0, 0, viewportWidth, srcH             // 目标区域
          );
        }

        // 只绘制底部新增的几行
        const overlapEnd = prevEnd > startLine ? prevEnd : startLine;
        for (let i = overlapEnd; i < endLine; i++) {
          const text = this.lineStore.getLine(i);
          const y = (i * this.lineHeight) - this.scrollTop;
          this.ctx.fillStyle = '#000000';
          this.ctx.fillText(text, 10 - this.scrollLeft, y);
        }
      } else {
        // 向上滚动：绘制旧内容向下偏移后的可视部分
        const offset = -pixelDelta;
        const srcH = viewportHeight - offset;
        if (srcH > 0) {
          this.ctx.drawImage(
            tempCanvas,
            0, 0, viewportWidth, srcH,            // 源区域
            0, offset, viewportWidth, srcH         // 目标区域
          );
        }

        // 只绘制顶部新增的几行
        const overlapStart = prevStart < endLine ? prevStart : endLine;
        for (let i = startLine; i < overlapStart; i++) {
          const text = this.lineStore.getLine(i);
          const y = (i * this.lineHeight) - this.scrollTop;
          this.ctx.fillStyle = '#000000';
          this.ctx.fillText(text, 10 - this.scrollLeft, y);
        }
      }
    }

    /**
     * 滚动到指定行
     */
    scrollToLine(lineIndex) {
      if (lineIndex < 0 || lineIndex >= this.lineStore.length) return;

      const targetScrollTop = lineIndex * this.lineHeight;
      this.scrollTop = targetScrollTop;
      this._lastRenderScrollTop = -1; // 强制全量重绘

      const outer = this.canvas.parentElement;
      if (outer) {
        outer.scrollTop = this.scrollTop;
      }

      this.render();
    }

    /**
     * 获取当前可见行范围
     */
    getVisibleRange() {
      return {
        start: this.visibleStart,
        end: this.visibleEnd
      };
    }

    /**
     * 清空缓存
     */
    clearCache() {
      this.textWidthCache.clear();
    }

    /**
     * 销毁渲染器
     */
    destroy() {
      if (this._evictTimer) {
        clearTimeout(this._evictTimer);
        this._evictTimer = null;
      }
      this.clearCache();
      this.lineStore.clear();
      this.ctx = null;
      this.canvas = null;
      this._tempCanvas = null;
      this.initialized = false;
    }
  }

  // 导出到全局
  window.CanvasLogRenderer = CanvasLogRenderer;

  console.log('[CanvasLogRenderer] 模块已加载');
})();
