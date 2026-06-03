/**
 * Console Guard — production-mode log suppression for renderer process
 *
 * Loaded as the very first script (Layer 0) to suppress verbose logging.
 * Mirrors the main process pattern in src/main/index.js.
 *
 * Enable debug:
 *   1. localStorage.setItem('enableDebugLog', 'true') then reload
 *   2. set NODE_ENV=development before starting
 *   3. Runtime: window.__restoreConsole()
 */

(function() {
  var isDebug = (function() {
    // 优先级1: preload 注入的开发标志
    if (window.__isDev) return true;
    // 优先级2: localStorage 手动设置
    var stored = localStorage.getItem('enableDebugLog');
    if (stored === 'true') return true;
    // 优先级3: URL 参数
    if (new URLSearchParams(window.location.search).has('debug')) return true;
    return false;
  })();

  if (isDebug) {
    console.log('[ConsoleGuard] Debug mode ON — logging enabled');
    return;
  }

  var _orig = {
    log: console.log.bind(console),
    debug: console.debug.bind(console),
    info: console.info.bind(console)
  };

  var noop = function() {};
  var infoCount = 0;

  console.log = noop;
  console.debug = noop;
  console.info = function() {
    infoCount++;
    if (infoCount % 20 === 0) _orig.info.apply(console, arguments);
  };

  window.__restoreConsole = function() {
    console.log = _orig.log;
    console.debug = _orig.debug;
    console.info = _orig.info;
    console.log('[ConsoleGuard] Debug logging enabled');
  };
})();
