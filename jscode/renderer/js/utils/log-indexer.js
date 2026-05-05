/**
 * 增量索引系统 - 核心引擎
 * 用于优化日志搜索和过滤性能
 *
 * 特性：
 * - 多种索引类型（全文、关键词、日志级别、时间范围）
 * - 增量构建，不阻塞UI
 * - 索引合并与更新
 * - 内存优化（Uint32Array）
 * - 持久化存储
 */

class LogIndexer {
  constructor(options = {}) {
    this.options = {
      // 每批处理的行数
      batchSize: options.batchSize || 10000,
      // 每批之间的延迟（毫秒），避免阻塞UI
      batchDelay: options.batchDelay || 5,
      // 内存中缓存的最大行数
      maxCacheLines: options.maxCacheLines || 50000,
      // 是否启用持久化
      enablePersistence: options.enablePersistence !== false,
      // 索引存储键前缀
      storagePrefix: options.storagePrefix || 'logIndex_',
    };

    // 索引数据结构
    this.indices = {
      // 全文倒排索引：word -> Set(lineNumbers)
      fullText: new Map(),
      // 关键词索引：keyword -> Uint32Array(lineNumbers)
      keywords: new Map(),
      // 日志级别索引：level -> Uint32Array (固定数组，内存仅为普通数组的 ~1/4)
      logLevels: new Map(),
      // 时间范围索引：timestamp -> {start, end}
      timeRanges: [],
      // 行内容缓存（用于快速访问）
      lineCache: new Map(),
    };

    // 构建阶段使用的临时数组，完成后转为 Uint32Array
    this._logLevelBuilders = new Map();
    this._fullTextBuilders = new Map();

    // 构建状态
    this.state = {
      totalLines: 0,
      indexedLines: 0,
      isBuilding: false,
      buildProgress: 0,
      lastBuildTime: 0,
    };

    // 回调函数
    this.callbacks = {
      onProgress: null,
      onComplete: null,
      onError: null,
    };

    // 性能统计
    this.stats = {
      totalSearches: 0,
      totalFilters: 0,
      avgSearchTime: 0,
      avgFilterTime: 0,
    };
  }

  /**
   * 设置回调函数
   */
  on(event, callback) {
    if (event in this.callbacks) {
      this.callbacks[event] = callback;
    }
  }

  /**
   * 开始增量构建索引
   * @param {Array<string>} lines - 日志行数组
   * @param {number} startLine - 起始行号
   * @returns {Promise<void>}
   */
  async buildIndex(lines, startLine = 0) {
    if (this.state.isBuilding) {
      throw new Error('Index building already in progress');
    }

    const startTime = performance.now();
    this.state.isBuilding = true;
    this.state.totalLines = lines.length;
    this.state.indexedLines = 0;

    // 保存原始数据引用，用于子串搜索的全面扫描
    this._allLines = lines;

    try {
      // 分批处理，避免阻塞UI
      for (let i = 0; i < lines.length; i += this.options.batchSize) {
        const batch = lines.slice(i, Math.min(i + this.options.batchSize, lines.length));
        const startLineNumber = startLine + i;

        // 处理这批数据
        await this._processBatch(batch, startLineNumber);

        // 更新进度
        this.state.indexedLines = Math.min(i + this.options.batchSize, lines.length);
        this.state.buildProgress = (this.state.indexedLines / lines.length) * 100;

        // 触发进度回调
        if (this.callbacks.onProgress) {
          this.callbacks.onProgress({
            indexedLines: this.state.indexedLines,
            totalLines: this.state.totalLines,
            progress: this.state.buildProgress,
          });
        }

        // 让出CPU，避免阻塞UI
        if (i + this.options.batchSize < lines.length) {
          await this._sleep(this.options.batchDelay);
        }
      }

      // 构建完成
      this.state.isBuilding = false;
      this.state.lastBuildTime = performance.now() - startTime;

      // 冻结日志级别索引为 Uint32Array（内存减少 ~75%）
      this._finalizeLogLevels();

      // 冻结全文索引为 Uint32Array（内存减少 ~75%）
      this._finalizeFullText();

      // 触发完成回调
      if (this.callbacks.onComplete) {
        this.callbacks.onComplete({
          totalLines: this.state.totalLines,
          buildTime: this.state.lastBuildTime,
        });
      }

      // 持久化索引
      if (this.options.enablePersistence) {
        await this._persistIndex();
      }

      console.log(`✓ Index built in ${this.state.lastBuildTime.toFixed(2)}ms`);
    } catch (error) {
      this.state.isBuilding = false;
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
      throw error;
    }
  }

