const express = require('express');
const db = require('../db/database');
const router = express.Router();

// ===== 資料庫檢視器：白名單 CRUD =====
// 設計原則：
// 1. 只允許操作白名單中的表，無法對任意 SQL/結構操作
// 2. 只允許修改「資料欄位」，自動排除 id / created_at / updated_at（由 DB 自動管理）
// 3. 這些操作是「記錄級」CRUD，不會改變資料庫結構（schema）

const ALLOWED_TABLES = ['skills', 'messages', 'companies', 'templates', 'note_templates', 'orders'];

// 各表不可由使用者修改的欄位（系統自動管理）
const READONLY_COLUMNS = {
  skills: ['id'],
  messages: ['id', 'created_at'],
  companies: ['id', 'created_at'],
  templates: ['id', 'created_at'],
  note_templates: ['id', 'created_at'],
  orders: ['id', 'created_at', 'updated_at', 'status']
};

function isAllowedTable(name) {
  return ALLOWED_TABLES.includes(name);
}

function getTableColumns(tableName, cb) {
  db.all(`PRAGMA table_info(${tableName})`, [], (err, rows) => {
    if (err) return cb(err);
    cb(null, rows);
  });
}

// GET /api/db/tables → 表清單 + 每表筆數
router.get('/tables', (req, res) => {
  const result = [];
  let pending = ALLOWED_TABLES.length;
  let hasError = false;

  ALLOWED_TABLES.forEach((tableName, idx) => {
    db.get(`SELECT COUNT(*) AS count FROM ${tableName}`, [], (err, row) => {
      if (err) {
        if (!hasError) {
          hasError = true;
          return res.status(500).json({ error: err.message });
        }
        return;
      }
      getTableColumns(tableName, (colErr, cols) => {
        if (colErr) {
          if (!hasError) {
            hasError = true;
            return res.status(500).json({ error: colErr.message });
          }
          return;
        }
        result[idx] = {
          name: tableName,
          count: row.count,
          columns: cols.map(c => c.name)
        };
        pending -= 1;
        if (pending === 0) {
          res.json({ data: result });
        }
      });
    });
  });
});

// GET /api/db/tables/:name → 指定表所有資料
router.get('/tables/:name', (req, res) => {
  const { name } = req.params;
  if (!isAllowedTable(name)) {
    return res.status(400).json({ error: '不允許操作此表' });
  }

  getTableColumns(name, (err, cols) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(`SELECT * FROM ${name} ORDER BY rowid DESC`, [], (err2, rows) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({
        data: {
          table: name,
          columns: cols.map(c => c.name),
          rows
        }
      });
    });
  });
});

// 取得可編輯欄位（排除 readonly）
function getEditableColumns(tableName, cb) {
  getTableColumns(tableName, (err, cols) => {
    if (err) return cb(err);
    const readonly = READONLY_COLUMNS[tableName] || ['id', 'created_at', 'updated_at'];
    const editable = cols.filter(c => !readonly.includes(c.name)).map(c => c.name);
    cb(null, editable);
  });
}

// POST /api/db/tables/:name → 新增記錄
router.post('/tables/:name', (req, res) => {
  const { name } = req.params;
  if (!isAllowedTable(name)) {
    return res.status(400).json({ error: '不允許操作此表' });
  }

  getEditableColumns(name, (err, editableCols) => {
    if (err) return res.status(500).json({ error: err.message });

    const keys = editableCols.filter(k => req.body[k] !== undefined && req.body[k] !== '');
    if (keys.length === 0) {
      return res.status(400).json({ error: '沒有可寫入的欄位' });
    }

    const placeholders = keys.map(() => '?').join(', ');
    const colNames = keys.join(', ');
    const values = keys.map(k => req.body[k]);

    const stmt = db.prepare(`INSERT INTO ${name} (${colNames}) VALUES (${placeholders})`);
    stmt.run(...values, function (insertErr) {
      if (insertErr) return res.status(500).json({ error: insertErr.message });
      res.json({ success: true, id: this.lastID });
    });
    stmt.finalize();
  });
});

// PUT /api/db/tables/:name/:id → 更新記錄
router.put('/tables/:name/:id', (req, res) => {
  const { name, id } = req.params;
  if (!isAllowedTable(name)) {
    return res.status(400).json({ error: '不允許操作此表' });
  }

  getEditableColumns(name, (err, editableCols) => {
    if (err) return res.status(500).json({ error: err.message });

    const keys = editableCols.filter(k => req.body[k] !== undefined);
    if (keys.length === 0) {
      return res.status(400).json({ error: '沒有可更新的欄位' });
    }

    const sets = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => req.body[k]);
    values.push(id);

    const stmt = db.prepare(`UPDATE ${name} SET ${sets} WHERE id = ?`);
    stmt.run(...values, function (updateErr) {
      if (updateErr) return res.status(500).json({ error: updateErr.message });
      res.json({ success: true, changes: this.changes });
    });
    stmt.finalize();
  });
});

// DELETE /api/db/tables/:name/:id → 刪除記錄
router.delete('/tables/:name/:id', (req, res) => {
  const { name, id } = req.params;
  if (!isAllowedTable(name)) {
    return res.status(400).json({ error: '不允許操作此表' });
  }

  // 特殊保護：刪除公司前檢查是否被訂單/範本引用
  if (name === 'companies') {
    db.get(
      `SELECT
        (SELECT COUNT(*) FROM orders WHERE pickup_company_id = ? OR delivery_company_id = ?) AS order_ref,
        (SELECT COUNT(*) FROM templates WHERE company_id = ?) AS template_ref`,
      [id, id, id],
      (refErr, refRow) => {
        if (refErr) return res.status(500).json({ error: refErr.message });
        if (refRow.order_ref > 0 || refRow.template_ref > 0) {
          const parts = [];
          if (refRow.order_ref > 0) parts.push(`訂單 ${refRow.order_ref} 筆`);
          if (refRow.template_ref > 0) parts.push(`範本 ${refRow.template_ref} 個`);
          return res.status(400).json({ error: `此公司正被使用（${parts.join('、')}），無法刪除。請先刪除相關訂單/範本或改用其他公司。` });
        }
        doDelete();
      }
    );
    return;
  }

  doDelete();

  function doDelete() {
    const stmt = db.prepare(`DELETE FROM ${name} WHERE id = ?`);
    stmt.run(id, function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    });
    stmt.finalize();
  }
});

module.exports = router;