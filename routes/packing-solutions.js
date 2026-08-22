/**
 * routes/packing-solutions.js
 * 方案存檔 API（solutions 表）。
 *
 *   POST   /api/packing/projects/:id/solutions        — 儲存 GA-LNS 方案
 *   GET    /api/packing/projects/:id/solutions        — 列出已存方案
 *   GET    /api/packing/projects/:id/solutions/:sid   — 取得單一方案完整資料
 *   DELETE /api/packing/projects/:id/solutions/:sid   — 刪除方案
 */
const express = require('express');
const db = require('../db/database');

const router = express.Router();

/** 回應錯誤（統一格式） */
function fail(res, status, message) {
  res.status(status).json({ error: message });
}

/** 儲存 GA-LNS 方案 */
router.post('/projects/:id/solutions', (req, res) => {
  const projectId = Number(req.params.id);
  const { solution_data, utilization_rate, weight_utilization, cog_x, cog_y, cog_z } = req.body || {};
  if (!projectId) return fail(res, 400, '無效的專案 ID');
  if (!solution_data || typeof solution_data !== 'object') {
    return fail(res, 400, 'solution_data 為必填物件');
  }

  db.get('SELECT id FROM projects WHERE id = ?', [projectId], (err, project) => {
    if (err) return fail(res, 500, `查詢專案失敗：${err.message}`);
    if (!project) return fail(res, 404, '專案不存在');

    db.run(
      'INSERT INTO solutions (project_id, solution_data, utilization_rate, weight_utilization, cog_x, cog_y, cog_z) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [projectId, JSON.stringify(solution_data),
       utilization_rate !== undefined ? Number(utilization_rate) : null,
       weight_utilization !== undefined ? Number(weight_utilization) : null,
       cog_x !== undefined ? Number(cog_x) : null,
       cog_y !== undefined ? Number(cog_y) : null,
       cog_z !== undefined ? Number(cog_z) : null],
      function (err2) {
        if (err2) return fail(res, 500, `儲存方案失敗：${err2.message}`);
        res.status(201).json({ id: this.lastID });
      }
    );
  });
});

/** 列出專案已存方案 */
router.get('/projects/:id/solutions', (req, res) => {
  const projectId = Number(req.params.id);
  if (!projectId) return fail(res, 400, '無效的專案 ID');
  db.all(
    'SELECT id, project_id, utilization_rate, weight_utilization, cog_x, cog_y, cog_z, created_at FROM solutions WHERE project_id = ? ORDER BY id DESC',
    [projectId],
    (err, rows) => {
      if (err) return fail(res, 500, `查詢方案失敗：${err.message}`);
      res.json({ data: rows });
    }
  );
});

/** 取得單一方案完整資料 */
router.get('/projects/:id/solutions/:sid', (req, res) => {
  const projectId = Number(req.params.id);
  const sid = Number(req.params.sid);
  if (!projectId || !sid) return fail(res, 400, '無效的 ID');
  db.get('SELECT * FROM solutions WHERE id = ? AND project_id = ?', [sid, projectId], (err, row) => {
    if (err) return fail(res, 500, `查詢方案失敗：${err.message}`);
    if (!row) return fail(res, 404, '方案不存在');
    let data = null;
    if (row.solution_data) { try { data = JSON.parse(row.solution_data); } catch (e) { data = null; } }
    res.json({ data: { ...row, solution_data: data } });
  });
});

/** 刪除方案 */
router.delete('/projects/:id/solutions/:sid', (req, res) => {
  const projectId = Number(req.params.id);
  const sid = Number(req.params.sid);
  if (!projectId || !sid) return fail(res, 400, '無效的 ID');
  db.run('DELETE FROM solutions WHERE id = ? AND project_id = ?', [sid, projectId], function (err) {
    if (err) return fail(res, 500, `刪除方案失敗：${err.message}`);
    if (this.changes === 0) return fail(res, 404, '方案不存在');
    res.json({ ok: true });
  });
});

module.exports = router;