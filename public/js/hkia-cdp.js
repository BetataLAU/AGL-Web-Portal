// ===== HKIA CDP Testing Site：前端入口（總覽 / 設定 / Callback 監控 + 分頁框架）=====
// 這支是 ESM 模組：public/index.html 以 <script type="module" src="./js/hkia-cdp.js"> 載入。
import { esc, badge, toast, copyText, resultHtml, jsonHtml } from './hkia-cdp/ui.js';
import { hkiaApi } from './hkia-cdp/api.js';
import { createFullState, createLiteState, renderFull, mountFull, renderLite, mountLite } from './hkia-cdp/flow.js';
import { createQueryState, renderQuery, mountQuery } from './hkia-cdp/query.js';
import { renderLearn, mountLearn } from './hkia-cdp/learn.js';

const TABS = [
  { key: 'dashboard', label: '總覽 / 連線', icon: 'fa-gauge-high' },
  { key: 'full', label: 'Full Flow', icon: 'fa-route' },
  { key: 'lite', label: 'Lite Flow', icon: 'fa-bolt' },
  { key: 'query', label: '查詢 / 追蹤', icon: 'fa-magnifying-glass' },
  { key: 'callback', label: 'Callback 監控', icon: 'fa-satellite-dish' },
  { key: 'settings', label: '設定', icon: 'fa-gear' },
  { key: 'learn', label: '教學', icon: 'fa-graduation-cap' }
];

const state = {
  tab: 'dashboard',
  config: null,
  meta: null,
  health: null,
  refs: { exportOrders: [], preDeclarations: [], mawbs: [] },
  history: [],
  callbacks: [],
  pending: [],
  auth: null,
  sse: 'idle',
  tokenTick: 0,
  full: createFullState(),
  lite: createLiteState(),
  query: createQueryState()
};

let rootEl = null;
let toastTimer = null;

function getRoot() {
  if (!rootEl) rootEl = document.getElementById('hkia-root');
  return rootEl;
}

const ctx = {
  state,
  get config() { return state.config; },
  proxy: async (options) => {
    const env = state.config ? state.config.env : 'mock';
    let confirmProd = false;
    if (env === 'prod') {
      if (!window.confirm('目前環境是 Production（正式 HKIA）。確定要送出這個請求嗎？')) {
        return { ok: false, status: 0, api: options.api, error: { message: '已取消（Production 需要二次確認）' } };
      }
      confirmProd = true;
    }
    try {
      return await hkiaApi.proxy(Object.assign({}, options, { confirmProd }));
    } catch (err) {
      return { ok: false, status: 0, api: options.api, error: { message: err.message } };
    }
  },
  toast,
  rerender: () => renderApp(),
  refreshRefs: async () => {
    try {
      state.refs = await hkiaApi.refs();
      if (state.tab === 'query') renderApp();
    } catch (err) { /* ignore */ }
  }
};

const envLabel = (key) => {
  const env = state.meta && state.meta.environments ? state.meta.environments[key] : null;
  return env ? env.label : (key || 'mock');
};

function connectSse() {
  if (state.es) return;
  if (typeof EventSource === 'undefined') { state.sse = 'unsupported'; return; }
  state.sse = 'connecting';
  const es = new EventSource(hkiaApi.eventsUrl);
  state.es = es;
  es.addEventListener('ready', () => { state.sse = 'open'; updateTopbar(); });
  es.addEventListener('callback', (event) => {
    try {
      const entry = JSON.parse(event.data);
      state.callbacks.unshift(entry);
      if (state.callbacks.length > 100) state.callbacks.pop();
      if (state.tab === 'callback' || state.tab === 'dashboard') renderApp();
      else toast(`收到 Callback：${entry.summary || entry.status || ''}`, !!(entry.response && String(entry.response.status || '').indexOf('REJECT') === -1));
    } catch (err) { /* ignore */ }
  });
  es.addEventListener('history', (event) => {
    try {
      const entry = JSON.parse(event.data);
      state.history.unshift(entry);
      if (state.history.length > 100) state.history.pop();
    } catch (err) { /* ignore */ }
  });
  es.addEventListener('token', () => { /* Token 狀態由 /health 與手動測試更新 */ });
  es.addEventListener('mock-reset', () => { toast('Mock 資料已重置'); ctx.refreshRefs(); });
  es.onerror = () => { state.sse = 'error'; updateTopbar(); };
  es.onopen = () => { state.sse = 'open'; updateTopbar(); };
}

