# ripgrep/Worker 耗时显示优化 - v2.2

## 🎯 本次更新

### 1. 统一状态栏耗时显示格式

**之前**：
- ripgrep: `✓ ripgrep: 11个匹配 (2个文件, 0.13秒)` ✓
- Worker: `多线程过滤中... 100%` ✗ (没有最终耗时)

**现在**：
- ripgrep: `✓ ripgrep: 11个匹配 (2个文件, 0.13秒)` ✓
- 多线程Worker: `✓ Worker: 61721个匹配 (0.15秒)` ✓
- 单线程Worker: `✓ Worker: 150个匹配 (0.10秒)` ✓

### 2. 格式统一

所有过滤方法现在都使用相同的格式：
```
✓ [方法名]: [匹配数]个匹配 ([附加信息], [耗时]秒)
```

示例：
```
✓ ripgrep: 150个匹配 (2个文件, 0.13秒)
✓ Worker: 61721个匹配 (0.15秒)
✓ SharedWorker: 45000个匹配 (0.12秒)
```

## 📊 状态栏显示对比

### ripgrep 过滤
```
✓ ripgrep: 61721个匹配 (3个文件, 0.23秒)
```
- 显示匹配数
- 显示文件数（分组显示）
- 显示耗时（秒）

### 多线程 Worker 过滤
```
✓ Worker: 61721个匹配 (0.15秒)
```
- 显示匹配数
- 显示耗时（秒）
- 不显示文件数（Worker 没有文件分组功能）

### 单线程 Worker 过滤
```
✓ Worker: 150个匹配 (0.10秒)
```
- 显示匹配数
- 显示耗时（秒）

## 🛠️ 技术细节

### ripgrep 耗时显示
```javascript
const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
statusEl.textContent = `✓ ripgrep: ${actualMatchCount}个匹配 (${matchesByFile.size}个文件, ${elapsed}秒)`;
```

### 多线程 Worker 耗时显示
```javascript
const timeInSeconds = (totalTime / 1000).toFixed(2);
statusEl.textContent = `✓ ${modeText}: ${stats.matchedCount}个匹配 (${timeInSeconds}秒)`;
```

### 单线程 Worker 耗时显示
```javascript
const timeInSeconds = stats.totalTime ? (stats.totalTime / 1000).toFixed(2) : '0.00';
statusEl.textContent = `✓ Worker: ${filteredLines.length}个匹配 (${timeInSeconds}秒)`;
```

## 💡 使用提示

### 查看过滤性能
过滤完成后，状态栏会显示：
- **匹配数量**：找到了多少行
- **耗时**：总共用了多少秒
- **方法**：使用的过滤引擎

### 性能对比
```
ripgrep:   ✓ ripgrep: 61721个匹配 (0.23秒)  ← 本地磁盘文件
Worker:    ✓ Worker: 61721个匹配 (0.15秒)  ← 压缩包文件
```

从耗时可以看出哪个过滤方法更快。

### 文件分组
只有 ripgrep 显示文件数，因为 ripgrep 结果按文件分组：
```
=== 文件: 📁 kernel_log_1 (25 个匹配) ===
=== 文件: 📁 kernel_log_2 (15 个匹配) ===
```

Worker 不过滤文件，所以不显示文件数。

## 🐛 已修复问题

1. ✅ **状态栏不显示耗时** - 现在所有方法都显示
2. ✅ **格式不统一** - 统一为 `✓ [方法]: [匹配数] ([耗时])`
3. ✅ **压缩包文件误用 ripgrep** - 自动检测并使用 Worker
4. ✅ **索引计算错误** - ripgrep 现在正确映射行号

## 📝 更新日志

### v2.2 (当前)
- 统一状态栏耗时显示格式
- 优化压缩包文件检测（支持多种压缩格式）
- 修复 ripgrep 索引计算（文件头 + 行号）

### v2.1
- 限制并发数为 8
- 分批并行搜索

### v2.0
- 多线程并行 ripgrep 搜索
- 按文件分组显示结果
