      // ========== 虚拟滚动优化：更新滚动进度函数 ==========
      function updateScrollProgress() {
        const scrollProgressBar = document.getElementById('scrollProgressBar');
        const scrollProgressText = document.getElementById('scrollProgressText');

        if (!scrollProgressBar || !scrollProgressText) return;

        const scrollTop = outer.scrollTop;
        const scrollHeight = outer.scrollHeight - outer.clientHeight;
        const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
        const roundedProgress = Math.round(progress);

        // 更新进度条宽度
        scrollProgressBar.style.setProperty('--scroll-progress', roundedProgress + '%');
        // 更新百分比文本
        scrollProgressText.textContent = roundedProgress + '%';

        // 更新标题，显示当前位置的行号
        const currentLine = scrollTopToLine(scrollTop);
        const totalLines = originalLines.length;
        scrollProgressBar.parentElement.title =
          `滚动位置: ${currentLine + 1} / ${totalLines} 行 (${roundedProgress}%)`;
      }

      // ========== 虚拟滚动优化：初始化滚动进度指示器点击事件 ==========
      function initScrollProgressIndicator() {
        const scrollProgressContainer = document.getElementById('scrollProgressContainer');
        if (!scrollProgressContainer) return;

        // 点击滚动进度条时跳转到对应位置
        scrollProgressContainer.addEventListener('click', (e) => {
          const rect = scrollProgressContainer.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const width = rect.width;
          const percentage = clickX / width;

          // 计算目标行号并跳转
          const targetLine = Math.floor(originalLines.length * percentage);
          jumpToLine(targetLine, 'center');
        });
      }

      // 高亮功能已移至右键菜单，初始化函数不再需要
      function initHighlightFeatures() {
        // 不需要初始化任何事件监听器
      }

      // 高亮功能已移至右键菜单，此函数不再通过工具栏调用
      function toggleCustomHighlight(keyword, color) {
        // 参数可选，如果不提供则返回
        if (!keyword || !color) return;

        toggleFilteredPanelVisibility();
        // 使用trim检查是否为空，但保留原始值用于高亮
        if (keyword.trim() === "") return;

        // 检查是否已存在相同关键词
        const existingIndex = customHighlights.findIndex(
          (h) => h.keyword === keyword
        );
        if (existingIndex !== -1) {
          // 如果已存在，则移除该高亮
          customHighlights.splice(existingIndex, 1);
          showMessage(`已移除关键词 "${keyword}" 的高亮`);
        } else {
          // 如果不存在，则添加新的高亮
          customHighlights.push({ keyword, color });
          showMessage(`已添加关键词 "${keyword}" 的高亮`);
        }

        // 🔧 修复：高亮变化时清空 HTML 解析缓存
        clearHtmlParseCache();

        // 更新主内容区的高亮（不自动显示过滤面板）
        rerenderAfterHighlightChangePreserveScroll(false);
      }


      // 复制所有日志功能
      function copyAllLogs() {
        if (originalLines.length === 0) {
          showMessage("没有日志可复制");
          return;
        }

        // 将 originalLines 数组中的所有行用换行符连接（直接使用原始内容）
        const allLogs = originalLines.join('\n');

        // 使用 Clipboard API 复制到剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(allLogs).then(() => {
            showMessage(`已复制 ${originalLines.length} 行日志到剪贴板`);
          }).catch(err => {
            console.error('复制失败:', err);
            // 降级方案：使用传统方法
            fallbackCopyTextToClipboard(allLogs);
          });
        } else {
          // 降级方案：使用传统方法
          fallbackCopyTextToClipboard(allLogs);
        }
      }

      // 降级复制方案（兼容旧浏览器）
      function fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          const successful = document.execCommand('copy');
          if (successful) {
            showMessage(`已复制 ${originalLines.length} 行日志到剪贴板`);
          } else {
            showMessage("复制失败，请手动选择并复制");
          }
        } catch (err) {
          console.error('降级复制方案失败:', err);
          showMessage("复制失败，请手动选择并复制");
        }
        
        document.body.removeChild(textArea);
      }

      // 复制过滤结果框内容功能
      function copyFilteredLogs() {
        if (filteredPanelAllLines.length === 0) {
          showMessage("没有过滤结果可复制");
          return;
        }

        // 将 filteredPanelAllLines 数组中的所有行用换行符连接（直接使用原始内容）
        const allFilteredLogs = filteredPanelAllLines.join('\n');

        // 使用 Clipboard API 复制到剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(allFilteredLogs).then(() => {
            showMessage(`已复制 ${filteredPanelAllLines.length} 行过滤结果到剪贴板`);
          }).catch(err => {
            console.error('复制失败:', err);
            // 降级方案：使用传统方法
            fallbackCopyFilteredTextToClipboard(allFilteredLogs);
          });
        } else {
          // 降级方案：使用传统方法
          fallbackCopyFilteredTextToClipboard(allFilteredLogs);
        }
      }

      // 暴露到全局作用域，供HTML onclick使用
      window.copyFilteredLogs = copyFilteredLogs;

      // 导出过滤结果为 HTML
      function exportFilteredAsHTML() {
        if (filteredPanelAllLines.length === 0) {
          showMessage("没有过滤结果可导出");
          return;
        }

        try {
          showMessage("正在生成 HTML...");

          // 生成带高亮的 HTML 内容
          const htmlContent = generateFilteredHTML();
          const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });

          // 生成文件名（带时间戳）
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          const fileName = `filtered_${timestamp}.html`;

          // 触发下载
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();

          // 清理
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 100);

          showMessage(`已导出 ${filteredPanelAllLines.length} 行到 ${fileName}`);
        } catch (error) {
          console.error('导出失败:', error);
          showMessage("导出失败: " + error.message);
        }
      }

      // 生成过滤结果的完整 HTML
      function generateFilteredHTML() {
        const keywords = currentFilter.filterKeywords || [];
        const totalCount = filteredPanelAllLines.length;
        const timestamp = new Date().toLocaleString('zh-CN');

        // 获取过滤面板的样式
        const styles = getFilteredPanelStyles();

        // 生成每一行的 HTML（带高亮）
        const linesHTML = filteredPanelAllLines.map((line, index) => {
          const isFileHeader = line && line.startsWith("=== 文件:");
          const originalIndex = filteredPanelAllOriginalIndices ? filteredPanelAllOriginalIndices[index] : index;

          let displayText = line;

          // 应用自定义高亮（优先级最高）
          if (!isFileHeader && customHighlights && customHighlights.length > 0) {
            for (let h = 0; h < customHighlights.length; h++) {
              const highlight = customHighlights[h];
              if (!highlight.keyword) continue;
              displayText = safeHighlight(
                displayText,
                highlight.keyword,
                (match) => `<span class="custom-highlight" style="background-color: ${highlight.color}80;">${match}</span>`
              );
            }
          }

          // 应用过滤高亮（与虚拟滚动保持一致）
          if (!isFileHeader && keywords.length > 0) {
            for (let k = 0; k < keywords.length; k++) {
              const keyword = keywords[k];
              if (!keyword) continue;
              const colorClass = getFilterHighlightClass(k);
              displayText = safeHighlight(
                displayText,
                keyword,
                (match) => `<span class="${colorClass}">${match}</span>`
              );
            }
          }

          // 添加行号
          if (!isFileHeader) {
            const lineNumber = originalIndex + 1;
            displayText = `<span class="line-number">${lineNumber}</span>${displayText}`;
          }

          const className = isFileHeader ? 'file-header' : 'log-line';
          return `  <div class="${className}">${displayText}</div>`;
        }).join('\n');

        // 返回完整 HTML
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>过滤结果 - ${totalCount} 行</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    body {
      font-family: "Monaco", "Menlo", "Ubuntu Mono", "Consolas", monospace;
      font-size: 13px;
      line-height: 1.4;
      background: #f5f5f5;
    }
    .container {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: white;
    }
    .header {
      flex-shrink: 0;
      background: linear-gradient(135deg, #e8f8f0 0%, #d0f0e0 100%);
      padding: 8px 15px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    }
    .header h1 {
      font-size: 14px;
      color: #2e7d32;
      margin-bottom: 4px;
    }
    .header .meta {
      font-size: 11px;
      color: #666;
    }
    .content {
      flex: 1;
      padding: 0;
      background: #fff;
      overflow: auto;
    }
${styles}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>过滤结果</h1>
      <div class="meta">
        过滤关键词: ${keywords.join(' | ')} |
        总行数: ${totalCount.toLocaleString()} |
        导出时间: ${timestamp}
      </div>
    </div>
    <div class="content">
${linesHTML}
    </div>
  </div>
</body>
</html>`;
      }

      // 获取过滤面板的 CSS 样式
      function getFilteredPanelStyles() {
        return `
    .log-line {
      padding: 2px 8px;
      border-bottom: 1px solid #f0f0f0;
      white-space: pre;
      color: #1d1d1f;
    }
    .file-header {
      background: rgba(144, 238, 144, 0.3);
      padding: 4px 8px;
      border-left: 3px solid #90ee90;
      font-weight: 500;
      color: #2e7d32;
      font-size: 12px;
      border-radius: 0 4px 4px 0;
    }
    .line-number {
      display: inline-block;
      min-width: 60px;
      text-align: right;
      padding-right: 12px;
      color: #999;
      font-size: 11px;
      user-select: none;
      -webkit-user-select: none;
    }
    .filter-highlight-0 { background: rgba(255, 99, 71, 0.2); }
    .filter-highlight-1 { background: rgba(32, 178, 170, 0.2); }
    .filter-highlight-2 { background: rgba(138, 43, 226, 0.2); }
    .filter-highlight-3 { background: rgba(255, 165, 0, 0.2); }
    .filter-highlight-4 { background: rgba(50, 205, 50, 0.2); }
    .filter-highlight-5 { background: rgba(0, 191, 255, 0.2); }
    .filter-highlight-6 { background: rgba(255, 20, 147, 0.2); }
    .filter-highlight-7 { background: rgba(106, 90, 205, 0.2); }
    .filter-highlight-8 { background: rgba(60, 179, 113, 0.2); }
    .filter-highlight-9 { background: rgba(255, 140, 0, 0.2); }
    .filter-highlight-10 { background: rgba(70, 130, 180, 0.2); }
    .filter-highlight-11 { background: rgba(186, 85, 211, 0.2); }
    .filter-highlight-12 { background: rgba(100, 149, 237, 0.2); }
    .filter-highlight-13 { background: rgba(210, 105, 30, 0.2); }
    .filter-highlight-14 { background: rgba(178, 34, 34, 0.2); }
    .filter-highlight-15 { background: rgba(65, 105, 225, 0.2); }
    .filter-highlight-16 { background: rgba(218, 112, 214, 0.2); }
    .filter-highlight-17 { background: rgba(95, 158, 160, 0.2); }
    .filter-highlight-18 { background: rgba(123, 104, 238, 0.2); }
    .filter-highlight-19 { background: rgba(199, 21, 133, 0.2); }
    .custom-highlight {
      border-radius: 2px;
      padding: 0 1px;
    }
    .search-highlight { background: rgba(255, 59, 48, 0.25); }
    .current-search-highlight { background: rgba(255, 59, 48, 0.5); }
    `;
      }

      // 暴露到全局作用域，供HTML onclick使用
      window.exportFilteredAsHTML = exportFilteredAsHTML;
      window.generateFilteredHTML = generateFilteredHTML;

      // 降级复制方案（兼容旧浏览器）- 过滤结果框
      function fallbackCopyFilteredTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          const successful = document.execCommand('copy');
          if (successful) {
            showMessage(`已复制 ${filteredPanelAllLines.length} 行过滤结果到剪贴板`);
          } else {
            showMessage("复制失败，请手动选择并复制");
          }
        } catch (err) {
          console.error('降级复制方案失败:', err);
          showMessage("复制失败，请手动选择并复制");
        }
        
        document.body.removeChild(textArea);
      }

      // 页面加载完成后初始化
      window.addEventListener("DOMContentLoaded", init);

      // Electron API 集成
      if (typeof window.electronAPI !== 'undefined') {
        // 监听文件变化
        if (typeof window.electronAPI.onFileChanged === 'function') {
          window.electronAPI.onFileChanged((data) => {
            console.log('文件变化:', data.filePath);
            // 自动刷新当前文件
            if (currentFile && currentFile.path === data.filePath) {
              refreshCurrentFile();
            }
          });
        }

        // 监听文件删除
        if (typeof window.electronAPI.onFileDeleted === 'function') {
          window.electronAPI.onFileDeleted((data) => {
            console.log('文件删除:', data.filePath);
            // 关闭已删除的文件
            closeFile(data.filePath);
          });
        }

        // 监听解析进度
        if (typeof window.electronAPI.onParseProgress === 'function') {
          window.electronAPI.onParseProgress((progress) => {
            console.log('解析进度:', progress);
            // 显示进度条
            showProgressBar(progress.percentage || 0);
          });
        }
      }

      // 窗口控制函数
      function minimizeWindow() {
        if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
          window.electronAPI.windowControl.minimize();
        }
      }

      function maximizeWindow() {
        if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
          window.electronAPI.windowControl.maximize();
        }
      }

      function closeWindow() {
        if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
          window.electronAPI.windowControl.close();
        }
      }

      // 使用 Worker 解析大文件的函数
      async function parseLargeFileWithWorker(filePath) {
        if (typeof window.electronAPI !== 'undefined') {
          try {
            const result = await window.electronAPI.parseLargeFile(filePath);
            return result;
          } catch (error) {
            console.error('Worker 解析失败:', error);
            // 回退到普通解析
            return null;
          }
        }
        return null;
      }
      
      // 监控文件变化的函数
      function watchFile(filePath) {
        if (typeof window.electronAPI !== 'undefined') {
          window.electronAPI.watchFile(filePath);
        }
      }
      
      // 停止监控文件
      function unwatchFile(filePath) {
        if (typeof window.electronAPI !== 'undefined') {
          window.electronAPI.unwatchFile(filePath);
        }
      }
      
      // 刷新当前文件
      function refreshCurrentFile() {
        if (currentFile) {
          // 重新加载文件内容
          loadLogFile(currentFile.name, currentFile.content);
        }
      }
      
      // 显示进度条
      function showProgressBar(percentage) {
        // 创建或更新进度条
        let progressBar = document.getElementById('parse-progress-bar');
        if (!progressBar) {
          progressBar = document.createElement('div');
          progressBar.id = 'parse-progress-bar';
          progressBar.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: rgba(0, 113, 227, 0.2);
            z-index: 10000;
          `;
          document.body.appendChild(progressBar);
        }
        
        const progressFill = progressBar.querySelector('.progress-fill') || 
          (() => {
            const fill = document.createElement('div');
            fill.className = 'progress-fill';
            fill.style.cssText = `
              height: 100%;
              background: #0071e3;
              transition: width 0.3s ease;
            `;
            progressBar.appendChild(fill);
            return fill;
          })();
        
        progressFill.style.width = percentage + '%';
        
        if (percentage >= 100) {
          setTimeout(() => {
            progressBar.remove();
          }, 500);
        }
      }
    
