/**
 * routes/packing-projects.js
 * ULD 裝箱專案管理 API（PRD §5 資料表：projects / ulds / customers / items / solutions）
 *
 *  REST 設計：
 *   POST   /api/packing/projects            建立專案（MAWB、DEST、ULD 明細）
 *   GET    /api/packing/projects            專案列表（含整體裝載摘要）
 *   GET    /api/packing/projects/:id        專案詳情（ULD / 客戶 / 貨物）
 *   DELETE /api/packing/projects/:id        刪除專案（含關聯資料）
 *   POST   /api/packing/projects/:id/ulds   追加 ULD
 *   DELETE /api/packing/projects/:id/ulds/:uid  移除 ULD
 *   POST   /api/packing/projects/:id/customers  新增客戶（自動分配色卡）
 *   POST   /api/packing/projects/:id/items  新增貨物
 *   PATCH  /api/packing/projects/:id/items/:itemId  更新貨物（含指派 ULD）
 */
const express = require('express');
const db = require('../db/database');
const { ALL_ULDS, getUldDefinition } = require('../bp3d/uld-definitions');
const { assignColor } = require('../utils/color-assigner');

const router = express.Router();

// ===== 共用工具 =====

/** 回應錯誤（統一格式） */
function fail(res, status, message) {
  res.status(status).json({ error: message });
}

/** 驗證 ULD 類型是否存在 */
function validateUldType(type) {
  if (!type) return { ok: false, error: 'ULD type 為必填' };
  const def = getUldDefinition(String(type).toUpperCase());
  if (!def) return { ok: false, error: `未知 ULD 類型 '${type}'。可用：${Object.keys(ALL_ULDS).join(', ')}` };
  return { ok: true, def };
}

/** 序列化 ULD 規格（JSON contour_config + 浮點修正） */
function serializeUld(row) {
  let contourConfig = null;
  if (row.contour_config) {
    try { contourConfig = JSON.parse(row.contour_config); } catch (e) { contourConfig = null; }
  }
  return {
    id: row.id,
    project_id: row.project_id,
    uld_type: row.uld_type,
    label: row.label,
    max_weight_kg: row.max_weight_kg,
    contour_config: contourConfig,
    status: row.status,
    seq: row.seq,
  };
}

// ===== 專案 CRUD =====

/** 建立專案 */
router.post('/projects', (req, res) => {
  const { mawb, dest, ulds } = req.body || {};

  if (!mawb || typeof mawb !== 'string' || !mawb.trim()) {
    return fail(res, 400, 'MAWB# 為必填字串');
  }
  if (!dest || typeof dest !== 'string' || !dest.trim()) {
    return fail(res, 400, 'DEST（目的站）為必填');
  }

  // 驗證 ULD 明細（可選：不傳 = 空專案）
  const uldList = Array.isArray(ulds) ? ulds : [];
  for (const u of uldList) {
    const v = validateUldType(u.uld_type);
    if (!v.ok) return fail(res, 400, v.error);
    const qty = Number(u.quantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      return fail(res, 400, `ULD '${u.uld_type}' quantity 必須為 1~50 的整數`);
    }
  }

  db.run(
    'INSERT INTO projects (mawb, dest) VALUES (?, ?)',
    [mawb.trim(), dest.trim().toUpperCase()],
    function (err) {
      if (err) return fail(res, 500, `建立專案失敗：${err.message}`);
      const projectId = this.lastID;

      // 追加 ULD
      let seq = 1;
      const insertUld = (i) => {
        if (i >= uldList.length) {
          return res.status(201).json({ id: projectId, mawb: mawb.trim(), dest: dest.trim().toUpperCase(), ulds_added: uldList.reduce((s, u) => s + Number(u.quantity ?? 1), 0) });
        }
        const u = uldList[i];
        const qty = Number(u.quantity ?? 1);
        const def = getUldDefinition(String(u.uld_type).toUpperCase());
        const contourConfig = def.profileKey ? {
          geometryType: def.geometryType,
          profileKey: def.profileKey,
          baseL: def.baseL,
          baseW: def.baseW,
          maxHeightMm: def.maxHeightMm,
        } : {
          geometryType: def.geometryType,
          baseL: def.baseL,
          baseW: def.baseW,
          maxHeightMm: def.maxHeightMm,
        };

        const insertOne = (n) => {
          if (n >= qty) return insertUld(i + 1);
          const label = `${String(u.uld_type).toUpperCase()}-${String(seq).padStart(2, '0')}`;
          db.run(
            'INSERT INTO ulds (project_id, uld_type, label, max_weight_kg, contour_config, status, seq) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [projectId, String(u.uld_type).toUpperCase(), label, def.maxWeightKg, JSON.stringify(contourConfig), 'pending', seq],
            (err2) => {
              if (err2) return fail(res, 500, `建立 ULD 失敗：${err2.message}`);
              seq++;
              insertOne(n + 1);
            }
          );
        };
        insertOne(0);
      };
      insertUld(0);
    }
  );
});