function updateTopbar() {
  const chip = document.getElementById('hkia-sse-chip');
  if (!chip) return;
  const map = { open: ['SSE 已連線', 'ok'], connecting: ['SSE 連線中', 'warn'], error: ['SSE 離線（重新整理可重連）', 'error'], idle: ['SSE 未連線', 'idle'], unsupported: ['瀏覽器不支援 SSE', 'error'] };
  const [text, kind] = map[state.sse] || map.idle;
  chip.className = `hkia-badge hkia-badge--${kind}`;
  chip.textContent = text;
}

function renderTokenBox() {
  const box = document.querySelector('[data-token-box]');
  if (!box) return;
  if (!state.auth || !state.auth.expiresAt) { box.textContent = ''; box.className = 'hkia-token'; return; }
  const left = Math.max(0, Math.round((state.auth.expiresAt - Date.now()) / 1000));
  box.innerHTML = `<span class="hkia-mono">#001 Token</span> <strong>${left}s</strong>`;
  box.className = `hkia-token ${left <= 60 ? 'is-warn' : ''}`;
}

function renderApp() {
  const root = getRoot();
  if (!root) return;
  const cfg = state.config || {};
  const mtls = (state.meta && state.meta.mtls) || { ok: false, issues: [] };
  const mockEnv = (cfg.env || 'mock') === 'mock';
  const mtlsLabel = mockEnv ? 'Mock 免憑證' : (mtls.ok ? 'mTLS 就緒' : 'mTLS 未就緒');
  const mtlsKind = mockEnv ? 'info' : (mtls.ok ? 'ok' : 'warn');
  root.innerHTML = `<div class="hkia-shell">
    <div class="hkia-topbar">
      <div class="hkia-topbar-meta">
        <span class="hkia-env hkia-env--${esc(cfg.env || 'mock')}">${esc(envLabel(cfg.env || 'mock'))}</span>
        ${badge(`Role ${cfg.role || 'RA'}`, 'info')}
        ${badge(mtlsLabel, mtlsKind)}
        <span id="hkia-sse-chip" class="hkia-badge">SSE</span>
        <span class="hkia-token" data-token-box></span>
      </div>
      <div class="hkia-topbar-actions">
        <button type="button" class="pill" data-action="reload">↻ 重新整理</button>
        <button type="button" class="pill" data-action="auth-test">測試 #001</button>
      </div>
    </div>
    <nav class="hkia-tabs">
      ${TABS.map((t) => `<button type="button" class="${state.tab === t.key ? 'active' : ''}" data-tab="${t.key}"><i class="fa-solid ${t.icon}"></i> ${esc(t.label)}</button>`).join('')}
    </nav>
    <div class="hkia-panel" data-panel>${tabHtml()}</div>
  </div>`;
  updateTopbar();
  renderTokenBox();
  mountActiveTab();
}

function tabHtml() {
  if (state.tab === 'full') return renderFull(state.full);
  if (state.tab === 'lite') return renderLite(state.lite);
  if (state.tab === 'query') return renderQuery(state.query, state.refs);
  if (state.tab === 'callback') return callbacksHtml();
  if (state.tab === 'settings') return settingsHtml();
  if (state.tab === 'learn') return renderLearn();
  return dashboardHtml();
}

function mountActiveTab() {
  if (state.tab === 'full') { mountFull(getRoot(), ctx); return; }
  if (state.tab === 'lite') { mountLite(getRoot(), ctx); return; }
  if (state.tab === 'query') { mountQuery(getRoot(), ctx); return; }
  if (state.tab === 'learn') { mountLearn(getRoot()); return; }
  bindCommonPanel();
}

