/**
 * Canvas日志渲染器
 * 使用Canvas渲染主日志框，大幅降低内存占用
 */

(function() {
  'use strict';

  class CanvasLogRenderer {
    constructor() {
      this.canvas = null;
      this.ctx = null;
      this.data = []; // 日志数据
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

      // 回调函数
      this.onScroll = null;
      this.onLineClick = null;

      this.initialized = false;
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
     * 设置日志数据
     */
    setData(data) {
      this.data = data || [];
      console.log(`[CanvasLogRenderer] setData: ${this.data.length} 行`);

      // 预计算最大宽度
      this._calculateMaxLineWidth();

      this.updateScrollHeight();
      this.render();
    }

    /**
     * 预计算最大宽度
     */
    _calculateMaxLineWidth() {
      let maxWidth = 0;

      // 如果数据量不大，检查所有行；否则采样
      const checkAll = this.data.length < 10000;
      const step = checkAll ? 1 : Math.max(1, Math.floor(this.data.length / 5000));

      for (let i = 0; i < this.data.length; i += step) {
        const width = this.measureText(this.data[i]);
        if (width > maxWidth) {
          maxWidth = width;
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

      // 设置Canvas的显示尺寸（CSS像素）- 明确设置以避免CSS百分比问题
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';

      // 设置Canvas的实际尺寸（设备像素）
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;

      // 缩放上下文以匹配DPR
      this.ctx.scale(dpr, dpr);

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

      const totalHeight = this.data.length * this.lineHeight;

      // 使用scrollSpacer（普通流元素）撑开滚动区域
      if (totalHeight > 10000000) {
        // 对于超大文件，使用transform scaleY避免高度限制
        this.scrollSpacer.style.transformOrigin = 'top';
        this.scrollSpacer.style.transform = `scaleY(${totalHeight})`;
        this.scrollSpacer.style.height = '1px';
      } else {
        // 对于正常大小，直接设置高度
        this.scrollSpacer.style.transform = 'none';
        this.scrollSpacer.style.height = `${totalHeight}px`;
      }

      console.log(`[CanvasLogRenderer] updateScrollHeight: ${totalHeight}px (${this.data.length} 行)`);
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

      // 横向滚动（Canvas元素 - Canvas覆盖整个容器，会拦截wheel事件）
      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();

        // 横向滚动
        if (e.deltaX !== 0) {
          this.scrollLeft = Math.max(0, Math.min(this.maxScrollLeft, this.scrollLeft + e.deltaX));
          console.log(`[CanvasLogRenderer] 横向滚动: scrollLeft=${this.scrollLeft}, maxScrollLeft=${this.maxScrollLeft}`);
          this.render();
        }

        // 纵向滚动 - 手动更新outer.scrollTop
        if (e.deltaY !== 0) {
          const newScrollTop = Math.max(0, Math.min(
            outer.scrollHeight - outer.clientHeight,
            outer.scrollTop + e.deltaY
          ));
          outer.scrollTop = newScrollTop;
          console.log(`[CanvasLogRenderer] 纵向滚动: scrollTop=${newScrollTop}, scrollHeight=${outer.scrollHeight}, clientHeight=${outer.clientHeight}`);
        }
      }, { passive: false });

      // 点击事件（获取行号）
      this.canvas.addEventListener('click', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const lineIndex = Math.floor((y + this.scrollTop) / this.lineHeight);

        if (lineIndex >= 0 && lineIndex < this.data.length) {
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

      // 缓存管理
      if (this.textWidthCache.size >= this.maxCacheSize) {
        const firstKey = this.textWidthCache.keys().next().value;
        this.textWidthCache.delete(firstKey);
      }
      this.textWidthCache.set(text, width);

      return width;
    }

    /**
     * 获取最长行的宽度（已废弃，使用预计算的maxLineWidth）
     */
    getMaxLineWidth() {
      return this.maxLineWidth || 0;
    }

    /**
     * 渲染可见区域
     */
    render() {
      if (!this.ctx || !this.canvas || !this.outerContainer) {
        console.warn('[CanvasLogRenderer] render: Canvas not ready');
        return;
      }

      const rect = this.outerContainer.getBoundingClientRect();
      const viewportWidth = rect.width;
      const viewportHeight = rect.height;

      // 如果Canvas尺寸为0，重新调整
      if (viewportWidth === 0 || viewportHeight === 0) {
        console.warn('[CanvasLogRenderer] Canvas尺寸为0，重新调整');
        this.resizeCanvas();
        return;
      }

      // 清空画布
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, viewportWidth, viewportHeight);

      if (this.data.length === 0) {
        return;
      }

      // 计算可见行范围
      const startLine = Math.floor(this.scrollTop / this.lineHeight);
      const endLine = Math.min(
        this.data.length,
        Math.ceil((this.scrollTop + viewportHeight) / this.lineHeight)
      );

      this.visibleStart = startLine;
      this.visibleEnd = endLine;

      // 设置字体
      this.ctx.font = this.font;
      this.ctx.textBaseline = 'top';

      // 渲染可见行
      for (let i = startLine; i < endLine; i++) {
        const text = this.data[i];
        const y = (i * this.lineHeight) - this.scrollTop;

        // 绘制文本
        this.ctx.fillStyle = '#000000';
        this.ctx.fillText(text, 10 - this.scrollLeft, y);
      }

      // 更新最大横向滚动距离（使用预计算的值）
      this.maxScrollLeft = Math.max(0, this.maxLineWidth - viewportWidth + 50);
    }

    /**
     * 滚动到指定行
     */
    scrollToLine(lineIndex) {
      if (lineIndex < 0 || lineIndex >= this.data.length) return;

      const targetScrollTop = lineIndex * this.lineHeight;
      this.scrollTop = targetScrollTop;

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
      this.clearCache();
      this.data = [];
      this.ctx = null;
      this.canvas = null;
      this.initialized = false;
    }
  }

  // 导出到全局
  window.CanvasLogRenderer = CanvasLogRenderer;

  console.log('[CanvasLogRenderer] 模块已加载');
})();
