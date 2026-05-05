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
          if (fileLoadMode === 'memory') {
            showMemoryModeStats();
          } else {
            renderLogLines();
          }
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
      

// Service API
window.App = window.App || {};
window.App.RemoteConnect = { ready: true };
