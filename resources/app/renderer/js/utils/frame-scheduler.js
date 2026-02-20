/**
 * 分帧调度器
 * 将大量任务分散到多个帧中执行，避免阻塞 UI
 */

(function() {
  'use strict';

  const FrameScheduler = {
    /**
     * 分批执行任务
     * @param {Array} items - 要处理的数据数组
     * @param {Function} processItem - 处理单个项目的回调 (item, index) => void
     * @param {Object} options 配置选项
     * @returns {Promise} 完成后的 Promise
     */
    batchProcess: function(items, processItem, options = {}) {
      const batchSize = options.batchSize || 100;      // 每批处理数量
      const frameDelay = options.frameDelay || 0;      // 额外帧延迟
      const onProgress = options.onProgress || (() => {}); // 进度回调

      return new Promise((resolve) => {
        let index = 0;
        const total = items.length;

        function processNextBatch() {
          const startTime = performance.now();
          let batchCount = 0;

          // 处理一批数据
          while (index < total && batchCount < batchSize) {
            const item = items[index];
            processItem(item, index);
            index++;
            batchCount++;
          }

          // 报告进度
          onProgress(index, total);

          // 如果还有数据，继续下一帧
          if (index < total) {
            // 检查是否超时（避免长时间占用帧）
            if (performance.now() - startTime > 16) {
              // 已占用一帧，立即继续
              requestAnimationFrame(processNextBatch);
            } else if (frameDelay > 0) {
              // 添加额外延迟
              setTimeout(() => requestAnimationFrame(processNextBatch), frameDelay);
            } else {
              requestAnimationFrame(processNextBatch);
            }
          } else {
            // 完成
            resolve(index);
          }
        }

        requestAnimationFrame(processNextBatch);
      });
    },

    /**
     * 带优先级的任务队列
     */
    PriorityQueue: (function() {
      const queues = {
        high: [],
        normal: [],
        low: []
      };

      let isProcessing = false;

      function processNext() {
        if (isProcessing) return;

        // 按优先级查找非空队列
        for (const priority of ['high', 'normal', 'low']) {
          const queue = queues[priority];
          if (queue.length > 0) {
            const task = queue.shift();
            isProcessing = true;

            requestAnimationFrame(() => {
              try {
                task.fn(...task.args);
              } finally {
                isProcessing = false;
                // 继续处理下一个任务
                processNext();
              }
            });
            return;
          }
        }
      }

      return {
        /**
         * 添加任务
         * @param {Function} fn - 任务函数
         * @param {Array} args - 参数
         * @param {string} priority - 'high' | 'normal' | 'low'
         */
        add: function(fn, args = [], priority = 'normal') {
          queues[priority].push({ fn, args });
          processNext();
        },

        /**
         * 添加立即执行的任务（最高优先级）
         */
        addImmediate: function(fn, ...args) {
          this.add(fn, args, 'high');
        },

        /**
         * 清空队列
         */
        clear: function() {
          queues.high = [];
          queues.normal = [];
          queues.low = [];
          isProcessing = false;
        },

        /**
         * 获取队列状态
         */
        getStats: function() {
          return {
            high: queues.high.length,
            normal: queues.normal.length,
            low: queues.low.length,
            processing: isProcessing
          };
        }
      };
    })(),

    /**
     * 节流函数 - 确保函数不会太频繁执行
     * @param {Function} fn - 要节流的函数
     * @param {number} delay - 最小间隔（毫秒）
     * @returns {Function} 节流后的函数
     */
    throttle: function(fn, delay) {
      let lastTime = 0;
      let timer = null;

      return function(...args) {
        const now = performance.now();
        const remaining = delay - (now - lastTime);

        if (remaining <= 0 || remaining > delay) {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          lastTime = now;
          fn.apply(this, args);
        } else if (!timer) {
          timer = setTimeout(() => {
            lastTime = performance.now();
            timer = null;
            fn.apply(this, args);
          }, remaining);
        }
      };
    },

    /**
     * 防抖函数 - 等待安静一段时间后执行
     * @param {Function} fn - 要防抖的函数
     * @param {number} delay - 等待时间（毫秒）
     * @param {boolean} immediate - 是否立即执行一次
     * @returns {Function} 防抖后的函数
     */
    debounce: function(fn, delay, immediate = false) {
      let timer = null;

      return function(...args) {
        if (timer) {
          clearTimeout(timer);
        }

        if (immediate) {
          if (!timer) {
            fn.apply(this, args);
          }
          timer = setTimeout(() => {
            timer = null;
          }, delay);
        } else {
          timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
          }, delay);
        }
      };
    },

    /**
     * 空闲时执行任务
     * 使用 requestIdleCallback（如果可用）或 setTimeout
     * @param {Function} task - 任务函数
     * @param {Object} options 配置
     * @returns {number} 任务 ID（可用于取消）
     */
    idleExecute: function(task, options = {}) {
      const timeout = options.timeout || 1000;

      if (typeof requestIdleCallback !== 'undefined') {
        return requestIdleCallback(task, { timeout });
      } else {
        // 回退到 setTimeout
        const id = setTimeout(() => {
          task({
            didTimeout: true,
            timeRemaining: () => 0
          });
        }, timeout);
        return { type: 'timeout', id };
      }
    },

    /**
     * 取消空闲任务
     * @param {number} taskId - 任务 ID
     */
    cancelIdleExecute: function(taskId) {
      if (typeof requestIdleCallback !== 'undefined') {
        cancelIdleCallback(taskId);
      } else if (taskId && taskId.type === 'timeout') {
        clearTimeout(taskId.id);
      }
    },

    /**
     * 增量渲染大量 DOM 元素
     * @param {HTMLElement} container - 容器元素
     * @param {Array} items - 数据数组
     * @param {Function} createElement - 创建元素的回调 (item, index) => HTMLElement
     * @param {Object} options 配置
     * @returns {Promise}
     */
    incrementalRender: function(container, items, createElement, options = {}) {
      const batchSize = options.batchSize || 50;
      const useFragment = options.useFragment !== false;
      const onBatch = options.onBatch || (() => {});

      return new Promise((resolve) => {
        let index = 0;
        const fragment = useFragment ? document.createDocumentFragment() : null;

        function renderNextBatch() {
          const startTime = performance.now();
          let count = 0;

          while (index < items.length && count < batchSize) {
            const el = createElement(items[index], index);
            if (fragment) {
              fragment.appendChild(el);
            } else {
              container.appendChild(el);
            }
            index++;
            count++;

            // 如果当前帧耗时过长，暂停并继续下一帧
            if (performance.now() - startTime > 12 && index < items.length) {
              break;
            }
          }

          onBatch(index, items.length);

          if (index < items.length) {
            requestAnimationFrame(renderNextBatch);
          } else {
            if (fragment) {
              container.appendChild(fragment);
            }
            resolve(index);
          }
        }

        requestAnimationFrame(renderNextBatch);
      });
    },

    /**
     * 延迟执行（最小帧数）
     * @param {number} frames - 延迟帧数
     * @returns {Promise}
     */
    waitFrames: function(frames) {
      return new Promise(resolve => {
        let count = 0;
        function next() {
          if (++count >= frames) {
            resolve();
          } else {
            requestAnimationFrame(next);
          }
        }
        requestAnimationFrame(next);
      });
    },

    /**
     * 等待下一帧
     * @returns {Promise}
     */
    nextFrame: function() {
      return new Promise(resolve => requestAnimationFrame(resolve));
    },

    /**
     * 测量帧率
     */
    FrameRate: (function() {
      let frames = 0;
      let lastTime = performance.now();
      let fps = 0;

      function measure() {
        frames++;
        const now = performance.now();

        if (now - lastTime >= 1000) {
          fps = Math.round((frames * 1000) / (now - lastTime));
          frames = 0;
          lastTime = now;
        }

        requestAnimationFrame(measure);
      }

      measure();

      return {
        get: () => fps,
        reset: () => {
          frames = 0;
          lastTime = performance.now();
        }
      };
    })()
  };

  // 导出到全局
  window.App = window.App || {};
  window.App.FrameScheduler = FrameScheduler;

  console.log('✓ Frame Scheduler module loaded');
})();
