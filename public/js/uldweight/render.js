// ===== ULD 夾重系統：畫面渲染 =====
// 只負責「畫」與「局部更新」；事件綁定在 uld-weight.js（root 上委派）
import {
  ULD_TERMINALS, ULD_PREDECL_TYPES, ULD_LIH_TYPES, ULD_LIH_OPTIONS, ULD_SQUEEZE_MODES, ULD_TAIL_MODES,
  uldFmtKg, uldIssueText, uldMawbKey, uldNum, uldLihCodes, uldLihLabel
} from './calc.js';
import {
  uldWeightState, uldComputed, ULD_MAX_UNITS, uldMawbLinks, uldMawbAssignedPcs, uldFindMawb
} from './state.js';
import { wireBookingPickers } from './booking-search.js';
import { uldGridHtml, refreshGridComputed } from './sheet-grid.js';
import { rclColumnOptions, rclSkipReasonText, rclWarningText } from './rcl-parse.js';
import { uldValidateMawb, uldMawbIssueText, uldFormatMawb } from './mawb-format.js';

export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, m => ({
    '\x26': '\x26amp;', '\x3C': '\x26lt;', '\x3E': '\x26gt;', '\x22': '\x26quot;', "'": '\x26#39;'
  }[m]));
}

function optionsHtml(list, selected, useCode = true) {
  return list.map(item => {
    const value = useCode ? item.code : item;
    const label = useCode ? item.label : item;
    return `<option value="${esc(value)}"${String(selected) === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function lihOptions(selected) {
  return optionsHtml(ULD_LIH_TYPES, selected || 'N');
}

// 新 UI：重量一律 kg；「允許使用 0.5kg」未勾選 → step 1（只整數）
function weightStep(sheet = uldWeightState.current) {
  return Number(sheet && sheet.allow_half_kg) === 1 ? '0.5' : '1';
}

// 磅差 chip：≤1% 綠、≤3% 黃、>3% 紅
function diffChip(diff, pct) {
  const absPct = Math.abs(pct || 0);
  const tone = absPct <= 1 ? 'ok' : (absPct <= 3 ? 'warn' : 'bad');
  const sign = diff > 0 ? '+' : '';
  return `<span class="uldw-chip uldw-chip-${tone}">磅差 ${sign}${uldFmtKg(diff)} kg（${sign}${(pct || 0).toFixed(2)}%）</span>`;
}

// ===== 清單（LOT 列表）=====
// 進入「ULD 夾重系統」先看現有 LOT；搜尋列是即時的（輸入 300ms 後自動查詢，不需按 Enter）。
export function renderList(root) {
  const state = uldWeightState;
  const filter = state.listFilter || { search: '', status: '' };
  // 即時（本機）篩選：打字當下先縮小目前清單，300ms 後再由伺服器查一次（含舊資料）
  const query = String(filter.search || '').trim().toLowerCase();
  const allRows = state.sheets || [];
  const rows = query
    ? allRows.filter(row => [
      row.sheet_no, row.flight_no, row.terminal, row.handler, row.sheet_date
    ].some(value => String(value || '').toLowerCase().includes(query)))
    : allRows;
  // V2：批次下載的勾選狀態（只算「目前清單看得到的列」）
  const selected = new Set((state.batchSelected || []).map(id => Number(id)));
  const selectedRows = rows.filter(row => selected.has(Number(row.id)));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const statusTabs = [
    { code: '', label: '全部' },
    { code: 'draft', label: '草稿' },
    { code: 'locked', label: '已鎖定' }
  ];

  const cards = rows.map(row => {
    const locked = row.status === 'locked';
    const picked = selected.has(Number(row.id));
    return `
      <article class="uldw-lot${picked ? ' is-batch-selected' : ''}" data-sheet-id="${row.id}">
        <header class="uldw-lot-head">
          <label class="uldw-lot-pick" title="勾選可批次下載 PDF">
            <input type="checkbox" data-batch-id="${row.id}"${picked ? ' checked' : ''} aria-label="選取 ${esc(row.sheet_no)}">
          </label>
          <div class="uldw-lot-title">
            <b>${esc(row.sheet_no)}</b>
            <span class="uldw-status uldw-status-${locked ? 'locked' : 'draft'}">${locked ? '已鎖定' : '草稿'}</span>
          </div>
          <div class="uldw-lot-actions">
            <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-primary" data-action="open" data-id="${row.id}" title="開啟 LOT（建檔頁：MAWB LIST／ULD LIST）">開啟</button>
            <button type="button" class="uldw-btn uldw-btn-sm" data-action="duplicate" data-id="${row.id}" title="複製成一張新的 LOT">複製</button>
            <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-danger" data-action="delete" data-id="${row.id}"${locked ? ' disabled' : ''} title="刪除這張 LOT">刪除</button>
          </div>
        </header>
        <div class="uldw-lot-meta">
          <span title="日期">📅 ${esc(row.sheet_date || '-')}</span>
          <span title="貨站">🏢 ${esc(row.terminal || '-')}</span>
          <span title="航班">✈ ${esc(row.flight_no || '-')}</span>
          <span title="收貨單位">▦ ${row.uld_count || 0} ULD${row.bulk_count ? `（散 ${row.bulk_count}）` : ''}</span>
        </div>
        <div class="uldw-lot-stats">
          <span><em>RCL（淨）</em><b>${uldFmtKg(row.rcl_total)}</b> kg</span>
          <span><em>夾重後</em><b>${uldFmtKg(row.net_total)}</b> kg</span>
          <span class="${row.diff_total ? 'is-warn' : ''}"><em>磅差</em><b>${row.diff_total > 0 ? '+' : ''}${uldFmtKg(row.diff_total)}</b> kg</span>
        </div>
      </article>`;
  }).join('');

  root.innerHTML = `
    <div class="uldw-lot-list">
      <div class="uldw-lot-toolbar">
        <div class="uldw-search">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input type="search" id="uldw-list-search" placeholder="搜尋 LOT／航班／貨站／經手人／日期（即時）"
            value="${esc(filter.search)}" autocomplete="off" spellcheck="false" aria-label="搜尋夾重表">
          <span class="uldw-search-hint">${filter.search ? '篩選中…' : '動態搜尋'}</span>
        </div>
        <div class="uldw-seg" role="group" aria-label="狀態篩選">
          ${statusTabs.map(tab => `<button type="button"
            class="uldw-seg-btn${filter.status === tab.code ? ' is-active' : ''}"
            data-action="list-status" data-status="${tab.code}">${tab.label}</button>`).join('')}
        </div>
        <span class="uldw-list-count">共 <b>${rows.length}</b> 張 LOT</span>
        <span class="uldw-batch-bar">
          <label class="uldw-batch-all"><input type="checkbox" id="uldw-batch-all"${allSelected ? ' checked' : ''} title="全選／取消全選"> 全選</label>
          <span class="uldw-batch-count" id="uldw-batch-count">已選 ${selectedRows.length} 張</span>
          <button type="button" class="uldw-btn uldw-btn-sm" id="uldw-batch-pdf" data-action="batch-pdf"
            title="把勾選的 LOT 各產一份 A4 PDF，打包成一個 ZIP（含 manifest.txt 清單；一次最多 50 張）"
            ${selectedRows.length ? '' : ' disabled'}>⤓ 批次 PDF</button>
        </span>
      </div>
      ${rows.length
        ? `<div class="uldw-lot-grid">${cards}</div>`
        : '<div class="empty-state">還沒有 LOT。按右上角「＋ 新增夾重表」開始：① 建立 MAWB LIST ② 建立 ULD LIST ③ 合併／分配。</div>'}
    </div>
  `;
}


// ===== 編輯畫面 =====
// 流程：① MAWB LIST ／ ② ULD LIST（同一頁兩個 division）→ ③ 合併／分配（另一個頁面）
// 輸入中的欄位由 refreshComputed 局部更新，不會被重畫。
const UI_DEFAULTS = {
  step: 'build', view: 'cards', gridSortMawb: false, more: false, advanced: false,
  expanded: {}, expandAll: false, printUnit: null, mergePick: null
};

function ensureUi() {
  const state = uldWeightState;
  if (!state.ui) state.ui = { ...UI_DEFAULTS, expanded: {} };
  const ui = state.ui;
  if (ui.step !== 'merge') ui.step = 'build';
  if (ui.view !== 'grid') ui.view = 'cards';
  if (ui.mergePick === undefined) ui.mergePick = null;
  if (!ui.expanded) ui.expanded = {};
  return ui;
}

export function renderEditor(root) {
  const state = uldWeightState;
  const sheet = state.current;
  if (!sheet) {
    root.innerHTML = '<div class="empty-state">沒有選取的夾重表。</div>';
    return;
  }
  const locked = sheet.status === 'locked';
  const dis = locked ? ' disabled' : '';
  const contourCodes = state.contourOptions || [];
  const ui = ensureUi();
  const advOpen = !!ui.advanced;
  const viewIsGrid = ui.view === 'grid';

  // ③ 合併／分配：獨立一頁（左 MAWB 池、右 ULD 分欄，可拖曳）
  if (ui.step === 'merge') {
    root.innerHTML = mergeViewHtml(sheet, locked, ui, contourCodes);
    refreshComputed(root);
    return;
  }

  const unitCount = (sheet.ulds || []).length;
  const computed = uldComputed();

  root.innerHTML = `
    <div class="uldw-editor${locked ? ' is-locked' : ''}" data-sheet-id="${sheet.id}">
      <div class="uldw-editor-head">
        <div class="uldw-editor-title">
          <b>${esc(sheet.sheet_no)}</b>
          <span class="uldw-status uldw-status-${locked ? 'locked' : 'draft'}">${locked ? '已鎖定' : '草稿'}</span>
          <span class="uldw-dirty" id="uldw-dirty-flag" style="display:${state.dirty ? '' : 'none'}">● 未儲存</span>
        </div>
        <div class="uldw-editor-actions">
          <button type="button" class="uldw-btn" data-action="back">← LOT 列表</button>
          <button type="button" class="uldw-btn uldw-btn-primary" data-action="save"${locked ? ' disabled' : ''}>儲存</button>
          <button type="button" class="uldw-btn" data-action="${locked ? 'unlock' : 'lock'}">${locked ? '解鎖' : '鎖定'}</button>
          <button type="button" class="uldw-btn uldw-btn-primary" data-action="open-merge"
            title="③ 合併／分配：把 MAWB LIST 拖到各 ULD、ULD 可左右拖曳調整板序">③ 合併／分配 →</button>
          <button type="button" class="uldw-btn" data-action="${viewIsGrid ? 'view-cards' : 'view-grid'}"
            title="${viewIsGrid ? '切回① MAWB LIST／② ULD LIST' : '切到載荷表（CHARTER LOADING SHEET 矩陣檢視／列印）'}">${viewIsGrid ? '▤ 清單建檔' : '▦ 載荷表'}</button>
          <div class="uldw-more${ui.more ? ' is-open' : ''}">
            <button type="button" class="uldw-btn" data-action="toggle-more" title="更多動作：版本／列印／PDF／複製／刪除／套用／補建 Booking">⋯ 更多</button>
            <div class="uldw-more-menu">
      <button type="button" class="uldw-btn" data-action="apply"${locked ? '' : ' disabled'} title="把夾重後的最終重量回寫到打板計劃的 Booking Record（需先鎖定；只改 mawb_records.gross_weight，不動訂單）">套用到 Booking</button>
          <button type="button" class="uldw-btn" data-action="sync-bookings" title="把還沒連結 Booking 的票補到打板計劃：MAWB 已存在就只連結、不存在才建立（gross_weight 用夾重後重量；不動訂單）。會先顯示預覽請你確認。">⇧ 補建 Booking</button>
          <button type="button" class="uldw-btn" data-action="versions" title="版本紀錄：每次儲存／鎖定／解鎖／套用 Booking／補建 Booking 都會留一份快照，可比較兩版差異（每張表保留最近 30 版）">🕘 版本</button>
          <button type="button" class="uldw-btn" data-action="print" title="列印／另存 PDF（A4 直式；草稿與鎖定都可列印，只印表頭、每板 RCL − Tare = 淨重、每票最終重量、磅差與合計）">🖨 列印</button>
          <button type="button" class="uldw-btn" data-action="pdf" title="下載 server 端正式 PDF（固定 A4 排版，適合批次產檔／寄送；草稿與鎖定都可下載）">⤓ PDF</button>
          <button type="button" class="uldw-btn" data-action="duplicate">複製</button>
          <button type="button" class="uldw-btn uldw-btn-danger" data-action="delete"${locked ? ' disabled' : ''}>刪除</button>
            </div>
          </div>
        </div>
      </div>

      <div class="uldw-fields">
        <label>日期<input type="date" data-header="sheet_date" value="${esc(sheet.sheet_date)}"${dis}></label>
        <label>貨站<select data-header="terminal"${dis}>${optionsHtml(ULD_TERMINALS, sheet.terminal, false)}</select></label>
        <label>航班<input type="text" data-header="flight_no" value="${esc(sheet.flight_no)}" placeholder="CX1234" autocomplete="off" spellcheck="false"${dis}></label>
        <label>航班日期<input type="date" data-header="flight_date" value="${esc(sheet.flight_date)}"${dis}></label>
        <label>經手人<input type="text" data-header="handler" value="${esc(sheet.handler)}" autocomplete="off" spellcheck="false"${dis}></label>
        <label class="uldw-half-kg" title="單位一律 kg；未勾選＝所有重量只以整數運算（0.5 會四捨五入）">
          <span>重量</span>
          <span class="uldw-half-kg-box">
            <input type="checkbox" data-header="allow_half_kg"${Number(sheet.allow_half_kg) === 1 ? ' checked' : ''}${dis}>
            允許使用 0.5 kg
          </span>
        </label>
        <button type="button" class="uldw-btn uldw-btn-sm uldw-adv-toggle" data-action="toggle-adv"
          title="進階參數：B 取整／尾差／磅差警示門檻／比例上下限（不常改，收起來畫面比較清爽）">${advOpen ? '▾' : '⚙'} 進階</button>
        <div class="uldw-adv${advOpen ? ' is-open' : ''}">
        <label class="uldw-print-hide" title="只在勾選「允許使用 0.5 kg」時有效：B 散貨可選 0.5／1.0（P/X 交板固定可用 0.5）">B 取整<select data-header="round_b"${dis}${Number(sheet.allow_half_kg) === 1 ? '' : ' disabled'}>
          <option value="0.5"${Number(sheet.round_b) === 0.5 ? ' selected' : ''}>0.5</option>
          <option value="1"${Number(sheet.round_b) === 1 ? ' selected' : ''}>1.0</option>
        </select></label>
        <label class="uldw-print-hide" title="各票取整後與目標淨重的差額怎麼處理">尾差<select data-header="tail_mode"${dis}>${optionsHtml(ULD_TAIL_MODES, sheet.tail_mode)}</select></label>
        <label class="uldw-print-hide" title="磅差警示門檻（%）：要與右邊的 kg「同時」超過才會提示「磅差過大」（預設 2%；0 或空白＝用預設）">磅差警示 %<input type="number" min="0" step="0.1" data-header="diff_warn_pct" value="${esc(sheet.diff_warn_pct)}"${dis}></label>
        <label class="uldw-print-hide" title="磅差警示門檻（kg）：要與左邊的 %「同時」超過才會提示「磅差過大」（預設 100kg；0 或空白＝用預設）">磅差警示 kg<input type="number" min="0" step="1" data-header="diff_warn_kg" value="${esc(sheet.diff_warn_kg)}"${dis}></label>
        <label class="uldw-print-hide" title="多票夾重時，單票最少分到多少比例（%；0 或空白＝不限）。超出範圍的部分會依比例重分配給其他票">比例下限 %<input type="number" min="0" max="100" step="1" data-header="clamp_min_pct" value="${esc(sheet.clamp_min_pct)}"${dis}></label>
        <label class="uldw-print-hide" title="多票夾重時，單票最多分到多少比例（%；0 或空白＝不限）。例：填 60 → 任何一票最多吸收 60% 的磅差">比例上限 %<input type="number" min="0" max="100" step="1" data-header="clamp_max_pct" value="${esc(sheet.clamp_max_pct)}"${dis}></label>
        </div>
        <label class="uldw-field-wide">備註<input type="text" data-header="remark" value="${esc(sheet.remark)}" autocomplete="off" spellcheck="false"${dis}></label>
      </div>

      ${rclPanelHtml()}
      ${versionsPanelHtml()}

      ${viewIsGrid ? uldGridHtml(computed, sheet, ui) : `
      <div class="uldw-workbench">
        ${mawbListPanelHtml(sheet, locked, computed)}

        <section class="uldw-panel uldw-uld-panel">
          <div class="uldw-panel-head">
            <div class="uldw-panel-title">
              <span class="uldw-step-badge">②</span>
              <b>ULD LIST</b>
              <span class="uldw-panel-count">${unitCount} / ${ULD_MAX_UNITS}</span>
            </div>
            <div class="uldw-panel-actions">
              <button type="button" class="uldw-btn uldw-btn-sm" data-action="add-uld"${dis}>＋ 新增 ULD</button>
              <button type="button" class="uldw-btn uldw-btn-sm" data-action="add-bulk"${dis}>＋ 散貨</button>
              <button type="button" class="uldw-btn uldw-btn-sm" data-action="import-rcl"${dis} title="從貨站 RCL 磅單（Excel／CSV）匯入 ULD、Tare、Gross 與件數（可先預覽勾選）">⇪ 匯入 RCL</button>
              <button type="button" class="uldw-btn uldw-btn-sm" data-action="toggle-compact"
                title="一次展開／收合所有卡片的次要欄位（Contour／Tare／LIH／Pre-decl…）">${ui.expandAll ? '全部收合' : '全部展開'}</button>
              <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-primary" data-action="open-merge"
                title="③ 合併／分配：把 MAWB 拖到各 ULD，ULD 可左右拖曳調整板序">③ 合併／分配</button>
            </div>
            <span class="uldw-legend" aria-hidden="true">
              <span class="uldw-legend-sq" data-tone="squeeze"></span>夾重
              <span class="uldw-legend-sq" data-tone="changed"></span>WT 已改
            </span>
          </div>
          <div class="uldw-unit-list" data-compact="${ui.expandAll ? '0' : '1'}">
            ${unitCount
              ? sheet.ulds.map((unit, idx) => unitCardHtml(unit, idx, locked)).join('')
              : '<div class="empty-state">① 先按「＋ 新增 ULD」或「⇪ 匯入 RCL」<br>② 在卡片下方輸入 MAWB#（Enter 加入）或「⧉ 貼上」多票<br>③ 按「③ 合併／分配」把 MAWB 拖到各 ULD</div>'}
          </div>
        </section>

        <section class="uldw-panel uldw-result-panel">
          <div class="uldw-panel-head">
            <div class="uldw-panel-title"><span class="uldw-step-badge">Σ</span><b>結果與檢核</b></div>
          </div>
          <div class="uldw-columns">
            <div class="uldw-col uldw-col-result">
              <div class="uldw-col-head"><span>夾重結果（MAWB 彙總）</span></div>
              <div id="uldw-mawb-table"></div>
              <div class="uldw-col-head"><span>檢核</span></div>
              <div id="uldw-issues"></div>
            </div>
          </div>
          <div class="uldw-totals" id="uldw-totals"></div>
        </section>
      </div>`}
      <datalist id="uldw-contour-list">
        ${contourCodes.map(code => `<option value="${esc(code)}"></option>`).join('')}
      </datalist>
    </div>
  `;

  refreshComputed(root);
  // 「新增 MAWB」列：MAWB 輸入框接上打板計劃 Booking Record 的輸入即篩選
  // （選到後自動帶入件數／重量／Port 與 mawb_record_id；手動輸入仍可用）
  // 載荷表沒有「新增 MAWB」列（新票在最下面那格輸入，或按「＋ 列」），所以不用綁。
  if (!viewIsGrid) wireBookingPickers(root);
}

// ===== ① MAWB LIST（MAWB 主檔）=====
// 內容：MAWB#／DEST／PCS／WT；多票就多列。MAWB# 失焦會格式化並標示檢查碼錯誤。
function mawbListPanelHtml(sheet, locked, computed) {
  const dis = locked ? ' disabled' : '';
  const rows = sheet.mawbs || [];
  const rowHtml = rows.map((row, idx) => {
    const check = uldValidateMawb(row.mawb);
    const bad = !check.ok && !check.empty;
    const key = uldMawbKey(row.mawb);
    const links = uldMawbLinks(row);
    const assigned = links.reduce((sum, link) => sum + Math.max(0, uldNum(link.item.pcs)), 0);
    const unassigned = Math.max(0, uldNum(row.pcs) - assigned);
    const total = (computed.mawbs || []).find(item => item.key === key) || null;
    return `
      <tr data-row-uid="${esc(row.uid)}" class="${row.is_squeeze ? 'is-squeeze' : ''}">
        <td class="uldw-mawb-seq">${String(idx + 1).padStart(2, '0')}</td>
        <td>
          <input type="text" class="uldw-mawb-input${bad ? ' is-invalid' : ''}" data-row-field="mawb"
            value="${esc(row.mawb)}" placeholder="000-0000 0000" autocomplete="off" spellcheck="false"
            ${bad ? `data-mawb-invalid="1" title="${esc(uldMawbIssueText(check))}"` : ''}${dis}>
        </td>
        <td><input type="text" class="uldw-mawb-dest" data-row-field="dest" value="${esc(row.dest)}" placeholder="DEST" autocomplete="off" spellcheck="false"${dis}></td>
        <td><input type="number" class="uldw-mawb-pcs" min="0" step="1" data-row-field="pcs" value="${esc(row.pcs)}"${dis}></td>
        <td><input type="number" class="uldw-mawb-wt" min="0" step="${weightStep(sheet)}" data-row-field="declared_weight" value="${esc(row.declared_weight)}"${dis}></td>
        <td class="uldw-mawb-assign">
          ${links.length
            ? `<span title="已分到 ${links.length} 板">${links.length} 板${unassigned > 0 ? ` <em>餘 ${unassigned} 件</em>` : ''}</span>`
            : '<span class="is-warn">未分配</span>'}
        </td>
        <td class="uldw-mawb-flag">
          <label title="勾選＝這票參與夾重（可多票）"><input type="checkbox" data-row-field="is_squeeze"${row.is_squeeze ? ' checked' : ''}${dis}> 夾重</label>
        </td>
        <td class="uldw-mawb-final"><span data-calc="row-final">${total ? uldFmtKg(total.final) : '-'}</span></td>
        <td class="uldw-mawb-x">
          <button type="button" class="uldw-icon-btn uldw-icon-btn-danger" data-action="grid-del-row" data-row-uid="${esc(row.uid)}"
            title="刪除這票（各板的明細一起刪）"${dis}>✕</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <section class="uldw-panel uldw-mawb-panel" id="uldw-mawb-panel">
      <div class="uldw-panel-head">
        <div class="uldw-panel-title">
          <span class="uldw-step-badge">①</span>
          <b>MAWB LIST</b>
          <span class="uldw-panel-count">${rows.length} 票</span>
        </div>
        <div class="uldw-panel-actions">
          <button type="button" class="uldw-btn uldw-btn-sm" data-action="focus-mawb-add"${dis}>＋ 新增 MAWB</button>
          <button type="button" class="uldw-btn uldw-btn-sm" data-action="paste-mawbs"${dis}
            title="貼上多列：從 Excel／booking list 複製 MAWB、DEST、PCS、WT（Tab 分隔）">⧉ 貼上多列</button>
          <button type="button" class="uldw-btn uldw-btn-sm" data-action="grid-check-mawb"${dis}
            title="檢查所有 MAWB# 的檢查碼，合格的順便格式化成 000-0000 0000">✓ 檢查碼</button>
        </div>
      </div>
      <div class="uldw-table-wrap uldw-mawb-wrap">
        <table class="uldw-table uldw-mawb-table">
          <colgroup>
            <col class="uldw-mawb-col-seq">
            <col class="uldw-mawb-col-mawb">
            <col class="uldw-mawb-col-dest">
            <col class="uldw-mawb-col-pcs">
            <col class="uldw-mawb-col-wt">
            <col class="uldw-mawb-col-assign">
            <col class="uldw-mawb-col-flag">
            <col class="uldw-mawb-col-final">
            <col class="uldw-mawb-col-x">
          </colgroup>
          <thead><tr>
            <th class="uldw-mawb-seq">#</th>
            <th class="uldw-mawb-th-mawb">MAWB#</th>
            <th class="uldw-mawb-th-dest">DEST</th>
            <th class="uldw-mawb-th-pcs">PCS</th>
            <th class="uldw-mawb-th-wt">WT（kg）</th>
            <th class="uldw-mawb-th-assign">分板</th>
            <th class="uldw-mawb-th-flag">夾重</th>
            <th class="uldw-mawb-th-final">最終（kg）</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${rows.length
              ? rowHtml
              : '<tr><td colspan="9" class="uldw-empty-cell">還沒有 MAWB。在下面輸入 MAWB# 按 Enter，或按「⧉ 貼上多列」。</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="uldw-mawb-addbar">
        <input type="text" id="uldw-mawb-new" class="uldw-mawb-new" placeholder="MAWB#（11 位數字；Enter 加入）"
          autocomplete="off" spellcheck="false"${dis}>
        <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-primary" data-action="mawb-add"${dis}>＋ 加入 MAWB</button>
        <span class="uldw-mawb-addhint">可直接從 Excel 選取 MAWB／DEST／PCS／WT 後 Ctrl+V 貼上（Tab 分隔）；檢查碼＝前 7 位 mod 7。</span>
      </div>
    </section>`;
}


// ===== ③ 合併／分配：共用小元件 =====
// ULD 的 LIH 狀態：NIL／3481／3091 可多選（3481 與 3091 可同時亮）
function lihChipsHtml(unit, locked) {
  const dis = locked ? ' disabled' : '';
  const codes = uldLihCodes(unit.lih_type);
  const nilOn = codes.length === 0;
  return `<div class="uldw-lih" data-unit-field="lih_type">
    ${ULD_LIH_OPTIONS.map(opt => {
      const on = opt.code === 'N' ? nilOn : codes.includes(opt.code);
      return `<button type="button" class="uldw-lih-chip${on ? ' is-on' : ''}"
        data-action="toggle-lih" data-uid="${esc(unit.uid)}" data-lih="${opt.code}"
        title="${esc(opt.hint || opt.label)}"${dis}>${esc(opt.label)}</button>`;
    }).join('')}
  </div>`;
}

// MAWB 池的一張票：可拖曳、也可點選後在 ULD 按「＋ 加入」
// 版面（概念圖）：左序號圓角框 ｜ MAWB（大字）＋DEST／PCS／WT（小字）｜ 右狀態（已分配／餘 n 件）
// finalKg：夾重後重量（與申報不同時在後面顯示 → xxx kg，改重量後左邊也看得到同步結果）
function mawbChipHtml(row, idx, locked, pickUid, finalKg, place) {
  const check = uldValidateMawb(row.mawb);
  const bad = !check.ok && !check.empty;
  const pcs = uldNum(row.pcs);
  const declared = uldNum(row.declared_weight);
  const assigned = uldMawbAssignedPcs(row);
  const remaining = Math.max(0, pcs - assigned);
  const done = pcs > 0 && remaining === 0;
  const boards = uldMawbLinks(row).length;
  const stateText = pcs <= 0 ? '未填件數' : (done ? '已分配' : `餘 ${remaining} 件`);
  const stateTone = pcs <= 0 ? ' is-empty' : (done ? ' is-done' : ' is-todo');
  const squeezed = finalKg != null && Math.abs(finalKg - declared) > 1e-9;
  return `<button type="button" class="uldw-mawb-chip${bad ? ' is-invalid' : ''}${done ? ' is-done' : ''}${pickUid === row.uid ? ' is-picked' : ''}"
    data-mawb-chip="1" data-row-uid="${esc(row.uid)}" data-mawb-key="${esc(uldMawbKey(row.mawb))}" data-action="pick-mawb"
    draggable="${locked ? 'false' : 'true'}" style="${place || ''}" title="拖到右邊的 ULD，或點一下再按該 ULD 的「＋ 加入」">
    <span class="uldw-chip-seq">${String(idx + 1).padStart(2, '0')}</span>
    <span class="uldw-chip-main">
      <b title="${esc(`${row.mawb ? uldFormatMawb(row.mawb) : '（未填 MAWB#）'}${boards > 1 ? `（分到 ${boards} 塊板；其他板沒上這票是正常的）` : ''}${squeezed ? ` ｜ 夾重後 ${uldFmtKg(finalKg)} kg` : ''}`)}">${esc(row.mawb ? uldFormatMawb(row.mawb) : '（未填 MAWB#）')}</b>
      <small title="${esc(`${row.dest || '—'} ｜ ${pcs} PCS ｜ ${uldFmtKg(declared)} kg`)}">${esc(row.dest || '—')} ｜ ${pcs} PCS ｜ ${uldFmtKg(declared)} kg</small>
    </span>
    <span class="uldw-chip-state${stateTone}">${esc(stateText)}</span>
  </button>`;
}


// 合併頁：票的 LIH 小標籤（NIL 灰框／3481 橙／3091 紫；與 ULD 卡片的 chips 同色系）
function mergeItemLihHtml(item) {
  const codes = uldLihCodes(item.lih_type);
  if (!codes.length) return '<span class="uldw-merge-item-lih is-nil" title="沒有鋰電池">NIL</span>';
  return codes.map(code => {
    const opt = ULD_LIH_OPTIONS.find(o => o.code === code) || { label: uldLihLabel(code), hint: '' };
    return `<span class="uldw-merge-item-lih" data-lih="${esc(code)}" title="${esc(opt.hint || opt.label)}">${esc(opt.label)}</span>`;
  }).join('');
}

// ===== ③ 合併／分配：矩陣（一列＝一票 MAWB、一欄＝一塊 ULD）=====
// 同一票在每一欄都落在**同一橫行**（該板沒上這票 → 留白格），左邊 MAWB 欄 sticky，
// 水平捲動 37 板時仍對得到行；空白格也是拖放目標（可直接拖到那一列的該板）。
function matrixPlace(rowIndex, colIndex) {
  return `grid-row:${rowIndex};grid-column:${colIndex};`;
}

// 每一票 × 每一欄的一格（沒有這票 → 空白格）
function mergeCellHtml(unit, meta, rowIndex, colIndex, unitResult, locked) {
  const place = matrixPlace(rowIndex, colIndex);
  const item = meta.row
    ? (unit.items || []).find(it => uldMawbKey(it.mawb) === meta.key)
    : null;
  if (!item) {
    return `<div class="uldw-mx-cell is-empty" data-merge-unit="1" data-uid="${esc(unit.uid)}"
      data-unit-uid="${esc(unit.uid)}" data-mawb-key="${esc(meta.key)}" style="${place}"></div>`;
  }
  const dis = locked ? ' disabled' : '';
  const ci = unitResult && unitResult.calc
    ? (unitResult.calc.items.find(c => c.uid != null && String(c.uid) === String(item.uid)) || null)
    : null;
  const declared = ci ? ci.declared : uldNum(item.declared_weight);
  const final = ci ? ci.final : uldNum(item.declared_weight);
  const changed = Math.abs(final - declared) > 1e-9;
  const check = uldValidateMawb(item.mawb);
  const bad = !check.ok && !check.empty;
  const mawbText = item.mawb ? uldFormatMawb(item.mawb) : '（未填 MAWB#）';
  const mawbRow = rowForItem(item);
  const weightAttrs = mawbRow ? ` data-item-weight="1" data-weight-row="${esc(mawbRow.uid)}"` : ' data-item-weight="1"';
  const title = bad
    ? `${mawbText}：${uldMawbIssueText(check)}`
    : `${mawbText} ｜ 申報 ${uldFmtKg(declared)} kg → 夾重後 ${uldFmtKg(final)} kg（拖曳可搬到其他 ULD）`;
  return `<div class="uldw-mx-cell uldw-merge-item${bad ? ' is-invalid' : ''}${ci && ci.squeeze ? ' is-squeeze' : ''}${changed ? ' is-changed' : ''}"
    data-merge-unit="1" data-uid="${esc(unit.uid)}" data-unit-uid="${esc(unit.uid)}"
    data-merge-item="1" data-item-uid="${esc(item.uid)}"
    data-mawb-key="${esc(meta.key)}" draggable="${locked ? 'false' : 'true'}" title="${esc(title)}" style="${place}">
    <input type="number" class="uldw-merge-pcs" min="0" step="1" data-item-field="pcs"
      value="${esc(item.pcs)}" title="這一板的件數（重量依件數自動分）" aria-label="${esc(mawbText)} 件數"${dis}>
    <span class="uldw-merge-wt">
      <input type="number" min="0" step="${weightStep()}" class="uldw-merge-wt-input"
        data-item-field="declared_weight"${weightAttrs} value="${esc(declared)}"
        title="直接輸入這一板的重量（kg）；其餘板會依件數重新分配（Σ = 申報 WT）"
        aria-label="${esc(mawbText)} 重量（kg）"${dis}>
      <em>kg</em>
    </span>
    ${mergeItemLihHtml(item)}
    <button type="button" class="uldw-icon-btn uldw-icon-btn-danger uldw-merge-item-del" data-action="merge-remove-item"
      data-uid="${esc(unit.uid)}" data-item-uid="${esc(item.uid)}" title="從這一板移除（MAWB 仍在 LIST）"${dis}>✕</button>
  </div>`;
}

// 不在 MAWB LIST 的孤兒票（只在某塊板出現）：仍給一列，避免「有貨卻看不到」
function mergeOrphanChipHtml(meta, place) {
  const text = meta.item && meta.item.mawb ? uldFormatMawb(meta.item.mawb) : '（未填 MAWB#）';
  return `<div class="uldw-mawb-chip is-orphan" data-mawb-key="${esc(meta.key)}" style="${place}"
    title="這一票只在板上有、不在 MAWB LIST；建議回 ① 補建">
    <span class="uldw-chip-seq">··</span>
    <span class="uldw-chip-main"><b>${esc(text)}</b><small>不在 MAWB LIST</small></span>
    <span class="uldw-chip-state is-empty">—</span>
  </div>`;
}

// 一列：左邊 MAWB ＋ 每一欄的格子
function mergeMatrixRowHtml(meta, r, units, calcByUid, locked, ui, finalByKey) {
  const rowIndex = r + 2;
  const chip = meta.row
    ? mawbChipHtml(meta.row, meta.seq - 1, locked, ui.mergePick,
      finalByKey.has(meta.key) ? finalByKey.get(meta.key) : null, matrixPlace(rowIndex, 1))
    : mergeOrphanChipHtml(meta, matrixPlace(rowIndex, 1));
  const cells = units.map((unit, i) => mergeCellHtml(
    unit, meta, rowIndex, i + 2, calcByUid.get(unit.uid), locked
  )).join('');
  return `${chip}${cells}`;
}

// 欄頭：⠿ 01/A [ULD#] ← → ✕（同一行）＋ CONTOUR／DEST＋ RCL 淨重（未過磅）＋ LIH＋「＋ 加入」
function mergeUnitHeadHtml(unit, idx, unitResult, locked, ui) {
  const dis = locked ? ' disabled' : '';
  const calc = unitResult ? unitResult.calc : null;
  const items = unit.items || [];
  const isBulk = unit.kind === 'BULK';
  const pickedRow = ui.mergePick
    ? (uldWeightState.current.mawbs || []).find(r => r.uid === ui.mergePick)
    : null;
  const already = pickedRow
    ? items.some(it => uldMawbKey(it.mawb) === uldMawbKey(pickedRow.mawb))
    : false;
  const pickedRemaining = pickedRow
    ? Math.max(0, uldNum(pickedRow.pcs) - uldMawbAssignedPcs(pickedRow))
    : 0;
  const noRcl = !(uldNum(unit.rcl_gross_weight) > 0);
  return `<div class="uldw-mx-head uldw-merge-unit${calc && calc.hasError ? ' is-error' : ''}"
    data-merge-unit="1" data-uid="${esc(unit.uid)}" data-kind="${esc(unit.kind)}"
    draggable="${locked ? 'false' : 'true'}" style="${matrixPlace(1, idx + 2)}">
    <header class="uldw-merge-unit-head" data-drag-handle title="拖曳可左右調整板序（順序＝列印順序）">
      <span class="uldw-drag">⠿</span>
      <span class="uldw-merge-code">${unitCode(idx)}</span>
      <input type="text" class="uldw-merge-uld" data-unit-field="${isBulk ? 'bulk_ref' : 'uld_number'}"
        value="${esc(isBulk ? unit.bulk_ref : unit.uld_number)}" placeholder="${isBulk ? '批號／RCL' : 'ULD#'}"
        autocomplete="off" spellcheck="false"${dis}>
      <span class="uldw-merge-tools">
        <button type="button" class="uldw-icon-btn" data-action="merge-unit-left" data-uid="${esc(unit.uid)}" title="往左移（板序）"${dis}>←</button>
        <button type="button" class="uldw-icon-btn" data-action="merge-unit-right" data-uid="${esc(unit.uid)}" title="往右移（板序）"${dis}>→</button>
        <button type="button" class="uldw-icon-btn uldw-icon-btn-danger" data-action="del-unit" data-uid="${esc(unit.uid)}" title="刪除這個 ULD"${dis}>✕</button>
      </span>
    </header>
    <div class="uldw-merge-fields">
      <label>CONTOUR<input type="text" data-unit-field="contour_code" value="${esc(unit.contour_code)}" list="uldw-contour-list" placeholder="ZQ" autocomplete="off" spellcheck="false"${dis}></label>
      <label>ULD DEST<input type="text" data-unit-field="port" value="${esc(unit.port)}" placeholder="HKG" autocomplete="off" spellcheck="false"${dis}></label>
    </div>
    <label class="uldw-merge-rcl" title="貨站磅單的淨重（kg）；還沒過磅可留白＝先不夾重">
      <span>RCL 淨重</span>
      <input type="number" min="0" step="${weightStep()}" data-unit-field="rcl_gross_weight"
        value="${esc(unit.rcl_gross_weight)}" placeholder="選填"${dis}>
      <em>kg</em>
      ${noRcl ? '<span class="uldw-merge-flag" title="還沒填 RCL 淨重：先不夾重（保留申報重量）">未過磅</span>' : ''}
    </label>
    <div class="uldw-merge-lih">
      <span class="uldw-merge-label">LIH</span>
      ${lihChipsHtml(unit, locked)}
    </div>
    ${pickedRow
      ? `<button type="button" class="uldw-btn uldw-btn-sm uldw-btn-primary uldw-merge-assign" data-action="assign-picked"
          data-uid="${esc(unit.uid)}" title="把左邊選取的 ${esc(uldFormatMawb(pickedRow.mawb) || 'MAWB')} 加到這一板（件數＝未分配件數）"${already ? ' disabled' : ''}>${
          already ? '已在板上' : `＋ 加入${pickedRemaining > 0 ? `（${pickedRemaining} 件）` : ''}`
        }</button>`
      : ''}
  </div>`;
}

// 欄底：這一板的票數／PCS／夾重後
function mergeFootHtml(unit, colIndex, rowIndex, unitResult) {
  const calc = unitResult ? unitResult.calc : null;
  return `<div class="uldw-mx-foot${calc && calc.hasError ? ' is-error' : ''}"
    data-merge-unit="1" data-uid="${esc(unit.uid)}" style="${matrixPlace(rowIndex, colIndex)}">
    <span>${calc ? `${calc.items.length} 票 ｜ ${calc.pcsSum} PCS` : '0 票'}</span>
    <span>夾重後 <b>${calc ? uldFmtKg(calc.finalSum) : '0'}</b> kg</span>
  </div>`;
}


// 合併頁檢核：預設收合，只留一行摘要（37 板時可能有幾十條提醒，不能把版面推走）
function mergeIssuesCountsText(computed) {
  const errors = computed.issues.filter(issue => issue.level === 'error').length;
  const warns = computed.issues.length - errors;
  return [
    errors ? `⛔ ${errors} 項錯誤` : '',
    warns ? `⚠️ ${warns} 項提醒` : ''
  ].filter(Boolean).join(' ｜ ');
}

function mergeIssuesHtml(computed) {
  return `<summary id="uldw-merge-issues-summary"><b>${mergeIssuesCountsText(computed)}</b>（點開看內容）</summary>
        <div class="uldw-merge-issues-list" id="uldw-merge-issues-list">${issuesHtml(computed)}</div>`;
}

// ===== ③ 合併／分配（獨立頁面）=====
function mergeViewHtml(sheet, locked, ui, contourCodes) {
  const dis = locked ? ' disabled' : '';
  const computed = uldComputed();
  const rows = sheet.mawbs || [];
  const units = sheet.ulds || [];
  const totalPcs = rows.reduce((sum, row) => sum + uldNum(row.pcs), 0);
  const assignedPcs = rows.reduce(
    (sum, row) => sum + Math.min(uldNum(row.pcs), uldMawbAssignedPcs(row)), 0
  );
  // 分配進度（概念圖的長條）：全部票都分完會轉綠
  const assignedPct = totalPcs > 0 ? Math.min(100, Math.round((assignedPcs / totalPcs) * 100)) : 0;
  const assignedDone = totalPcs > 0 && assignedPcs >= totalPcs;
  // 左邊 MAWB：夾重後重量（改卡片重量／件數後這裡會同步 → 顯示在 chip 後面的 → xxx kg）
  const finalByKey = new Map((computed.mawbs || []).map(m => [m.key, m.final]));
  // 矩陣：一列＝一票 MAWB（依 MAWB LIST 次序）；不在 LIST 的孤兒票接在後面，避免「有貨看不到」
  const seenKeys = new Set();
  const matrixRows = [];
  rows.forEach((row, i) => {
    const key = uldMawbKey(row.mawb);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    matrixRows.push({ key, row, seq: i + 1, item: null });
  });
  units.forEach(unit => (unit.items || []).forEach(item => {
    const key = uldMawbKey(item.mawb);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    matrixRows.push({ key, row: null, seq: 0, item });
  }));
  const calcByUid = new Map((computed.units || []).map(u => [u.uid, u]));
  const footerRow = matrixRows.length + 2; // 1＝欄頭，2..＝資料列，最後＝欄底
  const gridColumns = `grid-template-columns: 296px${units.length ? ` repeat(${units.length}, 198px)` : ''};`;
  return `
    <div class="uldw-editor uldw-merge${locked ? ' is-locked' : ''}" data-sheet-id="${sheet.id}">
      <div class="uldw-editor-head">
        <div class="uldw-editor-title">
          <button type="button" class="uldw-btn uldw-btn-sm" data-action="close-merge">← 返回 ①②</button>
          <b>${esc(sheet.sheet_no)}</b>
          <span class="uldw-status uldw-status-${locked ? 'locked' : 'draft'}">${locked ? '已鎖定' : '草稿'}</span>
          <span class="uldw-dirty" id="uldw-dirty-flag" style="display:${uldWeightState.dirty ? '' : 'none'}">● 未儲存</span>
        </div>
        <div class="uldw-editor-actions">
          <button type="button" class="uldw-btn uldw-btn-primary" data-action="save"${locked ? ' disabled' : ''}>儲存</button>
          <button type="button" class="uldw-btn" data-action="${locked ? 'unlock' : 'lock'}">${locked ? '解鎖' : '鎖定'}</button>
          <button type="button" class="uldw-btn" data-action="close-merge">← 返回</button>
          <div class="uldw-more${ui.more ? ' is-open' : ''}">
            <button type="button" class="uldw-btn" data-action="toggle-more">⋯ 更多</button>
            <div class="uldw-more-menu">
              <button type="button" class="uldw-btn" data-action="versions">🕘 版本</button>
              <button type="button" class="uldw-btn" data-action="print">🖨 列印</button>
              <button type="button" class="uldw-btn" data-action="pdf">⤓ PDF</button>
              <button type="button" class="uldw-btn" data-action="duplicate">複製</button>
              <button type="button" class="uldw-btn uldw-btn-danger" data-action="delete"${locked ? ' disabled' : ''}>刪除</button>
            </div>
          </div>
        </div>
      </div>

      <div class="uldw-merge-hint">
        <b>把 MAWB 拖到 ULD</b>（或點 MAWB 再按該欄的「＋ 加入」）；<b>左右拖曳欄頭</b>可調整板序（順序＝列印順序）。
        <span class="uldw-merge-progress${assignedDone ? ' is-done' : ''}">
          <span class="uldw-merge-progress-bar"><i style="width:${assignedPct}%"></i></span>
          已分件數 ${assignedPcs} / ${totalPcs} PCS
        </span>
      </div>

      <details class="uldw-merge-issues" id="uldw-merge-issues"${computed.issues.length ? '' : ' hidden'}>
        ${mergeIssuesHtml(computed)}
      </details>

      <div class="uldw-merge-board">
        <section class="uldw-merge-canvas">
          <div class="uldw-merge-col-head">
            <span class="uldw-merge-step">②</span><b>ULD LIST</b>
            <span class="uldw-panel-count">${units.length} / ${ULD_MAX_UNITS}</span>
            <span class="uldw-merge-tip">← 拖曳欄頭可左右移位 →</span>
            <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-primary uldw-merge-add" data-action="add-uld"${dis}>＋ ULD</button>
          </div>
          <div class="uldw-mx-wrap">
            <div class="uldw-merge-matrix" style="${gridColumns}">
              <div class="uldw-mx-leftbg" style="grid-row:1 / span ${footerRow};grid-column:1;"></div>
              <div class="uldw-mx-corner" style="${matrixPlace(1, 1)}">
                <div class="uldw-merge-pool-head">
                  <span class="uldw-merge-step">①</span><b>MAWB LIST</b>
                  <span class="uldw-panel-count">${rows.length} 票</span>
                  ${ui.mergePick ? '<button type="button" class="uldw-btn uldw-btn-sm uldw-merge-clear" data-action="clear-pick">取消選取</button>' : ''}
                </div>
              </div>
              ${units.map((unit, idx) => mergeUnitHeadHtml(unit, idx, calcByUid.get(unit.uid), locked, ui)).join('')}
              ${matrixRows.map((meta, r) => mergeMatrixRowHtml(meta, r, units, calcByUid, locked, ui, finalByKey)).join('')}
              <div class="uldw-mx-poolfoot" style="${matrixPlace(footerRow, 1)}">
                <button type="button" class="uldw-btn uldw-btn-sm" data-action="close-merge"${dis}>← 回 ①② 補資料</button>
              </div>
              ${units.map((unit, i) => mergeFootHtml(unit, i + 2, footerRow, calcByUid.get(unit.uid))).join('')}
            </div>
            ${units.length ? '' : '<div class="empty-state uldw-merge-no-unit">還沒有 ULD，先按「＋ ULD」。</div>'}
          </div>
          <div class="uldw-merge-totals" id="uldw-merge-totals">
            ${mergeTotalsInnerHtml(computed, sheet)}
          </div>
        </section>
      </div>
      <datalist id="uldw-contour-list">
        ${contourCodes.map(code => `<option value="${esc(code)}"></option>`).join('')}
      </datalist>
    </div>`;
}


// ===== 收貨單位卡片 =====
// 板序代號：01/A、02/B…27/AA（照舊 Charter Loading Sheet 的欄頭；只影響顯示與列印順序）
export function unitCode(idx) {
  let n = Math.max(0, Number(idx) || 0);
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${String((Number(idx) || 0) + 1).padStart(2, '0')}/${letters}`;
}

function unitCardHtml(unit, idx, locked) {
  const dis = locked ? ' disabled' : '';
  const isBulk = unit.kind === 'BULK';
  const items = unit.items || [];
  const draft = unit.draft || {};
  const ui = uldWeightState.ui || {};
  const explicit = ui.expanded ? ui.expanded[unit.uid] : undefined;
  const expandedCard = explicit === undefined ? !!ui.expandAll : !!explicit;
  const compact = !expandedCard; // U1：預設收合（只留摘要＋明細），按 ▾ 才展開次要欄位
  return `
  <div class="uldw-unit" data-uid="${esc(unit.uid)}" data-kind="${unit.kind}" data-compact="${compact ? '1' : '0'}">
    <div class="uldw-unit-head">
      <span class="uldw-drag" data-drag-handle title="拖曳可調整板序（只影響顯示與列印順序，不影響計算）">⠿</span>
      <span class="uldw-unit-title">${unitCode(idx)}</span>
      ${isBulk
        ? `<input type="text" class="uldw-unit-no" data-unit-field="bulk_ref" value="${esc(unit.bulk_ref)}" placeholder="批號／RCL" autocomplete="off" spellcheck="false"${dis}>`
        : `<input type="text" class="uldw-unit-no" data-unit-field="uld_number" value="${esc(unit.uld_number)}" placeholder="PMC12345QR" autocomplete="off" spellcheck="false"${dis}>`}
      <span class="uldw-unit-chips" data-calc="chips"></span>
      <button type="button" class="uldw-btn uldw-btn-sm uldw-icon" data-action="toggle-unit" data-uid="${esc(unit.uid)}"
        title="${compact ? '展開這張卡（Contour／Tare／LIH／Pre-decl 等）' : '收合這張卡（只看摘要與票）'}">${compact ? '▸' : '▾'}</button>
      <button type="button" class="uldw-btn uldw-btn-sm uldw-icon" data-action="pdf-unit" data-uid="${esc(unit.uid)}"
        title="下載這一板的 Loading Sheet（A4 直式，MAWB／DEST／PCS／WT，可給貨站或機邊簽收）">⤓</button>
      <button type="button" class="uldw-btn uldw-btn-sm uldw-icon" data-action="print-unit" data-uid="${esc(unit.uid)}"
        title="只印這一板（瀏覽器列印／另存 PDF）">🖨</button>
      <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-danger uldw-icon" data-action="del-unit" data-uid="${esc(unit.uid)}"${dis} title="刪除這個收貨單位">✕</button>
    </div>
    <div class="uldw-unit-summary" data-calc="summary"></div>
    <div class="uldw-unit-fields">
      <label>ULD DEST<input type="text" data-unit-field="port" value="${esc(unit.port)}" placeholder="HKG" autocomplete="off" spellcheck="false"${dis}></label>
      <label>件數<input type="number" min="0" step="1" data-unit-field="pcs" value="${esc(unit.pcs)}"${dis}></label>
      <label title="選填：貨站 RCL 磅單的淨重（RCL（淨）＝夾重目標；不填也能先分配）">ULD WT（kg，選填）<input type="number" min="0" step="${weightStep()}" data-unit-field="rcl_gross_weight" value="${esc(unit.rcl_gross_weight)}"${dis}></label>
      ${isBulk ? '' : `<label>CONTOUR<input type="text" data-unit-field="contour_code" value="${esc(unit.contour_code)}" list="uldw-contour-list" placeholder="ZQ" autocomplete="off" spellcheck="false"${dis}></label>`}
    </div>
    <div class="uldw-unit-lih-row">
      <span class="uldw-lih-label">LIH 狀態</span>
      ${lihChipsHtml(unit, locked)}
    </div>
    <div class="uldw-unit-more">
      <label>RCL#<input type="text" data-unit-field="rcl_no" value="${esc(unit.rcl_no)}" autocomplete="off" spellcheck="false"${dis}></label>
      ${isBulk ? '' : `<label title="板重（kg，只顯示參考；RCL 已是淨重，不再從 RCL 扣除）">Tare（kg）<input type="number" min="0" step="${weightStep()}" data-unit-field="tare_weight" value="${esc(unit.tare_weight)}"${dis}></label>`}
      <label title="裝板物料重量（kg；只作磅差說明，仍由夾重票吸收）">物料（kg）<input type="number" min="0" step="${weightStep()}" data-unit-field="material_weight" value="${esc(unit.material_weight)}"${dis}></label>
      <label class="uldw-more-wide">Pre-decl<select data-unit-field="predecl_type"${dis}>${optionsHtml(ULD_PREDECL_TYPES, unit.predecl_type)}</select></label>
      <label>夾重方式<select data-unit-field="squeeze_mode"${dis}>${optionsHtml(ULD_SQUEEZE_MODES, unit.squeeze_mode)}</select></label>
    </div>
    <div class="uldw-table-wrap">
      <table class="uldw-items">
        <thead><tr>
          <th title="勾選＝這票參與夾重（可多票）">夾重</th><th>MAWB#</th><th>DEST</th><th>PCS</th>
          <th>WT（kg）</th><th class="uldw-col-optional">比例</th><th>最終（kg）</th><th class="uldw-col-optional">LIH</th><th></th>
        </tr></thead>
        <tbody>
          ${items.length
            ? items.map((item, i) => itemRowHtml(unit, item, i, locked)).join('')
            : '<tr><td colspan="9" class="uldw-empty-cell">還沒有 MAWB#：在下面輸入（可搜尋打板計劃 Booking）按 Enter 加入，或按「⧉ 貼上」一次貼多票。</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="uldw-item-add">
      <div class="uldw-ac-field">
        <input type="text" data-draft="mawb" value="${esc(draft.mawb || '')}" placeholder="MAWB#（Enter 加入，可搜尋 Booking）" autocomplete="off" spellcheck="false"${dis}>
      </div>
      <input type="text" class="uldw-draft-xs" data-draft="port" value="${esc(draft.port || '')}" placeholder="DEST" autocomplete="off" spellcheck="false"${dis}>
      <input type="number" class="uldw-draft-xs" min="0" step="1" data-draft="pcs" value="${esc(draft.pcs || '')}" placeholder="PCS"${dis}>
      <input type="number" class="uldw-draft-xs" min="0" step="${weightStep()}" data-draft="declared_weight" value="${esc(draft.declared_weight || '')}" placeholder="WT (kg)"${dis}>
      <select class="uldw-draft-lih" data-draft="lih_type"${dis}>${lihOptions(draft.lih_type || 'N')}</select>
      <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-primary" data-action="add-item" data-uid="${esc(unit.uid)}"${dis}>＋ 加入</button>
      <button type="button" class="uldw-btn uldw-btn-sm" data-action="paste-items" data-uid="${esc(unit.uid)}"${dis}
        title="貼上多列：從 Excel／booking list 複製 MAWB、DEST、PCS、WT（Tab 分隔）一次加入">⧉ 貼上</button>
      <span class="uldw-draft-hint" data-draft-hint="mawb"></span>
    </div>
  </div>`;
}

// ===== 明細列（每板 × 每 MAWB）=====
function rowForItem(item) {
  const key = uldMawbKey(item && item.mawb);
  if (!key) return null;
  return ((uldWeightState.current && uldWeightState.current.mawbs) || [])
    .find(row => uldMawbKey(row.mawb) === key) || null;
}

function itemRowHtml(unit, item, idx, locked) {
  const dis = locked ? ' disabled' : '';
  const manualRatio = unit.squeeze_mode === 'manual' && item.is_squeeze;
  // 方案 B：MAWB 在「載荷表」的申報列；卡片這裡唯讀。
  // WT（kg）可直接打字（2026-11-11）：與載荷表同一套規則——固定這一板、
  // 剩下的申報 WT 依件數分給同票其他板（Σ 仍等於申報 WT），該列同時轉手動。
  // 不再 readonly，也不需要上下箭頭微調（CSS 已隱藏 spinner）。
  const mawbRow = rowForItem(item);
  const weightAttrs = mawbRow ? ` data-item-weight="1" data-weight-row="${esc(mawbRow.uid)}"` : ' data-item-weight="1"';
  const weightTitle = mawbRow
    ? '直接輸入這一板的重量（其餘板依件數重新分配，Σ = 申報 WT）'
    : '直接輸入這一板的重量';
  const rowTitle = mawbRow ? '（MAWB 請在 ① MAWB LIST 改）' : '';
  // MAWB 檢查碼驗證（只做提示，不擋存檔）：有值但不合法 → 紅框＋title 說明
  const mawbCheck = uldValidateMawb(item.mawb);
  const mawbBad = !mawbCheck.ok && !mawbCheck.empty;
  const mawbTitle = item.mawb_record_id
    ? `已連結打板計劃 Booking Record #${item.mawb_record_id}`
    : (mawbBad ? uldMawbIssueText(mawbCheck) : '');
  return `
  <tr data-item-idx="${idx}" data-item-uid="${esc(item.uid)}" class="${item.is_squeeze ? 'is-squeeze' : ''}">
    <td><input type="checkbox" data-item-field="is_squeeze"${item.is_squeeze ? ' checked' : ''}${dis} title="勾選＝參與夾重"></td>
    <td><input type="text" class="uldw-input-mawb" data-item-field="mawb" value="${esc(item.mawb)}"${mawbRow ? ' readonly' : ''}${mawbBad ? ' data-mawb-invalid="1"' : ''}${mawbTitle ? ` title="${esc(mawbTitle + rowTitle)}"` : (rowTitle ? ` title="${esc(rowTitle)}"` : '')} autocomplete="off" spellcheck="false"${dis}></td>
    <td><input type="text" class="uldw-input-xs uldw-input-dest" data-item-field="port" value="${esc(item.port)}" autocomplete="off" spellcheck="false"${dis}></td>
    <td><input type="number" min="0" step="1" class="uldw-input-xs uldw-input-pcs" data-item-field="pcs" value="${esc(item.pcs)}"${dis} title="這一板的件數（重量依件數自動分）"></td>
    <td><input type="number" min="0" step="${weightStep()}" class="uldw-input uldw-input-wt" data-item-field="declared_weight"${weightAttrs} value="${esc(item.declared_weight)}"${dis} title="${esc(weightTitle)}"></td>
    <td class="uldw-ratio-cell uldw-col-optional">${manualRatio
      ? `<input type="number" min="0" step="1" class="uldw-input-xs uldw-input-ratio" data-item-field="squeeze_ratio" value="${esc(item.squeeze_ratio == null ? '' : item.squeeze_ratio)}"${dis} title="手動比例（%）">`
      : '<span data-calc="ratio">-</span>'}</td>
    <td class="uldw-final-cell"><span data-calc="final">-</span></td>
    <td class="uldw-col-optional"><select class="uldw-input-lih" data-item-field="lih_type"${dis}>${lihOptions(item.lih_type)}</select></td>
    <td class="uldw-row-btns">
      <button type="button" class="uldw-btn uldw-btn-sm" data-action="split-item" data-uid="${esc(unit.uid)}" data-item-uid="${esc(item.uid)}"${dis} title="把這票的申報件數平均分到各板">⇄</button>
      <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-danger" data-action="del-item" data-uid="${esc(unit.uid)}" data-item-uid="${esc(item.uid)}"${dis} title="從這一板移除（申報列仍在）">✕</button>
    </td>
  </tr>`;
}

// ===== MAWB 彙總表 =====
function mawbTableHtml(computed) {
  if (!computed.mawbs.length) return '<div class="uldw-empty-note">還沒有 MAWB</div>';
  const rows = computed.mawbs.map(row => `
    <tr>
      <td><b>${esc(row.mawb)}</b>${row.squeeze ? '' : ' <span class="uldw-chip uldw-chip-sm">不夾重</span>'}</td>
      <td>${row.pcs}</td>
      <td>${uldFmtKg(row.declared)}</td>
      <td><b>${uldFmtKg(row.final)}</b></td>
      <td class="${row.diff ? 'uldw-warn-text' : ''}">${row.diff > 0 ? '+' : ''}${uldFmtKg(row.diff)}</td>
      <td>${esc(row.ports.join('/') || '-')}</td>
      <td>${esc((row.lih || []).map(uldLihLabel).join('/') || '-')}</td>
    </tr>`).join('');
  return `<div class="uldw-table-wrap"><table class="uldw-table uldw-table-compact">
    <thead><tr><th>MAWB#</th><th>件數</th><th>原重（kg）</th><th>夾重後（kg）</th><th>差額（kg）</th><th>Port</th><th>LIH</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ===== 檢核清單 =====
function issuesHtml(computed) {
  // U1：沒問題時不要把「空盒子」留在畫面上（列印時仍會顯示，見 CSS 的 @media print）
  if (!computed.issues.length) return '<div class="uldw-ok uldw-issues-empty">✔ 沒有發現問題</div>';
  const items = computed.issues.map(issue => {
    const head = issue.label ? `${issue.label}：` : '';
    return `<li class="uldw-issue-${issue.level}">${issue.level === 'error' ? '⛔' : '⚠️'} ${esc(head)}${esc(uldIssueText(issue))}</li>`;
  }).join('');
  return `<ul class="uldw-issues">${items}</ul>`;
}

// ===== 合併頁底部合計 =====
function mergeTotalsInnerHtml(computed, sheet) {
  const totalPcs = (sheet.mawbs || []).reduce((sum, row) => sum + uldNum(row.pcs), 0);
  const t = computed.totals;
  return `<span><em>PLAN</em><b>${uldFmtKg(totalPcs)}</b> PCS</span>
    <span><em>RCL TTL</em><b>${uldFmtKg(t.rclTotal)}</b> kg</span>
    <span><em>夾重後</em><b>${uldFmtKg(t.netTotal)}</b> kg</span>
    <span class="${t.diffTotal ? 'is-warn' : ''}"><em>磅差</em><b>${t.diffTotal > 0 ? '+' : ''}${uldFmtKg(t.diffTotal)}</b> kg</span>`;
}

// ===== 全表合計（PLAN / RCL / DIFF，單位一律 kg）=====
function totalsHtml(computed) {
  const t = computed.totals;
  // PLAN TTL＝各票申報（booking）重量合計；RCL TTL＝各板 RCL（淨重）合計；DIFF＝RCL（淨）合計 − PLAN
  const planTotal = (computed.units || []).reduce((sum, unit) => sum + (unit.calc ? unit.calc.declaredSum : 0), 0);
  const planDiff = t.rclTotal - planTotal;
  const sign = (v) => (Number(v) > 0 ? '+' : '');
  return `<div class="uldw-totals-grid">
    <span class="uldw-ttl"><em>PLAN TTL</em> <b>${uldFmtKg(planTotal)}</b> kg</span>
    <span class="uldw-ttl"><em>RCL TTL</em> <b>${uldFmtKg(t.rclTotal)}</b> kg</span>
    <span class="uldw-ttl${Math.abs(planDiff) > 1e-9 ? ' uldw-warn-text' : ''}"><em>DIFF</em> <b>${sign(planDiff)}${uldFmtKg(planDiff)}</b> kg</span>
    <span class="uldw-ttl"><em>夾重後</em> <b>${uldFmtKg(t.netTotal)}</b> kg</span>
    <span class="uldw-ttl"><em>磅差</em> <b class="${t.diffTotal ? 'uldw-warn-text' : ''}">${sign(t.diffTotal)}${uldFmtKg(t.diffTotal)}</b> kg（${sign(t.diffTotal)}${(t.diffPct || 0).toFixed(2)}%）</span>
    <span class="uldw-ttl uldw-ttl-muted"><em>單位</em> <b>${t.unitCount}</b>${t.bulkCount ? `（散 ${t.bulkCount}）` : ''}</span>
    <span class="uldw-ttl uldw-ttl-muted"><em>MAWB</em> <b>${t.mawbCount}</b></span>
    <span class="uldw-ttl uldw-ttl-muted"><em>件數</em> <b>${t.pcsTotal}</b></span>
    <span class="uldw-ttl uldw-ttl-muted"><em>Tare</em> <b>${uldFmtKg(t.tareTotal)}</b> kg</span>
    ${t.hasError ? '<span class="uldw-warn-text">⛔ 有錯誤，請先修正再儲存</span>' : ''}
  </div>`;
}

// ===== RCL 磅單匯入面板（W3）=====
const RCL_FIELD_DEFS = [
  { key: 'uld', label: 'ULD#／板號' },
  { key: 'tare', label: 'Tare（板重）' },
  { key: 'gross', label: 'RCL WT（淨重）' },
  { key: 'pcs', label: '件數' }
];

function rclColumnSelectHtml(key, imp) {
  const current = Number((imp.columns || {})[key] != null ? imp.columns[key] : -1);
  const none = `<option value="-1"${current < 0 ? ' selected' : ''}>（不使用）</option>`;
  const opts = rclColumnOptions(imp.header || []).map(opt =>
    `<option value="${opt.index}"${current === opt.index ? ' selected' : ''}>${esc(opt.label)}</option>`).join('');
  return `<select data-rcl="col" data-rcl-key="${key}">${none}${opts}</select>`;
}

function rclPanelInnerHtml(imp) {
  const sheetPicker = (imp.sheets || []).length > 1
    ? `<label class="uldw-rcl-sheet">工作表<select data-rcl="sheet">${imp.sheets.map(name =>
        `<option value="${esc(name)}"${name === imp.sheetName ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`
    : `<span class="uldw-rcl-sheet">工作表：${esc(imp.sheetName || '-')}</span>`;
  const header = `<div class="uldw-rcl-head">
      <b>⇪ RCL 磅單匯入</b>
      <span class="uldw-rcl-file">${esc(imp.fileName || '')}</span>
      ${sheetPicker}
    </div>`;

  if (imp.busy) return `${header}<div class="uldw-rcl-busy">解析中…</div>`;

  const rows = imp.rows || [];
  const skipped = imp.skipped || [];
  const selected = new Set(imp.selected || []);
  const mapping = RCL_FIELD_DEFS.map(def =>
    `<label>${esc(def.label)}${rclColumnSelectHtml(def.key, imp)}</label>`).join('');

  const body = rows.length
    ? rows.map((row, idx) => {
      const warn = (row.warnings || [])
        .map(code => `<span class="uldw-warn-text">${esc(rclWarningText(code))}</span>`).join(' ');
      return `<tr class="${selected.has(idx) ? 'is-selected' : ''}">
        <td><input type="checkbox" data-rcl-row="${idx}"${selected.has(idx) ? ' checked' : ''}></td>
        <td>${esc(String((imp.headerRow || 0) + row.row))}</td>
        <td><b>${esc(row.uld_number)}</b></td>
        <td class="uldw-num">${uldFmtKg(row.tare_weight)}</td>
        <td class="uldw-num">${uldFmtKg(row.rcl_gross_weight)}</td>
        <td class="uldw-num">${row.pcs || 0}</td>
        <td>${warn}</td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="7" class="uldw-empty-cell">沒有可匯入的資料，請調整「欄位對應」或換一個工作表。</td></tr>';

  const skippedHtml = skipped.length
    ? `<div class="uldw-rcl-skipped">略過 ${skipped.length} 列：${skipped.slice(0, 5).map(s =>
        `${s.row ? `第 ${(imp.headerRow || 0) + s.row} 列 ` : ''}${rclSkipReasonText(s.reason)}`).join('；')}${skipped.length > 5 ? '…' : ''}</div>`
    : '';

  return `${header}
    <div class="uldw-rcl-mapping">${mapping}</div>
    <div class="uldw-rcl-table-wrap">
      <table class="uldw-table uldw-rcl-table">
        <thead><tr><th></th><th>列</th><th>ULD#</th><th>Tare</th><th>RCL WT（淨重）</th><th>件數</th><th>備註</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${skippedHtml}
    <div class="uldw-rcl-actions">
      <span class="uldw-rcl-count">已勾選 ${selected.size}／${rows.length} 個單位（Pre-decl 預設 P，加入後可改）</span>
      <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-primary" data-action="rcl-add"${rows.length ? '' : ' disabled'}>加入選取的單位</button>
      <button type="button" class="uldw-btn uldw-btn-sm" data-action="rcl-cancel">取消匯入</button>
    </div>`;
}

function rclPanelHtml() {
  const imp = uldWeightState.rclImport;
  if (!imp) return '';
  return `<div class="uldw-rcl" id="uldw-rcl-panel">${rclPanelInnerHtml(imp)}</div>`;
}

// 只重畫匯入面板（勾選／切換欄位時用，避免整份重畫）
export function refreshRclImport(root) {
  if (!root) return;
  const box = root.querySelector('#uldw-rcl-panel');
  if (!box) return;
  const imp = uldWeightState.rclImport;
  if (!imp) {
    box.remove();
    return;
  }
  box.innerHTML = rclPanelInnerHtml(imp);
}

// ===== V3：版本紀錄面板 =====
const VERSION_ACTION_LABELS = {
  create: '建立',
  save: '儲存',
  lock: '鎖定',
  unlock: '解鎖',
  apply: '套用 Booking',
  sync_bookings: '補建 Booking',
  duplicate: '複製'
};

function versionActionLabel(action) {
  return VERSION_ACTION_LABELS[action] || String(action || '');
}

function fmtVersionTime(value) {
  const raw = String(value || '');
  if (!raw) return '-';
  // 後端回 ISO（2026-11-06T03:04:05Z）→ 顯示本地 MM-DD HH:mm
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return raw;
  if (!/Z$/.test(raw)) return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDiffValue(change, side) {
  const raw = side === 'from' ? change.from : change.to;
  if (raw === '' || raw == null) return '（空）';
  if (change.field === 'squeeze_ratio') {
    const n = Number(raw);
    return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : String(raw);
  }
  if (change.kg) return `${uldFmtKg(raw)} kg`;
  return String(raw);
}

function versionDiffHtml() {
  const d = uldWeightState.versionDiff;
  if (!d) return '';
  if (d.loading) return '<div class="uldw-version-diff"><span class="uldw-version-muted">比對中…</span></div>';
  if (d.error) return `<div class="uldw-version-diff uldw-version-diff-error">${esc(d.error)}</div>`;
  const diff = d.data || {};
  const s = diff.summary || {};
  const fromNo = d.from && d.from.version_no ? `v${d.from.version_no}` : '（無）';
  const toNo = d.to && d.to.id ? `v${d.to.version_no}` : '目前內容';
  const head = `<div class="uldw-version-diff-head"><b>${esc(fromNo)} → ${esc(toNo)}</b>`
    + `　表頭 ${s.header || 0}　MAWB +${s.mawbsAdded || 0}／-${s.mawbsRemoved || 0}／~${s.mawbsChanged || 0}`
    + `　單位 +${s.unitsAdded || 0}／-${s.unitsRemoved || 0}／~${s.unitsChanged || 0}`
    + `　明細 +${s.itemsAdded || 0}／-${s.itemsRemoved || 0}／~${s.itemsChanged || 0}</div>`;
  if (!diff.hasChanges) {
    return `<div class="uldw-version-diff">${head}<div class="uldw-version-muted">兩者內容相同</div></div>`;
  }
  const lines = [];
  (diff.header || []).forEach(change => {
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-chg">表頭</span>${esc(change.label)}：`
      + `${esc(fmtDiffValue(change, 'from'))} → <b>${esc(fmtDiffValue(change, 'to'))}</b></li>`);
  });
  // 方案 B：MAWB 申報列（表級）
  ((diff.mawbs && diff.mawbs.added) || []).forEach(row => {
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-add">新增 MAWB</span>${esc(row.mawb || '（無 MAWB）')}`
      + `　${row.pcs || 0} PCS／${uldFmtKg(row.weight)} kg</li>`);
  });
  ((diff.mawbs && diff.mawbs.removed) || []).forEach(row => {
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-del">刪除 MAWB</span>${esc(row.mawb || '（無 MAWB）')}`
      + `　${row.pcs || 0} PCS／${uldFmtKg(row.weight)} kg</li>`);
  });
  ((diff.mawbs && diff.mawbs.changed) || []).forEach(row => {
    const fields = (row.fields || [])
      .map(change => `${esc(change.label)} ${esc(fmtDiffValue(change, 'from'))} → ${esc(fmtDiffValue(change, 'to'))}`)
      .join('；');
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-chg">改 MAWB</span>${esc(row.mawb || '（無 MAWB）')}：${fields}</li>`);
  });
  (diff.units.added || []).forEach(unit => {
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-add">新增單位</span>${esc(unit.label)}（${unit.items || 0} 票）</li>`);
  });
  (diff.units.removed || []).forEach(unit => {
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-del">刪除單位</span>${esc(unit.label)}（${unit.items || 0} 票）</li>`);
  });
  (diff.units.changed || []).forEach(unit => {
    const fields = (unit.fields || [])
      .map(change => `${esc(change.label)} ${esc(fmtDiffValue(change, 'from'))} → ${esc(fmtDiffValue(change, 'to'))}`)
      .join('；');
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-chg">改單位</span>${esc(unit.label)}：${fields}</li>`);
  });
  (diff.items.added || []).forEach(item => {
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-add">新增票</span>${esc(item.unitLabel)}／`
      + `${esc(item.mawb || '（無 MAWB）')}　${uldFmtKg(item.to)} kg</li>`);
  });
  (diff.items.removed || []).forEach(item => {
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-del">刪除票</span>${esc(item.unitLabel)}／`
      + `${esc(item.mawb || '（無 MAWB）')}　${uldFmtKg(item.from)} kg</li>`);
  });
  (diff.items.changed || []).forEach(item => {
    const fields = (item.fields || [])
      .map(change => `${esc(change.label)} ${esc(fmtDiffValue(change, 'from'))} → ${esc(fmtDiffValue(change, 'to'))}`)
      .join('；');
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-chg">改票</span>${esc(item.unitLabel)}／`
      + `${esc(item.mawb || '（無 MAWB）')}：${fields}</li>`);
  });
  return `<div class="uldw-version-diff">${head}<ul class="uldw-diff-list">${lines.join('')}</ul></div>`;
}

