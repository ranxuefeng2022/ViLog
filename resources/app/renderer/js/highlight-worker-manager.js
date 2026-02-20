/**
 * 高亮Worker管理器
 * 管理Web Worker的生命周期，提供简单易用的API
 */

window.HighlightWorkerManager = {
  worker: null,
  taskId: 0,
  pendingTasks: new Map(),
  isInitialized: false,

  /**
   * 初始化Worker
   */
  init() {
    if (this.isInitialized) {
      return;
    }

    try {
      this.worker = new Worker('renderer/workers/highlight-worker.js');

      this.worker.addEventListener('message', (e) => {
        const { type, taskId, ...data } = e.data;

        switch (type) {
          case 'complete':
            // 任务完成
            if (this.pendingTasks.has(taskId)) {
              const { resolve } = this.pendingTasks.get(taskId);
              resolve(data);
              this.pendingTasks.delete(taskId);
            }
            break;

          case 'progress':
            // 进度更新
            if (this.pendingTasks.has(taskId)) {
              const { onProgress } = this.pendingTasks.get(taskId);
              if (onProgress) {
                onProgress(data);
              }
            }
            break;

          case 'error':
            // 任务出错
            if (this.pendingTasks.has(taskId)) {
              const { reject } = this.pendingTasks.get(taskId);
              reject(new Error(data.error));
              this.pendingTasks.delete(taskId);
            }
            break;

          case 'pong':
            // 心跳响应
            break;

          default:
            console.warn('[HighlightWorkerManager] Unknown message type:', type);
        }
      });

      this.worker.addEventListener('error', (error) => {
        console.error('[HighlightWorkerManager] Worker error:', error);
      });

      this.isInitialized = true;
      console.log('✓ HighlightWorkerManager initialized');
    } catch (error) {
      console.error('[HighlightWorkerManager] Failed to initialize worker:', error);
    }
  },

  /**
   * 批量高亮文本
   * @param {Array<string>} lines - 要高亮的文本数组
   * @param {Object} options - 高亮选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<{results: Array, time: string}>}
   */
  async highlightLines(lines, options = {}, onProgress = null) {
    if (!this.isInitialized) {
      this.init();
    }

    if (!this.worker) {
      // Worker不可用，回退到主线程
      console.warn('[HighlightWorkerManager] Worker not available, using main thread');
      return this._fallbackHighlight(lines, options);
    }

    const taskId = ++this.taskId;

    return new Promise((resolve, reject) => {
      this.pendingTasks.set(taskId, {
        resolve,
        reject,
        onProgress
      });

      this.worker.postMessage({
        type: 'highlight',
        taskId,
        lines,
        options
      });
    });
  },

  /**
   * 主线程高亮（回退方案）
   */
  _fallbackHighlight(lines, options) {
    const startTime = performance.now();

    const results = lines.map(line => {
      // 使用现有的highlightContent函数
      if (typeof highlightContent === 'function') {
        const text = highlightContent(line, options);
        return { text, hasHighlight: true };
      }
      return { text: line, hasHighlight: false };
    });

    const elapsed = performance.now() - startTime;

    return Promise.resolve({
      results,
      time: elapsed.toFixed(2)
    });
  },

  /**
   * 检查Worker是否可用
   */
  isAvailable() {
    return this.isInitialized && this.worker !== null;
  },

  /**
   * 销毁Worker
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingTasks.clear();
    this.isInitialized = false;
    console.log('✓ HighlightWorkerManager terminated');
  }
};

console.log('✓ HighlightWorkerManager module loaded');
