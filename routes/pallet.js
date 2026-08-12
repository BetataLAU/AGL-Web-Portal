// ===== 打板計劃 API（Admin / Staff 限定） =====
const express = require('express');
const db = require('../db/database');
const router = express.Router();

const PALETT_PLAN_NO_PREFIX = 'AGL-';

// ===== 共用工具 =====

// 寫入審計日誌
function writeAuditLog(req, action, targetType, targetId, detail) {
  const user = (req.session && req.session.user) || {};
  db.run(
    `INSERT INTO audit_log (actor_user_id, actor_display, action, target_type, target_id, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user.user_id || null, user.display_name || user.user_id || null, action, targetType, String(targetId || ''), detail || null],
    (err) => { if (err) console.error('[pallet] audit_log 寫入失敗:', err.message); }
  );
}

// 產生計劃編號 AGL-YYYYMMDD-XX
function generatePlanNo(callback) {
  const now = new Date();
  // 本地時間（Asia/Taipei）格式化，避免 UTC 偏移造成日期錯誤
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `${PALETT_PLAN_NO_PREFIX}${yyyy}${mm}${dd}-`;
  db.get(
    "SELECT plan_no FROM pallet_plans WHERE plan_no LIKE ? ORDER BY id DESC LIMIT 1",
    [`${prefix}%`],
    (err, row) => {
      if (err) return callback(err);
      let seq = 1;
      if (row) {
        const lastSeq = parseInt(row.plan_no.split('-').pop(), 10);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
      }
      callback(null, `${prefix}${String(seq).padStart(2, '0')}`);
    }
  );
}

// 將資料列轉為 API 回應格式
function serializeBooking(row) {
  let planRefs = null;
  if (row.plan_refs) {
    try { planRefs = JSON.parse(row.plan_refs); } catch (e) { planRefs = null; }
  }
  return {
    id: row.id,
    mawb: row.mawb,
    hawb: row.hawb,
    client: row.client,
    dest: row.dest,
    pcs: row.pcs,
    gross_weight: row.gross_weight,
    volume_weight: row.volume_weight,
    cbm: row.cbm,
    spl: row.spl,
    remark: row.remark,
    plan_refs: planRefs,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function serializePlan(row) {
  let totals = null;
  if (row.totals) {
    try { totals = JSON.parse(row.totals); } catch (e) { totals = null; }
  }
  return {
    id: row.id,
    plan_no: row.plan_no,
    company_name: row.company_name,
    fax: row.fax,
    plan_date: row.plan_date,
    flight_no: row.flight_no,
    flight_date: row.flight_date,
    arrival_airport: row.arrival_airport,
    contour_text: row.contour_text,
    contour_code: row.contour_code,
    max_gross_weight: row.max_gross_weight,
    handover_hours: row.handover_hours,
    planner: row.planner,
    remarks: row.remarks,
    status: row.status,
    totals,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// Booking 列表 SQL（含所屬 Plan 引用）
const BOOKING_SELECT_SQL = `
  SELECT b.*,
         strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at) AS created_at,
         strftime('%Y-%m-%dT%H:%M:%fZ', b.updated_at) AS updated_at,
         (SELECT json_group_array(json_object(
            'plan_id', p.id,
            'plan_no', p.plan_no,
            'status', p.status
          ))
          FROM pallet_plan_items pi
          JOIN pallet_plans p ON p.id = pi.plan_id
          WHERE pi.mawb_record_id = b.id) AS plan_refs
  FROM mawb_records b
`;

const PLAN_SELECT_SQL = `
  SELECT p.*,
         strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at) AS created_at,
         strftime('%Y-%m-%dT%H:%M:%fZ', p.updated_at) AS updated_at,
         (SELECT json_object(
            'pcs', COALESCE(SUM(b.pcs), 0),
            'gross_weight', COALESCE(SUM(b.gross_weight), 0),
            'volume_weight', COALESCE(SUM(b.volume_weight), 0),
            'cbm', COALESCE(SUM(b.cbm), 0)
          )
          FROM pallet_plan_items pi
          JOIN mawb_records b ON b.id = pi.mawb_record_id
          WHERE pi.plan_id = p.id) AS totals
  FROM pallet_plans p
