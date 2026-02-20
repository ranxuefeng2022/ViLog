/**
 * 过滤日志 Web Worker
 * 在后台线程中执行过滤操作，避免阻塞主线程 UI
 */

// 全局变量
let currentIndex = 0;
let processedCount = 0;
let matchedIndices = [];
let isCancelled = false;

/**
 * 检查文本是否匹配关键词列表
 * @param {string} text - 要检查的文本
 * @param {string[]} keywords - 关键词列表
 * @returns {boolean} 是否匹配
 */
function matchesKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return true;

  const lowerText = text.toLowerCase();

  for (const keyword of keywords) {
    if (!keyword) continue;

    // 检查是否是正则表达式
    if (keyword.includes('|') || /[.*+?^${}()|[\]\\]/.test(keyword)) {
      try {
        const regex = new RegExp(keyword, 'i');
        if (regex.test(lowerText)) {
          return true;  // OR 逻辑：只要匹配一个即可
        }
      } catch (e) {
        // 正则表达式错误，回退到字符串搜索
        if (lowerText.includes(keyword.toLowerCase())) {
          return true;
        }
      }
    } else {
      // 简单字符串搜索（更快）
      if (lowerText.includes(keyword.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 去除 HTML 转义字符
 * @param {string} html - HTML 字符串
 * @returns {string} 纯文本
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
 * @param {Object} data - 请求数据
 * @param {string[]} data.lines - 日志行数组
 * @param {string[]} data.keywords - 关键词数组
 * @param {number} data.sessionId - 会话 ID
 * @param {number} data.chunkSize - 每批处理的行数
 */
function processFilter(data) {
  try {
    console.log('[Worker] processFilter 开始');
    const { lines, keywords, sessionId, chunkSize } = data;

    console.log('[Worker] 接收到的数据:', {
      linesType: typeof lines,
      linesLength: lines?.length,
      keywordsType: typeof keywords,
      keywordsLength: keywords?.length,
      sessionId: sessionId,
      chunkSize: chunkSize
    });

    // 🚀 输入验证
    if (!lines || !Array.isArray(lines)) {
      throw new Error('Invalid lines data: not an array');
    }
    if (!keywords || !Array.isArray(keywords)) {
      throw new Error('Invalid keywords data: not an array');
    }

    const totalLines = lines.length;
    console.log('[Worker] 数据验证通过，开始处理', totalLines, '行数据');

    // 性能优化：根据数据量动态调整批次大小
    const effectiveChunkSize = chunkSize || (
      totalLines > 100000 ? 50000 :  // 超大数据：5万/批
      totalLines > 50000 ? 20000 :   // 大数据：2万/批
      totalLines > 10000 ? 10000 :   // 中数据：1万/批
      5000                          // 小数据：5千/批
    );

    // 重置状态
    currentIndex = 0;
    processedCount = 0;
    matchedIndices = [];
    isCancelled = false;

    const startTime = performance.now();

    console.log(`[Worker] 开始过滤: ${totalLines} 行, ${keywords.length} 个关键词, 会话 ${sessionId}`);

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
      const chunkStartTime = performance.now();

      // 处理当前批次
      for (let i = currentIndex; i < endIndex; i++) {
        try {
          // 🚀 安全检查：跳过 null/undefined 行
          if (lines[i] == null) {
            console.warn(`[Worker] 跳过空行: 索引 ${i}`);
            processedCount++;
            continue;
          }

          // 🚀 安全检查：转换为字符串，处理二进制数据
          let lineText = lines[i];
          if (typeof lineText !== 'string') {
            lineText = String(lineText);
          }

          // 直接使用原始内容
          const plainText = lineText;

          // 检查是否匹配
          if (matchesKeywords(plainText, keywords)) {
            matchedIndices.push({
              index: i,
              content: plainText
            });
          }
        } catch (lineError) {
          // 🚀 单行错误不影响整体处理
          console.error(`[Worker] 处理第 ${i} 行时出错:`, lineError.message);
        }

        processedCount++;
      }

    const chunkTime = performance.now() - chunkStartTime;

    // 发送进度更新（包含部分结果用于增量显示）
    // 性能优化：减少发送频率，只在关键节点发送
    const percentage = processedCount / totalLines;
    const lastPercentage = (processedCount - (endIndex - currentIndex)) / totalLines;

    // 🚀 修复：更频繁地发送部分结果，立即显示
    // 1. 每处理 5% 的数据（从20%降低到5%）
    // 2. 或每处理 5000 行（从1万降低到5千）
    // 3. 或有结果后每处理 2000 行
    const shouldSendPartialResults =
      (percentage - lastPercentage >= 0.05) ||  // 🚀 每 5%（从20%降低）
      (processedCount % 5000 === 0) ||          // 🚀 每 5千行（从1万降低）
      (matchedIndices.length >= 10 && processedCount % 2000 === 0);  // 🚀 有结果后每2千行

    postMessage({
      type: 'progress',
      sessionId,
      progress: {
        processed: processedCount,
        total: totalLines,
        matched: matchedIndices.length,
        percentage: (percentage * 100).toFixed(1)
      },
      // 增量显示：包含当前已匹配的部分结果
      partialResults: shouldSendPartialResults ? matchedIndices.slice() : null
    });

    currentIndex = endIndex;

    // 继续处理下一批
    if (currentIndex < totalLines) {
      // 使用 setTimeout 让出控制权
      setTimeout(processChunk, 0);
    } else {
      // 处理完成
      const totalTime = performance.now() - startTime;

      console.log(`[Worker] 过滤完成: ${matchedIndices.length} 个匹配, 耗时 ${totalTime.toFixed(2)}ms`);

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

  // 开始处理
  processChunk();
  } catch (error) {
    // 🚀 捕获顶层错误，发送错误消息
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
 * @param {Object} data - 请求数据
 * @param {Object[]} data.filteredResults - 一级过滤结果
 * @param {string[]} data.keywords - 二级关键词数组
 * @param {number} data.sessionId - 会话 ID
 */
function processSecondaryFilter(data) {
  const { filteredResults, keywords, sessionId } = data;

  matchedIndices = [];
  processedCount = 0;
  isCancelled = false;

  const startTime = performance.now();
  const totalItems = filteredResults.length;

  console.log(`[Worker] 开始二级过滤: ${totalItems} 项, ${keywords.length} 个关键词, 会话 ${sessionId}`);

  // 分批处理
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
      const item = filteredResults[i];

      if (matchesKeywords(item.content, keywords)) {
        matchedIndices.push(item);
      }

      processedCount++;
    }

    // 发送进度更新（包含部分结果用于增量显示）
    // 性能优化：减少发送频率
    const percentage = processedCount / totalItems;
    const lastPercentage = (processedCount - (endIndex - currentIndex)) / totalItems;

    // 🚀 修复：更频繁地发送部分结果，立即显示
    // 1. 每处理 5% 的数据（从25%降低到5%）
    // 2. 或每处理 2000 项（从5千降低到2千）
    const shouldSendPartialResults =
      (percentage - lastPercentage >= 0.05) ||  // 🚀 每 5%（从25%降低）
      (processedCount % 2000 === 0);             // 🚀 每 2千项（从5千降低）

    postMessage({
      type: 'progress',
      sessionId,
      progress: {
        processed: processedCount,
        total: totalItems,
        matched: matchedIndices.length,
        percentage: (percentage * 100).toFixed(1)
      },
      // 增量显示：包含当前已匹配的部分结果
      partialResults: shouldSendPartialResults ? matchedIndices.slice() : null
    });

    currentIndex = endIndex;

    if (currentIndex < totalItems) {
      setTimeout(processChunk, 0);
    } else {
      const totalTime = performance.now() - startTime;

      console.log(`[Worker] 二级过滤完成: ${matchedIndices.length} 个匹配, 耗时 ${totalTime.toFixed(2)}ms`);

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
  console.log('[Worker] 操作已取消');
  isCancelled = true;
}

// 监听主线程消息
self.onmessage = function(e) {
  try {
    console.log('[Worker] 收到消息:', e.data.type);

    const { type, data } = e.data;

    switch (type) {
      case 'filter':
        console.log('[Worker] 开始处理 filter 请求，数据行数:', data ? data.lines?.length : 'no data');
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
    unescapeHtml
  };
}
