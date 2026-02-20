# fzf 集成方案

## 方案 A：直接集成 fzf.exe

### 1. 下载 fzf.exe
- Windows: https://github.com/junegunn/fzf/releases
- 下载 `fzf-*-windows_amd64.zip`
- 解压到项目目录：`./fzf.exe`

### 2. IPC 通信（main.js）

```javascript
ipcMain.handle('call-fzf', async (event, options) => {
  const { input = [], prompt = '> ', header = '' } = options;

  // 准备输入数据
  const inputText = Array.isArray(input) ? input.join('\n') : input;

  const fzfProcess = spawn('./fzf.exe', [
    '--filter', '',  // 空过滤器，显示所有选项
    '--prompt', prompt,
    '--header', header,
    '--height', '40%',
    '--layout', 'reverse',
    '--info', 'inline'
  ], {
    windowsHide: true
  });

  // 写入输入
  fzfProcess.stdin.write(inputText);
  fzfProcess.stdin.end();

  // 读取输出
  let stdout = '';
  fzfProcess.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  return new Promise((resolve) => {
    fzfProcess.on('close', (code) => {
      if (code === 0) {
        const selected = stdout.trim().split('\n');
        resolve({ success: true, selected });
      } else if (code === 1) {
        // 用户取消
        resolve({ success: false, cancelled: true });
      } else {
        resolve({ success: false, error: `Exit code: ${code}` });
      }
    });
  });
});
```

### 3. 前端调用（renderer）

```javascript
// 搜索历史快速回溯
async function showSearchHistoryWithFzf() {
  const history = getFilterHistory();  // 获取历史记录

  const result = await window.electronAPI.callFzf({
    input: history,
    prompt: '搜索历史> ',
    header: '选择要重新搜索的关键词'
  });

  if (result.success && result.selected.length > 0) {
    const keyword = result.selected[0];
    filterBox.value = keyword;
    applyFilter();
  }
}

// 文件快速切换
async function showFileSwitcherWithFzf() {
  const fileList = fileHeaders.map(h => h.fileName);

  const result = await window.electronAPI.callFzf({
    input: fileList,
    prompt: '文件> ',
    header: '选择要跳转的文件'
  });

  if (result.success && result.selected.length > 0) {
    const fileName = result.selected[0];
    const header = fileHeaders.find(h => h.fileName === fileName);
    if (header) {
      jumpToLine(header.startIndex);
    }
  }
}

// 多关键词快速组合
async function showKeywordSelectorWithFzf() {
  const commonKeywords = [
    'battery l', 'charge', 'cms_check', 'soh',
    'voltage', 'temp', 'error', 'warn'
  ];

  const result = await window.electronAPI.callFzf({
    input: commonKeywords,
    prompt: '关键词 (多选)> ',
    header: '按 Tab 键多选，Enter 确认',
    multi: true  // fzf --multi
  });

  if (result.success && result.selected.length > 0) {
    const keywords = result.selected.join('|');
    filterBox.value = keywords;
    applyFilter();
  }
}
```

### 4. 快捷键绑定

```javascript
// Ctrl+H - 搜索历史
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'h') {
    e.preventDefault();
    showSearchHistoryWithFzf();
  }
});

// Ctrl+F - 文件切换
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    showFileSwitcherWithFzf();
  }
});

// Ctrl+K - 关键词组合
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    showKeywordSelectorWithFzf();
  }
});
```

## 方案 B：使用 JavaScript 实现（备选）

如果不想依赖 fzf.exe，可以用纯 JS 实现类似功能：

### 1. 使用现有库
- `fuzzysort` - 模糊搜索
- `fuse.js` - 强大的模糊搜索库
- `quick-select` - 快速选择组件

### 2. 自定义实现
```javascript
class SimpleFzf {
  constructor(options) {
    this.items = options.items || [];
    this.prompt = options.prompt || '> ';
    this.onSelect = options.onSelect;
  }

  show() {
    // 创建模态对话框
    const modal = document.createElement('div');
    modal.className = 'fzf-modal';

    // 输入框
    const input = document.createElement('input');
    input.placeholder = this.prompt;
    input.autofocus = true;

    // 结果列表
    const list = document.createElement('div');
    list.className = 'fzf-results';

    // 模糊匹配并显示
    input.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const matched = this.items.filter(item =>
        item.toLowerCase().includes(query)
      );
      this.renderResults(list, matched);
    });

    // 键盘导航
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const selected = list.querySelector('.selected');
        if (selected) {
          this.onSelect(selected.dataset.value);
          modal.remove();
        }
      }
    });

    modal.appendChild(input);
    modal.appendChild(list);
    document.body.appendChild(modal);
    input.focus();
  }

  renderResults(container, items) {
    container.innerHTML = items.map(item =>
      `<div data-value="${item}">${item}</div>`
    ).join('');
  }
}
```

## 推荐优先级

| 场景 | 优先级 | 实现难度 | 效果 |
|------|--------|----------|------|
| 搜索历史回溯 | ⭐⭐⭐⭐⭐ | 简单 | 极高 |
| 文件快速切换 | ⭐⭐⭐⭐⭐ | 简单 | 极高 |
| 多关键词组合 | ⭐⭐⭐⭐⭐ | 中等 | 极高 |
| 书签快速访问 | ⭐⭐⭐⭐ | 简单 | 高 |
| 过滤结果导航 | ⭐⭐⭐ | 中等 | 中等 |

## 总结

**推荐集成方案 A（fzf.exe）**，因为：
- ✅ 成熟稳定，无需重复造轮
- ✅ 性能优秀，处理大量数据无压力
- ✅ 功能丰富（多选、预览、快捷键）
- ✅ 用户体验好（交互流畅）

**建议先实现这 3 个功能**：
1. **Ctrl+H** - 搜索历史回溯
2. **Ctrl+F** - 文件快速切换
3. **Ctrl+K** - 多关键词组合

这 3 个功能覆盖了 80% 的日常使用场景！
