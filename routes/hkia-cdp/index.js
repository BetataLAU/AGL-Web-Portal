// ===== HKIA Cargo Data Platform (CDP) API Testing Site：BFF Proxy =====
// 為什麼需要 BFF：瀏覽器不能做 mTLS、不能收 HKIA 的 server-to-server Callback。
// 本模組提供：
//   - #001 Token（快取 4.5 分鐘）與 mTLS HTTPS 轉發（TLS 1.2 / 30 秒）
//   - Local Mock（完整 202 → 延遲 Callback；#410/#411/#412 範例資料）
//   - #409 SHA-256 + RSA 自動簽章
//   - 歷史紀錄（JSON）、單號關聯、SSE 即時推播
// 路由掛載：server.js → app.use('/api/hkia-cdp', requireAuth, hkiaCdpRouter)
//           webhook（公開，選用 Basic Auth）→ app.use('/api/hkia-cdp/webhook', hkiaCdpWebhookRouter)
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const hk = require('./http-client');
const { handleMock } = require('./mock');
const signature = require('./signature');
const Validator = require('../../public/js/hkia-cdp/cto-validator');
const ErrorCodes = require('../../public/js/hkia-cdp/error-codes');

const router = express.Router();
const webhookRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const OPENSSL_HELP = {
  key: 'openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out client.key',
  csr: 'openssl req -new -key client.key -out client.csr -subj "/C=HK/O=Your Company/CN=your-company"',
  pem: 'openssl x509 -req -in client.csr -CA aahk-ca.pem -CAkey aahk-ca.key -CAcreateserial -out client.pem -days 365 -sha256',
  verify: 'openssl x509 -in client.pem -noout -subject -dates',
  note: '私鑰必須是 PKCS#8（BEGIN PRIVATE KEY）；CSR 與 .pem 由 AAHK 簽發，IP 需加入白名單。'
};

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fail(res, status, code, message, extra) {
  return res.status(status).json(Object.assign({ ok: false, code, error: message }, extra || {}));
}

// 本次呼叫的設定：body.overrides（前端「測試但不儲存」）優先，其餘用已存設定
function effectiveConfig(body) {
  const cfg = store.getConfig();
  const patch = body && typeof body.overrides === 'object' && body.overrides ? body.overrides : {};
  const merged = Object.assign({}, cfg);
  ['env', 'role', 'clientId', 'clientSecret', 'apiKey', 'raCode', 'rfCode', 'racsfCode', 'certPath', 'keyPath'].forEach((key) => {
    if (patch[key] === undefined || patch[key] === null) return;
    const value = String(patch[key]).trim();
    if (!value || value.indexOf('••') !== -1) return;
    merged[key] = value;
  });
  return merged;
}

function publicApis() {
  return Object.keys(hk.API_DEFS).map((api) => {
    const def = hk.API_DEFS[api];
    return {
      api, name: def.name, method: def.method, paths: def.paths,
      success: def.success, async: !!def.async, requestId: !!def.requestId,
      needToken: def.needToken !== false
    };
  });
}

// 歷史紀錄／回應避免存大體積 base64
function sanitizeForHistory(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeForHistory(item, depth + 1));
  const out = {};
  Object.keys(value).forEach((key) => {
    const val = value[key];
    if (typeof val === 'string' && val.length > 512 && ['imageBase64', 'encodedPdf', 'imageSignature'].includes(key)) {
      out[key] = `[${key} omitted: ${val.length} chars]`;
    } else if (typeof val === 'string' && val.length > 4000) {
      out[key] = `${val.slice(0, 4000)}…[truncated ${val.length - 4000} chars]`;
    } else {
      out[key] = sanitizeForHistory(val, depth + 1);
    }
  });
  return out;
}

function tokenPreview(token) {
  const value = String(token || '');
  return value.length > 28 ? `${value.slice(0, 24)}…${value.slice(-6)}` : value;
}

function record(entry) {
  return store.appendHistory(Object.assign({ id: crypto.randomUUID(), ts: new Date().toISOString() }, entry));
}

