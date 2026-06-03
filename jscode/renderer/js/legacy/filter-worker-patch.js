/**
 * Web Worker 过滤优化 - 简化集成代码
 * 将此代码插入到 renderer/js/original-script.js 中
 * 位置：在原有的 applyFilter 函数之前
 */

// ==================== 全局变量 ====================
// 🚀 标志：指示文件头索引需要重新计算（用于 ripgrep 过滤后）
window.needsFileHeaderRecompute = false;

// 分片模式状态（统一为分片模式，不再有内存模式）
window._filteredChunkActive = false;    // 过滤面板分片是否激活

// 单关键词过滤结果存储
window._perKeywordFilterResults = {};       // { key → { tempPath, indexFile, totalLines, indices, matchCount } }
window._perKeywordFilterActiveKeyword = '_combined';
window._perKeywordFilterOrder = [];
window._perKeywordFilteringInProgress = false;
window._perKeywordFilterGeneration = 0;

// 🚀 性能：生产环境关闭过滤路径 debug 日志
const _FILTER_DEBUG = false;
const _flog = _FILTER_DEBUG ? console.log.bind(console, '[Filter]') : () => {};

// ==================== 延迟加载 originalIndices ====================
// 当 filterChunkStream 返回 {indexFile, total} 时，indices 存在主进程 .idx 文件中
// 首次访问时通过 IPC 加载到内存，之后缓存为 Int32Array
var _filterIndexFile = null;   // .idx 文件路径
var _filterIndexLoaded = null; // 加载后的 Int32Array，或 null

function _isFilterIndexLazy() {
  return _filterIndexFile !== null && _filterIndexLoaded === null;
}

function _ensureFilterIndicesSync() {
  // 同步检查：如果已加载或不需要加载，直接返回
  if (_filterIndexLoaded !== null || _filterIndexFile === null) return;
  // 需要异步加载，但调用方是同步的 → 触发异步加载，本次返回空
  _loadFilterIndices();
}

function _loadFilterIndices() {
  if (_filterIndexLoaded !== null || !_filterIndexFile) return;
  var idxFile = _filterIndexFile;
  window.electronAPI.readFilterIndices({ indexFile: idxFile }).then(function(res) {
    if (res && res.success && res.indices) {
      _filterIndexLoaded = res.indices;
      // 将加载的数据复制到占位数组（filteredPanelAllOriginalIndices 和 currentFilter.filteredToOriginalIndex 是同一引用）
      if (typeof filteredPanelAllOriginalIndices !== 'undefined' &&
          filteredPanelAllOriginalIndices.length === res.indices.length) {
        filteredPanelAllOriginalIndices.set(res.indices);
      } else {
        // 长度不匹配，替换引用
        filteredPanelAllOriginalIndices = res.indices;
        if (typeof currentFilter !== 'undefined' && currentFilter) {
          currentFilter.filteredToOriginalIndex = res.indices;
        }
      }
    }
  }).catch(function(err) {
    console.error('[Filter] 加载 .idx 失败:', err);
  });
}

// 获取单个 originalIndex（同步，用于快速路径）
// 如果 indices 尚未加载，返回 -1 并触发异步加载
function _getFilterOriginalIndex(lineIndex) {
  if (_filterIndexLoaded !== null) {
    return (lineIndex >= 0 && lineIndex < _filterIndexLoaded.length) ? _filterIndexLoaded[lineIndex] : -1;
  }
  if (_filterIndexFile) {
    _loadFilterIndices(); // 触发异步加载
  }
  return -1;
}

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

// ==================== 单关键词过滤相关函数 ====================

function _showKeywordDropdown() {
  var container = document.getElementById('filteredPanelKeywordContainer');
  if (container) container.style.display = 'inline-flex';
}

function _hideKeywordDropdown() {
  var container = document.getElementById('filteredPanelKeywordContainer');
  if (container) container.style.display = 'none';
}

function _showKeywordProgress(text) {
  // 进度统一由灵动岛显示
}

function _updateKeywordDropdownLabel(keyword) {
  var labelEl = document.getElementById('filteredPanelKeywordLabel');
  if (!labelEl) return;
  var result = window._perKeywordFilterResults[keyword];
  if (keyword === '_combined') {
    labelEl.textContent = '[组合] (' + (result ? result.matchCount : '?') + ')';
  } else {
    labelEl.textContent = keyword + ' (' + (result ? result.matchCount : '...') + ')';
  }
}

