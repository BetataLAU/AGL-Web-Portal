// ===== HKIA CDP Testing Site：API 端對端測試（自帶伺服器 ＋ 暫存資料庫/資料目錄）=====
// 覆蓋：權限、設定遮罩、#001（Mock）、CTO 預檢、#409 簽章、#405/#401/#415/#409/#410/#411/#412/#416、
//       Mock 202 → 延遲 Callback、Webhook（含 Basic Auth）、歷史紀錄、Production 二次確認、mTLS 缺憑證。
// 用法：node scripts/test-hkia-cdp-api.js
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.HKIA_TEST_PORT || 3171);
const BASE = `http://127.0.0.1:${PORT}`;
const STAMP = Date.now();
const DB_PATH = path.join(ROOT, 'data', `test-hkia-cdp-${STAMP}.db`);
const DATA_DIR = path.join(ROOT, 'data', `test-hkia-cdp-${STAMP}`);
const CREDS = {
  companyCode: process.env.TEST_COMPANY || 'AGL',
  userId: process.env.TEST_USER || 'admin',
  password: process.env.TEST_PASSWORD || 'admin123'
};
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let failures = 0;
let cookie = '';

function check(label, ok, detail) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function req(method, url, body, extraHeaders) {
  const headers = Object.assign({}, extraHeaders || {});
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
  return { status: res.status, text: await res.text() };
}

function queryDb(sql, params = []) {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH);
    db.get(sql, params, (err, row) => {
      db.close();
      if (err || !row) return resolve(null);
      return resolve(Object.values(row)[0]);
    });
  });
}