function dashboardHtml() {
  const cfg = state.config || {};
  const health = state.health || {};
  const mtls = (state.meta && state.meta.mtls) || { ok: false, issues: [] };
  const mtlsIssues = Array.isArray(mtls.issues) ? mtls.issues : [];
  const mockEnv = (cfg.env || 'mock') === 'mock';
  const apis = (state.meta && state.meta.apis) || [];
  const recent = (state.history || []).filter((item) => item.type !== 'callback').slice(0, 8);
  const callbackCount = (state.callbacks || []).length;
  return `<div class="hkia-dashboard">
    <div class="hkia-cards">
      <div class="hkia-card">
        <small>目前環境</small>
        <strong>${esc(envLabel(cfg.env))}</strong>
        <span class="hkia-muted">${esc((state.meta && state.meta.environments && state.meta.environments[cfg.env] && state.meta.environments[cfg.env].note) || '')}</span>
        <button type="button" class="hkia-mini" data-goto="settings">切換環境</button>
      </div>
      <div class="hkia-card">
        <small>mTLS / TLS 1.2</small>
        <strong>${mockEnv ? 'Local Mock 免憑證' : (mtls.ok ? '憑證就緒' : '憑證尚未就緒')}</strong>
        <span class="hkia-muted">${esc(mockEnv ? 'SIT / Production 才需要 .pem ＋ .key' : (mtls.ok ? (mtls.combinedPem ? '使用合併式 .pem（內含私鑰）' : (cfg.certPath || '')) : mtlsIssues.join('；')))}</span>
        <button type="button" class="hkia-mini" data-goto="settings">憑證設定</button>
      </div>
      <div class="hkia-card">
        <small>Access Token（#001）</small>
        <strong>${state.auth ? `有效 ${Math.max(0, Math.round((state.auth.expiresAt - Date.now()) / 1000))} 秒` : (health.tokenCached ? '快取中' : '尚未取得')}</strong>
        <span class="hkia-muted">${state.auth ? esc(String(state.auth.tokenPreview || '').slice(0, 24) + '…') : '有效期約 300 秒，平台自動續期'}</span>
        <button type="button" class="hkia-mini" data-action="auth-test">立即測試</button>
      </div>
      <div class="hkia-card">
        <small>Webhook / Callback</small>
        <strong>${callbackCount} 筆回調</strong>
        <span class="hkia-muted"><code>POST /api/hkia-cdp/webhook</code></span>
        <button type="button" class="hkia-mini" data-goto="callback">開啟監控台</button>
      </div>
    </div>

    <div class="hkia-actions">
      <button type="button" class="pill btn-primary" data-goto="full">▶ 開始 Full Flow</button>
      <button type="button" class="pill" data-goto="lite">▶ Lite Flow</button>
      <button type="button" class="pill" data-goto="query">查詢 / 追蹤</button>
      <button type="button" class="pill" data-goto="learn">教學</button>
      <button type="button" class="pill" data-action="reset-mock">重置 Mock 資料</button>
      <button type="button" class="pill" data-action="clear-history">清除歷史</button>
    </div>

    <div data-auth-result>${state.auth ? authResultHtml(state.auth) : ''}</div>

    <h4 class="hkia-h4">近期呼叫</h4>
    ${recent.length ? `<table class="hkia-table hkia-history">
      <thead><tr><th>時間</th><th>API</th><th>狀態</th><th>耗時</th><th>摘要</th></tr></thead>
      <tbody>${recent.map((item) => `<tr>
        <td class="hkia-mono">${esc(new Date(item.ts).toLocaleTimeString('zh-HK', { hour12: false }))}</td>
        <td>${esc(item.api || item.type || '')}</td>
        <td>${item.ok ? badge(`HTTP ${item.status}`, 'ok') : badge(item.status ? `HTTP ${item.status}` : '失敗', 'error')}</td>
        <td class="hkia-mono">${esc(item.durationMs === undefined ? '-' : `${item.durationMs} ms`)}</td>
        <td>${esc(item.summary || '')}</td>
      </tr>`).join('')}</tbody>
    </table>` : '<p class="hkia-muted">尚無紀錄。先到 Full Flow 送一個 #405 吧。</p>'}

    <h4 class="hkia-h4">API 覆蓋清單（${apis.length}）</h4>
    <div class="hkia-api-list">
      ${apis.map((api) => `<div class="hkia-api-chip ${api.async ? 'is-async' : ''}">
        <strong>${esc(api.api)}</strong>
        <span>${esc(api.name)}</span>
        <small>${esc(api.method)} · ${api.success}${api.async ? ' · Async' : ''}</small>
      </div>`).join('')}
    </div>
  </div>`;
}

