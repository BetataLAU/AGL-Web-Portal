// ===== 模擬裝板：狀態管理（貨物清單 / 單位 / 板型 / localStorage 暫存 / 復原）=====
import { loadsimDimsOf, loadsimOrientCount } from './geometry.js';

export const LOADSIM_STORAGE_KEY = 'loadsim-state-v1';

// 貨物配色（循環分配；跟主題色系一致）
export const LOADSIM_COLORS = [
  '#2563eb', '#0ea5e9', '#16a34a', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'
];

function createDefaultState() {
  return {
    unit: 'cm',
    uldCode: 'Q7-00',
    items: [],
    selectedId: null,
    // 預設「允許超出輪廓」但會標紅並提示（需求：要看得到超出多少）；
    // 切到嚴格模式後，超出就放不進去。
    allowOverhang: true,
    requireSupport: true,
    // 上貨需壓在下方貨物上的最低面積比例（%）：預設 50%
    supportMinPct: 50,
    // 「上貨需壓在下方貨物 X% 面積」是否啟用（取消勾選＝只要有支撐即可，不看面積比例）
    supportAreaEnabled: true,
    itemMaxKg: 1000,
    // 「單件重量上限」是否啟用（取消勾選＝不檢查單件重量）
    itemMaxEnabled: true,
    specOverrides: {},
    seq: 1
  };
}

export const loadsimState = createDefaultState();

const listeners = new Set();
let history = [];
const HISTORY_LIMIT = 40;
let saveTimer = null;

export function loadsimOnChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadsimEmit() {
  listeners.forEach(fn => {
    try { fn(); } catch (err) { console.error('[loadsim] listener failed:', err); }
  });
}

// ===== 復原（Undo）=====
export function loadsimPushHistory() {
  history.push(JSON.stringify(loadsimState.items));
  if (history.length > HISTORY_LIMIT) history.shift();
}

export function loadsimCanUndo() {
  return history.length > 0;
}

export function loadsimUndo() {
  if (!history.length) return false;
  const snapshot = history.pop();
  try {
    loadsimState.items = JSON.parse(snapshot);
    loadsimState.selectedId = null;
    loadsimSave();
    loadsimEmit();
    return true;
  } catch (err) {
    console.error('[loadsim] undo failed:', err);
    return false;
  }
}

// ===== localStorage 存取 =====
export function loadsimSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const payload = {
        unit: loadsimState.unit,
        uldCode: loadsimState.uldCode,
        items: loadsimState.items,
        allowOverhang: loadsimState.allowOverhang,
        requireSupport: loadsimState.requireSupport,
        supportMinPct: loadsimState.supportMinPct,
        supportAreaEnabled: loadsimState.supportAreaEnabled,
        itemMaxKg: loadsimState.itemMaxKg,
        itemMaxEnabled: loadsimState.itemMaxEnabled,
        specOverrides: loadsimState.specOverrides,
        seq: loadsimState.seq
      };
      localStorage.setItem(LOADSIM_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('[loadsim] 無法暫存狀態:', err);
    }
  }, 500);
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const l = Number(raw.dims && raw.dims.l);
  const w = Number(raw.dims && raw.dims.w);
  const h = Number(raw.dims && raw.dims.h);
  if (!(l > 0 && w > 0 && h > 0)) return null;
  const count = loadsimOrientCount();
  const orient = ((Math.round(Number(raw.orient) || 0) % count) + count) % count;
  return {
    id: Number(raw.id) || 0,
    name: String(raw.name || 'Cargo'),
    // MAWB：同一張主提單可以有多種尺寸（明細列會把第一列當 parent、其餘當 child）
    mawb: normalizeMawb(raw.mawb),
    dims: { l, w, h },
    weight: Math.max(0, Number(raw.weight) || 0),
    color: typeof raw.color === 'string' && raw.color ? raw.color : LOADSIM_COLORS[0],
    orient,
    x: Number(raw.x) || 0,
    y: Math.max(0, Number(raw.y) || 0),
    z: Number(raw.z) || 0,
    placed: !!raw.placed,
    // 暫存＝已放到畫面上但不在板內（拖到板外的暫存區）
    staged: !!raw.placed && !!raw.staged
  };
}

