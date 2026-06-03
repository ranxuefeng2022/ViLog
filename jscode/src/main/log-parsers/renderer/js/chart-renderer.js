// ==== Chart Renderer: IIFE-encapsulated, virtual-scroll, Y-auto-scale, navigator, smooth zoom ====
(function() {

// ================================================================
// 1. Constants
// ================================================================
var PAD = { t: 30, r: 80, b: 58, l: 60 };
var NAV_H = 20;
var SKIP_LABELS = { '源文件': 1, 'Android时间': 1, '时间戳(s)': 1, '原始时间戳': 1, '日志级别': 1, '调用线程': 1 };
var MAX_VISIBLE = 3000, DEFAULT_VISIBLE = 2000, MAX_POINTS = 5000;

// ================================================================
// 2. Private State
// ================================================================
var S = {
  zoom: 1, offX: 0, mouse: { x: -1, y: -1 },
  tooltipAT: -1, tooltipSF: -1, colKeys: null, rows: null,
  isPanning: false, panStartX: 0, panStartOffX: 0, panMaxOffX: 0,
  raf: 0, resizeObs: null,
  thresholds: [],
  sel: { active: false, startX: -1, endX: -1, startDi: -1, endDi: -1, stats: null },
  pendingLoad: null, hoverRowIdx: -1, hoverRowCache: {}, hoverTimer: null,
  zoomAnim: null, zoomAnimFrame: null,
  navDrag: false, navDragStartX: 0, navDragStartSI: 0,
  loadGen: 0
};

// ================================================================
// 3. Data Source Adapter
// ================================================================
var dataSource = null;

function createIPCDataSource() {
  return {
    isEmbedded: false,
    loadInitial: function(tabIdx, visCols) {
      return window.logAnalysis.getChartData(tabIdx, visCols);
    },
    loadSeries: function(tabIdx, colIdx, maxPts, from, to) {
      return window.logAnalysis.getChartSeries(tabIdx, colIdx, maxPts, from, to);
    },
    loadTooltip: function(tabIdx, rowIdx) {
      return window.logAnalysis.getChartTooltip(tabIdx, rowIdx, -1, -1);
    },
    hasNavigatorData: function() { return false; },
    getTooltipExtra: function() { return []; }
  };
}

function createEmbeddedDataSource() {
  return {
    isEmbedded: true,
    loadInitial: null,
    loadSeries: null,
    loadTooltip: null,
    hasNavigatorData: function() { return true; },
    getTooltipExtra: function(di) {
      var tips = [];
      if (S.tooltipAT >= 0 && chartTimeData && di < chartTimeData.length) {
        var atv = chartTimeData[di];
        if (atv !== undefined && atv !== '' && atv !== null) tips.push('时间: ' + atv);
      }
      if (S.tooltipSF >= 0 && chartFileData && di < chartFileData.length) {
        var sfv = chartFileData[di];
        if (sfv !== undefined && sfv !== '' && sfv !== null) tips.push('文件: ' + sfv);
      }
      return tips;
    }
  };
}

// ================================================================
// 4. Metrics Helper
// ================================================================
function getMetrics() {
  var dpr = window.devicePixelRatio || 1;
  var W = chartCanvas.width / dpr, H = chartCanvas.height / dpr;
  return { P: PAD, W: W, H: H, cw: W - PAD.l - PAD.r, ch: H - PAD.t - PAD.b, dpr: dpr };
}

// ================================================================
// 5. Viewport
// ================================================================
function getViewport() {
  var m = getMetrics();
  var total = totalRows;
  var vp = Math.min(total, Math.ceil(total / S.zoom));
  var si = Math.max(0, Math.min(total - vp, Math.floor(S.offX / m.cw * total / S.zoom)));
  return { si: si, vp: vp, cw: m.cw, total: total };
}

// ================================================================
// 6. Downsampling
// ================================================================

// Min-max downsampling for dense data arrays
function minMaxDownsample(data, startIdx, visibleCount, maxPoints) {
  if (visibleCount <= maxPoints) return null;
  var result = [], bucketSize = visibleCount / maxPoints;
  for (var bucket = 0; bucket < maxPoints; bucket++) {
    var from = startIdx + Math.floor(bucket * bucketSize);
    var to = startIdx + Math.min(Math.ceil((bucket + 1) * bucketSize), startIdx);
    var minVal = Infinity, maxVal = -Infinity, minIdx = from, maxIdx = from, has = false;
    for (var j = from; j < to; j++) {
      var d = data[j];
      if (d === undefined || d === null) continue;
      has = true;
      if (d < minVal) { minVal = d; minIdx = j; }
      if (d > maxVal) { maxVal = d; maxIdx = j; }
    }
    if (!has) continue;
    if (minIdx <= maxIdx) {
      result.push({ i: minIdx, v: minVal });
      if (minVal !== maxVal) result.push({ i: maxIdx, v: maxVal });
    } else {
      result.push({ i: maxIdx, v: maxVal });
      if (minVal !== maxVal) result.push({ i: minIdx, v: minVal });
    }
  }
  return result;
}

// Downsample sparse points [{i,v}] for visible range
function downsamplePoints(pts, startIdx, visibleCount, maxPoints) {
  if (pts.length <= maxPoints * 2) return pts;
  var result = [], bucketSize = visibleCount / maxPoints;
  for (var bucket = 0; bucket < maxPoints; bucket++) {
    var from = startIdx + Math.floor(bucket * bucketSize);
    var to = startIdx + Math.min(Math.ceil((bucket + 1) * bucketSize), startIdx);
    var minVal = Infinity, maxVal = -Infinity, minIdx = -1, maxIdx = -1;
    for (var pi = 0; pi < pts.length; pi++) {
      var pt = pts[pi];
      if (pt.i < from || pt.i >= to) continue;
      if (pt.v < minVal) { minVal = pt.v; minIdx = pt.i; }
      if (pt.v > maxVal) { maxVal = pt.v; maxIdx = pt.i; }
    }
    if (minIdx < 0) continue;
    if (minIdx <= maxIdx) {
      result.push({ i: minIdx, v: minVal });
      if (minVal !== maxVal) result.push({ i: maxIdx, v: maxVal });
    } else {
      result.push({ i: maxIdx, v: maxVal });
      if (minVal !== maxVal) result.push({ i: minIdx, v: minVal });
    }
  }
  return result;
}

// Per-config cached draw pts
function getCachedDrawPts(cfg, si, vp, pixelW) {
  if (cfg.points) {
    var c = cfg._ptsCache;
    if (c && c.si === si && c.vp === vp) return c.pts;
    var visPts = [];
    for (var k = 0; k < cfg.points.length; k++) {
      var pt = cfg.points[k];
      if (pt.i >= si && pt.i < si + vp) visPts.push(pt);
    }
    var pts = visPts.length > pixelW ? downsamplePoints(visPts, si, vp, pixelW) : visPts;
    cfg._ptsCache = { si: si, vp: vp, pts: pts };
    return pts;
  }
  return minMaxDownsample(cfg.data, si, vp, pixelW);
}

// ================================================================
// 7. Value & Range Helpers
// ================================================================
function fmtChartTime(s) {
  if (!s) return '';
  var m = s.match(/\d{4}-(\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  return m ? m[1] : s;
}

function computeVisibleYRange(cfg, si, vp) {
  var minVal = Infinity, maxVal = -Infinity, has = false;
  if (cfg.points) {
    for (var k = 0; k < cfg.points.length; k++) {
      var pt = cfg.points[k];
      if (pt.i >= si && pt.i < si + vp) {
        if (pt.v < minVal) minVal = pt.v;
        if (pt.v > maxVal) maxVal = pt.v;
        has = true;
      }
    }
  } else if (cfg.data && cfg.data.length !== undefined) {
    for (var i = si; i < si + vp && i < cfg.data.length; i++) {
      var v = cfg.data[i];
      if (v !== undefined && v !== null && !isNaN(v)) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
        has = true;
      }
    }
  }
  if (!has) return null;
  var pad = (maxVal - minVal) * 0.05 || Math.max(Math.abs(maxVal) * 0.05, 1);
  return { min: minVal - pad, max: maxVal + pad };
}

function getChartValue(cfg, di) {
  if (!cfg.data) return undefined;
  return cfg.data[di];
}

function collectRangeValues(cfg, from, to, cb) {
  if (cfg.points) {
    for (var k = 0; k < cfg.points.length; k++) {
      var pt = cfg.points[k];
      if (pt.i >= from && pt.i <= to) cb(pt.v);
    }
  } else if (cfg.data) {
    for (var i = from; i <= to && i < cfg.data.length; i++) {
      var v = cfg.data[i];
      if (v !== undefined && v !== null && !isNaN(v)) cb(v);
    }
  }
}

// ================================================================
// 8. Public Entry Point
// ================================================================
window.showChart = function() {
  var loc = tabLocal[activeTab];
  if (!loc || !loc.loaded) return;
  var t = TABS[activeTab];
  var visCols = loc.visibleCols;
  var headerLabels = visCols ? visCols.map(function(c) { return t.headers[c]; }) : t.headers;

  resetState();
  chartOverlay.style.display = 'flex';
  chartPanel.innerHTML = '<div style="padding:20px;color:#999">加载图表数据...</div>';

  if (DA.isEmbedded) {
    dataSource = createEmbeddedDataSource();
    showChartLocal(loc, headerLabels, visCols);
  } else {
    dataSource = createIPCDataSource();
    dataSource.loadInitial(activeTab, visCols).then(function(res) {
      if (!res || !res.success) { chartOverlay.style.display = 'none'; alert('图表数据加载失败'); return; }
      showChartFromMeta(res, headerLabels);
    }).catch(function(err) {
      chartOverlay.style.display = 'none'; alert('图表数据加载失败: ' + err.message);
    });
  }
};

// ================================================================
// 9. Chart Lifecycle
// ================================================================
function resetState() {
  S.zoom = Math.max(1, totalRows / DEFAULT_VISIBLE);
  S.offX = 0;
  S.mouse = { x: -1, y: -1 };
  S.isPanning = false;
  cancelTimers();
  S.hoverRowIdx = -1;
  S.hoverRowCache = {};
}

function cancelTimers() {
  if (S.pendingLoad) { clearTimeout(S.pendingLoad); S.pendingLoad = null; }
  if (S.hoverTimer) { clearTimeout(S.hoverTimer); S.hoverTimer = null; }
  if (S.zoomAnim) {
    S.zoomAnim = null;
    if (S.zoomAnimFrame) { cancelAnimationFrame(S.zoomAnimFrame); S.zoomAnimFrame = null; }
  }
}

function showChartLocal(loc, headerLabels, visCols) {
  var rows = loc.rows;
  var colKeys = visCols || null;
  chartConfigs = [];
  for (var ci = 0; ci < headerLabels.length; ci++) {
    if (SKIP_LABELS[headerLabels[ci]]) continue;
    var vals = [];
    for (var ri = 0; ri < totalRows; ri++) {
      var rd = rows[ri]; if (!rd) continue;
      var v = colKeys ? rd[colKeys[ci]] : rd[ci];
      var n = Number(v);
      if (!isNaN(n) && v !== '' && v !== null) vals.push(n);
    }
    if (vals.length < 2) continue;
    vals.sort(function(a, b) { return a - b; });
    var dataArr = [];
    for (var ri2 = 0; ri2 < totalRows; ri2++) {
      var rd2 = rows[ri2];
      if (!rd2) { dataArr.push(null); continue; }
      var v2 = colKeys ? rd2[colKeys[ci]] : rd2[ci];
      var n2 = Number(v2); dataArr.push(isNaN(n2) ? null : n2);
    }
    chartConfigs.push({
      ci: ci, name: headerLabels[ci], visible: false,
      color: CHART_COLORS[chartConfigs.length % CHART_COLORS.length],
      data: dataArr, points: null,
      min: vals[0], max: vals[vals.length - 1],
      loading: false, _ptsCache: null
    });
  }
  if (chartConfigs.length === 0) { chartOverlay.style.display = 'none'; alert('未检测到可绘图的数值列'); return; }
  S.tooltipAT = -1; S.tooltipSF = -1; S.colKeys = colKeys; S.rows = rows;
  chartTimeData = null; chartFileData = null;
  for (var ci2 = 0; ci2 < headerLabels.length; ci2++) {
    if (headerLabels[ci2] === 'Android时间') S.tooltipAT = ci2;
    if (headerLabels[ci2] === '源文件') S.tooltipSF = ci2;
  }
  finishChartSetup();
}

function showChartFromMeta(res, headerLabels) {
  chartConfigs = res.configs;
  S.tooltipAT = res.tooltipAT;
  S.tooltipSF = res.tooltipSF;
  S.colKeys = null; S.rows = null;
  chartTimeData = null; chartFileData = null;
  for (var i = 0; i < chartConfigs.length; i++) {
    chartConfigs[i].data = null;
    chartConfigs[i].points = null;
    chartConfigs[i].loading = false;
    chartConfigs[i]._ptsCache = null;
  }
  if (chartConfigs.length === 0) { chartOverlay.style.display = 'none'; alert('未检测到可绘图的数值列'); return; }
  finishChartSetup();
}

function finishChartSetup() {
  var ph = '<div class="chart-p-section">曲线选择</div>';
  for (var i = 0; i < chartConfigs.length; i++) {
    var c = chartConfigs[i];
    ph += '<div class="chart-p-item"><input type="checkbox" data-ci="' + i + '">'
      + '<input type="color" class="chart-color-pick" data-ci="' + i + '" value="' + c.color + '">'
      + '<span class="chart-p-name">' + esc(c.name) + '</span>'
      + '<span class="chart-p-val" id="chartVal_' + i + '">-</span></div>';
  }
  chartPanel.innerHTML = ph;

  chartPanel.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
    cb.addEventListener('change', function(e) {
      var ci = parseInt(e.target.dataset.ci);
      var cfg = chartConfigs[ci];
      cfg.visible = e.target.checked;
      if (cfg.visible) {
        if (dataSource.isEmbedded || cfg.data || cfg.points) drawChart();
        else loadVisibleRange([ci]);
      } else {
        drawChart();
      }
    });
    cb.addEventListener('click', function(e) { e.stopPropagation(); });
  });
  chartPanel.querySelectorAll('.chart-color-pick').forEach(function(cp) {
    cp.addEventListener('input', function(e) {
      var ci = parseInt(e.target.dataset.ci);
      chartConfigs[ci].color = e.target.value;
      drawChart();
    });
  });

  registerHandlers();
  if (!S.resizeObs) setupChartResize();
  resizeChartCanvas();
}

function loadVisibleRange(colsToLoad) {
  if (!dataSource.loadSeries) return;
  var m = getMetrics();
  if (m.cw <= 0) return;
  var total = totalRows;
  var vp = Math.min(total, Math.ceil(total / S.zoom));
  var si = Math.max(0, Math.min(total - vp, Math.floor(S.offX / m.cw * total / S.zoom)));
  var margin = Math.floor(vp * 0.5);
  var loadFrom = Math.max(0, si - margin);
  var loadTo = Math.min(total - 1, si + vp - 1 + margin);
  if (!colsToLoad) {
    colsToLoad = [];
    for (var i = 0; i < chartConfigs.length; i++) {
      if (chartConfigs[i].visible && !chartConfigs[i].loading) colsToLoad.push(i);
    }
  }
  var gen = ++S.loadGen;
  for (var j = 0; j < colsToLoad.length; j++) {
    var ci = colsToLoad[j];
    var cfg = chartConfigs[ci];
    if (cfg.loading) continue;
    if (cfg.points && cfg.points.length > 0) {
      var fp = cfg.points[0].i, lp = cfg.points[cfg.points.length - 1].i;
      if (si >= fp && si + vp - 1 <= lp) continue;
    }
    cfg.loading = true;
    var valEl = document.getElementById('chartVal_' + ci);
    if (valEl) valEl.textContent = '...';
    (function(ci, cfg, lf, lt, gen) {
      dataSource.loadSeries(activeTab, cfg.ci, MAX_POINTS, lf, lt).then(function(res) {
        if (gen !== S.loadGen) return;
        if (!res || !res.success) { cfg.loading = false; return; }
        var data = {}, points = [];
        for (var k = 0; k < res.points.length; k++) {
          var origI = res.points[k].i, v = res.points[k].v;
          data[origI] = v; points.push({ i: origI, v: v });
        }
        cfg.data = data; cfg.points = points; cfg.loading = false; cfg._ptsCache = null;
        drawChart();
      }).catch(function() { if (gen === S.loadGen) cfg.loading = false; });
    })(ci, cfg, loadFrom, loadTo, gen);
  }
}

function scheduleVisibleLoad() {
  if (S.pendingLoad) return;
  S.pendingLoad = setTimeout(function() { S.pendingLoad = null; loadVisibleRange(); }, 200);
}

function fetchHoverRow(di) {
  if (di === S.hoverRowIdx) return;
  S.hoverRowIdx = di; S.hoverRowCache = {};
  if (S.hoverTimer) clearTimeout(S.hoverTimer);
  if (!dataSource.loadTooltip) return;
  S.hoverTimer = setTimeout(function() {
    S.hoverTimer = null;
    var gen = S.loadGen;
    dataSource.loadTooltip(activeTab, di).then(function(res) {
      if (gen !== S.loadGen) return;
      if (!res || !res.success) return;
      S.hoverRowCache = res.values || {};
      for (var vi = 0; vi < chartConfigs.length; vi++) {
        var vel = document.getElementById('chartVal_' + vi);
        if (!vel) continue;
        var cfg = chartConfigs[vi];
        var v = cfg.data ? getChartValue(cfg, di) : undefined;
        if (v !== undefined && v !== null) vel.textContent = fmtN(v);
        else if (S.hoverRowCache[cfg.ci] !== undefined) vel.textContent = fmtN(S.hoverRowCache[cfg.ci]);
        else vel.textContent = '-';
      }
    });
  }, 50);
}

function resetPanelVals() {
  S.hoverRowIdx = -1; S.hoverRowCache = {};
  for (var vi = 0; vi < chartConfigs.length; vi++) {
    var vel = document.getElementById('chartVal_' + vi);
    if (vel) vel.textContent = '-';
  }
}

// ================================================================
// 10. Canvas Resize
// ================================================================
function resizeChartCanvas() {
  var wrap = chartCanvas.parentElement;
  var dpr = window.devicePixelRatio || 1;
  var cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (cw === 0 || ch === 0) return;
  chartCanvas.width = cw * dpr; chartCanvas.height = ch * dpr;
  chartCanvas.style.width = cw + 'px'; chartCanvas.style.height = ch + 'px';
  chartCanvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChart();
}

function setupChartResize() {
  S.resizeObs = new ResizeObserver(function() {
    if (chartOverlay.style.display === 'flex') resizeChartCanvas();
  });
  S.resizeObs.observe(chartCanvas.parentElement);
}

// ================================================================
// 11. Zoom & Pan Animation
// ================================================================
function animateZoom(fromZ, toZ, fromOff, toOff) {
  if (S.zoomAnim) { fromZ = S.zoom; fromOff = S.offX; }
  S.zoomAnim = { fromZ: fromZ, toZ: toZ, fromOff: fromOff, toOff: toOff, start: performance.now(), dur: 100 };
  if (!S.zoomAnimFrame) S.zoomAnimFrame = requestAnimationFrame(tickZoomAnim);
}

function tickZoomAnim(now) {
  S.zoomAnimFrame = null;
  if (!S.zoomAnim) return;
  var t = Math.min(1, (now - S.zoomAnim.start) / S.zoomAnim.dur);
  var ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  S.zoom = S.zoomAnim.fromZ + (S.zoomAnim.toZ - S.zoomAnim.fromZ) * ease;
  S.offX = S.zoomAnim.fromOff + (S.zoomAnim.toOff - S.zoomAnim.fromOff) * ease;
  drawChart();
  if (t < 1) S.zoomAnimFrame = requestAnimationFrame(tickZoomAnim);
  else { S.zoomAnim = null; scheduleVisibleLoad(); }
}

function animateZoomTo(targetZoom) {
  var m = getMetrics(), total = totalRows;
  var minZ = Math.max(1, total / MAX_VISIBLE), maxZ = Math.max(minZ + 1, total / 50);
  targetZoom = Math.max(minZ, Math.min(maxZ, targetZoom));
  var oldVP = Math.min(total, Math.ceil(total / S.zoom));
  var si = Math.max(0, Math.min(total - oldVP, Math.floor(S.offX / m.cw * total / S.zoom)));
  var center = si + oldVP / 2;
  var newVP = Math.min(total, Math.ceil(total / targetZoom));
  var newSI = Math.max(0, Math.min(total - newVP, center - newVP / 2));
  animateZoom(S.zoom, targetZoom, S.offX, newSI * m.cw / total * targetZoom);
}

// ================================================================
// 12. Event Handlers
// ================================================================
var _handlers = null;

function onWheel(e) {
  e.preventDefault();
  var m = getMetrics();
  var mx = e.clientX - m.P.l - chartCanvas.getBoundingClientRect().left + m.P.l;
  // Recompute mx from clientX relative to canvas
  var rect = chartCanvas.getBoundingClientRect();
  mx = e.clientX - rect.left;
  var total = totalRows;
  var minZ = Math.max(1, total / MAX_VISIBLE), maxZ = Math.max(minZ + 1, total / 50);
  var d = e.deltaY > 0 ? 0.8 : 1.25;
  var targetZ = Math.max(minZ, Math.min(maxZ, S.zoom * d));
  var ratio = Math.max(0, Math.min(1, (mx - PAD.l) / m.cw));
  var oldVP = Math.min(total, Math.ceil(total / S.zoom));
  var newVP = Math.min(total, Math.ceil(total / targetZ));
  var oldSI = Math.max(0, Math.min(total - oldVP, Math.floor(S.offX / m.cw * total / S.zoom)));
  var mouseDI = oldSI + ratio * oldVP;
  var newSI = mouseDI - ratio * newVP;
  var maxOff = Math.max(0, (total - newVP) * m.cw / total * targetZ);
  var targetOff = Math.max(0, Math.min(maxOff, newSI * m.cw / total * targetZ));
  animateZoom(S.zoom, targetZ, S.offX, targetOff);
}

function onCanvasMouseDown(e) {
  if (e.button !== 0) return;

  // Shift+click = range selection
  if (e.shiftKey) {
    startRangeSelect(e);
    return;
  }

  var m = getMetrics();
  var rect = chartCanvas.getBoundingClientRect();
  var mx = e.clientX - rect.left, my = e.clientY - rect.top;

  // Check navigator area
  var navTop = rect.height - NAV_H, navBot = rect.height;
  if (my >= navTop && my <= navBot && mx >= PAD.l && mx <= rect.width - PAD.r) {
    S.navDrag = true; S.navDragStartX = mx; S.navDragStartSI = getViewport().si;
    chartCanvas.style.cursor = 'ew-resize'; e.preventDefault(); return;
  }

  if (mx < PAD.l || mx > rect.width - PAD.r || my < PAD.t || my > PAD.t + m.ch) return;
  if (S.zoomAnim) { S.zoomAnim = null; if (S.zoomAnimFrame) { cancelAnimationFrame(S.zoomAnimFrame); S.zoomAnimFrame = null; } }
  var total = totalRows, vp = Math.min(total, Math.ceil(total / S.zoom));
  S.panMaxOffX = Math.max(0, (total - vp) * m.cw / total * S.zoom);
  S.isPanning = true; S.panStartX = e.clientX; S.panStartOffX = S.offX;
  chartCanvas.style.cursor = 'grabbing';
}

function startRangeSelect(e) {
  var m = getMetrics();
  var rect = chartCanvas.getBoundingClientRect();
  var cw = m.cw, ch = m.ch;
  var mx = e.clientX - rect.left, my = e.clientY - rect.top;
  if (mx < PAD.l || mx > rect.width - PAD.r || my < PAD.t || my > PAD.t + ch) return;
  S.sel = { active: true, startX: mx, endX: mx, startDi: -1, endDi: -1, stats: null };
  var total = totalRows, vp = Math.min(total, Math.ceil(total / S.zoom));
  var si = Math.max(0, Math.min(total - vp, Math.floor(S.offX / cw * total / S.zoom)));
  S.sel.startDi = Math.round(((mx - PAD.l) / cw) * vp) + si; S.sel.endDi = S.sel.startDi;
  e.preventDefault(); e.stopPropagation();
}

function onMouseMove(e) {
  // Navigator drag
  if (S.navDrag) {
    var m = getMetrics(), total = totalRows;
    var rect = chartCanvas.getBoundingClientRect();
    var dx = e.clientX - rect.left - PAD.l - S.navDragStartX + PAD.l;
    var rowPerPx = total / m.cw;
    var newSI = S.navDragStartSI + dx * rowPerPx;
    var vp = Math.min(total, Math.ceil(total / S.zoom));
    newSI = Math.max(0, Math.min(total - vp, newSI));
    S.offX = newSI * m.cw / total * S.zoom;
    drawChart(); return;
  }
  // Pan drag
  if (S.isPanning) {
    S.offX = Math.max(0, Math.min(S.panMaxOffX, S.panStartOffX - (e.clientX - S.panStartX)));
    drawChart(); scheduleVisibleLoad(); return;
  }
  // Range selection drag
  if (S.sel.active) {
    var m2 = getMetrics();
    var rect2 = chartCanvas.getBoundingClientRect();
    var mx = Math.max(PAD.l, Math.min(rect2.width - PAD.r, e.clientX - rect2.left));
    S.sel.endX = mx;
    var total = totalRows;
    var vp = Math.min(total, Math.ceil(total / S.zoom));
    var si = Math.max(0, Math.min(total - vp, Math.floor(S.offX / m2.cw * total / S.zoom)));
    S.sel.endDi = Math.round(((mx - PAD.l) / m2.cw) * vp) + si;
    drawChart();
  }
}

function onMouseUp() {
  if (S.navDrag) {
    S.navDrag = false; chartCanvas.style.cursor = 'crosshair'; scheduleVisibleLoad(); return;
  }
  if (S.isPanning) {
    S.isPanning = false; chartCanvas.style.cursor = 'crosshair'; scheduleVisibleLoad(); return;
  }
  if (S.sel.active) {
    finishRangeSelect();
  }
}

function finishRangeSelect() {
  S.sel.active = false;
  var from = Math.min(S.sel.startDi, S.sel.endDi), to = Math.max(S.sel.startDi, S.sel.endDi);
  if (to - from < 1) { S.sel.stats = null; drawChart(); return; }
  var visible = chartConfigs.filter(function(c) { return c.visible && c.data; });
  var cols = [];
  visible.forEach(function(cfg) {
    var vals = []; collectRangeValues(cfg, from, to, function(v) { vals.push(v); });
    if (vals.length < 2) return;
    vals.sort(function(a, b) { return a - b; });
    var sum = 0; for (var k = 0; k < vals.length; k++) sum += vals[k];
    var avg = sum / vals.length;
    var ss = 0; for (var k2 = 0; k2 < vals.length; k2++) ss += (vals[k2] - avg) * (vals[k2] - avg);
    var allVals = []; collectRangeValues(cfg, from, to, function(v) { allVals.push(v); });
    cols.push({
      name: cfg.name, color: cfg.color, min: vals[0], max: vals[vals.length - 1],
      avg: avg, stdDev: Math.sqrt(ss / vals.length),
      delta: allVals.length >= 2 ? allVals[allVals.length - 1] - allVals[0] : '-',
      start: allVals[0] || '-', end: allVals.length ? allVals[allVals.length - 1] : '-',
      count: vals.length
    });
  });
  S.sel.stats = { from: from, to: to, cols: cols }; drawChart();
}

function onDblClick(e) {
  var rect = chartCanvas.getBoundingClientRect();
  var mx = e.clientX - rect.left;
  if (mx < PAD.l) { drawChart(); return; }
  animateZoom(S.zoom, Math.max(1, totalRows / DEFAULT_VISIBLE), S.offX, 0);
}

function onHoverMove(e) {
  if (S.isPanning || S.navDrag) return;
  var rect = chartCanvas.getBoundingClientRect();
  S.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  if (!S.raf) S.raf = requestAnimationFrame(function() { S.raf = 0; drawChart(); });
}

function onMouseLeave() {
  S.mouse = { x: -1, y: -1 }; drawChart();
}

function onKeyDown(e) {
  if (chartOverlay.style.display !== 'flex') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  var vp = getViewport(), step = Math.max(1, Math.floor(vp.vp * 0.1));
  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      var ns = Math.max(0, vp.si - step); S.offX = ns * vp.cw / vp.total * S.zoom;
      drawChart(); scheduleVisibleLoad(); break;
    case 'ArrowRight':
      e.preventDefault();
      var ns2 = Math.min(vp.total - vp.vp, vp.si + step); S.offX = ns2 * vp.cw / vp.total * S.zoom;
      drawChart(); scheduleVisibleLoad(); break;
    case '+': case '=':
      e.preventDefault(); animateZoomTo(S.zoom * 1.3); break;
    case '-': case '_':
      e.preventDefault(); animateZoomTo(S.zoom / 1.3); break;
    case 'Home':
      e.preventDefault(); S.offX = 0; drawChart(); scheduleVisibleLoad(); break;
    case 'End':
      e.preventDefault();
      var mx2 = Math.max(0, (vp.total - vp.vp) * vp.cw / vp.total * S.zoom);
      S.offX = mx2; drawChart(); scheduleVisibleLoad(); break;
    case 'Escape':
      chartOverlay.style.display = 'none'; break;
  }
}

