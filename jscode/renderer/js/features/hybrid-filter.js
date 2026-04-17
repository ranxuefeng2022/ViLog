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

  // 缓存的 fileName -> header 映射，避免每次 findOriginalIndex 线性查找
  _headerMap: null,
  _headerMapVersion: 0,  // 用于检测 fileHeaders 是否变化

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

    // 4. 检查是否来自压缩包 - 压缩包内容必须使用Worker过滤
    if (this.isFromArchive()) {
      console.log('[HybridFilter] 文件来自压缩包，使用Worker过滤');
      return false;
    }

    // 5. 检查是否有文件路径
    if (!this.hasFilePaths()) {
      console.log('[HybridFilter] 无文件路径，使用Worker');
      return false;
    }

    // 6. 检查文件大小
    const totalSize = this.getTotalFileSize();
    if (totalSize > this.config.ripgrepMinSize) {
      console.log(`[HybridFilter] 文件较大(${(totalSize/1024/1024).toFixed(1)}MB)，使用ripgrep`);
      return true;
    }

    // 7. 检查是否是复杂的正则表达式
    if (this.isComplexRegex(filterText)) {
      console.log('[HybridFilter] 复杂正则，使用ripgrep');
      return true;
    }

    // 8. 默认：文件较大或正则复杂时使用ripgrep
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

      // 预建 fileName -> header Map，将 O(n*k) 线性查找变为 O(1) 查表
      this.buildHeaderMap();

      // 转换结果格式
      const filteredToOriginalIndex = [];
      const filteredLines = [];

      for (const result of results) {
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
   * 检查文件是否来自压缩包
   * @returns {boolean} 是否来自压缩包
   */
  isFromArchive() {
    if (typeof currentFiles === 'undefined' || !currentFiles || currentFiles.length === 0) {
      return false;
    }

    // 🔧 修复：检查所有文件，而不只是第一个文件
    // 如果任何一个文件是压缩包文件，就应该全部使用 Worker 过滤
    for (const file of currentFiles) {
      if (!file) continue;

      // 1. 检查是否有 archiveName/fromArchive 属性（压缩包特有的属性）
      if (file.archiveName || file.fromArchive) {
        console.log(`[HybridFilter] 检测到 archiveName/fromArchive 属性: ${file.name || '(no name)'}`);
        return true;
      }

      // 2. 检查路径是否包含压缩包标记（如 "archive.zip:file.log"）
      const path = file.path;
      if (!path) continue;

      const archivePatterns = [
        /\.zip:/i,
        /\.7z:/i,
        /\.tar:/i,
        /\.gz:/i,
        /\.rar:/i,
        /\.bz2:/i
      ];

      for (const pattern of archivePatterns) {
        if (pattern.test(path)) {
          console.log(`[HybridFilter] 路径包含压缩包标记: ${path.substring(0, 100)}...`);
          return true;
        }
      }

      // 3. 检查 Windows 路径是否包含压缩包标记（如 "xxx.zip\内部路径"）
      if (/^[A-Za-z]:\\/.test(path)) {
        const archivePatternsWin = [
          /\.zip[\/\\]/i,
          /\.7z[\/\\]/i,
          /\.tar[\/\\]/i,
          /\.gz[\/\\]/i,
          /\.rar[\/\\]/i,
          /\.bz2[\/\\]/i
        ];

        for (const pattern of archivePatternsWin) {
          if (pattern.test(path)) {
            console.log(`[HybridFilter] 路径包含压缩包标记: ${path.substring(0, 100)}...`);
            return true;
          }
        }
      }
    }

    console.log('[HybridFilter] 未检测到压缩包文件');
    return false;
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
   * 构建 fileName -> header 的 Map 缓存
   * 在 fileHeaders 变化时重新构建，后续查找 O(1)
   */
  buildHeaderMap() {
    if (typeof fileHeaders === 'undefined' || !fileHeaders) {
      this._headerMap = null;
      return;
    }

    // fileHeaders.length 变化时重建
    if (this._headerMap && this._headerMapVersion === fileHeaders.length) {
      return;
    }

    this._headerMap = new Map();
    for (let i = 0; i < fileHeaders.length; i++) {
      const header = fileHeaders[i];
      if (header && header.fileName) {
        this._headerMap.set(header.fileName, header);
      }
    }
    this._headerMapVersion = fileHeaders.length;
  },

  /**
   * 查找原始索引
   * 使用 Map 查表，O(1) 复杂度
   */
  findOriginalIndex(filePath, lineNumber) {
    const fileName = this.getFileName(filePath);

    // 优先使用 Map 查表
    if (this._headerMap) {
      const header = this._headerMap.get(fileName);
      if (header) {
        return header.index + lineNumber;
      }
      return -1;
    }

    // 降级：线性查找（Map 未构建时）
    if (typeof fileHeaders === 'undefined') return -1;

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
