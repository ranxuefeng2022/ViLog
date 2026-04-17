/**
 * 事件总线 - 模块间松耦合通信
 *
 * 用法：
 *   App.EventBus.on('filter:updated', (data) => { ... });
 *   App.EventBus.emit('filter:updated', { lines: [...] });
 *   const unsub = App.EventBus.on('search:changed', handler);
 *   unsub(); // 取消订阅
 */

window.App = window.App || {};

window.App.EventBus = {
  _listeners: {},

  /**
   * 订阅事件
   * @param {string} event - 事件名
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  on(event, callback) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(callback);
    // 返回取消订阅函数
    return () => this.off(event, callback);
  },

  /**
   * 取消订阅
   */
  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    if (this._listeners[event].length === 0) {
      delete this._listeners[event];
    }
  },

  /**
   * 触发事件
   */
  emit(event, data) {
    if (!this._listeners[event]) return;
    const listeners = this._listeners[event].slice(); // 防止回调中修改列表
    for (const cb of listeners) {
      try {
        cb(data);
      } catch (e) {
        console.error(`[EventBus] Error on "${event}":`, e);
      }
    }
  },

  /**
   * 一次性订阅
   */
  once(event, callback) {
    const unsub = this.on(event, (data) => {
      unsub();
      callback(data);
    });
    return unsub;
  },

  /**
   * 调试：获取某事件的监听器数量
   */
  listenerCount(event) {
    return (this._listeners[event] || []).length;
  },

  /**
   * 调试：获取所有已注册事件
   */
  eventNames() {
    return Object.keys(this._listeners);
  }
};
