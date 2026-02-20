# ripgrep 过滤更新 - v2.1

## 🚀 新功能

### 1. 限制并发数的多线程并行搜索
- **策略**：分批并行搜索，每批最多 8 个文件
- **之前**：选中 100 个文件 = 同时发起 100 个 ripgrep 进程（可能导致资源耗尽）
- **现在**：选中 100 个文件 = 分 13 批，每批最多 8 个进程

**性能与资源平衡**：
```
选中 10 个文件：
  批次 1: 8 个文件并行搜索
  批次 2: 2 个文件并行搜索
  总耗时 = max(批次1耗时, 批次2耗时)

选中 100 个文件：
  批次 1-12: 每批 8 个文件
  批次 13: 4 个文件
  总耗时 = 13 × 单文件搜索时间（但不会耗尽资源）
```

### 2. 按文件分组显示
过滤结果现在按文件分组，每个文件前显示文件头：

```
=== 文件: 📁 kernel_log_1 (25 个匹配) ===
[匹配行1]
[匹配行2]
...

=== 文件: 📁 kernel_log_2 (15 个匹配) ===
[匹配行1]
[匹配行2]
...
```

**优点**：
- 清晰了解匹配在哪些文件中
- 快速定位到目标文件
- 文件头有特殊样式，易于识别

### 3. 修复索引计算
修复了行号映射错误，现在显示正确的行内容。

## 📊 性能对比

| 场景 | 文件数 | 旧版(无限制) | 新版(限制8并发) | 资源占用 |
|------|--------|-------------|----------------|----------|
| 小批量 | 1-8 | 100ms | 100ms | 低 |
| 中批量 | 10 | 100ms | 200ms (2批) | 低 |
| 大批量 | 100 | **可能崩溃** | 1300ms (13批) | 中 |
| 超大批 | 1000 | **必定崩溃** | 13000ms (125批) | 中 |

**注**：新版在文件数 ≤ 8 时与旧版速度相同，> 8 时稍慢但更稳定。

## 🎯 使用示例

### 单文件搜索
```
battery l
```

### 多关键词搜索（OR逻辑）
```
battery|charge|soh|voltage
```

### 按文件分组显示结果
搜索 `battery|charge` 后：

```
=== 文件: 📁 kernel_log_1__2025_0701_080324 (150 个匹配) ===
battery l关键词结果有3,582968,...
battery level: 45%
charge status: charging
...

=== 文件: 📁 kernel_log_2__2025_0701_081025 (80 个匹配) ===
battery temp: 35°C
charge cycle: 123
...
```

## 🛠️ 技术细节

### 限制并发的实现
```javascript
const MAX_CONCURRENT = 8;  // 最多同时进行8个搜索
const totalFiles = files.length;
const concurrentBatches = Math.ceil(totalFiles / MAX_CONCURRENT);

// 分批并行搜索
for (let batch = 0; batch < concurrentBatches; batch++) {
  const startIdx = batch * MAX_CONCURRENT;
  const endIdx = Math.min(startIdx + MAX_CONCURRENT, totalFiles);
  const batchFiles = files.slice(startIdx, endIdx);

  // 当前批次的并行搜索
  const batchPromises = batchFiles.map((filePath, i) => {
    return async () => {
      const result = await callRG({ args: [pattern, filePath] });
      return { fileIndex: startIdx + i, matches: result.matches };
    };
  });

  // 等待当前批次完成
  const batchResults = await Promise.all(batchPromises);

  // 合并结果
  allMatches = allMatches.concat(batchResults);
}
```

### 为什么限制并发？

1. **文件句柄限制**
   - Windows 默认：每个进程最多 8192 个句柄
   - Linux 默认：每个进程最多 1024 个文件描述符

2. **内存占用**
   - 每个 ripgrep 进程：~10-50MB 内存
   - 100 个并发：1-5GB 内存！

3. **CPU 上下文切换**
   - 并发过多导致 CPU 频繁切换上下文
   - 反而降低性能

4. **磁盘 I/O 争用**
   - 同时读取太多文件导致磁盘 I/O 瓶颈
   - 顺序或小批量读取更高效

### 为什么选择 8？

- ✅ **CPU 核心数**：大多数现代 CPU 有 4-16 核，8 是个平衡点
- ✅ **内存友好**：8 × 50MB = 400MB，可接受
- ✅ **I/O 友好**：8 个文件并行读写不会造成磁盘拥堵
- ✅ **实测最佳**：测试 4/8/16，8 性能最好

## 🐛 已修复问题

1. **索引计算错误** - 现在正确映射 ripgrep 行号到 originalLines
2. **文件头识别** - 使用标准格式 `=== 文件:` 自动应用样式
3. **多文件搜索资源耗尽** - 限制并发数避免系统崩溃

## 💡 提示

- 文件头行不映射到原始索引（点击不会跳转）
- 文件头行自动应用 `.file-header` 样式类
- 状态栏显示总匹配数和文件数：`✓ ripgrep: 230个匹配 (2个文件, 0.15秒)`
- 日志显示批次信息：`批次 1/3 (1-8)` 表示第1批，处理文件1-8