function _populateKeywordDropdown() {
  var menu = document.getElementById('filteredPanelKeywordMenu');
  if (!menu) return;
  menu.innerHTML = '';
  var order = window._perKeywordFilterOrder;
  var results = window._perKeywordFilterResults;
  var activeKw = window._perKeywordFilterActiveKeyword;

  for (var i = 0; i < order.length; i++) {
    var kw = order[i];
    var res = results[kw];
    if (!res) continue;
    var item = document.createElement('div');
    item.className = 'filtered-panel-keyword-menu-item' + (kw === activeKw ? ' active' : '');
    item.dataset.keyword = kw;

    var nameSpan = document.createElement('span');
    nameSpan.className = 'keyword-name';
    nameSpan.textContent = kw === '_combined' ? '[组合]' : kw;

    var countSpan = document.createElement('span');
    countSpan.className = 'keyword-count';
    countSpan.textContent = res.matchCount;

    item.appendChild(nameSpan);
    item.appendChild(countSpan);

    item.addEventListener('click', function(e) {
      e.stopPropagation();
      _switchFilterKeyword(this.dataset.keyword);
      _hideKeywordMenu();
    });

    menu.appendChild(item);
  }
}

function _toggleKeywordMenu() {
  var menu = document.getElementById('filteredPanelKeywordMenu');
  if (!menu) return;
  menu.classList.toggle('visible');
}

function _hideKeywordMenu() {
  var menu = document.getElementById('filteredPanelKeywordMenu');
  if (menu) menu.classList.remove('visible');
}

function _switchFilterKeyword(keyword) {
  var results = window._perKeywordFilterResults;
  var result = results[keyword];
  if (!result) return;
  if (keyword === window._perKeywordFilterActiveKeyword) return;

  window._perKeywordFilterActiveKeyword = keyword;

  // 更新 FilteredChunkCache 指向新关键词的临时文件
  var fcc = window.App && window.App.FilteredChunkCache;
  if (fcc) {
    fcc.setTempPath(result.tempPath);
    fcc.init(result.totalLines);
  }

  // 交换索引
  if (result.indices) {
    _filterIndexFile = result.indexFile;
    _filterIndexLoaded = result.indices;
    filteredPanelAllOriginalIndices = result.indices;
  } else {
    _filterIndexFile = result.indexFile;
    _filterIndexLoaded = null;
    filteredPanelAllOriginalIndices = new Int32Array(result.totalLines);
    _loadFilterIndices();
  }
  filteredPanelAllLines = [];
  window._filteredChunkActive = true;

  // 重置虚拟滚动
  if (typeof filteredPanelVisibleStart !== 'undefined') filteredPanelVisibleStart = -1;
  if (typeof filteredPanelVisibleEnd !== 'undefined') filteredPanelVisibleEnd = -1;
  var vc = document.getElementById('filteredPanelVirtualContent');
  if (vc) vc.innerHTML = '';
  if (typeof filteredPanelDomPool !== 'undefined' && filteredPanelDomPool) filteredPanelDomPool.releaseAll();

  // 更新占位高度
  var ph = document.getElementById('filteredPanelPlaceholder');
  if (ph) {
    var lh = (typeof filteredPanelLineHeight !== 'undefined') ? filteredPanelLineHeight : 24;
    ph.style.height = (result.totalLines * lh) + 'px';
  }

  // 更新 currentFilter
  currentFilter = {
    filteredLines: [],
    filteredToOriginalIndex: filteredPanelAllOriginalIndices,
    filterKeywords: keyword === '_combined'
      ? window._perKeywordFilterOrder.filter(function(k) { return k !== '_combined'; })
      : [keyword],
    totalLines: result.totalLines,
  };

  // 更新计数
  var filteredCountEl = document.getElementById('filteredCount');
  if (filteredCountEl) filteredCountEl.textContent = result.matchCount + ' 个匹配';

  // 重置二级过滤
  if (typeof secondaryFilter !== 'undefined') {
    secondaryFilter = {
      isActive: false,
      filterText: '',
      filterKeywords: [],
      filteredLines: [],
      filteredToOriginalIndex: [],
      filteredToPrimaryIndex: [],
    };
  }

  // 重置面板内搜索
  if (typeof filteredPanelSearchKeyword !== 'undefined') {
    filteredPanelSearchKeyword = '';
    filteredPanelSearchMatches = [];
    filteredPanelCurrentMatchIndex = -1;
    filteredPanelTotalMatchCount = 0;
    var searchBox = document.getElementById('filteredPanelSearchBox');
    if (searchBox) searchBox.value = '';
  }

  // 失效各类缓存
  if (typeof filteredLineCacheVersion !== 'undefined') filteredLineCacheVersion++;
  if (typeof filteredLineHtmlCache !== 'undefined') filteredLineHtmlCache.clear();
  if (typeof _fpHighlightedLines !== 'undefined') _fpHighlightedLines.clear();
  if (typeof window.needsFileHeaderRecompute !== 'undefined') window.needsFileHeaderRecompute = true;

  _updateKeywordDropdownLabel(keyword);
  _populateKeywordDropdown();

  requestAnimationFrame(function() {
    if (typeof updateFilteredPanelVisibleLines === 'function') updateFilteredPanelVisibleLines();
  });
}

