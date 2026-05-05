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
          element.style.cssText = "position:absolute;width:max-content;min-width:100%;display:none;left:0;";
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
      let fileTreeAllVisibleIndices = []; // 展开状态 + 搜索过滤后的"可见索引"（索引指向 fileTreeHierarchy）
      let fileTreeRowHeightPx = 0; // 单行高度（offsetHeight + margin）

      // 🚀 性能优化：文件图标后缀 → 图标 Map 查表（O(1) 替代 if-else 链）
      const FILE_TREE_ICON_MAP = new Map([
        ['.log', '📋'], ['.txt', '📝'], ['.json', '📋'],
        ['.xml', '📋'], ['.html', '🌐'], ['.js', '📜'],
        ['.css', '🎨'], ['.csv', '📊'], ['.md', '📝'],
        ['.py', '🐍'], ['.java', '☕'], ['.c', '⚙️'],
        ['.cpp', '⚙️'], ['.h', '⚙️'], ['.sh', '🖥️'],
        ['.bat', '🖥️'], ['.cfg', '⚙️'], ['.conf', '⚙️'],
        ['.apk', '📦'], ['.zip', '📦'], ['.tar', '📦'],
        ['.gz', '📦'], ['.7z', '📦'], ['.db', '🗄️'],
      ]);
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

      // 智能折叠/展开状态：鼠标靠近左边缘自动展开，离开后自动折叠
      let smartCollapseTimer = null;       // 自动折叠的延时器
      let isSmartCollapsed = false;        // 当前是否处于"智能展开"状态（由鼠标边缘触发）

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
      let focusOnFileTree = false; // 鼠标在文件树内的标志（用于 Ctrl+F 聚焦搜索框）

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
            url: "http://10.0.3.1/data01/powercenter/files/",
            color: "#333",
          },
          {
            name: "常用链接",
            url: "http://10.0.3.1/html/A_%E9%93%BE%E6%8E%A5%E5%AF%BC%E8%88%AA.html",
            color: "#333",
          },
          {
            name: "案例库",
            url: "http://10.0.3.1/html/httpserver/",
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
            url: "http://10.0.3.1/html/per_interval_csv_plot.html",
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
          // Ctrl+W: 关闭当前窗口
          if (e.ctrlKey && e.key === "w") {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.electronAPI !== "undefined" && window.electronAPI.windowControl) {
              window.electronAPI.windowControl.close();
            }
            return;
          }

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

        // 同时保存到新模块（IndexedDB + localStorage，拆分 | 关键词）
        if (window.App && window.App.FilterKeywordHistory && window.App.FilterKeywordHistory.addKeywordsFromInput) {
          window.App.FilterKeywordHistory.addKeywordsFromInput(filterText).catch(function(e) {
            console.warn('[FilterHistory] 保存到新模块失败:', e);
          });
        }
      }


// Service API
window.App = window.App || {};
window.App.Bookmarks = {
  toggleQuickLinksPanel: window.toggleQuickLinksPanel,
  createNewWindow: window.createNewWindow,
  jumpToLine: window.jumpToLine,
  scrollToTop: window.scrollToTop,
  scrollToBottom: window.scrollToBottom,
  scrollToSelectedLine: window.scrollToSelectedLine,
  updateScrollProgress: window.updateScrollProgress
};
