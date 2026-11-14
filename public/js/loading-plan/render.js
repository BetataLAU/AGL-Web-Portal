// ===== 執 PLAN：畫面渲染（三欄工作台）=====
import { LOADSIM_ULD_SPECS } from '../loadsim/uld-specs.js';
import { lpResolveContourCode } from './calc.js';
import { state, planLabel, itemsOf, flightPlans, activePlan, isExpanded, fmt, fmtInt } from './state.js';
import { esc, ownerColor } from './dom.js';

export const SPEC_CODES = LOADSIM_ULD_SPECS.map(s => s.code);

const DG_FIELDS = [
  ['dg_no_power', '無電'], ['dg_966', '966'], ['dg_967', '967'], ['dg_969', '969'], ['dg_970', '970']
];
const HANDLING_FIELDS = [
  ['h_af', 'AF'], ['h_fs', 'FS'], ['h_sc', 'SC'], ['h_vol', 'Vol'], ['h_ctg', 'CTG'], ['h_xray', 'X-ray']
];

export function layoutHtml() {
  return `
    <div class="lp-toolbar">
      <div class="lp-toolbar-left">
        <input type="search" id="lp-plan-search" class="lp-input" placeholder="搜尋 Plan（Flight / Date / Owner）" autocomplete="off" />
        <span class="lp-count" id="lp-plan-count"></span>
      </div>
      <div class="lp-toolbar-right">
        <span class="lp-online" id="lp-online" title="線上使用者"></span>
        <span class="lp-conn" id="lp-conn" title="即時同步狀態">● 未連線</span>
        <button type="button" class="lp-btn" data-action="undo" id="lp-btn-undo" title="復原上一個操作 (Ctrl+Z)">↶ Undo</button>
        <button type="button" class="lp-btn" data-action="refresh">⟳ 重新整理</button>
        <button type="button" class="lp-btn lp-btn-primary" data-action="new-plan">＋ 新 PLAN</button>
      </div>
    </div>
    <div class="lp-layout">
      <aside class="lp-col lp-col-stock">
        <header class="lp-col-head">
          <span>📦 存貨</span>
          <span class="lp-count" id="lp-stock-count"></span>
        </header>
        <div class="lp-stock-tools">
          <input type="search" id="lp-stock-search" class="lp-input" placeholder="搜尋存貨（MAWB / 客戶 / DEST）" autocomplete="off" />
          <button type="button" class="lp-btn lp-btn-sm" data-action="find-booking" title="從 Booking 主檔找貨加入">🔍 找 Booking</button>
        </div>
        <div class="lp-stock-list" id="lp-stock-list"></div>
        <footer class="lp-stock-foot" id="lp-stock-summary"></footer>
      </aside>

      <section class="lp-col lp-col-kpi">
        <div class="lp-kpi" id="lp-kpi"></div>
      </section>

      <section class="lp-col lp-col-plans">
        <header class="lp-col-head">
          <span>🧱 PLANS</span>
          <span class="lp-count" id="lp-plans-total"></span>
        </header>
        <div class="lp-plan-list" id="lp-plan-list"></div>
      </section>
    </div>
  `;
}

export function renderLayout(root) {
  root.innerHTML = layoutHtml();
}

// ===== TAG =====
export function contourTag(plan) {
  const raw = String((plan && plan.contour_code) || '').trim();
  if (!raw) return '';
  const resolved = lpResolveContourCode(raw, SPEC_CODES);
  const qty = Number(plan.contour_qty) || 1;
  const label = qty > 1 ? `${qty} × ${resolved.code}` : resolved.code;
  const cls = resolved.known ? 'lp-tag lp-tag-contour' : 'lp-tag lp-tag-contour is-unknown';
  const title = resolved.known ? '點擊查看板型規格' : '系統未收錄這個板型（可手動輸入上限）';
  return `<button type="button" class="${cls}" data-action="contour-spec" data-contour="${esc(resolved.code)}" title="${title}">${esc(label)}${resolved.known ? '' : ' ?'}</button>`;
}

export function ownerTag(plan) {
  const owner = String((plan && plan.owner_company) || '').trim();
  if (!owner) return '';
  return `<span class="lp-tag lp-tag-owner" style="--lp-owner:${ownerColor(owner)}">${esc(owner)}</span>`;
}

export function dayTag(plan) {
  const day = String((plan && plan.day_code) || '').trim();
  if (!day) return '';
  return `<span class="lp-tag lp-tag-day">${esc(day)}</span>`;
}

