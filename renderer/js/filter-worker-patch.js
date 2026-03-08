/**
 * Web Worker 过滤优化 - 简化集成代码
 * 将此代码插入到 renderer/js/original-script.js 中
 * 位置：在原有的 applyFilter 函数之前
 */

// ==================== 全局变量 ====================
let filterWorker = null;
let workerSessionId = 0;
// 🚀 标志：指示文件头索引需要重新计算（用于 ripgrep 过滤后）
window.needsFileHeaderRecompute = false;

// ==================== Worker 管理 ====================

/**
 * 🚀 新增：获取当前过滤面板可见区域的中心行的原始索引
 * 用于在没有点击行的情况下记录当前查看位置
 * @returns {number} 原始索引，如果没有可见行则返回 -1
 */
function getCurrentVisibleOriginalIndex() {
  // 首先检查是否有点击记录的行（优先级最高）
  if (typeof lastClickedOriginalIndex !== 'undefined' && lastClickedOriginalIndex >= 0) {
    return lastClickedOriginalIndex;
  }

  // 检查是否有过滤面板和原始索引数组
  if (typeof filteredPanelAllOriginalIndices === 'undefined' ||
      !filteredPanelAllOriginalIndices ||
      filteredPanelAllOriginalIndices.length === 0) {
    return -1;
  }

  const filteredPanelContent = document.getElementById('filteredPanelContent');
  if (!filteredPanelContent) return -1;

  // 获取可见区域的范围
  const scrollTop = filteredPanelContent.scrollTop;
  const panelHeight = filteredPanelContent.clientHeight;
  const lineHeight = typeof filteredPanelLineHeight !== 'undefined' ? filteredPanelLineHeight : 19;

  // 计算可见区域的起始和结束索引
  const visibleStart = Math.floor(scrollTop / lineHeight);
  const visibleEnd = Math.ceil((scrollTop + panelHeight) / lineHeight);

  // 计算中心行索引
  const centerIndex = Math.floor((visibleStart + visibleEnd) / 2);

  // 确保中心索引在有效范围内
  if (centerIndex >= 0 && centerIndex < filteredPanelAllOriginalIndices.length) {
    return filteredPanelAllOriginalIndices[centerIndex];
  }

  return -1;
}

/**
 * 解析过滤关键词（提取为独立函数）
 * 🚀 自动追加 "=== 文件:" 关键词，确保文件头始终显示在过滤结果中
 * 只支持 | 作为分隔符（OR逻辑），逗号作为普通字符处理
 */
function parseFilterKeywords(filterText) {
  const keywords = [];
  let currentKeyword = "";
  let escaping = false;

  for (let i = 0; i < filterText.length; i++) {
    const char = filterText[i];

    if (escaping) {
      currentKeyword += char;
      escaping = false;
    } else if (char === "\\") {
      escaping = true;
    } else if (char === "|") {  // 只使用 | 作为分隔符
      if (currentKeyword) {
        keywords.push(currentKeyword);
        currentKeyword = "";
      }
    } else {
      currentKeyword += char;  // 逗号作为普通字符处理
    }
  }

  if (currentKeyword) {
    keywords.push(currentKeyword);
  }

  // 🚀 自动追加 "=== 文件:" 关键词，确保文件头始终显示在过滤结果中
  // 例如：用户输入 "battery|charge"，实际过滤为 "battery|charge|=== 文件:"
  keywords.push("=== 文件:");

  return keywords;
}

/**
 * 🔧 覆盖 original-script.js 中的 applyFilter 函数
 * 确保使用修复后的压缩包检测逻辑
 */
async function applyFilter() {
  const filterText = filterBox.value;

  console.log('=== applyFilter called (sync + optimized) ===');
  console.log('Filter input:', filterText);

  // 发送过滤关键词到服务端
  sendFilterKeywordsToServer(filterText);

  if (filterText.trim() === "") {
    resetFilter();
    return;
  }

  addToFilterHistory(filterText);

  // 🚀 调试：输出文件信息
  if (typeof currentFiles !== 'undefined' && currentFiles && currentFiles.length > 0) {
    console.log('[Filter] currentFiles 总数:', currentFiles.length);
    console.log('[Filter] 第一个文件信息:', {
      name: currentFiles[0].name,
      path: currentFiles[0].path ? currentFiles[0].path.substring(0, 100) + '...' : '(no path)',
      archiveName: currentFiles[0].archiveName,
      fromArchive: currentFiles[0].fromArchive
    });
    // 🔧 调试：显示所有文件的 archiveName/fromArchive 属性
    for (let i = 0; i < Math.min(currentFiles.length, 5); i++) {
      console.log(`[Filter] 文件 ${i}:`, {
        name: currentFiles[i].name,
        path: currentFiles[i].path ? currentFiles[i].path.substring(0, 80) + '...' : '(no path)',
        archiveName: currentFiles[i].archiveName ? currentFiles[i].archiveName.substring(0, 50) + '...' : '(no archiveName)',
        fromArchive: currentFiles[i].fromArchive
      });
    }
    console.log('[Filter] isFromArchive 结果:', isFromArchive(currentFiles));
  }

  // 🚀 优先使用 ripgrep 过滤（如果可用且有文件路径）
  if (typeof window.electronAPI !== 'undefined' &&
      window.electronAPI.callRG &&
      typeof currentFiles !== 'undefined' &&
      currentFiles &&
      currentFiles.length > 0 &&
      currentFiles[0] &&
      currentFiles[0].path &&
      !isFromArchive(currentFiles)) {  // ✅ 检查是否来自压缩包
    console.log('[Filter] ✓ 使用 ripgrep 极速过滤');
    try {
      await applyFilterWithRipgrep();
      return;
    } catch (error) {
      console.error('[Filter] ✗ ripgrep 过滤失败，降级到 Worker:', error);
      // 继续使用 Worker
    }
  } else {
    // 🚀 说明为什么不使用 ripgrep
    let reasons = [];

    if (typeof window.electronAPI === 'undefined' || !window.electronAPI.callRG) {
      reasons.push('ripgrep API 不可用');
    }
    if (!currentFiles || currentFiles.length === 0) {
      reasons.push('没有加载文件');
    }
    if (currentFiles && currentFiles.length > 0 && (!currentFiles[0] || !currentFiles[0].path)) {
      reasons.push('文件路径为空');
    }
    if (currentFiles && currentFiles.length > 0 && isFromArchive(currentFiles)) {
      reasons.push('文件来自压缩包');
    }

    const reason = reasons.length > 0 ? reasons.join(', ') : '未知原因';
    console.log(`[Filter] 使用 Worker 过滤（原因: ${reason}）`);
  }

  // 解析过滤关键词
  const keywords = parseFilterKeywords(filterText);
  currentFilter.filterKeywords = keywords;

  // 🚀 根据数据量选择单线程或多线程
  const totalLines = originalLines.length;

  // 多线程阈值：超过 1 万行就使用多线程
  if (totalLines > 10000) {
    console.log(`[Filter] 数据量较大 (${totalLines} 行)，使用多线程并行过滤`);
    applyFilterWithParallelWorkers(keywords);
  } else {
    console.log(`[Filter] 数据量较小 (${totalLines} 行)，使用单线程过滤`);
    applyFilterWithSingleWorker(keywords);
  }
}

/**
 * 解析过滤关键词（支持逗号和管道符分隔，支持转义）
 */
function parseFilterKeywords(filterText) {
  const keywords = [];
  let currentKeyword = "";
  let escaping = false;

  for (let i = 0; i < filterText.length; i++) {
    const char = filterText[i];

    if (escaping) {
      currentKeyword += char;
      escaping = false;
    } else if (char === '\\') {
      escaping = true;
    } else if (char === ',' || char === '|') {
      if (currentKeyword.trim()) {
        keywords.push(currentKeyword.trim());
      }
      currentKeyword = "";
    } else {
      currentKeyword += char;
    }
  }

  if (currentKeyword.trim()) {
    keywords.push(currentKeyword.trim());
  }

  return keywords;
}

/**
 * 使用 Web Worker 执行过滤
 * 自动选择单线程或多线程
 */
async function applyFilterWithWorker() {
  const filterText = filterBox.value;

  console.log('=== applyFilterWithWorker called ===');

  sendFilterKeywordsToServer(filterText);

  if (filterText.trim() === "") {
    resetFilter();
    return;
  }

  addToFilterHistory(filterText);

  // 🚀 调试：输出文件信息
  if (typeof currentFiles !== 'undefined' && currentFiles && currentFiles.length > 0) {
    console.log('[Filter] currentFiles 总数:', currentFiles.length);
    console.log('[Filter] 第一个文件信息:', {
      name: currentFiles[0].name,
      path: currentFiles[0].path,
      archiveName: currentFiles[0].archiveName,
      fromArchive: currentFiles[0].fromArchive
    });
    // 🔧 调试：显示所有文件的 archiveName/fromArchive 属性
    for (let i = 0; i < Math.min(currentFiles.length, 5); i++) {
      console.log(`[Filter] 文件 ${i}:`, {
        name: currentFiles[i].name,
        path: currentFiles[i].path ? currentFiles[i].path.substring(0, 100) + '...' : '(no path)',
        archiveName: currentFiles[i].archiveName,
        fromArchive: currentFiles[i].fromArchive
      });
    }
    console.log('[Filter] isFromArchive 结果:', isFromArchive(currentFiles));
  }

  // 🚀 优先使用 ripgrep 过滤（如果可用且有文件路径）
  if (typeof window.electronAPI !== 'undefined' &&
      window.electronAPI.callRG &&
      typeof currentFiles !== 'undefined' &&
      currentFiles &&
      currentFiles.length > 0 &&
      currentFiles[0] &&
      currentFiles[0].path &&
      !isFromArchive(currentFiles)) {  // ✅ 新增：检查是否来自压缩包
    console.log('[Filter] ✓ 使用 ripgrep 极速过滤');
    try {
      await applyFilterWithRipgrep();
      return;
    } catch (error) {
      console.error('[Filter] ✗ ripgrep 过滤失败，降级到 Worker:', error);
      // 继续使用 Worker
    }
  } else {
    // 🚀 说明为什么不使用 ripgrep
    let reasons = [];

    if (typeof window.electronAPI === 'undefined' || !window.electronAPI.callRG) {
      reasons.push('ripgrep API 不可用');
    }
    if (!currentFiles || currentFiles.length === 0) {
      reasons.push('没有加载文件');
    }
    if (currentFiles && currentFiles.length > 0 && (!currentFiles[0] || !currentFiles[0].path)) {
      reasons.push('文件路径为空');
    }
    if (currentFiles && currentFiles.length > 0 && isFromArchive(currentFiles)) {
      reasons.push('文件来自压缩包');
    }

    const reason = reasons.length > 0 ? reasons.join(', ') : '未知原因';
    console.log(`[Filter] 使用 Worker 过滤（原因: ${reason}）`);
  }

  const keywords = parseFilterKeywords(filterText);
  currentFilter.filterKeywords = keywords;

  // 🚀 根据数据量选择单线程或多线程
  const totalLines = originalLines.length;

  // 多线程阈值：超过 1 万行就使用多线程
  // 🚀 降低阈值以充分利用16个Worker的性能
  if (totalLines > 10000) {
    console.log(`[Filter] 数据量较大 (${totalLines} 行)，使用多线程并行过滤`);
    applyFilterWithParallelWorkers(keywords);
  } else {
    console.log(`[Filter] 数据量较小 (${totalLines} 行)，使用单线程过滤`);
    applyFilterWithSingleWorker(keywords);
  }
}

