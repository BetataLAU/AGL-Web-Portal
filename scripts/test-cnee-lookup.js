// ===== Shipper Role Project - CNEE 對照區測試 =====
// 1) 單元測試：直接讀 b2719b93a5db.xlsx，驗證自動抽取 + DEST/REMARK 比對、手動覆寫、缺 CNEE 路徑
// 2) 端對端：登入 → 上傳 → /cnee-preview 驗證 6 筆 MAWB → /process（含一筆 override）→ 檢查 warnings / payload
// 啟動方式：先 node server.js，再跑本腳本（沿用 test-xls-workflow.js 的登入/輪詢模式）
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:3000';
const SOURCE_FILE = path.resolve(__dirname, '..', 'data', 'uploads', 'b2719b93a5db.xlsx');
const { cleanCell } = require('./xls-utils');

const cookieJar = {};

async function request(method, url, { body, multipart } = {}) {
  const headers = {};
  if (cookieJar.cookie) headers.Cookie = cookieJar.cookie;
  let fetchBody;
  if (multipart) {
    fetchBody = multipart;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: fetchBody });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieJar.cookie = setCookie.split(';')[0];
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

// 讀取 xlsx 全部列（與後端 sheetPreview 相同的值處理）
async function readRows(filePath) {
  const ExcelJS = require(path.resolve(__dirname, '..', 'node_modules', 'exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row) => {
    const vals = [];
    for (let c = 1; c <= row.cellCount; c++) vals.push(row.getCell(c).value);
    rows.push(vals);
  });
  return rows;
}

const DEFS = [{
  fileIndex: 0,
  sheetIndex: 0,
  headerRow: 1,
  firstDataRow: 2,
  fieldMap: { 4: 'flight_date', 5: 'flight', 6: 'dest', 7: 'mawb', 8: 'pcs', 9: 'weight', 10: 'battery', 11: 'remark' },
  cneeLookup: { enabled: true, auto: true },
}];

// 預期：MAWB → CNEE 開頭（比對到哪個區塊）
const EXPECTED = {
  '369-99878995': 'Mile Express',
  '369-99879006': 'Mile Express',
  '369-99879010': 'EMPRESA BRASILEIRA',
  '369-99878881': 'GALEON LOGISTICS',
  '369-99878892': 'LOGISTICA Y TRANSPORTES',
  '369-99878940': 'LOGISTICA Y TRANSPORTES',
};

async function unitTest() {
  console.log('=== 單元測試：extractCneeLookupArea + matchCnee（經 standardizeRows） ===');
  const { standardizeRows, extractCneeLookupArea } = require(path.resolve(__dirname, 'xls-workflow.js'));
  const cellCases = [
    [{ richText: [{ text: 'GULF SYSTEM ' }, { text: 'INTERNATIONAL' }] }, 'GULF SYSTEM INTERNATIONAL'],
    [{ text: 'GULF SYSTEM', hyperlink: 'https://example.com' }, 'GULF SYSTEM'],
    [{ formula: 'A1+B1', result: 'GULF SYSTEM' }, 'GULF SYSTEM'],
  ];
  for (const [input, expected] of cellCases) {
    const actual = cleanCell(input);
    if (actual !== expected || actual.includes('[object Object]')) {
      console.error('❌ ExcelJS 儲存格物件清理錯誤:', actual);
      process.exit(1);
    }
  }
  console.log('✅ ExcelJS rich-text / hyperlink / formula 儲存格清理正確');
  const rows = await readRows(SOURCE_FILE);

  const blocks = extractCneeLookupArea(rows).filter((b) => b.cnee);
  console.log(`對照區區塊數：${blocks.length}（預期 ≥ 9）`);
  if (blocks.length < 9) { console.error('❌ 區塊數不足'); process.exit(1); }

  const recs = standardizeRows(rows, { firstDataRow: 2, fieldMap: DEFS[0].fieldMap, cneeLookup: { enabled: true, auto: true } });
  console.log(`標準化列數：${recs.length}（預期 6）`);
  if (recs.length !== 6) { console.error('❌ 列數不符'); process.exit(1); }

  let pass = 0;
  for (const r of recs) {
    const exp = EXPECTED[r.mawb] || '';
    const ok = !!exp && r.cnee.startsWith(exp);
    console.log(`  ${ok ? '✅' : '❌'} ${r.mawb}（DEST: ${r.dest} REMARK: ${r.remark || '-'}）→ ${r.cnee.slice(0, 40)}`);
    if (ok) pass++;
  }
  if (pass !== recs.length) { console.error('❌ CNEE 比對未全數通過'); process.exit(1); }

  // 手動覆寫：cneeOverrides 優先於對照結果
  const recsOv = standardizeRows(rows, {
    firstDataRow: 2,
    fieldMap: DEFS[0].fieldMap,
    cneeLookup: { enabled: true, auto: true },
    cneeOverrides: { '369-99878995': 'TEST CNEE OVERRIDE' },
  });
  const ov = recsOv.find((r) => r.mawb === '369-99878995');
  if (!ov || ov.cnee !== 'TEST CNEE OVERRIDE') { console.error('❌ cneeOverrides 未生效'); process.exit(1); }
  console.log('✅ cneeOverrides 生效：369-99878995 →', ov.cnee);

  // 缺 CNEE 路徑：DEST 沒有對應區塊 → cnee 空白
  const recsMiss = standardizeRows(
    [['', '', '', '', '', '', '', '', '', '', '', ''], ['', '', '', '', '2026-09-01', '5Y8050', 'XYZ', '369-99999999', '1', '1', '', '']],
    { firstDataRow: 2, fieldMap: DEFS[0].fieldMap, cneeLookup: { enabled: true, auto: true } }
  );
  if (recsMiss.length !== 1 || (recsMiss[0].cnee || '') !== '') { console.error('❌ 缺 CNEE 路徑錯誤'); process.exit(1); }
  console.log('✅ 缺 CNEE 路徑：DEST=XYZ（無對應區塊）→ cnee 空白（將進入警告清單）');
}

