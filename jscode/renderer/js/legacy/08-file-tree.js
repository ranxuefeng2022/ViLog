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
          const isVisible = fileTreeContainer.classList.contains("visible");
          // 强制设置按钮位置（根据文件树实际可见状态）
          if (isVisible) {
            const finalWidth = fileTreeDockedWidthPx || 360;
            fileTreeCollapseBtn.style.left = finalWidth + "px";
            outer.style.left = finalWidth + "px";
            hScroll.style.left = finalWidth + "px";
            document.documentElement.style.setProperty("--file-tree-width", finalWidth + "px");
            document.documentElement.style.setProperty("--content-margin-left", "0px");
          } else {
            fileTreeCollapseBtn.style.left = "0";
            outer.style.left = "0";
            hScroll.style.left = "0";
            document.documentElement.style.setProperty("--file-tree-width", "0px");
            document.documentElement.style.setProperty("--content-margin-left", "6px");
          }
        }, 150);

        // 文件树边框上的展开/隐藏按钮点击事件
        fileTreeCollapseBtn.addEventListener("click", toggleFileTree);

        // ========== 智能折叠/展开事件监听 ==========

        // 鼠标靠近屏幕左边缘40px时自动展开文件树
        document.addEventListener("mousemove", function(e) {
          // 🚀 记录鼠标位置
          _currentMouseX = e.clientX;
          _currentMouseY = e.clientY;
          if (isFileTreeFloating) return;
          if (isFileTreeResizing) return;
          const isVisible = fileTreeContainer.classList.contains("visible");
          if (!isVisible && e.clientX <= 40) {
            smartExpandFileTree();
          }
        });

        // 鼠标进入文件树 → 清除折叠定时器，保持展开
        fileTreeContainer.addEventListener("mouseenter", function() {
          focusOnFileTree = true;
          if (smartCollapseTimer) {
            clearTimeout(smartCollapseTimer);
            smartCollapseTimer = null;
          }
          // 兜底：鼠标回到文件树时，fs.watch 可能漏掉了之前外部软件的变更，
          // 对已展开目录做一次增量 diff
          scheduleStaleDirectoryRefresh();
        });

        // 鼠标离开文件树 → 启动折叠定时器
        fileTreeContainer.addEventListener("mouseleave", function() {
          focusOnFileTree = false;
          // 鼠标离开时主动失焦搜索框，避免smartCollapseFileTree因焦点检测而无限重试
          if (document.activeElement === fileTreeSearch) {
            fileTreeSearch.blur();
          }
          resetSmartCollapseTimer();
        });

        // 鼠标在折叠按钮上 → 清除折叠定时器
        fileTreeCollapseBtn.addEventListener("mouseenter", function() {
          if (smartCollapseTimer) {
            clearTimeout(smartCollapseTimer);
            smartCollapseTimer = null;
          }
        });
        fileTreeCollapseBtn.addEventListener("mouseleave", function() {
          resetSmartCollapseTimer();
        });

        // 悬浮文件树遮罩点击：关闭悬浮文件树
        if (fileTreeFloatingOverlay) {
          fileTreeFloatingOverlay.addEventListener("click", () => {
            if (isFileTreeFloating) hideFloatingFileTree();
          });
        }

        // 文件树搜索功能 - 🔧 修复：输入时立即更新高亮
        // 🚀 性能优化：搜索输入防抖，快速打字时避免每次 keypress 都 rebuild
        let fileTreeSearchDebounce = null;
        fileTreeSearch.addEventListener("input", function (e) {
          fileTreeSearchTerm = e.target.value;

          // 🔧 搜索词为空时，立即恢复默认视图（不防抖）
          if (!fileTreeSearchTerm.trim()) {
            clearTimeout(fileTreeSearchDebounce);
            fileTreeSearchDebounce = null;
            fileTreeSearchShowOnlyMatches = false;
            temporarilyIncludedNodes.clear();
            rebuildFileTreeVisibleCache();
            renderFileTreeViewport(true);
            return;
          }

          // 🚀 防抖 150ms：快速打字时只执行最后一次
          clearTimeout(fileTreeSearchDebounce);
          fileTreeSearchDebounce = setTimeout(() => {
            fileTreeSearchDebounce = null;

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
              // 自动滚动到第一个匹配项
              if (fileTreeMatchedIndices.length > 0) {
                scrollToFileTreeItem(fileTreeMatchedIndices[0]);
              }
            }
          }, 150);
        });

        // 🚀 按Enter键时的处理
        // 🔧 搜索框失焦时，如果鼠标已不在文件树区域内，触发智能折叠
        fileTreeSearch.addEventListener("blur", function() {
          // 延迟检查，让 mouseleave 事件先触发
          setTimeout(() => {
            if (isSmartCollapsed && !focusOnFileTree) {
              resetSmartCollapseTimer();
            }
          }, 50);
        });

        fileTreeSearch.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();

            let inputTerm = e.target.value;
            console.log(`[文件树搜索] Enter键, term="${inputTerm}", 模式=${fileLoadMode}`);

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
              // 🚀 二次 Enter：关键词未变时，全选当前过滤出的所有文件
              if (fileTreeSearchShowOnlyMatches && inputTerm === fileTreeLastEnterSearchTerm && inputTerm.trim() !== "") {
                // 🔧 修复：清空旧选区和已加载文件索引，确保 loadSelectedFiles 走清空重新加载路径
                // 否则旧文件内容会被保留（增量追加模式），导致主日志框同时显示旧内容和新内容
                selectedFiles = [];
                selectionOrderCounter = 0;
                loadedFileIndices.clear();

                let selectCount = 0;
                for (let i = 0; i < fileTreeAllVisibleIndices.length; i++) {
                  const idx = fileTreeAllVisibleIndices[i];
                  const item = fileTreeHierarchy[idx];
                  if (item && item.type === "file") {
                    selectedFiles.push({ index: idx, order: ++selectionOrderCounter });
                    item.selected = true;
                    selectCount++;
                  }
                }
                renderFileTreeViewport(true);
                console.log(`[文件树搜索] 二次Enter全选，新增 ${selectCount} 个文件`);
                if (selectCount > 0) {
                  // 加载模式：自动加载内容到主日志框；过滤模式：只收集文件路径供过滤
                  loadSelectedFiles();
                } else {
                  showMessage("没有可选择的文件（已全部选中或无匹配）");
                }
              } else if (fileLoadMode === 'filter') {
                // 🔍 过滤模式：只记录匹配的文件路径，不加载内容
                fileTreeSearchTerm = inputTerm;
                fileTreeSearchShowOnlyMatches = true;
                fileTreeLastEnterSearchTerm = inputTerm;
                filterFileTree();

                // 收集所有匹配的文件路径
                collectFilteredFilePaths();
                // 自动滚动到第一个匹配项
                setTimeout(() => {
                  if (fileTreeMatchedIndices.length > 0) {
                    scrollToFileTreeItem(fileTreeMatchedIndices[0]);
                  }
                }, 250);
              } else {
                // 📥 加载模式（默认行为）：启用过滤
                fileTreeSearchTerm = inputTerm;
                fileTreeSearchShowOnlyMatches = true;
                fileTreeLastEnterSearchTerm = inputTerm;
                console.log(`[文件树搜索] 调用 filterFileTree`);
                filterFileTree();
                // 自动滚动到第一个匹配项
                setTimeout(() => {
                  if (fileTreeMatchedIndices.length > 0) {
                    scrollToFileTreeItem(fileTreeMatchedIndices[0]);
                  }
                }, 250);
              }
            }
          } else if (e.key === "Escape") {
            // ESC键清空搜索并恢复默认行为
            e.preventDefault();
            e.stopPropagation();
            fileTreeSearch.value = "";
            fileTreeSearchTerm = "";
            fileTreeSearchShowOnlyMatches = false;
            fileTreeLastEnterSearchTerm = "";
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
            // 二态循环：load → filter → load（已移除仅内存模式）
            const prevMode = fileLoadMode;
            if (fileLoadMode === 'load') {
              fileLoadMode = 'filter';
            } else {
              fileLoadMode = 'load';
            }
            isFileLoadMode = (fileLoadMode === 'load');
            updateLoadModeButton();

            // 切换模式时的提示和清理
            if (fileLoadMode === 'load') {
              // 切换到加载模式
              showMessage('已切换到加载模式：文件将加载到主日志框');
              filterModeFileList = [];
              // 如果 originalLines 有数据，渲染出来
              if (originalLines.length > 0) {
                resetFilter(false);
                renderLogLines();
              }
            } else {
              // 切换到过滤模式
              showMessage('已切换到过滤模式：选中文件后，在过滤框输入关键词即可过滤');

              // 清空主日志框内容和内存数据
              console.log('[切换模式] 清空主日志框和选中文件');

              if (originalLines.length > 0) {
                console.log('[切换模式] 清空 originalLines，共', originalLines.length, '行');
                cleanFilterData();
                originalLines = [];
              }

              if (typeof fileHeaders !== 'undefined' && fileHeaders.length > 0) {
                fileHeaders = [];
              }

              if (typeof currentFiles !== 'undefined' && currentFiles.length > 0) {
                currentFiles = [];
              }

              const innerContainer = document.getElementById('innerContainer');
              const outerContainer = DOMCache.get('outerContainer');

              if (innerContainer) {
                innerContainer.innerHTML = '';
              }
              if (outerContainer) {
                outerContainer.scrollTop = 0;
              }

              const placeholder = document.getElementById('logPlaceholder');
              if (placeholder) {
                placeholder.remove();
              }

              renderLogLines();
              cleanFilterData();

              if (selectedFiles.length > 0) {
                clearFileSelection();
                renderFileTreeViewport(true);
              }

              filterModeFileList = [];
              console.log('[切换模式] 清空完成');
            }
          });

          // 更新按钮状态
          function updateLoadModeButton() {
            const modeIcon = toggleLoadModeBtn.querySelector('.mode-icon');
            toggleLoadModeBtn.classList.remove('filter-mode', 'memory-mode');
            if (fileLoadMode === 'load') {
              toggleLoadModeBtn.title = '当前：加载模式（点击切换到过滤模式）';
              modeIcon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2v8M4 7l4 4 4-4M2 13h12" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            } else {
              toggleLoadModeBtn.classList.add('filter-mode');
              toggleLoadModeBtn.title = '当前：过滤模式（点击切换到加载模式）';
              modeIcon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2h12L9.5 8.5V13l-3 1.5V8.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
            }
            // 同步兼容变量
            isFileLoadMode = (fileLoadMode === 'load');
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
        // 文件树内任意 mousedown 先关闭右键菜单（handleFileTreeMouseDown 中有 stopPropagation，全局 listener 收不到）
        fileTreeList.addEventListener("mousedown", () => hideFileTreeContextMenu());
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

        // 删除文件/文件夹
        if (fileTreeCtxDeleteFile) {
          fileTreeCtxDeleteFile.addEventListener("click", async () => {
            const idx = fileTreeContextMenuIndex;
            const item = fileTreeHierarchy[idx];
            hideFileTreeContextMenu();
            if (!item || !item.path) return;
            if (item.isArchiveChild || item.isRemote) return;
            try {
              const result = await window.electronAPI.deleteFile(item.path);
              if (result && result.success) {
                // 从 hierarchy 中移除该项（文件夹或展开的压缩包则连同子项一起移除）
                const deleteStart = idx;
                const nextItem = fileTreeHierarchy[idx + 1];
                const hasChildren = nextItem && (nextItem.level ?? 0) > (item.level ?? 0);
                const deleteEnd = hasChildren
                  ? getFolderSubtreeEndIndex(idx)
                  : idx + 1;
                const deleteCount = deleteEnd - deleteStart;
                fileTreeHierarchy.splice(deleteStart, deleteCount);
                // 从选中列表中移除
                if (Array.isArray(selectedFiles)) {
                  selectedFiles = selectedFiles.filter(i => i < deleteStart || i >= deleteEnd);
                  selectedFiles = selectedFiles.map(i => i >= deleteStart ? i - deleteCount : i);
                }
                renderFileTreeViewport(true);
              } else {
                showMessage('⚠️ 删除失败: ' + (result?.error || '未知错误'));
              }
            } catch (e) {
              showMessage('⚠️ 删除失败: ' + e.message);
            }
          });
        }

        // 刷新
        if (fileTreeCtxRefresh) {
          fileTreeCtxRefresh.addEventListener("click", () => {
            hideFileTreeContextMenu();
            clearMainLogContent();
          });
        }

        // 解压到当前目录
        if (fileTreeCtxExtractArchive) {
          fileTreeCtxExtractArchive.addEventListener("click", async () => {
            const idx = fileTreeContextMenuIndex;
            hideFileTreeContextMenu();
            await extractArchiveToSubDir(idx);
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

        // 流式加载大文件阈值：超过 50MB 使用流式读取，峰值内存降低 60-70%
        const STREAMING_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB

        /**
         * 使用流式读取方式加载文件
         * @param {string} filePath - 文件路径
         * @param {string} displayName - 显示名称
         * @returns {Promise<number>} 加载的行数
         */
        async function loadFileWithStreaming(filePath, displayName) {
          let chunkHandler = null;
          let pendingLines = [];
          let totalLines = 0;
          const FLUSH_INTERVAL = 10000; // 每 10000 行批量写入一次 originalLines

          return new Promise((resolve, reject) => {
            // 注册数据块监听
            chunkHandler = window.electronAPI.receiveFileChunk((lines) => {
              // 检查结束标记
              if (lines.length === 2 && lines[0] === '__STREAM_END__') {
                totalLines = parseInt(lines[1]) || totalLines;

                // 刷出剩余行
                if (pendingLines.length > 0) {
                  const startIdx = originalLines.length;
                  originalLines.length += pendingLines.length;
                  for (let i = 0; i < pendingLines.length; i++) {
                    originalLines[startIdx + i] = pendingLines[i];
                  }
                  pendingLines = [];
                }

                // 清理监听
                if (chunkHandler) {
                  window.electronAPI.removeFileChunkListener(chunkHandler);
                  chunkHandler = null;
                }

                // 更新文件头中的行数
                if (fileHeaders.length > 0) {
                  fileHeaders[fileHeaders.length - 1].lineCount = totalLines;
                  // 更新 header 行显示
                  originalLines[fileHeaders[fileHeaders.length - 1].startIndex] =
                    `=== 文件: ${displayName} (${totalLines} 行) ===`;
                }

                // 渲染
                resetFilter(false);
                if (fileLoadMode === 'memory') {
                  showMemoryModeStats();
                } else {
                  renderLogLines();
                }
                selectedOriginalIndex = -1;
                if (outer) outer.scrollTop = 0;

                showMessage(`已加载 ${totalLines} 行`);
                console.log(`[streaming] 流式加载完成: ${displayName}, ${totalLines} 行`);
                resolve(totalLines);
                return;
              }

              // 检查二进制文件标记
              if (lines.length === 1 && lines[0].startsWith('[二进制文件')) {
                if (chunkHandler) {
                  window.electronAPI.removeFileChunkListener(chunkHandler);
                  chunkHandler = null;
                }
                showMessage(lines[0]);
                resolve(0);
                return;
              }

              // 累积行数据
              pendingLines.push(...lines);

              // 积攒足够多时批量写入
              if (pendingLines.length >= FLUSH_INTERVAL) {
                const startIdx = originalLines.length;
                originalLines.length += pendingLines.length;
                for (let i = 0; i < pendingLines.length; i++) {
                  originalLines[startIdx + i] = pendingLines[i];
                }
                pendingLines = [];
              }
            });

            // 启动流式读取
            window.electronAPI.readFileStreaming(filePath).then((result) => {
              if (!result.success) {
                if (chunkHandler) {
                  window.electronAPI.removeFileChunkListener(chunkHandler);
                  chunkHandler = null;
                }
                reject(new Error(result.error || '流式读取失败'));
              }
            }).catch((err) => {
              if (chunkHandler) {
                window.electronAPI.removeFileChunkListener(chunkHandler);
                chunkHandler = null;
              }
              reject(err);
            });
          });
        }

        // 直接加载文件
        async function loadDirectFile(filePath) {
          console.log(`[路径输入] 直接加载文件: ${filePath}`);

          if (!window.electronAPI || !window.electronAPI.readFile) {
            showMessage('读取文件 API 不可用');
            return;
          }

          // 先检查文件大小
          let useStreaming = false;
          try {
            const fsCheck = await window.electronAPI.fileExists(filePath);
            if (fsCheck && fsCheck.size > STREAMING_FILE_THRESHOLD) {
              useStreaming = true;
              console.log(`[路径输入] 文件 ${(fsCheck.size / 1048576).toFixed(1)}MB 超过阈值，使用流式加载`);
            }
          } catch (e) {
            // 无法获取文件大小，使用常规方式
          }

          // 清理旧数据
          cleanLogData();

          if (useStreaming) {
            // 流式加载大文件
            originalLines = [];
            fileHeaders = [];
            fileHeaders.push({
              fileName: filePath,
              lineCount: 0, // 流式加载完成后更新
              startIndex: 0
            });
            originalLines.push(`=== 文件: ${filePath} (加载中...) ===`);

            try {
              await loadFileWithStreaming(filePath, filePath);
            } catch (error) {
              console.error('[路径输入] 流式加载失败:', error);
              showMessage('流式加载失败: ' + error.message);
            }
            return;
          }

          // 常规加载（小文件）
          const result = await window.electronAPI.readFile(filePath);
          if (!result.success) {
            throw new Error(result.error || '读取文件失败');
          }

          const content = result.content;
          if (content === null || content === undefined) {
            throw new Error('文件内容为空');
          }

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
          if (fileLoadMode === 'memory') {
            showMemoryModeStats();
          } else {
            renderLogLines();
          }
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

        // 'reopen' 事件表示 watcher ENOSPC 后需要重建，刷新当前目录
        if (eventType === 'reopen') {
          console.log(`[文件监听] watcher 重建，刷新目录: ${dirPath}`);
          refreshDirectoryInTree(dirPath);
          return;
        }

        const now = Date.now();
        // 记录首次事件时间，用于最大等待
        if (!window._directoryChangeFirstTime) {
          window._directoryChangeFirstTime = now;
        }
        const elapsed = now - window._directoryChangeFirstTime;

        if (window._directoryChangeTimeout) {
          clearTimeout(window._directoryChangeTimeout);
        }

        // 防抖 300ms，但最多等 2 秒（防止长下载期间永不刷新）
        const waitTime = elapsed > 2000 ? 0 : 300;

        window._directoryChangeTimeout = setTimeout(() => {
          window._directoryChangeFirstTime = null;
          console.log(`[文件监听] 刷新目录: ${dirPath} (已等待${elapsed + waitTime}ms)`);
          refreshDirectoryInTree(dirPath);
        }, waitTime);
      }

      // 刷新文件树中的目录（增量 diff）
      async function refreshDirectoryInTree(dirPath) {
        try {
          const normalizedPath = dirPath.replace(/\\/g, '/').replace(/\/$/, '');

          // 查找文件树中匹配的已展开节点
          for (let i = 0; i < fileTreeHierarchy.length; i++) {
            const node = fileTreeHierarchy[i];
            const nodePath = (node.path || '').replace(/\\/g, '/').replace(/\/$/, '');

            if (nodePath !== normalizedPath) continue;
            if (!node.expanded || !node.childrenLoaded) return;

            // 读取目录最新内容
            if (!window.electronAPI || !window.electronAPI.listDirectory) return;
            const result = await window.electronAPI.listDirectory(node.path);
            if (!result.success || !result.items) return;

            // 构建最新文件的 name->item 映射
            const latestMap = {};
            for (const item of result.items) {
              latestMap[item.name] = item;
            }

            // 收集当前直接子项
            const childLevel = node.level + 1;
            const currentChildren = [];
            let childEnd = i + 1;
            for (let j = i + 1; j < fileTreeHierarchy.length; j++) {
              const child = fileTreeHierarchy[j];
              if (child.level < childLevel) break;
              if (child.level === childLevel) {
                currentChildren.push({ index: j, node: child, name: child.name });
              }
              childEnd = j + 1;
            }

            // 构建当前子项的 name->index 映射
            const currentMap = {};
            for (const c of currentChildren) {
              currentMap[c.name] = c;
            }

            // 找出需要删除的项（当前有但最新没有）
            const toDelete = [];
            for (const c of currentChildren) {
              if (!latestMap[c.name]) {
                const subtreeEnd = getFolderSubtreeEndIndex(c.index);
                toDelete.push({ start: c.index, end: subtreeEnd });
              }
            }

            // 找出需要新增的项（最新有但当前没有），按最新排序位置插入
            const toAdd = [];
            for (const item of result.items) {
              if (!currentMap[item.name]) {
                toAdd.push(item);
              }
            }

            // 执行删除（从后往前，避免索引偏移）
            let totalDeleted = 0;
            for (let d = toDelete.length - 1; d >= 0; d--) {
              const count = toDelete[d].end - toDelete[d].start;
              fileTreeHierarchy.splice(toDelete[d].start, count);
              totalDeleted += count;
            }

            // 如果有删除，需要重新定位 childEnd
            if (totalDeleted > 0) {
              childEnd -= totalDeleted;
            }

            // 执行新增（按最新列表的顺序找到正确的插入位置）
            if (toAdd.length > 0) {
              // 重新扫描当前子项（删除后的索引）
              const newChildNames = new Set();
              for (let j = i + 1; j < fileTreeHierarchy.length; j++) {
                const child = fileTreeHierarchy[j];
                if (child.level < childLevel) break;
                if (child.level === childLevel) {
                  newChildNames.add(child.name);
                }
              }

              // 对 toAdd 按照最新排序的顺序确定插入位置
              // 遍历最新列表，每当遇到一个 toAdd 项，找到它前面最近的已存在项作为锚点
              let insertOffset = 0;
              for (const item of result.items) {
                if (!currentMap[item.name] && latestMap[item.name]) {
                  // 这是一个新增项，找到插入位置
                  const isArchive = item.type === 'archive' || item.isArchive;
                  const newNodes = [{
                    name: item.name,
                    path: item.path,
                    type: item.type,
                    expanded: false,
                    level: childLevel,
                    file: null,
                    childrenLoaded: false,
                    loadingChildren: false,
                    isLocalDrive: true,
                    isArchive: isArchive,
                    archiveName: isArchive ? item.path : undefined,
                    size: item.size || 0
                  }];

                  // 找到插入位置：在 i+1 之后，所有 level <= node.level 的位置之前
                  // 或者更精确：按字母顺序找到正确位置
                  let insertPos = i + 1 + insertOffset;
                  for (let j = i + 1 + insertOffset; j < fileTreeHierarchy.length; j++) {
                    const child = fileTreeHierarchy[j];
                    if (child.level < childLevel) break;
                    if (child.level === childLevel) {
                      // 比较排序顺序：文件夹/压缩包在前，文件在后
                      const itemIsFolder = item.type === 'folder' || item.type === 'archive';
                      const childIsFolder = child.type === 'folder' || child.type === 'archive';
                      if (itemIsFolder && !childIsFolder) break;
                      if (!itemIsFolder && childIsFolder) { insertPos = j + 1 + insertOffset; continue; }
                      // 同类型按名称比较
                      if (item.name.localeCompare(child.name, undefined, { numeric: true }) <= 0) break;
                      insertPos = j + 1 + insertOffset;
                    } else {
                      insertPos = j + 1 + insertOffset;
                    }
                  }

                  fileTreeHierarchy.splice(insertPos, 0, ...newNodes);
                  insertOffset += newNodes.length;
                }
              }
            }

            if (toDelete.length > 0 || toAdd.length > 0) {
              rebuildFileTreeVisibleCache();
              renderFileTreeViewport(true);
            }
            return;
          }
        } catch (error) {
          console.error('[文件监听] 增量刷新目录失败:', error);
        }
      }

      // 鼠标回到文件树时，兜底刷新 fs.watch 漏掉的变更
      var _lastStaleRefresh = 0;
      var _staleRefreshTimer = null;
      var _staleRefreshRunning = false;
      function scheduleStaleDirectoryRefresh() {
        var now = Date.now();
        // 节流：5 秒内不重复触发
        if (now - _lastStaleRefresh < 5000) return;
        if (_staleRefreshRunning) return;

        if (_staleRefreshTimer) clearTimeout(_staleRefreshTimer);
        // 延时 500ms：避免鼠标快速划过触发不必要的刷新
        _staleRefreshTimer = setTimeout(async function() {
          _staleRefreshTimer = null;
          _staleRefreshRunning = true;
          _lastStaleRefresh = Date.now();

          try {
            // 收集所有已展开且有子项的目录
            var refreshPaths = [];
            for (var i = 0; i < fileTreeHierarchy.length; i++) {
              var node = fileTreeHierarchy[i];
              if (node.expanded && node.childrenLoaded) {
                refreshPaths.push({ index: i, path: node.path });
              }
            }
            // 顺序刷新，避免并发修改 fileTreeHierarchy
            for (var r = 0; r < refreshPaths.length; r++) {
              await refreshDirectoryInTree(refreshPaths[r].path);
            }
          } catch (e) {
            console.error('[文件监听] 兜底刷新失败:', e);
          } finally {
            _staleRefreshRunning = false;
          }
        }, 500);
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
      const MAX_WATCHED_DIRECTORIES = 50;

      async function startWatchingDirectory(dirPath) {
        if (!window.electronAPI || !window.electronAPI.watchDirectory) return;

        const normalizedPath = dirPath.replace(/\\/g, '/').replace(/\/$/, '');
        if (watchedDirectories.has(normalizedPath)) return;

        // 超过上限时跳过
        if (watchedDirectories.size >= MAX_WATCHED_DIRECTORIES) {
          console.log(`[文件监听] 已达上限 ${MAX_WATCHED_DIRECTORIES}，跳过: ${normalizedPath}`);
          return;
        }

        try {
          const result = await window.electronAPI.watchDirectory(dirPath);
          if (result.success) {
            watchedDirectories.add(normalizedPath);
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
        // 进入悬浮模式前，清除智能折叠状态
        clearSmartCollapseState();

        // 需求：悬浮文件树打开后，左侧停靠文件树默认折叠
        // 这里强制记为"进入前停靠视为折叠"，从而关闭悬浮树后也保持折叠
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
        // "复制名称"和"删除文件"只在选中文件时显示
        if (fileTreeCtxCopyName) {
          fileTreeCtxCopyName.style.display = isBlankArea ? "none" : "";
        }

        if (fileTreeCtxDeleteFile) {
          fileTreeCtxDeleteFile.style.display = isBlankArea ? "none" : "";
          if (!isBlankArea) {
            const canDelete = !item.isArchiveChild && !item.isRemote;
            fileTreeCtxDeleteFile.disabled = !canDelete;
          }
        }

        // "刷新"始终可用
        if (fileTreeCtxRefresh) {
          fileTreeCtxRefresh.style.display = "";
        }

        // "解压到当前目录"仅对压缩包文件显示
        if (fileTreeCtxExtractArchive) {
          if (isBlankArea || !item) {
            fileTreeCtxExtractArchive.style.display = "none";
          } else {
            const isArchive = item.isArchive ||
              (item.name && /\.(zip|rar|7z|tar|gz|tgz|bz2)$/i.test(item.name)) ||
              (item.path && /\.(zip|rar|7z|tar|gz|tgz|bz2)$/i.test(item.path));
            fileTreeCtxExtractArchive.style.display = isArchive ? "" : "none";
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
          if (fileLoadMode === 'memory') {
            showMemoryModeStats();
          } else {
            renderLogLines();
          }
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
          const historySource = (typeof window.getAppFilterHistory === 'function') ? window.getAppFilterHistory() : filterHistory;
          historyItems = historySource.slice(0, 20).map((keyword, index) => ({
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
        // 退出悬浮模式时，清除智能折叠状态
        clearSmartCollapseState();

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

      // ========== 智能折叠/展开：鼠标靠近左边缘自动展开，离开后自动折叠 ==========

      // 🚀 记录当前鼠标位置，用于判断是否聚焦在主区域
      let _currentMouseX = 0;
      let _currentMouseY = 0;

      // 🔧 检查鼠标是否在主日志框或过滤面板头部区域上方
      function _isMouseOverMainArea() {
        // 检查鼠标是否在 #outerContainer（主日志框）上方
        const outerEl = typeof outer !== 'undefined' ? outer : null;
        if (outerEl) {
          const rect = outerEl.getBoundingClientRect();
          if (_currentMouseX >= rect.left && _currentMouseX <= rect.right &&
              _currentMouseY >= rect.top && _currentMouseY <= rect.bottom) {
            return true;
          }
        }
        // 检查鼠标是否在 #filteredPanelHeader 上方
        const fpHeader = document.getElementById('filteredPanelHeader');
        if (fpHeader) {
          const rect = fpHeader.getBoundingClientRect();
          if (_currentMouseX >= rect.left && _currentMouseX <= rect.right &&
              _currentMouseY >= rect.top && _currentMouseY <= rect.bottom) {
            return true;
          }
        }
        return false;
      }

      // 智能展开文件树（鼠标靠近左边缘触发）
      function smartExpandFileTree() {
        if (isFileTreeFloating) return;
        if (fileTreeContainer.classList.contains("visible")) return;
        // 拖拽调整宽度中不触发
        if (isFileTreeResizing) return;
        // 🔧 鼠标聚焦在主日志框或过滤面板头部时，不触发智能展开
        if (_isMouseOverMainArea()) return;

        isSmartCollapsed = true;
        fileTreeContainer.classList.add("visible");
        fileTreeCollapseBtn.innerHTML = "◀";
        fileTreeSearch.value = "";
        fileTreeSearchTerm = "";
        filterFileTree();
        updateLayout();
      }

      // 智能折叠文件树（鼠标离开后延时触发）
      function smartCollapseFileTree() {
        if (isFileTreeFloating) return;
        if (!fileTreeContainer.classList.contains("visible")) return;
        if (!isSmartCollapsed) return; // 只有通过智能展开的才自动折叠
        // 右键菜单打开时不折叠
        if (fileTreeContextMenu && fileTreeContextMenu.classList.contains("visible")) {
          // 重新启动定时器，延迟再试
          smartCollapseTimer = setTimeout(smartCollapseFileTree, 100);
          return;
        }
        // 搜索框聚焦时不折叠
        if (document.activeElement === fileTreeSearch) {
          smartCollapseTimer = setTimeout(smartCollapseFileTree, 100);
          return;
        }
        // 关键词过滤对话框打开时不折叠（否则关闭对话框后智能展开会失效）
        var filterDialog = document.getElementById('filterDialog');
        if (filterDialog && filterDialog.classList.contains('visible')) {
          smartCollapseTimer = setTimeout(smartCollapseFileTree, 100);
          return;
        }

        isSmartCollapsed = false;
        fileTreeContainer.classList.remove("visible");
        fileTreeCollapseBtn.innerHTML = "▶";
        updateLayout();
      }

      // 重置智能折叠定时器
      function resetSmartCollapseTimer() {
        if (smartCollapseTimer) {
          clearTimeout(smartCollapseTimer);
          smartCollapseTimer = null;
        }
        if (isSmartCollapsed) {
          smartCollapseTimer = setTimeout(smartCollapseFileTree, 100);
        }
      }

      // 清除智能折叠状态（手动操作时调用）
      function clearSmartCollapseState() {
        isSmartCollapsed = false;
        if (smartCollapseTimer) {
          clearTimeout(smartCollapseTimer);
          smartCollapseTimer = null;
        }
      }

      // 切换文件树显示/隐藏
      function toggleFileTree() {
        // 悬浮模式下，边框按钮等同于关闭悬浮树
        if (isFileTreeFloating) {
          hideFloatingFileTree();
          return;
        }

        // 手动点击按钮操作，清除智能折叠状态（不会被自动折叠）
        clearSmartCollapseState();

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

        // 🚀 同步调整过滤面板位置：文件树可见时让出左侧空间
        if (typeof _adjustFilteredPanelForFileTree === 'function') {
          _adjustFilteredPanelForFileTree(isVisible);
        }

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
        // 关键：必须用跟 renderFileTreeViewport 完全相同的行高，否则
        // 计算位置与 spacer 撑出的总高度不匹配，匹配项多时偏差累加导致跳转错位
        var rowHeight = fileTreeRowHeightPx;
        if (!rowHeight || rowHeight < 10) {
          rowHeight = measureFileTreeRowHeight() || 28;
        }
        // 如果行高跟虚拟滚动不一致，同步修正缓存
        var actualItemH = 0;
        var sampleEl = fileTreeList.querySelector('.file-tree-item');
        if (sampleEl) actualItemH = sampleEl.getBoundingClientRect().height;
        if (actualItemH > 10 && Math.abs(actualItemH - rowHeight) > 2) {
          rowHeight = actualItemH;
          fileTreeRowHeightPx = actualItemH; // 同步修正缓存
        }
        var containerHeight = fileTreeList.clientHeight;
        if (!containerHeight || containerHeight < 50) containerHeight = 300;

        // 🔧 计算目标滚动位置：
        //  - 尽量把目标放在视口上方 35% 处
        //  - 底部至少留 6 行余量
        const targetPosition = actualVisibleIndex * rowHeight;
        const contentHeight = fileTreeAllVisibleIndices.length * rowHeight;
        const maxScroll = Math.max(0, contentHeight - containerHeight);
        const BOTTOM_MARGIN_ROWS = 6;
        const idealTop = targetPosition - containerHeight * 0.35;
        const minTop = Math.max(0, targetPosition + rowHeight * BOTTOM_MARGIN_ROWS - containerHeight);
        var scrollPosition = Math.max(minTop, Math.min(maxScroll, idealTop));

        fileTreeList.scrollTop = scrollPosition;
        console.log(`[scrollToFileTreeItem] 滚动: visibleIndex=${actualVisibleIndex}, rowHeight=${rowHeight}px, scrollPosition=${scrollPosition}px, maxScroll=${maxScroll}px`);

        // 等虚拟滚动渲染后，用实测位置验证修正
        setTimeout(function() {
          var verifyEl = null;
          var allItems = fileTreeList.querySelectorAll('.file-tree-item');
          for (var vi = 0; vi < allItems.length; vi++) {
            if (parseInt(allItems[vi].dataset.index) === index) {
              verifyEl = allItems[vi];
              break;
            }
          }
          if (!verifyEl) return;
          var rect = verifyEl.getBoundingClientRect();
          var listRect = fileTreeList.getBoundingClientRect();
          var curTop = rect.top - listRect.top;
          var curBottom = rect.bottom - listRect.top;
          var curHeight = fileTreeList.clientHeight || containerHeight;
          if (curTop < curHeight * 0.1) {
            fileTreeList.scrollTop = Math.max(0, fileTreeList.scrollTop - (curHeight * 0.35 - curTop));
            console.log(`[scrollToFileTreeItem] 修正偏上: ${fileTreeList.scrollTop}px`);
          } else if (curBottom > curHeight * 0.85) {
            fileTreeList.scrollTop = Math.min(maxScroll, fileTreeList.scrollTop + (curBottom - curHeight * 0.7));
            console.log(`[scrollToFileTreeItem] 修正偏下: ${fileTreeList.scrollTop}px`);
          }
        }, 300);
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
        } else {
          // 🔧 默认模式/输入时：显示所有展开的节点（不过滤），只是高亮匹配项
          fileTreeAllVisibleIndices = expandedVisibleIndices;
          visibleFileTreeItems = fileTreeAllVisibleIndices.slice();
          visibleFileTreeItemsSet = new Set(visibleFileTreeItems);
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
          _fileTreeDomPoolClear();
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
          _fileTreeDomPoolClear();
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

        // 🚀 性能优化：差异化渲染 + DOM 池化
        // 1. 计算新增范围和移除范围，只操作差异部分
        // 2. 复用已存在的 DOM 元素，不重复创建
        const prevStart = fileTreeVirtualLastStart;
        const prevEnd = fileTreeVirtualLastEnd;
        const isForceOrFirstRender = force || prevStart === -1;

        fileTreeVirtualLastStart = start;
        fileTreeVirtualLastEnd = end;

        fileTreeVirtualTopSpacer.style.height = start * fileTreeRowHeightPx + "px";
        fileTreeVirtualBottomSpacer.style.height =
          Math.max(0, (total - end) * fileTreeRowHeightPx) + "px";

        // 🚀 性能优化：预构建 Set，避免循环内 O(N) 查找
        const selectedIndexSet = new Set(selectedFiles.map(f => f.index));
        const matchedIndexSet = fileTreeMatchedIndices.length > 0
          ? new Set(fileTreeMatchedIndices)
          : null;

        if (isForceOrFirstRender) {
          // force 或首次渲染：全量渲染（但仍然使用 DOM 池复用）
          _fileTreeDomPoolClear();
          const frag = document.createDocumentFragment();
          for (let i = start; i < end; i++) {
            const index = fileTreeAllVisibleIndices[i];
            const el = _fileTreeCreateElement(index, selectedIndexSet, matchedIndexSet);
            if (el) frag.appendChild(el);
          }
          fileTreeVirtualContent.innerHTML = "";
          fileTreeVirtualContent.appendChild(frag);
        } else {
          // 🚀 差异化渲染：只处理进入/离开视口的行
          // 移除离开视口的行
          for (let i = prevStart; i < prevEnd; i++) {
            if (i >= start && i < end) continue; // 仍在视口内，保留
            const index = fileTreeAllVisibleIndices[i];
            if (index === undefined) continue;
            _fileTreeDomPoolRelease(index);
          }

          // 🚀 新增进入视口的行
          // 分为头部新增（< prevStart）和尾部新增（>= prevEnd）两种情况
          // 头部新增：按 slot 升序，最终要在 container 最前面
          // 尾部新增：按 slot 升序，最终要在 container 最后面
          const prependElements = [];
          const appendElements = [];

          for (let i = start; i < end; i++) {
            if (i >= prevStart && i < prevEnd) continue;
            const index = fileTreeAllVisibleIndices[i];
            if (index === undefined) continue;

            const el = _fileTreeCreateElement(index, selectedIndexSet, matchedIndexSet);
            if (!el) continue;

            _ftActiveSlots.set(Number(el.dataset.index), i);
            if (i < prevStart) {
              prependElements.push(el); // 头部新增
            } else {
              appendElements.push(el); // 尾部新增
            }
          }

          const container = fileTreeVirtualContent;

          // 头部元素：倒序 insertBefore(firstChild)，保证最终顺序正确
          for (let j = prependElements.length - 1; j >= 0; j--) {
            container.insertBefore(prependElements[j], container.firstChild);
          }

          // 尾部元素：直接 appendChild（已按 slot 升序）
          for (const el of appendElements) {
            container.appendChild(el);
          }

          // 🚀 刷新仍在视口内的行（状态可能变化：selected/matched）
          for (let i = start; i < end; i++) {
            if (i >= prevStart && i < prevEnd) {
              const index = fileTreeAllVisibleIndices[i];
              _fileTreeUpdateState(index, selectedIndexSet, matchedIndexSet);
            }
          }
        }

        const renderTime = performance.now() - renderStart;
        if (renderTime > 50) {  // Only log if it takes more than 50ms
          console.log(`⚠️ renderFileTreeViewport 耗时: ${renderTime.toFixed(2)}ms (items: ${end - start}, force=${force})`);
        }
      }