/**
 * 使用 ripgrep 进行过滤
 */
async function applyFilterWithRipgrep() {
  const filterText = filterBox.value;

  console.log('[Ripgrep Filter] 开始过滤:', filterText);

  // 显示加载状态
  const statusEl = document.getElementById('status');
  const filteredCountEl = document.getElementById('filteredCount');

  if (statusEl) statusEl.textContent = '⏳ ripgrep过滤中...';

  const startTime = performance.now();

  // 构建文件路径列表
  const files = currentFiles.map(f => f.path);
  console.log(`[Ripgrep Filter] 搜索 ${files.length} 个文件`);

  // 构建rg参数 - 将 | 分隔的关键词转换为 rg 的正则 OR 语法
  const keywords = filterText.split('|').map(k => k.trim()).filter(k => k);
  const rgPattern = keywords.join('|');

  const args = [
    rgPattern,
    '--line-number',           // 显示行号
    '--with-filename',         // 显示文件名
    '--no-heading',            // 不显示文件标题
    '-n',                      // 行号
    '--color', 'never',        // 不使用颜色
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
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (match) {
      const [, filePath, lineNumber, content] = match;
      matches.push({
        filePath,
        lineNumber: parseInt(lineNumber, 10),
        content
      });
    }
  }

  console.log(`[Ripgrep Filter] 找到 ${matches.length} 个匹配`);

  // 转换为 originalLines 的索引
  // 🚀 性能优化：使用Int32Array存储索引，内存减半
  const filteredToOriginalIndex = new Int32Array(matches.length);
  const filteredLines = [];

  // 🚀 性能优化：预设数组大小，避免动态扩容
  const matchCount = matches.length;
  const tempIndices = new Int32Array(matchCount);
  const tempLines = new Array(matchCount);
  let validCount = 0;

  for (let i = 0; i < matchCount; i++) {
    const match = matches[i];
    // 查找对应的原始索引
    const originalIndex = findOriginalIndexForFile(match.filePath, match.lineNumber);
    if (originalIndex !== -1 && originalIndex < originalLines.length) {
      tempIndices[validCount] = originalIndex;
      tempLines[validCount] = originalLines[originalIndex];
      validCount++;
    }
  }

  // 截取有效部分并转换为Int32Array
  const finalFilteredToOriginalIndex = new Int32Array(tempIndices.buffer, 0, validCount);
  const filteredToOriginalIndex = Array.from(finalFilteredToOriginalIndex);
  const filteredLines = tempLines.slice(0, validCount);

  // 按原始索引排序，保持顺序（优化版：使用索引数组排序）
  const sortedIndices = filteredToOriginalIndex.map((idx, i) => ({ idx, i }));
  sortedIndices.sort((a, b) => a.idx - b.idx);

  const sortedFilteredToOriginalIndex = sortedIndices.map(x => x.idx);
  const sortedFilteredLines = sortedIndices.map(x => filteredLines[x.i]);

  // 更新过滤状态
  if (typeof currentFilter !== 'undefined') {
    currentFilter = {
      filteredLines: sortedFilteredLines,
      filteredToOriginalIndex: sortedFilteredToOriginalIndex,
      filterKeywords: filterText.split('|').map(k => k.trim()).filter(k => k),
      totalLines: sortedFilteredLines.length
    };
  }

  // 更新过滤面板
  if (typeof filteredPanelAllLines !== 'undefined') {
    filteredPanelAllLines = sortedFilteredLines;
    filteredPanelAllOriginalIndices = sortedFilteredToOriginalIndex;
    filteredPanelAllPrimaryIndices = [];
    // 🚀 标记文件头索引需要重新计算
    window.needsFileHeaderRecompute = true;
  }

  // 更新UI
  if (filteredCountEl) {
    filteredCountEl.textContent = sortedFilteredToOriginalIndex.length.toString();
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  if (statusEl) {
    statusEl.textContent = `✓ ripgrep: ${sortedFilteredToOriginalIndex.length}个匹配 (${elapsed}秒)`;
  }

  // 更新占位符高度
  const filteredPanelPlaceholder = document.getElementById('filteredPanelPlaceholder');
  if (filteredPanelPlaceholder && typeof filteredPanelLineHeight !== 'undefined') {
    filteredPanelPlaceholder.style.height = (sortedFilteredToOriginalIndex.length * filteredPanelLineHeight) + 'px';
  }

  // 清空虚拟内容
  const filteredPanelVirtualContent = document.getElementById('filteredPanelVirtualContent');
  if (filteredPanelVirtualContent) {
    filteredPanelVirtualContent.innerHTML = '';
  }

  // 更新可见行
  if (typeof updateFilteredPanelVisibleLines === 'function') {
    updateFilteredPanelVisibleLines();
  }

  // 🚀 智能跳转：查找之前点击的行是否还在新结果中
  let targetFilteredIndex = -1;
  if (rememberedOriginalIndex >= 0 && sortedFilteredToOriginalIndex.length > 0) {
    // 在新结果中查找完全匹配的原始索引
    targetFilteredIndex = sortedFilteredToOriginalIndex.indexOf(rememberedOriginalIndex);
    console.log(`[Ripgrep Filter] 查找之前的选中行: rememberedOriginalIndex=${rememberedOriginalIndex}, targetFilteredIndex=${targetFilteredIndex}`);

    // 🚀 如果没找到精确匹配，找到原始行号最接近的行
    if (targetFilteredIndex < 0) {
      console.log(`[Ripgrep Filter] 📍 目标行不在结果中，使用原始行号查找最接近的行...`);

      // 使用二分查找找到插入位置
      let left = 0;
      let right = sortedFilteredToOriginalIndex.length - 1;
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (sortedFilteredToOriginalIndex[mid] < rememberedOriginalIndex) {
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }

      // left 是应该插入的位置，比较 left 和 left-1 哪个更接近
      if (left >= sortedFilteredToOriginalIndex.length) {
        // 目标行比所有结果都大，使用最后一个
        targetFilteredIndex = sortedFilteredToOriginalIndex.length - 1;
      } else if (left === 0) {
        // 目标行比所有结果都小，使用第一个
        targetFilteredIndex = 0;
      } else {
        // 比较左右两个哪个更接近
        const diffLeft = Math.abs(sortedFilteredToOriginalIndex[left - 1] - rememberedOriginalIndex);
        const diffRight = Math.abs(sortedFilteredToOriginalIndex[left] - rememberedOriginalIndex);
        targetFilteredIndex = diffLeft <= diffRight ? left - 1 : left;
      }

      const closestOriginalIndex = sortedFilteredToOriginalIndex[targetFilteredIndex];
      console.log(`[Ripgrep Filter] ✓ 找到原始行号最接近的行: filteredIndex=${targetFilteredIndex}, originalIndex=${closestOriginalIndex}, 距离=${Math.abs(closestOriginalIndex - rememberedOriginalIndex)}`);
    }
  }

  // 🚀 如果找到了匹配的行（精确或最接近），跳转到该行并高亮
  if (targetFilteredIndex >= 0) {
    console.log(`[Ripgrep Filter] 跳转到目标行: ${targetFilteredIndex}`);
    lastClickedFilteredIndex = targetFilteredIndex;

    // 延迟执行，确保 DOM 已经更新
    setTimeout(() => {
      const filteredPanelContent = document.getElementById('filteredPanelContent');
      const filteredPanelVirtualContent = document.getElementById('filteredPanelVirtualContent');

      if (!filteredPanelContent || !filteredPanelVirtualContent) {
        console.error('[Ripgrep Filter] 无法找到过滤面板元素');
        return;
      }

      // 获取实际的行高（如果 filteredPanelLineHeight 未定义，则从第一个元素获取）
      let lineHeight = typeof filteredPanelLineHeight !== 'undefined' ? filteredPanelLineHeight : 19;
      const firstLine = filteredPanelVirtualContent.querySelector('.filtered-log-line');
      if (firstLine) {
        const actualHeight = firstLine.getBoundingClientRect().height;
        if (actualHeight > 0) {
          lineHeight = actualHeight;
        }
      }

      // 移除旧的高亮
      const oldHighlights = filteredPanelVirtualContent.querySelectorAll('.filtered-log-line.highlighted, .filtered-log-line.search-match-highlight');
      oldHighlights.forEach(line => {
        line.classList.remove('highlighted', 'search-match-highlight');
      });

      // 滚动到目标行
      const lineTop = targetFilteredIndex * lineHeight;
      const panelHeight = filteredPanelContent.clientHeight;
      const targetTop = Math.max(0, lineTop - panelHeight / 2);

      filteredPanelContent.scrollTop = targetTop;

      // 高亮目标行
      const targetLine = filteredPanelVirtualContent.querySelector(`[data-filtered-index="${targetFilteredIndex}"]`);
      if (targetLine) {
        targetLine.classList.add('highlighted');
        console.log(`[Ripgrep Filter] ✓ 已跳转并高亮行 ${targetFilteredIndex} (行高: ${lineHeight}px)`);
      } else {
        console.warn(`[Ripgrep Filter] 行 ${targetFilteredIndex} 不在可见区域，等待滚动事件触发高亮`);
      }
    }, 150);
  } else {
    // 如果没找到匹配的行，重置选中状态
    console.log('[Ripgrep Filter] 未找到之前的选中行，重置选中状态');
    lastClickedFilteredIndex = -1;
  }

  console.log(`[Ripgrep Filter] ✓ 完成: ${sortedFilteredToOriginalIndex.length} 个匹配，耗时 ${elapsed}秒`);
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

/**
 * 检测文件是否来自压缩包
 * @param {Array} files - currentFiles 数组
 * @returns {boolean} 是否来自压缩包
 */
function isFromArchive(files) {
  if (!files || files.length === 0) return false;

  // 🔧 修复：检查所有文件，而不只是第一个文件
  // 如果任何一个文件是压缩包文件，就应该全部使用 Worker 过滤
  for (const file of files) {
    if (!file) continue;

    // 1. 检查是否有 archiveName/fromArchive 属性（压缩包特有的属性）
    if (file.archiveName || file.fromArchive) {
      console.log(`[Filter] 检测到 archiveName/fromArchive 属性: ${file.name || '(no name)'}`);
      return true;
    }

    const path = file.path;
    if (!path) continue;

    // 2. 检查路径是否包含压缩包标记（如 "archive.zip:file.log"）
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
        console.log(`[Filter] 路径包含压缩包标记: ${path.substring(0, 100)}...`);
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
          console.log(`[Filter] 路径包含压缩包标记: ${path.substring(0, 100)}...`);
          return true;
        }
      }
    }
  }

  console.log('[Filter] 未检测到压缩包文件');
  return false;
}

