/**
 * CSV/TSV 解析 Worker
 * 在后台线程中解析 CSV/TSV 格式文件
 *
 * 使用方法：
 * const worker = new Worker('./csv-parser-worker.js');
 * worker.postMessage({ lines: [...], delimiter: ',' });
 * worker.onmessage = (e) => { ... };
 */

// 当前配置
let delimiter = ',';
let quoteChar = '"';

/**
 * 处理主线程发送的消息
 */
self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'config':
      // 配置解析参数
      delimiter = data.delimiter || ',';
      quoteChar = data.quoteChar || '"';
      self.postMessage({ type: 'configComplete' });
      break;

    case 'parse':
      handleParse(data);
      break;

    case 'normalize':
      handleNormalize(data);
      break;

    case 'detectFormat':
      handleDetectFormat(data);
      break;

    default:
      console.warn('Unknown message type:', type);
  }
};

/**
 * 检测文件格式（CSV、TSV 或普通日志）
 */
function handleDetectFormat(data) {
  const { lines, sampleSize = 100 } = data;
  const sampleLines = lines.slice(0, sampleSize);

  let commaCount = 0;
  let tabCount = 0;
  let semicolonCount = 0;

  for (const line of sampleLines) {
    if (!line) continue;

    // 统计分隔符出现次数
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === quoteChar) {
        // 检查是否是转义的引号
        if (i + 1 < line.length && line[i + 1] === quoteChar) {
          i++; // 跳过转义的引号
        } else {
          inQuotes = !inQuotes;
        }
      } else if (!inQuotes) {
        if (char === ',') commaCount++;
        else if (char === '\t') tabCount++;
        else if (char === ';') semicolonCount++;
      }
    }
  }

  const totalLines = sampleLines.filter(l => l && l.trim()).length;
  const avgCommas = commaCount / totalLines;
  const avgTabs = tabCount / totalLines;
  const avgSemicolons = semicolonCount / totalLines;

  let format = 'log';
  let detectedDelimiter = ',';

  if (avgTabs > avgCommas && avgTabs > avgSemicolons && avgTabs > 0.5) {
    format = 'tsv';
    detectedDelimiter = '\t';
  } else if (avgSemicolons > avgCommas && avgSemicolons > avgTabs && avgSemicolons > 0.5) {
    format = 'csv';
    detectedDelimiter = ';';
  } else if (avgCommas > 0.5) {
    format = 'csv';
    detectedDelimiter = ',';
  }

  self.postMessage({
    type: 'formatDetected',
    data: {
      format,
      delimiter: detectedDelimiter,
      stats: {
        avgCommas,
        avgTabs,
        avgSemicolons,
        sampleLines: totalLines
      }
    }
  });
}

/**
 * 解析单行 CSV
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === quoteChar) {
      if (inQuotes && nextChar === quoteChar) {
        // 转义的引号
        current += '"';
        i++;
      } else {
        // 切换引号状态
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      // 分隔符，结束当前字段
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // 添加最后一个字段
  result.push(current);

  return result;
}

/**
 * 处理解析请求
 */
function handleParse(data) {
  const { lines, hasHeader = true, batchSize = 5000 } = data;
  const parsedData = [];
  let maxColumns = 0;

  const startTime = performance.now();
  let processedCount = 0;

  function processBatch(startIndex) {
    const endIndex = Math.min(startIndex + batchSize, lines.length);

    for (let i = startIndex; i < endIndex; i++) {
      const line = lines[i];
      if (!line || typeof line !== 'string') {
        parsedData.push([]);
        continue;
      }

      const row = parseCSVLine(line.trim());
      if (row.length > maxColumns) {
        maxColumns = row.length;
      }
      parsedData.push(row);
    }

    processedCount = endIndex;

    // 发送进度
    const progress = (processedCount / lines.length) * 100;
    self.postMessage({
      type: 'progress',
      data: {
        processed: processedCount,
        total: lines.length,
        progress: progress,
        results: endIndex === lines.length ? parsedData : null
      }
    });

    if (endIndex < lines.length) {
      setTimeout(() => processBatch(endIndex), 0);
    } else {
      const elapsed = performance.now() - startTime;
      console.log(`[CSV Parser Worker] 解析完成: ${lines.length} 行, ${maxColumns} 列, 耗时 ${elapsed.toFixed(2)}ms`);

      // 发送完成消息
      self.postMessage({
        type: 'complete',
        data: {
          totalLines: lines.length,
          maxColumns: maxColumns,
          elapsed: elapsed,
          results: parsedData
        }
      });
    }
  }

  processBatch(0);
}

/**
 * 处理标准化请求（补齐列数）
 */
function handleNormalize(data) {
  const { parsedData, targetColumns = null, batchSize = 10000 } = data;

  const startTime = performance.now();
  let processedCount = 0;

  // 如果没有指定目标列数，计算最大列数
  const maxColumns = targetColumns || Math.max(...parsedData.map(row => row.length));

  function processBatch(startIndex) {
    const endIndex = Math.min(startIndex + batchSize, parsedData.length);

    for (let i = startIndex; i < endIndex; i++) {
      const row = parsedData[i];
      while (row.length < maxColumns) {
        row.push('');
      }
    }

    processedCount = endIndex;

    // 发送进度
    const progress = (processedCount / parsedData.length) * 100;
    self.postMessage({
      type: 'normalizeProgress',
      data: {
        processed: processedCount,
        total: parsedData.length,
        progress: progress,
        maxColumns: maxColumns,
        results: endIndex === parsedData.length ? parsedData : null
      }
    });

    if (endIndex < parsedData.length) {
      setTimeout(() => processBatch(endIndex), 0);
    } else {
      const elapsed = performance.now() - startTime;
      console.log(`[CSV Parser Worker] 标准化完成: ${parsedData.length} 行, ${maxColumns} 列, 耗时 ${elapsed.toFixed(2)}ms`);
    }
  }

  processBatch(0);
}
