// ===== Shipper Role Project - 端對端測試 =====
// 流程：登入 → 上傳 CX source → 定義欄位 → 執行 pipeline → 檢查產出
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const BASE = 'http://127.0.0.1:3000';
const SOURCE_FILE = path.resolve(__dirname, '..', '..', 'source xls files', 'CX HKG-LHR CX257 3-Aug配对.xlsx');

const cookieJar = {}; // 簡易 cookie 儲存

async function request(method, url, { body, formData, multipart } = {}) {
  const headers = {};
  if (cookieJar.cookie) headers.Cookie = cookieJar.cookie;
  let fetchBody;
  if (multipart) {
    // 不設定 Content-Type，讓 fetch 自動產生 boundary
    fetchBody = multipart;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: fetchBody, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieJar.cookie = setCookie.split(';')[0];
  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, data };
}

async function main() {
  console.log('=== 1. 登入 ===');
  const login = await request('POST', `${BASE}/api/auth/login`, {
    body: { companyCode: 'AGL', userId: 'admin', password: 'admin123' }
  });
  console.log('登入 status:', login.status);
  if (login.status !== 200) {
    console.error('登入失敗:', login.data.error || login.data);
    process.exit(1);
  }

  console.log('\n=== 2. 上傳 CX source ===');
  const formData = new FormData();
  const fileBuffer = fs.readFileSync(SOURCE_FILE);
  formData.append('files', new Blob([fileBuffer]), path.basename(SOURCE_FILE));
  const upload = await request('POST', `${BASE}/api/xls-booking/upload`, { multipart: formData });
  console.log('上傳 status:', upload.status);
  if (upload.status !== 200) {
    console.error('上傳失敗:', upload.data.error || upload.data);
    process.exit(1);
  }
  const { uploadId, files } = upload.data;
  console.log('uploadId:', uploadId);
  console.log('files:', files.map((f) => ({ name: f.originalName, sheets: f.sheets })));

  console.log('\n=== 3. 預覽 sheet 0 ===');
  const file0 = files[0];
  const preview = await request('GET', `${BASE}/api/xls-booking/preview/${uploadId}/${file0.id}/0`);
  console.log('預覽 status:', preview.status);
  if (preview.status !== 200) {
    console.error('預覽失敗:', preview.data.error || preview.data);
    process.exit(1);
  }
  console.log('sheet:', preview.data.sheetName, 'rows:', preview.data.rowCount, 'cols:', preview.data.columnCount);
  // 確認 AH 欄（index 33）是否為「提单收货人」
  const headerRow = preview.data.rows[0];
  console.log('AH 欄 header:', headerRow[33]);
  console.log('AH 欄 row2:', preview.data.rows[1][33]);
  console.log('AH 欄 row3:', preview.data.rows[2][33]);

  console.log('\n=== 4. 定義欄位 + 執行 workflow ===');
  // CX 格式欄位: B=主单编码(1) M=主单大包重量(12) AD=航班号(29)
  // AH=提单收货人(33) CNEE 在該欄下一行
  // 日期: Z=创建时间(25)
  // DEST: 由 S 欄(18) 渠道資訊推斷，但在此測試我們以 AH 欄下面的 CNEE 為主，DEST 留空由系統處理
  const defs = [{
    fileIndex: 0,
    sheetIndex: 0,
    headerRow: 1,
    firstDataRow: 2,
    fieldMap: {
      1: 'mawb',        // B = 主单编码
      12: 'weight',     // M = 主单大包重量
      29: 'flight',     // AD = 航班号
      25: 'flight_date', // Z = 创建时间
      33: 'dest',       // AH = 提单收货人? 不，這是 CNEE
    }
  }];
  // 修正：AH 是 CNEE 名稱欄位。DEST 需另取。CX 檔沒有直接 DEST 欄，以 S 欄(18) 的流向碼不含 DEST 直欄。
  // 用戶說 CX 的 DEST 是 LHR（從檔名與航班可知），但表格中沒有獨立 DEST 欄位。
  // 這裡先用 AH 為 cnee_name，看 workflow 是否能處理。
  defs[0].fieldMap[33] = 'cnee_name';

  const processResult = await request('POST', `${BASE}/api/xls-booking/process`, {
    body: { uploadId, defs }
  });
  console.log('process status:', processResult.status);
  if (processResult.status !== 200) {
    console.error('process 失敗:', processResult.data.error || processResult.data);
    process.exit(1);
  }
  console.log('process 結果:', JSON.stringify({
    count: processResult.data.count,
    zipPaths: processResult.data.zipPaths,
    errors: processResult.data.errors,
    fileResults: processResult.data.fileResults,
  }, null, 2));
}

main().catch((e) => {
  console.error('測試失敗:', e);
  process.exit(1);
});