/**
 * 检查是否是有效的磁盘路径
 * @param {string} path - 文件路径
 * @returns {boolean} 是否是有效的磁盘路径（非压缩包）
 */
function hasValidDiskPath(path) {
  if (!path) return false;

  // Windows 绝对路径: C:\... 或 E:\...
  if (/^[A-Za-z]:\\/.test(path)) {
    // 检查是否包含压缩包标记（使用冒号、反斜杠或正斜杠）
    // 例如：xxx.zip:内部路径 或 xxx.zip\内部路径
    const archivePatterns = [
      /\.zip:/i, /\.zip[\/\\]/i,      // .zip: 或 .zip\ 或 .zip/
      /\.7z:/i, /\.7z[\/\\]/i,       // .7z: 或 .7z\ 或 .7z/
      /\.tar:/i, /\.tar[\/\\]/i,      // .tar: 或 .tar\ 或 .tar/
      /\.gz:/i, /\.gz[\/\\]/i,        // .gz: 或 .gz\ 或 .gz/
      /\.rar:/i, /\.rar[\/\\]/i,      // .rar: 或 .rar\ 或 .rar/
      /\.bz2:/i, /\.bz2[\/\\]/i       // .bz2: 或 .bz2\ 或 .bz2/
    ];

    for (const pattern of archivePatterns) {
      if (pattern.test(path)) {
        console.log(`[Filter] 路径包含压缩包标记，无效: ${path}`);
        return false;
      }
    }

    return true;
  }

  return false;
}

/**
 * 使用 ripgrep 进行异步过滤
 * @param {string} filterText - 过滤文本
 * @param {Array} headers - fileHeaders 数组，包含文件路径信息
 */
