// ===== HKIA CDP：本機設定 / 歷史紀錄 / Mock 狀態 / SSE 事件匯流排 =====
// 設計原則：
//   - 不新增資料表（測試工具，狀態可重建）→ 一律存在 data/hkia-cdp/*.json
//   - 憑證與金鑰只存路徑，檔案放 data/hkia-cdp/certs/（已列入 .gitignore）
//   - clientSecret / webhookPass 在 GET /config 一律遮罩，PUT 時空字串＝維持原值
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// HKIA_DATA_DIR：測試專用（完全隔離）；正式環境沿用 DATA_DIR（Railway Volume）或 data/
const DATA_DIR = process.env.HKIA_DATA_DIR
  ? path.resolve(process.env.HKIA_DATA_DIR)
  : (process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'hkia-cdp')
    : path.join(ROOT, 'data', 'hkia-cdp'));
const CERT_DIR = path.join(DATA_DIR, 'certs');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MOCK_STATE_FILE = path.join(DATA_DIR, 'mock-state.json');

const ENVIRONMENTS = {
  mock: { key: 'mock', label: 'Local Mock', baseUrl: '', note: '本機模擬器，免憑證、免 IP 白名單（可完整體驗 202 + Callback）' },
  sit: { key: 'sit', label: 'SIT', baseUrl: 'https://api-external.sit.hkiacargo.com', note: 'HKIA 官方測試環境（需 mTLS 憑證與 IP 白名單）' },
  prod: { key: 'prod', label: 'Production', baseUrl: 'https://api-external.hkiacargo.com', note: '正式環境，請務必確認後再送出' }
};

const DEFAULT_CONFIG = {
  env: 'mock',
  role: 'RA',
  clientId: '',
  clientSecret: '',
  apiKey: '',
  raCode: '',
  rfCode: '',
  racsfCode: '',
  certPath: '',
  keyPath: '',
  webhookUser: 'hkia',
  webhookPass: '',
  mockDelayMs: 2500,
  updatedAt: null
};

const STRING_FIELDS = ['clientId', 'apiKey', 'raCode', 'rfCode', 'racsfCode', 'certPath', 'keyPath', 'webhookUser'];
const MAX_HISTORY = 300;

function ensureDirs() {
  [DATA_DIR, CERT_DIR].forEach((dir) => {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { /* ignore */ }
  });
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDirs();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function trim(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max || 200);
}

