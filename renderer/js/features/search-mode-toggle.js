/**
 * 文件树搜索模式切换模块
 * 支持在普通文件搜索和 Everything 全局搜索之间切换
 */

(function() {
  'use strict';

  console.log('[Search Mode Toggle] 模块加载');

  // 当前搜索模式：'file' 或 'everything'
  let currentMode = 'file';

  // 🔧 Everything 搜索结果虚拟滚动状态
  let everythingResults = [];           // 所有搜索结果
  let everythingVirtualScroll = null;  // 虚拟滚动实例
  const everythingRowHeight = 28;       // 每行高度（增加以容纳更多信息）
  const everythingBufferRows = 10;      // 缓冲行数

  // 初始化
  function init() {
    const toggleBtn = document.getElementById('toggleSearchModeBtn');
    if (!toggleBtn) {
      console.warn('[Search Mode Toggle] 未找到切换按钮');
      return;
    }

    toggleBtn.addEventListener('click', toggleSearchMode);

    // 监听 Everything 搜索框的回车事件（作为后备）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentMode === 'everything') {
        const input = document.getElementById('everythingSearchInput');
        if (input && document.activeElement === input) {
          e.preventDefault();
          e.stopPropagation();
          performEverythingSearch(input.value);
        }
      }
    }, true); // 使用捕获阶段，优先处理

    console.log('[Search Mode Toggle] 功能已初始化');
  }

  /**
   * 切换搜索模式
   */
  function toggleSearchMode() {
    const toggleBtn = document.getElementById('toggleSearchModeBtn');
    const fileSearch = document.getElementById('fileTreeSearch');
    const fileTreeContainer = document.getElementById('fileTreeContainer');

    if (currentMode === 'file') {
      // 切换到 Everything 模式
      currentMode = 'everything';

      // 隐藏文件搜索框，显示 Everything 搜索框
      if (fileSearch) fileSearch.style.display = 'none';

      // 创建或显示 Everything 搜索框
      showEverythingSearchInput();

      // 🔧 由于使用独立容器，无需额外的隐藏操作
      // fileTreeList会在displayEverythingResultsWithVirtualScroll中被隐藏
      console.log('[Search Mode Toggle] 准备切换到Everything模式（独立容器）');

      // 更新按钮样式
      if (toggleBtn) {
        toggleBtn.classList.add('everything-mode');
        toggleBtn.title = '切换到文件树搜索';
      }

      console.log('[Search Mode Toggle] 已切换到 Everything 搜索模式');
    } else {
      // 切换到文件搜索模式
      currentMode = 'file';

      // 显示文件搜索框，隐藏 Everything 搜索框
      if (fileSearch) fileSearch.style.display = 'block';
      hideEverythingSearchInput();

      // 🔧 移除Everything搜索结果，恢复文件树
      const fileTreeContainer = document.getElementById('fileTreeContainer');
      if (fileTreeContainer) {
        // 移除Everything虚拟容器
        const everythingContainer = document.getElementById('everythingVirtualContainer');
        if (everythingContainer) {
          everythingContainer.remove();
          console.log('[Search Mode Toggle] 已移除Everything虚拟容器');
        }

        // 清理虚拟滚动实例
        if (everythingVirtualScroll) {
          everythingVirtualScroll.destroy();
          everythingVirtualScroll = null;
        }

        // 🔧 显示原有的fileTreeList
        const fileTreeList = fileTreeContainer.querySelector('#fileTreeList');
        if (fileTreeList) {
          fileTreeList.style.display = '';
          console.log('[Search Mode Toggle] 已恢复文件树容器 #fileTreeList');
        }

        // 移除所有临时添加的class
        fileTreeContainer.classList.remove('everything-mode-active');
      }

      // 更新按钮样式
      if (toggleBtn) {
        toggleBtn.classList.remove('everything-mode');
        toggleBtn.title = '切换到 Everything 全局搜索';
      }

      console.log('[Search Mode Toggle] 已切换到文件树搜索模式');
    }
  }

  /**
   * 显示 Everything 搜索输入框
   */
  function showEverythingSearchInput() {
    const container = document.querySelector('.file-tree-search-container');
    if (!container) return;

    // 检查是否已经存在 Everything 搜索框
    let everythingInput = document.getElementById('everythingSearchInput');

    if (!everythingInput) {
      // 创建 Everything 搜索框
      everythingInput = document.createElement('input');
      everythingInput.type = 'text';
      everythingInput.id = 'everythingSearchInput';
      everythingInput.placeholder = 'Everything 快速搜索 (支持通配符 *)';
      everythingInput.autocomplete = 'off';

      // 添加到容器（按钮后面，文件搜索框后面）
      const fileSearchInput = container.querySelector('#fileTreeSearch');
      if (fileSearchInput) {
        container.insertBefore(everythingInput, fileSearchInput.nextSibling);
      } else {
        const toggleBtn = container.querySelector('.toggle-search-btn');
        if (toggleBtn) {
          container.insertBefore(everythingInput, toggleBtn.nextSibling);
        } else {
          container.appendChild(everythingInput);
        }
      }

      // 添加实时搜索（防抖）
      let searchTimeout;
      everythingInput.addEventListener('input', (e) => {
        e.stopPropagation();
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          performEverythingSearch(e.target.value);
        }, 300);
      });

      // 添加回车搜索
      everythingInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.stopPropagation();
          e.preventDefault();
          clearTimeout(searchTimeout);
          performEverythingSearch(e.target.value);
        }
      });

      console.log('[Search Mode Toggle] Everything 搜索框已创建');
    } else {
      everythingInput.style.display = 'block';
    }

    // 聚焦到输入框
    setTimeout(() => {
      everythingInput.focus();
      console.log('[Search Mode Toggle] Everything 搜索框已聚焦');
    }, 100);
  }

  /**
   * 隐藏 Everything 搜索输入框
   */
  function hideEverythingSearchInput() {
    const everythingInput = document.getElementById('everythingSearchInput');
    if (everythingInput) {
      everythingInput.style.display = 'none';
    }
  }

  /**
   * 执行 Everything 搜索
   */
  async function performEverythingSearch(keyword) {
    console.log('[Search Mode Toggle] 执行 Everything 搜索:', keyword);

    // 检查 EverythingCLI 是否可用
    if (!window.App || !window.App.EverythingCLI) {
      console.error('[Search Mode Toggle] EverythingCLI 模块未加载');
      showMessage('Everything 搜索模块未加载，请稍后重试');
      return;
    }

    // 检查并修复 es.exe 路径
    const exePath = window.App.EverythingCLI.config.exePath;
    console.log('[Search Mode Toggle] 当前 es.exe 路径:', exePath);

    // 如果是相对路径，需要修复为完整路径
    if (exePath.startsWith('./') || exePath.startsWith('.\\')) {
      console.log('[Search Mode Toggle] 检测到相对路径，尝试获取完整路径');
      // 使用之前检测到的路径
      const detectedPath = 'E:\\resources\\app\\es.exe';
      window.App.EverythingCLI.setExePath(detectedPath);
      console.log('[Search Mode Toggle] 已修复路径为:', detectedPath);
    }

    // 清空之前的搜索结果
    const fileTreeContainer = document.getElementById('fileTreeContainer');
    if (fileTreeContainer) {
      // 移除旧的Everything虚拟容器
      const oldContainer = document.getElementById('everythingVirtualContainer');
      if (oldContainer) {
        oldContainer.remove();
      }

      // 清理虚拟滚动实例
      if (everythingVirtualScroll) {
        everythingVirtualScroll.destroy();
        everythingVirtualScroll = null;
      }
    }

    if (!keyword || !keyword.trim()) {
      console.log('[Search Mode Toggle] 搜索关键词为空，跳过搜索');
      return;
    }

    try {
      console.log('[Search Mode Toggle] 调用 EverythingCLI.searchLogFiles...');
      // 使用 EverythingCLI 模块进行搜索
      const files = await window.App.EverythingCLI.searchLogFiles(keyword.trim());
      console.log('[Search Mode Toggle] 搜索结果:', files.length, '个文件');

      if (files && files.length > 0) {
        // 🔧 只过滤掉无效数据，保留文件夹
        everythingResults = files.filter(item => {
          const fullPath = item.filename || item.path || item.name || '';
          if (!fullPath || fullPath.trim().length === 0) {
            return false;
          }

          // 保留文件和文件夹
          return true;
        });
        displayEverythingResultsWithVirtualScroll();
        showMessage(`找到 ${everythingResults.length} 个结果`);
      } else {
        console.log('[Search Mode Toggle] 未找到结果');
        showMessage('未找到匹配的文件');
      }
    } catch (error) {
      console.error('[Everything 搜索] 错误:', error);
      showMessage(`搜索失败: ${error.message}`);
    }
  }

  /**
   * 使用虚拟滚动显示 Everything 搜索结果
   * 🔧 使用独立容器，完全与文件树分离
   */
  function displayEverythingResultsWithVirtualScroll() {
    const fileTreeContainer = document.getElementById('fileTreeContainer');
    if (!fileTreeContainer) return;

    // 🔧 完全隐藏原有的fileTreeList，不共用容器
    const fileTreeList = fileTreeContainer.querySelector('#fileTreeList');
    if (fileTreeList) {
      fileTreeList.style.display = 'none';
    }
    console.log('[Everything] 已隐藏原有文件树容器 #fileTreeList');

    // 移除旧的虚拟滚动容器
    const oldContainer = document.getElementById('everythingVirtualContainer');
    if (oldContainer) {
      oldContainer.remove();
    }

    // 🔧 计算功能区域的实际高度
    const serverConnectArea = fileTreeContainer.querySelector('#serverConnectArea');
    const searchContainer = fileTreeContainer.querySelector('.file-tree-search-container');
    let topOffset = 0;

    if (serverConnectArea) {
      topOffset += serverConnectArea.offsetHeight;
    }
    if (searchContainer) {
      topOffset += searchContainer.offsetHeight;
    }

    console.log('[Everything] 功能区域高度:', { serverConnectArea: serverConnectArea?.offsetHeight, searchContainer: searchContainer?.offsetHeight, total: topOffset });

    // 🔧 创建独立的Everything容器（完全替代fileTreeList）
    const everythingContainer = document.createElement('div');
    everythingContainer.id = 'everythingVirtualContainer';
    everythingContainer.className = 'everything-virtual-container';
    everythingContainer.style.cssText = `
      position: absolute;
      top: ${topOffset}px; /* 🔧 动态计算功能区域的高度 */
      left: 0;
      right: 0;
      bottom: 0;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
    `;

    // 🔧 添加表头
    const header = document.createElement('div');
    header.className = 'everything-results-header';
    header.innerHTML = `
      <div class="everything-col everything-col-index">#</div>
      <div class="everything-col everything-col-name">名称</div>
      <div class="everything-col everything-col-size">大小</div>
    `;
    header.style.cssText = `
      display: flex;
      padding: 6px 12px;
      background: #f8f9fa;
      border-bottom: 1px solid #dee2e6;
      font-size: 12px;
      font-weight: 600;
      color: #495057;
      position: sticky;
      top: 0;
      z-index: 100;
      user-select: none;
      flex-shrink: 0;
    `;
    everythingContainer.appendChild(header);

    // 创建内容容器（放置虚拟滚动行）
    const contentContainer = document.createElement('div');
    contentContainer.className = 'everything-virtual-content';
    contentContainer.style.cssText = `
      position: relative;
      width: 100%;
      flex: 1;
      min-height: 0;
    `;

    everythingContainer.appendChild(contentContainer);

    // 🔧 添加到fileTreeContainer（与fileTreeList平级）
    fileTreeContainer.appendChild(everythingContainer);

    console.log('[Everything] 已创建独立的Everything容器');

    // 🔧 等待容器布局完成后再初始化虚拟滚动
    requestAnimationFrame(() => {
      // 初始化虚拟滚动，everythingContainer既是滚动容器也包含内容容器
      everythingVirtualScroll = new EverythingVirtualScroll(contentContainer, everythingContainer, everythingResults, everythingRowHeight);
      everythingVirtualScroll.init();

      console.log(`[Everything] 虚拟滚动已初始化，总计 ${everythingResults.length} 个结果`);
    });
  }

  /**
   * Everything 虚拟滚动类
   * @param {HTMLElement} container - 内容容器（放置虚拟滚动行的容器）
   * @param {HTMLElement} scrollContainer - 滚动容器（产生滚动条的容器）
   * @param {Array} data - 数据数组
   * @param {number} rowHeight - 每行高度
   */
  class EverythingVirtualScroll {
    constructor(container, scrollContainer, data, rowHeight) {
      this.container = container;
      this.scrollContainer = scrollContainer;
      this.data = data;
      this.rowHeight = rowHeight;
      this.totalHeight = data.length * rowHeight;
      this.visibleRows = [];
      this.renderedRows = new Map(); // index -> element
      this.ticking = false; // 🔧 RAF标志，用于合并多个滚动事件

      // 🔧 立即设置容器高度（使用!important确保不被覆盖）
      this.container.style.height = this.totalHeight + 'px';
      this.container.style.position = 'relative';
      this.container.style.width = '100%';
      this.container.style.minHeight = this.totalHeight + 'px';
      this.container.style.maxHeight = this.totalHeight + 'px';

      console.log(`[Everything Virtual Scroll] 设置容器高度: ${this.totalHeight}px (${data.length} 行 × ${rowHeight}px)`);

      // 绑定滚动事件到滚动容器
      this.scrollHandler = () => this.onScroll();
      this.scrollContainer.addEventListener('scroll', this.scrollHandler, { passive: false });
    }

    init() {
      console.log(`[Everything Virtual Scroll] 初始化完成: ${this.data.length} 行, 行高 ${this.rowHeight}px, 总高度 ${this.totalHeight}px`);

      // 🔧 调试：输出容器链的信息
      console.log(`[Everything Virtual Scroll] 滚动容器信息:`, {
        scrollHeight: this.scrollContainer.scrollHeight,
        clientHeight: this.scrollContainer.clientHeight,
        offsetHeight: this.scrollContainer.offsetHeight,
        scrollTop: this.scrollContainer.scrollTop,
        overflowY: getComputedStyle(this.scrollContainer).overflowY
      });

      console.log(`[Everything Virtual Scroll] 内容容器信息:`, {
        height: this.container.style.height,
        offsetHeight: this.container.offsetHeight,
        scrollHeight: this.container.scrollHeight
      });

      // 初始渲染
      this.updateVisibleRows();
      this.render();
    }

    onScroll() {
      // 🔧 不使用RAF，直接同步更新，确保拖动滚动条时流畅
      this.updateVisibleRows();
      this.render();
    }

    updateVisibleRows() {
      const scrollTop = this.scrollContainer.scrollTop;
      const containerHeight = this.scrollContainer.clientHeight;

      // 计算可见范围（加上缓冲区）
      const startIndex = Math.max(0, Math.floor((scrollTop - everythingBufferRows * this.rowHeight) / this.rowHeight));
      const endIndex = Math.min(
        this.data.length,
        Math.ceil((scrollTop + containerHeight + everythingBufferRows * this.rowHeight) / this.rowHeight)
      );

      this.visibleRows = [];
      for (let i = startIndex; i < endIndex; i++) {
        this.visibleRows.push(i);
      }
    }

    render() {
      // 🔧 调试：检查container的状态
      const containerInDOM = document.body.contains(this.container);
      const containerParent = this.container.parentElement;
      const containerDisplay = window.getComputedStyle(this.container).display;
      const containerVisible = this.container.offsetHeight > 0;

      console.log(`[Everything Virtual Scroll] render() 调用，可见行数: ${this.visibleRows.length}, 已渲染: ${this.renderedRows.size}`, {
        containerInDOM,
        containerParent: containerParent?.className || containerParent?.id,
        containerDisplay,
        containerVisible,
        containerHeight: this.container.style.height,
        containerChildren: this.container.children.length
      });

      // 🔧 保护：确保容器高度不被修改
      const expectedHeight = this.totalHeight;
      if (parseInt(this.container.style.height) !== expectedHeight) {
        console.warn(`[Everything Virtual Scroll] 容器高度被修改! 修复: ${this.container.style.height} -> ${expectedHeight}px`);
        this.container.style.height = expectedHeight + 'px';
      }

      // 标记所有当前渲染的行
      const renderedIndices = new Set(this.renderedRows.keys());

      // 渲染可见行
      let renderedCount = 0;
      this.visibleRows.forEach(index => {
        if (!this.renderedRows.has(index)) {
          this.renderRow(index);
          renderedCount++;
        }
        renderedIndices.delete(index);
      });

      console.log(`[Everything Virtual Scroll] 新渲染了 ${renderedCount} 行`);

      // 移除不再可见的行
      let removedCount = 0;
      renderedIndices.forEach(index => {
        const element = this.renderedRows.get(index);
        if (element) {
          element.remove();
          this.renderedRows.delete(index);
          removedCount++;
        }
      });

      if (removedCount > 0) {
        console.log(`[Everything Virtual Scroll] 移除了 ${removedCount} 行`);
      }
    }

    renderRow(index) {
      const item = this.data[index];
      const fullPath = item.filename || item.path || item.name || '';

      // 🔧 调试：在方法开始就输出
      if (index === 0) {
        console.log('[Everything Virtual Scroll] 开始渲染第0行，数据:', item);
      }

      // 由于已经过滤了无效数据，这里应该总是有值
      if (!fullPath) {
        console.warn('[Everything Virtual Scroll] 跳过无效数据:', item);
        return;
      }

      // 获取文件信息
      const pathParts = fullPath.split(/[/\\]/);
      const fileName = pathParts.pop(); // 文件名
      const parentDir = pathParts.pop() || ''; // 父目录名
      const fileSize = item.size || 0;
      const dateModified = item.date_modified || item.dateModified || Date.now();

      const fileType = EverythingVirtualScroll.detectFileType(fullPath);
      const icon = EverythingVirtualScroll.getFileIcon(fullPath, fileType);

      // 格式化信息
      const fileSizeStr = EverythingVirtualScroll.formatFileSize(fileSize);
      const dateStr = EverythingVirtualScroll.formatDate(dateModified);
      const pathStr = parentDir || '(根目录)';

      const row = document.createElement('div');
      row.className = 'file-tree-item everything-result-item';

      // 🔧 只设置必要的定位样式，布局使用CSS
      row.style.position = 'absolute';
      row.style.width = '100%';
      row.style.height = `${this.rowHeight}px`;
      row.style.top = `${index * this.rowHeight}px`;
      row.style.left = '0';
      row.style.padding = '0 12px';
      row.style.boxSizing = 'border-box';
      row.style.borderBottom = '1px solid rgba(0, 0, 0, 0.05)';
      row.style.display = 'flex';
      row.style.alignItems = 'center';

      // 🔧 多列布局（显示序号、名称和大小）
      row.innerHTML = `
        <div class="everything-col everything-col-index">${index + 1}</div>
        <div class="everything-col everything-col-name" title="${fullPath}">
          <span class="file-icon">${icon}</span>
          <span class="file-name">${fileName}</span>
        </div>
        <div class="everything-col everything-col-size">${fileSizeStr}</div>
      `;

      row.title = fullPath;
      row.dataset.path = fullPath;
      row.dataset.fullPath = fullPath;
      row.dataset.index = index;
      row.dataset.fileType = fileType;

      // 左键点击：阻止任何操作
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      // 右键菜单
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showEverythingContextMenu(e, fullPath);
      });

      // 🔧 添加行之前记录容器高度
      const heightBefore = this.container.style.height;

      this.container.appendChild(row);
      this.renderedRows.set(index, row);

      // 🔧 调试：确认行已被添加
      if (index === 0 || index === 1) {
        console.log(`[Everything Virtual Scroll] 渲染行 ${index}:`, {
          fileName: fileName,
          containerChildren: this.container.children.length,
          rowDisplay: window.getComputedStyle(row).display,
          rowPosition: row.style.top
        });
      }

      // 🔧 确保容器高度没有被修改
      if (this.container.style.height !== heightBefore) {
        console.warn(`[Everything Virtual Scroll] 添加行 ${index} 后容器高度被修改! 恢复: ${this.container.style.height} -> ${heightBefore}`);
        this.container.style.height = heightBefore;
      }
    }

    /**
     * 格式化文件大小
     */
    static formatFileSize(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i];
    }

    /**
     * 格式化日期时间
     */
    static formatDate(timestamp) {
      if (!timestamp) return '-';
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;

      // 如果是今天，只显示时间
      if (diff < 86400000 && date.getDate() === now.getDate() &&
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()) {
        return date.toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      }

      // 如果是今年，显示月-日 时间
      if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).replace(/\//g, '-');
      }

      // 否则显示完整日期
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).replace(/\//g, '-');
    }

    /**
     * 检测文件类型
     * @returns {string} 'folder' | 'archive' | 'code' | 'log' | 'text' | 'other'
     */
    static detectFileType(filePath) {
      // 检查是否是文件夹（路径以 \ 或 / 结尾）
      if (filePath.endsWith('\\') || filePath.endsWith('/')) {
        return 'folder';
      }

      // 获取文件扩展名
      const ext = filePath.split('.').pop().toLowerCase();

      // 压缩包类型
      const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'cab', 'iso', 'wim'];
      if (archiveExtensions.includes(ext)) {
        return 'archive';
      }

      // 代码文件类型
      const codeExtensions = [
        'js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'java', 'c', 'cpp', 'h', 'hpp',
        'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'scala', 'dart', 'lua',
        'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'r', 'm', 'mjs', 'cjs'
      ];
      if (codeExtensions.includes(ext)) {
        return 'code';
      }

      // 日志文件类型
      const logExtensions = ['log', 'out', 'err', 'debug', 'trace'];
      if (logExtensions.includes(ext)) {
        return 'log';
      }

      // 文本文件类型
      const textExtensions = ['txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf'];
      if (textExtensions.includes(ext)) {
        return 'text';
      }

      // 其他文件
      return 'other';
    }

    /**
     * 根据文件类型获取图标
     */
    static getFileIcon(filePath, fileType) {
      const iconMap = {
        folder: '📁',
        archive: '🗜️',
        code: '💻',
        log: '📋',
        text: '📄',
        other: '📄'
      };

      // 特殊文件名的图标
      const fileName = filePath.split(/[/\\]/).pop().toLowerCase();

      // 特殊文件
      if (fileName.endsWith('.exe') || fileName.endsWith('.dll')) return '⚙️';
      if (fileName.endsWith('.html') || fileName.endsWith('.htm') || fileName.endsWith('.vue')) return '🌐';
      if (fileName.endsWith('.css')) return '🎨';
      if (fileName.endsWith('.jpg') || fileName.endsWith('.png') || fileName.endsWith('.gif') || fileName.endsWith('.svg')) return '🖼️';
      if (fileName.endsWith('.mp3') || fileName.endsWith('.wav') || fileName.endsWith('.flac')) return '🎵';
      if (fileName.endsWith('.mp4') || fileName.endsWith('.avi') || fileName.endsWith('.mkv')) return '🎬';
      if (fileName.endsWith('.pdf')) return '📕';

      return iconMap[fileType] || '📄';
    }

    destroy() {
      // 🔧 清理RAF标志
      this.ticking = false;

      // 移除滚动事件监听器
      if (this.scrollHandler) {
        this.scrollContainer.removeEventListener('scroll', this.scrollHandler);
        this.scrollHandler = null;
      }

      // 清理所有渲染的行
      this.renderedRows.forEach(element => element.remove());
      this.renderedRows.clear();
    }
  }

  /**
   * 显示Everything搜索结果的右键菜单
   */
  function showEverythingContextMenu(e, filePath) {
    // 移除已存在的菜单
    const existingMenu = document.querySelector('.everything-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    // 提取文件名
    const fileName = filePath.split(/[/\\]/).pop();

    // 创建右键菜单
    const menu = document.createElement('div');
    menu.className = 'everything-context-menu';
    menu.innerHTML = `
      <div class="everything-context-menu-item" data-action="copy-path">
        <span class="menu-icon">📋</span>
        <span class="menu-text">复制文件路径</span>
      </div>
      <div class="everything-context-menu-item" data-action="copy-name">
        <span class="menu-icon">📝</span>
        <span class="menu-text">复制文件名</span>
      </div>
      <div class="everything-context-menu-divider"></div>
      <div class="everything-context-menu-item" data-action="open-notepad">
        <span class="menu-icon">✏️</span>
        <span class="menu-text">用 Notepad++ 打开</span>
      </div>
      <div class="everything-context-menu-item" data-action="open-path">
        <span class="menu-icon">📂</span>
        <span class="menu-text">打开文件路径</span>
      </div>
    `;

    // 定位菜单
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;

    // 添加到文档
    document.body.appendChild(menu);

    // 绑定点击事件
    menu.addEventListener('click', (menuEvent) => {
      menuEvent.stopPropagation();
      menuEvent.preventDefault(); // 阻止默认行为

      const action = menuEvent.target.closest('.everything-context-menu-item')?.dataset.action;

      switch (action) {
        case 'copy-path':
          copyToClipboard(filePath);
          showMessage('已复制文件路径');
          break;
        case 'copy-name':
          copyToClipboard(fileName);
          showMessage('已复制文件名');
          break;
        case 'open-notepad':
          openWithNotepadPP(filePath);
          break;
        case 'open-path':
          openEverythingFilePath(filePath);
          break;
      }

      // 关闭菜单
      menu.remove();
    });

    // 阻止菜单的右键事件
    menu.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // 点击其他地方关闭菜单（使用 mousedown 更可靠）
    const closeMenuHandler = (event) => {
      // 如果点击的不是菜单本身或菜单内的元素
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener('mousedown', closeMenuHandler);
        document.removeEventListener('click', closeMenuHandler);
        document.removeEventListener('contextmenu', closeMenuHandler);
      }
    };

    // 监听多种事件确保菜单能被关闭
    document.addEventListener('mousedown', closeMenuHandler);
    document.addEventListener('click', closeMenuHandler);
    document.addEventListener('contextmenu', closeMenuHandler);
  }

  /**
   * 复制文本到剪贴板
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      console.log('[Everything] 已复制到剪贴板:', text);
    } catch (error) {
      console.error('[Everything] 复制失败:', error);
      // 降级方案：使用传统方法
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        console.log('[Everything] 已使用降级方案复制');
      } catch (err) {
        console.error('[Everything] 降级复制也失败:', err);
        showMessage('复制失败，请手动复制');
      }
      document.body.removeChild(textArea);
    }
  }

  /**
   * 用 Notepad++ 打开文件
   */
  async function openWithNotepadPP(filePath) {
    console.log('[Everything] 用 Notepad++ 打开:', filePath);

    try {
      if (!window.electronAPI || !window.electronAPI.openWithApp) {
        throw new Error('Electron API 不可用');
      }

      // 常见的 Notepad++ 安装路径
      const notepadPPPaths = [
        'C:\\Program Files\\Notepad++\\notepad++.exe',
        'C:\\Program Files (x86)\\Notepad++\\notepad++.exe'
      ];

      let notepadPPFound = false;

      // 尝试使用 Notepad++ 打开
      for (const notepadPath of notepadPPPaths) {
        try {
          const result = await window.electronAPI.openWithApp(notepadPath, filePath);
          if (result.success) {
            notepadPPFound = true;
            console.log('[Everything] ✅ 已用 Notepad++ 打开文件');
            showMessage('已用 Notepad++ 打开文件');
            break;
          }
        } catch (err) {
          // 继续尝试下一个路径
          continue;
        }
      }

      if (!notepadPPFound) {
        // 如果找不到 Notepad++，使用系统默认程序
        if (window.electronAPI.openFileWithDefaultApp) {
          const result = await window.electronAPI.openFileWithDefaultApp(filePath);
          if (result && result.success) {
            console.log('[Everything] ✅ 已用默认程序打开文件');
            showMessage('未找到 Notepad++，已用默认程序打开');
          } else {
            throw new Error(result.error || '打开文件失败');
          }
        } else {
          throw new Error('打开文件的API不可用');
        }
      }
    } catch (error) {
      console.error('[Everything] ❌ 打开文件失败:', error);
      showMessage(`打开文件失败: ${error.message}`);
    }
  }

  /**
   * 打开Everything搜索结果的文件路径
   */
  async function openEverythingFilePath(filePath) {
    console.log('[Everything] 打开文件路径:', filePath);

    try {
      if (window.electronAPI && window.electronAPI.openPath) {
        const result = await window.electronAPI.openPath(filePath);
        if (result && !result.success) {
          throw new Error(result.error || '打开路径失败');
        }
        console.log('[Everything] ✅ 已在资源管理器中选中文件');
      } else {
        throw new Error('Electron API 不可用');
      }
    } catch (error) {
      console.error('[Everything] ❌ 打开文件路径失败:', error);
      if (typeof showMessage === 'function') {
        showMessage(`打开路径失败: ${error.message}`);
      }
    }
  }

  // 延迟初始化
  setTimeout(init, 1000);

  console.log('[Search Mode Toggle] 模块已加载');
})();