async function applyFilterWithRipgrepAsync(filterText, headers) {
  try {
    console.log('[Ripgrep Filter] 开始过滤:', filterText);

    // 🚀 智能跳转：记录当前查看位置的原始索引
    // 优先使用点击记录的行，如果没有则使用可见区域的中心行
    let rememberedOriginalIndex = getCurrentVisibleOriginalIndex();
    console.log(`[Ripgrep Filter] 📍 记忆位置: originalIndex=${rememberedOriginalIndex}`);

    // 显示加载状态
    const statusEl = document.getElementById('status');
    const filteredCountEl = document.getElementById('filteredCount');

    if (statusEl) statusEl.textContent = '⏳ ripgrep过滤中...';

    const startTime = performance.now();

    // 构建文件路径列表（从 fileHeaders 中提取有效路径）
    const files = [];
    const validHeaders = [];

    for (const header of headers) {
      const filePath = header.filePath || header.fileName;

      // 只添加有效的磁盘路径
      if (filePath && hasValidDiskPath(filePath)) {
        files.push(filePath);
        validHeaders.push(header);
      } else {
        console.log(`[Ripgrep Filter] 跳过非磁盘文件: ${filePath || header.fileName}`);
      }
    }

    if (files.length === 0) {
      throw new Error('没有找到有效的磁盘文件路径（所有文件都来自压缩包或路径无效）');
    }

    console.log(`[Ripgrep Filter] 从 ${headers.length} 个文件中筛选出 ${files.length} 个有效的磁盘文件`);

    // 🚀 使用与 Worker 相同的关键词解析逻辑
    const keywords = parseFilterKeywords(filterText);

    console.log(`[Ripgrep Filter] ========== 关键词解析 ==========`);
    console.log(`[Ripgrep Filter] 原始过滤文本: "${filterText}"`);
    console.log(`[Ripgrep Filter] 解析后关键词数量: ${keywords.length}`);
    keywords.forEach((kw, idx) => {
      console.log(`[Ripgrep Filter]   关键词 [${idx + 1}]: "${kw}" (长度: ${kw.length})`);
    });

    // 构建rg参数 - 将关键词转换为 rg 的正则 OR 语法
    // 转义每个关键词中的特殊正则字符
    const escapeRegex = (str) => {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const escapedKeywords = keywords.map(k => escapeRegex(k));
    // 改用 OR 语法连接，但要注意不转义连接符 |
    const rgPattern = escapedKeywords.join('|');

    console.log(`[Ripgrep Filter] ========== ripgrep 多线程并行搜索 ==========`);
    console.log(`[Ripgrep Filter] ripgrep 搜索模式: "${rgPattern}"`);
    console.log(`[Ripgrep Filter] 搜索模式长度: ${rgPattern.length}`);
    console.log(`[Ripgrep Filter] 提示：使用 | (OR) 逻辑，任一关键词匹配即可`);

    // 🚀 限制并发数：避免同时发起太多进程导致资源耗尽
    const MAX_CONCURRENT = 8;  // 最多同时进行8个搜索
    const totalFiles = files.length;
    const concurrentBatches = Math.ceil(totalFiles / MAX_CONCURRENT);

    console.log(`[Ripgrep Filter] 并发策略: ${totalFiles} 个文件，每批最多 ${MAX_CONCURRENT} 个，共 ${concurrentBatches} 批`);

    let allMatches = [];

    // 分批并行搜索
    for (let batch = 0; batch < concurrentBatches; batch++) {
      const startIdx = batch * MAX_CONCURRENT;
      const endIdx = Math.min(startIdx + MAX_CONCURRENT, totalFiles);
      const batchFiles = files.slice(startIdx, endIdx);
      const batchHeaders = validHeaders.slice(startIdx, endIdx);

      console.log(`[Ripgrep Filter] ========== 批次 ${batch + 1}/${concurrentBatches} (${startIdx + 1}-${endIdx}) ==========`);

      // 创建当前批次的并行搜索 Promise
      const batchPromises = batchFiles.map((filePath, i) => {
        const actualIndex = startIdx + i;
        const fileHeader = batchHeaders[i];

        return (async () => {
          console.log(`[Ripgrep Filter] [${actualIndex + 1}/${totalFiles}] 启动搜索: ${fileHeader.fileName}`);

          const args = [
            rgPattern,                    // 搜索模式（作为第一个参数，不使用 -e）
            '--line-number',              // 显示行号
            '--no-filename',              // 不显示文件名（避免 Windows 路径冒号问题）
            '--color', 'never',           // 不使用颜色
            '-a',                         // 将二进制文件视为文本（强制搜索 .DAT 等文件）
          ];

          args.push('--');
          args.push(filePath);

          try {
            // 调用 rg
            console.log(`[Ripgrep Filter] [${actualIndex + 1}] 执行命令: rg.exe ${args.join(' ')}`);
            const result = await window.electronAPI.callRG({
              execPath: './rg.exe',
              args: args
            });

            if (!result.success) {
              console.error(`[Ripgrep Filter] [${actualIndex + 1}/${totalFiles}] 搜索失败:`, result.error);
              return { fileIndex: actualIndex, matches: [], fileName: fileHeader.fileName };
            }

            // 调试：显示原始输出
            console.log(`[Ripgrep Filter] [${actualIndex + 1}] 原始输出长度: ${result.stdout.length} 字符`);
            console.log(`[Ripgrep Filter] [${actualIndex + 1}] 原始输出前500字符:`, result.stdout.substring(0, 500));

            // 解析结果（格式：行号:内容）
            const lines = result.stdout.trim().split('\n');
            console.log(`[Ripgrep Filter] [${actualIndex + 1}] 总行数: ${lines.length}`);

            // 🚀 优化：避免输出大数组导致主线程阻塞
            if (lines.length > 0) {
              const sampleSize = Math.min(3, lines.length);
              const sample = lines.slice(0, sampleSize).map(l => {
                // 限制每行最多显示100字符
                const truncated = l.length > 100 ? l.substring(0, 100) + '...' : l;
                return truncated;
              });
              console.log(`[Ripgrep Filter] [${actualIndex + 1}] 前${sampleSize}行（已截断）:`, sample);
            }

            const matches = [];

            for (const line of lines) {
              if (!line) continue;

              // 解析格式：行号:内容
              // 注意：内容中可能包含冒号，所以需要从第一个冒号处分割
              const colonIndex = line.indexOf(':');
              if (colonIndex === -1) continue;

              const lineNumberStr = line.substring(0, colonIndex);
              const content = line.substring(colonIndex + 1);

              // 验证行号是否为纯数字
              if (!/^\d+$/.test(lineNumberStr)) continue;

              matches.push({
                fileIndex: actualIndex,     // 文件索引
                filePath: filePath,         // 文件路径
                fileName: fileHeader.fileName, // 文件名
                lineNumber: parseInt(lineNumberStr, 10),
                content: content
              });
            }

            console.log(`[Ripgrep Filter] [${actualIndex + 1}/${totalFiles}] ✓ 完成: ${matches.length} 个匹配`);
            return { fileIndex: actualIndex, matches, fileName: fileHeader.fileName };

          } catch (error) {
            console.error(`[Ripgrep Filter] [${actualIndex + 1}/${totalFiles}] 异常:`, error);
            return { fileIndex: actualIndex, matches: [], fileName: fileHeader.fileName };
          }
        })();
      });

      // 等待当前批次完成
      const batchResults = await Promise.all(batchPromises);

      // 合并批次结果
      for (const result of batchResults) {
        allMatches = allMatches.concat(result.matches);
      }

      console.log(`[Ripgrep Filter] 批次 ${batch + 1}/${concurrentBatches} 完成，累计 ${allMatches.length} 个匹配`);
    }

    console.log(`[Ripgrep Filter] ✓ 所有搜索完成: 总共找到 ${allMatches.length} 个匹配`);

    // 🚀 如果没有匹配，显示警告
    if (allMatches.length === 0) {
      console.warn('[Ripgrep Filter] ⚠️ 没有找到任何匹配！');
      console.warn('[Ripgrep Filter] 搜索的关键词:', keywords);
      console.warn('[Ripgrep Filter] 提示：使用 Worker 过滤来对比结果');
    }

    // 显示加载状态
    if (statusEl) statusEl.textContent = '⏳ ripgrep过滤中...';
    if (filteredCountEl) filteredCountEl.textContent = "";  // 隐藏行数

    // 🚀 显示过滤面板
    filteredPanel.classList.add("visible");

    // 🚀 自动隐藏文件树面板，为过滤面板腾出空间
    const fileTreeContainer = document.getElementById('fileTreeContainer');
    const fileTreeCollapseBtn = document.getElementById('fileTreeCollapseBtn');
    if (fileTreeContainer && fileTreeCollapseBtn && !fileTreeContainer.classList.contains('collapsed')) {
      fileTreeContainer.classList.add('collapsed');
      fileTreeCollapseBtn.textContent = '📂';
    }

    // 转换为 originalLines 的索引
    // 🚀 按文件分组：先按文件索引分组，再添加文件头
    const matchesByFile = new Map();
    for (const match of allMatches) {
      if (!matchesByFile.has(match.fileIndex)) {
        matchesByFile.set(match.fileIndex, []);
      }
      matchesByFile.get(match.fileIndex).push(match);
    }

    console.log(`[Ripgrep Filter] 匹配分布在 ${matchesByFile.size} 个文件中`);

    const filteredToOriginalIndex = [];
    const filteredLines = [];

    // 按文件顺序处理
    for (const [fileIndex, matches] of matchesByFile.entries()) {
      const fileHeader = validHeaders[fileIndex];

      console.log(`[Ripgrep Filter] 处理文件 [${fileIndex + 1}]: ${fileHeader.fileName} (${matches.length} 个匹配)`);

      // 🚀 插入文件头（使用标准格式，便于识别和样式化）
      const fileHeaderLine = `=== 文件: 📁 ${fileHeader.fileName} (${matches.length} 个匹配) ===`;
      filteredLines.push(fileHeaderLine);
      filteredToOriginalIndex.push(-1);  // 文件头不映射到原始索引

      // 添加该文件的所有匹配
      for (const match of matches) {
        if (fileHeader && typeof fileHeader.startIndex !== 'undefined') {
          // startIndex 指向文件头行，文件内容从 startIndex + 1 开始
          // ripgrep 行号从1开始，所以直接相加即可
          const originalIndex = fileHeader.startIndex + match.lineNumber;

          if (originalIndex >= 0 && originalIndex < originalLines.length) {
            filteredToOriginalIndex.push(originalIndex);
            filteredLines.push(originalLines[originalIndex]);

            // 🚀 调试：显示前3个匹配的索引信息
            if (filteredToOriginalIndex.length <= 10) {
              console.log(`[Ripgrep Filter]   匹配: 行${match.lineNumber} -> originalLines[${originalIndex}]`);
            }
          } else {
            console.warn(`[Ripgrep Filter] 索引越界: ${originalIndex} >= ${originalLines.length}`);
          }
        }
      }
    }

    // 🚀 不需要全局排序了，因为我们已经按文件分组并保持文件顺序
    // 每个文件内部的匹配已经按行号自然排序（ripgrep 输出是有序的）

    const sortedIndices = filteredToOriginalIndex;
    const sortedLines = filteredLines;

    console.log(`[Ripgrep Filter] ✓ 结果整理完成: ${sortedLines.length} 行（包含 ${matchesByFile.size} 个文件头）`);

    // 更新过滤状态
    currentFilter = {
      filteredLines: sortedLines,
      filteredToOriginalIndex: sortedIndices,
      filterKeywords: filterText.split('|').map(k => k.trim()).filter(k => k),
      totalLines: sortedLines.length
    };

    // 更新过滤面板
    filteredPanelAllLines = sortedLines;
    filteredPanelAllOriginalIndices = sortedIndices;
    filteredPanelAllPrimaryIndices = [];

    // 计算实际匹配数（不包括文件头）
    const actualMatchCount = sortedIndices.filter(idx => idx !== -1).length;
    const fileHeaderCount = sortedIndices.filter(idx => idx === -1).length;

    // 更新UI - 不显示行数，只显示耗时
    if (filteredCountEl) {
      filteredCountEl.textContent = "";  // 隐藏行数
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    const elapsedMs = (parseFloat(elapsed) * 1000).toFixed(0);

    if (statusEl) {
      statusEl.textContent = `✓ ripgrep: ${actualMatchCount}个匹配 (${matchesByFile.size}个文件, ${elapsed}秒)`;
    }

    // 🚀 在过滤面板显示耗时（与 Worker 一致）
    const filteredTimeElement = document.getElementById('filteredTime');
    if (filteredTimeElement) {
      filteredTimeElement.textContent = `(耗时 ${elapsedMs}ms)`;
      filteredTimeElement.style.display = 'inline';
    }

    // 更新占位符高度
    const filteredPanelPlaceholder = document.getElementById('filteredPanelPlaceholder');
    if (filteredPanelPlaceholder) {
      // 使用默认行高 24px，如果 filteredPanelLineHeight 未定义
      const lineHeight = typeof filteredPanelLineHeight !== 'undefined' ? filteredPanelLineHeight : 24;
      // 文件头行也占用一行
      filteredPanelPlaceholder.style.height = (sortedLines.length * lineHeight) + 'px';
      console.log(`[Ripgrep Filter] 更新占位符高度: ${sortedLines.length} 行 × ${lineHeight}px = ${sortedLines.length * lineHeight}px`);
    }

    // 清空虚拟内容
    const filteredPanelVirtualContent = document.getElementById('filteredPanelVirtualContent');
    if (filteredPanelVirtualContent) {
      filteredPanelVirtualContent.innerHTML = '';
    }

    // 更新可见行
    console.log('[Ripgrep Filter] 调用 updateFilteredPanelVisibleLines()');
    if (typeof updateFilteredPanelVisibleLines === 'function') {
      updateFilteredPanelVisibleLines();
      console.log('[Ripgrep Filter] updateFilteredPanelVisibleLines() 完成');
    } else {
      console.warn('[Ripgrep Filter] updateFilteredPanelVisibleLines 函数不存在');
    }

    showMessage(`ripgrep过滤完成: ${actualMatchCount}个匹配 (耗时${elapsed}秒)`);
    console.log(`[Ripgrep Filter] ✓ 完成: ${actualMatchCount} 个匹配，分布在 ${matchesByFile.size} 个文件中，耗时 ${elapsed}秒`);

  } catch (error) {
    console.error('[Ripgrep Filter] 过滤失败:', error);
    showMessage(`ripgrep过滤失败: ${error.message}`);
    // 降级：不重新调用，避免无限循环
  }
}

/**
 * 查找文件对应的原始索引（ripgrep 版本）
 */
function findOriginalIndexForFileInRipgrep(filePath, lineNumber) {
  if (typeof fileHeaders === 'undefined') return -1;

  const fileName = filePath.split(/[/\\]/).pop();

  for (let i = 0; i < fileHeaders.length; i++) {
    const header = fileHeaders[i];
    if (header && header.fileName === fileName) {
      return header.index + lineNumber - 1;
    }
  }

  return -1;
}

/**
 * 🚀 新增：使用多线程并行过滤
 * 🚀 优化：优先使用SharedWorker，多窗口共享Worker池
 * 🚀 组合方案：节流更新 + 延迟渲染
 */
function applyFilterWithParallelWorkers(keywords) {
  // 🔧 记录开始时间
  const filterStartTime = performance.now();

  // 🚀 智能跳转：在过滤开始前就记录当前查看位置的原始索引
  // 优先使用点击记录的行，如果没有则使用可见区域的中心行
  let rememberedOriginalIndex = getCurrentVisibleOriginalIndex();
  console.log(`[ParallelFilter] 📍 记忆位置: originalIndex=${rememberedOriginalIndex}`);

  // 清理旧内容
  console.log('[ParallelFilter] 清理旧内容...');
  console.log(`[ParallelFilter] 🔍 数据源检查: originalLines.length = ${originalLines.length}`);

  filteredPanel.classList.add("visible");
  filteredCount.textContent = "";  // 隐藏行数和进度
  document.getElementById('status').textContent = '正在准备多线程过滤...';

  // 🚀 自动隐藏文件树面板，为过滤面板腾出空间
  const fileTreeContainer = document.getElementById('fileTreeContainer');
  const fileTreeCollapseBtn = document.getElementById('fileTreeCollapseBtn');
  if (fileTreeContainer && fileTreeContainer.classList.contains('visible')) {
    fileTreeContainer.classList.remove('visible');
    if (fileTreeCollapseBtn) {
      fileTreeCollapseBtn.innerHTML = '▶';
    }
    // 🚀 记录文件树被过滤面板隐藏
    if (typeof fileTreeWasHiddenByFilter !== 'undefined') {
      fileTreeWasHiddenByFilter = true;
    }
    console.log('[Filter] 文件树面板已自动隐藏');
    // 触发布局更新
    if (typeof updateLayout === 'function') {
      updateLayout();
    }
    if (typeof updateButtonPosition === 'function') {
      updateButtonPosition();
    }
  }

  // 清空旧数据
  filteredPanelAllLines = [];
  // 🚀 优化：使用Int32Array存储索引，内存减半（8字节 → 4字节）
  filteredPanelAllOriginalIndices = new Int32Array(0);
  filteredPanelAllPrimaryIndices = [];
  filteredPanelVisibleStart = 0;
  filteredPanelVisibleEnd = 0;
  filteredPanelPlaceholder.style.height = "0px";
  filteredPanelVirtualContent.innerHTML = "";
  filteredPanelContent.scrollTop = 0;
  filteredPanelScrollPosition = 0;

  // 🚀 新增：累积所有已完成块的结果
  let cumulativeResults = [];  // 累积的所有匹配索引
  let completedChunks = 0;     // 已完成的块数量

  // 延迟启动，确保 UI 更新
  setTimeout(() => {
    // 🚀 选择管理器：优先使用SharedWorker，但需要检查是否真正可用
    let useSharedWorker = false;

    if (typeof sharedFilterManager !== 'undefined' && sharedFilterManager !== null) {
      // 检查SharedWorker是否真正初始化成功（有Worker池）
      useSharedWorker = sharedFilterManager.isConnected && sharedFilterManager.totalChunks > 0;
    }

    const manager = useSharedWorker ? sharedFilterManager : parallelFilterManager;

    console.log(`[ParallelFilter] 使用${useSharedWorker ? 'Shared' : '普通'}Worker模式`);
    console.log(`[ParallelFilter] 📊 发送给Worker: ${originalLines.length} 行`);

    // 设置回调
    manager.setProgressCallback((progress) => {
      // 🚀 只在状态栏显示进度，不显示行数
      filteredCount.textContent = "";  // 隐藏行数和百分比
      document.getElementById('status').textContent =
        `多线程过滤中... ${progress.percentage}%`;
    });

    manager.setChunkCompleteCallback((results, progress, chunkIndex) => {
      // 🚀 方案1：节流更新 - 只累积数据，不更新DOM
      console.log(`[ParallelFilter] 块 ${chunkIndex} 完成，新增 ${results.length} 条结果`);

      const chunkStartTime = performance.now();

      // 累积结果索引
      cumulativeResults = cumulativeResults.concat(results);
      completedChunks++;

      // 🚀 只处理新增的部分，获取新行的内容（但不更新DOM）
      const newFilteredLines = [];
      const newFilteredToOriginalIndex = [];

      for (const index of results) {
        if (index >= 0 && index < originalLines.length) {
          newFilteredLines.push(originalLines[index]);
          newFilteredToOriginalIndex.push(index);
        }
      }

      // 🚀 追加到全局数组（不重建，不更新DOM）
      if (filteredPanelAllLines.length === 0) {
        filteredPanelAllLines = newFilteredLines;
        filteredPanelAllOriginalIndices = newFilteredToOriginalIndex;
      } else {
        filteredPanelAllLines = filteredPanelAllLines.concat(newFilteredLines);
        filteredPanelAllOriginalIndices = filteredPanelAllOriginalIndices.concat(newFilteredToOriginalIndex);
      }
      filteredPanelAllPrimaryIndices = [];

      // 🚀 关键：不显示行数和百分比
      filteredCount.textContent = "";  // 隐藏行数和百分比

      const chunkTime = performance.now() - chunkStartTime;
      console.log(`[ParallelFilter] 📊 块 ${chunkIndex} 数据收集完成: +${results.length} 条，总计 ${filteredPanelAllLines.length} 条（耗时${chunkTime.toFixed(0)}ms）`);
    });

    manager.setCompleteCallback((results, stats) => {
      // 🎉 所有 Worker 完成
      console.log(`[ParallelFilter] 全部完成: ${stats.matchedCount} 个匹配`);

      // 🚀 调试：检查返回的原始结果（优化：不输出大数组）
      console.log(`[ParallelFilter] Worker 返回的索引数量: ${results.length}`);

      // 只显示前5个索引（转换为字符串，避免输出大对象）
      if (results.length > 0) {
        const sampleSize = Math.min(5, results.length);
        const sample = Array.from(results.slice(0, sampleSize)).join(', ');
        const more = results.length > sampleSize ? `... (+${results.length - sampleSize} 更多)` : '';
        console.log(`[ParallelFilter] 前${sampleSize}个索引: [${sample}]${more}`);
      }

      // 🔧 计算总耗时
      const totalTime = (performance.now() - filterStartTime).toFixed(2);
      console.log(`[ParallelFilter] ✅ 结果验证: 从 ${originalLines.length} 行中找到 ${stats.matchedCount} 个匹配 (耗时 ${totalTime}ms)`);

      // 🚀 关键修复：使用归并排序后的结果重建全局数组，确保按原始索引顺序
      const sortedFilteredLines = [];
      const sortedFilteredToOriginalIndex = [];

      // 🚀 去重并过滤无效索引
      const uniqueResults = [...new Set(results)].filter(idx => idx >= 0 && idx < originalLines.length);
      console.log(`[ParallelFilter] 去重后的索引数量: ${uniqueResults.length} (原始: ${results.length})`);

      // 只显示前5个去重后的索引
      if (uniqueResults.length > 0) {
        const sampleSize = Math.min(5, uniqueResults.length);
        const sample = uniqueResults.slice(0, sampleSize).join(', ');
        const more = uniqueResults.length > sampleSize ? `... (+${uniqueResults.length - sampleSize} 更多)` : '';
        console.log(`[ParallelFilter] 前${sampleSize}个去重后索引: [${sample}]${more}`);
      }

      // 🚀 性能优化：分批复制，避免主线程长时间阻塞
      console.log(`[ParallelFilter] 开始复制 ${uniqueResults.length} 条结果...`);

      // 预设数组大小，避免动态扩容
      sortedFilteredLines = new Array(uniqueResults.length);
      sortedFilteredToOriginalIndex = new Int32Array(uniqueResults.length);

      const COPY_BATCH_SIZE = 10000; // 每批处理1万条
      let processedCount = 0;

      const copyBatch = () => {
        const batchStart = performance.now();
        const batchEnd = Math.min(processedCount + COPY_BATCH_SIZE, uniqueResults.length);

        // 复制当前批次
        for (let i = processedCount; i < batchEnd; i++) {
          const index = uniqueResults[i];
          sortedFilteredLines[i] = originalLines[index];
          sortedFilteredToOriginalIndex[i] = index;
        }

        processedCount = batchEnd;

        // 更新进度
        const percentage = ((processedCount / uniqueResults.length) * 100).toFixed(1);
        document.getElementById('status').textContent =
          `正在处理结果 ${processedCount}/${uniqueResults.length} (${percentage}%)...`;

        // 如果还有更多，继续下一批
        if (processedCount < uniqueResults.length) {
          // 使用 setTimeout(0) 让出主线程，允许UI更新
          setTimeout(copyBatch, 0);
        } else {
          // 全部完成，继续后续流程
          console.log(`[ParallelFilter] ✓ 结果复制完成，共 ${sortedFilteredLines.length} 条`);

          // 更新全局数组
          filteredPanelAllLines = sortedFilteredLines;
          filteredPanelAllOriginalIndices = sortedFilteredToOriginalIndex;

          console.log(`[ParallelFilter] ✅ 结果已按原始索引排序，共 ${filteredPanelAllLines.length} 条`);

          // 🚀 方案4：延迟渲染 - 显示加载动画，分批渲染DOM
          startDelayedRendering(totalTime, stats, useSharedWorker, rememberedOriginalIndex);
        }
      };

      // 开始分批复制
      copyBatch();
    });

    /**
     * 🚀 延迟渲染函数 - 分批渲染DOM，避免主线程阻塞
     */
    function startDelayedRendering(totalTime, stats, useSharedWorker, rememberedOriginalIndex) {
      const totalResults = filteredPanelAllLines.length;

      // 显示加载提示
      document.getElementById('status').textContent =
        `正在加载 ${totalResults} 条结果到界面...`;

      // 🚀 分批渲染配置
      const RENDER_BATCH_SIZE = 50000;  // 每批渲染5万条
      let renderedCount = 0;

      // 设置占位高度（提前知道总结果数）
      const totalHeight = totalResults * filteredPanelLineHeight;
      filteredPanelPlaceholder.style.height = totalHeight + "px";

      // 🚀 分批渲染函数
      const renderBatch = () => {
        const batchStartTime = performance.now();

        // 当前批次结束位置
        const batchEnd = Math.min(renderedCount + RENDER_BATCH_SIZE, totalResults);

        // 🚀 关键修复：不要重新赋值 filteredPanelAllLines
        // 保持 filteredPanelAllLines 包含所有数据，只更新 currentFilter.totalLines
        // 这样滚动时不会出现数组越界错误
        currentFilter = {
          filteredLines: filteredPanelAllLines,  // 🚀 使用完整数据，不slice
          filteredToOriginalIndex: filteredPanelAllOriginalIndices,  // 🚀 使用完整数据，不slice
          filterKeywords: currentFilter.filterKeywords,
          totalLines: batchEnd,  // 🚀 只控制显示行数
        };
        filteredLineCacheVersion++;
        isFiltering = true;

        // 🚀 关键：不要重新赋值全局数组，保持完整数据
        // filteredPanelAllLines 已经包含所有数据，不需要修改
        filteredPanelAllPrimaryIndices = [];

        // 更新进度提示
        document.getElementById('status').textContent =
          `正在加载 ${batchEnd} / ${totalResults} 条结果 (${(batchEnd/totalResults*100).toFixed(0)}%)`;

        // 更新可见行（只渲染可见部分）
        updateFilteredPanelVisibleLines();

        renderedCount = batchEnd;

        const batchTime = performance.now() - batchStartTime;
        console.log(`[ParallelFilter] 📊 渲染批次: ${renderedCount}/${totalResults} (${(renderedCount/totalResults*100).toFixed(0)}%, 耗时${batchTime.toFixed(0)}ms)`);

        // 继续下一批或完成
        if (renderedCount < totalResults) {
          // 使用 requestAnimationFrame 让出控制权，避免阻塞主线程
          requestAnimationFrame(renderBatch);
        } else {
          // 🎉 全部渲染完成
          onRenderComplete(totalTime, stats, useSharedWorker, rememberedOriginalIndex);
        }
      };

      // 开始渲染第一批
      requestAnimationFrame(renderBatch);
    }

    // 启动多线程过滤
    const success = manager.start(originalLines, keywords);

    if (!success) {
      console.error('[ParallelFilter] 启动失败，回退到单线程');
      applyFilterWithSingleWorker(keywords);
    }
  }, 0);

  /**
   * 🚀 渲染完成后的处理
   */
  function onRenderComplete(totalTime, stats, useSharedWorker, rememberedOriginalIndex) {
    console.log(`[ParallelFilter] ✅ 所有批次渲染完成`);

    // 延迟更新 DOM，确保所有数据已准备好
    setTimeout(() => {
      // 更新主日志框
      renderLogLines();
      outer.scrollTop = 0;
      updateVisibleLines();

      // 重置搜索和二级过滤
      resetSearch();

      secondaryFilter = {
        isActive: false,
        filterText: "",
        filterKeywords: [],
        filteredLines: [],
        filteredToOriginalIndex: [],
        filteredToPrimaryIndex: [],
      };

      secondaryFilterStatus.textContent = "未应用";
      secondaryFilterStatus.className = "secondary-filter-status secondary-filter-inactive";
      filteredPanelFilterStatus.textContent = "";
      filteredPanelFilterBox.value = "";
      updateRegexStatus();

      // 🚀 智能跳转：查找之前点击的行是否还在新结果中
      let targetFilteredIndex = -1;
      if (rememberedOriginalIndex >= 0 && currentFilter.filteredToOriginalIndex && currentFilter.filteredToOriginalIndex.length > 0) {
        // 在新结果中查找完全匹配的原始索引
        targetFilteredIndex = currentFilter.filteredToOriginalIndex.indexOf(rememberedOriginalIndex);
        console.log(`[ParallelFilter] 查找之前的选中行: rememberedOriginalIndex=${rememberedOriginalIndex}, targetFilteredIndex=${targetFilteredIndex}`);

        // 🚀 如果没找到精确匹配，找到原始行号最接近的行
        if (targetFilteredIndex < 0) {
          console.log(`[ParallelFilter] 📍 目标行不在结果中，使用原始行号查找最接近的行...`);

          const indices = currentFilter.filteredToOriginalIndex;
          // 使用二分查找找到插入位置
          let left = 0;
          let right = indices.length - 1;
          while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (indices[mid] < rememberedOriginalIndex) {
              left = mid + 1;
            } else {
              right = mid - 1;
            }
          }

          // left 是应该插入的位置，比较 left 和 left-1 哪个更接近
          if (left >= indices.length) {
            // 目标行比所有结果都大，使用最后一个
            targetFilteredIndex = indices.length - 1;
          } else if (left === 0) {
            // 目标行比所有结果都小，使用第一个
            targetFilteredIndex = 0;
          } else {
            // 比较左右两个哪个更接近
            const diffLeft = Math.abs(indices[left - 1] - rememberedOriginalIndex);
            const diffRight = Math.abs(indices[left] - rememberedOriginalIndex);
            targetFilteredIndex = diffLeft <= diffRight ? left - 1 : left;
          }

          const closestOriginalIndex = indices[targetFilteredIndex];
          console.log(`[ParallelFilter] ✓ 找到原始行号最接近的行: filteredIndex=${targetFilteredIndex}, originalIndex=${closestOriginalIndex}, 距离=${Math.abs(closestOriginalIndex - rememberedOriginalIndex)}`);
        }
      }

      // 🚀 如果找到了匹配的行（精确或最接近），跳转并高亮
      if (targetFilteredIndex >= 0) {
        console.log(`[ParallelFilter] 跳转到目标行: ${targetFilteredIndex}`);
        lastClickedFilteredIndex = targetFilteredIndex;

        // 延迟执行，确保 DOM 已经更新
        setTimeout(() => {
          const filteredPanelContent = document.getElementById('filteredPanelContent');
          const filteredPanelVirtualContent = document.getElementById('filteredPanelVirtualContent');

          if (!filteredPanelContent || !filteredPanelVirtualContent) {
            console.error('[ParallelFilter] 无法找到过滤面板元素');
            return;
          }

          // 获取实际的行高（如果 filteredPanelLineHeight 未定义，则从第一个元素获取）
          let lineHeight = typeof filteredPanelLineHeight !== 'undefined' ? filteredPanelLineHeight : 19;
          const firstLine = filteredPanelVirtualContent.querySelector('.filtered-log-line');
          if (firstLine) {
            const actualHeight = firstLine.getBoundingClientRect().height;
            if (actualHeight > 0) {
              lineHeight = actualHeight;
            }
          }

          // 移除旧的高亮
          const oldHighlights = filteredPanelVirtualContent.querySelectorAll('.filtered-log-line.highlighted, .filtered-log-line.search-match-highlight');
          oldHighlights.forEach(line => {
            line.classList.remove('highlighted', 'search-match-highlight');
          });

          // 滚动到目标行
          const lineTop = targetFilteredIndex * lineHeight;
          const panelHeight = filteredPanelContent.clientHeight;
          const targetTop = Math.max(0, lineTop - panelHeight / 2);

          filteredPanelContent.scrollTop = targetTop;

          // 高亮目标行
          const targetLine = filteredPanelVirtualContent.querySelector(`[data-filtered-index="${targetFilteredIndex}"]`);
          if (targetLine) {
            targetLine.classList.add('highlighted');
            console.log(`[ParallelFilter] ✓ 已跳转并高亮行 ${targetFilteredIndex} (行高: ${lineHeight}px)`);
          } else {
            console.warn(`[ParallelFilter] 行 ${targetFilteredIndex} 不在可见区域，等待滚动事件触发高亮`);
          }
        }, 150);
      } else {
        console.log('[ParallelFilter] 未找到之前的选中行，重置选中状态');
        lastClickedFilteredIndex = -1;
      }

      // 🚀 更新状态栏 - 显示耗时（与 ripgrep 格式一致）
      const modeText = useSharedWorker ? 'SharedWorker' : 'Worker';
      const timeInSeconds = (totalTime / 1000).toFixed(2);
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = `✓ ${modeText}: ${stats.matchedCount}个匹配 (${timeInSeconds}秒)`;
      }

      // 完成提示 - 在过滤面板显示时间
      const filteredTimeElement = document.getElementById('filteredTime');
      if (filteredTimeElement) {
        filteredTimeElement.textContent = `(耗时 ${totalTime}ms)`;
        filteredTimeElement.style.display = 'inline';
      }

      showMessage(`${modeText}过滤完成: 找到 ${stats.matchedCount} 个匹配项 (耗时${timeInSeconds}秒)`);

      // 🚀 如果找到了匹配的行，延迟跳转并高亮
      if (targetFilteredIndex >= 0 && typeof scrollFilteredPanelToIndex === 'function') {
        requestAnimationFrame(() => {
          setTimeout(() => {
            scrollFilteredPanelToIndex(targetFilteredIndex);
          }, 100);
        });
      }
    }, 0);
  }
}

