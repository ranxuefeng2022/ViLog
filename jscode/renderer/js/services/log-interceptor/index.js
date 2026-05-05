/**
 * 日志拦截器 — 拦截渲染进程 console 输出并保存到主进程日志文件
 */
(function() {
  'use strict';

  if (!window.electronAPI || !window.electronAPI.saveLog) {
    console.warn('electronAPI.saveLog 不可用，日志拦截器未启用');
    return;
  }

  var ENABLE_LOG_INTERCEPT = (function() {
    var stored = localStorage.getItem('enableLogIntercept');
    if (stored !== null) return stored === 'true';
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('log')) return urlParams.get('log') === 'true';
    return false;
  })();

  if (!ENABLE_LOG_INTERCEPT) {
    console.log('✓ 日志拦截器已禁用（通过 localStorage 或 URL 参数控制）');
    console.log('  启用方法：localStorage.setItem("enableLogIntercept", "true") 并刷新页面');
    return;
  }

  var LOG_LEVELS = { LOG: 'LOG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' };

  var logBuffer = [];
  var BUFFER_SIZE = 100;
  var FLUSH_INTERVAL = 500;
  var lastFlushTime = Date.now();
  var isFlushing = false;

  function flushLogBuffer() {
    if (isFlushing || logBuffer.length === 0) return;
    isFlushing = true;
    var logsToSave = logBuffer.splice(0, BUFFER_SIZE);
    var flushTask = function() {
      try {
        window.electronAPI.saveLog(LOG_LEVELS.LOG, '[批量日志]', {
          count: logsToSave.length, logs: logsToSave
        }).catch(function() {}).finally(function() {
          isFlushing = false;
          if (logBuffer.length > 0) setTimeout(flushTask, 0);
        });
      } catch (e) { isFlushing = false; }
    };
    setTimeout(flushTask, 0);
  }

  setInterval(function() {
    var now = Date.now();
    if (logBuffer.length > 0 && (now - lastFlushTime >= FLUSH_INTERVAL || logBuffer.length >= BUFFER_SIZE)) {
      lastFlushTime = now;
      flushLogBuffer();
    }
  }, FLUSH_INTERVAL);

  function addLogToBuffer(level, message, data) {
    if (level === LOG_LEVELS.LOG || level === LOG_LEVELS.DEBUG) {
      if (Math.random() > 0.1) return;
    }
    if (logBuffer.length >= BUFFER_SIZE * 2) logBuffer.shift();
    logBuffer.push({ level: level, message: message, data: data || null, timestamp: Date.now() });
    if (logBuffer.length >= BUFFER_SIZE) flushLogBuffer();
  }

  var originalLog = console.log;
  console.log = function() {
    originalLog.apply(console, arguments);
    var now = Date.now();
    if (!console.log.lastCallTime) { console.log.lastCallTime = now; console.log.callCount = 0; }
    console.log.callCount = (console.log.callCount || 0) + 1;
    if (now - console.log.lastCallTime > 1000) { console.log.lastCallTime = now; console.log.callCount = 0; }
    if (console.log.callCount < 100) addLogToBuffer(LOG_LEVELS.LOG, arguments[0], Array.prototype.slice.call(arguments, 1));
  };

  var originalInfo = console.info;
  console.info = function() { originalInfo.apply(console, arguments); addLogToBuffer(LOG_LEVELS.INFO, arguments[0], Array.prototype.slice.call(arguments, 1)); };

  var originalWarn = console.warn;
  console.warn = function() { originalWarn.apply(console, arguments); addLogToBuffer(LOG_LEVELS.WARN, arguments[0], Array.prototype.slice.call(arguments, 1)); };

  var originalError = console.error;
  console.error = function() {
    originalError.apply(console, arguments);
    try { window.electronAPI.saveLog(LOG_LEVELS.ERROR, arguments[0], Array.prototype.slice.call(arguments, 1)).catch(function() {}); } catch (e) {}
  };

  var originalDebug = console.debug;
  console.debug = function() { originalDebug.apply(console, arguments); addLogToBuffer(LOG_LEVELS.DEBUG, arguments[0], Array.prototype.slice.call(arguments, 1)); };

  console.log('✓ 日志拦截器已启动（优化版：批量+采样+节流）');

  window.App = window.App || {};
  window.App.LogInterceptor = {
    getBufferSize: function() { return logBuffer.length; },
    flushNow: flushLogBuffer,
    isEnabled: function() { return ENABLE_LOG_INTERCEPT; }
  };
})();
