// ===== HKIA CDP：API 定義表 / 路徑組裝 / mTLS Client / Token 快取 / 限流 =====
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

// Section 4：13 支 API（含 #415 / #416，共 15 個 operation）
const API_DEFS = {
  '#001': { name: 'Authentication', method: 'POST', paths: ['/profile/public/external/v1/{role}/auth/token'], success: 200, async: false, needToken: false, requestId: false, contentType: 'application/x-www-form-urlencoded' },
  '#401': { name: 'Create Pre-Declaration', method: 'POST', paths: ['/export/external/v1/ra/pre-declarations'], success: 202, async: true, requestId: true },
  '#402': { name: 'Retrieve Pre-Declaration', method: 'GET', paths: ['/export/external/v1/ra/pre-declarations/{ra_reference_id}', '/export/external/v1/ra/pre-declarations?cto_predeclaration_num={cto_predeclaration_num}'], success: 200 },
  '#403': { name: 'Update Pre-Declaration', method: 'PUT', paths: ['/export/external/v1/ra/pre-declarations/{ra_reference_id}'], success: 202, async: true, requestId: true },
  '#404': { name: 'Delete Pre-Declaration', method: 'DELETE', paths: ['/export/external/v1/ra/pre-declarations/{ra_reference_id}'], success: 202, async: true, requestId: true },
  '#405': { name: 'Create Export Order', method: 'POST', paths: ['/export/external/v1/ra/export-orders'], success: 200 },
  '#406': { name: 'Retrieve Export Order', method: 'GET', paths: ['/export/external/v1/ra/export-orders/{export_order_reference_num}'], success: 200 },
  '#407': { name: 'Update Export Order', method: 'PUT', paths: ['/export/external/v1/ra/export-orders/{export_order_reference_num}'], success: 200 },
  '#408': { name: 'Delete Export Order', method: 'DELETE', paths: ['/export/external/v1/ra/export-orders/{export_order_reference_num}'], success: 200 },
  '#409': { name: 'Upload Screening Image', method: 'POST', paths: ['/export/external/v1/{role}/export-orders/{export_order_reference_num}/screening-images'], success: 200, needRolePath: true },
  '#410': { name: 'Retrieve Truck Arrival', method: 'GET', paths: ['/export/external/v1/ra/pre-declarations/{ra_reference_id}/truck-arrival', '/export/external/v1/ra/truck-arrival?cto_predeclaration_num={cto_predeclaration_num}'], success: 200 },
  '#411': { name: 'Retrieve RCL', method: 'GET', paths: ['/export/external/v1/ra/pre-declarations/{ra_reference_id}/rcl', '/export/external/v1/ra/rcl?cto_predeclaration_num={cto_predeclaration_num}'], success: 200 },
  '#412': { name: 'Retrieve Flight Departure', method: 'GET', paths: ['/export/external/v1/ra/pre-declarations/{ra_reference_id}/flight-departure', '/export/external/v1/ra/flight-departure?cto_predeclaration_num={cto_predeclaration_num}', '/export/external/v1/ra/flight-departure?waybill_num={waybill_num}'], success: 200 },
  '#415': { name: 'Create Lite Pre-Declaration', method: 'POST', paths: ['/export/external/v1/ra/lite-pre-declarations'], success: 202, async: true, requestId: true },
  '#416': { name: 'Delete MAWB', method: 'DELETE', paths: ['/export/external/v1/ra/mawb/{mawb_num}'], success: 200 }
};

const BASE_URLS = {
  sit: 'https://api-external.sit.hkiacargo.com',
  prod: 'https://api-external.hkiacargo.com'
};

// 把 template 的 {placeholder} 換成 params 的值；全部具備才採用該 template
function buildPath(apiKey, params = {}, role = 'ra') {
  const def = API_DEFS[apiKey];
  if (!def) throw Object.assign(new Error(`不支援的 API：${apiKey}`), { code: 'API_UNKNOWN' });
  const merged = Object.assign({}, params);
  if (!merged.role) merged.role = String(role || 'ra').toLowerCase();
  const tried = [];
  for (const template of def.paths) {
    const keys = [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
    const missing = keys.filter((k) => merged[k] === undefined || merged[k] === null || String(merged[k]).trim() === '');
    if (missing.length) { tried.push({ template, missing }); continue; }
    const path = template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, k) => encodeURIComponent(String(merged[k]).trim()));
    return { def, apiKey, path };
  }
  const err = new Error(`缺少路徑參數：${tried.map((t) => t.missing.join(',')).join(' 或 ')}`);
  err.code = 'PARAM_MISSING';
  err.details = tried;
  throw err;
}

// ---------- Token 快取（4.5 分鐘；Spec 有效期 300 秒） ----------
const TOKEN_TTL_MS = 270 * 1000;
const tokenCache = new Map();

function mockAccessToken(role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'hkia-cdp-mock',
    role: role || 'RA',
    iss: 'local-mock',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300
  })).toString('base64url');
  return `${header}.${payload}.MOCK_SIGNATURE`;
}