/**
 * 单线程过滤（原有的 Worker 逻辑）
 */
function applyFilterWithSingleWorker(keywords) {
  // 🚀 智能跳转：记录当前查看位置的原始索引
  // 优先使用点击记录的行，如果没有则使用可见区域的中心行
  let rememberedOriginalIndex = getCurrentVisibleOriginalIndex();
  console.log(`[Filter SingleWorker] 📍 记忆位置: originalIndex=${rememberedOriginalIndex}`);

  // 🚀 自动隐藏文件树面板，为过滤面板腾出空间
  const fileTreeContainer = document.getElementById('fileTreeContainer');
  const fileTreeCollapseBtn = document.getElementById('fileTreeCollapseBtn');
  if (fileTreeContainer && fileTreeContainer.classList.contains('visible')) {
    fileTreeContainer.classList.remove('visible');
    if (fileTreeCollapseBtn) {
      fileTreeCollapseBtn.innerHTML = '▶';
    }
    // 🚀 记录文件树被过滤面板隐藏
    if (typeof fileTreeWasHiddenByFilter !== 'undefined') {
      fileTreeWasHiddenByFilter = true;
    }
    console.log('[Filter] 文件树面板已自动隐藏');
    // 触发布局更新
    if (typeof updateLayout === 'function') {
      updateLayout();
    }
    if (typeof updateButtonPosition === 'function') {
      updateButtonPosition();
    }
  }

  // 初始化 Worker
  if (!filterWorker) {
    try {
      filterWorker = new Worker('renderer/workers/filter-worker.js');

      filterWorker.onmessage = function(e) {
        const { type, sessionId, results, progress, stats, partialResults, error } = e.data;

        if (type === 'progress') {
          // 性能优化：每次都更新状态文本（轻量操作）
          document.getElementById('status').textContent =
            `过滤中... ${progress.percentage}% (${progress.matched} 个匹配)`;

          // 不显示悬浮进度条
          // if (progressBar && progressFill) {
          //   progressBar.style.display = 'block';
          //   progressFill.style.width = `${progress.percentage}%`;
          // }

          // 🚀 增量显示：只处理有部分结果且会话匹配的消息
          if (partialResults && partialResults.length > 0 && sessionId === workerSessionId) {
            applyPartialWorkerResults(partialResults, progress);
          }
        } else if (type === 'complete') {
          if (sessionId === workerSessionId) {
            applyWorkerResults(results, stats, rememberedOriginalIndex);
          }
        } else if (type === 'error') {
          // 🚀 处理 Worker 返回的错误
          console.error('[Filter] Worker 处理错误:', error.message, error.stack);
          filterWorker = null;
          showMessage(`过滤失败：${error.message}`);
        }
      };

      filterWorker.onerror = function(error) {
        console.error('[Filter] Worker 错误事件:', error);
        console.error('[Filter] 错误详情:', {
          type: error.type,
          message: error.message,
          filename: error.filename,
          lineno: error.lineno,
          colno: error.colno
        });

        // 🚀 尝试获取更多信息
        const errorMsg = error.message || '未知错误';
        const errorFile = error.filename || '未知文件';
        const errorLine = error.lineno || '未知行';

        filterWorker = null;

        // 🚀 回退方案：在主线程中执行过滤
        console.warn('[Filter] Worker 崩溃，回退到主线程过滤');
        showMessage('Worker 崩溃，正在使用主线程过滤...');

        // 延迟执行，让错误消息先显示
        setTimeout(() => {
          applyFilterInMainThread(keywords);
        }, 100);
      };

      console.log('[Filter] Worker 已初始化');
    } catch (error) {
      console.error('[Filter] Worker 初始化失败:', error);
      filterWorker = null;
      console.warn('[Filter] Worker 初始化失败，尝试其他方案');
      showMessage('过滤失败：无法初始化 Worker，请刷新页面重试');
      return;
    }
  }

  // 取消之前的操作
  filterWorker.postMessage({ type: 'cancel' });

  // 生成新的会话 ID
  workerSessionId = Date.now();

  // 发送过滤请求
  // 性能优化：根据数据量动态调整批次大小
  const totalLines = originalLines.length;
  const chunkSize = totalLines > 100000 ? 50000 :  // 超大数据：5万/批
                    totalLines > 50000 ? 20000 :   // 大数据：2万/批
                    totalLines > 10000 ? 10000 :   // 中数据：1万/批
                    5000;                          // 小数据：5千/批

  // 🚀 数据验证：检查数据是否可以安全传输
  console.log('[Filter] 准备发送数据到 Worker:', {
    totalLines: totalLines,
    keywordsCount: keywords.length,
    chunkSize: chunkSize,
    firstLineSample: originalLines[0] ? originalLines[0].substring(0, 100) : '(empty)',
    lastLineSample: originalLines[totalLines - 1] ? originalLines[totalLines - 1].substring(0, 100) : '(empty)',
    dataTypes: originalLines.map(l => typeof l).slice(0, 10)
  });

  // 🚀 尝试检测数据问题
  try {
    const testData = JSON.stringify({
      lines: originalLines.slice(0, 10),
      keywords: keywords,
      sessionId: workerSessionId
    });
    console.log('[Filter] 数据序列化测试成功，数据大小:', testData.length);
  } catch (e) {
    console.error('[Filter] 数据序列化失败:', e);
    showMessage('过滤失败：数据包含无法序列化的内容');
    return;
  }

  filterWorker.postMessage({
    type: 'filter',
    data: {
      lines: originalLines,
      keywords: keywords,
      sessionId: workerSessionId,
      chunkSize: chunkSize
    }
  });

  document.getElementById('status').textContent = '正在初始化过滤...';
}

