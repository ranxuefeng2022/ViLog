'use strict';

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { buildZipIndex, extractByIndex, extractTextFromBuffer, find7z } = require(path.join(__dirname, 'utils'));

const { archivePath, entries, keywords, platform } = workerData;

// Detect source type
const isZip = archivePath.toLowerCase().endsWith('.zip');
const stat = (() => { try { return fs.statSync(archivePath); } catch (e) { return null; } })();
const isDir = stat && stat.isDirectory();

// Load config-based parsers first
const activeParsers = [];
const configKeySet = new Set();
try {
  const { loadConfigParsers } = require(path.join(__dirname, 'log-parsers', 'generic-parser'));
  const configParsers = loadConfigParsers();
  for (const mod of configParsers) {
    if (mod.keyword) {
      const key = mod.keyword + '_' + (mod.platform || 'default');
      configKeySet.add(key);
      const matchesKw = keywords.some(k => k === mod.keyword || k.startsWith(mod.keyword + '_'));
      const matchesPlatform = !platform || !mod.platform || mod.platform === platform;
      if (matchesKw && matchesPlatform) activeParsers.push(mod);
    }
  }
} catch (e) { /* generic-parser not available */ }

// Load legacy file-based parsers, skipping any covered by config
const parsersDir = path.join(__dirname, 'log-parsers', 'parsers');
if (fs.existsSync(parsersDir)) {
  for (const file of fs.readdirSync(parsersDir).filter(f => f.endsWith('.js'))) {
    try {
      const mod = require(path.join(parsersDir, file));
      if (mod.keyword) {
        const key = mod.keyword + '_' + (mod.platform || 'default');
        if (configKeySet.has(key)) continue;
        const matchesKw = keywords.some(k => k === mod.keyword || k.startsWith(mod.keyword + '_'));
        const matchesPlatform = !platform || !mod.platform || mod.platform === platform;
        if (matchesKw && matchesPlatform) activeParsers.push(mod);
      }
    } catch (e) { /* skip broken parsers */ }
  }
}

// ts_raw format: 240564883 → 240.564883 seconds (last 6 digits are microseconds)
function tsRawToSeconds(raw) {
  const n = Number(raw);
  return isNaN(n) ? NaN : n / 1e6;
}

function extractTsRaw(line) {
  const c1 = line.indexOf(',');
  if (c1 < 0) return null;
  const c2 = line.indexOf(',', c1 + 1);
  if (c2 < 0) return null;
  const c3 = line.indexOf(',', c2 + 1);
  if (c3 < 0) return null;
  return line.substring(c2 + 1, c3);
}

function parseAndroidTimeMs(str) {
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
  if (!m) return null;
  const sec = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const frac = m[7].length <= 3
    ? +m[7] * Math.pow(10, 3 - m[7].length)
    : Math.floor(+m[7] / Math.pow(10, m[7].length - 3));
  return sec + frac;
}

function formatTimeCST(ms) {
  const d = new Date(ms + 8 * 3600000);
  const pad = (n, l) => String(n).padStart(l, '0');
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2) + ' '
    + pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2)
    + '.' + pad(d.getUTCMilliseconds(), 3);
}

function lookupAndroidTime(tsRawVal, anchors) {
  if (anchors.length === 0) return '';
  const rawSec = tsRawToSeconds(tsRawVal);
  let lo = 0, hi = anchors.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (anchors[mid].sec < rawSec) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && (rawSec - anchors[lo - 1].sec) < (anchors[lo].sec - rawSec)) lo--;
  const offsetMs = (rawSec - anchors[lo].sec) * 1000;
  return formatTimeCST(anchors[lo].androidMs + offsetMs);
}

const ANDROID_RE = /android time (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)/;

const results = {};
const fileMeta = {};  // entry → androidMs | null

// ── ZIP fast path ──
let zipFd = null;
let zipEntries = null;

if (isZip) {
  const zipIndex = buildZipIndex(archivePath);
  if (!zipIndex) {
    parentPort.postMessage({ rows: results, fileMeta: {} });
    return;
  }
  zipFd = zipIndex.fd;
  zipEntries = zipIndex.entries;
}

// ── find 7z path (for 7z/RAR) ──
let sevenZipPath = null;
if (!isZip && !isDir) {
  sevenZipPath = find7z();
}

// ── Extract function per source type ──
function getFileContent(entryName) {
  if (isDir) {
    // Folder: entryName is absolute path
    try {
      const buf = fs.readFileSync(entryName);
      const { content } = extractTextFromBuffer(buf);
      return { success: true, content };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  if (isZip && zipFd && zipEntries) {
    const norm = entryName.replace(/^\/+/, '').replace(/\\/g, '/');
    const info = zipEntries.get(norm) || zipEntries.get(norm.toLowerCase());
    if (!info) return { success: false, error: 'Zip entry not found' };
    return extractByIndex(zipFd, null, info);
  }

  // 7z / RAR
  if (!sevenZipPath) return { success: false, error: '7z 未安装' };
  try {
    const escaped = entryName.replace(/^\/+/, '').replace(/\\/g, '/');
    const result = execSync('"' + sevenZipPath + '" e -so -y "' + archivePath + '" "' + escaped + '"', {
      encoding: 'buffer', windowsHide: true, maxBuffer: 500 * 1024 * 1024
    });
    const { content } = extractTextFromBuffer(result);
    return { success: true, content };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

try {
  for (const entry of entries) {
    const result = getFileContent(entry);
    if (!result.success) continue;

    const fileName = isDir ? path.basename(entry) : path.basename(entry);
    const lines = result.content.split('\n');

    const anchors = [];
    const pendingData = [];

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (!line || line.charCodeAt(0) <= 32 && line.trim() === '') continue;

      const am = line.match(ANDROID_RE);
      if (am) {
        const tsRaw = extractTsRaw(line);
        if (tsRaw !== null) {
          const sec = tsRawToSeconds(tsRaw);
          const ms = parseAndroidTimeMs(am[1]);
          if (!isNaN(sec) && ms !== null) anchors.push({ sec, androidMs: ms });
        }
      }

      for (const { keyword, platform: kwPlatform, parser } of activeParsers) {
        if (!line.includes(keyword)) continue;
        const data = parser.parse(line, fileName);
        if (data) {
          data.android_time = '';
          pendingData.push(data);
          var resultKey = keyword + '_' + (kwPlatform || 'default');
          if (!results[resultKey]) results[resultKey] = [];
          results[resultKey].push({ matched: true, keyword, data, _fileKey: entry });
        }
      }
    }

    if (anchors.length > 0) {
      anchors.sort((a, b) => a.sec - b.sec);
      for (const data of pendingData) {
        if (data.ts_raw !== undefined && data.ts_raw !== '') {
          data.android_time = lookupAndroidTime(data.ts_raw, anchors);
        }
      }
    }

    // Compute representative android_time for file ordering
    let repMs = null;
    for (const d of pendingData) {
      if (d.android_time) {
        const ms = parseAndroidTimeMs(d.android_time);
        if (ms !== null) { repMs = ms; break; }
      }
    }
    fileMeta[entry] = repMs;
  }
} finally {
  if (zipFd) fs.closeSync(zipFd);
}

parentPort.postMessage({ rows: results, fileMeta });