function flagTags(item) {
  const tags = [];
  DG_FIELDS.forEach(([key, label]) => { if (Number(item[key])) tags.push(label); });
  HANDLING_FIELDS.forEach(([key, label]) => { if (Number(item[key])) tags.push(label); });
  if (!tags.length) return '';
  return `<span class="lp-flags" title="${esc(tags.join(' / '))}">${esc(tags.join('·'))}</span>`;
}

export function rowHead(view) {
  return `
    <div class="lp-row lp-row-head">
      <span class="lp-c-sel"></span>
      <span class="lp-c-idx">#</span>
      <span class="lp-c-mawb">MAWB</span>
      <span class="lp-c-client">CLIENT</span>
      <span class="lp-c-dest">DEST</span>
      <span class="lp-c-pkgs">PKGS</span>
      <span class="lp-c-gw">G.W</span>
      <span class="lp-c-vol">${view === 'cuft' ? 'cu.ft' : 'VOL'}</span>
      <span class="lp-c-cbm">CBM</span>
      <span class="lp-c-tag">TAG</span>
    </div>
  `;
}

export function itemRow(item, plan, index, options = {}) {
  const view = (plan && plan.volume_view) === 'cuft' ? 'cuft' : 'vol';
  const volume = item.volume || {};
  const volValue = view === 'cuft' ? volume.cuft : volume.vol;
  const selected = (options.selectedSet || state.selectedItems).has(item.id);
  const missingMawb = !String(item.mawb || '').trim();
  const dup = !!item.split_of_item_id;
  return `
    <div class="lp-row${selected ? ' is-selected' : ''}${missingMawb ? ' is-warn' : ''}${dup ? ' is-dup' : ''}"
         draggable="true" data-item-id="${item.id}" data-plan-id="${plan.id}"
         ${item.mawb ? `data-hover-mawb="${esc(item.mawb)}"` : ''}>
      <span class="lp-c-sel"><input type="checkbox" data-action="select-item" ${selected ? 'checked' : ''} /></span>
      <span class="lp-c-idx">${index + 1}</span>
      <span class="lp-c-mawb" data-field="mawb" title="雙擊編輯">
        ${item.mawb ? esc(item.mawb) : '<span class="lp-warn">缺 MAWB</span>'}${dup ? '<span class="lp-dup" title="重複 MAWB（複製）">⧉</span>' : ''}
      </span>
      <span class="lp-c-client" data-field="client">${esc(item.client || '')}</span>
      <span class="lp-c-dest" data-field="dest">${esc(item.dest || '')}</span>
      <span class="lp-c-pkgs" data-field="pkgs_text">${pcsText(item)}</span>
      <span class="lp-c-gw num" data-field="gross_weight">${fmt(item.gross_weight, 2)}</span>
      <span class="lp-c-vol num" data-field="${view === 'cuft' ? 'cuft' : 'volume_weight'}">${fmt(volValue, 2)}</span>
      <span class="lp-c-cbm num" data-field="cbm">${fmt(item.cbm, 3)}</span>
      <span class="lp-c-tag" data-field="tag">${esc(item.tag || '')}${flagTags(item)}</span>
    </div>
  `;
}

// ===== KPI 面板 =====
function bar(label, valueText, pct, over) {
  const width = pct === null || pct === undefined ? 0 : Math.max(0, Math.min(100, Number(pct)));
  const cls = over ? ' is-over' : (width >= 90 ? ' is-warn' : '');
  return `
    <div class="lp-bar${cls}">
      <div class="lp-bar-label"><span>${esc(label)}</span><b>${valueText}</b></div>
      <div class="lp-bar-track"><i style="width:${width}%"></i></div>
    </div>
  `;
}

function aggregateTotals() {
  const totals = { tickets: 0, grossWeight: 0, cbm: 0, vol: 0, cuft: 0, pcs: 0, overWeight: 0, overCbm: 0 };
  flightPlans().forEach((plan) => {
    const t = plan.totals || {};
    totals.tickets += Number(t.tickets || 0);
    totals.grossWeight += Number(t.grossWeight || 0);
    totals.cbm += Number(t.cbm || 0);
    totals.vol += Number(t.vol || 0);
    totals.cuft += Number(t.cuft || 0);
    totals.pcs += Number(t.pcs || 0);
    totals.overWeight += Number(t.overWeight || 0);
    totals.overCbm += Number(t.overCbm || 0);
  });
  return totals;
}