/**
 * 🚀 主线程过滤（Worker 崩溃时的回退方案）
 * 注意：会阻塞 UI，仅作为紧急回退使用
 */
function applyFilterInMainThread(keywords) {
  try {
    console.log('[Filter] 开始主线程过滤，数据行数:', originalLines.length);
    document.getElementById('status').textContent = '正在主线程过滤...';

    const startTime = performance.now();
    const matchedIndices = [];

    // 分批处理，避免完全冻结 UI
    const BATCH_SIZE = 1000;
    let processedCount = 0;

    function processBatch() {
      const endIndex = Math.min(processedCount + BATCH_SIZE, originalLines.length);

      for (let i = processedCount; i < endIndex; i++) {
        try {
          const line = originalLines[i];
          if (line == null) continue;

          const plainText = line; // 直接使用原始内容

          // 检查是否匹配
          if (matchesKeywordsInMainThread(plainText, keywords)) {
            matchedIndices.push({
              index: i,
              content: plainText
            });
          }
        } catch (e) {
          console.error('[Filter] 处理第', i, '行时出错:', e);
        }

        processedCount++;
      }

      // 更新进度
      const percentage = (processedCount / originalLines.length * 100).toFixed(1);
      document.getElementById('status').textContent =
        `正在主线程过滤... ${percentage}% (${matchedIndices.length} 个匹配)`;

      if (processedCount < originalLines.length) {
        // 继续处理下一批
        setTimeout(processBatch, 0);
      } else {
        // 完成
        const totalTime = performance.now() - startTime;
        console.log(`[Filter] 主线程过滤完成: ${matchedIndices.length} 个匹配, 耗时 ${totalTime.toFixed(2)}ms`);

        // 转换结果格式
        const filteredLines = [];
        const filteredToOriginalIndex = [];
        for (const item of matchedIndices) {
          filteredLines.push(originalLines[item.index]);
          filteredToOriginalIndex.push(item.index);
        }

        applyWorkerResults(filteredLines, filteredToOriginalIndex, {
          totalLines: originalLines.length,
          matchedCount: matchedIndices.length,
          totalTime: totalTime.toFixed(2)
        });

        showMessage(`主线程过滤完成: 找到 ${matchedIndices.length} 个匹配项`);
      }
    }

    processBatch();
  } catch (error) {
    console.error('[Filter] 主线程过滤失败:', error);
    showMessage(`过滤失败：${error.message}`);
  }
}

