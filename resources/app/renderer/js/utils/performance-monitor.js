/**
 * 性能监控模块
 * 追踪 FPS、内存使用、渲染性能等指标
 */

(function() {
  'use strict';

  // 性能指标收集器
  const PerfMonitor = {
    // 状态
    isRunning: false,
    frameCount: 0,
    lastFpsUpdate: 0,
    currentFps: 0,
    fpsHistory: [],
    memoryHistory: [],
    renderHistory: [],

    // 配置
    config: {
      fpsHistorySize: 60,      // FPS 历史记录数量
      memoryHistorySize: 30,   // 内存历史记录数量
      updateInterval: 1000,    // 更新间隔（毫秒）
      logEnabled: false        // 是否输出日志
    },

    /**
     * 启动监控
     */
    start: function() {
      if (this.isRunning) return;

      this.isRunning = true;
      this.frameCount = 0;
      this.lastFpsUpdate = performance.now();
      this.fpsHistory = [];
      this.memoryHistory = [];
      this.renderHistory = [];

      this.log('[PerfMonitor] 启动性能监控');

      // 开始帧率测量循环
      this rafLoop();

      // 定期更新统计
      this.statsInterval = setInterval(() => {
        this.updateStats();
      }, this.config.updateInterval);
    },

    /**
     * 停止监控
     */
    stop: function() {
      if (!this.isRunning) return;

      this.isRunning = false;
      clearInterval(this.statsInterval);

      this.log('[PerfMonitor] 停止性能监控');
    },

    /**
     * 帧循环
     */
    rafLoop: function() {
      if (!this.isRunning) return;

      this.frameCount++;
      requestAnimationFrame(() => this.rafLoop());
    },

    /**
     * 更新统计信息
     */
    updateStats: function() {
      const now = performance.now();
      const elapsed = now - this.lastFpsUpdate;

      // 计算 FPS
      this.currentFps = Math.round((this.frameCount * 1000) / elapsed);
      this.fpsHistory.push({ time: now, fps: this.currentFps });

      // 保持历史记录在限制内
      if (this.fpsHistory.length > this.config.fpsHistorySize) {
        this.fpsHistory.shift();
      }

      // 记录内存使用
      if (performance.memory) {
        const memInfo = {
          time: now,
          used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
          total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
          limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
        };
        this.memoryHistory.push(memInfo);

        if (this.memoryHistory.length > this.config.memoryHistorySize) {
          this.memoryHistory.shift();
        }
      }

      // 重置计数
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    },

    /**
     * 记录渲染事件
     * @param {string} eventName 事件名称
     * @param {number} duration 耗时（毫秒）
     * @param {Object} metadata 元数据
     */
    recordRender: function(eventName, duration, metadata = {}) {
      this.renderHistory.push({
        time: performance.now(),
        name: eventName,
        duration,
        metadata
      });

      // 只保留最近 50 条记录
      if (this.renderHistory.length > 50) {
        this.renderHistory.shift();
      }

      // 日志输出
      if (this.config.logEnabled && duration > 16) {
        console.warn(`[Render] ${eventName}: ${duration.toFixed(1)}ms`, metadata);
      }
    },

    /**
     * 获取当前状态
     * @returns {Object}
     */
    getStats: function() {
      return {
        fps: this.currentFps,
        fpsHistory: this.fpsHistory.slice(-10),
        memory: this.getMemoryInfo(),
        renderHistory: this.renderHistory.slice(-10)
      };
    },

    /**
     * 获取内存信息
     * @returns {Object|null}
     */
    getMemoryInfo: function() {
      if (!performance.memory) {
        return null;
      }

      const mem = performance.memory;
      return {
        used: Math.round(mem.usedJSHeapSize / 1024 / 1024),
        total: Math.round(mem.totalJSHeapSize / 1024 / 1024),
        limit: Math.round(mem.jsHeapSizeLimit / 1024 / 1024),
        usagePercent: Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100)
      };
    },

    /**
     * 获取 FPS 历史
     * @returns {Array}
     */
    getFpsHistory: function() {
      return this.fpsHistory.map(h => h.fps);
    },

    /**
     * 获取平均 FPS
     * @returns {number}
     */
    getAverageFps: function() {
      if (this.fpsHistory.length === 0) return 0;

      const sum = this.fpsHistory.reduce((acc, h) => acc + h.fps, 0);
      return Math.round(sum / this.fpsHistory.length);
    },

    /**
     * 获取内存趋势
     * @returns {Array}
     */
    getMemoryTrend: function() {
      return this.memoryHistory.map(h => h.used);
    },

    /**
     * 获取慢渲染事件列表
     * @param {number} threshold 阈值（毫秒）
     * @returns {Array}
     */
    getSlowRenders: function(threshold = 32) {
      return this.renderHistory.filter(r => r.duration > threshold);
    },

    /**
     * 检测性能问题
     * @returns {Array} 问题列表
     */
    detectIssues: function() {
      const issues = [];

      // 低 FPS
      if (this.currentFps < 30 && this.currentFps > 0) {
        issues.push({
          type: 'low_fps',
          severity: 'warning',
          message: `FPS 过低: ${this.currentFps}`,
          suggestion: '考虑减少渲染的 DOM 元素数量'
        });
      }

      // 内存使用过高
      const mem = this.getMemoryInfo();
      if (mem && mem.usagePercent > 80) {
        issues.push({
          type: 'high_memory',
          severity: 'warning',
          message: `内存使用过高: ${mem.usagePercent}%`,
          suggestion: '考虑清理缓存或刷新数据'
        });
      }

      // 最近的慢渲染
      const slowRenders = this.getSlowRenders(50);
      if (slowRenders.length > 5) {
        issues.push({
          type: 'slow_renders',
          severity: 'info',
          message: `最近有 ${slowRenders.length} 次慢渲染`,
          suggestion: '检查渲染逻辑，考虑使用增量渲染'
        });
      }

      return issues;
    },

    /**
     * 生成性能报告
     * @returns {string}
     */
    generateReport: function() {
      const mem = this.getMemoryInfo();
      const avgFps = this.getAverageFps();

      let report = '=== 性能报告 ===\n';
      report += `当前 FPS: ${this.currentFps}\n`;
      report += `平均 FPS: ${avgFps}\n`;

      if (mem) {
        report += `内存使用: ${mem.used}MB / ${mem.limit}MB (${mem.usagePercent}%)\n`;
      }

      report += `渲染事件: ${this.renderHistory.length}\n`;

      const issues = this.detectIssues();
      if (issues.length > 0) {
        report += '\n检测到的问题:\n';
        issues.forEach(i => {
          report += `  [${i.severity}] ${i.message}\n`;
          report += `    建议: ${i.suggestion}\n`;
        });
      }

      return report;
    },

    /**
     * 打印性能报告到控制台
     */
    printReport: function() {
      console.log(this.generateReport());
    },

    /**
     * 输出日志
     */
    log: function(...args) {
      if (this.config.logEnabled) {
        console.log(...args);
      }
    },

    /**
     * 更新配置
     */
    configure: function(options) {
      Object.assign(this.config, options);
    },

    /**
     * 导出数据（用于调试）
     */
    export: function() {
      return {
        stats: this.getStats(),
        fpsHistory: this.fpsHistory,
        memoryHistory: this.memoryHistory,
        renderHistory: this.renderHistory,
        issues: this.detectIssues()
      };
    },

    /**
     * 重置所有数据
     */
    reset: function() {
      this.fpsHistory = [];
      this.memoryHistory = [];
      this.renderHistory = [];
      this.frameCount = 0;
      this.lastFpsUpdate = performance.now();
    }
  };

  // 创建便捷的 FPS 计数器
  PerfMonitor.FPSCounter = (function() {
    let frames = 0;
    let lastTime = performance.now();
    let fps = 0;

    function update() {
      frames++;
      const now = performance.now();

      if (now - lastTime >= 1000) {
        fps = frames;
        frames = 0;
        lastTime = now;
      }

      requestAnimationFrame(update);
    }

    update();

    return {
      get: () => fps,
      reset: () => {
        frames = 0;
        lastTime = performance.now();
      }
    };
  })();

  // 导出到全局
  window.App = window.App || {};
  window.App.PerfMonitor = PerfMonitor;

  // 自动启动监控（在开发模式下）
  if (window.location.search.includes('debug=1')) {
    PerfMonitor.configure({ logEnabled: true });
    PerfMonitor.start();
  }

  console.log('✓ Performance Monitor module loaded');
})();
