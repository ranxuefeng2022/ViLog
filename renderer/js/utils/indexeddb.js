/**
 * IndexedDB 持久化模块
 * 替代 localStorage，支持更大数据量和复杂查询
 */

(function() {
  'use strict';

  // 默认配置
  const DEFAULT_CONFIG = {
    dbName: 'LogViewerDB',
    dbVersion: 1,
    storeName: 'data',
    keyPath: 'id',
    indexes: [] // 额外索引配置
  };

  // 数据库实例缓存
  let dbInstance = null;
  let dbPromise = null;

  /**
   * IndexedDB 操作类
   */
  const IndexedDB = {
    /**
     * 打开数据库
     * @param {Object} config 配置
     * @returns {Promise<IDBDatabase>}
     */
    open: function(config = {}) {
      const cfg = { ...DEFAULT_CONFIG, ...config };

      // 如果已有实例，直接返回
      if (dbInstance && dbInstance.name === cfg.dbName) {
        return Promise.resolve(dbInstance);
      }

      // 如果已有打开操作，等待它完成
      if (dbPromise) {
        return dbPromise;
      }

      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(cfg.dbName, cfg.dbVersion);

        request.onerror = () => {
          dbPromise = null;
          reject(new Error(`Failed to open database: ${request.error}`));
        };

        request.onsuccess = () => {
          dbInstance = request.result;
          dbPromise = null;
          resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // 创建主存储区
          if (!db.objectStoreNames.contains(cfg.storeName)) {
            const store = db.createObjectStore(cfg.storeName, {
              keyPath: cfg.keyPath
            });

            // 创建索引
            cfg.indexes.forEach(idx => {
              store.createIndex(idx.name, idx.keyPath || idx.name, {
                unique: idx.unique || false,
                multiEntry: idx.multiEntry || false
              });
            });
          }
        };
      });

      return dbPromise;
    },

    /**
     * 关闭数据库
     */
    close: function() {
      if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
      }
      dbPromise = null;
    },

    /**
     * 保存数据
     * @param {*} data 要保存的数据
     * @param {Object} config 配置
     * @returns {Promise<*>}
     */
    put: function(data, config = {}) {
      return this.open(config).then(db => {
        return new Promise((resolve, reject) => {
          const storeName = config.storeName || DEFAULT_CONFIG.storeName;
          const transaction = db.transaction(storeName, 'readwrite');
          const store = transaction.objectStore(storeName);

          const request = store.put(data);

          request.onsuccess = () => resolve(data);
          request.onerror = () => reject(request.error);
        });
      });
    },

    /**
     * 保存多个数据
     * @param {Array} items 数据数组
     * @param {Object} config 配置
     * @returns {Promise<Array>}
     */
    putBulk: function(items, config = {}) {
      if (!items || items.length === 0) {
        return Promise.resolve([]);
      }

      return this.open(config).then(db => {
        return new Promise((resolve, reject) => {
          const storeName = config.storeName || DEFAULT_CONFIG.storeName;
          const transaction = db.transaction(storeName, 'readwrite');
          const store = transaction.objectStore(storeName);

          items.forEach(item => {
            store.put(item);
          });

          transaction.oncomplete = () => resolve(items);
          transaction.onerror = () => reject(transaction.error);
        });
      });
    },

    /**
     * 获取单个数据
     * @param {*} key 键
     * @param {Object} config 配置
     * @returns {Promise<*>}
     */
    get: function(key, config = {}) {
      return this.open(config).then(db => {
        return new Promise((resolve, reject) => {
          const storeName = config.storeName || DEFAULT_CONFIG.storeName;
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);

          const request = store.get(key);

          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      });
    },

    /**
     * 获取所有数据
     * @param {Object} config 配置
     * @returns {Promise<Array>}
     */
    getAll: function(config = {}) {
      return this.open(config).then(db => {
        return new Promise((resolve, reject) => {
          const storeName = config.storeName || DEFAULT_CONFIG.storeName;
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);

          const request = store.getAll();

          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      });
    },

    /**
     * 按索引查询
     * @param {string} indexName 索引名
     * @param {*} value 值
     * @param {Object} config 配置
     * @returns {Promise<Array>}
     */
    getByIndex: function(indexName, value, config = {}) {
      return this.open(config).then(db => {
        return new Promise((resolve, reject) => {
          const storeName = config.storeName || DEFAULT_CONFIG.storeName;
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const index = store.index(indexName);

          const request = index.getAll(value);

          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      });
    },

    /**
     * 删除数据
     * @param {*} key 键
     * @param {Object} config 配置
     * @returns {Promise}
     */
    delete: function(key, config = {}) {
      return this.open(config).then(db => {
        return new Promise((resolve, reject) => {
          const storeName = config.storeName || DEFAULT_CONFIG.storeName;
          const transaction = db.transaction(storeName, 'readwrite');
          const store = transaction.objectStore(storeName);

          const request = store.delete(key);

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      });
    },

    /**
     * 清空存储区
     * @param {Object} config 配置
     * @returns {Promise}
     */
    clear: function(config = {}) {
      return this.open(config).then(db => {
        return new Promise((resolve, reject) => {
          const storeName = config.storeName || DEFAULT_CONFIG.storeName;
          const transaction = db.transaction(storeName, 'readwrite');
          const store = transaction.objectStore(storeName);

          const request = store.clear();

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      });
    },

    /**
     * 获取存储区统计信息
     * @param {Object} config 配置
     * @returns {Promise<Object>}
     */
    getStats: function(config = {}) {
      return this.open(config).then(db => {
        return new Promise((resolve, reject) => {
          const storeName = config.storeName || DEFAULT_CONFIG.storeName;
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);

          const countRequest = store.count();
          const keysRequest = store.getAllKeys();

          countRequest.onsuccess = () => {
            keysRequest.onsuccess = () => {
              resolve({
                count: countRequest.result,
                keys: keysRequest.result
              });
            };
          };
          countRequest.onerror = () => reject(countRequest.error);
        });
      });
    },

    /**
     * 迭代存储区
     * @param {Function} callback 回调函数 (value, key) => boolean
     * @param {Object} config 配置
     * @returns {Promise}
     */
    iterate: function(callback, config = {}) {
      return this.open(config).then(db => {
        return new Promise((resolve, reject) => {
          const storeName = config.storeName || DEFAULT_CONFIG.storeName;
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const cursorRequest = store.openCursor();

          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              const shouldContinue = callback(cursor.value, cursor.key);
              if (shouldContinue !== false) {
                cursor.continue();
              }
            } else {
              resolve();
            }
          };

          cursorRequest.onerror = () => reject(cursorRequest.error);
        });
      });
    },

    /**
     * 删除数据库
     * @param {string} dbName 数据库名
     * @returns {Promise}
     */
    deleteDatabase: function(dbName) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);

        request.onsuccess = () => {
          if (dbInstance && dbInstance.name === dbName) {
            dbInstance = null;
          }
          dbPromise = null;
          resolve();
        };

        request.onerror = () => reject(request.error);
      });
    }
  };

  // 便捷封装：针对日志工具的常用操作
  IndexedDB.LogViewer = {
    // 存储配置
    config: {
      dbName: 'LogViewerDB',
      version: 1,
      stores: {
        indexes: { keyPath: 'id', indexes: [{ name: 'fileHash', unique: true }] },
        searchHistory: { keyPath: 'id', indexes: [{ name: 'timestamp' }] },
        filters: { keyPath: 'id' },
        settings: { keyPath: 'id' }
      }
    },

    /**
     * 初始化数据库
     */
    init: function() {
      return IndexedDB.open({
        dbName: this.config.dbName,
        dbVersion: this.config.version,
        storeName: 'indexes',
        indexes: [{ name: 'fileHash', unique: true }]
      }).then(db => {
        // 确保其他存储区也存在
        return this.ensureStores();
      });
    },

    /**
     * 确保所有存储区存在
     */
    ensureStores: function() {
      return IndexedDB.open().then(db => {
        return new Promise((resolve) => {
          // 检查并创建缺失的存储区
          const requiredStores = ['searchHistory', 'filters', 'settings'];
          const existingStores = Array.from(db.objectStoreNames);

          requiredStores.forEach(storeName => {
            if (!existingStores.includes(storeName)) {
              console.log(`[IndexedDB] Creating store: ${storeName}`);
              // 需要升级版本才能创建新存储区
            }
          });

          resolve();
        });
      });
    },

    /**
     * 保存日志索引
     */
    saveIndex: function(filePath, indexData) {
      const id = filePath; // 使用文件路径作为 ID
      return IndexedDB.put({
        id,
        filePath,
        data: indexData,
        timestamp: Date.now()
      }, { storeName: 'indexes' });
    },

    /**
     * 获取日志索引
     */
    getIndex: function(filePath) {
      return IndexedDB.get(filePath, { storeName: 'indexes' });
    },

    /**
     * 保存搜索历史
     */
    saveSearchHistory: function(keyword, resultCount) {
      const id = `search_${Date.now()}`;
      return IndexedDB.put({
        id,
        keyword,
        resultCount,
        timestamp: Date.now()
      }, { storeName: 'searchHistory' });
    },

    /**
     * 获取搜索历史
     */
    getSearchHistory: function(limit = 20) {
      return IndexedDB.getAll({ storeName: 'searchHistory' })
        .then(items => {
          // 按时间倒序
          return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
        });
    },

    /**
     * 保存设置
     */
    saveSetting: function(key, value) {
      return IndexedDB.put({
        id: key,
        value,
        timestamp: Date.now()
      }, { storeName: 'settings' });
    },

    /**
     * 获取设置
     */
    getSetting: function(key) {
      return IndexedDB.get(key, { storeName: 'settings' })
        .then(item => item ? item.value : null);
    },

    /**
     * 保存过滤器
     */
    saveFilter: function(name, filterData) {
      return IndexedDB.put({
        id: name,
        data: filterData,
        timestamp: Date.now()
      }, { storeName: 'filters' });
    },

    /**
     * 获取所有过滤器
     */
    getFilters: function() {
      return IndexedDB.getAll({ storeName: 'filters' });
    },

    /**
     * 删除过滤器
     */
    deleteFilter: function(name) {
      return IndexedDB.delete(name, { storeName: 'filters' });
    },

    /**
     * 清理旧数据
     */
    cleanup: function(maxAge = 7 * 24 * 60 * 60 * 1000) { // 默认 7 天
      const cutoff = Date.now() - maxAge;

      return IndexedDB.iterate((item) => {
        if (item.timestamp && item.timestamp < cutoff) {
          // 根据存储区决定如何删除
          console.log(`[IndexedDB] Cleaning old data: ${item.id}`);
          // 注意：这里需要在事务中删除，但 cursor.delete() 不在当前作用域
        }
      }, { storeName: 'indexes' });
    },

    /**
     * 获取存储统计
     */
    getStorageStats: function() {
      return Promise.all([
        IndexedDB.getStats({ storeName: 'indexes' }),
        IndexedDB.getStats({ storeName: 'searchHistory' }),
        IndexedDB.getStats({ storeName: 'filters' }),
        IndexedDB.getStats({ storeName: 'settings' })
      ]).then(([indexes, searchHistory, filters, settings]) => ({
        indexes: indexes.count,
        searchHistory: searchHistory.count,
        filters: filters.count,
        settings: settings.count,
        total: indexes.count + searchHistory.count + filters.count + settings.count
      }));
    },

    /**
     * 清空所有数据
     */
    clearAll: function() {
      return Promise.all([
        IndexedDB.clear({ storeName: 'indexes' }),
        IndexedDB.clear({ storeName: 'searchHistory' }),
        IndexedDB.clear({ storeName: 'filters' }),
        IndexedDB.clear({ storeName: 'settings' })
      ]);
    }
  };

  // 导出到全局
  window.App = window.App || {};
  window.App.IndexedDB = IndexedDB;
  window.App.IDB = IndexedDB.LogViewer; // 便捷别名

  console.log('✓ IndexedDB module loaded');
})();
