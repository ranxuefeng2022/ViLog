/**
 * 过滤关键词历史模块
 * 功能：
 * 1. 将过滤关键词保存到 IndexedDB
 * 2. 从 IndexedDB 读取历史关键词
 * 3. 使用 fzf 进行模糊匹配
 * 4. 管理建议下拉菜单
 */

(function() {
  'use strict';

  // 存储配置
  const STORAGE_KEY = 'logViewerFilterKeywords';
  const MAX_HISTORY = 200; // 最多保存 200 条历史记录

  // 状态
  let keywords = [];
  let isFzfAvailable = null; // null = 未检测, true = 可用, false = 不可用

  // ========== IndexedDB 操作 ==========

  /**
   * 加载关键词历史
   */
  async function loadKeywords() {
    try {
      // 优先使用 IndexedDB
      if (window.App && window.App.IDB) {
        const filters = await window.App.IDB.getFilters();
        if (filters && filters[STORAGE_KEY]) {
          keywords = filters[STORAGE_KEY].keywords || [];
          console.log('[FilterKeywordHistory] 从 IndexedDB 加载关键词:', keywords.length);
          return keywords;
        }
      }

      // 降级到 localStorage
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        keywords = JSON.parse(saved);
        console.log('[FilterKeywordHistory] 从 localStorage 加载关键词:', keywords.length);
        return keywords;
      }

      keywords = [];
      return keywords;
    } catch (e) {
      console.error('[FilterKeywordHistory] 加载关键词失败:', e);
      keywords = [];
      return keywords;
    }
  }

  /**
   * 保存关键词历史
   */
  async function saveKeywords() {
    try {
      // 保存到 IndexedDB
      if (window.App && window.App.IDB) {
        await window.App.IDB.saveFilter(STORAGE_KEY, { keywords, timestamp: Date.now() });
      }

      // 同时保存到 localStorage 作为备份
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keywords));

      console.log('[FilterKeywordHistory] 保存关键词:', keywords.length);
    } catch (e) {
      console.error('[FilterKeywordHistory] 保存关键词失败:', e);
    }
  }

  /**
   * 添加关键词到历史
   * @param {string} keyword - 要添加的关键词
   */
  async function addKeyword(keyword) {
    if (!keyword || keyword.trim() === '') return;

    keyword = keyword.trim();

    // 检查是否已存在
    const existingIndex = keywords.indexOf(keyword);
    if (existingIndex !== -1) {
      // 如果已存在，移动到最前面
      keywords.splice(existingIndex, 1);
    }

    // 添加到最前面
    keywords.unshift(keyword);

    // 限制数量
    if (keywords.length > MAX_HISTORY) {
      keywords = keywords.slice(0, MAX_HISTORY);
    }

    await saveKeywords();
  }

  /**
   * 批量添加关键词（用于解析用 | 分隔的输入）
   * @param {string} input - 输入字符串，可能包含 | 分隔的多个关键词
   */
  async function addKeywordsFromInput(input) {
    if (!input || input.trim() === '') return;

    // 解析 | 分隔的关键词，考虑转义的 \|
    const parts = input.split(/(?<!\\)\|/).map(s => s.replace(/\\\|/g, '|').trim()).filter(s => s);

    for (const part of parts) {
      await addKeyword(part);
    }

    // 同时保存完整的输入（作为一个整体）
    await addKeyword(input);
  }

  /**
   * 获取所有关键词
   */
  function getKeywords() {
    return keywords;
  }

  // ========== fzf 模糊匹配 ==========

  /**
   * 检测 fzf 是否可用
   */
  async function checkFzfAvailable() {
    if (isFzfAvailable !== null) {
      return isFzfAvailable;
    }

    try {
      if (!window.electronAPI || !window.electronAPI.callFZF) {
        isFzfAvailable = false;
        return false;
      }

      // 测试调用
      const result = await window.electronAPI.callFZF({ query: '', keywords: ['test'] });
      isFzfAvailable = result.success || (result.error && !result.error.includes('未找到'));
      return isFzfAvailable;
    } catch (e) {
      console.log('[FilterKeywordHistory] fzf 不可用:', e.message);
      isFzfAvailable = false;
      return false;
    }
  }

  /**
   * 使用 fzf 进行模糊匹配
   * @param {string} query - 查询字符串
   * @param {Array<string>} candidates - 候选关键词列表
   * @returns {Promise<Array<string>>} 匹配结果
   */
  async function fuzzyMatch(query, candidates = keywords) {
    if (!query || query.trim() === '') {
      // 空查询返回所有候选（最多 50 条）
      return candidates.slice(0, 50);
    }

    // 尝试使用 fzf
    if (await checkFzfAvailable()) {
      try {
        const result = await window.electronAPI.callFZF({
          query: query,
          keywords: candidates
        });

        if (result.success && result.matches) {
          console.log('[FilterKeywordHistory] fzf 匹配结果:', result.matches.length);
          return result.matches;
        }
      } catch (e) {
        console.warn('[FilterKeywordHistory] fzf 匹配失败，降级到简单匹配:', e);
      }
    }

    // 降级到简单匹配
    const lowerQuery = query.toLowerCase();
    return candidates.filter(kw => kw.toLowerCase().includes(lowerQuery));
  }

  // ========== UI 交互 ==========

  /**
   * 显示建议菜单
   * @param {HTMLElement} inputElement - 输入框元素
   * @param {HTMLElement} suggestionsElement - 建议容器元素
   * @param {Function} onSelect - 选中回调函数
   */
  async function showSuggestions(inputElement, suggestionsElement, onSelect) {
    const query = inputElement.value.trim();

    // 获取匹配结果
    const matches = await fuzzyMatch(query);

    // 清空建议列表
    suggestionsElement.innerHTML = '';

    // 如果没有匹配结果，隐藏菜单
    if (matches.length === 0) {
      suggestionsElement.classList.remove('visible');
      return;
    }

    // 创建建议项
    matches.forEach((keyword, index) => {
      const item = document.createElement('div');
      item.className = 'filter-suggestion-item';
      item.textContent = keyword;
      item.dataset.index = index;

      item.addEventListener('click', () => {
        inputElement.value = keyword;
        if (onSelect) onSelect(keyword);
        hideSuggestions(suggestionsElement);
      });

      suggestionsElement.appendChild(item);
    });

    // 显示菜单
    suggestionsElement.classList.add('visible');

    // 返回匹配数量（用于调试）
    return matches.length;
  }

  /**
   * 隐藏建议菜单
   */
  function hideSuggestions(suggestionsElement) {
    suggestionsElement.classList.remove('visible');
    suggestionsElement.innerHTML = '';
  }

  /**
   * 处理键盘导航
   * @param {KeyboardEvent} e - 键盘事件
   * @param {HTMLElement} suggestionsElement - 建议容器元素
   * @param {number} selectedIndex - 当前选中的索引
   * @returns {number} 新的选中索引
   */
  function handleKeyDown(e, suggestionsElement, selectedIndex) {
    const items = suggestionsElement.querySelectorAll('.filter-suggestion-item');
    if (items.length === 0) return selectedIndex;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        break;
      case 'Enter':
        if (selectedIndex >= 0) {
          e.preventDefault();
          items[selectedIndex].click();
          selectedIndex = -1;
        }
        break;
      case 'Escape':
        hideSuggestions(suggestionsElement);
        selectedIndex = -1;
        break;
    }

    // 更新选中状态
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });

    return selectedIndex;
  }

  // ========== 初始化 ==========

  /**
   * 初始化模块
   */
  async function init() {
    console.log('[FilterKeywordHistory] 初始化中...');
    await loadKeywords();
    await checkFzfAvailable();
    console.log('[FilterKeywordHistory] 初始化完成，关键词数量:', keywords.length, 'fzf 可用:', isFzfAvailable);
  }

  // 导出到全局
  window.App = window.App || {};
  window.App.FilterKeywordHistory = {
    init,
    addKeyword,
    addKeywordsFromInput,
    getKeywords,
    fuzzyMatch,
    showSuggestions,
    hideSuggestions,
    handleKeyDown,
    isFzfAvailable: () => isFzfAvailable
  };

  console.log('[FilterKeywordHistory] 模块已加载');
})();
