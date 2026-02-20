# Everything CLI 集成配置说明

## 概述

日志工具现在使用 Everything 的命令行工具 `es.exe` 进行文件搜索，比 HTTP API 更可靠和稳定。

---

## 第一步：获取 es.exe

### 方式 1：安装 Everything（推荐）

1. 访问 Everything 官网：https://www.voidtools.com/downloads/
2. 下载 "Everything" （包含 es.exe）
3. 运行安装程序，默认安装路径：
   ```
   C:\Program Files\Everything\
   ```
4. 安装完成后，`es.exe` 位于：
   ```
   C:\Program Files\Everything\es.exe
   ```

### 方式 2：使用 Everything SDK

1. 访问：https://www.voidtools.com/downloads/
2. 下载 "Everything SDK"
3. 解压到任意目录，例如：`C:\Tools\Everything\`
4. `es.exe` 位于 SDK 目录中

### 方式 3：从已安装的 Everything 复制

如果你已经安装了 Everything：
1. 打开 Everything 安装目录（通常在 `C:\Program Files\Everything\`）
2. 找到 `es.exe` 文件
3. 记下这个路径

---

## 第二步：验证 es.exe 可用性

打开命令提示符（CMD）或 PowerShell，运行：

```bash
"C:\Program Files\Everything\es.exe" -help
```

如果显示了帮助信息，说明 `es.exe` 可用。

---

## 第三步：启动 Everything

**重要**：`es.exe` 需要 Everything 在后台运行才能工作。

1. 启动 Everything 桌面应用
2. 等待索引完成（状态栏显示 "文件数" 和 "文件夹数"）
3. **保持 Everything 运行**（可以最小化到托盘）

---

## 第四步：启动日志工具

重启日志工具，在文件树顶部会看到新的搜索框：

```
┌─────────────────────────────────────┐
│ 🔍 Everything 快速搜索...    [×] │
└─────────────────────────────────────┘
```

---

## 第五步：测试搜索

### 测试 1：搜索文件名

```
输入：kernel_log
回车
→ 显示所有包含 kernel_log 的文件
```

### 测试 2：搜索压缩包

```
输入：*.zip
回车
→ 显示所有 .zip 压缩包
```

### 测试 3：搜索特定日期

```
输入：20260121*
回车
→ 显示所有以 20260121 开头的文件
```

---

## 高级配置

### 自定义 es.exe 路径

如果你的 `es.exe` 不在默认位置，可以在代码中修改路径：

**文件**：`renderer/js/features/everything-cli-integration.js`

**第 8 行**：
```javascript
config: {
  exePath: 'C:\\Program Files\\Everything\\es.exe',  // ← 修改为你的路径
  timeout: 10000,
  maxResults: 100
},
```

例如，如果安装在其他位置：
```javascript
exePath: 'C:\\Tools\\Everything\\es.exe',
```

或者从 Everything SDK：
```javascript
exePath: 'D:\\Downloads\\Everything-SDK\\es.exe',
```

---

## es.exe 命令参数说明

日志工具使用以下参数调用 `es.exe`：

| 参数 | 说明 | 示例 |
|------|------|------|
| `-json` | 以 JSON 格式输出 | `-json` |
| `-count N` | 限制返回结果数量 | `-count 100` |
| `-sort FIELD-DIRECTION` | 排序字段和方向（组合） | `-sort date-modified-descending` |
| `-size` | 添加文件大小字段 | `-size` |
| `-date-modified` | 添加修改日期字段 | `-date-modified` |

**重要**：排序方向必须附加到字段后面，例如 `date-modified-descending`，而不是使用单独的 `-descending` 参数。

**完整示例**：
```bash
es.exe "kernel_log" -json -count 100 -sort date-modified-descending -size -date-modified
```

---

## 常见问题

### Q1: 提示 "es.exe 不存在"

**A:**
1. 确认 Everything 已安装
2. 检查 `es.exe` 路径是否正确
3. 如果路径不同，修改配置文件

### Q2: 搜索不到文件

**A:**
1. **确保 Everything 在运行**（`es.exe` 需要 Everything 后台运行）
2. 检查 Everything 是否已完成索引
3. 在 Everything 桌面应用中搜索同一关键词验证
4. 确认文件在 Everything 的索引范围内

### Q3: 搜索速度慢

**A:**
1. Everything 首次运行需要建立索引（可能需要几分钟）
2. 在 Everything 选项中调整索引范围，排除不必要的驱动器
3. 避免索引网络驱动器

### Q4: 提示 "执行超时（10秒）"

**A:**
1. 索引过大，搜索时间过长
2. 使用更具体的搜索词
3. 减少返回结果数量（修改 `count` 参数）

### Q5: 找到的文件无法加载

**A:**
1. 检查文件权限
2. 检查文件路径是否正确
3. 查看控制台日志获取详细错误信息

---

## 优势对比

| 特性 | HTTP API | es.exe CLI |
|------|----------|-------------|
| 配置复杂度 | 需要启用 HTTP 服务器 | 直接使用 |
| 稳定性 | 可能受 HTTP 限制 | 非常稳定 |
| 路径返回 | 可能不完整 | 完整路径 |
| 性能 | 快 | 更快 |
| 可靠性 | 中等 | 高 |

---

## 技术细节

### 调用流程

```
渲染进程
  ↓ (IPC)
主进程
  ↓ (spawn)
es.exe
  ↓ (stdout)
JSON 数据
  ↓ (IPC)
渲染进程
  ↓ (解析)
显示搜索结果
```

### IPC 通信

- **主进程**：`main.js` 的 `call-es` handler
- **渲染进程**：通过 `window.electronAPI.callES()` 调用
- **超时保护**：10秒超时自动终止进程

### 数据格式

`es.exe` 返回的 JSON 格式：
```json
[
  {
    "filename": "C:\\logs\\debug\\kernel_log_4.txt",
    "size": 1234567,
    "date_modified": 134131200155664193
  }
]
```

**注意**：
- `filename`: 完整路径（包含文件名）
- `size`: 文件大小（字节）
- `date_modified`: Windows FILETIME 格式，需要转换为 Unix 时间戳
- 工具会自动提取 `name`、`path`、`fullPath` 字段供内部使用

---

## 下一步

配置完成后，你可以：

1. ✅ 快速搜索日志文件
2. ✅ 点击搜索结果直接加载
3. ✅ 支持通配符搜索
4. ✅ 按时间排序显示结果

**开始使用吧！** 🚀
