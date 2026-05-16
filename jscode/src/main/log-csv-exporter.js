'use strict';

const { ipcMain, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');
const { parseZipCentralDir, resolveZip64ExtraField } = require('./utils');
const parserRegistry = require('./log-parsers');
const { getFilePatterns } = require('./log-parsers/generic-parser');

// ===================================================================
// Data store — holds parsed results for report window
// ===================================================================

const analysisStore = {
  tabs: [],
  data: [],
  reportWindow: null
};

function clearStore() {
  analysisStore.tabs = [];
  analysisStore.data = [];
  if (analysisStore.reportWindow && !analysisStore.reportWindow.isDestroyed()) {
    analysisStore.reportWindow.close();
  }
  analysisStore.reportWindow = null;
}

// ===================================================================
// ZIP listing
// ===================================================================

function listZipEntries(archivePath) {
  if (!fs.existsSync(archivePath)) {
    return { success: false, error: 'ZIP文件不存在' };
  }

  const fileSize = fs.statSync(archivePath).size;
  const fd = fs.openSync(archivePath, 'r');

  try {
    const eocd = parseZipCentralDir(fd, fileSize);
    if (!eocd) return { success: false, error: '不是有效的ZIP文件' };

    const { cdEntryCount, cdSize, cdOffset } = eocd;
    if (cdEntryCount === 0) return { success: true, files: [] };

    const cdBuffer = Buffer.alloc(cdSize);
    fs.readSync(fd, cdBuffer, 0, cdSize, cdOffset);

    const files = [];
    let pos = 0;

    for (let i = 0; i < cdEntryCount && pos < cdBuffer.length; i++) {
      if (cdBuffer.readUInt32LE(pos) !== 0x02014b50) break;

      let compressedSize = cdBuffer.readUInt32LE(pos + 20);
      let uncompressedSize = cdBuffer.readUInt32LE(pos + 24);
      const fileNameLength = cdBuffer.readUInt16LE(pos + 28);
      const extraFieldLength = cdBuffer.readUInt16LE(pos + 30);
      const fileCommentLength = cdBuffer.readUInt16LE(pos + 32);
      const externalAttributes = cdBuffer.readUInt32LE(pos + 38);
      let localHeaderOffset = cdBuffer.readUInt32LE(pos + 42);

      const fileName = cdBuffer.toString('utf8', pos + 46, pos + 46 + fileNameLength);

      if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localHeaderOffset === 0xFFFFFFFF) {
        const resolved = resolveZip64ExtraField(cdBuffer, pos, fileNameLength, extraFieldLength,
          compressedSize, uncompressedSize, localHeaderOffset);
        compressedSize = resolved.compressedSize;
        uncompressedSize = resolved.uncompressedSize;
        localHeaderOffset = resolved.localHeaderOffset;
      }

      const isDirectory = fileName.endsWith('/') ||
        ((externalAttributes >>> 16) & 0x4000) !== 0;

      if (fileName && !isDirectory && !fileName.startsWith('__MACOSX')) {
        files.push(fileName);
      }

      pos += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }

    return { success: true, files };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    fs.closeSync(fd);
  }
}

// ===================================================================
// Worker thread pool
// ===================================================================

function runWorkers(archivePath, entries, keywords, numWorkers, platform, progressCb) {
  return new Promise((resolve, reject) => {
    if (entries.length === 0 || keywords.length === 0) {
      resolve({});
      return;
    }

    const chunkSize = Math.ceil(entries.length / numWorkers);
    const chunks = [];
    for (let i = 0; i < entries.length; i += chunkSize) {
      chunks.push(entries.slice(i, i + chunkSize));
    }

    const workerResults = new Array(chunks.length);
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < chunks.length; i++) {
      const workerPath = path.join(__dirname, 'analysis-worker.js');
      const worker = new Worker(workerPath, {
        workerData: { archivePath, entries: chunks[i], keywords, platform }
      });

      worker.on('message', (msg) => {
        workerResults[i] = msg;
        completed++;
        if (progressCb) progressCb(completed, chunks.length);
        if (completed + failed === chunks.length) finish();
      });

      worker.on('error', () => {
        failed++;
        if (completed + failed === chunks.length) finish();
      });
    }

    function finish() {
      if (failed === chunks.length) {
        reject(new Error('所有工作线程解析失败'));
        return;
      }
      const merged = {};
      for (const result of workerResults) {
        if (!result) continue;
        for (const [kw, rows] of Object.entries(result)) {
          if (!merged[kw]) merged[kw] = [];
          merged[kw].push(...rows);
        }
      }
      resolve(merged);
    }
  });
}

// ===================================================================
// Build tab structures
// ===================================================================

