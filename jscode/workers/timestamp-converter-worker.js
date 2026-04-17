/**
 * WebAssembly 时间戳转换 Worker
 * 使用 cwrap/call API 进行内存操作
 */

let wasmModule = null;
let isWasmReady = false;

// 包装好的 WASM 函数（只包装数组参数的函数）
let setRefsWrapped = null;
let cleanupRefsWrapped = null;

// 引入 WASM 模块
importScripts('./timestamp-converter.js');

// 初始化 WASM 模块
async function initWasm() {
  if (isWasmReady) return true;

  try {
    console.log('[WASM Worker] 初始化 WASM 模块...');
    wasmModule = await createTimestampConverter();

    // 使用 cwrap 包装数组参数的函数
    setRefsWrapped = wasmModule.cwrap('set_reference_points', 'void', ['array', 'number']);
    cleanupRefsWrapped = wasmModule.cwrap('cleanup_reference_points', 'void', []);

    // convertLine 使用 ccall，不需要预先包装

    console.log('[WASM Worker] WASM 模块初始化完成');
    isWasmReady = true;
    return true;
  } catch (error) {
    console.error('[WASM Worker] WASM 初始化失败:', error);
    return false;
  }
}

// 设置 UTC 参考点
function setReferencePoints(referencePoints) {
  if (!wasmModule || !isWasmReady || !setRefsWrapped) {
    console.error('[WASM Worker] WASM 模块未初始化');
    return false;
  }

  try {
    const refCount = referencePoints.length;

    // 创建扁平化数组（使用 Uint32Array 避免符号问题）
    const flatArray = new Uint32Array(refCount * 4); // 每个参考点4个uint32 (2个int64 = 4个uint32)

    for (let i = 0; i < refCount; i++) {
      const base = i * 4;
      const bootTime = BigInt(referencePoints[i].bootTime);
      const utcTime = BigInt(referencePoints[i].utcTime);

      // boot_time (64位, 拆分为2个32位，小端序)
      flatArray[base] = Number(bootTime & 0xFFFFFFFFn);     // 低32位
      flatArray[base + 1] = Number((bootTime >> 32n) & 0xFFFFFFFFn); // 高32位

      // utc_timestamp (64位, 拆分为2个32位，小端序)
      flatArray[base + 2] = Number(utcTime & 0xFFFFFFFFn);     // 低32位
      flatArray[base + 3] = Number((utcTime >> 32n) & 0xFFFFFFFFn); // 高32位
    }

    // 直接传递数组给 WASM
    setRefsWrapped(flatArray, refCount);

    console.log(`[WASM Worker] 已设置 ${refCount} 个参考点`);
    return true;
  } catch (error) {
    console.error('[WASM Worker] 设置参考点失败:', error);
    return false;
  }
}

// 转换单行 - 使用栈分配缓冲区
function convertLine(line) {
  if (!wasmModule || !isWasmReady) {
    console.error('[WASM Worker] WASM 模块未初始化');
    return null;
  }

  try {
    // 在栈上分配输出缓冲区（4096字节）
    const outputSize = 4096;
    const outputPtr = wasmModule.stackAlloc(outputSize);

    // 调用转换函数（input会被自动转换为UTF8并写入）
    wasmModule.ccall(
      'convert_line_with_buffer',
      'void',
      ['string', 'number', 'number'],
      [line, outputPtr, outputSize]
    );

    // 从栈上读取结果（使用 Pointer_stringify 或者手动读取）
    // 手动读取以 null 结尾的字符串
    const heap = wasmModule.HEAP8;
    let end = outputPtr;
    while (end < outputPtr + outputSize && heap[end] !== 0) {
      end++;
    }

    // 创建字符串
    const bytes = heap.subarray(outputPtr, end);
    const result = new TextDecoder().decode(bytes);

    // 恢复栈
    wasmModule.stackRestore(wasmModule.stackSave());

    return result;
  } catch (error) {
    console.error('[WASM Worker] 转换行失败:', error);
    return null;
  }
}

// 批量转换（带进度报告）
function convertBatch(lines, startIndex = 0, batchSize = 5000) {
  return new Promise((resolve, reject) => {
    try {
      const totalLines = lines.length;
      const results = [];
      let convertedCount = 0;
      let skippedCount = 0;

      console.log(`[WASM Worker] 开始批量转换: ${totalLines} 行`);

      // 分块处理，避免阻塞
      function processChunk(chunkStart) {
        const chunkEnd = Math.min(chunkStart + batchSize, totalLines);

        for (let i = chunkStart; i < chunkEnd; i++) {
          const line = lines[i];

          // 跳过文件头
          if (!line || line.startsWith('===')) {
            results.push(line);
            skippedCount++;
            continue;
          }

          // 转换
          try {
            const result = convertLine(line);
            if (result && result !== line) {
              results.push(result);
              convertedCount++;
            } else {
              results.push(line);
              skippedCount++;
            }
          } catch (err) {
            console.error(`[WASM Worker] 转换第${i}行失败:`, err);
            results.push(line);
            skippedCount++;
          }
        }

        // 发送进度
        self.postMessage({
          type: 'progress',
          data: {
            progress: (chunkEnd / totalLines * 100).toFixed(1),
            converted: convertedCount,
            skipped: skippedCount,
            total: totalLines
          }
        });

        // 继续处理下一块
        if (chunkEnd < totalLines) {
          // 使用 setTimeout(0) 让出控制权
          setTimeout(() => processChunk(chunkEnd), 0);
        } else {
          // 完成
          console.log(`[WASM Worker] 转换完成: ${convertedCount} 行转换成功, ${skippedCount} 行跳过`);
          resolve({
            results: results,
            convertedCount: convertedCount,
            skippedCount: skippedCount
          });
        }
      }

      // 开始处理
      processChunk(0);

    } catch (error) {
      console.error('[WASM Worker] 批量转换失败:', error);
      reject(error);
    }
  });
}

// 监听主线程消息
self.addEventListener('message', async (e) => {
  const { type, data } = e.data;

  try {
    switch (type) {
      case 'init':
        const initialized = await initWasm();
        self.postMessage({
          type: 'init',
          success: initialized
        });
        break;

      case 'setReferencePoints':
        const refSetSuccess = setReferencePoints(data.referencePoints);
        self.postMessage({
          type: 'setReferencePoints',
          success: refSetSuccess
        });
        break;

      case 'convertBatch':
        const results = await convertBatch(data.lines, data.startIndex, data.batchSize);
        self.postMessage({
          type: 'convertBatch',
          success: true,
          data: results
        });
        break;

      case 'cleanup':
        // 清理参考点
        if (cleanupRefsWrapped) {
          cleanupRefsWrapped();
        }
        self.postMessage({
          type: 'cleanup',
          success: true
        });
        break;

      default:
        console.warn('[WASM Worker] 未知消息类型:', type);
        self.postMessage({
          type: 'error',
          message: `未知消息类型: ${type}`
        });
    }
  } catch (error) {
    console.error('[WASM Worker] 处理消息失败:', error);
    self.postMessage({
      type: 'error',
      message: error.message
    });
  }
});

// 导出给主线程的 API
self.wasmConverter = {
  init: initWasm,
  setReferencePoints,
  convertLine,
  convertBatch
};

console.log('[WASM Worker] Worker 已加载');
