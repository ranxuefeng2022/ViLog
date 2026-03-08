/**
 * UTC 时间解析 Worker
 * 在后台线程中解析日志行的 UTC 时间戳
 *
 * 使用方法：
 * const worker = new Worker('./utc-parser-worker.js');
 * worker.postMessage({ lines: [...], patterns: {...} });
 * worker.onmessage = (e) => { ... };
 */

// 正则表达式（从主线程传入）
let timePatternUTC = null;
let timePattern = null;
let extractBootTimeFn = null;

/**
 * 提取 boot time（日志行中的第三个字段）
 */
function extractBootTime(line) {
  if (!line) return null;

  // 分割行，提取第三个字段
  const parts = line.split(/\s+/);

  // 通常 boot_time 是第三个空格分隔的字段（索引2）
  // 格式：<priority>/<tag>(<pid>): <message>
  // 或者：boot_time=xxx
  if (parts.length >= 3) {
    const thirdField = parts[2];

    // 检查是否是 boot_time=xxx 格式
  if (thirdField && thirdField.startsWith('boot_time=')) {
    const bootValue = thirdField.substring(10); // 去掉 'boot_time='
    const bootNum = parseInt(bootValue, 10);
    if (!isNaN(bootNum)) {
      return bootNum;
    }
  }

    // 尝试解析为数字
  const num = parseInt(thirdField, 10);
  if (!isNaN(num) && num > 0) {
    return num;
  }
}

  // 备用：查找 boot_time=xxx 格式
  const bootMatch = line.match(/boot_time=(\d+)/);
  if (bootMatch) {
  return parseInt(bootMatch[1], 10);
}

  return null;
}

/**
 * 解析 UTC 时间字符串
 */
function parseTime(timeStr) {
  if (!timeStr) return null;
  const normalized = timeStr.replace(' ', 'T');
  const date = new Date(normalized);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * 处理主线程发送的消息
 */
self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'init':
      // 初始化正则表达式
      timePatternUTC = new RegExp(data.timePatternUTC);
      timePattern = new RegExp(data.timePattern);
      self.postMessage({ type: 'initComplete' });
      break;

    case 'parse':
      handleParse(data);
      break;

    case 'parseLines':
      handleParseLines(data);
      break;

    default:
      console.warn('Unknown message type:', type);
  }
};

/**
 * 处理 UTC 参考点解析请求
 */
function handleParse(data) {
  const { lines, batchSize = 5000 } = data;
  const results = [];
  let processedCount = 0;
  let androidTimeCount = 0;
  let matchedCount = 0;

  const startTime = performance.now();

  function processBatch(startIndex) {
    const endIndex = Math.min(startIndex + batchSize, lines.length);

    for (let i = startIndex; i < endIndex; i++) {
      const line = lines[i];
      if (!line || line.startsWith("===")) continue;

      // 检查是否包含 android time
      if (line.includes('android time')) {
        androidTimeCount++;
      }

      // 提取 boot time
      const bootTime = extractBootTime(line);
      if (!bootTime) continue;

      let referenceDateTime = null;

      // 优先匹配带 UTC 标记的行
      let match = line.match(timePatternUTC);
      if (match) {
        matchedCount++;
        const utcTimeStr = match[1].replace(' ', 'T');
        const androidTimeStr = match[2].replace(' ', 'T');

        const utcDate = parseTime(utcTimeStr + 'Z');
        const androidDate = parseTime(androidTimeStr);

        if (utcDate && androidDate && utcDate.getUTCHours() === androidDate.getHours()) {
          referenceDateTime = androidDate;
        } else if (androidDate) {
          referenceDateTime = androidDate;
        }
      } else {
        match = line.match(timePattern);
        if (match) {
          matchedCount++;
          referenceDateTime = parseTime(match[1].replace(' ', 'T'));
        }
      }

      if (referenceDateTime) {
        results.push({
          lineIndex: i,
          bootTime: bootTime,
          utcTime: referenceDateTime.toISOString()
        });
      }
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
        results: endIndex === lines.length ? results : null // 最后一批返回完整结果
      }
    });

    // 继续处理下一批或完成
    if (endIndex < lines.length) {
      setTimeout(() => processBatch(endIndex), 0);
    } else {
      const elapsed = performance.now() - startTime;
      console.log(`[UTC Parser Worker] 完成: ${androidTimeCount} 个 android time 行, ${matchedCount} 个匹配成功, 耗时 ${elapsed.toFixed(2)}ms`);
    }
  }

  processBatch(0);
}

