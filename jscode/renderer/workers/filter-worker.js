/**
 * 过滤日志 Web Worker
 * 在后台线程中执行过滤操作，避免阻塞主线程 UI
 *
 * 性能优化：
 * - 集成 Aho-Corasick 多模式匹配算法
 * - 预编译正则表达式 + 单字符快速路径
 * - 只做一次 toLowerCase()，避免重复字符串分配
 * - partialResults 增量发送，避免全量复制
 */

importScripts('aho-corasick.js');

// 全局变量
let currentIndex = 0;
let processedCount = 0;
let matchedIndices = [];
let isCancelled = false;
let lastSentIndex = 0;  // 上次发送 partialResults 时的位置

// 预编译状态（与 parallel-filter-worker 一致）
let compiledRegexes = [];
let stringKeywords = [];
let singleCharKeywords = new Set();
let ahoCorasickMatcher = null;

/**
 * 预编译所有匹配策略
 * 分离单字符关键词、字符串关键词、正则表达式，并构建 Aho-Corasick 自动机
 */
function precompileKeywords(keywords) {
  compiledRegexes = [];
  stringKeywords = [];
  singleCharKeywords = new Set();
  ahoCorasickMatcher = null;

  const multiCharKeywords = [];

  for (const keyword of keywords) {
    if (!keyword) {
      stringKeywords.push('');
      continue;
    }

    // 单字符关键词使用快速路径
    if (keyword.length === 1 && !/[.*+?^${}()|[\]\\]/.test(keyword)) {
      singleCharKeywords.add(keyword.toLowerCase());
      continue;
    }

    // 检查是否是正则表达式
    if (keyword.includes('|') || /[.*+?^${}()|[\]\\]/.test(keyword)) {
      try {
        compiledRegexes.push(new RegExp(keyword, ''));
      } catch (e) {
        multiCharKeywords.push(keyword.toLowerCase());
      }
    } else {
      multiCharKeywords.push(keyword.toLowerCase());
    }
  }

  // 构建 Aho-Corasick 自动机
  if (multiCharKeywords.length > 0) {
    try {
      ahoCorasickMatcher = compileAhoCorasick(multiCharKeywords);
    } catch (e) {
      ahoCorasickMatcher = null;
      stringKeywords.push(...multiCharKeywords);
    }
  }
}

/**
 * 检查已小写化的文本是否匹配关键词列表
 * 优化：调用方负责 toLowerCase，本函数不分配新字符串
 * 四级匹配策略
 */
function matchesKeywords(lowerText) {
  // 一级：单字符快速路径
  if (singleCharKeywords.size > 0) {
    for (let i = 0; i < lowerText.length; i++) {
      if (singleCharKeywords.has(lowerText[i])) {
        return true;
      }
    }
  }

  // 二级：普通字符串关键词
  for (let i = 0; i < stringKeywords.length; i++) {
    const keyword = stringKeywords[i];
    if (keyword && keyword !== '' && lowerText.includes(keyword)) {
      return true;
    }
  }

  // 三级：Aho-Corasick 多模式匹配（传入已小写文本）
  if (ahoCorasickMatcher) {
    try {
      if (ahoCorasickMatcher.hasMatch(lowerText, true)) {
        return true;
      }
    } catch (e) {
      // 继续尝试其他方法
    }
  }

  // 四级：正则表达式匹配
  for (let i = 0; i < compiledRegexes.length; i++) {
    const regex = compiledRegexes[i];
    if (regex && regex.test(lowerText)) {
      return true;
    }
  }

  return false;
}

/**
 * 去除 HTML 转义字符
 */
function unescapeHtml(html) {
  if (!html) return '';

  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x3D;/g, '=');
}

/**
 * 处理过滤请求
 */
