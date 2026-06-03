/**
 * Dynamic Island — Help 子模块
 * 管理帮助弹窗的创建、打开和关闭（懒创建）
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  window.App._DI.createHelp = function() {
    var _modal = null;

    function createModal() {
      _modal = document.createElement('div');
      _modal.id = 'diHelpModal';
      var content = document.createElement('div');
      content.id = 'diHelpContent';
      content.innerHTML = '<h2>使用指南</h2>'
        + '<div class="di-subtitle">高性能日志查看分析工具 · AI 驱动</div>'

        + '<div class="di-section"><div class="di-section-title">AI 对话</div>'
        + '<div class="di-row">内置 Agent 能力，对话式日志分析：搜索关键词、解析数据、生成图表</div>'
        + '<div class="di-row">支持多轮推理 + 工具调用 + Skills，自动分析定位问题</div>'
        + '</div>'

        + '<div class="di-section"><div class="di-section-title">文件树</div>'
        + '<div class="di-row"><span class="di-k">Ctrl+F</span> 聚焦搜索，输入即跳转</div>'
        + '<div class="di-row">支持展开 .7z .rar .zip 压缩包，直接浏览内部文件</div>'
        + '<div class="di-row"><span class="di-k">单击</span> 选中 &middot; <span class="di-k">Ctrl+单击</span> 多选 &middot; <span class="di-k">拖选</span> 范围选择</div>'
        + '<div class="di-row"><span class="di-k">右键</span> 多功能菜单：文件过滤、日志自动化解析等</div>'
        + '</div>'

        + '<div class="di-section"><div class="di-section-title">主日志框</div>'
        + '<div class="di-row">分片加载 + 虚拟滚动，G 级日志流畅不卡、几乎不占内存</div>'
        + '<div class="di-row">支持表格、曲线图、统计计算、高亮、关键词模糊搜索</div>'
        + '<div class="di-row">UTC 时间戳一键转换 · 灵动岛悬浮显示处理进度与功能按钮</div>'
        + '<div class="di-row"><span class="di-k">Ctrl+F</span> 搜索 &middot; <span class="di-k">F</span> 弹出关键词过滤</div>'
        + '</div>'

        + '<div class="di-section"><div class="di-section-title">过滤面板</div>'
        + '<div class="di-row"><span class="di-k">Ctrl+H</span> 显示/隐藏面板</div>'
        + '<div class="di-row">多关键词 <span class="di-k">|</span> 分隔 · 正则 · 二级过滤 · 高亮</div>'
        + '</div>'

        + '<div class="di-section"><div class="di-section-title">快捷键速查</div>'
        + '<div class="di-grid">'
        + '<span><span class="di-k">Ctrl+F</span> 搜索</span><span><span class="di-k">Ctrl+K</span> 过滤</span>'
        + '<span><span class="di-k">Ctrl+H</span> 面板显隐</span><span><span class="di-k">F</span> 弹出过滤框</span>'
        + '<span><span class="di-k">F5</span> 清空结果</span><span><span class="di-k">Alt+X</span> 全屏</span>'
        + '</div></div>';
      var closeBtn = document.createElement('button');
      closeBtn.id = 'diHelpClose';
      closeBtn.textContent = '×';
      content.appendChild(closeBtn);
      _modal.appendChild(content);
      document.body.appendChild(_modal);
      _modal.addEventListener('click', function(e) { if (e.target === _modal) close(); });
      closeBtn.addEventListener('click', close);
    }

    function open() {
      if (!_modal) createModal();
      _modal.classList.add('visible');
    }

    function close() {
      if (_modal) _modal.classList.remove('visible');
    }

    function init() {
      // Modal is lazily created on first open
    }

    function destroy() {
      if (_modal && _modal.parentNode) _modal.parentNode.removeChild(_modal);
      _modal = null;
    }

    return { init: init, open: open, close: close, destroy: destroy };
  };
})();