// ==================== ripgrep 过滤函数 ====================

/**
 * 检查是否是有效的磁盘路径
 * @param {string} path - 文件路径
 * @returns {boolean} 是否是有效的磁盘路径（非压缩包）
 */
function hasValidDiskPath(path) {
  if (!path) return false;

  // Windows 绝对路径: C:\... 或 E:\...
  if (/^[A-Za-z]:\\/.test(path)) {
    // 检查是否包含压缩包标记（使用冒号或反斜杠/正斜杠）
    const archivePatterns = [
      /\.zip:/i, /\.zip[\/\\]/i,
      /\.7z:/i, /\.7z[\/\\]/i,
      /\.tar:/i, /\.tar[\/\\]/i,
      /\.gz:/i, /\.gz[\/\\]/i,
      /\.rar:/i, /\.rar[\/\\]/i,
      /\.bz2:/i, /\.bz2[\/\\]/i
    ];

    for (const pattern of archivePatterns) {
      if (pattern.test(path)) {
        console.log(`[hasValidDiskPath] 路径包含压缩包标记，无效: ${path}`);
        return false;
      }
    }

    return true;
  }

  return false;
}

/**
 * 🚀 使用 Worker 池并行解析 ripgrep 输出
 * @param {string} ripgrepOutput - ripgrep 的原始输出
 * @param {Array} fileHeaders - 文件头信息数组
 * @param {number} maxWorkers - 最大 Worker 数量（默认 9）
 * @returns {Promise<{matches: Array, errors: Array}>}
 */
async function parseRipgrepOutputParallel(ripgrepOutput, fileHeaders, maxWorkers = 9) {
  const startTime = performance.now();

  // 计算总长度和行数
  const totalLength = ripgrepOutput.length;
  const lineCount = ripgrepOutput.split('\n').length;

  // ⚡ 智能调整 Worker 数量：小数据用单线程更快（避免 Worker 创建开销）
  let optimalWorkers = maxWorkers;
  if (lineCount < 1000) {
    optimalWorkers = 1;  // 小数据：单线程更快
  } else if (lineCount < 10000) {
    optimalWorkers = Math.min(2, maxWorkers);
  } else if (lineCount < 50000) {
    optimalWorkers = Math.min(4, maxWorkers);
  } else if (lineCount < 100000) {
    optimalWorkers = Math.min(6, maxWorkers);
  } else {
    optimalWorkers = Math.min(9, maxWorkers);  // 超大数据：使用最多 9 个 Workers
  }

  console.log(`[Ripgrep Worker Pool] 输入: ${totalLength} 字节, 约 ${lineCount} 行, 使用 ${optimalWorkers} 个 Workers`);

  // 将输出分成 N 块（按行数均分）
  const chunkSize = Math.ceil(lineCount / optimalWorkers);
  const chunks = [];

  // 分块（找到换行符位置，避免在行中间分割）
  let startPos = 0;
  for (let i = 0; i < optimalWorkers; i++) {
    const isLast = i === optimalWorkers - 1;
    const endPos = isLast ? totalLength : findNthNewline(ripgrepOutput, startPos, chunkSize);

    chunks.push(ripgrepOutput.substring(startPos, endPos));
    startPos = endPos;

    if (isLast) break;
  }

  console.log(`[Ripgrep Worker Pool] 已分成 ${chunks.length} 块`);

  // 内联 Worker 代码
  const workerCode = `
    self.onmessage = function(e) {
      const { chunkId, chunkData, fileHeaders } = e.data;
      const matches = [];
      const errors = [];

      try {
        // 构建路径映射
        const headerMap = new Map();
        for (const h of fileHeaders) {
          if (h.filePath) headerMap.set(h.filePath, h);
          if (h.fileName) headerMap.set(h.fileName, h);
        }

        // 逐行解析
        const lines = chunkData.split('\\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line || line.trim() === '') continue;

          // 解析格式：filePath:lineNumber:content
          const firstColonIndex = line.indexOf(':');
          if (firstColonIndex === -1) continue;

          const isWindowsPath = firstColonIndex === 1 && line.length > 2 && line[1] === ':' &&
                                 ((line[0] >= 'A' && line[0] <= 'Z') || (line[0] >= 'a' && line[0] <= 'z'));

          let filePathEndIndex = isWindowsPath ?
            line.indexOf(':', firstColonIndex + 1) : firstColonIndex;

          if (filePathEndIndex === -1) continue;

          // 查找行号
          let lineNumberStart = -1;
          for (let j = filePathEndIndex + 1; j < line.length; j++) {
            if (line[j] >= '0' && line[j] <= '9') {
              let k = j;
              while (k < line.length && line[k] >= '0' && line[k] <= '9') k++;

              if (k < line.length && line[k] === ':') {
                lineNumberStart = j;
                break;
              }
              j = k;
            }
          }

          if (lineNumberStart === -1) continue;

          const lineNumberEndColon = line.indexOf(':', lineNumberStart);
          const filePath = line.substring(0, filePathEndIndex);
          const lineNumberStr = line.substring(lineNumberStart, lineNumberEndColon);

          if (!/^\\d+$/.test(lineNumberStr)) continue;

          const lineNumber = parseInt(lineNumberStr, 10);

          // 查找对应的 header
          let header = headerMap.get(filePath);
          if (!header) {
            const fileName = filePath.split(/[/\\\\]/).pop();
            header = headerMap.get(fileName);
          }

          if (header) {
            const originalIndex = header.startIndex + lineNumber;
            matches.push({
              originalIndex,
              content: line.substring(lineNumberEndColon + 1)
            });
          }
        }

        self.postMessage({
          chunkId,
          success: true,
          matches,
          errorCount: errors.length
        });
      } catch (error) {
        self.postMessage({
          chunkId,
          success: false,
          error: error.message
        });
      }
    };
  `;

  // 创建 Blob URL
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);

  // 启动 Workers
  const workerPromises = chunks.map((chunk, index) => {
    return new Promise((resolve) => {
      const worker = new Worker(workerUrl);

      worker.onmessage = (e) => {
        const { chunkId, success, matches, error } = e.data;
        worker.terminate();

        if (success) {
          resolve({ chunkId, matches, error: null });
        } else {
          resolve({ chunkId, matches: [], error });
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        resolve({ chunkId: index, matches: [], error: err.message });
      };

      worker.postMessage({
        chunkId: index,
        chunkData: chunk,
        fileHeaders: fileHeaders
      });
    });
  });

  // 等待所有 Workers 完成
  const results = await Promise.all(workerPromises);

  // 清理 Blob URL
  URL.revokeObjectURL(workerUrl);

  // 合并结果
  const allMatches = [];
  const allErrors = [];

  for (const result of results) {
    if (result.matches) {
      allMatches.push(...result.matches);
    }
    if (result.error) {
      allErrors.push(result.error);
    }
  }

  const elapsed = performance.now() - startTime;
  console.log(`[Ripgrep Worker Pool] ✓ 完成: ${allMatches.length} 个匹配, 耗时 ${elapsed.toFixed(2)}ms`);

  return { matches: allMatches, errors: allErrors };
}

/**
 * 辅助函数：找到第 n 个换行符的位置
 */
function findNthNewline(str, startPos, n) {
  let count = 0;
  for (let i = startPos; i < str.length; i++) {
    if (str[i] === '\n') {
      count++;
      if (count >= n) {
        return i + 1; // 返回换行符之后的位置
      }
    }
  }
  return str.length; // 如果找不到，返回字符串末尾
}

