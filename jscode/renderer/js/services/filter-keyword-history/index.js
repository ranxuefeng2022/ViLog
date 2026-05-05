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

  // ========== 对话框 UI 状态 ==========

  var dialogReady = false;
  var currentMatchedItems = [];
  var highlightedIndex = -1;
  var selectedIndices = {};
  var currentQuery = '';
  var groupMode = false;
  var dragSelecting = false;
  var dragStartIndex = -1;
  var dragMode = 'add';
  var ITEM_HEIGHT = 32;
  var BUFFER_SIZE = 10;
  var _cachedListHeight = null;
  var virtualContainer = null;
  var virtualContent = null;
  var virtualListReady = false;
  var mouseDownActive = false;
  var pendingClickIdx = -1;
  var mouseDownX = 0, mouseDownY = 0;
  var DRAG_THRESHOLD = 5;
  var _delegatedBound = false;
  var searchCache = {};
  var searchCacheMaxSize = 20;
  var searchCacheTTL = 5000;
  var fuzzyMatchWorker = null;
  var fuzzyMatchWorkerBusy = false;
  var _pendingWorkerQuery = null;
  var searchTimer = null;
  var chipContextTarget = null;
  var _textareaSetCache = null;
  var _textareaSetCacheValue = '';

  // ========== 对话框工具函数 ==========

  function getListHeight() {
    if (_cachedListHeight !== null) return _cachedListHeight;
    var viewportH = window.innerHeight;
    var dialogH = Math.floor(viewportH * 0.66);
    var reserved = 28 + 40 + 18 + 8;
    _cachedListHeight = Math.max(200, dialogH - reserved);
    return _cachedListHeight;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getTextareaKeywordSet() {
    var textarea = document.getElementById('filterDialogTextarea');
    if (!textarea) return {};
    var current = textarea.value.trim();
    if (current === _textareaSetCacheValue && _textareaSetCache) return _textareaSetCache;
    _textareaSetCacheValue = current;
    _textareaSetCache = {};
    if (!current) return _textareaSetCache;
    var parts = current.split(/(?<!\\)\|/);
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      if (t) _textareaSetCache[t] = true;
    }
    return _textareaSetCache;
  }

  function invalidateTextareaCache() {
    _textareaSetCache = null;
    _textareaSetCacheValue = '';
  }

  function isKeywordInTextarea(keyword) {
    return !!getTextareaKeywordSet()[keyword];
  }

  function highlightMatchText(keyword, query) {
    if (!query) return escapeHtml(keyword);
    var lowerK = keyword.toLowerCase();
    var lowerQ = query.toLowerCase();
    var compactQ = lowerQ.replace(/\s+/g, '');
    var idx = lowerK.indexOf(lowerQ);
    if (idx !== -1) {
      return escapeHtml(keyword.substring(0, idx))
        + '<span class="match-highlight">' + escapeHtml(keyword.substring(idx, idx + lowerQ.length)) + '</span>'
        + escapeHtml(keyword.substring(idx + lowerQ.length));
    }
    if (compactQ !== lowerQ) {
      idx = lowerK.indexOf(compactQ);
      if (idx !== -1) {
        return escapeHtml(keyword.substring(0, idx))
          + '<span class="match-highlight">' + escapeHtml(keyword.substring(idx, idx + compactQ.length)) + '</span>'
          + escapeHtml(keyword.substring(idx + compactQ.length));
      }
    }
    var tokens = lowerQ.split(/\s+/).filter(function(t) { return t.length > 0; });
    if (tokens.length > 1) {
      var highlightPositions = {};
      for (var ti = 0; ti < tokens.length; ti++) {
        var token = tokens[ti];
        var qi = 0;
        for (var ci = 0; ci < lowerK.length && qi < token.length; ci++) {
          if (lowerK[ci] === token[qi]) { highlightPositions[ci] = true; qi++; }
        }
      }
      var result = '';
      for (var ci2 = 0; ci2 < keyword.length; ci2++) {
        if (highlightPositions[ci2]) {
          result += '<span class="match-highlight">' + escapeHtml(keyword[ci2]) + '</span>';
        } else {
          result += escapeHtml(keyword[ci2]);
        }
      }
      return result;
    }
    var result2 = '';
    var qi2 = 0, ci3;
    for (ci3 = 0; ci3 < keyword.length && qi2 < lowerQ.length; ci3++) {
      if (lowerK[ci3] === lowerQ[qi2]) {
        result2 += '<span class="match-highlight">' + escapeHtml(keyword[ci3]) + '</span>';
        qi2++;
      } else {
        result2 += escapeHtml(keyword[ci3]);
      }
    }
    if (ci3 < keyword.length) result2 += escapeHtml(keyword.substring(ci3));
    return result2;
  }

  // ========== 对话框 DOM 操作 ==========

  function getEl(id) { return document.getElementById(id); }

  function initVirtualList() {
    var historyList = getEl('filterHistoryList');
    if (!historyList) return;
    if (virtualListReady) {
      if (virtualContainer) virtualContainer.style.height = '0px';
      if (virtualContent) virtualContent.innerHTML = '';
      historyList.scrollTop = 0;
      return;
    }
    virtualListReady = true;
    _delegatedBound = false;
    historyList.style.overflowY = 'auto';
    historyList.style.overflowX = 'hidden';
    historyList.style.position = 'relative';
    historyList.innerHTML = '';
    virtualContainer = document.createElement('div');
    virtualContainer.style.cssText = 'position:relative;width:100%;';
    historyList.appendChild(virtualContainer);
    virtualContent = document.createElement('div');
    virtualContent.style.cssText = 'position:absolute;top:0;left:0;right:0;';
    virtualContainer.appendChild(virtualContent);
    bindDelegatedEvents();
    var scrollRafId = 0;
    historyList.addEventListener('scroll', function() {
      if (scrollRafId) return;
      scrollRafId = requestAnimationFrame(function() {
        scrollRafId = 0;
        renderVirtualItems();
      });
    }, { passive: true });
    var resizeRafId = 0;
    window.addEventListener('resize', function() {
      _cachedListHeight = null;
      if (resizeRafId) return;
      resizeRafId = requestAnimationFrame(function() {
        resizeRafId = 0;
        renderVirtualItems();
      });
    });
  }

  function bindDelegatedEvents() {
    if (_delegatedBound || !virtualContent) return;
    _delegatedBound = true;
    virtualContent.addEventListener('mousedown', function(e) {
      if (e.target.classList.contains('keyword-delete-btn')) return;
      if (e.button !== 0) return;
      var item = e.target.closest('.filter-history-item');
      if (!item) return;
      e.preventDefault();
      var idx = parseInt(item.dataset.index, 10);
      if (isNaN(idx)) return;
      mouseDownActive = true;
      dragStartIndex = idx;
      dragMode = isKeywordInTextarea(currentMatchedItems[idx]) ? 'remove' : 'add';
      selectedIndices = {};
      pendingClickIdx = idx;
      mouseDownX = e.clientX;
      mouseDownY = e.clientY;
    });
    virtualContent.addEventListener('click', function(e) {
      var delBtn = e.target.closest('.keyword-delete-btn');
      if (delBtn) {
        e.stopPropagation();
        var kw = delBtn.dataset.keyword;
        if (kw) deleteKeyword(kw);
        refocusSearch();
        return;
      }
      var item = e.target.closest('.filter-history-item');
      if (!item) return;
      e.stopPropagation();
      var idx = parseInt(item.dataset.index, 10);
      if (isNaN(idx)) return;
      if (pendingClickIdx >= 0 && pendingClickIdx === idx) {
        pendingClickIdx = -1;
        toggleKeywordInTextarea(currentMatchedItems[idx]);
        var searchInput = getEl('filterHistorySearchInput');
        if (searchInput) searchInput.value = '';
        currentQuery = '';
        doSearch();
        refocusSearch();
      }
    });
  }

  function renderVirtualItems() {
    if (!virtualContent || !virtualContainer) return;
    var historyList = getEl('filterHistoryList');
    if (!historyList) return;
    var totalItems = currentMatchedItems.length;
    if (totalItems === 0) {
      virtualContainer.style.height = '0px';
      virtualContent.innerHTML = '<div class="filter-history-item" style="position:relative;">无匹配结果</div>';
      return;
    }
    var scrollTop = historyList.scrollTop;
    var viewHeight = historyList.clientHeight || getListHeight();
    var startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE);
    var endIdx = Math.min(totalItems, Math.ceil((scrollTop + viewHeight) / ITEM_HEIGHT) + BUFFER_SIZE);
    virtualContainer.style.height = (totalItems * ITEM_HEIGHT) + 'px';
    virtualContent.style.top = (startIdx * ITEM_HEIGHT) + 'px';
    var html = '';
    for (var i = startIdx; i < endIdx; i++) {
      var kw = currentMatchedItems[i];
      var isSelected = selectedIndices[i] ? ' multi-selected' : '';
      var isInTextarea = isKeywordInTextarea(kw) ? ' in-textarea' : '';
      var isHighlighted = (i === highlightedIndex) ? ' selected' : '';
      html += '<div class="filter-history-item' + isSelected + isInTextarea + isHighlighted + '" '
        + 'data-index="' + i + '" style="height:' + ITEM_HEIGHT + 'px;box-sizing:border-box;">'
        + '<span class="keyword-index">' + (i + 1) + '</span>'
        + '<div class="keyword">' + highlightMatchText(kw, currentQuery) + '</div>'
        + '<span class="keyword-delete-btn" data-keyword="' + escapeHtml(kw) + '" title="删除">&times;</span>'
        + '</div>';
    }
    virtualContent.innerHTML = html;
  }

  function updateHighlight() {
    renderVirtualItems();
    if (highlightedIndex >= 0) {
      var historyList = getEl('filterHistoryList');
      if (!historyList) return;
      var targetTop = highlightedIndex * ITEM_HEIGHT;
      var viewTop = historyList.scrollTop;
      var viewBottom = viewTop + historyList.clientHeight;
      if (targetTop < viewTop || targetTop + ITEM_HEIGHT > viewBottom) {
        historyList.scrollTop = targetTop - historyList.clientHeight / 2 + ITEM_HEIGHT / 2;
      }
    }
  }

  function selectHighlighted() {
    if (highlightedIndex >= 0 && highlightedIndex < currentMatchedItems.length) {
      toggleKeywordInTextarea(currentMatchedItems[highlightedIndex]);
      var searchInput = getEl('filterHistorySearchInput');
      if (searchInput) searchInput.value = '';
      currentQuery = '';
      doSearch();
      refocusSearch();
      return true;
    }
    return false;
  }

  function refreshInTextareaState() { renderVirtualItems(); }

  function refocusSearch() {
    setTimeout(function() {
      var searchInput = getEl('filterHistorySearchInput');
      if (searchInput) searchInput.focus();
    }, 0);
  }

  // ========== 关键词追加/移除/切换 ==========

  function appendToTextarea(keyword) {
    if (isKeywordInTextarea(keyword)) return false;
    var textarea = getEl('filterDialogTextarea');
    if (!textarea) return false;
    var current = textarea.value.trim();
    textarea.value = !current ? keyword : current + '|' + keyword;
    invalidateTextareaCache();
    invalidateSearchCache();
    renderChips();
    return true;
  }

  function removeFromTextarea(keyword) {
    var textarea = getEl('filterDialogTextarea');
    if (!textarea) return false;
    var current = textarea.value.trim();
    if (!current) return false;
    var parts = current.split(/(?<!\\)\|/);
    var newParts = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].trim() !== keyword) newParts.push(parts[i].trim());
    }
    textarea.value = newParts.join('|');
    invalidateTextareaCache();
    invalidateSearchCache();
    renderChips();
    return true;
  }

  function toggleKeywordInTextarea(keyword) {
    if (isKeywordInTextarea(keyword)) { removeFromTextarea(keyword); return 'removed'; }
    else { appendToTextarea(keyword); return 'added'; }
  }

  function batchAppendToTextarea(kws) {
    var appended = 0;
    for (var i = 0; i < kws.length; i++) { if (appendToTextarea(kws[i])) appended++; }
    return appended;
  }

  function removeKeywordFromTextareaByIndex(index) {
    var textarea = getEl('filterDialogTextarea');
    if (!textarea) return;
    var value = textarea.value.trim();
    if (!value) return;
    var parts = value.split(/(?<!\\)\|/);
    if (index >= 0 && index < parts.length) {
      parts.splice(index, 1);
      textarea.value = parts.join('|');
      invalidateTextareaCache();
      renderChips();
      refreshInTextareaState();
    }
  }

  function deleteKeyword(keyword) {
    removeKeyword(keyword);
    if (isKeywordInTextarea(keyword)) removeFromTextarea(keyword);
    var idx = currentMatchedItems.indexOf(keyword);
    if (idx !== -1) currentMatchedItems.splice(idx, 1);
    delete selectedIndices[idx];
    invalidateSearchCache();
    renderVirtualItems();
  }

  // ========== Chip UI ==========

  function renderChips() {
    var chipContainer = getEl('filterChipContainer');
    var chipBar = getEl('filterChipBar');
    var textarea = getEl('filterDialogTextarea');
    if (!chipContainer || !textarea) return;
    chipContainer.innerHTML = '';
    var value = textarea.value.trim();
    if (!value) {
      if (chipBar) chipBar.classList.remove('visible');
      var menu = getEl('chipContextMenu');
      if (menu) menu.style.display = 'none';
      return;
    }
    if (chipBar) chipBar.classList.add('visible');
    var clearAll = document.createElement('span');
    clearAll.className = 'chip-clear-all';
    clearAll.textContent = '✕';
    clearAll.title = '清除所有关键词';
    clearAll.addEventListener('click', function(e) {
      e.stopPropagation();
      textarea.value = '';
      renderChips();
      refreshInTextareaState();
      refocusSearch();
    });
    chipContainer.appendChild(clearAll);
    var parts = value.split(/(?<!\\)\|/);
    for (var i = 0; i < parts.length; i++) {
      var text = parts[i].trim().replace(/\\\|/g, '|');
      if (!text) continue;
      var isNegative = text.charAt(0) === '-' || text.charAt(0) === '!';
      var chip = document.createElement('span');
      chip.className = 'filter-chip ' + (isNegative ? 'negative' : 'positive');
      chip.dataset.index = i;
      chip.innerHTML = '<span class="chip-text">' + escapeHtml(text) + '</span>';
      chipContainer.appendChild(chip);
    }
  }

  function spawnPopParticles(cx, cy, bgColor, parentEl) {
    var particleCount = 8;
    for (var i = 0; i < particleCount; i++) {
      var p = document.createElement('span');
      p.className = 'chip-pop-particle';
      var angle = (Math.PI * 2 / particleCount) * i + (Math.random() - 0.5) * 0.5;
      var dist = 20 + Math.random() * 30;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist;
      var size = 3 + Math.random() * 4;
      p.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;width:' + size + 'px;height:' + size + 'px;'
        + '--dx:' + dx + 'px;--dy:' + dy + 'px;'
        + 'background:' + (i % 2 === 0 ? '#4facfe' : '#00f2fe') + ';';
      parentEl.appendChild(p);
      (function(el) {
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
      })(p);
    }
  }

  function hideChipContextMenu() {
    var menu = getEl('chipContextMenu');
    if (menu) menu.style.display = 'none';
    chipContextTarget = null;
  }

  function showChipMenuToast(msg) {
    var toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:10002;'
      + 'background:rgba(0,0,0,0.8);color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;'
      + 'pointer-events:none;animation:chipToastIn 0.3s ease,chipToastOut 0.3s 1.2s ease forwards;';
    document.body.appendChild(toast);
    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 1600);
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // ========== 搜索缓存 ==========

  function invalidateSearchCache() { searchCache = {}; }

  function getCachedSearch(query) {
    var entry = searchCache[query];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > searchCacheTTL) { delete searchCache[query]; return null; }
    entry.timestamp = Date.now();
    return entry.results;
  }

  function setCachedSearch(query, results) {
    var keys = Object.keys(searchCache);
    if (keys.length >= searchCacheMaxSize) {
      var oldest = null, oldestKey = null;
      for (var i = 0; i < keys.length; i++) {
        if (!oldest || searchCache[keys[i]].timestamp < oldest) {
          oldest = searchCache[keys[i]].timestamp;
          oldestKey = keys[i];
        }
      }
      if (oldestKey) delete searchCache[oldestKey];
    }
    searchCache[query] = { results: results, timestamp: Date.now() };
  }

  // ========== 搜索系统 (fzf → SQL → Worker/JS) ==========

  function initFuzzyMatchWorker() {
    if (fuzzyMatchWorker) return;
    try {
      fuzzyMatchWorker = new Worker('../../workers/fuzzy-match-worker.js');
      fuzzyMatchWorker.onmessage = function(e) {
        fuzzyMatchWorkerBusy = false;
        var msg = e.data;
        if (msg.type === 'fuzzyMatchResult') {
          var results = msg.data.results;
          if (_pendingWorkerQuery === currentQuery || _pendingWorkerQuery === null) {
            currentMatchedItems = results;
            updateSearchStatus('Worker', currentMatchedItems.length, msg.data.elapsed);
            renderSearchResults();
            setCachedSearch(currentQuery, results.slice());
          }
          _pendingWorkerQuery = null;
        }
      };
      fuzzyMatchWorker.onerror = function() {
        fuzzyMatchWorkerBusy = false;
        fuzzyMatchWorker = null;
        if (_pendingWorkerQuery === currentQuery) { _pendingWorkerQuery = null; runMainThreadFuzzyMatch(); }
      };
    } catch (e) { fuzzyMatchWorker = null; }
  }

  function runMainThreadFuzzyMatch(startTime) {
    var jsStart = Date.now();
    currentMatchedItems = fuzzyMatch(currentQuery, getKeywords());
    var jsElapsed = Date.now() - jsStart;
    var totalElapsed = Date.now() - (startTime || jsStart);
    updateSearchStatus('JS', currentMatchedItems.length, totalElapsed);
    renderSearchResults();
    setCachedSearch(currentQuery, currentMatchedItems.slice());
  }

  function runFuzzyMatch(startTime) {
    var allKeywords = getKeywords();
    var WORKER_THRESHOLD = 500;
    if (allKeywords.length > WORKER_THRESHOLD && fuzzyMatchWorker && !fuzzyMatchWorkerBusy) {
      fuzzyMatchWorkerBusy = true;
      _pendingWorkerQuery = currentQuery;
      var textarea = getEl('filterDialogTextarea');
      var textareaContext = getTextareaContext();
      var textareaSet = getTextareaKeywordSet();
      var kwObjs = getKeywordObjects();
      fuzzyMatchWorker.postMessage({
        type: 'fuzzyMatch',
        data: { query: currentQuery, keywords: kwObjs.slice(), textareaContext: textareaContext, textareaSet: textareaSet, now: Date.now() }
      });
    } else {
      runMainThreadFuzzyMatch(startTime);
    }
  }

  function scoreAndSortResults(matchedTexts) {
    var kwMap = getKwObjMap();
    var textareaContext = getTextareaContext();
    var textareaSet = getTextareaKeywordSet();
    var now = Date.now();
    var lowerQ = currentQuery.toLowerCase();
    var tokens = lowerQ.split(/\s+/).filter(function(t) { return t.length > 0; });
    var compactQ = tokens.join('');
    var result = [];
    for (var ri = 0; ri < matchedTexts.length; ri++) {
      var text = matchedTexts[ri];
      var lc = text.toLowerCase();
      var matchScore = 0;
      if (lc === compactQ || lc === lowerQ) matchScore = 50000;
      else if (lc.indexOf(compactQ) === 0 || lc.indexOf(lowerQ) === 0) matchScore = 30000 + (compactQ.length / lc.length) * 5000;
      else if (lc.indexOf(compactQ) !== -1) matchScore = 10000 + (compactQ.length / lc.length) * 3000;
      else matchScore = 10000 + (lowerQ.length / lc.length) * 2000;
      var kwObj = kwMap[text];
      var base = relevanceScore(kwObj, textareaContext, now);
      if (textareaSet[text]) matchScore -= 40000;
      result.push({ keyword: text, score: matchScore + base });
    }
    result.sort(function(a, b) { return b.score - a.score; });
    return result.map(function(x) { return x.keyword; });
  }

  function renderSearchResults() {
    highlightedIndex = -1;
    selectedIndices = {};
    initVirtualList();
    renderVirtualItems();
    var suggestions = getEl('filterHistorySuggestions');
    if (suggestions) { suggestions.style.display = ''; suggestions.classList.remove('hidden'); }
  }

  function updateSearchStatus(engine, count, elapsed) {
    var el = getEl('filterSearchStatus');
    if (!el) return;
    if (!engine) { el.textContent = ''; return; }
    el.textContent = engine + ' ' + count + '条 ' + elapsed + 'ms';
  }

  function doSearch() {
    var searchInput = getEl('filterHistorySearchInput');
    if (searchInput) currentQuery = searchInput.value.trim();
    var cached = getCachedSearch(currentQuery);
    if (cached) { currentMatchedItems = cached; updateSearchStatus('cache', currentMatchedItems.length, 0); renderSearchResults(); return; }
    initFuzzyMatchWorker();
    if (currentQuery) {
      var searchStartTime = Date.now();
      searchFromFzf(currentQuery).then(function(fzfResult) {
        var elapsed = Date.now() - searchStartTime;
        if (fzfResult && !fzfResult.fallback && fzfResult.matched && fzfResult.matched.length > 0) {
          currentMatchedItems = scoreAndSortResults(fzfResult.matched);
          updateSearchStatus('fzf', fzfResult.matched.length, elapsed);
          renderSearchResults();
          setCachedSearch(currentQuery, currentMatchedItems.slice());
          return;
        }
        fallbackToSQL(searchStartTime);
      });
    } else {
      currentMatchedItems = fuzzyMatch('', getKeywords());
      updateSearchStatus('');
      renderSearchResults();
      setCachedSearch('', currentMatchedItems.slice());
    }
  }

  function fallbackToSQL(startTime) {
    var sqlStart = Date.now();
    searchFromDB(currentQuery, 300).then(function(dbResults) {
      var totalElapsed = Date.now() - startTime;
      if (dbResults && dbResults.length > 0) {
        var texts = [];
        for (var ri = 0; ri < dbResults.length; ri++) texts.push(dbResults[ri].text);
        currentMatchedItems = scoreAndSortResults(texts);
        updateSearchStatus('SQL', dbResults.length, totalElapsed);
        setCachedSearch(currentQuery, currentMatchedItems.slice());
        renderSearchResults();
      } else {
        runFuzzyMatch(startTime);
      }
    });
  }

  // ========== 分组模式 ==========

  function renderGroupList() {
    var historyList = getEl('filterHistoryList');
    var suggestions = getEl('filterHistorySuggestions');
    if (!historyList) return;
    if (suggestions) { suggestions.style.display = ''; suggestions.classList.remove('hidden'); }
    historyList.style.overflowY = 'auto';
    historyList.style.height = getListHeight() + 'px';
    historyList.innerHTML = '<div class="group-empty">加载中...</div>';
    var comboPromise = (window.App && window.App.IDB && window.App.IDB.isReady())
      ? window.App.IDB.loadCombos()
      : Promise.resolve({ success: false });
    comboPromise.then(function(comboResult) {
      var html = '';
      if (comboResult && comboResult.success && comboResult.data && comboResult.data.length > 0) {
        for (var ci = 0; ci < comboResult.data.length; ci++) {
          var combo = comboResult.data[ci];
          var cpreview = combo.keywords_original;
          html += '<div class="group-card group-card-combo" data-keywords="' + escapeHtml(combo.keywords_original) + '" data-combo-sorted="' + escapeHtml(combo.keywords_sorted) + '">'
            + '<div class="group-card-header">'
            + '<span class="group-card-name" style="font-weight:400">' + escapeHtml(cpreview) + '</span>'
            + '<span class="group-card-delete" data-combo-sorted="' + escapeHtml(combo.keywords_sorted) + '">&times;</span>'
            + '</div></div>';
        }
      }
      if (!html) html = '<div class="group-empty">暂无分组，使用多关键词过滤后自动保存</div>';
      historyList.innerHTML = html;
      bindGroupCardEvents();
    });
  }

  function bindGroupCardEvents() {
    var historyList = getEl('filterHistoryList');
    if (!historyList) return;
    var cards = historyList.querySelectorAll('.group-card');
    for (var ci = 0; ci < cards.length; ci++) {
      (function(card) {
        if (card._groupBound) return;
        card._groupBound = true;
        card.addEventListener('click', function(e) {
          if (e.target.classList.contains('group-card-delete') && e.target.dataset.comboSorted) {
            e.stopPropagation();
            var keywordsSorted = e.target.dataset.comboSorted;
            if (window.App && window.App.IDB) {
              window.App.IDB.deleteCombo(keywordsSorted).then(function() { renderGroupList(); });
            }
            return;
          }
          var kws = card.dataset.keywords;
          if (kws) {
            var textarea = getEl('filterDialogTextarea');
            if (textarea) textarea.value = '';
            var kwParts = kws.split(/(?<!\\)\|/).map(function(s) { return s.replace(/\\\|/g, '|').trim(); }).filter(Boolean);
            batchAppendToTextarea(kwParts);
            renderChips();
            refreshInTextareaState();
            refocusSearch();
          }
        });
      })(cards[ci]);
    }
  }

  // ========== 对话框打开/关闭 ==========

  function openDialogUnified() {
    var filterDialog = getEl('filterDialog');
    var filterBox = getEl('filterBox');
    var textarea = getEl('filterDialogTextarea');
    if (!filterDialog || !textarea) return;
    if (!textarea._initialized) {
      if (filterBox) textarea.value = filterBox.value || '';
      textarea._initialized = true;
    }
    filterDialog.classList.add('visible');
    renderChips();
    showHistoryList();
    loadKeywords().then(function() {
      var ctx = getTextareaContext();
      var transPromises = ctx.map(function(kw) { return updateTransitionsCache(kw); });
      Promise.all(transPromises).then(function() {
        var freshKeywords = fuzzyMatch('', getKeywords());
        if (freshKeywords.length !== currentMatchedItems.length) {
          currentMatchedItems = freshKeywords;
          renderVirtualItems();
        }
      });
    });
  }

  function showHistoryList() {
    var searchInput = getEl('filterHistorySearchInput');
    var suggestions = getEl('filterHistorySuggestions');
    invalidateSearchCache();
    var allKeywords = getKeywords();
    currentMatchedItems = fuzzyMatch('', allKeywords);
    highlightedIndex = -1;
    selectedIndices = {};
    if (searchInput) searchInput.value = '';
    currentQuery = '';
    if (suggestions) { suggestions.style.display = ''; suggestions.classList.remove('hidden'); }
    initVirtualList();
    renderVirtualItems();
    if (searchInput) searchInput.focus();
  }

  function closeDialog() {
    var filterDialog = getEl('filterDialog');
    var suggestions = getEl('filterHistorySuggestions');
    var textarea = getEl('filterDialogTextarea');
    if (filterDialog) filterDialog.classList.remove('visible');
    if (suggestions) { suggestions.classList.add('hidden'); suggestions.style.display = ''; }
    highlightedIndex = -1;
    selectedIndices = {};
    updateSearchStatus('');
    if (textarea && textarea.value.trim() === '' && typeof cleanFilterData === 'function') {
      cleanFilterData();
    }
    hideChipContextMenu();
  }

  function applyAndClose() {
    var filterBox = getEl('filterBox');
    var textarea = getEl('filterDialogTextarea');
    if (filterBox && textarea) filterBox.value = textarea.value;
    // Auto-save combos
    if (textarea) {
      var value = textarea.value.trim();
      if (value) {
        var parts = value.split(/(?<!\\)\|/).map(function(s) { return s.replace(/\\\|/g, '|').trim(); }).filter(Boolean);
        if (parts.length >= 2 && window.App && window.App.IDB && window.App.IDB.isReady()) {
          var sortedParts = parts.slice().sort();
          var comboHash = sortedParts.join('\0');
          window.App.IDB.saveCombo({ comboHash: comboHash, keywordsSorted: sortedParts.join('|'), keywordsOriginal: value });
        }
      }
    }
    if (typeof applyFilter === 'function') applyFilter();
    closeDialog();
  }

  // ========== 对话框事件绑定 ==========

  function setupDialogEvents() {
    var textarea = getEl('filterDialogTextarea');
    var searchInput = getEl('filterHistorySearchInput');
    var filterDialog = getEl('filterDialog');
    if (!textarea || !searchInput || !filterDialog) return;

    // Block old textarea handlers
    textarea.addEventListener('focus', function(e) { e.stopImmediatePropagation(); e.preventDefault(); }, true);
    textarea.addEventListener('keydown', function(e) {
      e.stopImmediatePropagation();
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); applyAndClose(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
    }, true);

    // Button intercepts
    var expandBtn = getEl('expandFilterBtn');
    if (expandBtn) expandBtn.addEventListener('click', function(e) { e.stopImmediatePropagation(); e.preventDefault(); openDialogUnified(); }, true);
    var closeBtn = getEl('closeFilterDialog');
    if (closeBtn) closeBtn.addEventListener('click', function(e) { e.stopImmediatePropagation(); e.preventDefault(); closeDialog(); }, true);
    var clearBtn = getEl('clearFilterDialog');
    if (clearBtn) clearBtn.addEventListener('click', function(e) {
      e.stopImmediatePropagation(); e.preventDefault();
      if (textarea) textarea.value = '';
      var filterBox = getEl('filterBox');
      if (filterBox) filterBox.value = '';
      if (typeof cleanFilterData === 'function') cleanFilterData();
      if (typeof renderLogLines === 'function') renderLogLines();
      if (typeof updateVisibleLines === 'function') updateVisibleLines();
      renderChips();
    }, true);
    var applyBtn = getEl('applyFilterDialog');
    if (applyBtn) applyBtn.addEventListener('click', function(e) { e.stopImmediatePropagation(); e.preventDefault(); applyAndClose(); }, true);
    filterDialog.addEventListener('click', function(e) { if (e.target === filterDialog) { e.stopImmediatePropagation(); closeDialog(); } }, true);

    // Chip container events
    var chipContainer = getEl('filterChipContainer');
    if (chipContainer) {
      chipContainer.addEventListener('click', function(e) {
        var chip = e.target.closest('.filter-chip');
        if (chip) {
          var index = parseInt(chip.dataset.index);
          var rect = chip.getBoundingClientRect();
          var cx = rect.left + rect.width / 2;
          var cy = rect.top + rect.height / 2;
          chip.classList.add('chip-popping');
          spawnPopParticles(cx, cy, null, chipContainer.parentElement);
          setTimeout(function() { removeKeywordFromTextareaByIndex(index); refocusSearch(); }, 200);
        }
      });
      chipContainer.addEventListener('contextmenu', function(e) {
        var chip = e.target.closest('.filter-chip');
        if (!chip) { hideChipContextMenu(); return; }
        e.preventDefault(); e.stopPropagation();
        var chipText = chip.querySelector('.chip-text');
        chipContextTarget = chipText ? chipText.textContent.trim() : chip.textContent.trim();
        var menu = getEl('chipContextMenu');
        if (!menu) return;
        var rect = chip.getBoundingClientRect();
        var menuW = 160, menuH = 80;
        var x = rect.left + rect.width / 2 - menuW / 2;
        var y = rect.top - menuH - 6;
        if (x < 8) x = 8;
        if (x + menuW > window.innerWidth - 8) x = window.innerWidth - menuW - 8;
        if (y < 8) y = rect.bottom + 6;
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'block';
      });
    }

    // Search input events
    searchInput.addEventListener('input', function() {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(doSearch, 150);
    });
    searchInput.addEventListener('focus', function() {
      if (currentMatchedItems.length === 0) doSearch();
      var suggestions = getEl('filterHistorySuggestions');
      if (suggestions) { suggestions.style.display = ''; suggestions.classList.remove('hidden'); }
    });
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (searchInput.value.trim() !== '') { searchInput.value = ''; doSearch(); }
        else if (textarea && textarea.value.trim() !== '') { textarea.value = ''; renderChips(); refreshInTextareaState(); }
        else { closeDialog(); }
        e.stopPropagation(); return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (currentMatchedItems.length > 0) {
          var targetIdx = (highlightedIndex >= 0) ? highlightedIndex : 0;
          toggleKeywordInTextarea(currentMatchedItems[targetIdx]);
          searchInput.value = ''; currentQuery = '';
          doSearch(); searchInput.focus();
        }
        return;
      }
      if ((e.ctrlKey && e.key === 'j') || e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentMatchedItems.length > 0) { highlightedIndex = Math.min(highlightedIndex + 1, currentMatchedItems.length - 1); updateHighlight(); }
        return;
      }
      if ((e.ctrlKey && e.key === 'k') || e.key === 'ArrowUp') {
        e.preventDefault();
        if (highlightedIndex > 0) { highlightedIndex--; updateHighlight(); }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { applyAndClose(); return; }
        var hasMulti = Object.keys(selectedIndices).length > 0;
        if (hasMulti) {
          var toAppend = [];
          for (var k in selectedIndices) { var ki = parseInt(k); if (ki < currentMatchedItems.length) toAppend.push(currentMatchedItems[ki]); }
          batchAppendToTextarea(toAppend);
          selectedIndices = {}; refreshInTextareaState(); refocusSearch();
        } else if (highlightedIndex >= 0) {
          selectHighlighted();
        } else {
          var rawInput = searchInput.value.trim();
          if (rawInput) {
            var inputParts = rawInput.split(/(?<!\\)\|/).map(function(s) { return s.replace(/\\\|/g, '|').trim(); }).filter(Boolean);
            var appended = batchAppendToTextarea(inputParts);
            if (appended > 0) { renderChips(); refreshInTextareaState(); if (e.shiftKey) addKeywordsFromInput(rawInput); }
            searchInput.value = ''; currentQuery = ''; doSearch(); refocusSearch();
          } else { applyAndClose(); }
        }
        return;
      }
      e.stopPropagation();
    });

    // Group toggle button
    var groupToggle = document.createElement('button');
    groupToggle.className = 'group-mode-toggle';
    groupToggle.textContent = '分组';
    groupToggle.title = '切换分组视图';
    searchInput.parentNode.insertBefore(groupToggle, searchInput);
    groupToggle.addEventListener('click', function() {
      groupMode = !groupMode;
      this.classList.toggle('active', groupMode);
      refocusSearch();
      if (groupMode) { renderGroupList(); }
      else { virtualListReady = false; showHistoryList(); }
    });

    // Document-level drag handlers
    document.addEventListener('mousemove', function(e) {
      if (!mouseDownActive) return;
      if (!dragSelecting) {
        var dx = e.clientX - mouseDownX;
        var dy = e.clientY - mouseDownY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
        dragSelecting = true;
        pendingClickIdx = -1;
      }
      var historyList = getEl('filterHistoryList');
      if (!historyList) return;
      var listRect = historyList.getBoundingClientRect();
      var y = e.clientY - listRect.top + historyList.scrollTop;
      var currentIdx = Math.floor(y / ITEM_HEIGHT);
      currentIdx = Math.max(0, Math.min(currentIdx, currentMatchedItems.length - 1));
      selectedIndices = {};
      var from = Math.min(dragStartIndex, currentIdx), to = Math.max(dragStartIndex, currentIdx);
      for (var r = from; r <= to; r++) selectedIndices[r] = true;
      renderVirtualItems();
    });
    document.addEventListener('mouseup', function() {
      mouseDownActive = false;
      if (!dragSelecting) return;
      dragSelecting = false;
      var count = Object.keys(selectedIndices).length;
      if (count > 1) {
        var dragItems = [];
        for (var k in selectedIndices) { var ki = parseInt(k); if (ki < currentMatchedItems.length) dragItems.push(currentMatchedItems[ki]); }
        if (dragMode === 'add') { batchAppendToTextarea(dragItems); }
        else { for (var di = 0; di < dragItems.length; di++) removeFromTextarea(dragItems[di]); }
        selectedIndices = {}; renderVirtualItems(); refocusSearch();
      } else { selectedIndices = {}; }
    });
  }

  // ========== Chip 右键菜单初始化 ==========

  function setupChipContextMenu() {
    var menu = getEl('chipContextMenu');
    if (menu) return; // already created
    var chipContextMenu = document.createElement('div');
    chipContextMenu.id = 'chipContextMenu';
    chipContextMenu.style.cssText = 'display:none;position:fixed;z-index:10004;background:#fff;border:1px solid #e0e0e0;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);padding:6px 0;min-width:150px;font-size:13px;font-family:inherit;';
    chipContextMenu.innerHTML =
      '<div class="chip-menu-item" data-action="copy" style="padding:8px 18px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background 0.15s;">'
        + '<span style="font-size:14px;">📋</span><span>复制</span></div>'
      + '<div class="chip-menu-item" data-action="save" style="padding:8px 18px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background 0.15s;">'
        + '<span style="font-size:14px;">💾</span><span>加入数据库</span></div>';
    document.body.appendChild(chipContextMenu);
    document.addEventListener('click', hideChipContextMenu);
    chipContextMenu.addEventListener('click', function(e) {
      e.stopPropagation();
      var item = e.target.closest('.chip-menu-item');
      if (!item || !chipContextTarget) return;
      var action = item.dataset.action;
      var text = chipContextTarget;
      if (action === 'copy') {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(function() { fallbackCopy(text); });
        } else { fallbackCopy(text); }
        showChipMenuToast('已复制: ' + text);
      } else if (action === 'save') {
        addKeyword(text).then(function() { showChipMenuToast('已加入数据库: ' + text); }).catch(function() { showChipMenuToast('保存失败: ' + text); });
      }
      hideChipContextMenu();
    });
  }

  // ========== 初始化 ==========

  function handleRemoteKeywordChanged(action, data) {
    console.log('[FilterKeywordHistory] 收到远程关键词变更:', action, data);
    loadKeywords();
  }

  async function init() {
    await loadKeywords();

    if (window.App && window.App.IDB && window.App.IDB.onKeywordChanged) {
      window.App.IDB.onKeywordChanged(handleRemoteKeywordChanged);
    }

    setupChipContextMenu();
    setupDialogEvents();
    dialogReady = true;

    console.log('[FilterKeywordHistory] 初始化完成，关键词:', keywords.length);
  }

  // ========== 'f' 键拦截 ==========

  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'f') {
      e.preventDefault();
      e.stopImmediatePropagation();
      openDialogUnified();
    }
  }, true);

  // ========== 覆盖旧 window 函数 ==========

  window.showFilterHistory = function() {};

  window.getAppFilterHistory = function() {
    return getKeywords();
  };

  window.addToFilterHistory = async function(filterText) {
    try { await addKeywordsFromInput(filterText); } catch (e) { console.error('[FilterKeywordHistory] 保存关键词失败:', e); }
  };

  window.showFilterSuggestions = function() {
    try {
      var filterBox = getEl('filterBox');
      var filterSuggestions = getEl('filterSuggestions');
      if (!filterBox || !filterSuggestions) return;
      var count = showSuggestions(filterBox, filterSuggestions, function() {
        if (typeof applyFilter === 'function') applyFilter();
      });
      window.filterSuggestionsVisible = count > 0;
    } catch (e) {
      console.error('[FilterKeywordHistory] 显示建议失败:', e);
    }
  };

  window.handleFilterKeyDown = function(e) {
    if (!window.filterSuggestionsVisible) return;
    var filterSuggestions = getEl('filterSuggestions');
    if (!filterSuggestions) return;
    window.selectedSuggestionIndex = handleKeyDown(
      e, filterSuggestions,
      window.selectedSuggestionIndex != null ? window.selectedSuggestionIndex : -1
    );
  };

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
    findSimilarKeywords: findSimilarKeywords,
    mergeKeywords: mergeKeywords,
    updateTransitionsCache: updateTransitionsCache,
    searchFromDB: searchFromDB,
    searchFromFzf: searchFromFzf,
    getTextareaContext: getTextareaContext,
    relevanceScore: relevanceScore,
    // Dialog methods (for external use)
    openDialog: openDialogUnified,
    closeDialog: closeDialog
  };

  console.log('[FilterKeywordHistory] 模块已加载（SQLite 模式 + 对话框UI）');
})();