async function _filterSingleKeyword(keyword, files, headers, generation) {
  var escapeRegex = function(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  var pattern = escapeRegex(keyword);

  try {
    var result = await window.electronAPI.filterChunkStream({
      pattern: pattern,
      files: files,
      caseInsensitive: true,
      headers: headers,
      skipCleanup: true,
      suppressProgress: true,
    });

    if (generation !== window._perKeywordFilterGeneration) return null;
    if (!result || !result.success) return null;

    return result;
  } catch (err) {
    console.error('[PerKeyword] 过滤关键词 "' + keyword + '" 失败:', err);
    return null;
  }
}

async function _startBackgroundKeywordFiltering(keywords, files, headers) {
  var generation = window._perKeywordFilterGeneration;
  var total = keywords.length;

  for (var i = 0; i < total; i++) {
    if (generation !== window._perKeywordFilterGeneration) return;

    var kw = keywords[i];

    var result = await _filterSingleKeyword(kw, files, headers, generation);
    if (!result || generation !== window._perKeywordFilterGeneration) continue;

    window._perKeywordFilterResults[kw] = {
      tempPath: result.tempPath,
      indexFile: result.indexFile,
      totalLines: result.totalLines,
      indices: result.indices || null,
      matchCount: result.matchCount || 0,
    };

    _populateKeywordDropdown();

    if (window._perKeywordFilterActiveKeyword === kw) {
      _switchFilterKeyword(kw);
    }
  }

  window._perKeywordFilteringInProgress = false;
  _populateKeywordDropdown();
  _updateKeywordDropdownLabel(window._perKeywordFilterActiveKeyword);
}

function _initPerKeywordFiltering(combinedResult, keywords) {
  window._perKeywordFilterResults._combined = {
    tempPath: combinedResult.tempPath,
    indexFile: combinedResult.indexFile,
    totalLines: combinedResult.totalLines,
    indices: combinedResult.indices || null,
    matchCount: combinedResult.matchCount,
  };
  window._perKeywordFilterOrder = ['_combined'].concat(keywords);
  window._perKeywordFilteringInProgress = true;

  _showKeywordDropdown();
  _updateKeywordDropdownLabel('_combined');
  _populateKeywordDropdown();
}

var _keywordDropdownEventsInited = false;
function _initKeywordDropdownEvents() {
  if (_keywordDropdownEventsInited) return;
  _keywordDropdownEventsInited = true;

  var btn = document.getElementById('filteredPanelKeywordBtn');
  var menu = document.getElementById('filteredPanelKeywordMenu');
  if (!btn || !menu) return;

  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    _toggleKeywordMenu();
  });

  btn.addEventListener('wheel', function(e) {
    e.preventDefault();
    e.stopPropagation();

    var order = window._perKeywordFilterOrder;
    var active = window._perKeywordFilterActiveKeyword;
    var currentIdx = order.indexOf(active);
    if (currentIdx === -1) return;

    var results = window._perKeywordFilterResults;
    var delta = e.deltaY > 0 ? 1 : -1;
    var targetIdx = currentIdx + delta;

    if (targetIdx < 0 || targetIdx >= order.length) return;

    var targetKw = order[targetIdx];
    if (!results[targetKw]) return;

    _switchFilterKeyword(targetKw);
    _hideKeywordMenu();
  }, { passive: false });

  document.addEventListener('click', function(e) {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      _hideKeywordMenu();
    }
  });
}

