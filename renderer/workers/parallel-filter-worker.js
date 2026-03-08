/**
 * 并行过滤 Worker
 * 处理分配给它的数据块
 * 🚀 集成 Aho-Corasick 算法优化
 * 🚀 可选 WebAssembly 加速（如果可用）
 */

importScripts('aho-corasick.js');
// importScripts('wasm-string-search.js'); // 可选：WASM加速

let isCancelled = false;
let compiledRegexes = [];  // 预编译的正则表达式
let stringKeywords = [];   // 纯字符串关键词
let singleCharKeywords = new Set();  // 🚀 单字符关键词集合（快速路径）
let ahoCorasickMatcher = null;  // 🚀 Aho-Corasick 自动机
// let wasmSearcher = null;  // 🚀 可选：WASM搜索器

/**
 * 预编译所有匹配策略
 * 🚀 优化：分离单字符关键词，使用快速路径
 * 🚀 优化：使用 Aho-Corasick 算法进行多模式匹配
 */
function precompileKeywords(keywords) {
  compiledRegexes = [];
  stringKeywords = [];
  singleCharKeywords = new Set();

  // 分离单字符关键词
  const multiCharKeywords = [];

  for (const keyword of keywords) {
    if (!keyword) {
      stringKeywords.push('');
      continue;
    }

    // 🚀 单字符关键词使用快速路径
    if (keyword.length === 1 && !/[.*+?^${}()|[\]\\]/.test(keyword)) {
      singleCharKeywords.add(keyword.toLowerCase());
      continue;
    }

    // 检查是否是正则表达式
    if (keyword.includes('|') || /[.*+?^${}()|[\]\\]/.test(keyword)) {
      try {
        compiledRegexes.push(new RegExp(keyword, 'i'));
      } catch (e) {
        // 正则表达式错误，作为普通字符串处理
        multiCharKeywords.push(keyword.toLowerCase());
      }
    } else {
      multiCharKeywords.push(keyword.toLowerCase());
    }
  }

  // 🚀 构建 Aho-Corasick 自动机（多字符关键词）
  if (multiCharKeywords.length > 0) {
    try {
      ahoCorasickMatcher = compileAhoCorasick(multiCharKeywords);
      console.log(`[Worker] Aho-Corasick 自动机已构建: ${multiCharKeywords.length} 个关键词`);
    } catch (e) {
      console.error('[Worker] Aho-Corasick 构建失败，回退到普通字符串搜索:', e);
      ahoCorasickMatcher = null;
      // 🚀 回退：将多字符关键词添加到stringKeywords
      stringKeywords.push(...multiCharKeywords);
    }
  } else {
    // 没有多字符关键词，确保stringKeywords被填充
    if (stringKeywords.length === 0) {
      console.log('[Worker] 没有需要匹配的关键词');
    }
  }

  console.log(`[Worker] 预编译完成: ${compiledRegexes.length} 个正则, ${singleCharKeywords.size} 个单字符, ${ahoCorasickMatcher ? 'AC算法' : stringKeywords.length + ' 个字符串'}`);
}

/**
 * 检查文本是否匹配关键词列表
 * 🚀 四级匹配策略，性能最优：
 * 1. 单字符快速路径（O(n)）
 * 2. 普通字符串关键词
 * 3. Aho-Corasick 多模式匹配（O(n + z)）
 * 4. 正则表达式匹配
 */
