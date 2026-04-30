/**
 * 过滤关键词历史模块 v3
 * 唯一数据源：SQLite 数据库（mem/keywords.db）
 *
 * 功能：
 * 1. 关键词数据模型：{text, count, lastUsed} — 支持频率统计
 * 2. 过滤预设：保存/加载命名关键词组合
 * 3. 共现记录：记录关键词两两使用频率，支持智能推荐
 * 4. 客户端模糊匹配 + 正则匹配
 *
 * v3 变更：
 * - 存储从 JSON 全量读写改为 SQLite 增量操作
 * - addKeyword/addKeywordsFromInput 只 upsert 变更的行
 * - removeKeyword 只 delete 一行
 * - 预设/共现变更时单独保存
 */

(function() {
  'use strict';

  // 存储配置
  var MAX_HISTORY = 10000;

  // ========== 状态 ==========
  var keywords = [];       // Array<{text: string, count: number, lastUsed: number}>
  var keywordMap = {};     // {text: arrayIndex} — O(1) 查找索引
  var _cachedKeywordTexts = null; // getKeywords() 缓存，数据变化时置 null
  var _cachedKwObjMap = null;     // {text: kwObj} 缓存，数据变化时置 null
  var transitionsCacheMap = {};  // {fromKw: {toKw: count}} — 多关键词马尔可夫转移缓存
  var _transitionsLRU = [];     // LRU 顺序，最多保留 10 个关键词
  var _transitionsLRUMax = 10;
  var lastAddedText = null; // 上一次添加的关键词（用于会话级转移）
  var lastAddedTime = 0;    // 上一次添加的时间戳

  // ========== 工具函数 ==========

  /** 从 textarea 中提取当前已输入的关键词上下文 */
  function getTextareaContext() {
    var context = [];
    var textarea = document.getElementById('filterDialogTextarea');
    if (textarea && textarea.value) {
      var parts = textarea.value.split(/(?<!\\)\|/);
      for (var pi = 0; pi < parts.length; pi++) {
        var t = parts[pi].trim().replace(/\\\|/g, '|');
        if (t) context.push(t);
      }
    }
    return context;
  }

  // ========== 综合评分 ==========

  /**
   * 三因子综合评分：频率 × 时效 × 马尔可夫转移
   * - 频率分：log(count+1) * 200（上限 ~1380）
   * - 时效分：e^(-Δt/86400) * 1000（1天半衰期，上限 1000）
   * - 马尔可夫分：仅计算 textarea 上下文到候选词的转移，上限 2000
   */
  function relevanceScore(kwObj, textareaContext, now) {
    if (!kwObj) return 0;
    if (!now) now = Date.now();
    var freqScore = Math.log(kwObj.count + 1) * 200;
    var decaySec = (now - kwObj.lastUsed) / 1000;
    var timeScore = Math.exp(-decaySec / 86400) * 1000;
    // 马尔可夫转移分：仅从 textarea 上下文关键词出发查找转移
    var markovScore = 0;
    if (textareaContext && textareaContext.length > 0) {
      for (var ci = 0; ci < textareaContext.length; ci++) {
        var fromKw = textareaContext[ci];
        if (transitionsCacheMap[fromKw] && transitionsCacheMap[fromKw][kwObj.text]) {
          var s = Math.min(transitionsCacheMap[fromKw][kwObj.text], 10) * 200;
          if (s > markovScore) markovScore = s;
        }
      }
    }
    return freqScore + timeScore + markovScore;
  }

  /** 按综合评分排序关键词（无搜索词时使用） */
  function sortByRelevance(candidates) {
    var textareaContext = getTextareaContext();
    // 构建 textarea 已选关键词集合，用于降权
    var textareaSet = {};
    for (var ti = 0; ti < textareaContext.length; ti++) {
      textareaSet[textareaContext[ti]] = true;
    }
    var kwObjMap = getKwObjMap();
    var now = Date.now();
    var scored = [];
    for (var c = 0; c < candidates.length; c++) {
      var kwObj = kwObjMap[candidates[c]] || null;
      var score = relevanceScore(kwObj, textareaContext, now);
      // 已选入 textarea 的关键词降权
      if (textareaSet[candidates[c]]) score -= 2000;
      scored.push({ keyword: candidates[c], score: score });
    }
    scored.sort(function(a, b) { return b.score - a.score; });
    return scored.map(function(s) { return s.keyword; });
  }

  // ========== 存储操作 ==========

  /**
   * 从 SQLite 数据库加载全部关键词数据
   */
  async function loadKeywords() {
    try {
      if (window.App && window.App.IDB && window.App.IDB.loadAll) {
        var data = await window.App.IDB.loadAll();
        if (data) {
          keywords = Array.isArray(data.keywords) ? data.keywords : [];
        }
        rebuildKeywordMap();
        console.log('[FilterKeywordHistory] 从 SQLite 加载关键词:', keywords.length);
        return keywords;
      }

      keywords = [];
      rebuildKeywordMap();
      return keywords;
    } catch (e) {
      console.error('[FilterKeywordHistory] 加载关键词失败:', e);
      keywords = [];
      rebuildKeywordMap();
      return keywords;
    }
  }

  // ========== 关键词 CRUD ==========

  /**
   * 全量重建 keywordMap（仅在 loadKeywords 时使用）
   */
  function rebuildKeywordMap() {
    keywordMap = {};
    for (var i = 0; i < keywords.length; i++) {
      keywordMap[keywords[i].text] = i;
    }
    _cachedKeywordTexts = null;
    _cachedKwObjMap = null;
  }

  /**
   * 增量更新 keywordMap：将指定文本移到 index=0 位置
   * splice(idx, 1) + unshift 后，所有原 idx 之前的元素索引 +1，之后的元素不变
   */
  function moveKeywordToFront(text, oldIdx) {
    // idx 之前的元素索引全部 +1
    for (var k in keywordMap) {
      if (keywordMap.hasOwnProperty(k) && keywordMap[k] < oldIdx) {
        keywordMap[k]++;
      }
    }
    keywordMap[text] = 0;
    _cachedKeywordTexts = null;
    _cachedKwObjMap = null;
  }

  /**
   * 增量更新 keywordMap：新增一个文本到 index=0
   */
  function addKeywordToMap(text) {
    // 所有现有元素索引 +1
    for (var k in keywordMap) {
      if (keywordMap.hasOwnProperty(k)) {
        keywordMap[k]++;
      }
    }
    keywordMap[text] = 0;
    _cachedKeywordTexts = null;
    _cachedKwObjMap = null;
  }

  /**
   * 增量更新 keywordMap：删除指定文本
   * splice 后，被删元素之后的所有元素索引 -1
   */
  function removeKeywordFromMap(text, oldIdx) {
    delete keywordMap[text];
    for (var k in keywordMap) {
      if (keywordMap.hasOwnProperty(k) && keywordMap[k] > oldIdx) {
        keywordMap[k]--;
      }
    }
    _cachedKeywordTexts = null;
    _cachedKwObjMap = null;
  }

  /**
   * 通过文本查找关键词索引 — O(1) map 查找（Bug 4）
   */
  function findKeywordIndex(text) {
    return keywordMap.hasOwnProperty(text) ? keywordMap[text] : -1;
  }

  /**
   * 添加关键词到历史（已存在则 count++ 并移到最前）
   * 只 upsert 变更的这一条到 SQLite
   */
  async function addKeyword(keyword) {
    if (!keyword || keyword.trim() === '') return;

    keyword = keyword.trim();
    var existingIndex = findKeywordIndex(keyword);
    var kwObj;

    if (existingIndex !== -1) {
      keywords[existingIndex].count++;
      keywords[existingIndex].lastUsed = Date.now();
      kwObj = keywords[existingIndex];
      var item = keywords.splice(existingIndex, 1)[0];
      keywords.unshift(item);
      moveKeywordToFront(keyword, existingIndex);
    } else {
      kwObj = { text: keyword, count: 1, lastUsed: Date.now() };
      keywords.unshift(kwObj);
      addKeywordToMap(keyword);
    }

    var trimmed = false;
    if (keywords.length > MAX_HISTORY) {
      keywords = keywords.slice(0, MAX_HISTORY);
      trimmed = true;
      rebuildKeywordMap(); // 截断后全量重建
    }

    // 只写入这一条关键词到 SQLite
    if (window.App && window.App.IDB) {
      if (window.App.IDB.upsertBatch) {
        await window.App.IDB.upsertBatch([kwObj]);
      }
      // Bug 3: 截断后清理 DB 残留
      if (trimmed && window.App.IDB.trimKeywords) {
        var keepTexts = keywords.map(function(k) { return k.text; });
        await window.App.IDB.trimKeywords(keepTexts);
      }
      // Bug 9: 广播变更到其他窗口
      if (window.App.IDB.broadcast) {
        window.App.IDB.broadcast('add', { text: keyword });
      }
    }

    // 马尔可夫：记录会话级转移（30 分钟内连续添加视为同一会话）
    await recordSessionTransition(keyword);
    lastAddedText = keyword;
    lastAddedTime = Date.now();
  }

  /**
   * 批量添加关键词（解析 | 分隔的输入）
   * 只 upsert 变更的行到 SQLite
   */
  async function addKeywordsFromInput(input) {
    if (!input || input.trim() === '') return;

    var parts = input.split(/(?<!\\)\|/).map(function(s) { return s.replace(/\\\|/g, '|').trim(); }).filter(Boolean);
    var changedKws = [];

    // 收集需要移动和新增的项，最后批量处理 map
    var toMove = []; // {text, oldIdx}
    var toAdd = [];  // text

    for (var i = 0; i < parts.length; i++) {
      var keyword = parts[i];
      var existingIndex = findKeywordIndex(keyword);

      if (existingIndex !== -1) {
        keywords[existingIndex].count++;
        keywords[existingIndex].lastUsed = Date.now();
        changedKws.push(keywords[existingIndex]);
        toMove.push(keyword);
      } else {
        var kwObj = { text: keyword, count: 1, lastUsed: Date.now() };
        changedKws.push(kwObj);
        toAdd.push(keyword);
      }
    }

    // 先从数组中移除所有要移到前面的项（从后往前 splice，不影响前面的索引）
    var movedItems = [];
    for (var mi = toMove.length - 1; mi >= 0; mi--) {
      var idx = findKeywordIndex(toMove[mi]);
      if (idx !== -1) {
        movedItems.unshift(keywords.splice(idx, 1)[0]);
      }
    }
    // 新增项：从 changedKws 中获取已创建的 kwObj
    var newItems = [];
    for (var ni = 0; ni < toAdd.length; ni++) {
      for (var ci = 0; ci < changedKws.length; ci++) {
        if (changedKws[ci].text === toAdd[ni]) {
          newItems.push(changedKws[ci]);
          break;
        }
      }
    }
    // 全部 unshift 到数组前端（新增在前，移动在后）
    var allToFront = newItems.concat(movedItems);
    for (var ai = allToFront.length - 1; ai >= 0; ai--) {
      keywords.unshift(allToFront[ai]);
    }

    var trimmed = false;
    if (keywords.length > MAX_HISTORY) {
      keywords = keywords.slice(0, MAX_HISTORY);
      trimmed = true;
    }

    // 批量操作后全量重建 map
    rebuildKeywordMap();

    // 马尔可夫：记录输入内部转移 A→B, B→C（只收集 pairs，DB 端 count+1）
    var transPairs = [];
    for (var ti = 1; ti < parts.length; ti++) {
      transPairs.push({ from_kw: parts[ti - 1], to_kw: parts[ti] });
    }
    // 会话级转移：上一次添加的词 → 本次第一个词（30 分钟内）
    if (lastAddedText && lastAddedText !== parts[0] && (Date.now() - lastAddedTime) < 1800000) {
      transPairs.push({ from_kw: lastAddedText, to_kw: parts[0] });
    }
    lastAddedText = parts[parts.length - 1];
    lastAddedTime = Date.now();

    // 只写入变更的关键词 + 转移数据
    if (window.App && window.App.IDB) {
      if (changedKws.length > 0 && window.App.IDB.upsertBatch) {
        await window.App.IDB.upsertBatch(changedKws);
      }
      // Bug 3: 截断后清理 DB 残留
      if (trimmed && window.App.IDB.trimKeywords) {
        var keepTexts = keywords.map(function(k) { return k.text; });
        await window.App.IDB.trimKeywords(keepTexts);
      }
      // 马尔可夫：保存转移 pairs
      if (transPairs.length > 0 && window.App.IDB.saveTransitions) {
        await window.App.IDB.saveTransitions(transPairs);
      }
      // Bug 9: 广播变更到其他窗口
      if (window.App.IDB.broadcast) {
        window.App.IDB.broadcast('add', { parts: parts });
      }
    }
  }

  /**
   * 获取所有关键词（返回纯字符串数组，向后兼容）
   */
  function getKeywords() {
    if (_cachedKeywordTexts) return _cachedKeywordTexts;
    _cachedKeywordTexts = keywords.map(function(k) { return k.text; });
    return _cachedKeywordTexts;
  }

  /**
   * 获取完整关键词对象数组
   */
  function getKeywordObjects() {
    return keywords;
  }

  /**
   * 获取 {text: kwObj} 映射（带缓存），供 scoreAndSortResults 使用
   */
  function getKwObjMap() {
    if (_cachedKwObjMap) return _cachedKwObjMap;
    _cachedKwObjMap = {};
    for (var i = 0; i < keywords.length; i++) {
      _cachedKwObjMap[keywords[i].text] = keywords[i];
    }
    return _cachedKwObjMap;
  }

  /**
   * 删除指定关键词 — 只 delete 一行
   */
  async function removeKeyword(keyword) {
    if (!keyword) return;
    var idx = findKeywordIndex(keyword);
    if (idx !== -1) {
      keywords.splice(idx, 1);
      removeKeywordFromMap(keyword, idx);
      if (window.App && window.App.IDB) {
        if (window.App.IDB.deleteKw) {
          await window.App.IDB.deleteKw(keyword);
        }
        if (window.App.IDB.broadcast) {
          window.App.IDB.broadcast('delete', { text: keyword });
        }
      }
    }
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
    if (a.trim() === b.trim() && a !== b) return true;
    if (a.toLowerCase() === b.toLowerCase() && a !== b) return true;
    if (a.length >= 4 && b.length >= 4) {
      if (a.startsWith(b) || b.startsWith(a)) return true;
      if (a.endsWith(b) || b.endsWith(a)) return true;
    }
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
    var upsertKw = null;
    var deleteTexts = [];

    for (var i = 0; i < removeIdxs.length; i++) {
      keywords[keepIdx].count += keywords[removeIdxs[i]].count;
      deleteTexts.push(keywords[removeIdxs[i]].text);
    }
    upsertKw = keywords[keepIdx];

    var sorted = removeIdxs.slice().sort(function(a, b) { return b - a; });
    for (var i = 0; i < sorted.length; i++) {
      keywords.splice(sorted[i], 1);
    }

    // 重建 map（splice 改变了索引）
    rebuildKeywordMap();

    // 增量操作：upsert 保留项 + delete 被合并项
    if (window.App && window.App.IDB) {
      if (upsertKw && window.App.IDB.upsertBatch) {
        await window.App.IDB.upsertBatch([upsertKw]);
      }
      for (var d = 0; d < deleteTexts.length; d++) {
        if (window.App.IDB.deleteKw) {
          await window.App.IDB.deleteKw(deleteTexts[d]);
        }
      }
      // Bug 9: 广播合并变更
      if (window.App.IDB.broadcast) {
        window.App.IDB.broadcast('merge', { keep: upsertKw.text, removed: deleteTexts });
      }
    }
  }

  // ========== 搜索匹配 ==========

  /**
   * 客户端模糊匹配算法（v4 — 空格容忍 + 多 token 子序列）
   * 无搜索词：按内存中 keywords 数组顺序返回
   * 有搜索词：匹配度 + 前缀加分 + 精确匹配加分 + 频率 + 时效
   *
   * v4 变更：
   * - 空格分隔多 token 模式：query 按空格拆分为多个 token，
   *   每个 token 独立做子序列匹配，所有 token 均匹配才算命中
   * - 例如 "ch ch" 拆为 ["ch","ch"]，两个 token 都在 "charge_check" 中
   *   找到子序列匹配，因此可以匹配
   * - 不区分大小写
   */
  function fuzzyMatch(query, candidates) {
    if (candidates === undefined) candidates = getKeywords();

    if (!query || !query.trim()) {
      // 无搜索词时按四因子综合评分排序（而不是原序）
      return sortByRelevance(candidates);
    }

    var kwMap = getKwObjMap();

    var textareaContext = getTextareaContext();
    var now = Date.now();

    var lowerQ = query.toLowerCase();
    // 将 query 按空格拆分为多个 token（去掉空 token）
    var tokens = lowerQ.split(/\s+/).filter(function(t) { return t.length > 0; });
    // 紧凑版本（去掉所有空格），用于精确/前缀/包含匹配
    var compactQ = tokens.join('');

    var result = [];

    for (var c = 0; c < candidates.length; c++) {
      var candidate = candidates[c];
      var lc = candidate.toLowerCase();
      var kwObj = kwMap[candidate] || null;
      var base = relevanceScore(kwObj, textareaContext, now);
      var matched = false;
      var matchScore = 0;

      // 精确匹配（优先级最高）
      if (lc === compactQ || lc === lowerQ) {
        matchScore = 50000;
        matched = true;
      }
      // 前缀匹配（用紧凑 query 或原始 query）
      else if (lc.indexOf(compactQ) === 0 || lc.indexOf(lowerQ) === 0) {
        var prefixLen = Math.max(compactQ.length, lowerQ.length);
        matchScore = 30000 + (prefixLen / lc.length) * 5000;
        matched = true;
      }
      // 包含匹配
      else if (lc.indexOf(compactQ) !== -1 || lc.indexOf(lowerQ) !== -1) {
        var idx = lc.indexOf(compactQ) !== -1 ? lc.indexOf(compactQ) : lc.indexOf(lowerQ);
        matchScore = 10000 - idx * 10 + (compactQ.length / lc.length) * 3000;
        matched = true;
      }
      // 多 token 子序列模糊匹配
      else {
        var allTokensMatched = true;
        var totalTokenScore = 0;

        for (var ti = 0; ti < tokens.length; ti++) {
          var token = tokens[ti];
          // 对每个 token 独立做子序列匹配
          var subScore = 0;
          var qi = 0;
          var con = 0;
          for (var ci = 0; ci < lc.length && qi < token.length; ci++) {
            if (lc[ci] === token[qi]) {
              subScore += 10 + con;
              con += 5;
              qi++;
            } else {
              con = 0;
            }
          }
          if (qi === token.length) {
            totalTokenScore += subScore;
          } else {
            allTokensMatched = false;
            break;
          }
        }

        if (allTokensMatched) {
          matchScore = totalTokenScore / tokens.length; // 平均 token 分数
          matched = true;
        }
      }

      if (matched) {
        result.push({ keyword: candidate, score: matchScore + base });
      }
    }

    result.sort(function(a, b) { return b.score - a.score; });
    return result.map(function(s) { return s.keyword; });
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

  // ========== 马尔可夫转移 ==========

  /** 记录会话级转移：上次添加的词 → 当前词（30 分钟内） */
  async function recordSessionTransition(currentText) {
    if (!lastAddedText || lastAddedText === currentText) return;
    if ((Date.now() - lastAddedTime) > 1800000) return;

    if (window.App && window.App.IDB && window.App.IDB.saveTransitions) {
      await window.App.IDB.saveTransitions([{ from_kw: lastAddedText, to_kw: currentText }]);
    }
  }

  /**
   * 更新马尔可夫转移缓存（从 DB 按需加载指定关键词的转移）
   * 支持同时缓存多个关键词，LRU 淘汰最旧的
   */
  async function updateTransitionsCache(fromKw) {
    if (!fromKw) return;
    if (transitionsCacheMap[fromKw]) {
      // 已缓存，移到 LRU 末尾
      var lruIdx = _transitionsLRU.indexOf(fromKw);
      if (lruIdx !== -1) _transitionsLRU.splice(lruIdx, 1);
      _transitionsLRU.push(fromKw);
      return;
    }
    if (window.App && window.App.IDB && window.App.IDB.getTransitions) {
      var result = await window.App.IDB.getTransitions(fromKw);
      if (result && result.success && result.data) {
        transitionsCacheMap[fromKw] = result.data;
        _transitionsLRU.push(fromKw);
        // LRU 淘汰
        while (_transitionsLRU.length > _transitionsLRUMax) {
          var evicted = _transitionsLRU.shift();
          delete transitionsCacheMap[evicted];
        }
      }
    }
  }

  /**
   * SQL 端搜索关键词（异步，返回关键词对象数组）
   */
  async function searchFromDB(query, limit) {
    if (window.App && window.App.IDB && window.App.IDB.searchKeywords) {
      var result = await window.App.IDB.searchKeywords({ query: query, limit: limit || 300 });
      if (result && result.success && result.data) {
        return result.data; // [{text, count, lastUsed}]
      }
    }
    return null;
  }

  /**
   * fzf 模糊搜索关键词（异步，返回匹配的关键词字符串数组）
   * @returns {Promise<{matched: string[]}|null>} 匹配结果，或 null 表示 fzf 不可用需降级
   */
  async function searchFromFzf(query) {
    if (window.App && window.App.IDB && window.App.IDB.searchKeywordsFzf) {
      // main 进程已缓存关键词文本，不再传全量数据
      var result = await window.App.IDB.searchKeywordsFzf(query, []);
      if (result && result.success && result.data) {
        return { matched: result.data, fallback: false };
      }
      // fzf 不可用或失败，标记需要降级
      if (result && result.fallback) {
        return { matched: null, fallback: true };
      }
    }
    return { matched: null, fallback: true };
  }

  // ========== 初始化 ==========

  // Bug 9: 多窗口同步回调
  function handleRemoteKeywordChanged(action, data) {
    console.log('[FilterKeywordHistory] 收到远程关键词变更:', action, data);
    // 从 DB 重新加载数据（其他窗口已写入 DB）
    loadKeywords();
  }

  async function init() {
    await loadKeywords();

    // Bug 9: 注册多窗口同步监听
    if (window.App && window.App.IDB && window.App.IDB.onKeywordChanged) {
      window.App.IDB.onKeywordChanged(handleRemoteKeywordChanged);
    }

    console.log('[FilterKeywordHistory] 初始化完成，关键词:', keywords.length);
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
    getKwObjMap: getKwObjMap,
    removeKeyword: removeKeyword,
    fuzzyMatch: fuzzyMatch,
    showSuggestions: showSuggestions,
    hideSuggestions: hideSuggestions,
    handleKeyDown: handleKeyDown,
    // 清理
    findSimilarKeywords: findSimilarKeywords,
    mergeKeywords: mergeKeywords,
    // 马尔可夫转移缓存
    updateTransitionsCache: updateTransitionsCache,
    searchFromDB: searchFromDB,
    searchFromFzf: searchFromFzf,
    // 工具函数（供 patch.js 使用）
    getTextareaContext: getTextareaContext,
    relevanceScore: relevanceScore
  };

  console.log('[FilterKeywordHistory] 模块已加载（SQLite 模式）');
})();