  /**
   * 增量追加新行到索引
   * @param {Array<string>} newLines - 新增的日志行
   * @param {number} startLine - 起始行号
   */
  async appendLines(newLines, startLine) {
    await this._processBatch(newLines, startLine);
    this.state.totalLines += newLines.length;

    // 增量追加后重新冻结
    this._finalizeLogLevels();
    this._finalizeFullText();

    if (this.options.enablePersistence) {
      await this._persistIndex();
    }
  }

  /**
   * 处理一批日志行
   * @private
   */
  async _processBatch(batch, startLineNumber) {
    for (let i = 0; i < batch.length; i++) {
      const lineNumber = startLineNumber + i;
      const line = batch[i];

      // 跳过空行
      if (!line || line.trim() === '') {
        continue;
      }

      // 1. 构建全文索引（按单词分词）
      this._indexFullText(line, lineNumber);

      // 2. 构建日志级别索引
      this._indexLogLevel(line, lineNumber);

      // 3. 构建时间范围索引
      this._indexTimeRange(line, lineNumber);

      // 4. 缓存行内容（LRU策略）
      this._cacheLine(lineNumber, line);
    }
  }

  /**
   * 全文索引：按单词分词
   * @private
   */
  _indexFullText(line, lineNumber) {
    // 提取单词（支持中英文、数字、常见符号）
    const words = line.match(/[\u4e00-\u9fa5a-zA-Z0-9_]+/g) || [];

    for (const word of words) {
      // 只索引有意义的词（长度>1且不是纯数字）
      if (word.length > 1 && !/^\d+$/.test(word)) {
        const lowerWord = word.toLowerCase();

        if (!this._fullTextBuilders.has(lowerWord)) {
          this._fullTextBuilders.set(lowerWord, []);
        }

        this._fullTextBuilders.get(lowerWord).push(lineNumber);
      }
    }
  }

  /**
   * 日志级别索引：构建阶段使用可变数组，完成后转为 Uint32Array
   * @private
   */
  _indexLogLevel(line, lineNumber) {
    const levelMatch = line.match(/\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL)\b/i);

