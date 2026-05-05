/**
 * 统计计算 Worker
 * 在后台线程中计算各种统计数据
 *
 * 使用方法：
 * const worker = new Worker('./stats-calculator-worker.js');
 * worker.postMessage({ type: 'columnStats', data: {...} });
 * worker.onmessage = (e) => { ... };
 */

/**
 * 处理主线程发送的消息
 */
self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'columnStats':
      handleColumnStats(data);
      break;
    case 'lineLengthStats':
      handleLineLengthStats(data);
      break;
    case 'bookmarkStats':
      handleBookmarkStats(data);
      break;
    case 'logLevelStats':
      handleLogLevelStats(data);
      break;
    case 'frequencyStats':
      handleFrequencyStats(data);
      break;
    case 'batchInit':
      batchStatsState = {
        totalLines: data.totalLines,
        totalProcessed: 0,
        // 行长度批处理累积器
        emptyLines: 0,
        minLength: Infinity,
        maxLength: 0,
        sumLength: 0,
        distribution: { '0-50': 0, '51-100': 0, '101-200': 0, '201-500': 0, '501-1000': 0, '1000+': 0 }
      };
      self.postMessage({ type: 'statsReady' });
      break;
    case 'statsBatch':
      handleStatsBatch(data);
      break;
    case 'batchComplete':
      // 计算最终统计
      const s = batchStatsState;
      const finalStats = {
        totalLines: s.totalLines,
        emptyLines: s.emptyLines,
        minLength: s.minLength === Infinity ? 0 : s.minLength,
        maxLength: s.maxLength,
        avgLength: s.totalLines > 0 ? s.sumLength / s.totalLines : 0,
        lengthDistribution: s.distribution
      };
      self.postMessage({ type: 'statsBatchDone', data: { stats: finalStats } });
      break;
    case 'batchReady':
      // 从 manager 手动触发，等待 statsBatch 消息
      break;
    default:
      console.warn('Unknown message type:', type);
  }
};

// 分批统计累积状态
let batchStatsState = null;

/**
 * 处理统计数据批次（行长度统计）
 */
function handleStatsBatch(data) {
  const { lines, offset, batchIndex, totalBatches } = data;
  const s = batchStatsState;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      s.emptyLines++;
      continue;
    }
    const length = line.length;
    s.minLength = Math.min(s.minLength, length);
    s.maxLength = Math.max(s.maxLength, length);
    s.sumLength += length;

    if (length <= 50) s.distribution['0-50']++;
    else if (length <= 100) s.distribution['51-100']++;
    else if (length <= 200) s.distribution['101-200']++;
    else if (length <= 500) s.distribution['201-500']++;
    else if (length <= 1000) s.distribution['501-1000']++;
    else s.distribution['1000+']++;
  }

  s.totalProcessed += lines.length;
  const progress = (s.totalProcessed / s.totalLines) * 100;

  self.postMessage({
    type: 'statsBatchProgress',
    data: {
      processed: s.totalProcessed,
      total: s.totalLines,
      progress: progress
    }
  });

  // 请求下一个批次
  self.postMessage({ type: 'statsReady' });
}

/**
 * 计算列统计信息
 */
function handleColumnStats(data) {
  const { rows, columns, batchSize = 5000 } = data;
  const startTime = performance.now();

  // 初始化统计结果
  const stats = {
    totalRows: rows.length,
    totalColumns: columns || 0,
    columnStats: [],
    emptyCells: 0,
    nonEmptyCells: 0
  };

  if (rows.length === 0) {
    self.postMessage({ type: 'columnStatsResult', data: stats });
    return;
  }

  // 计算列数
  const numColumns = columns || Math.max(...rows.map(r => r ? r.length : 0));

  // 初始化每列的统计
  for (let i = 0; i < numColumns; i++) {
    stats.columnStats.push({
      columnIndex: i,
      nonEmptyCount: 0,
      emptyCount: 0,
      uniqueValues: new Set(),
      numericValues: [],
      minLength: Infinity,
      maxLength: 0,
      sumLength: 0
    });
  }

  let processedCount = 0;

  function processBatch(startIndex) {
    const endIndex = Math.min(startIndex + batchSize, rows.length);

    for (let i = startIndex; i < endIndex; i++) {
      const row = rows[i];
      if (!row) continue;

      for (let colIndex = 0; colIndex < numColumns; colIndex++) {
        const value = row[colIndex];

        if (colIndex >= row.length || value === null || value === undefined || value === '') {
          stats.columnStats[colIndex].emptyCount++;
          stats.emptyCells++;
        } else {
          const colStat = stats.columnStats[colIndex];
          colStat.nonEmptyCount++;
          stats.nonEmptyCells++;

          // 唯一值
          colStat.uniqueValues.add(String(value));

          // 数值检测
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            colStat.numericValues.push(numValue);
          }

          // 长度统计
          const len = String(value).length;
          colStat.minLength = Math.min(colStat.minLength, len);
          colStat.maxLength = Math.max(colStat.maxLength, len);
          colStat.sumLength += len;
        }
      }
    }

    processedCount = endIndex;

    // 发送进度
    const progress = (processedCount / rows.length) * 100;
    self.postMessage({
      type: 'statsProgress',
      data: {
        type: 'columnStats',
        processed: processedCount,
        total: rows.length,
        progress: progress,
        results: endIndex === rows.length ? convertStats(stats) : null
      }
    });

    if (endIndex < rows.length) {
      setTimeout(() => processBatch(endIndex), 0);
    } else {
      const elapsed = performance.now() - startTime;
      console.log(`[Stats Worker] 列统计完成: ${rows.length} 行, ${numColumns} 列, 耗时 ${elapsed.toFixed(2)}ms`);
    }
  }

  processBatch(0);
}

