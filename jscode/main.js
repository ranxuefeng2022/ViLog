// main.js - Entry point (thin shim)
// ⚠️ V8 flags 必须在 Electron 初始化之前设置，放在所有 require 之前
const { app } = require('electron');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');

require('./src/main/index.js');
