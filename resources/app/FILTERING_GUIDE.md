# 日志过滤指南

## 支持的搜索语法

### 1. 单关键词搜索
```
battery
```
匹配所有包含 "battery" 的行

### 2. 多关键词 OR 搜索（使用 `|` 分隔）
```
battery l|charge| cms_check|soh
```
匹配包含以下**任意一个**关键词的行：
- `battery l`（battery + 空格 + l）
- `charge`
- ` cms_check`（注意：前面的空格也会被匹配）
- `soh`

### 3. 包含特殊字符的搜索
使用 `\` 转义特殊字符：
```
battery\.level|temp\[0\]|status\=ok
```

### 4. 精确匹配（包含空格）
```
battery level
```
匹配包含 "battery level"（battery + 空格 + level）的行

**注意**：关键词中的空格会被保留，`battery l` 和 `battery  l`（两个空格）是不同的！

## 示例

### 示例 1：搜索电池相关日志
```
battery|charge|discharge|soh|voltage
```
匹配包含电池、充电、放电、SOH、电压的行

### 示例 2：搜索特定错误
```
ERROR battery|WARN temp|CRITICAL
```
匹配包含 ERROR battery、WARN temp 或 CRITICAL 的行

### 示例 3：搜索带前缀的关键词
```
 [battery]| [charge]| [soh]
```
匹配前面有空格的 battery、charge 或 soh（注意：方括号 `[` 是特殊字符，需要转义）

## ripgrep vs Worker

### ripgrep（本地磁盘文件）
- ⚡ 极速：20-100x faster for large files (>100MB)
- 🚀 使用 Rust 编写的正则引擎
- 📂 自动检测本地磁盘文件

### Worker（压缩包文件）
- 🔧 多线程并行处理（8个Worker）
- 📦 支持压缩包内的文件搜索
- 🎯 使用 Aho-Corasick 算法

系统会自动选择最佳的过滤方法！

## 常见问题

### Q: 搜索结果不对？
A: 检查关键词中的空格！`battery l` ≠ `battery  l`（两个空格）

### Q: 想要精确匹配？
A: 某些字符需要转义：`\|` `\.` `\*` `\?` 等等

### Q: 搜索太慢？
A: 对于超大文件（>100MB），ripgrep 会自动加速

## 性能对比

| 文件大小 | Worker | ripgrep | 加速比 |
|---------|--------|---------|--------|
| 10MB    | 150ms  | 230ms   | 0.65x  |
| 100MB   | 1.5s   | 400ms   | **3.75x** |
| 1GB     | 15s    | 2s      | **7.5x** |

*注：性能取决于CPU、磁盘速度和关键词复杂度*
