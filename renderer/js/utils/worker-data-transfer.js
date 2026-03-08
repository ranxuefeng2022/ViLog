/**
 * Worker 数据传输优化模块
 * 使用 Transferable Objects 和 SharedArrayBuffer 实现零拷贝/低延迟数据传输
 */

(function() {
  'use strict';

  /**
   * 高效的数据打包/解包工具
   */
  const WorkerDataTransfer = {
    /**
     * 将日志行数组转换为高效的传输格式
     * @param {Array<string>} lines 日志行数组
     * @returns {Object} 传输对象
     */
    packLines: function(lines) {
      // 估算所需空间
      let totalLength = 0;
      for (let i = 0; i < lines.length; i++) {
        totalLength += lines[i].length + 1; // +1 用于分隔符
      }

      // 使用 Uint16Array 存储字符（支持大部分 Unicode）
      // 如果需要完整 Unicode 支持，使用 Uint32Array
      const charArray = new Uint32Array(totalLength);
      const lineOffsets = new Uint32Array(lines.length + 1);
      const lineLengths = new Uint32Array(lines.length);

      let offset = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        lineOffsets[i] = offset;
        lineLengths[i] = line.length;

        for (let j = 0; j < line.length; j++) {
          charArray[offset++] = line.charCodeAt(j);
        }
      }
      lineOffsets[lines.length] = offset;

      return {
        charArray,
        lineOffsets,
        lineLengths,
        totalLength: offset,
        // 可选：标记原始数据的字节长度，用于解码
        metadata: {
          lineCount: lines.length,
          totalChars: offset,
          encoding: 'UTF-32'
        }
      };
    },

    /**
     * 从传输格式解码日志行
     * @param {Object} data 传输对象
     * @returns {Array<string>} 日志行数组
     */
    unpackLines: function(data) {
      const { charArray, lineOffsets, lineLengths } = data;
      const lines = new Array(lineLengths.length);

      for (let i = 0; i < lineLengths.length; i++) {
        const start = lineOffsets[i];
        const len = lineLengths[i];
        let result = '';

        // 高效的字符串构建
        for (let j = 0; j < len; j++) {
          result += String.fromCharCode(charArray[start + j]);
        }

        lines[i] = result;
      }

      return lines;
    },

    /**
     * 将匹配结果打包为 Int32Array
     * @param {Array<number>} indices 匹配的索引数组
     * @returns {Int32Array}
     */
    packIndices: function(indices) {
      return new Int32Array(indices);
    },

    /**
     * 将字节数组打包为 Uint8Array（用于二进制数据传输）
     * @param {Array<number>} bytes 字节值数组
     * @returns {Uint8Array}
     */
    packBytes: function(bytes) {
      return new Uint8Array(bytes);
    },

    /**
     * 使用 SharedArrayBuffer 创建共享内存区域
     * @param {number} byteLength 字节长度
     * @returns {SharedArrayBuffer}
     */
    createSharedBuffer: function(byteLength) {
      if (typeof SharedArrayBuffer !== 'undefined') {
        return new SharedArrayBuffer(byteLength);
      }
      return null; // 不支持
    },

    /**
     * 从 SharedArrayBuffer 创建视图
     * @param {SharedArrayBuffer} buffer 共享缓冲区
     * @param {string} type 视图类型 ('int32' | 'float64' | 'uint8')
     * @param {number} byteOffset 字节偏移
     * @param {number} length 长度
     * @returns {TypedArray}
     */
    createView: function(buffer, type = 'int32', byteOffset = 0, length) {
      switch (type) {
        case 'int32':
          return new Int32Array(buffer, byteOffset, length);
        case 'float64':
          return new Float64Array(buffer, byteOffset, length);
        case 'uint8':
          return new Uint8Array(buffer, byteOffset, length);
        case 'uint32':
          return new Uint32Array(buffer, byteOffset, length);
        default:
          return new Int32Array(buffer, byteOffset, length);
      }
    },

    /**
     * 创建可转移的缓冲区对象
     * @param {number} size 大小（字节）
     * @returns {Object}
     */
    createTransferableBuffer: function(size) {
      const buffer = new ArrayBuffer(size);
      const uint8View = new Uint8Array(buffer);

      return {
        buffer,
        uint8View,
        getTransferable: function() {
          return [buffer];
        },
        getSize: function() {
          return size;
        }
      };
    },

    /**
     * 分块传输大数组
     * @param {Array} data 原始数据
     * @param {number} chunkSize 块大小
     * @param {Function} onChunk 块处理回调 (chunk, index) => void
     */
    streamChunks: function(data, chunkSize, onChunk) {
      const totalChunks = Math.ceil(data.length / chunkSize);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, data.length);
        const chunk = data.slice(start, end);
        onChunk(chunk, i, totalChunks);
      }
    },

    /**
     * 估算数据传输时间
     * @param {number} bytes 字节数
     * @param {number} speedMbps 传输速度（Mbps）
     * @returns {number} 估算时间（毫秒）
     */
    estimateTransferTime: function(bytes, speedMbps = 1000) {
      // speedMbps 是理论最大值，实际会更低
      const bits = bytes * 8;
      const mbits = bits / 1000000;
      return (mbits / speedMbps) * 1000;
    },

    /**
     * 优化的批量消息发送
     * @param {Worker} worker Worker 实例
     * @param {Object} message 消息内容
     * @param {Array} transferables 可转移对象列表
     */
    postMessage: function(worker, message, transferables = []) {
      // 如果有 Transferable Objects，使用它们
      if (transferables.length > 0) {
        worker.postMessage(message, transferables);
      } else {
        worker.postMessage(message);
      }
    },

    /**
     * 创建消息端口对（用于复杂的 Worker 通信）
     * @returns {MessagePort[]}
     */
    createMessageChannel: function() {
      if (typeof MessageChannel !== 'undefined') {
        const channel = new MessageChannel();
        return [channel.port1, channel.port2];
      }
      return [null, null];
    }
  };

  /**
   * Worker 通信管理器
   */
  const WorkerManager = {
    workers: new Map(),
    workerPool: [],
    maxWorkers: navigator.hardwareConcurrency || 4,

    /**
     * 初始化 Worker 池
     * @param {string} workerPath Worker 脚本路径
     * @param {number} count Worker 数量
     * @returns {Promise<Array<Worker>>}
     */
    initPool: function(workerPath, count) {
      const workers = [];

      for (let i = 0; i < count; i++) {
        const worker = new Worker(workerPath);
        workers.push(worker);
        this.workers.set(worker, { status: 'idle', task: null });
      }

      this.workerPool = workers;
      return workers;
    },

    /**
     * 获取空闲 Worker
     * @returns {Worker|null}
     */
    getIdleWorker: function() {
      for (const [worker, info] of this.workers) {
        if (info.status === 'idle') {
          return worker;
        }
      }
      return null;
    },

    /**
     * 分配任务到 Worker
     * @param {Worker} worker Worker 实例
     * @param {Object} task 任务数据
     * @returns {Promise}
     */
    assignTask: function(worker, task) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Task timeout'));
        }, 30000); // 30秒超时

        const originalOnmessage = worker.onmessage;

        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.onmessage = originalOnmessage;
          resolve(e.data);
        };

        worker.onerror = (e) => {
          clearTimeout(timeout);
          worker.onmessage = originalOnmessage;
          reject(e.error);
        };

        worker.postMessage(task.data, task.transferables || []);
      });
    },

    /**
     * 批量并行处理
     * @param {Array} tasks 任务数组
     * @param {Function} taskCreator 任务创建函数 (data, index) => Object
     * @returns {Promise<Array>}
     */
    processParallel: async function(tasks, taskCreator) {
      const results = [];
      const workers = this.workerPool;

      // 并行启动所有任务
      const promises = tasks.map((data, index) => {
        const worker = this.getIdleWorker();
        if (!worker) {
          // 没有可用 Worker，串行处理
          return taskCreator(data, index).then(task => {
            return this.assignTask(worker, task);
          });
        }

        const task = taskCreator(data, index);
        return this.assignTask(worker, task);
      });

      return Promise.all(promises);
    },

    /**
     * 终止所有 Worker
     */
    terminateAll: function() {
      for (const worker of this.workers.keys()) {
        worker.terminate();
      }
      this.workers.clear();
      this.workerPool = [];
    },

    /**
     * 获取 Worker 池状态
     */
    getStatus: function() {
      let idle = 0;
      let busy = 0;

      for (const info of this.workers.values()) {
        if (info.status === 'idle') idle++;
        else busy++;
      }

      return {
        total: this.workers.size,
        idle,
        busy,
        utilization: this.workers.size > 0 ? (busy / this.workers.size * 100).toFixed(1) + '%' : '0%'
      };
    }
  };

  // 导出到全局
  window.App = window.App || {};
  window.App.WorkerDataTransfer = WorkerDataTransfer;
  window.App.WorkerManager = WorkerManager;

  console.log('✓ Worker Data Transfer module loaded');
})();