/**
 * 使用 ripgrep 进行异步过滤
 */
async function applyFilterWithRipgrepAsync(filterText) {
  try {
    console.log('[Ripgrep Filter] 开始过滤:', filterText);

    // 🔧 检查是否来自压缩包 - 压缩包内容必须使用Worker过滤，ripgrep无法处理
    // 🔧 修复：检查所有文件，而不只是第一个文件
    if (typeof currentFiles !== 'undefined' && currentFiles && currentFiles.length > 0) {
      for (const file of currentFiles) {
        if (!file) continue;

        // 检查压缩包特有的属性
        if (file.archiveName || file.fromArchive) {
          console.log('[Ripgrep Filter] 文件来自压缩包，跳过ripgrep，使用Worker过滤');
          // 返回false，让调用者使用Worker过滤
          return false;
        }

        // 检查路径是否包含压缩包标记（如 "archive.zip:file.log"）
        if (file.path) {
          // Unix/Linux 格式: archive.zip:internal/path.txt
          const archivePatterns = [/\.zip:/i, /\.7z:/i, /\.tar:/i, /\.gz:/i, /\.rar:/i, /\.bz2:/i];
          for (const pattern of archivePatterns) {
            if (pattern.test(file.path)) {
              console.log('[Ripgrep Filter] 路径包含压缩包标记，跳过ripgrep，使用Worker过滤');
              return false;
            }
          }
          // Windows 格式: archive.zip\internal\path.txt
          if (/^[A-Za-z]:\\/.test(file.path)) {
            const archivePatternsWin = [/\.zip[\/\\]/i, /\.7z[\/\\]/i, /\.tar[\/\\]/i, /\.gz[\/\\]/i, /\.rar[\/\\]/i, /\.bz2[\/\\]/i];
            for (const pattern of archivePatternsWin) {
              if (pattern.test(file.path)) {
                console.log('[Ripgrep Filter] 路径包含Windows压缩包标记，跳过ripgrep，使用Worker过滤');
                return false;
              }
            }
          }
        }
      }
    }

    // 🔧 添加到过滤历史（确认可以执行ripgrep过滤之后）
    addToFilterHistory(filterText);

    // 显示加载状态
    const statusEl = document.getElementById('status');
    const filteredCountEl = document.getElementById('filteredCount');

    if (statusEl) statusEl.textContent = '⏳ ripgrep过滤中...';

    const startTime = performance.now();

    // 构建文件路径列表
    const files = currentFiles.map(f => f.path);
    console.log(`[Ripgrep Filter] 搜索 ${files.length} 个文件`);
    console.log(`[Ripgrep Filter] 文件列表:`, files);

    // 🔧 修复：直接使用原始关键词，ripgrep会自动处理空格
    // - ripgrep会把输入当作正则表达式
    // - 空格会匹配空格字符
    // - 例如："battery l" 只匹配 "battery l"，不会匹配 "batt_last"

    // P1-3: 排除过滤 — 分离正/负关键词，ripgrep 只搜索正面词
    const rgParts = filterText.split(/(?<!\\)\|/).map(s => s.replace(/\\\|/g, '|').trim()).filter(Boolean);
    const rgPositiveParts = [];
    const rgNegativeParts = [];
    for (const part of rgParts) {
      if (part.startsWith('-') || part.startsWith('!')) {
        const neg = part.substring(1);
        if (neg) rgNegativeParts.push(neg);
      } else {
        rgPositiveParts.push(part);
      }
    }

    // ripgrep 模式只包含正面关键词
    let rgPattern;
    if (rgPositiveParts.length === 0) {
      // 只有排除词时，ripgrep 无法执行"匹配所有行再排除"的逻辑，回退到 Worker
      console.log('[Ripgrep Filter] 只有排除关键词，回退到 Worker 过滤');
      return false;
    }
    rgPattern = rgPositiveParts.join('|');

    // 编译负面关键词模式（用于后过滤）
    const compileRgPattern = (kw) => {
      const hasRegexSpecialChars = /[.*+?^${}()|[\]\\]/.test(kw);
      if (!hasRegexSpecialChars) {
        return (lineContent) => lineContent.includes(kw);
      }
      try {
        const regex = new RegExp(kw, 'i');
        return (lineContent) => regex.test(lineContent);
      } catch (e) {
        return (lineContent) => lineContent.includes(kw);
      }
    };
    const negativePatternTests = rgNegativeParts.map(compileRgPattern);

    // ⚡ 性能优化：添加 ripgrep 性能参数
    // 🚀 重要：动态调整匹配数量限制，防止内存溢出和渲染进程崩溃
    // 策略：根据文件数量动态调整每个文件的匹配数上限
    // 🚀 修复连续过滤崩溃：大幅降低上限，确保总结果数 < 1 万条
    const fileCount = files.length;
    let maxMatchesPerFile;

    if (fileCount <= 5) {
      maxMatchesPerFile = 2000;   // 少文件：每文件 2 千条 → 最多 1 万条 (降低 60%)
    } else if (fileCount <= 10) {
      maxMatchesPerFile = 1000;   // 中等文件：每文件 1 千条 → 最多 1 万条 (降低 50%)
    } else if (fileCount <= 20) {
      maxMatchesPerFile = 500;    // 多文件：每文件 5 百条 → 最多 1 万条 (降低 50%)
    } else if (fileCount <= 30) {
      maxMatchesPerFile = 300;    // 超多文件：每文件 3 百条 → 最多 9 千条 (降低 40%)
    } else {
      maxMatchesPerFile = 100;    // 极多文件：每文件 1 百条
    }

    const estimatedTotalMatches = fileCount * maxMatchesPerFile;
    console.log(`[Ripgrep Filter] 文件数: ${fileCount}，每文件限制: ${maxMatchesPerFile} 条，预估总数: ~${estimatedTotalMatches} 条`);

    const args = [
      rgPattern,
      '--line-number',
      '--with-filename',
      '--no-heading',
      '-n',
      '--color', 'never',
      '-a',                 // 🔧 将二进制文件视为文本（强制搜索 .DAT 等文件）
      '--no-config',        // ⚡ 跳过配置文件加载
      '--mmap',             // ⚡ 使用内存映射（在某些系统上更快）
      '--encoding', 'utf-8', // ⚡ 明确编码，避免检测
      `--max-count=${maxMatchesPerFile}`,  // 🚀 限制每个文件的匹配数，防止内存溢出
    ];

    args.push('--');
    args.push(...files);

    console.log('[Ripgrep Filter] 原始关键词:', filterText);
    console.log('[Ripgrep Filter] rgPattern:', rgPattern);
    console.log('[Ripgrep Filter] 执行命令: rg.exe', args.slice(0, 5).join(' '), '...');
    console.log('[Ripgrep Filter] 完整参数:', args);

    // ⏱️ 记录 ripgrep 执行时间
    const rgStartTime = performance.now();

    // 调用 rg（ripgrep 内部已经多线程优化，单进程即可）
    const result = await window.electronAPI.callRG({
      execPath: './rg.exe',
      args: args
    });

    const rgElapsed = performance.now() - rgStartTime;
    console.log(`[Ripgrep Filter] ⏱️ ripgrep 执行耗时: ${rgElapsed.toFixed(2)}ms (单进程，ripgrep 内部并行)`);

    console.log('[Ripgrep Filter] 执行结果 success:', result.success);
    if (!result.success) {
      console.error('[Ripgrep Filter] 执行失败 error:', result.error);
      console.error('[Ripgrep Filter] 执行失败 stderr:', result.stderr);
      throw new Error(result.error || 'ripgrep 执行失败');
    }

    // 🚀 安全检查：检测输出大小，防止内存溢出
    const outputSize = result.stdout ? result.stdout.length : 0;
    console.log('[Ripgrep Filter] 输出长度:', outputSize);

    if (outputSize > 100 * 1024 * 1024) {  // > 100MB
      console.warn(`[Ripgrep Filter] ⚠️ 输出数据过大 (${(outputSize / 1024 / 1024).toFixed(2)}MB)，可能导致内存问题`);
      showMessage(`⚠️ 搜索结果过多，已限制每个文件最多 ${maxMatchesPerFile} 条匹配。请尝试更精确的关键词。`);
    } else if (outputSize > 50 * 1024 * 1024) {  // > 50MB
      console.warn(`[Ripgrep Filter] ⚠️ 输出数据较大 (${(outputSize / 1024 / 1024).toFixed(2)}MB)`);
    }

    console.log('[Ripgrep Filter] stderr:', result.stderr);

    // 🔧 调试：显示前500字符的原始输出
    if (result.stdout && result.stdout.length > 0) {
      console.log('[Ripgrep Filter] 原始输出前500字符:', result.stdout.substring(0, 500));
    }

    // ⚡ 性能优化：构建文件路径到 fileHeader 的映射缓存
    // 这样可以将 O(n) 的查找变成 O(1)，对于 13 万个匹配可以节省大量时间
    const filePathToHeaderMap = new Map();
    const fileHeadersArray = [];  // 用于传递给 Worker
    for (let i = 0; i < fileHeaders.length; i++) {
      const header = fileHeaders[i];
      if (header && header.filePath) {
        filePathToHeaderMap.set(header.filePath, header);
        filePathToHeaderMap.set(header.fileName, header);
        fileHeadersArray.push({
          filePath: header.filePath,
          fileName: header.fileName,
          startIndex: header.startIndex
        });
      }
    }
    console.log(`[Ripgrep Filter] 已构建 ${filePathToHeaderMap.size} 个文件路径缓存`);

    // 🔧 统一换行符
    const normalizedOutput = result.stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 🚀 安全检查：如果输出仍然太大，拒绝处理
    const lineCount = normalizedOutput.split('\n').length;
    console.log(`[Ripgrep Filter] 解析行数: ${lineCount}`);

    if (lineCount > 500000) {  // 超过 50 万行
      const errorMsg = `搜索结果过多（${lineCount.toLocaleString()} 行），已超出处理限制。请使用更精确的关键词。`;
      console.error(`[Ripgrep Filter] ${errorMsg}`);
      showMessage(`⚠️ ${errorMsg}`);

      // 清空过滤面板，显示错误信息
      const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
      if (filteredPanelVirtualContent) {
        filteredPanelVirtualContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">搜索结果过多，请使用更精确的关键词</div>';
      }
      return;  // 终止处理
    }

    // 🚀 使用 Worker 池并行解析（最多 9 个 Workers）
    const parseStartTime = performance.now();
    const { matches, errors } = await parseRipgrepOutputParallel(normalizedOutput, fileHeadersArray);
    const parseElapsed = performance.now() - parseStartTime;

    console.log(`[Ripgrep Filter] Worker 池并行解析完成: ${matches.length} 个匹配, 耗时 ${parseElapsed.toFixed(2)}ms`);
    if (errors.length > 0) {
      console.warn(`[Ripgrep Filter] 解析过程中的 ${errors.length} 个错误已忽略`);
    }

    /* 旧的串行解析代码（已替换为并行版本）
    const matches = [];
    const lines = normalizedOutput.split('\n');
    console.log('[Ripgrep Filter] 分割后行数:', lines.length);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (!line || line.trim() === '') continue;

      // 🔧 使用智能字符串操作解析 rg 输出格式
      // rg 的输出格式：filePath:lineNumber:content
      // 需要处理 Windows 路径中的驱动器号（如 D:\）和内容中包含的冒号
      // 策略：找到路径后的第一个 "数字:" 模式作为行号

      // 查找第一个冒号的位置（用于分隔路径和行号）
      const firstColonIndex = line.indexOf(':');
      if (firstColonIndex === -1) {
        if (matches.length < 5) {
          console.warn('[Ripgrep Filter] 跳过无法解析的行（无冒号）:', line.substring(0, 150));
        }
        continue;
      }

      // 检查是否是 Windows 路径（驱动器号格式，如 "D:"）
      const isWindowsPath = firstColonIndex === 1 && line.length > 2 && line[1] === ':' &&
                             ((line[0] >= 'A' && line[0] <= 'Z') || (line[0] >= 'a' && line[0] <= 'z'));

      let filePathEndIndex;

      if (isWindowsPath) {
        // Windows 路径：格式为 "D:\path:123:content" 或 "D:\path\file.txt:123:content"
        // 需要跳过驱动器号后的第一个冒号，找到下一个冒号（行号前的冒号）
        const afterDriveColon = line.indexOf(':', firstColonIndex + 1);
        if (afterDriveColon === -1) {
          if (matches.length < 5) {
            console.warn('[Ripgrep Filter] 跳过无法解析的行（Windows路径但只有一个冒号）:', line.substring(0, 150));
          }
          continue;
        }
        filePathEndIndex = afterDriveColon;
      } else {
        // 非 Windows 路径：第一个冒号就是路径结束
        filePathEndIndex = firstColonIndex;
      }

      // 从 filePathEndIndex + 1 开始，查找 "数字:" 模式
      // 这是行号的开始位置
      let lineNumberStart = -1;

      for (let i = filePathEndIndex + 1; i < line.length; i++) {
        // 检查是否是数字开头
        if (line[i] >= '0' && line[i] <= '9') {
          // 找到数字序列的结束位置
          let j = i;
          while (j < line.length && line[j] >= '0' && line[j] <= '9') {
            j++;
          }

          // 检查数字后面是否跟着冒号
          if (j < line.length && line[j] === ':') {
            lineNumberStart = i;
            break;
          }

          // 如果不是，继续搜索
          i = j;
        }
      }

      if (lineNumberStart === -1) {
        if (matches.length < 5) {
          console.warn('[Ripgrep Filter] 跳过无法解析的行（找不到数字:行号模式）:', line.substring(0, 150));
        }
        continue;
      }

      // 找到行号后的冒号位置
      const lineNumberEndColon = line.indexOf(':', lineNumberStart);
      const filePath = line.substring(0, filePathEndIndex);
      const lineNumberStr = line.substring(lineNumberStart, lineNumberEndColon);
      const content = line.substring(lineNumberEndColon + 1);

      // 再次验证行号是否为纯数字
      if (!/^\d+$/.test(lineNumberStr)) {
        if (matches.length < 5) {
          console.warn('[Ripgrep Filter] 跳过无法解析的行（行号验证失败）:', line.substring(0, 150));
        }
        continue;
      }

      const lineNumber = parseInt(lineNumberStr, 10);

      matches.push({
        filePath,
        lineNumber,
        content
      });
    }

    console.log(`[Ripgrep Filter] 找到 ${matches.length} 个匹配`);
    */

    // 转换为 originalLines 的索引
    // Worker 已经返回了 originalIndex 和 content，直接使用
    const mapStartTime = performance.now();
    const filteredToOriginalIndex = [];
    const filteredLines = [];

    for (const match of matches) {
      if (match.originalIndex >= 0 && match.originalIndex < originalLines.length) {
        filteredToOriginalIndex.push(match.originalIndex);
        // 使用 Worker 返回的 content，或者从 originalLines 获取
        filteredLines.push(match.content || originalLines[match.originalIndex]);
      }
    }

    console.log(`[Ripgrep Filter] 映射成功: ${filteredToOriginalIndex.length} / ${matches.length}`);

    // 按原始索引排序（Worker 并行处理的结果可能是乱序的）
    const combined = filteredToOriginalIndex.map((idx, i) => ({
      index: idx,
      line: filteredLines[i]
    }));
    combined.sort((a, b) => a.index - b.index);

    // 🚀 去重：根据 index 去除重复项（相同行号的重复结果）
    const uniqueCombined = [];
    const seenIndices = new Set();
    for (const item of combined) {
      if (!seenIndices.has(item.index)) {
        seenIndices.add(item.index);
        uniqueCombined.push(item);
      }
    }

    const duplicatesCount = combined.length - uniqueCombined.length;
    if (duplicatesCount > 0) {
      console.log(`[Ripgrep Filter] 去重: 移除 ${duplicatesCount} 个重复项`);
    }

    // 🚀 添加文件头：在去重后的结果中插入文件头
    const resultWithHeaders = [];
    let lastFileStartIndex = -1;

    for (const item of uniqueCombined) {
      const originalIndex = item.index;

      // 查找这个行所属的文件头
      for (const header of fileHeaders) {
        if (originalIndex >= header.startIndex && originalIndex < header.startIndex + header.lineCount + 1) {
          // 检查是否需要插入文件头（当切换到新文件时）
          if (header.startIndex !== lastFileStartIndex) {
            // 插入文件头
            const headerLine = `=== 文件: ${header.fileName} (${header.lineCount} 行)${header.filePath ? ' data-path="' + header.filePath + '"' : ''} ===`;
            resultWithHeaders.push({
              index: header.startIndex,
              line: headerLine
            });
            lastFileStartIndex = header.startIndex;
          }
          break;
        }
      }

      // 添加实际的匹配行
      resultWithHeaders.push(item);
    }

    const sortedIndices = resultWithHeaders.map(x => x.index);
    const sortedLines = resultWithHeaders.map(x => x.line);

    // P1-3: 负面关键词后过滤 — 排除包含负面关键词的行（保留文件头）
    if (negativePatternTests.length > 0) {
      const beforeCount = sortedLines.length;
      const filteredResult = [];
      for (let i = 0; i < sortedLines.length; i++) {
        const line = sortedLines[i];
        // 文件头行始终保留
        if (line.startsWith("=== 文件:")) {
          filteredResult.push({ index: sortedIndices[i], line: line });
          continue;
        }
        let excluded = false;
        for (const testFn of negativePatternTests) {
          if (testFn(line)) {
            excluded = true;
            break;
          }
        }
        if (!excluded) {
          filteredResult.push({ index: sortedIndices[i], line: line });
        }
      }
      // 重建 sortedIndices 和 sortedLines
      sortedIndices.length = 0;
      sortedLines.length = 0;
      for (const item of filteredResult) {
        sortedIndices.push(item.index);
        sortedLines.push(item.line);
      }
      console.log(`[Ripgrep Filter] P1-3 排除过滤: ${beforeCount} → ${sortedLines.length} 行 (排除 ${beforeCount - sortedLines.length} 行)`);
    }

    // 🚀 修复连续过滤内存泄漏：添加硬性限制，防止内存溢出
    // 如果结果超过 15000 条，主动截断并警告用户
    const MAX_FILTER_RESULTS = 15000;
    let wasTruncated = false;

    if (sortedIndices.length > MAX_FILTER_RESULTS) {
      console.warn(`[Ripgrep Filter] 结果过多 (${sortedIndices.length} 条)，截断到 ${MAX_FILTER_RESULTS} 条以防止内存溢出`);

      // 截断数组
      sortedIndices.length = MAX_FILTER_RESULTS;
      sortedLines.length = MAX_FILTER_RESULTS;
      wasTruncated = true;
    }

    // 🚀 修复连续过滤内存泄漏：清理中间数组
    // 这些大数组不再需要，显式清空帮助垃圾回收
    // 注意：const 声明的数组可以清空内容，但不能重新赋值
    resultWithHeaders.length = 0;  // 清空 resultWithHeaders 数组
    uniqueCombined.length = 0;  // 清空 uniqueCombined 数组
    combined.length = 0;  // 清空 combined 数组
    filteredToOriginalIndex.length = 0;  // 清空 filteredToOriginalIndex 数组
    filteredLines.length = 0;  // 清空 filteredLines 数组

    const mapElapsed = performance.now() - mapStartTime;
    console.log(`[Ripgrep Filter] ⏱️ 映射+排序耗时: ${mapElapsed.toFixed(2)}ms`);

    // 更新过滤状态
    currentFilter = {
      filteredLines: sortedLines,
      filteredToOriginalIndex: sortedIndices,
      filterKeywords: filterText.split('|').map(k => k.trim()).filter(k => k),
      totalLines: sortedLines.length
    };

    // 更新过滤面板
    // 🚀 修复连续过滤内存泄漏：先显式清空旧数组，释放内存
    if (Array.isArray(filteredPanelAllLines)) {
      filteredPanelAllLines.length = 0;
    }
    if (Array.isArray(filteredPanelAllOriginalIndices)) {
      filteredPanelAllOriginalIndices.length = 0;
    }
    if (Array.isArray(filteredPanelAllPrimaryIndices)) {
      filteredPanelAllPrimaryIndices.length = 0;
    }

    filteredPanelAllLines = sortedLines;
    filteredPanelAllOriginalIndices = sortedIndices;
    filteredPanelAllPrimaryIndices = [];

    // 🚀 性能优化：预计算文件头索引集合，避免每行都执行 startsWith 检查
    // 这确保了文件头能正确显示绿色背景
    fileHeaderIndices.clear();
    for (let i = 0; i < filteredPanelAllLines.length; i++) {
      if (filteredPanelAllLines[i] && filteredPanelAllLines[i].startsWith("=== 文件:")) {
        fileHeaderIndices.add(i);
      }
    }
    console.log(`[Ripgrep Filter] 预计算了 ${fileHeaderIndices.size} 个文件头索引`);

    // 🚀 修复连续过滤内存泄漏：清理高亮缓存
    // 每次过滤前清理 highlightCache，避免累积导致内存泄漏
    if (typeof highlightCache !== 'undefined' && highlightCache.clear) {
      highlightCache.clear();
      console.log('[Ripgrep Filter] 已清理高亮缓存，防止内存泄漏');
    }

    // 🔧 修复：清空主日志框的 HTML 解析缓存，确保过滤关键词不会在主日志框中高亮
    if (typeof clearHtmlParseCache === 'function') {
      clearHtmlParseCache();
      console.log('[Ripgrep Filter] 已清空主日志框 HTML 缓存，防止过滤关键词污染');
    }

    // 更新UI
    if (filteredCountEl) {
      filteredCountEl.textContent = sortedIndices.length.toString();
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    if (statusEl) {
      statusEl.textContent = `✓ ripgrep: ${sortedIndices.length}个匹配 (${elapsed}秒)`;
    }

    // 🔧 显示过滤耗时
    const filteredTimeEl = document.getElementById('filteredTime');
    if (filteredTimeEl) {
      const elapsedMs = (performance.now() - startTime);
      filteredTimeEl.textContent = elapsedMs >= 1000
        ? `(${(elapsedMs / 1000).toFixed(2)}s)`
        : `(${elapsedMs.toFixed(0)}ms)`;
    }

    // 更新占位符高度
    const filteredPanelPlaceholder = DOMCache.get('filteredPanelPlaceholder');
    if (filteredPanelPlaceholder) {
      filteredPanelPlaceholder.style.height = (sortedIndices.length * filteredPanelLineHeight) + 'px';
    }

    // 清空虚拟内容
    // 🚀 性能优化：使用 DOM 缓存
    const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
    if (filteredPanelVirtualContent) {
      // 🚀 修复连续过滤内存泄漏：强制清理 DOM 节点
      // 先移除所有子节点，释放内存
      while (filteredPanelVirtualContent.firstChild) {
        const child = filteredPanelVirtualContent.firstChild;
        filteredPanelVirtualContent.removeChild(child);
      }
      filteredPanelVirtualContent.innerHTML = '';
    }

    // 🔧 修复：重置虚拟滚动状态，确保重复过滤时不会因范围相同而跳过渲染
    filteredPanelVisibleStart = -1;
    filteredPanelVisibleEnd = -1;
    filteredPanelScrollPosition = 0;
    if (filteredPanelContent) {
      filteredPanelContent.scrollTop = 0;
    }

    // 🚀 性能优化：分批渲染，彻底避免黑屏
    // 策略：
    // 1. 先立即显示无高亮的纯文本（快速响应）
    // 2. 然后在多个 requestAnimationFrame 中分批应用高亮
    const resultCount = sortedIndices.length;
    console.log(`[Ripgrep Filter] 准备渲染 ${resultCount} 条结果`);

    // 标记：首次渲染（无高亮）
    let isFirstRender = true;

    // 分批渲染函数
    const renderBatch = () => {
      if (typeof updateFilteredPanelVisibleLines === 'function') {
        // 强制跳过高亮（首次渲染）
        if (isFirstRender) {
          console.log(`[Ripgrep Filter] 首次渲染：无高亮，纯文本模式`);
          isFirstRender = false;

          // 临时禁用所有高亮
          const originalFilterKeywords = currentFilter.filterKeywords;
          const originalSearchKeyword = filteredPanelSearchKeyword;
          // 🔧 修复：保存完整的 customHighlights 数组内容并恢复，避免永久丢失用户的高亮设置
          const originalCustomHighlights = [...customHighlights];

          currentFilter.filterKeywords = [];  // 禁用主关键词高亮
          filteredPanelSearchKeyword = '';     // 禁用搜索高亮
          customHighlights.length = 0;         // 清空自定义高亮数组（const不能重新赋值）

          // 渲染无高亮版本
          updateFilteredPanelVisibleLines();

          // 恢复高亮设置
          currentFilter.filterKeywords = originalFilterKeywords;
          filteredPanelSearchKeyword = originalSearchKeyword;
          // 🔧 恢复 customHighlights 数组内容
          customHighlights.length = 0;
          originalCustomHighlights.forEach(h => customHighlights.push(h));

          // 延迟应用高亮（在下一帧）
          requestAnimationFrame(() => {
            console.log(`[Ripgrep Filter] 二次渲染：应用高亮`);
            updateFilteredPanelVisibleLines();
          });
        } else {
          // 正常渲染（有高亮）
          updateFilteredPanelVisibleLines();
        }
      }
    };

    if (resultCount > 1000) {
      // 大量结果：延迟后分批渲染
      setTimeout(() => {
        requestAnimationFrame(renderBatch);
      }, 50);
    } else {
      // 小量结果：立即渲染
      renderBatch();
    }

    // 🔧 显示过滤面板（立即显示，不等待渲染完成）
    if (typeof filteredPanel !== 'undefined') {
      filteredPanel.classList.add('visible');

      // 🚀 修复白板问题（包括第二次过滤）：确保在面板显示后重新渲染内容
      // 使用双重 requestAnimationFrame 确保 DOM 已完全更新
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (typeof updateFilteredPanelVisibleLines === 'function') {
            updateFilteredPanelVisibleLines();

            // 🚀 跳转到用户之前点击的行
            // 优先使用过滤面板中点击记录的行，其次使用主日志框中选中的行
            let targetOriginalIndex = -1;

            // 优先级1: 过滤面板中点击的行
            if (typeof lastClickedOriginalIndex !== 'undefined' && lastClickedOriginalIndex >= 0) {
              targetOriginalIndex = lastClickedOriginalIndex;
              console.log(`[Ripgrep Filter] 使用过滤面板点击行: lastClickedOriginalIndex=${lastClickedOriginalIndex}`);
            } else {
              // 优先级2: 主日志框中选中的行
              const outerContainer = DOMCache.get('outerContainer');
              const selectedLine = outerContainer ? outerContainer.querySelector('.log-line.selected') : null;

              if (selectedLine) {
                targetOriginalIndex = parseInt(selectedLine.dataset.index, 10);
                console.log(`[Ripgrep Filter] 使用主日志框选中行: selectedOriginalIndex=${targetOriginalIndex}`);
              }
            }

            console.log(`[Ripgrep Filter] 目标原始索引: targetOriginalIndex=${targetOriginalIndex}, filteredPanelAllOriginalIndices.length=${filteredPanelAllOriginalIndices.length}`);

            if (targetOriginalIndex >= 0) {

              // 打印前 5 个过滤结果的索引，用于调试
              console.log(`[Ripgrep Filter] 过滤结果前5个索引:`, filteredPanelAllOriginalIndices.slice(0, 5));
              console.log(`[Ripgrep Filter] 过滤结果后5个索引:`, filteredPanelAllOriginalIndices.slice(-5));

              // 在过滤结果中查找该行
              let filteredIndex = filteredPanelAllOriginalIndices.indexOf(targetOriginalIndex);
              console.log(`[Ripgrep Filter] 在过滤结果中的位置: filteredIndex=${filteredIndex}`);

              if (filteredIndex < 0) {
                // 🚀 如果没找到精确匹配，找到原始行号最接近的行
                console.log(`[Ripgrep Filter] 📍 目标行不在结果中，使用原始行号查找最接近的行...`);

                // 使用二分查找找到插入位置
                let left = 0;
                let right = filteredPanelAllOriginalIndices.length - 1;
                while (left <= right) {
                  const mid = Math.floor((left + right) / 2);
                  if (filteredPanelAllOriginalIndices[mid] < targetOriginalIndex) {
                    left = mid + 1;
                  } else {
                    right = mid - 1;
                  }
                }

                // left 是应该插入的位置，比较 left 和 left-1 哪个更接近
                if (left >= filteredPanelAllOriginalIndices.length) {
                  // 目标行比所有结果都大，使用最后一个
                  filteredIndex = filteredPanelAllOriginalIndices.length - 1;
                } else if (left === 0) {
                  // 目标行比所有结果都小，使用第一个
                  filteredIndex = 0;
                } else {
                  // 比较左右两个哪个更接近
                  const diffLeft = Math.abs(filteredPanelAllOriginalIndices[left - 1] - targetOriginalIndex);
                  const diffRight = Math.abs(filteredPanelAllOriginalIndices[left] - targetOriginalIndex);
                  filteredIndex = diffLeft <= diffRight ? left - 1 : left;
                }

                const closestOriginalIndex = filteredPanelAllOriginalIndices[filteredIndex];
                console.log(`[Ripgrep Filter] ✓ 找到原始行号最接近的行: filteredIndex=${filteredIndex}, originalIndex=${closestOriginalIndex}, 距离=${Math.abs(closestOriginalIndex - targetOriginalIndex)}`);
              }

              // 跳转到目标行（精确匹配或相对位置）
              const targetScrollTop = filteredIndex * filteredPanelLineHeight;
              const containerHeight = filteredPanelContent.clientHeight;
              // 让目标行显示在页面中间
              const finalScrollTop = Math.max(0, targetScrollTop - containerHeight / 2 + filteredPanelLineHeight / 2);

              console.log(`[Ripgrep Filter] 准备跳转: targetScrollTop=${targetScrollTop}, finalScrollTop=${finalScrollTop}, containerHeight=${containerHeight}`);

              // 🔧 调试：检查滚动状态
              console.log(`[Ripgrep Filter] 跳转前: scrollTop=${filteredPanelContent.scrollTop}, scrollHeight=${filteredPanelContent.scrollHeight}, clientHeight=${filteredPanelContent.clientHeight}`);

              filteredPanelContent.scrollTop = finalScrollTop;
              console.log(`[Ripgrep Filter] ✓ 已设置 scrollTop: ${finalScrollTop}, 目标行: targetOriginalIndex=${targetOriginalIndex}, filteredIndex=${filteredIndex}`);

              // 🚀 等待虚拟滚动更新后，确保目标行被正确渲染和高亮
              // 使用更长的延迟确保 DOM 完全更新
              setTimeout(() => {
                // 🔧 调试：检查滚动是否成功
                console.log(`[Ripgrep Filter] 延迟后: scrollTop=${filteredPanelContent.scrollTop}, 期望值=${finalScrollTop}`);

                if (Math.abs(filteredPanelContent.scrollTop - finalScrollTop) > 100) {
                  console.error(`[Ripgrep Filter] ❌ 滚动位置不正确！可能被其他代码重置`);
                }

                // 再次触发虚拟滚动更新，确保目标行被渲染
                if (typeof updateFilteredPanelVisibleLines === 'function') {
                  updateFilteredPanelVisibleLines();
                }

                // 尝试查找并高亮目标行
                const targetLine = filteredPanelVirtualContent.querySelector(`[data-filtered-index="${filteredIndex}"]`);
                if (targetLine) {
                  targetLine.classList.add('highlighted');
                  console.log(`[Ripgrep Filter] ✓ 已高亮目标行`);
                } else {
                  console.log(`[Ripgrep Filter] ⚠️ 目标行元素未找到，filteredIndex=${filteredIndex}`);
                }
              }, 100);
            } else {
              console.log(`[Ripgrep Filter] 没有找到选中的行，将从顶部开始显示`);
            }
          }
        });
      });

      // 🔧 文件树和过滤面板共存：不再隐藏文件树
    }

    // 🚀 修复连续过滤内存泄漏：尝试触发垃圾回收
    // 注意：gc() 仅在特定 Chrome 标志下可用（--js-flags="--expose-gc"）
    if (typeof gc !== 'undefined' && gc !== null) {
      console.log('[Ripgrep Filter] 尝试触发垃圾回收...');
      gc();
    }

    // 显示完成消息（如果有截断，添加警告）
    const message = wasTruncated
      ? `⚠️ ripgrep过滤完成: ${sortedIndices.length}个匹配 (结果已截断，耗时${elapsed}秒)`
      : `ripgrep过滤完成: ${sortedIndices.length}个匹配 (耗时${elapsed}秒)`;
    showMessage(message);
    console.log(`[Ripgrep Filter] ✓ 完成: ${sortedIndices.length} 个匹配，耗时 ${elapsed}秒`);

    // 🆕 每次过滤后自动最大化过滤面板（尊重用户手动还原的偏好）
    if (!isFilterPanelMaximized && filteredPanelState.userPreference !== 'normal' && typeof toggleFilterPanelMaximize === 'function') {
      console.log('[Ripgrep Filter] 自动最大化过滤面板');
      toggleFilterPanelMaximize();
    }

  } catch (error) {
    console.error('[Ripgrep Filter] 过滤失败:', error);
    showMessage(`ripgrep过滤失败: ${error.message}，使用原有方法`);
    // 降级到原有过滤方法
    // 这里不重新调用，避免无限循环
  }
}