/**
 * 解析过滤关键词（只支持管道符 | 分隔，逗号作为普通字符，支持转义）
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
    } else if (char === '|') {
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
window.rgFilterGeneration = 0;

/**
 * 🚀 高性能 ripgrep 过滤：单进程搜所有文件，主进程解析，紧凑 IPC
 * @param {string} filterText - 过滤文本
 * @param {Array} headers - fileHeaders 数组，包含文件路径信息
 */
function _clearFilterDisplayState() {
  if (window.App && window.App.FilteredChunkCache) {
    window.App.FilteredChunkCache.invalidate();
  }
  window._filteredChunkActive = false;
  filteredPanelAllLines = [];
  filteredPanelAllOriginalIndices = [];
  filteredPanelAllPrimaryIndices = [];
  _filterIndexFile = null;
  _filterIndexLoaded = null;
  currentFilter = { filteredLines: [], filteredToOriginalIndex: [], filterKeywords: [], totalLines: 0 };
  if (typeof filteredLineCacheVersion !== 'undefined') filteredLineCacheVersion++;
  if (typeof filteredLineHtmlCache !== 'undefined') filteredLineHtmlCache.clear();
  if (typeof _fpHighlightedLines !== 'undefined') _fpHighlightedLines.clear();
  if (typeof filteredPanelDomPool !== 'undefined' && filteredPanelDomPool) filteredPanelDomPool.releaseAll();
  var ph = document.getElementById('filteredPanelPlaceholder');
  if (ph) ph.style.height = '0px';
  var vc = document.getElementById('filteredPanelVirtualContent');
  if (vc) vc.innerHTML = '';
  if (typeof filteredPanelVisibleStart !== 'undefined') filteredPanelVisibleStart = -1;
  if (typeof filteredPanelVisibleEnd !== 'undefined') filteredPanelVisibleEnd = -1;
  if (typeof window.needsFileHeaderRecompute !== 'undefined') window.needsFileHeaderRecompute = true;
}

