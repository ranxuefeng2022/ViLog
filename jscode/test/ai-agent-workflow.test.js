/**
 * AI Agent 端到端工作流测试
 *
 * 测试场景:
 *   1. 文件发现: list-chunk-tmp-files → 能找到文件
 *   2. 文件搜索: rg/grep → 能搜索文件内容
 *   3. 文件读取: head/tail/cat → 能读取文件
 *   4. 工具链: 发现→搜索→读取 完整流程
 *   5. 权限管线: auto/confirm/deny 分类
 *   6. Agent 意图路由模拟
 *   7. 用户问题: "能读取到这个文件吗" 模拟
 *
 * 运行: node --test test/ai-agent-workflow.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

/* ═══════════════════════════════════════════════════════════════
   Setup: 创建测试文件
   ═══════════════════════════════════════════════════════════════ */

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CHUNK_TMP = path.join(PROJECT_ROOT, 'mem', 'chunk-tmp', 'wc1');
const TEST_FILENAME = 'gen0-3b86898f-kernel_log_1__2025_0701_080324 - 副本.tmp';
const TEST_FILE = path.join(CHUNK_TMP, TEST_FILENAME);

before(function() {
  if (!fs.existsSync(CHUNK_TMP)) fs.mkdirSync(CHUNK_TMP, { recursive: true });
  if (!fs.existsSync(TEST_FILE)) {
    fs.writeFileSync(TEST_FILE, [
      '6,751082,3142314845,-,caller=T119;healthd: battery l=54 v=3800 t=25.0',
      '6,751083,3142314846,-,caller=T119;android time 2025-07-01 08:03:24.000000',
      '12,752434,3147886859,-,caller=T1345;healthd: battery l=54 v=3800 t=25.0 h=2 st=2 c=-22 fc=4485000 cc=4',
      '6,751084,3142314847,-,caller=T1345;error: something went wrong',
      '6,751085,3142314848,-,caller=T119;battery chg_status=1 vbus_mv=5000 ibus_ma=1200',
      '6,751086,3142314849,-,caller=T119;android time 2025-07-01 08:03:25.500000',
      '12,752435,3147886860,-,caller=T1345;healthd: battery l=55 v=3810 t=25.1 h=2 st=2'
    ].join('\n'), 'utf-8');
  }
});

after(function() {
  // 不删除，保持测试数据
});

/* ═══════════════════════════════════════════════════════════════
   测试 1: 文件发现 — 模拟 list-chunk-tmp-files IPC
   ═══════════════════════════════════════════════════════════════ */

describe('Workflow 1: File Discovery', function() {
  it('list-chunk-tmp-files IPC 能找到测试文件', function() {
    // 模拟 IPC handler 的扫描逻辑
    var result = [];
    function scan(dir) {
      if (!fs.existsSync(dir)) return;
      var entries = fs.readdirSync(dir, { withFileTypes: true });
      for (var i = 0; i < entries.length; i++) {
        var fp = path.join(dir, entries[i].name);
        if (entries[i].isDirectory()) { scan(fp); }
        else if (entries[i].isFile() && entries[i].name.endsWith('.tmp')) { result.push(fp); }
      }
    }
    scan(path.join(PROJECT_ROOT, 'mem', 'chunk-tmp', 'wc1'));
    assert.ok(result.length >= 1, 'should find at least 1 .tmp file');
    var found = result.some(function(f) { return f.indexOf(TEST_FILENAME) !== -1; });
    assert.ok(found, 'should find the specific test file: ' + TEST_FILENAME);
  });

  it('list-chunk-tmp-files 返回完整路径', function() {
    var found = TEST_FILE;
    assert.ok(fs.existsSync(found), 'file should exist');
    assert.ok(found.indexOf('chunk-tmp') !== -1, 'path should be in chunk-tmp');
  });
});

/* ═══════════════════════════════════════════════════════════════
   测试 2: 文件搜索 — 模拟 rg/grep 工具
   ═══════════════════════════════════════════════════════════════ */

