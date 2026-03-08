/**
 * Worker 管理器
 * 封装 Worker 的创建和通信，提供简洁的 API
 */

window.App = window.App || {};
window.App.WorkerManager = {
  // Worker 实例缓存
  workers: {
    utcParser: null,
    csvParser: null,
    statsCalculator: null
  },

  // Worker 路径
  paths: {
    utcParser: './renderer/js/workers/utc-parser-worker.js',
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
   * UTC 时间解析 Worker
   */
  async parseUTCReferencePoints(lines, onProgress) {
    const worker = this.init('utcParser');
    if (!worker) return null;

    return new Promise((resolve) => {
      const patterns = {
        timePatternUTC: /(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d+)\s+UTC;android time\s+(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d+)/,
        timePattern: /android time\s+(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d+)/
      };

      worker.postMessage({
        type: 'parse',
        data: {
          lines,
          batchSize: 5000
        }
      });

      let results = [];

      worker.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'progress') {
          if (onProgress) onProgress(data.progress, data.processed, data.total);
          if (data.results) {
            results = data.results;
          }
        } else if (type === 'complete') {
          worker.onmessage = null;
          resolve({
            success: true,
            results,
            stats: data
          });
        }
      };

      worker.onerror = (error) => {
        console.error('[WorkerManager] UTC parser worker error:', error);
        resolve({ success: false, error: error.message });
      };
    });
  },

  /**
   * 解析日志行的 UTC 时间（使用参考点）
   */
  async parseLinesUTC(lines, referencePoints, onProgress) {
    const worker = this.init('utcParser');
    if (!worker) return null;

    return new Promise((resolve) => {
      worker.postMessage({
        type: 'parseLines',
        data: {
          lines,
          referencePoints,
          batchSize: 10000
        }
      });

      let results = [];

      worker.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'parseProgress') {
          if (onProgress) onProgress(data.progress, data.processed, data.total);
          if (data.results) {
            results = data.results;
          }
        }
      };

      const checkComplete = setInterval(() => {
        if (worker.onmessage === null) {
          clearInterval(checkComplete);
          resolve({ success: true, results });
        }
      }, 100);

      // 超时处理
      setTimeout(() => {
        clearInterval(checkComplete);
        if (results.length > 0) {
          resolve({ success: true, results });
        } else {
          resolve({ success: false, error: 'Timeout' });
        }
      }, 60000);
    });
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
