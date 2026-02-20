/**
 * 共享过滤管理器 (SharedFilterManager)
 * 使用SharedWorker实现多窗口共享Worker池
 * 所有窗口共享8个Worker，大幅降低内存占用
 */

class SharedFilterManager {
  constructor() {
    this.sharedWorker = null;
    this.port = null;
    this.clientId = null;
    this.isConnected = false;
    this.sessionId = 0;
    this.isProcessing = false;

    // 结果收集
    this.results = [];
    this.completedChunks = 0;
    this.totalChunks = 0;

    // 统计
    this.startTime = 0;
    this.totalProcessed = 0;
    this.totalMatched = 0;
    this.totalLines = 0;

    // 回调
    this.onProgress = null;
    this.onComplete = null;
    this.onChunkComplete = null;

    // 心跳定时器
    this.heartbeatInterval = null;

    // 重连尝试
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
  }

  /**
   * 初始化SharedWorker连接
   */
  init() {
    if (this.isConnected) {
      console.log('[SharedFilter] 已连接，复用连接');
      return true;
    }

    try {
      console.log('[SharedFilter] 正在连接到SharedWorker...');

      // 🚀 尝试多个可能的路径
      const possiblePaths = [
        'renderer/workers/shared-filter-worker.js',
        './renderer/workers/shared-filter-worker.js',
        '../workers/shared-filter-worker.js',
        './workers/shared-filter-worker.js',
        'shared-filter-worker.js'
      ];

      let sharedWorkerCreated = false;
      let lastError = null;

      for (const path of possiblePaths) {
        try {
          console.log(`[SharedFilter] 尝试创建SharedWorker: ${path}`);

          // 创建SharedWorker
          this.sharedWorker = new SharedWorker(path);

          // 获取端口
          this.port = this.sharedWorker.port;

          // 监听消息
          this.port.onmessage = (e) => {
            console.log(`[SharedFilter] 收到消息:`, e.data);
            this.handleMessage(e.data);
          };

          // 监听错误
          this.port.onerror = (error) => {
            console.error(`[SharedFilter] 端口错误 (${path}):`, error);
          };

          // 启动端口
          this.port.start();

          console.log(`[SharedFilter] ✓ SharedWorker创建成功，使用路径: ${path}`);
          console.log(`[SharedFilter] 💡 提示：SharedWorker有独立的控制台，需在chrome://workers查看`);
          sharedWorkerCreated = true;
          break; // 成功，跳出循环
        } catch (error) {
          lastError = error;
          console.log(`[SharedFilter] ✗ 路径失败: ${path} - ${error.message}`);
        }
      }

      if (!sharedWorkerCreated) {
        throw new Error(`所有路径都失败，最后错误: ${lastError?.message || '未知错误'}`);
      }

      return true;

    } catch (error) {
      console.error('[SharedFilter] SharedWorker初始化失败:', error);

      // 回退到普通Worker模式
      console.warn('[SharedFilter] 回退到普通Worker模式');
      this.fallbackToRegularWorkers();

      return false;
    }
  }

  /**
   * 处理来自SharedWorker的消息
   */
  handleMessage(data) {
    const { type, clientId, workerCount, workerIndex, chunkIndex, results, stats, progress } = data;

    switch (type) {
      case 'connected':
        console.log(`[SharedFilter] ✓ 已连接到SharedWorker (客户端ID: ${clientId}, Worker数: ${workerCount})`);

        // 🚀 检查Worker数是否有效
        if (!workerCount || workerCount === 0) {
          console.error('[SharedFilter] Worker池初始化失败（Worker数为0），回退到普通Worker模式');
          this.cleanup();
          this.fallbackToRegularWorkers();
          return;
        }

        this.clientId = clientId;
        this.isConnected = true;
        this.totalChunks = workerCount;
        this.reconnectAttempts = 0; // 重置重连计数
        break;

      case 'progress':
        this.handleProgress(workerIndex, chunkIndex, progress);
        break;

      case 'complete':
        this.handleComplete(workerIndex, chunkIndex, results, stats);
        break;

      case 'cancelled':
        console.log(`[SharedFilter] Worker ${workerIndex} 已取消`);
        break;

      case 'pong':
        // 心跳响应
        break;

      default:
        console.warn(`[SharedFilter] 未知消息类型: ${type}`);
    }
  }

  /**
   * 处理进度更新
   * 🚀 修复：防止百分比超过100%
   */
  handleProgress(workerIndex, chunkIndex, progress) {
    // 更新统计
    this.totalProcessed += progress.processed;
    this.totalMatched = progress.matched;

    // 计算总体进度，限制不超过100%
    const totalLines = this.totalLines || 1;
    let percentage = (this.totalProcessed / totalLines * 100);
    percentage = Math.min(100, Math.max(0, percentage)).toFixed(1); // 限制在0-100范围

    // 调用进度回调
    if (this.onProgress) {
      this.onProgress({
        processed: this.totalProcessed,
        total: totalLines,
        matched: this.totalMatched,
        percentage: percentage
      });
    }
  }

