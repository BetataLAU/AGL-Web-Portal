// ===== 執 PLAN：即時同步（SSE）＋ presence ＝ 輪詢降級 =====
// 伺服器：GET /api/loading-plan/events（SSE，支援 Last-Event-ID 補送）
//        GET /api/loading-plan/events.json（SSE 不通時輪詢）
//        POST /api/loading-plan/presence（心跳／正在編輯哪一格）
import { state } from './state.js';
import { setConnState, applyPresence, updateOnline } from './render.js';

let started = false;
let connId = null;
let source = null;
let heartbeatTimer = null;
let pollTimer = null;
let reloadTimer = null;
let lastEventId = 0;
let reloadFn = null;
let editingItemId = null;
let polling = false;

function makeConnId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `lp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function api(path, options) {
  return window.apiFetch(`/api/loading-plan${path}`, options);
}

// ---- presence ----
async function sendPresence() {
  if (!connId) return;
  try {
    await api('/presence', {
      method: 'POST',
      body: JSON.stringify({
        conn_id: connId,
        plan_id: state.activePlanId || null,
        editing_item_id: editingItemId
      })
    });
  } catch (err) { /* 離線時忽略，心跳會再試 */ }
}

export function setEditingItem(itemId) {
  const next = itemId ? Number(itemId) : null;
  if (next === editingItemId) return;
  editingItemId = next;
  sendPresence();
}

export function notifyPlanChange() {
  sendPresence();
}

// ---- 資料變更 → 重新載入（打字中會延後，避免打斷輸入）----
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    const active = document.activeElement;
    if (active && active.classList &&
        (active.classList.contains('lp-inline-input') || active.classList.contains('lp-crd-input'))) {
      scheduleReload();
      return;
    }
    if (reloadFn) Promise.resolve(reloadFn()).catch(() => {});
  }, 350);
}

function handleEvent(evt) {
  if (!evt || !evt.action) return;
  if (evt.action === 'presence.snapshot' || evt.action === 'presence.update') {
    state.presence = Array.isArray(evt.payload) ? evt.payload : [];
    applyPresence();
    updateOnline();
    return;
  }
  // 其他人的操作（自己送出的也會收到，重載一次即可，成本很低）
  scheduleReload();
}

// ---- SSE ----
function connect() {
  if (typeof window.EventSource !== 'function') { startPolling(); return; }
  try {
    source = new window.EventSource(`/api/loading-plan/events${lastEventId ? `?since=${lastEventId}` : ''}`);
  } catch (err) { startPolling(); return; }

  source.onopen = () => {
    setConnState('● 即時連線', 'ok');
    stopPolling();
  };
  source.onerror = () => {
    // EventSource 會自動重連；同時啟動輪詢保底（避免 proxy 卡住時完全看不到更新）
    setConnState('● 重連中…', 'error');
    startPolling();
  };
  source.onmessage = (e) => {
    let evt = null;
    try { evt = JSON.parse(e.data); } catch (err) { return; }
    const id = Number(e.lastEventId || (evt && evt.id) || 0);
    if (Number.isFinite(id) && id > lastEventId) lastEventId = id;
    handleEvent(evt);
  };
}

function startPolling() {
  if (polling) return;
  polling = true;
  pollTimer = setInterval(pollOnce, 5000);
  pollOnce();
}

function stopPolling() {
  if (!polling) return;
  polling = false;
  clearInterval(pollTimer);
  pollTimer = null;
}

async function pollOnce() {
  try {
    const qs = new URLSearchParams({ since: String(lastEventId) });
    if (state.activePlanId) qs.set('plan_id', String(state.activePlanId));
    const res = await api(`/events.json?${qs.toString()}`);
    (res.events || []).forEach((evt) => {
      if (evt.id && evt.id > lastEventId) lastEventId = evt.id;
      handleEvent(evt);
    });
    if (Array.isArray(res.presence)) {
      state.presence = res.presence;
      applyPresence();
      updateOnline();
    }
    setConnState('● 輪詢中', 'warn');
  } catch (err) {
    setConnState('● 未連線', 'error');
  }
}

function bindForeground() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    sendPresence();
    if (source && source.readyState === 2) connect();
    else if (polling) pollOnce();
  });
  window.addEventListener('beforeunload', () => {
    try {
      fetch(`/api/loading-plan/presence/${encodeURIComponent(connId)}`, { method: 'DELETE', keepalive: true });
    } catch (err) { /* ignore */ }
  });
}

// ---- 對外 ----
export function startRealtime(options = {}) {
  if (started) return;
  started = true;
  connId = makeConnId();
  reloadFn = options.reload || null;
  sendPresence();
  heartbeatTimer = setInterval(sendPresence, 15000);
  connect();
  bindForeground();
  return { connId };
}

export function stopRealtime() {
  started = false;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  stopPolling();
  clearTimeout(reloadTimer);
  if (source) { try { source.close(); } catch (err) { /* ignore */ } source = null; }
  if (connId) {
    try {
      fetch(`/api/loading-plan/presence/${encodeURIComponent(connId)}`, { method: 'DELETE', keepalive: true });
    } catch (err) { /* ignore */ }
  }
  connId = null;
  lastEventId = 0;
}
