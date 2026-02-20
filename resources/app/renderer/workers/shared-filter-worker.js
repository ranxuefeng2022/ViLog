/**
 * 共享过滤 Worker (SharedWorker)
 * 所有窗口共享同一组Worker，大幅降低内存占用
 */

// 活跃连接集合
const connections = new Map(); // clientId -> { port, sessionId, lastActivity }

// 连接ID计数器
let connectionIdCounter = 0;

// 全局Worker池
const WORKER_COUNT = 8;
const workers = [];
let workersInitialized = false;

/**
 * 初始化Worker池
 * 🚀 修复：使用多路径尝试，确保Worker能正确加载
 * 🚀 重要：SharedWorker中的路径是相对于SharedWorker文件本身的
 */
function initWorkerPool() {
  if (workersInitialized) return;

  console.log(`[SharedFilter] 🚀 初始化 ${WORKER_COUNT} 个并行Worker`);

  // 🚀 SharedWorker在workers目录下，所以相对于它，parallel-filter-worker.js在同级目录
  const possiblePaths = [
    'parallel-filter-worker.js',  // 同级目录（最可能）
    './parallel-filter-worker.js',  // 显式同级
    '../parallel-filter-worker.js',  // 上级目录
    '../workers/parallel-filter-worker.js'  // 绝对相对路径
  ];

  console.log(`[SharedFilter] 📁 SharedWorker位置: renderer/workers/shared-filter-worker.js`);
  console.log(`[SharedFilter] 📁 目标Worker位置: renderer/workers/parallel-filter-worker.js`);
  console.log(`[SharedFilter] 🔍 尝试相对路径...`);

  for (let i = 0; i < WORKER_COUNT; i++) {
    let workerCreated = false;
    let lastError = null;

    // 尝试每个路径
    for (const path of possiblePaths) {
      try {
        console.log(`[SharedFilter] [${i}] 尝试: ${path}`);

        const worker = new Worker(path);

        worker.onmessage = (e) => {
          const { type, sessionId, chunkIndex, results, stats, progress } = e.data;

          // 找到对应的连接并转发消息
          for (const [clientId, conn] of connections) {
            if (conn.sessionId === sessionId) {
              try {
                conn.port.postMessage({
                  type,
                  workerIndex: i,
                  chunkIndex,
                  results,
                  stats,
                  progress
                });
              } catch (error) {
                console.error(`[SharedFilter] 发送消息到连接 ${clientId} 失败:`, error);
              }
              break;
            }
          }
        };

        worker.onerror = (error) => {
          console.error(`[SharedFilter] Worker ${i} 错误:`, error);
        };

        workers.push(worker);
        console.log(`[SharedFilter] [${i}] ✅ 成功! 使用路径: ${path}`);
        workerCreated = true;
        break; // 成功创建，跳出路径循环
      } catch (error) {
        lastError = error;
        console.log(`[SharedFilter] [${i}] ❌ 失败: ${path} - ${error.message}`);
      }
    }

    if (!workerCreated) {
      console.error(`[SharedFilter] [${i}] ❌ 所有路径都失败!`);
      console.error(`[SharedFilter] [${i}] 最后错误: ${lastError?.message || '未知错误'}`);
      console.error(`[SharedFilter] [${i}] 这通常意味着文件不存在或路径错误`);
    }
  }

  workersInitialized = true;

  if (workers.length === 0) {
    console.error(`[SharedFilter] ❌ Worker池初始化失败: 0/${WORKER_COUNT}`);
    console.error(`[SharedFilter] 🔍 请检查文件结构是否正确`);
    console.error(`[SharedFilter] 📁 需要的文件: renderer/workers/parallel-filter-worker.js`);
  } else {
    console.log(`[SharedFilter] ✅ Worker池初始化完成: ${workers.length}/${WORKER_COUNT}`);
  }
}

/**
 * 处理新连接
 */