// ---------- 基本資訊 ----------
router.get('/config', (req, res) => {
  const cfg = store.getConfig();
  res.json({
    ok: true,
    config: store.publicConfig(cfg),
    mtls: hk.mtlsStatus(cfg),
    environments: store.ENVIRONMENTS,
    apis: publicApis(),
    openssl: OPENSSL_HELP,
    webhookPath: '/api/hkia-cdp/webhook',
    limits: Object.assign({ timeoutMs: 30000, tokenTtlSeconds: 300, ratePerSecond: 15 }, hk.rateLimiter.stats()),
    tokens: hk.tokenCacheInfo(false),
    sseClients: store.sseClientCount()
  });
});

router.put('/config', (req, res) => {
  const body = req.body || {};
  if (body.env !== undefined && !store.ENVIRONMENTS[body.env]) return fail(res, 400, 'ENV_INVALID', '環境只接受 mock / sit / prod');
  if (body.role !== undefined && !['RA', 'RF', 'TP'].includes(String(body.role).toUpperCase())) {
    return fail(res, 400, 'ROLE_INVALID', 'Role 只接受 RA / RF / TP');
  }
  const saved = store.saveConfig(body);
  hk.clearTokenCache();
  res.json({ ok: true, config: store.publicConfig(saved) });
});

// 憑證／私鑰上傳（存到 data/hkia-cdp/certs，只回傳路徑）
router.post('/certs', upload.single('file'), (req, res) => {
  const kind = String((req.body && req.body.kind) || '').toLowerCase();
  if (!['cert', 'key'].includes(kind)) return fail(res, 400, 'KIND_INVALID', 'kind 只接受 cert 或 key');
  if (!req.file || !req.file.buffer || !req.file.buffer.length) return fail(res, 400, 'FILE_MISSING', '請選擇要上傳的檔案');
  const original = path.basename(req.file.originalname || '');
  const ext = path.extname(original).toLowerCase();
  const allow = kind === 'key' ? ['.key', '.pem'] : ['.pem', '.crt', '.cer'];
  if (!allow.includes(ext)) return fail(res, 400, 'FILE_TYPE', `不支援的副檔名（允許 ${allow.join(' / ')}）`);
  // 內容檢查：避免把 CSR 當憑證、或把憑證當私鑰（實際最常見的錯誤）
  const pemText = req.file.buffer.toString('utf8');
  const hasCert = /-----BEGIN CERTIFICATE-----/.test(pemText);
  const hasKey = /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(pemText);
  const hasCsr = /-----BEGIN CERTIFICATE REQUEST-----/.test(pemText);
  if (kind === 'cert' && !hasCert) {
    return fail(res, 400, 'CERT_FILE_INVALID', hasCsr
      ? '這是 CSR（憑證簽署請求），不是憑證；請上傳 AAHK 簽發、含 BEGIN CERTIFICATE 的 .pem。'
      : '檔案沒有 BEGIN CERTIFICATE，不是 PEM 憑證。');
  }
  if (kind === 'key' && !hasKey) {
    return fail(res, 400, 'KEY_FILE_INVALID', hasCert
      ? '這是憑證，不是私鑰；請上傳申請 CSR 時產生的 .key（含 BEGIN PRIVATE KEY）。'
      : '檔案沒有 BEGIN PRIVATE KEY，不是 PKCS#8 私鑰。');
  }
  store.ensureDirs();
  const safeName = `${kind}-${Date.now()}-${original.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  const target = path.join(store.CERT_DIR, safeName);
  fs.writeFileSync(target, req.file.buffer);
  const patch = kind === 'cert' ? { certPath: target } : { keyPath: target };
  const saved = store.saveConfig(patch);
  hk.clearTokenCache();
  res.json({ ok: true, kind, path: target, config: store.publicConfig(saved) });
});

// ---------- #001 連線測試 ----------
router.post('/auth/test', wrap(async (req, res) => {
  const cfg = effectiveConfig(req.body);
  const started = Date.now();
  try {
    const token = await hk.getToken({
      env: cfg.env,
      role: cfg.role,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      apiKey: cfg.apiKey,
      raCode: cfg.raCode,
      certPath: cfg.certPath,
      keyPath: cfg.keyPath,
      force: !!(req.body && req.body.force)
    });
    const entry = record({
      type: 'auth', api: '#001', name: 'Authentication', env: cfg.env, mode: cfg.env === 'mock' ? 'mock' : 'mtls',
      method: 'POST', url: cfg.env === 'mock' ? '(local mock #001)' : `${hk.BASE_URLS[cfg.env]}/profile/public/external/v1/${String(cfg.role).toLowerCase()}/auth/token`,
      status: 200, ok: true, durationMs: Date.now() - started, ctoCode: '',
      summary: `#001 Token OK（${cfg.role} / ${cfg.env}）`,
      response: { access_token: tokenPreview(token.access_token), token_type: token.token_type, expires_in: token.expires_in, cached: !!token.cached }
    });
    store.broadcast('token', { env: cfg.env, role: cfg.role, expiresAt: token.expiresAt, cached: !!token.cached });
    res.json({
      ok: true,
      env: cfg.env,
      role: cfg.role,
      mtls: cfg.env === 'mock' ? 'mock' : 'tls1.2+client-cert',
      cached: !!token.cached,
      tokenPreview: tokenPreview(token.access_token),
      tokenType: token.token_type || 'Bearer',
      expiresIn: token.expires_in || 300,
      expiresAt: token.expiresAt || Date.now() + 300000,
      durationMs: entry.durationMs,
      warnings: cfg.env !== 'mock' && (!cfg.certPath || !cfg.keyPath) ? [] : undefined
    });
  } catch (err) {
    const info = ErrorCodes.lookup(err.code) || {};
    record({
      type: 'auth', api: '#001', name: 'Authentication', env: cfg.env, mode: 'mtls',
      method: 'POST', status: Number(err.status) || 0, ok: false, durationMs: Date.now() - started,
      summary: `#001 失敗：${err.message}`, error: { code: err.code || '', message: err.message, fix: info.fix || '' }
    });
    return fail(res, 400, err.code || 'AUTH_FAILED', err.message, { fix: info.fix || '', response: err.response });
  }
}));