/**
 * 查找文件对应的原始索引（ripgrep 版本）
 */
function findOriginalIndexForFileInRipgrep(filePath, lineNumber) {
  if (typeof fileHeaders === 'undefined') {
    console.error('[findOriginalIndexForFileInRipgrep] fileHeaders is undefined!');
    return -1;
  }

  const fileName = filePath.split(/[/\\]/).pop();

  for (let i = 0; i < fileHeaders.length; i++) {
    const header = fileHeaders[i];

    if (!header) continue;

    // 优先匹配完整路径（如果有）
    if (header.filePath && header.filePath === filePath) {
      const result = header.startIndex + lineNumber;
      return result;
    }

    // 匹配文件名
    if (header.fileName === fileName) {
      const result = header.startIndex + lineNumber;
      return result;
    }

    // 包含匹配：处理 "path/to/file.txt" 和 "file.txt" 的情况
    if (header.fileName) {
      const headerFileName = header.fileName.split(/[/\\]/).pop();
      if (headerFileName === fileName) {
        const result = header.startIndex + lineNumber;
        return result;
      }
    }
  }

  return -1;
}

/**
 * 生成数组的所有排列组合
 * @param {Array} arr - 输入数组
 * @returns {Array} - 所有排列的数组
 */
function getPermutations(arr) {
  if (arr.length <= 1) return [arr];

  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = arr.slice(0, i).concat(arr.slice(i + 1));
    const remainingPermutations = getPermutations(remaining);

    for (const perm of remainingPermutations) {
      result.push([current].concat(perm));
    }
  }

  return result;
}

