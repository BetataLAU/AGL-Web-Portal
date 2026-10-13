// ===== Shipper Role Project - SLI/ELI 版面編輯器 API（P5）=====
// 掛載於 /api/xls-booking/layout（上層 routes/xls-booking.js 已有 requireAuth）
//   GET  /                     - 讀取作用中 fieldmap ＋ 預設值 ＋ 頁面／底圖／樣本／權限
//   PUT  /                     - 儲存欄位座標（admin/staff；驗證 → 備份 → 寫檔）
//   POST /reset                - 還原成 Excel 校準預設值（admin/staff；可指定 keys）
//   POST /preview              - 用草稿 fieldmap ＋ 樣本／真實資料產生排版與測試 PDF
//   GET  /backups              - 備份清單（admin/staff）
//   GET  /background/:page     - 底圖 PNG（data/templates/sli-eli-blank-pN.png）
//
// 設計原則（PRD §2 P5）：
//   1. 排版數學（換行／對齊／baseline）一律沿用 scripts/sli-eli-overlay.js（engine.layout()），
//      不在這裡重寫 → 「編輯器看到什麼 == PDF 長什麼」。
//   2. 只允許編輯白名單欄位屬性（origin / box / font / align / wrap / lineHeightPt）；
//      textBaselineOffsetPt、wrapWidthPt、maxLines 由後端依 baseline 模型與 box 變動量推導。
//   3. 每次寫檔前備份 sli-eli-fieldmap.bak-<ts>.json，可回溯。

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { TEMPLATES_DIR, WORK_DIR } = require('./xls-booking-helpers');
const { requireRole } = require('./auth/middleware');
const { createOverlayEngine, A4_SIZE } = require('../scripts/sli-eli-overlay');

const router = express.Router();

const ACTIVE_FILE = path.join(TEMPLATES_DIR, 'sli-eli-fieldmap.json');
const DEFAULT_FILE = path.join(TEMPLATES_DIR, 'sli-eli-fieldmap.default.json');
const BACKUP_PREFIX = 'sli-eli-fieldmap.bak-';
const EDITOR_ROLES = ['admin', 'staff'];

// 預設 baseline 模型（Arial hhea；fieldmap 內有 calibration.baselineModel 時以其為準）
const DEFAULT_BASELINE = { ascentEm: 0.9053, descentEm: 0.2124 };
const PAGE_TOLERANCE_PT = 2;   // 允許超出頁面邊界 2pt（Excel 合併格邊界常有 ±1pt 誤差）
const BOX_MIN_PT = 2;          // 文字框最小尺寸
const FONT_MIN_PT = 4;
const FONT_MAX_PT = 72;
const LINE_HEIGHT_MIN_PT = 1;
const LINE_HEIGHT_MAX_PT = 72;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ===== 讀寫 =====
async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf-8'));
}

async function writeJson(file, obj) {
  await fsp.writeFile(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf-8');
}

function baselineModelOf(fieldmap) {
  const bm = (fieldmap && fieldmap.calibration && fieldmap.calibration.baselineModel) || {};
  return {
    ascentEm: isNum(bm.ascentEm) ? bm.ascentEm : DEFAULT_BASELINE.ascentEm,
    descentEm: isNum(bm.descentEm) ? bm.descentEm : DEFAULT_BASELINE.descentEm,
  };
}

/**
 * 由垂直對齊與字級推導 baseline 相對 origin.y 的偏移（Excel 用「行盒」定位，非墨跡）。
 * v=top → +ascent×size；v=bottom → −descent×size；v=center → +(ascent−descent)/2×size
 */
function textBaselineOffsetOf(alignV, sizePt, model) {
  const size = isNum(sizePt) && sizePt > 0 ? sizePt : 8;
  if (alignV === 'bottom') return round2(-model.descentEm * size);
  if (alignV === 'center') return round2(((model.ascentEm - model.descentEm) / 2) * size);
  return round2(model.ascentEm * size);
}

async function listBackups() {
  try {
    const names = (await fsp.readdir(TEMPLATES_DIR)).filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith('.json'));
    const items = [];
    for (const name of names) {
      const st = await fsp.stat(path.join(TEMPLATES_DIR, name));
      items.push({ name, bytes: st.size, mtime: st.mtime.toISOString() });
    }
    return items.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  } catch (e) {
    return [];
  }
}

