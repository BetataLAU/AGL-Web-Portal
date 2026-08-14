// ===== Shipper Role Project - 端對端測試（非同步 + 進度） =====
// 流程：登入 → 上傳 CX source → 定義欄位 → 啟動 process → 輪詢 status → 檢查產出與 PDF 大小
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:3000';
const SOURCE_FILE = path.resolve(__dirname, '..', '..', 'source xls files', 'CX HKG-LHR CX257 3-Aug配对.xlsx');

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

async function main() {
  console.log('=== 1. 登入 ===');
  const login = await request('POST', `${BASE}/api/auth/login`, {
    body: { companyCode: 'AGL', userId: 'admin', password: 'admin123' }
  });
  if (login.status !== 200) { console.error('登入失敗:', login.data.error); process.exit(1); }
  console.log('登入 OK');

  console.log('\n=== 2. 上傳 CX source ===');
  const formData = new FormData();
  const fileBuffer = fs.readFileSync(SOURCE_FILE);
  formData.append('files', new Blob([fileBuffer]), path.basename(SOURCE_FILE));
  const upload = await request('POST', `${BASE}/api/xls-booking/upload`, { multipart: formData });
  if (upload.status !== 200) { console.error('上傳失敗:', upload.data.error); process.exit(1); }
  const { uploadId, files } = upload.data;
  console.log('uploadId:', uploadId);
  const file0 = files[0];

  console.log('\n=== 3. 預覽（確認 AH 欄 CNEE） ===');
  const preview = await request('GET', `${BASE}/api/xls-booking/preview/${uploadId}/${file0.id}/0`);
  if (preview.status !== 200) { console.error('預覽失敗:', preview.data.error); process.exit(1); }
  console.log('AH 欄 row2:', (preview.data.rows[1][34] || '').slice(0, 60));

  console.log('\n=== 4. 啟動 process（非同步） ===');
  const defs = [{
    fileIndex: 0,
    sheetIndex: 0,
    headerRow: 1,
    firstDataRow: 2,
    fieldMap: {
      1: 'mawb',        // B 主單編碼
      12: 'weight',     // M 主單大包重量
      13: 'pcs',        // N? 實際用 L 小包數量，這裡示範用 E 計劃出庫數量
      29: 'flight',     // AD 航班號
      25: 'flight_date',// Z 創建時間
      33: 'cnee_name',  // AH 提單收貨人（CX 用）
    }
  }];
  // 修正：CX 檔件數用 E(4)、重量用 M(12)、日期用 Z(25)
  defs[0].fieldMap = { 1: 'mawb', 4: 'pcs', 12: 'weight', 29: 'flight', 25: 'flight_date', 33: 'cnee_name' };

  const proc = await request('POST', `${BASE}/api/xls-booking/process`, { body: { uploadId, defs } });
  if (proc.status !== 200) { console.error('process 啟動失敗:', proc.data.error); process.exit(1); }
  const jobId = proc.data.jobId;
  console.log('jobId:', jobId);

  console.log('\n=== 5. 輪詢進度 ===');
  let lastPct = -1;
  let result = null;
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const st = await request('GET', `${BASE}/api/xls-booking/status/${jobId}`);
    const pct = Math.round(st.data.progress);
    if (pct !== lastPct) {
      console.log(`  ${pct}% - ${st.data.message}`);
      lastPct = pct;
    }
    if (st.data.status === 'done') { result = st.data.result; break; }
    if (st.data.status === 'error') { console.error('job 失敗:', st.data.error); process.exit(1); }
  }
  if (!result) { console.error('逾時'); process.exit(1); }

  console.log('\n=== 6. 結果 ===');
  console.log('count:', result.count);
  console.log('errors:', result.errors);
  console.log('zipPaths:', result.zipPaths.map((z) => z.name));
  (result.zipPaths || []).forEach((z) => {
    const full = z.path;
    if (fs.existsSync(full)) console.log(`  zip size: ${(fs.statSync(full).size / 1024).toFixed(1)} KB`);
  });
  const reportPath = result.reportPath;
  if (reportPath && fs.existsSync(reportPath)) {
    console.log(`report: ${(fs.statSync(reportPath).size / 1024).toFixed(1)} KB`);
  }
  console.log('\n✅ 端對端測試完成');
}

main().catch((e) => { console.error('測試失敗:', e); process.exit(1); });