`;

// 檢查 Plan 是否為草稿（可編輯）
function isEditablePlan(plan, res) {
  if (!plan) {
    res.status(404).json({ error: '打板計劃不存在' });
    return false;
  }
  if (plan.status === 'locked' || plan.status === 'completed' || plan.status === 'cancelled') {
    res.status(400).json({ error: `計劃已${plan.status === 'locked' ? '上鎖' : plan.status}，無法修改。請先解除鎖定/修改狀態。` });
    return false;
  }
  return true;
}

// ===== 狀態標籤 =====
const STATUS_LABEL = { draft: '草稿', locked: '已鎖定', completed: '已完成', cancelled: '已取消' };

// ===== Booking Record（左欄 MAWB） =====

// GET /api/pallet/bookings?search=&dest=&only_unassigned=1&exclude_plan_id=
router.get('/bookings', (req, res) => {
  const search = (req.query.search || '').trim();
  const dest = (req.query.dest || '').trim();
  const onlyUnassigned = req.query.only_unassigned === '1';
  const excludePlanId = req.query.exclude_plan_id ? parseInt(req.query.exclude_plan_id, 10) : null;
  const params = [];
  let sql = BOOKING_SELECT_SQL + ' WHERE 1=1';

  if (search) {
    sql += ' AND (b.mawb LIKE ? OR b.hawb LIKE ? OR b.client LIKE ? OR b.dest LIKE ? OR b.spl LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (dest) {
    sql += ' AND b.dest = ?';
    params.push(dest);
  }
  if (onlyUnassigned) {
    // 只顯示「不存在於任何 已上鎖/已完成 Plan」的 MAWB
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM pallet_plan_items pi
      JOIN pallet_plans p ON p.id = pi.plan_id
      WHERE pi.mawb_record_id = b.id AND p.status IN ('locked','completed')
    )`;
  }
  if (excludePlanId) {
    // 排除指定 Plan 內已有的 MAWB（拖曳加入時避免重複顯示）
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM pallet_plan_items pi2
      WHERE pi2.plan_id = ? AND pi2.mawb_record_id = b.id
    )`;
    params.push(excludePlanId);
  }

  sql += ' ORDER BY b.created_at DESC, b.id DESC LIMIT 500';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows.map(serializeBooking) });
  });
});

// POST /api/pallet/bookings
router.post('/bookings', (req, res) => {
  const { mawb, hawb, client, dest, pcs, gross_weight, volume_weight, cbm, spl, remark } = req.body;
  if (!mawb || !String(mawb).trim()) {
    return res.status(400).json({ error: 'MAWB# 必填' });
  }
  // 重複 MAWB 檢查
  const normalizedMawb = String(mawb).trim();
  db.get("SELECT id FROM mawb_records WHERE mawb = ?", [normalizedMawb], (err, existing) => {
    if (err) return res.status(500).json({ error: err.message });
    if (existing) {
      return res.status(400).json({ error: `MAWB# ${normalizedMawb} 已存在（Booking #${existing.id}）` });
    }
    const stmt = db.prepare(`
      INSERT INTO mawb_records (mawb, hawb, client, dest, pcs, gross_weight, volume_weight, cbm, spl, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      normalizedMawb,
      (hawb || '').trim(),
      (client || '').trim(),
      (dest || '').trim().toUpperCase(),
      parseInt(pcs, 10) || 0,
      parseFloat(gross_weight) || 0,
      parseFloat(volume_weight) || 0,
      parseFloat(cbm) || 0,
      (spl || '').trim(),
      (remark || '').trim(),
      function (insertErr) {
        if (insertErr) return res.status(500).json({ error: insertErr.message });
        const newId = this.lastID;
        writeAuditLog(req, 'pallet.booking.create', 'mawb_record', newId, `新增 Booking ${normalizedMawb}`);
        // 回傳完整記錄
        db.get(BOOKING_SELECT_SQL + ' WHERE b.id = ?', [newId], (getErr, row) => {
          if (getErr) return res.status(500).json({ error: getErr.message });
          res.json({ success: true, data: serializeBooking(row) });
        });
      }
    );
    stmt.finalize();
  });
});

// PUT /api/pallet/bookings/:id
router.put('/bookings/:id', (req, res) => {
  const { id } = req.params;
  const { mawb, hawb, client, dest, pcs, gross_weight, volume_weight, cbm, spl, remark } = req.body;
  if (!mawb || !String(mawb).trim()) {
    return res.status(400).json({ error: 'MAWB# 必填' });
  }
  const normalizedMawb = String(mawb).trim();
  // 重複 MAWB 檢查（排除自己）
  db.get("SELECT id FROM mawb_records WHERE mawb = ? AND id != ?", [normalizedMawb, id], (err, existing) => {
    if (err) return res.status(500).json({ error: err.message });
    if (existing) {
      return res.status(400).json({ error: `MAWB# ${normalizedMawb} 已存在（Booking #${existing.id}）` });
    }
    const stmt = db.prepare(`
      UPDATE mawb_records SET
        mawb = ?, hawb = ?, client = ?, dest = ?, pcs = ?, gross_weight = ?,
        volume_weight = ?, cbm = ?, spl = ?, remark = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(
      normalizedMawb,
      (hawb || '').trim(),
      (client || '').trim(),
      (dest || '').trim().toUpperCase(),
      parseInt(pcs, 10) || 0,
      parseFloat(gross_weight) || 0,
      parseFloat(volume_weight) || 0,
      parseFloat(cbm) || 0,
      (spl || '').trim(),
      (remark || '').trim(),
      id,
      function (updateErr) {
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        if (!this.changes) return res.status(404).json({ error: 'Booking 不存在' });
        writeAuditLog(req, 'pallet.booking.update', 'mawb_record', id, `更新 Booking ${normalizedMawb}`);
        db.get(BOOKING_SELECT_SQL + ' WHERE b.id = ?', [id], (getErr, row) => {
          if (getErr) return res.status(500).json({ error: getErr.message });
          res.json({ success: true, data: serializeBooking(row) });
        });
      }
    );
    stmt.finalize();
  });
});

// DELETE /api/pallet/bookings/:id
router.delete('/bookings/:id', (req, res) => {
  const { id } = req.params;
  // 檢查是否在 Plan 內
  db.all(
    `SELECT p.id, p.plan_no, p.status FROM pallet_plan_items pi
     JOIN pallet_plans p ON p.id = pi.plan_id
     WHERE pi.mawb_record_id = ?`,
    [id],
    (err, planRefs) => {
      if (err) return res.status(500).json({ error: err.message });
      // 若存在於已上鎖/已完成的 Plan，禁止刪除
      const lockedRef = (planRefs || []).find(p => p.status === 'locked' || p.status === 'completed');
      if (lockedRef) {
        return res.status(400).json({
          error: `此 MAWB 存在於「${lockedRef.plan_no}」（${STATUS_LABEL[lockedRef.status] || lockedRef.status}）內，無法刪除。請先從該計劃移出。`
        });
      }
      // 先刪除未上鎖 Plan 中的關聯
      const stmt = db.prepare("DELETE FROM pallet_plan_items WHERE mawb_record_id = ? AND plan_id NOT IN (SELECT id FROM pallet_plans WHERE status IN ('locked','completed'))");
      stmt.run(id, function (delErr) {
        if (delErr) return res.status(500).json({ error: delErr.message });
        db.run("DELETE FROM mawb_records WHERE id = ?", id, function (delRecordErr) {
          if (delRecordErr) return res.status(500).json({ error: delRecordErr.message });
          if (!this.changes) return res.status(404).json({ error: 'Booking 不存在' });
          writeAuditLog(req, 'pallet.booking.delete', 'mawb_record', id, `刪除 Booking ${id}`);
          res.json({ success: true, changes: this.changes, removed_plan_refs: (planRefs || []).length });
        });
      });
      stmt.finalize();
    }
  );
});

// GET /api/pallet/bookings/destinations → 目的地清單（搜尋/分組用）
router.get('/bookings/destinations', (req, res) => {
  db.all("SELECT DISTINCT dest FROM mawb_records WHERE dest IS NOT NULL AND dest != '' ORDER BY dest", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows.map(r => r.dest) });
  });
});

// ===== 打板計劃 =====

// GET /api/pallet/plans?status=
router.get('/plans', (req, res) => {
  const status = (req.query.status || '').trim();
  let sql = PLAN_SELECT_SQL + ' WHERE 1=1';
  const params = [];
  if (status) {
    sql += ' AND p.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY p.created_at DESC, p.id DESC';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows.map(serializePlan) });
  });
});

// POST /api/pallet/plans → 新增（自動產生 plan_no）
router.post('/plans', (req, res) => {
  const {
    company_name, fax, plan_date, flight_no, flight_date, arrival_airport,
    contour_text, contour_code, max_gross_weight, handover_hours, planner, remarks
  } = req.body;

  generatePlanNo((err, planNo) => {
    if (err) return res.status(500).json({ error: err.message });
    const stmt = db.prepare(`
      INSERT INTO pallet_plans (
        plan_no, company_name, fax, plan_date, flight_no, flight_date, arrival_airport,
        contour_text, contour_code, max_gross_weight, handover_hours, planner, remarks, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `);
    stmt.run(
      planNo,
      (company_name || '').trim() || 'AIR GLOBAL LIMITED 世航貨運有限公司',
      (fax || '').trim(),
      plan_date || null,
      (flight_no || '').trim(),
      flight_date || null,
      (arrival_airport || '').trim().toUpperCase(),
      (contour_text || '').trim(),
      (contour_code || '').trim(),
      max_gross_weight ? parseFloat(max_gross_weight) : null,
      handover_hours ? parseInt(handover_hours, 10) : null,
      (planner || '').trim(),
      (remarks || '').trim(),
      function (insertErr) {
        if (insertErr) return res.status(500).json({ error: insertErr.message });
        const newId = this.lastID;
        writeAuditLog(req, 'pallet.plan.create', 'pallet_plan', newId, `新增打板計劃 ${planNo}`);
        db.get(PLAN_SELECT_SQL + ' WHERE p.id = ?', [newId], (getErr, row) => {
          if (getErr) return res.status(500).json({ error: getErr.message });
          res.json({ success: true, data: serializePlan(row) });
        });
      }
    );
    stmt.finalize();
  });
});

// GET /api/pallet/plans/:id → 詳情（含明細）
router.get('/plans/:id', (req, res) => {
  const { id } = req.params;
  db.get(PLAN_SELECT_SQL + ' WHERE p.id = ?', [id], (err, plan) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!plan) return res.status(404).json({ error: '打板計劃不存在' });
    db.all(
      `SELECT pi.id AS plan_item_id, pi.sort_order, b.*,
              strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at) AS created_at,
              strftime('%Y-%m-%dT%H:%M:%fZ', b.updated_at) AS updated_at
       FROM pallet_plan_items pi
       JOIN mawb_records b ON b.id = pi.mawb_record_id
       WHERE pi.plan_id = ?
       ORDER BY pi.sort_order ASC, pi.id ASC`,
      [id],
      (err2, items) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({
          data: {
            ...serializePlan(plan),
            items: items.map(it => ({ ...serializeBooking(it), plan_item_id: it.plan_item_id, sort_order: it.sort_order }))
          }
        });
      }
    );
  });
});

// PUT /api/pallet/plans/:id → 更新（含狀態變更/上鎖解鎖）
router.put('/plans/:id', (req, res) => {
  const { id } = req.params;
  const {
    company_name, fax, plan_date, flight_no, flight_date, arrival_airport,
    contour_text, contour_code, max_gross_weight, handover_hours, planner, remarks, status
  } = req.body;

  db.get("SELECT * FROM pallet_plans WHERE id = ?", [id], (err, plan) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!plan) return res.status(404).json({ error: '打板計劃不存在' });

    // 狀態變更允許：任何狀態 → 任何狀態（含解鎖回草稿）
    // 但「非草稿」狀態間切換時不可修改內容欄位，僅允許變更狀態
    // 例外：解鎖回草稿（newStatus = draft）時允許同時更新內容欄位
    const isStatusOnly = !company_name && !flight_no && !contour_text && !planner && !remarks && !plan_date && !flight_date && !arrival_airport;
    const newStatus = status || plan.status;

    if (plan.status !== 'draft' && newStatus !== 'draft' && !isStatusOnly) {
      // 目前非草稿，且新狀態仍非草稿，但嘗試修改內容欄位（非僅狀態變更）
      return res.status(400).json({ error: '計劃已上鎖/完成/取消，只能變更狀態，無法修改內容。請先解鎖回「草稿」再編輯。' });
    }

    const stmt = db.prepare(`
      UPDATE pallet_plans SET
        company_name = ?, fax = ?, plan_date = ?, flight_no = ?, flight_date = ?,
        arrival_airport = ?, contour_text = ?, contour_code = ?,
        max_gross_weight = ?, handover_hours = ?, planner = ?, remarks = ?,
        status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(
      (company_name != null ? String(company_name).trim() : plan.company_name) || '',
      (fax != null ? String(fax).trim() : plan.fax) || '',
      (plan_date != null ? plan_date : plan.plan_date) || null,
      (flight_no != null ? String(flight_no).trim() : plan.flight_no) || '',
      (flight_date != null ? flight_date : plan.flight_date) || null,
      (arrival_airport != null ? String(arrival_airport).trim().toUpperCase() : plan.arrival_airport) || '',
      (contour_text != null ? String(contour_text).trim() : plan.contour_text) || '',
      (contour_code != null ? String(contour_code).trim() : plan.contour_code) || '',
      (max_gross_weight != null ? parseFloat(max_gross_weight) : plan.max_gross_weight) || null,
      (handover_hours != null ? parseInt(handover_hours, 10) : plan.handover_hours) || null,
      (planner != null ? String(planner).trim() : plan.planner) || '',
      (remarks != null ? String(remarks).trim() : plan.remarks) || '',
      newStatus,
      id,
      function (updateErr) {
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        if (!this.changes) return res.status(404).json({ error: '打板計劃不存在' });
        if (newStatus !== plan.status) {
          writeAuditLog(req, 'pallet.plan.status_change', 'pallet_plan', id, `${plan.status} → ${newStatus}（${plan.plan_no}）`);
        } else {
          writeAuditLog(req, 'pallet.plan.update', 'pallet_plan', id, `更新打板計劃 ${plan.plan_no}`);
        }
        db.get(PLAN_SELECT_SQL + ' WHERE p.id = ?', [id], (getErr, row) => {
          if (getErr) return res.status(500).json({ error: getErr.message });
          res.json({ success: true, data: serializePlan(row) });
        });
      }
    );
    stmt.finalize();
  });
});