async function backupActive() {
  // 含毫秒 → 同一秒內連續操作（儲存後立刻還原）不會互相覆蓋
  const d = new Date();
  const pad = (n, l) => String(n).padStart(l || 2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;
  let dest = path.join(TEMPLATES_DIR, `${BACKUP_PREFIX}${ts}.json`);
  if (fs.existsSync(dest)) dest = path.join(TEMPLATES_DIR, `${BACKUP_PREFIX}${ts}-${crypto.randomBytes(2).toString('hex')}.json`);
  await fsp.copyFile(ACTIVE_FILE, dest);
  return path.basename(dest);
}

// ===== 驗證與推導 =====
/**
 * 驗證單一欄位 patch，並產生「乾淨的」可寫入值。
 * base = 目前作用中的欄位定義；pageMap = 該欄位所在頁面（驗證邊界）
 */
function sanitizePatch(patch, base, pageMap, model) {
  if (!patch || typeof patch !== 'object') return { errors: ['欄位資料格式不正確'] };
  const errors = [];
  const key = String(patch.key || '');
  if (!base) return { errors: [`未知欄位：${key || '(空)'}`] };

  // --- origin（文字錨點）---
  const origin = patch.origin || {};
  const ox = isNum(origin.x) ? origin.x : base.origin.x;
  const oy = isNum(origin.y) ? origin.y : base.origin.y;
  // --- box（文字框）---
  const box = patch.box || {};
  const bx = isNum(box.x) ? box.x : base.box.x;
  const by = isNum(box.y) ? box.y : base.box.y;
  const bw = isNum(box.w) ? box.w : base.box.w;
  const bh = isNum(box.h) ? box.h : base.box.h;
  if (bw < BOX_MIN_PT || bh < BOX_MIN_PT) errors.push(`文字框尺寸過小（w/h ≥ ${BOX_MIN_PT}pt）`);
  if (pageMap) {
    const { widthPt, heightPt } = pageMap;
    if (bx < -PAGE_TOLERANCE_PT || by < -PAGE_TOLERANCE_PT
      || bx + bw > widthPt + PAGE_TOLERANCE_PT || by + bh > heightPt + PAGE_TOLERANCE_PT) {
      errors.push(`文字框超出頁面（頁面 ${widthPt}×${heightPt}pt）`);
    }
    if (ox < -PAGE_TOLERANCE_PT || oy < -PAGE_TOLERANCE_PT || ox > widthPt + PAGE_TOLERANCE_PT || oy > heightPt + PAGE_TOLERANCE_PT) {
      errors.push('文字錨點超出頁面');
    }
  }
  // --- font ---
  const font = patch.font || {};
  const sizePt = isNum(font.sizePt) ? clamp(font.sizePt, FONT_MIN_PT, FONT_MAX_PT) : base.font.sizePt;
  const bold = typeof font.bold === 'boolean' ? font.bold : !!base.font.bold;
  const color = typeof font.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(font.color) ? font.color.toUpperCase() : base.font.color;
  // --- align ---
  const align = patch.align || {};
  const ah = ['left', 'center', 'right'].includes(align.h) ? align.h : base.align.h;
  const av = ['top', 'center', 'bottom'].includes(align.v) ? align.v : base.align.v;
  // --- wrap / lineHeight ---
  const wrap = typeof patch.wrap === 'boolean' ? patch.wrap : !!base.wrap;
  const lhRaw = isNum(patch.lineHeightPt) && patch.lineHeightPt > 0 ? patch.lineHeightPt : null;
  const lineHeightPt = round2(clamp(lhRaw || base.lineHeightPt || sizePt * 1.2, LINE_HEIGHT_MIN_PT, LINE_HEIGHT_MAX_PT));

  if (errors.length) return { errors };

  // --- 推導值 ---
  const dw = round2(bw - base.box.w);
  const baseWrap = isNum(base.wrapWidthPt) ? base.wrapWidthPt : base.box.w;
  const wrapWidthPt = round2(Math.max(1, baseWrap + dw));       // 換行寬度跟著文字框寬度變動
  const maxLines = wrap ? Math.max(1, Math.floor(bh / lineHeightPt)) : 1;
  const textBaselineOffsetPt = textBaselineOffsetOf(av, sizePt, model);

  return {
    errors: [],
    value: {
      key,
      origin: { x: round2(ox), y: round2(oy) },
      box: { x: round2(bx), y: round2(by), w: round2(bw), h: round2(bh) },
      font: { ...base.font, sizePt: round2(sizePt), bold, color },
      align: { h: ah, v: av },
      wrap,
      lineHeightPt,
      wrapWidthPt,
      maxLines,
      textBaselineOffsetPt,
    },
  };
}

/** 把 patches 套用到 fieldmap 副本；回傳 { fieldmap, changed, errors } */
function applyPatches(activeMap, patches, defaultMap) {
  const model = baselineModelOf(activeMap);
  const pages = Array.isArray(activeMap.pages) ? activeMap.pages : [];
  const byKey = new Map((activeMap.fields || []).map((f) => [f.key, f]));
  const defaults = new Map(((defaultMap && defaultMap.fields) || []).map((f) => [f.key, f]));
  const list = Array.isArray(patches) ? patches : [];
  if (!list.length) return { fieldmap: activeMap, changed: [], errors: ['未提供任何欄位變更'] };

  const nextFields = (activeMap.fields || []).map((f) => ({
    ...f, origin: { ...f.origin }, box: { ...f.box }, font: { ...f.font }, align: { ...f.align },
  }));
  const byKeyNext = new Map(nextFields.map((f) => [f.key, f]));
  const errors = [];
  const changed = [];
  const sig = (f) => JSON.stringify({ origin: f.origin, box: f.box, font: f.font, align: f.align, wrap: !!f.wrap, lineHeightPt: f.lineHeightPt });

  for (const patch of list) {
    const key = String((patch && patch.key) || '');
    const base = byKey.get(key) || defaults.get(key);
    if (!base) { errors.push(`${key || '(空)'}：未知欄位`); continue; }
    const pageMap = pages.find((p) => Number(p.index) === Number(base.page));
    const res = sanitizePatch(patch, base, pageMap, model);
    if (res.errors.length) { errors.push(`${key}：${res.errors.join('；')}`); continue; }
    const target = byKeyNext.get(key);
    if (!target) { errors.push(`${key}：欄位不存在`); continue; }
    const before = sig(target);
    const v = res.value;
    target.origin = v.origin;
    target.box = v.box;
    target.font = v.font;
    target.align = v.align;
    target.wrap = v.wrap;
    target.lineHeightPt = v.lineHeightPt;
    target.wrapWidthPt = v.wrapWidthPt;
    target.maxLines = v.maxLines;
    target.textBaselineOffsetPt = v.textBaselineOffsetPt;
    if (before !== sig(target)) changed.push(key);
  }

  if (errors.length) return { fieldmap: activeMap, changed: [], errors };
  return { fieldmap: { ...activeMap, fields: nextFields }, changed, errors: [] };
}

/** 由預設值還原指定欄位（keys 省略＝全部） */
function resetFields(activeMap, defaultMap, keys) {
  const want = Array.isArray(keys) && keys.length ? new Set(keys.map(String)) : null;
  const defaults = new Map(((defaultMap && defaultMap.fields) || []).map((f) => [f.key, f]));
  const changed = [];
  const nextFields = (activeMap.fields || []).map((f) => {
    if (want && !want.has(f.key)) return f;
    const d = defaults.get(f.key);
    if (!d) return f;
    changed.push(f.key);
    return JSON.parse(JSON.stringify(d));
  });
  return { fieldmap: { ...activeMap, fields: nextFields }, changed };
}

// ===== 樣本資料（即時預覽用）=====
// 內建樣本一律使用 Latin-1 可繪字元，確保疊字引擎一定能產生預覽。
const SAMPLE_RECORD = {
  mawb: '160-88888888',
  sli: {
    D23: '160-88888888',
    D25: 'CX',
    D27: 'LHR',
    D9: 'GLOBEXAIR LTD (DAY)\nUNIT 7A FAIRLIE ROAD\nSLOUGH SL1 4PY',
    D72: '2026-10-03',
  },
  eli: {
    F8: '160-88888888',
    P11: 'LHR',
    M16: 'GLOBEXAIR LTD (DAY)\nUNIT 7A FAIRLIE ROAD\nSLOUGH SL1 4PY',
    N21: '+44 20 1234 5678',
    N57: '2026-10-03',
  },
};

/** 掃描最近的 job payload 取出真實樣本（最多 limit 筆） */
async function listJobSamples(engine, limit = 3) {
  const items = [];
  try {
    const dirs = (await fsp.readdir(WORK_DIR, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name.startsWith('job-'))
      .map((d) => path.join(WORK_DIR, d.name));
    const candidates = [];
    for (const dir of dirs) {
      try {
        const st = await fsp.stat(path.join(dir, 'sli-eli-payload.json'));
        candidates.push({ dir, mtime: st.mtimeMs });
      } catch (e) { /* 沒有 payload 的 job 略過 */ }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    for (const cand of candidates) {
      if (items.length >= limit) break;
      let records = [];
      try {
        const data = JSON.parse(await fsp.readFile(path.join(cand.dir, 'sli-eli-payload.json'), 'utf-8'));
        records = Array.isArray(data.records) ? data.records : [];
      } catch (e) { continue; }
      for (const rec of records) {
        if (items.length >= limit) break;
        const job = path.basename(cand.dir);
        const check = engine ? engine.check(rec) : { ok: true, unsupported: [] };
        items.push({
          id: `${job}:${rec.mawb}`,
          label: `${rec.mawb}（${job}）`,
          latin1: check.ok,
          unsupported: check.ok ? '' : check.unsupported.map((u) => `${u.label}`).join('、'),
        });
      }
    }
  } catch (e) { /* 沒有 data/work → 只回內建樣本 */ }
  return items;
}

/** 由 sampleId 取出記錄（'sample' 或 'job-xxxx:MAWB'） */
async function resolveRecord(sampleId) {
  if (!sampleId || sampleId === 'sample') {
    return { id: 'sample', label: '內建範例資料', record: SAMPLE_RECORD };
  }
  const idx = String(sampleId).indexOf(':');
  if (idx <= 0) return null;
  const job = String(sampleId).slice(0, idx);
  const mawb = String(sampleId).slice(idx + 1);
  if (!/^job-[A-Za-z0-9]+$/.test(job)) return null; // 防路徑穿越
  try {
    const data = JSON.parse(await fsp.readFile(path.join(WORK_DIR, job, 'sli-eli-payload.json'), 'utf-8'));
    const rec = (data.records || []).find((r) => String(r.mawb) === mawb);
    if (rec) return { id: sampleId, label: `${mawb}（${job}）`, record: rec };
  } catch (e) { /* ignore */ }
  return null;
}

// ===== 引擎輔助 =====
// 草稿 fieldmap（未儲存的編輯）→ 寫暫存檔給引擎載入（engine 只接受路徑），跑完刪除。
async function withEngine(fieldmapObj, fn) {
  if (!fieldmapObj) {
    const engine = await createOverlayEngine({ strict: true });
    return fn(engine);
  }
  await fsp.mkdir(WORK_DIR, { recursive: true });
  const draft = path.join(WORK_DIR, `layout-draft-${crypto.randomBytes(4).toString('hex')}.json`);
  await writeJson(draft, fieldmapObj);
  try {
    const engine = await createOverlayEngine({ fieldmap: draft, strict: true });
    return await fn(engine);
  } finally {
    await fsp.unlink(draft).catch(() => {});
  }
}

/** 排版結果（**由 engine.layout() 產生** → 與 PDF 完全同一套數學）＋ 欄位框線資訊 */
async function buildLayoutPayload(engine, fields, record) {
  const layout = await engine.layout(record);
  const byKey = new Map((fields || []).map((f) => [f.key, f]));
  return layout.map((item) => {
    const f = byKey.get(item.key) || {};
    return {
      key: item.key,
      page: Number(f.page) || 0,
      label: f.label || item.key,
      source: item.source,
      value: item.value,
      lines: item.lines,
      positions: item.positions,
      sizePt: item.sizePt,
      lineHeightPt: item.lineHeightPt,
      bold: !!(f.font && f.font.bold),
      color: (f.font && f.font.color) || '#000000',
      align: f.align || { h: 'left', v: 'top' },
      wrap: !!f.wrap,
      box: f.box || null,
      origin: f.origin || null,
      wrapWidthPt: f.wrapWidthPt,
      maxLines: f.maxLines,
      textBaselineOffsetPt: f.textBaselineOffsetPt,
    };
  });
}

// ===== API: 讀取目前設定 =====
router.get('/', async (req, res) => {
  try {
    const active = await readJson(ACTIVE_FILE);
    let def = null;
    try { def = await readJson(DEFAULT_FILE); } catch (e) { def = null; }
    const role = (req.session.user && req.session.user.role) || '';
    const canEdit = EDITOR_ROLES.includes(role);

    const samples = [{ id: 'sample', label: '內建範例資料（保證可疊字）', latin1: true, unsupported: '' }];
    let engineIssue = null;
    let blankBytes = null;
    let pageSizes = null;
    try {
      const engine = await createOverlayEngine({ strict: false });
      blankBytes = engine.blankBytes;
      pageSizes = engine.pageSizes;
      engineIssue = engine.issues.length ? engine.issues.join('；') : null;
      samples.push(...(await listJobSamples(engine)));
    } catch (e) {
      engineIssue = e.message;
    }

    res.json({
      ok: true,
      canEdit,
      role,
      activePath: 'data/templates/sli-eli-fieldmap.json',
      fieldmap: active,
      defaultFieldmap: def,
      baselineModel: baselineModelOf(active),
      samples,
      backups: canEdit ? await listBackups() : [],
      blankBytes,
      pageSizes,
      engineIssue,
      updatedAt: active.editedAt || active.generatedAt || null,
      editorRoles: EDITOR_ROLES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 儲存（admin / staff）=====
router.put('/', requireRole(...EDITOR_ROLES), async (req, res) => {
  try {
    const patches = (req.body && req.body.fields) || [];
    const active = await readJson(ACTIVE_FILE);
    let def = null;
    try { def = await readJson(DEFAULT_FILE); } catch (e) { def = null; }

    const applied = applyPatches(active, patches, def);
    if (applied.errors.length) {
      return res.status(400).json({ error: applied.errors.join('；'), errors: applied.errors });
    }
    if (!applied.changed.length) {
      return res.json({ ok: true, changed: [], backup: null, fieldmap: active, message: '沒有變更（未寫檔）' });
    }
    const backup = await backupActive();
    const user = req.session.user || {};
    const fieldmap = {
      ...applied.fieldmap,
      editedAt: new Date().toISOString(),
      editedBy: user.user_id || null,
      editedByRole: user.role || null,
    };
    await writeJson(ACTIVE_FILE, fieldmap);
    res.json({ ok: true, changed: applied.changed, backup, fieldmap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 還原成 Excel 校準預設值（admin / staff）=====
router.post('/reset', requireRole(...EDITOR_ROLES), async (req, res) => {
  try {
    const keys = (req.body && req.body.keys) || null;
    const active = await readJson(ACTIVE_FILE);
    let def = null;
    try { def = await readJson(DEFAULT_FILE); } catch (e) { def = null; }
    if (!def) return res.status(500).json({ error: '找不到預設 fieldmap（sli-eli-fieldmap.default.json）' });

    const result = resetFields(active, def, keys);
    if (!result.changed.length) {
      return res.json({ ok: true, changed: [], backup: null, fieldmap: active, message: '沒有變更（已是最新）' });
    }
    const backup = await backupActive();
    const user = req.session.user || {};
    const fieldmap = {
      ...result.fieldmap,
      editedAt: new Date().toISOString(),
      editedBy: user.user_id || null,
      editedByRole: user.role || null,
      resetAt: new Date().toISOString(),
    };
    await writeJson(ACTIVE_FILE, fieldmap);
    res.json({ ok: true, changed: result.changed, backup, fieldmap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ===== API: 預覽（排版結果 + 可選測試 PDF）=====
router.post('/preview', async (req, res) => {
  try {
    const body = req.body || {};
    const active = await readJson(ACTIVE_FILE);
    let def = null;
    try { def = await readJson(DEFAULT_FILE); } catch (e) { def = null; }

    let draft = active;
    if (Array.isArray(body.fields) && body.fields.length) {
      const applied = applyPatches(active, body.fields, def);
      if (applied.errors.length) {
        return res.status(400).json({ error: applied.errors.join('；'), errors: applied.errors });
      }
      draft = applied.fieldmap;
    }
    const sample = await resolveRecord(body.sampleId);
    if (!sample) return res.status(404).json({ error: '找不到樣本資料（該 job 可能已被清理，請改用內建範例）' });

    const useDraft = draft !== active;
    const t0 = Date.now();
    const result = await withEngine(useDraft ? draft : null, async (engine) => {
      const check = engine.check(sample.record);
      const fields = await buildLayoutPayload(engine, draft.fields, sample.record);
      let pdf = null;
      if (body.wantPdf && check.ok) {
        // 注意：engine.render() 的 `bytes` 是「位元組數」而非內容 → 需落地讀回
        await fsp.mkdir(WORK_DIR, { recursive: true });
        const tmpPdf = path.join(WORK_DIR, `layout-preview-${crypto.randomBytes(4).toString('hex')}.pdf`);
        try {
          const r = await engine.render(sample.record, tmpPdf);
          if (r.status === 'ok') {
            const buf = await fsp.readFile(tmpPdf);
            pdf = { base64: buf.toString('base64'), bytes: buf.length, ms: Math.round(r.ms) };
          }
        } finally {
          await fsp.unlink(tmpPdf).catch(() => {});
        }
      }
      return { check, fields, pdf, pageSizes: engine.pageSizes, blankBytes: engine.blankBytes, issues: engine.issues };
    });

    res.json({
      ok: true,
      renderable: result.check.ok,
      fallback: result.check.ok ? null : {
        message: '此樣本含 pdf-lib 標準字型不支援的字元；正式產生時該筆會自動退回 Excel 引擎（預覽仍顯示可支援欄位的位置）',
        unsupported: result.check.unsupported.map((u) => ({ key: u.key, label: u.label, sample: u.sample })),
      },
      sample: { id: sample.id, label: sample.label, mawb: sample.record.mawb },
      pages: (draft.pages || []).map((p) => ({
        index: p.index, label: p.label, widthPt: p.widthPt, heightPt: p.heightPt, background: p.background, sheet: p.sheet,
      })),
      fields: result.fields,
      pdf: result.pdf,
      usedDraft: useDraft,
      pageSizes: result.pageSizes,
      blankBytes: result.blankBytes,
      issues: result.issues,
      ms: Date.now() - t0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 備份清單（admin / staff）=====
router.get('/backups', requireRole(...EDITOR_ROLES), async (req, res) => {
  try {
    res.json({ ok: true, backups: await listBackups() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 底圖 PNG（供編輯器顯示）=====
router.get('/background/:page', async (req, res) => {
  try {
    const active = await readJson(ACTIVE_FILE);
    const page = (active.pages || []).find((p) => Number(p.index) === Number(req.params.page));
    if (!page || !page.background) return res.status(404).json({ error: '找不到底圖設定' });
    const file = path.join(TEMPLATES_DIR, path.basename(String(page.background)));
    if (!fs.existsSync(file)) return res.status(404).json({ error: '底圖檔案不存在（請重跑 scripts/build-sli-eli-blank.py）' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=30');
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// 供測試直接驗證純邏輯（不經 HTTP）
module.exports._internals = {
  ACTIVE_FILE,
  DEFAULT_FILE,
  BACKUP_PREFIX,
  SAMPLE_RECORD,
  readJson,
  writeJson,
  baselineModelOf,
  textBaselineOffsetOf,
  sanitizePatch,
  applyPatches,
  resetFields,
  listBackups,
  listJobSamples,
  resolveRecord,
  buildLayoutPayload,
};
