/**
 * 工具函数模块
 * 包含所有辅助函数
 */

window.App = window.App || {};
window.App.Utils = {
  /**
   * 限制数值范围
   */
  clampValue(v, min, max) {
    const n = Number(v);
    if (isNaN(n)) return min;
    return Math.min(Math.max(n, min), max);
  },

  /**
   * 从localStorage读取数字
   */
  readStorageNumber(key, defaultValue = 0) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined || raw === "") return defaultValue;
      const num = Number(raw);
      return isNaN(num) ? defaultValue : num;
    } catch (e) {
      console.warn("读取localStorage失败:", key, e);
      return defaultValue;
    }
  },

  /**
   * 从localStorage读取对象
   */
  readStorageObject(key, defaultValue = {}) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultValue;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("读取localStorage失败:", key, e);
      return defaultValue;
    }
  },

  /**
   * 写入localStorage
   */
  writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn("写入localStorage失败:", key, e);
      return false;
    }
  },

  /**
   * HTML转义
   */
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * HTML反转义
   */
  unescapeHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent;
  },

  /**
   * 正则表达式转义
   */
  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  /**
   * 显示消息提示
   */
  showMessage(msg, duration = 3000) {
    const toast = document.createElement("div");
    toast.className = "toast-message";
    toast.textContent = msg;
    toast.style.cssText = `
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      z-index: 100000;
      animation: fadeInOut 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  },

  /**
   * 显示进度条
   */
  showProgressBar(percent) {
    const bar = document.getElementById("progressBar");
    const fill = document.getElementById("progressFill");
    if (bar && fill) {
      bar.style.display = "block";
      fill.style.width = percent + "%";
    }
  },

  /**
   * 隐藏进度条
   */
  hideProgressBar() {
    const bar = document.getElementById("progressBar");
    if (bar) bar.style.display = "none";
  },

  /**
   * 显示快捷键提示
   */
  showShortcutHint() {
    const hint = document.getElementById("shortcutHint");
    if (hint) {
      hint.classList.add("visible");
      setTimeout(() => hint.classList.remove("visible"), 1500);
    }
  },

  /**
   * 获取过滤高亮类名
   */
  getFilterHighlightClass(keywordIndex) {
    const classes = window.App.Constants.filterHighlightClasses;
    return classes[keywordIndex % classes.length];
  },

  /**
   * 获取二级过滤高亮类名
   */
  getSecondaryFilterHighlightClass(keywordIndex) {
    const classes = window.App.Constants.secondaryFilterHighlightClasses;
    return classes[keywordIndex % classes.length];
  }
};

console.log('✓ Helpers module loaded');