export function renderKpi() {
  const node = document.getElementById('lp-kpi');
  if (!node) return;
  const undoBtn = document.getElementById('lp-btn-undo');
  if (undoBtn) undoBtn.disabled = state.undoStack.length === 0;

  const plan = activePlan();
  const hasSelection = state.selectedItems.size > 0;
  const hasStockSelection = state.selectedStock.size > 0;

  if (!plan || plan.type === 'stock') {
    const totals = aggregateTotals();
    node.innerHTML = `
      <div class="lp-kpi-head">
        <div class="lp-kpi-title">全部航班 <span class="lp-count">${flightPlans().length} 張 plan</span></div>
        <div class="lp-kpi-sub">點一張 PLAN 看 KPI；也可直接把左欄存貨拖到 PLAN</div>
      </div>
      <div class="lp-kpi-bars">
        ${bar('G.W 總計', `${fmt(totals.grossWeight, 0)} kg`, null, false)}
        ${bar('CBM 總計', `${fmt(totals.cbm, 2)} m³`, null, false)}
        ${bar('體積重 VOL', `${fmt(totals.vol, 0)} kg`, null, false)}
      </div>
      <div class="lp-kpi-meta">${fmtInt(totals.tickets)} 票 ｜ ${fmtInt(totals.pcs)} 件
        ${totals.overWeight > 0 ? `<span class="lp-warn">⛔ 超重合計 ${fmt(totals.overWeight, 0)} kg</span>` : ''}
        ${totals.overCbm > 0 ? `<span class="lp-warn">⛔ 超 CBM ${fmt(totals.overCbm, 2)}</span>` : ''}
      </div>
      <div class="lp-kpi-actions">
        <button type="button" class="lp-btn" data-action="add-selected" ${hasStockSelection ? '' : 'disabled'}>▶ 加入所選（${state.selectedStock.size}）</button>
        <button type="button" class="lp-btn" data-action="undo" ${state.undoStack.length ? '' : 'disabled'}>↶ Undo</button>
        <button type="button" class="lp-btn lp-btn-primary" data-action="new-plan">＋ 新 PLAN</button>
      </div>
      <div class="lp-kpi-hint">💡 拖曳：左欄 → PLAN 卡片；PLAN 明細 → 另一張 PLAN 或存貨</div>
    `;
    return;
  }

  const totals = plan.totals || {};
  const maxGw = totals.maxGrossWeight;
  const maxCbm = totals.maxCbm;
  const overWeight = Number(totals.overWeight || 0);
  const overCbm = Number(totals.overCbm || 0);
  const view = plan.volume_view === 'cuft' ? 'cuft' : 'vol';

  node.innerHTML = `
    <div class="lp-kpi-head">
      <div class="lp-kpi-title">${esc(planLabel(plan))}</div>
      <div class="lp-kpi-sub">
        ${dayTag(plan)}${contourTag(plan)}${ownerTag(plan)}
        <span class="lp-count">${plan.status === 'locked' ? '🔒 已鎖定' : plan.status === 'confirmed' ? '✅ 已確認' : '草稿'}</span>
      </div>
    </div>
    <div class="lp-kpi-bars">
      ${bar('G.W', `${fmt(totals.grossWeight, 0)}${maxGw ? ` / ${fmt(maxGw, 0)}` : ''} kg`, totals.gwPct, overWeight > 0)}
      ${bar('CBM', `${fmt(totals.cbm, 2)}${maxCbm ? ` / ${fmt(maxCbm, 2)}` : ''} m³`, totals.cbmPct, overCbm > 0)}
      ${bar(view === 'cuft' ? 'cu.ft' : 'VOL', view === 'cuft' ? `${fmt(totals.cuft, 0)} cu.ft` : `${fmt(totals.vol, 0)} kg`, null, false)}
    </div>
    <div class="lp-kpi-meta">
      ${fmtInt(totals.tickets)} 票 ｜ ${fmtInt(totals.pcs)} 件
      ${totals.pcsIncomplete ? `<span class="lp-warn">⚠ ${totals.pcsIncomplete} 票件數未填</span>` : ''}
      ${totals.missingMawb ? `<span class="lp-warn">⚠ ${totals.missingMawb} 票缺 MAWB</span>` : ''}
      ${overWeight > 0 ? `<span class="lp-warn">⛔ 超重 ${fmt(overWeight, 2)} kg</span>` : ''}
      ${overCbm > 0 ? `<span class="lp-warn">⛔ 超 CBM ${fmt(overCbm, 3)}</span>` : ''}
    </div>
    <div class="lp-kpi-actions">
      <button type="button" class="lp-btn" data-action="add-selected" ${(hasStockSelection || hasSelection) ? '' : 'disabled'}>▶ 加入所選</button>
      <button type="button" class="lp-btn" data-action="to-stock" ${hasSelection ? '' : 'disabled'}>◀ 移出到存貨</button>
      <button type="button" class="lp-btn" data-action="copy-selected" ${hasSelection ? '' : 'disabled'}>⧉ 複製到…</button>
      <button type="button" class="lp-btn" data-action="suggest">🧮 配艙建議</button>
      <button type="button" class="lp-btn" data-action="export-xlsx">⬇ Excel</button>
      <button type="button" class="lp-btn" data-action="print">🖨 列印</button>
      <button type="button" class="lp-btn" data-action="edit-plan">✎ 編輯 PLAN</button>
      <button type="button" class="lp-btn" data-action="undo" ${state.undoStack.length ? '' : 'disabled'}>↶ Undo</button>
    </div>
    <div class="lp-kpi-hint">體積顯示：<button type="button" class="lp-link${view === 'vol' ? ' is-on' : ''}" data-action="set-view" data-view="vol">VOL / CBM</button> ·
      <button type="button" class="lp-link${view === 'cuft' ? ' is-on' : ''}" data-action="set-view" data-view="cuft">cu.ft / CBM</button></div>
  `;
}

