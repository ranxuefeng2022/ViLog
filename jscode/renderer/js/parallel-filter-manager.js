/**
 * 多线程并行过滤管理器
 * 使用多个 Worker 并行处理过滤任务
 */

class ParallelFilterManager {
  constructor() {
    this.workers = [];
    this.workerCount = 0;
    this.sessionId = 0;
    this.isProcessing = false;
    this.estimatedLines = 0;

    // 🚀 数据缓存状态：跟踪 Worker 是否已持有当前数据
    this.cachedDataSignature = null; // '行数:首行hash' 作为数据指纹
    this.workersHaveCache = false;

    // 🚀 智能缓存阈值：行数超过此值时，过滤完成后自动清空 Worker 缓存释放内存
    // 约 100 万行 ≈ 200MB 原始数据，Worker 缓存会额外占用 ~200MB
    this.cacheReleaseThreshold = 1000000;

    // 结果收集
    this.results = [];
    this.completedChunks = 0;
    this.totalChunks = 0;

    // 统计
    this.startTime = 0;
    this.totalProcessed = 0;
    this.totalMatched = 0;

    // 回调
    this.onProgress = null;
    this.onComplete = null;
    this.onChunkComplete = null;
  }

  /**
   * 🚀 根据CPU核心数计算最优Worker数量
   * Worker数 > 核心数会导致上下文切换，反而变慢
   */
  calculateOptimalWorkers() {
    return navigator.hardwareConcurrency || 8;
  }

  /**
   * 初始化 Worker 池
   * 🚀 优化：根据数据量智能调整Worker数量，允许重新初始化
   */
  initWorkers(forceReinit = false) {
    // 🚀 如果需要重新初始化（数据量变化大）
    if (forceReinit && this.workers.length > 0) {
      console.log(`[ParallelFilter] 重新初始化Worker池（数据量变化）`);
      this.terminateAll();
    }

    // 🚀 如果已经初始化过，检查是否需要调整数量
    if (this.workers.length > 0) {
      const optimalCount = this.calculateOptimalWorkers();
      if (this.workers.length === optimalCount) {
        console.log(`[ParallelFilter] 复用现有的 ${this.workers.length} 个 Worker（数量匹配）`);
        return true;
      } else if (!forceReinit) {
        console.log(`[ParallelFilter] 复用现有的 ${this.workers.length} 个 Worker（最优${optimalCount}个，但复用更高效）`);
        return true;
      }
    }

    // 🚀 智能Worker数量策略
    this.workerCount = this.calculateOptimalWorkers();
    console.log(`[ParallelFilter] 智能选择: ${this.estimatedLines} 行 -> ${this.workerCount} 个 Worker`);

    const logicalProcessors = navigator.hardwareConcurrency || 16;
    console.log(`[ParallelFilter] 初始化 ${this.workerCount} 个 Worker (CPU 核心: ${logicalProcessors})`);

    // 创建新的 Worker
    for (let i = 0; i < this.workerCount; i++) {
      try {
        // 尝试多个可能的路径
        const possiblePaths = [
          'renderer/workers/parallel-filter-worker.js',
          './renderer/workers/parallel-filter-worker.js',
          '../workers/parallel-filter-worker.js',
          './workers/parallel-filter-worker.js'
        ];

        let worker = null;
        let lastError = null;

        for (const path of possiblePaths) {
          try {
            console.log(`[ParallelFilter] 尝试路径 ${i}: ${path}`);
            worker = new Worker(path);
            console.log(`[ParallelFilter] ✓ 使用路径: ${path}`);
            break; // 成功，跳出循环
          } catch (e) {
            lastError = e;
            console.log(`[ParallelFilter] ✗ 路径失败: ${path} - ${e.message}`);
          }
        }

        if (!worker) {
          throw new Error(`所有路径都失败，最后错误: ${lastError?.message || '未知错误'}`);
        }

        worker.onmessage = (e) => this.handleWorkerMessage(i, e.data);
        worker.onerror = (error) => {
          console.error(`[ParallelFilter] Worker ${i} 错误:`, error);
        };

        this.workers.push(worker);
        console.log(`[ParallelFilter] ✓ Worker ${i} 创建成功`);
      } catch (error) {
        console.error(`[ParallelFilter] ✗ 创建 Worker ${i} 失败:`, error);
      }
    }

    const success = this.workers.length > 0;
    console.log(`[ParallelFilter] 初始化结果: ${this.workers.length}/${this.workerCount} 个 Worker 成功`);
    return success;
  }

