'use strict';

const { workerData, parentPort } = require('worker_threads');
const { convertFileSync } = require('./android-time-converter');

try {
  const result = convertFileSync(workerData.filePath);
  parentPort.postMessage(result);
} catch (err) {
  parentPort.postMessage({ error: err.message });
}
