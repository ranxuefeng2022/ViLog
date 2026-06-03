/**
 * Filter Context Menu — right-click menu for filter panel
 *
 * Extracted from 08-file-tree.js. Handles keyword highlighting
 * (preset colors + custom picker), remove/clear highlights,
 * and exclude-lines-by-text functionality.
 */
/* global DOMCache, isEditableElement, customHighlights, filteredPanel, filteredLineHtmlCache, filteredPanelAllLines, filteredPanelAllOriginalIndices, filteredPanelAllPrimaryIndices, removeAllHighlights, invalidateFilteredLineCache, clearHtmlParseCache, updateFilteredPanelVisibleLines, updateFilteredPanel, showMessage */
(function() {
  'use strict';

  function initFilterContextMenu() {
    var filterContextMenu = document.getElementById('filterContextMenu');
    var filterPanel = DOMCache.get('filteredPanel');
    var filterPanelContent = DOMCache.get('filteredPanelContent');
    if (!filterContextMenu || !filterPanelContent || !filterPanel) return;

    var _pendingSelectedText = '';
    filterPanelContent.addEventListener("mouseup", function(e) {
      if (e.button === 2) {
        _pendingSelectedText = window.getSelection().toString();
      } else {
        _pendingSelectedText = '';
      }
    });

    filterPanel.addEventListener("contextmenu", function(e) {
      if (!filterPanelContent.contains(e.target) || isEditableElement(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      var selectedText = _pendingSelectedText || window.getSelection().toString();
      _pendingSelectedText = '';
      filterContextMenu.dataset.selectedText = selectedText;

      var highlightItems = [
        'highlightRed', 'highlightGreen', 'highlightBlue', 'highlightYellow',
        'highlightPurple', 'highlightCyan', 'highlightPink', 'highlightLime',
        'highlightBrown', 'highlightGray', 'highlightCustom'
      ];

      highlightItems.forEach(function(id) {
        var item = document.getElementById(id);
        if (item) {
          item.style.opacity = selectedText ? '1' : '0.5';
          item.style.pointerEvents = selectedText ? 'auto' : 'none';
        }
      });

      var removeHighlightItem = document.getElementById('removeCurrentHighlight');
      if (removeHighlightItem) {
        if (selectedText) {
          var hasHighlight = customHighlights.some(function(h) { return h.keyword === selectedText; });
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

      var excludeLinesItem = document.getElementById('excludeSelectedLines');
      if (excludeLinesItem) {
        if (selectedText && selectedText.trim()) {
          excludeLinesItem.style.opacity = '1';
          excludeLinesItem.style.pointerEvents = 'auto';
        } else {
          excludeLinesItem.style.opacity = '0.5';
          excludeLinesItem.style.pointerEvents = 'none';
        }
      }

      filterContextMenu.style.left = e.pageX + 'px';
      filterContextMenu.style.top = e.pageY + 'px';
      filterContextMenu.classList.add('visible');
    });

    // Preset color highlight buttons
    var colorMap = {
      'highlightRed': '#ff0000',
      'highlightGreen': '#00ff00',
      'highlightBlue': '#0000ff',
      'highlightYellow': '#ffaa00',
      'highlightPurple': '#aa00ff',
      'highlightCyan': '#00ffff',
      'highlightPink': '#ffc0cb',
      'highlightLime': '#00ff00',
      'highlightBrown': '#a52a2a',
      'highlightGray': '#808080'
    };
    Object.keys(colorMap).forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', function() {
          highlightSelectedText(colorMap[id]);
          hideFilterContextMenu();
        });
      }
    });

    document.getElementById('highlightCustom').addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      showColorPicker();
    });

    document.getElementById('removeCurrentHighlight').addEventListener('click', function() {
      var selectedText = filterContextMenu.dataset.selectedText;
      if (!selectedText) {
        hideFilterContextMenu();
        return;
      }

      var beforeLength = customHighlights.length;
      for (var i = customHighlights.length - 1; i >= 0; i--) {
        if (customHighlights[i].keyword === selectedText) {
          customHighlights.splice(i, 1);
        }
      }
      var afterLength = customHighlights.length;
      var removedCount = beforeLength - afterLength;

      if (removedCount > 0) {
        invalidateFilteredLineCache();
        if (filteredPanel.classList.contains("visible")) {
          window.filteredPanelVisibleStart = -1;
          window.filteredPanelVisibleEnd = -1;
          requestAnimationFrame(function() {
            updateFilteredPanelVisibleLines();
          });
        } else {
          window.rerenderAfterHighlightChangePreserveScroll(true);
        }
        showMessage('已移除 "' + selectedText + '" 的高亮');
      } else {
        showMessage('"' + selectedText + '" 没有高亮');
      }

      hideFilterContextMenu();
    });

    document.getElementById('excludeSelectedLines').addEventListener('click', function() {
      var selectedText = filterContextMenu.dataset.selectedText;
      if (!selectedText || !selectedText.trim()) {
        hideFilterContextMenu();
        return;
      }
      excludeLinesWithSelectedText(selectedText.trim());
      hideFilterContextMenu();
    });

    document.getElementById('clearHighlights').addEventListener('click', function() {
      removeAllHighlights();
      filteredLineHtmlCache.clear();
      window.filteredLineCacheVersion++;

      if (filteredPanel.classList.contains("visible")) {
        window.filteredPanelVisibleStart = -1;
        window.filteredPanelVisibleEnd = -1;
        requestAnimationFrame(function() {
          updateFilteredPanelVisibleLines();
        });
        showMessage("已清除所有高亮");
      } else {
        window.rerenderAfterHighlightChangePreserveScroll(true);
        showMessage("已清除所有高亮");
      }

      hideFilterContextMenu();
    });

    document.addEventListener('click', function(e) {
      if (!filterContextMenu.contains(e.target)) {
        hideFilterContextMenu();
      }
    });

    function hideFilterContextMenu() {
      filterContextMenu.classList.remove('visible');
    }

    function showColorPicker() {
      var colorPicker = document.getElementById('highlightColorPicker');
      var selectedText = filterContextMenu.dataset.selectedText;
      if (!selectedText) {
        hideFilterContextMenu();
        return;
      }
      hideFilterContextMenu();

      var menuLeft = parseInt(filterContextMenu.style.left) || 0;
      var menuTop = parseInt(filterContextMenu.style.top) || 0;
      colorPicker.style.left = menuLeft + 'px';
      colorPicker.style.top = (menuTop + 40) + 'px';
      colorPicker.style.display = 'block';

      requestAnimationFrame(function() {
        colorPicker.focus();
        colorPicker.click();
      });

      colorPicker.oninput = function() {
        highlightSelectedText(this.value, true);
      };
      colorPicker.onchange = function() {
        highlightSelectedText(this.value, false);
        colorPicker.style.display = 'none';
      };
      colorPicker.onblur = function() {
        setTimeout(function() {
          colorPicker.style.display = 'none';
        }, 200);
      };
      colorPicker.onkeydown = function(e) {
        if (e.key === 'Escape') {
          colorPicker.style.display = 'none';
        }
      };
    }

    function highlightSelectedText(color, isPreview) {
      var selectedText = filterContextMenu.dataset.selectedText;
      if (!selectedText) return;

      if (isPreview) {
        invalidateFilteredLineCache();
        var existingIndex = customHighlights.findIndex(function(h) { return h.keyword === selectedText; });

        if (existingIndex >= 0) {
          var originalColor = customHighlights[existingIndex].color;
          customHighlights[existingIndex].color = color;
          if (filteredPanel.classList.contains("visible")) {
            window.filteredPanelVisibleStart = -1;
            window.filteredPanelVisibleEnd = -1;
            requestAnimationFrame(function() {
              updateFilteredPanelVisibleLines();
            });
          } else {
            window.rerenderAfterHighlightChangePreserveScroll(true);
          }
          var colorPicker = document.getElementById('highlightColorPicker');
          colorPicker.dataset.originalColor = originalColor;
        } else {
          customHighlights.push({ keyword: selectedText, color: color });
          clearHtmlParseCache();
          if (filteredPanel.classList.contains("visible")) {
            window.filteredPanelVisibleStart = -1;
            window.filteredPanelVisibleEnd = -1;
            requestAnimationFrame(function() {
              updateFilteredPanelVisibleLines();
            });
          } else {
            window.rerenderAfterHighlightChangePreserveScroll(true);
          }
        }
      } else {
        var existingIdx = customHighlights.findIndex(function(h) { return h.keyword === selectedText; });
        if (existingIdx < 0) {
          customHighlights.push({ keyword: selectedText, color: color });
        } else {
          customHighlights[existingIdx].color = color;
        }
        clearHtmlParseCache();
        if (filteredPanel.classList.contains("visible")) {
          invalidateFilteredLineCache();
          window.filteredPanelVisibleStart = -1;
          window.filteredPanelVisibleEnd = -1;
          requestAnimationFrame(function() {
            updateFilteredPanelVisibleLines();
          });
          showMessage('已高亮关键词 "' + selectedText + '"');
        } else {
          window.rerenderAfterHighlightChangePreserveScroll(true);
          showMessage('已高亮关键词 "' + selectedText + '"');
        }
      }
    }

    function excludeLinesWithSelectedText(excludeText) {
      var currentLines = filteredPanelAllLines || [];
      var currentOriginalIndices = filteredPanelAllOriginalIndices || [];
      var currentPrimaryIndices = filteredPanelAllPrimaryIndices || [];

      if (currentLines.length === 0) {
        showMessage('没有可过滤的行');
        return;
      }

      var newLines = [];
      var newOriginalIndices = [];
      var newPrimaryIndices = [];

      for (var i = 0; i < currentLines.length; i++) {
        var line = currentLines[i];
        if (!line.includes(excludeText)) {
          newLines.push(line);
          newOriginalIndices.push(currentOriginalIndices[i]);
          if (currentPrimaryIndices.length > i) {
            newPrimaryIndices.push(currentPrimaryIndices[i]);
          }
        }
      }

      var excludedCount = currentLines.length - newLines.length;
      if (excludedCount === 0) {
        showMessage('没有找到包含 "' + excludeText + '" 的行');
        return;
      }
      if (newLines.length === 0) {
        showMessage('所有行都被排除了，无法显示');
        return;
      }

      window.secondaryFilter = {
        isActive: true,
        filterKeywords: [excludeText],
        filteredLines: newLines,
        filteredToOriginalIndex: newOriginalIndices,
        filteredToPrimaryIndex: newPrimaryIndices,
        isExclusion: true,
        totalLines: newLines.length
      };

      updateFilteredPanel(newLines, newOriginalIndices, newPrimaryIndices, -1);
      showMessage('已去除 ' + excludedCount + ' 行包含 "' + excludeText + '" 的行，剩余 ' + newLines.length + ' 行');
    }
  }

  window.initFilterContextMenu = initFilterContextMenu;

  window.App = window.App || {};
  window.App.FilterContextMenu = {
    init: initFilterContextMenu
  };
})();
