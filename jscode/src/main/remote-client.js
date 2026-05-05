/**
 * 远程连接客户端模块
 */

const http = require('http');

function listRemoteDirectory(ip, port, remotePath = '') {
  return new Promise((resolve, reject) => {
    const url = `http://${ip}:${port}/api/list?path=${encodeURIComponent(remotePath)}`;

    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(new Error('解析响应失败'));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

function readRemoteFile(ip, port, remotePath) {
  return new Promise((resolve, reject) => {
    const url = `http://${ip}:${port}/api/read?path=${encodeURIComponent(remotePath)}`;

    http.get(url, (res) => {
      if (res.statusCode === 404) {
        resolve({ success: false, error: '文件不存在' });
        return;
      }

      const contentType = res.headers['content-type'];
      const chunks = [];

      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);

        if (contentType && contentType.includes('application/json')) {
          try {
            const result = JSON.parse(data.toString('utf8'));
            resolve(result);
          } catch (e) {
            resolve({ success: false, error: '解析响应失败' });
          }
          return;
        }

        resolve({
          success: true,
          content: data.toString('utf8'),
          encoding: 'utf8',
          size: data.length
        });
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

function getRemoteTree(ip, port, remotePath = '') {
  return new Promise((resolve, reject) => {
    const url = `http://${ip}:${port}/api/tree?path=${encodeURIComponent(remotePath)}`;

    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(new Error('解析响应失败'));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

module.exports = {
  listRemoteDirectory,
  readRemoteFile,
  getRemoteTree
};