function versionsPanelInnerHtml() {
  const v = uldWeightState.versions || { open: false, loading: false, list: [], error: '' };
  const head = `<div class="uldw-versions-head">
      <b>🕘 版本紀錄</b>
      <span class="uldw-version-muted">每次儲存／鎖定／解鎖／套用 Booking／補建 Booking 都會留一份（每張表保留最近 30 版）</span>
      <button type="button" class="uldw-btn uldw-btn-sm" data-action="versions-close">關閉</button>
    </div>`;
  if (v.loading) return `${head}<div class="uldw-version-muted">載入中…</div>`;
  if (v.error) return `${head}<div class="uldw-version-diff-error">載入版本失敗：${esc(v.error)}</div>`;
  const list = v.list || [];
  if (!list.length) return `${head}<div class="empty-state">這張表還沒有版本紀錄（第一次儲存後就會出現）。</div>`;
  const rows = list.map((version, index) => {
    const prev = list[index + 1]; // 清單是新到舊 → 下一個就是上一版
    const summary = version.summary || {};
    const comparePrev = prev
      ? `<button type="button" class="uldw-btn uldw-btn-sm" data-action="version-diff" data-from="${prev.id}" data-to="${version.id}">與前一版比</button>`
      : '';
    return `<tr>
      <td>v${version.version_no}</td>
      <td>${esc(fmtVersionTime(version.created_at))}</td>
      <td>${esc(versionActionLabel(version.action))}${version.note ? `（${esc(version.note)}）` : ''}</td>
      <td>${version.status === 'locked' ? '已鎖定' : '草稿'}</td>
      <td>${summary.uldCount != null ? summary.uldCount : '-'}／${summary.itemCount != null ? summary.itemCount : '-'}</td>
      <td>${uldFmtKg(summary.netTotal)}</td>
      <td>${(Number(summary.diffTotal) || 0) > 0 ? '+' : ''}${uldFmtKg(summary.diffTotal)}</td>
      <td>${esc(version.created_by || '-')}</td>
      <td class="uldw-version-actions">
        ${comparePrev}
        <button type="button" class="uldw-btn uldw-btn-sm" data-action="version-diff" data-from="${version.id}" data-to="0">對目前</button>
      </td>
    </tr>`;
  }).join('');
  return `${head}
    <div class="uldw-table-wrap"><table class="uldw-table uldw-version-table">
      <thead><tr>
        <th>版</th><th>時間</th><th>動作</th><th>狀態</th><th>單位／明細</th>
        <th>淨重</th><th>磅差</th><th>建立者</th><th>比較</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${versionDiffHtml()}`;
}

