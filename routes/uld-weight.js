// ===== ULD 夾重系統 API（Admin / Staff 限定） =====
// 一張「夾重表」= 一次夾重作業：多個收貨單位（P/X 板、B 散貨）× 多票 MAWB。
// 重量算法與前端共用同一支 public/js/uldweight/calc.js（避免前後端算出不同答案）。
const express = require('express');
const path = require('path');
const { pathToFileURL } = require('url');
const multer = require('multer');
const archiver = require('archiver');
// OOM 防護：須早於任何 ExcelJS 讀檔載入（WPS 檔的 defined-name 巨量範圍會吃爆記憶體，見 scripts/xls-exceljs-guard.js）
require('../scripts/xls-exceljs-guard');
const ExcelJS = require('exceljs');
const { resolveCellValue, formatLocalDateTime, sanitizeFileLabel } = require('../scripts/xls-utils');
const db = require('../db/database');
const router = express.Router();

// 延遲載入 ESM 計算核心（專案 package.json 不是 ESM，故用動態 import）
const calcReady = import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'calc.js')).href);
// 延遲載入 ESM 的 RCL 磅單解析（前後端共用同一支，避免「後端解析一套、畫面顯示另一套」）
const rclReady = import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'rcl-parse.js')).href);
// 延遲載入 ESM 的版本比對（V3；前後端共用，避免「後端說有改、畫面說沒改」）
const versionReady = import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'version-diff.js')).href);

const SHEET_NO_PREFIX = 'WGT-';
const TERMINALS = ['HACTL', 'AAT', 'CPSL'];
const PREDECL_TYPES = ['P', 'X', 'B'];
const LIH_TYPES = ['N', 'UN3481', 'UN3091'];
const SQUEEZE_MODES = ['weight', 'pcs', 'equal', 'manual'];
const TAIL_MODES = ['adjust_largest', 'equal', 'none'];

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
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// 寫入審計日誌（比照打板計劃）
function writeAuditLog(req, action, targetType, targetId, detail) {
  const user = (req.session && req.session.user) || {};
  db.run(
    `INSERT INTO audit_log (actor_user_id, actor_display, action, target_type, target_id, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user.user_id || null, user.display_name || user.user_id || null, action, targetType, String(targetId || ''), detail || null],
    (err) => { if (err) console.error('[uld-weight] audit_log 寫入失敗:', err.message); }
  );
}

// ===== 共用工具 =====
function str(value, max = 200) {
  if (value == null) return '';
  return String(value).trim().slice(0, max);
}
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function intNum(value) {
  return Math.max(0, Math.trunc(num(value)));
}
function pickUpper(value, list, fallback) {
  const s = str(value, 20).toUpperCase();
  return list.includes(s) ? s : fallback;
}
function pickLower(value, list, fallback) {
  const s = str(value, 20).toLowerCase();
  return list.includes(s) ? s : fallback;
}

// 產生夾重表編號 WGT-YYYYMMDD-XX
async function generateSheetNo() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `${SHEET_NO_PREFIX}${yyyy}${mm}${dd}-`;
  const row = await dbGet(
    'SELECT sheet_no FROM uld_weight_sheets WHERE sheet_no LIKE ? ORDER BY id DESC LIMIT 1',
    [`${prefix}%`]
  );
  let seq = 1;
  if (row && row.sheet_no) {
    const lastSeq = parseInt(String(row.sheet_no).split('-').pop(), 10);
    if (!Number.isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(2, '0')}`;
}

// 表頭正規化
function normalizeHeader(body = {}) {
  return {
    sheet_date: str(body.sheet_date, 20) || new Date().toISOString().slice(0, 10),
    terminal: pickUpper(body.terminal, TERMINALS, 'CPSL'),
    flight_no: str(body.flight_no, 30).toUpperCase(),
    flight_date: str(body.flight_date, 20),
    round_px: num(body.round_px) > 0 ? num(body.round_px) : 1,
    round_b: num(body.round_b) > 0 ? num(body.round_b) : 1,
    tail_mode: pickLower(body.tail_mode, TAIL_MODES, 'adjust_largest'),
    // W5：磅差警示門檻（%／kg 需「同時」超過才提示 DIFF_TOO_BIG）；0 或未填 → 回預設 2% / 100kg
    diff_warn_pct: num(body.diff_warn_pct) > 0 ? Math.min(num(body.diff_warn_pct), 100) : 2,
    diff_warn_kg: num(body.diff_warn_kg) > 0 ? Math.min(num(body.diff_warn_kg), 100000) : 100,
    // R2：多票夾重比例的上下限（%；0 或未填 = 該方向不限）
    clamp_min_pct: num(body.clamp_min_pct) > 0 ? Math.min(num(body.clamp_min_pct), 100) : 0,
    clamp_max_pct: num(body.clamp_max_pct) > 0 ? Math.min(num(body.clamp_max_pct), 100) : 0,
    handler: str(body.handler, 60),
    remark: str(body.remark, 500)
  };
}

// 收貨單位 + 明細正規化
function normalizeUnit(raw = {}, idx = 0) {
  const kind = str(raw.kind, 10).toUpperCase() === 'BULK' ? 'BULK' : 'ULD';
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 300).map((it, i) => ({
    // R3：明細 diff 更新用（前端帶回既有列的 id；null／不存在＝新增）
    id: it.id ? (Number(it.id) || null) : null,
    seq: i,
    mawb: str(it.mawb, 40),
    mawb_record_id: it.mawb_record_id ? (Number(it.mawb_record_id) || null) : null,
    port: str(it.port, 20).toUpperCase(),
    pcs: intNum(it.pcs),
    declared_weight: Math.max(0, num(it.declared_weight)),
    is_squeeze: it.is_squeeze ? 1 : 0,
    squeeze_ratio: (it.squeeze_ratio == null || it.squeeze_ratio === '') ? null : Math.max(0, num(it.squeeze_ratio)),
    lih_type: pickUpper(it.lih_type, LIH_TYPES, 'N')
  }));
  return {
    // R3：收貨單位的既有 DB id（null＝新增）
    id: raw.id ? (Number(raw.id) || null) : null,
    seq: idx,
    kind,
    uld_number: kind === 'BULK' ? '' : str(raw.uld_number, 30).toUpperCase(),
    bulk_ref: kind === 'BULK' ? str(raw.bulk_ref || raw.uld_number, 40) : '',
    rcl_no: str(raw.rcl_no, 40).toUpperCase(),
    contour_code: kind === 'BULK' ? '' : str(raw.contour_code, 12).toUpperCase(),
    port: str(raw.port, 20).toUpperCase(),
    pcs: intNum(raw.pcs),
    tare_weight: kind === 'BULK' ? 0 : num(raw.tare_weight),
    rcl_gross_weight: Math.max(0, num(raw.rcl_gross_weight)),
    material_weight: Math.max(0, num(raw.material_weight)),
    lih_type: pickUpper(raw.lih_type, LIH_TYPES, 'N'),
    predecl_type: pickUpper(raw.predecl_type, PREDECL_TYPES, kind === 'BULK' ? 'B' : 'P'),
    squeeze_mode: pickLower(raw.squeeze_mode, SQUEEZE_MODES, 'weight'),
    items
  };
}

function normalizeSheetPayload(body = {}) {
  const ulds = (Array.isArray(body.ulds) ? body.ulds : []).slice(0, 100).map(normalizeUnit);
  return { header: normalizeHeader(body), ulds };
}


