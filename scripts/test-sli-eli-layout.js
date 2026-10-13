// ===== Shipper Role Project - P5 版面編輯器驗證（自帶伺服器端對端）=====
// 驗收項目（PRD §2 P5）：
//   1) GET  /api/xls-booking/layout                - fieldmap／預設／頁面／底圖／樣本／權限
//   2) POST /api/xls-booking/layout/preview        - 排版（engine.layout()）＋可選測試 PDF
//   3) PUT  /api/xls-booking/layout                - 驗證（超界／未知欄位 400）＋備份＋寫檔生效
//   4) POST /api/xls-booking/layout/reset          - 還原成 Excel 校準預設值（可指定 keys）
//   5) 幾何一致性：改動 origin/box 後，預覽文字位置必須跟著位移（＝與 PDF 同一套數學）
//
// 用法：node scripts/test-sli-eli-layout.js
//   注意：會暫時改寫 data/templates/sli-eli-fieldmap.json，結束時還原成原始內容並清掉本次備份。
//         請勿與其他 xls 測試平行執行。

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const FIELDMAP = path.join(DATA, 'templates', 'sli-eli-fieldmap.json');
const BACKUP_DIR = path.join(DATA, 'templates');
const PORT = Number(process.env.PORT || 3139);
const BASE = `http://127.0.0.1:${PORT}`;
const CREDS = {
  companyCode: process.env.TEST_COMPANY || 'AGL',
  userId: process.env.TEST_USER || 'admin',
  password: process.env.TEST_PASSWORD || 'admin123',
};

let failures = 0;
let cookie = '';
const createdBackups = [];
let originalBytes = null;

function check(label, ok, detail) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function req(method, url, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return { status: res.status, data: await res.json() };
  return { status: res.status, data: await res.text(), headers: res.headers };
}