// 讀取上次狀態（回傳是否有還原）
export function loadsimLoadStored() {
  let raw = null;
  try { raw = localStorage.getItem(LOADSIM_STORAGE_KEY); } catch (e) { raw = null; }
  if (!raw) return false;

  let data;
  try { data = JSON.parse(raw); } catch (e) { return false; }
  if (!data || typeof data !== 'object') return false;

  if (data.unit === 'in' || data.unit === 'cm') loadsimState.unit = data.unit;
  if (typeof data.uldCode === 'string' && data.uldCode) loadsimState.uldCode = data.uldCode;
  if (typeof data.allowOverhang === 'boolean') loadsimState.allowOverhang = data.allowOverhang;
  if (typeof data.requireSupport === 'boolean') loadsimState.requireSupport = data.requireSupport;
  if (isFinite(Number(data.supportMinPct)) && Number(data.supportMinPct) >= 0) {
    loadsimState.supportMinPct = Math.min(100, Math.round(Number(data.supportMinPct)));
  }
  if (typeof data.supportAreaEnabled === 'boolean') loadsimState.supportAreaEnabled = data.supportAreaEnabled;
  if (isFinite(Number(data.itemMaxKg)) && Number(data.itemMaxKg) > 0) loadsimState.itemMaxKg = Number(data.itemMaxKg);
  if (typeof data.itemMaxEnabled === 'boolean') loadsimState.itemMaxEnabled = data.itemMaxEnabled;
  if (data.specOverrides && typeof data.specOverrides === 'object') loadsimState.specOverrides = data.specOverrides;
  if (isFinite(Number(data.seq)) && Number(data.seq) > 0) loadsimState.seq = Math.floor(Number(data.seq));

  if (Array.isArray(data.items)) {
    loadsimState.items = data.items.map(sanitizeItem).filter(Boolean);
  }
  const maxId = loadsimState.items.reduce((max, it) => Math.max(max, Number(it.id) || 0), 0);
  loadsimState.seq = Math.max(loadsimState.seq, maxId + 1);
  return true;
}

// ===== 貨物操作 =====
export function loadsimNextColor() {
  return LOADSIM_COLORS[(loadsimState.seq - 1) % LOADSIM_COLORS.length];
}

// MAWB 正規化（空字串＝沒有 MAWB）：去頭尾空白、最多 20 字
export function normalizeMawb(value) {
  return String(value == null ? '' : value).trim().slice(0, 20);
}

function pushNewItem({ dims, weight, name, color, mawb }) {
  const id = loadsimState.seq++;
  const item = {
    id,
    name: (name && String(name).trim()) || `Ctn#${id}`,
    mawb: normalizeMawb(mawb),
    dims: { l: Number(dims.l), w: Number(dims.w), h: Number(dims.h) },
    weight: Math.max(0, Number(weight) || 0),
    color: color || loadsimNextColor(),
    orient: 0,
    x: 0, y: 0, z: 0,
    placed: false,
    staged: false
  };
  loadsimState.items.push(item);
  return item;
}

// 由輸入表產生貨物（qty 件），回傳新貨物陣列
export function loadsimCreateItems({ dims, weight, qty, name, color, mawb }) {
  const count = Math.max(1, Math.min(200, Math.floor(Number(qty) || 1)));
  const created = [];
  loadsimPushHistory();
  for (let i = 0; i < count; i++) {
    created.push(pushNewItem({ dims, weight, name, color, mawb }));
  }
  loadsimSave();
  loadsimEmit();
  return created;
}

// 一次建立多列尺寸（① 表單的「＋ 新增」）：共用名稱／MAWB，只寫一筆復原紀錄
// rows: [{ dims: {x,y,z in cm}, weight, qty }]
export function loadsimCreateItemsBatch(rows, options = {}) {
  const name = options.name;
  const color = options.color;
  const mawb = options.mawb;
  const created = [];
  loadsimPushHistory();
  (rows || []).forEach(row => {
    if (!row || !row.dims) return;
    const count = Math.max(1, Math.min(200, Math.floor(Number(row.qty) || 1)));
    for (let i = 0; i < count; i++) {
      created.push(pushNewItem({ dims: row.dims, weight: row.weight, name, color, mawb }));
    }
  });
  if (created.length) {
    loadsimSave();
    loadsimEmit();
  }
  return created;
}

// 修改既有貨物（明細列點選 → 表單編輯）：rows 依序對應 ids
// 多出來的列 → 新增貨物（同一 MAWB／名稱）；沒有對應列的舊貨物 → 刪除；只寫一筆復原紀錄
export function loadsimUpdateCargo({ ids, rows, name, mawb }) {
  const targets = (ids || [])
    .map(id => loadsimState.items.find(item => item.id === Number(id)))
    .filter(Boolean);
  if (!targets.length) return null;

  loadsimPushHistory();
  const normalizedMawb = normalizeMawb(mawb);
  const trimmedName = name && String(name).trim() ? String(name).trim() : '';
  const kept = new Set();
  const created = [];
  let updated = 0;

  (rows || []).forEach((row, index) => {
    if (!row || !row.dims) return;
    const item = targets[index];
    if (item) {
      kept.add(item.id);
      item.dims = { l: Number(row.dims.l), w: Number(row.dims.w), h: Number(row.dims.h) };
      item.weight = Math.max(0, Number(row.weight) || 0);
      item.mawb = normalizedMawb;
      if (trimmedName) item.name = trimmedName;
      updated += 1;
      return;
    }
    const count = Math.max(1, Math.min(200, Math.floor(Number(row.qty) || 1)));
    for (let i = 0; i < count; i++) {
      created.push(pushNewItem({ dims: row.dims, weight: row.weight, name: trimmedName, mawb: normalizedMawb }));
    }
  });

  const removedIds = targets.filter(item => !kept.has(item.id)).map(item => item.id);
  if (removedIds.length) {
    const remove = new Set(removedIds);
    loadsimState.items = loadsimState.items.filter(item => !remove.has(item.id));
    if (remove.has(loadsimState.selectedId)) loadsimState.selectedId = null;
  }

  loadsimSave();
  loadsimEmit();
  return { updated, created: created.length, removed: removedIds.length };
}

