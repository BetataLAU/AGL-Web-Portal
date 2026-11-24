// ===== 執 PLAN（Loading Plan）API =====
// 掛載：server.js → app.use('/api/loading-plan', requireAuth, loadingPlanRouter)
// 權限：只要登入即可（實名登記；不設角色限制）——presence / audit 需要身份。
//
// 核心規則（見 CLAUDE.md「執 PLAN」）：
//   - 一票 booking 同時只屬於一個 plan → 「加入」＝ Move（UPDATE plan_id），不是新增一列
//   - 只有「複製」才會在同一票上多一列，並寫 split_of_item_id（KPI 會標重複 MAWB）
//   - 存貨＝ type='stock' 的虛擬 plan（id 由 GET /plans 取得）
//   - 體積以 cbm 為真相；VOL / cu.ft 由 public/js/loading-plan/calc.js 換算（前後端共用）
const express = require('express');
const path = require('path');
const { pathToFileURL } = require('url');
const ExcelJS = require('exceljs');
const db = require('../../db/database');
const { validateMawb, MAWB_LATE_LABEL } = require('../orders/utils');
const bus = require('./bus');
const router = express.Router();

const CALC_URL = pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'loading-plan', 'calc.js')).href;
let calcPromise = null;
function calc() {
  if (!calcPromise) calcPromise = import(CALC_URL);
  return calcPromise;
}

// ===== sqlite3 callback → Promise（與 loadsim / uld-weight 同一套）=====
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

async function withTransaction(fn) {
  await dbRun('BEGIN IMMEDIATE');
  try {
    const result = await fn();
    await dbRun('COMMIT');
    return result;
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    throw err;
  }
}

// Express 4 不會自動攔 async 例外
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ===== 共用工具 =====
function actorOf(req) {
  const user = (req.session && req.session.user) || {};
  return { id: user.user_id || null, display: user.display_name || user.user_id || null };
}

function writeAuditLog(req, action, targetId, detail) {
  const actor = actorOf(req);
  db.run(
    `INSERT INTO audit_log (actor_user_id, actor_display, action, target_type, target_id, detail)
     VALUES (?, ?, ?, 'loading_plan', ?, ?)`,
    [actor.id, actor.display, action, String(targetId || ''), detail || null],
    (err) => { if (err) console.error('[loading-plan] audit_log 寫入失敗:', err.message); }
  );
}

// 事件流（Phase 3 的 SSE 會用同一張表補送；id 遞增）
async function logEvent(req, planId, action, payload) {
  const actor = actorOf(req);
  const result = await dbRun(
    `INSERT INTO loading_plan_events (plan_id, actor_user_id, actor_display, action, payload)
     VALUES (?, ?, ?, ?, ?)`,
    [planId || null, actor.id, actor.display, action, payload ? JSON.stringify(payload) : null]
  );
  const event = {
    id: result.lastID,
    plan_id: planId ? Number(planId) : null,
    action,
    payload: payload || null,
    actor_user_id: actor.id,
    actor_display: actor.display,
    created_at: new Date().toISOString()
  };
  bus.publish(event);
  return event;
}

function str(value, max = 200) {
  const text = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  return text.slice(0, max);
}

// 自由文字（REMARK／DIM）：保留換行，只整理水平空白與過多空行
function strMultiline(value, max = 500) {
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.slice(0, max);
}

function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value) {
  const n = numOrNull(value);
  return n === null ? null : Math.trunc(n);
}

function boolInt(value) {
  return value ? 1 : 0;
}

const PLAN_FIELDS = [
  'day_code', 'flight_no', 'flight_date', 'etd', 'owner_company',
  'contour_code', 'contour_text', 'max_gross_weight', 'max_cbm', 'volume_view', 'status'
];

function serializePlan(row, totals) {
  if (!row) return null;
  return {
    id: row.id,
    plan_no: row.plan_no,
    type: row.type,
    day_code: row.day_code,
    flight_no: row.flight_no,
    flight_date: row.flight_date,
    etd: row.etd,
    owner_company: row.owner_company,
    contour_code: row.contour_code,
    contour_text: row.contour_text,
    contour_qty: row.contour_qty || 1,
    contour_known: !!row.contour_known,
    max_gross_weight: row.max_gross_weight,
    max_cbm: row.max_cbm,
    volume_view: row.volume_view || 'vol',
    status: row.status,
    sort_order: row.sort_order,
    version: row.version,
    updated_at: row.updated_at,
    totals: totals || null
  };
}

function planLimits(row) {
  return { maxGrossWeight: row && row.max_gross_weight, maxCbm: row && row.max_cbm };
}

async function nextSortOrder(planId) {
  const row = await dbGet('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM loading_plan_items WHERE plan_id = ?', [planId]);
  return row ? Number(row.next) : 0;
}

// ===== 序列化明細（附上三種體積表示）=====
// 重複 MAWB 判定是「全域」的：同一正規化 MAWB 只要出現在 >1 筆明細（含存貨、含同一 plan），
// 每一筆都會標 duplicate_mawb，並帶上其他位置（duplicate_places），前端才能把「所有 PLAN」都標色＋hover。
async function duplicateMawbMap(c) {
  const calcMod = c || await calc();
  const rows = await dbAll(
    `SELECT i.id AS item_id, i.plan_id, i.mawb,
            p.plan_no, p.type, p.day_code, p.flight_no, p.flight_date, p.owner_company
       FROM loading_plan_items i
       JOIN loading_plans p ON p.id = i.plan_id
      ORDER BY p.sort_order, i.section, i.sort_order, i.id`
  );
  const byKey = new Map();
  rows.forEach((row) => {
    // 「後補MAWB#」是佔位字串（不是真主號）→ 不列入重複判定（可能同時有多票後補）
    if (String(row.mawb || '').trim() === MAWB_LATE_LABEL) return;
    const key = calcMod.lpNormalizeMawbKey(row.mawb);
    if (!key) return;
    const label = row.type === 'stock' ? '存貨' : calcMod.lpPlanLabel(row);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({
      item_id: row.item_id,
      plan_id: row.plan_id,
      plan_no: row.plan_no,
      type: row.type,
      label
    });
  });
  return byKey;
}

function serializeItem(row, c, dupMap) {
  if (!row) return null;
  const key = c.lpNormalizeMawbKey(row.mawb);
  const places = key && dupMap ? (dupMap.get(key) || []) : [];
  const others = places.filter(p => Number(p.item_id) !== Number(row.id));
  return Object.assign({}, row, {
    volume: c.lpItemVolume(row),
    duplicate_mawb: others.length > 0,
    duplicate_places: others
  });
}

