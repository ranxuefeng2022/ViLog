/**
 * Worker线程索引构建器
 * 用于在后台线程中构建索引，避免阻塞主线程
 *
 * 使用方法：
 * const worker = new Worker('./index-builder-worker.js');
 * worker.postMessage({ type: 'build', lines: [...], startLine: 0 });
 * worker.onmessage = (e) => { ... };
 */

// 索引数据结构（在Worker线程中）
let indices = {
  fullText: new Map(),
  logLevels: new Map(),
  timeRanges: [],
};

// 状态追踪
let state = {
  totalLines: 0,
  indexedLines: 0,
  startTime: 0,
};

/**
 * 处理主线程发送的消息
 */
self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'build':
      handleBuild(data);
      break;

    case 'append':
      handleAppend(data);
      break;

    case 'getStats':
      handleGetStats();
      break;

    case 'clear':
      handleClear();
      break;

    case 'export':
      handleExport();
      break;

    default:
      console.warn('Unknown message type:', type);
  }
};

/**
 * 处理构建索引请求
 */
function handleBuild(data) {
  const { lines, startLine = 0, batchSize = 10000 } = data;

  state.totalLines = lines.length;
  state.indexedLines = 0;
  state.startTime = performance.now();

  // 重置索引
  indices = {
    fullText: new Map(),
    logLevels: new Map(),
    timeRanges: [],
  };

  // 分批处理
  processBatch(lines, startLine, batchSize);
}

/**
 * 递归处理批次（避免阻塞）
 */
function processBatch(lines, startLine, batchSize) {
  const totalLines = lines.length;
  let currentIndex = 0;

  function processChunk() {
    const endIndex = Math.min(currentIndex + batchSize, totalLines);
    const batch = lines.slice(currentIndex, endIndex);
    const batchStartLine = startLine + currentIndex;

    // 处理这批数据
    for (let i = 0; i < batch.length; i++) {
      const lineNumber = batchStartLine + i;
      const line = batch[i];

      if (line && line.trim() !== '') {
        indexLine(line, lineNumber);
      }
    }

    // 更新进度
    state.indexedLines = endIndex;
    const progress = (state.indexedLines / totalLines) * 100;

    // 发送进度更新
    self.postMessage({
      type: 'progress',
      data: {
        indexedLines: state.indexedLines,
        totalLines: state.totalLines,
        progress: progress,
      },
    });

    // 继续处理下一批或完成
    currentIndex = endIndex;

    if (currentIndex < totalLines) {
      // 使用 setTimeout 让出CPU，避免阻塞
      setTimeout(processChunk, 0);
    } else {
      // 构建完成
      const buildTime = performance.now() - state.startTime;

      self.postMessage({
        type: 'complete',
        data: {
          totalLines: state.totalLines,
          buildTime: buildTime,
        },
      });
    }
  }

  processChunk();
}

/**
 * 处理追加行请求
 */
function handleAppend(data) {
  const { lines, startLine } = data;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = startLine + i;
    const line = lines[i];

    if (line && line.trim() !== '') {
      indexLine(line, lineNumber);
    }
  }

  state.totalLines += lines.length;

  self.postMessage({
    type: 'appendComplete',
    data: {
      appendedLines: lines.length,
      totalLines: state.totalLines,
    },
  });
}

/**
 * 索引单行
 */
function indexLine(line, lineNumber) {
  // 1. 全文索引
  indexFullText(line, lineNumber);

  // 2. 日志级别索引
  indexLogLevel(line, lineNumber);

  // 3. 时间范围索引
  indexTimeRange(line, lineNumber);
}

/**
 * 全文索引
 */
function indexFullText(line, lineNumber) {
  const words = line.match(/[\u4e00-\u9fa5a-zA-Z0-9_]+/g) || [];

  for (const word of words) {
    if (word.length > 1 && !/^\d+$/.test(word)) {
      const lowerWord = word.toLowerCase();

      if (!indices.fullText.has(lowerWord)) {
        indices.fullText.set(lowerWord, []);
      }

      indices.fullText.get(lowerWord).push(lineNumber);
    }
  }
}

/**
 * 日志级别索引
 */
function indexLogLevel(line, lineNumber) {
  const levelMatch = line.match(/\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL)\b/i);

  if (levelMatch) {
    const level = levelMatch[1].toUpperCase();

    if (!indices.logLevels.has(level)) {
      indices.logLevels.set(level, []);
    }

    indices.logLevels.get(level).push(lineNumber);
  }
}

/**
 * 时间范围索引
 */
function indexTimeRange(line, lineNumber) {
  const timeMatch = line.match(/\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})\b/);

  if (timeMatch) {
    const timestamp = timeMatch[1];

    indices.timeRanges.push({
      timestamp,
      lineNumber,
    });
  }
}

/**
 * 获取统计信息
 */
function handleGetStats() {
  self.postMessage({
    type: 'stats',
    data: {
      totalLines: state.totalLines,
      indexedLines: state.indexedLines,
      fullTextWords: indices.fullText.size,
      logLevels: Array.from(indices.logLevels.entries()).map(([level, lines]) => ({
        level,
        count: lines.length,
      })),
      timeRanges: indices.timeRanges.length,
    },
  });
}

/**
 * 清空索引
 */
function handleClear() {
  indices = {
    fullText: new Map(),
    logLevels: new Map(),
    timeRanges: [],
  };

  state = {
    totalLines: 0,
    indexedLines: 0,
    startTime: 0,
  };

  self.postMessage({
    type: 'cleared',
  });
}

/**
 * 导出索引数据（用于持久化或传输到主线程）
 */
function handleExport() {
  const exported = {
    fullText: Array.from(indices.fullText.entries()),
    logLevels: Array.from(indices.logLevels.entries()),
    timeRanges: indices.timeRanges,
    state: {
      totalLines: state.totalLines,
      indexedLines: state.indexedLines,
    },
  };

  self.postMessage({
    type: 'exported',
    data: exported,
  });
}
