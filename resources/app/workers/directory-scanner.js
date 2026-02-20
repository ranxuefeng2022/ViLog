/**
 * directory-scanner.js - Worker 线程：扫描指定驱动器下的目录树
 * 用法: new Worker('./workers/directory-scanner.js', { workerData: { drivePath, folderName, maxDepth } })
 */

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

const { drivePath, folderName, maxDepth } = workerData;

// 广度优先扫描目录树
function scanDirectory(rootPath, targetName, depth) {
  const matches = [];
  let dirsScanned = 0;
  const MAX_DIRS = 10000; // 单个 Worker 最多扫描 10000 个目录

  // 队列：[路径, 当前深度]
  const queue = [{ path: rootPath, depth: 0 }];

  while (queue.length > 0 && dirsScanned < MAX_DIRS) {
    const { path: currentPath, depth: currentDepth } = queue.shift();

    if (!fs.existsSync(currentPath)) {
      continue;
    }

    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const entryPath = path.join(currentPath, entry.name);
        dirsScanned++;

        // 检查是否匹配目标文件夹名
        if (entry.name === targetName) {
          matches.push(entryPath);
        }

        // 如果深度未达上限，将子目录加入队列
        if (currentDepth < depth) {
          queue.push({ path: entryPath, depth: currentDepth + 1 });
        }

        if (dirsScanned >= MAX_DIRS) {
          break;
        }
      }
    } catch (e) {
      // 忽略无权限访问等错误
    }
  }

  return { matches, dirsScanned };
}

// 执行扫描并返回结果
try {
  const result = scanDirectory(drivePath, folderName, maxDepth);
  parentPort.postMessage({
    success: true,
    drive: drivePath,
    matches: result.matches,
    dirsScanned: result.dirsScanned
  });
} catch (error) {
  parentPort.postMessage({
    success: false,
    drive: drivePath,
    error: error.message
  });
}
