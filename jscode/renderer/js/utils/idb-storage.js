/**
 * 关键词持久化存储模块
 * 数据源：SQLite 数据库（通过 IPC 读写）
 * 支持细粒度操作：按需 upsert / delete，避免全量读写
 */

(function() {
  'use strict';

  var ready = false;

  function init() {
    ready = !!(window.electronAPI && window.electronAPI.keywordLoadAll);
    console.log('[KeywordStorage] 初始化完成, SQLite IPC 可用:', ready);
    return Promise.resolve();
  }

  /**
   * 加载全部数据（关键词 + 预设 + 共现）
   * @returns {Promise<{keywords: Array, presets: Array, cooccurrence: Object}>}
   */
  function loadAll() {
    if (ready && window.electronAPI && window.electronAPI.keywordLoadAll) {
      return window.electronAPI.keywordLoadAll().then(function(result) {
        if (result.success && result.data) {
          console.log('[KeywordStorage] 从 SQLite 加载关键词:', result.data.keywords.length);
          return result.data;
        }
        // Bug 2 fix: DB 错误时返回 null，让调用方决定是否保留内存数据
        console.warn('[KeywordStorage] 加载失败:', result.error || '无有效数据');
        return null;
      }).catch(function(e) {
        console.error('[KeywordStorage] 加载异常:', e);
        return null;
      });
    }
    console.warn('[KeywordStorage] IPC 不可用');
    return Promise.resolve(null);
  }

  /**
   * 批量写入关键词（只传变更的行）
   * @param {Array<{text, count, lastUsed}>} kws
   */
  function upsertBatch(kws) {
    if (ready && window.electronAPI && window.electronAPI.keywordUpsertBatch) {
      return window.electronAPI.keywordUpsertBatch(kws).then(function(result) {
        if (!result.success) {
          console.warn('[KeywordStorage] 批量写入失败:', result.error);
        }
      }).catch(function(e) {
        console.warn('[KeywordStorage] 批量写入异常:', e);
      });
    }
    return Promise.resolve();
  }

  /**
   * 删除单个关键词
   * @param {string} text
   */
  function deleteKw(text) {
    if (ready && window.electronAPI && window.electronAPI.keywordDelete) {
      return window.electronAPI.keywordDelete(text).then(function(result) {
        if (!result.success) {
          console.warn('[KeywordStorage] 删除失败:', result.error);
        }
      }).catch(function(e) {
        console.warn('[KeywordStorage] 删除异常:', e);
      });
    }
    return Promise.resolve();
  }

  /**
   * 清理超限关键词（只保留指定的文本列表）
   * @param {Array<string>} keepTexts
   */
  function trimKeywords(keepTexts) {
    if (ready && window.electronAPI && window.electronAPI.keywordTrim) {
      return window.electronAPI.keywordTrim(keepTexts).then(function(result) {
        if (!result.success) {
          console.warn('[KeywordStorage] 清理超限失败:', result.error);
        }
      }).catch(function(e) {
        console.warn('[KeywordStorage] 清理超限异常:', e);
      });
    }
    return Promise.resolve();
  }

  /**
   * 广播关键词变更到其他窗口
   * @param {string} action - 'add'|'delete'|'merge'|'clear'
   * @param {*} data - 变更数据
   */
  function broadcast(action, data) {
    if (ready && window.electronAPI && window.electronAPI.keywordBroadcast) {
      window.electronAPI.keywordBroadcast(action, data).catch(function() {});
    }
  }

  /**
   * 监听其他窗口的关键词变更
   * @param {Function} callback - (action, data) => void
   */
  function onKeywordChanged(callback) {
    if (window.electronAPI && window.electronAPI.on) {
      window.electronAPI.on('keyword-changed', callback);
    }
  }

  /**
   * 移除监听
   * @param {Function} callback
   */
  function offKeywordChanged(callback) {
    if (window.electronAPI && window.electronAPI.removeListener) {
      window.electronAPI.removeListener('keyword-changed', callback);
    }
  }

  function isReady() { return ready; }

  /**
   * 保存马尔可夫转移数据（增量 count+1）
   * @param {Array<{from_kw: string, to_kw: string}>} transPairs
   */
  function saveTransitions(transPairs) {
    if (ready && window.electronAPI && window.electronAPI.keywordSaveTransitions) {
      return window.electronAPI.keywordSaveTransitions(transPairs).then(function(result) {
        if (!result.success) {
          console.warn('[KeywordStorage] 保存转移失败:', result.error);
        }
      }).catch(function(e) {
        console.warn('[KeywordStorage] 保存转移异常:', e);
      });
    }
    return Promise.resolve();
  }

  /**
   * 获取指定关键词的马尔可夫转移（懒加载）
   * @param {string} fromKw
   * @returns {Promise<{success: boolean, data: Object}>} {toKw: count}
   */
  function getTransitions(fromKw) {
    if (ready && window.electronAPI && window.electronAPI.keywordGetTransitions) {
      return window.electronAPI.keywordGetTransitions(fromKw).then(function(result) {
        return result || { success: false };
      }).catch(function() {
        return { success: false };
      });
    }
    return Promise.resolve({ success: false });
  }

  /**
   * SQL 端搜索关键词
   * @param {Object} options - {query: string, limit: number}
   * @returns {Promise<{success: boolean, data: Array}>}
   */
  function searchKeywords(options) {
    if (ready && window.electronAPI && window.electronAPI.keywordSearch) {
      return window.electronAPI.keywordSearch(options).then(function(result) {
        return result || { success: false };
      }).catch(function() {
        return { success: false };
      });
    }
    return Promise.resolve({ success: false });
  }

  /**
   * fzf 模糊搜索关键词
   * @param {string} query - 搜索词
   * @param {string[]} keywords - 兜底关键词列表（main 进程优先使用自身缓存）
   * @returns {Promise<{success: boolean, data?: string[], fallback?: boolean}>}
   */
  function searchKeywordsFzf(query, keywords) {
    if (ready && window.electronAPI && window.electronAPI.keywordSearchFzf) {
      return window.electronAPI.keywordSearchFzf({ query: query, keywords: keywords }).then(function(result) {
        return result || { success: false, fallback: true };
      }).catch(function() {
        return { success: false, fallback: true };
      });
    }
    return Promise.resolve({ success: false, fallback: true });
  }

  /**
   * 保存关键词组合到 filter_combos 表
   * @param {Object} combo - {comboHash, keywordsSorted, keywordsOriginal}
   */
  function saveCombo(combo) {
    if (ready && window.electronAPI && window.electronAPI.keywordSaveCombo) {
      return window.electronAPI.keywordSaveCombo(combo).then(function(result) {
        if (!result || !result.success) {
          console.warn('[KeywordStorage] 保存组合失败:', (result && result.error) || '未知错误');
        }
      }).catch(function(e) {
        console.warn('[KeywordStorage] 保存组合异常:', e);
      });
    }
    return Promise.resolve();
  }

  /**
   * 加载关键词组合历史
   * @returns {Promise<{success: boolean, data: Array}>}
   */
  function loadCombos() {
    if (ready && window.electronAPI && window.electronAPI.keywordLoadCombos) {
      return window.electronAPI.keywordLoadCombos().then(function(result) {
        if (result && result.success) {
          console.log('[KeywordStorage] 加载组合历史:', (result.data && result.data.length) || 0, '条');
        }
        return result || { success: false };
      }).catch(function(e) {
        console.warn('[KeywordStorage] 加载组合异常:', e);
        return { success: false };
      });
    }
    return Promise.resolve({ success: false });
  }

  /**
   * 删除关键词组合
   * @param {string} keywordsSorted - 排序后的关键词（| 分隔，HTML 安全）
   */
  function deleteCombo(keywordsSorted) {
    if (ready && window.electronAPI && window.electronAPI.keywordDeleteCombo) {
      return window.electronAPI.keywordDeleteCombo(keywordsSorted).then(function(result) {
        if (!result || !result.success) {
          console.warn('[KeywordStorage] 删除组合失败:', (result && result.error) || '未知错误');
        }
      }).catch(function(e) {
        console.warn('[KeywordStorage] 删除组合异常:', e);
      });
    }
    return Promise.resolve();
  }

  window.App = window.App || {};
  window.App.IDB = {
    init: init,
    loadAll: loadAll,
    upsertBatch: upsertBatch,
    deleteKw: deleteKw,
    trimKeywords: trimKeywords,
    broadcast: broadcast,
    onKeywordChanged: onKeywordChanged,
    offKeywordChanged: offKeywordChanged,
    isReady: isReady,
    saveTransitions: saveTransitions,
    getTransitions: getTransitions,
    searchKeywords: searchKeywords,
    searchKeywordsFzf: searchKeywordsFzf,
    saveCombo: saveCombo,
    loadCombos: loadCombos,
    deleteCombo: deleteCombo
  };

  console.log('[KeywordStorage] 模块已加载（SQLite 模式）');
})();
