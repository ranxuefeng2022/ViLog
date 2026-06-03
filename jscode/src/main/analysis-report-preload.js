'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = {};

api.getTabs = () => ipcRenderer.invoke('analysis-get-tabs');
api.getFullData = (tabIdx) => ipcRenderer.invoke('analysis-get-full-data', tabIdx);
api.getRows = (tabIdx, from, count) => ipcRenderer.invoke('analysis-get-rows', tabIdx, from, count);
api.searchRows = (tabIdx, term) => ipcRenderer.invoke('analysis-search-rows', tabIdx, term);
api.getChartData = (tabIdx, visCols) => ipcRenderer.invoke('analysis-get-chart-meta', tabIdx, visCols);
api.getChartSeries = (tabIdx, colIdx, maxPoints, fromRow, toRow) => ipcRenderer.invoke('analysis-get-chart-series', tabIdx, colIdx, maxPoints, fromRow, toRow);
api.getChartTooltip = (tabIdx, rowIdx, timeCol, fileCol) => ipcRenderer.invoke('analysis-get-chart-tooltip', tabIdx, rowIdx, timeCol, fileCol);
api.getStatsMeta = (tabIdx, visCols) => ipcRenderer.invoke('analysis-stats-meta', tabIdx, visCols);
api.calcStats = (tabIdx, visCols, cols, from, to) => ipcRenderer.invoke('analysis-stats-calc', tabIdx, visCols, cols, from, to);
api.exportCSV = (tabIdx, visCols) => ipcRenderer.invoke('analysis-export-csv', tabIdx, visCols);

api.getNearbyRows = (tabIdx, timeValue, contextRows) => ipcRenderer.invoke('analysis-get-nearby-rows', tabIdx, timeValue, contextRows);
api.getTimeIndex = (tabIdx) => ipcRenderer.invoke('analysis-get-time-index', tabIdx);
api.getRow = (tabIdx, rowIdx) => ipcRenderer.invoke('analysis-get-row', tabIdx, rowIdx);
api.getRowsRange = (tabIdx, from, to) => ipcRenderer.invoke('analysis-get-rows-range', tabIdx, from, to);

api.minimize = () => ipcRenderer.send('analysis-window-minimize');
api.maximize = () => ipcRenderer.send('analysis-window-maximize');
api.close = () => ipcRenderer.send('analysis-window-close');

api.saveReport = () => ipcRenderer.invoke('save-analysis-report');
api.importDatabase = () => ipcRenderer.invoke('analysis-import-database');

try {
  contextBridge.exposeInMainWorld('logAnalysis', api);
} catch (e) {
  console.error('Failed to expose logAnalysis:', e);
}