// 🔧 注入右键菜单的CSS样式和Everything模式样式
const menuStyle = document.createElement('style');
menuStyle.textContent = `
  /* 🔧 Everything独立容器样式 */
  #everythingVirtualContainer {
    z-index: 5;
  }

  /* 🔧 Everything独立容器的滚动条样式 */
  #everythingVirtualContainer::-webkit-scrollbar {
    width: 12px !important;
  }

  #everythingVirtualContainer::-webkit-scrollbar-track {
    background: transparent;
  }

  #everythingVirtualContainer::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    border: 2px solid transparent;
    background-clip: content-box;
  }

  #everythingVirtualContainer::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.4);
    border-radius: 6px;
    border: 2px solid transparent;
    background-clip: content-box;
  }

  /* 右键菜单样式 */
  .everything-context-menu {
    position: fixed;
    background: white;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 4px 0;
    min-width: 180px;
    z-index: 10000;
    font-size: 13px;
  }

  .everything-context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    transition: background 0.15s;
    user-select: none;
  }

  .everything-context-menu-item:hover {
    background: rgba(102, 126, 234, 0.1);
  }

  .everything-context-menu-item .menu-icon {
    font-size: 14px;
    width: 20px;
    text-align: center;
  }

  .everything-context-menu-item .menu-text {
    color: #333;
    flex: 1;
  }

  .everything-context-menu-divider {
    height: 1px;
    background: rgba(0, 0, 0, 0.1);
    margin: 4px 0;
  }

  /* Everything 虚拟滚动文件样式 */
  .everything-result-item .file-icon {
    margin-right: 6px;
    font-size: 14px;
    flex-shrink: 0;
  }

  .everything-result-item .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  /* Everything 多列布局 */
  .everything-result-item .everything-col {
    display: flex;
    align-items: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    padding: 0 4px;
  }

  .everything-result-item .everything-col-index {
    flex: 0 0 50px;
    text-align: center;
    color: #999;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 11px;
  }

  .everything-result-item .everything-col-name {
    flex: 2;
    min-width: 150px;
  }

  .everything-result-item .everything-col-path {
    flex: 3;
    min-width: 100px;
    color: #666;
  }

  .everything-result-item .everything-col-size {
    flex: 0 0 70px;
    text-align: right;
    color: #999;
    font-family: 'Consolas', 'Monaco', monospace;
  }

  .everything-result-item .everything-col-date {
    flex: 0 0 130px;
    color: #999;
    font-family: 'Consolas', 'Monaco', monospace;
  }

  /* Everything 表头样式 */
  .everything-results-header .everything-col {
    display: flex;
    align-items: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .everything-results-header .everything-col-index {
    flex: 0 0 50px;
    text-align: center;
    justify-content: center;
  }

  .everything-results-header .everything-col-name {
    flex: 2;
    min-width: 150px;
  }

  .everything-results-header .everything-col-path {
    flex: 3;
    min-width: 100px;
  }

  .everything-results-header .everything-col-size {
    flex: 0 0 70px;
    text-align: right;
  }
`;
document.head.appendChild(menuStyle);