async function planRowWithTotals(row) {
  const c = await calc();
  const items = await dbAll(
    'SELECT * FROM loading_plan_items WHERE plan_id = ? ORDER BY section, sort_order, id', [row.id]
  );
  const dupMap = await duplicateMawbMap(c);
  return { plan: serializePlan(row, c.lpKpi(items, planLimits(row))), items: items.map(i => serializeItem(i, c, dupMap)) };
}

function autoPlanNo(plan, seq) {
  const day = str(plan.day_code || 'X', 8).replace(/[^A-Za-z0-9]/g, '') || 'X';
  const flight = str(plan.flight_no || 'NOFLT', 12).replace(/[^A-Za-z0-9]/g, '') || 'NOFLT';
  return `LP-${day}-${flight}-${String(seq).padStart(2, '0')}`;
}

// ===== GET /plans（清單＋KPI）=====
router.get('/plans', handle(async (req, res) => {
  const c = await calc();
  const type = str(req.query.type || '', 10);
  const search = str(req.query.search || '', 60).toLowerCase();

  const plans = await dbAll('SELECT * FROM loading_plans ORDER BY sort_order, id');
  const items = await dbAll('SELECT * FROM loading_plan_items ORDER BY plan_id, section, sort_order, id');
  const byPlan = new Map();
  items.forEach((it) => {
    if (!byPlan.has(it.plan_id)) byPlan.set(it.plan_id, []);
    byPlan.get(it.plan_id).push(it);
  });

  const data = plans
    .filter(p => (type && type !== 'all' ? p.type === type : true))
    .filter((p) => {
      if (!search) return true;
      const haystack = [p.plan_no, p.day_code, p.flight_no, p.flight_date, p.owner_company, p.contour_code]
        .map(v => String(v || '').toLowerCase()).join(' ');
      return haystack.includes(search);
    })
    .map(p => serializePlan(p, c.lpKpi(byPlan.get(p.id) || [], planLimits(p))));

  res.json({ data });
}));

// ===== GET /plans/:id（含明細）=====
router.get('/plans/:id', handle(async (req, res) => {
  const row = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: '找不到這張 plan' });
  const detail = await planRowWithTotals(row);
  res.json({ data: detail.plan, items: detail.items });
}));

// ===== POST /plans（新增）=====
router.post('/plans', handle(async (req, res) => {
  const c = await calc();
  const body = req.body || {};
  const plan = {
    day_code: str(body.day_code, 10),
    flight_no: str(body.flight_no, 20),
    flight_date: str(body.flight_date, 20),
    etd: str(body.etd, 10),
    owner_company: str(body.owner_company, 40),
    contour_text: str(body.contour_text, 60),
    contour_code: str(body.contour_code, 20).toUpperCase(),
    contour_qty: Math.max(1, intOrNull(body.contour_qty) || 1),
    max_gross_weight: numOrNull(body.max_gross_weight),
    max_cbm: numOrNull(body.max_cbm),
    volume_view: body.volume_view === 'cuft' ? 'cuft' : 'vol'
  };
  const parsed = c.lpContourParse(plan.contour_text || plan.contour_code);
  if (!plan.contour_code) plan.contour_code = parsed.code;
  if (!plan.contour_text) plan.contour_text = parsed.text;

  const seqRow = await dbGet("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM loading_plans WHERE type = 'flight'");
  const nextSeq = seqRow ? Number(seqRow.next) : 0;
  const planNo = str(body.plan_no, 40) || autoPlanNo(plan, nextSeq + 1);

  const result = await dbRun(
    `INSERT INTO loading_plans
       (plan_no, type, day_code, flight_no, flight_date, etd, owner_company,
        contour_code, contour_text, contour_qty, contour_known, contour_dims,
        max_gross_weight, max_cbm, volume_view, status, sort_order, version, updated_at)
     VALUES (?, 'flight', ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, 'draft', ?, 1, CURRENT_TIMESTAMP)`,
    [planNo, plan.day_code, plan.flight_no, plan.flight_date, plan.etd, plan.owner_company,
      plan.contour_code, plan.contour_text, plan.contour_qty,
      plan.max_gross_weight, plan.max_cbm, plan.volume_view, nextSeq]
  );

  const row = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [result.lastID]);
  await logEvent(req, result.lastID, 'plan.create', { plan_no: planNo });
  writeAuditLog(req, 'loading_plan.create', result.lastID, `${planNo}（${c.lpPlanLabel(row)}）`);
  res.status(201).json({ data: serializePlan(row, c.lpKpi([], planLimits(row))) });
}));

// ===== PATCH /plans/:id（更新表頭）=====
router.patch('/plans/:id', handle(async (req, res) => {
  const c = await calc();
  const id = Number(req.params.id);
  const row = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '找不到這張 plan' });

  const body = req.body || {};
  const sets = [];
  const params = [];
  PLAN_FIELDS.forEach((field) => {
    if (body[field] === undefined) return;
    if (field === 'max_gross_weight' || field === 'max_cbm') {
      sets.push(`${field} = ?`); params.push(numOrNull(body[field])); return;
    }
    if (field === 'volume_view') {
      sets.push('volume_view = ?'); params.push(body[field] === 'cuft' ? 'cuft' : 'vol'); return;
    }
    if (field === 'status') {
      const status = ['draft', 'confirmed', 'locked'].includes(body[field]) ? body[field] : 'draft';
      sets.push('status = ?'); params.push(status); return;
    }
    sets.push(`${field} = ?`); params.push(str(body[field], field === 'contour_text' ? 60 : 40));
  });
  if (body.contour_qty !== undefined) {
    sets.push('contour_qty = ?'); params.push(Math.max(1, intOrNull(body.contour_qty) || 1));
  }
  if (body.contour_known !== undefined) {
    sets.push('contour_known = ?'); params.push(boolInt(body.contour_known));
  }
  if ((body.contour_text !== undefined || body.contour_code !== undefined) && body.contour_code === undefined) {
    const parsed = c.lpContourParse(body.contour_text);
    if (parsed.code) { sets.push('contour_code = ?'); params.push(parsed.code); }
    if (body.contour_qty === undefined) { sets.push('contour_qty = ?'); params.push(parsed.qty); }
  }
  if (!sets.length) return res.status(422).json({ error: '沒有可更新的欄位' });

  sets.push('version = version + 1', 'updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  await dbRun(`UPDATE loading_plans SET ${sets.join(', ')} WHERE id = ?`, params);

  const updated = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [id]);
  const detail = await planRowWithTotals(updated);
  await logEvent(req, id, 'plan.update', { fields: Object.keys(body) });
  writeAuditLog(req, 'loading_plan.update', id, c.lpPlanLabel(updated));
  res.json({ data: detail.plan });
}));