// ---------- CTO 預檢（後端與前端共用同一支 validator） ----------
router.post('/lint', (req, res) => {
  const body = req.body || {};
  const result = Validator.validate(body.payload || body, {
    cto: body.cto || (body.payload && body.payload.ctoCode),
    cargoType: body.cargoType || (body.payload && body.payload.cargoType),
    api: body.api
  });
  res.json({ ok: true, lint: result });
});

// ---------- #409 簽章工具 ----------
router.post('/sign', wrap(async (req, res) => {
  const body = req.body || {};
  const cfg = store.getConfig();
  let privateKey = '';
  if (body.privateKeyPem && String(body.privateKeyPem).indexOf('-----BEGIN') !== -1) privateKey = String(body.privateKeyPem);
  else {
    const keyPath = cfg.keyPath || (hk.fileHasPrivateKey(cfg.certPath) ? cfg.certPath : '');
    privateKey = signature.loadPrivateKey(keyPath, fs);
  }
  try {
    const signed = signature.signImage(body.imageBase64, privateKey);
    res.json({
      ok: true,
      algorithm: signed.algorithm,
      hash: signed.hash,
      hashBase64: signed.hashBase64,
      signature: signed.signature,
      bytes: signed.bytes,
      keySource: body.privateKeyPem ? 'request' : cfg.keyPath
    });
  } catch (err) {
    return fail(res, 400, err.code || 'SIGN_FAILED', err.message);
  }
}));

// ---------- 健康狀態 / 歷史 / 單號 ----------
router.get('/health', (req, res) => {
  const cfg = store.getConfig();
  const mtls = hk.mtlsStatus(cfg);
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    env: cfg.env,
    role: cfg.role,
    mockMode: cfg.env === 'mock',
    mTlsRequired: cfg.env !== 'mock',
    mTlsConfigured: mtls.ok,
    mTlsIssues: mtls.issues,
    mTlsCombinedPem: mtls.combinedPem,
    tokenCached: hk.tokenCacheInfo(false).length,
    pendingAsync: store.listPending().length,
    sseClients: store.sseClientCount(),
    rateLimit: hk.rateLimiter.stats(),
    history: store.listHistory(1).length,
    webhookPath: '/api/hkia-cdp/webhook'
  });
});

router.get('/history', (req, res) => {
  res.json({ ok: true, items: store.listHistory(req.query.limit, req.query.type) });
});

router.delete('/history', (req, res) => {
  store.clearHistory();
  res.json({ ok: true });
});

router.get('/refs', (req, res) => {
  res.json(Object.assign({ ok: true }, store.listReferences()));
});

router.get('/pending', (req, res) => {
  res.json({ ok: true, items: store.listPending() });
});