function authResultHtml(auth) {
  const left = Math.max(0, Math.round((auth.expiresAt - Date.now()) / 1000));
  return `<div class="hkia-result is-ok">
    <div class="hkia-result-head">${badge('HTTP 200', 'ok')}<strong>#001 Authentication</strong>${badge(auth.mtls === 'mock' ? 'Local Mock' : 'mTLS / TLS 1.2', 'info')}</div>
    <dl class="hkia-kv">
      <dt>Access Token</dt><dd><code>${esc(auth.tokenPreview || '')}</code></dd>
      <dt>有效期</dt><dd>${left} 秒${auth.cached ? '（快取）' : ''}</dd>
      <dt>耗時</dt><dd>${esc(auth.durationMs === undefined ? '-' : `${auth.durationMs} ms`)}</dd>
    </dl>
  </div>`;
}

function callbackCard(item) {
  const resp = item.response || {};
  const errors = Array.isArray(resp.cto_errors) ? resp.cto_errors : [];
  const rejected = String(resp.status || '').indexOf('REJECT') !== -1;
  return `<article class="hkia-cb ${rejected ? 'is-error' : ''}">
    <header>
      ${badge(resp.status || 'RECEIVED', rejected ? 'error' : 'ok')}
      ${item.matched ? badge('已對應請求', 'info') : badge('未匹配', 'warn')}
      <span class="hkia-muted">${esc(new Date(item.ts).toLocaleString('zh-HK', { hour12: false }))}</span>
    </header>
    <dl class="hkia-kv">
      <dt>source_id</dt><dd><code>${esc(item.requestId || '')}</code></dd>
      <dt>API</dt><dd>${esc(item.api || '')}</dd>
      <dt>cto_predeclaration_num</dt><dd><code>${esc(resp.cto_predeclaration_num || '')}</code></dd>
    </dl>
    ${errors.length ? `<div class="hkia-lint is-error"><strong>CTO errors</strong><ul>${errors.map((e) => `<li><span class="hkia-lint-code">${esc(e.code || '')}</span> ${esc(e.message || '')}</li>`).join('')}</ul></div>` : ''}
    <details class="hkia-json"><summary>完整 JSON</summary><pre>${jsonHtml(resp)}</pre></details>
  </article>`;
}

function callbacksHtml() {
  const items = state.callbacks || [];
  let webhookUrl = '/api/hkia-cdp/webhook';
  try { webhookUrl = new URL('/api/hkia-cdp/webhook', window.location.href).href; } catch (err) { /* ignore */ }
  return `<div class="hkia-callbacks" data-scope="callback">
    <div class="hkia-flow-head">
      <div>
        <h3>Callback 監控台</h3>
        <p class="hkia-muted">HKIA / CTO 的非同步回調會即時出現在這裡；<code>source_id</code> 對應送出時的 <code>x-request-id</code>。</p>
      </div>
      <button type="button" class="pill" data-action="reload-callbacks">↻ 重新載入</button>
      <button type="button" class="pill" data-action="clear-history">清除歷史</button>
    </div>
    <div class="hkia-webhook-url">
      <span>回調 URL（提供給 AAHK）</span>
      <code data-webhook-url>${esc(webhookUrl)}</code>
      <button type="button" class="hkia-mini" data-copy-webhook>複製</button>
      ${state.config && state.config.hasWebhookPass ? badge('Basic Auth 已啟用', 'ok') : badge('未啟用 Basic Auth', 'warn')}
    </div>

    <div class="hkia-sim">
      <h4>模擬回調（測試 / 教學用）</h4>
      <div class="hkia-formgrid">
        <label class="hkia-field"><span>source_id（x-request-id）</span><input type="text" data-sim="source_id" placeholder="送出 #401 後取得"></label>
        <label class="hkia-field"><span>status</span><select data-sim="status">
          <option value="ACCEPTED_FROM_CTO">ACCEPTED_FROM_CTO</option>
          <option value="REJECTED_FROM_CTO">REJECTED_FROM_CTO</option>
          <option value="DELETED_FROM_CTO">DELETED_FROM_CTO</option>
        </select></label>
        <label class="hkia-field"><span>cto_predeclaration_num</span><input type="text" data-sim="cto_predeclaration_num" placeholder="CTOAAT000001"></label>
        <label class="hkia-field"><span>CTO 錯誤碼（選填）</span><input type="text" data-sim="error_code" placeholder="108717"></label>
      </div>
      <button type="button" class="pill" data-action="simulate-callback">送出模擬回調</button>
    </div>

    <h4 class="hkia-h4">收到的回調（${items.length}）</h4>
    ${items.length ? items.map(callbackCard).join('') : '<p class="hkia-muted">尚無回調。Local Mock 會在你送出 #401 / #403 / #404 / #415 後自動回調。</p>'}
  </div>`;
}

