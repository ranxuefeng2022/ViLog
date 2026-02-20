/**
 * 混合过滤UI交互逻辑
 */

(function() {
  'use strict';

  let useRipgrepMode = false;

  function init() {
    const checkbox = document.getElementById('useRipgrepCheckbox');
    const label = document.getElementById('filterModeLabel');

    if (!checkbox) {
      console.warn('[HybridFilter UI] 未找到ripgrep复选框');
      return;
    }

    // 初始化状态
    useRipgrepMode = checkbox.checked;

    // 监听复选框变化
    checkbox.addEventListener('change', function() {
      useRipgrepMode = this.checked;
      console.log(`[HybridFilter UI] 切换过滤模式: ${useRipgrepMode ? 'ripgrep 🚀' : 'Worker 🔧'}`);

      // 更新配置
      if (window.HybridFilter) {
        window.HybridFilter.setConfig({
          preferRipgrep: useRipgrepMode,
          autoSelect: !useRipgrepMode  // 手动模式不自动选择
        });
      }

      // 显示提示
      const modeText = useRipgrepMode ? 'ripgrep极速过滤' : 'Worker多线程过滤';
      showMessage(`已切换到${modeText}`);
    });

    // 监听过滤框回车事件
    const filterBox = document.getElementById('filterBox');
    if (filterBox) {
      const originalHandler = filterBox.onkeydown;
      filterBox.addEventListener('keydown', async function(e) {
        if (e.key === 'Enter') {
          const filterText = this.value.trim();
          if (!filterText) return;

          // 如果启用了ripgrep模式
          if (useRipgrepMode && window.HybridFilter) {
            e.preventDefault();
            e.stopPropagation();

            console.log('[HybridFilter UI] 使用ripgrep过滤:', filterText);

            try {
              // 显示加载状态
              const statusEl = document.getElementById('status');
              if (statusEl) {
                statusEl.textContent = '⏳ ripgrep过滤中...';
              }

              // 执行过滤
              const result = await window.HybridFilter.filterWithRipgrep(filterText, {
                onProgress: (progress) => {
                  const filteredCount = document.getElementById('filteredCount');
                  if (filteredCount) {
                    filteredCount.textContent = `${progress.matched} (${progress.percentage}%)`;
                  }
                },
                onComplete: (filteredIndices, stats) => {
                  console.log('[HybridFilter UI] ripgrep过滤完成:', stats);

                  // 应用结果
                  if (typeof applyWorkerResults === 'function') {
                    const filteredLines = filteredIndices.map(idx => originalLines[idx]);
                    applyWorkerResults(filteredLines, filteredIndices, stats);
                  }

                  // 更新状态
                  const statusEl = document.getElementById('status');
                  if (statusEl) {
                    statusEl.textContent = `✓ ripgrep: ${stats.matchedCount}个匹配 (${stats.totalTime}秒)`;
                  }

                  showMessage(`ripgrep过滤完成: ${stats.matchedCount}个匹配 (耗时${stats.totalTime}秒)`);
                }
              });

            } catch (error) {
              console.error('[HybridFilter UI] ripgrep过滤失败:', error);
              showMessage(`过滤失败: ${error.message}`);

              // 降级到Worker
              console.log('[HybridFilter UI] 降级到Worker过滤');
              if (typeof resetFilter === 'function') {
                resetFilter(true, filterText);
              }
            }
          }
        }
      });
    }

    // 添加智能模式提示
    if (window.HybridFilter) {
      console.log('[HybridFilter UI] ✓ 初始化完成');
      console.log('[HybridFilter UI] 提示: 勾选"ripgrep"使用极速过滤，适合大文件');
    }
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
