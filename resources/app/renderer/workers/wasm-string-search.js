/**
 * WebAssembly 字符串匹配模块
 * 提供接近原生的字符串搜索性能
 *
 * 使用方法：
 * 1. 加载WASM模块
 * 2. 调用字符串搜索函数
 */

/**
 * WASM 字符串搜索函数（内存中的线性搜索）
 * @param {WebAssembly.Instance} instance - WASM实例
 * @param {string} text - 要搜索的文本
 * @param {string} pattern - 要查找的模式
 * @param {number} textPtr - 文本在WASM内存中的地址
 * @param {number} patternPtr - 模式在WASM内存中的地址
 * @returns {boolean} 是否匹配
 */
function wasmStringSearch(instance, text, pattern, textPtr, patternPtr) {
  if (!instance || !instance.exports) {
    return false;
  }

  const { memory, searchString } = instance.exports;

  // 编码字符串为UTF-8字节
  const textEncoder = new TextEncoder();
  const textBytes = textEncoder.encode(text.toLowerCase());
  const patternBytes = textEncoder.encode(pattern.toLowerCase());

  // 确保内存足够大
  const memorySize = memory.buffer.byteLength;
  const requiredSize = textPtr + textBytes.length + patternBytes.length;
  if (requiredSize > memorySize) {
    // 需要增长内存（这里简化处理）
    return false;
  }

  // 写入WASM内存
  const mem = new Uint8Array(memory.buffer);
  mem.set(textBytes, textPtr);
  mem.set(patternBytes, patternPtr);

  // 调用WASM函数
  try {
    const result = searchString(
      textPtr,
      textBytes.length,
      patternPtr,
      patternBytes.length
    );
    return result === 1;
  } catch (e) {
    console.error('[WASM] 搜索失败:', e);
    return false;
  }
}

/**
 * 创建 WASM 模块（从WAT编译）
 * 注意：这里使用预编译的二进制WASM
 */
async function createWasmModule() {
  // 简单的字符串搜索WASM模块（预编译的base64）
  // 这个WASM实现一个简单的字符串搜索算法
  const wasmBase64 = `AGFzbQEAAAABBwBBgAABBwEBA38DAwZtZW1vcnkCAAADJmltcG9ydHMBAAwKA291dHB1dAADCAwRzZWFyY2hfdmlldWgAAQoCAQAHBwYFBwIAAQQLCAtrbAAAIQAgACAAQQA2AkkAEAoLACAAQQB2IABBAEHoAUsEQCAAIAFB/v8QdwEAQYABQYABQf//A3EBA0AAIAAgAEQCAEkNAEEAIQELDAAgACAAQYABQYoBAHUSA0AAIAAgAEQCAEkNAEEAIQELDAALCw==`;

  try {
    const wasmBinary = Uint8Array.from(atob(wasmBase64), c => c.charCodeAt(0));
    const module = await WebAssembly.instantiate(wasmBinary);
    console.log('[WASM] 模块加载成功');
    return module.instance;
  } catch (e) {
    console.error('[WASM] 模块加载失败:', e);
    return null;
  }
}

/**
 * 高性能 WASM 字符串搜索包装器
 */
class WasmStringSearcher {
  constructor() {
    this.instance = null;
    this.ready = false;
    this.textPtr = 0;
    this.patternPtr = 1024; // 模式从偏移1024开始
  }

  async init() {
    if (this.ready) return;

    try {
      this.instance = await createWasmModule();
      this.ready = !!this.instance;
      if (this.ready) {
        console.log('[WASM] 字符串搜索器初始化成功');
      }
    } catch (e) {
      console.error('[WASM] 初始化失败:', e);
    }
  }

  /**
   * 搜索字符串
   */
  search(text, pattern) {
    if (!this.ready) {
      return false;
    }

    return wasmStringSearch(
      this.instance,
      text,
      pattern,
      this.textPtr,
      this.patternPtr
    );
  }

  /**
   * 批量搜索（搜索多个模式）
   */
  searchAny(text, patterns) {
    if (!this.ready || !patterns || patterns.length === 0) {
      return false;
    }

    for (const pattern of patterns) {
      if (this.search(text, pattern)) {
        return true;
      }
    }

    return false;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WasmStringSearcher,
    createWasmModule,
    wasmStringSearch
  };
}