/**
 * 🚀 使用 ripgrep 从文件列表中异步过滤（过滤模式专用）
 * @param {string} filterText - 过滤关键词
 * @param {Array<string>} filePaths - 文件路径列表
 */
async function applyFilterWithRipgrepOnFiles(filterText, filePaths) {
  try {
    console.log(`[过滤模式] ========== 开始过滤 ==========`);
    console.log(`[过滤模式] 文件数量: ${filePaths.length}`);
    console.log(`[过滤模式] 过滤关键词: "${filterText}"`);
    console.log(`[过滤模式] 前3个文件:`, filePaths.slice(0, 3));

    // 显示加载状态
    const statusEl = document.getElementById('status');
    const filteredCountEl = document.getElementById('filteredCount');

    if (statusEl) statusEl.textContent = '⏳ ripgrep过滤中...';

    const startTime = performance.now();

    // 清空之前的过滤数据
    cleanFilterData();

    // 如果过滤文本为空，直接返回
    if (!filterText.trim()) {
      console.log(`[过滤模式] 过滤文本为空，直接返回`);
      if (statusEl) statusEl.textContent = '';
      return;
    }

    // 🔧 过滤模式：验证所有文件都是普通磁盘文件（不应该包含压缩包文件）
    // 如果包含压缩包文件，说明筛选逻辑有问题，记录警告并跳过这些文件
    const archivePatterns = [
      /\.(zip|tar|gz|7z|rar|bz2):/i,    // Unix格式: archive.zip:internal/path
      /\.(zip|tar|gz|7z|rar|bz2)[\/\\]/i  // Windows格式: archive.zip\internal\path
    ];

    const hasArchiveFiles = filePaths.some(path => {
      return archivePatterns.some(pattern => pattern.test(path));
    });

    if (hasArchiveFiles) {
      console.warn(`[过滤模式] 警告：文件列表中包含压缩包文件，过滤模式不应该处理压缩包文件！`);
      // 🔧 重要：过滤模式不应该处理压缩包文件，因为压缩包内容需要先解压才能用ripgrep搜索
      // 如果出现这种情况，说明调用方有问题，需要返回错误
      console.error(`[过滤模式] 错误：filterModeFileList 不应包含压缩包文件！`);
      return {
        success: false,
        error: '过滤模式不支持压缩包文件'
      };
    }

    // 🔧 添加到过滤历史（确认所有检查通过之后）
    addToFilterHistory(filterText);

    // 🔧 修复：直接使用原始关键词，ripgrep会自动处理空格
    // - ripgrep会把输入当作正则表达式
    // - 空格会匹配空格字符
    // - 例如："battery l" 只匹配 "battery l"，不会匹配 "batt_last"
    const rgPattern = filterText;

    console.log('[过滤模式] 原始关键词:', filterText);
    console.log('[过滤模式] rgPattern:', rgPattern);

    const args = [
      rgPattern,
      '--line-number',
      '--with-filename',
      '--no-heading',
      '-n',
      '--color', 'never',
      '-a',                 // 🔧 将二进制文件视为文本（强制搜索 .DAT 等文件）
    ];

    args.push('--');
    args.push(...filePaths);

    console.log('[过滤模式] 执行命令: rg.exe', args.slice(0, 5).join(' '), '... (共 ' + args.length + ' 个参数)');

    // 调用 rg
    const result = await window.electronAPI.callRG({
      execPath: './rg.exe',
      args: args
    });

    console.log('[过滤模式] rg 执行完成, success:', result.success);
    if (!result.success) {
      console.error('[过滤模式] rg 错误:', result.error);
    } else {
      console.log('[过滤模式] rg 输出长度:', result.stdout ? result.stdout.length : 0);
      console.log('[过滤模式] rg stderr:', result.stderr);
    }

    if (!result.success) {
      throw new Error(result.error || 'ripgrep 执行失败');
    }

    // 解析结果
    const matches = [];
    const lines = result.stdout.trim().split('\n');

    console.log(`[过滤模式] 解析结果，总行数: ${lines.length}`);

    // 🔧 调试：显示前5行原始输出
    console.log(`[过滤模式] 前5行原始输出:`);
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      console.log(`[过滤模式]   ${i + 1}: ${lines[i].substring(0, 200)}`);
    }

    for (const line of lines) {
      if (!line) continue;

      // 🔧 使用智能字符串操作解析 rg 输出格式
      // rg 的输出格式：filePath:lineNumber:content
      // 需要处理 Windows 路径中的驱动器号（如 F:\）和内容中包含的冒号
      // 策略：找到路径后的第一个 "数字:" 模式作为行号

      // 查找第一个冒号的位置（用于分隔路径和行号）
      const firstColonIndex = line.indexOf(':');
      if (firstColonIndex === -1) {
        if (matches.length < 5) {
          console.log(`[过滤模式] 跳过无法解析的行（无冒号）: ${line.substring(0, 150)}`);
        }
        continue;
      }

      // 检查是否是 Windows 路径（驱动器号格式，如 "F:"）
      const isWindowsPath = firstColonIndex === 1 && line.length > 2 && line[1] === ':' &&
                             ((line[0] >= 'A' && line[0] <= 'Z') || (line[0] >= 'a' && line[0] <= 'z'));

      let filePathEndIndex;

      if (isWindowsPath) {
        // Windows 路径：格式为 "F:\path:123:content" 或 "F:\path\file.txt:123:content"
        // 需要跳过驱动器号后的第一个冒号，找到下一个冒号（行号前的冒号）
        const afterDriveColon = line.indexOf(':', firstColonIndex + 1);
        if (afterDriveColon === -1) {
          if (matches.length < 5) {
            console.log(`[过滤模式] 跳过无法解析的行（Windows路径但只有一个冒号）: ${line.substring(0, 150)}`);
          }
          continue;
        }
        filePathEndIndex = afterDriveColon;
      } else {
        // 非 Windows 路径：第一个冒号就是路径结束
        filePathEndIndex = firstColonIndex;
      }

      // 从 filePathEndIndex + 1 开始，查找 "数字:" 模式
      // 这是行号的开始位置
      let lineNumberStart = -1;

      for (let i = filePathEndIndex + 1; i < line.length; i++) {
        // 检查是否是数字开头
        if (line[i] >= '0' && line[i] <= '9') {
          // 找到数字序列的结束位置
          let j = i;
          while (j < line.length && line[j] >= '0' && line[j] <= '9') {
            j++;
          }

          // 检查数字后面是否跟着冒号
          if (j < line.length && line[j] === ':') {
            lineNumberStart = i;
            break;
          }

          // 如果不是，继续搜索
          i = j;
        }
      }

      if (lineNumberStart === -1) {
        if (matches.length < 5) {
          console.log(`[过滤模式] 跳过无法解析的行（找不到数字:行号模式）: ${line.substring(0, 150)}`);
        }
        continue;
      }

      // 找到行号后的冒号位置
      const lineNumberEndColon = line.indexOf(':', lineNumberStart);
      const filePath = line.substring(0, filePathEndIndex);
      const lineNumberStr = line.substring(lineNumberStart, lineNumberEndColon);
      const content = line.substring(lineNumberEndColon + 1);

      // 再次验证行号是否为纯数字
      if (!/^\d+$/.test(lineNumberStr)) {
        if (matches.length < 5) {
          console.log(`[过滤模式] 跳过无法解析的行（行号验证失败）: ${line.substring(0, 150)}`);
        }
        continue;
      }

      const lineNumber = parseInt(lineNumberStr, 10);

      matches.push({
        filePath,
        lineNumber,
        content
      });
    }

    console.log(`[过滤模式] 解析完成，找到 ${matches.length} 个匹配`);

    // 🔧 调试：显示前3个匹配
    if (matches.length > 0) {
      console.log('[过滤模式] 第一个匹配:', matches[0]);
      console.log('[过滤模式] 第二个匹配:', matches[1]);
      console.log('[过滤模式] 第三个匹配:', matches[2]);
    }

    // 🚀 直接构建过滤面板的数据（不依赖 originalLines）
    const filteredLines = [];
    const filteredToOriginalIndex = []; // 在过滤模式下，这只是虚拟索引
    let originalIndexCounter = 0;

    if (matches.length === 0) {
      // 🔧 没有匹配时也要显示过滤面板，并给出提示
      console.log(`[过滤模式] 没有找到匹配项`);

      // 更新过滤面板数据为空数组
      if (typeof filteredPanelAllLines !== 'undefined') {
        filteredPanelAllLines = [];
        filteredPanelAllOriginalIndices = [];
      }

      // 🚀 清空文件头索引
      fileHeaderIndices.clear();

      // 🚀 修复连续过滤内存泄漏：清理高亮缓存
      if (typeof highlightCache !== 'undefined' && highlightCache.clear) {
        highlightCache.clear();
        console.log('[过滤模式] 已清理高亮缓存（空结果）');
      }

      // 显示结果
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      if (filteredCountEl) {
        filteredCountEl.textContent = '0';
      }
      if (statusEl) statusEl.textContent = '';

      // 计算占位符高度（0行）
      const filteredPanelPlaceholder = DOMCache.get('filteredPanelPlaceholder');
      if (filteredPanelPlaceholder) {
        filteredPanelPlaceholder.style.height = '0px';
      }

      // 清空虚拟内容
      const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
      if (filteredPanelVirtualContent) {
        filteredPanelVirtualContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">没有找到匹配的内容</div>';
      }

      // 显示过滤面板
      if (typeof filteredPanel !== 'undefined') {
        filteredPanel.classList.add('visible');

        // 🚀 修复白板问题（包括第二次过滤）：确保内容正确显示
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // 强制重新渲染虚拟内容
            const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
            if (filteredPanelVirtualContent) {
              const currentContent = filteredPanelVirtualContent.innerHTML;
              filteredPanelVirtualContent.innerHTML = currentContent;
            }
          });
        });

        // 🔧 文件树和过滤面板共存：不再隐藏文件树
      }

      // 🔧 设置 currentFilter 以支持二级过滤
      if (typeof currentFilter !== 'undefined') {
        currentFilter = {
          filteredLines: [],
          filteredToOriginalIndex: [],
          filterKeywords: filterText.split('|').map(k => k.trim()).filter(k => k),
          totalLines: 0
        };
        console.log('[过滤模式] currentFilter 已设置（空结果）');
      }

      showMessage(`🔍 过滤完成：没有找到匹配项 (耗时 ${elapsed}秒)`);
      console.log(`[过滤模式] ✓ 完成: 0 个匹配，耗时 ${elapsed}秒`);
      return;
    }

    // 按文件分组
    const matchesByFile = {};
    for (const match of matches) {
      if (!matchesByFile[match.filePath]) {
        matchesByFile[match.filePath] = [];
      }
      matchesByFile[match.filePath].push(match);
    }

    // 🔧 按照 filePaths 的顺序遍历文件（用户选中文件的顺序）
    for (const filePath of filePaths) {
      const fileMatches = matchesByFile[filePath];
      // 跳过没有匹配的文件
      if (!fileMatches || fileMatches.length === 0) continue;

      const fileName = filePath.split(/[/\\]/).pop();

      // 添加文件头
      filteredLines.push(`=== 文件: ${fileName} (${fileMatches.length} 个匹配) ===`);
      filteredToOriginalIndex.push(originalIndexCounter++);

      // 添加匹配的行
      for (const match of fileMatches) {
        filteredLines.push(match.content);
        filteredToOriginalIndex.push(originalIndexCounter++);
      }
    }

    // 更新过滤面板数据
    if (typeof filteredPanelAllLines !== 'undefined') {
      filteredPanelAllLines = filteredLines;
      filteredPanelAllOriginalIndices = filteredToOriginalIndex;
    }

    // 🚀 性能优化：预计算文件头索引集合，避免每行都执行 startsWith 检查
    // 这确保了文件头能正确显示绿色背景
    fileHeaderIndices.clear();
    for (let i = 0; i < filteredPanelAllLines.length; i++) {
      if (filteredPanelAllLines[i] && filteredPanelAllLines[i].startsWith("=== 文件:")) {
        fileHeaderIndices.add(i);
      }
    }
    console.log(`[过滤模式] 预计算了 ${fileHeaderIndices.size} 个文件头索引`);

    // 🚀 修复连续过滤内存泄漏：清理高亮缓存
    if (typeof highlightCache !== 'undefined' && highlightCache.clear) {
      highlightCache.clear();
      console.log('[过滤模式] 已清理高亮缓存');
    }

    // 显示结果
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    if (filteredCountEl) {
      filteredCountEl.textContent = filteredLines.length;
    }
    if (statusEl) statusEl.textContent = '';

    // 计算占位符高度
    const filteredPanelPlaceholder = DOMCache.get('filteredPanelPlaceholder');
    if (filteredPanelPlaceholder) {
      filteredPanelPlaceholder.style.height = (filteredLines.length * filteredPanelLineHeight) + 'px';
    }

    // 清空虚拟内容
    // 🚀 性能优化：使用 DOM 缓存
    const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
    if (filteredPanelVirtualContent) {
      // 🚀 修复连续过滤内存泄漏：强制清理 DOM 节点
      // 先移除所有子节点，释放内存
      while (filteredPanelVirtualContent.firstChild) {
        const child = filteredPanelVirtualContent.firstChild;
        filteredPanelVirtualContent.removeChild(child);
      }
      filteredPanelVirtualContent.innerHTML = '';
    }

    // 更新可见行
    if (typeof updateFilteredPanelVisibleLines === 'function') {
      updateFilteredPanelVisibleLines();
    }

    // 显示过滤面板
    if (typeof filteredPanel !== 'undefined') {
      filteredPanel.classList.add('visible');

      // 🚀 修复白板问题（包括第二次过滤）：确保内容正确显示
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (typeof updateFilteredPanelVisibleLines === 'function') {
            updateFilteredPanelVisibleLines();

            // 🚀 跳转到用户之前点击的行
            // 从主日志框中查找选中的行（.selected 类）
            const outerContainer = DOMCache.get('outerContainer');
            const selectedLine = outerContainer ? outerContainer.querySelector('.log-line.selected') : null;

            console.log(`[过滤模式] 查找选中行: outerContainer=${!!outerContainer}, selectedLine=${!!selectedLine}`);

            if (selectedLine) {
              // 获取选中行的原始索引
              const selectedOriginalIndex = parseInt(selectedLine.dataset.index, 10);
              console.log(`[过滤模式] 选中行原始索引: selectedOriginalIndex=${selectedOriginalIndex}, filteredPanelAllOriginalIndices.length=${filteredPanelAllOriginalIndices.length}`);

              if (!isNaN(selectedOriginalIndex) && selectedOriginalIndex >= 0) {
                // 在过滤结果中查找该行
                const filteredIndex = filteredPanelAllOriginalIndices.indexOf(selectedOriginalIndex);
                console.log(`[过滤模式] 在过滤结果中的位置: filteredIndex=${filteredIndex}`);

                if (filteredIndex >= 0) {
                  // 找到了，跳转到该行
                  const targetScrollTop = filteredIndex * filteredPanelLineHeight;
                  const containerHeight = filteredPanelContent.clientHeight;
                  // 让目标行显示在页面中间
                  const finalScrollTop = Math.max(0, targetScrollTop - containerHeight / 2 + filteredPanelLineHeight / 2);

                  console.log(`[过滤模式] 准备跳转: targetScrollTop=${targetScrollTop}, finalScrollTop=${finalScrollTop}`);

                  filteredPanelContent.scrollTop = finalScrollTop;
                  console.log(`[过滤模式] ✓ 已跳转到选中行: selectedOriginalIndex=${selectedOriginalIndex}, filteredIndex=${filteredIndex}`);
                } else {
                  console.log(`[过滤模式] ✗ 选中行不在过滤结果中: selectedOriginalIndex=${selectedOriginalIndex}`);
                }
              }
            } else {
              console.log(`[过滤模式] 没有找到选中的行，将从顶部开始显示`);
            }
          }
        });
      });

      // 🔧 文件树和过滤面板共存：不再隐藏文件树
    }

    // 🔧 设置 currentFilter 以支持二级过滤
    if (typeof currentFilter !== 'undefined') {
      currentFilter = {
        filteredLines: filteredLines,
        filteredToOriginalIndex: filteredToOriginalIndex,
        filterKeywords: filterText.split('|').map(k => k.trim()).filter(k => k),
        totalLines: filteredLines.length
      };
      console.log('[过滤模式] currentFilter 已设置:', {
        filteredLines: filteredLines.length,
        filterKeywords: currentFilter.filterKeywords
      });
    }

    showMessage(`🔍 过滤完成: ${filteredLines.length} 个匹配 (耗时 ${elapsed}秒)`);
    console.log(`[过滤模式] ✓ 完成: ${filteredLines.length} 个匹配，耗时 ${elapsed}秒`);

  } catch (error) {
    console.error('[过滤模式] 过滤失败:', error);
    showMessage(`❌ 过滤失败: ${error.message}`);
  }
}

