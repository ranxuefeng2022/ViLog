/**
 * ripgrep 搜索UI交互逻辑
 */

(function() {
  'use strict';

  let ripgrepResults = [];
  let lastSearchKeyword = '';

  // 初始化
  function init() {
    const searchInput = document.getElementById('ripgrepSearchInput');
    const searchBtn = document.getElementById('ripgrepSearchBtn');
    const clearBtn = document.getElementById('ripgrepClearBtn');
    const resultsDiv = document.getElementById('ripgrepResults');

    if (!searchInput || !searchBtn || !clearBtn) {
      console.warn('[Ripgrep UI] 未找到必要的DOM元素');
      return;
    }

    // 搜索按钮点击
    searchBtn.addEventListener('click', doSearch);

    // 清除按钮点击
    clearBtn.addEventListener('click', clearResults);

    // 回车搜索
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearResults();
      }
    });

    console.log('[Ripgrep UI] ✓ 初始化完成');
  }

  // 执行搜索
  async function doSearch() {
    const searchInput = document.getElementById('ripgrepSearchInput');
    const resultsDiv = document.getElementById('ripgrepResults');
    const keyword = searchInput.value.trim();

    if (!keyword) {
      showMessage('请输入搜索关键词');
      return;
    }

    // 检查 ripgrep 是否可用
    if (!window.App || !window.App.Ripgrep) {
      showMessage('ripgrep 模块未加载');
      return;
    }

    // 检查是否有已加载的文件
    if (typeof currentFiles === 'undefined' || currentFiles.length === 0) {
      showMessage('请先加载日志文件');
      return;
    }

    try {
      // 显示加载状态
      resultsDiv.style.display = 'block';
      resultsDiv.innerHTML = '<div style="padding: 8px; color: #666;">⏳ 正在搜索...</div>';
      searchInput.disabled = true;

      console.log(`[Ripgrep] 搜索关键词: "${keyword}"`);
      console.log(`[Ripgrep] 搜索文件数: ${currentFiles.length}`);

      const startTime = Date.now();

      // 调用 ripgrep 搜索
      const results = await window.App.Ripgrep.search(keyword, {
        files: currentFiles.map(f => f.path),
        contextLines: 2,
        caseSensitive: false,
        maxResults: 1000
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`[Ripgrep] 找到 ${results.length} 个匹配，耗时 ${elapsed}秒`);

      // 保存结果
      ripgrepResults = results;
      lastSearchKeyword = keyword;

      // 显示结果
      displayResults(results, elapsed);

    } catch (error) {
      console.error('[Ripgrep] 搜索失败:', error);
      resultsDiv.innerHTML = `<div style="padding: 8px; color: #f44336;">❌ 搜索失败: ${error.message}</div>`;
    } finally {
      searchInput.disabled = false;
      searchInput.focus();
    }
  }

  // 显示搜索结果
  function displayResults(results, elapsed) {
    const resultsDiv = document.getElementById('ripgrepResults');

    if (!results || results.length === 0) {
      resultsDiv.innerHTML = `
        <div style="padding: 8px; color: #666;">
          未找到匹配项 (耗时 ${elapsed}秒)
        </div>
      `;
      return;
    }

    // 统计每个文件的匹配数
    const fileStats = {};
    for (const result of results) {
      const fileName = getFileName(result.filePath);
      fileStats[fileName] = (fileStats[fileName] || 0) + 1;
    }

    // 生成HTML
    let html = `
      <div style="padding: 8px; border-bottom: 1px solid #eee;">
        <strong style="color: #4CAF50;">✓ 找到 ${results.length} 个匹配</strong>
        <span style="color: #999; margin-left: 8px;">(耗时 ${elapsed}秒)</span>
        <button id="rgLoadAllBtn" style="margin-left: 8px; padding: 2px 8px; font-size: 11px; background: #2196F3; color: white; border: none; border-radius: 2px; cursor: pointer;">
          在主日志框显示
        </button>
      </div>
    `;

    // 显示前100个结果
    const displayCount = Math.min(results.length, 100);
    for (let i = 0; i < displayCount; i++) {
      const result = results[i];
      const fileName = getFileName(result.filePath);
      const lineNum = result.lineNumber;

      html += `
        <div class="rg-result-item" data-index="${i}" style="padding: 4px 8px; border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: background 0.2s;">
          <div style="color: #666; font-size: 11px; margin-bottom: 2px;">
            📄 ${fileName}:${lineNum}
          </div>
          <div style="color: #333; word-break: break-all;">
            ${highlightMatch(result.content, lastSearchKeyword)}
          </div>
        </div>
      `;
    }

    if (results.length > 100) {
      html += `
        <div style="padding: 8px; color: #999; text-align: center; font-size: 11px;">
          ... 还有 ${results.length - 100} 个结果未显示
        </div>
      `;
    }

    resultsDiv.innerHTML = html;

    // 添加点击事件
    resultsDiv.querySelectorAll('.rg-result-item').forEach(item => {
      item.addEventListener('click', function() {
        const index = parseInt(this.getAttribute('data-index'));
        jumpToResult(results[index]);
      });

      item.addEventListener('mouseenter', function() {
        this.style.backgroundColor = '#f5f5f5';
      });

      item.addEventListener('mouseleave', function() {
        this.style.backgroundColor = 'transparent';
      });
    });

    // 添加"在主日志框显示"按钮事件
    const loadAllBtn = document.getElementById('rgLoadAllBtn');
    if (loadAllBtn) {
      loadAllBtn.addEventListener('click', loadResultsToMainLog);
    }
  }

  // 高亮匹配的文本
  function highlightMatch(text, keyword) {
    if (!keyword) return escapeHtml(text);

    try {
      const regex = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
      return escapeHtml(text).replace(regex, '<mark style="background: #ffeb3b; padding: 0 2px;">$1</mark>');
    } catch (e) {
      return escapeHtml(text);
    }
  }

  // 跳转到搜索结果
  function jumpToResult(result) {
    console.log('[Ripgrep] 跳转到:', result);

    // 查找对应文件在 originalLines 中的位置
    const fileHeaderIndex = findFileHeader(result.filePath);
    if (fileHeaderIndex === -1) {
      showMessage('无法找到对应文件');
      return;
    }

    // 跳转到对应行
    const targetLine = fileHeaderIndex + result.lineNumber;
    if (typeof scrollToLine === 'function') {
      scrollToLine(targetLine, true);
      showMessage(`已跳转到 ${getFileName(result.filePath)}:${result.lineNumber}`);
    }
  }

  // 查找文件头位置
  function findFileHeader(filePath) {
    if (typeof fileHeaders === 'undefined') return -1;

    const fileName = getFileName(filePath);
    for (let i = 0; i < fileHeaders.length; i++) {
      const header = fileHeaders[i];
      if (header && header.fileName === fileName) {
        return header.index;
      }
    }
    return -1;
  }

  // 将结果加载到主日志框
  function loadResultsToMainLog() {
    if (!ripgrepResults || ripgrepResults.length === 0) {
      showMessage('没有可加载的结果');
      return;
    }

    console.log(`[Ripgrep] 加载 ${ripgrepResults.length} 个结果到主日志框`);

    // 创建过滤结果
    const filteredLines = [];
    const filteredToOriginalIndex = [];

    for (const result of ripgrepResults) {
      const fileHeaderIndex = findFileHeader(result.filePath);
      if (fileHeaderIndex !== -1) {
        const originalIndex = fileHeaderIndex + result.lineNumber;
        filteredLines.push(originalLines[originalIndex]);
        filteredToOriginalIndex.push(originalIndex);
      }
    }

    // 应用过滤结果
    if (typeof applyWorkerResults === 'function') {
      applyWorkerResults(filteredLines, filteredToOriginalIndex, {
        total: filteredLines.length
      });
      showMessage(`已加载 ${filteredLines.length} 条结果到主日志框`);
    } else {
      showMessage('无法加载结果');
    }
  }

  // 清除结果
  function clearResults() {
    const searchInput = document.getElementById('ripgrepSearchInput');
    const resultsDiv = document.getElementById('ripgrepResults');

    searchInput.value = '';
    resultsDiv.style.display = 'none';
    resultsDiv.innerHTML = '';
    ripgrepResults = [];
    lastSearchKeyword = '';

    console.log('[Ripgrep UI] 已清除结果');
  }

  // 辅助函数：获取文件名
  function getFileName(filePath) {
    if (!filePath) return '';
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1];
  }

  // 辅助函数：转义HTML
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 辅助函数：转义正则表达式
  function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
