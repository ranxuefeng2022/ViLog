
      // 全局变量用于解决拖拽/点击冲突
      let hasFileTreeDragged = false;
      let currentLoadingSession = 0;

      // 字体缩放相关变量
      let logFontSize = 14; // 日志框字体大小（px）
      let filterFontSize = 14; // 过滤框字体大小（px）
      let filteredLogFontSize = 14; // 过滤结果框字体大小（px）
      const MIN_FONT_SIZE = 10; // 最小字体大小
      const MAX_FONT_SIZE = 36; // 最大字体大小
      const FONT_SIZE_STEP = 1; // 每次滚轮缩放的步长

      // 全局错误处理 - 防止崩溃
      (function() {
        // 捕获全局JavaScript错误
        window.addEventListener('error', function(event) {
          console.error('全局错误捕获:', event.error || event.message, event);
          // 如果是拖拽相关的错误，显示友好提示
          if (event.message && (
            event.message.includes('drag') || 
            event.message.includes('drop') || 
            event.message.includes('File') ||
            event.message.includes('Directory')
          )) {
            if (typeof showMessage === 'function') {
              //showMessage(`处理拖拽时出错: ${event.message}. 请尝试重新拖拽文件。`);
            }
          }
          // 阻止默认的错误处理（避免浏览器显示错误页面）
          event.preventDefault();
          return false;
        }, true);

        // 捕获未处理的Promise rejection
        window.addEventListener('unhandledrejection', function(event) {
          console.error('未处理的Promise rejection:', event.reason);
          // 如果是拖拽相关的错误，显示友好提示
          if (event.reason && (
            (typeof event.reason === 'string' && (
              event.reason.includes('drag') || 
              event.reason.includes('drop') || 
              event.reason.includes('File')
            )) ||
            (event.reason.message && (
              event.reason.message.includes('drag') || 
              event.reason.message.includes('drop') || 
              event.reason.message.includes('File')
            ))
          )) {
            if (typeof showMessage === 'function') {
              const errorMsg = event.reason?.message || event.reason || '未知错误';
              showMessage(`处理拖拽时出错: ${errorMsg}. 请尝试重新拖拽文件。`);
            }
          }
          // 阻止默认的错误处理
          event.preventDefault();
        });
      })();

      const demo = `----LOG BEGIN----

----LOG END----`;

      // 自定义高亮数组
      const customHighlights = [];

      // 默认高亮规则
      const defaultHighlights = [
        // { keyword: 'battery', color: '#ff0000' },
        //{ keyword: 'charge', color: '#00ff00' }
      ];

      // 🚀 性能优化：HTML解析结果缓存
      // 使用 Map 插入顺序实现 O(1) LRU 淘汰（re-insert 访问项）
      const htmlParseCache = new Map();
      const MAX_CACHE_SIZE = 200;

      function getCachedHtml(text, cacheKey) {
        const key = `${cacheKey}:${text.slice(0, 100)}`;
        if (htmlParseCache.has(key)) {
          // LRU: re-insert 移到最新位置（O(1)）
          const value = htmlParseCache.get(key);
          htmlParseCache.delete(key);
          htmlParseCache.set(key, value);
          return value;
        }
        return null;
      }

      function setCachedHtml(text, cacheKey, html) {
        const key = `${cacheKey}:${text.slice(0, 100)}`;
        if (htmlParseCache.size >= MAX_CACHE_SIZE && !htmlParseCache.has(key)) {
          // 淘汰最早插入的项（Map 迭代器按插入顺序）
          const oldestKey = htmlParseCache.keys().next().value;
          htmlParseCache.delete(oldestKey);
        }
        htmlParseCache.set(key, html);
      }

      function clearHtmlParseCache() {
        htmlParseCache.clear();
      }

      /**
       * 🚀 内存管理：监控内存使用，检查是否可以加载新文件
       * 在加载新文件前调用，返回 false 表示不能加载
       * @param {number} newLinesCount - 新文件的行数
       * @returns {boolean} 是否可以加载
       */
      function canLoadMoreContent(newLinesCount = 0) {
        // 统一 2GB 上限（虚拟滚动下 DOM 开销极小）
        const MAX_MEMORY_MB = 2000;
        const WARNING_MEMORY_MB = MAX_MEMORY_MB * 0.6; // 60% 时开始清理缓存

        // 🚀 更精确的内存估算：
        // V8 字符串：短字符串（< 12 字节）~32 字节开销，长字符串 ~16 字节开销 + 2 bytes/char
        // 数组：每个槽位 ~8 字节指针
        // 保守估算每行平均 500 字节（含 V8 对象开销、数组指针、潜在缓存等）
        const BYTES_PER_LINE = 500;
        const estimatedMemoryBytes = (originalLines.length + newLinesCount) * BYTES_PER_LINE;
        const estimatedMemoryMB = estimatedMemoryBytes / (1024 * 1024);
        const currentMemoryMB = (originalLines.length * BYTES_PER_LINE) / (1024 * 1024);

        // 清理 HTML 缓存以释放内存
        if (currentMemoryMB > WARNING_MEMORY_MB) {
          console.log(`[MemoryManager] 估算内存使用: ${currentMemoryMB.toFixed(1)}MB，清理HTML缓存`);
          clearHtmlParseCache();
        }

        // 检查是否超过上限
        if (estimatedMemoryMB > MAX_MEMORY_MB) {
          console.warn(`[MemoryManager] 内存已满：${currentMemoryMB.toFixed(1)}MB / ${MAX_MEMORY_MB}MB，拒绝加载新文件 (${newLinesCount.toLocaleString()} 行)`);
          return false;
        }

        // 接近上限时警告
        if (estimatedMemoryMB > MAX_MEMORY_MB * 0.9) {
          console.warn(`[MemoryManager] 接近上限：${estimatedMemoryMB.toFixed(1)}MB / ${MAX_MEMORY_MB}MB`);
        }

        return true;
      }

      // no-op stub — memory mode removed, but legacy code still calls this
      window.showMemoryModeStats = function () {};

      const inner = document.getElementById("innerContainer");
      const outer = document.getElementById("outerContainer");
      const filterBox = document.getElementById("filterBox");
      const fileInfo = document.getElementById("fileInfo");
      const progressBar = document.getElementById("progressBar");
      const progressFill = document.getElementById("progressFill");
      const fileCount = document.getElementById("fileCount");
      const searchStatus = document.getElementById("searchStatus");
      const shortcutHint = document.getElementById("shortcutHint");

      // 文件树相关元素
      const fileTreeContainer = document.getElementById("fileTreeContainer");
      const fileTreeResizer = document.getElementById("fileTreeResizer");
      const fileTreeSearch = document.getElementById("fileTreeSearch");
      const fileTreePathInput = document.getElementById("fileTreePathInput");
      const fileTreePathLoadBtn = document.getElementById("fileTreePathLoadBtn");
      const fileTreeList = document.getElementById("fileTreeList");
      const fileTreeCount = document.getElementById("fileTreeCount");
      const fileTreeCollapseBtn = document.getElementById(
        "fileTreeCollapseBtn"
      );
      const fileTreeFloatingOverlay = document.getElementById(
        "fileTreeFloatingOverlay"
      );
      const fileTreeContextMenu = document.getElementById("fileTreeContextMenu");
      const fileTreeCtxCopyName = document.getElementById("fileTreeCtxCopyName");
      const fileTreeCtxDeleteFile = document.getElementById("fileTreeCtxDeleteFile");
      const fileTreeCtxRefresh = document.getElementById("fileTreeCtxRefresh");
      const fileTreeCtxExtractArchive = document.getElementById("fileTreeCtxExtractArchive");
      const fileTreeCtxExportCsv = document.getElementById("fileTreeCtxExportCsv");
      const fileTreeCtxRemoveFrequent = document.getElementById("fileTreeCtxRemoveFrequent");
      const fileTreeCtxToggleStar = document.getElementById("fileTreeCtxToggleStar");
      const fileTreeCtxFilterSubtree = document.getElementById("fileTreeCtxFilterSubtree");
      const fileTreeSubtreeFilterDialog = document.getElementById("fileTreeSubtreeFilterDialog");
      const subtreeFilterTitle = document.getElementById("subtreeFilterTitle");
      const subtreeFilterClose = document.getElementById("subtreeFilterClose");
      const subtreeFilterInput = document.getElementById("subtreeFilterInput");
      const subtreeFilterMatchCount = document.getElementById("subtreeFilterMatchCount");
      const fileTreeTabBar = document.getElementById("fileTreeTabBar");
      const importFileInput = document.getElementById("importFileInput");
      const importFolderInput = document.getElementById("importFolderInput");
      const lineFileHoverTip = document.getElementById("lineFileHoverTip");

      // 日志内容框右键菜单相关元素
      const logContextMenu = document.getElementById("logContextMenu");
      const logContextMenuTitle = document.getElementById("logContextMenuTitle");
      const logCtxRefreshOpenFiles = document.getElementById("logCtxRefreshOpenFiles");
      const logCtxFileInfo = document.getElementById("logCtxFileInfo");
      const logCtxFileName = document.getElementById("logCtxFileName");
      const logCtxImportFile = document.getElementById("logCtxImportFile");
      const logCtxImportFolder = document.getElementById("logCtxImportFolder");
      const logCtxImportArchive = document.getElementById("logCtxImportArchive");
      const logCtxOpenTerminal = document.getElementById("logCtxOpenTerminal");
      const importArchiveInput = document.getElementById("importArchiveInput");
      let logContextMenuSelectedText = "";
      let logContextMenuLineIndex = -1;
      let logContextMenuFilePath = "";
      let logContextMenuLineContent = "";

      // 悬浮过滤内容框相关元素
      const filteredPanel = document.getElementById("filteredPanel");
      const filteredPanelContent = document.getElementById(
        "filteredPanelContent"
      );
      const filteredPanelHeader = document.getElementById(
        "filteredPanelHeader"
      );
      const filteredPanelClose = document.getElementById("filteredPanelClose");
      const filteredCount = document.getElementById("filteredCount");
      const filteredPanelPlaceholder = document.getElementById(
        "filteredPanelPlaceholder"
      );
      const filteredPanelVirtualContent = document.getElementById(
        "filteredPanelVirtualContent"
      );

      // 过滤结果框搜索相关元素
      const filteredPanelSearchBox = document.getElementById(
        "filteredPanelSearchBox"
      );
      const filteredPanelSearchSuggestions = document.getElementById(
        "filteredPanelSearchSuggestions"
      );
      const filteredPanelSearchStatus = document.getElementById(
        "filteredPanelSearchStatus"
      );
      const filteredPanelPrevBtn = document.getElementById(
        "filteredPanelPrevBtn"
      );
      const filteredPanelNextBtn = document.getElementById(
        "filteredPanelNextBtn"
      );

      // 新增：二级过滤相关元素
      const filteredPanelFilterBox = document.getElementById(
        "filteredPanelFilterBox"
      );
      const filteredPanelFilterBtn = document.getElementById(
        "filteredPanelFilterBtn"
      );
      const filteredPanelClearFilterBtn = document.getElementById(
        "filteredPanelClearFilterBtn"
      );
      const filteredPanelFilterStatus = document.getElementById(
        "filteredPanelFilterStatus"
      );
      const filteredPanelRegexStatus = document.getElementById(
        "filteredPanelRegexStatus"
      );
      const secondaryFilterStatus = document.getElementById(
        "secondaryFilterStatus"
      );

      // 二级过滤右侧边栏相关元素
      const secondaryFilterSidebar = document.getElementById(
        "secondaryFilterSidebar"
      );
      const secondaryFilterSidebarHeader = document.getElementById(
        "secondaryFilterSidebarHeader"
      );
      const secondaryFilterSidebarContent = document.getElementById(
        "secondaryFilterSidebarContent"
      );
      const secondaryFilterSidebarPlaceholder = document.getElementById(
        "secondaryFilterSidebarPlaceholder"
      );
      const secondaryFilterSidebarVirtualContent = document.getElementById(
        "secondaryFilterSidebarVirtualContent"
      );
      const secondaryFilterCount = document.getElementById("secondaryFilterCount");
      const secondaryFilterSidebarClose = document.getElementById(
        "secondaryFilterSidebarClose"
      );


      // 过滤自动建议下拉菜单
      const filterSuggestions = document.getElementById("filterSuggestions");

      // 过滤关键词高亮颜色类名
      const filterHighlightClasses = [
        "filter-highlight-0",
        "filter-highlight-1",
        "filter-highlight-2",
        "filter-highlight-3",
        "filter-highlight-4",
        "filter-highlight-5",
        "filter-highlight-6",
        "filter-highlight-7",
        "filter-highlight-8",
        "filter-highlight-9",
        "filter-highlight-10",
        "filter-highlight-11",
        "filter-highlight-12",
        "filter-highlight-13",
        "filter-highlight-14",
        "filter-highlight-15",
        "filter-highlight-16",
        "filter-highlight-17",
        "filter-highlight-18",
        "filter-highlight-19",
      ];

      // 二级过滤关键词高亮颜色类名
      const secondaryFilterHighlightClasses = [
        "secondary-filter-highlight-0",
        "secondary-filter-highlight-1",
        "secondary-filter-highlight-2",
        "secondary-filter-highlight-3",
        "secondary-filter-highlight-4",
        "secondary-filter-highlight-5",
        "secondary-filter-highlight-6",
        "secondary-filter-highlight-7",
        "secondary-filter-highlight-8",
        "secondary-filter-highlight-9",
        "secondary-filter-highlight-10",
        "secondary-filter-highlight-11",
        "secondary-filter-highlight-12",
        "secondary-filter-highlight-13",
        "secondary-filter-highlight-14",
        "secondary-filter-highlight-15",
        "secondary-filter-highlight-16",
        "secondary-filter-highlight-17",
        "secondary-filter-highlight-18",
        "secondary-filter-highlight-19",
      ];

      // 一级过滤状态
      let currentFilter = {
        filteredLines: [],
        filteredToOriginalIndex: [],
        filterKeywords: [],
        totalLines: 0,
      };

      // 性能优化：过滤缓存
      let lastFilterCacheKey = "";   // 上次过滤的缓存键

      // 性能优化：防抖定时器
      let filterDebounceTimer = null;
      let secondaryFilterDebounceTimer = null;
      const FILTER_DEBOUNCE_DELAY = 300; // 防抖延迟（毫秒）

      // 新增：二级过滤状态
      let secondaryFilter = {
        isActive: false,
        filterText: "",
        filterKeywords: [], // 修改：存储多个关键词
        filteredLines: [],
        filteredToOriginalIndex: [],
        filteredToPrimaryIndex: [], // 映射到一级过滤结果的索引
      };

      let originalLines = [];
      let fileHeaders = [];
      let isFullscreen = false;
      let isFiltering = false;
      let currentFiles = [];

      // 当前选中的原始日志行（用于书签/快捷操作）
      let selectedOriginalIndex = -1;

      let searchKeyword = "";
      let searchMatches = [];
      let currentMatchIndex = -1;
      let totalMatchCount = 0;
      const searchBox = document.getElementById("searchBox");
      const prevBtn = document.getElementById("prevBtn");
      const nextBtn = document.getElementById("nextBtn");

      // 过滤结果框搜索相关变量
      let filteredPanelSearchKeyword = "";
      let filteredPanelSearchMatches = [];
      let filteredPanelCurrentMatchIndex = -1;
      let filteredPanelTotalMatchCount = 0;

      let visibleStart = 0;
      let visibleEnd = 0;
      let lineHeight = 19; // 🚀 修复：与CSS .log-line height一致（CSS默认是19px）

      // ========== 超大文件高度限制 ==========
      // Chromium 对 DOM 元素高度有限制（约 33,554,432px = 2^25）
      // 超过此限制会导致渲染进程崩溃（黑屏）
      const MAX_DOM_HEIGHT = 33554432; // 2^25 px，Chromium 安全上限
      let virtualScrollScale = 1; // 缩放比例，当总高度超过限制时 > 1
      let virtualTotalHeight = 0; // 虚拟总高度（经过缩放限制后的实际 DOM 高度）

      /**
       * 计算安全的 placeholder 高度和缩放比例
       * 当 totalLines * lineHeight > MAX_DOM_HEIGHT 时，使用压缩高度
       * @param {number} totalLines - 总行数
       * @returns {{ height: number, scale: number }} - 安全高度和缩放比例
       */
      function computeSafeScrollHeight(totalLines) {
        const naturalHeight = totalLines * lineHeight;
        if (naturalHeight <= MAX_DOM_HEIGHT) {
          virtualScrollScale = 1;
          virtualTotalHeight = naturalHeight;
          window.virtualScrollScale = 1;
          return { height: naturalHeight, scale: 1 };
        }
        // 压缩到安全高度内，scale > 1 表示 1px 对应多行
        virtualScrollScale = naturalHeight / MAX_DOM_HEIGHT;
        virtualTotalHeight = MAX_DOM_HEIGHT;
        window.virtualScrollScale = virtualScrollScale;
        return { height: MAX_DOM_HEIGHT, scale: virtualScrollScale };
      }

      /**
       * 将实际行号转换为虚拟滚动位置（考虑缩放）
       * @param {number} lineIndex - 行索引
       * @returns {number} - scrollTop 像素值
       */
      function lineToScrollTop(lineIndex) {
        return Math.floor(lineIndex * lineHeight / virtualScrollScale);
      }

      /**
       * 将 scrollTop 像素值转换为行号（考虑缩放）
       * @param {number} scrollTop - 滚动像素位置
       * @returns {number} - 行索引
       */
      function scrollTopToLine(scrollTop) {
        return Math.floor(scrollTop * virtualScrollScale / lineHeight);
      }

      // ========== 虚拟滚动优化：自适应缓冲区 ==========
      // 根据屏幕高度动态计算缓冲区大小，优化性能和流畅度
      let bufferSize = 100; // 默认值
      function updateBufferSize() {
        const screenVisibleLines = Math.ceil(outer.clientHeight / lineHeight);
        // 🚀 优化：原生滚动环境下，缓冲区设置为可见区域的150%
        // 确保上下各有一屏半的缓冲，提供更流畅的滚动体验
        // 🚀 性能优化：增加到2.5倍，减少快速滚动时的白屏
        bufferSize = Math.max(150, Math.min(500, Math.floor(screenVisibleLines * 2.5)));
      }

      let lastVisibleStart = -1;
      let lastVisibleEnd = -1;
      let scrollDebounceTimer = null;

      // ========== 虚拟滚动优化：快速跳转功能 ==========
      let smoothScrollRafId = null;

      /**
       * 平滑滚动到指定行
       * @param {number} lineNumber - 目标行号（从0开始）
       * @param {string} position - 'start' | 'center' | 'end' 滚动位置
       */
      function jumpToLine(lineNumber, position = 'center') {
        if (lineNumber < 0 || lineNumber >= originalLines.length) return;

        // 取消正在进行的平滑滚动
        if (smoothScrollRafId) {
          cancelAnimationFrame(smoothScrollRafId);
        }

        // 🚀 修复黑屏：使用缩放感知的滚动位置计算
        const targetScrollTop = lineToScrollTop(lineNumber);
        const clientHeight = outer.clientHeight;
        let finalScrollTop = targetScrollTop;

        // 根据position调整目标位置
        if (position === 'center') {
          finalScrollTop = targetScrollTop - clientHeight / 2 + lineHeight / 2;
        } else if (position === 'end') {
          finalScrollTop = targetScrollTop - clientHeight + lineHeight;
        } else if (position === 'start') {
          finalScrollTop = targetScrollTop;
        }

        // 边界检查
        finalScrollTop = Math.max(0, Math.min(finalScrollTop, outer.scrollHeight - clientHeight));

        // 平滑滚动动画
        const startScrollTop = outer.scrollTop;
        const distance = finalScrollTop - startScrollTop;
        const duration = 300; // 动画时长（毫秒）
        const startTime = performance.now();

        function animateScroll(currentTime) {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);

          // 缓动函数：easeInOutCubic
          const ease = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

          outer.scrollTop = startScrollTop + distance * ease;

          if (progress < 1) {
            smoothScrollRafId = requestAnimationFrame(animateScroll);
          } else {
            // 滚动完成，确保目标行被选中
            selectLine(lineNumber);
          }
        }

        smoothScrollRafId = requestAnimationFrame(animateScroll);
      }

      /**
       * 快速滚动到顶部
       */
      function scrollToTop(animate = true) {
        if (animate) {
          jumpToLine(0, 'start');
        } else {
          outer.scrollTop = 0;
        }
      }

      /**
       * 快速滚动到底部
       */
      function scrollToBottom(animate = true) {
        if (animate) {
          jumpToLine(originalLines.length - 1, 'end');
        } else {
          outer.scrollTop = outer.scrollHeight;
        }
      }

      /**
       * 滚动到选中行
       */
      function scrollToSelectedLine() {
        if (selectedOriginalIndex >= 0) {
          jumpToLine(selectedOriginalIndex, 'center');
        }
      }

      const MAX_FILES = 5000;
      const MAX_TOTAL_SIZE = 10000 * 1024 * 1024;
      const BATCH_SIZE = 5;

      // 压缩包相关配置
      const LARGE_ARCHIVE_THRESHOLD = 100 * 1024 * 1024; // 100MB - 大压缩包阈值
      const LARGE_ARCHIVE_FILE_COUNT = 1000; // 文件数量阈值，超过此值使用异步处理
      const ARCHIVE_PROCESSING_WARNING = 500 * 1024 * 1024; // 500MB - 显示警告

      // 文件树相关变量
      let fileTreeData = [];
      let selectedFiles = [];
      let lastLoadedSelectionKeys = ''; // 🚀 上次 loadSelectedFiles 时的选中快照，避免重复加载
      let selectionOrderCounter = 0; // 🚀 文件选择顺序计数器，确保按点击顺序加载
      let isDragging = false;
      let dragStartIndex = -1;
      let fileLoadDebounceTimer = null; // 🔧 文件加载防抖定时器
      let dragEndIndex = -1;
      let isFileTreeResizing = false;
      // 文件树右键菜单状态
      let fileTreeContextMenuIndex = -1;

      // 文件树层次结构数据
      let fileTreeHierarchy = [];

      // 🔧 压缩包节点查找缓存（避免 O(N) findIndex）
      let _archiveNodeCache = null;
      let _archiveNodeCacheLen = -1;

      function findArchiveNodeIndex(archiveName) {
        const len = fileTreeHierarchy.length;
        if (!_archiveNodeCache || _archiveNodeCacheLen !== len) {
          _archiveNodeCache = new Map();
          for (let i = 0; i < len; i++) {
            const item = fileTreeHierarchy[i];
            if (!item) continue;
            // 只索引真正的压缩包节点（排除 isArchiveChild 的子节点）
            const isRealArchive = item.isArchive || item._archiveFiles || item._zipObject || item.type === 'archive';
            if (!isRealArchive) continue;
            if (item.archiveName != null) _archiveNodeCache.set(item.archiveName, i);
            if (item.path != null && item.path !== item.archiveName) _archiveNodeCache.set(item.path, i);
          }
          _archiveNodeCacheLen = len;
        }
        const idx = _archiveNodeCache.get(archiveName);
        if (idx !== undefined) {
          const item = fileTreeHierarchy[idx];
          if (item && (item.archiveName === archiveName || item.path === archiveName)) {
            return idx;
          }
          _archiveNodeCache = null;
        }
        // 回退：只扫描压缩包节点
        for (let i = 0; i < fileTreeHierarchy.length; i++) {
          const item = fileTreeHierarchy[i];
          if (item && (item.isArchive || item._archiveFiles || item._zipObject || item.type === 'archive')) {
            if (item.archiveName === archiveName || item.path === archiveName) return i;
          }
        }
        return -1;
      }

      // 🔧 盘符节点常驻（从 fileTreeHierarchy 中分离管理）
      let persistentDriveNodes = [];
      
      // 压缩包相关变量
      let archiveData = new Map(); // 存储解压后的压缩包数据 archiveName -> {zip: JSZip, structure: Object}
      let expandedArchives = new Set(); // 已展开的压缩包名称集合
      let archiveMultiSelectedFiles = new Set(); // 多选的文件路径集合
      
      // 文件树搜索状态
      let fileTreeSearchTerm = "";
      let fileTreeActiveTab = "__local_drives__";
      // 文件树搜索匹配项索引列表（用于高亮显示）
      let fileTreeMatchedIndices = [];
      // 文件树搜索只显示匹配项模式（按Enter后启用）
      let fileTreeSearchShowOnlyMatches = false;
      // 记录上次 Enter 触发过滤时的搜索词（用于二次 Enter 全选）
      let fileTreeLastEnterSearchTerm = "";
      // 搜索跳转导航：当前高亮索引位置
      let fileTreeSearchNavIndex = -1;
      // 🚀 标志：记录文件树是否因过滤面板显示而被自动隐藏
      let fileTreeWasHiddenByFilter = false;

      // 子树过滤状态
      let subtreeFilterRootIndex = -1;
      let subtreeFilterLastEnterTerm = "";

      // 文件加载模式：统一为分片模式
      Object.defineProperty(window, 'fileLoadMode', {
        get() { return 'chunk'; },
        configurable: true
      });
      let isFileLoadMode = false;
      // 过滤模式下存储的待过滤文件列表（文件路径数组）
      let filterModeFileList = [];
      // 分片模式下的总行数（含虚拟文件头行）
      let chunkTotalLines = 0;
      window.chunkTotalLines = 0;

      /**
       * 解析文件树搜索关键词（支持 | 分隔多个关键词）
       * @param {string} searchText - 搜索文本
       * @returns {string[]} 关键词数组
       */
      function parseFileTreeSearchKeywords(searchText) {
        const keywords = [];
        let currentKeyword = "";
        let escaping = false;

        for (let i = 0; i < searchText.length; i++) {
          const char = searchText[i];

          if (escaping) {
            currentKeyword += char;
            escaping = false;
          } else if (char === "\\") {
            escaping = true;
          } else if (char === "|") {
            if (currentKeyword.trim()) {
              keywords.push(currentKeyword.trim().toLowerCase());
            }
            currentKeyword = "";
          } else {
            currentKeyword += char;
          }
        }

        if (currentKeyword.trim()) {
          keywords.push(currentKeyword.trim().toLowerCase());
        }

        return keywords.length > 0 ? keywords : [searchText.trim().toLowerCase()];
      }

      /**
       * 检查文件名是否匹配任意搜索关键词
       * @param {string} fileName - 文件名
       * @param {string[]} keywords - 关键词数组
       * @returns {boolean} 是否匹配
       */
      function matchesFileTreeSearchKeywords(fileName, keywords) {
        const name = fileName.toLowerCase();
        return keywords.some(keyword => name.includes(keyword));
      }

      var _starredDirsCache = null;
      var _frequentDirsCache = null;
      const MAX_FREQUENT_DIRS = 20;
      var _CONFIG_KEYS = (window.App && window.App.Constants && window.App.Constants.CONFIG_KEYS) || {};
      const CONFIG_KEY_STARRED = _CONFIG_KEYS.fileTreeStarredDirs || 'fileTree.starredDirs';
      const CONFIG_KEY_FREQUENT = _CONFIG_KEYS.fileTreeFrequentDirs || 'fileTree.frequentDirs';

      function loadStarredDirectories() {
        return _starredDirsCache != null ? _starredDirsCache : [];
      }

      function loadFrequentDirectories() {
        return _frequentDirsCache != null ? _frequentDirsCache : [];
      }

      async function initDirectoryConfigCache() {
        try {
          var starred = await window.electronAPI.configGet(CONFIG_KEY_STARRED);
          _starredDirsCache = Array.isArray(starred) ? starred : [];
        } catch (e) {
          _starredDirsCache = [];
        }
        try {
          var frequent = await window.electronAPI.configGet(CONFIG_KEY_FREQUENT);
          _frequentDirsCache = Array.isArray(frequent) ? frequent.slice(0, MAX_FREQUENT_DIRS) : [];
        } catch (e) {
          _frequentDirsCache = [];
        }
        _migrateFromLocalStorage();
      }

      function _migrateFromLocalStorage() {
        var FREQUENT_LS_KEY = (window.App && window.App.Constants && window.App.Constants.STORAGE_KEYS && window.App.Constants.STORAGE_KEYS.fileTreeFrequentDirs) || 'aitool.fileTree.frequentDirs';
        var STARRED_LS_KEY = (window.App && window.App.Constants && window.App.Constants.STORAGE_KEYS && window.App.Constants.STORAGE_KEYS.fileTreeStarredDirs) || 'aitool.fileTree.starredDirs';
        var migrated = false;
        try {
          var rawStarred = localStorage.getItem(STARRED_LS_KEY);
          if (rawStarred) {
            var list = JSON.parse(rawStarred);
            if (Array.isArray(list) && list.length > 0) {
              _starredDirsCache = list;
              window.electronAPI.configSet(CONFIG_KEY_STARRED, list);
              localStorage.removeItem(STARRED_LS_KEY);
              migrated = true;
            }
          }
        } catch (e) { /* ignore */ }
        try {
          var rawFrequent = localStorage.getItem(FREQUENT_LS_KEY);
          if (rawFrequent) {
            var list2 = JSON.parse(rawFrequent);
            if (Array.isArray(list2) && list2.length > 0) {
              _frequentDirsCache = list2.slice(0, MAX_FREQUENT_DIRS);
              window.electronAPI.configSet(CONFIG_KEY_FREQUENT, _frequentDirsCache);
              localStorage.removeItem(FREQUENT_LS_KEY);
              migrated = true;
            }
          }
        } catch (e) { /* ignore */ }
        if (migrated) console.log('[CoreInit] 已从 localStorage 迁移配置到 config.json');
      }

      function saveStarredDirectories(list) {
        _starredDirsCache = list;
        window.electronAPI.configSet(CONFIG_KEY_STARRED, list);
      }

      function saveFrequentDirectories(list) {
        _frequentDirsCache = list.slice(0, MAX_FREQUENT_DIRS);
        window.electronAPI.configSet(CONFIG_KEY_FREQUENT, _frequentDirsCache);
      }

      function isStarredDirectory(dirPath) {
        var list = loadStarredDirectories();
        for (var i = 0; i < list.length; i++) {
          if (list[i].path === dirPath) return true;
        }
        return false;
      }

      function addStarredDirectory(dirPath, dirName) {
        if (!dirPath || !dirName) return;
        if (isStarredDirectory(dirPath)) return;
        var list = loadStarredDirectories();
        list.push({ path: dirPath, name: dirName, starredAt: Date.now() });
        saveStarredDirectories(list);
      }

      function removeStarredDirectory(dirPath) {
        var list = loadStarredDirectories();
        var filtered = [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].path !== dirPath) filtered.push(list[i]);
        }
        saveStarredDirectories(filtered);
      }

      function addFrequentDirectory(dirPath, dirName) {
        if (!dirPath || !dirName) return;
        var list = loadFrequentDirectories();
        var existing = null;
        for (var i = 0; i < list.length; i++) {
          if (list[i].path === dirPath) { existing = list[i]; break; }
        }
        if (existing) {
          existing.count = (existing.count || 0) + 1;
          existing.lastAccess = Date.now();
          list.splice(i, 1);
        } else {
          existing = { path: dirPath, name: dirName, count: 1, lastAccess: Date.now() };
        }
        list.unshift(existing);
        list.sort(function(a, b) {
          var wa = (a.count || 0) * 2 + (a.lastAccess || 0) / 86400000;
          var wb = (b.count || 0) * 2 + (b.lastAccess || 0) / 86400000;
          return wb - wa;
        });
        saveFrequentDirectories(list);
        if (typeof refreshFrequentAccessNodes === 'function') {
          refreshFrequentAccessNodes();
        }
      }

      function removeFrequentDirectory(dirPath) {
        var list = loadFrequentDirectories();
        var filtered = [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].path !== dirPath) filtered.push(list[i]);
        }
        saveFrequentDirectories(filtered);
      }

      function rebuildFrequentDriveNodes() {
        var starredDirs = loadStarredDirectories();
        var frequentDirs = loadFrequentDirectories();
        var starredPaths = {};
        for (var si = 0; si < starredDirs.length; si++) {
          starredPaths[starredDirs[si].path] = true;
        }
        var nonStarredFrequent = [];
        for (var fi2 = 0; fi2 < frequentDirs.length; fi2++) {
          if (!starredPaths[frequentDirs[fi2].path]) {
            nonStarredFrequent.push(frequentDirs[fi2]);
          }
        }
        var allDirs = starredDirs.concat(nonStarredFrequent);
        var nodes = [];
        if (allDirs.length > 0) {
          nodes.push({
            name: '常用访问',
            path: '__frequent_access__',
            type: 'drive-category',
            expanded: true,
            level: 0,
            file: null,
            childrenLoaded: false,
            loadingChildren: false,
            size: 0
          });
          for (var di = 0; di < allDirs.length; di++) {
            var isStarred = !!starredPaths[allDirs[di].path];
            nodes.push({
              name: allDirs[di].name,
              path: allDirs[di].path,
              type: 'drive',
              expanded: false,
              level: 1,
              file: null,
              childrenLoaded: false,
              loadingChildren: false,
              isLocalDrive: true,
              isFrequentDir: true,
              isStarredDir: isStarred,
              size: 0
            });
          }
        }
        return nodes;
      }

      // 可见文件树项目映射
      let visibleFileTreeItems = [];
      // 可见项目快速查找（避免 includes 的 O(n)）


// Service API
window.App = window.App || {};
window.App.CoreInit = { ready: true };
