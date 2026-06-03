/**
 * CSV Viewer — CSV/Vlog table detection and display
 *
 * Extracted from 08-file-tree.js. Provides CSV format detection,
 * line parsing, and table panel display via CSVTableRenderer.
 */
/* global originalLines, fileHeaders */
(function() {
  'use strict';

  function detectCSVFromLines(lines) {
    if (lines.length === 0) {
      return null;
    }
    var sampleLines = lines.slice(0, Math.min(10, lines.length));
    var commaCount = 0;
    var totalLines = sampleLines.length;
    for (var s = 0; s < sampleLines.length; s++) {
      var commas = (sampleLines[s].match(/,/g) || []).length;
      if (commas >= 2) {
        commaCount++;
      }
    }
    if (commaCount / totalLines < 0.7) {
      return null;
    }
    return lines;
  }

  async function detectAndParseCSV() {
    // 1. Try originalLines (normal/streaming mode)
    if (originalLines && originalLines.length > 0) {
      var lines = [];
      for (var i = 0; i < originalLines.length; i++) {
        var line = originalLines[i];
        if (line && !line.startsWith('===')) {
          lines.push(line);
        }
      }
      if (lines.length > 0) {
        var result = detectCSVFromLines(lines);
        if (result) {
          console.log('[CSVViewer] 检测到CSV格式(normal mode)，共' + lines.length + '行');
          return result;
        }
      }
    }

    // 2. Chunk mode: read from chunk files
    if (fileHeaders && fileHeaders.length > 0) {
      for (var f = 0; f < fileHeaders.length; f++) {
        var header = fileHeaders[f];
        if (!header.filePath) continue;
        try {
          var readResult = await window.electronAPI.readFile(header.filePath);
          if (!readResult || !readResult.success || !readResult.content) continue;
          var fileLines = String(readResult.content).split('\n');
          if (fileLines.length > 0) {
            var csvResult = detectCSVFromLines(fileLines);
            if (csvResult) {
              console.log('[CSVViewer] 检测到CSV格式(chunk mode)，文件=' + header.fileName + '，共' + fileLines.length + '行');
              return fileLines;
            }
          }
        } catch (e) {
          console.error('[CSVViewer] 读取分片文件失败:', header.filePath, e);
        }
      }
    }

    console.log('[CSVViewer] 未检测到CSV格式');
    return null;
  }

  function parseCSVLine(line) {
    var result = [];
    var current = '';
    var inQuotes = false;

    for (var i = 0; i < line.length; i++) {
      var char = line[i];
      var nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  async function showCSVTablePanel(csvData) {
    var panel = document.getElementById('csvTablePanel');
    var placeholder = document.getElementById('csvTablePlaceholder');

    if (!panel || !placeholder) {
      console.error('[CSVViewer] 表格面板元素未找到');
      return;
    }

    panel.classList.remove('fullscreen');
    panel.style.width = "80vw";
    panel.style.height = "70vh";
    panel.style.top = "50%";
    panel.style.left = "50%";
    panel.style.transform = "translate(-50%, -50%)";

    placeholder.style.display = 'none';

    if (!window.CSVTableRenderer) {
      console.error('[CSVViewer] CSVTableRenderer 未加载');
      alert('CSV渲染器未加载，请刷新页面');
      return;
    }

    if (csvData.length === 0) {
      console.warn('[CSVViewer] CSV 数据为空');
      return;
    }

    try {
      await window.CSVTableRenderer.show(csvData, {
        visibleColumns: 15
      });
    } catch (error) {
      console.error('[CSVViewer] 渲染失败:', error);
      throw error;
    }
  }

  // Expose to global scope (used by log-context-menu and legacy code)
  window.detectAndParseCSV = detectAndParseCSV;
  window.parseCSVLine = parseCSVLine;
  window.showCSVTablePanel = showCSVTablePanel;

  window.App = window.App || {};
  window.App.CsvViewer = {
    detectAndParseCSV: detectAndParseCSV,
    parseCSVLine: parseCSVLine,
    showCSVTablePanel: showCSVTablePanel
  };
})();
