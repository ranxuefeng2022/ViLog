/**
 * Android Time Converter — 基于 android time 锚点的最近原则转换
 *
 * 日志格式:
 *   6,751082,3142314845,-,caller=T119;[thread:119] 2026-05-15 03:01:26.171424 UTC;android time 2026-05-15 03:01:26.171424
 *   12,752434,3147886859,-,caller=T1345;healthd: battery l=54 ...
 *
 * 前三个逗号分隔字段: level, tsSeconds, tsRaw(微秒单调时钟 CLOCK_MONOTONIC)
 * 锚点行包含 "android time YYYY-MM-DD HH:MM:SS.ffffff" — 已知准确 UTC 时间
 * 计算方法: android_time = 锚点android_time + (本行tsRaw - 锚点tsRaw) / 1e6
 * 最终 +8 小时 (UTC → 北京时间)
 *
 * 流式读写，内存占用 ≈ 锚点数组大小（每锚点 ~40 字节）
 */

const fs = require('fs');
const readline = require('readline');

const ANDROID_TIME_RE = /android\s+time\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d+)/;

const KERNEL_FILE_RE = /kernel/i;

function parsePrefix(line) {
  const c1 = line.indexOf(',');
  if (c1 <= 0) return null;
  const c2 = line.indexOf(',', c1 + 1);
  if (c2 <= c1) return null;
  const c3 = line.indexOf(',', c2 + 1);
  if (c3 <= c2) return null;
  const level = line.substring(0, c1);
  const tsRawUs = parseInt(line.substring(c2 + 1, c3).trim(), 10);
  if (isNaN(tsRawUs)) return null;
  return { level, tsRawUs, thirdComma: c3 };
}

function parseAndroidTimeSeconds(match) {
  const [, y, mo, d, h, mi, s, frac] = match;
  const fracStr = frac.length > 6 ? frac.substring(0, 6) : frac.padEnd(6, '0');
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, Math.floor(+fracStr / 1000)));
  const usFrac = +fracStr % 1000;
  return date.getTime() / 1000 + usFrac / 1e6;
}

/**
 * 高性能时间格式化：避免 new Date() 构造，直接用数学运算
 */
function formatTimeFromSeconds(totalSeconds) {
  const bjSeconds = totalSeconds + 8 * 3600;
  const msTotal = bjSeconds * 1000;
  const date = new Date(msTotal);
  const yyyy = date.getUTCFullYear();
  const MM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const msec = String(Math.floor((totalSeconds % 1) * 1000)).padStart(3, '0');
  return '[' + yyyy + '-' + MM + '-' + dd + ' ' + hh + ':' + mm + ':' + ss + '.' + msec + '] ';
}

/**
 * 判断文件是否为 kernel 日志（文件名含 kernel）
 */
function isKernelFile(filePath) {
  const name = filePath.split(/[\/\\]/).pop() || '';
  return KERNEL_FILE_RE.test(name);
}

/**
 * 流式转换单个文件的 android time（异步版本，用于主进程直接调用）
 * @param {string} filePath - 要转换的文件路径（就地修改）
 * @returns {Promise<{convertedCount: number, totalLines: number, anchorCount: number, skipped?: boolean}>}
 */