// ===== DELETE /plans/:id（存貨不可刪；有明細要先搬走）=====
router.delete('/plans/:id', handle(async (req, res) => {
  const id = Number(req.params.id);
  const row = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '找不到這張 plan' });
  if (row.type === 'stock') return res.status(409).json({ error: '存貨 plan 不可刪除' });

  const countRow = await dbGet('SELECT COUNT(*) AS n FROM loading_plan_items WHERE plan_id = ?', [id]);
  if (countRow && Number(countRow.n) > 0) {
    return res.status(409).json({ error: `這張 plan 還有 ${countRow.n} 筆明細，請先搬回存貨或移到其他 plan` });
  }
  await dbRun('DELETE FROM loading_plans WHERE id = ?', [id]);
  await logEvent(req, id, 'plan.remove', { plan_no: row.plan_no });
  writeAuditLog(req, 'loading_plan.remove', id, row.plan_no);
  res.json({ ok: true, id });
}));

// ===== 明細共用：體積解析（cbm 為真相）=====
function resolveVolume(body, c) {
  const rawCbm = numOrNull(body.cbm);
  const rawVol = numOrNull(body.volume_weight);
  const rawCuft = numOrNull(body.cuft);
  let cbm = rawCbm;
  if (cbm === null && rawCuft !== null) cbm = c.lpCbmFromCuft(rawCuft);
  if (cbm === null && rawVol !== null) cbm = c.lpCbmFromVol(rawVol);
  if (cbm === null) cbm = 0;
  cbm = c.lpRound(cbm, 3);
  const vol = rawVol === null ? c.lpVolFromCbm(cbm) : c.lpRound(rawVol, 2);
  return { cbm, vol, cuft: c.lpCuftFromCbm(cbm), volumeSource: rawVol === null ? 'calc' : 'manual' };
}

function pkgsOf(body, c) {
  const parsed = c.lpParsePkgs(body.pkgs_text);
  const pcs = numOrNull(body.pcs_total);
  return {
    pkgsText: str(body.pkgs_text, 40),
    cartons: parsed.cartons,
    pallets: parsed.pallets,
    pcsTotal: parsed.pcsTotal !== null ? parsed.pcsTotal : (pcs === null ? null : pcs)
  };
}