function waitForAdmin(timeoutMs = 10000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      const n = await queryDb("SELECT COUNT(*) FROM users WHERE user_id = 'admin'");
      if (Number(n) > 0) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function waitUp(child) {
  let log = '';
  child.stdout.on('data', (d) => { log += String(d); });
  child.stderr.on('data', (d) => { log += String(d); });
  for (let i = 0; i < 80; i += 1) {
    try {
      await fetch(`${BASE}/api/auth/me`);
      return true;
    } catch (err) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  console.log(log);
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makePayload(overrides) {
  return Object.assign({
    documentId: crypto.randomUUID(),
    ctoCode: 'AAT',
    cargoType: 'BUK',
    airlineCode: 'CX',
    mawbNumber: '160-1234 5678',
    hawbNumber: 'HAWB0001',
    destination: 'HKG',
    flightNumber: 'CX880',
    flightDate: '2026-11-25T18:00:00+08:00',
    raCode: 'RA12345',
    rfCode: 'RF12345',
    racsfCode: 'RACSF001',
    screeningMethod: 'RACSF',
    securityStatus: { statusCode: 'SPX', screeningMethod: 'RACSF' },
    vehicleRegistration: 'AB1234',
    sealType: 'BOX_TRUCK_V2',
    seal: 'SEAL-0001',
    additionalSecurityInformation: 'SCREENED BY X-RAY AT RACSF.',
    receipt: { emails: ['ops@example.com'] },
    specialHandlingCodes: [],
    cargo: { pieceCount: 10, weight: { value: 950.5, unit: 'KG' }, volume: { value: 4.25, unit: 'CBM' } },
    ulds: [{ uldNumber: 'AKE12345AK', contour: 'AKE', subcontour: '', volume: { value: 4.25, unit: 'CBM' }, weight: { value: 950.5, unit: 'KG' } }]
  }, overrides || {});
}

(async () => {
  console.log('===== HKIA CDP：API 測試 =====');
  fs.mkdirSync(path.join(DATA_DIR, 'db'), { recursive: true });
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      DB_PATH,
      HKIA_DATA_DIR: DATA_DIR,
      SESSIONS_DIR: path.join(DATA_DIR, 'db')
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (d) => process.stderr.write(String(d)));

  try {
    check('伺服器啟動', await waitUp(child), `port ${PORT}`);
    check('全新 DB 由伺服器自己完成 seed（admin 存在）', await waitForAdmin());
    await sleep(300);

    // ---- 靜態資源（前端）----
    const indexRes = await fetch(`${BASE}/index.html`);
    const indexHtml = await indexRes.text();
    check('靜態：index.html 含 HKIA CDP 區塊', indexRes.status === 200 && indexHtml.indexOf('section-hkia-cdp') !== -1);
    const assets = await Promise.all([
      fetch(`${BASE}/js/hkia-cdp.js`),
      fetch(`${BASE}/js/hkia-cdp/cto-validator.js`),
      fetch(`${BASE}/js/hkia-cdp/error-codes.js`),
      fetch(`${BASE}/css/hkia-cdp.css`)
    ]);
    check('靜態：js/hkia-cdp.js 與共用驗證器 / CSS 都回 200',
      assets.every((res) => res.status === 200), assets.map((res) => res.status).join(','));

    // ---- 權限 ----
    check('未登入 GET /api/hkia-cdp/config → 401', (await req('GET', '/api/hkia-cdp/config')).status === 401);
    const login = await req('POST', '/api/auth/login', CREDS);
    check('登入成功（admin）', login.status === 200, String(login.status));

    // ---- 設定 ----
    const cfg0 = await req('GET', '/api/hkia-cdp/config');
    check('GET /config → 15 個 API 定義、預設 Local Mock',
      cfg0.status === 200 && cfg0.body.apis.length === 15 && cfg0.body.config.env === 'mock',
      cfg0.body && cfg0.body.apis ? `${cfg0.body.apis.length} / ${cfg0.body.config.env}` : '');
    check('預設未設定 secret / apiKey',
      cfg0.body.config.hasClientSecret === false && cfg0.body.config.hasApiKey === false);
    check('提供 OpenSSL 指令與 Webhook 路徑',
      !!cfg0.body.openssl.key && cfg0.body.webhookPath === '/api/hkia-cdp/webhook');

    const cfg1 = await req('PUT', '/api/hkia-cdp/config', {
      env: 'mock', role: 'RA', mockDelayMs: 150,
      clientId: 'client-abc', clientSecret: 'secret-value', apiKey: 'KEY12345',
      raCode: 'RA12345', rfCode: 'RF12345'
    });
    check('PUT /config → 200', cfg1.status === 200, String(cfg1.status));
    check('clientSecret 回傳遮罩、hasClientSecret=true',
      cfg1.body.config.clientSecret.indexOf('••') !== -1 && cfg1.body.config.hasClientSecret === true);
    check('apiKey 回傳遮罩（不泄漏完整值）',
      cfg1.body.config.apiKey.indexOf('••••') !== -1 && cfg1.body.config.apiKey.indexOf('KEY12345') === -1);
    check('mockDelayMs 正規化為 150', cfg1.body.config.mockDelayMs === 150, String(cfg1.body.config.mockDelayMs));
    check('PUT 非法 env → 400', (await req('PUT', '/api/hkia-cdp/config', { env: 'uat' })).status === 400);
    check('PUT 非法 role → 400', (await req('PUT', '/api/hkia-cdp/config', { role: 'XX' })).status === 400);

    // ---- #001 ----
    const auth = await req('POST', '/api/hkia-cdp/auth/test', {});
    check('#001（Mock）→ 200 並回傳 token 預覽 / 300 秒',
      auth.status === 200 && !!auth.body.tokenPreview && auth.body.expiresIn === 300,
      auth.status === 200 ? `${auth.body.tokenPreview.slice(0, 12)}…` : String(auth.status));
    check('#001 標示 mTLS 狀態（mock）', auth.body.mtls === 'mock');

    // ---- CTO 預檢（前端與後端同一支） ----
    const lintBad = await req('POST', '/api/hkia-cdp/lint', {
      api: '#405', cto: 'HACTL', cargoType: 'BUK',
      payload: makePayload({ ctoCode: 'HACTL', cargoType: 'BUK', additionalSecurityInformation: 'lowercase', vehicleRegistration: 'AB1234567', cargo: { weight: { value: 1.25 } } })
    });
    check('POST /lint（HACTL 違規）→ ok=false 且含 108717 / 122090',
      lintBad.body.lint.ok === false &&
      lintBad.body.lint.errors.some((e) => e.code === '108717') &&
      lintBad.body.lint.errors.some((e) => e.code === '122090'),
      String(lintBad.body.lint.errors.length));

    // ---- #409 簽章工具 ----
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
    const signRes = await req('POST', '/api/hkia-cdp/sign', { imageBase64: TINY_PNG, privateKeyPem });
    const verified = signRes.status === 200 && crypto.verify(
      'sha256', Buffer.from(TINY_PNG, 'base64'), publicKeyPem, Buffer.from(signRes.body.signature, 'base64')
    );
    check('POST /sign → SHA256withRSA 且可用公鑰驗證', verified, signRes.status === 200 ? signRes.body.algorithm : String(signRes.status));
    check('簽章回傳 hash（64 hex）', signRes.status === 200 && /^[0-9a-f]{64}$/.test(signRes.body.hash));

    // ---- #405 Create Export Order ----
    const created = await req('POST', '/api/hkia-cdp/proxy', {
      api: '#405', body: makePayload({ ctoCode: 'AAT', cargoType: 'BUK' })
    });
    const exportRef = created.body && created.body.response ? created.body.response.export_order_reference_num : '';
    check('#405 → HTTP 200 並回傳 export_order_reference_num',
      created.body.ok === true && created.body.status === 200 && !!exportRef, exportRef || String(created.body.status));
    check('#405 回應附帶 CTO lint 結果', !!created.body.lint && typeof created.body.lint.ok === 'boolean');
    check('#405 成功回應不會被誤判為錯誤（errors 為空、message 保留在 response）',
      Array.isArray(created.body.errors) && created.body.errors.length === 0 &&
      !!created.body.response && typeof created.body.response.message === 'string',
      JSON.stringify(created.body.errors));

    const refs = await req('GET', '/api/hkia-cdp/refs');
    check('GET /refs 含剛才建立的 Export Order',
      refs.body.exportOrders.some((o) => o.reference === exportRef), String(refs.body.exportOrders.length));

    const getOrder = await req('POST', '/api/hkia-cdp/proxy', {
      api: '#406', params: { export_order_reference_num: exportRef }
    });
    check('#406 → HTTP 200 且單號相符',
      getOrder.body.ok === true && getOrder.body.response.export_order_reference_num === exportRef);

    const updateOrder = await req('POST', '/api/hkia-cdp/proxy', {
      api: '#407', params: { export_order_reference_num: exportRef }, body: { remark: 'updated by test' }
    });
    check('#407 Update Export Order → 200', updateOrder.body.ok === true && updateOrder.body.status === 200);

    const notFound = await req('POST', '/api/hkia-cdp/proxy', {
      api: '#402', params: { ra_reference_id: 'RA-NOT-EXIST' }
    });
    check('#402 不存在的單號 → HTTP 404（Mock 回真實狀態碼）', notFound.body.ok === false && notFound.body.status === 404);

    // ---- #401 非同步（202 + 延遲 Callback） ----
    const pre = await req('POST', '/api/hkia-cdp/proxy', {
      api: '#401', body: makePayload({ ctoCode: 'AAT', cargoType: 'BUK' })
    });
    const raRef = pre.body.response ? pre.body.response.ra_reference_id : '';
    check('#401 → 202 並回傳 ra_reference_id / x-request-id',
      pre.body.ok === true && pre.body.status === 202 && !!raRef && !!pre.body.requestId,
      raRef || String(pre.body.status));
    check('#401 告知「Callback 將於 N ms 後送達」',
      !!pre.body.callback && pre.body.callback.expected === true && pre.body.callback.delayMs === 150);
    await sleep(900);
    const cbHistory = await req('GET', '/api/hkia-cdp/history?type=callback&limit=20');
    const matchedCb = (cbHistory.body.items || []).find((item) => item.requestId === pre.body.requestId);
    check('延遲 Callback 已送達並寫入歷史（source_id 對得上）',
      !!matchedCb && matchedCb.matched === true,
      matchedCb ? matchedCb.summary : `history=${(cbHistory.body.items || []).length}`);
    check('Callback 狀態更新為 ACCEPTED_FROM_CTO',
      !!matchedCb && matchedCb.response && matchedCb.response.status === 'ACCEPTED_FROM_CTO');

    const pending = await req('GET', '/api/hkia-cdp/pending');
    const pendingRow = (pending.body.items || []).find((item) => item.requestId === pre.body.requestId);
    check('Pending 清單顯示該請求已回調（ACCEPTED）',
      !!pendingRow && String(pendingRow.status).indexOf('ACCEPTED') !== -1, pendingRow ? pendingRow.status : 'not found');

    const updatedPre = await req('POST', '/api/hkia-cdp/proxy', {
      api: '#403', params: { ra_reference_id: raRef }, body: { remark: 'updated by test' }
    });
    check('#403 Update Pre-Declaration → 202（Async）', updatedPre.body.ok === true && updatedPre.body.status === 202);

    // ---- #415 Lite（CTO 拒絕情境） ----
    const lite = await req('POST', '/api/hkia-cdp/proxy', {
      api: '#415', scenario: 'cto_reject',
      body: makePayload({ ctoCode: 'AAT', cargoType: 'BUK', screeningMethod: 'CTO', securityStatus: { statusCode: 'SCO', screeningMethod: 'CTO' }, natureOfGoods: 'GENERAL CARGO', ulds: [] })
    });
    check('#415 → 202 且 Callback 預覽為 REJECTED_FROM_CTO',
      lite.body.status === 202 && lite.body.callback && lite.body.callback.preview.status === 'REJECTED_FROM_CTO');
    await sleep(900);
    const cbHistory2 = await req('GET', '/api/hkia-cdp/history?type=callback&limit=20');
    const rejectedCb = (cbHistory2.body.items || []).find((item) => item.requestId === lite.body.requestId);
    check('拒絕 Callback 帶 cto_errors（可被 UI 高亮）',
      !!rejectedCb && Array.isArray(rejectedCb.response.cto_errors) && rejectedCb.response.cto_errors.length > 0);

    // ---- #409 安檢影像（自動簽章） ----
    const image = await req('POST', '/api/hkia-cdp/proxy', {
      api: '#409',
      params: { export_order_reference_num: exportRef, role: 'ra' },
      body: {
        exportOrderReferenceNum: exportRef,
        documentId: crypto.randomUUID(),
        imageName: 'screening.png',
        imageContentType: 'image/png',
        imageBase64: TINY_PNG,
        ctoCode: 'AAT'
      }
    });
    check('#409 自動簽章 → 200 且 signatureVerified=true',
      image.body.ok === true && image.body.response && image.body.response.signatureVerified === true,
      image.body.response ? image.body.response.imageId : String(image.body.status));
    check('#409 回傳簽章摘要（SHA256withRSA）',
      !!image.body.signature && image.body.signature.algorithm === 'SHA256withRSA' && !!image.body.signature.hash);

    const unsigned = await req('POST', '/api/hkia-cdp/proxy', {
      api: '#409', autoSign: false,
      params: { export_order_reference_num: exportRef, role: 'ra' },
      body: { exportOrderReferenceNum: exportRef, imageBase64: TINY_PNG }
    });
    check('#409 未簽章（autoSign=false）→ Mock 回 422 / CDP_050',
      unsigned.body.ok === false && unsigned.body.status === 422);

    // ---- 查詢 API ----
    const truck = await req('POST', '/api/hkia-cdp/proxy', { api: '#410', params: { ra_reference_id: raRef } });
    check('#410 → 200 且有車牌 / 狀態', truck.body.ok === true && !!truck.body.response.vehicleRegistration, String(truck.body.status));

    const rcl = await req('POST', '/api/hkia-cdp/proxy', { api: '#411', params: { ra_reference_id: raRef } });
    const pdfBase64 = rcl.body.response ? rcl.body.response.encodedPdf : '';
    const pdfBytes = pdfBase64 ? Buffer.from(pdfBase64, 'base64') : Buffer.alloc(0);
    check('#411 → 200 且 encodedPdf 是真正的 PDF（%PDF）',
      rcl.body.ok === true && pdfBytes.slice(0, 4).toString('utf8') === '%PDF',
      `${pdfBytes.length} bytes`);
    const historyAfterPdf = await req('GET', '/api/hkia-cdp/history?limit=50');
    check('#411 歷史紀錄不存整份 base64（避免檔案膨脹）',
      (historyAfterPdf.body.items || []).every((item) => !item.response || String(item.response.encodedPdf || '').length < 500));

    const flight = await req('POST', '/api/hkia-cdp/proxy', { api: '#412', params: { ra_reference_id: raRef } });
    check('#412 → 200 且狀態 DEPARTED', flight.body.ok === true && flight.body.response.status === 'DEPARTED');

    const deletedPre = await req('POST', '/api/hkia-cdp/proxy', { api: '#404', params: { ra_reference_id: raRef } });
    check('#404 Delete Pre-Declaration → 202（Async）', deletedPre.body.ok === true && deletedPre.body.status === 202);
    const afterDelete = await req('POST', '/api/hkia-cdp/proxy', { api: '#402', params: { ra_reference_id: raRef } });
    check('#402 刪除後 → 404', afterDelete.body.ok === false && afterDelete.body.status === 404);

    const delMawb = await req('POST', '/api/hkia-cdp/proxy', { api: '#416', params: { mawb_num: '160-1234 5678' } });
    check('#416 → 200 且狀態 DELETED', delMawb.body.ok === true && delMawb.body.response.status === 'DELETED');

    const delOrder = await req('POST', '/api/hkia-cdp/proxy', { api: '#408', params: { export_order_reference_num: exportRef } });
    check('#408 Delete Export Order → 200', delOrder.body.ok === true && delOrder.body.status === 200);

    // ---- 安全與錯誤處理 ----
    const invalidApi = await req('POST', '/api/hkia-cdp/proxy', { api: '#999' });
    check('未知 API → 400 API_UNKNOWN', invalidApi.status === 400 && invalidApi.body.code === 'API_UNKNOWN');
    check('#001 不可走 /proxy → 400 API_USE_AUTH',
      (await req('POST', '/api/hkia-cdp/proxy', { api: '#001' })).body.code === 'API_USE_AUTH');
    const prod = await req('POST', '/api/hkia-cdp/proxy', { api: '#406', env: 'prod', params: { export_order_reference_num: exportRef } });
    check('Production 未二次確認 → 400 PROD_CONFIRM_REQUIRED', prod.status === 400 && prod.body.code === 'PROD_CONFIRM_REQUIRED');
    const sitNoCert = await req('POST', '/api/hkia-cdp/proxy', {
      api: '#406', env: 'sit',
      overrides: { clientId: 'c', clientSecret: 's', apiKey: 'k', certPath: '', keyPath: '' },
      params: { export_order_reference_num: exportRef }
    });
    check('SIT 缺 mTLS 憑證 → 回應 CERT_REQUIRED（不會真的連外）',
      sitNoCert.body.ok === false && sitNoCert.body.error && sitNoCert.body.error.code === 'CERT_REQUIRED',
      sitNoCert.body.error ? sitNoCert.body.error.code : String(sitNoCert.status));

    // ---- Webhook ----
    const webhookInfo = await req('GET', '/api/hkia-cdp/webhook');
    check('GET /webhook → 顯示回調 URL 與預期 body',
      webhookInfo.status === 200 && String(webhookInfo.body.endpoint).indexOf('/api/hkia-cdp/webhook') !== -1);
    check('Webhook 缺 source_id → 400', (await req('POST', '/api/hkia-cdp/webhook', { status: 'X' })).status === 400);

    await req('PUT', '/api/hkia-cdp/config', { webhookPass: 'pw123' });
    check('設定 webhookPass 後，無 Basic Auth → 401',
      (await req('POST', '/api/hkia-cdp/webhook', { source_id: 'no-auth', status: 'ACCEPTED_FROM_CTO' })).status === 401);
    const basic = 'Basic ' + Buffer.from('hkia:pw123').toString('base64');
    const withAuth = await req('POST', '/api/hkia-cdp/webhook', { source_id: pre.body.requestId, status: 'ACCEPTED_FROM_CTO' }, { Authorization: basic });
    check('帶正確 Basic Auth → 200（並比對到原請求）',
      withAuth.status === 200 && withAuth.body.matched === true, String(withAuth.status));

    check('模擬 Callback 缺 source_id → 400',
      (await req('POST', '/api/hkia-cdp/simulate-callback', { status: 'X' })).status === 400);
    const simulated = await req('POST', '/api/hkia-cdp/simulate-callback', {
      source_id: crypto.randomUUID(), status: 'REJECTED_FROM_CTO', cto_errors: [{ code: '108717', message: 'Weight allows 1 decimal place only' }]
    });
    check('模擬 Callback → 200（未匹配也算收到）', simulated.status === 200 && simulated.body.ok === true);

    // ---- 歷史 / 重置 / 健康 ----
    check('DELETE /history → 200', (await req('DELETE', '/api/hkia-cdp/history')).status === 200);
    check('清空後歷史為 0', (await req('GET', '/api/hkia-cdp/history')).body.items.length === 0);
    const reset = await req('POST', '/api/hkia-cdp/mock/reset');
    check('POST /mock/reset → 200 且清空單號', reset.status === 200 && reset.body.state.exportOrders === 0);
    const health = await req('GET', '/api/hkia-cdp/health');
    check('GET /health → mockMode / rateLimit(15) / webhookPath',
      health.status === 200 && health.body.mockMode === true && health.body.rateLimit.limit === 15 &&
      health.body.webhookPath === '/api/hkia-cdp/webhook');
    check('health：Mock 模式標示 mTlsRequired=false', health.body.mTlsRequired === false);

    // ---- mTLS 檢查 / 憑證上傳內容驗證 ----
    async function uploadPem(kind, content, filename) {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', new Blob([content], { type: 'application/x-pem-file' }), filename);
      const res = await fetch(`${BASE}/api/hkia-cdp/certs`, { method: 'POST', headers: { Cookie: cookie }, body: form });
      const ct = res.headers.get('content-type') || '';
      return { status: res.status, body: ct.includes('json') ? await res.json() : { text: await res.text() } };
    }
    const csrPem = '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----\n';
    const certPem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
    const csrUpload = await uploadPem('cert', csrPem, 'my-csr.pem');
    check('上傳 CSR 到憑證欄 → 400 CERT_FILE_INVALID',
      csrUpload.status === 400 && csrUpload.body.code === 'CERT_FILE_INVALID', String(csrUpload.status));
    const certAsKey = await uploadPem('key', certPem, 'cert.pem');
    check('上傳憑證到私鑰欄 → 400 KEY_FILE_INVALID',
      certAsKey.status === 400 && certAsKey.body.code === 'KEY_FILE_INVALID', String(certAsKey.status));
    const keyPair2 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem2 = keyPair2.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const keyUpload = await uploadPem('key', keyPem2, 'client.key');
    check('上傳合法 PKCS#8 私鑰 → 200 並更新 keyPath',
      keyUpload.status === 200 && /client\.key$/.test(keyUpload.body.path || ''), String(keyUpload.status));

    await req('PUT', '/api/hkia-cdp/config', { env: 'sit', certPath: 'C:\\nope\\cert.pem', keyPath: 'C:\\nope\\key.pem' });
    const healthSit = await req('GET', '/api/hkia-cdp/health');
    check('health：SIT 缺憑證 → mTlsConfigured=false 且有 issues',
      healthSit.body.mTlsRequired === true && healthSit.body.mTlsConfigured === false &&
      Array.isArray(healthSit.body.mTlsIssues) && healthSit.body.mTlsIssues.length >= 1,
      (healthSit.body.mTlsIssues || []).join(' / '));
    await req('PUT', '/api/hkia-cdp/config', { env: 'mock', certPath: '', keyPath: '' });
  } catch (err) {
    check(`測試過程未預期例外：${err && err.message ? err.message : err}`, false);
  } finally {
    try { child.kill(); } catch (err) { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (err) { /* Windows 可能鎖檔 */ }
    try { fs.rmSync(DB_PATH, { force: true }); } catch (err) { /* ignore */ }
    try { fs.rmSync(`${DB_PATH}-wal`, { force: true }); } catch (err) { /* ignore */ }
    try { fs.rmSync(`${DB_PATH}-shm`, { force: true }); } catch (err) { /* ignore */ }
    console.log(`\n===== ${failures === 0 ? '全部通過' : `${failures} 項失敗`} =====`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
