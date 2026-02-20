/**
 * 混合过滤系统 - 智能选择ripgrep或Worker
 * 根据场景自动选择最优方案
 */

window.HybridFilter = {
  // 配置
  config: {
    preferRipgrep: true,        // 优先使用ripgrep
    ripgrepMinSize: 1024 * 1024, // 文件>1MB时使用ripgrep
    autoSelect: true            // 自动选择最佳方案
  },

  /**
   * 智能过滤 - 自动选择ripgrep或Worker
   * @param {string} filterText - 过滤关键词
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 过滤结果
   */
  async smartFilter(filterText, options = {}) {
    const {
      useRipgrep = null,  // 强制指定（null=自动选择）
      onProgress = null,
      onComplete = null
    } = options;

    console.log(`[HybridFilter] 开始过滤: "${filterText}"`);

    // 决定使用哪种方案
    const shouldUseRipgrep = useRipgrep !== null
      ? useRipgrep
      : this.shouldPreferRipgrep(filterText);

    console.log(`[HybridFilter] 选择方案: ${shouldUseRipgrep ? 'ripgrep 🚀' : 'Worker 🔧'}`);

    if (shouldUseRipgrep) {
      return await this.filterWithRipgrep(filterText, { onProgress, onComplete });
    } else {
      return await this.filterWithWorker(filterText, { onProgress, onComplete });
    }
  },

  /**
   * 判断是否应该使用ripgrep
   */
  shouldPreferRipgrep(filterText) {
    // 1. 检查配置
    if (!this.config.preferRipgrep) return false;
    if (!this.config.autoSelect) return false;

    // 2. 检查ripgrep是否可用
    if (!window.App || !window.App.Ripgrep) {
      console.log('[HybridFilter] ripgrep不可用，使用Worker');
      return false;
    }

    // 3. 检查是否是二级过滤
    if (this.isSecondaryFilter()) {
      console.log('[HybridFilter] 二级过滤，使用Worker');
      return false;  // 二级过滤必须用Worker
    }

    // 4. 检查是否有文件路径
    if (!this.hasFilePaths()) {
      console.log('[HybridFilter] 无文件路径，使用Worker');
      return false;
    }

    // 5. 检查文件大小
    const totalSize = this.getTotalFileSize();
    if (totalSize > this.config.ripgrepMinSize) {
      console.log(`[HybridFilter] 文件较大(${(totalSize/1024/1024).toFixed(1)}MB)，使用ripgrep`);
      return true;
    }

    // 6. 检查是否是复杂的正则表达式
    if (this.isComplexRegex(filterText)) {
      console.log('[HybridFilter] 复杂正则，使用ripgrep');
      return true;
    }

    // 7. 默认：文件较大或正则复杂时使用ripgrep
    return totalSize > this.config.ripgrepMinSize;
  },

  /**
   * 使用ripgrep过滤
   */
  async filterWithRipgrep(filterText, options = {}) {
    const { onProgress, onComplete } = options;

    try {
      console.log('[HybridFilter] 使用ripgrep过滤...');

      // 进度回调
      if (onProgress) {
        onProgress({ percentage: 0, matched: 0 });
      }

      const startTime = performance.now();

      // 构建文件列表
      const files = currentFiles.map(f => f.path);
      console.log(`[HybridFilter] 搜索 ${files.length} 个文件`);

      // 调用ripgrep
      const results = await window.App.Ripgrep.search(filterText, {
        files: files,
        contextLines: 0,  // 不需要上下文
        caseSensitive: false,
        maxResults: 100000  // 大数量限制
      });

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

      // 转换结果格式
      const filteredToOriginalIndex = [];
      const filteredLines = [];

      for (const result of results) {
        // 查找对应的原始索引
        const originalIndex = this.findOriginalIndex(result.filePath, result.lineNumber);
        if (originalIndex !== -1) {
          filteredToOriginalIndex.push(originalIndex);
          filteredLines.push(originalLines[originalIndex]);
        }
      }

      const stats = {
        matchedCount: filteredLines.length,
        totalTime: elapsed,
        method: 'ripgrep'
      };

      console.log(`[HybridFilter] ripgrep完成: ${stats.matchedCount} 个匹配，耗时 ${stats.totalTime}秒`);

      // 完成回调
      if (onComplete) {
        onComplete(filteredToOriginalIndex, stats);
      }

      // 进度回调（完成）
      if (onProgress) {
        onProgress({ percentage: 100, matched: stats.matchedCount });
      }

      return {
        filteredLines,
        filteredToOriginalIndex,
        stats
      };

    } catch (error) {
      console.error('[HybridFilter] ripgrep过滤失败:', error);
      // 失败时降级到Worker
      console.log('[HybridFilter] 降级到Worker过滤');
      return await this.filterWithWorker(filterText, options);
    }
  },

  /**
   * 使用Worker过滤
   */
  async filterWithWorker(filterText, options = {}) {
    const { onProgress, onComplete } = options;

    console.log('[HybridFilter] 使用Worker过滤...');

    // 使用现有的Worker过滤机制
    return new Promise((resolve, reject) => {
      // 保存原有的回调
      const originalProgressCallback = window.filteredPanelSetProgressCallback;
      const originalCompleteCallback = window.filteredPanelSetCompleteCallback;

      // 设置新回调
      if (onProgress) {
        window.filteredPanelSetProgressCallback = onProgress;
      }

      if (onComplete) {
        window.filteredPanelSetCompleteCallback = (results, stats) => {
          stats.method = 'worker';
          onComplete(results, stats);

          // 恢复原有回调
          window.filteredPanelSetProgressCallback = originalProgressCallback;
          window.filteredPanelSetCompleteCallback = originalCompleteCallback;

          resolve({
            filteredLines: results.map(idx => originalLines[idx]),
            filteredToOriginalIndex: results,
            stats
          });
        };
      }

      // 执行过滤
      try {
        if (typeof performParallelFilter === 'function') {
          performParallelFilter(filterText);
        } else if (typeof resetFilter === 'function') {
          resetFilter(true, filterText);
        } else {
          throw new Error('无法找到过滤函数');
        }
      } catch (error) {
        console.error('[HybridFilter] Worker过滤失败:', error);

        // 恢复原有回调
        window.filteredPanelSetProgressCallback = originalProgressCallback;
        window.filteredPanelSetCompleteCallback = originalCompleteCallback;

        reject(error);
      }
    });
  },

  /**
   * 检查是否是二级过滤
   */
  isSecondaryFilter() {
    // 检查是否在过滤结果上再次过滤
    return typeof currentFilter !== 'undefined' &&
           currentFilter &&
           currentFilter.filteredLines &&
           currentFilter.filteredLines.length > 0 &&
           typeof secondaryFilter !== 'undefined' &&
           secondaryFilter.isActive;
  },

  /**
   * 检查是否有文件路径
   */
  hasFilePaths() {
    return typeof currentFiles !== 'undefined' &&
           currentFiles &&
           currentFiles.length > 0 &&
           currentFiles[0] &&
           currentFiles[0].path;
  },

  /**
   * 计算总文件大小
   */
  getTotalFileSize() {
    if (!this.hasFilePaths()) return 0;

    let totalSize = 0;
    for (const file of currentFiles) {
      if (file.size) {
        totalSize += file.size;
      }
    }
    return totalSize;
  },

  /**
   * 检查是否是复杂的正则表达式
   */
  isComplexRegex(text) {
    // 检查是否包含正则元字符
    const regexChars = /[.*+?^${}()|[\]\\]/;
    return regexChars.test(text) && !text.includes('|');  // 简单OR不算复杂
  },

  /**
   * 查找原始索引
   */
  findOriginalIndex(filePath, lineNumber) {
    if (typeof fileHeaders === 'undefined') return -1;

    const fileName = this.getFileName(filePath);
    for (let i = 0; i < fileHeaders.length; i++) {
      const header = fileHeaders[i];
      if (header && header.fileName === fileName) {
        return header.index + lineNumber;
      }
    }
    return -1;
  },

  /**
   * 获取文件名
   */
  getFileName(filePath) {
    if (!filePath) return '';
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1];
  },

  /**
   * 设置配置
   */
  setConfig(config) {
    Object.assign(this.config, config);
    console.log('[HybridFilter] 配置已更新:', this.config);
  }
};

console.log('✓ Hybrid Filter module loaded');