export function loadsimGetItem(id) {
  return loadsimState.items.find(item => item.id === Number(id)) || null;
}

export function loadsimPlaceItem(id, pos, staged = false) {
  const item = loadsimGetItem(id);
  if (!item) return null;
  loadsimPushHistory();
  item.placed = true;
  item.staged = !!staged;
  item.x = Number(pos.x) || 0;
  item.y = Math.max(0, Number(pos.y) || 0);
  item.z = Number(pos.z) || 0;
  loadsimState.selectedId = item.id;
  loadsimSave();
  loadsimEmit();
  return item;
}

// 移動已放置的貨物（拖曳結束時呼叫）
// staged = true 表示放到板外的「暫存區」（不算在板上）
export function loadsimMoveItem(id, pos, staged = false) {
  const item = loadsimGetItem(id);
  if (!item) return null;
  loadsimPushHistory();
  item.placed = true;
  item.staged = !!staged;
  item.x = Number(pos.x) || 0;
  item.y = Math.max(0, Number(pos.y) || 0);
  item.z = Number(pos.z) || 0;
  loadsimSave();
  loadsimEmit();
  return item;
}

// 從板上移回「待裝」清單
export function loadsimUnplaceItem(id) {
  const item = loadsimGetItem(id);
  if (!item) return;
  loadsimPushHistory();
  item.placed = false;
  item.staged = false;
  item.x = 0; item.y = 0; item.z = 0;
  if (loadsimState.selectedId === item.id) loadsimState.selectedId = null;
  loadsimSave();
  loadsimEmit();
}

export function loadsimDeleteItem(id) {
  const idx = loadsimState.items.findIndex(item => item.id === Number(id));
  if (idx === -1) return;
  loadsimPushHistory();
  loadsimState.items.splice(idx, 1);
  if (loadsimState.selectedId === Number(id)) loadsimState.selectedId = null;
  loadsimSave();
  loadsimEmit();
}

// 一次刪除多件（明細列「刪除整個 MAWB」）：只寫一筆復原紀錄，回傳刪除件數
export function loadsimDeleteItems(ids) {
  const targets = new Set((ids || []).map(id => Number(id)));
  if (!targets.size) return 0;
  const before = loadsimState.items.length;
  loadsimPushHistory();
  loadsimState.items = loadsimState.items.filter(item => !targets.has(item.id));
  const removed = before - loadsimState.items.length;
  if (!removed) return 0;
  if (targets.has(loadsimState.selectedId)) loadsimState.selectedId = null;
  loadsimSave();
  loadsimEmit();
  return removed;
}

export function loadsimRotateItem(id, step = 1) {
  const item = loadsimGetItem(id);
  if (!item) return 0;
  loadsimPushHistory();
  item.orient = (item.orient + step + loadsimOrientCount()) % loadsimOrientCount();
  loadsimSave();
  loadsimEmit();
  return item.orient;
}

export function loadsimSelect(id) {
  loadsimState.selectedId = id ? Number(id) : null;
  loadsimEmit();
}

export function loadsimClearAll() {
  loadsimPushHistory();
  loadsimState.items = [];
  loadsimState.selectedId = null;
  loadsimSave();
  loadsimEmit();
}

// 已裝 / 暫存 / 未裝分開（畫布只畫已放到板上的，含暫存區）
export function loadsimPlacedItems() {
  return loadsimState.items.filter(item => item.placed);
}

export function loadsimBoardItems() {
  return loadsimState.items.filter(item => item.placed && !item.staged);
}

export function loadsimStagedItems() {
  return loadsimState.items.filter(item => item.placed && item.staged);
}

export function loadsimPendingItems() {
  return loadsimState.items.filter(item => !item.placed);
}

// 貨物目前方向的尺寸（給清單/tooltip 顯示）
export function loadsimItemDims(item) {
  return loadsimDimsOf(item);
}

