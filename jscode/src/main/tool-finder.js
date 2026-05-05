/**
 * 外部工具查找 (es.exe, rg.exe, fzf.exe, 7z.exe)
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { find7z } = require('./utils');
const projectRoot = path.resolve(__dirname, '..', '..');

/**
 * 查找工具可执行文件（基于应用目录的相对路径查找）
 * @param {string} toolName - 工具名称
 * @returns {string|null} 找到的完整路径，未找到返回 null
 */
function findToolExecutable(toolName) {
  const appDir = process.resourcesPath || projectRoot;
  const cwd = process.cwd();

  const searchPaths = [
    path.join(appDir, 'tools', toolName),
    path.join(appDir, toolName),
    path.join(cwd, 'tools', toolName),
    path.join(cwd, toolName),
    toolName
  ];

  for (const testPath of searchPaths) {
    if (testPath === toolName) {
      try {
        spawn(testPath, ['--version'], { windowsHide: true, stdio: 'ignore' })
          .on('error', () => {});
        return toolName;
      } catch (e) {
        continue;
      }
    }

    if (fs.existsSync(testPath)) {
      return testPath;
    }
  }

  return null;
}

/**
 * 获取工具可执行文件的路径
 * @param {string} toolName - 工具名称
 * @param {string[]} defaultInstallPaths - 默认安装路径（作为备用）
 * @returns {string|null} 找到的完整路径
 */
function getToolPath(toolName, defaultInstallPaths = []) {
  const relativePath = findToolExecutable(toolName);
  if (relativePath) {
    console.log(`[工具] 找到 ${toolName}: ${relativePath} (相对路径)`);
    return relativePath;
  }

  for (const installPath of defaultInstallPaths) {
    if (fs.existsSync(installPath)) {
      console.log(`[工具] 找到 ${toolName}: ${installPath} (系统安装)`);
      return installPath;
    }
  }

  console.warn(`[工具] 未找到 ${toolName}`);
  return null;
}

function findEsExecutable() {
  const defaultPaths = [
    'C:\\Program Files\\Everything\\es.exe',
    'C:\\Program Files (x86)\\Everything\\es.exe'
  ];
  return getToolPath('es.exe', defaultPaths);
}

function findRgExecutable() {
  const defaultPaths = [
    'C:\\Program Files\\ripgrep\\rg.exe',
    'C:\\Program Files (x86)\\ripgrep\\rg.exe'
  ];
  return getToolPath('rg.exe', defaultPaths);
}

var _cachedFzfPath = null;
function findFzfExecutable() {
  if (_cachedFzfPath) return _cachedFzfPath;
  var found = findToolExecutable('fzf.exe');
  if (found) _cachedFzfPath = found;
  return found;
}

function find7zExecutable() {
  return find7z() || getToolPath('7z.exe', [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    '7z.exe'
  ]);
}

module.exports = {
  findToolExecutable,
  getToolPath,
  findEsExecutable,
  findRgExecutable,
  findFzfExecutable,
  find7zExecutable,
  getCachedFzfPath: () => _cachedFzfPath
};
