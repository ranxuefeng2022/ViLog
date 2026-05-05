/**
 * 公共常量
 */

/** 二进制文件扩展名（用于判断是否用 base64 编码） */
const BINARY_EXTENSIONS = [
  '.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.tgz',
  '.exe', '.dll', '.so', '.dylib',
  '.png', '.jpg', '.jpeg', '.gif', '.pdf',
  '.doc', '.docx', '.xls', '.xlsx', '.mp3', '.mp4', '.avi'
];

/** 压缩包扩展名（用于判断是否是归档文件） */
const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.tar', '.gz', '.tgz', '.rar', '.bz2', '.xz'];

/** 服务端端口 */
const ENGINE_PORT = 8082;

/** 日志文件最大大小 (10MB) */
const LOG_MAX_SIZE = 10 * 1024 * 1024;

/** 日志文件大小检查间隔 (ms) */
const LOG_STAT_CHECK_INTERVAL = 200;

/** 最近目录最大记录数 */
const MAX_RECENT_DIRS = 10;

/** ZIP 单文件提取上限 (50MB) */
const MAX_EXTRACT_SIZE = 50 * 1024 * 1024;

module.exports = {
  BINARY_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  ENGINE_PORT,
  LOG_MAX_SIZE,
  LOG_STAT_CHECK_INTERVAL,
  MAX_RECENT_DIRS,
  MAX_EXTRACT_SIZE
};
