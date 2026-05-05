/**
 * 日志系统 - 主进程日志写入文件
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { ipcMain, app } = require('electron');
const { LOG_MAX_SIZE, LOG_STAT_CHECK_INTERVAL } = require('./constants');

// 日志状态
let logFilePath = null;
let logWriteStream = null;
let logBytesWritten = 0;
let logWriteCountSinceStat = 0;
let isRotating = false;
let rotatePendingBuffer = [];

function initLogSystem() {
  const logsDir = path.join(app.getPath('userData'), 'logs');

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  logFilePath = path.join(logsDir, `logview_${timestamp}.log`);

  logWriteStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  logBytesWritten = 0;
  logWriteCountSinceStat = 0;
  isRotating = false;
  rotatePendingBuffer = [];

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args) => {
    originalLog.apply(console, args);
    writeToLog('INFO', args);
  };

  console.error = (...args) => {
    originalError.apply(console, args);
    writeToLog('ERROR', args);
  };

  console.warn = (...args) => {
    originalWarn.apply(console, args);
    writeToLog('WARN', args);
  };

  writeToLog('SYSTEM', ['=== LogView 启动 ===']);
  writeToLog('SYSTEM', [`日志文件: ${logFilePath}`]);
  writeToLog('SYSTEM', [`平台: ${os.platform()}`, `架构: ${os.arch()}`, `Node: ${process.version}`]);
}

function writeToLog(level, args) {
  if (!logWriteStream) return;

  try {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const logLine = `[${timestamp}] [${level}] ${message}\n`;

    if (logBytesWritten > LOG_MAX_SIZE) {
      logWriteCountSinceStat++;
      if (logWriteCountSinceStat >= LOG_STAT_CHECK_INTERVAL) {
        logWriteCountSinceStat = 0;
        try {
          const stats = fs.statSync(logFilePath);
          logBytesWritten = stats.size;
        } catch (e) { /* 文件不存在则保持计数器值 */ }
      }

      if (logBytesWritten > LOG_MAX_SIZE) {
        rotateLogFile(logLine);
        return;
      }
    }

    if (isRotating) {
      rotatePendingBuffer.push(logLine);
      return;
    }

    logWriteStream.write(logLine);
    logBytesWritten += Buffer.byteLength(logLine, 'utf8');
  } catch (error) {
    // 日志写入失败，不要打印错误避免无限循环
  }
}

function rotateLogFile(pendingLine) {
  if (isRotating) {
    rotatePendingBuffer.push(pendingLine);
    return;
  }

  isRotating = true;
  rotatePendingBuffer.push(pendingLine);

  const oldStream = logWriteStream;
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const newPath = path.join(app.getPath('userData'), 'logs', `logview_${timestamp}.log`);

  logWriteStream = fs.createWriteStream(newPath, { flags: 'a' });
  logFilePath = newPath;
  logBytesWritten = 0;
  logWriteCountSinceStat = 0;

  const buffered = rotatePendingBuffer;
  rotatePendingBuffer = [];
  for (const line of buffered) {
    logWriteStream.write(line);
    logBytesWritten += Buffer.byteLength(line, 'utf8');
  }

  oldStream.end(() => {
    isRotating = false;
    if (rotatePendingBuffer.length > 0) {
      const remaining = rotatePendingBuffer;
      rotatePendingBuffer = [];
      for (const line of remaining) {
        logWriteStream.write(line);
        logBytesWritten += Buffer.byteLength(line, 'utf8');
      }
    }
  });
}

function closeLogSystem() {
  if (logWriteStream) {
    writeToLog('SYSTEM', ['=== LogView 关闭 ===']);
    logWriteStream.end();
    logWriteStream = null;
  }
}

function registerIpcHandlers() {
  ipcMain.handle('save-log', async (event, { level, message, data }) => {
    try {
      if (!logWriteStream) {
        return { success: false, error: '日志系统未初始化' };
      }

      const timestamp = new Date().toISOString();
      let logMessage = message;

      if (data) {
        if (typeof data === 'object') {
          try {
            logMessage += ' ' + JSON.stringify(data, null, 2);
          } catch (e) {
            logMessage += ' ' + String(data);
          }
        } else {
          logMessage += ' ' + String(data);
        }
      }

      const logLine = `[${timestamp}] [RENDERER:${level}] ${logMessage}\n`;
      logWriteStream.write(logLine);

      return { success: true };
    } catch (error) {
      console.error('保存日志失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-log-file-path', async () => {
    return {
      success: true,
      logFilePath: logFilePath,
      logsDir: path.join(app.getPath('userData'), 'logs')
    };
  });
}

module.exports = {
  registerIpcHandlers,
  initLogSystem,
  writeToLog,
  closeLogSystem,
  getLogFilePath: () => logFilePath,
  getLogWriteStream: () => logWriteStream
};
