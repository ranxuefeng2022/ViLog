/**
 * 过滤关键词历史模块 v2
 * 功能：
 * 1. 将过滤关键词保存到 JSON 文件（主）+ localStorage（备份）
 * 2. 关键词数据模型：{text, count, lastUsed} — 支持频率统计
 * 3. 过滤预设：保存/加载命名关键词组合
 * 4. 共现记录：记录关键词两两使用频率，支持智能推荐
 * 5. 客户端模糊匹配 + 正则匹配
 * 6. 自动迁移 v1（纯字符串数组）到 v2 格式
 */

(function() {
  'use strict';

  // 存储配置
  var STORAGE_KEY = 'logViewerFilterKeywords';
  var MAX_HISTORY = 10000;

  // ========== 状态 ==========
  var keywords = [];       // Array<{text: string, count: number, lastUsed: number}>
  var presets = [];         // Array<{id: string, name: string, keywords: string, createdAt: number, usageCount: number}>
  var cooccurrence = {};    // {"kw1|kw2": number} — 排序后的关键词对 → 共现次数

  // ========== 数据迁移 ==========

  /**
   * 将旧格式数据迁移为 v2 对象数组
   * @param {*} data - 可能是 v1 格式 {keywords: ["a","b"]} 或 v2 格式 {keywords: [{text,...}]}
   * @returns {Array<{text, count, lastUsed}>}
   */
  function migrateKeywords(data) {
    if (!data || !data.keywords) return [];

    // 如果已经是 v2 格式（数组元素是对象且有 .text）
    if (data.keywords.length > 0 && typeof data.keywords[0] === 'object' && data.keywords[0].text) {
      return data.keywords;
    }

    // v1 格式：纯字符串数组 → 转为对象数组
    var now = Date.now();
    return data.keywords.map(function(kw, i) {
      if (typeof kw !== 'string') return null;
      return { text: kw, count: 1, lastUsed: data.timestamp || (now - i * 1000) };
    }).filter(Boolean);
  }

  // ========== 存储操作 ==========

  /**
   * 加载关键词历史（文件优先，localStorage 降级）
   */
  async function loadKeywords() {
    try {
      // 优先从文件读取
      if (window.App && window.App.IDB) {
        var filters = await window.App.IDB.getFilters();
        if (filters && filters[STORAGE_KEY]) {
          var data = filters[STORAGE_KEY];
          keywords = migrateKeywords(data);
          // 加载预设
          presets = (data && Array.isArray(data.presets)) ? data.presets : [];
          // 加载共现
          cooccurrence = (data && data.cooccurrence && typeof data.cooccurrence === 'object') ? data.cooccurrence : {};
          console.log('[FilterKeywordHistory] 从文件加载关键词:', keywords.length, '预设:', presets.length);
          return keywords;
        }
      }

      // 降级到 localStorage
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // localStorage 备份是纯字符串数组，转为 v2
          var now = Date.now();
          keywords = parsed.map(function(kw, i) {
            return { text: kw, count: 1, lastUsed: now - i * 1000 };
          });
        } else if (parsed && parsed.keywords) {
          keywords = migrateKeywords(parsed);
        }
        console.log('[FilterKeywordHistory] 从 localStorage 加载关键词:', keywords.length);
        return keywords;
      }

      keywords = [];
      return keywords;
    } catch (e) {
      console.error('[FilterKeywordHistory] 加载关键词失败:', e);
      keywords = [];
      return keywords;
    }
  }

  /**
   * 保存关键词历史（文件 + localStorage 双写）
   */
  async function saveKeywords() {
    try {
      var data = {
        version: 2,
        keywords: keywords,
        presets: presets,
        cooccurrence: cooccurrence,
        timestamp: Date.now()
      };

      // 保存到文件
      if (window.App && window.App.IDB) {
        await window.App.IDB.saveFilter(STORAGE_KEY, data);
      }

      // localStorage 备份：只存纯字符串数组（向后兼容）
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keywords.map(function(k) { return k.text; })));
    } catch (e) {
      console.error('[FilterKeywordHistory] 保存关键词失败:', e);
    }
  }

  // ========== 关键词 CRUD ==========

  /**
   * 通过文本查找关键词索引
   */
  function findKeywordIndex(text) {
    for (var i = 0; i < keywords.length; i++) {
      if (keywords[i].text === text) return i;
    }
    return -1;
  }

  /**
   * 添加关键词到历史（已存在则 count++ 并移到最前）
   */
  async function addKeyword(keyword) {
    if (!keyword || keyword.trim() === '') return;

    keyword = keyword.trim();
    var existingIndex = findKeywordIndex(keyword);

    if (existingIndex !== -1) {
      // 已存在：增加计数，更新时间，移到最前
      keywords[existingIndex].count++;
      keywords[existingIndex].lastUsed = Date.now();
      var item = keywords.splice(existingIndex, 1)[0];
      keywords.unshift(item);
    } else {
      // 新增
      keywords.unshift({ text: keyword, count: 1, lastUsed: Date.now() });
    }

    // 限制数量
    if (keywords.length > MAX_HISTORY) {
      keywords = keywords.slice(0, MAX_HISTORY);
    }

    await saveKeywords();
  }

  /**
   * 批量添加关键词（解析 | 分隔的输入）
   * 优化：统一保存一次而非每条都保存
   */
  async function addKeywordsFromInput(input) {
    if (!input || input.trim() === '') return;

    // 解析 | 分隔的关键词，考虑转义的 \|
    var parts = input.split(/(?<!\\)\|/).map(function(s) { return s.replace(/\\\|/g, '|').trim(); }).filter(Boolean);

    for (var i = 0; i < parts.length; i++) {
      var keyword = parts[i];
      var existingIndex = findKeywordIndex(keyword);

      if (existingIndex !== -1) {
        keywords[existingIndex].count++;
        keywords[existingIndex].lastUsed = Date.now();
        var item = keywords.splice(existingIndex, 1)[0];
        keywords.unshift(item);
      } else {
        keywords.unshift({ text: keyword, count: 1, lastUsed: Date.now() });
      }
    }

    // 限制数量
    if (keywords.length > MAX_HISTORY) {
      keywords = keywords.slice(0, MAX_HISTORY);
    }

    // 统一保存一次
    await saveKeywords();

    // 记录共现（仅当有多个关键词时）
    if (parts.length >= 2) {
      recordCooccurrence(parts);
    }
  }

  /**
   * 获取所有关键词（返回纯字符串数组，向后兼容）
   */
  function getKeywords() {
    return keywords.map(function(k) { return k.text; });
  }

  /**
   * 获取完整关键词对象数组
   */
  function getKeywordObjects() {
    return keywords;
  }

  /**
   * 删除指定关键词
   */
  async function removeKeyword(keyword) {
    if (!keyword) return;
    var idx = findKeywordIndex(keyword);
    if (idx !== -1) {
      keywords.splice(idx, 1);
      await saveKeywords();
    }
  }

  // ========== 预设管理 ==========

  function getPresets() {
    return presets;
  }

  async function savePreset(name, keywordsText) {
    if (!name || !keywordsText) return;
    var id = 'p' + Date.now();
    presets.unshift({ id: id, name: name.trim(), keywords: keywordsText, createdAt: Date.now(), usageCount: 0 });
    await saveKeywords();
    return id;
  }

  async function deletePreset(id) {
    presets = presets.filter(function(p) { return p.id !== id; });
    await saveKeywords();
  }

  function applyPreset(id) {
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].id === id) {
        presets[i].usageCount = (presets[i].usageCount || 0) + 1;
        saveKeywords(); // 异步保存，不等待
        return presets[i].keywords;
      }
    }
    return null;
  }

  // ========== 共现记录 ==========

  /**
   * 记录关键词共现关系
   * @param {Array<string>} parts - 已拆分的关键词数组
   */
  function recordCooccurrence(parts) {
    for (var i = 0; i < parts.length; i++) {
      for (var j = i + 1; j < parts.length; j++) {
        var pair = [parts[i], parts[j]].sort().join('|');
        cooccurrence[pair] = (cooccurrence[pair] || 0) + 1;
      }
    }
    // 限制共现记录数量（防止无限增长）
    var keys = Object.keys(cooccurrence);
    if (keys.length > 50000) {
      // 保留计数最高的 30000 条
      keys.sort(function(a, b) { return cooccurrence[b] - cooccurrence[a]; });
      var newCo = {};
      for (var k = 0; k < 30000; k++) {
        newCo[keys[k]] = cooccurrence[keys[k]];
      }
      cooccurrence = newCo;
    }
    saveKeywords(); // 异步保存
  }

  /**
   * 获取与指定关键词经常一起使用的关联词
   * @param {string} keyword - 目标关键词
   * @returns {Array<{keyword: string, count: number}>} 按共现次数降序，最多 5 个
   */
  function getRelatedKeywords(keyword) {
    var related = [];
    for (var pair in cooccurrence) {
      if (!cooccurrence.hasOwnProperty(pair)) continue;
      var parts = pair.split('|');
      if (parts[0] === keyword) related.push({ keyword: parts[1], count: cooccurrence[pair] });
      else if (parts[1] === keyword) related.push({ keyword: parts[0], count: cooccurrence[pair] });
    }
    related.sort(function(a, b) { return b.count - a.count; });
    return related.slice(0, 5);
  }

  // ========== 清理工具 ==========

  /**
   * Levenshtein 编辑距离
   */
  function levenshtein(a, b) {
    var m = a.length, n = b.length;
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp[i] = [i];
      for (var j = 1; j <= n; j++) {
        if (i === 0) { dp[0][j] = j; }
        else { dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)); }
      }
    }
    return dp[m][n];
  }

  /**
   * 判断两个关键词是否相似
   */
  function areSimilar(a, b) {
    if (a === b) return true;
    // 空白变体
    if (a.trim() === b.trim() && a !== b) return true;
    // 大小写变体
    if (a.toLowerCase() === b.toLowerCase() && a !== b) return true;
    // 前后缀重叠（最少 4 字符）
    if (a.length >= 4 && b.length >= 4) {
      if (a.startsWith(b) || b.startsWith(a)) return true;
      if (a.endsWith(b) || b.endsWith(a)) return true;
    }
    // Levenshtein 距离比例 < 20%（短字符串限定）
    if (a.length <= 20 && b.length <= 20 && Math.abs(a.length - b.length) <= 3) {
      var dist = levenshtein(a, b);
      var maxLen = Math.max(a.length, b.length);
      if (dist > 0 && dist / maxLen < 0.2) return true;
    }
    return false;
  }

  /**
   * 查找所有相似关键词分组
   * @returns {Array<Array<number>>} 每组是索引数组
   */
  function findSimilarKeywords() {
    var groups = [];
    var used = {};

    for (var i = 0; i < keywords.length; i++) {
      if (used[i]) continue;
      var group = [i];
      used[i] = true;

      for (var j = i + 1; j < keywords.length; j++) {
        if (used[j]) continue;
        if (areSimilar(keywords[i].text, keywords[j].text)) {
          group.push(j);
          used[j] = true;
        }
      }

      if (group.length > 1) {
        groups.push(group);
      }
    }
    return groups;
  }

  /**
   * 合并关键词：保留 keepIdx，删除 removeIdxs（count 合并到保留项）
   */
  async function mergeKeywords(keepIdx, removeIdxs) {
    for (var i = 0; i < removeIdxs.length; i++) {
      keywords[keepIdx].count += keywords[removeIdxs[i]].count;
    }
    // 按索引降序删除，避免索引偏移
    var sorted = removeIdxs.slice().sort(function(a, b) { return b - a; });
    for (var i = 0; i < sorted.length; i++) {
      keywords.splice(sorted[i], 1);
    }
    await saveKeywords();
  }

  // ========== 搜索匹配 ==========

  /**
   * 客户端模糊匹配算法（v2 — 融入频率因子）
   * - 精确子串匹配：最高优先级（越靠前分越高）
   * - 顺序字符匹配（允许间隔）：中等优先级（连续匹配有额外加分）
   * - 频率因子：count * 5 加分
   */
  function fuzzyMatch(query, candidates) {
    // candidates 来自 getKeywords() 时是 string[]；来自内部时也兼容
    if (candidates === undefined) candidates = getKeywords();
    if (!query || !query.trim()) {
      // 无搜索词时，按首字母排序
      var sorted = keywords.slice().sort(function(a, b) {
        return a.text.toLowerCase().localeCompare(b.text.toLowerCase());
      });
      return sorted.map(function(k) { return k.text; });
    }

    var lowerQ = query.toLowerCase();
    var scored = [];

    for (var c = 0; c < candidates.length; c++) {
      var candidate = candidates[c];
      var lc = candidate.toLowerCase();

      // 获取该关键词的频率信息
      var kwObj = null;
      for (var ki = 0; ki < keywords.length; ki++) {
        if (keywords[ki].text === candidate) { kwObj = keywords[ki]; break; }
      }
      var freqBoost = kwObj ? kwObj.count * 5 : 0;

      // 精确子串匹配
      var idx = lc.indexOf(lowerQ);
      if (idx !== -1) {
        scored.push({ keyword: candidate, score: 10000 - idx + freqBoost });
        continue;
      }

      // 顺序字符匹配（模糊匹配）
      var score = 0;
      var qi = 0;
      var con = 0;
      for (var ci = 0; ci < lc.length && qi < lowerQ.length; ci++) {
        if (lc[ci] === lowerQ[qi]) {
          score += 10 + con;
          con += 5;
          qi++;
        } else {
          con = 0;
        }
      }

      if (qi === lowerQ.length) {
        scored.push({ keyword: candidate, score: score + freqBoost });
      }
    }

    scored.sort(function(a, b) { return b.score - a.score; });
    return scored.map(function(s) { return s.keyword; });
  }

  /**
   * 正则表达式匹配
   */
  function regexMatch(pattern, candidates) {
    if (candidates === undefined) candidates = getKeywords();
    if (!pattern) return candidates.slice();

    try {
      var regex = new RegExp(pattern, 'i');
      return candidates.filter(function(kw) { return regex.test(kw); });
    } catch (e) {
      // 无效正则，降级为子串匹配
      return candidates.filter(function(kw) { return kw.indexOf(pattern) !== -1; });
    }
  }

  // ========== 旧数据迁移 ==========

  /**
   * 迁移旧 localStorage 数据，按 | 拆分关键词
   */
  async function migrateOldHistory() {
    var FLAG = 'logViewerFilterKeywords_migrated';
    if (localStorage.getItem(FLAG)) return;

    try {
      var raw = localStorage.getItem('logViewerFilterHistory');
      if (!raw) {
        localStorage.setItem(FLAG, 'true');
        return;
      }

      var old = JSON.parse(raw);
      if (!Array.isArray(old) || old.length === 0) {
        localStorage.setItem(FLAG, 'true');
        return;
      }

      console.log('[FilterKeywordHistory] 开始迁移旧数据，共', old.length, '条');

      var now = Date.now();
      for (var i = 0; i < old.length; i++) {
        var entry = old[i];
        if (!entry) continue;
        var parts = entry.split(/(?<!\\)\|/).map(function(s) { return s.replace(/\\\|/g, '|').trim(); }).filter(Boolean);
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j];
          var existingIdx = findKeywordIndex(p);
          if (existingIdx !== -1) {
            keywords[existingIdx].count++;
            // 移到最前
            var item = keywords.splice(existingIdx, 1)[0];
            keywords.unshift(item);
          } else {
            keywords.unshift({ text: p, count: 1, lastUsed: now - i * 1000 });
          }
        }
      }

      if (keywords.length > MAX_HISTORY) {
        keywords = keywords.slice(0, MAX_HISTORY);
      }

      await saveKeywords();
      localStorage.setItem(FLAG, 'true');
      console.log('[FilterKeywordHistory] 迁移完成，关键词数:', keywords.length);
    } catch (e) {
      console.warn('[FilterKeywordHistory] 迁移失败:', e);
    }
  }

  // ========== UI 交互（工具栏下拉） ==========

  function showSuggestions(inputElement, suggestionsElement, onSelect) {
    var query = inputElement.value.trim();
    var matches = fuzzyMatch(query);

    suggestionsElement.innerHTML = '';

    if (matches.length === 0) {
      suggestionsElement.classList.remove('visible');
      return 0;
    }

    for (var i = 0; i < matches.length; i++) {
      (function(keyword, index) {
        var item = document.createElement('div');
        item.className = 'filter-suggestion-item';
        item.textContent = keyword;
        item.dataset.index = index;

        item.addEventListener('click', function() {
          inputElement.value = keyword;
          if (onSelect) onSelect(keyword);
          hideSuggestions(suggestionsElement);
        });

        suggestionsElement.appendChild(item);
      })(matches[i], i);
    }

    suggestionsElement.classList.add('visible');
    return matches.length;
  }

  function hideSuggestions(suggestionsElement) {
    suggestionsElement.classList.remove('visible');
    suggestionsElement.innerHTML = '';
  }

  function handleKeyDown(e, suggestionsElement, selectedIndex) {
    var items = suggestionsElement.querySelectorAll('.filter-suggestion-item');
    if (items.length === 0) return selectedIndex;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        break;
      case 'Enter':
        if (selectedIndex >= 0) {
          e.preventDefault();
          items[selectedIndex].click();
          selectedIndex = -1;
        }
        break;
      case 'Escape':
        hideSuggestions(suggestionsElement);
        selectedIndex = -1;
        break;
    }

    for (var i = 0; i < items.length; i++) {
      if (i === selectedIndex) {
        items[i].classList.add('selected');
        items[i].scrollIntoView({ block: 'nearest' });
      } else {
        items[i].classList.remove('selected');
      }
    }

    return selectedIndex;
  }

  // ========== 初始化 ==========

  async function init() {
    await loadKeywords();
    await migrateOldHistory();
    console.log('[FilterKeywordHistory] 初始化完成，关键词:', keywords.length, '预设:', presets.length);
  }

  // 导出到全局
  window.App = window.App || {};
  window.App.FilterKeywordHistory = {
    init: init,
    loadKeywords: loadKeywords,
    addKeyword: addKeyword,
    addKeywordsFromInput: addKeywordsFromInput,
    getKeywords: getKeywords,
    getKeywordObjects: getKeywordObjects,
    removeKeyword: removeKeyword,
    fuzzyMatch: fuzzyMatch,
    regexMatch: regexMatch,
    showSuggestions: showSuggestions,
    hideSuggestions: hideSuggestions,
    handleKeyDown: handleKeyDown,
    // 预设
    getPresets: getPresets,
    savePreset: savePreset,
    deletePreset: deletePreset,
    applyPreset: applyPreset,
    // 共现
    getRelatedKeywords: getRelatedKeywords,
    // 清理
    findSimilarKeywords: findSimilarKeywords,
    mergeKeywords: mergeKeywords
  };

  console.log('[FilterKeywordHistory] 模块已加载');
})();