router.post('/mock/reset', (req, res) => {
  const state = store.resetMockState();
  hk.clearTokenCache();
  store.broadcast('mock-reset', { at: new Date().toISOString() });
  res.json({ ok: true, state: { exportOrders: Object.keys(state.exportOrders).length, preDeclarations: Object.keys(state.preDeclarations).length } });
});

// ---------- SSE：Callback / 歷史即時推播 ----------
router.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  store.addSseClient(res);
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (err) { clearInterval(heartbeat); }
  }, 25000);
  if (heartbeat.unref) heartbeat.unref();
  req.on('close', () => clearInterval(heartbeat));
});

// ---------- Callback 處理（Mock 模擬與真實 Webhook 共用同一條路徑） ----------
function invokeCallback(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const sourceId = String(data.source_id || data.sourceId || '');
  const pending = sourceId ? store.getPending(sourceId) : null;
  const status = String(data.status || '');
  const ok = !/REJECT|FAIL|ERROR/i.test(status);
  const entry = record({
    type: 'callback', api: data.api || (pending && pending.api) || '', name: 'Async Callback',
    env: 'callback', mode: 'webhook', method: 'POST', url: '/api/hkia-cdp/webhook',
    status: 200, ok, durationMs: 0, requestId: sourceId, ctoCode: data.ctoCode || '',
    summary: `Callback ${status || '(no status)'}${sourceId ? ` ← ${sourceId}` : ''}`,
    matched: !!pending,
    response: sanitizeForHistory(data)
  });
  if (sourceId) store.updatePending(sourceId, { status: status || 'RECEIVED', callbackAt: entry.ts, matched: true });
  store.broadcast('callback', entry);
  return { entry, matched: !!pending, pending };
}

let ephemeralMockKey = null;
function getEphemeralMockKey() {
  if (!ephemeralMockKey) {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    ephemeralMockKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  }
  return ephemeralMockKey;
}

