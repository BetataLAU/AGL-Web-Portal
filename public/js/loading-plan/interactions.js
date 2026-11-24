// ===== 執 PLAN：互動（拖曳 / 右鍵選單 / 剪貼簿 / Undo / 就地編輯）=====
import { lpApi } from './api.js';
import {
  state, planById, planLabel, activePlan, itemsOf, flightPlans, archivedPlanById,
  setActivePlan, toggleExpanded, toggleSelection, clearSelection, selectedIdList, pushUndo, fmt
} from './state.js';
import { renderAll, renderStock, renderToolbar, renderPlans } from './render.js';
import { esc, toast, debounce } from './dom.js';
import { lpVolFromCbm, lpCuftFromCbm, lpCrdToIso, lpCrdIssue, lpFormatCrd, lpTodayIso } from './calc.js';
import { lpCrdStep, lpCrdParseInput } from './crd.js';
import { lpParseTsv, lpBuildTsv } from './paste.js';
import { lpSuggestLoad, LP_SUGGEST_MODES } from './suggest.js';
import { lpMoveOrder } from './order.js';
import { LP_DIM_FIELDS, LP_DIM_LABELS, LP_DIM_MAX_LEN, lpNormalizeDimRows, lpAppendDim } from './dim.js';
import { startRealtime, setEditingItem, notifyPlanChange } from './realtime.js';

const openModal = (...args) => window.openModal(...args);

// ===== 載入 =====
export async function loadDetail(planId) {
  const res = await lpApi.plan(planId);
  state.details.set(Number(planId), res.items || []);
  const idx = state.plans.findIndex(p => p.id === Number(planId));
  if (idx >= 0 && res.data) state.plans[idx] = res.data;
  return res;
}

export async function loadAll() {
  state.loading = true;
  try {
    const [plansRes, archivedRes, stockRes] = await Promise.all([
      lpApi.plans(), lpApi.plans({ archived: 1 }), lpApi.stock()
    ]);
    state.plans = plansRes.data || [];
    state.archivedPlans = archivedRes.data || [];
    state.stock = stockRes.data || null;
    if (state.stock) state.details.set(Number(state.stock.id), stockRes.items || []);
    state.stockItems = stockRes.items || [];

    const known = [...state.plans.map(p => p.id), state.stock ? state.stock.id : null].filter(Boolean);
    if (!state.activePlanId || !known.includes(Number(state.activePlanId))) {
      const first = state.plans.find(p => p.type !== 'stock');
      setActivePlan(first ? first.id : null);
    }
    await Promise.all([...state.expanded].map(id => loadDetail(id).catch(() => null)));
    state.error = '';
  } catch (err) {
    state.error = err.message;
    toast(err.message, 'error');
  } finally {
    state.loading = false;
    renderAll();
  }
}

