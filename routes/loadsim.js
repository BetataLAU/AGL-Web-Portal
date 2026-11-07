// ===== 模擬裝板系統：雲端存檔 API（Admin / Staff 限定） =====
// 模擬裝板本身是「免登入」的純前端工具（public/js/loadsim.js）；這裡只負責一件事：
// 「把某一次排好的板存到伺服器，之後在別台電腦／同事也能載入」。
// 一份存檔＝一個 JSON snapshot（板型／板底／單位／貨物擺位／檢查選項…）
// ＋幾個給清單顯示用的彙總欄位（件數／重量／利用率），與 uld_weight_versions.snapshot 同一種做法。
const express = require('express');
const db = require('../db/database');
const router = express.Router();

const MAX_NAME_LEN = 60;
const MAX_ITEMS = 1000;
// 2 MB：一件貨物 JSON ≈ 200 bytes，1000 件約 200 KB，留很大餘裕
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 200;

// ===== sqlite3 callback → Promise =====
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onDone(err) {
      if (err) reject(err); else resolve(this);
    });
  });
}

// 寫入審計日誌（與打板計劃／ULD 夾重同一套）
function writeAuditLog(req, action, targetId, detail) {
  const user = (req.session && req.session.user) || {};
  db.run(
    `INSERT INTO audit_log (actor_user_id, actor_display, action, target_type, target_id, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user.user_id || null, user.display_name || user.user_id || null, action, 'loadsim_plan', String(targetId || ''), detail || null],
    (err) => { if (err) console.error('[loadsim] audit_log 寫入失敗:', err.message); }
  );
}

function actorOf(req) {
  const user = (req.session && req.session.user) || {};
  return user.user_id || 'unknown';
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// 名稱：收斂空白、去頭尾、最長 60 字
function sanitizeName(value) {
  const name = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return name.slice(0, MAX_NAME_LEN);
}

function sanitizeSavedAt(value) {
  const text = String(value == null ? '' : value).trim();
  if (text && text.length <= 40 && !Number.isNaN(Date.parse(text))) return new Date(text).toISOString();
  return new Date().toISOString();
}

// snapshot 驗證：必須是物件、items 必須是陣列、尺寸三邊都要 > 0
// （與前端 state.js 的 sanitizeItem 同一套規則：壞掉的貨物直接略過，不要讓整份存檔失敗）
function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!Array.isArray(raw.items)) return null;
  if (raw.items.length > MAX_ITEMS) return null;

  const items = [];
  raw.items.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const dims = item.dims && typeof item.dims === 'object' ? item.dims : {};
    const l = num(dims.l);
    const w = num(dims.w);
    const h = num(dims.h);
    if (!(l > 0 && w > 0 && h > 0)) return;
    items.push(Object.assign({}, item, { dims: { l, w, h } }));
  });

  return Object.assign({}, raw, { items });
}

// 清單用的彙總：前端有送就用前端的（同一套公式算出來的），沒送或格式不對就從 snapshot 自己算
function summarize(snapshot, provided) {
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const board = items.filter(item => item && item.placed && !item.staged);
  const cargoKg = board.reduce((sum, item) => sum + num(item.weight), 0);
  const round1 = value => Math.round(value * 10) / 10;

  const fallback = {
    itemCount: items.length,
    boardCount: board.length,
    totalKg: round1(cargoKg),
    grossKg: round1(cargoKg),
    utilizationPct: 0
  };
  const src = provided && typeof provided === 'object' ? provided : {};
  const clampInt = (value, low, high, backup) => {
    const n = Math.round(num(value, NaN));
    if (!Number.isFinite(n)) return backup;
    return Math.min(high, Math.max(low, n));
  };
  const clampNum = (value, low, high, backup) => {
    const n = num(value, NaN);
    if (!Number.isFinite(n)) return backup;
    return Math.min(high, Math.max(low, round1(n)));
  };

  return {
    itemCount: clampInt(src.itemCount, 0, MAX_ITEMS, fallback.itemCount),
    boardCount: clampInt(src.boardCount, 0, MAX_ITEMS, fallback.boardCount),
    totalKg: clampNum(src.totalKg, 0, 1e7, fallback.totalKg),
    grossKg: clampNum(src.grossKg, 0, 1e7, fallback.grossKg),
    utilizationPct: clampNum(src.utilizationPct, 0, 999, fallback.utilizationPct)
  };
}

// 資料列 → API 回應（快照只在「單筆」回傳，清單不含，避免一次抓太多）
function serializeRow(row, withSnapshot) {
  if (!row) return null;
  const out = {
    id: row.id,
    name: row.name,
    uld_code: row.uld_code,
    plate_type: row.plate_type,
    item_count: row.item_count,
    board_count: row.board_count,
    total_kg: row.total_kg,
    gross_kg: row.gross_kg,
    utilization_pct: row.utilization_pct,
    saved_at: row.saved_at,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
  if (withSnapshot) {
    if (!row.snapshot) {
      out.snapshot = null;
    } else {
      try { out.snapshot = JSON.parse(row.snapshot); } catch (e) { out.snapshot = null; }
    }
  }
  return out;
}

function snapshotColumns(snapshot, summary) {
  return [
    String(snapshot.uldCode || '').slice(0, 40),
    snapshot.plateType === 'thick' ? 'thick' : 'thin',
    summary.itemCount,
    summary.boardCount,
    summary.totalKg,
    summary.grossKg,
    summary.utilizationPct,
    sanitizeSavedAt(snapshot.savedAt),
    JSON.stringify(snapshot)
  ];
}

// 不在每個 handler 裡重複 try/catch
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ===== 清單（不含 snapshot）=====
router.get('/plans', handle(async (req, res) => {
  const rows = await dbAll(
    `SELECT id, name, uld_code, plate_type, item_count, board_count, total_kg, gross_kg,
            utilization_pct, saved_at, created_by, updated_by, created_at, updated_at
       FROM loadsim_plans
      ORDER BY datetime(COALESCE(saved_at, created_at)) DESC, id DESC
      LIMIT ?`,
    [MAX_ROWS]
  );
  res.json({ data: rows.map(row => serializeRow(row, false)) });
}));

// ===== 單筆（含 snapshot）=====
router.get('/plans/:id', handle(async (req, res) => {
  const row = await dbGet('SELECT * FROM loadsim_plans WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: '找不到這份存檔' });
  res.json({ data: serializeRow(row, true) });
}));

// ===== 新增 =====
router.post('/plans', handle(async (req, res) => {
  const body = req.body || {};
  const name = sanitizeName(body.name);
  if (!name) return res.status(422).json({ error: '請輸入存檔名稱' });

  const snapshot = sanitizeSnapshot(body.snapshot);
  if (!snapshot) return res.status(422).json({ error: '存檔內容格式不正確（缺少貨物清單）' });
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SNAPSHOT_BYTES) {
    return res.status(422).json({ error: '存檔內容太大（上限 2 MB）' });
  }

  const summary = summarize(snapshot, body.summary);
  const actor = actorOf(req);
  const result = await dbRun(
    `INSERT INTO loadsim_plans
       (name, uld_code, plate_type, item_count, board_count, total_kg, gross_kg,
        utilization_pct, saved_at, snapshot, created_by, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [name, ...snapshotColumns(snapshot, summary), actor, actor]
  );
  const row = await dbGet('SELECT * FROM loadsim_plans WHERE id = ?', [result.lastID]);
  writeAuditLog(req, 'loadsim.plan.create', result.lastID, `${name}（${summary.boardCount} 件／${summary.totalKg} kg）`);
  res.status(201).json({ data: serializeRow(row, true) });
}));