// ---------- 主要 Proxy（#401–#416） ----------
router.post('/proxy', wrap(async (req, res) => {
  const body = req.body || {};
  const api = String(body.api || '');
  if (!hk.API_DEFS[api]) return fail(res, 400, 'API_UNKNOWN', `不支援的 API：${api || '(空白)'}`);
  if (api === '#001') return fail(res, 400, 'API_USE_AUTH', '#001 請使用 POST /api/hkia-cdp/auth/test');

  const cfg = effectiveConfig(body);
  const env = String(body.env || cfg.env || 'mock');
  if (!store.ENVIRONMENTS[env]) return fail(res, 400, 'ENV_INVALID', '環境只接受 mock / sit / prod');
  if (env === 'prod' && body.confirmProd !== true) {
    return fail(res, 400, 'PROD_CONFIRM_REQUIRED', '切換到 Production 需要二次確認（confirmProd: true）');
  }

  const def = hk.API_DEFS[api];
  const params = Object.assign(
    {},
    body.params && typeof body.params === 'object' ? body.params : {},
    body.query && typeof body.query === 'object' ? body.query : {}
  );
  if (api === '#409' && !params.role) params.role = String(body.rolePath || cfg.role || 'ra').toLowerCase() === 'rf' ? 'rf' : 'ra';
  let built;
  try {
    built = hk.buildPath(api, params, params.role || cfg.role);
  } catch (err) {
    return fail(res, 400, err.code || 'PARAM_MISSING', err.message, { details: err.details });
  }

  const requestId = String(body.requestId || (def.async || def.requestId ? crypto.randomUUID() : '') || '');
  const payload = body.body && typeof body.body === 'object' ? JSON.parse(JSON.stringify(body.body)) : {};
  const started = Date.now();
  const lint = Validator.validate(payload, { cto: payload.ctoCode, cargoType: payload.cargoType, api });

  // #409：自動 SHA-256 + RSA 簽章（請求有帶 imageBase64 且尚未簽章）
  let signed = null;
  if (api === '#409' && payload.imageBase64 && !payload.imageSignature && body.autoSign !== false) {
    let privateKey = '';
    if (body.privateKeyPem && String(body.privateKeyPem).indexOf('-----BEGIN') !== -1) privateKey = String(body.privateKeyPem);
    else {
      try {
        const keyPath = cfg.keyPath || (hk.fileHasPrivateKey(cfg.certPath) ? cfg.certPath : '');
        privateKey = signature.loadPrivateKey(keyPath, fs);
      } catch (err) {
        if (env === 'mock') privateKey = getEphemeralMockKey();
      }
    }
    if (privateKey) {
      try {
        signed = signature.signImage(payload.imageBase64, privateKey);
        payload.imageHash = signed.hash;
        payload.imageSignature = signed.signature;
        payload.imageSignatureAlgorithm = signed.algorithm;
      } catch (err) {
        return fail(res, 400, err.code || 'SIGN_FAILED', `#409 自動簽章失敗：${err.message}`);
      }
    }
  }

  const urlForDisplay = env === 'mock' ? `mock://${api}${built.path}` : `${hk.BASE_URLS[env]}${built.path}`;
  let result;
  let callbackInfo = null;

  try {
    if (env === 'mock') {
      const mockRes = await handleMock({
        api,
        params: Object.assign({}, params, built.path.indexOf('?') !== -1 ? parseQuery(built.path) : {}),
        body: payload,
        scenario: body.scenario,
        requestId
      });
      result = { status: mockRes.status, data: mockRes.body, durationMs: Date.now() - started };
      if (mockRes.callback) {
        const delayMs = Math.max(0, Number(cfg.mockDelayMs) || 0);
        store.addPending({
          requestId, api, env, ctoCode: payload.ctoCode || '', status: 'PENDING',
          createdAt: new Date().toISOString(), sourceId: requestId,
          preview: { ra_reference_id: mockRes.body.ra_reference_id || '', cto_predeclaration_num: mockRes.callback.cto_predeclaration_num || '' }
        });
        const timer = setTimeout(() => { invokeCallback(mockRes.callback); }, delayMs);
        if (timer.unref) timer.unref();
        callbackInfo = { expected: true, delayMs, sourceId: requestId, url: '/api/hkia-cdp/webhook', preview: mockRes.callback };
      }
    } else {
      await hk.rateLimiter.acquire();
      const headers = { Accept: 'application/json' };
      if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
      if (requestId) headers['x-request-id'] = requestId;
      if (def.needToken !== false) {
        const token = await hk.getToken({
          env, role: cfg.role, clientId: cfg.clientId, clientSecret: cfg.clientSecret,
          apiKey: cfg.apiKey, raCode: cfg.raCode, certPath: cfg.certPath, keyPath: cfg.keyPath
        });
        headers.Authorization = `Bearer ${token.access_token}`;
      }
      const hasBody = ['POST', 'PUT', 'PATCH'].includes(def.method) || Object.keys(payload).length > 0;
      if (hasBody) headers['Content-Type'] = 'application/json';
      const real = await hk.requestJson({
        env, method: def.method, path: built.path, headers,
        body: hasBody ? payload : undefined,
        certPath: cfg.certPath, keyPath: cfg.keyPath
      });
      result = { status: real.status, data: real.data, headers: real.headers, durationMs: real.durationMs };
      if (def.async && real.status >= 200 && real.status < 300) {
        store.addPending({
          requestId, api, env, ctoCode: payload.ctoCode || '', status: 'PENDING',
          createdAt: new Date().toISOString(), sourceId: requestId, preview: sanitizeForHistory(result.data)
        });
        callbackInfo = { expected: true, delayMs: null, sourceId: requestId, url: '/api/hkia-cdp/webhook' };
      }
    }
  } catch (err) {
    const info = ErrorCodes.lookup(err.code) || {};
    const entry = record({
      type: 'api', api, name: def.name, env, mode: env, method: def.method, url: urlForDisplay,
      status: Number(err.status) || 0, ok: false, durationMs: Date.now() - started, requestId,
      ctoCode: payload.ctoCode || '', summary: `${api} ${def.name} 失敗：${err.message}`,
      request: sanitizeForHistory({ params, body: payload }),
      error: { code: err.code || '', message: err.message, fix: info.fix || '', response: sanitizeForHistory(err.response) }
    });
    return res.json({
      ok: false, api, name: def.name, env, method: def.method, url: urlForDisplay,
      status: 0, durationMs: entry.durationMs, requestId,
      request: entry.request, response: null, lint,
      error: entry.error
    });
  }

  const ok = result.status >= 200 && result.status < 300;
  const extracted = ErrorCodes.extract(result.data, { ok });
  const httpInfo = ok ? null : ErrorCodes.explainHttp(result.status);
  const entry = record({
    type: 'api', api, name: def.name, env, mode: env, method: def.method, url: urlForDisplay,
    status: result.status, ok, durationMs: result.durationMs, requestId,
    ctoCode: payload.ctoCode || '',
    summary: `${api} ${def.name} → HTTP ${result.status}`,
    request: sanitizeForHistory({ params, body: payload }),
    response: sanitizeForHistory(result.data),
    lint: { ok: lint.ok, errors: lint.errors.length, warnings: lint.warnings.length },
    callbackExpected: !!(def.async && ok)
  });

  res.json({
    ok,
    api, name: def.name, env, mode: env, method: def.method, url: urlForDisplay,
    status: result.status, durationMs: result.durationMs, requestId,
    request: entry.request,
    response: result.data,
    lint,
    signature: signed ? { algorithm: signed.algorithm, hash: signed.hash, bytes: signed.bytes } : null,
    callback: callbackInfo,
    errors: extracted.concat(httpInfo ? [httpInfo] : [])
  });
}));