  /**
   * 处理块完成
   */
  handleComplete(workerIndex, chunkIndex, results, stats) {
    console.log(`[SharedFilter] Worker ${workerIndex} 完成块 ${chunkIndex}: ${stats.matchedCount} 个匹配`);

    // results 现在是 Int32Array，需要转换为普通数组
    const resultArray = Array.from(results);

    // 保存原始结果
    this.results[chunkIndex] = resultArray;
    this.completedChunks++;

    // 🎯 增量归并：将新结果插入到已有结果中
    const mergedResults = this.incrementalMerge(resultArray);
    this.totalMatched = mergedResults.length;

    console.log(`[SharedFilter] 增量归并完成: ${mergedResults.length} 个匹配 (${this.completedChunks}/${this.totalChunks} 块)`);

    // 更新进度
    if (this.onProgress) {
      let percentage = (this.completedChunks / this.totalChunks * 100);
      percentage = Math.min(100, Math.max(0, percentage)).toFixed(1); // 限制在0-100范围
      this.onProgress({
        processed: this.completedChunks,
        total: this.totalChunks,
        matched: this.totalMatched,
        percentage: percentage
      });
    }

    // 🚀 关键优化：立即显示当前归并后的结果（不等全部完成）
    if (this.onChunkComplete) {
      this.onChunkComplete(mergedResults, {
        processed: this.completedChunks,
        total: this.totalChunks,
        percentage: (this.completedChunks / this.totalChunks * 100).toFixed(1)
      }, chunkIndex);
    }

    // 检查是否全部完成
    if (this.completedChunks === this.totalChunks) {
      // 🎉 全部完成
      const totalTime = performance.now() - this.startTime;

      console.log(`[SharedFilter] 全部完成: ${mergedResults.length} 个匹配, 耗时 ${totalTime.toFixed(2)}ms`);

      this.isProcessing = false;

      if (this.onComplete) {
        this.onComplete(mergedResults, {
          totalLines: this.totalLines,
          matchedCount: mergedResults.length,
          totalTime: totalTime.toFixed(2),
          workers: this.totalChunks
        });
      }
    }
  }

  /**
   * 🚀 增量归并：将新结果插入到已有结果中，保持有序
   */
  incrementalMerge(newResults) {
    // 收集所有已完成的块
    const chunks = [];
    let totalLength = 0;

    for (let i = 0; i < this.results.length; i++) {
      if (this.results[i] && Array.isArray(this.results[i]) && this.results[i].length > 0) {
        chunks.push(this.results[i]);
        totalLength += this.results[i].length;
      }
    }

    // 如果只有一个块或没有块，直接返回
    if (chunks.length === 0) return [];
    if (chunks.length === 1) return chunks[0];

    // 🚀 使用 k-way 归并
    const merged = this.kWayMerge(chunks, totalLength);
    return merged;
  }

  /**
   * 🚀 K-way 归并排序
   */
  kWayMerge(sortedChunks, totalLength) {
    if (sortedChunks.length === 0) return [];
    if (sortedChunks.length === 1) return sortedChunks[0];

    // 两两归并
    let merged = sortedChunks[0];

    for (let i = 1; i < sortedChunks.length; i++) {
      merged = this.mergeTwoSortedArrays(merged, sortedChunks[i]);
    }

    return merged;
  }

  /**
   * 🚀 合并两个已排序数组
   */
  mergeTwoSortedArrays(arr1, arr2) {
    const result = new Array(arr1.length + arr2.length);
    let i = 0, j = 0, k = 0;

    while (i < arr1.length && j < arr2.length) {
      if (arr1[i] <= arr2[j]) {
        result[k++] = arr1[i++];
      } else {
        result[k++] = arr2[j++];
      }
    }

    while (i < arr1.length) {
      result[k++] = arr1[i++];
    }

    while (j < arr2.length) {
      result[k++] = arr2[j++];
    }

    return result;
  }