function settingsHtml() {
  const cfg = state.config || {};
  const meta = state.meta || {};
  const openssl = meta.openssl || {};
  const envs = meta.environments || {};
  let webhookUrl = '/api/hkia-cdp/webhook';
  try { webhookUrl = new URL('/api/hkia-cdp/webhook', window.location.href).href; } catch (err) { /* ignore */ }
  return `<div class="hkia-settings" data-scope="settings">
    <div class="hkia-flow-head">
      <div>
        <h3>環境與憑證設定</h3>
        <p class="hkia-muted">設定存在本機 <code>data/hkia-cdp/config.json</code>（clientSecret / webhookPass 回傳時一律遮罩）。</p>
      </div>
      <button type="button" class="pill btn-primary" data-action="save-settings">儲存設定</button>
      <button type="button" class="pill" data-action="auth-test">測試 #001</button>
    </div>

    <div class="hkia-formgrid">
      <label class="hkia-field"><span>環境 <em>${esc((envs[cfg.env] && envs[cfg.env].note) || '')}</em></span>
        <select data-setting="env">
          <option value="mock" ${cfg.env === 'mock' ? 'selected' : ''}>Local Mock（本機模擬）</option>
          <option value="sit" ${cfg.env === 'sit' ? 'selected' : ''}>SIT（api-external.sit）</option>
          <option value="prod" ${cfg.env === 'prod' ? 'selected' : ''}>Production（正式，送出需二次確認）</option>
        </select>
      </label>
      <label class="hkia-field"><span>角色 Role</span>
        <select data-setting="role">
          ${['RA', 'RF', 'TP'].map((r) => `<option value="${r}" ${cfg.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </label>
      <label class="hkia-field"><span>Client ID</span><input type="text" data-setting="clientId" value="${esc(cfg.clientId)}"></label>
      <label class="hkia-field"><span>Client Secret <em>${cfg.hasClientSecret ? '已設定（留空＝不變更）' : '尚未設定'}</em></span><input type="password" data-setting="clientSecret" value="" placeholder="${cfg.hasClientSecret ? '••••••••' : ''}"></label>
      <label class="hkia-field"><span>API Key（x-api-key）<em>${cfg.hasApiKey ? '已設定（留空＝不變更）' : ''}</em></span><input type="password" data-setting="apiKey" value="" placeholder="${esc(cfg.apiKey || '')}"></label>
      <label class="hkia-field"><span>RA Code</span><input type="text" data-setting="raCode" value="${esc(cfg.raCode)}"></label>
      <label class="hkia-field"><span>RF Code</span><input type="text" data-setting="rfCode" value="${esc(cfg.rfCode)}"></label>
      <label class="hkia-field"><span>RACSF Code</span><input type="text" data-setting="racsfCode" value="${esc(cfg.racsfCode)}"></label>
      <label class="hkia-field"><span>Mock Callback 延遲（ms）</span><input type="number" data-setting="mockDelayMs" value="${esc(cfg.mockDelayMs)}" min="0" max="15000"></label>
      <label class="hkia-field"><span>Webhook Basic Auth 使用者</span><input type="text" data-setting="webhookUser" value="${esc(cfg.webhookUser)}"></label>
      <label class="hkia-field"><span>Webhook Basic Auth 密碼 <em>${cfg.hasWebhookPass ? '已設定（留空＝不變更）' : ''}</em></span><input type="password" data-setting="webhookPass" value="" placeholder="${cfg.hasWebhookPass ? '••••••' : ''}"></label>
    </div>

    <p class="hkia-muted">※ UAT（<code>api-external.uat.hkiacargo.com</code>）不適用於 RAIS API，故不提供切換。</p>

    <h4 class="hkia-h4">mTLS 憑證（.pem / .key）</h4>
    <div class="hkia-formgrid">
      <label class="hkia-field is-wide"><span>Certificate 路徑（.pem）</span><input type="text" data-setting="certPath" value="${esc(cfg.certPath)}" placeholder="C:\\certs\\client.pem"></label>
      <label class="hkia-field"><span>上傳 .pem</span><input type="file" accept=".pem,.crt,.cer" data-upload="cert"></label>
      <label class="hkia-field is-wide"><span>Private Key 路徑（.key）</span><input type="text" data-setting="keyPath" value="${esc(cfg.keyPath)}" placeholder="C:\\certs\\client.key"></label>
      <label class="hkia-field"><span>上傳 .key</span><input type="file" accept=".key,.pem" data-upload="key"></label>
    </div>
    <div class="hkia-lint ${meta.mtls && meta.mtls.ok ? 'is-ok' : (cfg.env === 'mock' ? '' : 'is-warn')}">
      <strong>${cfg.env === 'mock' ? 'Local Mock 免憑證' : (meta.mtls && meta.mtls.ok ? '✓ mTLS 憑證就緒' : '⚠ mTLS 尚未就緒')}</strong>
      ${meta.mtls && Array.isArray(meta.mtls.issues) && meta.mtls.issues.length
        ? `<ul>${meta.mtls.issues.map((issue) => `<li class="hkia-lint-item"><span class="hkia-lint-msg">${esc(issue)}</span></li>`).join('')}</ul>`
        : ''}
      ${meta.mtls && meta.mtls.certInfo
        ? `<p class="hkia-mono hkia-certinfo">${esc(meta.mtls.certInfo.subject)}<br>有效至 ${esc(meta.mtls.certInfo.validTo)}（${esc(meta.mtls.certInfo.keyType || '')} ${esc(meta.mtls.certInfo.keyBits || '')}）</p>`
        : ''}
    </div>
    <p class="hkia-muted">憑證存放於 <code>data/hkia-cdp/certs/</code>（已列入 .gitignore）。私鑰必須是 PKCS#8（BEGIN PRIVATE KEY）。若 AAHK 只提供一個「憑證＋私鑰」合併的 <code>.pem</code>，可把 Private Key 路徑指向同一個 <code>.pem</code>。</p>

    <h4 class="hkia-h4">Webhook 回調位置</h4>
    <div class="hkia-webhook-url"><code>${esc(webhookUrl)}</code><button type="button" class="hkia-mini" data-copy-webhook>複製</button></div>

    <h4 class="hkia-h4">OpenSSL 憑證產生小幫手</h4>
    <div class="hkia-openssl">
      ${[['key', '1. 產生 RSA 2048 私鑰（PKCS#8）'], ['csr', '2. 產生 CSR'], ['pem', '3. 由 AAHK CA 簽發 .pem（範例）'], ['verify', '4. 檢查憑證']].map(([key, title]) => `
        <div class="hkia-openssl-row">
          <div><strong>${esc(title)}</strong><pre>${esc(openssl[key] || '')}</pre></div>
          <button type="button" class="hkia-mini" data-copy-text="${esc(openssl[key] || '')}">複製</button>
        </div>`).join('')}
      <p class="hkia-muted">${esc(openssl.note || '')}</p>
    </div>

    <div class="hkia-actions">
      <button type="button" class="pill" data-action="reset-mock">重置 Mock 資料</button>
      <button type="button" class="pill" data-action="clear-history">清除歷史</button>
    </div>
    <div data-auth-result>${state.auth ? authResultHtml(state.auth) : ''}</div>
  </div>`;
}

// ---------- 資料載入 ----------
async function loadMeta() {
  const data = await hkiaApi.config();
  state.meta = data;
  state.config = data.config;
}

async function loadHealth() {
  try { state.health = await hkiaApi.health(); } catch (err) { /* ignore */ }
}

async function loadHistory() {
  try {
    const data = await hkiaApi.history(50);
    state.history = data.items || [];
    state.callbacks = state.history.filter((item) => item.type === 'callback');
  } catch (err) { /* ignore */ }
}

async function loadRefs() {
  try { state.refs = await hkiaApi.refs(); } catch (err) { /* ignore */ }
}

async function reloadAll(silent) {
  const panel = document.querySelector('[data-panel]');
  if (panel && !state.config) panel.innerHTML = '<p class="hkia-muted">載入 HKIA CDP 設定中…</p>';
  await Promise.all([loadMeta(), loadHealth(), loadHistory(), loadRefs()]);
  renderApp();
  if (!silent) toast('已重新整理');
}

async function withButton(button, label, fn) {
  const old = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = label; }
  try { return await fn(); } finally {
    if (button) { button.disabled = false; button.textContent = old; }
  }
}

async function runAuthTest(button) {
  await withButton(button, '測試中…', async () => {
    try {
      const auth = await hkiaApi.authTest({});
      state.auth = { tokenPreview: auth.tokenPreview, expiresAt: auth.expiresAt, cached: auth.cached, mtls: auth.mtls, durationMs: auth.durationMs };
      toast(`#001 成功（${auth.env}${auth.cached ? ' / 快取' : ''}）`);
      const box = document.querySelector('[data-auth-result]');
      if (box) box.innerHTML = authResultHtml(state.auth);
      renderTokenBox();
      loadHealth();
    } catch (err) {
      toast(`#001 失敗：${err.message}`, false);
    }
  });
}

