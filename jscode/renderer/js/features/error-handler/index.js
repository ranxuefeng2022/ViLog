/**
 * 全局错误处理模块
 * 捕获全局JavaScript错误和未处理的Promise rejection
 *
 * 从 original-script.js 第193-237行提取
 * 独立模块，无外部依赖
 */

(function() {
  // 捕获全局JavaScript错误
  window.addEventListener('error', function(event) {
    console.error('全局错误捕获:', event.error || event.message, event);
    if (event.message && (
      event.message.includes('drag') ||
      event.message.includes('drop') ||
      event.message.includes('File') ||
      event.message.includes('Directory')
    )) {
      // 拖拽相关错误静默处理
    }
    event.preventDefault();
    return false;
  }, true);

  // 捕获未处理的Promise rejection
  window.addEventListener('unhandledrejection', function(event) {
    console.error('未处理的Promise rejection:', event.reason);
    if (event.reason && (
      (typeof event.reason === 'string' && (
        event.reason.includes('drag') ||
        event.reason.includes('drop') ||
        event.reason.includes('File')
      )) ||
      (event.reason.message && (
        event.reason.message.includes('drag') ||
        event.reason.message.includes('drop') ||
        event.reason.message.includes('File')
      ))
    )) {
      if (typeof showMessage === 'function') {
        const errorMsg = event.reason?.message || event.reason || '未知错误';
        showMessage(`处理拖拽时出错: ${errorMsg}. 请尝试重新拖拽文件。`);
      }
    }
    event.preventDefault();
  });
})();
