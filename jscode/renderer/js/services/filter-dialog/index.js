/**
 * Filter Dialog — expanded filter input with history
 *
 * Extracted from 08-file-tree.js. Provides the expandable filter
 * textarea dialog with keyboard navigation and filter history.
 */
/* global DOMCache, filterHistory, filteredPanel, filteredPanelMinimizedBtn, applyFilter, cleanFilterData, renderLogLines, updateVisibleLines */
(function() {
  'use strict';

  function initExpandFilter() {
    var expandFilterBtn = document.getElementById('expandFilterBtn');
    var filterDialog = document.getElementById('filterDialog');
    var closeFilterDialog = document.getElementById('closeFilterDialog');
    var filterDialogTextarea = document.getElementById('filterDialogTextarea');
    var applyFilterDialog = document.getElementById('applyFilterDialog');
    var clearFilterDialog = document.getElementById('clearFilterDialog');
    if (!expandFilterBtn || !filterDialog || !closeFilterDialog || !filterDialogTextarea) return;
    var currentFilterKeywords = document.getElementById('currentFilterKeywords');
    var filterBox = DOMCache.get('filterBox');
    var filterHistorySuggestions = document.getElementById('filterHistorySuggestions');
    var filterHistoryList = document.getElementById('filterHistoryList');

    var selectedHistoryIndex = -1;
    var historyItems = [];

    if (filterHistoryList) {
      filterHistoryList.addEventListener('click', function(e) {
        var item = e.target.closest('.filter-history-item');
        if (!item) return;
        var index = parseInt(item.getAttribute('data-index'));
        if (isNaN(index) || index < 0 || index >= historyItems.length) return;
        filterDialogTextarea.value = historyItems[index].keyword;
        filterHistorySuggestions.style.display = 'none';
        filterDialogTextarea.focus();
      });
    }

    function autoResizeTextarea() {
      var minHeight = 60;
      var maxHeight = 200;
      filterDialogTextarea.style.height = 'auto';
      var scrollHeight = filterDialogTextarea.scrollHeight;
      filterDialogTextarea.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';
    }

    function updateCurrentFilterKeywords() {
      var keywords = filterBox.value.trim();
      if (keywords) {
        currentFilterKeywords.textContent = keywords;
      } else {
        currentFilterKeywords.textContent = '无';
      }
    }

    function applyAndClose() {
      filterBox.value = filterDialogTextarea.value;
      applyFilter();
      updateCurrentFilterKeywords();
      filterDialog.classList.remove('visible');
      hideFilterHistory();
    }

    function showFilterHistory() {
      var historySource = (typeof window.getAppFilterHistory === 'function') ? window.getAppFilterHistory() : filterHistory;
      historyItems = historySource.slice(0, 20).map(function(keyword, index) {
        return { keyword: keyword, index: index };
      });

      if (historyItems.length === 0) {
        filterHistoryList.innerHTML = '<div class="filter-history-item">暂无历史记录</div>';
      } else {
        filterHistoryList.innerHTML = historyItems.map(function(item, index) {
          return '<div class="filter-history-item" data-index="' + index + '">' +
            '<div class="keyword">' + item.keyword + '</div></div>';
        }).join('');
      }

      filterHistorySuggestions.style.display = 'block';
      selectedHistoryIndex = -1;
    }

    function hideFilterHistory() {
      filterHistorySuggestions.style.display = 'none';
      selectedHistoryIndex = -1;
    }

    function updateSelectedHistory() {
      var items = filterHistoryList.querySelectorAll('.filter-history-item');
      items.forEach(function(item, index) {
        if (index === selectedHistoryIndex) {
          item.classList.add('selected');
        } else {
          item.classList.remove('selected');
        }
      });
    }

    expandFilterBtn.addEventListener('click', function() {
      filterDialogTextarea.value = filterBox.value;
      updateCurrentFilterKeywords();
      filterDialog.classList.add('visible');
      filterDialogTextarea.focus();
      autoResizeTextarea();
      showFilterHistory();
    });

    filterDialogTextarea.addEventListener('keydown', function(e) {
      var items = filterHistoryList.querySelectorAll('.filter-history-item');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filterHistorySuggestions.style.display === 'none') {
          showFilterHistory();
        } else {
          selectedHistoryIndex = Math.min(selectedHistoryIndex + 1, items.length - 1);
          updateSelectedHistory();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filterHistorySuggestions.style.display === 'none') {
          showFilterHistory();
        } else {
          selectedHistoryIndex = Math.max(selectedHistoryIndex - 1, 0);
          updateSelectedHistory();
        }
      } else if (e.key === 'Enter') {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        if (selectedHistoryIndex >= 0 && items[selectedHistoryIndex]) {
          var index = parseInt(items[selectedHistoryIndex].getAttribute('data-index'));
          filterDialogTextarea.value = historyItems[index].keyword;
          applyAndClose();
        } else {
          applyAndClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (filterHistorySuggestions.style.display === 'block') {
          hideFilterHistory();
        } else {
          filterDialog.classList.remove('visible');
        }
      }
    });

    filterDialogTextarea.addEventListener('input', function() {
      autoResizeTextarea();
    });

    filterDialogTextarea.addEventListener('focus', function() {
      showFilterHistory();
    });

    document.addEventListener('click', function(e) {
      if (!filterDialog.contains(e.target)) {
        hideFilterHistory();
      }
    });

    closeFilterDialog.addEventListener('click', function() {
      filterDialog.classList.remove('visible');
      if (filterDialogTextarea.value.trim() === '') {
        cleanFilterData();
      }
      hideFilterHistory();
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

    filterDialog.addEventListener('click', function(e) {
      if (e.target === filterDialog) {
        filterDialog.classList.remove('visible');
        if (filterDialogTextarea.value.trim() === '') {
          cleanFilterData();
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

    applyFilterDialog.addEventListener('click', function() {
      applyAndClose();
    });

    clearFilterDialog.addEventListener('click', function() {
      filterDialogTextarea.value = '';
      filterBox.value = '';
      cleanFilterData();
      renderLogLines();
      updateVisibleLines();
      updateCurrentFilterKeywords();
      hideFilterHistory();
    });

    updateCurrentFilterKeywords();
    filterBox.addEventListener('input', updateCurrentFilterKeywords);
  }

  window.initExpandFilter = initExpandFilter;

  window.App = window.App || {};
  window.App.FilterDialog = {
    init: initExpandFilter
  };
})();