  /**
   * 处理 Worker 消息
   */
  handleWorkerMessage(workerIndex, data) {
    const { type, sessionId, chunkIndex, results, progress, stats } = data;

    // 检查会话 ID
    if (sessionId !== this.sessionId) {
      return; // 忽略旧会话的消息
    }

    switch (type) {
      case 'progress':
        this.handleProgress(workerIndex, chunkIndex, progress);
        break;

      case 'complete':
        this.handleComplete(workerIndex, chunkIndex, results, stats);
        break;

      case 'cancelled':
        console.log(`[ParallelFilter] Worker ${workerIndex} 已取消`);
        break;
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
   * 🚀 实现增量归并：每个 Worker 完成后立即显示结果
   * 🚀 优化：直接存储 Int32Array，避免 Array.from 转换
   */
  handleComplete(workerIndex, chunkIndex, results, stats) {
    console.log(`[ParallelFilter] Worker ${workerIndex} 完成块 ${chunkIndex}: ${stats.matchedCount} 个匹配`);

    // 🚀 优化：直接存储 Int32Array，避免 Array.from 转换开销
    // results 已经是 Int32Array（通过 Transferable 从 Worker 接收）
    const resultArray = results instanceof Int32Array ? results : new Int32Array(results);

    // 保存原始结果（每个块内部已按行号有序）
    this.results[chunkIndex] = resultArray;
    this.completedChunks++;

    // 累计当前已匹配总数（未归并，仅用于进度显示）
    this.totalMatched += resultArray.length;

    console.log(`[ParallelFilter] 块完成: ${this.completedChunks}/${this.totalChunks}, 累计匹配 ${this.totalMatched}`);

    // 更新进度
    if (this.onProgress) {
      let percentage = (this.completedChunks / this.totalChunks * 100);
      percentage = Math.min(100, Math.max(0, percentage)).toFixed(1);
      this.onProgress({
        processed: this.completedChunks,
        total: this.totalChunks,
        matched: this.totalMatched,
        percentage: percentage
      });
    }

    // 通知单个块完成（传递该块的原始结果，不做归并，减少开销）
    if (this.onChunkComplete) {
      this.onChunkComplete(Array.from(resultArray), {
        processed: this.completedChunks,
        total: this.totalChunks,
        percentage: (this.completedChunks / this.totalChunks * 100).toFixed(1)
      }, chunkIndex);
    }

    // 检查是否全部完成 -> 此时才做一次性归并
    if (this.completedChunks === this.totalChunks) {
      const mergeStart = performance.now();
      const mergedResults = this.finalMerge();
      const mergeTime = performance.now() - mergeStart;

      const totalTime = performance.now() - this.startTime;

      console.log(`[ParallelFilter] 全部完成: ${mergedResults.length} 个匹配, 归并耗时 ${mergeTime.toFixed(2)}ms, 总耗时 ${totalTime.toFixed(2)}ms`);

      this.isProcessing = false;

      // 🚀 智能缓存策略：大数据集过滤完成后自动清空 Worker 缓存释放内存
      // 小数据集保留缓存以便快速重复过滤，大数据集清空以节省内存
      if (this.totalLines > this.cacheReleaseThreshold && this.workersHaveCache) {
        const savedMB = (this.totalLines * 200 / 1000000).toFixed(0);
        console.log(`[ParallelFilter] 🧹 智能缓存: ${this.totalLines} 行超过阈值 ${this.cacheReleaseThreshold}，清空 Worker 缓存释放 ~${savedMB}MB`);
        for (const worker of this.workers) {
          worker.postMessage({ type: 'clearCache' });
        }
        this.workersHaveCache = false;
        this.cachedDataSignature = null;
      }

      if (this.onComplete) {
        // 🚀 最终结果转为普通数组供上层使用
        const finalArray = mergedResults instanceof Int32Array ? Array.from(mergedResults) : mergedResults;
        this.onComplete(finalArray, {
          totalLines: this.totalLines,
          matchedCount: finalArray.length,
          totalTime: totalTime.toFixed(2),
          mergeTime: mergeTime.toFixed(2),
          workers: this.workerCount
        });
      }
    }
  }

  /**
   * 最终一次性归并：所有 Worker 完成后调用一次
   * 🚀 优化：全程使用 Int32Array，避免中间转换
   */
  finalMerge() {
    const chunks = [];
    let totalLength = 0;

    for (let i = 0; i < this.results.length; i++) {
      const r = this.results[i];
      if (r && r.length > 0) {
        // 确保是 Int32Array
        chunks.push(r instanceof Int32Array ? r : new Int32Array(r));
        totalLength += r.length;
      }
    }

    if (chunks.length === 0) return [];
    if (chunks.length === 1) return chunks[0];

    return this.kWayMerge(chunks, totalLength);
  }

  /**
   * K-way 归并排序（最小堆实现）
   * 🚀 优化：使用最小堆做真正的 K-way merge，O(n*log k) 复杂度
   * 利用每个子数组已经有序的特性，高效合并多个有序数组
   */
  kWayMerge(sortedChunks, totalLength) {
    const k = sortedChunks.length;
    if (k === 0) return [];
    if (k === 1) return sortedChunks[0];
    if (k === 2) return this._mergeTwoSortedInt32Arrays(sortedChunks[0], sortedChunks[1]);

    // 🚀 优化：使用 Int32Array 作为结果缓冲区，避免对象数组
    const result = new Int32Array(totalLength);

    // 堆元素：{ value, chunkIdx, pos }
    // 用扁平数组表示堆，避免对象分配
    const heapValues = new Int32Array(k);    // 当前值
    const heapChunks = new Int32Array(k);    // chunk 索引
    const heapPositions = new Int32Array(k); // chunk 内位置
    let heapSize = 0;

    // 初始化堆：每个 chunk 的第一个元素
    for (let i = 0; i < k; i++) {
      if (sortedChunks[i].length > 0) {
        heapValues[heapSize] = sortedChunks[i][0];
        heapChunks[heapSize] = i;
        heapPositions[heapSize] = 0;
        heapSize++;
        this._heapSiftUp(heapValues, heapChunks, heapPositions, heapSize - 1);
      }
    }

    let resultIdx = 0;

    while (heapSize > 0) {
      // 取出堆顶（最小值）
      const val = heapValues[0];
      const chunkIdx = heapChunks[0];
      const pos = heapPositions[0];

      result[resultIdx++] = val;

      // 用堆底元素替换堆顶，然后下沉
      heapSize--;
      if (heapSize > 0) {
        heapValues[0] = heapValues[heapSize];
        heapChunks[0] = heapChunks[heapSize];
        heapPositions[0] = heapPositions[heapSize];
        this._heapSiftDown(heapValues, heapChunks, heapPositions, 0, heapSize);
      }

      // 从同一个 chunk 取下一个元素插入堆
      const chunk = sortedChunks[chunkIdx];
      const nextPos = pos + 1;
      if (nextPos < chunk.length) {
        heapValues[heapSize] = chunk[nextPos];
        heapChunks[heapSize] = chunkIdx;
        heapPositions[heapSize] = nextPos;
        heapSize++;
        this._heapSiftUp(heapValues, heapChunks, heapPositions, heapSize - 1);
      }
    }

    return result;
  }

  /**
   * 最小堆：上浮操作
   */
  _heapSiftUp(values, chunks, positions, idx) {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (values[idx] < values[parent]) {
        // 交换三个数组的对应位置
        let tmp = values[idx]; values[idx] = values[parent]; values[parent] = tmp;
        tmp = chunks[idx]; chunks[idx] = chunks[parent]; chunks[parent] = tmp;
        tmp = positions[idx]; positions[idx] = positions[parent]; positions[parent] = tmp;
        idx = parent;
      } else {
        break;
      }
    }
  }

  /**
   * 最小堆：下沉操作
   */
  _heapSiftDown(values, chunks, positions, idx, size) {
    while (true) {
      let smallest = idx;
      const left = (idx << 1) + 1;
      const right = (idx << 1) + 2;

      if (left < size && values[left] < values[smallest]) smallest = left;
      if (right < size && values[right] < values[smallest]) smallest = right;

      if (smallest !== idx) {
        let tmp = values[idx]; values[idx] = values[smallest]; values[smallest] = tmp;
        tmp = chunks[idx]; chunks[idx] = chunks[smallest]; chunks[smallest] = tmp;
        tmp = positions[idx]; positions[idx] = positions[smallest]; positions[smallest] = tmp;
        idx = smallest;
      } else {
        break;
      }
    }
  }

  /**
   * 合并两个已排序数组（k=2 时的快速路径）
   */
  /**
   * 🚀 合并两个有序 Int32Array，返回 Int32Array
   */
  _mergeTwoSortedInt32Arrays(arr1, arr2) {
    const len1 = arr1.length;
    const len2 = arr2.length;
    const result = new Int32Array(len1 + len2);
    let i = 0, j = 0, k = 0;

    while (i < len1 && j < len2) {
      if (arr1[i] <= arr2[j]) {
        result[k++] = arr1[i++];
      } else {
        result[k++] = arr2[j++];
      }
    }

    while (i < len1) {
      result[k++] = arr1[i++];
    }

    while (j < len2) {
      result[k++] = arr2[j++];
    }

    return result;
  }

  /**
   * 开始并行过滤
   * 🚀 数据缓存优化：同一文件重复过滤时只发关键词，不重传数据
   * 🚀 SharedArrayBuffer 优化：数据变化时通过 SAB 共享，零拷贝分发
   */
  start(lines, keywords, sabInfo) {
    if (this.isProcessing) {
      console.warn('[ParallelFilter] 已有任务在处理中，取消旧任务');
      this.cancel();
    }

    this.estimatedLines = lines.length;

    if (this.workers.length === 0) {
      if (!this.initWorkers()) {
        console.error('[ParallelFilter] Worker 初始化失败');
        return false;
      }
    }

    this.isProcessing = true;
    this.sessionId = Date.now();
    this.startTime = performance.now();
    this.results = [];
    this.completedChunks = 0;
    this.totalProcessed = 0;
    this.totalMatched = 0;
    this.totalLines = lines.length;
    // 计算实际需要的 Worker 数量（避免空块导致陈旧缓存问题）
    const maxEffectiveWorkers = Math.min(this.workers.length, lines.length);
    const chunkSize = Math.ceil(lines.length / maxEffectiveWorkers);

    // 🚀 计算数据指纹，判断数据是否变化
    const dataSignature = lines.length + ':' + (lines[0] ? lines[0].length : 0);
    const dataChanged = dataSignature !== this.cachedDataSignature || !this.workersHaveCache;
    this.cachedDataSignature = dataSignature;

    // 🚀 SharedArrayBuffer 可用性检测
    const useSAB = dataChanged && sabInfo && typeof SharedArrayBuffer !== 'undefined';

    this.totalChunks = maxEffectiveWorkers;

    console.log(`[ParallelFilter] 开始并行过滤 (会话 ${this.sessionId})`);
    console.log(`[ParallelFilter] 总行数: ${lines.length}, 分成 ${this.totalChunks} 块, 数据${dataChanged ? '已变化(重传)' : '未变化(缓存)'}, SAB=${useSAB}`);

    // 分发任务到各个 Worker
    const transferStart = performance.now();

    for (let i = 0; i < this.workers.length; i++) {
      // 超出有效块范围的 Worker 发送 clearCache 防止陈旧数据
      if (i >= maxEffectiveWorkers) {
        this.workers[i].postMessage({ type: 'clearCache' });
        continue;
      }

      const startIndex = i * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, lines.length);

      if (useSAB) {
        // 🚀 SAB 路径：零拷贝共享，只发元数据
        this.workers[i].postMessage({
          type: 'process-sab',
          data: {
            sab: sabInfo.sab,
            headerSize: sabInfo.headerSize,
            startLine: startIndex,
            endLine: endIndex,
            keywords: keywords,
            sessionId: this.sessionId,
            chunkIndex: i,
            totalChunks: this.totalChunks
          }
        });
      } else {
        // 传统路径：结构化克隆
        const msg = {
          type: 'process',
          data: {
            keywords: keywords,
            sessionId: this.sessionId,
            chunkIndex: i,
            totalChunks: this.totalChunks,
            startIndex: startIndex
          }
        };

        // 🚀 只在数据变化时才传输行数据，否则 Worker 使用缓存
        if (dataChanged) {
          msg.data.lines = lines.slice(startIndex, endIndex);
        }

        this.workers[i].postMessage(msg);
      }
    }

    this.workersHaveCache = true;
    const transferTime = performance.now() - transferStart;
    console.log(`[ParallelFilter] 数据分发耗时: ${transferTime.toFixed(2)}ms (${useSAB ? 'SAB零拷贝' : dataChanged ? '传输数据' : '仅关键词'})`);

    return true;
  }

