// ==== DataAccess: unified IPC/embedded data layer ====
// Centralizes all data-fetching logic. Embedded mode reads from
// in-memory tabLocal/TABS; IPC mode calls window.logAnalysis.
// Every method returns a Promise for uniform async handling.
(function() {
  'use strict';

  var _embedded = typeof __EMBEDDED_TABS !== 'undefined';

  function getTabs() {
    if (_embedded) {
      return Promise.resolve(__EMBEDDED_TABS);
    }
    return window.logAnalysis.getTabs();
  }

  function getRows(tabIdx, from, count) {
    if (_embedded) {
      return Promise.resolve().then(function() {
        var loc = tabLocal[tabIdx];
        if (!loc || !loc.rows) return { success: false };
        var rows = [];
        var end = Math.min(from + count, TABS[tabIdx].count);
        for (var r = from; r < end; r++) {
          rows.push(loc.rows[r] || []);
        }
        return { success: true, rows: rows, from: from };
      });
    }
    return window.logAnalysis.getRows(tabIdx, from, count);
  }

  function getRowsRange(tabIdx, from, to) {
    if (_embedded) {
      return Promise.resolve().then(function() {
        var loc = tabLocal[tabIdx];
        if (!loc || !loc.rows) return { success: false };
        var rows = [];
        for (var r = from; r <= to; r++) {
          rows.push(loc.rows[r] || []);
        }
        return { success: true, rows: rows, from: from };
      });
    }
    if (!window.logAnalysis || !window.logAnalysis.getRowsRange) {
      return Promise.resolve(null);
    }
    return window.logAnalysis.getRowsRange(tabIdx, from, to);
  }

  function getRow(tabIdx, rowIdx) {
    if (_embedded) {
      return Promise.resolve().then(function() {
        var loc = tabLocal[tabIdx];
        if (loc && loc.rows && loc.rows[rowIdx]) {
          return { success: true, row: loc.rows[rowIdx] };
        }
        return { success: false, row: null };
      });
    }
    if (!window.logAnalysis || !window.logAnalysis.getRow) {
      return Promise.resolve(null);
    }
    return window.logAnalysis.getRow(tabIdx, rowIdx);
  }

  function searchRows(tabIdx, term) {
    if (_embedded) {
      return Promise.resolve().then(function() {
        var loc = tabLocal[tabIdx];
        if (!loc || !loc.rows) return { success: true, matches: [] };
        var matches = [];
        var rows = loc.rows;
        var t = TABS[tabIdx];
        var lookupTerm = term.toLowerCase();
        for (var i = 0; i < t.count; i++) {
          var rd = rows[i];
          if (!rd) continue;
          for (var j = 0; j < rd.length; j++) {
            var val = rd[j];
            if (val === undefined || val === null || val === '') continue;
            if (String(val).toLowerCase().indexOf(lookupTerm) >= 0) {
              matches.push(i); break;
            }
          }
        }
        return { success: true, matches: matches };
      });
    }
    return window.logAnalysis.searchRows(tabIdx, term);
  }

  function getStatsMeta(tabIdx, visCols) {
    if (_embedded) {
      return Promise.resolve().then(function() {
        var loc = tabLocal[tabIdx];
        if (!loc || !loc.rows) return { success: false };
        var rows = loc.rows;
        var t = TABS[tabIdx];
        var headerLabels = (visCols ? visCols.map(function(c) { return t.headers[c]; }) : t.headers);
        var numCols = [];
        var sampleSize = Math.min(t.count, 50);
        for (var ci = 0; ci < headerLabels.length; ci++) {
          var numCount = 0;
          for (var si = 0; si < sampleSize; si++) {
            var rd = rows[si];
            if (!rd) continue;
            var v = visCols ? rd[visCols[ci]] : rd[ci];
            if (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) numCount++;
          }
          if (numCount > sampleSize * 0.5) numCols.push(ci);
        }
        return { success: true, numCols: numCols };
      });
    }
    return window.logAnalysis.getStatsMeta(tabIdx, visCols);
  }

  function calcStats(tabIdx, visCols, cols, from, to) {
    if (_embedded) {
      return Promise.resolve().then(function() {
        var loc = tabLocal[tabIdx];
        if (!loc || !loc.rows) return { success: false };
        var rows = loc.rows;
        var t = TABS[tabIdx];
        var headers = visCols ? visCols.map(function(c) { return t.headers[c]; }) : t.headers;
        var rangeLen = to - from + 1;
        var colResults = {};

        for (var ci = 0; ci < cols.length; ci++) {
          var c = cols[ci];
          var vals = [];
          for (var r = from; r <= to; r++) {
            var rd = rows[r];
            if (!rd) continue;
            var v = visCols ? rd[visCols[c]] : rd[c];
            var n = Number(v);
            if (!isNaN(n) && v !== '' && v !== null && v !== undefined) vals.push(n);
          }
          vals.sort(function(a, b) { return a - b; });
          var count = vals.length;
          var sum = 0;
          for (var vi = 0; vi < count; vi++) sum += vals[vi];
          var avg = count > 0 ? sum / count : 0;
          var ss = 0;
          for (var si = 0; si < count; si++) ss += (vals[si] - avg) * (vals[si] - avg);
          var stddev = count > 1 ? Math.sqrt(ss / count) : 0;

          // Re-collect for sequential metrics
          var allVals = [];
          for (var r2 = from; r2 <= to; r2++) {
            var rd2 = rows[r2];
            if (!rd2) continue;
            var v2 = visCols ? rd2[visCols[c]] : rd2[c];
            var n2 = Number(v2);
            if (!isNaN(n2) && v2 !== '' && v2 !== null && v2 !== undefined) allVals.push(n2);
          }

          var delta = allVals.length >= 2 ? allVals[allVals.length - 1] - allVals[0] : 0;
          var startVal = allVals.length > 0 ? allVals[0] : null;
          var endVal = allVals.length > 0 ? allVals[allVals.length - 1] : null;
          var rate = allVals.length >= 2 ? (endVal - startVal) / (allVals.length - 1) : 0;
          var maxStep = 0;
          for (var mi = 1; mi < allVals.length; mi++) {
            var d = Math.abs(allVals[mi] - allVals[mi - 1]);
            if (d > maxStep) maxStep = d;
          }
          var median = count > 0 ? (count % 2 ? vals[Math.floor(count / 2)] : (vals[count / 2 - 1] + vals[count / 2]) / 2) : 0;
          var p25 = count > 0 ? vals[Math.min(Math.floor(count * 0.25), count - 1)] : 0;
          var p75 = count > 0 ? vals[Math.min(Math.floor(count * 0.75), count - 1)] : 0;
          var p95 = count > 0 ? vals[Math.min(Math.floor(count * 0.95), count - 1)] : 0;

          var up = 0, down = 0;
          for (var ti = 1; ti < allVals.length; ti++) {
            if (allVals[ti] > allVals[ti - 1]) up++;
            else if (allVals[ti] < allVals[ti - 1]) down++;
          }
          var trend = up > allVals.length * 0.6 ? '↑ 上升' : down > allVals.length * 0.6 ? '↓ 下降' : '↔ 波动';
          var trendUp = up, trendDown = down, totalNum = allVals.length - 1;

          colResults[c] = {
            count: count, min: vals[0] || 0, max: vals[count - 1] || 0,
            avg: avg, median: median, stddev: stddev,
            delta: delta, startVal: startVal, endVal: endVal, rate: rate,
            maxStep: maxStep, p25: p25, p75: p75, p95: p95,
            trend: trend, trendUp: trendUp, trendDown: trendDown, totalNum: totalNum
          };
        }
        return {
          success: true, from: from + 1, to: to + 1, rangeLen: rangeLen, colResults: colResults
        };
      });
    }
    return window.logAnalysis.calcStats(tabIdx, visCols, cols, from, to);
  }

  function getTimeIndex(tabIdx) {
    if (_embedded) {
      var loc = tabLocal[tabIdx];
      if (!loc || !loc._full || !loc.rows) return Promise.resolve(null);
      var keys = TABS[tabIdx].keys || [];
      // Try timestamp (seconds) then ts_raw (microseconds → convert to seconds)
      var tiIdx = keys.indexOf('timestamp');
      var isUs = false;
      if (tiIdx < 0) {
        tiIdx = keys.indexOf('ts_raw');
        isUs = true;
      }
      if (tiIdx < 0) return Promise.resolve(null);

      return new Promise(function(resolve) {
        var rows = loc.rows;
        var total = rows.length;
        var idx = [];
        var BATCH = 8000;
        var pos = 0;

        function nextBatch() {
          var start = performance.now();
          var end = Math.min(pos + BATCH, total);
          for (var r = pos; r < end; r++) {
            var row = rows[r];
            if (!row) continue;
            var tv = row[tiIdx];
            if (tv === undefined || tv === null || tv === '') continue;
            var sec = isUs ? Number(tv) / 1000000 : Number(tv);
            idx.push({ row: r, time: String(sec) });
          }
          pos = end;
          if (pos < total) {
            var elapsed = performance.now() - start;
            setTimeout(nextBatch, elapsed < 8 ? 0 : Math.max(0, Math.floor(16 - elapsed)));
          } else {
            resolve({ success: true, index: idx });
          }
        }

        nextBatch();
      });
    }
    if (!window.logAnalysis || !window.logAnalysis.getTimeIndex) {
      return Promise.resolve(null);
    }
    return window.logAnalysis.getTimeIndex(tabIdx);
  }

  function getChartData(tabIdx, visCols) {
    if (_embedded) {
      return Promise.reject(new Error('embedded mode uses direct data'));
    }
    return window.logAnalysis.getChartData(tabIdx, visCols);
  }

  function getChartSeries(tabIdx, colIdx, maxPts, from, to) {
    if (_embedded) {
      return Promise.reject(new Error('embedded mode uses direct data'));
    }
    return window.logAnalysis.getChartSeries(tabIdx, colIdx, maxPts, from, to);
  }

  function getChartTooltip(tabIdx, rowIdx) {
    if (_embedded) {
      return Promise.reject(new Error('embedded mode uses direct data'));
    }
    return window.logAnalysis.getChartTooltip(tabIdx, rowIdx, -1, -1);
  }

  function importDatabase() {
    if (_embedded) {
      return Promise.resolve({ success: false, error: '导入数据库仅在应用内可用' });
    }
    if (!window.logAnalysis || !window.logAnalysis.importDatabase) {
      return Promise.resolve({ success: false, error: '功能不可用' });
    }
    return window.logAnalysis.importDatabase();
  }

  window.App = window.App || {};
  window.App.LogParser = window.App.LogParser || {};
  window.App.LogParser.DataAccess = {
    isEmbedded: _embedded,
    getTabs: getTabs,
    getRows: getRows,
    getRowsRange: getRowsRange,
    getRow: getRow,
    searchRows: searchRows,
    getStatsMeta: getStatsMeta,
    calcStats: calcStats,
    getTimeIndex: getTimeIndex,
    getChartData: getChartData,
    getChartSeries: getChartSeries,
    getChartTooltip: getChartTooltip,
    importDatabase: importDatabase
  };
})();

// Global shorthand — available to all downstream files
var DA = window.App.LogParser.DataAccess;
