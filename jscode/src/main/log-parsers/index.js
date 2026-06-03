'use strict';

const path = require('path');
const fs = require('fs');

const parsers = new Map();

function register(keyword, parser, platform) {
  const key = keyword + '_' + (platform || 'default');
  parsers.set(key, { keyword, platform: platform || 'default', parser });
}

function getKeywords() {
  return Array.from(parsers.keys());
}

function getParser(keyword) {
  const entry = parsers.get(keyword);
  return entry ? entry.parser : undefined;
}

function getKeywordsWithInfo(platform) {
  const result = [];
  for (const [key, entry] of parsers) {
    if (platform && entry.platform !== platform) continue;
    const tabName = entry.parser.getTabName ? entry.parser.getTabName() : entry.keyword;
    result.push({ keyword: key, tabName, platform: entry.platform });
  }
  return result;
}

function parseLine(line, sourceFile, platform) {
  for (const [key, entry] of parsers) {
    if (platform && entry.platform !== platform) continue;
    if (line.includes(entry.keyword)) {
      const data = entry.parser.parse(line, sourceFile);
      if (data) return { matched: true, keyword: key, data };
    }
  }
  return null;
}

const RENDERER_DIR = path.join(__dirname, 'renderer');
const CSS_DIR = path.join(RENDERER_DIR, 'css');
const JS_DIR = path.join(RENDERER_DIR, 'js');
const CSS_FILES = ['base.css', 'table.css', 'dialogs.css', 'chart.css', 'link-panel.css'];
const JS_FILES = ['state.js', 'utils.js', 'data-access.js', 'tabs.js', 'canvas-renderer.js', 'selection.js', 'search.js', 'goto.js', 'stats.js', 'chart-renderer.js', 'export.js', 'iface-dialog.js', 'col-dialog.js', 'link-panel.js', 'row-detail.js', 'app.js'];

function readRendererFiles() {
  var css = CSS_FILES.map(f => fs.readFileSync(path.join(CSS_DIR, f), 'utf8')).join('\n');
  var js = JS_FILES.map(f => fs.readFileSync(path.join(JS_DIR, f), 'utf8')).join('\n');
  return { css: css, js: js };
}

