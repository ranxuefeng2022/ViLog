/**
 * 文件内容处理 Worker
 * 在后台线程中处理文件内容，避免阻塞主线程
 *
 * 主要功能：
 * 1. 分割文件内容为行
 * 2. 提取 UTC 参考点
 * 3. 从文件名提取基准时间
 */

self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'processFileContent':
      handleProcessFileContent(data);
      break;

    default:
      console.warn('[File Processor Worker] Unknown message type:', type);
  }
};

/**
 * 处理文件内容
 * @param {Object} data
 * @param {string} data.content - 文件内容
 * @param {string} data.fileName - 文件名
 * @param {string} data.filePath - 文件路径（可选）
 * @param {number} data.fileTreeIndex - 文件树索引（可选）
 */
function handleProcessFileContent(data) {
  const { content, fileName, filePath, fileTreeIndex } = data;

  const startTime = performance.now();

  try {
    // 1. 从文件名提取基准时间
    const baseTimestamp = extractBaseTimestampFromFileName(fileName);

    // 2. 分割内容为行
    const lines = content.split('\n');

    // 3. 提取 UTC 参考点
    const utcReferencePoints = extractUTCReferencePoints(lines, baseTimestamp);

    const elapsed = performance.now() - startTime;

    // 4. 返回处理结果
    self.postMessage({
      type: 'fileProcessed',
      data: {
        fileName,
        filePath,
        fileTreeIndex,
        lines: lines,
        lineCount: lines.length,
        baseTimestamp,
        utcReferencePoints,
        processingTime: elapsed
      }
    });

    console.log(`[File Processor Worker] 处理完成: ${fileName}, ${lines.length} 行, 耗时 ${elapsed.toFixed(2)}ms`);
  } catch (error) {
    console.error('[File Processor Worker] 处理失败:', error);
    self.postMessage({
      type: 'error',
      data: {
        error: error.message,
        fileName
      }
    });
  }
}

/**
 * 从文件名提取基准时间
 * @param {string} fileName
 * @returns {number|null} 时间戳（毫秒）
 */
function extractBaseTimestampFromFileName(fileName) {
  // 匹配文件名中的时间戳：YYYY_MMDD_HHMMSS 或 YYYY_MMDD_HHMMSS_UTC
  const timePattern = /(\d{4})_(\d{4})_(\d{6})(?:_UTC)?$/;
  const match = fileName.match(timePattern);

  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2].substring(0, 2), 10);
    const day = parseInt(match[2].substring(2, 4), 10);
    const hour = parseInt(match[3].substring(0, 2), 10);
    const minute = parseInt(match[3].substring(2, 4), 10);
    const second = parseInt(match[3].substring(4, 6), 10);

    const localDate = new Date(year, month - 1, day, hour, minute, second);
    return localDate.getTime();
  }

  return null;
}

/**
 * 提取 UTC 参考点
 * @param {Array} lines - 日志行数组
 * @param {number|null} baseTimestamp - 基准时间戳
 * @returns {Array} UTC 参考点数组
 */
function extractUTCReferencePoints(lines, baseTimestamp) {
  const referencePoints = [];

  // 将文件名基准时间作为第一个参考点（boot_time=0）
  if (baseTimestamp !== null) {
    referencePoints.push({
      lineIndex: -1,
      bootTime: 0,
      utcTime: new Date(baseTimestamp).toISOString(),
      isFileNameBase: true
    });
  }

  // 匹配两种模式的UTC参考点
  const timePatternUTC = /(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d+)\s+UTC;android time\s+(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d+)/;
  const timePattern = /android time\s+(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("===")) continue;

    // 提取 boot time
    const bootTime = extractBootTime(line);
    if (!bootTime) continue;

    let referenceDateTime = null;

    // 优先匹配带UTC标记的行
    let match = line.match(timePatternUTC);
    if (match) {
      const androidTimeStr = match[2].replace(' ', 'T');
      referenceDateTime = new Date(androidTimeStr + 'Z');
    } else {
      // 匹配不带UTC标记的行
      match = line.match(timePattern);
      if (match) {
        referenceDateTime = new Date(match[1].replace(' ', 'T') + 'Z');
      }
    }

    if (referenceDateTime && !isNaN(referenceDateTime.getTime())) {
      referencePoints.push({
        lineIndex: i,
        bootTime: bootTime,
        utcTime: referenceDateTime.toISOString()
      });
    }
  }

  // 按boot_time排序
  referencePoints.sort((a, b) => a.bootTime - b.bootTime);

  return referencePoints;
}

/**
 * 提取 boot time（从日志行）
 * @param {string} line
 * @returns {number|null} boot time（微秒）
 */
function extractBootTime(line) {
  // 匹配格式: "3,394851,2012655346,-,caller=..."
  const match = line.match(/^(\d+),(\d+),(\d+),/);
  if (match) {
    // 将纳秒转换为微秒
    return Math.floor(parseInt(match[3], 10) / 1000);
  }
  return null;
}
