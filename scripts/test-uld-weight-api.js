// ===== ULD 夾重系統：API 端對端驗證（自帶伺服器，使用暫存資料庫）=====
// 驗證：權限（未登入 401）→ 建表 → 整份儲存（CASE 4）→ 讀回重算一致 → 清單彙總
//       → 錯誤資料 422 → 鎖定 409 → 解鎖 → 複製 → 刪除 → 404
// 用法：node scripts/test-uld-weight-api.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
// W3：測試自己產生一份 RCL 磅單 xlsx 上傳（沒有樣本檔也能驗證解析流程）
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3157);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(ROOT, 'data', `test-uld-weight-${Date.now()}.db`);
const CREDS = {
  companyCode: process.env.TEST_COMPANY || 'AGL',
  userId: process.env.TEST_USER || 'admin',
  password: process.env.TEST_PASSWORD || 'admin123'
};

let failures = 0;
let cookie = '';

function check(label, ok, detail) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function req(method, url, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return { status: res.status, body: await res.json() };
  return { status: res.status, data: await res.text() };
}

// ===== W3：測試用 RCL 磅單（沒有樣本檔也能驗證解析流程）=====
// 內容：標題列 + 空列 + 表頭（第 3 列）+ 2 筆正常 + 1 筆重複 + 1 筆 0 磅重
async function buildRclXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('RCL');
  ws.addRow(['HACTL RCL REPORT']);
  ws.addRow([]);
  ws.addRow(['ULD No', 'Tare', 'Gross Weight', 'Pcs']);
  ws.addRow(['PMC0003XX', 115, 540, 8]);
  ws.addRow(['PMC0004XX', 112, 1000, 3]);
  ws.addRow(['PMC0003XX', 115, 540, 8]);
  ws.addRow(['PMC0005XX', 0, 0, 2]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function uploadRcl(sheetId, buffer, fileName = 'rcl.xlsx', extra = {}) {
  const form = new FormData();
  if (buffer) form.append('file', new Blob([buffer]), fileName);
  Object.keys(extra).forEach(key => form.append(key, String(extra[key])));
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}/api/uld-weight/sheets/${sheetId}/import-rcl`, {
    method: 'POST', headers, body: form
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return { status: res.status, body: await res.json() };
  return { status: res.status, data: await res.text() };
}

// ===== R1：直接抓 PDF 位元組（不能用 req()，它會把回應當 JSON／文字）=====
async function fetchPdf(url) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { headers });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    disposition: res.headers.get('content-disposition') || '',
    size: buf.length,
    header: buf.slice(0, 5).toString('latin1')
  };
}

// ===== V2：抓二進位（ZIP）＋解析中央目錄（不引入額外依賴，用 node:zlib 解壓）=====
async function fetchBinary(url) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { headers });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    disposition: res.headers.get('content-disposition') || '',
    pdfCount: res.headers.get('x-uld-weight-pdf-count'),
    pdfFailed: res.headers.get('x-uld-weight-pdf-failed'),
    buffer: buf
  };
}

// 逐一讀出 ZIP 的項目（EOCD → central directory），回傳 { name, method, compSize, localOffset }
function zipEntries(buf) {
  const entries = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return entries;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// 取出某個 ZIP 項目的原始內容（method 8 = deflate）
function zipRead(buf, entry) {
  if (buf.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new Error('ZIP local header 不正確');
  const nameLen = buf.readUInt16LE(entry.localOffset + 26);
  const extraLen = buf.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const data = buf.slice(start, start + entry.compSize);
  return entry.method === 8 ? zlib.inflateRawSync(data) : data;
}

function near(a, b, tolerance = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

// ===== 全新資料庫的 seed 會與 db/database.js 的欄位遷移搶先後，故伺服器啟動後再補跑一次（idempotent）
// 註：R4 修好後伺服器自己就會等 schema 完成才 seed；這裡保留是為了「seed 失敗也不會讓測試卡死」。
function runSeed() {
  return new Promise((resolve) => {
    const child = spawn('node', [path.join(ROOT, 'scripts', 'seed-admin.js')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { DB_PATH }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.on('exit', () => resolve(out));
  });
}

// ===== R4：直接查 DB，確認「伺服器自己」就完成了 seed（不靠事後補跑）=====
function waitForAdmin(timeoutMs = 8000) {
  const sqlite3 = require('sqlite3');
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      let db;
      try {
        db = new sqlite3.Database(DB_PATH);
      } catch (e) {
        return resolve(false);
      }
      db.get("SELECT COUNT(*) AS n FROM users WHERE user_id = 'admin'", (err, row) => {
        db.close();
        if (!err && row && Number(row.n) > 0) return resolve(true);
        if (Date.now() - started > timeoutMs) return resolve(false);
        setTimeout(tick, 300);
      });
    };
    tick();
  });
}

async function waitUp(child) {
  let log = '';
  child.stdout.on('data', (d) => { log += String(d); });
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`${BASE}/api/auth/me`);
      return true;
    } catch (err) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.log(log);
  return false;
}

// CASE 4（規格書）：2 ULD 裝 2 MAWB，夾重票為 MAWB b
const CASE4 = {
  sheet_date: '2026-11-04',
  terminal: 'CPSL',
  flight_no: 'CX1234',
  flight_date: '2026-11-04',
  round_px: 1,
  round_b: 1,
  tail_mode: 'adjust_largest',
  handler: 'api-test',
  remark: 'CASE 4 驗證',
  ulds: [
    {
      kind: 'ULD', uld_number: 'PMC0003XX', contour_code: 'ZQ', port: 'HKG', pcs: 8,
      tare_weight: 115, rcl_gross_weight: 540, material_weight: 0,
      lih_type: 'N', predecl_type: 'X', squeeze_mode: 'weight',
      items: [
        { mawb: '160-00000005', port: 'HKG', pcs: 5, declared_weight: 300, is_squeeze: 0, lih_type: 'N' },
        { mawb: '160-00000006', port: 'TPE', pcs: 3, declared_weight: 125, is_squeeze: 1, lih_type: 'N' }
      ]
    },
    {
      kind: 'ULD', uld_number: 'PMC0004XX', contour_code: 'PMC', port: 'HKG', pcs: 3,
      tare_weight: 112, rcl_gross_weight: 1000, material_weight: 0,
      lih_type: 'N', predecl_type: 'P', squeeze_mode: 'weight',
      items: [
        { mawb: '160-00000006', port: 'TPE', pcs: 3, declared_weight: 888, is_squeeze: 1, lih_type: 'N' }
      ]
    }
  ]
};

(async () => {
  console.log('===== ULD 夾重系統：API 端對端測試 =====');
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DB_PATH }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (d) => process.stderr.write(String(d)));
  let sheetId = null;
  let dupId = null;
  try {
    check('伺服器啟動', await waitUp(child), `port ${PORT}`);
    // R4：全新 DB 的 seed 競態（companies.company_code 尚未補上就 seed）已修；這裡刻意「不補跑」
    // 先確認伺服器自己建好 admin，再跑一次 idempotent seed（讓後續登入一定成功）
    check('R4 伺服器自己就完成 seed（全新 DB 也有預設 admin）', await waitForAdmin(8000));
    await runSeed();

    // ---- 權限：未登入 401 ----
    const anon = await req('GET', '/api/uld-weight/sheets');
    check('未登入 → 401', anon.status === 401, String(anon.status));
    const anonBookings = await req('GET', '/api/uld-weight/bookings');
    check('未登入 GET /bookings → 401', anonBookings.status === 401, String(anonBookings.status));
    const anonApply = await req('POST', '/api/uld-weight/sheets/1/apply');
    check('未登入 POST /sheets/:id/apply → 401', anonApply.status === 401, String(anonApply.status));
    const anonRcl = await uploadRcl(1, null);
    check('未登入 POST /sheets/:id/import-rcl → 401', anonRcl.status === 401, String(anonRcl.status));
    const anonPdf = await fetchPdf('/api/uld-weight/sheets/1/report.pdf');
    check('未登入 GET /sheets/:id/report.pdf → 401', anonPdf.status === 401, String(anonPdf.status));
    const anonBatch = await fetchBinary('/api/uld-weight/sheets/batch-pdf?ids=1');
    check('未登入 GET /sheets/batch-pdf → 401', anonBatch.status === 401, String(anonBatch.status));
    const anonSync = await req('POST', '/api/uld-weight/sheets/1/sync-bookings', {});
    check('未登入 POST /sheets/:id/sync-bookings → 401', anonSync.status === 401, String(anonSync.status));
    const anonVersions = await req('GET', '/api/uld-weight/sheets/1/versions');
    check('未登入 GET /sheets/:id/versions → 401', anonVersions.status === 401, String(anonVersions.status));

    const login = await req('POST', '/api/auth/login', CREDS);
    check('登入成功（admin）', login.status === 200, String(login.status));

    // ---- W1：MAWB 從打板計劃 Booking Record 帶入 ----
    const newBooking = await req('POST', '/api/pallet/bookings', {
      mawb: '160-00000777', client: 'W1 TEST', dest: 'LAX', pcs: 12, gross_weight: 345.5
    });
    check('POST /api/pallet/bookings → 200（打板計劃建立 Booking）',
      newBooking.status === 200 && !!(newBooking.body && newBooking.body.data), String(newBooking.status));
    const bookingSearch = await req('GET', '/api/uld-weight/bookings?search=160-00000777');
    const foundBooking = (bookingSearch.body.data || []).find(b => b.mawb === '160-00000777');
    check('GET /uld-weight/bookings?search= 找到剛建的 Booking',
      bookingSearch.status === 200 && !!foundBooking, String(bookingSearch.status));
    check('Booking 帶回件數 12／重量 345.5（可自動帶入夾重表）',
      foundBooking && Number(foundBooking.pcs) === 12 && Number(foundBooking.gross_weight) === 345.5,
      foundBooking ? `${foundBooking.pcs}／${foundBooking.gross_weight}` : 'missing');
    check('Booking 帶回 mawb_record_id 與 DEST', foundBooking && !!foundBooking.id && foundBooking.dest === 'LAX');
    const bookingDest = await req('GET', '/api/uld-weight/bookings?dest=LAX');
    check('dest=LAX 篩選有結果', (bookingDest.body.data || []).some(b => b.mawb === '160-00000777'));
    const bookingNoDest = await req('GET', '/api/uld-weight/bookings?dest=ZZZ');
    check('dest=ZZZ（不存在）→ 0 筆', (bookingNoDest.body.data || []).length === 0);
    const bookingLimit = await req('GET', '/api/uld-weight/bookings?limit=1');
    check('limit=1 → 最多 1 筆', (bookingLimit.body.data || []).length === 1,
      String((bookingLimit.body.data || []).length));
    // ---- W2 前置：CASE 4 的兩票也各建一筆 Booking（b 的原始重量故意放 1000，套用後應變 1013）----
    const bookingA = await req('POST', '/api/pallet/bookings', {
      mawb: '160-00000005', client: 'W2 TEST', dest: 'HKG', pcs: 5, gross_weight: 300
    });
    const bookingB = await req('POST', '/api/pallet/bookings', {
      mawb: '160-00000006', client: 'W2 TEST', dest: 'TPE', pcs: 6, gross_weight: 1000
    });
    const idA = bookingA.body.data && bookingA.body.data.id;
    const idB = bookingB.body.data && bookingB.body.data.id;
    check('建立 CASE 4 兩票的 Booking', !!idA && !!idB, `${idA}／${idB}`);
    CASE4.ulds[0].items[0].mawb_record_id = idA;
    CASE4.ulds[0].items[1].mawb_record_id = idB;
    CASE4.ulds[1].items[0].mawb_record_id = idB;

    // ---- 新增 ----
    const created = await req('POST', '/api/uld-weight/sheets', {});
    check('POST /sheets → 201', created.status === 201, String(created.status));
    sheetId = created.body.data && created.body.data.id;
    const sheetNo = created.body.data && created.body.data.sheet_no;
    check('夾重表編號格式 WGT-YYYYMMDD-XX', /^WGT-\d{8}-\d{2}$/.test(sheetNo || ''), String(sheetNo));
    check('新表預設貨站 CPSL', created.body.data && created.body.data.terminal === 'CPSL');
    check('新表 0 個收貨單位', created.body.data && Array.isArray(created.body.data.ulds) && created.body.data.ulds.length === 0);

    // ---- W3：RCL 磅單匯入（只解析，不寫 DB）----
    const rclBuffer = await buildRclXlsx();
    const rclParsed = await uploadRcl(sheetId, rclBuffer, 'rcl-hactl.xlsx');
    check('W3 上傳 RCL xlsx → 200', rclParsed.status === 200, String(rclParsed.status));
    const rclData = (rclParsed.body && rclParsed.body.data) || {};
    check('W3 自動找到表頭在第 3 列', rclData.header_row === 3, String(rclData.header_row));
    check('W3 自動偵測欄位（ULD／Tare／Gross／件數）',
      rclData.columns && rclData.columns.uld === 0 && rclData.columns.tare === 1 &&
      rclData.columns.gross === 2 && rclData.columns.pcs === 3, JSON.stringify(rclData.columns));
    check('W3 解析出 2 個可建立的單位', (rclData.rows || []).length === 2, String((rclData.rows || []).length));
    check('W3 帶回 ULD#／Tare／Gross／件數',
      (rclData.rows || []).length === 2 && rclData.rows[0].uld_number === 'PMC0003XX' &&
      Number(rclData.rows[0].tare_weight) === 115 && Number(rclData.rows[0].rcl_gross_weight) === 540 &&
      Number(rclData.rows[0].pcs) === 8, JSON.stringify((rclData.rows || [])[0]));
    check('W3 重複 ULD# 與 0 磅重列被略過',
      (rclData.skipped || []).some(s => s.reason === 'duplicate') &&
      (rclData.skipped || []).some(s => s.reason === 'no_gross'), JSON.stringify(rclData.skipped));
    const afterRcl = await req('GET', `/api/uld-weight/sheets/${sheetId}`);
    check('W3 匯入不會寫入 DB（單位數仍為 0）', afterRcl.body.data.ulds.length === 0);

    const rclNoPcs = await uploadRcl(sheetId, rclBuffer, 'rcl-hactl.xlsx', { col_pcs: -1 });
    check('W3 可指定欄位對應（col_pcs=-1 → 件數 0）',
      rclNoPcs.status === 200 && (rclNoPcs.body.data.rows || []).every(r => Number(r.pcs) === 0),
      JSON.stringify((rclNoPcs.body.data.rows || []).map(r => r.pcs)));

    const rclCsv = await uploadRcl(sheetId, Buffer.from('ULD No,Tare,Gross Weight,Pcs\nPMC0009XX,100,900,4\n'), 'rcl.csv');
    check('W3 也支援 CSV 上傳',
      rclCsv.status === 200 && (rclCsv.body.data.rows || []).length === 1 &&
      rclCsv.body.data.rows[0].uld_number === 'PMC0009XX',
      JSON.stringify(rclCsv.body && rclCsv.body.data && rclCsv.body.data.rows));

    const rclXls = await uploadRcl(sheetId, Buffer.from('dummy'), 'rcl.xls');
    check('W3 舊版 .xls → 400（提示另存 .xlsx／.csv）', rclXls.status === 400, String(rclXls.status));
    const rclNoFile = await uploadRcl(sheetId, null);
    check('W3 沒有檔案 → 400', rclNoFile.status === 400, String(rclNoFile.status));
    const rclMissing = await uploadRcl(999999, rclBuffer);
    check('W3 找不到夾重表 → 404', rclMissing.status === 404, String(rclMissing.status));

    // ---- 整份儲存（CASE 4）----
    const saved = await req('PUT', `/api/uld-weight/sheets/${sheetId}`, CASE4);
    check('PUT /sheets/:id → 200', saved.status === 200, JSON.stringify((saved.body.data && saved.body.data.error) || ''));
    const detail = saved.body.data || {};
    const mawbA = (detail.mawbs || []).find(m => m.mawb === '160-00000005');
    const mawbB = (detail.mawbs || []).find(m => m.mawb === '160-00000006');
    check('CASE4 MAWB a = 300（不夾重）', mawbA && Number(mawbA.final) === 300, mawbA ? String(mawbA.final) : 'missing');
    check('CASE4 MAWB b = 125 + 888 = 1013', mawbB && Number(mawbB.final) === 1013, mawbB ? String(mawbB.final) : 'missing');
    check('板 a 淨重 = 540 − 115 = 425', Number(detail.ulds[0].calc.finalSum) === 425, String(detail.ulds[0].calc.finalSum));
    check('板 b 淨重 = 1000 − 112 = 888', Number(detail.ulds[1].calc.finalSum) === 888, String(detail.ulds[1].calc.finalSum));
    check('全表淨重 = 1313', Number(detail.totals.netTotal) === 1313, String(detail.totals.netTotal));
    check('全表無 error', detail.totals.hasError === false);

    // ---- 讀回（後端重算一致）----
    const reread = await req('GET', `/api/uld-weight/sheets/${sheetId}`);
    const rereadB = (reread.body.data.mawbs || []).find(m => m.mawb === '160-00000006');
    check('GET 讀回 MAWB b 仍為 1013', rereadB && Number(rereadB.final) === 1013, rereadB ? String(rereadB.final) : 'missing');
    check('GET 讀回明細 3 筆 MAWB 列',
      reread.body.data.ulds.reduce((n, u) => n + (u.items || []).length, 0) === 3);
    check('GET 讀回夾重旗標（is_squeeze）正確',
      Number(reread.body.data.ulds[0].items[1].is_squeeze) === 1 && Number(reread.body.data.ulds[0].items[0].is_squeeze) === 0);
    check('GET 讀回 mawb_record_id（Booking Record 連結）',
      idA && Number(reread.body.data.ulds[0].items[0].mawb_record_id) === Number(idA),
      String(reread.body.data.ulds[0].items[0].mawb_record_id));

    // ---- R1：server 端 PDF（草稿也能下載）----
    const pdfDraft = await fetchPdf(`/api/uld-weight/sheets/${sheetId}/report.pdf`);
    check('R1 草稿 GET /report.pdf → 200', pdfDraft.status === 200, String(pdfDraft.status));
    check('R1 Content-Type = application/pdf', pdfDraft.contentType.includes('application/pdf'), pdfDraft.contentType);
    check('R1 檔頭是 %PDF- 且大小 > 0', pdfDraft.header === '%PDF-' && pdfDraft.size > 1000,
      `${pdfDraft.header} / ${pdfDraft.size} bytes`);
    check('R1 Content-Disposition 帶檔名（<sheet_no>.pdf）',
      pdfDraft.disposition.includes('attachment') && pdfDraft.disposition.includes(sheetNo),
      pdfDraft.disposition);
    check('R1 不存在的夾重表 → 404', (await fetchPdf('/api/uld-weight/sheets/999999/report.pdf')).status === 404);

    // ---- U3：單板 Loading Sheet（A4 直式，MAWB／DEST／PCS／WT）----
    const unitId1 = Number(reread.body.data.ulds[0].id);
    const loadingOne = await fetchPdf(`/api/uld-weight/sheets/${sheetId}/loading-sheet.pdf?unit=${unitId1}`);
    check('U3 GET /loading-sheet.pdf?unit=<id> → 200', loadingOne.status === 200, String(loadingOne.status));
    check('U3 Content-Type = application/pdf 且檔頭 %PDF-', loadingOne.contentType.includes('application/pdf') &&
      loadingOne.header === '%PDF-', `${loadingOne.contentType} / ${loadingOne.header}`);
    check('U3 檔名帶 -loading.pdf', loadingOne.disposition.includes('-loading.pdf'), loadingOne.disposition);
    check('U3 Loading Sheet 比全表報表小（單板一頁）', loadingOne.size > 1000 && loadingOne.size < pdfDraft.size,
      `${loadingOne.size} vs ${pdfDraft.size}`);
    const loadingAll = await fetchPdf(`/api/uld-weight/sheets/${sheetId}/loading-sheet.pdf`);
    check('U3 省略 unit → 每板一頁（大小 >= 單板）', loadingAll.status === 200 && loadingAll.size >= loadingOne.size,
      `${loadingAll.size} vs ${loadingOne.size}`);
    check('U3 不存在的 unit → 404',
      (await fetchPdf(`/api/uld-weight/sheets/${sheetId}/loading-sheet.pdf?unit=999999`)).status === 404);
    check('U3 不存在的夾重表 → 404',
      (await fetchPdf('/api/uld-weight/sheets/999999/loading-sheet.pdf')).status === 404);


    // ---- R3：明細 diff 更新（儲存後 id 不變、改列是同一個 id）----
    const idsSnapshot = reread.body.data.ulds.map(u => ({
      unitId: Number(u.id),
      itemIds: (u.items || []).map(it => Number(it.id))
    }));
    check('R3 讀回的明細帶 DB id（前端可回傳做 diff）',
      idsSnapshot.every(u => u.unitId > 0 && u.itemIds.length > 0 && u.itemIds.every(i => i > 0)),
      JSON.stringify(idsSnapshot));
    const withIds = (base, detailObj) => {
      const payload = JSON.parse(JSON.stringify(base));
      (detailObj.ulds || []).forEach((u, ui) => {
        if (!payload.ulds[ui]) return;
        payload.ulds[ui].id = u.id;
        (u.items || []).forEach((it, ii) => {
          if (payload.ulds[ui].items[ii]) payload.ulds[ui].items[ii].id = it.id;
        });
      });
      return payload;
    };
    const resavePayload = withIds(CASE4, reread.body.data);
    const resaved = await req('PUT', `/api/uld-weight/sheets/${sheetId}`, resavePayload);
    const resavedIds = ((resaved.body.data && resaved.body.data.ulds) || []).map(u => ({
      unitId: Number(u.id),
      itemIds: (u.items || []).map(it => Number(it.id))
    }));
    check('R3 帶 id 再存一次 → 單位／明細 id 完全不變（不再整批刪除重插）',
      resaved.status === 200 && JSON.stringify(resavedIds) === JSON.stringify(idsSnapshot),
      JSON.stringify(resavedIds));

    const editedPayload = JSON.parse(JSON.stringify(resavePayload));
    editedPayload.ulds[0].items[1].declared_weight = 130; // b 125 → 130
    const edited = await req('PUT', `/api/uld-weight/sheets/${sheetId}`, editedPayload);
    const editedItems = (edited.body.data && edited.body.data.ulds[0].items) || [];
    check('R3 只改一列的重量 → 同一 id 被 UPDATE、筆數不變',
      edited.status === 200 && Number(editedItems[1].id) === idsSnapshot[0].itemIds[1] &&
      Number(editedItems[1].declared_weight) === 130 && editedItems.length === idsSnapshot[0].itemIds.length,
      JSON.stringify(editedItems.map(it => `${it.id}:${it.declared_weight}`)));

    const droppedPayload = JSON.parse(JSON.stringify(editedPayload));
    droppedPayload.ulds[0].items.splice(0, 1); // 移除板 a 的 MAWB a
    const dropped = await req('PUT', `/api/uld-weight/sheets/${sheetId}`, droppedPayload);
    const droppedItems = (dropped.body.data && dropped.body.data.ulds[0].items) || [];
    check('R3 少帶一列 → 該列被 DELETE（其餘 id 不變）',
      dropped.status === 200 && droppedItems.length === 1 &&
      Number(droppedItems[0].id) === idsSnapshot[0].itemIds[1],
      JSON.stringify(droppedItems.map(it => it.id)));

    const restored = await req('PUT', `/api/uld-weight/sheets/${sheetId}`, CASE4);
    const restoredIds = ((restored.body.data && restored.body.data.ulds) || []).map(u => Number(u.id));
    check('R3 不帶 id 的整份 payload 仍可儲存（舊行為相容：重建後 id 改變）',
      restored.status === 200 && restoredIds.length === 2 &&
      JSON.stringify(restoredIds) !== JSON.stringify(idsSnapshot.map(u => u.unitId)),
      JSON.stringify(restoredIds));

    // ---- W5：磅差警示門檻（表頭可調）----
    check('W5 新表預設門檻 2% / 100kg',
      Number(detail.diff_warn_pct) === 2 && Number(detail.diff_warn_kg) === 100,
      `${detail.diff_warn_pct}% / ${detail.diff_warn_kg}kg`);
    const savedWarn = await req('PUT', `/api/uld-weight/sheets/${sheetId}`,
      Object.assign({}, CASE4, { diff_warn_pct: 5, diff_warn_kg: 50 }));
    check('W5 PUT 門檻 5% / 50kg → 200 且回傳新門檻',
      savedWarn.status === 200 &&
      Number(savedWarn.body.data.diff_warn_pct) === 5 && Number(savedWarn.body.data.diff_warn_kg) === 50,
      savedWarn.status === 200 ? `${savedWarn.body.data.diff_warn_pct}% / ${savedWarn.body.data.diff_warn_kg}kg` : String(savedWarn.status));
    const warnReread = await req('GET', `/api/uld-weight/sheets/${sheetId}`);
    check('W5 GET 讀回門檻（PUT／GET 往返一致）',
      Number(warnReread.body.data.diff_warn_pct) === 5 && Number(warnReread.body.data.diff_warn_kg) === 50,
      `${warnReread.body.data.diff_warn_pct}% / ${warnReread.body.data.diff_warn_kg}kg`);
    check('W5 門檻有傳進後端重算（unit.calc.diffWarnPct／diffWarnKg）',
      Number(warnReread.body.data.ulds[0].calc.diffWarnPct) === 5 &&
      Number(warnReread.body.data.ulds[0].calc.diffWarnKg) === 50,
      `${warnReread.body.data.ulds[0].calc.diffWarnPct}% / ${warnReread.body.data.ulds[0].calc.diffWarnKg}kg`);

    // ---- R2：多票夾重比例上下限 ----
    check('R2 預設上下限 0／0（不限）',
      Number(detail.clamp_min_pct) === 0 && Number(detail.clamp_max_pct) === 0,
      `${detail.clamp_min_pct}% / ${detail.clamp_max_pct}%`);
    const savedClamp = await req('PUT', `/api/uld-weight/sheets/${sheetId}`,
      // 保留前一組門檻（5% / 50kg），只改比例上下限
      Object.assign({}, CASE4, { diff_warn_pct: 5, diff_warn_kg: 50, clamp_min_pct: 10, clamp_max_pct: 60 }));
    check('R2 PUT 上下限 10% / 60% → 200 且回傳新值',
      savedClamp.status === 200 &&
      Number(savedClamp.body.data.clamp_min_pct) === 10 && Number(savedClamp.body.data.clamp_max_pct) === 60,
      savedClamp.status === 200
        ? `${savedClamp.body.data.clamp_min_pct}% / ${savedClamp.body.data.clamp_max_pct}%`
        : String(savedClamp.status));
    const clampReread = await req('GET', `/api/uld-weight/sheets/${sheetId}`);
    check('R2 GET 讀回上下限（PUT／GET 往返一致）',
      Number(clampReread.body.data.clamp_min_pct) === 10 && Number(clampReread.body.data.clamp_max_pct) === 60);
    check('R2 上下限有傳進後端重算（unit.calc.clampMinPct／clampMaxPct）',
      Number(clampReread.body.data.ulds[0].calc.clampMinPct) === 10 &&
      Number(clampReread.body.data.ulds[0].calc.clampMaxPct) === 60,
      `${clampReread.body.data.ulds[0].calc.clampMinPct}% / ${clampReread.body.data.ulds[0].calc.clampMaxPct}%`);

    const clampSheet = await req('POST', '/api/uld-weight/sheets', {});
    const clampSheetId = clampSheet.body.data && clampSheet.body.data.id;
    const clampPayload = {
      sheet_date: '2026-11-05', terminal: 'CPSL', flight_no: 'CX9999', round_px: 1, round_b: 1,
      tail_mode: 'adjust_largest', clamp_min_pct: 0, clamp_max_pct: 40,
      ulds: [{
        kind: 'ULD', uld_number: 'PMC7777XX', contour_code: 'ZQ', port: 'HKG', pcs: 11,
        tare_weight: 0, rcl_gross_weight: 2000, material_weight: 0,
        lih_type: 'N', predecl_type: 'X', squeeze_mode: 'weight',
        items: [
          { mawb: '160-00000071', port: 'HKG', pcs: 9, declared_weight: 900, is_squeeze: 1, lih_type: 'N' },
          { mawb: '160-00000072', port: 'HKG', pcs: 1, declared_weight: 50, is_squeeze: 1, lih_type: 'N' },
          { mawb: '160-00000073', port: 'HKG', pcs: 1, declared_weight: 50, is_squeeze: 1, lih_type: 'N' }
        ]
      }]
    };
    const clampSaved = await req('PUT', `/api/uld-weight/sheets/${clampSheetId}`, clampPayload);
    const clampItems = (clampSaved.body.data && clampSaved.body.data.ulds[0].calc.items) || [];
    check('R2 上限 40% → 最大票比例被壓到 40%（原本 90%）',
      clampSaved.status === 200 && near(clampItems[0].ratio, 0.4) && clampItems[0].ratioClamped === true,
      clampSaved.status === 200 ? `${(clampItems[0].ratio * 100).toFixed(1)}%` : String(clampSaved.status));
    check('R2 重分配後最終重量 1300／350／350、合計仍為目標淨重 2000',
      clampItems.length === 3 && near(clampItems[0].final, 1300) && near(clampItems[1].final, 350) &&
      near(clampSaved.body.data.ulds[0].calc.finalSum, 2000),
      JSON.stringify(clampItems.map(it => it.final)));

    const clampBadPayload = JSON.parse(JSON.stringify(clampPayload));
    clampBadPayload.clamp_max_pct = 30;
    clampBadPayload.ulds[0].items = clampBadPayload.ulds[0].items.slice(0, 2); // 上限 30% × 2 票 → 無解
    const clampBad = await req('PUT', `/api/uld-weight/sheets/${clampSheetId}`, clampBadPayload);
    check('R2 上下限無解 → 仍可存檔（200）並提 CLAMP_INFEASIBLE 警示',
      clampBad.status === 200 &&
      (clampBad.body.data.issues || []).some(i => i.code === 'CLAMP_INFEASIBLE' && i.level === 'warn'),
      clampBad.status === 200 ? JSON.stringify((clampBad.body.data.issues || []).map(i => i.code)) : String(clampBad.status));
    await req('DELETE', `/api/uld-weight/sheets/${clampSheetId}`);
    check('R2 測試用夾重表已刪除', (await req('GET', `/api/uld-weight/sheets/${clampSheetId}`)).status === 404);

    // ---- W2：草稿不可套用（409）----
    const applyDraft = await req('POST', `/api/uld-weight/sheets/${sheetId}/apply`);
    check('未鎖定套用到 Booking → 409', applyDraft.status === 409, String(applyDraft.status));
    check('409 回傳需要先鎖定的訊息',
      !!(applyDraft.body && applyDraft.body.error && applyDraft.body.error.includes('鎖定')),
      String(applyDraft.body && applyDraft.body.error));

    // ---- 清單彙總 ----
    const list = await req('GET', '/api/uld-weight/sheets');
    const row = (list.body.data || [])[0];
    check('清單 1 筆', (list.body.data || []).length === 1, String((list.body.data || []).length));
    check('清單 RCL 總重 1540', row && Number(row.rcl_total) === 1540, row ? String(row.rcl_total) : 'missing');
    check('清單淨重 1313', row && Number(row.net_total) === 1313, row ? String(row.net_total) : 'missing');
    check('清單板數 2', row && row.uld_count === 2, row ? String(row.uld_count) : 'missing');

    // ---- 錯誤資料 → 422（有磅差但未勾夾重）----
    const badPayload = JSON.parse(JSON.stringify(CASE4));
    badPayload.ulds[0].rcl_gross_weight = 600; // 製造磅差（425 → 485）
    badPayload.ulds[0].items.forEach(it => { it.is_squeeze = 0; });
    badPayload.ulds[1].items.forEach(it => { it.is_squeeze = 0; });
    const bad = await req('PUT', `/api/uld-weight/sheets/${sheetId}`, badPayload);
    check('未勾夾重（磅差 ≠ 0）→ 422', bad.status === 422, String(bad.status));
    check('422 回傳錯誤訊息', !!(bad.body && bad.body.error), String(bad.body && bad.body.error));

    // ---- 鎖定 / 解鎖 ----
    const locked = await req('POST', `/api/uld-weight/sheets/${sheetId}/lock`);
    check('鎖定 → 200 且狀態 locked', locked.status === 200 && locked.body.data.status === 'locked', String(locked.status));
    const rclLocked = await uploadRcl(sheetId, rclBuffer, 'rcl-hactl.xlsx');
    check('W3 已鎖定時匯入 → 409', rclLocked.status === 409, String(rclLocked.status));
    const pdfLocked = await fetchPdf(`/api/uld-weight/sheets/${sheetId}/report.pdf`);
    check('R1 已鎖定也能下載 PDF（200、application/pdf）',
      pdfLocked.status === 200 && pdfLocked.contentType.includes('application/pdf') &&
      pdfLocked.header === '%PDF-' && pdfLocked.size > 1000,
      `${pdfLocked.status} / ${pdfLocked.size} bytes`);

    // ---- W2：鎖定後套用到 Booking Record ----
    const applied = await req('POST', `/api/uld-weight/sheets/${sheetId}/apply`);
    check('鎖定後套用 → 200', applied.status === 200, String(applied.status));
    const appliedList = (applied.body.data && applied.body.data.applied) || [];
    const skippedList = (applied.body.data && applied.body.data.skipped) || [];
    const appliedB = appliedList.find(a => a.mawb === '160-00000006');
    check('只回寫需要變更的票（b 1000 → 1013）',
      appliedList.length === 1 && appliedB && Number(appliedB.before) === 1000 && Number(appliedB.after) === 1013,
      appliedB ? `${appliedB.before} → ${appliedB.after}` : JSON.stringify(appliedList));
    check('重量未變的票列為 skipped（unchanged）',
      skippedList.some(s => s.mawb === '160-00000005' && s.reason === 'unchanged'),
      JSON.stringify(skippedList));
    check('skipped 的原因都在預期集合內（CASE 4 三票都已連結 → 無 no_booking）',
      skippedList.every(s => ['unchanged', 'no_booking', 'booking_not_found'].includes(s.reason)),
      JSON.stringify(skippedList));
    check('回傳夾重表明細（可直接更新畫面）', !!(applied.body.sheet && applied.body.sheet.id === sheetId));

    const afterApplyB = await req('GET', '/api/uld-weight/bookings?search=160-00000006');
    const bRow = (afterApplyB.body.data || []).find(b => b.mawb === '160-00000006');
    check('Booking b 的 gross_weight 已回寫 1013',
      bRow && Number(bRow.gross_weight) === 1013, bRow ? String(bRow.gross_weight) : 'missing');
    const afterApplyA = await req('GET', '/api/uld-weight/bookings?search=160-00000005');
    const aRow = (afterApplyA.body.data || []).find(b => b.mawb === '160-00000005');
    check('Booking a 維持 300（不夾重的票重量不變）',
      aRow && Number(aRow.gross_weight) === 300, aRow ? String(aRow.gross_weight) : 'missing');

    const appliedAgain = await req('POST', `/api/uld-weight/sheets/${sheetId}/apply`);
    check('重複套用不累加（0 票變更、全部 unchanged）',
      appliedAgain.status === 200 &&
      ((appliedAgain.body.data && appliedAgain.body.data.applied) || []).length === 0 &&
      ((appliedAgain.body.data && appliedAgain.body.data.skipped) || []).every(s => s.reason === 'unchanged'),
      JSON.stringify((appliedAgain.body.data || {}).applied));

    const audit = await req('GET', '/api/db/tables/audit_log');
    const applyLog = ((audit.body.data && audit.body.data.rows) || [])
      .find(r => r.action === 'uld_weight.apply' && String(r.target_id) === String(sheetId));
    let applyDetail = null;
    try { applyDetail = applyLog ? JSON.parse(applyLog.detail) : null; } catch (e) { applyDetail = null; }
    check('寫入 audit_log（action = uld_weight.apply）', !!applyLog);
    check('audit_log 保存原重量（b before 1000 → after 1013）',
      !!(applyDetail && (applyDetail.applied || []).some(a => Number(a.before) === 1000 && Number(a.after) === 1013)),
      applyDetail ? JSON.stringify(applyDetail.applied) : 'missing');

    const putLocked = await req('PUT', `/api/uld-weight/sheets/${sheetId}`, CASE4);
    check('鎖定後儲存 → 409', putLocked.status === 409, String(putLocked.status));
    const unlocked = await req('POST', `/api/uld-weight/sheets/${sheetId}/unlock`);
    check('解鎖 → 200 且狀態 draft', unlocked.status === 200 && unlocked.body.data.status === 'draft', String(unlocked.status));

    // ---- 複製 ----
    const dup = await req('POST', `/api/uld-weight/sheets/${sheetId}/duplicate`);
    dupId = dup.body.data && dup.body.data.id;
    check('複製 → 201 且新編號', dup.status === 201 && dupId && dupId !== sheetId, String(dup.status));
    check('複製後明細一併帶過去', dup.body.data && dup.body.data.ulds.length === 2);
    const dupB = dup.body.data && (dup.body.data.mawbs || []).find(m => m.mawb === '160-00000006');
    check('複製後 MAWB b 仍為 1013', dupB && Number(dupB.final) === 1013);
    check('W5 複製會一併帶門檻（5% / 50kg）',
      dup.body.data && Number(dup.body.data.diff_warn_pct) === 5 && Number(dup.body.data.diff_warn_kg) === 50,
      dup.body.data ? `${dup.body.data.diff_warn_pct}% / ${dup.body.data.diff_warn_kg}kg` : 'missing');

    // ---- V2：批次 PDF（多張夾重表打包 ZIP）----
    const dupSheetNo = dup.body.data && dup.body.data.sheet_no;
    const batchOne = await fetchBinary(`/api/uld-weight/sheets/batch-pdf?ids=${sheetId}`);
    check('V2 單張批次 → 200 且 Content-Type = application/zip',
      batchOne.status === 200 && batchOne.contentType.includes('application/zip'),
      `${batchOne.status} / ${batchOne.contentType}`);
    check('V2 檔頭是 PK（ZIP）且 Content-Disposition 是 .zip',
      batchOne.buffer.slice(0, 2).toString('latin1') === 'PK' && /\.zip"?$/.test(batchOne.disposition),
      batchOne.disposition);
    const oneEntries = zipEntries(batchOne.buffer);
    check('V2 ZIP 內是 manifest.txt + 1 份 PDF',
      oneEntries.length === 2 &&
      oneEntries.some(e => e.name === 'manifest.txt') &&
      oneEntries.filter(e => /\.pdf$/.test(e.name)).length === 1,
      oneEntries.map(e => e.name).join(', '));
    const onePdfEntry = oneEntries.find(e => /\.pdf$/.test(e.name));
    const onePdfBuf = onePdfEntry ? zipRead(batchOne.buffer, onePdfEntry) : Buffer.alloc(0);
    check('V2 ZIP 內的 PDF 解壓後檔頭是 %PDF-（> 1KB）',
      onePdfBuf.slice(0, 5).toString('latin1') === '%PDF-' && onePdfBuf.length > 1000,
      `${onePdfBuf.slice(0, 5).toString('latin1')} / ${onePdfBuf.length} bytes`);

    const batchTwo = await fetchBinary(`/api/uld-weight/sheets/batch-pdf?ids=${sheetId},${dupId}`);
    const twoEntries = zipEntries(batchTwo.buffer);
    check('V2 兩張批次 → ZIP 內 2 份 PDF（+ manifest.txt）',
      batchTwo.status === 200 && twoEntries.length === 3 &&
      twoEntries.filter(e => /\.pdf$/.test(e.name)).length === 2,
      `${batchTwo.status} / ${twoEntries.map(e => e.name).join(', ')}`);
    check('V2 回應帶成功／失敗張數（X-Uld-Weight-Pdf-Count / -Failed）',
      batchTwo.pdfCount === '2' && batchTwo.pdfFailed === '0',
      `${batchTwo.pdfCount} / ${batchTwo.pdfFailed}`);
    const manifestEntry = twoEntries.find(e => e.name === 'manifest.txt');
    const manifestText = manifestEntry ? zipRead(batchTwo.buffer, manifestEntry).toString('utf8') : '';
    check('V2 manifest.txt 有 UTF-8 BOM 且列出兩張表號',
      manifestText.startsWith('\uFEFF') &&
      manifestText.includes(sheetNo) && !!dupSheetNo && manifestText.includes(dupSheetNo),
      manifestText.split('\r\n')[2] || '');

    const batchByStatus = await fetchBinary('/api/uld-weight/sheets/batch-pdf?status=draft');
    const byStatusEntries = zipEntries(batchByStatus.buffer);
    check('V2 沒帶 ids → 依 status=draft 篩選（兩張都是草稿 → 2 份 PDF）',
      batchByStatus.status === 200 && byStatusEntries.filter(e => /\.pdf$/.test(e.name)).length === 2,
      `${batchByStatus.status} / ${byStatusEntries.length} 個項目`);
    const batchLocked = await fetchBinary('/api/uld-weight/sheets/batch-pdf?status=locked');
    check('V2 沒有符合條件的夾重表 → 404', batchLocked.status === 404, String(batchLocked.status));
    const batchMissing = await fetchBinary('/api/uld-weight/sheets/batch-pdf?ids=999999');
    check('V2 ids 全部不存在 → 404', batchMissing.status === 404, String(batchMissing.status));
    const tooManyIds = Array.from({ length: 51 }, (_, i) => i + 1).join(',');
    const batchTooMany = await fetchBinary(`/api/uld-weight/sheets/batch-pdf?ids=${tooManyIds}`);
    check('V2 超過 50 張上限 → 400', batchTooMany.status === 400, String(batchTooMany.status));

    // ---- W5：門檻改變 → DIFF_TOO_BIG 行為跟著變（用複本測，不動上面的 CASE4 資料）----
    const bigDiffPayload = JSON.parse(JSON.stringify(CASE4));
    bigDiffPayload.ulds[1].rcl_gross_weight = 1500; // 淨重 1388 vs 申報 888 → 磅差 500kg（36%）
    const tightWarn = await req('PUT', `/api/uld-weight/sheets/${dupId}`,
      Object.assign({}, bigDiffPayload, { diff_warn_pct: 2, diff_warn_kg: 100 }));
    check('W5 門檻 2% / 100kg → 磅差 500kg（36%）提示 DIFF_TOO_BIG',
      tightWarn.status === 200 && (tightWarn.body.data.issues || []).some(i => i.code === 'DIFF_TOO_BIG'),
      tightWarn.status === 200 ? JSON.stringify((tightWarn.body.data.issues || []).map(i => i.code)) : String(tightWarn.status));
    const looseWarn = await req('PUT', `/api/uld-weight/sheets/${dupId}`,
      Object.assign({}, bigDiffPayload, { diff_warn_pct: 40, diff_warn_kg: 1000 }));
    check('W5 門檻放寬 40% / 1000kg → 同一個磅差不提示',
      looseWarn.status === 200 && !(looseWarn.body.data.issues || []).some(i => i.code === 'DIFF_TOO_BIG'));
    const defaultWarn = await req('PUT', `/api/uld-weight/sheets/${dupId}`, bigDiffPayload);
    check('W5 沒帶門檻欄位 → 回預設 2% / 100kg',
      defaultWarn.status === 200 && Number(defaultWarn.body.data.diff_warn_pct) === 2 &&
      Number(defaultWarn.body.data.diff_warn_kg) === 100);

    // ---- V1：補建 Booking Record（預設只預覽，明確 dry_run:false 才寫入）----
    const v1Sheet = await req('POST', '/api/uld-weight/sheets', { flight_no: 'CX9999' });
    const v1Id = v1Sheet.body.data && v1Sheet.body.data.id;
    check('V1 建立測試用夾重表', !!v1Id, String(v1Id));
    const V1_PAYLOAD = {
      sheet_date: '2026-11-06', terminal: 'CPSL', flight_no: 'CX9999', flight_date: '2026-11-06',
      round_px: 1, round_b: 1, tail_mode: 'adjust_largest',
      handler: 'v1-test', remark: '',
      ulds: [
        {
          kind: 'ULD', uld_number: 'PMC0009XX', contour_code: 'ZQ', port: 'HKG', pcs: 5,
          tare_weight: 100, rcl_gross_weight: 400, material_weight: 0,
          lih_type: 'N', predecl_type: 'X', squeeze_mode: 'weight',
          items: [
            // 打板計劃已有這票（W2 前置建的 Booking，原重 300）→ 只連結、不重建
            { mawb: '160-00000005', port: 'HKG', pcs: 2, declared_weight: 150, is_squeeze: 0, lih_type: 'N' },
            // 打板計劃沒有 → 建立（夾重票：淨重 300 − 150 = 150）
            { mawb: '160-00008888', port: 'NRT', pcs: 3, declared_weight: 150, is_squeeze: 1, lih_type: 'N' }
          ]
        }
      ]
    };
    const v1Saved = await req('PUT', `/api/uld-weight/sheets/${v1Id}`, V1_PAYLOAD);
    check('V1 測試表存檔（兩票都還沒連結 Booking）',
      v1Saved.status === 200 &&
      (v1Saved.body.data.ulds[0].items || []).every(it => !it.mawb_record_id),
      String(v1Saved.status));

    const syncPreview = await req('POST', `/api/uld-weight/sheets/${v1Id}/sync-bookings`, {});
    const previewData = syncPreview.body.data || {};
    const previewCreated = previewData.created || [];
    const previewLinked = previewData.linked || [];
    check('V1 預設是 dry_run（只回預覽、不寫 DB）',
      syncPreview.status === 200 && previewData.dry_run === true, String(syncPreview.status));
    check('V1 預覽：1 筆要建立（160-00008888，gross = 夾重後 150、dest NRT、3 件）',
      previewCreated.length === 1 && previewCreated[0].mawb === '160-00008888' &&
      near(previewCreated[0].final, 150) && previewCreated[0].dest === 'NRT' && previewCreated[0].pcs === 3,
      JSON.stringify(previewCreated));
    check('V1 預覽：1 筆要連結（160-00000005 已有 Booking，不重複建立）',
      previewLinked.length === 1 && previewLinked[0].mawb === '160-00000005' &&
      Number(previewLinked[0].mawb_record_id) === Number(idA),
      JSON.stringify(previewLinked));
    const stillMissing = await req('GET', '/api/uld-weight/bookings?search=160-00008888');
    check('V1 預覽沒有寫 DB（打板計劃仍查不到 160-00008888）',
      (stillMissing.body.data || []).length === 0, JSON.stringify(stillMissing.body.data));
    const previewDetail = await req('GET', `/api/uld-weight/sheets/${v1Id}`);
    check('V1 預覽沒有回填 mawb_record_id',
      (previewDetail.body.data.ulds[0].items || []).every(it => !it.mawb_record_id));

    const syncApply = await req('POST', `/api/uld-weight/sheets/${v1Id}/sync-bookings`, { dry_run: false });
    const applyData = syncApply.body.data || {};
    const createdRow = (applyData.created || [])[0] || {};
    const linkedRow = (applyData.linked || [])[0] || {};
    check('V1 明確 dry_run:false → 真的寫入（200）',
      syncApply.status === 200 && applyData.dry_run === false, String(syncApply.status));
    check('V1 建立 Booking 後回填明細連結（建立的 1 列、連結的 1 列）',
      !!createdRow.mawb_record_id && createdRow.itemCount === 1 && linkedRow.itemCount === 1,
      `${createdRow.mawb_record_id}／${createdRow.itemCount}／${linkedRow.itemCount}`);
    const newBookingSearch = await req('GET', '/api/uld-weight/bookings?search=160-00008888');
    const newBookingRow = (newBookingSearch.body.data || [])[0];
    check('V1 新 Booking：gross_weight = 夾重後重量 150、pcs 3、dest NRT',
      !!newBookingRow && near(newBookingRow.gross_weight, 150) &&
      Number(newBookingRow.pcs) === 3 && newBookingRow.dest === 'NRT',
      newBookingRow ? `${newBookingRow.gross_weight}／${newBookingRow.pcs}／${newBookingRow.dest}` : 'missing');
    const oldBookingSearch = await req('GET', '/api/uld-weight/bookings?search=160-00000005');
    check('V1 同號 MAWB 只連結、不重複建立（160-00000005 仍只有 1 筆）',
      (oldBookingSearch.body.data || []).length === 1, String((oldBookingSearch.body.data || []).length));
    check('V1 回應帶回夾重表明細（mawb_record_id 已更新，前端可直接覆蓋畫面）',
      !!(syncApply.body.sheet &&
        (syncApply.body.sheet.ulds[0].items || []).every(it => it.mawb_record_id)));
    const syncAgain = await req('POST', `/api/uld-weight/sheets/${v1Id}/sync-bookings`, { dry_run: false });
    const againData = syncAgain.body.data || {};
    check('V1 重複執行是冪等（0 建立、0 連結、alreadyLinked 2）',
      syncAgain.status === 200 && (againData.created || []).length === 0 &&
      (againData.linked || []).length === 0 && againData.alreadyLinked === 2,
      JSON.stringify({ created: (againData.created || []).length, alreadyLinked: againData.alreadyLinked }));
    const syncAudit = await req('GET', '/api/db/tables/audit_log');
    const syncLog = ((syncAudit.body.data && syncAudit.body.data.rows) || [])
      .find(r => r.action === 'uld_weight.sync_bookings' && String(r.target_id) === String(v1Id));
    check('V1 寫入 audit_log（action = uld_weight.sync_bookings）', !!syncLog);
    const syncMissing = await req('POST', '/api/uld-weight/sheets/999999/sync-bookings', { dry_run: false });
    check('V1 不存在的夾重表 → 404', syncMissing.status === 404, String(syncMissing.status));
    const delV1 = await req('DELETE', `/api/uld-weight/sheets/${v1Id}`);
    check('V1 測試用夾重表已刪除', delV1.status === 200, String(delV1.status));

    // ---- V3：歷史版本／異動比對 ----
    const v3List = await req('GET', `/api/uld-weight/sheets/${sheetId}/versions`);
    const v3Versions = v3List.body.data || [];
    check('V3 版本清單 → 200 且有紀錄（create／save／lock／unlock…）',
      v3List.status === 200 && v3Versions.length >= 3,
      `${v3List.status} / ${v3Versions.length} 版`);
    check('V3 版本清單是新到舊（version_no 遞減）',
      v3Versions.every((v, i) => i === 0 || Number(v3Versions[i - 1].version_no) > Number(v.version_no)),
      JSON.stringify(v3Versions.map(v => v.version_no)));
    const firstVersion = v3Versions[v3Versions.length - 1];
    check('V3 第一版的 action = create 且 summary 有單位數',
      firstVersion && firstVersion.action === 'create' &&
      firstVersion.summary && firstVersion.summary.uldCount === 0,
      JSON.stringify(firstVersion && firstVersion.summary));
    const latestVersion = v3Versions[0];
    check('V3 版本清單帶動作代碼與時間（save／lock／unlock 都在）',
      v3Versions.some(v => v.action === 'save') && v3Versions.some(v => v.action === 'lock') &&
      v3Versions.some(v => v.action === 'unlock') && !!latestVersion.created_at,
      JSON.stringify([...new Set(v3Versions.map(v => v.action))]));

    const v3One = await req('GET', `/api/uld-weight/sheets/${sheetId}/versions/${latestVersion.id}`);
    check('V3 單一版本 → 200 且帶完整 snapshot',
      v3One.status === 200 && !!(v3One.body.data.snapshot && v3One.body.data.snapshot.header) &&
      Array.isArray(v3One.body.data.snapshot.units),
      String(v3One.status));

    const v3Diff = await req('GET',
      `/api/uld-weight/sheets/${sheetId}/versions/diff?from=${firstVersion.id}&to=${latestVersion.id}`);
    const v3DiffData = v3Diff.body.data || {};
    check('V3 比對第一版 → 最新版：新增 2 個單位、3 筆明細',
      v3Diff.status === 200 && !!v3DiffData.summary &&
      v3DiffData.summary.unitsAdded === 2 && v3DiffData.summary.itemsAdded === 3,
      JSON.stringify(v3DiffData.summary));
    check('V3 比對結果帶 from／to 版本資訊',
      !!(v3Diff.body.from && v3Diff.body.to &&
        Number(v3Diff.body.from.version_no) === 1 &&
        Number(v3Diff.body.to.version_no) === Number(latestVersion.version_no)),
      JSON.stringify([v3Diff.body.from, v3Diff.body.to]));

    const v3DiffCurrent = await req('GET',
      `/api/uld-weight/sheets/${sheetId}/versions/diff?from=${latestVersion.id}`);
    check('V3 省略 to → 與「目前內容」比較（內容相同 → hasChanges = false）',
      v3DiffCurrent.status === 200 &&
      v3DiffCurrent.body.data.hasChanges === false &&
      v3DiffCurrent.body.to && Number(v3DiffCurrent.body.to.id) === 0,
      JSON.stringify(v3DiffCurrent.body.data.summary));

    const v3NoFrom = await req('GET', `/api/uld-weight/sheets/${sheetId}/versions/diff`);
    check('V3 沒帶 from → 400', v3NoFrom.status === 400, String(v3NoFrom.status));
    const v3BadFrom = await req('GET',
      `/api/uld-weight/sheets/${sheetId}/versions/diff?from=999999`);
    check('V3 from 不存在 → 404', v3BadFrom.status === 404, String(v3BadFrom.status));
    const v3MissingSheet = await req('GET', '/api/uld-weight/sheets/999999/versions');
    check('V3 不存在的夾重表 → 404', v3MissingSheet.status === 404, String(v3MissingSheet.status));

    // 內容沒變的重複儲存不留新版本（避免版本列表被洗版）
    // 註：payload 一定要帶 id（R3 diff 更新），否則每次都會重建列 → id 變了 → 版本也會跟著變
    const v3Detail = await req('GET', `/api/uld-weight/sheets/${sheetId}`);
    const v3Payload = withIds(CASE4, v3Detail.body.data);
    const v3SameSave = await req('PUT', `/api/uld-weight/sheets/${sheetId}`, v3Payload);
    const v3ListAfterSame = await req('GET', `/api/uld-weight/sheets/${sheetId}/versions`);
    const v3CountAfterSame = (v3ListAfterSame.body.data || []).length;
    const v3SameSaveAgain = await req('PUT', `/api/uld-weight/sheets/${sheetId}`, v3Payload);
    const v3ListAfterSameAgain = await req('GET', `/api/uld-weight/sheets/${sheetId}/versions`);
    check('V3 內容相同的重複儲存不新增版本',
      v3SameSave.status === 200 && v3SameSaveAgain.status === 200 &&
      (v3ListAfterSameAgain.body.data || []).length === v3CountAfterSame,
      `${(v3ListAfterSameAgain.body.data || []).length} / ${v3CountAfterSame}`);

    // 鎖定／解鎖會各留一版（狀態也是異動）
    const v3Lock = await req('POST', `/api/uld-weight/sheets/${sheetId}/lock`);
    const v3Unlock = await req('POST', `/api/uld-weight/sheets/${sheetId}/unlock`);
    const v3ListAfterLock = await req('GET', `/api/uld-weight/sheets/${sheetId}/versions`);
    const v3LockList = v3ListAfterLock.body.data || [];
    check('V3 鎖定／解鎖各留一版（+2，且狀態正確）',
      v3Lock.status === 200 && v3Unlock.status === 200 &&
      v3LockList.length === v3CountAfterSame + 2 &&
      v3LockList[0].status === 'draft' && v3LockList[1].status === 'locked',
      `${v3LockList.length} 版／${v3LockList[0].status},${v3LockList[1].status}`);

    // ---- 刪除 ----
    const del = await req('DELETE', `/api/uld-weight/sheets/${sheetId}`);
    check('刪除 → 200', del.status === 200, String(del.status));
    const gone = await req('GET', `/api/uld-weight/sheets/${sheetId}`);
    check('刪除後 GET → 404', gone.status === 404, String(gone.status));
    sheetId = null;
    const delDup = await req('DELETE', `/api/uld-weight/sheets/${dupId}`);
    check('刪除複本 → 200', delDup.status === 200, String(delDup.status));
    dupId = null;
  } catch (err) {
    console.error(err);
    failures += 1;
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`, `${DB_PATH}-journal`].forEach(file => {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { /* ignore */ }
    });
    console.log(`\n===== ${failures === 0 ? '全部通過' : `${failures} 項失敗`} =====`);
    process.exitCode = failures === 0 ? 0 : 1;
  }
})();