// =====================================================================
// 🔄 代码更新模块
// =====================================================================

/**
 * 获取更新服务器地址
 */
function getUpdateServerUrl() {
  // 从 localStorage 读取，如果没有则使用默认值
  let serverUrl = localStorage.getItem('updateServerUrl');
  if (!serverUrl) {
    // 默认服务器地址 - 请根据实际情况修改
    serverUrl = 'http://10.0.3.1:9000';
  }
  return serverUrl;
}

/**
 * 设置更新服务器地址
 */
function setUpdateServerUrl(url) {
  localStorage.setItem('updateServerUrl', url);
  showMessage(`✓ 服务器地址已设置为: ${url}`);
}

/**
 * 一键更新代码
 */
async function quickUpdateCode(event) {
  // Shift+点击：修改服务器地址
  if (event && event.shiftKey) {
    const newUrl = prompt('请输入更新服务器地址：', getUpdateServerUrl());
    if (newUrl && newUrl.trim()) {
      setUpdateServerUrl(newUrl.trim());
    }
    return;
  }

  const serverUrl = getUpdateServerUrl();
  const updateBtn = document.getElementById('updateCodeBtn');

  if (!updateBtn) return;

  // 禁用按钮，显示正在更新
  updateBtn.disabled = true;
  const originalText = updateBtn.textContent;
  updateBtn.textContent = '更新中...';

  try {
    // 直接更新，不显示中间状态
    const updateResult = await window.electronAPI.updateCode({ serverUrl });

    if (updateResult.success) {
      updateBtn.textContent = '✓ 完成';
      showMessage('✅ 代码更新完成！请重启应用');

      // 3秒后恢复按钮
      setTimeout(() => {
        updateBtn.disabled = false;
        updateBtn.textContent = originalText;
      }, 3000);
    } else {
      updateBtn.textContent = '✗ 失败';
      showMessage(`❌ 更新失败: ${updateResult.error}`);

      // 3秒后恢复按钮
      setTimeout(() => {
        updateBtn.disabled = false;
        updateBtn.textContent = originalText;
      }, 3000);
    }

  } catch (error) {
    console.error('[更新代码] 错误:', error);
    updateBtn.textContent = '✗ 失败';
    showMessage(`❌ 更新失败: ${error.message}`);

    // 3秒后恢复按钮
    setTimeout(() => {
      updateBtn.disabled = false;
      updateBtn.textContent = originalText;
    }, 3000);
  }
}

