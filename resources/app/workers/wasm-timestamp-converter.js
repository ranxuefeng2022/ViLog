/**
 * WebAssembly 时间戳转换管理器
 * 提供简化的 API 供主进程调用
 */

class WasmTimestampConverter {
  constructor() {
    this.worker = null;
    this.isInitialized = false;
    this.isBusy = false;
    this.progressCallback = null;
  }

  /**
   * 初始化 WASM Worker
   */
  async init() {
    if (this.isInitialized) {
      return true;
    }

    return new Promise((resolve, reject) => {
      try {
        // 创建 Worker
        this.worker = new Worker('./workers/timestamp-converter-worker.js');

        // 监听 Worker 消息
        this.worker.addEventListener('message', (e) => {
          const { type, success, data, message } = e.data;

          switch (type) {
            case 'init':
              this.isInitialized = success;
              if (success) {
                console.log('[WASM] WASM 模块初始化成功');
                resolve(true);
              } else {
                reject(new Error('WASM 初始化失败'));
              }
              break;

            case 'setReferencePoints':
              console.log(`[WASM] 参考点设置${success ? '成功' : '失败'}`);
              break;

            case 'progress':
              if (this.progressCallback) {
                this.progressCallback(data);
              }
              break;

            case 'convertBatch':
              console.log(`[WASM] 批量转换完成: ${data.convertedCount} 行转换成功`);
              this.isBusy = false;
              if (this.onComplete) {
                this.onComplete(data);
              }
              break;

            case 'cleanup':
              console.log('[WASM] 清理完成');
              break;

            case 'error':
              console.error('[WASM] 错误:', message);
              this.isBusy = false;
              if (this.onError) {
                this.onError(message);
              }
              break;
          }
        });

        // 发送初始化消息
        this.worker.postMessage({ type: 'init' });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 设置 UTC 参考点
   */
  async setReferencePoints(referencePoints) {
    if (!this.isInitialized) {
      throw new Error('WASM 未初始化，请先调用 init()');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('设置参考点超时')), 5000);

      const handler = (e) => {
        if (e.data.type === 'setReferencePoints') {
          clearTimeout(timeout);
          this.worker.removeEventListener('message', handler);
          resolve(e.data.success);
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage({
        type: 'setReferencePoints',
        data: { referencePoints }
      });
    });
  }

  /**
   * 批量转换日志行
   */
  async convertBatch(lines, options = {}) {
    if (!this.isInitialized) {
      throw new Error('WASM 未初始化，请先调用 init()');
    }

    if (this.isBusy) {
      throw new Error('WASM 正在执行转换，请稍候');
    }

    this.isBusy = true;

    const {
      startIndex = 0,
      batchSize = 10000,
      onProgress = null,
      onComplete = null,
      onError = null
    } = options;

    this.progressCallback = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.isBusy = false;
        reject(new Error('转换超时'));
      }, 300000); // 5分钟超时

      const handler = (e) => {
        if (e.data.type === 'convertBatch') {
          clearTimeout(timeout);
          this.worker.removeEventListener('message', handler);
          resolve(e.data.data);
        }
      };

      this.worker.addEventListener('message', handler);

      this.worker.postMessage({
        type: 'convertBatch',
        data: {
          lines: lines,
          startIndex: startIndex,
          batchSize: batchSize
        }
      });
    });
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.worker) {
      this.worker.postMessage({ type: 'cleanup' });
      this.worker.terminate();
      this.worker = null;
    }
    this.isInitialized = false;
    this.isBusy = false;
  }

  /**
   * 检查是否可用
   */
  isAvailable() {
    return this.isInitialized && !this.isBusy;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WasmTimestampConverter;
}

// 全局实例
if (typeof window !== 'undefined') {
  window.WasmTimestampConverter = WasmTimestampConverter;
}