function versionsPanelHtml() {
  const v = uldWeightState.versions;
  if (!v || !v.open) return '';
  return `<div class="uldw-versions" id="uldw-versions">${versionsPanelInnerHtml()}</div>`;
}

// 只重畫版本面板（比對時用，避免整份重畫）
export function refreshVersions(root) {
  if (!root) return;
  const box = root.querySelector('#uldw-versions');
  if (!box) return;
  const v = uldWeightState.versions;
  if (!v || !v.open) {
    box.remove();
    return;
  }
  box.innerHTML = versionsPanelInnerHtml();
}

// ===== 局部更新（只更新計算結果，不動輸入框 → 不會失去焦點）=====
export function refreshComputed(root) {
  if (!root) return;
  const sheet = uldWeightState.current;
  if (!sheet) return;
  const computed = uldComputed();
  const scope = root.querySelector('.uldw-editor') || root;

  const unitEls = Array.from(scope.querySelectorAll('.uldw-unit'));
  unitEls.forEach((unitEl, idx) => {
    const unitResult = computed.units[idx];
    if (!unitResult) return;
    const calc = unitResult.calc;

    const chips = unitEl.querySelector('[data-calc="chips"]');
    if (chips) {
      const typeLabel = calc.kind === 'BULK' ? 'B' : (unitResult.predecl_type || 'P');
      const modeLabel = (ULD_SQUEEZE_MODES.find(m => m.code === unitResult.squeeze_mode) || {}).label || '';
      chips.innerHTML = `<span class="uldw-chip uldw-chip-kind">${esc(typeLabel)}</span>`
        + `<span class="uldw-chip">${esc(modeLabel)}</span>`
        + diffChip(calc.diff, calc.diffPct)
        + (calc.hasError ? '<span class="uldw-chip uldw-chip-bad">有錯誤</span>' : '');
    }

    const summary = unitEl.querySelector('[data-calc="summary"]');
    if (summary) {
      const tailWarn = Math.abs(calc.diffAfterFinal) > 1e-9
        ? ` <span class="uldw-warn-text">與目標差 ${uldFmtKg(calc.diffAfterFinal)}</span>`
        : '';
      // 業界讀法：PCS · RCL（淨重）· Tare 參考 → 夾重後合計 kg（磅差看 chips）
      summary.innerHTML = `<span class="uldw-sum-main">${calc.pcsSum} PCS ｜ RCL（淨）${uldFmtKg(calc.rclGross)} kg`
        + `${calc.tare ? ` ｜ Tare ${uldFmtKg(calc.tare)} kg 參考` : ''} → 夾重後 <b>${uldFmtKg(calc.finalSum)}</b> kg</span>`
        + `<span class="uldw-sum-sub">申報 ${uldFmtKg(calc.declaredSum)} kg ｜ 取整 ${uldFmtKg(calc.roundInc)}${tailWarn}</span>`;
    }

    const rows = unitEl.querySelectorAll('tr[data-item-uid]');
    rows.forEach((row, i) => {
      const item = calc.items[i];
      if (!item) return;
      const ratioEl = row.querySelector('[data-calc="ratio"]');
      if (ratioEl) {
        // R2：比例被上下限限制時在後面標 *（滑鼠移上去看原因）
        ratioEl.textContent = item.squeeze
          ? `${(item.ratio * 100).toFixed(1)}%${item.ratioClamped ? ' *' : ''}`
          : '-';
        if (item.ratioClamped) ratioEl.title = '已套用比例上下限（表頭「比例下限／上限 %」）';
      }
      const finalEl = row.querySelector('[data-calc="final"]');
      if (finalEl) finalEl.textContent = uldFmtKg(item.final);
      // 卡片 WT 可直接打字（2026-11-11）：打完之後其他板會依件數重新分配 →
      // 同步其他輸入框的值；**跳過正在打字的那一格**（否則游標會跳）。
      const wtInput = row.querySelector('input[data-item-field="declared_weight"]');
      const typing = typeof document !== 'undefined' && document && document.activeElement === wtInput;
      if (wtInput && !typing) {
        const next = String(Math.round(uldNum(item.declared) * 10) / 10);
        if (wtInput.value !== next) wtInput.value = next;
      }
      row.classList.toggle('is-squeeze', !!item.squeeze);
      // U1 色碼：申報 ≠ 最終 → 橙（重量被改）
      const changed = Math.abs(Number(item.final) - Number(item.declared)) > 1e-9;
      row.classList.toggle('is-changed', changed);
    });
  });

  const mawbBox = scope.querySelector('#uldw-mawb-table');
  if (mawbBox) mawbBox.innerHTML = mawbTableHtml(computed);
  const issueBox = scope.querySelector('#uldw-issues');
  if (issueBox) {
    issueBox.innerHTML = issuesHtml(computed);
    // U1：沒有檢核問題時，連「檢核」標題一起收起來（列印時 CSS 會還原）
    const head = issueBox.previousElementSibling;
    if (head && head.classList) head.classList.toggle('is-hidden', computed.issues.length === 0);
  }
  const totalsBox = scope.querySelector('#uldw-totals');
  if (totalsBox) totalsBox.innerHTML = totalsHtml(computed);

  // 新 UI：① MAWB LIST 的「最終」與「分板」也跟著更新（不重畫輸入框）
  const panelRows = Array.from(scope.querySelectorAll('#uldw-mawb-panel tr[data-row-uid]'));
  panelRows.forEach(tr => {
    const row = uldFindMawb(tr.dataset.rowUid);
    if (!row) return;
    const key = uldMawbKey(row.mawb);
    const total = (computed.mawbs || []).find(item => item.key === key) || null;
    const finalEl = tr.querySelector('[data-calc="row-final"]');
    if (finalEl) finalEl.textContent = total ? uldFmtKg(total.final) : '-';
    const assignEl = tr.querySelector('.uldw-mawb-assign');
    if (assignEl) {
      const links = uldMawbLinks(row);
      const assigned = links.reduce((sum, link) => sum + Math.max(0, uldNum(link.item.pcs)), 0);
      const unassigned = Math.max(0, uldNum(row.pcs) - assigned);
      assignEl.innerHTML = links.length
        ? `<span title="已分到 ${links.length} 板">${links.length} 板${unassigned > 0 ? ` <em>餘 ${unassigned} 件</em>` : ''}</span>`
        : '<span class="is-warn">未分配</span>';
    }
  });

  // 新 UI：③ 合併／分配頁（不重畫卡片；更新左邊 MAWB 狀態／夾重後、卡片重量輸入、footer、檢核）
  const chipTotals = new Map((computed.mawbs || []).map(m => [m.key, m]));
  Array.from(scope.querySelectorAll('[data-mawb-chip]')).forEach(chip => {
    const row = uldFindMawb(chip.dataset.rowUid);
    if (!row) return;
    const key = uldMawbKey(row.mawb);
    const pcs = uldNum(row.pcs);
    const assigned = uldMawbAssignedPcs(row);
    const remaining = Math.max(0, pcs - assigned);
    const done = pcs > 0 && remaining === 0;
    const stateEl = chip.querySelector('.uldw-chip-state');
    if (stateEl) {
      stateEl.textContent = pcs <= 0 ? '未填件數' : (done ? '已分配' : `餘 ${remaining} 件`);
      if (stateEl.classList) {
        stateEl.classList.toggle('is-done', pcs > 0 && done);
        stateEl.classList.toggle('is-todo', pcs > 0 && !done);
        stateEl.classList.toggle('is-empty', pcs <= 0);
      }
    }
    if (chip.classList) chip.classList.toggle('is-done', done);
    // 板數／夾重後只放在 MAWB 的 tooltip（不放版面，維持「一列一票」的緊湊高度）
    const mawbEl = chip.querySelector('.uldw-chip-main b');
    if (mawbEl) {
      const boards = uldMawbLinks(row).length;
      const mawbText = row.mawb ? uldFormatMawb(row.mawb) : '（未填 MAWB#）';
      const total = chipTotals.get(key);
      const finalText = total && Math.abs(total.final - uldNum(row.declared_weight)) > 1e-9
        ? ` ｜ 夾重後 ${uldFmtKg(total.final)} kg`
        : '';
      mawbEl.title = `${mawbText}${boards > 1 ? `（分到 ${boards} 塊板；其他板沒上這票是正常的）` : ''}${finalText}`;
    }
  });

  const mergeTotals = scope.querySelector('#uldw-merge-totals');
  if (mergeTotals) mergeTotals.innerHTML = mergeTotalsInnerHtml(computed, sheet);
  const mergeIssues = scope.querySelector('#uldw-merge-issues');
  if (mergeIssues) {
    const list = mergeIssues.querySelector('#uldw-merge-issues-list');
    if (list) list.innerHTML = issuesHtml(computed);
    const summary = mergeIssues.querySelector('#uldw-merge-issues-summary');
    if (summary) summary.innerHTML = `<b>${mergeIssuesCountsText(computed)}</b>（點開看內容）`;
    mergeIssues.hidden = computed.issues.length === 0;
    if (!computed.issues.length) mergeIssues.open = false;
  }
  // ③ 合併／分配（矩陣）：每欄的欄頭錯誤、欄底合計、每格的重量與顏色
  const calcByUid = new Map((computed.units || []).map(u => [u.uid, u]));
  Array.from(scope.querySelectorAll('.uldw-mx-head')).forEach(head => {
    const unitResult = calcByUid.get(head.dataset.uid);
    if (!unitResult) return;
    if (head.classList) head.classList.toggle('is-error', !!unitResult.calc.hasError);
  });
  Array.from(scope.querySelectorAll('.uldw-mx-foot')).forEach(foot => {
    const unitResult = calcByUid.get(foot.dataset.uid);
    if (!unitResult) return;
    const calc = unitResult.calc;
    foot.innerHTML = `<span>${calc.items.length} 票 ｜ ${calc.pcsSum} PCS</span>`
      + `<span>夾重後 <b>${uldFmtKg(calc.finalSum)}</b> kg</span>`;
    if (foot.classList) foot.classList.toggle('is-error', !!calc.hasError);
  });
  Array.from(scope.querySelectorAll('.uldw-mx-cell[data-item-uid]')).forEach(cell => {
    const unitResult = calcByUid.get(cell.dataset.uid);
    if (!unitResult) return;
    const calc = unitResult.calc;
    const itemUid = cell.dataset.itemUid;
    const item = calc.items.find(ci => ci.uid != null && String(ci.uid) === String(itemUid));
    if (!item) return;
    // 重量輸入：這一板固定、其他板依件數重分 → 同步其他輸入框（跳過正在打字的那一個）
    const wtInput = cell.querySelector('input[data-item-field="declared_weight"]');
    const typing = typeof document !== 'undefined' && document && document.activeElement === wtInput;
    if (wtInput && !typing) {
      const next = String(Math.round(uldNum(item.declared) * 10) / 10);
      if (wtInput.value !== next) wtInput.value = next;
    }
    if (wtInput) wtInput.title = `直接輸入這一板的重量（kg）；夾重後 ${uldFmtKg(item.final)} kg`;
    if (cell.classList) {
      cell.classList.toggle('is-squeeze', !!item.squeeze);
      cell.classList.toggle('is-changed', Math.abs(item.final - item.declared) > 1e-9);
    }
  });

  // 方案 B：載荷表（唯讀格：上數／各板 WT／板合計／PLAN·RCL·DIFF）也只做局部更新
  if (scope.querySelector('.uldw-grid')) refreshGridComputed(root, computed, sheet);
}


