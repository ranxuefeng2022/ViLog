/**
 * AI Agent — Tool Registry (v3: Simplified)
 *
 * 统一管理所有工具，仅注册项目本地存在的工具。
 * shell: rg/fd/grep/awk/cut/sort/head/tail/wc/cat (受限沙箱)
 * system: ls/read/write/cp/mv/rm/mkdir/sed/diff/find/uniq/curl (项目级)
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  window.App._DI.createToolRegistry = function() {
    var _tools = {};
    var _available = null;
    var _discovered = {};

    function register(def) {
      if (_tools[def.name]) return;
      _tools[def.name] = def;
    }

    function get(name) {
      return _tools[name] || null;
    }

    function getApiDefinitions() {
      var defs = [];
      for (var name in _tools) {
        var t = _tools[name];
        defs.push({ name: t.name, description: t.description, input_schema: t.schema });
      }
      return defs;
    }

    function getToolDescriptions() {
      var lines = [];
      for (var name in _tools) {
        var t = _tools[name];
        var props = t.schema && t.schema.properties ? t.schema.properties : {};
        var required = t.schema && t.schema.required ? t.schema.required : [];
        var paramStr = '';
        for (var p in props) {
          var desc = props[p].description || props[p].type || '';
          var req = required.indexOf(p) !== -1 ? '(必填)' : '(可选)';
          paramStr += '\n    ' + p + ': ' + desc + ' ' + req;
        }
        lines.push('- ' + name + ': ' + t.description + paramStr);
      }
      return lines.join('\n');
    }

    function getNames() {
      return Object.keys(_tools);
    }

    function getAvailable() {
      return _available || {};
    }

    function execute(name, input) {
      var tool = _tools[name];
      if (!tool) return Promise.resolve({ success: false, error: '未知工具: ' + name });
      try {
        return Promise.resolve(tool.executor(input));
      } catch (e) {
        return Promise.resolve({ success: false, error: e.message });
      }
    }

    function executeAll(toolUses) {
      return Promise.all(toolUses.map(function(tu) {
        return execute(tu.name, tu.input).then(function(result) {
          return { id: tu.id, name: tu.name, input: tu.input, result: result };
        });
      }));
    }

    /* ═══════════════════════════════════════════════════════════════
       IPC helpers
       ═══════════════════════════════════════════════════════════════ */

    function _shellExec(tool, args, pathOverride) {
      if (!window.electronAPI || !window.electronAPI.aiShellExec) {
        return Promise.resolve({ success: false, error: 'shell 工具不可用' });
      }
      return window.electronAPI.aiShellExec({ tool: tool, args: args, path: pathOverride || '' });
    }

    function _systemExec(tool, args, cwd, dangerLevel) {
      if (!window.electronAPI || !window.electronAPI.aiSystemExec) {
        return Promise.resolve({ success: false, error: '系统工具不可用' });
      }
      return window.electronAPI.aiSystemExec({ tool: tool, args: args, cwd: cwd, dangerLevel: dangerLevel || 'read' });
    }

    /* ═══════════════════════════════════════════════════════════════
       Tool definitions (lazy, only registered if available)
       ═══════════════════════════════════════════════════════════════ */

    var TOOL_DEFS = {
      rg: { cat: 'shell', desc: '[首选] 超高速全文搜索(ripgrep)，支持正则。搜索日志文件中的匹配行。',
        schema: { type: 'object', properties: { pattern: { type: 'string', description: '搜索模式(支持正则)' }, path: { type: 'string', description: '搜索路径(目录或文件,绝对路径)' }, max_count: { type: 'integer', description: '最多返回行数，默认100' } }, required: ['pattern'] },
        args: function(inp) { var a = ['--no-heading', '-n', '--color', 'never', '-e', inp.pattern || '']; if (inp.max_count) a.push('-m', String(inp.max_count)); else a.push('-m', '100'); if (inp.path) a.push(inp.path); return a; } },
      fd: { cat: 'shell', desc: '[首选] 快速查找文件。',
        schema: { type: 'object', properties: { pattern: { type: 'string', description: '文件名匹配模式(可选)' }, path: { type: 'string', description: '搜索根目录(绝对路径)' } }, required: [] },
        args: function(inp) { var a = []; if (inp.pattern) a.push(inp.pattern); a.push('--type', 'f'); if (inp.path) a.push(inp.path); return a; } },
      grep: { cat: 'shell', desc: '标准文本搜索，从日志文件中过滤匹配行。',
        schema: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词或正则' }, path: { type: 'string', description: '搜索路径(绝对路径)' }, max_count: { type: 'integer', description: '最多返回行数，默认50' } }, required: ['pattern'] },
        args: function(inp) { var a = ['-i', inp.pattern || '']; if (inp.max_count) a.push('-m', String(inp.max_count)); else a.push('-m', '50'); if (inp.path) a.push(inp.path); return a; } },
      awk: { cat: 'shell', desc: '[首选] 文本处理，提取/转换日志行中的字段。',
        schema: { type: 'object', properties: { program: { type: 'string', description: 'awk 程序，如 \'{print $2}\'' }, file: { type: 'string', description: '目标文件路径(绝对路径)' } }, required: ['program'] },
        args: function(inp) { return inp.file ? [inp.program, inp.file] : [inp.program]; } },
      cut: { cat: 'shell', desc: '按分隔符切分日志行，提取指定列。',
        schema: { type: 'object', properties: { fields: { type: 'string', description: '字段号，如 "1,3" 或 "1-5"' }, delimiter: { type: 'string', description: '分隔符，默认逗号' }, file: { type: 'string', description: '目标文件路径(绝对路径)' } }, required: ['fields'] },
        args: function(inp) { var a = ['-d', inp.delimiter || ',', '-f', inp.fields || '1']; if (inp.file) a.push(inp.file); return a; } },
      sort: { cat: 'shell', desc: '[首选] 对日志行排序+去重。',
        schema: { type: 'object', properties: { numeric: { type: 'boolean', description: '按数值排序' }, reverse: { type: 'boolean', description: '倒序' }, unique: { type: 'boolean', description: '去重' }, file: { type: 'string', description: '目标文件路径(绝对路径)' } }, required: [] },
        args: function(inp) { var a = []; if (inp.numeric) a.push('-n'); if (inp.reverse) a.push('-r'); if (inp.unique) a.push('-u'); if (inp.file) a.push(inp.file); return a; } },
      head: { cat: 'shell', desc: '读取日志文件开头 N 行。',
        schema: { type: 'object', properties: { n: { type: 'integer', description: '行数，默认20' }, file: { type: 'string', description: '目标文件路径(绝对路径,必填)' } }, required: ['file'] },
        args: function(inp) { return ['-n', String(inp.n || 20), inp.file || '']; } },
      tail: { cat: 'shell', desc: '读取日志文件末尾 N 行。',
        schema: { type: 'object', properties: { n: { type: 'integer', description: '行数，默认20' }, file: { type: 'string', description: '目标文件路径(绝对路径,必填)' } }, required: ['file'] },
        args: function(inp) { return ['-n', String(inp.n || 20), inp.file || '']; } },
      wc: { cat: 'shell', desc: '[首选] 统计日志行数/字数。',
        schema: { type: 'object', properties: { lines: { type: 'boolean', description: '仅统计行数' }, file: { type: 'string', description: '目标文件路径(绝对路径)' } }, required: [] },
        args: function(inp) { var a = []; if (inp.lines) a.push('-l'); if (inp.file) a.push(inp.file); return a; } },
      cat: { cat: 'shell', desc: '读取完整日志文件内容(自动截断过长输出)。',
        schema: { type: 'object', properties: { file: { type: 'string', description: '目标文件路径(绝对路径,必填)' } }, required: ['file'] },
        args: function(inp) { return [inp.file || '']; } },
      ls: { cat: 'system', danger: 'read', desc: '列出目录中的文件和子目录。',
        schema: { type: 'object', properties: { path: { type: 'string', description: '目录路径(绝对路径)' } }, required: [] },
        args: function(inp) { return inp.path ? ['-la', inp.path] : ['-la']; } },
      cp: { cat: 'system', danger: 'write', desc: '复制文件或目录。',
        schema: { type: 'object', properties: { src: { type: 'string', description: '源路径(绝对路径)' }, dst: { type: 'string', description: '目标路径(绝对路径)' } }, required: ['src', 'dst'] },
        args: function(inp) { return ['-r', inp.src, inp.dst]; } },
      mv: { cat: 'system', danger: 'write', desc: '移动/重命名文件或目录。',
        schema: { type: 'object', properties: { src: { type: 'string', description: '源路径(绝对路径)' }, dst: { type: 'string', description: '目标路径(绝对路径)' } }, required: ['src', 'dst'] },
        args: function(inp) { return [inp.src, inp.dst]; } },
      rm: { cat: 'system', danger: 'destructive', desc: '删除文件或目录。不可恢复。',
        schema: { type: 'object', properties: { path: { type: 'string', description: '要删除的文件/目录路径(绝对路径)' }, recursive: { type: 'boolean', description: '递归删除目录' } }, required: ['path'] },
        args: function(inp) { return inp.recursive ? ['-rf', inp.path] : ['-f', inp.path]; } },
      mkdir: { cat: 'system', danger: 'write', desc: '创建目录。',
        schema: { type: 'object', properties: { path: { type: 'string', description: '目录路径(绝对路径)' } }, required: ['path'] },
        args: function(inp) { return ['-p', inp.path]; } },
      sed: { cat: 'system', danger: 'write', desc: '流式文本替换编辑。',
        schema: { type: 'object', properties: { expression: { type: 'string', description: 'sed 表达式' }, file: { type: 'string', description: '目标文件路径(绝对路径,必填)' }, inplace: { type: 'boolean', description: '是否直接修改文件' } }, required: ['expression', 'file'] },
        args: function(inp) { var a = [inp.expression]; if (inp.inplace) a.unshift('-i'); a.push(inp.file); return a; } },
      diff: { cat: 'system', danger: 'read', desc: '对比两个文件的差异。',
        schema: { type: 'object', properties: { file1: { type: 'string', description: '第一个文件路径(绝对路径)' }, file2: { type: 'string', description: '第二个文件路径(绝对路径)' }, unified: { type: 'boolean', description: '统一格式输出' } }, required: ['file1', 'file2'] },
        args: function(inp) { var a = []; if (inp.unified) a.push('-u'); a.push(inp.file1, inp.file2); return a; } },
      find: { cat: 'system', danger: 'read', desc: '按条件搜索文件(名称/类型/大小/时间)。',
        schema: { type: 'object', properties: { path: { type: 'string', description: '搜索起始目录(绝对路径)' }, name: { type: 'string', description: '文件名模式,如 "*.js"' }, type: { type: 'string', description: '类型: f(文件) d(目录)' } }, required: ['path'] },
        args: function(inp) { var a = [inp.path]; if (inp.name) a.push('-name', inp.name); if (inp.type) a.push('-type', inp.type); return a; } },
      uniq: { cat: 'system', danger: 'read', desc: '报告或省略重复行。',
        schema: { type: 'object', properties: { count: { type: 'boolean', description: '显示重复次数' }, file: { type: 'string', description: '文件路径(绝对路径,可选)' } }, required: [] },
        args: function(inp) { var a = []; if (inp.count) a.push('-c'); if (inp.file) a.push(inp.file); return a; } },
      es: { cat: 'shell', desc: '[首选] Everything 秒搜文件名，比 fd 更快，支持通配符和正则。',
        schema: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词(支持通配符*)' }, max_count: { type: 'integer', description: '最多返回条数，默认50' } }, required: ['pattern'] },
        args: function(inp) { var a = [inp.pattern || '']; if (inp.max_count) a.push('-n', String(inp.max_count)); else a.push('-n', '50'); return a; } },
      du: { cat: 'system', danger: 'read', desc: '统计目录/文件磁盘占用大小。',
        schema: { type: 'object', properties: { path: { type: 'string', description: '目录或文件路径(绝对路径)' }, summary: { type: 'boolean', description: '仅显示总计' }, human: { type: 'boolean', description: '人类可读格式(K/M/G)' } }, required: ['path'] },
        args: function(inp) { var a = []; if (inp.summary) a.push('-s'); if (inp.human) a.push('-h'); a.push(inp.path || '.'); return a; } },
      stat: { cat: 'system', danger: 'read', desc: '查看文件详细元信息(大小/权限/修改时间)。',
        schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径(绝对路径,必填)' } }, required: ['path'] },
        args: function(inp) { return [inp.path || '']; } },
      tar: { cat: 'system', danger: 'write', desc: '打包/解包 tar/tar.gz/tar.xz 归档文件。',
        schema: { type: 'object', properties: { action: { type: 'string', description: '操作: create(打包) 或 extract(解包)' }, file: { type: 'string', description: '归档文件路径(绝对路径)' }, dir: { type: 'string', description: '打包目录或解包目标目录(绝对路径)' }, gzip: { type: 'boolean', description: '是否使用 gzip 压缩(.tar.gz)' } }, required: ['action', 'file'] },
        args: function(inp) { var a = []; if (inp.action === 'create') { a.push('-c'); if (inp.gzip) a.push('-z'); a.push('-f', inp.file); if (inp.dir) a.push(inp.dir); } else { a.push('-x'); if (inp.gzip) a.push('-z'); a.push('-f', inp.file); if (inp.dir) a.push('-C', inp.dir); } return a; } },
      '7z': { cat: 'system', danger: 'write', desc: '7-Zip 压缩/解压，支持 7z/zip/rar/gz 等格式。',
        schema: { type: 'object', properties: { action: { type: 'string', description: '操作: a(压缩) 或 x(解压)' }, archive: { type: 'string', description: '归档文件路径(绝对路径)' }, target: { type: 'string', description: '目标文件/目录路径(绝对路径)' } }, required: ['action', 'archive'] },
        args: function(inp) { return [inp.action || 'a', inp.archive || '', inp.target || '']; } },
      tr: { cat: 'shell', desc: '字符级替换/删除/压缩，处理单字符变换。',
        schema: { type: 'object', properties: { set1: { type: 'string', description: '源字符集' }, set2: { type: 'string', description: '目标字符集(删除时省略)' }, delete: { type: 'boolean', description: '删除模式，删除 set1 中的字符' }, squeeze: { type: 'boolean', description: '压缩连续重复字符' } }, required: ['set1'] },
        args: function(inp) { var a = []; if (inp.delete) a.push('-d'); if (inp.squeeze) a.push('-s'); a.push(inp.set1 || ''); if (!inp.delete && inp.set2) a.push(inp.set2); return a; } },
      iconv: { cat: 'system', danger: 'read', desc: '文本编码转换，如 GBK→UTF-8。',
        schema: { type: 'object', properties: { from: { type: 'string', description: '源编码，如 gbk' }, to: { type: 'string', description: '目标编码，如 utf-8' }, file: { type: 'string', description: '源文件路径(绝对路径,必填)' } }, required: ['from', 'to', 'file'] },
        args: function(inp) { return ['-f', inp.from || 'gbk', '-t', inp.to || 'utf-8', inp.file || '']; } },
      xxd: { cat: 'shell', desc: '十六进制转储查看二进制文件。',
        schema: { type: 'object', properties: { file: { type: 'string', description: '文件路径(绝对路径,必填)' }, length: { type: 'integer', description: '读取字节数，默认256' } }, required: ['file'] },
        args: function(inp) { var a = ['-l', String(inp.length || 256)]; a.push(inp.file || ''); return a; } },
      sha256sum: { cat: 'shell', desc: '计算文件 SHA-256 校验和。',
        schema: { type: 'object', properties: { file: { type: 'string', description: '文件路径(绝对路径,必填)' } }, required: ['file'] },
        args: function(inp) { return [inp.file || '']; } },
      rev: { cat: 'shell', desc: '反转每行字符顺序。',
        schema: { type: 'object', properties: { file: { type: 'string', description: '文件路径(绝对路径,可选)' } }, required: [] },
        args: function(inp) { return inp.file ? [inp.file] : []; } },
      shuf: { cat: 'shell', desc: '随机打乱行顺序或随机采样。',
        schema: { type: 'object', properties: { n: { type: 'integer', description: '随机抽取N行' }, file: { type: 'string', description: '文件路径(绝对路径,可选)' } }, required: [] },
        args: function(inp) { var a = []; if (inp.n) a.push('-n', String(inp.n)); if (inp.file) a.push(inp.file); return a; } }
    };

    function _registerFromDefs(available) {
      for (var name in TOOL_DEFS) {
        if (!available[name]) continue;
        var d = TOOL_DEFS[name];
        if (d.cat === 'shell') {
          (function(n, def) {
            register({ name: n, description: def.desc, category: 'shell', schema: def.schema,
              executor: function(input) { var pathOverride = input.path || input.file || input.cwd || ''; return _shellExec(n, def.args(input), pathOverride); } });
          })(name, d);
        } else if (d.cat === 'system') {
          (function(n, def) {
            register({ name: n, description: def.desc, category: 'system', schema: def.schema,
              executor: function(input) { var cwd = input.path || input.cwd || null; return _systemExec(n, (def.args || function() { return []; })(input), cwd, def.danger); } });
          })(name, d);
        }
      }

      if (available.read) {
        register({ name: 'read', description: '读取文件的完整内容。', category: 'system',
          schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径(必填)' } }, required: ['path'] },
          executor: function(input) {
            if (!window.electronAPI || !window.electronAPI.aiFileRead) return Promise.resolve({ success: false, error: '不可用' });
            return window.electronAPI.aiFileRead(input.path).then(function(r) {
              return { success: r.success, stdout: r.content || '', stderr: r.error || '' };
            });
          }
        });
      }

      if (available.write) {
        register({ name: 'write', description: '写入文件内容(覆盖模式，自动备份)。路径必须以 mem/ 开头。', category: 'system',
          schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径(必填，mem/开头)' }, content: { type: 'string', description: '文件内容(必填)' } }, required: ['path', 'content'] },
          executor: function(input) {
            if (!window.electronAPI || !window.electronAPI.aiFileWrite) return Promise.resolve({ success: false, error: '不可用' });
            return window.electronAPI.aiFileWrite({ filePath: input.path, content: input.content, backup: true }).then(function(r) {
              return { success: r.success, stdout: '已写入: ' + r.path + ' (' + r.size + ' 字符)', stderr: r.error || '' };
            });
          }
        });
      }

      if (available.curl) {
        register({ name: 'curl', description: '发送 HTTP 请求。', category: 'system',
          schema: { type: 'object', properties: { url: { type: 'string', description: '请求 URL' }, method: { type: 'string', description: 'HTTP 方法,默认 GET' }, data: { type: 'string', description: '请求体(可选)' }, headers: { type: 'string', description: 'JSON 格式请求头(可选)' } }, required: ['url'] },
          executor: function(input) {
            var opts = { method: input.method || 'GET' };
            if (input.headers) { try { opts.headers = JSON.parse(input.headers); } catch(ignore) { void ignore; } }
            if (input.data) opts.body = input.data;
            return fetch(input.url, opts).then(function(r) {
              return r.text().then(function(t) {
                return { success: r.ok, stdout: t.slice(0, 5000), stderr: r.ok ? '' : 'HTTP ' + r.status };
              });
            }).catch(function(e) { return { success: false, stdout: '', stderr: e.message }; });
          }
        });
      }

      if (available.node) {
        register({ name: 'node', description: '执行 Node.js 脚本，用于复杂计算/JSON处理/数据转换。', category: 'system',
          schema: { type: 'object', properties: { script: { type: 'string', description: 'JS 代码(必填)，如 "console.log(1+2)"' } }, required: ['script'] },
          executor: function(input) {
            if (!window.electronAPI || !window.electronAPI.aiSystemExec) return Promise.resolve({ success: false, error: '不可用' });
            return window.electronAPI.aiSystemExec({ tool: 'node', args: ['-e', input.script || ''], cwd: null, dangerLevel: 'read' });
          }
        });
      }

      if (available.git) {
        register({ name: 'git', description: 'Git 版本控制操作(log/diff/status/branch 等)。', category: 'system',
          schema: { type: 'object', properties: { args: { type: 'string', description: 'git 子命令及参数，如 "log --oneline -10" 或 "diff HEAD~1"' } }, required: ['args'] },
          executor: function(input) {
            if (!window.electronAPI || !window.electronAPI.aiSystemExec) return Promise.resolve({ success: false, error: '不可用' });
            return window.electronAPI.aiSystemExec({ tool: 'git', args: (input.args || '').split(/\s+/), cwd: null, dangerLevel: 'read' });
          }
        });
      }

      console.log('[ToolRegistry] 已注册 ' + Object.keys(_tools).length + ' 个工具 (检测到 ' + Object.keys(available).filter(function(k) { return available[k]; }).length + ' 个可用)');
    }

    function _registerDiscovered(discovered) {
      if (!discovered || typeof discovered !== 'object') return 0;
      var count = 0;
      var SKIP = { node: 1, git: 1, read: 1, write: 1, curl: 1 };
      for (var dname in discovered) {
        if (SKIP[dname]) continue;
        if (_tools[dname]) continue;
        var ver = discovered[dname] || '';
        (function(n, v) {
          register({
            name: n,
            description: '系统发现的外部命令: ' + n + (v ? ' (' + v.split('\n')[0] + ')' : '') + '。通过 ai-system-exec 调用。',
            category: 'discovered',
            schema: {
              type: 'object',
              properties: {
                args: { type: 'string', description: n + ' 的命令行参数' }
              },
              required: ['args']
            },
            executor: function(input) {
              if (!window.electronAPI || !window.electronAPI.aiSystemExec) return Promise.resolve({ success: false, error: '不可用' });
              return window.electronAPI.aiSystemExec({ tool: n, args: (input.args || '').split(/\s+/).filter(function(s) { return s; }), cwd: null, dangerLevel: 'read' });
            }
          });
        })(dname, ver);
        count++;
      }
      return count;
    }

    function scanAndRegister() {
      if (!window.electronAPI || !window.electronAPI.aiScanEnv) return Promise.resolve({ discovered: {}, count: 0 });
      return window.electronAPI.aiScanEnv().then(function(result) {
        if (!result || !result.discovered) return { discovered: {}, count: 0 };
        _discovered = result.discovered;
        var cnt = _registerDiscovered(_discovered);
        console.log('[ToolRegistry] 环境扫描完成，新发现 ' + cnt + ' 个工具');
        return { discovered: _discovered, count: cnt, scanTime: result.scanTime };
      });
    }

    function getDiscovered() {
      return _discovered;
    }

    function init() {
      if (window.electronAPI && window.electronAPI.aiCheckTools) {
        return window.electronAPI.aiCheckTools().then(function(avail) {
          _available = avail || {};
          _registerFromDefs(_available);
          return _available;
        }).catch(function() {
          _available = {};
          _registerFromDefs(_available);
          return _available;
        });
      }
      _available = {};
      _registerFromDefs(_available);
      return Promise.resolve(_available);
    }

    return Object.freeze({
      register: register,
      get: get,
      getApiDefinitions: getApiDefinitions,
      getToolDescriptions: getToolDescriptions,
      getNames: getNames,
      getAvailable: getAvailable,
      getDiscovered: getDiscovered,
      execute: execute,
      executeAll: executeAll,
      init: init,
      scanAndRegister: scanAndRegister
    });
  };
})();
