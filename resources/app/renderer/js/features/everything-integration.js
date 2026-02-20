/**
 * Everything 集成模块
 * 通过 Everything HTTP API 快速搜索文件
 */

window.App = window.App || {};
window.App.EverythingIntegration = {
  // Everything HTTP 服务器配置
  config: {
    baseUrl: 'http://localhost:8888',
    timeout: 5000
  },

  /**
   * 测试 Everything HTTP 服务器连接
   */
  async testConnection() {
    try {
      const response = await fetch(`${this.config.baseUrl}/?s=**&j=1&count=0`);
      const data = await response.json();
      return data && typeof data === 'object';
    } catch (error) {
      console.error('[Everything] 连接失败:', error);
      return false;
    }
  },

  /**
   * 搜索文件
   * @param {string} query - 搜索关键词（支持通配符 *）
   * @param {Object} options - 搜索选项
   * @param {number} options.offset - 结果偏移量
   * @param {number} options.count - 返回结果数量（默认100）
   * @param {string} options.path - 限制搜索路径
   * @param {string} options.sort - 排序方式（name、size、date等）
   * @param {boolean} options.ascending - 是否升序
   * @returns {Promise<Array>} 文件列表
   */
  async search(query, options = {}) {
    const {
      offset = 0,
      count = 100,
      path = '',
      sort = 'name',
      ascending = true
    } = options;

    try {
      // 构建查询参数
      const params = new URLSearchParams({
        s: query,           // 搜索关键词
        j: 1,              // JSON 格式
        count: count,       // 返回数量
        offset: offset,     // 偏移量
        sort: sort,         // 排序
        ascending: ascending ? '1' : '0'
        // 🔧 关键：添加参数以获取完整路径
      });

      // 🔧 修复：添加 'path' 列到返回结果中（Everything 1.4+ 支持）
      // 参考：https://www.voidtools.com/support/everything/cl_parameters/
      params.append('path_column', '1');  // 返回完整路径

      if (path) {
        params.append('path', path);
      }

      const url = `${this.config.baseUrl}/?${params.toString()}`;
      console.log(`[Everything] 搜索: ${url}`);

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`[Everything] 原始响应:`, data);

      // 🔧 调试：展开查看原始响应的所有字段
      console.log(`[Everything] 响应结构分析:`, JSON.stringify(data, null, 2));

      // 检查响应格式
      if (!data) {
        console.warn('[Everything] 响应为空');
        return [];
      }

      // Everything 可能返回不同的字段名
      const results = data.results || data;

      // 如果是数组，直接使用
      if (Array.isArray(results)) {
        // 转换为统一格式
        const files = results.map(item => {
          // 🔧 处理 Everything 可能返回的不同字段名
          // Everything HTTP API 可能的字段：
          // - name, filename
          // - path, folder_path, directory
          // - size, file_size
          // - date_modified, modified, date
          // - type, is_folder

          const name = item.name || item.filename || item.fileName || '';

          // 🔧 关键：尝试多个可能的路径字段
          let filePath = item.path || item.folder_path || item.folderPath ||
                        item.directory || item.dir || '';

          // 如果还是没有路径，但 Everything 返回了完整路径字段
          if (!filePath && item.full_path) {
            filePath = item.full_path;
          }

          // 如果还是没有路径，但 Everything 返回了路径列
          if (!filePath && item.path_column) {
            filePath = item.path_column;
          }

          const size = item.size || item.file_size || item.fileSize || 0;
          const dateModified = item.date_modified || item.dateModified ||
                             item.modified || item.date || 0;
          const type = item.type || (item.is_folder ? 'folder' : (item.isFolder ? 'folder' : 'file'));

          // 构造完整路径
          let fullPath = name;
          if (filePath) {
            // 确保使用正确的路径分隔符
            const normalizedPath = filePath.replace(/\//g, '\\').replace(/\\\\/g, '\\');
            if (!normalizedPath.endsWith('\\')) {
              fullPath = `${normalizedPath}\\${name}`;
            } else {
              fullPath = `${normalizedPath}${name}`;
            }
          }

          console.log(`[Everything] 映射字段: name=${name}, path=${filePath}, fullPath=${fullPath}`);

          return {
            name: name,
            path: filePath,  // 保持原样，可能是相对路径或空
            fullPath: fullPath,
            size: size,
            dateModified: dateModified,
            type: type,
            isFromEverything: true
          };
        });

        console.log(`[Everything] 找到 ${files.length} 个结果`);
        if (files.length > 0) {
          console.log(`[Everything] 第一个结果:`, files[0]);
        }
        return files;
      }

      // 如果是对象，检查 totalResults 等字段
      if (typeof results === 'object') {
        console.warn('[Everything] 响应格式异常:', results);
        return [];
      }

      console.warn('[Everything] 无搜索结果');
      return [];

    } catch (error) {
      console.error('[Everything] 搜索失败:', error);
      console.error('[Everything] 错误堆栈:', error.stack);
      throw new Error(`Everything 搜索失败: ${error.message}`);
    }
  },

  /**
   * 快速搜索日志文件（限定常见的日志扩展名）
   * @param {string} keyword - 搜索关键词
   * @returns {Promise<Array>} 日志文件列表
   */
  async searchLogFiles(keyword) {
    console.log(`[Everything] 搜索日志文件，关键词: "${keyword}"`);

    try {
      // 🔧 修复：先尝试直接搜索关键词（不添加扩展名）
      // 让 Everything 自动匹配所有文件
      const directResults = await this.search(keyword, { count: 100, sort: 'date_modified', ascending: false });
      console.log(`[Everything] 直接搜索找到 ${directResults.length} 个文件`);

      if (directResults.length > 0) {
        // 按修改时间降序排序
        directResults.sort((a, b) => new Date(b.dateModified) - new Date(a.dateModified));
        return directResults;
      }

      // 如果直接搜索没有结果，尝试添加通配符
      const wildcardQuery = `${keyword}*`;
      console.log(`[Everything] 尝试通配符搜索: "${wildcardQuery}"`);
      const wildcardResults = await this.search(wildcardQuery, { count: 100, sort: 'date_modified', ascending: false });
      console.log(`[Everything] 通配符搜索找到 ${wildcardResults.length} 个文件`);

      // 按修改时间降序排序
      wildcardResults.sort((a, b) => new Date(b.dateModified) - new Date(a.dateModified));

      return wildcardResults;

    } catch (error) {
      console.error('[Everything] 搜索日志文件失败:', error);
      throw error;
    }
  },

  /**
   * 获取统计信息
   */
  async getStats() {
    try {
      const response = await fetch(`${this.config.baseUrl}/?s=*&j=1&count=0`);
      const data = await response.json();
      return {
        total: data.totalResults || 0,
        version: data.version || 'unknown'
      };
    } catch (error) {
      console.error('[Everything] 获取统计信息失败:', error);
      return null;
    }
  }
};

console.log('✓ Everything Integration module loaded');