/**
 * 转换统计结果（将 Set 转为数组以便序列化）
 */
function convertStats(stats) {
  const result = { ...stats };
  result.columnStats = stats.columnStats.map(col => ({
    ...col,
    uniqueValues: Array.from(col.uniqueValues),
    numericValues: col.numericValues.length > 0 ? {
      min: Math.min(...col.numericValues),
      max: Math.max(...col.numericValues),
      avg: col.numericValues.reduce((a, b) => a + b, 0) / col.numericValues.length,
      count: col.numericValues.length
    } : null
  }));
  return result;
}

/**
 * 计算行长度统计
 */
function handleLineLengthStats(data) {
  const { lines, batchSize = 10000 } = data;
  const startTime = performance.now();

  const stats = {
    totalLines: lines.length,
    emptyLines: 0,
    minLength: Infinity,
    maxLength: 0,
    sumLength: 0,
    lengthDistribution: {
      '0-50': 0,
      '51-100': 0,
      '101-200': 0,
      '201-500': 0,
      '501-1000': 0,
      '1000+': 0
    }
  };

  let processedCount = 0;

  function processBatch(startIndex) {
    const endIndex = Math.min(startIndex + batchSize, lines.length);

    for (let i = startIndex; i < endIndex; i++) {
      const line = lines[i];
      if (!line) {
        stats.emptyLines++;
        continue;
      }

      const length = line.length;
      stats.minLength = Math.min(stats.minLength, length);
      stats.maxLength = Math.max(stats.maxLength, length);
      stats.sumLength += length;

      // 长度分布
      if (length <= 50) stats.lengthDistribution['0-50']++;
      else if (length <= 100) stats.lengthDistribution['51-100']++;
      else if (length <= 200) stats.lengthDistribution['101-200']++;
      else if (length <= 500) stats.lengthDistribution['201-500']++;
      else if (length <= 1000) stats.lengthDistribution['501-1000']++;
      else stats.lengthDistribution['1000+']++;
    }

    processedCount = endIndex;

    const progress = (processedCount / lines.length) * 100;
    self.postMessage({
      type: 'statsProgress',
      data: {
        type: 'lineLengthStats',
        processed: processedCount,
        total: lines.length,
        progress: progress,
        results: endIndex === lines.length ? stats : null
      }
    });

    if (endIndex < lines.length) {
      setTimeout(() => processBatch(endIndex), 0);
    } else {
      stats.avgLength = stats.sumLength / stats.totalLines;
      delete stats.sumLength;
      const elapsed = performance.now() - startTime;
      console.log(`[Stats Worker] 行长度统计完成: ${lines.length} 行, 耗时 ${elapsed.toFixed(2)}ms`);
    }
  }

  processBatch(0);
}

/**
 * 计算书签统计
 */