// ===== PLAN 卡片 =====
function pcsText(item) {
  if (item.pcs_total === null || item.pcs_total === undefined) {
    return `<span class="lp-warn" title="件數未填">${esc(item.pkgs_text || '—')} ⚠</span>`;
  }
  return esc(item.pkgs_text || item.pcs_total);
}

function miniKpi(plan) {
  const t = plan.totals || {};
  const overW = Number(t.overWeight || 0);
  const overC = Number(t.overCbm || 0);
  const gwText = t.maxGrossWeight
    ? `${fmt(t.grossWeight, 0)} / ${fmt(t.maxGrossWeight, 0)}`
    : fmt(t.grossWeight, 0);
  const cbmText = t.maxCbm ? `${fmt(t.cbm, 2)} / ${fmt(t.maxCbm, 2)}` : fmt(t.cbm, 2);
  return `
    <span class="lp-mini${overW ? ' is-over' : (Number(t.gwPct) >= 90 ? ' is-warn' : '')}" title="G.W">${gwText} kg${overW ? ` ⛔+${fmt(overW, 0)}` : ''}</span>
    <span class="lp-mini${overC ? ' is-over' : (Number(t.cbmPct) >= 90 ? ' is-warn' : '')}" title="CBM">${cbmText} m³${overC ? ` ⛔+${fmt(overC, 2)}` : ''}</span>
    <span class="lp-mini">${fmtInt(t.tickets)} 票 ｜ ${fmtInt(t.pcs)} 件</span>
    ${t.pcsIncomplete ? `<span class="lp-mini is-warn" title="件數未填">⚠ ${t.pcsIncomplete}</span>` : ''}
  `;
}

export function planCard(plan) {
  const expanded = isExpanded(plan.id);
  const active = Number(state.activePlanId) === Number(plan.id);
  const items = itemsOf(plan.id);
  const view = plan.volume_view === 'cuft' ? 'cuft' : 'vol';
  return `
    <article class="lp-plan${active ? ' is-active' : ''}" data-plan-id="${plan.id}">
      <header class="lp-plan-head" data-action="activate-plan">
        <div class="lp-plan-title-row">
          <span class="lp-plan-title" title="${esc(planLabel(plan))}">${esc(planLabel(plan))}</span>
          <span class="lp-plan-badges">${dayTag(plan)}${contourTag(plan)}${ownerTag(plan)}</span>
          <button type="button" class="lp-icon-btn" data-action="toggle-plan" title="${expanded ? '收合' : '展開明細'}">${expanded ? '▾' : '▸'}</button>
        </div>
        <div class="lp-plan-kpi-row">${miniKpi(plan)}</div>
      </header>
      ${expanded ? `
        <div class="lp-plan-body">
          ${rowHead(view)}
          ${items.length ? items.map((item, index) => itemRow(item, plan, index)).join('') : '<div class="lp-empty-sm">沒有明細（把左欄存貨拖進來）</div>'}
        </div>
      ` : ''}
    </article>
  `;
}