// 清單列的彙總查詢（板數 / 散貨數 / RCL 總重 / 淨重 / 磅差）
const SHEET_LIST_SQL = `
  SELECT s.*,
    (SELECT COUNT(*) FROM uld_weight_ulds u WHERE u.sheet_id = s.id) AS uld_count,
    (SELECT COUNT(*) FROM uld_weight_ulds u WHERE u.sheet_id = s.id AND u.kind = 'BULK') AS bulk_count,
    (SELECT IFNULL(SUM(u.rcl_gross_weight), 0) FROM uld_weight_ulds u WHERE u.sheet_id = s.id) AS rcl_total,
    (SELECT IFNULL(SUM(u.net_weight), 0) FROM uld_weight_ulds u WHERE u.sheet_id = s.id) AS net_total,
    (SELECT IFNULL(SUM(u.diff_weight), 0) FROM uld_weight_ulds u WHERE u.sheet_id = s.id) AS diff_total,
    (SELECT COUNT(*) FROM uld_weight_items i
       JOIN uld_weight_ulds u2 ON u2.id = i.uld_id
      WHERE u2.sheet_id = s.id) AS item_count
  FROM uld_weight_sheets s`;

function serializeSheetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sheet_no: row.sheet_no,
    sheet_date: row.sheet_date || '',
    terminal: row.terminal || '',
    flight_no: row.flight_no || '',
    flight_date: row.flight_date || '',
    round_px: num(row.round_px) > 0 ? num(row.round_px) : 1,
    round_b: num(row.round_b) > 0 ? num(row.round_b) : 1,
    tail_mode: row.tail_mode || 'adjust_largest',
    diff_warn_pct: num(row.diff_warn_pct) > 0 ? num(row.diff_warn_pct) : 2,
    diff_warn_kg: num(row.diff_warn_kg) > 0 ? num(row.diff_warn_kg) : 100,
    // R2：比例上下限（0 = 不限）
    clamp_min_pct: num(row.clamp_min_pct) > 0 ? num(row.clamp_min_pct) : 0,
    clamp_max_pct: num(row.clamp_max_pct) > 0 ? num(row.clamp_max_pct) : 0,
    handler: row.handler || '',
    remark: row.remark || '',
    status: row.status || 'draft',
    created_by: row.created_by || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    uld_count: row.uld_count != null ? row.uld_count : 0,
    bulk_count: row.bulk_count != null ? row.bulk_count : 0,
    item_count: row.item_count != null ? row.item_count : 0,
    rcl_total: num(row.rcl_total),
    net_total: num(row.net_total),
    diff_total: num(row.diff_total)
  };
}

// 讀取整張夾重表（含即時重算結果）
async function loadSheetDetail(id) {
  const calc = await calcReady;
  const sheet = await dbGet('SELECT * FROM uld_weight_sheets WHERE id = ?', [id]);
  if (!sheet) return null;

  const ulds = await dbAll(
    'SELECT * FROM uld_weight_ulds WHERE sheet_id = ? ORDER BY seq ASC, id ASC',
    [id]
  );
  let items = [];
  if (ulds.length) {
    const placeholders = ulds.map(() => '?').join(',');
    items = await dbAll(
      `SELECT * FROM uld_weight_items WHERE uld_id IN (${placeholders}) ORDER BY seq ASC, id ASC`,
      ulds.map(u => u.id)
    );
  }
  const byUld = new Map();
  items.forEach(it => {
    if (!byUld.has(it.uld_id)) byUld.set(it.uld_id, []);
    byUld.get(it.uld_id).push(it);
  });

  const result = calc.uldComputeSheet({
    round_px: sheet.round_px,
    round_b: sheet.round_b,
    tail_mode: sheet.tail_mode,
    diff_warn_pct: sheet.diff_warn_pct,
    diff_warn_kg: sheet.diff_warn_kg,
    clamp_min_pct: sheet.clamp_min_pct,
    clamp_max_pct: sheet.clamp_max_pct,
    ulds: ulds.map(u => ({ ...u, uid: `u${u.id}`, items: byUld.get(u.id) || [] }))
  });

  return {
    ...serializeSheetRow(sheet),
    ulds: result.units,
    mawbs: result.mawbs,
    issues: result.issues,
    totals: result.totals
  };
}

// ===== V3：夾重表歷史版本（快照 ＋ 異動比對）=====
// 每張表保留最近 VERSION_KEEP 版（避免 DB 無限成長）；版本內容只存「輸入值」，不含 calc 的重算結果，
// 讓版本檔小、diff 也只反映使用者真正改過的欄位。
const VERSION_KEEP = 30;

function safeJsonParse(text, fallback = null) {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed == null ? fallback : parsed;
  } catch (err) {
    return fallback;
  }
}

// loadSheetDetail() 的結果 → 版本快照（只挑輸入欄位）
function buildSnapshot(detail) {
  if (!detail) return { header: {}, units: [] };
  return {
    header: {
      sheet_date: detail.sheet_date || '',
      terminal: detail.terminal || '',
      flight_no: detail.flight_no || '',
      flight_date: detail.flight_date || '',
      round_px: num(detail.round_px),
      round_b: num(detail.round_b),
      tail_mode: detail.tail_mode || '',
      diff_warn_pct: num(detail.diff_warn_pct),
      diff_warn_kg: num(detail.diff_warn_kg),
      clamp_min_pct: num(detail.clamp_min_pct),
      clamp_max_pct: num(detail.clamp_max_pct),
      handler: detail.handler || '',
      remark: detail.remark || '',
      status: detail.status || 'draft'
    },
    units: (detail.ulds || []).map(unit => ({
      id: unit.id != null ? Number(unit.id) : null,
      seq: unit.seq != null ? Number(unit.seq) : null,
      kind: unit.kind || 'ULD',
      uld_number: unit.uld_number || '',
      bulk_ref: unit.bulk_ref || '',
      rcl_no: unit.rcl_no || '',
      contour_code: unit.contour_code || '',
      port: unit.port || '',
      pcs: num(unit.pcs),
      tare_weight: num(unit.tare_weight),
      rcl_gross_weight: num(unit.rcl_gross_weight),
      material_weight: num(unit.material_weight),
      lih_type: unit.lih_type || 'N',
      predecl_type: unit.predecl_type || '',
      squeeze_mode: unit.squeeze_mode || '',
      net_weight: num(unit.net_weight),
      diff_weight: num(unit.diff_weight),
      items: (unit.items || []).map(item => ({
        id: item.id != null ? Number(item.id) : null,
        seq: item.seq != null ? Number(item.seq) : null,
        mawb: item.mawb || '',
        mawb_record_id: item.mawb_record_id != null ? Number(item.mawb_record_id) : null,
        port: item.port || '',
        pcs: num(item.pcs),
        declared_weight: num(item.declared_weight),
        final_weight: num(item.final_weight),
        is_squeeze: item.is_squeeze ? 1 : 0,
        squeeze_ratio: item.squeeze_ratio == null ? null : num(item.squeeze_ratio),
        lih_type: item.lih_type || 'N'
      }))
    }))
  };
}

