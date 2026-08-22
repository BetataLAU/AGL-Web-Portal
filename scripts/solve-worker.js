/**
 * scripts/solve-worker.js
 * GA-LNS 求解 Worker：在獨立子行程執行 solveMultiUld，
 * 避免同步運算阻塞主伺服器 event loop。
 *
 * IPC 協定：
 *   主行程 → worker: { type: 'start', project, options }
 *   worker → 主行程: { type: 'progress', pct }
 *   worker → 主行程: { type: 'result', result }
 *   worker → 主行程: { type: 'error', message }
 *   主行程 → worker: { type: 'cancel' }
 */
'use strict';

const { solveMultiUld } = require('../bp3d/ga-lns');

let cancelled = false;

process.on('message', (msg) => {
  if (!msg) return;

  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (msg.type !== 'start') return;

  const { project, options } = msg;
  try {
    const result = solveMultiUld(
      project,
      options || {},
      (pct) => {
        try {
          process.send({ type: 'progress', pct });
        } catch (e) { /* ignore */ }
      },
      () => cancelled
    );
    process.send({ type: 'result', result });
  } catch (err) {
    process.send({ type: 'error', message: err.message });
  }
});