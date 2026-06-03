/**
 * Config Store — 通用 JSON 配置文件持久化
 *
 * 配置文件路径: app.getPath('userData')/config.json
 * 所有模块共享同一文件，按 namespace 隔离（如 fileTree.starredDirs）
 *
 * IPC channels:
 *   config-get    — 读取配置项（支持点分路径）
 *   config-set    — 写入配置项
 *   config-delete — 删除配置项
 *   config-get-all — 读取全部配置
 */

const path = require('path');
const fs = require('fs');
const { ipcMain, app } = require('electron');

let configPath = null;
let configCache = null;
let writeTimer = null;

const DEBOUNCE_MS = 300;

function getConfigPath() {
  if (!configPath) {
    configPath = path.join(app.getPath('userData'), 'config.json');
  }
  return configPath;
}

function readConfigFromDisk() {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8');
      const data = JSON.parse(raw);
      return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    }
  } catch (e) {
    console.error('[ConfigStore] 读取配置文件失败:', e.message);
  }
  return {};
}

function writeConfigToDisk() {
  try {
    const p = getConfigPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(configCache, null, 2), 'utf-8');
  } catch (e) {
    console.error('[ConfigStore] 写入配置文件失败:', e.message);
  }
}

function debouncedWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeConfigToDisk();
    writeTimer = null;
  }, DEBOUNCE_MS);
}

function ensureLoaded() {
  if (configCache === null) {
    configCache = readConfigFromDisk();
  }
}

function getByPath(obj, keyPath) {
  if (!keyPath) return obj;
  const parts = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[parts[i]];
  }
  return current;
}

function setByPath(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] == null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
}

function deleteByPath(obj, keyPath) {
  const parts = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== 'object') return;
    current = current[parts[i]];
  }
  if (current != null && typeof current === 'object') {
    delete current[parts[parts.length - 1]];
  }
}

function registerIpcHandlers() {
  ipcMain.handle('config-get', (event, keyPath) => {
    ensureLoaded();
    return getByPath(configCache, keyPath);
  });

  ipcMain.handle('config-set', (event, keyPath, value) => {
    ensureLoaded();
    setByPath(configCache, keyPath, value);
    debouncedWrite();
    return true;
  });

  ipcMain.handle('config-delete', (event, keyPath) => {
    ensureLoaded();
    deleteByPath(configCache, keyPath);
    debouncedWrite();
    return true;
  });

  ipcMain.handle('config-get-all', () => {
    ensureLoaded();
    return JSON.parse(JSON.stringify(configCache));
  });

  app.on('before-quit', () => {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
      writeConfigToDisk();
    }
  });
}

module.exports = { registerIpcHandlers, get: function(keyPath) { ensureLoaded(); return getByPath(configCache, keyPath); } };
