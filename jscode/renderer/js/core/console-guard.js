/**
 * Console Guard — production-mode log suppression for renderer process
 *
 * Loaded as the very first script (Layer 0) to suppress verbose logging.
 * Mirrors the main process pattern in src/main/index.js.
 *
 * Default: production mode (console.log/debug suppressed, info rate-limited)
 * Enable debug: localStorage.setItem('enableDebugLog', 'true') then reload
 * Restore at runtime: window.__restoreConsole()
 */

(function() {
  var isDebug = (function() {
    var stored = localStorage.getItem('enableDebugLog');
    if (stored !== null) return stored === 'true';
    return new URLSearchParams(window.location.search).has('debug');
  })();

  if (isDebug) return;

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