function registerHandlers() {
  if (_handlers) return;
  _handlers = {
    wheel: onWheel, canvasDown: onCanvasMouseDown,
    mouseMove: onMouseMove, mouseUp: onMouseUp,
    dblClick: onDblClick, hoverMove: onHoverMove,
    mouseLeave: onMouseLeave, keyDown: onKeyDown
  };
  chartCanvas.addEventListener('wheel', _handlers.wheel, { passive: false });
  chartCanvas.addEventListener('mousedown', _handlers.canvasDown);
  chartCanvas.addEventListener('dblclick', _handlers.dblClick);
  chartCanvas.addEventListener('mousemove', _handlers.hoverMove);
  chartCanvas.addEventListener('mouseleave', _handlers.mouseLeave);
  window.addEventListener('mousemove', _handlers.mouseMove);
  window.addEventListener('mouseup', _handlers.mouseUp);
  document.addEventListener('keydown', _handlers.keyDown);
}

function unregisterHandlers() {
  if (!_handlers) return;
  chartCanvas.removeEventListener('wheel', _handlers.wheel);
  chartCanvas.removeEventListener('mousedown', _handlers.canvasDown);
  chartCanvas.removeEventListener('dblclick', _handlers.dblClick);
  chartCanvas.removeEventListener('mousemove', _handlers.hoverMove);
  chartCanvas.removeEventListener('mouseleave', _handlers.mouseLeave);
  window.removeEventListener('mousemove', _handlers.mouseMove);
  window.removeEventListener('mouseup', _handlers.mouseUp);
  document.removeEventListener('keydown', _handlers.keyDown);
  _handlers = null;
}