function tokenCacheInfo(detail) {
  return Array.from(tokenCache.entries()).map(([key, value]) => ({
    key: detail ? key : undefined,
    expiresAt: value.expiresAt,
    expiresIn: Math.max(0, Math.round((value.expiresAt - Date.now()) / 1000)),
    role: value.role,
    env: value.env
  }));
}

function clearTokenCache() {
  tokenCache.clear();
}

// ---------- 限流（15 requests/second per RA） ----------
function createRateLimiter(limit = 15, windowMs = 1000) {
  const stamps = [];
  let waiting = 0;
  function prune(now) {
    while (stamps.length && now - stamps[0] > windowMs) stamps.shift();
  }
  function acquire() {
    return new Promise((resolve) => {
      const tick = () => {
        const now = Date.now();
        prune(now);
        if (stamps.length < limit) {
          stamps.push(now);
          waiting = Math.max(0, waiting - 1);
          resolve();
        } else {
          setTimeout(tick, 25);
        }
      };
      waiting += 1;
      tick();
    });
  }
  return {
    acquire,
    stats: () => { prune(Date.now()); return { limit, windowMs, used: stamps.length, waiting }; }
  };
}

const rateLimiter = createRateLimiter(15, 1000);

// ---------- mTLS HTTPS 請求（TLS 1.2、30 秒逾時） ----------
// 憑證檔可能是「憑證 + 私鑰」合併的 .pem（AAHK 有時只給一個檔）→ 沒設 keyPath 時自動偵測。
const pemProbeCache = new Map();

function readPemProbe(filePath) {
  if (!filePath) return { cert: false, key: false };
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    // 檔案不存在／無權限：不要快取，之後補上檔案才能立刻偵測到
    pemProbeCache.delete(filePath);
    return { cert: false, key: false };
  }
  const cached = pemProbeCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.probe;
  let probe = { cert: false, key: false };
  try {
    if (stat.size > 0 && stat.size <= 10 * 1024 * 1024) {
      const text = fs.readFileSync(filePath, 'utf8');
      probe = {
        cert: /-----BEGIN CERTIFICATE-----/.test(text),
        key: /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(text)
      };
    }
  } catch (err) { /* 讀不到 → 視為沒有 */ }
  pemProbeCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, probe });
  return probe;
}

function fileHasPrivateKey(filePath) {
  return readPemProbe(filePath).key;
}

function readCertInfo(certPath) {
  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(certPath));
    return {
      subject: cert.subject.replace(/\n/g, ' | '),
      issuer: cert.issuer.replace(/\n/g, ' | '),
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      fingerprint256: cert.fingerprint256,
      keyType: cert.publicKey.asymmetricKeyType,
      keyBits: cert.publicKey.asymmetricKeyDetails ? cert.publicKey.asymmetricKeyDetails.modulusLength : undefined
    };
  } catch (err) {
    return null;
  }
}

// 給 UI / health 用的 mTLS 檢查（不實際連線）：告訴使用者缺哪個檔案
function mtlsStatus(config) {
  const cfg = config || {};
  const certPath = cfg.certPath || '';
  const keyPath = cfg.keyPath || '';
  const issues = [];
  let certOk = false;
  let keyOk = false;

  if (!certPath) {
    issues.push('未設定客戶端憑證（.pem）');
  } else if (!fs.existsSync(certPath)) {
    issues.push(`找不到憑證檔案：${certPath}`);
  } else if (!readPemProbe(certPath).cert) {
    issues.push('憑證檔內容沒有 BEGIN CERTIFICATE（請確認是 PEM 格式）');
  } else {
    certOk = true;
  }

  const certInfo = certOk ? readCertInfo(certPath) : null;
  if (certInfo && Date.parse(certInfo.validTo) < Date.now()) {
    issues.push(`憑證已過期（有效至 ${certInfo.validTo}）`);
    certOk = false;
  }

  if (keyPath) {
    if (!fs.existsSync(keyPath)) issues.push(`找不到私鑰檔案：${keyPath}`);
    else if (!readPemProbe(keyPath).key) issues.push('私鑰檔內容沒有 BEGIN PRIVATE KEY（需 PKCS#8）');
    else keyOk = true;
  } else if (certOk && fileHasPrivateKey(certPath)) {
    keyOk = true; // 合併式 .pem
  } else {
    issues.push('未設定私鑰（.key）；若 .pem 已含 PRIVATE KEY，可把 .key 路徑指向同一個 .pem');
  }

  return {
    ok: certOk && keyOk,
    issues,
    certPath,
    keyPath: keyPath || (keyOk && certOk ? certPath : ''),
    combinedPem: !keyPath && keyOk,
    certExists: certOk,
    keyExists: keyOk,
    certInfo
  };
}

