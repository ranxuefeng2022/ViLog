/**
 * 代码更新模块
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { exec, spawn } = require('child_process');
const { ipcMain } = require('electron');
const { find7z } = require('./utils');
const projectRoot = path.resolve(__dirname, '..', '..');

/**
 * 从远程服务器下载并更新代码
 */
ipcMain.handle('update-code', async (event, { serverUrl }) => {
  const https = require('https');
  const http = require('http');
  const os = require('os');
  const path = require('path');
  const fs = require('fs');

  console.log(`[代码更新] 开始从 ${serverUrl} 更新代码`);

  try {
    // 1. 验证服务器 URL
    let url;
    try {
      url = new URL(serverUrl);
    } catch (e) {
      return { success: false, error: '无效的服务器地址' };
    }

    // 2. 下载 ZIP 文件
    const downloadUrl = `${url.origin}/download`;
    console.log(`[代码更新] 正在下载: ${downloadUrl}`);

    const zipBuffer = await new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;

      client.get(downloadUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });

    console.log(`[代码更新] 下载完成，大小: ${zipBuffer.length} bytes`);

    // 3. 保存到临时文件
    const tempDir = os.tmpdir();
    const tempZipPath = path.join(tempDir, `code-update-${Date.now()}.zip`);
    fs.writeFileSync(tempZipPath, zipBuffer);
    console.log(`[代码更新] 已保存到临时文件: ${tempZipPath}`);

    // 4. 解压并覆盖
    console.log(`[代码更新] 开始解压...`);
    const appDir = projectRoot;

    await new Promise((resolve, reject) => {
      const { spawn, exec } = require('child_process');

      if (process.platform === 'win32') {
        // Windows: 使用 7za.exe
        const sevenZipPath = find7z();
        if (!sevenZipPath) {
          reject(new Error('未找到 7z 工具，请确保 7za.exe 在 7z 目录下'));
          return;
        }

        // 使用 7z 解压到 app 目录，覆盖所有文件
        const unzipCommand = spawn(sevenZipPath, [
          'x',
          tempZipPath,
          `-o${appDir}`,
          '-y',
          '-aoa' // 覆盖所有文件
        ]);

        unzipCommand.stdout.on('data', (data) => {
          console.log(`[代码更新] ${data.toString().trim()}`);
        });

        unzipCommand.stderr.on('data', (data) => {
          console.error(`[代码更新] ${data.toString().trim()}`);
        });

        unzipCommand.on('close', (code) => {
          if (code === 0) {
            console.log(`[代码更新] 解压完成`);
            resolve();
          } else {
            reject(new Error(`解压失败，退出码: ${code}`));
          }
        });

        unzipCommand.on('error', reject);
      } else {
        // Linux/Mac: 使用 unzip 命令
        console.log(`[代码更新] 使用 unzip 解压...`);

        exec(`unzip -o "${tempZipPath}" -d "${appDir}"`, (error, stdout, stderr) => {
          if (error) {
            console.error(`[代码更新] 解压失败:`, error);
            reject(new Error(`解压失败: ${error.message}`));
            return;
          }
          console.log(`[代码更新] 解压完成`);
          if (stdout) console.log(`[代码更新] ${stdout}`);
          resolve();
        });
      }
    });

    // 5. 清理临时文件
    try {
      fs.unlinkSync(tempZipPath);
      console.log(`[代码更新] 已清理临时文件`);
    } catch (e) {
      console.warn(`[代码更新] 清理临时文件失败:`, e.message);
    }

    console.log(`[代码更新] ✅ 更新完成！`);
    return {
      success: true,
      message: '代码更新完成，请重启应用'
    };

  } catch (error) {
    console.error(`[代码更新] ❌ 失败:`, error);
    return { success: false, error: error.message };
  }
});

/**
 * 检查更新服务器状态
 */
ipcMain.handle('check-update-server', async (event, { serverUrl }) => {
  const https = require('https');
  const http = require('http');

  console.log(`[代码更新] 检查服务器: ${serverUrl}`);

  try {
    let url;
    try {
      url = new URL(serverUrl);
    } catch (e) {
      return { success: false, error: '无效的服务器地址' };
    }

    const infoUrl = `${url.origin}/info`;
    console.log(`[代码更新] 获取服务器信息: ${infoUrl}`);

    const info = await new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;

      client.get(infoUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('解析响应失败'));
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    });

    console.log(`[代码更新] 服务器信息:`, info);
    return { success: true, info };

  } catch (error) {
    console.error(`[代码更新] 检查服务器失败:`, error);
    return { success: false, error: error.message };
  }
});

function registerIpcHandlers() {
  // All IPC handlers are registered at module load time above
}

module.exports = { registerIpcHandlers };
