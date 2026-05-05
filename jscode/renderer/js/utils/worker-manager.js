/**
 * Worker 管理器
 * 封装 Worker 的创建和通信，提供简洁的 API
 */

window.App = window.App || {};
window.App.WorkerManager = {
  // 大数据分批阈值：超过此行数后分批发给 Worker，避免 structured clone 双倍内存
  BIG_DATA_THRESHOLD: 50000,
  BATCH_SIZE: 50000,

  // Worker 实例缓存
  workers: {
    csvParser: null,
    statsCalculator: null
  },

  // Worker 路径
  paths: {
    csvParser: './renderer/js/workers/csv-parser-worker.js',
    statsCalculator: './renderer/js/workers/stats-calculator-worker.js'
  },

  // 初始化 Worker
  init(type) {
    if (this.workers[type]) return this.workers[type];

    const path = this.paths[type];
    if (!path) {
      console.error(`[WorkerManager] Unknown worker type: ${type}`);
      return null;
    }

    try {
      this.workers[type] = new Worker(path);
      console.log(`[WorkerManager] Initialized ${type} worker`);
      return this.workers[type];
    } catch (error) {
      console.error(`[WorkerManager] Failed to initialize ${type} worker:`, error);
      return null;
    }
  },

  /**
   * 检测文件格式
   */
  async detectFormat(lines) {
    const worker = this.init('csvParser');
    if (!worker) return null;

    return new Promise((resolve) => {
      worker.postMessage({
        type: 'detectFormat',
        data: { lines, sampleSize: 100 }
      });

      worker.onmessage = (e) => {
        if (e.data.type === 'formatDetected') {
          worker.onmessage = null;
          resolve(e.data.data);
        }
      };

      worker.onerror = (error) => {
        console.error('[WorkerManager] CSV parser worker error:', error);
        resolve(null);
      };
    });
  },

  /**
   * 解析 CSV/TSV
   */
  async parseCSV(lines, onProgress) {
    const worker = this.init('csvParser');
    if (!worker) return null;

    return new Promise((resolve) => {
      worker.postMessage({
        type: 'parse',
        data: { lines, batchSize: 5000 }
      });

      let parsedData = [];

      worker.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'progress') {
          if (onProgress) onProgress(data.progress, data.processed, data.total);
          if (data.results) {
            parsedData = data.results;
          }
        } else if (type === 'complete') {
          worker.onmessage = null;
          resolve({
            success: true,
            data: parsedData
          });
        }
      };

      worker.onerror = (error) => {
        console.error('[WorkerManager] CSV parser worker error:', error);
        resolve({ success: false, error: error.message });
      };
    });
  },

  /**
   * 标准化 CSV 数据（补齐列数）
   */
  async normalizeCSV(parsedData, onProgress) {
    const worker = this.init('csvParser');
    if (!worker) return null;

    return new Promise((resolve) => {
      worker.postMessage({
        type: 'normalize',
        data: { parsedData, batchSize: 10000 }
      });

      worker.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'normalizeProgress') {
          if (onProgress) onProgress(data.progress, data.processed, data.total);
          if (data.results) {
            resolve({
              success: true,
              data: data.results,
              maxColumns: data.maxColumns
            });
          }
        }
      };

      worker.onerror = (error) => {
        console.error('[WorkerManager] CSV parser worker error:', error);
        resolve({ success: false, error: error.message });
      };
    });
  },

  /**
   * 计算列统计
   */
  async calculateColumnStats(rows, columns, onProgress) {
    const worker = this.init('statsCalculator');
    if (!worker) return null;

    return new Promise((resolve) => {
      worker.postMessage({
        type: 'columnStats',
        data: { rows, columns, batchSize: 5000 }
      });

      worker.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'statsProgress') {
          if (onProgress) onProgress(data.progress, data.processed, data.total);
          if (data.results) {
            resolve({ success: true, stats: data.results });
          }
        }
      };

      worker.onerror = (error) => {
        console.error('[WorkerManager] Stats worker error:', error);
        resolve({ success: false, error: error.message });
      };
    });
  },

  /**
   * 计算行长度统计
   */
  async calculateLineLengthStats(lines, onProgress) {
    const worker = this.init('statsCalculator');
    if (!worker) return null;

    // 大数据分批传输
    if (lines.length > this.BIG_DATA_THRESHOLD) {
      return this._batchLineLengthStats(worker, lines, onProgress);
    }

    return new Promise((resolve) => {
      worker.postMessage({
        type: 'lineLengthStats',
        data: { lines, batchSize: 10000 }
      });

      worker.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'statsProgress') {
          if (onProgress) onProgress(data.progress, data.processed, data.total);
          if (data.results) {
            resolve({ success: true, stats: data.results });
          }
        }
      };

      worker.onerror = (error) => {
        console.error('[WorkerManager] Stats worker error:', error);
        resolve({ success: false, error: error.message });
      };
    });
  },

  /**
   * 分批发送行长度统计数据到 Worker
   * @private
   */
  _batchLineLengthStats(worker, lines, onProgress) {
    return new Promise((resolve) => {
      // 使用一个对象来包装 resolve，因为 sendNextBatch 是普通函数
      const ctx = { resolve, worker, lines, onProgress, batchIndex: 0,
        allResults: null, totalBatches: Math.ceil(lines.length / this.BATCH_SIZE),
        totalLines: lines.length };

      worker.postMessage({ type: 'batchInit', data: { totalLines: lines.length } });

      function sendNextBatch() {
        if (ctx.batchIndex >= ctx.totalBatches) {
          worker.postMessage({ type: 'batchComplete' });
          return;
        }
        const start = ctx.batchIndex * 50000;
        const end = Math.min(start + 50000, ctx.lines.length);
        worker.postMessage({
          type: 'statsBatch',
          data: {
            lines: ctx.lines.slice(start, end),
            offset: start,
            batchIndex: ctx.batchIndex,
            totalBatches: ctx.totalBatches
          }
        });
        ctx.batchIndex++;
      }

      worker.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'statsReady') {
          sendNextBatch();
        } else if (type === 'statsBatchProgress') {
          if (ctx.onProgress) ctx.onProgress(data.progress, data.processed, data.total);
          if (data.results) ctx.allResults = data.results;
        } else if (type === 'statsBatchDone') {
          worker.onmessage = null;
          ctx.resolve({ success: true, stats: ctx.allResults || data.stats });
        }
      };

      worker.onerror = (error) => {
        console.error('[WorkerManager] Stats worker error:', error);
        ctx.resolve({ success: false, error: error.message });
      };
    });
  },

  /**
   * 计算日志级别统计
   */
  async calculateLogLevelStats(lines, patterns, onProgress) {
    const worker = this.init('statsCalculator');
    if (!worker) return null;

    return new Promise((resolve) => {
      worker.postMessage({
        type: 'logLevelStats',
        data: { lines, patterns, batchSize: 10000 }
      });

      worker.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'statsProgress') {
          if (onProgress) onProgress(data.progress, data.processed, data.total);
          if (data.results) {
            resolve({ success: true, stats: data.results });
          }
        }
      };

      worker.onerror = (error) => {
        console.error('[WorkerManager] Stats worker error:', error);
        resolve({ success: false, error: error.message });
      };
    });
  },

  /**
   * 计算词频统计
   */
  async calculateFrequencyStats(lines, options = {}, onProgress) {
    const worker = this.init('statsCalculator');
    if (!worker) return null;

    return new Promise((resolve) => {
      worker.postMessage({
        type: 'frequencyStats',
        data: { lines, options, batchSize: 10000 }
      });

      worker.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'frequencyStatsResult') {
          resolve({ success: true, stats: data });
        }
      };

      worker.onerror = (error) => {
        console.error('[WorkerManager] Stats worker error:', error);
        resolve({ success: false, error: error.message });
      };
    });
  },

  /**
   * 终止所有 Worker
   */
  terminateAll() {
    for (const [type, worker] of Object.entries(this.workers)) {
      if (worker) {
        worker.terminate();
        console.log(`[WorkerManager] Terminated ${type} worker`);
        this.workers[type] = null;
      }
    }
  },

  /**
   * 终止指定 Worker
   */
  terminate(type) {
    if (this.workers[type]) {
      this.workers[type].terminate();
      console.log(`[WorkerManager] Terminated ${type} worker`);
      this.workers[type] = null;
    }
  }
};

console.log('[WorkerManager] Loaded');
