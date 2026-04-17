/**
 * ripgrep 过滤补丁
 * 替换原有的 applyFilter 函数，使用 rg.exe 进行极速过滤
 */

// 保存原有的 applyFilter 函数
const originalApplyFilter = typeof applyFilter !== 'undefined' ? applyFilter : null;

/**
 * 使用 ripgrep 进行过滤
 */
async function applyFilterWithRipgrep() {
  const filterText = filterBox.value;

  console.log('[Ripgrep Filter] 开始过滤:', filterText);

  // 检查 rg 是否可用
  if (!window.electronAPI || !window.electronAPI.callRG) {
    console.error('[Ripgrep Filter] callRG API 不可用');
    showMessage('ripgrep 未集成，请检查配置');
    return;
  }

  // 检查是否有已加载的文件
  if (typeof currentFiles === 'undefined' || !currentFiles || currentFiles.length === 0) {
    showMessage('请先加载日志文件');
    return;
  }

  // 清空输入时重置过滤
  if (filterText.trim() === "") {
    if (typeof resetFilter === 'function') {
      resetFilter(true);
    }
    return;
  }

  try {
    // 显示加载状态
    const statusEl = document.getElementById('status');
    const filteredCount = document.getElementById('filteredCount');
    const filteredPanel = document.getElementById('filteredPanel');

    if (statusEl) statusEl.textContent = '⏳ ripgrep过滤中...';
    if (filteredPanel) filteredPanel.classList.add('visible');

    const startTime = performance.now();

    // 构建文件路径列表
    const files = currentFiles.map(f => f.path);
    console.log(`[Ripgrep Filter] 搜索 ${files.length} 个文件`);

    // 构建rg参数
    // 将 | 分隔的关键词转换为 rg 的正则 OR 语法
    const rgPattern = filterText.split(/[,|]/).map(k => k.trim()).filter(k => k).join('|');

    const args = [
      rgPattern,                 // 搜索模式（作为第一个参数，不使用 -e）
      '--line-number',           // 显示行号
      '--with-filename',         // 显示文件名
      '--no-heading',            // 不显示文件标题
      '-n',                      // 行号
      '--color', 'never',        // 不使用颜色
      '-a',                      // 将二进制文件视为文本（强制搜索 .DAT 等文件）
    ];

    // 添加文件路径
    args.push('--');
    args.push(...files);

    console.log('[Ripgrep Filter] 执行命令: rg.exe', args.join(' '));

    // 调用 rg
    const result = await window.electronAPI.callRG({
      execPath: './rg.exe',
      args: args
    });

    if (!result.success) {
      throw new Error(result.error || 'ripgrep 执行失败');
    }

    // 解析结果
    const matches = [];
    const lines = result.stdout.trim().split('\n');

    for (const line of lines) {
      if (!line) continue;

      // rg 输出格式: 文件路径:行号:内容
      // Windows 路径可能包含冒号 (如 C:\)，所以从右向左查找最后的两个冒号
      const lastColonIndex = line.lastIndexOf(':');
      if (lastColonIndex === -1) continue;

      const secondLastColonIndex = line.lastIndexOf(':', lastColonIndex - 1);
      if (secondLastColonIndex === -1) continue;

      const filePath = line.substring(0, secondLastColonIndex);
      const lineNumberStr = line.substring(secondLastColonIndex + 1, lastColonIndex);
      const content = line.substring(lastColonIndex + 1);

      // 验证行号是否为纯数字
      if (!/^\d+$/.test(lineNumberStr)) continue;

      matches.push({
        filePath,
        lineNumber: parseInt(lineNumberStr, 10),
        content
      });
    }

    console.log(`[Ripgrep Filter] 找到 ${matches.length} 个匹配`);

    // 转换为 originalLines 的索引
    const filteredToOriginalIndex = [];
    const filteredLines = [];

    for (const match of matches) {
      // 查找对应的原始索引
      const originalIndex = findOriginalIndexForFile(match.filePath, match.lineNumber);
      if (originalIndex !== -1 && originalIndex < originalLines.length) {
        filteredToOriginalIndex.push(originalIndex);
        filteredLines.push(originalLines[originalIndex]);
      }
    }

    // 按原始索引排序，保持顺序
    const combined = filteredToOriginalIndex.map((idx, i) => ({
      index: idx,
      line: filteredLines[i]
    }));
    combined.sort((a, b) => a.index - b.index);

    const sortedIndices = combined.map(x => x.index);
    const sortedLines = combined.map(x => x.line);

    // 更新过滤状态
    if (typeof currentFilter !== 'undefined') {
      currentFilter = {
        filteredLines: sortedLines,
        filteredToOriginalIndex: sortedIndices,
        filterKeywords: filterText.split(/[,|]/).map(k => k.trim()).filter(k => k),
        totalLines: sortedLines.length
      };
    }

    // 更新过滤面板
    if (typeof filteredPanelAllLines !== 'undefined') {
      filteredPanelAllLines = sortedLines;
      filteredPanelAllOriginalIndices = sortedIndices;
      filteredPanelAllPrimaryIndices = [];
    }

    // 更新UI - 不显示行数
    if (filteredCount) {
      filteredCount.textContent = "";  // 隐藏行数
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    const elapsedMs = (parseFloat(elapsed) * 1000).toFixed(0);

    if (statusEl) {
      statusEl.textContent = `✓ ripgrep: ${sortedIndices.length}个匹配 (${elapsed}秒)`;
    }

    // 在过滤面板显示耗时
    const filteredTimeElement = document.getElementById('filteredTime');
    if (filteredTimeElement) {
      filteredTimeElement.textContent = `(耗时 ${elapsedMs}ms)`;
      filteredTimeElement.style.display = 'inline';
    }

    // 更新占位符高度
    const filteredPanelPlaceholder = document.getElementById('filteredPanelPlaceholder');
    if (filteredPanelPlaceholder && typeof filteredPanelLineHeight !== 'undefined') {
      filteredPanelPlaceholder.style.height = (sortedIndices.length * filteredPanelLineHeight) + 'px';
    }

    // 清空虚拟内容
    const filteredPanelVirtualContent = document.getElementById('filteredPanelVirtualContent');
    if (filteredPanelVirtualContent) {
      filteredPanelVirtualContent.innerHTML = '';
    }

    // 🔧 修复：重置虚拟滚动范围，确保不命中早期退出检查
    if (typeof filteredPanelVisibleStart !== 'undefined') filteredPanelVisibleStart = -1;
    if (typeof filteredPanelVisibleEnd !== 'undefined') filteredPanelVisibleEnd = -1;

    // 🔧 修复：使用 requestAnimationFrame 确保 DOM 布局完成后再渲染可见行
    requestAnimationFrame(() => {
      if (typeof updateFilteredPanelVisibleLines === 'function') {
        updateFilteredPanelVisibleLines();
      }
    });

    showMessage(`ripgrep过滤完成: ${sortedIndices.length}个匹配 (耗时${elapsed}秒)`);

  } catch (error) {
    console.error('[Ripgrep Filter] 过滤失败:', error);
    showMessage(`过滤失败: ${error.message}`);

    // 降级到原有过滤方法
    if (originalApplyFilter) {
      console.log('[Ripgrep Filter] 降级到原有过滤方法');
      originalApplyFilter();
    }
  }
}

/**
 * 查找文件对应的原始索引
 */
function findOriginalIndexForFile(filePath, lineNumber) {
  if (typeof fileHeaders === 'undefined') return -1;

  // 从文件路径中提取文件名
  const fileName = filePath.split(/[/\\]/).pop();

  // 查找文件头
  for (let i = 0; i < fileHeaders.length; i++) {
    const header = fileHeaders[i];
    if (header && header.fileName === fileName) {
      // 文件头位置 + 行号 - 1（因为行号从1开始）
      return header.index + lineNumber - 1;
    }
  }

  return -1;
}

// 替换 applyFilter 函数
if (typeof window !== 'undefined') {
  window.applyFilter = applyFilterWithRipgrep;
  console.log('[Ripgrep Filter] ✓ applyFilter 已替换为 ripgrep 过滤');
}
