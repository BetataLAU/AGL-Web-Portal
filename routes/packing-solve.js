/**
 * routes/packing-solve.js
 * GA-LNS 非同步求解 API（透過 child_process 子行程，避免阻塞 event loop）。
 *
 *   POST  /api/packing/solve          — 開始求解（回傳 jobId）
 *   GET   /api/packing/solve/:jobId   — 查詢進度與結果
 *   POST  /api/packing/solve/:jobId/cancel — 取消
 *
 * Job 狀態切換：queued → running → completed | cancelled | failed
 */
const express = require('express');
const { fork } = require('child_process');
const path = require('path');
const db = require('../db/database');

const router = express.Router();

// ===== Job Store（記憶體；重啟後失效） =====
const jobs = new Map();
let nextJobId = 1;
const JOB_TTL_MS = 30 * 60 * 1000; // 30 分鐘後清理

/** 建立新 job */
function createJob(projectId) {
  const job = {
    id: nextJobId++,
    projectId,
    status: 'queued',
    progress: 0,
    startedAt: Date.now(),
    finishedAt: null,
    cancelled: false,
    result: null,
    error: null,
    worker: null, // child process 參考
  };
  jobs.set(job.id, job);
  return job;
}

/** 更新 job 進度 */
function updateProgress(job, pct) {
  job.progress = Math.min(100, Math.max(0, pct));
}

/** 清理過期 jobs（同時終止殘留 worker） */
function cleanupExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
    if (terminal && now - (job.finishedAt || now) > JOB_TTL_MS) {
      if (job.worker) {
        try { job.worker.kill(); } catch (e) { /* ignore */ }
      }
      jobs.delete(id);
    } else if (job.status === 'running' && now - job.startedAt > JOB_TTL_MS) {
      if (job.worker) {
        try { job.worker.kill(); } catch (e) { /* ignore */ }
      }
      job.status = 'failed';
      job.error = '求解逾時';
      job.finishedAt = now;
    }
  }
}

// ===== 取得專案資料 =====
function loadProject(projectId, callback) {
  db.get('SELECT * FROM projects WHERE id = ?', [projectId], (err, project) => {
    if (err) return callback(err);
    if (!project) return callback(new Error('專案不存在'));
    db.all('SELECT * FROM ulds WHERE project_id = ? ORDER BY seq', [projectId], (err2, ulds) => {
      if (err2) return callback(err2);
      db.all(
        `SELECT i.*, c.project_id FROM items i JOIN customers c ON i.customer_id = c.id
         WHERE c.project_id = ?`,
        [projectId],
        (err3, items) => {
          if (err3) return callback(err3);
          callback(null, { ...project, ulds: ulds || [], items: items || [] });
        }
      );
    });
  });
}

// ===== 啟動求解 worker =====
function startWorker(job, project, options) {
  const worker = fork(path.join(__dirname, '..', 'scripts', 'solve-worker.js'), [], {
    stdio: 'ignore',
    windowsHide: true,
  });
  job.worker = worker;

  worker.on('message', (msg) => {
    if (!msg) return;
    if (msg.type === 'progress') {
      updateProgress(job, msg.pct);
    } else if (msg.type === 'result') {
      job.result = msg.result;
      job.status = msg.result && msg.result.cancelled ? 'cancelled' : 'completed';
      job.finishedAt = Date.now();
      updateProgress(job, 100);
      try { worker.kill(); } catch (e) { /* ignore */ }
      job.worker = null;
    } else if (msg.type === 'error') {
      job.status = 'failed';
      job.error = msg.message;
      job.finishedAt = Date.now();
      try { worker.kill(); } catch (e) { /* ignore */ }
      job.worker = null;
    }
  });

  worker.on('error', (err) => {
    job.status = 'failed';
    job.error = `Worker 錯誤：${err.message}`;
    job.finishedAt = Date.now();
    job.worker = null;
  });

  worker.on('exit', (code) => {
    // 正常完成時已由 result 處理；此處處理異常退出
    if (!job.finishedAt) {
      if (job.cancelled) {
        job.status = 'cancelled';
        job.finishedAt = Date.now();
      } else if (code !== 0) {
        job.status = 'failed';
        job.error = `Worker 異常退出（code=${code}）`;
        job.finishedAt = Date.now();
      }
    }
    job.worker = null;
  });

  worker.send({ type: 'start', project, options });
}

// ===== 開始求解 =====
router.post('/solve', (req, res) => {
  cleanupExpiredJobs();
  const { project_id, options } = req.body || {};
  if (!project_id || !Number.isInteger(Number(project_id))) {
    return res.status(400).json({ error: 'project_id 為必填整數' });
  }

  loadProject(project_id, (err, project) => {
    if (err) return res.status(400).json({ error: err.message });

    if (!project.ulds || project.ulds.length === 0) {
      return res.status(400).json({ error: '專案沒有 ULD' });
    }
    if (!project.items || project.items.length === 0) {
      return res.status(400).json({ error: '專案沒有貨物' });
    }

    const job = createJob(project_id);
    job.status = 'running';
    updateProgress(job, 2);

    startWorker(job, project, options || {});

    res.status(202).json({ jobId: job.id, status: job.status });
  });
});

// ===== 查詢進度/結果 =====
router.get('/solve/:jobId', (req, res) => {
  const jobId = Number(req.params.jobId);
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job 不存在或已清理' });

  res.json({
    jobId: job.id,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    cancelled: job.cancelled,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
  });
});

// ===== 取消 =====
router.post('/solve/:jobId/cancel', (req, res) => {
  const jobId = Number(req.params.jobId);
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job 不存在' });

  if (job.status === 'running' || job.status === 'queued') {
    job.cancelled = true;
    if (job.worker) {
      // 先送取消訊息（讓 worker 有機會優雅結束），再強制終止
      try {
        job.worker.send({ type: 'cancel' });
      } catch (e) { /* ignore */ }
      try {
        // 直接 kill：確保取消即時生效（worker exit handler 會將 job 標記為 cancelled）
        job.worker.kill();
      } catch (e) { /* ignore */ }
      job.worker = null;
    }
    res.json({ ok: true, status: job.status, cancelled: job.cancelled });
  } else {
    res.json({ ok: true, status: job.status, cancelled: job.cancelled });
  }
});

module.exports = router;