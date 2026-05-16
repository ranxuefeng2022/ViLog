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

function generateStaticHTML(embeddedTabs, embeddedData) {
  const hasEmbedded = embeddedTabs && embeddedData;
  const embedScript = hasEmbedded
    ? '<script>var __EMBEDDED_TABS=' + JSON.stringify(embeddedTabs).replace(new RegExp('<\\\\/script','gi'),'<\\/scri"+"pt') + ';var __EMBEDDED_DATA=' + JSON.stringify(embeddedData).replace(new RegExp('<\\\\/script','gi'),'<\\/scri"+"pt') + ';</scri' + 'pt>'
    : '';
  // In standalone (exported) mode, hide window controls
  const winCtrlsStyle = hasEmbedded ? ' style="display:none"' : '';
  const exportReportBtn = hasEmbedded ? '' : '<button class="tb-btn" id="exportReportBtn">导出报告</button>';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>日志分析报告</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue","Segoe UI",Arial,sans-serif;background:#F5F5F7;display:flex;flex-direction:column;height:100vh;overflow:hidden;-webkit-font-smoothing:antialiased}
.tabs{display:flex;background:rgba(255,255,255,0.72);border-bottom:1px solid rgba(0,0,0,0.08);padding:0 12px;flex-shrink:0;align-items:center;height:40px;gap:0;overflow:visible;-webkit-app-region:drag;app-region:drag}
.toolbar-scroll{flex:1;display:flex;align-items:center;overflow-x:auto;overflow-y:hidden;padding:0 4px;gap:6px;-webkit-app-region:no-drag;app-region:no-drag;scrollbar-width:thin}
.toolbar-scroll::-webkit-scrollbar{height:2px}
.toolbar-scroll::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.12);border-radius:1px}
.tb-btn{padding:4px 10px;font-size:11px;border:none;border-radius:6px;cursor:pointer;color:#86868B;background:transparent;transition:all .2s ease;font-family:inherit;white-space:nowrap;flex-shrink:0;letter-spacing:0.2px}
.tb-btn:hover{color:#1D1D1F;background:rgba(0,0,0,0.04)}
.tab-dd{position:relative;flex-shrink:0;-webkit-app-region:no-drag;app-region:no-drag}
.tab-dd-btn{display:flex;align-items:center;gap:6px;padding:4px 12px;font-size:12px;border:none;border-radius:8px;cursor:pointer;color:#fff;background:#007AFF;font-family:inherit;white-space:nowrap;font-weight:500;transition:all .2s ease;letter-spacing:0.2px}
.tab-dd-btn:hover{background:#0066D6}
.tab-dd-arrow{font-size:9px;opacity:0.8;transition:transform .2s ease}
.tab-dd.open .tab-dd-arrow{transform:rotate(180deg)}
.tab-dd-menu{display:none;position:fixed;background:#fff;border:none;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,0.1),0 0 0 1px rgba(0,0,0,0.04);min-width:200px;max-height:320px;overflow-y:auto;z-index:99999}
.tab-dd.open .tab-dd-menu{display:block}
.tab-dd-menu::-webkit-scrollbar{width:3px}
.tab-dd-menu::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.1);border-radius:2px}
.tab-dd-item{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;font-size:13px;color:#1D1D1F;cursor:pointer;white-space:nowrap;transition:background .15s ease}
.tab-dd-item:first-child{border-radius:10px 10px 0 0}
.tab-dd-item:last-child{border-radius:0 0 10px 10px}
.tab-dd-item:hover{background:#F5F5F7}
.tab-dd-item.active{color:#007AFF;font-weight:500;background:#EBF5FF}
.tab-dd-item .tab-badge{display:inline-block;background:#F5F5F7;color:#86868B;border-radius:8px;padding:1px 7px;font-size:10px;margin-left:6px;font-weight:500}
.tab-dd-item.active .tab-badge{background:#007AFF;color:#fff}
.win-ctrls{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0;padding-right:8px;-webkit-app-region:no-drag;app-region:no-drag}
.win-ctrls button{width:12px;height:12px;border:none;border-radius:50%;cursor:pointer;font-size:0;display:flex;align-items:center;justify-content:center;padding:0;transition:opacity .15s ease}
.wc-close{background:#FF5F57}.wc-close:hover{opacity:0.8}
.wc-min{background:#FEBC2E}.wc-min:hover{opacity:0.8}
.wc-max{background:#28C840}.wc-max:hover{opacity:0.8}
.table-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative;background:#fff}
.body-row{flex:1;display:flex;overflow:hidden}
.rn-col{flex-shrink:0;overflow-y:scroll;overflow-x:hidden;background:#fff;border-right:1px solid rgba(0,0,0,0.06);box-shadow:2px 0 4px rgba(0,0,0,0.06)}
.rn-col::-webkit-scrollbar{display:none}
.rn-col{scrollbar-width:none}
.rn-body{position:relative;contain:strict}
.rn-cell{position:absolute;left:0;right:0;height:32px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#C7C7CC;user-select:none;font-weight:400;border-bottom:1px solid rgba(0,0,0,0.03);background:#fff}
.table-container{flex:1;overflow:auto;background:#fff;position:relative}
.table-container::-webkit-scrollbar{width:8px;height:8px}
.table-container::-webkit-scrollbar-track{background:transparent}
.table-container::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.12);border-radius:4px}
.table-container::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.2)}
.table-container::-webkit-scrollbar-corner{background:transparent}
.header-row{display:grid;position:relative;z-index:10;background:#FAFAFA;border-bottom:1px solid rgba(0,0,0,0.06);flex-shrink:0;overflow:hidden}
.hcell{color:#86868B;padding:10px 14px;font-size:11px;font-weight:600;text-align:center;white-space:nowrap;border-right:1px solid rgba(0,0,0,0.04);text-transform:uppercase;letter-spacing:0.5px}
.hcell:last-child{border-right:none}
.virtual-body{position:relative;contain:strict}
.vrow{display:grid;position:absolute;left:0;height:32px;border-bottom:1px solid rgba(0,0,0,0.03);will-change:transform;cursor:pointer;transition:background .15s ease;background:#fff}
.vrow:hover{background:#F5F5F7!important}
.vrow-alt{background:#fff}
.vcell-sel{background:rgba(0,122,255,0.08)!important;outline:1px solid rgba(0,122,255,0.4);outline-offset:-1px}
.vcell-anchor{background:rgba(0,122,255,0.15)!important;outline:2px solid #007AFF;outline-offset:-1px}
.rn-cell-sel{background:rgba(0,122,255,0.06)!important}
.rn-cell-anchor{background:rgba(0,122,255,0.12)!important;outline:2px solid #007AFF;outline-offset:-1px}
.vcell{padding:6px 14px;font-size:13px;text-align:center;white-space:nowrap;font-family:"SF Mono","Consolas","Courier New",monospace;border-right:1px solid rgba(0,0,0,0.02);line-height:20px;overflow:hidden;text-overflow:ellipsis;color:#1D1D1F}
.vcell:last-child{border-right:none}
.vcell-rn{color:#C7C7CC;font-size:11px;user-select:none;font-weight:400;position:sticky;left:0;z-index:2;background:inherit;box-shadow:2px 0 4px rgba(0,0,0,0.06)}
.loading-mask{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:14px;color:#86868B;z-index:5;background:rgba(255,255,255,0.9);font-weight:300;letter-spacing:0.3px}
.vrow.sr-match{background:rgba(255,204,0,0.12)!important}
.vrow.sr-current{background:rgba(255,204,0,0.28)!important}
.stats-bar{display:none}
.goto-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:rgba(0,0,0,0.15);display:none;align-items:center;justify-content:center}
.goto-dialog{background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.15),0 0 0 1px rgba(0,0,0,0.04);padding:20px 24px;min-width:300px;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);cursor:default}
.goto-title{font-size:14px;font-weight:600;color:#1D1D1F;margin-bottom:14px;letter-spacing:-0.2px;cursor:move;user-select:none}
.goto-row{display:flex;gap:10px;align-items:center}
.goto-row input{flex:1;padding:8px 14px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-size:14px;font-family:"SF Mono",Consolas,monospace;outline:none;color:#1D1D1F;transition:border .15s}
.goto-row input:focus{border-color:#007AFF}
.goto-row button{padding:8px 20px;border:none;border-radius:8px;background:#007AFF;color:#fff;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .15s}
.goto-row button:hover{opacity:0.85}
.search-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:rgba(0,0,0,0.15);display:none;align-items:center;justify-content:center}
.search-dialog{background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.15),0 0 0 1px rgba(0,0,0,0.04);padding:20px 24px;min-width:380px;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);cursor:default}
.search-title{font-size:14px;font-weight:600;color:#1D1D1F;margin-bottom:14px;letter-spacing:-0.2px;cursor:move;user-select:none}
.search-row{display:flex;gap:8px;align-items:center}
.search-row input{flex:1;padding:8px 14px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-size:14px;font-family:"SF Mono",Consolas,monospace;outline:none;color:#1D1D1F;transition:border .15s}
.search-row input:focus{border-color:#007AFF}
.search-row button{width:32px;height:34px;border:1px solid rgba(0,0,0,0.08);border-radius:8px;background:#fff;color:#1D1D1F;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:background .15s}
.search-row button:hover{background:#F5F5F7}
.search-status{font-size:12px;color:#86868B;margin-top:10px;min-height:16px}
.keys-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:rgba(0,0,0,0.15);display:none;align-items:center;justify-content:center}
.keys-dialog{background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.15),0 0 0 1px rgba(0,0,0,0.04);padding:24px 28px;min-width:340px}
.keys-dialog-title{font-size:15px;font-weight:600;color:#1D1D1F;margin-bottom:18px;letter-spacing:-0.2px}
.keys-close{float:right;cursor:pointer;font-size:18px;color:#C7C7CC;transition:color .15s;line-height:1}
.keys-close:hover{color:#1D1D1F}
.keys-table{width:100%;border-collapse:collapse;font-size:13px}
.keys-table td{padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.04)}
.keys-table tr:last-child td{border-bottom:none}
.keys-kbd{display:inline-block;padding:3px 10px;border-radius:6px;background:#F5F5F7;font-family:"SF Mono",Consolas,monospace;font-size:12px;color:#1D1D1F;border:1px solid rgba(0,0,0,0.06);white-space:nowrap;font-weight:500}
.keys-desc{color:#86868B;padding-left:16px}
.stats-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:9997;background:rgba(0,0,0,0.3);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center}
.stats-dialog{background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,0.12),0 0 0 1px rgba(0,0,0,0.04);width:720px;max-width:90vw;max-height:85vh;display:flex;flex-direction:column;overflow:hidden}
.stats-title{padding:16px 22px;font-size:15px;font-weight:600;color:#1D1D1F;border-bottom:1px solid rgba(0,0,0,0.06);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;letter-spacing:-0.2px}
.stats-close{cursor:pointer;font-size:18px;color:#C7C7CC;padding:0 4px;transition:color .15s}
.stats-close:hover{color:#1D1D1F}
.stats-range{display:flex;align-items:center;gap:10px;padding:12px 22px;border-bottom:1px solid rgba(0,0,0,0.04);flex-shrink:0;font-size:13px;color:#86868B}
.stats-range input{width:80px;padding:6px 10px;border:none;border-radius:8px;font-size:13px;text-align:center;font-family:"SF Mono",Consolas,monospace;background:rgba(0,0,0,0.04);color:#1D1D1F}
.stats-range input:focus{outline:none;background:rgba(0,0,0,0.07)}
.stats-range-btn{padding:6px 18px;border:none;border-radius:8px;background:#007AFF;color:#fff;font-size:12px;cursor:pointer;font-family:inherit;font-weight:500;transition:background .2s ease}
.stats-range-btn:hover{background:#0066D6}
.stats-cols{display:flex;flex-wrap:wrap;gap:6px;padding:12px 22px;border-bottom:1px solid rgba(0,0,0,0.04);flex-shrink:0;max-height:120px;overflow-y:auto}
.stats-cols::-webkit-scrollbar{width:3px}
.stats-cols::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.08);border-radius:2px}
.stats-col-tag{display:flex;align-items:center;gap:4px;padding:5px 12px;border:none;border-radius:8px;font-size:12px;cursor:pointer;color:#86868B;background:rgba(0,0,0,0.03);transition:all .15s;user-select:none;font-weight:400}
.stats-col-tag:hover{color:#007AFF;background:#EBF5FF}
.stats-col-tag.active{background:#007AFF;color:#fff;font-weight:500}
.stats-col-tag input{display:none}
.stats-result{flex:1;overflow-y:auto;padding:14px 22px}
.stats-result::-webkit-scrollbar{width:4px}
.stats-result::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.08);border-radius:2px}
.stats-empty{color:#C7C7CC;font-size:13px;text-align:center;padding:40px 0;font-weight:300}
.stats-table{width:100%;border-collapse:collapse;font-size:12px}
.stats-table th{text-align:left;padding:8px 12px;background:#FAFAFA;border:none;font-weight:600;color:#86868B;white-space:nowrap;position:sticky;top:0;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
.stats-table td{padding:8px 12px;border-bottom:1px solid rgba(0,0,0,0.03);font-family:"SF Mono",Consolas,monospace;white-space:nowrap;color:#1D1D1F}
.stats-table tr:hover td{background:#FAFAFA}
.stats-table .st-label{font-weight:500;color:#1D1D1F;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;font-size:12px}
.stats-val-up{color:#FF3B30}
.stats-val-down{color:#007AFF}
.stats-val-neutral{color:#86868B}
.info-btn{display:inline-block;margin-left:8px;padding:3px 10px;font-size:12px;border:none;border-radius:6px;cursor:pointer;color:#86868B;background:transparent;transition:all .15s;font-family:inherit;line-height:1.4;font-weight:400}
.info-btn:hover{color:#1D1D1F;background:rgba(0,0,0,0.04)}
.col-overlay,.chart-overlay,.iface-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:rgba(0,0,0,0.3);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center}
.iface-overlay{z-index:9998}
.col-dialog{background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,0.12),0 0 0 1px rgba(0,0,0,0.04);min-width:320px;max-width:520px;max-height:75vh;display:flex;flex-direction:column;overflow:hidden}
.col-dialog-title{padding:16px 22px;font-size:15px;font-weight:600;color:#1D1D1F;border-bottom:1px solid rgba(0,0,0,0.06);flex-shrink:0}
.col-dialog-top{display:flex;gap:8px;padding:10px 22px;border-bottom:1px solid rgba(0,0,0,0.04);flex-shrink:0}
.col-top-btn{padding:5px 14px;font-size:12px;border:none;border-radius:8px;background:rgba(0,0,0,0.03);color:#86868B;cursor:pointer;font-family:inherit;font-weight:400;transition:all .15s}
.col-top-btn:hover{color:#007AFF;background:#EBF5FF}
.col-dialog-list{overflow-y:auto;flex:1;padding:6px 0}
.col-dialog-list::-webkit-scrollbar{width:4px}
.col-dialog-list::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.08);border-radius:2px}
.col-item{display:flex;align-items:center;padding:8px 22px;cursor:pointer;font-size:13px;color:#1D1D1F;gap:10px;transition:background .1s}
.col-item:hover{background:#F5F5F7}
.col-item input{width:16px;height:16px;cursor:pointer;accent-color:#007AFF;flex-shrink:0}
.col-item span{flex:1;line-height:1.3}
.col-dialog-btns{display:flex;gap:10px;padding:14px 22px;border-top:1px solid rgba(0,0,0,0.06);flex-shrink:0}
.col-dialog-btn{flex:1;padding:8px 0;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;font-weight:500;transition:all .2s ease}
.col-dialog-ok{background:#007AFF;color:#fff}
.col-dialog-ok:hover{background:#0066D6}
.col-dialog-cancel{background:rgba(0,0,0,0.04);color:#86868B;border:none}
.col-dialog-cancel:hover{background:rgba(0,0,0,0.07);color:#1D1D1F}
.chart-dialog{background:#fff;border-radius:0;box-shadow:none;width:100vw;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.chart-header{display:flex;align-items:center;padding:8px 16px;border-bottom:1px solid rgba(0,0,0,0.06);flex-shrink:0;gap:10px}
.chart-header span{font-size:15px;font-weight:600;color:#1D1D1F;flex:1;letter-spacing:-0.2px}
.chart-body{flex:1;display:flex;overflow:hidden}
.chart-canvas-wrap{flex:1;padding:10px;overflow:hidden;position:relative}
.chart-canvas-wrap canvas{width:100%;height:100%;display:block;cursor:crosshair}
.chart-panel{width:280px;border-left:1px solid rgba(0,0,0,0.06);overflow-y:auto;flex-shrink:0;padding:8px 0;display:flex;flex-direction:column;background:#FAFAFA}
.chart-panel::-webkit-scrollbar{width:3px}
.chart-panel::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.08);border-radius:2px}
.chart-p-section{padding:6px 14px;font-size:10px;color:#86868B;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;margin-top:4px}
.chart-p-item{display:flex;align-items:center;padding:6px 14px;gap:6px;font-size:12px;color:#1D1D1F;cursor:pointer;transition:background .1s}
.chart-p-item:hover{background:rgba(0,0,0,0.03)}
.chart-p-item input[type=checkbox]{accent-color:#007AFF;cursor:pointer;width:15px;height:15px;flex-shrink:0;border-radius:4px}
.chart-p-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chart-p-val{font-family:"SF Mono",Consolas,monospace;color:#007AFF;font-weight:500;min-width:40px;text-align:right;flex-shrink:0}
.chart-p-color{width:14px;height:14px;border-radius:4px;flex-shrink:0}
.chart-color-pick{width:18px;height:18px;border:none;border-radius:50%;padding:0;cursor:pointer;flex-shrink:0;background:none;-webkit-appearance:none;box-shadow:inset 0 0 0 1.5px rgba(0,0,0,0.08);transition:transform .15s,box-shadow .15s}
.chart-color-pick:hover{transform:scale(1.2);box-shadow:inset 0 0 0 1.5px rgba(0,0,0,0.12),0 2px 8px rgba(0,0,0,0.12)}
.chart-color-pick::-webkit-color-swatch-wrapper{padding:0}
.chart-color-pick::-webkit-color-swatch{border:none;border-radius:50%}
.chart-toolbar{display:flex;align-items:center;gap:8px}
.chart-tool-btn{padding:5px 14px;font-size:12px;border:none;border-radius:8px;background:rgba(0,0,0,0.03);color:#86868B;cursor:pointer;font-family:inherit;white-space:nowrap;transition:all .15s;font-weight:400}
.chart-tool-btn:hover{color:#007AFF;background:#EBF5FF}
.chart-close{cursor:pointer;font-size:18px;color:#C7C7CC;padding:0 4px;transition:color .15s}
.chart-close:hover{color:#FF3B30}
.thresh-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:10000;background:rgba(0,0,0,0.3);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center}
.thresh-dialog{background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,0.12),0 0 0 1px rgba(0,0,0,0.04);width:420px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden}
.thresh-title{padding:16px 22px;font-size:15px;font-weight:600;color:#1D1D1F;border-bottom:1px solid rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.thresh-add{display:flex;gap:8px;padding:12px 22px;border-bottom:1px solid rgba(0,0,0,0.04);flex-shrink:0;align-items:center}
.thresh-add select,.thresh-add input{padding:6px 10px;border:none;border-radius:8px;font-size:13px;font-family:inherit;background:rgba(0,0,0,0.04);color:#1D1D1F}
.thresh-add select{flex:1;min-width:0}
.thresh-add input{width:100px;text-align:center;font-family:"SF Mono",Consolas,monospace}
.thresh-add-btn{padding:6px 16px;border:none;border-radius:8px;background:#007AFF;color:#fff;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;font-weight:500;transition:background .2s}
.thresh-add-btn:hover{background:#0066D6}
.thresh-list{flex:1;overflow-y:auto;padding:4px 0}
.thresh-list::-webkit-scrollbar{width:3px}
.thresh-list::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.08);border-radius:2px}
.thresh-item{display:flex;align-items:center;padding:9px 22px;gap:8px;font-size:13px;color:#1D1D1F}
.thresh-item-color{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.thresh-item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thresh-item-val{font-family:"SF Mono",Consolas,monospace;font-weight:500;color:#007AFF}
.thresh-item-del{cursor:pointer;font-size:16px;color:#C7C7CC;padding:0 4px;line-height:1;transition:color .15s}
.thresh-item-del:hover{color:#FF3B30}
.thresh-empty{color:#C7C7CC;font-size:13px;text-align:center;padding:24px 0;font-weight:300}
.range-stats{position:absolute;display:none;background:#fff;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,0.1),0 0 0 1px rgba(0,0,0,0.04);padding:14px 18px;font-size:12px;color:#1D1D1F;z-index:20;min-width:240px;pointer-events:none}
.range-stats-title{font-size:13px;font-weight:600;margin-bottom:8px;color:#007AFF;border-bottom:1px solid rgba(0,0,0,0.06);padding-bottom:6px}
.range-stats table{width:100%;border-collapse:collapse}
.range-stats th{text-align:left;padding:3px 8px;font-weight:600;color:#86868B;white-space:nowrap;font-size:11px}
.range-stats td{padding:3px 8px;font-family:"SF Mono",Consolas,monospace;white-space:nowrap}
.iface-dialog{background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,0.12),0 0 0 1px rgba(0,0,0,0.04);width:720px;max-width:90vw;max-height:85vh;display:flex;flex-direction:column;overflow:hidden}
.iface-title{padding:16px 22px;font-size:15px;font-weight:600;color:#1D1D1F;border-bottom:1px solid rgba(0,0,0,0.06);flex-shrink:0;display:flex;align-items:center;justify-content:space-between}
.iface-close{cursor:pointer;font-size:18px;color:#C7C7CC;padding:0 4px;transition:color .15s}
.iface-close:hover{color:#1D1D1F}
.iface-body{overflow-y:auto;flex:1;padding:18px 22px}
.iface-body::-webkit-scrollbar{width:4px}
.iface-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.08);border-radius:2px}
.iface-code{background:#FAFAFA;border:1px solid rgba(0,0,0,0.06);border-radius:10px;padding:14px 18px;font-family:"SF Mono","Consolas","Courier New",monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-all;color:#1D1D1F;margin-bottom:16px}
.iface-section{margin-bottom:16px}
.iface-section-title{font-size:11px;font-weight:600;color:#86868B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px}
.iface-meta{display:flex;gap:20px;font-size:12px;color:#86868B;margin-bottom:14px}
.iface-meta b{color:#1D1D1F;font-weight:500}
.iface-field-list{display:grid;grid-template-columns:1fr 1fr;gap:2px 24px;font-size:12px}
.iface-field-item{display:flex;align-items:baseline;padding:5px 8px;border-radius:6px}
.iface-field-item:hover{background:#FAFAFA}
.iface-field-raw{font-family:"SF Mono","Consolas","Courier New",monospace;font-size:11px;color:#007AFF;min-width:0;white-space:nowrap}
.iface-field-arrow{color:#C7C7CC;margin:0 6px;flex-shrink:0}
.iface-field-label{color:#1D1D1F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iface-unmatched{color:#FF9500;font-size:11px;margin-left:4px}
.iface-field-empty .iface-field-label{color:#C7C7CC;font-style:italic}</style>
</head>
<body>
${embedScript}
<div class="tabs" id="tabBar">
<div class="tab-dd" id="tabDd">
<button class="tab-dd-btn" id="tabDdBtn"><span id="tabDdLabel">选择标签</span><span class="tab-dd-arrow">▼</span></button>
<div class="tab-dd-menu" id="tabDdMenu"></div>
</div>
<div class="toolbar-scroll" id="toolbarScroll">
<button class="tb-btn" id="ifaceBtn">打印格式</button>
<button class="tb-btn" id="colBtn">显示列</button>
<button class="tb-btn" id="chartBtn">趋势图</button>
<button class="tb-btn" id="statsBtn">统计</button>
<button class="tb-btn" id="exportBtn">导出CSV</button>
${exportReportBtn}
<button class="tb-btn" id="keysBtn">快捷键</button>
</div>
<div class="win-ctrls"${winCtrlsStyle}><button class="wc-min" title="最小化">&#x2500;</button><button class="wc-max" title="最大化">&#x25A1;</button><button class="wc-close" title="关闭">&#x2715;</button></div>
</div>
<div class="table-wrap">
  <div class="header-row" id="headerRow"></div>
  <div class="body-row">
    <div class="rn-col" id="rnCol"></div>
    <div class="table-container" id="container">
      <div class="loading-mask" id="loadingMask">正在加载数据...</div>
      <div class="virtual-body" id="vbody"></div>
    </div>
  </div>
  <div class="stats-bar" id="statsBar"></div>
</div>
<div class="keys-overlay" id="keysOverlay">
  <div class="keys-dialog">
    <div class="keys-dialog-title"><span class="keys-close" id="keysClose">×</span>快捷键</div>
    <table class="keys-table">
      <tr><td><span class="keys-kbd">ctrl+g</span></td><td class="keys-desc">跳转到指定行号</td></tr>
      <tr><td><span class="keys-kbd">ctrl+f</span></td><td class="keys-desc">搜索表格内容</td></tr>
      <tr><td><span class="keys-kbd">alt+滚轮</span></td><td class="keys-desc">横向滚动</td></tr>
      <tr><td><span class="keys-kbd">ctrl+c</span></td><td class="keys-desc">复制选中单元格</td></tr>
      <tr><td><span class="keys-kbd">ctrl+a</span></td><td class="keys-desc">全选表格</td></tr>
      <tr><td><span class="keys-kbd">shift+点击</span></td><td class="keys-desc">扩展选区</td></tr>
      <tr><td><span class="keys-kbd">esc</span></td><td class="keys-desc">取消选区</td></tr>
    </table>
  </div>
</div>
<div class="goto-overlay" id="gotoOverlay">
  <div class="goto-dialog">
    <div class="goto-title">跳转到行</div>
    <div class="goto-row">
      <input type="number" id="gotoInput" min="1" placeholder="输入行号">
      <button id="gotoBtn">跳转</button>
    </div>
  </div>
</div>
<div class="search-overlay" id="searchOverlay">
  <div class="search-dialog">
    <div class="search-title">搜索</div>
    <div class="search-row">
      <input type="text" id="searchInput" placeholder="输入搜索内容...">
      <button id="searchPrev" title="上一个">↑</button>
      <button id="searchNext" title="下一个">↓</button>
    </div>
    <div class="search-status" id="searchStatus"></div>
  </div>
</div>
<div class="stats-overlay" id="statsOverlay">
  <div class="stats-dialog">
    <div class="stats-title"><span id="statsTitle">区间统计</span><span class="stats-close" id="statsClose">×</span></div>
    <div class="stats-range">
      行号范围: 从 <input type="number" id="statsFrom" min="1" value="1"> 到 <input type="number" id="statsTo" min="1" value="1">
      <button class="stats-range-btn" id="statsCalcBtn">计算</button>
    </div>
    <div class="stats-cols" id="statsCols"></div>
    <div class="stats-result" id="statsResult"><div class="stats-empty">请选择列并指定行号范围后点击计算</div></div>
  </div>
</div>
<div class="col-overlay" id="colOverlay">
  <div class="col-dialog">
    <div class="col-dialog-title" id="colDialogTitle">选择显示列</div>
    <div class="col-dialog-top"><button class="col-top-btn" id="colAll">全选</button><button class="col-top-btn" id="colNone">全不选</button></div>
    <div class="col-dialog-list" id="colDialogList"></div>
    <div class="col-dialog-btns">
      <button class="col-dialog-btn col-dialog-cancel" id="colCancel">取消</button>
      <button class="col-dialog-btn col-dialog-ok" id="colOk">确定</button>
    </div>
  </div>
</div>
<div class="chart-overlay" id="chartOverlay">
  <div class="chart-dialog">
    <div class="chart-header"><span>趋势图表</span><div class="chart-toolbar"><button class="chart-tool-btn" id="chartThreshBtn">阈值线</button><button class="chart-tool-btn" id="chartExportBtn">导出图片</button><span class="chart-close" id="chartClose">×</span></div></div>
    <div class="chart-body">
      <div class="chart-canvas-wrap"><canvas id="chartCanvas"></canvas><div class="range-stats" id="rangeStats"></div></div>
      <div class="chart-panel" id="chartPanel"></div>
    </div>
  </div>
</div>
<div class="thresh-overlay" id="threshOverlay">
  <div class="thresh-dialog">
    <div class="thresh-title"><span>阈值线管理</span><span class="chart-close" id="threshClose">×</span></div>
    <div class="thresh-add"><select id="threshSeries"></select><input type="text" id="threshValue" placeholder="输入阈值" style="width:100px;text-align:center"><button class="thresh-add-btn" id="threshAddBtn">添加</button></div>
    <div class="thresh-list" id="threshList"><div class="thresh-empty">暂无阈值线，请在上方选择曲线和数值后添加</div></div>
  </div>
</div>
<div class="iface-overlay" id="ifaceOverlay">
  <div class="iface-dialog">
    <div class="iface-title"><span id="ifaceTitle">打印格式</span><span class="iface-close" id="ifaceClose">×</span></div>
    <div class="iface-body" id="ifaceBody"></div>
  </div>
</div>
<script>
var ROW_H=32,activeTab=0,RN_W=50;
var scrollTops=[],scrollLefts=[];
var pool=[],poolSize=0,lastStart=-1,lastEnd=-1;
var container=document.getElementById('container');
var headerRow=document.getElementById('headerRow');
var vbody=document.getElementById('vbody');
var rnCol=document.getElementById('rnCol');
var rnPool=[];
var tabDd=document.getElementById('tabDd');
var tabDdBtn=document.getElementById('tabDdBtn');
var tabDdLabel=document.getElementById('tabDdLabel');
var tabDdMenu=document.getElementById('tabDdMenu');
var tabBar=document.getElementById('tabBar');
var loadingMask=document.getElementById('loadingMask');
var statsBar=document.getElementById('statsBar');
var statsOverlay=document.getElementById('statsOverlay');
var statsFrom=document.getElementById('statsFrom');
var statsTo=document.getElementById('statsTo');
var statsCols=document.getElementById('statsCols');
var statsResult=document.getElementById('statsResult');
var colOverlay=document.getElementById('colOverlay');
var colDialogTitle=document.getElementById('colDialogTitle');
var colDialogList=document.getElementById('colDialogList');
var chartOverlay=document.getElementById('chartOverlay');
var chartCanvas=document.getElementById('chartCanvas');
var chartPanel=document.getElementById('chartPanel');
var ifaceOverlay=document.getElementById('ifaceOverlay');
var ifaceTitle=document.getElementById('ifaceTitle');
var ifaceBody=document.getElementById('ifaceBody');
var ifaceClose=document.getElementById('ifaceClose');
var TABS=[],tabLocal=[];
var cachedST=0,cachedVH=0;
var sel={anchorR:-1,anchorC:-1,endR:-1,endC:-1,active:false,dragging:false};
var CHART_COLORS=['#007AFF','#FF9500','#34C759','#5856D6','#FF2D55','#5AC8FA','#FFCC00','#8E8E93'];;
var chartConfigs=[],chartZoom=1,chartOffX=0,chartMouse={x:-1,y:-1};
var chartTooltipAT=-1,chartTooltipSF=-1,chartColKeys=null,chartRows=null;
var chartIsPanning=false,chartPanStartX=0,chartPanStartOffX=0,chartPanMaxOffX=0,chartRaf=0,chartResizeObs=null;
var chartThresholds=[];
var chartSel={active:false,startX:-1,endX:-1,startDi:-1,endDi:-1,stats:null};
var statsSelectedCols=new Set();
var rnHCell=null;

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
document.addEventListener('contextmenu',function(e){e.preventDefault()});
document.querySelector('.wc-min').addEventListener('click',function(){if(window.logAnalysis)window.logAnalysis.minimize()});
document.querySelector('.wc-max').addEventListener('click',function(){if(window.logAnalysis)window.logAnalysis.maximize()});
document.querySelector('.wc-close').addEventListener('click',function(){if(window.logAnalysis)window.logAnalysis.close()});

var __isEmbedded=typeof __EMBEDDED_TABS!=='undefined';
if(__isEmbedded){
  (function(){
    var tabs=__EMBEDDED_TABS;
    if(!tabs||tabs.length===0){loadingMask.style.display='flex';loadingMask.textContent='没有数据';return}
    TABS=tabs;
    scrollTops=new Array(tabs.length).fill(0);
    scrollLefts=new Array(tabs.length).fill(0);
    tabLocal=tabs.map(function(){return{rows:null,visibleCols:null,loaded:false}});
    buildTabButtons();
    for(var i=0;i<tabs.length;i++){
      tabLocal[i].rows=__EMBEDDED_DATA[i];
      tabLocal[i].visibleCols=null;
      tabLocal[i].loaded=true;
    }
    renderTab(0);
  })();
}else{
  window.logAnalysis.getTabs().then(function(tabs){
    if(!tabs||tabs.length===0){loadingMask.style.display='flex';loadingMask.textContent='没有数据';return}
    TABS=tabs;
    scrollTops=new Array(tabs.length).fill(0);
    scrollLefts=new Array(tabs.length).fill(0);
    tabLocal=tabs.map(function(){return{rows:null,visibleCols:null,loaded:false}});
    buildTabButtons();loadTab(0);
    for(var i=1;i<tabs.length;i++) loadTab(i);
  }).catch(function(err){loadingMask.style.display='flex';loadingMask.textContent='加载失败: '+err.message});
}

function buildTabButtons(){
  tabDdMenu.innerHTML='';
  TABS.forEach(function(t,i){
    var item=document.createElement('div');
    item.className='tab-dd-item'+(i===0?' active':'');
    item.setAttribute('data-tab',i);
    item.innerHTML=esc(t.name)+'<span class="tab-badge">'+t.count+'</span>';
    item.addEventListener('click',function(){
      switchTab(parseInt(this.getAttribute('data-tab')));
      hideDdMenu();
    });
    tabDdMenu.appendChild(item);
  });
  if(TABS.length>0) tabDdLabel.textContent=TABS[0].name;
}
var ddOpen=false;
function showDdMenu(){
  var rect=tabDdBtn.getBoundingClientRect();
  tabDdMenu.style.left=rect.left+'px';
  tabDdMenu.style.top=(rect.bottom+6)+'px';
  tabDdMenu.style.display='block';
  ddOpen=true;
}
function hideDdMenu(){
  tabDdMenu.style.display='none';
  ddOpen=false;
}
tabDdBtn.addEventListener('click',function(e){
  e.preventDefault();
  e.stopPropagation();
  if(ddOpen){hideDdMenu();return}
  showDdMenu();
});
document.addEventListener('mousedown',function(e){
  if(ddOpen&&!tabDd.contains(e.target)) hideDdMenu();
});

function loadTab(idx){
  window.logAnalysis.getFullData(idx).then(function(res){
    if(!res||!res.success)return;
    tabLocal[idx].rows=res.data;
    tabLocal[idx].visibleCols=null;
    tabLocal[idx].loaded=true;
    if(idx===activeTab) renderTab(idx);
  });
}

function switchTab(idx){
  if(idx===activeTab&&tabLocal[activeTab].loaded)return;
  clearSel();
  scrollTops[activeTab]=container.scrollTop;
  scrollLefts[activeTab]=container.scrollLeft;
  activeTab=idx;
  tabDdLabel.textContent=TABS[idx].name;
  var items=tabDdMenu.querySelectorAll('.tab-dd-item');
  for(var i=0;i<items.length;i++) items[i].className='tab-dd-item'+(i===idx?' active':'');
  if(tabLocal[idx].loaded){renderTab(idx)}
  else{loadingMask.style.display='flex';loadingMask.textContent='加载中...';vbody.innerHTML='';rnCol.querySelector('.rn-body').innerHTML='';headerRow.innerHTML='';headerRow.style.transform='translateX(0)';pool=[];rnPool=[];lastStart=-1;lastEnd=-1}
}

function renderTab(idx){
  var t=TABS[idx];
  var loc=tabLocal[idx];
  var visCols=loc.visibleCols;
  var headers=visCols?visCols.map(function(c){return t.headers[c]}):t.headers;
  var colWidths=visCols?visCols.map(function(c){return t.colWidths[c]}):t.colWidths;
  var rows=loc.rows;
  var tKeys=t.keys||[];
  var rnW=Math.max(50,String(rows.length).length*9+32);
  var dataColW=0;for(var i=0;i<colWidths.length;i++)dataColW+=colWidths[i];
  var totalW=Math.max(dataColW+rnW,container.parentElement.clientWidth||container.parentElement.offsetWidth);
  var dataW=totalW-rnW;
  var totalH=rows.length*ROW_H;
  var headerGrid=rnW+'px '+colWidths.join('px ')+'px';
  var dataGrid=colWidths.join('px ')+'px';

  headerRow.style.gridTemplateColumns=headerGrid;
  headerRow.style.width=totalW+'px';
  var hh='<div class="hcell vcell-rn">#</div>';
  for(var i=0;i<headers.length;i++){
    var key=visCols?tKeys[visCols[i]]:tKeys[i];
    hh+='<div class="hcell"'+(key?' title="'+esc(key)+'"':'')+'>'+esc(headers[i])+'</div>';
  }
  headerRow.innerHTML=hh;

  rnHCell=headerRow.querySelector('.vcell-rn');
  if(rnHCell){rnHCell.style.position='relative';rnHCell.style.zIndex='3';rnHCell.style.background='#FAFAFA';rnHCell.style.boxShadow='2px 0 4px rgba(0,0,0,0.06)'}

  rnCol.style.width=rnW+'px';
  var rnBody=rnCol.querySelector('.rn-body');
  if(!rnBody){rnBody=document.createElement('div');rnBody.className='rn-body';rnCol.appendChild(rnBody)}
  rnBody.style.height=totalH+'px';

  vbody.style.width=dataW+'px';
  vbody.style.height=totalH+'px';
  curColWidths=colWidths.slice();
  curColLeft=[];var cx=0;
  for(var ci=0;ci<colWidths.length;ci++){curColLeft.push(cx);cx+=colWidths[ci]}
  lastFullSL=container.scrollLeft;
  srMatches=[];srCurrent=-1;srTerm='';
  if(searchStatusEl)searchStatusEl.textContent='';
  if(searchInput)searchInput.value='';

  pool=[];rnPool=[];
  var viewRows=Math.ceil(container.clientHeight/ROW_H);
  poolSize=viewRows+60;
  var dLen=headers.length;

  var frag=document.createDocumentFragment();
  for(var i=0;i<poolSize;i++){
    var row=document.createElement('div');
    row.className='vrow';
    row.style.cssText='grid-template-columns:'+dataGrid+';width:'+dataW+'px;display:none';
    var texts=[];
    for(var j=0;j<dLen;j++){
      var c=document.createElement('div');
      c.className='vcell';
      var tn=document.createTextNode('');
      c.appendChild(tn);
      texts.push(tn);
      row.appendChild(c);
    }
    frag.appendChild(row);
    pool.push({el:row,texts:texts,di:-1});
  }
  vbody.innerHTML='';
  vbody.appendChild(frag);

  var rnFrag=document.createDocumentFragment();
  for(var i=0;i<poolSize;i++){
    var rc=document.createElement('div');
    rc.className='rn-cell';
    rc.style.display='none';
    var rtn=document.createTextNode('');
    rc.appendChild(rtn);
    rnFrag.appendChild(rc);
    rnPool.push({el:rc,text:rtn,di:-1});
  }
  rnBody.innerHTML='';
  rnBody.appendChild(rnFrag);

  lastStart=-1;lastEnd=-1;
  loadingMask.style.display='none';
  container.scrollTop=scrollTops[idx]||0;
  container.scrollLeft=scrollLefts[idx]||0;
  rnCol.scrollTop=container.scrollTop;
  headerRow.style.transform='translateX('+(-container.scrollLeft)+'px)';
  cachedST=container.scrollTop;
  cachedVH=container.clientHeight;
  doRender();
}

// ---- Table Search ----
var srMatches=[],srCurrent=-1,srTerm='';
var searchOverlay=document.getElementById('searchOverlay');
var searchInput=document.getElementById('searchInput');
var searchStatusEl=document.getElementById('searchStatus');

function doSearch(term){
  srTerm=term.toLowerCase();srMatches=[];srCurrent=-1;
  lastStart=-1;for(var k=0;k<pool.length;k++)pool[k].di=-2;for(var k=0;k<rnPool.length;k++)rnPool[k].di=-2;
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!loc.rows||!srTerm){cachedMatchSet=null;doRender();updateSearchStatus();return}
  var rows=loc.rows;
  for(var i=0;i<rows.length;i++){
    for(var j=0;j<rows[i].length;j++){
      if(String(rows[i][j]).toLowerCase().indexOf(srTerm)>=0){srMatches.push(i);break}
    }
  }
  if(srMatches.length>0)srCurrent=0;
  cachedMatchSet=srMatches.length>0?new Set(srMatches):null;
  doRender();updateSearchStatus();
  if(srMatches.length>0){var di=srMatches[srCurrent];container.scrollTop=di*ROW_H-container.clientHeight/2+ROW_H;lastStart=-1;doRender()}
}
function updateSearchStatus(){
  if(!searchStatusEl)return;
  if(!srTerm){searchStatusEl.textContent='';return}
  searchStatusEl.textContent=srMatches.length>0?(srCurrent+1)+'/'+srMatches.length+' 个匹配':'无匹配结果';
}
function searchNav(dir){
  if(srMatches.length===0)return;
  srCurrent=(srCurrent+dir+srMatches.length)%srMatches.length;
  cachedMatchSet=srMatches.length>0?new Set(srMatches):null;
  lastStart=-1;for(var k=0;k<pool.length;k++)pool[k].di=-2;for(var k=0;k<rnPool.length;k++)rnPool[k].di=-2;
  var di=srMatches[srCurrent];
  container.scrollTop=di*ROW_H-container.clientHeight/2+ROW_H;
  doRender();updateSearchStatus();
}
function closeSearch(){if(searchOverlay){searchOverlay.style.display='none';var d=searchOverlay.querySelector('.search-dialog');if(d){d.style.transform='';d.style.left='50%';d.style.top='50%'}}}
function openSearch(){
  if(!searchOverlay)return;
  searchOverlay.style.display='flex';
  if(searchInput){searchInput.value=srTerm;searchInput.select()}
  setTimeout(function(){if(searchInput)searchInput.focus()},50);
}
document.addEventListener('click',function(e){
  if(e.target.id==='searchNext')searchNav(1);
  else if(e.target.id==='searchPrev')searchNav(-1);
});
document.addEventListener('keydown',function(e){
  if(e.ctrlKey&&e.key==='f'){e.preventDefault();openSearch();return}
  if(!searchInput||e.target!==searchInput)return;
  if(e.key==='Enter'){e.preventDefault();doSearch(searchInput.value)}
  else if(e.key==='Escape'){closeSearch()}
});
if(searchOverlay)searchOverlay.addEventListener('click',function(e){if(e.target===searchOverlay)closeSearch()});
if(searchInput){var searchTimer=0;searchInput.addEventListener('input',function(){clearTimeout(searchTimer);searchTimer=setTimeout(function(){doSearch(searchInput.value)},300)})}

// ===================== Cell Selection =====================
function selNormalize(){
  return{r0:Math.min(sel.anchorR,sel.endR),r1:Math.max(sel.anchorR,sel.endR),c0:Math.min(sel.anchorC,sel.endC),c1:Math.max(sel.anchorC,sel.endC)};
}
function selContains(r,c){
  if(!sel.active)return false;
  var n=selNormalize();
  return r>=n.r0&&r<=n.r1&&c>=n.c0&&c<=n.c1;
}
function selIsAnchor(r,c){return sel.active&&r===sel.anchorR&&c===sel.anchorC}
function clearSel(){sel.anchorR=-1;sel.anchorC=-1;sel.endR=-1;sel.endC=-1;sel.active=false;sel.dragging=false;refreshSelHighlight()}
function refreshSelHighlight(){
  for(var i=0;i<poolSize;i++){
    var p=pool[i];
    if(p.di<0||!p.texts)continue;
    var rd=p.di;
    for(var j=0;j<p.texts.length;j++){
      var cell=p.texts[j].parentNode;
      var isAnchor=selIsAnchor(rd,j);
      var inSel=selContains(rd,j);
      cell.className='vcell'+(isAnchor?' vcell-anchor':inSel?' vcell-sel':'');
    }
  }
  for(var i=0;i<rnPool.length;i++){
    var rp=rnPool[i];
    if(rp.di<0)continue;
    var rd=rp.di;
    var isAnchor=selIsAnchor(rd,-1);
    var inSel=sel.active&&selContains(rd,0);
    rp.el.className='rn-cell'+(isAnchor?' rn-cell-anchor':inSel?' rn-cell-sel':'');
  }
}
function cellFromEvent(e){
  var cell=e.target;
  if(!cell)return null;
  if(cell.nodeType===3)cell=cell.parentNode;
  if(!cell.classList||!cell.classList.contains('vcell'))return null;
  var row=cell.parentNode;
  if(!row||!row.classList||!row.classList.contains('vrow'))return null;
  var p=null;
  for(var i=0;i<pool.length;i++){if(pool[i].el===row){p=pool[i];break}}
  if(!p||p.di<0)return null;
  var ci=-1;
  var children=row.children;
  for(var i=0;i<children.length;i++){if(children[i]===cell){ci=i;break}}
  if(ci<0)return null;
  return{r:p.di,c:ci};
}
function rnCellFromEvent(e){
  var el=e.target;
  if(el.nodeType===3)el=el.parentNode;
  if(!el.classList||!el.classList.contains('rn-cell'))return null;
  var rp=null;
  for(var i=0;i<rnPool.length;i++){if(rnPool[i].el===el){rp=rnPool[i];break}}
  if(!rp||rp.di<0)return null;
  return{r:rp.di,c:-1};
}
function getNumCols(){
  if(pool.length===0||!pool[0].texts)return 0;
  return pool[0].texts.length;
}
vbody.addEventListener('mousedown',function(e){
  if(e.button!==0)return;
  var info=cellFromEvent(e);
  if(!info)return;
  e.preventDefault();
  var numCols=getNumCols();
  if(e.shiftKey&&sel.active){
    sel.endR=info.r;sel.endC=info.c;sel.active=true;
  }else{
    sel.anchorR=info.r;sel.anchorC=info.c;sel.endR=info.r;sel.endC=info.c;sel.active=true;sel.dragging=true;
  }
  refreshSelHighlight();
});
rnCol.addEventListener('mousedown',function(e){
  if(e.button!==0)return;
  var info=rnCellFromEvent(e);
  if(!info)return;
  e.preventDefault();
  var numCols=getNumCols();
  if(e.shiftKey&&sel.active){
    sel.endR=info.r;sel.endC=numCols-1;sel.active=true;
  }else{
    sel.anchorR=info.r;sel.anchorC=0;sel.endR=info.r;sel.endC=numCols-1;sel.active=true;sel.dragging=true;
  }
  refreshSelHighlight();
});
document.addEventListener('mousemove',function(e){
  if(!sel.dragging)return;
  var info=cellFromEvent(e);
  if(info){sel.endR=info.r;sel.endC=info.c;refreshSelHighlight();return}
  var rnInfo=rnCellFromEvent(e);
  if(rnInfo){sel.endR=rnInfo.r;sel.endC=getNumCols()-1;refreshSelHighlight();return}
  var contRect=container.getBoundingClientRect();
  if(e.clientY>=contRect.top&&e.clientY<=contRect.bottom&&sel.dragging){
    var r=Math.floor((cachedST+(e.clientY-contRect.top))/ROW_H);
    var len=tabLocal[activeTab]&&tabLocal[activeTab].rows?tabLocal[activeTab].rows.length:0;
    if(r<0)r=0;if(r>=len)r=len-1;
    sel.endR=r;
    refreshSelHighlight();
    if(e.clientY<contRect.top+40)container.scrollTop-=ROW_H*2;
    else if(e.clientY>contRect.bottom-40)container.scrollTop+=ROW_H*2;
  }
});
document.addEventListener('mouseup',function(){sel.dragging=false});
document.addEventListener('keydown',function(e){
  if(e.ctrlKey&&e.key==='c'&&sel.active){
    e.preventDefault();
    copySelection();
  }else if(e.ctrlKey&&e.key==='a'){
    e.preventDefault();
    var loc=tabLocal[activeTab];
    if(!loc||!loc.loaded||!loc.rows)return;
    var numCols=getNumCols();
    sel.anchorR=0;sel.anchorC=0;sel.endR=loc.rows.length-1;sel.endC=numCols-1;sel.active=true;
    refreshSelHighlight();
  }else if(e.key==='Escape'){
    clearSel();
  }
});
function copySelection(){
  if(!sel.active)return;
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!loc.rows)return;
  var rows=loc.rows;
  var visCols=loc.visibleCols;
  var n=selNormalize();
  var lines=[];
  for(var r=n.r0;r<=n.r1;r++){
    var rd=rows[r];
    var cells=[];
    for(var c=n.c0;c<=n.c1;c++){
      var v=visCols?rd[visCols[c]]:rd[c];
      cells.push(v===undefined||v===null?'':String(v));
    }
    lines.push(cells.join('\\t'));
  }
  var text=lines.join('\\n');
  var textarea=document.createElement('textarea');
  textarea.value=text;
  textarea.style.cssText='position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

var cachedMatchSet=null;
var curColLeft=null,curColWidths=null,lastFullSL=-1;

function doRender(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!loc.rows)return;
  var rows=loc.rows;
  var visCols=loc.visibleCols;
  var len=rows.length;
  if(len===0)return;
  var st=cachedST;
  var vh=cachedVH;
  var fv=Math.floor(st/ROW_H);
  var vc=Math.ceil(vh/ROW_H);
  var start=Math.max(0,fv-30);
  var end=Math.min(len,fv+vc+30);

  var curSL=container.scrollLeft;
  var hChanged=(curSL!==lastFullSL);
  lastFullSL=curSL;

  if(hChanged){for(var k=0;k<pool.length;k++)pool[k].di=-2;lastStart=-1}
  if(start===lastStart&&end===lastEnd)return;
  lastStart=start;lastEnd=end;

  var vc0=0,vc1=poolSize>0&&pool[0].texts?pool[0].texts.length:0;
  if(!hChanged&&curColLeft&&curColWidths){
    var sl=curSL,sr=sl+container.clientWidth;
    while(vc0<curColLeft.length&&curColLeft[vc0]+curColWidths[vc0]<sl)vc0++;
    while(vc1>0&&curColLeft[vc1-1]>sr)vc1--;
    if(vc0>0)vc0--;if(vc1<curColWidths.length)vc1++;
  }

  var ms=cachedMatchSet;
  for(var i=0;i<poolSize;i++){
    var p=pool[i];
    var di=start+i;
    if(di>=end){if(p.di!==-1){p.el.style.display='none';p.di=-1}continue}
    var el=p.el;
    var dirty=p.di!==di;
    if(dirty){
      p.di=di;
      el.style.display='';
      el.style.transform='translateY('+(di*ROW_H)+'px)';
      var rd=rows[di];
      if(hChanged||!curColLeft){
        if(visCols){for(var j=0;j<p.texts.length;j++){p.texts[j].nodeValue=rd[visCols[j]]}}
        else{for(var j=0;j<p.texts.length;j++){p.texts[j].nodeValue=rd[j]}}
      }else{
        if(visCols){for(var j=vc0;j<vc1;j++){p.texts[j].nodeValue=rd[visCols[j]]}}
        else{for(var j=vc0;j<vc1;j++){p.texts[j].nodeValue=rd[j]}}
      }
      el.className=ms&&ms.has(di)?(di===srMatches[srCurrent]?'vrow sr-current':'vrow sr-match'):(di&1?'vrow vrow-alt':'vrow');
      for(var j=0;j<p.texts.length;j++){
        var isA=sel.active&&selIsAnchor(di,j),inS=!isA&&sel.active&&selContains(di,j);
        p.texts[j].parentNode.className='vcell'+(isA?' vcell-anchor':inS?' vcell-sel':'');
      }
    }
  }
  for(var i=0;i<rnPool.length;i++){
    var rp=rnPool[i];
    var di=start+i;
    if(di>=end){if(rp.di!==-1){rp.el.style.display='none';rp.di=-1}continue}
    if(rp.di!==di){
      rp.di=di;
      rp.el.style.display='';
      rp.el.style.transform='translateY('+(di*ROW_H)+'px)';
      rp.text.nodeValue=di+1;
      rp.el.style.background='#fff';
      if(sel.active){
        var isA=selIsAnchor(di,-1),inS=!isA&&selContains(di,0);
        rp.el.className='rn-cell'+(isA?' rn-cell-anchor':inS?' rn-cell-sel':'');
      }else{rp.el.className='rn-cell'}
    }
  }
}

var rafId=0,lastSL=0;
container.addEventListener('scroll',function(){
  cachedST=container.scrollTop;cachedVH=container.clientHeight;
  if(rnCol.scrollTop!==cachedST)rnCol.scrollTop=cachedST;
  if(rafId)return;
  rafId=requestAnimationFrame(function(){
    rafId=0;
    var sl=container.scrollLeft;
    if(sl!==lastSL){
      lastSL=sl;
      headerRow.style.transform='translateX('+(-sl)+'px)';
      if(rnHCell)rnHCell.style.transform='translateX('+sl+'px)';
    }
    doRender();
  });
},{passive:true});

var altTarget=0,altCurrent=0,altRaf=0;
container.addEventListener('wheel',function(e){
  if(!e.altKey)return;
  e.preventDefault();
  var a=Math.abs(e.deltaY);
  var px=a<=4?20:a<=20?40:a<=60?80:a<=120?130:200;
  altTarget+=(e.deltaY>0?px:-px);
  var maxScroll=container.scrollWidth-container.clientWidth;
  altTarget=Math.max(0,Math.min(maxScroll,altTarget));
  if(!altRaf) altRaf=requestAnimationFrame(function step(){
    var diff=altTarget-altCurrent;
    if(Math.abs(diff)<0.5){altCurrent=altTarget;container.scrollLeft=altCurrent;altRaf=0;return}
    altCurrent+=diff*0.3;
    container.scrollLeft=altCurrent;
    altRaf=requestAnimationFrame(step);
  });
},{passive:false});

// ===================== Dialog Drag =====================
function makeDraggable(overlayId,dialogSelector,titleSelector){
  var overlay=document.getElementById(overlayId);
  if(!overlay)return;
  var dialog=overlay.querySelector(dialogSelector);
  var title=dialog?dialog.querySelector(titleSelector):null;
  if(!dialog||!title)return;
  var dragging=false,ox=0,oy=0;
  title.addEventListener('mousedown',function(e){
    dragging=true;
    var rect=dialog.getBoundingClientRect();
    ox=e.clientX-rect.left;oy=e.clientY-rect.top;
    dialog.style.transform='none';
    dialog.style.left=rect.left+'px';dialog.style.top=rect.top+'px';
    e.preventDefault();
  });
  document.addEventListener('mousemove',function(e){
    if(!dragging)return;
    dialog.style.left=(e.clientX-ox)+'px';dialog.style.top=(e.clientY-oy)+'px';
  });
  document.addEventListener('mouseup',function(){dragging=false});
}
makeDraggable('gotoOverlay','.goto-dialog','.goto-title');
makeDraggable('searchOverlay','.search-dialog','.search-title');

// ===================== Shortcut Keys Dialog =====================
var keysOverlay=document.getElementById('keysOverlay');
document.getElementById('keysBtn').addEventListener('click',function(){
  if(!keysOverlay)return;
  keysOverlay.style.display='flex';
});
document.getElementById('keysClose').addEventListener('click',function(){if(keysOverlay)keysOverlay.style.display='none'});
if(keysOverlay)keysOverlay.addEventListener('click',function(e){if(e.target===keysOverlay)keysOverlay.style.display='none'});

// ===================== Goto Line =====================
var gotoOverlay=document.getElementById('gotoOverlay');
var gotoInput=document.getElementById('gotoInput');
document.addEventListener('keydown',function(e){
  if(e.ctrlKey&&e.key==='g'){
    e.preventDefault();
    if(!gotoOverlay)return;
    if(gotoOverlay.style.display==='flex'){
      gotoOverlay.style.display='none';return;
    }
    var loc=tabLocal[activeTab];
    if(!loc||!loc.loaded||!loc.rows)return;
    gotoInput.max=loc.rows.length;
    gotoInput.value='';
    gotoOverlay.style.display='flex';
    setTimeout(function(){gotoInput.focus()},50);
  }
});
function closeGoto(){if(gotoOverlay){gotoOverlay.style.display='none';var d=gotoOverlay.querySelector('.goto-dialog');if(d){d.style.transform='';d.style.left='50%';d.style.top='50%'}}}
function doGotoLine(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!loc.rows)return;
  var num=parseInt(gotoInput.value,10);
  if(isNaN(num)||num<1){closeGoto();return}
  var len=loc.rows.length;
  if(num>len)num=len;
  container.scrollTop=(num-1)*ROW_H;
  lastStart=-1;lastEnd=-1;
  doRender();
  closeGoto();
}
if(gotoOverlay)gotoOverlay.addEventListener('click',function(e){if(e.target===gotoOverlay)closeGoto()});
var gotoBtn=document.getElementById('gotoBtn');
if(gotoBtn)gotoBtn.addEventListener('click',doGotoLine);
if(gotoInput)gotoInput.addEventListener('keydown',function(e){
  if(e.key==='Enter'){e.preventDefault();doGotoLine()}
  else if(e.key==='Escape')closeGoto();
});

// ===================== Statistics Dialog =====================
function showStatsDialog(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!loc.rows)return;
  var rows=loc.rows;
  var t=TABS[activeTab];
  var visCols=loc.visibleCols;
  var headerLabels=visCols?visCols.map(function(c){return t.headers[c]}):t.headers;

  document.getElementById('statsTitle').textContent='区间统计 — '+t.name;
  statsFrom.value=1;statsTo.value=rows.length;
  statsFrom.max=rows.length;statsTo.max=rows.length;

  // detect numeric columns
  var numCols=[];
  var sampleSize=Math.min(rows.length,50);
  for(var ci=0;ci<headerLabels.length;ci++){
    var numCount=0;
    for(var si=0;si<sampleSize;si++){
      var v=visCols?rows[si][visCols[ci]]:rows[si][ci];
      if(v!==undefined&&v!==null&&v!==''&&!isNaN(Number(v))) numCount++;
    }
    if(numCount>sampleSize*0.5) numCols.push(ci);
  }

  statsSelectedCols.clear();
  statsCols.innerHTML='';
  for(var i=0;i<numCols.length;i++){
    (function(ci){
      var tag=document.createElement('label');
      tag.className='stats-col-tag';
      tag.innerHTML='<input type="checkbox"><span>'+esc(headerLabels[ci])+'</span>';
      tag.addEventListener('click',function(e){
        e.preventDefault();
        var cb=tag.querySelector('input');
        cb.checked=!cb.checked;
        tag.classList.toggle('active',cb.checked);
        if(cb.checked) statsSelectedCols.add(ci); else statsSelectedCols.delete(ci);
      });
      statsCols.appendChild(tag);
    })(numCols[i]);
  }

  statsResult.innerHTML='<div class="stats-empty">请选择列并指定行号范围后点击计算</div>';
  statsOverlay.style.display='flex';
}

document.getElementById('statsClose').addEventListener('click',function(){statsOverlay.style.display='none'});
statsOverlay.addEventListener('click',function(e){if(e.target===statsOverlay)statsOverlay.style.display='none'});

document.getElementById('statsCalcBtn').addEventListener('click',function(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!loc.rows)return;
  var rows=loc.rows;
  var t=TABS[activeTab];
  var visCols=loc.visibleCols;
  var headerLabels=visCols?visCols.map(function(c){return t.headers[c]}):t.headers;

  var from=parseInt(statsFrom.value)||1;
  var to=parseInt(statsTo.value)||rows.length;
  from=Math.max(1,Math.min(rows.length,from));
  to=Math.max(from,Math.min(rows.length,to));
  statsFrom.value=from;statsTo.value=to;

  if(statsSelectedCols.size===0){statsResult.innerHTML='<div class="stats-empty">请先点击上方选择要统计的列</div>';return}

  var cols=Array.from(statsSelectedCols).sort(function(a,b){return a-b});
  var rangeLen=to-from+1;

  // build data arrays per column
  var colData={};
  for(var i=0;i<cols.length;i++){
    var ci=cols[i];
    var vals=[];
    for(var r=from-1;r<to;r++){
      var v=visCols?rows[r][visCols[ci]]:rows[r][ci];
      var n=Number(v);
      if(!isNaN(n)&&v!==''&&v!==null) vals.push(n);
    }
    colData[ci]=vals;
  }

  // stats table
  var html='<div style="margin-bottom:8px;font-size:13px;color:#666">行 '+from+' ~ '+to+' (共 '+rangeLen+' 行)</div>';
  html+='<table class="stats-table"><tr><th>统计项</th>';
  for(var i=0;i<cols.length;i++) html+='<th>'+esc(headerLabels[cols[i]])+'</th>';
  html+='</tr>';

  var rowLabels=[
    {label:'样本数',fn:function(v){return v.length}},
    {label:'最小值',fn:function(v){return v.length?fmtN(v[0]):'-'}},
    {label:'最大值',fn:function(v){return v.length?fmtN(v[v.length-1]):'-'}},
    {label:'平均值',fn:function(v){if(!v.length)return'-';var s=0;for(var i=0;i<v.length;i++)s+=v[i];return fmtN(s/v.length)}},
    {label:'中位数',fn:function(v){if(!v.length)return'-';var m=Math.floor(v.length/2);return fmtN(v.length%2?v[m]:(v[m-1]+v[m])/2)}},
    {label:'标准差',fn:function(v){if(v.length<2)return'-';var s=0;for(var i=0;i<v.length;i++)s+=v[i];var avg=s/v.length;var ss=0;for(var i=0;i<v.length;i++)ss+=(v[i]-avg)*(v[i]-avg);return fmtN(Math.sqrt(ss/v.length))}},
    {label:'总变化量',fn:function(v){return v.length>=2?fmtN(v[v.length-1]-v[0]):'-'}},
    {label:'起始值',fn:function(v){return v.length?fmtN(v[0]):'-'}},
    {label:'结束值',fn:function(v){return v.length?fmtN(v[v.length-1]):'-'}},
    {label:'变化率/行',fn:function(v){if(v.length<2)return'-';return fmtN((v[v.length-1]-v[0])/(v.length-1))}},
    {label:'最大单步变化',fn:function(v){if(v.length<2)return'-';var mx=0;for(var i=1;i<v.length;i++){var d=Math.abs(v[i]-v[i-1]);if(d>mx)mx=d}return fmtN(mx)}},
    {label:'P25',fn:function(v){if(!v.length)return'-';var idx=Math.floor(v.length*0.25);return fmtN(v[Math.min(idx,v.length-1)])}},
    {label:'P75',fn:function(v){if(!v.length)return'-';var idx=Math.floor(v.length*0.75);return fmtN(v[Math.min(idx,v.length-1)])}},
    {label:'P95',fn:function(v){if(!v.length)return'-';var idx=Math.floor(v.length*0.95);return fmtN(v[Math.min(idx,v.length-1)])}}
  ];

  for(var ri=0;ri<rowLabels.length;ri++){
    var rl=rowLabels[ri];
    html+='<tr><td class="st-label">'+rl.label+'</td>';
    for(var i=0;i<cols.length;i++){
      var vals=colData[cols[i]].slice().sort(function(a,b){return a-b});
      var val=rl.fn(vals);
      // color up/down for delta row
      var cls='stats-val-neutral';
      if(rl.label==='总变化量'||rl.label==='变化率/行'){
        var vn=parseFloat(val);
        if(!isNaN(vn)){cls=vn>0?'stats-val-up':vn<0?'stats-val-down':'stats-val-neutral'}
      }
      html+='<td class="'+cls+'">'+val+'</td>';
    }
    html+='</tr>';
  }

  // trend detection row
  html+='<tr><td class="st-label">趋势</td>';
  for(var i=0;i<cols.length;i++){
    var vals=colData[cols[i]];
    if(vals.length<2){html+='<td>-</td>';continue}
    var up=0,dn=0;
    for(var k=1;k<vals.length;k++){if(vals[k]>vals[k-1])up++;else if(vals[k]<vals[k-1])dn++}
    var trend=up>vals.length*0.6?'↑ 上升':dn>vals.length*0.6?'↓ 下降':'↔ 波动';
    var tc=up>vals.length*0.6?'stats-val-up':dn>vals.length*0.6?'stats-val-down':'stats-val-neutral';
    html+='<td class="'+tc+'">'+trend+'</td>';
  }
  html+='</tr>';

  html+='</table>';
  statsResult.innerHTML=html;
});

function fmtN(n){return Number.isInteger(n)?String(n):n.toFixed(2)}

// ===================== Chart =====================
var CHART_PAD={t:30,r:80,b:40,l:60};
var CHART_SKIP_LABELS={'源文件':1,'Android时间':1,'时间戳(s)':1,'原始时间戳':1,'日志级别':1,'调用线程':1};

// Min-max downsampling: for each pixel bucket, keep min & max to preserve visual shape
function minMaxSample(data,si,vp,target){
  if(vp<=target)return null;
  var result=[],bs=vp/target;
  for(var b=0;b<target;b++){
    var from=si+Math.floor(b*bs),to=si+Math.min(Math.ceil((b+1)*bs),si+vp);
    if(from>=data.length)break;
    var mn=Infinity,mx=-Infinity,mi=from,xi=from,has=false;
    for(var j=from;j<to&&j<data.length;j++){
      if(data[j]===null)continue;
      has=true;
      if(data[j]<mn){mn=data[j];mi=j}
      if(data[j]>mx){mx=data[j];xi=j}
    }
    if(!has)continue;
    if(mi<=xi){result.push({i:mi,v:mn});if(mn!==mx)result.push({i:xi,v:mx})}
    else{result.push({i:xi,v:mx});if(mn!==mx)result.push({i:mi,v:mn})}
  }
  return result;
}

// Format android_time "2026-01-04 22:38:01.351" to compact "01-04 22:38:01"
function fmtChartTime(s){
  if(!s)return'';
  var m=s.match(/\d{4}-(\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  return m?m[1]:s;
}

function showChart(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!loc.rows)return;
  var rows=loc.rows;
  var t=TABS[activeTab];
  var visCols=loc.visibleCols;
  var headerLabels=visCols?visCols.map(function(c){return t.headers[c]}):t.headers;
  var colKeys=visCols?visCols:null;

  // detect numeric columns (int + float), skip known non-data labels
  chartConfigs=[];
  for(var ci=0;ci<headerLabels.length;ci++){
    if(CHART_SKIP_LABELS[headerLabels[ci]])continue;
    var vals=[];
    for(var ri=0;ri<rows.length;ri++){
      var v=colKeys?rows[ri][colKeys[ci]]:rows[ri][ci];
      var n=Number(v);
      if(!isNaN(n)&&v!==''&&v!==null)vals.push(n);
    }
    if(vals.length<2)continue;
    vals.sort(function(a,b){return a-b});
    chartConfigs.push({
      ci:ci,name:headerLabels[ci],
      visible:false,
      color:CHART_COLORS[chartConfigs.length%CHART_COLORS.length],
      data:(colKeys?rows.map(function(r){var n=Number(r[colKeys[ci]]);return isNaN(n)?null:n}):rows.map(function(r){var n=Number(r[ci]);return isNaN(n)?null:n})),
      min:vals[0],max:vals[vals.length-1]
    });
  }

  if(chartConfigs.length===0){alert('未检测到可绘图的数值列');return}

  // find source_file and android_time column indices for tooltip and X axis
  chartTooltipAT=-1;chartTooltipSF=-1;chartColKeys=colKeys;chartRows=rows;
  for(var ci=0;ci<headerLabels.length;ci++){
    if(headerLabels[ci]==='Android时间')chartTooltipAT=ci;
    if(headerLabels[ci]==='源文件')chartTooltipSF=ci;
  }

  chartZoom=1;chartOffX=0;chartMouse={x:-1,y:-1};
  chartIsPanning=false;
  chartOverlay.style.display='flex';

  // build panel
  var ph='<div class="chart-p-section">曲线选择</div>';
  for(var i=0;i<chartConfigs.length;i++){
    var c=chartConfigs[i];
    ph+='<div class="chart-p-item"><input type="checkbox" data-ci="'+i+'"><input type="color" class="chart-color-pick" data-ci="'+i+'" value="'+c.color+'"><span class="chart-p-name">'+esc(c.name)+'</span><span class="chart-p-val" id="chartVal_'+i+'">-</span></div>';
  }
  chartPanel.innerHTML=ph;
  chartPanel.querySelectorAll('input[type=checkbox]').forEach(function(cb){
    cb.addEventListener('change',function(e){
      chartConfigs[parseInt(e.target.dataset.ci)].visible=e.target.checked;
      drawChart();
    });
    cb.addEventListener('click',function(e){e.stopPropagation()});
  });
  chartPanel.querySelectorAll('.chart-color-pick').forEach(function(cp){
    cp.addEventListener('input',function(e){
      var ci=parseInt(e.target.dataset.ci);
      chartConfigs[ci].color=e.target.value;
      drawChart();
    });
  });

  if(!chartResizeObs)setupChartResize();
  resizeChartCanvas();
}

// High-DPI canvas resize
function resizeChartCanvas(){
  var wrap=chartCanvas.parentElement;
  var dpr=window.devicePixelRatio||1;
  var cw=wrap.clientWidth,ch=wrap.clientHeight;
  if(cw===0||ch===0)return;
  chartCanvas.width=cw*dpr;
  chartCanvas.height=ch*dpr;
  chartCanvas.style.width=cw+'px';
  chartCanvas.style.height=ch+'px';
  chartCanvas.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
  drawChart();
}

function setupChartResize(){
  chartResizeObs=new ResizeObserver(function(){
    if(chartOverlay.style.display==='flex')resizeChartCanvas();
  });
  chartResizeObs.observe(chartCanvas.parentElement);
}

// Zoom: mouse-position-anchored wheel with clamping
chartCanvas.addEventListener('wheel',function(e){
  e.preventDefault();
  var P=CHART_PAD,rect=chartCanvas.getBoundingClientRect();
  var mx=e.clientX-rect.left;
  var cw=rect.width-P.l-P.r;
  var visible=chartConfigs.filter(function(c){return c.visible&&c.data.length>0});
  var total=visible.length>0?visible.reduce(function(m,c){return Math.max(m,c.data.length)},0):1;
  var oldZ=chartZoom,d=e.deltaY>0?0.9:1.1;
  chartZoom=Math.max(1,Math.min(50,chartZoom*d));
  var ratio=Math.max(0,Math.min(1,(mx-P.l)/cw));
  var oldVP=Math.min(total,Math.ceil(total/oldZ));
  var newVP=Math.min(total,Math.ceil(total/chartZoom));
  var oldSI=Math.max(0,Math.min(total-oldVP,Math.floor(chartOffX/cw*total/oldZ)));
  var mouseDI=oldSI+ratio*oldVP;
  var newSI=mouseDI-ratio*newVP;
  var maxOff=Math.max(0,(total-newVP)*cw/total*chartZoom);
  chartOffX=Math.max(0,Math.min(maxOff,newSI*cw/total*chartZoom));
  drawChart();
},{passive:false});

// Pan: horizontal drag within plot area
chartCanvas.addEventListener('mousedown',function(e){
  if(e.button!==0)return;
  var P=CHART_PAD,rect=chartCanvas.getBoundingClientRect();
  var mx=e.clientX-rect.left,my=e.clientY-rect.top;
  if(mx<P.l||mx>rect.width-P.r||my<P.t||my>rect.height-P.b)return;
  // cache pan boundary at drag start
  var visible=chartConfigs.filter(function(c){return c.visible&&c.data.length>0});
  var total=visible.length>0?visible.reduce(function(m,c){return Math.max(m,c.data.length)},0):1;
  var cw=rect.width-P.l-P.r;
  var vp=Math.min(total,Math.ceil(total/chartZoom));
  chartPanMaxOffX=Math.max(0,(total-vp)*cw/total*chartZoom);
  chartIsPanning=true;chartPanStartX=e.clientX;chartPanStartOffX=chartOffX;
  chartCanvas.style.cursor='grabbing';
});
window.addEventListener('mousemove',function(e){
  if(!chartIsPanning)return;
  chartOffX=Math.max(0,Math.min(chartPanMaxOffX,chartPanStartOffX-(e.clientX-chartPanStartX)));
  drawChart();
});
window.addEventListener('mouseup',function(){
  if(chartIsPanning){chartIsPanning=false;chartCanvas.style.cursor='crosshair'}
});

// Reset zoom + pan on double-click
chartCanvas.addEventListener('dblclick',function(){chartZoom=1;chartOffX=0;drawChart()});

// Hover: rAF-throttled, skip during pan
chartCanvas.addEventListener('mousemove',function(e){
  if(chartIsPanning)return;
  var rect=chartCanvas.getBoundingClientRect();
  chartMouse={x:e.clientX-rect.left,y:e.clientY-rect.top};
  if(!chartRaf)chartRaf=requestAnimationFrame(function(){chartRaf=0;drawChart()});
});
chartCanvas.addEventListener('mouseleave',function(){chartMouse={x:-1,y:-1};drawChart()});
document.getElementById('chartClose').addEventListener('click',function(){chartOverlay.style.display='none';chartSel={active:false,startX:-1,endX:-1,startDi:-1,endDi:-1,stats:null};document.getElementById('rangeStats').style.display='none'});

// ---- Range selection: Shift+drag for interval stats ----
chartCanvas.addEventListener('mousedown',function(e){
  if(!e.shiftKey||e.button!==0)return;
  var P=CHART_PAD,rect=chartCanvas.getBoundingClientRect();
  var mx=e.clientX-rect.left,my=e.clientY-rect.top;
  if(mx<P.l||mx>rect.width-P.r||my<P.t||my>rect.height-P.b)return;
  chartSel={active:true,startX:mx,endX:mx,startDi:-1,endDi:-1,stats:null};
  var visible=chartConfigs.filter(function(c){return c.visible&&c.data.length>0});
  var total=visible.length>0?visible.reduce(function(m,c){return Math.max(m,c.data.length)},0):1;
  var cw=rect.width-P.l-P.r;
  var vp=Math.min(total,Math.ceil(total/chartZoom));
  var si=Math.max(0,Math.min(total-vp,Math.floor(chartOffX/cw*total/chartZoom)));
  chartSel.startDi=Math.round(((mx-P.l)/cw)*vp)+si;
  chartSel.endDi=chartSel.startDi;
  e.preventDefault();e.stopPropagation();
});
window.addEventListener('mousemove',function(e){
  if(!chartSel.active)return;
  var P=CHART_PAD,rect=chartCanvas.getBoundingClientRect();
  var mx=e.clientX-rect.left;
  mx=Math.max(P.l,Math.min(rect.width-P.r,mx));
  chartSel.endX=mx;
  var visible=chartConfigs.filter(function(c){return c.visible&&c.data.length>0});
  var total=visible.length>0?visible.reduce(function(m,c){return Math.max(m,c.data.length)},0):1;
  var cw=rect.width-P.l-P.r;
  var vp=Math.min(total,Math.ceil(total/chartZoom));
  var si=Math.max(0,Math.min(total-vp,Math.floor(chartOffX/cw*total/chartZoom)));
  chartSel.endDi=Math.round(((mx-P.l)/cw)*vp)+si;
  drawChart();
});
window.addEventListener('mouseup',function(e){
  if(!chartSel.active)return;
  chartSel.active=false;
  var from=Math.min(chartSel.startDi,chartSel.endDi);
  var to=Math.max(chartSel.startDi,chartSel.endDi);
  if(to-from<1){chartSel.stats=null;drawChart();return}
  // compute stats
  var visible=chartConfigs.filter(function(c){return c.visible&&c.data.length>0});
  var cols=[];
  visible.forEach(function(cfg){
    var vals=[];
    for(var i=from;i<=to;i++){
      if(i<cfg.data.length&&cfg.data[i]!==null)vals.push(cfg.data[i]);
    }
    if(vals.length<2)return;
    vals.sort(function(a,b){return a-b});
    var sum=0;for(var k=0;k<vals.length;k++)sum+=vals[k];
    var avg=sum/vals.length;
    var ss=0;for(var k=0;k<vals.length;k++)ss+=(vals[k]-avg)*(vals[k]-avg);
    var allVals=[];
    for(var i=from;i<=to;i++){if(i<cfg.data.length&&cfg.data[i]!==null)allVals.push(cfg.data[i])}
    cols.push({
      name:cfg.name,color:cfg.color,
      min:vals[0],max:vals[vals.length-1],avg:avg,
      stdDev:Math.sqrt(ss/vals.length),
      delta:allVals.length>=2?allVals[allVals.length-1]-allVals[0]:'-',
      start:allVals[0]||'-',end:allVals.length?allVals[allVals.length-1]:'-',
      count:vals.length
    });
  });
  chartSel.stats={from:from,to:to,cols:cols};
  drawChart();
});

// ---- Threshold management ----
function openThreshDialog(){
  var sel=document.getElementById('threshSeries');
  sel.innerHTML='';
  var visCount=0;
  chartConfigs.forEach(function(cfg,i){
    if(cfg.visible){
      var opt=document.createElement('option');
      opt.value=i;opt.textContent=cfg.name;
      sel.appendChild(opt);visCount++;
    }
  });
  if(visCount===0){alert('请先勾选至少一条曲线');return}
  document.getElementById('threshValue').value='';
  renderThreshList();
  document.getElementById('threshOverlay').style.display='flex';
}
function renderThreshList(){
  var list=document.getElementById('threshList');
  if(chartThresholds.length===0){
    list.innerHTML='<div class="thresh-empty">暂无阈值线，请在上方选择曲线和数值后添加</div>';return;
  }
  var html='';
  chartThresholds.forEach(function(t,i){
    html+='<div class="thresh-item"><span class="thresh-item-color" style="background:'+t.color+'"></span>'
      +'<span class="thresh-item-name">'+esc(t.name)+'</span>'
      +'<span class="thresh-item-val">= '+t.value+'</span>'
      +'<span class="thresh-item-del" data-idx="'+i+'">&times;</span></div>';
  });
  list.innerHTML=html;
  list.querySelectorAll('.thresh-item-del').forEach(function(el){
    el.addEventListener('click',function(){
      chartThresholds.splice(parseInt(el.dataset.idx),1);
      renderThreshList();drawChart();
    });
  });
}
document.getElementById('chartThreshBtn').addEventListener('click',openThreshDialog);
document.getElementById('threshClose').addEventListener('click',function(){document.getElementById('threshOverlay').style.display='none'});
document.getElementById('threshOverlay').addEventListener('click',function(e){if(e.target.id==='threshOverlay')e.target.style.display='none'});
document.getElementById('threshAddBtn').addEventListener('click',function(){
  var ci=parseInt(document.getElementById('threshSeries').value);
  var val=parseFloat(document.getElementById('threshValue').value);
  if(isNaN(ci)||!chartConfigs[ci]){alert('请选择一条曲线');return}
  if(isNaN(val)){alert('请输入有效的数值');return}
  chartThresholds.push({ci:ci,name:chartConfigs[ci].name,value:val,color:chartConfigs[ci].color});
  document.getElementById('threshValue').value='';
  renderThreshList();drawChart();
});

// ---- Export PNG ----
document.getElementById('chartExportBtn').addEventListener('click',function(){
  var dpr=window.devicePixelRatio||1;
  var W=chartCanvas.width/dpr,H=chartCanvas.height/dpr;
  // render a clean copy without hover cursor
  var savedMouse={x:chartMouse.x,y:chartMouse.y};
  chartMouse={x:-1,y:-1};
  drawChart();
  // draw watermark
  var ctx=chartCanvas.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,0.15)';ctx.font='11px Arial';ctx.textAlign='right';ctx.textBaseline='bottom';
  ctx.fillText('VivoLog',W-8,H-4);
  chartCanvas.toBlob(function(blob){
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;
    var t=TABS[activeTab];
    a.download=(t?t.name:'chart')+'_'+Date.now()+'.png';
    a.click();
    URL.revokeObjectURL(url);
    chartMouse=savedMouse;
    drawChart();
  },'image/png');
});

// ---- Chart render sub-functions ----

function drawChart(){
  var dpr=window.devicePixelRatio||1;
  var ctx=chartCanvas.getContext('2d');
  var W=chartCanvas.width/dpr,H=chartCanvas.height/dpr;
  var P=CHART_PAD,cw=W-P.l-P.r,ch=H-P.t-P.b;

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#fafafa';ctx.fillRect(0,0,W,H);

  var visible=chartConfigs.filter(function(c){return c.visible&&c.data.length>0});
  if(visible.length===0){
    ctx.fillStyle='#999';ctx.font='14px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('请在右侧勾选要显示的列',W/2,H/2);return;
  }

  var total=visible.reduce(function(m,c){return Math.max(m,c.data.length)},0);
  var vp=Math.min(total,Math.ceil(total/chartZoom));
  var si=Math.max(0,Math.min(total-vp,Math.floor(chartOffX/cw*total/chartZoom)));

  drawGrid(ctx,P,W,cw,ch);
  drawYAxes(ctx,P,W,cw,ch,visible);
  drawXAxis(ctx,P,W,H,cw,vp,si,total);
  drawLines(ctx,P,cw,ch,visible,vp,si);
  drawThresholds(ctx,P,W,H,cw,ch,visible,vp,si);
  drawRangeSelection(ctx,P,W,H,cw,ch,visible,vp,si,total);
  drawHover(ctx,P,W,H,cw,ch,visible,vp,si,total);
}

function drawGrid(ctx,P,W,cw,ch){
  ctx.strokeStyle='rgba(0,0,0,0.06)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
  for(var i=0;i<=5;i++){var y=P.t+(ch/5)*i;ctx.beginPath();ctx.moveTo(P.l,y);ctx.lineTo(W-P.r,y);ctx.stroke()}
  ctx.setLineDash([]);
}

function drawYAxes(ctx,P,W,cw,ch,visible){
  ctx.font='11px Consolas,Arial';ctx.textBaseline='middle';
  // Max 2 Y-axes (left for first series, right for second) to avoid overlap
  var drawn=0;
  for(var vi=0;vi<visible.length&&drawn<2;vi++){
    var cfg=visible[vi],range=cfg.max-cfg.min;
    if(range===0)continue;
    ctx.fillStyle=cfg.color;
    for(var i=0;i<=5;i++){
      var v=cfg.max-(range/5)*i,y=P.t+(ch/5)*i;
      if(drawn===0){ctx.textAlign='right';ctx.fillText(fmtN(v),P.l-8,y)}
      else{ctx.textAlign='left';ctx.fillText(fmtN(v),W-P.r+8,y)}
    }
    drawn++;
  }
}

function drawXAxis(ctx,P,W,H,cw,vp,si,total){
  ctx.fillStyle='#666';ctx.textAlign='center';ctx.textBaseline='top';
  var xs=Math.max(1,Math.floor(vp/10));
  var useTime=chartTooltipAT>=0;
  for(var i=0;i<vp;i+=xs){
    var di=si+i;if(di>=total)break;
    var x=P.l+(cw/vp)*i;
    if(useTime){
      var tv=chartColKeys?chartRows[di][chartColKeys[chartTooltipAT]]:chartRows[di][chartTooltipAT];
      ctx.fillText(fmtChartTime(tv)||String(di+1),x,H-P.b+8);
    }else{
      ctx.fillText(String(di+1),x,H-P.b+8);
    }
  }
}

function drawLines(ctx,P,cw,ch,visible,vp,si){
  var dpr=window.devicePixelRatio||1;
  var pixelW=Math.round(cw*dpr);
  visible.forEach(function(cfg){
    var range=cfg.max-cfg.min;
    if(range===0)return;
    ctx.beginPath();ctx.strokeStyle=cfg.color;ctx.lineWidth=1.5;
    var pts=minMaxSample(cfg.data,si,vp,pixelW);
    var started=false;
    if(pts){
      // downsampled path — preserves visual peaks and valleys
      for(var k=0;k<pts.length;k++){
        var p=pts[k],x=P.l+((p.i-si)/vp)*cw,y=P.t+ch*(1-(p.v-cfg.min)/range);
        if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y);
      }
    }else{
      // direct draw for small datasets
      for(var k=0;k<vp;k++){
        var di=si+k;
        if(di>=cfg.data.length||cfg.data[di]===null){started=false;continue}
        var x=P.l+(cw/vp)*k,y=P.t+ch*(1-(cfg.data[di]-cfg.min)/range);
        if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y);
      }
    }
    ctx.stroke();
  });
}

function drawHover(ctx,P,W,H,cw,ch,visible,vp,si,total){
  if(chartMouse.x<P.l||chartMouse.x>W-P.r||chartMouse.y<P.t||chartMouse.y>P.t+ch){
    resetPanelVals();return;
  }
  var di=Math.round(((chartMouse.x-P.l)/cw)*vp)+si;
  if(di<0||di>=total){resetPanelVals();return}

  // vertical crosshair line
  var x=P.l+((di-si)/vp)*cw;
  ctx.beginPath();ctx.strokeStyle='rgba(0,0,0,0.25)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
  ctx.moveTo(x,P.t);ctx.lineTo(x,P.t+ch);ctx.stroke();
  // horizontal crosshair line — read Y value from first axis series
  ctx.moveTo(P.l,chartMouse.y);ctx.lineTo(W-P.r,chartMouse.y);ctx.stroke();
  ctx.setLineDash([]);
  // Y value label on the horizontal line
  if(visible.length>0){
    var cfg0=visible[0],range0=cfg0.max-cfg0.min;
    if(range0>0){
      var yVal=cfg0.max-(chartMouse.y-P.t)/ch*range0;
      ctx.font='10px Consolas,Arial';ctx.textAlign='left';ctx.textBaseline='bottom';
      ctx.fillStyle='rgba(0,0,0,0.55)';ctx.fillText(fmtN(yVal),P.l+4,chartMouse.y-3);
    }
  }

  // tooltip content
  var tips=['行 '+(di+1)];
  if(chartTooltipAT>=0){var atv=chartColKeys?chartRows[di][chartColKeys[chartTooltipAT]]:chartRows[di][chartTooltipAT];if(atv!==undefined&&atv!==''&&atv!==null)tips.push('时间: '+atv)}
  if(chartTooltipSF>=0){var sfv=chartColKeys?chartRows[di][chartColKeys[chartTooltipSF]]:chartRows[di][chartTooltipSF];if(sfv!==undefined&&sfv!==''&&sfv!==null)tips.push('文件: '+sfv)}

  // data point dots
  visible.forEach(function(cfg){
    if(di>=cfg.data.length||cfg.data[di]===null)return;
    var range=cfg.max-cfg.min;if(range===0)return;
    var y=P.t+ch*(1-(cfg.data[di]-cfg.min)/range);
    ctx.beginPath();ctx.fillStyle=cfg.color;ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    tips.push(cfg.name+': '+fmtN(cfg.data[di]));
  });

  // tooltip box
  var tw=280,th=tips.length*18+12;
  var tx=chartMouse.x+15,ty=chartMouse.y+15;
  if(tx+tw>W)tx=chartMouse.x-tw-15;
  if(ty+th>H)ty=chartMouse.y-th-15;
  ctx.fillStyle='rgba(0,0,0,0.85)';
  if(ctx.roundRect)ctx.roundRect(tx,ty,tw,th,4);else ctx.rect(tx,ty,tw,th);
  ctx.fill();
  ctx.fillStyle='#fff';ctx.font='12px Consolas,Arial';ctx.textAlign='left';ctx.textBaseline='top';
  tips.forEach(function(t,i){ctx.fillText(t,tx+8,ty+6+i*18)});

  // update right-panel per-series value displays
  for(var vi=0;vi<chartConfigs.length;vi++){
    var vel=document.getElementById('chartVal_'+vi);
    if(!vel)continue;
    var cfg=chartConfigs[vi];
    if(di<cfg.data.length&&cfg.data[di]!==null)vel.textContent=fmtN(cfg.data[di]);
    else vel.textContent='-';
  }
}

function drawThresholds(ctx,P,W,H,cw,ch,visible,vp,si){
  if(chartThresholds.length===0)return;
  chartThresholds.forEach(function(t){
    var cfg=chartConfigs[t.ci];
    if(!cfg||!cfg.visible)return;
    var range=cfg.max-cfg.min;
    if(range===0)return;
    var y=P.t+ch*(1-(t.value-cfg.min)/range);
    if(y<P.t||y>P.t+ch)return;
    // dashed threshold line
    ctx.beginPath();ctx.strokeStyle=t.color;ctx.lineWidth=1.5;ctx.setLineDash([6,4]);
    ctx.moveTo(P.l,y);ctx.lineTo(W-P.r,y);ctx.stroke();ctx.setLineDash([]);
    // label background + text
    var label=t.name+' = '+fmtN(t.value);
    ctx.font='11px Consolas,Arial';
    var tw=ctx.measureText(label).width+8;
    ctx.fillStyle='rgba(255,255,255,0.9)';
    ctx.fillRect(P.l+4,y-9,tw,16);
    ctx.fillStyle=t.color;ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText(label,P.l+8,y);
  });
}

function drawRangeSelection(ctx,P,W,H,cw,ch,visible,vp,si,total){
  var from=Math.min(chartSel.startDi,chartSel.endDi);
  var to=Math.max(chartSel.startDi,chartSel.endDi);
  // draw selection band if active or has stats
  if(chartSel.active){
    var x1=P.l+((from-si)/vp)*cw;
    var x2=P.l+((to-si)/vp)*cw;
    ctx.fillStyle='rgba(46,125,50,0.12)';
    ctx.fillRect(Math.max(P.l,x1),P.t,Math.min(W-P.r,x2)-Math.max(P.l,x1),ch);
    // edge lines
    ctx.beginPath();ctx.strokeStyle='rgba(46,125,50,0.6)';ctx.lineWidth=1;ctx.setLineDash([3,3]);
    if(x1>=P.l&&x1<=W-P.r){ctx.moveTo(x1,P.t);ctx.lineTo(x1,P.t+ch);ctx.stroke()}
    if(x2>=P.l&&x2<=W-P.r){ctx.moveTo(x2,P.t);ctx.lineTo(x2,P.t+ch);ctx.stroke()}
    ctx.setLineDash([]);
  }
  // render stats popup if available
  if(chartSel.stats){
    var s=chartSel.stats;
    var x1=P.l+((s.from-si)/vp)*cw;
    var x2=P.l+((s.to-si)/vp)*cw;
    var midX=(Math.max(P.l,x1)+Math.min(W-P.r,x2))/2;
    renderRangeStats(s,midX,P.t,P.r,W,H);
  }
}

function renderRangeStats(s,anchorX,top,padR,W,H){
  var el=document.getElementById('rangeStats');
  if(!el)return;
  if(!s||!s.cols||s.cols.length===0){el.style.display='none';return}
  var html='<div class="range-stats-title">区间统计 — 行 '+(s.from+1)+' ~ '+(s.to+1)+' ('+((s.to-s.from+1))+'行)</div>';
  s.cols.forEach(function(c){
    html+='<div style="margin-top:8px;font-weight:600;color:'+c.color+'">'+esc(c.name)+'</div>';
    html+='<table><tr><th>样本</th><td>'+c.count+'</td><th>最小</th><td>'+fmtN(c.min)+'</td></tr>';
    html+='<tr><th>最大</th><td>'+fmtN(c.max)+'</td><th>均值</th><td>'+fmtN(c.avg)+'</td></tr>';
    html+='<tr><th>标准差</th><td>'+fmtN(c.stdDev)+'</td><th>变化量</th><td style="color:'+(c.delta>0?'#c62828':c.delta<0?'#1565c0':'#666')+'">'+fmtN(c.delta)+'</td></tr>';
    html+='<tr><th>起始</th><td>'+fmtN(c.start)+'</td><th>结束</th><td>'+fmtN(c.end)+'</td></tr></table>';
  });
  el.innerHTML=html;
  el.style.display='block';
  el.style.top=(top+40)+'px';
  el.style.left='50%';
  el.style.transform='translateX(-50%)';
}

function resetPanelVals(){
  for(var vi=0;vi<chartConfigs.length;vi++){var vel=document.getElementById('chartVal_'+vi);if(vel)vel.textContent='-'}
}


// ===================== Export CSV =====================
function exportCSV(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!loc.rows){alert('无数据可导出');return}
  var rows=loc.rows;
  var t=TABS[activeTab];
  var visCols=loc.visibleCols;
  var headers=visCols?visCols.map(function(c){return t.headers[c]}):t.headers;
  var lines=[];
  lines.push('"#","'+headers.map(function(h){return h.replace(/"/g,'""')}).join('","')+'"');
  for(var i=0;i<rows.length;i++){
    var rd=rows[i];
    var cells=[String(i+1)];
    if(visCols){for(var j=0;j<visCols.length;j++){var v=rd[visCols[j]];cells.push('"'+(v===undefined||v===null?'':String(v).replace(/"/g,'""'))+'"')}}
    else{for(var j=0;j<headers.length;j++){var v=rd[j];cells.push('"'+(v===undefined||v===null?'':String(v).replace(/"/g,'""'))+'"')}}
    lines.push(cells.join(','));
  }
  var csv='﻿'+lines.join('\\n');
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(t.keyword.replace(/_(mtk|qcom|default)$/,'')||'analysis')+'_'+rows.length+'rows.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===================== Print Format =====================
function showInterfaceDialog(tabIdx){
  var t=TABS[tabIdx];
  if(!t||!t.printInterface){alert('该标签页无打印格式信息');return}
  var kw=t.keyword.replace(/_(mtk|qcom|default)$/,'');
  var pf=t.keyword.match(/_(mtk|qcom|default)$/);
  ifaceTitle.textContent='打印格式';
  var kl=t.keyLabels||{};
  var html='';
  html+='<div class="iface-meta">';
  html+='<span>关键词：<b>'+esc(kw)+'</b></span>';
  if(pf)html+='<span>平台：<b>'+esc(pf[1])+'</b></span>';
  html+='<span>数据行：<b>'+t.count+'</b></span>';
  html+='</div>';
  html+='<div class="iface-section"><div class="iface-section-title">打印格式</div><div class="iface-code">'+esc(t.printInterface)+'</div></div>';
  html+='<div class="iface-section"><div class="iface-section-title">字段映射 ('+((t.fieldMapping||[]).length)+')</div>';
  html+='<div class="iface-field-list">';
  var mapping=t.fieldMapping||[];
  var unmatchedKeys=new Set((t.unmatchedFields||[]).map(function(f){return f.key}));
  for(var i=0;i<mapping.length;i++){
    var m=mapping[i];
    var isEmpty=unmatchedKeys.size>0&&m.keys.every(function(k){return unmatchedKeys.has(k)});
    html+='<div class="iface-field-item'+(isEmpty?' iface-field-empty':'')+'">';
    html+='<span class="iface-field-raw">'+esc(m.raw)+'</span>';
    html+='<span class="iface-field-arrow">→</span>';
    html+='<span class="iface-field-label">'+m.keys.map(function(k){return esc(kl[k]||k)}).join(' / ')+'</span>';
    if(isEmpty)html+='<span class="iface-unmatched">未匹配</span>';
    html+='</div>';
  }
  html+='</div></div>';
  ifaceBody.innerHTML=html;
  ifaceOverlay.style.display='flex';
}

// ===================== Column Selection =====================
var colDialogTabIdx=-1;
function showColumnDialog(tabIdx){
  if(tabIdx<0||tabIdx>=TABS.length)return;
  colDialogTabIdx=tabIdx;
  var t=TABS[tabIdx];
  colDialogTitle.textContent='选择显示列 — '+t.name;
  var html='';
  for(var i=0;i<t.headers.length;i++) html+='<label class="col-item"><input type="checkbox" data-ci="'+i+'"><span>'+esc(t.headers[i])+'</span></label>';
  colDialogList.innerHTML=html;
  colOverlay.style.display='flex';
}

// ===================== Delegated Button Clicks =====================
document.addEventListener('click',function(e){
  if(e.target.id==='ifaceBtn') showInterfaceDialog(activeTab);
  else if(e.target.id==='colBtn') showColumnDialog(activeTab);
  else if(e.target.id==='chartBtn') showChart();
  else if(e.target.id==='statsBtn') showStatsDialog();
  else if(e.target.id==='exportBtn') exportCSV();
  else if(e.target.id==='exportReportBtn'&&window.logAnalysis&&window.logAnalysis.saveReport) window.logAnalysis.saveReport();
});
ifaceClose.addEventListener('click',function(){ifaceOverlay.style.display='none'});
ifaceOverlay.addEventListener('click',function(e){if(e.target===ifaceOverlay)ifaceOverlay.style.display='none'});

document.getElementById('colAll').addEventListener('click',function(){
  colDialogList.querySelectorAll('input[type=checkbox]').forEach(function(cb){cb.checked=true});
});
document.getElementById('colNone').addEventListener('click',function(){
  colDialogList.querySelectorAll('input[type=checkbox]').forEach(function(cb){cb.checked=false});
});
document.getElementById('colOk').addEventListener('click',function(){
  var sel=[];
  colDialogList.querySelectorAll('input[type=checkbox]').forEach(function(cb){if(cb.checked)sel.push(parseInt(cb.dataset.ci))});
  if(sel.length===0){alert('请至少选择一列');return}
  colOverlay.style.display='none';
  if(colDialogTabIdx<0)return;
  var loc=tabLocal[colDialogTabIdx];
  var t=TABS[colDialogTabIdx];
  loc.visibleCols=sel.length===t.headers.length?null:sel;
  if(colDialogTabIdx===activeTab) renderTab(activeTab);
});
document.getElementById('colCancel').addEventListener('click',function(){colOverlay.style.display='none'});
colOverlay.addEventListener('click',function(e){if(e.target===colOverlay) colOverlay.style.display='none'});

</script>
</body>
</html>`;
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
