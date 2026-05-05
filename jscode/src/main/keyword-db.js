/**
 * 关键词持久化存储（SQLite — better-sqlite3）
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { ipcMain } = require('electron');

const { findFzfExecutable } = require('./tool-finder');
const Database = require('better-sqlite3');
const projectRoot = path.resolve(__dirname, '..', '..');

// Delay import of windows to avoid circular deps
let getWindows = () => [];

function setWindowsGetter(fn) {
  getWindows = fn;
}


const memDir = path.join(projectRoot, 'mem');
const dbPath = path.join(memDir, 'keywords.db');

// 确保 mem 目录存在
if (!fs.existsSync(memDir)) {
  try { fs.mkdirSync(memDir, { recursive: true }); } catch(e) { console.warn('创建 mem 目录失败:', e); }
}

// better-sqlite3 是同步 API，直接打开数据库文件
let keywordDB = null;

function initKeywordDB(db) {
  // WAL 模式：读写互不阻塞，写操作只追加 WAL 文件（增量写盘）
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB 缓存

  // 创建表
  db.exec(`CREATE TABLE IF NOT EXISTS keywords (
    text TEXT PRIMARY KEY,
    count INTEGER DEFAULT 1,
    lastUsed INTEGER
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kw_lastUsed ON keywords(lastUsed DESC)`);

  // 马尔可夫转移表
  db.exec(`CREATE TABLE IF NOT EXISTS transitions (
    from_kw TEXT,
    to_kw TEXT,
    count INTEGER DEFAULT 1,
    PRIMARY KEY (from_kw, to_kw)
  )`);

  // 关键词组合历史表（自动记录每次多关键词过滤，去重存储）
  db.exec(`CREATE TABLE IF NOT EXISTS filter_combos (
    combo_hash TEXT PRIMARY KEY,
    keywords_sorted TEXT,
    keywords_original TEXT,
    count INTEGER DEFAULT 1,
    lastUsed INTEGER
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_combo_lastUsed ON filter_combos(lastUsed DESC)`);
}

/**
 * 获取 DB 连接，支持自动重连（db 文件被删除后自动重建）
 */
function getKeywordDB() {
  // 快速路径：缓存连接仍然有效
  if (keywordDB) {
    try {
      keywordDB.prepare('SELECT 1').get();
      return keywordDB;
    } catch (e) {
      console.warn('[KeywordDB] 数据库连接失效，自动重建:', e.message);
      try { keywordDB.close(); } catch (_) {}
      keywordDB = null;
      clearStmtCache();
    }
  }

  // 确保 mem 目录存在
  if (!fs.existsSync(memDir)) {
    try { fs.mkdirSync(memDir, { recursive: true }); } catch(e) { console.warn('创建 mem 目录失败:', e); }
  }

  keywordDB = new Database(dbPath);
  initKeywordDB(keywordDB);
  console.log('[KeywordDB] 数据库初始化完成（better-sqlite3 WAL 模式）');
  return keywordDB;
}

// 预编译语句（只编译一次，重复使用，性能最优）
let stmtUpsert = null;
let stmtDelete = null;
let stmtSelectKeywords = null;

/** 清空预编译语句缓存（重连时必须调用，旧 statement 绑定了旧连接） */
function clearStmtCache() {
  stmtUpsert = null;
  stmtDelete = null;
  stmtSelectKeywords = null;
}

function getStmtUpsert() {
  if (!stmtUpsert) stmtUpsert = getKeywordDB().prepare('INSERT OR REPLACE INTO keywords (text, count, lastUsed) VALUES (?, ?, ?)');
  return stmtUpsert;
}
function getStmtDelete() {
  if (!stmtDelete) stmtDelete = getKeywordDB().prepare('DELETE FROM keywords WHERE text = ?');
  return stmtDelete;
}
function getStmtSelectKeywords() {
  if (!stmtSelectKeywords) stmtSelectKeywords = getKeywordDB().prepare('SELECT text, count, lastUsed FROM keywords');
  return stmtSelectKeywords;
}
// fzf 关键词文本缓存（避免每次搜索从 renderer 传全量数据）
var _cachedFzfKeywords = null;

