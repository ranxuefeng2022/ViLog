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
    this.estimatedLines = 0; // 🚀 预估行数，用于智能选择Worker数量

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
   * 🚀 根据数据量计算最优Worker数量
   */
  calculateOptimalWorkers() {
    const logicalProcessors = navigator.hardwareConcurrency || 16;
    const totalLines = this.estimatedLines || 0;

    // 🚀 策略：固定使用16个Worker，不受CPU核心数限制
    // 优势：充分利用并行能力，即使超过物理核心数也能提升性能
    let optimalWorkers;
    if (totalLines < 10000) {
      optimalWorkers = 2;
    } else if (totalLines < 100000) {
      optimalWorkers = Math.min(8, logicalProcessors);
    } else if (totalLines < 500000) {
      optimalWorkers = Math.min(12, logicalProcessors);
    } else {
      // 🚀 超大数据：强制使用16个，即使CPU核心数少于16
      optimalWorkers = 16;
    }

    return optimalWorkers;
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
   */
  handleComplete(workerIndex, chunkIndex, results, stats) {
    console.log(`[ParallelFilter] Worker ${workerIndex} 完成块 ${chunkIndex}: ${stats.matchedCount} 个匹配`);

    // 🚀 方案1：增量归并 - 每个 Worker 完成后立即归并并显示
    // results 现在是 Int32Array，需要转换为普通数组或直接使用
    const resultArray = Array.from(results);

    // 保存原始结果
    this.results[chunkIndex] = resultArray;
    this.completedChunks++;

    // 🎯 增量归并：将新结果插入到已有结果中
    const mergedResults = this.incrementalMerge(resultArray);
    this.totalMatched = mergedResults.length;

    console.log(`[ParallelFilter] 增量归并完成: ${mergedResults.length} 个匹配 (${this.completedChunks}/${this.totalChunks} 块)`);

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

      console.log(`[ParallelFilter] 全部完成: ${mergedResults.length} 个匹配, 耗时 ${totalTime.toFixed(2)}ms`);

      this.isProcessing = false;

      if (this.onComplete) {
        this.onComplete(mergedResults, {
          totalLines: this.totalLines,
          matchedCount: mergedResults.length,
          totalTime: totalTime.toFixed(2),
          workers: this.workerCount
        });
      }
    }
  }

  /**
   * 🚀 增量归并：将新结果插入到已有结果中，保持有序
   * 比全量排序快得多，因为每次只处理一个 Worker 的结果
   * 🚀 优化：利用 Worker 返回结果已排序的特性，使用 k-way 归并
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

    // 🚀 优化：使用 k-way 归并，因为每个块内部已经有序
    // 这比全量排序快得多
    const merged = this.kWayMerge(chunks, totalLength);
    return merged;
  }

  /**
   * 🚀 K-way 归并排序
   * 利用每个子数组已经有序的特性，高效合并多个有序数组
   */
  kWayMerge(sortedChunks, totalLength) {
    if (sortedChunks.length === 0) return [];
    if (sortedChunks.length === 1) return sortedChunks[0];

    // 预分配结果数组
    const result = new Array(totalLength);

    // 使用最小堆进行 k-way 归并
    // 但为了避免实现复杂的堆，我们使用简化的两两归并策略
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
   * 🚀 合并并排序所有结果（只在全部完成时调用一次）
   */
  mergeAndSortAllResults() {
    console.log(`[ParallelFilter] 开始合并 ${this.results.length} 个块的结果...`);

    // 第一步：计算总结果数量，预分配数组
    let totalCount = 0;
    for (let i = 0; i < this.results.length; i++) {
      if (this.results[i]) {
        totalCount += this.results[i].length;
      }
    }

    // 预分配数组，避免动态扩容
    const allResults = new Array(totalCount);

    // 第二步：使用循环手动复制元素，避免 spread operator 导致的堆栈溢出
    let offset = 0;
    for (let i = 0; i < this.results.length; i++) {
      if (this.results[i]) {
        const chunkResults = this.results[i];
        for (let j = 0; j < chunkResults.length; j++) {
          allResults[offset++] = chunkResults[j];
        }
      }
    }

    console.log(`[ParallelFilter] 合并完成，共 ${totalCount} 个结果，开始排序...`);

    // 使用稳定的排序算法（TimSort 或自定义归并排序）
    // 避免原生 sort 可能导致的堆栈溢出
    this.timSort(allResults, (a, b) => a.index - b.index);

    console.log(`[ParallelFilter] 排序完成`);
    return allResults;
  }

  /**
   * TimSort 排序算法（针对大型数组的优化）
   * 避免原生 sort 在大数据集上的堆栈溢出问题
   * 🚀 优化：预分配临时数组，避免 slice() 的内存分配开销
   */
  timSort(arr, compareFn) {
    const n = arr.length;

    // 小数组直接使用插入排序
    if (n < 64) {
      for (let i = 1; i < n; i++) {
        const key = arr[i];
        let j = i - 1;
        while (j >= 0 && compareFn(arr[j], key) > 0) {
          arr[j + 1] = arr[j];
          j--;
        }
        arr[j + 1] = key;
      }
      return;
    }

    // 🚀 优化：预分配临时数组，复用内存
    // 最大需要的临时空间是 n/2，预分配一次，避免每次 merge 都分配
    const tempArray = new Array(n);

    // 归并排序（迭代式，避免递归栈溢出）
    let size = 1;
    while (size < n) {
      for (let left = 0; left < n; left += size * 2) {
        const mid = Math.min(left + size - 1, n - 1);
        const right = Math.min(left + size * 2 - 1, n - 1);

        if (mid < right) {
          // 🚀 优化归并：使用预分配的临时数组
          this.mergeWithTempArray(arr, left, mid, right, tempArray, compareFn);
        }
      }
      size *= 2;
    }
  }

  /**
   * 🚀 优化的归并函数：使用预分配的临时数组
   */
  mergeWithTempArray(arr, left, mid, right, tempArray, compareFn) {
    const leftSize = mid - left + 1;
    const rightSize = right - mid;

    // 复制到临时数组（只复制需要的部分）
    for (let i = 0; i < leftSize; i++) {
      tempArray[i] = arr[left + i];
    }
    for (let j = 0; j < rightSize; j++) {
      tempArray[leftSize + j] = arr[mid + 1 + j];
    }

    // 归并回原数组
    let i = 0, j = leftSize, k = left;
    while (i < leftSize && j < leftSize + rightSize) {
      if (compareFn(tempArray[i], tempArray[j]) <= 0) {
        arr[k++] = tempArray[i++];
      } else {
        arr[k++] = tempArray[j++];
      }
    }

    // 复制剩余元素
    while (i < leftSize) {
      arr[k++] = tempArray[i++];
    }
    while (j < leftSize + rightSize) {
      arr[k++] = tempArray[j++];
    }
  }

  /**
   * 开始并行过滤
   */
  start(lines, keywords) {
    if (this.isProcessing) {
      console.warn('[ParallelFilter] 已有任务在处理中，取消旧任务');
      this.cancel();
    }

    // 🚀 设置预估行数，用于智能选择Worker数量
    this.estimatedLines = lines.length;

    // 初始化
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
    this.totalChunks = this.workers.length;

    // 计算每个 Worker 的数据块
    const chunkSize = Math.ceil(lines.length / this.workers.length);

    console.log(`[ParallelFilter] 开始并行过滤 (会话 ${this.sessionId})`);
    console.log(`[ParallelFilter] 总行数: ${lines.length}, 分成 ${this.totalChunks} 块, 每块 ~${chunkSize} 行`);

    // 分发任务到各个 Worker
    for (let i = 0; i < this.workers.length; i++) {
      const startIndex = i * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, lines.length);
      const chunkLines = lines.slice(startIndex, endIndex);

      this.workers[i].postMessage({
        type: 'process',
        data: {
          lines: chunkLines,
          keywords: keywords,
          sessionId: this.sessionId,
          chunkIndex: i,
          totalChunks: this.totalChunks,
          startIndex: startIndex
        }
      });
    }

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

    // 🚀 内存泄漏修复：清空结果数组，释放内存
    this.results = [];
    this.completedChunks = 0;
    this.totalChunks = 0;
    this.totalProcessed = 0;
    this.totalMatched = 0;
  }

  /**
   * 终止所有 Worker
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