function calcColWidth(label) {
  let w = 32;
  for (const ch of label) {
    if (/[一-鿿]/.test(ch)) w += 16;
    else if (/[A-Z]/.test(ch)) w += 10;
    else if (/[a-z]/.test(ch)) w += 8;
    else w += 9;
  }
  return Math.max(70, w);
}

function calcContentWidth(keys, rows, sampleCount) {
  const widths = keys.map(k => 0);
  const n = Math.min(rows.length, sampleCount);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < keys.length; j++) {
      const v = rows[i].data[keys[j]];
      const s = (v === undefined || v === null) ? '' : String(v);
      let w = 24;
      for (const ch of s) {
        if (/[一-鿿]/.test(ch)) w += 16;
        else if (/[A-Z]/.test(ch)) w += 10;
        else if (/[a-z]/.test(ch)) w += 8;
        else w += 9;
      }
      if (w > widths[j]) widths[j] = w;
    }
  }
  return widths;
}

function buildStore(mergedResults) {
  const tabs = [];
  const data = [];

  for (const [keyword, rows] of Object.entries(mergedResults)) {
    const parser = parserRegistry.getParser(keyword);
    const labels = parser && parser.getHeaderLabels ? parser.getHeaderLabels() : {};
    const tabName = parser && parser.getTabName ? parser.getTabName() : keyword;

    // Build adaptive column order: preferred order from parser + any extra keys from data
    const preferredKeys = parser && parser.getHeaders ? parser.getHeaders() : [];
    const dataKeys = new Set();
    for (const r of rows) {
      for (const k of Object.keys(r.data)) dataKeys.add(k);
    }
    // Start with preferred keys (in defined order), then append any new keys
    const keys = preferredKeys.slice();
    const keySet = new Set(keys);
    for (const k of dataKeys) {
      if (!keySet.has(k)) { keys.push(k); keySet.add(k); }
    }

    const headerLabels = keys.map(k => labels[k] || k);
    const rowData = rows.map(r =>
      keys.map(k => {
        const v = r.data[k];
        return (v === undefined || v === null) ? '' : String(v);
      })
    );

    // Auto-hide columns where every row is empty (field missing from actual log)
    const STD_PREFIX = new Set(['source_file', 'android_time', 'timestamp', 'ts_raw', 'caller']);
    const nonEmptyIdx = [];
    for (let j = 0; j < keys.length; j++) {
      if (STD_PREFIX.has(keys[j])) { nonEmptyIdx.push(j); continue; }
      for (let i = 0; i < rowData.length; i++) {
        if (rowData[i][j] !== '') { nonEmptyIdx.push(j); break; }
      }
    }
    const filteredKeys = nonEmptyIdx.map(j => keys[j]);
    const filteredHeaderLabels = nonEmptyIdx.map(j => headerLabels[j]);
    const filteredRowData = rowData.length > 0 ? rowData.map(row => nonEmptyIdx.map(j => row[j])) : rowData;

    const filteredHeaderWidths = filteredKeys.map(k => calcColWidth(labels[k] || k));
    const filteredContentWidths = calcContentWidth(filteredKeys, rows, 100);
    const filteredColWidths = filteredKeys.map((_, i) => Math.max(filteredHeaderWidths[i], filteredContentWidths[i]));

    const printInterface = parser && parser.getPrintInterface ? parser.getPrintInterface() : '';
    const fieldMapping = parser && parser.getFieldMapping ? parser.getFieldMapping() : [];
    const keyLabels = {};
    for (const k of filteredKeys) keyLabels[k] = labels[k] || k;

    // Find unmatched fields: defined in config but not present in actual data
    const filteredKeySet = new Set(filteredKeys);
    const unmatchedFields = preferredKeys
      .filter(k => !STD_PREFIX.has(k) && !filteredKeySet.has(k))
      .map(k => ({ key: k, label: labels[k] || k }));

    tabs.push({ name: tabName, count: rows.length, headerLabels: filteredHeaderLabels, colWidths: filteredColWidths, keyword, printInterface, fieldMapping, keyLabels, keys: filteredKeys, unmatchedFields });
    data.push(filteredRowData);
  }

  return { tabs, data };
}

// ===================================================================
// IPC: get-analysis-keywords
// ===================================================================

ipcMain.handle('get-analysis-keywords', (event, platform) => {
  return parserRegistry.getKeywordsWithInfo(platform || 'mtk');
});

// ===================================================================
// IPC: export-csv-analysis (full flow)
// ===================================================================

