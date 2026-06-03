/**
 * AI Agent — Agent Loop (v8: Simplified ReAct)
 *
 * Think → Stream → Act → Observe → Respond
 * 纯逻辑 · 零 DOM · 回调通信 · AbortController
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  window.App._DI.createAgentLoop = function(deps) {
    var ApiClient = deps.apiClient || null;
    var ToolRegistry = deps.toolRegistry || null;
    var ContextMgr = deps.contextMgr || null;

    var _maxTurns = 100;
    var _maxTokens = 50000;
    var _maxToolsPerTurn = 10;

    function setMaxTurns(n) { _maxTurns = n; }
    function setMaxTokens(n) { _maxTokens = n; }
    function setMaxToolsPerTurn(n) { _maxToolsPerTurn = n; }

    function run(messages, callbacks, abortSignal) {
      return _loop(messages, 0, callbacks || {}, abortSignal);
    }

    function _loop(messages, turn, cb, abortSignal) {
      if (abortSignal && abortSignal.aborted) {
        if (cb.onComplete) cb.onComplete(null, messages);
        return Promise.resolve();
      }

      if (turn >= _maxTurns) {
        console.log('[AgentLoop] maxTurns reached');
        if (cb.onMaxTurns) cb.onMaxTurns();
        return Promise.resolve();
      }

      if (!ApiClient || !ToolRegistry) {
        if (cb.onError) cb.onError(new Error('Agent 未加载'));
        return Promise.resolve();
      }

      var tools = ToolRegistry.getApiDefinitions();
      var apiMessages = ContextMgr ? ContextMgr.toApiMessages(messages) : messages;
      var trimmed = ContextMgr ? ContextMgr.trimToBudget(apiMessages, _maxTokens) : apiMessages;

      console.log('[AgentLoop] turn=' + turn + ' msgs=' + trimmed.length + ' tools=' + tools.length);

      return ApiClient.send(trimmed, tools, function(token) {
        if (cb.onText) cb.onText(token);
      }, abortSignal).then(function(data) {
        if (abortSignal && abortSignal.aborted) {
          if (cb.onComplete) cb.onComplete(null, messages);
          return;
        }

        var content = data.content || [];
        var textParts = [];
        var toolUses = [];
        var thinkingParts = [];

        for (var i = 0; i < content.length; i++) {
          var block = content[i];
          if (block.type === 'thinking') thinkingParts.push(block.thinking || '');
          else if (block.type === 'text') textParts.push(block.text);
          else if (block.type === 'tool_use') toolUses.push({ id: block.id, name: block.name, input: block.input });
        }

        if (thinkingParts.length > 0 && cb.onThinking) {
          cb.onThinking(thinkingParts.join('\n'), turn);
        }

        var fullText = textParts.join('\n');
        var textToolCalls = _parseToolBlocks(fullText);

        if (textToolCalls.length > 0) {
          for (var ti = 0; ti < textToolCalls.length; ti++) {
            toolUses.push(textToolCalls[ti]);
          }
          fullText = _stripToolBlocks(fullText);
        }

        console.log('[AgentLoop] <-- turn=' + turn + ' think=' + thinkingParts.length + ' text=' + (fullText ? 1 : 0) + ' tools=' + toolUses.length);

        if (toolUses.length > 0) {
          if (toolUses.length > _maxToolsPerTurn) {
            console.warn('[AgentLoop] 工具调用超限: ' + toolUses.length + ' > ' + _maxToolsPerTurn + ', 截断');
            toolUses = toolUses.slice(0, _maxToolsPerTurn);
          }

          messages.push({ role: 'assistant', content: fullText || '(调用工具)', time: Date.now() });

          if (cb.onToolCall) {
            var classified = { auto: toolUses, confirm: [], deny: [] };
            cb.onToolCall(toolUses, classified, function(approvedTools) {
              _executeTools(messages, toolUses, approvedTools, turn, cb, abortSignal);
            });
            return;
          }

          _executeTools(messages, toolUses, toolUses, turn, cb, abortSignal);
          return;
        }

        if (fullText) {
          messages.push({ role: 'assistant', content: fullText, time: Date.now() });

          if (_needsToolUse(messages) && turn < 2) {
            console.log('[AgentLoop] Auto-retry: model gave text-only but user asked for action');
            messages.push({ role: 'user', content: '[系统提示] 请用 ```tool 代码块调用工具来执行操作，不要只给文字建议。', time: Date.now() });
            return _loop(messages, turn + 1, cb, abortSignal);
          }

          if (cb.onComplete) cb.onComplete(fullText, messages);
          return;
        }

        if (cb.onComplete) cb.onComplete('', messages);
      }).catch(function(err) {
        if (err.name === 'AbortError') {
          if (cb.onComplete) cb.onComplete(null, messages);
          return;
        }
        console.error('[AgentLoop] API error:', err.message);
        if (cb.onError) cb.onError(err);
      });
    }

    function _parseToolBlocks(text) {
      var results = [];
      if (!text) return results;
      var regex = /```tool\s*\n([\s\S]*?)```/g;
      var match;
      while ((match = regex.exec(text)) !== null) {
        var json = match[1].trim();
        try {
          var obj = JSON.parse(json);
          if (obj.name) {
            results.push({ id: 'txt_' + Date.now() + '_' + results.length, name: obj.name, input: obj.input || {} });
          }
        } catch (parseErr) {
          console.warn('[AgentLoop] Invalid tool JSON:', json.slice(0, 100), parseErr.message);
        }
      }
      return results;
    }

    function _stripToolBlocks(text) {
      if (!text) return text;
      return text.replace(/```tool\s*\n[\s\S]*?```/g, '').trim();
    }

    function _needsToolUse(messages) {
      var userMsgs = [];
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') userMsgs.unshift(messages[i].content);
        if (userMsgs.length >= 3) break;
      }
      var recentText = userMsgs.join(' ').toLowerCase();
      var actionPatterns = [
        /搜索|过滤|查找|查找|列出|读取|查看|分析|统计|运行|执行|帮我|用\w+|给我|显示|画|绘制/,
        /rg|grep|awk|find|cat|head|tail|ls|read|sort|wc|fd/,
        /文件|目录|日志|路径|电量|电压|电流|曲线/,
        /battery|filter|search|list|read|show|run|exec|draw|plot|chart/
      ];
      for (var p = 0; p < actionPatterns.length; p++) {
        if (actionPatterns[p].test(recentText)) return true;
      }
      return false;
    }

    function _executeTools(messages, allTools, approvedTools, turn, cb, abortSignal) {
      var executeList = [];
      var skippedNames = [];

      for (var ti = 0; ti < allTools.length; ti++) {
        var tu = allTools[ti];
        var approved = approvedTools.some(function(a) { return a.id === tu.id; });
        if (approved) {
          executeList.push(tu);
        } else {
          skippedNames.push(tu.name);
        }
      }

      if (executeList.length === 0) {
        if (skippedNames.length > 0) {
          messages.push({ role: 'user', content: '[系统] 已跳过工具: ' + skippedNames.join(', '), time: Date.now() });
        }
        return _loop(messages, turn + 1, cb, abortSignal);
      }

      ToolRegistry.executeAll(executeList).then(function(results) {
        var resultLines = [];
        for (var ri = 0; ri < results.length; ri++) {
          var r = results[ri];
          var output = r.result.success ? (r.result.stdout || '(无输出)') : '错误: ' + (r.result.stderr || r.result.error || '未知错误');
          resultLines.push('--- ' + r.name + ' ---\n' + output);
          console.log('[AgentLoop] ' + r.name + ' -> ' + (r.result.success ? 'OK' : 'FAIL') + ' ' + output.slice(0, 60));
          if (cb.onToolResult) cb.onToolResult(r.id, r.result.success, output);
        }

        var failCount = results.filter(function(r) { return !r.result.success; }).length;
        if (failCount > 0) console.warn('[AgentLoop] ' + failCount + ' tool(s) failed');

        var resultText = '[工具执行结果]\n' + resultLines.join('\n\n');
        if (skippedNames.length > 0) {
          resultText += '\n\n[已跳过: ' + skippedNames.join(', ') + ']';
        }
        messages.push({ role: 'user', content: resultText, time: Date.now() });
        _loop(messages, turn + 1, cb, abortSignal);
      }).catch(function(err) {
        console.error('[AgentLoop] executeAll error:', err.message);
        messages.push({ role: 'user', content: '[工具执行异常] ' + err.message, time: Date.now() });
        _loop(messages, turn + 1, cb, abortSignal);
      });
    }

    return Object.freeze({
      run: run,
      setMaxTurns: setMaxTurns,
      setMaxTokens: setMaxTokens,
      setMaxToolsPerTurn: setMaxToolsPerTurn
    });
  };
})();