async function saveSettings(button) {
  await withButton(button, '儲存中…', async () => {
    const payload = {};
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const key = el.getAttribute('data-setting');
      let value = el.value;
      if (key === 'mockDelayMs') value = Number(value);
      if (['clientSecret', 'webhookPass', 'apiKey'].includes(key) && !String(value).trim()) return;
      payload[key] = value;
    });
    if (payload.env === 'prod' && state.config && state.config.env !== 'prod') {
      if (!window.confirm('切換到 Production（正式 HKIA）？之後每個請求都會再要求一次確認。')) return;
    }
    try {
      const res = await hkiaApi.saveConfig(payload);
      state.config = res.config;
      toast('設定已儲存');
      await Promise.all([loadMeta(), loadHealth()]);
      renderApp();
    } catch (err) {
      toast(`儲存失敗：${err.message}`, false);
    }
  });
}

async function uploadCert(kind, file) {
  if (!file) return;
  try {
    const res = await hkiaApi.uploadCert(kind, file);
    state.config = res.config;
    toast(`${kind === 'cert' ? '憑證' : '私鑰'}已上傳：${res.path}`);
    await loadMeta();
    renderApp();
  } catch (err) {
    toast(`上傳失敗：${err.message}`, false);
  }
}

async function simulateCallback(button) {
  await withButton(button, '送出中…', async () => {
    const sim = {};
    document.querySelectorAll('[data-sim]').forEach((el) => { sim[el.getAttribute('data-sim')] = el.value; });
    if (!String(sim.source_id || '').trim()) { toast('請填 source_id（x-request-id）', false); return; }
    const payload = {
      source_id: sim.source_id.trim(),
      status: sim.status || 'ACCEPTED_FROM_CTO',
      cto_predeclaration_num: String(sim.cto_predeclaration_num || '').trim()
    };
    if (String(sim.error_code || '').trim()) {
      const code = sim.error_code.trim();
      const dict = window.HkiaErrorCodes ? window.HkiaErrorCodes.lookup(code) : null;
      payload.cto_errors = [{ code, message: (dict && dict.message) || 'Simulated CTO error' }];
    }
    try {
      const res = await hkiaApi.simulateCallback(payload);
      toast(res.matched ? '模擬回調已送出（已對應原請求）' : '模擬回調已送出（未匹配任何請求）');
      await Promise.all([loadHistory(), loadHealth()]);
      renderApp();
    } catch (err) {
      toast(`模擬失敗：${err.message}`, false);
    }
  });
}