export function renderPlans() {
  const list = document.getElementById('lp-plan-list');
  if (!list) return;
  const needle = String(state.searchPlan || '').toLowerCase();
  const plans = flightPlans().filter((plan) => {
    if (!needle) return true;
    return [planLabel(plan), plan.plan_no, plan.day_code, plan.contour_code]
      .map(v => String(v || '').toLowerCase()).join(' ').includes(needle);
  }).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  list.innerHTML = plans.length
    ? plans.map(planCard).join('')
    : `<div class="lp-empty">${state.plans.length ? '沒有符合的 PLAN' : '還沒有 PLAN，按右上角「＋ 新 PLAN」開始'}</div>`;

  const totalEl = document.getElementById('lp-plans-total');
  if (totalEl) totalEl.textContent = `${flightPlans().length} 張`;
  const countEl = document.getElementById('lp-plan-count');
  if (countEl) countEl.textContent = state.searchPlan ? `${plans.length} / ${flightPlans().length}` : '';
}

export function renderAll() {
  renderStock();
  renderKpi();
  renderPlans();
  applyPresence();
  updateOnline();
}

export function setConnState(text, type = 'idle') {
  const node = document.getElementById('lp-conn');
  if (!node) return;
  node.textContent = text;
  node.dataset.state = type;
  state.connState = type;
}

// ===== Presence 顯示 =====
export function updateOnline() {
  const node = document.getElementById('lp-online');
  if (!node) return;
  const list = Array.isArray(state.presence) ? state.presence : [];
  const names = [...new Set(list.map(p => p.display || p.user_id).filter(Boolean))];
  node.textContent = names.length ? `👥 ${names.length}` : '';
  node.title = names.length ? names.join('、') : '暫時沒有其他人在線';
}

// 別人正在編輯的格子 → 淡黃底＋✎（不硬鎖，避免卡死）
export function applyPresence() {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  const locks = new Map();
  (Array.isArray(state.presence) ? state.presence : []).forEach((p) => {
    if (p && p.editing_item_id) locks.set(Number(p.editing_item_id), p.display || p.user_id || '有人');
  });
  document.querySelectorAll('.lp-row[data-item-id]').forEach((row) => {
    const by = locks.get(Number(row.dataset.itemId));
    if (by) {
      row.classList.add('is-locked');
      row.dataset.lock = `${by} 正在編輯`;
      row.title = `${by} 正在編輯這筆`;
    } else {
      row.classList.remove('is-locked');
      delete row.dataset.lock;
      row.removeAttribute('title');
    }
  });
}

function stockMatches(item, needle) {
  if (!needle) return true;
  return [item.mawb, item.client, item.dest, item.tag, item.remark, item.pkgs_text]
    .map(v => String(v || '').toLowerCase()).join(' ').includes(needle);
}

export function renderStock() {
  const list = document.getElementById('lp-stock-list');
  if (!list) return;
  const needle = String(state.searchStock || '').toLowerCase();
  const all = state.stockItems || [];
  const items = all.filter(item => stockMatches(item, needle));
  const selected = state.selectedStock;

  list.innerHTML = items.length
    ? items.map((item, index) => itemRow(item, state.stock, index, { selectedSet: selected })).join('')
    : `<div class="lp-empty-sm">${all.length ? '沒有符合的存貨' : '存貨是空的（可從 PLAN 移出，或按「找 Booking」加入）'}</div>`;

  const countEl = document.getElementById('lp-stock-count');
  if (countEl) countEl.textContent = `${items.length} 筆`;

  const summaryEl = document.getElementById('lp-stock-summary');
  if (summaryEl) {
    const pool = selected.size ? items.filter(i => selected.has(i.id)) : items;
    const gw = pool.reduce((sum, i) => sum + Number(i.gross_weight || 0), 0);
    const cbm = pool.reduce((sum, i) => sum + Number(i.cbm || 0), 0);
    summaryEl.innerHTML = selected.size
      ? `已選 <b>${selected.size}</b> 票 ｜ Σ ${fmt(gw, 2)} kg ｜ ${fmt(cbm, 3)} m³`
      : `共 ${items.length} 票 ｜ Σ ${fmt(gw, 2)} kg ｜ ${fmt(cbm, 3)} m³`;
  }
}

