// ==== State: Constants, global variables, DOM references ====
// This file is loaded FIRST. All downstream files access these globals directly.
// When modifying, check the "Used by" annotations to assess blast radius.
//
// DATA FLOW SUMMARY:
//   state.js     → declares all shared state & DOM refs
//   data-access.js → provides DA.* async API (IPC or embedded)
//   tabs.js      → loads/switches tabs, manages chunk cache
//   canvas-renderer.js → draws the main data table
//   selection.js → handles cell selection, copy, hover
//   search.js    → search within current tab
//   chart-renderer.js → trend chart overlay (IIFE-wrapped)
//   link-panel.js     → linked comparison panel (IIFE-wrapped)
//   app.js       → initialization, loads last

// ---- Layout constants ----
// Used by: canvas-renderer.js, tabs.js, selection.js, link-panel.js, chart-renderer.js
var ROW_H=32,activeTab=0,HEADER_H=28,CHUNK_SIZE=3000;
var MAX_SCROLL_PX=1e7,scrollScale=ROW_H;
var FONT='13px "SF Mono","Consolas","Courier New",monospace';
var RN_FONT='11px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Arial,sans-serif';
var BUFFER=30;

// ---- Tab state ----
// Used by: tabs.js, canvas-renderer.js, selection.js, search.js, stats.js, chart-renderer.js, link-panel.js, app.js
var scrollTops=[],scrollLefts=[];

// ---- Core DOM references ----
// Used by: canvas-renderer.js, selection.js, tabs.js, search.js, link-panel.js
var container=document.getElementById('container');
var headerRow=document.getElementById('headerRow');
var spacer=document.getElementById('spacer');
var rnCover=document.getElementById('rnCover');
var canvas=document.getElementById('mainCanvas');
var ctx=canvas.getContext('2d');

// ---- Tab dropdown DOM ----
// Used by: tabs.js
var tabDd=document.getElementById('tabDd');
var tabDdBtn=document.getElementById('tabDdBtn');
var tabDdLabel=document.getElementById('tabDdLabel');
var tabDdMenu=document.getElementById('tabDdMenu');
var tabBar=document.getElementById('tabBar');
var loadingMask=document.getElementById('loadingMask');

// ---- Stats DOM ----
// Used by: stats.js
var statsBar=document.getElementById('statsBar');
var statsOverlay=document.getElementById('statsOverlay');
var statsFrom=document.getElementById('statsFrom');
var statsTo=document.getElementById('statsTo');
var statsCols=document.getElementById('statsCols');
var statsResult=document.getElementById('statsResult');

// ---- Column dialog DOM ----
// Used by: col-dialog.js
var colOverlay=document.getElementById('colOverlay');
var colDialogTitle=document.getElementById('colDialogTitle');
var colDialogList=document.getElementById('colDialogList');

// ---- Chart DOM ----
// Used by: chart-renderer.js
var chartOverlay=document.getElementById('chartOverlay');
var chartCanvas=document.getElementById('chartCanvas');
var chartPanel=document.getElementById('chartPanel');

// ---- Print format DOM ----
// Used by: iface-dialog.js
var ifaceOverlay=document.getElementById('ifaceOverlay');
var ifaceTitle=document.getElementById('ifaceTitle');
var ifaceBody=document.getElementById('ifaceBody');
var ifaceClose=document.getElementById('ifaceClose');

// ---- Tab data ----
// TABS: loaded from DataAccess.getTabs(), contains {name, count, headers, colWidths, keyword, ...}
// tabLocal: per-tab {rows:[], chunks:{}, visibleCols:null|array, loaded:bool, _full:bool}
// Used by: tabs.js, canvas-renderer.js, selection.js, search.js, stats.js, chart-renderer.js, link-panel.js, app.js
var TABS=[],tabLocal=[];

// ---- Canvas scroll cache ----
// Used by: canvas-renderer.js
var cachedST=0,cachedVH=0,cachedSL=0;

// ---- Selection state ----
// Used by: selection.js, canvas-renderer.js
var sel={anchorR:-1,anchorC:-1,endR:-1,endC:-1,active:false,dragging:false};
var hoverR=-1,hoverC=-1;

// ---- Chart config ----
// Used by: chart-renderer.js
var CHART_COLORS=['#007AFF','#FF9500','#34C759','#5856D6','#FF2D55','#5AC8FA','#FFCC00','#8E8E93'];
var chartConfigs=[],chartTimeData=null,chartFileData=null;

// ---- Stats selection ----
// Used by: stats.js
var statsSelectedCols=new Set();

// ---- Column layout (computed by tabs.js renderTab) ----
// Used by: canvas-renderer.js, selection.js, tabs.js
var curColLeft=null,curColWidths=null;
var rnW=50,dataW=0,totalW=0,totalH=0,totalCols=0,totalRows=0;

// ---- Canvas animation frames ----
// Used by: canvas-renderer.js
var drawRafId=0,altCurrent=0,altTarget=0,altRaf=0;

// ---- Search state ----
// Used by: search.js, canvas-renderer.js
var cachedMatchSet=null;
var srMatches=[],srCurrent=-1,srTerm='';