function generateStaticHTML(embeddedTabs, embeddedData) {
  const hasEmbedded = embeddedTabs && embeddedData;
  const embedScript = hasEmbedded
    ? '<script>var __EMBEDDED_TABS=' + JSON.stringify(embeddedTabs).replace(new RegExp('<\\\\/script','gi'),'<\\/scri"+"pt') + ';var __EMBEDDED_DATA=' + JSON.stringify(embeddedData).replace(new RegExp('<\\\\/script','gi'),'<\\/scri"+"pt') + ';</scri' + 'pt>'
    : '';
  // In standalone (exported) mode, hide window controls
  const winCtrlsStyle = hasEmbedded ? ' style="display:none"' : '';
  const exportReportBtn = hasEmbedded ? '' : '<button class="tb-btn" id="exportReportBtn">导出报告</button>';

  const { css, js } = readRendererFiles();

  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<title>日志分析报告</title>\n<style>\n'
    + css + '\n</style>\n</head>\n<body>\n'
    + embedScript + '\n'
    + '<div class="tabs" id="tabBar">\n'
    + '<div class="toolbar-scroll" id="toolbarScroll">\n'
    + '<button class="tb-btn" id="ifaceBtn">打印格式</button>\n'
    + '<button class="tb-btn" id="colBtn">选择列</button>\n'
    + '<button class="tb-btn" id="chartBtn">趋势图</button>\n'
    + '<button class="tb-btn" id="statsBtn">统计</button>\n'
    + '<button class="tb-btn" id="linkBtn">关联对比</button>\n'
    + '<button class="tb-btn" id="detailBtn">行详情</button>\n'
    + '<button class="tb-btn" id="exportBtn">导出CSV</button>\n'
    + exportReportBtn + '\n'
    + '<button class="tb-btn" id="keysBtn">快捷键</button>\n'
    + '<button class="tb-btn" id="importDbBtn">导入数据库</button>\n'
    + '<span class="tb-sep"></span>\n'
    + '<div class="tab-dd" id="tabDd">\n'
    + '<button class="tab-dd-btn" id="tabDdBtn"><span id="tabDdLabel">选择标签</span><span class="tab-dd-arrow">▼</span></button>\n'
    + '<div class="tab-dd-menu" id="tabDdMenu"></div>\n'
    + '</div>\n'
    + '</div>\n'
    + '<div class="drag-spacer"></div>\n'
    + '<div class="win-ctrls"' + winCtrlsStyle + '><button class="wc-close" title="关闭"></button><button class="wc-min" title="最小化"></button><button class="wc-max" title="最大化"></button></div>\n'
    + '</div>\n'
    + '<div class="body-row">\n'
    + '<div class="table-wrap">\n'
    + '  <div class="header-row" id="headerRow"></div>\n'
    + '  <div class="table-container" id="container">\n'
    + '    <div class="loading-mask" id="loadingMask">正在加载数据...</div>\n'
    + '    <div class="canvas-spacer" id="spacer"><canvas id="mainCanvas"></canvas></div>\n'
    + '  </div>\n'
    + '  <div class="rn-scrollbar-cover" id="rnCover"></div>\n'
    + '  <div class="stats-bar" id="statsBar"></div>\n'
    + '</div>\n'
    + '<div class="row-detail" id="rowDetail"><div class="rd-body"></div></div>\n'
    + '<div class="link-panel" id="linkPanel">\n'
    + '  <div class="lp-tab-bar" id="lpTabBar"></div>\n'
    + '  <div class="lp-content" id="lpContent"><div class="lp-empty">点击上方标签选择关联表</div></div>\n'
    + '</div>\n'
    + '</div>\n'
    + '<div class="keys-overlay" id="keysOverlay">\n'
    + '  <div class="keys-dialog">\n'
    + '    <div class="keys-dialog-title"><span class="keys-close" id="keysClose">×</span>快捷键</div>\n'
    + '    <table class="keys-table">\n'
    + '      <tr><td><span class="keys-kbd">ctrl+g</span></td><td class="keys-desc">跳转到指定行号</td></tr>\n'
    + '      <tr><td><span class="keys-kbd">ctrl+f</span></td><td class="keys-desc">搜索表格内容</td></tr>\n'
    + '      <tr><td><span class="keys-kbd">alt+滚轮</span></td><td class="keys-desc">横向滚动</td></tr>\n'
    + '      <tr><td><span class="keys-kbd">ctrl+c</span></td><td class="keys-desc">复制选中单元格</td></tr>\n'
    + '      <tr><td><span class="keys-kbd">ctrl+a</span></td><td class="keys-desc">全选表格</td></tr>\n'
    + '      <tr><td><span class="keys-kbd">ctrl+w</span></td><td class="keys-desc">关闭表格</td></tr>\n'
    + '      <tr><td><span class="keys-kbd">shift+点击</span></td><td class="keys-desc">扩展选区</td></tr>\n'
    + '      <tr><td><span class="keys-kbd">esc</span></td><td class="keys-desc">取消选区</td></tr>\n'
    + '      <tr><td><span class="keys-kbd">ctrl+l</span></td><td class="keys-desc">关联对比面板</td></tr>\n'
    + '    </table>\n'
    + '  </div>\n'
    + '</div>\n'
    + '<div class="goto-overlay" id="gotoOverlay">\n'
    + '  <div class="goto-dialog">\n'
    + '    <div class="goto-title">跳转到行</div>\n'
    + '    <div class="goto-row">\n'
    + '      <input type="number" id="gotoInput" min="1" placeholder="输入行号">\n'
    + '      <button id="gotoBtn">跳转</button>\n'
    + '    </div>\n'
    + '  </div>\n'
    + '</div>\n'
    + '<div class="search-overlay" id="searchOverlay">\n'
    + '  <div class="search-dialog">\n'
    + '    <div class="search-title">搜索</div>\n'
    + '    <div class="search-row">\n'
    + '      <input type="text" id="searchInput" placeholder="输入搜索内容...">\n'
    + '      <button id="searchPrev" title="上一个">↑</button>\n'
    + '      <button id="searchNext" title="下一个">↓</button>\n'
    + '    </div>\n'
    + '    <div class="search-status" id="searchStatus"></div>\n'
    + '  </div>\n'
    + '</div>\n'
    + '<div class="stats-overlay" id="statsOverlay">\n'
    + '  <div class="stats-dialog">\n'
    + '    <div class="stats-title"><span id="statsTitle">区间统计</span><span class="stats-close" id="statsClose">×</span></div>\n'
    + '    <div class="stats-range">\n'
    + '      行号范围: 从 <input type="number" id="statsFrom" min="1" value="1"> 到 <input type="number" id="statsTo" min="1" value="1">\n'
    + '      <button class="stats-range-btn" id="statsCalcBtn">计算</button>\n'
    + '    </div>\n'
    + '    <div class="stats-cols" id="statsCols"></div>\n'
    + '    <div class="stats-result" id="statsResult"><div class="stats-empty">请选择列并指定行号范围后点击计算</div></div>\n'
    + '  </div>\n'
    + '</div>\n'
    + '<div class="col-overlay" id="colOverlay">\n'
    + '  <div class="col-dialog">\n'
    + '    <div class="col-dialog-title"><span id="colDialogTitle">选择列</span><span class="col-close" id="colCloseBtn">×</span></div>\n'
    + '    <div class="col-dialog-top"><span class="col-top-btn" id="colAll">全选</span><span class="col-top-btn" id="colNone">全不选</span></div>\n'
    + '    <div class="col-dialog-list" id="colDialogList"></div>\n'
    + '  </div>\n'
    + '</div>\n'
    + '<div class="chart-overlay" id="chartOverlay">\n'
    + '  <div class="chart-dialog">\n'
    + '    <div class="chart-main">\n'
    + '      <div class="chart-header"><div class="chart-toolbar"><button class="chart-tool-btn" id="chartThreshBtn">阈值线</button><button class="chart-tool-btn" id="chartExportBtn">导出图片</button><span class="chart-close" id="chartClose">×</span></div></div>\n'
    + '      <div class="chart-canvas-wrap"><canvas id="chartCanvas"></canvas><div class="range-stats" id="rangeStats"></div></div>\n'
    + '    </div>\n'
    + '    <div class="chart-panel" id="chartPanel"></div>\n'
    + '  </div>\n'
    + '</div>\n'
    + '<div class="thresh-overlay" id="threshOverlay">\n'
    + '  <div class="thresh-dialog">\n'
    + '    <div class="thresh-title"><span>阈值线管理</span><span class="chart-close" id="threshClose">×</span></div>\n'
    + '    <div class="thresh-add"><select id="threshSeries"></select><input type="text" id="threshValue" placeholder="输入阈值" style="width:100px;text-align:center"><button class="thresh-add-btn" id="threshAddBtn">添加</button></div>\n'
    + '    <div class="thresh-list" id="threshList"><div class="thresh-empty">暂无阈值线，请在上方选择曲线和数值后添加</div></div>\n'
    + '  </div>\n'
    + '</div>\n'
    + '<div class="iface-overlay" id="ifaceOverlay">\n'
    + '  <div class="iface-dialog">\n'
    + '    <div class="iface-title"><span id="ifaceTitle">打印格式</span><span class="iface-close" id="ifaceClose">×</span></div>\n'
    + '    <div class="iface-body" id="ifaceBody"></div>\n'
    + '  </div>\n'
    + '</div>\n'
    + '<script>\n' + js + '\n<' + '/script>\n</body>\n</html>';
}

