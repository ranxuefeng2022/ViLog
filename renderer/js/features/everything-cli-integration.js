/**
 * Everything CLI 集成模块 (使用 es.exe 命令行工具)
 * 通过 IPC 调用主进程的 es.exe
 */

window.App = window.App || {};
window.App.EverythingCLI = {
  // es.exe 配置
  config: {
    // 🔧 es.exe 的路径 - 默认使用 app 目录下的 es.exe
    exePath: './es.exe',  // 相对于应用目录
    timeout: 10000,  // 10秒超时
    maxResults: 10000  // 🔧 增加到10000个结果
  },

  /**
   * 测试 es.exe 连接
   */
  async testConnection() {
    try {
      console.log('[Everything CLI] 测试连接...');

      // 🔧 先尝试获取应用目录，然后检测 es.exe
      const appDir = await window.electronAPI.getCwd();
      console.log('[Everything CLI] 应用目录:', appDir);

      // 尝试可能的 es.exe 位置
      const possiblePaths = [
        './es.exe',                    // 相对路径
        `${appDir}/es.exe`,            // 应用目录
        'C:\\Program Files\\Everything\\es.exe',  // 默认安装位置
        'C:\\Tools\\Everything\\es.exe'  // 自定义位置
      ];

      // 测试每个路径，找到可用的 es.exe
      for (const exePath of possiblePaths) {
        console.log(`[Everything CLI] 尝试路径: ${exePath}`);

        const result = await window.electronAPI.callES({
          execPath: exePath,
          args: ['*.log', '-count', '0']
        });

        if (result.success) {
          // 保存找到的路径
          this.config.exePath = exePath;
          console.log('[Everything CLI] ✓ 找到 es.exe:', exePath);
          return true;
        }
      }

      console.error('[Everything CLI] ✗ 未找到可用的 es.exe');
      return false;

    } catch (error) {
      console.error('[Everything CLI] 测试连接异常:', error);
      return false;
    }
  },

  /**
   * 搜索文件
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 文件列表
   */
  async search(query, options = {}) {
    const {
      count = 10000,  // 🔧 增加默认结果数量到10000
      sort = 'date-modified',  // 🔧 修复：使用横杠而不是下划线
      ascending = false  // 默认降序（最新的在前）
    } = options;

    try {
      console.log(`[Everything CLI] 搜索: ${query}`);

      // 🔧 构建命令行参数（修复参数格式）
      // es.exe 参数参考：https://www.voidtools.com/support/everything/command_line_index.html
      // 注意：排序方向需要附加到排序字段后面，例如：date-modified-descending
      const sortValue = `${sort}-${ascending ? 'ascending' : 'descending'}`;
      const args = [
        query,                    // 搜索模式
        '-json',                  // JSON 格式输出
        '-count', String(count),  // 返回结果数量
        '-sort', sortValue,       // 排序字段和方向（组合在一起）
        '-size',                  // 添加文件大小字段
        '-date-modified'          // 添加修改日期字段
      ];

      console.log(`[Everything CLI] 执行命令: es.exe ${args.join(' ')}`);
      console.log(`[Everything CLI] 使用路径: ${this.config.exePath}`);

      const result = await window.electronAPI.callES({
        execPath: this.config.exePath,  // 使用检测到的路径
        args: args
      });

      if (!result.success) {
        throw new Error(result.error || '搜索失败');
      }

      // 解析 JSON 输出
      let files = [];
      try {
        files = JSON.parse(result.stdout || '[]');
      } catch (parseError) {
        console.error('[Everything CLI] JSON 解析失败:', parseError);
        console.error('[Everything CLI] 原始输出:', result.stdout);
        throw new Error('解析搜索结果失败');
      }

      console.log(`[Everything CLI] 找到 ${files.length} 个结果`);

      if (files.length > 0) {
        console.log(`[Everything CLI] 第一个结果:`, files[0]);
      }

      return files;

    } catch (error) {
      console.error('[Everything CLI] 搜索失败:', error);
      throw error;
    }
  },

  /**
   * 搜索日志文件
   * @param {string} keyword - 搜索关键词
   * @returns {Promise<Array>} 日志文件列表
   */
  async searchLogFiles(keyword) {
    console.log(`[Everything CLI] 搜索日志文件: "${keyword}"`);

    try {
      // 🔧 使用通配符搜索，确保能匹配到文件和目录
      // *keyword* 会匹配路径中任何位置包含关键词的文件和目录
      const searchQuery = keyword.includes('*') || keyword.includes('?') || keyword.includes('/') ?
        keyword :
        `*${keyword}*`;

      const files = await this.search(searchQuery, {
        count: 10000,  // 🔧 增加到10000个结果
        sort: 'date-modified',
        ascending: false
      });

      // es.exe 已经按 date-modified-descending 排序，无需再次排序
      return files;

    } catch (error) {
      console.error('[Everything CLI] 搜索日志文件失败:', error);
      throw error;
    }
  },

  /**
   * 设置 es.exe 路径
   * @param {string} path - es.exe 的完整路径
   */
  setExePath(path) {
    this.config.exePath = path;
    console.log(`[Everything CLI] es.exe 路径已设置为: ${path}`);
  }
};

console.log('✓ Everything CLI Integration module loaded');