/**
 * 主线程中的关键词匹配函数
 */
function matchesKeywordsInMainThread(text, keywords) {
  if (!keywords || keywords.length === 0) return true;

  const lowerText = text.toLowerCase();

  for (const keyword of keywords) {
    if (!keyword) continue;

    // 检查是否是正则表达式
    if (keyword.includes('|') || /[.*+?^${}()|[\]\\]/.test(keyword)) {
      try {
        const regex = new RegExp(keyword, 'i');
        if (regex.test(lowerText)) {
          return true;
        }
      } catch (e) {
        // 正则表达式错误，回退到字符串搜索
        if (lowerText.includes(keyword.toLowerCase())) {
          return true;
        }
      }
    } else {
      // 简单字符串搜索（更快）
      if (lowerText.includes(keyword.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 去除 HTML 转义字符（主线程版本）
 */
function unescapeHtml(html) {
  if (!html) return '';

  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x3D;/g, '=');
}

/**
 * 🚀 应用 Worker 部分过滤结果（增量显示）
 * 在过滤过程中逐步显示已找到的结果，提升用户体验
 */
function applyPartialWorkerResults(partialResults, progress) {
  if (!partialResults || !Array.isArray(partialResults) || partialResults.length === 0) {
    return;
  }

  const partialFilteredLines = [];
  const partialFilteredToOriginalIndex = [];

  for (const item of partialResults) {
    partialFilteredLines.push(originalLines[item.index]);
    partialFilteredToOriginalIndex.push(item.index);
  }

  // 更新当前过滤状态
  currentFilter = {
    filteredLines: partialFilteredLines,
    filteredToOriginalIndex: partialFilteredToOriginalIndex,
    filterKeywords: currentFilter.filterKeywords,
    totalLines: partialFilteredLines.length, // 注意：这是临时的，最终会被完整结果覆盖
  };

  // 更新过滤面板显示
  // 注意：不调用 renderLogLines()，因为主日志框要等全部过滤完才显示
  // 只更新过滤结果框
  filteredPanel.classList.add("visible");
  filteredPanelAllLines = partialFilteredLines;
  filteredPanelAllOriginalIndices = partialFilteredToOriginalIndex;
  filteredPanelAllPrimaryIndices = [];

  // 🚀 修复：限制百分比不超过100%
  let displayPercentage = parseFloat(progress.percentage);
  displayPercentage = Math.min(100, Math.max(0, displayPercentage)).toFixed(1);

  // 不显示行数和百分比
  filteredCount.textContent = "";

  // 性能优化：只在第一次或数量显著增加时才更新 DOM
  // 避免频繁的 DOM 操作
  const shouldUpdateDOM = partialFilteredLines.length <= 100;

  if (shouldUpdateDOM) {
    // 重置虚拟滚动状态
    filteredPanelVisibleStart = 0;
    filteredPanelVisibleEnd = 0;

    // 设置占位元素高度
    const totalHeight = partialFilteredLines.length * filteredPanelLineHeight;
    filteredPanelPlaceholder.style.height = totalHeight + "px";

    // 清空虚拟内容
    filteredPanelVirtualContent.innerHTML = "";

    // 重置滚动位置（只在第一次显示时）
    if (partialFilteredLines.length <= 50) {
      filteredPanelContent.scrollTop = 0;
      filteredPanelScrollPosition = 0;
    }

    // 立即更新可见行
    updateFilteredPanelVisibleLines();

    console.log(`[Filter] 增量显示: ${partialFilteredLines.length} 条结果 (${displayPercentage}%)`);
  } else {
    // 只更新计数和高度，不重新渲染所有行
    const totalHeight = partialFilteredLines.length * filteredPanelLineHeight;
    filteredPanelPlaceholder.style.height = totalHeight + "px";
  }
}

/**
 * 应用 Worker 过滤结果
 * 🚀 优化：参数改为已转换的数组，避免重复转换
 */
function applyWorkerResults(filteredLines, filteredToOriginalIndex, stats, rememberedOriginalIndex = -1) {
  if (!filteredLines || !Array.isArray(filteredLines)) {
    console.error('[Filter] 无效的结果数据');
    return;
  }

  // 🚀 调试：检查原始数据（优化：不输出大数组）
  console.log(`[Filter] Worker 返回: ${filteredLines.length} 行, ${filteredToOriginalIndex.length} 个索引`);

  // 只显示前5个和后5个索引（转换为字符串）
  if (filteredToOriginalIndex.length > 0) {
    const sampleSize = Math.min(5, filteredToOriginalIndex.length);
    const firstSample = filteredToOriginalIndex.slice(0, sampleSize).join(', ');
    console.log(`[Filter] Worker 返回的前${sampleSize}个索引: [${firstSample}]`);

    if (filteredToOriginalIndex.length > 5) {
      const lastSample = filteredToOriginalIndex.slice(-sampleSize).join(', ');
      console.log(`[Filter] Worker 返回的最后${sampleSize}个索引: [${lastSample}]`);
    }
  }

  // 🚀 关键修复：去重并过滤无效索引
  const indexMap = new Map();  // 使用 Map 去重并保持顺序
  const uniqueIndices = [];
  const uniqueLines = [];

  for (let i = 0; i < filteredToOriginalIndex.length; i++) {
    const idx = filteredToOriginalIndex[i];
    // 过滤无效索引和重复索引
    if (idx >= 0 && idx < originalLines.length && !indexMap.has(idx)) {
      indexMap.set(idx, true);
      uniqueIndices.push(idx);
      uniqueLines.push(filteredLines[i]);
    }
  }

  console.log(`[Filter] 去重后: ${uniqueIndices.length} 个索引 (原始: ${filteredToOriginalIndex.length})`);
  console.log(`[Filter] 实际唯一匹配数: ${uniqueIndices.length}`);

  currentFilter = {
    filteredLines: uniqueLines,
    filteredToOriginalIndex: uniqueIndices,
    filterKeywords: currentFilter.filterKeywords,
    totalLines: uniqueLines.length,
  };

  filteredLineCacheVersion++;
  isFiltering = true;

  // 🚀 更新状态栏 - 显示耗时（与 ripgrep 格式一致）
  const timeInSeconds = stats.totalTime ? (stats.totalTime / 1000).toFixed(2) : '0.00';
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = `✓ Worker: ${uniqueIndices.length}个匹配 (${timeInSeconds}秒)`;
  }

  // 在过滤面板显示时间
  const filteredTimeElement = document.getElementById('filteredTime');
  if (filteredTimeElement && stats.totalTime) {
    filteredTimeElement.textContent = `(耗时 ${stats.totalTime}ms)`;
    filteredTimeElement.style.display = 'inline';
  }

  // 不显示悬浮进度条
  // if (progressBar) progressBar.style.display = 'none';

  resetSearch();
  renderLogLines();
  outer.scrollTop = 0;
  updateVisibleLines();
  updateFilteredPanel();

  // 🚀 智能跳转：查找之前点击的行是否还在新结果中
  let targetFilteredIndex = -1;
  if (rememberedOriginalIndex >= 0 && uniqueIndices.length > 0) {
    // 在新结果中查找完全匹配的原始索引
    targetFilteredIndex = uniqueIndices.indexOf(rememberedOriginalIndex);
    console.log(`[Filter Worker] 查找之前的选中行: rememberedOriginalIndex=${rememberedOriginalIndex}, targetFilteredIndex=${targetFilteredIndex}`);

    // 🚀 如果没找到精确匹配，找到原始行号最接近的行
    if (targetFilteredIndex < 0) {
      console.log(`[Filter Worker] 📍 目标行不在结果中，使用原始行号查找最接近的行...`);

      // 使用二分查找找到插入位置
      let left = 0;
      let right = uniqueIndices.length - 1;
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (uniqueIndices[mid] < rememberedOriginalIndex) {
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }

      // left 是应该插入的位置，比较 left 和 left-1 哪个更接近
      if (left >= uniqueIndices.length) {
        // 目标行比所有结果都大，使用最后一个
        targetFilteredIndex = uniqueIndices.length - 1;
      } else if (left === 0) {
        // 目标行比所有结果都小，使用第一个
        targetFilteredIndex = 0;
      } else {
        // 比较左右两个哪个更接近
        const diffLeft = Math.abs(uniqueIndices[left - 1] - rememberedOriginalIndex);
        const diffRight = Math.abs(uniqueIndices[left] - rememberedOriginalIndex);
        targetFilteredIndex = diffLeft <= diffRight ? left - 1 : left;
      }

      const closestOriginalIndex = uniqueIndices[targetFilteredIndex];
      console.log(`[Filter Worker] ✓ 找到原始行号最接近的行: filteredIndex=${targetFilteredIndex}, originalIndex=${closestOriginalIndex}, 距离=${Math.abs(closestOriginalIndex - rememberedOriginalIndex)}`);
    }
  }

  // 🚀 如果找到了匹配的行（精确或最接近），跳转并高亮
  if (targetFilteredIndex >= 0) {
    console.log(`[Filter Worker] 跳转到目标行: ${targetFilteredIndex}`);
    lastClickedFilteredIndex = targetFilteredIndex;

    // 延迟执行，确保 DOM 已经更新
    setTimeout(() => {
      const filteredPanelContent = document.getElementById('filteredPanelContent');
      const filteredPanelVirtualContent = document.getElementById('filteredPanelVirtualContent');

      if (!filteredPanelContent || !filteredPanelVirtualContent) {
        console.error('[Filter Worker] 无法找到过滤面板元素');
        return;
      }

      // 获取实际的行高（如果 filteredPanelLineHeight 未定义，则从第一个元素获取）
      let lineHeight = typeof filteredPanelLineHeight !== 'undefined' ? filteredPanelLineHeight : 19;
      const firstLine = filteredPanelVirtualContent.querySelector('.filtered-log-line');
      if (firstLine) {
        const actualHeight = firstLine.getBoundingClientRect().height;
        if (actualHeight > 0) {
          lineHeight = actualHeight;
        }
      }

      // 移除旧的高亮
      const oldHighlights = filteredPanelVirtualContent.querySelectorAll('.filtered-log-line.highlighted, .filtered-log-line.search-match-highlight');
      oldHighlights.forEach(line => {
        line.classList.remove('highlighted', 'search-match-highlight');
      });

      // 滚动到目标行
      const lineTop = targetFilteredIndex * lineHeight;
      const panelHeight = filteredPanelContent.clientHeight;
      const targetTop = Math.max(0, lineTop - panelHeight / 2);

      filteredPanelContent.scrollTop = targetTop;

      // 高亮目标行
      const targetLine = filteredPanelVirtualContent.querySelector(`[data-filtered-index="${targetFilteredIndex}"]`);
      if (targetLine) {
        targetLine.classList.add('highlighted');
        console.log(`[Filter Worker] ✓ 已跳转并高亮行 ${targetFilteredIndex} (行高: ${lineHeight}px)`);
      } else {
        console.warn(`[Filter Worker] 行 ${targetFilteredIndex} 不在可见区域，等待滚动事件触发高亮`);
      }
    }, 150);
  } else {
    console.log('[Filter Worker] 未找到之前的选中行，重置选中状态');
    lastClickedFilteredIndex = -1;
  }

  secondaryFilter = {
    isActive: false,
    filterText: "",
    filterKeywords: [],
    filteredLines: [],
    filteredToOriginalIndex: [],
    filteredToPrimaryIndex: [],
  };

  secondaryFilterStatus.textContent = "未应用";
  secondaryFilterStatus.className = "secondary-filter-status secondary-filter-inactive";
  filteredPanelFilterStatus.textContent = "";
  filteredPanelFilterBox.value = "";
  updateRegexStatus();

  // 🚀 移除自动最大化：第一次过滤时不自动最大化面板
  // if (isFirstFilter) {
  //   isFirstFilter = false;
  //   if (!isFilterPanelMaximized) {
  //     toggleFilterPanelMaximize();
  //   }
  // }

  showMessage(`过滤完成: 找到 ${filteredLines.length} 个匹配项`);
}

// ==================== 主过滤函数（修改版）====================

// ==================== 说明 ====================

/*
SharedWorker 多窗口共享过滤方案

文件结构：
- renderer/js/shared-filter-manager.js - SharedWorker客户端管理器
- renderer/js/parallel-filter-manager.js - 普通Worker管理器（备用）
- renderer/workers/shared-filter-worker.js - SharedWorker服务端
- renderer/workers/parallel-filter-worker.js - 并行过滤Worker

功能特性：
1. 多窗口共享Worker池 - 所有窗口共享8个Worker，节省内存
2. 自动回退机制 - SharedWorker不可用时自动使用普通Worker
3. 完善的资源清理 - 窗口关闭时自动清理连接
4. 增量显示优化 - Worker完成立即显示结果

性能说明：

- 单窗口：8个Worker并行处理
- 多窗口：所有窗口共享8个Worker
- 小数据（<1万行）：单线程Worker
- 大数据（≥5万行）：多线程并行Worker

预期日志：

成功模式（SharedWorker）：
[ParallelFilter] 使用SharedWorker模式
[SharedFilter] ✓ 已连接到SharedWorker (客户端ID: 1, Worker数: 8)
SharedWorker过滤完成: 找到 xxx 个匹配项

回退模式（普通Worker）：
[ParallelFilter] 使用普通Worker模式
[ParallelFilter] 初始化 8 个 Worker (CPU 核心: 14)
多线程过滤完成: 找到 xxx 个匹配项

故障排除：

1. SharedWorker不工作：
   - 检查浏览器是否支持SharedWorker
   - 查看SharedWorker独立控制台：chrome://workers
   - 自动回退到普通Worker模式

2. Worker路径错误：
   - 确保文件在renderer/workers/目录
   - parallel-filter-worker.js
   - shared-filter-worker.js

3. 性能问题：
   - 检查Worker数量：默认8个
   - 检查数据量：大数据才用多线程
   - 查看Worker耗时日志

*/

// ==================== 窗口关闭时的资源清理 ====================

/**
 * 🚀 窗口/页面卸载时的清理逻辑
 * 确保SharedWorker连接正确关闭，防止内存泄漏
 */
function cleanupOnUnload() {
  console.log('[Cleanup] 页面卸载，开始清理资源...');

  // 清理SharedWorker连接
  if (typeof sharedFilterManager !== 'undefined' && sharedFilterManager !== null) {
    try {
      sharedFilterManager.cleanup();
      console.log('[Cleanup] SharedWorker连接已关闭');
    } catch (error) {
      console.error('[Cleanup] 关闭SharedWorker连接失败:', error);
    }
  }

  // 清理普通Worker连接
  if (typeof parallelFilterManager !== 'undefined' && parallelFilterManager !== null) {
    try {
      parallelFilterManager.terminateAll();
      console.log('[Cleanup] 普通Worker已终止');
    } catch (error) {
      console.error('[Cleanup] 终止普通Worker失败:', error);
    }
  }

  // 清理单Worker连接
  if (typeof filterWorker !== 'undefined' && filterWorker !== null) {
    try {
      filterWorker.terminate();
      filterWorker = null;
      console.log('[Cleanup] 单Worker已终止');
    } catch (error) {
      console.error('[Cleanup] 终止单Worker失败:', error);
    }
  }

  console.log('[Cleanup] 资源清理完成');
}

/**
 * 🚀 页面隐藏时的清理逻辑（用户切换标签页或最小化窗口）
 */
function cleanupOnHide() {
  console.log('[Cleanup] 页面隐藏');

  // 取消正在进行的过滤任务
  if (typeof sharedFilterManager !== 'undefined' && sharedFilterManager !== null) {
    if (sharedFilterManager.isProcessing) {
      sharedFilterManager.cancel();
      console.log('[Cleanup] 取消SharedWorker过滤任务');
    }
  }

  if (typeof parallelFilterManager !== 'undefined' && parallelFilterManager !== null) {
    if (parallelFilterManager.isProcessing) {
      parallelFilterManager.cancel();
      console.log('[Cleanup] 取消ParallelWorker过滤任务');
    }
  }
}

/**
 * 🚀 页面显示时的恢复逻辑（用户切换回标签页或恢复窗口）
 */
function restoreOnShow() {
  console.log('[Cleanup] 页面显示');
  // 不需要特殊操作，保持连接即可
}

// ==================== 注册事件监听器 ====================

// 页面卸载时清理资源（最彻底）
window.addEventListener('beforeunload', function() {
  cleanupOnUnload();
});

// 页面隐藏时（可选，用于节省资源）
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    cleanupOnHide();
  } else {
    restoreOnShow();
  }
});

