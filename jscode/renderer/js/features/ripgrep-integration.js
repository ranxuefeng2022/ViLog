/**
 * ripgrep (rg.exe) 集成模块 - 极速文本搜索
 * 比当前 JavaScript 过滤快 20-100 倍
 */

window.App = window.App || {};
window.App.Ripgrep = {
  // rg.exe 配置
  config: {
    exePath: './rg.exe',  // 相对于应用目录
    timeout: 30000,  // 30秒超时
    maxResults: 10000
  },

  /**
   * 测试 rg.exe 连接
   */
  async testConnection() {
    try {
      console.log('[Ripgrep] 测试连接...');

      // 获取应用目录
      const appDir = await window.electronAPI.getCwd();
      console.log('[Ripgrep] 应用目录:', appDir);

      // 尝试可能的 rg.exe 位置
      const possiblePaths = [
        './rg.exe',                    // 相对路径
        `${appDir}/rg.exe`,            // 应用目录
        'C:\\Tools\\ripgrep\\rg.exe',  // 自定义位置
        `${appDir.replace(/\//g, '\\')}/rg.exe`  // Windows路径
      ];

      // 测试每个路径，找到可用的 rg.exe
      for (const exePath of possiblePaths) {
        console.log(`[Ripgrep] 尝试路径: ${exePath}`);

        const result = await window.electronAPI.callRG({
          execPath: exePath,
          args: ['--version']
        });

        if (result.success) {
          // 保存找到的路径
          this.config.exePath = exePath;
          console.log('[Ripgrep] ✓ 找到 rg.exe:', exePath);
          console.log('[Ripgrep] 版本信息:', result.stdout.trim());
          return true;
        }
      }

      console.error('[Ripgrep] ✗ 未找到可用的 rg.exe');
      return false;

    } catch (error) {
      console.error('[Ripgrep] 测试连接异常:', error);
      return false;
    }
  },

  /**
   * 搜索日志文件中的关键词
   * @param {string} pattern - 搜索模式（支持正则）
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 搜索结果
   */
  async search(pattern, options = {}) {
    const {
      files = [],
      contextLines = 2,
      caseSensitive = false,
      maxResults = 1000,
      searchPath = null
    } = options;

    try {
      console.log(`[Ripgrep] 搜索: "${pattern}"`);

      const args = [
        pattern,
        '--line-number',
        '--no-heading',
        '--with-filename',
        '--color', 'never',
        '-n',
        '-a'
      ];

      if (contextLines > 0) {
        args.push('-C', contextLines.toString());
      }

      if (!caseSensitive) {
        args.push('-i');
      }

      if (maxResults) {
        args.push('-m', maxResults.toString());
      }

      if (files && files.length > 0) {
        args.push('--');
        args.push(...files);
      } else if (searchPath) {
        args.push(searchPath);
      } else {
        args.push('.');
      }

      const result = await window.electronAPI.callRG({
        execPath: this.config.exePath,
        args: args,
        cwd: searchPath || undefined
      });

      if (!result.success) {
        throw new Error(result.error || '搜索失败');
      }

      const matches = this.parseOutput(result.stdout, pattern);
      console.log(`[Ripgrep] 找到 ${matches.length} 个匹配`);

      return matches;

    } catch (error) {
      console.error('[Ripgrep] 搜索失败:', error);
      throw error;
    }
  },

  /**
   * 统计关键词在文件中出现的次数
   * @param {string} pattern - 搜索模式
   * @param {string|Array} files - 文件路径
   * @returns {Promise<Object>} 统计结果
   */
  async count(pattern, files) {
    try {
      console.log(`[Ripgrep] 统计: "${pattern}"`);

      const args = [
        pattern,
        '-c',              // 只显示匹配数量
        '--count-matches', // 统计匹配次数
        '-i',              // 忽略大小写
        '-a'               // 将二进制文件视为文本（强制搜索 .DAT 等文件）
      ];

      if (Array.isArray(files)) {
        args.push('--');
        args.push(...files);
      } else {
        args.push(files);
      }

      const result = await window.electronAPI.callRG({
        execPath: this.config.exePath,
        args: args
      });

      if (!result.success) {
        throw new Error(result.error || '统计失败');
      }

      // 解析统计结果
      const counts = {};
      const lines = result.stdout.trim().split('\n');

      for (const line of lines) {
        // 格式: 文件路径:匹配次数
        const match = line.match(/^([^:]+):(\d+)$/);
        if (match) {
          const [, filePath, count] = match;
          counts[filePath] = parseInt(count, 10);
        }
      }

      return counts;

    } catch (error) {
      console.error('[Ripgrep] 统计失败:', error);
      throw error;
    }
  },

  /**
   * 解析 rg.exe 的输出
   * 用 indexOf 手动拆分替代正则匹配，百万行级别性能提升显著
   * @param {string} output - rg.exe 的原始输出
   * @param {string} pattern - 搜索模式（用于高亮）
   * @returns {Array} 解析后的匹配结果
   */
  parseOutput(output, pattern) {
    if (!output) return [];

    const results = [];
    const lines = output.split('\n');

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (!line) continue;

      // rg 输出格式: 文件路径:行号:内容
      // 用 indexOf 手动拆分，比 line.match(/^([^:]+):(\d+):(.*)$/) 快 3-5 倍
      const firstColon = line.indexOf(':');
      if (firstColon === -1) continue;

      const secondColon = line.indexOf(':', firstColon + 1);
      if (secondColon === -1) continue;

      const filePath = line.substring(0, firstColon);
      const lineNumStr = line.substring(firstColon + 1, secondColon);
      const content = line.substring(secondColon + 1);

      // 快速跳过无效行号
      const lineNumber = parseInt(lineNumStr, 10);
      if (isNaN(lineNumber)) continue;

      results.push({
        filePath: filePath,
        lineNumber: lineNumber,
        content: content,
        isMatch: true
      });
    }

    return results;
  },

  /**
   * 快速搜索（只返回文件路径和行号，不返回内容）
   * @param {string} pattern - 搜索模式
   * @param {string} searchPath - 搜索目录
   * @returns {Promise<Array>} 匹配位置列表
   */
  async quickSearch(pattern, searchPath) {
    try {
      console.log(`[Ripgrep] 快速搜索: "${pattern}"`);

      const args = [
        pattern,
        '-l',              // 只显示匹配的文件名
        '-i',              // 忽略大小写
        '-a',              // 将二进制文件视为文本（强制搜索 .DAT 等文件）
        searchPath
      ];

      const result = await window.electronAPI.callRG({
        execPath: this.config.exePath,
        args: args,
        cwd: searchPath
      });

      if (!result.success) {
        throw new Error(result.error || '搜索失败');
      }

      // 返回匹配的文件列表
      return result.stdout.trim().split('\n').filter(line => line);

    } catch (error) {
      console.error('[Ripgrep] 快速搜索失败:', error);
      throw error;
    }
  },

  /**
   * 设置 rg.exe 路径
   * @param {string} path - rg.exe 的完整路径
   */
  setExePath(path) {
    this.config.exePath = path;
    console.log(`[Ripgrep] rg.exe 路径已设置为: ${path}`);
  },

  /**
   * 获取 rg.exe 版本信息
   */
  async getVersion() {
    try {
      const result = await window.electronAPI.callRG({
        execPath: this.config.exePath,
        args: ['--version']
      });

      if (result.success) {
        return result.stdout.trim();
      }

      return null;

    } catch (error) {
      console.error('[Ripgrep] 获取版本失败:', error);
      return null;
    }
  }
};

console.log('✓ Ripgrep Integration module loaded');
