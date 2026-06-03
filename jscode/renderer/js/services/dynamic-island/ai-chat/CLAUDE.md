# AI Agent — Architecture v5 (Simplified)

## 架构图

```
┌──────────────────────────────────────────────┐
│              UI Layer (index.js)              │
│   Chat View │ Tool Cards │ Sidebar │ FAB     │
├──────────────────────────────────────────────┤
│          Agent Loop (agent-loop.js)           │
│   Think → Stream → Act → Observe → Respond   │
│   纯逻辑 · 零 DOM · 回调通信 · AbortController │
├──────────────────┬───────────────────────────┤
│  Tool Registry   │   Context Manager         │
│  (tool-registry) │   (context.js)            │
│  shell + system  │   CJK Token估算 + 截断     │
│  merge system-   │   消息格式修复             │
│  tools           │                           │
├──────────────────┴───────────────────────────┤
│         API Client (api-client.js)            │
│   SSE Streaming · 指数退避 Retry · Provider   │
├──────────────────────────────────────────────┤
│         Rich Renderer (rich-renderer.js)      │
│   Mermaid · KaTeX · hljs · HTML Preview      │
└──────────────────────────────────────────────┘
```

## 文件结构

```
ai-chat/
├── CLAUDE.md              ← 本文件
├── api-client.js          ← API 通信层（SSE + 重试 + Provider）
├── tool-registry.js       ← 工具注册表（shell + system 合并，仅本地工具）
├── context.js             ← 上下文管理（CJK Token估算 + 截断 + 格式修复）
├── agent-loop.js          ← Agent Loop（ReAct + Abort）
├── rich-renderer.js       ← 富文本渲染（Mermaid + KaTeX + hljs + HTML预览）
└── index.js               ← UI 层（渲染 + 事件）
```

## 加载顺序 (index.html)

```
api-client → tool-registry → context → agent-loop → rich-renderer → index
```

## 核心设计

### 1. Agent Loop → UI 解耦

```js
AgentLoop.run(messages, {
  onText: function(token) {},
  onToolCall: function(toolUses, classified, approve) {},
  onToolResult: function(id, success, output) {},
  onComplete: function(text, msgs) {},
  onError: function(err) {},
  onMaxTurns: function() {}
}, abortSignal);
```

### 2. 工具分层

```
shell 层 (ai-shell-exec IPC, 受限沙箱):
  rg, fd, grep, awk, cut, sort, head, tail, wc, cat

system 层 (ai-system-exec IPC, 项目级):
  ls, read, write, cp, mv, rm, mkdir, sed, diff, find, uniq, curl
```

### 3. API 配置

通过 `ai-get-config` IPC 读取 `mem/ai-config.json`，不硬编码密钥。

## 关键参数

| 参数 | 默认值 | 位置 |
|------|--------|------|
| `_maxTurns` | 100 | agent-loop.js |
| `_maxTokens` | 50000 | agent-loop.js |
| `_maxToolsPerTurn` | 10 | agent-loop.js |
| API timeout | 300000ms | api-client.js |
| API retries | 3 | api-client.js |

## 禁止修改

- `_DI` 工厂函数签名
- IPC 通道名
- 模块加载顺序（index.html）
- 回调接口签名