// DELETE /api/pallet/plans/:id
router.delete('/plans/:id', (req, res) => {
  const { id } = req.params;
  db.get("SELECT * FROM pallet_plans WHERE id = ?", [id], (err, plan) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!plan) return res.status(404).json({ error: '打板計劃不存在' });
    const planNo = plan.plan_no;
    db.run("DELETE FROM pallet_plan_items WHERE plan_id = ?", id, () => {
      db.run("DELETE FROM pallet_plans WHERE id = ?", id, function (delErr) {
        if (delErr) return res.status(500).json({ error: delErr.message });
        writeAuditLog(req, 'pallet.plan.delete', 'pallet_plan', id, `刪除打板計劃 ${planNo}`);
        res.json({ success: true, changes: this.changes });
      });
    });
  });
});

// POST /api/pallet/plans/:id/duplicate → 複製整個 Plan
router.post('/plans/:id/duplicate', (req, res) => {
  const { id } = req.params;
  const { copy_items } = req.body;
  db.get("SELECT * FROM pallet_plans WHERE id = ?", [id], (err, plan) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!plan) return res.status(404).json({ error: '打板計劃不存在' });
    generatePlanNo((genErr, newPlanNo) => {
      if (genErr) return res.status(500).json({ error: genErr.message });
      const stmt = db.prepare(`
        INSERT INTO pallet_plans (
          plan_no, company_name, fax, plan_date, flight_no, flight_date, arrival_airport,
          contour_text, contour_code, max_gross_weight, handover_hours, planner, remarks, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
      `);
      stmt.run(
        newPlanNo, plan.company_name, plan.fax, plan.plan_date, plan.flight_no, plan.flight_date,
        plan.arrival_airport, plan.contour_text, plan.contour_code, plan.max_gross_weight,
        plan.handover_hours, plan.planner, plan.remarks,
        function (insertErr) {
          if (insertErr) return res.status(500).json({ error: insertErr.message });
          const newPlanId = this.lastID;
          if (copy_items) {
            db.all("SELECT mawb_record_id FROM pallet_plan_items WHERE plan_id = ? ORDER BY sort_order ASC, id ASC", [id], (itemsErr, items) => {
              if (itemsErr) return res.status(500).json({ error: itemsErr.message });
              const insStmt = db.prepare("INSERT INTO pallet_plan_items (plan_id, mawb_record_id, sort_order) VALUES (?, ?, ?)");
              items.forEach((item, idx) => insStmt.run(newPlanId, item.mawb_record_id, idx));
              insStmt.finalize();
              writeAuditLog(req, 'pallet.plan.duplicate', 'pallet_plan', newPlanId, `複製打板計劃 ${plan.plan_no} → ${newPlanNo}（含 ${items.length} 項明細）`);
              db.get(PLAN_SELECT_SQL + ' WHERE p.id = ?', [newPlanId], (getErr, row) => {
                if (getErr) return res.status(500).json({ error: getErr.message });
                res.json({ success: true, data: serializePlan(row) });
              });
            });
          } else {
            writeAuditLog(req, 'pallet.plan.duplicate', 'pallet_plan', newPlanId, `複製打板計劃 ${plan.plan_no} → ${newPlanNo}`);
            db.get(PLAN_SELECT_SQL + ' WHERE p.id = ?', [newPlanId], (getErr, row) => {
              if (getErr) return res.status(500).json({ error: getErr.message });
              res.json({ success: true, data: serializePlan(row) });
            });
          }
        }
      );
      stmt.finalize();
    });
  });
});