// 建立一個版本（回傳 version_no；內容沒變的重複儲存回 null 不記）
// action：create / save / lock / unlock / apply / sync_bookings / duplicate
async function saveSheetVersion(req, sheetId, options = {}) {
  const action = str(options.action, 30) || 'save';
  const note = str(options.note, 200);
  const detail = await loadSheetDetail(sheetId);
  if (!detail) return null;
  const diffMod = await versionReady;
  const snapshot = buildSnapshot(detail);
  const snapshotJson = JSON.stringify(snapshot);
  const last = await dbGet(
    'SELECT id, version_no, snapshot FROM uld_weight_versions WHERE sheet_id = ? ORDER BY version_no DESC LIMIT 1',
    [sheetId]
  );
  // 「儲存」但內容與上一版完全相同 → 不留新版本（避免版本列表被重複儲存洗版）；
  // 其他事件（create／lock／unlock／apply／sync_bookings／duplicate）即使內容相同也要留紀錄
  if (last && last.snapshot === snapshotJson && action === 'save') return null;
  const versionNo = (last ? Number(last.version_no) : 0) + 1;
  const user = (req.session && req.session.user) || {};
  await dbRun(
    `INSERT INTO uld_weight_versions (sheet_id, version_no, action, status, note, snapshot, summary, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sheetId, versionNo, action, detail.status || '', note, snapshotJson,
      JSON.stringify(diffMod.uldSnapshotSummary(snapshot)), user.user_id || null
    ]
  );
  if (versionNo > VERSION_KEEP) {
    await dbRun(
      'DELETE FROM uld_weight_versions WHERE sheet_id = ? AND version_no <= ?',
      [sheetId, versionNo - VERSION_KEEP]
    );
  }
  return versionNo;
}

function serializeVersionRow(row, withSnapshot = false) {
  if (!row) return null;
  const out = {
    id: row.id,
    version_no: row.version_no,
    action: row.action || 'save',
    status: row.status || '',
    note: row.note || '',
    summary: safeJsonParse(row.summary, {}),
    created_by: row.created_by || '',
    created_at: row.created_at || ''
  };
  if (withSnapshot) out.snapshot = safeJsonParse(row.snapshot, { header: {}, units: [] });
  return out;
}

// ===== Booking Record（打板計劃的 MAWB 主檔）：夾重表的 MAWB 可直接挑選 =====
// 沿用 routes/pallet.js 的 BOOKING_SELECT_SQL／serializeBooking 概念，只取夾重要用到的欄位；
// 這裡只讀不寫（夾重表回寫 mawb_records 是 Phase 2 的 W2，尚未做）。
const BOOKING_SELECT_SQL = `
  SELECT b.id, b.mawb, b.hawb, b.client, b.dest, b.pcs, b.gross_weight,
         b.volume_weight, b.cbm, b.spl, b.remark,
         strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at) AS created_at,
         strftime('%Y-%m-%dT%H:%M:%fZ', b.updated_at) AS updated_at
    FROM mawb_records b`;

function serializeBooking(row) {
  return {
    id: row.id,
    mawb: row.mawb || '',
    hawb: row.hawb || '',
    client: row.client || '',
    dest: row.dest || '',
    pcs: intNum(row.pcs),
    gross_weight: num(row.gross_weight),
    volume_weight: num(row.volume_weight),
    cbm: num(row.cbm),
    spl: row.spl || '',
    remark: row.remark || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

// ===== GET /api/uld-weight/bookings?search=&dest=&limit= =====
// 「新增 MAWB」的候選清單：輸入即篩選（search 比對 MAWB／HAWB／客戶／DEST／SPL），
// 依新增順序由新到舊，預設 50 筆、上限 500 筆。
router.get('/bookings', async (req, res) => {
  try {
    const search = str(req.query.search, 60);
    const dest = str(req.query.dest, 20).toUpperCase();
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 500);

    const params = [];
    let sql = `${BOOKING_SELECT_SQL} WHERE 1=1`;
    if (search) {
      sql += ' AND (b.mawb LIKE ? OR b.hawb LIKE ? OR b.client LIKE ? OR b.dest LIKE ? OR b.spl LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    if (dest) {
      sql += ' AND b.dest = ?';
      params.push(dest);
    }
    sql += ' ORDER BY b.id DESC LIMIT ?';
    params.push(limit);

    const rows = await dbAll(sql, params);
    res.json({ data: rows.map(serializeBooking) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/uld-weight/sheets?status=&search= =====
router.get('/sheets', async (req, res) => {
  try {
    const status = str(req.query.status, 20);
    const search = str(req.query.search, 60);
    const params = [];
    let sql = `${SHEET_LIST_SQL} WHERE 1=1`;
    if (status) {
      sql += ' AND s.status = ?';
      params.push(status);
    }
    if (search) {
      sql += ' AND (s.sheet_no LIKE ? OR s.flight_no LIKE ? OR s.handler LIKE ? OR s.terminal LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY s.id DESC LIMIT 200';
    const rows = await dbAll(sql, params);
    res.json({ data: rows.map(serializeSheetRow) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /api/uld-weight/sheets（新增空表）=====
router.post('/sheets', async (req, res) => {
  try {
    const header = normalizeHeader(req.body || {});
    const sheetNo = await generateSheetNo();
    const user = (req.session && req.session.user) || {};
    const result = await dbRun(
      `INSERT INTO uld_weight_sheets
        (sheet_no, sheet_date, terminal, flight_no, flight_date, round_px, round_b, tail_mode,
         diff_warn_pct, diff_warn_kg, clamp_min_pct, clamp_max_pct, handler, remark, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [
        sheetNo, header.sheet_date, header.terminal, header.flight_no, header.flight_date,
        header.round_px, header.round_b, header.tail_mode,
        header.diff_warn_pct, header.diff_warn_kg, header.clamp_min_pct, header.clamp_max_pct,
        header.handler, header.remark,
        user.user_id || null
      ]
    );
    writeAuditLog(req, 'uld_weight.sheet.create', 'uld_weight_sheet', result.lastID, `新增夾重表 ${sheetNo}`);
    // V3：第一版（create）
    await saveSheetVersion(req, result.lastID, { action: 'create' });
    const detail = await loadSheetDetail(result.lastID);
    res.status(201).json({ data: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== V2：批次 PDF（多張夾重表打包 ZIP）=====
// 一次最多幾張（每份 A4 報表約 40KB，50 張也只有 ~2MB，全部在記憶體產生，不落暫存檔）
const BATCH_PDF_LIMIT = 50;

// 產一份夾重表 PDF 的位元組：資料一律來自 loadSheetDetail()（算法仍在 calc.js，這裡只排版）
async function buildReportPdfBytes(detail) {
  const calc = await calcReady;
  const { buildUldWeightReportPdf } = require('../scripts/uld-weight-report-pdf');
  // issueText 由 calc.uldIssueText 提供（不在此另寫一份中文對照表）
  return buildUldWeightReportPdf(detail, { issueText: calc.uldIssueText, lihLabel: calc.uldLihLabel });
}

// 記憶體內打包 ZIP（archiver 是 Transform stream：收 'data' 到 'end' 即完成，不需要暫存檔）
// 注意：pdf-lib 的 doc.save() 回傳 Uint8Array，archiver.append() 只吃 Buffer／Stream → 一定要先 Buffer.from()
function zipBuffers(entries) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', chunk => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    entries.forEach(entry => {
      archive.append(Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes), { name: entry.name });
    });
    archive.finalize();
  });
}

// ZIP 檔名用的時間戳（本地時區，不可用 toISOString：UTC+8 會少一天／時區錯誤）
function batchStamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