  /**
   * 开始并行过滤
   */
  start(lines, keywords) {
    if (this.isProcessing) {
      console.warn('[SharedFilter] 已有任务在处理中，取消旧任务');
      this.cancel();
    }

    // 初始化连接
    if (!this.isConnected) {
      if (!this.init()) {
        console.error('[SharedFilter] 初始化失败');
        return false;
      }

      // 等待连接建立
      console.log('[SharedFilter] 等待连接建立...');
      return this.waitForConnection(lines, keywords);
    }

    // 开始过滤
    this.isProcessing = true;
    this.sessionId = Date.now();
    this.startTime = performance.now();
    this.results = [];
    this.completedChunks = 0;
    this.totalProcessed = 0;
    this.totalMatched = 0;
    this.totalLines = lines.length;

    console.log(`[SharedFilter] 开始并行过滤 (会话 ${this.sessionId})`);
    console.log(`[SharedFilter] 总行数: ${lines.length}, 使用 ${this.totalChunks} 个SharedWorker`);

    // 发送过滤请求到SharedWorker
    this.port.postMessage({
      type: 'process',
      data: {
        lines,
        keywords,
        sessionId: this.sessionId
      }
    });

    // 启动心跳
    this.startHeartbeat();

    return true;
  }

  /**
   * 等待连接建立
   */
  waitForConnection(lines, keywords) {
    const maxWait = 5000; // 最多等待5秒
    const checkInterval = 100; // 每100ms检查一次

    let elapsed = 0;

    const checkConnection = () => {
      elapsed += checkInterval;

      if (this.isConnected) {
        console.log('[SharedFilter] 连接已建立，开始过滤');
        this.start(lines, keywords);
        return;
      }

      if (elapsed >= maxWait) {
        console.error('[SharedFilter] 等待连接超时');
        return false;
      }

      setTimeout(checkConnection, checkInterval);
    };

    setTimeout(checkConnection, checkInterval);
    return true;
  }

  /**
   * 启动心跳
   */
  startHeartbeat() {
    // 清除旧的心跳
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // 每30秒发送一次心跳
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.port) {
        try {
          this.port.postMessage({ type: 'ping' });
        } catch (error) {
          console.error('[SharedFilter] 发送心跳失败:', error);
          this.handleDisconnect();
        }
      }
    }, 30000);
  }

  /**
   * 停止心跳
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 处理断开连接
   */
  handleDisconnect() {
    console.warn('[SharedFilter] 连接断开');

    this.isConnected = false;
    this.stopHeartbeat();

    // 尝试重连
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[SharedFilter] 尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

      setTimeout(() => {
        this.init();
      }, 1000);
    } else {
      console.error('[SharedFilter] 重连失败，已达最大尝试次数');
    }
  }

  /**
   * 取消当前任务
   */
  cancel() {
    if (!this.isProcessing) {
      return;
    }

    console.log('[SharedFilter] 取消当前任务');

    if (this.isConnected && this.port) {
      this.port.postMessage({
        type: 'cancel',
        sessionId: this.sessionId
      });
    }

    this.isProcessing = false;
    this.sessionId = Date.now() + 1; // 使旧会话失效

    // 🚀 内存泄漏修复：清空结果数组，释放内存
    this.results = [];
    this.completedChunks = 0;
    this.totalChunks = 0;
    this.totalProcessed = 0;
    this.totalMatched = 0;
  }

  /**
   * 清理资源（窗口关闭时调用）
   */
  cleanup() {
    console.log('[SharedFilter] 清理资源');

    // 停止心跳
    this.stopHeartbeat();

    // 取消当前任务
    if (this.isProcessing) {
      this.cancel();
    }

    // 通知SharedWorker关闭连接
    if (this.isConnected && this.port) {
      try {
        this.port.postMessage({ type: 'close' });
        this.port.close();
      } catch (error) {
        console.error('[SharedFilter] 关闭端口失败:', error);
      }
    }

    // 清理引用
    this.port = null;
    this.sharedWorker = null;
    this.isConnected = false;
    this.clientId = null;

    // 🚀 清理所有内部状态，释放内存
    this.results = [];
    this.completedChunks = 0;
    this.totalChunks = 0;
    this.isProcessing = false;
    this.totalProcessed = 0;
    this.totalMatched = 0;
    this.totalLines = 0;

    // 🚀 清空回调函数，避免闭包持有引用
    this.onProgress = null;
    this.onComplete = null;
    this.onChunkComplete = null;

    console.log('[SharedFilter] 资源清理完成');
  }

  /**
   * 回退到普通Worker模式
   */
  fallbackToRegularWorkers() {
    console.warn('[SharedFilter] 回退到普通Worker模式');
    // 这里可以加载 parallel-filter-manager 作为回退
    // 但为了简单起见，我们返回false，让上层处理
    return false;
  }

  /**
   * 设置进度回调
   */
  setProgressCallback(callback) {
    this.onProgress = callback;
  }

  /**
   * 设置完成回调
   */
  setCompleteCallback(callback) {
    this.onComplete = callback;
  }

  /**
   * 设置块完成回调
   */
  setChunkCompleteCallback(callback) {
    this.onChunkComplete = callback;
  }
}

// 导出单例
const sharedFilterManager = new SharedFilterManager();
