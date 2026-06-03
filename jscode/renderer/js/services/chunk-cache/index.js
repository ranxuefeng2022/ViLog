/**
 * ChunkCache — LRU cache for chunk-mode line loading
 *
 * Features:
 *   - Per-file index mapping with virtual file headers
 *   - Smarter LRU: keep lines near scroll position, evict distant ones
 *   - Adaptive prefetch: buffer size adjusts based on avg line length
 *   - Debounce + throttle: prevent excessive IPC during fast scrolling
 *
 * window.App.ChunkCache
 */
(function () {
  'use strict';

  // --- Config ---
  var MAX_CACHE_SIZE = 20000;
  var MAX_LOAD_RANGE = 2000;    // 单次最大加载行数 + 预取窗口大小

  // --- State ---
  var cache = new Map();           // globalLineIndex → { content }
  var _totalLines = 0;
  var _fileHeaders = [];           // [{ fileName, filePath, lineCount, startIndex }]
  var _headerByPath = {};          // filePath → header (O(1) lookup)
  var _requestGeneration = 0;

  // Debounce/throttle state
  var _debounceTimer = null;
  var _throttleActive = false;
  var _lastLoadTime = 0;
  var _pendingRange = null;        // { start, end } — the debounced pending range
  var _inflightPromise = null;     // current in-flight IPC
  var _inflightRange = null;       // { start, end } — range of current in-flight IPC

  // Scroll position tracking for smart LRU
  var _currentScrollCenter = 0;

  /**
   * Binary search _fileHeaders to find which file a global line index belongs to.
   * Returns { filePath, localLine, headerIndex, isHeader } or null.
   */
  function getFileForLine(globalIndex) {
    if (!_fileHeaders.length) return null;
    var lo = 0, hi = _fileHeaders.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var h = _fileHeaders[mid];
      var headerEnd = h.startIndex + h.lineCount + 1;
      if (globalIndex < h.startIndex) {
        hi = mid - 1;
      } else if (globalIndex >= headerEnd) {
        lo = mid + 1;
      } else {
        return {
          filePath: h.filePath,
          localLine: globalIndex - h.startIndex - 1,
          headerIndex: mid,
          isHeader: globalIndex === h.startIndex,
        };
      }
    }
    return null;
  }

  /**
   * Build per-file read requests for a range of global line indices.
   */
  function buildRequestsForRange(startLine, endLine) {
    var requests = [];
    var i = startLine;

    while (i <= endLine) {
      if (cache.has(i)) { i++; continue; }

      var info = getFileForLine(i);
      if (!info) { i++; continue; }

      if (info.isHeader) {
        var h = _fileHeaders[info.headerIndex];
        cache.set(i, {
          content: '=== 文件: ' + h.fileName + ' (' + h.lineCount.toLocaleString() + ' 行) ===',
        });
        i++;
        continue;
      }

      var filePath = info.filePath;
      var localStart = info.localLine;
      var count = 0;
      var maxEnd = Math.min(endLine, _fileHeaders[info.headerIndex].startIndex + _fileHeaders[info.headerIndex].lineCount);

      while (i <= maxEnd && count < 2000) {
        count++;
        i++;
      }

      if (count > 0) {
        requests.push({ filePath: filePath, startLine: localStart, count: count });
      }
    }
    return requests;
  }

  /**
   * Eviction: delete entries farthest from scroll center.
   * O(n) scan — no sorting, no object allocation.
   */
  function evictIfNeeded() {
    if (cache.size <= MAX_CACHE_SIZE) return;
    var toDelete = Math.floor(cache.size * 0.25);
    var center = _currentScrollCenter;

    // Collect keys grouped by distance buckets for O(n) eviction
    var far = [];   // distance > 5000
    var mid = [];   // distance > 1000
    var near = [];  // the rest
    cache.forEach(function (val, key) {
      var dist = Math.abs(key - center);
      if (dist > 5000) far.push(key);
      else if (dist > 1000) mid.push(key);
    });

    var deleted = 0;
    // Delete far entries first
    for (var i = 0; i < far.length && deleted < toDelete; i++, deleted++) {
      cache.delete(far[i]);
    }
    // Then mid entries
    for (var i = 0; i < mid.length && deleted < toDelete; i++, deleted++) {
      cache.delete(mid[i]);
    }
    // If still need more, delete oldest by insertion order
    if (deleted < toDelete) {
      var keys = cache.keys();
      while (deleted < toDelete) {
        var k = keys.next();
        if (k.done) break;
        cache.delete(k.value);
        deleted++;
      }
    }
  }

  /**
   * Compute adaptive prefetch buffer size based on avg line length.
   * Short lines → more lines prefetched; long lines → fewer lines.
   */
  function getAdaptiveBuffer() {
    // Default buffer
    var buffer = 500;
    // If we have cached lines, compute avg line length
    var sampleCount = 0;
    var totalLen = 0;
    cache.forEach(function (val) {
      if (sampleCount < 50) {
        totalLen += (val.content || '').length;
        sampleCount++;
      }
    });
    if (sampleCount > 0) {
      var avgLen = totalLen / sampleCount;
      // Target ~256KB of prefetch data
      // 256KB / avgLen = number of lines
      buffer = Math.max(200, Math.min(3000, Math.floor(262144 / Math.max(avgLen, 10))));
    }
    return buffer;
  }

  /**
   * Actually execute the range load.
   */
  function doLoad(range) {
    if (!range) return Promise.resolve();

    var startLine = Math.max(0, range.start);
    var endLine = Math.min(_totalLines - 1, range.end);
    if (startLine > endLine) return Promise.resolve();

    var requests = buildRequestsForRange(startLine, endLine);
    if (requests.length === 0) return Promise.resolve();

    console.log('[ChunkCache] doLoad: lines', startLine, '-', endLine, '| requests:', requests.length, '| cache size:', cache.size);

    _requestGeneration++;
    var gen = _requestGeneration;

    _inflightRange = { start: startLine, end: endLine };

    var promise = window.electronAPI.readLinesRange({ requests: requests })
      .then(function (result) {
        // Stale result — don't touch inflight tracking (belongs to newer request)
        if (gen !== _requestGeneration) return;

        _inflightPromise = null;
        _inflightRange = null;

        if (!result || !result.success || !result.results) return;

        var loadedIndices = [];
        console.log('[ChunkCache] loaded:', result.results.length, 'file batches, cache size:', cache.size);
        for (var r = 0; r < result.results.length; r++) {
          var fileResult = result.results[r];
          if (!fileResult.lines || fileResult.lines.length === 0) continue;

          var header = _headerByPath[fileResult.filePath];
          if (!header) continue;

          for (var j = 0; j < fileResult.lines.length; j++) {
            var globalIdx = header.startIndex + 1 + fileResult.actualStart + j;
            if (globalIdx >= 0 && globalIdx < _totalLines) {
              cache.set(globalIdx, { content: fileResult.lines[j] });
              loadedIndices.push(globalIdx);
            }
          }
        }

        evictIfNeeded();

        // Notify listener with loaded line indices for targeted DOM update
        if (typeof ChunkCache.onLoadComplete === 'function') {
          ChunkCache.onLoadComplete(loadedIndices);
        }

        // If there's a pending range that came in while we were loading, defer to
        // next animation frame so multiple pending updates coalesce into one load
        if (_pendingRange) {
          var next = _pendingRange;
          _pendingRange = null;
          requestAnimationFrame(function() {
            doLoad(next);
          });
        }
      })
      .catch(function (err) {
        if (gen === _requestGeneration) {
          _inflightPromise = null;
          _inflightRange = null;
        }
        console.error('[ChunkCache] IPC error:', err);
      });

    _inflightPromise = promise;
    return promise;
  }

  var ChunkCache = {
    init: function (fileHeadersParam, totalLines) {
      console.log('[ChunkCache] init: files=', (fileHeadersParam || []).length, ', totalLines=', totalLines);
      cache.clear();
      _fileHeaders = fileHeadersParam || [];
      _headerByPath = {};
      for (var hi = 0; hi < _fileHeaders.length; hi++) {
        _headerByPath[_fileHeaders[hi].filePath] = _fileHeaders[hi];
      }
      _totalLines = totalLines || 0;
      _requestGeneration++;
      _currentScrollCenter = 0;
      _pendingRange = null;
      _inflightPromise = null;
      _inflightRange = null;
      if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
      }
    },

    getTotalLines: function () {
      return _totalLines;
    },

    getFileHeaders: function () {
      return _fileHeaders;
    },

    /**
     * Set current scroll center for smart LRU eviction.
     */
    setScrollCenter: function (lineIndex) {
      _currentScrollCenter = lineIndex;
    },

    // Callback: set to a function that refreshes visible DOM after async loads
    onLoadComplete: null,

    get: function (lineIndex) {
      if (lineIndex < 0 || lineIndex >= _totalLines) return null;
      var entry = cache.get(lineIndex);
      if (entry) {
        return entry.content;
      }
      return null;
    },

    /**
     * Range loading strategy:
     *  - No in-flight: fire immediately
     *  - In-flight covers our range: nothing to do
     *  - In-flight is FAR (big jump like scrollbar drag): cancel stale, fire new
     *  - In-flight is CLOSE (gradual scroll like mouse wheel): coalesce into pending
     */
    ensureRange: function (startLine, endLine) {
      startLine = Math.max(0, startLine);
      endLine = Math.min(_totalLines - 1, endLine);
      if (startLine > endLine) return Promise.resolve();

      _currentScrollCenter = Math.floor((startLine + endLine) / 2);

      // Check if everything is already cached
      var allCached = true;
      for (var c = startLine; c <= endLine; c++) {
        if (!cache.has(c)) { allCached = false; break; }
      }
      if (allCached) return Promise.resolve();

      // Expand load range with prefetch buffer to reduce IPC frequency
      var expStart = Math.max(0, _currentScrollCenter - Math.floor(MAX_LOAD_RANGE / 2));
      var expEnd = Math.min(_totalLines - 1, expStart + MAX_LOAD_RANGE - 1);

      // Fast path: inflight already covers expanded range
      if (_inflightRange && expStart >= _inflightRange.start && expEnd <= _inflightRange.end) {
        return Promise.resolve();
      }

      // No in-flight request — fire immediately
      if (!_inflightPromise) {
        _lastLoadTime = Date.now();
        return doLoad({ start: expStart, end: expEnd });
      }

      // In-flight request exists — check overlap
      if (_inflightRange) {
        var inflightCenter = Math.floor((_inflightRange.start + _inflightRange.end) / 2);
        if (Math.abs(inflightCenter - _currentScrollCenter) > MAX_LOAD_RANGE) {
          _requestGeneration++;
          _inflightPromise = null;
          _inflightRange = null;
          _lastLoadTime = Date.now();
          return doLoad({ start: expStart, end: expEnd });
        }
      }

      // Gradual scroll — coalesce into pending range
      if (_pendingRange) {
        _pendingRange.start = Math.min(_pendingRange.start, expStart);
        _pendingRange.end = Math.max(_pendingRange.end, expEnd);
      } else {
        _pendingRange = { start: expStart, end: expEnd };
      }

      if (_pendingRange.end - _pendingRange.start + 1 > MAX_LOAD_RANGE) {
        var pcenter = _currentScrollCenter;
        _pendingRange.start = Math.max(0, pcenter - Math.floor(MAX_LOAD_RANGE / 2));
        _pendingRange.end = Math.min(_totalLines - 1, _pendingRange.start + MAX_LOAD_RANGE - 1);
      }

      return Promise.resolve();
    },

    /**
     * Immediate load (no debounce) — used for first screen.
     */
    ensureRangeImmediate: function (startLine, endLine) {
      startLine = Math.max(0, startLine);
      endLine = Math.min(_totalLines - 1, endLine);
      if (startLine > endLine) return Promise.resolve();

      var requests = buildRequestsForRange(startLine, endLine);
      if (requests.length === 0) return Promise.resolve();

      var gen = _requestGeneration;
      _requestGeneration++;

      return window.electronAPI.readLinesRange({ requests: requests })
        .then(function (result) {
          if (gen < _requestGeneration - 1) return;
          if (!result || !result.success || !result.results) return;

          for (var r = 0; r < result.results.length; r++) {
            var fileResult = result.results[r];
            if (!fileResult.lines || fileResult.lines.length === 0) continue;

            var header = _headerByPath[fileResult.filePath];
            if (!header) continue;

            var loadedIndices = [];
            for (var j = 0; j < fileResult.lines.length; j++) {
              var globalIdx = header.startIndex + 1 + fileResult.actualStart + j;
              if (globalIdx >= 0 && globalIdx < _totalLines) {
                cache.set(globalIdx, { content: fileResult.lines[j] });
                loadedIndices.push(globalIdx);
              }
            }
          }

          evictIfNeeded();

          if (typeof ChunkCache.onLoadComplete === 'function') {
            ChunkCache.onLoadComplete(loadedIndices);
          }
        })
        .catch(function (err) {
          console.error('[ChunkCache] Immediate load error:', err);
        });
    },

    prefetch: function (startLine, endLine) {
      ChunkCache.ensureRange(startLine, endLine);
    },

    invalidate: function () {
      cache.clear();
      _fileHeaders = [];
      _totalLines = 0;
      _requestGeneration++;
      _pendingRange = null;
      _inflightPromise = null;
      _inflightRange = null;
      if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
      }
    },

    getStats: function () {
      return {
        cacheSize: cache.size,
        totalLines: _totalLines,
        fileCount: _fileHeaders.length,
      };
    },

    // --- Progress bar ---
    _progressActive: false,

    showProgress: function (percent, label) {
      if (!ChunkCache._progressActive) return;
      var fill = document.getElementById('headerProgressFill');
      if (!fill) return;
      fill.classList.remove('complete');
      var w = Math.min(100, Math.max(0, percent));
      fill.style.width = w + '%';
      fill.style.left = (50 - w / 2) + '%';
      if (!fill.style.background || fill.style.background === '') {
        var hue = Math.floor(Math.random() * 360);
        fill.style.background = 'hsl(' + hue + ', 72%, 55%)';
      }
    },

    beginProgress: function () {
      ChunkCache._progressActive = true;
    },

    hideProgress: function () {
      ChunkCache._progressActive = false;
      var fill = document.getElementById('headerProgressFill');
      if (fill) {
        fill.classList.add('complete');
        fill.style.width = '100%';
        fill.style.left = '0%';
      }
      setTimeout(function() {
        if (fill) fill.style.background = '';
      }, 800);
    },
  };

  window.App = window.App || {};
  window.App.ChunkCache = ChunkCache;

  // Listen for chunk index progress events
  if (window.electronAPI && window.electronAPI.on) {
    window.electronAPI.on('chunk-index-progress', function (data) {
      if (data.phase === 'converting') {
        ChunkCache._progressActive = true;
      }
      var phaseLabel = data.phase === 'extracting' ? '解压中'
        : data.phase === 'writing' ? '写入中'
        : data.phase === 'converting' ? '时间转换中'
        : '索引中';
      var label = phaseLabel + ' ' + (data.currentFile || '');
      ChunkCache.showProgress(data.percent || 0, label);
      if (data.phase === 'converting' && data.percent >= 100) {
        ChunkCache.hideProgress();
      }
    });

    window.electronAPI.on('chunk-converted', function (data) {
      if (!data || !data.tempPath) return;
      var header = _headerByPath[data.tempPath];
      if (!header) return;
      var startIdx = header.startIndex + 1;
      var endIdx = header.startIndex + header.lineCount;
      var cleared = 0;
      for (var idx = startIdx; idx <= endIdx; idx++) {
        if (cache.delete(idx)) cleared++;
      }
      if (cleared > 0) {
        console.log('[ChunkCache] kernel 转换完成，清除缓存:', data.fileName, cleared, '行');
        var vs = (typeof visibleStart !== 'undefined') ? visibleStart : 0;
        var ve = (typeof visibleEnd !== 'undefined') ? visibleEnd : Math.min(100, _totalLines - 1);
        ChunkCache.ensureRangeImmediate(vs, ve);
      }
    });
  }
})();