    if (levelMatch) {
      const level = levelMatch[1].toUpperCase();

      if (!this._logLevelBuilders.has(level)) {
        this._logLevelBuilders.set(level, []);
      }

      this._logLevelBuilders.get(level).push(lineNumber);
    }
  }

  /**
   * 将日志级别构建数组转为 Uint32Array（冻结索引）
   * 内存在转换后减少约 75%
   * @private
   */
  _finalizeLogLevels() {
    for (const [level, arr] of this._logLevelBuilders.entries()) {
      this.indices.logLevels.set(level, new Uint32Array(arr));
    }
    this._logLevelBuilders.clear();
  }

  /**
   * 将全文索引构建数组转为 Uint32Array（冻结索引）
   * 内存在转换后减少约 75%（Set → Uint32Array）
   * @private
   */
  _finalizeFullText() {
    for (const [word, arr] of this._fullTextBuilders.entries()) {
      // 排序去重后转为 Uint32Array
      arr.sort((a, b) => a - b);
      const deduped = [];
      for (let i = 0; i < arr.length; i++) {
        if (i === 0 || arr[i] !== arr[i - 1]) {
          deduped.push(arr[i]);
        }
      }
      this.indices.fullText.set(word, new Uint32Array(deduped));
    }
    this._fullTextBuilders.clear();
  }

  /**
   * 时间范围索引
   * @private
   */
  _indexTimeRange(line, lineNumber) {
    // 匹配常见时间格式
    const timeMatch = line.match(/\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})\b/);

    if (timeMatch) {
      const timestamp = timeMatch[1];

      this.indices.timeRanges.push({
        timestamp,
        lineNumber,
      });
    }
  }

  /**
   * 缓存行内容（LRU策略）
   * @private
   */
  _cacheLine(lineNumber, line) {
    // 如果缓存已满，删除最早的缓存
    if (this.indices.lineCache.size >= this.options.maxCacheLines) {
      const firstKey = this.indices.lineCache.keys().next().value;
      this.indices.lineCache.delete(firstKey);
    }

    this.indices.lineCache.set(lineNumber, line);
  }

  /**
   * 搜索关键词（使用索引）
   * @param {string} keyword - 搜索关键词
   * @returns {Promise<Array<number>>} 匹配的行号数组
   */
  async search(keyword) {
    const startTime = performance.now();

    if (!keyword || keyword.trim() === '') {
      return [];
    }

    // 多关键词支持（用 | 分隔）
    const keywords = keyword.split('|').map(k => k.trim().toLowerCase()).filter(k => k);
    const resultSet = new Set();

    for (const kw of keywords) {
      // 1. 从全文索引中查找
      const wordMatches = this._searchFullText(kw);
      wordMatches.forEach(line => resultSet.add(line));

      // 2. 如果没有找到，尝试子串匹配
      if (wordMatches.size === 0) {
        const subMatches = await this._searchSubstring(kw);
        subMatches.forEach(line => resultSet.add(line));
      }
    }

    const results = Array.from(resultSet).sort((a, b) => a - b);

    // 更新统计
    const searchTime = performance.now() - startTime;
    this.stats.totalSearches++;
    this.stats.avgSearchTime =
      (this.stats.avgSearchTime * (this.stats.totalSearches - 1) + searchTime) /
      this.stats.totalSearches;

    console.log(`Search "${keyword}" found ${results.length} results in ${searchTime.toFixed(2)}ms`);

    return results;
  }

  /**
   * 从全文索引中搜索单词
   * @private
   */
  _searchFullText(word) {
    const results = new Set();

    // 精确匹配
    if (this.indices.fullText.has(word)) {
      const arr = this.indices.fullText.get(word);
      for (let i = 0; i < arr.length; i++) {
        results.add(arr[i]);
      }
    }

    // 前缀匹配（例如：搜 "err" 可以匹配 "error"）
    for (const [indexedWord, arr] of this.indices.fullText.entries()) {
      if (indexedWord.startsWith(word) || word.startsWith(indexedWord)) {
        for (let i = 0; i < arr.length; i++) {
          results.add(arr[i]);
        }
      }
    }

    return results;
  }

  /**
   * 子串搜索（降级方案）
   * @private
   */
  async _searchSubstring(substring) {
    const results = [];

    // 从 cache 中搜索（如果命中的话）
    for (const [lineNumber, line] of this.indices.lineCache.entries()) {
      if (line.toLowerCase().includes(substring)) {
        results.push(lineNumber);
      }
    }

    // 如果 cache 未覆盖全部，继续从全量数据中搜索
    if (this._allLines && this._allLines.length > this.indices.lineCache.size) {
      const cachedSet = new Set(results);
      for (let i = 0; i < this._allLines.length; i++) {
        if (cachedSet.has(i)) continue;
        const line = this._allLines[i];
        if (line && line.toLowerCase().includes(substring)) {
          results.push(i);
        }
      }
    }

    return results;
  }

  /**
   * 按日志级别过滤
   * @param {string} level - 日志级别
   * @returns {Array<number>} 行号数组
   */
  filterByLevel(level) {
    const startTime = performance.now();

    const upperLevel = level.toUpperCase();
    const results = this.indices.logLevels.get(upperLevel) || new Uint32Array(0);

    const filterTime = performance.now() - startTime;
    this.stats.totalFilters++;
    this.stats.avgFilterTime =
      (this.stats.avgFilterTime * (this.stats.totalFilters - 1) + filterTime) /
      this.stats.totalFilters;

    console.log(`Filter by level "${level}" found ${results.length} results in ${filterTime.toFixed(2)}ms`);

    return results;
  }

  /**
   * 按时间范围过滤
   * @param {string} startTime - 开始时间
   * @param {string} endTime - 结束时间
   * @returns {Array<number>} 行号数组
   */
  filterByTimeRange(startTime, endTime) {
    const results = [];

    for (const range of this.indices.timeRanges) {
      if (range.timestamp >= startTime && range.timestamp <= endTime) {
        results.push(range.lineNumber);
      }
    }

    return results.sort((a, b) => a - b);
  }

  /**
   * 组合过滤（多条件AND）
   * @param {Object} conditions - 过滤条件
   * @returns {Promise<Array<number>>} 行号数组
   */
  async combineFilters(conditions) {
    const resultSets = [];

    // 1. 关键词搜索
    if (conditions.keyword) {
      const keywordResults = await this.search(conditions.keyword);
      resultSets.push(new Set(keywordResults));
    }

    // 2. 日志级别过滤
    if (conditions.level) {
      const levelResults = this.filterByLevel(conditions.level);
      resultSets.push(new Set(levelResults));
    }

    // 3. 时间范围过滤
    if (conditions.startTime && conditions.endTime) {
      const timeResults = this.filterByTimeRange(conditions.startTime, conditions.endTime);
      resultSets.push(new Set(timeResults));
    }

    // 如果没有条件，返回空数组
    if (resultSets.length === 0) {
      return [];
    }

    // 计算交集（AND逻辑）
    let intersection = resultSets[0];
    for (let i = 1; i < resultSets.length; i++) {
      intersection = this._setIntersection(intersection, resultSets[i]);
    }

    return Array.from(intersection).sort((a, b) => a - b);
  }

  /**
   * 集合交集计算
   * @private
   */
  _setIntersection(setA, setB) {
    const intersection = new Set();

    for (const item of setA) {
      if (setB.has(item)) {
        intersection.add(item);
      }
    }

    return intersection;
  }

  /**
   * 清空索引
   */
  clear() {
    this.indices.fullText.clear();
    this.indices.keywords.clear();
    this.indices.logLevels.clear();
    this._logLevelBuilders.clear();
    this._fullTextBuilders.clear();
    this.indices.timeRanges = [];
    this.indices.lineCache.clear();
    this._allLines = null;

    this.state = {
      totalLines: 0,
      indexedLines: 0,
      isBuilding: false,
      buildProgress: 0,
      lastBuildTime: 0,
    };
  }

  /**
   * 获取索引统计信息
   */
  getStats() {
    return {
      ...this.stats,
      state: { ...this.state },
      indexSize: {
        fullText: this.indices.fullText.size,
        keywords: this.indices.keywords.size,
        logLevels: this.indices.logLevels.size,
        timeRanges: this.indices.timeRanges.length,
        cachedLines: this.indices.lineCache.size,
      },
    };
  }

  /**
   * 获取或创建 IndexedDB 存储实例
   * 使用 IndexedDB 替代 localStorage，突破 5-10MB 限制
   * @returns {Promise<IDBObjectStore>}
   * @private
   */
  async _getIDBStore() {
    if (this._idbStore) return this._idbStore;
    const dbName = 'logIndexerDB';
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('indexes')) {
          db.createObjectStore('indexes');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        this._idbStore = db.transaction('indexes', 'readwrite').objectStore('indexes');
        resolve(this._idbStore);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 持久化索引到 IndexedDB（含 localStorage 作为 fallback）
   * @private
   */
  async _persistIndex() {
    try {
      // 序列化索引数据
      const serialized = {
        fullText: Array.from(this.indices.fullText.entries()).map(([word, arr]) => [
          word,
          Array.from(arr),
        ]),
        logLevels: Array.from(this.indices.logLevels.entries()).map(([level, arr]) => [
          level,
          Array.from(arr),
        ]),
        timeRanges: this.indices.timeRanges,
        totalLines: this.state.totalLines,
        buildTime: this.state.lastBuildTime,
      };

      const key = this.options.storagePrefix + 'current';

      // 尝试 IndexedDB 写入
      try {
        const store = await this._getIDBStore();
        await new Promise((resolve, reject) => {
          const req = store.put(serialized, key);
          req.onsuccess = resolve;
          req.onerror = reject;
        });
        console.log('✓ Index persisted to IndexedDB');
      } catch (idbError) {
        // IndexedDB 不可用时降级到 localStorage
        console.warn('IndexedDB write failed, falling back to localStorage:', idbError);
        localStorage.setItem(key, JSON.stringify(serialized));
        console.log('✓ Index persisted to localStorage (fallback)');
      }
    } catch (error) {
      console.warn('Failed to persist index:', error);
    }
  }

  /**
   * 从存储中加载索引
   */
  async loadIndex() {
    const key = this.options.storagePrefix + 'current';

    try {
      // 优先从 IndexedDB 读取
      const store = await this._getIDBStore();
      const data = await new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = reject;
      });
      if (data) {
        this._deserializeIndex(data);
        console.log('✓ Index loaded from IndexedDB');
        return true;
      }
    } catch (idbError) {
      console.warn('IndexedDB read failed:', idbError);
    }

    // 降级：尝试从 localStorage 读取并自动迁移
    try {
      const legacyData = localStorage.getItem(key);
      if (legacyData) {
        const serialized = JSON.parse(legacyData);
        this._deserializeIndex(serialized);
        // 自动迁移到 IndexedDB
        try {
          const store = await this._getIDBStore();
          await new Promise((resolve, reject) => {
            const req = store.put(serialized, key);
            req.onsuccess = resolve;
            req.onerror = reject;
          });
          localStorage.removeItem(key);
          console.log('✓ Index migrated from localStorage to IndexedDB');
        } catch (migrateError) {
          // 迁移失败不影响使用，下次仍会尝试
        }
        console.log('✓ Index loaded from localStorage (legacy)');
        return true;
      }
    } catch (error) {
      console.warn('Failed to load index from localStorage:', error);
    }

    return false;
  }

  /**
   * 从序列化数据反序列化索引
   * @private
   */
  _deserializeIndex(serialized) {
    this.indices.fullText = new Map(
      serialized.fullText.map(([word, lines]) => [word, new Uint32Array(lines)])
    );
    this.indices.logLevels = new Map(
      serialized.logLevels.map(([level, arr]) => [level, new Uint32Array(arr)])
    );
    this.indices.timeRanges = serialized.timeRanges;
    this.state.totalLines = serialized.totalLines;
    this.state.indexedLines = serialized.totalLines;
    this.state.lastBuildTime = serialized.buildTime || 0;
  }

  /**
   * 延迟函数
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LogIndexer;
}
