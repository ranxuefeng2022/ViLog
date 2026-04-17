/**
 * Everything 工具栏搜索模块
 * 独立于 everything-search-ui.js，将搜索功能移到工具栏
 */

(function() {
  'use strict';

  console.log('[Everything Toolbar] 模块加载');
  console.log('[Everything Toolbar] window.toggleEverythingSearch 类型:', typeof window.toggleEverythingSearch);

  /**
   * 切换 Everything 搜索弹窗
   */
  window.toggleEverythingSearch = function() {
    console.log('[Everything Toolbar] toggleEverythingSearch 被调用');
    const modal = document.getElementById('everythingSearchModal');
    if (!modal) {
      console.error('[Everything Toolbar] 未找到弹窗元素');
      return;
    }

    const isHidden = modal.getAttribute('aria-hidden') === 'true';
    console.log('[Everything Toolbar] 当前状态:', isHidden ? '隐藏' : '显示');

    if (isHidden) {
      modal.setAttribute('aria-hidden', 'false');
      modal.style.display = 'block';

      const card = document.getElementById('everythingSearchModalCard');
      if (card) {
        // 完整的样式设置，包含flex布局和高度限制
        card.style.cssText = 'position: fixed !important; top: auto !important; bottom: 0 !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 10001 !important; display: flex !important; flex-direction: column !important; max-height: 400px !important; height: auto !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important;';

        // 方案2：如果top还是被覆盖，用calc计算（在下一帧检查）
        setTimeout(() => {
          const rect = card.getBoundingClientRect();
          if (rect.top < 0) {
            // 卡片在顶部外面，用top定位到底部
            const windowHeight = window.innerHeight;
            card.style.cssText = `position: fixed !important; top: ${windowHeight - rect.height}px !important; bottom: auto !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 10001 !important; display: flex !important; flex-direction: column !important; max-height: 400px !important; height: auto !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important;`;
            console.log('[Everything Toolbar] 使用 top 定位到底部');
          }
        }, 50);
      }

      console.log('[Everything Toolbar] 弹窗已显示');

      // 检查弹窗卡片
      setTimeout(() => {
        if (card) {
          const rect = card.getBoundingClientRect();
          const computed = window.getComputedStyle(card);
          console.log('[Everything Toolbar] 卡片位置详情:');
          console.log('  x:', rect.x, 'y:', rect.y, 'width:', rect.width, 'height:', rect.height);
          console.log('  top:', rect.top, 'right:', rect.right, 'bottom:', rect.bottom, 'left:', rect.left);
          console.log('[Everything Toolbar] 计算样式:');
          console.log('  position:', computed.position);
          console.log('  top:', computed.top);
          console.log('  bottom:', computed.bottom);
          console.log('  left:', computed.left);
          console.log('  transform:', computed.transform);
          console.log('  margin-top:', computed.marginTop);
          console.log('[Everything Toolbar] HTML内联样式:');
          console.log('  style attribute:', card.getAttribute('style'));
        }
      }, 100);

      // 聚焦到输入框
      const input = document.getElementById('everythingSearchInput');
      if (input) {
        setTimeout(() => input.focus(), 100);
        input.value = '';
        const resultsDiv = document.getElementById('everythingSearchResults');
        if (resultsDiv) resultsDiv.innerHTML = '';
      }
    } else {
      window.closeEverythingSearchModal();
    }
  };

  /**
   * 关闭 Everything 搜索弹窗
   */
  window.closeEverythingSearchModal = function() {
    const modal = document.getElementById('everythingSearchModal');
    const card = document.getElementById('everythingSearchModalCard');

    if (modal) {
      modal.setAttribute('aria-hidden', 'true');
      modal.style.display = 'none';
    }

    if (card) {
      card.style.setProperty('display', 'none', 'important');
    }
  };

  /**
   * 执行 Everything 搜索
   */
  window.performEverythingSearch = async function(keyword) {
    const resultsDiv = document.getElementById('everythingSearchResults');
    if (!resultsDiv) return;

    if (!keyword || !keyword.trim()) {
      resultsDiv.innerHTML = '<div class="everything-empty">请输入搜索关键词</div>';
      return;
    }

    resultsDiv.innerHTML = '<div class="everything-loading">正在搜索...</div>';

    try {
      // 使用 EverythingCLI 模块进行搜索
      const files = await window.App.EverythingCLI.searchLogFiles(keyword.trim());

      if (files && files.length > 0) {
        window.displayEverythingResults(files);
      } else {
        resultsDiv.innerHTML = '<div class="everything-empty">未找到匹配的文件</div>';
      }
    } catch (error) {
      console.error('[Everything 搜索] 错误:', error);
      resultsDiv.innerHTML = '<div class="everything-error">搜索失败: ' + error.message + '</div>';
    }
  };

  /**
   * 显示 Everything 搜索结果
   */
  window.displayEverythingResults = function(results) {
    const resultsDiv = document.getElementById('everythingSearchResults');
    if (!resultsDiv) return;

    console.log('[Everything Toolbar] 结果数量:', results.length);
    if (results.length > 0) {
      console.log('[Everything Toolbar] 第一个结果:', results[0]);
    }

    const html = results.map(item => {
      // Everything CLI 返回的结果可能有不同的字段名
      // es.exe 返回的是 filename 字段（包含完整路径）
      const fullPath = item.filename || item.path || item.name || '';

      if (!fullPath) {
        console.warn('[Everything Toolbar] 跳过无效结果:', item);
        return '';
      }

      // 从完整路径中提取文件名
      const fileName = fullPath.split(/[/\\]/).pop();

      // 转义单引号和反斜杠
      const escapedPath = fullPath.replace(/'/g, "\\'").replace(/\\/g, '\\\\');

      return `
        <div class="everything-result-item" onclick="window.openEverythingResult('${escapedPath}')">
          <div class="everything-result-name">📄 ${fileName}</div>
          <div class="everything-result-path">${fullPath}</div>
        </div>
      `;
    }).join('');

    if (html) {
      resultsDiv.innerHTML = '<div style="display: flex; flex-direction: column; width: 100%;">' + html + '</div>';
      // 滚动到顶部，显示第一个结果
      setTimeout(() => {
        resultsDiv.scrollTop = 0;
      }, 0);
    } else {
      resultsDiv.innerHTML = '<div class="everything-empty">没有可显示的结果</div>';
    }
  };

  /**
   * 打开 Everything 搜索结果
   */
  window.openEverythingResult = async function(filePath) {
    try {
      // 读取文件内容
      const result = await window.electronAPI.readFile(filePath);

      if (result.success) {
        // 关闭搜索弹窗
        window.closeEverythingSearchModal();

        // 加载文件到日志查看器
        console.log('[Everything] 打开文件:', filePath);
        showMessage(`已打开: ${filePath}`);
      } else {
        showMessage(`打开文件失败: ${result.error}`);
      }
    } catch (error) {
      console.error('[Everything] 打开文件错误:', error);
      showMessage(`打开文件失败: ${error.message}`);
    }
  };

  // 延迟初始化，避免影响其他功能
  setTimeout(() => {
    const searchInput = document.getElementById('everythingSearchInput');
    const searchBtn = document.getElementById('everythingSearchSubmitBtn');

    if (searchInput) {
      // 输入时实时搜索（防抖）
      let searchTimeout;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          window.performEverythingSearch(e.target.value);
        }, 300);
      });

      // 回车搜索
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(searchTimeout);
          window.performEverythingSearch(e.target.value);
        }
      });

      // ESC 关闭弹窗
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          window.closeEverythingSearchModal();
        }
      });
    }

    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        if (searchInput) {
          window.performEverythingSearch(searchInput.value);
        }
      });
    }

    console.log('[Everything Toolbar] 功能已初始化');
  }, 3000);

  // Ctrl+E 快捷键触发 Everything 搜索
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      console.log('[Everything Toolbar] Ctrl+E 被按下');
      window.toggleEverythingSearch();
    }
  });

  // 按钮点击测试
  const btn = document.getElementById('everythingSearchBtn');
  if (btn) {
    btn.addEventListener('click', (e) => {
      console.log('[Everything Toolbar] E 按钮被点击');
      e.preventDefault();
      e.stopPropagation();
      window.toggleEverythingSearch();
    });
  } else {
    console.error('[Everything Toolbar] 未找到 E 按钮');
  }

  // 点击弹窗外部关闭
  document.addEventListener('click', (e) => {
    const modal = document.getElementById('everythingSearchModal');
    if (modal && modal.getAttribute('aria-hidden') === 'false') {
      const card = document.getElementById('everythingSearchModalCard');
      const everythingBtn = document.getElementById('everythingSearchBtn');

      // 如果点击的不是弹窗内部和触发按钮
      if (card && !card.contains(e.target) &&
          everythingBtn && !everythingBtn.contains(e.target)) {
        window.closeEverythingSearchModal();
      }
    }
  });

  console.log('[Everything Toolbar] 模块已加载');
})();