/** 專案列表（含 ULD 數量與裝載摘要） */
router.get('/projects', (req, res) => {
  db.all(
    `SELECT p.*,
       (SELECT COUNT(*) FROM ulds u WHERE u.project_id = p.id) AS uld_count,
       (SELECT COUNT(*) FROM items i JOIN customers c ON i.customer_id = c.id WHERE c.project_id = p.id) AS item_count
     FROM projects p
     ORDER BY p.id DESC`,
    [],
    (err, rows) => {
      if (err) return fail(res, 500, `查詢專案失敗：${err.message}`);
      res.json({ data: rows });
    }
  );
});

/** 取得單一專案詳情（含 ULD / 客戶 / 貨物） */
function getProjectDetail(id, callback) {
  db.get('SELECT * FROM projects WHERE id = ?', [id], (err, project) => {
    if (err) return callback(err);
    if (!project) return callback(null, null);

    db.all('SELECT * FROM ulds WHERE project_id = ? ORDER BY seq', [id], (err2, ulds) => {
      if (err2) return callback(err2);
      db.all('SELECT * FROM customers WHERE project_id = ? ORDER BY id', [id], (err3, customers) => {
        if (err3) return callback(err3);
        db.all(
          `SELECT i.*, c.hawb, c.customer_name, c.color_code
           FROM items i JOIN customers c ON i.customer_id = c.id
           WHERE c.project_id = ? ORDER BY i.id`,
          [id],
          (err4, items) => {
            if (err4) return callback(err4);
            callback(null, {
              ...project,
              ulds: (ulds || []).map(serializeUld),
              customers: (customers || []).map((c) => ({ ...c })),
              items: (items || []).map((i) => {
                const { hawb, customer_name, color_code, ...item } = i;
                return { ...item, hawb, customer_name, color_code };
              }),
            });
          }
        );
      });
    });
  });
}

router.get('/projects/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return fail(res, 400, '無效的專案 ID');
  getProjectDetail(id, (err, project) => {
    if (err) return fail(res, 500, `查詢專案失敗：${err.message}`);
    if (!project) return fail(res, 404, '專案不存在');
    res.json({ data: project });
  });
});

/** 刪除專案（級聯刪除 ULD / 客戶 / 貨物 / 方案） */
router.delete('/projects/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return fail(res, 400, '無效的專案 ID');

  db.run('DELETE FROM projects WHERE id = ?', [id], function (err) {
    if (err) return fail(res, 500, `刪除專案失敗：${err.message}`);
    if (this.changes === 0) return fail(res, 404, '專案不存在');
    // 級聯：貨物→客戶→ULD→方案（依 FK 順序）
    db.run('DELETE FROM items WHERE customer_id IN (SELECT id FROM customers WHERE project_id = ?)', [id], () => {
      db.run('DELETE FROM customers WHERE project_id = ?', [id], () => {
        db.run('DELETE FROM ulds WHERE project_id = ?', [id], () => {
          db.run('DELETE FROM solutions WHERE project_id = ?', [id], (err2) => {
            if (err2) return fail(res, 500, `刪除關聯資料失敗：${err2.message}`);
            res.json({ ok: true });
          });
        });
      });
    });
  });
});

// ===== ULD 管理 =====

