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
    console.log('[Filter] ✓ 使用 ripgrep 极速过滤（将由 override 处理）');
    // 注意：此处通常已被 overrideApplyFilterWithWorker 覆盖
    // 如果还未被覆盖，降级到 Worker
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

  // 🚀 始终使用 16 Worker 并行过滤
  console.log(`[Filter] 使用多线程并行过滤 (${originalLines.length} 行)`);
  applyFilterWithParallelWorkers(keywords);
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
    console.log('[Filter] ✓ 使用 ripgrep 极速过滤（将由 override 处理）');
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

  // 🚀 始终使用 16 Worker 并行过滤
  console.log(`[Filter] 使用多线程并行过滤 (${originalLines.length} 行)`);
  applyFilterWithParallelWorkers(keywords);
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

// 🚀 rg 过滤搜索代数，用于防止并发搜索的结果混乱
let rgFilterGeneration = 0;

/**
 * 🚀 高性能 ripgrep 过滤：单进程搜所有文件，主进程解析，紧凑 IPC
 * @param {string} filterText - 过滤文本
 * @param {Array} headers - fileHeaders 数组，包含文件路径信息
 */
async function applyFilterWithRipgrepAsync(filterText, headers) {
  // 🔧 递增代数，使之前的搜索结果失效
  const myGeneration = ++rgFilterGeneration;
  console.log(`[Ripgrep Filter] 开始过滤: "${filterText}" (generation=${myGeneration})`);

  // 🔧 立即清除旧过滤结果，避免新旧结果混合显示
  filteredPanelAllLines = [];
  filteredPanelAllOriginalIndices = [];
  filteredPanelAllPrimaryIndices = [];
  currentFilter = {
    filteredLines: [],
    filteredToOriginalIndex: [],
    filterKeywords: [],
    totalLines: 0
  };
  // 🔧 关键：失效 HTML 缓存，否则虚拟滚动会渲染旧过滤的缓存内容
  if (typeof filteredLineCacheVersion !== 'undefined') filteredLineCacheVersion++;
  if (typeof filteredLineHtmlCache !== 'undefined') filteredLineHtmlCache.clear();
  const filteredPanelPlaceholder = document.getElementById('filteredPanelPlaceholder');
  if (filteredPanelPlaceholder) filteredPanelPlaceholder.style.height = '0px';
  const filteredPanelVirtualContent = document.getElementById('filteredPanelVirtualContent');
  if (filteredPanelVirtualContent) filteredPanelVirtualContent.innerHTML = '';
  // 重置虚拟滚动状态
  if (typeof filteredPanelVisibleStart !== 'undefined') filteredPanelVisibleStart = -1;
  if (typeof filteredPanelVisibleEnd !== 'undefined') filteredPanelVisibleEnd = -1;
  if (typeof window.needsFileHeaderRecompute !== 'undefined') window.needsFileHeaderRecompute = true;

  try {
    const rememberedOriginalIndex = getCurrentVisibleOriginalIndex();
    console.log(`[Ripgrep Filter] 📍 记忆位置: originalIndex=${rememberedOriginalIndex}`);

    const statusEl = document.getElementById('status');
    const filteredCountEl = document.getElementById('filteredCount');
    if (statusEl) statusEl.textContent = '⏳ ripgrep过滤中...';

    const startTime = performance.now();

    // 构建文件路径列表（从 fileHeaders 中提取有效路径）
    const files = [];
    const validHeaders = [];

    for (const header of headers) {
      const filePath = header.filePath || header.fileName;
      if (filePath && hasValidDiskPath(filePath)) {
        files.push(filePath);
        validHeaders.push(header);
      }
    }

    if (files.length === 0) {
      throw new Error('没有找到有效的磁盘文件路径（所有文件都来自压缩包或路径无效）');
    }

    console.log(`[Ripgrep Filter] 搜索 ${files.length} 个文件`);

    // 构建正则模式：转义特殊字符后用 | 连接
    const keywords = parseFilterKeywords(filterText);
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rgPattern = keywords.map(k => escapeRegex(k)).join('|');

    console.log(`[Ripgrep Filter] 搜索模式: "${rgPattern}"`);

    // 🚀 智能选择 includeContent：
    // - 加载模式（originalLines 有数据）：只返回行号，内容从内存取，避免 IPC 传 ~100MB
    // - 过滤模式（originalLines 无数据）：必须返回行内容，否则无法显示
    const hasOriginalLines = typeof originalLines !== 'undefined' && originalLines && originalLines.length > 0;
    const includeContent = !hasOriginalLines;
    console.log(`[Ripgrep Filter] includeContent=${includeContent}（${hasOriginalLines ? '加载模式，内容从内存取' : '过滤模式，需要 rg 返回内容'}）`);

    let result;
    if (typeof window.electronAPI.callRGBatch === 'function') {
      result = await window.electronAPI.callRGBatch({
        execPath: './rg.exe',
        pattern: rgPattern,
        files: files,
        includeContent: includeContent,
        caseInsensitive: true
      });
    } else {
      // 降级到旧 API（兼容旧版 preload）
      result = await callRGBatchFallback(rgPattern, files);
    }

    if (!result.success) {
      throw new Error(result.error || 'ripgrep 执行失败');
    }

    // 🔧 检查代数：如果期间有新的搜索启动，丢弃本次结果
    if (myGeneration !== rgFilterGeneration) {
      console.log(`[Ripgrep Filter] ⚠️ 搜索已过期 (my=${myGeneration}, current=${rgFilterGeneration})，丢弃结果`);
      return;
    }

    // 🚀 解析返回的紧凑格式：{ files: [{path, offset, count}], lineNums: Int32Array, lineContents: string[] }
    // 或者旧格式的 { results: { path: [lineNums] } }
    let rgResults; // Map<path, { lineNums: Int32Array, lineContents: string[] }>
    let matchedFileCount;
    let totalMatchCount;

    if (result.files && result.lineNums) {
      const flatNums = result.lineNums;
      const flatContents = result.lineContents || [];
      rgResults = new Map();
      matchedFileCount = result.files.length;
      totalMatchCount = flatNums.length;
      for (const entry of result.files) {
        rgResults.set(entry.path, {
          lineNums: flatNums.subarray(entry.offset, entry.offset + entry.count),
          lineContents: flatContents.slice(entry.offset, entry.offset + entry.count)
        });
      }
    } else if (result.results) {
      // 旧格式降级：只有行号，没有行内容
      rgResults = new Map();
      for (const [path, lineNums] of Object.entries(result.results)) {
        rgResults.set(path, { lineNums, lineContents: null });
      }
      matchedFileCount = rgResults.size;
      totalMatchCount = 0;
      for (const data of rgResults.values()) {
        totalMatchCount += data.lineNums.length;
      }
    } else {
      matchedFileCount = 0;
      totalMatchCount = 0;
      rgResults = new Map();
    }

    console.log(`[Ripgrep Filter] ✓ 搜索完成: ${totalMatchCount} 个匹配，${matchedFileCount} 个文件`);

    if (totalMatchCount === 0) {
      console.warn('[Ripgrep Filter] 没有找到任何匹配');
    }

    // 显示过滤面板
    if (statusEl) statusEl.textContent = '⏳ 处理结果...';
    if (filteredCountEl) filteredCountEl.textContent = "";
    filteredPanel.classList.add("visible");

    // 自动隐藏文件树面板
    const fileTreeContainer = document.getElementById('fileTreeContainer');
    const fileTreeCollapseBtn = document.getElementById('fileTreeCollapseBtn');
    if (fileTreeContainer && fileTreeCollapseBtn && !fileTreeContainer.classList.contains('collapsed')) {
      fileTreeContainer.classList.add('collapsed');
      fileTreeCollapseBtn.textContent = '📂';
    }

    // 🚀 构建过滤结果：行号 → originalLines 索引查找内容（避免 IPC 传输 ~100MB 字符串）
    const filteredToOriginalIndex = [];
    const filteredLines = [];

    for (const header of validHeaders) {
      const filePath = header.filePath || header.fileName;
      const matchData = rgResults.get(filePath);
      if (!matchData) continue;

      const lineNums = matchData.lineNums || matchData;
      const matchCount = lineNums.length;
      if (matchCount === 0) continue;

      // 插入文件头
      const fileHeaderLine = `=== 文件: 📁 ${header.fileName} (${matchCount} 个匹配) ===`;
      filteredLines.push(fileHeaderLine);
      filteredToOriginalIndex.push(-1);

      // 添加该文件的所有匹配行
      for (let j = 0; j < matchCount; j++) {
        const lineNum = lineNums[j];
        const originalIndex = header.startIndex + lineNum;
        const hasOriginalLine = originalLines && originalIndex >= 0 && originalIndex < originalLines.length;

        filteredToOriginalIndex.push(hasOriginalLine ? originalIndex : -1);
        // 🚀 优先从内存取内容（加载模式），否则从 rg 返回的 lineContents 取（过滤模式）
        if (hasOriginalLine) {
          filteredLines.push(originalLines[originalIndex]);
        } else if (matchData.lineContents && matchData.lineContents[j] !== undefined) {
          filteredLines.push(matchData.lineContents[j]);
        } else {
          filteredLines.push(`[Line ${lineNum + 1}]`);
        }
      }
    }

    console.log(`[Ripgrep Filter] 结果整理完成: ${filteredLines.length} 行`);

    // 更新过滤状态
    currentFilter = {
      filteredLines: filteredLines,
      filteredToOriginalIndex: filteredToOriginalIndex,
      filterKeywords: filterText.split('|').map(k => k.trim()).filter(k => k),
      totalLines: filteredLines.length
    };

    // 更新过滤面板
    filteredPanelAllLines = filteredLines;
    filteredPanelAllOriginalIndices = filteredToOriginalIndex;
    filteredPanelAllPrimaryIndices = [];

    // 计算实际匹配数（不包括文件头）
    // 使用 rg 返回的总匹配数，避免过滤模式下所有 originalIndex=-1 导致计数为 0
    const actualMatchCount = totalMatchCount;

    if (filteredCountEl) filteredCountEl.textContent = "";

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    const elapsedMs = (parseFloat(elapsed) * 1000).toFixed(0);

    if (statusEl) {
      statusEl.textContent = `✓ ripgrep: ${actualMatchCount}个匹配 (${matchedFileCount}个文件, ${elapsed}秒)`;
    }

    const filteredTimeElement = document.getElementById('filteredTime');
    if (filteredTimeElement) {
      filteredTimeElement.textContent = `(耗时 ${elapsedMs}ms)`;
      filteredTimeElement.style.display = 'inline';
    }

    // 更新占位符高度
    const filteredPanelPlaceholder = document.getElementById('filteredPanelPlaceholder');
    if (filteredPanelPlaceholder) {
      const lineHeight = typeof filteredPanelLineHeight !== 'undefined' ? filteredPanelLineHeight : 24;
      filteredPanelPlaceholder.style.height = (filteredLines.length * lineHeight) + 'px';
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
    // 避免 clientHeight=0 导致内容不显示
    requestAnimationFrame(() => {
      if (typeof updateFilteredPanelVisibleLines === 'function') {
        updateFilteredPanelVisibleLines();
      }
    });

    showMessage(`ripgrep过滤完成: ${actualMatchCount}个匹配 (耗时${elapsed}秒)`);
    console.log(`[Ripgrep Filter] ✓ 完成: ${actualMatchCount} 个匹配，耗时 ${elapsed}秒`);

    // 🔧 重置过滤标志，重新启用 HTML 缓存
    if (typeof isFiltering !== 'undefined') isFiltering = false;

  } catch (error) {
    console.error('[Ripgrep Filter] 过滤失败:', error);
    showMessage(`ripgrep过滤失败: ${error.message}`);
  }
}

/**
 * 🚀 降级方案：当 callRGBatch 不可用时，用旧 callRG API 分批搜索
 * 但仍然在主进程解析（通过 callRG 逐文件搜索）
 */
async function callRGBatchFallback(rgPattern, files) {
  const MAX_CONCURRENT = 8;
  const allResults = {};

  for (let batch = 0; batch < Math.ceil(files.length / MAX_CONCURRENT); batch++) {
    const startIdx = batch * MAX_CONCURRENT;
    const endIdx = Math.min(startIdx + MAX_CONCURRENT, files.length);
    const batchFiles = files.slice(startIdx, endIdx);

    const batchPromises = batchFiles.map(async (filePath) => {
      const args = [rgPattern, '-i', '--line-number', '--no-filename', '--color', 'never', '-a', '--', filePath];
      try {
        const res = await window.electronAPI.callRG({ execPath: './rg.exe', args });
        if (!res.success) return;

        const fileName = filePath.split(/[/\\]/).pop();
        const lineNums = [];
        const lines = res.stdout.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]) continue;
          const colonIdx = lines[i].indexOf(':');
          if (colonIdx === -1) continue;
          const lineNum = parseInt(lines[i].substring(0, colonIdx), 10);
          if (!isNaN(lineNum)) lineNums.push(lineNum);
        }
        if (lineNums.length > 0) allResults[filePath] = lineNums;
      } catch (e) {
        // 跳过失败的文件
      }
    });

    await Promise.all(batchPromises);
  }

  return { success: true, results: allResults };
}