async function insertItem(planId, fields, sortOrder) {
  const result = await dbRun(
    `INSERT INTO loading_plan_items
       (plan_id, mawb_record_id, mawb, client, dest, tag, pkgs_text, cartons, pallets, pcs_total,
        gross_weight, volume_weight, volume_source, cbm, cuft, volume_input_unit, cargo_receipt, remark,
        dg_no_power, dg_966, dg_967, dg_969, dg_970,
        h_af, h_fs, h_sc, h_vol, h_ctg, h_xray, section, sort_order, split_of_item_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [planId, fields.mawb_record_id || null, fields.mawb || '', fields.client || '', fields.dest || '',
      fields.tag || '', fields.pkgs_text || '', fields.cartons, fields.pallets, fields.pcs_total,
      fields.gross_weight || 0, fields.volume_weight, fields.volume_source || 'calc',
      fields.cbm || 0, fields.cuft || 0, fields.volume_input_unit || 'cbm',
      fields.cargo_receipt || '', fields.remark || '',
      boolInt(fields.dg_no_power), boolInt(fields.dg_966), boolInt(fields.dg_967),
      boolInt(fields.dg_969), boolInt(fields.dg_970),
      boolInt(fields.h_af), boolInt(fields.h_fs), boolInt(fields.h_sc),
      boolInt(fields.h_vol), boolInt(fields.h_ctg), boolInt(fields.h_xray),
      fields.section || 1, sortOrder, fields.split_of_item_id || null]
  );
  return result.lastID;
}

function fieldsFromRecord(rec, c) {
  const vol = c.lpVolFromCbm(rec.cbm);
  return {
    mawb_record_id: rec.id,
    mawb: rec.mawb || '',
    client: rec.client || '',
    dest: rec.dest || '',
    pcs_total: numOrNull(rec.pcs),
    gross_weight: numOrNull(rec.gross_weight) || 0,
    volume_weight: numOrNull(rec.volume_weight) === null ? vol : rec.volume_weight,
    volume_source: 'calc',
    cbm: numOrNull(rec.cbm) || 0,
    cuft: c.lpCuftFromCbm(rec.cbm),
    section: 1
  };
}

// ===== POST /plans/:id/items（加入／搬移；Move 語意）=====
router.post('/plans/:id/items', handle(async (req, res) => {
  const c = await calc();
  const planId = Number(req.params.id);
  const plan = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [planId]);
  if (!plan) return res.status(404).json({ error: '找不到這張 plan' });
  if (plan.status === 'locked') return res.status(409).json({ error: '這張 plan 已鎖定' });

  const body = req.body || {};
  const recordIds = (Array.isArray(body.mawb_record_ids) ? body.mawb_record_ids : []).map(Number).filter(Boolean);
  const itemIds = (Array.isArray(body.item_ids) ? body.item_ids : []).map(Number).filter(Boolean);
  if (!recordIds.length && !itemIds.length) {
    return res.status(422).json({ error: '請提供 mawb_record_ids 或 item_ids' });
  }

  const result = await withTransaction(async () => {
    let next = await nextSortOrder(planId);
    const moved = [];
    const added = [];
    const skipped = [];

    for (const recordId of recordIds) {
      const existing = await dbGet(
        'SELECT * FROM loading_plan_items WHERE mawb_record_id = ? ORDER BY id LIMIT 1', [recordId]
      );
      if (existing) {
        if (existing.plan_id === planId) { skipped.push(existing.id); continue; }
        await dbRun(
          'UPDATE loading_plan_items SET plan_id = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [planId, next++, existing.id]
        );
        moved.push({ item_id: existing.id, from_plan_id: existing.plan_id });
        continue;
      }
      const rec = await dbGet('SELECT * FROM mawb_records WHERE id = ?', [recordId]);
      if (!rec) { skipped.push(recordId); continue; }
      const newId = await insertItem(planId, fieldsFromRecord(rec, c), next++);
      added.push(newId);
    }

    for (const itemId of itemIds) {
      const item = await dbGet('SELECT * FROM loading_plan_items WHERE id = ?', [itemId]);
      if (!item) { skipped.push(itemId); continue; }
      if (item.plan_id === planId) { skipped.push(itemId); continue; }
      await dbRun(
        'UPDATE loading_plan_items SET plan_id = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [planId, next++, itemId]
      );
      moved.push({ item_id: itemId, from_plan_id: item.plan_id });
    }
    return { moved, added, skipped };
  });

  const updated = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [planId]);
  const detail = await planRowWithTotals(updated);
  await logEvent(req, planId, 'item.move', result);
  writeAuditLog(req, 'loading_plan.items.move', planId,
    `搬入 ${result.moved.length}／新增 ${result.added.length}／略過 ${result.skipped.length}`);
  res.json(Object.assign({ ok: true, data: detail.plan, items: detail.items }, result));
}));

// 取得（必要時自動建立）存貨 plan
async function ensureStockPlan() {
  const existing = await dbGet("SELECT * FROM loading_plans WHERE type = 'stock' ORDER BY id LIMIT 1");
  if (existing) return existing;
  const result = await dbRun(
    `INSERT INTO loading_plans (plan_no, type, day_code, volume_view, status, sort_order, version)
     VALUES ('LP-STOCK', 'stock', 'STOCK', 'vol', 'draft', 9999, 1)`
  );
  writeAuditLog({ session: {} }, 'loading_plan.stock.create', result.lastID, '自動建立存貨');
  return dbGet('SELECT * FROM loading_plans WHERE id = ?', [result.lastID]);
}

// ===== PATCH /items/:id（就地編輯；體積以改動的單位為真相）=====
router.patch('/items/:id', handle(async (req, res) => {
  const c = await calc();
  const id = Number(req.params.id);
  const item = await dbGet('SELECT * FROM loading_plan_items WHERE id = ?', [id]);
  if (!item) return res.status(404).json({ error: '找不到這筆明細' });
  const plan = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [item.plan_id]);
  if (plan && plan.status === 'locked') return res.status(409).json({ error: '這張 plan 已鎖定' });

  const body = req.body || {};
  const sets = [];
  const params = [];
  const textFields = ['mawb', 'client', 'dest', 'tag', 'remark'];
  textFields.forEach((field) => {
    if (body[field] === undefined) return;
    const maxLen = field === 'mawb' ? 40 : (field === 'tag' || field === 'remark') ? 500 : 80;
    sets.push(`${field} = ?`);
    // tag（畫面 REMARK）與 remark 是自由文字，DIM 一組一行 → 保留換行
    params.push(field === 'tag' || field === 'remark'
      ? strMultiline(body[field], maxLen)
      : str(body[field], maxLen));
  });
  // CRD（Cargo Ready Date）：畫面只顯示 DDMMM，DB 一律存 ISO（YYYY-MM-DD）。
  // 邏輯決策：CRD 不可遲於 Flight Date（存貨 plan 沒有 Flight Date → 不檢核）。
  // 不合格 → 422，前端保留原值並提示（不讓錯誤的日期寫進 DB）。
  if (body.cargo_receipt !== undefined) {
    const raw = str(body.cargo_receipt, 20);
    if (!raw) {
      sets.push('cargo_receipt = ?'); params.push('');
    } else {
      const flightDate = plan && plan.flight_date;
      const iso = c.lpCrdToIso(raw, flightDate);
      if (!iso) {
        return res.status(422).json({
          error: 'CRD 格式應為 DDMMM（例 24NOV）或 YYYY-MM-DD',
          data: { code: 'crd_invalid' }
        });
      }
      const issue = c.lpCrdIssue(iso, flightDate);
      if (issue) {
        return res.status(422).json({ error: issue, data: { code: 'crd_after_flight' } });
      }
      sets.push('cargo_receipt = ?'); params.push(iso);
    }
  }
  if (body.pkgs_text !== undefined) {
    const pkgs = pkgsOf(body, c);
    sets.push('pkgs_text = ?', 'cartons = ?', 'pallets = ?', 'pcs_total = ?');
    params.push(pkgs.pkgsText, pkgs.cartons, pkgs.pallets, pkgs.pcsTotal);
  } else if (body.pcs_total !== undefined) {
    sets.push('pcs_total = ?'); params.push(intOrNull(body.pcs_total));
  }
  if (body.gross_weight !== undefined) {
    sets.push('gross_weight = ?'); params.push(numOrNull(body.gross_weight) || 0);
  }
  if (body.cbm !== undefined || body.cuft !== undefined || body.volume_weight !== undefined) {
    const volume = resolveVolume(body, c);
    const unit = ['cbm', 'cuft', 'vol'].includes(body.volume_input_unit) ? body.volume_input_unit : 'cbm';
    sets.push('cbm = ?', 'volume_weight = ?', 'cuft = ?', 'volume_source = ?', 'volume_input_unit = ?');
    params.push(volume.cbm, volume.vol, volume.cuft, volume.volumeSource, unit);
  }
  ['dg_no_power', 'dg_966', 'dg_967', 'dg_969', 'dg_970', 'h_af', 'h_fs', 'h_sc', 'h_vol', 'h_ctg', 'h_xray']
    .forEach((field) => {
      if (body[field] === undefined) return;
      sets.push(`${field} = ?`); params.push(boolInt(body[field]));
    });
  if (body.section !== undefined) { sets.push('section = ?'); params.push(Math.max(1, intOrNull(body.section) || 1)); }
  if (body.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(intOrNull(body.sort_order) || 0); }
  if (!sets.length) return res.status(422).json({ error: '沒有可更新的欄位' });

  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  await dbRun(`UPDATE loading_plan_items SET ${sets.join(', ')} WHERE id = ?`, params);

  const updated = await dbGet('SELECT * FROM loading_plan_items WHERE id = ?', [id]);
  const detail = await planRowWithTotals(plan);
  await logEvent(req, item.plan_id, 'item.patch', { item_id: id, fields: Object.keys(body) });
  writeAuditLog(req, 'loading_plan.item.update', id, `plan ${item.plan_id}`);
  // 重複 MAWB 可能因這次編輯而改變：直接用重算後的明細（含 duplicate_mawb／duplicate_places）
  const data = detail.items.find(i => Number(i.id) === id) || serializeItem(updated, c);
  res.json({ ok: true, data, plan: detail.plan });
}));

// ===== DELETE /items/:id（預設「搬回存貨」；?hard=1 真刪）=====
router.delete('/items/:id', handle(async (req, res) => {
  const id = Number(req.params.id);
  const item = await dbGet('SELECT * FROM loading_plan_items WHERE id = ?', [id]);
  if (!item) return res.status(404).json({ error: '找不到這筆明細' });

  const hard = String(req.query.hard || '') === '1';
  const stock = await ensureStockPlan();
  const toStock = !hard && item.plan_id !== stock.id;
  if (hard || item.plan_id === stock.id) {
    await dbRun('DELETE FROM loading_plan_items WHERE id = ?', [id]);
  } else {
    const next = await nextSortOrder(stock.id);
    await dbRun(
      'UPDATE loading_plan_items SET plan_id = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [stock.id, next, id]
    );
  }

  await logEvent(req, item.plan_id, toStock ? 'item.to_stock' : 'item.remove', { item_id: id });
  writeAuditLog(req, toStock ? 'loading_plan.item.to_stock' : 'loading_plan.item.remove', id, `plan ${item.plan_id}`);
  const planRow = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [item.plan_id]);
  const detail = planRow ? await planRowWithTotals(planRow) : null;
  res.json({ ok: true, id, moved_to_stock: toStock, plan: detail ? detail.plan : null });
}));

// ===== POST /items/:id/copy（複製到另一個 plan；會標重複 MAWB）=====
router.post('/items/:id/copy', handle(async (req, res) => {
  const c = await calc();
  const id = Number(req.params.id);
  const targetPlanId = Number((req.body || {}).plan_id || 0);
  const source = await dbGet('SELECT * FROM loading_plan_items WHERE id = ?', [id]);
  if (!source) return res.status(404).json({ error: '找不到這筆明細' });
  const target = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [targetPlanId]);
  if (!target) return res.status(404).json({ error: '找不到目標 plan' });
  if (target.status === 'locked') return res.status(409).json({ error: '目標 plan 已鎖定' });

  if (source.mawb_record_id) {
    const dup = await dbGet(
      'SELECT id FROM loading_plan_items WHERE plan_id = ? AND mawb_record_id = ?',
      [targetPlanId, source.mawb_record_id]
    );
    if (dup) return res.status(409).json({ error: '目標 plan 已有同一票 MAWB（請用搬移，不要用複製）' });
  }

  const fields = Object.assign({}, source, { split_of_item_id: source.id });
  const next = await nextSortOrder(targetPlanId);
  const newId = await insertItem(targetPlanId, fields, next);

  const detail = await planRowWithTotals(target);
  await logEvent(req, targetPlanId, 'item.copy', { item_id: newId, from_item_id: source.id });
  writeAuditLog(req, 'loading_plan.item.copy', newId, `${source.mawb || '(no MAWB)'} → plan ${targetPlanId}`);
  res.status(201).json({ ok: true, id: newId, data: detail.plan, items: detail.items, duplicated: true });
}));

// ===== POST /plans/:id/reorder（拖曳排序）=====
router.post('/plans/:id/reorder', handle(async (req, res) => {
  const planId = Number(req.params.id);
  const plan = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [planId]);
  if (!plan) return res.status(404).json({ error: '找不到這張 plan' });
  if (plan.status === 'locked') return res.status(409).json({ error: '這張 plan 已鎖定' });

  const body = req.body || {};
  const ids = (Array.isArray(body.item_ids) ? body.item_ids : []).map(Number).filter(Boolean);
  if (!ids.length) return res.status(422).json({ error: '請提供 item_ids 順序' });
  const section = Math.max(1, intOrNull(body.section) || 1);

  await withTransaction(async () => {
    for (let i = 0; i < ids.length; i += 1) {
      await dbRun(
        'UPDATE loading_plan_items SET sort_order = ?, section = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND plan_id = ?',
        [i, section, ids[i], planId]
      );
    }
  });

  const detail = await planRowWithTotals(plan);
  await logEvent(req, planId, 'item.reorder', { count: ids.length });
  res.json({ ok: true, data: detail.plan, items: detail.items });
}));

// ===== GET /bookings（MAWB 主檔＋所在 plan；左欄「加入」與 hover 用）=====
router.get('/bookings', handle(async (req, res) => {
  const c = await calc();
  const search = str(req.query.search || '', 60);
  const limit = Math.min(200, Math.max(1, intOrNull(req.query.limit) || 50));
  const needle = search.toLowerCase();
  const key = c.lpNormalizeMawbKey(search);

  // 一次抓最近 500 筆在本機過濾（MAWB 正規化比對：輸入 17669855240 也找得到 176-6985 5240）
  const rows = await dbAll('SELECT * FROM mawb_records ORDER BY id DESC LIMIT 500');
  const matched = rows.filter((r) => {
    if (!search) return true;
    if (key && c.lpNormalizeMawbKey(r.mawb).includes(key)) return true;
    return [r.mawb, r.hawb, r.client, r.dest, r.remark, r.spl]
      .map(v => String(v || '').toLowerCase()).join(' ').includes(needle);
  }).slice(0, limit);

  const ids = matched.map(r => r.id);
  let placements = [];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    placements = await dbAll(
      `SELECT i.id AS item_id, i.plan_id, i.mawb_record_id, i.section, i.sort_order,
              p.plan_no, p.type, p.day_code, p.flight_no, p.flight_date, p.owner_company
         FROM loading_plan_items i
         JOIN loading_plans p ON p.id = i.plan_id
        WHERE i.mawb_record_id IN (${ph})
        ORDER BY p.sort_order, i.section, i.sort_order`,
      ids
    );
  }
  const byRecord = new Map();
  placements.forEach((pl) => {
    if (!byRecord.has(pl.mawb_record_id)) byRecord.set(pl.mawb_record_id, []);
    byRecord.get(pl.mawb_record_id).push(Object.assign({}, pl, { label: c.lpPlanLabel(pl) }));
  });

  const data = matched.map(r => Object.assign({}, r, {
    placements: byRecord.get(r.id) || [],
    volume: c.lpItemVolume(r)
  }));
  res.json({ data });
}));

// ===== POST /bookings（新增 Booking Record ＋ 直接加入存貨）=====
// 執 PLAN 只要登入即可（不設角色限制）。
// 同一 MAWB 已有 Booking → 409（前端提示改用「找現有 Booking」分頁加入，避免重複主檔）。
router.post('/bookings', handle(async (req, res) => {
  const c = await calc();
  const body = req.body || {};
  const rawMawb = str(body.mawb, 40);
  if (!c.lpDisplayMawb(rawMawb)) return res.status(422).json({ error: 'MAWB# 必填' });

  // 嚴格驗證（與訂單系統同一套 validateMawb）：11 位數字＋prefix 001-999＋檢查碼（suffix 前 7 位 mod 7）。
  // 「後補MAWB#」視為合法（late），但不參與重複比對。
  const mawbCheck = validateMawb(rawMawb);
  if (!mawbCheck.valid) {
    return res.status(422).json({ error: mawbCheck.error, data: { code: 'mawb_invalid', mawb: rawMawb } });
  }
  const mawb = mawbCheck.formatted;   // 標準顯示格式 176-6525 7360（後補MAWB# 原樣）
  const isLate = mawbCheck.late === true;

  const key = isLate ? '' : c.lpNormalizeMawbKey(mawb);
  // 正規化比對（去掉 '-' 與空白），與 V1 sync-bookings 的 SQL 一致
  const existing = key
    ? await dbGet(
      `SELECT id, mawb FROM mawb_records
        WHERE REPLACE(REPLACE(UPPER(IFNULL(mawb,'')),'-',''),' ','') = ?
        ORDER BY id LIMIT 1`,
      [key]
    )
    : null;
  if (existing) {
    return res.status(409).json({
      error: `MAWB ${existing.mawb} 已有 Booking（#${existing.id}），請改用「找現有 Booking」加入`,
      data: { id: existing.id, mawb: existing.mawb }
    });
  }

  const fields = fieldsFromRow(body, c);
  fields.mawb = mawb;   // 以驗證後的標準格式存入（避免原字串格式不一）
  const stock = await ensureStockPlan();

  const created = await withTransaction(async () => {
    const recordIns = await dbRun(
      `INSERT INTO mawb_records (mawb, hawb, client, dest, pcs, gross_weight, volume_weight, cbm, spl, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fields.mawb, str(body.hawb, 30).toUpperCase(), fields.client || '', fields.dest || '',
        fields.pcs_total || 0, fields.gross_weight || 0, fields.volume_weight || 0, fields.cbm || 0,
        str(body.spl, 20).toUpperCase(), fields.remark || '']
    );
    fields.mawb_record_id = recordIns.lastID;
    const next = await nextSortOrder(stock.id);
    const itemId = await insertItem(stock.id, fields, next);
    return { recordId: recordIns.lastID, itemId };
  });

  const detail = await planRowWithTotals(stock);
  await logEvent(req, stock.id, 'booking.create', {
    mawb: fields.mawb, item_id: created.itemId, mawb_record_id: created.recordId
  });
  writeAuditLog(req, 'loading_plan.booking.create', created.recordId, `新增 Booking ${fields.mawb}（加入存貨）`);

  res.status(201).json({
    ok: true,
    data: { id: created.recordId, mawb: fields.mawb, item_id: created.itemId },
    plan: detail.plan,
    items: detail.items
  });
}));

// ===== GET /placements（同一票 MAWB 在哪些 plan；hover / 拖曳提示用）=====
router.get('/placements', handle(async (req, res) => {
  const c = await calc();
  const mawb = str(req.query.mawb || '', 40);
  const recordId = intOrNull(req.query.mawb_record_id);
  if (!mawb && !recordId) return res.status(422).json({ error: '請提供 mawb 或 mawb_record_id' });

  let rows;
  if (recordId) {
    rows = await dbAll(
      `SELECT i.id AS item_id, i.plan_id, i.mawb_record_id, i.mawb, i.section, i.sort_order,
              p.plan_no, p.type, p.day_code, p.flight_no, p.flight_date, p.owner_company
         FROM loading_plan_items i JOIN loading_plans p ON p.id = i.plan_id
        WHERE i.mawb_record_id = ? ORDER BY p.sort_order, i.section, i.sort_order`,
      [recordId]
    );
  } else {
    const target = c.lpNormalizeMawbKey(mawb);
    rows = await dbAll(
      `SELECT i.id AS item_id, i.plan_id, i.mawb_record_id, i.mawb, i.section, i.sort_order,
              p.plan_no, p.type, p.day_code, p.flight_no, p.flight_date, p.owner_company
         FROM loading_plan_items i JOIN loading_plans p ON p.id = i.plan_id
        ORDER BY p.sort_order, i.section, i.sort_order`
    ).then(list => list.filter(r => c.lpNormalizeMawbKey(r.mawb) === target));
  }

  res.json({ data: rows.map(r => Object.assign({}, r, { label: c.lpPlanLabel(r) })) });
}));

// ===== GET /plans/:id/events（斷線補送；Phase 3 的 SSE 也用同一張表）=====
router.get('/plans/:id/events', handle(async (req, res) => {
  const planId = Number(req.params.id);
  const since = Math.max(0, intOrNull(req.query.since) || 0);
  const rows = await dbAll(
    'SELECT * FROM loading_plan_events WHERE plan_id = ? AND id > ? ORDER BY id LIMIT 500',
    [planId, since]
  );
  res.json({
    data: rows.map(r => ({
      id: r.id,
      plan_id: r.plan_id,
      actor_user_id: r.actor_user_id,
      actor_display: r.actor_display,
      action: r.action,
      payload: r.payload ? JSON.parse(r.payload) : null,
      created_at: r.created_at
    }))
  });
}));

// ===== POST /plans/:id/items/bulk（Excel 貼上：一次多列）=====
function fieldsFromRow(row, c) {
  const volume = resolveVolume(row || {}, c);
  const pkgs = pkgsOf(row || {}, c);
  const unit = ['cbm', 'cuft', 'vol'].includes((row || {}).volume_input_unit) ? row.volume_input_unit : 'cbm';
  // CRD：DDMMM／ISO 都接受；能解析就統一存 ISO（YYYY-MM-DD），無法解析才原樣保留
  const crdRaw = str((row || {}).cargo_receipt, 20);
  const cargoReceipt = crdRaw ? (c.lpCrdToIso(crdRaw, c.lpTodayIso()) || crdRaw) : '';
  return {
    mawb: c.lpDisplayMawb((row || {}).mawb),
    client: str((row || {}).client, 80),
    dest: str((row || {}).dest, 10).toUpperCase(),
    tag: strMultiline((row || {}).tag, 500),
    pkgs_text: pkgs.pkgsText,
    cartons: pkgs.cartons,
    pallets: pkgs.pallets,
    pcs_total: pkgs.pcsTotal,
    gross_weight: numOrNull((row || {}).gross_weight) || 0,
    volume_weight: volume.vol,
    volume_source: volume.volumeSource,
    cbm: volume.cbm,
    cuft: volume.cuft,
    volume_input_unit: unit,
    cargo_receipt: cargoReceipt,
    // 備註是自由文字（Booking modal 的 DIM 一組一行）→ 保留換行
    remark: strMultiline((row || {}).remark, 500),
    section: Math.max(1, intOrNull((row || {}).section) || 1),
    dg_no_power: (row || {}).dg_no_power,
    dg_966: (row || {}).dg_966,
    dg_967: (row || {}).dg_967,
    dg_969: (row || {}).dg_969,
    dg_970: (row || {}).dg_970,
    h_af: (row || {}).h_af,
    h_fs: (row || {}).h_fs,
    h_sc: (row || {}).h_sc,
    h_vol: (row || {}).h_vol,
    h_ctg: (row || {}).h_ctg,
    h_xray: (row || {}).h_xray
  };
}

router.post('/plans/:id/items/bulk', handle(async (req, res) => {
  const c = await calc();
  const planId = Number(req.params.id);
  const plan = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [planId]);
  if (!plan) return res.status(404).json({ error: '找不到這張 plan' });
  if (plan.status === 'locked') return res.status(409).json({ error: '這張 plan 已鎖定' });

  const rows = Array.isArray((req.body || {}).rows) ? req.body.rows.slice(0, 500) : [];
  if (!rows.length) return res.status(422).json({ error: '請提供 rows（最多 500 列）' });

  const ids = await withTransaction(async () => {
    const records = await dbAll('SELECT id, mawb FROM mawb_records');
    const byKey = new Map();
    records.forEach((r) => {
      const key = c.lpNormalizeMawbKey(r.mawb);
      if (key && !byKey.has(key)) byKey.set(key, r.id);
    });

    let next = await nextSortOrder(planId);
    const created = [];
    for (const row of rows) {
      const fields = fieldsFromRow(row, c);
      const key = c.lpNormalizeMawbKey(fields.mawb);
      if (key) {
        if (byKey.has(key)) {
          fields.mawb_record_id = byKey.get(key);
        } else {
          const ins = await dbRun(
            `INSERT INTO mawb_records (mawb, hawb, client, dest, pcs, gross_weight, volume_weight, cbm, spl, remark)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
            [fields.mawb, fields.tag || '', fields.client || '', fields.dest || '',
              fields.pcs_total || 0, fields.gross_weight || 0, fields.volume_weight || 0, fields.cbm || 0, fields.remark || '']
          );
          byKey.set(key, ins.lastID);
          fields.mawb_record_id = ins.lastID;
        }
      }
      created.push(await insertItem(planId, fields, next++));
    }
    return created;
  });

  const updated = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [planId]);
  const detail = await planRowWithTotals(updated);
  await logEvent(req, planId, 'item.bulk', { count: ids.length });
  writeAuditLog(req, 'loading_plan.items.bulk', planId, `貼上 ${ids.length} 列`);
  res.status(201).json({ ok: true, ids, data: detail.plan, items: detail.items });
}));

