/**
 * 增量渲染增强模块
 * 对大数据量渲染进行分帧处理，避免阻塞 UI
 */

(function() {
  'use strict';

  // 检测是否可以使用增量渲染
  const INCREMENTAL_RENDER_THRESHOLD = 200; // 超过此行数启用增量渲染

  /**
   * 创建增量渲染器
   * @param {Object} options 配置
   * @returns {Object} 渲染器接口
   */
  window.App.IncrementalRenderer = {
    /**
     * 增量渲染日志行
     * @param {Object} params 参数
     * @returns {Promise} 完成后的 Promise
     */
    renderLogLines: function(params) {
      const {
        container,        // 容器元素
        lines,            // 日志行数组
        visibleStart,     // 可见起始索引
        visibleEnd,       // 可见结束索引
        lineHeight,       // 行高
        domPool,          // DOM 池
        options = {}      // 其他选项
      } = params;

      const {
        batchSize = 50,        // 每批渲染行数
        onProgress = () => {},  // 进度回调
        useTransform = true    // 是否使用 transform
      } = options;

      // 需要渲染的行索引数组
      const indices = [];
      for (let i = visibleStart; i <= visibleEnd; i++) {
        if (i < lines.length) {
          indices.push(i);
        }
      }

      return new Promise((resolve) => {
        let index = 0;
        const total = indices.length;
        const fragment = document.createDocumentFragment();
        const startTime = performance.now();

        // 渲染一批行
        function renderBatch() {
          const batchStartTime = performance.now();
          let count = 0;

          while (index < total && count < batchSize) {
            const i = indices[index];
            const lineContent = lines[i];
            const isFileHeader = lineContent.startsWith("=== 文件:");

            // 从池中获取元素
            let line;
            if (domPool) {
              line = domPool.acquire(i, isFileHeader ? "file-header" : "log-line");
            } else {
              line = document.createElement("div");
              line.className = isFileHeader ? "file-header" : "log-line";
              line.style.position = "absolute";
              line.style.width = "100%";
            }

            // 设置位置
            const pos = Math.floor(i * lineHeight);
            if (useTransform) {
              line.style.transform = `translateY(${pos}px)`;
            } else {
              line.style.top = pos + "px";
            }

            // 设置内容（由外部回调处理）
            if (options.onRenderLine) {
              options.onRenderLine(line, i, lineContent);
            } else {
              // 默认处理
              line.innerHTML = lineContent;
            }

            fragment.appendChild(line);
            index++;
            count++;

            // 如果当前帧耗时超过 8ms，暂停并继续下一帧
            if (performance.now() - batchStartTime > 8 && index < total) {
              break;
            }
          }

          // 报告进度
          onProgress(index, total);

          if (index < total) {
            // 继续下一帧
            requestAnimationFrame(renderBatch);
          } else {
            // 完成，批量添加到 DOM
            container.appendChild(fragment);

            // 打印性能日志
            const elapsed = performance.now() - startTime;
            if (elapsed > 16) {
              console.log(`[IncrementalRender] 渲染 ${total} 行耗时 ${elapsed.toFixed(1)}ms`);
            }

            resolve({ rendered: total, elapsed });
          }
        }

        requestAnimationFrame(renderBatch);
      });
    },

    /**
     * 检测是否应该使用增量渲染
     * @param {number} visibleCount 可见行数
     * @returns {boolean}
     */
    shouldUseIncremental: function(visibleCount) {
      return visibleCount > INCREMENTAL_RENDER_THRESHOLD;
    },

    /**
     * 创建带节流的渲染函数
     * @param {Function} renderFn 实际渲染函数
     * @param {number} throttleMs 节流时间
     * @returns {Function} 节流后的渲染函数
     */
    createThrottledRenderer: function(renderFn, throttleMs = 100) {
      let lastRenderTime = 0;
      let pendingRequest = null;

      return function() {
        const now = performance.now();

        // 如果距离上次渲染时间超过节流时间，直接渲染
        if (now - lastRenderTime >= throttleMs) {
          lastRenderTime = now;
          return renderFn.apply(this, arguments);
        }

        // 否则延迟渲染
        if (pendingRequest) {
          cancelAnimationFrame(pendingRequest);
        }

        return new Promise((resolve) => {
          pendingRequest = requestAnimationFrame(() => {
            lastRenderTime = performance.now();
            const result = renderFn.apply(this, arguments);
            resolve(result);
          });
        });
      };
    },

    /**
     * 带超时的渲染Promise
     * @param {Promise} renderPromise 渲染 Promise
     * @param {number} timeoutMs 超时时间
     * @returns {Promise} 带超时的 Promise
     */
    withTimeout: function(renderPromise, timeoutMs = 2000) {
      return Promise.race([
        renderPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Render timeout')), timeoutMs)
        )
      ]);
    },

    /**
     * 批量处理数据（带进度）
     * @param {Array} data 数据数组
     * @param {Function} processor 处理函数
     * @param {Object} options 配置
     * @returns {Promise}
     */
    batchProcess: function(data, processor, options = {}) {
      const batchSize = options.batchSize || 100;
      const onProgress = options.onProgress || (() => {});

      return new Promise((resolve, reject) => {
        let index = 0;
        const total = data.length;

        function processNext() {
          const startTime = performance.now();

          while (index < total) {
            processor(data[index], index);
            index++;

            // 检查是否超时
            if (performance.now() - startTime > 12) {
              break;
            }
          }

          onProgress(index, total);

          if (index < total) {
            requestAnimationFrame(processNext);
          } else {
            resolve(index);
          }
        }

        requestAnimationFrame(processNext);
      });
    },

    /**
     * 估算渲染性能
     * @param {number} lineCount 行数
     * @param {number} avgLineLength 平均行长度
     * @returns {Object} 性能估算
     */
    estimatePerformance: function(lineCount, avgLineLength = 100) {
      // 经验估算：每 100 行约需 5-10ms
      const baseTime = (lineCount / 100) * 7;
      const contentFactor = avgLineLength / 100;

      return {
        estimatedMs: Math.round(baseTime * contentFactor),
        shouldUseIncremental: lineCount > INCREMENTAL_RENDER_THRESHOLD,
        recommendedBatchSize: Math.max(20, Math.min(100, Math.floor(lineCount / 10)))
      };
    }
  };

  console.log('✓ Incremental Renderer module loaded');
})();