ipcMain.handle('export-csv-analysis', async (event, archivePath, selectedKeywords, platform) => {
  try {
    if (!archivePath || !fs.existsSync(archivePath)) {
      return { success: false, error: '文件不存在' };
    }

    clearStore();

    const listResult = listZipEntries(archivePath);
    if (!listResult.success) {
      return { success: false, error: listResult.error };
    }

    const filePatterns = getFilePatterns();
    const patternRegex = new RegExp('^(' + filePatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');
    const kernelLogFiles = listResult.files
      .filter(f => patternRegex.test(path.basename(f)))
      .sort((a, b) => {
        const na = parseInt(path.basename(a).match(/\d+/)?.[0] || '0', 10);
        const nb = parseInt(path.basename(b).match(/\d+/)?.[0] || '0', 10);
        return na - nb;
      });

    if (kernelLogFiles.length === 0) {
      return { success: false, error: 'ZIP中未找到 ' + filePatterns.join('/') + ' 开头的文件' };
    }

    const allKeywords = parserRegistry.getKeywords();
    const keywords = (selectedKeywords && selectedKeywords.length > 0)
      ? selectedKeywords.filter(k => allKeywords.includes(k))
      : allKeywords;

    if (keywords.length === 0) {
      return { success: false, error: '没有可用的解析关键词' };
    }

    event.sender.send('csv-export-progress', {
      stage: 'extracting', fileIndex: 0, totalFiles: kernelLogFiles.length, percent: 10
    });

    const numWorkers = Math.min(Math.max(4, os.cpus().length - 1), kernelLogFiles.length);
    const merged = await runWorkers(archivePath, kernelLogFiles, keywords, numWorkers, platform,
      (done, total) => {
        event.sender.send('csv-export-progress', {
          stage: 'extracting', percent: 10 + Math.round((done / total) * 60)
        });
      }
    );

    const totalRows = Object.values(merged).reduce((s, r) => s + r.length, 0);
    if (totalRows === 0) {
      return { success: false, error: '未找到匹配的日志数据' };
    }

    event.sender.send('csv-export-progress', { stage: 'generating', percent: 80 });

    const { tabs, data } = buildStore(merged);
    analysisStore.tabs = tabs;
    analysisStore.data = data;

    event.sender.send('csv-export-progress', { stage: 'generating', percent: 90 });

    const htmlContent = parserRegistry.generateStaticHTML();
    const tempFile = path.join(os.tmpdir(), 'vivo_log_analysis_' + Date.now() + '.html');
    fs.writeFileSync(tempFile, htmlContent, 'utf-8');

    const baseName = path.basename(archivePath, path.extname(archivePath));
    const reportWindow = new BrowserWindow({
      title: '日志分析报告 - ' + baseName,
      width: 1400,
      height: 900,
      show: true,
      frame: false,
      backgroundColor: '#F5F5F7',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'analysis-report-preload.js')
      }
    });

    reportWindow.maximize();
    analysisStore.reportWindow = reportWindow;

    await reportWindow.loadFile(tempFile);

    reportWindow.on('closed', () => {
      try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
      if (analysisStore.reportWindow === reportWindow) {
        analysisStore.reportWindow = null;
      }
    });

    return { success: true, rowCount: totalRows, fileCount: kernelLogFiles.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===================================================================
// IPC: analysis-get-tabs — returns tab metadata with headers
// ===================================================================

ipcMain.handle('analysis-get-tabs', () => {
  return analysisStore.tabs.map(tab => ({
    name: tab.name,
    count: tab.count,
    headers: tab.headerLabels,
    colWidths: tab.colWidths,
    keyword: tab.keyword,
    printInterface: tab.printInterface,
    fieldMapping: tab.fieldMapping,
    unmatchedFields: tab.unmatchedFields || [],
    keyLabels: tab.keyLabels,
    keys: tab.keys
  }));
});

// ===================================================================
// IPC: analysis-get-full-data — returns ALL rows for one tab
// ===================================================================

ipcMain.handle('analysis-get-full-data', (event, tabIdx) => {
  const rows = analysisStore.data[tabIdx];
  if (!rows) return { success: false };
  return { success: true, data: rows };
});

// ===================================================================
// IPC: save-analysis-report — export self-contained HTML report
// ===================================================================

ipcMain.handle('save-analysis-report', async (event) => {
  try {
    if (analysisStore.tabs.length === 0) {
      return { success: false, error: '没有可导出的数据' };
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: '导出分析报告',
      defaultPath: '日志分析报告_' + Date.now() + '.html',
      filters: [{ name: 'HTML文件', extensions: ['html'] }]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    const htmlContent = parserRegistry.generateReportHTML(analysisStore.tabs, analysisStore.data);
    fs.writeFileSync(result.filePath, htmlContent, 'utf-8');

    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===================================================================
// Window control IPC for analysis report (frameless)
// ===================================================================

ipcMain.on('analysis-window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('analysis-window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
});

ipcMain.on('analysis-window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

function registerIpcHandlers() {}

module.exports = { registerIpcHandlers };
