
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
          } else if (e.key === "F5") {
            // F5：刷新（同刷新按钮）
            e.preventDefault();
            clearMainLogContent();
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

            // 每次打开对话框前，从文件重新加载关键词（确保手动编辑JSON后也能同步）
            if (window.App && window.App.FilterKeywordHistory && window.App.FilterKeywordHistory.loadKeywords) {
              window.App.FilterKeywordHistory.loadKeywords();
            }

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
            } else if (focusOnFileTree && fileTreeSearch) {
              // 鼠标在文件树内 → 聚焦文件树搜索框
              fileTreeSearch.focus();
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
              // 获取前20条历史记录（优先使用新模块的拆分关键词）
              const historySource = (typeof window.getAppFilterHistory === 'function') ? window.getAppFilterHistory() : filterHistory;
              const historyItems = historySource.slice(0, 20).map((keyword, index) => ({
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

            // 🔧 文件树和过滤面板共存：不再隐藏文件树，布局已通过 updateLayout 自动调整
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

        // 🔧 文件树和过滤面板共存：不再隐藏文件树
        // updateFilteredPanel 会自动调整过滤面板位置

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
          // 🔧 记住用户偏好：手动最大化
          filteredPanelState.userPreference = 'maximized';
          window.__filterPanelUserPreference = 'maximized';
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
          // 🔧 记住用户偏好：手动还原为非最大化
          filteredPanelState.userPreference = 'normal';
          window.__filterPanelUserPreference = 'normal';
          // 🔧 切换图标为最大化图标
          if (maximizeBtn) maximizeBtn.textContent = '□';
          console.log('[toggleFilterPanelMaximize] 面板已还原，isFilterPanelMaximized =', isFilterPanelMaximized);
        }

        // 🔧 还原/最大化后，重新调整面板位置以适应文件树
        const ftc = DOMCache.get('fileTreeContainer');
        if (ftc) {
          _adjustFilteredPanelForFileTree(ftc.classList.contains('visible'));
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

        // 清除之前的高亮定时器
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
          // 🚀 优化：滚动期间正常计算高亮，已有缓存直接复用（O(1)）
          // 未缓存的行照常计算高亮并写入缓存，后续滚动即可命中
          updateFilteredPanelVisibleLines(false, false);
          filteredPanelScrollRafId = null;

          // 🚀 滚停后 150ms 对可见区域补充高亮（安全兜底）
          filteredPanelScrollDebounce = setTimeout(() => {
            _applyFilteredPanelHighlight();
            filteredPanelScrollDebounce = null;
          }, 150);
        });
      }

      /**
       * 🚀 惰性高亮：滚停后对可见区域应用高亮
       * 只处理视口内的少量行（~50行），不影响滚动帧率
       */
      function _applyFilteredPanelHighlight() {
        if (filteredPanelAllLines.length === 0) return;

        const hasPrimaryKeywords = currentFilter.filterKeywords && currentFilter.filterKeywords.length > 0;
        const hasSecondaryKeywords = secondaryFilter.isActive && secondaryFilter.filterKeywords.length > 0;
        const hasCustomHighlights = customHighlights && customHighlights.length > 0;

        // 没有任何高亮需求，跳过
        if (!hasPrimaryKeywords && !hasSecondaryKeywords && !hasCustomHighlights) return;

        // 🔧 保存选区，避免 innerHTML 替换时丢失
        const savedSel = _saveFilteredPanelSelection();

        const scrollTop = filteredPanelContent.scrollTop;
        const clientHeight = filteredPanelContent.clientHeight;
        const visStart = Math.max(0, Math.floor(scrollTop / filteredPanelLineHeight));
        const visEnd = Math.min(filteredPanelAllLines.length - 1,
          Math.ceil((scrollTop + clientHeight) / filteredPanelLineHeight));

        const skipPrimaryHighlight = hasSecondaryKeywords;

        for (let i = visStart; i <= visEnd; i++) {
          const el = filteredPanelVirtualContent.querySelector(`[data-filtered-index="${i}"]`);
          if (!el) continue;

          const lineContent = filteredPanelAllLines[i];
          const isFileHeader = fileHeaderIndices.has(i);
          const originalIndex = filteredPanelAllOriginalIndices[i];

          // 计算高亮 HTML
          let displayText = escapeHtml(lineContent);

          // 自定义高亮
          if (hasCustomHighlights) {
            for (let h = 0; h < customHighlights.length; h++) {
              const highlight = customHighlights[h];
              if (!highlight.keyword) continue;
              const escapedKeyword = escapeHtml(highlight.keyword);
              displayText = safeHighlight(displayText, escapedKeyword,
                (match) => `<span class="custom-highlight" style="background-color: ${highlight.color}80;">${match}</span>`
              );
            }
          }

          // 二级过滤高亮
          if (hasSecondaryKeywords) {
            for (let k = 0; k < secondaryFilter.filterKeywords.length; k++) {
              const keyword = secondaryFilter.filterKeywords[k];
              if (!keyword) continue;
              const colorClass = secondaryFilterHighlightClasses[k % secondaryFilterHighlightClasses.length];
              const escapedKeyword = escapeHtml(keyword);
              displayText = safeHighlight(displayText, escapedKeyword,
                (match) => `<span class="${colorClass}">${match}</span>`
              );
            }
          }

          // 添加行号
          if (!isFileHeader) {
            displayText = `<span class="line-number">${originalIndex + 1}</span>${displayText}`;
          }

          el.innerHTML = displayText;

          // 🚀 同步写入行级HTML缓存，下次滚动可直接复用（O(1)命中）
          const cacheKey = getFilteredLineCacheKey(i, isFileHeader, originalIndex) + '|h:true';
          addToFilteredLineCache(cacheKey, displayText);
        }

        // 🔧 恢复选区
        _restoreFilteredPanelSelection(savedSel);
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

      /**
       * 🔧 保存过滤面板中的文本选区（基于 data-filtered-index）
       */
      function _saveFilteredPanelSelection() {
        try {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount || sel.isCollapsed) return null;

          const range = sel.getRangeAt(0);
          const container = filteredPanelVirtualContent;
          if (!container) return null;

          // 快速祖先链检查，避免 contains() 的子树遍历
          let node = range.commonAncestorContainer;
          while (node) {
            if (node === container) break;
            node = node.parentNode;
          }
          if (!node) return null; // 不在过滤面板内

          function findLineEl(node) {
            while (node && node !== container) {
              if (node.nodeType === 1 && node.classList.contains('filtered-log-line')) return node;
              node = node.parentNode;
            }
            return null;
          }

          function textOffsetInLine(textNode, nodeOffset, lineEl) {
            const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
            let total = 0;
            while (walker.nextNode()) {
              if (walker.currentNode === textNode) return total + nodeOffset;
              total += walker.currentNode.textContent.length;
            }
            return nodeOffset;
          }

          const anchorLineEl = findLineEl(range.startContainer);
          const focusLineEl = findLineEl(range.endContainer);
          if (!anchorLineEl || !focusLineEl) return null;

          return {
            anchorLine: parseInt(anchorLineEl.dataset.filteredIndex),
            anchorOffset: textOffsetInLine(range.startContainer, range.startOffset, anchorLineEl),
            focusLine: parseInt(focusLineEl.dataset.filteredIndex),
            focusOffset: textOffsetInLine(range.endContainer, range.endOffset, focusLineEl),
          };
        } catch (e) {
          return null;
        }
      }

      /**
       * 🔧 恢复过滤面板中的文本选区
       */
      function _restoreFilteredPanelSelection(saved) {
        if (!saved || !filteredPanelVirtualContent) return;
        try {
          const container = filteredPanelVirtualContent;
          const anchorEl = container.querySelector(`.filtered-log-line[data-filtered-index="${saved.anchorLine}"]`);
          const focusEl = container.querySelector(`.filtered-log-line[data-filtered-index="${saved.focusLine}"]`);
          if (!anchorEl || !focusEl) return;

          function setRangePoint(range, isStart, lineEl, targetOffset) {
            const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
            let total = 0;
            while (walker.nextNode()) {
              const len = walker.currentNode.textContent.length;
              if (total + len >= targetOffset) {
                const pos = Math.min(targetOffset - total, len);
                if (isStart) range.setStart(walker.currentNode, pos);
                else range.setEnd(walker.currentNode, pos);
                return true;
              }
              total += len;
            }
            return false;
          }

          const range = document.createRange();
          if (!setRangePoint(range, true, anchorEl, saved.anchorOffset)) return;
          if (!setRangePoint(range, false, focusEl, saved.focusOffset)) return;

          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (e) {
          // 静默失败
        }
      }

      // 更新过滤面板可见行 - 虚拟滚动核心 - 🚀 恢复所有高亮功能
      // forceHighlight: 强制重新计算高亮（用于滚动停止后的更新）
      // forcePlainText: 强制使用纯文本模式（用于滚动期间的惰性高亮）
      function updateFilteredPanelVisibleLines(forceHighlight = false, forcePlainText = false, cacheOnlyMode = false) {
        if (filteredPanelAllLines.length === 0) return;

        // 🔧 保存过滤面板的文本选区，避免滚动重绘时丢失
        const savedFpSelection = _saveFilteredPanelSelection();

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

        // 🚀 优化：如果完全没有高亮需求，或强制纯文本模式，使用textContent（快50倍，避免HTML解析和转义）
        if (!anyHighlightNeeded || forcePlainText) {
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
            // 🚀 使用 transform 替代 top，启用 GPU 合成层，避免 CPU Layout Reflow
            lineElement.style.cssText = `transform:translateY(${Math.floor(i * filteredPanelLineHeight)}px);width:max-content;min-width:100%;position:absolute;left:0;`;

            // 🚀 使用 innerHTML 渲染行号 span（保持样式一致），内容部分直接拼接
            // 行号是纯数字无需转义，日志内容可能含 <>& 等，用 textContent 无法同时保持 span 结构
            // 性能权衡：innerHTML 比 createElement+appendChild 快，且行号数字无需转义
            if (!isFileHeader) {
              const lineNumber = originalIndex + 1;
              lineElement.innerHTML = '<span class="line-number">' + lineNumber + '</span>';
              lineElement.appendChild(document.createTextNode(lineContent));
            } else {
              lineElement.textContent = lineContent;
            }


            fragment.appendChild(lineElement);
          }

          // 🚀 一次性批量添加DOM（比innerHTML更快且更安全）
          filteredPanelVirtualContent.innerHTML = '';
          filteredPanelVirtualContent.appendChild(fragment);

          // 🔧 恢复过滤面板的文本选区
          _restoreFilteredPanelSelection(savedFpSelection);
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

            // 🚀 cacheOnlyMode（滚动中）：跳过高亮计算，直接渲染纯文本
            // 滚停后 _applyFilteredPanelHighlight() 会补充高亮
            if (!cacheOnlyMode && needsHighlight) {
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

            // 🚀 仅非cacheOnlyMode时缓存，避免缓存未高亮的纯文本版本
            // 滚停后 _applyFilteredPanelHighlight 会通过下次非 cacheOnlyMode 调用更新缓存
            if (!cacheOnlyMode) {
              addToFilteredLineCache(cacheKey, displayText);
            }
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

        // 🔧 恢复过滤面板的文本选区
        _restoreFilteredPanelSelection(savedFpSelection);
      }

      // 🚀 优化：简化版内容更新函数，去掉所有HTML操作（高亮、链接转换等）
      // 只保留必要的样式，大幅提升性能
      function updateFilteredLineElementContent(lineElement, index, lineContent, isFileHeader) {
        // 存储原始行号
        lineElement.dataset.originalIndex = filteredPanelAllOriginalIndices[index];
        lineElement.dataset.filteredIndex = index;

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

      // 🚀 调整过滤面板位置，让出文件树空间
      // 当文件树可见时，过滤面板左侧要缩进，避免遮挡文件树
      function _adjustFilteredPanelForFileTree(fileTreeVisible) {
        const fileTreeContainer = DOMCache.get('fileTreeContainer');
        if (!fileTreeContainer || !filteredPanel) return;

        if (fileTreeVisible && fileTreeContainer.classList.contains('visible')) {
          // 获取文件树实际宽度
          const treeWidth = fileTreeContainer.getBoundingClientRect().width || 360;
          const offset = treeWidth + 'px';
          // 🔧 同时设置 CSS 变量（给最大化 !important 用）和 inline left（给非最大化用）
          filteredPanel.style.setProperty('--filter-panel-left-offset', offset);
          filteredPanel.style.left = offset;
        } else {
          // 文件树不可见时，清除偏移
          filteredPanel.style.removeProperty('--filter-panel-left-offset');
          filteredPanel.style.left = '';
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

        // 🚀 自动最大化：如果面板不是最大化状态，且用户没有手动还原过，则自动最大化
        if (!filteredPanel.classList.contains("maximized") && !isFilterPanelMaximized && filteredPanelState.userPreference !== 'normal') {
          saveFilteredPanelState();
          filteredPanel.classList.add("maximized");
          filteredPanel.style.removeProperty('height');
          filteredPanel.style.removeProperty('width');
          filteredPanel.style.removeProperty('--filtered-panel-top');
          isFilterPanelMaximized = true;
          const maximizeBtn = DOMCache.get('filteredPanelMaximize');
          if (maximizeBtn) maximizeBtn.textContent = '❐';
        }

        // 🔧 文件树和过滤面板共存：不再自动隐藏文件树
        // 过滤面板通过 CSS 让出左侧空间给文件树
        const fileTreeContainer = DOMCache.get('fileTreeContainer');
        if (fileTreeContainer && fileTreeContainer.classList.contains('visible')) {
          // 🚀 过滤面板最大化时，让出文件树宽度的左侧空间
          _adjustFilteredPanelForFileTree(true);
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

