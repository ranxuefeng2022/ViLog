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
          // 🚀 懒加载 iframe：首次打开时才设置 src，避免启动时抢占网络
          if (!aiAssistantFrame.src || aiAssistantFrame.src === 'about:blank') {
            const realSrc = aiAssistantFrame.dataset.src;
            if (realSrc) {
              aiAssistantFrame.src = realSrc;
              delete aiAssistantFrame.dataset.src;
            }
          }
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


// Service API
window.App = window.App || {};
window.App.SearchHistory = {
  applySecondaryFilter: window.applySecondaryFilter,
  clearSecondaryFilter: window.clearSecondaryFilter
};