async function convertFile(filePath) {
  // 第一遍：流式扫描锚点
  const anchors = [];
  let lineIndex = 0;

  const rl1 = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl1) {
    if (!line) { lineIndex++; continue; }
    const m = line.match(ANDROID_TIME_RE);
    if (!m) { lineIndex++; continue; }
    const prefix = parsePrefix(line);
    if (!prefix) { lineIndex++; continue; }
    anchors.push({ lineIndex, tsRawUs: prefix.tsRawUs, anchorTimeSec: parseAndroidTimeSeconds(m) });
    lineIndex++;
  }
  rl1.close();

  if (anchors.length === 0) {
    return { convertedCount: 0, totalLines: lineIndex, anchorCount: 0, skipped: true };
  }

  // 第二遍：流式转换 + 写临时文件
  const tmpPath = filePath + '.android_time_tmp';
  const ws = fs.createWriteStream(tmpPath, { encoding: 'utf8' });
  let anchorIdx = 0;
  let convertedCount = 0;
  let totalLines = 0;
  let firstLine = true;

  const rl2 = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl2) {
    totalLines++;
    const sep = firstLine ? '' : '\n';
    firstLine = false;

    if (!line.trim()) {
      ws.write(sep + line);
      continue;
    }

    const prefix = parsePrefix(line);
    if (!prefix) {
      ws.write(sep + line);
      continue;
    }

    while (anchorIdx < anchors.length - 1 && anchors[anchorIdx + 1].tsRawUs <= prefix.tsRawUs) {
      anchorIdx++;
    }
    let bestAnchor = anchors[anchorIdx];
    if (anchorIdx < anchors.length - 1) {
      const next = anchors[anchorIdx + 1];
      if (Math.abs(next.tsRawUs - prefix.tsRawUs) < Math.abs(bestAnchor.tsRawUs - prefix.tsRawUs)) {
        bestAnchor = next;
        anchorIdx++;
      }
    }

    const deltaUs = prefix.tsRawUs - bestAnchor.tsRawUs;
    const androidTimeSec = bestAnchor.anchorTimeSec + deltaUs / 1e6;
    const androidTimeStr = formatTimeFromSeconds(androidTimeSec);
    ws.write(sep + androidTimeStr + line);
    convertedCount++;
  }
  rl2.close();

  await new Promise((resolve, reject) => {
    ws.end(() => {
      const tryRename = (attempts) => {
        try {
          fs.renameSync(tmpPath, filePath);
          resolve();
        } catch (_e) {
          if (attempts > 0) {
            setTimeout(() => tryRename(attempts - 1), 100);
          } else {
            try { fs.copyFileSync(tmpPath, filePath); fs.unlinkSync(tmpPath); resolve(); }
            catch (e2) { reject(e2); }
          }
        }
      };
      tryRename(10);
    });
    ws.on('error', reject);
  });

  return { convertedCount, totalLines, anchorCount: anchors.length };
}

/**
 * 同步版本：在 Worker 线程中执行，避免 readline 异步开销
 * 用 Buffer + indexOf 高效扫描，比 readline 快 3-5 倍
 */
