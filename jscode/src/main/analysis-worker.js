'use strict';

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { buildZipIndex, extractByIndex } = require(path.join(__dirname, 'utils'));

const { archivePath, entries, keywords, platform } = workerData;

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

// Extract ts_raw from the first 3 comma-separated fields
function extractTsRaw(line) {
  const c1 = line.indexOf(',');
  if (c1 < 0) return null;
  const c2 = line.indexOf(',', c1 + 1);
  if (c2 < 0) return null;
  const c3 = line.indexOf(',', c2 + 1);
  if (c3 < 0) return null;
  return line.substring(c2 + 1, c3);
}

// Parse "2026-01-04 22:38:01.351442" to milliseconds since epoch (UTC)
function parseAndroidTimeMs(str) {
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
  if (!m) return null;
  const sec = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const frac = m[7].length <= 3
    ? +m[7] * Math.pow(10, 3 - m[7].length)
    : Math.floor(+m[7] / Math.pow(10, m[7].length - 3));
  return sec + frac;
}

// Format ms to CST (UTC+8): "YYYY-MM-DD HH:MM:SS.mmm"
function formatTimeCST(ms) {
  const d = new Date(ms + 8 * 3600000);
  const pad = (n, l) => String(n).padStart(l, '0');
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2) + ' '
    + pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2)
    + '.' + pad(d.getUTCMilliseconds(), 3);
}

// Binary search for nearest anchor by ts_raw seconds (sorted array)
function lookupAndroidTime(tsRawVal, anchors) {
  if (anchors.length === 0) return '';
  const rawSec = tsRawToSeconds(tsRawVal);
  let lo = 0, hi = anchors.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (anchors[mid].sec < rawSec) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first anchor >= rawSec; check lo-1 to see which is closer
  if (lo > 0 && (rawSec - anchors[lo - 1].sec) < (anchors[lo].sec - rawSec)) lo--;
  const offsetMs = (rawSec - anchors[lo].sec) * 1000;
  return formatTimeCST(anchors[lo].androidMs + offsetMs);
}

const ANDROID_RE = /android time (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)/;

const results = {};

// Build ZIP index once — parse Central Directory a single time
const zipIndex = buildZipIndex(archivePath);
if (!zipIndex) {
  parentPort.postMessage(results);
  return; // not a function, just exits the worker script
}

const { fd, entries: entryMap } = zipIndex;

try {
  for (const entry of entries) {
    const info = entryMap.get(entry.replace(/^\/+/, '').replace(/\\/g, '/'))
      || entryMap.get(entry.replace(/^\/+/, '').replace(/\\/g, '/').toLowerCase());
    if (!info) continue;

    const extractResult = extractByIndex(fd, null, info);
    if (!extractResult.success) continue;

    const fileName = path.basename(entry);
    const lines = extractResult.content.split('\n');

    // Single-pass: collect anchors AND parse data simultaneously
    const anchors = [];
    const pendingData = [];

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (!line || line.charCodeAt(0) <= 32 && line.trim() === '') continue;

      // Check for android time anchor
      const am = line.match(ANDROID_RE);
      if (am) {
        const tsRaw = extractTsRaw(line);
        if (tsRaw !== null) {
          const sec = tsRawToSeconds(tsRaw);
          const ms = parseAndroidTimeMs(am[1]);
          if (!isNaN(sec) && ms !== null) anchors.push({ sec, androidMs: ms });
        }
      }

      // Check for data lines
      for (const { keyword, platform: kwPlatform, parser } of activeParsers) {
        if (!line.includes(keyword)) continue;
        const data = parser.parse(line, fileName);
        if (data) {
          data.android_time = '';
          pendingData.push(data);
          var resultKey = keyword + '_' + (kwPlatform || 'default');
          if (!results[resultKey]) results[resultKey] = [];
          results[resultKey].push({ matched: true, keyword, data });
        }
      }
    }

    // Sort anchors and resolve any pending data
    if (anchors.length > 0) {
      anchors.sort((a, b) => a.sec - b.sec);
      for (const data of pendingData) {
        if (data.ts_raw !== undefined && data.ts_raw !== '') {
          data.android_time = lookupAndroidTime(data.ts_raw, anchors);
        }
      }
    }
  }
} finally {
  fs.closeSync(fd);
}

parentPort.postMessage(results);