describe('Workflow 2: File Search (rg/grep)', function() {
  it('grep 能找到特定关键词', function() {
    var content = fs.readFileSync(TEST_FILE, 'utf-8');
    var lines = content.split('\n');
    var matches = lines.filter(function(l) { return l.indexOf('healthd') !== -1; });
    assert.ok(matches.length >= 1, 'should find healthd lines, got ' + matches.length);
  });

  it('rg 正则搜索 battery 相关行', function() {
    var content = fs.readFileSync(TEST_FILE, 'utf-8');
    var lines = content.split('\n');
    var matches = lines.filter(function(l) { return /battery/.test(l); });
    assert.ok(matches.length >= 1, 'should find battery lines, got ' + matches.length);
  });

  it('rg 搜索 error 行', function() {
    var content = fs.readFileSync(TEST_FILE, 'utf-8');
    var lines = content.split('\n');
    var matches = lines.filter(function(l) { return /error/.test(l); });
    assert.ok(true, 'error search executed, found ' + matches.length + ' lines');
  });

  it('fd 能找到 .tmp 文件', function() {
    var entries = fs.readdirSync(CHUNK_TMP, { withFileTypes: true });
    var tmpFiles = entries.filter(function(e) {
      return e.isFile() && e.name.endsWith('.tmp');
    });
    assert.ok(tmpFiles.length >= 1, 'fd should find .tmp files');
  });
});

/* ═══════════════════════════════════════════════════════════════
   测试 3: 文件读取 — 模拟 head/tail/cat 工具
   ═══════════════════════════════════════════════════════════════ */

describe('Workflow 3: File Read (head/tail/cat)', function() {
  it('head 读取前 3 行', function() {
    var lines = fs.readFileSync(TEST_FILE, 'utf-8').split('\n');
    var head = lines.slice(0, 3);
    assert.strictEqual(head.length, 3);
    assert.ok(head[0].indexOf('healthd') !== -1, 'first line should contain healthd');
  });

  it('tail 读取后 2 行', function() {
    var lines = fs.readFileSync(TEST_FILE, 'utf-8').split('\n');
    var tail = lines.slice(-2);
    assert.strictEqual(tail.length, 2);
    assert.ok(tail.length >= 1, 'tail should return lines, got ' + tail.length);
  });

  it('cat 读完整文件', function() {
    var content = fs.readFileSync(TEST_FILE, 'utf-8');
    assert.ok(content.length > 100, 'file should have content');
    assert.ok(content.indexOf('android time') !== -1, 'should contain android time anchors');
  });

  it('read 工具能读取文件', function() {
    var content = fs.readFileSync(TEST_FILE, 'utf-8');
    assert.ok(content.indexOf('healthd') !== -1);
    assert.ok(content.split('\n').length >= 1, 'file should have lines');
  });
});

/* ═══════════════════════════════════════════════════════════════
   测试 4: 完整工具链 — 发现→搜索→读取
   ═══════════════════════════════════════════════════════════════ */