// ================================================================
// 13. Render Pipeline
// ================================================================
function drawChart() {
  var m = getMetrics();
  if (m.cw <= 0 || m.ch <= 0) return;
  var ctx = chartCanvas.getContext('2d');
  ctx.save();

  ctx.clearRect(0, 0, m.W, m.H);
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, m.W, m.H);

  var visible = chartConfigs.filter(function(c) { return c.visible && c.data; });
  if (visible.length === 0) {
    ctx.fillStyle = '#999'; ctx.font = '14px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('请在右侧勾选要显示的列', m.W / 2, m.H / 2);
    ctx.restore(); return;
  }

  var total = totalRows;
  var vp = Math.min(total, Math.ceil(total / S.zoom));
  var si = Math.max(0, Math.min(total - vp, Math.floor(S.offX / m.cw * total / S.zoom)));

  // Y-axis auto-scale
  visible.forEach(function(cfg) {
    var yr = computeVisibleYRange(cfg, si, vp);
    if (yr) { cfg._vyMin = yr.min; cfg._vyMax = yr.max; }
    else { cfg._vyMin = cfg.min; cfg._vyMax = cfg.max; }
  });

  drawGrid(ctx, m);
  drawYAxes(ctx, m, visible);
  drawXAxis(ctx, m, vp, si, total);
  drawLines(ctx, m, visible, vp, si);
  drawThresholds(ctx, m, visible, vp, si);
  drawRangeSelection(ctx, m, visible, vp, si, total);
  drawHover(ctx, m, visible, vp, si, total);
  drawNavigator(ctx, m, visible, vp, si, total);

  ctx.restore();
}