// ===== GET /stock（存貨 plan＋明細）=====
router.get('/stock', handle(async (req, res) => {
  const stock = await ensureStockPlan();
  const detail = await planRowWithTotals(stock);
  res.json({ data: detail.plan, items: detail.items });
}));

// ===== GET /plans/:id/export.xlsx（輸出成 Excel；版面貼近 AGL執PLAN）=====
router.get('/plans/:id/export.xlsx', handle(async (req, res) => {
  const c = await calc();
  const id = Number(req.params.id);
  const plan = await dbGet('SELECT * FROM loading_plans WHERE id = ?', [id]);
  if (!plan) return res.status(404).json({ error: '找不到這張 plan' });

  const items = await dbAll(
    'SELECT * FROM loading_plan_items WHERE plan_id = ? ORDER BY section, sort_order, id', [id]
  );
  const totals = c.lpKpi(items, planLimits(plan));
  const view = plan.volume_view === 'cuft' ? 'cuft' : 'vol';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'AGL Web Portal';
  const sheet = wb.addWorksheet((plan.day_code || 'PLAN').toString().slice(0, 28) || 'PLAN');

  const title = (range, text) => {
    sheet.mergeCells(range);
    const cell = sheet.getCell(range.split(':')[0]);
    cell.value = text;
    cell.font = { bold: true, size: 10 };
  };
  title('A1:F1', `FLIGHT NO.: ${plan.flight_no || ''}  ${plan.day_code || ''}`);
  title('G1:I1', `ETD: ${plan.etd || ''}`);
  title('J1:L1', `CONTOUR: ${plan.contour_text || plan.contour_code || ''}`);
  title('A2:F2', `Flight Date: ${plan.flight_date || ''}`);
  title('G2:I2', `Owner: ${plan.owner_company || ''}`);
  title('J2:L2', `Plan: ${plan.plan_no || ''}`);

  const headers = ['CLIENT', 'MAWB', 'HAWB / TAG', 'DEST', 'PKGS', 'G.W',
    view === 'cuft' ? 'cu.ft' : 'VOL', 'CBM', 'CARGO RECEIPT', 'REMARK'];
  const headRow = sheet.getRow(4);
  headers.forEach((text, index) => {
    const cell = headRow.getCell(index + 1);
    cell.value = text;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
    cell.border = { bottom: { style: 'thin' } };
  });
  headRow.commit();

  items.forEach((item, index) => {
    const row = sheet.getRow(5 + index);
    const volume = c.lpItemVolume(item);
    row.getCell(1).value = item.client || '';
    row.getCell(2).value = item.mawb || '';
    row.getCell(3).value = item.tag || '';
    row.getCell(4).value = item.dest || '';
    row.getCell(5).value = item.pkgs_text || '';
    row.getCell(6).value = Number(item.gross_weight) || 0;
    row.getCell(7).value = view === 'cuft' ? volume.cuft : volume.vol;
    row.getCell(8).value = Number(item.cbm) || 0;
    row.getCell(9).value = item.cargo_receipt || '';
    row.getCell(10).value = item.remark || '';
    row.getCell(6).numFmt = '#,##0.00';
    row.getCell(7).numFmt = '#,##0.00';
    row.getCell(8).numFmt = '0.000';
    row.commit();
  });

  const last = 4 + items.length;
  const totalRow = sheet.getRow(last + 1);
  totalRow.getCell(1).value = 'TOTAL';
  totalRow.getCell(1).font = { bold: true };
  totalRow.getCell(6).value = { formula: `SUM(F5:F${last})`, result: totals.grossWeight };
  totalRow.getCell(7).value = { formula: `SUM(G5:G${last})`, result: view === 'cuft' ? totals.cuft : totals.vol };
  totalRow.getCell(8).value = { formula: `SUM(H5:H${last})`, result: totals.cbm };
  [6, 7, 8].forEach((col) => {
    totalRow.getCell(col).numFmt = col === 8 ? '0.000' : '#,##0.00';
    totalRow.getCell(col).font = { bold: true };
  });
  totalRow.commit();

  [22, 18, 16, 8, 12, 10, 10, 10, 14, 40].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.views = [{ state: 'frozen', ySplit: 4 }];

  const filename = `${plan.plan_no || 'loading-plan'}.xlsx`;
  const buffer = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]+/g, '_')}"`);
  await logEvent(req, id, 'plan.export', { tickets: items.length, format: 'xlsx' });
  res.send(Buffer.from(buffer));
}));

