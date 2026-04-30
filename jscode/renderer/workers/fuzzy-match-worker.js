/**
 * 模糊匹配 Worker — 将关键词模糊搜索从主线程移到 Worker
 * 当关键词数量较大（>500）时使用，避免阻塞 UI
 *
 * 输入: { type: 'fuzzyMatch', data: { query, keywords, textareaContext, textareaSet } }
 * 输出: { type: 'fuzzyMatchResult', data: { results: string[], elapsed: number } }
 */

// ========== 综合评分（频率 × 时效） ==========
// 注：马尔可夫转移分需要外部 transitionsCacheMap 数据，Worker 中不计算

function relevanceScore(kwObj, textareaContext, now) {
  if (!kwObj) return 0;
  var freqScore = Math.log((kwObj.count || 1) + 1) * 200;
  var decaySec = (now - (kwObj.lastUsed || 0)) / 1000;
  var timeScore = Math.exp(-decaySec / 86400) * 1000;
  return freqScore + timeScore;
}

// ========== 按综合评分排序（无搜索词时使用） ==========

function sortByRelevance(candidates, kwObjMap, textareaContext, textareaSet, now) {
  var scored = [];
  for (var c = 0; c < candidates.length; c++) {
    var kwObj = kwObjMap[candidates[c].text] || null;
    var score = relevanceScore(kwObj, textareaContext, now);
    if (textareaSet[candidates[c].text]) score -= 2000;
    scored.push({ keyword: candidates[c].text, score: score });
  }
  scored.sort(function(a, b) { return b.score - a.score; });
  return scored.map(function(s) { return s.keyword; });
}

// ========== 模糊匹配（与主线程 filter-keyword-history.js 逻辑一致） ==========

function fuzzyMatch(query, candidates, kwObjMap, textareaContext, textareaSet, now) {
  if (!query || !query.trim()) {
    return sortByRelevance(candidates, kwObjMap, textareaContext, textareaSet, now);
  }

  var lowerQ = query.toLowerCase();
  var tokens = lowerQ.split(/\s+/).filter(function(t) { return t.length > 0; });
  var compactQ = tokens.join('');

  var result = [];

  for (var c = 0; c < candidates.length; c++) {
    var candidate = candidates[c];
    var text = candidate.text;
    var lc = text.toLowerCase();
    var base = relevanceScore(candidate, textareaContext, now);
    var matched = false;
    var matchScore = 0;

    // 精确匹配
    if (lc === compactQ || lc === lowerQ) {
      matchScore = 50000;
      matched = true;
    }
    // 前缀匹配
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
        matchScore = totalTokenScore / tokens.length;
        matched = true;
      }
    }

    if (matched) {
      // 已选入 textarea 的关键词降权
      if (textareaSet[text]) matchScore -= 40000;
      result.push({ keyword: text, score: matchScore + base });
    }
  }

  result.sort(function(a, b) { return b.score - a.score; });
  return result.map(function(s) { return s.keyword; });
}

// ========== Worker 消息处理 ==========

self.onmessage = function(e) {
  var msg = e.data;
  if (msg.type === 'fuzzyMatch') {
    var startTime = Date.now();
    var d = msg.data;
    var keywords = d.keywords || [];
    var query = d.query || '';
    var textareaContext = d.textareaContext || [];
    var textareaSet = d.textareaSet || {};
    var now = d.now || Date.now();

    // 构建 kwObjMap
    var kwObjMap = {};
    for (var i = 0; i < keywords.length; i++) {
      kwObjMap[keywords[i].text] = keywords[i];
    }

    var results = fuzzyMatch(query, keywords, kwObjMap, textareaContext, textareaSet, now);
    var elapsed = Date.now() - startTime;

    self.postMessage({
      type: 'fuzzyMatchResult',
      data: { results: results, elapsed: elapsed }
    });
  }
};