// 页面卸载时（备选方案）
window.addEventListener('unload', function() {
  cleanupOnUnload();
});

// Electron窗口关闭时（如果是Electron环境）
if (typeof window !== 'undefined' && window.process && window.process.type === 'renderer') {
  // Electron特有的事件
  window.addEventListener('close', function() {
    cleanupOnUnload();
  });
}

console.log('[Cleanup] 资源清理监听器已注册');

// ==================== 覆盖原始过滤函数 ====================

/**
 * 🚀 覆盖 original-script.js 中的 applyFilter 函数
 * 使用多线程或单线程 Worker 进行过滤，并实现增量显示
 * 🚀 延迟执行以确保在所有脚本加载完成后覆盖
 */
function overrideApplyFilterWithWorker() {
  // 🚀 调试：确认覆盖函数被调用
  console.log('[Filter] ========== 开始覆盖 applyFilter 函数 ==========');
  console.log('[Filter] typeof window.applyFilter:', typeof window.applyFilter);

  const originalApplyFilter = window.applyFilter;

  window.applyFilter = function() {
    const filterText = filterBox.value;

    console.log('=== applyFilterWithWorker called ===');

    // 🚀 调试：从 fileHeaders 获取文件信息
    let firstFilePath = null;
    try {
      if (typeof fileHeaders !== 'undefined' && fileHeaders && fileHeaders.length > 0) {
        firstFilePath = fileHeaders[0].filePath || fileHeaders[0].fileName;
        console.log('[Filter] 第一个文件信息:', {
          fileName: fileHeaders[0].fileName,
          filePath: fileHeaders[0].filePath,
          hasFilePath: !!fileHeaders[0].filePath,
          hasValidDiskPath: hasValidDiskPath(firstFilePath)
        });
      } else {
        console.log('[Filter] fileHeaders 不可用或为空');
      }
    } catch (e) {
      console.error('[Filter] 访问 fileHeaders 出错:', e);
    }

    // 🚀 优先使用 ripgrep 过滤（如果可用且有有效磁盘路径）
    if (typeof window.electronAPI !== 'undefined' &&
        window.electronAPI.callRG &&
        firstFilePath &&
        hasValidDiskPath(firstFilePath)) {
      console.log('[Filter] ✓ 使用 ripgrep 极速过滤');

      // 发送过滤关键词到服务器（保持与 Worker 一致）
      if (typeof sendFilterKeywordsToServer === 'function') {
        sendFilterKeywordsToServer(filterText);
      }

      // 添加到过滤历史
      if (typeof addToFilterHistory === 'function') {
        addToFilterHistory(filterText);
      }

      applyFilterWithRipgrepAsync(filterText, fileHeaders);
      return;
    } else {
      // 🚀 说明为什么不使用 ripgrep
      let reasons = [];
      if (typeof window.electronAPI === 'undefined' || !window.electronAPI.callRG) {
        reasons.push('ripgrep API 不可用');
      }
      if (!firstFilePath) {
        reasons.push('没有文件路径信息');
      }
      if (firstFilePath && !hasValidDiskPath(firstFilePath)) {
        reasons.push(`不是有效的磁盘路径: ${firstFilePath.substring(0, 50)}...`);
      }

      const reason = reasons.length > 0 ? reasons.join(', ') : '未知原因';
      console.log(`[Filter] 使用 Worker 过滤（原因: ${reason}）`);
    }

    sendFilterKeywordsToServer(filterText);

    if (filterText.trim() === "") {
      resetFilter();
      return;
    }

    addToFilterHistory(filterText);

    const keywords = parseFilterKeywords(filterText);
    currentFilter.filterKeywords = keywords;

    // 🚀 根据数据量选择单线程或多线程
    const totalLines = originalLines.length;

    // 多线程阈值：超过 1 万行就使用多线程
    // 🚀 降低阈值以充分利用16个Worker的性能
    if (totalLines > 10000) {
      console.log(`[Filter] 数据量较大 (${totalLines} 行)，使用多线程并行过滤`);
      applyFilterWithParallelWorkers(keywords);
    } else {
      console.log(`[Filter] 数据量较小 (${totalLines} 行)，使用单线程过滤`);
      applyFilterWithSingleWorker(keywords);
    }
  };

  console.log('[Filter] ✓ applyFilter 函数已覆盖为使用 Worker（支持 ripgrep 极速过滤）');
}

// 🚀 在多个时机执行覆盖，确保生效
// 1. 立即执行（如果 original-script.js 已经加载）
if (typeof window.applyFilter !== 'undefined') {
  overrideApplyFilterWithWorker();
} else {
  console.log('[Filter] window.applyFilter 尚未定义，等待加载...');
}

// 2. DOM 加载完成后执行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Filter] DOMContentLoaded - 执行覆盖');
    overrideApplyFilterWithWorker();
  });
} else {
  console.log('[Filter] DOM 已加载 - 立即执行覆盖');
  overrideApplyFilterWithWorker();
}

// 3. 页面完全加载后再次执行（确保覆盖所有可能的修改）
window.addEventListener('load', () => {
  console.log('[Filter] Window load - 再次执行覆盖');
  overrideApplyFilterWithWorker();
});

// 4. 延迟 500ms 后再次执行（最后保险）
setTimeout(() => {
  console.log('[Filter] 延迟 500ms - 最后执行覆盖');
  overrideApplyFilterWithWorker();
}, 500);
