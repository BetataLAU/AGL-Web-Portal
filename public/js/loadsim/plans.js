// ===== 模擬裝板：存檔 / 載入（本機 localStorage ＋ 雲端 API ＋ 匯出／匯入 JSON）=====
// 三種存放位置，格式完全一樣（都是 state.js 的 loadsimSnapshot()）：
//   1) 本機存檔：localStorage['loadsim-plans-v1']，可命名多份（上限 LOADSIM_PLAN_LIMIT），免登入。
//   2) 雲端存檔：/api/loadsim/plans（admin / staff），跨電腦／同事共用。
//   3) JSON 檔：匯出可備份／傳給同事，匯入即還原。
// 這個模組只做「資料」，DOM / modal 在 public/js/loadsim.js。
import { loadsimGetSpec } from './uld-specs.js';
import { loadsimSummarize } from './weight.js';

export const LOADSIM_PLANS_KEY = 'loadsim-plans-v1';
export const LOADSIM_PLAN_APP = 'agl-loadsim';
export const LOADSIM_PLAN_LIMIT = 30;
export const LOADSIM_PLAN_NAME_MAX = 60;
export const LOADSIM_CLOUD_ROLES = ['admin', 'staff'];

const CLOUD_BASE = '/api/loadsim/plans';

// ===== 共用小工具 =====
function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
}

// 名稱：收斂空白、去頭尾、最長 60 字（與後端 routes/loadsim.js 的 sanitizeName 一致）
export function loadsimNormalizePlanName(value) {
  const name = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return name.slice(0, LOADSIM_PLAN_NAME_MAX);
}

// 預設名稱：「Q7-00 2026-11-07 15:30」
export function loadsimPlanDefaultName(snapshot) {
  const safe = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const code = String(safe.uldCode || 'ULD');
  const savedAt = safe.savedAt && !Number.isNaN(Date.parse(safe.savedAt)) ? new Date(safe.savedAt) : new Date();
  return loadsimNormalizePlanName(`${code} ${loadsimFormatPlanTime(savedAt.toISOString())}`);
}

// ISO 時間 → 「YYYY-MM-DD HH:mm」（使用者當地時間；避免顯示 UTC 差 8 小時）
export function loadsimFormatPlanTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso).slice(0, 16);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ===== 彙總（清單顯示用；與畫布摘要同一套公式）=====
export function loadsimPlanSummary(snapshot) {
  const safe = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const items = Array.isArray(safe.items) ? safe.items : [];
  const stateLike = {
    items,
    itemMaxEnabled: safe.itemMaxEnabled !== false,
    itemMaxKg: Number(safe.itemMaxKg) || 0
  };
  let spec = null;
  try {
    spec = loadsimGetSpec(safe.uldCode, safe.specOverrides || {}, { plateType: safe.plateType });
  } catch (e) {
    spec = null; // 板型代碼不存在（舊檔／手改 JSON）→ 還是能算件數與重量
  }
  const summary = loadsimSummarize(stateLike, spec);
  return {
    uldCode: String(safe.uldCode || ''),
    plateType: safe.plateType === 'thick' ? 'thick' : 'thin',
    itemCount: items.length,
    boardCount: summary.count,
    stagedCount: summary.stagedCount,
    pendingCount: summary.pendingCount,
    totalKg: round1(summary.cargoKg),
    grossKg: round1(summary.totalKg),
    utilizationPct: round1(summary.utilPct)
  };
}

// 清單列的一行說明：Q7-00 · 13 件 · 1950.0 kg · 利用率 59% · 2026-11-07 15:30
export function loadsimPlanMetaText(plan) {
  if (!plan) return '';
  const code = plan.uldCode || plan.uld_code || '';
  const boardCount = Number(plan.boardCount != null ? plan.boardCount : plan.board_count) || 0;
  const totalKg = Number(plan.totalKg != null ? plan.totalKg : plan.total_kg) || 0;
  const util = Number(plan.utilizationPct != null ? plan.utilizationPct : plan.utilization_pct) || 0;
  const savedAt = plan.savedAt || plan.saved_at || '';
  return [
    code || '未指定板型',
    `${boardCount} 件`,
    `${totalKg.toFixed(1)} kg`,
    `利用率 ${Math.round(util)}%`,
    loadsimFormatPlanTime(savedAt)
  ].filter(Boolean).join(' · ');
}