function drawGrid(ctx, m) {
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  for (var i = 0; i <= 5; i++) {
    var y = m.P.t + (m.ch / 5) * i;
    ctx.beginPath(); ctx.moveTo(m.P.l, y); ctx.lineTo(m.W - m.P.r, y); ctx.stroke();
  }
  ctx.restore();
}

function drawYAxes(ctx, m, visible) {
  ctx.save();
  ctx.font = '11px Consolas,Arial'; ctx.textBaseline = 'middle';
  var drawn = 0;
  for (var vi = 0; vi < visible.length && drawn < 2; vi++) {
    var cfg = visible[vi], yMin = cfg._vyMin, yMax = cfg._vyMax, range = yMax - yMin;
    if (range === 0) continue;
    ctx.fillStyle = cfg.color;
    for (var i = 0; i <= 5; i++) {
      var v = yMax - (range / 5) * i, y = m.P.t + (m.ch / 5) * i;
      if (drawn === 0) { ctx.textAlign = 'right'; ctx.fillText(fmtN(v), m.P.l - 8, y); }
      else { ctx.textAlign = 'left'; ctx.fillText(fmtN(v), m.W - m.P.r + 8, y); }
    }
    drawn++;
  }
  ctx.restore();
}

function drawXAxis(ctx, m, vp, si, total) {
  ctx.save();
  ctx.fillStyle = '#666'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  var xs = Math.max(1, Math.floor(vp / 10));
  var useTime = S.tooltipAT >= 0 && chartTimeData;
  for (var i = 0; i < vp; i += xs) {
    var di = si + i; if (di >= total) break;
    var x = m.P.l + (m.cw / vp) * i;
    if (useTime) { var tv = chartTimeData[di]; ctx.fillText(fmtChartTime(tv) || String(di + 1), x, m.H - m.P.b + 8); }
    else ctx.fillText(String(di + 1), x, m.H - m.P.b + 8);
  }
  ctx.restore();
}

