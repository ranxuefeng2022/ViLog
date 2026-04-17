/**
 * 日志拦截器模块
 * 拦截 console 输出并保存到文件（批量+采样+节流）
 *
 * 从 original-script.js 第1-178行提取
 * 这是一个独立的IIFE，无外部依赖
 */

(function() {
  'use strict';

  // 检查electronAPI是否可用
  if (!window.electronAPI || !window.electronAPI.saveLog) {
    console.warn('electronAPI.saveLog 不可用，日志拦截器未启用');
    return;
  }

  // 全局开关：通过 localStorage 或 URL 参数控制
  const ENABLE_LOG_INTERCEPT = (() => {
    const stored = localStorage.getItem('enableLogIntercept');
    if (stored !== null) {
      return stored === 'true';
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('log')) {
      return urlParams.get('log') === 'true';
    }

    return false;
  })();

  if (!ENABLE_LOG_INTERCEPT) {
    console.log('日志拦截器已禁用');
    console.log('  启用方法：localStorage.setItem("enableLogIntercept", "true") 并刷新页面');
    return;
  }

  // 日志级别
  const LOG_LEVELS = {
    LOG: 'LOG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    DEBUG: 'DEBUG'
  };

  // 批量保存日志 + 节流
  const logBuffer = [];
  const BUFFER_SIZE = 100;
  const FLUSH_INTERVAL = 500;
  let lastFlushTime = Date.now();
  let isFlushing = false;

  const flushLogBuffer = () => {
    if (isFlushing || logBuffer.length === 0) return;
    isFlushing = true;
    const logsToSave = logBuffer.splice(0, BUFFER_SIZE);

    const flushTask = () => {
      try {
        window.electronAPI.saveLog(LOG_LEVELS.LOG, '[批量日志]', {
          count: logsToSave.length,
          logs: logsToSave
        }).catch(() => {}).finally(() => {
          isFlushing = false;
          if (logBuffer.length > 0) {
            setTimeout(flushTask, 0);
          }
        });
      } catch (e) {
        isFlushing = false;
      }
    };

    setTimeout(flushTask, 0);
  };

  setInterval(() => {
    const now = Date.now();
    if (logBuffer.length > 0 && (now - lastFlushTime >= FLUSH_INTERVAL || logBuffer.length >= BUFFER_SIZE)) {
      lastFlushTime = now;
      flushLogBuffer();
    }
  }, FLUSH_INTERVAL);

  const addLogToBuffer = (level, message, data) => {
    if (level === LOG_LEVELS.LOG || level === LOG_LEVELS.DEBUG) {
      if (Math.random() > 0.1) return;
    }
    if (logBuffer.length >= BUFFER_SIZE * 2) {
      logBuffer.shift();
    }
    logBuffer.push({ level, message, data: data || null, timestamp: Date.now() });
    if (logBuffer.length >= BUFFER_SIZE) {
      flushLogBuffer();
    }
  };

  // 拦截 console.log
  const originalLog = console.log;
  console.log = function(...args) {
    originalLog.apply(console, args);
    const now = Date.now();
    if (!console.log.lastCallTime) {
      console.log.lastCallTime = now;
      console.log.callCount = 0;
    }
    console.log.callCount = (console.log.callCount || 0) + 1;
    if (now - console.log.lastCallTime > 1000) {
      console.log.lastCallTime = now;
      console.log.callCount = 0;
    }
    if (console.log.callCount < 100) {
      addLogToBuffer(LOG_LEVELS.LOG, args[0], args.slice(1));
    }
  };

  const originalInfo = console.info;
  console.info = function(...args) {
    originalInfo.apply(console, args);
    addLogToBuffer(LOG_LEVELS.INFO, args[0], args.slice(1));
  };

  const originalWarn = console.warn;
  console.warn = function(...args) {
    originalWarn.apply(console, args);
    addLogToBuffer(LOG_LEVELS.WARN, args[0], args.slice(1));
  };

  const originalError = console.error;
  console.error = function(...args) {
    originalError.apply(console, args);
    try {
      window.electronAPI.saveLog(LOG_LEVELS.ERROR, args[0], args.slice(1)).catch(() => {});
    } catch (e) {}
  };

  const originalDebug = console.debug;
  console.debug = function(...args) {
    originalDebug.apply(console, args);
    addLogToBuffer(LOG_LEVELS.DEBUG, args[0], args.slice(1));
  };

  console.log('日志拦截器已启动（批量+采样+节流）');
})();