function processFilter(data) {
  try {
    const { lines, keywords, sessionId, chunkSize } = data;

    // 输入验证
    if (!lines || !Array.isArray(lines)) {
      throw new Error('Invalid lines data: not an array');
    }
    if (!keywords || !Array.isArray(keywords)) {
      throw new Error('Invalid keywords data: not an array');
    }

    const totalLines = lines.length;

    // 预编译关键词（只编译一次）
    precompileKeywords(keywords);

    // 🚀 优化：一次性预计算所有行的小写版本
    const lowerLines = new Array(totalLines);
    for (let i = 0; i < totalLines; i++) {
      lowerLines[i] = (lines[i] != null) ? String(lines[i]).toLowerCase() : '';
    }

    // 性能优化：根据数据量动态调整批次大小
    const effectiveChunkSize = chunkSize || (
      totalLines > 100000 ? 50000 :
      totalLines > 50000 ? 20000 :
      totalLines > 10000 ? 10000 :
      5000
    );

    // 重置状态
    currentIndex = 0;
    processedCount = 0;
    matchedIndices = [];
    lastSentIndex = 0;
    isCancelled = false;

    const startTime = performance.now();

    // 分批处理
    function processChunk() {
      if (isCancelled) {
        postMessage({
          type: 'cancelled',
          sessionId
        });
        return;
      }

      const endIndex = Math.min(currentIndex + effectiveChunkSize, totalLines);

      // 处理当前批次
      for (let i = currentIndex; i < endIndex; i++) {
        try {
          if (lines[i] == null) {
            processedCount++;
            continue;
          }

          // 🚀 使用预计算的小写文本
          if (matchesKeywords(lowerLines[i])) {
            matchedIndices.push({
              index: i,
              content: lines[i]
            });
          }
        } catch (lineError) {
          console.error(`[Worker] 处理第 ${i} 行时出错:`, lineError.message);
        }

        processedCount++;
      }

      const percentage = processedCount / totalLines;
      const lastPercentage = (processedCount - (endIndex - currentIndex)) / totalLines;

      const shouldSendPartialResults =
        (percentage - lastPercentage >= 0.05) ||
        (processedCount % 5000 === 0) ||
        (matchedIndices.length >= 10 && processedCount % 2000 === 0);

      // 增量发送：只发送上次之后新增的匹配结果，避免全量 slice() 复制
      const newMatches = shouldSendPartialResults
        ? matchedIndices.slice(lastSentIndex)
        : null;
      if (newMatches !== null) {
        lastSentIndex = matchedIndices.length;
      }

      postMessage({
        type: 'progress',
        sessionId,
        progress: {
          processed: processedCount,
          total: totalLines,
          matched: matchedIndices.length,
          percentage: (percentage * 100).toFixed(1)
        },
        // 增量：只包含新增的匹配结果
        partialResults: newMatches,
        // 告知主线程是否为增量
        isIncremental: true
      });

      currentIndex = endIndex;

      if (currentIndex < totalLines) {
        setTimeout(processChunk, 0);
      } else {
        const totalTime = performance.now() - startTime;

        postMessage({
          type: 'complete',
          sessionId,
          results: matchedIndices,
          stats: {
            totalLines,
            matchedCount: matchedIndices.length,
            totalTime: totalTime.toFixed(2)
          }
        });
      }
    }

    processChunk();
  } catch (error) {
    console.error('[Worker] 处理过滤时发生错误:', error);
    postMessage({
      type: 'error',
      error: {
        message: error.message,
        stack: error.stack
      }
    });
  }
}

/**
 * 处理二级过滤请求
 */
function processSecondaryFilter(data) {
  const { filteredResults, keywords, sessionId } = data;

  // 预编译关键词
  precompileKeywords(keywords);

  // 🚀 优化：预计算小写内容
  const lowerContents = new Array(filteredResults.length);
  for (let i = 0; i < filteredResults.length; i++) {
    lowerContents[i] = filteredResults[i].content ? filteredResults[i].content.toLowerCase() : '';
  }

  matchedIndices = [];
  processedCount = 0;
  lastSentIndex = 0;
  isCancelled = false;

  const startTime = performance.now();
  const totalItems = filteredResults.length;

  const batchSize = 2000;
  let currentIndex = 0;

  function processChunk() {
    if (isCancelled) {
      postMessage({
        type: 'cancelled',
        sessionId
      });
      return;
    }

    const endIndex = Math.min(currentIndex + batchSize, totalItems);

    for (let i = currentIndex; i < endIndex; i++) {
      // 🚀 使用预计算的小写文本
      if (matchesKeywords(lowerContents[i])) {
        matchedIndices.push(filteredResults[i]);
      }

      processedCount++;
    }

    const percentage = processedCount / totalItems;
    const lastPercentage = (processedCount - (endIndex - currentIndex)) / totalItems;

    const shouldSendPartialResults =
      (percentage - lastPercentage >= 0.05) ||
      (processedCount % 2000 === 0);

    // 增量发送
    const newMatches = shouldSendPartialResults
      ? matchedIndices.slice(lastSentIndex)
      : null;
    if (newMatches !== null) {
      lastSentIndex = matchedIndices.length;
    }

    postMessage({
      type: 'progress',
      sessionId,
      progress: {
        processed: processedCount,
        total: totalItems,
        matched: matchedIndices.length,
        percentage: (percentage * 100).toFixed(1)
      },
      partialResults: newMatches,
      isIncremental: true
    });

    currentIndex = endIndex;

    if (currentIndex < totalItems) {
      setTimeout(processChunk, 0);
    } else {
      const totalTime = performance.now() - startTime;

      postMessage({
        type: 'complete',
        sessionId,
        results: matchedIndices,
        stats: {
          totalLines: totalItems,
          matchedCount: matchedIndices.length,
          totalTime: totalTime.toFixed(2)
        }
      });
    }
  }

  processChunk();
}

/**
 * 取消当前操作
 */
function cancelOperation() {
  isCancelled = true;
}

// 监听主线程消息
self.onmessage = function(e) {
  try {
    const { type, data } = e.data;

    switch (type) {
      case 'filter':
        processFilter(data);
        break;

      case 'secondaryFilter':
        processSecondaryFilter(data);
        break;

      case 'cancel':
        cancelOperation();
        break;

      default:
        console.warn('[Worker] 未知消息类型:', type);
    }
  } catch (error) {
    console.error('[Worker] onmessage 处理错误:', error);
    postMessage({
      type: 'error',
      error: {
        message: error.message,
        stack: error.stack
      }
    });
  }
};

// 导出函数供测试使用（在非 Worker 环境）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    matchesKeywords,
    unescapeHtml,
    precompileKeywords
  };
}
