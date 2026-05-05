/**
 * 远程目录共享 - HTTP 服务器模块
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { isBinaryFile } = require('./utils');

let localServer = null;
let localServerPort = 0;
let localSharePath = '';
let localServerConnections = new Set();

function getDirectoryContents(dirPath, basePath = '') {
  const result = {
    directories: [],
    files: []
  };

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        result.directories.push({
          name: entry.name,
          path: relativePath
        });
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          result.files.push({
            name: entry.name,
            path: relativePath,
            size: stats.size,
            mtime: stats.mtime.toISOString()
          });
        } catch (e) {
          // 忽略无法访问的文件
        }
      }
    }
  } catch (error) {
    console.error(`[远程共享] 读取目录失败: ${dirPath}`, error.message);
  }

  result.directories.sort((a, b) => a.name.localeCompare(b.name));
  result.files.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}

function getDirectoryTree(dirPath, basePath = '', depth = 3, currentDepth = 0) {
  if (currentDepth >= depth) {
    return { directories: [], files: [] };
  }

  const result = getDirectoryContents(dirPath, basePath);

  for (const dir of result.directories) {
    const fullPath = path.join(dirPath, dir.name);
    const children = getDirectoryTree(fullPath, dir.name, depth, currentDepth + 1);
    dir.children = children;
  }

  return result;
}

function startLocalServer(sharePath, port = 8080) {
  return new Promise((resolve, reject) => {
    if (localServer) {
      stopLocalServer();
    }

    localSharePath = sharePath;

    localServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      try {
        const url = new URL(req.url, `http://localhost:${localServerPort}`);
        const action = url.pathname;
        const queryPath = url.searchParams.get('path') || '';

        console.log(`[远程共享] 请求: ${action}, path: ${queryPath}`);

        if (action === '/api/info') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            sharePath: localSharePath,
            rootName: path.basename(localSharePath)
          }));
        } else if (action === '/api/list') {
          const targetPath = queryPath ? path.join(localSharePath, queryPath) : localSharePath;
          const contents = getDirectoryContents(targetPath, queryPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            path: queryPath,
            ...contents
          }));
        } else if (action === '/api/tree') {
          const targetPath = queryPath ? path.join(localSharePath, queryPath) : localSharePath;
          const tree = getDirectoryTree(targetPath, queryPath, 3, 0);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            path: queryPath,
            ...tree
          }));
        } else if (action === '/api/read') {
          const targetPath = queryPath ? path.join(localSharePath, queryPath) : localSharePath;
          if (!queryPath || !fs.existsSync(targetPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '文件不存在' }));
            return;
          }

          const stats = fs.statSync(targetPath);
          const size = stats.size;
          const isBinary = isBinaryFile(targetPath);

          if (size > 10 * 1024 * 1024 || isBinary) {
            const content = fs.readFileSync(targetPath);
            const base64Content = content.toString('base64');
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'X-Content-Transfer-Encoding': 'base64'
            });
            res.end(JSON.stringify({
              success: true,
              content: base64Content,
              encoding: 'base64',
              size: size
            }));
          } else {
            const content = fs.readFileSync(targetPath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(content);
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '未知操作' }));
        }
      } catch (error) {
        console.error('[远程共享] 处理请求失败:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    });

    localServer.on('connection', (conn) => {
      localServerConnections.add(conn);
      conn.on('close', () => localServerConnections.delete(conn));
    });

    localServer.on('error', (err) => {
      console.error('[远程共享] 服务器错误:', err);
      reject(err);
    });

    localServer.listen(port, '0.0.0.0', () => {
      localServerPort = localServer.address().port;
      console.log(`[远程共享] 服务器已启动: 0.0.0.0:${localServerPort}`);
      console.log(`[远程共享] 共享目录: ${localSharePath}`);
      resolve({
        port: localServerPort,
        ip: getLocalIP()
      });
    });

    localServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        localServer.close();
        localServer.listen(0, '0.0.0.0', () => {
          localServerPort = localServer.address().port;
          console.log(`[远程共享] 服务器已启动: 0.0.0.0:${localServerPort}`);
          console.log(`[远程共享] 共享目录: ${localSharePath}`);
          resolve({
            port: localServerPort,
            ip: getLocalIP()
          });
        });
      }
    });
  });
}

function stopLocalServer() {
  return new Promise((resolve) => {
    if (localServer) {
      for (const conn of localServerConnections) {
        conn.destroy();
      }
      localServerConnections.clear();

      localServer.close(() => {
        console.log('[远程共享] 服务器已停止');
        localServer = null;
        localServerPort = 0;
        localSharePath = '';
        resolve(true);
      });
    } else {
      resolve(true);
    }
  });
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function isLocalServerRunning() {
  return localServer !== null;
}

function getLocalServerInfo() {
  if (!localServer) {
    return null;
  }
  return {
    running: true,
    port: localServerPort,
    ip: getLocalIP(),
    sharePath: localSharePath
  };
}

module.exports = {
  startLocalServer,
  stopLocalServer,
  getLocalIP,
  isLocalServerRunning,
  getLocalServerInfo,
  getLocalServer: () => localServer,
  getLocalServerPort: () => localServerPort,
  getLocalSharePath: () => localSharePath
};
