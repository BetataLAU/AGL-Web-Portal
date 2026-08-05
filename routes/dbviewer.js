const express = require('express');
const db = require('../db/database');
const router = express.Router();

// ===== 資料庫檢視器：動態表清單 CRUD =====
// 設計原則：
// 1. 只允許操作「資料庫內實際存在的表」（查 sqlite_master 動態白名單），無法對任意 SQL/結構操作
// 2. 只允許修改「資料欄位」，自動排除 id / created_at / updated_at（由 DB 自動管理）
// 3. 這些操作是「記錄級」CRUD，不會改變資料庫結構（schema）

// 各表不可由使用者修改的欄位（系統自動管理）；未知表使用 fallback
const READONLY_COLUMNS = {
  skills: ['id'],
  messages: ['id', 'created_at'],
  companies: ['id', 'created_at'],
  templates: ['id', 'created_at'],
  note_templates: ['id', 'created_at'],
  orders: ['id', 'created_at', 'updated_at', 'status']
};

// 預設只讀欄位（未知表 fallback）
const DEFAULT_READONLY = ['id', 'created_at', 'updated_at'];

// ===== 動態表白名單（查 sqlite_master）=====
// 回傳 db 內所有「非 sqlite_* 系統表」的實際表名
function getAllTables(cb) {
  db.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
    [],
    (err, rows) => {
      if (err) return cb(err);
      cb(null, (rows || []).map(r => r.name));
    }
  );
}

// 動態判定表是否存在且非系統表
function isAllowedTable(name, cb) {
  if (!name || typeof name !== 'string' || name.trim() === '' || name.startsWith('sqlite_')) {
    return cb(null, false);
  }
  db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    [name],
    (err, row) => {
      if (err) return cb(err);
      cb(null, !!row);
    }
  );
}

function getTableColumns(tableName, cb) {
  db.all(`PRAGMA table_info(${tableName})`, [], (err, rows) => {
    if (err) return cb(err);
    cb(null, rows);
  });
}

// ===== 動態表白名單快取 =====
// 每次請求即時查詢，確保資料庫結構變更後立即反映
function resolveTable(req, res, next) {
  const { name } = req.params;
  isAllowedTable(name, (err, allowed) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!allowed) {
      return res.status(400).json({ error: '不允許操作此表（表不存在或為系統表）' });
    }
    req.allowedTable = name;
    next();
  });
}

// GET /api/db/tables → 所有表清單 + 每表筆數 + 欄位
router.get('/tables', (req, res) => {
  getAllTables((err, tables) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!tables.length) return res.json({ data: [] });

    const result = [];
    let pending = tables.length;
    let hasError = false;

    tables.forEach((tableName, idx) => {
      db.get(`SELECT COUNT(*) AS count FROM ${tableName}`, [], (countErr, row) => {
        if (countErr) {
          if (!hasError) {
            hasError = true;
            return res.status(500).json({ error: countErr.message });
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
});

// GET /api/db/tables/:name → 指定表所有資料
router.get('/tables/:name', resolveTable, (req, res) => {
  const { allowedTable } = req;
  getTableColumns(allowedTable, (err, cols) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(`SELECT * FROM ${allowedTable} ORDER BY rowid DESC`, [], (err2, rows) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({
        data: {
          table: allowedTable,
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
    const readonly = READONLY_COLUMNS[tableName] || DEFAULT_READONLY;
    const editable = cols.filter(c => !readonly.includes(c.name)).map(c => c.name);
    cb(null, editable);
  });
}

// POST /api/db/tables/:name → 新增記錄
router.post('/tables/:name', resolveTable, (req, res) => {
  const { allowedTable } = req;
  getEditableColumns(allowedTable, (err, editableCols) => {
    if (err) return res.status(500).json({ error: err.message });

    const keys = editableCols.filter(k => req.body[k] !== undefined && req.body[k] !== '');
    if (keys.length === 0) {
      return res.status(400).json({ error: '沒有可寫入的欄位' });
    }

    const placeholders = keys.map(() => '?').join(', ');
    const colNames = keys.join(', ');
    const values = keys.map(k => req.body[k]);

    const stmt = db.prepare(`INSERT INTO ${allowedTable} (${colNames}) VALUES (${placeholders})`);
    stmt.run(...values, function (insertErr) {
      if (insertErr) return res.status(500).json({ error: insertErr.message });
      res.json({ success: true, id: this.lastID });
    });
    stmt.finalize();
  });
});

// PUT /api/db/tables/:name/:id → 更新記錄
router.put('/tables/:name/:id', resolveTable, (req, res) => {
  const { allowedTable } = req;
  getEditableColumns(allowedTable, (err, editableCols) => {
    if (err) return res.status(500).json({ error: err.message });

    const keys = editableCols.filter(k => req.body[k] !== undefined);
    if (keys.length === 0) {
      return res.status(400).json({ error: '沒有可更新的欄位' });
    }

    const sets = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => req.body[k]);
    values.push(req.params.id);

    const stmt = db.prepare(`UPDATE ${allowedTable} SET ${sets} WHERE id = ?`);
    stmt.run(...values, function (updateErr) {
      if (updateErr) return res.status(500).json({ error: updateErr.message });
      res.json({ success: true, changes: this.changes });
    });
    stmt.finalize();
  });
});

// DELETE /api/db/tables/:name/:id → 刪除記錄
router.delete('/tables/:name/:id', resolveTable, (req, res) => {
  const { allowedTable } = req;
  const { id } = req.params;

  // 特殊保護：刪除公司前檢查是否被訂單/範本引用
  if (allowedTable === 'companies') {
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
    const stmt = db.prepare(`DELETE FROM ${allowedTable} WHERE id = ?`);
    stmt.run(id, function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    });
    stmt.finalize();
  }
});

module.exports = router;