self.onconnect = function(e) {
  const port = e.ports[0];
  const clientId = ++connectionIdCounter;

  console.log(`[SharedFilter] 新连接建立: ${clientId}`);

  // 创建连接对象
  const connection = {
    port,
    sessionId: null,
    lastActivity: Date.now(),
    isActive: true
  };

  connections.set(clientId, connection);

  // 初始化Worker池（只初始化一次）
  initWorkerPool();

  // 监听消息
  port.onmessage = function(e) {
    const { type, data, sessionId } = e.data;

    // 更新活动时间
    connection.lastActivity = Date.now();

    switch (type) {
      case 'process':
        // 保存会话ID
        connection.sessionId = data.sessionId;

        // 分发任务到Worker池
        dispatchToWorkers(data, sessionId);
        break;

      case 'cancel':
        cancelSession(sessionId);
        break;

      case 'ping':
        // 心跳检测，更新活动时间
        connection.lastActivity = Date.now();
        port.postMessage({ type: 'pong' });
        break;

      case 'close':
        // 窗口关闭，清理资源
        cleanupConnection(clientId);
        break;

      default:
        console.warn(`[SharedFilter] 未知消息类型: ${type}`);
    }
  };

  // 监听连接关闭
  port.onclose = function() {
    console.log(`[SharedFilter] 连接关闭: ${clientId}`);
    cleanupConnection(clientId);
  };

  // 发送就绪消息
  port.postMessage({
    type: 'connected',
    clientId,
    workerCount: workers.length
  });

  // 启动心跳检测（每30秒检查一次）
  startHeartbeat(clientId);
};

/**
 * 分发任务到Worker池
 */
function dispatchToWorkers(data, sessionId) {
  const { lines, keywords, sessionId: dataSessionId, chunkIndex: totalChunks, startIndex } = data;

  console.log(`[SharedFilter] 分发任务到 ${workers.length} 个Worker (会话 ${sessionId})`);

  const chunkSize = Math.ceil(lines.length / workers.length);

  for (let i = 0; i < workers.length; i++) {
    const workerStartIndex = i * chunkSize;
    const workerEndIndex = Math.min(workerStartIndex + chunkSize, lines.length);
    const workerLines = lines.slice(workerStartIndex, workerEndIndex);

    workers[i].postMessage({
      type: 'process',
      data: {
        lines: workerLines,
        keywords,
        sessionId,
        chunkIndex: i,
        totalChunks: workers.length,
        startIndex: workerStartIndex
      }
    });
  }
}

/**
 * 取消会话
 */
function cancelSession(sessionId) {
  console.log(`[SharedFilter] 取消会话: ${sessionId}`);

  for (const worker of workers) {
    worker.postMessage({ type: 'cancel' });
  }
}

/**
 * 清理连接资源
 */
function cleanupConnection(clientId) {
  const connection = connections.get(clientId);

  if (!connection) {
    console.warn(`[SharedFilter] 连接 ${clientId} 不存在`);
    return;
  }

  console.log(`[SharedFilter] 清理连接 ${clientId} 的资源`);

  try {
    // 关闭端口
    if (connection.port) {
      connection.port.close();
    }
  } catch (error) {
    console.error(`[SharedFilter] 关闭端口失败:`, error);
  }

  // 删除连接
  connections.delete(clientId);

  console.log(`[SharedFilter] 连接 ${clientId} 已清理，剩余连接: ${connections.size}`);

  // 如果没有活跃连接，可以选择清理Worker池（可选）
  // if (connections.size === 0) {
  //   console.log('[SharedFilter] 没有活跃连接，清理Worker池');
  //   terminateWorkerPool();
  // }
}

/**
 * 终止Worker池
 */
function terminateWorkerPool() {
  console.log(`[SharedFilter] 终止 ${workers.length} 个Worker`);

  for (const worker of workers) {
    worker.terminate();
  }

  workers.length = 0;
  workersInitialized = false;
}

/**
 * 心跳检测
 */
function startHeartbeat(clientId) {
  const interval = setInterval(() => {
    const connection = connections.get(clientId);

    if (!connection) {
      clearInterval(interval);
      return;
    }

    // 检查是否超时（60秒无活动）
    const timeout = 60000;
    if (Date.now() - connection.lastActivity > timeout) {
      console.warn(`[SharedFilter] 连接 ${clientId} 超时，清理资源`);
      cleanupConnection(clientId);
      clearInterval(interval);
    }
  }, 30000); // 每30秒检查一次

  // 保存定时器ID（用于清理）
  if (!connection.heartbeatIntervals) {
    connection.heartbeatIntervals = [];
  }
  connection.heartbeatIntervals.push(interval);
}

/**
 * 清理所有资源（用于页面卸载时）
 */
self.onunload = function() {
  console.log('[SharedFilter] SharedWorker卸载，清理所有资源');

  // 清理所有连接
  for (const [clientId, connection] of connections) {
    try {
      if (connection.port) {
        connection.port.close();
      }
    } catch (error) {
      console.error(`[SharedFilter] 清理连接 ${clientId} 失败:`, error);
    }
  }

  connections.clear();

  // 终止Worker池
  terminateWorkerPool();
};
