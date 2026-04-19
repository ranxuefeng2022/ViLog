/**
 * 并行过滤 Worker
 *
 * 🚀 零分配单趟匹配 + 行数据缓存
 * - 内联 charCodeAt + ASCII toLower，不调用 toLowerCase()
 * - 单字符检查 + AC 自动机在同一次遍历中完成
 * - 直接用 Int32Array 存储结果
 * - 🚀 缓存行数据：同一文件重复过滤时只发关键词，不重传数据
 */

importScripts('aho-corasick.js');

let isCancelled = false;
let compiledRegexes = [];
let stringKeywords = [];
let singleCharCodes = new Set();
let ahoCorasickMatcher = null;
let acNodes = null;

// 🚀 行数据缓存：同一文件重复过滤时复用，避免重新传输 ~100MB 数据
let cachedLines = null;
let cachedStartIndex = -1;
let cachedChunkIndex = -1;

/**
 * 预编译所有匹配策略
 */
function precompileKeywords(keywords) {
  compiledRegexes = [];
  stringKeywords = [];
  singleCharCodes = new Set();
  ahoCorasickMatcher = null;
  acNodes = null;

  const multiCharKeywords = [];

  for (const keyword of keywords) {
    if (!keyword) {
      stringKeywords.push('');
      continue;
    }

    if (keyword.length === 1 && !/[.*+?^${}()|[\]\\]/.test(keyword)) {
      singleCharCodes.add(keyword.toLowerCase().charCodeAt(0));
      continue;
    }

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

  if (multiCharKeywords.length > 0) {
    try {
      ahoCorasickMatcher = compileAhoCorasick(multiCharKeywords);
      acNodes = ahoCorasickMatcher.nodes;
    } catch (e) {
      ahoCorasickMatcher = null;
      acNodes = null;
      stringKeywords.push(...multiCharKeywords);
    }
  }
}

/**
 * 处理数据块
 * 🚀 优化：如果传入了 lines，缓存到模块变量；后续过滤只传关键词即可
 */
function processChunk(data) {
  const { lines, keywords, sessionId, chunkIndex, totalChunks, startIndex } = data;

  // 🚀 缓存行数据：有新数据就缓存，没有就复用上次的数据
  if (lines && lines.length > 0) {
    cachedLines = lines;
    cachedStartIndex = startIndex;
    cachedChunkIndex = chunkIndex;
  }

  if (!cachedLines) {
    console.error(`[Worker] 无数据可处理，chunkIndex=${chunkIndex}`);
    return;
  }

  isCancelled = false;
  precompileKeywords(keywords);

  const activeLines = cachedLines;
  const activeStartIndex = cachedStartIndex;
  const activeChunkIndex = cachedChunkIndex;
  const startTime = performance.now();
  const linesLen = activeLines.length;
  let matchCount = 0;

  let resultCap = Math.max(256, linesLen >> 2);
  let results = new Int32Array(resultCap);

  const hasSC = singleCharCodes.size > 0;
  const hasAC = acNodes !== null;
  const hasStr = stringKeywords.length > 0;
  const hasRx = compiledRegexes.length > 0;

  console.log(`[Worker ${activeChunkIndex}] 开始: ${linesLen} 行 ${lines ? '(新数据)' : '(缓存)'}`);

  for (let i = 0; i < linesLen; i++) {
    const line = activeLines[i];
    if (!line) continue;

    let matched = false;

    // ===== 快速路径：单趟 charCodeAt + 内联 toLower + AC =====
    if (hasAC || hasSC) {
      let nodeIdx = 0;
      const lineLen = line.length;

      for (let j = 0; j < lineLen; j++) {
        let cc = line.charCodeAt(j);
        if (cc >= 65 && cc <= 90) cc += 32;

        if (hasSC && singleCharCodes.has(cc)) {
          matched = true;
          break;
        }

        if (hasAC) {
          if (cc < 128) {
            let children = acNodes[nodeIdx].children;
            while (nodeIdx !== 0 && children[cc] === -1) {
              nodeIdx = acNodes[nodeIdx].fail;
              children = acNodes[nodeIdx].children;
            }
            const next = children[cc];
            if (next !== -1) {
              nodeIdx = next;
              if (acNodes[nodeIdx].output.length > 0) {
                matched = true;
                break;
              }
            }
          } else {
            while (nodeIdx !== 0 && getChild(acNodes[nodeIdx], cc) === -1) {
              nodeIdx = acNodes[nodeIdx].fail;
            }
            const next = getChild(acNodes[nodeIdx], cc);
            if (next !== -1) {
              nodeIdx = next;
              if (acNodes[nodeIdx].output.length > 0) {
                matched = true;
                break;
              }
            }
          }
        }
      }
    }

    // ===== 慢速路径：字符串 + 正则 =====
    if (!matched && (hasStr || hasRx)) {
      const lowerLine = line.toLowerCase();
      if (hasStr) {
        for (let k = 0; k < stringKeywords.length; k++) {
          if (lowerLine.includes(stringKeywords[k])) { matched = true; break; }
        }
      }
      if (!matched && hasRx) {
        for (let k = 0; k < compiledRegexes.length; k++) {
          if (compiledRegexes[k].test(lowerLine)) { matched = true; break; }
        }
      }
    }

    if (matched) {
      if (matchCount >= resultCap) {
        const newCap = resultCap + (resultCap >> 1) + 1;
        const newResults = new Int32Array(newCap);
        newResults.set(results);
        results = newResults;
        resultCap = newCap;
      }
      results[matchCount++] = activeStartIndex + i;
    }

    if ((i & 0xFFFF) === 0 && i > 0) {
      if (isCancelled) {
        postMessage({ type: 'cancelled', sessionId, chunkIndex: activeChunkIndex });
        return;
      }
      postMessage({
        type: 'progress',
        sessionId,
        chunkIndex: activeChunkIndex,
        progress: {
          processed: i,
          total: linesLen,
          matched: matchCount,
          percentage: (i / linesLen * 100).toFixed(1)
        }
      });
    }
  }

  postMessage({
    type: 'progress',
    sessionId,
    chunkIndex: activeChunkIndex,
    progress: { processed: linesLen, total: linesLen, matched: matchCount, percentage: '100.0' }
  });

  const totalTime = performance.now() - startTime;
  const linesPerMs = (linesLen / totalTime).toFixed(0);

  console.log(`[Worker ${activeChunkIndex}] 完成: ${matchCount} 匹配, ${totalTime.toFixed(2)}ms, ${linesPerMs} 行/ms`);

  const finalResults = results.buffer.byteLength === matchCount * 4
    ? results
    : results.slice(0, matchCount);

  postMessage({
    type: 'complete',
    sessionId,
    chunkIndex: activeChunkIndex,
    results: finalResults,
    stats: {
      chunkIndex: activeChunkIndex,
      totalLines: linesLen,
      matchedCount: matchCount,
      totalTime: totalTime.toFixed(2),
      linesPerMs: linesPerMs,
      avgTimePerLine: (totalTime / linesLen * 1000).toFixed(2),
      optimization: hasAC ? 'AC-inline-cached' : 'Precompiled'
    }
  }, [finalResults.buffer]);
}

function cancelOperation() {
  isCancelled = true;
}

/**
 * 🚀 从 SharedArrayBuffer 解码指定行范围的字符串
 * 布局: [uint32 lineCount][uint32 offsets[N+1]][utf8 bytes...]
 */
function decodeLinesFromSAB(sab, headerSize, startLine, endLine) {
  const decoder = new TextDecoder('utf-8');
  const offsetsView = new Uint32Array(sab, 4); // 偏移表从第4字节开始
  const dataView = new Uint8Array(sab, headerSize);

  const lines = new Array(endLine - startLine);
  for (let i = startLine; i < endLine; i++) {
    const byteStart = offsetsView[i];
    const byteEnd = offsetsView[i + 1];
    if (byteStart === byteEnd) {
      lines[i - startLine] = '';
    } else {
      lines[i - startLine] = decoder.decode(dataView.subarray(byteStart, byteEnd));
    }
  }
  return lines;
}

// 监听消息
self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'process':
      processChunk(data);
      break;
    case 'process-sab':
      // 🚀 SharedArrayBuffer 路径：从共享内存解码行数据后走正常过滤流程
      try {
        const { sab, headerSize, startLine, endLine, keywords, sessionId, chunkIndex, totalChunks } = data;
        console.log(`[Worker] 收到 process-sab: chunk=${chunkIndex}, lines=${endLine - startLine}, sab=${sab ? sab.byteLength : 'null'}, headerSize=${headerSize}`);
        const lines = decodeLinesFromSAB(sab, headerSize, startLine, endLine);
        console.log(`[Worker] SAB 解码完成: ${lines.length} 行, 首行=${lines[0] ? lines[0].substring(0, 50) : 'empty'}`);
        processChunk({
          lines: lines,
          keywords: keywords,
          sessionId: sessionId,
          chunkIndex: chunkIndex,
          totalChunks: totalChunks,
          startIndex: startLine
        });
      } catch (err) {
        console.error(`[Worker] process-sab 失败:`, err.message, err.stack);
      }
      break;
    case 'cancel':
      cancelOperation();
      break;
    case 'clearCache':
      // 🚀 清除缓存（文件切换时调用）
      cachedLines = null;
      cachedStartIndex = -1;
      cachedChunkIndex = -1;
      break;
    default:
      console.warn('[Worker] 未知消息类型:', type);
  }
};