/** 追加 ULD 至專案 */
router.post('/projects/:id/ulds', (req, res) => {
  const projectId = Number(req.params.id);
  const { uld_type, quantity } = req.body || {};
  if (!Number.isInteger(projectId) || projectId < 1) return fail(res, 400, '無效的專案 ID');

  const v = validateUldType(uld_type);
  if (!v.ok) return fail(res, 400, v.error);
  const qty = Number(quantity ?? 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) return fail(res, 400, 'quantity 必須為 1~50 的整數');

  db.get('SELECT id FROM projects WHERE id = ?', [projectId], (err, project) => {
    if (err) return fail(res, 500, `查詢專案失敗：${err.message}`);
    if (!project) return fail(res, 404, '專案不存在');

    db.get('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM ulds WHERE project_id = ?', [projectId], (err2, row) => {
      if (err2) return fail(res, 500, `查詢 ULD 序號失敗：${err2.message}`);
      let seq = row.maxSeq + 1;
      const def = v.def;
      const contourConfig = def.profileKey ? {
        geometryType: def.geometryType,
        profileKey: def.profileKey,
        baseL: def.baseL,
        baseW: def.baseW,
        maxHeightMm: def.maxHeightMm,
      } : {
        geometryType: def.geometryType,
        baseL: def.baseL,
        baseW: def.baseW,
        maxHeightMm: def.maxHeightMm,
      };

      let inserted = 0;
      const insertOne = (n) => {
        if (n >= qty) {
          return res.status(201).json({ ok: true, inserted });
        }
        const label = `${String(uld_type).toUpperCase()}-${String(seq).padStart(2, '0')}`;
        db.run(
          'INSERT INTO ulds (project_id, uld_type, label, max_weight_kg, contour_config, status, seq) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [projectId, String(uld_type).toUpperCase(), label, def.maxWeightKg, JSON.stringify(contourConfig), 'pending', seq],
          (err3) => {
            if (err3) return fail(res, 500, `建立 ULD 失敗：${err3.message}`);
            inserted++;
            seq++;
            insertOne(n + 1);
          }
        );
      };
      insertOne(0);
    });
  });
});

/** 移除專案內指定 ULD */
router.delete('/projects/:id/ulds/:uid', (req, res) => {
  const projectId = Number(req.params.id);
  const uldId = Number(req.params.uid);
  if (!projectId || !uldId) return fail(res, 400, '無效的 ID');

  // 該 ULD 上已指派的貨物 → 改回未指派
  db.run("UPDATE items SET assigned_uld_id = NULL WHERE assigned_uld_id = ? AND customer_id IN (SELECT id FROM customers WHERE project_id = ?)", [uldId, projectId], (err) => {
    if (err) return fail(res, 500, `更新貨物指派失敗：${err.message}`);
    db.run('DELETE FROM ulds WHERE id = ? AND project_id = ?', [uldId, projectId], function (err2) {
      if (err2) return fail(res, 500, `刪除 ULD 失敗：${err2.message}`);
      if (this.changes === 0) return fail(res, 404, 'ULD 不存在於此專案');
      res.json({ ok: true });
    });
  });
});

// ===== 客戶管理 =====

/** 新增客戶（自動分配專屬色卡） */
router.post('/projects/:id/customers', (req, res) => {
  const projectId = Number(req.params.id);
  const { hawb, customer_name } = req.body || {};
  if (!Number.isInteger(projectId) || projectId < 1) return fail(res, 400, '無效的專案 ID');
  if (!hawb || typeof hawb !== 'string' || !hawb.trim()) return fail(res, 400, 'HAWB# 為必填');
  if (!customer_name || typeof customer_name !== 'string' || !customer_name.trim()) return fail(res, 400, 'Customer Name 為必填');

  db.get('SELECT id FROM projects WHERE id = ?', [projectId], (err, project) => {
    if (err) return fail(res, 500, `查詢專案失敗：${err.message}`);
    if (!project) return fail(res, 404, '專案不存在');

    // 同專案內 HAWB 不得重複
    db.get('SELECT id FROM customers WHERE project_id = ? AND hawb = ?', [projectId, hawb.trim()], (err2, dup) => {
      if (err2) return fail(res, 500, `查詢客戶失敗：${err2.message}`);
      if (dup) return fail(res, 409, `HAWB ${hawb} 已存在於此專案`);

      assignColor(projectId, hawb, customer_name, (err3, color) => {
        if (err3) return fail(res, 500, `分配色卡失敗：${err3.message}`);
        db.run(
          'INSERT INTO customers (project_id, hawb, customer_name, color_code) VALUES (?, ?, ?, ?)',
          [projectId, hawb.trim(), customer_name.trim(), color],
          function (err4) {
            if (err4) return fail(res, 500, `建立客戶失敗：${err4.message}`);
            res.status(201).json({ id: this.lastID, hawb: hawb.trim(), customer_name: customer_name.trim(), color_code: color });
          }
        );
      });
    });
  });
});

// ===== 貨物管理 =====

