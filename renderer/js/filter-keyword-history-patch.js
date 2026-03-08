/**
 * 过滤关键词历史补丁
 * 覆盖 original-script.js 中的相关函数，使用新的 FilterKeywordHistory 模块
 */

(function() {
  'use strict';

  console.log('[FilterKeywordHistory Patch] 应用补丁...');

  // 等待 FilterKeywordHistory 模块加载完成
  function waitForModule() {
    return new Promise((resolve) => {
      const check = () => {
        if (window.App && window.App.FilterKeywordHistory) {
          resolve(window.App.FilterKeywordHistory);
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  // 获取原始函数（如果存在）
  const originalAddToFilterHistory = typeof addToFilterHistory === 'function' ? addToFilterHistory : null;
  const originalShowFilterSuggestions = typeof showFilterSuggestions === 'function' ? showFilterSuggestions : null;
  const originalHandleFilterKeyDown = typeof handleFilterKeyDown === 'function' ? handleFilterKeyDown : null;

  // 覆盖 addToFilterHistory 函数
  window.addToFilterHistory = async function(filterText) {
    // 调用原始函数（保持兼容）
    if (originalAddToFilterHistory) {
      originalAddToFilterHistory(filterText);
    }

    // 同时保存到新的关键词历史模块
    try {
      const module = await waitForModule();
      await module.addKeywordsFromInput(filterText);
    } catch (e) {
      console.error('[FilterKeywordHistory Patch] 保存关键词失败:', e);
    }
  };

  // 覆盖 showFilterSuggestions 函数
  window.showFilterSuggestions = async function() {
    try {
      const module = await waitForModule();
      const filterBox = document.getElementById('filterBox');
      const filterSuggestions = document.getElementById('filterSuggestions');

      if (!filterBox || !filterSuggestions) return;

      // 使用新模块显示建议
      const count = await module.showSuggestions(
        filterBox,
        filterSuggestions,
        (selectedKeyword) => {
          // 选中回调：应用过滤
          if (typeof applyFilter === 'function') {
            applyFilter();
          }
        }
      );

      // 更新可见状态
      if (count > 0) {
        window.filterSuggestionsVisible = true;
      } else {
        window.filterSuggestionsVisible = false;
      }

    } catch (e) {
      console.error('[FilterKeywordHistory Patch] 显示建议失败:', e);
      // 降级到原始函数
      if (originalShowFilterSuggestions) {
        originalShowFilterSuggestions();
      }
    }
  };

  // 覆盖 handleFilterKeyDown 函数
  window.handleFilterKeyDown = function(e) {
    if (!window.filterSuggestionsVisible) {
      // 调用原始函数处理
      if (originalHandleFilterKeyDown) {
        return originalHandleFilterKeyDown(e);
      }
      return;
    }

    const filterSuggestions = document.getElementById('filterSuggestions');
    if (!filterSuggestions) return;

    // 使用新模块处理键盘导航
    waitForModule().then(module => {
      window.selectedSuggestionIndex = module.handleKeyDown(
        e,
        filterSuggestions,
        window.selectedSuggestionIndex ?? -1
      );
    }).catch(() => {
      // 降级到原始函数
      if (originalHandleFilterKeyDown) {
        originalHandleFilterKeyDown(e);
      }
    });
  };

  // 初始化 FilterKeywordHistory 模块
  waitForModule().then(async (module) => {
    console.log('[FilterKeywordHistory Patch] 初始化模块...');
    await module.init();

    // 迁移旧数据
    try {
      const oldHistory = localStorage.getItem('logViewerFilterHistory');
      if (oldHistory) {
        const oldKeywords = JSON.parse(oldHistory);
        if (Array.isArray(oldKeywords) && oldKeywords.length > 0) {
          console.log('[FilterKeywordHistory Patch] 迁移旧数据:', oldKeywords.length);
          for (const kw of oldKeywords) {
            await module.addKeyword(kw);
          }
        }
      }
    } catch (e) {
      console.warn('[FilterKeywordHistory Patch] 迁移旧数据失败:', e);
    }

    console.log('[FilterKeywordHistory Patch] 补丁已应用，fzf 可用:', module.isFzfAvailable());
  }).catch(e => {
    console.error('[FilterKeywordHistory Patch] 初始化失败:', e);
  });

  console.log('[FilterKeywordHistory Patch] 补丁已加载');
})();