// ===== Presence（誰在看哪張 plan／正在改哪一格）=====
const PRESENCE_TTL_SEC = 40;

async function prunePresence() {
  await dbRun(`DELETE FROM loading_plan_presence WHERE updated_at < datetime('now', '-${PRESENCE_TTL_SEC} seconds')`);
}

async function activePresence(planId) {
  await prunePresence();
  const rows = planId
    ? await dbAll('SELECT * FROM loading_plan_presence WHERE plan_id = ? ORDER BY updated_at DESC', [planId])
    : await dbAll('SELECT * FROM loading_plan_presence ORDER BY updated_at DESC');
  return rows.map(r => ({
    conn_id: r.conn_id,
    plan_id: r.plan_id,
    user_id: r.user_id,
    display: r.display,
    editing_item_id: r.editing_item_id,
    updated_at: r.updated_at
  }));
}

function broadcastPresence(planId) {
  activePresence(planId)
    .then(list => bus.publish({
      id: 0,
      plan_id: planId ? Number(planId) : null,
      action: 'presence.update',
      payload: list,
      created_at: new Date().toISOString()
    }))
    .catch(err => console.error('[loading-plan] presence 廣播失敗:', err.message));
}

router.post('/presence', handle(async (req, res) => {
  const actor = actorOf(req);
  const body = req.body || {};
  const connId = str(body.conn_id, 80) || `${actor.id || 'anon'}-${Date.now()}`;
  const planId = intOrNull(body.plan_id);
  const editing = intOrNull(body.editing_item_id);

  await prunePresence();
  const existing = await dbGet('SELECT conn_id, plan_id FROM loading_plan_presence WHERE conn_id = ?', [connId]);
  if (existing) {
    await dbRun(
      `UPDATE loading_plan_presence
          SET plan_id = ?, user_id = ?, display = ?, editing_item_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE conn_id = ?`,
      [planId, actor.id, actor.display, editing, connId]
    );
  } else {
    await dbRun(
      `INSERT INTO loading_plan_presence (conn_id, plan_id, user_id, display, editing_item_id)
       VALUES (?, ?, ?, ?, ?)`,
      [connId, planId, actor.id, actor.display, editing]
    );
  }

  if (existing && Number(existing.plan_id) !== Number(planId)) broadcastPresence(existing.plan_id);
  broadcastPresence(planId);
  res.json({ ok: true, conn_id: connId });
}));

