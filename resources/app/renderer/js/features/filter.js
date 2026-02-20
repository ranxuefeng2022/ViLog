/**
 * 过滤功能模块（集成索引系统）
 * 负责日志过滤，使用增量索引优化性能
 */

// 引入索引引擎
if (typeof require === 'function') {
  const LogIndexer = require('../utils/log-indexer.js');
  window.LogIndexer = LogIndexer;
}

window.App = window.App || {};
window.App.Filter = {
  // 索引器实例
  indexer: null,

  // 当前过滤状态
  currentFilter: {
    keywords: [],
    logLevels: [],
    startTime: null,
    endTime: null,
  },

  // 过滤结果
  filteredLines: [],
  filteredToOriginalIndex: [],

  // 是否使用索引加速
  useIndex: true,

  /**
   * 初始化过滤模块
   */
  init: function() {
    console.log('Filter module initializing...');

    // 创建索引器实例（与搜索模块独立，用于过滤专用索引）
    if (window.LogIndexer) {
      this.indexer = new LogIndexer({
        batchSize: 10000,
        batchDelay: 5,
        maxCacheLines: 50000,
        enablePersistence: true,
        storagePrefix: 'logFilter_',
      });

      // 设置索引构建回调
      this.indexer.on('progress', (data) => {
        this.onIndexProgress(data);
      });

      this.indexer.on('complete', (data) => {
        this.onIndexComplete(data);
      });

      this.indexer.on('error', (error) => {
        console.error('Filter index error:', error);
      });

      // 尝试加载已保存的索引
      this.indexer.loadIndex().then((loaded) => {
        if (loaded) {
          console.log('✓ Filter index loaded from storage');
          this.updateIndexStats();
        }
      });
    }

    console.log('✓ Filter module initialized with index support');
  },

  /**
   * 为日志数据构建索引
   * @param {Array<string>} lines - 日志行数组
   * @param {boolean} forceRebuild - 是否强制重建索引
   */
  buildIndex: function(lines, forceRebuild = false) {
    if (!this.indexer || !this.useIndex) {
      console.log('Filter indexing disabled or indexer not available');
      return;
    }

    console.log(`Building filter index for ${lines.length} lines...`);

    // 如果已存在索引且不是强制重建，检查是否需要增量更新
    if (!forceRebuild && this.indexer.state.indexedLines > 0) {
      const startIndex = this.indexer.state.totalLines;
      if (startIndex < lines.length) {
        // 增量追加新行
        const newLines = lines.slice(startIndex);
        this.indexer.appendLines(newLines, startIndex);
        console.log(`✓ Filter incremental index updated: +${newLines.length} lines`);
      }
      return;
    }

    // 全量重建索引
    this.indexer.buildIndex(lines).catch((error) => {
      console.error('Failed to build filter index:', error);
    });
  },

  /**
   * 应用过滤（使用索引）
   * @param {Object} filterOptions - 过滤选项
   * @param {Array<string>} lines - 日志行数组（降级使用）
   * @returns {Promise<Array<number>>} 过滤后的行号数组
   */
  applyFilter: async function(filterOptions, lines = null) {
    const startTime = performance.now();

    // 解析过滤选项
    const {
      keywords = [],
      logLevels = [],
      startTime: startT = null,
      endTime: endT = null,
    } = filterOptions;

    // 保存当前过滤状态
    this.currentFilter = {
      keywords,
      logLevels,
      startTime: startT,
      endTime: endT,
    };

    // 优先使用索引过滤
    if (this.indexer && this.useIndex) {
      try {
        // 构建过滤条件
        const conditions = {};

        if (keywords.length > 0) {
          conditions.keyword = keywords.join('|');
        }

        if (logLevels.length > 0) {
          // 多个级别用第一个进行索引查询，然后进行组合
          conditions.level = logLevels[0];
        }

        if (startT && endT) {
          conditions.startTime = startT;
          conditions.endTime = endT;
        }

        // 使用组合过滤
        let results = await this.indexer.combineFilters(conditions);

        // 如果有多个日志级别，需要额外处理
        if (logLevels.length > 1) {
          const levelResults = [];
          for (const level of logLevels) {
            const levelLines = this.indexer.filterByLevel(level);
            levelResults.push(new Set(levelLines));
          }

          // 计算并集（OR逻辑）
          const levelUnion = this._setUnion(levelResults);
          results = results.filter(line => levelUnion.has(line));
        }

        this.filteredToOriginalIndex = results;
        this.filteredLines = results.map(lineNum =>
          lines ? lines[lineNum] : `Line ${lineNum}`
        );

        const filterTime = performance.now() - startTime;
        console.log(
          `Indexed filter: found ${results.length} results in ${filterTime.toFixed(2)}ms`
        );

        return results;
      } catch (error) {
        console.warn('Indexed filter failed, falling back to linear filter:', error);
        // 降级到线性过滤
      }
    }

    // 降级：线性过滤
    if (lines) {
      return this.linearFilter(filterOptions, lines);
    }

    console.warn('No lines available for filter');
    return [];
  },

  /**
   * 线性过滤（降级方案）
   * @param {Object} filterOptions - 过滤选项
   * @param {Array<string>} lines - 日志行数组
   * @returns {Array<number>} 过滤后的行号数组
   */
  linearFilter: function(filterOptions, lines) {
    const startTime = performance.now();
    const results = [];

    const { keywords, logLevels, startTime: startT, endTime: endT } = filterOptions;

    // 遍历所有行
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]; // 直接使用原始内容
      let matches = true;

      // 检查关键词
      if (keywords && keywords.length > 0) {
        const keywordMatches = keywords.some(keyword => {
          try {
            const regex = new RegExp(keyword, 'i');
            return regex.test(line);
          } catch (e) {
            return line.toLowerCase().includes(keyword.toLowerCase());
          }
        });

        if (!keywordMatches) {
          matches = false;
        }
      }

      // 检查日志级别
      if (matches && logLevels && logLevels.length > 0) {
        const levelMatch = line.match(/\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL)\b/i);
        if (levelMatch) {
          const level = levelMatch[1].toUpperCase();
          if (!logLevels.includes(level)) {
            matches = false;
          }
        } else {
          matches = false;
        }
      }

      // 检查时间范围
      if (matches && startT && endT) {
        const timeMatch = line.match(/\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})\b/);
        if (timeMatch) {
          const timestamp = timeMatch[1];
          if (timestamp < startT || timestamp > endT) {
            matches = false;
          }
        } else {
          matches = false;
        }
      }

      if (matches) {
        results.push(i);
      }
    }

    this.filteredToOriginalIndex = results;
    this.filteredLines = results.map(lineNum => lines[lineNum]);

    const filterTime = performance.now() - startTime;
    console.log(
      `Linear filter: found ${results.length} results in ${filterTime.toFixed(2)}ms`
    );

    return results;
  },

  /**
   * 按日志级别快速过滤
   * @param {string} level - 日志级别
   * @returns {Array<number>} 行号数组
   */
  filterByLevel: function(level) {
    if (!this.indexer) {
      console.warn('Indexer not available');
      return [];
    }

    return this.indexer.filterByLevel(level);
  },

  /**
   * 按时间范围快速过滤
   * @param {string} startTime - 开始时间
   * @param {string} endTime - 结束时间
   * @returns {Array<number>} 行号数组
   */
  filterByTimeRange: function(startTime, endTime) {
    if (!this.indexer) {
      console.warn('Indexer not available');
      return [];
    }

    return this.indexer.filterByTimeRange(startTime, endTime);
  },

  /**
   * 获取过滤结果统计
   */
  getFilterStats: function() {
    return {
      total: this.filteredToOriginalIndex.length,
      keywords: this.currentFilter.keywords,
      logLevels: this.currentFilter.logLevels,
      timeRange: {
        start: this.currentFilter.startTime,
        end: this.currentFilter.endTime,
      },
    };
  },

  /**
   * 清除过滤结果
   */
  clear: function() {
    this.currentFilter = {
      keywords: [],
      logLevels: [],
      startTime: null,
      endTime: null,
    };
    this.filteredLines = [];
    this.filteredToOriginalIndex = [];
  },

  /**
   * 切换索引模式
   */
  toggleIndex: function() {
    this.useIndex = !this.useIndex;
    console.log(`Filter index mode: ${this.useIndex ? 'ENABLED' : 'DISABLED'}`);
    return this.useIndex;
  },

  /**
   * 获取索引统计信息
   */
  getIndexStats: function() {
    if (!this.indexer) return null;

    return this.indexer.getStats();
  },

  /**
   * 索引构建进度回调
   */
  onIndexProgress: function(data) {
    const { indexedLines, totalLines, progress } = data;

    // 触发自定义事件
    const event = new CustomEvent('filterIndexProgress', {
      detail: { indexedLines, totalLines, progress },
    });
    window.dispatchEvent(event);

    // 如果有UI元素，可以更新
    if (window.filterStatus) {
      window.filterStatus.textContent = `索引构建中: ${progress.toFixed(1)}%`;
    }
  },

  /**
   * 索引构建完成回调
   */
  onIndexComplete: function(data) {
    const { totalLines, buildTime } = data;

    console.log(
      `✓ Filter index built: ${totalLines} lines in ${buildTime.toFixed(2)}ms`
    );

    // 触发自定义事件
    const event = new CustomEvent('filterIndexComplete', {
      detail: { totalLines, buildTime },
    });
    window.dispatchEvent(event);

    // 更新统计信息
    this.updateIndexStats();
  },

  /**
   * 更新索引统计信息
   */
  updateIndexStats: function() {
    const stats = this.getIndexStats();

    if (!stats) return;

    console.log('Filter Index Stats:', {
      totalLines: stats.state.totalLines,
      indexedLines: stats.state.indexedLines,
      indexSize: stats.indexSize,
      avgFilterTime: `${stats.avgFilterTime.toFixed(2)}ms`,
      totalFilters: stats.totalFilters,
    });
  },

  /**
   * 清空索引
   */
  clearIndex: function() {
    if (this.indexer) {
      this.indexer.clear();
      console.log('✓ Filter index cleared');
    }
  },

  /**
   * 集合并集计算（用于多日志级别OR逻辑）
   * @private
   */
  _setUnion(sets) {
    const union = new Set();

    for (const set of sets) {
      for (const item of set) {
        union.add(item);
      }
    }

    return union;
  },

  /**
   * 工具函数：反转义HTML
   */
  unescapeHtml: function(text) {
    const div = document.createElement('div');
    div.innerHTML = text;
    return div.textContent || div.innerText || '';
  },
};

console.log('✓ Filter module loaded with index support');