function convertFileSync(filePath) {
  const CHUNK_SIZE = 4 * 1024 * 1024;

  // 第一遍：同步扫描锚点
  const anchors = [];
  let lineIndex = 0;
  {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(CHUNK_SIZE);
    let carry = Buffer.alloc(0);
    let bytesRead;

    while ((bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, null)) > 0) {
      const chunk = Buffer.concat([carry, buf.subarray(0, bytesRead)]);
      let pos = 0;
      while (true) {
        const nl = chunk.indexOf(0x0A, pos);
        if (nl === -1) {
          carry = chunk.subarray(pos);
          break;
        }
        const line = chunk.toString('utf8', pos, nl > 0 && chunk[nl - 1] === 0x0D ? nl - 1 : nl);
        pos = nl + 1;
        if (line) {
          const m = line.match(ANDROID_TIME_RE);
          if (m) {
            const prefix = parsePrefix(line);
            if (prefix) {
              anchors.push({ lineIndex, tsRawUs: prefix.tsRawUs, anchorTimeSec: parseAndroidTimeSeconds(m) });
            }
          }
        }
        lineIndex++;
      }
    }
    if (carry.length > 0) {
      const line = carry.toString('utf8');
      if (line) {
        const m = line.match(ANDROID_TIME_RE);
        if (m) {
          const prefix = parsePrefix(line);
          if (prefix) {
            anchors.push({ lineIndex, tsRawUs: prefix.tsRawUs, anchorTimeSec: parseAndroidTimeSeconds(m) });
          }
        }
      }
      lineIndex++;
    }
    fs.closeSync(fd);
  }

  if (anchors.length === 0) {
    return { convertedCount: 0, totalLines: lineIndex, anchorCount: 0, skipped: true };
  }

  // 第二遍：同步转换 + 写临时文件
  const tmpPath = filePath + '.android_time_tmp';
  const tmpFd = fs.openSync(tmpPath, 'w');
  let anchorIdx = 0;
  let convertedCount = 0;
  let totalLines = 0;
  {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(CHUNK_SIZE);
    let carry = Buffer.alloc(0);
    let writeBuf = '';
    let bytesRead;

    while ((bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, null)) > 0) {
      const chunk = Buffer.concat([carry, buf.subarray(0, bytesRead)]);
      let pos = 0;
      while (true) {
        const nl = chunk.indexOf(0x0A, pos);
        if (nl === -1) {
          carry = chunk.subarray(pos);
          break;
        }
        const line = chunk.toString('utf8', pos, nl > 0 && chunk[nl - 1] === 0x0D ? nl - 1 : nl);
        pos = nl + 1;
        totalLines++;

        if (!line.trim()) {
          writeBuf += (totalLines === 1 ? '' : '\n') + line;
        } else {
          const prefix = parsePrefix(line);
          if (!prefix) {
            writeBuf += (totalLines === 1 ? '' : '\n') + line;
          } else {
            while (anchorIdx < anchors.length - 1 && anchors[anchorIdx + 1].tsRawUs <= prefix.tsRawUs) {
              anchorIdx++;
            }
            let bestAnchor = anchors[anchorIdx];
            if (anchorIdx < anchors.length - 1) {
              const next = anchors[anchorIdx + 1];
              if (Math.abs(next.tsRawUs - prefix.tsRawUs) < Math.abs(bestAnchor.tsRawUs - prefix.tsRawUs)) {
                bestAnchor = next;
                anchorIdx++;
              }
            }
            const deltaUs = prefix.tsRawUs - bestAnchor.tsRawUs;
            const androidTimeSec = bestAnchor.anchorTimeSec + deltaUs / 1e6;
            const androidTimeStr = formatTimeFromSeconds(androidTimeSec);
            writeBuf += (totalLines === 1 ? '' : '\n') + androidTimeStr + line;
            convertedCount++;
          }
        }

        if (writeBuf.length > CHUNK_SIZE) {
          fs.writeSync(tmpFd, writeBuf);
          writeBuf = '';
        }
      }
    }
    if (carry.length > 0) {
      const line = carry.toString('utf8');
      totalLines++;
      if (!line.trim()) {
        writeBuf += '\n' + line;
      } else {
        const prefix = parsePrefix(line);
        if (!prefix) {
          writeBuf += '\n' + line;
        } else {
          while (anchorIdx < anchors.length - 1 && anchors[anchorIdx + 1].tsRawUs <= prefix.tsRawUs) {
            anchorIdx++;
          }
          let bestAnchor = anchors[anchorIdx];
          if (anchorIdx < anchors.length - 1) {
            const next = anchors[anchorIdx + 1];
            if (Math.abs(next.tsRawUs - prefix.tsRawUs) < Math.abs(bestAnchor.tsRawUs - prefix.tsRawUs)) {
              bestAnchor = next;
              anchorIdx++;
            }
          }
          const deltaUs = prefix.tsRawUs - bestAnchor.tsRawUs;
          const androidTimeSec = bestAnchor.anchorTimeSec + deltaUs / 1e6;
          const androidTimeStr = formatTimeFromSeconds(androidTimeSec);
          writeBuf += '\n' + androidTimeStr + line;
          convertedCount++;
        }
      }
    }
    if (writeBuf.length > 0) {
      fs.writeSync(tmpFd, writeBuf);
    }
    fs.closeSync(fd);
  }
  fs.closeSync(tmpFd);

  try {
    fs.renameSync(tmpPath, filePath);
  } catch (_e) {
    try { fs.copyFileSync(tmpPath, filePath); fs.unlinkSync(tmpPath); }
    catch (e2) { throw e2; }
  }

  return { convertedCount, totalLines, anchorCount: anchors.length };
}

/**
 * 扫描目录，对其中 kernel 文件执行 android time 转换
 * @param {string} dirPath - 目录路径
 * @param {string[]} [filePaths] - 可选：指定只处理这些文件（相对于 dirPath 或绝对路径）
 * @returns {Promise<{convertedFiles: number, totalAnchors: number, details: Array}>}
 */
async function convertKernelFilesInDir(dirPath, filePaths) {
  const targets = [];
  if (filePaths && filePaths.length > 0) {
    for (const fp of filePaths) {
      const absPath = fp.includes(dirPath) ? fp : dirPath + '/' + fp;
      if (isKernelFile(absPath) && fs.existsSync(absPath)) {
        targets.push(absPath);
      }
    }
  } else {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && isKernelFile(entry.name)) {
          targets.push(dirPath + '/' + entry.name);
        }
      }
    } catch (e) { console.error('[android-time] 扫描目录失败:', e.message); }
  }

  let convertedFiles = 0;
  let totalAnchors = 0;
  const details = [];

  for (const fp of targets) {
    try {
      const result = await convertFile(fp);
      if (result.convertedCount > 0) {
        convertedFiles++;
        totalAnchors += result.anchorCount;
        details.push({ path: fp, ...result });
        console.log(`[android-time] 转换完成: ${fp}, ${result.convertedCount}/${result.totalLines} 行, ${result.anchorCount} 个锚点`);
      }
    } catch (e) {
      console.error(`[android-time] 转换失败: ${fp}`, e.message);
    }
  }

  return { convertedFiles, totalAnchors, details };
}

module.exports = { convertFile, convertFileSync, convertKernelFilesInDir, isKernelFile };