function createAgent(certPath, keyPath) {
  if (!certPath) {
    throw Object.assign(new Error('SIT / Production 需要 mTLS 客戶端憑證（.pem），請先在設定頁指定。'), { code: 'CERT_REQUIRED' });
  }
  if (!fs.existsSync(certPath)) throw Object.assign(new Error(`找不到憑證檔案：${certPath}`), { code: 'CERT_NOT_FOUND' });
  let resolvedKey = keyPath;
  if (!resolvedKey && fileHasPrivateKey(certPath)) resolvedKey = certPath;
  if (!resolvedKey) {
    throw Object.assign(new Error('SIT / Production 需要私鑰（.key）；若 .pem 是合併檔，請把 .key 路徑指向同一個 .pem。'), { code: 'KEY_REQUIRED' });
  }
  if (!fs.existsSync(resolvedKey)) throw Object.assign(new Error(`找不到私鑰檔案：${resolvedKey}`), { code: 'KEY_NOT_FOUND' });
  return new https.Agent({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(resolvedKey),
    minVersion: 'TLSv1.2',
    keepAlive: false
  });
}

function requestJson({ env, method = 'POST', path: urlPath = '/', headers = {}, body, rawBody, timeoutMs = 30000, certPath, keyPath }) {
  const baseUrl = BASE_URLS[env];
  if (!baseUrl) return Promise.reject(Object.assign(new Error(`環境 ${env} 不支援真實呼叫`), { code: 'ENV_INVALID' }));
  const agent = createAgent(certPath, keyPath);
  const url = new URL(urlPath.startsWith('http') ? urlPath : baseUrl + urlPath);
  let payload = null;
  if (rawBody !== undefined && rawBody !== null) payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  else if (body !== undefined && body !== null) payload = Buffer.from(JSON.stringify(body), 'utf8');

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      agent,
      headers: Object.assign({}, headers, payload ? { 'Content-Length': payload.length } : {})
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = text;
        const ct = String(res.headers['content-type'] || '');
        if (ct.indexOf('json') !== -1 || /^[\[{]/.test(text.trim())) {
          try { data = JSON.parse(text); } catch (err) { data = text; }
        }
        resolve({ status: res.statusCode, headers: res.headers, data, text, durationMs: Date.now() - started });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error(`請求逾時（${timeoutMs} ms）`), { code: 'TIMEOUT' }));
    });
    req.on('error', (err) => {
      const wrapped = Object.assign(new Error(err.message || 'HTTPS 請求失敗'), { code: err.code || 'REQUEST_FAILED', cause: err });
      reject(wrapped);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------- #001 取得 Token（含快取與自動續期） ----------
async function getToken(options) {
  const opts = options || {};
  const env = opts.env || 'mock';
  const role = String(opts.role || 'RA').toUpperCase();
  if (env === 'mock') {
    return { access_token: mockAccessToken(role), token_type: 'Bearer', expires_in: 300, expiresAt: Date.now() + 300000, cached: false, mock: true };
  }
  const cacheKey = `${env}|${role}|${opts.clientId || ''}`;
  const cached = tokenCache.get(cacheKey);
  if (!opts.force && cached && cached.expiresAt > Date.now()) {
    return Object.assign({}, cached, { cached: true });
  }
  if (!opts.clientId || !opts.clientSecret) {
    throw Object.assign(new Error('尚未設定 Client ID / Client Secret'), { code: 'CREDENTIAL_MISSING' });
  }
  if (!opts.apiKey) throw Object.assign(new Error('尚未設定 x-api-key'), { code: 'API_KEY_MISSING' });

  await rateLimiter.acquire();
  const { path: tokenPath } = buildPath('#001', {}, role.toLowerCase());
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  form.set('client_id', opts.clientId);
  form.set('client_secret', opts.clientSecret);
  if (opts.raCode && role !== 'RA') form.set('ra_code', opts.raCode);

  const res = await requestJson({
    env, method: 'POST', path: tokenPath,
    headers: { 'x-api-key': opts.apiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    rawBody: form.toString(),
    timeoutMs: Number(opts.timeoutMs) || 30000,
    certPath: opts.certPath, keyPath: opts.keyPath
  });

  if (res.status >= 400) {
    throw Object.assign(new Error(`#001 取得 Token 失敗（HTTP ${res.status}）`), { code: 'TOKEN_FAILED', status: res.status, response: res.data });
  }
  const data = res.data && typeof res.data === 'object' ? res.data : {};
  const token = data.access_token || data.accessToken;
  if (!token) throw Object.assign(new Error('#001 回應沒有 access_token'), { code: 'TOKEN_INVALID', response: res.data });
  const expiresIn = Number(data.expires_in) || 300;
  const entry = {
    access_token: token,
    token_type: data.token_type || 'Bearer',
    expires_in: expiresIn,
    expiresAt: Date.now() + Math.max(30000, Math.min(TOKEN_TTL_MS, expiresIn * 1000 - 30000)),
    role,
    env,
    cached: false
  };
  tokenCache.set(cacheKey, entry);
  return entry;
}

module.exports = {
  API_DEFS,
  BASE_URLS,
  buildPath,
  TOKEN_TTL_MS,
  tokenCache,
  tokenCacheInfo,
  clearTokenCache,
  mockAccessToken,
  rateLimiter,
  createAgent,
  fileHasPrivateKey,
  mtlsStatus,
  requestJson,
  getToken
};
