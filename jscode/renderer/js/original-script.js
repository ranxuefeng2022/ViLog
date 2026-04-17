
      // ========== 日志系统 - 拦截控制台输出并保存到文件（优化版） ==========
      (function() {
        'use strict';

        // 检查electronAPI是否可用
        if (!window.electronAPI || !window.electronAPI.saveLog) {
          console.warn('electronAPI.saveLog 不可用，日志拦截器未启用');
          return;
        }

        // 🚀 全局开关：通过 localStorage 或 URL 参数控制
        const ENABLE_LOG_INTERCEPT = (() => {
          // 检查 localStorage
          const stored = localStorage.getItem('enableLogIntercept');
          if (stored !== null) {
            return stored === 'true';
          }

          // 检查 URL 参数
          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.has('log')) {
            return urlParams.get('log') === 'true';
          }

          // 默认禁用（避免性能问题）
          return false;
        })();

        if (!ENABLE_LOG_INTERCEPT) {
          console.log('✓ 日志拦截器已禁用（通过 localStorage 或 URL 参数控制）');
          console.log('  启用方法：localStorage.setItem("enableLogIntercept", "true") 并刷新页面');
          return;
        }

        // 日志级别配置
        const LOG_LEVELS = {
          LOG: 'LOG',
          INFO: 'INFO',
          WARN: 'WARN',
          ERROR: 'ERROR',
          DEBUG: 'DEBUG'
        };

        // 🚀 性能优化：批量保存日志 + 节流机制
        const logBuffer = [];
        const BUFFER_SIZE = 100; // 缓冲区大小
        const FLUSH_INTERVAL = 500; // 刷新间隔（毫秒）
        let lastFlushTime = Date.now();
        let isFlushing = false;

        // 批量刷新日志缓冲区
        const flushLogBuffer = () => {
          if (isFlushing || logBuffer.length === 0) return;

          isFlushing = true;
          const logsToSave = logBuffer.splice(0, BUFFER_SIZE);

          // 使用 requestIdleCallback 或 setTimeout 避免阻塞主线程
          const flushTask = () => {
            try {
              window.electronAPI.saveLog(LOG_LEVELS.LOG, '[批量日志]', {
                count: logsToSave.length,
                logs: logsToSave
              }).catch(err => {
                // 忽略错误
              }).finally(() => {
                isFlushing = false;

                // 如果还有日志，继续刷新
                if (logBuffer.length > 0) {
                  setTimeout(flushTask, 0);
                }
              });
            } catch (e) {
              isFlushing = false;
            }
          };

          // 使用 setTimeout(0) 让出主线程
          setTimeout(flushTask, 0);
        };

        // 定时刷新缓冲区
        setInterval(() => {
          const now = Date.now();
          if (logBuffer.length > 0 && (now - lastFlushTime >= FLUSH_INTERVAL || logBuffer.length >= BUFFER_SIZE)) {
            lastFlushTime = now;
            flushLogBuffer();
          }
        }, FLUSH_INTERVAL);

        // 添加日志到缓冲区（带采样和限制）
        const addLogToBuffer = (level, message, data) => {
          // 🚀 高频日志采样：每10条只记录1条
          if (level === LOG_LEVELS.LOG || level === LOG_LEVELS.DEBUG) {
            if (Math.random() > 0.1) return; // 只保留10%的日志
          }

          // 🚀 限制缓冲区大小，避免内存爆炸
          if (logBuffer.length >= BUFFER_SIZE * 2) {
            // 缓冲区满时，丢弃最老的日志
            logBuffer.shift();
          }

          logBuffer.push({ level, message, data: data || null, timestamp: Date.now() });

          // 立即刷新（如果缓冲区满了）
          if (logBuffer.length >= BUFFER_SIZE) {
            flushLogBuffer();
          }
        };

        // 拦截console.log
        const originalLog = console.log;
        console.log = function(...args) {
          // 先输出到控制台
          originalLog.apply(console, args);

          // 🚀 高频调用检测：如果在1秒内调用超过100次，暂停记录
          const now = Date.now();
          if (!console.log.lastCallTime) {
            console.log.lastCallTime = now;
            console.log.callCount = 0;
          }

          console.log.callCount = (console.log.callCount || 0) + 1;

          if (now - console.log.lastCallTime > 1000) {
            console.log.lastCallTime = now;
            console.log.callCount = 0;
          }

          // 只有低频调用才记录
          if (console.log.callCount < 100) {
            addLogToBuffer(LOG_LEVELS.LOG, args[0], args.slice(1));
          }
        };

        // 拦截console.info
        const originalInfo = console.info;
        console.info = function(...args) {
          originalInfo.apply(console, args);
          addLogToBuffer(LOG_LEVELS.INFO, args[0], args.slice(1));
        };

        // 拦截console.warn
        const originalWarn = console.warn;
        console.warn = function(...args) {
          originalWarn.apply(console, args);
          addLogToBuffer(LOG_LEVELS.WARN, args[0], args.slice(1));
        };

        // 拦截console.error（始终记录，不采样）
        const originalError = console.error;
        console.error = function(...args) {
          originalError.apply(console, args);

          // 错误日志立即保存
          try {
            window.electronAPI.saveLog(LOG_LEVELS.ERROR, args[0], args.slice(1)).catch(() => {});
          } catch (e) {
            // 忽略
          }
        };

        // 拦截console.debug（采样记录）
        const originalDebug = console.debug;
        console.debug = function(...args) {
          originalDebug.apply(console, args);
          addLogToBuffer(LOG_LEVELS.DEBUG, args[0], args.slice(1));
        };

        // 记录日志系统启动
        console.log('✓ 日志拦截器已启动（优化版：批量+采样+节流）');
      })();

      // ========== 日志系统结束 ==========

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
        const MAX_MEMORY_MB = 600; // 600MB 上限
        const WARNING_MEMORY_MB = 350; // 350MB 时开始清理缓存

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
      const fileTreeCtxRefreshDir = document.getElementById("fileTreeCtxRefreshDir");
      const fileTreeCtxLoadOnlyDir = document.getElementById(
        "fileTreeCtxLoadOnlyDir"
      );
      const fileTreeCtxExtractArchive = document.getElementById("fileTreeCtxExtractArchive");
      const fileTreeCtxExpandAll = document.getElementById("fileTreeCtxExpandAll");
      const fileTreeCtxCollapseAll = document.getElementById("fileTreeCtxCollapseAll");
      const fileTreeCtxOpenHtml = document.getElementById("fileTreeCtxOpenHtml");
      const importFileInput = document.getElementById("importFileInput");
      const importFolderInput = document.getElementById("importFolderInput");
      const lineFileHoverTip = document.getElementById("lineFileHoverTip");

      // 🚀 远程目录相关元素
      const remoteConnectBtn = document.getElementById("remoteConnectBtn");
      const remoteDirectoryArea = document.getElementById("remoteDirectoryArea");
      const remoteDirectoryList = document.getElementById("remoteDirectoryList");
      const remoteConnectDialog = document.getElementById("remoteConnectDialog");
      const remoteConnectIp = document.getElementById("remoteConnectIp");
      const remoteConnectPort = document.getElementById("remoteConnectPort");
      const remoteConnectPath = document.getElementById("remoteConnectPath");
      const remoteConnectName = document.getElementById("remoteConnectName");
      const remoteConnectDialogClose = document.getElementById("remoteConnectDialogClose");
      const remoteConnectCancel = document.getElementById("remoteConnectCancel");
      const remoteConnectConfirm = document.getElementById("remoteConnectConfirm");

      // 🚀 本地共享相关元素
      const localShareBtn = document.getElementById("localShareBtn");
      const localShareStatus = document.getElementById("localShareStatus");
      const localShareDialog = document.getElementById("localShareDialog");
      const localSharePath = document.getElementById("localSharePath");
      const localSharePort = document.getElementById("localSharePort");
      const localShareDialogClose = document.getElementById("localShareDialogClose");
      const localShareCancel = document.getElementById("localShareCancel");
      const localShareConfirm = document.getElementById("localShareConfirm");
      const stopLocalShareBtn = document.getElementById("stopLocalShareBtn");

      // 远程连接列表
      const remoteConnections = [];

      // 本地共享状态
      let localShareRunning = false;

      // 日志内容框右键菜单相关元素
      const logContextMenu = document.getElementById("logContextMenu");
      const logContextMenuTitle = document.getElementById("logContextMenuTitle");
      const logCtxRefreshOpenFiles = document.getElementById("logCtxRefreshOpenFiles");
      const logCtxFileInfo = document.getElementById("logCtxFileInfo");
      const logCtxFileName = document.getElementById("logCtxFileName");
      const logCtxImportFile = document.getElementById("logCtxImportFile");
      const logCtxImportFolder = document.getElementById("logCtxImportFolder");
      const logCtxImportArchive = document.getElementById("logCtxImportArchive");
      // UTC转换按钮已移除
      // const logCtxConvertTimestamp = document.getElementById("logCtxConvertTimestamp");
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

      // 四角调整大小手柄
      const resizeHandleNW = document.querySelector(
        "#filteredPanel .panel-resize-handle.nw"
      );
      const resizeHandleNE = document.querySelector(
        "#filteredPanel .panel-resize-handle.ne"
      );
      const resizeHandleSW = document.querySelector(
        "#filteredPanel .panel-resize-handle.sw"
      );
      const resizeHandleSE = document.querySelector(
        "#filteredPanel .panel-resize-handle.se"
      );


      // 过滤自动建议下拉菜单
      const filterSuggestions = document.getElementById("filterSuggestions");

      // AI助手相关元素
      const aiAssistantPanel = document.getElementById("aiAssistantPanel");
      const aiAssistantHeader = document.getElementById("aiAssistantHeader");
      const aiAssistantClose = document.getElementById("aiAssistantClose");
      const aiAssistantFrame = document.getElementById("aiAssistantFrame");
      const aiAssistantToolbarBtn = document.getElementById(
        "aiAssistantToolbarBtn"
      );

      // AI助手面板的四角调整手柄
      const aiResizeHandleNW = document.querySelector(
        "#aiAssistantPanel .panel-resize-handle.nw"
      );
      const aiResizeHandleNE = document.querySelector(
        "#aiAssistantPanel .panel-resize-handle.ne"
      );
      const aiResizeHandleSW = document.querySelector(
        "#aiAssistantPanel .panel-resize-handle.sw"
      );
      const aiResizeHandleSE = document.querySelector(
        "#aiAssistantPanel .panel-resize-handle.se"
      );

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
          return { height: naturalHeight, scale: 1 };
        }
        // 压缩到安全高度内，scale > 1 表示 1px 对应多行
        virtualScrollScale = naturalHeight / MAX_DOM_HEIGHT;
        virtualTotalHeight = MAX_DOM_HEIGHT;
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
      
      // 服务器连接相关变量
      let isServerMode = false;  // 是否处于服务器模式
      let serverBaseUrl = "";    // 服务器基础 URL
      let serverCurrentPath = ""; // 当前服务器路径

      // 文件树搜索状态
      let fileTreeSearchTerm = "";
      // 文件树搜索匹配项索引列表（用于高亮显示）
      let fileTreeMatchedIndices = [];
      // 文件树搜索只显示匹配项模式（按Enter后启用）
      let fileTreeSearchShowOnlyMatches = false;
      // 🚀 标志：记录文件树是否因过滤面板显示而被自动隐藏
      let fileTreeWasHiddenByFilter = false;

      // 🚀 新增：文件加载模式管理
      // true = 加载模式（加载到主日志框，当前默认行为）
      // false = 过滤模式（不加载到主日志，直接用rg过滤）
      let isFileLoadMode = true;
      // 过滤模式下存储的待过滤文件列表（文件路径数组）
      let filterModeFileList = [];

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

      // 可见文件树项目映射
      let visibleFileTreeItems = [];
      // 可见项目快速查找（避免 includes 的 O(n)）

      // ============ DOM池化优化 ============
      /**
       * DOM池管理器 - 复用DOM元素，减少GC压力
       * 核心思想：创建固定数量的DOM元素，滚动时只更新内容而不是删除重建
       */
      class DOMPool {
        constructor(container, initialSize = 100) {
          this.container = container;
          this.pool = []; // 可用的DOM元素池
          this.activeElements = new Map(); // 当前使用的元素: index -> element
          this.initialSize = initialSize;

          // 预创建DOM元素池
          this._initializePool();
        }

        /**
         * 初始化DOM池，预创建固定数量的元素
         */
        _initializePool() {
          for (let i = 0; i < this.initialSize; i++) {
            const element = this._createPoolElement();
            this.pool.push(element);
          }
        }

        /**
         * 创建单个池元素（通用div，可复用）
         * 🚀 性能优化：使用transform替代top，启用GPU加速
         * 🚀 优化：移除will-change，减少内存占用（池元素会频繁复用）
         */
        _createPoolElement() {
          const element = document.createElement("div");
          element.style.cssText = "position:absolute;width:max-content;min-width:100%;display:none;";
          return element;
        }

        /**
         * 获取一个元素用于显示指定行
         * @param {number} index - 行索引
         * @param {string} className - CSS类名
         * @returns {HTMLElement} - 池元素
         */
        acquire(index, className) {
          let element;

          // 如果该索引已有元素，先回收
          if (this.activeElements.has(index)) {
            return this.activeElements.get(index);
          }

          // 从池中获取或创建新元素
          if (this.pool.length > 0) {
            element = this.pool.pop();
          } else {
            // 池为空时，动态创建新元素
            element = this._createPoolElement();
          }

          // 重置元素状态 - 只清除必要的样式
          element.className = className;
          element.dataset.index = String(index);
          element.style.display = "block";
          // 注意：left 和 top 会在 updateVisibleLines 中设置，这里不需要清除
          // transform 通常不使用，只在特殊情况下（如超大文件占位符）
          element.style.width = "max-content"; // 让内容宽度自由扩展
          element.style.minWidth = "100%"; // 最小占满容器宽度

          // 加入活跃集合
          this.activeElements.set(index, element);

          return element;
        }

        /**
         * 回收指定范围的元素回池中
         * @param {number} start - 起始索引
         * @param {number} end - 结束索引
         */
        releaseRange(start, end) {
          for (let i = start; i <= end; i++) {
            this.release(i);
          }
        }

        /**
         * 回收单个元素
         * @param {number} index - 行索引
         */
        release(index) {
          const element = this.activeElements.get(index);
          if (element) {
            if (window.mainLinesObserver) {
              try {
                window.mainLinesObserver.unobserve(element);
              } catch (e) {}
            }

            // 从 DOM 中移除，避免 display:none 元素无限累积
            if (element.parentElement) {
              element.parentElement.removeChild(element);
            }

            // 清理元素状态
            element.textContent = "";
            element.className = "";

            this.activeElements.delete(index);
            this.pool.push(element);
          }
        }

        /**
         * 回收所有当前活跃的元素
         */
        releaseAll() {
          const indices = Array.from(this.activeElements.keys());
          indices.forEach(index => this.release(index));
        }

        /**
         * 获取当前活跃元素数量
         */
        getActiveCount() {
          return this.activeElements.size;
        }

        /**
         * 获取池中可用元素数量
         */
        getPoolSize() {
          return this.pool.length;
        }

        /**
         * 清空池（用于重置）
         */
        clear() {
          // 🚀 性能优化：断开 Intersection Observer
          if (window.mainLinesObserver) {
            try {
              window.mainLinesObserver.disconnect();
            } catch (e) {
              // 忽略错误
            }
          }
          this.releaseAll();
          this.pool = [];
        }
      }

      // 创建全局DOM池实例（在renderLogLines中初始化）
      let domPool = null;
      let visibleFileTreeItemsSet = new Set();

      // 文件树虚拟滚动状态：避免一次渲染大量 DOM 导致滚动/展开卡顿
      let fileTreeAllVisibleIndices = []; // 展开状态 + 搜索过滤后的“可见索引”（索引指向 fileTreeHierarchy）
      let fileTreeRowHeightPx = 0; // 单行高度（offsetHeight + margin）
      const fileTreeVirtualBuffer = 40; // 上下缓冲行数
      let fileTreeVirtualRaf = null;
      let fileTreeRebuildRaf = null; // 🚀 scheduleRebuildAndRenderFileTree 的 RAF 去重标志
      let fileTreeVirtualLastStart = -1;
      let fileTreeVirtualLastEnd = -1;
      let fileTreeVirtualTopSpacer = null;
      let fileTreeVirtualBottomSpacer = null;
      let fileTreeVirtualContent = null;
      let fileTreeVirtualInitialized = false;

      // Ctrl+G 悬浮文件树状态（不改变主内容布局）
      let isFileTreeFloating = false;
      let wasDockedFileTreeVisible = false;
      // 文件树宽度持久化（拖拽调宽后，Ctrl+G 再次弹出保持一致）
      const FILE_TREE_DOCKED_WIDTH_STORAGE_KEY = "aitool.fileTree.dockedWidthPx";
      const FILE_TREE_FLOATING_WIDTH_STORAGE_KEY =
        "aitool.fileTree.floatingWidthPx";
      let fileTreeDockedWidthPx = 360; // 与CSS默认一致
      let fileTreeFloatingWidthPx = null; // 若为空则回退到 dockedWidth

      function clampValue(v, min, max) {
        const n = Number(v);
        if (!Number.isFinite(n)) return min;
        return Math.max(min, Math.min(max, n));
      }

      function readStorageNumber(key) {
        try {
          const raw = localStorage.getItem(key);
          if (raw == null || raw === "") return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        } catch (_) {
          return null;
        }
      }

      function writeStorageNumber(key, value) {
        try {
          localStorage.setItem(key, String(value));
        } catch (_) {
          // ignore
        }
      }

      // ===================== 书签/注释（支持导出/分享） =====================
      function isEditableElement(el) {
        if (!el) return false;
        const tag = (el.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
        if (el.isContentEditable) return true;
        return false;
      }

      // 快捷键：Shift+W, Escape（书签快捷键已移除）
      function initKeyboardShortcuts() {
        document.addEventListener("keydown", (e) => {
          if (isEditableElement(e.target)) return;
          // Shift+W：切换一级过滤面板最大化状态
          if (e.shiftKey && (e.key === "W" || e.key === "w")) {
            e.preventDefault();
            if (typeof toggleFilterPanelMaximize === 'function') {
              toggleFilterPanelMaximize();
              console.log('[快捷键] Shift+W: 切换过滤面板最大化');
            }
            return;
          }
          if (e.key === "Escape") {
            // 🔧 清除文件树中的文件选择
            if (selectedFiles.length > 0) {
              e.preventDefault();
              console.log(`[Esc] 清除 ${selectedFiles.length} 个文件选择`);
              clearFileSelection();
              renderFileTreeViewport(true);
              return;
            }
          }
        });
      }

      function syncFloatingFileTreeCssWidth() {
        const maxWidth = Math.max(260, window.innerWidth - 40);
        const base = fileTreeFloatingWidthPx ?? fileTreeDockedWidthPx;
        const width = clampValue(base, 260, maxWidth);
        document.documentElement.style.setProperty(
          "--file-tree-floating-width",
          width + "px"
        );
      }

      // 悬停行文件名提示状态
      let hoverTipRafId = null;
      let pendingHoverPayload = null;
      let lastHoverLineIndex = -1;

      // 悬浮过滤内容框相关变量
      let isFilterPanelResizing = false;
      let panelStartWidth = 0;
      let panelStartHeight = 0;

      // 四角调整大小相关变量
      let isCornerResizing = false;
      let resizeDirection = ""; // 'nw', 'ne', 'sw', 'se'

      // 窗口调整大小相关变量
      let isWindowResizing = false;
      let windowResizeStartX = 0;
      let windowResizeStartY = 0;
      let windowStartWidth = 0;
      let windowStartHeight = 0;
      let windowStartX = 0;
      let windowStartY = 0;
      let windowResizeDirection = ""; // 'n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'

      // 默认加载的目录路径（为空则文件树折叠，不为空则自动加载）
      //add_default_file_dir_here
      //const DEFAULT_SERVER_PATH = "export_Time20250702_102421";
	  //const DEFAULT_SERVER_PATH = "";
	  //const DEFAULT_SERVER_PATH = "debug";

      // 虚拟滚动相关变量
      let filteredPanelAllLines = []; // 当前显示的所有行（可能是一级过滤或二级过滤的结果）
      let filteredPanelAllOriginalIndices = []; // 映射到原始日志的索引
      let filteredPanelAllPrimaryIndices = []; // 映射到一级过滤结果的索引（二级过滤时使用）
      let filteredPanelVisibleStart = -1;
      let filteredPanelVisibleEnd = -1;
      let filteredPanelLineHeight = 19; // 🚀 修复：与CSS .filtered-log-line height一致（CSS默认是19px）
      let filteredPanelBuffer = 20; // 🚀 性能优化：增大缓冲区到20行，流畅滚动，内存增量可忽略（约15KB）
      let filteredPanelScrollRafId = null; // 🚀 滚动事件节流：使用 rAF 避免重复渲染
      let filteredPanelScrollDebounce = null;

      // 🚀 性能优化：缓存屏幕可见行数，避免每次滚动都重复计算
      let cachedScreenVisibleLines = 0;
      let lastKnownClientHeight = 0;  // 记录上次窗口高度，用于检测 resize

      // 🚀 性能优化：预计算文件头索引集合，避免每行都执行 startsWith 检查
      let fileHeaderIndices = new Set();

      // 🚀 性能优化：行HTML缓存，避免重复处理相同的高亮
      // 使用缓存避免每次滚动都重新计算高亮（每行最多12次safeHighlight调用）
      // 🔧 内存优化：限制缓存大小，防止内存溢出
      const MAX_HTML_CACHE_SIZE = 1000; // 最多缓存1000行，约300KB
      const filteredLineHtmlCache = new Map();
      const filteredLineContentCache = new Map(); // 行内容缓存
      let filteredLineCacheVersion = 0; // 缓存版本号，用于失效缓存

      // 🚀 缓存LRU淘汰：当缓存满时删除最旧的条目
      function addToFilteredLineCache(key, value) {
        // 🔧 内存优化：过滤过程中禁用缓存，避免峰值内存占用
        if (isFiltering) {
          return; // 过滤中不使用缓存
        }

        // 如果缓存已满，删除最早的条目（简单LRU）
        if (filteredLineHtmlCache.size >= MAX_HTML_CACHE_SIZE) {
          const firstKey = filteredLineHtmlCache.keys().next().value;
          filteredLineHtmlCache.delete(firstKey);
        }
        filteredLineHtmlCache.set(key, value);
      }

      // 🚀 优化：为过滤框创建DOM池实例
      let filteredPanelDomPool = null;

      // 🚀 预缓存：存储已转义的HTML和行号HTML，避免滚动时重复转义
      let filteredPanelEscapedCache = []; // 存储转义后的文本
      let filteredPanelHtmlCacheOld = [];   // 存储完整的HTML字符串（旧版，已废弃）

      // AI助手相关变量
      let isAiAssistantVisible = false;
      let isAiAssistantResizing = false;

      // AI助手面板调整大小相关变量
      let aiAssistantDragStartX = 0;
      let aiAssistantDragStartY = 0;
      let aiAssistantPanelStartX = 0;
      let aiAssistantPanelStartY = 0;
      let aiAssistantPanelStartWidth = 0;
      let aiAssistantPanelStartHeight = 0;

      // 使用requestAnimationFrame实现流畅动画
      let animationFrameId = null;

      // 当前永久高亮行索引
      let currentPermanentHighlightIndex = -1;

      // 上次点击的过滤面板行索引
      let lastClickedFilteredIndex = -1;

      // 🚀 新增：上次点击的原始行索引（用于过滤后快速定位，使用 O(1) Map 查找）
      let lastClickedOriginalIndex = -1;

      // 🚀 新增：上次点击时的过滤结果总行数（用于计算相对位置）
      let lastClickedFilteredTotalCount = -1;

      // 过滤历史记录
      let filterHistory = [];

      // 搜索历史记录
      let searchHistory = [];

      // 过滤结果框正则搜索历史记录
      let filteredPanelSearchHistory = [];

      // ERR_TAG跳转控制变量
      let hasAutoJumpedToErrTag = false;

      // 默认过滤关键词
      //DEFAULT_FILTER_KEY_WORDS
      const defaultFilterKeywords = "";

      // 水平滚动步长
      const HORIZONTAL_SCROLL_STEP = 100;

      // 新增：过滤面板最大化状态
      let isFilterPanelMaximized = false;

      // 新增：AI助手面板最大化状态
      let isAiAssistantPanelMaximized = false;

      // 新增：保存过滤面板滚动位置
      let filteredPanelScrollPosition = 0;

      // 新增：焦点状态 - 用于确定哪个容器应该响应滚动快捷键
      let focusOnFilteredPanel = false;
      let focusOnMainLog = false; // 鼠标在主日志框内的标志

      // 新增：首次过滤标志
      let isFirstFilter = true;

      // 新增：过滤面板状态存储
      let filteredPanelState = {
        isMaximized: false,
        position: { left: "", top: "", width: "", height: "" },
      };

      // 新增：AI助手面板状态存储
      let aiAssistantPanelState = {
        isMaximized: false,
        position: { left: "", top: "", width: "", height: "" },
      };

      // 文件树调整相关变量
      let fileTreeStartWidth = 0;
      let fileTreeStartX = 0;
      let fileTreeResizeAnimationFrame = null;
      // 配置快速链接（支持分组）
      const quickLinksConfig = {
        AI助手: [
          {
            name: "蓝心千寻",
            url: "https://chatgpt.vivo.com.cn/",
            color: "#333",
          },
          { name: "ChatGpt", url: "https://chatgpt.com/zh-CN/", color: "#333" },
          {
            name: "DeepSeek",
            url: "https://chat.deepseek.com/",
            color: "#333",
          },
          {
            name: "MiniMax",
            url: "https://agent.minimax.io/",
            color: "#333",
          },
          {
            name: "GLM",
            url: "https://chat.z.ai/",
            color: "#333",
          },
          {
            name: "豆包AI",
            url: "https://www.doubao.com/chat/",
            color: "#333",
          },
          {
            name: "Google gemini",
            url: "https://gemini.google.com/app",
            color: "#333",
          },
          {
            name: "GitHub copilot",
            url: "https://github.com/",
            color: "#fc6d26",
          },
          {
            name: "通义千问",
            url: "https://chat.qwen.ai/c/guest",
            color: "#f48024",
          },
          {
            name: "iflow",
            url: "https://iflow.cn/",
            color: "#f48024",
          },
        ],
        内部系统: [
          {
            name: "电源信息中心主页",
            url: "http://powercenter.vivo.xyz",
            color: "#ff3b30",
          },
          {
            name: "部门公共文件",
            url: "http://172.16.50.79/data01/powercenter/files/",
            color: "#333",
          },
          {
            name: "常用链接",
            url: "http://172.16.50.79/html/A_%E9%93%BE%E6%8E%A5%E5%AF%BC%E8%88%AA.html",
            color: "#333",
          },
          {
            name: "案例库",
            url: "http://172.16.50.79/html/httpserver/",
            color: "#34c759",
          },
        ],
        工具箱: [
          {
            name: "高级计算器",
            url: "advanced-calculator.html",
            color: "#667eea",
          },
          {
            name: "%per_interval_xxx.csv曲线绘制",
            url: "http://172.16.50.79/html/per_interval_csv_plot.html",
            color: "#ff3b30",
          },
        ],
        其他链接: [
          {
            name: "GM3.0充放电内阻调试技巧",
            url: "https://online.mediatek.com/apps/faq/detail?list=SW&faqid=FAQ35443",
            color: "#ff3b30",
          },
          {
            name: "reserve分区修改记录",
            url: "https://docs.vivo.xyz/i/Wiz60I5BUolX7ha2-eV2DP7shXIComYao8qNQXg2Uhg",
            color: "#333",
          },
          {
            name: "mtk gpio配置方法",
            url: "https://online.mediatek.com/FAQ#/SW/FAQ04267",
            color: "#333",
          },
        ],
      };

      let quickLinksPanelVisible = false;

      function initQuickLinksPanel() {
        const panel = document.getElementById("quickLinksPanel");
        const contentArea = document.getElementById("quickLinksPanelContent");
        const searchInput = document.getElementById("quickLinksSearch");

        // 清空内容区域
        // 🚀 性能优化：使用textContent清空内容更快
        contentArea.textContent = '';

        // 生成链接按钮
        for (const [category, links] of Object.entries(quickLinksConfig)) {
          // 创建分类容器
          const categoryContainer = document.createElement("div");
          categoryContainer.className = "quick-links-category";
          categoryContainer.dataset.category = category;

          // 创建分类标题
          const categoryTitle = document.createElement("div");
          categoryTitle.className = "link-category";
          categoryTitle.textContent = category;
          categoryTitle.setAttribute('data-count', links.length); // 添加计数徽章
          categoryContainer.appendChild(categoryTitle);

          // 创建链接按钮
          links.forEach((link) => {
            const button = document.createElement("button");
            button.className = "link-button";
            button.textContent = link.name; // 使用textContent，避免XSS
            button.dataset.name = link.name.toLowerCase(); // 用于搜索
            button.setAttribute('data-original-name', link.name); // 保存原始名称
            button.style.borderLeftColor = link.color; // 设置左侧边框颜色

            button.addEventListener("click", () => {
              window.open(link.url, "_blank");
              toggleQuickLinksPanel(); // 点击后自动关闭面板
            });

            categoryContainer.appendChild(button);
          });

          contentArea.appendChild(categoryContainer);
        }

        // 添加无结果提示元素
        const noResults = document.createElement("div");
        noResults.className = "quick-links-no-results";
        noResults.textContent = "没有找到匹配的网站";
        noResults.style.display = "none";
        contentArea.appendChild(noResults);

        // 添加搜索功能
        searchInput.addEventListener("input", function (e) {
          const searchTerm = e.target.value.toLowerCase().trim();
          const categories = contentArea.querySelectorAll(".quick-links-category");
          const noResultsElement = contentArea.querySelector(
            ".quick-links-no-results"
          );

          let hasVisibleItems = false;

          // 遍历所有分类
          categories.forEach((category) => {
            const buttons = category.querySelectorAll(".link-button");
            let hasVisibleButtons = false;

            // 遍历分类下的所有按钮
            buttons.forEach((button) => {
              const buttonName = button.dataset.name;
              const originalName = button.getAttribute('data-original-name') || button.textContent;

              if (searchTerm === "") {
                // 搜索为空时，显示所有按钮并移除高亮
                button.style.display = "flex";
                button.textContent = buttonName; // 恢复原始文本
                hasVisibleButtons = true;
              } else if (buttonName.includes(searchTerm)) {
                // 如果匹配，显示按钮并高亮匹配部分
                button.style.display = "flex";

                // 高亮匹配的文本
                const regex = new RegExp(`(${searchTerm})`, "gi");
                const highlightedName = buttonName.replace(
                  regex,
                  '<span class="quick-links-search-highlight">$1</span>'
                );
                button.innerHTML = highlightedName;

                hasVisibleButtons = true;
              } else {
                // 不匹配，隐藏按钮
                button.style.display = "none";
              }
            });

            // 根据是否有可见按钮决定是否显示分类标题
            const categoryTitle = category.querySelector(".link-category");
            if (hasVisibleButtons) {
              category.style.display = "block";
              categoryTitle.style.display = "block";
              hasVisibleItems = true;
            } else {
              category.style.display = "none";
              categoryTitle.style.display = "none";
            }
          });

          // 显示或隐藏"无结果"提示
          if (searchTerm !== "" && !hasVisibleItems) {
            noResultsElement.style.display = "block";
          } else {
            noResultsElement.style.display = "none";
          }
        });

        // 按Enter键跳转到第一个匹配结果
        searchInput.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            const firstVisibleButton = contentArea.querySelector(
              '.link-button[style="display: flex"]'
            );
            if (firstVisibleButton) {
              firstVisibleButton.click();
            }
          }
        });

        // 面板显示时自动聚焦搜索框
        panel.addEventListener("transitionend", function () {
          if (panel.classList.contains("visible")) {
            searchInput.focus();
            searchInput.select();
          }
        });
      }

      function toggleQuickLinksPanel() {
        quickLinksPanelVisible = !quickLinksPanelVisible;
        const panel = document.getElementById("quickLinksPanel");

        if (!panel) {
          console.error('quickLinksPanel not found!');
          return;
        }

        if (quickLinksPanelVisible) {
          panel.classList.add("visible");

          // 清空搜索框并重置显示
          const searchInput = document.getElementById("quickLinksSearch");
          if (searchInput) {
            searchInput.value = "";
            searchInput.dispatchEvent(new Event("input"));
          }

          // 添加外部点击关闭事件
          setTimeout(() => {
            document.addEventListener("click", closeQuickLinksPanelOutside);
          }, 10);
        } else {
          panel.classList.remove("visible");
          document.removeEventListener("click", closeQuickLinksPanelOutside);
        }
      }

      // 暴露到全局作用域，供HTML onclick使用（立即执行）
      window.toggleQuickLinksPanel = toggleQuickLinksPanel;

      function closeQuickLinksPanelOutside(e) {
        const panel = document.getElementById("quickLinksPanel");
        const toggleBtn = document.getElementById("toggleQuickLinksBtn");

        if (!panel.contains(e.target) && !toggleBtn.contains(e.target)) {
          panel.classList.remove("visible");
          quickLinksPanelVisible = false;
          document.removeEventListener("click", closeQuickLinksPanelOutside);
        }
      }


      // 窗口切换快捷键：Ctrl+Tab 循环切换，Alt+数字跳转到对应窗口
      function initWindowShortcuts() {
        let lastWindowId = null; // 记录上一次激活的窗口ID

        document.addEventListener("keydown", (e) => {
          // Ctrl+Tab: 循环切换窗口
          if (e.ctrlKey && e.key === "Tab") {
            e.preventDefault();
            e.stopPropagation();
            
            if (typeof window.electronAPI !== "undefined" && window.electronAPI.getWindowList) {
              window.electronAPI.getWindowList().then(windowList => {
                if (windowList.length <= 1) return; // 单窗口不需要切换
                
                // 找到当前窗口
                const currentWindow = windowList.find(w => w.isFocused);
                if (!currentWindow) return;
                
                // 计算下一个窗口索引（循环）
                const currentIndex = windowList.findIndex(w => w.id === currentWindow.id);
                const nextIndex = (currentIndex + 1) % windowList.length;
                const nextWindow = windowList[nextIndex];
                
                if (nextWindow && window.electronAPI.focusWindow) {
                  window.electronAPI.focusWindow(nextWindow.id);
                }
              });
            }
          }
          
          // Alt+数字: 跳转到对应窗口
          if (e.altKey && /^[1-9]$/.test(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            
            const windowNumber = parseInt(e.key, 10);
            
            if (typeof window.electronAPI !== "undefined" && window.electronAPI.getWindowList) {
              window.electronAPI.getWindowList().then(windowList => {
                // 查找对应序号的窗口
                const targetWindow = windowList.find(w => w.windowNumber === windowNumber);
                
                if (targetWindow && window.electronAPI.focusWindow) {
                  window.electronAPI.focusWindow(targetWindow.id);
                }
              });
            }
          }
        });
      }

      // 创建新窗口
      function createNewWindow(options = {}) {
        console.log('createNewWindow called', { electronAPI: typeof window.electronAPI, options });

        if (typeof window.electronAPI === 'undefined') {
          console.error('electronAPI is not available. Make sure you are running in Electron environment.');
          alert('无法创建新窗口：electronAPI 不可用。请确保在 Electron 应用中运行此功能。');
          return;
        }

        if (!window.electronAPI.createNewWindow) {
          console.error('electronAPI.createNewWindow is not available');
          alert('无法创建新窗口：createNewWindow 方法不可用。');
          return;
        }

        try {
          const defaultTitle = "日志查看器 - " + new Date().toLocaleTimeString();
          window.electronAPI.createNewWindow({
            title: options.title || defaultTitle
          }).then(result => {
            console.log('New window created successfully', result);
          }).catch(error => {
            console.error('Failed to create new window:', error);
            alert('创建新窗口失败：' + error.message);
          });
        } catch (error) {
          console.error('Error calling createNewWindow:', error);
          alert('创建新窗口时出错：' + error.message);
        }
      }

      // 打开串口日志窗口
      function openUartLogWindow() {
        if (typeof window.electronAPI === 'undefined') {
          alert('无法打开串口日志窗口：electronAPI 不可用。');
          return;
        }

        if (!window.electronAPI.openUartLogWindow) {
          alert('无法打开串口日志窗口：openUartLogWindow 方法不可用。');
          return;
        }

        try {
          window.electronAPI.openUartLogWindow().then(result => {
            if (result.success) {
              showMessage(result.message || '串口日志窗口已打开');
            } else {
              showMessage('打开串口日志失败: ' + (result.error || '未知错误'));
            }
          }).catch(error => {
            console.error('打开串口日志窗口失败:', error);
            alert('打开串口日志窗口失败：' + error.message);
          });
        } catch (error) {
          console.error('Error calling openUartLogWindow:', error);
          alert('打开串口日志窗口时出错：' + error.message);
        }
      }

      // 暴露到全局作用域
      window.createNewWindow = createNewWindow;

      // 🚀 暴露驱动器刷新函数到全局作用域
      window.refreshDrivesIncludeAll = refreshDrivesIncludeAll;
      window.refreshDrivesDataOnly = refreshDrivesDataOnly;

      // 虚拟滚动优化：暴露滚动相关函数到全局作用域
      window.jumpToLine = jumpToLine;
      window.scrollToTop = scrollToTop;
      window.scrollToBottom = scrollToBottom;
      window.scrollToSelectedLine = scrollToSelectedLine;
      window.updateScrollProgress = updateScrollProgress;

      // 初始化复制事件处理器 - 智能处理单行和多行选择，保留换行
      function initCopyHandler() {
        document.addEventListener('copy', (e) => {
          const selection = window.getSelection();
          if (!selection.rangeCount || selection.isCollapsed) return;

          const range = selection.getRangeAt(0);
          const container = range.commonAncestorContainer;

          // 检查是否在日志框或过滤框中
          const inLogContainer = container.nodeType === 3 ?
            container.parentElement.closest('#innerContainer') ||
            (container.parentElement && container.parentElement.parentElement.closest('#innerContainer')) :
            container.closest('#innerContainer');

          const inFilterContainer = container.nodeType === 3 ?
            container.parentElement.closest('#filteredPanelContent') ||
            (container.parentElement && container.parentElement.parentElement.closest('#filteredPanelContent')) :
            container.closest('#filteredPanelContent');

          if (inLogContainer || inFilterContainer) {
            // 阻止默认复制行为
            e.preventDefault();

            // 查找选择范围内的所有行元素
            const startNode = range.startContainer;
            const endNode = range.endContainer;

            // 向上查找起始和结束的行元素
            let startLine = startNode;
            while (startLine && !(startLine.nodeType === 1 &&
              (startLine.classList && (startLine.classList.contains('log-line') || startLine.classList.contains('filtered-log-line'))))) {
              startLine = startLine.parentNode;
            }

            let endLine = endNode;
            while (endLine && !(endLine.nodeType === 1 &&
              (endLine.classList && (endLine.classList.contains('log-line') || endLine.classList.contains('filtered-log-line'))))) {
              endLine = endLine.parentNode;
            }

            // 如果找到了行元素，检查是否跨行
            if (startLine && endLine) {
              const isMultiLine = startLine !== endLine;

              if (isMultiLine) {
                // 跨行选择：手动构建文本，确保换行
                const lines = [];
                let currentLine = startLine;

                while (currentLine) {
                  if (currentLine.nodeType === 1 &&
                    (currentLine.classList.contains('log-line') || currentLine.classList.contains('filtered-log-line'))) {

                    // 首行：只包含选中部分之后的内容
                    if (currentLine === startLine) {
                      const lineRange = document.createRange();
                      lineRange.setStart(range.startContainer, range.startOffset);
                      lineRange.setEndAfter(currentLine.lastChild || currentLine);
                      lines.push(lineRange.toString());
                    }
                    // 末行：只包含选中部分之前的内容
                    else if (currentLine === endLine) {
                      const lineRange = document.createRange();
                      lineRange.setStartBefore(currentLine.firstChild || currentLine);
                      lineRange.setEnd(range.endContainer, range.endOffset);
                      lines.push(lineRange.toString());
                    }
                    // 中间行：包含整行
                    else {
                      lines.push(currentLine.textContent);
                    }
                  }

                  // 到达末行后停止
                  if (currentLine === endLine) {
                    break;
                  }

                  currentLine = currentLine.nextElementSibling;
                }

                // 用换行符连接所有行
                const selectedText = lines.join('\n');
                if (e.clipboardData) {
                  e.clipboardData.setData('text/plain', selectedText);
                }
              } else {
                // 单行选择：直接使用选中的文本
                const selectedText = selection.toString();
                if (e.clipboardData) {
                  e.clipboardData.setData('text/plain', selectedText);
                }
              }
            } else {
              // 没找到行元素，使用默认选中内容
              const selectedText = selection.toString();
              if (e.clipboardData) {
                e.clipboardData.setData('text/plain', selectedText);
              }
            }
          }
        });
      }

      // 初始化粘贴事件处理器 - 支持从文件资源管理器粘贴文件
      function initPasteHandler() {
        document.addEventListener('paste', async (e) => {
          // 检查焦点是否在输入框/文本框中，如果是则不处理
          const activeElement = document.activeElement;
          const tag = activeElement ? activeElement.tagName : '';
          const isInputField = tag === 'INPUT' || tag === 'TEXTAREA' || activeElement.isContentEditable;

          if (isInputField) {
            console.log('📋 焦点在输入框中，跳过粘贴处理');
            return;
          }

          console.log('📋 检测到粘贴事件，焦点元素:', tag);

          // 检查剪贴板中是否有文件
          const clipboardData = e.clipboardData;
          if (!clipboardData) {
            console.log('❌ 无法访问剪贴板数据');
            return;
          }

          // 检查 items 中是否有文件类型
          const items = clipboardData.items;
          if (items && items.length > 0) {
            console.log('📋 剪贴板 items 数量:', items.length);

            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              console.log(`📋 Item ${i}:`, item.kind, item.type);

              // 如果是文件类型
              if (item.kind === 'file') {
                console.log('✅ 检测到文件粘贴');
                e.preventDefault();

                // 收集所有文件
                const files = [];
                for (let j = 0; j < items.length; j++) {
                  if (items[j].kind === 'file') {
                    const file = items[j].getAsFile();
                    files.push(file);
                  }
                }

                console.log(`📁 粘贴了 ${files.length} 个文件`);

                // 详细调试：输出所有文件信息
                files.forEach((f, idx) => {
                  console.log(`文件 ${idx}:`, {
                    name: f.name,
                    path: f.path,
                    size: f.size,
                    type: f.type,
                    'path 以 \\\\ 结尾': f.path ? f.path.endsWith('\\') : 'N/A',
                    '无扩展名': !f.name.includes('.')
                  });
                });

                // 检查是否有文件夹（通过 path 属性）
                const folders = files.filter(f => f.path && f.path.endsWith('\\'));
                const regularFiles = files.filter(f => !f.path || !f.path.endsWith('\\'));

                console.log(`📂 检测到 ${folders.length} 个文件夹, ${regularFiles.length} 个普通文件`);

                // 处理直接检测到的文件夹（path 以 \\ 结尾）
                if (folders.length > 0) {
                  console.log(`✅ 检测到 ${folders.length} 个文件夹，创建懒加载节点`);

                  // 创建懒加载文件夹节点
                  const lazyFolders = folders.map(folder => {
                    const folderName = folder.name.replace(/\\$/, ''); // 移除末尾的反斜杠
                    return {
                      name: folderName,
                      kind: "directory",
                      fullPath: folderName,
                      _isLazyDir: true,
                      _originalPath: folder.path // 保存完整路径供懒加载使用
                    };
                  });

                  // 添加到文件树
                  if (typeof addFilesToTree === 'function') {
                    addFilesToTree(lazyFolders);
                    showMessage(`✅ 成功添加 ${lazyFolders.length} 个文件夹（懒加载）`);
                  }
                  return;
                }

                // 如果没有检测到文件夹，但有无扩展名的文件且 size=0，可能是文件夹
                if (folders.length === 0 && regularFiles.length > 0) {
                  const potentialFolders = regularFiles.filter(f => !f.name.includes('.') && f.size === 0);

                  if (potentialFolders.length > 0) {
                    console.log(`⚠️ 发现 ${potentialFolders.length} 个可能为文件夹的文件（无扩展名且 size=0）`);

                    // 🔧 处理剩余的普通文件
                    const otherFiles = regularFiles.filter(f => !potentialFolders.includes(f));

                    // 处理其他文件（如果有）
                    for (const file of otherFiles) {
                      try {
                        const text = await file.text();
                        const blob = new Blob([text], { type: 'text/plain' });
                        const importedFile = new File([blob], file.name, {
                          type: 'text/plain',
                          lastModified: Date.now()
                        });
                        Object.defineProperty(importedFile, 'path', {
                          value: file.path || file.name,
                          writable: false
                        });
                        // 🔧 保存文件内容，供后续加载使用
                        importedFile._fileContent = text;
                        fileTreeData.push(importedFile);
                      } catch (error) {
                        console.error(`读取文件 ${file.name} 失败:`, error);
                      }
                    }

                    // 🔧 直接创建懒加载文件夹节点并插入到文件树
                    for (const item of potentialFolders) {
                      const folderNode = {
                        name: item.name,
                        type: 'folder',
                        path: item.name,
                        level: 0, // 🔧 根级别，与盘符平行
                        expanded: false,
                        lazyLoad: true,
                        childrenLoaded: false,
                        loadingChildren: false,
                        isLocalDrive: true,
                        _isLazyDir: true,
                        _originalPath: undefined, // 会在懒加载时通过智能搜索解析
                        _isPastedFolder: true // 🔧 标记为粘贴的文件夹
                      };

                      // 🔧 直接插入到文件树中（persistentDriveNodes 之后）
                      fileTreeHierarchy.splice(persistentDriveNodes.length, 0, folderNode);
                      console.log(`📋 直接插入粘贴的文件夹: ${item.name} 到位置 ${persistentDriveNodes.length}`);
                    }

                    // 渲染文件树
                    renderFileTree();

                    const folderCount = potentialFolders.length;
                    const fileCount = otherFiles.length;
                    let message = `✅ 成功添加 ${folderCount} 个文件夹（懒加载）`;
                    if (fileCount > 0) {
                      message += ` 和 ${fileCount} 个文件`;
                    }
                    showMessage(message);
                    return; // 已处理，不再继续
                  }
                }

                // 没有文件夹，使用原来的拖拽处理
                await handleDroppedFiles(files);
                return;
              }
            }
          }

          // 如果没有文件，检查是否有文件路径（文本格式）
          const textData = clipboardData.getData('text/plain');
          if (textData && textData.trim()) {
            console.log('📋 剪贴板文本:', textData);

            // 检查是否为文件路径
            const lines = textData.split('\n').map(line => line.trim()).filter(line => line);
            const filePaths = lines.filter(line => {
              // Windows 绝对路径格式: C:\path\to\file
              return /^[A-Za-z]:\\/.test(line) || /^\\\\[^\\]+\\/.test(line); // UNC 路径
            });

            if (filePaths.length > 0) {
              console.log('✅ 检测到文件路径，数量:', filePaths.length);
              e.preventDefault();

              // 使用 electronAPI readFolder 读取（支持文件和文件夹）
              if (typeof window.electronAPI !== 'undefined') {
                try {
                  // 逐个读取路径（可能是文件或文件夹）
                  const allResults = [];

                  // 记录根路径（用于计算相对路径）
                  const rootPath = filePaths[0];
                  console.log(`📂 根路径: ${rootPath}`);

                  for (const filePath of filePaths) {
                    console.log(`📂 读取路径: ${filePath}`);
                    const results = await window.electronAPI.readFolder(filePath);

                    // 如果返回的是数组（多个文件）
                    if (Array.isArray(results)) {
                      // 🔧 使用循环避免大数组堆栈溢出
                      const allResultsLen = allResults.length;
                      const resultsLen = results.length;
                      for (let i = 0; i < resultsLen; i++) {
                        allResults[allResultsLen + i] = results[i];
                      }
                    } else {
                      // 如果返回的是单个结果对象
                      allResults.push(results);
                    }
                  }

                  console.log(`📁 总共读取 ${allResults.length} 项`);

                  const successResults = allResults.filter(r => r.success);
                  const failedResults = allResults.filter(r => !r.success);

                  if (successResults.length > 0) {
                    // 转换为 File 对象，保留目录结构
                    const files = successResults.map(r => {
                      const blob = new Blob([r.content], { type: 'text/plain' });

                      // 计算相对路径（需要保留根文件夹名称）
                      let relativePath = r.path;
                      if (r.path.startsWith(rootPath)) {
                        relativePath = r.path.substring(rootPath.length);
                        if (relativePath.startsWith('\\') || relativePath.startsWith('/')) {
                          relativePath = relativePath.substring(1);
                        }
                      }

                      // 获取根文件夹名称
                      const rootFolderName = rootPath.split('\\').pop();
                      // 在相对路径前加上根文件夹名称
                      relativePath = rootFolderName + '/' + relativePath;

                      // 转换反斜杠为正斜杠
                      relativePath = relativePath.replace(/\\/g, '/');

                      const fileName = r.path.split('\\').pop();
                      const file = new File([blob], fileName, {
                        type: 'text/plain',
                        lastModified: Date.now()
                      });
                      Object.defineProperty(file, 'path', {
                        value: r.path,
                        writable: false
                      });

                      // 设置 fullPath 以保留目录结构（包含根文件夹）
                      Object.defineProperty(file, 'fullPath', {
                        value: relativePath,
                        writable: false
                      });

                      console.log(`📄 ${fileName}: fullPath = ${relativePath}`);
                      return file;
                    });

                    // 添加到文件树
                    if (typeof addFilesToTree === 'function') {
                      addFilesToTree(files, { lazyLoad: false });

                      // 显示导入结果
                      let message = `✅ 成功导入 ${files.length} 个文件（保留目录结构）`;
                      if (failedResults.length > 0) {
                        message += `\n⚠️ ${failedResults.length} 个文件跳过（二进制/过大）`;
                      }
                      showMessage(message);
                    }
                  } else {
                    showMessage('❌ 没有可导入的文件（文件可能不存在或无法读取）');
                  }
                } catch (error) {
                  console.error('读取文件失败:', error);
                  showMessage('❌ 读取文件失败: ' + error.message);
                }
              } else {
                showMessage('❌ electronAPI 不可用');
              }
            } else {
              // 如果没有检测到文件路径，显示提示
              if (filePaths.length === 0 && lines.length > 0) {
                console.log('⚠️ 剪贴板内容不是文件路径，显示提示');
                showMessage(`💡 如何粘贴文件：

【方法1：直接拖拽】（推荐）
✅ 直接从资源管理器拖拽文件/文件夹到文件树

【方法2：复制文件路径】
1. 在资源管理器中，按住 Shift 右键文件/文件夹
2. 选择"复制为路径"
3. 在文件树区域按 Ctrl+V 粘贴

【方法3：手动输入】
✅ 使用文件树的"导入文件"按钮`);
              }
            }
          }
        });
      }

      // 全局右键菜单 - 添加新建窗口选项
      function initGlobalContextMenu() {
        // 🚀 已禁用全局右键菜单（避免与文件树等其他菜单冲突）
        return;
        /* 原全局右键菜单代码已禁用
        document.addEventListener('contextmenu', (e) => {
          // 检查是否在已存在的右键菜单区域内（不覆盖现有的右键菜单）
          const existingContextMenu = e.target.closest('#logContextMenu, #fileTreeContextMenu');
          if (existingContextMenu) {
            return;
          }

          // 检查是否在按钮上
          if (e.target.tagName === 'BUTTON') {
            return;
          }

          // 阻止默认右键菜单
          e.preventDefault();

          // 创建简单的右键菜单
          const existingMenu = document.getElementById('globalContextMenu');
          if (existingMenu) {
            existingMenu.remove();
          }

          const menu = document.createElement('div');
          menu.id = 'globalContextMenu';
          menu.style.cssText = `
            position: fixed;
            left: ${e.pageX}px;
            top: ${e.pageY}px;
            background: white;
            border: 1px solid rgba(0,0,0,0.1);
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 10000;
            min-width: 180px;
            padding: 4px 0;
          `;

          menu.innerHTML = `
            <div class="global-context-menu-item" data-action="new-window" style="
              padding: 8px 16px;
              cursor: pointer;
              font-size: 13px;
              color: #1d1d1f;
              transition: background-color 0.2s ease;
              display: flex;
              align-items: center;
              gap: 8px;
            ">
              <span>🪟</span>
              <span>新建窗口</span>
            </div>
          `;

          document.body.appendChild(menu);

          // 添加hover效果
          menu.querySelectorAll('.global-context-menu-item').forEach(item => {
            item.onmouseenter = () => {
              item.style.backgroundColor = 'rgba(0, 113, 227, 0.1)';
            };
            item.onmouseleave = () => {
              item.style.backgroundColor = 'transparent';
            };
            item.onclick = () => {
              const action = item.dataset.action;
              if (action === 'new-window') {
                createNewWindow();
              }
              menu.remove();
            };
          });

          // 点击其他地方关闭菜单
          setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
              if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
              }
            });
          }, 10);
        });
        */
      }

      // 正则特殊字符转义
      function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }

      // 🚀 性能优化：正则表达式缓存，避免重复创建
      const regexCache = new Map();
      const MAX_REGEX_CACHE_SIZE = 500; // 限制缓存大小

      function getCachedRegex(keyword) {
        if (!regexCache.has(keyword)) {
          // LRU：如果缓存满了，删除最旧的项
          if (regexCache.size >= MAX_REGEX_CACHE_SIZE) {
            const firstKey = regexCache.keys().next().value;
            regexCache.delete(firstKey);
          }
          regexCache.set(keyword, new RegExp(`(${escapeRegExp(keyword)})`, "gi"));
        }
        return regexCache.get(keyword);
      }

      // 清空正则缓存（用于内存压力时调用）
      function clearRegexCache() {
        regexCache.clear();
      }
      // 发送过滤关键词到服务端
      function sendFilterKeywordsToServer(keywords) {
        if (!keywords || keywords.trim() === "") return;

        try {
          const data = {
            keywords: keywords,
            timestamp: new Date().toISOString(),
            source: "log-viewer",
          };

          // 发送到指定的服务端地址
          fetch("http://172.16.107.173:8082/receive-keywords", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
            mode: "no-cors", // 如果服务端不支持CORS，可以使用这个选项
          }).catch((error) => {
            console.log("发送过滤关键词失败:", error);
            // 失败时尝试使用图片方式发送（兼容性更好）
            sendFilterKeywordsViaImage(keywords);
          });

          console.log("过滤关键词已发送到服务端:", keywords);
        } catch (error) {
          console.error("发送过滤关键词时出错:", error);
        }
      }

      // 使用图片方式发送（兼容性更好，不受CORS限制）
      function sendFilterKeywordsViaImage(keywords) {
        try {
          const img = new Image();
          img.src = `http://172.16.107.173:8081/track?keywords=${encodeURIComponent(
            keywords
          )}&t=${Date.now()}`;
          img.style.display = "none";
          document.body.appendChild(img);
          setTimeout(() => {
            if (document.body.contains(img)) {
              document.body.removeChild(img);
            }
          }, 100);
        } catch (error) {
          console.error("图片方式发送失败:", error);
        }
      }

      // 🚀 性能优化版：转义HTML特殊字符
      // 使用单次遍历，减少正则表达式开销
      function escapeHtml(str) {
        if (!str) return "";
        if (str.length < 10) {
          // 短字符串使用简单查找
          let result = "";
          for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            switch (ch) {
              case "&": result += "&amp;"; break;
              case "<": result += "&lt;"; break;
              case ">": result += "&gt;"; break;
              case '"': result += "&quot;"; break;
              case "'": result += "&#39;"; break;
              default: result += ch;
            }
          }
          return result;
        }

        // 长字符串使用indexOf查找需要转义的字符
        let result = "";
        let lastPos = 0;
        let pos = 0;

        while (pos < str.length) {
          const ch = str[pos];
          let replacement = null;

          switch (ch) {
            case "&": replacement = "&amp;"; break;
            case "<": replacement = "&lt;"; break;
            case ">": replacement = "&gt;"; break;
            case '"': replacement = "&quot;"; break;
            case "'": replacement = "&#39;"; break;
          }

          if (replacement) {
            result += str.substring(lastPos, pos) + replacement;
            lastPos = pos + 1;
          }
          pos++;
        }

        return result + str.substring(lastPos);
      }

      // 🚀 性能优化版：反转义HTML特殊字符
      // 使用单次遍历，减少正则表达式开销
      function unescapeHtml(str) {
        if (!str) return "";
        if (str.indexOf('&') === -1) return str; // 快速路径：没有需要反转义的字符

        let result = "";
        let pos = 0;

        while (pos < str.length) {
          if (str[pos] === '&') {
            // 查找分号
            const semiPos = str.indexOf(';', pos);
            if (semiPos !== -1 && semiPos - pos < 10) { // 限制最大实体长度
              const entity = str.substring(pos, semiPos + 1);
              let replacement = null;

              switch (entity) {
                case "&amp;": replacement = "&"; break;
                case "&lt;": replacement = "<"; break;
                case "&gt;": replacement = ">"; break;
                case "&quot;": replacement = '"'; break;
                case "&#39;": replacement = "'"; break;
              }

              if (replacement) {
                result += replacement;
                pos = semiPos + 1;
                continue;
              }
            }
          }
          result += str[pos];
          pos++;
        }

        return result;
      }

      // 🚀 性能优化：合并高亮函数 - 一次性处理所有高亮类型，避免多次遍历
      /**
       * 批量高亮函数 - 合并所有高亮操作，只遍历字符串一次
       * @param {string} text - 原始文本
       * @param {Object} config - 高亮配置
       * @returns {string} 高亮后的HTML
       */
      function applyBatchHighlight(text, config) {
        if (!text) return '';

        const {
          searchKeyword = '',
          searchHighlightClass = 'search-highlight',
          currentSearchHighlightClass = 'current-search-highlight',
          customHighlights = [],  // [{keyword, color}]
          currentMatchLine = -1,
          lineIndex = -1
        } = config;

        // 收集所有需要高亮的范围
        const ranges = [];

        // 1. 🔧 移除搜索关键词高亮（用户不希望搜索关键词被高亮）
        // 搜索功能仍然正常工作，只是不显示高亮效果

        // 2. 自定义高亮范围
        for (let i = 0; i < customHighlights.length; i++) {
          const h = customHighlights[i];
          if (!h.keyword) continue;
          const keywordLen = h.keyword.length;
          let pos = 0;
          while (pos < text.length) {
            const index = text.indexOf(h.keyword, pos);
            if (index === -1) break;
            ranges.push({
              start: index,
              end: index + keywordLen,
              type: 'custom',
              priority: 2,
              color: h.color
            });
            pos = index + keywordLen;
          }
        }

        // 如果没有高亮范围，直接返回
        if (ranges.length === 0) return text;

        // 按起始位置排序
        ranges.sort((a, b) => a.start - b.start);

        // 合并重叠的范围（按优先级保留）
        const mergedRanges = [];
        for (const range of ranges) {
          // 检查是否与已有范围重叠
          let overlapping = false;
          for (const existing of mergedRanges) {
            if (range.start < existing.end && range.end > existing.start) {
              overlapping = true;
              // 如果新范围优先级更高，替换旧范围
              if (range.priority > existing.priority) {
                Object.assign(existing, range);
              }
              break;
            }
          }
          if (!overlapping) {
            mergedRanges.push(range);
          }
        }

        // 构建高亮后的HTML
        let result = '';
        let lastPos = 0;

        for (const range of mergedRanges) {
          // 添加高亮前的文本
          if (range.start > lastPos) {
            result += escapeHtml(text.substring(lastPos, range.start));
          }

          // 添加高亮文本
          const matchText = text.substring(range.start, range.end);
          if (range.type === 'search') {
            const className = range.isCurrent ? currentSearchHighlightClass : searchHighlightClass;
            result += `<span class="${className}">${escapeHtml(matchText)}</span>`;
          } else if (range.type === 'custom') {
            result += `<span class="custom-highlight" style="background-color: ${range.color}80;">${escapeHtml(matchText)}</span>`;
          }

          lastPos = range.end;
        }

        // 添加剩余文本
        if (lastPos < text.length) {
          result += escapeHtml(text.substring(lastPos));
        }

        return result;
      }

      // 🚀 性能优化：异步批量高亮 - 使用 Worker 或主线程
      /**
       * 异步批量高亮函数 - 智能选择 Worker 或主线程
       * @param {Array<string>} lines - 文本行数组
       * @param {Object} config - 高亮配置
       * @returns {Promise<Array<string>>} 高亮后的HTML数组
       */
      async function applyBatchHighlightAsync(lines, config) {
        // 快速路径：小批量直接使用主线程（避免 Worker 通信开销）
        const WORKER_THRESHOLD = 50; // 超过50行使用Worker

        if (lines.length < WORKER_THRESHOLD) {
          // 主线程处理
          const results = new Array(lines.length);
          for (let i = 0; i < lines.length; i++) {
            results[i] = applyBatchHighlight(lines[i], {...config, lineIndex: i});
          }
          return results;
        }

        // 使用 Worker 处理大批量
        try {
          if (typeof window.HighlightWorkerManager !== 'undefined' &&
              window.HighlightWorkerManager.isAvailable()) {
            const { results } = await window.HighlightWorkerManager.batchHighlight(
              lines.map(line => line.text || line), // 处理可能的对象格式
              config
            );
            return results;
          }
        } catch (error) {
          console.warn('[Async Highlight] Worker failed, falling back to main thread:', error);
        }

        // Worker 不可用或失败，回退到主线程
        const results = new Array(lines.length);
        for (let i = 0; i < lines.length; i++) {
          results[i] = applyBatchHighlight(lines[i], {...config, lineIndex: i});
        }
        return results;
      }

      // 🚀 性能优化版：高亮函数 - 减少正则匹配和字符串替换开销
      function safeHighlight(text, keyword, replacement) {
        if (!text || !keyword) return text;

        // 🚀 早期退出优化：如果关键词不存在于文本中，直接返回原文本
        // 这避免了不必要的正则编译和字符串处理
        if (text.indexOf(keyword) === -1) {
          return text;
        }

        // 🚀 快速路径：如果没有HTML标签，使用更高效的方法
        if (text.indexOf('<') === -1) {
          // 🚀 直接使用indexOf + substring 替代正则，性能更好（大小写敏感匹配）
          const result = [];
          let pos = 0;
          const keywordLen = keyword.length;

          while (pos < text.length) {
            const index = text.indexOf(keyword, pos);
            if (index === -1) {
              result.push(text.substring(pos));
              break;
            }
            result.push(text.substring(pos, index));
            const match = text.substring(index, index + keywordLen);
            result.push(replacement(match));
            pos = index + keywordLen;
          }

          return result.join('');
        }

        // 🚀 优化路径：有HTML标签时，使用单次遍历解析
        // 🔧 大小写敏感：直接使用原始文本进行匹配
        const result = [];
        let pos = 0;
        let inTag = false;
        const keywordLen = keyword.length;

        while (pos < text.length) {
          // 检查是否进入HTML标签
          if (text[pos] === '<') {
            inTag = true;
            // 查找标签结束位置
            const tagEnd = text.indexOf('>', pos);
            if (tagEnd === -1) {
              // 没有结束标签，直接添加剩余文本
              result.push(text.substring(pos));
              break;
            }
            result.push(text.substring(pos, tagEnd + 1));
            pos = tagEnd + 1;
            inTag = false;
            continue;
          }

          // 不在标签中，尝试查找关键词（大小写敏感）
          if (!inTag) {
            const matchIndex = text.indexOf(keyword, pos);
            if (matchIndex !== -1 && matchIndex < pos + 100) {
              // 🚀 限制查找范围，避免过长的查找
              // 检查匹配位置是否在标签内（通过查找最近的<和>）
              const lastLt = text.lastIndexOf('<', matchIndex);
              const lastGt = text.lastIndexOf('>', matchIndex);
              if (lastLt === -1 || (lastGt !== -1 && lastGt > lastLt)) {
                // 确定不在标签内，进行替换
                result.push(text.substring(pos, matchIndex));
                const match = text.substring(matchIndex, matchIndex + keywordLen);
                result.push(replacement(match));
                pos = matchIndex + keywordLen;
                continue;
              }
            }
          }

          // 没有匹配，添加当前字符
          result.push(text[pos]);
          pos++;
        }

        return result.join('');
      }

      // 🚀 辅助函数：简单的替换（用于降级，大小写敏感）
      function simpleCaseInsensitiveReplace(text, keyword, replacement) {
        // 🔧 大小写敏感：直接使用原始文本进行匹配
        const result = [];
        let pos = 0;
        const keywordLen = keyword.length;

        while (pos < text.length) {
          const index = text.indexOf(keyword, pos);
          if (index === -1) {
            result.push(text.substring(pos));
            break;
          }
          result.push(text.substring(pos, index));
          const match = text.substring(index, index + keywordLen);
          result.push(replacement(match));
          pos = index + keywordLen;
        }

        return result.join('');
      }

      // 获取所有高亮规则（包括默认高亮和自定义高亮）
      function getAllHighlights() {
        return [...defaultHighlights, ...customHighlights];
      }

      // 加载过滤历史
      function loadFilterHistory() {
        const savedHistory = localStorage.getItem("logViewerFilterHistory");
        if (savedHistory) {
          filterHistory = JSON.parse(savedHistory);
        }
      }

      // 保存过滤历史
      function saveFilterHistory() {
        localStorage.setItem(
          "logViewerFilterHistory",
          JSON.stringify(filterHistory)
        );
      }


      // 添加过滤到历史记录
      function addToFilterHistory(filterText) {
        if (!filterText || filterText.trim() === "") return;

        // 检查是否已存在
        const existingIndex = filterHistory.indexOf(filterText);
        if (existingIndex !== -1) {
          // 如果已存在，则移动到最前面
          filterHistory.splice(existingIndex, 1);
        }

        // 添加到历史记录最前面
        filterHistory.unshift(filterText);

        // 限制历史记录数量
        if (filterHistory.length > 1000) {
          filterHistory = filterHistory.slice(0, 1000);
        }

        // 保存到本地存储
        saveFilterHistory();
      }

      // ===== 搜索历史记录功能 =====

      // 加载搜索历史
      function loadSearchHistory() {
        const savedHistory = localStorage.getItem("logViewerSearchHistory");
        if (savedHistory) {
          searchHistory = JSON.parse(savedHistory);
        }
      }

      // 保存搜索历史
      function saveSearchHistory() {
        localStorage.setItem(
          "logViewerSearchHistory",
          JSON.stringify(searchHistory)
        );
      }

      // 添加搜索到历史记录
      function addToSearchHistory(searchText) {
        if (!searchText || searchText.trim() === "") return;

        // 检查是否已存在
        const existingIndex = searchHistory.indexOf(searchText);
        if (existingIndex !== -1) {
          // 如果已存在，则移动到最前面
          searchHistory.splice(existingIndex, 1);
        }

        // 添加到历史记录最前面
        searchHistory.unshift(searchText);

        // 限制历史记录数量
        if (searchHistory.length > 1000) {
          searchHistory = searchHistory.slice(0, 1000);
        }

        // 保存到本地存储
        saveSearchHistory();
      }

      // ===== 过滤结果框正则搜索历史记录功能 =====

      // 加载过滤结果框搜索历史
      function loadFilteredPanelSearchHistory() {
        const savedHistory = localStorage.getItem("logViewerFilteredPanelSearchHistory");
        if (savedHistory) {
          filteredPanelSearchHistory = JSON.parse(savedHistory);
        }
      }

      // 保存过滤结果框搜索历史
      function saveFilteredPanelSearchHistory() {
        localStorage.setItem(
          "logViewerFilteredPanelSearchHistory",
          JSON.stringify(filteredPanelSearchHistory)
        );
      }

      // 添加过滤结果框搜索到历史记录
      function addToFilteredPanelSearchHistory(searchText) {
        if (!searchText || searchText.trim() === "") return;

        // 检查是否已存在
        const existingIndex = filteredPanelSearchHistory.indexOf(searchText);
        if (existingIndex !== -1) {
          // 如果已存在，则移动到最前面
          filteredPanelSearchHistory.splice(existingIndex, 1);
        }

        // 添加到历史记录最前面
        filteredPanelSearchHistory.unshift(searchText);

        // 限制历史记录数量
        if (filteredPanelSearchHistory.length > 1000) {
          filteredPanelSearchHistory = filteredPanelSearchHistory.slice(0, 1000);
        }

        // 保存到本地存储
        saveFilteredPanelSearchHistory();
      }

      // 过滤结果框搜索自动建议相关变量
      let filteredPanelSearchSuggestionsVisible = false;
      let selectedFilteredPanelSearchSuggestionIndex = -1;
      let filteredPanelSearchInputTimeout = null;

      // 显示过滤结果框搜索建议
      function showFilteredPanelSearchSuggestions() {
        const currentValue = filteredPanelSearchBox.value.trim();
        // 🚀 性能优化：使用textContent清空内容更快
        filteredPanelSearchSuggestions.textContent = '';
        selectedFilteredPanelSearchSuggestionIndex = -1;

        // 如果输入框为空，显示所有历史记录
        if (currentValue === '') {
          if (filteredPanelSearchHistory.length > 0) {
            filteredPanelSearchHistory.forEach((search, index) => {
              const item = document.createElement('div');
              item.className = 'filter-suggestion-item';
              item.textContent = search;
              item.addEventListener('click', () => {
                filteredPanelSearchBox.value = search;
                filteredPanelSearchKeyword = search;
                hideFilteredPanelSearchSuggestions();
                filteredPanelPerformSearch();
              });
              filteredPanelSearchSuggestions.appendChild(item);
            });
            filteredPanelSearchSuggestions.classList.add('visible');
            filteredPanelSearchSuggestionsVisible = true;
          }
        } else {
          // 根据输入内容过滤历史记录
          const filtered = filteredPanelSearchHistory.filter(search =>
            search.toLowerCase().includes(currentValue.toLowerCase())
          );

          if (filtered.length > 0) {
            filtered.forEach((search, index) => {
              const item = document.createElement('div');
              item.className = 'filter-suggestion-item';
              item.textContent = search;
              item.addEventListener('click', () => {
                filteredPanelSearchBox.value = search;
                filteredPanelSearchKeyword = search;
                hideFilteredPanelSearchSuggestions();
                filteredPanelPerformSearch();
              });
              filteredPanelSearchSuggestions.appendChild(item);
            });
            filteredPanelSearchSuggestions.classList.add('visible');
            filteredPanelSearchSuggestionsVisible = true;
          } else {
            hideFilteredPanelSearchSuggestions();
          }
        }
      }

      // 隐藏过滤结果框搜索建议
      function hideFilteredPanelSearchSuggestions() {
        filteredPanelSearchSuggestions.classList.remove('visible');
        filteredPanelSearchSuggestionsVisible = false;
        selectedFilteredPanelSearchSuggestionIndex = -1;
      }

      // 搜索自动建议相关变量
      let searchSuggestionsVisible = false;
      let selectedSearchSuggestionIndex = -1;
      let searchInputTimeout = null;

      // 获取搜索自动建议下拉菜单元素
      const searchSuggestions = document.getElementById("searchSuggestions");

      // 显示搜索建议
      function showSearchSuggestions() {
        const currentValue = searchBox.value.trim();
        // 🚀 性能优化：使用textContent清空内容更快
        searchSuggestions.textContent = '';
        selectedSearchSuggestionIndex = -1;

        // 如果输入框为空，显示所有历史记录
        if (currentValue === '') {
          if (searchHistory.length > 0) {
            searchHistory.forEach((search, index) => {
              const item = document.createElement('div');
              item.className = 'filter-suggestion-item';
              item.textContent = search;
              item.addEventListener('click', () => {
                searchBox.value = search;
                searchKeyword = search;
                hideSearchSuggestions();
                performSearch();
              });
              searchSuggestions.appendChild(item);
            });
            searchSuggestions.style.display = 'block';
            searchSuggestionsVisible = true;
          }
        } else {
          // 根据输入内容过滤历史记录
          const filtered = searchHistory.filter(search =>
            search.toLowerCase().includes(currentValue.toLowerCase())
          );

          if (filtered.length > 0) {
            filtered.forEach((search, index) => {
              const item = document.createElement('div');
              item.className = 'filter-suggestion-item';
              item.textContent = search;
              item.addEventListener('click', () => {
                searchBox.value = search;
                searchKeyword = search;
                hideSearchSuggestions();
                performSearch();
              });
              searchSuggestions.appendChild(item);
            });
            searchSuggestions.style.display = 'block';
            searchSuggestionsVisible = true;
          } else {
            hideSearchSuggestions();
          }
        }
      }

      // 隐藏搜索建议
      function hideSearchSuggestions() {
        searchSuggestions.style.display = 'none';
        searchSuggestionsVisible = false;
        selectedSearchSuggestionIndex = -1;
      }

      // 自动建议相关变量
      let filterSuggestionsVisible = false;
      let selectedSuggestionIndex = -1;
      let filterInputTimeout = null;
      
      // 二级过滤自动建议相关变量
      let secondaryFilterSuggestionsVisible = false;
      let selectedSecondarySuggestionIndex = -1;
      let secondaryFilterInputTimeout = null;
      let secondaryFilterHistory = []; // 二级过滤历史记录

      // 加载二级过滤历史
      function loadSecondaryFilterHistory() {
        const savedHistory = localStorage.getItem("logViewerSecondaryFilterHistory");
        if (savedHistory) {
          try {
            secondaryFilterHistory = JSON.parse(savedHistory);
          } catch (e) {
            secondaryFilterHistory = [];
          }
        }
      }

      // 保存二级过滤历史
      function saveSecondaryFilterHistory() {
        localStorage.setItem(
          "logViewerSecondaryFilterHistory",
          JSON.stringify(secondaryFilterHistory)
        );
      }

      // 添加二级过滤到历史记录
      function addToSecondaryFilterHistory(filterText) {
        if (!filterText || filterText.trim() === "") return;

        // 检查是否已存在
        const existingIndex = secondaryFilterHistory.indexOf(filterText);
        if (existingIndex !== -1) {
          secondaryFilterHistory.splice(existingIndex, 1);
        }

        // 添加到历史记录最前面
        secondaryFilterHistory.unshift(filterText);

        // 限制历史记录数量
        if (secondaryFilterHistory.length > 1000) {
          secondaryFilterHistory = secondaryFilterHistory.slice(0, 1000);
        }

        // 保存到本地存储
        saveSecondaryFilterHistory();
      }

      // 获取二级过滤自动建议下拉菜单元素
      const secondaryFilterSuggestions = document.getElementById("secondaryFilterSuggestions");

      // 显示过滤建议
      function showFilterSuggestions() {
        const currentValue = filterBox.value.trim();
        filterSuggestions.innerHTML = '';
        selectedSuggestionIndex = -1;

        // 如果输入框为空，显示所有历史记录
        if (currentValue === '') {
          if (filterHistory.length > 0) {
            filterHistory.forEach((filter, index) => {
              const item = document.createElement('div');
              item.className = 'filter-suggestion-item';
              item.textContent = filter;
              item.addEventListener('click', () => {
                filterBox.value = filter;
                applyFilter();
                hideFilterSuggestions();
              });
              filterSuggestions.appendChild(item);
            });
            filterSuggestions.classList.add('visible');
            filterSuggestionsVisible = true;
          }
          return;
        }

        // 如果输入框有内容，显示匹配的历史记录
        const matchingFilters = filterHistory.filter(filter =>
          filter.toLowerCase().includes(currentValue.toLowerCase())
        );

        if (matchingFilters.length > 0) {
          matchingFilters.forEach((filter, index) => {
            const item = document.createElement('div');
            item.className = 'filter-suggestion-item';
            item.textContent = filter;
            item.addEventListener('click', () => {
              filterBox.value = filter;
              applyFilter();
              hideFilterSuggestions();
            });
            filterSuggestions.appendChild(item);
          });
          filterSuggestions.classList.add('visible');
          filterSuggestionsVisible = true;
        }
      }
      
      // 隐藏过滤建议
      function hideFilterSuggestions() {
        filterSuggestions.classList.remove('visible');
        filterSuggestionsVisible = false;
        selectedSuggestionIndex = -1;
      }
      
      // 过滤框输入处理
      function handleFilterInput() {
        clearTimeout(filterInputTimeout);
        filterInputTimeout = setTimeout(() => {
          showFilterSuggestions();
        }, 200); // 延迟200ms显示建议
      }
      
      // 处理键盘导航
      function handleFilterKeyDown(e) {
        if (!filterSuggestionsVisible) return;
        
        const items = filterSuggestions.querySelectorAll('.filter-suggestion-item');
        if (items.length === 0) return;
        
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
          updateSelectedSuggestion(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
          updateSelectedSuggestion(items);
        } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
          e.preventDefault();
          filterBox.value = items[selectedSuggestionIndex].textContent;
          applyFilter();
          hideFilterSuggestions();
        } else if (e.key === 'Escape') {
          hideFilterSuggestions();
        }
      }
      
      // 更新选中的建议项样式
      function updateSelectedSuggestion(items) {
        items.forEach((item, index) => {
          if (index === selectedSuggestionIndex) {
            item.classList.add('selected');
          } else {
            item.classList.remove('selected');
          }
        });
      }
      
      // 显示二级过滤建议
      function showSecondaryFilterSuggestions() {
        const currentValue = filteredPanelFilterBox.value.trim();
        secondaryFilterSuggestions.innerHTML = '';
        selectedSecondarySuggestionIndex = -1;
        
        // 如果输入框为空，显示所有历史记录
        if (currentValue === '') {
          if (secondaryFilterHistory.length > 0) {
            secondaryFilterHistory.forEach((filter, index) => {
              const item = document.createElement('div');
              item.className = 'filter-suggestion-item';
              item.textContent = filter;
              item.addEventListener('click', () => {
                filteredPanelFilterBox.value = filter;
                applySecondaryFilter();
                hideSecondaryFilterSuggestions();
              });
              secondaryFilterSuggestions.appendChild(item);
            });
            secondaryFilterSuggestions.classList.add('visible');
            secondaryFilterSuggestionsVisible = true;
          }
          return;
        }
        
        // 如果输入框有内容，显示匹配的历史记录
        const matchingFilters = secondaryFilterHistory.filter(filter => 
          filter.toLowerCase().includes(currentValue.toLowerCase())
        );
        
        if (matchingFilters.length > 0) {
          matchingFilters.forEach((filter, index) => {
            const item = document.createElement('div');
            item.className = 'filter-suggestion-item';
            item.textContent = filter;
            item.addEventListener('click', () => {
              filteredPanelFilterBox.value = filter;
              applySecondaryFilter();
              hideSecondaryFilterSuggestions();
            });
            secondaryFilterSuggestions.appendChild(item);
          });
          secondaryFilterSuggestions.classList.add('visible');
          secondaryFilterSuggestionsVisible = true;
        }
      }
      
      // 隐藏二级过滤建议
      function hideSecondaryFilterSuggestions() {
        secondaryFilterSuggestions.classList.remove('visible');
        secondaryFilterSuggestionsVisible = false;
        selectedSecondarySuggestionIndex = -1;
      }
      
      // 二级过滤框输入处理
      function handleSecondaryFilterInput() {
        clearTimeout(secondaryFilterInputTimeout);
        secondaryFilterInputTimeout = setTimeout(() => {
          showSecondaryFilterSuggestions();
        }, 200); // 延迟200ms显示建议
      }
      
      // 处理二级过滤键盘导航
      function handleSecondaryFilterKeyDown(e) {
        if (!secondaryFilterSuggestionsVisible) return;
        
        const items = secondaryFilterSuggestions.querySelectorAll('.filter-suggestion-item');
        if (items.length === 0) return;
        
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedSecondarySuggestionIndex = Math.min(selectedSecondarySuggestionIndex + 1, items.length - 1);
          updateSelectedSecondarySuggestion(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedSecondarySuggestionIndex = Math.max(selectedSecondarySuggestionIndex - 1, -1);
          updateSelectedSecondarySuggestion(items);
        } else if (e.key === 'Enter' && selectedSecondarySuggestionIndex >= 0) {
          e.preventDefault();
          filteredPanelFilterBox.value = items[selectedSecondarySuggestionIndex].textContent;
          applySecondaryFilter();
          hideSecondaryFilterSuggestions();
        } else if (e.key === 'Escape') {
          hideSecondaryFilterSuggestions();
        }
      }
      
      // 更新选中的二级建议项样式
      function updateSelectedSecondarySuggestion(items) {
        items.forEach((item, index) => {
          if (index === selectedSecondarySuggestionIndex) {
            item.classList.add('selected');
          } else {
            item.classList.remove('selected');
          }
        });
      }
      
      // 添加过滤到二级过滤历史记录
      function addToSecondaryFilterHistory(filterText) {
        if (!filterText || filterText.trim() === "") return;
        
        // 避免重复
        const existingIndex = secondaryFilterHistory.indexOf(filterText);
        if (existingIndex !== -1) {
          secondaryFilterHistory.splice(existingIndex, 1);
        }
        
        // 添加到开头
        secondaryFilterHistory.unshift(filterText);
        
        // 限制历史记录数量
        if (secondaryFilterHistory.length > 1000) {
          secondaryFilterHistory = secondaryFilterHistory.slice(0, 1000);
        }
      }

      // 显示快捷键提示
      function showShortcutHint() {
        // 🔧 防御性检查：确保元素存在
        if (!shortcutHint) return;
        shortcutHint.style.display = "block";
        setTimeout(() => {
          if (shortcutHint) {
            shortcutHint.style.display = "none";
          }
        }, 3000);
      }

      // 水平滚动函数
      function scrollHorizontal(direction) {
        const currentScrollLeft = outer.scrollLeft;
        const newScrollLeft =
          direction === "left"
            ? Math.max(0, currentScrollLeft - HORIZONTAL_SCROLL_STEP)
            : currentScrollLeft + HORIZONTAL_SCROLL_STEP;

        outer.scrollTo({
          left: newScrollLeft,
          behavior: "smooth",
        });

        showShortcutHint();
      }

      // 初始化AI助手功能
      function initAiAssistant() {
        // AI助手面板关闭按钮事件
        aiAssistantClose.addEventListener("click", toggleAiAssistant);

        // AI助手URL跳转功能
        const aiAssistantGoBtn = document.getElementById('aiAssistantGoBtn');
        const aiAssistantBackBtn = document.getElementById('aiAssistantBackBtn');
        const aiAssistantOpenExternalBtn = document.getElementById('aiAssistantOpenExternalBtn');
        const aiAssistantUrlInput = document.getElementById('aiAssistantUrlInput');

        if (aiAssistantGoBtn) {
          aiAssistantGoBtn.addEventListener('click', navigateAiAssistant);
        }

        if (aiAssistantOpenExternalBtn) {
          aiAssistantOpenExternalBtn.addEventListener('click', openAiAssistantExternal);
        }

        if (aiAssistantBackBtn) {
          aiAssistantBackBtn.addEventListener('click', backToDoubao);
        }

        if (aiAssistantUrlInput) {
          // 回车键跳转
          aiAssistantUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
              navigateAiAssistant();
            }
          });
        }

        // AI助手面板四角调整大小事件
        aiResizeHandleNW.addEventListener("mousedown", (e) =>
          startAiAssistantCornerResize(e, "nw")
        );
        aiResizeHandleNE.addEventListener("mousedown", (e) =>
          startAiAssistantCornerResize(e, "ne")
        );
        aiResizeHandleSW.addEventListener("mousedown", (e) =>
          startAiAssistantCornerResize(e, "sw")
        );
        aiResizeHandleSE.addEventListener("mousedown", (e) =>
          startAiAssistantCornerResize(e, "se")
        );

        // AI助手面板双击头部最大化/还原
        aiAssistantHeader.addEventListener(
          "dblclick",
          toggleAiAssistantPanelMaximize
        );

        // 初始设置AI助手面板大小和位置 - 与过滤结果框一致
        initAiAssistantPanelSize();

        // 初始隐藏AI助手面板
        aiAssistantPanel.classList.remove("visible");

        // 新增：在AI助手面板上添加鼠标释放事件监听
        aiAssistantPanel.addEventListener("mouseup", handleAiAssistantMouseUp);

        // 新增：防止在AI助手面板上意外触发页面滚动
        aiAssistantPanel.addEventListener(
          "wheel",
          (e) => {
            e.stopPropagation();
          },
          { passive: false }
        );
      }

      // 新增：页面失去焦点时强制清理所有拖拽状态
      window.addEventListener("blur", () => {
        if (
          isAiAssistantResizing ||
          isCornerResizing
        ) {
          handleGlobalMouseUp();
        }
      });

      // 新增：鼠标移出窗口时强制清理拖拽状态
      document.addEventListener("mouseleave", (e) => {
        if (
          isAiAssistantResizing ||
          isCornerResizing
        ) {
          handleGlobalMouseUp();
        }
      });

      // 切换AI助手显示/隐藏
      function toggleAiAssistant() {
        isAiAssistantVisible = !isAiAssistantVisible;

        if (isAiAssistantVisible) {
          aiAssistantPanel.classList.add("visible");
        } else {
          aiAssistantPanel.classList.remove("visible");
        }

        showMessage(isAiAssistantVisible ? "AI助手已打开" : "AI助手已关闭");
      }

      // AI助手URL跳转功能
      function navigateAiAssistant() {
        const urlInput = document.getElementById('aiAssistantUrlInput');
        let url = urlInput.value.trim();

        if (!url) {
          showMessage('请输入网址');
          return;
        }

        // 如果没有协议，自动添加 https://
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }

        const aiFrame = document.getElementById('aiAssistantFrame');
        if (aiFrame) {
          aiFrame.src = url;
          showMessage('正在跳转到: ' + url);
        }
      }

      // 返回豆包AI助手
      function backToDoubao() {
        const aiFrame = document.getElementById('aiAssistantFrame');
        const urlInput = document.getElementById('aiAssistantUrlInput');

        if (aiFrame) {
          aiFrame.src = 'https://www.doubao.com/chat/';
          if (urlInput) {
            urlInput.value = '';
          }
          showMessage('已返回豆包AI助手');
        }
      }

      // 🌐 在外部浏览器打开URL（解决401认证问题）
      function openAiAssistantExternal() {
        const urlInput = document.getElementById('aiAssistantUrlInput');
        let url = urlInput.value.trim();

        if (!url) {
          // 如果输入框为空，尝试获取当前iframe的URL
          const aiFrame = document.getElementById('aiAssistantFrame');
          if (aiFrame && aiFrame.src) {
            url = aiFrame.src;
          }
        }

        if (!url) {
          showMessage('请输入要打开的网址');
          return;
        }

        // 如果没有协议，自动添加 https://
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }

        // 使用 Electron 的 shell.openExternal 在默认浏览器中打开
        if (typeof require !== 'undefined') {
          try {
            const { shell } = require('electron');
            shell.openExternal(url);
            showMessage('已在外部浏览器打开: ' + url);
          } catch (error) {
            console.error('打开外部浏览器失败:', error);
            // 降级方案：使用 window.open
            window.open(url, '_blank');
            showMessage('已在新窗口打开: ' + url);
          }
        } else {
          // 非Electron环境，直接使用 window.open
          window.open(url, '_blank');
          showMessage('已在新窗口打开: ' + url);
        }
      }

      // 新增：开始AI助手面板四角调整大小
      function startAiAssistantCornerResize(e, direction) {
        e.stopPropagation();
        isAiAssistantResizing = true;
        resizeDirection = direction;
        aiAssistantDragStartX = e.clientX;
        aiAssistantDragStartY = e.clientY;
        aiAssistantPanelStartX =
          parseInt(aiAssistantPanel.style.left) || aiAssistantPanel.offsetLeft;
        aiAssistantPanelStartY =
          parseInt(aiAssistantPanel.style.top) || aiAssistantPanel.offsetTop;
        aiAssistantPanelStartWidth = aiAssistantPanel.offsetWidth;
        aiAssistantPanelStartHeight = aiAssistantPanel.offsetHeight;

        // 优化：添加防止选中样式
        document.body.classList.add("panel-resizing");
        aiAssistantPanel.classList.add("panel-resizing");

        e.preventDefault();
      }

      // 新增：AI助手面板四角调整大小处理
      function handleAiAssistantCornerResize(e) {
        if (!isAiAssistantResizing) return;

        const deltaX = e.clientX - aiAssistantDragStartX;
        const deltaY = e.clientY - aiAssistantDragStartY;

        // 计算最小和最大尺寸
        const minWidth = 300;
        const minHeight = 200;
        const maxWidth = window.innerWidth;
        const maxHeight = window.innerHeight;

        // 考虑横向滚动条高度
        const hScrollHeight = 16;
        const maxBottom = window.innerHeight - hScrollHeight;

        let newX = aiAssistantPanelStartX;
        let newY = aiAssistantPanelStartY;
        let newWidth = aiAssistantPanelStartWidth;
        let newHeight = aiAssistantPanelStartHeight;

        // 根据调整方向计算新的位置和大小
        switch (resizeDirection) {
          case "nw": // 左上角：调整左边和上边
            newX = Math.min(
              aiAssistantPanelStartX + deltaX,
              aiAssistantPanelStartX + aiAssistantPanelStartWidth - minWidth
            );
            newY = Math.min(
              aiAssistantPanelStartY + deltaY,
              aiAssistantPanelStartY + aiAssistantPanelStartHeight - minHeight
            );
            newWidth = Math.max(
              minWidth,
              Math.min(maxWidth, aiAssistantPanelStartWidth - deltaX)
            );
            newHeight = Math.max(
              minHeight,
              Math.min(maxHeight, aiAssistantPanelStartHeight - deltaY)
            );
            break;
          case "ne": // 右上角：调整上边和宽度
            newY = Math.min(
              aiAssistantPanelStartY + deltaY,
              aiAssistantPanelStartY + aiAssistantPanelStartHeight - minHeight
            );
            newWidth = Math.max(
              minWidth,
              Math.min(maxWidth, aiAssistantPanelStartWidth + deltaX)
            );
            newHeight = Math.max(
              minHeight,
              Math.min(maxHeight, aiAssistantPanelStartHeight - deltaY)
            );
            break;
          case "sw": // 左下角：调整左边和高度
            newX = Math.min(
              aiAssistantPanelStartX + deltaX,
              aiAssistantPanelStartX + aiAssistantPanelStartWidth - minWidth
            );
            newWidth = Math.max(
              minWidth,
              Math.min(maxWidth, aiAssistantPanelStartWidth - deltaX)
            );
            newHeight = Math.max(
              minHeight,
              Math.min(
                maxHeight - hScrollHeight,
                aiAssistantPanelStartHeight + deltaY
              )
            );
            break;
          case "se": // 右下角：调整宽度和高度
            newWidth = Math.max(
              minWidth,
              Math.min(maxWidth, aiAssistantPanelStartWidth + deltaX)
            );
            newHeight = Math.max(
              minHeight,
              Math.min(
                maxHeight - hScrollHeight,
                aiAssistantPanelStartHeight + deltaY
              )
            );
            break;
        }

        // 确保面板底部不超过横向滚动条
        const panelBottom = newY + newHeight;
        if (panelBottom > maxBottom) {
          newHeight = maxBottom - newY;
        }

        // 确保面板顶部不低于工具栏
        const toolbarHeight = 25;
        if (newY < toolbarHeight) {
          newY = toolbarHeight;
          // 调整高度以保持面板底部位置
          newHeight =
            aiAssistantPanelStartHeight + (aiAssistantPanelStartY - newY);
        }

        // 应用新的位置和大小
        aiAssistantPanel.style.left = newX + "px";
        aiAssistantPanel.style.top = newY + "px";
        aiAssistantPanel.style.width = newWidth + "px";
        aiAssistantPanel.style.height = newHeight + "px";
      }

      // 修复AI助手面板最大化/恢复功能
      function toggleAiAssistantPanelMaximize() {
        if (!aiAssistantPanel.classList.contains("maximized")) {
          // 最大化面板
          // 保存当前状态（包括位置和大小）
          aiAssistantPanelState.isMaximized = false;
          aiAssistantPanelState.position = {
            left: aiAssistantPanel.style.left,
            top: aiAssistantPanel.style.top,
            width: aiAssistantPanel.style.width,
            height: aiAssistantPanel.style.height,
          };

          // 应用最大化样式
          aiAssistantPanel.classList.add("maximized");

          // 设置最大化后的位置和大小
          const toolbarHeight = 25; // 工具栏高度
          const hScrollHeight = 16; // 横向滚动条高度

          if (document.fullscreenElement) {
            // 全屏模式下
            aiAssistantPanel.style.left = "0";
            aiAssistantPanel.style.top = "0";
            aiAssistantPanel.style.width = "100%";
            aiAssistantPanel.style.height = "100vh";
          } else {
            // 正常模式下
            aiAssistantPanel.style.left = "0";
            aiAssistantPanel.style.top = toolbarHeight + "px";
            aiAssistantPanel.style.width = "100%";
            aiAssistantPanel.style.height =
              "calc(100% - " + (toolbarHeight + hScrollHeight) + "px)";
          }

          isAiAssistantPanelMaximized = true;
        } else {
          // 恢复面板
          aiAssistantPanel.classList.remove("maximized");
          isAiAssistantPanelMaximized = false;

          // 恢复之前保存的状态
          if (
            aiAssistantPanelState.position &&
            aiAssistantPanelState.position.width
          ) {
            aiAssistantPanel.style.left =
              aiAssistantPanelState.position.left || "";
            aiAssistantPanel.style.top =
              aiAssistantPanelState.position.top || "";
            aiAssistantPanel.style.width =
              aiAssistantPanelState.position.width || "";
            aiAssistantPanel.style.height =
              aiAssistantPanelState.position.height || "";
          } else {
            // 如果没有保存的状态，使用默认值
            initAiAssistantPanelSize();
          }
        }

        // 保存面板状态
        saveAiAssistantPanelState();
      }

      // 修复保存AI助手面板状态的函数
      function saveAiAssistantPanelState() {
        if (!isAiAssistantPanelMaximized) {
          aiAssistantPanelState.position = {
            left: aiAssistantPanel.style.left,
            top: aiAssistantPanel.style.top,
            width: aiAssistantPanel.style.width,
            height: aiAssistantPanel.style.height,
          };
        }
        aiAssistantPanelState.isMaximized = isAiAssistantPanelMaximized;
      }

      // 修复恢复AI助手面板状态的函数
      function restoreAiAssistantPanelState() {
        if (
          aiAssistantPanelState.position &&
          aiAssistantPanelState.position.width &&
          !aiAssistantPanelState.isMaximized
        ) {
          aiAssistantPanel.style.left =
            aiAssistantPanelState.position.left || "";
          aiAssistantPanel.style.top = aiAssistantPanelState.position.top || "";
          aiAssistantPanel.style.width =
            aiAssistantPanelState.position.width || "";
          aiAssistantPanel.style.height =
            aiAssistantPanelState.position.height || "";
        }
      }

      // 修复初始化AI助手面板大小函数，添加状态检查
      function initAiAssistantPanelSize() {
        // 检查是否已经有保存的状态
        if (
          aiAssistantPanelState.position &&
          aiAssistantPanelState.position.width &&
          aiAssistantPanelState.position.height &&
          !aiAssistantPanelState.isMaximized
        ) {
          // 如果有保存的状态且不是最大化状态，恢复状态
          restoreAiAssistantPanelState();
        } else {
          // 否则设置默认位置和大小
          const windowHeight = window.innerHeight;
          const toolbarHeight = 25; // 工具栏高度
          const hScrollHeight = 16; // 横向滚动条高度
          const halfHeight = (windowHeight - toolbarHeight - hScrollHeight) / 2;

          aiAssistantPanel.style.width = "600px";
          aiAssistantPanel.style.height = halfHeight + "px";
          aiAssistantPanel.style.left = window.innerWidth - 600 + "px"; // 放置在右侧
          aiAssistantPanel.style.top = toolbarHeight + halfHeight + "px"; // 放置在底部

          // 保存初始状态
          aiAssistantPanelState.isMaximized = false;
          saveAiAssistantPanelState();
        }
      }

      // 修复拖拽和调整大小结束时保存状态
      function handleAiAssistantMouseUp(e) {
        // 只有在调整大小状态下才执行清理
        if (isAiAssistantResizing) {
          isAiAssistantResizing = false;

          // 移除防止选中样式
          document.body.classList.remove("panel-resizing");
          aiAssistantPanel.classList.remove("panel-resizing");

          // 清理动画帧
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
          }

          // 保存面板状态
          saveAiAssistantPanelState();
        }
      }

      // 修复过滤面板的单击最大化/恢复功能
      function toggleFilterPanelMaximize() {
        if (!filteredPanel.classList.contains("maximized")) {
          // 最大化面板
          // 保存当前状态（包括位置和大小）
          filteredPanelState.isMaximized = false;
          filteredPanelState.position = {
            left: filteredPanel.style.left,
            top: filteredPanel.style.top,
            width: filteredPanel.style.width,
            height: filteredPanel.style.height,
          };

          // 🚀 清除所有内联样式，让 CSS 的 !important 生效
          filteredPanel.style.left = "";
          filteredPanel.style.top = "";
          filteredPanel.style.width = "";
          filteredPanel.style.height = "";

          // 应用最大化样式
          filteredPanel.classList.add("maximized");

          isFilterPanelMaximized = true;
        } else {
          // 恢复面板
          filteredPanel.classList.remove("maximized");
          isFilterPanelMaximized = false;

          // 恢复之前保存的状态
          if (filteredPanelState.position) {
            filteredPanel.style.left = filteredPanelState.position.left || "";
            filteredPanel.style.top = filteredPanelState.position.top || "";
            // 🔧 同步 --filtered-panel-top CSS变量
            if (filteredPanelState.position.top) {
              filteredPanel.style.setProperty('--filtered-panel-top', filteredPanelState.position.top);
            }
            // 🔧 不设置 width 和 height，让 CSS 的 left/right/bottom 控制尺寸
            filteredPanel.style.width = "";
            filteredPanel.style.height = "";
            // 🔧 明确清除 height，确保 CSS 的 bottom: 0 生效
            filteredPanel.style.removeProperty('height');
          } else {
            // 如果没有保存的状态，使用默认值
            initFilteredPanelSize();
          }
        }

        // 🔧 修复：更新虚拟滚动，强制重新计算高亮
        // 使用 requestAnimationFrame 确保 DOM 完全更新后再计算
        requestAnimationFrame(() => {
          setTimeout(() => {
            updateFilteredPanelVisibleLines(true);  // 强制重新计算高亮
          }, 50);
        });
      }

      // 修复拖拽和调整大小时的状态保存
      function handleGlobalMouseUp(e) {
        // 清理过滤面板的拖拽状态
        if (isCornerResizing) {
          isCornerResizing = false;
          document.body.classList.remove("panel-dragging", "panel-resizing");
          filteredPanel.classList.remove("panel-dragging", "panel-resizing");

          // 清理角落调整大小的 rAF
          if (cornerResizeRafId) {
            cancelAnimationFrame(cornerResizeRafId);
            cornerResizeRafId = null;
          }
          pendingCornerResizeData = null;

          // 保存面板状态
          if (!isFilterPanelMaximized) {
            saveFilteredPanelState();
          }
        }

        // 清理AI助手面板的调整大小状态
        if (isAiAssistantResizing) {
          isAiAssistantResizing = false;
          document.body.classList.remove("panel-resizing");
          aiAssistantPanel.classList.remove("panel-resizing");

          // 保存面板状态
          if (!isAiAssistantPanelMaximized) {
            saveAiAssistantPanelState();
          }
        }

        // 清理动画帧
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
      }

      // 新增：全局鼠标事件处理（包括AI助手面板）
      function handleGlobalMouseMove(e) {
        // 如果没有拖拽或调整状态，直接返回
        if (
          !isCornerResizing &&
          !isAiAssistantResizing
        )
          return;

        // 如果鼠标移出文档范围，清理状态
        if (
          e.clientX <= 0 ||
          e.clientY <= 0 ||
          e.clientX >= window.innerWidth ||
          e.clientY >= window.innerHeight
        ) {
          handleGlobalMouseUp();
          return;
        }

        // 使用requestAnimationFrame优化性能
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }

        animationFrameId = requestAnimationFrame(() => {
          if (isCornerResizing) {
            handleCornerResize(e);
          } else if (isAiAssistantResizing) {
            handleAiAssistantCornerResize(e);
          }
        });

        e.preventDefault();
      }

      function cleanupAllDragStates() {
        // 重置所有状态变量
        isAiAssistantResizing = false;
        isCornerResizing = false;
        isFileTreeResizing = false;
        isDragging = false;

        // 移除所有样式类
        document.body.classList.remove("panel-dragging", "panel-resizing");
        aiAssistantPanel.classList.remove("panel-resizing");
        filteredPanel.classList.remove("panel-dragging", "panel-resizing");

        // 清理文件树调整状态
        fileTreeResizer.classList.remove("resizing");
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";

        // 清理动画帧
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
        if (fileTreeResizeAnimationFrame) {
          cancelAnimationFrame(fileTreeResizeAnimationFrame);
          fileTreeResizeAnimationFrame = null;
        }
      }

      // 新增：检查正则表达式是否有效
      function isValidRegex(pattern) {
        if (!pattern || pattern.trim() === "") return false;

        try {
          new RegExp(pattern);
          return true;
        } catch (e) {
          return false;
        }
      }

      // 新增：更新正则表达式状态指示器
      function updateRegexStatus() {
        const pattern = filteredPanelFilterBox.value;

        if (!pattern || pattern.trim() === "") {
          filteredPanelRegexStatus.className = "regex-status idle";
          filteredPanelRegexStatus.title = "正则表达式状态";
          return;
        }

        if (isValidRegex(pattern)) {
          filteredPanelRegexStatus.className = "regex-status valid";
          filteredPanelRegexStatus.title = "正则表达式有效";
        } else {
          filteredPanelRegexStatus.className = "regex-status invalid";
          filteredPanelRegexStatus.title = "正则表达式无效";
        }
      }

      // 新增：初始化二级过滤功能
      function initSecondaryFilter() {
        // 监听二级过滤框输入
        filteredPanelFilterBox.addEventListener("input", (e) => {
          updateRegexStatus();
          handleSecondaryFilterInput();
        });

        // 监听回车键应用过滤
        filteredPanelFilterBox.addEventListener("keydown", (e) => {
          // 处理键盘导航
          handleSecondaryFilterKeyDown(e);
          
          if (e.key === "Enter") {
            applySecondaryFilter();
          }
        });
        
        // 二级过滤框聚焦事件
        filteredPanelFilterBox.addEventListener("focus", () => {
          // 聚焦时显示自动建议
          hideFilterSuggestions(); // 先隐藏一级过滤建议
          showSecondaryFilterSuggestions();
        });
        
        // 二级过滤框失焦事件
        filteredPanelFilterBox.addEventListener("blur", () => {
          // 延迟隐藏，以便点击建议项
          setTimeout(() => {
            hideSecondaryFilterSuggestions();
          }, 200);
        });

        // 初始更新状态
        updateRegexStatus();
      }

      // 新增：解析多个关键词（支持转义，只支持管道符 | 分隔，逗号作为普通字符）
      function parseKeywords(filterText) {
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
              keywords.push(currentKeyword.trim());
              currentKeyword = "";
            }
          } else {
            currentKeyword += char;  // 逗号作为普通字符处理
          }
        }

        if (currentKeyword) {
          keywords.push(currentKeyword.trim());
        }

        return keywords.filter((k) => k.length > 0);
      }

      // 新增：应用二级过滤
      async function applySecondaryFilter() {
        const filterText = filteredPanelFilterBox.value;

        if (!filterText || filterText.trim() === "") {
          clearSecondaryFilter();
          return;
        }

        // 🚀 智能跳转：记录当前查看位置的原始索引
        // 优先使用点击记录的行，如果没有则使用可见区域的中心行
        let rememberedOriginalIndex = -1;
        if (typeof lastClickedOriginalIndex !== 'undefined' && lastClickedOriginalIndex >= 0) {
          rememberedOriginalIndex = lastClickedOriginalIndex;
        } else if (lastClickedFilteredIndex >= 0 && filteredPanelAllOriginalIndices) {
          rememberedOriginalIndex = filteredPanelAllOriginalIndices[lastClickedFilteredIndex];
        } else if (filteredPanelAllOriginalIndices && filteredPanelAllOriginalIndices.length > 0) {
          // 尝试使用可见区域的中心行
          const filteredPanelContent = DOMCache.get('filteredPanelContent');
          if (filteredPanelContent) {
            const scrollTop = filteredPanelContent.scrollTop;
            const panelHeight = filteredPanelContent.clientHeight;
            const lineHeight = typeof filteredPanelLineHeight !== 'undefined' ? filteredPanelLineHeight : 19;
            const centerIndex = Math.floor((scrollTop / lineHeight + (scrollTop + panelHeight) / lineHeight) / 2);
            if (centerIndex >= 0 && centerIndex < filteredPanelAllOriginalIndices.length) {
              rememberedOriginalIndex = filteredPanelAllOriginalIndices[centerIndex];
            }
          }
        }
        console.log(`[SecondaryFilter] 📍 记忆位置: originalIndex=${rememberedOriginalIndex}`);

        // 添加到二级过滤历史记录
        addToSecondaryFilterHistory(filterText);

        // 解析多个关键词
        const keywords = parseKeywords(filterText);

        if (keywords.length === 0) {
          clearSecondaryFilter();
          return;
        }

        // 如果没有一级过滤结果，直接返回
        if (currentFilter.filteredLines.length === 0) {
          showMessage("请先应用一级过滤");
          return;
        }

        let filteredLines = [];
        let filteredToOriginalIndex = [];
        let filteredToPrimaryIndex = [];

        // 🔧 暂时禁用索引过滤，直接使用线性过滤确保准确性
        // 索引过滤在二级过滤场景下可能返回不准确的结果
        // TODO: 优化索引查询逻辑，确保在一级过滤结果基础上进行精确匹配

        // 📋 线性过滤逻辑（同步版本 + 智能匹配 + LRU缓存）
        // ========== 性能优化：智能匹配策略 ==========
        // 根据关键词类型选择最快的匹配方法
        // 🔧 大小写敏感：保留原始大小写进行匹配
        const compiledPatterns = keywords.map(keyword => {
          // 检查是否包含正则特殊字符
          const hasRegexSpecialChars = /[.*+?^${}()|[\]\\]/.test(keyword);

          // 优化1：纯文本关键词（最常见）- 直接使用 includes，最快
          // 🔧 改为大小写敏感匹配
          if (!hasRegexSpecialChars && !keyword.includes(" ")) {
            return {
              type: 'simple',
              keyword,
              test: (lineContent) => lineContent.includes(keyword)
            };
          }

          // 优化2：包含空格的短语 - 使用 includes
          // 🔧 改为大小写敏感匹配
          if (keyword.includes(" ")) {
            return {
              type: 'phrase',
              keyword,
              test: (lineContent) => lineContent.includes(keyword)
            };
          }

          // 优化3：包含特殊字符 - 使用正则表达式（最慢，但功能最强）
          // 🔧 改为大小写敏感匹配
          try {
            const regex = new RegExp(escapeRegExp(keyword));
            return {
              type: 'regex',
              keyword,
              regex,
              test: (lineContent) => regex.test(lineContent)
            };
          } catch (e) {
            // 降级：使用字符串匹配
            return {
              type: 'string',
              keyword,
              test: (lineContent) => lineContent.includes(keyword)
            };
          }
        });

        // ========== 性能优化：已移除HTML反转义，直接使用原始内容 ==========
        const getCachedUnescape = (line) => {
          // 直接返回原始内容，不进行任何转义/反转义操作
          return line;
        };

        // 执行过滤（同步循环，最快性能）
        for (let i = 0; i < currentFilter.filteredLines.length; i++) {
          const line = currentFilter.filteredLines[i];
          const lineContent = getCachedUnescape(line);

          // 检查是否包含任何关键词（使用预编译的模式）
          let matches = false;
          for (const pattern of compiledPatterns) {
            if (pattern.test(lineContent)) {
              matches = true;
              break;
            }
          }

          if (matches) {
            filteredLines.push(line);
            filteredToOriginalIndex.push(
              currentFilter.filteredToOriginalIndex[i]
            );
            filteredToPrimaryIndex.push(i);
          }
        }

        // 更新二级过滤状态
        secondaryFilter = {
          isActive: true,
          filterText: filterText,
          filterKeywords: keywords,
          filteredLines: filteredLines,
          filteredToOriginalIndex: filteredToOriginalIndex,
          filteredToPrimaryIndex: filteredToPrimaryIndex,
        };

        // 更新状态显示
        if (secondaryFilterStatus) {
          secondaryFilterStatus.textContent = `已应用 (${filteredLines.length}行)`;
          secondaryFilterStatus.className =
            "secondary-filter-status secondary-filter-active";
        }
        filteredPanelFilterStatus.textContent = `二级: ${filteredLines.length}行`;

        // 🔧 重要：不要调用 updateFilteredPanelWithSecondaryFilter() 来替换过滤面板
        // 过滤面板继续显示一级过滤结果，二级过滤结果显示在右侧边栏
        // updateFilteredPanelWithSecondaryFilter();

        // 🚀 显示右侧二级过滤边栏（在边栏中渲染二级过滤结果）
        showSecondaryFilterSidebar();
        renderSecondaryFilterSidebar();

        //showMessage(`二级过滤已应用，匹配 ${filteredLines.length} 行`);
      }

      // 新增：清除二级过滤
      function clearSecondaryFilter() {
        console.log('=== clearSecondaryFilter called ===');

        // 重置二级过滤状态
        secondaryFilter = {
          isActive: false,
          filterText: "",
          filterKeywords: [],
          filteredLines: [],
          filteredToOriginalIndex: [],
          filteredToPrimaryIndex: [],
        };

        // 清空Canvas渲染器
        if (window.SecondaryFilterCanvas) {
          window.SecondaryFilterCanvas.clear();
        }

        console.log('Secondary filter cleared');

        // 更新状态显示
        if (secondaryFilterStatus) {
          secondaryFilterStatus.textContent = "未应用";
          secondaryFilterStatus.className =
            "secondary-filter-status secondary-filter-inactive";
        }
        filteredPanelFilterStatus.textContent = "";
        filteredPanelFilterBox.value = "";

        // 更新正则表达式状态
        updateRegexStatus();

        // 🚀 新增：隐藏右侧二级过滤边栏
        hideSecondaryFilterSidebar();

        //showMessage('二级过滤已清除');
      }

      // 暴露到全局作用域，供HTML onclick使用
      window.applySecondaryFilter = applySecondaryFilter;
      window.clearSecondaryFilter = clearSecondaryFilter;

      // ==================== 二级过滤右侧边栏功能 ====================

      // 🚀 拖动和调整大小相关变量
      let isSecondaryFilterDragging = false;
      let isSecondaryFilterResizing = false;
      let secondaryFilterDragStart = { x: 0, y: 0 };
      let secondaryFilterDragOffset = { x: 0, y: 0 };
      let secondaryFilterResizeStart = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 };
      let secondaryFilterResizeDirection = '';

      // 最大化状态
      let isSecondaryFilterMaximized = false;
      let secondaryFilterOriginalState = { left: '', top: '', width: '', height: '' };

      /**
       * 显示二级过滤右侧边栏
       */
      function showSecondaryFilterSidebar() {
        if (!secondaryFilter.isActive) return;

        // 🔧 修复：只在非最大化状态下清除inline样式
        // 如果面板已经最大化，不要清除样式，否则会破坏布局
        if (!isSecondaryFilterMaximized) {
          secondaryFilterSidebar.style.left = '';
          secondaryFilterSidebar.style.top = '';
          secondaryFilterSidebar.style.right = '';
          secondaryFilterSidebar.style.bottom = '';
          secondaryFilterSidebar.style.width = '';
          secondaryFilterSidebar.style.height = '';
        }

        // 显示边栏
        secondaryFilterSidebar.classList.add("visible");

        // 🔧 修复：强制保护头部和工具栏的高度，防止被压缩
        requestAnimationFrame(() => {
          if (secondaryFilterSidebarHeader) {
            secondaryFilterSidebarHeader.style.minHeight = '16px';
            secondaryFilterSidebarHeader.style.height = 'auto';
          }
          const highlightToolbar = document.querySelector('.highlight-toolbar');
          if (highlightToolbar) {
            highlightToolbar.style.minHeight = '24px';
            highlightToolbar.style.height = 'auto';
          }
        });

        // 更新计数
        secondaryFilterCount.textContent = secondaryFilter.filteredLines.length;

        // 渲染边栏内容
        renderSecondaryFilterSidebar();

        // 绑定关闭按钮事件
        secondaryFilterSidebarClose.onclick = () => {
          hideSecondaryFilterSidebar();
        };

        // 绑定最大化按钮事件
        const maximizeBtn = document.getElementById('secondaryFilterSidebarMaximize');
        if (maximizeBtn) {
          maximizeBtn.onclick = () => {
            toggleSecondaryFilterMaximize();
          };
        }

        // 更新Canvas尺寸（在面板显示后）
        if (window.SecondaryFilterCanvas) {
          requestAnimationFrame(() => {
            window.SecondaryFilterCanvas.forceUpdate();
          });
        }

        // 🚀 初始化拖动功能
        initSecondaryFilterDrag();

        // 🚀 初始化调整大小功能
        initSecondaryFilterResize();

        // 🚀 初始化高度调整手柄
        initHeightResizeHandle();

        // 🚀 初始化关键词高亮功能
        initHighlightKeywords();
      }

      /**
       * 初始化关键词高亮功能
       */
      function initHighlightKeywords() {
        const input = document.getElementById('highlightKeywordInput');
        const addBtn = document.getElementById('addHighlightBtn');
        const colorPicker = document.getElementById('highlightColorPicker');
        const list = document.getElementById('highlightKeywordsList');

        if (!input || !addBtn || !list) return;

        // 添加高亮关键词
        function addKeyword() {
          const keyword = input.value.trim();
          if (!keyword) return;

          if (window.SecondaryFilterCanvas) {
            // 获取颜色选择器的颜色
            const selectedColor = colorPicker ? colorPicker.value : null;
            const highlight = window.SecondaryFilterCanvas.addHighlightKeyword(keyword, selectedColor);
            if (highlight) {
              input.value = '';
              renderHighlightTags();
            } else {
              // 已存在
              input.value = '';
            }
          }
        }

        // 渲染高亮标签
        function renderHighlightTags() {
          list.innerHTML = '';
          const keywords = window.SecondaryFilterCanvas ? window.SecondaryFilterCanvas.getHighlightKeywords() : [];

          keywords.forEach(h => {
            const tag = document.createElement('div');
            tag.className = 'highlight-keyword-tag';
            tag.style.backgroundColor = h.color;
            tag.title = `关键词: ${h.keyword}\n颜色: ${h.color}`;
            tag.innerHTML = `
              <span>${escapeHtml(h.keyword)}</span>
              <span class="remove-highlight" data-keyword="${escapeHtml(h.keyword)}">×</span>
            `;
            list.appendChild(tag);
          });

          // 绑定删除事件
          list.querySelectorAll('.remove-highlight').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const keyword = btn.getAttribute('data-keyword');
              if (window.SecondaryFilterCanvas) {
                window.SecondaryFilterCanvas.removeHighlightKeyword(keyword);
                renderHighlightTags();
              }
            });
          });
        }

        // 绑定事件
        addBtn.addEventListener('click', addKeyword);

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addKeyword();
          }
        });

        // 初始渲染
        renderHighlightTags();
      }

      // HTML转义函数
      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      /**
       * 切换二级过滤面板最大化/还原
       */
      function toggleSecondaryFilterMaximize() {
        if (isSecondaryFilterMaximized) {
          // 还原
          secondaryFilterSidebar.style.left = secondaryFilterOriginalState.left;
          secondaryFilterSidebar.style.top = secondaryFilterOriginalState.top;
          secondaryFilterSidebar.style.right = secondaryFilterOriginalState.right;
          secondaryFilterSidebar.style.bottom = secondaryFilterOriginalState.bottom;
          secondaryFilterSidebar.style.width = secondaryFilterOriginalState.width;
          secondaryFilterSidebar.style.height = secondaryFilterOriginalState.height;
          secondaryFilterSidebar.classList.remove('maximized');
          isSecondaryFilterMaximized = false;
        } else {
          // 最大化 - 保存当前状态
          const rect = secondaryFilterSidebar.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(secondaryFilterSidebar);
          secondaryFilterOriginalState = {
            left: secondaryFilterSidebar.style.left || computedStyle.left,
            top: secondaryFilterSidebar.style.top || computedStyle.top,
            right: secondaryFilterSidebar.style.right || computedStyle.right,
            bottom: secondaryFilterSidebar.style.bottom || computedStyle.bottom,
            width: secondaryFilterSidebar.style.width || computedStyle.width,
            height: secondaryFilterSidebar.style.height || computedStyle.height
          };

          // 清除内联样式，让CSS的maximized样式完全控制
          secondaryFilterSidebar.style.left = '';
          secondaryFilterSidebar.style.top = '';
          secondaryFilterSidebar.style.right = '';
          secondaryFilterSidebar.style.bottom = '';
          secondaryFilterSidebar.style.width = '';
          secondaryFilterSidebar.style.height = '';

          secondaryFilterSidebar.classList.add('maximized');
          isSecondaryFilterMaximized = true;
        }

        // 更新Canvas渲染器
        if (window.SecondaryFilterCanvas) {
          window.SecondaryFilterCanvas.forceUpdate();
        }
      }

      /**
       * 初始化拖动功能
       */
      function initSecondaryFilterDrag() {
        // 头部拖动
        secondaryFilterSidebarHeader.addEventListener('mousedown', (e) => {
          // 如果点击的是关闭按钮或最大化按钮，不触发拖动
          if (e.target === secondaryFilterSidebarClose) return;
          if (e.target.id === 'secondaryFilterSidebarMaximize') return;
          // 如果点击的是高度调整手柄或其子元素，不触发拖动
          if (e.target.id === 'secondaryFilterHeightHandle' ||
              e.target.closest('#secondaryFilterHeightHandle')) return;

          isSecondaryFilterDragging = true;
          secondaryFilterDragStart.x = e.clientX;
          secondaryFilterDragStart.y = e.clientY;

          const rect = secondaryFilterSidebar.getBoundingClientRect();
          secondaryFilterDragOffset.x = rect.left;
          secondaryFilterDragOffset.y = rect.top;

          // 改为使用 top/left 定位
          secondaryFilterSidebar.style.right = 'auto';
          secondaryFilterSidebar.style.bottom = 'auto';
          secondaryFilterSidebar.style.left = rect.left + 'px';
          secondaryFilterSidebar.style.top = rect.top + 'px';

          document.body.style.userSelect = 'none';
          document.body.style.webkitUserSelect = 'none';

          e.preventDefault();
        });

        // 全局鼠标移动和释放（只绑定一次）
        if (!secondaryFilterSidebar.hasAttribute('data-drag-init')) {
          document.addEventListener('mousemove', handleSecondaryFilterDrag);
          document.addEventListener('mouseup', stopSecondaryFilterDrag);
          secondaryFilterSidebar.setAttribute('data-drag-init', 'true');
        }
      }

      /**
       * 处理拖动
       */
      function handleSecondaryFilterDrag(e) {
        if (!isSecondaryFilterDragging) return;

        const deltaX = e.clientX - secondaryFilterDragStart.x;
        const deltaY = e.clientY - secondaryFilterDragStart.y;

        const newLeft = secondaryFilterDragOffset.x + deltaX;
        const newTop = secondaryFilterDragOffset.y + deltaY;

        // 限制在窗口范围内
        const maxX = window.innerWidth - 100;
        const maxY = window.innerHeight - 100;

        secondaryFilterSidebar.style.left = Math.max(0, Math.min(newLeft, maxX)) + 'px';
        secondaryFilterSidebar.style.top = Math.max(0, Math.min(newTop, maxY)) + 'px';

        // 暂停Canvas渲染以提升性能
        if (window.SecondaryFilterCanvas) {
          window.SecondaryFilterCanvas.pauseRendering();
        }
      }

      /**
       * 停止拖动
       */
      function stopSecondaryFilterDrag() {
        if (isSecondaryFilterDragging) {
          isSecondaryFilterDragging = false;
          document.body.style.userSelect = '';
          document.body.style.webkitUserSelect = '';

          // 恢复Canvas渲染
          if (window.SecondaryFilterCanvas) {
            window.SecondaryFilterCanvas.resumeRendering();
          }
        }
      }

      /**
       * 初始化调整大小功能
       */
      function initSecondaryFilterResize() {
        const handles = secondaryFilterSidebar.querySelectorAll('.secondary-filter-resize-handle');

        handles.forEach(handle => {
          handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            isSecondaryFilterResizing = true;
            secondaryFilterResizeDirection = handle.dataset.direction;

            const rect = secondaryFilterSidebar.getBoundingClientRect();
            secondaryFilterResizeStart = {
              x: e.clientX,
              y: e.clientY,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              left: rect.left
            };

            secondaryFilterSidebar.classList.add('resizing');
            document.body.style.userSelect = 'none';
            document.body.style.webkitUserSelect = 'none';

            // 在开始调整时暂停Canvas渲染
            if (window.SecondaryFilterCanvas) {
              window.SecondaryFilterCanvas.pauseRendering();
            }
          });
        });

        // 全局鼠标移动和释放（只绑定一次）
        if (!secondaryFilterSidebar.hasAttribute('data-resize-init')) {
          document.addEventListener('mousemove', handleSecondaryFilterResize);
          document.addEventListener('mouseup', stopSecondaryFilterResize);
          secondaryFilterSidebar.setAttribute('data-resize-init', 'true');
        }
      }

      /**
       * 处理调整大小
       */
      function handleSecondaryFilterResize(e) {
        if (!isSecondaryFilterResizing) return;

        const deltaX = e.clientX - secondaryFilterResizeStart.x;
        const deltaY = e.clientY - secondaryFilterResizeStart.y;

        let newWidth = secondaryFilterResizeStart.width;
        let newHeight = secondaryFilterResizeStart.height;
        let newTop = secondaryFilterResizeStart.top;
        let newLeft = secondaryFilterResizeStart.left;

        // 根据方向调整
        if (secondaryFilterResizeDirection.includes('e')) {
          newWidth = Math.max(200, secondaryFilterResizeStart.width + deltaX);
        }
        if (secondaryFilterResizeDirection.includes('w')) {
          newWidth = Math.max(200, secondaryFilterResizeStart.width - deltaX);
          newLeft = secondaryFilterResizeStart.left + deltaX;
        }
        if (secondaryFilterResizeDirection.includes('s')) {
          newHeight = Math.max(150, secondaryFilterResizeStart.height + deltaY);
        }
        if (secondaryFilterResizeDirection.includes('n')) {
          newHeight = Math.max(150, secondaryFilterResizeStart.height - deltaY);
          newTop = secondaryFilterResizeStart.top + deltaY;
        }

        // 直接应用新尺寸（移除节流，使用CSS transform加速）
        secondaryFilterSidebar.style.width = newWidth + 'px';
        secondaryFilterSidebar.style.height = newHeight + 'px';

        if (secondaryFilterResizeDirection.includes('w')) {
          secondaryFilterSidebar.style.left = newLeft + 'px';
        }
        if (secondaryFilterResizeDirection.includes('n')) {
          secondaryFilterSidebar.style.top = newTop + 'px';
        }
      }

      /**
       * 停止调整大小
       */
      function stopSecondaryFilterResize() {
        if (isSecondaryFilterResizing) {
          isSecondaryFilterResizing = false;
          secondaryFilterSidebar.classList.remove('resizing');
          document.body.style.userSelect = '';
          document.body.style.webkitUserSelect = '';

          // 恢复Canvas渲染
          if (window.SecondaryFilterCanvas) {
            window.SecondaryFilterCanvas.resumeRendering();
          }
        }
      }

      /**
       * 初始化高度调整手柄
       */
      let isHeightResizing = false;
      let heightResizeStart = { y: 0, height: 0, scrollPos: null };
      let heightResizeInitialized = false; // 🔧 修复：防止重复初始化事件监听器

      function initHeightResizeHandle() {
        const heightHandle = document.getElementById('secondaryFilterHeightHandle');
        if (!heightHandle) return;

        // 🔧 修复：如果已经初始化过，不再重复添加事件监听器
        if (heightResizeInitialized) {
          console.log('[HeightResizeHandle] 事件监听器已初始化，跳过重复绑定');
          return;
        }

        heightHandle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          isHeightResizing = true;

          heightResizeStart.y = e.clientY;
          const rect = secondaryFilterSidebar.getBoundingClientRect();
          heightResizeStart.height = rect.height;

          // 立即重置定位，确保底部固定
          secondaryFilterSidebar.style.top = '';
          secondaryFilterSidebar.style.bottom = '0';
          secondaryFilterSidebar.style.left = '0';
          secondaryFilterSidebar.style.right = '0';
          secondaryFilterSidebar.style.width = 'auto';

          // 保存Canvas滚动位置
          if (window.SecondaryFilterCanvas) {
            heightResizeStart.scrollPos = window.SecondaryFilterCanvas.getScrollPosition();
            window.SecondaryFilterCanvas.pauseRendering();
          }

          document.body.style.userSelect = 'none';
          document.body.style.webkitUserSelect = 'none';
        });

        // 全局鼠标移动和释放事件
        document.addEventListener('mousemove', handleHeightResize);
        document.addEventListener('mouseup', stopHeightResize);

        // 🔧 标记为已初始化
        heightResizeInitialized = true;
        console.log('[HeightResizeHandle] 事件监听器初始化完成');
      }

      /**
       * 处理高度调整
       */
      function handleHeightResize(e) {
        if (!isHeightResizing) return;

        const deltaY = heightResizeStart.y - e.clientY; // 向上拖动为正值
        const newHeight = Math.max(150, Math.min(window.innerHeight - 60, heightResizeStart.height + deltaY));

        // 强制使用 !important 确保底部固定（通过setProperty）
        secondaryFilterSidebar.style.setProperty('top', 'auto', 'important');
        secondaryFilterSidebar.style.setProperty('bottom', '0', 'important');
        secondaryFilterSidebar.style.setProperty('left', '0', 'important');
        secondaryFilterSidebar.style.setProperty('right', '0', 'important');
        secondaryFilterSidebar.style.setProperty('width', 'auto', 'important');
        secondaryFilterSidebar.style.setProperty('height', newHeight + 'px', 'important');
      }

      /**
       * 停止高度调整
       */
      function stopHeightResize() {
        if (isHeightResizing) {
          isHeightResizing = false;
          document.body.style.userSelect = '';
          document.body.style.webkitUserSelect = '';

          // 恢复Canvas渲染并恢复滚动位置
          if (window.SecondaryFilterCanvas && heightResizeStart.scrollPos) {
            window.SecondaryFilterCanvas.resumeRendering();
            window.SecondaryFilterCanvas.forceUpdate();

            // 使用requestAnimationFrame确保在Canvas更新后恢复滚动位置
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                window.SecondaryFilterCanvas.setScrollPosition(
                  heightResizeStart.scrollPos.x,
                  heightResizeStart.scrollPos.y
                );
              });
            });
          }
        }
      }

      /**
       * 隐藏二级过滤右侧边栏
       */
      function hideSecondaryFilterSidebar() {
        secondaryFilterSidebar.classList.remove("visible");
        // 重置最大化状态
        if (isSecondaryFilterMaximized) {
          isSecondaryFilterMaximized = false;
          secondaryFilterSidebar.classList.remove('maximized');
        }
      }

      /**
       * 渲染二级过滤边栏内容
       */
      function renderSecondaryFilterSidebar() {
        if (!secondaryFilter.isActive) return;

        const lines = secondaryFilter.filteredLines;
        const primaryIndices = secondaryFilter.filteredToPrimaryIndex;
        const originalIndices = secondaryFilter.filteredToOriginalIndex;
        const keywords = secondaryFilter.filterKeywords;

        // 使用Canvas渲染
        if (window.SecondaryFilterCanvas) {
          // 直接使用原始行数据，Canvas渲染器不需要HTML转义和高亮
          window.SecondaryFilterCanvas.setData(lines, primaryIndices, originalIndices);
        } else {
          // Canvas不可用时的降级处理（使用DOM渲染）
          console.warn('[SecondaryFilter] Canvas渲染器不可用，使用DOM渲染');
          renderWithDOM(lines, primaryIndices, originalIndices, keywords);
        }
      }

      // DOM渲染降级方案
      function renderWithDOM(lines, primaryIndices, originalIndices, keywords) {
        // 清空内容
        secondaryFilterSidebarVirtualContent.innerHTML = "";

        // 设置占位符高度
        const lineHeight = 30; // 边栏行高
        const totalHeight = lines.length * lineHeight;
        secondaryFilterSidebarPlaceholder.style.height = totalHeight + "px";

        // 渲染所有行
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < lines.length; i++) {
          const lineContent = lines[i];
          const primaryIndex = primaryIndices[i];
          const originalIndex = originalIndices[i];

          const lineElement = document.createElement("div");
          lineElement.className = "secondary-filter-result-line";
          lineElement.dataset.index = i;
          lineElement.dataset.primaryIndex = primaryIndex;
          lineElement.dataset.originalIndex = originalIndex;

          // 检查是否是文件头
          const isFileHeader = lineContent && lineContent.startsWith("=== 文件:");
          if (isFileHeader) {
            lineElement.classList.add("file-header");
          }




          // 高亮匹配的关键词
          let displayContent = escapeHtmlSecondaryFilter(lineContent);
          displayContent = highlightSecondaryFilterKeywords(displayContent, keywords);

          // 添加行号（使用原始日志行号）
          if (!isFileHeader) {
            const lineNumber = originalIndex + 1;
            displayContent = `<span class="line-number">${lineNumber}</span>${displayContent}`;
          }

          lineElement.innerHTML = displayContent;
          lineElement.title = lineContent;

          // 🚀 优化：点击事件：跳转到过滤面板对应位置
          // 使用事件委托或直接绑定，避免每次点击都查询所有行
          lineElement.addEventListener("click", (e) => {
            // 阻止事件冒泡，避免触发其他点击事件
            e.stopPropagation();

            // 直接调用跳转函数
            jumpToPrimaryFilterLine(primaryIndex);

            // 🚀 优化：只更新当前行的选中状态，避免查询所有行
            const sidebarContent = secondaryFilterSidebarVirtualContent;
            const prevSelected = sidebarContent.querySelector(".secondary-filter-result-line.selected");
            if (prevSelected && prevSelected !== lineElement) {
              prevSelected.classList.remove("selected");
            }
            lineElement.classList.add("selected");
          });

          // 设置位置
          lineElement.style.position = "absolute";
          lineElement.style.top = (i * lineHeight) + "px";
          lineElement.style.width = "max-content";
          lineElement.style.minWidth = "100%";
          lineElement.style.boxSizing = "border-box";

          fragment.appendChild(lineElement);
        }

        secondaryFilterSidebarVirtualContent.appendChild(fragment);
      }

      /**
       * 跳转到过滤面板对应位置
       * 🚀 优化：直接定位，避免遍历，提升性能
       */
      // 缓存上次选中的行，避免重复查询
      let lastSelectedFilteredLine = null;
      let lastSelectedPrimaryIndex = -1; // 新增：保存最后选中的primaryIndex

      function jumpToPrimaryFilterLine(primaryIndex) {
        if (!filteredPanel || !filteredPanelContent) return;

        // 保存选中的primaryIndex
        lastSelectedPrimaryIndex = primaryIndex;

        // 确保过滤面板可见
        if (filteredPanel.style.display === "none" || !filteredPanel.classList.contains("visible")) {
          toggleFilteredPanelVisibility();
        }

        // 1. 计算并滚动到目标位置
        const containerHeight = filteredPanelContent.clientHeight;
        const targetTop = primaryIndex * filteredPanelLineHeight;
        const scrollTop = targetTop - containerHeight / 2 + filteredPanelLineHeight / 2;
        filteredPanelContent.scrollTop = Math.max(0, scrollTop);

        // 2. 🚀 多次尝试高亮，确保成功
        const tryHighlight = (attempt) => {
          // 🚀 直接使用属性选择器定位目标行
          const targetLine = filteredPanelVirtualContent.querySelector(
            `[data-filtered-index="${primaryIndex}"]`
          );

          if (targetLine) {
            applyHighlight(targetLine);

            // 🚀 直接获取原始索引并跳转
            const originalIndex = parseInt(targetLine.dataset.originalIndex);
            if (Number.isFinite(originalIndex)) {
              // 直接跳转到主日志框对应行
              jumpToOriginalLine(originalIndex);
            }
            return true; // 成功
          }

          // 如果尝试次数未达上限，继续重试
          if (attempt < 5) {
            const delay = 50 * attempt; // 递增延迟：50, 100, 150, 200, 250
            setTimeout(() => {
              tryHighlight(attempt + 1);
            }, delay);
          } else {
            console.log('[jumpToPrimaryFilterLine] 无法找到目标行，primaryIndex=', primaryIndex);
          }
          return false;
        };

        // 开始尝试高亮
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              tryHighlight(0);
            });
          });
        });
      }

      // 新增：应用高亮的辅助函数
      function applyHighlight(targetLine) {
        if (!targetLine) return;

        // 🚀 只更新必要的样式，避免全量遍历
        if (lastSelectedFilteredLine && lastSelectedFilteredLine !== targetLine) {
          lastSelectedFilteredLine.classList.remove("selected");
          lastSelectedFilteredLine.classList.remove("highlighted");
        }
        targetLine.classList.add("selected");
        targetLine.classList.add("highlighted");
        lastSelectedFilteredLine = targetLine;
      }

      // 新增：重新应用高亮（供虚拟滚动更新后调用）
      function restoreHighlight() {
        if (lastSelectedPrimaryIndex >= 0) {
          const targetLine = filteredPanelVirtualContent.querySelector(
            `[data-filtered-index="${lastSelectedPrimaryIndex}"]`
          );
          if (targetLine) {
            applyHighlight(targetLine);
          }
        }
      }

      /**
       * HTML转义函数（用于二级过滤）
       */
      function escapeHtmlSecondaryFilter(text) {
        if (!text) return "";
        return text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      /**
       * 高亮二级过滤关键词
       */
      function highlightSecondaryFilterKeywords(text, keywords) {
        if (!keywords || keywords.length === 0) return text;

        let result = text;
        for (const keyword of keywords) {
          if (!keyword) continue;
          // 🚀 性能优化：使用缓存的正则表达式，避免重复创建
          try {
            const regex = getCachedRegex(keyword);  // 复用缓存
            result = result.replace(regex, (match) => {
              return `<span class="secondary-filter-match-highlight">${match}</span>`;
            });
          } catch (e) {
            // 正则失败，使用字符串替换
            const lowerKeyword = keyword.toLowerCase();
            const lowerText = result.toLowerCase();
            let idx = 0;
            while ((idx = lowerText.indexOf(lowerKeyword, idx)) !== -1) {
              const before = result.slice(0, idx);
              const matched = result.slice(idx, idx + keyword.length);
              const after = result.slice(idx + keyword.length);
              result = before + `<span class="secondary-filter-match-highlight">${matched}</span>` + after;
              idx += matched.length + 45; // 跳过高亮标签长度
            }
          }
        }
        return result;
      }

      // 正则转义函数
      function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }

      // 暴露新函数到全局
      window.showSecondaryFilterSidebar = showSecondaryFilterSidebar;
      window.hideSecondaryFilterSidebar = hideSecondaryFilterSidebar;
      window.restoreHighlight = restoreHighlight;

      // ==================== 二级过滤右侧边栏功能结束 ====================

      // 新增：使用二级过滤更新过滤面板
      function updateFilteredPanelWithSecondaryFilter(preserveFilteredIndex = -1) {
        if (!secondaryFilter.isActive) {
          // 如果没有有效的二级过滤，显示一级过滤结果
          updateFilteredPanel();
          return;
        }

        // 🔧 保存当前搜索状态（如果有的话）
        const hadActiveSearch = filteredPanelSearchKeyword !== "";
        const savedSearchKeyword = filteredPanelSearchKeyword;

        // 显示二级过滤结果（即使结果为空也要显示）
        filteredPanelAllLines = secondaryFilter.filteredLines;
        filteredPanelAllOriginalIndices =
          secondaryFilter.filteredToOriginalIndex;
        filteredPanelAllPrimaryIndices = secondaryFilter.filteredToPrimaryIndex;

        // 更新计数
        filteredCount.textContent = filteredPanelAllLines.length;

        // 🚀 关键修复：强制重置可见区域为-1，确保下次一定会重新渲染
        filteredPanelVisibleStart = -1;
        filteredPanelVisibleEnd = -1;

        // 设置占位元素高度
        const totalHeight =
          filteredPanelAllLines.length * filteredPanelLineHeight;
        filteredPanelPlaceholder.style.height = totalHeight + "px";

        // 清空虚拟内容
        filteredPanelVirtualContent.innerHTML = "";

        // 🚀 如果指定了要保留的索引，则保留；否则重置
        if (preserveFilteredIndex >= 0) {
          lastClickedFilteredIndex = preserveFilteredIndex;
        } else {
          lastClickedFilteredIndex = -1;
        }

        // 🚀 只在不需要跳转时才重置滚动位置到顶部
        if (preserveFilteredIndex < 0) {
          filteredPanelContent.scrollTop = 0;
        }

        // 🔧 重置过滤结果框搜索状态（需要重新搜索以适应新的数据）
        filteredPanelResetSearch();

        // 🔧 如果之前有搜索，恢复搜索关键词并重新执行搜索
        if (hadActiveSearch && savedSearchKeyword) {
          filteredPanelSearchKeyword = savedSearchKeyword;
          filteredPanelSearchBox.value = savedSearchKeyword;
          filteredPanelPerformSearch();
        }

        // 延迟更新可见行，确保DOM已更新
        setTimeout(() => {
          updateFilteredPanelVisibleLines();
        }, 0);
      }


      // 修改：创建过滤行元素，考虑二级过滤
      // 🚀 优化：简化版，去掉所有HTML高亮操作，只保留基础功能
      function createFilteredLineElement(index) {
        const lineElement = document.createElement("div");
        lineElement.className = "filtered-log-line";

        // 存储原始行号
        lineElement.dataset.originalIndex =
          filteredPanelAllOriginalIndices[index];
        lineElement.dataset.filteredIndex = index;

        const lineContent = filteredPanelAllLines[index];
        const isFileHeader = lineContent && lineContent.startsWith("=== 文件:");

        if (isFileHeader) {
          lineElement.classList.add("file-header");
        }

        // 如果是二级过滤，也存储一级过滤的索引
        if (
          secondaryFilter.isActive &&
          filteredPanelAllPrimaryIndices.length > index
        ) {
          lineElement.dataset.primaryIndex =
            filteredPanelAllPrimaryIndices[index];
        }

        lineElement.title = lineContent;

        // 🚀 不转义HTML，直接使用原始内容
        let displayText = lineContent;

        // 添加行号显示（使用原始日志行号）
        if (!isFileHeader) {
          const originalIndex = filteredPanelAllPrimaryIndices
            ? filteredPanelAllPrimaryIndices[index]
            : index;
          const lineNumber = originalIndex + 1;
          displayText = `<span class="line-number">${lineNumber}</span>${displayText}`;
        }

        lineElement.innerHTML = displayText;
        // 🚀 性能优化：使用transform替代top，启用GPU加速
        lineElement.style.transform = `translateY(${Math.floor(index * filteredPanelLineHeight)}px)`;

        // 高亮当前点击的行
        if (index === lastClickedFilteredIndex) {
          lineElement.classList.add("highlighted");
        }

        // 如果是二级过滤，添加特殊样式
        if (secondaryFilter.isActive) {
          lineElement.classList.add("filter-match-highlight");
        }

        return lineElement;
      }

      // 初始化右键菜单
      function initContextMenu() {
        // 已禁用全局右键菜单
        return;

        const contextMenu = document.getElementById('contextMenu');
        const fileTreeContainer = DOMCache.get('fileTreeContainer');
        const csvTableContainer = document.getElementById('csvTableContainer');

        // 显示右键菜单
        document.addEventListener('contextmenu', (e) => {
          // 检查是否在文件树区域内，如果是则不显示此菜单
          if (fileTreeContainer && fileTreeContainer.contains(e.target)) {
            // 不阻止默认行为，让文件树自己的右键菜单处理
            return;
          }

          // 检查是否在CSV表格容器内，如果是则让CSV表格自己的右键菜单处理
          if (csvTableContainer && csvTableContainer.contains(e.target)) {
            // 不阻止默认行为，让CSV表格自己的右键菜单处理
            return;
          }

          e.preventDefault();

          // 显示菜单
          contextMenu.style.left = e.pageX + 'px';
          contextMenu.style.top = e.pageY + 'px';
          contextMenu.classList.add('visible');
        });

        // 点击其他地方隐藏菜单
        document.addEventListener('click', (e) => {
          if (!contextMenu.contains(e.target)) {
            contextMenu.classList.remove('visible');
          }
        });

        // 菜单项点击事件
        contextMenu.addEventListener('click', (e) => {
          const item = e.target.closest('.context-menu-item');
          if (!item) return;

          const isFullscreenToggle = item.id === 'toggleFullscreen';
          const isOpenLogsDir = item.id === 'openLogsDir';

          if (isFullscreenToggle) {
            toggleFullscreen();
          } else if (isOpenLogsDir) {
            openLogsDirectory();
          }

          contextMenu.classList.remove('visible');
        });

        // 键盘事件：ESC隐藏菜单
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            contextMenu.classList.remove('visible');
          }
        });
      }

      // 更新菜单项的激活状态
      function updateMenuItems(currentMode) {
        const items = document.querySelectorAll('.context-menu-item[data-mode]');
        items.forEach(item => {
          if (item.dataset.mode === currentMode) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        });
      }

      // 🚀 性能优化：DOM 元素缓存系统，避免重复查询
      const DOMCache = {
        // 缓存对象
        _cache: {},

        // 获取元素（带缓存）
        get(id) {
          if (!this._cache[id]) {
            this._cache[id] = document.getElementById(id);
          }
          return this._cache[id];
        },

        // 批量初始化常用元素
        init() {
          // 过滤面板相关
          this._cache.filteredPanel = document.getElementById('filteredPanel');
          this._cache.filteredPanelContent = document.getElementById('filteredPanelContent');
          this._cache.filteredPanelVirtualContent = document.getElementById('filteredPanelVirtualContent');
          this._cache.filteredPanelHeader = document.getElementById('filteredPanelHeader');
          this._cache.filteredPanelPlaceholder = document.getElementById('filteredPanelPlaceholder');

          // 主日志框相关
          this._cache.inner = document.getElementById('innerContainer');
          this._cache.outer = document.getElementById('outerContainer');
          this._cache.placeholder = document.getElementById('placeholder');

          // 文件树相关
          this._cache.fileTreeList = document.getElementById('fileTreeList');
          this._cache.fileTreeContainer = document.getElementById('fileTreeContainer');
          this._cache.fileTreeCollapseBtn = document.getElementById('fileTreeCollapseBtn');

          // 其他常用元素
          this._cache.searchBox = document.getElementById('searchBox');
          this._cache.filterBox = document.getElementById('filterBox');
          this._cache.outerContainer = document.getElementById('outerContainer');
          this._cache.filteredPanelMaximize = document.getElementById('filteredPanelMaximize');
          this._cache.progressBar = document.getElementById('progressBar');
          this._cache.progressFill = document.getElementById('progressFill');
        },

        // 清除缓存（在需要重新获取时使用）
        clear() {
          this._cache = {};
        },

        // 清除特定元素缓存
        clearItem(id) {
          delete this._cache[id];
        }
      };

      // 初始化 DOM 缓存
      DOMCache.init();

      function init() {
        // 监听串口日志数据
        if (window.electronAPI && window.electronAPI.on) {
          window.electronAPI.on('uart-log-data', (data) => {
            // 检查用户是否在底部
            const wasAtBottom = outer && (outer.scrollHeight - outer.scrollTop - outer.clientHeight < 50);

            // 将数据按行分割并添加到日志中
            const lines = data.split('\n');
            const startIndex = originalLines.length;

            lines.forEach(line => {
              if (line.trim()) {
                // 🚀 不转义HTML，直接使用原始内容
                originalLines.push(line);
              }
            });

            const endIndex = originalLines.length;
            const newLineCount = endIndex - startIndex;

            // 如果有新数据
            if (newLineCount > 0) {
              // 更新 placeholder 高度（使用安全高度计算）
              const placeholder = inner.querySelector('.log-placeholder');
              if (placeholder) {
                const { height: safeHeight } = computeSafeScrollHeight(originalLines.length);
                placeholder.style.height = safeHeight + 'px';
              }

              // 只在用户在底部时才触发可见行更新和自动滚动
              if (wasAtBottom) {
                // 重置可见范围，强制重新渲染
                lastVisibleStart = -1;
                lastVisibleEnd = -1;

                // 使用 requestAnimationFrame 确保在 DOM 更新后滚动
                requestAnimationFrame(() => {
                  if (outer) {
                    updateVisibleLines();
                    outer.scrollTop = outer.scrollHeight;
                  }
                });
              }
              // 如果用户不在底部，不触发任何渲染更新，让用户安静查看历史日志
            }
          });
        }

        // 初始化过滤历史
        loadFilterHistory();
        loadSearchHistory(); // 初始化搜索历史
        loadFilteredPanelSearchHistory(); // 初始化过滤结果框搜索历史
        loadSecondaryFilterHistory(); // 初始化二级过滤历史

        initQuickLinksPanel(); // 初始化快速链接面板
        initWindowShortcuts(); // 初始化窗口切换快捷键
        initGlobalContextMenu(); // 初始化全局右键菜单
        initCopyHandler(); // 初始化复制事件处理器
        initPasteHandler(); // 初始化粘贴事件处理器 - 支持文件粘贴
        initScrollProgressIndicator(); // 虚拟滚动优化：初始化滚动进度指示器

        // 🔧 初始化头部高度保护器
        initHeaderHeightProtector();

        // 初始化搜索框事件监听
        initSearchBoxEvents();

        // 初始化过滤状态（原始数据）
        // 🚀 不转义HTML，直接使用原始内容
        originalLines = demo.split("\n");
        resetFilter(false); // 不显示提示信息

        // ========== 虚拟滚动优化：初始化缓冲区大小 ==========
        updateBufferSize();

        renderLogLines();
        initKeyboardShortcuts(); // 初始化快捷键（依赖 originalLines）

        // ========== 虚拟滚动优化：优化滚动事件监听 ==========
        // 使用passive选项提升滚动性能
        // 🚀 性能优化：移除requestAnimationFrame延迟，立即响应滚动
        // updateVisibleLines内部已有缓存检查，避免不必要的渲染

        // 🚀 性能优化：每帧最多执行一次 updateVisibleLines
        let scrollRafPending = false;

        outer.addEventListener("scroll", () => {
          if (!scrollRafPending) {
            scrollRafPending = true;
            requestAnimationFrame(() => {
              scrollRafPending = false;
              updateVisibleLines();
            });
          }
        }, { passive: true });

        // 🚀 性能优化：使用 Intersection Observer 监控可见元素变化
        // 只对真正进入视口的元素执行高亮计算
        if ('IntersectionObserver' in window) {
          const visibleLinesObserver = new IntersectionObserver(
            (entries) => {
              // 只在元素进入/离开视口时触发
              entries.forEach(entry => {
                if (entry.isIntersecting) {
                  // 元素进入视口，标记需要更新（可选：延迟高亮）
                  entry.target.dataset.needsUpdate = 'false';
                }
              });
            },
            {
              root: outer,
              rootMargin: `${bufferSize * lineHeight}px`,  // 扩大检测范围到缓冲区
              threshold: 0
            }
          );

          // 保存 observer 引用，用于后续添加元素
          window.mainLinesObserver = visibleLinesObserver;
        }

        // 🚀 使用浏览器原生滚动，更流畅、更符合系统习惯
        // 已禁用自定义平滑滚动，保留原生滚动体验
        // enableFastSmoothWheelScroll(outer, {
        //   mouseMultiplier: 2.2,
        //   mouseMaxStep: 520,
        //   trackpadMultiplier: 1.15,
        //   trackpadMaxStep: 180,
        // });
        // enableFastSmoothWheelScroll(filteredPanelContent, {
        //   mouseMultiplier: 2.2,
        //   mouseMaxStep: 520,
        //   trackpadMultiplier: 1.15,
        //   trackpadMaxStep: 180,
        // });

        // ========== 虚拟滚动优化：窗口大小改变时重新计算缓冲区 ==========
        window.addEventListener("resize", () => {
          updateBufferSize(); // 重新计算缓冲区大小
          forceUpdateVisibleLines(); // 强制刷新可见行
          adjustFilteredPanelHeight(); // 调整过滤面板大小
        });

        // ========== 虚拟滚动优化：添加快捷键支持 ==========
        document.addEventListener("keydown", (e) => {
          // 避免在输入框中触发
          const activeElement = document.activeElement;
          if (activeElement &&
              (activeElement.tagName === "INPUT" ||
               activeElement.tagName === "TEXTAREA" ||
               activeElement.isContentEditable)) {
            return;
          }

          // Home键：滚动到顶部
          if (e.key === "Home") {
            e.preventDefault();
            scrollToTop(true);
          }

          // End键：滚动到底部
          if (e.key === "End") {
            e.preventDefault();
            scrollToBottom(true);
          }

          // G键：跳转到指定行
          if (e.key === "g" || e.key === "G") {
            e.preventDefault();
            const lineNum = prompt("输入行号 (0-" + (originalLines.length - 1) + "):");
            if (lineNum !== null) {
              const lineNumber = parseInt(lineNum, 10);
              if (!isNaN(lineNumber)) {
                jumpToLine(lineNumber, 'center');
              }
            }
          }
        });


      // 过滤框事件：按Enter应用过滤，输入为空时实时还原
      // 优化：使用keydown事件替换keypress，提高响应速度
      filterBox.addEventListener("keydown", (e) => {
        // 处理键盘导航
        handleFilterKeyDown(e);
        
        if (e.key === "Enter") {
          e.preventDefault(); // 阻止默认行为
          e.stopPropagation(); // 阻止事件冒泡，避免干扰其他快捷键
          
          // 需求：过滤日志按 Enter 后目录树框自动隐藏
          hideAnyVisibleFileTree();
          
          // 执行过滤后整个页面自动全屏模式（类似快捷键alt+x的效果）
          if (!document.fullscreenElement) {
           // toggleFullscreen();
          }
          
          applyFilter();
          
          // 隐藏建议
          hideFilterSuggestions();
          
          // 在应用过滤后调整面板高度
          setTimeout(() => {
            adjustFilteredPanelHeight();
          }, 100);
        }
      });
      
      // 过滤框内容为空时自动还原日志并移除高亮
      filterBox.addEventListener("input", (e) => {
        // 显示自动建议
        handleFilterInput();
        
        // 注意：这里我们使用trim()来检查是否为空，但应用过滤时保留空格
        if (e.target.value.trim() === "") {
          resetFilter(false);
          // 新增：当过滤框为空时，移除所有高亮效果
          removeAllHighlights();
        }
      });
      
      // 过滤框聚焦事件
      filterBox.addEventListener("focus", () => {
        // 聚焦时显示自动建议
        hideSecondaryFilterSuggestions(); // 先隐藏二级过滤建议
        showFilterSuggestions();
      });
      
      // 过滤框失焦事件
      filterBox.addEventListener("blur", () => {
        // 延迟隐藏，以便点击建议项
        setTimeout(() => {
          hideFilterSuggestions();
        }, 200);
      });

        initDragDrop();

        // 监听从任务栏拖放文件到最小化窗口的事件
        if (window.electronAPI && window.electronAPI.on) {
          window.electronAPI.on('import-file-from-taskbar', async (filePath) => {
            console.log('📥 收到从任务栏导入的文件:', filePath);

            try {
              // 直接使用 handleDroppedPaths 处理文件路径
              await handleDroppedPaths([filePath]);
            } catch (error) {
              console.error('处理任务栏导入的文件失败:', error);
              showMessage(`导入文件失败: ${error.message}`);
            }
          });
        }

        initSearchEvents();
        initLogContentContextMenu();

        // 初始化字体缩放功能
        initFontZoom();

        // 初始化窗口调整大小手柄
        initWindowResizeHandle();
        initExpandFilter(); // 新增：初始化展开过滤输入框功能
        initFilterContextMenu(); // 新增：初始化过滤结果框右键菜单

        updateVisibleLines();
        // 初始化高亮功能
        initHighlightFeatures();

        // 初始化右键菜单
        initContextMenu();

        // 添加 PgUp/PgDn 键连续滚动支持
        document.addEventListener("keydown", handlePageScroll);
        document.addEventListener("keyup", handlePageScrollUp);

        document.addEventListener("keydown", (e) => {
          // 检查是否按下了Alt+X，且当前焦点不在输入框内
          if (
            e.altKey &&
            e.key.toLowerCase() === "x" &&
            !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)
          ) {
            e.preventDefault(); // 阻止默认行为
            toggleFullscreen(); // 调用全屏切换函数
          }
        });

        // 阻止Ctrl+W关闭窗口
        document.addEventListener("keydown", (e) => {
          if (e.ctrlKey && e.key.toLowerCase() === "w") {
            e.preventDefault();
            e.stopPropagation();
          }
        });

        // ========== 新增快捷键：Ctrl+J 跳转到指定行 ==========
        document.addEventListener("keydown", (e) => {
          // Ctrl+J: 跳转到指定行（不包含Shift，避免干扰开发者工具 Ctrl+Shift+J）
          if (
            e.ctrlKey &&
            !e.shiftKey &&  // 🔧 修复：排除Shift键，避免干扰开发者工具快捷键
            !e.altKey &&
            e.key.toLowerCase() === "j" &&
            !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)
          ) {
            e.preventDefault();
            showGotoLineModal();
          }
        });

        // ========== 新增快捷键：F3/F4 导航搜索结果 ==========
        document.addEventListener("keydown", (e) => {
          // 如果焦点在输入框中，不处理
          if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
            return;
          }

          // F3 或 Ctrl+Cmd+F: 下一个搜索结果
          if (e.key === "F3" || (e.key === "f" && (e.ctrlKey || e.metaKey))) {
            // 注意：Ctrl+F 在其他地方处理了，这里只处理 F3
            if (e.key === "F3") {
              e.preventDefault();
              if (totalMatchCount > 0) {
                nextMatch();
              } else {
                showMessage("没有搜索结果");
              }
            }
          }

          // Shift+F3 或 F4: 上一个搜索结果
          if (e.key === "F4" || (e.key === "F3" && e.shiftKey)) {
            e.preventDefault();
            if (totalMatchCount > 0) {
              prevMatch();
            } else {
              showMessage("没有搜索结果");
            }
          }

          // F5: 刷新当前文件（仅当只加载了一个文件时）
          if (e.key === "F5") {
            e.preventDefault();
            // 检查是否只加载了一个文件
            if (selectedFiles.length === 1) {
              const fileItem = fileTreeHierarchy[selectedFiles[0].index];
              if (fileItem && fileItem.type === 'file') {
                showMessage(`正在刷新文件: ${fileItem.name}`);
                reloadFilesInOrder();
              } else {
                showMessage("只能刷新文件，不能刷新文件夹");
              }
            } else if (selectedFiles.length === 0) {
              showMessage("请先选择一个文件");
            } else {
              showMessage(`当前加载了 ${selectedFiles.length} 个文件，F5 刷新只支持单个文件`);
            }
          }
        });

        // 新增：页面切换或窗口失去焦点时清理状态
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) {
            cleanupAllDragStates();
          }
        });

        // 新增：页面卸载前清理状态
        window.addEventListener("beforeunload", () => {
          cleanupAllDragStates();
          // 释放 Worker 资源
          if (window.App && window.App.FileReader) {
            window.App.FileReader.dispose();
          }
        });

        // 新增：防止右键菜单干扰拖拽
        document.addEventListener("contextmenu", (e) => {
          if (
            isAiAssistantResizing ||
            isCornerResizing
          ) {
            e.preventDefault();
            handleGlobalMouseUp();
          }
        });

        // 新增：ESC键强制取消所有拖拽
        document.addEventListener("keydown", (e) => {
          if (
            e.key === "Escape" &&
            (isAiAssistantResizing || isCornerResizing)
          ) {
            e.preventDefault();
            cleanupAllDragStates();
          }
        });

        // 新增：F1/F2水平滚动支持（主日志框和过滤框）
        document.addEventListener("keydown", (e) => {
          // 避免在输入框中时触发滚动
          const activeElement = document.activeElement;
          if (
            activeElement.tagName === "INPUT" ||
            activeElement.tagName === "SELECT" ||
            activeElement.tagName === "TEXTAREA"
          ) {
            return;
          }

          if (e.key === "F1") {
            e.preventDefault();
            // 如果过滤面板可见且显示中，滚动过滤框
            if (filteredPanel && filteredPanel.classList.contains("visible")) {
              const currentScrollLeft = filteredPanelContent.scrollLeft;
              const newScrollLeft = Math.max(0, currentScrollLeft - HORIZONTAL_SCROLL_STEP);
              filteredPanelContent.scrollTo({
                left: newScrollLeft,
                behavior: "smooth",
              });
            } else {
              // 否则滚动主日志框
              scrollHorizontal("left");
            }
            showShortcutHint();
          } else if (e.key === "F2") {
            e.preventDefault();
            // 如果过滤面板可见且显示中，滚动过滤框
            if (filteredPanel && filteredPanel.classList.contains("visible")) {
              const currentScrollLeft = filteredPanelContent.scrollLeft;
              const newScrollLeft = currentScrollLeft + HORIZONTAL_SCROLL_STEP;
              filteredPanelContent.scrollTo({
                left: newScrollLeft,
                behavior: "smooth",
              });
            } else {
              // 否则滚动主日志框
              scrollHorizontal("right");
            }
            showShortcutHint();
          }
        });

        // 新增：F键和f键过滤框支持
        document.addEventListener("keydown", (e) => {
          // 避免在输入框中时触发
          const activeElement = document.activeElement;
          if (
            activeElement.tagName === "INPUT" ||
            activeElement.tagName === "SELECT" ||
            activeElement.tagName === "TEXTAREA"
          ) {
            return;
          }

          // 避免在有修饰键时触发（Ctrl+F用于搜索框）
          if (e.ctrlKey || e.altKey || e.metaKey) {
            return;
          }

          if (e.key === "F") {
            // F键：聚焦工具栏的固定过滤框
            e.preventDefault();

            // 🚀 修复：如果二级过滤侧边栏打开，先隐藏它，避免遮挡过滤框
            const secondaryFilterSidebar = document.getElementById('secondaryFilterSidebar');
            if (secondaryFilterSidebar && secondaryFilterSidebar.classList.contains('visible')) {
              secondaryFilterSidebar.classList.remove('visible');
              console.log('[F键] 临时隐藏二级过滤侧边栏，避免遮挡过滤框');
            }

            filterBox.focus();

            // 如果是全屏模式，显示工具栏按钮
            if (document.body.classList.contains('fullscreen')) {
              showToolbarInFullscreen();
            }

            showShortcutHint();
          } else if (e.key === "f") {
            // f键：弹出过滤对话框
            e.preventDefault();

            const filterDialog = document.getElementById('filterDialog');
            const filterDialogTextarea = document.getElementById('filterDialogTextarea');
            const filterBox = DOMCache.get('filterBox');

            // 将当前过滤框内容同步到对话框
            filterDialogTextarea.value = filterBox.value;

            // 自动调整输入框高度
            const minHeight = 60;
            const maxHeight = 200;
            filterDialogTextarea.style.height = 'auto';
            const scrollHeight = filterDialogTextarea.scrollHeight;
            filterDialogTextarea.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';

            // 显示对话框并聚焦到文本区域
            filterDialog.classList.add('visible');
            filterDialogTextarea.focus();

            // 触发显示历史记录（通过focus事件自动触发）
            const focusEvent = new Event('focus');
            filterDialogTextarea.dispatchEvent(focusEvent);

            showShortcutHint();
          }
        });

        // 新增：Ctrl+G 弹出/隐藏悬浮文件树框
        document.addEventListener("keydown", (e) => {
          if (
            e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            (e.key === "g" || e.key === "G")
          ) {
            e.preventDefault();
            toggleFloatingFileTree();
            showShortcutHint();
          }
        });

        // 新增：主日志框鼠标位置跟踪（用于 Ctrl+F 快捷键）
        // focusOnMainLog 由鼠标位置控制，不受焦点影响
        if (outer) {
          outer.addEventListener("mouseenter", () => {
            focusOnMainLog = true;
          });

          outer.addEventListener("mouseleave", () => {
            focusOnMainLog = false;
          });
        }

        // 新增：Ctrl+F 智能聚焦搜索框
        // - 当鼠标悬浮在过滤结果框内时，聚焦正则搜索框(filteredPanelSearchBox)
        // - 当鼠标悬浮在主日志框内时，聚焦搜索关键词框(searchBox)
        // - 当焦点在过滤框(filterBox)时，聚焦正则搜索框(filteredPanelSearchBox)
        document.addEventListener("keydown", (e) => {
          if (
            e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            (e.key === "f" || e.key === "F")
          ) {
            e.preventDefault();
            const activeElement = document.activeElement;

            // 检查是否应该聚焦正则搜索框：
            // 条件1：鼠标在过滤结果框内（最高优先级）
            // 条件2：鼠标不在主日志框内 且 焦点在过滤相关的输入框
            const shouldFocusFilteredPanelSearch =
              focusOnFilteredPanel || // 鼠标在过滤结果框内
              (!focusOnMainLog && (
                activeElement === filterBox || // 焦点在过滤框
                activeElement === filteredPanelFilterBox || // 焦点在二级过滤框
                activeElement === filteredPanelSearchBox || // 焦点在正则搜索框
                filteredPanelContent.contains(activeElement) // 焦点在过滤结果框内容中
              ));

            if (shouldFocusFilteredPanelSearch && filteredPanelSearchBox) {
              // 聚焦正则搜索框
              filteredPanelSearchBox.focus();
            } else if (searchBox) {
              // 聚焦搜索关键词框
              searchBox.focus();
            }
            showShortcutHint();
          }
        });

        // 新增：Ctrl+H 隐藏/展开过滤结果框
        document.addEventListener("keydown", (e) => {
          if (
            e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            (e.key === "h" || e.key === "H")
          ) {
            e.preventDefault();
            toggleFilteredPanelVisibility();
            showShortcutHint();
          }
        });

        // 新增：Ctrl+S 弹出过滤关键词输入框
        document.addEventListener("keydown", (e) => {
          if (
            e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            (e.key === "s" || e.key === "S")
          ) {
            e.preventDefault();

            // 打开过滤对话框
            const filterDialog = document.getElementById('filterDialog');
            const filterDialogTextarea = document.getElementById('filterDialogTextarea');
            const filterBox = DOMCache.get('filterBox');
            const filterHistorySuggestions = document.getElementById('filterHistorySuggestions');
            const filterHistoryList = document.getElementById('filterHistoryList');

            // 将当前过滤框内容同步到对话框
            filterDialogTextarea.value = filterBox.value;

            // 自动调整输入框高度
            const minHeight = 60;
            const maxHeight = 200;
            filterDialogTextarea.style.height = 'auto';
            const scrollHeight = filterDialogTextarea.scrollHeight;
            filterDialogTextarea.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';

            // 显示对话框并聚焦到文本区域
            filterDialog.classList.add('visible');
            filterDialogTextarea.focus();

            // 显示历史记录
            function showFilterHistory() {
              // 获取前20条历史记录
              const historyItems = filterHistory.slice(0, 20).map((keyword, index) => ({
                keyword,
                index
              }));

              if (historyItems.length === 0) {
                filterHistoryList.innerHTML = '<div class="filter-history-item">暂无历史记录</div>';
              } else {
                filterHistoryList.innerHTML = historyItems.map((item, index) => `
                  <div class="filter-history-item" data-index="${index}">
                    <div class="keyword">${item.keyword}</div>
                  </div>
                `).join('');

                // 添加点击事件 - 只填入输入框，不立即应用过滤
                filterHistoryList.querySelectorAll('.filter-history-item').forEach(item => {
                  item.addEventListener('click', () => {
                    const index = parseInt(item.getAttribute('data-index'));
                    filterDialogTextarea.value = historyItems[index].keyword;
                    // 不立即应用过滤，只隐藏历史提示框
                    filterHistorySuggestions.style.display = 'none';
                    filterDialogTextarea.focus();
                  });
                });
              }

              filterHistorySuggestions.style.display = 'block';
            }

            showFilterHistory();
            showShortcutHint();
          }
        });

        // 新增：Ctrl+Shift+T 新建窗口
        document.addEventListener("keydown", (e) => {
          if (
            e.ctrlKey &&
            e.shiftKey &&
            !e.altKey &&
            !e.metaKey &&
            (e.key === "t" || e.key === "T")
          ) {
            e.preventDefault();
            // 调用 Electron API 创建新窗口
            if (typeof window.electronAPI !== 'undefined' && window.electronAPI.createNewWindow) {
              window.electronAPI.createNewWindow({});
            }
            showShortcutHint();
          }
        });

        // 初始化文件树功能
        initFileTree();

        // 初始化悬浮过滤内容框
        initFilteredPanel();

        // 新增：初始化二级过滤功能
        initSecondaryFilter();

        // 新增：初始化AI助手
        initAiAssistant();

        // 新增：全局鼠标事件监听
        document.addEventListener("mousemove", handleGlobalMouseMove);
        document.addEventListener("mouseup", handleGlobalMouseUp);

        // 新增：自动应用默认过滤
        autoApplyDefaultFilter();

        // 新增：自动添加默认高亮
        addDefaultHighlights();

        // 初始调整过滤面板高度
        adjustFilteredPanelHeight();

        // 根据默认目录变量自动加载文件树或折叠文件树
        // 注意：DEFAULT_SERVER_PATH 可能由外部模板注入，这里要兼容未定义的情况
        const defaultServerPath =
          typeof DEFAULT_SERVER_PATH !== "undefined" ? DEFAULT_SERVER_PATH : "";
        if (defaultServerPath && String(defaultServerPath).trim() !== "") {
          // 设置服务器路径输入框的值
          const serverPathInput = document.getElementById("serverPath");
          if (serverPathInput) {
            serverPathInput.value = String(defaultServerPath);
          }
          // 延迟加载，确保页面完全初始化
          setTimeout(() => {
            loadServerTree();
          }, 500);
        } else {
          // 🚀 如果默认目录为空，文件树保持展开状态（不再折叠）
          // if (fileTreeContainer.classList.contains("visible")) {
          //   fileTreeContainer.classList.remove("visible");
          //   updateLayout();
          //   fileTreeCollapseBtn.innerHTML = "▶";
          //   updateButtonPosition();
          // }
        }
      }

      // 轻量滚轮加速 + 平滑：只在 wheel 时工作；用 rAF 收敛到 targetScrollTop
      function enableFastSmoothWheelScroll(container, opts) {
        if (!container) return;

        const options = Object.assign(
          {
            mouseMultiplier: 2.0,
            mouseMaxStep: 480,
            trackpadMultiplier: 1.1,
            trackpadMaxStep: 160,
          },
          opts || {}
        );

        let targetTop = container.scrollTop;
        let rafId = null;
        let lastAnimWriteAt = 0;

        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

        const cancelAnim = () => {
          if (rafId) cancelAnimationFrame(rafId);
          rafId = null;
        };

        // 暴露取消接口：用于“程序跳转滚动”时立刻停止 rAF，避免与跳转抢写 scrollTop
        // 注：不要用 Symbol，避免在调试台/旧环境里不好排查
        try {
          container.__fastSmoothWheelCancel = () => {
            cancelAnim();
            targetTop = container.scrollTop;
          };
        } catch (_) {
          // ignore
        }

        // 优化：用户尝试拖动滚动条/点击容器时，立刻取消动画，避免“回弹/抢滚动”
        // pointerdown 对滚动条拖拽更友好（部分浏览器滚动条交互会触发到元素本身）
        container.addEventListener(
          "pointerdown",
          () => {
            if (!rafId) return;
            cancelAnim();
            targetTop = container.scrollTop;
          },
          { passive: true }
        );

        const step = () => {
          rafId = null;
          const cur = container.scrollTop;
          const diff = targetTop - cur;
          if (Math.abs(diff) < 0.5) {
            container.scrollTop = targetTop;
            return;
          }
          // 收敛系数：帧数少、足够顺滑，避免长时间占用
          lastAnimWriteAt = performance.now();
          container.scrollTop = cur + diff * 0.35;
          rafId = requestAnimationFrame(step);
        };

        container.addEventListener(
          "wheel",
          (e) => {
            // Ctrl+滚轮用于字体缩放，只阻止默认行为，让事件继续传播给字体缩放监听器
            if (e.ctrlKey) {
              e.preventDefault();
              // 不调用 stopPropagation()，让事件继续传播
              return;
            }

            // 🚀 新增：Alt+滚轮用于横向滚动
            if (e.altKey) {
              e.preventDefault();
              e.stopPropagation();

              let delta = e.deltaX;
              // 如果没有deltaX，尝试使用deltaY（某些触控板/鼠标）
              if (Math.abs(delta) < 0.1) {
                delta = e.deltaY;
              }

              if (Math.abs(delta) < 0.1) return; // 忽略微小的滚动

              if (e.deltaMode === 1) delta *= 16; // 行
              else if (e.deltaMode === 2) delta *= window.innerWidth; // 页

              const abs = Math.abs(delta);
              const isTrackpad = e.deltaMode === 0 && abs < 18;
              const mult = isTrackpad ? options.trackpadMultiplier : options.mouseMultiplier;
              const maxStep = isTrackpad ? options.trackpadMaxStep : options.mouseMaxStep;

              delta = Math.max(-maxStep, Math.min(maxStep, delta * mult));

              // 直接设置scrollLeft，不使用动画
              const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
              const targetScrollLeft = clamp(container.scrollLeft + delta, 0, maxScrollLeft);
              container.scrollLeft = targetScrollLeft;

              return;
            }

            // 以横向为主（shift 或 deltaX 较大）时不接管，避免影响水平滚动体验
            if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

            // 没有可滚动空间时，不接管（避免影响其它区域/滚动条交互）
            if (container.scrollHeight <= container.clientHeight) return;

            // 这里需要 preventDefault 才能避免原生滚动 + 我们的滚动叠加
            e.preventDefault();

            let delta = e.deltaY;
            if (e.deltaMode === 1) delta *= 16; // 行
            else if (e.deltaMode === 2) delta *= window.innerHeight; // 页

            const abs = Math.abs(delta);
            // 简单区分：触控板通常 delta 更细碎
            const isTrackpad = e.deltaMode === 0 && abs < 18;
            const mult = isTrackpad ? options.trackpadMultiplier : options.mouseMultiplier;
            const maxStep = isTrackpad ? options.trackpadMaxStep : options.mouseMaxStep;

            delta = Math.max(-maxStep, Math.min(maxStep, delta * mult));

            const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
            targetTop = clamp(targetTop + delta, 0, maxTop);

            if (!rafId) {
              rafId = requestAnimationFrame(step);
            }
          },
          { passive: false, capture: true }
        );

        // 如果用户拖动滚动条/程序滚动，更新 target；若检测到用户在动画中“抢滚动”，则取消动画
        container.addEventListener(
          "scroll",
          () => {
            if (!rafId) {
              targetTop = container.scrollTop;
              return;
            }
            // 动画运行时，如果滚动并非紧跟我们刚写入的那一帧，认为是用户拖动滚动条导致
            if (performance.now() - lastAnimWriteAt > 80) {
              cancelAnim();
              targetTop = container.scrollTop;
            }
          },
          { passive: true }
        );
      }

      // 调整过滤面板高度以保持与内容框底部对齐
      // 🔧 修复：不设置显式 height 和 top，让 CSS (top/bottom) 自动控制面板大小和位置
      function adjustFilteredPanelHeight() {
        if (
          !filteredPanel.classList.contains("visible") ||
          isFilterPanelMaximized
        ) {
          return;
        }

        // 🔧 清除内联 height，让 CSS 的 bottom: 16px 自动计算高度
        filteredPanel.style.height = '';
        filteredPanel.style.removeProperty('height');

        // 🔧 不再设置 style.top——让 CSS 的 top: calc(50vh + 60px) 生效
        // 如果用户通过拖动调整过 top（style.top 有值），保持它
        // 如果 style.top 为空，CSS 的默认 top 值会自动生效

        // 🔧 同步 --filtered-panel-top CSS变量
        const currentTop = filteredPanel.style.top || '';
        if (currentTop) {
          filteredPanel.style.setProperty('--filtered-panel-top', currentTop);
        } else {
          filteredPanel.style.removeProperty('--filtered-panel-top');
        }
      }

      function forcetoggleFullscreen() {
        if (true) {
          document.documentElement.requestFullscreen().catch((err) => {
            console.error(`无法进入全屏模式: ${err.message}`);
          });
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
        }
      }

      function toggleFullscreen() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch((err) => {
            console.error(`无法进入全屏模式: ${err.message}`);
          });
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
        }

        // 全屏切换后调整过滤面板高度
        setTimeout(() => {
          adjustFilteredPanelHeight();
        }, 100);
      }

      // 打开日志目录
      async function openLogsDirectory() {
        try {
          if (!window.electronAPI || !window.electronAPI.getLogFilePath) {
            showMessage("日志功能不可用");
            return;
          }

          const result = await window.electronAPI.getLogFilePath();

          if (result.success && result.logsDir) {
            console.log("打开日志目录:", result.logsDir);

            // 使用shell.openPath打开目录（跨平台）
            if (window.electronAPI.openFileWithDefaultApp) {
              await window.electronAPI.openFileWithDefaultApp(result.logsDir);
              showMessage(`已打开日志目录`);
            } else {
              showMessage(`日志目录: ${result.logsDir}`);
            }
          } else {
            showMessage("无法获取日志目录");
          }
        } catch (error) {
          console.error("打开日志目录失败:", error);
          showMessage(`打开日志目录失败: ${error.message}`);
        }
      }

      // 在全屏模式下显示工具栏
      function showToolbarInFullscreen() {
        if (!document.body.classList.contains('fullscreen')) return;
        
        const toolbar = document.getElementById('toolbar');
        // 临时显示工具栏
        toolbar.style.transition = 'top 0.3s ease';
        toolbar.style.top = '0';
        
        // 3秒后自动隐藏
        clearTimeout(window.toolbarHideTimeout);
        window.toolbarHideTimeout = setTimeout(() => {
          toolbar.style.top = '-36px';
        }, 3000);
        
        // 当用户鼠标移入工具栏区域时，取消自动隐藏
        toolbar.addEventListener('mouseenter', () => {
          clearTimeout(window.toolbarHideTimeout);
        }, { once: true });
        
        // 当用户鼠标移出工具栏区域时，延迟隐藏
        toolbar.addEventListener('mouseleave', () => {
          clearTimeout(window.toolbarHideTimeout);
          window.toolbarHideTimeout = setTimeout(() => {
            toolbar.style.top = '-36px';
          }, 1000);
        }, { once: true });
      }

      // 自动应用默认过滤
      function autoApplyDefaultFilter() {
        // 防止重复执行
        if (hasAutoJumpedToErrTag) return;

        // 延迟执行，确保DOM已完全渲染
        setTimeout(() => {
          // 设置过滤框值为默认关键词
          filterBox.value = defaultFilterKeywords;
          // 应用过滤
          applyFilter();
          hasAutoJumpedToErrTag = true;
          //showMessage("已自动应用默认过滤条件");
        }, 500);
      }

      // 新增：添加默认高亮
      function addDefaultHighlights() {
        // 检查是否已存在默认高亮
        let hasDefaultHighlights = false;

        // 检查默认高亮是否已存在
        for (const defaultHighlight of defaultHighlights) {
          const exists = customHighlights.some(
            (highlight) =>
              highlight.keyword === defaultHighlight.keyword &&
              highlight.color === defaultHighlight.color
          );

          if (!exists) {
            customHighlights.push({
              keyword: defaultHighlight.keyword,
              color: defaultHighlight.color,
            });
            hasDefaultHighlights = true;
          }
        }

        if (hasDefaultHighlights) {
          showMessage("已添加默认高亮");
          renderLogLines();
          updateFilteredPanel();
        }
      }

      // 移除所有高亮效果
      function removeAllHighlights() {
        // 清空自定义高亮数组
        customHighlights.length = 0;

        // 🔧 修复：移除高亮时清空 HTML 解析缓存
        clearHtmlParseCache();

        // 🚀 性能优化：高亮变化时失效缓存
        invalidateFilteredLineCache();

        // 移除搜索高亮
        const searchHighlights = document.querySelectorAll(
          ".search-highlight, .current-search-highlight"
        );
        searchHighlights.forEach((highlight) => {
          const parent = highlight.parentNode;
          parent.replaceChild(
            document.createTextNode(highlight.textContent),
            highlight
          );
          parent.normalize();
        });

        // 移除自定义高亮
        const customHighlightSpans = document.querySelectorAll(
          "span.custom-highlight"
        );
        customHighlightSpans.forEach((span) => {
          const parent = span.parentNode;
          parent.replaceChild(document.createTextNode(span.textContent), span);
          parent.normalize();
        });

        // 移除过滤高亮类
        const filterHighlightedLines = document.querySelectorAll(".log-line");
        filterHighlightedLines.forEach((line) => {
          filterHighlightClasses.forEach((className) => {
            line.classList.remove(className);
          });
        });

        // 移除当前匹配行高亮
        const currentMatchLines = document.querySelectorAll(
          ".current-match-line"
        );
        currentMatchLines.forEach((line) => {
          line.classList.remove("current-match-line");
        });

        // 移除永久高亮
        const permanentHighlights = document.querySelectorAll(
          ".permanent-highlight"
        );
        permanentHighlights.forEach((line) => {
          line.classList.remove("permanent-highlight");
        });

        // 重置永久高亮索引
        currentPermanentHighlightIndex = -1;

        // 移除悬浮过滤内容框中的高亮
        const filteredHighlights = document.querySelectorAll(
          ".filtered-log-line.highlighted, .filtered-log-line.search-match-highlight, .filtered-log-line.filter-match-highlight"
        );
        filteredHighlights.forEach((line) => {
          line.classList.remove(
            "highlighted",
            "search-match-highlight",
            "filter-match-highlight"
          );
        });

        // 重置上次点击的过滤面板行索引
        lastClickedFilteredIndex = -1;

        // 移除过滤结果框中的自定义高亮
        const filteredCustomHighlights =
          filteredPanelVirtualContent.querySelectorAll("span.custom-highlight");
        filteredCustomHighlights.forEach((span) => {
          const parent = span.parentNode;
          parent.replaceChild(document.createTextNode(span.textContent), span);
          parent.normalize();
        });
      }

      // 初始化窗口调整大小手柄
      function initWindowResizeHandle() {
        // 窗口调整手柄已全部禁用 - 只能通过最大化/还原按钮调整窗口大小
        // 如需启用窗口拖拽调整大小功能，请在 HTML 中添加相应元素
        /*
        // 工具栏右侧的缩放手柄（右侧方向 - 只调整宽度）
        const resizeHandle = document.getElementById("windowResizeHandleToolbar");
        if (resizeHandle) {
          // 拖动开始
          resizeHandle.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            if (typeof window.electronAPI === 'undefined' || !window.electronAPI.windowControl) {
              console.warn('窗口调整大小功能不可用');
              return;
            }

            startWindowResizeByDirection(e, 'e');
          });

          // 双击最大化/还原窗口
          resizeHandle.addEventListener("dblclick", (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
              window.electronAPI.windowControl.isMaximized().then(isMaximized => {
                if (isMaximized) {
                  if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
                    window.electronAPI.windowControl.setBounds({
                      x: undefined,
                      y: undefined,
                      width: lastUnmaximizedBounds.width || 1200,
                      height: lastUnmaximizedBounds.height || 800
                    });
                  }
                } else {
                  if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
                    window.electronAPI.windowControl.getBounds().then(bounds => {
                      lastUnmaximizedBounds = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
                      if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
                        window.electronAPI.windowControl.maximize();
                      }
                    });
                  }
                }
              });
            }
          });
        }

        const resizeElements = document.querySelectorAll('.window-resize-corner');
        resizeElements.forEach(el => {
          el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            if (typeof window.electronAPI === 'undefined' || !window.electronAPI.windowControl) {
              console.warn('窗口调整大小功能不可用');
              return;
            }

            const dir = el.dataset.resizeDir;
            startWindowResizeByDirection(e, dir);
          });
        });
        */
      }

      // 根据方向开始窗口调整大小
      function startWindowResizeByDirection(e, direction) {
        isWindowResizing = true;
        windowResizeDirection = direction;
        windowResizeStartX = e.clientX;
        windowResizeStartY = e.clientY;

        // 获取当前窗口边界
        window.electronAPI.windowControl.getBounds().then(bounds => {
          windowStartWidth = bounds.width;
          windowStartHeight = bounds.height;
          windowStartX = bounds.x;
          windowStartY = bounds.y;

          // 添加调整大小中的样式
          document.body.classList.add("window-resizing");
          document.body.classList.add(`resizing-${direction}`);
        });
      }

      // 保存未最大化时的窗口大小
      let lastUnmaximizedBounds = { width: 1200, height: 800 };

      // 初始化悬浮过滤内容框
      function initFilteredPanel() {
        // 头部拖拽事件 - 已禁用
        // 如需启用，请取消以下注释
        /*
        let headerClickStartX = 0;
        let headerClickStartY = 0;
        filteredPanelHeader.addEventListener("mousedown", (e) => {
          // 如果点击的是输入框或按钮，不触发拖拽
          if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") {
            return;
          }
          // 记录点击位置，用于区分拖拽和点击
          headerClickStartX = e.clientX;
          headerClickStartY = e.clientY;
          startPanelDrag(e);
        });
        */

        // 新增：高度调节拖动按钮事件
        const heightDragHandle = document.getElementById('filteredPanelHeightDragHandle');
        if (heightDragHandle) {
          let isDraggingHeight = false;
          let dragStartY = 0;
          let panelStartHeight = 0;
          let panelStartTop = 0;

          heightDragHandle.addEventListener('mousedown', (e) => {
            // 🔧 如果面板是最大化状态，先退出最大化
            if (filteredPanel.classList.contains('maximized')) {
              filteredPanel.classList.remove('maximized');
              isFilterPanelMaximized = false;

              // 恢复到默认大小（从工具栏下方到窗口底部）
              const toolbarHeight = 25;
              filteredPanel.style.top = toolbarHeight + 'px';
              filteredPanel.style.setProperty('--filtered-panel-top', toolbarHeight + 'px');
              filteredPanel.style.left = '0';
              filteredPanel.style.width = '';
              filteredPanel.style.height = '';
              filteredPanel.style.removeProperty('right');
              filteredPanel.style.removeProperty('max-width');
              filteredPanel.style.removeProperty('max-height');

              // 更新最大化按钮状态
              setTimeout(() => {
                const maximizeBtn = DOMCache.get('filteredPanelMaximize');
                if (maximizeBtn) {
                  maximizeBtn.textContent = '□';
                  maximizeBtn.title = '最大化';
                }
              }, 100);
            }

            // 🔧 拖动开始时强制清除 height，确保 bottom: 0 生效
            filteredPanel.style.removeProperty('height');

            isDraggingHeight = true;
            dragStartY = e.clientY;

            const rect = filteredPanel.getBoundingClientRect();
            panelStartHeight = rect.height;
            panelStartTop = rect.top;

            document.body.classList.add('panel-resizing');
            filteredPanel.classList.add('panel-resizing');
            e.preventDefault();
            e.stopPropagation();
          });

          // mousemove 和 mouseup 监听器（只添加一次）
          let rafId = null; // 🔧 使用 requestAnimationFrame 优化性能

          const mouseMoveHandler = (e) => {
            if (!isDraggingHeight) return;

            // 🔧 使用 requestAnimationFrame 避免过度渲染
            if (rafId) {
              cancelAnimationFrame(rafId);
            }

            rafId = requestAnimationFrame(() => {
              const deltaY = e.clientY - dragStartY;
              const windowHeight = window.innerHeight;
              const hScrollHeight = 16;
              const toolbarHeight = 25; // 工具栏高度
              const minHeight = 200; // 最小高度

              // 往上拖动时 deltaY 为负，top 减小；往下拖动时 deltaY 为正，top 增大
              let newTop = panelStartTop + deltaY;

              // 限制 top 的范围（确保最小高度）
              const maxTop = windowHeight - minHeight - hScrollHeight; // 最大 top（确保最小高度）
              newTop = Math.max(toolbarHeight, Math.min(maxTop, newTop));

              // 🔧 只设置 top，不设置 height，让 CSS 的 bottom: 0 自动控制高度
              filteredPanel.style.top = newTop + 'px';
              // 🔧 强制清除 height，确保 bottom: 0 生效
              filteredPanel.style.removeProperty('height');
              // 🔧 更新 CSS 变量，让内容区域的 max-height 正确计算
              filteredPanel.style.setProperty('--filtered-panel-top', newTop + 'px');
            });
          };

          const mouseUpHandler = () => {
            if (isDraggingHeight) {
              isDraggingHeight = false;
              // 🔧 清理 requestAnimationFrame
              if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
              }
              document.body.classList.remove('panel-resizing');
              filteredPanel.classList.remove('panel-resizing');
            }
          };

          document.addEventListener('mousemove', mouseMoveHandler);
          document.addEventListener('mouseup', mouseUpHandler);
        }

        // 新增：最小化、最大化、关闭按钮事件
        console.log('[FilteredPanel] 初始化按钮事件...');
        const filteredPanelMinimize = document.getElementById('filteredPanelMinimize');
        const filteredPanelMaximize = DOMCache.get('filteredPanelMaximize');
        const filteredPanelClose = document.getElementById('filteredPanelClose');
        const filteredPanelMinimizedBtn = document.getElementById('filteredPanelMinimizedBtn');
        const filteredPanelMinimizedCount = document.getElementById('filteredPanelMinimizedCount');

        console.log('[FilteredPanel] Minimize button:', filteredPanelMinimize);
        console.log('[FilteredPanel] Maximize button:', filteredPanelMaximize);
        console.log('[FilteredPanel] Close button:', filteredPanelClose);

        // 最小化按钮：隐藏面板，显示小圆形按钮
        if (filteredPanelMinimize) {
          filteredPanelMinimize.addEventListener('click', (e) => {
            console.log('[FilteredPanel] Minimize button clicked');
            e.stopPropagation();
            // 更新小按钮上的计数
            if (filteredPanelMinimizedCount) {
              filteredPanelMinimizedCount.textContent = filteredCount.textContent || '0';
            }
            // 显示小按钮
            if (filteredPanelMinimizedBtn) {
              filteredPanelMinimizedBtn.classList.add('visible');
            }
            // 🔧 修复：移除 maximized 类，否则会隐藏最小化按钮和快捷键按钮
            // isFilterPanelMaximized 状态已经保存，展开时会根据这个状态恢复
            const wasMaximized = filteredPanel.classList.contains('maximized');
            if (wasMaximized) {
              console.log('[FilteredPanel] 最小化时移除 maximized 类，但保存状态');
            }
            filteredPanel.classList.remove('visible');
            filteredPanel.classList.remove('maximized');

            // 🚀 恢复文件树面板（如果之前被隐藏）
            restoreFileTreePanel();
          });
          console.log('[FilteredPanel] Minimize button event added');
        }

        // 最小化小按钮点击：展开面板
        if (filteredPanelMinimizedBtn) {
          filteredPanelMinimizedBtn.addEventListener('click', (e) => {
            console.log('[FilteredPanel] Minimized button clicked');
            // 隐藏小按钮
            filteredPanelMinimizedBtn.classList.remove('visible');

            // 🔧 关键修复：根据 isFilterPanelMaximized 状态决定是否清除样式
            // 如果之前是最大化状态，保留 maximized 类，只清除内联样式
            // 如果之前不是最大化状态，清除所有样式和类
            const wasMaximized = isFilterPanelMaximized;
            console.log('[FilteredPanel] 展开面板，之前是否最大化:', wasMaximized);

            if (!wasMaximized) {
              // 非最大化状态：清除所有可能冲突的样式和类
              filteredPanel.classList.remove('maximized');
            }

            // 清除内联样式（无论是否最大化都清除）
            filteredPanel.style.removeProperty('top');
            filteredPanel.style.removeProperty('left');
            filteredPanel.style.removeProperty('width');
            filteredPanel.style.removeProperty('height');
            filteredPanel.style.removeProperty('right');
            filteredPanel.style.removeProperty('bottom');
            filteredPanel.style.removeProperty('margin');
            filteredPanel.style.removeProperty('padding');
            filteredPanel.style.removeProperty('--filtered-panel-top');

            // 如果之前是最大化状态，确保添加回 maximized 类
            if (wasMaximized) {
              filteredPanel.classList.add('maximized');
            }

            // 🔧 同步最大化按钮图标状态
            const maximizeBtnEl = DOMCache.get('filteredPanelMaximize');
            if (maximizeBtnEl) {
              maximizeBtnEl.textContent = wasMaximized ? '❐' : '□';
            }

            // 保存初始状态
            saveFilteredPanelState();

            // 显示面板
            filteredPanel.classList.add('visible');

            // 更新过滤面板内容
            updateFilteredPanel();

            // 🚀 自动隐藏文件树面板，为过滤面板腾出空间
            const fileTreeContainer = DOMCache.get('fileTreeContainer');
            const fileTreeCollapseBtn = DOMCache.get('fileTreeCollapseBtn');
            if (fileTreeContainer && fileTreeContainer.classList.contains('visible')) {
              fileTreeContainer.classList.remove('visible');
              if (fileTreeCollapseBtn) {
                fileTreeCollapseBtn.textContent = '▶';
                fileTreeCollapseBtn.style.display = 'none'; // 🔧 隐藏折叠按钮
              }
              // 🚀 记录文件树被过滤面板隐藏
              fileTreeWasHiddenByFilter = true;
              // 🚀 触发布局更新（重要！）
              if (typeof updateLayout === 'function') {
                updateLayout();
              }
              if (typeof updateButtonPosition === 'function') {
                updateButtonPosition();
              }
              console.log('[Filter] 文件树面板已自动隐藏（从最小化状态恢复）');
            }
          });
        }

        if (filteredPanelMaximize) {
          filteredPanelMaximize.addEventListener('click', (e) => {
            console.log('[FilteredPanel] Maximize button clicked');
            e.stopPropagation();
            toggleFilterPanelMaximize();
          });
          console.log('[FilteredPanel] Maximize button event added');
        }

        if (filteredPanelClose) {
          filteredPanelClose.addEventListener('click', (e) => {
            console.log('[FilteredPanel] Close button clicked');
            e.stopPropagation();
            // 🚀 关闭过滤面板：释放过滤内存并清空过滤框
            cleanFilterData();
            filterBox.value = '';

            // 🚀 隐藏过滤面板并重置最大化状态
            filteredPanel.classList.remove('visible', 'maximized');
            isFilterPanelMaximized = false;

            // 🔧 重置最大化按钮图标
            const maxBtn = DOMCache.get('filteredPanelMaximize');
            if (maxBtn) maxBtn.textContent = '□';

            // 🚀 清除可能残留的内联样式
            filteredPanel.style.left = '';
            filteredPanel.style.top = '';
            filteredPanel.style.width = '';
            filteredPanel.style.height = '';

            // 隐藏小按钮
            if (filteredPanelMinimizedBtn) {
              filteredPanelMinimizedBtn.classList.remove('visible');
            }
            // 重新渲染主面板
            renderLogLines();
            updateVisibleLines();

            // 🚀 恢复文件树面板（如果之前被隐藏）
            restoreFileTreePanel();
          });
          console.log('[FilteredPanel] Close button event added');
        }

        // 新增：四角调整大小事件
        resizeHandleNW.addEventListener("mousedown", (e) =>
          startCornerResize(e, "nw")
        );
        resizeHandleNE.addEventListener("mousedown", (e) =>
          startCornerResize(e, "ne")
        );
        resizeHandleSW.addEventListener("mousedown", (e) =>
          startCornerResize(e, "sw")
        );
        resizeHandleSE.addEventListener("mousedown", (e) =>
          startCornerResize(e, "se")
        );

        // 快捷键说明面板事件
        const shortcutsToggleBtn = document.getElementById('shortcutsToggleBtn');
        const shortcutsPanel = document.getElementById('shortcutsPanel');
        const shortcutsClose = document.getElementById('shortcutsClose');

        if (shortcutsToggleBtn && shortcutsPanel) {
          shortcutsToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            shortcutsPanel.classList.toggle('visible');
          });

          if (shortcutsClose) {
            shortcutsClose.addEventListener('click', (e) => {
              e.stopPropagation();
              shortcutsPanel.classList.remove('visible');
            });
          }

          // 点击其他地方关闭面板
          document.addEventListener('click', (e) => {
            if (!shortcutsPanel.contains(e.target) && e.target !== shortcutsToggleBtn) {
              shortcutsPanel.classList.remove('visible');
            }
          });
        }


        // 全局鼠标事件
        document.addEventListener("mousemove", handlePanelMouseMove);
        document.addEventListener("mouseup", handlePanelMouseUp);

        // 点击过滤结果行事件 - 使用事件委托
        if (filteredPanelContent) {
          filteredPanelContent.addEventListener("click", handleFilteredLineClick);

          // 🚀 修复事件监听器：添加 passive 选项，提升滚动性能
          filteredPanelContent.addEventListener(
            "scroll",
            handleFilteredPanelScroll,
            { passive: true }  // 告诉浏览器滚动事件不会调用 preventDefault，提升性能
          );
        } else {
          console.error('[初始化] filteredPanelContent 是 null！事件监听器无法绑定！');
        }

        // 🔧 新增：窗口大小变化时强制重新渲染过滤面板
        let windowResizeRafId = null;
        let windowResizeTimeoutId = null;
        window.addEventListener('resize', () => {
          // 清除之前的定时器
          if (windowResizeTimeoutId) {
            clearTimeout(windowResizeTimeoutId);
          }

          // 使用 rAF 节流
          if (windowResizeRafId) {
            cancelAnimationFrame(windowResizeRafId);
          }

          windowResizeRafId = requestAnimationFrame(() => {
            windowResizeRafId = null;

            // 延迟 150ms 后强制重新渲染，确保窗口大小变化完成
            windowResizeTimeoutId = setTimeout(() => {
              if (filteredPanelAllLines.length > 0) {
                updateFilteredPanelVisibleLines(true);
              }
              windowResizeTimeoutId = null;
            }, 150);
          });
        });

        // 新增：初始设置过滤面板大小和位置 - 修改为占用一半屏幕高度
        initFilteredPanelSize();

        // 新增：过滤结果框搜索功能初始化
        initFilteredPanelSearch();

        // 新增：聚焦事件监听
        filteredPanelContent.addEventListener("focusin", () => {
          focusOnFilteredPanel = true;
        });

        filteredPanelContent.addEventListener("focusout", () => {
          // 不在这里修改 focusOnFilteredPanel，让鼠标位置控制
        });

        // 新增：点击内容区域时也要更新标志（修复Ctrl+F聚焦问题）
        filteredPanelContent.addEventListener("mousedown", () => {
          focusOnFilteredPanel = true;
        });

        // 新增：鼠标位置跟踪（用于 Ctrl+F 快捷键）
        // focusOnFilteredPanel 只由鼠标位置控制，不受焦点影响
        filteredPanel.addEventListener("mouseenter", () => {
          focusOnFilteredPanel = true;
        });

        filteredPanel.addEventListener("mouseleave", () => {
          focusOnFilteredPanel = false;
        });

        // 新增：过滤结果框搜索框聚焦事件
        filteredPanelSearchBox.addEventListener("focusin", () => {
          // 不修改 focusOnFilteredPanel，让鼠标位置控制
        });

        filteredPanelSearchBox.addEventListener("focusout", () => {
          // 不修改 focusOnFilteredPanel，让鼠标位置控制
        });

        // 新增：二级过滤框聚焦事件
        filteredPanelFilterBox.addEventListener("focusin", () => {
          // 不修改 focusOnFilteredPanel，让鼠标位置控制
        });

        filteredPanelFilterBox.addEventListener("focusout", () => {
          // 不修改 focusOnFilteredPanel，让鼠标位置控制
        });
      }

      // Ctrl+H：隐藏/展开过滤结果框（不清空结果）
      function toggleFilteredPanelVisibility() {
        if (!filteredPanel) return;
        const hasFilter = !!(filterBox && filterBox.value && filterBox.value.trim() !== "");

        if (filteredPanel.classList.contains("visible")) {
          // 记录滚动位置，便于恢复
          try {
            filteredPanelScrollPosition = filteredPanelContent
              ? filteredPanelContent.scrollTop
              : 0;
          } catch (_) {
            // ignore
          }
          filteredPanel.classList.remove("visible");

          // 🔧 恢复文件树和按钮显示
          if (typeof restoreFileTreePanel === 'function') {
            restoreFileTreePanel();
          }
          return;
        }

        // 没有过滤条件就不展开
        if (!hasFilter) return;

        // 🔧 显示面板时自动隐藏文件树
        const fileTreeContainer = DOMCache.get('fileTreeContainer');
        const fileTreeCollapseBtn = DOMCache.get('fileTreeCollapseBtn');
        if (fileTreeContainer && fileTreeContainer.classList.contains('visible')) {
          fileTreeContainer.classList.remove('visible');
          if (fileTreeCollapseBtn) {
            fileTreeCollapseBtn.textContent = '▶';
            fileTreeCollapseBtn.style.display = 'none'; // 🔧 隐藏折叠按钮
          }
          fileTreeWasHiddenByFilter = true;
          // 🔧 调整布局和按钮位置
          if (typeof updateLayout === 'function') {
            updateLayout();
          }
          if (typeof updateButtonPosition === 'function') {
            updateButtonPosition();
          }
          console.log('[Filter] 文件树面板已自动隐藏（过滤面板显示）');
        }

        // 重新展开：复用 updateFilteredPanel 的渲染/虚拟滚动逻辑
        updateFilteredPanel();
      }

      /**
       * 🚀 恢复文件树面板
       * 如果文件树之前因为过滤面板显示而被自动隐藏，现在恢复它的显示
       */
      function restoreFileTreePanel() {
        const fileTreeContainer = DOMCache.get('fileTreeContainer');
        const fileTreeCollapseBtn = DOMCache.get('fileTreeCollapseBtn');

        // 只有在文件树被过滤面板隐藏的情况下才恢复
        if (fileTreeWasHiddenByFilter && fileTreeContainer) {
          fileTreeContainer.classList.add('visible');
          if (fileTreeCollapseBtn) {
            fileTreeCollapseBtn.innerHTML = '◀';
            fileTreeCollapseBtn.style.display = 'flex'; // 🔧 恢复显示折叠按钮
          }
          console.log('[Filter] 文件树面板已恢复');
          fileTreeWasHiddenByFilter = false;

          // 触发布局更新
          if (typeof updateLayout === 'function') {
            updateLayout();
          }
          if (typeof updateButtonPosition === 'function') {
            updateButtonPosition();
          }
        }
      }

      // 新增：初始化过滤面板大小和位置 - 使用 CSS 的 bottom 属性
      function initFilteredPanelSize() {
        // 🔧 修改：清除所有内联定位样式，让 CSS 的 top/bottom/left/right 控制面板大小
        filteredPanel.style.width = "";
        filteredPanel.style.height = ""; // 清除 height，让 CSS 的 bottom 生效
        filteredPanel.style.top = ""; // 🔧 清除 top，让 CSS 的 top: calc(50vh + 60px) 生效
        filteredPanel.style.left = "0";
        filteredPanel.style.removeProperty('right'); // 让 CSS 的 right 默认值生效
        filteredPanel.style.removeProperty('bottom'); // 🔧 清除 bottom，让 CSS 的 bottom: 16px 生效
        filteredPanel.style.removeProperty('--filtered-panel-top');
        // 保持 CSS 中的 top: calc(50vh + 60px) 和 bottom: 16px

        // 保存初始状态
        saveFilteredPanelState();
      }

      // 新增：保存过滤面板状态
      function saveFilteredPanelState() {
        filteredPanelState = {
          isMaximized: isFilterPanelMaximized,
          position: {
            left: filteredPanel.style.left,
            top: filteredPanel.style.top,
            width: filteredPanel.style.width,
            height: filteredPanel.style.height,
          },
        };
      }

      // 新增：恢复过滤面板状态
      function restoreFilteredPanelState() {
        if (filteredPanelState.position) {
          filteredPanel.style.left = filteredPanelState.position.left || "";
          filteredPanel.style.top = filteredPanelState.position.top || "";
          // 🔧 同步 --filtered-panel-top CSS变量
          if (filteredPanelState.position.top) {
            filteredPanel.style.setProperty('--filtered-panel-top', filteredPanelState.position.top);
          }
          // 不恢复 width 和 height，让 CSS 控制
          filteredPanel.style.width = "";
          filteredPanel.style.height = "";
        }
      }

      // 角落调整大小相关变量
      let cornerResizeRafId = null;
      let pendingCornerResizeData = null;

      // 新增：开始四角调整大小
      function startCornerResize(e, direction) {
        e.stopPropagation();
        isCornerResizing = true;
        resizeDirection = direction;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        panelStartX =
          parseInt(filteredPanel.style.left) || filteredPanel.offsetLeft;
        panelStartY =
          parseInt(filteredPanel.style.top) || filteredPanel.offsetTop;
        panelStartWidth = filteredPanel.offsetWidth;
        panelStartHeight = filteredPanel.offsetHeight;

        // 优化：添加防止选中样式
        document.body.classList.add("panel-resizing");
        filteredPanel.classList.add("panel-resizing");

        e.preventDefault();
      }


      // 新增：四角调整大小处理 - 优化：使用 requestAnimationFrame 避免顿挫感
      function handleCornerResize(e) {
        if (!isCornerResizing) return;

        // 存储最新的鼠标位置，使用 rAF 防止高频更新导致的卡顿
        pendingCornerResizeData = {
          clientX: e.clientX,
          clientY: e.clientY,
        };

        // 如果已经有 rAF 在排队，不重复请求
        if (cornerResizeRafId) return;

        cornerResizeRafId = requestAnimationFrame(() => {
          cornerResizeRafId = null;
          if (!pendingCornerResizeData || !isCornerResizing) return;

          const { clientX, clientY } = pendingCornerResizeData;
          pendingCornerResizeData = null;

          const deltaX = clientX - dragStartX;
          const deltaY = clientY - dragStartY;

          // 计算最小和最大尺寸
          const minWidth = 300;
          const minHeight = 200;
          const maxWidth = window.innerWidth;
          const maxHeight = window.innerHeight;

          // 考虑横向滚动条高度
          const hScrollHeight = 16;
          const maxBottom = window.innerHeight - hScrollHeight;

          let newX = panelStartX;
          let newY = panelStartY;
          let newWidth = panelStartWidth;
          let newHeight = panelStartHeight;

          // 根据调整方向计算新的位置和大小
          switch (resizeDirection) {
            case "nw": // 左上角：调整左边和上边
              newX = Math.min(
                panelStartX + deltaX,
                panelStartX + panelStartWidth - minWidth
              );
              newY = Math.min(
                panelStartY + deltaY,
                panelStartY + panelStartHeight - minHeight
              );
              newWidth = Math.max(
                minWidth,
                Math.min(maxWidth, panelStartWidth - deltaX)
              );
              newHeight = Math.max(
                minHeight,
                Math.min(maxHeight, panelStartHeight - deltaY)
              );
              break;
            case "ne": // 右上角：调整上边和宽度
              newY = Math.min(
                panelStartY + deltaY,
                panelStartY + panelStartHeight - minHeight
              );
              newWidth = Math.max(
                minWidth,
                Math.min(maxWidth, panelStartWidth + deltaX)
              );
              newHeight = Math.max(
                minHeight,
                Math.min(maxHeight, panelStartHeight - deltaY)
              );
              break;
            case "sw": // 左下角：调整左边和高度
              newX = Math.min(
                panelStartX + deltaX,
                panelStartX + panelStartWidth - minWidth
              );
              newWidth = Math.max(
                minWidth,
                Math.min(maxWidth, panelStartWidth - deltaX)
              );
              newHeight = Math.max(
                minHeight,
                Math.min(maxHeight - hScrollHeight, panelStartHeight + deltaY)
              );
              break;
            case "se": // 右下角：调整宽度和高度
              newWidth = Math.max(
                minWidth,
                Math.min(maxWidth, panelStartWidth + deltaX)
              );
              newHeight = Math.max(
                minHeight,
                Math.min(maxHeight - hScrollHeight, panelStartHeight + deltaY)
              );
              break;
          }

          // 确保面板底部不超过横向滚动条
          const panelBottom = newY + newHeight;
          if (panelBottom > maxBottom) {
            newHeight = maxBottom - newY;
          }

          // 确保面板顶部不低于工具栏
          const toolbarHeight = 25;
          if (newY < toolbarHeight) {
            newY = toolbarHeight;
            // 调整高度以保持面板底部位置
            newHeight = panelStartHeight + (panelStartY - newY);
          }

          // 确保左边界不为负
          if (newX < 0) {
            newWidth = newWidth + newX;
            newX = 0;
          }

          // 确保右边界不超出屏幕
          if (newX + newWidth > window.innerWidth) {
            newWidth = window.innerWidth - newX;
          }

          // 🚀 性能优化：批量设置DOM样式，减少reflow
          filteredPanel.style.left = newX + "px";
          filteredPanel.style.top = newY + "px";
          filteredPanel.style.setProperty('--filtered-panel-top', newY + 'px');
          filteredPanel.style.width = newWidth + "px";
          // 🔧 修复：不再设置 style.height，改为使用 CSS bottom 控制高度
          // 对于调整顶部的方向（nw, ne），只设置 top，让 bottom:0 自动计算高度
          // 对于调整底部的方向（sw, se），设置 bottom 偏移
          if (resizeDirection === "sw" || resizeDirection === "se") {
            // 调整底部方向：通过设置 bottom 值来控制高度
            const newBottom = window.innerHeight - (newY + newHeight);
            filteredPanel.style.bottom = newBottom + "px";
            filteredPanel.style.height = '';
          } else {
            // 调整顶部方向：只改 top，不设 height，让 bottom:0 自动计算
            filteredPanel.style.height = '';
            filteredPanel.style.removeProperty('bottom'); // 让 CSS 的 bottom:0 生效
          }

          // 🚀 性能优化：节流虚拟滚动更新，避免频繁调用
          // 只在尺寸变化超过10px时才更新虚拟滚动
          const widthChanged = Math.abs(newWidth - panelStartWidth) > 10;
          const heightChanged = Math.abs(newHeight - panelStartHeight) > 10;

          if (widthChanged || heightChanged) {
            // 使用防抖，避免高频更新
            if (filteredPanelResizeUpdateTimer) {
              cancelAnimationFrame(filteredPanelResizeUpdateTimer);
            }
            filteredPanelResizeUpdateTimer = requestAnimationFrame(() => {
              updateFilteredPanelVisibleLines();
              filteredPanelResizeUpdateTimer = null;
            });
          }
        });
      }

      // 🚀 性能优化：防抖定时器
      let filteredPanelResizeUpdateTimer = null;

      // 新增：初始化过滤结果框搜索功能
      function initFilteredPanelSearch() {
        // 输入事件：显示自动建议
        filteredPanelSearchBox.addEventListener("input", () => {
          clearTimeout(filteredPanelSearchInputTimeout);
          filteredPanelSearchInputTimeout = setTimeout(() => {
            showFilteredPanelSearchSuggestions();
          }, 300);

          const value = filteredPanelSearchBox.value;
          if (value.trim() === "" && filteredPanelSearchKeyword !== "") {
            filteredPanelResetSearch();
          }
        });

        // 获得焦点时显示建议
        filteredPanelSearchBox.addEventListener("focus", () => {
          showFilteredPanelSearchSuggestions();
        });

        // 失去焦点时隐藏建议（延迟以处理点击事件）
        filteredPanelSearchBox.addEventListener("blur", () => {
          setTimeout(() => {
            hideFilteredPanelSearchSuggestions();
          }, 200);
        });

        // 搜索框事件：按Enter搜索/跳转下一个，Shift+Enter跳转上一个
        // 关键优化：使用 keydown（比 keypress 更稳定），并阻止冒泡避免全局快捷键干扰
        filteredPanelSearchBox.addEventListener("keydown", (e) => {
          if (e.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const currentValue = filteredPanelSearchBox.value;

            // 搜索框为空时重置搜索
            if (currentValue.trim() === "") {
              filteredPanelResetSearch();
              return;
            }

            // 🔧 修复：检查搜索关键词是否变化
            const keywordChanged = currentValue !== filteredPanelSearchKeyword;

            if (keywordChanged) {
              // 关键词变化了，执行新搜索
              filteredPanelSearchKeyword = currentValue;
              filteredPanelPerformSearch();
            } else {
              // 关键词没变，在已有结果中跳转
              if (filteredPanelTotalMatchCount > 0) {
                if (e.shiftKey) {
                  // Shift+Enter：跳转到上一个匹配（循环）
                  filteredPanelPrevMatch();
                } else {
                  // Enter：跳转到下一个匹配（循环）
                  filteredPanelNextMatch();
                }
              } else {
                // 没有匹配结果，执行搜索
                filteredPanelPerformSearch();
              }
            }
          } else if (e.key === "Escape") {
            hideFilteredPanelSearchSuggestions();
          }
        });
      }

      // 过滤结果框搜索功能
      function filteredPanelPerformSearch() {
        filteredPanelSearchMatches = [];
        filteredPanelCurrentMatchIndex = -1;
        filteredPanelTotalMatchCount = 0;

        // 🚀 性能优化：搜索关键词变化时失效缓存
        invalidateFilteredLineCache();

        // 保存搜索历史
        addToFilteredPanelSearchHistory(filteredPanelSearchKeyword);

        // 使用trim检查是否为空，但保留原始值用于搜索
        if (filteredPanelSearchKeyword.trim() === "") {
          filteredPanelUpdateSearchUI();
          updateFilteredPanelVisibleLines();
          return;
        }

        // 尝试将搜索关键词解析为正则表达式
        let regex;
        try {
          // 支持多关键词搜索：按 | 分割，转义后重新组合
          const parts = filteredPanelSearchKeyword.split('|');
          const escapedPattern = parts.map(part => escapeRegExp(part)).join('|');
          regex = new RegExp(escapedPattern, "gi");
        } catch (e) {
          regex = new RegExp(escapeRegExp(filteredPanelSearchKeyword), "gi");
        }

        // 🚀 修复：从头到尾顺序搜索，不受滚动或点击影响
        let allMatches = [];

        for (let i = 0; i < filteredPanelAllLines.length; i++) {
          const lineContent = filteredPanelAllLines[i]; // 直接使用原始内容
          regex.lastIndex = 0;
          if (regex.test(lineContent)) {
            allMatches.push(i);
          }
        }

        filteredPanelSearchMatches = allMatches;
        filteredPanelTotalMatchCount = filteredPanelSearchMatches.length;
        if (filteredPanelTotalMatchCount > 0) {
          filteredPanelCurrentMatchIndex = 0;
          filteredPanelJumpToMatch(filteredPanelCurrentMatchIndex);
        }

        filteredPanelUpdateSearchUI();
        updateFilteredPanelVisibleLines();
      }

      // 修复：确保正确跳转，不跳过行
      function filteredPanelJumpToMatch(index) {
        if (
          filteredPanelTotalMatchCount === 0 ||
          index < 0 ||
          index >= filteredPanelTotalMatchCount
        )
          return;

        const targetFilteredIndex = filteredPanelSearchMatches[index];

        // 🚀 修复：确保获取正确的行高
        let lineHeight = filteredPanelLineHeight;

        // 如果 filteredPanelLineHeight 返回无效值，使用计算样式获取
        if (!lineHeight || lineHeight <= 0 || isNaN(lineHeight)) {
          try {
            const virtualContent = DOMCache.get('filteredPanelVirtualContent');
            if (virtualContent && virtualContent.firstElementChild) {
              lineHeight = virtualContent.firstElementChild.offsetHeight;
            } else {
              lineHeight = 19; // 默认行高
            }
            console.log(`[filteredPanelJumpToMatch] 使用备用行高: ${lineHeight}px`);
          } catch (e) {
            lineHeight = 19; // 默认行高
            console.warn('[filteredPanelJumpToMatch] 获取行高失败，使用默认值 19px');
          }
        }

        const lineTop = targetFilteredIndex * lineHeight;
        const panelHeight = filteredPanelContent.clientHeight;

        // 计算滚动位置，确保目标行在可视区域中间
        const scrollTop = Math.max(
          0,
          lineTop - panelHeight / 2 + lineHeight / 2
        );

        // 关键修复：如果过滤结果框正在进行"滚轮平滑 rAF"收敛动画，会持续抢写 scrollTop，
        // 必须在跳转前强制取消，否则会出现"跳转无效/回弹"的体验。
        try {
          if (
            filteredPanelContent &&
            typeof filteredPanelContent.__fastSmoothWheelCancel === "function"
          ) {
            filteredPanelContent.__fastSmoothWheelCancel();
          }
        } catch (_) {}

        // 使用即时滚动而不是平滑滚动，避免与虚拟滚动/滚轮动画叠加导致跳行/弹跳
        filteredPanelContent.scrollTop = scrollTop;

        // 🚀 修复：使用 requestAnimationFrame 确保 DOM 更新后再刷新可见行
        requestAnimationFrame(() => {
          updateFilteredPanelVisibleLines();
          // 添加额外的高亮效果
          highlightFilteredPanelSearchMatch(targetFilteredIndex);
        });
      }

      // 新增：高亮过滤结果框中的搜索匹配
      function highlightFilteredPanelSearchMatch(filteredIndex) {
        // 移除之前的高亮
        const existingHighlights = filteredPanelVirtualContent.querySelectorAll(
          ".filtered-log-line.search-match-highlight"
        );
        existingHighlights.forEach((line) => {
          line.classList.remove("search-match-highlight");
        });

        // 🔧 移除多余的 updateFilteredPanelVisibleLines 调用
        // 这个函数已经在 filteredPanelJumpToMatch 的 rAF 中被调用
        // 再次调用会导致竞态条件和性能问题

        // 高亮目标行
        const lineElement = filteredPanelVirtualContent.querySelector(
          `[data-filtered-index="${filteredIndex}"]`
        );
        if (lineElement) {
          lineElement.classList.add("search-match-highlight");
        }
      }

      // 新增：过滤结果框上一个匹配（支持循环）
      function filteredPanelPrevMatch() {
        if (filteredPanelTotalMatchCount === 0) return;

        if (filteredPanelCurrentMatchIndex > 0) {
          // 跳转到上一个
          filteredPanelCurrentMatchIndex--;
        } else {
          // 已经在第一个，循环到最后一个
          filteredPanelCurrentMatchIndex = filteredPanelTotalMatchCount - 1;
        }
        filteredPanelJumpToMatch(filteredPanelCurrentMatchIndex);
        filteredPanelUpdateSearchUI();
      }

      // 新增：过滤结果框下一个匹配（支持循环）
      function filteredPanelNextMatch() {
        if (filteredPanelTotalMatchCount === 0) return;

        if (filteredPanelCurrentMatchIndex < filteredPanelTotalMatchCount - 1) {
          // 跳转到下一个
          filteredPanelCurrentMatchIndex++;
        } else {
          // 已经在最后一个，循环到第一个
          filteredPanelCurrentMatchIndex = 0;
        }
        filteredPanelJumpToMatch(filteredPanelCurrentMatchIndex);
        filteredPanelUpdateSearchUI();
      }

      // 暴露到全局作用域，供HTML onclick使用
      window.filteredPanelPrevMatch = filteredPanelPrevMatch;
      window.filteredPanelNextMatch = filteredPanelNextMatch;

      // 新增：过滤结果框重置搜索
      function filteredPanelResetSearch() {
        filteredPanelSearchKeyword = "";
        filteredPanelSearchMatches = [];
        filteredPanelCurrentMatchIndex = -1;
        filteredPanelTotalMatchCount = 0;
        filteredPanelUpdateSearchUI();
        updateFilteredPanelVisibleLines();
      }

      // 新增：过滤结果框更新搜索UI
      function filteredPanelUpdateSearchUI() {
        filteredPanelPrevBtn.disabled =
          filteredPanelTotalMatchCount === 0 ||
          filteredPanelCurrentMatchIndex <= 0;
        filteredPanelNextBtn.disabled =
          filteredPanelTotalMatchCount === 0 ||
          filteredPanelCurrentMatchIndex >= filteredPanelTotalMatchCount - 1;
        filteredPanelSearchStatus.textContent =
          filteredPanelTotalMatchCount > 0
            ? `${
                filteredPanelCurrentMatchIndex + 1
              }/${filteredPanelTotalMatchCount}`
            : "";
      }

      // 新增：切换过滤面板最大化状态
      function toggleFilterPanelMaximize() {
        // 🔧 修复：检查 DOM 的实际状态，而不是依赖变量
        // 这样可以避免从最小化展开时状态不一致的问题
        const isCurrentlyMaximized = filteredPanel.classList.contains("maximized");
        const maximizeBtn = DOMCache.get('filteredPanelMaximize');

        if (!isCurrentlyMaximized) {
          // 保存当前状态
          saveFilteredPanelState();
          // 最大化面板
          filteredPanel.classList.add("maximized");
          filteredPanel.style.removeProperty('height');
          filteredPanel.style.removeProperty('width');
          filteredPanel.style.removeProperty('--filtered-panel-top');
          isFilterPanelMaximized = true;
          // 🔧 切换图标为还原图标
          if (maximizeBtn) maximizeBtn.textContent = '❐';
          console.log('[toggleFilterPanelMaximize] 面板已最大化，isFilterPanelMaximized =', isFilterPanelMaximized);
        } else {
          // 还原面板
          filteredPanel.classList.remove("maximized");

          // 🔧 清除所有最大化相关的内联样式，让 CSS 的默认值生效
          filteredPanel.style.removeProperty('top');
          filteredPanel.style.removeProperty('left');
          filteredPanel.style.removeProperty('width');
          filteredPanel.style.removeProperty('height');
          filteredPanel.style.removeProperty('right');
          filteredPanel.style.removeProperty('bottom');
          filteredPanel.style.removeProperty('margin');
          filteredPanel.style.removeProperty('padding');
          filteredPanel.style.removeProperty('--filtered-panel-top');

          isFilterPanelMaximized = false;
          // 🔧 切换图标为最大化图标
          if (maximizeBtn) maximizeBtn.textContent = '□';
          console.log('[toggleFilterPanelMaximize] 面板已还原，isFilterPanelMaximized =', isFilterPanelMaximized);
        }

        // 性能优化：延迟更新虚拟滚动，使用requestAnimationFrame确保在下一帧渲染
        // 避免在面板大小调整时立即触发昂贵的DOM重渲染
        requestAnimationFrame(() => {
          // 🚀 性能优化：移除头部高度检查，避免不必要的 getComputedStyle 调用
          // 头部高度保护器已经内置节流机制，会在需要时自动检查

          // 再次检查是否仍然需要更新（可能在动画过程中状态已改变）
          if (filteredPanelAllLines.length > 0) {
            updateFilteredPanelVisibleLines();
          }
        });
      }

      // 处理过滤面板滚动 - 虚拟滚动核心 - 修复：确保正确更新可见行
      // 🚀 性能优化：使用 rAF 节流，避免重复渲染，提升滚动流畅度 50-70%
      function handleFilteredPanelScroll() {
        // 保存滚动位置
        filteredPanelScrollPosition = filteredPanelContent.scrollTop;

        // 🔧 修复：清除之前的停止检测定时器
        if (filteredPanelScrollDebounce) {
          clearTimeout(filteredPanelScrollDebounce);
          filteredPanelScrollDebounce = null;
        }

        // 🚀 rAF 节流：如果已有待处理的渲染请求，跳过本次
        if (filteredPanelScrollRafId !== null) {
          return;
        }

        // 请求在下一帧渲染，避免同一帧内多次更新
        filteredPanelScrollRafId = requestAnimationFrame(() => {
          // 🚀 性能优化：移除滚动时的头部高度检查，避免昂贵的 getComputedStyle 调用
          // 头部高度保护器已经内置节流机制，会在需要时自动检查

          updateFilteredPanelVisibleLines();
          filteredPanelScrollRafId = null;

          // 🚀 性能优化：移除滚动停止后的延迟更新，避免卡顿感
          // 原代码会在滚动停止 100ms 后再次强制更新高亮，造成用户感知的卡顿
          // 懒加载高亮机制已经足够，可见区域的高亮会在滚动时自动更新
          // filteredPanelScrollDebounce = setTimeout(() => {
          //   updateFilteredPanelVisibleLines(true);
          //   filteredPanelScrollDebounce = null;
          // }, 100);
        });
      }

      // 🚀 构建预缓存：在过滤完成后立即调用，预先生成所有HTML
      function buildFilteredPanelHtmlCache() {
        if (filteredPanelAllLines.length === 0) {
          filteredPanelHtmlCache = [];
          filteredPanelEscapedCache = [];
          return;
        }

        const length = filteredPanelAllLines.length;
        filteredPanelEscapedCache = new Array(length);
        filteredPanelHtmlCache = new Array(length);

        // 批量生成HTML
        for (let i = 0; i < length; i++) {
          const lineContent = filteredPanelAllLines[i];
          const isFileHeader = lineContent && lineContent.startsWith("=== 文件:");
          const originalIndex = filteredPanelAllOriginalIndices[i];

          // 🚀 不再转义HTML，直接使用原始内容
          filteredPanelEscapedCache[i] = lineContent;

          // 添加行号
          let displayText = lineContent;
          if (!isFileHeader) {
            const lineNumber = originalIndex + 1;
            displayText = `<span class="line-number">${lineNumber}</span>${displayText}`;
          }

          // 构建完整HTML（不包括动态的highlight类）
          const className = isFileHeader ? "file-header filtered-log-line" : "filtered-log-line";
          const top = Math.floor(i * filteredPanelLineHeight);

          filteredPanelHtmlCache[i] = {
            className: className,
            top: top,
            originalIndex: originalIndex,
            displayText: displayText,
            isFileHeader: isFileHeader
          };
        }

        console.log(`[缓存] 预缓存了 ${length} 行HTML`);
      }

      // 🚀 性能优化：生成行HTML缓存键
      function getFilteredLineCacheKey(lineIndex, isFileHeader, originalIndex) {
        // 🚀 性能优化：简化缓存键，只保留真正影响显示的因素
        // 去掉了已禁用的过滤关键词，减少缓存失效
        const searchKey = filteredPanelSearchKeyword || '';
        const secondaryKey = (secondaryFilter.isActive && secondaryFilter.filterKeywords) ? secondaryFilter.filterKeywords.join('|') : '';
        const customKey = (customHighlights || []).map(h => h.keyword).join('|');
        // 只保留：版本号、行索引、文件头、搜索词、二级过滤、自定义高亮
        return `v${filteredLineCacheVersion}|${lineIndex}|${isFileHeader}|${originalIndex}|s:${searchKey}|sec:${secondaryKey}|c:${customKey}`;
      }

      // 🚀 性能优化：失效缓存（当关键词/高亮变化时调用）
      function invalidateFilteredLineCache() {
        filteredLineCacheVersion++;
        // 🚀 优化：只清空缓存，不重新分配，减少 GC 压力
        filteredLineHtmlCache.clear();
      }

      // 更新过滤面板可见行 - 虚拟滚动核心 - 🚀 恢复所有高亮功能
      // forceHighlight: 强制重新计算高亮（用于滚动停止后的更新）
      function updateFilteredPanelVisibleLines(forceHighlight = false) {
        if (filteredPanelAllLines.length === 0) return;

        // 🔧 修复：如果 clientHeight 为 0（面板尚未布局），延迟一帧再渲染
        const currentClientHeight = filteredPanelContent.clientHeight;
        if (currentClientHeight === 0) {
          requestAnimationFrame(() => updateFilteredPanelVisibleLines(forceHighlight));
          return;
        }

        // 🚀 性能优化：fileHeaderIndices 已在 updateFilteredPanel() 中预计算
        // 只在 updateFilteredPanelVisibleLines 被独立调用（如滚动事件）时才需要重新计算
        let needsRecompute = false;
        if (fileHeaderIndices.size === 0 && filteredPanelAllLines.length > 0) {
          needsRecompute = true;
        } else if (window.needsFileHeaderRecompute) {
          needsRecompute = true;
          window.needsFileHeaderRecompute = false;
        }

        if (needsRecompute && filteredPanelAllLines.length > 0) {
          fileHeaderIndices.clear();
          for (let i = 0; i < filteredPanelAllLines.length; i++) {
            if (filteredPanelAllLines[i] && filteredPanelAllLines[i].startsWith("=== 文件:")) {
              fileHeaderIndices.add(i);
            }
          }
        }

        // 🚀 性能优化1：使用缓存的屏幕可见行数，只在窗口 resize 时重新计算
        // 🚀 修复Layout Thrashing：批量读取布局属性，避免多次读取
        // currentClientHeight 已在函数顶部读取（含 clientHeight===0 的早退出保护）
        if (cachedScreenVisibleLines === 0 || currentClientHeight !== lastKnownClientHeight) {
          cachedScreenVisibleLines = Math.ceil(currentClientHeight / filteredPanelLineHeight);
          lastKnownClientHeight = currentClientHeight;
        }
        const screenVisibleLines = cachedScreenVisibleLines;
        const totalLines = filteredPanelAllLines.length;

        // 🚀 优化：增加缓冲区倍数，提升滚动流畅度（2025-02-22）
        if (totalLines < 100) {
          filteredPanelBuffer = Math.max(50, Math.floor(screenVisibleLines * 3));  // 小文件：3倍缓冲 (原2倍)
        } else if (totalLines < 10000) {
          filteredPanelBuffer = Math.max(80, Math.floor(screenVisibleLines * 2.5));  // 中等文件：2.5倍缓冲 (原1.5倍)
        } else if (totalLines < 100000) {
          filteredPanelBuffer = Math.max(100, Math.floor(screenVisibleLines * 2));  // 大文件：2倍缓冲 (原1.2倍)
        } else {
          filteredPanelBuffer = Math.max(150, Math.floor(screenVisibleLines * 1.5));  // 超大文件：1.5倍缓冲 (原1倍)
        }

        // 🚀 修复Layout Thrashing：一次性读取所有布局属性
        const scrollTop = filteredPanelContent.scrollTop;

        // 计算可见区域（含缓冲区）
        const newVisibleStart = Math.max(
          0,
          Math.floor(scrollTop / filteredPanelLineHeight) - filteredPanelBuffer
        );
        const newVisibleEnd = Math.min(
          filteredPanelAllLines.length - 1,
          Math.ceil((scrollTop + currentClientHeight) / filteredPanelLineHeight) +
            filteredPanelBuffer
        );

        // 🚀 性能优化3：懒加载高亮范围 - 只在有高亮需求时才计算 trulyVisible 区域
        let trulyVisibleStart = newVisibleStart;  // 默认值，当不需要高亮时使用
        let trulyVisibleEnd = newVisibleEnd;

        // 🚀 性能优化：计算需要应用的高亮类型
        const hasPrimaryKeywords = currentFilter.filterKeywords && currentFilter.filterKeywords.length > 0;
        const hasSecondaryKeywords = secondaryFilter.isActive && secondaryFilter.filterKeywords.length > 0;
        const hasSearchKeyword = filteredPanelSearchKeyword && filteredPanelTotalMatchCount > 0; // 保留变量用于搜索跳转逻辑
        const hasCustomHighlights = customHighlights && customHighlights.length > 0;

        // 🚀 全局高亮需求：任何行是否需要高亮
        // 🔧 移除搜索关键词高亮需求（用户不希望搜索关键词被高亮）
        const anyHighlightNeeded = hasPrimaryKeywords || hasSecondaryKeywords || hasCustomHighlights;

        // 🚀 只在有高亮需求时才计算真正可见区域
        // 🔧 修复：让高亮范围覆盖整个渲染缓冲区，解决快速滚动时高亮缺失问题
        // 原来的懒加载高亮会导致缓冲区的行没有高亮，快速滚动时用户会看到无高亮的内容
        if (anyHighlightNeeded) {
          // 🔧 让 trulyVisible 覆盖整个渲染范围（newVisibleStart 到 newVisibleEnd）
          // 这样所有被渲染的行都会正确高亮，不会出现"先无高亮、后有高亮"的问题
          trulyVisibleStart = newVisibleStart;
          trulyVisibleEnd = newVisibleEnd;
        }

        // 如果可见区域没有变化，且不是强制高亮，则跳过更新
        if (
          !forceHighlight &&
          newVisibleStart === filteredPanelVisibleStart &&
          newVisibleEnd === filteredPanelVisibleEnd
        ) {
          return;
        }

        filteredPanelVisibleStart = newVisibleStart;
        filteredPanelVisibleEnd = newVisibleEnd;

        // 🚀 优化策略：如果二级过滤激活，优先显示二级过滤高亮，跳过一级过滤高亮
        const skipPrimaryHighlight = hasSecondaryKeywords;

        // 🚀 优化：如果完全没有高亮需求，使用textContent（快50倍，避免HTML解析和转义）
        if (!anyHighlightNeeded) {
          // 快速路径：使用纯文本模式，无需HTML转义
          const fragment = document.createDocumentFragment();

          for (let i = newVisibleStart; i <= newVisibleEnd; i++) {
            const lineContent = filteredPanelAllLines[i];
            // 🚀 性能优化2：使用预计算的文件头索引集合，而不是 startsWith 检查
            const isFileHeader = fileHeaderIndices.has(i);
            const originalIndex = filteredPanelAllOriginalIndices[i];
            const className = isFileHeader ? "file-header filtered-log-line" : "filtered-log-line";
            const highlighted = i === lastClickedFilteredIndex ? " highlighted" : "";

            // 创建行元素
            const lineElement = document.createElement("div");
            lineElement.className = className + highlighted;
            lineElement.dataset.originalIndex = originalIndex;
            lineElement.dataset.filteredIndex = i;
            // 🔧 修复：使用 max-content 让内容自然撑开，触发横向滚动条
            lineElement.style.cssText = `top:${Math.floor(i * filteredPanelLineHeight)}px;width:max-content;min-width:100%;position:absolute;`;
            lineElement.title = lineContent;

            // 🚀 使用textContent，完全避免HTML解析
            // 添加行号
            if (!isFileHeader) {
              const lineNumber = originalIndex + 1;
              lineElement.textContent = `${lineNumber} ${lineContent}`;
            } else {
              lineElement.textContent = lineContent;
            }


            fragment.appendChild(lineElement);
          }

          // 🚀 一次性批量添加DOM（比innerHTML更快且更安全）
          filteredPanelVirtualContent.innerHTML = '';
          filteredPanelVirtualContent.appendChild(fragment);
          return;
        }

        // 🚀 有高亮需求时：使用innerHTML批量更新（需要HTML转义）
        const htmlArray = new Array(newVisibleEnd - newVisibleStart + 1);
        let arrayIndex = 0;

        for (let i = newVisibleStart; i <= newVisibleEnd; i++) {
          const lineContent = filteredPanelAllLines[i];
          // 🚀 性能优化2：使用预计算的文件头索引集合，而不是 startsWith 检查
          const isFileHeader = fileHeaderIndices.has(i);
          const originalIndex = filteredPanelAllOriginalIndices[i];

          // 🚀 懒加载高亮：只对真正可见的行计算高亮，缓冲区只添加行号（减少40-60%高亮计算）
          const isTrulyVisible = (i >= trulyVisibleStart && i <= trulyVisibleEnd);
          const needsHighlight = isTrulyVisible || isFileHeader;

          // 🚀 性能优化：检查缓存（避免重复计算高亮，每行最多12次safeHighlight调用）
          // 注意：缓存键包含是否需要高亮的信息，确保缓存正确性
          const cacheKey = getFilteredLineCacheKey(i, isFileHeader, originalIndex) + `|h:${needsHighlight}`;
          let displayText = filteredLineHtmlCache.get(cacheKey);

          if (displayText !== undefined) {
            // LRU: 重新插入以提升到最近使用位置
            filteredLineHtmlCache.delete(cacheKey);
            filteredLineHtmlCache.set(cacheKey, displayText);
          } else {
            // 缓存未命中，计算HTML并缓存
            // 🚀 重要修复：先对原始内容进行HTML转义，防止特殊字符被误解析
            // 例如：now<next=0 会被转义为 now&lt;next=0
            displayText = escapeHtml(lineContent);

            // 🚀 懒加载：只对可见行和文件头计算高亮
            if (needsHighlight) {
              // 应用自定义高亮（优先级最高）
              if (hasCustomHighlights) {
                for (let h = 0; h < customHighlights.length; h++) {
                  const highlight = customHighlights[h];
                  if (!highlight.keyword) continue;
                  // 🚀 注意：由于文本已转义，关键词也需要转义才能匹配
                  const escapedKeyword = escapeHtml(highlight.keyword);
                  displayText = safeHighlight(
                    displayText,
                    escapedKeyword,
                    (match) => `<span class="custom-highlight" style="background-color: ${highlight.color}80;">${match}</span>`
                  );
                }
              }

              // 🚀 性能优化：跳过过滤关键词高亮（文件头通过CSS类实现样式）
              // 过滤关键词高亮会严重拖慢性能，已禁用
              // if (!skipPrimaryHighlight && hasPrimaryKeywords) { ... }

              // 应用二级过滤高亮
              if (hasSecondaryKeywords) {
                for (let k = 0; k < secondaryFilter.filterKeywords.length; k++) {
                  const keyword = secondaryFilter.filterKeywords[k];
                  if (!keyword) continue;
                  const colorClass =
                    secondaryFilterHighlightClasses[
                      k % secondaryFilterHighlightClasses.length
                    ];
                  // 🚀 注意：由于文本已转义，关键词也需要转义才能匹配
                  const escapedKeyword = escapeHtml(keyword);
                  displayText = safeHighlight(
                    displayText,
                    escapedKeyword,
                    (match) => `<span class="${colorClass}">${match}</span>`
                  );
                }
              }

              // 🔧 移除搜索关键词高亮（用户不希望搜索关键词被高亮）
            }

            // 添加行号
            if (!isFileHeader) {
              const lineNumber = originalIndex + 1;
              displayText = `<span class="line-number">${lineNumber}</span>${displayText}`;
            }

            // 存入缓存（排除动态的高亮类）- 使用LRU淘汰策略
            addToFilteredLineCache(cacheKey, displayText);
          }

          // 构建HTML字符串（动态的highlighted类不参与缓存）
          const className = isFileHeader ? "file-header filtered-log-line" : "filtered-log-line";
          const top = Math.floor(i * filteredPanelLineHeight);
          const highlighted = i === lastClickedFilteredIndex ? " highlighted" : "";

          // 🔧 修复：使用 max-content 让内容自然撑开，触发横向滚动条
          htmlArray[arrayIndex++] = `<div class="${className}${highlighted}" data-original-index="${originalIndex}" data-filtered-index="${i}" style="top:${top}px;width:max-content;min-width:100%;position:absolute;">${displayText}</div>`;
        }

        // 🚀 一次性innerHTML批量更新
        filteredPanelVirtualContent.innerHTML = htmlArray.join('');
      }

      // 🚀 优化：简化版内容更新函数，去掉所有HTML操作（高亮、链接转换等）
      // 只保留必要的样式，大幅提升性能
      function updateFilteredLineElementContent(lineElement, index, lineContent, isFileHeader) {
        // 存储原始行号
        lineElement.dataset.originalIndex = filteredPanelAllOriginalIndices[index];
        lineElement.dataset.filteredIndex = index;
        lineElement.title = lineContent;

        // 🚀 优化：检查是否有任何高亮需求
        const hasPrimaryKeywords = currentFilter.filterKeywords && currentFilter.filterKeywords.length > 0;
        const hasSecondaryKeywords = secondaryFilter.isActive && secondaryFilter.filterKeywords.length > 0;
        const hasSearchKeyword = filteredPanelSearchKeyword && filteredPanelTotalMatchCount > 0; // 保留变量用于搜索跳转逻辑
        const hasCustomHighlights = customHighlights && customHighlights.length > 0;
        // 🔧 移除搜索关键词高亮需求（用户不希望搜索关键词被高亮）
        const anyHighlightNeeded = hasPrimaryKeywords || hasSecondaryKeywords || hasCustomHighlights;

        if (!anyHighlightNeeded) {
          // 🚀 快速路径：无高亮需求时使用textContent（快50倍，完全避免HTML解析）
          if (!isFileHeader) {
            const originalIndex = filteredPanelAllOriginalIndices
              ? filteredPanelAllOriginalIndices[index]
              : index;
            const lineNumber = originalIndex + 1;
            lineElement.textContent = `${lineNumber} ${lineContent}`;
          } else {
            lineElement.textContent = lineContent;
          }
        } else {
          // 🚀 有高亮需求：使用innerHTML（需要HTML转义）
          // 注意：这个函数不实际应用高亮，高亮由其他函数处理
          // 这里只负责安全地显示原始内容
          let displayText = escapeHtml(lineContent);

          // 添加行号显示（使用原始日志行号）
          if (!isFileHeader) {
            const originalIndex = filteredPanelAllOriginalIndices
              ? filteredPanelAllOriginalIndices[index]
              : index;
            const lineNumber = originalIndex + 1;
            displayText = `<span class="line-number">${lineNumber}</span>${displayText}`;
          }

          // 更新内容
          lineElement.innerHTML = displayText;
        }

        // 🚀 性能优化：使用transform替代top，启用GPU加速
        lineElement.style.transform = `translateY(${Math.floor(index * filteredPanelLineHeight)}px)`;

        // 高亮当前点击的行
        if (index === lastClickedFilteredIndex) {
          lineElement.classList.add("highlighted");
        } else {
          lineElement.classList.remove("highlighted");
        }


        // 搜索匹配行高亮（仅当有搜索关键词时）
        if (
          filteredPanelCurrentMatchIndex >= 0 &&
          filteredPanelSearchMatches &&
          filteredPanelCurrentMatchIndex < filteredPanelSearchMatches.length &&
          index === filteredPanelSearchMatches[filteredPanelCurrentMatchIndex]
        ) {
          lineElement.classList.add("current-match-line");
        } else {
          lineElement.classList.remove("current-match-line");
        }

        // 二级过滤时存储一级过滤索引
        if (
          secondaryFilter.isActive &&
          filteredPanelAllPrimaryIndices.length > index
        ) {
          lineElement.dataset.primaryIndex = filteredPanelAllPrimaryIndices[index];
        }
      }

      // 创建过滤行元素 - 🚀 优化：简化版，去掉所有HTML高亮操作
      // 只保留基础功能，大幅提升性能
      function createFilteredLineElement(index) {
        const lineElement = document.createElement("div");

        const lineContent = filteredPanelAllLines[index];

        // 🚀 检测文件头，为包含 "=== 文件:" 的行添加 file-header 类
        const isFileHeader = lineContent && lineContent.startsWith("=== 文件:");
        lineElement.className = isFileHeader ? "file-header filtered-log-line" : "filtered-log-line";

        // 存储原始行号
        lineElement.dataset.originalIndex =
          filteredPanelAllOriginalIndices[index];
        lineElement.dataset.filteredIndex = index;

        lineElement.title = lineContent;

        // 🚀 优化：检查是否有任何高亮需求
        const hasPrimaryKeywords = currentFilter.filterKeywords && currentFilter.filterKeywords.length > 0;
        const hasSecondaryKeywords = secondaryFilter.isActive && secondaryFilter.filterKeywords.length > 0;
        const hasSearchKeyword = filteredPanelSearchKeyword && filteredPanelTotalMatchCount > 0; // 保留变量用于搜索跳转逻辑
        const hasCustomHighlights = customHighlights && customHighlights.length > 0;
        // 🔧 移除搜索关键词高亮需求（用户不希望搜索关键词被高亮）
        const anyHighlightNeeded = hasPrimaryKeywords || hasSecondaryKeywords || hasCustomHighlights;

        if (!anyHighlightNeeded) {
          // 🚀 快速路径：无高亮需求时使用textContent（快50倍，完全避免HTML解析）
          if (!isFileHeader) {
            const originalIndex = filteredPanelAllOriginalIndices
              ? filteredPanelAllOriginalIndices[index]
              : index;
            const lineNumber = originalIndex + 1;
            lineElement.textContent = `${lineNumber} ${lineContent}`;
          } else {
            lineElement.textContent = lineContent;
          }
        } else {
          // 🚀 有高亮需求：使用innerHTML（需要HTML转义）
          let displayText = escapeHtml(lineContent);

          // 添加行号显示（使用原始日志行号）
          if (!isFileHeader) {
            const originalIndex = filteredPanelAllOriginalIndices
              ? filteredPanelAllOriginalIndices[index]
              : index;
            const lineNumber = originalIndex + 1;
            displayText = `<span class="line-number">${lineNumber}</span>${displayText}`;
          }

          lineElement.innerHTML = displayText;
        }
        // 🚀 性能优化：使用transform替代top，启用GPU加速
        lineElement.style.transform = `translateY(${Math.floor(index * filteredPanelLineHeight)}px)`;

        // 高亮当前点击的行
        if (index === lastClickedFilteredIndex) {
          lineElement.classList.add("highlighted");
        }

        return lineElement;
      }


      // 处理面板鼠标移动 - 优化：使用requestAnimationFrame实现流畅动画
      function handlePanelMouseMove(e) {
        if (!isCornerResizing && !isWindowResizing) return;

        // 优化：使用requestAnimationFrame避免性能问题
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }

        animationFrameId = requestAnimationFrame(() => {
          if (isCornerResizing) {
            handleCornerResize(e);
          } else if (isWindowResizing) {
            // 处理窗口调整大小 - 支持多方向
            const deltaX = e.clientX - windowResizeStartX;
            const deltaY = e.clientY - windowResizeStartY;
            const dir = windowResizeDirection;

            let newBounds = {
              x: windowStartX,
              y: windowStartY,
              width: windowStartWidth,
              height: windowStartHeight
            };

            // 根据方向调整窗口
            if (dir.includes('e')) {
              newBounds.width = Math.max(800, windowStartWidth + deltaX);
            }
            if (dir.includes('w')) {
              const newWidth = Math.max(800, windowStartWidth - deltaX);
              newBounds.x = windowStartX + (windowStartWidth - newWidth);
              newBounds.width = newWidth;
            }
            if (dir.includes('s')) {
              newBounds.height = Math.max(600, windowStartHeight + deltaY);
            }
            if (dir.includes('n')) {
              const newHeight = Math.max(600, windowStartHeight - deltaY);
              newBounds.y = windowStartY + (windowStartHeight - newHeight);
              newBounds.height = newHeight;
            }

            if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
              window.electronAPI.windowControl.setBounds({
                x: Math.round(newBounds.x),
                y: Math.round(newBounds.y),
                width: Math.round(newBounds.width),
                height: Math.round(newBounds.height)
              });

              // 实时更新保存的窗口状态（用于双击还原）
              lastUnmaximizedBounds = {
                width: Math.round(newBounds.width),
                height: Math.round(newBounds.height),
                x: Math.round(newBounds.x),
                y: Math.round(newBounds.y)
              };
            }
          }
        });

        e.preventDefault();
      }

      // 处理面板鼠标释放 - 优化：清理样式
      function handlePanelMouseUp() {
        isCornerResizing = false;
        isWindowResizing = false;
        windowResizeDirection = "";

        // 优化：移除防止选中样式
        document.body.classList.remove(
          "panel-resizing", "window-resizing",
          "resizing-n", "resizing-s", "resizing-e", "resizing-w",
          "resizing-nw", "resizing-ne", "resizing-sw", "resizing-se"
        );
        filteredPanel.classList.remove("panel-resizing");

        // 优化：清理动画帧
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
        // 清理角落调整大小的 rAF
        if (cornerResizeRafId) {
          cancelAnimationFrame(cornerResizeRafId);
          cornerResizeRafId = null;
        }
        pendingCornerResizeData = null;

        // 🚀 性能优化：清理虚拟滚动更新定时器，并确保最后更新一次
        if (filteredPanelResizeUpdateTimer) {
          cancelAnimationFrame(filteredPanelResizeUpdateTimer);
          filteredPanelResizeUpdateTimer = null;
        }
        // resize结束后，强制更新一次虚拟滚动，确保显示正确
        requestAnimationFrame(() => {
          updateFilteredPanelVisibleLines();
        });
      }

      // 处理过滤结果行点击 - 修复重复点击问题
      function handleFilteredLineClick(e) {
        const lineElement = e.target.closest(".filtered-log-line");
        if (!lineElement) return;

        const originalIndex = parseInt(lineElement.dataset.originalIndex);
        const filteredIndex = parseInt(lineElement.dataset.filteredIndex);

        if (isNaN(originalIndex) || isNaN(filteredIndex)) return;

        // 优化：点击过滤结果行时不改变面板大小（保持最大化/当前尺寸）

        // 记录当前点击的过滤面板行索引
        lastClickedFilteredIndex = filteredIndex;

        // 🚀 新增：记录原始行索引（用于过滤后快速定位，O(1) Map 查找）
        lastClickedOriginalIndex = originalIndex;

        // 🚀 新增：记录当前过滤结果的总行数（用于计算相对位置）
        if (typeof filteredPanelAllOriginalIndices !== 'undefined' && filteredPanelAllOriginalIndices) {
          lastClickedFilteredTotalCount = filteredPanelAllOriginalIndices.length;
        } else {
          lastClickedFilteredTotalCount = -1;
        }

        console.log(`[Click] 记录点击: filteredIndex=${filteredIndex}/${lastClickedFilteredTotalCount}, originalIndex=${originalIndex}`);

        // 跳转到原始日志的对应行
        jumpToOriginalLine(originalIndex);

        // 高亮过滤面板中的当前行
        highlightFilteredLine(filteredIndex);
      }

      // 高亮过滤面板中的指定行
      function highlightFilteredLine(filteredIndex) {
        // 移除之前的高亮
        const existingHighlights = filteredPanelVirtualContent.querySelectorAll(
          ".filtered-log-line.highlighted, .filtered-log-line.search-match-highlight"
        );
        existingHighlights.forEach((line) => {
          line.classList.remove("highlighted", "search-match-highlight");
        });

        // 如果目标行在可见区域内，直接高亮
        if (
          filteredIndex >= filteredPanelVisibleStart &&
          filteredIndex <= filteredPanelVisibleEnd
        ) {
          const lineElement = filteredPanelVirtualContent.querySelector(
            `[data-filtered-index="${filteredIndex}"]`
          );
          if (lineElement) {
            lineElement.classList.add("highlighted");
          }
        } else {
          // 如果目标行不在可见区域内，先滚动到该行
          scrollToFilteredLine(filteredIndex);

          // 滚动完成后高亮（通过事件监听处理）
        }
      }

      // 滚动到过滤面板中的指定行
      function scrollToFilteredLine(filteredIndex) {
        const lineTop = filteredIndex * filteredPanelLineHeight;
        const panelHeight = filteredPanelContent.clientHeight;

        const targetTop = Math.max(0, lineTop - panelHeight / 2);
        // 同步取消滚轮 rAF，避免与程序滚动抢写
        try {
          if (
            filteredPanelContent &&
            typeof filteredPanelContent.__fastSmoothWheelCancel === "function"
          ) {
            filteredPanelContent.__fastSmoothWheelCancel();
          }
        } catch (_) {}
        // 用直接赋值避免“平滑滚动 + 虚拟列表刷新”的弹跳
        filteredPanelContent.scrollTop = targetTop;
      }

      // 跳转到原始日志的指定行
      function jumpToOriginalLine(originalIndex) {
        // 注意：此函数已被 virtual-scroll-patch.js 中的版本覆盖
        // 实际执行的是 virtual-scroll-patch.js 中的实现
        highlightOriginalLine(originalIndex, true);
      }

      // 🚀 跳转到过滤面板中的指定行（如果存在）
      function jumpToFilteredPanelIfContains(originalIndex) {
        // 检查过滤面板是否可见
        if (!filteredPanel || !filteredPanel.classList.contains("visible")) {
          return;
        }

        // 检查过滤面板是否包含该行
        if (!filteredPanelAllOriginalIndices || filteredPanelAllOriginalIndices.length === 0) {
          return;
        }

        // 在过滤结果中查找该行的索引
        const filteredIndex = filteredPanelAllOriginalIndices.indexOf(originalIndex);
        if (filteredIndex === -1) {
          // 该行不在过滤结果中
          return;
        }

        // 该行在过滤结果中，跳转过去
        // 🚀 性能优化：使用 DOM 缓存
        const filteredPanelContent = DOMCache.get('filteredPanelContent');
        if (!filteredPanelContent) return;

        const lineHeight = 18; // 过滤面板行高（与主日志框一致）
        const containerHeight = filteredPanelContent.clientHeight;

        // 计算目标行的位置
        const targetLineTop = filteredIndex * lineHeight;

        // 计算偏移量：让目标行显示在内容框上方约1/4位置
        const offsetFromTop = containerHeight * 0.25;
        const scrollTop = targetLineTop - offsetFromTop;

        // 滚动到目标位置
        const targetTop = Math.max(0, scrollTop);
        try {
          filteredPanelContent.scrollTop = targetTop;
        } catch (_) {
          // ignore
        }

        // 设置当前点击的过滤面板行索引，让虚拟滚动系统自动高亮
        lastClickedFilteredIndex = filteredIndex;

        // 更新虚拟滚动，让高亮生效
        if (typeof updateFilteredPanelVisibleLines === 'function') {
          updateFilteredPanelVisibleLines();
        }
      }

      // 🚀 滚动到过滤面板中的指定索引（用于智能跳转）
      function scrollFilteredPanelToIndex(filteredIndex) {
        if (!filteredPanelContent) return;
        if (filteredIndex < 0 || filteredIndex >= filteredPanelAllLines.length) return;

        const lineHeight = filteredPanelLineHeight || 18;
        const containerHeight = filteredPanelContent.clientHeight;

        // 计算目标行的位置
        const targetLineTop = filteredIndex * lineHeight;

        // 计算偏移量：让目标行显示在内容框中间位置
        const offsetFromTop = containerHeight * 0.4;
        const scrollTop = targetLineTop - offsetFromTop;

        // 滚动到目标位置
        const targetTop = Math.max(0, Math.min(scrollTop, filteredPanelContent.scrollHeight - containerHeight));
        try {
          filteredPanelContent.scrollTop = targetTop;
        } catch (_) {
          // ignore
        }

        // 设置当前点击的过滤面板行索引，让虚拟滚动系统自动高亮
        lastClickedFilteredIndex = filteredIndex;

        // 更新虚拟滚动，让高亮生效
        if (typeof updateFilteredPanelVisibleLines === 'function') {
          requestAnimationFrame(() => {
            updateFilteredPanelVisibleLines();
          });
        }
      }

      // 高亮显示原始日志中的指定行 - 添加永久高亮选项
      function highlightOriginalLine(originalIndex, permanent = false) {
        // 如果已经是当前永久高亮的行，则不做任何操作
        if (permanent && originalIndex === currentPermanentHighlightIndex) {
          return;
        }

        // 更新当前永久高亮索引
        if (permanent) {
          currentPermanentHighlightIndex = originalIndex;
        }

        // 强制刷新可见行以更新高亮状态
        forceUpdateVisibleLines();
      }

      // 🔧 新增：头部高度保护器 - 使用 MutationObserver 持续监听并修复头部高度
      let headerHeightProtector = null;

      function initHeaderHeightProtector() {
        if (headerHeightProtector) return; // 已经初始化过

        const header = DOMCache.get('filteredPanelHeader');
        if (!header) {
          console.warn('[HeaderHeightProtector] 找不到头部元素，延迟初始化');
          setTimeout(initHeaderHeightProtector, 100);
          return;
        }

        // 强制设置头部高度的函数
        let isFixing = false; // 🔧 防止循环修复的标志
        let lastCheckTime = 0; // 🚀 性能优化：节流，避免频繁检查
        const CHECK_INTERVAL = 100; // 🚀 每100ms最多检查一次（提高响应速度）

        const enforceHeaderHeight = (force = false) => {
          // 🔧 防止递归调用
          if (isFixing) {
            return;
          }

          // 🚀 性能优化：节流，避免频繁调用（外部强制调用跳过节流）
          if (!force) {
            const now = Date.now();
            if (now - lastCheckTime < CHECK_INTERVAL) {
              return;
            }
            lastCheckTime = now;
          }

          try {
            isFixing = true;

            // 🚀 性能优化：只检查内联样式，避免调用昂贵的 getComputedStyle
            // 检查计算后的样式，而不仅仅是内联样式
            const currentMinHeight = header.style.minHeight;
            const currentHeight_inline = header.style.height;
            const currentPaddingTop = header.style.paddingTop;
            const currentPaddingRight = header.style.paddingRight;
            const currentPaddingBottom = header.style.paddingBottom;
            const currentPaddingLeft = header.style.paddingLeft;
            const currentFlexShrink = header.style.flexShrink;
            const currentDisplay = header.style.display;
            const currentPosition = header.style.position;
            const currentBoxSizing = header.style.boxSizing;

            // 检查并修复所有可能导致头部被压缩的样式
            let needsFix = false;

            // 🔧 修复：无论当前值是什么，都强制设置正确的 min-height
            // 如果内联样式不存在或值不对，都要设置
            // 🔧 修复：使用与 CSS 一致的高度 (26px = 19px 内容 + 3px 顶部padding + 4px 底部padding)
            if (currentMinHeight !== '26px') {
              header.style.setProperty('min-height', '26px', 'important');
              needsFix = true;
            }

            // 🔧 保护 height：确保是 26px，与 CSS 定义一致
            // 不再设置为 auto，因为 CSS 已经通过 !important 锁定为 26px
            if (currentHeight_inline && currentHeight_inline !== '26px') {
              header.style.setProperty('height', '26px', 'important');
              needsFix = true;
            }

            // 🔧 修复：根据面板状态使用不同的 padding
            // 最大化状态：3px 8px 4px 8px（与 CSS #filteredPanel.maximized 定义一致）
            // 普通状态：2px 6px 3px 6px（与 CSS #filteredPanelHeader 定义一致）
            const isMaximized = filteredPanel && filteredPanel.classList.contains('maximized');
            const expectedPT = isMaximized ? '3px' : '2px';
            const expectedPR = isMaximized ? '8px' : '6px';
            const expectedPB = isMaximized ? '4px' : '3px';
            const expectedPL = isMaximized ? '8px' : '6px';
            if (currentPaddingTop !== expectedPT || currentPaddingRight !== expectedPR ||
                currentPaddingBottom !== expectedPB || currentPaddingLeft !== expectedPL) {
              header.style.setProperty('padding-top', expectedPT, 'important');
              header.style.setProperty('padding-right', expectedPR, 'important');
              header.style.setProperty('padding-bottom', expectedPB, 'important');
              header.style.setProperty('padding-left', expectedPL, 'important');
              needsFix = true;
            }

            // 🔧 保护 box-sizing：确保是 border-box
            if (currentBoxSizing !== 'border-box') {
              header.style.setProperty('box-sizing', 'border-box', 'important');
              needsFix = true;
            }

            // 保护 flex-shrink
            if (currentFlexShrink !== '0') {
              header.style.setProperty('flex-shrink', '0', 'important');
              needsFix = true;
            }

            // 保护 display
            if (currentDisplay && currentDisplay !== 'flex') {
              header.style.setProperty('display', 'flex', 'important');
              needsFix = true;
            }

            // 🔧 保护 position：确保是 relative，不被设置为 absolute 或 fixed
            if (currentPosition && currentPosition !== 'relative') {
              header.style.setProperty('position', 'relative', 'important');
              needsFix = true;
            }

            // 🔧 修复完成（日志已移除）
          } finally {
            isFixing = false;
          }
        };

        // 创建 MutationObserver 监听头部样式变化
        const observer = new MutationObserver((mutations) => {
          // 🔧 只在外部代码修改样式时才修复，忽略保护器自己的修改
          if (isFixing) {
            return;
          }

          let needsFix = false;
          mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
              needsFix = true;
            }
          });

          if (needsFix) {
            // 🔧 使用 requestAnimationFrame 防抖，避免频繁触发
            requestAnimationFrame(() => {
              if (!isFixing) {
                enforceHeaderHeight();
              }
            });
          }
        });

        // 开始监听
        observer.observe(header, {
          attributes: true,
          attributeFilter: ['style']
        });

        // 🔧 定时器ID，用于按需启动/停止
        let headerCheckIntervalId = null;

        function startHeaderInterval() {
          if (headerCheckIntervalId) return;
          headerCheckIntervalId = setInterval(() => {
            enforceHeaderHeight();
          }, 200);
        }

        function stopHeaderInterval() {
          if (headerCheckIntervalId) {
            clearInterval(headerCheckIntervalId);
            headerCheckIntervalId = null;
          }
        }

        headerHeightProtector = {
          observer,
          enforce: enforceHeaderHeight,
          startInterval: startHeaderInterval,
          stopInterval: stopHeaderInterval
        };

        // 立即执行一次修复
        enforceHeaderHeight();

        // 🔧 监听 filteredPanel 的 class 变化，按需启停定时器
        const fp = DOMCache.get('filteredPanel');
        if (fp) {
          const visibilityObserver = new MutationObserver(() => {
            if (fp.classList.contains('visible')) {
              startHeaderInterval();
            } else {
              stopHeaderInterval();
            }
          });
          visibilityObserver.observe(fp, { attributes: true, attributeFilter: ['class'] });
          // 初始状态
          if (fp.classList.contains('visible')) {
            startHeaderInterval();
          }
        }
      }

      // 更新悬浮过滤内容框 - 修复：保持滚动位置，考虑二级过滤
      function updateFilteredPanel() {
        const filterText = filterBox.value.trim();

        // 如果过滤框为空，隐藏悬浮框
        if (filterText === "") {
          filteredPanel.classList.remove("visible");
          // 🔧 恢复文件树按钮显示
          if (typeof restoreFileTreePanel === 'function') {
            restoreFileTreePanel();
          }
          return;
        }

        // 🚀 智能跳转：记录当前查看位置的原始索引
        // 优先使用点击记录的行，如果没有则使用可见区域的中心行
        let rememberedOriginalIndex = -1;
        if (typeof lastClickedOriginalIndex !== 'undefined' && lastClickedOriginalIndex >= 0) {
          rememberedOriginalIndex = lastClickedOriginalIndex;
        } else if (lastClickedFilteredIndex >= 0 && filteredPanelAllOriginalIndices) {
          rememberedOriginalIndex = filteredPanelAllOriginalIndices[lastClickedFilteredIndex];
        } else if (filteredPanelAllOriginalIndices && filteredPanelAllOriginalIndices.length > 0) {
          // 尝试使用可见区域的中心行
          const filteredPanelContent = DOMCache.get('filteredPanelContent');
          if (filteredPanelContent) {
            const scrollTop = filteredPanelContent.scrollTop;
            const panelHeight = filteredPanelContent.clientHeight;
            const lineHeight = typeof filteredPanelLineHeight !== 'undefined' ? filteredPanelLineHeight : 19;
            const centerIndex = Math.floor((scrollTop / lineHeight + (scrollTop + panelHeight) / lineHeight) / 2);
            if (centerIndex >= 0 && centerIndex < filteredPanelAllOriginalIndices.length) {
              rememberedOriginalIndex = filteredPanelAllOriginalIndices[centerIndex];
            }
          }
        }
        if (rememberedOriginalIndex >= 0) {
          console.log(`[updateFilteredPanel] 📍 记忆位置: originalIndex=${rememberedOriginalIndex}`);
        }

        // 🚀 显示过滤面板前，清除可能残留的内联样式（特别是高度）
        // 这确保了最大化状态能正确应用 CSS 中的 !important 规则
        if (filteredPanel.classList.contains("maximized")) {
          filteredPanel.style.left = "";
          filteredPanel.style.top = "";
          filteredPanel.style.width = "";
          filteredPanel.style.height = "";
        }

        // 优化：直接显示过滤结果面板，不需要先隐藏再显示
        filteredPanel.classList.add("visible");

        // 🔧 显示面板时自动隐藏文件树
        const fileTreeContainer = DOMCache.get('fileTreeContainer');
        const fileTreeCollapseBtn = DOMCache.get('fileTreeCollapseBtn');
        if (fileTreeContainer && fileTreeContainer.classList.contains('visible')) {
          fileTreeContainer.classList.remove('visible');
          if (fileTreeCollapseBtn) {
            fileTreeCollapseBtn.textContent = '▶';
            fileTreeCollapseBtn.style.display = 'none'; // 🔧 隐藏折叠按钮
          }
          fileTreeWasHiddenByFilter = true;
          // 🔧 调整布局和按钮位置
          if (typeof updateLayout === 'function') {
            updateLayout();
          }
          if (typeof updateButtonPosition === 'function') {
            updateButtonPosition();
          }
          console.log('[Filter] 文件树面板已自动隐藏（updateFilteredPanel）');
        }

        // 🔧 确保头部高度保护器已初始化
        if (!headerHeightProtector) {
          initHeaderHeightProtector();
        }

        // 🔧 修复：立即同步保护头部高度，避免首帧被裁剪（force=true 跳过节流）
        if (headerHeightProtector) {
          headerHeightProtector.enforce(true);
        }

        // 🔧 修复：在下一帧再次确认，防止虚拟滚动更新覆盖
        requestAnimationFrame(() => {
          if (headerHeightProtector) {
            headerHeightProtector.enforce(true);
          }
        });

        // 根据是否有二级过滤选择显示的内容
        if (
          secondaryFilter.isActive &&
          secondaryFilter.filteredLines.length > 0
        ) {
          // 显示二级过滤结果
          console.log('Showing SECONDARY filter results');
          filteredPanelAllLines = secondaryFilter.filteredLines;
          filteredPanelAllOriginalIndices =
            secondaryFilter.filteredToOriginalIndex;
          filteredPanelAllPrimaryIndices =
            secondaryFilter.filteredToPrimaryIndex;
        } else {
          // 显示一级过滤结果
          console.log('Showing PRIMARY filter results');
          filteredPanelAllLines = currentFilter.filteredLines;
          filteredPanelAllOriginalIndices = currentFilter.filteredToOriginalIndex;
          filteredPanelAllPrimaryIndices = []; // 一级过滤时没有primary索引
        }

        // 更新计数
        filteredCount.textContent = filteredPanelAllLines.length;
        console.log('Total lines to display:', filteredPanelAllLines.length);

        // 🚀 禁用预缓存，改用懒加载避免内存溢出
        // buildFilteredPanelHtmlCache();

        // 🚀 性能优化2：预计算文件头索引集合，避免每行都执行 startsWith 检查
        fileHeaderIndices.clear();
        for (let i = 0; i < filteredPanelAllLines.length; i++) {
          if (filteredPanelAllLines[i] && filteredPanelAllLines[i].startsWith("=== 文件:")) {
            fileHeaderIndices.add(i);
          }
        }
        console.log(`[性能优化] 预计算了 ${fileHeaderIndices.size} 个文件头索引`);

        // 🚀 性能优化：过滤结果变化时失效缓存
        invalidateFilteredLineCache();

        // 重置虚拟滚动状态
        filteredPanelVisibleStart = -1;
        filteredPanelVisibleEnd = -1;

        // 设置占位元素高度 - 修复：正确计算总高度
        const totalHeight =
          filteredPanelAllLines.length * filteredPanelLineHeight;
        filteredPanelPlaceholder.style.height = totalHeight + "px";

        // 清空虚拟内容
        filteredPanelVirtualContent.innerHTML = "";

        // ⚠️ 注意：智能跳转逻辑已移至 finishFiltering() 中处理
        // 这里的 rememberedOriginalIndex 仅作保留，不在此处执行跳转
        // 因为 finishFiltering() 会在更新数据后进行正确的跳转

        // 重置过滤结果框搜索
        filteredPanelResetSearch();

        // 🚀 性能优化：使用 requestAnimationFrame 替代嵌套 setTimeout
        // 之前是两层 setTimeout（0 + 100ms），造成至少 100ms 延迟
        requestAnimationFrame(() => {
          if (typeof updateFilteredPanelVisibleLines === 'function') {
            updateFilteredPanelVisibleLines();
          }
          // 恢复高亮 - 同帧内执行，无需额外延迟
          restoreHighlight();
        });
      }

      // ============ 服务器连接相关函数 ============
      
      // 初始化服务器连接
      function initServerConnection() {
        const serverAddressInput = document.getElementById("serverAddress");
        const serverPathInput = document.getElementById("serverPath");
        const serverStatus = document.getElementById("serverStatus");
        const dropdownBtn = document.getElementById("serverAddressDropdownBtn");
        const dropdownMenu = document.getElementById("serverAddressDropdownMenu");

        console.log('[Server Connection] 初始化服务器连接');
        console.log('[Server Connection] dropdownBtn:', dropdownBtn);
        console.log('[Server Connection] dropdownMenu:', dropdownMenu);
        // 需求：文件树加载目录树不允许"输入/按 Enter 加载"
        // - 输入框只读（允许复制），仅允许点击按钮触发加载
        if (serverPathInput) {
          // Enter 键触发加载
          serverPathInput.addEventListener("keydown", function(e) {
            if (e.key === "Enter") {
              e.preventDefault();

              const inputTerm = serverPathInput.value.trim();
              console.log(`[serverPath] Enter键, term="${inputTerm}"`);

              // 🔧 判断是否是 WTGLMK 开头的搜索
              const isWTGLMKSearch = inputTerm.toUpperCase().startsWith('WTGLMK');

              if (isWTGLMKSearch) {
                // WTGLMK 开头：自动补全路径
                // 🔧 动态获取当前年月
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const yearMonth = `${year}-${month}`;
                const fullPath = `/prodlog_dump/prodlog/saved/question_parse/${yearMonth}/${inputTerm}`;
                serverPathInput.value = fullPath;
                console.log(`[serverPath] 自动补全: ${fullPath}`);
              }

              // 加载目录树
              loadServerTree();
            }
          });
        }
        
        if (serverAddressInput) {
          // 服务器地址改变时检查连接
          serverAddressInput.addEventListener("change", function() {
            checkServerConnection();
          });
          
          // 初始检查连接
          checkServerConnection();
          
          // 定时检查连接状态（每30秒检查一次）
          setInterval(checkServerConnection, 30000);
        }

        // 服务器地址下拉菜单：点击按钮展开/收起；选择后写入 input 并触发 change
        function closeServerAddressDropdown() {
          if (!dropdownMenu) return;
          console.log('[Server Dropdown] 关闭菜单');
          dropdownMenu.classList.remove("visible");
        }
        function openServerAddressDropdown() {
          if (!dropdownMenu) return;
          console.log('[Server Dropdown] 打开菜单');
          // 高亮当前值
          try {
            const current = (serverAddressInput?.value ?? "").trim();
            dropdownMenu.querySelectorAll(".server-address-option").forEach((btn) => {
              const v = btn.getAttribute("data-value") || "";
              btn.classList.toggle("active", v === current);
            });
          } catch (_) {}
          dropdownMenu.classList.add("visible");
          console.log('[Server Dropdown] 菜单 classes:', dropdownMenu.className);
          console.log('[Server Dropdown] 菜单 display:', window.getComputedStyle(dropdownMenu).display);
        }
        function toggleServerAddressDropdown() {
          if (!dropdownMenu) return;
          console.log('[Server Dropdown] 切换菜单，当前 visible:', dropdownMenu.classList.contains("visible"));
          if (dropdownMenu.classList.contains("visible")) closeServerAddressDropdown();
          else openServerAddressDropdown();
        }

        if (dropdownBtn && dropdownMenu) {
          dropdownBtn.addEventListener("click", (e) => {
            console.log('[Server Dropdown] 按钮被点击');
            e.preventDefault();
            e.stopPropagation();
            toggleServerAddressDropdown();
          });

          dropdownMenu.addEventListener("click", (e) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            const btn = target.closest(".server-address-option");
            if (!(btn instanceof HTMLButtonElement)) return;
            const val = btn.getAttribute("data-value");
            if (!val || !serverAddressInput) return;
            serverAddressInput.value = val;
            closeServerAddressDropdown();
            // 选择不同网址后清空目录路径框
            const serverPathInput = document.getElementById("serverPath");
            if (serverPathInput) {
              serverPathInput.value = "";
            }
            // 选择 IP 后自动加载当前目录
            loadServerTree();
          });

          // 点击其它区域关闭
          document.addEventListener("click", () => closeServerAddressDropdown());
          // Esc 关闭
          document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeServerAddressDropdown();
          });
        }

        // 📅 月份选择功能
        const monthSelectBtn = document.getElementById("monthSelectBtn");
        const monthSelectMenu = document.getElementById("monthSelectMenu");

        if (monthSelectBtn && monthSelectMenu) {
          // 生成当前年份的12个月选项
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = now.getMonth() + 1;

          monthSelectMenu.innerHTML = '';
          for (let m = 1; m <= 12; m++) {
            const monthStr = String(m).padStart(2, '0');
            const btn = document.createElement('button');
            btn.className = 'month-option';
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            btn.setAttribute('data-month', `${currentYear}-${monthStr}`);
            btn.textContent = `${currentYear}-${monthStr}`;

            // 标记当前月份
            if (m === currentMonth) {
              btn.classList.add('current');
            }

            monthSelectMenu.appendChild(btn);
          }

          // 切换月份菜单显示/隐藏
          function closeMonthSelectMenu() {
            monthSelectMenu.classList.remove("visible");
          }
          function openMonthSelectMenu() {
            // 高亮当前选中的月份
            const currentPath = serverPathInput?.value || "";
            let selectedMonth = "";
            const match = currentPath.match(/\/prodlog_dump\/prodlog\/saved\/question_parse\/(\d{4}-\d{2})\//);
            if (match) {
              selectedMonth = match[1];
            }

            monthSelectMenu.querySelectorAll(".month-option").forEach((btn) => {
              const m = btn.getAttribute("data-month") || "";
              btn.classList.toggle("current", m === selectedMonth || (!selectedMonth && m === `${currentYear}-${String(currentMonth).padStart(2, '0')}`));
            });

            monthSelectMenu.classList.add("visible");
          }
          function toggleMonthSelectMenu() {
            if (monthSelectMenu.classList.contains("visible")) closeMonthSelectMenu();
            else openMonthSelectMenu();
          }

          // 按钮点击事件
          monthSelectBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleMonthSelectMenu();
          });

          // 月份选择事件
          monthSelectMenu.addEventListener("click", (e) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            const btn = target.closest(".month-option");
            if (!(btn instanceof HTMLButtonElement)) return;

            const selectedMonth = btn.getAttribute("data-month");
            if (!selectedMonth) return;

            // 获取当前输入框的值
            const currentPath = serverPathInput?.value || "";
            let basePath = "";

            // 检查是否是 WTGLMK 开头的输入
            const isWTGLMKSearch = currentPath.toUpperCase().startsWith('WTGLMK') ||
                                   (!currentPath.includes('/') && currentPath.trim().length > 0);

            if (isWTGLMKSearch) {
              // WTGLMK 开头或纯文本：构造完整路径
              const term = currentPath.trim();
              basePath = `/prodlog_dump/prodlog/saved/question_parse/${selectedMonth}/${term}`;
              if (serverPathInput) {
                serverPathInput.value = basePath;
              }
              console.log(`[月份选择] WTGLMK路径: ${basePath}`);
              // 自动加载
              loadServerTree();
            } else if (currentPath.includes('/prodlog_dump/prodlog/saved/question_parse/')) {
              // 已有完整路径：替换月份部分
              const newPath = currentPath.replace(
                /\/prodlog_dump\/prodlog\/saved\/question_parse\/\d{4}-\d{2}\//,
                `/prodlog_dump/prodlog/saved/question_parse/${selectedMonth}/`
              );
              if (serverPathInput) {
                serverPathInput.value = newPath;
              }
              console.log(`[月份选择] 更新路径: ${newPath}`);
              // 自动加载
              loadServerTree();
            } else {
              // 其他情况：显示提示
              showMessage(`已选择 ${selectedMonth}，请输入目录名`);
              console.log(`[月份选择] 已选择月份: ${selectedMonth}`);
            }

            closeMonthSelectMenu();
          });

          // 点击其它区域关闭
          document.addEventListener("click", () => closeMonthSelectMenu());
          // Esc 关闭
          document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeMonthSelectMenu();
          });
        }
      }
      
      // 检查服务器连接状态
      async function checkServerConnection() {
        const serverAddressInput = document.getElementById("serverAddress");
        const serverStatus = document.getElementById("serverStatus");

        if (!serverAddressInput || !serverStatus) return;

        const address = serverAddressInput.value.trim();
        if (!address) {
          serverStatus.className = "disconnected";
          serverStatus.title = "请输入服务器地址";
          return;
        }

        serverStatus.className = "connecting";
        serverStatus.title = "正在连接...";

        try {
          // 直接使用 http:// 协议，不依赖当前页面协议
          const protocol = "http://";
          serverBaseUrl = protocol + address;

          const response = await fetch(serverBaseUrl + "/health", {
            method: "GET",
            cache: "no-cache",
            // 移除 mode: "cors"，在Electron环境中不需要
          });

          if (response.ok) {
            serverStatus.className = "connected";
            serverStatus.title = "已连接到服务器";
            isServerMode = true;
          } else {
            throw new Error("服务器响应异常: " + response.status);
          }
        } catch (error) {
          serverStatus.className = "disconnected";
          serverStatus.title = "连接失败: " + error.message;
          isServerMode = false;
        }
      }
      
      // 从服务器加载目录树
      async function loadServerTree() {
        const serverAddressInput = document.getElementById("serverAddress");
        const serverPathInput = document.getElementById("serverPath");

        if (!serverAddressInput || !serverPathInput) return;

        const address = serverAddressInput.value.trim();
        // 注意：路径末尾空格在 Linux 下是合法字符，不能 trim 掉；只去掉换行用于容错
        const pathRaw = (serverPathInput.value ?? "").replace(/\r?\n/g, "");
        const path = pathRaw;

        if (!address) {
          showMessage("请输入服务器地址");
          return;
        }

        // 显示加载状态
        showLoading(true, "正在加载目录树...");

        try {
          // 直接使用 http:// 协议
          const protocol = "http://";
          serverBaseUrl = protocol + address;
          serverCurrentPath = path;

          // 按需加载：只取当前层（不递归），展开文件夹时再按需请求子层
          const url =
            serverBaseUrl +
            "/api/tree?depth=1&path=" +
            encodeURIComponent(path);
          const response = await fetch(url, {
            method: "GET",
            cache: "no-cache",
            // 移除 mode: "cors"，在Electron环境中不需要
          });

          if (!response.ok) {
            throw new Error("服务器返回错误: " + response.status);
          }

          const data = await response.json();

          if (data.error) {
            throw new Error(data.message || "服务器返回错误");
          }

          // 更新服务器状态
          const serverStatus = document.getElementById("serverStatus");
          if (serverStatus) {
            serverStatus.className = "connected";
            serverStatus.title = "已连接到服务器";
          }
          isServerMode = true;

          // 🚀 清空现有文件树，但保留本地盘符节点
          fileTreeData = [];
          // 🚀 深度克隆盘符节点并重置状态（避免状态不一致）
          fileTreeHierarchy = persistentDriveNodes.map(node => ({
            ...node,
            expanded: false,       // 重置为折叠状态
            childrenLoaded: false // 重置为未加载状态
          }));
          selectedFiles = [];
          visibleFileTreeItems = [];

          console.log(`[loadServerTree] 清空文件树，重置 ${persistentDriveNodes.length} 个盘符节点状态`);

          // 解析服务器返回的目录树（按需加载：仅当前层）
          // 注意：层级折叠逻辑依赖“祖先路径前缀”存在于 fileTreeHierarchy，因此这里使用相对 treePath 作为层级 path。
          parseServerTree(data.tree, "", serverCurrentPath, fileTreeHierarchy);
          
          // 渲染文件树
          renderFileTree();
          
          // 显示文件树
          if (!fileTreeContainer.classList.contains("visible")) {
            fileTreeContainer.classList.add("visible");
            updateLayout();
            updateButtonPosition();
          }
          

          
        } catch (error) {
          console.error("加载目录树失败:", error);
          showMessage("加载目录树失败: " + error.message);
          
          const serverStatus = document.getElementById("serverStatus");
          if (serverStatus) {
            serverStatus.className = "disconnected";
            serverStatus.title = "连接失败: " + error.message;
          }
        } finally {
          showLoading(false);
        }
      }
      
      // 解析服务器返回的目录树
      // - parentTreePath: 用于文件树层级/折叠的相对路径前缀（不是远端真实路径）
      // - baseRemotePath: 用于拼出远端真实路径（服务端若返回 item.path 则优先使用）
      // - target: 输出数组（支持按需加载时插入）
      function parseServerTree(tree, parentTreePath, baseRemotePath, target) {
        if (!Array.isArray(tree)) return;

        const out = Array.isArray(target) ? target : fileTreeHierarchy;
        const base = baseRemotePath ?? serverCurrentPath;
        tree.forEach((item) => {
          const treePath = parentTreePath ? parentTreePath + "/" + item.name : item.name;
          const remotePath =
            item.path ||
            (base ? (base.replace(/\/+$/g, "") + "/" + item.name) : treePath);

          const node = {
            name: item.name,
            // 用于文件树层级/折叠的相对路径（避免绝对路径导致 level 过大、祖先查找失败）
            path: treePath,
            // 用于请求 /api/file 的真实路径（服务端返回的 path 优先）
            remotePath,
            type: item.type,
            expanded: false,
            level: treePath.split("/").length - 1,
            file: null,
            isRemote: true,  // 标记为远程文件
            size: item.size || 0,
            // 压缩包特殊处理
            isArchive: item.type === "archive",
            archiveName: item.type === "archive" ? remotePath : null,
            // 🔧 按需加载：只有当服务器明确返回 lazy=false 且有 children 时，才认为子项已加载
            // 默认情况下（lazy=true 或未指定），认为子项未加载，需要按需加载
            childrenLoaded: (item.type === "folder" || item.type === "archive") &&
                             (item.lazy === false && Array.isArray(item.children) && item.children.length > 0),
            loadingChildren: false,
          };

          out.push(node);

          // 递归处理子目录（仅当服务端真的返回 children 且非 lazy）
          if (item.type === "folder" && Array.isArray(item.children) && !item.lazy) {
            parseServerTree(item.children, treePath, base, out);
          }
        });
      }

      // 计算某个文件夹节点的“子树结束位置”，用于插入按需加载的子节点
      function getFolderSubtreeEndIndex(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder) return folderIndex + 1;
        const baseLevel = folder.level ?? 0;
        let i = folderIndex + 1;
        while (i < fileTreeHierarchy.length) {
          const it = fileTreeHierarchy[i];
          const lv = it?.level ?? 0;
          if (lv <= baseLevel) break;
          i++;
        }
        return i;
      }

      function shiftSelectedIndices(fromIndex, delta) {
        if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) return;
        selectedFiles = selectedFiles.map((i) => (i >= fromIndex ? i + delta : i));
      }

      // 按需加载：展开远程文件夹时加载其直接子项
      async function loadRemoteFolderChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder || folder.type !== "folder" || !folder.isRemote) return;

        // 🚀 判断是否需要从远程服务器加载
        // 条件：是子文件夹（没有实际数据）或从未加载过
        const needsRemoteFetch = !folder.children ||
                                  (folder.children.directories?.length === 0 &&
                                   folder.children.files?.length === 0 &&
                                   !folder.childrenLoaded);

        if (folder.remoteId && needsRemoteFetch) {
          // 需要从远程服务器加载子项
          console.log(`[loadRemoteFolderChildren] 从远程服务器加载: ${folder.path}`);
          await loadDirectRemoteSubfolderChildren(folderIndex);
          return;
        }

        // 🚀 如果是顶层远程节点且有本地缓存数据，使用缓存
        if (folder.remoteId && folder.children &&
            (folder.children.directories?.length > 0 || folder.children.files?.length > 0)) {
          console.log(`[loadRemoteFolderChildren] 使用本地缓存的 children`);
          await loadDirectRemoteChildren(folderIndex);
          return;
        }

        // 🚀 原来的服务器远程连接逻辑
        if (!serverBaseUrl) {
          showMessage("未连接到服务器");
          return;
        }

        // 检查子项是否已在树中
        const hasChildrenInTree = folderIndex + 1 < fileTreeHierarchy.length &&
                                  fileTreeHierarchy[folderIndex + 1].level > folder.level;

        // 如果子项已经在树中，不需要重复加载
        if (folder.childrenLoaded && hasChildrenInTree) {
          console.log(`[loadRemoteFolderChildren] 子项已加载且在树中，跳过`);
          return;
        }

        folder.loadingChildren = true;
        renderFileTree();

        try {
          const reqPath = folder.remotePath || folder.path;
          const url =
            serverBaseUrl + "/api/tree?depth=1&path=" + encodeURIComponent(reqPath);
          const resp = await fetch(url, { method: "GET", cache: "no-cache" });
          if (!resp.ok) throw new Error("服务器返回错误: " + resp.status);
          const data = await resp.json();
          if (data && data.error) throw new Error(data.message || "服务器返回错误");

          const newNodes = [];
          // 这里 parentTreePath 用 folder.path，保证层级关系正确
          parseServerTree(data.tree, folder.path, folder.remotePath, newNodes);

          const insertAt = getFolderSubtreeEndIndex(folderIndex);
          if (newNodes.length > 0) {
            fileTreeHierarchy.splice(insertAt, 0, ...newNodes);
            shiftSelectedIndices(insertAt, newNodes.length);
          }
          folder.childrenLoaded = true;
        } finally {
          folder.loadingChildren = false;
        }
      }

      // 🚀 加载直接远程连接的子项（我们的远程目录功能）
      async function loadDirectRemoteChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        console.log(`[loadDirectRemoteChildren] 开始: folderIndex=${folderIndex}, folder.name=${folder?.name}, remoteId=${folder?.remoteId}, hasChildren=${!!folder?.children}`);

        if (!folder || !folder.remoteId || !folder.children) {
          console.log(`[loadDirectRemoteChildren] 提前返回: folder=${!!folder}, remoteId=${!!folder?.remoteId}, children=${!!folder?.children}`);
          return;
        }

        folder.loadingChildren = true;

        try {
          const newNodes = [];
          const dirs = folder.children.directories || [];
          const files = folder.children.files || [];

          console.log(`[loadDirectRemoteChildren] 目录数=${dirs.length}, 文件数=${files.length}`);

          // 添加子文件夹
          for (const dir of dirs) {
            const childNode = {
              name: dir.name,
              path: dir.path,
              type: 'folder',
              expanded: false,
              level: folder.level + 1,
              file: null,
              childrenLoaded: false,
              loadingChildren: false,
              isLocalDrive: false,
              isRemote: true,
              remoteId: folder.remoteId,
              remotePath: dir.path,
              children: null, // 子文件夹不缓存 children，需要懒加载
              size: 0
            };
            newNodes.push(childNode);
          }

          // 添加子文件
          for (const file of files) {
            // 检查是否是压缩包
            const fileName = file.name.toLowerCase();
            const isArchive = fileName.endsWith('.zip') ||
                             fileName.endsWith('.rar') ||
                             fileName.endsWith('.7z') ||
                             fileName.endsWith('.tar') ||
                             fileName.endsWith('.gz') ||
                             fileName.endsWith('.bz2') ||
                             fileName.endsWith('.xz') ||
                             fileName.endsWith('.tar.gz') ||
                             fileName.endsWith('.tar.bz2') ||
                             fileName.endsWith('.tar.xz');

            const childNode = {
              name: file.name,
              path: file.path,
              type: isArchive ? 'archive' : 'file',
              isArchive: isArchive, // 🚀 添加 isArchive 属性
              expanded: false,
              level: folder.level + 1,
              file: null,
              childrenLoaded: false, // 压缩包需要懒加载
              loadingChildren: false,
              isLocalDrive: false,
              isRemote: true,
              remoteId: folder.remoteId,
              remotePath: file.path,
              children: null,
              size: file.size || 0
            };
            newNodes.push(childNode);
          }

          // 按名称排序
          newNodes.sort((a, b) => a.name.localeCompare(b.name));

          // 插入到文件树
          const insertAt = getFolderSubtreeEndIndex(folderIndex);
          console.log(`[loadDirectRemoteChildren] 插入位置: ${insertAt}, 新节点数: ${newNodes.length}`);

          if (newNodes.length > 0) {
            fileTreeHierarchy.splice(insertAt, 0, ...newNodes);
            shiftSelectedIndices(insertAt, newNodes.length);
          }

          folder.childrenLoaded = true;
          console.log(`[loadDirectRemoteChildren] 已加载 ${newNodes.length} 个子项`);
        } catch (error) {
          console.error('[loadDirectRemoteChildren] 加载子项失败:', error);
          showMessage('加载远程目录失败: ' + error.message);
        } finally {
          folder.loadingChildren = false;
          // 不在这里渲染，让调用方决定何时渲染
        }
      }

      // 🚀 从远程服务器加载直接远程连接的子文件夹的子项
      async function loadDirectRemoteSubfolderChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        console.log(`[loadDirectRemoteSubfolderChildren] 开始: folder.name=${folder?.name}, folder.path=${folder?.path}, folder.remotePath=${folder?.remotePath}`);

        if (!folder || !folder.remoteId) {
          console.log(`[loadDirectRemoteSubfolderChildren] 提前返回: folder=${!!folder}, remoteId=${!!folder?.remoteId}`);
          return;
        }

        // 获取远程连接信息
        const conn = remoteConnections.find(c => c.id === folder.remoteId);
        if (!conn) {
          console.error('[loadDirectRemoteSubfolderChildren] 未找到远程连接');
          return;
        }

        console.log(`[loadDirectRemoteSubfolderChildren] 远程连接: ${conn.ip}:${conn.port}, 请求路径: ${folder.remotePath || folder.path}`);

        folder.loadingChildren = true;
        renderFileTree();

        try {
          // 从远程服务器加载子项
          const result = await window.electronAPI.connectRemote({
            ip: conn.ip,
            port: conn.port,
            remotePath: folder.remotePath || folder.path
          });

          console.log(`[loadDirectRemoteSubfolderChildren] 服务器返回: success=${result.success}, directories=${result.directories?.length || 0}, files=${result.files?.length || 0}`);

          if (result.success) {
            // 保存 children 到文件夹
            folder.children = {
              directories: result.directories || [],
              files: result.files || []
            };

            console.log(`[loadDirectRemoteSubfolderChildren] 已保存 children，现在调用 loadDirectRemoteChildren`);

            // 加载子项到树中
            await loadDirectRemoteChildren(folderIndex);

            // 渲染更新后的文件树
            rebuildFileTreeVisibleCache();
            renderFileTreeViewport(true);
          } else {
            throw new Error(result.error || '加载失败');
          }
        } catch (error) {
          console.error('[loadDirectRemoteSubfolderChildren] 加载子项失败:', error);
          folder.loadingChildren = false;
          showMessage('加载远程目录失败: ' + error.message);
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);
        }
      }

      // 🚀 加载新远程目录功能中的压缩包内容
      async function loadDirectRemoteArchiveChildren(archiveIndex) {
        const archive = fileTreeHierarchy[archiveIndex];
        console.log(`[loadDirectRemoteArchiveChildren] 开始: archive.name=${archive?.name}, archive.path=${archive?.path}`);

        if (!archive || !archive.remoteId) {
          console.log(`[loadDirectRemoteArchiveChildren] 提前返回: archive=${!!archive}, remoteId=${!!archive?.remoteId}`);
          return;
        }

        // 获取远程连接信息
        const conn = remoteConnections.find(c => c.id === archive.remoteId);
        if (!conn) {
          console.error('[loadDirectRemoteArchiveChildren] 未找到远程连接');
          return;
        }

        console.log(`[loadDirectRemoteArchiveChildren] 远程连接: ${conn.ip}:${conn.port}`);

        archive.loadingChildren = true;
        renderFileTree();

        try {
          // 使用新的 IPC 接口列出远程压缩包内容
          const result = await window.electronAPI.listRemoteArchive({
            ip: conn.ip,
            port: conn.port,
            filePath: archive.remotePath || archive.path
          });

          console.log(`[loadDirectRemoteArchiveChildren] IPC返回: success=${result.success}, error=${result.error}, items=${result.items?.length || 0}`);

          if (!result.success) {
            throw new Error(result.error || '读取压缩包失败');
          }

          const items = result.items || [];
          console.log(`[loadDirectRemoteArchiveChildren] 已读取压缩包内容，项目数: ${items.length}`);

          // 构建树形结构
          const newNodes = [];
          const topLevelFolders = new Map(); // name -> path
          const topLevelFiles = [];

          // 🔧 修复：重新判断哪些是目录，哪些是文件
          // 方法：如果路径A是路径B的前缀（且B以/开头），则A是目录
          const directoryPaths = new Set();
          const filePaths = new Set();

          for (const item of items) {
            const relativePath = item.path.replace(/\\/g, '/');
            filePaths.add(relativePath);
          }

          // 找出所有目录：一个路径是另一个路径的前缀
          for (const path1 of filePaths) {
            for (const path2 of filePaths) {
              if (path1 !== path2 && path2.startsWith(path1 + '/')) {
                // path1 是 path2 的父目录
                directoryPaths.add(path1);
                break;
              }
            }
          }

          // 调试：打印目录判断结果
          console.log(`[loadDirectRemoteArchiveChildren] 重新判断目录（前10个）:`);
          let debugCount = 0;
          for (const path of Array.from(filePaths).sort()) {
            if (debugCount >= 10) break;
            const isDir = directoryPaths.has(path);
            console.log(`  "${path}": isDirectory=${isDir} (原始: ${items.find(i => i.path.replace(/\\/g, '/') === path)?.isDirectory})`);
            debugCount++;
          }

          // 遍历压缩包内容
          for (const item of items) {
            // 统一路径分隔符为 /（处理 Windows 的 \ 分隔符）
            const originalPath = item.path;
            const relativePath = item.path.replace(/\\/g, '/');
            const isDirectory = directoryPaths.has(relativePath); // 使用重新判断的结果

            if (isDirectory) {
              // 目录
              const firstSlashIdx = relativePath.indexOf('/');
              if (firstSlashIdx === -1) {
                // 顶层目录
                topLevelFolders.set(relativePath, relativePath);
              } else {
                // 子目录，提取顶层目录名
                const topLevelName = relativePath.substring(0, firstSlashIdx + 1);
                if (!topLevelFolders.has(topLevelName)) {
                  topLevelFolders.set(topLevelName, topLevelName);
                }
              }
            } else {
              // 文件
              const firstSlashIdx = relativePath.indexOf('/');
              if (firstSlashIdx === -1) {
                // 顶层文件（没有目录层级）
                topLevelFiles.push({
                  name: relativePath,
                  path: relativePath,
                  size: item.size || 0
                });
              } else {
                // 嵌套文件，提取顶层目录名
                const topLevelName = relativePath.substring(0, firstSlashIdx + 1);
                if (!topLevelFolders.has(topLevelName)) {
                  topLevelFolders.set(topLevelName, topLevelName);
                }
              }
            }
          }

          console.log(`[loadDirectRemoteArchiveChildren] 顶层目录: ${topLevelFolders.size}, 顶层文件: ${topLevelFiles.length}`);

          // 添加顶层文件夹
          for (const [name, path] of topLevelFolders) {
            const folderName = name.replace(/\/$/, ''); // 移除尾部斜杠
            const node = {
              name: folderName,
              path: `${archive.path}/${name}`,
              type: 'folder',
              expanded: false,
              level: archive.level + 1,
              file: null,
              childrenLoaded: false,
              loadingChildren: false,
              isLocalDrive: false,
              isRemote: true,
              isArchiveChild: true,
              remoteId: archive.remoteId,
              archiveName: archive.name,
              pathInArchive: path,
              size: 0
            };
            newNodes.push(node);
          }

          // 添加顶层文件
          for (const file of topLevelFiles) {
            const node = {
              name: file.name,
              path: `${archive.path}/${file.name}`,
              type: 'file',
              expanded: false,
              level: archive.level + 1,
              file: null,
              childrenLoaded: true,
              loadingChildren: false,
              isLocalDrive: false,
              isRemote: true,
              isArchiveChild: true,
              remoteId: archive.remoteId,
              archiveName: archive.name,
              pathInArchive: file.name,
              size: file.size
            };
            newNodes.push(node);
          }

          // 按名称排序
          newNodes.sort((a, b) => a.name.localeCompare(b.name));

          // 插入到文件树
          const insertAt = getFolderSubtreeEndIndex(archiveIndex);
          console.log(`[loadDirectRemoteArchiveChildren] 插入位置: ${insertAt}, 新节点数: ${newNodes.length}`);

          if (newNodes.length > 0) {
            fileTreeHierarchy.splice(insertAt, 0, ...newNodes);
            shiftSelectedIndices(insertAt, newNodes.length);
          }

          archive.childrenLoaded = true;
          archive.loadingChildren = false;
          console.log(`[loadDirectRemoteArchiveChildren] 已加载 ${newNodes.length} 个子项`);

          // 渲染更新后的文件树
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);
        } catch (error) {
          console.error('[loadDirectRemoteArchiveChildren] 加载失败:', error);
          archive.loadingChildren = false;

          // 显示更友好的错误信息
          let errorMsg = error.message;
          if (error.message.includes('Command failed')) {
            errorMsg = '压缩包文件损坏或传输失败。请确保：\n1. 服务器端应用已重启\n2. 压缩包文件完整\n3. 网络连接稳定';
          }
          showMessage('加载远程压缩包失败: ' + errorMsg);

          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);
        }
      }

      // 按需加载：展开远程压缩包或拖拽压缩包时加载其内容
      async function loadRemoteArchiveChildren(archiveIndex) {
        const archive = fileTreeHierarchy[archiveIndex];
        console.log("[DEBUG] loadRemoteArchiveChildren called, archive:", archive);

        // 🔧 判断是否为拖拽压缩包（已在 archiveData 中）
        const isInArchiveData = archive.archiveName && archiveData.has(archive.archiveName);
        const isDraggedArchive = isInArchiveData && !archive.isRemote;

        // 🚀 判断是否为新的远程目录功能中的压缩包
        const isDirectRemoteArchive = archive.remoteId && archive.isRemote && archive.type === 'archive';

        if (!archive || archive.type !== "archive") {
          console.log("[DEBUG] Early return: not an archive");
          return;
        }

        // 🔧 只处理远程压缩包或拖拽压缩包
        if (!archive.isRemote && !isDraggedArchive) {
          console.log("[DEBUG] Early return: not remote or dragged archive, isRemote=", archive?.isRemote, "isInArchiveData=", isInArchiveData);
          return;
        }

        if (archive.childrenLoaded) {
          console.log("[DEBUG] Children already loaded");
          return;
        }

        // 🚀 处理新的远程目录功能中的压缩包
        if (isDirectRemoteArchive) {
          console.log("[DEBUG] Loading direct remote archive:", archive.name);
          await loadDirectRemoteArchiveChildren(archiveIndex);
          return;
        }

        // 🔧 拖拽压缩包不需要服务器连接
        if (!isDraggedArchive && !serverBaseUrl) {
          showMessage("未连接到服务器");
          return;
        }

        archive.loadingChildren = true;
        renderFileTreeViewport(true);

        try {
          let tree;
          let archivePath; // 🔧 定义在外部，两种路径都需要
          if (isDraggedArchive) {
            // 🔧 拖拽压缩包：从 archiveData 读取
            console.log("[DEBUG] Loading dragged archive from archiveData:", archive.archiveName);
            const archiveInfo = archiveData.get(archive.archiveName);
            const zip = archiveInfo.zip;
            archivePath = archive.archiveName; // 🔧 使用压缩包名称作为路径

            // 🔧 直接从 JSZip 对象构建扁平数组（模拟服务器格式）
            tree = [];
            zip.forEach((relativePath, zipEntry) => {
              tree.push({
                path: relativePath,
                isDirectory: zipEntry.dir,
                size: zipEntry._data && zipEntry._data.uncompressedSize
              });
            });

            console.log("[DEBUG] Built flat array from JSZip:", tree.length + " items");
          } else {
            // 远程压缩包：从服务器加载
            archivePath = archive.remotePath || archive.path;
            console.log("[DEBUG] Loading archive tree from:", archivePath);
            tree = await loadServerArchiveTree(archivePath);
            console.log("[DEBUG] Got archive tree:", tree ? tree.length + " items" : "null");
          }

          if (!tree || tree.length === 0) {
            throw new Error("读取压缩包失败或压缩包为空");
          }

          console.log("[DEBUG] Starting to process tree items...");

          // 构建树形结构：将扁平的文件列表转换为层级结构
          const newNodes = [];
          const topLevelFiles = [];      // 存储顶层文件 [name, item]
          const topLevelFolders = [];    // 存储顶层文件夹 [name, pathInArchive]

          // 首先提取顶层项（直接位于根目录下的文件和文件夹）
          try {
            tree.forEach((item) => {
              try {
                const fullPath = item.path;
                // 跳过空路径和特殊路径
                if (!fullPath || fullPath.length === 0 || fullPath === './') {
                  console.warn("[DEBUG] Skipping invalid path:", fullPath);
                  return;
                }
                // 提取顶层路径段（第一个 / 之前的部分）
                const firstSlashIdx = fullPath.indexOf('/');
                if (firstSlashIdx === -1) {
                  // 根目录下的文件，直接添加
                  topLevelFiles.push([fullPath, item]);
                } else {
                  // 提取顶层目录名
                  const topLevelName = fullPath.substring(0, firstSlashIdx + 1); // 包含 /
                  const pathInArchive = topLevelName; // 压缩包内的完整路径
                  // 检查是否已存在（避免重复）
                  if (!topLevelFolders.some(f => f[0] === topLevelName)) {
                    topLevelFolders.push([topLevelName, pathInArchive]);
                  }
                }
              } catch (e) {
                console.error("[DEBUG] Error processing tree item:", item, e);
              }
            });
          } catch (e) {
            console.error("[DEBUG] Error in tree forEach:", e);
          }

          console.log("[DEBUG] Processed tree items: folders=" + topLevelFolders.length + ", files=" + topLevelFiles.length);

          // 先添加文件夹，再添加文件（按自然排序）
          try {
            topLevelFolders.sort((a, b) => naturalCompare(a[0], b[0]));
            for (const [name, pathInArchive] of topLevelFolders) {
              const treePath = archive.path + "/" + name;
              // 🔧 _fullArchivePath 不包含尾部斜杠，用于 JSZip 查找
              const fullArchivePath = pathInArchive.replace(/\/$/, '');
              const node = {
                name: name,
                path: treePath,
                type: 'folder',
                expanded: false,
                level: archive.level + 1,
                file: null,
                // 🔧 拖拽压缩包的子项不应该是远程的
                isRemote: !isDraggedArchive,
                isLocalDrive: isDraggedArchive, // 🔧 标记为本地（拖拽）
                size: 0,
                isArchiveChild: true,
                archiveName: archivePath,
                archivePath: pathInArchive, // 压缩包内的完整路径（含尾部斜杠）
                _fullArchivePath: fullArchivePath, // 🔧 JSZip 查找路径（不含尾部斜杠）
                childrenLoaded: false, // 文件夹标记为未加载，支持按需展开
                loadingChildren: false,
              };
              newNodes.push(node);
            }

            topLevelFiles.sort((a, b) => naturalCompare(a[0], b[0]));
            for (const [name, item] of topLevelFiles) {
              const treePath = archive.path + "/" + name;

              // 🚀 检测是否是嵌套的压缩包
              const lowerName = name.toLowerCase();
              const isNestedArchive = lowerName.endsWith('.zip') ||
                                      lowerName.endsWith('.7z') ||
                                      lowerName.endsWith('.rar') ||
                                      lowerName.endsWith('.tar') ||
                                      lowerName.endsWith('.gz');

              const node = {
                name: name,
                path: treePath,
                type: isNestedArchive ? 'archive' : 'file',  // 🚀 嵌套压缩包标记为 archive
                subType: isNestedArchive ? getArchiveSubType(name) : undefined,
                expanded: false,
                level: archive.level + 1,
                file: null,
                // 🔧 拖拽压缩包的子项不应该是远程的
                isRemote: !isDraggedArchive,
                isLocalDrive: isDraggedArchive, // 🔧 标记为本地（拖拽）
                size: item.size || 0,
                isArchiveChild: true,
                isNestedArchive: isNestedArchive,  // 🚀 标记为嵌套压缩包
                archiveName: archivePath,
                archivePath: item.path, // 压缩包内的完整路径
                _fullArchivePath: item.path, // 🔧 文件的完整路径
                childrenLoaded: !isNestedArchive,  // 🚀 嵌套压缩包标记为未加载，需要懒加载
                loadingChildren: false,
              };
              newNodes.push(node);
            }
            console.log("[DEBUG] Total nodes created: " + newNodes.length + " (folders + files)");
          } catch (e) {
            console.error("[DEBUG] Error creating nodes:", e);
            throw e;
          }

          const insertAt = getFolderSubtreeEndIndex(archiveIndex);
          console.log("[DEBUG] Inserting nodes at index " + insertAt);
          if (newNodes.length > 0) {
            fileTreeHierarchy.splice(insertAt, 0, ...newNodes);
            shiftSelectedIndices(insertAt, newNodes.length);
          }
          archive.childrenLoaded = true;

          console.log("[DEBUG] Rebuilding cache and rendering...");
          // 重建缓存并渲染
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);
          console.log("[DEBUG] Archive expansion completed successfully");
        } catch (error) {
          console.error("加载压缩包内容失败:", error);
          showMessage("加载压缩包内容失败: " + error.message);
        } finally {
          archive.loadingChildren = false;
        }
      }

      // 自然排序比较函数（类似 sort -V）
      function naturalCompare(a, b) {
        if (!a && !b) return 0;
        if (!a) return -1;
        if (!b) return 1;

        // 移除末尾的 / 用于比较（目录）
        const aCompare = a.endsWith('/') ? a.slice(0, -1) : a;
        const bCompare = b.endsWith('/') ? b.slice(0, -1) : b;

        // 使用 localeCompare 的 numeric 选项
        return aCompare.localeCompare(bCompare, undefined, {
          numeric: true,
          sensitivity: 'base'
        });
      }

      // 加载压缩包内子目录的内容（按需展开）
      async function loadArchiveSubfolderChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder || !folder.isArchiveChild || folder.type !== "folder" || !folder.isRemote) return;
        if (folder.childrenLoaded) return;
        if (!serverBaseUrl) {
          showMessage("未连接到服务器");
          return;
        }

        folder.loadingChildren = true;
        renderFileTreeViewport(true);

        try {
          const archivePath = folder.archiveName;
          const parentPath = folder.archivePath; // 父目录在压缩包内的路径

          // 重新获取整个压缩包的文件列表，然后过滤出当前目录下的子项
          const tree = await loadServerArchiveTree(archivePath);
          if (!tree) {
            throw new Error("读取压缩包失败");
          }

          // 过滤出当前目录的直接子项
          // parentPath 可能以 / 结尾，确保统一格式
          const prefix = parentPath.endsWith('/') ? parentPath : parentPath + '/';
          const newNodes = [];
          const childFiles = [];      // 存储文件 [name, item]
          const childFolders = [];    // 存储文件夹 [name, pathInArchive]

          tree.forEach((item) => {
            const itemPath = item.path;
            // 跳过空路径和特殊路径
            if (!itemPath || itemPath.length === 0 || itemPath === './') {
              console.warn("[DEBUG] Skipping invalid path:", itemPath);
              return;
            }
            // 检查是否是当前目录的直接子项
            if (!itemPath.startsWith(prefix)) return;

            const relativePath = itemPath.substring(prefix.length);

            // 跳过空相对路径或当前目录标记
            if (!relativePath || relativePath.length === 0 || relativePath === '.') {
              console.warn("[DEBUG] Skipping empty relative path for:", itemPath);
              return;
            }

            const firstSlashIdx = relativePath.indexOf('/');

            if (firstSlashIdx === -1) {
              // 直接子文件
              childFiles.push([relativePath, item]);
            } else {
              // 子目录 - 只创建一层
              const childName = relativePath.substring(0, firstSlashIdx);
              const childPathInArchive = prefix + childName + '/'; // 压缩包内的完整路径
              // 检查是否已存在（避免重复）
              if (!childFolders.some(f => f[0] === childName + '/')) {
                childFolders.push([childName + '/', childPathInArchive]);
              }
            }
          });

          // 先添加文件夹，再添加文件（按自然排序）
          childFolders.sort((a, b) => naturalCompare(a[0], b[0]));
          for (const [name, pathInArchive] of childFolders) {
            const treePath = folder.path + "/" + name;
            const node = {
              name: name,
              path: treePath,
              type: 'folder',
              expanded: false,
              level: folder.level + 1,
              file: null,
              isRemote: true,
              size: 0,
              isArchiveChild: true,
              archiveName: archivePath,
              archivePath: pathInArchive, // 压缩包内的完整路径
              childrenLoaded: false, // 文件夹标记为未加载
              loadingChildren: false,
            };
            newNodes.push(node);
          }

          childFiles.sort((a, b) => naturalCompare(a[0], b[0]));
          for (const [name, item] of childFiles) {
            const treePath = folder.path + "/" + name;

            // 🚀 检测是否是嵌套的压缩包
            const lowerName = name.toLowerCase();
            const isNestedArchive = lowerName.endsWith('.zip') ||
                                    lowerName.endsWith('.7z') ||
                                    lowerName.endsWith('.rar') ||
                                    lowerName.endsWith('.tar') ||
                                    lowerName.endsWith('.gz');

            const node = {
              name: name,
              path: treePath,
              type: isNestedArchive ? 'archive' : 'file',  // 🚀 嵌套压缩包标记为 archive
              subType: isNestedArchive ? getArchiveSubType(name) : undefined,
              expanded: false,
              level: folder.level + 1,
              file: null,
              isRemote: true,
              size: item.size || 0,
              isArchiveChild: true,
              isNestedArchive: isNestedArchive,  // 🚀 标记为嵌套压缩包
              archiveName: archivePath,
              archivePath: item.path, // 压缩包内的完整路径
              childrenLoaded: !isNestedArchive,  // 🚀 嵌套压缩包标记为未加载，需要懒加载
              loadingChildren: false,
            };
            newNodes.push(node);
          }

          const insertAt = getFolderSubtreeEndIndex(folderIndex);
          if (newNodes.length > 0) {
            fileTreeHierarchy.splice(insertAt, 0, ...newNodes);
            shiftSelectedIndices(insertAt, newNodes.length);
          }
          folder.childrenLoaded = true;

          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);
        } catch (error) {
          console.error("加载子目录失败:", error);
          showMessage("加载子目录失败: " + error.message);
        } finally {
          folder.loadingChildren = false;
        }
      }

      // 刷新远程目录：删除子项并重新加载
      async function refreshRemoteDirectory(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder || folder.type !== "folder" || !folder.isRemote) {
          showMessage("只能刷新远程目录");
          return;
        }
        if (!serverBaseUrl) {
          showMessage("未连接到服务器");
          return;
        }

        showLoading(true, "正在刷新目录...");

        try {
          // 1. 删除该目录下的所有子项
          const folderLevel = folder.level;
          const folderPath = folder.path;
          let deleteStart = folderIndex + 1;
          let deleteCount = 0;
          
          // 找到该目录下的所有子项（level 大于 folder.level 且路径以 folder.path 开头）
          for (let i = folderIndex + 1; i < fileTreeHierarchy.length; i++) {
            const item = fileTreeHierarchy[i];
            // 如果遇到同级或更高级的节点，停止
            if (item.level <= folderLevel) break;
            // 确保是该目录的子项
            if (item.path && item.path.startsWith(folderPath + "/")) {
              deleteCount++;
            } else {
              break;
            }
          }
          
          if (deleteCount > 0) {
            // 更新选中索引
            selectedFiles = selectedFiles
              .filter(i => i < deleteStart || i >= deleteStart + deleteCount)
              .map(i => i >= deleteStart + deleteCount ? i - deleteCount : i);
            // 删除子项
            fileTreeHierarchy.splice(deleteStart, deleteCount);
          }
          
          // 2. 重置加载状态
          folder.childrenLoaded = false;
          folder.expanded = true; // 确保是展开状态
          
          // 3. 重新加载子项
          await loadRemoteFolderChildren(folderIndex);
          
          // 4. 刷新显示
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);
          
          showMessage(`已刷新目录: ${folder.name}`);
        } catch (error) {
          console.error("刷新目录失败:", error);
          showMessage("刷新目录失败: " + error.message);
        } finally {
          showLoading(false);
        }
      }

      // 🚀 通用目录刷新函数（支持本地和远程目录）
      async function refreshDirectory(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder || (folder.type !== "folder" && folder.type !== "drive")) {
          showMessage("只能刷新目录或驱动器");
          return;
        }

        showLoading(true, "正在刷新目录...");

        try {
          // 1. 删除该目录下的所有子项
          const folderLevel = folder.level;
          const folderPath = folder.path;
          let deleteStart = folderIndex + 1;
          let deleteCount = 0;

          // 找到该目录下的所有子项
          for (let i = folderIndex + 1; i < fileTreeHierarchy.length; i++) {
            const item = fileTreeHierarchy[i];
            if (item.level <= folderLevel) break;
            deleteCount++;
          }

          if (deleteCount > 0) {
            // 更新选中索引
            selectedFiles = selectedFiles.filter(f => {
              const item = fileTreeHierarchy[f.index];
              return !item || item.level <= folderLevel || !item.path?.startsWith(folderPath + "/");
            });
            // 删除子项
            fileTreeHierarchy.splice(deleteStart, deleteCount);
          }

          // 2. 重置加载状态
          folder.childrenLoaded = false;
          folder.expanded = true; // 确保是展开状态

          // 3. 根据类型重新加载子项
          if (folder.isRemote) {
            await loadRemoteFolderChildren(folderIndex);
          } else if (folder.isLocalDrive) {
            await loadLocalFolderChildren(folderIndex);
          } else {
            await loadLocalFolderChildren(folderIndex);
          }

          // 4. 刷新显示
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);

          showMessage(`已刷新目录: ${folder.name}`);
        } catch (error) {
          console.error("刷新目录失败:", error);
          showMessage("刷新目录失败: " + error.message);
        } finally {
          showLoading(false);
        }
      }

      // 一键展开全部文件夹
      function expandAllFolders() {
        let changed = false;
        fileTreeHierarchy.forEach((item) => {
          if (item && item.type === "folder" && !item.expanded) {
            item.expanded = true;
            changed = true;
          }
        });
        if (changed) {
          renderFileTree();
        }
      }

      // 一键折叠全部文件夹
      function collapseAllFolders() {
        let changed = false;
        fileTreeHierarchy.forEach((item) => {
          if (item && item.expanded) {
            // 🔧 折叠所有类型：文件夹、驱动器、压缩包
            if (item.type === "folder" || item.type === "drive" || item.isArchive) {
              // 折叠文件夹
              item.expanded = false;
              changed = true;
            }
          }
        });
        if (changed) {
          renderFileTree();
        }
      }
      
      // 从服务器加载文件内容
      async function loadServerFile(filePath) {
        if (!serverBaseUrl) {
          showMessage("未连接到服务器");
          return null;
        }

        try {
          showLoading(true, "正在加载文件内容...");

          const url = serverBaseUrl + "/api/file?path=" + encodeURIComponent(filePath);
          const response = await fetch(url, {
            method: "GET",
            cache: "no-cache",
          });

          if (!response.ok) {
            throw new Error("加载文件失败: " + response.status);
          }

          const content = await response.text();
          return content;

        } catch (error) {
          console.error("加载文件内容失败:", error);
          showMessage("加载文件内容失败: " + error.message);
          return null;
        } finally {
          showLoading(false);
        }
      }

      // 加载服务端压缩包内的文件
      async function loadServerArchiveFile(archivePath, filePath) {
        if (!serverBaseUrl) {
          showMessage("未连接到服务器");
          return null;
        }

        try {
          showLoading(true, "正在解压文件...");

          const url = serverBaseUrl + "/api/archive/file?archive=" + encodeURIComponent(archivePath) + "&file=" + encodeURIComponent(filePath);
          const response = await fetch(url, {
            method: "GET",
            cache: "no-cache",
          });

          if (!response.ok) {
            throw new Error("加载压缩包文件失败: " + response.status);
          }

          const content = await response.text();
          return content;

        } catch (error) {
          console.error("加载压缩包文件失败:", error);
          showMessage("加载压缩包文件失败: " + error.message);
          return null;
        } finally {
          showLoading(false);
        }
      }

      // 加载服务端压缩包的目录列表
      async function loadServerArchiveTree(archivePath) {
        if (!serverBaseUrl) {
          showMessage("未连接到服务器");
          return null;
        }

        try {
          showLoading(true, "正在读取压缩包...");

          const url = serverBaseUrl + "/api/archive/list?path=" + encodeURIComponent(archivePath);
          const response = await fetch(url, {
            method: "GET",
            cache: "no-cache",
          });

          if (!response.ok) {
            throw new Error("读取压缩包失败: " + response.status);
          }

          const result = await response.json();
          if (result.success && result.tree) {
            return result.tree;
          }
          return null;

        } catch (error) {
          console.error("读取压缩包失败:", error);
          showMessage("读取压缩包失败: " + error.message);
          return null;
        } finally {
          showLoading(false);
        }
      }

      // 加载选中的远程文件
      async function loadSelectedRemoteFiles() {
        // 开启新的加载会话
        const sessionId = ++currentLoadingSession;

        // 修改：获取可见选中的文件，并按照选择顺序排序
        const visibleSelectedFiles = selectedFiles.filter((fileObj) =>
          isFileTreeIndexVisible(fileObj.index)
        );

        // 按选择顺序排序
        const sortedSelectedFiles = [...visibleSelectedFiles].sort((a, b) => a.order - b.order);

        if (sortedSelectedFiles.length === 0) {
          cleanLogData();
          showMessage("没有选中任何文件");
          return;
        }

        // 🚀 加载前释放内存
        cleanLogData();

        progressBar.style.display = "block";
        progressFill.style.width = "0%";
        setButtonsDisabled(true);
        
        let loadedCount = 0;
        const totalFiles = sortedSelectedFiles.length;

        try {
          for (let i = 0; i < sortedSelectedFiles.length; i++) {
            // 检查会话是否过期
            if (sessionId !== currentLoadingSession) return;

            const fileObj = sortedSelectedFiles[i];
            const index = fileObj.index;
            const item = fileTreeHierarchy[index];

            if (!item || item.type !== "file") continue;

            let content = null;

            // 检查是否为压缩包内的文件
            if (item.isArchiveChild && item.archivePath && item.archiveName) {
              // 从服务端压缩包加载文件
              content = await loadServerArchiveFile(item.archiveName, item.archivePath);
            }
            // 🚀 检查是否为远程目录的文件（我们的远程目录功能）
            else if (item.remoteId) {
              // 从远程目录读取文件
              const conn = remoteConnections.find(c => c.id === item.remoteId);
              if (conn && window.electronAPI && window.electronAPI.readRemoteFile) {
                const result = await window.electronAPI.readRemoteFile({
                  ip: conn.ip,
                  port: conn.port,
                  filePath: item.path
                });
                if (result.success) {
                  content = result.content;
                } else {
                  throw new Error(result.error || '读取远程文件失败');
                }
              } else {
                throw new Error('远程连接已断开或API不可用');
              }
            } else {
              // 从服务端加载普通文件
              const requestPath = item.remotePath || item.path;
              content = await loadServerFile(requestPath);
            }

            // 再次检查会话是否过期（异步操作后）
            if (sessionId !== currentLoadingSession) return;

            if (content !== null) {
              // 添加文件头
              const headerIndex = originalLines.length;
              const lines = content.split("\n");
              const displayPath = item.isArchiveChild
                ? `${item.archiveName}/${item.archivePath}`
                : (item.remotePath || item.path);
              fileHeaders.push({
                fileName: displayPath,
                lineCount: lines.length,
                startIndex: headerIndex,
              });
              // 🚀 不转义HTML，直接使用原始内容
              originalLines.push(`=== 文件: ${displayPath} (${lines.length} 行) ===`);

              // 添加文件内容 - 保持内容原封不动，不进行转义
              lines.forEach((line) => {
                originalLines.push(line);
              });

              loadedCount++;
            }

            // 更新进度
            progressFill.style.width = ((i + 1) / totalFiles * 100) + "%";
          }
          
          // 最终检查会话是否过期
          if (sessionId !== currentLoadingSession) return;

          // 渲染日志
          resetFilter(false);
          renderLogLines();
          selectedOriginalIndex = -1;
          showMessage(`已加载 ${loadedCount} 个远程文件`);
          
        } catch (error) {
          // 如果是会话过期导致的错误，忽略
          if (sessionId !== currentLoadingSession) return;
          console.error("加载远程文件失败:", error);
          showMessage("加载远程文件失败: " + error.message);
        } finally {
          // 只有当前会话才清理UI
          if (sessionId === currentLoadingSession) {
            progressBar.style.display = "none";
            setButtonsDisabled(false);
            showLoading(false);
          }
        }
      }
      
      // ============ 服务器连接相关函数结束 ============

      // 初始化文件树功能 - 优化：修复残影和文本选中问题
      function initFileTree() {
        // 读取并应用上次调整过的宽度（持久化）
        const savedDockedWidth = readStorageNumber(
          FILE_TREE_DOCKED_WIDTH_STORAGE_KEY
        );
        if (savedDockedWidth != null) {
          fileTreeDockedWidthPx = clampValue(savedDockedWidth, 200, 1200);  // 🚀 放宽最大宽度从 600 到 1200px
        }
        const savedFloatingWidth = readStorageNumber(
          FILE_TREE_FLOATING_WIDTH_STORAGE_KEY
        );
        if (savedFloatingWidth != null) {
          // 悬浮宽度不强行限制到600，允许更宽（会在展示时根据视口再clamp）
          fileTreeFloatingWidthPx = Math.max(260, savedFloatingWidth);
        }
        // 应用停靠宽度（避免刷新后回到默认）
        if (fileTreeContainer) {
          fileTreeContainer.style.width = fileTreeDockedWidthPx + "px";
        }
        // 预先同步悬浮宽度到CSS变量（Ctrl+G首次打开也能恢复）
        syncFloatingFileTreeCssWidth();
        // 🚀 设置文件树宽度 CSS 变量，供 CSS 选择器使用
        document.documentElement.style.setProperty(
          "--file-tree-width",
          fileTreeDockedWidthPx + "px"
        );
        // 🚀 立即更新布局，确保主日志框不被文件树遮挡
        updateLayout();

        // 🚀 延迟再次更新布局，确保首次渲染后主日志框位置正确
        // 第一个渲染进程有时会在布局未完全准备好时就调用updateLayout
        setTimeout(() => {
          updateLayout();
        }, 50);

        // 🚀 再次延迟更新，确保按钮位置正确
        setTimeout(() => {
          updateButtonPosition();
          updateLayout();
        }, 100);

        // 🚀 强制触发一次重绘，确保布局正确应用
        setTimeout(() => {
          // 强制设置按钮位置
          const finalWidth = fileTreeDockedWidthPx || 360;
          fileTreeCollapseBtn.style.left = finalWidth + "px";
          // 强制更新主日志框位置
          outer.style.left = finalWidth + "px";
          hScroll.style.left = finalWidth + "px";
          // 设置CSS变量
          document.documentElement.style.setProperty("--file-tree-width", finalWidth + "px");
          document.documentElement.style.setProperty("--content-margin-left", "0px");
        }, 150);

        // 文件树边框上的展开/隐藏按钮点击事件
        fileTreeCollapseBtn.addEventListener("click", toggleFileTree);

        // 悬浮文件树遮罩点击：关闭悬浮文件树
        if (fileTreeFloatingOverlay) {
          fileTreeFloatingOverlay.addEventListener("click", () => {
            if (isFileTreeFloating) hideFloatingFileTree();
          });
        }

        // 文件树搜索功能 - 🔧 修复：输入时立即更新高亮
        fileTreeSearch.addEventListener("input", function (e) {
          fileTreeSearchTerm = e.target.value;

          // 🔧 搜索词为空时，恢复默认视图
          if (!fileTreeSearchTerm.trim()) {
            fileTreeSearchShowOnlyMatches = false;
            temporarilyIncludedNodes.clear();
            rebuildFileTreeVisibleCache();
            renderFileTreeViewport(true);
            return;
          }

          // 🔧 判断是否是 WTGLMK 开头的搜索
          const isWTGLMKSearch = fileTreeSearchTerm.trim().toUpperCase().startsWith('WTGLMK');

          if (isWTGLMKSearch) {
            // WTGLMK 开头：只跳转，不过滤
            fileTreeSearchShowOnlyMatches = false;
            rebuildFileTreeVisibleCache();
            renderFileTreeViewport(true);

            if (fileTreeSearchTerm && fileTreeSearchTerm.trim()) {
              jumpToFirstMatch();
            }
          } else {
            // 🔧 修复：其他搜索也更新匹配索引以显示高亮，但不过滤显示
            rebuildFileTreeVisibleCache();
            renderFileTreeViewport(true);
          }
        });

        // 🚀 按Enter键时的处理
        fileTreeSearch.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();

            let inputTerm = e.target.value;
            console.log(`[文件树搜索] Enter键, term="${inputTerm}", 模式=${isFileLoadMode ? '加载' : '过滤'}`);

            // 🔧 判断是否是 WTGLMK 开头的搜索
            const isWTGLMKSearch = inputTerm.trim().toUpperCase().startsWith('WTGLMK');
            console.log(`[文件树搜索] isWTGLMKSearch=${isWTGLMKSearch}`);

            if (isWTGLMKSearch) {
              // WTGLMK 开头：自动补全路径并跳转
              const term = inputTerm.trim();
              // 🔧 动态获取当前年月
              const now = new Date();
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const yearMonth = `${year}-${month}`;
              // 自动补全路径
              const fullPath = `/prodlog_dump/prodlog/saved/question_parse/${yearMonth}/${term}`;
              fileTreeSearchTerm = fullPath;
              fileTreeSearch.value = fullPath; // 更新搜索框显示完整路径

              // 重置过滤状态
              fileTreeSearchShowOnlyMatches = false;
              temporarilyIncludedNodes.clear();

              // 跳转到完整路径
              jumpToPath(fullPath);
            } else {
              // 🚀 新增：判断当前模式
              if (!isFileLoadMode) {
                // 🔍 过滤模式：只记录匹配的文件路径，不加载内容
                fileTreeSearchTerm = inputTerm;
                fileTreeSearchShowOnlyMatches = true;
                filterFileTree();

                // 收集所有匹配的文件路径
                collectFilteredFilePaths();
              } else {
                // 📥 加载模式（默认行为）：启用过滤
                fileTreeSearchTerm = inputTerm;
                fileTreeSearchShowOnlyMatches = true;
                console.log(`[文件树搜索] 调用 filterFileTree`);
                filterFileTree();
              }
            }
          } else if (e.key === "Escape") {
            // ESC键清空搜索并恢复默认行为
            e.preventDefault();
            e.stopPropagation();
            fileTreeSearch.value = "";
            fileTreeSearchTerm = "";
            fileTreeSearchShowOnlyMatches = false;
            temporarilyIncludedNodes.clear();
            filterFileTree();
          }
        });

        // 🚀 新增：文件加载模式切换按钮事件监听
        const toggleLoadModeBtn = document.getElementById('toggleLoadModeBtn');
        if (toggleLoadModeBtn) {
          // 初始化按钮状态
          updateLoadModeButton();

          toggleLoadModeBtn.addEventListener('click', () => {
            isFileLoadMode = !isFileLoadMode;
            updateLoadModeButton();

            // 切换模式时的提示和清理
            if (isFileLoadMode) {
              showMessage('⬇️ 已切换到加载模式：文件将加载到主日志框');
              // 清空过滤模式的文件列表
              filterModeFileList = [];
            } else {
              showMessage('🔍 已切换到过滤模式：选中文件后，在过滤框输入关键词即可过滤\n💡 提示：使用 Ctrl+Click 可以多选文件');

              // 🔧 强制清空主日志框和选中的文件（过滤模式不需要这些）
              console.log('[切换模式] 清空主日志框和选中文件');

              // 清空主日志框内容
              if (originalLines.length > 0) {
                console.log('[切换模式] 清空 originalLines，共', originalLines.length, '行');
                cleanFilterData();
                originalLines = [];
              }

              // 清空文件头信息（如果有的话）
              if (typeof fileHeaders !== 'undefined' && fileHeaders.length > 0) {
                console.log('[切换模式] 清空 fileHeaders，共', fileHeaders.length, '个文件');
                fileHeaders = [];
              }

              // 清空当前文件信息
              if (typeof currentFiles !== 'undefined' && currentFiles.length > 0) {
                console.log('[切换模式] 清空 currentFiles，共', currentFiles.length, '个文件');
                currentFiles = [];
              }

              // 🔧 强制清空主日志框的 DOM
              const innerContainer = document.getElementById('innerContainer');
              const outerContainer = DOMCache.get('outerContainer');

              if (innerContainer) {
                innerContainer.innerHTML = '';
                console.log('[切换模式] 强制清空 innerContainer DOM');
              }

              if (outerContainer) {
                outerContainer.scrollTop = 0;
                console.log('[切换模式] 重置 outerContainer 滚动位置');
              }

              // 清空虚拟滚动占位符
              const placeholder = document.getElementById('logPlaceholder');
              if (placeholder) {
                placeholder.remove();
                console.log('[切换模式] 移除 logPlaceholder');
              }

              // 重新渲染主日志框（显示为空）
              renderLogLines();

              // 清空过滤面板（如果打开的话）
              cleanFilterData();

              // 清空选中的文件
              if (selectedFiles.length > 0) {
                console.log('[切换模式] 清空选中文件，共', selectedFiles.length, '个');
                clearFileSelection();
                renderFileTreeViewport(true);
              }

              // 清空过滤文件列表
              filterModeFileList = [];

              console.log('[切换模式] ✓ 清空完成');
            }
          });

          // 更新按钮状态
          function updateLoadModeButton() {
            if (isFileLoadMode) {
              toggleLoadModeBtn.classList.remove('filter-mode');
              toggleLoadModeBtn.title = '当前：加载模式（点击切换到过滤模式）';
              toggleLoadModeBtn.querySelector('.mode-icon').textContent = '⬇️';
            } else {
              toggleLoadModeBtn.classList.add('filter-mode');
              toggleLoadModeBtn.title = '当前：过滤模式（点击切换到加载模式）';
              toggleLoadModeBtn.querySelector('.mode-icon').textContent = '🔍';
            }
          }
        }

        // 文件树容器按 f 键聚焦搜索框
        function focusFileTreeSearch() {
          fileTreeSearch.focus();
          fileTreeSearch.select();
        }

        // 让fileTreeContainer在点击时获得焦点
        fileTreeContainer.addEventListener("click", function (e) {
          // 只有当点击的不是按钮等交互元素时才获取焦点
          if (document.activeElement !== fileTreeSearch &&
              !e.target.closest("button") &&
              !e.target.closest("input")) {
            fileTreeContainer.focus();
          }
        });

        // 服务器连接初始化
        initServerConnection();

        // 文件树宽度调整 - 优化：防止文本选中
        fileTreeResizer.addEventListener("mousedown", function (e) {
          e.preventDefault(); // 防止文本选中
          startResize(e);
        });

        // 文件列表点击事件
        fileTreeList.addEventListener("mousedown", handleFileTreeMouseDown);
        fileTreeList.addEventListener("click", handleFileTreeClick);
        fileTreeList.addEventListener("mousemove", handleFileTreeMouseMove);

        // 🔧 双击事件：加载选中的文件
        fileTreeList.addEventListener("dblclick", function (e) {
          const item = e.target.closest(".file-tree-item");
          if (!item) {
            // 双击空白区域，清除选择
            clearFileSelection();
            renderFileTreeViewport(true);
            return;
          }

          const index = parseInt(item.dataset.index);
          console.log(`[双击] item.dataset.index=${item.dataset.index}, index=${index}, isNaN=${isNaN(index)}`);
          if (isNaN(index)) return;

          const treeItem = fileTreeHierarchy[index];
          console.log(`[双击] treeItem=${treeItem ? treeItem.name : 'null'}, type=${treeItem?.type}`);
          if (!treeItem) return;

          // 只处理文件的双击，用于加载文件内容
          if (treeItem.type === "file") {
            console.log(`[双击] 准备加载文件，当前已选文件数: ${selectedFiles.length}`);

            // 🔧 修复：如果已有多个文件被选中（Ctrl多选），加载所有选中的文件
            // 如果双击的文件不在已选列表中，则只加载双击的文件
            const isFileSelected = selectedFiles.some(f => f.index === index);

            if (selectedFiles.length > 1 && isFileSelected) {
              // 已有多个文件被选中，且双击的文件在其中，加载所有选中的文件
              console.log(`[双击] 加载所有已选中的 ${selectedFiles.length} 个文件`);
            } else {
              // 只有一个文件被选中，或双击的文件不在已选列表中
              console.log(`[双击] 只加载当前文件: ${treeItem.name}`);
              // 🔧 只清空选择状态，不清空内容跟踪
              selectedFiles = [];
              selectionOrderCounter = 1; // 重置计数器
              selectedFiles = [{
                index,
                order: selectionOrderCounter
              }];
            }

            // 加载选中的文件
            // 🔧 修复双击重复加载问题：清除单击设置的防抖定时器
            if (fileLoadDebounceTimer) {
              clearTimeout(fileLoadDebounceTimer);
              fileLoadDebounceTimer = null;
              console.log(`[双击] 已清除单击防抖定时器，避免重复加载`);
            }
            loadSelectedFiles();
          }
        });
        // 文件树右键菜单
        fileTreeList.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();

          const itemEl = e.target.closest(".file-tree-item");
          if (itemEl) {
            // 右键点击了文件项
            const idx = parseInt(itemEl.dataset.index);
            if (!Number.isNaN(idx)) {
              showFileTreeContextMenu(e.clientX, e.clientY, idx);
            }
          } else {
            // 右键点击了空白区域，显示通用菜单
            showFileTreeContextMenu(e.clientX, e.clientY, -1);
          }
        });
        document.addEventListener("mouseup", handleFileTreeMouseUp);

        // 点击空白处/滚动/窗口变化时关闭右键菜单
        document.addEventListener("mousedown", (e) => {
          if (!fileTreeContextMenu) return;
          if (!fileTreeContextMenu.classList.contains("visible")) return;
          if (fileTreeContextMenu.contains(e.target)) return;
          hideFileTreeContextMenu();
        });
        document.addEventListener("scroll", () => hideFileTreeContextMenu(), true);
        window.addEventListener("resize", () => hideFileTreeContextMenu());

        if (fileTreeCtxCopyName) {
          fileTreeCtxCopyName.addEventListener("click", async () => {
            const idx = fileTreeContextMenuIndex;
            const it = fileTreeHierarchy[idx];
            if (!it) return;
            await copyTextToClipboard(it.name || "");
            hideFileTreeContextMenu();
          });
        }
        if (fileTreeCtxRefreshDir) {
          fileTreeCtxRefreshDir.addEventListener("click", async () => {
            const idx = fileTreeContextMenuIndex;
            hideFileTreeContextMenu();
            await refreshDirectory(idx);
          });
        }
        if (fileTreeCtxLoadOnlyDir) {
          fileTreeCtxLoadOnlyDir.addEventListener("click", () => {
            const idx = fileTreeContextMenuIndex;
            loadTreeOnlyThisDirByIndex(idx);
            hideFileTreeContextMenu();
          });
        }

        // 展开全部文件夹
        if (fileTreeCtxExpandAll) {
          fileTreeCtxExpandAll.addEventListener("click", () => {
            expandAllFolders();
            hideFileTreeContextMenu();
          });
        }
        // 折叠全部文件夹
        if (fileTreeCtxCollapseAll) {
          fileTreeCtxCollapseAll.addEventListener("click", () => {
            collapseAllFolders();
            hideFileTreeContextMenu();
          });
        }

        // 🚀 解压到当前路径
        if (fileTreeCtxExtractArchive) {
          fileTreeCtxExtractArchive.addEventListener("click", async () => {
            const idx = fileTreeContextMenuIndex;
            hideFileTreeContextMenu();
            await extractArchiveToCurrentPath(idx);
          });
        }

        // 🚀 打开HTML文件
        if (fileTreeCtxOpenHtml) {
          fileTreeCtxOpenHtml.addEventListener("click", async () => {
            const idx = fileTreeContextMenuIndex;
            const item = fileTreeHierarchy[idx];
            if (!item || !item.path) {
              hideFileTreeContextMenu();
              return;
            }

            console.log(`[打开HTML] 文件路径: ${item.path}`);
            console.log(`[打开HTML] item.type: ${item.type}`);
            console.log(`[打开HTML] item.isArchiveChild: ${item.isArchiveChild}`);
            console.log(`[打开HTML] item.isRemote: ${item.isRemote}`);
            hideFileTreeContextMenu();

            // 🚀 检查是否是压缩包内的HTML文件
            if (item.isArchiveChild) {
              showMessage('⚠️ 暂不支持直接打开压缩包内的HTML文件\n\n请先解压到本地，然后打开');
              return;
            }

            // 🚀 检查是否是远程文件
            if (item.isRemote) {
              try {
                // 构建远程文件URL
                const requestPath = item.remotePath || item.path;
                const remoteUrl = serverBaseUrl + "/api/file?path=" + encodeURIComponent(requestPath);
                console.log(`[打开HTML] 远程文件URL: ${remoteUrl}`);

                showMessage('正在下载远程HTML文件...');

                // 下载远程文件到临时目录
                if (window.electronAPI && window.electronAPI.downloadRemoteFile) {
                  const downloadResult = await window.electronAPI.downloadRemoteFile(remoteUrl, item.name);

                  if (!downloadResult || !downloadResult.success) {
                    showMessage('⚠️ 下载远程HTML文件失败: ' + (downloadResult?.error || '未知错误'));
                    return;
                  }

                  console.log(`[打开HTML] 下载完成，临时文件: ${downloadResult.tempPath}`);

                  // 打开下载的临时文件
                  if (window.electronAPI && window.electronAPI.openHtmlWindow) {
                    const openResult = await window.electronAPI.openHtmlWindow(downloadResult.tempPath);

                    if (openResult && !openResult.success) {
                      showMessage('⚠️ 打开HTML文件失败: ' + openResult.error);
                    }
                  }
                } else {
                  showMessage('⚠️ downloadRemoteFile API 不可用');
                }
              } catch (error) {
                console.error(`[打开HTML] 下载远程文件失败:`, error);
                showMessage('⚠️ 下载远程HTML文件失败: ' + error.message);
              }
              return;
            }

            try {
              // 调用IPC打开HTML文件窗口（本地文件）
              if (window.electronAPI && window.electronAPI.openHtmlWindow) {
                console.log(`[打开HTML] 调用IPC: ${item.path}`);
                const result = await window.electronAPI.openHtmlWindow(item.path);
                console.log(`[打开HTML] IPC返回结果:`, result);

                if (result && !result.success) {
                  showMessage('⚠️ 打开HTML文件失败: ' + result.error);
                }
              } else {
                showMessage('⚠️ openHtmlWindow API 不可用');
              }
            } catch (error) {
              console.error(`[打开HTML] 失败:`, error);
              showMessage('⚠️ 打开HTML文件失败: ' + error.message);
            }
          });
        }

        // 鼠标移出菜单时隐藏菜单
        if (fileTreeContextMenu) {
          fileTreeContextMenu.addEventListener("mouseleave", () => {
            hideFileTreeContextMenu();
          });
        }

        // 文件树拖拽支持（直接拖入文件/文件夹到文件树区域）
        if (fileTreeContainer) {
          fileTreeContainer.addEventListener("dragover", (e) => {
            try {
              e.preventDefault();
              e.stopPropagation();

              // 设置允许的拖放效果（对 WinRAR 等工具很重要）
              if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
                // 兼容性处理：某些旧版本浏览器
                if (e.dataTransfer.effectAllowed !== undefined) {
                  try {
                    e.dataTransfer.effectAllowed = 'copy';
                  } catch (_) {}
                }
              }

              if (fileTreeContainer) {
                fileTreeContainer.classList.add("drag-over");
              }
            } catch (err) {
              console.error("文件树dragover事件处理失败:", err);
            }
          }, false);

          fileTreeContainer.addEventListener("dragleave", (e) => {
            try {
              e.preventDefault();
              e.stopPropagation();
              // 只有当鼠标真正离开文件树容器时才移除样式
              if (fileTreeContainer && !fileTreeContainer.contains(e.relatedTarget)) {
                fileTreeContainer.classList.remove("drag-over");
              }
            } catch (err) {
              console.error("文件树dragleave事件处理失败:", err);
            }
          }, false);

          fileTreeContainer.addEventListener("drop", async (e) => {
            try {
              e.preventDefault();
              e.stopPropagation();
              if (fileTreeContainer) {
                fileTreeContainer.classList.remove("drag-over");
              }

              // 确保dataTransfer存在
              if (!e.dataTransfer) {
                console.error("dataTransfer 不存在");
                showMessage("拖拽数据无效，请重新尝试");
                return;
              }

              // 📊 调试：显示文件数量
              console.log("🌳 文件树 drop 事件:");
              console.log("  - 文件数量:", e.dataTransfer.files ? e.dataTransfer.files.length : 0);

              // 检查拖入的文件中是否有压缩包
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const hasArchive = Array.from(e.dataTransfer.files).some(f => isArchiveFile(f));
                if (hasArchive) {
                  // 分离压缩包和普通文件
                  const archiveFiles = Array.from(e.dataTransfer.files).filter(f => isArchiveFile(f));
                  const normalFiles = Array.from(e.dataTransfer.files).filter(f => !isArchiveFile(f));

                  console.log(`📦 检测到 ${archiveFiles.length} 个压缩包, ${normalFiles.length} 个普通文件`);

                  // 先处理压缩包
                  for (const archiveFile of archiveFiles) {
                    await processArchiveFile(archiveFile);
                  }

                  // 如果有普通文件，正常处理
                  if (normalFiles.length > 0) {
                    const looksLikeFolder = normalFiles.some((f) =>
                      f && (f.webkitRelativePath || "").includes("/")
                    );
                    if (looksLikeFolder) {
                      await handleDroppedFolder(normalFiles);
                    } else {
                      handleDroppedFiles(normalFiles);
                    }
                  }
                  return;
                }
              }

              await handleDropFiles(e.dataTransfer);
            } catch (error) {
              console.error("拖拽文件处理失败:", error);
              const errorMsg = error?.message || error?.toString() || "未知错误";
              if (typeof showMessage === 'function') {
                showMessage(`拖拽文件失败: ${errorMsg}`);
              } else {
                alert(`拖拽文件失败: ${errorMsg}`);
              }
            }
          }, false);
        }

        // 文件输入元素事件监听器
        if (importFileInput) {
          importFileInput.addEventListener("change", async (e) => {
            try {
              const files = e.target.files;
              if (!files || files.length === 0) return;
              
              // 处理导入的文件
              const list = Array.from(files);
              if (list.length > MAX_FILES) {
                showMessage(`文件过多。只加载前 ${MAX_FILES} 个文件。`);
                list.splice(MAX_FILES);
              }

              const totalSize = list.reduce((sum, file) => sum + (file.size || 0), 0);
              if (totalSize > MAX_TOTAL_SIZE) {
                showMessage("总大小超过10000MB。请选择更少的文件。");
                return;
              }

              handleDroppedFiles(list);
            } catch (error) {
              console.error("导入文件失败:", error);
              showMessage(`导入文件失败: ${error.message || "未知错误"}`);
            }
            // 重置input值，以便可以重复选择同一文件
            e.target.value = "";
          });
        }
        
        if (importFolderInput) {
          importFolderInput.addEventListener("change", async (e) => {
            try {
              const files = e.target.files;
              if (!files || files.length === 0) return;

              // 处理导入的文件夹
              await handleDroppedFolder(Array.from(files));
            } catch (error) {
              console.error("导入文件夹失败:", error);
              showMessage(`导入文件夹失败: ${error.message || "未知错误"}`);
            }
            // 重置input值，以便可以重复选择同一文件夹
            e.target.value = "";
          });
        }

        // 🚀 路径输入框 - 直接输入文件路径加载
        // 解析路径（去除双引号）
        function parsePathInput(input) {
          let path = input.trim();

          // 处理双引号包裹的路径（支持带空格的路径）
          if (path.startsWith('"') && path.endsWith('"')) {
            path = path.slice(1, -1);
          } else if (path.startsWith('"')) {
            // 只有起始引号，找到结束引号
            const endQuote = path.indexOf('"', 1);
            if (endQuote !== -1) {
              path = path.slice(1, endQuote);
            }
          }

          return path;
        }

        // 判断是否为压缩包
        function isArchivePath(path) {
          const ext = path.toLowerCase();
          const archiveExts = ['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.tar.gz', '.tar.bz2'];
          return archiveExts.some(ext => path.endsWith(ext));
        }

        // 加载路径
        async function loadPath(path) {
          if (!path) {
            showMessage('请输入有效的文件路径');
            return;
          }

          console.log(`[路径输入] 加载路径: ${path}`);

          try {
            if (!window.electronAPI || !window.electronAPI.fileExists) {
              showMessage('API 不可用');
              return;
            }

            // 检查文件是否存在
            const existsResult = await window.electronAPI.fileExists(path);
            if (!existsResult.success || !existsResult.exists) {
              showMessage(`文件不存在: ${path}`);
              return;
            }

            // 判断是文件还是压缩包
            if (isArchivePath(path)) {
              // 压缩包：使用懒加载方式添加到文件树
              console.log(`[路径输入] 检测到压缩包: ${path}`);
              await loadArchiveToTree(path);
            } else {
              // 普通文件：直接加载
              console.log(`[路径输入] 检测到普通文件: ${path}`);
              await loadDirectFile(path);
            }

            // 清空输入框
            if (fileTreePathInput) {
              fileTreePathInput.value = '';
            }

            // 确保文件树可见
            if (fileTreeContainer) {
              fileTreeContainer.classList.add('visible');
              if (fileTreeCollapseBtn) {
                fileTreeCollapseBtn.innerHTML = '◀';
              }
              updateLayout();
              updateButtonPosition();
            }

          } catch (error) {
            console.error('[路径输入] 加载失败:', error);
            showMessage(`加载失败: ${error.message || '未知错误'}`);
          }
        }

        // 加载压缩包到文件树（懒加载）
        async function loadArchiveToTree(archivePath) {
          console.log(`[路径输入] 添加压缩包到文件树: ${archivePath}`);

          const fileName = archivePath.split(/[\\/]/).pop();
          const ext = archivePath.toLowerCase();

          // 确定压缩包类型
          let isZip = ext.endsWith('.zip');
          let is7z = ext.endsWith('.7z');
          let isRar = ext.endsWith('.rar');
          let isTar = ext.endsWith('.tar') || ext.endsWith('.tar.gz') || ext.endsWith('.tar.bz2') || ext.endsWith('.tgz') || ext.endsWith('.gz') || ext.endsWith('.bz2');

          // 创建压缩包节点
          const archiveNode = {
            name: fileName,
            path: archivePath,
            type: 'archive',
            subType: isZip ? 'zip' : (is7z ? '7z' : (isRar ? 'rar' : 'tar')),
            expanded: false,
            level: 1,
            file: null,
            childrenLoaded: false,
            loadingChildren: false,
            lazyLoad: true,
            isLocalDrive: true,
            isArchive: true,  // 🔧 添加此属性，让 mousedown 处理器能识别
            size: 0,
            archiveName: fileName
          };

          // 添加到文件树
          fileTreeHierarchy.push(archiveNode);

          // 重新构建文件树
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);

          showMessage(`已添加压缩包: ${fileName}`);
        }

        // 直接加载文件
        async function loadDirectFile(filePath) {
          console.log(`[路径输入] 直接加载文件: ${filePath}`);

          if (!window.electronAPI || !window.electronAPI.readFile) {
            showMessage('读取文件 API 不可用');
            return;
          }

          const result = await window.electronAPI.readFile(filePath);
          if (!result.success) {
            throw new Error(result.error || '读取文件失败');
          }

          const content = result.content;
          if (content === null || content === undefined) {
            throw new Error('文件内容为空');
          }

          // 清理旧数据
          cleanLogData();

          // 处理文件内容
          const lines = String(content).split('\n');
          originalLines = [];
          fileHeaders = [];

          // 添加文件头
          fileHeaders.push({
            fileName: filePath,
            lineCount: lines.length,
            startIndex: 0
          });
          originalLines.push(`=== 文件: ${filePath} (${lines.length} 行) ===`);

          // 🚀 性能优化：避免 forEach + push 导致的主线程阻塞
          // 方法1：使用 push.apply（比forEach快10-100倍）
          const startIndex = originalLines.length;
          originalLines.length += lines.length;
          for (let i = 0; i < lines.length; i++) {
            originalLines[startIndex + i] = lines[i];
          }

          // 重置过滤并渲染
          resetFilter(false);
          renderLogLines();
          selectedOriginalIndex = -1;

          // 滚动到顶部
          if (outer) outer.scrollTop = 0;

          showMessage(`已加载 ${lines.length} 行`);
        }

        // 路径输入框事件监听器
        if (fileTreePathInput) {
          // Enter 键处理
          fileTreePathInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const path = parsePathInput(fileTreePathInput.value);
              if (path) {
                loadPath(path);
              }
            }
          });
        }

        // 加载按钮点击处理
        if (fileTreePathLoadBtn) {
          fileTreePathLoadBtn.addEventListener('click', () => {
            const path = parsePathInput(fileTreePathInput.value);
            if (path) {
              loadPath(path);
            }
          });
        }

        // 🚀 文件树默认展开，不再隐藏
        // fileTreeContainer.classList.remove("visible");

        // 初始设置文件树边框按钮为向左箭头（展开状态）
        fileTreeCollapseBtn.innerHTML = "◀";

        // 初始化按钮位置
        updateButtonPosition();

        // 🚀 预暴露所有盘符到文件树（包括 C 盘）
        initializeDataDrivesInFileTree(true);

        // 🚀 初始化文件系统监听
        initFileSystemWatcher();

        // 🚀 初始化远程目录事件
        initializeRemoteDirectoryEvents();
      }

      // 🚀 文件系统监听器 - 自动同步文件变化
      const watchedDirectories = new Set(); // 已监听的目录

      async function initFileSystemWatcher() {
        if (!window.electronAPI || !window.electronAPI.on) {
          console.log('[文件监听] electronAPI 不可用');
          return;
        }

        console.log('[文件监听] 初始化文件系统监听器');

        // 监听目录变化事件
        window.electronAPI.on('directory-changed', (data) => {
          console.log('[文件监听] 收到目录变化通知:', data);
          handleDirectoryChanged(data);
        });
      }

      // 处理目录变化
      function handleDirectoryChanged(data) {
        const { dirPath, eventType, filename } = data;

        // 防抖：300ms 内只处理一次变化
        if (window._directoryChangeTimeout) {
          clearTimeout(window._directoryChangeTimeout);
        }

        window._directoryChangeTimeout = setTimeout(() => {
          console.log(`[文件监听] 刷新目录: ${dirPath}`);
          refreshDirectoryInTree(dirPath);
        }, 300);
      }

      // 刷新文件树中的目录
      async function refreshDirectoryInTree(dirPath) {
        try {
          // 🔧 暂时禁用文件监听，避免文件树不稳定
          console.log(`[文件监听] 文件监听触发，但已被禁用: ${dirPath}`);
          return;

          // 标准化路径
          const normalizedPath = dirPath.replace(/\\/g, '/').replace(/\/$/, '');

          // 查找文件树中匹配的节点
          for (let i = 0; i < fileTreeHierarchy.length; i++) {
            const node = fileTreeHierarchy[i];
            const nodePath = (node.path || '').replace(/\\/g, '/').replace(/\/$/, '');

            // 如果是驱动器根目录，直接刷新驱动器
            if (node.type === 'drive' && nodePath === normalizedPath) {
              console.log(`[文件监听] 刷新驱动器: ${node.name}`);
              await refreshDriveNode(node, i);
              return;
            }

            // 如果是普通目录，重新加载子项
            if (node.type === 'folder' && nodePath === normalizedPath) {
              if (node.expanded && node.childrenLoaded) {
                console.log(`[文件监听] 刷新目录: ${node.name}`);
                // 卸载子项并重新加载
                unloadLocalFolderChildren(i);
                node.childrenLoaded = false;
                // 重新展开加载
                await toggleLocalFolder(node, i);
              }
              return;
            }
          }
        } catch (error) {
          console.error('[文件监听] 刷新目录失败:', error);
        }
      }

      // 刷新驱动器节点
      async function refreshDriveNode(driveNode, driveIndex) {
        try {
          if (!window.electronAPI || !window.electronAPI.listDirectory) {
            return;
          }

          const result = await window.electronAPI.listDirectory(driveNode.path);
          if (!result.success || !result.items) {
            return;
          }

          // 移除旧的子节点
          const childrenToRemove = [];
          for (let i = driveIndex + 1; i < fileTreeHierarchy.length; i++) {
            const child = fileTreeHierarchy[i];
            if (child.level <= driveNode.level) break;
            childrenToRemove.push(i);
          }
          // 从后往前删除，避免索引问题
          for (let i = childrenToRemove.length - 1; i >= 0; i--) {
            fileTreeHierarchy.splice(childrenToRemove[i], 1);
          }

          // 添加新的子节点
          const newChildren = [];
          for (const item of result.items) {
            const childNode = {
              name: item.name,
              path: item.path,
              type: item.type,
              isArchive: item.isArchive || item.type === 'archive',
              subType: item.isArchive ? getArchiveSubType(item.name) : undefined,
              expanded: false,
              level: driveNode.level + 1,
              file: null,
              childrenLoaded: false,
              loadingChildren: false,
              lazyLoad: item.type === 'folder' || item.isArchive,
              isLocalDrive: true,
              size: item.size || 0
            };
            newChildren.push(childNode);
          }

          // 插入新子节点
          const insertIndex = driveIndex + 1;
          fileTreeHierarchy.splice(insertIndex, 0, ...newChildren);

          driveNode.childrenLoaded = true;

          // 重新渲染文件树
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);

          console.log(`[文件监听] 驱动器 ${driveNode.name} 刷新完成`);
        } catch (error) {
          console.error('[文件监听] 刷新驱动器失败:', error);
        }
      }

      // 获取压缩包子类型
      function getArchiveSubType(fileName) {
        const name = fileName.toLowerCase();
        if (name.endsWith('.zip')) return 'zip';
        if (name.endsWith('.7z')) return '7z';
        if (name.endsWith('.rar')) return 'rar';
        if (name.endsWith('.tar')) return 'tar';
        if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'tar.gz';
        if (name.endsWith('.tar.bz2')) return 'tar.bz2';
        if (name.endsWith('.gz')) return 'gz';
        return 'zip';
      }

      // 🚀 启动目录监听
      async function startWatchingDirectory(dirPath) {
        if (!window.electronAPI || !window.electronAPI.watchDirectory) {
          console.log('[文件监听] watchDirectory API 不可用');
          return;
        }

        // 标准化路径
        const normalizedPath = dirPath.replace(/\\/g, '/').replace(/\/$/, '');

        // 如果已经在监听，跳过
        if (watchedDirectories.has(normalizedPath)) {
          console.log(`[文件监听] 已在监听: ${normalizedPath}`);
          return;
        }

        try {
          const result = await window.electronAPI.watchDirectory(dirPath);
          if (result.success) {
            watchedDirectories.add(normalizedPath);
            console.log(`[文件监听] 开始监听: ${normalizedPath}`);
          } else {
            console.error(`[文件监听] 启动失败: ${result.error}`);
          }
        } catch (error) {
          console.error('[文件监听] 启动监听失败:', error);
        }
      }

      // 🚀 停止目录监听
      async function stopWatchingDirectory(dirPath) {
        if (!window.electronAPI || !window.electronAPI.unwatchDirectory) {
          return;
        }

        // 标准化路径
        const normalizedPath = dirPath.replace(/\\/g, '/').replace(/\/$/, '');

        if (!watchedDirectories.has(normalizedPath)) {
          return;
        }

        try {
          const result = await window.electronAPI.unwatchDirectory(dirPath);
          if (result.success) {
            watchedDirectories.delete(normalizedPath);
            console.log(`[文件监听] 停止监听: ${normalizedPath}`);
          }
        } catch (error) {
          console.error('[文件监听] 停止监听失败:', error);
        }
      }

      // 🚀 初始化数据盘驱动器到文件树
      async function initializeDataDrivesInFileTree(includeSystemDrive = false) {
        try {
          if (!window.electronAPI || !window.electronAPI.getDataDrives) {
            console.log('[文件树] getDataDrives API 不可用');
            return;
          }

          console.log(`[文件树] 获取驱动器列表，包含系统盘: ${includeSystemDrive}`);
          const result = await window.electronAPI.getDataDrives({ includeSystemDrive });
          if (!result.success || !result.drives || result.drives.length === 0) {
            console.log('[文件树] 没有可用的驱动器');
            return;
          }

          console.log(`[文件树] 发现 ${result.drives.length} 个驱动器:`, result.drives);

          // 🔧 保存驱动器节点到持久变量
          persistentDriveNodes = [];
          for (const drive of result.drives) {
            persistentDriveNodes.push({
              name: drive.name,
              path: drive.path,
              type: 'drive',
              expanded: false,
              level: 0,
              file: null,
              childrenLoaded: false,
              loadingChildren: false,
              isLocalDrive: true,
              size: 0
            });
          }
          console.log(`[文件树] 已保存 ${persistentDriveNodes.length} 个驱动器到 persistentDriveNodes`);

          // 清空现有驱动器节点并重新添加
          // 找到所有驱动器节点并移除
          for (let i = fileTreeHierarchy.length - 1; i >= 0; i--) {
            if (fileTreeHierarchy[i].type === 'drive') {
              fileTreeHierarchy.splice(i, 1);
            }
          }

          // 添加驱动器节点到文件树开头（修复：避免重复添加）
          fileTreeHierarchy.unshift(...persistentDriveNodes);

          // 🔧 确保 C 盘存在（如果包含系统盘参数）
          if (includeSystemDrive) {
            const hasCDrive = persistentDriveNodes.some(d => d.name === 'C:');
            if (!hasCDrive) {
              // 直接添加 C 盘（Windows 系统通常都有 C 盘）
              const cDriveNode = {
                name: 'C:',
                path: 'C:\\',
                type: 'drive',
                expanded: false,
                level: 0,
                file: null,
                childrenLoaded: false,
                loadingChildren: false,
                isLocalDrive: true,
                size: 0
              };
              fileTreeHierarchy.unshift(cDriveNode);
              persistentDriveNodes.unshift(cDriveNode);
              console.log('[文件树] 已添加 C 盘到文件树');
            }
          }

          // 渲染文件树
          renderFileTree();
          console.log(`[文件树] 已加载 ${result.drives.length} 个驱动器`);
        } catch (error) {
          console.error('[文件树] 初始化驱动器失败:', error);
        }
      }

      // 🚀 刷新驱动器列表（包含所有盘符）
      async function refreshDrivesIncludeAll() {
        await initializeDataDrivesInFileTree(true);
        showMessage('已刷新所有驱动器（包括 C 盘）');
      }

      // 🚀 刷新驱动器列表（仅数据盘）
      async function refreshDrivesDataOnly() {
        await initializeDataDrivesInFileTree(false);
        showMessage('已刷新数据盘（D 盘及以后）');
      }

      // =====================================================================
      // 🚀 远程目录功能
      // =====================================================================

      // 初始化远程目录事件
      function initializeRemoteDirectoryEvents() {
        if (!remoteConnectBtn) return;

        // 🚀 本地共享按钮点击
        if (localShareBtn) {
          localShareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showLocalShareDialog();
          });
        }

        // 本地共享对话框关闭按钮
        if (localShareDialogClose) {
          localShareDialogClose.addEventListener('click', hideLocalShareDialog);
        }

        // 本地共享取消按钮
        if (localShareCancel) {
          localShareCancel.addEventListener('click', hideLocalShareDialog);
        }

        // 本地共享确认按钮
        if (localShareConfirm) {
          localShareConfirm.addEventListener('click', handleStartLocalShare);
        }

        // 本地共享对话框遮罩点击关闭
        if (localShareDialog) {
          localShareDialog.addEventListener('click', (e) => {
            if (e.target === localShareDialog) {
              hideLocalShareDialog();
            }
          });
        }

        // 停止本地共享按钮
        if (stopLocalShareBtn) {
          stopLocalShareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleStopLocalShare();
          });
        }

        // 连接按钮点击
        remoteConnectBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showRemoteConnectDialog();
        });

        // 对话框关闭按钮
        if (remoteConnectDialogClose) {
          remoteConnectDialogClose.addEventListener('click', hideRemoteConnectDialog);
        }

        // 取消按钮
        if (remoteConnectCancel) {
          remoteConnectCancel.addEventListener('click', hideRemoteConnectDialog);
        }

        // 确认连接按钮
        if (remoteConnectConfirm) {
          remoteConnectConfirm.addEventListener('click', handleRemoteConnect);
        }

        // 对话框遮罩点击关闭
        if (remoteConnectDialog) {
          remoteConnectDialog.addEventListener('click', (e) => {
            if (e.target === remoteConnectDialog) {
              hideRemoteConnectDialog();
            }
          });
        }

        // 输入框回车快捷键
        if (remoteConnectIp) {
          remoteConnectIp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              remoteConnectPort?.focus();
            }
          });
        }
        if (remoteConnectPort) {
          remoteConnectPort.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              remoteConnectPath?.focus();
            }
          });
        }
        if (remoteConnectPath) {
          remoteConnectPath.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              remoteConnectName?.focus();
            }
          });
        }
        if (remoteConnectName) {
          remoteConnectName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleRemoteConnect();
            }
          });
        }

        // 检查本地共享状态（页面加载时）
        checkLocalShareStatus();
      }

      // =====================================================================
      // 🚀 本地共享功能
      // =====================================================================

      // 显示本地共享对话框
      function showLocalShareDialog() {
        if (!localShareDialog) return;

        // 清空输入框
        if (localSharePath) localSharePath.value = '';
        if (localSharePort) localSharePort.value = '8080';

        // 显示对话框
        localShareDialog.classList.add('visible');

        // 聚焦路径输入框
        setTimeout(() => {
          localSharePath?.focus();
        }, 100);
      }

      // 隐藏本地共享对话框
      function hideLocalShareDialog() {
        if (!localShareDialog) return;
        localShareDialog.classList.remove('visible');
      }

      // 启动本地共享
      async function handleStartLocalShare() {
        const sharePath = localSharePath?.value.trim() || '';
        const port = parseInt(localSharePort?.value.trim(), 10) || 8080;

        // 显示启动中状态
        if (localShareConfirm) {
          localShareConfirm.disabled = true;
          localShareConfirm.textContent = '启动中...';
        }

        try {
          console.log(`[本地共享] 启动服务器: path="${sharePath}", port=${port}`);

          const result = await window.electronAPI.startLocalShare({ sharePath, port });

          if (result.success) {
            localShareRunning = true;

            // 显示共享状态
            updateLocalShareStatus(result);

            // 隐藏对话框
            hideLocalShareDialog();

            showMessage(`本地共享已启动: ${result.ip}:${result.port}`);
            console.log('[本地共享] 启动成功', result);
          } else {
            showMessage(`启动失败: ${result.error || '未知错误'}`, 'error');
          }
        } catch (error) {
          console.error('[本地共享] 启动异常:', error);
          showMessage(`启动异常: ${error.message}`, 'error');
        } finally {
          // 恢复按钮状态
          if (localShareConfirm) {
            localShareConfirm.disabled = false;
            localShareConfirm.textContent = '启动共享';
          }
        }
      }

      // 停止本地共享
      async function handleStopLocalShare() {
        if (!confirm('确定要停止本地共享吗？')) {
          return;
        }

        try {
          const result = await window.electronAPI.stopLocalShare();

          if (result.success) {
            localShareRunning = false;

            // 隐藏共享状态
            if (localShareStatus) {
              localShareStatus.style.display = 'none';
            }

            showMessage('本地共享已停止');
            console.log('[本地共享] 已停止');
          } else {
            showMessage(`停止失败: ${result.error || '未知错误'}`, 'error');
          }
        } catch (error) {
          console.error('[本地共享] 停止异常:', error);
          showMessage(`停止异常: ${error.message}`, 'error');
        }
      }

      // 检查本地共享状态
      async function checkLocalShareStatus() {
        try {
          const result = await window.electronAPI.getLocalShareStatus();

          if (result && result.success) {
            localShareRunning = true;
            updateLocalShareStatus(result);
          }
        } catch (error) {
          console.error('[本地共享] 检查状态失败:', error);
        }
      }

      // 更新本地共享状态显示
      function updateLocalShareStatus(info) {
        if (!localShareStatus) return;

        const addressEl = localShareStatus.querySelector('.share-address');
        if (addressEl) {
          addressEl.textContent = `${info.ip}:${info.port}`;
        }

        localShareStatus.style.display = 'flex';
      }

      // 显示远程连接对话框
      function showRemoteConnectDialog() {
        if (!remoteConnectDialog) return;

        // 清空输入框
        if (remoteConnectIp) remoteConnectIp.value = '';
        if (remoteConnectPort) remoteConnectPort.value = '8080';
        if (remoteConnectPath) remoteConnectPath.value = '';
        if (remoteConnectName) remoteConnectName.value = '';

        // 显示对话框
        remoteConnectDialog.classList.add('visible');

        // 聚焦IP地址输入框
        setTimeout(() => {
          remoteConnectIp?.focus();
        }, 100);
      }

      // 隐藏远程连接对话框
      function hideRemoteConnectDialog() {
        if (!remoteConnectDialog) return;
        remoteConnectDialog.classList.remove('visible');
      }

      // 处理远程连接
      async function handleRemoteConnect() {
        if (!remoteConnectIp || !remoteConnectPort) return;

        const ip = remoteConnectIp.value.trim();
        const port = parseInt(remoteConnectPort.value.trim(), 10) || 8080;
        const remotePath = remoteConnectPath?.value.trim() || '';
        const customName = remoteConnectName?.value.trim();

        if (!ip) {
          showMessage('请输入IP地址', 'error');
          return;
        }

        // 验证IP地址格式
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(ip)) {
          showMessage('IP地址格式不正确', 'error');
          return;
        }

        // 显示连接中状态
        if (remoteConnectConfirm) {
          remoteConnectConfirm.disabled = true;
          remoteConnectConfirm.textContent = '连接中...';
        }

        try {
          // 测试连接
          console.log(`[远程连接] 正在连接到 ${ip}:${port}...`);
          const result = await window.electronAPI.connectRemote({ ip, port, remotePath });

          if (result.success) {
            // 连接成功，添加远程节点
            const connectionId = Date.now();
            const displayName = customName || `${ip}:${port}`;

            const remoteNode = {
              id: connectionId,
              ip,
              port,
              remotePath,
              name: displayName,
              expanded: false,
              type: 'remote',
              isRemote: true,
              childrenLoaded: false,
              loadingChildren: false,
              children: {
                directories: result.directories || [],
                files: result.files || []
              }
            };

            remoteConnections.push(remoteNode);
            renderRemoteDirectoryList();

            // 隐藏对话框
            hideRemoteConnectDialog();

            showMessage(`已连接到远程目录: ${displayName}`);

            console.log(`[远程连接] 连接成功: ${displayName}`, remoteNode);
          } else {
            showMessage(`连接失败: ${result.error || '未知错误'}`, 'error');
          }
        } catch (error) {
          console.error('[远程连接] 连接异常:', error);
          showMessage(`连接异常: ${error.message}`, 'error');
        } finally {
          // 恢复按钮状态
          if (remoteConnectConfirm) {
            remoteConnectConfirm.disabled = false;
            remoteConnectConfirm.textContent = '连接';
          }
        }
      }

      // 渲染远程目录列表
      function renderRemoteDirectoryList() {
        if (!remoteDirectoryList) return;

        if (remoteConnections.length === 0) {
          remoteDirectoryList.innerHTML = '';
          return;
        }

        const html = remoteConnections.map(conn => {
          const statusClass = conn.childrenLoaded ? 'connected' : 'disconnected';
          const statusText = conn.childrenLoaded ? '已加载' : '未展开';

          return `
            <div class="remote-node" data-id="${conn.id}">
              <span class="remote-node-icon">☁️</span>
              <span class="remote-node-name" title="${conn.name} (${conn.ip}:${conn.port})">${conn.name}</span>
              <span class="remote-node-status ${statusClass}">${statusText}</span>
              <button class="remote-node-close" data-id="${conn.id}" title="断开连接">×</button>
            </div>
          `;
        }).join('');

        remoteDirectoryList.innerHTML = html;

        // 绑定点击事件
        remoteDirectoryList.querySelectorAll('.remote-node').forEach(node => {
          node.addEventListener('click', (e) => {
            // 如果点击的是关闭按钮，不触发选中
            if (e.target.classList.contains('remote-node-close')) return;

            const id = parseInt(node.dataset.id, 10);
            handleRemoteNodeClick(id);
          });
        });

        // 绑定关闭按钮事件
        remoteDirectoryList.querySelectorAll('.remote-node-close').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id, 10);
            disconnectRemote(id);
          });
        });
      }

      // 处理远程节点点击
      async function handleRemoteNodeClick(connectionId) {
        const conn = remoteConnections.find(c => c.id === connectionId);
        if (!conn) return;

        // 高亮选中
        remoteDirectoryList.querySelectorAll('.remote-node').forEach(node => {
          node.classList.remove('selected');
        });
        const nodeEl = remoteDirectoryList.querySelector(`.remote-node[data-id="${connectionId}"]`);
        if (nodeEl) nodeEl.classList.add('selected');

        // 如果还没加载子项，尝试加载
        if (!conn.childrenLoaded) {
          await loadRemoteDirectoryChildren(connectionId);
        } else {
          // 已经加载过，切换展开状态
          conn.expanded = !conn.expanded;
          renderRemoteDirectoryList();

          // 将远程节点内容添加到文件树
          if (conn.expanded) {
            addRemoteToFileTree(connectionId);
          } else {
            removeRemoteFromFileTree(connectionId);
          }
        }
      }

      // 加载远程目录子项
      async function loadRemoteDirectoryChildren(connectionId) {
        const conn = remoteConnections.find(c => c.id === connectionId);
        if (!conn || conn.loadingChildren) return;

        conn.loadingChildren = true;
        renderRemoteDirectoryList();

        try {
          const result = await window.electronAPI.connectRemote({
            ip: conn.ip,
            port: conn.port,
            remotePath: conn.remotePath
          });

          if (result.success) {
            conn.children = {
              directories: result.directories || [],
              files: result.files || []
            };
            conn.childrenLoaded = true;
            conn.expanded = true;

            // 添加到文件树
            addRemoteToFileTree(connectionId);
          } else {
            showMessage(`加载远程目录失败: ${result.error || '未知错误'}`, 'error');
          }
        } catch (error) {
          console.error('[远程连接] 加载子项失败:', error);
          showMessage(`加载失败: ${error.message}`, 'error');
        } finally {
          conn.loadingChildren = false;
          renderRemoteDirectoryList();
        }
      }

      // 将远程节点添加到文件树
      function addRemoteToFileTree(connectionId) {
        const conn = remoteConnections.find(c => c.id === connectionId);
        if (!conn || !conn.childrenLoaded) return;

        // 创建远程节点数据
        const remoteNode = {
          name: conn.name,
          path: `remote://${conn.ip}:${conn.port}/${conn.remotePath}`,
          type: 'folder',
          isRemote: true,
          remoteId: connectionId,
          remotePath: conn.remotePath,
          expanded: conn.expanded,
          level: 0,
          file: null,
          childrenLoaded: conn.childrenLoaded,
          loadingChildren: false,
          isLocalDrive: false,
          children: conn.children,
          size: 0
        };

        // 查找驱动器节点的位置，在驱动器后面插入远程节点
        const driveIndex = fileTreeHierarchy.findIndex(item => item.type === 'drive');
        const insertIndex = driveIndex >= 0 ? driveIndex + persistentDriveNodes.length : 0;

        // 检查是否已存在该远程节点
        const existingIndex = fileTreeHierarchy.findIndex(
          item => item.isRemote && item.remoteId === connectionId
        );

        if (existingIndex >= 0) {
          // 已存在，更新状态
          fileTreeHierarchy[existingIndex] = remoteNode;
        } else {
          // 不存在，插入到文件树
          // 先移除可能存在的旧远程节点
          fileTreeHierarchy = fileTreeHierarchy.filter(
            item => !(item.isRemote && item.remoteId === connectionId)
          );

          // 插入到驱动器后面
          fileTreeHierarchy.splice(insertIndex, 0, remoteNode);
        }

        renderFileTree();
      }

      // 从文件树移除远程节点
      function removeRemoteFromFileTree(connectionId) {
        fileTreeHierarchy = fileTreeHierarchy.filter(
          item => !(item.isRemote && item.remoteId === connectionId)
        );
        renderFileTree();
      }

      // 断开远程连接
      function disconnectRemote(connectionId) {
        const conn = remoteConnections.find(c => c.id === connectionId);
        if (!conn) return;

        // 从文件树移除
        removeRemoteFromFileTree(connectionId);

        // 从列表移除
        const index = remoteConnections.findIndex(c => c.id === connectionId);
        if (index >= 0) {
          remoteConnections.splice(index, 1);
        }

        renderRemoteDirectoryList();
        showMessage(`已断开远程目录: ${conn.name}`);
      }

      // Ctrl+G：显示/隐藏"悬浮文件树框"
      function showFloatingFileTree() {
        // 需求：悬浮文件树打开后，左侧停靠文件树默认折叠
        // 这里强制记为“进入前停靠视为折叠”，从而关闭悬浮树后也保持折叠
        wasDockedFileTreeVisible = false;

        isFileTreeFloating = true;

        // 确保可见并切换为悬浮样式
        fileTreeContainer.classList.add("visible");
        fileTreeContainer.classList.add("floating");
        if (fileTreeFloatingOverlay) fileTreeFloatingOverlay.classList.add("visible");

        // 清空搜索框内容
        fileTreeSearch.value = "";
        fileTreeSearchTerm = "";
        filterFileTree();

        // 新需求：Ctrl+G 弹出时宽度尽可能最大化（贴近左右边距）
        const maxWidth = Math.max(260, window.innerWidth - 40);
        fileTreeFloatingWidthPx = maxWidth;
        syncFloatingFileTreeCssWidth();
        fileTreeContainer.style.width = maxWidth + "px";

        // 悬浮模式不挤压主内容区
        updateLayout();

        // 聚焦搜索框，便于快速筛选
        if (fileTreeSearch) fileTreeSearch.focus();
      }

      function hideFileTreeContextMenu() {
        if (!fileTreeContextMenu) return;
        fileTreeContextMenu.classList.remove("visible");
        fileTreeContextMenuIndex = -1;
      }

      function showFileTreeContextMenu(clientX, clientY, index) {
        if (!fileTreeContextMenu) return;

        fileTreeContextMenuIndex = index;

        // 判断是否为空白区域右键（index === -1）
        const isBlankArea = index === -1;
        const item = isBlankArea ? null : fileTreeHierarchy[index];

        if (!isBlankArea && !item) return;

        // 控制各菜单项的显示/禁用状态
        if (fileTreeCtxLoadOnlyDir) {
          if (isBlankArea) {
            fileTreeCtxLoadOnlyDir.style.display = "none";  // 空白区域隐藏
          } else {
            fileTreeCtxLoadOnlyDir.style.display = "";
            // "只加载此目录"：folder 直接用自身；file 用父目录
            const canLoadOnlyDir = (() => {
              if (!item.path) return false;
              if (item.type === "folder") return true;
              const parts = String(item.path).split("/");
              return parts.length > 1;
            })();
            fileTreeCtxLoadOnlyDir.disabled = !canLoadOnlyDir;
          }
        }

        // "刷新此目录"对所有目录和驱动器启用
        if (fileTreeCtxRefreshDir) {
          if (isBlankArea) {
            fileTreeCtxRefreshDir.style.display = "none";  // 空白区域隐藏
          } else {
            fileTreeCtxRefreshDir.style.display = "";
            // 支持文件夹、驱动器、以及压缩包内的文件夹
            const canRefreshDir = (item.type === "folder" || item.type === "drive") && item.isLocalDrive;
            fileTreeCtxRefreshDir.disabled = !canRefreshDir;
          }
        }

        // "解压到当前路径"已禁用，始终隐藏
        if (fileTreeCtxExtractArchive) {
          fileTreeCtxExtractArchive.style.display = "none";
        }

        // "复制名称"只在选中文件时显示
        if (fileTreeCtxCopyName) {
          fileTreeCtxCopyName.style.display = isBlankArea ? "none" : "";
        }

        // 🚀 "打开HTML文件"只对HTML文件显示
        if (fileTreeCtxOpenHtml) {
          if (isBlankArea || !item || item.type !== 'file') {
            fileTreeCtxOpenHtml.style.display = "none";  // 非文件或空白区域隐藏
          } else {
            // 检测是否为HTML文件
            const fileName = (item.name || '').toLowerCase();
            const isHtmlFile = fileName.endsWith('.html') ||
                               fileName.endsWith('.htm') ||
                               fileName.endsWith('.xhtml') ||
                               fileName.endsWith('.html5');
            fileTreeCtxOpenHtml.style.display = isHtmlFile ? "" : "none";
          }
        }

        // 定位（做边界修正）
        fileTreeContextMenu.classList.add("visible");
        const rect = fileTreeContextMenu.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 8;
        const maxY = window.innerHeight - rect.height - 8;
        const x = Math.max(8, Math.min(maxX, clientX));
        const y = Math.max(8, Math.min(maxY, clientY));
        fileTreeContextMenu.style.left = x + "px";
        fileTreeContextMenu.style.top = y + "px";
      }

      function hideLogContextMenu() {
        if (!logContextMenu) return;
        logContextMenu.classList.remove("visible");
        logContextMenuSelectedText = "";
        logContextMenuLineIndex = -1;
        logContextMenuFilePath = "";
        logContextMenuLineContent = "";
      }

      // 检测并解析CSV格式
      function detectAndParseCSV() {
        // 收集所有非文件头行
        const lines = [];
        for (let i = 0; i < originalLines.length; i++) {
          const line = originalLines[i];
          if (line && !line.startsWith("===")) {
            lines.push(line);
          }
        }

        if (lines.length === 0) {
          console.log('没有可解析的内容');
          return null;
        }

        // 检测CSV格式：检查前几行是否包含逗号分隔
        const sampleLines = lines.slice(0, Math.min(10, lines.length));
        let commaCount = 0;
        let totalLines = sampleLines.length;

        for (const line of sampleLines) {
          const commas = (line.match(/,/g) || []).length;
          if (commas >= 2) { // 至少有2个逗号才认为是CSV
            commaCount++;
          }
        }

        // 如果超过70%的行有多个逗号，认为是CSV
        if (commaCount / totalLines < 0.7) {
          console.log('不是CSV格式');
          return null;
        }

        console.log(`检测到CSV格式，共${lines.length}行`);
        return lines; // 返回原始行，由新渲染器处理
      }

      // 解析CSV单行（处理引号包裹的字段）
      function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          const nextChar = line[i + 1];

          if (char === '"') {
            if (inQuotes && nextChar === '"') {
              // 转义的引号
              current += '"';
              i++;
            } else {
              // 切换引号状态
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            // 字段分隔符
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }

        // 添加最后一个字段
        result.push(current.trim());

        return result;
      }

      // 显示CSV表格面板（使用Canvas渲染器）
      async function showCSVTablePanel(csvData) {
        const panel = document.getElementById('csvTablePanel');
        const placeholder = document.getElementById('csvTablePlaceholder');

        if (!panel || !placeholder) {
          console.error('CSV表格面板元素未找到');
          return;
        }

        // 重置面板为默认大小
        panel.classList.remove('fullscreen');
        panel.style.width = "80vw";
        panel.style.height = "70vh";
        panel.style.top = "50%";
        panel.style.left = "50%";
        panel.style.transform = "translate(-50%, -50%)";

        // 隐藏占位符
        placeholder.style.display = 'none';

        // 使用 Canvas 渲染器
        if (!window.CSVTableRenderer) {
          console.error('[showCSVTablePanel] CSVTableRenderer 未加载，请刷新页面');
          alert('CSV渲染器未加载，请刷新页面');
          return;
        }

        if (csvData.length === 0) {
          console.warn('[showCSVTablePanel] CSV 数据为空');
          return;
        }

        try {
          await window.CSVTableRenderer.show(csvData, {
            visibleColumns: 15  // 默认只显示前15列
          });
          console.log('[showCSVTablePanel] Canvas 渲染完成');
        } catch (error) {
          console.error('[showCSVTablePanel] 渲染失败:', error);
          throw error;
        }
      }

      function showLogContextMenu(clientX, clientY, selectedText, lineElement) {
        if (!logContextMenu) return;
        logContextMenuSelectedText = String(selectedText || "");
        const selectedOneLine = logContextMenuSelectedText.replace(/\r/g, "").split("\n")[0].trim();

        // 获取当前行信息
        logContextMenuLineIndex = -1;
        logContextMenuFilePath = "";
        logContextMenuLineContent = "";
        
        if (lineElement) {
          logContextMenuLineIndex = getLineIndexFromElement(lineElement);
          if (logContextMenuLineIndex >= 0 && logContextMenuLineIndex < originalLines.length) {
            logContextMenuFilePath = getFileNameForLineIndex(logContextMenuLineIndex) || "";
            logContextMenuLineContent = originalLines[logContextMenuLineIndex] || "";
          }
        }

        // 标题显示当前选中词（截断）
        if (logContextMenuTitle) {
          const t = selectedOneLine;
          logContextMenuTitle.textContent = t ? `关键词: ${t.slice(0, 60)}` : "日志";
          logContextMenuTitle.title = t ? t : "日志";
        }

        // 显示文件信息
        if (logCtxFileInfo && logCtxFileName) {
          if (logContextMenuFilePath) {
            const parts = String(logContextMenuFilePath).split(/[\/\\]/);
            const baseName = parts[parts.length - 1] || logContextMenuFilePath;
            logCtxFileName.textContent = baseName;
            logCtxFileName.title = logContextMenuFilePath;
            logCtxFileInfo.style.display = "block";
          } else {
            logCtxFileInfo.style.display = "none";
          }
        }

        // 复制相关按钮状态
        // 定位（做边界修正）
        logContextMenu.classList.add("visible");
        const rect = logContextMenu.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 8;
        const maxY = window.innerHeight - rect.height - 8;
        const x = Math.max(8, Math.min(maxX, clientX));
        const y = Math.max(8, Math.min(maxY, clientY));
        logContextMenu.style.left = x + "px";
        logContextMenu.style.top = y + "px";
      }

      function getSelectedTextWithinLogContainer() {
        try {
          const sel = window.getSelection ? window.getSelection() : null;
          if (!sel || sel.rangeCount === 0) return "";
          const text = String(sel.toString() || "");
          if (!text) return "";
          const range = sel.getRangeAt(0);
          const node = range.commonAncestorContainer;
          const el = node && node.nodeType === 1 ? node : node?.parentElement;
          if (!el) return "";
          if (!outer || !outer.contains(el)) return "";
          return text;
        } catch (_) {
          return "";
        }
      }

      function rerenderAfterHighlightChangePreserveScroll(updateFilterPanel = true) {
        const top = outer ? outer.scrollTop : 0;
        const left = outer ? outer.scrollLeft : 0;
        renderLogLines();
        if (updateFilterPanel) {
          updateFilteredPanel();
        }
        requestAnimationFrame(() => {
          if (!outer) return;
          outer.scrollTop = top;
          outer.scrollLeft = left;
          try { forceUpdateVisibleLines(); } catch (_) {}
        });
      }

      async function loadRemoteFilesByPaths(filePaths) {
        const sessionId = ++currentLoadingSession;
        const paths = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
        if (paths.length === 0) return;

        // 清空现有内容
        originalLines = [];
        fileHeaders = [];
        currentFiles = [];
        // 🚀 性能优化：清空HTML解析缓存，释放内存
        clearHtmlParseCache();

        progressBar.style.display = "block";
        progressFill.style.width = "0%";
        setButtonsDisabled(true);

        let loadedCount = 0;
        const totalFiles = paths.length;

        try {
          for (let i = 0; i < paths.length; i++) {
            if (sessionId !== currentLoadingSession) return;
            const p = String(paths[i]);
            const content = await loadServerFile(p);
            if (sessionId !== currentLoadingSession) return;

            if (content !== null) {
              const headerIndex = originalLines.length;
              const lines = String(content).split("\n");
              fileHeaders.push({
                fileName: p,
                lineCount: lines.length,
                startIndex: headerIndex,
              });
              // 🚀 不转义HTML，直接使用原始内容
              originalLines.push(`=== 文件: ${p} (${lines.length} 行) ===`);
              // 保持内容原封不动，不进行转义

              // 🚀 性能优化：避免 forEach + push 导致的主线程阻塞
              const startIndex = originalLines.length;
              originalLines.length += lines.length;
              for (let i = 0; i < lines.length; i++) {
                originalLines[startIndex + i] = lines[i];
              }

              loadedCount++;
            }

            progressFill.style.width = ((i + 1) / totalFiles) * 100 + "%";
          }

          if (sessionId !== currentLoadingSession) return;
          resetFilter(false);
          renderLogLines();
          selectedOriginalIndex = -1;
          showMessage(`已刷新 ${loadedCount} 个远程文件`);
        } catch (error) {
          if (sessionId !== currentLoadingSession) return;
          console.error("按路径刷新远程文件失败:", error);
          showMessage("刷新远程文件失败: " + (error?.message || error));
        } finally {
          if (sessionId === currentLoadingSession) {
            progressBar.style.display = "none";
            setButtonsDisabled(false);
            showLoading(false);
          }
        }
      }

      async function refreshCurrentOpenedFilesPreserveScroll() {
        const top = outer ? outer.scrollTop : 0;
        const left = outer ? outer.scrollLeft : 0;

        const visibleSelectedFiles = selectedFiles.filter((fileObj) =>
          isFileTreeIndexVisible(fileObj.index)
        );
        const hasSelectedRemote = visibleSelectedFiles.some((fileObj) => {
          const item = fileTreeHierarchy[fileObj.index];
          return !!(item && item.type === "file" && (item.isRemote || item.remotePath));
        });

        try {
          if (isServerMode && hasSelectedRemote) {
            await loadSelectedRemoteFiles();
          } else if (isServerMode && Array.isArray(fileHeaders) && fileHeaders.length > 0) {
            const paths = fileHeaders.map((h) => h && h.fileName).filter(Boolean);
            await loadRemoteFilesByPaths(paths);
          } else if (Array.isArray(currentFiles) && currentFiles.length > 0) {
            await loadMultipleFiles(currentFiles);
          } else {
            showMessage("没有可刷新的打开文件（请先加载文件）");
            return;
          }
        } finally {
          requestAnimationFrame(() => {
            if (!outer) return;
            outer.scrollTop = top;
            outer.scrollLeft = left;
            try { forceUpdateVisibleLines(); } catch (_) {}
          });
        }
      }

      function initLogContentContextMenu() {
        if (!outer || !logContextMenu) return;

        outer.addEventListener("contextmenu", (e) => {
          if (isEditableElement(e.target)) return;
          try { hideFileTreeContextMenu(); } catch (_) {}
          e.preventDefault();
          e.stopPropagation();
          const selectedText = getSelectedTextWithinLogContainer();
          // 获取当前右键点击的行元素
          const lineElement = e.target.closest(".log-line, .file-header");
          showLogContextMenu(e.clientX, e.clientY, selectedText, lineElement);
        });

        if (logCtxRefreshOpenFiles) {
          logCtxRefreshOpenFiles.addEventListener("click", async () => {
            hideLogContextMenu();
            clearMainLogContent();
            // 🆕 刷新后自动展开文件树
            if (typeof restoreFileTreePanel === 'function') {
              restoreFileTreePanel();
            }
          });
        }

        // 导入文件
        if (logCtxImportFile) {
          logCtxImportFile.addEventListener("click", () => {
            importFileInput.click();
            hideLogContextMenu();
          });
        }

        // 导入文件夹
        if (logCtxImportFolder) {
          logCtxImportFolder.addEventListener("click", () => {
            importFolderInput.click();
            hideLogContextMenu();
          });
        }
        
        // 导入压缩包
        if (logCtxImportArchive) {
          logCtxImportArchive.addEventListener("click", () => {
            importArchiveInput.click();
            hideLogContextMenu();
          });
        }

        // 新建窗口
        const logCtxNewWindow = document.getElementById("logCtxNewWindow");
        if (logCtxNewWindow) {
          logCtxNewWindow.addEventListener("click", () => {
            hideLogContextMenu();
            createNewWindow();
          });
        }

        // 串口日志
        const logCtxUartLog = document.getElementById("logCtxUartLog");
        if (logCtxUartLog) {
          logCtxUartLog.addEventListener("click", () => {
            hideLogContextMenu();
            openUartLogWindow();
          });
        }

        // 最小化所有窗口
        const logCtxMinimizeAll = document.getElementById("logCtxMinimizeAll");
        if (logCtxMinimizeAll) {
          logCtxMinimizeAll.addEventListener("click", () => {
            hideLogContextMenu();
            console.log('minimizeAll clicked', { electronAPI: typeof window.electronAPI });

            if (typeof window.electronAPI === 'undefined') {
              console.error('electronAPI is not available for minimizeAll');
              alert('无法最小化窗口：electronAPI 不可用。');
              return;
            }

            if (!window.electronAPI.windowControl) {
              console.error('electronAPI.windowControl is not available');
              alert('无法最小化窗口：windowControl 不可用。');
              return;
            }

            try {
              window.electronAPI.windowControl.minimizeAll();
              console.log('Minimize all windows command sent');
            } catch (error) {
              console.error('Error minimizing all windows:', error);
              alert('最小化窗口时出错：' + error.message);
            }
          });
        }

        // 打开终端
        if (logCtxOpenTerminal) {
          logCtxOpenTerminal.addEventListener("click", async () => {
            hideLogContextMenu();

            // 调用主进程打开 WezTerm 终端（不指定目录）
            try {
              if (window.electronAPI && window.electronAPI.openTerminal) {
                const result = await window.electronAPI.openTerminal();
                if (!result.success) {
                  showMessage(`打开终端失败: ${result.error}`);
                }
              } else {
                showMessage("electronAPI 不可用");
              }
            } catch (error) {
              console.error("打开终端失败:", error);
              showMessage(`打开终端失败: ${error.message}`);
            }
          });
        }

        // Vlog解析为CSV表格按钮事件
        const logCtxParseVlog = document.getElementById("logCtxParseVlog");
        if (logCtxParseVlog) {
          logCtxParseVlog.addEventListener("click", async () => {
            try {
              console.log('[VlogParser] 开始解析vlog');
              hideLogContextMenu();

              // 获取当前日志内容
              if (!originalLines || originalLines.length === 0) {
                showMessage('没有可解析的日志内容');
                return;
              }

              // 检查是否为vlog格式
              const content = originalLines.join('\n');
              const parser = new window.VlogParser();

              if (!parser.isVlogFormat(content)) {
                showMessage('当前内容不是vlog格式，无法解析');
                return;
              }

              showMessage('正在解析vlog数据...');

              // 解析vlog数据
              const result = parser.parse(content);

              if (!result.success) {
                showMessage('解析失败: ' + result.error);
                return;
              }

              console.log(`[VlogParser] 解析成功: ${result.recordCount} 条记录`);

              // 转换为CSV格式
              const csvContent = parser.toCSV(result.data);

              // 显示CSV表格面板
              await showCSVTablePanel(csvContent);

              showMessage(`✓ 成功解析 ${result.recordCount} 条vlog记录`);

            } catch (error) {
              console.error('[VlogParser] 解析错误:', error);
              showMessage('Vlog解析出错: ' + error.message);
            }
          });
        }

        // CSV表格视图按钮事件
        const logCtxViewAsTable = document.getElementById("logCtxViewAsTable");
        if (logCtxViewAsTable) {
          logCtxViewAsTable.addEventListener("click", async () => {
            try {
              console.log('打开CSV表格视图');
              hideLogContextMenu();

              // 检查当前内容是否为CSV格式
              const csvContent = detectAndParseCSV();
              if (!csvContent) {
                showMessage('当前内容不是CSV格式，无法以表格形式查看');
                return;
              }

              // 显示CSV表格面板
              await showCSVTablePanel(csvContent);
            } catch (error) {
              console.error('CSV表格视图错误:', error);
              showMessage('CSV表格视图出错: ' + error.message);
            }
          });
        }

        // CSV表格面板关闭按钮
        const csvTableCloseBtn = document.getElementById("csvTableCloseBtn");
        if (csvTableCloseBtn) {
          csvTableCloseBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const csvTablePanel = document.getElementById("csvTablePanel");
            if (csvTablePanel) {
              csvTablePanel.classList.remove("visible");
              csvTablePanel.style.display = "none";
            }
          });
        }

        // CSV表格面板头部双击最大化/还原
        const csvTablePanelHeader = document.getElementById("csvTablePanelHeader");
        if (csvTablePanelHeader) {
          csvTablePanelHeader.addEventListener("dblclick", () => {
            const csvTablePanel = document.getElementById("csvTablePanel");
            if (csvTablePanel) {
              if (csvTablePanel.classList.contains("fullscreen")) {
                // 还原
                csvTablePanel.classList.remove("fullscreen");
                csvTablePanel.style.width = "80vw";
                csvTablePanel.style.height = "70vh";
                csvTablePanel.style.top = "50%";
                csvTablePanel.style.left = "50%";
                csvTablePanel.style.transform = "translate(-50%, -50%)";
              } else {
                // 最大化
                csvTablePanel.classList.add("fullscreen");
                csvTablePanel.style.width = "100vw";
                csvTablePanel.style.height = "100vh";
                csvTablePanel.style.top = "0";
                csvTablePanel.style.left = "0";
                csvTablePanel.style.transform = "none";
              }
              // 等待 CSS transition 完成（150ms）后重置 Canvas
              setTimeout(() => {
                if (window.resetCSVCanvas) {
                  window.resetCSVCanvas();
                }
              }, 150);
            }
          });
        }

        // 压缩包输入框变更事件
        if (importArchiveInput) {
          importArchiveInput.addEventListener("change", async (e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              for (const file of files) {
                await processArchiveFile(file);
              }
              // 清空输入框，允许再次选择相同文件
              importArchiveInput.value = "";
            }
          });
        }

        // 点击空白/滚动/窗口变化时关闭
        document.addEventListener("click", (e) => {
          if (!logContextMenu.classList.contains("visible")) return;
          if (logContextMenu.contains(e.target)) return;
          hideLogContextMenu();
        });
        document.addEventListener("scroll", () => hideLogContextMenu(), true);
        window.addEventListener("resize", () => hideLogContextMenu());
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape") hideLogContextMenu();
        });
      }

      // 初始化过滤结果框右键菜单
      // 新增：初始化展开过滤输入框功能
      function initExpandFilter() {
        const expandFilterBtn = document.getElementById('expandFilterBtn');
        const filterDialog = document.getElementById('filterDialog');
        const closeFilterDialog = document.getElementById('closeFilterDialog');
        const filterDialogTextarea = document.getElementById('filterDialogTextarea');
        const applyFilterDialog = document.getElementById('applyFilterDialog');
        const clearFilterDialog = document.getElementById('clearFilterDialog');
        const currentFilterKeywords = document.getElementById('currentFilterKeywords');
        const filterBox = DOMCache.get('filterBox');
        const filterHistorySuggestions = document.getElementById('filterHistorySuggestions');
        const filterHistoryList = document.getElementById('filterHistoryList');

        let selectedHistoryIndex = -1; // 当前选中的历史记录索引
        let historyItems = []; // 存储当前显示的历史记录项

        // 自动调整输入框高度
        function autoResizeTextarea() {
          const minHeight = 60;
          const maxHeight = 200;
          filterDialogTextarea.style.height = 'auto';
          const scrollHeight = filterDialogTextarea.scrollHeight;
          filterDialogTextarea.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';
        }

        // 更新当前过滤关键词显示
        function updateCurrentFilterKeywords() {
          const keywords = filterBox.value.trim();
          if (keywords) {
            currentFilterKeywords.textContent = keywords;
          } else {
            currentFilterKeywords.textContent = '无';
          }
        }

        // 应用过滤并关闭对话框
        function applyAndClose() {
          filterBox.value = filterDialogTextarea.value;
          applyFilter();
          updateCurrentFilterKeywords();
          filterDialog.classList.remove('visible');
          hideFilterHistory();
        }

        // 显示历史记录列表
        function showFilterHistory() {
          // 获取前20条历史记录
          historyItems = filterHistory.slice(0, 20).map((keyword, index) => ({
            keyword,
            index
          }));

          if (historyItems.length === 0) {
            filterHistoryList.innerHTML = '<div class="filter-history-item">暂无历史记录</div>';
          } else {
            filterHistoryList.innerHTML = historyItems.map((item, index) => `
              <div class="filter-history-item" data-index="${index}">
                <div class="keyword">${item.keyword}</div>
              </div>
            `).join('');

            // 添加点击事件 - 只填入输入框，不立即应用过滤
            filterHistoryList.querySelectorAll('.filter-history-item').forEach(item => {
              item.addEventListener('click', () => {
                const index = parseInt(item.getAttribute('data-index'));
                filterDialogTextarea.value = historyItems[index].keyword;
                // 不立即应用过滤，只隐藏历史提示框
                filterHistorySuggestions.style.display = 'none';
                filterDialogTextarea.focus();
              });
            });
          }

          filterHistorySuggestions.style.display = 'block';
          selectedHistoryIndex = -1;
        }

        // 隐藏历史记录列表
        function hideFilterHistory() {
          filterHistorySuggestions.style.display = 'none';
          selectedHistoryIndex = -1;
        }

        // 更新选中项
        function updateSelectedHistory() {
          const items = filterHistoryList.querySelectorAll('.filter-history-item');
          items.forEach((item, index) => {
            if (index === selectedHistoryIndex) {
              item.classList.add('selected');
            } else {
              item.classList.remove('selected');
            }
          });
        }

        // 打开过滤对话框
        expandFilterBtn.addEventListener('click', () => {
          filterDialogTextarea.value = filterBox.value;
          updateCurrentFilterKeywords();
          filterDialog.classList.add('visible');
          filterDialogTextarea.focus();
          autoResizeTextarea();
          showFilterHistory();
        });

        // 过滤对话框键盘事件
        filterDialogTextarea.addEventListener('keydown', (e) => {
          const items = filterHistoryList.querySelectorAll('.filter-history-item');

          if (e.key === 'ArrowDown') {
            // 向下箭头
            e.preventDefault();
            if (filterHistorySuggestions.style.display === 'none') {
              showFilterHistory();
            } else {
              selectedHistoryIndex = Math.min(selectedHistoryIndex + 1, items.length - 1);
              updateSelectedHistory();
            }
          } else if (e.key === 'ArrowUp') {
            // 向上箭头
            e.preventDefault();
            if (filterHistorySuggestions.style.display === 'none') {
              showFilterHistory();
            } else {
              selectedHistoryIndex = Math.max(selectedHistoryIndex - 1, 0);
              updateSelectedHistory();
            }
          } else if (e.key === 'Enter') {
            if (e.ctrlKey || e.metaKey) {
              // Ctrl+Enter 或 Cmd+Enter 允许换行
              return;
            }
            e.preventDefault(); // 阻止换行
            if (selectedHistoryIndex >= 0 && items[selectedHistoryIndex]) {
              // 回车选择历史记录并应用过滤
              const index = parseInt(items[selectedHistoryIndex].getAttribute('data-index'));
              filterDialogTextarea.value = historyItems[index].keyword;
              applyAndClose();
            } else {
              // 应用过滤
              applyAndClose();
            }
          } else if (e.key === 'Escape') {
            // ESC键隐藏历史记录
            e.preventDefault();
            if (filterHistorySuggestions.style.display === 'block') {
              hideFilterHistory();
            } else {
              filterDialog.classList.remove('visible');
            }
          }
        });

        // 输入框输入事件 - 自动调整高度
        filterDialogTextarea.addEventListener('input', () => {
          autoResizeTextarea();
        });

        // 输入框获得焦点时显示历史记录
        filterDialogTextarea.addEventListener('focus', () => {
          showFilterHistory();
        });

        // 点击外部关闭历史记录
        document.addEventListener('click', (e) => {
          if (!filterDialog.contains(e.target)) {
            hideFilterHistory();
          }
        });

        // 关闭过滤对话框
        closeFilterDialog.addEventListener('click', () => {
          filterDialog.classList.remove('visible');
          // 🚀 关闭时：只有输入框为空才清空过滤数据
          if (filterDialogTextarea.value.trim() === '') {
            cleanFilterData();
          }
          hideFilterHistory();
          // 🚀 同时关闭二级过滤面板
          if (filteredPanel) {
            filteredPanel.classList.remove('visible', 'maximized');
            filteredPanel.style.left = '';
            filteredPanel.style.top = '';
            filteredPanel.style.width = '';
            filteredPanel.style.height = '';
            if (filteredPanelMinimizedBtn) {
              filteredPanelMinimizedBtn.classList.remove('visible');
            }
          }
        });

        // 点击对话框外部关闭
        filterDialog.addEventListener('click', (e) => {
          if (e.target === filterDialog) {
            filterDialog.classList.remove('visible');
            // 🚀 点击外部关闭时：只有输入框为空才清空过滤数据
            if (filterDialogTextarea.value.trim() === '') {
              cleanFilterData();
              // 只有实际清空过滤数据时才关闭二级过滤面板
              if (filteredPanel) {
                filteredPanel.classList.remove('visible', 'maximized');
                filteredPanel.style.left = '';
                filteredPanel.style.top = '';
                filteredPanel.style.width = '';
                filteredPanel.style.height = '';
                if (filteredPanelMinimizedBtn) {
                  filteredPanelMinimizedBtn.classList.remove('visible');
                }
              }
            }
            hideFilterHistory();
          }
        });

        // 应用过滤（按钮已隐藏，但保留功能）
        applyFilterDialog.addEventListener('click', () => {
          applyAndClose();
        });

        // 清空过滤（按钮已隐藏，但保留功能）
        clearFilterDialog.addEventListener('click', () => {
          filterDialogTextarea.value = '';
          filterBox.value = '';
          // 🚀 清空过滤时释放内存
          cleanFilterData();
          // 重新渲染主面板
          renderLogLines();
          updateVisibleLines();
          updateCurrentFilterKeywords();
          hideFilterHistory();
        });

        // 初始化时更新当前过滤关键词显示
        updateCurrentFilterKeywords();

        // 监听过滤框变化，更新关键词显示
        filterBox.addEventListener('input', updateCurrentFilterKeywords);
      }

      function initFilterContextMenu() {
        const filterContextMenu = document.getElementById('filterContextMenu');
        const filterPanel = DOMCache.get('filteredPanel');
        const filterPanelContent = DOMCache.get('filteredPanelContent');
        if (!filterContextMenu || !filterPanelContent || !filterPanel) return;

        // 过滤结果框右键菜单事件监听
        filterPanel.addEventListener("contextmenu", (e) => {
          // 检查是否点击在过滤结果框内，但不是在头部或按钮区域
          if (!filterPanelContent.contains(e.target) || isEditableElement(e.target)) return;

          // 阻止默认右键菜单
          e.preventDefault();
          e.stopPropagation();

          // 获取选中的文本（保留首尾空格，用户可能需要高亮包含空格的关键词）
          const selectedText = window.getSelection().toString();

          // 存储选中的文本供菜单项使用
          filterContextMenu.dataset.selectedText = selectedText;

          // 根据是否有选中文本来启用/禁用高亮相关的菜单项
          const highlightItems = [
            'highlightRed', 'highlightGreen', 'highlightBlue', 'highlightYellow',
            'highlightPurple', 'highlightCyan', 'highlightPink', 'highlightLime',
            'highlightBrown', 'highlightGray', 'highlightCustom'
          ];

          highlightItems.forEach(id => {
            const item = document.getElementById(id);
            if (item) {
              item.style.opacity = selectedText ? '1' : '0.5';
              item.style.pointerEvents = selectedText ? 'auto' : 'none';
            }
          });

          // 启用/禁用"移除当前文本高亮"选项
          const removeHighlightItem = document.getElementById('removeCurrentHighlight');
          if (removeHighlightItem) {
            if (selectedText) {
              // 检查选中的文本是否已经高亮
              const hasHighlight = customHighlights.some(h => h.keyword === selectedText);
              if (hasHighlight) {
                removeHighlightItem.style.opacity = '1';
                removeHighlightItem.style.pointerEvents = 'auto';
              } else {
                removeHighlightItem.style.opacity = '0.5';
                removeHighlightItem.style.pointerEvents = 'none';
              }
            } else {
              removeHighlightItem.style.opacity = '0.5';
              removeHighlightItem.style.pointerEvents = 'none';
            }
          }

          // 启用/禁用"去除选中内容的行"选项
          const excludeLinesItem = document.getElementById('excludeSelectedLines');
          if (excludeLinesItem) {
            if (selectedText && selectedText.trim()) {
              excludeLinesItem.style.opacity = '1';
              excludeLinesItem.style.pointerEvents = 'auto';
            } else {
              excludeLinesItem.style.opacity = '0.5';
              excludeLinesItem.style.pointerEvents = 'none';
            }
          }

          // 显示右键菜单
          filterContextMenu.style.left = e.pageX + 'px';
          filterContextMenu.style.top = e.pageY + 'px';
          filterContextMenu.classList.add('visible');
        });

        // 红色高亮
        document.getElementById('highlightRed').addEventListener('click', () => {
          highlightSelectedText('#ff0000');
          hideFilterContextMenu();
        });

        // 绿色高亮
        document.getElementById('highlightGreen').addEventListener('click', () => {
          highlightSelectedText('#00ff00');
          hideFilterContextMenu();
        });

        // 蓝色高亮
        document.getElementById('highlightBlue').addEventListener('click', () => {
          highlightSelectedText('#0000ff');
          hideFilterContextMenu();
        });

        // 黄色高亮
        document.getElementById('highlightYellow').addEventListener('click', () => {
          highlightSelectedText('#ffaa00');
          hideFilterContextMenu();
        });

        // 紫色高亮
        document.getElementById('highlightPurple').addEventListener('click', () => {
          highlightSelectedText('#aa00ff');
          hideFilterContextMenu();
        });

        // 青色高亮
        document.getElementById('highlightCyan').addEventListener('click', () => {
          highlightSelectedText('#00ffff');
          hideFilterContextMenu();
        });

        // 粉色高亮
        document.getElementById('highlightPink').addEventListener('click', () => {
          highlightSelectedText('#ffc0cb');
          hideFilterContextMenu();
        });

        // 青柠高亮
        document.getElementById('highlightLime').addEventListener('click', () => {
          highlightSelectedText('#00ff00');
          hideFilterContextMenu();
        });

        // 棕色高亮
        document.getElementById('highlightBrown').addEventListener('click', () => {
          highlightSelectedText('#a52a2a');
          hideFilterContextMenu();
        });

        // 灰色高亮
        document.getElementById('highlightGray').addEventListener('click', () => {
          highlightSelectedText('#808080');
          hideFilterContextMenu();
        });

        // 自定义颜色高亮
        document.getElementById('highlightCustom').addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // 立即隐藏右键菜单，显示颜色选择器
          showColorPicker();
        });

        // 移除当前文本高亮
        document.getElementById('removeCurrentHighlight').addEventListener('click', () => {
          const selectedText = filterContextMenu.dataset.selectedText;
          if (!selectedText) {
            hideFilterContextMenu();
            return;
          }

          // 查找并移除匹配的高亮（使用splice方法，不重新赋值）
          const beforeLength = customHighlights.length;
          for (let i = customHighlights.length - 1; i >= 0; i--) {
            if (customHighlights[i].keyword === selectedText) {
              customHighlights.splice(i, 1);
            }
          }
          const afterLength = customHighlights.length;
          const removedCount = beforeLength - afterLength;

          if (removedCount > 0) {
            // 修复：清空缓存并增加版本号，确保移除高亮生效
            invalidateFilteredLineCache();

            // 刷新显示
            if (filteredPanel.classList.contains("visible")) {
              filteredPanelVisibleStart = -1;
              filteredPanelVisibleEnd = -1;
              requestAnimationFrame(() => {
                updateFilteredPanelVisibleLines();
              });
            } else {
              rerenderAfterHighlightChangePreserveScroll(true);
            }
            showMessage(`已移除 "${selectedText}" 的高亮`);
          } else {
            showMessage(`"${selectedText}" 没有高亮`);
          }

          hideFilterContextMenu();
        });

        // 去除选中内容的行
        document.getElementById('excludeSelectedLines').addEventListener('click', () => {
          const selectedText = filterContextMenu.dataset.selectedText;
          if (!selectedText || !selectedText.trim()) {
            hideFilterContextMenu();
            return;
          }

          // 去除包含选中内容的行
          excludeLinesWithSelectedText(selectedText.trim());
          hideFilterContextMenu();
        });

        // 清除所有高亮
        document.getElementById('clearHighlights').addEventListener('click', () => {
          removeAllHighlights();

          // 修复：清空缓存并增加版本号，确保清除高亮生效
          filteredLineContentCache.clear();
          filteredLineCacheVersion++;

          // 如果过滤面板可见，强制重新渲染所有行
          if (filteredPanel.classList.contains("visible")) {
            // 重置可见行范围，确保下一帧重新渲染
            filteredPanelVisibleStart = -1;
            filteredPanelVisibleEnd = -1;

            // 请求重新渲染
            requestAnimationFrame(() => {
              updateFilteredPanelVisibleLines();
            });

            showMessage("已清除所有高亮");
          } else {
            // 否则更新主内容区和过滤面板
            rerenderAfterHighlightChangePreserveScroll(true);
            showMessage("已清除所有高亮");
          }

          hideFilterContextMenu();
        });

        // 过滤结果转 UTC 时间按钮已移除
        // const convertFilteredToUTCBtn = document.getElementById('convertFilteredToUTC');
        // if (convertFilteredToUTCBtn) {
        //   convertFilteredToUTCBtn.addEventListener('click', async () => {
        //     ... UTC转换代码已移除 ...
        //   });
        // }

        // 点击其他地方隐藏菜单
        document.addEventListener('click', (e) => {
          if (!filterContextMenu.contains(e.target)) {
            hideFilterContextMenu();
          }
        });

        function hideFilterContextMenu() {
          filterContextMenu.classList.remove('visible');
        }

        // 显示颜色选择器
        function showColorPicker() {
          const colorPicker = document.getElementById('highlightColorPicker');
          const selectedText = filterContextMenu.dataset.selectedText;

          if (!selectedText) {
            hideFilterContextMenu();
            return;
          }

          // 先隐藏右键菜单
          hideFilterContextMenu();

          // 设置颜色选择器位置（在鼠标附近）
          const menuLeft = parseInt(filterContextMenu.style.left) || 0;
          const menuTop = parseInt(filterContextMenu.style.top) || 0;
          colorPicker.style.left = menuLeft + 'px';
          colorPicker.style.top = (menuTop + 40) + 'px';

          // 显示颜色选择器并立即聚焦
          colorPicker.style.display = 'block';

          // 使用 requestAnimationFrame 确保颜色选择器显示后再聚焦
          requestAnimationFrame(() => {
            colorPicker.focus();
            // 触发点击事件，直接打开颜色面板
            colorPicker.click();
          });

          // 监听颜色输入事件（实时预览）
          colorPicker.oninput = function() {
            const color = this.value;
            highlightSelectedText(color, true); // true 表示预览模式
          };

          // 监听颜色选择完成事件
          colorPicker.onchange = function() {
            const color = this.value;
            highlightSelectedText(color, false); // false 表示确定模式
            colorPicker.style.display = 'none';
          };

          // 监听失去焦点事件
          colorPicker.onblur = function() {
            // 延迟隐藏，确保onchange事件先触发
            setTimeout(() => {
              colorPicker.style.display = 'none';
            }, 200);
          };

          // 监听 ESC 键关闭颜色选择器
          colorPicker.onkeydown = function(e) {
            if (e.key === 'Escape') {
              colorPicker.style.display = 'none';
            }
          };
        }

        // 高亮选中的文本
        function highlightSelectedText(color, isPreview = false) {
          const selectedText = filterContextMenu.dataset.selectedText;
          if (!selectedText) return;

          // 预览模式：临时显示高亮效果
          if (isPreview) {
            // 修复：预览时也要清空缓存
            invalidateFilteredLineCache();

            // 检查是否已存在该关键词的高亮
            const existingIndex = customHighlights.findIndex(h => h.keyword === selectedText);

            if (existingIndex >= 0) {
              // 更新现有高亮的颜色（预览）
              const originalColor = customHighlights[existingIndex].color;
              customHighlights[existingIndex].color = color;

              // 刷新显示
              if (filteredPanel.classList.contains("visible")) {
                filteredPanelVisibleStart = -1;
                filteredPanelVisibleEnd = -1;
                requestAnimationFrame(() => {
                  updateFilteredPanelVisibleLines();
                });
              } else {
                rerenderAfterHighlightChangePreserveScroll(true);
              }

              // 保存原始颜色，以便取消时恢复（如果用户关闭颜色选择器）
              colorPicker.dataset.originalColor = originalColor;
            } else {
              // 预览新关键词的高亮
              customHighlights.push({
                keyword: selectedText,
                color: color
              });

              // 🔧 修复：预览高亮时清空 HTML 解析缓存
              clearHtmlParseCache();

              // 刷新显示
              if (filteredPanel.classList.contains("visible")) {
                filteredPanelVisibleStart = -1;
                filteredPanelVisibleEnd = -1;
                requestAnimationFrame(() => {
                  updateFilteredPanelVisibleLines();
                });
              } else {
                rerenderAfterHighlightChangePreserveScroll(true);
              }
            }
          } else {
            // 确定模式：正式添加高亮
            // 检查是否已存在该关键词的高亮
            const existingIndex = customHighlights.findIndex(h => h.keyword === selectedText);

            if (existingIndex < 0) {
              // 添加到自定义高亮数组
              customHighlights.push({
                keyword: selectedText,
                color: color
              });
            } else {
              // 更新现有高亮的颜色
              customHighlights[existingIndex].color = color;
            }

            // 🔧 修复：高亮变化时清空 HTML 解析缓存
            clearHtmlParseCache();

            // 应用高亮
            if (filteredPanel.classList.contains("visible")) {
              // 修复：清空缓存并增加版本号，确保新高亮生效
              invalidateFilteredLineCache();

              // 如果过滤面板可见，强制重新渲染所有行
              // 重置可见行范围，确保下一帧重新渲染
              filteredPanelVisibleStart = -1;
              filteredPanelVisibleEnd = -1;

              // 请求重新渲染
              requestAnimationFrame(() => {
                updateFilteredPanelVisibleLines();
              });

              showMessage(`已高亮关键词 "${selectedText}"`);
            } else {
              // 否则更新主内容区和过滤面板
              rerenderAfterHighlightChangePreserveScroll(true);
              showMessage(`已高亮关键词 "${selectedText}"`);
            }
          }
        }

        /**
         * 去除包含选中内容的行
         * 从当前过滤结果中排除包含指定文本的行
         */
        function excludeLinesWithSelectedText(excludeText) {
          console.log(`[excludeLinesWithSelectedText] 开始，排除文本: "${excludeText}"`);

          // 获取当前过滤面板的行数据
          const currentLines = filteredPanelAllLines || [];
          const currentOriginalIndices = filteredPanelAllOriginalIndices || [];
          const currentPrimaryIndices = filteredPanelAllPrimaryIndices || [];

          if (currentLines.length === 0) {
            showMessage('没有可过滤的行');
            return;
          }

          // 找出不包含排除文本的行
          const newLines = [];
          const newOriginalIndices = [];
          const newPrimaryIndices = [];

          for (let i = 0; i < currentLines.length; i++) {
            const line = currentLines[i];
            // 如果行不包含排除文本，则保留
            if (!line.includes(excludeText)) {
              newLines.push(line);
              newOriginalIndices.push(currentOriginalIndices[i]);
              if (currentPrimaryIndices.length > i) {
                newPrimaryIndices.push(currentPrimaryIndices[i]);
              }
            }
          }

          const excludedCount = currentLines.length - newLines.length;
          console.log(`[excludeLinesWithSelectedText] 原始行数: ${currentLines.length}, 剩余行数: ${newLines.length}, 排除: ${excludedCount}`);

          if (excludedCount === 0) {
            showMessage(`没有找到包含 "${excludeText}" 的行`);
            return;
          }

          if (newLines.length === 0) {
            showMessage('所有行都被排除了，无法显示');
            return;
          }

          // 创建新的二级过滤结果
          secondaryFilter = {
            isActive: true,
            filterKeywords: [excludeText], // 排除的关键词
            filteredLines: newLines,
            filteredToOriginalIndex: newOriginalIndices,
            filteredToPrimaryIndex: newPrimaryIndices,
            isExclusion: true, // 标记为排除模式
            totalLines: newLines.length
          };

          // 更新过滤面板显示
          updateFilteredPanel(newLines, newOriginalIndices, newPrimaryIndices, -1);

          showMessage(`✓ 已去除 ${excludedCount} 行包含 "${excludeText}" 的行，剩余 ${newLines.length} 行`);
        }
      }

      async function copyTextToClipboard(text) {
        const v = String(text ?? "");
        if (!v) return;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(v);
            showMessage("已复制");
            return;
          }
        } catch (_) {
          // fallback
        }
        try {
          const ta = document.createElement("textarea");
          ta.value = v;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          ta.style.top = "-9999px";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          showMessage("已复制");
        } catch (e) {
          console.error("复制失败:", e);
          showMessage("复制失败");
        }
      }

      // 在文件树中定位文件
      function locateFileInTree(filePath) {
        if (!filePath || !Array.isArray(fileTreeHierarchy)) return;
        
        // 规范化路径
        const normalizedPath = String(filePath).replace(/\\/g, "/").toLowerCase();
        
        // 查找匹配的文件树项目
        let foundIndex = -1;
        for (let i = 0; i < fileTreeHierarchy.length; i++) {
          const item = fileTreeHierarchy[i];
          if (!item || item.type !== "file") continue;
          
          const itemPath = String(item.path || item.name || "").replace(/\\/g, "/").toLowerCase();
          const itemRemotePath = String(item.remotePath || "").replace(/\\/g, "/").toLowerCase();
          
          // 检查精确匹配或路径结尾匹配
          if (itemPath === normalizedPath || 
              itemRemotePath === normalizedPath ||
              normalizedPath.endsWith("/" + itemPath) ||
              itemPath.endsWith("/" + normalizedPath.split("/").pop())) {
            foundIndex = i;
            break;
          }
        }
        
        if (foundIndex < 0) {
          showMessage("在文件树中未找到该文件");
          return;
        }
        
        // 展开父级目录
        expandParentFolders(foundIndex);
        
        // 显示文件树（如果未显示）
        if (fileTreeContainer && !fileTreeContainer.classList.contains("visible")) {
          fileTreeContainer.classList.add("visible");
          updateLayout();
          if (fileTreeCollapseBtn) fileTreeCollapseBtn.innerHTML = "◀";
          updateButtonPosition();
        }
        
        // 滚动到目标项并高亮
        setTimeout(() => {
          const fileTreeList = document.getElementById("fileTreeList");
          if (!fileTreeList) return;
          
          const itemEl = fileTreeList.querySelector(`[data-index="${foundIndex}"]`);
          if (itemEl) {
            itemEl.scrollIntoView({ behavior: "smooth", block: "center" });
            // 添加呼吸高亮效果
            itemEl.classList.add("breathing-highlight");
            setTimeout(() => {
              itemEl.classList.remove("breathing-highlight");
            }, 6000);
          }
        }, 100);
        
        showMessage("已定位到文件");
      }
      
      // 展开父级目录
      function expandParentFolders(fileIndex) {
        if (!Array.isArray(fileTreeHierarchy)) return;
        const item = fileTreeHierarchy[fileIndex];
        if (!item) return;
        
        const parts = String(item.path || "").split("/");
        parts.pop(); // 移除文件名
        
        // 从根开始展开每一级目录
        let currentPath = "";
        for (const part of parts) {
          currentPath = currentPath ? currentPath + "/" + part : part;
          for (let i = 0; i < fileTreeHierarchy.length; i++) {
            const folder = fileTreeHierarchy[i];
            if (folder && folder.type === "folder" && folder.path === currentPath) {
              if (!folder.expanded) {
                folder.expanded = true;
              }
              break;
            }
          }
        }
        
        // 重新渲染文件树
        renderFileTree();
      }

      function restrictLocalTreeToFolder(folderPath) {
        const target = String(folderPath || "").replace(/^\/+|\/+$/g, "");
        if (!target) return;

        // 仅对本地文件树生效（远程文件树用 loadServerTree）
        if (isServerMode) return;
        if (!Array.isArray(fileTreeData) || fileTreeData.length === 0) return;

        const prefix = target.endsWith("/") ? target : target + "/";
        const nextFiles = [];
        fileTreeData.forEach((f) => {
          const p = (f && (f.fullPath || f.webkitRelativePath || f.name)) || "";
          if (String(p) === target || String(p).startsWith(prefix)) {
            // 让该目录成为“根”：用 fullPath 覆盖为相对路径（buildFileTreeHierarchy 优先读取 fullPath）
            const rel =
              String(p) === target
                ? f.name || target
                : String(p).slice(prefix.length);
            try {
              f.fullPath = rel || (f.name || "unknown");
            } catch (_) {
              // ignore
            }
            nextFiles.push(f);
          }
        });

        if (nextFiles.length === 0) {
          showMessage("该目录下没有可加载文件");
          return;
        }

        fileTreeData = nextFiles;
        // 🔧 重建文件树时保留盘符
        const newHierarchy = buildFileTreeHierarchy(fileTreeData);
        fileTreeHierarchy = [...persistentDriveNodes, ...newHierarchy];
        selectedFiles = [];
        renderFileTree();
        showMessage(`文件树已限定到目录: ${target}`);
      }

      function loadTreeOnlyThisDirByIndex(index) {
        const item = fileTreeHierarchy[index];
        if (!item) return;
        let dirPath = item.path || "";
        let remoteDirPath = item.remotePath || item.path || "";
        if (item.type !== "folder") {
          // file -> parent dir
          const parts = String(dirPath).split("/");
          parts.pop();
          dirPath = parts.join("/");
          const rparts = String(remoteDirPath).split("/");
          rparts.pop();
          remoteDirPath = rparts.join("/");
        }
        if (!dirPath) return;

        if (item.isRemote || isServerMode) {
          const serverPathInput = document.getElementById("serverPath");
          if (serverPathInput) {
            serverPathInput.value = remoteDirPath;
          }
          loadServerTree();
          return;
        }
        restrictLocalTreeToFolder(dirPath);
      }

      function hideAnyVisibleFileTree() {
        // 关闭右键菜单（避免残留）
        hideFileTreeContextMenu();

        // 先关闭悬浮文件树
        if (isFileTreeFloating) {
          hideFloatingFileTree();
        }

        // 再折叠停靠文件树
        if (
          fileTreeContainer &&
          fileTreeContainer.classList.contains("visible")
        ) {
          fileTreeContainer.classList.remove("visible");
          updateLayout();
          if (fileTreeCollapseBtn) fileTreeCollapseBtn.innerHTML = "▶";
          updateButtonPosition();
        }
      }

      function hideFloatingFileTree() {
        isFileTreeFloating = false;

        fileTreeContainer.classList.remove("floating");
        if (fileTreeFloatingOverlay) fileTreeFloatingOverlay.classList.remove("visible");

        // 恢复停靠宽度，避免回到“固定弹窗宽度”
        if (fileTreeContainer) {
          fileTreeContainer.style.width = fileTreeDockedWidthPx + "px";
        }

        // 恢复进入前的停靠可见性
        if (!wasDockedFileTreeVisible) {
          fileTreeContainer.classList.remove("visible");
        }

        updateLayout();
        updateButtonPosition();
      }

      function toggleFloatingFileTree() {
        if (isFileTreeFloating) {
          hideFloatingFileTree();
        } else {
          showFloatingFileTree();
        }
      }

      // 切换文件树显示/隐藏
      function toggleFileTree() {
        // 悬浮模式下，边框按钮等同于关闭悬浮树
        if (isFileTreeFloating) {
          hideFloatingFileTree();
          return;
        }
        
        // 检查当前状态，如果是从隐藏状态到显示状态，清空搜索框
        const wasHidden = !fileTreeContainer.classList.contains("visible");
        
        fileTreeContainer.classList.toggle("visible");
        updateLayout();

        // 更新文件树边框按钮方向
        if (fileTreeContainer.classList.contains("visible")) {
          fileTreeCollapseBtn.innerHTML = "◀";
          
          // 如果是从隐藏状态到显示状态，清空搜索框
          if (wasHidden) {
            fileTreeSearch.value = "";
            fileTreeSearchTerm = "";
            filterFileTree();
          }
        } else {
          fileTreeCollapseBtn.innerHTML = "▶";
        }

        // 同步更新按钮位置，避免分离
        updateButtonPosition();
      }

      // 更新按钮位置（放在文件树边框上，始终紧贴右侧）
      function updateButtonPosition() {
        if (isFileTreeFloating) return;
        const isVisible = fileTreeContainer.classList.contains("visible");
        if (isVisible) {
          // 🚀 直接使用保存的宽度，避免 getBoundingClientRect() 返回 0 的问题
          const finalWidth = fileTreeDockedWidthPx || 360;
          fileTreeCollapseBtn.style.left = finalWidth + "px";
        } else {
          fileTreeCollapseBtn.style.left = "0";
        }
      }

      // 更新布局
      function updateLayout() {
        // 悬浮模式不挤压主内容
        if (isFileTreeFloating) {
          outer.style.left = "0px";
          hScroll.style.left = "0px";
          // 悬浮文件树不影响主内容布局：恢复左侧外边距
          document.documentElement.style.setProperty("--content-margin-left", "6px");
          // 悬浮/无停靠时保留圆角
          outer.style.borderTopLeftRadius = "10px";
          return;
        }
        const isVisible = fileTreeContainer.classList.contains("visible");
        // 使用getBoundingClientRect获取精确宽度（包含边框），避免出现分离/覆盖
        // 🚀 修复：首次渲染时getBoundingClientRect可能返回0，使用后备值fileTreeDockedWidthPx
        let width = isVisible ? fileTreeContainer.getBoundingClientRect().width : 0;
        if (isVisible && width < 50) {
          width = fileTreeDockedWidthPx;
        }

        outer.style.left = width + "px";
        hScroll.style.left = width + "px";

        // 🚀 设置 CSS 变量供 CSS 选择器使用，确保首次加载时布局正确
        document.documentElement.style.setProperty(
          "--file-tree-width",
          isVisible ? width + "px" : "0px"
        );

        // 文件树展开时取消日志框左外边距，避免文件树边沿与日志框边沿"分离"
        document.documentElement.style.setProperty(
          "--content-margin-left",
          isVisible ? "0px" : "6px"
        );

        // 文件树展开时取消内容框左上圆角，避免与文件树边沿产生"缝隙感"
        outer.style.borderTopLeftRadius = isVisible ? "0px" : "10px";

        // 同步更新按钮位置
        updateButtonPosition();
      }

      // 文件树搜索过滤
      function filterFileTree() {
        // 旧实现：遍历 DOM 再 display:none，会在大目录时导致滚动/展开/搜索卡顿
        // 新实现：将搜索合并到"可见索引计算"，并走虚拟滚动只渲染视口附近
        scheduleRebuildAndRenderFileTree();
      }

      // 🚀 新增：收集过滤后的文件路径（用于过滤模式）
      function collectFilteredFilePaths() {
        filterModeFileList = []; // 清空之前的列表

        // 等待虚拟滚动更新完成
        setTimeout(() => {
          const skippedArchives = []; // 记录跳过的压缩包文件

          // 遍历当前可见的所有文件树项
          for (let i = 0; i < fileTreeAllVisibleIndices.length; i++) {
            const index = fileTreeAllVisibleIndices[i];
            const item = fileTreeHierarchy[index];

            if (item && item.type === 'file') {
              // 获取文件的完整路径
              const fullPath = getFullPath(item);
              if (fullPath) {
                // 🔧 过滤模式不支持压缩包内的文件，跳过
                if (fullPath.match(/\.(zip|tar|gz|7z|rar)\//i)) {
                  skippedArchives.push(item.name);
                  continue;
                }
                filterModeFileList.push(fullPath);
              }
            }
          }

          console.log(`[过滤模式] 已收集 ${filterModeFileList.length} 个文件路径`);
          if (skippedArchives.length > 0) {
            console.warn(`[过滤模式] 跳过 ${skippedArchives.length} 个压缩包内文件（过滤模式不支持压缩包）`);
          }
          if (filterModeFileList.length > 0) {
            console.log(`[过滤模式] 第一个文件路径: ${filterModeFileList[0]}`);
          }

          if (filterModeFileList.length === 0 && skippedArchives.length > 0) {
            showMessage('⚠️ 过滤模式不支持压缩包内的文件，请选择普通磁盘文件');
          } else {
            showMessage(`🔍 已记录 ${filterModeFileList.length} 个文件，请在过滤框输入关键词进行过滤`);
          }
        }, 100);
      }

      // 获取文件树项的完整路径
      function getFullPath(item) {
        if (!item) return null;

        // 🔧 优先使用 item.path（本地磁盘文件夹已经有完整路径）
        if (item.path) {
          return item.path;
        }

        // 如果已经缓存了路径，直接使用
        if (item.fullPath) return item.fullPath;

        // 从文件树结构中构建路径（用于压缩包等场景）
        const parts = [];
        let current = item;

        while (current) {
          if (current.name && current.name !== 'root') {
            parts.unshift(current.name);
          }
          current = current.parent;
        }

        const fullPath = parts.join('/');
        item.fullPath = fullPath; // 缓存路径
        return fullPath;
      }

      /**
       * 🚀 自动跳转到第一个匹配的文件并展开父文件夹
       */
      async function jumpToFirstMatch() {
        const searchTerm = (fileTreeSearchTerm || "").trim();
        if (!searchTerm) return;

        const keywords = parseFileTreeSearchKeywords(searchTerm);

        console.log(`[jumpToFirstMatch] 搜索: "${searchTerm}", 关键词:`, keywords);

        // 搜索所有项（包括文件夹和文件）
        let matchedIndex = -1;

        for (let i = 0; i < fileTreeHierarchy.length; i++) {
          const item = fileTreeHierarchy[i];
          if (!item) continue;

          const name = (item.name ?? "").toString();
          if (matchesFileTreeSearchKeywords(name, keywords)) {
            matchedIndex = i;
            break;
          }
        }

        if (matchedIndex === -1) {
          console.log(`[jumpToFirstMatch] 未找到匹配`);
          return;
        }

        console.log(`[jumpToFirstMatch] 找到匹配: ${fileTreeHierarchy[matchedIndex].name} (索引: ${matchedIndex}, 类型: ${fileTreeHierarchy[matchedIndex].type})`);

        // 🔧 等待展开所有父文件夹完成
        await expandParentFolders(matchedIndex);

        // 🔧 等待渲染完成后再滚动
        await new Promise(resolve => setTimeout(resolve, 300));

        // 滚动到该项
        scrollToFileTreeItem(matchedIndex);

        // 如果是文件，选中它；如果是文件夹，只高亮不选中
        if (fileTreeHierarchy[matchedIndex].type !== 'folder') {
          selectFile(matchedIndex);
        } else {
          // 对于文件夹，清除所有选择
          clearFileSelection();
        }
      }

      /**
       * 🚀 跳转到指定路径并展开所有父文件夹
       * @param {string} fullPath - 完整路径，如 /prodlog_dump/prodlog/saved/question_parse/2026-01/WTGLMK-2064896
       */
      async function jumpToPath(fullPath) {
        if (!fullPath) return;

        console.log(`[jumpToPath] 跳转路径: "${fullPath}"`);

        // 解析路径 parts（去掉开头的 /）
        const parts = fullPath.split('/').filter(p => p.length > 0);
        if (parts.length === 0) return;

        // 在文件树中搜索完整路径匹配
        let matchedIndex = -1;
        for (let i = 0; i < fileTreeHierarchy.length; i++) {
          const item = fileTreeHierarchy[i];
          if (!item) continue;

          // 检查 path 是否以搜索路径结尾（匹配最后一部分）
          const itemPath = item.path || item.name;
          if (itemPath.endsWith(parts[parts.length - 1])) {
            // 进一步验证完整路径
            const itemParts = itemPath.split('/').filter(p => p.length > 0);
            if (itemParts.length > 0 && itemParts[itemParts.length - 1] === parts[parts.length - 1]) {
              matchedIndex = i;
              break;
            }
          }
        }

        if (matchedIndex === -1) {
          console.log(`[jumpToPath] 未找到路径: ${fullPath}`);
          return;
        }

        console.log(`[jumpToPath] 找到: ${fileTreeHierarchy[matchedIndex].name} (索引: ${matchedIndex})`);

        // 展开所有父文件夹
        await expandParentFolders(matchedIndex);

        // 等待渲染完成
        await new Promise(resolve => setTimeout(resolve, 300));

        // 滚动到该项
        scrollToFileTreeItem(matchedIndex);

        // 选中文件
        if (fileTreeHierarchy[matchedIndex].type !== 'folder') {
          selectFile(matchedIndex);
        } else {
          clearFileSelection();
        }
      }

      /**
       * 展开指定文件的所有父文件夹
       */
      async function expandParentFolders(fileIndex) {
        const file = fileTreeHierarchy[fileIndex];
        if (!file) return;

        // 收集需要展开的父文件夹（从内到外）
        const foldersToExpand = [];

        // 从目标文件向回遍历，找到所有父文件夹
        let currentLevel = file.level;
        for (let i = fileIndex - 1; i >= 0; i--) {
          const item = fileTreeHierarchy[i];
          if (!item) continue;

          if (item.type === 'folder' && item.level < currentLevel) {
            // 找到父文件夹
            if (!item.expanded) {
              foldersToExpand.unshift({ item, index: i }); // 添加到开头，保持从外到内的顺序
            }
            currentLevel = item.level;
          }

          if (currentLevel <= 0) break;
        }

        console.log(`[expandParentFolders] 需要展开 ${foldersToExpand.length} 个父文件夹`);

        // 逐个展开父文件夹（从外到内），等待每个完成
        for (const { item, index } of foldersToExpand) {
          console.log(`[expandParentFolders] 展开父文件夹: ${item.name} (level=${item.level})`);

          // 🔧 修复：使用正确的函数名和参数
          if (item.type === 'drive' || (item.type === 'folder' && item.isLocalDrive && !item.isArchiveChild)) {
            // 本地驱动器/本地文件夹
            await toggleLocalFolder(item, index);
          } else if (item.isRemote) {
            // 远程项目
            if (item.isArchive) {
              // 远程压缩包（包括嵌套压缩包）
              if (item.isNestedArchive) {
                // 🚀 嵌套压缩包：加载嵌套内容
                await loadNestedArchiveChildren(index);
              } else {
                // 普通远程压缩包
                await toggleRemoteArchive(item);
              }
            } else {
              // 远程文件夹
              await toggleRemoteFolder(item, index);
            }
          } else if (item.isArchive) {
            // 本地压缩包（包括嵌套压缩包）
            if (item.isNestedArchive) {
              // 🚀 嵌套压缩包：加载嵌套内容
              await loadNestedArchiveChildren(index);
            } else {
              // 普通本地压缩包
              await toggleLocalArchive(item, index);
            }
          } else if (item.isArchiveChild) {
            // 压缩包内的文件夹
            await toggleLocalFolder(item, index);
          } else {
            // 其他文件夹
            await toggleLocalFolder(item, index);
          }
        }
      }

      /**
       * 滚动到指定文件树项
       */
      function scrollToFileTreeItem(index) {
        if (!fileTreeList || index < 0 || index >= fileTreeHierarchy.length) return;

        console.log(`[scrollToFileTreeItem] 开始滚动到索引: ${index}`);

        // 🔧 在虚拟滚动中，需要先根据索引计算滚动位置，然后等待渲染
        // 在 fileTreeAllVisibleIndices 中找到目标索引的位置
        const visibleIndex = fileTreeAllVisibleIndices.indexOf(index);

        if (visibleIndex === -1) {
          console.log(`[scrollToFileTreeItem] 索引 ${index} 不在 fileTreeAllVisibleIndices 中，尝试重新构建缓存`);
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);

          // 重新查找
          const newVisibleIndex = fileTreeAllVisibleIndices.indexOf(index);
          if (newVisibleIndex === -1) {
            console.log(`[scrollToFileTreeItem] 重建缓存后仍未找到索引`);
            return;
          }
        }

        const actualVisibleIndex = fileTreeAllVisibleIndices.indexOf(index);
        console.log(`[scrollToFileTreeItem] 目标在可见列表中的位置: ${actualVisibleIndex}`);

        // 获取行高和容器高度
        const rowHeight = fileTreeRowHeightPx || measureFileTreeRowHeight();
        const containerHeight = fileTreeList.clientHeight || 300;

        // 🔧 计算目标滚动位置（将元素放在可见区域的下方 1/3 处）
        // 这样更容易看到，不会滚动到太靠上的位置
        const targetPosition = actualVisibleIndex * rowHeight;
        const scrollPosition = Math.max(0, targetPosition - containerHeight / 3);

        // 先滚动到大致位置
        fileTreeList.scrollTop = scrollPosition;

        console.log(`[scrollToFileTreeItem] 第一次滚动: visibleIndex=${actualVisibleIndex}, rowHeight=${rowHeight}px, scrollPosition=${scrollPosition}px`);

        // 等待虚拟滚动重新渲染后，再精确滚动
        setTimeout(() => {
          // 在虚拟滚动中查找目标元素
          const fileTreeItems = fileTreeList.querySelectorAll('.file-tree-item');
          let targetElement = null;

          for (const element of fileTreeItems) {
            const elementIndex = parseInt(element.dataset.index);
            if (elementIndex === index) {
              targetElement = element;
              break;
            }
          }

          if (targetElement) {
            console.log(`[scrollToFileTreeItem] 找到目标DOM元素，精确滚动`);

            // 🔧 使用 'nearest' 让元素在最合适的位置
            targetElement.scrollIntoView({
              behavior: 'auto',
              block: 'nearest'
            });
          } else {
            console.log(`[scrollToFileTreeItem] 第二次仍未找到DOM元素，使用调整后的位置`);
            // 向下调整一点：减去较少的偏移量
            const adjustedScrollPosition = Math.max(0, scrollPosition - rowHeight);
            fileTreeList.scrollTop = adjustedScrollPosition;
            console.log(`[scrollToFileTreeItem] 调整后滚动位置: ${adjustedScrollPosition}px`);
          }
        }, 200);
      }

      /**
       * 选中指定文件
       */
      function selectFile(index) {
        if (index < 0 || index >= fileTreeHierarchy.length) return;

        // 等待DOM更新后再选中
        setTimeout(() => {
          // 清除之前的选择
          clearFileSelection();

          // 设置新的选择
          const file = fileTreeHierarchy[index];
          if (file) {
            file.selected = true;
            lastSelectedIndex = index;

            // 刷新渲染
            renderFileTreeViewport(true);

            console.log(`[selectFile] 已选中: ${file.name}`);
          }
        }, 150);
      }

      function isFileTreeIndexVisible(index) {
        return visibleFileTreeItemsSet.has(index);
      }

      // 🔧 新增：临时包含的节点索引（用于过滤模式下展开时显示子项）
      let temporarilyIncludedNodes = new Set();

      function ensureFileTreeVirtualDom() {
        if (fileTreeVirtualInitialized) return;
        if (!fileTreeList) return;

        // 结构：top spacer + virtual content + bottom spacer
        fileTreeList.innerHTML = "";
        fileTreeVirtualTopSpacer = document.createElement("div");
        fileTreeVirtualTopSpacer.id = "fileTreeTopSpacer";
        fileTreeVirtualBottomSpacer = document.createElement("div");
        fileTreeVirtualBottomSpacer.id = "fileTreeBottomSpacer";
        fileTreeVirtualContent = document.createElement("div");
        fileTreeVirtualContent.id = "fileTreeVirtualContent";
        try {
          fileTreeVirtualContent.style.contain = "content";
        } catch (_) {}

        fileTreeList.appendChild(fileTreeVirtualTopSpacer);
        fileTreeList.appendChild(fileTreeVirtualContent);
        fileTreeList.appendChild(fileTreeVirtualBottomSpacer);

        // 滚动时只更新视口渲染（不重算可见列表）
        fileTreeList.addEventListener(
          "scroll",
          () => scheduleRenderFileTreeViewport(false),
          { passive: true }
        );
        window.addEventListener(
          "resize",
          () => scheduleRenderFileTreeViewport(true),
          { passive: true }
        );

        fileTreeVirtualInitialized = true;
      }

      function measureFileTreeRowHeight() {
        if (!fileTreeList) return 28;
        const temp = document.createElement("div");
        temp.className = "file-tree-item file-tree-file";
        temp.style.visibility = "hidden";
        temp.style.position = "absolute";
        temp.style.left = "-9999px";
        temp.style.top = "-9999px";
        temp.innerHTML =
          '<span class="icon"></span><span class="file-tree-name">测</span>';
        fileTreeList.appendChild(temp);
        const cs = window.getComputedStyle(temp);
        const mt = parseFloat(cs.marginTop || "0") || 0;
        const mb = parseFloat(cs.marginBottom || "0") || 0;
        const h = Math.max(16, temp.offsetHeight + mt + mb);
        temp.remove();
        return Math.round(h);
      }

      // 线性计算"展开状态"下的可见节点（避免 areAllAncestorsExpanded 的 O(N²)）
      function computeVisibleByExpandState() {
        const out = [];
        const collapsedLevels = [];

        for (let i = 0; i < fileTreeHierarchy.length; i++) {
          const it = fileTreeHierarchy[i];
          if (!it) continue;
          
          const lv = typeof it.level === "number" ? it.level : 0;

          while (
            collapsedLevels.length > 0 &&
            lv <= collapsedLevels[collapsedLevels.length - 1]
          ) {
            collapsedLevels.pop();
          }

          const visibleByExpand = collapsedLevels.length === 0;
          if (visibleByExpand) out.push(i);

          // 该 folder/drive 的 expanded 状态会影响后代可见性
          // 🔧 也要检查 type === "drive"，否则驱动器折叠后子项仍然可见
          if ((it.type === "folder" || it.type === "drive") && !it.expanded) {
            collapsedLevels.push(lv);
          }

          // 压缩包如果未展开，也会影响后代可见性
          if (it.isArchive) {
            // 服务端/嵌套压缩包：使用 expanded 字段
            // 本地压缩包（非嵌套）：使用 expandedArchives 集合
            let isExpanded;
            if (it.isRemote || it.isNestedArchive) {
              isExpanded = it.expanded;
            } else {
              isExpanded = expandedArchives.has(it.archiveName);
            }
            if (!isExpanded) {
              collapsedLevels.push(lv);
            }
          }
        }
        return out;
      }

      function rebuildFileTreeVisibleCache() {
        const term = (fileTreeSearchTerm || "").trim();

        // 1. 首先根据展开状态计算可见节点
        const expandedVisibleIndices = computeVisibleByExpandState();

        // 2. 如果没有搜索词，直接使用展开状态的结果，清空匹配列表
        if (!term) {
          fileTreeAllVisibleIndices = expandedVisibleIndices;
          visibleFileTreeItems = fileTreeAllVisibleIndices.slice();
          visibleFileTreeItemsSet = new Set(visibleFileTreeItems);
          fileTreeMatchedIndices = [];
          fileTreeSearchShowOnlyMatches = false; // 重置只显示匹配模式
          temporarilyIncludedNodes.clear(); // 清空临时包含的节点
          return;
        }

        // 3. 解析搜索关键词
        const keywords = parseFileTreeSearchKeywords(term);

        // 4. 如果有搜索词：找出匹配的项
        const matchedIndices = [];

        // 遍历所有可见节点，找出匹配的项
        for (const i of expandedVisibleIndices) {
          const it = fileTreeHierarchy[i];
          if (!it) continue;

          const name = (it.name ?? "").toString();
          const isMatch = matchesFileTreeSearchKeywords(name, keywords);

          if (isMatch) {
            matchedIndices.push(i);
          }
        }

        // 更新匹配索引列表（用于高亮显示）
        fileTreeMatchedIndices = matchedIndices;

        // 4. 根据模式决定显示内容
        console.log(`[rebuildFileTreeVisibleCache] term="${term}", fileTreeSearchShowOnlyMatches=${fileTreeSearchShowOnlyMatches}, matchedIndices.length=${matchedIndices.length}, temporarilyIncludedNodes.size=${temporarilyIncludedNodes.size}`);

        if (term && fileTreeSearchShowOnlyMatches) {
          // 🔧 按Enter后的过滤模式：只显示匹配的文本文件 + 临时包含的节点
          // 目录和压缩包会被高亮（在 matchedIndices 中），但不会显示在列表中
          const finalIndices = [];

          // 只添加匹配的文本文件（type === 'file' 且不是压缩包）
          for (const idx of matchedIndices) {
            const item = fileTreeHierarchy[idx];
            if (!item) continue;

            // 只显示普通文件（不包括文件夹和压缩包）
            if (item.type === 'file' && !item.isArchive) {
              finalIndices.push(idx);
            }
          }

          // 🚀 性能优化：使用 Set 替代 includes()，避免 O(N²)
          const finalIndexSet = new Set(finalIndices);
          for (const idx of temporarilyIncludedNodes) {
            if (!finalIndexSet.has(idx)) {
              finalIndexSet.add(idx);
              finalIndices.push(idx);
            }
          }

          // 排序以保持正确的顺序
          finalIndices.sort((a, b) => a - b);

          fileTreeAllVisibleIndices = finalIndices;
          visibleFileTreeItems = fileTreeAllVisibleIndices.slice();
          visibleFileTreeItemsSet = new Set(visibleFileTreeItems);
          console.log(`[rebuildFileTreeVisibleCache] 过滤模式：visibleFileTreeItems.length=${visibleFileTreeItems.length}, finalIndices=`, finalIndices);
        } else {
          // 🔧 默认模式/输入时：显示所有展开的节点（不过滤），只是高亮匹配项
          fileTreeAllVisibleIndices = expandedVisibleIndices;
          visibleFileTreeItems = fileTreeAllVisibleIndices.slice();
          visibleFileTreeItemsSet = new Set(visibleFileTreeItems);
          console.log(`[rebuildFileTreeVisibleCache] 非过滤模式：visibleFileTreeItems.length=${visibleFileTreeItems.length}`);
        }
      }

      function scheduleRenderFileTreeViewport(force) {
        if (fileTreeVirtualRaf) return;
        fileTreeVirtualRaf = requestAnimationFrame(() => {
          fileTreeVirtualRaf = null;
          renderFileTreeViewport(force);
        });
      }

      function renderFileTreeViewport(force) {
        const renderStart = performance.now();
        ensureFileTreeVirtualDom();
        if (!fileTreeVirtualContent) return;

        if (!fileTreeHierarchy || fileTreeHierarchy.length === 0) {
          fileTreeList.innerHTML =
            '<div class="file-tree-empty">导入文件、文件夹或压缩包后，文件将显示在这里</div>';
          fileTreeVirtualInitialized = false;
          return;
        }

        if (!fileTreeRowHeightPx || fileTreeRowHeightPx < 10) {
          fileTreeRowHeightPx = measureFileTreeRowHeight();
        }

        const total = fileTreeAllVisibleIndices.length;
        if (total === 0) {
          fileTreeVirtualTopSpacer.style.height = "0px";
          fileTreeVirtualBottomSpacer.style.height = "0px";
          fileTreeVirtualContent.innerHTML =
            '<div class="file-tree-empty">没有找到匹配的文件</div>';
          return;
        }

        const scrollTop = fileTreeList.scrollTop || 0;
        const viewportH = fileTreeList.clientHeight || 0;
        const start = Math.max(
          0,
          Math.floor(scrollTop / fileTreeRowHeightPx) - fileTreeVirtualBuffer
        );
        const end = Math.min(
          total,
          Math.ceil((scrollTop + viewportH) / fileTreeRowHeightPx) +
            fileTreeVirtualBuffer
        );

        if (!force && start === fileTreeVirtualLastStart && end === fileTreeVirtualLastEnd) {
          return;
        }
        fileTreeVirtualLastStart = start;
        fileTreeVirtualLastEnd = end;

        fileTreeVirtualTopSpacer.style.height = start * fileTreeRowHeightPx + "px";
        fileTreeVirtualBottomSpacer.style.height =
          Math.max(0, (total - end) * fileTreeRowHeightPx) + "px";

        const frag = document.createDocumentFragment();

        // 🚀 性能优化：预构建 Set，避免循环内 O(N) 查找
        const selectedIndexSet = new Set(selectedFiles.map(f => f.index));
        const matchedIndexSet = fileTreeMatchedIndices.length > 0
          ? new Set(fileTreeMatchedIndices)
          : null;

        for (let i = start; i < end; i++) {
          const index = fileTreeAllVisibleIndices[i];
          const item = fileTreeHierarchy[index];
          if (!item) continue;

          const element = document.createElement("div");
          element.className = `file-tree-item file-tree-${item.type}`;
          element.classList.add(`file-tree-level-${item.level}`);
          element.style.setProperty("--ft-level", String(item.level || 0));
          element.dataset.index = index;

          // 🚀 性能优化：使用 Set.has() O(1) 替代 Array.some() O(N)
          if (selectedIndexSet.has(index)) {
            element.classList.add("selected");
          }

          // 检查是否在多选集合中
          if (archiveMultiSelectedFiles.has(index)) {
            element.classList.add("multi-selected");
          }

          // 🚀 性能优化：使用 Set.has() O(1) 替代 Array.includes() O(N)
          if (matchedIndexSet && matchedIndexSet.has(index)) {
            element.classList.add("search-matched");
          }

          // 检查是否是压缩包
          if (item.isArchive) {
            element.classList.add("archive");
            // 服务端压缩包：使用 expanded 字段
            // 本地压缩包：使用 expandedArchives 集合
            // 🚀 嵌套压缩包：直接使用 expanded 字段
            let isExpanded;
            if (item.isRemote) {
              // 远程压缩包
              isExpanded = item.expanded;
            } else if (item.isNestedArchive) {
              // 🚀 嵌套压缩包：直接使用 expanded 字段
              isExpanded = item.expanded;
            } else {
              // 本地压缩包（非嵌套）
              isExpanded = expandedArchives.has(item.archiveName);
            }
            if (isExpanded) {
              element.classList.add("expanded");
            }
          }

          // 🚀 VS Code 风格缩进参考线：为每级缩进生成竖线 span
          const level = item.level || 0;
          let indentGuidesHtml = '';
          if (level > 0) {
            for (let lv = 1; lv <= level; lv++) {
              indentGuidesHtml += '<span class="ft-indent-guide" style="left:' + (2 + lv * 14 - 7) + 'px"></span>';
            }
          }

          if (item.type === "folder") {
            element.classList.add(
              item.expanded
                ? "file-tree-folder-expanded"
                : "file-tree-folder-collapsed"
            );

            // 懒加载模式：检查是否有子项来决定是否显示展开箭头
            // 对于懒加载文件夹，如果还没有加载且不确定是否有子项，显示问号样式
            const showToggle = item.lazyLoad ? (item.hasChildren || item.childrenLoaded) : true;
            const toggleClass = item.expanded ? "expanded" : "";
            const toggleStyle = !showToggle ? 'style="visibility:hidden"' : "";
            const loadingMark =
              item.loadingChildren
                ? '<span style="margin-left:6px;opacity:.6;">加载中…</span>'
                : "";

            // 🚀 不转义HTML，直接使用原始内容
            element.innerHTML =
              indentGuidesHtml +
              `<span class="file-tree-toggle ${toggleClass}" ${toggleStyle} aria-hidden="true"></span>` +
              `<span class="icon"></span><span class="file-tree-name">${escapeHtml(item.name)}</span>` +
              loadingMark;
          } else if (item.type === "drive") {
            // 🚀 本地驱动器显示
            element.classList.add(
              item.expanded
                ? "file-tree-folder-expanded"
                : "file-tree-folder-collapsed"
            );

            const toggleClass = item.expanded ? "expanded" : "";
            const loadingMark =
              item.loadingChildren
                ? '<span style="margin-left:6px;opacity:.6;">加载中…</span>'
                : "";

            // 🚀 不转义HTML，直接使用原始内容
            element.innerHTML =
              indentGuidesHtml +
              `<span class="file-tree-toggle ${toggleClass}" aria-hidden="true"></span>` +
              `<span class="icon">💽</span><span class="file-tree-name">${escapeHtml(item.name)}</span>` +
              loadingMark;
          } else if (item.isArchive) {
            // 压缩包文件显示
            // 服务端压缩包：使用 expanded 字段
            // 本地压缩包：使用 expandedArchives 集合
            // 🚀 嵌套压缩包：直接使用 expanded 字段
            let isExpanded;
            if (item.isRemote) {
              // 远程压缩包
              isExpanded = item.expanded;
            } else if (item.isNestedArchive) {
              // 🚀 嵌套压缩包：直接使用 expanded 字段
              isExpanded = item.expanded;
            } else {
              // 本地压缩包（非嵌套）
              isExpanded = expandedArchives.has(item.archiveName);
            }

            const loadingMark =
              item.loadingChildren
                ? '<span style="margin-left:6px;opacity:.6;">加载中…</span>'
                : "";
            // 🚀 不转义HTML，直接使用原始内容
            element.innerHTML =
              indentGuidesHtml +
              `<span class="file-tree-toggle ${isExpanded ? "expanded" : ""}" aria-hidden="true"></span>` +
              `<span class="icon">📦</span><span class="file-tree-name">${escapeHtml(item.name)}</span>` +
              (item.fileCount ? `<span class="file-count">(${item.fileCount} 个文件)</span>` : "") +
              loadingMark;
          } else {
            // 普通文件显示
            let icon = "📄";
            const nameLower = item.name.toLowerCase();
            if (nameLower.endsWith('.log')) icon = "📋";
            else if (nameLower.endsWith('.txt')) icon = "📝";
            else if (nameLower.endsWith('.json')) icon = "📋";
            else if (nameLower.endsWith('.xml')) icon = "📋";
            else if (nameLower.endsWith('.html')) icon = "🌐";
            else if (nameLower.endsWith('.js')) icon = "📜";
            else if (nameLower.endsWith('.css')) icon = "🎨";

            // 🚀 不转义HTML，直接使用原始内容
            element.innerHTML = indentGuidesHtml + `<span class="icon">${icon}</span><span class="file-tree-name">${escapeHtml(item.name)}</span>`;
          }

          frag.appendChild(element);
        }

        fileTreeVirtualContent.innerHTML = "";
        fileTreeVirtualContent.appendChild(frag);

        const renderTime = performance.now() - renderStart;
        if (renderTime > 50) {  // Only log if it takes more than 50ms
          console.log(`⚠️ renderFileTreeViewport 耗时: ${renderTime.toFixed(2)}ms (items: ${end - start})`);
        }
      }

      function scheduleRebuildAndRenderFileTree() {
        // 🚀 性能优化：RAF 去重，避免同一帧内多次触发导致重复重建
        if (fileTreeRebuildRaf) return;
        fileTreeRebuildRaf = requestAnimationFrame(() => {
          fileTreeRebuildRaf = null;
          if (!fileTreeHierarchy || fileTreeHierarchy.length === 0) return;
          ensureFileTreeVirtualDom();
          if (!fileTreeRowHeightPx || fileTreeRowHeightPx < 10) {
            fileTreeRowHeightPx = measureFileTreeRowHeight();
          }
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);
        });
      }

      // 开始调整文件树宽度 - 优化：使用requestAnimationFrame实现流畅调整
      function startResize(e) {
        isFileTreeResizing = true;
        fileTreeResizer.classList.add("resizing");
        fileTreeStartWidth = fileTreeContainer.getBoundingClientRect().width;
        fileTreeStartX = e.clientX;

        // 防止文本选中
        document.body.style.userSelect = "none";
        document.body.style.webkitUserSelect = "none";
        // 拖拽调宽时禁用动画，避免按钮/边沿跟随滞后
        document.body.classList.add("file-tree-resizing");

        document.addEventListener("mousemove", handleResize);
        document.addEventListener("mouseup", stopResize);
      }

      // 处理调整宽度 - 优化：使用requestAnimationFrame实现流畅调整
      function handleResize(e) {
        if (!isFileTreeResizing) return;

        const deltaX = e.clientX - fileTreeStartX;
        const newWidth = isFileTreeFloating
          ? clampValue(fileTreeStartWidth + deltaX, 260, Math.max(260, window.innerWidth - 40))
          : clampValue(fileTreeStartWidth + deltaX, 200, 1200);  // 🚀 放宽最大宽度从 600 到 1200px

        // 立即更新文件树宽度
        fileTreeContainer.style.width = newWidth + "px";

        // 悬浮模式：只更新自身宽度（不影响主内容区）
        if (isFileTreeFloating) {
          fileTreeFloatingWidthPx = newWidth;
          syncFloatingFileTreeCssWidth();
          return;
        }

        // 同步更新按钮位置（立即响应，无延迟）
        if (fileTreeContainer.classList.contains("visible")) {
          fileTreeCollapseBtn.style.left = newWidth + "px";
        }

        // 使用requestAnimationFrame更新主内容区位置
        if (fileTreeResizeAnimationFrame) {
          cancelAnimationFrame(fileTreeResizeAnimationFrame);
        }

        fileTreeResizeAnimationFrame = requestAnimationFrame(() => {
          outer.style.left = newWidth + "px";
          hScroll.style.left = newWidth + "px";

          // 文件树可见时：确保日志框左外边距为 0，避免边沿露缝
          document.documentElement.style.setProperty(
            "--content-margin-left",
            fileTreeContainer.classList.contains("visible") ? "0px" : "6px"
          );
        });
      }

      // 停止调整宽度 - 优化：恢复文本选中
      function stopResize() {
        isFileTreeResizing = false;
        fileTreeResizer.classList.remove("resizing");

        // 持久化最终宽度（分别记录停靠/悬浮）
        const finalWidth = fileTreeContainer.getBoundingClientRect().width;
        if (isFileTreeFloating) {
          fileTreeFloatingWidthPx = finalWidth;
          writeStorageNumber(FILE_TREE_FLOATING_WIDTH_STORAGE_KEY, Math.round(finalWidth));
          syncFloatingFileTreeCssWidth();
        } else {
          fileTreeDockedWidthPx = clampValue(finalWidth, 200, 1200);  // 🚀 放宽最大宽度从 600 到 1200px
          writeStorageNumber(
            FILE_TREE_DOCKED_WIDTH_STORAGE_KEY,
            Math.round(fileTreeDockedWidthPx)
          );
          // 优化：停靠宽度调整后，Ctrl+G 悬浮文件树默认跟随最新宽度
          fileTreeFloatingWidthPx = fileTreeDockedWidthPx;
          writeStorageNumber(
            FILE_TREE_FLOATING_WIDTH_STORAGE_KEY,
            Math.round(fileTreeFloatingWidthPx)
          );
          syncFloatingFileTreeCssWidth();
        }

        // 恢复文本选中
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
        document.body.classList.remove("file-tree-resizing");

        // 取消动画帧
        if (fileTreeResizeAnimationFrame) {
          cancelAnimationFrame(fileTreeResizeAnimationFrame);
          fileTreeResizeAnimationFrame = null;
        }

        // 最终同步布局，确保位置精确
        updateLayout();

        document.removeEventListener("mousemove", handleResize);
        document.removeEventListener("mouseup", stopResize);
      }

      // 文件树鼠标按下事件 - 优化：减少残影
      async function handleFileTreeMouseDown(e) {
        const item = e.target.closest(".file-tree-item");
        if (!item) {
          console.log(`[mousedown] 未找到 file-tree-item，target=`, e.target);
          return;
        }

        const index = parseInt(item.dataset.index);
        if (isNaN(index)) {
          console.log(`[mousedown] 无效的 index，dataset.index=`, item.dataset.index);
          return;
        }

        const treeItem = fileTreeHierarchy[index];
        if (!treeItem) {
          console.log(`[mousedown] 未找到 treeItem，index=`, index);
          return;
        }

        console.log(`[mousedown] index=${index}, type=${treeItem.type}, button=${e.button}, ctrlKey=${e.ctrlKey}, isArchive=${treeItem.isArchive}, isLocalDrive=${treeItem.isLocalDrive}`);

        // 🔍 调试：输出 treeItem 的属性
        if (treeItem.type === 'folder') {
          console.log(`[mousedown] 文件夹点击: name=${treeItem.name}, type=${treeItem.type}, isArchive=${treeItem.isArchive}, isArchiveChild=${treeItem.isArchiveChild}, isLocalDrive=${treeItem.isLocalDrive}, isRemote=${treeItem.isRemote}`);
        }

        // 🚀 处理服务端压缩包/拖拽压缩包展开/折叠（右键点击时不处理）
        // 🔧 优先处理：已在 archiveData 中的压缩包（拖拽的）或服务端压缩包
        // 条件：是压缩包 AND (是服务端 OR 已在内存中 OR 新远程目录功能中的压缩包)
        console.log(`[mousedown] 检查 isArchive && button!==2: isArchive=${treeItem.isArchive}, type=${treeItem.type}, button=${e.button}`);
        const isArchive = treeItem.isArchive || treeItem.type === 'archive';
        const isInArchiveData = treeItem.archiveName && archiveData.has(treeItem.archiveName);
        const isDirectRemoteArchive = treeItem.type === 'archive' && treeItem.remoteId && treeItem.isRemote;

        if (isArchive && e.button !== 2) {
          const shouldUseRemoteHandler = treeItem.isRemote || isInArchiveData || isDirectRemoteArchive;

          if (shouldUseRemoteHandler) {
            e.preventDefault();
            e.stopPropagation();
            const handlerType = isDirectRemoteArchive ? '新远程目录' : (treeItem.isRemote ? '服务端' : (isInArchiveData ? '拖拽' : '未知'));
            console.log(`[mousedown] 处理${handlerType}压缩包点击: ${treeItem.name}, isInArchiveData=${isInArchiveData}, isRemote=${treeItem.isRemote}, isNestedArchive=${treeItem.isNestedArchive}`);

            // 🚀 新远程目录功能中的压缩包
            if (isDirectRemoteArchive) {
              // 先切换展开状态
              treeItem.expanded = !treeItem.expanded;

              // 如果展开且未加载子项，则加载
              if (treeItem.expanded && !treeItem.childrenLoaded) {
                await loadRemoteArchiveChildren(index);
              } else {
                // 只是切换展开/折叠状态，重新渲染
                rebuildFileTreeVisibleCache();
                renderFileTreeViewport(true);
              }
              return;
            }

            // 🚀 检查是否是嵌套压缩包
            if (treeItem.isNestedArchive) {
              await loadNestedArchiveChildren(index);
            } else {
              await toggleRemoteArchive(treeItem);
            }
            return;
          }
        }

        // 🚀 处理本地压缩包展开/折叠（右键点击时不处理）
        // 🔧 本地磁盘上的压缩包（不在 archiveData 中，需要从磁盘读取）
        if (treeItem.isArchive && treeItem.isLocalDrive && !treeItem.isRemote && !treeItem.isArchiveChild && e.button !== 2) {
          e.preventDefault();
          e.stopPropagation();
          console.log(`[mousedown] 处理本地磁盘压缩包点击: ${treeItem.name}, isNestedArchive=${treeItem.isNestedArchive}`);

          // 🚀 检查是否是嵌套压缩包
          if (treeItem.isNestedArchive) {
            await loadNestedArchiveChildren(index);
          } else {
            await toggleLocalArchive(treeItem, index);
          }
          return;
        }

        // 🚀 处理嵌套压缩包展开/折叠（右键点击时不处理）
        // 🔧 嵌套压缩包的特征：type='archive' AND isArchiveChild=true AND isNestedArchive=true
        if (treeItem.isNestedArchive && treeItem.type === 'archive' && e.button !== 2) {
          e.preventDefault();
          e.stopPropagation();
          console.log(`[mousedown] 处理嵌套压缩包点击: ${treeItem.name}, level=${treeItem.level}`);

          // 检查是否已展开
          if (treeItem.expanded && treeItem.childrenLoaded) {
            // 折叠
            console.log(`[嵌套压缩包] 折叠: ${treeItem.name}`);
            treeItem.expanded = false;
            // 删除子项
            unloadArchiveChildren(index);
            treeItem.childrenLoaded = false;
          } else {
            // 展开
            console.log(`[嵌套压缩包] 展开: ${treeItem.name}`);
            treeItem.expanded = true;
            await loadNestedArchiveChildren(index);
          }

          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);
          return;
        }

        // 🚀 处理远程服务器上的文件夹展开/折叠（右键点击时不处理）
        if (treeItem.type === 'folder' && treeItem.isRemote && !treeItem.isArchiveChild && e.button !== 2) {
          e.preventDefault();
          e.stopPropagation();
          console.log(`[mousedown] 处理远程文件夹点击: ${treeItem.name}, isRemote=${treeItem.isRemote}`);
          await toggleRemoteFolder(treeItem, index);
          return;
        }

        // 🚀 处理本地驱动器/本地文件夹展开/折叠（右键点击时不处理，排除压缩包内的内容）
        if ((treeItem.type === 'drive' || (treeItem.type === 'folder' && treeItem.isLocalDrive && !treeItem.isArchiveChild)) && e.button !== 2) {
          e.preventDefault();
          e.stopPropagation(); // 阻止事件冒泡
          console.log(`[mousedown] 处理本地文件夹点击: ${treeItem.name}, type=${treeItem.type}, isLocalDrive=${treeItem.isLocalDrive}`);
          await toggleLocalFolder(treeItem, index);
          return;
        }

        // 处理压缩包内的文件夹展开/折叠（包括本地压缩包，右键点击时不处理）
        if (treeItem.type === 'folder' && treeItem.isArchiveChild && e.button !== 2) {
          e.preventDefault();
          e.stopPropagation(); // 阻止事件冒泡
          console.log(`[mousedown] 处理压缩包内文件夹点击: ${treeItem.name}, isArchiveChild=${treeItem.isArchiveChild}, isLocalDrive=${treeItem.isLocalDrive}`);
          // 使用 toggleLocalFolder 处理压缩包内文件夹
          await toggleLocalFolder(treeItem, index);
          return;
        }

        // 记录拖拽开始位置（右键点击时不记录）
        if (e.button !== 2) {
          isDragging = true;
          dragStartIndex = index;
        }

        // 新增：重置拖拽移动标志
        hasFileTreeDragged = false;

        // 🚀 处理文件选择（包括本地文件和压缩包内文件）
        // 🔧 重新设计拖选逻辑：mousedown时不设置防抖定时器，mouseup时根据是否拖动决定加载行为
        if (e.button !== 2) {
          if (e.ctrlKey || e.metaKey) {
            // 🔧 Ctrl+点击：切换选择状态，并立即加载该文件
            toggleFileSelection(index);
            console.log(`[Ctrl+点击] 文件 ${index} 已选中，立即加载`);

            // 🔧 立即加载所有选中的文件（包括刚刚选中的）
            // 使用防抖避免快速点击时重复加载
            if (fileLoadDebounceTimer) {
              clearTimeout(fileLoadDebounceTimer);
            }
            fileLoadDebounceTimer = setTimeout(() => {
              fileLoadDebounceTimer = null;
              console.log(`[Ctrl+点击] 加载 ${selectedFiles.length} 个选中的文件`);
              loadSelectedFiles();
            }, 100);
          } else {
            // 🔧 普通点击/拖选：清除之前的选择和所有内容，选择当前文件
            // 不设置防抖定时器，等待 mouseup 时决定加载行为
            clearFileSelectionAndTracking();
            selectFile(index);

            console.log(`[mousedown] 已选择文件 ${index}，等待 mouseup 决定加载行为`);
          }

          // 选择不改变展开/过滤：只刷新视口渲染即可
          renderFileTreeViewport(true);
        }
      }

      // 🚀 加载本地文件内容
      async function loadLocalFile(treeItem) {
        try {
          let content = null;

          // 🔧 优先使用 _fileContent（粘贴的文件已读取的内容）
          if (treeItem._fileContent) {
            console.log(`[loadLocalFile] 从内存加载粘贴文件: ${treeItem.name}`);
            content = treeItem._fileContent;
          } else if (!window.electronAPI || !window.electronAPI.readFile) {
            showMessage('读取文件 API 不可用');
            return;
          } else {
            // 🔧 使用 _originalPath（完整文件系统路径），回退到 path
            const filePath = treeItem._originalPath || treeItem.path;
            console.log(`[loadLocalFile] 开始加载: ${treeItem.name}`);

            // 清理旧数据
            cleanLogData();

            const result = await window.electronAPI.readFile(filePath);
            console.log(`[loadLocalFile] readFile 返回:`, result);

            if (!result || !result.success) {
              throw new Error(result?.error || '读取文件失败');
            }

            content = result.content;
          }

          if (content === null || content === undefined) {
            throw new Error('文件内容为空');
          }

          // 清理旧数据（如果还没有清理）
          if (treeItem._fileContent) {
            cleanLogData();
          }

          // 处理文件内容
          const lines = String(content).split('\n');
          originalLines = [];
          fileHeaders = [];

          // 添加文件头
          fileHeaders.push({
            fileName: treeItem.name,
            lineCount: lines.length,
            startIndex: 0
          });
          originalLines.push(`=== 文件: ${treeItem.name} (${lines.length} 行) ===`);

          // 🚀 性能优化：避免 forEach + push 导致的主线程阻塞
          const startIndex = originalLines.length;
          originalLines.length += lines.length;
          for (let i = 0; i < lines.length; i++) {
            originalLines[startIndex + i] = lines[i];
          }

          // 重置过滤并渲染
          resetFilter(false);
          renderLogLines();
          selectedOriginalIndex = -1;

          // 滚动到顶部
          if (outer) outer.scrollTop = 0;

          showMessage(`已加载 ${lines.length} 行`);
          console.log(`[loadLocalFile] 加载完成: ${lines.length} 行`);
        } catch (error) {
          console.error('[loadLocalFile] 加载失败:', error);
          showMessage('加载文件失败: ' + error.message);
        }
      }

      // 🚀 处理本地压缩包展开/折叠
      // 🚀 解压压缩包到当前路径
      async function extractArchiveToCurrentPath(archiveIndex) {
        const archive = fileTreeHierarchy[archiveIndex];
        if (!archive) {
          console.error(`[extractArchiveToCurrentPath] 压缩包不存在，index=${archiveIndex}`);
          showMessage("压缩包不存在");
          return;
        }

        if (!archive.isArchive) {
          showMessage("选中的不是压缩包");
          return;
        }

        // 获取压缩包的父目录（当前路径）
        const archivePath = archive._originalPath || archive.path;
        const lastSlashIndex = archivePath.lastIndexOf('/') !== -1
          ? archivePath.lastIndexOf('/')
          : archivePath.lastIndexOf('\\');

        if (lastSlashIndex === -1) {
          showMessage("无法确定压缩包的父目录");
          return;
        }

        const currentPath = archivePath.substring(0, lastSlashIndex);
        console.log(`[extractArchiveToCurrentPath] 压缩包: ${archivePath}`);
        console.log(`[extractArchiveToCurrentPath] 解压到: ${currentPath}`);

        // 确认对话框
        const confirmed = confirm(`确定要将 "${archive.name}" 解压到当前路径吗？\n\n目标路径: ${currentPath}`);
        if (!confirmed) return;

        try {
          if (!window.electronAPI || !window.electronAPI.extractArchive) {
            showMessage("解压功能不可用，请确保在Electron环境中运行");
            return;
          }

          showMessage("正在解压，请稍候...");

          const result = await window.electronAPI.extractArchive(archivePath, currentPath);

          if (result.success) {
            showMessage(`解压成功！已解压到: ${currentPath}`);

            // 刷新文件树
            if (archive.isRemote) {
              // 远程压缩包：刷新远程目录
              await refreshRemoteDirectory(archiveIndex);
            } else {
              // 本地压缩包：刷新本地目录
              await refreshLocalDirectory(currentPath);
            }
          } else {
            throw new Error(result.error || '解压失败');
          }
        } catch (error) {
          console.error(`[extractArchiveToCurrentPath] 解压失败:`, error);
          showMessage(`解压失败: ${error.message || error}`);
        }
      }

      // 🚀 刷新本地目录
      async function refreshLocalDirectory(dirPath) {
        try {
          if (!window.electronAPI || !window.electronAPI.listDirectory) {
            return;
          }

          console.log(`[refreshLocalDirectory] 刷新本地目录: ${dirPath}`);

          // 重新加载文件树
          if (serverBaseUrl) {
            // 混合模式：重新加载整个文件树
            await loadFileTree();
          } else {
            // 纯本地模式：显示提示
            showMessage("目录已刷新，请重新加载文件树查看更新");
          }
        } catch (error) {
          console.error(`[refreshLocalDirectory] 刷新失败:`, error);
        }
      }

      async function toggleLocalArchive(treeItem, index) {
        console.log(`[toggleLocalArchive] 处理本地压缩包: ${treeItem.path}`);
        console.log(`[toggleLocalArchive] treeItem.archiveName=${treeItem.archiveName}, treeItem.path=${treeItem.path}`);
        console.log(`[toggleLocalArchive] 当前 expanded=${treeItem.expanded}, childrenLoaded=${treeItem.childrenLoaded}`);

        // 🔧 并发防护：防止快速双击导致重复加载
        if (treeItem.loadingChildren) {
          console.log(`[toggleLocalArchive] 正在加载中，跳过重复点击`);
          return;
        }

        // 🔧 使用稳定键：name + path 的组合，避免路径变化导致的不匹配
        const archiveName = treeItem.archiveName || treeItem.path;
        console.log(`[toggleLocalArchive] 使用 archiveName: ${archiveName}`);
        console.log(`[toggleLocalArchive] expandedArchives 之前:`, Array.from(expandedArchives));

        if (treeItem.expanded) {
          // 折叠
          treeItem.expanded = false;
          expandedArchives.delete(archiveName);
          console.log(`[toggleLocalArchive] 折叠，从 expandedArchives 删除: ${archiveName}`);
          if (treeItem.childrenLoaded) {
            // 🔧 修复：压缩包现在和文件夹一样，不删除子项，只是隐藏
            // 调用统一的卸载函数
            unloadArchiveChildren(index);
            // 注意：不重置 childrenLoaded，这样下次展开时无需重新加载

            // 🔧 修复：只移除直接子项，保留压缩包本身
            if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
              // temporarilyIncludedNodes.delete(index);  // ❌ 不要删除压缩包本身！

              // 只移除直接子项（level = archive.level + 1）
              const childLevel = treeItem.level + 1;
              const nodesToRemove = [];

              for (let i = index + 1; i < fileTreeHierarchy.length; i++) {
                const node = fileTreeHierarchy[i];
                if (!node) continue;

                if (node.level <= treeItem.level) {
                  // 遇到同级或更高级的节点，停止搜索
                  break;
                }

                // 只移除直接子项（level = 父级 + 1）
                if (node.level === childLevel && temporarilyIncludedNodes.has(i)) {
                  nodesToRemove.push(i);
                }
              }

              for (const idx of nodesToRemove) {
                temporarilyIncludedNodes.delete(idx);
              }

              if (nodesToRemove.length > 0) {
                console.log(`[toggleLocalArchive] 折叠 ${treeItem.name} 时移除 ${nodesToRemove.length} 个直接子项:`, nodesToRemove);
              }
            }
          }
        } else {
          // 展开
          treeItem.expanded = true;
          expandedArchives.add(archiveName);
          console.log(`[toggleLocalArchive] 展开，添加到 expandedArchives: ${archiveName}`);

          // 🔧 修复：在加载子项之前先将压缩包本身添加到临时包含列表
          if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
            temporarilyIncludedNodes.add(index);
            console.log(`[toggleLocalArchive] 展开时添加压缩包本身到临时包含列表: ${treeItem.name}`);
          }

          // 🔧 修复：只在子项未加载时才加载
          if (!treeItem.childrenLoaded) {
            treeItem.loadingChildren = true;
            try {
              await loadLocalArchiveChildren(index);
            } catch (error) {
              console.error(`[toggleLocalArchive] 加载子项失败:`, error);
              treeItem.expanded = false;
              expandedArchives.delete(archiveName);
            } finally {
              treeItem.loadingChildren = false;
            }
          } else {
            // 子项已加载，跳过加载步骤，但需要重新添加直接子项到临时包含列表
            console.log(`[toggleLocalArchive] 子项已加载，跳过加载步骤`);

            // 🔧 修复：在过滤模式下，需要重新添加直接子项到临时包含列表
            if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
              const childLevel = treeItem.level + 1;
              let addedCount = 0;

              for (let i = index + 1; i < fileTreeHierarchy.length; i++) {
                const node = fileTreeHierarchy[i];
                if (!node) continue;

                if (node.level <= treeItem.level) {
                  break;
                }

                // 只添加直接子项（level = 父级 + 1）
                if (node.level === childLevel) {
                  temporarilyIncludedNodes.add(i);
                  addedCount++;
                }
              }

              if (addedCount > 0) {
                console.log(`[toggleLocalArchive] 重新添加了 ${addedCount} 个直接子项到临时包含列表`);
              }
            }
          }
        }

        console.log(`[toggleLocalArchive] expandedArchives 之后:`, Array.from(expandedArchives));
        console.log(`[toggleLocalArchive] treeItem.expanded 最终: ${treeItem.expanded}`);
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);
      }

      // 🚀 加载本地压缩包的子项
      async function loadLocalArchiveChildren(archiveIndex) {
        const archive = fileTreeHierarchy[archiveIndex];
        if (!archive) {
          console.error(`[loadLocalArchiveChildren] 压缩包不存在，index=${archiveIndex}`);
          return;
        }

        // 🔧 修复：如果子项已加载，检查是否实际存在
        if (archive.childrenLoaded) {
          const hasChildren = archiveIndex + 1 < fileTreeHierarchy.length &&
                               fileTreeHierarchy[archiveIndex + 1].level > archive.level;

          if (hasChildren) {
            // 子项已存在，无需重新加载
            console.log(`[loadLocalArchiveChildren] 子项已加载且存在，跳过加载: ${archive.name}`);
            return;
          } else {
            // 子项已加载但不存在（可能被删除了），需要重新加载
            console.log(`[loadLocalArchiveChildren] 子项标记为已加载但实际不存在，重新加载: ${archive.name}`);
            archive.childrenLoaded = false;
          }
        }

        console.log(`[loadLocalArchiveChildren] 开始加载: ${archive.path}`);
        console.log(`[loadLocalArchiveChildren] 路径详情: path="${archive.path}", toLowerCase="${archive.path.toLowerCase()}", endsWith='.zip'=${archive.path.toLowerCase().endsWith('.zip')}`);

        archive.loadingChildren = true;
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);

        try {
          // 🔧 优先使用 list-archive API (7z) 列出文件内容（懒加载，不读取整个文件）
          // 只有当 7z 不可用时才回退到 JSZip（需要读取整个文件到内存）
          let useJsjipFallback = false;

          if (window.electronAPI && window.electronAPI.listArchive) {
            // 优先使用 7z 列出文件（适用于所有格式：zip, 7z, rar 等）
            console.log(`[loadLocalArchiveChildren] 使用 list-archive API (7z) 解析压缩包`);
            const result = await window.electronAPI.listArchive(archive.path);
            console.log(`[loadLocalArchiveChildren] listArchive 返回:`, result);
            console.log(`[loadLocalArchiveChildren] result.success=${result.success}, result.files.length=${result.files?.length || 0}`);
            console.log(`[loadLocalArchiveChildren] result.error=${result.error || '(none)'}`);

            if (result.success) {
              // 7z 成功
              const childNodes = buildFirstLevelNodes(result.files, archive);
              archive._archiveFiles = result.files;

              // 插入到文件树
              const insertIndex = archiveIndex + 1;
              fileTreeHierarchy.splice(insertIndex, 0, ...childNodes);

              archive.childrenLoaded = true;
              archive.loadingChildren = false;

              console.log(`[loadLocalArchiveChildren] 已使用 7z 加载 ${childNodes.length} 个子项`);

              // 🔧 修复：如果在过滤模式下展开压缩包，将新加载的子项添加到临时包含列表
              if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
                console.log(`[loadLocalArchiveChildren] 在过滤模式下展开压缩包，将 ${childNodes.length} 个子项添加到临时包含列表`);
                // 计算子项的索引位置（插入位置之后的所有节点）
                const insertIndex = archiveIndex + 1;
                for (let i = 0; i < childNodes.length; i++) {
                  temporarilyIncludedNodes.add(insertIndex + i);
                }
              }

              rebuildFileTreeVisibleCache();
              renderFileTreeViewport(true);
              return;
            } else {
              // 7z 失败，对 ZIP 文件先尝试原生解析（不加载整个文件）
              const errorMsg = result.error || '';
              if (archive.path.toLowerCase().endsWith('.zip')) {
                // 优先尝试原生 ZIP 中央目录解析（无大小限制）
                if (window.electronAPI && window.electronAPI.listZipNative) {
                  console.log(`[loadLocalArchiveChildren] 7z 失败，尝试原生 ZIP 解析`);
                  try {
                    const nativeResult = await window.electronAPI.listZipNative(archive.path);
                    if (nativeResult.success && nativeResult.files && nativeResult.files.length > 0) {
                      const childNodes = buildFirstLevelNodes(nativeResult.files, archive);
                      archive._archiveFiles = nativeResult.files;
                      const insertIndex = archiveIndex + 1;
                      fileTreeHierarchy.splice(insertIndex, 0, ...childNodes);
                      archive.childrenLoaded = true;
                      archive.loadingChildren = false;
                      console.log(`[loadLocalArchiveChildren] 原生 ZIP 解析成功，${childNodes.length} 个子项`);
                      if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
                        const idx = archiveIndex + 1;
                        for (let i = 0; i < childNodes.length; i++) {
                          temporarilyIncludedNodes.add(idx + i);
                        }
                      }
                      rebuildFileTreeVisibleCache();
                      renderFileTreeViewport(true);
                      return;
                    } else {
                      console.log(`[loadLocalArchiveChildren] 原生 ZIP 解析失败: ${nativeResult.error}`);
                    }
                  } catch (nativeErr) {
                    console.log(`[loadLocalArchiveChildren] 原生 ZIP 解析异常: ${nativeErr.message}`);
                  }
                }
                // 原生解析也失败，回退到 JSZip
                useJsjipFallback = true;
                console.log(`[loadLocalArchiveChildren] 回退到 JSZip`);
              } else {
                throw new Error(result.error || '加载压缩包失败');
              }
            }
          } else {
            // listArchive API 不可用，只有 ZIP 文件可以用 JSZip
            if (archive.path.toLowerCase().endsWith('.zip')) {
              useJsjipFallback = true;
              console.log(`[loadLocalArchiveChildren] listArchive API 不可用，ZIP 文件使用 JSZip`);
            } else {
              throw new Error('listArchive API 不可用，无法打开非 ZIP 压缩包');
            }
          }

          // 🔧 回退方案：使用 JSZip 处理 ZIP 文件（需要读取整个文件到内存）
          if (useJsjipFallback) {
            console.log(`[loadLocalArchiveChildren] 使用 JSZip 加载 ZIP 文件`);
            await loadLocalZipWithJSZip(archive, archiveIndex);

            // 🔧 修复：如果在过滤模式下展开压缩包，将新加载的子项添加到临时包含列表
            if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
              console.log(`[loadLocalArchiveChildren] 在过滤模式下展开压缩包（JSZip），将子项添加到临时包含列表`);
              // 子项已经在 loadLocalZipWithJSZip 中插入到 fileTreeHierarchy
              const insertIndex = archiveIndex + 1;

              // 🔧 修复：只添加直接子项，与折叠时的逻辑保持一致
              const childLevel = archive.level + 1;
              let addedCount = 0;

              for (let i = insertIndex; i < fileTreeHierarchy.length; i++) {
                const node = fileTreeHierarchy[i];
                if (!node) continue;

                if (node.level <= archive.level) {
                  // 遇到同级或更高级的节点，停止搜索
                  break;
                }

                // 只添加直接子项（level = 父级 + 1）
                if (node.level === childLevel) {
                  temporarilyIncludedNodes.add(i);
                  addedCount++;
                }
              }

              console.log(`[loadLocalArchiveChildren] 添加了 ${addedCount} 个直接子项到临时包含列表`);
            }

            rebuildFileTreeVisibleCache();
            renderFileTreeViewport(true);
            return;
          }
        } catch (error) {
          console.error('[loadLocalArchiveChildren] 加载失败:', error);
          archive.loadingChildren = false;
          archive.expanded = false;
          showMessage('加载压缩包失败: ' + error.message);
        }

        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);
      }

      // 🚀 加载嵌套压缩包的内容（从父压缩包中读取）
      async function loadNestedArchiveChildren(nestedArchiveIndex) {
        const nestedArchive = fileTreeHierarchy[nestedArchiveIndex];

        console.log(`[嵌套压缩包] 开始加载: ${nestedArchive.path}`);

        if (!nestedArchive || !nestedArchive.isNestedArchive) {
          console.log('[嵌套压缩包] 不是嵌套压缩包');
          return;
        }

        if (nestedArchive.childrenLoaded) {
          console.log('[嵌套压缩包] 已加载');
          return;
        }

        // 🚀 限制嵌套深度，避免无限递归
        if (nestedArchive.level > 15) {
          showMessage('⚠️ 嵌套压缩包层级过深（>15层），无法继续展开');
          return;
        }

        nestedArchive.loadingChildren = true;
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);

        try {
          // 1. 找到父压缩包
          // nestedArchive.path 格式: "F:\WTGLMK-2064025.zip/bbklog.zip" 或 "/path/to/parent.zip/nested1.zip"
          // 需要提取父压缩包路径
          let parentArchivePath = nestedArchive.archiveName;

          console.log(`[嵌套压缩包] nestedArchive.path=${nestedArchive.path}`);
          console.log(`[嵌套压缩包] nestedArchive.archiveName=${parentArchivePath}`);

          // 🚀 修复：从 nestedArchive.path 中提取父压缩包路径
          // path 格式: "父压缩包完整路径/嵌套压缩包名称"
          // 例如: "F:\WTGLMK-2064025.zip/bbklog.zip" -> "F:\WTGLMK-2064025.zip"
          const fullPath = nestedArchive.path;
          const lastSlashIndex = fullPath.lastIndexOf('/');
          if (lastSlashIndex !== -1) {
            // 提取最后一个 / 之前的部分作为父压缩包路径
            parentArchivePath = fullPath.substring(0, lastSlashIndex);
          } else {
            // 如果没有 /，尝试使用 \
            const lastBackslashIndex = fullPath.lastIndexOf('\\');
            if (lastBackslashIndex !== -1) {
              parentArchivePath = fullPath.substring(0, lastBackslashIndex);
            }
          }

          console.log(`[嵌套压缩包] 提取的父压缩包路径: ${parentArchivePath}`);

          // 2. 从archiveData获取父压缩包的zip对象
          let parentZip = null;

          // 🚀 调试：输出archiveData的所有key和父压缩包信息
          console.log(`[嵌套压缩包] archiveData.size=${archiveData.size}`);
          console.log(`[嵌套压缩包] archiveData.keys:`, Array.from(archiveData.keys()));
          console.log(`[嵌套压缩包] 查找父压缩包: ${parentArchivePath}`);

          // 🚀 首先尝试从fileTreeHierarchy中找到父压缩包节点
          let parentNode = null;
          for (const node of fileTreeHierarchy) {
            if (node && node.path === parentArchivePath) {
              parentNode = node;
              console.log(`[嵌套压缩包] 找到父压缩包节点:`, {
                path: node.path,
                name: node.name,
                has_zipObject: !!node._zipObject,
                has_zipStructure: !!node._zipStructure,
                has_archiveFiles: !!node._archiveFiles,
                childrenLoaded: node.childrenLoaded
              });
              break;
            }
          }

          // 🚀 关键检查：如果父压缩包是用7z加载的（没有_zipObject），需要用JSZip重新加载
          if (parentNode && !parentNode._zipObject) {
            console.log(`[嵌套压缩包] 父压缩包未使用JSZip加载（可能使用7z），正在创建JSZip对象...`);

            // 🚀 显示加载提示
            showMessage('正在为嵌套zip加载父压缩包数据...');

            // 🚀 使用setTimeout避免阻塞主线程
            await new Promise(resolve => setTimeout(resolve, 50));

            try {
              // 检查文件大小
              if (parentNode.size && parentNode.size > 500 * 1024 * 1024) { // 500MB
                throw new Error('父压缩包文件过大（>500MB）');
              }

              console.log(`[嵌套压缩包] 读取父压缩包文件...`);

              // 🚀 轻量级方案：只读取zip数据，不重新构建文件树
              if (!window.electronAPI || !window.electronAPI.readFile) {
                throw new Error('readFile API 不可用');
              }

              const result = await window.electronAPI.readFile(parentNode.path);
              if (!result || !result.success) {
                throw new Error(result?.error || '读取父压缩包失败');
              }

              // 转换为Uint8Array
              let zipData;
              const content = result.content;
              if (content instanceof Uint8Array) {
                zipData = content;
              } else if (content instanceof ArrayBuffer) {
                zipData = new Uint8Array(content);
              } else if (Array.isArray(content)) {
                zipData = new Uint8Array(content);
              } else if (typeof content === 'string') {
                const encoding = result.encoding || 'utf-8';
                if (encoding === 'base64') {
                  const binaryString = atob(content);
                  zipData = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    zipData[i] = binaryString.charCodeAt(i);
                  }
                } else if (content.startsWith('data:')) {
                  const base64Data = content.split(',')[1];
                  const binaryString = atob(base64Data);
                  zipData = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    zipData[i] = binaryString.charCodeAt(i);
                  }
                } else {
                  throw new Error('收到文本数据，但需要二进制ZIP数据');
                }
              } else {
                throw new Error(`未知的数据格式: ${typeof content}`);
              }

              console.log(`[嵌套压缩包] 父压缩包数据大小: ${zipData.length} 字节`);

              // 让UI有机会更新
              await new Promise(resolve => setTimeout(resolve, 50));

              // 使用JSZip加载
              if (typeof JSZip === 'undefined') {
                throw new Error("JSZip 库未加载");
              }

              console.log(`[嵌套压缩包] 正在用JSZip加载...`);
              const zip = await JSZip.loadAsync(zipData);

              // 🚀 只保存zip对象，不重新构建文件树
              parentNode._zipObject = zip;

              console.log(`[嵌套压缩包] ✓ JSZip对象创建成功，不重新构建文件树`);
              parentZip = zip;

            } catch (error) {
              console.error(`[嵌套压缩包] 加载失败:`, error);

              if (error.message.includes('过大')) {
                showMessage('⚠️ ' + error.message + '\n\n建议：使用较小的压缩包或解压后查看');
              } else {
                showMessage('⚠️ 无法加载嵌套zip：' + error.message);
              }

              throw new Error(`无法加载父压缩包: ${error.message}`);
            } finally {
              showLoading(false);
            }
          }

          // 🚀 尝试多种方式查找父压缩包
          // 方式1: 优先使用fileTreeHierarchy中的zip对象
          if (parentNode && parentNode._zipObject && !parentZip) {
            parentZip = parentNode._zipObject;
            console.log(`[嵌套压缩包] 方式1成功: 从fileTreeHierarchy节点获取_zipObject`);
          }
          // 方式2: 尝试从archiveData查找（多种路径格式）
          else if (parentNode) {
            console.log(`[嵌套压缩包] 父节点存在但无_zipObject，尝试从archiveData查找...`);

            // 尝试所有可能的路径格式
            const pathVariants = [
              parentArchivePath,                                    // 原始路径
              parentArchivePath.replace(/\\/g, '/'),               // 单反斜杠转正斜杠
              parentArchivePath.replace(/\\/g, '\\\\'),            // 单反斜杠转双反斜杠
              parentArchivePath.replace(/\\\\/g, '\\').replace(/\\/g, '\\\\'), // 统一转双反斜杠
              parentNode.archiveName,                               // 节点的archiveName
            ];

            // 去重
            const uniqueVariants = [...new Set(pathVariants)];
            console.log(`[嵌套压缩包] 尝试的路径变体:`, uniqueVariants);

            for (const variant of uniqueVariants) {
              if (archiveData.has(variant)) {
                const archiveInfo = archiveData.get(variant);
                parentZip = archiveInfo.zip;
                console.log(`[嵌套压缩包] 方式2成功: 从archiveData找到 (${variant})`);
                break;
              }
            }
          }

          // 方式3: 全局遍历fileTreeHierarchy查找匹配的zip对象
          if (!parentZip) {
            console.log(`[嵌套压缩包] 未找到父节点或节点无zip对象，全局遍历查找...`);
            for (const node of fileTreeHierarchy) {
              if (node && node._zipObject) {
                const nodePath = node.path;
                // 标准化路径进行比较
                const normalizePath = (p) => p ? p.replace(/\\\\/g, '/').replace(/\\/g, '/') : '';
                const normalizedNodePath = normalizePath(nodePath);
                const normalizedParentPath = normalizePath(parentArchivePath);

                console.log(`[嵌套压缩包] 检查节点: ${node.name}, path=${nodePath}`);

                if (normalizedNodePath === normalizedParentPath ||
                    nodePath === parentArchivePath ||
                    node.archiveName === parentArchivePath) {
                  parentZip = node._zipObject;
                  console.log(`[嵌套压缩包] 方式3成功: 找到匹配节点 (${nodePath})`);
                  break;
                }
              }
            }
          }

          if (!parentZip) {
            throw new Error('找不到父压缩包，可能需要重新展开父压缩包');
          }

          // 3. 从父zip中读取嵌套zip的字节数据
          const nestedZipPath = nestedArchive._fullArchivePath;
          console.log(`[嵌套压缩包] 嵌套zip路径: ${nestedZipPath}`);

          const nestedZipEntry = parentZip.file(nestedZipPath);

          if (!nestedZipEntry) {
            throw new Error(`嵌套压缩包不存在: ${nestedZipPath}`);
          }

          // 4. 读取嵌套zip的字节数据
          console.log(`[嵌套压缩包] 开始读取嵌套zip字节数据...`);
          const nestedZipBytes = await nestedZipEntry.async('arraybuffer');
          console.log(`[嵌套压缩包] 读取完成，大小: ${nestedZipBytes.byteLength} 字节`);

          // 5. 用JSZip加载嵌套zip
          if (typeof JSZip === 'undefined') {
            throw new Error("JSZip 库未加载");
          }

          const nestedZip = await JSZip.loadAsync(nestedZipBytes);
          console.log(`[嵌套压缩包] JSZip加载成功`);

          // 6. 构建嵌套zip的文件树结构（复用现有逻辑）
          const newNodes = [];

          // 遍历嵌套zip，分离文件夹和文件
          const topLevelFolders = new Map();
          const topLevelFiles = new Map();

          nestedZip.forEach((relativePath, zipEntry) => {
            if (!relativePath) return;

            const parts = relativePath.split('/').filter(p => p.length > 0);
            if (parts.length === 0) return;

            const firstName = parts[0];

            if (zipEntry.dir || parts.length > 1) {
              // 文件夹
              if (!topLevelFolders.has(firstName)) {
                topLevelFolders.set(firstName, firstName + '/');
              }
            } else {
              // 文件
              if (!topLevelFiles.has(firstName)) {
                topLevelFiles.set(firstName, {
                  path: relativePath,
                  size: zipEntry._data?.uncompressedSize || 0
                });
              }
            }
          });

          console.log(`[嵌套压缩包] 顶级文件夹: ${topLevelFolders.size}, 顶级文件: ${topLevelFiles.size}`);

          // 创建文件夹节点
          for (const [name, pathInNestedArchive] of topLevelFolders) {
            const treePath = nestedArchive.path + "/" + name;
            const fullArchivePath = pathInNestedArchive.replace(/\/$/, '');

            const node = {
              name: name,
              path: treePath,
              type: 'folder',
              expanded: false,
              level: nestedArchive.level + 1,
              file: null,
              isArchiveChild: true,
              isNestedArchiveChild: true,  // 标记为嵌套压缩包子项
              archiveName: nestedArchive.path,
              archivePath: pathInNestedArchive,
              _fullArchivePath: fullArchivePath,
              childrenLoaded: false,
              loadingChildren: false,
              lazyLoad: true,
              isLocalDrive: true,
            };
            newNodes.push(node);
          }

          // 创建文件节点（递归检测嵌套压缩包）
          for (const [name, item] of topLevelFiles) {
            const treePath = nestedArchive.path + "/" + name;
            const lowerName = name.toLowerCase();
            const isDoubleNested = lowerName.endsWith('.zip') ||
                                  lowerName.endsWith('.7z') ||
                                  lowerName.endsWith('.rar') ||
                                  lowerName.endsWith('.tar') ||
                                  lowerName.endsWith('.gz');

            const node = {
              name: name,
              path: treePath,
              type: isDoubleNested ? 'archive' : 'file',
              subType: isDoubleNested ? getArchiveSubType(name) : undefined,
              expanded: false,
              level: nestedArchive.level + 1,
              file: null,
              isArchiveChild: true,
              isNestedArchiveChild: true,
              isNestedArchive: isDoubleNested,
              archiveName: nestedArchive.path,
              archivePath: item.path,
              _fullArchivePath: item.path,
              childrenLoaded: !isDoubleNested,
              loadingChildren: false,
              lazyLoad: isDoubleNested,
              isLocalDrive: true,
              size: item.size,
            };
            newNodes.push(node);
          }

          // 排序：文件夹在前，文件在后
          newNodes.sort((a, b) => {
            if (a.type !== b.type) {
              return a.type === 'folder' ? -1 : 1;
            }
            return naturalCompare(a.name, b.name);
          });

          // 7. 插入节点到文件树
          const insertAt = getFolderSubtreeEndIndex(nestedArchiveIndex);
          if (newNodes.length > 0) {
            fileTreeHierarchy.splice(insertAt, 0, ...newNodes);
            shiftSelectedIndices(insertAt, newNodes.length);
          }

          nestedArchive.childrenLoaded = true;

          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);

          console.log(`[嵌套压缩包] ✓ 展开成功: ${nestedArchive.name}, ${newNodes.length} 个子项`);

        } catch (error) {
          console.error('[嵌套压缩包] 展开失败:', error);
          showMessage('展开嵌套压缩包失败: ' + error.message);
        } finally {
          nestedArchive.loadingChildren = false;
        }
      }

      // 🚀 使用 JSZip 加载本地 ZIP 文件（在渲染进程中）
      async function loadLocalZipWithJSZip(archive, archiveIndex) {
        try {
          // 读取 ZIP 文件内容
          if (!window.electronAPI || !window.electronAPI.readFile) {
            throw new Error('readFile API 不可用');
          }

          const result = await window.electronAPI.readFile(archive.path);
          if (!result || !result.success) {
            throw new Error(result?.error || '读取 ZIP 文件失败');
          }

          console.log(`[loadLocalZipWithJSZip] 原始数据类型: ${Object.prototype.toString.call(result.content)}, 长度: ${result.content?.length || result.content?.byteLength || 'unknown'}`);

          // 🔧 正确处理各种数据类型，转换为 Uint8Array
          let zipData;
          const content = result.content;
          const encoding = result.encoding || 'utf-8';

          if (content instanceof Uint8Array) {
            zipData = content;
          } else if (content instanceof ArrayBuffer) {
            zipData = new Uint8Array(content);
          } else if (Array.isArray(content)) {
            // 数组格式
            zipData = new Uint8Array(content);
          } else if (typeof content === 'string') {
            // 字符串格式 - 检查编码方式
            if (encoding === 'base64') {
              // 🚀 Base64 编码的二进制数据
              console.log(`[loadLocalZipWithJSZip] 检测到 Base64 编码，开始解码...`);
              const binaryString = atob(content);
              zipData = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                zipData[i] = binaryString.charCodeAt(i);
              }
            } else if (content.startsWith('data:')) {
              // Data URL 格式
              const base64Data = content.split(',')[1];
              const binaryString = atob(base64Data);
              zipData = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                zipData[i] = binaryString.charCodeAt(i);
              }
            } else {
              // UTF-8 文本格式（用于文本日志文件）
              throw new Error(`收到文本数据，但需要二进制 ZIP 数据。encoding: ${encoding}`);
            }
          } else if (content && content.data) {
            // 可能是 { data: Uint8Array } 格式
            zipData = new Uint8Array(content.data);
          } else {
            throw new Error(`未知的数据格式: ${typeof content}, encoding: ${encoding}, constructor: ${content?.constructor?.name}`);
          }

          // 🚀 优化：避免输出大数组
          const sampleSize = Math.min(10, zipData.length);
          const hexPreview = Array.from(zipData.slice(0, sampleSize))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
          console.log(`[loadLocalZipWithJSZip] 转换后大小: ${zipData.length} 字节, 前${sampleSize}字节: ${hexPreview}`);

          // 验证 ZIP 文件头
          if (zipData[0] !== 0x50 || zipData[1] !== 0x4B || zipData[2] !== 0x03 || zipData[3] !== 0x04) {
            console.warn(`[loadLocalZipWithJSZip] 警告: 文件头不是 ZIP 格式 (PK..), 实际: ${Array.from(zipData.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
          }

          // 使用 JSZip 加载
          if (typeof JSZip === 'undefined') {
            throw new Error("JSZip 库未加载");
          }

          const zip = await JSZip.loadAsync(zipData);
          console.log(`[loadLocalZipWithJSZip] JSZip 加载成功`);

          // 构建文件结构
          const structure = await buildArchiveStructure(zip);

          // 保存 zip 对象和文件列表
          archive._zipObject = zip;
          archive._zipStructure = structure;

          // 将结构转换为第一层节点
          const childNodes = convertZipStructureToFirstLevelNodes(zip, structure, archive);

          // 🔍 调试：输出子节点详情
          console.log(`[loadLocalZipWithJSZip] 准备插入 ${childNodes.length} 个子项:`);
          childNodes.forEach((node, i) => {
            console.log(`  [${i}] name=${node.name}, type=${node.type}, isArchive=${node.isArchive}, isArchiveChild=${node.isArchiveChild}, isLocalDrive=${node.isLocalDrive}`);
          });

          // 插入到文件树
          const insertIndex = archiveIndex + 1;
          fileTreeHierarchy.splice(insertIndex, 0, ...childNodes);

          // 🔍 验证插入后的结果
          console.log(`[loadLocalZipWithJSZip] 插入位置: ${insertIndex}, 插入后的数组长度: ${fileTreeHierarchy.length}`);
          console.log(`[loadLocalZipWithJSZip] 插入后的节点:`, fileTreeHierarchy[insertIndex]);

          archive.childrenLoaded = true;
          archive.loadingChildren = false;

          console.log(`[loadLocalZipWithJSZip] 已加载 ${childNodes.length} 个子项`);
        } catch (error) {
          console.error('[loadLocalZipWithJSZip] 失败:', error);
          throw error;
        }
      }

      // 🚀 将 JSZip 结构转换为第一层节点
      function convertZipStructureToFirstLevelNodes(zip, structure, parentArchive) {
        const nodes = [];
        const firstLevelItems = new Map();

        // 遍历 ZIP 中的所有文件
        zip.forEach((relativePath, zipEntry) => {
          if (!relativePath) return;

          // 分割路径，获取第一层
          const parts = relativePath.split('/').filter(p => p.length > 0);
          if (parts.length === 0) return;

          const firstName = parts[0];

          // 检查是否已经处理过这个第一层项
          if (firstLevelItems.has(firstName)) {
            return;
          }

          // 判断是目录还是文件
          const isDirectory = zipEntry.dir || (parts.length > 1);

          // 🚀 检测是否是嵌套的压缩包
          const lowerName = firstName.toLowerCase();
          const isNestedArchive = !isDirectory && (
            lowerName.endsWith('.zip') ||
            lowerName.endsWith('.7z') ||
            lowerName.endsWith('.rar') ||
            lowerName.endsWith('.tar') ||
            lowerName.endsWith('.gz')
          );

          const node = {
            name: firstName,
            path: `${parentArchive.path}/${firstName}`,
            type: isDirectory ? 'folder' : (isNestedArchive ? 'archive' : 'file'),  // 🚀 嵌套压缩包标记为 archive
            subType: isNestedArchive ? getArchiveSubType(firstName) : undefined,
            expanded: false,
            level: parentArchive.level + 1,
            file: null,
            childrenLoaded: isDirectory ? false : !isNestedArchive,  // 🚀 嵌套压缩包标记为未加载，需要懒加载
            loadingChildren: false,
            lazyLoad: isDirectory || isNestedArchive,  // 🚀 目录和嵌套压缩包都需要懒加载
            isArchiveChild: true,
            isLocalDrive: true,
            isNestedArchive: isNestedArchive,  // 🚀 标记为嵌套压缩包
            archiveName: parentArchive.path,
            archivePath: firstName,
            _fullArchivePath: firstName,
            // 保存 zipEntry 信息用于后续懒加载
            _zipEntryName: firstName
          };

          if (!isDirectory) {
            node.size = zipEntry._data.uncompressedSize || 0;
            console.log(`[convertZipStructureToFirstLevelNodes] ${isNestedArchive ? '嵌套压缩包' : '文件'}: ${firstName}, size: ${node.size}`);
          } else {
            console.log(`[convertZipStructureToFirstLevelNodes] 目录: ${firstName}`);
          }

          firstLevelItems.set(firstName, node);
          nodes.push(node);
        });

        // 使用自然排序
        nodes.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
          }
          return naturalCompare(a.name, b.name);
        });

        console.log(`[convertZipStructureToFirstLevelNodes] 生成 ${nodes.length} 个第一层节点`);
        return nodes;
      }

      // 🚀 从压缩包文件列表构建第一层节点（懒加载模式）
      function buildFirstLevelNodes(files, parentArchive) {
        const nodes = [];
        const firstLevelItems = new Map(); // name -> {type, path, size, isDirectory}

        console.log(`[buildFirstLevelNodes] 处理 ${files.length} 个文件，提取第一层`);

        // 🚀 显示前 10 个文件路径用于调试（优化：转换为字符串避免输出大对象）
        const sampleSize = Math.min(10, files.length);
        const fileSample = files.slice(0, sampleSize).map(f => ({
          path: f.path.length > 50 ? f.path.substring(0, 50) + '...' : f.path,
          isDir: f.isDirectory
        }));
        console.log(`[buildFirstLevelNodes] 前 ${sampleSize} 个文件路径:`, JSON.stringify(fileSample));

        // 🔧 第一步：遍历所有文件，找出所有第一层名称并标记是否为目录
        for (const file of files) {
          if (!file.path) continue;

          // 分割路径，获取第一层
          const parts = file.path.split('/').filter(p => p.length > 0);
          if (parts.length === 0) continue;

          const firstName = parts[0];

          // 🔧 如果已经处理过，更新目录标志（只要有一个是目录，就是目录）
          if (firstLevelItems.has(firstName)) {
            const existing = firstLevelItems.get(firstName);
            // 如果当前是目录或路径有多层，更新为目录
            if (file.isDirectory || parts.length > 1) {
              existing.isDirectory = true;
            }
            continue;
          }

          // 🔧 判断是目录还是文件
          // 1. 明确标记为目录
          // 2. 路径有多层（说明第一层是目录）
          // 3. 后续遍历可能会更新这个标志
          const isDirectory = file.isDirectory || parts.length > 1;

          firstLevelItems.set(firstName, {
            name: firstName,
            path: file.path,
            isDirectory: isDirectory,
            size: isDirectory ? 0 : (file.size || 0)
          });
        }

        // 🔧 第二步：根据收集的信息创建节点
        for (const [name, info] of firstLevelItems) {
          // 🚀 检测是否是嵌套的压缩包
          const lowerName = name.toLowerCase();
          const isNestedArchive = !info.isDirectory && (
            lowerName.endsWith('.zip') ||
            lowerName.endsWith('.7z') ||
            lowerName.endsWith('.rar') ||
            lowerName.endsWith('.tar') ||
            lowerName.endsWith('.gz')
          );

          const node = {
            name: name,
            path: `${parentArchive.path}/${name}`,
            type: info.isDirectory ? 'folder' : (isNestedArchive ? 'archive' : 'file'),  // 🚀 嵌套压缩包标记为 archive
            subType: isNestedArchive ? getArchiveSubType(name) : undefined,
            expanded: false,
            level: parentArchive.level + 1,
            file: null,
            childrenLoaded: info.isDirectory ? false : !isNestedArchive,  // 🚀 嵌套压缩包标记为未加载
            loadingChildren: false,
            lazyLoad: info.isDirectory || isNestedArchive,  // 🚀 目录和嵌套压缩包都需要懒加载
            isArchiveChild: true,
            isLocalDrive: true,
            isNestedArchive: isNestedArchive,  // 🚀 标记为嵌套压缩包
            isArchive: isNestedArchive, // 只有嵌套压缩包才标记为 archive（普通文件/文件夹用 isArchiveChild 标识归属）
            archiveName: parentArchive.path,
            archivePath: name,
            // 保存完整路径用于懒加载子项
            _fullArchivePath: name
          };

          if (!info.isDirectory) {
            node.size = info.size;
            console.log(`[buildFirstLevelNodes] ${isNestedArchive ? '嵌套压缩包' : '文件'}: ${name}, size: ${node.size} (来自路径: ${info.path})`);
          } else {
            console.log(`[buildFirstLevelNodes] 目录: ${name} (来自路径: ${info.path})`);
          }

          nodes.push(node);
        }

        // 使用自然排序
        nodes.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
          }
          return naturalCompare(a.name, b.name);
        });

        console.log(`[buildFirstLevelNodes] 生成 ${nodes.length} 个第一层节点:`, nodes.map(n => `${n.name}(${n.type})`));
        return nodes;
      }

      // 🚀 将压缩包结构转换为文件树节点
      function convertArchiveStructureToNodes(structure, parentArchive, level, archivePath) {
        const nodes = [];
        const root = structure;

        console.log(`[convertArchiveStructureToNodes] 开始转换，dirs 数量: ${root.dirs?.size || 0}, children 键数量: ${Object.keys(root.children || {}).length}`);

        // 遍历所有直接子项（目录）
        let dirCount = 0;
        for (const dirName of root.dirs) {
          dirCount++;
          const dirNode = root.children[dirName];
          const node = {
            name: dirName,
            path: `${archivePath}/${dirName}`,
            type: 'folder',
            expanded: false,
            level: level,
            file: null,
            childrenLoaded: dirNode._shallow ? false : true,  // 浅层节点需要按需加载
            loadingChildren: false,
            isArchiveChild: true,
            archiveName: archivePath,
            archivePath: dirName,
            _archiveStructure: dirNode._shallow ? dirNode : null  // 保存结构用于按需加载
          };
          nodes.push(node);
          console.log(`[convertArchiveStructureToNodes] 添加目录: ${dirName}, 子项数: ${Object.keys(dirNode.children || {}).length}`);
        }
        console.log(`[convertArchiveStructureToNodes] 添加了 ${dirCount} 个目录`);

        // 添加文件
        let fileCount = 0;
        for (const [fileName, fileInfo] of Object.entries(root.children)) {
          if (fileName.endsWith('/')) continue;  // 跳过目录
          if (fileInfo.type === 'folder') continue;  // 跳过文件夹

          fileCount++;
          const node = {
            name: fileName,
            path: `${archivePath}/${fileName}`,
            type: 'file',
            level: level,
            file: null,
            isArchiveChild: true,
            archiveName: archivePath,
            archivePath: fileName,
            size: fileInfo.size || 0
          };
          nodes.push(node);
        }
        console.log(`[convertArchiveStructureToNodes] 添加了 ${fileCount} 个文件`);

        // 排序：文件夹在前，文件在后，使用 Windows 资源管理器风格的排序
        nodes.sort((a, b) => {
          // 1. 类型：文件夹在前，文件在后
          if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
          }

          // 2. 名称：使用自然排序（数字按数值大小）和系统默认排序
          return naturalCompare(a.name, b.name);
        });

        console.log(`[convertArchiveStructureToNodes] 总共生成 ${nodes.length} 个节点`);

        return nodes;
      }

      // 🚀 Windows 资源管理器风格的自然排序函数
      // 数字按数值大小排序（file1, file2, file10 而不是 file1, file10, file2）
      function naturalCompare(a, b) {
        // 使用 Intl.Collator 进行系统默认的字符串比较
        // numeric: true 启用数字排序，sensitivity: 'base' 忽略大小写和重音
        const collator = new Intl.Collator(undefined, {
          numeric: true,
          sensitivity: 'base',
          caseFirst: 'lower' // 小写字母优先（与 Windows 一致）
        });
        return collator.compare(a, b);
      }

      // 🚀 从文件列表构建压缩包结构（用于 .7z, .tar.gz 等原生格式）
      function buildArchiveStructureFromFiles(files) {
        const root = { type: 'folder', name: '', children: {}, fileCount: 0, dirs: new Set() };

        if (!files || !Array.isArray(files)) {
          console.error('[buildArchiveStructureFromFiles] 无效的输入:', files);
          return root;
        }

        console.log(`[buildArchiveStructureFromFiles] 开始处理 ${files.length} 个文件`);

        for (const file of files) {
          // 验证文件对象
          if (!file || !file.path) {
            console.warn('[buildArchiveStructureFromFiles] 跳过无效文件:', file);
            continue;
          }

          const parts = file.path.split('/').filter(p => p.length > 0);

          if (parts.length === 0) {
            console.warn('[buildArchiveStructureFromFiles] 跳过空路径:', file.path);
            continue;
          }

          let current = root;

          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;

            // 确保 current.children 存在
            if (!current.children) {
              console.error(`[buildArchiveStructureFromFiles] current.children 不存在，当前路径: ${file.path}, part: ${part}`);
              current.children = {};
            }

            if (isLast) {
              // 文件
              current.children[part] = {
                type: 'file',
                name: part,
                path: file.path,
                size: file.size || 0
              };
              root.fileCount++;
            } else {
              // 目录
              if (!current.children[part]) {
                // 创建新目录，确保包含 dirs 属性
                current.children[part] = {
                  type: 'folder',
                  name: part,
                  path: parts.slice(0, i + 1).join('/'),
                  children: {},
                  dirs: new Set()  // 🚀 重要：每个目录都需要 dirs 属性
                };
                current.dirs.add(part);
              } else if (!current.children[part].children) {
                // 如果对象存在但缺少 children 属性，说明之前被当作文件处理了
                // 需要修复：补充 children 属性并添加到 dirs
                console.warn(`[buildArchiveStructureFromFiles] 修复缺少 children 的目录: ${part}`);
                current.children[part].children = {};
                current.children[part].type = 'folder'; // 确保类型是 folder
                current.children[part].dirs = new Set(); // 🚀 重要：添加 dirs 属性
                current.dirs.add(part); // 🚀 重要：添加到 dirs 集合
              } else if (!current.children[part].dirs) {
                // 如果对象有 children 但没有 dirs，补充 dirs 属性
                current.children[part].dirs = new Set();
              }
              current = current.children[part];
            }
          }
        }

        console.log(`[buildArchiveStructureFromFiles] 完成，共 ${root.fileCount} 个文件`);
        return root;
      }

      // 切换服务端压缩包展开/折叠状态
      async function toggleRemoteArchive(archiveItem) {
        const index = fileTreeHierarchy.indexOf(archiveItem);
        if (index === -1) return;

        // 防止快速重复点击
        if (archiveItem.loadingChildren) {
          console.log("[DEBUG] Already loading children, skipping");
          return;
        }

        // 🔧 判断是否为拖拽压缩包（在 archiveData 中但不是远程的）
        const isInArchiveData = archiveItem.archiveName && archiveData.has(archiveItem.archiveName);
        const isDraggedArchive = isInArchiveData && !archiveItem.isRemote;

        // 切换展开状态
        archiveItem.expanded = !archiveItem.expanded;

        // 🔧 拖拽压缩包需要同步更新 expandedArchives 集合
        if (isDraggedArchive) {
          if (archiveItem.expanded) {
            expandedArchives.add(archiveItem.archiveName);
            console.log("[DEBUG] Added to expandedArchives:", archiveItem.archiveName);
          } else {
            expandedArchives.delete(archiveItem.archiveName);
            console.log("[DEBUG] Removed from expandedArchives:", archiveItem.archiveName);
          }
        }

        if (archiveItem.expanded && !archiveItem.childrenLoaded) {
          // 展开：按需加载子项
          await loadRemoteArchiveChildren(index);
        }

        // 展开/折叠会改变可见列表：重建缓存并虚拟渲染
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);
      }

      // 文件树点击事件 - 处理驱动器展开/文件夹展开
      function handleFileTreeClick(e) {
        const item = e.target.closest(".file-tree-item");

        // 🔧 点击空白区域时清除文件选择，释放内存
        if (!item) {
          if (selectedFiles.length > 0) {
            console.log(`[点击空白区域] 清除 ${selectedFiles.length} 个文件选择`);
            clearFileSelection();
            renderFileTreeViewport(true);
            // 释放内存
            cleanLogData();
          }
          return;
        }

        const index = parseInt(item.dataset.index);
        if (isNaN(index)) return;

        const treeItem = fileTreeHierarchy[index];
        if (!treeItem) return;

        console.log(`[文件树点击] index=${index}, type=${treeItem.type}, name=${treeItem.name}, isLocalDrive=${treeItem.isLocalDrive}`);

        // 🚀 处理本地驱动器/文件夹的展开
        if (treeItem.type === 'drive' || (treeItem.type === 'folder' && treeItem.isLocalDrive)) {
          console.log(`[文件树点击] 触发本地文件夹展开: ${treeItem.name}`);
          toggleLocalFolder(treeItem, index);
          return;
        }

        // 🚀 处理远程文件夹的展开
        if (treeItem.isRemote && treeItem.type === 'folder') {
          console.log(`[文件树点击] 触发远程文件夹展开: ${treeItem.name}`);
          toggleRemoteFolder(treeItem, index);
          return;
        }

        // 注意：不再处理压缩包展开/折叠，避免与 mousedown 事件冲突
        // 压缩包的展开/折叠已在 handleFileTreeMouseDown 中处理
      }

      // 🚀 切换本地文件夹/驱动器的展开状态
      async function toggleLocalFolder(folderItem, index, forceRefresh = false) {
        console.log(`[toggleLocalFolder] 开始: ${folderItem.name}, expanded=${folderItem.expanded}, childrenLoaded=${folderItem.childrenLoaded}, forceRefresh=${forceRefresh}`);

        // 防止快速重复点击
        if (folderItem.loadingChildren) {
          console.log('[文件树] 正在加载子项，跳过');
          return;
        }

        // 切换展开状态
        folderItem.expanded = !folderItem.expanded;
        console.log(`[toggleLocalFolder] 切换后 expanded=${folderItem.expanded}`);

        if (folderItem.expanded) {
          // 🔧 修复：展开时，先添加文件夹本身到临时包含列表（无论是否已加载）
          if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
            temporarilyIncludedNodes.add(index);
            console.log(`[toggleLocalFolder] 展开时添加文件夹本身到临时包含列表: ${folderItem.name}`);
          }

          // 只有在需要加载子项时才执行加载逻辑
          if (!folderItem.childrenLoaded || forceRefresh) {
            // 展开：按需加载子项（或强制刷新）
            console.log(`[toggleLocalFolder] 需要加载子项，forceRefresh=${forceRefresh}`);

            // 如果是强制刷新，先卸载现有子项
            if (forceRefresh && folderItem.childrenLoaded) {
              console.log(`[toggleLocalFolder] 强制刷新，先卸载现有子项`);
              folderItem.childrenLoaded = false;
              unloadLocalFolderChildren(index);
            }

            // 🚀 检查是否是压缩包内的文件夹或懒加载文件夹
            if (folderItem.isArchiveChild) {
              console.log(`[toggleLocalFolder] 压缩包内的文件夹，使用 loadLocalArchiveFolderChildren`);
              await loadLocalArchiveFolderChildren(index);
            } else if (folderItem.lazyLoad || folderItem._isLazyDir) {
              console.log(`[toggleLocalFolder] 懒加载文件夹，使用 loadFolderChildren`);
              await loadFolderChildren(index);
            } else {
              console.log(`[toggleLocalFolder] 本地磁盘文件夹，使用 loadLocalFolderChildren`);
              await loadLocalFolderChildren(index);
            }
          } else {
            // 子项已加载，跳过加载步骤，但需要重新添加直接子项到临时包含列表
            console.log(`[toggleLocalFolder] 子项已加载，跳过加载步骤`);

            // 🔧 修复：在过滤模式下，需要重新添加直接子项到临时包含列表
            if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
              const childLevel = folderItem.level + 1;
              let addedCount = 0;

              for (let i = index + 1; i < fileTreeHierarchy.length; i++) {
                const node = fileTreeHierarchy[i];
                if (!node) continue;

                if (node.level <= folderItem.level) {
                  // 遇到同级或更高级的节点，停止搜索
                  break;
                }

                // 只添加直接子项（level = 父级 + 1）
                if (node.level === childLevel) {
                  temporarilyIncludedNodes.add(i);
                  addedCount++;
                }
              }

              if (addedCount > 0) {
                console.log(`[toggleLocalFolder] 重新添加了 ${addedCount} 个直接子项到临时包含列表`);
              }
            }
          }
        } else if (!folderItem.expanded && folderItem.childrenLoaded) {
          // 折叠：移除子项
          console.log(`[toggleLocalFolder] 折叠，移除子项`);
          // 🚀 停止文件系统监听
          stopWatchingDirectory(folderItem.path);
          unloadLocalFolderChildren(index);

          // 🚀 在只显示匹配项模式下，从临时包含列表中移除折叠的文件夹的子项
          if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
            // 🔧 修复：只移除该文件夹的直接子项，保留文件夹本身
            // 文件夹本身必须保留在 temporarilyIncludedNodes 中，否则在过滤模式下会消失
            // temporarilyIncludedNodes.delete(index);  // ❌ 不要删除文件夹本身！

            // 遍历文件树，找到所有直接子项并移除
            const childLevel = folderItem.level + 1;
            const nodesToRemove = [];

            for (let i = index + 1; i < fileTreeHierarchy.length; i++) {
              const node = fileTreeHierarchy[i];
              if (!node) continue;

              if (node.level <= folderItem.level) {
                // 遇到同级或更高级的节点，停止搜索
                break;
              }

              // 只移除直接子项（level = 父级 + 1）
              if (node.level === childLevel && temporarilyIncludedNodes.has(i)) {
                nodesToRemove.push(i);
              }
            }

            for (const idx of nodesToRemove) {
              temporarilyIncludedNodes.delete(idx);
            }

            if (nodesToRemove.length > 0) {
              console.log(`[toggleLocalFolder] 折叠 ${folderItem.name} 时移除 ${nodesToRemove.length} 个直接子项:`, nodesToRemove);
            }
          }
        }

        // 重新渲染
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);
      }

      // 🚀 处理远程文件夹展开/折叠
      async function toggleRemoteFolder(folderItem, index) {
        console.log(`[toggleRemoteFolder] 开始: ${folderItem.name}, expanded=${folderItem.expanded}, childrenLoaded=${folderItem.childrenLoaded}, loadingChildren=${folderItem.loadingChildren}`);

        // 防止快速重复点击
        if (folderItem.loadingChildren) {
          console.log('[文件树] 正在加载子项，跳过');
          return;
        }

        // 切换展开状态
        folderItem.expanded = !folderItem.expanded;
        console.log(`[toggleRemoteFolder] 切换后 expanded=${folderItem.expanded}`);

        if (folderItem.expanded) {
          // 🔧 修复：展开时，先添加文件夹本身到临时包含列表（无论是否已加载）
          if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
            temporarilyIncludedNodes.add(index);
            console.log(`[toggleRemoteFolder] 展开时添加文件夹本身到临时包含列表: ${folderItem.name}`);
          }

          // 检查是否有实际子项在树中
          const hasChildrenInTree = index + 1 < fileTreeHierarchy.length &&
                                    fileTreeHierarchy[index + 1].level > folderItem.level;

          if (!folderItem.childrenLoaded || (folderItem.childrenLoaded && !hasChildrenInTree)) {
            // 需要加载子项：
            // 1. childrenLoaded=false，从未加载过
            // 2. childrenLoaded=true 但子项不在树中（可能被过滤移除了）
            console.log(`[toggleRemoteFolder] 需要加载远程文件夹子项 (childrenLoaded=${folderItem.childrenLoaded}, hasChildrenInTree=${hasChildrenInTree})`);
            await loadRemoteFolderChildren(index);
          } else {
            // 子项已加载，跳过加载步骤，但需要重新添加直接子项到临时包含列表
            console.log(`[toggleRemoteFolder] 子项已加载，跳过加载步骤`);

            // 🔧 修复：在过滤模式下，需要重新添加直接子项到临时包含列表
            if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
              const childLevel = folderItem.level + 1;
              let addedCount = 0;

              for (let i = index + 1; i < fileTreeHierarchy.length; i++) {
                const node = fileTreeHierarchy[i];
                if (!node) continue;

                if (node.level <= folderItem.level) {
                  // 遇到同级或更高级的节点，停止搜索
                  break;
                }

                // 只添加直接子项（level = 父级 + 1）
                if (node.level === childLevel) {
                  temporarilyIncludedNodes.add(i);
                  addedCount++;
                }
              }

              if (addedCount > 0) {
                console.log(`[toggleRemoteFolder] 重新添加了 ${addedCount} 个直接子项到临时包含列表`);
              }
            }
          }
        } else {
          // 🚀 折叠时，在只显示匹配项模式下从临时包含列表中移除子项
          if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
            // 🔧 修复：只移除该文件夹的直接子项，保留文件夹本身
            // 文件夹本身必须保留在 temporarilyIncludedNodes 中，否则在过滤模式下会消失
            // temporarilyIncludedNodes.delete(index);  // ❌ 不要删除文件夹本身！

            // 遍历文件树，找到所有直接子项并移除
            const childLevel = folderItem.level + 1;
            const nodesToRemove = [];

            for (let i = index + 1; i < fileTreeHierarchy.length; i++) {
              const node = fileTreeHierarchy[i];
              if (!node) continue;

              if (node.level <= folderItem.level) {
                // 遇到同级或更高级的节点，停止搜索
                break;
              }

              // 只移除直接子项（level = 父级 + 1）
              if (node.level === childLevel && temporarilyIncludedNodes.has(i)) {
                nodesToRemove.push(i);
              }
            }

            for (const idx of nodesToRemove) {
              temporarilyIncludedNodes.delete(idx);
            }

            if (nodesToRemove.length > 0) {
              console.log(`[toggleRemoteFolder] 折叠 ${folderItem.name} 时移除 ${nodesToRemove.length} 个直接子项:`, nodesToRemove);
            }
          }
        }

        // 重新渲染
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);
      }

      // 🚀 加载本地文件夹/驱动器的子项
      async function loadLocalFolderChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder) {
          console.error(`[loadLocalFolderChildren] 文件夹不存在，index=${folderIndex}`);
          return;
        }

        // 🔧 优先使用 _originalPath（真实路径），否则使用 path（相对路径）
        const folderPath = folder._originalPath || folder.path;
        console.log(`[loadLocalFolderChildren] 开始加载: ${folder.path}，真实路径: ${folderPath}`);

        folder.loadingChildren = true;
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);

        try {
          if (!window.electronAPI || !window.electronAPI.listDirectory) {
            throw new Error('listDirectory API 不可用');
          }

          const result = await window.electronAPI.listDirectory(folderPath);
          console.log(`[loadLocalFolderChildren] API返回:`, result);

          if (!result.success) {
            throw new Error(result.error || '加载失败');
          }

          console.log(`[loadLocalFolderChildren] ${folder.path} 包含 ${result.items.length} 个项`, result.items);

          // 计算插入位置（当前文件夹后面）
          const insertIndex = folderIndex + 1;

          // 创建子节点
          const childNodes = [];
          for (const item of result.items) {
            const isArchive = item.type === 'archive' || item.isArchive;
            const childNode = {
              name: item.name,
              path: item.path,
              type: item.type,
              expanded: false,
              level: folder.level + 1,
              file: null,
              childrenLoaded: false,
              loadingChildren: false,
              isLocalDrive: true,
              isArchive: isArchive,
              // 如果是压缩包，设置 archiveName
              archiveName: isArchive ? item.path : undefined,
              size: item.size || 0
            };
            childNodes.push(childNode);
          }

          // 插入到文件树
          fileTreeHierarchy.splice(insertIndex, 0, ...childNodes);

          folder.childrenLoaded = true;
          folder.loadingChildren = false;

          // 🔧 暂时禁用文件监听，避免文件树不稳定
          console.log(`[文件监听] 文件监听已禁用，避免文件树重建`);
          // startWatchingDirectory(folder.path);

          console.log(`[loadLocalFolderChildren] 已加载 ${childNodes.length} 个子项`);

          // 🔧 修复：如果在过滤模式下展开文件夹，将新加载的子项添加到临时包含列表
          if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
            console.log(`[loadLocalFolderChildren] 在过滤模式下展开文件夹，将 ${childNodes.length} 个子项添加到临时包含列表`);
            const insertIndex = folderIndex + 1;
            for (let i = 0; i < childNodes.length; i++) {
              temporarilyIncludedNodes.add(insertIndex + i);
            }
          }
        } catch (error) {
          console.error('[loadLocalFolderChildren] 加载子项失败:', error);
          folder.loadingChildren = false;
          folder.expanded = false;
          showMessage('加载失败: ' + error.message);
        }

        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);
      }

      // 🚀 卸载压缩包的子项（折叠时）
      // 🔧 修复：与文件夹保持一致，不删除子节点，只是通过 expanded=false 隐藏它们
      // 这样可以避免索引失效导致 temporarilyIncludedNodes 混乱
      function unloadArchiveChildren(archiveIndex) {
        const archive = fileTreeHierarchy[archiveIndex];
        if (!archive) return;

        // 🔧 不再移除子项，保持层级结构（与文件夹一致）
        // 子项会通过 archive.expanded = false 在 computeVisibleByExpandState 中被隐藏
        const childCount = findSubtreeEnd(archiveIndex) - archiveIndex - 1;
        console.log(`[压缩包] 折叠压缩包: ${archive.name}，保留 ${childCount} 个子项（不再删除）`);

        // 设置为折叠状态（不删除子节点）
        archive.expanded = false;

        // 释放 JSZip 对象和文件列表，释放内存
        delete archive._zipObject;
        delete archive._archiveFiles;

        // 保持 childrenLoaded = true，这样下次展开时不需要重新加载
        // archive.childrenLoaded = false;  // 不再重置
      }

      // 🚀 卸载本地文件夹的子项（折叠时）
      // 🔧 修改：不删除子节点，只是通过 expanded=false 隐藏它们
      // 这样再次展开时可以保持之前的层级结构
      function unloadLocalFolderChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder) return;

        // 🔧 不再移除子项，保持层级结构
        // 子项会通过 folder.expanded = false 在 computeVisibleByExpandState 中被隐藏
        // 保留 childrenLoaded = true 以便下次展开时无需重新加载
        console.log(`[文件树] 折叠文件夹: ${folder.name}，保留 ${findSubtreeEnd(folderIndex) - folderIndex - 1} 个子项`);

        // 设置为折叠状态（不删除子节点）
        folder.expanded = false;
        // 保持 childrenLoaded = true，这样下次展开时不需要重新加载
        // folder.childrenLoaded = false;  // 不再重置
      }

      // 🚀 查找文件夹的子树结束位置
      function findSubtreeEnd(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder) return folderIndex + 1;

        let endIndex = folderIndex + 1;
        for (let i = folderIndex + 1; i < fileTreeHierarchy.length; i++) {
          const item = fileTreeHierarchy[i];
          if (item.level <= folder.level) {
            break;
          }
          endIndex = i + 1;
        }
        return endIndex;
      }

      // 切换压缩包展开/折叠状态 - 添加防抖防止快速重复点击
      let lastArchiveToggleTime = 0;
      const ARCHIVE_TOGGLE_DEBOUNCE = 100; // 100ms 防抖时间
      
      function toggleArchiveExpansion(archiveName) {
        const now = Date.now();
        // 防抖：如果在短时间内重复点击，忽略
        if (now - lastArchiveToggleTime < ARCHIVE_TOGGLE_DEBOUNCE) {
          lastArchiveToggleTime = now;
          return;
        }
        lastArchiveToggleTime = now;

        if (expandedArchives.has(archiveName)) {
          expandedArchives.delete(archiveName);
          // 🔧 折叠时重建文件树，保留盘符
          const newHierarchy = buildFileTreeHierarchy(fileTreeData);
          fileTreeHierarchy = [...persistentDriveNodes, ...newHierarchy];
          renderFileTree();
        } else {
          expandedArchives.add(archiveName);
          // 展开时异步加载内容
          expandArchive(archiveName);
        }
      }

      // 防止文件夹快速重复点击
      let folderToggleLock = false;

      // 切换文件夹展开/折叠状态（远程文件夹：按需加载）
      async function toggleFolder(folderElement) {
        // 防止快速重复点击
        if (folderToggleLock) return;
        folderToggleLock = true;

        try {
          const index = parseInt(folderElement.dataset.index);
          const folder = fileTreeHierarchy[index];

          if (!folder) return;

          // 切换展开状态
          const wasExpanded = folder.expanded;
          folder.expanded = !folder.expanded;

          console.log(`[懒加载] 文件夹 "${folder.name}" ${folder.expanded ? '展开' : '折叠'}`);

          // 展开：按需加载子项
          if (folder.expanded) {
            // 🔧 优先处理远程文件夹展开（不依赖 childrenLoaded 状态）
            if (folder.isRemote && folder.type === "folder" && !folder.childrenLoaded) {
              console.log(`[懒加载] 加载远程文件夹 "${folder.name}" 的子项`);
              await loadRemoteFolderChildren(index);
            } else if (folder.isArchiveChild && folder.isRemote && folder.type === "folder" && !folder.childrenLoaded) {
              // 压缩包远程子目录
              await loadArchiveSubfolderChildren(index);
            } else if (!folder.childrenLoaded && folder.lazyLoad) {
              // 🚀 本地文件夹懒加载（包括压缩包文件夹）
              console.log(`[懒加载] 加载文件夹 "${folder.name}" 的子项`);
              if (folder.isArchiveChild && folder.isLocalDrive) {
                // 🚀 本地压缩包文件夹懒加载
                await loadLocalArchiveFolderChildren(index);
              } else if (folder.isArchiveChild) {
                // 压缩包文件夹懒加载（远程）
                await loadArchiveFolderChildren(index);
              } else {
                // 普通本地文件夹懒加载
                await loadFolderChildren(index);
              }

              // 🔧 修复：如果在过滤模式下展开文件夹，将新加载的子项添加到临时包含列表
              if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
                console.log(`[懒加载] 在过滤模式下展开文件夹，将子项添加到临时包含列表`);
                const insertIndex = index + 1;

                // 🔧 修复：只添加直接子项，与折叠时的逻辑保持一致
                const childLevel = folder.level + 1;
                let addedCount = 0;

                for (let i = insertIndex; i < fileTreeHierarchy.length; i++) {
                  const node = fileTreeHierarchy[i];
                  if (!node) continue;

                  if (node.level <= folder.level) {
                    // 遇到同级或更高级的节点，停止搜索
                    break;
                  }

                  // 只添加直接子项（level = 父级 + 1）
                  if (node.level === childLevel) {
                    temporarilyIncludedNodes.add(i);
                    addedCount++;
                  }
                }

                console.log(`[懒加载] 添加了 ${addedCount} 个直接子项到临时包含列表`);
              }
            }
          }

          // 折叠：释放子项内存（懒加载模式）
          if (!folder.expanded && wasExpanded && folder.lazyLoad && folder.childrenLoaded) {
            console.log(`[懒加载] 释放文件夹 "${folder.name}" 的子项内存`);
            // 根据文件夹类型调用不同的卸载函数
            if (folder.isArchiveChild) {
              unloadArchiveFolderChildren(index);
            } else {
              unloadFolderChildren(index);
            }
          }

          // 展开/折叠会改变可见列表：重建缓存并虚拟渲染
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);
        } finally {
          // 短暂延迟后释放锁，防止快速双击
          setTimeout(() => { folderToggleLock = false; }, 100);
        }
      }

      // 加载懒加载文件夹的子项
      async function loadFolderChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder || !folder.lazyLoad) return;

        // 标记加载中
        folder.loadingChildren = true;
        renderFileTreeViewport(true);

        try {
          let childFiles = [];

          // 模式1：_isLazyDir 虚拟文件夹 - 通过 electronAPI.readFolder 动态读取
          if (folder._isLazyDir) {
            console.log(`[懒加载] 通过 electronAPI 读取文件夹 "${folder.name}"`);

            if (!window.electronAPI || !window.electronAPI.listFolder) {
              throw new Error("electronAPI.listFolder 不可用");
            }

            const folderName = folder.name || 'unknown';
            let folderPath = '';
            let results = [];

            // 定义带超时的列出函数
            const listFolderWithTimeout = async (path, timeoutMs = 5000, options = {}) => {
              return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  resolve({ success: false, error: '超时' });
                }, timeoutMs);

                window.electronAPI.listFolder(path, options).then(res => {
                  clearTimeout(timeout);
                  resolve(res);
                }).catch(err => {
                  clearTimeout(timeout);
                  reject(err);
                });
              });
            };

            // 1. 【最优先】直接使用 _originalPath（如果存在）
            if (folder._originalPath) {
              folderPath = folder._originalPath;
              console.log(`[懒加载] 使用 _originalPath: ${folderPath}`);
              results = await listFolderWithTimeout(folderPath);
              if (results && Array.isArray(results) && results.length > 0) {
                console.log(`[懒加载] ✅ _originalPath 成功`);
              }
            }

            // 2. 如果 _originalPath 失败，使用智能搜索功能（优先于 Bandizip 临时目录）
            if (!results || !Array.isArray(results) || results.length === 0) {
              console.log(`[懒加载] 启动智能搜索: ${folderName}`);

              try {
                if (window.electronAPI && window.electronAPI.searchFolder) {
                  const searchResult = await window.electronAPI.searchFolder(folderName);
                  if (searchResult && searchResult.success && searchResult.path) {
                    // 找到匹配的文件夹
                    if (searchResult.multipleMatches && searchResult.matches && searchResult.matches.length > 1) {
                      // 找到多个匹配，使用对话框让用户选择
                      console.log(`[懒加载] ⚠️ 找到 ${searchResult.matches.length} 个同名文件夹，需要用户选择`);

                      if (window.electronAPI && window.electronAPI.showFolderSelectionDialog) {
                        const dialogResult = await window.electronAPI.showFolderSelectionDialog({
                          folderName: folderName,
                          matches: searchResult.matches
                        });

                        if (!dialogResult.cancelled && dialogResult.selectedPath) {
                          console.log(`[懒加载] ✅ 用户选择: ${dialogResult.selectedPath}`);
                          const tempResults = await listFolderWithTimeout(dialogResult.selectedPath);
                          if (tempResults && Array.isArray(tempResults) && tempResults.length > 0) {
                            results = tempResults;
                            folderPath = dialogResult.selectedPath;

                            // 🔧 记录父目录到最近访问列表，便于后续搜索子文件夹
                            // 使用字符串操作获取父目录
                            const lastSep = Math.max(dialogResult.selectedPath.lastIndexOf('\\'), dialogResult.selectedPath.lastIndexOf('/'));
                            const parentDir = lastSep >= 0 ? dialogResult.selectedPath.substring(0, lastSep) : dialogResult.selectedPath;

                            if (window.electronAPI && window.electronAPI.addRecentDirectory) {
                              window.electronAPI.addRecentDirectory(parentDir).catch(err => {
                                console.error('[懒加载] 记录最近目录失败:', err);
                              });
                              console.log(`[懒加载] 已记录父目录到最近访问: ${parentDir}`);
                            }
                          }
                        } else {
                          console.log(`[懒加载] ⚠️ 用户取消选择`);
                        }
                      } else {
                        // 降级方案：使用第一个匹配
                        console.log(`[懒加载] ⚠️ 对话框不可用，使用第一个匹配`);
                        const tempResults = await listFolderWithTimeout(searchResult.path);
                        if (tempResults && Array.isArray(tempResults) && tempResults.length > 0) {
                          results = tempResults;
                          folderPath = searchResult.path;
                        }
                      }
                    } else {
                      // 唯一匹配，直接使用
                      console.log(`[懒加载] ✅ 智能搜索找到: ${searchResult.path}`);
                      const tempResults = await listFolderWithTimeout(searchResult.path);
                      if (tempResults && Array.isArray(tempResults) && tempResults.length > 0) {
                        results = tempResults;
                        folderPath = searchResult.path;
                      }
                    }
                  } else {
                    console.log(`[懒加载] ⚠️ 智能搜索未找到: ${searchResult?.error || '未知错误'}`);
                  }
                }
              } catch (e) {
                console.error(`[懒加载] 智能搜索出错:`, e);
              }
            }

            // 3. 如果智能搜索也失败，才尝试 Bandizip 临时目录搜索
            if (!results || !Array.isArray(results) || results.length === 0) {
              console.log(`[懒加载] 尝试搜索 Bandizip 临时目录: ${folderName}`);
              // 使用文件夹名作为路径，让 main 进程在 Bandizip 临时目录中搜索
              const tempResults = await listFolderWithTimeout(folderName, 5000, { searchBandizipTemp: true });
              if (tempResults && Array.isArray(tempResults) && tempResults.length > 0 && tempResults[0].success !== false) {
                results = tempResults;
                folderPath = folderName;
                console.log(`[懒加载] ✅ Bandizip 临时目录搜索成功`);
              }
            }

            // 4. 如果都没找到，提示用户（Bandizip 等压缩软件的文件夹无真实路径）
            if (!results || !Array.isArray(results) || results.length === 0) {
              console.warn(`[懒加载] 所有自动路径都失败，提示用户`);

              // 检测是否为 Bandizip 等压缩软件拖拽的文件夹（路径以 / 开头）
              const isCompressedFolder = folder._originalPath && folder._originalPath.startsWith('/');

              if (isCompressedFolder) {
                showMessage(`⚠️ 无法从压缩软件展开文件夹

💡 检测到这是从压缩软件（如 Bandizip、WinRAR）拖拽的文件夹。

📦 推荐方案：

1. 【推荐】直接从资源管理器拖拽该文件夹
   - 在文件管理器中找到 "${folderName}" 文件夹
   - 直接拖拽到本应用

2. 或者：从压缩软件拖拽整个压缩包
   - 将 .zip/.rar 等文件拖拽到本应用
   - 支持懒加载浏览`);
              } else {
                showMessage(`⚠️ 无法展开文件夹 "${folderName}"

💡 浏览器安全限制：直接拖拽单个文件夹时无法获取完整路径

📂 推荐方案：

1. 【最佳】使用"打开文件夹"按钮浏览文件夹
   - 点击左上角"打开文件夹"按钮
   - 选择要查看的文件夹

2. 或者：直接拖拽文件夹内的文件
   - 打开文件夹，选中多个文件
   - 拖拽到本应用

3. 或者：拖拽整个压缩包（.zip/.rar等）
   - 支持直接浏览压缩包内容`);
              }

              folder.loadingChildren = false;
              folder.childrenLoaded = false;
              renderFileTreeViewport(true);
              return;
            }

            console.log(`[懒加载] 最终文件夹路径: ${folderPath}`);

            // 过滤成功读取的条目
            const successResults = results.filter(r => r.success);

            if (successResults.length === 0) {
              throw new Error(`读取文件夹失败：未读取到任何有效文件`);
            }

            // 🔧 移除文件数量限制，显示所有文件和文件夹
            const limitedResults = successResults;
            console.log(`[懒加载] 读取到 ${limitedResults.length} 个子项`);

            // 直接构建子项列表（listFolder 已经返回直接子项）
            childFiles = limitedResults.map(result => {
              const fullPath = result.path.replace(/\\/g, '/');

              if (result.isDirectory) {
                // 子文件夹：创建懒加载虚拟文件夹
                return {
                  name: result.name,
                  kind: "directory",
                  type: "folder",
                  fullPath: fullPath,
                  path: fullPath,
                  isLocalDrive: true, // 🔧 标记为本地文件
                  _isLazyDir: true,
                  _originalPath: result.path, // 保留原始路径格式
                  level: folder.level + 1,
                  lazyLoad: true,
                  childrenLoaded: false,
                  expanded: false
                };
              } else {
                // 文件：创建文件节点（不包含内容，点击时才读取）
                const fileObj = {
                  name: result.name,
                  path: result.path,
                  fullPath: fullPath,
                  webkitRelativePath: fullPath,
                  size: result.size,
                  _fromPath: true,
                  _lazyFile: true  // 标记为懒加载文件
                };

                return {
                  name: result.name,
                  type: "file",
                  path: fullPath,
                  fullPath: fullPath,
                  level: folder.level + 1,
                  file: fileObj,  // 文件对象存储在 file 属性中
                  expanded: false
                };
              }
            });

            // 排序：文件夹优先，同类型按名称排序
            childFiles.sort((a, b) => {
              const aIsDir = a.type === "folder";
              const bIsDir = b.type === "folder";
              // 文件夹优先
              if (aIsDir && !bIsDir) return -1;
              if (!aIsDir && bIsDir) return 1;
              // 同类型按名称排序
              return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });

            console.log(`[懒加载] 文件夹 "${folder.name}" 读取到 ${childFiles.length} 个直接子项`);
          }
          // 模式2：从已保存的文件列表中筛选子项
          else {
            const rawFiles = folder._rawFiles || fileTreeData;
            const folderPath = folder.path + "/";

            // 筛选属于该文件夹直接子项的文件和子文件夹
            childFiles = rawFiles.filter(file => {
              const filePath = file.fullPath || file.webkitRelativePath || "";
              // 只匹配直接子项（路径以 folderPath 开头，但不包含更深层级的 /）
              if (!filePath.startsWith(folderPath)) return false;

              const relativePath = filePath.substring(folderPath.length);
              // 直接子项不应该包含 /
              return !relativePath.includes("/");
            });

            console.log(`[懒加载] 文件夹 "${folder.name}" 找到 ${childFiles.length} 个直接子项`);
          }

          if (childFiles.length === 0) {
            folder.hasChildren = false;
            folder.childrenLoaded = true;
            folder.loadingChildren = false;
            renderFileTreeViewport(true);
            return;
          }

          // 直接插入子项到 hierarchy（不使用 buildFileTreeHierarchy）
          const childHierarchy = childFiles.map(child => ({
            ...child,
            expanded: false,
            lazyLoad: child._isLazyDir || false,
            _isLazyDir: child._isLazyDir || false
          }));

          // 在 hierarchy 中找到文件夹的位置，并在其后插入子项
          const insertIndex = fileTreeHierarchy.findIndex((item, idx) =>
            idx > folderIndex && item.level <= folder.level
          );

          // 移除已加载的占位符，插入实际子项
          fileTreeHierarchy.splice(folderIndex + 1, 0, ...childHierarchy);

          // 标记为已加载
          folder.childrenLoaded = true;
          folder.hasChildren = childHierarchy.length > 0;
          folder.loadingChildren = false;

          console.log(`[懒加载] 文件夹 "${folder.name}" 子项加载完成，新增 ${childHierarchy.length} 个节点`);
        } catch (error) {
          console.error(`[懒加载] 加载文件夹 "${folder.name}" 子项失败:`, error);
          folder.loadingChildren = false;
          folder.childrenLoaded = false;
          showMessage(`加载文件夹 "${folder.name}" 失败: ${error.message}`);
        }
      }

      // 释放懒加载文件夹的子项内存
      function unloadFolderChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder || !folder.lazyLoad) return;

        // 找到并移除该文件夹的所有直接子项（直到遇到同级或更高级的节点）
        let removeCount = 0;
        const targetLevel = folder.level;

        for (let i = folderIndex + 1; i < fileTreeHierarchy.length; i++) {
          const item = fileTreeHierarchy[i];
          if (!item) continue;

          // 如果遇到同级或更高级的节点，停止移除
          if (item.level <= targetLevel) {
            break;
          }

          // 递归释放子文件夹的内存
          if (item.type === "folder" && item.childrenLoaded) {
            unloadFolderChildren(i - removeCount);
          }

          // 释放文件对象的引用
          if (item.file) {
            item.file = null;
          }

          removeCount++;
        }

        // 批量移除子项
        if (removeCount > 0) {
          fileTreeHierarchy.splice(folderIndex + 1, removeCount);
        }

        // 标记为未加载
        folder.childrenLoaded = false;
        folder.hasChildren = false;

        console.log(`[懒加载] 释放文件夹 "${folder.name}" 的 ${removeCount} 个子项内存`);
      }

      // 文件树鼠标移动事件（用于拖拽选择）- 优化：减少残影，按拖拽顺序选择
      function handleFileTreeMouseMove(e) {
        // console.log(`[mousemove] isDragging=${isDragging}, target=`, e.target); // 🚀 已禁用：日志太多
        if (!isDragging) return;

        // 新增：标记发生了拖拽移动
        hasFileTreeDragged = true;

        const item = e.target.closest(".file-tree-item");
        if (!item) return;

        const index = parseInt(item.dataset.index);
        if (isNaN(index)) return;

        dragEndIndex = index;

        // 清除当前拖拽范围内的选择（重新按顺序添加）
        const start = Math.min(dragStartIndex, dragEndIndex);
        const end = Math.max(dragStartIndex, dragEndIndex);

        // 移除当前拖拽范围内的文件（保留拖拽范围之外的选择）
        selectedFiles = selectedFiles.filter(
          (f) => f.index < start || f.index > end
        );

        // 🚀 始终按照从上到下的顺序（索引从小到大）收集文件
        const indices = [];
        for (let i = start; i <= end; i++) {
          indices.push(i);
        }

        // 🚀 使用递增计数器，确保按照从上到下的顺序加载
        indices.forEach((i) => {
          // 只选择可见的文件项目
          if (isFileTreeIndexVisible(i)) {
            const item = fileTreeHierarchy[i];
            if (item && item.type === "file") {
              // 检查是否已经在选择集中
              const alreadySelected = selectedFiles.some(f => f.index === i);
              if (!alreadySelected) {
                selectedFiles.push({
                  index: i,
                  order: ++selectionOrderCounter // 🚀 按从上到下顺序递增
                });
              }
            }
          }
        });

        console.log(`[拖拽选择] 选择了 ${selectedFiles.length} 个文件，顺序: 从索引 ${start} 到 ${end}`);

        // 拖拽选择不改变展开/过滤：只刷新当前视口，避免全量重建
        scheduleRenderFileTreeViewport(true);
      }

      // 文件树鼠标释放事件 - 根据是否拖动决定加载行为
      function handleFileTreeMouseUp() {
        if (isDragging) {
          isDragging = false;

          if (hasFileTreeDragged) {
            // 🔧 发生了拖动：加载所有选中的文件（按照选中顺序）
            console.log(`[mouseup] 发生了拖动，加载 ${selectedFiles.length} 个选中的文件`);
            loadSelectedFiles();
          } else {
            // 🔧 没有拖动（只是单击或多选）
            console.log(`[mouseup] 没有拖动，selectedFiles.length=${selectedFiles.length}`);
            if (selectedFiles.length > 0) {
              // 🚀 性能优化：生成当前选中的快照，与上次比较，避免重复加载
              const currentKey = selectedFiles.map(f => f.index + ':' + f.order).join(',');
              if (currentKey === lastLoadedSelectionKeys) {
                console.log(`[mouseup] 选中未变化，跳过加载`);
                return;
              }
              lastLoadedSelectionKeys = currentKey;

              if (selectedFiles.length > 1) {
                // 🔧 多选（Ctrl+点击）：加载所有选中的文件
                console.log(`[mouseup] 多选模式，加载 ${selectedFiles.length} 个选中的文件`);
                loadSelectedFiles();
              } else {
                // 🔧 单选：只加载第一个文件
                const firstFile = selectedFiles[0];
                selectedFiles = [firstFile];
                loadSelectedFiles();
              }
            }
          }
        }
      }

      // 切换文件选择状态
      function toggleFileSelection(index) {
        // 🔧 修复：在过滤模式下，只要文件存在于 fileTreeHierarchy 中，就可以切换选择状态
        const item = fileTreeHierarchy[index];
        if (!item || item.type !== "file") return;

        const fileIndex = selectedFiles.findIndex(f => f.index === index);
        if (fileIndex === -1) {
          // 添加选择顺序记录，使用递增计数器
          selectedFiles.push({
            index,
            order: ++selectionOrderCounter
          });
          console.log(`[toggleFileSelection] 添加文件 ${index} (${item.name})，选择顺序: ${selectionOrderCounter}`);
        } else {
          // 🔧 取消选中时：先增加 sessionId 停止之前的加载，然后移除该文件的内容
          console.log(`[toggleFileSelection] 移除文件 ${index}`);
          selectedFiles.splice(fileIndex, 1);
          console.log(`[toggleFileSelection] 剩余 ${selectedFiles.length} 个文件`);

          // 🔧 取消防德的 loadSelectedFiles 调用
          if (fileLoadDebounceTimer) {
            clearTimeout(fileLoadDebounceTimer);
            fileLoadDebounceTimer = null;
            console.log(`[toggleFileSelection] 已取消防德的加载调用`);
          }

          // 🔧 关键：先增加 sessionId，使正在执行的 loadSelectedFiles 失效
          ++currentLoadingSession;
          console.log(`[toggleFileSelection] 已增加 sessionId 到 ${currentLoadingSession}，停止之前的加载操作`);

          // 🔧 直接移除该文件的内容，而不是清空所有内容重新加载
          // 这样可以避免重新加载其他文件
          removeFileContent(index);

          // 重新渲染日志
          resetFilter(false);
          renderLogLines();
          selectedOriginalIndex = -1;

          if (selectedFiles.length > 0) {
            showMessage(`已移除文件: ${item.name}，剩余 ${selectedFiles.length} 个文件`);
          } else {
            showMessage(`已移除文件: ${item.name}`);
          }
        }
      }

      // 选择单个文件
      function selectFile(index) {
        const item = fileTreeHierarchy[index];
        if (!item) {
          console.log(`[selectFile] 节点不存在，index=${index}`);
          return;
        }

        // 🔧 只选择文件，不选择文件夹、驱动器或压缩包
        if (item.type !== "file") {
          console.log(`[selectFile] item.type=${item?.type}，不是文件，无法选择`);
          return;
        }

        // 🔧 修复：在过滤模式下，即使文件不在当前可见集合中，也可以选择
        // 只要文件存在于 fileTreeHierarchy 中就可以选择
        console.log(`[selectFile] 选择文件 ${index} (${item.name})`);

        // 🔧 清空所有日志内容和跟踪状态，确保单文件模式下干净加载
        originalLines = [];
        fileHeaders = [];
        loadedFileIndices.clear();
        fileIndexToHeaderIndices.clear();
        isIncrementalLoad = false;

        // 重置为只选择当前文件，并重置计数器
        selectionOrderCounter = 1; // 重置计数器
        selectedFiles = [{
          index,
          order: selectionOrderCounter
        }];
      }

      // 清除文件选择（不清除内容跟踪）
      function clearFileSelection() {
        selectedFiles = [];
        selectionOrderCounter = 0; // 重置计数器
        console.log(`[clearFileSelection] 已清空文件选择`);
      }

      // 清除文件选择和内容跟踪（完全清空）
      function clearFileSelectionAndTracking() {
        selectedFiles = [];
        selectionOrderCounter = 0; // 重置计数器
        // 🔧 清空已加载文件跟踪和映射
        loadedFileIndices.clear();
        fileIndexToHeaderIndices.clear();
        console.log(`[clearFileSelectionAndTracking] 已清空文件选择和内容跟踪`);
      }

      // 清除拖拽选择
      function clearDragSelection() {
        // 只保留在可见范围内的选择
        selectedFiles = selectedFiles.filter(
          (fileObj) =>
            isFileTreeIndexVisible(fileObj.index) &&
            (fileObj.index === dragStartIndex ||
              (fileObj.index >= Math.min(dragStartIndex, dragEndIndex) &&
                fileObj.index <= Math.max(dragStartIndex, dragEndIndex)))
        );
      }

      // 构建文件树层次结构
      // 自然排序函数（类似 sort -V）：按版本号顺序排序
      function naturalSort(a, b) {
        // 使用 localeCompare 的 numeric 选项实现自然排序
        // 这会将数字部分按数值大小排序，而不是字符串排序
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      }

      // 文件树懒加载配置
      const FILE_TREE_LAZY_LOAD_ENABLED = true; // 是否启用懒加载

      function buildFileTreeHierarchy(files, options = {}) {
        const {
          lazyLoad = FILE_TREE_LAZY_LOAD_ENABLED, // 默认启用懒加载
          maxLevel = lazyLoad ? 1 : Infinity, // 懒加载时只构建第一层级
          parentPath = "", // 父路径（用于递归）
          baseLevel = 0 // 基础层级
        } = options;

        const hierarchy = [];
        const pathMap = {};
        const childrenMap = {}; // 用于存储每个路径的子项
        const folderPaths = new Set(); // 记录所有文件夹路径

        // 第一遍：收集所有文件夹路径和文件
        files.forEach((file) => {
          // 处理压缩包文件
          if (file.isArchive) {
            const archiveInfo = archiveData.get(file.archiveName);
            if (archiveInfo) {
              // 添加压缩包条目
              const archiveItem = {
                name: file.name,
                path: file.archiveName,
                type: "archive",
                expanded: false,
                level: 0,
                isArchive: true,
                archiveName: file.archiveName,
                fileCount: archiveInfo.structure.fileCount,
                // 🔧 复制 isLocalDrive 属性（用于区分本地和远程压缩包）
                isLocalDrive: file.isLocalDrive,
                // 🔧 拖拽的文件可能没有 size，从 archiveInfo 获取
                size: file.size || archiveInfo.structure.fileCount
              };
              pathMap[file.archiveName] = archiveItem;
              hierarchy.push(archiveItem);

              // 如果压缩包已展开，添加其内容
              if (expandedArchives.has(file.archiveName)) {
                addArchiveContentsToHierarchy(file.archiveName, archiveInfo.structure, 0, pathMap, childrenMap, hierarchy);
              }
            }
            return;
          }

          // 处理懒加载模式的虚拟文件夹条目
          if (file._isLazyDir) {
            const path = file.fullPath;
            const parts = path.split("/");
            const folderName = parts[parts.length - 1];
            const folderPath = path;

            // 直接创建文件夹条目
            const item = {
              name: folderName,
              path: folderPath,
              type: "folder",
              expanded: false,
              level: baseLevel,
              lazyLoad: true,
              childrenLoaded: false,
              isLocalDrive: file.isLocalDrive !== undefined ? file.isLocalDrive : true, // 🔧 默认标记为本地文件
              _rawFiles: files, // 保存原始文件引用
              _isLazyDir: true, // 保留标记
              _originalPath: file._originalPath // 🔧 保持原始路径（拖拽的文件夹为 undefined，触发智能搜索）
            };

            pathMap[folderPath] = item;
            folderPaths.add(folderPath);
            // 确保 childrenMap[""] 已初始化
            if (!childrenMap[""]) {
              childrenMap[""] = [];
            }
            childrenMap[""].push(item);
            return;
          }

          // 🚀 关键优化：检测是否为独立文件拖拽（不是文件夹上传）
          // 如果 fullPath 以盘符开头（Windows 绝对路径），说明是独立文件，不应该创建文件夹层次
          const isWindowsAbsolutePath = file.fullPath && /^[A-Za-z]:\//.test(file.fullPath);
          const hasFolderStructure = file.webkitRelativePath && file.webkitRelativePath.includes('/');

          // 🔧 保存完整文件系统路径（Electron 环境中的 file.path）
          const originalPath = file.path || file.fullPath;

          // 优先使用 fullPath，然后是 webkitRelativePath，最后是 name
          // 对于 Windows 绝对路径的独立文件，只使用文件名
          let path;
          if (isWindowsAbsolutePath && !hasFolderStructure) {
            // 独立文件拖拽：只使用文件名，不创建文件夹层次
            path = file.name;
            console.log(`🚀 [独立文件] ${file.name} 不使用完整路径，避免创建文件夹层次`);
            // 🔧 标记为懒加载文件夹，触发智能搜索
            file._isLazyDir = true;
          } else {
            // 文件夹拖拽：使用完整路径
            path = file.fullPath || file.webkitRelativePath || file.name;
          }

          const parts = path.split("/");
          const totalParts = parts.length;

          let currentPath = "";
          for (let i = 0; i < totalParts; i++) {
            const part = parts[i];
            // 🔧 拖拽的文件夹即使只有一级路径，也应该被识别为文件夹
            const isFile = i === totalParts - 1 && !file._isLazyDir;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (!pathMap[currentPath]) {
              // 🔧 判断是否为第一层文件夹：没有子路径 或 拖拽的文件夹
              const isFirstLevelFolder = (!isFile && i === 0) || file._isLazyDir;

              const item = {
                name: part,
                path: currentPath,
                type: isFile ? "file" : "folder",
                expanded: false,
                level: i,
                file: isFile ? file : null,
                isLocalDrive: file.isLocalDrive !== undefined ? file.isLocalDrive : true, // 🔧 默认标记为本地文件
              };

              // 🔧 保存完整文件系统路径（用于读取文件）
              if (isFile && originalPath) {
                item._originalPath = originalPath;
              }

              // 🔧 保存粘贴文件的内容（用于直接加载）
              if (isFile && file._fileContent) {
                item._fileContent = file._fileContent;
              }

              // 懒加载模式：标记第一层文件夹
              if (lazyLoad && isFirstLevelFolder) {
                item.lazyLoad = true;
                item.childrenLoaded = false;
                item._rawFiles = files; // 保存原始文件引用，用于后续动态加载
              }

              // 🔧 对于拖拽的文件夹，添加 _isLazyDir 标记
              if (file._isLazyDir) {
                item._isLazyDir = true;
              }

              // 记录文件夹路径
              if (!isFile) {
                folderPaths.add(currentPath);
              }

              pathMap[currentPath] = item;

              // 获取父路径
              const parentPathKey = i > 0 ? parts.slice(0, i).join("/") : "";

              // 初始化父路径的子项数组
              if (!childrenMap[parentPathKey]) {
                childrenMap[parentPathKey] = [];
              }

              // 添加到父路径的子项数组
              childrenMap[parentPathKey].push(item);
            }
          }
        });

        // 递归排序每个层级的子项
        function sortChildren(pathKey) {
          const children = childrenMap[pathKey] || [];
          // 对子项进行自然排序
          children.sort((a, b) => naturalSort(a.name, b.name));

          // 递归排序每个子文件夹的子项
          children.forEach(child => {
            if (child.type === "folder") {
              sortChildren(child.path);
            }
          });
        }

        // 从根路径开始排序
        sortChildren("");

        // 按层级和排序后的顺序构建最终层次结构
        function buildHierarchy(pathKey, level) {
          const children = childrenMap[pathKey] || [];
          children.forEach(child => {
            // 懒加载模式：只构建到指定层级
            if (lazyLoad && level >= maxLevel && child.type === "folder") {
              // 标记为有子项但未加载
              child.hasChildren = folderPaths.has(child.path);
              child.childrenLoaded = false;
              // 不递归子项
            } else {
              hierarchy.push(child);
              if (child.type === "folder") {
                buildHierarchy(child.path, level + 1);
              }
            }
          });
        }

        buildHierarchy("", baseLevel);

        return hierarchy;
      }

      // 将压缩包内容添加到层次结构中
      // 🚀 优化：只构建第一层目录，子节点按需懒加载
      function addArchiveContentsToHierarchy(archiveName, structure, level, pathMap, childrenMap, hierarchy) {
        const prefix = `${archiveName}/`;

        // 🚀 只处理第一层节点，不递归
        if (!structure || !structure.children) return;

        for (const [name, child] of Object.entries(structure.children)) {
          const fullPath = `${archiveName}/${name}`;

          if (child.type === 'folder') {
            // 🚀 文件夹：检查是否为浅层节点
            const isShallow = child._shallow || false;

            const folderItem = {
              name: name,
              path: fullPath,
              type: "folder",
              expanded: false,
              level: level + 1,
              isArchiveChild: true,
              archiveName: archiveName,
              // 🚀 懒加载标记
              lazyLoad: true,
              childrenLoaded: false,
              // 🚀 浅层节点标记（需要从 zip 动态加载）
              _shallow: isShallow,
              // 保存子节点引用（仅用于非浅层节点）
              _childNode: isShallow ? undefined : child,
              // 保存文件夹路径（用于浅层节点动态加载）
              _folderPath: isShallow ? fullPath : undefined
            };
            pathMap[fullPath] = folderItem;
            hierarchy.push(folderItem);
          } else if (child.type === 'file') {
            // 文件：直接添加
            const fileItem = {
              name: name,
              path: fullPath,
              type: "file",
              expanded: false,
              level: level + 1,
              isArchiveChild: true,
              archiveName: archiveName,
              archivePath: child.path,
              file: child.file
            };
            pathMap[fullPath] = fileItem;
            hierarchy.push(fileItem);
          }
        }
      }

      // 🚀 新增：加载本地压缩包文件夹的子节点（懒加载）
      async function loadLocalArchiveFolderChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder) return;

        console.log(`[本地压缩包懒加载] 加载文件夹 "${folder.name}" 的子项`);

        // 标记加载中
        folder.loadingChildren = true;
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);

        try {
          // 🚀 检查是否是 ZIP 压压包（使用 JSZip）
          const parentArchive = findParentArchive(folder);

          // 🔧 优先检查拖拽压缩包（在 archiveData 中）
          if (parentArchive && parentArchive.archiveName && archiveData.has(parentArchive.archiveName)) {
            console.log(`[本地压缩包懒加载] 使用 archiveData 中的 JSZip 加载子文件夹`);
            const archiveInfo = archiveData.get(parentArchive.archiveName);
            // 创建一个临时的 parentArchive 对象，包含 JSZip 引用
            const tempArchive = {
              ...parentArchive,
              _zipObject: archiveInfo.zip
            };
            await loadZipFolderWithJSZip(folder, tempArchive);
          } else if (parentArchive && parentArchive._zipObject) {
            console.log(`[本地压缩包懒加载] 使用 JSZip 加载子文件夹`);
            await loadZipFolderWithJSZip(folder, parentArchive);
          } else if (parentArchive && parentArchive._archiveFiles) {
            // 使用文件列表模式（7z/tar）
            console.log(`[本地压缩包懒加载] 使用文件列表模式`);
            await loadArchiveFolderFromFileList(folder, parentArchive);
          } else {
            throw new Error('找不到压缩包数据');
          }

          // 🔧 修复：如果在过滤模式下展开压缩包文件夹，将新加载的子项添加到临时包含列表
          if (fileTreeSearchShowOnlyMatches && fileTreeSearchTerm) {
            console.log(`[loadFolderChildren] 在过滤模式下展开压缩包文件夹，将子项添加到临时包含列表`);
            const folderIndex = fileTreeHierarchy.indexOf(folder);
            const insertIndex = folderIndex + 1;

            // 🔧 修复：只添加直接子项，与折叠时的逻辑保持一致
            const childLevel = folder.level + 1;
            let addedCount = 0;

            for (let i = insertIndex; i < fileTreeHierarchy.length; i++) {
              const node = fileTreeHierarchy[i];
              if (!node) continue;

              if (node.level <= folder.level) {
                // 遇到同级或更高级的节点，停止搜索
                break;
              }

              // 只添加直接子项（level = 父级 + 1）
              if (node.level === childLevel) {
                temporarilyIncludedNodes.add(i);
                addedCount++;
              }
            }

            console.log(`[loadFolderChildren] 添加了 ${addedCount} 个直接子项到临时包含列表`);
          }

          // 🔧 加载完成后重建缓存
          rebuildFileTreeVisibleCache();
        } catch (error) {
          console.error('[本地压缩包懒加载] 失败:', error);
          folder.loadingChildren = false;
          folder.expanded = false;
          showMessage('加载失败: ' + error.message);
          rebuildFileTreeVisibleCache();
        }

        renderFileTreeViewport(true);
      }

      // 🚀 使用 JSZip 加载 ZIP 内的子文件夹
      async function loadZipFolderWithJSZip(folder, parentArchive) {
        const zip = parentArchive._zipObject;
        const folderPath = folder._fullArchivePath;

        console.log(`[loadZipFolderWithJSZip] 文件夹路径: ${folderPath}`);

        const childNodes = [];
        const childItems = new Map();

        // 遍历 ZIP 中的所有文件
        zip.forEach((relativePath, zipEntry) => {
          if (!relativePath) return;

          // 检查是否是该文件夹的子项
          if (relativePath.startsWith(folderPath + '/')) {
            const subPath = relativePath.substring(folderPath.length + 1);
            const parts = subPath.split('/');

            if (parts.length >= 1 && parts[0]) {
              const childName = parts[0];

              // 只添加直接子项（避免重复）
              if (!childItems.has(childName)) {
                const isDirectory = zipEntry.dir || (parts.length > 1);

                const node = {
                  name: childName,
                  path: `${folder.path}/${childName}`,
                  type: isDirectory ? 'folder' : 'file',
                  expanded: false,
                  level: folder.level + 1,
                  file: null,
                  childrenLoaded: false,
                  loadingChildren: false,
                  lazyLoad: isDirectory,
                  isArchiveChild: true,
                  isLocalDrive: true,
                  archiveName: folder.archiveName,
                  archivePath: `${folder.archivePath}/${childName}`,
                  _fullArchivePath: `${folderPath}/${childName}`,
                  _zipEntryName: `${folderPath}/${childName}`
                };

                if (!isDirectory) {
                  node.size = zipEntry._data.uncompressedSize || 0;
                }

                childItems.set(childName, node);
                childNodes.push(node);

                console.log(`[loadZipFolderWithJSZip] ${isDirectory ? '目录' : '文件'}: ${childName}`);
              }
            }
          }
        });

        // 使用自然排序
        childNodes.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
          }
          return naturalCompare(a.name, b.name);
        });

        // 插入到文件树
        const insertIndex = fileTreeHierarchy.indexOf(folder) + 1;
        fileTreeHierarchy.splice(insertIndex, 0, ...childNodes);

        folder.childrenLoaded = true;
        folder.loadingChildren = false;

        console.log(`[loadZipFolderWithJSZip] 已加载 ${childNodes.length} 个子项`);
      }

      // 🚀 使用文件列表加载压缩包子文件夹（7z/tar 模式）
      async function loadArchiveFolderFromFileList(folder, parentArchive) {
        const archiveFiles = parentArchive._archiveFiles;
        let folderPath = folder._fullArchivePath;

        // 🔧 确保 folderPath 不以斜杠结尾，避免拼接时产生双斜杠
        if (folderPath && folderPath.endsWith('/')) {
          folderPath = folderPath.slice(0, -1);
        }

        console.log(`[loadArchiveFolderFromFileList] 文件夹路径: ${folderPath}, 压缩包文件数: ${archiveFiles.length}`);

        const childNodes = [];
        const childItems = new Map();

        for (const file of archiveFiles) {
          if (!file.path) continue;

          // 🔧 确保文件路径也没有双斜杠
          let filePath = file.path.replace(/\/+/g, '/');

          if (filePath.startsWith(folderPath + '/')) {
            const subPath = filePath.substring(folderPath.length + 1);
            const parts = subPath.split('/');

            if (parts.length >= 1 && parts[0]) {
              const childName = parts[0];

              if (!childItems.has(childName)) {
                // 🔧 优先使用主进程提供的 isDirectory 信息，同时考虑路径深度
                // 如果路径只有一层（直接子项），使用主进程的 isDirectory
                // 如果路径有多层，说明子项是目录（因为包含更深层的文件）
                let isDirectory = parts.length > 1;

                // 对于直接子项（parts.length === 1），使用主进程提供的 isDirectory 信息
                if (parts.length === 1 && file.isDirectory) {
                  isDirectory = true;
                }

                const node = {
                  name: childName,
                  path: `${folder.path}/${childName}`,
                  type: isDirectory ? 'folder' : 'file',
                  expanded: false,
                  level: folder.level + 1,
                  file: null,
                  childrenLoaded: false,
                  loadingChildren: false,
                  lazyLoad: isDirectory,
                  isArchiveChild: true,
                  isLocalDrive: true,
                  archiveName: folder.archiveName,
                  archivePath: `${folder.archivePath}/${childName}`,
                  _fullArchivePath: `${folderPath}/${childName}`
                };

                if (!isDirectory) {
                  node.size = file.size || 0;
                }

                childItems.set(childName, node);
                childNodes.push(node);
              }
            }
          }
        }

        childNodes.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
          }
          return naturalCompare(a.name, b.name);
        });

        const insertIndex = fileTreeHierarchy.indexOf(folder) + 1;
        fileTreeHierarchy.splice(insertIndex, 0, ...childNodes);

        folder.childrenLoaded = true;
        folder.loadingChildren = false;

        console.log(`[loadArchiveFolderFromFileList] 已加载 ${childNodes.length} 个子项`);
      }

      // 🚀 查找父压缩包节点
      function findParentArchive(node) {
        let index = fileTreeHierarchy.indexOf(node);
        if (index === -1) return null;

        // 从当前节点向上遍历，查找父压缩包
        let targetLevel = node.level - 1;
        for (let i = index - 1; i >= 0; i--) {
          const current = fileTreeHierarchy[i];
          if (!current) continue;

          // 找到压缩包节点（排除压缩包内的文件夹）
          if (current.isLocalDrive && current.isArchive && !current.isArchiveChild) {
            return current;
          }

          // 如果节点的 level 小于目标 level，说明已经越过父级
          if (current.level < targetLevel) {
            targetLevel = current.level - 1;
          }

          // 如果到了根节点还没找到压缩包，返回 null
          if (current.level === 0) {
            break;
          }
        }
        return null;
      }

      // 🚀 新增：加载压缩包文件夹的子节点（懒加载）
      async function loadArchiveFolderChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder) return;

        console.log(`[压缩包懒加载] 加载文件夹 "${folder.name}" 的子项`);
        console.log(`[压缩包懒加载] folder.path=${folder.path}, folder._shallow=${folder._shallow}, folder._childNode=${!!folder._childNode}`);

        // 标记加载中
        folder.loadingChildren = true;
        renderFileTreeViewport(true);

        try {
          const archiveInfo = archiveData.get(folder.archiveName);
          if (!archiveInfo) throw new Error(`找不到压缩包: ${folder.archiveName}`);

          // 收集要插入的新节点
          const newNodes = [];

          // 🚀 支持两种模式：浅层节点（需要从 zip 动态加载）和普通节点（从 _childNode 加载）
          if (folder._shallow) {
            // 浅层节点：从原始 zip 对象动态加载
            console.log(`[压缩包懒加载] 浅层节点展开，从 zip 动态加载`);

            const zip = archiveInfo.zip;

            // 🚀 关键修复：去掉压缩包前缀，获取 zip 内的相对路径
            // folder.path 格式: "linux-master.zip/linux-master" 或 "linux-master.zip/arch"
            // 需要提取: "linux-master" 或 "arch"
            let folderPathInZip = folder.path;
            if (folder.path.startsWith(folder.archiveName + '/')) {
              folderPathInZip = folder.path.substring(folder.archiveName.length + 1);
            }

            console.log(`[压缩包懒加载] folderPathInZip=${folderPathInZip}`);

            // 遍历 zip，找到匹配该文件夹路径的子节点
            zip.forEach((relativePath, zipEntry) => {
              // 检查是否是该文件夹的直接子项
              if (relativePath.startsWith(folderPathInZip + '/')) {
                const subPath = relativePath.substring(folderPathInZip.length + 1);
                const parts = subPath.split('/');

                // 只处理直接子项（parts.length >= 1）
                if (parts.length >= 1 && parts[0]) {
                  const name = parts[0];
                  const fullPath = `${folder.path}/${name}`;

                  // 检查是否已添加（避免重复）
                  if (!newNodes.find(n => n.name === name)) {
                    if (parts.length === 1) {
                      // 文件
                      newNodes.push({
                        name: name,
                        path: fullPath,
                        type: "file",
                        expanded: false,
                        level: folder.level + 1,
                        isArchiveChild: true,
                        archiveName: folder.archiveName,
                        archivePath: relativePath,
                        file: zipEntry
                      });
                    } else {
                      // 子文件夹
                      newNodes.push({
                        name: name,
                        path: fullPath,
                        type: "folder",
                        expanded: false,
                        level: folder.level + 1,
                        isArchiveChild: true,
                        archiveName: folder.archiveName,
                        lazyLoad: true,
                        childrenLoaded: false,
                        _shallow: true,  // 子文件夹也标记为浅层
                        _folderPath: fullPath
                      });
                    }
                  }
                }
              }
            });

            // 按名称排序（文件夹在前）
            newNodes.sort((a, b) => {
              if (a.type === 'folder' && b.type === 'file') return -1;
              if (a.type === 'file' && b.type === 'folder') return 1;
              return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });

          } else if (folder._childNode) {
            // 普通节点：从已缓存的 _childNode 加载
            console.log(`[压缩包懒加载] 从缓存节点加载`);

            for (const [name, child] of Object.entries(folder._childNode.children)) {
              const fullPath = `${folder.path}/${name}`;

              if (child.type === 'folder') {
                newNodes.push({
                  name: name,
                  path: fullPath,
                  type: "folder",
                  expanded: false,
                  level: folder.level + 1,
                  isArchiveChild: true,
                  archiveName: folder.archiveName,
                  lazyLoad: true,
                  childrenLoaded: false,
                  _childNode: child
                });
              } else if (child.type === 'file') {
                newNodes.push({
                  name: name,
                  path: fullPath,
                  type: "file",
                  expanded: false,
                  level: folder.level + 1,
                  isArchiveChild: true,
                  archiveName: folder.archiveName,
                  archivePath: child.path,
                  file: child.file
                });
              }
            }
          } else {
            throw new Error(`文件夹没有可加载的子节点数据`);
          }

          // 标记为已加载
          folder.childrenLoaded = true;
          folder.loadingChildren = false;

          // 插入到层次结构中
          fileTreeHierarchy.splice(folderIndex + 1, 0, ...newNodes);

          console.log(`[压缩包懒加载] 已加载 ${newNodes.length} 个子项`);
        } catch (error) {
          console.error(`[压缩包懒加载] 加载失败:`, error);
          folder.loadingChildren = false;
          folder.childrenLoaded = false;
          showMessage(`加载文件夹 "${folder.name}" 失败: ${error.message}`);
        }
      }

      // 🚀 新增：释放压缩包文件夹的子项内存
      function unloadArchiveFolderChildren(folderIndex) {
        const folder = fileTreeHierarchy[folderIndex];
        if (!folder || !folder.isArchiveChild) return;

        // 找到并移除该文件夹的所有子项（直到遇到同级或更高级的节点）
        let removeCount = 0;
        const targetLevel = folder.level;

        for (let i = folderIndex + 1; i < fileTreeHierarchy.length; i++) {
          const item = fileTreeHierarchy[i];
          if (!item) continue;

          // 如果遇到同级或更高级的节点，停止移除
          if (item.level <= targetLevel) {
            break;
          }

          // 递归释放子文件夹的内存
          if (item.type === "folder" && item.childrenLoaded) {
            unloadArchiveFolderChildren(i - removeCount);
          }

          // 释放文件对象的引用
          if (item.file) {
            item.file = null;
          }

          removeCount++;
        }

        // 批量移除子项
        if (removeCount > 0) {
          fileTreeHierarchy.splice(folderIndex + 1, removeCount);
        }

        // 标记为未加载
        folder.childrenLoaded = false;

        console.log(`[压缩包懒加载] 释放文件夹 "${folder.name}" 的 ${removeCount} 个子项内存`);
      }

      // 渲染文件树 - 优化：减少残影
      function renderFileTree() {
        if (!fileTreeHierarchy || fileTreeHierarchy.length === 0) {
          fileTreeList.innerHTML =
            '<div class="file-tree-empty">导入文件、文件夹或压缩包后，文件将显示在这里</div>';
          fileTreeVirtualInitialized = false;
          return;
        }

        ensureFileTreeVirtualDom();
        if (!fileTreeRowHeightPx || fileTreeRowHeightPx < 10) {
          fileTreeRowHeightPx = measureFileTreeRowHeight();
        }
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);
      }

      // 跟踪已加载的文件（索引 -> 加载状态）
      const loadedFileIndices = new Set();
      let isIncrementalLoad = false;

      // 🔧 跟踪文件索引到 fileHeaders 索引的映射（用于取消选中时清理内容）
      // 注意：现在取消选中时直接重新加载，所以这个映射主要用于调试
      const fileIndexToHeaderIndices = new Map(); // fileTreeIndex -> [headerIndex1, headerIndex2, ...]

      // 🔧 按照选择顺序重新加载所有文件
      async function reloadFilesInOrder() {
        console.log(`[reloadFilesInOrder] 开始按顺序重新加载 ${selectedFiles.length} 个文件`);

        // 按选择顺序排序
        const sortedFiles = [...selectedFiles].sort((a, b) => a.order - b.order);
        console.log(`[reloadFilesInOrder] 文件顺序:`, sortedFiles.map(f => {
          const item = fileTreeHierarchy[f.index];
          return item ? item.name : 'unknown';
        }).join(' -> '));

        // 🔧 修复重复加载：重新加载前先清空所有日志内容和映射
        console.log(`[reloadFilesInOrder] 清空已有日志内容，准备重新加载`);
        originalLines = [];
        fileHeaders = [];
        fileIndexToHeaderIndices.clear();

        // 开启新的加载会话
        const sessionId = ++currentLoadingSession;
        showLoading(true);

        try {
          for (const { index: fileTreeIndex, order } of sortedFiles) {
            // 检查会话是否过期
            if (sessionId !== currentLoadingSession) {
              console.log(`[reloadFilesInOrder] 会话已过期，停止加载`);
              return;
            }

            const item = fileTreeHierarchy[fileTreeIndex];
            if (!item || item.type !== 'file') {
              console.warn(`[reloadFilesInOrder] 跳过无效文件: index=${fileTreeIndex}`);
              continue;
            }

            console.log(`[reloadFilesInOrder] [${order}] 加载文件: ${item.name}`);

            try {
              let content = null;

              // 根据文件类型读取内容
              if (item.isArchiveChild && item.archivePath) {
                // 压缩包内的文件
                content = await readFileFromArchive(item.archiveName, item.archivePath);
                const virtualPath = `${item.archiveName}/${item.archivePath}`;
                processFileContent(content, item.archivePath, virtualPath, fileTreeIndex);
              } else if (item.isLocalDrive && item.path) {
                // 本地文件
                if (item._fileContent) {
                  // 粘贴的文件
                  content = item._fileContent;
                } else if (window.electronAPI && window.electronAPI.readFile) {
                  // 从文件系统读取
                  const filePath = item._originalPath || item.path;
                  const result = await window.electronAPI.readFile(filePath);
                  if (result && result.success) {
                    content = result.content;
                  } else {
                    throw new Error(result?.error || '读取失败');
                  }
                } else {
                  throw new Error('读取文件 API 不可用');
                }
                processFileContent(content, item.name, item._originalPath || item.path, fileTreeIndex);
              } else if (item.file && item.file._hasContent && item.file.content) {
                // 已预读取的文件
                content = item.file.content;
                processFileContent(content, item.file.name, item.file.fullPath || item.file.webkitRelativePath || item.file.name, fileTreeIndex);
              } else {
                console.warn(`[reloadFilesInOrder] 跳过无法读取的文件: ${item.name}`);
                continue;
              }

              console.log(`[reloadFilesInOrder] [${order}] 已加载: ${item.name}`);
            } catch (error) {
              console.error(`[reloadFilesInOrder] [${order}] 加载失败: ${item.name}`, error);
            }
          }

          // 最终检查会话是否过期
          if (sessionId !== currentLoadingSession) return;

          // 清空过滤框，防止过滤面板自动弹出
          filterBox.value = "";

          // 重新渲染日志
          resetFilter(false);
          renderLogLines();
          selectedOriginalIndex = -1;
          showLoading(false);

          showMessage(`已重新加载 ${fileHeaders.length} 个文件 (${originalLines.length} 行)`);
          console.log(`[reloadFilesInOrder] 完成，共 ${fileHeaders.length} 个文件，${originalLines.length} 行`);

          // 🔧 更新已加载文件索引，防止重复加载
          sortedFiles.forEach(f => loadedFileIndices.add(f.index));
        } catch (error) {
          console.error('[reloadFilesInOrder] 加载失败:', error);
          showLoading(false);
          showMessage('重新加载失败: ' + error.message);
        }
      }

      // 🔧 清理指定文件的内容并重新组织剩余内容
      function removeFileContent(fileTreeIndex) {
        console.log(`[removeFileContent] 开始清理文件索引 ${fileTreeIndex} 的内容`);

        const headerIndices = fileIndexToHeaderIndices.get(fileTreeIndex);
        if (!headerIndices || headerIndices.length === 0) {
          console.log(`[removeFileContent] 文件索引 ${fileTreeIndex} 没有关联的内容，跳过`);
          return;
        }

        console.log(`[removeFileContent] 文件索引 ${fileTreeIndex} 关联 ${headerIndices.length} 个 header`);

        // 🚀 新策略：按倒序删除（避免索引变化），然后更新后续文件的 startIndex
        const sortedIndices = [...headerIndices].sort((a, b) => b - a);
        let totalDeletedLines = 0;

        for (const headerIndex of sortedIndices) {
          if (headerIndex < 0 || headerIndex >= fileHeaders.length) {
            console.warn(`[removeFileContent] headerIndex ${headerIndex} 超出范围，跳过`);
            continue;
          }

          const header = fileHeaders[headerIndex];
          console.log(`[removeFileContent] 删除文件: ${header.fileName} (${header.lineCount} 行)`);

          // 从 originalLines 中删除这些行
          const startLine = header.startIndex;
          const endLine = header.startIndex + header.lineCount;

          console.log(`[removeFileContent] 删除行范围: ${startLine} - ${endLine} (共 ${endLine - startLine} 行)`);

          // 删除行
          originalLines.splice(startLine, endLine - startLine);
          totalDeletedLines += (endLine - startLine);

          // 从 fileHeaders 中删除这个 header
          fileHeaders.splice(headerIndex, 1);
        }

        // 🔧 更新所有后续文件的 startIndex
        // 由于我们删除了内容，需要更新受影响的文件的 startIndex
        if (totalDeletedLines > 0) {
          console.log(`[removeFileContent] 更新后续文件的 startIndex，总共删除了 ${totalDeletedLines} 行`);

          // 找到最小的被删除的 headerIndex
          const minDeletedIndex = Math.min(...sortedIndices);

          // 更新所有在 minDeletedIndex 之后的 header 的 startIndex
          for (let i = minDeletedIndex; i < fileHeaders.length; i++) {
            fileHeaders[i].startIndex -= totalDeletedLines;
            console.log(`[removeFileContent] 更新 ${fileHeaders[i].fileName} startIndex: ${fileHeaders[i].startIndex + totalDeletedLines} -> ${fileHeaders[i].startIndex}`);
          }
        }

        // 清理映射
        fileIndexToHeaderIndices.delete(fileTreeIndex);
        loadedFileIndices.delete(fileTreeIndex);

        // 🔧 更新剩余文件的映射关系（因为 header 索引变了）
        updateFileIndexMappingsAfterRemoval();

        console.log(`[removeFileContent] 清理完成，剩余 ${fileHeaders.length} 个文件，${originalLines.length} 行`);
      }

      // 🔧 删除文件后，更新剩余文件的映射关系
      function updateFileIndexMappingsAfterRemoval() {
        console.log(`[updateFileIndexMappingsAfterRemoval] 更新映射关系`);

        // 清空旧映射
        const oldMappings = new Map(fileIndexToHeaderIndices);
        fileIndexToHeaderIndices.clear();

        // 重建映射：遍历新的 fileHeaders，找到对应的 fileTreeIndex
        for (let headerIndex = 0; headerIndex < fileHeaders.length; headerIndex++) {
          const header = fileHeaders[headerIndex];

          // 在旧映射中查找这个 header 对应的 fileTreeIndex
          for (const [fileTreeIndex, oldHeaderIndices] of oldMappings.entries()) {
            // 检查这个 fileTreeIndex 的旧 header 中是否有与当前 header 匹配的
            for (const oldHeaderIndex of oldHeaderIndices) {
              // 由于我们无法直接比较 header（因为它们被复制了），我们跳过这个检查
              // 直接假设映射关系不变，只是 headerIndex 变了
            }
          }
        }

        // 实际上，我们需要更聪明的方法
        // 让我们按照文件名匹配，重新建立映射
        for (let headerIndex = 0; headerIndex < fileHeaders.length; headerIndex++) {
          const header = fileHeaders[headerIndex];

          // 在 fileTreeHierarchy 中查找匹配的文件
          for (const [fileTreeIndex, oldHeaderIndices] of oldMappings.entries()) {
            // 检查这个 fileTreeIndex 是否还在 selectedFiles 中
            const isSelected = selectedFiles.some(f => f.index === fileTreeIndex);
            if (!isSelected) continue;

            // 获取文件信息
            const item = fileTreeHierarchy[fileTreeIndex];
            if (!item) continue;

            // 比较文件名
            if (item.name === header.fileName) {
              if (!fileIndexToHeaderIndices.has(fileTreeIndex)) {
                fileIndexToHeaderIndices.set(fileTreeIndex, []);
              }
              fileIndexToHeaderIndices.get(fileTreeIndex).push(headerIndex);
              break;
            }
          }
        }

        console.log(`[updateFileIndexMappingsAfterRemoval] 映射更新完成`);
      }

      // 🔧 根据 fileHeaders 重建 originalLines（按照新的顺序）
      function rebuildOriginalLinesFromHeaders() {
        console.log(`[rebuildOriginalLinesFromHeaders] 开始重建，共 ${fileHeaders.length} 个文件`);

        // 保存原始内容
        const oldLines = [...originalLines];
        const oldHeaders = [...fileHeaders];

        // 清空
        originalLines = [];
        fileHeaders = [];

        // 按照选择顺序重建
        let currentLineIndex = 0;

        // 获取当前选中的文件，按选择顺序排序
        const sortedSelectedFiles = [...selectedFiles].sort((a, b) => a.order - b.order);

        for (const { index: fileTreeIndex } of sortedSelectedFiles) {
          const headerIndices = fileIndexToHeaderIndices.get(fileTreeIndex);
          if (!headerIndices || headerIndices.length === 0) continue;

          // 从旧的 fileHeaders 中找到对应的 header
          for (const oldHeaderIndex of headerIndices) {
            if (oldHeaderIndex >= oldHeaders.length) continue;

            const oldHeader = oldHeaders[oldHeaderIndex];
            if (!oldHeader) continue;

            // 计算在旧数组中的行范围
            const oldStartLine = oldHeader.startIndex;
            const oldEndLine = oldHeader.startIndex + oldHeader.lineCount;

            // 提取旧内容
            const fileLines = oldLines.slice(oldStartLine, oldEndLine);

            // 添加到新数组
            const newHeader = {
              ...oldHeader,
              startIndex: currentLineIndex
            };
            fileHeaders.push(newHeader);

            // 追加行内容
            for (const line of fileLines) {
              originalLines.push(line);
              currentLineIndex++;
            }
          }
        }

        console.log(`[rebuildOriginalLinesFromHeaders] 重建完成，共 ${fileHeaders.length} 个文件，${originalLines.length} 行`);
      }

      // 加载选中的文件
      async function loadSelectedFiles() {
        console.log(`[loadSelectedFiles] 开始加载，selectedFiles.length=${selectedFiles.length}`);
        console.log(`[loadSelectedFiles] selectedFiles=`, selectedFiles.map(f => ({index: f.index, order: f.order})));

        // 🚀 性能优化：记录本次加载的选中快照（供 handleFileTreeMouseUp 比较使用）
        lastLoadedSelectionKeys = selectedFiles.map(f => f.index + ':' + f.order).join(',');

        // 🚀 新增：过滤模式检测
        if (!isFileLoadMode) {
          // 过滤模式：不加载文件内容，只记录文件路径
          console.log(`[过滤模式] 检测到过滤模式，不加载文件内容，只记录文件路径`);

          // 清空之前的文件列表
          filterModeFileList = [];
          const skippedArchives = []; // 记录跳过的压缩包文件

          // 收集选中文件的完整路径
          for (const fileObj of selectedFiles) {
            const item = fileTreeHierarchy[fileObj.index];
            if (item && item.type === 'file') {
              const fullPath = getFullPath(item);
              if (fullPath) {
                // 🔧 过滤模式不支持压缩包内的文件，跳过
                if (fullPath.match(/\.(zip|tar|gz|7z|rar)\//i)) {
                  skippedArchives.push(item.name);
                  continue;
                }
                filterModeFileList.push(fullPath);
              }
            }
          }

          console.log(`[过滤模式] 已记录 ${filterModeFileList.length} 个选中文件`);
          if (skippedArchives.length > 0) {
            console.warn(`[过滤模式] 跳过 ${skippedArchives.length} 个压缩包内文件（过滤模式不支持压缩包）`);
          }

          if (filterModeFileList.length > 0) {
            console.log(`[过滤模式] 第一个文件: ${filterModeFileList[0]}`);
            if (skippedArchives.length > 0) {
              showMessage(`🔍 已选中 ${filterModeFileList.length} 个文件（跳过 ${skippedArchives.length} 个压缩包文件），现在在过滤框输入关键词即可开始过滤`);
            } else {
              showMessage(`🔍 已选中 ${filterModeFileList.length} 个文件，现在在过滤框输入关键词即可开始过滤`);
            }
          } else {
            if (skippedArchives.length > 0) {
              showMessage('⚠️ 过滤模式不支持压缩包内的文件，请选择普通磁盘文件');
            } else {
              showMessage(`⚠️ 没有选中任何文件，请先选择要过滤的文件`);
            }
          }

          // 清空主日志框（因为过滤模式不需要加载）
          if (originalLines.length > 0) {
            cleanFilterData();
            originalLines = [];
            renderLogLines();
          }

          return;
        }

        // 🚀 性能优化：内存限制检查
        const MAX_MEMORY_MB = 600;  // 最多600MB

        // 🔧 修复竞态条件：在函数开始时保存 selectedFiles 的快照
        // 这样即使在加载过程中 selectedFiles 被修改（比如用户又选择了新文件），也不会影响本次加载
        const selectedFilesSnapshot = [...selectedFiles];

        // 🔧 检测是否有新文件需要加载
        const newFiles = selectedFilesSnapshot.filter(f => !loadedFileIndices.has(f.index));
        const hasNewFiles = newFiles.length > 0;

        // 🔧 修复：检查是否有重叠，判断是真正的增量追加还是全新加载
        // 如果选中的文件与已加载的文件有重叠 → 增量追加（用户按住Ctrl多选）
        // 如果选中的文件与已加载的文件完全不同 → 清空重新加载
        const hasOverlap = selectedFilesSnapshot.some(f => loadedFileIndices.has(f.index));
        const totalSelectedCount = selectedFilesSnapshot.length;
        const overlapCount = selectedFilesSnapshot.filter(f => loadedFileIndices.has(f.index)).length;

        // 判断：如果选中数量 > 重叠数量，说明有新文件需要追加
        // 如果选中数量 == 重叠数量（且 > 0），说明只是重复选择已加载的文件
        // 如果重叠数量 == 0，说明是完全不同的文件，需要清空重新加载
        let isIncrementalLoad = false;
        let shouldClearAll = false;

        if (overlapCount === 0) {
          // 完全不同的文件 → 清空重新加载
          shouldClearAll = true;
          isIncrementalLoad = false;
          console.log(`[loadSelectedFiles] 检测到完全不同的文件，清空重新加载`);
        } else if (hasNewFiles) {
          // 有重叠且有新文件 → 增量追加
          shouldClearAll = false;
          isIncrementalLoad = true;
          console.log(`[loadSelectedFiles] 增量追加模式：保留 ${overlapCount} 个已加载文件，添加 ${newFiles.length} 个新文件`);
        } else {
          // 没有新文件 → 全部已加载，跳过
          console.log(`[loadSelectedFiles] 所有文件已加载，跳过重复加载`);
          return;
        }

        console.log(`[loadSelectedFiles] 已加载文件数: ${loadedFileIndices.size}, 新文件数: ${newFiles.length}, 增量模式: ${isIncrementalLoad}, 清空重新加载: ${shouldClearAll}`);

        // 🔧 如果需要清空重新加载
        if (shouldClearAll) {
          console.log(`[loadSelectedFiles] 清空所有旧内容...`);
          originalLines = [];
          fileHeaders = [];
          currentFiles = [];
          loadedFileIndices.clear();  // 🔧 清空已加载文件索引
        } else if (isIncrementalLoad) {
          console.log(`[增量加载] 保留已有 ${originalLines.length} 行日志，${fileHeaders.length} 个文件头`);
        }

        // 🔧 修复：按照 selectedFiles 的顺序加载，但只加载新文件
        // 这样可以确保文件被添加到正确的位置
        const filesToLoad = isIncrementalLoad
          ? selectedFilesSnapshot.filter(f => !loadedFileIndices.has(f.index))
          : selectedFilesSnapshot;

        console.log(`[loadSelectedFiles] 实际加载的文件数量: ${filesToLoad.length}`);

        if (filesToLoad.length === 0) {
          showMessage("没有选中任何文件");
          return;
        }

        // 检查是否有远程文件需要加载
        const hasRemoteFiles = filesToLoad.some((fileObj) => {
          const item = fileTreeHierarchy[fileObj.index];
          return item && item.isRemote;
        });

        // 如果是服务器模式且有远程文件，使用远程加载
        if (isServerMode && hasRemoteFiles) {
          loadSelectedRemoteFiles();
          return;
        }

        // 🔧 收集所有文件到统一列表，按选中顺序排序
        const allFiles = [];

        filesToLoad.forEach((fileObj) => {
          const item = fileTreeHierarchy[fileObj.index];
          if (item && item.type === "file") {
            if (item.isArchiveChild && item.archivePath) {
              // 压缩包内的文件
              allFiles.push({
                type: 'archive',
                order: fileObj.order,
                fileTreeIndex: fileObj.index,
                data: { item }
              });
            } else if (item.isLocalDrive && item.path) {
              // 🚀 本地文件（从文件树加载）
              allFiles.push({
                type: 'local',
                order: fileObj.order,
                fileTreeIndex: fileObj.index,
                data: { item }
              });
              console.log("📁 本地文件选中:", item.name, item.path);
            } else if (item.file) {
              // 检查文件是否已预读取内容
              if (item.file._hasContent && item.file.content) {
                allFiles.push({
                  type: 'preloaded',
                  order: fileObj.order,
                  fileTreeIndex: fileObj.index,
                  data: { file: item.file }
                });
                console.log("✅ 文件已预读取内容:", item.file.name);
              } else {
                allFiles.push({
                  type: 'normal',
                  order: fileObj.order,
                  fileTreeIndex: fileObj.index,
                  data: { file: item.file }
                });
              }
            }
          }
        });

        // 按选中顺序排序
        allFiles.sort((a, b) => a.order - b.order);

        const totalFiles = allFiles.length;

        // 如果只有一个文件，不显示进度条
        if (totalFiles <= 1) {
          // 开启新的加载会话
          const sessionId = ++currentLoadingSession;
          showLoading(true);

          // 🚀 性能优化：清空HTML解析缓存，释放内存
          clearHtmlParseCache();

          // 🔧 按选中顺序加载所有文件
          for (const fileInfo of allFiles) {
            if (sessionId !== currentLoadingSession) {
              console.log("⚠️ 会话已过期，停止加载");
              return;
            }

            try {
              switch (fileInfo.type) {
                case 'preloaded':
                  console.log(`📖 [${fileInfo.order}] 处理预读取文件: ${fileInfo.data.file.name}`);
                  processFileContent(
                    fileInfo.data.file.content,
                    fileInfo.data.file.name,
                    fileInfo.data.file.fullPath || fileInfo.data.file.webkitRelativePath || fileInfo.data.file.name,
                    fileInfo.fileTreeIndex
                  );
                  break;

                case 'normal':
                  // normal 类型需要批量处理，这里暂不处理，留给后续的 processFileBatch
                  break;

                case 'archive':
                  const archiveItem = fileInfo.data.item;
                  const content = await readFileFromArchive(archiveItem.archiveName, archiveItem.archivePath);
                  const virtualPath = `${archiveItem.archiveName}/${archiveItem.archivePath}`;
                  processFileContent(content, archiveItem.archivePath, virtualPath, fileInfo.fileTreeIndex);
                  console.log(`📦 [${fileInfo.order}] 已加载压缩包文件: ${virtualPath}`);
                  break;

                case 'local':
                  const localItem = fileInfo.data.item;
                  let localContent = null;

                  if (localItem._fileContent) {
                    console.log(`📋 [${fileInfo.order}] 从内存加载粘贴文件: ${localItem.name}`);
                    localContent = localItem._fileContent;
                  } else if (!window.electronAPI || !window.electronAPI.readFile) {
                    console.error('读取文件 API 不可用');
                    continue;
                  } else {
                    const filePath = localItem._originalPath || localItem.path;
                    console.log(`📁 [${fileInfo.order}] 开始加载: ${localItem.name}`);
                    const result = await window.electronAPI.readFile(filePath);
                    if (!result || !result.success) {
                      console.error(`读取本地文件失败: ${localItem.name}`, result?.error);
                      continue;
                    }
                    localContent = result.content;
                  }

                  if (localContent !== null && localContent !== undefined) {
                    processFileContent(localContent, localItem.name, localItem._originalPath || localItem.path, fileInfo.fileTreeIndex);
                    console.log(`📁 [${fileInfo.order}] 已加载本地文件: ${localItem.name}`);
                  }
                  break;
              }
            } catch (error) {
              console.error(`加载文件失败 (order=${fileInfo.order}):`, error);
            }
          }

          // 处理 normal 类型的文件（批量并行读取）
          const normalFiles = allFiles.filter(f => f.type === 'normal');
          if (normalFiles.length > 0) {
            try {
              const normalFileList = normalFiles.map(f => f.data.file);
              await processFileBatch(normalFileList, sessionId);
            } catch (error) {
              console.error("加载普通文件失败:", error);
            }
          }

          // 最终检查会话是否过期
          if (sessionId !== currentLoadingSession) return;

          // 清空过滤框，防止过滤面板自动弹出
          filterBox.value = "";

          // 🚀 性能优化：先隐藏加载提示和进度条
          showLoading(false);
          hideFileProgressBar();

          // 🚀 性能优化：直接渲染（去掉不必要的 50ms 延迟）
          requestAnimationFrame(() => {
            console.log(`[loadSelectedFiles] 开始渲染（单文件），总行数: ${originalLines.length}`);

            // 重新渲染日志
            resetFilter(false);
            renderLogLines();
            selectedOriginalIndex = -1;

            console.log(`[loadSelectedFiles] ✓ 渲染完成`);

            // 🚀 渲染完成后更新布局，确保文件树不影响主日志框
            updateLayout();
          });

          // 已禁用加载提示
          // if (totalFiles > 0) {
          //   showMessage(`已加载 ${totalFiles} 个文件 (${originalLines.length} 行)`);
          // }

          // 🔧 标记已加载的文件索引
          filesToLoad.forEach(f => loadedFileIndices.add(f.index));
          isIncrementalLoad = false;
          console.log(`[loadSelectedFiles] 完成，已加载文件总数: ${loadedFileIndices.size}`);

          return;
        }

        // 多个文件：显示进度条
        const progressBar = DOMCache.get('progressBar');
        const progressFill = DOMCache.get('progressFill');

        if (progressBar) {
          progressBar.style.display = 'block';
          if (progressFill) progressFill.style.width = '0%';
          console.log('[Progress] 进度条已显示');
        } else {
          console.log('[Progress] 进度条元素未找到');
        }

        // 开启新的加载会话
        const sessionId = ++currentLoadingSession;
        showLoading(true);

        let loadedCount = 0;

        // 整体文件进度
        const updateProgress = () => {
          loadedCount++;
          const filePercent = Math.round((loadedCount / totalFiles) * 100);

          if (progressFill) {
            progressFill.style.width = `${filePercent}%`;
          }
        };

        // 🔧 try-finish 确保进度条在任何情况下都会隐藏
        try {

        // 🔧 分离 normal 文件（需要批量处理）和其他类型文件
        const normalFiles = allFiles.filter(f => f.type === 'normal');
        const otherFiles = allFiles.filter(f => f.type !== 'normal');

        // 🚀 并行读取非 normal 文件内容，然后按顺序处理（保持文件顺序不变）
        if (otherFiles.length > 0) {
          // 阶段1：并行读取所有文件内容
          const readPromises = otherFiles.map(async (fileInfo) => {
            try {
              switch (fileInfo.type) {
                case 'preloaded':
                  return {
                    fileInfo,
                    content: fileInfo.data.file.content,
                    name: fileInfo.data.file.name,
                    path: fileInfo.data.file.fullPath || fileInfo.data.file.webkitRelativePath || fileInfo.data.file.name
                  };

                case 'archive':
                  const archiveItem = fileInfo.data.item;
                  const archiveContent = await readFileFromArchive(archiveItem.archiveName, archiveItem.archivePath);
                  return {
                    fileInfo,
                    content: archiveContent,
                    name: archiveItem.archivePath,
                    path: `${archiveItem.archiveName}/${archiveItem.archivePath}`
                  };

                case 'local':
                  const localItem = fileInfo.data.item;
                  if (localItem._fileContent) {
                    return {
                      fileInfo,
                      content: localItem._fileContent,
                      name: localItem.name,
                      path: localItem._originalPath || localItem.path
                    };
                  }
                  if (!window.electronAPI || !window.electronAPI.readFile) {
                    return { fileInfo, error: '读取文件 API 不可用' };
                  }
                  const filePath = localItem._originalPath || localItem.path;
                  const result = await window.electronAPI.readFile(filePath);
                  if (!result || !result.success) {
                    return { fileInfo, error: result?.error || '读取失败' };
                  }
                  return {
                    fileInfo,
                    content: result.content,
                    name: localItem.name,
                    path: localItem._originalPath || localItem.path
                  };

                default:
                  return { fileInfo, error: `未知文件类型: ${fileInfo.type}` };
              }
            } catch (error) {
              return { fileInfo, error: error.message };
            }
          });

          const readResults = await Promise.all(readPromises);

          // 阶段2：按原始顺序处理（otherFiles 已按 order 排序）
          if (sessionId !== currentLoadingSession) {
            console.log("⚠️ 会话已过期，停止加载");
            return;
          }

          for (const result of readResults) {
            if (result.error) {
              console.error(`加载文件失败 (order=${result.fileInfo.order}):`, result.error);
              continue;
            }
            processFileContent(result.content, result.name, result.path, result.fileInfo.fileTreeIndex);
            updateProgress();
          }
        }

        // 再批量处理 normal 文件
        if (normalFiles.length > 0) {
          console.log(`📁 多文件模式：批量处理 normal 文件，文件数: ${normalFiles.length}`);
          try {
            const normalFileList = normalFiles.map(f => f.data.file);
            await processFileBatch(normalFileList, sessionId, updateProgress);
          } catch (error) {
            console.error("加载普通文件失败:", error);
          }
        }

        // 最终检查会话是否过期
        if (sessionId !== currentLoadingSession) return;

        // 清空过滤框，防止过滤面板自动弹出
        filterBox.value = "";

        // 🚀 性能优化：先隐藏加载提示和进度条，给用户即时反馈
        showLoading(false);
        hideFileProgressBar();

        // 🚀 性能优化：延迟渲染，避免黑屏
        // 使用 setTimeout + requestAnimationFrame 让出主线程，使浏览器有机会处理UI事件
        // 这是修复"加载多个文件后黑屏"问题的关键修复
        setTimeout(() => {
          requestAnimationFrame(() => {
            // 此时主线程已释放，UI可以响应
            console.log(`[loadSelectedFiles] 开始渲染，总行数: ${originalLines.length}`);

            // 重新渲染日志
            resetFilter(false);
            renderLogLines();
            selectedOriginalIndex = -1;

            console.log(`[loadSelectedFiles] ✓ 渲染完成`);

            // 🚀 渲染完成后更新布局，确保文件树不影响主日志框
            updateLayout();
          });
        }, 50);  // 50ms延迟，让浏览器有时间处理事件队列

        // 已禁用加载提示
        // if (totalFiles > 0) {
        //   showMessage(`已加载 ${totalFiles} 个文件 (${originalLines.length} 行)`);
        // }

        // 🔧 标记已加载的文件索引
        filesToLoad.forEach(f => loadedFileIndices.add(f.index));
        isIncrementalLoad = false;
        console.log(`[loadSelectedFiles] 完成，已加载文件总数: ${loadedFileIndices.size}`);

        } catch (loadError) {
          // 🔧 捕获加载过程中的任何异常，确保进度条隐藏
          console.error('[loadSelectedFiles] 加载过程出错:', loadError);
          showLoading(false);
          hideFileProgressBar();
        }
      }

    // 清空主日志框内容（同时清空文件树除了盘符）
    function clearMainLogContent() {
      console.log('[clearMainLogContent] 清空主日志框内容和文件树');

      // 清空日志数据
      originalLines = [];
      fileHeaders = [];

      // 清空一级过滤状态
      currentFilter = {
        filteredLines: [],
        filteredToOriginalIndex: [],
      };

      // 清空二级过滤状态
      secondaryFilter = {
        isActive: false,
        filterText: "",
        filterKeywords: [],
        filteredLines: [],
        filteredToOriginalIndex: [],
        filteredToPrimaryIndex: [],
      };

      // 清空已加载文件跟踪
      loadedFileIndices.clear();
      fileIndexToHeaderIndices.clear();
      selectedFiles = [];
      selectionOrderCounter = 0;
      isIncrementalLoad = false;

      // 清空压缩包数据
      archiveData.clear();
      expandedArchives.clear();

      // 重置服务器模式状态
      isServerMode = false;
      serverCurrentPath = "";

      // 清空文件树（保留盘符及其展开状态）
      fileTreeHierarchy = fileTreeHierarchy.filter((item) => {
        // 只保留盘符节点，其他节点全部移除
        return item.type === 'drive';
      }).map((item) => {
        // 🚀 保留展开状态，但重置childrenLoaded以便重新加载子项
        // 同时清理压缩包相关的大对象引用，避免内存泄漏
        const { _archiveFiles, _zipObject, ...rest } = item;
        return {
          ...rest,
          expanded: item.expanded,  // 保持展开/折叠状态
          childrenLoaded: false     // 重置为未加载，强制重新加载
        };
      });

      fileTreeData = [];
      visibleFileTreeItems = [];
      visibleFileTreeItemsSet.clear();
      temporarilyIncludedNodes.clear();

      // 清空文件树搜索
      if (typeof fileTreeSearch !== 'undefined' && fileTreeSearch) {
        fileTreeSearch.value = "";
      }
      fileTreeSearchTerm = "";

      // 清空服务器路径输入框
      const serverPathInput = document.getElementById("serverPath");
      if (serverPathInput) {
        serverPathInput.value = "";
      }

      // 重建文件树可见性缓存并重新渲染
      rebuildFileTreeVisibleCache();
      renderFileTree();

      // 🚀 自动重新加载之前展开的盘符节点
      const expandedDrives = fileTreeHierarchy
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.type === 'drive' && item.expanded);

      if (expandedDrives.length > 0) {
        console.log(`[clearMainLogContent] 自动重新加载 ${expandedDrives.length} 个展开的盘符`);
        // 使用 setTimeout 异步加载，避免阻塞渲染
        setTimeout(async () => {
          for (const { item, index } of expandedDrives) {
            try {
              console.log(`[clearMainLogContent] 重新加载盘符: ${item.name}`);
              await loadLocalFolderChildren(index);
            } catch (error) {
              console.error(`[clearMainLogContent] 重新加载盘符失败: ${item.name}`, error);
            }
          }
          rebuildFileTreeVisibleCache();
          renderFileTreeViewport(true);
        }, 100);
      }

      // 重置滚动位置
      if (typeof scrollToLine === 'function') {
        scrollToLine(0, false);
      }

      // 更新文件计数
      const fileCount = document.getElementById("fileCount");
      if (fileCount) {
        fileCount.textContent = "0 个文件";
      }

      // 更新行数统计
      const lineCount = document.getElementById("lineCount");
      if (lineCount) {
        lineCount.textContent = "共 0 行";
      }

      // 清空主日志框DOM内容
      const inner = DOMCache.get('inner');
      const outer = DOMCache.get('outer');
      if (inner) {
        inner.innerHTML = "";
      }
      if (outer) {
        outer.scrollTop = 0;
      }

      // 清空占位符
      const logPlaceholder = document.getElementById('logPlaceholder');
      if (logPlaceholder) {
        logPlaceholder.remove();
      }

      // 清空DOM池
      if (typeof domPool !== 'undefined' && domPool) {
        domPool.clear();
        domPool = null;
      }

      // 重置虚拟滚动状态
      lastVisibleStart = -1;
      lastVisibleEnd = -1;
      visibleStart = 0;
      visibleEnd = 0;

      // 显示空状态占位符
      const placeholder = DOMCache.get('placeholder');
      if (placeholder) {
        placeholder.style.display = 'flex';
      }

      // 隐藏过滤面板
      const filteredPanel = DOMCache.get('filteredPanel');
      if (filteredPanel) {
        filteredPanel.classList.remove("visible");
        // 🔧 恢复文件树按钮显示
        if (typeof restoreFileTreePanel === 'function') {
          restoreFileTreePanel();
        }
      }

      // 隐藏二级过滤面板
      const secondaryFilterSidebar = document.getElementById('secondaryFilterSidebar');
      if (secondaryFilterSidebar) {
        secondaryFilterSidebar.classList.remove('visible');
      }

      // 清空缓存
      clearHtmlParseCache();

      // 清空过滤输入框
      const filterBox = DOMCache.get('filterBox');
      if (filterBox) {
        filterBox.value = '';
      }

      // 清空搜索框
      const searchBox = DOMCache.get('searchBox');
      if (searchBox) {
        searchBox.value = '';
      }

      showMessage('已刷新');

      console.log('[clearMainLogContent] 完成');
    }

    // 清空所有文件
    function clearAllFiles() {
        // 🔧 使用持久化的驱动器节点（盘符常驻）
        console.log(`[clearAllFiles] 使用 persistentDriveNodes，共 ${persistentDriveNodes.length} 个驱动器`);

        // 🔧 保存所有节点（不仅仅是驱动器）的展开状态 - 使用 path 而不是 index
        // 因为 map 会创建新数组，index 会失效
        const expandedPaths = new Set(); // 使用 Set 存储展开的路径

        // 遍历当前的 fileTreeHierarchy，保存所有展开状态
        for (let i = 0; i < fileTreeHierarchy.length; i++) {
          const item = fileTreeHierarchy[i];
          if (item.expanded && item.path) {
            expandedPaths.add(item.path);
            // 对于压缩包，还要保存 archiveName
            if (item.archiveName) {
              expandedPaths.add(`archive:${item.archiveName}`);
            }
            // 对于远程文件夹，保存完整路径
            if (item.isRemote) {
              expandedPaths.add(`remote:${item.path}`);
            }
          }
        }

        console.log(`[clearAllFiles] 保存的展开状态数量: ${expandedPaths.size}`);

        // 🔧 修复：不要清空 fileTreeData，只清空日志数据
        // 这样文件树结构会保持不变
        // fileTreeData = []; // ❌ 不要清空

        // 🔧 更新 fileTreeHierarchy：折叠盘符，保持其他节点的展开状态
        // 同时清理压缩包相关的大对象，避免内存泄漏
        fileTreeHierarchy = fileTreeHierarchy.map((item) => {
          // 清理压缩包相关的大对象引用
          const { _archiveFiles, _zipObject, ...rest } = item;
          if (item.type === 'drive') {
            // 盘符：强制折叠
            return {
              ...rest,
              expanded: false,
              childrenLoaded: false // 重置加载状态，允许重新展开
            };
          } else {
            // 其他节点：根据保存的状态决定是否展开
            const shouldBeExpanded = expandedPaths.has(item.path) ||
                                    (item.archiveName && expandedPaths.has(`archive:${item.archiveName}`)) ||
                                    (item.isRemote && expandedPaths.has(`remote:${item.path}`));

            return {
              ...rest,
              expanded: shouldBeExpanded
            };
          }
        });

        selectedFiles = [];
        visibleFileTreeItems = [];

        // 🔧 清空已加载文件跟踪和映射
        loadedFileIndices.clear();
        fileIndexToHeaderIndices.clear();
        isIncrementalLoad = false;

        // 清空压缩包数据
        archiveData.clear();
        expandedArchives.clear();

        // 重置服务器模式状态（保留服务器地址设置）
        isServerMode = false;
        serverCurrentPath = "";

        // 清空日志
        originalLines = [];
        fileHeaders = [];
        currentFiles = [];

        // 🔧 内存泄漏修复：先清空引用，再重置filter
        // filteredPanelAllLines 持有对 currentFilter.filteredLines 的引用
        // 必须先清空引用，否则旧数组无法被GC回收
        filteredPanelAllLines = [];
        filteredPanelAllOriginalIndices = [];
        filteredPanelAllPrimaryIndices = [];

        // 🚀 进程清理修复：终止所有Worker进程，释放内存
        if (typeof parallelFilterManager !== 'undefined' && parallelFilterManager) {
          parallelFilterManager.cancel();
          parallelFilterManager.results = [];
          // 🚀 关键：终止Worker进程，不仅仅是取消任务
          parallelFilterManager.terminateAll();
          console.log('[Memory] 已终止 parallelFilterManager 的所有Worker进程');
        }
        if (typeof sharedFilterManager !== 'undefined' && sharedFilterManager) {
          sharedFilterManager.cancel();
          sharedFilterManager.results = [];
          // 🚀 关键：清理SharedWorker连接
          sharedFilterManager.cleanup();
          console.log('[Memory] 已清理 sharedFilterManager 连接');
        }

        // 🚀 终止单个过滤Worker（如果存在）
        if (typeof filterWorker !== 'undefined' && filterWorker) {
          filterWorker.terminate();
          filterWorker = null;
          console.log('[Memory] 已终止单Worker进程');
        }

        // 重置UI状态
        resetFilter(false);
        resetSearch();
        fileTreeSearch.value = "";
        fileTreeSearchTerm = "";

        // 清空服务器路径输入框
        const serverPathInput = document.getElementById("serverPath");
        if (serverPathInput) {
          serverPathInput.value = "";
        }

        // 🚀 清空主日志框DOM内容
        if (inner) {
          inner.innerHTML = "";
        }
        const placeholder = DOMCache.get('placeholder');
        if (placeholder) {
          placeholder.style.height = "0px";
        }
        lastVisibleStart = -1;
        lastVisibleEnd = -1;

        // 🚀 清空过滤面板DOM内容
        // 🚀 性能优化：使用 DOM 缓存
        const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
        if (filteredPanelVirtualContent) {
          filteredPanelVirtualContent.innerHTML = "";
        }
        const filteredPanelPlaceholder = DOMCache.get('filteredPanelPlaceholder');
        if (filteredPanelPlaceholder) {
          filteredPanelPlaceholder.style.height = "0px";
          filteredPanelPlaceholder.style.display = "block";
        }
        filteredPanelVisibleStart = -1;
        filteredPanelVisibleEnd = -1;
        filteredPanelScrollPosition = 0;

        // 清空DOM池
        if (domPool) {
          domPool.clear();
          domPool = null;
        }

        // 🔧 内存优化：清空HTML缓存
        filteredLineHtmlCache.clear();
        filteredLineContentCache.clear();

        // 清空搜索匹配数组
        searchMatches = [];
        filteredPanelSearchMatches = [];

        // 🔧 内存泄漏修复：清空所有缓存
        clearHtmlParseCache();  // 清空HTML解析缓存
        clearRegexCache();      // 清空正则表达式缓存
        // 清空反转义缓存（已移除）
        lastFilterCacheKey = "";
        filteredPanelEscapedCache = [];    // 清空转义缓存
        filteredPanelHtmlCacheOld = [];    // 清空旧HTML缓存

        // 清空可见文件树集合
        visibleFileTreeItemsSet.clear();
        temporarilyIncludedNodes.clear(); // 清空临时包含的节点

        // 🔧 重建文件树可见性缓存
        rebuildFileTreeVisibleCache();

        // 更新UI
        renderFileTree();
        showMessage("已清空日志（折叠盘符，保持其他展开状态）");

        // 🔧 内存监控：打印清空后的内存状态
        setTimeout(() => {
          console.log('========== 内存状态检查 ==========');
          console.log('originalLines:', originalLines.length);
          console.log('filteredPanelAllLines:', filteredPanelAllLines.length);
          console.log('filteredPanelAllOriginalIndices:', filteredPanelAllOriginalIndices.length);
          console.log('currentFilter.filteredLines:', currentFilter.filteredLines.length);
          console.log('secondaryFilter.filteredLines:', secondaryFilter.filteredLines.length);
          console.log('htmlParseCache:', htmlParseCache.size);
          console.log('filteredLineHtmlCache:', filteredLineHtmlCache.size);
          console.log('filteredLineContentCache:', filteredLineContentCache.size);
          console.log('regexCache:', regexCache.size);
          console.log('unescapeCache: removed');
          console.log('searchMatches:', searchMatches.length);
          console.log('filteredPanelSearchMatches:', filteredPanelSearchMatches.length);
          console.log('===================================');

          // 🔧 内存优化：尝试触发GC（如果可用）
          if (typeof global !== 'undefined' && global.gc) {
            console.log('[Memory] 触发手动GC...');
            global.gc();
            setTimeout(() => {
              console.log('[Memory] GC完成，请检查任务管理器内存占用');
            }, 1000);
          } else {
            console.log('[Memory] GC不可用，Chrome会自动触发');
          }

          // 🔧 内存优化：创建大对象然后释放，尝试触发GC
          console.log('[Memory] 尝试触发V8 GC...');
          const tempArray = new Array(1000000).fill('x');
          setTimeout(() => {
            tempArray.length = 0;
            console.log('[Memory] GC触发完成');
          }, 100);
        }, 100);

        // 🚀 隐藏悬浮过滤内容框（确保元素存在）
        const filteredPanel = DOMCache.get('filteredPanel');
        if (filteredPanel) {
          filteredPanel.classList.remove("visible", "maximized");
          // 🚀 清除可能残留的内联样式
          filteredPanel.style.left = '';
          filteredPanel.style.top = '';
          filteredPanel.style.width = '';
          filteredPanel.style.height = '';
          console.log('[ClearAllFiles] 过滤面板已关闭');
        }

        // 🚀 重置过滤面板状态标志
        isFirstFilter = true;
        isFilterPanelMaximized = false;

        // 隐藏最小化小按钮
        const filteredPanelMinimizedBtn = document.getElementById('filteredPanelMinimizedBtn');
        if (filteredPanelMinimizedBtn) {
          filteredPanelMinimizedBtn.classList.remove('visible');
        }

        // 确保过滤对话框也隐藏
        const filterDialog = document.getElementById('filterDialog');
        if (filterDialog) {
          filterDialog.classList.remove('visible');
        }

        // 清除永久高亮
        currentPermanentHighlightIndex = -1;

        // 重置上次点击的过滤面板行索引
        lastClickedFilteredIndex = -1;

        // 新增：重置ERR_TAG跳转状态
        hasAutoJumpedToErrTag = false;

        // 新增：重置首次过滤标志
        isFirstFilter = true;

        // 新增：清除二级过滤
        clearSecondaryFilter();

        // 🔧 修复：不要隐藏文件树面板
        // 用户要求：如果点击重置更新前，文件树是展开状态，不要自动折叠！只清空内存和折叠盘符
        // 因此这里不再隐藏文件树面板，让用户保持当前的文件树展开状态（只有盘符会被折叠）
        console.log('[ClearAllFiles] 文件树面板保持可见（仅折叠盘符）');
      }

      // 暴露到全局作用域，供HTML onclick使用
      window.clearAllFiles = clearAllFiles;
      window.clearMainLogContent = clearMainLogContent;

      // 修改：处理键盘导航，根据焦点状态决定哪个容器响应

      // 处理日志行点击，高亮对应文件
      function getLineIndexFromElement(lineElement) {
        if (!lineElement) return -1;
        const dataIndex = lineElement.dataset ? lineElement.dataset.index : null;
        if (dataIndex !== null && dataIndex !== undefined && dataIndex !== "") {
          const idx = Number(dataIndex);
          if (!Number.isNaN(idx)) return idx;
        }

        // 兼容旧逻辑：从 absolute top 反推索引
        const top = parseInt(lineElement.style.top, 10);
        if (Number.isNaN(top)) return -1;
        const lh = getLineHeight();
        const idx = Math.round(top / lh);
        return Number.isFinite(idx) ? idx : -1;
      }

      function getFileNameForLineIndex(lineIndex) {
        if (!Array.isArray(fileHeaders) || fileHeaders.length === 0) return null;
        if (lineIndex < 0) return null;

        const getStartIndex = (h) =>
          typeof h?.startIndex === "number" ? h.startIndex : h?.index;
        const getName = (h) => h?.fileName || h?.path || h?.name || null;

        // fileHeaders 按 startIndex 递增插入，使用二分查找定位 <= lineIndex 的最后一个
        let lo = 0;
        let hi = fileHeaders.length - 1;
        let ans = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const start = getStartIndex(fileHeaders[mid]);
          if (typeof start === "number" && start <= lineIndex) {
            ans = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        if (ans === -1) return null;
        return getName(fileHeaders[ans]);
      }

      function handleLogLineClick(e) {
        // 查找点击的日志行
        const line = e.target.closest(".log-line, .file-header");
        if (!line) return;

        const index = getLineIndexFromElement(line);
        if (index < 0 || index >= originalLines.length) return;

        // 记录当前选中行（用于书签/快捷操作）
        if (line.classList.contains("log-line")) {
          selectedOriginalIndex = index;
          // 立即更新DOM选中态（不必等待下一次虚拟渲染）
          try {
            outer.querySelectorAll(".log-line.selected").forEach((el) => {
              if (el !== line) el.classList.remove("selected");
            });
            line.classList.add("selected");
          } catch (_) {}
        }

        const filePath = getFileNameForLineIndex(index);
        if (filePath) {
          // 移除高亮文件树功能，改为在过滤结果框头部显示
          updateFilteredPanelHeaderWithFile(filePath);
        }
      }

      function hideLineFileHoverTip() {
        if (!lineFileHoverTip) return;
        lineFileHoverTip.classList.remove("visible");
        lineFileHoverTip.style.transform = "translate3d(-9999px, -9999px, 0)";
        lineFileHoverTip.textContent = "";
        lineFileHoverTip.removeAttribute("title");
        lastHoverLineIndex = -1;
      }

      function updateLineFileHoverTip(lineIndex, clientX, clientY) {
        if (!lineFileHoverTip) return;
        const filePath = getFileNameForLineIndex(lineIndex);
        if (!filePath) {
          hideLineFileHoverTip();
          return;
        }

        const parts = String(filePath).split(/[/\\]/);
        const baseName = parts[parts.length - 1] || String(filePath);
        lineFileHoverTip.textContent = `文件: ${baseName}`;
        lineFileHoverTip.title = String(filePath);
        lineFileHoverTip.classList.add("visible");

        // 先放到目标位置，再做一次边界修正
        let x = clientX + 12;
        let y = clientY + 12;

        // 临时应用位置以便测量
        lineFileHoverTip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        const rect = lineFileHoverTip.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 8;
        const maxY = window.innerHeight - rect.height - 8;
        x = Math.max(8, Math.min(maxX, x));
        y = Math.max(8, Math.min(maxY, y));
        lineFileHoverTip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }

      function handleLogLineHoverMove(e) {
        // 悬浮文件树打开时，避免遮挡/误触导致的频繁更新
        if (isFileTreeFloating) return;

        const line = e.target.closest(".log-line, .file-header");
        if (!line) {
          hideLineFileHoverTip();
          return;
        }

        const index = getLineIndexFromElement(line);
        if (index < 0 || index >= originalLines.length) {
          hideLineFileHoverTip();
          return;
        }

        pendingHoverPayload = { index, x: e.clientX, y: e.clientY };
        if (hoverTipRafId) return;

        hoverTipRafId = requestAnimationFrame(() => {
          hoverTipRafId = null;
          if (!pendingHoverPayload) return;

          const { index: idx, x, y } = pendingHoverPayload;
          pendingHoverPayload = null;

          if (idx !== lastHoverLineIndex) {
            lastHoverLineIndex = idx;
          }

          updateLineFileHoverTip(idx, x, y);
        });
      }

      // 在过滤结果框头部显示当前文件名称
      function updateFilteredPanelHeaderWithFile(filePath) {
        // 获取或创建显示文件名的元素
        let fileNameDisplay = document.getElementById('filteredPanelFileName');
        if (!fileNameDisplay) {
            // 如果不存在，创建它并插入到头部
            const headerCenter = document.querySelector('#filteredPanelHeader .header-center');
            if (headerCenter) {
                fileNameDisplay = document.createElement('div');
                fileNameDisplay.id = 'filteredPanelFileName';
                fileNameDisplay.style.cssText = 'font-size: 12px; color: #666; margin-left: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px;';
                headerCenter.appendChild(fileNameDisplay);
            }
        }

        if (fileNameDisplay) {
            // 仅显示文件名，不显示完整路径
            const parts = filePath.split(/[/\\]/);
            const fileName = parts[parts.length - 1];
            fileNameDisplay.textContent = `当前文件: ${fileName}`;
            fileNameDisplay.title = filePath; // 鼠标悬停显示完整路径
        }
      }

      // 重构搜索事件：Enter向下搜索，Shift+Enter向上搜索
      function initSearchEvents() {
        // 监听日志行点击
        outer.addEventListener("click", handleLogLineClick);

        // 监听日志行悬停：已移除实时显示文件名功能，改为右键菜单显示
        // outer.addEventListener("mousemove", handleLogLineHoverMove);
        // outer.addEventListener("mouseleave", hideLineFileHoverTip);
        // outer.addEventListener("scroll", hideLineFileHoverTip, { passive: true });

        // 关键优化：用 keydown 替代 keypress，避免滚动/IME/浏览器差异导致 Enter 丢失
        searchBox.addEventListener("keydown", (e) => {
          if (e.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const currentValue = searchBox.value; // 不trim，保留空格

            // 搜索框为空时重置搜索（使用trim检查是否为空）
            if (currentValue.trim() === "") {
              resetSearch();
              return;
            }

            // 🚀 修复：关键词变化时执行新搜索，否则在已有结果中导航
            if (currentValue !== searchKeyword) {
              // 关键词变化：重新搜索
              searchKeyword = currentValue;
              performSearch();
            } else {
              // 关键词未变：在已有结果中导航
              if (e.shiftKey) {
                // Shift+Enter：向上导航（如果已在第一个，循环到最后）
                if (currentMatchIndex > 0) {
                  prevMatch();
                } else if (totalMatchCount > 0) {
                  // 已在第一个，循环到最后一个
                  currentMatchIndex = totalMatchCount - 1;
                  jumpToMatch(currentMatchIndex);
                  updateSearchUI();
                }
              } else {
                // Enter：向下导航（如果已在最后一个，循环到第一个）
                if (currentMatchIndex < totalMatchCount - 1) {
                  nextMatch();
                } else if (totalMatchCount > 0) {
                  // 已在最后一个，循环到第一个
                  currentMatchIndex = 0;
                  jumpToMatch(currentMatchIndex);
                  updateSearchUI();
                }
              }
            }
          }
        });

        searchBox.addEventListener("input", (e) => {
          const value = e.target.value;
          // 使用trim检查是否为空，但保留原始值
          if (value.trim() === "" && searchKeyword !== "") {
            resetSearch();
          }
        });
      }

      // 初始化字体缩放功能
      function initFontZoom() {
        console.log('🔍 初始化字体缩放功能...');

        // 计算行高（字体大小 + 5px padding）
        function calculateLineHeight(fontSize) {
          return fontSize + 5;
        }

        // 应用字体大小到元素
        function applyFontSize() {
          // 使用 CSS 变量设置日志框字体大小和行高
          if (inner) {
            const newLineHeight = calculateLineHeight(logFontSize);
            inner.style.setProperty('--log-font-size', `${logFontSize}px`);
            inner.style.setProperty('--log-line-height', `${newLineHeight}px`);
            // 强制浏览器应用新的CSS样式（读取offsetWidth强制重排）
            void inner.offsetWidth;
            console.log(`✅ 应用日志框字体大小: ${logFontSize}px, 行高: ${newLineHeight}px`);
          }
          if (filterBox) {
            filterBox.style.fontSize = `${filterFontSize}px`;
            console.log(`✅ 应用过滤框字体大小: ${filterFontSize}px`);
          }
        }

        // 应用过滤结果框的字体大小
        function applyFilteredLogFontSize() {
          // 🚀 性能优化：使用 DOM 缓存
          const filteredPanelContent = DOMCache.get('filteredPanelContent');
          if (!filteredPanelContent) return;

          const newLineHeight = calculateLineHeight(filteredLogFontSize);

          // 步骤1: 更新全局行高变量（重要！虚拟滚动依赖这个变量计算位置）
          filteredPanelLineHeight = newLineHeight;

          // 步骤2: 使用CSS变量设置字体大小和行高
          filteredPanelContent.style.setProperty('--filtered-log-font-size', `${filteredLogFontSize}px`);
          filteredPanelContent.style.setProperty('--filtered-log-line-height', `${newLineHeight}px`);

          // 步骤3: 强制浏览器应用新的CSS样式（读取offsetWidth强制重排）
          void filteredPanelContent.offsetWidth;

          // 步骤4: 重置可见范围标志
          filteredPanelVisibleStart = -1;
          filteredPanelVisibleEnd = -1;

          // 步骤5: 立即清空所有DOM元素，确保使用新的行高重建
          // 🚀 性能优化：使用 DOM 缓存
          const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
          if (filteredPanelVirtualContent) {
            filteredPanelVirtualContent.innerHTML = '';
          }

          // 步骤6: 使用requestAnimationFrame确保在下一帧使用新样式渲染
          // 🚀 性能优化：使用 DOM 缓存
          const filteredPanel = DOMCache.get('filteredPanel');
          if (filteredPanel && filteredPanel.classList.contains('visible')) {
            requestAnimationFrame(() => {
              if (typeof updateFilteredPanelVisibleLines === 'function') {
                updateFilteredPanelVisibleLines();
              }
            });
          }

          console.log(`✅ 应用过滤结果框字体大小: ${filteredLogFontSize}px, 行高: ${newLineHeight}px`);
          console.log(`🔍 已清空DOM并在下一帧重新渲染`);
        }

        // 更新全局 lineHeight 变量并重新渲染
        function updateLineHeightAndRefresh() {
          const newLineHeight = calculateLineHeight(logFontSize);
          lineHeight = newLineHeight;

          // 强制刷新可见行以应用新的行高
          lastVisibleStart = -1;
          lastVisibleEnd = -1;

          // 使用requestAnimationFrame确保在下一帧使用新样式渲染
          requestAnimationFrame(() => {
            if (typeof renderLogLines === 'function') {
              renderLogLines();  // 完整重新渲染，包括重建DOM池
            }
          });
        }

        // 更新过滤结果框的行高并重新渲染
        function updateFilteredLogLineHeightAndRefresh() {
          // 强制刷新过滤结果框的可见行
          // 🚀 性能优化：使用 DOM 缓存
          const filteredPanelContent = DOMCache.get('filteredPanelContent');
          if (filteredPanelContent && typeof updateFilteredPanelVisibleLines === 'function') {
            // 重置可见范围，强制重新渲染
            filteredPanelVisibleStart = -1;
            filteredPanelVisibleEnd = -1;
            updateFilteredPanelVisibleLines();
          }
        }

        // 初始化：从 localStorage 读取保存的字体大小，但强制设置为14px
        try {
          // 清除旧的字体设置，强制使用14px
          localStorage.removeItem('logFontSize');
          localStorage.removeItem('filterFontSize');
          localStorage.removeItem('filteredLogFontSize');

          const savedLogFontSize = localStorage.getItem('logFontSize');
          const savedFilterFontSize = localStorage.getItem('filterFontSize');
          const savedFilteredLogFontSize = localStorage.getItem('filteredLogFontSize');

          if (savedLogFontSize !== null) {
            logFontSize = parseInt(savedLogFontSize, 10);
            console.log(`📖 读取保存的日志框字体: ${logFontSize}px`);
          }
          if (savedFilterFontSize !== null) {
            filterFontSize = parseInt(savedFilterFontSize, 10);
            console.log(`📖 读取保存的过滤框字体: ${filterFontSize}px`);
          }
          if (savedFilteredLogFontSize !== null) {
            filteredLogFontSize = parseInt(savedFilteredLogFontSize, 10);
            console.log(`📖 读取保存的过滤结果框字体: ${filteredLogFontSize}px`);
          }

          // 强制设置所有字体为14px
          logFontSize = 14;
          filterFontSize = 14;
          filteredLogFontSize = 14;
          console.log(`✅ 字体大小已重置为14px`);
        } catch (e) {
          console.warn('⚠️ 读取字体大小设置失败:', e);
        }

        // 应用初始字体大小和行高
        applyFontSize();
        applyFilteredLogFontSize();
        updateLineHeightAndRefresh();
        updateFilteredLogLineHeightAndRefresh();

        // 监听日志框的 Ctrl + 滚轮事件（监听 outer 容器，因为滚动发生在这里）
        if (outer) {
          console.log('✅ 绑定日志框滚轮事件监听器到 outer 容器');

          // 在捕获阶段处理，确保在其他事件监听器之前拦截
          outer.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
              console.log('🖱️ 检测到日志框 Ctrl + 滚轮，deltaY:', e.deltaY);

              // 立即阻止默认行为和事件传播
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              // 向上滚动放大，向下滚动缩小
              if (e.deltaY < 0) {
                logFontSize = Math.min(logFontSize + FONT_SIZE_STEP, MAX_FONT_SIZE);
                console.log(`⬆️ 放大日志框字体到: ${logFontSize}px`);
              } else {
                logFontSize = Math.max(logFontSize - FONT_SIZE_STEP, MIN_FONT_SIZE);
                console.log(`⬇️ 缩小日志框字体到: ${logFontSize}px`);
              }

              // 应用字体大小和行高
              applyFontSize();
              updateLineHeightAndRefresh();

              // 保存到 localStorage
              try {
                localStorage.setItem('logFontSize', logFontSize.toString());
              } catch (e) {
                console.warn('保存字体大小失败:', e);
              }

              // 显示提示
              if (typeof showMessage === 'function') {
                showMessage(`日志框字体大小: ${logFontSize}px`);
              }

              return false;
            }

            // 🚀 新增：Alt+滚轮用于横向滚动
            if (e.altKey) {
              e.preventDefault();
              e.stopPropagation();

              let delta = e.deltaX;
              // 如果没有deltaX，尝试使用deltaY（某些触控板/鼠标）
              if (Math.abs(delta) < 0.1) {
                delta = e.deltaY;
              }

              if (Math.abs(delta) < 0.1) return; // 忽略微小的滚动

              const deltaMode = e.deltaMode;
              if (deltaMode === 1) delta *= 16; // 行
              else if (deltaMode === 2) delta *= window.innerWidth; // 页

              // 应用滚轮倍率
              delta = delta * 2.2;

              // 直接设置scrollLeft
              const maxScrollLeft = Math.max(0, outer.scrollWidth - outer.clientWidth);
              const targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, outer.scrollLeft + delta));
              outer.scrollLeft = targetScrollLeft;

              return false;
            }

            return true; // 让事件继续传播给其他处理器
          }, { passive: false, capture: true });
        } else {
          console.warn('⚠️ outer 容器未找到！');
        }

        // 监听过滤框的 Ctrl + 滚轮事件
        if (filterBox) {
          console.log('✅ 绑定过滤框滚轮事件监听器');
          filterBox.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
              console.log('🖱️ 检测到过滤输入框 Ctrl + 滚轮，deltaY:', e.deltaY);
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              // 向上滚动放大，向下滚动缩小
              if (e.deltaY < 0) {
                filterFontSize = Math.min(filterFontSize + FONT_SIZE_STEP, MAX_FONT_SIZE);
                console.log(`⬆️ 放大过滤输入框字体到: ${filterFontSize}px`);
              } else {
                filterFontSize = Math.max(filterFontSize - FONT_SIZE_STEP, MIN_FONT_SIZE);
                console.log(`⬇️ 缩小过滤输入框字体到: ${filterFontSize}px`);
              }

              // 应用字体大小
              applyFontSize();

              // 保存到 localStorage
              try {
                localStorage.setItem('filterFontSize', filterFontSize.toString());
              } catch (e) {
                console.warn('保存字体大小失败:', e);
              }

              // 显示提示
              if (typeof showMessage === 'function') {
                showMessage(`过滤输入框字体大小: ${filterFontSize}px`);
              }
            }
          }, { passive: false, capture: true });
        } else {
          console.warn('⚠️ filterBox 未找到！');
        }

        // 监听过滤结果框的 Ctrl + 滚轮事件
        // 🚀 性能优化：使用 DOM 缓存
        const filteredPanelContent = DOMCache.get('filteredPanelContent');
        if (filteredPanelContent) {
          console.log('✅ 绑定过滤结果框滚轮事件监听器');
          filteredPanelContent.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
              console.log('🖱️ 检测到过滤结果框 Ctrl + 滚轮，deltaY:', e.deltaY);
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              // 向上滚动放大，向下滚动缩小
              if (e.deltaY < 0) {
                filteredLogFontSize = Math.min(filteredLogFontSize + FONT_SIZE_STEP, MAX_FONT_SIZE);
                console.log(`⬆️ 放大过滤结果框字体到: ${filteredLogFontSize}px`);
              } else {
                filteredLogFontSize = Math.max(filteredLogFontSize - FONT_SIZE_STEP, MIN_FONT_SIZE);
                console.log(`⬇️ 缩小过滤结果框字体到: ${filteredLogFontSize}px`);
              }

              // 应用字体大小和行高（已包含重新渲染逻辑）
              applyFilteredLogFontSize();

              // 保存到 localStorage
              try {
                localStorage.setItem('filteredLogFontSize', filteredLogFontSize.toString());
              } catch (e) {
                console.warn('保存字体大小失败:', e);
              }

              // 显示提示
              if (typeof showMessage === 'function') {
                showMessage(`过滤结果框字体大小: ${filteredLogFontSize}px`);
              }
            } else if (e.altKey) {
              // Alt + 滚轮：左右平移
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              // deltaY 为负向上滚动，向左平移
              // deltaY 为正向下滚动，向右平移
              const scrollAmount = e.deltaY;
              filteredPanelContent.scrollLeft += scrollAmount;
            }
          }, { passive: false, capture: true });
        } else {
          console.warn('⚠️ filteredPanelContent 未找到！');
        }

        console.log('✅ 字体缩放功能初始化完成');
      }

      // 初始化搜索框事件（包括自动建议）
      function initSearchBoxEvents() {
        // 输入事件：显示自动建议
        searchBox.addEventListener("input", () => {
          clearTimeout(searchInputTimeout);
          searchInputTimeout = setTimeout(() => {
            showSearchSuggestions();
          }, 300);

          const value = searchBox.value;
          // 使用trim检查是否为空，但保留原始值
          if (value.trim() === "" && searchKeyword !== "") {
            resetSearch();
          }
        });

        // 获得焦点时显示建议
        searchBox.addEventListener("focus", () => {
          showSearchSuggestions();
        });

        // 失去焦点时隐藏建议
        searchBox.addEventListener("blur", () => {
          // 延迟隐藏，以便点击建议项
          setTimeout(() => {
            hideSearchSuggestions();
          }, 200);
        });
      }

      // 更新选中的搜索建议项
      function updateSelectedSearchSuggestion(items) {
        items.forEach((item, index) => {
          if (index === selectedSearchSuggestionIndex) {
            item.style.backgroundColor = "rgba(0, 113, 227, 0.15)";
          } else {
            item.style.backgroundColor = "transparent";
          }
        });
      }

      // PgUp/PgDn 键翻页功能
      // 🚀 连续滚动状态管理
      const continuousScrollState = {
        isScrolling: false,
        direction: 0, // -1 for PageUp, 1 for PageDown, 0 for stopped
        speed: 1, // 当前速度倍率
        rafId: null,
        lastScrollTime: 0
      };

      // 🚀 目标容器缓存（避免频繁DOM查询）
      let cachedTargetContainer = null;
      let cachedClientHeight = 0;

      function getTargetContainer() {
        const filteredPanelEl = DOMCache.get('filteredPanel');
        const filteredPanelVisible = filteredPanelEl &&
          (filteredPanelEl.style.display !== 'none' && filteredPanelEl.classList.contains('visible'));

        if (filteredPanelVisible) {
          return DOMCache.get('filteredPanelContent');
        } else {
          return DOMCache.get('outerContainer');
        }
      }

      // 🚀 连续滚动核心函数
      function continuousScroll(timestamp) {
        if (!continuousScrollState.isScrolling) {
          return;
        }

        const targetContainer = getTargetContainer();
        if (!targetContainer) {
          continuousScrollState.isScrolling = false;
          return;
        }

        // 更新缓存的容器和高度
        if (cachedTargetContainer !== targetContainer) {
          cachedTargetContainer = targetContainer;
          cachedClientHeight = targetContainer.clientHeight;
        }

        // 🚀 加速机制：按住时间越长，速度越快
        // 最快速度是初始速度的5倍
        const timeSinceStart = timestamp - continuousScrollState.lastScrollTime;
        const acceleration = Math.min(5, 1 + timeSinceStart / 150); // 每150ms增加1倍速度，最高5倍

        // 🚀 优化：减小基础滚动量，单次滚动约85%视口高度（接近完整翻页）
        const baseScrollAmount = cachedClientHeight * 0.85;
        const scrollAmount = baseScrollAmount * acceleration * continuousScrollState.direction;

        // 执行滚动（使用 immediate 模式以获得更流畅的连续滚动）
        targetContainer.scrollBy({ top: scrollAmount, behavior: 'auto' });

        // 继续下一帧
        continuousScrollState.rafId = requestAnimationFrame(continuousScroll);
      }

      // 🚀 开始连续滚动
      function startContinuousScroll(direction) {
        if (continuousScrollState.isScrolling && continuousScrollState.direction === direction) {
          // 已经在同一方向滚动中，不重复启动
          return;
        }

        // 停止之前的滚动
        stopContinuousScroll();

        continuousScrollState.isScrolling = true;
        continuousScrollState.direction = direction;
        continuousScrollState.speed = 1;
        continuousScrollState.lastScrollTime = performance.now();

        // 立即执行第一次滚动
        const targetContainer = getTargetContainer();
        if (targetContainer) {
          cachedTargetContainer = targetContainer;
          cachedClientHeight = targetContainer.clientHeight;
          // 🚀 优化：单击滚动约85%视口高度（接近完整翻页，但留一点余地）
          const initialScrollAmount = cachedClientHeight * 0.85;
          targetContainer.scrollBy({ top: initialScrollAmount * direction, behavior: 'auto' });
        }

        // 延迟启动连续滚动循环，等待300ms判断是否为单击
        setTimeout(() => {
          if (continuousScrollState.isScrolling && continuousScrollState.direction === direction) {
            continuousScrollState.rafId = requestAnimationFrame(continuousScroll);
          }
        }, 300);
      }

      // 🚀 停止连续滚动
      function stopContinuousScroll() {
        continuousScrollState.isScrolling = false;
        continuousScrollState.direction = 0;
        continuousScrollState.speed = 1;
        if (continuousScrollState.rafId) {
          cancelAnimationFrame(continuousScrollState.rafId);
          continuousScrollState.rafId = null;
        }
      }

      // 🚀 按键处理：keydown 开始滚动
      function handlePageScroll(e) {
        // 如果焦点在输入框中，不处理
        if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
          return;
        }

        if (e.key === 'PageUp' || e.key === 'PageDown') {
          e.preventDefault();
          const direction = e.key === 'PageUp' ? -1 : 1;
          startContinuousScroll(direction);
        }
      }

      // 🚀 按键处理：keyup 停止滚动
      function handlePageScrollUp(e) {
        // 如果焦点在输入框中，不处理
        if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
          return;
        }

        if (e.key === 'PageUp' || e.key === 'PageDown') {
          stopContinuousScroll();
        }
      }

      // ========== 跳转到指定行功能 ==========
      let gotoLineModal = null;
      let gotoLineInput = null;
      let gotoLineTotalLines = null;

      function initGotoLineModal() {
        gotoLineModal = document.getElementById('gotoLineModal');
        gotoLineInput = document.getElementById('gotoLineInput');
        gotoLineTotalLines = document.getElementById('gotoLineTotalLines');

        // 关闭按钮
        document.getElementById('gotoLineClose').addEventListener('click', hideGotoLineModal);
        document.getElementById('gotoLineCancel').addEventListener('click', hideGotoLineModal);

        // 确定按钮
        document.getElementById('gotoLineOk').addEventListener('click', performGotoLine);

        // 点击背景关闭
        gotoLineModal.addEventListener('click', (e) => {
          if (e.target === gotoLineModal) {
            hideGotoLineModal();
          }
        });

        // ESC键关闭
        gotoLineModal.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            hideGotoLineModal();
          } else if (e.key === 'Enter') {
            performGotoLine();
          }
        });
      }

      function showGotoLineModal() {
        if (!gotoLineModal) {
          initGotoLineModal();
        }

        // 更新总行数
        gotoLineTotalLines.textContent = originalLines.length;

        // 清空输入框
        gotoLineInput.value = '';

        // 显示对话框
        gotoLineModal.classList.add('visible');

        // 聚焦输入框
        setTimeout(() => {
          gotoLineInput.focus();
          gotoLineInput.select();
        }, 100);
      }

      function hideGotoLineModal() {
        if (gotoLineModal) {
          gotoLineModal.classList.remove('visible');
        }
      }

      function performGotoLine() {
        const lineNum = parseInt(gotoLineInput.value, 10);

        if (isNaN(lineNum) || lineNum < 1 || lineNum > originalLines.length) {
          showMessage(`请输入有效的行号 (1 - ${originalLines.length})`);
          return;
        }

        // 转换为0-based索引
        const targetIndex = lineNum - 1;

        // 跳转
        jumpToLine(targetIndex, 'center');

        // 隐藏对话框
        hideGotoLineModal();

        showMessage(`已跳转到第 ${lineNum} 行`);
      }

      // 🚀 构建日志索引（新增优化功能）
      let indexBuildInProgress = false;

      async function buildLogIndexes(lines, forceRebuild = false) {
        // 防止重复构建
        if (indexBuildInProgress && !forceRebuild) {
          console.log('Index build already in progress, skipping...');
          return;
        }

        indexBuildInProgress = true;

        try {
          // 初始化搜索和过滤模块（如果尚未初始化）
          if (window.App && window.App.Search && !window.App.Search.indexer) {
            window.App.Search.init();
          }
          if (window.App && window.App.Filter && !window.App.Filter.indexer) {
            window.App.Filter.init();
          }

          // 显示索引构建状态
          if (window.searchStatus) {
            window.searchStatus.textContent = '索引构建中...';
          }

          // 构建搜索索引
          if (window.App && window.App.Search && window.App.Search.buildIndex) {
            window.App.Search.buildIndex(lines, forceRebuild);
          }

          // 构建过滤索引
          if (window.App && window.App.Filter && window.App.Filter.buildIndex) {
            window.App.Filter.buildIndex(lines, forceRebuild);
          }

          console.log(`✓ Index building initiated for ${lines.length} lines`);
        } catch (error) {
          console.error('Failed to build indexes:', error);
        } finally {
          // 延迟重置标志，避免重复构建
          setTimeout(() => {
            indexBuildInProgress = false;
          }, 1000);
        }
      }

      // 监听索引构建完成事件
      window.addEventListener('searchIndexComplete', (e) => {
        const { totalLines, buildTime } = e.detail;
        if (window.searchStatus) {
          window.searchStatus.textContent = `索引已构建 (${totalLines}行, ${buildTime.toFixed(0)}ms)`;
        }
        console.log(`✓ Search index complete: ${totalLines} lines in ${buildTime.toFixed(2)}ms`);
      });

      window.addEventListener('filterIndexComplete', (e) => {
        const { totalLines, buildTime } = e.detail;
        console.log(`✓ Filter index complete: ${totalLines} lines in ${buildTime.toFixed(2)}ms`);
      });

      // 监听索引构建进度事件
      window.addEventListener('searchIndexProgress', (e) => {
        const { indexedLines, totalLines, progress } = e.detail;
        if (window.searchStatus) {
          window.searchStatus.textContent = `索引构建: ${progress.toFixed(1)}%`;
        }
      });

      window.addEventListener('filterIndexProgress', (e) => {
        const { indexedLines, totalLines, progress } = e.detail;
        // 可以添加专门的过滤索引进度显示
      });

      // 执行搜索（基于原始日志）
      async function performSearch() {
        searchMatches = [];
        currentMatchIndex = -1;
        totalMatchCount = 0;

        // 🔧 修复：搜索时清空 HTML 解析缓存，避免显示旧的过滤关键词高亮
        clearHtmlParseCache();

        // 保存搜索历史
        addToSearchHistory(searchKeyword);

        // 使用trim检查是否为空，但保留原始值用于搜索
        if (searchKeyword.trim() === "") {
          updateSearchUI();
          renderLogLines();
          return;
        }

        // 🚀 优先使用索引搜索（新优化）
        if (window.App && window.App.Search && window.App.Search.indexer) {
          try {
            const indexedResults = await window.App.Search.search(searchKeyword, originalLines);

            if (indexedResults && indexedResults.length > 0) {
              // 🚀 修复：搜索结果始终从文件开头开始，不受滚动或点击影响
              // 直接使用索引返回的自然顺序（已经是从0开始的索引）
              searchMatches = indexedResults;
              totalMatchCount = searchMatches.length;
              currentMatchIndex = 0;

              updateSearchUI();
              renderLogLines();

              // 🔧 修复：先渲染日志行，再跳转（确保 DOM 已更新）
              if (totalMatchCount > 0) {
                requestAnimationFrame(() => {
                  jumpToMatch(currentMatchIndex);
                });
              }

              return;
            }
          } catch (indexError) {
            console.warn('Indexed search failed, falling back to linear search:', indexError);
            // 降级到线性搜索
          }
        }

        // 📋 降级方案：原始的线性搜索逻辑
        let regex;
        try {
          const parts = searchKeyword.split('|');
          const escapedPattern = parts.map(part => escapeRegExp(part)).join('|');
          regex = new RegExp(escapedPattern, "gi");
        } catch (e) {
          regex = new RegExp(escapeRegExp(searchKeyword), "gi");
        }

        let allMatches = [];

        // 🚀 修复：从头到尾顺序搜索，不受滚动或点击影响
        for (let i = 0; i < originalLines.length; i++) {
          const lineContent = originalLines[i]; // 直接使用原始内容
          regex.lastIndex = 0;
          if (regex.test(lineContent)) {
            allMatches.push(i);
          }
        }

        searchMatches = allMatches;
        totalMatchCount = searchMatches.length;
        currentMatchIndex = 0;

        updateSearchUI();
        renderLogLines();

        // 🔧 修复：先渲染日志行，再跳转（确保 DOM 已更新）
        if (totalMatchCount > 0) {
          requestAnimationFrame(() => {
            jumpToMatch(currentMatchIndex);
          });
        }
      }

      function jumpToMatch(index) {
        if (totalMatchCount === 0 || index < 0 || index >= totalMatchCount)
          return;

        const targetOriginalIndex = searchMatches[index];

        // 🚀 修复：确保获取正确的行高
        let lineHeight = getLineHeight();

        // 如果 getLineHeight() 返回无效值，使用计算样式获取
        if (!lineHeight || lineHeight <= 0 || isNaN(lineHeight)) {
          try {
            const innerElement = DOMCache.get('inner');
            if (innerElement && innerElement.firstElementChild) {
              lineHeight = innerElement.firstElementChild.offsetHeight;
            } else {
              lineHeight = 19; // 默认行高
            }
            console.log(`[jumpToMatch] 使用备用行高: ${lineHeight}px`);
          } catch (e) {
            lineHeight = 19; // 默认行高
            console.warn('[jumpToMatch] 获取行高失败，使用默认值 19px');
          }
        }

        const lineTop = targetOriginalIndex * lineHeight;
        const containerHeight = outer.clientHeight;
        const scrollTop = lineTop - containerHeight / 2 + lineHeight / 2 + (9 * lineHeight); // 往下调整9行，防止被过滤框挡住

        const targetTop = Math.max(0, scrollTop);

        // 关键修复：如果日志框正在进行"滚轮平滑 rAF"收敛动画，会持续抢写 scrollTop，
        // 导致 Enter/Shift+Enter 跳转看起来失效且有"弹跳"。这里必须先取消动画。
        try {
          if (outer && typeof outer.__fastSmoothWheelCancel === "function") {
            outer.__fastSmoothWheelCancel();
          }
        } catch (_) {}

        // 用直接赋值代替 smooth scroll，避免与虚拟滚动/滚轮动画叠加
        outer.scrollTop = targetTop;

        // 🚀 保持当前的横向滚动位置，不自动调整（避免位置偏移问题）
        // 如果确实需要自动横向滚动到关键词，可以取消下面的注释
        /*
        let targetScrollLeft = 0;
        try {
          // 获取当前字体大小（用于计算字符宽度）
          const currentFontSize = logFontSize || 14;
          const charWidth = currentFontSize * 0.6; // 等宽字体大约宽度

          // 获取目标行内容
          const lineContent = originalLines[targetOriginalIndex] || "";

          // 查找关键词在行中的位置（使用不区分大小写的搜索）
          const keywordLower = searchKeyword.toLowerCase();
          const contentLower = lineContent.toLowerCase();
          const keywordPos = contentLower.indexOf(keywordLower);

          if (keywordPos >= 0) {
            // 计算关键词的横向位置（考虑padding和行号宽度）
            const lineNumberWidth = 70; // 行号宽度大约70px
            const keywordStartPixel = lineNumberWidth + keywordPos * charWidth;
            const containerWidth = outer.clientWidth;

            // 如果关键词在可视区域右侧，需要向左滚动
            if (keywordStartPixel > outer.scrollLeft + containerWidth - 100) {
              targetScrollLeft = keywordStartPixel - containerWidth / 2;
            }
            // 如果关键词在可视区域左侧，需要向右滚动
            else if (keywordStartPixel < outer.scrollLeft + 50) {
              targetScrollLeft = Math.max(0, keywordStartPixel - 50);
            }

            targetScrollLeft = Math.max(0, targetScrollLeft);
          }
        } catch (e) {
          console.warn('[jumpToMatch] 计算横向位置失败:', e);
        }

        // 🚀 设置横向滚动位置
        if (targetScrollLeft !== outer.scrollLeft) {
          outer.scrollLeft = targetScrollLeft;
        }
        */

        // 🚀 修复：使用 requestAnimationFrame 确保 DOM 更新后再刷新可见行
        requestAnimationFrame(() => {
          forceUpdateVisibleLines();
        });
      }

      // 强制刷新可见行（忽略缓存检查）
      function forceUpdateVisibleLines() {
        lastVisibleStart = -1;
        lastVisibleEnd = -1;
        updateVisibleLines();
      }

      function prevMatch() {
        if (currentMatchIndex > 0) {
          currentMatchIndex--;
          jumpToMatch(currentMatchIndex);
          updateSearchUI();
        }
      }

      function nextMatch() {
        if (currentMatchIndex < totalMatchCount - 1) {
          currentMatchIndex++;
          jumpToMatch(currentMatchIndex);
          updateSearchUI();
        }
      }

      function resetSearch() {
        searchKeyword = "";
        searchMatches = [];
        currentMatchIndex = -1;
        totalMatchCount = 0;

        // 🔧 修复：重置搜索时清空 HTML 解析缓存
        clearHtmlParseCache();

        updateSearchUI();
        renderLogLines();
      }

      function updateSearchUI() {
        prevBtn.disabled = totalMatchCount === 0 || currentMatchIndex <= 0;
        nextBtn.disabled =
          totalMatchCount === 0 || currentMatchIndex >= totalMatchCount - 1;
        searchStatus.textContent =
          totalMatchCount > 0
            ? `${currentMatchIndex + 1}/${totalMatchCount}`
            : "";
      }

      // 修改：初始化拖拽功能，支持文件和文件夹拖拽（集成到outerContainer）
      function initDragDrop() {
        try {
          const isFileLikeDrop = (dt) => {
            try {
              if (!dt) return false;

              // 宽松检测：如果有 types，几乎都认为是文件拖拽
              if (dt.types && dt.types.length > 0) {
                try {
                  const arr = Array.from(dt.types);
                  console.log("🔍 isFileLikeDrop - types:", arr);

                  // 标准的 Files 类型
                  if (arr.includes("Files")) return true;

                  // WinRAR 等工具可能使用的 text/uri-list 或 text/plain
                  if (arr.includes("text/uri-list") || arr.includes("text/plain")) {
                    return true;
                  }

                  // 兼容性检查：某些应用可能使用自定义类型
                  if (arr.some(t => t && (
                    t.includes("file") ||
                    t.includes("uri") ||
                    t.includes("path") ||
                    t.includes("FileName") ||
                    t.includes("FileNameW")
                  ))) {
                    return true;
                  }

                  // 特别处理：WinRAR 可能不提供标准类型，如果没有任何不相关的类型，也允许通过
                  // 排除明显不是文件的类型（如 text/html, text/html等）
                  const nonFileTypes = ['text/html', 'text/plain', 'text/xml', 'application/xml'];
                  if (!arr.every(t => nonFileTypes.includes(t))) {
                    console.log("✅ 宽松检测：允许通过（未知数据类型）");
                    return true;
                  }
                } catch (_) {}
              }

              // 检查 files 属性
              if (dt.files && dt.files.length > 0) return true;

              // 检查 items 属性
              if (dt.items && dt.items.length > 0) {
                for (const it of dt.items) {
                  if (it && it.kind === "file") return true;
                }
              }

              return false;
            } catch (_) {
              return false;
            }
          };

          const setCopyDropEffect = (e) => {
            try {
              if (!e || !e.dataTransfer) return;
              e.dataTransfer.dropEffect = "copy";
              e.dataTransfer.effectAllowed = "copy";
            } catch (_) {
              // ignore
            }
          };

          const addDragOverStyle = () => {
            try {
              if (outer) outer.classList.add("drag-over");
            } catch (_) {}
          };

          const removeDragOverStyle = () => {
            try {
              if (outer) outer.classList.remove("drag-over");
            } catch (_) {}
          };

          // 统一处理：允许在页面任意位置拖拽文件/文件夹（不要求必须落在 outer 上）
          const onDragOver = (e) => {
            try {
              if (!isFileLikeDrop(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              setCopyDropEffect(e);
              addDragOverStyle();
            } catch (err) {
              console.error("dragover事件处理失败:", err);
            }
          };

          const onDragLeave = (e) => {
            try {
              if (!isFileLikeDrop(e.dataTransfer)) return;
              e.preventDefault();
              // 只有当鼠标真正离开outer容器时才移除样式（relatedTarget 可能为空）
              if (outer && e.relatedTarget && outer.contains(e.relatedTarget)) return;
              removeDragOverStyle();
            } catch (err) {
              console.error("dragleave事件处理失败:", err);
            }
          };

          const onDrop = async (e) => {
            try {
              if (!isFileLikeDrop(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              removeDragOverStyle();

              // 📊 调试：显示文件数量
              console.log("🏠 主窗口 drop 事件:");
              console.log("  - 文件数量:", e.dataTransfer.files ? e.dataTransfer.files.length : 0);

              if (!e.dataTransfer) {
                console.error("dataTransfer 不存在");
                showMessage("拖拽数据无效，请重新尝试");
                return;
              }
              await handleDropFiles(e.dataTransfer);
            } catch (error) {
              console.error("拖拽文件处理失败:", error);
              const errorMsg = error?.message || error?.toString() || "未知错误";
              if (typeof showMessage === "function") {
                showMessage(`拖拽文件失败: ${errorMsg}`);
              } else {
                alert(`拖拽文件失败: ${errorMsg}`);
              }
            }
          };

          // 主文档：捕获阶段监听，避免被其它组件拦截
          document.addEventListener("dragover", onDragOver, true);
          document.addEventListener("dragleave", onDragLeave, true);
          document.addEventListener("drop", onDrop, true);
          window.addEventListener("dragend", removeDragOverStyle, false);
          window.addEventListener("blur", removeDragOverStyle, false);

          // outer 上仍保留监听（便于 relatedTarget 判断更准确）
          if (outer) {
            outer.addEventListener("dragover", onDragOver, false);
            outer.addEventListener("dragleave", onDragLeave, false);
            outer.addEventListener("drop", onDrop, false);
          }

          // 兼容：当 log.html 被 index.html 以 iframe 方式嵌入时，
          // 某些浏览器会把 drop 事件落在父页面的 iframe 元素上而不是子文档内部。
          // 若同源，尝试在父文档捕获 drop 并转发到本页面的处理逻辑。
          try {
            const topWin = window.top;
            const topDoc = topWin && topWin.document ? topWin.document : null;
            if (topDoc && topDoc !== document) {
              topDoc.addEventListener(
                "dragover",
                (e) => {
                  if (!isFileLikeDrop(e.dataTransfer)) return;
                  try {
                    e.preventDefault();
                    setCopyDropEffect(e);
                  } catch (_) {}
                },
                true
              );

              topDoc.addEventListener(
                "drop",
                async (e) => {
                  if (!isFileLikeDrop(e.dataTransfer)) return;
                  try {
                    const el =
                      typeof topDoc.elementFromPoint === "function"
                        ? topDoc.elementFromPoint(e.clientX, e.clientY)
                        : null;
                    const iframe =
                      el && typeof el.closest === "function"
                        ? el.closest("iframe")
                        : null;
                    if (iframe && iframe.contentWindow === window) {
                      e.preventDefault();
                      e.stopPropagation();
                      removeDragOverStyle();
                      await handleDropFiles(e.dataTransfer);
                    }
                  } catch (err) {
                    // 父文档转发失败不影响子文档自身拖拽
                    console.warn("父页面drop转发失败:", err);
                  }
                },
                true
              );
            }
          } catch (_) {
            // 跨域/受限时忽略
          }
        } catch (error) {
          console.error("初始化拖拽功能失败:", error);
        }
      }

      // File System Access API（Chrome / Edge 86+）
      async function traverseHandle(handle, path, files, options = {}) {
        const { lazy = FILE_TREE_LAZY_LOAD_ENABLED, fullPath = "" } = options;

        console.log(`[traverseHandle 开始] kind=${handle.kind}, name=${handle.name}, path="${path}", lazy=${lazy}, fullPath="${fullPath}"`);

        try {
          if (!handle) {
            console.log("[traverseHandle] handle 为空，返回");
            return;
          }

          if (handle.kind === "file") {
            console.log(`[traverseHandle] 处理文件: ${handle.name}`);
            try {
              const file = await handle.getFile();
              if (file) {
                file.fullPath = path + file.name;
                // 设置webkitRelativePath以保持文件夹结构
                file.webkitRelativePath = file.fullPath;
                files.push(file);
              }
            } catch (error) {
              console.error("读取文件失败:", error);
              // 继续处理其他文件
            }
          } else if (handle.kind === "directory") {
            try {
              // 懒加载模式：只处理第一层文件和文件夹
              const entries = [];
              for await (const entry of handle.values()) {
                entries.push(entry);
              }
              // 按照名称进行自然排序（类似 sort -V）
              entries.sort((a, b) => {
                const nameA = a.name || "";
                const nameB = b.name || "";
                return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
              });

              // 懒加载模式
              if (lazy) {
                // 如果是根文件夹（path 为空），创建一个虚拟文件夹条目
                if (path === "" && fullPath) {
                  // 使用 fullPath 选项作为根路径
                  const rootPath = fullPath.replace(/\/$/, ''); // 移除末尾 /
                  const folderName = handle.name;
                  const folderFullPath = rootPath; // 如 D:/demolog/linux-master/linux-master/drivers/power
                  const folderOriginalPath = folderFullPath.replace(/\//g, '\\');

                  const rootDirItem = {
                    name: folderName,
                    kind: "directory",
                    fullPath: folderFullPath,
                    _isLazyDir: true,
                    _originalPath: folderOriginalPath,
                    // 添加 path 属性（Electron 特有），用于 handleDroppedFolder 识别环境
                    path: folderOriginalPath
                  };
                  files.push(rootDirItem);
                  console.log(`[懒加载] 创建根文件夹: ${folderName} -> ${folderFullPath}`);
                  return; // 只返回根文件夹，不处理子项
                }

                // 非根文件夹的处理（同之前）
                // 计算父文件夹的完整路径（如果有 fullPath 选项）
                let parentFullPath = '';
                if (fullPath && path === "") {
                  parentFullPath = fullPath.replace(/\/$/, '');
                } else if (path) {
                  parentFullPath = path.replace(/\/$/, '');
                }

                console.log(`[懒加载] 父路径: ${parentFullPath}, fullPath选项: ${fullPath}`);

                for (const entry of entries) {
                  // 构建完整的路径
                  let entryFullPath;
                  let entryOriginalPath;

                  if (parentFullPath) {
                    entryFullPath = `${parentFullPath}/${entry.name}`;
                    entryOriginalPath = parentFullPath + '\\' + entry.name;
                  } else {
                    entryFullPath = entry.name;
                    entryOriginalPath = entry.name;
                  }

                  console.log(`[懒加载] 条目: ${entry.name} -> fullPath: ${entryFullPath}`);

                  if (entry.kind === "file") {
                    try {
                      const file = await entry.getFile();
                      if (file) {
                        file.fullPath = entryFullPath;
                        file.webkitRelativePath = file.fullPath;
                        files.push(file);
                      }
                    } catch (error) {
                      console.error("读取文件失败:", error);
                    }
                  } else if (entry.kind === "directory") {
                    const dirItem = {
                      name: entry.name,
                      kind: "directory",
                      fullPath: entryFullPath,
                      _isLazyDir: true,
                      _originalPath: entryOriginalPath
                    };
                    files.push(dirItem);
                  }
                }
              } else {
                // 非懒加载模式：递归处理所有层级
                for (const entry of entries) {
                  await traverseHandle(entry, path + handle.name + "/", files, options);
                }
              }
            } catch (error) {
              console.error("遍历目录失败:", error);
              // 继续处理其他条目
            }
          }
        } catch (error) {
          console.error("traverseHandle 失败:", error);
          // 不抛出错误，让调用者继续处理
        }
      }

      // 处理拖拽文件（通用函数，供文件树和主容器使用）
      async function handleDropFiles(dt) {
        if (!dt) {
          console.error("dataTransfer 为空");
          showMessage("拖拽数据无效，请重新尝试");
          return;
        }

        // 🔍 调试：输出拖拽数据信息
        console.log("=== 拖拽调试信息 ===");
        console.log("📊 文件数量统计:");
        console.log("  - dt.types:", dt.types ? Array.from(dt.types) : 'N/A');
        console.log("  - dt.files.length:", dt.files ? dt.files.length : 0);
        console.log("  - dt.items.length:", dt.items ? dt.items.length : 0);

        if (dt.files && dt.files.length > 1) {
          console.log(`✅ 检测到 ${dt.files.length} 个文件（多文件拖拽）`);
        } else if (dt.files && dt.files.length === 1) {
          console.log("📄 检测到 1 个文件（单文件拖拽）");
        }

        // 尝试获取所有可能的数据类型
        if (dt.types) {
          for (const type of dt.types) {
            try {
              const data = dt.getData(type);
              console.log(`📋 getData('${type}'):`, data);
            } catch (e) {
              console.warn(`获取类型 ${type} 失败:`, e);
            }
          }
        }

        // 特殊处理：检查是否为 WinRAR 或其他压缩软件的 text/uri-list 格式
        console.log("🔍 检查 dt.types:", dt.types);
        if (dt.types) {
          try {
            // 尝试获取 URI list 数据（不管 types 是什么）
            const uriData = dt.getData('text/uri-list') || dt.getData('text/plain');
            console.log("📋 尝试获取 URI list 数据:", uriData ? `成功获取 (${uriData.length} 字符)` : "无数据");

            if (uriData && uriData.trim()) {
              // 解析 URI list（通常是 file:// 协议的本地路径）
              const uris = uriData.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'));

              if (uris.length > 0) {
                console.log("📁 解析到的 URI:", uris);

                // 检查是否为文件路径
                const filePaths = uris.map(uri => {
                  // 移除 file:// 前缀
                  if (uri.startsWith('file:///')) {
                    return decodeURIComponent(uri.substring(8).replace(/\//g, '\\'));
                  } else if (uri.startsWith('file://')) {
                    return decodeURIComponent(uri.substring(7).replace(/\//g, '\\'));
                  } else if (uri.startsWith('/') || /^[A-Za-z]:/.test(uri)) {
                    // 已经是路径格式
                    return uri.replace(/\//g, '\\');
                  }
                  return null;
                }).filter(p => p);

                if (filePaths.length > 0) {
                  console.log("✅ 检测到文件路径拖拽:", filePaths);

                  // 检查是否为压缩工具临时路径
                  for (const filePath of filePaths) {
                    const zipWindowMatch = detectZipWindowDrag(filePath);
                    if (zipWindowMatch) {
                      console.log("✅ 从 URI list 检测到压缩窗口拖拽:", zipWindowMatch);
                      await handleZipWindowDragFromPaths(filePaths, zipWindowMatch);
                      return;
                    }
                  }

                  // 如果不是压缩窗口，直接处理文件路径
                  await handleDroppedPaths(filePaths);
                  return;
                }
              }
            }
          } catch (error) {
            console.warn("解析 URI list 失败:", error);
            // 继续尝试其他方法
          }
        }

        if (dt.files && dt.files.length > 0) {
          for (let i = 0; i < dt.files.length; i++) {
            const file = dt.files[i];
            console.log(`文件 ${i}:`, {
              name: file.name,
              path: file.path,
              webkitRelativePath: file.webkitRelativePath,
              fullPath: file.fullPath,
              size: file.size
            });

            // 详细检查文件夹
            console.log(`🔍 文件夹检查 ${i}:`, {
              'name': file.name,
              'size': file.size,
              'path 以 \\\\ 结尾': file.path ? file.path.endsWith('\\') : 'N/A',
              '无扩展名': !file.name.includes('.'),
              '包含 BNZ.': file.path ? file.path.includes('\\BNZ.') : 'N/A',
              'webkitRelativePath 包含 /': (file.webkitRelativePath || '').includes('/')
            });
          }

          // 如果只有一个文件且 size === 0，可能是文件夹
          if (dt.files.length === 1) {
            const f = dt.files[0];
            // Windows: path 以 \ 结尾
            // Linux: path 为空或只有文件夹名
            const isFolderWin = f.path && (f.path.endsWith('\\') || f.path.endsWith('/'));
            const isFolderLinux = !f.path || (f.path && !f.path.includes('/') && !f.path.includes('\\'));

            if (f.size === 0 && (isFolderWin || isFolderLinux)) {
              console.warn(`⚠️ 检测到单个文件夹拖拽: ${f.name}`);
              console.warn(`⚠️ 路径信息: ${f.path}, size: ${f.size}`);
              // 尝试从 URI list 获取完整路径
            }
          }
        }

        // 【关键修复】在函数顶层定义 filePathMap，确保在整个函数作用域内可用
        // 因为在后续处理中 dt.files 可能会被清空或变为不可用
        const filePathMap = new Map();

        // 检测是否从Windows zip窗口拖拽（仅支持 WinRAR）
        if (dt.files && dt.files.length > 0) {
          const firstFile = dt.files[0];

          // 检查是否为 WinRAR 特征：size=0 且 path 是相对路径（没有盘符）
          if (firstFile.size === 0 && firstFile.path && !firstFile.path.includes(':') && !firstFile.path.startsWith('\\')) {
            console.warn("📦 检测到 WinRAR 拖拽（size=0, 相对路径）");
            console.log("🔍 WinRAR 相对路径:", firstFile.path);
            console.log("📊 渲染进程环境信息:");
            console.log("  - User Agent:", navigator.userAgent);
            console.log("  - Platform:", navigator.platform);
            console.log("  - Language:", navigator.language);
            console.log("  - 文件数量:", dt.files.length);

            // 输出所有文件的详细信息
            for (let i = 0; i < Math.min(dt.files.length, 5); i++) {
              const file = dt.files[i];
              console.log(`  文件 ${i}:`, {
                name: file.name,
                path: file.path,
                size: file.size,
                type: file.type,
                lastModified: new Date(file.lastModified).toISOString()
              });
            }

            // 尝试通过主进程解析相对路径
            try {
              showLoading(true, `正在解析${sourceType}文件路径...`);

              // 🚀 收集所有文件的相对路径，支持 Bandizip（path 为 undefined 时使用 name）
              let relativePaths = Array.from(dt.files).map(f => f.path || f.name);

              // 过滤掉 undefined
              relativePaths = relativePaths.filter(p => p !== undefined);

              // WinRAR文件夹拖拽：路径通常以分隔符结尾，或者有多个文件属于同一目录
              // Bandizip文件夹拖拽：直接使用文件夹名
              // 路径格式: d20251222_00000XXXXX00000_93426_390561\foldername\ 或
              //           d20251222_00000XXXXX00000_93426_390561\foldername\file.txt
              //           foldername (Bandizip)
              const pathSegments = relativePaths[0]?.split(/[/\\]/) || [];
              const pathEndsWithSep = relativePaths[0] && (relativePaths[0].endsWith('/') || relativePaths[0].endsWith('\\'));
              const hasMultipleFiles = relativePaths.length > 1;
              const isDirectoryDrop = pathEndsWithSep || hasMultipleFiles || isBandizipDrop;

              console.log("📋 收集到的相对路径 (数量:", relativePaths.length, "):", relativePaths);
              console.log("📂 是否为目录拖拽:", isDirectoryDrop);

              // 🚀 移除 WinRAR 拒绝逻辑（现在支持 Bandizip）
              // 直接调用主进程解析路径
              // 调用主进程解析路径
              const resolvedPaths = [];
              let winRarTempDir = null;

              // 对于目录拖拽，只处理第一条路径（主进程会复制整个目录）
              const pathsToResolve = isDirectoryDrop ? [relativePaths[0]] : relativePaths;

              for (let i = 0; i < pathsToResolve.length; i++) {
                const relPath = pathsToResolve[i];
                if (!relPath) continue;

                console.log(`🔍 [${i+1}/${pathsToResolve.length}] 解析路径:`, relPath);

                const result = await window.electronAPI.resolveWinRarPath(relPath, isDirectoryDrop);

                console.log(`  结果:`, result);

                if (result.success && result.fullPath) {
                  resolvedPaths.push(result.fullPath);
                  console.log(`  ✅ 解析成功: ${result.fullPath}`);

                  // 如果是WinRAR，主进程已经复制好了，直接使用其临时目录
                  if (result.isWinRAR && result.persistentTempDir) {
                    winRarTempDir = result.persistentTempDir;
                    console.log(`  📦 WinRAR已复制到: ${winRarTempDir}`);
                  }
                } else {
                  console.warn(`  ⚠️ 解析失败:`, result.error);
                }
              }

              showLoading(false);

              if (resolvedPaths.length === 0) {
                throw new Error("无法解析WinRAR文件路径，可能文件已被删除");
              }

              console.log("✅ 成功解析路径数量:", resolvedPaths.length);

              // 如果WinRAR已经处理好了，直接加载
              if (winRarTempDir) {
                console.log("✅ WinRAR已处理，直接加载到文件树:", winRarTempDir);
                // 获取文件夹名称（从路径中提取最后一段）
                const folderName = winRarTempDir.split(/[/\\]/).pop();
                console.log("📂 文件夹名称:", folderName);

                // 创建虚拟文件夹对象，用于懒加载
                const lazyFolder = {
                  name: folderName,
                  path: winRarTempDir,
                  fullPath: folderName,  // 用于文件树显示
                  webkitRelativePath: folderName,
                  _isLazyDir: true,  // 标记为懒加载目录
                  _originalPath: winRarTempDir,  // 保存原始路径用于读取
                  _fromPath: true
                };

                console.log("📂 创建懒加载文件夹:", lazyFolder);
                addFilesToTree([lazyFolder]);
                showMessage(`已从WinRAR加载文件夹: ${folderName}`);
                return;
              }

              // 非WinRAR情况，继续原有逻辑（复制文件）
              console.log("📂 非WinRAR处理，复制文件到新的临时目录...");
              showLoading(true, `正在复制 ${resolvedPaths.length} 个文件...`);

              const copyResult = await window.electronAPI.copyFilesToTemp(resolvedPaths);

              showLoading(false);

              if (copyResult.success && copyResult.tempDir) {
                console.log("✅ 文件已复制到临时目录:", copyResult.tempDir);

                // 加载到文件树
                await loadFolderToTree(copyResult.tempDir);
                showMessage(`已从WinRAR加载 ${copyResult.files.length} 个文件`);
                return;
              } else {
                throw new Error(copyResult.error || "复制文件失败");
              }
            } catch (error) {
              showLoading(false);
              console.error("处理WinRAR拖拽失败:", error);
              console.error("错误堆栈:", error.stack);
              showMessage(`处理WinRAR文件失败: ${error.message || "未知错误"}`);
              return;
            }
          }

          if (firstFile.path) {
            const zipWindowMatch = detectZipWindowDrag(firstFile.path);
            if (zipWindowMatch) {
              console.log("✅ 检测到从zip窗口拖拽:", zipWindowMatch);
              await handleZipWindowDrag(dt.files, zipWindowMatch);
              return;
            }
          }

          // 【路径缓存】在检测文件夹之前，填充 filePathMap
          if (dt.files && dt.files.length > 0) {
            for (let i = 0; i < dt.files.length; i++) {
              const file = dt.files[i];
              if (file && file.name && file.path) {
                filePathMap.set(file.name, file.path);
              }
            }
          }
          console.log(`[路径缓存] 早期缓存 - 已保存 ${filePathMap.size} 个文件路径`);

          // 如果文件有 path 属性且没有 webkitRelativePath，说明是单个文件拖拽（如 Bandizip）
          // 文件夹拖拽会有 webkitRelativePath 且包含 /，或 size === 0 且 path 以 \ 结尾
          const hasFolder = Array.from(dt.files).some(f => {
            if (!f.path) return false;

            // 检查是否为文件夹
            // 1. size === 0 且 path 以 \ 结尾（Electron 文件夹特征）
            // 2. 有 webkitRelativePath 且包含 /
            // 3. Bandizip 特殊情况：在 BNZ 临时目录中，文件没有扩展名，且 size 为 65536
            // 4. 通用检测：文件名没有扩展名（非常可能是文件夹）
            const hasNoExtension = !f.name.includes('.');
            const isBandizipTemp = f.path.includes('\\BNZ.');
            const isBandizipFolder = isBandizipTemp && hasNoExtension && f.size === 65536;

            const isFolder =
              // 1. Electron 文件夹特征：size === 0 且 path 以 \ 结尾
              (f.size === 0 && f.path.endsWith('\\')) ||
              // 2. 有 webkitRelativePath 且包含 /（浏览器拖拽文件夹）
              ((f.webkitRelativePath || '').includes('/')) ||
              // 3. Bandizip 特殊情况
              (isBandizipFolder);
              // 移除 "任何没有扩展名的都当成文件夹" 的判断，因为这会误判日志文件

            if (isFolder) {
              console.log(`❌ ${f.name} 是文件夹 (Bandizip: ${isBandizipFolder}, size=${f.size}, noExt=${hasNoExtension})`);
            }

            return isFolder;
          });

          // 检查是否应该使用直接处理（跳过 File System Access API）
          // 只有当 dt.items 不存在或不可用时，才使用直接处理
          const hasFileSystemHandleAPI = dt.items && dt.items.length > 0 &&
            dt.items[0] && typeof dt.items[0].getAsFileSystemHandle === 'function';

          const shouldUseDirectProcessing = !hasFolder && !hasFileSystemHandleAPI && dt.files.length > 0;

          console.log("🔍 检测结果:", {
            'hasFolder': hasFolder,
            'hasFileSystemHandleAPI': hasFileSystemHandleAPI,
            'shouldUseDirectProcessing': shouldUseDirectProcessing,
            '将使用': shouldUseDirectProcessing ? 'dt.files 直接处理' : 'File System Access API'
          });

          if (shouldUseDirectProcessing) {
            console.log("✅ 检测到标准文件拖拽（有 path 且无相对路径），跳过 File System Access API");
            console.log("✅ 直接处理 dt.files，数量:", dt.files.length);

            const files = Array.from(dt.files);

            // 分离压缩包和普通文件
            const archiveFiles = files.filter(f => isArchiveFile(f));
            const normalFiles = files.filter(f => !isArchiveFile(f));

            console.log(`✅ 压缩包: ${archiveFiles.length}, 普通文件: ${normalFiles.length}`);

            // 先处理压缩包
            for (const archiveFile of archiveFiles) {
              await processArchiveFile(archiveFile);
            }

            // 然后处理普通文件
            if (normalFiles.length > 0) {
              const looksLikeFolder = normalFiles.some((f) =>
                f && (f.webkitRelativePath || "").includes("/")
              );
              if (looksLikeFolder) {
                await handleDroppedFolder(normalFiles);
              } else {
                await handleDroppedFiles(normalFiles);
              }
            }
            return;
          }
        }

        // 情况 1：现代 Chrome / Edge（推荐）- 使用 File System Access API
        // 注意：此API仅在HTTPS或localhost环境下可用，HTTP环境会自动跳过
        if (dt.items && dt.items.length > 0) {
          try {
            console.log("🔄 尝试使用 File System Access API");
            // 检查是否支持 File System Access API（需要安全上下文）
            // 在HTTP环境下，此API可能不存在或会抛出错误
            const firstItem = dt.items[0];
            if (firstItem && typeof firstItem.getAsFileSystemHandle === 'function') {
              // 检查是否在安全上下文中（HTTPS或localhost）
              const isSecureContext = window.isSecureContext ||
                window.location.protocol === 'https:' ||
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';

              console.log("🔒 安全上下文:", isSecureContext);

              if (isSecureContext) {
                const files = [];
                let isFolder = false;

                // 使用之前保存的 filePathMap（在检查 hasFolder 时创建）
                console.log(`[路径缓存] File System Access API - 使用已缓存的 ${filePathMap.size} 个路径`);

                try {
                  console.log("🔄 开始处理 items，数量:", dt.items.length);
                  console.log("🔄 dt.files 初始数量:", dt.files.length);

                  // 🚀 关键修复：在处理 items 之前先保存 dt.files 到本地数组
                  // 因为 dt.files 和 dt.items 是关联的，处理 items 时会导致 dt.files 被清空
                  const fallbackFiles = Array.from(dt.files);
                  console.log("🔄 已保存 fallbackFiles，数量:", fallbackFiles.length);

                  const itemsArray = Array.from(dt.items);
                  console.log("🔄 itemsArray 长度:", itemsArray.length);

                  for (let i = 0; i < itemsArray.length; i++) {
                    const item = itemsArray[i];
                    console.log(`🔄 [${i+1}/${itemsArray.length}] 开始处理 item`);
                    try {
                      if (!item) {
                        console.log(`⚠️ [${i+1}/${itemsArray.length}] item 为空，跳过`);
                        continue;
                      }

                      // 检查 item 类型，跳过非文件项
                      const itemType = item.kind;
                      console.log(`🔄 [${i+1}/${itemsArray.length}] item.kind: ${itemType}`);
                      if (itemType && itemType !== 'file') {
                        console.log(`⚠️ [${i+1}/${itemsArray.length}] 跳过非文件项: ${itemType}`);
                        continue;
                      }

                      // 🚀 关键优化：提前检测 Bandizip 文件夹（size=0 且 path=undefined）
                      // 跳过 getAsFileSystemHandle，直接使用 fallbackFiles，避免 5 秒超时等待
                      const fallbackFile = fallbackFiles[i];
                      const isBandizipFolder = fallbackFile &&
                        (!fallbackFile.size || fallbackFile.size === 0) &&
                        !fallbackFile.path;

                      if (isBandizipFolder) {
                        console.log(`🚀 [${i+1}/${itemsArray.length}] 检测到 Bandizip 文件夹，跳过 getAsFileSystemHandle，直接使用 fallbackFiles`);
                        console.log(`🔄 [${i+1}/${itemsArray.length}] 从 fallbackFiles[${i}] 获取文件: ${fallbackFile.name}`);

                        // 创建懒加载文件夹节点
                        const lazyFolder = {
                          name: fallbackFile.name,
                          kind: "directory",
                          fullPath: fallbackFile.name,
                          _isLazyDir: true,
                          isLocalDrive: true, // 🔧 标记为本地文件
                          _originalPath: undefined  // Bandizip 文件夹没有真实路径
                        };

                        files.push(lazyFolder);
                        console.log(`✅ [${i+1}/${itemsArray.length}] 创建懒加载文件夹: ${fallbackFile.name}, files 数量: ${files.length}`);
                        continue;  // 跳过后续的 handle/entry 处理
                      }

                      console.log(`🔄 [${i+1}/${itemsArray.length}] 处理 item:`, item);
                      console.log(`🔄 [${i+1}/${itemsArray.length}] 调用 getAsFileSystemHandle...`);

                      let handle;
                      try {
                        // 🚀 添加超时处理（5秒），避免 Bandizip 等工具导致挂起
                        const handlePromise = item.getAsFileSystemHandle();
                        const timeoutPromise = new Promise((_, reject) =>
                          setTimeout(() => reject(new Error('getAsFileSystemHandle timeout after 5s')), 5000)
                        );
                        handle = await Promise.race([handlePromise, timeoutPromise]);
                        console.log(`🔄 [${i+1}/${itemsArray.length}] getAsFileSystemHandle 返回:`, handle);
                      } catch (handleError) {
                        console.error(`❌ [${i+1}/${itemsArray.length}] getAsFileSystemHandle 失败:`, handleError.message);
                        handle = null;
                      }

                      if (!handle) {
                        console.log(`⚠️ [${i+1}/${itemsArray.length}] getAsFileSystemHandle 返回 undefined，尝试使用 webkitGetAsEntry 作为后备`);

                        // 后备方案1：使用 webkitGetAsEntry
                        try {
                          const entry = item.webkitGetAsEntry();
                          console.log(`🔄 [${i+1}/${itemsArray.length}] webkitGetAsEntry 返回:`, entry);

                          if (entry) {
                            // 使用 entry 替代 handle
                            if (entry.isFile) {
                              const file = await new Promise((resolve, reject) => {
                                entry.file(resolve, reject);
                              });

                              if (file) {
                                // 从 filePathMap 获取路径
                                if (filePathMap.has(file.name)) {
                                  const filePath = filePathMap.get(file.name);
                                  file.fullPath = filePath.replace(/\\/g, '/');
                                  file.webkitRelativePath = file.fullPath;
                                } else {
                                  file.fullPath = file.name;
                                  file.webkitRelativePath = file.name;
                                }
                                files.push(file);
                                console.log(`✅ [${i+1}/${itemsArray.length}] 通过 webkitGetAsEntry 成功添加文件: ${file.name}, files 数量: ${files.length}`);
                              }
                            } else if (entry.isDirectory) {
                              console.log(`📂 [${i+1}/${itemsArray.length}] webkitGetAsEntry 检测到目录，创建懒加载文件夹节点`);

                              // 🚀 创建懒加载文件夹节点
                              const folderName = entry.name || fallbackFiles[i]?.name || 'Unknown';
                              const lazyFolder = {
                                name: folderName,
                                kind: "directory",
                                fullPath: folderName,
                                _isLazyDir: true,
                                isLocalDrive: true, // 🔧 标记为本地文件
                                // 尝试从 fallbackFiles 获取路径信息
                                _originalPath: fallbackFiles[i]?.path || undefined
                              };

                              files.push(lazyFolder);
                              isFolder = true;
                              console.log(`✅ [${i+1}/${itemsArray.length}] 通过 webkitGetAsEntry 创建懒加载文件夹: ${folderName}`);
                            }
                            continue; // webkitGetAsEntry 成功，跳过其他后备方案
                          }
                        } catch (entryError) {
                          console.error(`❌ [${i+1}/${itemsArray.length}] webkitGetAsEntry 后备方案失败:`, entryError);
                        }

                        console.log(`⚠️ [${i+1}/${itemsArray.length}] webkitGetAsEntry 也失败，尝试直接使用 fallbackFiles[${i}]`);

                        // 后备方案2：直接从保存的 fallbackFiles 获取文件（最可靠的后备方案）
                        if (i < fallbackFiles.length) {
                          const fallbackFile = fallbackFiles[i];
                          console.log(`🔄 [${i+1}/${itemsArray.length}] 从 fallbackFiles[${i}] 获取文件:`, fallbackFile ? fallbackFile.name : 'null');

                          if (fallbackFile && fallbackFile.name) {
                            // 检查是否已经处理过这个文件（通过 filePathMap）
                            let isDuplicate = false;
                            for (const existingFile of files) {
                              if (existingFile.name === fallbackFile.name) {
                                isDuplicate = true;
                                break;
                              }
                            }

                            if (isDuplicate) {
                              console.log(`⚠️ [${i+1}/${itemsArray.length}] 文件已存在，跳过: ${fallbackFile.name}`);
                              continue;
                            }

                            // 🚀 检测是否为文件夹（size=0 可能是 Bandizip 等工具的文件夹）
                            if (!fallbackFile.size || fallbackFile.size === 0) {
                              console.log(`📂 [${i+1}/${itemsArray.length}] 检测到可能的文件夹（size=0），创建懒加载文件夹节点`);

                              const lazyFolder = {
                                name: fallbackFile.name,
                                kind: "directory",
                                fullPath: fallbackFile.name,
                                _isLazyDir: true,
                                _originalPath: undefined
                              };

                              files.push(lazyFolder);
                              isFolder = true;
                              console.log(`✅ [${i+1}/${itemsArray.length}] 创建懒加载文件夹: ${fallbackFile.name}`);
                              continue;
                            }

                            // 设置文件路径
                            if (filePathMap.has(fallbackFile.name)) {
                              const filePath = filePathMap.get(fallbackFile.name);
                              fallbackFile.fullPath = filePath.replace(/\\/g, '/');
                              // 🚀 关键修复：后备方案处理的是独立文件，不要设置 webkitRelativePath
                              // 否则会导致 hasFolder 判断误认为这是文件夹上传
                              delete fallbackFile.webkitRelativePath;
                            } else {
                              fallbackFile.fullPath = fallbackFile.name;
                              // 🚀 同样不设置 webkitRelativePath，使用文件名即可
                              delete fallbackFile.webkitRelativePath;
                            }

                            files.push(fallbackFile);
                            console.log(`✅ [${i+1}/${itemsArray.length}] 通过 fallbackFiles 后备方案成功添加文件: ${fallbackFile.name}, files 数量: ${files.length}`);
                          } else {
                            console.log(`⚠️ [${i+1}/${itemsArray.length}] fallbackFiles[${i}] 为空或无效`);
                          }
                        } else {
                          console.log(`⚠️ [${i+1}/${itemsArray.length}] fallbackFiles 无效或索引越界 (fallbackFiles.length=${fallbackFiles.length})`);
                        }

                        continue; // 已通过后备方案处理
                      }

                      console.log(`🔄 [${i+1}/${itemsArray.length}] 获得 handle:`, handle.kind, handle.name);
                      if (handle.kind === "directory") {
                        isFolder = true;
                      }

                      // 获取完整路径 - 尝试多种方法
                      let fullPath = "";

                      // 方法1：从预先保存的 filePathMap 获取本地路径
                      // 这是最可靠的方法，因为在 Electron 中 dt.files[0].path 包含实际文件系统路径
                      console.log(`[调试1-${i+1}] 尝试从 filePathMap 获取路径，handle.name=${handle.name}, Map.size=${filePathMap.size}`);
                      console.log(`[调试2-${i+1}] filePathMap.has(handle.name):`, filePathMap.has(handle.name));
                      if (filePathMap.has(handle.name)) {
                        const filePath = filePathMap.get(handle.name);
                        console.log(`[调试3-${i+1}] 从 Map 获取的 path:`, filePath);
                        fullPath = filePath.replace(/\\/g, '/');
                        if (handle.kind === "directory" && !fullPath.endsWith('/')) {
                          fullPath += '/';
                        }
                        console.log(`✅ [${i+1}/${itemsArray.length}] 从 filePathMap 获取本地路径:`, fullPath);
                      } else {
                        console.log(`⚠️ [${i+1}/${itemsArray.length}] filePathMap 中没有找到 handle.name:`, handle.name);
                        console.log(`⚠️ [${i+1}/${itemsArray.length}] Map 中的 keys:`, Array.from(filePathMap.keys()));
                      }

                      // 方法2：如果方法1失败，尝试从 dt.items[0].webkitGetAsEntry().fullPath 获取
                      if (!fullPath) {
                        try {
                          const entry = item.webkitGetAsEntry();
                          if (entry && entry.fullPath && entry.fullPath !== '/') {
                            fullPath = entry.fullPath.replace(/^\//, ''); // 移除开头的 /
                            if (!fullPath.endsWith('/')) {
                              fullPath += '/';
                            }
                            console.log(`✅ [${i+1}/${itemsArray.length}] 从 entry.fullPath 获取:`, fullPath);
                          }
                        } catch (e) {
                          console.log(`⚠️ [${i+1}/${itemsArray.length}] entry.fullPath 获取失败:`, e.message);
                        }
                      }

                      console.log(`🔄 [${i+1}/${itemsArray.length}] 最终 fullPath:`, fullPath);
                      console.log(`🔄 [${i+1}/${itemsArray.length}] 准备调用 traverseHandle，参数:`, { kind: handle.kind, name: handle.name, fullPath, lazy: true });
                      // 懒加载模式：只获取第一层，传递完整路径
                      await traverseHandle(handle, "", files, { lazy: true, fullPath });
                      console.log(`🔄 [${i+1}/${itemsArray.length}] traverseHandle 后，files 数量:`, files.length);
                    } catch (itemError) {
                      console.error(`❌ [${i+1}/${itemsArray.length}] 处理单个拖拽项失败:`, itemError);
                      console.error(`❌ [${i+1}/${itemsArray.length}] 错误堆栈:`, itemError.stack);
                      // 继续处理其他项
                    }
                    console.log(`🔄 [${i+1}/${itemsArray.length}] item 处理完成`);
                  }

                  console.log(`🔄 所有 ${itemsArray.length} 个 items 处理完成，files 数量:`, files.length);

                  if (files.length > 0) {
                    // 确保所有文件都有 fullPath 和 webkitRelativePath
                    files.forEach((file) => {
                      if (file) {
                        if (!file.fullPath) {
                          file.fullPath = file.webkitRelativePath || file.name || 'unknown';
                        }
                        if (!file.webkitRelativePath && file.fullPath) {
                          file.webkitRelativePath = file.fullPath;
                        }
                      }
                    });
                    // 按照 fd | sort -V 的顺序排序文件
                    files.sort((a, b) => {
                      const pathA = a.fullPath || a.webkitRelativePath || a.name || "";
                      const pathB = b.fullPath || b.webkitRelativePath || b.name || "";
                      return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
                    });

                    // 分离压缩包和普通文件
                    const archiveFiles = files.filter(f => isArchiveFile(f));
                    const normalFiles = files.filter(f => !isArchiveFile(f));

                    // 先处理压缩包
                    for (const archiveFile of archiveFiles) {
                      await processArchiveFile(archiveFile);
                    }

                    // 然后处理普通文件
                    if (normalFiles.length > 0) {
                      const looksLikeFolder = normalFiles.some((f) =>
                        f && (f.webkitRelativePath || "").includes("/")
                      );
                      if (looksLikeFolder || isFolder) {
                        await handleDroppedFolder(normalFiles);
                      } else {
                        handleDroppedFiles(normalFiles);
                      }
                    }
                    return;
                  }
                } catch (error) {
                  console.warn("File System Access API 失败，尝试降级处理:", error);
                  // 继续尝试其他方法
                }
              } else {
                // 不在安全上下文中，跳过此API
                console.log("不在安全上下文中，跳过 File System Access API");
              }
            }
          } catch (error) {
            console.warn("检查 File System Access API 失败:", error);
            // 继续尝试其他方法
          }
        }

        // 情况 2：旧版 Chromium（webkitGetAsEntry）
        if (dt.items && dt.items.length > 0) {
          try {
            const files = [];
            let pending = 0;
            let hasError = false;
            let isFolder = false;
            let hasProcessed = false;
            let timeoutId = null;

            const processFiles = async () => {
              if (hasProcessed) return;
              hasProcessed = true;
              
              // 清除超时定时器
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
              
              if (files.length > 0) {
                try {
                  // 按照 fd | sort -V 的顺序排序文件
                  files.sort((a, b) => {
                    const pathA = a.fullPath || a.webkitRelativePath || a.name || "";
                    const pathB = b.fullPath || b.webkitRelativePath || b.name || "";
                    return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
                  });

                  // 分离压缩包和普通文件
                  const archiveFiles = files.filter(f => isArchiveFile(f));
                  const normalFiles = files.filter(f => !isArchiveFile(f));

                  // 先处理压缩包
                  for (const archiveFile of archiveFiles) {
                    await processArchiveFile(archiveFile);
                  }

                  // 然后处理普通文件
                  if (normalFiles.length > 0) {
                    const looksLikeFolder = normalFiles.some((f) =>
                      f && (f.webkitRelativePath || "").includes("/")
                    );
                    if (looksLikeFolder || isFolder) {
                      await handleDroppedFolder(normalFiles);
                    } else {
                      handleDroppedFiles(normalFiles);
                    }
                  }
                } catch (processError) {
                  console.error("处理文件列表失败:", processError);
                  showMessage(`处理文件失败: ${processError.message || "未知错误"}`);
                }
              } else if (!hasError) {
                // 没有文件且没有错误，可能只是空文件夹
                console.warn("没有找到文件");
              }
            };

            const traverseEntry = (entry, path = "") => {
              if (!entry) return;
              
              try {
                if (entry.isFile) {
                  pending++;
                  try {
                    entry.file(
                      (file) => {
                        try {
                          if (file) {
                            file.fullPath = (path || "") + (file.name || "unknown");
                            file.webkitRelativePath = file.fullPath;
                            files.push(file);
                          }
                        } catch (err) {
                          console.error("处理文件对象失败:", err);
                        } finally {
                          pending--;
                          if (pending === 0 && !hasProcessed) {
                            processFiles();
                          }
                        }
                      },
                      (error) => {
                        console.error("读取文件失败:", error);
                        pending--;
                        if (pending === 0 && !hasProcessed) {
                          processFiles();
                        }
                      }
                    );
                  } catch (fileError) {
                    console.error("调用entry.file失败:", fileError);
                    pending--;
                    if (pending === 0 && !hasProcessed) {
                      processFiles();
                    }
                  }
                } else if (entry.isDirectory) {
                  try {
                    const reader = entry.createReader();
                    if (!reader) {
                      console.error("无法创建目录读取器");
                      return;
                    }
                    
                    // 收集所有条目，然后按照 sort -V 的顺序排序
                    const allEntries = [];
                    const readAllEntries = () => {
                      try {
                        reader.readEntries(
                          (entries) => {
                            try {
                              if (entries.length > 0) {
                                allEntries.push(...entries);
                                readAllEntries();
                              } else {
                                // 目录读取完成，按照 sort -V 的顺序排序
                                allEntries.sort((a, b) => {
                                  const nameA = (a.name || "").toLowerCase();
                                  const nameB = (b.name || "").toLowerCase();
                                  return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
                                });
                                // 按排序后的顺序递归处理
                                allEntries.forEach((en) => {
                                  if (en) {
                                    traverseEntry(en, path + (entry.name || "") + "/");
                                  }
                                });
                                // 检查是否所有文件都已处理
                                if (pending === 0 && !hasProcessed) {
                                  processFiles();
                                }
                              }
                            } catch (entriesError) {
                              console.error("处理目录条目失败:", entriesError);
                              if (pending === 0 && !hasProcessed) {
                                processFiles();
                              }
                            }
                          },
                          (error) => {
                            console.error("读取目录失败:", error);
                            if (pending === 0 && !hasProcessed) {
                              processFiles();
                            }
                          }
                        );
                      } catch (err) {
                        console.error("调用readEntries失败:", err);
                        if (pending === 0 && !hasProcessed) {
                          processFiles();
                        }
                      }
                    };
                    readAllEntries();
                  } catch (readerError) {
                    console.error("创建目录读取器失败:", readerError);
                  }
                }
              } catch (error) {
                console.error("遍历条目失败:", error);
              }
            };

            // 处理所有拖拽项
            let hasValidEntry = false;
            for (let i = 0; i < dt.items.length; i++) {
              try {
                const item = dt.items[i];
                if (!item) continue;
                
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                if (entry) {
                  hasValidEntry = true;
                  if (entry.isDirectory) {
                    isFolder = true;
                  }
                  traverseEntry(entry);
                }
              } catch (itemError) {
                console.warn("处理拖拽项失败:", itemError);
                // 继续处理其他项
              }
            }
            
            // 如果没有有效的条目，尝试其他方法
            if (!hasValidEntry) {
              throw new Error("无法获取有效的文件系统条目");
            }
            
            // 如果没有文件需要异步处理，立即处理
            if (pending === 0 && files.length > 0 && !hasProcessed) {
              processFiles();
            } else if (pending === 0 && files.length === 0 && !hasProcessed) {
              // 可能是空拖拽或者只有文件夹但没有文件
              // 设置一个短延迟，如果还是没有文件，则尝试其他方法
              setTimeout(() => {
                if (!hasProcessed && files.length === 0) {
                  // 没有文件，可能是空拖拽，尝试情况3
                  throw new Error("没有找到文件，尝试其他方法");
                }
              }, 100);
            }
            
            // 设置超时保护，防止pending永远不归零
            timeoutId = setTimeout(() => {
              if (!hasProcessed) {
                console.warn("文件处理超时，强制完成");
                processFiles();
              }
            }, 5000);
            
            return;
          } catch (error) {
            console.warn("webkitGetAsEntry 处理失败:", error);
            // 继续尝试其他方法
          }
        }

        // 情况 3：只能拿到文件（无目录结构）- 这是最通用的方法，在HTTP环境下通常使用这个
        if (dt.files && dt.files.length > 0) {
          try {
            const files = [];
            for (let i = 0; i < dt.files.length; i++) {
              try {
                const f = dt.files[i];
                if (f) {
                  f.fullPath = f.webkitRelativePath || f.name || `file_${i}`;
                  if (!f.webkitRelativePath && f.fullPath) {
                    f.webkitRelativePath = f.fullPath;
                  }
                  files.push(f);
                }
              } catch (fileError) {
                console.warn("处理单个文件失败:", fileError);
                // 继续处理其他文件
              }
            }

            if (files.length > 0) {
              // 按照 fd | sort -V 的顺序排序文件
              files.sort((a, b) => {
                const pathA = a.fullPath || a.webkitRelativePath || a.name || "";
                const pathB = b.fullPath || b.webkitRelativePath || b.name || "";
                return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
              });
              
              // 检查是否包含压缩包文件
              const archiveFiles = files.filter(f => isArchiveFile(f));
              const normalFiles = files.filter(f => !isArchiveFile(f));
              
              // 先处理压缩包
              if (archiveFiles.length > 0) {
                for (const archiveFile of archiveFiles) {
                  await processArchiveFile(archiveFile);
                }
              }
              
              // 然后处理普通文件
              if (normalFiles.length > 0) {
                const looksLikeFolder = normalFiles.some((f) =>
                  f && (f.webkitRelativePath || "").includes("/")
                );
                if (looksLikeFolder) {
                  await handleDroppedFolder(normalFiles);
                } else {
                  handleDroppedFiles(normalFiles);
                }
              }
              return;
            }
          } catch (error) {
            console.error("处理文件列表失败:", error);
            showMessage(`处理文件失败: ${error.message || "未知错误"}`);
            return;
          }
        }

        // 如果没有匹配到任何情况，提示用户
        console.warn("无法识别拖拽的内容", {
          hasItems: !!(dt.items && dt.items.length > 0),
          hasFiles: !!(dt.files && dt.files.length > 0),
          itemCount: dt.items ? dt.items.length : 0,
          fileCount: dt.files ? dt.files.length : 0
        });

        // 最后的兜底尝试：尝试从所有可能的类型中提取文件路径
        if (dt.types && dt.types.length > 0) {
          console.log("🔧 尝试兜底处理：遍历所有数据类型");

          for (const type of dt.types) {
            try {
              const data = dt.getData(type);
              console.log(`🔧 尝试类型 ${type}:`, data);

              if (data && typeof data === 'string' && data.length > 0 && data.length < 10000) {
                // 尝试检测是否为文件路径
                const lines = data.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                for (const line of lines) {
                  // 检查是否为 Windows 路径
                  if (/^[A-Za-z]:\\/.test(line) || /^\\\\/.test(line) || line.startsWith('file://')) {
                    console.log("✅ 兜底处理：发现可能的文件路径:", line);

                    let filePath = line;
                    if (line.startsWith('file://')) {
                      filePath = decodeURIComponent(line.replace(/^file:\/\/\//, '').replace(/\//g, '\\'));
                    } else if (line.startsWith('file:')) {
                      filePath = decodeURIComponent(line.substring(5).replace(/\//g, '\\'));
                    }

                    await handleDroppedPaths([filePath]);
                    return;
                  }
                }
              }
            } catch (e) {
              console.warn(`兜底处理类型 ${type} 失败:`, e);
            }
          }
        }

        showMessage("无法识别拖拽的内容，请尝试重新拖拽文件或文件夹");
      }

      // ============ 压缩包处理函数 ============
      
      // 检查是否为压缩包文件
      // 检测是否从Windows zip窗口拖拽（如：C:\Users\xxx\AppData\Local\Temp\Temp1_linux-master.zip\linux-master\file.log）
      function detectZipWindowDrag(filePath) {
        if (!filePath) return null;

        // 模式1: Windows资源管理器 - Temp1_xxx.zip 或 Temp2_xxx.zip 等
        let tempZipPattern = /\\Temp\d+_([^\\]+\.zip)\\([^\\]+)(?:\\|$)/;
        let match = filePath.match(tempZipPattern);

        if (match) {
          return {
            originalZipName: match[1],  // linux-master.zip
            tempPath: filePath.substring(0, filePath.indexOf(match[1]) + match[1].length),
            rootFolder: match[2],         // linux-master
            source: 'explorer'
          };
        }

        // 模式2: WinRAR - 通常是 Rar$xxx 或 RarTemp 目录
        // 例如: C:\Users\xxx\AppData\Local\Temp\Rar$DIa123.456\archive.zip\files\file.log
        // 或: C:\Users\xxx\AppData\Local\Temp\RarTemp\archive.zip\files\file.log
        const winRarPatterns = [
          /\\Rar\$[^\\]+\\([^\\]+\.zip|\.rar|\.7z)(?:\\|$)/,           // Rar$DIa123.456\archive.zip
          /\\RarTemp\\([^\\]+\.zip|\.rar|\.7z)(?:\\|$)/,                 // RarTemp\archive.zip
          /\\[^\\]+\.tar\.gz\\([^\\]+)(?:\\|$)/,                          // archive.tar.gz\folder
          /\\[^\\]+\.tar\.bz2\\([^\\]+)(?:\\|$)/,                         // archive.tar.bz2\folder
        ];

        for (let i = 0; i < winRarPatterns.length; i++) {
          match = filePath.match(winRarPatterns[i]);
          if (match) {
            // 提取压缩包完整路径
            const zipEndIndex = filePath.indexOf(match[1]) + match[1].length;
            return {
              originalZipName: match[1],
              tempPath: filePath.substring(0, zipEndIndex),
              rootFolder: null,  // WinRAR可能不包含根文件夹
              source: 'winrar'
            };
          }
        }

        // 模式3: 7-Zip - 7zxxx.tmp 格式
        // 例如: C:\Users\xxx\AppData\Local\Temp\7zO1234.tmp\archive.zip\files\file.log
        const sevenZipPattern = /\\7z[^\\]+\.tmp\\([^\\]+\.zip|\.7z|\.rar)(?:\\|$)/;
        match = filePath.match(sevenZipPattern);

        if (match) {
          const zipEndIndex = filePath.indexOf(match[1]) + match[1].length;
          return {
            originalZipName: match[1],
            tempPath: filePath.substring(0, zipEndIndex),
            rootFolder: null,
            source: '7zip'
          };
        }

        // 模式4: 通用模式 - 检测任何包含压缩包扩展名的临时路径
        // 匹配: 任意目录\压缩包.扩展\文件路径
        const genericPattern = /\\(Temp|tmp|[^\\]+temp[^\\]*)\\([^\\]+\.(?:zip|rar|7z|tar\.gz|tar\.bz2|tgz))(?:\\([^\\]+))?(?:\\|$)/i;
        match = filePath.match(genericPattern);

        if (match) {
          const zipEndIndex = filePath.indexOf(match[2]) + match[2].length;
          return {
            originalZipName: match[2],
            tempPath: filePath.substring(0, zipEndIndex),
            rootFolder: match[3] || null,
            source: 'generic'
          };
        }

        return null;
      }

      // 处理从Windows zip窗口拖拽的文件
      async function handleZipWindowDrag(fileList, zipWindowInfo) {
        try {
          console.log("📦 处理zip窗口拖拽:", zipWindowInfo);
          console.log("📦 文件列表数量:", fileList.length);

          // 尝试找到原始zip文件
          let originalZipFile = null;

          // 方法1: 从fileList中查找（可能包含zip文件本身）
          for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            if (file.name === zipWindowInfo.originalZipName) {
              originalZipFile = file;
              break;
            }
          }

          // 方法2: 如果没有找到，尝试从路径推断原始zip位置
          if (!originalZipFile) {
            // 通常zip文件在D盘或其他位置，我们需要提示用户手动添加zip文件
            console.log("⚠️ 未找到原始zip文件，将处理解压后的文件");
            showMessage(`检测到从压缩工具拖拽的 ${fileList.length} 个文件。\n\n正在导入...`);
          }

          // 构建虚拟zip结构（模拟从zip拖拽）
          const files = Array.from(fileList).filter(f => f.name !== zipWindowInfo.originalZipName);
          console.log("📦 过滤后的文件数量:", files.length);

          if (files.length === 0) {
            showMessage("未找到有效的文件");
            return;
          }

          // 为每个文件添加特殊标记，表示它们来自zip窗口
          files.forEach(file => {
            file.isFromZipWindow = true;
            file.zipWindowInfo = zipWindowInfo;
            // 构建虚拟的相对路径（去掉临时路径前缀）
            if (file.path && zipWindowInfo.tempPath) {
              const relativePath = file.path.substring(zipWindowInfo.tempPath.length + 1);
              file.zipInternalPath = relativePath;
              file.fullPath = `${zipWindowInfo.originalZipName}/${relativePath}`;
              file.webkitRelativePath = file.fullPath;
            }
          });

          console.log("📦 即将处理的文件:", files.map(f => f.name));

          // 添加到文件树
          if (files.length > 0) {
            const looksLikeFolder = files.some((f) =>
              f && (f.webkitRelativePath || "").includes("/")
            );

            console.log("📦 looksLikeFolder:", looksLikeFolder);

            if (looksLikeFolder) {
              await handleDroppedFolder(files);
            } else {
              await handleDroppedFiles(files);
            }
          }

          // 如果找到了原始zip文件，也处理它
          if (originalZipFile) {
            await processArchiveFile(originalZipFile);
          }

        } catch (error) {
          console.error("处理zip窗口拖拽失败:", error);
          showMessage(`处理zip窗口拖拽失败: ${error.message}`);
        }
      }

      function isArchiveFile(file) {
        if (!file || !file.name) return false;
        const archiveExtensions = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2'];
        const fileName = file.name.toLowerCase();
        return archiveExtensions.some(ext => fileName.endsWith(ext));
      }
      
      // 处理压缩包文件 - 延迟加载，只在需要时解压
      async function processArchiveFile(file) {
        if (!file) return;

        const fileName = file.name || "未知压缩包";
        const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);

        // 🚀 检查文件是否为 .rar 格式（JSZip 不支持）
        const isRar = fileName.toLowerCase().endsWith('.rar');
        if (isRar) {
          showMessage(`⚠️ 不支持 .rar 格式

📦 当前支持的压缩格式：
• .zip (推荐)
• .7z
• .tar
• .gz
• .tgz

💡 建议：
1. 将 .rar 文件转换为 .zip 格式（使用 Bandizip、7-Zip 等工具）
2. 或直接从压缩软件拖拽文件到本应用`);
          return;
        }

        try {
          // 🚀 检查文件是否为空（Bandizip 等可能返回空文件对象）
          if (!file.size || file.size === 0) {
            console.warn(`[processArchiveFile] 文件为空: ${fileName}, size=${file.size}`);
            throw new Error(`文件为空或无法读取 (${fileName})`);
          }

          // 检查 JSZip 是否可用
          if (typeof JSZip === 'undefined') {
            throw new Error("JSZip 库未加载，请确保网络连接正常");
          }

          // 大压缩包警告
          if (file.size > ARCHIVE_PROCESSING_WARNING) {
            showMessage(`⚠️ 检测到大压缩包 (${fileSizeMB} MB)，处理可能需要较长时间...`);
          } else if (file.size > LARGE_ARCHIVE_THRESHOLD) {
            showMessage(`📦 正在解析压缩包: ${fileName} (${fileSizeMB} MB)...`);
          } else {
            showMessage(`正在解析压缩包: ${fileName}...`);
          }

          // 只加载压缩包索引，不解压内容
          console.log(`[processArchiveFile] 开始加载压缩包: ${fileName}, size=${file.size}`);
          const zip = await JSZip.loadAsync(file);
          console.log(`[processArchiveFile] JSZip 加载成功`);

          // 构建文件结构（只构建目录结构，不解压文件内容）
          // 注意：对于大压缩包（>= LARGE_ARCHIVE_FILE_COUNT），buildArchiveStructure 会返回 Promise
          const structure = await buildArchiveStructure(zip);

          // 保存到 archiveData（保存 zip 对象和结构）
          archiveData.set(fileName, {
            zip,
            structure,
            file,
            loaded: false  // 标记是否已完全加载
          });

          // 添加到文件树数据（作为特殊标记）
          const archiveInfo = {
            name: fileName,
            isArchive: true,
            fullPath: fileName,
            size: file.size,
            archiveName: fileName,
            isLocalDrive: true  // 🔧 标记为本地文件（拖拽的文件）
          };

          // 🔧 使用 addFilesToTree 以保留盘符
          if (typeof addFilesToTree === 'function') {
            addFilesToTree([archiveInfo], { lazyLoad: false });
          } else {
            // 回退方案
            fileTreeData.push(archiveInfo);
            fileTreeHierarchy = buildFileTreeHierarchy(fileTreeData, { lazyLoad: false });
            renderFileTree();
          }

          // 显示文件树
          if (!fileTreeContainer.classList.contains("visible")) {
            fileTreeContainer.classList.add("visible");
            updateLayout();
          }

          showMessage(`已导入压缩包: ${fileName} (${structure.fileCount} 个文件)`);
        } catch (error) {
          console.error("处理压缩包失败:", error);
          showMessage(`处理压缩包失败: ${error.message}`);
        }
      }
      
      // 展开压缩包时，构建其内容到文件树
      async function expandArchive(archiveName) {
        const archive = archiveData.get(archiveName);
        if (!archive) return;

        // 显示加载状态
        showMessage(`正在展开: ${archiveName}`);

        // 标记为已加载（主要用于UI状态显示）
        archive.loaded = true;

        // 延迟一小段时间让UI有机会更新
        await new Promise(resolve => setTimeout(resolve, 10));

        // 🔧 重建文件树时保留盘符
        const newHierarchy = buildFileTreeHierarchy(fileTreeData);
        fileTreeHierarchy = [...persistentDriveNodes, ...newHierarchy];
        renderFileTree();

        // 显示成功消息
        const fileCount = archive.structure.fileCount;
        showMessage(`已展开: ${archiveName} (${fileCount} 个文件)`);
      }
      
      // 折叠压缩包时，移除其内容
      function collapseArchive(archiveName) {
        // 🔧 重建文件树时保留盘符
        const newHierarchy = buildFileTreeHierarchy(fileTreeData);
        fileTreeHierarchy = [...persistentDriveNodes, ...newHierarchy];
        renderFileTree();
      }
      
      // 构建压缩包的层次结构（只构建目录结构，不解压文件内容）
      // 🚀 优化：大压缩包使用浅层模式，只构建第一层目录
      function buildArchiveStructure(zip, options = {}) {
        const { shallow = false, maxDepth = shallow ? 1 : Infinity } = options;
        const root = { type: 'folder', name: '', children: {}, fileCount: 0, dirs: new Set(), _zip: zip };
        const entries = [];

        // 收集所有条目
        zip.forEach((relativePath, zipEntry) => {
          entries.push({
            path: relativePath,
            isDirectory: zipEntry.dir,
            file: zipEntry
          });
        });

        const totalEntries = entries.length;

        // 🚀 大压缩包：使用浅层模式，只构建第一层目录
        if (totalEntries >= LARGE_ARCHIVE_FILE_COUNT) {
          console.log(`📦 大压缩包检测：${totalEntries} 个文件，使用浅层模式（仅第一层）`);
          return buildArchiveStructureShallow(entries, root);
        }

        // 小压缩包：使用同步处理
        return buildArchiveStructureSync(entries, root);
      }

      // 🚀 新增：浅层模式构建（只构建第一层目录，不递归）
      function buildArchiveStructureShallow(entries, root) {
        // 按路径排序（文件夹在前，文件在后）
        entries.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
        });

        // 第一层目录集合
        const firstLevelDirs = new Set();
        const firstLevelFiles = [];

        // 只处理第一层（路径不包含 '/' 或只有一个 '/' 开头）
        for (const entry of entries) {
          const parts = entry.path.split('/');
          if (parts.length > 1) {
            // 有子路径，记录第一层目录
            firstLevelDirs.add(parts[0]);
          } else {
            // 第一层文件
            firstLevelFiles.push(entry);
          }
        }

        // 构建第一层目录结构
        for (const dirName of firstLevelDirs) {
          const dirNode = {
            type: 'folder',
            name: dirName,
            path: dirName,
            children: {},
            dirs: new Set(),
            fileCount: 0,
            _shallow: true  // 标记为浅层节点，需要按需展开
          };
          root.children[dirName] = dirNode;
          root.dirs.add(dirName);
        }

        // 添加第一层文件
        for (const entry of firstLevelFiles) {
          processEntry(entry, root);
        }

        // 计算总文件数（仍然统计所有文件）
        root.fileCount = entries.length;

        console.log(`📦 浅层模式完成：第一层 ${firstLevelDirs.size} 个目录，${firstLevelFiles.length} 个文件`);
        return root;
      }

      // 同步构建树结构（用于小压缩包）
      function buildArchiveStructureSync(entries, root) {
        // 按路径排序（文件夹在前，文件在后）
        entries.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
        });

        // 构建层次结构
        for (const entry of entries) {
          processEntry(entry, root);
        }

        // 计算总文件数
        function countFiles(node) {
          if (node.type === 'file') return 1;
          let count = 0;
          for (const child of Object.values(node.children)) {
            count += countFiles(child);
          }
          return count;
        }

        root.fileCount = countFiles(root);
        return root;
      }

      // 处理单个条目（提取公共逻辑）
      function processEntry(entry, root) {
        if (entry.isDirectory) {
          // 只记录目录存在
          const parts = entry.path.split('/').filter(p => p);
          let current = root;
          for (const part of parts) {
            if (!current.children[part]) {
              current.children[part] = { type: 'folder', name: part, children: {}, fileCount: 0, dirs: new Set() };
            }
            current.dirs.add(part);
            current = current.children[part];
          }
        } else {
          // 添加文件（保存引用，不解压内容）
          const parts = entry.path.split('/').filter(p => p);
          let current = root;
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            current.dirs.add(part);
            if (!current.children[part]) {
              current.children[part] = { type: 'folder', name: part, children: {}, fileCount: 0, dirs: new Set() };
            }
            current = current.children[part];
          }
          const fileName = parts[parts.length - 1];
          current.children[fileName] = {
            type: 'file',
            name: fileName,
            path: entry.path,
            file: entry.file  // 保存文件条目引用
          };
          current.fileCount++;

          // 统计总文件数
          let parent = root;
          for (const part of parts) {
            if (parent.children[part] && parent.children[part].type === 'folder') {
              parent.children[part].fileCount++;
              parent = parent.children[part];
            }
          }
        }
      }
      
      // 从压缩包读取文件内容（按需解压）
      // 🚀 优化：支持浅层模式，直接从 zip 对象读取文件
      async function readFileFromArchive(archiveName, filePath) {
        console.log(`[readFileFromArchive] archiveName=${archiveName}, filePath=${filePath}`);

        // 🔧 首先检查 archiveData Map（用于远程拖拽的压缩包）
        let archive = archiveData.get(archiveName);

        // 🔧 如果不在 archiveData 中，检查是否是本地压缩包（从文件树加载）
        if (!archive) {
          // 在 fileTreeHierarchy 中查找本地压缩包节点
          // 🔧 改进查找逻辑：不依赖 isLocalDrive 和 isArchive 标志，直接匹配 archiveName 或 path
          console.log(`[readFileFromArchive] 在 fileTreeHierarchy 中查找压缩包: ${archiveName}`);
          const archiveIndex = findArchiveNodeIndex(archiveName);

          console.log(`[readFileFromArchive] 查找结果: ${archiveIndex !== -1 ? '找到' : '未找到'}`);
          if (archiveIndex !== -1) {
            const archiveNode = fileTreeHierarchy[archiveIndex];
            console.log(`[readFileFromArchive] 压缩包节点:`, {
              name: archiveNode.name,
              path: archiveNode.path,
              archiveName: archiveNode.archiveName,
              has_archiveFiles: !!archiveNode._archiveFiles,
              has_zipObject: !!archiveNode._zipObject
            });

            // 🔧 检查是否有 JSZip 对象（拖拽的压缩包）
            if (archiveNode._zipObject) {
              // 找到本地压缩包，创建类似的结构
              archive = {
                zip: archiveNode._zipObject,
                structure: archiveNode._zipStructure
              };
              console.log(`[readFileFromArchive] 使用本地压缩包的 JSzip 对象: ${archiveName}`);
            }
            // 🔧 如果有 _archiveFiles（7z 列出的文件列表），需要通过主进程读取
            else if (archiveNode._archiveFiles) {
              console.log(`[readFileFromArchive] 本地压缩包使用 7z 模式，通过主进程读取文件: ${archiveName}`);
              // 通过主进程的 readFile API 读取压缩包内的文件
              if (!window.electronAPI || !window.electronAPI.readFile) {
                throw new Error('readFile API 不可用');
              }

              // 构建压缩包内文件的完整路径格式：archivePath|filePath
              const archivePath = archiveNode.path;
              let result = await window.electronAPI.extractFileFromArchive(archivePath, filePath);

              // 🔧 7z 不可用时，对 ZIP 文件回退到原生提取
              if (!result || !result.success) {
                const errMsg = result?.error || '';
                if (archivePath.toLowerCase().endsWith('.zip') && window.electronAPI?.extractZipNative) {
                  console.log(`[readFileFromArchive] 7z 失败，尝试原生 ZIP 提取: ${errMsg}`);
                  try {
                    const nativeResult = await window.electronAPI.extractZipNative(archivePath, filePath);
                    if (nativeResult && nativeResult.success) {
                      return nativeResult.content;
                    } else {
                      throw new Error(nativeResult?.error || '原生 ZIP 提取失败');
                    }
                  } catch (nativeErr) {
                    throw new Error(nativeErr.message || '原生 ZIP 提取失败');
                  }
                }
                throw new Error(errMsg || `读取压缩包文件失败: ${filePath}`);
              }

              // 显示符号链接警告（如果有）
              if (result.symlinkWarning && result.symlinkMessage) {
                console.warn(`[readFileFromArchive] ${result.symlinkMessage}`);
              }

              return result.content;
            }
            // 🔧 没有内部缓存对象时（list-zip-native 展开），直接用原生 ZIP 提取
            else if (archiveNode.path && archiveNode.path.toLowerCase().endsWith('.zip') && window.electronAPI?.extractZipNative) {
              console.log(`[readFileFromArchive] 使用原生 ZIP 提取（无 7z / JSZip 缓存）`);
              const nativeResult = await window.electronAPI.extractZipNative(archiveNode.path, filePath);
              if (nativeResult && nativeResult.success) {
                return nativeResult.content;
              } else {
                throw new Error(nativeResult?.error || '原生 ZIP 提取失败');
              }
            }
          }
        }

        if (!archive) {
          throw new Error(`未找到压缩包: ${archiveName}`);
        }

        // 🚀 优先直接从 zip 对象读取（适用于浅层模式）
        if (archive.zip) {
          try {
            console.log(`[readFileFromArchive] 尝试从 ZIP 读取文件: ${filePath}`);
            const zipEntry = archive.zip.file(filePath);
            console.log(`[readFileFromArchive] zipEntry=${zipEntry ? '找到' : '未找到'}`);
            if (zipEntry) {
              const content = await zipEntry.async("string");
              console.log(`[readFileFromArchive] 成功读取文件，内容长度: ${content.length}`);
              return content;
            }
          } catch (error) {
            console.warn(`[readFileFromArchive] 直接从 zip 读取失败 (${filePath})，尝试从 structure 查找:`, error);
          }
        }

        // 回退：从 structure 查找（适用于小压缩包或完整结构）
        const entry = findFileEntry(archive.structure, filePath);
        if (!entry || !entry.file) {
          throw new Error(`未找到文件: ${filePath}`);
        }

        try {
          // 解压并读取文件内容
          // 对于大文件，使用 nodebuffer 或 blob 而不是 string
          const content = await entry.file.async("string");
          return content;
        } catch (error) {
          console.error(`解压文件失败: ${archiveName}/${filePath}`, error);
          throw new Error(`解压文件失败: ${error.message}`);
        }
      }
      
      // 在结构中查找文件
      function findFileEntry(node, path) {
        if (!node || !node.children) return null;

        const parts = path.split('/').filter(p => p);
        let current = node;

        for (const part of parts) {
          if (current.children && current.children[part]) {
            current = current.children[part];
          } else {
            // 尝试模糊匹配
            let found = false;
            for (const key of Object.keys(current.children)) {
              if (key.toLowerCase() === part.toLowerCase()) {
                current = current.children[key];
                found = true;
                break;
              }
            }
            if (!found) {
              console.warn(`findFileEntry: 找不到路径部件 "${part}"，当前路径: "${path}"`);
              return null;
            }
          }
        }

        return current;
      }

      // 处理拖拽的文件（与handleFileSelect逻辑一致：添加到文件树但不自动加载）
      async function handleDroppedFiles(files) {
        try {
          console.log("📥 handleDroppedFiles 开始，文件数量:", files ? files.length : 0);

          if (!files || files.length === 0) return;

          // 分离普通 File 对象和从路径读取的文件
          const pathFiles = [];
          const regularFiles = [];

          for (const file of files) {
            // 🔧 处理懒加载的压缩包（大文件不读取内容）
            if (file._lazyArchive) {
              console.log('📦 处理懒加载压缩包:', file.name);
              // 直接添加，不创建File对象
              regularFiles.push(file);
              continue;
            }

            // 🔧 处理懒加载的大文本文件
            if (file._lazyFile) {
              console.log('📄 处理懒加载文本文件:', file.name);
              // 直接添加，不创建File对象
              regularFiles.push(file);
              continue;
            }

            if (file._fromPath && file.content) {
              // 从路径读取的文件，需要创建 File 对象
              try {
                let blob;

                // 🔧 根据编码类型处理内容
                if (file.encoding === 'base64') {
                  // base64 编码的内容，需要解码为二进制数据
                  const byteCharacters = atob(file.content);
                  const byteNumbers = new Array(byteCharacters.length);
                  for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                  }
                  const byteArray = new Uint8Array(byteNumbers);

                  // 根据文件扩展名确定 MIME 类型
                  const ext = file.name.split('.').pop().toLowerCase();
                  const mimeTypes = {
                    'zip': 'application/zip',
                    'rar': 'application/x-rar-compressed',
                    '7z': 'application/x-7z-compressed',
                    'tar': 'application/x-tar',
                    'gz': 'application/gzip',
                    'bz2': 'application/x-bzip2',
                    'xz': 'application/x-xz',
                    'txt': 'text/plain',
                    'log': 'text/plain',
                    'json': 'application/json',
                    'xml': 'application/xml'
                  };
                  const mimeType = mimeTypes[ext] || 'application/octet-stream';

                  // 创建 Blob（使用解码后的二进制数据）
                  blob = new Blob([byteArray], { type: mimeType });
                } else {
                  // utf-8 编码的文本内容
                  blob = new Blob([file.content], { type: 'text/plain' });
                }

                // 创建一个 File 对象
                const fileObj = new File([blob], file.name, {
                  type: blob.type,
                  lastModified: Date.now()
                });

                // 添加 path 属性（Electron 特有）
                Object.defineProperty(fileObj, 'path', {
                  value: file.path,
                  writable: false
                });

                regularFiles.push(fileObj);
              } catch (error) {
                console.error('创建 File 对象失败:', error);
              }
            } else {
              // 🔧 对于没有 path 属性的文件（粘贴的文件），读取内容并保存
              if (!file.path) {
                try {
                  const text = await file.text();
                  file._fileContent = text;
                  console.log(`📋 读取粘贴文件内容: ${file.name}, ${text.length} 字符`);
                } catch (error) {
                  console.error(`读取粘贴文件 ${file.name} 失败:`, error);
                }
              }
              regularFiles.push(file);
            }
          }

          console.log("📥 regularFiles 数量:", regularFiles.length);
          console.log("📥 regularFiles 名称:", regularFiles.map(f => f.name));

          if (regularFiles.length === 0) {
            showMessage('没有有效的文件');
            return;
          }

          if (regularFiles.length === 1) {
            console.log("📥 单个文件，检查是否为压缩包");
            const file = regularFiles[0];

            // 检查是否为压缩包
            if (isArchiveFile(file)) {
              console.log("📦 检测到压缩包文件:", file.name);

              // 🔧 检查是否为懒加载的压缩包（大文件不读取内容）
              if (file._lazyArchive || file._isArchivePath) {
                console.log('📦 懒加载压缩包，直接添加到文件树');

                // 直接创建压缩包节点并添加到文件树
                const archiveNode = {
                  name: file.name,
                  path: file.path,
                  type: 'archive',
                  subType: 'zip',  // 默认为zip，其他格式在需要时处理
                  expanded: false,
                  level: 1,
                  file: null,
                  childrenLoaded: false,
                  loadingChildren: false,
                  lazyLoad: true,
                  isLocalDrive: true,
                  isArchive: true,
                  size: file.size || 0,
                  archiveName: file.name
                };

                // 添加到文件树
                if (typeof fileTreeHierarchy !== 'undefined') {
                  fileTreeHierarchy.push(archiveNode);

                  // 重新构建文件树缓存并渲染
                  if (typeof rebuildFileTreeVisibleCache === 'function') {
                    rebuildFileTreeVisibleCache();
                  }
                  if (typeof renderFileTreeViewport === 'function') {
                    renderFileTreeViewport(true);
                  }

                  console.log('✅ 压缩包已添加到文件树（懒加载模式）');
                  showMessage(`已添加压缩包: ${file.name}`);
                } else {
                  showMessage('文件树未初始化');
                }
                return;
              }

              await processArchiveFile(file);
              return;
            }

            console.log("📥 单个普通文件，直接添加到文件树");
            addFilesToTree(regularFiles, { lazyLoad: false });
            return;
          }

          console.log("📥 多个文件，继续处理");
          const list = regularFiles;
          if (list.length > MAX_FILES) {
            showMessage(`文件过多。只加载前 ${MAX_FILES} 个文件。`);
            list.splice(MAX_FILES);
          }

          const totalSize = list.reduce((sum, file) => sum + (file.size || 0), 0);
          if (totalSize > MAX_TOTAL_SIZE) {
            showMessage("总大小超过10000MB。请选择更少的文件。");
            return;
          }

          addFilesToTree(list);
        } catch (error) {
          console.error("处理拖拽文件失败:", error);
          showMessage(`处理文件失败: ${error.message || "未知错误"}`);
        }
      }

      // 处理拖拽的文件夹（懒加载模式：只添加根文件夹节点，不读取所有文件）
      async function handleDroppedFolder(files) {
        const startTime = performance.now();
        try {
          console.log("📂 handleDroppedFolder 开始，文件数量:", files ? files.length : 0);

          if (!files || files.length === 0) return;

          const list = Array.from(files);
          console.log("📂 文件列表总数:", list.length);

          if (list.length > MAX_FILES) {
            showMessage(`文件过多（共${list.length}个）。只加载前 ${MAX_FILES} 个文件的文件夹结构。`);
            list.splice(MAX_FILES);
          }

          // 🚀 懒加载模式：提取根文件夹路径，创建懒加载节点
          let rootFolderPath = null;
          let rootFolderName = null;

          // 检查是否是 Electron 环境（有 file.path 属性）
          if (list[0].path) {
            const firstFilePath = list[0].path;
            const webkitRelativePath = list[0].webkitRelativePath || "";

            console.log("📂 Electron 环境路径分析:");
            console.log("  第一个文件路径:", firstFilePath);
            console.log("  webkitRelativePath:", webkitRelativePath);

            // 🚀 修复：优先使用 webkitRelativePath 提取根文件夹名
            // webkitRelativePath 格式："用户选择的文件夹/子文件夹/文件名"
            // 第一段就是用户选择的文件夹名
            if (webkitRelativePath) {
              const relativePathParts = webkitRelativePath.replace(/\\/g, '/').split('/');
              rootFolderName = relativePathParts[0];

              // 从完整路径中提取到根文件夹的路径
              // 例如：D:\demolog\用户选择的文件夹\子文件夹\文件.txt
              // 需要找到"用户选择的文件夹"在路径中的位置
              const filePathParts = firstFilePath.replace(/\//g, '\\').split('\\');
              let folderIndex = -1;

              // 在路径中查找根文件夹名
              for (let i = 0; i < filePathParts.length; i++) {
                if (filePathParts[i] === rootFolderName) {
                  folderIndex = i;
                  break;
                }
              }

              if (folderIndex > 0) {
                // 找到了，截取到这个位置
                rootFolderPath = filePathParts.slice(0, folderIndex + 1).join('\\');
              } else {
                // 没找到，使用 _originalPath 或 path
                rootFolderPath = list[0]._originalPath || list[0].path || firstFilePath;
              }
            } else {
              // 没有 webkitRelativePath（拖拽场景），使用之前的逻辑
              const fullPath = list[0].fullPath || "";
              if (fullPath) {
                const pathParts = fullPath.replace(/\\/g, '/').split('/');
                rootFolderName = pathParts[pathParts.length - 1] || list[0].name;
              } else {
                rootFolderName = list[0].name;
              }
              rootFolderPath = list[0]._originalPath || list[0].path || firstFilePath;
            }

            console.log("  根文件夹名:", rootFolderName);
            console.log("  根文件夹路径:", rootFolderPath);
            console.log("  路径提取耗时:", `${(performance.now() - startTime).toFixed(2)}ms`);
          } else {
            // 非 Electron 环境（浏览器）：使用相对路径
            const relativePath = list[0].webkitRelativePath || "";
            const segments = relativePath.split('/');
            rootFolderName = segments[0];
            // 🚀 Bandizip 文件夹：不设置真实路径，让 Bandizip 临时目录搜索触发
            rootFolderPath = "/" + rootFolderName;

            console.log("📂 浏览器环境懒加载文件夹:");
            console.log("  根文件夹名:", rootFolderName);
            console.log("  根文件夹路径:", rootFolderPath);
            console.log("  💡 检测到可能的 Bandizip 拖拽，将在展开时搜索临时目录");
          }

          // 创建懒加载文件夹节点
          if (rootFolderName && rootFolderPath) {
            // 🚀 修复：使用相对路径而非完整绝对路径，避免被误认为是盘符的子节点
            // 只使用文件夹名称作为路径，使其成为根节点
            const lazyFolder = {
              name: rootFolderName,
              kind: "directory",
              fullPath: rootFolderName,  // 🔧 修复：只使用文件夹名，不包含盘符路径
              _isLazyDir: true,
              // 🚀 Bandizip 拖拽时（path 为 undefined），不设置 _originalPath，触发临时目录搜索
              _originalPath: list[0].path ? rootFolderPath : undefined
            };

            console.log("🌳 创建懒加载文件夹节点:", lazyFolder);
            console.log("🌳 节点创建耗时:", `${(performance.now() - startTime).toFixed(2)}ms`);

            addFilesToTree([lazyFolder]);

            const totalTime = performance.now() - startTime;
            console.log("✅ handleDroppedFolder 总耗时:", `${totalTime.toFixed(2)}ms`);
            showMessage(`已添加文件夹: ${rootFolderName} (${list.length} 个文件，懒加载模式)`);
          } else {
            console.warn("⚠️ 无法提取根文件夹路径，回退到完全加载模式");
            // 回退到完全加载模式
            list.sort((a, b) => {
              const pathA = a.fullPath || a.webkitRelativePath || a.name || "";
              const pathB = b.fullPath || b.webkitRelativePath || b.name || "";
              return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
            });

            const totalSize = list.reduce((sum, file) => sum + (file.size || 0), 0);
            if (totalSize > MAX_TOTAL_SIZE) {
              showMessage("总大小超过10000MB。请选择更少的文件。");
              return;
            }

            addFilesToTree(list, { lazyLoad: false });
          }
        } catch (error) {
          console.error("处理拖拽文件夹失败:", error);
          showMessage(`处理文件夹失败: ${error.message || "未知错误"}`);
        }
      }

      // 新增：处理从路径列表拖拽的文件（支持 WinRAR 等压缩工具）
      async function handleDroppedPaths(filePaths) {
        try {
          console.log("📁 处理路径列表:", filePaths);

          if (!filePaths || filePaths.length === 0) return;

          // 检查是否在 Electron 环境中
          if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.readFiles) {
            showLoading(true, `正在读取 ${filePaths.length} 个文件...`);

            try {
              // 使用 Electron API 批量读取文件
              const results = await window.electronAPI.readFiles(filePaths);

              showLoading(false);

              // 将结果转换为 File 对象
              const files = [];
              const failedPaths = [];

              for (const result of results) {
                if (result.success) {
                  // 从文件路径提取文件名
                  const fileName = result.path.split('\\').pop().split('/').pop();

                  // 🔧 检查是否为压缩包文件（对于大文件不读取内容）
                  const ext = fileName.split('.').pop().toLowerCase();
                  const isArchive = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'].includes(ext);
                  const isLargeFile = result.size > 10 * 1024 * 1024;  // 大于10MB

                  if (isArchive && isLargeFile) {
                    // 大压缩包文件：不读取内容，只传递路径信息
                    console.log('📦 检测到大压缩包文件，跳过内容读取:', fileName, `(${(result.size / 1024 / 1024).toFixed(2)}MB)`);

                    const file = {
                      name: fileName,
                      path: result.path,
                      size: result.size,
                      _fromPath: true,
                      _isArchivePath: true,  // 标记为压缩包路径
                      _lazyArchive: true  // 标记为懒加载压缩包
                    };

                    files.push(file);
                  } else if (!isArchive && isLargeFile) {
                    // 大文本文件：也不读取内容
                    console.log('📄 检测到大文本文件，跳过内容读取:', fileName);

                    const file = {
                      name: fileName,
                      path: result.path,
                      size: result.size,
                      _fromPath: true,
                      _lazyFile: true  // 标记为懒加载文件
                    };

                    files.push(file);
                  } else {
                    // 小文件或需要立即读取的文件：读取内容
                    const file = {
                      name: fileName,
                      path: result.path,
                      content: result.content,
                      size: result.size,
                      encoding: result.encoding,
                      _fromPath: true
                    };

                    files.push(file);
                  }
                } else {
                  failedPaths.push(`${result.path}: ${result.error}`);
                }
              }

              // 记录失败的文件
              if (failedPaths.length > 0) {
                console.warn('部分文件读取失败:', failedPaths);
              }

              if (files.length > 0) {
                console.log(`✅ 成功读取 ${files.length} 个文件`);

                // 检查是否为压缩包内的文件（包含临时路径特征）
                const archiveFiles = files.filter(f => {
                  if (f.path) {
                    const zipMatch = detectZipWindowDrag(f.path);
                    return zipMatch !== null;
                  }
                  return false;
                });

                if (archiveFiles.length > 0) {
                  // 检测到压缩包临时文件，复制到临时目录
                  console.log("📦 检测到从WinRAR等工具拖拽的文件，正在复制到临时目录...");

                  showLoading(true, "正在从压缩工具复制文件...");

                  try {
                    // 提取所有原始路径
                    const sourcePaths = files.map(f => f.path);

                    // 复制到临时目录
                    const copyResult = await window.electronAPI.copyFilesToTemp(sourcePaths);

                    showLoading(false);

                    if (copyResult.success && copyResult.tempDir) {
                      console.log("✅ 文件已复制到临时目录:", copyResult.tempDir);

                      // 加载临时目录到文件树
                      await loadFolderToTree(copyResult.tempDir);
                      showMessage(`已从压缩工具加载 ${copyResult.files.length} 个文件`);
                      return;
                    } else {
                      showMessage(`复制文件失败: ${copyResult.error || "未知错误"}`);
                      return;
                    }
                  } catch (copyError) {
                    showLoading(false);
                    console.error("复制文件到临时目录失败:", copyError);
                    showMessage(`复制文件失败: ${copyError.message || "未知错误"}`);
                    return;
                  }
                }

                // 普通文件，直接添加到文件树
                await handleDroppedFiles(files);
              } else {
                showMessage(`所有文件读取失败。请检查文件权限或尝试其他导入方式。`);
              }
            } catch (error) {
              showLoading(false);
              throw error;
            }
          } else {
            // 不在 Electron 环境中
            console.warn("非 Electron 环境，无法直接读取文件路径");
            showMessage(`检测到 ${filePaths.length} 个文件路径。由于环境限制，请使用以下方式之一导入：\n` +
              `1. 直接拖拽文件/文件夹到窗口\n` +
              `2. 点击文件树的"导入文件"或"导入文件夹"按钮`);
          }
        } catch (error) {
          console.error("处理路径列表失败:", error);
          showLoading(false);
          showMessage(`处理文件路径失败: ${error.message || "未知错误"}`);
        }
      }

      // 新增：处理从 URI list 解析的压缩窗口拖拽
      async function handleZipWindowDragFromPaths(filePaths, zipWindowInfo) {
        try {
          console.log("📦 从路径处理压缩窗口拖拽:", zipWindowInfo);

          // 复制文件到临时目录
          showLoading(true, "正在从压缩工具复制文件...");

          const copyResult = await window.electronAPI.copyFilesToTemp(filePaths);

          showLoading(false);

          if (copyResult.success && copyResult.tempDir) {
            console.log("✅ 文件已复制到临时目录:", copyResult.tempDir);

            // 加载临时目录到文件树
            await loadFolderToTree(copyResult.tempDir);

            const sourceName = {
              'winrar': 'WinRAR',
              '7zip': '7-Zip',
              'bandizip': 'Bandizip',
              'explorer': 'Windows 资源管理器',
              'generic': '压缩工具'
            }[zipWindowInfo.source] || '压缩工具';

            showMessage(`已从 ${sourceName} 加载 ${copyResult.files.length} 个文件`);
          } else {
            const sourceName = {
              'winrar': 'WinRAR',
              '7zip': '7-Zip',
              'bandizip': 'Bandizip',
              'explorer': 'Windows 资源管理器',
              'generic': '压缩工具'
            }[zipWindowInfo.source] || '压缩工具';

            showMessage(`从 ${sourceName} 复制文件失败: ${copyResult.error || "未知错误"}`);
          }
        } catch (error) {
          showLoading(false);
          console.error("处理压缩窗口拖拽失败:", error);
          showMessage(`处理压缩包失败: ${error.message || "未知错误"}`);
        }
      }


      // 添加文件到文件树（不自动加载）
      function addFilesToTree(files, options = {}) {
        console.log("🌳 addFilesToTree 开始，文件数量:", files.length);
        console.log("🌳 文件列表:", files.map(f => f.name || 'unknown'));
        console.log("🌳 options:", options);

        const startTime = performance.now();

        // 🔧 增量更新：只在第一次添加文件时构建文件树，后续添加时直接追加
        if (!fileTreeHierarchy || fileTreeHierarchy.length === 0) {
          // 第一次添加文件
          console.log("🌳 第一次添加文件，构建初始文件树");
          fileTreeData = [...files];
          fileTreeHierarchy = [...persistentDriveNodes, ...buildFileTreeHierarchy(fileTreeData, options)];
        } else {
          // 后续添加文件，直接追加到 fileTreeData
          console.log("🌳 后续添加文件，增量更新");
          const fileTreeLen = fileTreeData.length;
          const filesLen = files.length;
          for (let i = 0; i < filesLen; i++) {
            fileTreeData[fileTreeLen + i] = files[i];
          }

          // 🔧 完全重建文件树，确保层级关系正确
          // 增量更新可能导致层级错误，所以这里完全重建
          const newHierarchy = buildFileTreeHierarchy(fileTreeData, options);
          fileTreeHierarchy = [...persistentDriveNodes, ...newHierarchy];

          console.log(`[addFilesToTree] 重建文件树，总节点数: ${fileTreeHierarchy.length}`);
        }

        console.log("🌳 fileTreeData 总数:", fileTreeData.length);
        console.log("🌳 fileTreeHierarchy 总数:", fileTreeHierarchy.length);

        // 🚀 优化：立即显示文件树容器，然后异步渲染内容
        const wasVisible = fileTreeContainer.classList.contains("visible");
        if (!wasVisible) {
          fileTreeContainer.classList.add("visible");
        }

        // 🚀 使用 requestAnimationFrame 确保 DOM 更新后再渲染内容
        requestAnimationFrame(() => {
          const renderStart = performance.now();
          renderFileTree();
          console.log(`🌳 renderFileTree 耗时: ${(performance.now() - renderStart).toFixed(2)}ms`);

          // 更新布局
          if (!wasVisible) {
            updateLayout();
          }

          console.log(`🌳 addFilesToTree 总耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
        });

        showMessage(`已添加 ${files.length} 个文件到文件树`);
        //forcetoggleFullscreen();
      }

      // 加载文件夹到文件树（用于WinRAR等工具的拖拽）
      async function loadFolderToTree(folderPath) {
        try {
          console.log("📁 加载文件夹到文件树:", folderPath);

          if (!window.electronAPI || !window.electronAPI.readFolder) {
            throw new Error("electronAPI.readFolder 不可用");
          }

          showLoading(true, "正在扫描文件夹...");

          // 读取文件夹中的所有文件
          const results = await window.electronAPI.readFolder(folderPath);

          showLoading(false);

          if (!results || !Array.isArray(results)) {
            throw new Error("读取文件夹失败：返回结果无效");
          }

          // 过滤出成功读取的文件
          const successResults = results.filter(r => r.success);

          if (successResults.length === 0) {
            showMessage("文件夹中没有可读取的文件");
            return;
          }

          console.log(`✅ 成功读取 ${successResults.length} 个文件`);

          // 转换为文件树数据格式
          const files = successResults.map(result => {
            // 提取相对路径（相对于临时目录）
            let relativePath = result.path;
            if (relativePath.startsWith(folderPath)) {
              relativePath = relativePath.substring(folderPath.length);
              if (relativePath.startsWith('\\') || relativePath.startsWith('/')) {
                relativePath = relativePath.substring(1);
              }
            }

            // 转换为正斜杠路径（用于文件树层次结构）
            const treePath = relativePath.replace(/\\/g, '/');

            const fileObj = {
              name: result.path.split('\\').pop().split('/').pop(),
              path: result.path,
              fullPath: treePath,  // 用于文件树层次结构
              webkitRelativePath: treePath,  // 兼容浏览器文件对象
              content: result.content,  // 预读取的内容
              size: result.size,
              _fromPath: true,
              _relativePath: relativePath,
              _hasContent: true  // 标记内容已预读取
            };

            console.log("📄 文件对象:", {
              name: fileObj.name,
              fullPath: fileObj.fullPath,
              hasContent: !!fileObj.content,
              contentLength: fileObj.content ? fileObj.content.length : 0
            });

            return fileObj;
          });

          // 🚀 优化：避免输出大对象
          const treeSample = files.slice(0, 3).map(f => ({
            name: f.name,
            fullPath: f.fullPath?.length > 50 ? f.fullPath.substring(0, 50) + '...' : f.fullPath
          }));
          console.log("🌳 文件树路径示例:", JSON.stringify(treeSample));

          // 添加到文件树
          addFilesToTree(files, { lazyLoad: false });

          return {
            success: true,
            count: files.length
          };
        } catch (error) {
          showLoading(false);
          console.error("加载文件夹到文件树失败:", error);
          throw error;
        }
      }

      // 流式读取大文件
      async function loadSingleFile(file) {
        showLoading(true);

        // 🚀 加载前释放内存
        cleanLogData();

        currentFiles.push(file);

        try {
          const fileName = file.webkitRelativePath || file.name;
          const filePath = file.path || fileName;

          // 对于大文件（>10MB），使用流式读取
          const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
          const isLargeFile = file.size > 10 * 1024 * 1024;

          if (isLargeFile) {
            // 大文件使用流式读取
            progressBar.style.display = "block";
            progressFill.style.width = "0%";

            await loadFileStreaming(file, fileName, CHUNK_SIZE, (progress) => {
              progressFill.style.width = `${progress}%`;
            });

            progressBar.style.display = "none";
          } else {
            // 小文件使用传统方式
            const content = await readFileAsText(file);
            processFileContent(content, fileName, filePath);
          }

          // 🚀 构建搜索和过滤索引（新优化）
          if (originalLines.length > 1000) { // 只对较大的文件构建索引
            buildLogIndexes(originalLines);
          }

          showLoading(false);
          // 🚀 隐藏进度条
          hideFileProgressBar();
          showMessage(`已加载: ${file.name}`);
        } catch (error) {
          showLoading(false);
          // 🚀 隐藏进度条
          hideFileProgressBar();
          showMessage(`加载失败: ${error.message}`);
        }
      }

      // 读取文件为文本（Promise包装，支持多种编码）
      async function readFileAsText(file) {
        // 🚀 支持多种编码，优先尝试 UTF-8
        const encodings = ['utf-8', 'gbk', 'gb2312', 'gb18030', 'windows-1252', 'utf-16le', 'utf-16be'];

        for (const encoding of encodings) {
          try {
            const result = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target.result);
              reader.onerror = () => reject(new Error(`文件读取错误 (${encoding})`));
              reader.readAsText(file, encoding);
            });

            // 检查结果是否有效（不是空文件且不包含过多的替换字符）
            if (result && result.length > 0) {
              // 检查是否包含过多替换字符（表示编码错误）
              const replacementCharCount = (result.match(/\uFFFD/g) || []).length;
              const ratio = replacementCharCount / result.length;

              if (ratio < 0.1) {  // 如果替换字符少于 10%，认为编码正确
                console.log(`📖 文件编码: ${encoding}`);
                return result;
              }
            }
          } catch (error) {
            // 继续尝试下一个编码
            console.debug(`编码 ${encoding} 失败: ${error.message}`);
            continue;
          }
        }

        // 如果所有编码都失败，尝试二进制读取 + 提取可读文本
        console.warn('⚠️ 所有文本编码失败，尝试二进制读取并提取文本');
        try {
          const arrayBuffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error("二进制读取失败"));
            reader.readAsArrayBuffer(file);
          });

          // 用 TextDecoder 解码（容忍错误字符）
          const decoder = new TextDecoder('utf-8', { fatal: false });
          const rawText = decoder.decode(arrayBuffer);

          // 按行过滤：只保留可读文本行
          const allLines = rawText.split('\n');
          const textLines = [];
          let skipped = 0;
          for (const line of allLines) {
            let nonPrintable = 0;
            for (let i = 0; i < line.length; i++) {
              const code = line.charCodeAt(i);
              if (code < 32 && code !== 9) nonPrintable++;
            }
            const len = line.length || 1;
            if (nonPrintable / len > 0.3) {
              skipped++;
              continue;
            }
            // 清理控制字符
            const cleaned = line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
            if (cleaned.length > 0) textLines.push(cleaned);
          }

          if (textLines.length === 0) {
            throw new Error(`无法读取文件 ${file.name}，无可用文本内容`);
          }

          const prefix = skipped > 0
            ? `[混合文件，已提取 ${textLines.length} 行可读文本，跳过 ${skipped} 行二进制内容]\n`
            : '';
          console.log(`📖 文件编码: 二进制提取 (${textLines.length} 行可读)`);
          return prefix + textLines.join('\n');
        } catch (error) {
          throw new Error(`无法读取文件 ${file.name}: ${error.message}`);
        }
      }

      // 流式读取大文件
      async function loadFileStreaming(file, fileName, chunkSize, onProgress, sessionId, filePath = null) {
        const decoder = new TextDecoder();
        let buffer = "";
        let lineCount = 0;
        const startIndex = originalLines.length;

        // 添加文件头
        // 🚀 不转义HTML，直接使用原始内容
        const filePathAttr = filePath ? ` data-path="${filePath}"` : '';
        originalLines.push(`=== 文件: ${fileName}${filePathAttr} ===`);

        // 分块读取
        let offset = 0;
        while (offset < file.size) {
          // 检查会话是否过期
          if (sessionId !== undefined && sessionId !== currentLoadingSession) return;

          const chunk = file.slice(offset, offset + chunkSize);
          const arrayBuffer = await readChunkAsArrayBuffer(chunk);
          
          // 再次检查会话是否过期
          if (sessionId !== undefined && sessionId !== currentLoadingSession) return;

          const text = decoder.decode(arrayBuffer, { stream: true });

          // 处理文本块，处理跨块的换行符
          buffer += text;
          const lines = buffer.split("\n");
          
          // 保留最后一个不完整的行（可能跨块）
          buffer = lines.pop() || "";

          // 处理完整的行 - 保持内容原封不动，不进行转义
          for (const line of lines) {
            originalLines.push(line);
            lineCount++;
          }

          // 更新进度
          if (file.size > 0 && onProgress) {
            const progress = Math.min((offset / file.size) * 100, 100);
            onProgress(progress);
          }

          offset += chunkSize;
          
          // 让出控制权，避免阻塞UI（每处理5个块让出一次）
          if (Math.floor(offset / chunkSize) % 5 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        // 最终检查会话是否过期
        if (sessionId !== undefined && sessionId !== currentLoadingSession) return;

        // 处理最后剩余的内容 - 保持内容原封不动，不进行转义
        if (buffer) {
          originalLines.push(buffer);
          lineCount++;
        }

        // 更新文件头信息
        if (lineCount > 0) {
          fileHeaders.push({
            fileName,
            filePath: filePath || fileName, // 保存完整路径
            lineCount: lineCount,
            startIndex: startIndex,
          });
          // 更新文件头显示
          // 🚀 不转义HTML，直接使用原始内容
          const filePathAttr = filePath ? ` data-path="${filePath}"` : '';
          originalLines[startIndex] = `=== 文件: ${fileName} (${lineCount} 行)${filePathAttr} ===`;
        }

        // 完成进度
        if (onProgress) {
          onProgress(100);
        }
      }

      // 读取块为ArrayBuffer
      function readChunkAsArrayBuffer(chunk) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = () => reject(new Error("块读取错误"));
          reader.readAsArrayBuffer(chunk);
        });
      }

      async function loadMultipleFiles(files) {
        // 开启新的加载会话
        const sessionId = ++currentLoadingSession;

        showLoading(true);
        originalLines = [];
        fileHeaders = [];
        currentFiles = files;

        fileCount.textContent = `${files.length} 个文件`;

        for (let i = 0; i < files.length; i += BATCH_SIZE) {
          // 检查会话是否过期
          if (sessionId !== currentLoadingSession) return;

          const batch = files.slice(i, i + BATCH_SIZE);
          await processFileBatch(batch, sessionId);

          const progress = ((i + batch.length) / files.length) * 100;
          progressFill.style.width = `${progress}%`;

          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        
        // 最终检查会话是否过期
        if (sessionId !== currentLoadingSession) return;

        resetFilter(false);
        filterBox.value = "";
        document.getElementById("status").textContent = "";

        renderLogLines();
        selectedOriginalIndex = -1;
        showLoading(false);
        // 已禁用加载提示
        // showMessage(
        //   `已加载 ${files.length} 个文件 (${originalLines.length} 行)`
        // );
      }

      async function processFileBatch(files, sessionId, onProgress) {
        if (!files || files.length === 0) return;

        const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
        const CONCURRENCY = 3; // 🚀 降低并发数，从5改为3，减少内存峰值

        // 🚀 并行读取文件（保持顺序）
        const results = new Array(files.length);
        const batchStartTime = performance.now();

        // 读取单个文件
        const readFile = async (file, index) => {
          // 检查会话是否过期
          if (sessionId !== undefined && sessionId !== currentLoadingSession) {
            return { index, error: 'Session expired' };
          }

          const fileName = file.webkitRelativePath || file.name;
          const filePath = file.path || fileName;
          const fileStartTime = performance.now();

          try {
            let content;

            // 检查是否为懒加载文件（需要通过 electronAPI 读取）
            if (file._lazyFile && window.electronAPI && window.electronAPI.readFile) {
              console.log(`📂 [并行] 开始读取懒加载文件 ${index}: ${fileName}`);
              const result = await window.electronAPI.readFile(filePath);
              if (result && result.success && result.content) {
                content = result.content;
                const fileTime = performance.now() - fileStartTime;
                console.log(`✅ [并行] 文件 ${index} 读取完成: ${fileName} (${fileTime.toFixed(0)}ms)`);
              } else {
                throw new Error(result.error || '读取文件失败');
              }
            }
            // 对于大文件（>10MB），使用流式读取（保持串行，避免内存峰值）
            // 注意：检查 size 属性存在且大于阈值
            else if (typeof file.size === 'number' && file.size > LARGE_FILE_THRESHOLD) {
              // 大文件流式读取直接处理，不返回内容
              const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
              await loadFileStreaming(file, fileName, CHUNK_SIZE, null, sessionId, filePath);
              return { index, fileName, filePath, streamed: true };
            } else {
              // 小文件使用传统方式
              content = await readFileAsText(file);
            }

            // 🚀 内存优化：立即释放 content 引用，避免同时保存多个大文件
            // 返回后，readFile 函数的局部变量会被回收
            return { index, content, fileName, filePath, error: null };
          } catch (error) {
            console.error(`❌ [并行] 文件 ${index} 读取失败: ${fileName}`, error);
            return { index, error, fileName, filePath };
          }
        };

        // 🚀 分批并发读取文件
        let batchCount = 0;
        for (let i = 0; i < files.length; i += CONCURRENCY) {
          // 检查会话是否过期
          if (sessionId !== undefined && sessionId !== currentLoadingSession) return;

          const batchStart = performance.now();
          const batch = files.slice(i, Math.min(i + CONCURRENCY, files.length));
          batchCount++;

          console.log(`🚀 [批次 ${batchCount}] 开始并行读取 ${batch.length} 个文件 (索引 ${i}-${i + batch.length - 1})`);

          const batchPromises = batch.map((file, batchIndex) =>
            readFile(file, i + batchIndex).catch(err => {
              // 捕获单个文件读取错误，不影响其他文件
              console.error(`文件读取异常: ${file.name || file.webkitRelativePath || 'unknown'}`, err);
              return { index: i + batchIndex, error: err, fileName: file.name || file.webkitRelativePath };
            })
          );

          // 等待当前批次完成
          const batchResults = await Promise.all(batchPromises);
          const batchTime = performance.now() - batchStart;

          console.log(`✅ [批次 ${batchCount}] 完成，耗时 ${batchTime.toFixed(0)}ms`);

          // 🚀 内存优化：立即处理每个批次的结果，而不是等到所有批次完成
          // 这样可以及时释放 content 内存
          for (const result of batchResults) {
            if (result && typeof result.index === 'number') {
              results[result.index] = result;
            }
            if (onProgress) onProgress();
          }

          // 🚀 主动触发垃圾回收（如果可用）
          if (typeof gc === 'function') {
            gc();
          }
        }

        const totalTime = performance.now() - batchStartTime;
        console.log(`🎉 [并行加载] 所有文件读取完成，总耗时 ${totalTime.toFixed(0)}ms，共 ${files.length} 个文件`);

        // 🚀 按原始顺序处理所有结果
        const processStartTime = performance.now();
        let processedCount = 0;

        for (const result of results) {
          // 检查会话是否过期
          if (sessionId !== undefined && sessionId !== currentLoadingSession) return;

          if (!result) continue;

          // 流式文件已经在 readFile 中处理了
          if (result.streamed) continue;

          if (result.error) {
            console.error(`跳过文件: ${result.fileName || 'unknown'}`, result.error);
            continue;
          }

          if (result.content !== undefined) {
            // 🚀 使用 setTimeout 让出控制权，避免长时间阻塞主线程
            await new Promise(resolve => {
              setTimeout(() => {
                processFileContent(result.content, result.fileName, result.filePath);
                processedCount++;

                // 每处理2个文件输出一次进度
                if (processedCount % 2 === 0) {
                  const elapsed = performance.now() - processStartTime;
                  console.log(`📊 [处理进度] ${processedCount}/${files.length} 文件 (${(processedCount / files.length * 100).toFixed(0)}%)`);
                }

                resolve();
              }, 0);
            });
          }
        }

        const processTime = performance.now() - processStartTime;
        console.log(`✅ [并行加载] 所有文件处理完成，总耗时 ${processTime.toFixed(0)}ms`);
      }

      function processFileContent(content, fileName, filePath = null, fileTreeIndex = null) {
        console.log(`[processFileContent] 开始处理文件: ${fileName}, 内容长度: ${content.length}, fileTreeIndex: ${fileTreeIndex}`);

        // 修改：保持文件内容原封不动，不进行转义
        // 只对文件名进行转义以确保安全
        const lines = content.split("\n");

        // 🚀 内存管理：加载新文件前检查是否超过内存上限
        if (!canLoadMoreContent(lines.length)) {
          const currentMemoryMB = (originalLines.length * 500) / (1024 * 1024);
          const errorMsg = `⚠️ 内存已满 (${currentMemoryMB.toFixed(1)}MB / 600MB)\n\n无法加载文件：${fileName}\n\n💡 建议：请先清除部分日志（点击文件树中的取消选中），或使用过滤功能。`;

          // 🚀 强制清理：在显示错误前清理所有可能的缓存
          clearHtmlParseCache();

          // 尝试清理 DOM 池
          if (typeof domPool !== 'undefined' && domPool && domPool.clear) {
            domPool.clear();
          }

          console.error(`[processFileContent] ${errorMsg.replace(/\n/g, ' ')}`);
          showMemoryMessage(errorMsg); // 使用专门的内存警告函数
          return; // 跳过此文件
        }

        // 🔧 添加到 currentFiles，以便过滤使用
        // 🔧 普通磁盘文件和压缩包文件都需要添加，但标记不同
        if (filePath) {
          // 检查是否是压缩包内的文件（路径包含 .zip/, .tar/, .7z/ 等）
          const isArchiveFile = /\.zip\/|\.tar\/|\.7z\/|\.rar\/|\.gz\//i.test(filePath);

          if (isArchiveFile) {
            // 🔧 压缩包文件：添加 archiveName 属性，标记为来自压缩包
            // 这样过滤系统会自动使用 Worker 而不是 ripgrep
            currentFiles.push({
              name: fileName,
              path: filePath,
              fromArchive: true,  // 标记为来自压缩包
              archiveName: extractArchiveName(filePath)  // 提取压缩包名称
            });
          } else if (hasValidDiskPath(filePath)) {
            // 普通磁盘文件
            currentFiles.push({
              name: fileName,
              path: filePath
            });
          }
        }

        /**
         * 从压缩包文件路径中提取压缩包名称
         * 例如:
         *   "F:/archive.zip/path/to/file.txt" -> "F:/archive.zip"
         *   "F:\\archive.zip\\internal\\path.txt" -> "F:\\archive.zip"
         *   "F:\\archive.zip/internal/path.txt" -> "F:\\archive.zip"
         *   "F:\\20260125_xxx.zip\\delay_Time\\..." -> "F:\\20260125_xxx.zip"
         */
        function extractArchiveName(filePath) {
          // 简单方法：找到压缩包扩展名，然后找到它后面的第一个路径分隔符
          // 截取从开头到分隔符的位置
          const extensions = ['.zip', '.tar', '.7z', '.rar', '.gz', '.bz2'];

          for (const ext of extensions) {
            const extIndex = filePath.toLowerCase().indexOf(ext);
            if (extIndex === -1) continue;

            // 从扩展名后面开始找路径分隔符
            const afterExt = extIndex + ext.length;
            if (afterExt >= filePath.length) continue;

            // 检查扩展名后面是否跟着 / 或 \
            const nextChar = filePath[afterExt];
            if (nextChar === '/' || nextChar === '\\') {
              // 找到了！返回从开头到扩展名的部分
              return filePath.substring(0, afterExt);
            }
          }

          return null;
        }

        if (lines.length > 0) {
          const headerIndex = fileHeaders.length; // 记录当前 header 的索引
          fileHeaders.push({
            fileName,
            filePath: filePath || fileName, // 保存完整路径，如果没有则使用文件名
            lineCount: lines.length,
            startIndex: originalLines.length,
          });

          // 🚀 不转义HTML，直接使用原始内容
          // 在文件头中保存完整路径（使用隐藏的格式）
          const filePathAttr = filePath ? ` data-path="${filePath}"` : '';
          originalLines.push(
            `=== 文件: ${fileName} (${lines.length} 行)${filePathAttr} ===`
          );

          // 🔧 修复大文件堆栈溢出：使用循环代替 spread 操作符
          // spread 操作符在处理大数组时会导致 "Maximum call stack size exceeded"
          // 原因：...lines 会将所有元素展开为参数，超出调用栈大小限制
          const originalLen = originalLines.length;
          const linesLen = lines.length;
          for (let i = 0; i < linesLen; i++) {
            originalLines[originalLen + i] = lines[i];
          }

          // 🚀 内存优化：及时释放 lines 和 content 的引用
          // 它们在函数作用域内，函数返回后会被自动回收

          // 🔧 记录文件索引到 header 索引的映射（用于取消选中时清理）
          if (fileTreeIndex !== null) {
            if (!fileIndexToHeaderIndices.has(fileTreeIndex)) {
              fileIndexToHeaderIndices.set(fileTreeIndex, []);
            }
            fileIndexToHeaderIndices.get(fileTreeIndex).push(headerIndex);
            console.log(`[processFileContent] 记录映射: fileTreeIndex=${fileTreeIndex} -> headerIndex=${headerIndex}`);
          }
        } else {
          console.warn(`[processFileContent] 文件 ${fileName} 为空！`);
        }
      }

      function setButtonsDisabled(disabled) {
        prevBtn.disabled = disabled || totalMatchCount === 0;
        nextBtn.disabled = disabled || totalMatchCount === 0;
      }

      function showMessage(message) {
        const messageEl = document.createElement("div");
        messageEl.className = "loading";
        messageEl.textContent = message;
        document.body.appendChild(messageEl);

        setTimeout(() => {
          if (document.body.contains(messageEl)) {
            document.body.removeChild(messageEl);
          }
        }, 1000);
      }

      // 显示内存警告消息（位置在上方）
      function showMemoryMessage(message) {
        const messageEl = document.createElement("div");
        messageEl.className = "loading memory-warning"; // 添加专门的样式类
        messageEl.textContent = message;
        document.body.appendChild(messageEl);

        setTimeout(() => {
          if (document.body.contains(messageEl)) {
            document.body.removeChild(messageEl);
          }
        }, 3000); // 内存警告显示更长时间（3秒）
      }

      // 创建模态弹框（不自动关闭，需点击关闭）
      function showModalMessage(title, message, showCloseButton = true) {
        // 移除现有弹框
        const existingModal = document.querySelector('.modal-message');
        if (existingModal) {
          existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.className = 'modal-message';
        modal.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #ffffff;
          border: 1px solid #e0e0e0;
          border-radius: 12px;
          padding: 24px;
          z-index: 99999;
          max-width: 500px;
          min-width: 300px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          color: #1a1a1a;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          line-height: 1.6;
        `;

        // 将URL转换为可点击链接
        const linkifiedMessage = message.replace(
          /(https?:\/\/[^\s]+)/g,
          '<a href="$1" target="_blank" style="color: #0066cc; text-decoration: underline;">$1</a>'
        );

        let html = `
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
            <div style="font-size: 18px; font-weight: 600; color: #d32f2f;">${title}</div>
            ${showCloseButton ? '<button id="modalCloseBtn" style="background: none; border: none; color: #666; font-size: 24px; cursor: pointer; padding: 0; line-height: 1;">&times;</button>' : ''}
          </div>
          <div style="white-space: pre-wrap; color: #333333;">${linkifiedMessage}</div>
        `;

        modal.innerHTML = html;
        document.body.appendChild(modal);

        // 阻止链接点击事件冒泡
        const links = modal.querySelectorAll('a');
        links.forEach(link => {
          link.addEventListener('click', (e) => {
            e.stopPropagation();
          });
        });

        // 关闭按钮事件
        if (showCloseButton) {
          const closeBtn = document.getElementById('modalCloseBtn');
          if (closeBtn) {
            closeBtn.addEventListener('click', () => {
              modal.remove();
            });
          }
        }

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            modal.remove();
          }
        });

        // ESC键关闭
        const escHandler = (e) => {
          if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
          }
        };
        document.addEventListener('keydown', escHandler);
      }

      function showLoading(show) {
        const existingLoading = document.querySelector(".loading");
        if (existingLoading && existingLoading.parentNode) {
          existingLoading.parentNode.removeChild(existingLoading);
        }

        if (false) {
          const loadingEl = document.createElement("div");
          loadingEl.className = "loading";
          loadingEl.textContent = "加载中...";
          document.body.appendChild(loadingEl);
        }
      }

      function getFilterHighlightClass(keywordIndex) {
        return filterHighlightClasses[
          keywordIndex % filterHighlightClasses.length
        ];
      }

      // 应用一级过滤 - 同步版本 + 性能优化
      function applyFilter() {
        const filterText = filterBox.value; // 不trim，保留空格

        // 调试日志：记录过滤输入
        console.log('=== applyFilter called (sync + optimized) ===');

        // 🚀 新增：过滤模式检测
        if (!isFileLoadMode && filterModeFileList.length > 0) {
          // 过滤模式：使用 rg 直接从文件列表中过滤
          console.log(`[过滤模式] 使用 rg 从 ${filterModeFileList.length} 个文件中过滤`);
          applyFilterWithRipgrepOnFiles(filterText, filterModeFileList);
          return;
        }

        // 🚀 调试：输出文件信息
        if (typeof currentFiles !== 'undefined' && currentFiles && currentFiles.length > 0) {
          console.log('[Filter] 第一个文件信息:', {
            name: currentFiles[0].name,
            path: currentFiles[0].path,
            archiveName: currentFiles[0].archiveName
          });
        }

        // 🚀 优先使用 ripgrep 过滤（如果可用且有有效磁盘路径）
        // 🔧 检查是否是压缩包文件 - 压缩包内容使用Worker过滤
        // 🔧 调试：输出所有文件的压缩包属性
        console.log('[Filter] currentFiles 总数:', currentFiles ? currentFiles.length : 0);
        for (let i = 0; i < Math.min(currentFiles.length, 3); i++) {
          const f = currentFiles[i];
          console.log(`[Filter] 文件 ${i}:`, {
            name: f.name,
            path: f.path ? f.path.substring(0, 80) + '...' : '(no path)',
            archiveName: f.archiveName ? f.archiveName.substring(0, 50) + '...' : '(no archiveName)',
            fromArchive: f.fromArchive
          });
        }

        const isArchiveFile = currentFiles.some(f => f.archiveName || f.fromArchive);
        console.log('[Filter] isArchiveFile 检查结果:', isArchiveFile);

        if (!isArchiveFile &&
            typeof window.electronAPI !== 'undefined' &&
            window.electronAPI.callRG &&
            typeof currentFiles !== 'undefined' &&
            currentFiles &&
            currentFiles.length > 0 &&
            currentFiles[0] &&
            currentFiles[0].path &&
            hasValidDiskPath(currentFiles[0].path)) {
          console.log('[Filter] ✓ 使用 ripgrep 极速过滤');
          applyFilterWithRipgrepAsync(filterText);
          return;
        } else {
          if (isArchiveFile) {
            console.log('[Filter] 文件来自压缩包，使用Worker过滤');
          } else {
            console.log('[Filter] 使用原有过滤方法');
          }
        }

        // 调试日志：记录过滤输入
        console.log('Input value:', JSON.stringify(filterText));

        // 🚀 重新过滤前释放之前过滤的内存
        cleanFilterData();

        // 新增：发送过滤关键词到服务端
        sendFilterKeywordsToServer(filterText);

        // 使用trim检查是否为空，但保留原始值用于过滤
        if (filterText.trim() === "") {
          // cleanFilterData 已经清空，无需再次调用 resetFilter
          return;
        }

        // 新增：添加到过滤历史
        addToFilterHistory(filterText);

        // 解析过滤关键词（支持逗号和管道符分隔，支持转义）
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
          } else if (char === "|" || char === ",") {
            if (currentKeyword) {
              keywords.push(currentKeyword); // 保留空格
              currentKeyword = "";
            }
          } else {
            currentKeyword += char;
          }
        }

        if (currentKeyword) {
          keywords.push(currentKeyword); // 保留空格
        }

        // 🚀 自动追加 "=== 文件:" 关键词，确保文件头始终显示在过滤结果中
        // 例如：用户输入 "battery|charge"，实际过滤为 "battery|charge|=== 文件:"
        keywords.push("=== 文件:");

        // ========== 性能优化：智能匹配策略 ==========
        // 根据关键词类型选择最快的匹配方法
        // 🔧 大小写敏感：保留原始大小写进行匹配
        const compiledPatterns = keywords.map(keyword => {
          // 检查是否包含正则特殊字符
          const hasRegexSpecialChars = /[.*+?^${}()|[\]\\]/.test(keyword);

          // 优化1：纯文本关键词（最常见）- 直接使用 includes，最快
          // 🔧 改为大小写敏感匹配
          if (!hasRegexSpecialChars && !keyword.includes(" ")) {
            return {
              type: 'simple',
              keyword,
              test: (lineContent) => lineContent.includes(keyword)
            };
          }

          // 优化2：包含空格的短语 - 使用 includes
          // 🔧 改为大小写敏感匹配
          if (keyword.includes(" ")) {
            return {
              type: 'phrase',
              keyword,
              test: (lineContent) => lineContent.includes(keyword)
            };
          }

          // 优化3：包含特殊字符 - 使用正则表达式（最慢，但功能最强）
          // 🔧 改为大小写敏感匹配
          try {
            const regex = new RegExp(escapeRegExp(keyword));
            return {
              type: 'regex',
              keyword,
              regex,
              test: (lineContent) => regex.test(lineContent)
            };
          } catch (e) {
            // 降级：使用字符串匹配
            return {
              type: 'string',
              keyword,
              test: (lineContent) => lineContent.includes(keyword)
            };
          }
        });

        // ========== 性能优化：已移除HTML反转义，直接使用原始内容 ==========
        const getCachedUnescape = (line) => {
          // 直接返回原始内容，不进行任何转义/反转义操作
          return line;
        };

        // 🚀 执行过滤（增量显示，性能优化版）
        console.log('[Filter] 开始增量过滤（优化版）...');

        // 🔧 内存优化：设置过滤标志，禁用HTML缓存
        isFiltering = true;

        // 🧹 首先清理之前的过滤内容
        console.log('[Filter] 清理旧内容...');
        filteredPanel.classList.add("visible");

        // 🔧 显示面板时自动隐藏文件树
        const fileTreeContainer = DOMCache.get('fileTreeContainer');
        const fileTreeCollapseBtn = DOMCache.get('fileTreeCollapseBtn');
        if (fileTreeContainer && fileTreeContainer.classList.contains('visible')) {
          fileTreeContainer.classList.remove('visible');
          if (fileTreeCollapseBtn) {
            fileTreeCollapseBtn.textContent = '▶';
            fileTreeCollapseBtn.style.display = 'none'; // 🔧 隐藏折叠按钮
          }
          fileTreeWasHiddenByFilter = true;
          // 🔧 调整布局和按钮位置
          if (typeof updateLayout === 'function') {
            updateLayout();
          }
          if (typeof updateButtonPosition === 'function') {
            updateButtonPosition();
          }
          console.log('[Filter] 文件树面板已自动隐藏（过滤触发）');
        }

        filteredCount.textContent = "0 (0%)";
        document.getElementById('status').textContent = '正在准备过滤...';

        // 清空旧数据
        filteredPanelAllLines = [];
        filteredPanelAllOriginalIndices = [];
        filteredPanelAllPrimaryIndices = [];
        filteredPanelVisibleStart = -1;
        filteredPanelVisibleEnd = -1;

        // 清空 UI
        filteredPanelPlaceholder.style.height = "0px";
        filteredPanelVirtualContent.innerHTML = "";
        filteredPanelContent.scrollTop = 0;
        filteredPanelScrollPosition = 0;

        // 使用 setTimeout 确保 UI 更新后再开始过滤
        setTimeout(() => {
          startIncrementalFilter(keywords, compiledPatterns, getCachedUnescape);
        }, 0);

        // 提前返回，避免继续执行下面的代码
        return;
      }

      // 🚀 增量过滤函数（独立出来便于多线程扩展）
      function startIncrementalFilter(keywords, compiledPatterns, getCachedUnescape) {
        const startTime = performance.now();

        // 🚀 智能跳转：记录当前查看位置的原始索引
        // 优先使用点击记录的行，如果没有则使用可见区域的中心行
        if (typeof lastClickedOriginalIndex === 'undefined' || lastClickedOriginalIndex < 0) {
          // 没有点击记录时，尝试使用可见区域的中心行
          if (typeof filteredPanelAllOriginalIndices !== 'undefined' &&
              filteredPanelAllOriginalIndices &&
              filteredPanelAllOriginalIndices.length > 0) {
            const filteredPanelContent = DOMCache.get('filteredPanelContent');
            if (filteredPanelContent) {
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
                lastClickedOriginalIndex = filteredPanelAllOriginalIndices[centerIndex];
                console.log(`[Filter MainThread] 📍 记忆可见区域中心行: originalIndex=${lastClickedOriginalIndex}`);
              }
            }
          }
        } else {
          console.log(`[Filter MainThread] 📍 使用已记录位置: originalIndex=${lastClickedOriginalIndex}`);
        }

        const filteredLines = [];
        const filteredToOriginalIndex = [];

        // 性能优化：根据数据量动态调整批次大小
        const totalLines = originalLines.length;
        const CHUNK_SIZE = totalLines > 100000 ? 50000 :  // 超大数据：5万/批
                              totalLines > 50000 ? 20000 :  // 大数据：2万/批
                              totalLines > 10000 ? 10000 :  // 中数据：1万/批
                              5000;                        // 小数据：5千/批

        let processedCount = 0;
        let lastUIUpdate = 0;
        let lastDOMUpdate = 0;

        // 更新阈值：减少UI更新频率
        const UI_UPDATE_INTERVAL = 100;  // 每 100ms 更新一次文本
        const DOM_UPDATE_THRESHOLD = 0.15;  // 每处理 15% 才更新 DOM

        // 更新状态
        document.getElementById('status').textContent = '正在过滤...';

        // 使用分批处理，避免阻塞UI
        function processBatch(startIndex) {
          const endIndex = Math.min(startIndex + CHUNK_SIZE, totalLines);
          const batchStartTime = performance.now();

          console.log(`[Filter] 处理批次: ${startIndex} - ${endIndex} / ${totalLines} (${((endIndex / totalLines) * 100).toFixed(1)}%)`);

          for (let i = startIndex; i < endIndex; i++) {
            const line = originalLines[i];

            // 使用缓存获取反转义后的内容
            const lineContent = getCachedUnescape(line);

            // 检查是否包含任何关键词（使用预编译的模式）
            let matches = false;
            for (const pattern of compiledPatterns) {
              if (pattern.test(lineContent)) {
                matches = true;
                break;
              }
            }

            if (matches) {
              filteredLines.push(line);
              filteredToOriginalIndex.push(i);
            }
          }

          processedCount = endIndex;
          const currentTime = performance.now();
          const percentage = processedCount / totalLines;
          const matchCount = filteredLines.length;

          // 🚀 性能优化：减少 UI 更新频率
          // 1. 更新文本计数器（每 100ms 或完成）
          if (currentTime - lastUIUpdate >= UI_UPDATE_INTERVAL || endIndex === totalLines) {
            const percentageText = (percentage * 100).toFixed(1);
            filteredCount.textContent = `${matchCount} (${percentageText}%)`;
            document.getElementById('status').textContent =
              `过滤中... ${percentageText}% (${matchCount} 个匹配)`;
            lastUIUpdate = currentTime;
          }

          // 2. 更新过滤框内容（只在关键节点：每 15% 或已有足够结果）
          const shouldUpdateDOM = (percentage - lastDOMUpdate >= DOM_UPDATE_THRESHOLD) ||
                                   (matchCount >= 100 && lastDOMUpdate === 0);

          if (shouldUpdateDOM && matchCount >= 50 && endIndex < totalLines) {
            // 更新过滤框数据
            filteredPanelAllLines = filteredLines;
            filteredPanelAllOriginalIndices = filteredToOriginalIndex;
            filteredPanelAllPrimaryIndices = [];

            // 🔧 内存优化：过滤过程中只更新占位符，不渲染内容
            // 避免调用 updateFilteredPanelVisibleLines() 导致卡顿

            // 🚀 禁用预缓存，改用懒加载避免内存溢出
            // buildFilteredPanelHtmlCache();

            // 🚀 性能优化2：预计算文件头索引集合，避免每行都执行 startsWith 检查
            fileHeaderIndices.clear();
            for (let i = 0; i < filteredPanelAllLines.length; i++) {
              if (filteredPanelAllLines[i] && filteredPanelAllLines[i].startsWith("=== 文件:")) {
                fileHeaderIndices.add(i);
              }
            }

            // 重置虚拟滚动状态
            filteredPanelVisibleStart = -1;
            filteredPanelVisibleEnd = -1;

            // 设置占位元素高度
            const totalHeight = filteredLines.length * filteredPanelLineHeight;
            filteredPanelPlaceholder.style.height = totalHeight + "px";

            // 清空虚拟内容
            filteredPanelVirtualContent.innerHTML = "";

            // 保持滚动位置（只在第一次时设置）
            if (filteredLines.length <= 50) {
              filteredPanelContent.scrollTop = 0;
              filteredPanelScrollPosition = 0;
            }

            // 🔧 性能优化：过滤过程中不渲染内容，避免卡顿
            // updateFilteredPanelVisibleLines(); // ← 过滤中禁用，导致黑屏

            lastDOMUpdate = percentage;
            console.log(`[Filter] 增量更新UI: ${matchCount} 条结果 (${(percentage * 100).toFixed(1)}%)`);
          }

          // 继续处理下一批
          if (endIndex < totalLines) {
            // 🚀 使用 requestAnimationFrame 代替 setTimeout，性能更好
            // 只在已经让出过主线程后使用 RAF，首次使用 setTimeout(0)
            if (startIndex === 0) {
              setTimeout(() => processBatch(endIndex), 0);
            } else {
              requestAnimationFrame(() => processBatch(endIndex));
            }
          } else {
            // 🎉 处理完成
            const totalTime = (performance.now() - startTime).toFixed(2);
            console.log(`[Filter] 过滤完成: ${filteredLines.length} 个匹配, 耗时 ${totalTime}ms`);

            finishFiltering(totalTime);
          }
        }

        // 开始处理第一批
        processBatch(0);

        // 过滤完成后的处理
        function finishFiltering(totalTime) {
          // 🔧 内存优化：清除过滤标志，重新启用HTML缓存
          isFiltering = false;

          // 更新当前过滤状态
          currentFilter = {
            filteredLines,
            filteredToOriginalIndex,
            filterKeywords: keywords,
            totalLines: filteredLines.length,
          };

          // 调试日志：记录过滤结果
          console.log('Filter results (sync + optimized with incremental display):');
          console.log('- Matched lines:', filteredLines.length);
          console.log('- Cache size: N/A (unescapeCache removed)');
          // 🚀 优化：避免输出大数组
          if (filteredLines.length > 0) {
            const sampleSize = Math.min(5, filteredLines.length);
            const sample = filteredLines.slice(0, sampleSize).map(line => {
              const truncated = line?.length > 100 ? line.substring(0, 100) + '...' : line;
              return truncated;
            });
            console.log(`- First ${sampleSize} matches:`, JSON.stringify(sample));
          }

          // 修复：增加缓存版本号，确保应用新的过滤高亮
          filteredLineCacheVersion++;

          // 🔧 修复：清空主日志框的 HTML 解析缓存，避免显示旧的过滤关键词高亮
          // 虽然主日志框不应该应用过滤关键词高亮，但清空缓存可以确保万无一失
          clearHtmlParseCache();

          isFiltering = false; // 🔧 过滤完成，重新启用缓存
          document.getElementById("status").textContent =
            `显示 ${filteredLines.length} / ${originalLines.length} 行`;

          // 🔧 显示过滤耗时
          const filteredTimeEl = document.getElementById('filteredTime');
          if (filteredTimeEl && totalTime) {
            const ms = parseFloat(totalTime);
            filteredTimeEl.textContent = ms >= 1000
              ? `(${(ms / 1000).toFixed(2)}s)`
              : `(${ms}ms)`;
          }

          resetSearch();

          // 🚀 性能优化：先更新过滤面板（用户最关心的），再延迟更新主日志框
          // 之前是先 renderLogLines()（重建15万行DOM池）再 updateFilteredPanel()
          // 导致过滤面板显示有明显延迟
          updateFilteredPanel();

          // 🚀 延迟执行主日志框的重渲染，让过滤面板先呈现
          requestAnimationFrame(() => {
            renderLogLines();
            outer.scrollTop = 0;
            updateVisibleLines();
          });

          // 🚀 高效方案：使用 Map 实现 O(1) 查找（不依赖内容匹配）
          if (lastClickedOriginalIndex >= 0) {
            console.log(`[Filter MainThread] 🔍 使用 Map 快速查找 originalIndex=${lastClickedOriginalIndex}...`);

            // 创建 originalIndex -> filteredIndex 的映射 Map（O(n) 构建，O(1) 查找）
            const originalToFilteredMap = new Map();
            for (let i = 0; i < filteredToOriginalIndex.length; i++) {
              originalToFilteredMap.set(filteredToOriginalIndex[i], i);
            }

            let targetFilteredIndex = originalToFilteredMap.get(lastClickedOriginalIndex);

            // 🚀 如果没找到精确匹配，找到最接近的行
            if (targetFilteredIndex === undefined) {
              console.log(`[Filter MainThread] 📍 目标行不在结果中，查找最接近的行...`);

              // 使用二分查找找到插入位置
              let left = 0;
              let right = filteredToOriginalIndex.length - 1;
              while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                if (filteredToOriginalIndex[mid] < lastClickedOriginalIndex) {
                  left = mid + 1;
                } else {
                  right = mid - 1;
                }
              }

              // left 是应该插入的位置，比较 left 和 left-1 哪个更接近
              if (left >= filteredToOriginalIndex.length) {
                // 目标行比所有结果都大，使用最后一个
                targetFilteredIndex = filteredToOriginalIndex.length - 1;
              } else if (left === 0) {
                // 目标行比所有结果都小，使用第一个
                targetFilteredIndex = 0;
              } else {
                // 比较左右两个哪个更接近
                const diffLeft = Math.abs(filteredToOriginalIndex[left - 1] - lastClickedOriginalIndex);
                const diffRight = Math.abs(filteredToOriginalIndex[left] - lastClickedOriginalIndex);
                targetFilteredIndex = diffLeft <= diffRight ? left - 1 : left;
              }

              const closestOriginalIndex = filteredToOriginalIndex[targetFilteredIndex];
              console.log(`[Filter MainThread] ✓ 找到最接近的行: filteredIndex=${targetFilteredIndex}, originalIndex=${closestOriginalIndex}, 距离=${Math.abs(closestOriginalIndex - lastClickedOriginalIndex)}`);
            } else {
              console.log(`[Filter MainThread] ✅ 找到精确匹配行，耗时: O(1), 索引: ${targetFilteredIndex}`);
            }

            if (targetFilteredIndex !== undefined) {
              lastClickedFilteredIndex = targetFilteredIndex;

              // 等待 DOM 更新后执行跳转
              setTimeout(() => {
                const fpc = DOMCache.get('filteredPanelContent');
                const fpvc = DOMCache.get('filteredPanelVirtualContent');

                if (fpc && fpvc) {
                  // 移除旧的高亮
                  const oldHighlights = fpvc.querySelectorAll('.filtered-log-line.highlighted, .filtered-log-line.search-match-highlight');
                  oldHighlights.forEach(line => {
                    line.classList.remove('highlighted', 'search-match-highlight');
                  });

                  // 查找目标行元素并使用 scrollIntoView 跳转
                  const targetLine = fpvc.querySelector(`[data-filtered-index="${targetFilteredIndex}"]`);

                  if (targetLine) {
                    console.log(`[Filter MainThread] 🎯 找到目标行元素，使用 scrollIntoView 跳转`);
                    targetLine.scrollIntoView({ behavior: 'instant', block: 'center' });
                    targetLine.classList.add('highlighted');
                    console.log(`[Filter MainThread] ✅ 已跳转并高亮行 ${targetFilteredIndex}`);
                  } else {
                    // 如果元素不在 DOM 中（虚拟滚动未渲染），先滚动到附近位置触发渲染
                    console.log(`[Filter MainThread] ⚠️ 目标行不在 DOM 中，计算滚动位置...`);

                    // 计算大概的滚动位置
                    let lineHeight = typeof filteredPanelLineHeight !== 'undefined' ? filteredPanelLineHeight : 19;
                    const estimatedTop = targetFilteredIndex * lineHeight;
                    const panelHeight = fpc.clientHeight;
                    const targetScrollTop = Math.max(0, estimatedTop - Math.floor(panelHeight / 2));

                    console.log(`[Filter MainThread] 📍 设置 scrollTop = ${targetScrollTop}px (估计位置)`);

                    // 设置滚动位置触发虚拟滚动更新
                    fpc.scrollTop = targetScrollTop;

                    // 等待虚拟滚动更新后再次查找元素
                    setTimeout(() => {
                      const targetLine2 = fpvc.querySelector(`[data-filtered-index="${targetFilteredIndex}"]`);
                      if (targetLine2) {
                        targetLine2.scrollIntoView({ behavior: 'instant', block: 'center' });
                        targetLine2.classList.add('highlighted');
                        console.log(`[Filter MainThread] ✅ 延迟跳转成功并高亮行 ${targetFilteredIndex}`);
                      } else {
                        console.error(`[Filter MainThread] ❌ 无法找到目标行元素: ${targetFilteredIndex}`);
                      }
                    }, 100);
                  }
                }
              }, 150);
            }
          } else {
            console.log('[Filter MainThread] ℹ️ 没有记录的点击行');
          }

          // 新增：清除二级过滤状态（因为一级过滤已改变）
          secondaryFilter = {
            isActive: false,
            filterText: "",
            filterKeywords: [],
            filteredLines: [],
            filteredToOriginalIndex: [],
            filteredToPrimaryIndex: [],
          };

          // 更新二级过滤状态显示
          if (secondaryFilterStatus) {
            secondaryFilterStatus.textContent = "未应用";
            secondaryFilterStatus.className =
              "secondary-filter-status secondary-filter-inactive";
          }
          filteredPanelFilterStatus.textContent = "";
          filteredPanelFilterBox.value = "";
          updateRegexStatus();

          // 🆕 每次过滤后自动最大化过滤面板
          if (!isFilterPanelMaximized && typeof toggleFilterPanelMaximize === 'function') {
            toggleFilterPanelMaximize();
          }

          if (progressBar) progressBar.style.display = 'none';
        }

        // 提前返回，避免继续执行下面的代码
        return;
      }

      // 重置过滤
      /**
       * 释放日志相关内存
       * 清理所有日志数据、过滤数据、缓存等
       */
      function cleanLogData() {
        console.log('[Memory] 释放日志内存...');

        // 1. 清空原始日志数据
        originalLines = [];
        fileHeaders = [];

        // 2. 清空一级过滤状态
        currentFilter = {
          filteredLines: [],
          filteredToOriginalIndex: [],
          filterKeywords: [],
          totalLines: 0,
        };
        isFiltering = false;

        // 3. 清空二级过滤状态
        secondaryFilter = {
          isActive: false,
          filterText: "",
          filterKeywords: [],
          filteredLines: [],
          filteredToOriginalIndex: [],
          filteredToPrimaryIndex: [],
        };

        // 4. 清空过滤缓存
        // unescapeCache removed
        lastFilterCacheKey = "";

        // 5. 清空搜索相关数据
        resetSearch();

        // 6. 清空过滤面板搜索相关数据
        filteredPanelSearchKeyword = "";
        filteredPanelSearchMatches = [];
        filteredPanelCurrentMatchIndex = -1;
        filteredPanelTotalMatchCount = 0;

        // 7. 清空当前选中的文件
        currentFiles = [];

        // 9. 清空文件树多选
        archiveMultiSelectedFiles.clear();

        // 10. 清理DOM相关
        inner.innerHTML = "";
        if (domPool) {
          domPool.clear();
          domPool = null;
        }
        lastVisibleStart = -1;
        lastVisibleEnd = -1;

        // 11. 清空日志索引
        window.logLineIndex = null;
        window.logKeywordIndex = null;

        // 12. 隐藏过滤面板
        if (filteredPanel) {
          filteredPanel.classList.remove("visible");
        }

        // 13. 清空过滤面板内容
        // 🚀 性能优化：使用 DOM 缓存
        const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
        if (filteredPanelVirtualContent) {
          filteredPanelVirtualContent.innerHTML = '';
        }
        const filteredPanelPlaceholder = DOMCache.get('filteredPanelPlaceholder');
        if (filteredPanelPlaceholder) {
          filteredPanelPlaceholder.style.display = 'block';
        }

        // 14. 清除状态栏
        const status = document.getElementById("status");
        if (status) status.textContent = "";

        // 15. 重置进度条
        const progressBar = document.getElementById('progressBar');
        const progressFill = document.getElementById('progressFill');

        if (progressBar) progressBar.style.display = 'none';
        if (progressFill) progressFill.style.width = '0%';

        // 16. 隐藏 loading
        showLoading(false);

        // 17. 重置选中行
        selectedOriginalIndex = -1;

        console.log('[Memory] 日志内存释放完成');
      }

      /**
       * 隐藏文件加载进度条
       */
      function hideFileProgressBar() {
        const progressBar = document.getElementById('progressBar');
        const progressFill = document.getElementById('progressFill');

        if (progressBar) progressBar.style.display = 'none';
        if (progressFill) progressFill.style.width = '0%';
      }

      /**
       * 释放过滤结果内存（二级清理）
       * 只清空过滤相关数据，保留原始日志
       */
      function cleanFilterData() {
        console.log('[Memory] 释放过滤内存...');

        // 清空一级过滤状态
        currentFilter = {
          filteredLines: [],
          filteredToOriginalIndex: [],
          filterKeywords: [],
          totalLines: 0,
        };
        isFiltering = false;

        // 清空二级过滤状态
        secondaryFilter = {
          isActive: false,
          filterText: "",
          filterKeywords: [],
          filteredLines: [],
          filteredToOriginalIndex: [],
          filteredToPrimaryIndex: [],
        };

        // 🚀 关键修复：清空过滤面板的全局数组（这是内存泄漏的主要原因）
        filteredPanelAllLines = [];
        filteredPanelAllOriginalIndices = [];
        filteredPanelAllPrimaryIndices = [];

        // 清空过滤缓存
        // unescapeCache removed
        lastFilterCacheKey = "";

        // 🔧 修复：清空 HTML 渲染缓存，        // 解决过滤模式下第二次输入不同关键词后无法正常过滤的问题
        if (typeof invalidateFilteredLineCache === 'function') {
          invalidateFilteredLineCache();
          console.log('[Memory] 已清空 HTML 渲染缓存');
        }

        // 清空搜索相关数据
        resetSearch();

        // 清空过滤面板搜索相关数据
        filteredPanelSearchKeyword = "";
        filteredPanelSearchMatches = [];
        filteredPanelCurrentMatchIndex = -1;
        filteredPanelTotalMatchCount = 0;

        // 清空过滤面板内容
        // 🚀 性能优化：使用 DOM 缓存
        const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
        if (filteredPanelVirtualContent) {
          filteredPanelVirtualContent.innerHTML = '';
        }
        const filteredPanelPlaceholder = DOMCache.get('filteredPanelPlaceholder');
        if (filteredPanelPlaceholder) {
          filteredPanelPlaceholder.style.height = "0px";  // 🚀 重置高度
          filteredPanelPlaceholder.style.display = 'block';
        }

        // 🚀 重置过滤面板虚拟滚动状态
        filteredPanelVisibleStart = -1;
        filteredPanelVisibleEnd = -1;
        filteredPanelScrollPosition = 0;
        if (filteredPanelContent) {
          filteredPanelContent.scrollTop = 0;
        }

        // 隐藏过滤面板
        if (filteredPanel) {
          filteredPanel.classList.remove("visible");
        }

        // 🔧 修复：清空 HTML 解析缓存，避免主日志框显示旧的过滤关键词高亮
        // 当过滤关键词变化时，必须清空缓存，否则会显示错误的高亮
        clearHtmlParseCache();
        console.log('[Memory] HTML 解析缓存已清空');

        // 🔧 清空过滤耗时显示
        const filteredTimeEl = document.getElementById('filteredTime');
        if (filteredTimeEl) filteredTimeEl.textContent = '';

        console.log('[Memory] 过滤内存释放完成');
      }

      function resetFilter(showMsg = true) {
        currentFilter = {
          filteredLines: [],
          filteredToOriginalIndex: [],
          filterKeywords: [],
          totalLines: 0,
        };

        // 🚀 性能优化2：重置时清空文件头索引集合
        fileHeaderIndices.clear();

        isFiltering = false;

        // 隐藏过滤时间显示
        const filteredTimeElement = document.getElementById('filteredTime');
        if (filteredTimeElement) {
          filteredTimeElement.style.display = 'none';
        }

        if (showMsg) {
          //showMessage("过滤已重置");
        }

        resetSearch();
        renderLogLines();
        updateVisibleLines();

        // 新增：隐藏悬浮过滤内容框
        filteredPanel.classList.remove("visible");

        // 🔧 恢复文件树按钮显示
        if (typeof restoreFileTreePanel === 'function') {
          restoreFileTreePanel();
        }

        // 新增：清除二级过滤
        clearSecondaryFilter();
      }

      // 渲染日志（始终显示原始日志）
      function renderLogLines() {
        inner.innerHTML = "";
        lastVisibleStart = -1;
        lastVisibleEnd = -1;
        // 🚀 性能优化：重置过滤高亮清理标志，新内容需要重新检查
        window._mainLogFilterCleaned = false;

        // 初始化DOM池（计算屏幕可见行数+buffer作为初始池大小）
        const screenVisibleLines = Math.ceil(outer.clientHeight / lineHeight);
        const poolSize = screenVisibleLines + bufferSize * 2;

        // 如果池不存在或大小不合适，重新创建
        if (!domPool || Math.abs(domPool.initialSize - poolSize) > 50) {
          if (domPool) {
            domPool.clear();
          }
          domPool = new DOMPool(inner, poolSize);
        } else {
          // 复用现有池，但先清空活跃元素
          domPool.releaseAll();
        }

        // 🚀 修复黑屏：使用安全高度，防止超过 Chromium DOM 高度限制
        const { height: safeHeight } = computeSafeScrollHeight(originalLines.length);
        const placeholder = document.createElement("div");
        placeholder.className = "log-placeholder";
        placeholder.style.height = safeHeight + "px";
        inner.appendChild(placeholder);

        if (virtualScrollScale > 1) {
          console.log(`[renderLogLines] 超大文件模式: ${originalLines.length} 行, 自然高度=${(originalLines.length * lineHeight / 1e6).toFixed(1)}M px, 压缩高度=${(safeHeight / 1e6).toFixed(1)}M px, scale=${virtualScrollScale.toFixed(4)}`);
        }

        updateVisibleLines();
      }

      // 🚀 性能优化：异步渲染日志 - 使用 Worker 进行高亮计算
      /**
       * 异步渲染日志函数 - 使用 Worker 处理大批量高亮
       * 适用于大文件加载场景
       * @param {Object} options - 配置选项
       * @returns {Promise<void>}
       */
      async function renderLogLinesAsync(options = {}) {
        const {
          useWorkerHighlight = true,  // 是否使用 Worker 高亮
          showProgress = true           // 是否显示进度
        } = options;

        inner.innerHTML = "";
        lastVisibleStart = -1;
        lastVisibleEnd = -1;

        // 初始化 DOM 池
        const screenVisibleLines = Math.ceil(outer.clientHeight / lineHeight);
        const poolSize = screenVisibleLines + bufferSize * 2;

        if (!domPool || Math.abs(domPool.initialSize - poolSize) > 50) {
          if (domPool) {
            domPool.clear();
          }
          domPool = new DOMPool(inner, poolSize);
        } else {
          domPool.releaseAll();
        }

        // 🚀 修复黑屏：使用安全高度，防止超过 Chromium DOM 高度限制
        const { height: safeHeight } = computeSafeScrollHeight(originalLines.length);
        const placeholder = document.createElement("div");
        placeholder.className = "log-placeholder";
        placeholder.style.height = safeHeight + "px";
        inner.appendChild(placeholder);

        if (virtualScrollScale > 1) {
          console.log(`[renderLogLinesAsync] 超大文件模式: ${originalLines.length} 行, scale=${virtualScrollScale.toFixed(4)}`);
        }

        // 先渲染基本内容（无高亮），快速显示
        updateVisibleLinesBasic();

        // 如果启用 Worker 高亮且文件较大，异步处理高亮
        if (useWorkerHighlight && originalLines.length > 1000) {
          await applyHighlightAsync(showProgress);
        } else {
          // 小文件，直接使用同步更新
          updateVisibleLines();
        }
      }

      /**
       * 基础渲染（无高亮）- 快速显示内容
       */
      function updateVisibleLinesBasic() {
        if (originalLines.length === 0) return;

        const scrollTop = outer.scrollTop;
        const clientHeight = outer.clientHeight;

        // 🚀 修复黑屏：使用缩放感知的行号计算
        const firstVisibleLine = scrollTopToLine(scrollTop);
        const lastVisibleLine = scrollTopToLine(scrollTop + clientHeight);

        const newVisibleStart = Math.max(
          0,
          firstVisibleLine - bufferSize
        );
        const newVisibleEnd = Math.min(
          originalLines.length - 1,
          lastVisibleLine + bufferSize
        );

        visibleStart = newVisibleStart;
        visibleEnd = newVisibleEnd;

        const fragment = document.createDocumentFragment();

        for (let i = visibleStart; i <= visibleEnd; i++) {
          const lineContent = originalLines[i];
          const isFileHeader = lineContent.startsWith("=== 文件:");

          let line;
          if (domPool) {
            line = domPool.acquire(i, isFileHeader ? "file-header" : "log-line");
          } else {
            line = document.createElement("div");
            line.className = isFileHeader ? "file-header" : "log-line";
            line.dataset.index = String(i);
            line.style.cssText = `position:absolute;width:100%;`;
          }

          // 只设置基本属性，不处理高亮
          // 🚀 修复黑屏：缩放模式下使用映射后的 Y 坐标
          const translateY = lineToScrollTop(i);
          line.style.transform = `translateY(${translateY}px)`;
          line.dataset.lineNumber = i + 1;
          line.textContent = lineContent; // 使用 textContent，快速显示

          if (!line.parentElement || line.parentElement !== inner) {
            fragment.appendChild(line);
          }
        }

        if (fragment.children.length > 0) {
          inner.appendChild(fragment);
        }

        lastVisibleStart = visibleStart;
        lastVisibleEnd = visibleEnd;
      }

      /**
       * 异步应用高亮 - 使用 Worker 或主线程
       */
      async function applyHighlightAsync(showProgress) {
        if (typeof window.HighlightWorkerManager === 'undefined') {
          console.log('[Async Render] HighlightWorkerManager not available, skipping async highlight');
          return;
        }

        // 收集需要高亮的可见行
        const linesToHighlight = [];
        const lineIndices = [];

        for (let i = visibleStart; i <= visibleEnd; i++) {
          const lineContent = originalLines[i];
          const isFileHeader = lineContent.startsWith("=== 文件:");

          // 只对非文件头且需要高亮的行处理
          if (!isFileHeader && (searchKeyword || customHighlights.length > 0)) {
            linesToHighlight.push(lineContent);
            lineIndices.push(i);
          }
        }

        if (linesToHighlight.length === 0) return;

        try {
          // 使用 Worker 批量高亮
          const highlightedLines = await window.HighlightWorkerManager.batchHighlight(
            linesToHighlight,
            {
              searchKeyword: '',  // 🔧 不传递搜索关键词（用户不希望搜索关键词被高亮）
              customHighlights: customHighlights || [],
              currentMatchLine: totalMatchCount > 0 ? searchMatches[currentMatchIndex] : -1
            }
          );

          // 应用高亮结果
          const fragment = document.createDocumentFragment();

          for (let i = 0; i < lineIndices.length; i++) {
            const lineIndex = lineIndices[i];
            // 优先从 DOMPool 获取，避免 querySelector 遍历 DOM
            const lineElement = domPool ? domPool.activeElements.get(lineIndex) : inner.querySelector(`[data-index="${lineIndex}"]`);

            if (lineElement) {
              lineElement.innerHTML = highlightedLines.results[i];
            }
          }

        } catch (error) {
          console.warn('[Async Render] Worker highlight failed:', error);
          // 失败时回退到同步更新
          updateVisibleLines();
        }
      }

      function getLineHeight() {
        return lineHeight;
      }

      // 更新可见行（始终基于原始日志）- DOM池化优化版本
      function updateVisibleLines() {
        if (originalLines.length === 0) return;

        const scrollTop = outer.scrollTop;
        const clientHeight = outer.clientHeight;

        // 🚀 修复黑屏：使用缩放感知的行号计算
        // 当虚拟高度被压缩时，scrollTop 需要通过 scale 映射回真实行号
        const firstVisibleLine = scrollTopToLine(scrollTop);
        const lastVisibleLine = scrollTopToLine(scrollTop + clientHeight);

        const newVisibleStart = Math.max(
          0,
          firstVisibleLine - bufferSize
        );
        const newVisibleEnd = Math.min(
          originalLines.length - 1,
          lastVisibleLine + bufferSize
        );

        // 如果可见范围没有变化，跳过渲染
        if (newVisibleStart === lastVisibleStart && newVisibleEnd === lastVisibleEnd) {
          return;
        }

        // DOM池化优化：回收不再可见的元素（必须在更新 lastVisible* 之前执行）
        if (domPool && lastVisibleStart >= 0 && lastVisibleEnd >= 0) {
          if (newVisibleStart > lastVisibleStart) {
            domPool.releaseRange(lastVisibleStart, newVisibleStart - 1);
          }
          if (newVisibleEnd < lastVisibleEnd) {
            domPool.releaseRange(newVisibleEnd + 1, lastVisibleEnd);
          }
        }

        visibleStart = newVisibleStart;
        visibleEnd = newVisibleEnd;
        lastVisibleStart = visibleStart;
        lastVisibleEnd = visibleEnd;

        // 🔧 修复：主日志框不应该应用过滤关键词高亮（只应用搜索和自定义高亮）
        // 预计算常用变量
        const hasSearchKeyword = !!searchKeyword;
        const hasCustomHighlights = customHighlights.length > 0;
        const currentMatchLine = totalMatchCount > 0 ? searchMatches[currentMatchIndex] : -1;

        // 🚀 性能优化：延迟执行过滤高亮清理，避免每次滚动都 querySelectorAll
        // 只在首次渲染或内容变化时才需要清理，滚动时跳过
        if (!window._mainLogFilterCleaned) {
          window._mainLogFilterCleaned = true;
          const filterHighlightClassPrefix = 'filter-highlight-';
          for (let i = visibleStart; i <= visibleEnd; i++) {
            // 优先从 DOMPool 获取已有元素，避免 querySelector 遍历 DOM
            const line = domPool ? domPool.activeElements.get(i) : inner.querySelector(`[data-index="${i}"]`);
            if (!line) continue;
            const classes = line.className.split(' ');
            let modified = false;
            for (let j = classes.length - 1; j >= 0; j--) {
              if (classes[j].startsWith(filterHighlightClassPrefix)) {
                classes.splice(j, 1);
                modified = true;
              }
            }
            if (modified) line.className = classes.join(' ');
          }
        }

        // 使用DocumentFragment批量添加新元素（减少重绘）
        const fragment = document.createDocumentFragment();

        for (let i = visibleStart; i <= visibleEnd; i++) {
          const lineContent = originalLines[i];
          const isFileHeader = lineContent.startsWith("=== 文件:");

          // DOM池化：从池中获取或复用元素
          let line;
          if (domPool) {
            line = domPool.acquire(i, isFileHeader ? "file-header" : "log-line");
          } else {
            // 降级方案：如果没有池，创建新元素
            line = document.createElement("div");
            line.className = isFileHeader ? "file-header" : "log-line";
            line.dataset.index = String(i);
            line.style.cssText = `position:absolute;width:100%;`;
          }

          // 选中行（用于书签/快捷操作）
          if (!isFileHeader && i === selectedOriginalIndex) {
            line.classList.add("selected");
          } else {
            line.classList.remove("selected");
          }

          // 高亮当前搜索匹配
          if (!isFileHeader && i === currentMatchLine) {
            line.classList.add("current-match-line");
          } else {
            line.classList.remove("current-match-line");
          }

          // 高亮永久高亮行
          if (!isFileHeader && i === currentPermanentHighlightIndex) {
            line.classList.add("permanent-highlight");
          } else {
            line.classList.remove("permanent-highlight");
          }

          // 🚀 性能优化：使用transform替代top，启用GPU加速
          // 🚀 修复黑屏：缩放模式下使用映射后的 Y 坐标
          const translateY = lineToScrollTop(i);
          line.style.transform = `translateY(${translateY}px)`;

          // 🚀 性能优化：使用data属性存储行号，通过CSS显示
          line.dataset.lineNumber = i + 1;

          // 🚀 性能优化：快速检查此行是否需要高亮处理
          // 🔧 移除搜索关键词高亮（用户不希望搜索关键词被高亮）
          const needsHighlight = !isFileHeader && hasCustomHighlights;

          if (needsHighlight) {
            // 🎯 需要高亮：使用innerHTML（利用HTML缓存）
            let displayContent = lineContent;

            // 🔧 修复：主日志框的缓存键不包含过滤关键词（避免显示错误的过滤高亮）
            // 🔧 移除搜索关键词从缓存键（用户不希望搜索关键词被高亮）
            // 🚀 性能优化：生成缓存键，包含所有影响渲染的因素
            const cacheKeyParts = [];
            // 搜索关键词不再影响缓存（不会高亮显示）
            // if (hasSearchKeyword) cacheKeyParts.push(`s:${searchKeyword}`);
            if (hasCustomHighlights) {
              const highlightKeys = customHighlights.map(h => h.keyword).join(',');
              cacheKeyParts.push(`h:${highlightKeys}`);
            }
            const cacheKey = cacheKeyParts.join('|');

            // 🚀 性能优化：尝试从缓存获取解析后的HTML
            const cachedHtml = getCachedHtml(lineContent, cacheKey);
            if (cachedHtml !== null) {
              displayContent = cachedHtml;
            } else {
              // 缓存未命中，执行完整的HTML解析

              // 🚀 性能优化：使用合并高亮函数，一次性处理所有高亮类型
              // 🔧 不传递搜索关键词（用户不希望搜索关键词被高亮）
              displayContent = applyBatchHighlight(displayContent, {
                searchKeyword: '',  // 搜索关键词不再传递
                customHighlights: hasCustomHighlights ? customHighlights : [],
                currentMatchLine: currentMatchLine,
                lineIndex: i
              });

              // 🚀 性能优化：将解析结果存入缓存
              setCachedHtml(lineContent, cacheKey, displayContent);
            }

            // 设置内容（需要HTML高亮）
            line.innerHTML = displayContent;
          } else {
            // 🚀 性能优化：无高亮需求，直接使用textContent（比innerHTML快5-10倍）
            line.textContent = lineContent;
          }

          // 如果是新创建的元素（不在DOM中），添加到fragment
          if (!line.parentElement || line.parentElement !== inner) {
            fragment.appendChild(line);
          }
        }

        // 批量添加新元素
        if (fragment.children.length > 0) {
          // 在 appendChild 之前收集元素引用（appendChild 后 fragment 会变空）
          let newElements = [];
          if (window.mainLinesObserver) {
            newElements = Array.from(fragment.querySelectorAll('.log-line, .file-header'));
          }

          inner.appendChild(fragment);

          // 将新元素添加到 Intersection Observer
          if (window.mainLinesObserver && newElements.length > 0) {
            newElements.forEach(el => {
              try {
                window.mainLinesObserver.observe(el);
              } catch (e) {
                // 元素可能已经被观察，忽略错误
              }
            });
          }
        }

        // ========== 虚拟滚动优化：更新滚动进度指示器 ==========
        updateScrollProgress();
      }

      // ========== 虚拟滚动优化：更新滚动进度函数 ==========
      function updateScrollProgress() {
        const scrollProgressBar = document.getElementById('scrollProgressBar');
        const scrollProgressText = document.getElementById('scrollProgressText');

        if (!scrollProgressBar || !scrollProgressText) return;

        const scrollTop = outer.scrollTop;
        const scrollHeight = outer.scrollHeight - outer.clientHeight;
        const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
        const roundedProgress = Math.round(progress);

        // 更新进度条宽度
        scrollProgressBar.style.setProperty('--scroll-progress', roundedProgress + '%');
        // 更新百分比文本
        scrollProgressText.textContent = roundedProgress + '%';

        // 更新标题，显示当前位置的行号
        const currentLine = scrollTopToLine(scrollTop);
        const totalLines = originalLines.length;
        scrollProgressBar.parentElement.title =
          `滚动位置: ${currentLine + 1} / ${totalLines} 行 (${roundedProgress}%)`;
      }

      // ========== 虚拟滚动优化：初始化滚动进度指示器点击事件 ==========
      function initScrollProgressIndicator() {
        const scrollProgressContainer = document.getElementById('scrollProgressContainer');
        if (!scrollProgressContainer) return;

        // 点击滚动进度条时跳转到对应位置
        scrollProgressContainer.addEventListener('click', (e) => {
          const rect = scrollProgressContainer.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const width = rect.width;
          const percentage = clickX / width;

          // 计算目标行号并跳转
          const targetLine = Math.floor(originalLines.length * percentage);
          jumpToLine(targetLine, 'center');
        });
      }

      // 高亮功能已移至右键菜单，初始化函数不再需要
      function initHighlightFeatures() {
        // 不需要初始化任何事件监听器
      }

      // 高亮功能已移至右键菜单，此函数不再通过工具栏调用
      function toggleCustomHighlight(keyword, color) {
        // 参数可选，如果不提供则返回
        if (!keyword || !color) return;

        toggleFilteredPanelVisibility();
        // 使用trim检查是否为空，但保留原始值用于高亮
        if (keyword.trim() === "") return;

        // 检查是否已存在相同关键词
        const existingIndex = customHighlights.findIndex(
          (h) => h.keyword === keyword
        );
        if (existingIndex !== -1) {
          // 如果已存在，则移除该高亮
          customHighlights.splice(existingIndex, 1);
          showMessage(`已移除关键词 "${keyword}" 的高亮`);
        } else {
          // 如果不存在，则添加新的高亮
          customHighlights.push({ keyword, color });
          showMessage(`已添加关键词 "${keyword}" 的高亮`);
        }

        // 🔧 修复：高亮变化时清空 HTML 解析缓存
        clearHtmlParseCache();

        // 更新主内容区的高亮（不自动显示过滤面板）
        rerenderAfterHighlightChangePreserveScroll(false);
      }


      // 复制所有日志功能
      function copyAllLogs() {
        if (originalLines.length === 0) {
          showMessage("没有日志可复制");
          return;
        }

        // 将 originalLines 数组中的所有行用换行符连接（直接使用原始内容）
        const allLogs = originalLines.join('\n');

        // 使用 Clipboard API 复制到剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(allLogs).then(() => {
            showMessage(`已复制 ${originalLines.length} 行日志到剪贴板`);
          }).catch(err => {
            console.error('复制失败:', err);
            // 降级方案：使用传统方法
            fallbackCopyTextToClipboard(allLogs);
          });
        } else {
          // 降级方案：使用传统方法
          fallbackCopyTextToClipboard(allLogs);
        }
      }

      // 降级复制方案（兼容旧浏览器）
      function fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          const successful = document.execCommand('copy');
          if (successful) {
            showMessage(`已复制 ${originalLines.length} 行日志到剪贴板`);
          } else {
            showMessage("复制失败，请手动选择并复制");
          }
        } catch (err) {
          console.error('降级复制方案失败:', err);
          showMessage("复制失败，请手动选择并复制");
        }
        
        document.body.removeChild(textArea);
      }

      // 复制过滤结果框内容功能
      function copyFilteredLogs() {
        if (filteredPanelAllLines.length === 0) {
          showMessage("没有过滤结果可复制");
          return;
        }

        // 将 filteredPanelAllLines 数组中的所有行用换行符连接（直接使用原始内容）
        const allFilteredLogs = filteredPanelAllLines.join('\n');

        // 使用 Clipboard API 复制到剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(allFilteredLogs).then(() => {
            showMessage(`已复制 ${filteredPanelAllLines.length} 行过滤结果到剪贴板`);
          }).catch(err => {
            console.error('复制失败:', err);
            // 降级方案：使用传统方法
            fallbackCopyFilteredTextToClipboard(allFilteredLogs);
          });
        } else {
          // 降级方案：使用传统方法
          fallbackCopyFilteredTextToClipboard(allFilteredLogs);
        }
      }

      // 暴露到全局作用域，供HTML onclick使用
      window.copyFilteredLogs = copyFilteredLogs;

      // 导出过滤结果为 HTML
      function exportFilteredAsHTML() {
        if (filteredPanelAllLines.length === 0) {
          showMessage("没有过滤结果可导出");
          return;
        }

        try {
          showMessage("正在生成 HTML...");

          // 生成带高亮的 HTML 内容
          const htmlContent = generateFilteredHTML();
          const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });

          // 生成文件名（带时间戳）
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          const fileName = `filtered_${timestamp}.html`;

          // 触发下载
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();

          // 清理
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 100);

          showMessage(`已导出 ${filteredPanelAllLines.length} 行到 ${fileName}`);
        } catch (error) {
          console.error('导出失败:', error);
          showMessage("导出失败: " + error.message);
        }
      }

      // 生成过滤结果的完整 HTML
      function generateFilteredHTML() {
        const keywords = currentFilter.filterKeywords || [];
        const totalCount = filteredPanelAllLines.length;
        const timestamp = new Date().toLocaleString('zh-CN');

        // 获取过滤面板的样式
        const styles = getFilteredPanelStyles();

        // 生成每一行的 HTML（带高亮）
        const linesHTML = filteredPanelAllLines.map((line, index) => {
          const isFileHeader = line && line.startsWith("=== 文件:");
          const originalIndex = filteredPanelAllOriginalIndices ? filteredPanelAllOriginalIndices[index] : index;

          let displayText = line;

          // 应用自定义高亮（优先级最高）
          if (!isFileHeader && customHighlights && customHighlights.length > 0) {
            for (let h = 0; h < customHighlights.length; h++) {
              const highlight = customHighlights[h];
              if (!highlight.keyword) continue;
              displayText = safeHighlight(
                displayText,
                highlight.keyword,
                (match) => `<span class="custom-highlight" style="background-color: ${highlight.color}80;">${match}</span>`
              );
            }
          }

          // 应用过滤高亮（与虚拟滚动保持一致）
          if (!isFileHeader && keywords.length > 0) {
            for (let k = 0; k < keywords.length; k++) {
              const keyword = keywords[k];
              if (!keyword) continue;
              const colorClass = getFilterHighlightClass(k);
              displayText = safeHighlight(
                displayText,
                keyword,
                (match) => `<span class="${colorClass}">${match}</span>`
              );
            }
          }

          // 添加行号
          if (!isFileHeader) {
            const lineNumber = originalIndex + 1;
            displayText = `<span class="line-number">${lineNumber}</span>${displayText}`;
          }

          const className = isFileHeader ? 'file-header' : 'log-line';
          return `  <div class="${className}">${displayText}</div>`;
        }).join('\n');

        // 返回完整 HTML
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>过滤结果 - ${totalCount} 行</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    body {
      font-family: "Monaco", "Menlo", "Ubuntu Mono", "Consolas", monospace;
      font-size: 13px;
      line-height: 1.4;
      background: #f5f5f5;
    }
    .container {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: white;
    }
    .header {
      flex-shrink: 0;
      background: linear-gradient(135deg, #e8f8f0 0%, #d0f0e0 100%);
      padding: 8px 15px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    }
    .header h1 {
      font-size: 14px;
      color: #2e7d32;
      margin-bottom: 4px;
    }
    .header .meta {
      font-size: 11px;
      color: #666;
    }
    .content {
      flex: 1;
      padding: 0;
      background: #fff;
      overflow: auto;
    }
${styles}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>过滤结果</h1>
      <div class="meta">
        过滤关键词: ${keywords.join(' | ')} |
        总行数: ${totalCount.toLocaleString()} |
        导出时间: ${timestamp}
      </div>
    </div>
    <div class="content">
${linesHTML}
    </div>
  </div>
</body>
</html>`;
      }

      // 获取过滤面板的 CSS 样式
      function getFilteredPanelStyles() {
        return `
    .log-line {
      padding: 2px 8px;
      border-bottom: 1px solid #f0f0f0;
      white-space: pre;
      color: #1d1d1f;
    }
    .file-header {
      background: rgba(144, 238, 144, 0.3);
      padding: 4px 8px;
      border-left: 3px solid #90ee90;
      font-weight: 500;
      color: #2e7d32;
      font-size: 12px;
      border-radius: 0 4px 4px 0;
    }
    .line-number {
      display: inline-block;
      min-width: 60px;
      text-align: right;
      padding-right: 12px;
      color: #999;
      font-size: 11px;
      user-select: none;
      -webkit-user-select: none;
    }
    .filter-highlight-0 { background: rgba(255, 99, 71, 0.2); }
    .filter-highlight-1 { background: rgba(32, 178, 170, 0.2); }
    .filter-highlight-2 { background: rgba(138, 43, 226, 0.2); }
    .filter-highlight-3 { background: rgba(255, 165, 0, 0.2); }
    .filter-highlight-4 { background: rgba(50, 205, 50, 0.2); }
    .filter-highlight-5 { background: rgba(0, 191, 255, 0.2); }
    .filter-highlight-6 { background: rgba(255, 20, 147, 0.2); }
    .filter-highlight-7 { background: rgba(106, 90, 205, 0.2); }
    .filter-highlight-8 { background: rgba(60, 179, 113, 0.2); }
    .filter-highlight-9 { background: rgba(255, 140, 0, 0.2); }
    .filter-highlight-10 { background: rgba(70, 130, 180, 0.2); }
    .filter-highlight-11 { background: rgba(186, 85, 211, 0.2); }
    .filter-highlight-12 { background: rgba(100, 149, 237, 0.2); }
    .filter-highlight-13 { background: rgba(210, 105, 30, 0.2); }
    .filter-highlight-14 { background: rgba(178, 34, 34, 0.2); }
    .filter-highlight-15 { background: rgba(65, 105, 225, 0.2); }
    .filter-highlight-16 { background: rgba(218, 112, 214, 0.2); }
    .filter-highlight-17 { background: rgba(95, 158, 160, 0.2); }
    .filter-highlight-18 { background: rgba(123, 104, 238, 0.2); }
    .filter-highlight-19 { background: rgba(199, 21, 133, 0.2); }
    .custom-highlight {
      border-radius: 2px;
      padding: 0 1px;
    }
    .search-highlight { background: rgba(255, 59, 48, 0.25); }
    .current-search-highlight { background: rgba(255, 59, 48, 0.5); }
    `;
      }

      // 暴露到全局作用域，供HTML onclick使用
      window.exportFilteredAsHTML = exportFilteredAsHTML;
      window.generateFilteredHTML = generateFilteredHTML;

      // 降级复制方案（兼容旧浏览器）- 过滤结果框
      function fallbackCopyFilteredTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          const successful = document.execCommand('copy');
          if (successful) {
            showMessage(`已复制 ${filteredPanelAllLines.length} 行过滤结果到剪贴板`);
          } else {
            showMessage("复制失败，请手动选择并复制");
          }
        } catch (err) {
          console.error('降级复制方案失败:', err);
          showMessage("复制失败，请手动选择并复制");
        }
        
        document.body.removeChild(textArea);
      }

      // 页面加载完成后初始化
      window.addEventListener("DOMContentLoaded", init);

      // Electron API 集成
      if (typeof window.electronAPI !== 'undefined') {
        // 监听文件变化
        if (typeof window.electronAPI.onFileChanged === 'function') {
          window.electronAPI.onFileChanged((data) => {
            console.log('文件变化:', data.filePath);
            // 自动刷新当前文件
            if (currentFile && currentFile.path === data.filePath) {
              refreshCurrentFile();
            }
          });
        }

        // 监听文件删除
        if (typeof window.electronAPI.onFileDeleted === 'function') {
          window.electronAPI.onFileDeleted((data) => {
            console.log('文件删除:', data.filePath);
            // 关闭已删除的文件
            closeFile(data.filePath);
          });
        }

        // 监听解析进度
        if (typeof window.electronAPI.onParseProgress === 'function') {
          window.electronAPI.onParseProgress((progress) => {
            console.log('解析进度:', progress);
            // 显示进度条
            showProgressBar(progress.percentage || 0);
          });
        }

        // 系统资源监控 - 定期更新CPU和内存占用率
        if (typeof window.electronAPI.getSystemStats === 'function') {
          let statsUpdateInterval = null;
          let hasFailedOnce = false; // 🔧 标记是否失败过

          async function updateSystemStats() {
            try {
              const stats = await window.electronAPI.getSystemStats();
              // 使用 requestAnimationFrame 确保在合适的时机更新 DOM
              requestAnimationFrame(() => {
                const systemStatsElement = document.getElementById('systemStats');
                if (systemStatsElement) {
                  systemStatsElement.textContent = `CPU: ${stats.cpuPercent}% | MEM: ${stats.memPercent}%`;
                  // 根据CPU占用率改变颜色（只在颜色需要改变时才更新）
                  const targetColor = stats.cpuPercent > 80 ? '#ff3b30' :
                                    stats.cpuPercent > 50 ? '#ff9500' :
                                    '#6e6e73';
                  if (systemStatsElement.style.color !== targetColor) {
                    systemStatsElement.style.color = targetColor;
                  }
                }
              });
              hasFailedOnce = false; // 成功后重置标记
            } catch (error) {
              // 🔧 只在第一次失败时打印，之后静默失败
              if (!hasFailedOnce) {
                console.warn('系统资源监控暂时不可用，将在后台重试...');
                hasFailedOnce = true;
              }
            }
          }

          // 🔧 延迟启动，确保主进程已准备好
          setTimeout(() => {
            updateSystemStats();
            // 每2秒更新一次
            statsUpdateInterval = setInterval(updateSystemStats, 2000);
          }, 3000); // 延迟3秒启动
        }
      }

      // 窗口控制函数
      function minimizeWindow() {
        if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
          window.electronAPI.windowControl.minimize();
        }
      }

      function maximizeWindow() {
        if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
          window.electronAPI.windowControl.maximize();
        }
      }

      function closeWindow() {
        if (typeof window.electronAPI !== 'undefined' && window.electronAPI.windowControl) {
          window.electronAPI.windowControl.close();
        }
      }

      // 使用 Worker 解析大文件的函数
      async function parseLargeFileWithWorker(filePath) {
        if (typeof window.electronAPI !== 'undefined') {
          try {
            const result = await window.electronAPI.parseLargeFile(filePath);
            return result;
          } catch (error) {
            console.error('Worker 解析失败:', error);
            // 回退到普通解析
            return null;
          }
        }
        return null;
      }
      
      // 监控文件变化的函数
      function watchFile(filePath) {
        if (typeof window.electronAPI !== 'undefined') {
          window.electronAPI.watchFile(filePath);
        }
      }
      
      // 停止监控文件
      function unwatchFile(filePath) {
        if (typeof window.electronAPI !== 'undefined') {
          window.electronAPI.unwatchFile(filePath);
        }
      }
      
      // 刷新当前文件
      function refreshCurrentFile() {
        if (currentFile) {
          // 重新加载文件内容
          loadLogFile(currentFile.name, currentFile.content);
        }
      }
      
      // 显示进度条
      function showProgressBar(percentage) {
        // 创建或更新进度条
        let progressBar = document.getElementById('parse-progress-bar');
        if (!progressBar) {
          progressBar = document.createElement('div');
          progressBar.id = 'parse-progress-bar';
          progressBar.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: rgba(0, 113, 227, 0.2);
            z-index: 10000;
          `;
          document.body.appendChild(progressBar);
        }
        
        const progressFill = progressBar.querySelector('.progress-fill') || 
          (() => {
            const fill = document.createElement('div');
            fill.className = 'progress-fill';
            fill.style.cssText = `
              height: 100%;
              background: #0071e3;
              transition: width 0.3s ease;
            `;
            progressBar.appendChild(fill);
            return fill;
          })();
        
        progressFill.style.width = percentage + '%';
        
        if (percentage >= 100) {
          setTimeout(() => {
            progressBar.remove();
          }, 500);
        }
      }
    
// ==================== ripgrep 过滤函数 ====================

/**
 * 检查是否是有效的磁盘路径
 * @param {string} path - 文件路径
 * @returns {boolean} 是否是有效的磁盘路径（非压缩包）
 */
function hasValidDiskPath(path) {
  if (!path) return false;

  // Windows 绝对路径: C:\... 或 E:\...
  if (/^[A-Za-z]:\\/.test(path)) {
    // 检查是否包含压缩包标记（使用冒号或反斜杠/正斜杠）
    const archivePatterns = [
      /\.zip:/i, /\.zip[\/\\]/i,
      /\.7z:/i, /\.7z[\/\\]/i,
      /\.tar:/i, /\.tar[\/\\]/i,
      /\.gz:/i, /\.gz[\/\\]/i,
      /\.rar:/i, /\.rar[\/\\]/i,
      /\.bz2:/i, /\.bz2[\/\\]/i
    ];

    for (const pattern of archivePatterns) {
      if (pattern.test(path)) {
        console.log(`[hasValidDiskPath] 路径包含压缩包标记，无效: ${path}`);
        return false;
      }
    }

    return true;
  }

  return false;
}

/**
 * 🚀 使用 Worker 池并行解析 ripgrep 输出
 * @param {string} ripgrepOutput - ripgrep 的原始输出
 * @param {Array} fileHeaders - 文件头信息数组
 * @param {number} maxWorkers - 最大 Worker 数量（默认 9）
 * @returns {Promise<{matches: Array, errors: Array}>}
 */
async function parseRipgrepOutputParallel(ripgrepOutput, fileHeaders, maxWorkers = 9) {
  const startTime = performance.now();

  // 计算总长度和行数
  const totalLength = ripgrepOutput.length;
  const lineCount = ripgrepOutput.split('\n').length;

  // ⚡ 智能调整 Worker 数量：小数据用单线程更快（避免 Worker 创建开销）
  let optimalWorkers = maxWorkers;
  if (lineCount < 1000) {
    optimalWorkers = 1;  // 小数据：单线程更快
  } else if (lineCount < 10000) {
    optimalWorkers = Math.min(2, maxWorkers);
  } else if (lineCount < 50000) {
    optimalWorkers = Math.min(4, maxWorkers);
  } else if (lineCount < 100000) {
    optimalWorkers = Math.min(6, maxWorkers);
  } else {
    optimalWorkers = Math.min(9, maxWorkers);  // 超大数据：使用最多 9 个 Workers
  }

  console.log(`[Ripgrep Worker Pool] 输入: ${totalLength} 字节, 约 ${lineCount} 行, 使用 ${optimalWorkers} 个 Workers`);

  // 将输出分成 N 块（按行数均分）
  const chunkSize = Math.ceil(lineCount / optimalWorkers);
  const chunks = [];

  // 分块（找到换行符位置，避免在行中间分割）
  let startPos = 0;
  for (let i = 0; i < optimalWorkers; i++) {
    const isLast = i === optimalWorkers - 1;
    const endPos = isLast ? totalLength : findNthNewline(ripgrepOutput, startPos, chunkSize);

    chunks.push(ripgrepOutput.substring(startPos, endPos));
    startPos = endPos;

    if (isLast) break;
  }

  console.log(`[Ripgrep Worker Pool] 已分成 ${chunks.length} 块`);

  // 内联 Worker 代码
  const workerCode = `
    self.onmessage = function(e) {
      const { chunkId, chunkData, fileHeaders } = e.data;
      const matches = [];
      const errors = [];

      try {
        // 构建路径映射
        const headerMap = new Map();
        for (const h of fileHeaders) {
          if (h.filePath) headerMap.set(h.filePath, h);
          if (h.fileName) headerMap.set(h.fileName, h);
        }

        // 逐行解析
        const lines = chunkData.split('\\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line || line.trim() === '') continue;

          // 解析格式：filePath:lineNumber:content
          const firstColonIndex = line.indexOf(':');
          if (firstColonIndex === -1) continue;

          const isWindowsPath = firstColonIndex === 1 && line.length > 2 && line[1] === ':' &&
                                 ((line[0] >= 'A' && line[0] <= 'Z') || (line[0] >= 'a' && line[0] <= 'z'));

          let filePathEndIndex = isWindowsPath ?
            line.indexOf(':', firstColonIndex + 1) : firstColonIndex;

          if (filePathEndIndex === -1) continue;

          // 查找行号
          let lineNumberStart = -1;
          for (let j = filePathEndIndex + 1; j < line.length; j++) {
            if (line[j] >= '0' && line[j] <= '9') {
              let k = j;
              while (k < line.length && line[k] >= '0' && line[k] <= '9') k++;

              if (k < line.length && line[k] === ':') {
                lineNumberStart = j;
                break;
              }
              j = k;
            }
          }

          if (lineNumberStart === -1) continue;

          const lineNumberEndColon = line.indexOf(':', lineNumberStart);
          const filePath = line.substring(0, filePathEndIndex);
          const lineNumberStr = line.substring(lineNumberStart, lineNumberEndColon);

          if (!/^\\d+$/.test(lineNumberStr)) continue;

          const lineNumber = parseInt(lineNumberStr, 10);

          // 查找对应的 header
          let header = headerMap.get(filePath);
          if (!header) {
            const fileName = filePath.split(/[/\\\\]/).pop();
            header = headerMap.get(fileName);
          }

          if (header) {
            const originalIndex = header.startIndex + lineNumber;
            matches.push({
              originalIndex,
              content: line.substring(lineNumberEndColon + 1)
            });
          }
        }

        self.postMessage({
          chunkId,
          success: true,
          matches,
          errorCount: errors.length
        });
      } catch (error) {
        self.postMessage({
          chunkId,
          success: false,
          error: error.message
        });
      }
    };
  `;

  // 创建 Blob URL
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);

  // 启动 Workers
  const workerPromises = chunks.map((chunk, index) => {
    return new Promise((resolve) => {
      const worker = new Worker(workerUrl);

      worker.onmessage = (e) => {
        const { chunkId, success, matches, error } = e.data;
        worker.terminate();

        if (success) {
          resolve({ chunkId, matches, error: null });
        } else {
          resolve({ chunkId, matches: [], error });
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        resolve({ chunkId: index, matches: [], error: err.message });
      };

      worker.postMessage({
        chunkId: index,
        chunkData: chunk,
        fileHeaders: fileHeaders
      });
    });
  });

  // 等待所有 Workers 完成
  const results = await Promise.all(workerPromises);

  // 清理 Blob URL
  URL.revokeObjectURL(workerUrl);

  // 合并结果
  const allMatches = [];
  const allErrors = [];

  for (const result of results) {
    if (result.matches) {
      allMatches.push(...result.matches);
    }
    if (result.error) {
      allErrors.push(result.error);
    }
  }

  const elapsed = performance.now() - startTime;
  console.log(`[Ripgrep Worker Pool] ✓ 完成: ${allMatches.length} 个匹配, 耗时 ${elapsed.toFixed(2)}ms`);

  return { matches: allMatches, errors: allErrors };
}

/**
 * 辅助函数：找到第 n 个换行符的位置
 */
function findNthNewline(str, startPos, n) {
  let count = 0;
  for (let i = startPos; i < str.length; i++) {
    if (str[i] === '\n') {
      count++;
      if (count >= n) {
        return i + 1; // 返回换行符之后的位置
      }
    }
  }
  return str.length; // 如果找不到，返回字符串末尾
}

/**
 * 使用 ripgrep 进行异步过滤
 */
async function applyFilterWithRipgrepAsync(filterText) {
  try {
    console.log('[Ripgrep Filter] 开始过滤:', filterText);

    // 🔧 检查是否来自压缩包 - 压缩包内容必须使用Worker过滤，ripgrep无法处理
    // 🔧 修复：检查所有文件，而不只是第一个文件
    if (typeof currentFiles !== 'undefined' && currentFiles && currentFiles.length > 0) {
      for (const file of currentFiles) {
        if (!file) continue;

        // 检查压缩包特有的属性
        if (file.archiveName || file.fromArchive) {
          console.log('[Ripgrep Filter] 文件来自压缩包，跳过ripgrep，使用Worker过滤');
          // 返回false，让调用者使用Worker过滤
          return false;
        }

        // 检查路径是否包含压缩包标记（如 "archive.zip:file.log"）
        if (file.path) {
          // Unix/Linux 格式: archive.zip:internal/path.txt
          const archivePatterns = [/\.zip:/i, /\.7z:/i, /\.tar:/i, /\.gz:/i, /\.rar:/i, /\.bz2:/i];
          for (const pattern of archivePatterns) {
            if (pattern.test(file.path)) {
              console.log('[Ripgrep Filter] 路径包含压缩包标记，跳过ripgrep，使用Worker过滤');
              return false;
            }
          }
          // Windows 格式: archive.zip\internal\path.txt
          if (/^[A-Za-z]:\\/.test(file.path)) {
            const archivePatternsWin = [/\.zip[\/\\]/i, /\.7z[\/\\]/i, /\.tar[\/\\]/i, /\.gz[\/\\]/i, /\.rar[\/\\]/i, /\.bz2[\/\\]/i];
            for (const pattern of archivePatternsWin) {
              if (pattern.test(file.path)) {
                console.log('[Ripgrep Filter] 路径包含Windows压缩包标记，跳过ripgrep，使用Worker过滤');
                return false;
              }
            }
          }
        }
      }
    }

    // 🔧 添加到过滤历史（确认可以执行ripgrep过滤之后）
    addToFilterHistory(filterText);

    // 显示加载状态
    const statusEl = document.getElementById('status');
    const filteredCountEl = document.getElementById('filteredCount');

    if (statusEl) statusEl.textContent = '⏳ ripgrep过滤中...';

    const startTime = performance.now();

    // 构建文件路径列表
    const files = currentFiles.map(f => f.path);
    console.log(`[Ripgrep Filter] 搜索 ${files.length} 个文件`);
    console.log(`[Ripgrep Filter] 文件列表:`, files);

    // 🔧 修复：直接使用原始关键词，ripgrep会自动处理空格
    // - ripgrep会把输入当作正则表达式
    // - 空格会匹配空格字符
    // - 例如："battery l" 只匹配 "battery l"，不会匹配 "batt_last"
    const rgPattern = filterText;

    // ⚡ 性能优化：添加 ripgrep 性能参数
    // 🚀 重要：动态调整匹配数量限制，防止内存溢出和渲染进程崩溃
    // 策略：根据文件数量动态调整每个文件的匹配数上限
    // 🚀 修复连续过滤崩溃：大幅降低上限，确保总结果数 < 1 万条
    const fileCount = files.length;
    let maxMatchesPerFile;

    if (fileCount <= 5) {
      maxMatchesPerFile = 2000;   // 少文件：每文件 2 千条 → 最多 1 万条 (降低 60%)
    } else if (fileCount <= 10) {
      maxMatchesPerFile = 1000;   // 中等文件：每文件 1 千条 → 最多 1 万条 (降低 50%)
    } else if (fileCount <= 20) {
      maxMatchesPerFile = 500;    // 多文件：每文件 5 百条 → 最多 1 万条 (降低 50%)
    } else if (fileCount <= 30) {
      maxMatchesPerFile = 300;    // 超多文件：每文件 3 百条 → 最多 9 千条 (降低 40%)
    } else {
      maxMatchesPerFile = 100;    // 极多文件：每文件 1 百条
    }

    const estimatedTotalMatches = fileCount * maxMatchesPerFile;
    console.log(`[Ripgrep Filter] 文件数: ${fileCount}，每文件限制: ${maxMatchesPerFile} 条，预估总数: ~${estimatedTotalMatches} 条`);

    const args = [
      rgPattern,
      '--line-number',
      '--with-filename',
      '--no-heading',
      '-n',
      '--color', 'never',
      '-a',                 // 🔧 将二进制文件视为文本（强制搜索 .DAT 等文件）
      '--no-config',        // ⚡ 跳过配置文件加载
      '--mmap',             // ⚡ 使用内存映射（在某些系统上更快）
      '--encoding', 'utf-8', // ⚡ 明确编码，避免检测
      `--max-count=${maxMatchesPerFile}`,  // 🚀 限制每个文件的匹配数，防止内存溢出
    ];

    args.push('--');
    args.push(...files);

    console.log('[Ripgrep Filter] 原始关键词:', filterText);
    console.log('[Ripgrep Filter] rgPattern:', rgPattern);
    console.log('[Ripgrep Filter] 执行命令: rg.exe', args.slice(0, 5).join(' '), '...');
    console.log('[Ripgrep Filter] 完整参数:', args);

    // ⏱️ 记录 ripgrep 执行时间
    const rgStartTime = performance.now();

    // 调用 rg（ripgrep 内部已经多线程优化，单进程即可）
    const result = await window.electronAPI.callRG({
      execPath: './rg.exe',
      args: args
    });

    const rgElapsed = performance.now() - rgStartTime;
    console.log(`[Ripgrep Filter] ⏱️ ripgrep 执行耗时: ${rgElapsed.toFixed(2)}ms (单进程，ripgrep 内部并行)`);

    console.log('[Ripgrep Filter] 执行结果 success:', result.success);
    if (!result.success) {
      console.error('[Ripgrep Filter] 执行失败 error:', result.error);
      console.error('[Ripgrep Filter] 执行失败 stderr:', result.stderr);
      throw new Error(result.error || 'ripgrep 执行失败');
    }

    // 🚀 安全检查：检测输出大小，防止内存溢出
    const outputSize = result.stdout ? result.stdout.length : 0;
    console.log('[Ripgrep Filter] 输出长度:', outputSize);

    if (outputSize > 100 * 1024 * 1024) {  // > 100MB
      console.warn(`[Ripgrep Filter] ⚠️ 输出数据过大 (${(outputSize / 1024 / 1024).toFixed(2)}MB)，可能导致内存问题`);
      showMessage(`⚠️ 搜索结果过多，已限制每个文件最多 ${maxMatchesPerFile} 条匹配。请尝试更精确的关键词。`);
    } else if (outputSize > 50 * 1024 * 1024) {  // > 50MB
      console.warn(`[Ripgrep Filter] ⚠️ 输出数据较大 (${(outputSize / 1024 / 1024).toFixed(2)}MB)`);
    }

    console.log('[Ripgrep Filter] stderr:', result.stderr);

    // 🔧 调试：显示前500字符的原始输出
    if (result.stdout && result.stdout.length > 0) {
      console.log('[Ripgrep Filter] 原始输出前500字符:', result.stdout.substring(0, 500));
    }

    // ⚡ 性能优化：构建文件路径到 fileHeader 的映射缓存
    // 这样可以将 O(n) 的查找变成 O(1)，对于 13 万个匹配可以节省大量时间
    const filePathToHeaderMap = new Map();
    const fileHeadersArray = [];  // 用于传递给 Worker
    for (let i = 0; i < fileHeaders.length; i++) {
      const header = fileHeaders[i];
      if (header && header.filePath) {
        filePathToHeaderMap.set(header.filePath, header);
        filePathToHeaderMap.set(header.fileName, header);
        fileHeadersArray.push({
          filePath: header.filePath,
          fileName: header.fileName,
          startIndex: header.startIndex
        });
      }
    }
    console.log(`[Ripgrep Filter] 已构建 ${filePathToHeaderMap.size} 个文件路径缓存`);

    // 🔧 统一换行符
    const normalizedOutput = result.stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 🚀 安全检查：如果输出仍然太大，拒绝处理
    const lineCount = normalizedOutput.split('\n').length;
    console.log(`[Ripgrep Filter] 解析行数: ${lineCount}`);

    if (lineCount > 500000) {  // 超过 50 万行
      const errorMsg = `搜索结果过多（${lineCount.toLocaleString()} 行），已超出处理限制。请使用更精确的关键词。`;
      console.error(`[Ripgrep Filter] ${errorMsg}`);
      showMessage(`⚠️ ${errorMsg}`);

      // 清空过滤面板，显示错误信息
      const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
      if (filteredPanelVirtualContent) {
        filteredPanelVirtualContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">搜索结果过多，请使用更精确的关键词</div>';
      }
      return;  // 终止处理
    }

    // 🚀 使用 Worker 池并行解析（最多 9 个 Workers）
    const parseStartTime = performance.now();
    const { matches, errors } = await parseRipgrepOutputParallel(normalizedOutput, fileHeadersArray);
    const parseElapsed = performance.now() - parseStartTime;

    console.log(`[Ripgrep Filter] Worker 池并行解析完成: ${matches.length} 个匹配, 耗时 ${parseElapsed.toFixed(2)}ms`);
    if (errors.length > 0) {
      console.warn(`[Ripgrep Filter] 解析过程中的 ${errors.length} 个错误已忽略`);
    }

    /* 旧的串行解析代码（已替换为并行版本）
    const matches = [];
    const lines = normalizedOutput.split('\n');
    console.log('[Ripgrep Filter] 分割后行数:', lines.length);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (!line || line.trim() === '') continue;

      // 🔧 使用智能字符串操作解析 rg 输出格式
      // rg 的输出格式：filePath:lineNumber:content
      // 需要处理 Windows 路径中的驱动器号（如 D:\）和内容中包含的冒号
      // 策略：找到路径后的第一个 "数字:" 模式作为行号

      // 查找第一个冒号的位置（用于分隔路径和行号）
      const firstColonIndex = line.indexOf(':');
      if (firstColonIndex === -1) {
        if (matches.length < 5) {
          console.warn('[Ripgrep Filter] 跳过无法解析的行（无冒号）:', line.substring(0, 150));
        }
        continue;
      }

      // 检查是否是 Windows 路径（驱动器号格式，如 "D:"）
      const isWindowsPath = firstColonIndex === 1 && line.length > 2 && line[1] === ':' &&
                             ((line[0] >= 'A' && line[0] <= 'Z') || (line[0] >= 'a' && line[0] <= 'z'));

      let filePathEndIndex;

      if (isWindowsPath) {
        // Windows 路径：格式为 "D:\path:123:content" 或 "D:\path\file.txt:123:content"
        // 需要跳过驱动器号后的第一个冒号，找到下一个冒号（行号前的冒号）
        const afterDriveColon = line.indexOf(':', firstColonIndex + 1);
        if (afterDriveColon === -1) {
          if (matches.length < 5) {
            console.warn('[Ripgrep Filter] 跳过无法解析的行（Windows路径但只有一个冒号）:', line.substring(0, 150));
          }
          continue;
        }
        filePathEndIndex = afterDriveColon;
      } else {
        // 非 Windows 路径：第一个冒号就是路径结束
        filePathEndIndex = firstColonIndex;
      }

      // 从 filePathEndIndex + 1 开始，查找 "数字:" 模式
      // 这是行号的开始位置
      let lineNumberStart = -1;

      for (let i = filePathEndIndex + 1; i < line.length; i++) {
        // 检查是否是数字开头
        if (line[i] >= '0' && line[i] <= '9') {
          // 找到数字序列的结束位置
          let j = i;
          while (j < line.length && line[j] >= '0' && line[j] <= '9') {
            j++;
          }

          // 检查数字后面是否跟着冒号
          if (j < line.length && line[j] === ':') {
            lineNumberStart = i;
            break;
          }

          // 如果不是，继续搜索
          i = j;
        }
      }

      if (lineNumberStart === -1) {
        if (matches.length < 5) {
          console.warn('[Ripgrep Filter] 跳过无法解析的行（找不到数字:行号模式）:', line.substring(0, 150));
        }
        continue;
      }

      // 找到行号后的冒号位置
      const lineNumberEndColon = line.indexOf(':', lineNumberStart);
      const filePath = line.substring(0, filePathEndIndex);
      const lineNumberStr = line.substring(lineNumberStart, lineNumberEndColon);
      const content = line.substring(lineNumberEndColon + 1);

      // 再次验证行号是否为纯数字
      if (!/^\d+$/.test(lineNumberStr)) {
        if (matches.length < 5) {
          console.warn('[Ripgrep Filter] 跳过无法解析的行（行号验证失败）:', line.substring(0, 150));
        }
        continue;
      }

      const lineNumber = parseInt(lineNumberStr, 10);

      matches.push({
        filePath,
        lineNumber,
        content
      });
    }

    console.log(`[Ripgrep Filter] 找到 ${matches.length} 个匹配`);
    */

    // 转换为 originalLines 的索引
    // Worker 已经返回了 originalIndex 和 content，直接使用
    const mapStartTime = performance.now();
    const filteredToOriginalIndex = [];
    const filteredLines = [];

    for (const match of matches) {
      if (match.originalIndex >= 0 && match.originalIndex < originalLines.length) {
        filteredToOriginalIndex.push(match.originalIndex);
        // 使用 Worker 返回的 content，或者从 originalLines 获取
        filteredLines.push(match.content || originalLines[match.originalIndex]);
      }
    }

    console.log(`[Ripgrep Filter] 映射成功: ${filteredToOriginalIndex.length} / ${matches.length}`);

    // 按原始索引排序（Worker 并行处理的结果可能是乱序的）
    const combined = filteredToOriginalIndex.map((idx, i) => ({
      index: idx,
      line: filteredLines[i]
    }));
    combined.sort((a, b) => a.index - b.index);

    // 🚀 去重：根据 index 去除重复项（相同行号的重复结果）
    const uniqueCombined = [];
    const seenIndices = new Set();
    for (const item of combined) {
      if (!seenIndices.has(item.index)) {
        seenIndices.add(item.index);
        uniqueCombined.push(item);
      }
    }

    const duplicatesCount = combined.length - uniqueCombined.length;
    if (duplicatesCount > 0) {
      console.log(`[Ripgrep Filter] 去重: 移除 ${duplicatesCount} 个重复项`);
    }

    // 🚀 添加文件头：在去重后的结果中插入文件头
    const resultWithHeaders = [];
    let lastFileStartIndex = -1;

    for (const item of uniqueCombined) {
      const originalIndex = item.index;

      // 查找这个行所属的文件头
      for (const header of fileHeaders) {
        if (originalIndex >= header.startIndex && originalIndex < header.startIndex + header.lineCount + 1) {
          // 检查是否需要插入文件头（当切换到新文件时）
          if (header.startIndex !== lastFileStartIndex) {
            // 插入文件头
            const headerLine = `=== 文件: ${header.fileName} (${header.lineCount} 行)${header.filePath ? ' data-path="' + header.filePath + '"' : ''} ===`;
            resultWithHeaders.push({
              index: header.startIndex,
              line: headerLine
            });
            lastFileStartIndex = header.startIndex;
          }
          break;
        }
      }

      // 添加实际的匹配行
      resultWithHeaders.push(item);
    }

    const sortedIndices = resultWithHeaders.map(x => x.index);
    const sortedLines = resultWithHeaders.map(x => x.line);

    // 🚀 修复连续过滤内存泄漏：添加硬性限制，防止内存溢出
    // 如果结果超过 15000 条，主动截断并警告用户
    const MAX_FILTER_RESULTS = 15000;
    let wasTruncated = false;

    if (sortedIndices.length > MAX_FILTER_RESULTS) {
      console.warn(`[Ripgrep Filter] 结果过多 (${sortedIndices.length} 条)，截断到 ${MAX_FILTER_RESULTS} 条以防止内存溢出`);

      // 截断数组
      sortedIndices.length = MAX_FILTER_RESULTS;
      sortedLines.length = MAX_FILTER_RESULTS;
      wasTruncated = true;
    }

    // 🚀 修复连续过滤内存泄漏：清理中间数组
    // 这些大数组不再需要，显式清空帮助垃圾回收
    // 注意：const 声明的数组可以清空内容，但不能重新赋值
    resultWithHeaders.length = 0;  // 清空 resultWithHeaders 数组
    uniqueCombined.length = 0;  // 清空 uniqueCombined 数组
    combined.length = 0;  // 清空 combined 数组
    filteredToOriginalIndex.length = 0;  // 清空 filteredToOriginalIndex 数组
    filteredLines.length = 0;  // 清空 filteredLines 数组

    const mapElapsed = performance.now() - mapStartTime;
    console.log(`[Ripgrep Filter] ⏱️ 映射+排序耗时: ${mapElapsed.toFixed(2)}ms`);

    // 更新过滤状态
    currentFilter = {
      filteredLines: sortedLines,
      filteredToOriginalIndex: sortedIndices,
      filterKeywords: filterText.split('|').map(k => k.trim()).filter(k => k),
      totalLines: sortedLines.length
    };

    // 更新过滤面板
    // 🚀 修复连续过滤内存泄漏：先显式清空旧数组，释放内存
    if (Array.isArray(filteredPanelAllLines)) {
      filteredPanelAllLines.length = 0;
    }
    if (Array.isArray(filteredPanelAllOriginalIndices)) {
      filteredPanelAllOriginalIndices.length = 0;
    }
    if (Array.isArray(filteredPanelAllPrimaryIndices)) {
      filteredPanelAllPrimaryIndices.length = 0;
    }

    filteredPanelAllLines = sortedLines;
    filteredPanelAllOriginalIndices = sortedIndices;
    filteredPanelAllPrimaryIndices = [];

    // 🚀 性能优化：预计算文件头索引集合，避免每行都执行 startsWith 检查
    // 这确保了文件头能正确显示绿色背景
    fileHeaderIndices.clear();
    for (let i = 0; i < filteredPanelAllLines.length; i++) {
      if (filteredPanelAllLines[i] && filteredPanelAllLines[i].startsWith("=== 文件:")) {
        fileHeaderIndices.add(i);
      }
    }
    console.log(`[Ripgrep Filter] 预计算了 ${fileHeaderIndices.size} 个文件头索引`);

    // 🚀 修复连续过滤内存泄漏：清理高亮缓存
    // 每次过滤前清理 highlightCache，避免累积导致内存泄漏
    if (typeof highlightCache !== 'undefined' && highlightCache.clear) {
      highlightCache.clear();
      console.log('[Ripgrep Filter] 已清理高亮缓存，防止内存泄漏');
    }

    // 🔧 修复：清空主日志框的 HTML 解析缓存，确保过滤关键词不会在主日志框中高亮
    if (typeof clearHtmlParseCache === 'function') {
      clearHtmlParseCache();
      console.log('[Ripgrep Filter] 已清空主日志框 HTML 缓存，防止过滤关键词污染');
    }

    // 更新UI
    if (filteredCountEl) {
      filteredCountEl.textContent = sortedIndices.length.toString();
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    if (statusEl) {
      statusEl.textContent = `✓ ripgrep: ${sortedIndices.length}个匹配 (${elapsed}秒)`;
    }

    // 🔧 显示过滤耗时
    const filteredTimeEl = document.getElementById('filteredTime');
    if (filteredTimeEl) {
      const elapsedMs = (performance.now() - startTime);
      filteredTimeEl.textContent = elapsedMs >= 1000
        ? `(${(elapsedMs / 1000).toFixed(2)}s)`
        : `(${elapsedMs.toFixed(0)}ms)`;
    }

    // 更新占位符高度
    const filteredPanelPlaceholder = DOMCache.get('filteredPanelPlaceholder');
    if (filteredPanelPlaceholder) {
      filteredPanelPlaceholder.style.height = (sortedIndices.length * filteredPanelLineHeight) + 'px';
    }

    // 清空虚拟内容
    // 🚀 性能优化：使用 DOM 缓存
    const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
    if (filteredPanelVirtualContent) {
      // 🚀 修复连续过滤内存泄漏：强制清理 DOM 节点
      // 先移除所有子节点，释放内存
      while (filteredPanelVirtualContent.firstChild) {
        const child = filteredPanelVirtualContent.firstChild;
        filteredPanelVirtualContent.removeChild(child);
      }
      filteredPanelVirtualContent.innerHTML = '';
    }

    // 🔧 修复：重置虚拟滚动状态，确保重复过滤时不会因范围相同而跳过渲染
    filteredPanelVisibleStart = -1;
    filteredPanelVisibleEnd = -1;
    filteredPanelScrollPosition = 0;
    if (filteredPanelContent) {
      filteredPanelContent.scrollTop = 0;
    }

    // 🚀 性能优化：分批渲染，彻底避免黑屏
    // 策略：
    // 1. 先立即显示无高亮的纯文本（快速响应）
    // 2. 然后在多个 requestAnimationFrame 中分批应用高亮
    const resultCount = sortedIndices.length;
    console.log(`[Ripgrep Filter] 准备渲染 ${resultCount} 条结果`);

    // 标记：首次渲染（无高亮）
    let isFirstRender = true;

    // 分批渲染函数
    const renderBatch = () => {
      if (typeof updateFilteredPanelVisibleLines === 'function') {
        // 强制跳过高亮（首次渲染）
        if (isFirstRender) {
          console.log(`[Ripgrep Filter] 首次渲染：无高亮，纯文本模式`);
          isFirstRender = false;

          // 临时禁用所有高亮
          const originalFilterKeywords = currentFilter.filterKeywords;
          const originalSearchKeyword = filteredPanelSearchKeyword;
          // 🔧 修复：保存完整的 customHighlights 数组内容并恢复，避免永久丢失用户的高亮设置
          const originalCustomHighlights = [...customHighlights];

          currentFilter.filterKeywords = [];  // 禁用主关键词高亮
          filteredPanelSearchKeyword = '';     // 禁用搜索高亮
          customHighlights.length = 0;         // 清空自定义高亮数组（const不能重新赋值）

          // 渲染无高亮版本
          updateFilteredPanelVisibleLines();

          // 恢复高亮设置
          currentFilter.filterKeywords = originalFilterKeywords;
          filteredPanelSearchKeyword = originalSearchKeyword;
          // 🔧 恢复 customHighlights 数组内容
          customHighlights.length = 0;
          originalCustomHighlights.forEach(h => customHighlights.push(h));

          // 延迟应用高亮（在下一帧）
          requestAnimationFrame(() => {
            console.log(`[Ripgrep Filter] 二次渲染：应用高亮`);
            updateFilteredPanelVisibleLines();
          });
        } else {
          // 正常渲染（有高亮）
          updateFilteredPanelVisibleLines();
        }
      }
    };

    if (resultCount > 1000) {
      // 大量结果：延迟后分批渲染
      setTimeout(() => {
        requestAnimationFrame(renderBatch);
      }, 50);
    } else {
      // 小量结果：立即渲染
      renderBatch();
    }

    // 🔧 显示过滤面板（立即显示，不等待渲染完成）
    if (typeof filteredPanel !== 'undefined') {
      filteredPanel.classList.add('visible');

      // 🚀 修复白板问题（包括第二次过滤）：确保在面板显示后重新渲染内容
      // 使用双重 requestAnimationFrame 确保 DOM 已完全更新
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (typeof updateFilteredPanelVisibleLines === 'function') {
            updateFilteredPanelVisibleLines();

            // 🚀 跳转到用户之前点击的行
            // 优先使用过滤面板中点击记录的行，其次使用主日志框中选中的行
            let targetOriginalIndex = -1;

            // 优先级1: 过滤面板中点击的行
            if (typeof lastClickedOriginalIndex !== 'undefined' && lastClickedOriginalIndex >= 0) {
              targetOriginalIndex = lastClickedOriginalIndex;
              console.log(`[Ripgrep Filter] 使用过滤面板点击行: lastClickedOriginalIndex=${lastClickedOriginalIndex}`);
            } else {
              // 优先级2: 主日志框中选中的行
              const outerContainer = DOMCache.get('outerContainer');
              const selectedLine = outerContainer ? outerContainer.querySelector('.log-line.selected') : null;

              if (selectedLine) {
                targetOriginalIndex = parseInt(selectedLine.dataset.index, 10);
                console.log(`[Ripgrep Filter] 使用主日志框选中行: selectedOriginalIndex=${targetOriginalIndex}`);
              }
            }

            console.log(`[Ripgrep Filter] 目标原始索引: targetOriginalIndex=${targetOriginalIndex}, filteredPanelAllOriginalIndices.length=${filteredPanelAllOriginalIndices.length}`);

            if (targetOriginalIndex >= 0) {

              // 打印前 5 个过滤结果的索引，用于调试
              console.log(`[Ripgrep Filter] 过滤结果前5个索引:`, filteredPanelAllOriginalIndices.slice(0, 5));
              console.log(`[Ripgrep Filter] 过滤结果后5个索引:`, filteredPanelAllOriginalIndices.slice(-5));

              // 在过滤结果中查找该行
              let filteredIndex = filteredPanelAllOriginalIndices.indexOf(targetOriginalIndex);
              console.log(`[Ripgrep Filter] 在过滤结果中的位置: filteredIndex=${filteredIndex}`);

              if (filteredIndex < 0) {
                // 🚀 如果没找到精确匹配，找到原始行号最接近的行
                console.log(`[Ripgrep Filter] 📍 目标行不在结果中，使用原始行号查找最接近的行...`);

                // 使用二分查找找到插入位置
                let left = 0;
                let right = filteredPanelAllOriginalIndices.length - 1;
                while (left <= right) {
                  const mid = Math.floor((left + right) / 2);
                  if (filteredPanelAllOriginalIndices[mid] < targetOriginalIndex) {
                    left = mid + 1;
                  } else {
                    right = mid - 1;
                  }
                }

                // left 是应该插入的位置，比较 left 和 left-1 哪个更接近
                if (left >= filteredPanelAllOriginalIndices.length) {
                  // 目标行比所有结果都大，使用最后一个
                  filteredIndex = filteredPanelAllOriginalIndices.length - 1;
                } else if (left === 0) {
                  // 目标行比所有结果都小，使用第一个
                  filteredIndex = 0;
                } else {
                  // 比较左右两个哪个更接近
                  const diffLeft = Math.abs(filteredPanelAllOriginalIndices[left - 1] - targetOriginalIndex);
                  const diffRight = Math.abs(filteredPanelAllOriginalIndices[left] - targetOriginalIndex);
                  filteredIndex = diffLeft <= diffRight ? left - 1 : left;
                }

                const closestOriginalIndex = filteredPanelAllOriginalIndices[filteredIndex];
                console.log(`[Ripgrep Filter] ✓ 找到原始行号最接近的行: filteredIndex=${filteredIndex}, originalIndex=${closestOriginalIndex}, 距离=${Math.abs(closestOriginalIndex - targetOriginalIndex)}`);
              }

              // 跳转到目标行（精确匹配或相对位置）
              const targetScrollTop = filteredIndex * filteredPanelLineHeight;
              const containerHeight = filteredPanelContent.clientHeight;
              // 让目标行显示在页面中间
              const finalScrollTop = Math.max(0, targetScrollTop - containerHeight / 2 + filteredPanelLineHeight / 2);

              console.log(`[Ripgrep Filter] 准备跳转: targetScrollTop=${targetScrollTop}, finalScrollTop=${finalScrollTop}, containerHeight=${containerHeight}`);

              // 🔧 调试：检查滚动状态
              console.log(`[Ripgrep Filter] 跳转前: scrollTop=${filteredPanelContent.scrollTop}, scrollHeight=${filteredPanelContent.scrollHeight}, clientHeight=${filteredPanelContent.clientHeight}`);

              filteredPanelContent.scrollTop = finalScrollTop;
              console.log(`[Ripgrep Filter] ✓ 已设置 scrollTop: ${finalScrollTop}, 目标行: targetOriginalIndex=${targetOriginalIndex}, filteredIndex=${filteredIndex}`);

              // 🚀 等待虚拟滚动更新后，确保目标行被正确渲染和高亮
              // 使用更长的延迟确保 DOM 完全更新
              setTimeout(() => {
                // 🔧 调试：检查滚动是否成功
                console.log(`[Ripgrep Filter] 延迟后: scrollTop=${filteredPanelContent.scrollTop}, 期望值=${finalScrollTop}`);

                if (Math.abs(filteredPanelContent.scrollTop - finalScrollTop) > 100) {
                  console.error(`[Ripgrep Filter] ❌ 滚动位置不正确！可能被其他代码重置`);
                }

                // 再次触发虚拟滚动更新，确保目标行被渲染
                if (typeof updateFilteredPanelVisibleLines === 'function') {
                  updateFilteredPanelVisibleLines();
                }

                // 尝试查找并高亮目标行
                const targetLine = filteredPanelVirtualContent.querySelector(`[data-filtered-index="${filteredIndex}"]`);
                if (targetLine) {
                  targetLine.classList.add('highlighted');
                  console.log(`[Ripgrep Filter] ✓ 已高亮目标行`);
                } else {
                  console.log(`[Ripgrep Filter] ⚠️ 目标行元素未找到，filteredIndex=${filteredIndex}`);
                }
              }, 100);
            } else {
              console.log(`[Ripgrep Filter] 没有找到选中的行，将从顶部开始显示`);
            }
          }
        });
      });

      // 🔧 显示面板时自动隐藏文件树
      const fileTreeContainer = DOMCache.get('fileTreeContainer');
      const fileTreeCollapseBtn = DOMCache.get('fileTreeCollapseBtn');
      if (fileTreeContainer && fileTreeContainer.classList.contains('visible')) {
        fileTreeContainer.classList.remove('visible');
        if (fileTreeCollapseBtn) {
          fileTreeCollapseBtn.textContent = '▶';
          fileTreeCollapseBtn.style.display = 'none'; // 🔧 隐藏折叠按钮
        }
        // 🚀 记录文件树被过滤面板隐藏
        if (typeof fileTreeWasHiddenByFilter !== 'undefined') {
          fileTreeWasHiddenByFilter = true;
        }
        // 🚀 触发布局更新（重要！）
        if (typeof updateLayout === 'function') {
          updateLayout();
        }
        if (typeof updateButtonPosition === 'function') {
          updateButtonPosition();
        }
      }
    }

    // 🚀 修复连续过滤内存泄漏：尝试触发垃圾回收
    // 注意：gc() 仅在特定 Chrome 标志下可用（--js-flags="--expose-gc"）
    if (typeof gc !== 'undefined' && gc !== null) {
      console.log('[Ripgrep Filter] 尝试触发垃圾回收...');
      gc();
    }

    // 显示完成消息（如果有截断，添加警告）
    const message = wasTruncated
      ? `⚠️ ripgrep过滤完成: ${sortedIndices.length}个匹配 (结果已截断，耗时${elapsed}秒)`
      : `ripgrep过滤完成: ${sortedIndices.length}个匹配 (耗时${elapsed}秒)`;
    showMessage(message);
    console.log(`[Ripgrep Filter] ✓ 完成: ${sortedIndices.length} 个匹配，耗时 ${elapsed}秒`);

    // 🆕 每次过滤后自动最大化过滤面板
    if (!isFilterPanelMaximized && typeof toggleFilterPanelMaximize === 'function') {
      console.log('[Ripgrep Filter] 自动最大化过滤面板');
      toggleFilterPanelMaximize();
    }

  } catch (error) {
    console.error('[Ripgrep Filter] 过滤失败:', error);
    showMessage(`ripgrep过滤失败: ${error.message}，使用原有方法`);
    // 降级到原有过滤方法
    // 这里不重新调用，避免无限循环
  }
}

/**
 * 查找文件对应的原始索引（ripgrep 版本）
 */
function findOriginalIndexForFileInRipgrep(filePath, lineNumber) {
  if (typeof fileHeaders === 'undefined') {
    console.error('[findOriginalIndexForFileInRipgrep] fileHeaders is undefined!');
    return -1;
  }

  const fileName = filePath.split(/[/\\]/).pop();

  for (let i = 0; i < fileHeaders.length; i++) {
    const header = fileHeaders[i];

    if (!header) continue;

    // 优先匹配完整路径（如果有）
    if (header.filePath && header.filePath === filePath) {
      const result = header.startIndex + lineNumber;
      return result;
    }

    // 匹配文件名
    if (header.fileName === fileName) {
      const result = header.startIndex + lineNumber;
      return result;
    }

    // 包含匹配：处理 "path/to/file.txt" 和 "file.txt" 的情况
    if (header.fileName) {
      const headerFileName = header.fileName.split(/[/\\]/).pop();
      if (headerFileName === fileName) {
        const result = header.startIndex + lineNumber;
        return result;
      }
    }
  }

  return -1;
}

/**
 * 生成数组的所有排列组合
 * @param {Array} arr - 输入数组
 * @returns {Array} - 所有排列的数组
 */
function getPermutations(arr) {
  if (arr.length <= 1) return [arr];

  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = arr.slice(0, i).concat(arr.slice(i + 1));
    const remainingPermutations = getPermutations(remaining);

    for (const perm of remainingPermutations) {
      result.push([current].concat(perm));
    }
  }

  return result;
}

/**
 * 🚀 使用 ripgrep 从文件列表中异步过滤（过滤模式专用）
 * @param {string} filterText - 过滤关键词
 * @param {Array<string>} filePaths - 文件路径列表
 */
async function applyFilterWithRipgrepOnFiles(filterText, filePaths) {
  try {
    console.log(`[过滤模式] ========== 开始过滤 ==========`);
    console.log(`[过滤模式] 文件数量: ${filePaths.length}`);
    console.log(`[过滤模式] 过滤关键词: "${filterText}"`);
    console.log(`[过滤模式] 前3个文件:`, filePaths.slice(0, 3));

    // 显示加载状态
    const statusEl = document.getElementById('status');
    const filteredCountEl = document.getElementById('filteredCount');

    if (statusEl) statusEl.textContent = '⏳ ripgrep过滤中...';

    const startTime = performance.now();

    // 清空之前的过滤数据
    cleanFilterData();

    // 如果过滤文本为空，直接返回
    if (!filterText.trim()) {
      console.log(`[过滤模式] 过滤文本为空，直接返回`);
      if (statusEl) statusEl.textContent = '';
      return;
    }

    // 🔧 过滤模式：验证所有文件都是普通磁盘文件（不应该包含压缩包文件）
    // 如果包含压缩包文件，说明筛选逻辑有问题，记录警告并跳过这些文件
    const archivePatterns = [
      /\.(zip|tar|gz|7z|rar|bz2):/i,    // Unix格式: archive.zip:internal/path
      /\.(zip|tar|gz|7z|rar|bz2)[\/\\]/i  // Windows格式: archive.zip\internal\path
    ];

    const hasArchiveFiles = filePaths.some(path => {
      return archivePatterns.some(pattern => pattern.test(path));
    });

    if (hasArchiveFiles) {
      console.warn(`[过滤模式] 警告：文件列表中包含压缩包文件，过滤模式不应该处理压缩包文件！`);
      // 🔧 重要：过滤模式不应该处理压缩包文件，因为压缩包内容需要先解压才能用ripgrep搜索
      // 如果出现这种情况，说明调用方有问题，需要返回错误
      console.error(`[过滤模式] 错误：filterModeFileList 不应包含压缩包文件！`);
      return {
        success: false,
        error: '过滤模式不支持压缩包文件'
      };
    }

    // 🔧 添加到过滤历史（确认所有检查通过之后）
    addToFilterHistory(filterText);

    // 🔧 修复：直接使用原始关键词，ripgrep会自动处理空格
    // - ripgrep会把输入当作正则表达式
    // - 空格会匹配空格字符
    // - 例如："battery l" 只匹配 "battery l"，不会匹配 "batt_last"
    const rgPattern = filterText;

    console.log('[过滤模式] 原始关键词:', filterText);
    console.log('[过滤模式] rgPattern:', rgPattern);

    const args = [
      rgPattern,
      '--line-number',
      '--with-filename',
      '--no-heading',
      '-n',
      '--color', 'never',
      '-a',                 // 🔧 将二进制文件视为文本（强制搜索 .DAT 等文件）
    ];

    args.push('--');
    args.push(...filePaths);

    console.log('[过滤模式] 执行命令: rg.exe', args.slice(0, 5).join(' '), '... (共 ' + args.length + ' 个参数)');

    // 调用 rg
    const result = await window.electronAPI.callRG({
      execPath: './rg.exe',
      args: args
    });

    console.log('[过滤模式] rg 执行完成, success:', result.success);
    if (!result.success) {
      console.error('[过滤模式] rg 错误:', result.error);
    } else {
      console.log('[过滤模式] rg 输出长度:', result.stdout ? result.stdout.length : 0);
      console.log('[过滤模式] rg stderr:', result.stderr);
    }

    if (!result.success) {
      throw new Error(result.error || 'ripgrep 执行失败');
    }

    // 解析结果
    const matches = [];
    const lines = result.stdout.trim().split('\n');

    console.log(`[过滤模式] 解析结果，总行数: ${lines.length}`);

    // 🔧 调试：显示前5行原始输出
    console.log(`[过滤模式] 前5行原始输出:`);
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      console.log(`[过滤模式]   ${i + 1}: ${lines[i].substring(0, 200)}`);
    }

    for (const line of lines) {
      if (!line) continue;

      // 🔧 使用智能字符串操作解析 rg 输出格式
      // rg 的输出格式：filePath:lineNumber:content
      // 需要处理 Windows 路径中的驱动器号（如 F:\）和内容中包含的冒号
      // 策略：找到路径后的第一个 "数字:" 模式作为行号

      // 查找第一个冒号的位置（用于分隔路径和行号）
      const firstColonIndex = line.indexOf(':');
      if (firstColonIndex === -1) {
        if (matches.length < 5) {
          console.log(`[过滤模式] 跳过无法解析的行（无冒号）: ${line.substring(0, 150)}`);
        }
        continue;
      }

      // 检查是否是 Windows 路径（驱动器号格式，如 "F:"）
      const isWindowsPath = firstColonIndex === 1 && line.length > 2 && line[1] === ':' &&
                             ((line[0] >= 'A' && line[0] <= 'Z') || (line[0] >= 'a' && line[0] <= 'z'));

      let filePathEndIndex;

      if (isWindowsPath) {
        // Windows 路径：格式为 "F:\path:123:content" 或 "F:\path\file.txt:123:content"
        // 需要跳过驱动器号后的第一个冒号，找到下一个冒号（行号前的冒号）
        const afterDriveColon = line.indexOf(':', firstColonIndex + 1);
        if (afterDriveColon === -1) {
          if (matches.length < 5) {
            console.log(`[过滤模式] 跳过无法解析的行（Windows路径但只有一个冒号）: ${line.substring(0, 150)}`);
          }
          continue;
        }
        filePathEndIndex = afterDriveColon;
      } else {
        // 非 Windows 路径：第一个冒号就是路径结束
        filePathEndIndex = firstColonIndex;
      }

      // 从 filePathEndIndex + 1 开始，查找 "数字:" 模式
      // 这是行号的开始位置
      let lineNumberStart = -1;

      for (let i = filePathEndIndex + 1; i < line.length; i++) {
        // 检查是否是数字开头
        if (line[i] >= '0' && line[i] <= '9') {
          // 找到数字序列的结束位置
          let j = i;
          while (j < line.length && line[j] >= '0' && line[j] <= '9') {
            j++;
          }

          // 检查数字后面是否跟着冒号
          if (j < line.length && line[j] === ':') {
            lineNumberStart = i;
            break;
          }

          // 如果不是，继续搜索
          i = j;
        }
      }

      if (lineNumberStart === -1) {
        if (matches.length < 5) {
          console.log(`[过滤模式] 跳过无法解析的行（找不到数字:行号模式）: ${line.substring(0, 150)}`);
        }
        continue;
      }

      // 找到行号后的冒号位置
      const lineNumberEndColon = line.indexOf(':', lineNumberStart);
      const filePath = line.substring(0, filePathEndIndex);
      const lineNumberStr = line.substring(lineNumberStart, lineNumberEndColon);
      const content = line.substring(lineNumberEndColon + 1);

      // 再次验证行号是否为纯数字
      if (!/^\d+$/.test(lineNumberStr)) {
        if (matches.length < 5) {
          console.log(`[过滤模式] 跳过无法解析的行（行号验证失败）: ${line.substring(0, 150)}`);
        }
        continue;
      }

      const lineNumber = parseInt(lineNumberStr, 10);

      matches.push({
        filePath,
        lineNumber,
        content
      });
    }

    console.log(`[过滤模式] 解析完成，找到 ${matches.length} 个匹配`);

    // 🔧 调试：显示前3个匹配
    if (matches.length > 0) {
      console.log('[过滤模式] 第一个匹配:', matches[0]);
      console.log('[过滤模式] 第二个匹配:', matches[1]);
      console.log('[过滤模式] 第三个匹配:', matches[2]);
    }

    // 🚀 直接构建过滤面板的数据（不依赖 originalLines）
    const filteredLines = [];
    const filteredToOriginalIndex = []; // 在过滤模式下，这只是虚拟索引
    let originalIndexCounter = 0;

    if (matches.length === 0) {
      // 🔧 没有匹配时也要显示过滤面板，并给出提示
      console.log(`[过滤模式] 没有找到匹配项`);

      // 更新过滤面板数据为空数组
      if (typeof filteredPanelAllLines !== 'undefined') {
        filteredPanelAllLines = [];
        filteredPanelAllOriginalIndices = [];
      }

      // 🚀 清空文件头索引
      fileHeaderIndices.clear();

      // 🚀 修复连续过滤内存泄漏：清理高亮缓存
      if (typeof highlightCache !== 'undefined' && highlightCache.clear) {
        highlightCache.clear();
        console.log('[过滤模式] 已清理高亮缓存（空结果）');
      }

      // 显示结果
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      if (filteredCountEl) {
        filteredCountEl.textContent = '0';
      }
      if (statusEl) statusEl.textContent = '';

      // 计算占位符高度（0行）
      const filteredPanelPlaceholder = DOMCache.get('filteredPanelPlaceholder');
      if (filteredPanelPlaceholder) {
        filteredPanelPlaceholder.style.height = '0px';
      }

      // 清空虚拟内容
      const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
      if (filteredPanelVirtualContent) {
        filteredPanelVirtualContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">没有找到匹配的内容</div>';
      }

      // 显示过滤面板
      if (typeof filteredPanel !== 'undefined') {
        filteredPanel.classList.add('visible');

        // 🚀 修复白板问题（包括第二次过滤）：确保内容正确显示
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // 强制重新渲染虚拟内容
            const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
            if (filteredPanelVirtualContent) {
              const currentContent = filteredPanelVirtualContent.innerHTML;
              filteredPanelVirtualContent.innerHTML = currentContent;
            }
          });
        });

        // 🔧 显示面板时自动隐藏文件树
        const fileTreeContainer = DOMCache.get('fileTreeContainer');
        const fileTreeCollapseBtn = DOMCache.get('fileTreeCollapseBtn');
        if (fileTreeContainer && fileTreeContainer.classList.contains('visible')) {
          fileTreeContainer.classList.remove('visible');
          if (fileTreeCollapseBtn) {
            fileTreeCollapseBtn.textContent = '▶';
            fileTreeCollapseBtn.style.display = 'none'; // 🔧 隐藏折叠按钮
          }
          // 🚀 记录文件树被过滤面板隐藏
          if (typeof fileTreeWasHiddenByFilter !== 'undefined') {
            fileTreeWasHiddenByFilter = true;
          }
          // 🚀 触发布局更新（重要！）
          if (typeof updateLayout === 'function') {
            updateLayout();
          }
          if (typeof updateButtonPosition === 'function') {
            updateButtonPosition();
          }
        }
      }

      // 🔧 设置 currentFilter 以支持二级过滤
      if (typeof currentFilter !== 'undefined') {
        currentFilter = {
          filteredLines: [],
          filteredToOriginalIndex: [],
          filterKeywords: filterText.split('|').map(k => k.trim()).filter(k => k),
          totalLines: 0
        };
        console.log('[过滤模式] currentFilter 已设置（空结果）');
      }

      showMessage(`🔍 过滤完成：没有找到匹配项 (耗时 ${elapsed}秒)`);
      console.log(`[过滤模式] ✓ 完成: 0 个匹配，耗时 ${elapsed}秒`);
      return;
    }

    // 按文件分组
    const matchesByFile = {};
    for (const match of matches) {
      if (!matchesByFile[match.filePath]) {
        matchesByFile[match.filePath] = [];
      }
      matchesByFile[match.filePath].push(match);
    }

    // 🔧 按照 filePaths 的顺序遍历文件（用户选中文件的顺序）
    for (const filePath of filePaths) {
      const fileMatches = matchesByFile[filePath];
      // 跳过没有匹配的文件
      if (!fileMatches || fileMatches.length === 0) continue;

      const fileName = filePath.split(/[/\\]/).pop();

      // 添加文件头
      filteredLines.push(`=== 文件: ${fileName} (${fileMatches.length} 个匹配) ===`);
      filteredToOriginalIndex.push(originalIndexCounter++);

      // 添加匹配的行
      for (const match of fileMatches) {
        filteredLines.push(match.content);
        filteredToOriginalIndex.push(originalIndexCounter++);
      }
    }

    // 更新过滤面板数据
    if (typeof filteredPanelAllLines !== 'undefined') {
      filteredPanelAllLines = filteredLines;
      filteredPanelAllOriginalIndices = filteredToOriginalIndex;
    }

    // 🚀 性能优化：预计算文件头索引集合，避免每行都执行 startsWith 检查
    // 这确保了文件头能正确显示绿色背景
    fileHeaderIndices.clear();
    for (let i = 0; i < filteredPanelAllLines.length; i++) {
      if (filteredPanelAllLines[i] && filteredPanelAllLines[i].startsWith("=== 文件:")) {
        fileHeaderIndices.add(i);
      }
    }
    console.log(`[过滤模式] 预计算了 ${fileHeaderIndices.size} 个文件头索引`);

    // 🚀 修复连续过滤内存泄漏：清理高亮缓存
    if (typeof highlightCache !== 'undefined' && highlightCache.clear) {
      highlightCache.clear();
      console.log('[过滤模式] 已清理高亮缓存');
    }

    // 显示结果
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    if (filteredCountEl) {
      filteredCountEl.textContent = filteredLines.length;
    }
    if (statusEl) statusEl.textContent = '';

    // 计算占位符高度
    const filteredPanelPlaceholder = DOMCache.get('filteredPanelPlaceholder');
    if (filteredPanelPlaceholder) {
      filteredPanelPlaceholder.style.height = (filteredLines.length * filteredPanelLineHeight) + 'px';
    }

    // 清空虚拟内容
    // 🚀 性能优化：使用 DOM 缓存
    const filteredPanelVirtualContent = DOMCache.get('filteredPanelVirtualContent');
    if (filteredPanelVirtualContent) {
      // 🚀 修复连续过滤内存泄漏：强制清理 DOM 节点
      // 先移除所有子节点，释放内存
      while (filteredPanelVirtualContent.firstChild) {
        const child = filteredPanelVirtualContent.firstChild;
        filteredPanelVirtualContent.removeChild(child);
      }
      filteredPanelVirtualContent.innerHTML = '';
    }

    // 更新可见行
    if (typeof updateFilteredPanelVisibleLines === 'function') {
      updateFilteredPanelVisibleLines();
    }

    // 显示过滤面板
    if (typeof filteredPanel !== 'undefined') {
      filteredPanel.classList.add('visible');

      // 🚀 修复白板问题（包括第二次过滤）：确保内容正确显示
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (typeof updateFilteredPanelVisibleLines === 'function') {
            updateFilteredPanelVisibleLines();

            // 🚀 跳转到用户之前点击的行
            // 从主日志框中查找选中的行（.selected 类）
            const outerContainer = DOMCache.get('outerContainer');
            const selectedLine = outerContainer ? outerContainer.querySelector('.log-line.selected') : null;

            console.log(`[过滤模式] 查找选中行: outerContainer=${!!outerContainer}, selectedLine=${!!selectedLine}`);

            if (selectedLine) {
              // 获取选中行的原始索引
              const selectedOriginalIndex = parseInt(selectedLine.dataset.index, 10);
              console.log(`[过滤模式] 选中行原始索引: selectedOriginalIndex=${selectedOriginalIndex}, filteredPanelAllOriginalIndices.length=${filteredPanelAllOriginalIndices.length}`);

              if (!isNaN(selectedOriginalIndex) && selectedOriginalIndex >= 0) {
                // 在过滤结果中查找该行
                const filteredIndex = filteredPanelAllOriginalIndices.indexOf(selectedOriginalIndex);
                console.log(`[过滤模式] 在过滤结果中的位置: filteredIndex=${filteredIndex}`);

                if (filteredIndex >= 0) {
                  // 找到了，跳转到该行
                  const targetScrollTop = filteredIndex * filteredPanelLineHeight;
                  const containerHeight = filteredPanelContent.clientHeight;
                  // 让目标行显示在页面中间
                  const finalScrollTop = Math.max(0, targetScrollTop - containerHeight / 2 + filteredPanelLineHeight / 2);

                  console.log(`[过滤模式] 准备跳转: targetScrollTop=${targetScrollTop}, finalScrollTop=${finalScrollTop}`);

                  filteredPanelContent.scrollTop = finalScrollTop;
                  console.log(`[过滤模式] ✓ 已跳转到选中行: selectedOriginalIndex=${selectedOriginalIndex}, filteredIndex=${filteredIndex}`);
                } else {
                  console.log(`[过滤模式] ✗ 选中行不在过滤结果中: selectedOriginalIndex=${selectedOriginalIndex}`);
                }
              }
            } else {
              console.log(`[过滤模式] 没有找到选中的行，将从顶部开始显示`);
            }
          }
        });
      });

      // 🔧 显示面板时自动隐藏文件树
      const fileTreeContainer = DOMCache.get('fileTreeContainer');
      const fileTreeCollapseBtn = DOMCache.get('fileTreeCollapseBtn');
      if (fileTreeContainer && fileTreeContainer.classList.contains('visible')) {
        fileTreeContainer.classList.remove('visible');
        if (fileTreeCollapseBtn) {
          fileTreeCollapseBtn.textContent = '▶';
          fileTreeCollapseBtn.style.display = 'none'; // 🔧 隐藏折叠按钮
        }
        // 🚀 记录文件树被过滤面板隐藏
        if (typeof fileTreeWasHiddenByFilter !== 'undefined') {
          fileTreeWasHiddenByFilter = true;
        }
        // 🚀 触发布局更新（重要！）
        if (typeof updateLayout === 'function') {
          updateLayout();
        }
        if (typeof updateButtonPosition === 'function') {
          updateButtonPosition();
        }
      }
    }

    // 🔧 设置 currentFilter 以支持二级过滤
    if (typeof currentFilter !== 'undefined') {
      currentFilter = {
        filteredLines: filteredLines,
        filteredToOriginalIndex: filteredToOriginalIndex,
        filterKeywords: filterText.split('|').map(k => k.trim()).filter(k => k),
        totalLines: filteredLines.length
      };
      console.log('[过滤模式] currentFilter 已设置:', {
        filteredLines: filteredLines.length,
        filterKeywords: currentFilter.filterKeywords
      });
    }

    showMessage(`🔍 过滤完成: ${filteredLines.length} 个匹配 (耗时 ${elapsed}秒)`);
    console.log(`[过滤模式] ✓ 完成: ${filteredLines.length} 个匹配，耗时 ${elapsed}秒`);

  } catch (error) {
    console.error('[过滤模式] 过滤失败:', error);
    showMessage(`❌ 过滤失败: ${error.message}`);
  }
}

// =====================================================================
// 🔄 代码更新模块
// =====================================================================

/**
 * 获取更新服务器地址
 */
function getUpdateServerUrl() {
  // 从 localStorage 读取，如果没有则使用默认值
  let serverUrl = localStorage.getItem('updateServerUrl');
  if (!serverUrl) {
    // 默认服务器地址 - 请根据实际情况修改
    serverUrl = 'http://172.16.50.79:9000';
  }
  return serverUrl;
}

/**
 * 设置更新服务器地址
 */
function setUpdateServerUrl(url) {
  localStorage.setItem('updateServerUrl', url);
  showMessage(`✓ 服务器地址已设置为: ${url}`);
}

/**
 * 一键更新代码
 */
async function quickUpdateCode(event) {
  // Shift+点击：修改服务器地址
  if (event && event.shiftKey) {
    const newUrl = prompt('请输入更新服务器地址：', getUpdateServerUrl());
    if (newUrl && newUrl.trim()) {
      setUpdateServerUrl(newUrl.trim());
    }
    return;
  }

  const serverUrl = getUpdateServerUrl();
  const updateBtn = document.getElementById('updateCodeBtn');

  if (!updateBtn) return;

  // 禁用按钮，显示正在更新
  updateBtn.disabled = true;
  const originalText = updateBtn.textContent;
  updateBtn.textContent = '更新中...';

  try {
    // 直接更新，不显示中间状态
    const updateResult = await window.electronAPI.updateCode({ serverUrl });

    if (updateResult.success) {
      updateBtn.textContent = '✓ 完成';
      showMessage('✅ 代码更新完成！请重启应用');

      // 3秒后恢复按钮
      setTimeout(() => {
        updateBtn.disabled = false;
        updateBtn.textContent = originalText;
      }, 3000);
    } else {
      updateBtn.textContent = '✗ 失败';
      showMessage(`❌ 更新失败: ${updateResult.error}`);

      // 3秒后恢复按钮
      setTimeout(() => {
        updateBtn.disabled = false;
        updateBtn.textContent = originalText;
      }, 3000);
    }

  } catch (error) {
    console.error('[更新代码] 错误:', error);
    updateBtn.textContent = '✗ 失败';
    showMessage(`❌ 更新失败: ${error.message}`);

    // 3秒后恢复按钮
    setTimeout(() => {
      updateBtn.disabled = false;
      updateBtn.textContent = originalText;
    }, 3000);
  }
}

/**
 * 显示更新服务器配置帮助
 */
function showUpdateServerHelp() {
  const currentUrl = getUpdateServerUrl();
  console.log('========================================');
  console.log('🔄 代码更新服务器配置');
  console.log('========================================');
  console.log('当前服务器地址: ' + currentUrl);
  console.log('');
  console.log('修改服务器地址:');
  console.log('  按住 Shift 键点击"更新代码"按钮');
  console.log('  然后输入新的服务器地址');
  console.log('');
  console.log('示例地址:');
  console.log('  http://localhost:3000');
  console.log('  http://192.168.1.100:8080');
  console.log('  http://your-server.com:3000');
  console.log('========================================');
  // showMessage(`💡 当前服务器: ${currentUrl} (Shift+点击按钮修改地址)`);
}

// 页面加载时显示帮助
setTimeout(() => {
  const updateBtn = document.getElementById('updateCodeBtn');
  if (updateBtn) {
    // 不再显示 title 提示
    updateBtn.title = '';
  }
}, 1000);

// =====================================================================
// 🔧 调试工具
// =====================================================================

/**
 * 手动重新加载所有驱动器（包括 C 盘）
 */
window.debugLoadAllDrives = async function() {
  console.log('========================================');
  console.log('🔄 重新加载所有驱动器（包括 C 盘）');
  console.log('========================================');

  try {
    // 检查 API 是否可用
    if (!window.electronAPI || !window.electronAPI.getDataDrives) {
      console.error('❌ electronAPI.getDataDrives 不可用');
      return;
    }

    const result = await window.electronAPI.getDataDrives({ includeSystemDrive: true });

    if (!result.success) {
      console.error('❌ 获取驱动器失败:', result.error);
      return;
    }

    console.log(`✅ 找到 ${result.drives.length} 个驱动器:`);
    for (const drive of result.drives) {
      console.log(`  - ${drive.name} (${drive.path})`);
    }
    console.log('');

    // 重新加载文件树
    console.log('正在重新加载文件树...');

    // 清空现有驱动器节点
    for (let i = fileTreeHierarchy.length - 1; i >= 0; i--) {
      if (fileTreeHierarchy[i].type === 'drive') {
        fileTreeHierarchy.splice(i, 1);
      }
    }

    // 添加新驱动器
    for (const drive of result.drives) {
      fileTreeHierarchy.unshift({
        name: drive.name,
        path: drive.path,
        type: 'drive',
        expanded: false,
        level: 0,
        file: null,
        childrenLoaded: false,
        loadingChildren: false,
        isLocalDrive: true,
        size: 0
      });
    }

    // 渲染文件树
    renderFileTree();

    console.log('✅ 文件树已更新');
    console.log('========================================');
  } catch (error) {
    console.error('❌ 加载驱动器失败:', error);
  }
};

/**
 * 显示当前文件树的驱动器节点
 */
window.debugShowDrives = function() {
  console.log('========================================');
  console.log('📋 当前文件树中的驱动器');
  console.log('========================================');

  const drives = fileTreeHierarchy.filter(item => item.type === 'drive');
  console.log(`驱动器数量: ${drives.length}`);
  console.log('');

  if (drives.length === 0) {
    console.log('❌ 没有找到任何驱动器');
    console.log('');
    console.log('💡 使用以下命令加载驱动器:');
    console.log('   debugLoadAllDrives()');
  } else {
    for (let i = 0; i < drives.length; i++) {
      const drive = drives[i];
      console.log(`${i + 1}. ${drive.name} (${drive.path})`);
    }
  }
  console.log('========================================');
};

/**
 * 手动解压当前选中的压缩包文件到临时目录（用于调试）
 */
window.debugExtractSelectedArchiveFiles = async function() {
  try {
    // 检查是否有选中的压缩包文件
    if (!filterModeArchiveFiles || filterModeArchiveFiles.length === 0) {
      console.error('❌ 没有选中的压缩包文件');
      console.log('请先在过滤模式下选择压缩包内的文件');
      return null;
    }

    console.log('========================================');
    console.log('📦 开始解压选中的压缩包文件');
    console.log('========================================');
    console.log(`文件数量: ${filterModeArchiveFiles.length}`);

    // 打印文件列表
    for (let i = 0; i < filterModeArchiveFiles.length; i++) {
      const file = filterModeArchiveFiles[i];
      console.log(`  ${i + 1}. ${file.filePath}`);
      console.log(`     压缩包: ${file.archivePath}`);
    }
    console.log('========================================');

    // 调用导出功能
    const exportResult = await window.electronAPI.exportArchiveFilesForRipgrep(filterModeArchiveFiles);

    if (!exportResult.success) {
      console.error('❌ 解压失败:', exportResult.error);
      return null;
    }

    console.log('✅ 解压成功！');
    console.log('========================================');
    console.log(`解压目录: ${exportResult.tempDir}`);
    console.log(`合并文件: ${exportResult.tempFilePath}`);
    console.log(`总行数: ${exportResult.totalLines}`);
    console.log(`文件映射数量: ${exportResult.fileMappings.length}`);
    console.log('========================================');

    // 询问是否打开目录
    console.log('');
    console.log('💡 提示: 使用 debugOpenExtractDir() 打开解压目录查看文件');

    return exportResult;
  } catch (error) {
    console.error('解压压缩包文件失败:', error);
    return null;
  }
};

/**
 * 查看当前选中的压缩包文件列表
 */
window.debugShowSelectedArchiveFiles = function() {
  console.log('========================================');
  console.log('📋 当前选中的压缩包文件');
  console.log('========================================');

  if (!filterModeArchiveFiles || filterModeArchiveFiles.length === 0) {
    console.log('❌ 没有选中的压缩包文件');
    console.log('');
    console.log('请先在过滤模式下选择压缩包内的文件');
    console.log('========================================');
    return;
  }

  console.log(`文件数量: ${filterModeArchiveFiles.length}`);
  console.log('');

  for (let i = 0; i < filterModeArchiveFiles.length; i++) {
    const file = filterModeArchiveFiles[i];
    console.log(`${i + 1}. ${file.displayName || file.filePath}`);
    console.log(`   压缩包: ${file.archivePath}`);
    console.log(`   内部路径: ${file.filePath}`);
    console.log('');
  }
  console.log('========================================');
  console.log('');
  console.log('💡 使用以下命令解压这些文件:');
  console.log('   debugExtractSelectedArchiveFiles()');
  console.log('========================================');
};

/**
 * 打开解压目录
 */
window.debugOpenExtractDir = async function() {
  try {
    const result = await window.electronAPI.openExtractDir();
    if (result.success) {
      console.log(`✅ 已打开解压目录: ${result.path}`);
    } else {
      console.error('❌ 打开失败:', result.error);
    }
    return result;
  } catch (error) {
    console.error('打开解压目录失败:', error);
    return null;
  }
};

/**
 * 检查所有工具的状态
 */
window.checkToolsStatus = async function() {
  try {
    const result = await window.electronAPI.checkToolsStatus();
    if (result.success) {
      console.log('✅ 工具状态检查完成:');
      console.table(result.status);
      for (const [toolName, info] of Object.entries(result.status)) {
        if (!info.found) {
          console.warn(`⚠️ ${toolName} 未找到`);
        } else {
          console.log(`✅ ${toolName}: ${info.path}`);
        }
      }
    } else {
      console.error('❌ 检查工具状态失败:', result.error);
    }
    return result;
  } catch (error) {
    console.error('检查工具状态失败:', error);
    return null;
  }
};

// 页面加载时提示调试功能
setTimeout(() => {
  console.log('========================================');
  console.log('🔧 调试工具');
  console.log('========================================');
  console.log('驱动器相关:');
  console.log('  debugLoadAllDrives()    - 加载所有驱动器（包括C盘）');
  console.log('  debugShowDrives()       - 显示当前驱动器');
  console.log('');
  console.log('压缩包过滤:');
  console.log('  debugShowSelectedArchiveFiles()     - 查看选中的压缩包文件');
  console.log('  debugExtractSelectedArchiveFiles()  - 解压选中的文件');
  console.log('  debugOpenExtractDir()               - 打开解压目录');
  console.log('');
  console.log('临时目录:');
  console.log('  debugGetTempDir()       - 获取当前临时目录路径');
  console.log('  debugClearTempDir()     - 清空临时目录');
  console.log('  debugDeleteTempDir()    - 删除临时目录');
  console.log('');
  console.log('工具状态:');
  console.log('  checkToolsStatus()      - 检查所有工具的路径状态');
  console.log('========================================');
}, 2000);

// ============================================
// 🚀 临时目录管理 - 文件树选中时的自动解压
// ============================================

let tempExtractDir = null;
let tempExtractInitialized = false;

/**
 * 初始化临时目录（应用启动时调用）
 */
async function initializeTempExtractDir() {
  if (tempExtractInitialized) {
    return tempExtractDir;
  }

  try {
    const result = await window.electronAPI.createTempExtractDir();
    if (result.success) {
      tempExtractDir = result.tempDir;
      tempExtractInitialized = true;
      console.log(`[临时目录] 已创建: ${tempExtractDir}`);
    } else {
      console.error('[临时目录] 创建失败:', result.error);
    }
  } catch (error) {
    console.error('[临时目录] 初始化失败:', error);
  }

  return tempExtractDir;
}

/**
 * 清空临时目录（取消选中所有文件时调用）
 */
async function clearTempExtractDir() {
  if (!tempExtractInitialized) {
    return;
  }

  try {
    const result = await window.electronAPI.clearTempExtractDir();
    if (result.success) {
      console.log(`[临时目录] 已清空: ${tempExtractDir}`);
    } else {
      console.error('[临时目录] 清空失败:', result.error);
    }
  } catch (error) {
    console.error('[临时目录] 清空失败:', error);
  }
}

/**
 * 解压文件到临时目录
 * @param {string} archivePath - 压缩包路径
 * @param {string} relativePath - 压缩包内的相对路径（可选）
 */
async function extractToTempDir(archivePath, relativePath = null) {
  // 确保临时目录已初始化
  if (!tempExtractInitialized) {
    await initializeTempExtractDir();
  }

  if (!tempExtractDir) {
    console.error('[临时目录] 临时目录未初始化');
    return null;
  }

  try {
    const result = await window.electronAPI.extractToTempDir(archivePath, relativePath);
    if (result.success) {
      console.log(`[临时目录] 已解压: ${archivePath}`);
      if (result.extractedPath) {
        console.log(`[临时目录] 文件路径: ${result.extractedPath}`);
      }
      if (result.extractDir) {
        console.log(`[临时目录] 解压目录: ${result.extractDir}`);
      }
      return result;
    } else {
      console.error('[临时目录] 解压失败:', result.error);
      return null;
    }
  } catch (error) {
    console.error('[临时目录] 解压失败:', error);
    return null;
  }
}

/**
 * 获取临时目录路径
 */
async function getTempExtractDir() {
  if (!tempExtractInitialized) {
    await initializeTempExtractDir();
  }
  return tempExtractDir;
}

/**
 * 删除临时目录（窗口关闭时调用）
 */
async function deleteTempExtractDir() {
  if (!tempExtractInitialized) {
    return;
  }

  try {
    const result = await window.electronAPI.deleteTempExtractDir();
    if (result.success) {
      console.log(`[临时目录] 已删除: ${tempExtractDir}`);
      tempExtractDir = null;
      tempExtractInitialized = false;
    } else {
      console.error('[临时目录] 删除失败:', result.error);
    }
  } catch (error) {
    console.error('[临时目录] 删除失败:', error);
  }
}

// 页面加载时不再自动初始化临时目录，改为按需使用
// initializeTempExtractDir();

// 窗口关闭时删除临时目录
window.addEventListener('beforeunload', () => {
  deleteTempExtractDir();
});

// 暴露调试函数和手动控制函数
window.debugGetTempDir = async function() {
  const dir = await getTempExtractDir();
  console.log(`当前临时目录: ${dir}`);
  return dir;
};

window.debugClearTempDir = async function() {
  await clearTempExtractDir();
  console.log('已清空临时目录');
};

window.debugDeleteTempDir = async function() {
  await deleteTempExtractDir();
  console.log('已删除临时目录');
};

// 手动初始化临时目录（按需使用）
window.initTempDir = async function() {
  return await initializeTempExtractDir();
};

// ============================================