/**
 * 批量解析行的 UTC 时间（用于时间转换）
 * @param {Object} data
 * @param {Array} data.lines - 日志行数组
 * @param {Array} data.referencePoints - UTC 参考点 [{bootTime, utcTime}, ...]
 * @param {number} data.batchSize - 批次大小
 */
function handleParseLines(data) {
  const { lines, referencePoints, batchSize = 10000 } = data;
  const results = [];
  let processedCount = 0;

  const startTime = performance.now();

  // 预处理参考点为查找友好的格式
  const sortedRefs = [...referencePoints].sort((a, b) => a.bootTime - b.bootTime);

  function processBatch(startIndex) {
    const endIndex = Math.min(startIndex + batchSize, lines.length);

    for (let i = startIndex; i < endIndex; i++) {
      const line = lines[i];
      if (!line || line.startsWith("===")) {
        results.push({ index: i, utcTime: null, original: line });
        continue;
      }

      // 提取 boot time
      const bootTime = extractBootTime(line);
      if (bootTime === null) {
        results.push({ index: i, utcTime: null, original: line });
        continue;
      }

      // 根据 boot time 查找对应的 UTC 时间
      const utcTime = interpolateUTC(bootTime, sortedRefs);

      results.push({
        index: i,
        bootTime: bootTime,
        utcTime: utcTime ? utcTime.toISOString() : null,
        original: line
      });
    }

    processedCount = endIndex;

    // 发送进度
    const progress = (processedCount / lines.length) * 100;
    self.postMessage({
      type: 'parseProgress',
      data: {
        processed: processedCount,
        total: lines.length,
        progress: progress,
        results: endIndex === lines.length ? results : null
      }
    });

    if (endIndex < lines.length) {
      setTimeout(() => processBatch(endIndex), 0);
    } else {
      const elapsed = performance.now() - startTime;
      console.log(`[UTC Parser Worker] 解析完成: ${lines.length} 行, 耗时 ${elapsed.toFixed(2)}ms`);
    }
  }

  processBatch(0);
}

/**
 * 根据 boot time 插值计算 UTC 时间
 */
function interpolateUTC(bootTime, referencePoints) {
  if (!referencePoints || referencePoints.length === 0) return null;

  // 如果 bootTime 小于第一个参考点
  if (bootTime <= referencePoints[0].bootTime) {
    return new Date(referencePoints[0].utcTime);
  }

  // 如果 bootTime 大于等于最后一个参考点
  if (bootTime >= referencePoints[referencePoints.length - 1].bootTime) {
    return new Date(referencePoints[referencePoints.length - 1].utcTime);
  }

  // 在两个参考点之间，使用线性插值
  for (let i = 0; i < referencePoints.length - 1; i++) {
    const curr = referencePoints[i];
    const next = referencePoints[i + 1];

    if (bootTime >= curr.bootTime && bootTime < next.bootTime) {
      // 线性插值
      const ratio = (bootTime - curr.bootTime) / (next.bootTime - curr.bootTime);
      const currTime = new Date(curr.utcTime).getTime();
      const nextTime = new Date(next.utcTime).getTime();
      const interpolatedTime = currTime + ratio * (nextTime - currTime);
      return new Date(interpolatedTime);
    }
  }

  return null;
}