// Load config-based parsers first (config.json + generic-parser.js)
const { loadConfigParsers } = require('./generic-parser');
const configParsers = loadConfigParsers();
const configKeys = new Set();
for (const mod of configParsers) {
  register(mod.keyword, mod.parser, mod.platform);
  configKeys.add(mod.keyword + '_' + (mod.platform || 'default'));
}

// Load legacy file-based parsers, skipping any already covered by config
const parsersDir = path.join(__dirname, 'parsers');
if (fs.existsSync(parsersDir)) {
  for (const file of fs.readdirSync(parsersDir).filter(f => f.endsWith('.js'))) {
    try {
      const mod = require(path.join(parsersDir, file));
      if (mod.keyword && mod.parser) {
        const key = mod.keyword + '_' + (mod.platform || 'default');
        if (!configKeys.has(key)) register(mod.keyword, mod.parser, mod.platform);
      }
    } catch (e) {
      console.error('[log-parsers] Failed to load parser ' + file + ':', e.message);
    }
  }
}

function generateReportHTML(storeTabs, storeData) {
  // Map store tabs to the same format returned by analysis-get-tabs IPC
  const tabs = storeTabs.map(tab => ({
    name: tab.name,
    count: tab.count,
    headers: tab.headerLabels,
    colWidths: tab.colWidths,
    keyword: tab.keyword,
    printInterface: tab.printInterface,
    fieldMapping: tab.fieldMapping,
    keyLabels: tab.keyLabels,
    keys: tab.keys
  }));
  return generateStaticHTML(tabs, storeData);
}

module.exports = { register, getKeywords, getParser, getKeywordsWithInfo, parseLine, generateStaticHTML, generateReportHTML };