function refreshFzfKeywordCache() {
  try {
    const db = getKeywordDB();
    const rows = db.prepare('SELECT text FROM keywords ORDER BY lastUsed DESC').all();
    _cachedFzfKeywords = rows.map(r => r.text);
  } catch (e) {
    _cachedFzfKeywords = null;
  }
}


ipcMain.handle('keyword-load-all', async () => {
  try {
    const db = getKeywordDB();
    const keywords = db.prepare('SELECT text, count, lastUsed FROM keywords ORDER BY lastUsed DESC').all();
    // 刷新 fzf 缓存
    _cachedFzfKeywords = keywords.map(k => k.text);
    return { success: true, data: { keywords } };
  } catch (e) {
    console.error('[KeywordDB] 加载失败:', e);
    return { success: false, error: e.message };
  }
});

// 批量写入关键词（事务 + 预编译语句）
ipcMain.handle('keyword-upsert-batch', async (event, kws) => {
  try {
    const stmt = getStmtUpsert();
    const insertMany = getKeywordDB().transaction((items) => {
      for (const kw of items) {
        stmt.run(kw.text, kw.count || 1, kw.lastUsed || Date.now());
      }
    });
    insertMany(kws);
    _cachedFzfKeywords = null; // 使 fzf 缓存失效，下次搜索时重建
    return { success: true };
  } catch (e) {
    console.error('[KeywordDB] 批量写入失败:', e);
    return { success: false, error: e.message };
  }
});

// 删除单个关键词
ipcMain.handle('keyword-delete', async (event, text) => {
  try {
    getStmtDelete().run(text);
    _cachedFzfKeywords = null;
    return { success: true };
  } catch (e) {
    console.error('[KeywordDB] 删除失败:', e);
    return { success: false, error: e.message };
  }
});

// 批量删除超限关键词（内存截断后清理 DB 残留）
// 使用临时表避免 NOT IN (?,?...) 超过 SQLite 999 参数上限
ipcMain.handle('keyword-trim', async (event, keepTexts) => {
  try {
    const db = getKeywordDB();
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _keep_texts (text TEXT PRIMARY KEY)');
    const clearTmp = db.prepare('DELETE FROM _keep_texts');
    const insertTmp = db.prepare('INSERT OR IGNORE INTO _keep_texts (text) VALUES (?)');
    const deleteNotIn = db.prepare('DELETE FROM keywords WHERE text NOT IN (SELECT text FROM _keep_texts)');

    const doTrim = db.transaction(() => {
      clearTmp.run();
      for (let i = 0; i < keepTexts.length; i++) {
        insertTmp.run(keepTexts[i]);
      }
      deleteNotIn.run();
    });
    doTrim();
    _cachedFzfKeywords = null;
    return { success: true };
  } catch (e) {
    console.error('[KeywordDB] 清理超限关键词失败:', e);
    return { success: false, error: e.message };
  }
});