// ---------- 事件委派（root 只綁一次；分頁／通用動作） ----------
const COMMON_ACTIONS = ['reload', 'auth-test', 'save-settings', 'reset-mock', 'clear-history', 'reload-callbacks', 'simulate-callback'];

function bindRootEvents(root) {
  root.addEventListener('click', async (event) => {
    const tabBtn = event.target.closest('[data-tab]');
    if (tabBtn && root.contains(tabBtn)) {
      state.tab = tabBtn.getAttribute('data-tab');
      renderApp();
      return;
    }
    const goto = event.target.closest('[data-goto]');
    if (goto && root.contains(goto)) {
      state.tab = goto.getAttribute('data-goto');
      renderApp();
      return;
    }
    if (event.target.closest('[data-copy-webhook]')) {
      const el = document.querySelector('[data-webhook-url]');
      if (el) copyText(el.textContent.trim(), 'Webhook URL 已複製');
      return;
    }
    const copyBtn = event.target.closest('[data-copy-text]');
    if (copyBtn) { copyText(copyBtn.getAttribute('data-copy-text') || '', '已複製'); return; }

    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    if (COMMON_ACTIONS.indexOf(action) === -1) return;

    if (action === 'reload') { await reloadAll(); return; }
    if (action === 'auth-test') { await runAuthTest(button); return; }
    if (action === 'save-settings') { await saveSettings(button); return; }
    if (action === 'reset-mock') {
      if (!window.confirm('重置 Local Mock 的單號／影像資料？（歷史紀錄不受影響）')) return;
      try {
        await hkiaApi.resetMock();
        toast('Mock 資料已重置');
        await Promise.all([loadRefs(), loadHealth()]);
        renderApp();
      } catch (err) { toast(`重置失敗：${err.message}`, false); }
      return;
    }
    if (action === 'clear-history') {
      if (!window.confirm('清除所有 API 歷史與 Callback 紀錄？')) return;
      try {
        await hkiaApi.clearHistory();
        state.history = [];
        state.callbacks = [];
        toast('歷史已清除');
        renderApp();
      } catch (err) { toast(`清除失敗：${err.message}`, false); }
      return;
    }
    if (action === 'reload-callbacks') {
      await Promise.all([loadHistory(), loadHealth()]);
      renderApp();
      toast('已重新載入');
      return;
    }
    if (action === 'simulate-callback') { await simulateCallback(button); }
  });

  root.addEventListener('change', async (event) => {
    const upload = event.target.closest('[data-upload]');
    if (!upload) return;
    const file = upload.files && upload.files[0];
    await uploadCert(upload.getAttribute('data-upload'), file);
  });
}

// 共用動作由 root 委派處理（保留函式以維持 mountActiveTab 的結構）
function bindCommonPanel() { /* no-op：見 bindRootEvents() */ }

function setup() {
  const root = getRoot();
  if (!root) return;
  if (root.dataset.hkiaReady === '1') { reloadAll(true); return; }
  root.dataset.hkiaReady = '1';
  root.innerHTML = '<p class="hkia-muted">載入 HKIA CDP 設定中…</p>';
  bindRootEvents(root);
  connectSse();
  setInterval(renderTokenBox, 1000);
  reloadAll(true).catch((err) => {
    root.innerHTML = `<div class="hkia-lint is-error"><strong>載入失敗</strong><ul><li>${esc(err.message)}</li></ul></div>`;
  });
}

window.setupHkiaCdpSection = setup;