async function applyFilterWithRipgrepAsync(filterText, headers) {
  const myGeneration = ++window.rgFilterGeneration;
  console.log(`[Ripgrep Filter] 开始过滤: "${filterText}" (generation=${myGeneration})`);

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
    if (typeof showMessage === 'function') showMessage('没有找到有效的磁盘文件路径');
    return;
  }

  const parsedKeywords = parseFilterKeywords(filterText);

  // 在清理状态前记住当前可见位置
  var rememberedOriginalIndex = getCurrentVisibleOriginalIndex();
  console.log(`[Ripgrep Filter] 📍 记忆位置: originalIndex=${rememberedOriginalIndex}`);

  // 每次都完整过滤，清理显示状态 + 单关键词缓存
  _clearFilterDisplayState();
  window._perKeywordFilterResults = {};
  window._perKeywordFilterActiveKeyword = '_combined';
  window._perKeywordFilterOrder = ['_combined'].concat(parsedKeywords);
  window._perKeywordFilteringInProgress = false;
  window._perKeywordFilterGeneration++;
  _hideKeywordDropdown();
  _showKeywordProgress('');

  try {

    const statusEl = document.getElementById('status');
    const filteredCountEl = document.getElementById('filteredCount');

    const startTime = performance.now();
    if (statusEl) statusEl.textContent = '⏳ ripgrep搜索中... 0s';

    const rgTimer = setInterval(function () {
      var elapsed = ((performance.now() - startTime) / 1000).toFixed(0);
      if (statusEl) statusEl.textContent = '⏳ ripgrep搜索中... ' + elapsed + 's';
    }, 1000);

    console.log(`[Ripgrep Filter] 搜索 ${files.length} 个文件`);

    var escapeRegex = function(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var rgPattern = parsedKeywords.map(function(k) { return escapeRegex(k); }).join('|');

    console.log(`[Ripgrep Filter] 搜索模式: "${rgPattern}"`);

    let result;

    // ===== filterChunkStream（主进程直写，零内容经过渲染进程）=====
    if (typeof window.electronAPI.filterChunkStream === 'function') {
      try {
        clearInterval(rgTimer);
        window._filterStartTime = startTime;

        var streamResult = await window.electronAPI.filterChunkStream({
          pattern: rgPattern,
          files: files,
          caseInsensitive: true,
          headers: validHeaders.map(function(h) {
            return {
              filePath: h.filePath || h.fileName,
              fileName: h.fileName || h.displayName,
              startIndex: h.startIndex,
              lineCount: h.lineCount,
            };
          }),
        });



        if (myGeneration !== window.rgFilterGeneration) return;

        if (!streamResult || !streamResult.success) {
          throw new Error(streamResult ? streamResult.error : '流式过滤失败');
        }

        if (streamResult.matchCount === 0) {
          filteredPanel.classList.add("visible");
          if (filteredCountEl) filteredCountEl.textContent = "0 个匹配";
          if (statusEl) statusEl.textContent = '✓ ripgrep: 0个匹配';
          if (window._hideFilterProgress) window._hideFilterProgress();
          return;
        }

        // 直接初始化分片缓存
        var fcc = window.App && window.App.FilteredChunkCache;
        if (fcc) { fcc.setTempPath(streamResult.tempPath); fcc.init(streamResult.totalLines); }

        // 优先使用主进程直接传递的索引（跳过磁盘 I/O 往返）
        if (streamResult.indices && streamResult.indices.length > 0) {
          _filterIndexFile = streamResult.indexFile; // 保留路径供范围查询
          _filterIndexLoaded = streamResult.indices;
          filteredPanelAllOriginalIndices = streamResult.indices;
        } else {
          // 回退：索引仅存在于 .idx 文件，延迟加载
          _filterIndexFile = streamResult.indexFile;
          _filterIndexLoaded = null;
          filteredPanelAllOriginalIndices = new Int32Array(streamResult.totalLines); // 占位，全 0
          _loadFilterIndices();
        }
        filteredPanelAllLines = [];
        window._filteredChunkActive = true;

        // 设置占位高度 + 重置虚拟滚动
        var ph = document.getElementById('filteredPanelPlaceholder');
        if (ph) {
          var lh = (typeof filteredPanelLineHeight !== 'undefined') ? filteredPanelLineHeight : 24;
          ph.style.height = (streamResult.totalLines * lh) + 'px';
        }
        if (typeof filteredPanelVisibleStart !== 'undefined') filteredPanelVisibleStart = -1;
        if (typeof filteredPanelVisibleEnd !== 'undefined') filteredPanelVisibleEnd = -1;
        var vc = document.getElementById('filteredPanelVirtualContent');
        if (vc) vc.innerHTML = '';

        currentFilter = {
          filteredLines: [],
          filteredToOriginalIndex: filteredPanelAllOriginalIndices, // 同一引用，_loadFilterIndices 会更新
          filterKeywords: filterText.split('|').map(function(k){return k.trim();}).filter(function(k){return k;}),
          totalLines: streamResult.totalLines,
        };

        // 自动折叠文件树面板（复用已有逻辑）
        var ftc2 = document.getElementById('fileTreeContainer');
        if (ftc2 && ftc2.classList.contains('visible')) {
          if (typeof toggleFileTree === 'function') toggleFileTree();
          window._fileTreeHiddenByFilter = true;
        }

        filteredPanel.classList.add("visible");
        if (filteredCountEl) filteredCountEl.textContent = streamResult.matchCount + ' 个匹配';
        if (typeof window.needsFileHeaderRecompute !== 'undefined') window.needsFileHeaderRecompute = true;

        var streamElapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        var fileSizeMB = streamResult.fileSize ? (streamResult.fileSize / 1024 / 1024).toFixed(1) : '?';
        if (statusEl) statusEl.textContent = '✓ 分片过滤: ' + streamResult.matchCount + '个匹配 ' + fileSizeMB + 'MB (' + streamElapsed + 's)';

        var ftEl = document.getElementById('filteredTime');
        if (ftEl) {
          ftEl.textContent = '(耗时 ' + (parseFloat(streamElapsed) * 1000).toFixed(0) + 'ms)';
          ftEl.style.display = 'inline';
        }

        requestAnimationFrame(function() {
          if (typeof updateFilteredPanelVisibleLines === 'function') updateFilteredPanelVisibleLines();
        });

        // 🚀 智能跳转：在过滤结果中二分查找之前的位置
        if (rememberedOriginalIndex >= 0 && filteredPanelAllOriginalIndices && filteredPanelAllOriginalIndices.length > 0) {
          var indices = filteredPanelAllOriginalIndices;
          var targetIdx = -1;
          var lo = 0, hi = indices.length - 1;
          while (lo <= hi) {
            var mid = (lo + hi) >>> 1;
            var mv = indices[mid];
            if (mv < 0) { lo = mid + 1; continue; }
            if (mv === rememberedOriginalIndex) { targetIdx = mid; break; }
            if (mv < rememberedOriginalIndex) lo = mid + 1;
            else hi = mid - 1;
          }
          if (targetIdx < 0) targetIdx = lo < indices.length ? lo : indices.length - 1;

          if (targetIdx >= 0 && typeof lastClickedFilteredIndex !== 'undefined') {
            lastClickedFilteredIndex = targetIdx;
            var lh = (typeof filteredPanelLineHeight !== 'undefined') ? filteredPanelLineHeight : 19;
            var scrollTarget = targetIdx;
            requestAnimationFrame(function() {
              var fpc = document.getElementById('filteredPanelContent');
              if (fpc) fpc.scrollTop = Math.max(0, scrollTarget * lh - fpc.clientHeight / 2);
            });
          }
        }

        console.log('[Ripgrep Filter] ✓ filterChunkStream 完成: ' + streamResult.matchCount + '个匹配');

        // ===== 启动单关键词后台串行过滤 =====
        if (parsedKeywords.length > 1) {
          _initPerKeywordFiltering(streamResult, parsedKeywords);
          var bgFiles = files;
          var bgHeaders = validHeaders.map(function(h) {
            return {
              filePath: h.filePath || h.fileName,
              fileName: h.fileName || h.displayName,
              startIndex: h.startIndex,
              lineCount: h.lineCount,
            };
          });
          Promise.resolve().then(function() {
            _startBackgroundKeywordFiltering(parsedKeywords, bgFiles, bgHeaders);
          });
        }

        if (window._hideFilterProgress) window._hideFilterProgress();
        return;
      } catch (streamErr) {
        throw streamErr;
      }
    }

    throw new Error('filterChunkStream IPC 不可用');


  } catch (error) {
    console.error('[Ripgrep Filter] 过滤失败:', error);
    if (window._hideFilterProgress) window._hideFilterProgress();
    showMessage(`ripgrep过滤失败: ${error.message}`);
  }
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
  console.log('[Cleanup] 页面卸载，清理临时文件');
  if (window.electronAPI && window.electronAPI.cleanupChunkTemp) {
    window.electronAPI.cleanupChunkTemp();
  }
  if (window.electronAPI && window.electronAPI.deleteTempExtractDir) {
    window.electronAPI.deleteTempExtractDir();
  }
}