async function e2eTest() {
  console.log('\n=== 端對端測試 ===');
  const login = await request('POST', `${BASE}/api/auth/login`, { body: { companyCode: 'AGL', userId: 'admin', password: 'admin123' } });
  if (login.status !== 200) { console.error('登入失敗:', login.data.error); process.exit(1); }
  console.log('登入 OK');

  const formData = new FormData();
  formData.append('files', new Blob([fs.readFileSync(SOURCE_FILE)]), path.basename(SOURCE_FILE));
  const upload = await request('POST', `${BASE}/api/xls-booking/upload`, { multipart: formData });
  if (upload.status !== 200) { console.error('上傳失敗:', upload.data.error); process.exit(1); }
  const { uploadId, files } = upload.data;
  console.log('uploadId:', uploadId);
  const file0 = files[0];

  console.log('\n=== /cnee-preview 驗證 6 筆 MAWB ===');
  const preview = await request('POST', `${BASE}/api/xls-booking/cnee-preview`, { body: { uploadId, defs: DEFS } });
  if (preview.status !== 200) { console.error('cnee-preview 失敗:', preview.data.error); process.exit(1); }
  const info = (preview.data.results || []).find((r) => r.fileIndex === 0);
  if (!info) { console.error('cnee-preview 沒有回傳 fileIndex 0'); process.exit(1); }
  console.log(`blocks: ${info.blocks.length}`);
  let pass = 0;
  for (const e of info.entries) {
    const exp = EXPECTED[e.mawb] || '';
    const ok = !!exp && e.cnee.startsWith(exp);
    console.log(`  ${ok ? '✅' : '❌'} ${e.mawb} → ${e.cnee.slice(0, 40)}`);
    if (ok) pass++;
  }
  if (pass !== info.entries.length) { console.error('❌ cnee-preview 比對未全數通過'); process.exit(1); }

  console.log('\n=== /process（含一筆 cneeOverrides） ===');
  const bodyDefs = DEFS.map((d) => ({
    ...d,
    selectedMawbs: Object.keys(EXPECTED),
    cneeOverrides: { '369-99878995': 'TEST CNEE OVERRIDE' },
  }));
  const proc = await request('POST', `${BASE}/api/xls-booking/process`, { body: { uploadId, defs: bodyDefs } });
  if (proc.status !== 200) { console.error('process 啟動失敗:', proc.data.error); process.exit(1); }
  const jobId = proc.data.jobId;
  console.log('jobId:', jobId);

  console.log('\n=== 輪詢進度 ===');
  let lastPct = -1;
  let result = null;
  for (let i = 0; i < 360; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const st = await request('GET', `${BASE}/api/xls-booking/status/${jobId}`);
    const pct = Math.round(st.data.progress);
    if (pct !== lastPct) { console.log(`  ${pct}% - ${st.data.message}`); lastPct = pct; }
    if (st.data.status === 'done') { result = st.data.result; break; }
    if (st.data.status === 'error') { console.error('job 失敗:', st.data.error); process.exit(1); }
  }
  if (!result) { console.error('逾時'); process.exit(1); }

  console.log(`count: ${result.count}，warnings: ${result.warnings.length}`);
  if (result.warnings.length !== 0) {
    console.error('❌ 全部 6 筆都有 CNEE，warnings 應為 0'); process.exit(1);
  }
  if (result.count !== 6) { console.error(`❌ 應產生 6 份 PDF，實際 ${result.count}`); process.exit(1); }

  // 檢查 SLI/ELI payload：369-99878995 應使用 override 值
  const payloadPath = path.join(result.workDir, 'sli-eli-payload.json');
  if (fs.existsSync(payloadPath)) {
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    const records = payload.records || [];
    const rec = records.find((p) => p.mawb === '369-99878995');
    const hasOverride = !!rec && rec.sli && rec.sli.D9 === 'TEST CNEE OVERRIDE';
    const hasMile = records.some((p) => p.mawb === '369-99879010' && p.sli && p.sli.D9 && p.sli.D9.startsWith('EMPRESA BRASILEIRA'));
    console.log(`payload override（369-99878995）: ${hasOverride ? '✅' : '❌'}，GRU 預設 CNEE: ${hasMile ? '✅' : '❌'}`);
    if (!hasOverride || !hasMile) process.exit(1);
  } else {
    console.warn('⚠️ 未找到 sli-eli-payload.json，跳過 payload 驗證');
  }

  console.log('\n✅ CNEE 對照區測試完成');
}

(async () => {
  await unitTest();
  await e2eTest();
})().catch((e) => { console.error('測試失敗:', e); process.exit(1); });