/**
 * 显示更新服务器配置帮助
 */
function showUpdateServerHelp() {
  const currentUrl = getUpdateServerUrl();
  console.log('========================================');
  console.log('🔄 代码更新服务器配置');
  console.log('========================================');
  console.log('当前服务器地址: ' + currentUrl);
  console.log('');
  console.log('修改服务器地址:');
  console.log('  按住 Shift 键点击"更新代码"按钮');
  console.log('  然后输入新的服务器地址');
  console.log('');
  console.log('示例地址:');
  console.log('  http://localhost:3000');
  console.log('  http://10.0.8.1:8080');
  console.log('  http://your-server.com:3000');
  console.log('========================================');
  // showMessage(`💡 当前服务器: ${currentUrl} (Shift+点击按钮修改地址)`);
}

// 页面加载时显示帮助
setTimeout(() => {
  const updateBtn = document.getElementById('updateCodeBtn');
  if (updateBtn) {
    // 不再显示 title 提示
    updateBtn.title = '';
  }
}, 1000);

// =====================================================================
// 🔧 调试工具
// =====================================================================

/**
 * 手动重新加载所有驱动器（包括 C 盘）
 */
window.debugLoadAllDrives = async function() {
  console.log('========================================');
  console.log('🔄 重新加载所有驱动器（包括 C 盘）');
  console.log('========================================');

  try {
    // 检查 API 是否可用
    if (!window.electronAPI || !window.electronAPI.getDataDrives) {
      console.error('❌ electronAPI.getDataDrives 不可用');
      return;
    }

    const result = await window.electronAPI.getDataDrives({ includeSystemDrive: true });

    if (!result.success) {
      console.error('❌ 获取驱动器失败:', result.error);
      return;
    }

    console.log(`✅ 找到 ${result.drives.length} 个驱动器:`);
    for (const drive of result.drives) {
      console.log(`  - ${drive.name} (${drive.path})`);
    }
    console.log('');

    // 重新加载文件树
    console.log('正在重新加载文件树...');

    // 清空现有驱动器节点
    for (let i = fileTreeHierarchy.length - 1; i >= 0; i--) {
      if (fileTreeHierarchy[i].type === 'drive') {
        fileTreeHierarchy.splice(i, 1);
      }
    }

    // 添加新驱动器
    for (const drive of result.drives) {
      fileTreeHierarchy.unshift({
        name: drive.name,
        path: drive.path,
        type: 'drive',
        expanded: false,
        level: 0,
        file: null,
        childrenLoaded: false,
        loadingChildren: false,
        isLocalDrive: true,
        size: 0
      });
    }

    // 渲染文件树
    renderFileTree();

    console.log('✅ 文件树已更新');
    console.log('========================================');
  } catch (error) {
    console.error('❌ 加载驱动器失败:', error);
  }
};

