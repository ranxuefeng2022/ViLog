'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = {};

api.getTabs = () => ipcRenderer.invoke('analysis-get-tabs');
api.getFullData = (tabIdx) => ipcRenderer.invoke('analysis-get-full-data', tabIdx);

api.minimize = () => ipcRenderer.send('analysis-window-minimize');
api.maximize = () => ipcRenderer.send('analysis-window-maximize');
api.close = () => ipcRenderer.send('analysis-window-close');

api.saveReport = () => ipcRenderer.invoke('save-analysis-report');

try {
  contextBridge.exposeInMainWorld('logAnalysis', api);
} catch (e) {
  console.error('Failed to expose logAnalysis:', e);
}