/** 新增貨物（指派客戶；可選指派 ULD） */
router.post('/projects/:id/items', (req, res) => {
  const projectId = Number(req.params.id);
  const { customer_id, assigned_uld_id, pack_type, length_cm, width_cm, height_cm, pcs, weight_kg, is_stackable, actual_type, note } = req.body || {};
  if (!Number.isInteger(projectId) || projectId < 1) return fail(res, 400, '無效的專案 ID');
  if (!Number.isInteger(customer_id) || customer_id < 1) return fail(res, 400, 'customer_id 為必填');
  if (!['PLT', 'CTN'].includes(String(pack_type || '').toUpperCase())) return fail(res, 400, "pack_type 必須為 'PLT' 或 'CTN'");
  const l = Number(length_cm), w = Number(width_cm), h = Number(height_cm);
  const wt = Number(weight_kg);
  const qty = Number(pcs ?? 1);
  if (![l, w, h].every((v) => Number.isFinite(v) && v > 0)) return fail(res, 400, 'length_cm / width_cm / height_cm 必須為正數');
  if (!Number.isFinite(wt) || wt <= 0) return fail(res, 400, 'weight_kg 必須為正數');
  if (!Number.isInteger(qty) || qty < 1 || qty > 10000) return fail(res, 400, 'pcs 必須為 1~10000 的整數');

  // 驗證客戶屬於該專案
  db.get('SELECT id FROM customers WHERE id = ? AND project_id = ?', [customer_id, projectId], (err, customer) => {
    if (err) return fail(res, 500, `查詢客戶失敗：${err.message}`);
    if (!customer) return fail(res, 404, '客戶不存在於此專案');

    // 驗證 ULD（若有指定）
    if (assigned_uld_id !== undefined && assigned_uld_id !== null) {
      db.get('SELECT id FROM ulds WHERE id = ? AND project_id = ?', [Number(assigned_uld_id), projectId], (err2, uld) => {
        if (err2) return fail(res, 500, `查詢 ULD 失敗：${err2.message}`);
        if (!uld) return fail(res, 404, 'ULD 不存在於此專案');
        insertItem();
      });
    } else {
      insertItem();
    }

    function insertItem() {
      db.run(
        `INSERT INTO items
           (customer_id, assigned_uld_id, pack_type, length_cm, width_cm, height_cm, pcs, weight_kg, is_stackable, actual_type, note, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [customer_id, assigned_uld_id || null, String(pack_type).toUpperCase(), l, w, h, qty, wt,
         is_stackable === true || is_stackable === 1 ? 1 : 0,
         actual_type ? String(actual_type).slice(0, 50) : null,
         note ? String(note).slice(0, 500) : null],
        function (err3) {
          if (err3) return fail(res, 500, `建立貨物失敗：${err3.message}`);
          res.status(201).json({ id: this.lastID });
        }
      );
    }
  });
});

/** 刪除貨物 */
router.delete('/projects/:id/items/:itemId', (req, res) => {
  const projectId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!projectId || !itemId) return fail(res, 400, '無效的 ID');

  db.run(
    `DELETE FROM items WHERE id = ? AND customer_id IN (SELECT id FROM customers WHERE project_id = ?)`,
    [itemId, projectId],
    function (err) {
      if (err) return fail(res, 500, `刪除貨物失敗：${err.message}`);
      if (this.changes === 0) return fail(res, 404, '貨物不存在於此專案');
      res.json({ ok: true });
    }
  );
});

/** 更新貨物（含指派/轉移 ULD） */
router.patch('/projects/:id/items/:itemId', (req, res) => {
  const projectId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const body = req.body || {};
  if (!projectId || !itemId) return fail(res, 400, '無效的 ID');

  db.get(
    `SELECT i.* FROM items i JOIN customers c ON i.customer_id = c.id
     WHERE i.id = ? AND c.project_id = ?`,
    [itemId, projectId],
    (err, item) => {
      if (err) return fail(res, 500, `查詢貨物失敗：${err.message}`);
      if (!item) return fail(res, 404, '貨物不存在於此專案');

      // 可更新欄位白名單
      const fields = [];
      const values = [];
      const updates = {
        assigned_uld_id: (v) => v === null || v === undefined ? null : Number(v),
        pack_type: (v) => String(v).toUpperCase(),
        length_cm: (v) => Number(v),
        width_cm: (v) => Number(v),
        height_cm: (v) => Number(v),
        pcs: (v) => Number(v),
        weight_kg: (v) => Number(v),
        is_stackable: (v) => (v === true || v === 1 ? 1 : 0),
        actual_type: (v) => String(v),
        note: (v) => String(v),
        status: (v) => String(v),
      };
      for (const [key, normalize] of Object.entries(updates)) {
        if (body[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(normalize(body[key]));
        }
      }
      if (fields.length === 0) return fail(res, 400, '沒有可更新的欄位');

      values.push(itemId);
      db.run(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, values, function (err2) {
        if (err2) return fail(res, 500, `更新貨物失敗：${err2.message}`);
        if (this.changes === 0) return fail(res, 404, '貨物不存在');
        res.json({ ok: true });
      });
    }
  );
});

module.exports = router;
