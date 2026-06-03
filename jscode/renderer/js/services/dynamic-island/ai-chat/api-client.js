/**
 * AI Agent — API Client (v5: Xuanji custom format)
 *
 * 玄机 API 自定义格式，非标准 OpenAI。
 * - POST /chatgpt/completions
 * - 请求: { model, messages, sessionId, stream, max_tokens, tools? }
 * - 响应: { code:0, data:{ content, toolCalls } }
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  window.App._DI.createApiClient = function(config) {
    config = config || {};

    var _baseUrl = config.baseUrl || '';
    var _authToken = config.authToken || '';
    var _model = config.model || '';
    var _maxTokens = config.maxTokens || 8192;
    var _timeoutMs = config.timeoutMs || 300000;
    var _maxRetries = 3;
    var _retryBaseDelay = 1000;
    var _callCount = 0;
    var _sessionId = '';

    var PROVIDERS = {
      xuanji: { baseUrl: 'http://chatgpt-api.vmic.xyz', path: '/chatgpt/completions', model: 'Ali-DeepSeek-V4-Pro', provider: 'aliyun', appId: '1181852079', appKey: 'FDreDyMirvabDhrr', supportsTools: true },
      internal: { baseUrl: 'http://chatgpt-api.vmic.xyz', path: '/chatgpt/completions', model: 'GLM-5.1', provider: 'zhipu', appId: '1181852079', appKey: 'FDreDyMirvabDhrr', supportsTools: false }
    };

    var _path = '/chatgpt/completions';
    var _provider = 'aliyun';
    var _appId = '';
    var _appKey = '';
    var _supportsTools = false;

    function _newSessionId() {
      _sessionId = 'js-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    }
    _newSessionId();

    /* ═══════════════════════════════════════════════════════════════
       网关签名
       ═══════════════════════════════════════════════════════════════ */

    function _genNonce() {
      var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      var s = '';
      for (var i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
      return s;
    }

    function _genSignHeaders(path) {
      if (!_appId) return {};
      var method = 'POST';
      var timestamp = String(Math.floor(Date.now() / 1000));
      var nonce = _genNonce();

      var signedHeadersStr = 'x-ai-gateway-app-id:' + _appId + '\nx-ai-gateway-timestamp:' + timestamp + '\nx-ai-gateway-nonce:' + nonce;
      var signingStr = method + '\n' + path + '\n\n' + _appId + '\n' + timestamp + '\n' + signedHeadersStr;
      var signature = _hmacSha256Base64(_appKey, signingStr);

      return {
        'X-AI-GATEWAY-APP-ID': _appId,
        'X-AI-GATEWAY-TIMESTAMP': timestamp,
        'X-AI-GATEWAY-NONCE': nonce,
        'X-AI-GATEWAY-SIGNED-HEADERS': 'x-ai-gateway-app-id;x-ai-gateway-timestamp;x-ai-gateway-nonce',
        'X-AI-GATEWAY-SIGNATURE': signature
      };
    }

    function _hmacSha256Base64(key, msg) {
      var keyBytes = new TextEncoder().encode(key);
      var msgBytes = new TextEncoder().encode(msg);
      return _hmacBase64(keyBytes, msgBytes);
    }

    /* ═══════════════════════════════════════════════════════════════
       Message format conversion (internal → Xuanji)
       ═══════════════════════════════════════════════════════════════ */

    function _toXuanjiMessages(messages) {
      var result = [];
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        if (typeof m.content === 'string') {
          result.push({ role: m.role, content: m.content });
        } else if (Array.isArray(m.content)) {
          var textParts = [];
          var toolUses = [];
          var toolResults = [];
          for (var j = 0; j < m.content.length; j++) {
            var block = m.content[j];
            if (block.type === 'text') textParts.push(block.text);
            else if (block.type === 'tool_use') toolUses.push(block);
            else if (block.type === 'tool_result') toolResults.push(block);
          }
          if (toolResults.length > 0) {
            for (var k = 0; k < toolResults.length; k++) {
              result.push({ role: 'tool', tool_call_id: toolResults[k].tool_use_id, content: toolResults[k].content || '' });
            }
          } else {
            var msg = { role: m.role };
            if (textParts.length > 0) msg.content = textParts.join('\n'); else msg.content = null;
            if (toolUses.length > 0) {
              msg.tool_calls = toolUses.map(function(tu) {
                return { id: tu.id, type: 'function', function: { name: tu.name, arguments: JSON.stringify(tu.input) } };
              });
            }
            result.push(msg);
          }
        } else {
          result.push({ role: m.role, content: '' });
        }
      }
      return result;
    }

    function _toXuanjiTools(tools) {
      return tools.map(function(t) {
        return { type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } };
      });
    }

    /* ═══════════════════════════════════════════════════════════════
       Send
       ═══════════════════════════════════════════════════════════════ */

    function _ensureConfig() {
      if (_baseUrl && _model) return Promise.resolve();
      if (window.electronAPI && window.electronAPI.aiGetConfig) {
        return window.electronAPI.aiGetConfig().then(function(cfg) {
          if (cfg) {
            if (!_baseUrl) _baseUrl = cfg.baseUrl || '';
            if (!_authToken) _authToken = cfg.authToken || '';
            if (!_model) _model = cfg.model || '';
          }
        }).catch(function() {});
      }
      return Promise.resolve();
    }

    function _genRequestId() {
      return 'js-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    }

    function send(messages, tools, onToken, abortSignal) {
      _callCount++;
      return _ensureConfig().then(function() {
        var requestId = _genRequestId();
        var payload = {
          model: _model,
          provider: _provider,
          messages: _toXuanjiMessages(messages),
          sessionId: _sessionId,
          requestId: requestId,
          incremental: true
        };
        if (tools && tools.length > 0 && _supportsTools) payload.tools = _toXuanjiTools(tools);
        console.log('[ApiClient] Sending: model=' + _model + ' provider=' + _provider + ' msgs=' + payload.messages.length + ' tools=' + (payload.tools ? payload.tools.length : 'none') + ' supportsTools=' + _supportsTools);
        return _fetch(_path, payload, requestId, onToken, 0, abortSignal);
      });
    }

    function _fetch(path, payload, requestId, cb, attempt, abortSignal) {
      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); }, _timeoutMs);

      if (abortSignal) {
        abortSignal.addEventListener('abort', function() { controller.abort(); }, { once: true });
      }

      var headers = {
        'Content-Type': 'application/json'
      };
      if (_appId && _appKey) {
        var b64Key = _base64(new TextEncoder().encode(_appKey));
        headers['Authorization'] = 'Bearer sk-xuanji-' + _appId + '-' + b64Key;
      } else if (_authToken) {
        headers['Authorization'] = 'Bearer ' + _authToken;
      }
      var gwHeaders = _genSignHeaders(path);
      for (var hk in gwHeaders) { headers[hk] = gwHeaders[hk]; }

      var qs = requestId ? '?requestId=' + encodeURIComponent(requestId) : '';
      return fetch(_baseUrl + path + qs, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      }).then(function(res) {
        clearTimeout(timer);
        if (!res.ok) {
          return res.text().then(function(body) {
            var err = new Error('HTTP ' + res.status + ': ' + body.slice(0, 500));
            err.status = res.status;
            throw err;
          });
        }
        return res.json();
      }).then(function(data) {
        console.log('[ApiClient] Raw response keys:', Object.keys(data.data || {}).join(', '), 'code:', data.code);
        return _parseResponse(data, cb);
      }).catch(function(err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') throw err;
        if (attempt < _maxRetries && (!err.status || err.status >= 500)) {
          var delay = _retryBaseDelay * Math.pow(2, attempt) + Math.random() * 1000;
          console.warn('[ApiClient] Retry ' + (attempt + 1) + '/' + _maxRetries);
          return new Promise(function(resolve) {
            setTimeout(function() { resolve(_fetch(path, payload, requestId, cb, attempt + 1, abortSignal)); }, delay);
          });
        }
        throw err;
      });
    }

    /* ═══════════════════════════════════════════════════════════════
       Response parsing (Xuanji format → internal)
       ═══════════════════════════════════════════════════════════════ */

    function _parseResponse(data, cb) {
      var d = data.data || data;
      var code = data.code !== undefined ? data.code : (d.code !== undefined ? d.code : 0);
      if (code !== 0) {
        var errMsg = data.msg || d.msg || data.message || d.message || 'unknown';
        throw new Error('API error: ' + errMsg);
      }

      var content = [];

      if (d.reasoningContent) {
        content.push({ type: 'thinking', thinking: d.reasoningContent });
      }

      if (d.content) {
        content.push({ type: 'text', text: d.content });
        if (cb) cb(d.content);
      }

      if (d.contentList && Array.isArray(d.contentList)) {
        for (var ci = 0; ci < d.contentList.length; ci++) {
          var cItem = d.contentList[ci];
          if (cItem.type === 'tool_use' || cItem.type === 'function') {
            var cInput = {};
            if (typeof cItem.input === 'string') {
              try { cInput = JSON.parse(cItem.input); } catch(ig3) { void ig3; }
            } else if (typeof cItem.input === 'object' && cItem.input !== null) {
              cInput = cItem.input;
            }
            content.push({ type: 'tool_use', id: cItem.id || ('cl_' + Date.now() + '_' + ci), name: cItem.name, input: cInput });
          } else if (cItem.type === 'text' && cItem.text && !d.content) {
            content.push({ type: 'text', text: cItem.text });
          }
        }
      }

      var toolCalls = d.toolCalls || d.toolCall || d.tool_calls || d.functionCall || null;
      if (toolCalls && Array.isArray(toolCalls)) {
        for (var i = 0; i < toolCalls.length; i++) {
          var tc = toolCalls[i];
          var func = (tc.function || tc);
          var input = {};
          if (typeof func.arguments === 'string') {
            try { input = JSON.parse(func.arguments); } catch(ignore) { void ignore; }
          } else if (typeof func.arguments === 'object' && func.arguments !== null) {
            input = func.arguments;
          } else if (func.parameters) {
            input = func.parameters;
          }
          content.push({ type: 'tool_use', id: tc.id || ('tool_' + Date.now() + '_' + i), name: func.name || tc.name, input: input });
        }
      } else if (typeof toolCalls === 'object' && toolCalls !== null && !Array.isArray(toolCalls)) {
        var func2 = toolCalls.function || toolCalls;
        var input2 = {};
        if (typeof func2.arguments === 'string') {
          try { input2 = JSON.parse(func2.arguments); } catch(ig2) { void ig2; }
        } else if (typeof func2.arguments === 'object' && func2.arguments !== null) {
          input2 = func2.arguments;
        } else if (func2.parameters) {
          input2 = func2.parameters;
        }
        if (func2.name || toolCalls.name) {
          content.push({ type: 'tool_use', id: toolCalls.id || ('tool_' + Date.now()), name: func2.name || toolCalls.name, input: input2 });
        }
      }

      var toolCount = content.filter(function(b) { return b.type === 'tool_use'; }).length;
      console.log('[ApiClient] Response: text=' + (d.content ? 'yes' : 'no') + ' tools=' + toolCount
        + ' contentList=' + (d.contentList ? d.contentList.length : 0)
        + ' toolCalls=' + (d.toolCalls ? (Array.isArray(d.toolCalls) ? d.toolCalls.length : 1) : 0));

      return { content: content, stopReason: d.finishReason || d.stopReason || 'stop' };
    }

    /* ═══════════════════════════════════════════════════════════════
       Config
       ═══════════════════════════════════════════════════════════════ */

    function switchProvider(name, cfg) {
      var p = PROVIDERS[name];
      if (!p && !cfg) return false;
      if (cfg) {
        _baseUrl = cfg.baseUrl || _baseUrl;
        _authToken = cfg.authToken || _authToken;
        _model = cfg.model || _model;
      } else {
        _baseUrl = p.baseUrl;
        _path = p.path || '/chatgpt/completions';
        _model = p.model;
        _provider = p.provider || 'aliyun';
        _appId = p.appId || '';
        _appKey = p.appKey || '';
        _supportsTools = !!p.supportsTools;
      }
      _newSessionId();
      console.log('[ApiClient] Provider: ' + name + ' -> ' + _baseUrl + _path + ' model=' + _model);
      return true;
    }

    function getConfig() {
      return { baseUrl: _baseUrl, model: _model, maxTokens: _maxTokens, timeoutMs: _timeoutMs };
    }

    function updateConfig(cfg) {
      if (cfg.baseUrl) _baseUrl = cfg.baseUrl;
      if (cfg.authToken) _authToken = cfg.authToken;
      if (cfg.model) _model = cfg.model;
      if (cfg.maxTokens) _maxTokens = cfg.maxTokens;
      if (cfg.timeoutMs) _timeoutMs = cfg.timeoutMs;
    }

    function getCallCount() { return _callCount; }

    // Init default: xuanji (public API, verified working)
    switchProvider('xuanji');

    /* ═══════════════════════════════════════════════════════════════
       HMAC-SHA256 → Base64 (pure JS)
       ═══════════════════════════════════════════════════════════════ */

    function _hmacBase64(keyBytes, msgBytes) {
      var blockSize = 64;
      var k = keyBytes;
      if (k.length > blockSize) k = _sha256(k);
      var ki = new Uint8Array(blockSize), ko = new Uint8Array(blockSize);
      for (var i = 0; i < blockSize; i++) { ki[i] = 0x36; ko[i] = 0x5c; }
      for (var j = 0; j < k.length; j++) { ki[j] ^= k[j]; ko[j] ^= k[j]; }
      var inner = _sha256(_concat(ki, msgBytes));
      return _base64(_sha256(_concat(ko, inner)));
    }

    function _sha256(data) {
      var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
      var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
      var bytes = (data instanceof Uint8Array) ? data : new Uint8Array(data);
      var bitLen = bytes.length * 8;
      var padLen = (((bytes.length + 9 + 63) >> 6) << 6);
      var padded = new Uint8Array(padLen);
      padded.set(bytes); padded[bytes.length] = 0x80;
      var view = new DataView(padded.buffer);
      view.setUint32(padLen - 4, bitLen, false);
      for (var chunk = 0; chunk < padLen; chunk += 64) {
        var W = new Uint32Array(64);
        var cv = new DataView(padded.buffer, chunk, 64);
        for (var t = 0; t < 16; t++) W[t] = cv.getUint32(t * 4, false);
        for (var t2 = 16; t2 < 64; t2++) {
          var s0 = (_r(W[t2-15],7)^_r(W[t2-15],18)^(W[t2-15]>>>3));
          var s1 = (_r(W[t2-2],17)^_r(W[t2-2],19)^(W[t2-2]>>>10));
          W[t2] = (W[t2-16] + s0 + W[t2-7] + s1) | 0;
        }
        var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
        for (var t3 = 0; t3 < 64; t3++) {
          var S1=(_r(e,6)^_r(e,11)^_r(e,25)), ch=(e&f)^((~e)&g), temp1=(h+S1+ch+K[t3]+W[t3])|0;
          var S0_a=(_r(a,2)^_r(a,13)^_r(a,22)), maj=(a&b)^(a&c)^(b&c), temp2=(S0_a+maj)|0;
          h=g;g=f;f=e;e=(d+temp1)|0;d=c;c=b;b=a;a=(temp1+temp2)|0;
        }
        H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;
        H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
      }
      var out = new Uint8Array(32), ov = new DataView(out.buffer);
      for (var ti = 0; ti < 8; ti++) ov.setUint32(ti*4, H[ti], false);
      return out;
    }
    function _r(x, n) { return (x >>> n) | (x << (32 - n)); }
    function _concat(a, b) { var c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }
    function _base64(bytes) {
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', r = '';
      for (var i = 0; i < bytes.length; i += 3) {
        var b1 = bytes[i], b2 = bytes[i+1] || 0, b3 = bytes[i+2] || 0;
        r += chars[b1>>2] + chars[((b1&3)<<4)|(b2>>4)] + (i+1<bytes.length?chars[((b2&15)<<2)|(b3>>6)]:'=') + (i+2<bytes.length?chars[b3&63]:'=');
      }
      return r;
    }

    return Object.freeze({
      send: send,
      switchProvider: switchProvider,
      getConfig: getConfig,
      updateConfig: updateConfig,
      getCallCount: getCallCount,
      newSession: _newSessionId
    });
  };
})();