function handleBookmarkStats(data) {
  const { bookmarks, lines } = data;
  const startTime = performance.now();

  const stats = {
    totalBookmarks: bookmarks.length,
    filesWithBookmarks: new Set(),
    lineLengths: [],
    notesCount: 0
  };

  for (const bookmark of bookmarks) {
    if (bookmark.filePath) {
      stats.filesWithBookmarks.add(bookmark.filePath);
    }
    if (bookmark.note && bookmark.note.trim()) {
      stats.notesCount++;
    }
    if (bookmark.lineIndex !== undefined && lines[bookmark.lineIndex]) {
      stats.lineLengths.push(lines[bookmark.lineIndex].length);
    }
  }

  stats.filesWithBookmarks = stats.filesWithBookmarks.size;
  stats.avgLineLength = stats.lineLengths.length > 0
    ? stats.lineLengths.reduce((a, b) => a + b, 0) / stats.lineLengths.length
    : 0;

  delete stats.lineLengths;

  const elapsed = performance.now() - startTime;
  console.log(`[Stats Worker] 书签统计完成: ${bookmarks.length} 个书签, 耗时 ${elapsed.toFixed(2)}ms`);

  self.postMessage({
    type: 'bookmarkStatsResult',
    data: stats
  });
}

/**
 * 计算日志级别统计
 */
function handleLogLevelStats(data) {
  const { lines, patterns } = data;
  const startTime = performance.now();

  const stats = {
    totalLines: lines.length,
    levels: {},
    levelOrder: ['FATAL', 'CRITICAL', 'ERROR', 'WARN', 'WARNING', 'INFO', 'DEBUG', 'TRACE']
  };

  // 初始化各级别计数
  for (const level of stats.levelOrder) {
    stats.levels[level] = 0;
  }
  stats.levels['UNKNOWN'] = 0;

  let processedCount = 0;
  const batchSize = 10000;

  function processBatch(startIndex) {
    const endIndex = Math.min(startIndex + batchSize, lines.length);

    for (let i = startIndex; i < endIndex; i++) {
      const line = lines[i];
      if (!line) continue;

      let foundLevel = 'UNKNOWN';
      for (const level of stats.levelOrder) {
        if (patterns[level] && patterns[level].test(line)) {
          foundLevel = level;
          break;
        }
      }
      stats.levels[foundLevel]++;
    }

    processedCount = endIndex;

    const progress = (processedCount / lines.length) * 100;
    self.postMessage({
      type: 'statsProgress',
      data: {
        type: 'logLevelStats',
        processed: processedCount,
        total: lines.length,
        progress: progress,
        results: endIndex === lines.length ? stats : null
      }
    });

    if (endIndex < lines.length) {
      setTimeout(() => processBatch(endIndex), 0);
    } else {
      const elapsed = performance.now() - startTime;
      console.log(`[Stats Worker] 日志级别统计完成: ${lines.length} 行, 耗时 ${elapsed.toFixed(2)}ms`);
    }
  }

  processBatch(0);
}

/**
 * 计算词频统计
 */
function handleFrequencyStats(data) {
  const { lines, options = {} } = data;
  const {
    minLength = 2,
    maxResults = 100,
    excludePatterns = [],
    batchSize = 10000
  } = options;

  const startTime = performance.now();
  const wordCounts = new Map();

  let processedCount = 0;

  function processBatch(startIndex) {
    const endIndex = Math.min(startIndex + batchSize, lines.length);

    for (let i = startIndex; i < endIndex; i++) {
      const line = lines[i];
      if (!line) continue;

      // 提取单词（支持中文、英文、数字）
      const words = line.match(/[\u4e00-\u9fa5a-zA-Z0-9_]+/g);
      if (!words) continue;

      for (const word of words) {
        // 过滤
        if (word.length < minLength) continue;
        if (/^\d+$/.test(word)) continue; // 纯数字

        // 检查排除模式
        let excluded = false;
        for (const pattern of excludePatterns) {
          if (pattern.test(word)) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;

        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    processedCount = endIndex;

    const progress = (processedCount / lines.length) * 100;
    self.postMessage({
      type: 'statsProgress',
      data: {
        type: 'frequencyStats',
        processed: processedCount,
        total: lines.length,
        progress: progress,
        results: endIndex === lines.length ? null : null // 稍后返回完整结果
      }
    });

    if (endIndex < lines.length) {
      setTimeout(() => processBatch(endIndex), 0);
    } else {
      // 排序并返回 top N
      const sortedWords = Array.from(wordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxResults)
        .map(([word, count]) => ({ word, count }));

      const elapsed = performance.now() - startTime;
      console.log(`[Stats Worker] 词频统计完成: ${wordCounts.size} 个唯一词, 耗时 ${elapsed.toFixed(2)}ms`);

      self.postMessage({
        type: 'frequencyStatsResult',
        data: {
          totalWords: wordCounts.size,
          topWords: sortedWords
        }
      });
    }
  }

  processBatch(0);
}