// ===== 更新（只送 name 就是改名；送 snapshot 就是覆蓋內容）=====
router.put('/plans/:id', handle(async (req, res) => {
  const id = Number(req.params.id);
  const row = await dbGet('SELECT * FROM loadsim_plans WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '找不到這份存檔' });

  const body = req.body || {};
  const name = body.name === undefined ? row.name : sanitizeName(body.name);
  if (!name) return res.status(422).json({ error: '請輸入存檔名稱' });

  let snapshot = null;
  if (body.snapshot !== undefined) {
    snapshot = sanitizeSnapshot(body.snapshot);
    if (!snapshot) return res.status(422).json({ error: '存檔內容格式不正確（缺少貨物清單）' });
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SNAPSHOT_BYTES) {
      return res.status(422).json({ error: '存檔內容太大（上限 2 MB）' });
    }
  }

  const actor = actorOf(req);
  if (snapshot) {
    const summary = summarize(snapshot, body.summary);
    await dbRun(
      `UPDATE loadsim_plans
          SET name = ?, uld_code = ?, plate_type = ?, item_count = ?, board_count = ?,
              total_kg = ?, gross_kg = ?, utilization_pct = ?, saved_at = ?, snapshot = ?,
              updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [name, ...snapshotColumns(snapshot, summary), actor, id]
    );
  } else {
    await dbRun(
      'UPDATE loadsim_plans SET name = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, actor, id]
    );
  }

  const updated = await dbGet('SELECT * FROM loadsim_plans WHERE id = ?', [id]);
  writeAuditLog(req, 'loadsim.plan.update', id, name);
  res.json({ data: serializeRow(updated, true) });
}));

// ===== 刪除 =====
router.delete('/plans/:id', handle(async (req, res) => {
  const id = Number(req.params.id);
  const row = await dbGet('SELECT * FROM loadsim_plans WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '找不到這份存檔' });
  await dbRun('DELETE FROM loadsim_plans WHERE id = ?', [id]);
  writeAuditLog(req, 'loadsim.plan.remove', id, row.name);
  res.json({ ok: true, id });
}));

// 統一的錯誤回應（Express 4 不會自動攔 async 例外，故用 handle() 收集到這裡）
router.use((err, req, res, next) => {
  console.error('[loadsim] API 錯誤:', err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '伺服器錯誤' });
});

module.exports = router;


