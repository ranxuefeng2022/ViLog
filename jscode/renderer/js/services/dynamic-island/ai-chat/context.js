/**
 * AI Agent — Context Manager (v2.1)
 *
 * 统一消息格式转换 + CJK感知 Token 估算 + 智能截断
 * 纯函数模块，零 DOM 依赖
 *
 * v2.1: 修复 tool_use/tool_result 配对断裂问题
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  window.App._DI.createContextManager = function() {

    var CJK_RANGE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;

    function estimateTokens(text) {
      if (!text) return 0;
      var str = String(text);
      var cjk = 0, ascii = 0;
      for (var i = 0; i < str.length; i++) {
        if (CJK_RANGE.test(str.charAt(i))) cjk++;
        else ascii++;
      }
      return Math.ceil(cjk * 1.5 + ascii / 4);
    }

    function estimateMessagesTokens(messages) {
      var total = 0;
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        if (typeof m.content === 'string') total += estimateTokens(m.content);
        else if (Array.isArray(m.content)) {
          for (var j = 0; j < m.content.length; j++) {
            var block = m.content[j];
            if (block.type === 'text' && block.text) total += estimateTokens(block.text);
            else if (block.type === 'tool_use') total += estimateTokens(JSON.stringify(block.input));
            else if (block.type === 'tool_result') total += estimateTokens(block.content || '');
            else if (block.type === 'thinking' && block.thinking) total += estimateTokens(block.thinking);
          }
        }
      }
      return total;
    }

    var _toolNames = [];
    var _toolDescriptions = '';
    var _discovered = {};

    var FIXED_TOOLS_PROMPT =
      '\n\n## 固化工具(始终可用)\n'
      + '以下工具随应用分发，无需额外安装:\n'
      + '- rg: 超高速全文搜索(ripgrep)\n'
      + '- fd: 快速文件查找\n'
      + '- es: Everything 秒搜文件名(Windows)\n'
      + '- busybox 内置: grep/awk/sed/head/tail/wc/cut/sort/uniq/cat/ls/cp/mv/rm/mkdir/diff/find/curl/du/stat/tar/tr/iconv/xxd/sha256sum/rev/shuf\n'
      + '- 7z: 7-Zip 压缩解压\n'
      + '- node: Node.js 运行时(如PATH中存在)\n'
      + '- git: 版本控制(如PATH中存在)\n'
      + '- read/write: 内置文件读写';

    var LIB_PROMPT =
      '\n\n写 HTML 可视化报告时可引用的本地库(相对于项目根目录):\n'
      + '- lib/echarts.min.js — 交互式图表(折线/柱状/饼图/散点/热力图等)\n'
      + '- lib/diff2html.min.js + lib/diff2html.min.css — 代码差异可视化\n'
      + '- lib/papaparse.min.js — CSV 解析\n'
      + '- lib/jszip.min.js — ZIP 压缩\n'
      + '- lib/mermaid.min.js — 流程图/时序图/甘特图\n'
      + '- lib/katex.min.js + lib/katex.min.css — 数学公式\n'
      + '- lib/marked.min.js — Markdown 渲染\n'
      + '- lib/highlight.min.js — 代码高亮';

    function setToolNames(names) {
      _toolNames = names || [];
    }

    function setToolDescriptions(desc) {
      _toolDescriptions = desc || '';
    }

    function setDiscovered(disc) {
      _discovered = disc || {};
    }

    var TOOL_PROTOCOL =
      '\n\n## 工具调用协议(必须遵守)\n'
      + '你需要使用工具时，必须在回复中插入以下格式(可多次):\n'
      + '```tool\n'
      + '{"name":"工具名","input":{参数对象}}\n'
      + '```\n'
      + '\n重要规则:\n'
      + '- 需要读取/搜索/操作文件时，必须用 ```tool 调用工具，不要只说"可以用rg搜索"\n'
      + '- 不要给用户命令建议，直接帮用户执行\n'
      + '- 调用工具后停止生成，等待工具结果再继续\n'
      + '- 路径参数必须用绝对路径\n'
      + '- 不要在 ```tool 块中放任何其他内容\n'
      + '- 每次可调用多个工具(多个 ```tool 代码块)\n'
      + '\n示例对话:\n'
      + '用户: 当前目录有哪些文件\n'
      + '助手: 我来查看一下当前目录的文件。\n'
      + '```tool\n'
      + '{"name":"ls","input":{"path":"E:\\\\JS"}}\n'
      + '```\n'
      + '\n用户: 用rg搜索battery关键词\n'
      + '助手: 好的，我来搜索battery关键词。\n'
      + '```tool\n'
      + '{"name":"rg","input":{"pattern":"battery","path":"E:\\\\JS\\\\mem\\\\chunk-tmp\\\\wc7","max_count":50}}\n'
      + '```';

    function _buildSystemPrompt() {
      var parts = ['你是日志分析助手，拥有命令行工具可直接操作文件。用户提到文件路径时，必须用工具读取/搜索，不要凭空编造内容。'];
      parts.push('本环境直接支持 ```mermaid 图表渲染，画图直接输出代码块，不需要用工具。');
      if (_toolDescriptions) {
        parts.push('\n## 可用工具\n' + _toolDescriptions);
      } else if (_toolNames.length > 0) {
        parts.push('\n可用工具: ' + _toolNames.join(', '));
      }
      parts.push(FIXED_TOOLS_PROMPT);
      var discNames = Object.keys(_discovered);
      if (discNames.length > 0) {
        parts.push('\n\n## 环境发现工具(通过扫描检测)\n以下工具在当前系统 PATH 中发现，可通过 ai-system-exec 调用:\n');
        for (var i = 0; i < discNames.length; i++) {
          var ver = _discovered[discNames[i]] || '';
          parts.push('- ' + discNames[i] + (ver ? ': ' + ver.split('\n')[0] : ''));
        }
      }
      parts.push('\n\n工具使用策略: 用户提到文件路径→用read/head/tail/rg读取; 需要搜索→用rg; 需要统计→用awk/wc/sort; 需要操作文件→用对应工具; 需要系统信息→用发现的环境工具; 主动使用工具，不要只给建议。');
      parts.push(TOOL_PROTOCOL);
      parts.push(LIB_PROMPT);
      return parts.join('\n');
    }

    function toApiMessages(messages) {
      var result = [{ role: 'system', content: _buildSystemPrompt() }];
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        if (Array.isArray(m.content)) {
          result.push({ role: m.role, content: m.content });
          continue;
        }
        if (typeof m.content === 'string') {
          result.push({ role: m.role, content: m.content });
          continue;
        }
        result.push({ role: m.role, content: '' });
      }
      return _fixMessagePairs(result);
    }

    function _fixMessagePairs(messages) {
      if (messages.length <= 1) return messages;
      var fixed = [messages[0]];

      for (var i = 1; i < messages.length; i++) {
        var m = messages[i];
        var prev = fixed[fixed.length - 1];

        if (prev.role === 'assistant' && m.role === 'assistant') {
          fixed.push({ role: 'user', content: '(继续)' });
        }

        if (m.role === 'user' && prev.role === 'user' && !Array.isArray(prev.content) && !Array.isArray(m.content)) {
          prev.content = (typeof prev.content === 'string' ? prev.content : '') + '\n' + (typeof m.content === 'string' ? m.content : '');
          continue;
        }

        fixed.push(m);
      }

      var toolUseIds = {};
      for (var i2 = 1; i2 < fixed.length; i2++) {
        var m2 = fixed[i2];
        if (m2.role === 'assistant' && Array.isArray(m2.content)) {
          for (var j = 0; j < m2.content.length; j++) {
            if (m2.content[j].type === 'tool_use') toolUseIds[m2.content[j].id] = i2;
          }
        }
      }

      var cleanResultBlocks = function(content) {
        if (!Array.isArray(content)) return content;
        return content.filter(function(block) {
          if (block.type === 'tool_result') {
            return !!toolUseIds[block.tool_use_id];
          }
          return true;
        });
      };

      for (var i3 = 1; i3 < fixed.length; i3++) {
        var m3 = fixed[i3];
        if (m3.role === 'user') {
          m3.content = cleanResultBlocks(m3.content);
          if (Array.isArray(m3.content) && m3.content.length === 0) {
            m3.content = '(继续)';
          }
        }
      }

      var orphans = [];
      for (var id in toolUseIds) {
        var found = false;
        for (var i4 = 1; i4 < fixed.length; i4++) {
          var m4 = fixed[i4];
          if (m4.role === 'user' && Array.isArray(m4.content)) {
            for (var j2 = 0; j2 < m4.content.length; j2++) {
              if (m4.content[j2].type === 'tool_result' && m4.content[j2].tool_use_id === id) {
                found = true; break;
              }
            }
          }
          if (found) break;
        }
        if (!found) orphans.push(id);
      }

      if (orphans.length > 0) {
        var orphanSet = {};
        for (var oi = 0; oi < orphans.length; oi++) {
          orphanSet[orphans[oi]] = true;
        }
        var rebuilt = [fixed[0]];
        for (var i5 = 1; i5 < fixed.length; i5++) {
          rebuilt.push(fixed[i5]);
          if (fixed[i5].role === 'assistant' && Array.isArray(fixed[i5].content)) {
            var orphanBlocks = [];
            for (var j3 = 0; j3 < fixed[i5].content.length; j3++) {
              var block = fixed[i5].content[j3];
              if (block.type === 'tool_use' && orphanSet[block.id]) {
                orphanBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: '(结果已截断)' });
              }
            }
            if (orphanBlocks.length > 0) {
              rebuilt.push({ role: 'user', content: orphanBlocks });
            }
          }
        }
        fixed = rebuilt;
      }

      if (fixed.length > 1 && fixed[fixed.length - 1].role === 'assistant') {
        fixed.push({ role: 'user', content: '请继续' });
      }

      // Final safety: strip tool_use blocks that have no tool_result in the immediately next message
      for (var i6 = 1; i6 < fixed.length - 1; i6++) {
        if (fixed[i6].role === 'assistant' && Array.isArray(fixed[i6].content) && fixed[i6 + 1].role === 'user') {
          var next = fixed[i6 + 1].content;
          var resultIds = {};
          if (Array.isArray(next)) {
            for (var k = 0; k < next.length; k++) {
              if (next[k].type === 'tool_result') resultIds[next[k].tool_use_id] = true;
            }
          }
          fixed[i6].content = fixed[i6].content.filter(function(block) {
            if (block.type === 'tool_use') return !!resultIds[block.id];
            return true;
          });
        }
      }

      return fixed;
    }

    function trimToBudget(messages, maxTokens) {
      if (estimateMessagesTokens(messages) <= maxTokens) return messages;

      var MAX_MSGS = 40;
      var kept = [];
      var keptTokens = 0;
      for (var i = messages.length - 1; i >= 0; i--) {
        var t = estimateMessagesTokens([messages[i]]);
        if (keptTokens + t > maxTokens || kept.length >= MAX_MSGS) break;
        kept.unshift(messages[i]);
        keptTokens += t;
      }

      kept = _ensurePairIntegrity(kept);

      if (kept.length < messages.length) {
        console.log('[Context] Trimmed: ' + messages.length + ' → ' + kept.length + ' msgs (~' + keptTokens + ' tok)');
      }
      return kept;
    }

    function _ensurePairIntegrity(messages) {
      if (messages.length <= 1) return messages;

      var toolUseIds = {};
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        if (m.role === 'assistant' && Array.isArray(m.content)) {
          for (var j = 0; j < m.content.length; j++) {
            if (m.content[j].type === 'tool_use') toolUseIds[m.content[j].id] = i;
          }
        }
      }
      var toolResultIds = {};
      for (var i2 = 0; i2 < messages.length; i2++) {
        var m2 = messages[i2];
        if (m2.role === 'user' && Array.isArray(m2.content)) {
          for (var j2 = 0; j2 < m2.content.length; j2++) {
            if (m2.content[j2].type === 'tool_result') toolResultIds[m2.content[j2].tool_use_id] = true;
          }
        }
      }

      var orphanIds = [];
      for (var id in toolUseIds) {
        if (!toolResultIds[id]) orphanIds.push(id);
      }

      if (orphanIds.length > 0) {
        var orphanSet2 = {};
        for (var o = 0; o < orphanIds.length; o++) {
          orphanSet2[orphanIds[o]] = true;
        }
        var fixedMsgs = [];
        if (messages.length > 0 && messages[0].role === 'system') {
          fixedMsgs.push(messages[0]);
        }
        for (var i3 = (fixedMsgs.length > 0 ? 1 : 0); i3 < messages.length; i3++) {
          fixedMsgs.push(messages[i3]);
          if (messages[i3].role === 'assistant' && Array.isArray(messages[i3].content)) {
            var orphanBlocks2 = [];
            for (var j3 = 0; j3 < messages[i3].content.length; j3++) {
              var block2 = messages[i3].content[j3];
              if (block2.type === 'tool_use' && orphanSet2[block2.id]) {
                orphanBlocks2.push({ type: 'tool_result', tool_use_id: block2.id, content: '(结果已截断)' });
              }
            }
            if (orphanBlocks2.length > 0) {
              fixedMsgs.push({ role: 'user', content: orphanBlocks2 });
            }
          }
        }
        console.log('[Context] Pair fix: trimmed from ' + messages.length + ' → ' + fixedMsgs.length + ' (orphans: ' + orphanIds.length + ')');
        return fixedMsgs;
      }

      return messages;
    }

    function remainingBudget(maxTokens, messages) {
      return maxTokens - estimateMessagesTokens(messages);
    }

    return Object.freeze({
      toApiMessages: toApiMessages,
      estimateTokens: estimateTokens,
      estimateMessagesTokens: estimateMessagesTokens,
      trimToBudget: trimToBudget,
      remainingBudget: remainingBudget,
      setToolNames: setToolNames,
      setToolDescriptions: setToolDescriptions,
      setDiscovered: setDiscovered
    });
  };
})();