// ===== 明細關聯 =====

// POST /api/pallet/plans/:id/items → 批量加入 MAWB { record_ids: [..] }
router.post('/plans/:id/items', (req, res) => {
  const { id } = req.params;
  const { record_ids } = req.body;
  if (!Array.isArray(record_ids) || !record_ids.length) {
    return res.status(400).json({ error: '請選擇要加入的 MAWB' });
  }
  db.get("SELECT * FROM pallet_plans WHERE id = ?", [id], (err, plan) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!isEditablePlan(plan, res)) return;

    // 取得目前最大 sort_order
    db.get("SELECT COALESCE(MAX(sort_order), -1) AS maxSort FROM pallet_plan_items WHERE plan_id = ?", [id], (sortErr, sortRow) => {
      if (sortErr) return res.status(500).json({ error: sortErr.message });
      let nextSort = (sortRow.maxSort || 0) + 1;
      let added = 0;
      let skipped = 0;
      const uniqueIds = [...new Set(record_ids)];
      const insertStmt = db.prepare("INSERT OR IGNORE INTO pallet_plan_items (plan_id, mawb_record_id, sort_order) VALUES (?, ?, ?)");
      uniqueIds.forEach(rid => {
        insertStmt.run(id, rid, nextSort++, function (runErr) {
          if (runErr) return res.status(500).json({ error: runErr.message });
          if (this.changes > 0) added++;
          else skipped++;
        });
      });
      insertStmt.finalize(() => {
        writeAuditLog(req, 'pallet.plan.add_items', 'pallet_plan', id, `${plan.plan_no} 加入 ${added} 筆 MAWB（重複 ${skipped} 筆）`);
        // 回傳更新後的詳情
        db.get(PLAN_SELECT_SQL + ' WHERE p.id = ?', [id], (getErr, updatedPlan) => {
          if (getErr) return res.status(500).json({ error: getErr.message });
          res.json({ success: true, added, skipped, data: serializePlan(updatedPlan) });
        });
      });
    });
  });
});