function normalizeConfig(input, current) {
  const base = Object.assign({}, DEFAULT_CONFIG, current || {});
  const patch = input && typeof input === 'object' ? input : {};
  const next = Object.assign({}, base);

  if (patch.env !== undefined) next.env = ['mock', 'sit', 'prod'].includes(patch.env) ? patch.env : base.env;
  if (patch.role !== undefined) {
    const role = String(patch.role).toUpperCase();
    next.role = ['RA', 'RF', 'TP'].includes(role) ? role : base.role;
  }
  STRING_FIELDS.forEach((key) => {
    if (patch[key] !== undefined) next[key] = trim(patch[key], key === 'certPath' || key === 'keyPath' ? 500 : 200);
  });
  // 空字串＝維持原值（前端拿到的是遮罩值）；null＝清除
  if (patch.clientSecret !== undefined) {
    if (patch.clientSecret === null) next.clientSecret = '';
    else if (String(patch.clientSecret).trim() !== '' && String(patch.clientSecret).indexOf('••') === -1) next.clientSecret = String(patch.clientSecret).trim();
  }
  if (patch.webhookPass !== undefined) {
    if (patch.webhookPass === null) next.webhookPass = '';
    else if (String(patch.webhookPass).trim() !== '' && String(patch.webhookPass).indexOf('••') === -1) next.webhookPass = String(patch.webhookPass).trim();
  }
  if (patch.mockDelayMs !== undefined) {
    const n = Number(patch.mockDelayMs);
    next.mockDelayMs = Number.isFinite(n) ? Math.min(15000, Math.max(0, Math.round(n))) : base.mockDelayMs;
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

function getConfig() {
  ensureDirs();
  return Object.assign({}, DEFAULT_CONFIG, readJson(CONFIG_FILE, {}));
}

function saveConfig(patch) {
  const next = normalizeConfig(patch, getConfig());
  writeJson(CONFIG_FILE, next);
  return next;
}

// 給前端看的版本（機密欄位遮罩）
function publicConfig(config) {
  const cfg = config || getConfig();
  return {
    env: cfg.env,
    role: cfg.role,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret ? '••••••••' : '',
    hasClientSecret: !!cfg.clientSecret,
    apiKey: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}••••` : '',
    hasApiKey: !!cfg.apiKey,
    raCode: cfg.raCode,
    rfCode: cfg.rfCode,
    racsfCode: cfg.racsfCode,
    certPath: cfg.certPath,
    keyPath: cfg.keyPath,
    webhookUser: cfg.webhookUser,
    webhookPass: cfg.webhookPass ? '••••••' : '',
    hasWebhookPass: !!cfg.webhookPass,
    mockDelayMs: cfg.mockDelayMs,
    updatedAt: cfg.updatedAt
  };
}

// ---------- 歷史紀錄 ----------
function listHistory(limit, type) {
  const all = readJson(HISTORY_FILE, []);
  const filtered = type ? all.filter((item) => item.type === type) : all;
  const max = Math.min(500, Math.max(1, Number(limit) || 50));
  return filtered.slice(-max).reverse();
}

function appendHistory(entry) {
  ensureDirs();
  const all = readJson(HISTORY_FILE, []);
  all.push(entry);
  while (all.length > MAX_HISTORY) all.shift();
  writeJson(HISTORY_FILE, all);
  broadcast('history', entry);
  return entry;
}

function clearHistory() {
  writeJson(HISTORY_FILE, []);
  broadcast('history-cleared', { at: new Date().toISOString() });
}

// ---------- Mock 狀態 ----------
function getMockState() {
  const state = readJson(MOCK_STATE_FILE, {});
  return {
    exportOrders: state.exportOrders || {},
    preDeclarations: state.preDeclarations || {},
    images: state.images || {},
    mawbs: state.mawbs || {},
    counter: Number(state.counter) || 0
  };
}

function saveMockState(state) {
  writeJson(MOCK_STATE_FILE, state);
}

function resetMockState() {
  const empty = { exportOrders: {}, preDeclarations: {}, images: {}, mawbs: {}, counter: 0 };
  writeJson(MOCK_STATE_FILE, empty);
  return empty;
}

// 供查詢頁下拉選單：Mock 建立的單號
function listReferences() {
  const mock = getMockState();
  const exportOrders = Object.values(mock.exportOrders)
    .map((o) => ({ reference: o.export_order_reference_num, ctoCode: o.ctoCode, mawb: o.mawbNumber, createdAt: o.createdAt }))
    .filter((o) => o.reference)
    .reverse();
  const preDeclarations = Object.values(mock.preDeclarations)
    .map((p) => ({ reference: p.ra_reference_id, ctoReference: p.cto_predeclaration_num, ctoCode: p.ctoCode, mawb: p.mawbNumber, status: p.status, createdAt: p.createdAt }))
    .filter((p) => p.reference)
    .reverse();
  const mawbs = Object.keys(mock.mawbs).map((key) => ({ mawb: key }));
  return { exportOrders, preDeclarations, mawbs };
}

// ---------- 進行中的非同步請求（等待 Callback） ----------
const pendingRequests = new Map();

function addPending(item) {
  pendingRequests.set(item.requestId, item);
  if (pendingRequests.size > 200) {
    const oldest = pendingRequests.keys().next().value;
    pendingRequests.delete(oldest);
  }
  return item;
}

function getPending(requestId) {
  return pendingRequests.get(requestId) || null;
}

function listPending() {
  return Array.from(pendingRequests.values()).reverse();
}

function updatePending(requestId, patch) {
  const current = pendingRequests.get(requestId);
  if (!current) return null;
  const next = Object.assign({}, current, patch);
  pendingRequests.set(requestId, next);
  return next;
}

// ---------- SSE ----------
const sseClients = new Set();

function addSseClient(res) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data === undefined ? null : data)}\n\n`;
  sseClients.forEach((res) => {
    try { res.write(payload); } catch (err) { sseClients.delete(res); }
  });
}

function sseClientCount() {
  return sseClients.size;
}

module.exports = {
  ROOT,
  DATA_DIR,
  CERT_DIR,
  ENVIRONMENTS,
  DEFAULT_CONFIG,
  ensureDirs,
  getConfig,
  saveConfig,
  publicConfig,
  listHistory,
  appendHistory,
  clearHistory,
  getMockState,
  saveMockState,
  resetMockState,
  listReferences,
  addPending,
  getPending,
  listPending,
  updatePending,
  addSseClient,
  broadcast,
  sseClientCount
};
