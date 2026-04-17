/**
 * Everything 搜索 UI 组件
 * 在文件树顶部集成 Everything 快速搜索
 */

(function() {
  'use strict';

  // 检查是否已初始化
  if (window.App.EverythingSearchUI) {
    console.log('[Everything Search UI] 已初始化，跳过');
    return;
  }

  window.App.EverythingSearchUI = {
    container: null,
    searchInput: null,
    resultsContainer: null,
    isSearching: false,
    searchTimer: null,

    /**
     * 初始化搜索UI
     */
    init() {
      console.log('[Everything Search UI] 初始化...');

      // 创建搜索容器
      this.createSearchUI();

      // 绑定事件
      this.bindEvents();

      // 设置文件树拖放区域
      this.setupFileTreeDropZone();

      // 测试连接
      this.testConnection();

      console.log('[Everything Search UI] 初始化完成');
    },

    /**
     * 创建搜索UI
     */
    createSearchUI() {
      // 使用 fileTreeContainer 而不是 file-tree-panel
      const fileTreeContainer = document.querySelector('#fileTreeContainer');
      if (!fileTreeContainer) {
        console.error('[Everything Search UI] 找不到文件树容器 (#fileTreeContainer)');
        return;
      }

      // 创建搜索容器
      this.container = document.createElement('div');
      this.container.className = 'everything-search-container';
      this.container.innerHTML = `
        <div class="everything-search-header">
          <input
            type="text"
            class="everything-search-input"
            placeholder="Everything 快速搜索 (支持通配符 *)"
          />
        </div>
        <div class="everything-search-results" style="display:none;">
          <div class="everything-search-status"></div>
          <div class="everything-search-list"></div>
        </div>
      `;

      // 找到 fileTreeSearch 元素，将 Everything 搜索框插入到它所在的容器前面
      const fileTreeSearch = document.querySelector('#fileTreeSearch');
      if (fileTreeSearch) {
        const searchContainer = fileTreeSearch.closest('.file-tree-search-container') || fileTreeSearch;
        fileTreeContainer.insertBefore(this.container, searchContainer);
        console.log('[Everything Search UI] 已插入搜索框到 fileTreeSearch 前面');
      } else {
        // 如果找不到 fileTreeSearch，插入到 serverConnectArea 后面
        const serverConnectArea = document.querySelector('#serverConnectArea');
        if (serverConnectArea && serverConnectArea.nextSibling) {
          fileTreeContainer.insertBefore(this.container, serverConnectArea.nextSibling);
          console.log('[Everything Search UI] 已插入搜索框到 serverConnectArea 后面');
        } else {
          // 最后的备选方案：插入到容器顶部
          fileTreeContainer.insertBefore(this.container, fileTreeContainer.firstChild);
          console.log('[Everything Search UI] 已插入搜索框到容器顶部');
        }
      }

      // 缓存元素引用
      this.searchInput = this.container.querySelector('.everything-search-input');
      this.resultsContainer = this.container.querySelector('.everything-search-results');
      this.statusEl = this.container.querySelector('.everything-search-status');
      this.listEl = this.container.querySelector('.everything-search-list');
    },

    /**
     * 绑定事件
     */
    bindEvents() {
      // 🔧 输入框自动搜索（无需按 Enter）
      this.searchInput.addEventListener('input', () => {
        clearTimeout(this.searchTimer);
        const query = this.searchInput.value.trim();

        // 输入为空时自动隐藏结果
        if (query.length === 0) {
          this.hideResults();
          return;
        }

        // 防抖搜索：300ms 后执行
        this.searchTimer = setTimeout(() => {
          this.performSearch();
        }, 300);
      });
    },

    /**
     * 设置文件树拖放区域
     */
    setupFileTreeDropZone() {
      console.log('[Everything Search UI] 设置文件树拖放区域...');

      const fileTreeContainer = document.querySelector('#fileTreeContainer');
      if (!fileTreeContainer) {
        console.warn('[Everything Search UI] 找不到文件树容器');
        return;
      }

      // 拖拽进入（捕获阶段，优先处理）
      fileTreeContainer.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileTreeContainer.classList.add('everything-drag-over');
      }, true);  // 使用捕获阶段

      // 拖拽经过（捕获阶段，优先处理）
      fileTreeContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        fileTreeContainer.classList.add('everything-drag-over');
      }, true);  // 使用捕获阶段

      // 拖拽离开（捕获阶段，优先处理）
      fileTreeContainer.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // 检查是否真正离开了容器（而不是进入子元素）
        if (e.target === fileTreeContainer) {
          fileTreeContainer.classList.remove('everything-drag-over');
        }
      }, true);  // 使用捕获阶段

      // 拖拽结束
      fileTreeContainer.addEventListener('dragend', (e) => {
        fileTreeContainer.classList.remove('everything-drag-over');
      }, true);  // 使用捕获阶段

      // 放置（捕获阶段，优先处理 Everything 的数据）
      fileTreeContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileTreeContainer.classList.remove('everything-drag-over');

        // 获取拖拽数据
        const jsonData = e.dataTransfer.getData('application/json');
        if (!jsonData) {
          console.log('[Everything Search UI] 无效的拖拽数据');
          return;
        }

        try {
          const data = JSON.parse(jsonData);
          console.log('[Everything Search UI] 接收到拖放数据:', data);

          // 只处理来自 Everything 搜索的拖放
          if (data.source === 'everything-search') {
            this.handleDropOnFileTree(data);
          }
        } catch (error) {
          console.error('[Everything Search UI] 解析拖拽数据失败:', error);
        }
      });

      console.log('[Everything Search UI] ✓ 文件树拖放区域已设置');
    },

    /**
     * 处理文件树上的拖放
     */
    async handleDropOnFileTree(data) {
      console.log('[Everything Search UI] 处理拖放到文件树:', data);

      try {
        const { type, fullPath, name } = data;

        // 🔧 优先使用 handleDroppedPaths 函数（original-script.js 中的通用拖放处理）
        if (typeof handleDroppedPaths === 'function') {
          console.log('[Everything Search UI] 使用 handleDroppedPaths 处理');
          await handleDroppedPaths([fullPath]);
          console.log('[Everything Search UI] handleDroppedPaths 完成');
          return;
        }

        // 备用方案：按类型分别处理
        if (type === 'archive') {
          await this.addArchiveToFileTree(fullPath, name);
        } else if (type === 'directory') {
          await this.addFolderToFileTree(fullPath, name);
        } else if (type === 'file') {
          await this.addFileToFileTree(fullPath, name);
        }

        // 确保文件树可见
        this.ensureFileTreeVisible();

      } catch (error) {
        console.error('[Everything Search UI] 拖放处理失败:', error);
        if (typeof showMessage === 'function') {
          showMessage(`添加失败: ${error.message}`);
        }
      }
    },

    /**
     * 添加压缩包到文件树
     */
    async addArchiveToFileTree(archivePath, fileName) {
      console.log('[Everything Search UI] 添加压缩包到文件树:', archivePath);

      try {
        // 🔧 关键修复：需要先通过 Electron API 读取文件，然后调用 processArchiveFile
        if (window.electronAPI && window.electronAPI.readFile) {
          console.log('[Everything Search UI] 通过 Electron API 读取压缩包');

          const result = await window.electronAPI.readFile(archivePath);
          if (!result || !result.success) {
            throw new Error(result?.error || '读取压缩包失败');
          }

          // 将 base64 内容转换为 File 对象
          const byteCharacters = atob(result.content);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/zip' });
          const file = new File([blob], fileName, {
            type: 'application/zip',
            lastModified: Date.now()
          });

          // 设置文件路径属性
          file.path = archivePath;
          file.fullPath = archivePath;

          console.log('[Everything Search UI] File 对象创建成功:', {
            name: file.name,
            size: file.size,
            path: file.path
          });

          // 调用 processArchiveFile 处理压缩包
          if (typeof processArchiveFile === 'function') {
            console.log('[Everything Search UI] 调用 processArchiveFile');
            await processArchiveFile(file);
            console.log('[Everything Search UI] processArchiveFile 完成');
          } else {
            throw new Error('processArchiveFile 函数不可用');
          }

        } else {
          throw new Error('Electron API 不可用');
        }

        if (typeof showMessage === 'function') {
          showMessage(`已添加压缩包: ${fileName}`);
        }

      } catch (error) {
        console.error('[Everything Search UI] 添加压缩包失败:', error);
        if (typeof showMessage === 'function') {
          showMessage(`添加压缩包失败: ${error.message}`);
        }
        throw error;
      }
    },

    /**
     * 添加文件夹到文件树
     */
    async addFolderToFileTree(folderPath, folderName) {
      console.log('[Everything Search UI] 添加文件夹到文件树:', folderPath);

      try {
        if (typeof addFilesToTree === 'function') {
          const folderFile = {
            path: folderPath,
            name: folderName,
            fullPath: folderPath,
            type: 'folder',
            isLocalDrive: true,
            _isLazyDir: true
          };

          await addFilesToTree([folderFile]);
          console.log('[Everything Search UI] 文件夹已添加');

          if (typeof showMessage === 'function') {
            showMessage(`已添加文件夹: ${folderName}`);
          }
        } else {
          throw new Error('addFilesToTree 函数不可用');
        }

      } catch (error) {
        console.error('[Everything Search UI] 添加文件夹失败:', error);
        throw error;
      }
    },

    /**
     * 添加普通文件到文件树
     */
    async addFileToFileTree(filePath, fileName) {
      console.log('[Everything Search UI] 添加文件到文件树:', filePath);

      try {
        if (typeof addFilesToTree === 'function') {
          const file = {
            path: filePath,
            name: fileName,
            fullPath: filePath,
            type: 'file',
            isLocalDrive: true
          };

          await addFilesToTree([file]);
          console.log('[Everything Search UI] 文件已添加');

          if (typeof showMessage === 'function') {
            showMessage(`已添加文件: ${fileName}`);
          }
        } else {
          throw new Error('addFilesToTree 函数不可用');
        }

      } catch (error) {
        console.error('[Everything Search UI] 添加文件失败:', error);
        throw error;
      }
    },

    /**
     * 确保文件树可见
     */
    ensureFileTreeVisible() {
      console.log('[Everything Search UI] 确保文件树可见');

      const fileTreeContainer = document.querySelector('#fileTreeContainer');
      if (fileTreeContainer) {
        // 显示文件树容器
        fileTreeContainer.classList.add('visible');

        // 更新折叠按钮
        const collapseBtn = document.querySelector('#fileTreeCollapseBtn');
        if (collapseBtn) {
          collapseBtn.innerHTML = '◀';
        }

        // 强制重新渲染文件树
        if (typeof renderFileTreeViewport === 'function') {
          renderFileTreeViewport(true);
        } else if (typeof renderFileTree === 'function') {
          renderFileTree();
        }

        // 触发布局更新
        if (typeof updateLayout === 'function') {
          updateLayout();
        }
        if (typeof updateButtonPosition === 'function') {
          updateButtonPosition();
        }

        console.log('[Everything Search UI] 文件树已设置为可见');
      }
    },

    /**
     * 执行搜索
     */
    async performSearch() {
      const query = this.searchInput.value.trim();
      if (!query) {
        this.showStatus('请输入搜索关键词', 'warning');
        return;
      }

      if (this.isSearching) {
        console.log('[Everything Search] 正在搜索中，忽略请求');
        return;
      }

      this.isSearching = true;
      this.showStatus('正在搜索...', 'info');
      this.showResults();

      try {
        // 🔧 使用 Everything CLI (es.exe) 搜索
        const results = await window.App.EverythingCLI.searchLogFiles(query);

        if (results.length === 0) {
          this.showStatus('未找到匹配的文件', 'warning');
          this.listEl.innerHTML = '<div class="everything-no-results">无结果</div>';
          return;
        }

        // 显示结果
        this.displayResults(results);
        this.showStatus(`找到 ${results.length} 个文件`, 'success');

      } catch (error) {
        console.error('[Everything Search] 搜索失败:', error);
        this.showStatus(`搜索失败: ${error.message}`, 'error');
      } finally {
        this.isSearching = false;
      }
    },

    /**
     * 显示搜索结果
     */
    displayResults(results) {
      this.listEl.innerHTML = '';

      results.forEach((file, index) => {
        // 🔧 处理 es.exe 返回的数据格式
        const normalizedFile = this.normalizeEsFile(file);

        // 检测文件类型（目录路径以 \ 结尾）
        const fileType = this.detectFileType(normalizedFile.fullPath);

        const item = document.createElement('div');
        item.className = 'everything-search-result-item';
        item.draggable = true;  // 🔧 启用拖拽
        item.dataset.fileType = fileType;
        item.dataset.fullPath = normalizedFile.fullPath;
        item.dataset.fileName = normalizedFile.name;
        item.dataset.filePath = normalizedFile.path;
        item.dataset.fileSize = normalizedFile.size;
        item.innerHTML = `
          <div class="everything-result-icon">${this.getFileIcon(normalizedFile, fileType)}</div>
          <div class="everything-result-info">
            <div class="everything-result-name" title="${normalizedFile.fullPath}">${normalizedFile.name}</div>
            <div class="everything-result-path">${this.truncatePath(normalizedFile.path, 50)}</div>
            <div class="everything-result-meta">
              ${this.formatSize(normalizedFile.size)} • ${this.formatDate(normalizedFile.dateModified)}
              <span class="everything-drag-hint">• 拖拽到文件树</span>
            </div>
          </div>
        `;

        // 🔧 拖拽开始事件
        item.addEventListener('dragstart', (e) => {
          this.handleDragStart(e, normalizedFile, fileType);
        });

        // 🔧 拖拽结束事件
        item.addEventListener('dragend', (e) => {
          this.handleDragEnd(e);
        });

        // 🔧 左键点击：阻止任何操作
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('[Everything Search] 左键点击被忽略');
        });

        // 🔧 右键菜单：打开文件路径
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.showContextMenu(e, normalizedFile);
        });

        this.listEl.appendChild(item);
      });
    },

    /**
     * 显示右键菜单
     */
    showContextMenu(e, file) {
      // 移除已存在的菜单
      const existingMenu = document.querySelector('.everything-context-menu');
      if (existingMenu) {
        existingMenu.remove();
      }

      // 创建右键菜单
      const menu = document.createElement('div');
      menu.className = 'everything-context-menu';
      menu.innerHTML = `
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
        menuEvent.stopPropagation(); // 阻止事件冒泡
        const action = menuEvent.target.closest('.everything-context-menu-item')?.dataset.action;
        if (action === 'open-path') {
          this.openFilePath(file.fullPath);
        }
        menu.remove();
      });

      // 点击其他地方关闭菜单
      setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }, { once: true });
      }, 0);
    },

    /**
     * 打开文件路径
     */
    async openFilePath(filePath) {
      console.log('[Everything Search] 打开文件路径:', filePath);

      try {
        if (window.electronAPI && window.electronAPI.openPath) {
          // 只打开路径（选中文件，不打开文件本身）
          const result = await window.electronAPI.openPath(filePath);
          if (result && !result.success) {
            throw new Error(result.error || '打开路径失败');
          }
          // 🔧 不显示成功消息，静默完成
          console.log('[Everything Search] ✅ 已在资源管理器中选中文件');
        } else {
          throw new Error('Electron API 不可用');
        }
      } catch (error) {
        console.error('[Everything Search] ❌ 打开文件路径失败:', error);
        if (typeof showMessage === 'function') {
          showMessage(`打开路径失败: ${error.message}`);
        }
      }
    },

    /**
     * 处理拖拽开始
     */
    handleDragStart(e, file, fileType) {
      console.log('[Everything Search] 开始拖拽:', file);

      // 设置拖拽数据
      const dragData = JSON.stringify({
        type: fileType,
        fullPath: file.fullPath,
        name: file.name,
        path: file.path,
        size: file.size,
        source: 'everything-search'
      });

      e.dataTransfer.setData('application/json', dragData);
      e.dataTransfer.setData('text/plain', file.name);
      e.dataTransfer.effectAllowed = 'copy';

      // 设置拖拽图像（可选）
      const dragImage = e.target.cloneNode(true);
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);
      setTimeout(() => document.body.removeChild(dragImage), 0);
    },

    /**
     * 处理拖拽结束
     */
    handleDragEnd(e) {
      console.log('[Everything Search] 拖拽结束');
      // 清理任何拖拽相关的状态
      e.target.style.opacity = '1';
    },

    /**
     * 规范化 es.exe 返回的文件数据
     * es.exe 返回: {filename: "C:\\path\\file.ext", size: 123, date_modified: 134131200155664193}
     * 转换为: {name, path, fullPath, size, dateModified}
     */
    normalizeEsFile(esFile) {
      // 获取完整路径
      const fullPath = esFile.filename || esFile.fullPath || '';

      // 提取路径和文件名
      let path = '';
      let name = fullPath;

      if (fullPath) {
        // 查找最后一个路径分隔符
        const lastSepIndex = fullPath.lastIndexOf('\\');
        if (lastSepIndex === -1) {
          // 如果没有反斜杠，尝试正斜杠
          const lastFwdSepIndex = fullPath.lastIndexOf('/');
          if (lastFwdSepIndex !== -1) {
            path = fullPath.substring(0, lastFwdSepIndex);
            name = fullPath.substring(lastFwdSepIndex + 1);
          }
        } else {
          path = fullPath.substring(0, lastSepIndex);
          name = fullPath.substring(lastSepIndex + 1);
        }
      }

      // 🔧 转换 Windows FILETIME 为 JavaScript 时间戳
      // FILETIME 是从 1601-01-01 开始的 100 纳秒间隔数
      // JavaScript Date 是从 1970-01-01 开始的毫秒数
      let dateModified = Date.now();
      if (esFile.date_modified) {
        // FILETIME 转 Unix 时间戳（毫秒）
        // 公式: (filetime - 116444736000000000) / 10000
        const filetime = BigInt(esFile.date_modified);
        const epochDiff = BigInt(116444736000000000);
        const unixTimeMs = Number((filetime - epochDiff) / BigInt(10000));
        dateModified = unixTimeMs;
      }

      return {
        name: name,
        path: path,
        fullPath: fullPath,
        size: esFile.size || 0,
        dateModified: dateModified
      };
    },

    /**
     * 检测文件类型
     * @returns {string} 'archive' | 'directory' | 'file'
     */
    detectFileType(filePath) {
      // 🔧 es.exe 返回的目录路径以 \ 结尾
      if (filePath.endsWith('\\') || filePath.endsWith('/')) {
        return 'directory';
      }

      // 获取文件扩展名
      const ext = filePath.split('.').pop().toLowerCase();

      // 常见压缩包格式
      const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'cab', 'iso', 'wim'];
      if (archiveExtensions.includes(ext)) {
        return 'archive';
      }

      // 默认是普通文件
      return 'file';
    },

    /**
     * 加载普通文件到主日志查看器
     */
    async loadRegularFile(filePath, fileName) {
      console.log('[Everything Search] 加载文件:', filePath);

      try {
        if (window.electronAPI && window.electronAPI.readFile) {
          const result = await window.electronAPI.readFile(filePath);

          if (result && result.success) {
            // 清空当前内容
            if (typeof cleanLogData === 'function') {
              cleanLogData();
            }

            // 处理文件内容
            if (typeof processFileContent === 'function') {
              processFileContent(result.content, fileName, filePath, null);
            }

            // 重新渲染
            if (typeof resetFilter === 'function') {
              resetFilter(false);
            }
            if (typeof renderLogLines === 'function') {
              renderLogLines();
            }

            if (typeof showMessage === 'function') {
              showMessage(`已加载: ${fileName}`);
            }

            console.log('[Everything Search] ✅ 文件加载成功');
          } else {
            throw new Error(result?.error || '读取文件失败');
          }
        } else {
          throw new Error('Electron API 不可用');
        }

      } catch (error) {
        console.error('[Everything Search] ❌ 加载文件失败:', error);
        if (typeof showMessage === 'function') {
          showMessage(`加载失败: ${error.message}`);
        }
        throw error;
      }
    },

    /**
     * 显示状态消息
     */
    showStatus(message, type = 'info') {
      this.statusEl.textContent = message;
      this.statusEl.className = `everything-search-status everything-status-${type}`;
    },

    /**
     * 显示/隐藏结果容器
     */
    showResults() {
      this.resultsContainer.style.display = 'block';
    },

    hideResults() {
      this.resultsContainer.style.display = 'none';
    },

    /**
     * 测试 Everything 连接
     */
    async testConnection() {
      const isConnected = await window.App.EverythingCLI.testConnection();
      if (isConnected) {
        this.searchInput.placeholder = 'Everything 快速搜索 (支持通配符 *) ✓';
        console.log('[Everything Search UI] Everything CLI 连接正常');
      } else {
        this.searchInput.placeholder = 'Everything CLI 未就绪，请检查 es.exe';
        console.warn('[Everything Search UI] Everything CLI 连接失败');
      }
    },

    /**
     * 辅助方法：获取文件图标
     * @param {Object} file - 文件对象
     * @param {string} fileType - 文件类型 (archive/directory/file)
     * @param {boolean} isNested - 是否为嵌套项（压缩包内的文件）
     */
    getFileIcon(file, fileType = 'file', isNested = false) {
      // 处理文件夹和压缩包
      if (fileType === 'directory') {
        return '📁';
      }
      if (fileType === 'archive') {
        return isNested ? '📦' : '🗜️';
      }

      // 普通文件图标映射
      const iconMap = {
        'log': '📄',
        'txt': '📝',
        'out': '📤',
        'err': '❌',
        'debug': '🐛',
        'trace': '🔍',
        'json': '📋',
        'xml': '📋',
        'csv': '📊',
        'zip': '🗜️',
        'rar': '🗜️',
        '7z': '🗜️',
        'tar': '🗜️',
        'gz': '🗜️'
      };

      const ext = file.name.split('.').pop().toLowerCase();
      return iconMap[ext] || '📄';
    },

    /**
     * 辅助方法：截断路径
     */
    truncatePath(path, maxLength) {
      if (path.length <= maxLength) return path;
      return '...' + path.slice(-(maxLength - 3));
    },

    /**
     * 辅助方法：格式化文件大小
     */
    formatSize(bytes) {
      if (!bytes || bytes === 0) return '未知大小';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    /**
     * 辅助方法：格式化日期
     */
    formatDate(timestamp) {
      if (!timestamp) return '未知时间';
      const date = new Date(timestamp);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  // CSS 样式
  const style = document.createElement('style');
  style.textContent = `
    .everything-search-container {
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      padding: 8px;
      border-radius: 8px;
      margin: 8px;
    }

    .everything-search-header {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .everything-search-input {
      flex: 1;
      width: 100%;
      padding: 6px 10px;
      border: 1px solid rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      font-size: 13px;
      background: white;
      outline: none;
      transition: border-color 0.2s;
    }

    .everything-search-input:focus {
      border-color: #667eea;
      box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
    }

    .everything-search-results {
      margin-top: 8px;
      max-height: 300px;
      overflow-y: auto;
      background: white;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .everything-search-status {
      padding: 6px 10px;
      font-size: 12px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    }

    .everything-status-success {
      color: #34c759;
      background: rgba(52, 199, 89, 0.1);
    }

    .everything-status-warning {
      color: #ff9500;
      background: rgba(255, 149, 0, 0.1);
    }

    .everything-status-error {
      color: #ff3b30;
      background: rgba(255, 59, 48, 0.1);
    }

    .everything-status-info {
      color: #007aff;
      background: rgba(0, 122, 255, 0.1);
    }

    .everything-search-list {
      max-height: 250px;
      overflow-y: auto;
    }

    .everything-search-result-item {
      display: flex;
      gap: 10px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      cursor: grab;
      transition: background 0.2s;
      align-items: center;
      user-select: none;
    }

    .everything-search-result-item:active {
      cursor: grabbing;
    }

    .everything-search-result-item:hover {
      background: rgba(102, 126, 234, 0.1);
    }

    .everything-drag-hint {
      color: #667eea;
      font-weight: 500;
      font-size: 9px;
    }

    .everything-result-icon {
      font-size: 20px;
      flex-shrink: 0;
    }

    .everything-result-info {
      flex: 1;
      min-width: 0;
    }

    .everything-result-name {
      font-size: 13px;
      font-weight: 500;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .everything-result-path {
      font-size: 11px;
      color: #666;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .everything-result-meta {
      font-size: 10px;
      color: #999;
      margin-top: 2px;
    }

    .everything-no-results {
      padding: 20px;
      text-align: center;
      color: #999;
      font-size: 13px;
    }

    /* 文件树拖放高亮 */
    #fileTreeContainer.everything-drag-over {
      background: rgba(102, 126, 234, 0.1) !important;
      border: 2px dashed #667eea !important;
      box-shadow: inset 0 0 20px rgba(102, 126, 234, 0.2);
    }

    /* 拖拽时的样式 */
    .everything-search-result-item[draggable="true"] {
      cursor: grab;
    }

    .everything-search-result-item[draggable="true"]:active {
      cursor: grabbing;
    }

    /* 右键菜单样式 */
    .everything-context-menu {
      position: fixed;
      background: white;
      border: 1px solid rgba(0, 0, 0, 0.15);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 4px 0;
      min-width: 150px;
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
    }

    .everything-context-menu-item .menu-text {
      color: #333;
    }
  `;

  document.head.appendChild(style);

  // 自动初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.App.EverythingSearchUI.init();
    });
  } else {
    window.App.EverythingSearchUI.init();
  }

  console.log('✓ Everything Search UI module loaded');
})();
