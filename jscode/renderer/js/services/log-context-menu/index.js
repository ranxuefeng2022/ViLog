/**
 * Log Context Menu — right-click menu for main log area
 *
 * Extracted from 08-file-tree.js. Handles log content context menu
 * (import, terminal, CSV/Vlog table, new window, minimize all)
 * and shared highlight re-render utility.
 */
/* global logContextMenu, logContextMenuTitle, logCtxRefreshOpenFiles, logCtxImportFile, logCtxImportFolder, logCtxImportArchive, logCtxOpenTerminal, logCtxFileInfo, logCtxFileName, importFileInput, importFolderInput, importArchiveInput, originalLines, outer, getLineIndexFromElement, getFileNameForLineIndex, isEditableElement, hideFileTreeContextMenu, clearMainLogContent, restoreFileTreePanel, createNewWindow, showMessage, processArchiveFile, renderLogLines, forceUpdateVisibleLines, updateFilteredPanel */
(function() {
  'use strict';

  function hideLogContextMenu() {
    if (!logContextMenu) return;
    logContextMenu.classList.remove("visible");
    window.logContextMenuSelectedText = "";
    window.logContextMenuLineIndex = -1;
    window.logContextMenuFilePath = "";
    window.logContextMenuLineContent = "";
  }

  function showLogContextMenu(clientX, clientY, selectedText, lineElement) {
    if (!logContextMenu) return;
    window.logContextMenuSelectedText = String(selectedText || "");
    var selectedOneLine = window.logContextMenuSelectedText.replace(/\r/g, "").split("\n")[0].trim();

    window.logContextMenuLineIndex = -1;
    window.logContextMenuFilePath = "";
    window.logContextMenuLineContent = "";

    if (lineElement) {
      window.logContextMenuLineIndex = getLineIndexFromElement(lineElement);
      if (window.logContextMenuLineIndex >= 0 && window.logContextMenuLineIndex < originalLines.length) {
        window.logContextMenuFilePath = getFileNameForLineIndex(window.logContextMenuLineIndex) || "";
        window.logContextMenuLineContent = originalLines[window.logContextMenuLineIndex] || "";
      }
    }

    if (logContextMenuTitle) {
      var t = selectedOneLine;
      logContextMenuTitle.textContent = t ? '关键词: ' + t.slice(0, 60) : "日志";
      logContextMenuTitle.title = t ? t : "日志";
    }

    if (logCtxFileInfo && logCtxFileName) {
      if (window.logContextMenuFilePath) {
        var parts = String(window.logContextMenuFilePath).split(/[\/\\]/);
        var baseName = parts[parts.length - 1] || window.logContextMenuFilePath;
        logCtxFileName.textContent = baseName;
        logCtxFileName.title = window.logContextMenuFilePath;
        logCtxFileInfo.style.display = "block";
      } else {
        logCtxFileInfo.style.display = "none";
      }
    }

    logContextMenu.classList.add("visible");
    var rect = logContextMenu.getBoundingClientRect();
    var maxX = window.innerWidth - rect.width - 8;
    var maxY = window.innerHeight - rect.height - 8;
    var x = Math.max(8, Math.min(maxX, clientX));
    var y = Math.max(8, Math.min(maxY, clientY));
    logContextMenu.style.left = x + "px";
    logContextMenu.style.top = y + "px";
  }

  function getSelectedTextWithinLogContainer() {
    try {
      var sel = window.getSelection ? window.getSelection() : null;
      if (!sel || sel.rangeCount === 0) return "";
      var text = String(sel.toString() || "");
      if (!text) return "";
      var range = sel.getRangeAt(0);
      var node = range.commonAncestorContainer;
      var el = node && node.nodeType === 1 ? node : node?.parentElement;
      if (!el) return "";
      if (!outer || !outer.contains(el)) return "";
      return text;
    } catch {
      return "";
    }
  }

  function rerenderAfterHighlightChangePreserveScroll(updateFilterPanel) {
    if (updateFilterPanel === undefined) updateFilterPanel = true;
    var top = outer ? outer.scrollTop : 0;
    var left = outer ? outer.scrollLeft : 0;
    renderLogLines();
    if (updateFilterPanel) {
      updateFilteredPanel();
    }
    requestAnimationFrame(function() {
      if (!outer) return;
      outer.scrollTop = top;
      outer.scrollLeft = left;
      try { forceUpdateVisibleLines(); } catch {}
    });
  }

  function initLogContentContextMenu() {
    if (!outer || !logContextMenu) return;

    outer.addEventListener("contextmenu", function(e) {
      if (isEditableElement(e.target)) return;
      try { hideFileTreeContextMenu(); } catch {}
      e.preventDefault();
      e.stopPropagation();
      var selectedText = getSelectedTextWithinLogContainer();
      var lineElement = e.target.closest(".log-line, .file-header");
      showLogContextMenu(e.clientX, e.clientY, selectedText, lineElement);
    });

    if (logCtxRefreshOpenFiles) {
      logCtxRefreshOpenFiles.addEventListener("click", async function() {
        hideLogContextMenu();
        clearMainLogContent();
        if (typeof restoreFileTreePanel === 'function') {
          restoreFileTreePanel();
        }
      });
    }

    if (logCtxImportFile) {
      logCtxImportFile.addEventListener("click", function() {
        importFileInput.click();
        hideLogContextMenu();
      });
    }

    if (logCtxImportFolder) {
      logCtxImportFolder.addEventListener("click", function() {
        importFolderInput.click();
        hideLogContextMenu();
      });
    }

    if (logCtxImportArchive) {
      logCtxImportArchive.addEventListener("click", function() {
        importArchiveInput.click();
        hideLogContextMenu();
      });
    }

    var logCtxNewWindow = document.getElementById("logCtxNewWindow");
    if (logCtxNewWindow) {
      logCtxNewWindow.addEventListener("click", function() {
        hideLogContextMenu();
        createNewWindow();
      });
    }

    var logCtxMinimizeAll = document.getElementById("logCtxMinimizeAll");
    if (logCtxMinimizeAll) {
      logCtxMinimizeAll.addEventListener("click", function() {
        hideLogContextMenu();
        if (typeof window.electronAPI === 'undefined') {
          alert('无法最小化窗口：electronAPI 不可用。');
          return;
        }
        if (!window.electronAPI.windowControl) {
          alert('无法最小化窗口：windowControl 不可用。');
          return;
        }
        try {
          window.electronAPI.windowControl.minimizeAll();
        } catch (error) {
          alert('最小化窗口时出错：' + error.message);
        }
      });
    }

    if (logCtxOpenTerminal) {
      logCtxOpenTerminal.addEventListener("click", async function() {
        hideLogContextMenu();
        try {
          if (window.electronAPI && window.electronAPI.openTerminal) {
            var result = await window.electronAPI.openTerminal();
            if (!result.success) {
              showMessage('打开终端失败: ' + result.error);
            }
          } else {
            showMessage("electronAPI 不可用");
          }
        } catch (error) {
          showMessage('打开终端失败: ' + error.message);
        }
      });
    }

    var logCtxViewAsTable = document.getElementById("logCtxViewAsTable");
    if (logCtxViewAsTable) {
      logCtxViewAsTable.addEventListener("click", async function() {
        try {
          hideLogContextMenu();
          var csvContent = await window.detectAndParseCSV();
          if (!csvContent) {
            showMessage('当前内容不是CSV格式，无法以表格形式查看');
            return;
          }
          await window.showCSVTablePanel(csvContent);
        } catch (error) {
          showMessage('CSV表格视图出错: ' + error.message);
        }
      });
    }

    var csvTableCloseBtn = document.getElementById("csvTableCloseBtn");
    if (csvTableCloseBtn) {
      csvTableCloseBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        var csvTablePanel = document.getElementById("csvTablePanel");
        if (csvTablePanel) {
          csvTablePanel.classList.remove("visible");
          csvTablePanel.style.display = "none";
        }
      });
    }

    var csvTablePanelHeader = document.getElementById("csvTablePanelHeader");
    if (csvTablePanelHeader) {
      csvTablePanelHeader.addEventListener("dblclick", function() {
        var csvTablePanel = document.getElementById("csvTablePanel");
        if (csvTablePanel) {
          if (csvTablePanel.classList.contains("fullscreen")) {
            csvTablePanel.classList.remove("fullscreen");
            csvTablePanel.style.width = "80vw";
            csvTablePanel.style.height = "70vh";
            csvTablePanel.style.top = "50%";
            csvTablePanel.style.left = "50%";
            csvTablePanel.style.transform = "translate(-50%, -50%)";
          } else {
            csvTablePanel.classList.add("fullscreen");
            csvTablePanel.style.width = "100vw";
            csvTablePanel.style.height = "100vh";
            csvTablePanel.style.top = "0";
            csvTablePanel.style.left = "0";
            csvTablePanel.style.transform = "none";
          }
          setTimeout(function() {
            if (window.resetCSVCanvas) {
              window.resetCSVCanvas();
            }
          }, 150);
        }
      });
    }

    if (importArchiveInput) {
      importArchiveInput.addEventListener("change", async function(e) {
        var files = e.target.files;
        if (files && files.length > 0) {
          for (var i = 0; i < files.length; i++) {
            await processArchiveFile(files[i]);
          }
          importArchiveInput.value = "";
        }
      });
    }

    document.addEventListener("click", function(e) {
      if (!logContextMenu.classList.contains("visible")) return;
      if (logContextMenu.contains(e.target)) return;
      hideLogContextMenu();
    });
    document.addEventListener("scroll", function() { hideLogContextMenu(); }, true);
    window.addEventListener("resize", function() { hideLogContextMenu(); });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") hideLogContextMenu();
    });
  }

  // Expose to global scope
  window.initLogContentContextMenu = initLogContentContextMenu;
  window.showLogContextMenu = showLogContextMenu;
  window.hideLogContextMenu = hideLogContextMenu;
  window.rerenderAfterHighlightChangePreserveScroll = rerenderAfterHighlightChangePreserveScroll;

  window.App = window.App || {};
  window.App.LogContextMenu = {
    init: initLogContentContextMenu,
    show: showLogContextMenu,
    hide: hideLogContextMenu,
    rerenderAfterHighlightChangePreserveScroll: rerenderAfterHighlightChangePreserveScroll
  };
})();