  /**
   * 取消当前任务
   */
  cancel() {
    if (!this.isProcessing) {
      return;
    }

    console.log('[ParallelFilter] 取消当前任务');

    for (const worker of this.workers) {
      worker.postMessage({ type: 'cancel' });
    }

    this.isProcessing = false;
    this.sessionId = Date.now() + 1; // 使旧会话失效

    // 🚀 取消后标记缓存失效，确保下次 start() 重新发送数据（通过 SAB 零拷贝）
    this.workersHaveCache = false;

    // 🚀 内存泄漏修复：清空结果数组，释放内存
    this.results = [];
    this.completedChunks = 0;
    this.totalChunks = 0;
    this.totalProcessed = 0;
    this.totalMatched = 0;
  }

  /**
   * 🚀 重置会话状态，但不销毁 Worker 池
   * 用于过滤面板清空时，保留 Worker 以供下次快速复用
   */
  resetSession() {
    console.log(`[ParallelFilter] 重置会话（保留 ${this.workers.length} 个 Worker）`);

    // 通知 Worker 清除缓存
    for (const worker of this.workers) {
      worker.postMessage({ type: 'clearCache' });
    }

    this.results = [];
    this.completedChunks = 0;
    this.totalChunks = 0;
    this.isProcessing = false;
    this.totalProcessed = 0;
    this.totalMatched = 0;
    this.totalLines = 0;
    this.workersHaveCache = false;
    this.cachedDataSignature = null;

    console.log('[ParallelFilter] 会话已重置，Worker 池保持就绪');
  }

  /**
   * 终止所有 Worker（仅在页面卸载或内存压力大时调用）
   */
  terminateAll() {
    console.log(`[ParallelFilter] 终止 ${this.workers.length} 个 Worker`);

    for (const worker of this.workers) {
      worker.terminate();
    }

    this.workers = [];

    // 🚀 进程终止后，清空所有内部状态，释放内存
    this.results = [];
    this.completedChunks = 0;
    this.totalChunks = 0;
    this.isProcessing = false;
    this.totalProcessed = 0;
    this.totalMatched = 0;
    this.totalLines = 0;
    this.workersHaveCache = false;
    this.cachedDataSignature = null;

    // 🚀 清空回调函数，避免闭包持有引用
    this.onProgress = null;
    this.onComplete = null;
    this.onChunkComplete = null;

    console.log('[ParallelFilter] Worker进程已终止，内部状态已清空');
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
const parallelFilterManager = new ParallelFilterManager();
