      // 选中索引偏移：当 fileTreeHierarchy 插入/删除节点时，同步更新 selectedFiles 的 index
      function shiftSelectedIndices(fromIndex, delta) {
        if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) return;
        for (var i = 0; i < selectedFiles.length; i++) {
          var f = selectedFiles[i];
          var idx = (typeof f === 'object' && f !== null) ? f.index : f;
          if (typeof idx === 'number' && idx >= fromIndex) {
            if (typeof f === 'object' && f !== null) {
              f.index = idx + delta;
            } else {
              selectedFiles[i] = idx + delta;
            }
          }
        }
      }

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
            var _cpbInit = document.getElementById('chunkProgressBar');
            if (_cpbInit) _cpbInit.style.left = finalWidth + "px";
            document.documentElement.style.setProperty("--file-tree-width", finalWidth + "px");
            document.documentElement.style.setProperty("--content-margin-left", "0px");
          } else {
            fileTreeCollapseBtn.style.left = "0";
            outer.style.left = "0";
            hScroll.style.left = "0";
            var _cpbInit2 = document.getElementById('chunkProgressBar');
            if (_cpbInit2) _cpbInit2.style.left = "0";
            document.documentElement.style.setProperty("--file-tree-width", "0px");
            document.documentElement.style.setProperty("--content-margin-left", "6px");
          }
        }, 150);

        // 文件树边框上的展开/隐藏按钮点击事件
        fileTreeCollapseBtn.addEventListener("click", toggleFileTree);

        // 🚀 Tab bar 点击事件
        if (fileTreeTabBar) {
          fileTreeTabBar.addEventListener("click", function(e) {
            var tab = e.target.closest('.file-tree-tab');
            if (!tab || tab.disabled) return;
            var tabPath = tab.dataset.tab;
            if (tabPath) switchFileTreeTab(tabPath);
          });
        }

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

        // 搜索清除按钮
        const fileTreeSearchClearBtn = fileTreeSearch.parentElement.querySelector('.file-tree-search-clear');
        if (fileTreeSearchClearBtn) {
          fileTreeSearchClearBtn.addEventListener('click', () => {
            fileTreeSearch.value = '';
            fileTreeSearchTerm = '';
            fileTreeSearchShowOnlyMatches = false;
            fileTreeSearchNavIndex = -1;
            temporarilyIncludedNodes.clear();
            clearTimeout(fileTreeSearchDebounce);
            fileTreeSearchDebounce = null;
            rebuildFileTreeVisibleCache();
            renderFileTreeViewport(true);
            fileTreeSearch.focus();
          });
        }

        fileTreeSearch.addEventListener("input", function (e) {
          fileTreeSearchTerm = e.target.value;
          fileTreeSearchNavIndex = -1;

          // 搜索词为空时，立即恢复默认视图（不防抖）
          if (!fileTreeSearchTerm.trim()) {
            clearTimeout(fileTreeSearchDebounce);
            fileTreeSearchDebounce = null;
            fileTreeSearchShowOnlyMatches = false;
            temporarilyIncludedNodes.clear();
            rebuildFileTreeVisibleCache();
            renderFileTreeViewport(true);
            return;
          }

          // 防抖 150ms：快速打字时只执行最后一次
          clearTimeout(fileTreeSearchDebounce);
          fileTreeSearchDebounce = setTimeout(function() {
            fileTreeSearchDebounce = null;

            // 统一行为：只高亮匹配项，不过滤显示
            fileTreeSearchShowOnlyMatches = false;
            rebuildFileTreeVisibleCache();
            renderFileTreeViewport(true);
            // 自动滚动到第一个匹配项
            if (fileTreeMatchedIndices.length > 0) {
              scrollToFileTreeItem(fileTreeMatchedIndices[0]);
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
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            fileTreeSearch.value = "";
            fileTreeSearchTerm = "";
            fileTreeSearchShowOnlyMatches = false;
            fileTreeLastEnterSearchTerm = "";
            fileTreeSearchNavIndex = -1;
            temporarilyIncludedNodes.clear();
            rebuildFileTreeVisibleCache();
            renderFileTreeViewport(true);
          }
        });



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

        // 文件树宽度调整 - 优化：防止文本选中
        fileTreeResizer.addEventListener("mousedown", function (e) {
          e.preventDefault(); // 防止文本选中
          startResize(e);
        });

        // Alt + 滚轮调整文件树宽度
        fileTreeContainer.addEventListener("wheel", function (e) {
          if (!e.altKey) return;
          if (isFileTreeFloating) return;
          if (!fileTreeContainer.classList.contains("visible")) return;
          e.preventDefault();
          const currentWidth = fileTreeContainer.getBoundingClientRect().width;
          const step = e.deltaY > 0 ? -30 : 30;
          const newWidth = clampValue(currentWidth + step, 200, 1200);
          fileTreeDockedWidthPx = newWidth;
          fileTreeContainer.style.width = newWidth + "px";
          writeStorageNumber("aitool.fileTree.dockedWidthPx", Math.round(newWidth));
          updateLayout();
          updateButtonPosition();
        }, { passive: false });

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
            if (item.isArchiveChild) return;
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
                  selectedFiles = selectedFiles.filter(function(f) { var idx = (typeof f === 'object' && f !== null) ? f.index : f; return idx < deleteStart || idx >= deleteEnd; });
                  selectedFiles.forEach(function(f) { var idx = (typeof f === 'object' && f !== null) ? f.index : f; if (typeof f === 'object' && f !== null) { if (idx >= deleteStart) f.index = idx - deleteCount; } });
                }
                rebuildFileTreeVisibleCache();
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

        // 导出CSV分析
        if (fileTreeCtxExportCsv) {
          fileTreeCtxExportCsv.addEventListener("click", async () => {
            const idx = fileTreeContextMenuIndex;
            hideFileTreeContextMenu();
            const item = fileTreeHierarchy[idx];
            if (!item) return;
            const archivePath = item._originalPath || item.path;
            if (!archivePath) return;

            // Step 1: Show platform + keyword selection dialog
            const result = await new Promise(function(resolve) {
              const selOverlay = document.createElement('div');
              selOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10006;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
              selOverlay.innerHTML = '<div class="analysis-dialog" style="background:#fff;border-radius:14px;padding:28px 28px 24px;min-width:340px;max-width:440px;box-shadow:0 12px 40px rgba(0,0,0,0.18);">' +
                '<div style="font-size:17px;font-weight:600;color:#1a1a1a;text-align:center;margin-bottom:20px;">日志分析</div>' +
                '<div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:16px;">' +
                  '<label style="cursor:pointer;font-size:13px;color:#444;display:flex;align-items:center;gap:5px;">' +
                    '<input type="radio" name="analysisPlatform" value="mtk" checked style="accent-color:#4a8af4;">MTK</label>' +
                  '<label style="cursor:pointer;font-size:13px;color:#444;display:flex;align-items:center;gap:5px;">' +
                    '<input type="radio" name="analysisPlatform" value="qcom" style="accent-color:#4a8af4;">高通</label>' +
                '</div>' +
                '<div id="analysisKeywordList" style="max-height:220px;overflow-y:auto;border:1px solid #ebebeb;border-radius:8px;padding:6px 14px;"></div>' +
                '<div style="display:flex;justify-content:center;margin-top:20px;">' +
                  '<button id="csvSelOk" style="padding:9px 40px;border:none;border-radius:8px;background:linear-gradient(135deg,#4a8af4,#3b6de0);color:#fff;font-size:14px;font-weight:500;cursor:pointer;transition:opacity .15s;letter-spacing:1px;">开始分析</button>' +
                '</div></div>';
              document.body.appendChild(selOverlay);

              selOverlay.querySelector('#csvSelOk').onmouseenter = function() { this.style.opacity = '0.85'; };
              selOverlay.querySelector('#csvSelOk').onmouseleave = function() { this.style.opacity = '1'; };

              selOverlay.addEventListener('click', function(ev) {
                if (ev.target === selOverlay) {
                  if (selOverlay.parentNode) selOverlay.parentNode.removeChild(selOverlay);
                  resolve(null);
                }
              });

              var kwListEl = selOverlay.querySelector('#analysisKeywordList');

              async function loadKeywords(platform) {
                var keywords = await window.electronAPI.getAnalysisKeywords(platform);
                if (!keywords || keywords.length === 0) {
                  kwListEl.innerHTML = '<div style="color:#aaa;padding:12px 0;font-size:13px;text-align:center;">无可用解析器</div>';
                  return;
                }
                var checks = '';
                for (var i = 0; i < keywords.length; i++) {
                  checks += '<label style="display:flex;align-items:center;padding:6px 0;cursor:pointer;font-size:13px;color:#333;">' +
                    '<input type="checkbox" value="' + keywords[i].keyword + '" checked style="margin-right:8px;width:15px;height:15px;cursor:pointer;accent-color:#4a8af4;">' +
                    '<span>' + keywords[i].tabName + '</span></label>';
                }
                kwListEl.innerHTML = checks;
              }

              // Load default platform (MTK)
              loadKeywords('mtk');

              // Switch platform on radio change
              selOverlay.querySelectorAll('input[name="analysisPlatform"]').forEach(function(radio) {
                radio.addEventListener('change', function() {
                  loadKeywords(this.value);
                });
              });

              selOverlay.querySelector('#csvSelOk').onclick = function() {
                var platform = selOverlay.querySelector('input[name="analysisPlatform"]:checked').value;
                var cbs = selOverlay.querySelectorAll('#analysisKeywordList input[type=checkbox]');
                var sel = [];
                cbs.forEach(function(cb) { if (cb.checked) sel.push(cb.value); });
                if (sel.length === 0) { alert('请至少选择一个关键词'); return; }
                if (selOverlay.parentNode) selOverlay.parentNode.removeChild(selOverlay);
                resolve({ platform: platform, keywords: sel });
              };
            });

            if (!result) return;
            const { platform: selectedPlatform, keywords: selectedKeywords } = result;

            if (!selectedKeywords) return;

            // Step 2: Create progress overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10005;display:flex;align-items:center;justify-content:center;';
            overlay.innerHTML = '<div class="csv-progress-backdrop" style="position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.15);"></div>' +
              '<div style="background:#fff;border-radius:16px;padding:36px 44px;min-width:340px;max-width:420px;box-shadow:0 8px 40px rgba(0,0,0,0.14);text-align:center;position:relative;">' +
                '<svg width="72" height="72" viewBox="0 0 72 72" style="display:block;margin:0 auto 20px;">' +
                  '<circle cx="36" cy="36" r="28" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="4"/>' +
                  '<circle id="csvProgressRing" cx="36" cy="36" r="28" fill="none" stroke="#007AFF" stroke-width="4" stroke-linecap="round" stroke-dasharray="175.93" stroke-dashoffset="175.93" transform="rotate(-90 36 36)" style="transition:stroke-dashoffset .3s ease"/>' +
                  '<text id="csvProgressPct" x="36" y="36" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="16" font-weight="600" fill="#1D1D1F">0%</text>' +
                '</svg>' +
                '<div id="csvExportProgressText" style="font-size:15px;font-weight:600;color:#1D1D1F;margin-bottom:6px;">正在分析日志</div>' +
                '<div id="csvExportProgressDetail" style="font-size:12px;color:#86868B;line-height:1.5;"></div>' +
                '<div id="csvExportProgressSub" style="font-size:11px;color:#C7C7CC;margin-top:8px;"></div>' +
              '</div>';
            document.body.appendChild(overlay);

            const progressText = overlay.querySelector('#csvExportProgressText');
            const progressDetail = overlay.querySelector('#csvExportProgressDetail');
            const progressSub = overlay.querySelector('#csvExportProgressSub');
            const progressRing = overlay.querySelector('#csvProgressRing');
            const progressPct = overlay.querySelector('#csvProgressPct');
            const CIRCUMFERENCE = 2 * Math.PI * 28; // ~175.93

            const progressHandler = (data) => {
              if (data.stage === 'extracting') {
                var pct = data.percent || 0;
                progressText.textContent = '正在解析日志文件';
                progressDetail.textContent = (data.fileIndex || 0) + ' / ' + (data.totalFiles || 0) + ' 个文件';
                progressSub.textContent = '';
                var offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
                progressRing.setAttribute('stroke-dashoffset', offset);
                progressPct.textContent = pct + '%';
              } else if (data.stage === 'generating') {
                var pct2 = data.percent || 0;
                progressText.textContent = '正在生成报告';
                progressDetail.textContent = '';
                progressSub.textContent = '写入数据库 & 构建索引';
                var offset2 = CIRCUMFERENCE - (pct2 / 100) * CIRCUMFERENCE;
                progressRing.setAttribute('stroke-dashoffset', offset2);
                progressPct.textContent = pct2 + '%';
              }
            };

            if (window.electronAPI && window.electronAPI.on) {
              window.electronAPI.on('csv-export-progress', progressHandler);
            }

            try {
              const result = await window.electronAPI.exportCsvAnalysis(archivePath, selectedKeywords, selectedPlatform);

              if (window.electronAPI && window.electronAPI.removeListener) {
                window.electronAPI.removeListener('csv-export-progress', progressHandler);
              }

              if (result.success) {
                progressRing.setAttribute('stroke', '#34C759');
                progressRing.setAttribute('stroke-dashoffset', '0');
                progressPct.textContent = '✓';
                progressPct.setAttribute('fill', '#34C759');
                progressText.textContent = '分析完成';
                progressText.style.color = '#34C759';
                progressSub.textContent = '解析 ' + result.rowCount + ' 条数据 · 报告已打开';
                setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 1800);
              } else if (result.cancelled) {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
              } else {
                progressRing.setAttribute('stroke', '#FF3B30');
                progressRing.setAttribute('stroke-dashoffset', '0');
                progressPct.textContent = '✕';
                progressPct.setAttribute('fill', '#FF3B30');
                progressText.textContent = '分析失败';
                progressText.style.color = '#FF3B30';
                progressSub.textContent = result.error || '未知错误';
                progressDetail.textContent = result.error || '未知错误';
                setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 3000);
                if (typeof showMessage === 'function') {
                  showMessage('分析失败: ' + (result.error || '未知错误'));
                }
              }
            } catch (e) {
              if (window.electronAPI && window.electronAPI.removeListener) {
                window.electronAPI.removeListener('csv-export-progress', progressHandler);
              }
              if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
              if (typeof showMessage === 'function') {
                showMessage('分析出错: ' + e.message);
              }
            }
          });
        }

        // 从常用访问中移除
        if (fileTreeCtxRemoveFrequent) {
          fileTreeCtxRemoveFrequent.addEventListener("click", () => {
            const idx = fileTreeContextMenuIndex;
            hideFileTreeContextMenu();
            const item = fileTreeHierarchy[idx];
            if (!item || !item.isFrequentDir) return;
            if (typeof removeFrequentDirectory === 'function') {
              removeFrequentDirectory(item.path);
            }
            if (typeof refreshFrequentAccessNodes === 'function') {
              refreshFrequentAccessNodes();
            }
            if (typeof showMessage === 'function') {
              showMessage('已从常用访问中移除: ' + item.name);
            }
          });
        }

        // 星标/取消星标
        if (fileTreeCtxToggleStar) {
          fileTreeCtxToggleStar.addEventListener("click", () => {
            const idx = fileTreeContextMenuIndex;
            hideFileTreeContextMenu();
            const item = fileTreeHierarchy[idx];
            if (!item) return;
            var dirPath = item.path;
            var dirName = item.name;
            if (typeof isStarredDirectory === 'function' && isStarredDirectory(dirPath)) {
              if (typeof removeStarredDirectory === 'function') removeStarredDirectory(dirPath);
              if (typeof showMessage === 'function') showMessage('已取消星标: ' + dirName);
            } else {
              if (typeof addStarredDirectory === 'function') addStarredDirectory(dirPath, dirName);
              if (typeof showMessage === 'function') showMessage('已添加星标: ' + dirName);
            }
            if (typeof refreshFrequentAccessNodes === 'function') {
              refreshFrequentAccessNodes();
            }
          });
        }

        // 鼠标移出菜单时隐藏菜单
        if (fileTreeContextMenu) {
          fileTreeContextMenu.addEventListener("mouseleave", () => {
            hideFileTreeContextMenu();
          });
        }


        // ========== 子树过滤功能 ==========
        // "过滤当前目录"菜单项点击
        if (fileTreeCtxFilterSubtree) {
          fileTreeCtxFilterSubtree.addEventListener("click", async function() {
            var idx = fileTreeContextMenuIndex;
            hideFileTreeContextMenu();
            var item = fileTreeHierarchy[idx];
            if (!item) return;

            if (!item.expanded || !item.childrenLoaded) {
              if (item.type === 'drive' || (item.type === 'folder' && item.isLocalDrive && !item.isArchiveChild)) {
                await toggleLocalFolder(item, idx);
              } else if (item.isArchive || item.type === 'archive') {
                if (item.isNestedArchive) {
                  await loadNestedArchiveChildren(idx);
                } else {
                  await toggleLocalArchive(item, idx);
                }
              } else if (item.isArchiveChild) {
                await toggleLocalFolder(item, idx);
              } else if (item.isRemote) {
                if (item.isArchive) {
                  await toggleRemoteArchive(item);
                } else {
                  await toggleRemoteFolder(item, idx);
                }
              } else {
                await toggleLocalFolder(item, idx);
              }
            }

            openSubtreeFilterDialog(idx, item);
          });
        }

        // 关闭子树过滤浮窗
        if (subtreeFilterClose) {
          subtreeFilterClose.addEventListener("click", closeSubtreeFilterDialog);
        }

        // 子树过滤输入
        if (subtreeFilterInput) {
          var _subtreeFilterDebounce = null;

          subtreeFilterInput.addEventListener("input", function() {
            var term = subtreeFilterInput.value.trim();
            if (!term) {
              subtreeFilterMatchCount.textContent = "0";
              subtreeFilterLastEnterTerm = "";
              // 清除子树高亮
              fileTreeMatchedIndices = [];
              renderFileTreeViewport(true);
              return;
            }

            clearTimeout(_subtreeFilterDebounce);
            _subtreeFilterDebounce = setTimeout(function() {
              _subtreeFilterDebounce = null;
              var matched = getSubtreeMatchedFiles(subtreeFilterRootIndex, term);
              subtreeFilterMatchCount.textContent = String(matched.length);

              // 高亮匹配的文件
              fileTreeMatchedIndices = matched;
              renderFileTreeViewport(true);
            }, 150);
          });

          subtreeFilterInput.addEventListener("keydown", function(e) {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();

              var term = subtreeFilterInput.value.trim();
              if (!term) return;

              var matched = getSubtreeMatchedFiles(subtreeFilterRootIndex, term);

              // 二次 Enter：全选匹配文件
              if (term === subtreeFilterLastEnterTerm && matched.length > 0) {
                selectedFiles = [];
                selectionOrderCounter = 0;
                loadedFileIndices.clear();

                for (var i = 0; i < matched.length; i++) {
                  var mIdx = matched[i];
                  selectedFiles.push({ index: mIdx, order: ++selectionOrderCounter });
                  fileTreeHierarchy[mIdx].selected = true;
                }
                renderFileTreeViewport(true);
                closeSubtreeFilterDialog();
                if (selectedFiles.length > 0) {
                  loadSelectedFiles();
                }
                return;
              }

              // 首次 Enter：过滤显示匹配的文件
              subtreeFilterLastEnterTerm = term;
              if (matched.length > 0) {
                // 只显示匹配的文件
                fileTreeSearchShowOnlyMatches = true;
                fileTreeSearchTerm = term;
                temporarilyIncludedNodes.clear();
                for (var j = 0; j < matched.length; j++) {
                  temporarilyIncludedNodes.add(matched[j]);
                }
                // 也包含父节点以保持树结构
                addParentNodesToTempIncluded(subtreeFilterRootIndex, matched);
                rebuildFileTreeVisibleCache();
                renderFileTreeViewport(true);

                // 滚动到第一个匹配项
                if (matched.length > 0) {
                  setTimeout(function() {
                    scrollToFileTreeItem(matched[0]);
                  }, 100);
                }
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closeSubtreeFilterDialog();
            }
          });
        }

        // 点击浮窗外部关闭
        document.addEventListener("mousedown", function(e) {
          if (!fileTreeSubtreeFilterDialog || fileTreeSubtreeFilterDialog.style.display === "none") return;
          if (fileTreeSubtreeFilterDialog.contains(e.target)) return;
          closeSubtreeFilterDialog();
        });

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
                renderLogLines();
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
        if (typeof initDirectoryConfigCache === 'function') {
          initDirectoryConfigCache().then(function() {
            initializeDataDrivesInFileTree(true);
          });
        } else {
          initializeDataDrivesInFileTree(true);
        }

        // 🚀 初始化文件系统监听
        initFileSystemWatcher();

        // 初始化远程目录事件
        if (typeof initializeRemoteDirectoryEvents === 'function') {
          initializeRemoteDirectoryEvents();
        }
        console.log("[文件树] initFileTree 完成");
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
                  shiftSelectedIndices(insertPos, newNodes.length);
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
        // 节流：10 秒内不重复触发（延长冷却时间，降低磁盘 I/O）
        if (now - _lastStaleRefresh < 10000) return;
        if (_staleRefreshRunning) return;

        if (_staleRefreshTimer) clearTimeout(_staleRefreshTimer);
        _staleRefreshTimer = setTimeout(async function() {
          _staleRefreshTimer = null;
          _staleRefreshRunning = true;
          _lastStaleRefresh = Date.now();

          try {
            var refreshPaths = [];
            for (var i = 0; i < fileTreeHierarchy.length; i++) {
              var node = fileTreeHierarchy[i];
              if (node.expanded && node.childrenLoaded) {
                refreshPaths.push({ index: i, path: node.path });
              }
            }
            // 限制最多刷新 10 个目录，避免大量磁盘 I/O
            if (refreshPaths.length > 10) {
              refreshPaths = refreshPaths.slice(0, 10);
            }
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
          shiftSelectedIndices(insertIndex, newChildren.length);

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

          console.log('[文件树] 获取驱动器列表，包含系统盘:', includeSystemDrive);
          const result = await window.electronAPI.getDataDrives({ includeSystemDrive });
          if (!result.success || !result.drives || result.drives.length === 0) {
            console.log('[文件树] 没有可用的驱动器');
            return;
          }

          console.log('[文件树] 发现', result.drives.length, '个驱动器');

          // 按类型分组
          var localDrives = [];
          var networkDrives = [];
          var otherItems = [];

          for (var di = 0; di < result.drives.length; di++) {
            var drive = result.drives[di];
            if (drive.driveType === 'network') {
              networkDrives.push(drive);
            } else {
              localDrives.push(drive);
            }
          }

          // 下载文件夹归入"其他"
          if (result.downloadsPath) {
            otherItems.push({
              name: 'Downloads',
              path: result.downloadsPath,
              type: 'drive',
              expanded: false,
              level: 1,
              file: null,
              childrenLoaded: false,
              loadingChildren: false,
              isLocalDrive: false,
              isDownloads: true,
              size: 0
            });
          }

          // 清空现有驱动器和分类节点
          for (var ri = fileTreeHierarchy.length - 1; ri >= 0; ri--) {
            var rt = fileTreeHierarchy[ri].type;
            if (rt === 'drive' || rt === 'drive-category') {
              fileTreeHierarchy.splice(ri, 1);
            }
          }

          persistentDriveNodes = [];

          // 本地磁盘分类
          if (localDrives.length > 0) {
            var localCategory = {
              name: '本地磁盘',
              path: '__local_drives__',
              type: 'drive-category',
              expanded: fileTreeActiveTab === '__local_drives__',
              level: 0,
              file: null,
              childrenLoaded: false,
              loadingChildren: false,
              size: 0
            };
            persistentDriveNodes.push(localCategory);
            for (var li = 0; li < localDrives.length; li++) {
              var ld = localDrives[li];
              var localNode = {
                name: ld.name,
                path: ld.path,
                type: 'drive',
                expanded: false,
                level: 1,
                file: null,
                childrenLoaded: false,
                loadingChildren: false,
                isLocalDrive: true,
                size: 0
              };
              persistentDriveNodes.push(localNode);
            }
          }

          // 网络驱动器分类
          if (networkDrives.length > 0) {
            var networkCategory = {
              name: '网络驱动器',
              path: '__network_drives__',
              type: 'drive-category',
              expanded: fileTreeActiveTab === '__network_drives__',
              level: 0,
              file: null,
              childrenLoaded: false,
              loadingChildren: false,
              size: 0
            };
            persistentDriveNodes.push(networkCategory);
            for (var ni = 0; ni < networkDrives.length; ni++) {
              var nd = networkDrives[ni];
              var netNode = {
                name: nd.name,
                path: nd.path,
                type: 'drive',
                expanded: false,
                level: 1,
                file: null,
                childrenLoaded: false,
                loadingChildren: false,
                isLocalDrive: false,
                size: 0
              };
              persistentDriveNodes.push(netNode);
            }
          }

          // 其他分类（下载文件夹等）
          if (otherItems.length > 0) {
            var otherCategory = {
              name: '其他',
              path: '__other_drives__',
              type: 'drive-category',
              expanded: fileTreeActiveTab === '__other_drives__',
              level: 0,
              file: null,
              childrenLoaded: false,
              loadingChildren: false,
              size: 0
            };
            persistentDriveNodes.push(otherCategory);
            for (var oi = 0; oi < otherItems.length; oi++) {
              persistentDriveNodes.push(otherItems[oi]);
            }
          }

          // 常用访问分类
          var frequentNodes = typeof rebuildFrequentDriveNodes === 'function' ? rebuildFrequentDriveNodes() : [];
          for (var fni = 0; fni < frequentNodes.length; fni++) {
            if (frequentNodes[fni].type === 'drive-category') {
              frequentNodes[fni].expanded = fileTreeActiveTab === '__frequent_access__';
            }
            persistentDriveNodes.push(frequentNodes[fni]);
          }

          updateFileTreeTabBarState();

          fileTreeHierarchy.unshift(...persistentDriveNodes);
          console.log('[文件树] 已加载', persistentDriveNodes.length, '个节点（含分类）');

          renderFileTree();
        } catch (error) {
          console.error('[文件树] 初始化驱动器失败:', error);
        }
      }

      // 🚀 切换驱动器分类 tab
      function switchFileTreeTab(tabPath) {
        if (fileTreeActiveTab === tabPath) return;
        fileTreeActiveTab = tabPath;

        for (var i = 0; i < fileTreeHierarchy.length; i++) {
          var item = fileTreeHierarchy[i];
          if (item.type === 'drive-category') {
            item.expanded = (item.path === tabPath);
          }
        }

        updateFileTreeTabBarState();
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);
      }

      // 🚀 更新 tab bar 的激活状态和禁用状态
      function updateFileTreeTabBarState() {
        if (!fileTreeTabBar) return;

        var categoryPaths = {};
        var source = persistentDriveNodes.length > 0 ? persistentDriveNodes : fileTreeHierarchy;
        for (var i = 0; i < source.length; i++) {
          var item = source[i];
          if (item && item.type === 'drive-category') {
            categoryPaths[item.path] = true;
          }
        }

        var tabs = fileTreeTabBar.querySelectorAll('.file-tree-tab');
        for (var t = 0; t < tabs.length; t++) {
          var tab = tabs[t];
          var tabPath = tab.dataset.tab;
          if (categoryPaths[tabPath]) {
            tab.disabled = false;
            tab.classList.toggle('active', tabPath === fileTreeActiveTab);
          } else {
            tab.disabled = true;
            tab.classList.remove('active');
          }
        }

        if (!categoryPaths[fileTreeActiveTab]) {
          var fallback = null;
          var paths = ['__local_drives__', '__network_drives__', '__other_drives__', '__frequent_access__'];
          for (var f = 0; f < paths.length; f++) {
            if (categoryPaths[paths[f]]) { fallback = paths[f]; break; }
          }
          if (fallback) {
            fileTreeActiveTab = fallback;
            for (var i2 = 0; i2 < fileTreeHierarchy.length; i2++) {
              if (fileTreeHierarchy[i2].type === 'drive-category') {
                fileTreeHierarchy[i2].expanded = (fileTreeHierarchy[i2].path === fallback);
              }
            }
            var tabs2 = fileTreeTabBar.querySelectorAll('.file-tree-tab');
            for (var t2 = 0; t2 < tabs2.length; t2++) {
              tabs2[t2].classList.toggle('active', tabs2[t2].dataset.tab === fallback);
            }
          }
        }
      }

      // 🚀 刷新常用访问节点（增量更新，不影响其他分类）
      function refreshFrequentAccessNodes() {
        if (typeof rebuildFrequentDriveNodes !== 'function') return;

        var newFrequentNodes = rebuildFrequentDriveNodes();
        var oldStart = -1;
        var oldEnd = -1;

        for (var i = 0; i < fileTreeHierarchy.length; i++) {
          if (fileTreeHierarchy[i].path === '__frequent_access__') {
            oldStart = i;
            break;
          }
        }

        if (oldStart !== -1) {
          for (var j = oldStart + 1; j < fileTreeHierarchy.length; j++) {
            if (fileTreeHierarchy[j].level <= 0) break;
            oldEnd = j + 1;
          }
        }

        if (oldStart === -1 && newFrequentNodes.length === 0) return;

        if (oldStart !== -1) {
          var oldSubtree = fileTreeHierarchy.splice(oldStart, oldEnd - oldStart);
          var newTopPaths = {};
          for (var nt = 0; nt < newFrequentNodes.length; nt++) {
            if (newFrequentNodes[nt].type === 'drive') {
              newTopPaths[newFrequentNodes[nt].path] = newFrequentNodes[nt];
            }
          }
          var rebuilt = [];
          for (var fn = 0; fn < newFrequentNodes.length; fn++) {
            var node = newFrequentNodes[fn];
            if (node.type === 'drive-category') {
              node.expanded = fileTreeActiveTab === '__frequent_access__';
              rebuilt.push(node);
              continue;
            }
            var oldDir = null;
            var oldChildren = [];
            for (var os = 0; os < oldSubtree.length; os++) {
              if (oldSubtree[os].path === node.path && oldSubtree[os].type === 'drive') {
                oldDir = oldSubtree[os];
                var childStart = os + 1;
                for (var oc = childStart; oc < oldSubtree.length; oc++) {
                  if (oldSubtree[oc].level <= node.level) break;
                  oldChildren.push(oldSubtree[oc]);
                }
                break;
              }
            }
            if (oldDir) {
              oldDir.isStarredDir = node.isStarredDir;
              oldDir.isFrequentDir = node.isFrequentDir;
              oldDir.name = node.name;
              rebuilt.push(oldDir);
              if (oldDir.expanded && oldChildren.length > 0) {
                for (var cc = 0; cc < oldChildren.length; cc++) rebuilt.push(oldChildren[cc]);
              }
            } else {
              rebuilt.push(node);
            }
          }
          for (var ri = 0; ri < rebuilt.length; ri++) {
            fileTreeHierarchy.splice(oldStart + ri, 0, rebuilt[ri]);
          }
        } else {
          for (var fn2 = 0; fn2 < newFrequentNodes.length; fn2++) {
            if (newFrequentNodes[fn2].type === 'drive-category') {
              newFrequentNodes[fn2].expanded = fileTreeActiveTab === '__frequent_access__';
            }
          }
          var insertIdx = fileTreeHierarchy.length;
          for (var k = fileTreeHierarchy.length - 1; k >= 0; k--) {
            if (fileTreeHierarchy[k].type === 'drive' || fileTreeHierarchy[k].type === 'drive-category') {
              insertIdx = k + 1;
              while (insertIdx < fileTreeHierarchy.length && fileTreeHierarchy[insertIdx].level > 0) {
                insertIdx++;
              }
              break;
            }
          }
          var insertArgs = [insertIdx, 0];
          for (var ii = 0; ii < newFrequentNodes.length; ii++) insertArgs.push(newFrequentNodes[ii]);
          fileTreeHierarchy.splice.apply(fileTreeHierarchy, insertArgs);
        }

        persistentDriveNodes = [];
        for (var pi = 0; pi < fileTreeHierarchy.length; pi++) {
          var pitem = fileTreeHierarchy[pi];
          if (pitem.type === 'drive-category' || (pitem.type === 'drive' && pitem.level === 1)) {
            persistentDriveNodes.push(pitem);
          }
        }

        updateFileTreeTabBarState();
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);
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

      // 暴露到全局作用域
      window.refreshDrivesIncludeAll = refreshDrivesIncludeAll;
      window.refreshDrivesDataOnly = refreshDrivesDataOnly;

      // =====================================================================
      // 🚀 远程目录功能
      // =====================================================================

      // 初始化远程目录事件

      // =====================================================================
      // 🚀 本地共享功能
      // =====================================================================

      // 显示本地共享对话框

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
            const canDelete = !item.isArchiveChild;
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

        // "导出CSV分析"对ZIP/7z/RAR及文件夹显示
        if (fileTreeCtxExportCsv) {
          if (isBlankArea || !item) {
            fileTreeCtxExportCsv.style.display = "none";
          } else {
            var supported = /\.(zip|7z|rar)$/i.test(item.name || item.path || '')
              || item.type === 'folder'
              || item.isArchive;
            fileTreeCtxExportCsv.style.display = supported ? "" : "none";
          }
        }

        // "从常用访问中移除"仅对常用访问目录显示
        if (fileTreeCtxRemoveFrequent) {
          if (isBlankArea || !item || !item.isFrequentDir) {
            fileTreeCtxRemoveFrequent.style.display = "none";
          } else {
            fileTreeCtxRemoveFrequent.style.display = "";
          }
        }

        // "星标/取消星标"对 drive/folder 类型显示
        if (fileTreeCtxToggleStar) {
          if (isBlankArea || !item || (item.type !== 'drive' && item.type !== 'folder')) {
            fileTreeCtxToggleStar.style.display = "none";
          } else {
            fileTreeCtxToggleStar.style.display = "";
            var isCurrentlyStarred = (typeof isStarredDirectory === 'function') && isStarredDirectory(item.path);
            var starTextEl = fileTreeCtxToggleStar.querySelector('.text');
            if (starTextEl) {
              starTextEl.textContent = isCurrentlyStarred ? '取消星标' : '添加星标';
            }
            var starIconEl = fileTreeCtxToggleStar.querySelector('.icon');
            if (starIconEl) {
              starIconEl.textContent = isCurrentlyStarred ? '☆' : '🌟';
            }
          }
        }

        // "过滤当前目录"对文件夹/压缩包总是显示（不要求已展开，未展开时点击会自动展开）
        if (fileTreeCtxFilterSubtree) {
          if (isBlankArea || !item) {
            fileTreeCtxFilterSubtree.style.display = "none";
          } else {
            var isFolderOrArchive = item.type === 'folder' || item.type === 'drive' || item.isArchive || item.type === 'archive';
            fileTreeCtxFilterSubtree.style.display = isFolderOrArchive ? "" : "none";
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

      // [Extracted] hideLogContextMenu, showLogContextMenu, initLogContentContextMenu,
      //            detectAndParseCSV, showCSVTablePanel, initExpandFilter,
      //            initFilterContextMenu → services/{log-context-menu,csv-viewer,filter-dialog,filter-context-menu}/

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

      function restrictLocalTreeToFolder(folderPath) {
        const target = String(folderPath || "").replace(/^\/+|\/+$/g, "");
        if (!target) return;

        // 仅对本地文件树生效
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
        // 🔧 面板高度拖动过程中，不触发智能展开（防止拖到左侧时文件树弹出）
        if (document.body.classList.contains('panel-resizing')) return;

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
        if (!isSmartCollapsed) return;
        if (fileTreeContextMenu && fileTreeContextMenu.classList.contains("visible")) {
          smartCollapseTimer = setTimeout(smartCollapseFileTree, 200);
          return;
        }
        if (document.activeElement === fileTreeSearch) {
          smartCollapseTimer = setTimeout(smartCollapseFileTree, 200);
          return;
        }
        var filterDialog = document.getElementById('filterDialog');
        if (filterDialog && filterDialog.classList.contains('visible')) {
          smartCollapseTimer = setTimeout(smartCollapseFileTree, 200);
          return;
        }
        // 鼠标仍在文件树附近（右边缘外 120px 范围内）时不折叠，避免调整大小时误隐藏
        var treeRect = fileTreeContainer.getBoundingClientRect();
        if (_currentMouseX >= treeRect.left - 20 &&
            _currentMouseX <= treeRect.right &&
            _currentMouseY >= treeRect.top &&
            _currentMouseY <= treeRect.bottom) {
          smartCollapseTimer = setTimeout(smartCollapseFileTree, 200);
          return;
        }

        isSmartCollapsed = false;
        fileTreeContainer.classList.remove("visible");
        fileTreeCollapseBtn.innerHTML = "▶";
        updateLayout();
      }

      // 重置智能折叠定时器（延迟 500ms，给用户足够时间移回文件树）
      function resetSmartCollapseTimer() {
        if (smartCollapseTimer) {
          clearTimeout(smartCollapseTimer);
          smartCollapseTimer = null;
        }
        if (isSmartCollapsed) {
          smartCollapseTimer = setTimeout(smartCollapseFileTree, 50);
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

      // 启用智能折叠并启动定时器（恢复文件树后调用）
      function enableSmartCollapse() {
        isSmartCollapsed = true;
        resetSmartCollapseTimer();
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
          var _cpb = document.getElementById('chunkProgressBar');
          if (_cpb) _cpb.style.left = "0px";
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
        var _cpb2 = document.getElementById('chunkProgressBar');
        if (_cpb2) _cpb2.style.left = width + "px";

        // 设置 CSS 变量供 CSS 选择器使用，确保首次加载时布局正确
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
          if (visibleByExpand && it.type !== 'drive-category') out.push(i);

          // 该 folder/drive 的 expanded 状态会影响后代可见性
          // 🔧 也要检查 type === "drive"，否则驱动器折叠后子项仍然可见
          if ((it.type === "folder" || it.type === "drive" || it.type === "drive-category") && !it.expanded) {
            collapsedLevels.push(lv);
          }

          // 压缩包如果未展开，也会影响后代可见性
          if (it.isArchive) {
            // 服务端/嵌套压缩包：使用 expanded 字段
            // 本地压缩包（非嵌套）：使用 expandedArchives 集合
            let isExpanded;
            if (it.isNestedArchive) {
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

      var _fileTreeRenderGuard = false;

      function scheduleRenderFileTreeViewport(force) {
        if (_fileTreeRenderGuard && !force) return;
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

        // 阻止本次渲染导致的 scroll 事件触发下一轮渲染
        _fileTreeRenderGuard = true;

        if (!fileTreeHierarchy || fileTreeHierarchy.length === 0) {
          fileTreeList.innerHTML =
            '<div class="file-tree-empty"><svg width="36" height="36" viewBox="0 0 16 16"><path d="M2 5h5l2-2h5v10H2z" fill="#82AFCB"/></svg><span class="empty-title">拖入文件或文件夹到此处</span><span class="empty-hint">支持 Ctrl+V 粘贴文件路径</span></div>';
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
            '<div class="file-tree-empty"><svg width="36" height="36" viewBox="0 0 16 16"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="#8e8e93" stroke-width="1.2"/><line x1="10" y1="10" x2="14" y2="14" stroke="#8e8e93" stroke-width="1.2" stroke-linecap="round"/></svg><span class="empty-title">没有找到匹配的文件</span></div>';
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
          _fileTreeRenderGuard = false;
          return;
        }

        // 锁定 scrollTop：DOM 变更可能导致 scrollHeight 波动，进而触发跳动
        const savedScrollTop = scrollTop;

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

        // 恢复 scrollTop：防止 DOM 变更导致浏览器自动调整滚动位置
        if (fileTreeList.scrollTop !== savedScrollTop) {
          fileTreeList.scrollTop = savedScrollTop;
        }

        // 下一帧解除 scroll 事件拦截，允许正常滚动触发渲染
        requestAnimationFrame(function() { _fileTreeRenderGuard = false; });

        const renderTime = performance.now() - renderStart;
        if (renderTime > 50) {  // Only log if it takes more than 50ms
          console.log(`⚠️ renderFileTreeViewport 耗时: ${renderTime.toFixed(2)}ms (items: ${end - start}, force=${force})`);
        }
      }

      // ========== 子树过滤辅助函数 ==========

      // 获取子树范围（从 rootIndex 到其子树的结束索引）
      function getSubtreeRange(rootIndex) {
        var rootItem = fileTreeHierarchy[rootIndex];
        if (!rootItem) return { start: rootIndex, end: rootIndex + 1 };

        var rootLevel = rootItem.level;
        var endIdx = rootIndex + 1;
        while (endIdx < fileTreeHierarchy.length) {
          if (fileTreeHierarchy[endIdx].level <= rootLevel) break;
          endIdx++;
        }
        return { start: rootIndex, end: endIdx };
      }

      // 在子树范围内搜索匹配的文件
      function getSubtreeMatchedFiles(rootIndex, term) {
        if (rootIndex < 0 || !term) return [];
        var range = getSubtreeRange(rootIndex);
        var keywords = parseFileTreeSearchKeywords(term);
        var matched = [];
        for (var i = range.start; i < range.end; i++) {
          var item = fileTreeHierarchy[i];
          if (!item || item.type !== 'file') continue;
          var name = (item.name || '').toString();
          if (matchesFileTreeSearchKeywords(name, keywords)) {
            matched.push(i);
          }
        }
        return matched;
      }

      // 将匹配文件的父节点添加到临时包含集合（保持树结构可见）
      function addParentNodesToTempIncluded(rootIndex, matchedIndices) {
        if (matchedIndices.length === 0) return;
        var matchedSet = new Set(matchedIndices);
        // 包含根节点
        temporarilyIncludedNodes.add(rootIndex);

        // 对于每个匹配的文件，向上回溯包含所有父文件夹
        for (var m = 0; m < matchedIndices.length; m++) {
          var idx = matchedIndices[m];
          var currentLevel = fileTreeHierarchy[idx].level;
          // 回溯到 rootIndex 的下一级
          for (var j = idx - 1; j >= rootIndex; j--) {
            var parentItem = fileTreeHierarchy[j];
            if (!parentItem) continue;
            if (parentItem.level < currentLevel) {
              if (temporarilyIncludedNodes.has(j)) break;
              temporarilyIncludedNodes.add(j);
              currentLevel = parentItem.level;
            }
          }
        }
      }

      // 打开子树过滤浮窗
      function openSubtreeFilterDialog(rootIndex, item) {
        subtreeFilterRootIndex = rootIndex;
        subtreeFilterLastEnterTerm = "";

        // 设置标题
        if (subtreeFilterTitle) {
          var displayName = item.name || '目录';
          if (displayName.length > 30) displayName = displayName.substring(0, 27) + '...';
          subtreeFilterTitle.textContent = '过滤: ' + displayName;
        }

        // 清空输入
        if (subtreeFilterInput) {
          subtreeFilterInput.value = '';
        }
        if (subtreeFilterMatchCount) {
          subtreeFilterMatchCount.textContent = '0';
        }

        // 定位浮窗：在右键菜单位置附近
        if (fileTreeSubtreeFilterDialog) {
          fileTreeSubtreeFilterDialog.style.display = 'block';

          var treeRect = fileTreeContainer.getBoundingClientRect();
          var dialogWidth = 360;
          var dialogX = treeRect.right - dialogWidth - 10;
          var dialogY = treeRect.top + 60;

          if (dialogX < 10) dialogX = 10;
          if (dialogY < 10) dialogY = 10;
          var maxDialogY = window.innerHeight - 120;
          if (dialogY > maxDialogY) dialogY = maxDialogY;

          fileTreeSubtreeFilterDialog.style.left = dialogX + 'px';
          fileTreeSubtreeFilterDialog.style.top = dialogY + 'px';

          // 聚焦输入框
          setTimeout(function() {
            if (subtreeFilterInput) subtreeFilterInput.focus();
          }, 50);
        }
      }

      // 关闭子树过滤浮窗
      function closeSubtreeFilterDialog() {
        if (fileTreeSubtreeFilterDialog) {
          fileTreeSubtreeFilterDialog.style.display = 'none';
        }
        subtreeFilterRootIndex = -1;
        subtreeFilterLastEnterTerm = "";

        // 清除子树过滤状态
        fileTreeMatchedIndices = [];
        fileTreeSearchShowOnlyMatches = false;
        fileTreeSearchTerm = "";
        temporarilyIncludedNodes.clear();
        rebuildFileTreeVisibleCache();
        renderFileTreeViewport(true);
      }