// ZIP 內的清單（manifest.txt，UTF-8 加 BOM 讓 Windows 記事本也讀得對）
function buildBatchManifest(rows, failures, generatedAt) {
  const lines = [
    'ULD 夾重表批次匯出',
    `產生時間：${generatedAt}`,
    `張數：${rows.length + failures.length}（成功 ${rows.length} / 失敗 ${failures.length}）`,
    ''
  ];
  rows.forEach((row, index) => {
    const status = row.status === 'locked' ? '已鎖定' : '草稿';
    lines.push(`${index + 1}. ${row.sheet_no}　${row.sheet_date || '-'}　${row.terminal || '-'}`
      + `　${row.flight_no || '-'}　${status}　RCL ${num(row.rcl_total)} kg`
      + `　淨重 ${num(row.net_total)} kg　磅差 ${num(row.diff_total)} kg`);
  });
  if (failures.length) {
    lines.push('', '失敗（未產生 PDF）：');
    failures.forEach(item => lines.push(`- ${item.sheet_no}：${item.error}`));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// ===== GET /api/uld-weight/sheets/batch-pdf?ids=1,2,3（或 status=&search=）=====
// 一定要宣告在 GET /sheets/:id 之前：否則 'batch-pdf' 會被當成 :id（parseInt → NaN → 400）。
router.get('/sheets/batch-pdf', async (req, res) => {
  try {
    const idsRaw = str(req.query.ids, 4000);
    const ids = [];
    idsRaw.split(',').forEach(token => {
      const id = parseInt(token.trim(), 10);
      if (id > 0 && !ids.includes(id)) ids.push(id);
    });

    let rows;
    if (ids.length) {
      if (ids.length > BATCH_PDF_LIMIT) {
        return res.status(400).json({ error: `一次最多 ${BATCH_PDF_LIMIT} 張夾重表` });
      }
      const placeholders = ids.map(() => '?').join(',');
      rows = await dbAll(
        `${SHEET_LIST_SQL} WHERE s.id IN (${placeholders}) ORDER BY s.sheet_no ASC, s.id ASC`,
        ids
      );
    } else {
      // 沒有指定 ids → 依目前清單的篩選條件（status／search），最多 BATCH_PDF_LIMIT 張
      const status = str(req.query.status, 20);
      const search = str(req.query.search, 60);
      const params = [];
      let sql = `${SHEET_LIST_SQL} WHERE 1=1`;
      if (status) {
        sql += ' AND s.status = ?';
        params.push(status);
      }
      if (search) {
        sql += ' AND (s.sheet_no LIKE ? OR s.flight_no LIKE ? OR s.handler LIKE ? OR s.terminal LIKE ?)';
        const like = `%${search}%`;
        params.push(like, like, like, like);
      }
      sql += ' ORDER BY s.sheet_no ASC, s.id ASC LIMIT ?';
      params.push(BATCH_PDF_LIMIT);
      rows = await dbAll(sql, params);
    }

    if (!rows.length) return res.status(404).json({ error: '沒有符合條件的夾重表' });

    const entries = [];
    const done = [];
    const failures = [];
    const usedNames = new Set(['manifest.txt']);
    // 逐一產生（不並行：每個 PDF 都要嵌入 CJK 子集，同時跑反而更慢也更吃記憶體）
    for (const row of rows) {
      try {
        const detail = await loadSheetDetail(row.id);
        if (!detail) throw new Error('找不到夾重表');
        const bytes = await buildReportPdfBytes(detail);
        // ZIP 內的檔名：跳脫 Windows 非法字元；同一張表號重複時補 -2／-3（ZIP 允許同名但會互相蓋掉）
        const base = sanitizeFileLabel(row.sheet_no || `uld-weight-${row.id}`, { fallback: `uld-weight-${row.id}` });
        let name = `${base}.pdf`;
        let seq = 2;
        while (usedNames.has(name.toLowerCase())) {
          name = `${base}-${seq}.pdf`;
          seq += 1;
        }
        usedNames.add(name.toLowerCase());
        entries.push({ name, bytes });
        done.push(row);
      } catch (err) {
        console.error(`[uld-weight] 批次 PDF 失敗（${row.sheet_no}）:`, err.message);
        failures.push({ sheet_no: row.sheet_no || `#${row.id}`, error: err.message });
      }
    }
    if (!entries.length) {
      const detailText = failures.map(f => `${f.sheet_no}（${f.error}）`).join('；');
      return res.status(500).json({ error: `批次 PDF 全部失敗：${detailText}` });
    }

    const zipBytes = await zipBuffers([
      {
        name: 'manifest.txt',
        bytes: Buffer.from(buildBatchManifest(done, failures, formatLocalDateTime(new Date())), 'utf8')
      },
      ...entries
    ]);
    const zipName = `uld-weight-batch-${batchStamp()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Length', zipBytes.length);
    res.setHeader('Cache-Control', 'no-store');
    // 前端用來提示「成功幾張／失敗幾張」（單張失敗不會讓整批失敗）
    res.setHeader('X-Uld-Weight-Pdf-Count', String(entries.length));
    res.setHeader('X-Uld-Weight-Pdf-Failed', String(failures.length));
    res.end(zipBytes);
  } catch (err) {
    console.error('[uld-weight] 產生批次 PDF 失敗:', err.message);
    res.status(500).json({ error: `產生批次 PDF 失敗：${err.message}` });
  }
});

// ===== GET /api/uld-weight/sheets/:id =====
router.get('/sheets/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const detail = await loadSheetDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到夾重表' });
    res.json({ data: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/uld-weight/sheets/:id/versions（V3：版本清單，新到舊）=====
router.get('/sheets/:id/versions', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const sheet = await dbGet('SELECT id FROM uld_weight_sheets WHERE id = ?', [id]);
    if (!sheet) return res.status(404).json({ error: '找不到夾重表' });
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);
    const rows = await dbAll(
      `SELECT id, version_no, action, status, note, summary, created_by,
              strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
         FROM uld_weight_versions
        WHERE sheet_id = ?
        ORDER BY version_no DESC
        LIMIT ?`,
      [id, limit]
    );
    res.json({ data: rows.map(row => serializeVersionRow(row)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/uld-weight/sheets/:id/versions/diff?from=<id>&to=<id|省略>（V3）=====
// 必須宣告在 /versions/:versionId 之前（否則 'diff' 會被當成 versionId）。
// to 省略（或 0）＝與「目前內容」比較；from 必填。
router.get('/sheets/:id/versions/diff', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const detail = await loadSheetDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到夾重表' });
    const fromId = parseInt(req.query.from, 10) || 0;
    const toId = parseInt(req.query.to, 10) || 0;
    if (!fromId) return res.status(400).json({ error: '請指定要比較的版本（from）' });

    const fromRow = await dbGet(
      `SELECT id, version_no, action, status, note, summary, snapshot, created_by,
              strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
         FROM uld_weight_versions WHERE id = ? AND sheet_id = ?`,
      [fromId, id]
    );
    if (!fromRow) return res.status(404).json({ error: '找不到指定的版本（from）' });
    let toRow = null;
    if (toId) {
      toRow = await dbGet(
        `SELECT id, version_no, action, status, note, summary, snapshot, created_by,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
           FROM uld_weight_versions WHERE id = ? AND sheet_id = ?`,
        [toId, id]
      );
      if (!toRow) return res.status(404).json({ error: '找不到指定的版本（to）' });
    }

    const diffMod = await versionReady;
    const before = safeJsonParse(fromRow.snapshot, { header: {}, units: [] });
    const after = toRow ? safeJsonParse(toRow.snapshot, { header: {}, units: [] }) : buildSnapshot(detail);
    res.json({
      data: diffMod.uldDiffSnapshots(before, after),
      from: serializeVersionRow(fromRow),
      to: toRow ? serializeVersionRow(toRow) : { id: 0, version_no: 0, action: 'current', status: detail.status || '' }
    });
  } catch (err) {
    console.error('[uld-weight] 版本比對失敗:', err.message);
    res.status(500).json({ error: `版本比對失敗：${err.message}` });
  }
});

// ===== GET /api/uld-weight/sheets/:id/versions/:versionId（V3：單一版本快照）=====
router.get('/sheets/:id/versions/:versionId', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const versionId = parseInt(req.params.versionId, 10);
    if (!id || !versionId) return res.status(400).json({ error: '無效的版本 ID' });
    const row = await dbGet(
      `SELECT id, version_no, action, status, note, summary, snapshot, created_by,
              strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
         FROM uld_weight_versions WHERE id = ? AND sheet_id = ?`,
      [versionId, id]
    );
    if (!row) return res.status(404).json({ error: '找不到指定的版本' });
    res.json({ data: serializeVersionRow(row, true) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/uld-weight/sheets/:id/loading-sheet.pdf（U3）=====
// 單板 Loading Sheet（A4 直式，MAWB／DEST／PCS／WT）；?unit=<uld_id> 只出那一板，
// 省略 unit 則每一板各一頁（合成一份）。資料一律取 loadSheetDetail()（不在這裡算重量）。
router.get('/sheets/:id/loading-sheet.pdf', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const detail = await loadSheetDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到夾重表' });
    const unitId = req.query.unit == null || req.query.unit === '' ? null : parseInt(req.query.unit, 10);
    if (unitId != null && !Number.isFinite(unitId)) return res.status(400).json({ error: '無效的 unit 參數' });
    if (unitId != null && !(detail.ulds || []).some(u => Number(u.id) === unitId)) {
      return res.status(404).json({ error: '這張夾重表沒有這個收貨單位' });
    }
    const { buildUldWeightLoadingSheetPdf } = require('../scripts/uld-weight-report-pdf');
    const bytes = await buildUldWeightLoadingSheetPdf(detail, { unitId });
    const unitPart = unitId == null ? '' : `-${unitId}`;
    const fileName = `${(detail.sheet_no || `uld-weight-${id}`).replace(/[^\w.-]+/g, '-')}${unitPart}-loading.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  } catch (err) {
    console.error('[uld-weight] 產生 Loading Sheet 失敗:', err.message);
    res.status(500).json({ error: `產生 Loading Sheet 失敗：${err.message}` });
  }
});

// ===== GET /api/uld-weight/sheets/:id/report.pdf（R1）=====
// server 端固定排版的 PDF（A4 直式）：草稿與鎖定都能下載；資料一律取 loadSheetDetail()
// 的「已重算」結果（不在這裡另寫算法，calc.js 仍是唯一來源）。
router.get('/sheets/:id/report.pdf', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const detail = await loadSheetDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到夾重表' });
    const bytes = await buildReportPdfBytes(detail);
    const fileName = `${(detail.sheet_no || `uld-weight-${id}`).replace(/[^\w.-]+/g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  } catch (err) {
    console.error('[uld-weight] 產生 PDF 失敗:', err.message);
    res.status(500).json({ error: `產生 PDF 失敗：${err.message}` });
  }
});

// ===== PUT /api/uld-weight/sheets/:id（整份儲存：表頭 + 所有收貨單位 + 明細）=====
router.put('/sheets/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const existing = await dbGet('SELECT * FROM uld_weight_sheets WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '找不到夾重表' });
    if (existing.status === 'locked') {
      return res.status(409).json({ error: '夾重表已鎖定，請先解鎖再修改' });
    }

    const calc = await calcReady;
    const payload = normalizeSheetPayload(req.body || {});

    // 先重算一次；語意錯誤（負重 / 未勾夾重 / 目標過小）不允許儲存
    const computed = calc.uldComputeSheet({
      round_px: payload.header.round_px,
      round_b: payload.header.round_b,
      tail_mode: payload.header.tail_mode,
      diff_warn_pct: payload.header.diff_warn_pct,
      diff_warn_kg: payload.header.diff_warn_kg,
      clamp_min_pct: payload.header.clamp_min_pct,
      clamp_max_pct: payload.header.clamp_max_pct,
      ulds: payload.ulds.map((u, i) => ({
        ...u,
        uid: `i${i}`,
        items: u.items.map((it, j) => ({ ...it, id: j }))
      }))
    });
    const blocked = computed.issues.filter(i => i.level === 'error');
    if (blocked.length) {
      return res.status(422).json({
        error: `無法儲存：${blocked.map(i => `${i.label || ''} ${calc.uldIssueText(i)}`.trim()).join('；')}`,
        issues: computed.issues
      });
    }

    const h = payload.header;
    await dbRun(
      `UPDATE uld_weight_sheets
          SET sheet_date = ?, terminal = ?, flight_no = ?, flight_date = ?,
              round_px = ?, round_b = ?, tail_mode = ?, diff_warn_pct = ?, diff_warn_kg = ?,
              clamp_min_pct = ?, clamp_max_pct = ?,
              handler = ?, remark = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        h.sheet_date, h.terminal, h.flight_no, h.flight_date,
        h.round_px, h.round_b, h.tail_mode, h.diff_warn_pct, h.diff_warn_kg,
        h.clamp_min_pct, h.clamp_max_pct,
        h.handler, h.remark, id
      ]
    );

    // ===== 明細改用 diff 更新（R3）=====
    // 舊做法是「先刪後插」，每次儲存所有 uld_weight_ulds／uld_weight_items 的 id 都會變（
    // 前端無法追蹤，且明細一多就整批重寫）。改成以 id 比對：
    //   payload 有 id 且屬於這張表 → UPDATE；沒有 id（或找不到）→ INSERT；DB 有但 payload 沒有 → DELETE
    // 註：前端的項目 id 是 null（新加入的列）→ 一定走 INSERT，儲存後由回應帶回新 id。
    const oldUnits = await dbAll(
      'SELECT id FROM uld_weight_ulds WHERE sheet_id = ? ORDER BY seq ASC, id ASC', [id]
    );
    const oldUnitIds = new Set(oldUnits.map(u => Number(u.id)));
    const keptUnitIds = new Set();

    const unitIdFor = async (unit, index) => {
      const payloadId = unit.id ? Number(unit.id) : null;
      const calcUnit = computed.units[index] ? computed.units[index].calc : null;
      const values = [
        index, unit.kind, unit.uld_number, unit.bulk_ref, unit.rcl_no, unit.contour_code, unit.port, unit.pcs,
        unit.tare_weight, unit.rcl_gross_weight, unit.material_weight, unit.lih_type, unit.predecl_type,
        unit.squeeze_mode, calcUnit ? calcUnit.finalSum : 0, calcUnit ? calcUnit.diff : 0
      ];
      if (payloadId && oldUnitIds.has(payloadId)) {
        await dbRun(
          `UPDATE uld_weight_ulds
              SET seq = ?, kind = ?, uld_number = ?, bulk_ref = ?, rcl_no = ?, contour_code = ?, port = ?, pcs = ?,
                  tare_weight = ?, rcl_gross_weight = ?, material_weight = ?, lih_type = ?, predecl_type = ?,
                  squeeze_mode = ?, net_weight = ?, diff_weight = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND sheet_id = ?`,
          [...values, payloadId, id]
        );
        return payloadId;
      }
      const inserted = await dbRun(
        `INSERT INTO uld_weight_ulds
          (sheet_id, seq, kind, uld_number, bulk_ref, rcl_no, contour_code, port, pcs,
           tare_weight, rcl_gross_weight, material_weight, lih_type, predecl_type, squeeze_mode,
           net_weight, diff_weight)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ...values]
      );
      return inserted.lastID;
    };

    for (let i = 0; i < payload.ulds.length; i += 1) {
      const unit = payload.ulds[i];
      const calcUnit = computed.units[i] ? computed.units[i].calc : null;
      const uldId = await unitIdFor(unit, i);
      keptUnitIds.add(Number(uldId));

      const oldItems = await dbAll(
        'SELECT id FROM uld_weight_items WHERE uld_id = ? ORDER BY seq ASC, id ASC', [uldId]
      );
      const oldItemIds = new Set(oldItems.map(it => Number(it.id)));
      const keptItemIds = new Set();

      for (let j = 0; j < unit.items.length; j += 1) {
        const item = unit.items[j];
        const calcItem = calcUnit && calcUnit.items[j] ? calcUnit.items[j] : null;
        const finalWeight = calcItem ? calcItem.final : item.declared_weight;
        const payloadItemId = item.id ? Number(item.id) : null;
        if (payloadItemId && oldItemIds.has(payloadItemId)) {
          await dbRun(
            `UPDATE uld_weight_items
                SET seq = ?, mawb = ?, mawb_record_id = ?, port = ?, pcs = ?, declared_weight = ?,
                    final_weight = ?, is_squeeze = ?, squeeze_ratio = ?, lih_type = ?
              WHERE id = ? AND uld_id = ?`,
            [
              j, item.mawb, item.mawb_record_id, item.port, item.pcs, item.declared_weight,
              finalWeight, item.is_squeeze, item.squeeze_ratio, item.lih_type,
              payloadItemId, uldId
            ]
          );
          keptItemIds.add(payloadItemId);
          continue;
        }
        const inserted = await dbRun(
          `INSERT INTO uld_weight_items
            (uld_id, seq, mawb, mawb_record_id, port, pcs, declared_weight, final_weight, is_squeeze, squeeze_ratio, lih_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uldId, j, item.mawb, item.mawb_record_id, item.port, item.pcs, item.declared_weight,
            finalWeight, item.is_squeeze, item.squeeze_ratio, item.lih_type
          ]
        );
        keptItemIds.add(Number(inserted.lastID));
      }

      const removedItemIds = [...oldItemIds].filter(itemId => !keptItemIds.has(itemId));
      if (removedItemIds.length) {
        await dbRun(
          `DELETE FROM uld_weight_items WHERE id IN (${removedItemIds.map(() => '?').join(',')})`,
          removedItemIds
        );
      }
    }

    const removedUnitIds = [...oldUnitIds].filter(unitId => !keptUnitIds.has(unitId));
    if (removedUnitIds.length) {
      await dbRun(
        `DELETE FROM uld_weight_items WHERE uld_id IN (${removedUnitIds.map(() => '?').join(',')})`,
        removedUnitIds
      );
      await dbRun(
        `DELETE FROM uld_weight_ulds WHERE id IN (${removedUnitIds.map(() => '?').join(',')})`,
        removedUnitIds
      );
    }

    writeAuditLog(
      req, 'uld_weight.sheet.save', 'uld_weight_sheet', id,
      `儲存夾重表 ${existing.sheet_no}（${payload.ulds.length} 個收貨單位）`
    );
    // V3：留一版（內容與上一版相同就不重複記）
    await saveSheetVersion(req, id, { action: 'save' });
    const detail = await loadSheetDetail(id);
    res.json({ data: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== DELETE /api/uld-weight/sheets/:id =====
router.delete('/sheets/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const existing = await dbGet('SELECT * FROM uld_weight_sheets WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '找不到夾重表' });
    if (existing.status === 'locked') {
      return res.status(409).json({ error: '夾重表已鎖定，請先解鎖再刪除' });
    }
    const ulds = await dbAll('SELECT id FROM uld_weight_ulds WHERE sheet_id = ?', [id]);
    if (ulds.length) {
      const placeholders = ulds.map(() => '?').join(',');
      await dbRun(
        `DELETE FROM uld_weight_items WHERE uld_id IN (${placeholders})`,
        ulds.map(u => u.id)
      );
    }
    await dbRun('DELETE FROM uld_weight_ulds WHERE sheet_id = ?', [id]);
    await dbRun('DELETE FROM uld_weight_sheets WHERE id = ?', [id]);
    writeAuditLog(req, 'uld_weight.sheet.delete', 'uld_weight_sheet', id, `刪除夾重表 ${existing.sheet_no}`);
    res.json({ data: { id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /api/uld-weight/sheets/:id/duplicate =====
router.post('/sheets/:id/duplicate', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const src = await dbGet('SELECT * FROM uld_weight_sheets WHERE id = ?', [id]);
    if (!src) return res.status(404).json({ error: '找不到夾重表' });

    const sheetNo = await generateSheetNo();
    const user = (req.session && req.session.user) || {};
    const inserted = await dbRun(
      `INSERT INTO uld_weight_sheets
        (sheet_no, sheet_date, terminal, flight_no, flight_date, round_px, round_b, tail_mode,
         diff_warn_pct, diff_warn_kg, clamp_min_pct, clamp_max_pct, handler, remark, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [
        sheetNo, src.sheet_date, src.terminal, src.flight_no, src.flight_date,
        src.round_px, src.round_b, src.tail_mode, src.diff_warn_pct, src.diff_warn_kg,
        num(src.clamp_min_pct), num(src.clamp_max_pct),
        src.handler, src.remark, user.user_id || null
      ]
    );
    const newId = inserted.lastID;

    const ulds = await dbAll('SELECT * FROM uld_weight_ulds WHERE sheet_id = ? ORDER BY seq ASC, id ASC', [id]);
    for (const unit of ulds) {
      const newUld = await dbRun(
        `INSERT INTO uld_weight_ulds
          (sheet_id, seq, kind, uld_number, bulk_ref, rcl_no, contour_code, port, pcs,
           tare_weight, rcl_gross_weight, material_weight, lih_type, predecl_type, squeeze_mode,
           net_weight, diff_weight)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId, unit.seq, unit.kind, unit.uld_number, unit.bulk_ref, unit.rcl_no, unit.contour_code,
          unit.port, unit.pcs, unit.tare_weight, unit.rcl_gross_weight, unit.material_weight,
          unit.lih_type, unit.predecl_type, unit.squeeze_mode, unit.net_weight, unit.diff_weight
        ]
      );
      const items = await dbAll(
        'SELECT * FROM uld_weight_items WHERE uld_id = ? ORDER BY seq ASC, id ASC',
        [unit.id]
      );
      for (const item of items) {
        await dbRun(
          `INSERT INTO uld_weight_items
            (uld_id, seq, mawb, mawb_record_id, port, pcs, declared_weight, final_weight, is_squeeze, squeeze_ratio, lih_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newUld.lastID, item.seq, item.mawb, item.mawb_record_id, item.port, item.pcs,
            item.declared_weight, item.final_weight, item.is_squeeze, item.squeeze_ratio, item.lih_type
          ]
        );
      }
    }

    writeAuditLog(req, 'uld_weight.sheet.duplicate', 'uld_weight_sheet', newId, `複製 ${src.sheet_no} → ${sheetNo}`);
    // V3：複本的第一版（duplicate，備註記來源表號）
    await saveSheetVersion(req, newId, { action: 'duplicate', note: `來源 ${src.sheet_no}` });
    const detail = await loadSheetDetail(newId);
    res.status(201).json({ data: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /api/uld-weight/sheets/:id/apply（W2）=====
// 把夾重後的「最終重量」回寫打板計劃的 Booking Record（mawb_records.gross_weight）。
// 規則（D1 已確認）：僅 status = 'locked' 可套用；同一票跨板加總；原重量寫進 audit_log.detail；
// 不動 orders（訂單的申報重量不應被夾重結果覆蓋）。重複套用為冪等（重量未變就略過）。
router.post('/sheets/:id/apply', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const calc = await calcReady;
    const sheet = await dbGet('SELECT * FROM uld_weight_sheets WHERE id = ?', [id]);
    if (!sheet) return res.status(404).json({ error: '找不到夾重表' });
    if (sheet.status !== 'locked') {
      return res.status(409).json({ error: '夾重表尚未鎖定，請先按「鎖定」再套用到 Booking Record' });
    }

    const detail = await loadSheetDetail(id);
    const totals = calc.uldBookingTotals({ units: detail.ulds });

    const applied = [];
    const skipped = [];
    for (const entry of totals.entries) {
      const booking = await dbGet(
        'SELECT id, mawb, gross_weight FROM mawb_records WHERE id = ?',
        [entry.mawb_record_id]
      );
      if (!booking) {
        skipped.push({ mawb_record_id: entry.mawb_record_id, mawb: entry.mawb, reason: 'booking_not_found' });
        continue;
      }
      const before = num(booking.gross_weight);
      const after = num(entry.final);
      if (Math.abs(before - after) < 1e-9) {
        // 已套用過／重量相同 → 不重複寫入（避免 audit_log 噪音，也保證重複套用不會累加）
        skipped.push({ mawb_record_id: booking.id, mawb: booking.mawb, reason: 'unchanged', before, after });
        continue;
      }
      await dbRun(
        'UPDATE mawb_records SET gross_weight = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [after, booking.id]
      );
      applied.push({ mawb_record_id: booking.id, mawb: booking.mawb, before, after });
    }
    totals.unlinked.forEach(row => {
      skipped.push({ mawb_record_id: null, mawb: row.mawb, reason: 'no_booking', final: row.final });
    });

    const conflicts = totals.conflicts;
    if (applied.length) {
      // 原重量／新重量都留在 audit_log.detail（可追溯、可人工回復）
      writeAuditLog(req, 'uld_weight.apply', 'uld_weight_sheet', id, JSON.stringify({
        sheet_no: sheet.sheet_no,
        applied,
        skipped: skipped.map(s => ({ booking_id: s.mawb_record_id, mawb: s.mawb, reason: s.reason })),
        conflicts
      }));
      // V3：套用 Booking 也留一版（備註記回寫了幾票）
      await saveSheetVersion(req, id, { action: 'apply', note: `回寫 ${applied.length} 票 Booking` });
    }

    res.json({ data: { applied, skipped, conflicts }, sheet: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /api/uld-weight/sheets/:id/sync-bookings（V1）=====
// 「夾重表反推打板計劃」：把**沒有連結 Booking** 的票補上 `mawb_record_id`。
//   1) 打板計劃已有同號 MAWB（正規化比對：去空白／連字號、大寫）→ **只連結，不重複建**
//   2) 沒有 → 建一筆 Booking（`gross_weight` = 夾重後重量加總、`pcs` = 件數加總、`dest` = 該票 Port）
// 安全設計（不改既定規則）：
//   * **預設 dry_run**（只回預覽、不寫 DB）；要真的寫入必須明確傳 `{ "dry_run": false }`
//   * **不動 orders**（D1）；也不動夾重表的重量，只更新 `uld_weight_items.mawb_record_id`
//   * 夾重表有 error（未勾夾重／目標過小…）→ 422（重量還不確定，不該寫進 Booking）
//   * 同號 MAWB 在打板計劃有多筆 → 不猜，列在 skipped（`duplicate_booking`）交給人工
// 重量一律來自 `calc.uldBookingTotals()`（與 W2 的 /apply 同一份來源，不在這裡另寫算法）。
const MAWB_KEY_SQL = "REPLACE(REPLACE(UPPER(IFNULL(mawb, '')), '-', ''), ' ', '') = ?";

// 把這張表裡某票 MAWB 的明細全部指到同一個 Booking（MAWB 比對用 calc.uldMawbKey，避免格式差異）
async function linkItemsToBooking(sheetId, calc, mawbKey, bookingId) {
  const rows = await dbAll(
    `SELECT i.id AS id, i.mawb AS mawb
       FROM uld_weight_items i
       JOIN uld_weight_ulds u ON u.id = i.uld_id
      WHERE u.sheet_id = ?`,
    [sheetId]
  );
  const itemIds = rows
    .filter(row => calc.uldMawbKey(row.mawb) === mawbKey)
    .map(row => Number(row.id));
  for (const itemId of itemIds) {
    await dbRun('UPDATE uld_weight_items SET mawb_record_id = ? WHERE id = ?', [bookingId, itemId]);
  }
  return itemIds.length;
}

router.post('/sheets/:id/sync-bookings', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const sheet = await dbGet('SELECT * FROM uld_weight_sheets WHERE id = ?', [id]);
    if (!sheet) return res.status(404).json({ error: '找不到夾重表' });

    const body = req.body || {};
    // 只有明確傳 false 才真的寫入（預設＝預覽）
    const dryRun = !(body.dry_run === false || body.dryRun === false);

    const calc = await calcReady;
    const detail = await loadSheetDetail(id);
    if (detail.totals && detail.totals.hasError) {
      return res.status(422).json({
        error: '夾重表有錯誤（未勾夾重／目標過小等），請先修正再補建 Booking Record'
      });
    }

    const totals = calc.uldBookingTotals({ units: detail.ulds });
    // 每票的第一個非空 Port → 建立 Booking 時的 dest（Port 不檢核，只帶入有值的那個）
    const portsByMawb = new Map();
    (detail.ulds || []).forEach(unit => {
      (unit.items || []).forEach(item => {
        const key = calc.uldMawbKey(item.mawb);
        const port = str(item.port, 20).toUpperCase();
        if (!key || !port || portsByMawb.has(key)) return;
        portsByMawb.set(key, port);
      });
    });

    const created = [];
    const linked = [];
    const skipped = [];
    for (const row of totals.unlinked) {
      const mawb = str(row.mawb, 40);
      const key = calc.uldMawbKey(mawb);
      if (!key) {
        skipped.push({ mawb, reason: 'no_mawb' });
        continue;
      }
      const existing = await dbAll(
        `SELECT id, mawb, gross_weight FROM mawb_records WHERE ${MAWB_KEY_SQL} ORDER BY id ASC`,
        [key]
      );
      if (existing.length > 1) {
        // 打板計劃本身就有重複 MAWB → 不猜哪一筆（避免把重量寫到錯的 Booking）
        skipped.push({ mawb, reason: 'duplicate_booking', count: existing.length });
        continue;
      }
      if (existing.length === 1) {
        const booking = existing[0];
        const linkedCount = dryRun ? null : await linkItemsToBooking(id, calc, key, Number(booking.id));
        linked.push({
          mawb, mawb_record_id: Number(booking.id),
          before: num(booking.gross_weight), final: num(row.final), pcs: row.pcs,
          itemCount: linkedCount
        });
        continue;
      }

      const dest = portsByMawb.get(key) || '';
      if (dryRun) {
        created.push({ mawb, mawb_record_id: null, dest, pcs: row.pcs, final: num(row.final) });
        continue;
      }
      const inserted = await dbRun(
        `INSERT INTO mawb_records (mawb, hawb, client, dest, pcs, gross_weight, volume_weight, cbm, spl, remark)
         VALUES (?, '', '', ?, ?, ?, 0, 0, '', ?)`,
        [mawb, dest, row.pcs, num(row.final), `由夾重表 ${sheet.sheet_no} 建立`]
      );
      const linkedCount = await linkItemsToBooking(id, calc, key, Number(inserted.lastID));
      created.push({
        mawb, mawb_record_id: Number(inserted.lastID), dest, pcs: row.pcs,
        final: num(row.final), itemCount: linkedCount
      });
    }

    if (!dryRun && (created.length || linked.length)) {
      writeAuditLog(req, 'uld_weight.sync_bookings', 'uld_weight_sheet', id, JSON.stringify({
        sheet_no: sheet.sheet_no,
        created: created.map(c => ({ mawb: c.mawb, booking_id: c.mawb_record_id, gross_weight: c.final, pcs: c.pcs, dest: c.dest })),
        linked: linked.map(l => ({ mawb: l.mawb, booking_id: l.mawb_record_id, before: l.before })),
        skipped
      }));
      // V3：補建 Booking（明細的 mawb_record_id 有變）也留一版
      await saveSheetVersion(req, id, {
        action: 'sync_bookings',
        note: `建立 ${created.length}／連結 ${linked.length}`
      });
    }

    // 寫入後重讀（明細的 mawb_record_id 已更新，前端可直接覆蓋畫面）；預覽則原樣回傳
    const sheetAfter = dryRun ? detail : await loadSheetDetail(id);
    res.json({
      data: {
        dry_run: dryRun,
        created,
        linked,
        skipped,
        alreadyLinked: totals.entries.length,
        conflicts: totals.conflicts
      },
      sheet: sheetAfter
    });
  } catch (err) {
    console.error('[uld-weight] 補建 Booking Record 失敗:', err.message);
    res.status(500).json({ error: `補建 Booking Record 失敗：${err.message}` });
  }
});

// ===== RCL 磅單匯入的檔案解析工具（W3）=====
// 只在記憶體解析（不落地），並限制大小與列／欄數，避免超大檔拖垮服務
const RCL_MAX_BYTES = 10 * 1024 * 1024;
const RCL_MAX_ROWS = 400;
const RCL_MAX_COLS = 30;
const rclUpload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: RCL_MAX_BYTES }
});

function cellToText(value) {
  let v = resolveCellValue(value);
  if (v instanceof Date) v = formatLocalDateTime(v);
  if (v !== null && typeof v === 'object') return '';
  return v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim();
}

// ExcelJS 工作表 → 二維字串陣列（最多 400 列 × 30 欄）
// 保留空白列：讓「列」欄位 = Excel 實際列號（使用者才能對照紙本／畫面上的列）
function sheetToGrid(ws) {
  const grid = [];
  const lastRow = Math.min(ws.rowCount || 0, RCL_MAX_ROWS);
  for (let r = 1; r <= lastRow; r += 1) {
    const row = ws.getRow(r);
    const cells = [];
    for (let c = 1; c <= RCL_MAX_COLS; c += 1) cells.push(cellToText(row.getCell(c).value));
    grid.push(cells);
  }
  return grid;
}

// 簡單 CSV／TSV 解析（支援雙引號跳脫、BOM、逗號或 Tab 分隔）
function csvToGrid(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const head = clean.slice(0, 2000);
  const delimiter = (head.split('\t').length > head.split(',').length) ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i += 1; } else { inQuotes = false; }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (ch === '\r') continue;
    cell += ch;
  }
  row.push(cell);
  rows.push(row);
  // 保留空白列（列號 = 檔案行號）；只是不吃超過上限的量
  return rows
    .slice(0, RCL_MAX_ROWS)
    .map(r => r.slice(0, RCL_MAX_COLS).map(v => String(v).replace(/\u00a0/g, ' ').trim()));
}

// ===== POST /api/uld-weight/sheets/:id/import-rcl（W3）=====
// 上傳 RCL 磅單（.xlsx / .xlsm / .csv）→ 只解析、不寫 DB；回傳欄位對應 + 可建立的收貨單位清單，
// 由前端勾選後併入夾重表草稿（再按「儲存」才落庫）。
router.post('/sheets/:id/import-rcl', (req, res) => {
  rclUpload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const message = uploadErr.code === 'LIMIT_FILE_SIZE'
        ? '檔案超過 10MB 上限'
        : `上傳失敗：${uploadErr.message}`;
      return res.status(400).json({ error: message });
    }
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
      const sheetRow = await dbGet('SELECT id, status, sheet_no FROM uld_weight_sheets WHERE id = ?', [id]);
      if (!sheetRow) return res.status(404).json({ error: '找不到夾重表' });
      if (sheetRow.status === 'locked') {
        return res.status(409).json({ error: '夾重表已鎖定，請先解鎖再匯入 RCL 磅單' });
      }
      const file = req.file;
      if (!file || !file.buffer) {
        return res.status(400).json({ error: '請選擇要匯入的 RCL 磅單（Excel 或 CSV）' });
      }

      const rcl = await rclReady;
      const ext = path.extname(file.originalname || '').toLowerCase();
      let grid = [];
      let sheets = [];
      let sheetName = '';

      if (ext === '.xls') {
        return res.status(400).json({ error: '不支援舊版 .xls，請另存為 .xlsx 或 .csv 後再匯入' });
      }
      if (ext === '.csv' || ext === '.txt') {
        grid = csvToGrid(file.buffer.toString('utf8'));
        sheets = ['CSV'];
        sheetName = 'CSV';
      } else if (ext === '.xlsx' || ext === '.xlsm') {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(file.buffer);
        sheets = wb.worksheets.map(ws => ws.name);
        const wanted = str(req.body && req.body.sheet, 120);
        const ws = (wanted && wb.getWorksheet(wanted)) || wb.worksheets[0];
        if (!ws) return res.status(400).json({ error: '檔案裡沒有可讀取的工作表' });
        sheetName = ws.name;
        grid = sheetToGrid(ws);
      } else {
        return res.status(400).json({ error: '只支援 .xlsx / .xlsm / .csv 檔案' });
      }

      if (!grid.length || !grid.some(row => row.some(cell => cell !== ''))) {
        return res.status(400).json({ error: '檔案裡沒有可解析的資料' });
      }

      const found = rcl.rclFindHeaderRow(grid);
      const columns = { ...found.columns };
      // 使用者指定的欄位對應（0-based 欄索引；-1 / 空白 = 不使用或沿用自動偵測）
      ['uld', 'tare', 'gross', 'pcs'].forEach(key => {
        const raw = req.body ? req.body[`col_${key}`] : '';
        if (raw == null || raw === '') return;
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) columns[key] = n >= 0 ? n : -1;
      });

      const dataGrid = found.index >= 0 ? grid.slice(found.index + 1) : grid;
      const parsed = rcl.rclRowsFromGrid(dataGrid, columns, { limit: 200 });

      res.json({
        data: {
          file_name: file.originalname || '',
          sheet_name: sheetName,
          sheets,
          header_row: found.index >= 0 ? found.index + 1 : 0, // 1-based（給人看）
          header: (found.header || []).map(v => rcl.rclText(v)),
          columns,
          grid: dataGrid.slice(0, RCL_MAX_ROWS),
          rows: parsed.rows,
          skipped: parsed.skipped
        }
      });
    } catch (err) {
      res.status(500).json({ error: `解析 RCL 磅單失敗：${err.message}` });
    }
  });
});

// ===== POST /api/uld-weight/sheets/:id/lock|unlock =====
async function setLocked(req, res, locked) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '無效的夾重表 ID' });
    const existing = await dbGet('SELECT * FROM uld_weight_sheets WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '找不到夾重表' });
    await dbRun(
      'UPDATE uld_weight_sheets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [locked ? 'locked' : 'draft', id]
    );
    writeAuditLog(
      req, locked ? 'uld_weight.sheet.lock' : 'uld_weight.sheet.unlock',
      'uld_weight_sheet', id, `${locked ? '鎖定' : '解鎖'}夾重表 ${existing.sheet_no}`
    );
    // V3：鎖定／解鎖也留一版（狀態是異動的一部分）
    await saveSheetVersion(req, id, { action: locked ? 'lock' : 'unlock' });
    const detail = await loadSheetDetail(id);
    res.json({ data: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
router.post('/sheets/:id/lock', (req, res) => setLocked(req, res, true));
router.post('/sheets/:id/unlock', (req, res) => setLocked(req, res, false));

module.exports = router;