// 多窗口关键词变更广播
ipcMain.handle('keyword-broadcast', async (event, action, data) => {
  try {
    const senderId = event.sender.id;
    for (const win of getWindows()) {
      const wc = win.webContents;
      if (!wc.isDestroyed() && wc.id !== senderId) {
        wc.send('keyword-changed', action, data);
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 保存马尔可夫转移数据（增量 count+1，不依赖内存状态）
ipcMain.handle('keyword-save-transitions', async (event, transPairs) => {
  try {
    const db = getKeywordDB();
    const stmt = db.prepare(`INSERT INTO transitions (from_kw, to_kw, count) VALUES (?, ?, 1)
      ON CONFLICT(from_kw, to_kw) DO UPDATE SET count = count + 1`);
    const upsertMany = db.transaction((items) => {
      if (Array.isArray(items)) {
        for (const p of items) stmt.run(p.from_kw, p.to_kw);
      }
    });
    upsertMany(transPairs);
    return { success: true };
  } catch (e) {
    console.error('[KeywordDB] 保存转移数据失败:', e);
    return { success: false, error: e.message };
  }
});

// 获取指定关键词的马尔可夫转移（懒加载，按需查询）
ipcMain.handle('keyword-get-transitions', async (event, fromKw) => {
  try {
    const db = getKeywordDB();
    const rows = db.prepare('SELECT to_kw, count FROM transitions WHERE from_kw = ? ORDER BY count DESC LIMIT 30').all(fromKw || '');
    const result = {};
    for (const r of rows) result[r.to_kw] = r.count;
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// SQL 端搜索关键词（LIKE 过滤 + LIMIT，避免全量加载）
// v2: 空格容忍 — 同时用原始 query 和去空格版本做 LIKE 匹配
ipcMain.handle('keyword-search', async (event, options) => {
  try {
    const db = getKeywordDB();
    const query = (options && options.query) || '';
    const limit = (options && options.limit) || 300;
    if (query) {
      // 去空格版本：如 "ch ch" → "chch"
      const compactQuery = query.replace(/\s+/g, '');
      // 如果去空格后和原始一样，只需一条查询
      if (compactQuery === query) {
        const rows = db.prepare('SELECT text, count, lastUsed FROM keywords WHERE text LIKE ? ORDER BY lastUsed DESC LIMIT ?')
          .all('%' + query + '%', limit);
        return { success: true, data: rows };
      }
      // 空格拆分为多 token，每个 token 都做 LIKE 匹配（AND 语义）
      const tokens = query.trim().split(/\s+/).filter(Boolean);
      if (tokens.length > 1) {
        // 多 token：每个 token 必须 LIKE 匹配
        const conditions = tokens.map(() => 'text LIKE ?').join(' AND ');
        const params = tokens.map(t => '%' + t + '%');
        params.push(limit);
        const rows = db.prepare(
          'SELECT text, count, lastUsed FROM keywords WHERE ' + conditions + ' ORDER BY lastUsed DESC LIMIT ?'
        ).all(...params);
        return { success: true, data: rows };
      }
      // 单 token 但有空格（如 "ch "），用去空格版本
      const rows = db.prepare('SELECT text, count, lastUsed FROM keywords WHERE text LIKE ? OR text LIKE ? ORDER BY lastUsed DESC LIMIT ?')
        .all('%' + query + '%', '%' + compactQuery + '%', limit);
      return { success: true, data: rows };
    }
    const rows = db.prepare('SELECT text, count, lastUsed FROM keywords ORDER BY lastUsed DESC LIMIT ?')
      .all(limit);
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// fzf 模糊搜索关键词（调用 fzf.exe --filter）
ipcMain.handle('keyword-search-fzf', async (event, options) => {
  try {
    const query = (options && options.query) || '';
    // 优先使用 main 进程缓存，避免每次从 renderer 传全量数据
    var keywords = _cachedFzfKeywords;
    if (!keywords || keywords.length === 0) {
      refreshFzfKeywordCache();
      keywords = _cachedFzfKeywords;
    }
    // 如果缓存仍为空，尝试用 renderer 传来的数据作为兜底
    if (!keywords || keywords.length === 0) {
      keywords = (options && options.keywords) || [];
    }

    if (!query || keywords.length === 0) {
      return { success: false, fallback: true };
    }

    const execPath = findFzfExecutable();
    if (!execPath) {
      return { success: false, fallback: true };
    }

    return new Promise((resolve) => {
      let fzfProcess;

      // 直接 spawn fzf.exe，由 Node.js spawn 正确处理参数（含空格）
      // 不经过 cmd.exe，避免环境变量展开和引号转义问题
      fzfProcess = spawn(execPath, ['--filter', query, '--no-sort'], {
        windowsHide: true,
        env: Object.assign({}, process.env)
      });

      // 通过 stdin 传入所有关键词（每行一个）
      // 监听 stdin error 防止进程提前退出时 write EOF 崩溃
      fzfProcess.stdin.on('error', () => {});
      let resolved = false;
      const safeResolve = (val) => {
        if (!resolved) { resolved = true; resolve(val); }
      };

      const input = keywords.join('\n');
      try {
        fzfProcess.stdin.write(input, 'utf8');
        fzfProcess.stdin.end();
      } catch (e) {
        // 进程已退出，stdin 写入失败，不算致命
      }

      let stdout = '';
      let stderr = '';

      fzfProcess.stdout.on('data', (data) => {
        stdout += data.toString('utf8');
      });

      fzfProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      fzfProcess.on('close', (code) => {
        if (code === 0 || code === 1) {
          // fzf --filter 返回 1 表示无匹配，仍属正常
          const lines = stdout.trim().split('\n').filter(Boolean);
          safeResolve({ success: true, data: lines });
        } else {
          safeResolve({ success: false, fallback: true, error: stderr });
        }
      });

      fzfProcess.on('error', (error) => {
        safeResolve({ success: false, fallback: true, error: error.message });
      });

      // 3 秒超时
      setTimeout(() => {
        fzfProcess.kill();
        safeResolve({ success: false, fallback: true, error: 'timeout' });
      }, 3000);
    });
  } catch (e) {
    return { success: false, fallback: true, error: e.message };
  }
});

// 保存关键词组合（自动去重，sorted hash 作主键）
ipcMain.handle('keyword-save-combo', async (event, combo) => {
  try {
    const db = getKeywordDB();
    // combo: { comboHash, keywordsSorted, keywordsOriginal }
    db.prepare(`INSERT INTO filter_combos (combo_hash, keywords_sorted, keywords_original, count, lastUsed)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(combo_hash) DO UPDATE SET count = count + 1, lastUsed = excluded.lastUsed, keywords_original = excluded.keywords_original`)
      .run(combo.comboHash, combo.keywordsSorted, combo.keywordsOriginal, Date.now());

    // 超过 1000 条时清理最旧的
    const total = db.prepare('SELECT COUNT(*) as c FROM filter_combos').get().c;
    if (total > 1000) {
      db.prepare(`DELETE FROM filter_combos WHERE combo_hash NOT IN (
        SELECT combo_hash FROM filter_combos ORDER BY lastUsed DESC LIMIT 1000
      )`).run();
    }
    return { success: true };
  } catch (e) {
    console.error('[KeywordDB] 保存关键词组合失败:', e);
    return { success: false, error: e.message };
  }
});

// 加载关键词组合历史
ipcMain.handle('keyword-load-combos', async () => {
  try {
    const db = getKeywordDB();
    const combos = db.prepare('SELECT combo_hash, keywords_sorted, keywords_original, count, lastUsed FROM filter_combos ORDER BY lastUsed DESC LIMIT 200').all();
    return { success: true, data: combos };
  } catch (e) {
    console.error('[KeywordDB] 加载关键词组合失败:', e);
    return { success: false, error: e.message };
  }
});

// 删除关键词组合（用 keywords_sorted 匹配，避免 \0 在 HTML 属性中丢失）
ipcMain.handle('keyword-delete-combo', async (event, keywordsSorted) => {
  try {
    const db = getKeywordDB();
    db.prepare('DELETE FROM filter_combos WHERE keywords_sorted = ?').run(keywordsSorted);
    return { success: true };
  } catch (e) {
    console.error('[KeywordDB] 删除关键词组合失败:', e);
    return { success: false, error: e.message };
  }
});

// 读取文件内容 - 支持 WinRAR 拖拽（异步版本，不阻塞主进程）

function registerIpcHandlers() {
  // All IPC handlers are registered at module load time above
}

module.exports = {
  registerIpcHandlers,
  setWindowsGetter,
  getKeywordDB: () => keywordDB
};
