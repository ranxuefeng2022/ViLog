/**
 * FilteredChunkCache — LRU cache for filter-panel chunk-mode line loading
 *
 * Simplified variant of ChunkCache: single temp file, linear index space,
 * no multi-file header mapping. Reuses existing read-lines-range IPC.
 *
 * window.App.FilteredChunkCache
 */
(function () {
  'use strict';

  var MAX_CACHE_SIZE = 20000;
  var MAX_LOAD_RANGE = 2000;

  var _tempFilePath = null;
  var _totalLines = 0;
  var _requestGeneration = 0;

  var cache = new Map();
  var _currentScrollCenter = 0;

  var _inflightPromise = null;
  var _inflightRange = null;
  var _pendingRange = null;

  function evictIfNeeded() {
    if (cache.size <= MAX_CACHE_SIZE) return;
    var toDelete = Math.floor(cache.size * 0.25);
    var center = _currentScrollCenter;

    var far = [];
    var mid = [];
    cache.forEach(function (val, key) {
      var dist = Math.abs(key - center);
      if (dist > 5000) far.push(key);
      else if (dist > 1000) mid.push(key);
    });

    var deleted = 0;
    for (var i = 0; i < far.length && deleted < toDelete; i++, deleted++) {
      cache.delete(far[i]);
    }
    for (var i = 0; i < mid.length && deleted < toDelete; i++, deleted++) {
      cache.delete(mid[i]);
    }
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

  function buildRequestsForRange(startLine, endLine) {
    if (!_tempFilePath) return [];
    var start = startLine;
    var uncached = false;
    for (var c = start; c <= endLine; c++) {
      if (!cache.has(c)) { uncached = true; break; }
    }
    if (!uncached) return [];

    var count = Math.min(endLine - startLine + 1, MAX_LOAD_RANGE);
    return [{ filePath: _tempFilePath, startLine: startLine, count: count }];
  }

  function doLoad(range) {
    if (!range) return Promise.resolve();

    var startLine = Math.max(0, range.start);
    var endLine = Math.min(_totalLines - 1, range.end);
    if (startLine > endLine) return Promise.resolve();

    var requests = buildRequestsForRange(startLine, endLine);
    if (requests.length === 0) return Promise.resolve();

    console.log('[FilteredChunkCache] doLoad: lines', startLine, '-', endLine, '| requests:', requests.length, '| cache size:', cache.size);

    _requestGeneration++;
    var gen = _requestGeneration;
    _inflightRange = { start: startLine, end: endLine };

    var promise = window.electronAPI.readLinesRange({ requests: requests })
      .then(function (result) {
        if (gen !== _requestGeneration) return;

        _inflightPromise = null;
        _inflightRange = null;

        if (!result || !result.success || !result.results) return;

        console.log('[FilteredChunkCache] loaded:', result.results.length, 'batches, cache size:', cache.size);
        var now = Date.now();
        var loadedIndices = [];
        for (var r = 0; r < result.results.length; r++) {
          var fileResult = result.results[r];
          if (!fileResult.lines || fileResult.lines.length === 0) continue;

          var actualStart = fileResult.actualStart;
          for (var j = 0; j < fileResult.lines.length; j++) {
            var globalIdx = actualStart + j;
            if (globalIdx >= 0 && globalIdx < _totalLines) {
              cache.set(globalIdx, { content: fileResult.lines[j], accessTime: now });
              loadedIndices.push(globalIdx);
            }
          }
        }

        evictIfNeeded();

        if (typeof FilteredChunkCache.onLoadComplete === 'function') {
          FilteredChunkCache.onLoadComplete(loadedIndices);
        }

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
        console.error('[FilteredChunkCache] IPC error:', err);
      });

    _inflightPromise = promise;
    return promise;
  }

  var FilteredChunkCache = {
    init: function (totalLines) {
      console.log('[FilteredChunkCache] init: totalLines=', totalLines);
      cache.clear();
      _totalLines = totalLines || 0;
      _requestGeneration++;
      _currentScrollCenter = 0;
      _pendingRange = null;
      _inflightPromise = null;
      _inflightRange = null;
    },

    setTempPath: function (path) {
      _tempFilePath = path;
    },

    getTotalLines: function () {
      return _totalLines;
    },

    isActive: function () {
      return _tempFilePath !== null && _totalLines > 0;
    },

    setScrollCenter: function (lineIndex) {
      _currentScrollCenter = lineIndex;
    },

    onLoadComplete: null,

    get: function (lineIndex) {
      if (lineIndex < 0 || lineIndex >= _totalLines) return null;
      var entry = cache.get(lineIndex);
      if (entry) {
        entry.accessTime = Date.now();
        return entry.content;
      }
      return null;
    },

    ensureRange: function (startLine, endLine) {
      startLine = Math.max(0, startLine);
      endLine = Math.min(_totalLines - 1, endLine);
      if (startLine > endLine) {
        return Promise.resolve();
      }

      _currentScrollCenter = Math.floor((startLine + endLine) / 2);

      var allCached = true;
      for (var c = startLine; c <= endLine; c++) {
        if (!cache.has(c)) { allCached = false; break; }
      }
      if (allCached) {
        return Promise.resolve();
      }

      // Expand load range with prefetch buffer to reduce IPC frequency
      var expStart = Math.max(0, _currentScrollCenter - Math.floor(MAX_LOAD_RANGE / 2));
      var expEnd = Math.min(_totalLines - 1, expStart + MAX_LOAD_RANGE - 1);

      // Fast path: inflight already covers expanded range
      if (_inflightRange && expStart >= _inflightRange.start && expEnd <= _inflightRange.end) {
        return Promise.resolve();
      }

      if (!_inflightPromise) {
        return doLoad({ start: expStart, end: expEnd });
      }

      if (_inflightRange) {
        var inflightCenter = Math.floor((_inflightRange.start + _inflightRange.end) / 2);
        if (Math.abs(inflightCenter - _currentScrollCenter) > MAX_LOAD_RANGE) {
          _requestGeneration++;
          _inflightPromise = null;
          _inflightRange = null;
          return doLoad({ start: expStart, end: expEnd });
        }
      }

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

    ensureRangeImmediate: function (startLine, endLine) {
      startLine = Math.max(0, startLine);
      endLine = Math.min(_totalLines - 1, endLine);
      if (startLine > endLine) return Promise.resolve();

      var requests = buildRequestsForRange(startLine, endLine);
      if (requests.length === 0) return Promise.resolve();

      _requestGeneration++;

      return window.electronAPI.readLinesRange({ requests: requests })
        .then(function (result) {
          if (!result || !result.success || !result.results) return;

          var now = Date.now();
          var loadedIndices = [];
          for (var r = 0; r < result.results.length; r++) {
            var fileResult = result.results[r];
            if (!fileResult.lines || fileResult.lines.length === 0) continue;

            var actualStart = fileResult.actualStart;
            for (var j = 0; j < fileResult.lines.length; j++) {
              var globalIdx = actualStart + j;
              if (globalIdx >= 0 && globalIdx < _totalLines) {
                cache.set(globalIdx, { content: fileResult.lines[j], accessTime: now });
                loadedIndices.push(globalIdx);
              }
            }
          }

          evictIfNeeded();

          if (typeof FilteredChunkCache.onLoadComplete === 'function') {
            FilteredChunkCache.onLoadComplete(loadedIndices);
          }
        })
        .catch(function (err) {
          console.error('[FilteredChunkCache] Immediate load error:', err);
        });
    },

    invalidate: function () {
      cache.clear();
      _tempFilePath = null;
      _totalLines = 0;
      _requestGeneration++;
      _pendingRange = null;
      _inflightPromise = null;
      _inflightRange = null;
    },

    getStats: function () {
      return {
        cacheSize: cache.size,
        totalLines: _totalLines,
        tempFilePath: _tempFilePath,
      };
    },
  };

  // 监听索引进度事件，更新过滤进度浮层
  if (window.electronAPI && window.electronAPI.on) {
    window.electronAPI.on('chunk-index-progress', function (data) {
      var fp = window._updateFilterProgress;

      // filtering 阶段不需要 isActive()（缓存尚未初始化）
      if (data.phase === 'filtering') {
        if (fp) fp('流式过滤', (data.matchCount || 0) + ' 个匹配');
        return;
      }

      // merging 阶段也不需要 isActive()（正在合并 part 文件）
      if (data.phase === 'merging') {
        if (fp) fp('合并结果', data.merged + '/' + data.total + ' 批');
        return;
      }

      if (!FilteredChunkCache.isActive()) return;
      if (data.phase === 'indexing') {
        if (fp) fp('建立索引', '');
      } else if (data.phase === 'writing') {
        if (fp) fp('写入磁盘', '');
      } else if (data.phase === 'extracting') {
        if (fp) fp('解压文件', '');
      }
    });
  }

  window.App = window.App || {};
  window.App.FilteredChunkCache = FilteredChunkCache;
})();