function drawLines(ctx, m, visible, vp, si) {
  ctx.save();
  var pixelW = Math.round(m.cw * m.dpr);
  visible.forEach(function(cfg) {
    var yMin = cfg._vyMin, yMax = cfg._vyMax, range = yMax - yMin;
    if (range === 0) return;
    ctx.beginPath(); ctx.strokeStyle = cfg.color; ctx.lineWidth = 1.5;
    var pts = getCachedDrawPts(cfg, si, vp, pixelW);
    var started = false;
    if (pts && pts.length) {
      for (var k = 0; k < pts.length; k++) {
        var pt = pts[k], x = m.P.l + ((pt.i - si) / vp) * m.cw, y = m.P.t + m.ch * (1 - (pt.v - yMin) / range);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
    } else if (cfg.data && !cfg.points) {
      for (var k2 = 0; k2 < vp; k2++) {
        var di = si + k2;
        if (di >= cfg.data.length || cfg.data[di] === undefined || cfg.data[di] === null) { started = false; continue; }
        var x2 = m.P.l + (m.cw / vp) * k2, y2 = m.P.t + m.ch * (1 - (cfg.data[di] - yMin) / range);
        if (!started) { ctx.moveTo(x2, y2); started = true; } else ctx.lineTo(x2, y2);
      }
    }
    ctx.stroke();
  });
  ctx.restore();
}

function drawNavigator(ctx, m, visible, vp, si, total) {
  ctx.save();
  var navTop = m.H - NAV_H, navH = NAV_H;
  var navL = m.P.l, navR = m.W - m.P.r, navW = navR - navL;
  if (navW <= 0) { ctx.restore(); return; }

  // Background — subtle fill
  ctx.fillStyle = 'rgba(0,0,0,0.025)';
  ctx.fillRect(navL, navTop, navW, navH);

  // Mini series (embedded only)
  if (dataSource.hasNavigatorData() && visible.length > 0) {
    visible.forEach(function(cfg) {
      var gMin = cfg.min, gMax = cfg.max, gRange = gMax - gMin;
      if (gRange === 0) return;
      ctx.beginPath(); ctx.strokeStyle = cfg.color; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
      var started = false;
      for (var x = 0; x < navW; x++) {
        var ri = Math.floor(x / navW * total);
        var v = cfg.data[ri];
        if (v === undefined || v === null || isNaN(v)) { started = false; continue; }
        var y = navTop + navH * (1 - (v - gMin) / gRange);
        if (!started) { ctx.moveTo(navL + x, y); started = true; } else ctx.lineTo(navL + x, y);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    });
  }

  // Viewport indicator — clean rounded bar
  var vpL = navL + (si / total) * navW;
  var vpR = navL + ((si + vp) / total) * navW;
  ctx.fillStyle = 'rgba(0,122,255,0.12)';
  ctx.fillRect(vpL, navTop, vpR - vpL, navH);
  // Thin top/bottom highlight lines on viewport
  ctx.fillStyle = 'rgba(0,122,255,0.35)';
  ctx.fillRect(vpL, navTop, vpR - vpL, 1.5);
  ctx.fillRect(vpL, navTop + navH - 1.5, vpR - vpL, 1.5);

  // Top separator line
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(navL, navTop, navW, 0.5);

  ctx.restore();
}

function drawHover(ctx, m, visible, vp, si, total) {
  if (S.mouse.x < m.P.l || S.mouse.x > m.W - m.P.r || S.mouse.y < m.P.t || S.mouse.y > m.P.t + m.ch) {
    resetPanelVals(); return;
  }
  ctx.save();
  var di = Math.round(((S.mouse.x - m.P.l) / m.cw) * vp) + si;
  if (di < 0 || di >= total) { resetPanelVals(); ctx.restore(); return; }

  var x = m.P.l + ((di - si) / vp) * m.cw;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(x, m.P.t); ctx.lineTo(x, m.P.t + m.ch); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(m.P.l, S.mouse.y); ctx.lineTo(m.W - m.P.r, S.mouse.y); ctx.stroke();

  // Y value at cursor position
  if (visible.length > 0) {
    var cfg0 = visible[0], yMin0 = cfg0._vyMin, yMax0 = cfg0._vyMax, range0 = yMax0 - yMin0;
    if (range0 > 0) {
      var yVal = yMax0 - (S.mouse.y - m.P.t) / m.ch * range0;
      ctx.setLineDash([]);
      ctx.font = '10px Consolas,Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(fmtN(yVal), m.P.l + 4, S.mouse.y - 3);
    }
  }

  // Tooltip content
  var tips = ['行 ' + (di + 1)];
  // Extra info from data source (time, file for embedded mode)
  var extra = dataSource.getTooltipExtra(di);
  for (var ei = 0; ei < extra.length; ei++) tips.push(extra[ei]);

  // Data points on curves
  visible.forEach(function(cfg) {
    var v = getChartValue(cfg, di); if (v === undefined) return;
    var yMin = cfg._vyMin, yMax = cfg._vyMax, range = yMax - yMin; if (range === 0) return;
    var y = m.P.t + m.ch * (1 - (v - yMin) / range);
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.fillStyle = cfg.color; ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    tips.push(cfg.name + ': ' + fmtN(v));
  });

  drawTooltipBox(ctx, m, tips, x);

  // Update panel values
  for (var vi = 0; vi < chartConfigs.length; vi++) {
    var vel = document.getElementById('chartVal_' + vi); if (!vel) continue;
    var cfg2 = chartConfigs[vi];
    var v2 = cfg2.data ? getChartValue(cfg2, di) : undefined;
    if (v2 !== undefined && v2 !== null) vel.textContent = fmtN(v2);
    else if (S.hoverRowCache[cfg2.ci] !== undefined) vel.textContent = fmtN(S.hoverRowCache[cfg2.ci]);
    else vel.textContent = '-';
  }
  if (dataSource.loadTooltip) fetchHoverRow(di);
  ctx.restore();
}

function drawTooltipBox(ctx, m, tips, mouseX) {
  var tw = 280, th = tips.length * 18 + 12;
  var tx = mouseX + 15, ty = S.mouse.y + 15;
  if (tx + tw > m.W) tx = mouseX - tw - 15;
  if (ty + th > m.H) ty = S.mouse.y - th - 15;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  if (ctx.roundRect) ctx.roundRect(tx, ty, tw, th, 4); else ctx.rect(tx, ty, tw, th);
  ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '12px Consolas,Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  tips.forEach(function(t, i) { ctx.fillText(t, tx + 8, ty + 6 + i * 18); });
}

function drawThresholds(ctx, m, visible, vp, si) {
  if (S.thresholds.length === 0) return;
  ctx.save();
  S.thresholds.forEach(function(t) {
    var cfg = chartConfigs[t.ci]; if (!cfg || !cfg.visible) return;
    var yMin = cfg._vyMin, yMax = cfg._vyMax, range = yMax - yMin; if (range === 0) return;
    var y = m.P.t + m.ch * (1 - (t.value - yMin) / range);
    if (y < m.P.t || y > m.P.t + m.ch) return;
    ctx.strokeStyle = t.color; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(m.P.l, y); ctx.lineTo(m.W - m.P.r, y); ctx.stroke();
    ctx.setLineDash([]);
    var label = t.name + ' = ' + fmtN(t.value);
    ctx.font = '11px Consolas,Arial'; var tw2 = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(m.P.l + 4, y - 9, tw2, 16);
    ctx.fillStyle = t.color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, m.P.l + 8, y);
  });
  ctx.restore();
}

function drawRangeSelection(ctx, m, visible, vp, si, total) {
  var from = Math.min(S.sel.startDi, S.sel.endDi), to = Math.max(S.sel.startDi, S.sel.endDi);
  ctx.save();
  if (S.sel.active) {
    var x1 = m.P.l + ((from - si) / vp) * m.cw, x2 = m.P.l + ((to - si) / vp) * m.cw;
    ctx.fillStyle = 'rgba(46,125,50,0.12)';
    ctx.fillRect(Math.max(m.P.l, x1), m.P.t, Math.min(m.W - m.P.r, x2) - Math.max(m.P.l, x1), m.ch);
    ctx.strokeStyle = 'rgba(46,125,50,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (x1 >= m.P.l && x1 <= m.W - m.P.r) { ctx.moveTo(x1, m.P.t); ctx.lineTo(x1, m.P.t + m.ch); }
    if (x2 >= m.P.l && x2 <= m.W - m.P.r) { ctx.moveTo(x2, m.P.t); ctx.lineTo(x2, m.P.t + m.ch); }
    ctx.stroke();
  }
  ctx.restore();
  if (S.sel.stats) {
    var s = S.sel.stats;
    var sx1 = m.P.l + ((s.from - si) / vp) * m.cw, sx2 = m.P.l + ((s.to - si) / vp) * m.cw;
    var midX = (Math.max(m.P.l, sx1) + Math.min(m.W - m.P.r, sx2)) / 2;
    renderRangeStats(s, midX, m.P.t);
  }
}

function renderRangeStats(stats, anchorX, top) {
  var el = document.getElementById('rangeStats');
  if (!el) return;
  if (!stats || !stats.cols || stats.cols.length === 0) { el.style.display = 'none'; return; }
  var html = '<div class="range-stats-title">区间统计 — 行 ' + (stats.from + 1) + ' ~ ' + (stats.to + 1) + ' (' + ((stats.to - stats.from + 1)) + '行)</div>';
  stats.cols.forEach(function(c) {
    html += '<div style="margin-top:8px;font-weight:600;color:' + c.color + '">' + esc(c.name) + '</div>';
    html += '<table><tr><th>样本</th><td>' + c.count + '</td><th>最小</th><td>' + fmtN(c.min) + '</td></tr>';
    html += '<tr><th>最大</th><td>' + fmtN(c.max) + '</td><th>均值</th><td>' + fmtN(c.avg) + '</td></tr>';
    html += '<tr><th>标准差</th><td>' + fmtN(c.stdDev) + '</td><th>变化量</th><td style="color:' + (c.delta > 0 ? '#c62828' : c.delta < 0 ? '#1565c0' : '#666') + '">' + fmtN(c.delta) + '</td></tr>';
    html += '<tr><th>起始</th><td>' + fmtN(c.start) + '</td><th>结束</th><td>' + fmtN(c.end) + '</td></tr></table>';
  });
  el.innerHTML = html; el.style.display = 'block';
  el.style.top = (top + 40) + 'px'; el.style.left = '50%'; el.style.transform = 'translateX(-50%)';
}

// ================================================================
// 14. Threshold UI
// ================================================================
function openThreshDialog() {
  var sel = document.getElementById('threshSeries'); sel.innerHTML = ''; var visCount = 0;
  chartConfigs.forEach(function(cfg, i) {
    if (cfg.visible) {
      var opt = document.createElement('option'); opt.value = i; opt.textContent = cfg.name;
      sel.appendChild(opt); visCount++;
    }
  });
  if (visCount === 0) { alert('请先勾选至少一条曲线'); return; }
  document.getElementById('threshValue').value = '';
  renderThreshList();
  document.getElementById('threshOverlay').style.display = 'flex';
}

function renderThreshList() {
  var list = document.getElementById('threshList');
  if (S.thresholds.length === 0) {
    list.innerHTML = '<div class="thresh-empty">暂无阈值线，请在上方选择曲线和数值后添加</div>'; return;
  }
  var html = '';
  S.thresholds.forEach(function(t, i) {
    html += '<div class="thresh-item"><span class="thresh-item-color" style="background:' + t.color + '"></span>'
      + '<span class="thresh-item-name">' + esc(t.name) + '</span>'
      + '<span class="thresh-item-val">= ' + t.value + '</span>'
      + '<span class="thresh-item-del" data-idx="' + i + '">&times;</span></div>';
  });
  list.innerHTML = html;
  list.querySelectorAll('.thresh-item-del').forEach(function(el) {
    el.addEventListener('click', function() {
      S.thresholds.splice(parseInt(el.dataset.idx), 1); renderThreshList(); drawChart();
    });
  });
}

// ================================================================
// 15. Static Handlers (registered once at IIFE load)
// ================================================================
document.getElementById('chartClose').addEventListener('click', function() {
  chartOverlay.style.display = 'none';
  S.sel = { active: false, startX: -1, endX: -1, startDi: -1, endDi: -1, stats: null };
  document.getElementById('rangeStats').style.display = 'none';
  unregisterHandlers();
});

document.getElementById('chartThreshBtn').addEventListener('click', openThreshDialog);

document.getElementById('threshClose').addEventListener('click', function() {
  document.getElementById('threshOverlay').style.display = 'none';
});

document.getElementById('threshOverlay').addEventListener('click', function(e) {
  if (e.target.id === 'threshOverlay') e.target.style.display = 'none';
});

document.getElementById('threshAddBtn').addEventListener('click', function() {
  var ci = parseInt(document.getElementById('threshSeries').value);
  var val = parseFloat(document.getElementById('threshValue').value);
  if (isNaN(ci) || !chartConfigs[ci]) { alert('请选择一条曲线'); return; }
  if (isNaN(val)) { alert('请输入有效的数值'); return; }
  S.thresholds.push({ ci: ci, name: chartConfigs[ci].name, value: val, color: chartConfigs[ci].color });
  document.getElementById('threshValue').value = ''; renderThreshList(); drawChart();
});

document.getElementById('chartExportBtn').addEventListener('click', function() {
  var m = getMetrics();
  var savedMouse = { x: S.mouse.x, y: S.mouse.y }; S.mouse = { x: -1, y: -1 }; drawChart();
  var ctx = chartCanvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.font = '11px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText('VivoLog', m.W - 8, m.H - 4);
  chartCanvas.toBlob(function(blob) {
    var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url;
    var t = TABS[activeTab]; a.download = (t ? t.name : 'chart') + '_' + Date.now() + '.png'; a.click();
    URL.revokeObjectURL(url); S.mouse = savedMouse; drawChart();
  }, 'image/png');
});

})();