/**
 * 🚀 新增：使用多线程并行过滤
 * 🚀 优化：优先使用SharedWorker，多窗口共享Worker池
 * 🚀 组合方案：节流更新 + 延迟渲染
 */
function applyFilterWithParallelWorkers(keywords) {
  // 🔧 记录开始时间
  const filterStartTime = performance.now();

  // 🚀 代数计数器：防止并发过滤导致结果混合
  const myGeneration = ++rgFilterGeneration;
  console.log(`[ParallelFilter] 开始过滤 (generation=${myGeneration})`);

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
  filteredPanelVisibleStart = -1;
  filteredPanelVisibleEnd = -1;
  filteredPanelPlaceholder.style.height = "0px";
  filteredPanelVirtualContent.innerHTML = "";
  filteredPanelContent.scrollTop = 0;
  filteredPanelScrollPosition = 0;
  // 🔧 关键：失效 HTML 缓存，防止虚拟滚动渲染旧内容
  if (typeof filteredLineCacheVersion !== 'undefined') filteredLineCacheVersion++;
  if (typeof filteredLineHtmlCache !== 'undefined') filteredLineHtmlCache.clear();

  // 🚀 新增：累积所有已完成块的结果
  let cumulativeResults = [];  // 累积的所有匹配索引
  let completedChunks = 0;     // 已完成的块数量

  // 延迟启动，确保 UI 更新
  setTimeout(() => {
    // 🔧 代数检查：如果期间有新的过滤启动，不再继续
    if (myGeneration !== rgFilterGeneration) {
      console.log(`[ParallelFilter] ⚠️ 过滤已过期 (my=${myGeneration}, current=${rgFilterGeneration})，跳过`);
      return;
    }
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
      // 🔧 代数检查
      if (myGeneration !== rgFilterGeneration) return;

      // 🚀 方案1：节流更新 - 只累积数据，不更新DOM
      console.log(`[ParallelFilter] 块 ${chunkIndex} 完成，新增 ${results.length} 条结果`);

      const chunkStartTime = performance.now();

      // 累积结果索引（用 push 避免创建新数组）
      for (let i = 0; i < results.length; i++) {
        cumulativeResults.push(results[i]);
      }
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

      // 🚀 追加到全局数组（用 push 避免 O(n) concat）
      for (let i = 0; i < newFilteredLines.length; i++) {
        filteredPanelAllLines.push(newFilteredLines[i]);
      }
      // filteredPanelAllOriginalIndices 可能是 Int32Array 或普通数组，兼容处理
      if (filteredPanelAllOriginalIndices instanceof Int32Array) {
        const newArr = new Int32Array(filteredPanelAllOriginalIndices.length + newFilteredToOriginalIndex.length);
        newArr.set(filteredPanelAllOriginalIndices);
        newArr.set(newFilteredToOriginalIndex, filteredPanelAllOriginalIndices.length);
        filteredPanelAllOriginalIndices = newArr;
      } else {
        for (let i = 0; i < newFilteredToOriginalIndex.length; i++) {
          filteredPanelAllOriginalIndices.push(newFilteredToOriginalIndex[i]);
        }
      }
      filteredPanelAllPrimaryIndices = [];

      // 🚀 关键：不显示行数和百分比
      filteredCount.textContent = "";  // 隐藏行数和百分比

      const chunkTime = performance.now() - chunkStartTime;
      console.log(`[ParallelFilter] 📊 块 ${chunkIndex} 数据收集完成: +${results.length} 条，总计 ${filteredPanelAllLines.length} 条（耗时${chunkTime.toFixed(0)}ms）`);
    });

    manager.setCompleteCallback((results, stats) => {
      // 🔧 代数检查
      if (myGeneration !== rgFilterGeneration) {
        console.log(`[ParallelFilter] ⚠️ 过滤已过期 (my=${myGeneration}, current=${rgFilterGeneration})，丢弃结果`);
        return;
      }

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
      let sortedFilteredLines = [];
      let sortedFilteredToOriginalIndex = [];

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
      // 同时按文件分组，插入文件头标记（与 ripgrep 路径一致）
      console.log(`[ParallelFilter] 开始复制 ${uniqueResults.length} 条结果...`);

      // 🚀 预计算文件头分组信息
      // fileHeaders 每项有 startIndex 和 fileName，按 startIndex 排序
      let sortedHeaders = [];
      try {
        if (typeof fileHeaders !== 'undefined' && fileHeaders && fileHeaders.length > 0) {
          sortedHeaders = fileHeaders
            .map(h => ({
              fileName: h.fileName || h.displayName || '未知文件',
              startIndex: typeof h.startIndex === 'number' ? h.startIndex : (h.index || 0),
              endIndex: typeof h.startIndex === 'number'
                ? h.startIndex + (h.lineCount || h.count || 0)
                : (h.index || 0) + (h.lineCount || h.count || 0)
            }))
            .sort((a, b) => a.startIndex - b.startIndex);
        }
      } catch (e) {
        console.warn('[ParallelFilter] fileHeaders 不可用，跳过文件头标记');
      }

      // 🚀 先按文件分组统计每个文件的匹配数，然后构建带文件头的最终数组
      let finalLines = [];
      let finalIndices = [];

      if (sortedHeaders.length > 0 && uniqueResults.length > 0) {
        // 按文件分组：遍历 uniqueResults，检测文件边界
        let currentHeaderIdx = 0;
        // 🚀 二分查找：sortedHeaders 按 startIndex 升序排列，找到 origIndex 所属的文件
        function findHeaderIndex(origIndex) {
          let lo = 0, hi = sortedHeaders.length - 1, best = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (sortedHeaders[mid].startIndex <= origIndex) {
              best = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          return best;
        }

        // 先统计每个文件的匹配数
        const headerMatchCounts = new Map(); // headerIdx -> count
        for (const origIndex of uniqueResults) {
          const hIdx = findHeaderIndex(origIndex);
          if (hIdx >= 0) {
            headerMatchCounts.set(hIdx, (headerMatchCounts.get(hIdx) || 0) + 1);
          }
        }

        // 构建带文件头的最终数组
        let lastHeaderIdx = -1;
        for (const origIndex of uniqueResults) {
          const hIdx = findHeaderIndex(origIndex);
          if (hIdx >= 0 && hIdx !== lastHeaderIdx) {
            // 新文件开始，插入文件头
            const header = sortedHeaders[hIdx];
            const matchCount = headerMatchCounts.get(hIdx) || 0;
            finalLines.push(`=== 文件: 📁 ${header.fileName} (${matchCount} 个匹配) ===`);
            finalIndices.push(-1);
            lastHeaderIdx = hIdx;
          }
          finalLines.push(originalLines[origIndex]);
          finalIndices.push(origIndex);
        }

        console.log(`[ParallelFilter] 已插入 ${headerMatchCounts.size} 个文件头标记，总行数: ${finalLines.length}`);
      } else {
        // 没有 fileHeaders 或只有单文件，直接复制
        for (const origIndex of uniqueResults) {
          finalLines.push(originalLines[origIndex]);
          finalIndices.push(origIndex);
        }
      }

      sortedFilteredLines = finalLines;
      sortedFilteredToOriginalIndex = new Int32Array(finalIndices);

      // 🚀 复制已完成（上面的同步循环），更新全局数组并继续渲染
      console.log(`[ParallelFilter] ✓ 结果复制完成，共 ${sortedFilteredLines.length} 条`);

      // 更新全局数组
      filteredPanelAllLines = sortedFilteredLines;
      filteredPanelAllOriginalIndices = sortedFilteredToOriginalIndex;
      // 🔧 标记需要重新计算文件头索引，使 "=== 文件:" 行显示浅绿色背景
      if (typeof window.needsFileHeaderRecompute !== 'undefined') window.needsFileHeaderRecompute = true;

      console.log(`[ParallelFilter] ✅ 结果已按原始索引排序，共 ${filteredPanelAllLines.length} 条`);

      // 🚀 延迟渲染 - 显示加载动画，分批渲染DOM
      startDelayedRendering(totalTime, stats, useSharedWorker, rememberedOriginalIndex);
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

      if (secondaryFilterStatus) {
        secondaryFilterStatus.textContent = "未应用";
        secondaryFilterStatus.className = "secondary-filter-status secondary-filter-inactive";
      }
      if (filteredPanelFilterStatus) filteredPanelFilterStatus.textContent = "";
      if (filteredPanelFilterBox) filteredPanelFilterBox.value = "";
      if (typeof updateRegexStatus === 'function') updateRegexStatus();

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
        const { type, sessionId, results, progress, stats, partialResults, isIncremental, error } = e.data;

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
            applyPartialWorkerResults(partialResults, progress, isIncremental);
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
function applyPartialWorkerResults(partialResults, progress, isIncremental) {
  if (!partialResults || !Array.isArray(partialResults) || partialResults.length === 0) {
    return;
  }

  const partialFilteredLines = [];
  const partialFilteredToOriginalIndex = [];

  for (const item of partialResults) {
    partialFilteredLines.push(originalLines[item.index]);
    partialFilteredToOriginalIndex.push(item.index);
  }

  if (isIncremental && filteredPanelAllLines && filteredPanelAllLines.length > 0) {
    // 增量模式：追加新结果到已有结果中
    filteredPanelAllLines = filteredPanelAllLines.concat(partialFilteredLines);
    filteredPanelAllOriginalIndices = filteredPanelAllOriginalIndices.concat(partialFilteredToOriginalIndex);
  } else {
    // 全量模式（兼容旧逻辑）：直接替换
    filteredPanelAllLines = partialFilteredLines;
    filteredPanelAllOriginalIndices = partialFilteredToOriginalIndex;
  }

  // 更新当前过滤状态
  currentFilter = {
    filteredLines: filteredPanelAllLines,
    filteredToOriginalIndex: filteredPanelAllOriginalIndices,
    filterKeywords: currentFilter.filterKeywords,
    totalLines: filteredPanelAllLines.length,
  };

  // 更新过滤面板显示
  filteredPanel.classList.add("visible");
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
    // 🔧 修复：重置虚拟滚动状态为 -1，确保 updateFilteredPanelVisibleLines 不命中早期退出
    filteredPanelVisibleStart = -1;
    filteredPanelVisibleEnd = -1;

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

    // 🚀 检查是否有 ripgrep API
    const hasRG = typeof window.electronAPI !== 'undefined' &&
                  window.electronAPI.callRG;

    // 🚀 统一确定过滤使用的 headers：
    // - 加载模式：使用 fileHeaders（有 startIndex 映射到 originalLines）
    // - 过滤模式：fileHeaders 为空，从 filterModeFileList 构造虚拟 headers
    let rgHeaders = null;

    try {
      if (typeof fileHeaders !== 'undefined' && fileHeaders && fileHeaders.length > 0) {
        const firstFilePath = fileHeaders[0].filePath || fileHeaders[0].fileName;
        if (firstFilePath && hasValidDiskPath(firstFilePath)) {
          rgHeaders = fileHeaders;
          console.log('[Filter] 加载模式，使用 fileHeaders:', fileHeaders.length, '个文件');
        }
      }
    } catch (e) {
      // fileHeaders 不可访问
    }

    // fileHeaders 无有效路径时，尝试过滤模式
    if (!rgHeaders) {
      try {
        if (typeof filterModeFileList !== 'undefined' && filterModeFileList && filterModeFileList.length > 0) {
          const filterModePaths = filterModeFileList.filter(p => hasValidDiskPath(p));
          if (filterModePaths.length > 0) {
            rgHeaders = filterModePaths.map(p => ({
              fileName: p.split(/[/\\]/).pop(),
              filePath: p,
              startIndex: 0,
              lineCount: 0
            }));
            console.log(`[Filter] 过滤模式，使用虚拟 headers: ${filterModePaths.length} 个文件`);
          }
        }
      } catch (e) {
        // filterModeFileList 不可访问
      }
    }

    // 🚀 智能路由：数据已在内存时用 Worker（~100ms），否则才用 ripgrep（读磁盘）
    const dataInMemory = typeof originalLines !== 'undefined' && originalLines && originalLines.length > 0;

    if (hasRG && rgHeaders && rgHeaders.length > 0 && !dataInMemory) {
      // 数据不在内存，需要 ripgrep 从磁盘读取
      console.log(`[Filter] ✓ 数据不在内存，使用 ripgrep 过滤（${rgHeaders.length} 个文件）`);

      if (typeof sendFilterKeywordsToServer === 'function') {
        sendFilterKeywordsToServer(filterText);
      }
      if (typeof addToFilterHistory === 'function') {
        addToFilterHistory(filterText);
      }

      applyFilterWithRipgrepAsync(filterText, rgHeaders);
      return;
    }

    // 🚀 Worker 路径：数据已在内存（快速路径）或 ripgrep 不可用
    let reason;
    if (dataInMemory) {
      reason = `数据已在内存（${originalLines.length} 行），Worker 缓存过滤`;
    } else {
      let reasons = [];
      if (!hasRG) reasons.push('ripgrep API 不可用');
      if (!rgHeaders) reasons.push('没有有效的文件路径信息');
      if (rgHeaders && rgHeaders.length === 0) reasons.push('文件路径列表为空');
      reason = reasons.length > 0 ? reasons.join(', ') : '未知原因';
    }
    console.log(`[Filter] 使用 Worker 过滤（${reason}）`);

    sendFilterKeywordsToServer(filterText);

    if (filterText.trim() === "") {
      resetFilter();
      return;
    }

    addToFilterHistory(filterText);

    const keywords = parseFilterKeywords(filterText);
    currentFilter.filterKeywords = keywords;

    // 🚀 并行 Worker 过滤
    console.log(`[Filter] 使用多线程并行过滤 (${originalLines.length} 行)`);
    applyFilterWithParallelWorkers(keywords);
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
