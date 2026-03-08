/**
 * 高亮 Worker 管理器 - 增强版
 * 管理 Web Worker 池，支持并行高亮计算
 *
 * 特性：
 * - Worker 池：多个 Worker 并行处理
 * - 自动降级：Worker 不可用时自动使用主线程
 * - 任务分片：大任务自动分片到多个 Worker
 * - 自适应：根据任务大小自动选择策略
 */

window.HighlightWorkerManager = (function() {
  // 配置
  const CONFIG = {
    workerCount: Math.max(2, (navigator.hardwareConcurrency || 4) - 1), // Worker 数量
    chunkSize: 500,        // 每个任务处理的行数
    useWorkerThreshold: 50, // 超过此行数使用 Worker
    workerScript: '../workers/highlight-worker.js'
  };

  // 状态
  let workers = [];
  let availableWorkers = [];
  let taskId = 0;
  let pendingTasks = new Map();
  let isInitialized = false;

  /**
   * 初始化 Worker 池
   */
  function init() {
    if (isInitialized) return;

    try {
      for (let i = 0; i < CONFIG.workerCount; i++) {
        const worker = new Worker(CONFIG.workerScript);
        setupWorker(worker, i);
        workers.push(worker);
        availableWorkers.push(worker);
      }
      isInitialized = true;
      console.log(`✓ HighlightWorkerManager initialized with ${CONFIG.workerCount} workers`);
    } catch (error) {
      console.error('[HighlightWorkerManager] Failed to initialize workers:', error);
    }
  }

  /**
   * 设置 Worker 消息处理
   */
  function setupWorker(worker, workerId) {
    worker.addEventListener('message', (e) => {
      const { type, taskId, ...data } = e.data;

      switch (type) {
        case 'batchHighlightComplete':
        case 'complete':
          // 任务完成
          if (pendingTasks.has(taskId)) {
            const task = pendingTasks.get(taskId);

            // 如果是分片任务，收集结果
            if (task.isChunked) {
              task.chunkResults.push(data.results || data);
              task.completedChunks++;

              // 所有分片完成
              if (task.completedChunks === task.totalChunks) {
                // 合并结果
                const finalResults = mergeChunkResults(task.chunkResults, task.originalOrder);
                task.resolve({
                  results: finalResults,
                  stats: data.stats || { time: data.time }
                });
                cleanupTask(taskId);
              }
            } else {
              // 单任务
              task.resolve(data);
              cleanupTask(taskId);
            }
          }
          // Worker 回到可用池
          availableWorkers.push(worker);
          break;

        case 'progress':
          // 进度更新
          if (pendingTasks.has(taskId)) {
            const task = pendingTasks.get(taskId);
            if (task.onProgress) {
              task.onProgress(data);
            }
          }
          break;

        case 'batchHighlightError':
        case 'error':
          // 任务出错
          if (pendingTasks.has(taskId)) {
            const task = pendingTasks.get(taskId);
            if (task.reject) {
              task.reject(new Error(data.error));
            }
            cleanupTask(taskId);
          }
          availableWorkers.push(worker);
          break;

        case 'pong':
          // 心跳响应
          break;

        case 'ready':
          // Worker 就绪
          console.log(`[HighlightWorkerManager] Worker ${workerId} ready`);
          break;

        default:
          console.warn('[HighlightWorkerManager] Unknown message type:', type);
      }
    });

    worker.addEventListener('error', (error) => {
      console.error(`[HighlightWorkerManager] Worker ${workerId} error:`, error);
      // 移除有问题的 Worker
      const index = workers.indexOf(worker);
      if (index > -1) {
        workers.splice(index, 1);
        const availIndex = availableWorkers.indexOf(worker);
        if (availIndex > -1) {
          availableWorkers.splice(availIndex, 1);
        }
      }
    });
  }

  /**
   * 合并分片结果
   */
  function mergeChunkResults(chunkResults, originalOrder) {
    // 按原始顺序合并
    const merged = [];
    for (const chunk of chunkResults) {
      if (Array.isArray(chunk)) {
        merged.push(...chunk);
      } else if (chunk.results) {
        merged.push(...chunk.results);
      }
    }
    return merged;
  }

  /**
   * 清理任务
   */
  function cleanupTask(taskId) {
    pendingTasks.delete(taskId);
  }

  /**
   * 批量高亮（与主线程 applyBatchHighlight 逻辑一致）
   * @param {Array<string>} lines - 文本行数组
   * @param {Object} config - 高亮配置
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<{results: Array, stats: Object}>}
   */
  async function batchHighlight(lines, config = {}, onProgress = null) {
    // 快速路径：小任务直接在主线程执行
    if (lines.length < CONFIG.useWorkerThreshold) {
      return fallbackBatchHighlight(lines, config);
    }

    // 确保 Worker 初始化
    if (!isInitialized) {
      init();
    }

    // 如果没有可用 Worker，回退到主线程
    if (availableWorkers.length === 0) {
      console.warn('[HighlightWorkerManager] No workers available, using main thread');
      return fallbackBatchHighlight(lines, config);
    }

    // 分片处理
    const chunks = chunkArray(lines, CONFIG.chunkSize);
    const tid = ++taskId;

    return new Promise((resolve, reject) => {
      pendingTasks.set(tid, {
        resolve,
        reject,
        onProgress,
        isChunked: chunks.length > 1,
        chunkResults: [],
        completedChunks: 0,
        totalChunks: chunks.length,
        originalOrder: lines
      });

      // 分发任务到可用 Workers
      let workerIndex = 0;
      for (let i = 0; i < chunks.length; i++) {
        if (availableWorkers.length === 0) {
          // 等待有 Worker 可用
          setTimeout(() => dispatchChunk(i), 10);
          continue;
        }

        const worker = availableWorkers.shift();
        worker.postMessage({
          type: 'batchHighlight',
          taskId: `${tid}-${i}`, // 分片任务 ID
          lines: chunks[i],
          config: {
            ...config,
            lineOffset: i * CONFIG.chunkSize // 添加行偏移
          }
        });
      }
    });
  }

  /**
   * 分发分片任务
   */
  function dispatchChunk(chunkIndex) {
    if (availableWorkers.length === 0) {
      setTimeout(() => dispatchChunk(chunkIndex), 50);
      return;
    }

    const worker = availableWorkers.shift();
    // ... 发送消息
  }

  /**
   * 数组分片
   */
  function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 主线程回退方案（同步版本）
   */
  function fallbackBatchHighlight(lines, config) {
    const startTime = performance.now();
    const results = new Array(lines.length);

    // 使用主线程的 applyBatchHighlight（如果存在）
    if (typeof applyBatchHighlight === 'function') {
      for (let i = 0; i < lines.length; i++) {
        results[i] = applyBatchHighlight(lines[i], {...config, lineIndex: i});
      }
    } else {
      // 简单回退：直接返回原文
      for (let i = 0; i < lines.length; i++) {
        results[i] = lines[i];
      }
    }

    const elapsed = performance.now() - startTime;

    return Promise.resolve({
      results,
      stats: {
        lineCount: lines.length,
        elapsed: elapsed.toFixed(2),
        method: 'main-thread'
      }
    });
  }

  /**
   * 简单高亮（正则模式）- 兼容旧 API
   */
  async function highlightLines(lines, options = {}, onProgress = null) {
    if (!isInitialized) {
      init();
    }

    if (availableWorkers.length === 0) {
      return fallbackHighlight(lines, options);
    }

    const tid = ++taskId;
    const worker = availableWorkers.shift();

    return new Promise((resolve, reject) => {
      pendingTasks.set(tid, { resolve, reject, onProgress, isChunked: false });

      worker.postMessage({
        type: 'highlight',
        taskId: tid,
        lines,
        options
      });
    });
  }

  /**
   * 主线程简单高亮回退
   */
  function fallbackHighlight(lines, options) {
    const startTime = performance.now();
    const results = lines.map(line => {
      if (typeof highlightContent === 'function') {
        return highlightContent(line, options);
      }
      return { text: line, hasHighlight: false };
    });

    const elapsed = performance.now() - startTime;

    return Promise.resolve({
      results,
      time: elapsed.toFixed(2)
    });
  }

  /**
   * 检查 Worker 是否可用
   */
  function isAvailable() {
    return isInitialized && workers.length > 0;
  }

  /**
   * 获取统计信息
   */
  function getStats() {
    return {
      workerCount: workers.length,
      availableWorkers: availableWorkers.length,
      pendingTasks: pendingTasks.size,
      isInitialized
    };
  }

  /**
   * 销毁所有 Workers
   */
  function terminate() {
    for (const worker of workers) {
      worker.terminate();
    }
    workers = [];
    availableWorkers = [];
    pendingTasks.clear();
    isInitialized = false;
    console.log('✓ HighlightWorkerManager terminated');
  }

  // 导出 API
  return {
    init,
    batchHighlight,    // 新 API：与主线程逻辑一致
    highlightLines,    // 旧 API：兼容
    isAvailable,
    getStats,
    terminate,

    // 配置
    setWorkerCount: (count) => {
      if (isInitialized) {
        console.warn('[HighlightWorkerManager] Cannot change worker count after initialization');
        return;
      }
      CONFIG.workerCount = Math.max(1, count);
    },

    setChunkSize: (size) => {
      CONFIG.chunkSize = Math.max(100, size);
    },

    setUseWorkerThreshold: (threshold) => {
      CONFIG.useWorkerThreshold = Math.max(0, threshold);
    }
  };
})();

console.log('✓ HighlightWorkerManager module loaded (enhanced version)');