/**
 * 🚀 页面隐藏时的清理逻辑（用户切换标签页或最小化窗口）
 */
function cleanupOnHide() {
  console.log('[Cleanup] 页面隐藏');
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
function overrideApplyFilter() {
  window.applyFilter = async function() {
    var filterText = filterBox.value;
    if (!filterText.trim()) {
      resetFilter();
      return;
    }

    if (typeof addToFilterHistory === 'function') {
      addToFilterHistory(filterText);
    }

    // 从 fileHeaders 解析磁盘文件路径
    var rgHeaders = null;
    try {
      if (typeof fileHeaders !== 'undefined' && fileHeaders && fileHeaders.length > 0) {
        var first = fileHeaders[0].filePath || fileHeaders[0].fileName;
        if (first && hasValidDiskPath(first)) {
          rgHeaders = fileHeaders;
        }
      }
    } catch (e) {}

    if (rgHeaders && rgHeaders.length > 0) {
      console.log('[Filter] ✓ ripgrep 过滤（' + rgHeaders.length + ' 个文件）');

      // 过滤进度显示到灵动岛
      var DI = window.App && window.App.DynamicIsland;
      window.__fpBar = null;
      window.__fpLabel = null;
      window._updateFilterProgress = function(stage, detail) {
        var di = window.App && window.App.DynamicIsland;
        if (di) di.showProgress(-1, stage + ' ' + detail);
      };
      window._hideFilterProgress = function(summary) {
        var di = window.App && window.App.DynamicIsland;
        if (di) di.hideProgress();
      };

      applyFilterWithRipgrepAsync(filterText, rgHeaders);
      return;
    }

    console.warn('[Filter] 没有有效的磁盘文件路径，无法过滤');
    if (typeof showMessage === 'function') {
      showMessage('过滤需要有效的磁盘文件路径');
    }
  };

  _initKeywordDropdownEvents();
  console.log('[Filter] ✓ applyFilter 已覆盖（ripgrep-only）');
}

// 覆盖 applyFilter：立即执行或等待 DOMContentLoaded
if (typeof window.applyFilter !== 'undefined') {
  overrideApplyFilter();
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', overrideApplyFilter);
} else {
  overrideApplyFilter();
}