// ===== 本機存檔（localStorage）=====
function readLocalPlans() {
  let raw = null;
  try { raw = localStorage.getItem(LOADSIM_PLANS_KEY); } catch (e) { return []; }
  if (!raw) return [];
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { return []; }
  const rows = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.plans) ? parsed.plans : []);
  const used = new Set();
  let nextId = 1;
  return rows.reduce((list, row) => {
    if (!row || typeof row !== 'object' || !row.snapshot || typeof row.snapshot !== 'object') return list;
    let id = Number(row.id) || 0;
    if (id <= 0 || used.has(id)) {
      while (used.has(nextId)) nextId += 1;
      id = nextId;
    }
    used.add(id);
    const name = loadsimNormalizePlanName(row.name) || loadsimPlanDefaultName(row.snapshot);
    const summary = row.summary && typeof row.summary === 'object'
      ? row.summary
      : loadsimPlanSummary(row.snapshot);
    list.push({
      id,
      name,
      savedAt: row.savedAt || row.snapshot.savedAt || '',
      summary,
      snapshot: row.snapshot
    });
    return list;
  }, []);
}

function writeLocalPlans(plans) {
  try {
    localStorage.setItem(LOADSIM_PLANS_KEY, JSON.stringify(plans || []));
    return true;
  } catch (err) {
    console.warn('[loadsim] 無法寫入本機存檔:', err);
    return false;
  }
}

function sortPlansNewestFirst(plans) {
  return plans.slice().sort((a, b) => {
    const ta = Date.parse(a.savedAt || '') || 0;
    const tb = Date.parse(b.savedAt || '') || 0;
    if (tb !== ta) return tb - ta;
    return Number(b.id) - Number(a.id);
  });
}

// 本機存檔清單（新→舊）
export function loadsimLocalPlans() {
  return sortPlansNewestFirst(readLocalPlans());
}

// 存一份到本機：同名會覆蓋（保留原 id），否則新增；超過上限丟掉最舊的
// 回傳存下來的紀錄（失敗回 null，例如瀏覽器空間已滿）
export function loadsimLocalSavePlan(name, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const planName = loadsimNormalizePlanName(name) || loadsimPlanDefaultName(snapshot);
  const plans = readLocalPlans();
  const savedAt = snapshot.savedAt || new Date().toISOString();
  const summary = loadsimPlanSummary(snapshot);
  const payload = clone(snapshot);
  if (!payload) return null;

  const existing = plans.find(plan => plan.name === planName);
  let record;
  if (existing) {
    existing.snapshot = payload;
    existing.savedAt = savedAt;
    existing.summary = summary;
    record = existing;
  } else {
    const nextId = plans.reduce((max, plan) => Math.max(max, Number(plan.id) || 0), 0) + 1;
    record = { id: nextId, name: planName, savedAt, summary, snapshot: payload };
    plans.push(record);
  }

  const trimmed = sortPlansNewestFirst(plans).slice(0, LOADSIM_PLAN_LIMIT);
  if (!writeLocalPlans(trimmed)) return null;
  return clone(record);
}

export function loadsimLocalGetPlan(id) {
  const plan = readLocalPlans().find(row => Number(row.id) === Number(id));
  if (!plan) return null;
  const copy = clone(plan);
  return copy;
}

export function loadsimLocalRenamePlan(id, name) {
  const planName = loadsimNormalizePlanName(name);
  if (!planName) return false;
  const plans = readLocalPlans();
  const plan = plans.find(row => Number(row.id) === Number(id));
  if (!plan) return false;
  plan.name = planName;
  return writeLocalPlans(plans);
}

export function loadsimLocalDeletePlan(id) {
  const plans = readLocalPlans();
  const next = plans.filter(row => Number(row.id) !== Number(id));
  if (next.length === plans.length) return false;
  return writeLocalPlans(next);
}

// ===== 雲端存檔（/api/loadsim/plans；admin / staff）=====
// apiFetch 來自 public/js/utils/api.js（傳統 script 的全域函式；401 會自動跳登入頁）
function cloudFetch() {
  if (typeof apiFetch === 'function') return apiFetch;
  throw new Error('API 尚未載入，請重新整理頁面');
}

// 目前登入者（未登入回 null；刻意不用 apiFetch，避免 401 直接跳登入頁）
export async function loadsimFetchSession() {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return (data && data.user) || null;
  } catch (err) {
    return null;
  }
}