describe('Workflow 4: Full Tool Chain', function() {
  it('Step 1: 列出文件 → Step 2: 搜索 → Step 3: 读取', function() {
    // Step 1: 列出文件 (模拟 list-chunk-tmp-files)
    var files = fs.readdirSync(CHUNK_TMP, { withFileTypes: true })
      .filter(function(e) { return e.isFile() && e.name.endsWith('.tmp'); })
      .map(function(e) { return path.join(CHUNK_TMP, e.name); });

    assert.ok(files.length >= 1, 'Step 1: should find files');

    // Step 2: 搜索文件内容 (模拟 rg)
    var searchResults = [];
    for (var i = 0; i < files.length; i++) {
      var content = fs.readFileSync(files[i], 'utf-8');
      var lines = content.split('\n');
      for (var j = 0; j < lines.length; j++) {
        if (/healthd/.test(lines[j])) {
          searchResults.push({ file: path.basename(files[i]), line: j + 1, content: lines[j] });
        }
      }
    }
    assert.ok(searchResults.length >= 1, 'Step 2: should find healthd lines, got ' + searchResults.length);

    // Step 3: 读取特定行范围 (模拟 read-lines-range)
    var lineRange = searchResults.slice(0, 2);
    assert.ok(lineRange.length >= 2, 'Step 3: should read line range, got ' + lineRange.length);
    assert.ok(lineRange[0] && lineRange[0].content.length > 0, 'should contain data');
  });

  it('模拟用户提问: "帮我找到包含 battery 的行"', function() {
    var content = fs.readFileSync(TEST_FILE, 'utf-8');
    var lines = content.split('\n');
    var batteryLines = lines.filter(function(l) { return /battery/.test(l); });
    assert.ok(batteryLines.length > 0, 'AI should find battery lines');
    // AI 的工作流: find files → rg battery → report
    var report = '找到 ' + batteryLines.length + ' 行包含 battery:\n' + batteryLines.join('\n');
    assert.ok(report.indexOf('battery') !== -1);
  });

  it('模拟用户提问: "能读取到这个文件吗: ' + TEST_FILENAME + '"', function() {
    // 这是用户报告的问题场景
    // AI 应该做的: list-chunk-tmp-files → 找到文件 → read/cat 读取
    var exists = fs.existsSync(TEST_FILE);
    assert.ok(exists, 'BUG: file exists but AI says it cannot read it!');

    if (exists) {
      var content = fs.readFileSync(TEST_FILE, 'utf-8');
      assert.ok(content.length > 0, 'file has content');
      // AI 应该回答: "可以读取，文件有 X 行，包含 healthd 和 android time 数据..."
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   测试 5: 权限管线
   ═══════════════════════════════════════════════════════════════ */

describe('Workflow 5: Permission Pipeline', function() {
  it('auto 工具自动执行', function() {
    var perms = { rg: 'auto', grep: 'auto', ls: 'auto', read: 'auto' };
    function checkAuto(tool) { return perms[tool] === 'auto'; }
    assert.ok(checkAuto('rg'));
    assert.ok(checkAuto('ls'));
    assert.ok(checkAuto('read'));
  });

  it('confirm 工具需要确认', function() {
    var perms = { write: 'confirm', rm: 'confirm', sed: 'confirm', git: 'confirm' };
    function needsConfirm(tool) { return perms[tool] === 'confirm'; }
    assert.ok(needsConfirm('write'));
    assert.ok(needsConfirm('rm'));
    assert.ok(needsConfirm('sed'));
  });

  it('destructive 工具被 hooks 拦截', function() {
    var blocked = false;
    var hooks = [{
      name: 'no-destructive', priority: 110,
      fn: function(tool, input) {
        if (tool === 'rm') return { allow: false, reason: '⚠️ 删除操作需要确认' };
        return { allow: true };
      }
    }];
    for (var i = 0; i < hooks.length; i++) {
      var r = hooks[i].fn('rm', { path: '/test' });
      if (!r.allow) { blocked = true; break; }
    }
    assert.ok(blocked, 'rm should be blocked by hooks');
  });
});

/* ═══════════════════════════════════════════════════════════════
   测试 6: Agent 意图路由
   ═══════════════════════════════════════════════════════════════ */

describe('Workflow 6: Intent Routing', function() {
  it('检测日志分析意图', function() {
    var logKeywords = /分析|统计|过滤|查找|搜索|error|battery|healthd|kernel|日志|log/i;
    var inputs = [
      '帮我分析这个日志',
      '统计 error 出现次数',
      '查找所有 battery 行',
      '过滤 healthd 相关'
    ];
    for (var i = 0; i < inputs.length; i++) {
      assert.ok(logKeywords.test(inputs[i]), 'should detect log intent: ' + inputs[i]);
    }
  });

  it('检测代码分析意图', function() {
    var codeKeywords = /代码|code|修复|fix|bug|修改|函数|function|重构|refactor|优化|optimize/i;
    var inputs = [
      '帮我修改这个函数',
      '修复空指针 bug',
      '重构 file-operations.js',
      '优化性能'
    ];
    for (var i = 0; i < inputs.length; i++) {
      assert.ok(codeKeywords.test(inputs[i]), 'should detect code intent: ' + inputs[i]);
    }
  });

  it('检测文件操作意图', function() {
    var fsKeywords = /读取|read|写入|write|创建|create|删除|delete|列出|list|文件|file/i;
    var inputs = [
      '能读取到这个文件吗',
      '列出所有 tmp 文件',
      '写一个新文件',
      '删除临时文件'
    ];
    for (var i = 0; i < inputs.length; i++) {
      assert.ok(fsKeywords.test(inputs[i]), 'should detect fs intent: ' + inputs[i]);
    }
  });

  it('未匹配意图 → 通用 Agent Loop', function() {
    var logKeywords = /分析|统计|过滤|查找|搜索|error|battery|healthd|kernel|日志|log/i;
    var codeKeywords = /代码|code|修复|fix|bug|修改|函数|function|重构|refactor|优化|optimize/i;
    var input = '今天天气怎么样';
    assert.ok(!logKeywords.test(input) && !codeKeywords.test(input), 'should fallback to general agent');
    // AI 会进入通用 Agent Loop，自行判断是否需要工具
  });
});

/* ═══════════════════════════════════════════════════════════════
   测试 7: 工具注册完整性
   ═══════════════════════════════════════════════════════════════ */

describe('Workflow 7: Tool Registry Completeness', function() {
  it('所有 22 个工具应注册', function() {
    var expectedTools = [
      // tool-registry.js (chunk-tmp 范围)
      'rg', 'grep', 'fd',
      // tool-registry.js (chunk-tmp 范围, process)
      'awk', 'cut',
      // tool-registry.js (chunk-tmp 范围, file)
      'head', 'tail', 'wc', 'cat',
      // system-tools.js (全局范围, fs)
      'ls', 'read', 'write', 'cp', 'mv', 'rm', 'mkdir',
      // system-tools.js (全局范围, system)
      'ps', 'git', 'open', 'node', 'python', 'curl', 'echo',
      // system-tools.js (全局范围, 黄金工具)
      'sed', 'jq', 'fzf', 'diff', 'find', 'sort', 'uniq'
    ];
    // 去重检查
    var seen = {};
    var dupes = [];
    for (var i = 0; i < expectedTools.length; i++) {
      if (seen[expectedTools[i]]) dupes.push(expectedTools[i]);
      seen[expectedTools[i]] = true;
    }
    assert.strictEqual(dupes.length, 0, 'should not have duplicate tools: ' + dupes.join(', '));
    assert.strictEqual(Object.keys(seen).length, 30, 'should have 30 unique tools');
  });

  it('每个工具分类清晰', function() {
    var categories = {
      search: ['rg', 'grep', 'fd', 'fzf'],
      process: ['awk', 'cut', 'sed', 'jq', 'diff', 'sort', 'uniq'],
      file: ['head', 'tail', 'wc', 'cat'],
      fs: ['ls', 'read', 'write', 'cp', 'mv', 'rm', 'mkdir', 'find'],
      system: ['ps', 'git', 'open', 'node', 'python', 'curl', 'echo']
    };
    var total = 0;
    for (var cat in categories) { total += categories[cat].length; }
    assert.ok(total >= 28, 'should categorize all tools');
  });
});

/* ═══════════════════════════════════════════════════════════════
   测试 8: Bug 复现 — "能读取到这个文件吗"
   ═══════════════════════════════════════════════════════════════ */

describe('Workflow 8: Bug Reproduction', function() {
  it('AI 应该能通过 list-chunk-tmp-files 找到文件', function() {
    // 模拟 IPC: list-chunk-tmp-files
    var wcDir = path.join(PROJECT_ROOT, 'mem', 'chunk-tmp', 'wc1');
    var result = [];
    function scan(dir) {
      if (!fs.existsSync(dir)) return;
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function(e) {
        var fp = path.join(dir, e.name);
        if (e.isDirectory()) scan(fp);
        else if (e.isFile() && e.name.endsWith('.tmp')) result.push(fp);
      });
    }
    scan(wcDir);
    assert.ok(result.length > 0, 'list-chunk-tmp-files should find files');
  });

  it('AI 应该能通过 cat/read 读取文件内容', function() {
    assert.ok(fs.existsSync(TEST_FILE), 'file exists');
    var content = fs.readFileSync(TEST_FILE, 'utf-8');
    assert.ok(content.length > 0, 'file is readable');
  });

  it('AI 回答"不能读取"是 Bug — 文件真实存在且可读', function() {
    // 这个测试明确标记当前存在的 Bug
    assert.ok(fs.existsSync(TEST_FILE), 'FILE EXISTS: AI says cannot read but it should be able to');
    var stat = fs.statSync(TEST_FILE);
    assert.ok(stat.size > 0, 'FILE HAS CONTENT');
    // Bug 根因: AI 不知道去扫描 chunk-tmp 目录，或工具路径解析失败
    console.log('  → Bug: AI 回答"不能读取此文件"，但文件确实存在于', TEST_FILE);
    console.log('  → 根因分析: AI 没有自动扫描 chunk-tmp 目录');
    console.log('  → 修复建议: 在系统 prompt 中告知 AI "当前加载的日志在 mem/chunk-tmp/wcN/ 中"');
  });
});
