// ===== 執 PLAN：前端狀態（單一 store；所有畫面都從這裡畫）=====
import { lpPlanLabel } from './calc.js';

export const state = {
  plans: [],
  stock: null,
  stockItems: [],
  details: new Map(),        // planId -> items[]
  activePlanId: null,
  expanded: new Set(),       // 展開明細的 planId
  selectedItems: new Set(),  // 右欄已選（跨 plan）
  selectedStock: new Set(),  // 左欄已選
  searchStock: '',
  searchPlan: '',
  volumeUnit: 'cbm',         // 輸入單位偏好：cbm | cuft | vol
  clipboard: null,           // { mode: 'cut'|'copy', items: [{ id, planId }] }
  undoStack: [],
  presence: [],              // 線上使用者（{ conn_id, plan_id, display, editing_item_id }）
  connState: 'idle',         // idle | ok | poll | error
  loading: false,
  error: ''
};

export function planById(id) {
  const key = Number(id);
  return state.plans.find(p => p.id === key) || (state.stock && state.stock.id === key ? state.stock : null) || null;
}

export function planLabel(plan) {
  return lpPlanLabel(plan || {});
}

export function itemsOf(planId) {
  if (state.stock && state.stock.id === Number(planId)) return state.stockItems;
  return state.details.get(Number(planId)) || [];
}

export function flightPlans() {
  return state.plans.filter(p => p.type !== 'stock');
}

export function activePlan() {
  return planById(state.activePlanId);
}

export function setActivePlan(id) {
  state.activePlanId = id === null || id === undefined ? null : Number(id);
}

export function toggleExpanded(id) {
  const key = Number(id);
  if (state.expanded.has(key)) state.expanded.delete(key);
  else state.expanded.add(key);
  return state.expanded.has(key);
}

export function isExpanded(id) {
  return state.expanded.has(Number(id));
}

// 選取：左欄（存貨）與右欄（plan 明細）各自獨立
export function toggleSelection(setName, id) {
  const set = setName === 'stock' ? state.selectedStock : state.selectedItems;
  const key = Number(id);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return set.has(key);
}

export function clearSelection(setName) {
  (setName === 'stock' ? state.selectedStock : state.selectedItems).clear();
}

export function selectedIdList(setName) {
  return [...(setName === 'stock' ? state.selectedStock : state.selectedItems)];
}

export function pushUndo(entry) {
  state.undoStack.push(entry);
  if (state.undoStack.length > 30) state.undoStack.shift();
}

export function popUndo() {
  return state.undoStack.pop() || null;
}

export function setVolumeUnit(unit) {
  state.volumeUnit = ['cbm', 'cuft', 'vol'].includes(unit) ? unit : 'cbm';
}

// 明細顯示用的體積（跟隨 plan 的 volume_view）
export function volumeText(item, view = 'vol') {
  const v = item && item.volume ? item.volume : { cbm: item && item.cbm, vol: item && item.volume_weight, cuft: item && item.cuft };
  if (view === 'cuft') return fmt(v.cuft, 2);
  return fmt(v.vol, 2);
}

export function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}