export function loadsimCanUseCloud(user) {
  return !!user && LOADSIM_CLOUD_ROLES.includes(String(user.role || ''));
}

function mapCloudRow(row) {
  return {
    id: row.id,
    name: row.name,
    uldCode: row.uld_code || '',
    plateType: row.plate_type === 'thick' ? 'thick' : 'thin',
    itemCount: Number(row.item_count) || 0,
    boardCount: Number(row.board_count) || 0,
    totalKg: Number(row.total_kg) || 0,
    grossKg: Number(row.gross_kg) || 0,
    utilizationPct: Number(row.utilization_pct) || 0,
    savedAt: row.saved_at || row.updated_at || row.created_at || '',
    createdBy: row.created_by || '',
    updatedBy: row.updated_by || ''
  };
}

// 清單（不含 snapshot）
export async function loadsimCloudList() {
  const data = await cloudFetch()(CLOUD_BASE);
  const rows = data && Array.isArray(data.data) ? data.data : [];
  return rows.map(mapCloudRow);
}

// 單筆（含 snapshot）
export async function loadsimCloudGet(id) {
  const data = await cloudFetch()(`${CLOUD_BASE}/${Number(id)}`);
  const row = data && data.data;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    savedAt: row.saved_at || '',
    snapshot: row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : null
  };
}

// 新增（沒有 id）或覆蓋（有 id）
export async function loadsimCloudSave({ id, name, snapshot, summary }) {
  const body = {
    name: loadsimNormalizePlanName(name),
    snapshot,
    summary: summary || loadsimPlanSummary(snapshot)
  };
  const call = cloudFetch();
  if (id) {
    const data = await call(`${CLOUD_BASE}/${Number(id)}`, { method: 'PUT', body: JSON.stringify(body) });
    return data && data.data ? mapCloudRow(data.data) : null;
  }
  const data = await call(CLOUD_BASE, { method: 'POST', body: JSON.stringify(body) });
  return data && data.data ? mapCloudRow(data.data) : null;
}

// 只改名（不重傳 snapshot）
export async function loadsimCloudRename(id, name) {
  const body = { name: loadsimNormalizePlanName(name) };
  const data = await cloudFetch()(`${CLOUD_BASE}/${Number(id)}`, { method: 'PUT', body: JSON.stringify(body) });
  return data && data.data ? mapCloudRow(data.data) : null;
}

export async function loadsimCloudDelete(id) {
  await cloudFetch()(`${CLOUD_BASE}/${Number(id)}`, { method: 'DELETE' });
  return true;
}

// ===== 匯出 / 匯入 JSON 檔 =====
// 檔名：loadsim-Q7-00-202611071530.json（不會有空白或中文標點，方便到處傳）
export function loadsimBuildExportFile(name, snapshot) {
  const safe = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const planName = loadsimNormalizePlanName(name) || loadsimPlanDefaultName(safe);
  const code = String(safe.uldCode || 'ULD');
  const stamp = loadsimFormatPlanTime(safe.savedAt || new Date().toISOString())
    .replace(/[^0-9]/g, '').slice(0, 12);
  const raw = `loadsim-${code}-${stamp || 'save'}`.replace(/[^\w.-]+/g, '-');
  return {
    fileName: `${raw}.json`,
    payload: {
      app: LOADSIM_PLAN_APP,
      version: 1,
      name: planName,
      savedAt: safe.savedAt || new Date().toISOString(),
      summary: loadsimPlanSummary(safe),
      snapshot: safe
    }
  };
}

// 解析匯入內容：接受「匯出檔（含 snapshot）」或「直接是 snapshot（有 items 陣列）」兩種
export function loadsimParseImport(text) {
  let data = null;
  try {
    data = JSON.parse(String(text == null ? '' : text));
  } catch (err) {
    throw new Error('檔案不是有效的 JSON');
  }
  const snapshot = data && data.snapshot && typeof data.snapshot === 'object'
    ? data.snapshot
    : (data && Array.isArray(data.items) ? data : null);
  if (!snapshot || !Array.isArray(snapshot.items)) {
    throw new Error('檔案裡沒有貨物清單（確定是模擬裝板的存檔嗎？）');
  }
  const name = loadsimNormalizePlanName(data && data.name) || loadsimPlanDefaultName(snapshot);
  return { name, snapshot };
}


