/**
 * Python / 引擎进程管理
 */

const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { ENGINE_PORT } = require('./constants');
const projectRoot = path.resolve(__dirname, '..', '..');

let engineProcess = null;
let cachedPythonCommand = null;

function detectPythonCommand() {
  if (cachedPythonCommand) {
    console.log(`使用缓存的Python命令: ${cachedPythonCommand}`);
    return cachedPythonCommand;
  }

  const pythonCommands = ['python3', 'python', 'python3.exe', 'python.exe'];
  let index = 0;

  function tryNext() {
    if (index >= pythonCommands.length) {
      console.warn('⚠️ 未找到Python命令，串口日志等Python功能可能不可用');
      return;
    }
    const cmd = pythonCommands[index++];
    exec(`${cmd} --version`, { timeout: 2000 }, (err) => {
      if (!err) {
        cachedPythonCommand = cmd;
        console.log(`✓ 检测到Python命令: ${cachedPythonCommand}`);
      } else {
        tryNext();
      }
    });
  }
  tryNext();
}

function startEngineProcess() {
  if (process.platform !== 'win32') {
    console.log('非 Windows 平台，跳过启动服务端进程');
    return;
  }

  const enginePath = path.join(projectRoot, 'vivo_log_engine.exe');

  if (!fs.existsSync(enginePath)) {
    console.warn('服务端程序不存在:', enginePath);
    console.warn('请运行 build-engine.bat 编译服务端程序');
    return;
  }

  exec(`netstat -ano | findstr "LISTENING" | findstr ":${ENGINE_PORT}"`, (error, stdout) => {
    if (stdout && stdout.trim()) {
      console.log(`端口 ${ENGINE_PORT} 已被占用，跳过启动服务端`);
      return;
    }

    console.log('正在启动服务端进程...');
    engineProcess = spawn(enginePath, [ENGINE_PORT.toString()], {
      windowsHide: true,
      detached: false
    });

    engineProcess.on('error', (err) => {
      console.error('启动服务端进程失败:', err);
    });

    engineProcess.stdout.on('data', (data) => {
      console.log('[服务端]', data.toString());
    });

    engineProcess.stderr.on('data', (data) => {
      console.error('[服务端错误]', data.toString());
    });

    engineProcess.on('close', (code) => {
      console.log(`服务端进程退出，代码: ${code}`);
      engineProcess = null;
    });

    setTimeout(() => {
      if (engineProcess && !engineProcess.killed) {
        console.log(`服务端进程已启动，PID: ${engineProcess.pid}`);
      }
    }, 1000);
  });
}

function stopEngineProcess() {
  if (engineProcess && !engineProcess.killed) {
    console.log('正在停止服务端进程...');
    engineProcess.kill('SIGTERM');
    setTimeout(() => {
      if (engineProcess && !engineProcess.killed) {
        console.log('强制停止服务端进程...');
        engineProcess.kill('SIGKILL');
      }
    }, 5000);
  }
}

module.exports = {
  detectPythonCommand,
  startEngineProcess,
  stopEngineProcess,
  getEngineProcess: () => engineProcess,
  getCachedPythonCommand: () => cachedPythonCommand
};