// DELETE /api/pallet/plans/:id/items/:planItemId → 移出 MAWB
router.delete('/plans/:id/items/:planItemId', (req, res) => {
  const { id, planItemId } = req.params;
  db.get("SELECT * FROM pallet_plans WHERE id = ?", [id], (err, plan) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!isEditablePlan(plan, res)) return;
    db.get("SELECT * FROM pallet_plan_items WHERE id = ? AND plan_id = ?", [planItemId, id], (itemErr, item) => {
      if (itemErr) return res.status(500).json({ error: itemErr.message });
      if (!item) return res.status(404).json({ error: '明細不存在' });
      db.run("DELETE FROM pallet_plan_items WHERE id = ?", planItemId, function (delErr) {
        if (delErr) return res.status(500).json({ error: delErr.message });
        writeAuditLog(req, 'pallet.plan.remove_item', 'pallet_plan', id, `${plan.plan_no} 移出 MAWB #${item.mawb_record_id}`);
        res.json({ success: true, changes: this.changes });
      });
    });
  });
});

// PUT /api/pallet/plans/:id/items/reorder → 拖動排序 { ordered_plan_item_ids: [..] }
router.put('/plans/:id/items/reorder', (req, res) => {
  const { id } = req.params;
  const { ordered_plan_item_ids } = req.body;
  if (!Array.isArray(ordered_plan_item_ids) || !ordered_plan_item_ids.length) {
    return res.status(400).json({ error: '缺少排序清單' });
  }
  db.get("SELECT * FROM pallet_plans WHERE id = ?", [id], (err, plan) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!isEditablePlan(plan, res)) return;
    const stmt = db.prepare("UPDATE pallet_plan_items SET sort_order = ? WHERE id = ? AND plan_id = ?");
    let done = 0;
    ordered_plan_item_ids.forEach((pid, idx) => {
      stmt.run(idx, pid, id, function (runErr) {
        if (runErr) return res.status(500).json({ error: runErr.message });
        if (++done === ordered_plan_item_ids.length) {
          res.json({ success: true, changes: ordered_plan_item_ids.length });
        }
      });
    });
    stmt.finalize();
  });
});

