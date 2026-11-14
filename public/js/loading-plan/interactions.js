// ===== 執 PLAN：互動（拖曳 / 右鍵選單 / 剪貼簿 / Undo / 就地編輯）=====
import { lpApi } from './api.js';
import {
  state, planById, planLabel, activePlan, itemsOf, flightPlans,
  setActivePlan, toggleExpanded, toggleSelection, clearSelection, selectedIdList, pushUndo, fmt
} from './state.js';
import { renderAll, renderStock, renderToolbar, renderPlans } from './render.js';
import { esc, toast, debounce } from './dom.js';
import { lpVolFromCbm, lpCuftFromCbm } from './calc.js';
import { lpParseTsv, lpBuildTsv } from './paste.js';
import { lpSuggestLoad, LP_SUGGEST_MODES } from './suggest.js';
import { lpMoveOrder } from './order.js';
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
    const [plansRes, stockRes] = await Promise.all([lpApi.plans(), lpApi.stock()]);
    state.plans = plansRes.data || [];
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

function toDateInput(value) {
  const text = String(value || '').trim();
  return text ? text.replace(/-/g, '/') : '';
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

async function setPlanView(planId, view) {
  try {
    await lpApi.patchPlan(planId, { volume_view: view });
    await loadAll();
  } catch (err) { toast(err.message, 'error'); }
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
    if (item && item.mawb) defs.push({ label: '📍 查看所有位置', fn: () => showPlacements(item.mawb) });
  } else if (planEl && planEl.dataset.planId) {
    if (state.clipboard) defs.push({ label: '📋 貼上到這張 PLAN', fn: () => pasteInto(planId) });
    defs.push({ label: '📥 貼上 Excel（TSV）', fn: () => pasteFromClipboard(planId) });
    defs.push({ label: '✎ 編輯 PLAN', fn: () => openPlanModal(planById(planId)) });
    defs.push({ divider: true });
    defs.push({ label: '🗑 刪除 PLAN', fn: () => deletePlan(planId) });
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
document.addEventListener('scroll', closeMenu, true);

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
  const input = document.createElement('input');
  input.className = 'lp-inline-input';
  input.value = raw === null || raw === undefined ? '' : String(raw);
  const original = cell.innerHTML;
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();
  setEditingItem(item.id);
  let done = false;

  const finish = async (commit) => {
    if (done) return;
    done = true;
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
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
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
    <div class="lp-form">
      <label>加入到 <select id="lp-find-target" class="lp-input">${targets}</select></label>
      <input id="lp-find-search" class="lp-input" placeholder="輸入 MAWB / 客戶 / DEST（即時搜尋）" autocomplete="off" />
    </div>
    <div class="lp-find-results" id="lp-find-results"><div class="lp-empty-sm">輸入關鍵字開始搜尋</div></div>
  `;
  const modal = openModal({
    title: '找 Booking 加入',
    body,
    className: 'lp-modal lp-modal-wide',
    actions: [
      {
        label: '加入所選',
        className: 'pill btn-primary',
        onClick: async (m) => {
          const ids = [...document.querySelectorAll('#lp-find-results input[type="checkbox"]:checked')]
            .map(box => Number(box.value)).filter(Boolean);
          if (!ids.length) { toast('請先勾選 Booking', 'warn'); return; }
          const target = document.getElementById('lp-find-target').value;
          const planId = target === 'stock' ? (state.stock ? state.stock.id : null) : Number(target);
          if (!planId) { toast('找不到目標', 'error'); return; }
          m.close();
          await addRecords(planId, ids);
        }
      },
      { label: '取消', className: 'pill' }
    ]
  });

  const resultsEl = document.getElementById('lp-find-results');
  const runSearch = debounce(async () => {
    const input = document.getElementById('lp-find-search');
    if (!input || !resultsEl) return;
    const query = input.value.trim();
    if (!query) { resultsEl.innerHTML = '<div class="lp-empty-sm">輸入關鍵字開始搜尋</div>'; return; }
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
    } catch (err) { resultsEl.innerHTML = `<div class="lp-empty-sm">${esc(err.message)}</div>`; }
  }, 200);

  const input = document.getElementById('lp-find-search');
  if (input) {
    input.addEventListener('input', runSearch);
    input.focus();
  }
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
async function showPlacements(mawb) {
  try {
    const res = await lpApi.placements({ mawb });
    const list = res.data || [];
    const body = list.length
      ? `<div class="lp-form">${list.map(p => `<div class="lp-find-row"><span class="lp-find-mawb">${esc(p.label)}</span><span>#${p.section || 1}</span><span>${esc(p.plan_no || '')}</span></div>`).join('')}</div>`
      : '<div class="lp-empty-sm">只在這一個位置</div>';
    openModal({ title: `位置：${esc(mawb)}`, body, className: 'lp-modal' });
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
      <div>加入後：G.W ${fmt(result.totals.gw, 0)}${plan.max_gross_weight ? ` / ${fmt(plan.max_gross_weight, 0)}` : ''}（${pctText(util.gwPct)}）
        ｜ CBM ${fmt(result.totals.cbm, 2)}${plan.max_cbm ? ` / ${fmt(plan.max_cbm, 2)}` : ''}（${pctText(util.cbmPct)}）
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
    toast('存貨是空的：先用「找 Booking」加入，或把其他 PLAN 的貨移出', 'warn');
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
  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    const action = actionEl.dataset.action;
    if (action === 'select-item') return;
    e.preventDefault();
    switch (action) {
      case 'new-plan': openPlanModal(null); return;
      case 'edit-plan': { const p = activePlan(); if (p && p.type !== 'stock') openPlanModal(p); return; }
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
        const p = activePlan();
        if (!p || p.type === 'stock') { toast('請先點選一張 PLAN 再切換體積顯示', 'warn'); return; }
        await setPlanView(p.id, actionEl.dataset.view);
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
  const planId = Number(row.dataset.planId);
  const isStock = state.stock && Number(state.stock.id) === planId;
  toggleSelection(isStock ? 'stock' : 'items', Number(row.dataset.itemId));
  row.classList.toggle('is-selected', box.checked);
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
  if (item) startInlineEdit(cell, item);
}

const debouncedStock = debounce(() => renderStock(), 120);
const debouncedPlan = debounce(() => renderPlans(), 120);

function onInput(e) {
  if (e.target.id === 'lp-stock-search') {
    state.searchStock = e.target.value;
    debouncedStock();
  } else if (e.target.id === 'lp-plan-search') {
    state.searchPlan = e.target.value;
    debouncedPlan();
  }
}

function onHover(e) {
  const row = hoverErrorRow(e.target);
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
  const row = hoverErrorRow(e.target);
  if (!row) return;
  // 在「同一列」內部移動（例如 MAWB → CLIENT 格子）不算離開，避免 tooltip 閃爍
  if (hoverErrorRow(e.relatedTarget) === row) return;
  hoverNode = null;
  clearTimeout(tipTimer);
  hideTip();
}

function onKeyDown(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (e.key === 'Escape') { closeMenu(); hideTip(); return; }
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
    const planEl = e.target.closest('.lp-plan');
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
    const planEl = e.target.closest('.lp-plan');
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
      <label>Flight Date <input id="lp-f-date" class="lp-input" placeholder="2026/11/14" value="${esc(toDateInput(plan && plan.flight_date))}" /></label>
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
