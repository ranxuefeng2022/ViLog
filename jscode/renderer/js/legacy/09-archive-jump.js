      // ============ 文件树 DOM 池 ============
      // 🚀 性能优化：DOM 池化 + 差异化渲染
      // _ftPool: 可复用的 DOM 元素池
      // _ftActive: 当前活跃的 index → element 映射
      // _ftOrder: 当前活跃的行号（视口内位置 i）排序列表，用于有序插入
      const _ftPool = [];
      const _ftActive = new Map();
      const _ftActiveSlots = new Map(); // index → slot(i)

      /** 从池中获取或创建 DOM 元素 */
      function _ftAcquire() {
        if (_ftPool.length > 0) return _ftPool.pop();
        return document.createElement("div");
      }

      /** 回收到池中 */
      function _ftRelease(el) {
        el.textContent = "";
        el.className = "";
        el.removeAttribute("style");
        el.removeAttribute("data-index");
        if (el.parentElement) el.parentElement.removeChild(el);
        _ftPool.push(el);
      }

      /** 清空所有活跃元素 */
      function _fileTreeDomPoolClear() {
        for (const [, el] of _ftActive) {
          _ftRelease(el);
        }
        _ftActive.clear();
        _ftActiveSlots.clear();
      }

      /** 释放指定 index 的元素 */
      function _fileTreeDomPoolRelease(index) {
        const el = _ftActive.get(index);
        if (el) {
          _ftRelease(el);
          _ftActive.delete(index);
          _ftActiveSlots.delete(index);
        }
      }

      /** 为指定 hierarchy index 创建完整的 DOM 元素 */
      function _fileTreeCreateElement(index, selectedIndexSet, matchedIndexSet) {
        const item = fileTreeHierarchy[index];
        if (!item) return null;

        const element = _ftAcquire();
        element.className = `file-tree-item file-tree-${item.type}`;
        element.classList.add(`file-tree-level-${item.level}`);
        element.style.setProperty("--ft-level", String(item.level || 0));
        element.dataset.index = index;

        // 选中状态
        if (selectedIndexSet.has(index)) {
          element.classList.add("selected");
        }
        // 多选
        if (archiveMultiSelectedFiles.has(index)) {
          element.classList.add("multi-selected");
        }
        // 搜索匹配
        if (matchedIndexSet && matchedIndexSet.has(index)) {
          element.classList.add("search-matched");
        }

        // 压缩包
        if (item.isArchive) {
          element.classList.add("archive");
          let isExpanded;
          if (item.isRemote || item.isNestedArchive) {
            isExpanded = item.expanded;
          } else {
            isExpanded = expandedArchives.has(item.archiveName);
          }
          if (isExpanded) {
            element.classList.add("expanded");
          }
        }

        // 缩进参考线
        const level = item.level || 0;
        let indentGuidesHtml = '';
        if (level > 0) {
          for (let lv = 1; lv <= level; lv++) {
            indentGuidesHtml += '<span class="ft-indent-guide" style="left:' + (2 + lv * 14 - 7) + 'px"></span>';
          }
        }

        // 内容
        if (item.type === "folder") {
          element.classList.add(
            item.expanded ? "file-tree-folder-expanded" : "file-tree-folder-collapsed"
          );
          const showToggle = item.lazyLoad ? (item.hasChildren || item.childrenLoaded) : true;
          const toggleClass = item.expanded ? "expanded" : "";
          const toggleStyle = !showToggle ? 'style="visibility:hidden"' : "";
          const loadingMark = item.loadingChildren
            ? '<span style="margin-left:6px;opacity:.6;">加载中…</span>' : "";
          element.innerHTML =
            indentGuidesHtml +
            `<span class="file-tree-toggle ${toggleClass}" ${toggleStyle} aria-hidden="true"></span>` +
            `<span class="icon"></span><span class="file-tree-name">${escapeHtml(item.name)}</span>` +
            loadingMark;
        } else if (item.type === "drive") {
          element.classList.add(
            item.expanded ? "file-tree-folder-expanded" : "file-tree-folder-collapsed"
          );
          const toggleClass = item.expanded ? "expanded" : "";
          const loadingMark = item.loadingChildren
            ? '<span style="margin-left:6px;opacity:.6;">加载中…</span>' : "";
          element.innerHTML =
            indentGuidesHtml +
            `<span class="file-tree-toggle ${toggleClass}" aria-hidden="true"></span>` +
            `<span class="icon">💽</span><span class="file-tree-name">${escapeHtml(item.name)}</span>` +
            loadingMark;
        } else if (item.isArchive) {
          let isExpanded;
          if (item.isRemote || item.isNestedArchive) {
            isExpanded = item.expanded;
          } else {
            isExpanded = expandedArchives.has(item.archiveName);
          }
          const loadingMark = item.loadingChildren
            ? '<span style="margin-left:6px;opacity:.6;">加载中…</span>' : "";
          element.innerHTML =
            indentGuidesHtml +
            `<span class="file-tree-toggle ${isExpanded ? "expanded" : ""}" aria-hidden="true"></span>` +
            `<span class="icon">📦</span><span class="file-tree-name">${escapeHtml(item.name)}</span>` +
            (item.fileCount ? `<span class="file-count">(${item.fileCount} 个文件)</span>` : "") +
            loadingMark;
        } else {
          // 普通文件
          const nameLower = item.name.toLowerCase();
          const dotIdx = nameLower.lastIndexOf('.');
          const icon = dotIdx > -1 ? (FILE_TREE_ICON_MAP.get(nameLower.slice(dotIdx)) || "📄") : "📄";
          element.innerHTML = indentGuidesHtml + `<span class="icon">${icon}</span><span class="file-tree-name">${escapeHtml(item.name)}</span>`;
        }

        _ftActive.set(index, element);
        return element;
      }

      /** 更新已有元素的选中/匹配状态（不重建 innerHTML） */
      function _fileTreeUpdateState(index, selectedIndexSet, matchedIndexSet) {
        const el = _ftActive.get(index);
        if (!el) return;

        // 更新选中状态
        if (selectedIndexSet.has(index)) {
          if (!el.classList.contains("selected")) el.classList.add("selected");
        } else {
          if (el.classList.contains("selected")) el.classList.remove("selected");
        }

        // 更新多选状态
        if (archiveMultiSelectedFiles.has(index)) {
          if (!el.classList.contains("multi-selected")) el.classList.add("multi-selected");
        } else {
          if (el.classList.contains("multi-selected")) el.classList.remove("multi-selected");
        }

        // 更新搜索匹配状态
        if (matchedIndexSet && matchedIndexSet.has(index)) {
          if (!el.classList.contains("search-matched")) el.classList.add("search-matched");
        } else {
          if (el.classList.contains("search-matched")) el.classList.remove("search-matched");
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

            // 检查文件大小，大文件使用流式加载
            let useStreaming = false;
            try {
              const fsCheck = await window.electronAPI.fileExists(filePath);
              if (fsCheck && fsCheck.size > STREAMING_FILE_THRESHOLD) {
                useStreaming = true;
                console.log(`[loadLocalFile] 文件 ${(fsCheck.size / 1048576).toFixed(1)}MB 超过阈值，使用流式加载`);
              }
            } catch (e) { /* 使用常规方式 */ }

            if (useStreaming) {
              originalLines = [];
              fileHeaders = [];
              fileHeaders.push({
                fileName: treeItem.name,
                lineCount: 0,
                startIndex: 0
              });
              originalLines.push(`=== 文件: ${treeItem.name} (加载中...) ===`);

              try {
                await loadFileWithStreaming(filePath, treeItem.name);
              } catch (error) {
                console.error('[loadLocalFile] 流式加载失败:', error);
                showMessage('流式加载失败: ' + error.message);
              }
              return;
            }

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
          if (fileLoadMode === 'memory') {
            showMemoryModeStats();
          } else {
            renderLogLines();
          }
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

      // 🚀 解压到子目录: aaa.zip -> aaa/
      async function extractArchiveToSubDir(archiveIndex) {
        const archive = fileTreeHierarchy[archiveIndex];
        if (!archive) {
          showMessage("压缩包不存在");
          return;
        }

        const archivePath = archive._originalPath || archive.path;
        if (!archivePath) {
          showMessage("无法获取压缩包路径");
          return;
        }

        // 确定目标目录: aaa.zip -> aaa/
        const parentDir = archivePath.replace(/[/\\][^/\\]*$/, '');
        const baseName = archivePath.replace(/^.*[/\\]/, '');
        const dirName = baseName.replace(/\.(zip|rar|7z|tar|gz|tgz|bz2)$/i, '');
        const targetPath = parentDir + '/' + dirName;

        console.log(`[extractArchiveToSubDir] 压缩包: ${archivePath}`);
        console.log(`[extractArchiveToSubDir] 解压到: ${targetPath}`);

        if (!window.electronAPI || !window.electronAPI.extractArchiveWithProgress) {
          showMessage("解压功能不可用");
          return;
        }

        // 创建进度弹窗
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10005;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML =
          '<div style="background:#fff;border-radius:12px;padding:24px 32px;min-width:360px;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,0.2);text-align:center;">' +
            '<div style="font-size:16px;font-weight:600;margin-bottom:16px;">📦 正在解压...</div>' +
            '<div style="font-size:13px;color:#666;margin-bottom:4px;">' + escapeHtml(baseName) + '</div>' +
            '<div style="font-size:12px;color:#999;margin-bottom:16px;">→ ' + escapeHtml(targetPath) + '</div>' +
            '<div id="extractProgressBar" style="width:100%;height:8px;background:#eee;border-radius:4px;overflow:hidden;margin-bottom:8px;">' +
              '<div id="extractProgressFill" style="height:100%;width:0%;background:linear-gradient(90deg,#4facfe,#00f2fe);border-radius:4px;transition:width 0.3s;"></div>' +
            '</div>' +
            '<div id="extractProgressText" style="font-size:13px;color:#333;margin-bottom:4px;">准备中...</div>' +
            '<div id="extractProgressFile" style="font-size:11px;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>' +
          '</div>';
        document.body.appendChild(overlay);

        var progressFill = overlay.querySelector('#extractProgressFill');
        var progressText = overlay.querySelector('#extractProgressText');
        var progressFile = overlay.querySelector('#extractProgressFile');
        var lastPercent = 0;

        // 监听进度
        var progressHandler = function(data) {
          if (data.percent > lastPercent) lastPercent = data.percent;
          progressFill.style.width = lastPercent + '%';
          progressText.textContent = '解压中 ' + lastPercent + '%';
          if (data.fileName) {
            progressFile.textContent = data.fileName;
          }
        };

        if (window.electronAPI.on) {
          window.electronAPI.on('extract-progress', progressHandler);
        }

        try {
          var result = await window.electronAPI.extractArchiveWithProgress(archivePath, targetPath);

          // 移除进度监听
          if (window.electronAPI.removeListener) {
            window.electronAPI.removeListener('extract-progress', progressHandler);
          }

          if (result.success) {
            progressFill.style.width = '100%';
            progressText.textContent = '解压完成!';
            progressText.style.color = '#4caf50';
            progressFile.textContent = '';

            setTimeout(function() {
              if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 1500);

            showMessage('解压成功！已解压到: ' + targetPath);

            // 刷新文件树
            if (archive.isRemote) {
              await refreshRemoteDirectory(archiveIndex);
            } else {
              await refreshLocalDirectory(parentDir);
            }
          } else {
            // 失败：显示错误后自动关闭
            progressFill.style.background = '#f5576c';
            progressText.textContent = '解压失败';
            progressText.style.color = '#f5576c';
            progressFile.textContent = result.error || '未知错误';

            setTimeout(function() {
              if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 3000);

            showMessage('解压失败: ' + (result.error || '未知错误'));
          }
        } catch (error) {
          if (window.electronAPI.removeListener) {
            window.electronAPI.removeListener('extract-progress', progressHandler);
          }
          progressFill.style.background = '#f5576c';
          progressText.textContent = '解压失败';
          progressText.style.color = '#f5576c';
          progressFile.textContent = error.message || '';

          setTimeout(function() {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          }, 3000);

          showMessage('解压失败: ' + (error.message || error));
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

          // 启动目录监听
          startWatchingDirectory(folder.path);

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

        // 释放 JSZip 对象（体积较大），但保留 _archiveFiles 文件列表
        // 否则再次展开时因 childrenLoaded=true 跳过加载，导致子文件夹懒加载找不到数据
        delete archive._zipObject;
        // delete archive._archiveFiles;  // 🔧 不再删除，子文件夹懒加载依赖此数据

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
          if (fileLoadMode === 'memory') {
            showMemoryModeStats();
          } else {
            renderLogLines();
          }
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
          // +1 是因为 fileHeaders 中还包含文件头行（=== 文件: xxx ===）
          const startLine = header.startIndex;
          const endLine = header.startIndex + header.lineCount + 1;

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

        // 🚀 新增：过滤模式检测（仅 filter 模式不加载文件内容）
        // memory 模式下 isFileLoadMode=true，会正常加载到 originalLines
        if (fileLoadMode === 'filter') {
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
        const MAX_MEMORY_MB = 2000;  // 最多2000

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
            if (fileLoadMode === 'memory') {
              showMemoryModeStats();
            } else {
              renderLogLines();
            }
            selectedOriginalIndex = -1;

            console.log(`[loadSelectedFiles] ✓ 渲染完成`);

            // 🚀 渲染完成后更新布局，确保文件树不影响主日志框
            updateLayout();
          });

          if (totalFiles > 0) {
            showMessage(`已加载 ${totalFiles} 个文件 (${originalLines.length} 行)`);
          }

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

        // 🚀 统一按 order 顺序处理所有文件（不区分类型）
        const UNIFIED_CONCURRENCY = 3;
        const unifiedResults = new Array(allFiles.length);
        const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024;

        // 🚀 预处理：对同一个压缩包的多个文件，流水线提取 + 逐文件推送
        // 主进程每提取完一个文件就通过 event.sender.send 推送过来
        // 渲染进程按文件树顺序接收并立即处理渲染
        const archiveFilesMap = new Map(); // allFiles 中 type==='archive' 的索引列表
        const archivePathToIndex = new Map(); // archivePath -> allFiles 中的索引
        let archiveFilesTotal = 0;
        let archiveFilesReceived = 0;
        let archiveResolve = null;
        const archiveOrderedResults = []; // 按文件树顺序存放 { index, result }

        {
          // 收集所有 archive 类型的文件
          for (let i = 0; i < allFiles.length; i++) {
            if (allFiles[i].type === 'archive') {
              const item = allFiles[i].data.item;
              const key = item.archivePath;
              archivePathToIndex.set(key, i);
              archiveFilesTotal++;
            }
          }

          if (archiveFilesTotal > 1 && window.electronAPI) {
            // 按压缩包分组
            const archiveGroups = new Map();
            for (let i = 0; i < allFiles.length; i++) {
              const f = allFiles[i];
              if (f.type === 'archive') {
                const archiveName = f.data.item.archiveName;
                if (!archiveGroups.has(archiveName)) archiveGroups.set(archiveName, []);
                archiveGroups.get(archiveName).push({ fileInfo: f, index: i, archivePath: f.data.item.archivePath });
              }
            }

            // 注册一次性监听器，接收主进程逐文件推送
            const pipelinePromise = new Promise((resolve) => {
              archiveResolve = resolve;

              const handler = (data) => {
                if (sessionId !== currentLoadingSession) {
                  window.electronAPI.removeListener('archive-file-extracted', handler);
                  resolve();
                  return;
                }

                const { filePath, result, index: orderIndex } = data;
                const allFilesIndex = archivePathToIndex.get(filePath);

                if (allFilesIndex !== undefined) {
                  archiveOrderedResults.push({ allFilesIndex, result, orderIndex });
                  archiveFilesReceived++;
                  const percent = Math.round((archiveFilesReceived / archiveFilesTotal) * 100);
                  if (progressFill) progressFill.style.width = `${percent}%`;
                }

                if (archiveFilesReceived >= archiveFilesTotal) {
                  window.electronAPI.removeListener('archive-file-extracted', handler);
                  resolve();
                }
              };

              window.electronAPI.on('archive-file-extracted', handler);
            });

            // 按顺序发起提取请求（每个压缩包一组）
            for (const [archiveName, group] of archiveGroups) {
              if (sessionId !== currentLoadingSession) break;

              // 按文件树顺序排列的路径列表
              const orderedPaths = group.map(g => g.archivePath);
              console.log(`[流水线提取] ${archiveName}: ${orderedPaths.length} 个文件（按文件树顺序）`);

              try {
                if (window.electronAPI && window.electronAPI.streamExtractFromArchive) {
                  // 发起提取，不等待完整结果（文件会通过推送逐个到达）
                  const result = await window.electronAPI.streamExtractFromArchive(archiveName, orderedPaths);
                  console.log(`[流水线提取] 主进程返回: success=${result?.success}, fileCount=${result?.fileCount}`);
                }
              } catch (e) {
                console.warn(`[流水线提取] 失败:`, e.message);
              }
            }

            // 等待所有文件推送完毕
            await pipelinePromise;
            console.log(`[流水线提取] 全部完成: ${archiveFilesReceived}/${archiveFilesTotal}`);

            // 将流水线结果按文件树顺序放入 unifiedResults
            for (const { allFilesIndex, result, orderIndex } of archiveOrderedResults) {
              if (result.success) {
                const fileInfo = allFiles[allFilesIndex];
                const item = fileInfo.data.item;
                unifiedResults[allFilesIndex] = {
                  fileInfo,
                  content: result.content,
                  name: item.archivePath,
                  path: `${item.archiveName}/${item.archivePath}`
                };
              } else {
                unifiedResults[allFilesIndex] = {
                  fileInfo: allFiles[allFilesIndex],
                  error: result.error || '提取失败'
                };
              }
            }
          }
        }

        // 读取单个文件（不区分类型，统一处理）
        const readSingleFile = async (fileInfo) => {
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
                // 流水线已把结果放入 unifiedResults，此处仅处理单个 archive 文件的回退
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
                const localFilePath = localItem._originalPath || localItem.path;
                const localResult = await window.electronAPI.readFile(localFilePath);
                if (!localResult || !localResult.success) {
                  return { fileInfo, error: localResult?.error || '读取失败' };
                }
                return {
                  fileInfo,
                  content: localResult.content,
                  name: localItem.name,
                  path: localItem._originalPath || localItem.path
                };

              case 'normal':
                const file = fileInfo.data.file;
                const fileName = file.webkitRelativePath || file.name;
                const filePath = file.path || fileName;

                // 懒加载文件
                if (file._lazyFile && window.electronAPI && window.electronAPI.readFile) {
                  const lazyResult = await window.electronAPI.readFile(filePath);
                  if (lazyResult && lazyResult.success && lazyResult.content) {
                    return { fileInfo, content: lazyResult.content, name: fileName, path: filePath };
                  }
                  throw new Error(lazyResult?.error || '读取文件失败');
                }

                // 大文件流式读取
                if (typeof file.size === 'number' && file.size > LARGE_FILE_THRESHOLD) {
                  const streamResult = await loadFileStreaming(file, fileName, 2 * 1024 * 1024, null, sessionId, filePath);
                  return { fileInfo, streamed: true, streamResult, name: fileName, path: filePath };
                }

                // 小文件直接读取
                const content = await readFileAsText(file);
                return { fileInfo, content, name: fileName, path: filePath };

              default:
                return { fileInfo, error: `未知文件类型: ${fileInfo.type}` };
            }
          } catch (error) {
            return { fileInfo, error: error.message };
          }
        };

        // 分批并发读取（控制内存峰值）
        // 读取未被流水线处理的文件（非 archive 类型 + 单个 archive 文件）
        let archiveQueue = Promise.resolve();
        for (let i = 0; i < allFiles.length; i += UNIFIED_CONCURRENCY) {
          if (sessionId !== currentLoadingSession) {
            console.log("⚠️ 会话已过期，停止加载");
            return;
          }

          const batch = allFiles.slice(i, Math.min(i + UNIFIED_CONCURRENCY, allFiles.length));
          const batchPromises = batch.map((fileInfo, batchIdx) => {
            const globalIdx = i + batchIdx;
            // 跳过已被流水线处理过的 archive 文件
            if (unifiedResults[globalIdx]) return unifiedResults[globalIdx];

            if (fileInfo.type === 'archive') {
              // 单个 archive 文件：串行读取
              archiveQueue = archiveQueue.then(() => readSingleFile(fileInfo).catch(err => ({
                fileInfo,
                error: err.message
              })));
              return archiveQueue;
            }
            return readSingleFile(fileInfo).catch(err => ({
              fileInfo,
              error: err.message
            }));
          });

          const batchResults = await Promise.all(batchPromises);
          for (let j = 0; j < batchResults.length; j++) {
            const globalIdx = i + j;
            if (!unifiedResults[globalIdx]) {
              unifiedResults[globalIdx] = batchResults[j];
            }
          }
        }

        // 按原始顺序处理所有结果（allFiles 已按 order 排序，保持文件树从上到下顺序）
        for (const result of unifiedResults) {
          if (sessionId !== currentLoadingSession) {
            console.log("⚠️ 会话已过期，停止加载");
            return;
          }

          if (!result) { updateProgress(); continue; }

          if (result.error) {
            console.error(`加载文件失败 (order=${result.fileInfo.order}):`, result.error);
            updateProgress();
            continue;
          }

          // 流式文件：按顺序写入
          if (result.streamed && result.streamResult && result.streamResult.collectedLines) {
            const sr = result.streamResult;
            const startIndex = originalLines.length;
            const filePathAttr = result.path ? ` data-path="${result.path}"` : '';
            originalLines.push(`=== 文件: ${result.name} (${sr.lineCount} 行)${filePathAttr} ===`);
            for (const line of sr.collectedLines) {
              originalLines.push(line);
            }
            fileHeaders.push({
              fileName: result.name,
              filePath: result.path || result.name,
              lineCount: sr.lineCount,
              startIndex: startIndex,
            });
            updateProgress();
            continue;
          }

          if (result.content !== undefined) {
            processFileContent(result.content, result.name, result.path, result.fileInfo.fileTreeIndex);
            updateProgress();
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
            if (fileLoadMode === 'memory') {
              showMemoryModeStats();
            } else {
              renderLogLines();
            }
            selectedOriginalIndex = -1;

            console.log(`[loadSelectedFiles] ✓ 渲染完成`);

            // 🚀 渲染完成后更新布局，确保文件树不影响主日志框
            updateLayout();
          });
        }, 50);  // 50ms延迟，让浏览器有时间处理事件队列

        if (totalFiles > 0) {
          showMessage(`已加载 ${totalFiles} 个文件 (${originalLines.length} 行)`);
        }

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

      // 停止所有目录监听
      for (const dirPath of watchedDirectories) {
        try { window.electronAPI.unwatchDirectory(dirPath); } catch (_) {}
      }
      watchedDirectories.clear();

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

        // 停止所有目录监听
        for (const dirPath of watchedDirectories) {
          try { window.electronAPI.unwatchDirectory(dirPath); } catch (_) {}
        }
        watchedDirectories.clear();

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

        // 🚀 进程清理修复：重置 Worker 会话但保留 Worker 池供下次快速复用
        if (typeof parallelFilterManager !== 'undefined' && parallelFilterManager) {
          parallelFilterManager.cancel();
          // 🚀 优化：使用 resetSession 保留 Worker 池，避免下次过滤时重新创建（节省 50-200ms）
          parallelFilterManager.resetSession();
          console.log('[Memory] 已重置 parallelFilterManager 会话（Worker 池保留）');
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

        // 收集行数据到本地数组，避免并发写入全局 originalLines 导致乱序
        const collectedLines = [];

        // 分块读取
        let offset = 0;
        while (offset < file.size) {
          // 检查会话是否过期
          if (sessionId !== undefined && sessionId !== currentLoadingSession) return null;

          const chunk = file.slice(offset, offset + chunkSize);
          const arrayBuffer = await readChunkAsArrayBuffer(chunk);

          // 再次检查会话是否过期
          if (sessionId !== undefined && sessionId !== currentLoadingSession) return null;

          const text = decoder.decode(arrayBuffer, { stream: true });

          // 处理文本块，处理跨块的换行符
          buffer += text;
          const lines = buffer.split("\n");

          // 保留最后一个不完整的行（可能跨块）
          buffer = lines.pop() || "";

          // 处理完整的行 - 保持内容原封不动，不进行转义
          for (const line of lines) {
            collectedLines.push(line);
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
        if (sessionId !== undefined && sessionId !== currentLoadingSession) return null;

        // 处理最后剩余的内容 - 保持内容原封不动，不进行转义
        // 但跳过末尾空行（文件以 \n 结尾时 buffer 为空字符串）
        if (buffer) {
          collectedLines.push(buffer);
          lineCount++;
        }

        // 返回收集的数据，由调用方按顺序写入全局变量
        return { collectedLines, lineCount };
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
            // 对于大文件（>10MB），使用流式读取（收集数据，由顺序处理阶段写入）
            else if (typeof file.size === 'number' && file.size > LARGE_FILE_THRESHOLD) {
              const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
              const streamResult = await loadFileStreaming(file, fileName, CHUNK_SIZE, null, sessionId, filePath);
              return { index, fileName, filePath, streamed: true, streamResult };
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

          // 流式文件：按顺序写入全局变量
          if (result.streamed) {
            if (result.streamResult && result.streamResult.collectedLines) {
              const sr = result.streamResult;
              const startIndex = originalLines.length;
              const filePathAttr = result.filePath ? ` data-path="${result.filePath}"` : '';

              // 写入文件头
              originalLines.push(`=== 文件: ${result.fileName} (${sr.lineCount} 行)${filePathAttr} ===`);

              // 写入所有行
              for (const line of sr.collectedLines) {
                originalLines.push(line);
              }

              // 更新 fileHeaders
              fileHeaders.push({
                fileName: result.fileName,
                filePath: result.filePath || result.fileName,
                lineCount: sr.lineCount,
                startIndex: startIndex,
              });
            }
            continue;
          }

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
        // 去除末尾 split 产生的幽灵空行（文件以 \n 结尾时）
        if (lines.length > 0 && lines[lines.length - 1] === '') {
          lines.pop();
        }

        // 🚀 内存管理：加载新文件前检查是否超过内存上限
        if (!canLoadMoreContent(lines.length)) {
          const currentMemoryMB = (originalLines.length * 500) / (1024 * 1024);
          const errorMsg = `⚠️ 内存已满 (${currentMemoryMB.toFixed(1)}MB / 2000MB)\n\n无法加载文件：${fileName}\n\n💡 建议：请先清除部分日志（点击文件树中的取消选中），或使用过滤功能。`;

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

        // 🚀 新增：过滤模式检测（仅 rg 磁盘过滤模式才走 ripgrep 路径）
        // memory 模式下 isFileLoadMode=true，走下面的 in-memory 过滤
        if (fileLoadMode === 'filter' && filterModeFileList.length > 0) {
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

        // 使用trim检查是否为空，但保留原始值用于过滤
        if (filterText.trim() === "") {
          // cleanFilterData 已经清空，无需再次调用 resetFilter
          return;
        }

        // 新增：添加到过滤历史
        addToFilterHistory(filterText);

        // 解析过滤关键词（只支持管道符 | 分隔，逗号作为普通字符，支持转义）
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
          } else if (char === "|") {
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

        // ========== P1-3: 排除过滤（NOT 语义）==========
        // 以 - 或 ! 开头的关键词为排除词，匹配到的行会被过滤掉
        const positiveKeywords = [];
        const negativeKeywords = [];
        for (const kw of keywords) {
          if (kw.startsWith('-') || kw.startsWith('!')) {
            const neg = kw.substring(1);
            if (neg) negativeKeywords.push(neg);
          } else {
            positiveKeywords.push(kw);
          }
        }

        // 🚀 自动追加 "=== 文件:" 关键词，确保文件头始终显示在过滤结果中
        // 例如：用户输入 "battery|charge"，实际过滤为 "battery|charge|=== 文件:"
        positiveKeywords.push("=== 文件:");

        // ========== 性能优化：智能匹配策略 ==========
        // 根据关键词类型选择最快的匹配方法
        // 🔧 大小写敏感：保留原始大小写进行匹配
        const compilePatterns = (kws) => kws.map(keyword => {
          // 检查是否包含正则特殊字符
          const hasRegexSpecialChars = /[.*+?^${}()|[\]\\]/.test(keyword);

          // 优化1：纯文本关键词（最常见）- 直接使用 includes，最快
          if (!hasRegexSpecialChars && !keyword.includes(" ")) {
            return {
              type: 'simple',
              keyword,
              test: (lineContent) => lineContent.includes(keyword)
            };
          }

          // 优化2：包含空格的短语 - 使用 includes
          if (keyword.includes(" ")) {
            return {
              type: 'phrase',
              keyword,
              test: (lineContent) => lineContent.includes(keyword)
            };
          }

          // 优化3：包含特殊字符 - 使用正则表达式（最慢，但功能最强）
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

        const compiledPatterns = compilePatterns(positiveKeywords);
        const compiledNegativePatterns = compilePatterns(negativeKeywords);

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

        // 🚀 自动最大化：如果面板不是最大化状态，且用户没有手动还原过，自动最大化
        if (typeof isFilterPanelMaximized !== 'undefined' && !isFilterPanelMaximized && typeof filteredPanelState !== 'undefined' && filteredPanelState.userPreference !== 'normal') {
          if (typeof saveFilteredPanelState === 'function') saveFilteredPanelState();
          filteredPanel.classList.add("maximized");
          filteredPanel.style.removeProperty('height');
          filteredPanel.style.removeProperty('width');
          if (typeof filteredPanelLineHeight !== 'undefined') filteredPanel.style.removeProperty('--filtered-panel-top');
          isFilterPanelMaximized = true;
          const maximizeBtn = typeof DOMCache !== 'undefined' ? DOMCache.get('filteredPanelMaximize') : null;
          if (maximizeBtn) maximizeBtn.textContent = '❐';
          console.log('[Filter] 自动最大化过滤面板');
        }

        // 🔧 文件树和过滤面板共存：不再隐藏文件树

        // 🔧 在清空数据之前，记住当前可见区域的中心行 originalIndex
        // 这样过滤完成后可以自动跳回该行（如果该行仍存在）
        if (lastClickedOriginalIndex < 0 && filteredPanelAllOriginalIndices.length > 0) {
          const fpc = DOMCache.get('filteredPanelContent');
          if (fpc) {
            const prevScrollTop = fpc.scrollTop;
            const prevPanelHeight = fpc.clientHeight;
            const lh = typeof filteredPanelLineHeight !== 'undefined' ? filteredPanelLineHeight : 19;
            const visStart = Math.floor(prevScrollTop / lh);
            const visEnd = Math.ceil((prevScrollTop + prevPanelHeight) / lh);
            const centerIdx = Math.floor((visStart + visEnd) / 2);
            if (centerIdx >= 0 && centerIdx < filteredPanelAllOriginalIndices.length) {
              lastClickedOriginalIndex = filteredPanelAllOriginalIndices[centerIdx];
              console.log(`[applyFilter] 📍 记忆可见区域中心行: originalIndex=${lastClickedOriginalIndex} (在清空数据前)`);
            }
          }
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
          startIncrementalFilter(keywords, compiledPatterns, compiledNegativePatterns, getCachedUnescape);
        }, 0);

        // 提前返回，避免继续执行下面的代码
        return;
      }

      // 🚀 增量过滤函数（独立出来便于多线程扩展）
      function startIncrementalFilter(keywords, compiledPatterns, compiledNegativePatterns, getCachedUnescape) {
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

            // P1-3: 排除过滤逻辑 — 匹配正面词 && 不匹配负面词
            // 检查是否包含任何正面关键词（使用预编译的模式）
            let matchesPositive = false;
            for (const pattern of compiledPatterns) {
              if (pattern.test(lineContent)) {
                matchesPositive = true;
                break;
              }
            }

            // 如果匹配正面词，还需检查是否被负面词排除
            let excluded = false;
            if (matchesPositive && compiledNegativePatterns.length > 0) {
              for (const pattern of compiledNegativePatterns) {
                if (pattern.test(lineContent)) {
                  excluded = true;
                  break;
                }
              }
            }

            if (matchesPositive && !excluded) {
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
            if (fileLoadMode === 'memory') {
              // 仅内存模式：不渲染主日志框，只更新统计提示
              showMemoryModeStats();
            } else {
              renderLogLines();
              outer.scrollTop = 0;
              updateVisibleLines();
            }
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

          // 🔧 跳转完成后重置，让下次过滤重新捕获视口中心行
          lastClickedOriginalIndex = -1;

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

          // 🆕 每次过滤后自动最大化过滤面板（尊重用户手动还原的偏好）
          if (!isFilterPanelMaximized && filteredPanelState.userPreference !== 'normal' && typeof toggleFilterPanelMaximize === 'function') {
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
        // 仅内存模式：不渲染主日志框，显示统计信息
        if (fileLoadMode === 'memory') {
          showMemoryModeStats();
          return;
        }
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
        // 仅内存模式：不渲染主日志框
        if (fileLoadMode === 'memory') return;

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

        // 🔧 修复字体变形：压缩模式下的锚点计算
        let compressionAnchor = 0;
        let compressionFirstLine = 0;
        if (virtualScrollScale > 1) {
          compressionFirstLine = firstVisibleLine;
          compressionAnchor = lineToScrollTop(compressionFirstLine);
        }

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
          if (virtualScrollScale > 1) {
            // 🔧 修复字体变形：压缩模式下按正常行高排列可见行
            const newY = compressionAnchor + (i - compressionFirstLine) * lineHeight;
            line.style.transform = `translateY(${newY}px)`;
            line.style.height = lineHeight + "px";
            line.style.lineHeight = lineHeight + "px";
          } else {
            const translateY = lineToScrollTop(i);
            line.style.transform = `translateY(${translateY}px)`;
          }
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

      /**
       * 🔧 保存主日志框中的文本选区（基于行索引和行内偏移）
       * 返回 null 表示没有有效选区
       */
      function _saveMainLogSelection() {
        try {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount || sel.isCollapsed) return null;

          const range = sel.getRangeAt(0);

          // 快速祖先链检查：从 commonAncestor 向上走，避免 contains() 的子树遍历
          let node = range.commonAncestorContainer;
          while (node) {
            if (node === inner) break;
            node = node.parentNode;
          }
          if (!node) return null; // 不在 inner 内

          // 向上查找到 .log-line 或 .file-header 祖先
          function findLineEl(node) {
            while (node && node !== inner) {
              if (node.nodeType === 1 && (node.classList.contains('log-line') || node.classList.contains('file-header'))) {
                return node;
              }
              node = node.parentNode;
            }
            return null;
          }

          // 计算文本节点在所属行元素中的累计偏移
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
            anchorLine: parseInt(anchorLineEl.dataset.index),
            anchorOffset: textOffsetInLine(range.startContainer, range.startOffset, anchorLineEl),
            focusLine: parseInt(focusLineEl.dataset.index),
            focusOffset: textOffsetInLine(range.endContainer, range.endOffset, focusLineEl),
          };
        } catch (e) {
          return null;
        }
      }

      /**
       * 🔧 根据保存的行索引和偏移恢复主日志框的文本选区
       */
      function _restoreMainLogSelection(saved) {
        if (!saved || !inner) return;
        try {
          const anchorEl = inner.querySelector(`.log-line[data-index="${saved.anchorLine}"], .file-header[data-index="${saved.anchorLine}"]`);
          const focusEl = inner.querySelector(`.log-line[data-index="${saved.focusLine}"], .file-header[data-index="${saved.focusLine}"]`);
          if (!anchorEl || !focusEl) return; // 行不在当前可见范围

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
          // 静默失败，不影响滚动
        }
      }

      // 更新可见行（始终基于原始日志）- DOM池化优化版本
      function updateVisibleLines() {
        if (originalLines.length === 0) return;
        // 仅内存模式：不渲染主日志框（内容只在内存中，供过滤使用）
        if (fileLoadMode === 'memory') return;

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

        // 🔧 保存当前文本选区（基于行索引），放在 early return 之后避免无意义开销
        const savedSelection = _saveMainLogSelection();

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

        // 🔧 修复：主日志框不应该应用过滤关键词高亮，也不应用自定义高亮（仅限过滤面板）
        // 预计算常用变量
        const hasSearchKeyword = !!searchKeyword;
        const hasCustomHighlights = false; // 主日志框不应用自定义高亮
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

        // 🔧 修复字体变形：压缩模式下，以首个可见行的压缩位置为锚点，
        // 将可见行按正常行高重新排列，避免行重叠导致字体变形
        let compressionAnchor = 0;
        let compressionFirstLine = 0;
        if (virtualScrollScale > 1) {
          compressionFirstLine = firstVisibleLine;
          compressionAnchor = lineToScrollTop(compressionFirstLine);
        }

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
          if (virtualScrollScale > 1) {
            // 🔧 修复字体变形：压缩模式下，以锚点为基准按正常行高排列可见行
            // 这样可见区域内的行间距保持 lineHeight，文字不会因挤压而变形
            const newY = compressionAnchor + (i - compressionFirstLine) * lineHeight;
            line.style.transform = `translateY(${newY}px)`;
            line.style.height = lineHeight + "px";
            line.style.lineHeight = lineHeight + "px";
          } else {
            const translateY = lineToScrollTop(i);
            line.style.transform = `translateY(${translateY}px)`;
          }

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
              // 🔧 主日志框不传递搜索关键词和自定义高亮（仅限过滤面板）
              displayContent = applyBatchHighlight(displayContent, {
                searchKeyword: '',
                customHighlights: [], // 主日志框不应用自定义高亮
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

        // 🔧 恢复文本选区（DOM回收后根据行索引重新定位）
        _restoreMainLogSelection(savedSelection);
      }