function matchesKeywords(text) {
  const lowerText = text.toLowerCase();

  // 🚀 一级快速路径：单字符关键词（最快）
  if (singleCharKeywords.size > 0) {
    for (let i = 0; i < lowerText.length; i++) {
      if (singleCharKeywords.has(lowerText[i])) {
        return true;  // 找到单字符匹配，立即返回
      }
    }
  }

  // 🚀 二级：普通字符串关键词（使用includes）
  for (let i = 0; i < stringKeywords.length; i++) {
    const keyword = stringKeywords[i];
    if (keyword && keyword !== '' && lowerText.includes(keyword)) {
      return true;  // 找到字符串匹配，立即返回
    }
  }

  // 🚀 三级优化：Aho-Corasick 多模式匹配（一次扫描匹配所有关键词）
  if (ahoCorasickMatcher) {
    try {
      if (ahoCorasickMatcher.hasMatch(lowerText)) {
        return true;  // Aho-Corasick找到匹配，立即返回
      }
    } catch (e) {
      console.error('[Worker] Aho-Corasick 匹配失败:', e);
      // 继续尝试其他方法
    }
  }

  // 🚀 四级回退：正则表达式匹配（最慢）
  for (let i = 0; i < compiledRegexes.length; i++) {
    const regex = compiledRegexes[i];
    if (regex && regex.test(lowerText)) {
      return true;  // 正则表达式找到匹配，立即返回
    }
  }

  return false;  // 所有方法都没有匹配
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
 * 处理数据块
 * 🚀 添加性能基准测试
 */
function processChunk(data) {
  const { lines, keywords, sessionId, chunkIndex, totalChunks, startIndex } = data;

  isCancelled = false;

  // 🚀 方案2：预编译正则表达式（只编译一次）
  precompileKeywords(keywords);

  const startTime = performance.now();
  const matchedIndices = [];

  console.log(`[Worker ${chunkIndex}] 开始处理块 ${chunkIndex + 1}/${totalChunks}: ${lines.length} 行`);

  // 🚀 性能基准测试
  const benchmarkStartTime = performance.now();

  // 分批处理，避免阻塞
  const BATCH_SIZE = 5000;
  let processedCount = 0;

  function processBatch() {
    if (isCancelled) {
      postMessage({
        type: 'cancelled',
        sessionId,
        chunkIndex
      });
      return;
    }

    const endIndex = Math.min(processedCount + BATCH_SIZE, lines.length);

    for (let i = processedCount; i < endIndex; i++) {
      // 🚀 去掉HTML转义 - 直接使用原始行
      const line = lines[i];

      // 🚀 使用优化的匹配策略（单字符 + Aho-Corasick + 正则）
      if (matchesKeywords(line)) {
        matchedIndices.push(startIndex + i);  // 只返回索引
      }
    }

    processedCount = endIndex;

    // 发送进度更新
    if (processedCount % 10000 === 0 || processedCount === lines.length) {
      postMessage({
        type: 'progress',
        sessionId,
        chunkIndex,
        progress: {
          processed: processedCount,
          total: lines.length,
          matched: matchedIndices.length,
          percentage: (processedCount / lines.length * 100).toFixed(1)
        }
      });
    }

    // 继续处理下一批
    if (processedCount < lines.length) {
      setTimeout(processBatch, 0);
    } else {
      // 完成
      const totalTime = performance.now() - startTime;
      const benchmarkTime = performance.now() - benchmarkStartTime;

      // 🚀 性能统计
      const linesPerMs = (lines.length / totalTime).toFixed(0);
      const avgTimePerLine = (totalTime / lines.length * 1000).toFixed(2);

      console.log(`[Worker ${chunkIndex}] 完成: ${matchedIndices.length} 个匹配, 耗时 ${totalTime.toFixed(2)}ms`);
      console.log(`[Worker ${chunkIndex}] 📊 性能: ${linesPerMs} 行/ms, 平均 ${avgTimePerLine} μs/行`);
      console.log(`[Worker ${chunkIndex}] 🚀 优化: ${ahoCorasickMatcher ? 'Aho-Corasick算法' : '预编译正则'} + ${singleCharKeywords.size > 0 ? '单字符快速路径' : ''}`);

      // 🚀 使用 Transferable Objects 零拷贝传输
      const indicesArray = new Int32Array(matchedIndices);

      postMessage({
        type: 'complete',
        sessionId,
        chunkIndex,
        results: indicesArray,  // 发送 TypedArray
        stats: {
          chunkIndex,
          totalLines: lines.length,
          matchedCount: matchedIndices.length,
          totalTime: totalTime.toFixed(2),
          // 🚀 新增性能指标
          linesPerMs: linesPerMs,
          avgTimePerLine: avgTimePerLine,
          optimization: ahoCorasickMatcher ? 'Aho-Corasick' : 'Precompiled'
        }
      }, [indicesArray.buffer]);  // 转移所有权，零拷贝
    }
  }

  processBatch();
}

/**
 * 取消操作
 */
function cancelOperation() {
  console.log('[Worker] 操作已取消');
  isCancelled = true;
}

// 监听消息
self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'process':
      processChunk(data);
      break;
    case 'cancel':
      cancelOperation();
      break;
    default:
      console.warn('[Worker] 未知消息类型:', type);
  }
};
