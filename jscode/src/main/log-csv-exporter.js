'use strict';

const { ipcMain, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');
const { parseZipCentralDir, resolveZip64ExtraField, listArchiveGeneric } = require('./utils');
const parserRegistry = require('./log-parsers');
const { getFilePatterns } = require('./log-parsers/generic-parser');
const projectRoot = path.resolve(__dirname, '..', '..');
const nativeBinding = path.join(projectRoot, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const Database = require(path.join(projectRoot, 'better-sqlite3'));

// ===================================================================
// Data store — parsed results stored in SQLite for zero-memory footprint
// ===================================================================

const analysisStore = {
  tabs: [],
  db: null,
  dbPath: '',
  dbIsImported: false,
  reportWindow: null,
  searchIndex: null
};

function clearStore() {
  analysisStore.tabs = [];
  if (analysisStore.db) {
    try { analysisStore.db.close(); } catch (e) {}
    analysisStore.db = null;
  }
  analysisStore.dbPath = '';
  analysisStore.dbIsImported = false;
  analysisStore.searchIndex = null;
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

      // 1. Collect file metadata from all workers
      const allFileMeta = {};
      const fileFirstIndex = {};
      let idx = 0;
      for (let wi = 0; wi < workerResults.length; wi++) {
        const result = workerResults[wi];
        if (!result) continue;
        if (typeof result === 'object' && result.rows) {
          for (const [fileKey, ms] of Object.entries(result.fileMeta || {})) {
            if (!(fileKey in allFileMeta)) {
              allFileMeta[fileKey] = ms;
              fileFirstIndex[fileKey] = idx++;
            }
          }
        }
      }

      // 2. Sort file keys by representative android_time
      const sortedFileKeys = Object.keys(allFileMeta).sort((a, b) => {
        const msA = allFileMeta[a], msB = allFileMeta[b];
        if (msA !== null && msB !== null) return msA - msB;
        if (msA !== null) return -1;
        if (msB !== null) return 1;
        return fileFirstIndex[a] - fileFirstIndex[b];
      });

      // 3. Merge all rows
      const raw = {};
      for (const result of workerResults) {
        if (!result) continue;
        const rows = (typeof result === 'object' && result.rows) ? result.rows : result;
        for (const [kw, arr] of Object.entries(rows)) {
          if (!raw[kw]) raw[kw] = [];
          raw[kw].push(...arr);
        }
      }

      // 4. Reorder by bucket grouping (preserves intra-file order, O(n))
      const merged = {};
      for (const [kw, rows] of Object.entries(raw)) {
        if (!rows || rows.length === 0) { merged[kw] = rows; continue; }
        const buckets = new Map();
        for (const row of rows) {
          const fk = row._fileKey || '';
          if (!buckets.has(fk)) buckets.set(fk, []);
          buckets.get(fk).push(row);
        }
        const sorted = [];
        for (const fk of sortedFileKeys) {
          const b = buckets.get(fk);
          if (b) sorted.push(...b);
        }
        // Append any files not in fileMeta (e.g. from non-object results)
        for (const [fk, b] of buckets) {
          if (!allFileMeta.hasOwnProperty(fk)) sorted.push(...b);
        }
        // Clean _fileKey from output
        for (const row of sorted) delete row._fileKey;
        merged[kw] = sorted;
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

function buildTabMetadata(mergedResults) {
  const tabs = [];
  const rawRows = [];

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

    const filteredKeySet = new Set(filteredKeys);
    const unmatchedFields = preferredKeys
      .filter(k => !STD_PREFIX.has(k) && !filteredKeySet.has(k))
      .map(k => ({ key: k, label: labels[k] || k }));

    tabs.push({ name: tabName, count: rows.length, headerLabels: filteredHeaderLabels, colWidths: filteredColWidths, keyword, printInterface, fieldMapping, keyLabels, keys: filteredKeys, unmatchedFields });
    rawRows.push(filteredRowData);
  }

  return { tabs, rawRows };
}

function writeToDatabase(tabs, rawRows, db) {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -32000');

  for (let t = 0; t < tabs.length; t++) {
    const numCols = tabs[t].keys.length;
    const colDefs = Array.from({ length: numCols }, (_, i) => `col_${i} TEXT`).join(', ');
    db.exec(`CREATE TABLE tab_${t} (rowid INTEGER PRIMARY KEY AUTOINCREMENT, ${colDefs})`);

    const colNames = Array.from({ length: numCols }, (_, i) => `col_${i}`).join(', ');
    const placeholders = Array.from({ length: numCols }, () => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO tab_${t} (${colNames}) VALUES (${placeholders})`);
    const insertMany = db.transaction((rows) => {
      for (const row of rows) stmt.run(...row);
    });
    insertMany(rawRows[t]);
  }

  // Save tab metadata for import feature
  db.exec('CREATE TABLE _tab_meta (tab_idx INTEGER PRIMARY KEY, meta TEXT NOT NULL)');
  const metaStmt = db.prepare('INSERT INTO _tab_meta (tab_idx, meta) VALUES (?, ?)');
  const insertMeta = db.transaction((ts) => {
    for (let i = 0; i < ts.length; i++) {
      metaStmt.run(i, JSON.stringify({
        name: ts[i].name,
        headerLabels: ts[i].headerLabels,
        colWidths: ts[i].colWidths,
        keyword: ts[i].keyword,
        keys: ts[i].keys,
        printInterface: ts[i].printInterface || '',
        fieldMapping: ts[i].fieldMapping || [],
        keyLabels: ts[i].keyLabels || {},
        unmatchedFields: ts[i].unmatchedFields || []
      }));
    }
  });
  insertMeta(tabs);
}

// ===================================================================
// Search Index — invert row data for O(1) exact match + fast substring fallback
// ===================================================================

function buildSearchIndex(tabs, rawRows) {
  const index = tabs.map((tab, t) => {
    const colMaps = tab.keys.map(() => new Map());
    const rows = rawRows[t];
    for (let ri = 0; ri < rows.length; ri++) {
      for (let ci = 0; ci < tab.keys.length; ci++) {
        const v = rows[ri][ci];
        if (!v || v === '') continue;
        if (!colMaps[ci].has(v)) colMaps[ci].set(v, new Set());
        colMaps[ci].get(v).add(ri);
      }
    }
    return colMaps;
  });
  return index;
}

function searchIndex(index, tabIdx, term) {
  if (!index || tabIdx >= index.length) return [];
  const colMaps = index[tabIdx];
  const tokens = term.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const lcTokens = tokens.map(t => t.toLowerCase());

  let resultSet = null;

  for (const lc of lcTokens) {
    const tokenSet = new Set();
    // Fast path: exact match
    for (const map of colMaps) {
      const rows = map.get(lc);
      if (rows) for (const r of rows) tokenSet.add(r);
      if (lc.length <= 3) continue;
      for (const [value, rows] of map) {
        if (value.toLowerCase().includes(lc)) {
          for (const r of rows) tokenSet.add(r);
        }
      }
    }
    if (resultSet === null) {
      resultSet = tokenSet;
    } else {
      for (const r of resultSet) {
        if (!tokenSet.has(r)) resultSet.delete(r);
      }
    }
  }
  return resultSet ? Array.from(resultSet).sort((a, b) => a - b) : [];
}
function readAllRowsFromDB(db, tabIdx) {
  const stmt = db.prepare(`SELECT * FROM tab_${tabIdx}`);
  const results = [];
  for (const row of stmt.iterate()) {
    const vals = [];
    for (const k in row) { if (k !== 'rowid') vals.push(row[k]); }
    results.push(vals);
  }
  return results;
}

// ===================================================================
// IPC: get-analysis-keywords
// ===================================================================

ipcMain.handle('get-analysis-keywords', (event, platform) => {
  return parserRegistry.getKeywordsWithInfo(platform || 'mtk');
});

// ===================================================================
// IPC: export-csv-analysis (full flow — supports ZIP / 7z / RAR / folder)
// ===================================================================

ipcMain.handle('export-csv-analysis', async (event, archivePath, selectedKeywords, platform) => {
  try {
    if (!archivePath || !fs.existsSync(archivePath)) {
      return { success: false, error: '文件不存在' };
    }

    clearStore();

    const srcStat = fs.statSync(archivePath);
    const isFolder = srcStat.isDirectory();
    const isZip = !isFolder && archivePath.toLowerCase().endsWith('.zip');

    let kernelLogFiles;

    if (isFolder) {
      // Folder: walk directory, collect all files
      const allFiles = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fp = path.join(dir, entry.name);
          if (entry.isDirectory()) { walk(fp); continue; }
          if (entry.isFile()) allFiles.push(fp);
        }
      };
      walk(archivePath);
      const filePatterns = getFilePatterns();
      const patternRegex = new RegExp('^(' + filePatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');
      kernelLogFiles = allFiles
        .filter(f => patternRegex.test(path.basename(f)))
        .sort((a, b) => {
          const na = parseInt(path.basename(a).match(/\d+/)?.[0] || '0', 10);
          const nb = parseInt(path.basename(b).match(/\d+/)?.[0] || '0', 10);
          return na - nb;
        });
      if (kernelLogFiles.length === 0) {
        return { success: false, error: '文件夹中未找到 ' + filePatterns.join('/') + ' 开头的文件' };
      }
    } else if (isZip) {
      // ZIP: fast native listing
      const listResult = listZipEntries(archivePath);
      if (!listResult.success) {
        return { success: false, error: listResult.error };
      }
      const filePatterns = getFilePatterns();
      const patternRegex = new RegExp('^(' + filePatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');
      kernelLogFiles = listResult.files
        .filter(f => patternRegex.test(path.basename(f)))
        .sort((a, b) => {
          const na = parseInt(path.basename(a).match(/\d+/)?.[0] || '0', 10);
          const nb = parseInt(path.basename(b).match(/\d+/)?.[0] || '0', 10);
          return na - nb;
        });
      if (kernelLogFiles.length === 0) {
        return { success: false, error: 'ZIP中未找到 ' + filePatterns.join('/') + ' 开头的文件' };
      }
    } else {
      // 7z / RAR / other: use 7z.exe listing
      const listResult = listArchiveGeneric(archivePath);
      if (!listResult.success) {
        return { success: false, error: listResult.error };
      }
      const filePatterns = getFilePatterns();
      const patternRegex = new RegExp('^(' + filePatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');
      kernelLogFiles = listResult.files
        .filter(f => patternRegex.test(path.basename(f)))
        .sort((a, b) => {
          const na = parseInt(path.basename(a).match(/\d+/)?.[0] || '0', 10);
          const nb = parseInt(path.basename(b).match(/\d+/)?.[0] || '0', 10);
          return na - nb;
        });
      if (kernelLogFiles.length === 0) {
        return { success: false, error: '压缩包中未找到 ' + filePatterns.join('/') + ' 开头的文件' };
      }
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

    const { tabs, rawRows } = buildTabMetadata(merged);
    const memDir = path.join(projectRoot, 'mem');
    if (!fs.existsSync(memDir)) { try { fs.mkdirSync(memDir, { recursive: true }); } catch (e) {} }
    // Clean up old analysis DB files from previous sessions
    try {
      for (const f of fs.readdirSync(memDir)) {
        if (/^analysis_\d+\.db$/.test(f)) {
          try { fs.unlinkSync(path.join(memDir, f)); } catch (e) {}
          try { fs.unlinkSync(path.join(memDir, f + '-wal')); } catch (e) {}
          try { fs.unlinkSync(path.join(memDir, f + '-shm')); } catch (e) {}
        }
      }
    } catch (e) {}
    const dbPath = path.join(memDir, 'analysis_' + Date.now() + '.db');
    const db = new Database(dbPath, { nativeBinding });
    writeToDatabase(tabs, rawRows, db);
    analysisStore.tabs = tabs;
    analysisStore.db = db;
    analysisStore.dbPath = dbPath;
    analysisStore.searchIndex = buildSearchIndex(tabs, rawRows);

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
        clearStore();
      }
    });

    return { success: true, rowCount: totalRows, fileCount: kernelLogFiles.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===================================================================
// IPC: analysis-import-database — import a .db file directly
// ===================================================================

ipcMain.handle('analysis-import-database', async () => {
  if (!analysisStore.reportWindow || analysisStore.reportWindow.isDestroyed()) {
    return { success: false, error: '分析窗口不存在' };
  }
  const result = await dialog.showOpenDialog(analysisStore.reportWindow, {
    title: '导入分析数据库',
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };

  const dbPath = result.filePaths[0];

  // Validate: must have tab_N data tables
  let db;
  try {
    db = new Database(dbPath, { nativeBinding });
    const dataTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tab_%' AND name != '_tab_meta' ORDER BY name").all();
    if (dataTables.length === 0) {
      db.close();
      return { success: false, error: '该文件不是有效的分析数据库' };
    }
  } catch (e) {
    return { success: false, error: '无法打开数据库: ' + e.message };
  }

  // Close old DB
  if (analysisStore.db) {
    try { analysisStore.db.close(); } catch (e) {}
    analysisStore.db = null;
  }
  // Clean up old temp DB file
  if (analysisStore.dbPath && !analysisStore.dbIsImported) {
    try { fs.unlinkSync(analysisStore.dbPath); } catch (e) {}
    try { fs.unlinkSync(analysisStore.dbPath + '-wal'); } catch (e) {}
    try { fs.unlinkSync(analysisStore.dbPath + '-shm'); } catch (e) {}
  }

  // Reconstruct tabs — try _tab_meta first, fallback to schema inspection
  const hasMeta = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_tab_meta'").all().length > 0;
  let tabs;

  if (hasMeta) {
    // New format: metadata stored in _tab_meta table
    const metaRows = db.prepare('SELECT tab_idx, meta FROM _tab_meta ORDER BY tab_idx').all();
    tabs = metaRows.map(row => {
      const m = JSON.parse(row.meta);
      return {
        name: m.name, count: 0,
        headerLabels: m.headerLabels, colWidths: m.colWidths,
        keyword: m.keyword, keys: m.keys,
        printInterface: m.printInterface, fieldMapping: m.fieldMapping,
        keyLabels: m.keyLabels, unmatchedFields: m.unmatchedFields
      };
    });
  } else {
    // Legacy format: no _tab_meta, reconstruct from table schema
    const dataTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tab_%' AND name != '_tab_meta' ORDER BY name").all();
    tabs = dataTables.map(row => {
      const tableName = row.name;
      const idx = parseInt(tableName.replace('tab_', ''), 10);
      const info = db.pragma('table_info(' + tableName + ')');
      const cols = info.filter(c => c.name !== 'rowid');
      const keys = cols.map(c => c.name);
      const headers = cols.map(c => c.name.replace(/^col_/, '列 '));
      const colWidths = cols.map(() => 120);
      return {
        name: '标签 ' + (idx + 1), count: 0,
        headerLabels: headers, colWidths: colWidths,
        keyword: tableName, keys: keys,
        printInterface: '', fieldMapping: [],
        keyLabels: {}, unmatchedFields: []
      };
    });
    tabs.sort((a, b) => parseInt(a.keyword.replace('tab_', ''), 10) - parseInt(b.keyword.replace('tab_', ''), 10));
  }

  // Get row counts
  for (let i = 0; i < tabs.length; i++) {
    const r = db.prepare('SELECT COUNT(*) as cnt FROM tab_' + i).get();
    tabs[i].count = r.cnt;
  }

  analysisStore.tabs = tabs;
  analysisStore.db = db;
  analysisStore.dbPath = dbPath;
  analysisStore.dbIsImported = true;

  console.log('[import-db] loaded ' + dbPath + ' — ' + tabs.length + ' tabs');

  return {
    success: true,
    tabs: tabs.map(tab => ({
      name: tab.name, count: tab.count, headers: tab.headerLabels,
      colWidths: tab.colWidths, keyword: tab.keyword,
      printInterface: tab.printInterface, fieldMapping: tab.fieldMapping,
      unmatchedFields: tab.unmatchedFields || [], keyLabels: tab.keyLabels,
      keys: tab.keys
    }))
  };
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
// IPC: analysis-get-full-data — returns ALL rows for one tab (for embedded report)
// ===================================================================

ipcMain.handle('analysis-get-full-data', (event, tabIdx) => {
  if (!analysisStore.db) return { success: false };
  return { success: true, data: readAllRowsFromDB(analysisStore.db, tabIdx) };
});

// ===================================================================
// IPC: analysis-get-rows — returns a range of rows for one tab
// ===================================================================

ipcMain.handle('analysis-get-rows', (event, tabIdx, from, count) => {
  if (!analysisStore.db) return { success: false };
  const tab = analysisStore.tabs[tabIdx];
  if (!tab) return { success: false };
  const safeFrom = Math.max(0, from);
  const safeCount = Math.max(0, Math.min(count, tab.count - safeFrom));
  if (safeCount <= 0) return { success: true, rows: [], from: safeFrom };
  const colNames = tab.keys.map((_, i) => 'col_' + i).join(', ');
  const stmt = analysisStore.db.prepare(
    'SELECT ' + colNames + ' FROM tab_' + tabIdx + ' WHERE rowid BETWEEN ? AND ?'
  );
  console.log('[sqlite-read] tab=' + tabIdx + ' rows=' + safeFrom + '~' + (safeFrom + safeCount - 1) + ' (' + safeCount + ' rows)');
  const result = stmt.all(safeFrom + 1, safeFrom + safeCount);
  const rows = result.map(row => tab.keys.map((_, i) => row['col_' + i] || ''));
  return { success: true, rows, from: safeFrom };
});

// ===================================================================
// IPC: analysis-search-rows — memory inverted index (fast path) with SQL fallback
// ===================================================================

ipcMain.handle('analysis-search-rows', (event, tabIdx, term) => {
  if (!term) return { matches: [] };
  const tab = analysisStore.tabs[tabIdx];
  if (!tab) return { matches: [] };

  // Fast path: memory inverted index
  if (analysisStore.searchIndex) {
    const matches = searchIndex(analysisStore.searchIndex, tabIdx, term);
    return { matches };
  }

  // Fallback: SQL LIKE for imported databases (no index)
  if (!analysisStore.db) return { matches: [] };
  const likeTerm = '%' + term + '%';
  const conditions = tab.keys.map((_, i) => 'col_' + i + ' LIKE ?').join(' OR ');
  const params = tab.keys.map(() => likeTerm);
  const rows = analysisStore.db.prepare(
    'SELECT rowid FROM tab_' + tabIdx + ' WHERE ' + conditions
  ).all(...params);
  return { matches: rows.map(r => r.rowid - 1) };
});

// ===================================================================
// IPC: analysis-get-chart-meta — fast metadata only (no row data)
// ===================================================================

ipcMain.handle('analysis-get-chart-meta', (event, tabIdx, visCols) => {
  if (!analysisStore.db) return { success: false };
  const tab = analysisStore.tabs[tabIdx];
  if (!tab) return { success: false };
  const headerLabels = visCols ? visCols.map(c => tab.headerLabels[c]) : tab.headerLabels;
  const skipLabels = { '源文件': 1, 'Android时间': 1, '时间戳(s)': 1, '原始时间戳': 1, '日志级别': 1, '调用线程': 1 };
  const chartColors = ['#007AFF', '#FF9500', '#34C759', '#5856D6', '#FF2D55', '#5AC8FA', '#FFCC00', '#8E8E93'];

  // Single query: COUNT + MIN + MAX for all columns via sampling
  const sampleRate = Math.max(1, Math.floor(tab.count / 1000));
  const parts = [];
  const colIndices = [];
  for (let ci = 0; ci < headerLabels.length; ci++) {
    if (skipLabels[headerLabels[ci]]) continue;
    colIndices.push(ci);
    parts.push(
      'SUM(CASE WHEN CAST(col_' + ci + " AS REAL) IS NOT NULL AND col_" + ci + " != '' THEN 1 ELSE 0 END) as nc" + ci,
      'MIN(CASE WHEN CAST(col_' + ci + " AS REAL) IS NOT NULL AND col_" + ci + " != '' THEN CAST(col_" + ci + ' AS REAL) END) as mn' + ci,
      'MAX(CASE WHEN CAST(col_' + ci + " AS REAL) IS NOT NULL AND col_" + ci + " != '' THEN CAST(col_" + ci + ' AS REAL) END) as mx' + ci
    );
  }

  const configs = [];
  if (parts.length > 0) {
    const row = analysisStore.db.prepare(
      'SELECT ' + parts.join(', ') + ' FROM tab_' + tabIdx + ' WHERE (rowid-1) % ' + sampleRate + ' = 0'
    ).get();
    for (const ci of colIndices) {
      const nc = row['nc' + ci];
      const mn = row['mn' + ci];
      const mx = row['mx' + ci];
      if (nc >= 2 && mn !== null && mx !== null) {
        configs.push({ ci, name: headerLabels[ci], visible: false, color: chartColors[configs.length % chartColors.length], min: mn, max: mx });
      }
    }
  }

  let tooltipAT = -1, tooltipSF = -1;
  for (let ci = 0; ci < headerLabels.length; ci++) {
    if (headerLabels[ci] === 'Android时间') tooltipAT = ci;
    if (headerLabels[ci] === '源文件') tooltipSF = ci;
  }
  return { success: true, configs, tooltipAT, tooltipSF, totalRows: tab.count };
});

// ===================================================================
// IPC: analysis-get-chart-series — load one series on demand
// ===================================================================

ipcMain.handle('analysis-get-chart-series', (event, tabIdx, colIdx, maxPoints, fromRow, toRow) => {
  if (!analysisStore.db) return { success: false };
  const tab = analysisStore.tabs[tabIdx];
  if (!tab) return { success: false };
  maxPoints = maxPoints || 3000;
  const totalCount = tab.count;
  const dbCol = 'col_' + colIdx;

  // Range filter
  const safeFrom = (fromRow !== undefined && fromRow !== null) ? Math.max(0, fromRow) : 0;
  const safeTo = (toRow !== undefined && toRow !== null) ? Math.min(totalCount - 1, toRow) : totalCount - 1;
  const rangeLen = safeTo - safeFrom + 1;
  const rangeWhere = ' AND rowid BETWEEN ' + (safeFrom + 1) + ' AND ' + (safeTo + 1);

  if (rangeLen <= maxPoints) {
    // Small range: return all data directly
    const rows = analysisStore.db.prepare(
      'SELECT rowid-1 as ri, CAST(' + dbCol + ' AS REAL) as v FROM tab_' + tabIdx + ' WHERE ' + dbCol + " != '' AND CAST(" + dbCol + ' AS REAL) IS NOT NULL' + rangeWhere + ' ORDER BY rowid'
    ).all();
    const points = [];
    for (const r of rows) {
      if (r.v !== null && !isNaN(r.v)) points.push({ i: r.ri, v: r.v });
    }
    return { success: true, points, totalRows: totalCount, from: safeFrom, to: safeTo };
  }

  // Large range: SQL min-max downsampling within range
  const bucketSize = Math.ceil(rangeLen / maxPoints);
  const rows = analysisStore.db.prepare(
    'SELECT (rowid-1-' + safeFrom + ')/' + bucketSize + ' as bucket, MIN(CAST(' + dbCol + ' AS REAL)) as mn, MAX(CAST(' + dbCol + ' AS REAL)) as mx ' +
    'FROM tab_' + tabIdx + ' WHERE ' + dbCol + " != '' AND CAST(" + dbCol + ' AS REAL) IS NOT NULL' + rangeWhere + ' GROUP BY bucket ORDER BY bucket'
  ).all();
  const points = [];
  for (const r of rows) {
    const baseIdx = safeFrom + r.bucket * bucketSize;
    if (r.mn === r.mx) {
      points.push({ i: baseIdx, v: r.mn });
    } else {
      points.push({ i: baseIdx, v: r.mn });
      points.push({ i: baseIdx + bucketSize - 1, v: r.mx });
    }
  }
  return { success: true, points, totalRows: totalCount, from: safeFrom, to: safeTo };
});

// ===================================================================
// IPC: analysis-get-chart-tooltip — get row data for hover tooltip
// ===================================================================

ipcMain.handle('analysis-get-chart-tooltip', (event, tabIdx, rowIdx, timeColIdx, fileColIdx) => {
  if (!analysisStore.db) return { success: false };
  const row = analysisStore.db.prepare('SELECT * FROM tab_' + tabIdx + ' WHERE rowid = ?').get(rowIdx + 1);
  if (!row) return { success: false };
  const result = { time: '', file: '', values: {} };
  if (timeColIdx >= 0) result.time = row['col_' + timeColIdx] || '';
  if (fileColIdx >= 0) result.file = row['col_' + fileColIdx] || '';
  // Get values for all chart columns at this row
  for (const k in row) {
    if (k === 'rowid') continue;
    const ci = parseInt(k.replace('col_', ''));
    const v = parseFloat(row[k]);
    if (!isNaN(v)) result.values[ci] = v;
  }
  return { success: true, ...result };
});

// ===================================================================
// IPC: analysis-stats-meta — detect numeric columns for stats dialog
// ===================================================================

ipcMain.handle('analysis-stats-meta', (event, tabIdx, visCols) => {
  if (!analysisStore.db) return { success: false };
  const tab = analysisStore.tabs[tabIdx];
  if (!tab) return { success: false };
  const headerLabels = visCols ? visCols.map(c => tab.headerLabels[c]) : tab.headerLabels;
  const skipLabels = { '源文件': 1, 'Android时间': 1, '时间戳(s)': 1, '原始时间戳': 1, '日志级别': 1, '调用线程': 1 };
  // Single query: check all columns at once with rowid sampling
  const sampleRate = Math.max(1, Math.floor(tab.count / 1000));
  const parts = [];
  for (let ci = 0; ci < headerLabels.length; ci++) {
    if (skipLabels[headerLabels[ci]]) continue;
    parts.push('SUM(CASE WHEN CAST(col_' + ci + " AS REAL) IS NOT NULL AND col_" + ci + " != '' THEN 1 ELSE 0 END) as nc" + ci);
  }
  if (parts.length === 0) return { success: true, numCols: [], totalRows: tab.count };
  const row = analysisStore.db.prepare(
    'SELECT COUNT(*) as total, ' + parts.join(', ') + ' FROM tab_' + tabIdx + ' WHERE (rowid-1) % ' + sampleRate + ' = 0'
  ).get();
  const numCols = [];
  const total = row.total || 1;
  for (let ci = 0; ci < headerLabels.length; ci++) {
    if (skipLabels[headerLabels[ci]]) continue;
    const nc = row['nc' + ci];
    if (nc > total * 0.5) numCols.push(ci);
  }
  return { success: true, numCols, totalRows: tab.count };
});

// ===================================================================
// IPC: analysis-stats-calc — compute statistics via SQL
// ===================================================================

ipcMain.handle('analysis-stats-calc', (event, tabIdx, visCols, colIndices, fromRow, toRow) => {
  if (!analysisStore.db) return { success: false };
  const tab = analysisStore.tabs[tabIdx];
  if (!tab) return { success: false };
  const safeFrom = Math.max(0, fromRow);
  const safeTo = Math.min(tab.count - 1, toRow);
  const rangeLen = safeTo - safeFrom + 1;
  if (rangeLen <= 0) return { success: false };

  const colResults = {};
  // Use sampling for large ranges to keep queries fast
  const needSample = rangeLen > 500000;
  const sampleRate = needSample ? Math.max(1, Math.floor(rangeLen / 200000)) : 1;
  const sampleWhere = needSample ? ' AND (rowid-1-' + safeFrom + ') % ' + sampleRate + ' = 0' : '';
  const rangeWhere = 'rowid BETWEEN ' + (safeFrom + 1) + ' AND ' + (safeTo + 1);

  // Build single aggregate query for all selected columns
  const aggParts = [];
  for (const ci of colIndices) {
    const dbCol = 'col_' + ci;
    const cond = dbCol + " != '' AND CAST(" + dbCol + ' AS REAL) IS NOT NULL';
    aggParts.push(
      'COUNT(CASE WHEN ' + cond + ' THEN 1 END) as cnt' + ci,
      'MIN(CASE WHEN ' + cond + ' THEN CAST(' + dbCol + ' AS REAL) END) as mn' + ci,
      'MAX(CASE WHEN ' + cond + ' THEN CAST(' + dbCol + ' AS REAL) END) as mx' + ci,
      'SUM(CASE WHEN ' + cond + ' THEN CAST(' + dbCol + ' AS REAL) END) as sm' + ci,
      'AVG(CASE WHEN ' + cond + ' THEN CAST(' + dbCol + ' AS REAL) END) as av' + ci,
      'AVG(CASE WHEN ' + cond + ' THEN CAST(' + dbCol + ' AS REAL) * CAST(' + dbCol + ' AS REAL) END) as sq' + ci
    );
  }
  const aggRow = analysisStore.db.prepare(
    'SELECT ' + aggParts.join(', ') + ' FROM tab_' + tabIdx + ' WHERE ' + rangeWhere + sampleWhere
  ).get();

  for (const ci of colIndices) {
    const cnt = aggRow['cnt' + ci];
    const mn = aggRow['mn' + ci];
    const mx = aggRow['mx' + ci];
    const sm = aggRow['sm' + ci];
    const av = aggRow['av' + ci];
    const sq = aggRow['sq' + ci];
    if (!cnt || cnt < 1 || mn === null) { colResults[ci] = null; continue; }

    // Stddev from E[X²] - E[X]²
    const stddev = cnt >= 2 ? Math.sqrt(Math.max(0, sq - av * av)) : 0;

    // Start/end values (fast: LIMIT 1)
    const dbCol = 'col_' + ci;
    const cond = dbCol + " != '' AND CAST(" + dbCol + ' AS REAL) IS NOT NULL';
    const startRow = analysisStore.db.prepare('SELECT CAST(' + dbCol + ' AS REAL) as v FROM tab_' + tabIdx + ' WHERE ' + cond + ' AND rowid >= ' + (safeFrom + 1) + ' ORDER BY rowid LIMIT 1').get();
    const endRow = analysisStore.db.prepare('SELECT CAST(' + dbCol + ' AS REAL) as v FROM tab_' + tabIdx + ' WHERE ' + cond + ' AND rowid <= ' + (safeTo + 1) + ' ORDER BY rowid DESC LIMIT 1').get();
    const startVal = startRow ? startRow.v : mn;
    const endVal = endRow ? endRow.v : mx;

    // Percentiles via single sampled ORDER BY query
    const sortedRows = analysisStore.db.prepare(
      'SELECT CAST(' + dbCol + ' AS REAL) as v FROM tab_' + tabIdx + ' WHERE ' + cond + ' AND ' + rangeWhere + sampleWhere + ' ORDER BY v'
    ).all();
    const n = sortedRows.length;
    const p25 = n > 0 ? sortedRows[Math.min(Math.floor(n * 0.25), n - 1)].v : null;
    const p50 = n > 0 ? sortedRows[Math.min(Math.floor(n * 0.5), n - 1)].v : null;
    const p75 = n > 0 ? sortedRows[Math.min(Math.floor(n * 0.75), n - 1)].v : null;
    const p95 = n > 0 ? sortedRows[Math.min(Math.floor(n * 0.95), n - 1)].v : null;

    // Max step + trend via sampled sequential scan
    let maxStep = 0, upCount = 0, downCount = 0;
    const seqRows = analysisStore.db.prepare(
      'SELECT CAST(' + dbCol + ' AS REAL) as v FROM tab_' + tabIdx + ' WHERE ' + cond + ' AND ' + rangeWhere + sampleWhere + ' ORDER BY rowid'
    ).all();
    for (let i = 1; i < seqRows.length; i++) {
      const d = Math.abs(seqRows[i].v - seqRows[i - 1].v);
      if (d > maxStep) maxStep = d;
      if (seqRows[i].v > seqRows[i - 1].v) upCount++;
      else if (seqRows[i].v < seqRows[i - 1].v) downCount++;
    }
    const totalNum = n;
    let trend = '↔ 波动';
    if (upCount > totalNum * 0.6) trend = '↑ 上升';
    else if (downCount > totalNum * 0.6) trend = '↓ 下降';

    colResults[ci] = {
      count: cnt, min: mn, max: mx, avg: av, median: p50, stddev,
      startVal, endVal, delta: endVal - startVal,
      rate: cnt >= 2 ? (endVal - startVal) / (cnt - 1) : null,
      maxStep, p25, p75, p95, trend,
      trendUp: upCount, trendDown: downCount, totalNum
    };
  }
  return { success: true, colResults, rangeLen: rangeLen, from: safeFrom + 1, to: safeTo + 1 };
});

// ===================================================================
// IPC: analysis-export-csv — generate CSV file on main process side
// ===================================================================

ipcMain.handle('analysis-export-csv', async (event, tabIdx, visCols) => {
  try {
    if (!analysisStore.db) return { success: false, error: '无数据可导出' };
    const tab = analysisStore.tabs[tabIdx];
    if (!tab) return { success: false, error: '无数据可导出' };
    const headers = visCols ? visCols.map(c => tab.headerLabels[c]) : tab.headerLabels;
    const keyword = (tab.keyword || 'analysis').replace(/_(mtk|qcom|default)$/, '');
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: '导出CSV',
      defaultPath: keyword + '_' + tab.count + 'rows.csv',
      filters: [{ name: 'CSV文件', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    const colSelector = visCols ? visCols.map(c => 'col_' + c).join(', ') : tab.keys.map((_, i) => 'col_' + i).join(', ');
    const headerLine = '"#","' + headers.map(h => h.replace(/"/g, '""')).join('","') + '"';
    const ws = fs.createWriteStream(result.filePath, { encoding: 'utf-8' });
    ws.write('﻿' + headerLine + '\n');
    let rowNum = 0;
    for (const row of analysisStore.db.prepare('SELECT ' + colSelector + ' FROM tab_' + tabIdx + ' ORDER BY rowid').iterate()) {
      rowNum++;
      const cells = [String(rowNum)];
      if (visCols) { for (const c of visCols) { const v = row['col_' + c]; cells.push('"' + (v === undefined || v === null ? '' : String(v).replace(/"/g, '""')) + '"'); } }
      else { for (let j = 0; j < headers.length; j++) { const v = row['col_' + j]; cells.push('"' + (v === undefined || v === null ? '' : String(v).replace(/"/g, '""')) + '"'); } }
      ws.write(cells.join(',') + '\n');
    }
    ws.end();
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===================================================================
// IPC: save-analysis-report — export self-contained HTML report
// ===================================================================

ipcMain.handle('save-analysis-report', async (event) => {
  try {
    if (analysisStore.tabs.length === 0 || !analysisStore.db) {
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

    // Read all data from SQLite for embedded report
    const allData = [];
    for (let i = 0; i < analysisStore.tabs.length; i++) {
      allData.push(readAllRowsFromDB(analysisStore.db, i));
    }
    const htmlContent = parserRegistry.generateReportHTML(analysisStore.tabs, allData);
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

ipcMain.handle('analysis-get-nearby-rows', (event, tabIdx, timeValue, contextRows) => {
  if (!analysisStore.db) return { success: false };
  const tab = analysisStore.tabs[tabIdx];
  if (!tab) return { success: false };
  const timeColIdx = tab.keys.indexOf('android_time');
  if (timeColIdx < 0) return { success: false, error: 'no android_time column' };
  const ctx = contextRows != null ? contextRows : 3;
  const colName = 'col_' + timeColIdx;
  const indexRows = analysisStore.db.prepare(
    'SELECT rowid, ' + colName + ' AS tv FROM tab_' + tabIdx + ' WHERE ' + colName + ' != \'\' ORDER BY rowid'
  ).all();
  if (indexRows.length === 0) return { success: false, error: 'no rows with time' };
  const target = parseTimeSec(timeValue);
  let bestIdx = 0;
  let bestDiff = Math.abs(parseTimeSec(indexRows[0].tv) - target);
  for (let i = 1; i < indexRows.length; i++) {
    const diff = Math.abs(parseTimeSec(indexRows[i].tv) - target);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  const targetRowId = indexRows[bestIdx].rowid;
  const targetRow = targetRowId - 1;
  const from = Math.max(0, targetRow - ctx);
  const to = Math.min(tab.count - 1, targetRow + ctx);
  const colNames = tab.keys.map((_, i) => 'col_' + i).join(', ');
  const stmt = analysisStore.db.prepare(
    'SELECT ' + colNames + ' FROM tab_' + tabIdx + ' WHERE rowid BETWEEN ? AND ?'
  );
  const result = stmt.all(from + 1, to + 1);
  const rows = result.map(row => tab.keys.map((_, i) => row['col_' + i] || ''));
  return { success: true, rows, from, targetRow: targetRow, timeColIdx };
});

function parseTimeSec(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!m) { const n = Number(s); return isNaN(n) ? 0 : n; }
  let sec = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  if (m[7]) sec += parseInt(m[7].padEnd(3, '0').substring(0, 3), 10) / 1000;
  return sec;
}

ipcMain.handle('analysis-get-time-index', (event, tabIdx) => {
  if (!analysisStore.db) return { success: false };
  const tab = analysisStore.tabs[tabIdx];
  if (!tab) return { success: false };
  // Try timestamp (seconds) then ts_raw (microseconds)
  let timeColIdx = tab.keys.indexOf('timestamp');
  let isUs = false;
  if (timeColIdx < 0) {
    timeColIdx = tab.keys.indexOf('ts_raw');
    isUs = true;
  }
  if (timeColIdx < 0) return { success: false, error: 'no timestamp or ts_raw column' };
  const colName = 'col_' + timeColIdx;
  const rows = analysisStore.db.prepare(
    'SELECT rowid, ' + colName + ' AS tv FROM tab_' + tabIdx + ' WHERE ' + colName + ' != \'\' ORDER BY rowid'
  ).all();
  const index = rows.map(r => {
    const sec = isUs ? Number(r.tv) / 1000000 : Number(r.tv);
    return { row: r.rowid - 1, time: String(sec) };
  });
  return { success: true, index, timeColIdx };
});

ipcMain.handle('analysis-get-row', (event, tabIdx, rowIdx) => {
  if (!analysisStore.db) return { success: false };
  const tab = analysisStore.tabs[tabIdx];
  if (!tab) return { success: false };
  if (rowIdx < 0 || rowIdx >= tab.count) return { success: false };
  const colNames = tab.keys.map((_, i) => 'col_' + i).join(', ');
  const row = analysisStore.db.prepare(
    'SELECT ' + colNames + ' FROM tab_' + tabIdx + ' WHERE rowid = ?'
  ).get(rowIdx + 1);
  if (!row) return { success: false };
  const data = tab.keys.map((_, i) => row['col_' + i] || '');
  return { success: true, row: data };
});

ipcMain.handle('analysis-get-rows-range', (event, tabIdx, from, to) => {
  if (!analysisStore.db) return { success: false };
  const tab = analysisStore.tabs[tabIdx];
  if (!tab) return { success: false };
  const f = Math.max(0, from);
  const t = Math.min(tab.count - 1, to);
  if (f > t) return { success: true, rows: [], from: f };
  const colNames = tab.keys.map((_, i) => 'col_' + i).join(', ');
  const result = analysisStore.db.prepare(
    'SELECT ' + colNames + ' FROM tab_' + tabIdx + ' WHERE rowid BETWEEN ? AND ?'
  ).all(f + 1, t + 1);
  const rows = result.map(row => tab.keys.map((_, i) => row['col_' + i] || ''));
  return { success: true, rows, from: f };
});

function registerIpcHandlers() {}

module.exports = { registerIpcHandlers };