async function waitUp(child) {
  let log = '';
  child.stdout.on('data', (d) => { log += String(d); });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/api/auth/me`);
      return true;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.log(log);
  return false;
}

async function main() {
  originalBytes = fs.readFileSync(FIELDMAP);
  const child = spawn('node', ['server.js'], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(String(d)));
  try {
    check('伺服器啟動', await waitUp(child), `port ${PORT}`);
    const login = await req('POST', '/api/auth/login', CREDS);
    check('登入成功（admin）', login.status === 200, String(login.status));

    // ---- 1) GET ----
    const cfg = await req('GET', '/api/xls-booking/layout');
    const fm = cfg.data.fieldmap || {};
    check('GET /layout 回傳 200', cfg.status === 200);
    check('fieldmap 有 10 個欄位', Array.isArray(fm.fields) && fm.fields.length === 10, `fields=${(fm.fields || []).length}`);
    check('有 2 頁（SLI / ELI）', Array.isArray(fm.pages) && fm.pages.length === 2, (fm.pages || []).map((p) => p.label).join('/'));
    check('admin 可編輯（canEdit）', cfg.data.canEdit === true, `role=${cfg.data.role}`);
    check('baseline 模型（Arial 行盒）', !!cfg.data.baselineModel && cfg.data.baselineModel.ascentEm > 0.9, JSON.stringify(cfg.data.baselineModel));
    check('樣本清單至少含內建範例', Array.isArray(cfg.data.samples) && cfg.data.samples.length >= 1);
    check('引擎無資產問題（engineIssue=null）', cfg.data.engineIssue === null, String(cfg.data.engineIssue));

    const bg = await fetch(`${BASE}/api/xls-booking/layout/background/0`, { headers: { Cookie: cookie } });
    const bgBuf = Buffer.from(await bg.arrayBuffer());
    check('底圖 PNG 可取得', bg.status === 200 && bgBuf.slice(0, 8).toString('hex') === '89504e470d0a1a0a', `${bgBuf.length} bytes`);

    // ---- 2) preview（排版）----
    const pv1 = await req('POST', '/api/xls-booking/layout/preview', { sampleId: 'sample' });
    check('preview 200', pv1.status === 200);
    check('renderable=true（內建樣本為 Latin-1）', pv1.data.renderable === true, JSON.stringify(pv1.data.fallback || ''));
    check('preview 回傳 2 頁資訊', Array.isArray(pv1.data.pages) && pv1.data.pages.length === 2);
    const d23a = (pv1.data.fields || []).find((f) => f.key === 'sli.D23');
    check('sli.D23 有文字行與位置', !!d23a && d23a.lines.length >= 1 && d23a.positions.length === d23a.lines.length, d23a ? `${d23a.lines.length} 行` : 'missing');
    check('未要求 PDF 時不回傳 pdf（省頻寬）', pv1.data.pdf === null);

    // ---- 3) preview（wantPdf）----
    const pv2 = await req('POST', '/api/xls-booking/layout/preview', { sampleId: 'sample', wantPdf: true });
    const pdfBuf = pv2.data.pdf ? Buffer.from(pv2.data.pdf.base64, 'base64') : Buffer.alloc(0);
    check('wantPdf 產生 PDF', pv2.status === 200 && pdfBuf.slice(0, 4).toString() === '%PDF', `${(pdfBuf.length / 1024).toFixed(1)} KB`);
    check('測試 PDF 含完整背景（>50KB）', pdfBuf.length > 50000);

    // ---- 4) PUT 驗證：超界 / 未知欄位 ----
    const outRes = await req('PUT', '/api/xls-booking/layout', { fields: [{ key: 'sli.D23', box: { x: -50, y: 100, w: 100, h: 20 } }] });
    check('超出頁面 → 400', outRes.status === 400, JSON.stringify(outRes.data.errors || outRes.data.error));
    const unknown = await req('PUT', '/api/xls-booking/layout', { fields: [{ key: 'zz.NOPE', origin: { x: 10, y: 10 } }] });
    check('未知欄位 → 400', unknown.status === 400, JSON.stringify(unknown.data.errors || unknown.data.error));


    // ---- 5) PUT 合法變更（位移 +5/+5、框寬 +10）----
    const before = {
      box: Object.assign({}, d23a.box),
      origin: Object.assign({}, d23a.origin),
      wrap: d23a.wrapWidthPt,
      base: d23a.textBaselineOffsetPt,
    };
    const put = await req('PUT', '/api/xls-booking/layout', {
      fields: [{
        key: 'sli.D23',
        origin: { x: before.origin.x + 5, y: before.origin.y + 5 },
        box: { x: before.box.x + 5, y: before.box.y + 5, w: before.box.w + 10, h: before.box.h },
        font: { sizePt: d23a.sizePt, bold: d23a.bold, color: d23a.color },
        align: d23a.align,
        wrap: d23a.wrap,
        lineHeightPt: d23a.lineHeightPt,
      }],
    });
    check('合法變更 → 200 且 changed 含 sli.D23', put.status === 200 && (put.data.changed || []).indexOf('sli.D23') >= 0, JSON.stringify(put.data.changed));
    check('自動備份（sli-eli-fieldmap.bak-*.json）', !!put.data.backup && /^sli-eli-fieldmap\.bak-/.test(put.data.backup), String(put.data.backup));
    if (put.data.backup) createdBackups.push(path.join(BACKUP_DIR, put.data.backup));

    const savedD23 = ((put.data.fieldmap || {}).fields || []).find((f) => f.key === 'sli.D23');
    check('寫檔後 wrapWidthPt 隨框寬 +10', !!savedD23 && Math.abs(savedD23.wrapWidthPt - (before.wrap + 10)) < 0.02,
      `wrap ${before.wrap} → ${savedD23 && savedD23.wrapWidthPt}`);
    check('textBaselineOffsetPt 由後端重算（未變）', !!savedD23 && Math.abs(savedD23.textBaselineOffsetPt - before.base) < 0.02,
      `${before.base} → ${savedD23 && savedD23.textBaselineOffsetPt}`);

    // ---- 6) 幾何一致性：預覽位置跟著位移 ----
    const pv3 = await req('POST', '/api/xls-booking/layout/preview', { sampleId: 'sample' });
    const d23b = (pv3.data.fields || []).find((f) => f.key === 'sli.D23');
    const dx = d23b.positions[0].x - d23a.positions[0].x;
    const dy = d23b.positions[0].baseline - d23a.positions[0].baseline;
    check('預覽文字位置跟著位移（dx=+5, dy=+5）', Math.abs(dx - 5) < 0.02 && Math.abs(dy - 5) < 0.02, `dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`);

    // ---- 7) reset（指定欄位）----
    const reset = await req('POST', '/api/xls-booking/layout/reset', { keys: ['sli.D23'] });
    check('reset 指定欄位 → 200', reset.status === 200 && (reset.data.changed || []).indexOf('sli.D23') >= 0, JSON.stringify(reset.data.changed));
    if (reset.data.backup) createdBackups.push(path.join(BACKUP_DIR, reset.data.backup));
    const restored = ((reset.data.fieldmap || {}).fields || []).find((f) => f.key === 'sli.D23');
    check('reset 後回到 Excel 校準值', !!restored
      && Math.abs(restored.box.x - before.box.x) < 0.02 && Math.abs(restored.box.w - before.box.w) < 0.02,
      restored ? `box x=${restored.box.x} w=${restored.box.w}` : 'missing');

    const backups = await req('GET', '/api/xls-booking/layout/backups');
    check('備份清單 ≥ 2 筆', backups.status === 200 && (backups.data.backups || []).length >= 2, `${(backups.data.backups || []).length} 筆`);
  } finally {
    child.kill();
    try { fs.writeFileSync(FIELDMAP, originalBytes); } catch (e) { /* ignore */ }
    for (const f of createdBackups) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
    console.log('\n（已還原 data/templates/sli-eli-fieldmap.json 原始內容，並清除本次備份）');
  }

  console.log(`\nP5 LAYOUT CHECK: ${failures === 0 ? 'PASS' : `FAIL（${failures} 項）`}`);
  setTimeout(() => process.exit(failures ? 1 : 0), 300);
}

main().catch((e) => {
  console.error('測試失敗:', e);
  try { if (originalBytes) fs.writeFileSync(FIELDMAP, originalBytes); } catch (err) { /* ignore */ }
  process.exit(1);
});