router.delete('/presence/:connId', handle(async (req, res) => {
  const connId = str(req.params.connId, 80);
  const row = await dbGet('SELECT plan_id FROM loading_plan_presence WHERE conn_id = ?', [connId]);
  await dbRun('DELETE FROM loading_plan_presence WHERE conn_id = ?', [connId]);
  if (row) broadcastPresence(row.plan_id);
  res.json({ ok: true });
}));

router.get('/presence', handle(async (req, res) => {
  res.json({ data: await activePresence(intOrNull(req.query.plan_id)) });
}));

// ===== GET /events（SSE：即時同步；支援 Last-Event-ID 補送）=====
function sseWrite(res, event) {
  if (res.writableEnded) return;
  try {
    res.write(`id: ${event.id || 0}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch (err) { /* 連線已斷 */ }
}

router.get('/events', handle(async (req, res) => {
  const planId = intOrNull(req.query.plan_id);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write('retry: 3000\n\n');

  const since = Math.max(0, Number(req.headers['last-event-id'] || req.query.since || 0) || 0);
  const replay = planId
    ? await dbAll('SELECT * FROM loading_plan_events WHERE plan_id = ? AND id > ? ORDER BY id LIMIT 500', [planId, since])
    : await dbAll('SELECT * FROM loading_plan_events WHERE id > ? ORDER BY id LIMIT 500', [since]);
  replay.forEach((row) => sseWrite(res, {
    id: row.id,
    plan_id: row.plan_id,
    action: row.action,
    payload: row.payload ? JSON.parse(row.payload) : null,
    actor_user_id: row.actor_user_id,
    actor_display: row.actor_display,
    created_at: row.created_at
  }));

  sseWrite(res, {
    id: 0, plan_id: planId, action: 'presence.snapshot',
    payload: await activePresence(planId), created_at: new Date().toISOString()
  });

  const unsubscribe = bus.subscribe((event) => {
    if (!planId) return sseWrite(res, event);
    if (event.plan_id === null || event.plan_id === planId) sseWrite(res, event);
  });

  const ping = setInterval(() => {
    if (!res.writableEnded) { try { res.write(': ping\n\n'); } catch (err) { /* ignore */ } }
  }, 25000);
  if (res.socket && typeof res.socket.setTimeout === 'function') res.socket.setTimeout(0);

  req.on('close', () => { clearInterval(ping); unsubscribe(); });
}));

// ===== GET /events.json（SSE 不通時退回輪詢）=====
router.get('/events.json', handle(async (req, res) => {
  const planId = intOrNull(req.query.plan_id);
  const since = Math.max(0, intOrNull(req.query.since) || 0);
  const rows = planId
    ? await dbAll('SELECT * FROM loading_plan_events WHERE plan_id = ? AND id > ? ORDER BY id LIMIT 200', [planId, since])
    : await dbAll('SELECT * FROM loading_plan_events WHERE id > ? ORDER BY id LIMIT 200', [since]);
  res.json({
    events: rows.map(r => ({
      id: r.id, plan_id: r.plan_id, action: r.action,
      payload: r.payload ? JSON.parse(r.payload) : null,
      actor_user_id: r.actor_user_id, actor_display: r.actor_display, created_at: r.created_at
    })),
    presence: await activePresence(planId)
  });
}));

// 統一的錯誤回應（Express 4 不會自動攔 async 例外）
router.use((err, req, res, next) => {
  console.error('[loading-plan] API 錯誤:', err && err.message);
  if (res.headersSent) return next(err);
  if (err && /UNIQUE constraint failed/.test(String(err.message))) {
    return res.status(409).json({ error: '同一票 MAWB 已在這個 plan（請改用搬移或複製到其他 plan）' });
  }
  res.status(500).json({ error: '伺服器錯誤' });
});

module.exports = router;
