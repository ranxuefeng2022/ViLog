/**
 * Vlog 日志解析器 - 纯前端实现
 *
 * 功能：
 * - 解析vlog格式日志为CSV数据
 * - 每3行一条记录：时间戳 + 版本 + 数据
 */

(function() {
  'use strict';

  /**
   * Vlog 解析器类
   */
  class VlogParser {
    constructor() {
      // 字段名称定义（共21个字段）
      this.fieldNames = [
        '电量', '电池状态', '充电状态', '屏幕状态', '充电量', '耗电量',
        '显示电量', '亮度', '电池电压', '电流', '电池温度', '板温',
        '充电电压', '充电类型', 'Otg状态', '库伦量', 'Ibus', '线阻抗',
        'Esr', 'Rslow'
      ];
    }

    /**
     * 解析vlog文本内容
     * @param {string} content - vlog文件内容
     * @returns {Object} 解析结果 { success: boolean, data: Array, error: string }
     */
    parse(content) {
      try {
        const startTime = performance.now();

        // 按行分割，移除空行
        const lines = content.split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0);

        console.log(`[VlogParser] 开始解析，共 ${lines.length} 行`);

        // 时间戳正则：YYYY-MM-DD HH:MM:SS
        const timestampRegex = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/;

        const records = [];
        let i = 0;

        // 逐行扫描，寻找符合格式的时间戳行
        while (i < lines.length) {
          const line = lines[i];

          // 检查是否为时间戳行
          if (timestampRegex.test(line)) {
            // 找到时间戳，检查后面2行是否分别是版本号和数据行
            if (i + 2 < lines.length) {
              const timestamp = lines[i];
              const version = lines[i + 1];
              const dataLine = lines[i + 2];

              // 验证版本号格式（不为空，且不是时间戳或v1t0开头）
              const isValidVersion = version &&
                                   !timestampRegex.test(version) &&
                                   !version.startsWith('v1t0:') &&
                                   !version.startsWith('===');

              // 验证数据行格式
              const isValidData = dataLine && dataLine.startsWith('v1t0:');

              if (isValidVersion && isValidData) {
                // 解析这条有效记录
                const record = this.parseRecord(timestamp, version, dataLine);
                if (record) {
                  records.push(record);
                }
                // 跳过这3行，继续处理
                i += 3;
                continue;
              }
            }
          }

          // 不是有效的记录开始，跳到下一行
          i++;
        }

        // 按时间字段排序（确保时间顺序）
        records.sort((a, b) => {
          const timeA = a['时间'] || '';
          const timeB = b['时间'] || '';
          return timeA.localeCompare(timeB);
        });

        const elapsed = performance.now() - startTime;
        console.log(`[VlogParser] 解析完成: ${records.length} 条记录, 已按时间排序, 耗时 ${elapsed.toFixed(1)}ms`);

        return {
          success: true,
          data: records,
          recordCount: records.length,
          elapsed: elapsed
        };

      } catch (error) {
        console.error('[VlogParser] 解析失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }

    /**
     * 解析单条记录
     * @param {string} timestamp - 时间戳
     * @param {string} version - 版本号
     * @param {string} dataLine - 数据行 (v1t0:...)
     * @returns {Object|null} 解析后的记录对象
     */
    parseRecord(timestamp, version, dataLine) {
      // 移除 v1t0: 前缀
      const dataStr = dataLine.substring(5);
      const values = dataStr.split(',');

      // 构建记录对象
      const record = {
        '时间': timestamp,
        '版本': version
      };

      // 映射字段值
      for (let i = 0; i < this.fieldNames.length; i++) {
        const fieldName = this.fieldNames[i];
        const value = values[i] || '';
        record[fieldName] = value;
      }

      return record;
    }

    /**
     * 将解析结果转换为CSV数组格式
     * @param {Array} records - 解析后的记录数组
     * @returns {Array} CSV数组（第一行是表头，后面是数据）
     */
    toCSV(records) {
      if (!records || records.length === 0) {
        return [];
      }

      // 获取所有字段名（保持顺序：时间 + 版本 + 数据字段）
      const firstRecord = records[0];
      const fieldNames = ['时间', '版本', ...this.fieldNames];

      // 生成CSV数组
      const csvArray = [];

      // 表头
      csvArray.push(fieldNames);

      // 数据行
      for (const record of records) {
        const row = fieldNames.map(name => {
          const value = record[name] || '';
          return value;
        });
        csvArray.push(row);
      }

      return csvArray;
    }

    /**
     * 检测文件是否为vlog格式
     * @param {string} content - 文件内容
     * @returns {boolean} 是否为vlog格式
     */
    isVlogFormat(content) {
      const lines = content.split('\n').slice(0, 10); // 检查前10行

      // 检查是否有 v1t0: 开头的行
      let hasV1t0 = false;
      let hasTimestamp = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('v1t0:')) {
          hasV1t0 = true;
        }
        // 检查时间戳格式 (YYYY-MM-DD HH:MM:SS)
        if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
          hasTimestamp = true;
        }
      }

      return hasV1t0 && hasTimestamp;
    }
  }

  // 导出到全局
  window.VlogParser = VlogParser;

  console.log('[VlogParser] 模块已加载');

})();
