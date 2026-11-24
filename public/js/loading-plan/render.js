// ===== 執 PLAN：畫面渲染（存貨＋PLANS 雙欄工作台）=====
import { LOADSIM_ULD_SPECS } from '../loadsim/uld-specs.js';
import { lpResolveContourCode, lpCuftFromCbm, lpCrdIssue, lpFormatCrd } from './calc.js';
import { state, planLabel, itemsOf, flightPlans, archivedFlightPlans, activePlan, isExpanded, fmt, fmtInt } from './state.js';
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
        <span class="lp-view-toggle" role="group" aria-label="體積顯示切換">
          <button type="button" class="lp-view-btn is-on" data-action="set-view" data-view="vol"
                  aria-pressed="true" title="體積顯示 VOL（體積重 kg）／CBM（m³）">VOL / CBM</button>
          <button type="button" class="lp-view-btn" data-action="set-view" data-view="cuft"
                  aria-pressed="false" title="體積顯示 cu.ft（ft³）／CBM（m³）">cu.ft / CBM</button>
        </span>
        <button type="button" class="lp-btn" data-action="add-selected" id="lp-btn-add-selected" disabled>▶ 加入所選</button>
        <button type="button" class="lp-btn" data-action="to-stock" disabled>◀ 移出到存貨</button>
        <button type="button" class="lp-btn" data-action="copy-selected" disabled>⧉ 複製到…</button>
        <button type="button" class="lp-btn" data-action="suggest" disabled>🧮 配艙建議</button>
        <button type="button" class="lp-btn" data-action="export-xlsx" disabled>⬇ Excel</button>
        <button type="button" class="lp-btn" data-action="print">🖨 列印</button>
        <button type="button" class="lp-btn" data-action="edit-plan" disabled>✎ 編輯 PLAN</button>
        <button type="button" class="lp-btn" data-action="undo" id="lp-btn-undo" title="復原上一個操作 (Ctrl+Z)" disabled>↶ Undo</button>
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
          <button type="button" class="lp-btn lp-btn-sm" data-action="find-booking" title="找現有 Booking 或新增 Booking">🔍 找/新增Booking</button>
        </div>
        <div class="lp-stock-list" id="lp-stock-list"></div>
        <footer class="lp-stock-foot" id="lp-stock-summary"></footer>
      </aside>

      <section class="lp-col lp-col-plans">
        <header class="lp-col-head">
          <span>🧱 PLANS</span>
          <span class="lp-col-head-tools">
            <span class="lp-count" id="lp-plans-total"></span>
            <button type="button" class="lp-btn lp-btn-sm lp-archive-toggle" id="lp-archive-toggle"
                    data-action="toggle-archived"
                    title="USER 認為無用的 PLAN 可封存；封存後隨時可 RECALL 取回">🗄 封存 <span class="lp-archive-count" id="lp-archived-count">0</span></button>
          </span>
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
      <span class="lp-c-dest">DEST</span>
      <span class="lp-c-client">CLIENT</span>
      <span class="lp-c-pkgs">PKGS</span>
      <span class="lp-c-gw num">G.W</span>
      <span class="lp-c-vol num">${view === 'cuft' ? 'cu.ft' : 'VOL'}</span>
      <span class="lp-c-cbm num">CBM</span>
      <span class="lp-c-crd" title="CRD（Cargo Ready Date）：DDMMM｜游標在 DD，↑ +1 日、↓ −1 日｜不可遲於 Flight Date">CRD</span>
      <span class="lp-c-tag" title="自由文字（滑鼠移入可展開；雙擊編輯；DIM 格式 L x W x H / PCS）">REMARK</span>
    </div>
  `;
}

// 列級錯誤（只有這些情況才在 hover 顯示訊息；正常列僅 highlight）
export function isDuplicateItem(item) {
  return !!(item && (item.duplicate_mawb || item.split_of_item_id));
}

export function duplicateMessage(item) {
  const src = item || {};
  const places = Array.isArray(src.duplicate_places) ? src.duplicate_places : [];
  const otherPlans = [...new Set(places
    .filter(p => p && Number(p.plan_id) !== Number(src.plan_id))
    .map(p => String(p.label || '').trim())
    .filter(Boolean))];
  if (otherPlans.length) return `重複 MAWB（也在 ${otherPlans.join('、')}）`;
  if (places.length) return '重複 MAWB（同一 PLAN 多筆）';
  return '重複 MAWB（複製）';
}

export function itemIssues(item) {
  const src = item || {};
  const issues = [];
  if (!String(src.mawb || '').trim()) issues.push('缺 MAWB');
  if (isDuplicateItem(src)) issues.push(duplicateMessage(src));
  if (src.pcs_total === null || src.pcs_total === undefined) issues.push('件數未填');
  return issues;
}

export function itemRow(item, plan, index, options = {}) {
  const view = (plan && plan.volume_view) === 'cuft' ? 'cuft' : 'vol';
  const volume = item.volume || {};
  const volValue = view === 'cuft' ? volume.cuft : volume.vol;
  const selected = (options.selectedSet || state.selectedItems).has(item.id);
  const missingMawb = !String(item.mawb || '').trim();
  const dup = isDuplicateItem(item);
  // CRD（Cargo Ready Date）：畫面 DDMMM，DB 存 ISO；比 Flight Date 遲 → 標紅＋hover 提示
  const crdRaw = String(item.cargo_receipt || '').trim();
  const crdText = lpFormatCrd(crdRaw) || crdRaw.slice(0, 10);
  const crdIssue = lpCrdIssue(crdRaw, plan && plan.flight_date);
  const issues = itemIssues(item);
  if (crdIssue) issues.push(crdIssue);
  const crdTitle = `CRD：${crdText || '（空白；游標進入會先帶入今天）'}｜↑ +1 日、↓ −1 日、Enter 完成${crdIssue ? ` ｜ ⛔ ${crdIssue}` : ''}`;
  return `
    <div class="lp-row${selected ? ' is-selected' : ''}${missingMawb ? ' is-warn' : ''}${dup ? ' is-dup' : ''}"
         draggable="true" data-item-id="${item.id}" data-plan-id="${plan.id}"
         ${issues.length ? `data-hover-error="${esc(issues.join(' ｜ '))}"` : ''}>
      <span class="lp-c-sel"><input type="checkbox" data-action="select-item" ${selected ? 'checked' : ''} title="Shift+點擊可連續選取" /></span>
      <span class="lp-c-idx">${index + 1}</span>
      <span class="lp-c-mawb" data-field="mawb" title="雙擊編輯">
        ${item.mawb ? esc(item.mawb) : '<span class="lp-warn">缺 MAWB</span>'}${dup ? `<span class="lp-dup" title="${esc(duplicateMessage(item))}">⧉</span>` : ''}
      </span>
      <span class="lp-c-dest" data-field="dest">${esc(item.dest || '')}</span>
      <span class="lp-c-client" data-field="client">${esc(item.client || '')}</span>
      <span class="lp-c-pkgs" data-field="pkgs_text">${pcsText(item)}</span>
      <span class="lp-c-gw num" data-field="gross_weight">${fmt(item.gross_weight, 2)}</span>
      <span class="lp-c-vol num" data-field="${view === 'cuft' ? 'cuft' : 'volume_weight'}">${fmt(volValue, 2)}</span>
      <span class="lp-c-cbm num" data-field="cbm">${fmt(item.cbm, 3)}</span>
      <span class="lp-c-crd">
        <input type="text" class="lp-crd-input${crdIssue ? ' is-invalid' : ''}" data-crd-input
               data-crd-item="${item.id}" data-crd-saved="${esc(crdRaw)}"
               data-crd-flight="${esc((plan && plan.flight_date) || '')}"
               value="${esc(crdText)}" maxlength="10" autocomplete="off" spellcheck="false"
               title="${esc(crdTitle)}" aria-label="CRD（Cargo Ready Date，DDMMM）" />
      </span>
      <span class="lp-c-tag" data-field="tag">${esc(item.tag || '')}${flagTags(item)}</span>
    </div>
  `;
}

// ===== PLAN 明細合計列（固定在最下方；欄位與上方明細逐欄對齊）=====
// MAWB 欄＝去重後的 MAWB 數；PKGS／G.W／VOL（或 cu.ft）／CBM 依上方同欄對齊方式輸出
export function planTotalRow(plan, view) {
  const t = (plan && plan.totals) || {};
  const mode = view === 'cuft' ? 'cuft' : 'vol';
  const volValue = mode === 'cuft' ? t.cuft : t.vol;
  const pcsIncomplete = Number(t.pcsIncomplete || 0);
  const title = `明細 ${fmtInt(t.tickets)} 筆${pcsIncomplete ? `；${fmtInt(pcsIncomplete)} 筆件數未填（PKGS 合計不含）` : ''}`;
  return `
    <div class="lp-row lp-row-total" title="${esc(title)}">
      <span class="lp-c-sel"></span>
      <span class="lp-c-idx"></span>
      <span class="lp-c-mawb">TOTAL <b>${fmtInt(t.mawbs)}</b> MAWB</span>
      <span class="lp-c-dest"></span>
      <span class="lp-c-client"></span>
      <span class="lp-c-pkgs">${fmtInt(t.pcs)}${pcsIncomplete ? ' <span class="lp-warn">⚠</span>' : ''}</span>
      <span class="lp-c-gw num">${fmt(t.grossWeight, 2)}</span>
      <span class="lp-c-vol num">${fmt(volValue, 2)}</span>
      <span class="lp-c-cbm num">${fmt(t.cbm, 3)}</span>
      <span class="lp-c-crd"></span>
      <span class="lp-c-tag"></span>
    </div>
  `;
}

// 存貨列：完整 MAWB／客戶名（窄欄用兩行排版，不截斷）
export function stockRow(item, plan, index, options = {}) {
  const view = (plan && plan.volume_view) === 'cuft' ? 'cuft' : 'vol';
  const volume = item.volume || {};
  const volValue = view === 'cuft' ? volume.cuft : volume.vol;
  const selected = (options.selectedSet || state.selectedStock).has(item.id);
  const missingMawb = !String(item.mawb || '').trim();
  const dup = isDuplicateItem(item);
  const issues = itemIssues(item);
  const client = String(item.client || '').trim();
  // CRD（Cargo Ready Date）：與 PLAN 明細同一格式 DDMMM（空白顯示 —）
  const crdRaw = String(item.cargo_receipt || '').trim();
  const crdText = lpFormatCrd(crdRaw) || crdRaw.slice(0, 10);
  return `
    <div class="lp-row lp-stock-row${selected ? ' is-selected' : ''}${missingMawb ? ' is-warn' : ''}${dup ? ' is-dup' : ''}"
         draggable="true" data-item-id="${item.id}" data-plan-id="${plan ? plan.id : 0}"
         ${issues.length ? `data-hover-error="${esc(issues.join(' ｜ '))}"` : ''}>
      <span class="lp-c-sel"><input type="checkbox" data-action="select-item" ${selected ? 'checked' : ''} title="Shift+點擊可連續選取" /></span>
      <span class="lp-c-idx">${index + 1}</span>
      <div class="lp-stock-body">
        <div class="lp-stock-line">
          <span class="lp-stock-mawb" data-field="mawb" title="雙擊編輯">${item.mawb ? esc(item.mawb) : '<span class="lp-warn">缺 MAWB</span>'}${dup ? `<span class="lp-dup" title="${esc(duplicateMessage(item))}">⧉</span>` : ''}</span>
          <span class="lp-stock-client${client ? '' : ' lp-muted'}" data-field="client" title="雙擊編輯">${client ? esc(client) : '—'}</span>
        </div>
        <div class="lp-stock-meta">
          <span data-field="dest"><b>${esc(item.dest || '—')}</b></span>
          <span data-field="pkgs_text">${pcsText(item)}</span>
          <span class="num" data-field="gross_weight">G.W ${fmt(item.gross_weight, 2)}</span>
          <span class="num" data-field="${view === 'cuft' ? 'cuft' : 'volume_weight'}">${view === 'cuft' ? 'cu.ft' : 'VOL'} ${fmt(volValue, 2)}</span>
          <button type="button" class="lp-stock-crd" data-cargo-receipt title="CRD（Cargo Ready Date）">CRD ${esc(crdText || '—')}</button>
        </div>
      </div>
    </div>
  `;
}

// ===== 頂部公用工具列（依選取狀態／作用中 PLAN 更新可用性）=====
function setBtnDisabled(node, disabled) {
  if (node) node.disabled = !!disabled;
}

export function renderToolbar() {
  if (typeof document === 'undefined') return;
  const plan = activePlan();
  const isFlight = !!plan && plan.type !== 'stock' && !plan.archived_at;
  const hasSelection = state.selectedItems.size > 0;
  const hasStockSelection = state.selectedStock.size > 0;

  setBtnDisabled(document.getElementById('lp-btn-undo'), state.undoStack.length === 0);

  const addBtn = document.getElementById('lp-btn-add-selected');
  setBtnDisabled(addBtn, !(hasSelection || hasStockSelection));
  if (addBtn && hasStockSelection) addBtn.textContent = `▶ 加入所選（${state.selectedStock.size}）`;
  else if (addBtn) addBtn.textContent = '▶ 加入所選';

  ['to-stock', 'copy-selected'].forEach((action) => {
    setBtnDisabled(document.querySelector(`[data-action="${action}"]`), !hasSelection);
  });
  ['suggest', 'export-xlsx', 'edit-plan'].forEach((action) => {
    setBtnDisabled(document.querySelector(`[data-action="${action}"]`), !isFlight);
  });

  const view = isFlight && plan.volume_view === 'cuft' ? 'cuft' : 'vol';
  document.querySelectorAll('[data-action="set-view"]').forEach((node) => {
    const on = node.dataset.view === view;
    node.classList.toggle('is-on', on);
    node.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
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
  // 上限一律標 "max"，避免和「目前用量」混淆（8,229 / max 9,000 kg）
  const gwText = t.maxGrossWeight
    ? `${fmt(t.grossWeight, 0)} / max ${fmt(t.maxGrossWeight, 0)}`
    : fmt(t.grossWeight, 0);
  // 體積 KPI 跟著檢視單位走：VOL/CBM 模式＝CBM（m³）；cu.ft/CBM 模式＝cu.ft（ft³）
  const useCuft = plan.volume_view === 'cuft';
  const volNow = useCuft ? t.cuft : t.cbm;
  const volMax = useCuft ? (t.maxCbm ? lpCuftFromCbm(t.maxCbm) : null) : t.maxCbm;
  const volUnit = useCuft ? 'cu.ft' : 'm³';
  const cbmText = volMax
    ? `${fmt(volNow, 2)} / max ${fmt(volMax, 2)} ${volUnit}`
    : `${fmt(volNow, 2)} ${volUnit}`;
  const overVolText = overC
    ? (useCuft ? ` ⛔+${fmt(lpCuftFromCbm(overC), 2)}` : ` ⛔+${fmt(overC, 2)}`)
    : '';
  return `
    <span class="lp-mini${overW ? ' is-over' : (Number(t.gwPct) >= 90 ? ' is-warn' : '')}" title="G.W（目前 / max 上限）">${gwText} kg${overW ? ` ⛔+${fmt(overW, 0)}` : ''}</span>
    <span class="lp-mini${overC ? ' is-over' : (Number(t.cbmPct) >= 90 ? ' is-warn' : '')}" title="${useCuft ? 'cu.ft（目前 / max 上限）' : 'CBM（目前 / max 上限）'}">${cbmText}${overVolText}</span>
    <span class="lp-mini">${fmtInt(t.tickets)} 票 ｜ ${fmtInt(t.pcs)} 件</span>
    ${t.pcsIncomplete ? `<span class="lp-mini is-warn" title="件數未填">⚠ ${t.pcsIncomplete}</span>` : ''}
  `;
}

// 封存時間：DB 存 UTC（CURRENT_TIMESTAMP）→ 顯示使用者當地時間
export function archivedStamp(plan) {
  const raw = String((plan && plan.archived_at) || '').trim();
  if (!raw) return '';
  const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function planCard(plan) {
  const archived = !!plan.archived_at;
  const expanded = !archived && isExpanded(plan.id);
  const active = !archived && Number(state.activePlanId) === Number(plan.id);
  const items = itemsOf(plan.id);
  const view = plan.volume_view === 'cuft' ? 'cuft' : 'vol';
  return `
    <article class="lp-plan${active ? ' is-active' : ''}${archived ? ' is-archived' : ''}" data-plan-id="${plan.id}">
      <header class="lp-plan-head" data-action="${archived ? 'archived-plan' : 'activate-plan'}">
        <div class="lp-plan-title-row">
          <span class="lp-plan-title" title="${esc(planLabel(plan))}">${esc(planLabel(plan))}</span>
          <span class="lp-plan-badges">${dayTag(plan)}${contourTag(plan)}${ownerTag(plan)}</span>
          ${archived ? `
            <button type="button" class="lp-btn lp-btn-sm lp-recall-btn" data-action="recall-plan"
                    title="RECALL：把這張 PLAN 取回 PLAN 列表（明細與設定都會保留）">♻ RECALL</button>
          ` : `
            <button type="button" class="lp-btn lp-btn-sm lp-archive-btn" data-action="archive-plan"
                    title="封存（USER 認為無用時使用；之後可從「🗄 封存」RECALL 取回）">封存</button>
            <button type="button" class="lp-icon-btn" data-action="toggle-plan" title="${expanded ? '收合' : '展開明細'}">${expanded ? '▾' : '▸'}</button>
          `}
        </div>
        <div class="lp-plan-kpi-row">${miniKpi(plan)}${archived ? `<span class="lp-mini lp-archived-note" title="封存者：${esc(plan.archived_by || '—')}">🗄 已封存 ${esc(archivedStamp(plan))}</span>` : ''}</div>
      </header>
      ${archived ? `
        <div class="lp-archived-hint">已封存：內容完整保留，但不列入 PLAN 統計與重複 MAWB 檢核。按「♻ RECALL」即可取回繼續使用。</div>
      ` : expanded ? `
        <div class="lp-plan-body">
          ${rowHead(view)}
          ${items.length ? items.map((item, index) => itemRow(item, plan, index)).join('') : '<div class="lp-empty-sm">沒有明細（把左欄存貨拖進來）</div>'}
          ${items.length ? planTotalRow(plan, view) : ''}
        </div>
      ` : ''}
    </article>
  `;
}

export function renderPlans() {
  const list = document.getElementById('lp-plan-list');
  if (!list) return;
  const archivedView = !!state.showArchived;
  const pool = archivedView ? archivedFlightPlans() : flightPlans();
  const needle = String(state.searchPlan || '').toLowerCase();
  const plans = pool.filter((plan) => {
    if (!needle) return true;
    return [planLabel(plan), plan.plan_no, plan.day_code, plan.contour_code]
      .map(v => String(v || '').toLowerCase()).join(' ').includes(needle);
  }).sort(archivedView
    // 封存清單：最後封存的排最前面（最可能是想 RECALL 的那張）
    ? (a, b) => String(b.archived_at || '').localeCompare(String(a.archived_at || ''))
    : (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  list.innerHTML = plans.length
    ? plans.map(planCard).join('')
    : archivedView
      ? '<div class="lp-empty">目前沒有封存的 PLAN。在 PLAN 卡片按「🗄」即可封存（之後可 RECALL）。</div>'
      : `<div class="lp-empty">${state.plans.length ? '沒有符合的 PLAN' : '還沒有 PLAN，按右上角「＋ 新 PLAN」開始'}</div>`;

  const totalEl = document.getElementById('lp-plans-total');
  if (totalEl) totalEl.textContent = archivedView ? `封存 ${archivedFlightPlans().length} 張` : `${flightPlans().length} 張`;
  const countEl = document.getElementById('lp-plan-count');
  if (countEl) countEl.textContent = state.searchPlan ? `${plans.length} / ${pool.length}` : '';

  const archivedCount = archivedFlightPlans().length;
  const toggle = document.getElementById('lp-archive-toggle');
  if (toggle) {
    toggle.classList.toggle('is-on', archivedView);
    toggle.textContent = archivedView ? '← 回到 PLAN 列表' : '🗄 封存';
    if (!archivedView) {
      const count = document.createElement('span');
      count.className = 'lp-archive-count';
      count.id = 'lp-archived-count';
      count.textContent = String(archivedCount);
      toggle.appendChild(count);
    }
    toggle.title = archivedView
      ? '回到正常的 PLAN 列表'
      : `已封存 ${archivedCount} 張；點一下查看並 RECALL 取回`;
  }
}

export function renderAll() {
  renderStock();
  renderToolbar();
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
    ? items.map((item, index) => stockRow(item, state.stock, index, { selectedSet: selected })).join('')
    : `<div class="lp-empty-sm">${all.length ? '沒有符合的存貨' : '存貨是空的（可從 PLAN 移出，或按「找/新增Booking」加入）'}</div>`;

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

