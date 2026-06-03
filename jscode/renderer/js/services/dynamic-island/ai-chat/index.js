/**
 * AI Agent — UI Layer (v5: Thin UI + No Secrets)
 *
 * 职责: 渲染 + 事件 → 委托 AgentLoop 处理
 * 不参与推理，不硬编码密钥
 *
 * 依赖加载顺序:
 *   api-client → tool-registry → context → permission → hooks →
 *   reviewer → system-tools → sub-agent → task-planner → agent-loop →
 *   teams/* → rich-renderer → index
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  window.App._DI.createAiChat = function() {
    var _DI = window.App._DI;

    /* ═══════════════════════════════════════════════════════════════
       Wiring（依赖注入）
       ═══════════════════════════════════════════════════════════════ */

    var ApiClient = _DI.createApiClient ? _DI.createApiClient() : null;
    var ToolRegistry = _DI.createToolRegistry ? _DI.createToolRegistry() : null;
    var ContextMgr = _DI.createContextManager ? _DI.createContextManager() : null;
    var RichRenderer = _DI.createRichRenderer ? _DI.createRichRenderer() : null;
    if (RichRenderer) RichRenderer.setup();

    if (ToolRegistry) {
      ToolRegistry.init().then(function() {
        if (ContextMgr) {
          ContextMgr.setToolNames(ToolRegistry.getNames());
          ContextMgr.setToolDescriptions(ToolRegistry.getToolDescriptions());
          ContextMgr.setDiscovered(ToolRegistry.getDiscovered());
        }
      });
    }

    var AgentLoop = _DI.createAgentLoop ? _DI.createAgentLoop({
      apiClient: ApiClient, toolRegistry: ToolRegistry, contextMgr: ContextMgr
    }) : null;

    /* ═══════════════════════════════════════════════════════════════
       UI State
       ═══════════════════════════════════════════════════════════════ */

    var _modal = null, _messages = null, _input = null;
    var _sending = false, _history = [], _activeChatId = null;
    var _toolNames = {};
    var _userScrolledUp = false;
    var _lastScrollTop = 0;
    var _selectedMsgs = {};
    var _sidebarCollapsed = true;
    var _contextMenu = null;
    var _fabBtn = null;
    var _abortCtrl = null;

    /* ═══════════════════════════════════════════════════════════════
       Config — 通过 IPC 获取，不硬编码
       ═══════════════════════════════════════════════════════════════ */

    var _configLoaded = false;

    function _loadConfig() {
      if (_configLoaded || !window.electronAPI || !window.electronAPI.aiGetConfig) return;
      _configLoaded = true;
      window.electronAPI.aiGetConfig().then(function(cfg) {
        if (cfg && ApiClient) {
          var current = ApiClient.getConfig();
          if (cfg.baseUrl && !current.baseUrl) ApiClient.updateConfig({ baseUrl: cfg.baseUrl });
          if (cfg.authToken && !current.authToken) ApiClient.updateConfig({ authToken: cfg.authToken });
          if (cfg.model && !current.model) ApiClient.updateConfig({ model: cfg.model });
          _updateModelDisplay();
        }
      }).catch(function() {});
    }

    function _updateModelDisplay() {
      if (!ApiClient) return;
      var model = ApiClient.getConfig().model || '';
      var label = document.getElementById('diAiModelLabel');
      var header = document.getElementById('diAiHeaderModel');
      if (label) label.textContent = model;
      if (header) header.textContent = model;
    }

    /* ═══════════════════════════════════════════════════════════════
       Chat Management
       ═══════════════════════════════════════════════════════════════ */

    var _memLoaded = true;

    function _newChat() {
      var chat = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), title: '新对话', messages: [], createdAt: Date.now() };
      _history.unshift(chat); _activeChatId = chat.id; _renderSidebar(); _renderMessages(); return chat;
    }
    function _getActiveChat() {
      if (!_activeChatId) return _newChat();
      for (var i = 0; i < _history.length; i++) { if (_history[i].id === _activeChatId) return _history[i]; }
      return _newChat();
    }
    function _switchChat(id) { _activeChatId = id; _renderSidebar(); _renderMessages(); if (_input) _input.focus(); }
    function _deleteChat(id) {
      _history = _history.filter(function(c) { return c.id !== id; });
      if (_activeChatId === id) _activeChatId = _history.length > 0 ? _history[0].id : null;
      _renderSidebar(); _renderMessages();
    }

    /* ═══════════════════════════════════════════════════════════════
       Send Message → Agent Loop
       ═══════════════════════════════════════════════════════════════ */

    var _genId = 0;

    function _sendMessage() {
      var text = (_input ? _input.value : '').trim();

      if (text && _isAbortIntent(text) && _sending) {
        _input.value = '';
        if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
        _genId++;
        _finishSending();
        var chatAbort = _getActiveChat();
        var lastAbort = chatAbort.messages[chatAbort.messages.length - 1];
        if (lastAbort && lastAbort.role === 'assistant' && (!lastAbort.content || lastAbort.content === '(已中断)' || lastAbort._streaming)) {
          chatAbort.messages.pop();
        }
        _sending = false;
        _showToast('已停止', 2000);
        return;
      }

      if (_sending) {
        if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
        _genId++;
        _finishSending();
        var chat2 = _getActiveChat();
        var lastMsg = chat2.messages[chat2.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && (!lastMsg.content || lastMsg.content === '(已中断)' || lastMsg._streaming)) {
          chat2.messages.pop();
        }
        _sending = false;
      }
      if (_sending || !AgentLoop) return;
      if (!text) return;
      _genId++;
      _abortCtrl = new AbortController();
      _loadConfig();
      var chat = _getActiveChat();
      _input.value = ''; _input.style.height = 'auto'; _input.focus();
      var now = Date.now();
      console.log('[AiChat] User:', text);
      chat.messages.push({ role: 'user', content: text, time: now });
      if (chat.messages.length === 1) { chat.title = text.slice(0,30)+(text.length>30?'...':''); _renderSidebar(); }
      _appendMsgEl('user', text, now);
      _userScrolledUp = false;
      _scrollBottom(true);
      _showTyping();
      _sending = true;

      _runAgentLoop(chat);
    }

    function _runAgentLoop(chat) {
      var genId = _genId;
      var streamEl = null, _bubble = null, _accText = '';
      var _progressEl = null, _stepNum = 0, _pendingSteps = {};
      var _renderPending = false;
      var _finalized = false;
      var _currentTurn = -1;
      var _lastThinkEl = null;

      function _isStale() { return genId !== _genId; }

      function _scheduleRender() {
        if (_renderPending || _finalized) return;
        _renderPending = true;
        requestAnimationFrame(function() {
          _renderPending = false;
          if (_finalized) return;
          if (_bubble && _accText) _bubble.innerHTML = _renderMd(_accText);
          _scrollBottom();
        });
      }

      function _ensureProgress() {
        _hideTyping();
        if (_progressEl) return;
        _progressEl = document.createElement('div');
        _progressEl.className = 'di-ai-progress';
        _messages.appendChild(_progressEl);
      }

      function _addThinkStep(text, turn) {
        _ensureProgress();
        _stepNum++;
        var stepEl = document.createElement('div');
        stepEl.className = 'di-ai-progress-step di-ai-progress-step--thinking';
        var preview = text.length > 100 ? text.slice(0, 100) + '...' : text;
        stepEl.innerHTML = '<div class="di-ai-progress-step__header">'
          + '<span class="di-ai-progress-step__num">' + _stepNum + '</span>'
          + '<span class="di-ai-progress-step__icon">\uD83D\uDCAD</span>'
          + '<span class="di-ai-progress-step__title">Thinking (Turn ' + (turn + 1) + ')</span>'
          + '</div>'
          + '<div class="di-ai-progress-step__think">' + _esc(preview) + '</div>';
        _progressEl.appendChild(stepEl);
        _lastThinkEl = stepEl;
        _scrollBottom();
      }

      function _addToolStep(id, name, input) {
        _ensureProgress();
        _stepNum++;
        var argsStr = '';
        if (input) {
          if (input.command) argsStr = input.command;
          else if (input.pattern) argsStr = input.pattern;
          else if (input.path) argsStr = input.path;
          else argsStr = JSON.stringify(input);
        }
        if (argsStr.length > 120) argsStr = argsStr.slice(0, 120) + '...';
        var stepEl = document.createElement('div');
        stepEl.className = 'di-ai-progress-step di-ai-progress-step--running';
        stepEl.dataset.stepId = id;
        stepEl.innerHTML = '<div class="di-ai-progress-step__header">'
          + '<span class="di-ai-progress-step__num">' + _stepNum + '</span>'
          + '<span class="di-ai-progress-step__icon">\uD83D\uDD27</span>'
          + '<span class="di-ai-progress-step__title">' + _esc(name) + '</span>'
          + '<span class="di-ai-progress-step__args">' + _esc(argsStr) + '</span>'
          + '<span class="di-ai-progress-step__spinner"></span>'
          + '</div>';
        _progressEl.appendChild(stepEl);
        _pendingSteps[id] = stepEl;
        _scrollBottom();
      }

      function _updateToolStep(id, success, output) {
        var stepEl = _pendingSteps[id];
        if (!stepEl) return;
        stepEl.classList.remove('di-ai-progress-step--running');
        stepEl.classList.add(success ? 'di-ai-progress-step--done' : 'di-ai-progress-step--error');
        var spinner = stepEl.querySelector('.di-ai-progress-step__spinner');
        if (spinner) spinner.className = success ? 'di-ai-progress-step__check' : 'di-ai-progress-step__cross';
        if (output) {
          var resultEl = document.createElement('div');
          resultEl.className = 'di-ai-progress-step__result';
          var lines = output.split('\n');
          var summary = lines.slice(0, 5).join('\n');
          if (lines.length > 5) summary += '\n... (\u5171 ' + lines.length + ' \u884C)';
          resultEl.textContent = summary;
          stepEl.appendChild(resultEl);
        }
        _scrollBottom();
      }

      AgentLoop.run(chat.messages, {
        onThinking: function(thinkContent, turn) {
          if (_isStale()) return;
          _currentTurn = turn;
          _addThinkStep(thinkContent, turn);
        },
        onText: function(token) {
          if (_isStale()) return;
          _hideTyping();
          _accText += token;
          if (!streamEl) {
            var idx = _nextMsgIndex();
            streamEl = document.createElement('div'); streamEl.className = 'di-ai-msg di-ai-msg--assistant';
            streamEl.dataset.msgIndex = idx;
            streamEl.innerHTML = '<div class="di-ai-avatar">AI</div><div class="di-ai-body"><div class="di-ai-bubble di-ai-bubble--streaming"></div>'
              + '<div class="di-ai-meta">'
              + '<button class="di-ai-select-btn" title="选中">\u52FE\u9009</button>'
              + '<button class="di-ai-copy-btn" title="复制">复制</button>'
              + '</div></div>';
            _messages.appendChild(streamEl);
            _bubble = streamEl.querySelector('.di-ai-bubble');
          } else if (!_bubble) {
            var body = streamEl.querySelector('.di-ai-body');
            if (body && !body.querySelector('.di-ai-bubble')) {
              var meta = body.querySelector('.di-ai-meta');
              var bubbleDiv = document.createElement('div');
              bubbleDiv.className = 'di-ai-bubble di-ai-bubble--streaming';
              if (meta) body.insertBefore(bubbleDiv, meta);
              else body.appendChild(bubbleDiv);
              _bubble = bubbleDiv;
            }
          }
          _scheduleRender();
        },
        onComplete: function(text) {
          if (_isStale()) return;
          _finalized = true;
          if (text && text !== '(已中断)') {
            if (typeof text === 'string') {
              chat.messages.push({ role: 'assistant', content: text, time: Date.now() });
            }
          }
          if (_progressEl) { _progressEl.remove(); _progressEl = null; }
          if (_bubble) {
            _bubble.classList.remove('di-ai-bubble--streaming');
            if (text && typeof text === 'string') {
              _bubble.innerHTML = _renderMd(text);
            }
            if (RichRenderer) RichRenderer.postProcess(_bubble);
          }
          _finishSending();
        },
        onToolCall: function(toolUses, classified, approve) {
          if (_isStale()) return;
          for (var ti = 0; ti < toolUses.length; ti++) {
            _toolNames[toolUses[ti].id] = toolUses[ti].name;
            _addToolStep(toolUses[ti].id, toolUses[ti].name, toolUses[ti].input);
          }
          if (streamEl) { streamEl.remove(); streamEl = null; }
          _accText = ''; _bubble = null; _finalized = false;
          approve(toolUses);
        },
        onToolResult: function(id, success, output) {
          if (_isStale()) return;
          _updateToolStep(id, success, output);
        },
        onError: function(err) {
          if (_isStale()) return;
          _finalized = true;
          console.error('[AiAgent] Error:', err);
          if (_progressEl) { _progressEl.remove(); _progressEl = null; }
          _appendMsgEl('assistant', '\u8BF7\u6C42\u5931\u8D25: ' + (err.message || '\u672A\u77E5\u9519\u8BEF'), Date.now());
          _finishSending();
        },
        onMaxTurns: function() {
          if (_isStale()) return;
          _finalized = true;
          if (_progressEl) { _progressEl.remove(); _progressEl = null; }
          _appendMsgEl('assistant', '(\u5DF2\u8FBE\u5230\u6700\u5927\u5BF9\u8BDD\u8F6E\u6B21\uFF0C\u8BF7\u91CD\u65B0\u63D0\u95EE)', Date.now());
          _finishSending();
        }
      }, _abortCtrl ? _abortCtrl.signal : null);
    }


    /* ═══════════════════════════════════════════════════════════════
       Sidebar
       ═══════════════════════════════════════════════════════════════ */

    function _toggleSidebar() {
      _sidebarCollapsed = !_sidebarCollapsed;
      var panel = document.getElementById('diAiPanel');
      var toggleBtn = document.getElementById('diAiSidebarToggle');
      if (panel) panel.classList.toggle('di-ai-sidebar-collapsed', _sidebarCollapsed);
      if (toggleBtn) toggleBtn.classList.toggle('di-ai-toggle-collapsed', _sidebarCollapsed);
    }

    /* ═══════════════════════════════════════════════════════════════
       Context Menu
       ═══════════════════════════════════════════════════════════════ */

    function _showContextMenu(e) {
      _hideContextMenu();
      var count = Object.keys(_selectedMsgs).length;
      var menu = document.createElement('div');
      menu.id = 'diAiContextMenu';
      menu.className = 'di-ai-context-menu';
      menu.innerHTML = '<div class="di-ai-ctx-item' + (count === 0 ? ' di-ai-ctx-disabled' : '') + '" data-action="copy">复制选中 (' + count + ')</div>'
        + '<div class="di-ai-ctx-item" data-action="selectAll">全选</div>'
        + '<div class="di-ai-ctx-item' + (count === 0 ? ' di-ai-ctx-disabled' : '') + '" data-action="clear">取消选择</div>';
      document.body.appendChild(menu);
      _contextMenu = menu;
      var x = e.clientX, y = e.clientY;
      var mw = menu.offsetWidth, mh = menu.offsetHeight;
      if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
      if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
      menu.style.left = x + 'px'; menu.style.top = y + 'px';
      menu.addEventListener('click', function(ev) {
        var item = ev.target.closest('.di-ai-ctx-item');
        if (!item || item.classList.contains('di-ai-ctx-disabled')) return;
        var action = item.dataset.action;
        if (action === 'copy') _copySelected();
        else if (action === 'selectAll') _selectAllMessages();
        else if (action === 'clear') _clearSelection();
        _hideContextMenu();
      });
    }
    function _hideContextMenu() { if (_contextMenu) { _contextMenu.remove(); _contextMenu = null; } }
    function _selectAllMessages() {
      if (!_messages) return;
      var msgs = _messages.querySelectorAll('.di-ai-msg');
      for (var i = 0; i < msgs.length; i++) {
        var idx = parseInt(msgs[i].dataset.msgIndex);
        if (!isNaN(idx)) { _selectedMsgs[idx] = true; msgs[i].classList.add('di-ai-selected'); }
      }
      _renderCopyBar();
    }

    /* ═══════════════════════════════════════════════════════════════
       UI Rendering
       ═══════════════════════════════════════════════════════════════ */

    function _renderSidebar() {
      var list = document.getElementById('diAiHistory'); if (!list) return; list.innerHTML = '';
      for (var i = 0; i < _history.length; i++) {
        var c = _history[i];
        list.innerHTML += '<div class="di-ai-chat-item' + (c.id === _activeChatId ? ' active' : '') + '" data-id="' + c.id + '">'
          + '<span class="di-ai-chat-icon">\u{1F4AC}</span>'
          + '<span class="di-ai-chat-title">' + _esc(c.title || '新对话') + '</span>'
          + '<button class="di-ai-chat-del" data-id="' + c.id + '">\u00D7</button></div>';
      }
    }

    function _renderMessages() {
      if (!_messages) return; _messages.innerHTML = '';
      var chat = _getActiveChat();
      if (!chat || chat.messages.length === 0) {
        _renderEnvInfo();
        return;
      }
      for (var i = 0; i < chat.messages.length; i++) {
        var m = chat.messages[i];
        _appendMsgEl(m.role, typeof m.content === 'string' ? m.content : '', m.time);
      }
      _scrollBottom();
    }

    function _renderEnvInfo() {
      if (!_messages) return;
      var modelName = ApiClient ? ApiClient.getConfig().model : '';
      var toolNames = ToolRegistry ? ToolRegistry.getNames() : [];
      var discovered = ToolRegistry ? ToolRegistry.getDiscovered() : {};
      var searchTools = [];
      var fileTools = [];
      var netTools = [];
      var sysTools = [];
      var devTools = [];
      var extTools = [];
      for (var ti = 0; ti < toolNames.length; ti++) {
        var n = toolNames[ti];
        if (['rg', 'fd', 'grep', 'es'].indexOf(n) !== -1) searchTools.push(n);
        else if (['awk', 'cut', 'sort', 'tr', 'rev', 'shuf', 'wc'].indexOf(n) !== -1) sysTools.push(n);
        else if (['head', 'tail', 'cat', 'read', 'stat', 'xxd', 'sha256sum'].indexOf(n) !== -1) sysTools.push(n);
        else if (['ls', 'cp', 'mv', 'rm', 'mkdir', 'find', 'diff', 'du', 'iconv'].indexOf(n) !== -1) fileTools.push(n);
        else if (['sed', 'write', 'tar', '7z'].indexOf(n) !== -1) fileTools.push(n);
        else if (n === 'curl') netTools.push(n);
        else if (['node', 'git'].indexOf(n) !== -1) devTools.push(n);
        else extTools.push(n);
      }
      var libs = ['echarts', 'mermaid', 'katex', 'highlight.js', 'marked', 'diff2html', 'papaparse', 'jszip'];

      var html = '<div class="di-ai-welcome">'
        + '<div class="di-ai-welcome-icon">\u2726</div>'
        + '<div class="di-ai-welcome-title">有什么可以帮助你的？</div>'
        + '<div class="di-ai-welcome-sub">' + _esc(modelName || '未配置') + '</div>'
        + '<div class="di-ai-env-card">';

      var sections = [
        { label: 'Search', tools: searchTools },
        { label: 'Process', tools: sysTools },
        { label: 'File', tools: fileTools },
        { label: 'Net', tools: netTools },
        { label: 'Dev', tools: devTools },
        { label: 'Lib', tools: libs }
      ];
      if (extTools.length > 0) sections.push({ label: 'Env', tools: extTools });
      for (var si = 0; si < sections.length; si++) {
        if (sections[si].tools.length === 0) continue;
        html += '<div class="di-ai-env-section"><div class="di-ai-env-label">' + sections[si].label + '</div><div class="di-ai-env-tags">';
        for (var ti2 = 0; ti2 < sections[si].tools.length; ti2++) html += '<span class="di-ai-env-tag">' + sections[si].tools[ti2] + '</span>';
        html += '</div></div>';
      }

      var discNames = Object.keys(discovered);
      if (discNames.length > 0) {
        html += '<div class="di-ai-env-section"><div class="di-ai-env-label">Discovered</div><div class="di-ai-env-tags">';
        for (var di = 0; di < discNames.length; di++) html += '<span class="di-ai-env-tag di-ai-env-tag-discovered">' + discNames[di] + '</span>';
        html += '</div></div>';
      }

      html += '</div>'
        + '<div class="di-ai-welcome-hints">'
        + '<span data-hint="帮我分析日志中的 error">分析日志错误</span>'
        + '<span data-hint="统计 battery 相关行数">统计关键词</span>'
        + '<span data-hint="画一个日志处理流程图">画流程图</span>'
        + '<span data-hint="生成 HTML 可视化报告">生成报告</span>'
        + '</div></div>';
      _messages.innerHTML = html;
    }

    var _msgIndexCounter = 0;
    function _nextMsgIndex() { return _msgIndexCounter++; }

    function _appendMsgEl(role, text, time) {
      if (!_messages) return;
      var idx = _nextMsgIndex();
      var html = '<div class="di-ai-msg di-ai-msg--' + role + '" data-msg-index="' + idx + '">'
        + '<div class="di-ai-avatar">' + (role === 'user' ? 'U' : 'AI') + '</div>'
        + '<div class="di-ai-body"><div class="di-ai-bubble">' + (role === 'assistant' ? _renderMd(text) : _esc(text)) + '</div>'
        + '<div class="di-ai-meta">'
        + '<button class="di-ai-select-btn" title="选中">\u52FE\u9009</button>'
        + '<button class="di-ai-copy-btn" title="复制">复制</button>'
        + (time ? '<span class="di-ai-time">' + _fmtTime(time) + '</span>' : '')
        + '</div></div></div>';
      _messages.insertAdjacentHTML('beforeend', html);
      if (role === 'assistant' && RichRenderer) {
        var bubbleEl = _messages.lastElementChild.querySelector('.di-ai-bubble');
        if (bubbleEl) RichRenderer.postProcess(bubbleEl);
      }
      _scrollBottom();
    }

    var _toastTimers = [];

    function _showToast(msg, duration) {
      var container = document.getElementById('diAiToasts');
      if (!container) return;
      var el = document.createElement('div');
      el.className = 'di-ai-toast';
      el.textContent = msg;
      container.appendChild(el);
      requestAnimationFrame(function() { el.classList.add('di-ai-toast--visible'); });
      var timer = setTimeout(function() {
        el.classList.remove('di-ai-toast--visible');
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
      }, duration || 3000);
      _toastTimers.push(timer);
      while (container.children.length > 8) {
        container.removeChild(container.firstChild);
      }
    }

    function _logToPanel(msg) {
      var icon = '';
      if (msg.charCodeAt(0) === 0x1F4AD) icon = 'think';
      else if (msg.charCodeAt(0) === 0x1F527) icon = 'tool';
      else if (msg.charCodeAt(0) === 0x2705) icon = 'ok';
      else if (msg.charCodeAt(0) === 0x274C) icon = 'fail';
      var _t = msg.replace(/^[\u{1F000}-\u{1FFFF}\u2705\u274C]\s*/u, '');
      var dur = icon === 'think' ? 2000 : 3000;
      _showToast(msg, dur);
    }

    function _renderMd(text) { if (RichRenderer) return RichRenderer.renderStream(text); if (typeof window.marked !== 'undefined') { try { return window.marked.parse(text); } catch(ignore) { void ignore; } } return _esc(text).replace(/\n/g,'<br>'); }
    function _isAtBottom() { if (!_messages) return true; return _messages.scrollHeight - _messages.scrollTop - _messages.clientHeight < 80; }
    function _scrollBottom(force) { if (!_messages) return; if (!force && _userScrolledUp) return; _userScrolledUp = false; _messages.scrollTop = _messages.scrollHeight; }
    function _showTyping() {
      if (!_messages) return;
      var el = document.createElement('div'); el.className = 'di-ai-msg di-ai-msg--assistant'; el.id = 'diAiTyping';
      el.innerHTML = '<div class="di-ai-avatar">AI</div><div class="di-ai-body"><div class="di-ai-bubble di-ai-typing">'
        + '<span></span><span></span><span></span></div></div>';
      _messages.appendChild(el); _scrollBottom(true);
    }
    function _hideTyping() { var el = document.getElementById('diAiTyping'); if (el) el.remove(); }
    function _finishSending() { _hideTyping(); _sending = false; _abortCtrl = null; }

    /* ═══════════════════════════════════════════════════════════════
       DOM
       ═══════════════════════════════════════════════════════════════ */

    function createModal() {
      _modal = document.createElement('div'); _modal.id = 'diAiModal';
      var modelName = ApiClient ? ApiClient.getConfig().model : '';
      _modal.innerHTML = '<div id="diAiPanel">'
        + '<div id="diAiToasts"></div>'
        + '<div id="diAiSidebar"><div id="diAiSidebarHeader"><span>对话</span><button id="diAiNewChat" title="新对话">+</button></div>'
        + '<div id="diAiHistory"></div><div id="diAiSidebarFooter">'
        + '<select id="diAiProvider" class="di-ai-provider-sel">'
        + '<option value="internal">GLM-5.1 (智谱)</option>'
        + '<option value="xuanji" selected>Ali-DeepSeek</option></select>'
        + '<div class="di-ai-model" id="diAiModelLabel">' + _esc(modelName) + '</div></div></div>'
        + '<div id="diAiMain">'
        + '<div id="diAiHeader">'
        + '<div class="di-ai-header-left">'
        + '<button id="diAiSidebarToggle" title="折叠侧边栏"></button>'
        + '<span class="di-ai-header-title">AI</span>'
        + '<span class="di-ai-header-model" id="diAiHeaderModel">' + _esc(modelName) + '</span>'
        + '</div>'
        + '<div class="di-ai-header-right">'
        + '<button id="diAiScan" title="扫描系统环境工具">&#x1F50D;</button>'
        + '<button id="diAiClear" title="清除对话上下文"></button>'
        + '<button id="diAiMin" title="最小化"></button>'
        + '<button id="diAiMax" title="最大化"></button>'
        + '<button id="diAiClose" title="关闭"></button>'
        + '</div>'
        + '</div>'
        + '<div id="diAiMessages"></div>'
        + '<div id="diAiFooter"><div class="di-ai-footer-row"><textarea id="diAiInput" placeholder="输入消息...   Enter 发送 \u00B7 Shift+Enter 换行 \u00B7 Esc 关闭" rows="1"></textarea>'
        + '</div></div></div></div>';
      document.body.appendChild(_modal);
      _messages = document.getElementById('diAiMessages'); _input = document.getElementById('diAiInput');

      document.getElementById('diAiPanel').classList.add('di-ai-fullscreen', 'di-ai-sidebar-collapsed');
      document.getElementById('diAiSidebarToggle').classList.add('di-ai-toggle-collapsed');
      document.getElementById('diAiSidebarToggle').addEventListener('click', _toggleSidebar);
      document.getElementById('diAiClear').addEventListener('click', function() { _resetChat(); _renderSidebar(); _renderMessages(); _showToast('已清除上下文', 2000); });
      document.getElementById('diAiScan').addEventListener('click', _scanEnv);
      document.getElementById('diAiMin').addEventListener('click', hide);
      document.getElementById('diAiClose').addEventListener('click', close);
      document.getElementById('diAiMax').addEventListener('click', function() {
        var panel = document.getElementById('diAiPanel');
        if (panel) panel.classList.toggle('di-ai-fullscreen');
      });
      document.getElementById('diAiNewChat').addEventListener('click', _newChat);
      document.getElementById('diAiProvider').addEventListener('change', function() {
        var v = this.value;
        if (v === 'xuanji') {
          ApiClient.switchProvider('xuanji');
        } else if (v === 'internal') {
          ApiClient.switchProvider('internal');
        }
        _loadConfig();
        setTimeout(_updateModelDisplay, 500);
      });
      _input.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendMessage(); } });
      _modal.addEventListener('click', function(e) { if (e.target === _modal) close(); });
      document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && _modal && _modal.classList.contains('visible')) hide(); });

      _messages.addEventListener('scroll', function() {
        if (!_messages) return;
        var newTop = _messages.scrollTop;
        if (newTop < _lastScrollTop - 30) {
          _userScrolledUp = true;
        } else if (_isAtBottom()) {
          _userScrolledUp = false;
        }
        _lastScrollTop = newTop;
      });

      var sidebar = document.getElementById('diAiHistory');
      sidebar.addEventListener('click', function(e) {
        var del = e.target.closest('.di-ai-chat-del'); if (del) { e.stopPropagation(); _deleteChat(del.dataset.id); return; }
        var item = e.target.closest('.di-ai-chat-item'); if (item) _switchChat(item.dataset.id);
      });

      _messages.addEventListener('click', function(e) {
        var fileLink = e.target.closest('a[href^="file://"]');
        if (fileLink) {
          e.preventDefault();
          var raw = fileLink.getAttribute('href');
          var fpath = raw.replace(/^file:\/\//, '');
          if (fpath.charAt(0) === '/' && fpath.length > 2 && fpath.charAt(2) === ':') fpath = fpath.slice(1);
          fpath = fpath.replace(/\//g, '\\');
          var isHtml = /\.html?$/i.test(fpath);
          if (isHtml && window.electronAPI && window.electronAPI.aiFileRead) {
            window.electronAPI.aiFileRead(fpath).then(function(r) {
              if (r && r.success && r.content) {
                if (RichRenderer) RichRenderer.previewHtml(r.content);
              }
            }).catch(function() {});
          } else if (!isHtml && window.electronAPI && window.electronAPI.openHtmlWindow) {
            window.electronAPI.openHtmlWindow(fpath);
          }
          return;
        }
        var hint = e.target.closest('.di-ai-welcome-hints span');
        if (hint && _input) { _input.value = hint.dataset.hint || hint.textContent; _input.focus(); return; }
        var copyBtn = e.target.closest('.di-ai-copy-btn');
        if (copyBtn) {
          var b = copyBtn.closest('.di-ai-body').querySelector('.di-ai-bubble');
          if (b && navigator.clipboard) { navigator.clipboard.writeText(b.textContent); copyBtn.textContent='\u2713 \u5DF2\u590D\u5236'; setTimeout(function(){copyBtn.textContent='\u590D\u5236';},1500); }
          return;
        }
        var selBtn = e.target.closest('.di-ai-select-btn');
        if (selBtn) {
          var msg = selBtn.closest('.di-ai-msg');
          if (msg && msg.dataset.msgIndex) {
            var idx = parseInt(msg.dataset.msgIndex);
            if (_selectedMsgs[idx]) { delete _selectedMsgs[idx]; msg.classList.remove('di-ai-selected'); selBtn.textContent='\u52FE\u9009'; }
            else { _selectedMsgs[idx] = true; msg.classList.add('di-ai-selected'); selBtn.textContent='\u53D6\u6D88'; }
            _renderCopyBar();
          }
          return;
        }
      });

      _messages.addEventListener('contextmenu', function(e) { e.preventDefault(); _showContextMenu(e); });
      document.addEventListener('click', function(e) { if (_contextMenu && !_contextMenu.contains(e.target)) _hideContextMenu(); });
    }

    function _isAbortIntent(text) {
      var t = text.replace(/\s+/g, '');
      var patterns = /^(算了|不要了|停下|停止|取消|别做了|不用了|撤销|取消吧|别干了|别画了|别写了|停|停吧|不做了|不了|不要画了|不要写了|算了不做了|算了不要了|别弄了)$/;
      return t.length <= 10 && patterns.test(t);
    }

    function _resetChat() {
      if (_sending && _abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
      _sending = false;
      _genId++;
      _history = [];
      _activeChatId = null;
      _selectedMsgs = {};
      _userScrolledUp = false;
    }

    function _scanEnv() {
      if (!ToolRegistry || !ToolRegistry.scanAndRegister) { _showToast('扫描不可用', 2000); return; }
      var btn = document.getElementById('diAiScan');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.textContent = '...'; }
      ToolRegistry.scanAndRegister().then(function(result) {
        if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.textContent = '\uD83D\uDD0D'; }
        if (ContextMgr) {
          ContextMgr.setToolNames(ToolRegistry.getNames());
          ContextMgr.setToolDescriptions(ToolRegistry.getToolDescriptions());
          ContextMgr.setDiscovered(ToolRegistry.getDiscovered());
        }
        _renderEnvInfo();
        var names = Object.keys(result.discovered || {});
        _showToast('扫描完成: ' + names.length + ' 个外部工具' + (result.count > 0 ? ' (+' + result.count + ' 新增)' : ''), 3000);
      }).catch(function(e) {
        if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.textContent = '\uD83D\uDD0D'; }
        _showToast('扫描失败: ' + e.message, 3000);
      });
    }

    function _esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function _fmtTime(ts) { var d = new Date(ts); return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }
    function _renderCopyBar() {
      var bar = document.getElementById('diAiCopyBar');
      var count = Object.keys(_selectedMsgs).length;
      if (count === 0) { if (bar) bar.remove(); return; }
      if (!bar) {
        bar = document.createElement('div'); bar.id = 'diAiCopyBar';
        bar.innerHTML = '<span id="diAiCopyCount"></span><button id="diAiCopySel">复制选中</button><button id="diAiClearSel">取消</button>';
        document.getElementById('diAiFooter').prepend(bar);
        document.getElementById('diAiCopySel').addEventListener('click', _copySelected);
        document.getElementById('diAiClearSel').addEventListener('click', _clearSelection);
      }
      document.getElementById('diAiCopyCount').textContent = '已选 ' + count + ' 条';
    }
    function _copySelected() {
      var texts = [], indices = Object.keys(_selectedMsgs).map(Number).sort(function(a,b){return a-b;});
      for (var i = 0; i < indices.length; i++) {
        var el = _messages.querySelector('.di-ai-msg[data-msg-index="' + indices[i] + '"]');
        if (!el) continue;
        var role = el.classList.contains('di-ai-msg--user') ? 'User' : 'AI';
        var bubble = el.querySelector('.di-ai-bubble');
        if (bubble) texts.push('[' + role + '] ' + bubble.textContent);
      }
      if (texts.length > 0 && navigator.clipboard) { navigator.clipboard.writeText(texts.join('\n\n')); var b = document.getElementById('diAiCopySel'); if (b) { b.textContent = '已复制'; setTimeout(function(){b.textContent='复制选中';},1500); } }
    }
    function _clearSelection() {
      _selectedMsgs = {};
      var sel = _messages.querySelectorAll('.di-ai-selected');
      for (var i = 0; i < sel.length; i++) { sel[i].classList.remove('di-ai-selected'); var sb = sel[i].querySelector('.di-ai-select-btn'); if (sb) sb.textContent = '\u52FE\u9009'; }
      _renderCopyBar();
    }

    function open() { if (!_modal) createModal(); _modal.classList.add('visible'); _hideFab(); _loadConfig(); _renderSidebar(); _renderMessages(); setTimeout(function(){if(_input)_input.focus();},200); }
    function hide() { if (_modal) _modal.classList.remove('visible'); _hideContextMenu(); _showFab(); }
    function close() { if (_modal) _modal.classList.remove('visible'); _hideContextMenu(); _showFab(); _resetChat(); }
    function init() { _showFab(); }
    function destroy() { _hideContextMenu(); _hideFab(); if (_modal && _modal.parentNode) _modal.parentNode.removeChild(_modal); _modal=null;_messages=null;_input=null;_history=[];_activeChatId=null; }

    function _showFab() {
      if (_fabBtn) return;
      _fabBtn = document.createElement('button');
      _fabBtn.id = 'diAiFab';
      _fabBtn.title = '打开 AI 对话';
      _fabBtn.textContent = 'AI';
      var dragging = false, moved = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
      _fabBtn.addEventListener('mousedown', function(e) {
        dragging = true; moved = false; startX = e.clientX; startY = e.clientY;
        var rect = _fabBtn.getBoundingClientRect(); origLeft = rect.left; origTop = rect.top; e.preventDefault();
      });
      document.addEventListener('mousemove', function(e) {
        if (!dragging || !_fabBtn) return;
        var dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        if (moved) { _fabBtn.style.left = (origLeft + dx) + 'px'; _fabBtn.style.top = (origTop + dy) + 'px'; _fabBtn.style.right = 'auto'; _fabBtn.style.bottom = 'auto'; }
      });
      document.addEventListener('mouseup', function() { dragging = false; });
      _fabBtn.addEventListener('click', function() { if (!moved) open(); });
      document.body.appendChild(_fabBtn);
    }
    function _hideFab() { if (!_fabBtn) return; _fabBtn.remove(); _fabBtn = null; }

    return { init: init, open: open, hide: hide, close: close, destroy: destroy };
  };
})();