function normalizeDateInput(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return text;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

// <input type="date"> 只接受 yyyy-MM-dd；舊資料可能是 2026/11/14 或帶時間的 ISO 字串，
// 先截掉時間再正規化，避免日期欄位空白。
function toDateValue(value) {
  const text = normalizeDateInput(String(value || '').trim().slice(0, 10));
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

// ===== Shift 連續選取（PLAN 明細／存貨共用）=====
// 例：先 check 第 2 列 → 按住 Shift → 再 check 第 6 列＝第 2~6 列全部選取；
// 若 Shift 點的目標是「取消勾選」，整段就跟著取消。
let rangeAnchor = null;      // { planId, itemId }：上一次正常點選的列
let rangeHandledBox = null;  // Shift 已處理的 checkbox（change 事件不要再 toggle 一次）

function rowsOfList(planId, isStock) {
  if (isStock) return [...document.querySelectorAll('#lp-stock-list .lp-row[data-item-id]')];
  const card = document.querySelector(`.lp-plan[data-plan-id="${planId}"]`);
  return card ? [...card.querySelectorAll('.lp-row[data-item-id]')] : [];
}

function applyRangeSelection(box, row) {
  if (!rangeAnchor) return false;
  const planId = Number(row.dataset.planId);
  if (rangeAnchor.planId !== planId) return false;
  const isStock = !!(state.stock && Number(state.stock.id) === planId);
  const rows = rowsOfList(planId, isStock);
  const ids = rows.map(r => Number(r.dataset.itemId));
  const from = ids.indexOf(rangeAnchor.itemId);
  const to = ids.indexOf(Number(row.dataset.itemId));
  if (from < 0 || to < 0) return false;

  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const set = isStock ? state.selectedStock : state.selectedItems;
  for (let i = start; i <= end; i += 1) {
    const targetRow = rows[i];
    const id = ids[i];
    if (box.checked) set.add(id); else set.delete(id);
    targetRow.classList.toggle('is-selected', box.checked);
    const targetBox = targetRow.querySelector('input[data-action="select-item"]');
    if (targetBox) targetBox.checked = box.checked;
  }
  if (isStock) renderStock();
  renderToolbar();
  return true;
}

// ===== 動作 =====
function selectionFor(planId) {
  const isStock = state.stock && Number(state.stock.id) === Number(planId);
  return isStock ? [...state.selectedStock] : [...state.selectedItems];
}

async function addToPlan(planId, itemIds) {
  if (!itemIds.length) { toast('沒有選取任何明細', 'warn'); return; }
  try {
    const res = await lpApi.addItems(planId, { item_ids: itemIds });
    const entries = (res.moved || []).map(m => ({ id: m.item_id, fromPlanId: m.from_plan_id }));
    if (entries.length) pushUndo({ type: 'move', entries });
    clearSelection('stock');
    clearSelection('items');
    await loadAll();
    toast(`已加入 ${entries.length || (res.added || []).length} 票`, 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

async function toStock(ids) {
  const stock = state.stock;
  if (!stock) { toast('存貨尚未建立', 'error'); return; }
  if (!ids.length) { toast('沒有選取任何明細', 'warn'); return; }
  const planId = state.activePlanId;
  try {
    const res = await lpApi.addItems(stock.id, { item_ids: ids });
    const entries = (res.moved || []).map(m => ({ id: m.item_id, fromPlanId: m.from_plan_id }));
    if (entries.length) pushUndo({ type: 'move', entries });
    clearSelection('items');
    await loadAll();
    toast(`已移出 ${entries.length} 票到存貨（原 PLAN ${planId ? '' : ''}）`.trim(), 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

async function hardDelete(ids) {
  if (!ids.length) return;
  if (!window.confirm(`確定要刪除 ${ids.length} 筆明細？（不進存貨，無法復原）`)) return;
  try {
    for (const id of ids) await lpApi.removeItem(id, true);
    clearSelection('items');
    clearSelection('stock');
    await loadAll();
    toast('已刪除', 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

async function deletePlan(planId) {
  const plan = planById(planId);
  if (!plan) return;
  if (!window.confirm(`確定刪除「${planLabel(plan)}」？（有明細會被拒絕）`)) return;
  try {
    await lpApi.deletePlan(planId);
    state.expanded.delete(Number(planId));
    state.details.delete(Number(planId));
    if (Number(state.activePlanId) === Number(planId)) setActivePlan(null);
    await loadAll();
    toast('PLAN 已刪除', 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

// ===== 封存（ARCHIVE）／RECALL =====
// 使用者認為無用的 PLAN → 封存（從 PLAN 列表消失、不列入統計與重複 MAWB 檢核），
// 明細完整保留；之後在「🗄 封存」清單按「♻ RECALL」即可取回繼續使用。
async function archivePlan(planId) {
  const plan = planById(planId) || archivedPlanById(planId);
  if (!plan) return;
  if (plan.type === 'stock') { toast('存貨不能封存', 'warn'); return; }
  if (plan.archived_at) { toast(`「${planLabel(plan)}」已經封存`, 'warn'); return; }
  const ok = window.confirm(
    `確定封存「${planLabel(plan)}」？\n\n` +
    '封存後不會出現在 PLAN 列表（也不列入統計與重複 MAWB 檢核），\n' +
    '明細會完整保留，之後可按「🗄 封存」→「♻ RECALL」取回。'
  );
  if (!ok) return;
  try {
    await lpApi.archivePlan(planId);
    state.expanded.delete(Number(planId));
    state.details.delete(Number(planId));
    if (Number(state.activePlanId) === Number(planId)) setActivePlan(null);
    await loadAll();
    toast(`已封存「${planLabel(plan)}」（可從 🗄 封存 RECALL 取回）`, 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

async function recallPlan(planId) {
  const plan = archivedPlanById(planId) || planById(planId);
  if (!plan) return;
  try {
    await lpApi.recallPlan(planId);
    state.showArchived = false;   // RECALL 後回到正常清單，馬上看到這張 PLAN
    setActivePlan(planId);
    await loadAll();
    toast(`已 RECALL「${planLabel(plan)}」回 PLAN 列表`, 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

// ===== 體積顯示切換（VOL/CBM ↔ cu.ft/CBM）=====
function volumeViewLabel(view) {
  return view === 'cuft' ? 'cu.ft / CBM' : 'VOL / CBM';
}

// 有作用中的航班 PLAN → 只切這一張；沒有 → 套用到全部（含存貨），避免「按了沒反應」。
// 先樂觀更新畫面（立即回饋＋toast），API 失敗才還原。
async function setVolumeView(view) {
  const next = view === 'cuft' ? 'cuft' : 'vol';
  const viewOf = p => (p && p.volume_view === 'cuft' ? 'cuft' : 'vol');
  const active = activePlan();
  const onlyActive = !!(active && active.type !== 'stock');
  const targets = onlyActive
    ? [active]
    : (state.plans || []).slice().concat(state.stock ? [state.stock] : []);

  if (!targets.length) { toast('目前沒有 PLAN 可以切換體積顯示', 'warn'); return; }

  const changed = targets.filter(p => p && viewOf(p) !== next);
  if (!changed.length) {
    renderToolbar();
    toast(`體積顯示已是 ${volumeViewLabel(next)}`, 'ok');
    return;
  }

  const snapshot = changed.map(p => ({ plan: p, value: p.volume_view }));
  snapshot.forEach(({ plan }) => { plan.volume_view = next; });
  renderToolbar();
  renderPlans();
  renderStock();

  try {
    const ids = [...new Set(changed.map(p => Number(p.id)))];
    await Promise.all(ids.map(id => lpApi.patchPlan(id, { volume_view: next })));
    toast(`已切換為 ${volumeViewLabel(next)}`, 'ok');
    await loadAll();
  } catch (err) {
    snapshot.forEach(({ plan, value }) => { plan.volume_view = value; });
    renderAll();
    toast(err.message, 'error');
  }
}

async function undo() {
  const entry = state.undoStack.pop();
  if (!entry) return;
  try {
    if (entry.type === 'move') {
      const groups = new Map();
      (entry.entries || []).forEach(({ id, fromPlanId }) => {
        if (!groups.has(Number(fromPlanId))) groups.set(Number(fromPlanId), []);
        groups.get(Number(fromPlanId)).push(id);
      });
      for (const [planId, ids] of groups) await lpApi.addItems(planId, { item_ids: ids });
    } else if (entry.type === 'copy') {
      for (const id of entry.ids || []) await lpApi.removeItem(id, true);
    } else if (entry.type === 'reorder') {
      await lpApi.reorder(entry.planId, entry.prevOrder || []);
    }
    await loadAll();
    toast('已復原', 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

// 複製到…（選目標 plan）
function openCopyTargetModal(ids) {
  const targets = flightPlans().filter(p => Number(p.id) !== Number(state.activePlanId));
  if (!targets.length) { toast('沒有其他 PLAN 可複製', 'warn'); return; }
  const body = `<div class="lp-form">${targets.map(p => `
      <button type="button" class="lp-btn lp-copy-target" data-plan-id="${p.id}">${esc(planLabel(p))}</button>
    `).join('')}</div>`;
  const modal = openModal({ title: '複製到…', body, className: 'lp-modal' });
  modal.card.querySelectorAll('.lp-copy-target').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const planId = Number(btn.dataset.planId);
      modal.close();
      const created = [];
      try {
        for (const id of ids) {
          try {
            const res = await lpApi.copyItem(id, planId);
            created.push(res.id);
          } catch (err) { toast(err.message, 'error'); }
        }
        if (created.length) pushUndo({ type: 'copy', ids: created });
        clearSelection('items');
        await loadAll();
        toast(`已複製 ${created.length} 票（會標重複 MAWB）`, 'ok');
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// ===== 剪貼簿（內部；右鍵 Copy/Cut/Paste）=====
function setClipboard(mode, ids, planId) {
  state.clipboard = { mode, items: ids.map(id => ({ id, planId })) };
  toast(mode === 'cut' ? `已剪下 ${ids.length} 票` : `已複製 ${ids.length} 票（貼上會標重複）`, 'ok');
}

async function pasteInto(planId) {
  const clip = state.clipboard;
  if (!clip) { toast('剪貼簿是空的', 'warn'); return; }
  const ids = clip.items.map(i => i.id);
  try {
    if (clip.mode === 'cut') {
      const res = await lpApi.addItems(planId, { item_ids: ids });
      const entries = (res.moved || []).map(m => ({ id: m.item_id, fromPlanId: m.from_plan_id }));
      if (entries.length) pushUndo({ type: 'move', entries });
      state.clipboard = null;
      await loadAll();
      toast(`已貼上 ${entries.length} 票`, 'ok');
    } else {
      const created = [];
      for (const id of ids) {
        try {
          const res = await lpApi.copyItem(id, planId);
          created.push(res.id);
        } catch (err) { toast(err.message, 'error'); }
      }
      if (created.length) pushUndo({ type: 'copy', ids: created });
      await loadAll();
      if (created.length) toast(`已複製 ${created.length} 票（重複 MAWB 已標記）`, 'ok');
    }
  } catch (err) { toast(err.message, 'error'); }
}

// ===== 右鍵選單 =====
let menuEl = null;

function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}

function openMenu(x, y, row, planEl) {
  closeMenu();
  const planId = planEl ? Number(planEl.dataset.planId) : (row ? Number(row.dataset.planId) : null);
  const ids = row
    ? (selectionFor(planId).includes(Number(row.dataset.itemId))
      ? selectionFor(planId) : [Number(row.dataset.itemId)])
    : [];
  const defs = [];

  if (row) {
    defs.push({ label: `✂ 剪下${ids.length > 1 ? `（${ids.length}）` : ''}`, fn: () => setClipboard('cut', ids, planId) });
    defs.push({ label: `⧉ 複製${ids.length > 1 ? `（${ids.length}）` : ''}`, fn: () => setClipboard('copy', ids, planId) });
    if (state.clipboard) defs.push({ label: '📋 貼上', fn: () => pasteInto(planId) });
    defs.push({ label: '📤 複製到 Excel', fn: () => copyToExcel(ids) });
    defs.push({ divider: true });
    defs.push({ label: '◀ 移出到存貨', fn: () => toStock(ids) });
    defs.push({ label: '🗑 刪除（不進存貨）', fn: () => hardDelete(ids) });
    const item = itemsOf(planId).find(i => i.id === ids[0]);
    // 把「右鍵所在的那一列」一起帶進去，清單才能標出「現在的位置」
    if (item && item.mawb) {
      defs.push({ label: '📍 查看所有位置', fn: () => showPlacements(item.mawb, { planId, itemId: item.id }) });
    }
    // REMARK 欄有 DIM 快捷輸入（hover 面板的替代入口；觸控／鍵盤也能用）
    if (item && row.querySelector('.lp-c-tag')) {
      defs.push({
        label: '📐 輸入 DIM（L×W×H / PCS）',
        fn: () => {
          const cell = row.querySelector('.lp-c-tag');
          if (cell) openDimEditor(cell, item);
        }
      });
    }
  } else if (planEl && planEl.dataset.planId) {
    const plan = planById(planId) || archivedPlanById(planId);
    if (plan && plan.archived_at) {
      // 已封存：只能 RECALL（要修改先取回，避免封存中還被改）
      defs.push({ label: '♻ RECALL（取回 PLAN 列表）', fn: () => recallPlan(planId) });
    } else {
      if (state.clipboard) defs.push({ label: '📋 貼上到這張 PLAN', fn: () => pasteInto(planId) });
      defs.push({ label: '📥 貼上 Excel（TSV）', fn: () => pasteFromClipboard(planId) });
      defs.push({ label: '✎ 編輯 PLAN', fn: () => openPlanModal(planById(planId)) });
      defs.push({ divider: true });
      defs.push({ label: '🗄 封存 PLAN（可 RECALL）', fn: () => archivePlan(planId) });
      defs.push({ label: '🗑 刪除 PLAN', fn: () => deletePlan(planId) });
    }
  }
  if (!defs.length) return;

  menuEl = document.createElement('div');
  menuEl.className = 'lp-context-menu';
  defs.forEach((def) => {
    if (def.divider) {
      const div = document.createElement('div');
      div.className = 'lp-ctx-divider';
      menuEl.appendChild(div);
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lp-ctx-item';
    btn.textContent = def.label;
    btn.addEventListener('click', () => { closeMenu(); def.fn(); });
    menuEl.appendChild(btn);
  });
  document.body.appendChild(menuEl);
  const rect = menuEl.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menuEl.style.left = `${Math.max(4, left)}px`;
  menuEl.style.top = `${Math.max(4, top)}px`;
}

document.addEventListener('click', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
document.addEventListener('scroll', (e) => {
  const target = e.target;
  // 展開面板／DIM 清單「內部」捲動不算頁面捲動（長內容可自己捲）
  if (remarkEl && target && remarkEl.contains(target)) return;
  if (dimEditor && target && dimEditor.contains(target)) return;
  closeMenu();
  hideRemark();
  if (dimEditor) closeDimEditor();
}, true);

// ===== 就地編輯（雙擊格子）=====
async function commitInline(cell, item, field, value) {
  const payload = {};
  if (field === 'gross_weight') payload.gross_weight = value;
  else if (field === 'cbm') payload.cbm = value;
  else if (field === 'volume_weight') payload.volume_weight = value;
  else if (field === 'cuft') payload.cuft = value;
  else payload[field] = value;
  try {
    await lpApi.patchItem(item.id, payload);
    await loadAll();
    toast('已更新', 'ok');
  } catch (err) {
    toast(err.message, 'error');
    renderAll();
  }
}

function startInlineEdit(cell, item) {
  const field = cell.dataset.field;
  if (!field) return;
  const raw = field === 'cuft'
    ? (item.volume ? item.volume.cuft : item.cuft)
    : item[field];
  // REMARK（tag）是自由文字 → 用 textarea 就地編輯，可多行（DIM 每組一行）
  const multiline = field === 'tag';
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.className = multiline ? 'lp-inline-input lp-inline-textarea' : 'lp-inline-input';
  if (multiline) {
    input.rows = 3;
    input.maxLength = 500;
    input.placeholder = '自由文字；Enter 換行、Ctrl+Enter 完成';
    input.title = 'Enter 換行；Ctrl+Enter 或點擊其他地方完成；Esc 取消';
  }
  input.value = raw === null || raw === undefined ? '' : String(raw);
  const original = cell.innerHTML;
  cell.innerHTML = '';
  cell.appendChild(input);
  // textarea 用 fixed 定位（格子的 overflow: hidden 會裁切）→ 跟著格子捲動
  let cleanup = null;
  if (multiline) {
    const place = () => {
      const rect = cell.getBoundingClientRect();
      const width = 280;
      const left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 8));
      const top = Math.max(4, Math.min(rect.top, window.innerHeight - 96));
      input.style.left = `${left}px`;
      input.style.top = `${top}px`;
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    cleanup = () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }
  input.focus();
  input.select();
  setEditingItem(item.id);
  remarkSuppressed = true;
  hideRemark();
  let done = false;

  const finish = async (commit) => {
    if (done) return;
    done = true;
    if (cleanup) { cleanup(); cleanup = null; }
    remarkSuppressed = false;
    setEditingItem(null);
    if (!commit) {
      cell.innerHTML = original;
      return;
    }
    const value = input.value.trim();
    if (value === String(raw === null || raw === undefined ? '' : raw)) {
      cell.innerHTML = original;
      return;
    }
    await commitInline(cell, item, field, value);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish(false); return; }
    if (e.key !== 'Enter') return;
    // textarea 內 Enter 是換行；Ctrl/Cmd+Enter 才完成
    if (multiline && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    finish(true);
  });
  input.addEventListener('blur', () => finish(true));
}

// ===== CRD（Cargo Ready Date）：DDMMM；游標在 DD，↑ +1 日／↓ −1 日；不可遲於 Flight Date =====
// 顯示只到「日＋月」，年份由 Flight Date（沒有就用今天）推最近的一年 →
// 30NOV 按 ↑ 變 01DEC、01DEC 按 ↓ 變 30NOV（自動跨月／跨年）。
// 存檔一律 ISO（YYYY-MM-DD）；比 Flight Date 遲 → toast 通知＋紅框，且不寫入。
let crdCommitInFlight = false;
let crdToastMsg = '';
let crdToastAt = 0;

function crdInputOf(target) {
  return target && target.closest ? target.closest('.lp-crd-input') : null;
}

// 游標停在 DD（前 2 碼），符合「游標去到 DD 位」的操作習慣
function selectCrdDay(input) {
  if (!input || typeof input.setSelectionRange !== 'function') return;
  try { input.setSelectionRange(0, Math.min(2, String(input.value || '').length)); } catch (err) { /* ignore */ }
}

// 滑鼠點進來時瀏覽器會在 focus 之後才放游標 → 下一個 tick 再選一次 DD
function scheduleSelectCrdDay(input) {
  selectCrdDay(input);
  setTimeout(() => {
    if (input && document.activeElement === input) selectCrdDay(input);
  }, 0);
}

function setCrdInvalid(input, issue) {
  if (!input) return;
  input.classList.toggle('is-invalid', !!issue);
  const base = `CRD：${String(input.value || '').trim() || '（空白）'}｜↑ +1 日、↓ −1 日、Enter 完成`;
  input.title = issue ? `${base} ｜ ⛔ ${issue}` : base;
}

// 同一個錯誤 1.5 秒內不重複 toast（連續按 ↑ 不會洗版）
function toastCrdError(message) {
  const now = Date.now();
  if (message === crdToastMsg && now - crdToastAt < 1500) return;
  crdToastMsg = message;
  crdToastAt = now;
  toast(`⛔ ${message}（CRD 不可比 Flight Date 遲）`, 'error');
}

function flashCrdError(input) {
  if (!input || !input.classList) return;
  input.classList.remove('is-crd-error');
  void input.offsetWidth;   // 強制 reflow → 重新觸發 CSS 動畫
  input.classList.add('is-crd-error');
  setTimeout(() => input.classList.remove('is-crd-error'), 400);
}

// 還原成 DB 的值（放棄未存的草稿）
function resetCrdDisplay(input) {
  if (!input) return;
  const saved = String(input.dataset.crdSaved || '');
  input.value = saved ? (lpFormatCrd(saved) || saved.slice(0, 10)) : '';
  delete input.dataset.crdDirty;
  delete input.dataset.crdAuto;
  setCrdInvalid(input, lpCrdIssue(saved, input.dataset.crdFlight || ''));
}

async function patchCrd(input, itemId, iso) {
  if (!itemId) { resetCrdDisplay(input); return false; }
  crdCommitInFlight = true;
  input.disabled = true;
  try {
    await lpApi.patchItem(itemId, { cargo_receipt: iso });
    toast(iso ? `CRD 已更新 ${lpFormatCrd(iso)}` : 'CRD 已清除', 'ok');
    await loadAll();
  } catch (err) {
    toast(err.message || 'CRD 更新失敗', 'error');
    input.disabled = false;
    resetCrdDisplay(input);
    crdCommitInFlight = false;
    return false;
  }
  crdCommitInFlight = false;
  return true;
}

async function commitCrd(input, options = {}) {
  if (!input || crdCommitInFlight) return false;
  const itemId = Number(input.dataset.crdItem) || 0;
  const flight = String(input.dataset.crdFlight || '');
  const ref = flight || lpTodayIso();
  const saved = String(input.dataset.crdSaved || '');
  const raw = String(input.value || '').trim();

  if (!raw) {
    if (!saved) { resetCrdDisplay(input); return true; }
    delete input.dataset.crdDirty;
    delete input.dataset.crdAuto;
    return patchCrd(input, itemId, '');
  }
  const parsed = lpCrdParseInput(raw, flight, saved, lpTodayIso());
  if (!parsed) {
    toast('CRD 格式應為 DDMMM（例 24NOV）或 YYYY-MM-DD', 'warn');
    flashCrdError(input);
    resetCrdDisplay(input);
    return false;
  }
  if (parsed.issue) {
    toastCrdError(parsed.issue);
    flashCrdError(input);
    resetCrdDisplay(input);
    return false;
  }
  const iso = parsed.iso;
  const savedIso = lpCrdToIso(saved, ref);
  if (iso === savedIso) {
    input.value = lpFormatCrd(iso);
    delete input.dataset.crdDirty;
    delete input.dataset.crdAuto;
    setCrdInvalid(input, '');
    return true;
  }

  delete input.dataset.crdDirty;   // 先清掉，避免 blur 再次送出同一筆
  delete input.dataset.crdAuto;
  const ok = await patchCrd(input, itemId, iso);
  // loadAll 會重畫整張表 → 舊 input 已移除；按 Enter 完成時把焦點放回同一票的新格子
  if (ok && options.refocus) {
    const next = document.querySelector(`.lp-crd-input[data-crd-item="${itemId}"]`);
    if (next) { next.focus(); scheduleSelectCrdDay(next); }
  }
  return ok;
}

function onCrdFocus(e) {
  const input = crdInputOf(e.target);
  if (!input) return;
  setEditingItem(Number(input.dataset.crdItem) || null);
  // 空白格子：游標一進去先自動帶入今天（只顯示；沒改就離開會還原，不會誤存）
  if (!String(input.value || '').trim()) {
    input.value = lpFormatCrd(lpTodayIso()) || '';
    input.dataset.crdAuto = '1';
  }
  setCrdInvalid(input, lpCrdIssue(input.value, input.dataset.crdFlight || ''));
  scheduleSelectCrdDay(input);
}

function onCrdBlur(e) {
  const input = crdInputOf(e.target);
  if (!input) return;
  setEditingItem(null);
  if (crdCommitInFlight) return;
  // 只有真的動過（↑↓／打字／Enter）才存；只是游標經過 → 還原
  if (input.dataset.crdDirty) commitCrd(input);
  else resetCrdDisplay(input);
}

function onCrdKeyDown(e) {
  const input = crdInputOf(e.target);
  if (!input) return;
  const flight = String(input.dataset.crdFlight || '');

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const step = lpCrdStep(input.value, e.key === 'ArrowUp' ? 'up' : 'down', flight, lpTodayIso());
    if (!step) return;
    input.value = step.text;
    input.dataset.crdDirty = '1';
    delete input.dataset.crdAuto;
    setCrdInvalid(input, step.issue);
    if (step.issue) { toastCrdError(step.issue); flashCrdError(input); }
    selectCrdDay(input);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    commitCrd(input, { refocus: true });
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    resetCrdDisplay(input);
    input.blur();
  }
}

// ===== REMARK（tag）自由文字：hover 向下展開＋DIM 快捷輸入 =====
// REMARK 一格可放多行自由文字（DIM 每組一行，格式「L x W x H / PCS」）。
// 滑鼠移入 → 下方浮出完整內容（fixed 定位，不會被 PLAN 容器裁切），右側是「DIM」按鈕。
let remarkEl = null;
let remarkCell = null;
let remarkShowTimer = null;
let remarkHideTimer = null;
let remarkSuppressed = false;
let dimEditor = null;
let dimOutsideHandler = null;

function hideRemark() {
  clearTimeout(remarkShowTimer);
  clearTimeout(remarkHideTimer);
  remarkShowTimer = null;
  remarkHideTimer = null;
  remarkCell = null;
  if (remarkEl) { remarkEl.remove(); remarkEl = null; }
}

function scheduleHideRemark() {
  if (remarkHideTimer) return;
  remarkHideTimer = setTimeout(() => {
    remarkHideTimer = null;
    remarkCell = null;
    if (remarkEl) { remarkEl.remove(); remarkEl = null; }
  }, 220);
}

function cancelHideRemark() {
  clearTimeout(remarkHideTimer);
  remarkHideTimer = null;
}

function itemFromCell(cell) {
  const row = cell && cell.closest ? cell.closest('.lp-row') : null;
  if (!row) return null;
  return itemsOf(Number(row.dataset.planId)).find(i => i.id === Number(row.dataset.itemId)) || null;
}

function placeFloating(boxEl, anchorRect) {
  const box = boxEl.getBoundingClientRect();
  const left = Math.min(anchorRect.left, window.innerWidth - box.width - 8);
  let top = anchorRect.bottom + 4;
  if (top + box.height > window.innerHeight - 8) top = Math.max(8, anchorRect.top - box.height - 4);
  boxEl.style.left = `${Math.max(4, left)}px`;
  boxEl.style.top = `${Math.max(4, top)}px`;
}

function showRemark(cell) {
  if (!cell || !cell.isConnected || remarkSuppressed || dimEditor) return;
  const item = itemFromCell(cell);
  if (!item) return;
  const text = String(item.tag || '').trim();
  hideTip();
  if (remarkEl) remarkEl.remove();
  remarkEl = document.createElement('div');
  remarkEl.className = 'lp-remark-pop';
  remarkEl.innerHTML = `
    <div class="lp-remark-pop-text${text ? '' : ' is-empty'}">${text ? esc(text) : '（空白；雙擊格子可輸入文字）'}</div>
    <button type="button" class="lp-dim-btn" title="輸入 DIM：L × W × H / PCS">📐 DIM</button>
  `;
  remarkEl.addEventListener('mouseenter', cancelHideRemark);
  remarkEl.addEventListener('mouseleave', scheduleHideRemark);
  const dimBtn = remarkEl.querySelector('.lp-dim-btn');
  if (dimBtn) {
    dimBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      hideRemark();
      openDimEditor(cell, item);
    });
  }
  document.body.appendChild(remarkEl);
  placeFloating(remarkEl, cell.getBoundingClientRect());
}

// ---- DIM 輸入器（L × W × H / PCS）----
function dimInputHtml(field) {
  const numeric = field === 'pcs'
    ? 'min="1" step="1" inputmode="numeric"'
    : 'min="0" step="any" inputmode="decimal"';
  return `<input type="number" class="lp-dim-input" data-dim="${field}" ${numeric} placeholder="${LP_DIM_LABELS[field]}" autocomplete="off" />`;
}

function dimRowHtml() {
  return `
    <div class="lp-dim-row">
      ${dimInputHtml('length')}<span class="lp-dim-x">×</span>
      ${dimInputHtml('width')}<span class="lp-dim-x">×</span>
      ${dimInputHtml('height')}<span class="lp-dim-sep">/</span>
      ${dimInputHtml('pcs')}
    </div>
  `;
}

function addDimRow(editor) {
  const rows = editor.querySelector('.lp-dim-rows');
  if (!rows) return;
  rows.insertAdjacentHTML('beforeend', dimRowHtml());
  const row = rows.lastElementChild;
  if (!row) return;
  const first = row.querySelector('[data-dim="length"]');
  if (first) first.focus();
  rows.scrollTop = rows.scrollHeight;
  // 新增列後若超出視窗底部 → 把面板往上移
  const rect = editor.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 8) {
    editor.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
  }
}

function focusDimField(row, field) {
  const input = row ? row.querySelector(`[data-dim="${field}"]`) : null;
  if (input) input.focus();
}

function closeDimEditor() {
  if (dimOutsideHandler) {
    document.removeEventListener('mousedown', dimOutsideHandler);
    dimOutsideHandler = null;
  }
  if (dimEditor) { dimEditor.remove(); dimEditor = null; }
  setEditingItem(null);
}

function readDimRowValues(row) {
  const values = {};
  LP_DIM_FIELDS.forEach((field) => {
    const input = row ? row.querySelector(`[data-dim="${field}"]`) : null;
    values[field] = input ? input.value : '';
  });
  return values;
}

// ctx = { existingText, itemId, apply(appended, lines) }：PLAN 明細與 Booking modal 共用
async function saveDim(editor, ctx) {
  if (!editor || editor.dataset.saving === '1') return;
  const rowEls = [...editor.querySelectorAll('.lp-dim-row')];
  const normalized = lpNormalizeDimRows(rowEls.map(readDimRowValues));
  if (normalized.error) {
    toast(normalized.error.message, 'warn');
    focusDimField(rowEls[normalized.error.rowIndex], normalized.error.field);
    return;
  }
  if (!normalized.lines.length) { toast('尚未輸入任何 DIM', 'warn'); return; }

  const appended = lpAppendDim(ctx.existingText, normalized.lines);
  if (appended.overflow) {
    toast(`REMARK 最多 ${LP_DIM_MAX_LEN} 字，請縮短或分批輸入`, 'warn');
    return;
  }

  editor.dataset.saving = '1';
  try {
    await ctx.apply(appended, normalized.lines);
  } catch (err) {
    delete editor.dataset.saving;
    toast(err.message, 'error');
  }
}

// 共用 DIM 輸入器：anchorEl 決定浮出位置；ctx.apply() 決定「完成後做什麼」
function openDimPanel(anchorEl, ctx) {
  if (!anchorEl) return;
  closeDimEditor();
  hideRemark();
  const panel = ctx || {};
  dimEditor = document.createElement('div');
  dimEditor.className = 'lp-dim-editor';
  dimEditor.innerHTML = `
    <div class="lp-dim-head"><b>📐 DIM</b><span>L × W × H / PCS（cm）</span></div>
    <div class="lp-dim-rows">${dimRowHtml()}</div>
    <p class="lp-dim-hint">Tab 換下一格；PCS 後 Tab 新增一列；Enter 完成、Esc 取消</p>
    <div class="lp-dim-actions">
      <button type="button" class="lp-btn lp-btn-sm lp-btn-primary" data-dim-action="save">✓ 完成</button>
      <button type="button" class="lp-btn lp-btn-sm" data-dim-action="cancel">取消</button>
    </div>
  `;
  document.body.appendChild(dimEditor);
  placeFloating(dimEditor, anchorEl.getBoundingClientRect());

  const editor = dimEditor;
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // 只關 DIM；外層若開著 modal 不要一起被 ESC 關掉
      e.stopPropagation();
      closeDimEditor();
      return;
    }
    if (e.key === 'Enter') {
      // 按鈕上的 Enter 交給按鈕本身處理
      if (e.target && e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      saveDim(editor, panel);
      return;
    }
    // 最後一格 PCS 再按 Tab → 新增一列並把焦點移到新列的 L
    if (e.key === 'Tab' && !e.shiftKey) {
      const inputs = [...editor.querySelectorAll('.lp-dim-input')];
      if (inputs.length && e.target === inputs[inputs.length - 1]) {
        e.preventDefault();
        addDimRow(editor);
      }
    }
  });
  editor.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dim-action]');
    if (!btn) return;
    if (btn.dataset.dimAction === 'save') saveDim(editor, panel);
    else closeDimEditor();
  });

  // 點擊編輯器外面 → 關閉（延後註冊，避免剛開啟就被同一個 click 關掉）
  dimOutsideHandler = (ev) => {
    if (dimEditor === editor && !editor.contains(ev.target)) closeDimEditor();
  };
  setTimeout(() => {
    if (dimEditor === editor && dimOutsideHandler) {
      document.addEventListener('mousedown', dimOutsideHandler);
    }
  }, 0);

  setEditingItem(panel.itemId || null);
  const first = editor.querySelector('[data-dim="length"]');
  if (first) first.focus();
}

// PLAN 明細的 REMARK（tag）：完成後直接 PATCH 存回（行為與原本一致）
function openDimEditor(cell, item) {
  openDimPanel(cell, {
    existingText: item.tag,
    itemId: item.id,
    apply: async (appended, lines) => {
      await lpApi.patchItem(item.id, { tag: appended.text });
      closeDimEditor();
      await loadAll();
      toast(`已加入 ${lines.length} 組 DIM`, 'ok');
    }
  });
}

// Booking modal 的「備註 REMARK」：只寫回 textarea，按「建立並加入存貨」才送出
function openBookingDimEditor(field) {
  if (!field) return;
  openDimPanel(field, {
    existingText: field.value,
    apply: async (appended, lines) => {
      field.value = appended.text;
      closeDimEditor();
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
      toast(`已加入 ${lines.length} 組 DIM`, 'ok');
    }
  });
}

// ===== 找 Booking（MAWB 主檔動態搜尋）=====
async function addRecords(planId, recordIds) {
  if (!recordIds.length) { toast('沒有選取任何 Booking', 'warn'); return; }
  try {
    const res = await lpApi.addItems(planId, { mawb_record_ids: recordIds });
    const entries = (res.moved || []).map(m => ({ id: m.item_id, fromPlanId: m.from_plan_id }));
    if (entries.length) pushUndo({ type: 'move', entries });
    await loadAll();
    toast(`已加入 ${entries.length + (res.added || []).length} 票`, 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

function openFindBookingModal() {
  const targets = [
    `<option value="stock" selected>存貨（之後再拖到 PLAN）</option>`,
    ...flightPlans().map(p => `<option value="${p.id}">${esc(planLabel(p))}</option>`)
  ].join('');
  const body = `
    <div class="lp-find-tabs" role="tablist">
      <button type="button" class="lp-find-tab is-on" data-find-tab="search" role="tab" aria-selected="true">🔍 找現有 Booking</button>
      <button type="button" class="lp-find-tab" data-find-tab="new" role="tab" aria-selected="false">＋ 新增 Booking</button>
    </div>
    <div id="lp-find-pane-search">
      <div class="lp-form">
        <label>加入到 <select id="lp-find-target" class="lp-input">${targets}</select></label>
        <input id="lp-find-search" class="lp-input" placeholder="輸入 MAWB / 客戶 / DEST（即時搜尋）" autocomplete="off" />
      </div>
      <div class="lp-find-results" id="lp-find-results"><div class="lp-empty-sm">輸入關鍵字開始搜尋</div></div>
      <div class="lp-find-actions">
        <button type="button" class="lp-btn lp-btn-primary" id="lp-find-add" disabled>▶ 加入所選</button>
      </div>
    </div>
    <div id="lp-find-pane-new" hidden>
      <div class="lp-form lp-bk-grid">
        <label>MAWB# *
          <input id="lp-bk-mawb" class="lp-input" maxlength="40" placeholder="176-0000 0000（或 後補MAWB#）" autocomplete="off" />
        </label>
        <label>HAWB#（選填）
          <input id="lp-bk-hawb" class="lp-input" maxlength="30" placeholder="選填" autocomplete="off" />
        </label>
        <label>客戶 CLIENT
          <input id="lp-bk-client" class="lp-input" maxlength="80" placeholder="客戶名" autocomplete="off" />
        </label>
        <label>DEST
          <input id="lp-bk-dest" class="lp-input" maxlength="10" placeholder="如 DWC / NRT" style="text-transform:uppercase;" autocomplete="off" />
        </label>
        <label>PKGS（例 17+7P）
          <input id="lp-bk-pkgs" class="lp-input" maxlength="40" placeholder="17+7P" autocomplete="off" />
        </label>
        <label>G.W（kg）
          <input id="lp-bk-gw" class="lp-input" inputmode="decimal" placeholder="0.00" autocomplete="off" />
        </label>
        <label>CBM
          <input id="lp-bk-cbm" class="lp-input" inputmode="decimal" placeholder="0.000" autocomplete="off" />
        </label>
        <label>CRD（Cargo Ready Date）
          <input id="lp-bk-crd" class="lp-input" maxlength="10" placeholder="24NOV（選填）"
                 style="text-transform:uppercase;" autocomplete="off"
                 title="格式 DDMMM（例 24NOV）；游標進入先帶入今天，↑ +1 日、↓ −1 日" />
        </label>
        <label class="lp-bk-full">REMARK（顯示在 PLAN 表）
          <span class="lp-bk-remark">
            <textarea id="lp-bk-remark" class="lp-input" rows="2" maxlength="500" placeholder="選填；可多行（DIM 一組一行）"></textarea>
            <button type="button" class="lp-dim-btn" id="lp-bk-dim" title="輸入 DIM：L × W × H / PCS">📐 輸入 DIM</button>
          </span>
        </label>
      </div>
      <p class="lp-muted">建立後會直接加到「存貨」，之後可再拖到 PLAN；同一 MAWB 已有 Booking 時會提示改用「找現有」。</p>
      <div class="lp-find-error" id="lp-find-error"></div>
      <div class="lp-find-actions">
        <button type="button" class="lp-btn lp-btn-primary" id="lp-bk-create">＋ 建立並加入存貨</button>
      </div>
    </div>
  `;
  const modal = openModal({
    title: '找 Booking／新增 Booking',
    body,
    className: 'lp-modal lp-modal-wide',
    actions: [{ label: '關閉', className: 'pill' }]
  });

  const resultsEl = document.getElementById('lp-find-results');
  const addBtn = document.getElementById('lp-find-add');
  const errorEl = document.getElementById('lp-find-error');
  // 備註 REMARK 的 DIM 快捷輸入（與 PLAN 的 REMARK 同一套輸入器）
  const remarkField = document.getElementById('lp-bk-remark');
  const remarkDimBtn = document.getElementById('lp-bk-dim');
  if (remarkField && remarkDimBtn) {
    remarkDimBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      openBookingDimEditor(remarkField);
    });
  }

  // CRD：與 PLAN 明細的 CRD 同一套規則（DDMMM；游標進入先帶入今天；↑ +1 日、↓ −1 日）
  const crdField = document.getElementById('lp-bk-crd');
  if (crdField) {
    crdField.addEventListener('focus', () => {
      if (!String(crdField.value || '').trim()) crdField.value = lpFormatCrd(lpTodayIso()) || '';
      crdField.classList.remove('is-invalid');
      crdField.title = '格式 DDMMM（例 24NOV）；游標進入先帶入今天，↑ +1 日、↓ −1 日';
      try { crdField.setSelectionRange(0, Math.min(2, crdField.value.length)); } catch (err) { /* ignore */ }
    });
    crdField.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const step = lpCrdStep(crdField.value, e.key === 'ArrowUp' ? 'up' : 'down', '', lpTodayIso());
      if (!step) return;
      crdField.value = step.text;
      try { crdField.setSelectionRange(0, 2); } catch (err) { /* ignore */ }
    });
    crdField.addEventListener('blur', () => {
      const raw = String(crdField.value || '').trim();
      if (!raw) { crdField.classList.remove('is-invalid'); crdField.title = ''; return; }
      const parsed = lpCrdParseInput(raw, '', '', lpTodayIso());
      if (!parsed) {
        crdField.classList.add('is-invalid');
        crdField.title = 'CRD 格式應為 DDMMM（例 24NOV）或 YYYY-MM-DD';
        return;
      }
      crdField.value = parsed.text;
      crdField.classList.remove('is-invalid');
      crdField.title = '';
    });
  }

  // MAWB# 嚴格驗證（沿用訂單系統的 validateMawb：11 位＋prefix 001-999＋檢查碼；允許「後補MAWB#」）
  const mawbField = document.getElementById('lp-bk-mawb');
  const checkMawbField = (markInvalid) => {
    const raw = mawbField ? String(mawbField.value || '').trim() : '';
    const result = typeof window.validateMawb === 'function'
      ? window.validateMawb(raw)
      : { valid: true, late: false, error: null, formatted: raw };
    const showInvalid = !result.valid && (markInvalid || raw !== '');
    if (mawbField) {
      mawbField.classList.toggle('is-invalid', showInvalid);
      mawbField.title = showInvalid ? String(result.error || '') : '';
      if (result.valid) mawbField.value = result.formatted;   // 自動格式化成 176-6525 7360
    }
    return result;
  };
  if (mawbField) mawbField.addEventListener('blur', () => checkMawbField(false));

  const setError = (message) => {
    if (!errorEl) return;
    errorEl.textContent = message || '';
    errorEl.classList.toggle('is-on', !!message);
  };
  const readField = (id) => {
    const node = document.getElementById(id);
    return node ? String(node.value || '').trim() : '';
  };
  const syncAddBtn = () => {
    if (!addBtn || !resultsEl) return;
    const count = resultsEl.querySelectorAll('input[type="checkbox"]:checked').length;
    addBtn.disabled = count === 0;
    addBtn.textContent = count ? `▶ 加入所選（${count}）` : '▶ 加入所選';
  };
  const switchTab = (name) => {
    modal.card.querySelectorAll('[data-find-tab]').forEach((btn) => {
      const on = btn.dataset.findTab === name;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const searchPane = document.getElementById('lp-find-pane-search');
    const newPane = document.getElementById('lp-find-pane-new');
    if (searchPane) searchPane.hidden = name !== 'search';
    if (newPane) newPane.hidden = name !== 'new';
    setError('');
    const focusNode = document.getElementById(name === 'search' ? 'lp-find-search' : 'lp-bk-mawb');
    if (focusNode) focusNode.focus();
  };
  modal.card.querySelectorAll('[data-find-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.findTab));
  });

  const runSearch = debounce(async () => {
    const input = document.getElementById('lp-find-search');
    if (!input || !resultsEl) return;
    const query = input.value.trim();
    if (!query) {
      resultsEl.innerHTML = '<div class="lp-empty-sm">輸入關鍵字開始搜尋</div>';
      syncAddBtn();
      return;
    }
    try {
      const res = await lpApi.bookings(query, 30);
      const rows = res.data || [];
      resultsEl.innerHTML = rows.length ? rows.map((row) => {
        const place = (row.placements || []).map(pl => pl.label).join('、') || '未分配';
        return `
          <label class="lp-find-row">
            <input type="checkbox" value="${row.id}" />
            <span class="lp-find-mawb">${esc(row.mawb)}</span>
            <span>${esc(row.dest || '')}</span>
            <span>${row.pcs == null ? '—' : esc(row.pcs)} 件</span>
            <span>${esc(Number(row.gross_weight || 0).toLocaleString('en-US'))} kg</span>
            <span class="lp-find-place" title="目前位置">📍 ${esc(place)}</span>
          </label>
        `;
      }).join('') : '<div class="lp-empty-sm">找不到符合的 Booking</div>';
      syncAddBtn();
    } catch (err) {
      resultsEl.innerHTML = `<div class="lp-empty-sm">搜尋失敗：${esc(err.message)}</div>`;
      syncAddBtn();
    }
  }, 200);

  const searchInput = document.getElementById('lp-find-search');
  if (searchInput) searchInput.addEventListener('input', runSearch);
  if (resultsEl) resultsEl.addEventListener('change', syncAddBtn);

  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const ids = [...(resultsEl ? resultsEl.querySelectorAll('input[type="checkbox"]:checked') : [])]
        .map(box => Number(box.value)).filter(Boolean);
      if (!ids.length) { toast('請先勾選 Booking', 'warn'); return; }
      const target = document.getElementById('lp-find-target');
      const planId = target && target.value === 'stock'
        ? (state.stock ? state.stock.id : null)
        : Number(target && target.value);
      if (!planId) { toast('找不到目標', 'error'); return; }
      modal.close();
      await addRecords(planId, ids);
    });
  }

  const createBtn = document.getElementById('lp-bk-create');
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      const payload = {
        mawb: readField('lp-bk-mawb'),
        hawb: readField('lp-bk-hawb'),
        client: readField('lp-bk-client'),
        dest: readField('lp-bk-dest'),
        pkgs_text: readField('lp-bk-pkgs'),
        gross_weight: readField('lp-bk-gw'),
        cbm: readField('lp-bk-cbm'),
        // TAG 與 REMARK 已合併成同一欄：同時寫入 tag（PLAN 表顯示）與 remark（Excel 匯出用）
        tag: readField('lp-bk-remark'),
        remark: readField('lp-bk-remark'),
        cargo_receipt: ''
      };
      const mawbCheck = checkMawbField(true);
      if (!payload.mawb) {
        setError('請輸入 MAWB#（必填）');
        if (mawbField) mawbField.focus();
        return;
      }
      if (!mawbCheck.valid) {
        setError(mawbCheck.error || 'MAWB# 格式不正確');
        if (mawbField) mawbField.focus();
        return;
      }
      payload.mawb = mawbCheck.formatted;
      // CRD（選填）：DDMMM／ISO 都接受 → 送出前統一轉 ISO（與 PLAN 明細一致）
      const crdRaw = readField('lp-bk-crd');
      const crdParsed = crdRaw ? lpCrdParseInput(crdRaw, '', '', lpTodayIso()) : { iso: '' };
      if (!crdParsed) {
        setError('CRD 格式應為 DDMMM（例 24NOV）或 YYYY-MM-DD');
        if (crdField) { crdField.classList.add('is-invalid'); crdField.focus(); }
        return;
      }
      payload.cargo_receipt = crdParsed.iso;
      setError('');
      createBtn.disabled = true;
      try {
        await lpApi.createBooking(payload);
        // 清掉存貨搜尋條件，確保剛建立的貨一定看得到
        state.searchStock = '';
        const stockSearch = document.getElementById('lp-stock-search');
        if (stockSearch) stockSearch.value = '';
        modal.close();
        await loadAll();
        toast(`已新增 Booking ${payload.mawb} 並加入存貨`, 'ok');
      } catch (err) {
        if (err && err.status === 409) {
          // MAWB 已有 Booking → 自動切到「找現有」並帶入搜尋
          switchTab('search');
          const node = document.getElementById('lp-find-search');
          if (node) {
            node.value = payload.mawb;
            node.dispatchEvent(new Event('input'));
          }
          toast('此 MAWB 已有 Booking，已幫你搜尋；請勾選後按「加入所選」', 'warn');
        } else {
          setError(err.message || '建立失敗');
        }
      } finally {
        createBtn.disabled = false;
      }
    });
  }

  switchTab('search');
  return modal;
}

// ===== Hover：只有「有錯誤」的列才顯示訊息 =====
// 正常列：只靠 CSS 的 .lp-row:hover highlight，不查位置、不出 tooltip。
// 有錯誤（缺 MAWB／重複 MAWB／件數未填）：資料由渲染時的 data-hover-error 帶進來。
let tipEl = null;
let tipTimer = null;
let hoverNode = null;

function hideTip() {
  if (tipEl) { tipEl.remove(); tipEl = null; }
}

function showTip(anchor, message) {
  if (hoverNode !== anchor || !message) return;
  hideTip();
  tipEl = document.createElement('div');
  tipEl.className = 'lp-tip';
  tipEl.innerHTML = `<div class="lp-tip-error" title="${esc(message)}">⚠ ${esc(message)}</div>`;
  document.body.appendChild(tipEl);
  const rect = anchor.getBoundingClientRect();
  const box = tipEl.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - box.width - 8);
  let top = rect.bottom + 6;
  if (top + box.height > window.innerHeight - 8) top = rect.top - box.height - 6;
  tipEl.style.left = `${Math.max(4, left)}px`;
  tipEl.style.top = `${Math.max(4, top)}px`;
}

function hoverErrorRow(target) {
  return target && target.closest ? target.closest('.lp-row[data-hover-error]') : null;
}


// ===== 位置清單（右鍵 → 查看所有位置）=====
// 點擊清單任一列 → 切到該 PLAN、展開、載入明細，捲到該列並閃爍 highlight。
let flashTimer = null;

async function jumpToItem(planId, itemId) {
  const pid = Number(planId);
  const iid = Number(itemId);
  if (!pid) return;
  // 目標在「已封存」的 PLAN：不展開（封存只能 RECALL），切到封存清單讓使用者按 ♻ RECALL
  const archived = archivedPlanById(pid);
  if (archived) {
    state.showArchived = true;
    renderPlans();
    toast(`「${planLabel(archived)}」已封存；按「♻ RECALL」取回後才能查看明細`, 'warn');
    return;
  }
  const isStock = !!(state.stock && Number(state.stock.id) === pid);
  if (!isStock) {
    state.expanded.add(pid);
    setActivePlan(pid);
    notifyPlanChange();
    try {
      await loadDetail(pid);
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
  }
  renderAll();
  const rowEl = isStock
    ? document.querySelector(`#lp-stock-list .lp-row[data-item-id="${iid}"]`)
    : document.querySelector(`.lp-plan[data-plan-id="${pid}"] .lp-row[data-item-id="${iid}"]`);
  if (!rowEl) { toast('找不到這個位置（可能已被移走）', 'warn'); return; }

  if (typeof rowEl.scrollIntoView === 'function') rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  rowEl.classList.remove('is-flash');
  void rowEl.offsetWidth; // 強制 reflow，讓動畫可以重新開始
  rowEl.classList.add('is-flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => rowEl.classList.remove('is-flash'), 3200);

  const plan = planById(pid);
  toast(`已跳到 ${plan ? planLabel(plan) : `PLAN #${pid}`}`, 'ok');
}

// 位置清單的一列；current = 目前所在的位置（最後一欄改成「📍 現在的位置」）
// 已封存的 PLAN：標籤後面加「（已封存）」，點擊只會切到封存清單（需 RECALL 才能看明細）
function placeRowHtml(p, current) {
  const isArchived = !!p.archived_at;
  const title = isArchived
    ? '這個位置在已封存的 PLAN（需 ♻ RECALL 取回才能查看明細）'
    : current
      ? '你目前就在這個位置（點擊會捲到該列並閃爍）'
      : '點擊跳到這個位置（目標列會閃爍標示）';
  return `
          <div class="lp-find-row lp-place-row${current ? ' is-current' : ''}${isArchived ? ' is-archived-place' : ''}" role="button" tabindex="0"
               data-plan-id="${p.plan_id}" data-item-id="${p.item_id}" title="${title}"${current ? ' aria-current="true"' : ''}>
            <span class="lp-find-mawb">${esc(p.label)}${isArchived ? '<span class="lp-archived-place-tag">（已封存）</span>' : ''}</span>
            <span>#${p.section || 1}</span>
            <span class="lp-find-place">${esc(p.plan_no || '')}</span>
            <span class="lp-find-go${current ? ' lp-find-now' : ''}">${current ? '📍 現在的位置' : '➜ 前往'}</span>
          </div>`;
}

// 由「開啟清單的那一列」判斷哪一個位置是現在的位置：先比 item_id，沒有才退回比 plan_id
function currentPlacementMatcher(source = {}) {
  const planId = Number(source.planId) || null;
  const itemId = Number(source.itemId) || null;
  return (p) => {
    if (!planId) return false;
    if (!itemId) return Number(p.plan_id) === planId;
    return Number(p.item_id) === itemId && Number(p.plan_id) === planId;
  };
}

async function showPlacements(mawb, source = {}) {
  try {
    const res = await lpApi.placements({ mawb });
    const list = res.data || [];
    const isCurrent = currentPlacementMatcher(source);
    const body = list.length
      ? `<div class="lp-form">${list.map(p => placeRowHtml(p, isCurrent(p))).join('')}</div>`
      : '<div class="lp-empty-sm">只在這一個位置</div>';
    const modal = openModal({ title: `位置：${esc(mawb)}`, body, className: 'lp-modal' });
    modal.card.querySelectorAll('.lp-place-row[data-plan-id]').forEach((rowEl) => {
      const go = async () => {
        modal.close();
        await jumpToItem(rowEl.dataset.planId, rowEl.dataset.itemId);
      };
      rowEl.addEventListener('click', go);
      rowEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
    return modal;
  } catch (err) { toast(err.message, 'error'); }
}

// ===== 一鍵配艙建議（TRIAL → 確認才套用）=====
function suggestResultHtml(result, plan) {
  if (result.error) return `<div class="lp-sg-error">⛔ ${esc(result.error)}</div>`;
  const util = result.utilization || {};
  const pctText = value => (value === null || value === undefined ? '—' : `${value}%`);
  const warnings = (result.warnings || []).map(text => `<div class="lp-warn">⚠ ${esc(text)}</div>`).join('');
  const skipped = (result.skipped || []).slice(0, 6)
    .map(row => `<div class="lp-muted">・${esc(row.mawb || `#${row.id}`)}：${esc(row.reason)}</div>`).join('');
  const more = (result.skipped || []).length > 6
    ? `<div class="lp-muted">…另有 ${result.skipped.length - 6} 票</div>` : '';

  if (!result.pickedIds.length) {
    return `<div class="lp-sg-summary">${warnings}<div class="lp-muted">沒有可加入的貨</div>${skipped}${more}</div>`;
  }

  const rows = result.picked.map(item => `
    <label class="lp-sg-row">
      <input type="checkbox" class="lp-sg-pick" value="${item.id}" checked />
      <span class="lp-find-mawb">${esc(item.mawb || '—')}</span>
      <span>${esc(item.dest || '')}</span>
      <span>${esc(item.pkgs_text || '')}</span>
      <span class="num">${fmt(item.gross_weight, 2)} kg</span>
      <span class="num">${fmt(item.cbm, 3)} m³</span>
    </label>`).join('');

  return `
    <div class="lp-sg-summary">
      <div><b>建議加入 ${result.added.tickets} 票</b>${result.groupDest ? `（DEST ${esc(result.groupDest)}）` : ''}
        ｜ +${fmt(result.added.gw, 2)} kg ｜ +${fmt(result.added.cbm, 3)} m³</div>
      <div>加入後：G.W ${fmt(result.totals.gw, 0)}${plan.max_gross_weight ? ` / max ${fmt(plan.max_gross_weight, 0)}` : ''}（${pctText(util.gwPct)}）
        ｜ CBM ${fmt(result.totals.cbm, 2)}${plan.max_cbm ? ` / max ${fmt(plan.max_cbm, 2)}` : ''}（${pctText(util.cbmPct)}）
        ｜ 平均 ${pctText(util.avgPct)}</div>
      <div class="lp-muted">剩餘：${result.remaining.gw !== null ? `${fmt(result.remaining.gw, 2)} kg` : '—'} ｜ ${result.remaining.cbm !== null ? `${fmt(result.remaining.cbm, 3)} m³` : '—'}</div>
      ${warnings}${skipped}${more}
    </div>
    <div class="lp-sg-list">${rows}</div>
    <button type="button" class="lp-btn lp-btn-primary" id="lp-sg-apply">套用勾選的 ${result.added.tickets} 票</button>
  `;
}

async function applySuggestion(planId, ids, replaceExisting) {
  try {
    const entries = [];
    if (replaceExisting) {
      const existing = itemsOf(planId).map(item => item.id);
      if (existing.length && state.stock) {
        const res = await lpApi.addItems(state.stock.id, { item_ids: existing });
        (res.moved || []).forEach(m => entries.push({ id: m.item_id, fromPlanId: m.from_plan_id }));
      }
    }
    if (ids.length) {
      const res = await lpApi.addItems(planId, { item_ids: ids });
      (res.moved || []).forEach(m => entries.push({ id: m.item_id, fromPlanId: m.from_plan_id }));
    }
    if (entries.length) pushUndo({ type: 'move', entries });
    await loadAll();
    toast(`已套用 ${ids.length} 票${replaceExisting ? '（原有明細已移回存貨）' : ''}（可 Ctrl+Z 復原）`, 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

function openSuggestModal() {
  const plan = activePlan();
  if (!plan || plan.type === 'stock') { toast('請先選一張 PLAN', 'warn'); return; }
  const candidates = state.stockItems || [];
  if (!candidates.length) {
    toast('存貨是空的：先用「找/新增Booking」加入，或把其他 PLAN 的貨移出', 'warn');
    return;
  }

  const body = `
    <div class="lp-form lp-sg-form">
      <div class="lp-sg-grid">
        <label>上限 G.W (kg)
          <input id="lp-sg-gw" class="lp-input" type="number" step="0.01"
                 value="${plan.max_gross_weight != null ? plan.max_gross_weight : ''}" placeholder="例如 9000" />
        </label>
        <label>上限 CBM
          <input id="lp-sg-cbm" class="lp-input" type="number" step="0.001"
                 value="${plan.max_cbm != null ? plan.max_cbm : ''}" placeholder="例如 65" />
        </label>
        <label>模式
          <select id="lp-sg-mode" class="lp-input">
            ${LP_SUGGEST_MODES.map(m => `<option value="${m.code}">${esc(m.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="lp-check"><input type="checkbox" id="lp-sg-samedest" /> 同 DEST 優先</label>
      <label class="lp-check"><input type="checkbox" id="lp-sg-fixed" checked /> 保留現有明細（當作固定，只補剩餘容量）</label>
      <div class="lp-sg-actions">
        <button type="button" class="lp-btn lp-btn-primary" id="lp-sg-try">TRY 試算</button>
        <span class="lp-muted">只試算，不會寫入；確認後再按「套用」</span>
      </div>
    </div>
    <div id="lp-sg-result" class="lp-sg-result"><div class="lp-empty-sm">輸入上限後按 TRY</div></div>
  `;

  const modal = openModal({
    title: `配艙建議：${planLabel(plan)}`,
    body,
    className: 'lp-modal lp-modal-wide',
    actions: [{ label: '關閉', className: 'pill' }]
  });

  const runTry = () => {
    const result = lpSuggestLoad({
      candidates,
      fixed: document.getElementById('lp-sg-fixed').checked ? itemsOf(plan.id) : [],
      limits: {
        maxGrossWeight: document.getElementById('lp-sg-gw').value,
        maxCbm: document.getElementById('lp-sg-cbm').value
      },
      mode: document.getElementById('lp-sg-mode').value,
      sameDest: document.getElementById('lp-sg-samedest').checked
    });
    const target = document.getElementById('lp-sg-result');
    target.innerHTML = suggestResultHtml(result, plan);

    const applyBtn = document.getElementById('lp-sg-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', async () => {
        const ids = [...target.querySelectorAll('.lp-sg-pick:checked')]
          .map(box => Number(box.value)).filter(Boolean);
        const replaceExisting = !document.getElementById('lp-sg-fixed').checked;
        modal.close();
        await applySuggestion(plan.id, ids, replaceExisting);
      });
    }
    target.querySelectorAll('.lp-sg-pick').forEach((box) => {
      box.addEventListener('change', () => {
        const count = target.querySelectorAll('.lp-sg-pick:checked').length;
        const btn = document.getElementById('lp-sg-apply');
        if (btn) btn.textContent = `套用勾選的 ${count} 票`;
      });
    });
  };

  const tryBtn = document.getElementById('lp-sg-try');
  if (tryBtn) tryBtn.addEventListener('click', runTry);
  return modal;
}

// ===== Excel（TSV）：複製 / 貼上 =====
async function copyToExcel(ids) {
  const plan = planById(state.activePlanId);
  const items = itemsOf(state.activePlanId).filter(item => ids.includes(item.id));
  if (!items.length) { toast('沒有可複製的明細', 'warn'); return; }
  const tsv = lpBuildTsv(items, plan && plan.volume_view === 'cuft' ? 'cuft' : 'vol');
  try {
    await navigator.clipboard.writeText(tsv);
    toast(`已複製 ${items.length} 列（可直接貼到 Excel）`, 'ok');
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = tsv;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已複製（相容模式）', 'ok'); }
    catch (e2) { toast('複製失敗，請手動選取', 'error'); }
    ta.remove();
  }
}

function openPasteModal(text, preferredPlanId) {
  const parsed = lpParseTsv(text);
  if (!parsed.rows.length) { toast('剪貼簿沒有可用的表格資料', 'warn'); return; }

  const stockId = state.stock ? state.stock.id : null;
  const selected = preferredPlanId || state.activePlanId || stockId;
  const options = [
    ...(stockId ? [`<option value="${stockId}"${Number(selected) === Number(stockId) ? ' selected' : ''}>存貨</option>`] : []),
    ...flightPlans().map(p => `<option value="${p.id}"${Number(selected) === Number(p.id) ? ' selected' : ''}>${esc(planLabel(p))}</option>`)
  ].join('');

  const preview = parsed.rows.slice(0, 8).map(row => `
    <div class="lp-find-row">
      <span></span>
      <span class="lp-find-mawb">${esc(row.mawb || '—')}</span>
      <span>${esc(row.dest || '')}</span>
      <span>${esc(row.pkgs_text || '')}</span>
      <span>${esc(row.gross_weight != null ? row.gross_weight : '')}</span>
      <span>${esc(row.cbm != null ? row.cbm : '')}</span>
    </div>`).join('');

  const body = `
    <div class="lp-form">
      <label>貼到 <select id="lp-paste-target" class="lp-input">${options}</select></label>
      <p class="lp-muted">解析到 ${parsed.rows.length} 列${parsed.headerUsed ? '（有標題列，已自動對欄）' : '（無標題列，用固定欄位順序）'}${parsed.skipped ? `，略過 ${parsed.skipped} 列空白` : ''}</p>
    </div>
    <div class="lp-find-results">${preview}${parsed.rows.length > 8 ? `<div class="lp-empty-sm">…另有 ${parsed.rows.length - 8} 列</div>` : ''}</div>
  `;

  return openModal({
    title: '貼上 Excel 表格',
    body,
    className: 'lp-modal lp-modal-wide',
    actions: [
      {
        label: '貼上',
        className: 'pill btn-primary',
        onClick: async (modal) => {
          const planId = Number(document.getElementById('lp-paste-target').value);
          try {
            const res = await lpApi.bulkItems(planId, parsed.rows);
            modal.close();
            await loadAll();
            toast(`已貼上 ${Array.isArray(res.ids) ? res.ids.length : parsed.rows.length} 列`, 'ok');
          } catch (err) { toast(err.message, 'error'); }
        }
      },
      { label: '取消', className: 'pill' }
    ]
  });
}

async function pasteFromClipboard(planId) {
  try {
    const text = await navigator.clipboard.readText();
    openPasteModal(text, planId);
  } catch (err) {
    toast('瀏覽器不允許讀取剪貼簿，請用 Ctrl+V 貼上', 'warn');
  }
}

// ===== 匯出 / 列印 =====
function exportPlanXlsx(planId) {
  if (!planId) return;
  window.location.href = `/api/loading-plan/plans/${planId}/export.xlsx`;
}

async function printPlans() {
  const targets = flightPlans().map(p => p.id);
  targets.forEach(id => state.expanded.add(id));
  await Promise.all(targets.map(id => loadDetail(id).catch(() => null)));
  renderAll();
  setTimeout(() => window.print(), 200);
}

// ===== 事件綁定 =====
async function onClick(e) {
  hideRemark();
  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    const action = actionEl.dataset.action;
    if (action === 'select-item') {
      // Shift+點擊 → 從上一次點選的列到這一列「整段」選取／取消
      if (e.shiftKey && e.target && e.target.type === 'checkbox') {
        const row = e.target.closest('.lp-row');
        if (row && applyRangeSelection(e.target, row)) rangeHandledBox = e.target;
      }
      return;
    }
    e.preventDefault();
    switch (action) {
      case 'new-plan': openPlanModal(null); return;
      case 'edit-plan': { const p = activePlan(); if (p && p.type !== 'stock') openPlanModal(p); return; }
      // 封存／RECALL：封存清單切換（同一顆按鈕，is-on 表示目前在看封存清單）
      case 'toggle-archived': {
        state.showArchived = !state.showArchived;
        renderPlans();
        return;
      }
      case 'archive-plan': {
        const card = actionEl.closest('.lp-plan');
        if (card) await archivePlan(Number(card.dataset.planId));
        return;
      }
      case 'recall-plan': {
        const card = actionEl.closest('.lp-plan');
        if (card) await recallPlan(Number(card.dataset.planId));
        return;
      }
      case 'archived-plan':
        toast('這張 PLAN 已封存；按「♻ RECALL」即可取回繼續使用', 'warn');
        return;
      case 'refresh': await loadAll(); toast('已重新整理', 'ok'); return;
      case 'undo': await undo(); return;
      case 'add-selected': {
        const plan = activePlan();
        if (!plan || plan.type === 'stock') { toast('請先在右欄點選一張 PLAN', 'warn'); return; }
        await addToPlan(plan.id, [...state.selectedStock, ...state.selectedItems]);
        return;
      }
      case 'to-stock': await toStock(selectedIdList('items')); return;
      case 'copy-selected': openCopyTargetModal(selectedIdList('items')); return;
      case 'find-booking': openFindBookingModal(); return;
      case 'suggest': openSuggestModal(); return;
      case 'export-xlsx': {
        const p = activePlan();
        if (!p || p.type === 'stock') { toast('請先選一張 PLAN', 'warn'); return; }
        exportPlanXlsx(p.id);
        return;
      }
      case 'print': await printPlans(); return;
      case 'set-view': {
        await setVolumeView(actionEl.dataset.view);
        return;
      }
      case 'contour-spec': {
        const mod = await import('./contour.js');
        mod.openContourSpec(actionEl.dataset.contour);
        return;
      }
      case 'toggle-plan': {
        const card = actionEl.closest('.lp-plan');
        const id = Number(card.dataset.planId);
        const opened = toggleExpanded(id);
        setActivePlan(id);
        notifyPlanChange();
        if (opened) { try { await loadDetail(id); } catch (err) { toast(err.message, 'error'); } }
        renderAll();
        return;
      }
      case 'activate-plan': {
        const card = actionEl.closest('.lp-plan');
        setActivePlan(Number(card.dataset.planId));
        notifyPlanChange();
        renderAll();
        return;
      }
      default: return;
    }
  }
  const head = e.target.closest('.lp-plan-head');
  if (head) {
    setActivePlan(Number(head.closest('.lp-plan').dataset.planId));
    renderAll();
  }
}

function onChange(e) {
  const box = e.target.closest('input[data-action="select-item"]');
  if (!box) return;
  const row = box.closest('.lp-row');
  if (!row) return;
  // Shift 連續選取已在前面的 click 事件處理完，這裡只吞掉 change，不再 toggle 一次
  if (rangeHandledBox === box) {
    rangeHandledBox = null;
    return;
  }
  const planId = Number(row.dataset.planId);
  const isStock = state.stock && Number(state.stock.id) === planId;
  toggleSelection(isStock ? 'stock' : 'items', Number(row.dataset.itemId));
  row.classList.toggle('is-selected', box.checked);
  // 記住這一列，下一次 Shift+點擊才知道要從哪裡開始連選
  rangeAnchor = { planId, itemId: Number(row.dataset.itemId) };
  if (isStock) renderStock();
  renderToolbar();
}

function onDblClick(e) {
  const cell = e.target.closest('[data-field]');
  if (!cell) return;
  const row = cell.closest('.lp-row');
  if (!row) return;
  const planId = Number(row.dataset.planId);
  const item = itemsOf(planId).find(i => i.id === Number(row.dataset.itemId));
  if (item) { hideRemark(); startInlineEdit(cell, item); }
}

const debouncedStock = debounce(() => renderStock(), 120);
const debouncedPlan = debounce(() => renderPlans(), 120);

function onInput(e) {
  // CRD 手動輸入（DD／DDMMM／YYYY-MM-DD）→ 標記為 dirty，離開或 Enter 才驗證存檔
  const crd = crdInputOf(e.target);
  if (crd) {
    crd.dataset.crdDirty = '1';
    delete crd.dataset.crdAuto;
    setCrdInvalid(crd, lpCrdIssue(crd.value, crd.dataset.crdFlight || ''));
    return;
  }
  if (e.target.id === 'lp-stock-search') {
    state.searchStock = e.target.value;
    debouncedStock();
  } else if (e.target.id === 'lp-plan-search') {
    state.searchPlan = e.target.value;
    debouncedPlan();
  }
}

function onHover(e) {
  const target = e.target;
  // REMARK 格子：延遲 160ms 展開（避免滑過整排時一直閃）
  const remark = target && target.closest ? target.closest('.lp-c-tag[data-field="tag"]') : null;
  if (remark) {
    hideTip();
    hoverNode = null;
    clearTimeout(tipTimer);
    cancelHideRemark();
    if (remarkSuppressed || dimEditor) return;
    if (remarkCell !== remark) {
      remarkCell = remark;
      clearTimeout(remarkShowTimer);
      remarkShowTimer = setTimeout(() => showRemark(remark), 160);
    }
    return;
  }
  // 游標在展開面板內（面板掛在 body，不經過這裡）→ 保留
  if (remarkEl && remarkEl.contains(target)) { cancelHideRemark(); return; }
  if (remarkEl) scheduleHideRemark();

  const row = hoverErrorRow(target);
  if (!row) {
    if (hoverNode) { hoverNode = null; clearTimeout(tipTimer); hideTip(); }
    return;
  }
  if (row === hoverNode) return;
  hoverNode = row;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTip(row, row.dataset.hoverError), 200);
}

function onHoverOut(e) {
  const target = e.target;
  const remark = target && target.closest ? target.closest('.lp-c-tag[data-field="tag"]') : null;
  if (remark) {
    const to = e.relatedTarget;
    if (to && to.nodeType === 1 && remark.contains(to)) return;
    clearTimeout(remarkShowTimer);
    scheduleHideRemark();
    return;
  }
  const row = hoverErrorRow(target);
  if (!row) return;
  // 在「同一列」內部移動（例如 MAWB → CLIENT 格子）不算離開，避免 tooltip 閃爍
  if (hoverErrorRow(e.relatedTarget) === row) return;
  hoverNode = null;
  clearTimeout(tipTimer);
  hideTip();
}

function onKeyDown(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (e.key === 'Escape') {
    closeMenu();
    hideTip();
    hideRemark();
    closeDimEditor();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !typing && state.selectedItems.size) {
    const selectedText = window.getSelection ? String(window.getSelection()) : '';
    if (!selectedText) {
      e.preventDefault();
      copyToExcel(selectedIdList('items'));
    }
    return;
  }
  if (e.key === 'Delete' && !typing) {
    if (state.selectedItems.size) toStock(selectedIdList('items'));
    else if (state.selectedStock.size) hardDelete(selectedIdList('stock'));
  }
}

// 只有「執 PLAN」區塊是可見的時候才攔截貼上（避免影響其他頁面）
function isLoadingPlanVisible() {
  const section = document.getElementById('section-loading-plan');
  return !!section && section.classList.contains('active');
}

function onPaste(e) {
  if (!isLoadingPlanVisible()) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)
    || (document.activeElement && document.activeElement.isContentEditable);
  if (typing) return;
  if (document.querySelector('.app-modal-overlay')) return; // modal 開著時交給 modal
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
  e.preventDefault();
  openPasteModal(text, state.activePlanId);
}

export function setupInteractions(root) {
  setupDnd(root);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('dblclick', onDblClick);
  root.addEventListener('input', onInput);
  root.addEventListener('focusin', onCrdFocus);
  root.addEventListener('focusout', onCrdBlur);
  root.addEventListener('keydown', onCrdKeyDown);
  root.addEventListener('mouseover', onHover);
  root.addEventListener('mouseout', onHoverOut);
  root.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.lp-row[draggable="true"]');
    const planEl = e.target.closest('.lp-plan');
    if (!row && !planEl) return;
    if (e.target.closest('input, textarea')) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY, row, row ? null : planEl);
  });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('paste', onPaste);
  loadAll().finally(() => startRealtime({ reload: loadAll }));
  return { reload: loadAll };
}

// ===== 拖曳 =====
let dragPayload = null;
let dropTarget = null;   // { planId, rowEl, before }：記住放開時要插在哪一列的上／下

function clearDropStyles(root) {
  root.querySelectorAll('.is-drop, .is-dragging, .is-drop-above, .is-drop-below')
    .forEach(node => node.classList.remove('is-drop', 'is-dragging', 'is-drop-above', 'is-drop-below'));
}

function setupDnd(root) {
  root.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.lp-row[draggable="true"]');
    if (!row) return;
    if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
    const itemId = Number(row.dataset.itemId);
    const planId = Number(row.dataset.planId);
    const selected = selectionFor(planId);
    const ids = selected.includes(itemId) && selected.length > 1 ? selected : [itemId];
    dragPayload = { ids, fromPlanId: planId };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ids.join(','));
    row.classList.add('is-dragging');
  });

  root.addEventListener('dragend', () => {
    dragPayload = null;
    dropTarget = null;
    clearDropStyles(root);
  });

  root.addEventListener('dragover', (e) => {
    if (!dragPayload) return;
    // 已封存的 PLAN 不接受拖入（要先用 ♻ RECALL 取回）
    const planEl = e.target.closest('.lp-plan:not(.is-archived)');
    const stockCol = e.target.closest('.lp-col-stock');
    if (!planEl && !stockCol) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // 清掉上一個位置的高亮
    root.querySelectorAll('.is-drop-above, .is-drop-below').forEach(node => {
      node.classList.remove('is-drop-above', 'is-drop-below');
    });
    root.querySelectorAll('.lp-plan.is-drop, .lp-col-stock.is-drop').forEach(node => {
      if (node !== planEl && node !== stockCol) node.classList.remove('is-drop');
    });

    if (stockCol && !planEl) {
      stockCol.classList.add('is-drop');
      dropTarget = null;
      return;
    }
    if (!planEl) return;
    planEl.classList.add('is-drop');

    const rowEl = e.target.closest('.lp-row[data-item-id]');
    if (!rowEl) {
      dropTarget = { planId: Number(planEl.dataset.planId), rowEl: null, before: false };
      return;
    }
    const rect = rowEl.getBoundingClientRect();
    const before = (e.clientY - rect.top) <= rect.height / 2;
    rowEl.classList.add(before ? 'is-drop-above' : 'is-drop-below');
    dropTarget = { planId: Number(planEl.dataset.planId), rowEl, before };
  });

  root.addEventListener('dragleave', (e) => {
    const zone = e.target.closest('.lp-plan, .lp-col-stock');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('is-drop');
  });

  root.addEventListener('drop', async (e) => {
    if (!dragPayload) return;
    const planEl = e.target.closest('.lp-plan:not(.is-archived)');
    const stockCol = e.target.closest('.lp-col-stock');
    const targetPlanId = planEl
      ? Number(planEl.dataset.planId)
      : (stockCol && state.stock ? Number(state.stock.id) : null);
    const target = dropTarget;
    clearDropStyles(root);
    if (!targetPlanId) { dragPayload = null; dropTarget = null; return; }
    e.preventDefault();
    const { ids, fromPlanId } = dragPayload;
    dragPayload = null;
    dropTarget = null;

    // 拖到存貨欄：一律放尾端
    if (!planEl) {
      if (Number(targetPlanId) !== Number(fromPlanId)) await addToPlan(targetPlanId, ids);
      return;
    }
    // 同一張 PLAN → 只調整順序
    if (Number(targetPlanId) === Number(fromPlanId)) {
      await reorderWithinPlan(targetPlanId, ids, target);
      return;
    }
    // 跨 PLAN → Move 後再插到指定位置
    await moveAndInsert(targetPlanId, ids, target);
  });
}

// 同一張 plan 內排序（拖到某一列的上／下）
async function reorderWithinPlan(planId, ids, target) {
  const items = itemsOf(planId);
  const prevOrder = items.map(item => item.id);
  const anchorId = target && target.rowEl ? Number(target.rowEl.dataset.itemId) : null;
  if (anchorId && ids.includes(anchorId)) return;

  const ordered = lpMoveOrder(prevOrder, ids, anchorId, !!(target && target.before));
  if (ordered.join(',') === prevOrder.join(',')) return;

  try {
    await lpApi.reorder(planId, ordered);
    pushUndo({ type: 'reorder', planId, prevOrder });
    await loadAll();
    toast('已調整順序', 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

// 跨 plan：先 Move（附加尾端）→ 再 reorder 到目標位置
async function moveAndInsert(planId, ids, target) {
  try {
    const res = await lpApi.addItems(planId, { item_ids: ids });
    const entries = (res.moved || []).map(m => ({ id: m.item_id, fromPlanId: m.from_plan_id }));
    if (entries.length) pushUndo({ type: 'move', entries });

    const anchorId = target && target.rowEl ? Number(target.rowEl.dataset.itemId) : null;
    if (anchorId && !ids.includes(anchorId)) {
      const items = Array.isArray(res.items) ? res.items : [];
      const ordered = lpMoveOrder(items.map(item => item.id), ids, anchorId, !!target.before);
      await lpApi.reorder(planId, ordered);
    }

    await loadAll();
    toast(`已加入 ${entries.length || (res.added || []).length} 票`, 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

export function openPlanModal(plan) {
  const isEdit = !!plan;
  const body = `
    <div class="lp-form">
      <label>日碼 <input id="lp-f-day" class="lp-input" placeholder="D7 / OTH" value="${esc(plan && plan.day_code)}" /></label>
      <label>航班 <input id="lp-f-flight" class="lp-input" placeholder="EK9859" value="${esc(plan && plan.flight_no)}" /></label>
      <label>Flight Date <input id="lp-f-date" class="lp-input" type="date" value="${esc(toDateValue(plan && plan.flight_date))}" title="點一下可從日曆選日期" /></label>
      <label>ETD <input id="lp-f-etd" class="lp-input" placeholder="22:35" value="${esc(plan && plan.etd)}" /></label>
      <label>Owner <input id="lp-f-owner" class="lp-input" placeholder="SKY DRAGON" value="${esc(plan && plan.owner_company)}" /></label>
      <label>Contour <input id="lp-f-contour" class="lp-input" placeholder="1 X H3" value="${esc(plan && plan.contour_text)}" /></label>
      <label>上限 G.W (kg) <input id="lp-f-maxgw" class="lp-input" type="number" step="0.01" value="${plan && plan.max_gross_weight != null ? plan.max_gross_weight : ''}" /></label>
      <label>上限 CBM <input id="lp-f-maxcbm" class="lp-input" type="number" step="0.001" value="${plan && plan.max_cbm != null ? plan.max_cbm : ''}" /></label>
    </div>
  `;
  const modal = openModal({
    title: isEdit ? '編輯 PLAN' : '新增 PLAN',
    body,
    className: 'lp-modal',
    actions: [
      {
        label: isEdit ? '儲存' : '建立',
        className: 'pill btn-primary',
        onClick: async (m) => {
          const payload = {
            day_code: document.getElementById('lp-f-day').value,
            flight_no: document.getElementById('lp-f-flight').value,
            flight_date: normalizeDateInput(document.getElementById('lp-f-date').value),
            etd: document.getElementById('lp-f-etd').value,
            owner_company: document.getElementById('lp-f-owner').value,
            contour_text: document.getElementById('lp-f-contour').value,
            max_gross_weight: document.getElementById('lp-f-maxgw').value,
            max_cbm: document.getElementById('lp-f-maxcbm').value
          };
          try {
            if (isEdit) await lpApi.patchPlan(plan.id, payload);
            else {
              const res = await lpApi.createPlan(payload);
              if (res && res.data) setActivePlan(res.data.id);
            }
            m.close();
            await loadAll();
            toast(isEdit ? 'PLAN 已更新' : 'PLAN 已建立', 'ok');
          } catch (err) { toast(err.message, 'error'); }
        }
      },
      { label: '取消', className: 'pill' }
    ]
  });
  const first = document.getElementById('lp-f-day');
  if (first) first.focus();
  return modal;
}