// ===== SPL / REMARK 維護清單 =====

// GET /api/pallet/spl-codes
router.get('/spl-codes', (req, res) => {
  db.all("SELECT * FROM spl_codes ORDER BY code", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows.map(r => ({ id: r.id, code: r.code, description: r.description })) });
  });
});

// POST /api/pallet/spl-codes
router.post('/spl-codes', (req, res) => {
  const { code, description } = req.body;
  if (!code || !String(code).trim()) {
    return res.status(400).json({ error: '請填寫 SPL 代碼' });
  }
  const trimmedCode = String(code).trim().toUpperCase();
  db.get("SELECT id FROM spl_codes WHERE code = ?", [trimmedCode], (err, existing) => {
    if (err) return res.status(500).json({ error: err.message });
    if (existing) return res.status(400).json({ error: `SPL 代碼 ${trimmedCode} 已存在` });
    db.run("INSERT INTO spl_codes (code, description) VALUES (?, ?)", [trimmedCode, (description || '').trim()], function (insertErr) {
      if (insertErr) return res.status(500).json({ error: insertErr.message });
      writeAuditLog(req, 'pallet.spl_codes.create', 'spl_code', this.lastID, `新增 SPL 代碼 ${trimmedCode}`);
      res.json({ success: true, id: this.lastID, code: trimmedCode });
    });
  });
});

// GET /api/pallet/remark-templates
router.get('/remark-templates', (req, res) => {
  db.all("SELECT * FROM remark_templates ORDER BY name", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows.map(r => ({ id: r.id, name: r.name, content: r.content })) });
  });
});

// POST /api/pallet/remark-templates
router.post('/remark-templates', (req, res) => {
  const { name, content } = req.body;
  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: '請填寫備註內容' });
  }
  db.run(
    "INSERT INTO remark_templates (name, content) VALUES (?, ?)",
    [(name || '').trim(), String(content).trim()],
    function (insertErr) {
      if (insertErr) return res.status(500).json({ error: insertErr.message });
      writeAuditLog(req, 'pallet.remark_templates.create', 'remark_template', this.lastID, `新增備註範本 ${(name || '').trim()}`);
      res.json({ success: true, id: this.lastID });
    }
  );
});

module.exports = router;