/**
 * 显示当前文件树的驱动器节点
 */
window.debugShowDrives = function() {
  console.log('========================================');
  console.log('📋 当前文件树中的驱动器');
  console.log('========================================');

  const drives = fileTreeHierarchy.filter(item => item.type === 'drive');
  console.log(`驱动器数量: ${drives.length}`);
  console.log('');

  if (drives.length === 0) {
    console.log('❌ 没有找到任何驱动器');
    console.log('');
    console.log('💡 使用以下命令加载驱动器:');
    console.log('   debugLoadAllDrives()');
  } else {
    for (let i = 0; i < drives.length; i++) {
      const drive = drives[i];
      console.log(`${i + 1}. ${drive.name} (${drive.path})`);
    }
  }
  console.log('========================================');
};

/**
 * 手动解压当前选中的压缩包文件到临时目录（用于调试）
 */
window.debugExtractSelectedArchiveFiles = async function() {
  try {
    // 检查是否有选中的压缩包文件
    if (!filterModeArchiveFiles || filterModeArchiveFiles.length === 0) {
      console.error('❌ 没有选中的压缩包文件');
      console.log('请先在过滤模式下选择压缩包内的文件');
      return null;
    }

    console.log('========================================');
    console.log('📦 开始解压选中的压缩包文件');
    console.log('========================================');
    console.log(`文件数量: ${filterModeArchiveFiles.length}`);

    // 打印文件列表
    for (let i = 0; i < filterModeArchiveFiles.length; i++) {
      const file = filterModeArchiveFiles[i];
      console.log(`  ${i + 1}. ${file.filePath}`);
      console.log(`     压缩包: ${file.archivePath}`);
    }
    console.log('========================================');

    // 调用导出功能
    const exportResult = await window.electronAPI.exportArchiveFilesForRipgrep(filterModeArchiveFiles);

    if (!exportResult.success) {
      console.error('❌ 解压失败:', exportResult.error);
      return null;
    }

    console.log('✅ 解压成功！');
    console.log('========================================');
    console.log(`解压目录: ${exportResult.tempDir}`);
    console.log(`合并文件: ${exportResult.tempFilePath}`);
    console.log(`总行数: ${exportResult.totalLines}`);
    console.log(`文件映射数量: ${exportResult.fileMappings.length}`);
    console.log('========================================');

    // 询问是否打开目录
    console.log('');
    console.log('💡 提示: 使用 debugOpenExtractDir() 打开解压目录查看文件');

    return exportResult;
  } catch (error) {
    console.error('解压压缩包文件失败:', error);
    return null;
  }
};

/**
 * 查看当前选中的压缩包文件列表
 */
window.debugShowSelectedArchiveFiles = function() {
  console.log('========================================');
  console.log('📋 当前选中的压缩包文件');
  console.log('========================================');

  if (!filterModeArchiveFiles || filterModeArchiveFiles.length === 0) {
    console.log('❌ 没有选中的压缩包文件');
    console.log('');
    console.log('请先在过滤模式下选择压缩包内的文件');
    console.log('========================================');
    return;
  }

  console.log(`文件数量: ${filterModeArchiveFiles.length}`);
  console.log('');

  for (let i = 0; i < filterModeArchiveFiles.length; i++) {
    const file = filterModeArchiveFiles[i];
    console.log(`${i + 1}. ${file.displayName || file.filePath}`);
    console.log(`   压缩包: ${file.archivePath}`);
    console.log(`   内部路径: ${file.filePath}`);
    console.log('');
  }
  console.log('========================================');
  console.log('');
  console.log('💡 使用以下命令解压这些文件:');
  console.log('   debugExtractSelectedArchiveFiles()');
  console.log('========================================');
};

/**
 * 打开解压目录
 */
window.debugOpenExtractDir = async function() {
  try {
    const result = await window.electronAPI.openExtractDir();
    if (result.success) {
      console.log(`✅ 已打开解压目录: ${result.path}`);
    } else {
      console.error('❌ 打开失败:', result.error);
    }
    return result;
  } catch (error) {
    console.error('打开解压目录失败:', error);
    return null;
  }
};

/**
 * 检查所有工具的状态
 */
window.checkToolsStatus = async function() {
  try {
    const result = await window.electronAPI.checkToolsStatus();
    if (result.success) {
      console.log('✅ 工具状态检查完成:');
      console.table(result.status);
      for (const [toolName, info] of Object.entries(result.status)) {
        if (!info.found) {
          console.warn(`⚠️ ${toolName} 未找到`);
        } else {
          console.log(`✅ ${toolName}: ${info.path}`);
        }
      }
    } else {
      console.error('❌ 检查工具状态失败:', result.error);
    }
    return result;
  } catch (error) {
    console.error('检查工具状态失败:', error);
    return null;
  }
};

// 页面加载时提示调试功能
setTimeout(() => {
  console.log('========================================');
  console.log('🔧 调试工具');
  console.log('========================================');
  console.log('驱动器相关:');
  console.log('  debugLoadAllDrives()    - 加载所有驱动器（包括C盘）');
  console.log('  debugShowDrives()       - 显示当前驱动器');
  console.log('');
  console.log('压缩包过滤:');
  console.log('  debugShowSelectedArchiveFiles()     - 查看选中的压缩包文件');
  console.log('  debugExtractSelectedArchiveFiles()  - 解压选中的文件');
  console.log('  debugOpenExtractDir()               - 打开解压目录');
  console.log('');
  console.log('临时目录:');
  console.log('  debugGetTempDir()       - 获取当前临时目录路径');
  console.log('  debugClearTempDir()     - 清空临时目录');
  console.log('  debugDeleteTempDir()    - 删除临时目录');
  console.log('');
  console.log('工具状态:');
  console.log('  checkToolsStatus()      - 检查所有工具的路径状态');
  console.log('========================================');
}, 2000);

// ============================================
// 🚀 临时目录管理 - 文件树选中时的自动解压
// ============================================

let tempExtractDir = null;
let tempExtractInitialized = false;

/**
 * 初始化临时目录（应用启动时调用）
 */
async function initializeTempExtractDir() {
  if (tempExtractInitialized) {
    return tempExtractDir;
  }

  try {
    const result = await window.electronAPI.createTempExtractDir();
    if (result.success) {
      tempExtractDir = result.tempDir;
      tempExtractInitialized = true;
      console.log(`[临时目录] 已创建: ${tempExtractDir}`);
    } else {
      console.error('[临时目录] 创建失败:', result.error);
    }
  } catch (error) {
    console.error('[临时目录] 初始化失败:', error);
  }

  return tempExtractDir;
}

/**
 * 清空临时目录（取消选中所有文件时调用）
 */
async function clearTempExtractDir() {
  if (!tempExtractInitialized) {
    return;
  }

  try {
    const result = await window.electronAPI.clearTempExtractDir();
    if (result.success) {
      console.log(`[临时目录] 已清空: ${tempExtractDir}`);
    } else {
      console.error('[临时目录] 清空失败:', result.error);
    }
  } catch (error) {
    console.error('[临时目录] 清空失败:', error);
  }
}

/**
 * 解压文件到临时目录
 * @param {string} archivePath - 压缩包路径
 * @param {string} relativePath - 压缩包内的相对路径（可选）
 */
async function extractToTempDir(archivePath, relativePath = null) {
  // 确保临时目录已初始化
  if (!tempExtractInitialized) {
    await initializeTempExtractDir();
  }

  if (!tempExtractDir) {
    console.error('[临时目录] 临时目录未初始化');
    return null;
  }

  try {
    const result = await window.electronAPI.extractToTempDir(archivePath, relativePath);
    if (result.success) {
      console.log(`[临时目录] 已解压: ${archivePath}`);
      if (result.extractedPath) {
        console.log(`[临时目录] 文件路径: ${result.extractedPath}`);
      }
      if (result.extractDir) {
        console.log(`[临时目录] 解压目录: ${result.extractDir}`);
      }
      return result;
    } else {
      console.error('[临时目录] 解压失败:', result.error);
      return null;
    }
  } catch (error) {
    console.error('[临时目录] 解压失败:', error);
    return null;
  }
}

/**
 * 获取临时目录路径
 */
async function getTempExtractDir() {
  if (!tempExtractInitialized) {
    await initializeTempExtractDir();
  }
  return tempExtractDir;
}

/**
 * 删除临时目录（窗口关闭时调用）
 */
async function deleteTempExtractDir() {
  if (!tempExtractInitialized) {
    return;
  }

  try {
    const result = await window.electronAPI.deleteTempExtractDir();
    if (result.success) {
      console.log(`[临时目录] 已删除: ${tempExtractDir}`);
      tempExtractDir = null;
      tempExtractInitialized = false;
    } else {
      console.error('[临时目录] 删除失败:', result.error);
    }
  } catch (error) {
    console.error('[临时目录] 删除失败:', error);
  }
}

// 页面加载时不再自动初始化临时目录，改为按需使用
// initializeTempExtractDir();

// 窗口关闭时删除临时目录
window.addEventListener('beforeunload', () => {
  deleteTempExtractDir();
});

// 暴露调试函数和手动控制函数
window.debugGetTempDir = async function() {
  const dir = await getTempExtractDir();
  console.log(`当前临时目录: ${dir}`);
  return dir;
};

window.debugClearTempDir = async function() {
  await clearTempExtractDir();
  console.log('已清空临时目录');
};

window.debugDeleteTempDir = async function() {
  await deleteTempExtractDir();
  console.log('已删除临时目录');
};

// 手动初始化临时目录（按需使用）
window.initTempDir = async function() {
  return await initializeTempExtractDir();
};

// ============================================
