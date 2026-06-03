      // ========== 虚拟滚动优化：更新滚动进度函数 ==========
      var _cachedScrollHeight = 0;
      var _cachedProgressRounded = -1;

      function updateScrollProgress() {
        const scrollProgressBar = document.getElementById('scrollProgressBar');
        const scrollProgressText = document.getElementById('scrollProgressText');

        if (!scrollProgressBar || !scrollProgressText) return;

        const scrollTop = outer.scrollTop;
        const clientHeight = outer.clientHeight;
        const scrollHeight = outer.scrollHeight;

        // Avoid DOM write if progress hasn't changed
        const maxScroll = scrollHeight - clientHeight;
        const progress = maxScroll > 0 ? (scrollTop / maxScroll) * 100 : 0;
        const roundedProgress = Math.round(progress);
        if (roundedProgress === _cachedProgressRounded && scrollHeight === _cachedScrollHeight) return;
        _cachedProgressRounded = roundedProgress;
        _cachedScrollHeight = scrollHeight;

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
        // 分片模式：从磁盘读取临时文件
        if (window._filteredChunkActive && window.App && window.App.FilteredChunkCache) {
          var cache = window.App.FilteredChunkCache;
          var stats = cache.getStats();
          if (!cache.isActive()) {
            showMessage("没有过滤结果可复制");
            return;
          }
          var tempPath = stats.tempFilePath;
          if (!tempPath) {
            showMessage("没有过滤结果可复制");
            return;
          }
          window.electronAPI.readFilterTempAsText({ filePath: tempPath }).then(function(result) {
            if (result.success && result.text) {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(result.text).then(function() {
                  showMessage("已复制 " + result.lineCount + " 行过滤结果到剪贴板");
                }).catch(function() {
                  fallbackCopyFilteredTextToClipboard(result.text);
                });
              } else {
                fallbackCopyFilteredTextToClipboard(result.text);
              }
            } else {
              showMessage("没有过滤结果可复制");
            }
          });
          return;
        }
        // 内存模式（二级过滤后等场景）
        if (filteredPanelAllLines.length === 0) {
          showMessage("没有过滤结果可复制");
          return;
        }
        var allFilteredLogs = filteredPanelAllLines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(allFilteredLogs).then(function() {
            showMessage("已复制 " + filteredPanelAllLines.length + " 行过滤结果到剪贴板");
          }).catch(function(err) {
            console.error('复制失败:', err);
            fallbackCopyFilteredTextToClipboard(allFilteredLogs);
          });
        } else {
          fallbackCopyFilteredTextToClipboard(allFilteredLogs);
        }
      }

      // 暴露到全局作用域，供HTML onclick使用
      window.copyFilteredLogs = copyFilteredLogs;

      // 分片模式导出：从临时文件批量读取行，生成 HTML
      async function exportFilteredAsHTMLFromChunk(tempPath, totalLines) {
        try {
          showMessage("正在从磁盘读取过滤结果...");
          var BATCH = 5000;
          var allLines = [];
          for (var s = 0; s < totalLines; s += BATCH) {
            var count = Math.min(BATCH, totalLines - s);
            var result = await window.electronAPI.readFilterTempAsText({ filePath: tempPath, startLine: s, count: count });
            if (result.success && result.text) {
              var batch = result.text.split('\n');
              allLines = allLines.concat(batch);
            }
          }
          // 用 allLines 替代 filteredPanelAllLines 生成 HTML
          var keywords = currentFilter.filterKeywords || [];
          var timestamp = new Date().toLocaleString('zh-CN');
          var styles = getFilteredPanelStyles();
          var linesHTML = allLines.map(function(line, index) {
            var isFileHeader = line && line.startsWith("=== 文件:");
            var displayText = line;
            if (!isFileHeader && keywords.length > 0) {
              for (var k = 0; k < keywords.length; k++) {
                var keyword = keywords[k];
                if (!keyword) continue;
                var colorClass = getFilterHighlightClass(k);
                displayText = safeHighlight(displayText, keyword, function(match) {
                  return '<span class="' + colorClass + '">' + match + '</span>';
                });
              }
            }
            if (isFileHeader) {
              return '<div class="file-header">' + displayText + '</div>';
            }
            var lineNum = '<span class="line-number">' + (index + 1) + '</span>';
            return '<div class="log-line">' + lineNum + displayText + '</div>';
          });
          var htmlContent = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>过滤结果</title>'
            + '<style>' + styles + '</style></head><body>'
            + '<div class="info">导出时间: ' + timestamp + ' | 关键词: ' + keywords.join(', ')
            + ' | 总行数: ' + allLines.length + '</div>'
            + linesHTML.join('\n')
            + '</body></html>';
          var blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
          var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          var fileName = 'filtered_' + ts + '.html';
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(function() {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 100);
          showMessage('已导出 ' + allLines.length + ' 行到 ' + fileName);
        } catch (error) {
          console.error('[Export] 导出失败:', error);
          showMessage('导出失败: ' + error.message);
        }
      }

      // 导出过滤结果为 HTML
      function exportFilteredAsHTML() {
        // 分片模式：从磁盘批量读取
        if (window._filteredChunkActive && window.App && window.App.FilteredChunkCache) {
          var cache = window.App.FilteredChunkCache;
          var stats = cache.getStats();
          if (!cache.isActive() || !stats.tempFilePath) {
            showMessage("没有过滤结果可导出");
            return;
          }
          exportFilteredAsHTMLFromChunk(stats.tempFilePath, cache.getTotalLines());
          return;
        }
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
        var fill = document.getElementById('headerProgressFill');
        if (fill) {
          fill.classList.remove('complete');
          var w = Math.min(100, Math.max(0, percentage));
          fill.style.width = w + '%';
          fill.style.left = (50 - w / 2) + '%';
          if (!fill.style.background || fill.style.background === '') {
            var hue = Math.floor(Math.random() * 360);
            fill.style.background = 'hsl(' + hue + ', 72%, 55%)';
          }
        }
        if (percentage >= 100) {
          setTimeout(function() {
            if (fill) {
              fill.classList.add('complete');
              fill.style.width = '100%';
              fill.style.left = '0%';
            }
            setTimeout(function() {
              if (fill) fill.style.background = '';
            }, 800);
          }, 500);
        }
      }
    
// ==================== ripgrep 过滤函数 ====================

/**
 * 检查是否是有效的磁盘路径
 * @param {string} path - 文件路径
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

  // 启动 Workers（每个 Worker 有 10 秒超时保护）
  const workerPromises = chunks.map((chunk, index) => {
    let workerRef = null;
    let resolved = false;

    return Promise.race([
      new Promise((resolve) => {
        const worker = new Worker(workerUrl);
        workerRef = worker;

        worker.onmessage = (e) => {
          if (resolved) return;
          resolved = true;
          const { chunkId, success, matches, error } = e.data;
          worker.terminate();

          if (success) {
            resolve({ chunkId, matches, error: null });
          } else {
            resolve({ chunkId, matches: [], error });
          }
        };

        worker.onerror = (err) => {
          if (resolved) return;
          resolved = true;
          worker.terminate();
          resolve({ chunkId: index, matches: [], error: err.message });
        };

        worker.postMessage({
          chunkId: index,
          chunkData: chunk,
          fileHeaders: fileHeaders
        });
      }),
      new Promise((resolve) => setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (workerRef) workerRef.terminate();
        }
        resolve(null);
      }, 10000))
    ]);
  });

  // 等待所有 Workers 完成
  const results = await Promise.all(workerPromises);

  // 清理 Blob URL
  URL.revokeObjectURL(workerUrl);

  // 合并结果
  const allMatches = [];
  const allErrors = [];

  for (const result of results) {
    if (!result) continue; // 超时的 Worker 返回 null
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
  if (window.electronAPI && window.electronAPI.cleanupChunkTemp) {
    window.electronAPI.cleanupChunkTemp();
  }
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