function parseQuery(pathWithQuery) {
  const idx = pathWithQuery.indexOf('?');
  if (idx === -1) return {};
  const out = {};
  new URLSearchParams(pathWithQuery.slice(idx + 1)).forEach((value, key) => { out[key] = value; });
  return out;
}

// 手動模擬 Callback（前端 Callback 監控台「模擬回調」用；已在本 router 的 requireAuth 之後）
router.post('/simulate-callback', (req, res) => {
  const payload = req.body || {};
  const sourceId = payload.source_id || payload.sourceId || '';
  if (!sourceId) return fail(res, 400, 'SOURCE_ID_REQUIRED', '模擬 Callback 需要 source_id（即原本的 x-request-id）');
  const result = invokeCallback(payload);
  res.json({ ok: true, matched: result.matched, entry: result.entry });
});

// ---------- Webhook（公開；HKIA → 本平台；支援可選 Basic Auth） ----------
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a === undefined ? '' : a), 'utf8');
  const bufB = Buffer.from(String(b === undefined ? '' : b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function basicAuthorized(req, cfg) {
  if (!cfg.webhookPass) return true; // 未設密碼＝不驗證（本機測試）
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let raw = '';
  try { raw = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch (err) { return false; }
  const idx = raw.indexOf(':');
  const user = idx === -1 ? raw : raw.slice(0, idx);
  const pass = idx === -1 ? '' : raw.slice(idx + 1);
  return safeEqual(user, cfg.webhookUser || 'hkia') && safeEqual(pass, cfg.webhookPass);
}

webhookRouter.get('/', (req, res) => {
  const cfg = store.getConfig();
  const host = req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  res.json({
    ok: true,
    endpoint: `${proto}://${host}/api/hkia-cdp/webhook`,
    method: 'POST',
    basicAuthRequired: !!cfg.webhookPass,
    expectedBody: { source_id: '<x-request-id>', status: 'ACCEPTED_FROM_CTO | REJECTED_FROM_CTO', cto_predeclaration_num: 'CTO...', cto_errors: [] },
    note: '把此 URL 提供給 AAHK 設定為非同步回調位置；本機測試可用 Local Mock 自動回調或前端「模擬回調」。'
  });
});

webhookRouter.post('/', (req, res) => {
  const cfg = store.getConfig();
  if (!basicAuthorized(req, cfg)) {
    res.set('WWW-Authenticate', 'Basic realm="hkia-cdp-webhook"');
    return res.status(401).json({ ok: false, error: 'Webhook Basic Auth 驗證失敗' });
  }
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  if (!payload.source_id && !payload.sourceId) {
    return res.status(400).json({ ok: false, error: '缺少 source_id（即送出非同步請求時的 x-request-id）' });
  }
  const result = invokeCallback(payload);
  res.json({ ok: true, received: true, matched: result.matched, at: result.entry.ts });
});

// ---------- 錯誤處理（保持 JSON，前端才拿得到訊息） ----------
router.use((err, req, res, next) => {
  console.error('[hkia-cdp]', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  return fail(res, 500, err.code || 'INTERNAL_ERROR', err.message || 'HKIA CDP 內部錯誤');
});

module.exports = { router, webhookRouter, invokeCallback };
