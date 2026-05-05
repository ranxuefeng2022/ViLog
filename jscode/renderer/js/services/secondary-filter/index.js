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
          lineElement.style.left = "0";
          // 🚀 使用 transform 替代 top，启用 GPU 合成层
          lineElement.style.transform = `translateY(${i * lineHeight}px)`;
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

// Service API
window.App = window.App || {};
window.App.SecondaryFilter = {
  show: window.showSecondaryFilterSidebar,
  hide: window.hideSecondaryFilterSidebar,
  restoreHighlight: window.restoreHighlight
};
