/**
 * Web Worker: 并行计算高亮
 * 将高亮计算从主线程移到Worker线程，避免阻塞UI
 */

// 词汇表：常用的关键词和模式
const patterns = {
  // 日志级别
  logLevel: /\b(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|TRACE)\b/gi,

  // 时间戳
  timestamp: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?\b/g,

  // IP地址
  ipAddress: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,

  // URL
  url: /https?:\/\/[^\s<>"]+/gi,

  // 文件路径
  filePath: /\b[a-zA-Z]:\\(?:[^<>:"|?*]+\\)*[^<>:"|?*]+\.[a-zA-Z0-9]+\b/g,

  // 数字（连续4位以上）
  numbers: /\b\d{4,}\b/g,

  // 十六进制
  hex: /\b0x[0-9a-fA-F]+\b/g,
};

/**
 * HTML转义
 */
function escapeHtml(text) {
  return text.replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

/**
 * 正则转义
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 检查文本是否包含任何关键词
 */
function containsKeyword(text, keywords) {
  if (!keywords || keywords.length === 0) return false;

  // 快速检查：如果所有关键词都不在文本中，返回false
  for (const kw of keywords) {
    if (text.toLowerCase().includes(kw.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * 高亮内容
 */
function highlightContent(originalText, options) {
  const {
    searchKeyword = '',
    customHighlights = [],
    filterKeywords = []
  } = options;

  // 快速路径：如果没有任何高亮需求，直接返回转义后的文本
  if (!searchKeyword && customHighlights.length === 0 && filterKeywords.length === 0) {
    return {
      text: originalText,
      hasHighlight: false
    };
  }

  // 转义HTML
  let result = escapeHtml(originalText);
  const hasHighlight = true;

  // 收集所有高亮关键词
  const allKeywords = [];

  // 1. 搜索关键词
  if (searchKeyword && searchKeyword.trim()) {
    try {
      allKeywords.push({
        regex: new RegExp(escapeRegex(searchKeyword), 'gi'),
        class: 'search-highlight'
      });
    } catch (e) {
      console.error('Invalid search keyword regex:', searchKeyword, e);
    }
  }

  // 2. 自定义高亮
  if (customHighlights.length > 0) {
    customHighlights.forEach((hl, idx) => {
      if (hl.keyword && hl.keyword.trim()) {
        try {
          allKeywords.push({
            regex: new RegExp(escapeRegex(hl.keyword), 'gi'),
            class: `custom-highlight-${(idx % 5) + 1}`
          });
        } catch (e) {
          console.error('Invalid custom highlight regex:', hl.keyword, e);
        }
      }
    });
  }

  // 3. 过滤关键词（最多3个，避免性能问题）
  if (filterKeywords.length > 0) {
    filterKeywords.slice(0, 3).forEach((kw, idx) => {
      if (kw && kw.trim()) {
        try {
          allKeywords.push({
            regex: new RegExp(escapeRegex(kw), 'gi'),
            class: `filter-highlight-${(idx % 3) + 1}`
          });
        } catch (e) {
          console.error('Invalid filter keyword regex:', kw, e);
        }
      }
    });
  }

  // 快速路径：如果没有有效关键词，返回转义后的文本
  if (allKeywords.length === 0) {
    return {
      text: result,
      hasHighlight: false
    };
  }

  // 应用高亮
  for (const {regex, class: className} of allKeywords) {
    regex.lastIndex = 0;
    result = result.replace(regex, `<mark class="${className}">$&</mark>`);
  }

  return {
    text: result,
    hasHighlight: true
  };
}

/**
 * 批量高亮多行文本
 */
function batchHighlight(lines, options) {
  const results = [];
  const startTime = performance.now();

  for (let i = 0; i < lines.length; i++) {
    const result = highlightContent(lines[i], options);
    results.push(result);

    // 每1000行报告一次进度
    if ((i + 1) % 1000 === 0) {
      self.postMessage({
        type: 'progress',
        current: i + 1,
        total: lines.length
      });
    }
  }

  const elapsed = performance.now() - startTime;

  return {
    type: 'complete',
    results: results,
    time: elapsed.toFixed(2)
  };
}

// 监听主线程消息
self.addEventListener('message', (e) => {
  const { type, lines, options, taskId } = e.data;

  switch (type) {
    case 'highlight':
      // 批量高亮
      try {
        const result = batchHighlight(lines, options);
        self.postMessage({
          type: 'complete',
          taskId: taskId,
          ...result
        });
      } catch (error) {
        self.postMessage({
          type: 'error',
          taskId: taskId,
          error: error.message
        });
      }
      break;

    case 'ping':
      // 心跳检测
      self.postMessage({ type: 'pong', taskId });
      break;

    default:
      console.warn('[HighlightWorker] Unknown message type:', type);
  }
});

console.log('✓ Highlight Worker loaded');
