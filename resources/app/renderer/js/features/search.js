/**
 * 搜索功能模块（集成索引系统）
 * 负责日志搜索，使用增量索引优化性能
 */

// 引入索引引擎
if (typeof require === 'function') {
  const LogIndexer = require('../utils/log-indexer.js');
  window.LogIndexer = LogIndexer;
}

window.App = window.App || {};
window.App.Search = {
  // 索引器实例
  indexer: null,

  // 当前搜索状态
  currentKeyword: '',
  searchResults: [],
  currentMatchIndex: -1,

  // 是否使用索引加速
  useIndex: true,

  /**
   * 初始化搜索模块
   */
  init: function() {
    console.log('Search module initializing...');

    // 创建索引器实例
    if (window.LogIndexer) {
      this.indexer = new LogIndexer({
        batchSize: 10000,
        batchDelay: 5,
        maxCacheLines: 50000,
        enablePersistence: true,
        storagePrefix: 'logSearch_',
      });

      // 设置索引构建回调
      this.indexer.on('progress', (data) => {
        this.onIndexProgress(data);
      });

      this.indexer.on('complete', (data) => {
        this.onIndexComplete(data);
      });

      this.indexer.on('error', (error) => {
        console.error('Index error:', error);
      });

      // 尝试加载已保存的索引
      this.indexer.loadIndex().then((loaded) => {
        if (loaded) {
          console.log('✓ Search index loaded from storage');
          this.updateIndexStats();
        }
      });
    }

    console.log('✓ Search module initialized with index support');
  },

  /**
   * 为日志数据构建索引
   * @param {Array<string>} lines - 日志行数组
   * @param {boolean} forceRebuild - 是否强制重建索引
   */
  buildIndex: function(lines, forceRebuild = false) {
    if (!this.indexer || !this.useIndex) {
      console.log('Indexing disabled or indexer not available');
      return;
    }

    console.log(`Building search index for ${lines.length} lines...`);

    // 如果已存在索引且不是强制重建，检查是否需要增量更新
    if (!forceRebuild && this.indexer.state.indexedLines > 0) {
      const startIndex = this.indexer.state.totalLines;
      if (startIndex < lines.length) {
        // 增量追加新行
        const newLines = lines.slice(startIndex);
        this.indexer.appendLines(newLines, startIndex);
        console.log(`✓ Incremental index updated: +${newLines.length} lines`);
      }
      return;
    }

    // 全量重建索引
    this.indexer.buildIndex(lines).catch((error) => {
      console.error('Failed to build index:', error);
    });
  },

  /**
   * 执行搜索（使用索引）
   * @param {string} keyword - 搜索关键词
   * @param {Array<string>} lines - 日志行数组（降级使用）
   * @returns {Promise<Array<number>>} 匹配的行号数组
   */
  search: async function(keyword, lines = null) {
    const startTime = performance.now();

    if (!keyword || keyword.trim() === '') {
      this.searchResults = [];
      this.currentKeyword = '';
      this.currentMatchIndex = -1;
      return [];
    }

    this.currentKeyword = keyword;

    // 优先使用索引搜索
    if (this.indexer && this.useIndex) {
      try {
        const results = await this.indexer.search(keyword);
        this.searchResults = results;
        this.currentMatchIndex = results.length > 0 ? 0 : -1;

        const searchTime = performance.now() - startTime;
        console.log(`Indexed search: "${keyword}" found ${results.length} results in ${searchTime.toFixed(2)}ms`);

        return results;
      } catch (error) {
        console.warn('Indexed search failed, falling back to linear search:', error);
        // 降级到线性搜索
      }
    }

    // 降级：线性搜索
    if (lines) {
      return this.linearSearch(keyword, lines);
    }

    console.warn('No lines available for search');
    return [];
  },

  /**
   * 线性搜索（降级方案）
   * @param {string} keyword - 搜索关键词
   * @param {Array<string>} lines - 日志行数组
   * @returns {Array<number>} 匹配的行号数组
   */
  linearSearch: function(keyword, lines) {
    const startTime = performance.now();
    const results = [];

    try {
      // 尝试解析为正则表达式
      let regex;
      try {
        const parts = keyword.split('|');
        const escapedPattern = parts.map(part => this.escapeRegExp(part)).join('|');
        regex = new RegExp(escapedPattern, 'gi');
      } catch (e) {
        regex = new RegExp(this.escapeRegExp(keyword), 'gi');
      }

      // 遍历所有行
      for (let i = 0; i < lines.length; i++) {
        const lineContent = lines[i]; // 直接使用原始内容
        regex.lastIndex = 0;

        if (regex.test(lineContent)) {
          results.push(i);
        }
      }
    } catch (error) {
      console.error('Linear search error:', error);
    }

    this.searchResults = results;
    this.currentMatchIndex = results.length > 0 ? 0 : -1;

    const searchTime = performance.now() - startTime;
    console.log(`Linear search: "${keyword}" found ${results.length} results in ${searchTime.toFixed(2)}ms`);

    return results;
  },

  /**
   * 跳转到下一个匹配
   */
  nextMatch: function() {
    if (this.searchResults.length === 0) return -1;

    this.currentMatchIndex =
      (this.currentMatchIndex + 1) % this.searchResults.length;

    return this.searchResults[this.currentMatchIndex];
  },

  /**
   * 跳转到上一个匹配
   */
  prevMatch: function() {
    if (this.searchResults.length === 0) return -1;

    this.currentMatchIndex =
      (this.currentMatchIndex - 1 + this.searchResults.length) % this.searchResults.length;

    return this.searchResults[this.currentMatchIndex];
  },

  /**
   * 跳转到指定匹配
   */
  jumpToMatch: function(index) {
    if (index < 0 || index >= this.searchResults.length) return -1;

    this.currentMatchIndex = index;
    return this.searchResults[index];
  },

  /**
   * 获取当前匹配信息
   */
  getCurrentMatch: function() {
    if (this.searchResults.length === 0 || this.currentMatchIndex < 0) {
      return null;
    }

    return {
      index: this.currentMatchIndex,
      total: this.searchResults.length,
      lineNumber: this.searchResults[this.currentMatchIndex],
    };
  },

  /**
   * 清除搜索结果
   */
  clear: function() {
    this.currentKeyword = '';
    this.searchResults = [];
    this.currentMatchIndex = -1;
  },

  /**
   * 切换索引模式
   */
  toggleIndex: function() {
    this.useIndex = !this.useIndex;
    console.log(`Index mode: ${this.useIndex ? 'ENABLED' : 'DISABLED'}`);
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
    // 可以在这里更新UI进度条
    const { indexedLines, totalLines, progress } = data;

    // 触发自定义事件，让UI层可以监听
    const event = new CustomEvent('searchIndexProgress', {
      detail: { indexedLines, totalLines, progress },
    });
    window.dispatchEvent(event);

    // 如果有UI元素，可以更新
    if (window.searchStatus) {
      window.searchStatus.textContent = `索引构建中: ${progress.toFixed(1)}%`;
    }
  },

  /**
   * 索引构建完成回调
   */
  onIndexComplete: function(data) {
    const { totalLines, buildTime } = data;

    console.log(`✓ Search index built: ${totalLines} lines in ${buildTime.toFixed(2)}ms`);

    // 触发自定义事件
    const event = new CustomEvent('searchIndexComplete', {
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

    console.log('Search Index Stats:', {
      totalLines: stats.state.totalLines,
      indexedLines: stats.state.indexedLines,
      indexSize: stats.indexSize,
      avgSearchTime: `${stats.avgSearchTime.toFixed(2)}ms`,
      totalSearches: stats.totalSearches,
    });
  },

  /**
   * 清空索引
   */
  clearIndex: function() {
    if (this.indexer) {
      this.indexer.clear();
      console.log('✓ Search index cleared');
    }
  },

  /**
   * 工具函数：转义正则表达式特殊字符
   */
  escapeRegExp: function(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

console.log('✓ Search module loaded with index support');
