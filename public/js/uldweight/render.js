// ===== ULD 夾重系統：畫面渲染 =====
// 只負責「畫」與「局部更新」；事件綁定在 uld-weight.js（root 上委派）
import {
  ULD_TERMINALS, ULD_PREDECL_TYPES, ULD_LIH_TYPES, ULD_SQUEEZE_MODES, ULD_TAIL_MODES,
  uldFmtKg, uldIssueText
} from './calc.js';
import { uldWeightState, uldComputed, ULD_MAX_UNITS } from './state.js';
import { wireBookingPickers } from './booking-search.js';
import { rclColumnOptions, rclSkipReasonText, rclWarningText } from './rcl-parse.js';

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

// 磅差 chip：≤1% 綠、≤3% 黃、>3% 紅
function diffChip(diff, pct) {
  const absPct = Math.abs(pct || 0);
  const tone = absPct <= 1 ? 'ok' : (absPct <= 3 ? 'warn' : 'bad');
  const sign = diff > 0 ? '+' : '';
  return `<span class="uldw-chip uldw-chip-${tone}">磅差 ${sign}${uldFmtKg(diff)} kg（${sign}${(pct || 0).toFixed(2)}%）</span>`;
}

// ===== 清單 =====
export function renderList(root) {
  const state = uldWeightState;
  const rows = state.sheets || [];
  const filter = state.listFilter || { search: '', status: '' };
  // V2：批次下載的勾選狀態（只算「目前清單看得到的列」）
  const selected = new Set((state.batchSelected || []).map(id => Number(id)));
  const selectedRows = rows.filter(row => selected.has(Number(row.id)));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const body = rows.length
    ? rows.map(row => {
      const locked = row.status === 'locked';
      const picked = selected.has(Number(row.id));
      return `
      <tr data-sheet-id="${row.id}"${picked ? ' class="is-batch-selected"' : ''}>
        <td class="uldw-batch-cell"><input type="checkbox" data-batch-id="${row.id}"${picked ? ' checked' : ''} aria-label="選取 ${esc(row.sheet_no)}"></td>
        <td><b>${esc(row.sheet_no)}</b></td>
        <td>${esc(row.sheet_date || '-')}</td>
        <td>${esc(row.terminal || '-')}</td>
        <td>${esc(row.flight_no || '-')}</td>
        <td>${row.uld_count || 0}${row.bulk_count ? `（散 ${row.bulk_count}）` : ''}</td>
        <td>${uldFmtKg(row.rcl_total)}</td>
        <td>${uldFmtKg(row.net_total)}</td>
        <td>${row.diff_total > 0 ? '+' : ''}${uldFmtKg(row.diff_total)}</td>
        <td><span class="uldw-status uldw-status-${locked ? 'locked' : 'draft'}">${locked ? '已鎖定' : '草稿'}</span></td>
        <td class="uldw-row-actions">
          <button type="button" class="uldw-btn uldw-btn-sm" data-action="open" data-id="${row.id}">開啟</button>
          <button type="button" class="uldw-btn uldw-btn-sm" data-action="duplicate" data-id="${row.id}">複製</button>
          <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-danger" data-action="delete" data-id="${row.id}"${locked ? ' disabled' : ''}>刪除</button>
        </td>
      </tr>`;
    }).join('')
    : '';

  root.innerHTML = `
    <div class="uldw-list-toolbar">
      <input type="text" id="uldw-list-search" placeholder="搜尋編號／航班／經手人" value="${esc(filter.search)}">
      <select id="uldw-list-status">
        <option value="">全部狀態</option>
        <option value="draft"${filter.status === 'draft' ? ' selected' : ''}>草稿</option>
        <option value="locked"${filter.status === 'locked' ? ' selected' : ''}>已鎖定</option>
      </select>
      <span class="uldw-list-count">共 ${rows.length} 張</span>
      <span class="uldw-batch-bar">
        <span class="uldw-batch-count" id="uldw-batch-count">已選 ${selectedRows.length} 張</span>
        <button type="button" class="uldw-btn uldw-btn-sm" id="uldw-batch-pdf" data-action="batch-pdf"
          title="把勾選的夾重表各產一份 A4 PDF，打包成一個 ZIP（含 manifest.txt 清單；一次最多 50 張）"
          ${selectedRows.length ? '' : ' disabled'}>⤓ 批次 PDF</button>
      </span>
    </div>
    ${rows.length
      ? `<div class="uldw-table-wrap"><table class="uldw-table">
          <thead><tr>
            <th class="uldw-batch-cell"><input type="checkbox" id="uldw-batch-all" title="全選／取消全選"${allSelected ? ' checked' : ''}></th>
            <th>夾重表</th><th>日期</th><th>貨站</th><th>航班</th><th>單位</th>
            <th>RCL 總重</th><th>淨重</th><th>磅差</th><th>狀態</th><th>操作</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table></div>`
      : '<div class="empty-state">還沒有夾重表，按右上角「＋ 新增夾重表」開始。</div>'}
  `;
}


// ===== 編輯畫面（整份重畫；輸入中的欄位由 refreshComputed 局部更新，不會被重畫）=====
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
  // U1：顯示狀態（舊物件沒有 ui 時補上，避免測試／舊狀態直接呼叫時爆錯）
  const ui = state.ui || (state.ui = { more: false, advanced: false, expanded: {}, allCompact: false, printUnit: null });
  const advOpen = !!ui.advanced;

  root.innerHTML = `
    <div class="uldw-editor${locked ? ' is-locked' : ''}" data-sheet-id="${sheet.id}">
      <div class="uldw-editor-head">
        <div class="uldw-editor-title">
          <b>${esc(sheet.sheet_no)}</b>
          <span class="uldw-status uldw-status-${locked ? 'locked' : 'draft'}">${locked ? '已鎖定' : '草稿'}</span>
          <span class="uldw-dirty" id="uldw-dirty-flag" style="display:${state.dirty ? '' : 'none'}">● 未儲存</span>
        </div>
        <div class="uldw-editor-actions">
          <button type="button" class="uldw-btn" data-action="back">← 列表</button>
          <button type="button" class="uldw-btn uldw-btn-primary" data-action="save"${locked ? ' disabled' : ''}>儲存</button>
          <button type="button" class="uldw-btn" data-action="${locked ? 'unlock' : 'lock'}">${locked ? '解鎖' : '鎖定'}</button>
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
        <label>航班<input type="text" data-header="flight_no" value="${esc(sheet.flight_no)}" placeholder="CX1234"${dis}></label>
        <label>航班日期<input type="date" data-header="flight_date" value="${esc(sheet.flight_date)}"${dis}></label>
        <label>經手人<input type="text" data-header="handler" value="${esc(sheet.handler)}"${dis}></label>
        <button type="button" class="uldw-btn uldw-btn-sm uldw-adv-toggle" data-action="toggle-adv"
          title="進階參數：B 取整／尾差／磅差警示門檻／比例上下限（不常改，收起來畫面比較清爽）">${advOpen ? '▾' : '⚙'} 進階</button>
        <div class="uldw-adv${advOpen ? ' is-open' : ''}">
        <label class="uldw-print-hide" title="交散貨（B）的重量取整單位；交板（P/X）一律整數">B 取整<select data-header="round_b"${dis}>
          <option value="0.5"${Number(sheet.round_b) === 0.5 ? ' selected' : ''}>0.5</option>
          <option value="1"${Number(sheet.round_b) === 1 ? ' selected' : ''}>1.0</option>
        </select></label>
        <label class="uldw-print-hide" title="各票取整後與目標淨重的差額怎麼處理">尾差<select data-header="tail_mode"${dis}>${optionsHtml(ULD_TAIL_MODES, sheet.tail_mode)}</select></label>
        <label class="uldw-print-hide" title="磅差警示門檻（%）：要與右邊的 kg「同時」超過才會提示「磅差過大」（預設 2%；0 或空白＝用預設）">磅差警示 %<input type="number" min="0" step="0.1" data-header="diff_warn_pct" value="${esc(sheet.diff_warn_pct)}"${dis}></label>
        <label class="uldw-print-hide" title="磅差警示門檻（kg）：要與左邊的 %「同時」超過才會提示「磅差過大」（預設 100kg；0 或空白＝用預設）">磅差警示 kg<input type="number" min="0" step="1" data-header="diff_warn_kg" value="${esc(sheet.diff_warn_kg)}"${dis}></label>
        <label class="uldw-print-hide" title="多票夾重時，單票最少分到多少比例（%；0 或空白＝不限）。超出範圍的部分會依比例重分配給其他票">比例下限 %<input type="number" min="0" max="100" step="1" data-header="clamp_min_pct" value="${esc(sheet.clamp_min_pct)}"${dis}></label>
        <label class="uldw-print-hide" title="多票夾重時，單票最多分到多少比例（%；0 或空白＝不限）。例：填 60 → 任何一票最多吸收 60% 的磅差">比例上限 %<input type="number" min="0" max="100" step="1" data-header="clamp_max_pct" value="${esc(sheet.clamp_max_pct)}"${dis}></label>
        </div>
        <label class="uldw-field-wide">備註<input type="text" data-header="remark" value="${esc(sheet.remark)}"${dis}></label>
      </div>

      ${rclPanelHtml()}
      ${versionsPanelHtml()}

      <div class="uldw-columns">
        <div class="uldw-col uldw-col-units">
          <div class="uldw-col-head">
            <span>① 收貨單位 <b>${(sheet.ulds || []).length}</b> / ${ULD_MAX_UNITS}</span>
            <span class="uldw-col-actions">
              <button type="button" class="uldw-btn uldw-btn-sm" data-action="add-uld"${dis}>＋ 新增 ULD</button>
              <button type="button" class="uldw-btn uldw-btn-sm" data-action="add-bulk"${dis}>＋ 散貨</button>
              <button type="button" class="uldw-btn uldw-btn-sm" data-action="import-rcl"${dis} title="從貨站 RCL 磅單（Excel／CSV）匯入 ULD、Tare、Gross 與件數（可先預覽勾選）">⇪ 匯入 RCL</button>
              <button type="button" class="uldw-btn uldw-btn-sm" data-action="toggle-compact"
                title="一次展開／收合所有卡片的次要欄位（Contour／Tare／LIH／Pre-decl…）">${ui.expandAll ? '全部收合' : '全部展開'}</button>
            </span>
            <span class="uldw-legend" aria-hidden="true">
              <span class="uldw-legend-sq" data-tone="squeeze"></span>夾重
              <span class="uldw-legend-sq" data-tone="changed"></span>WT 已改
            </span>
          </div>
          <div class="uldw-unit-list" data-compact="${ui.expandAll ? '0' : '1'}">
            ${(sheet.ulds || []).length
              ? sheet.ulds.map((unit, idx) => unitCardHtml(unit, idx, locked)).join('')
              : '<div class="empty-state">① 先按「＋ 新增 ULD」或「⇪ 匯入 RCL」<br>② 在卡片下方輸入 MAWB#（Enter 加入）或「⧉ 貼上」多票<br>③ 勾選要夾重的票 → 看右側結果與底部 PLAN／RCL／DIFF</div>'}
          </div>
        </div>
        <div class="uldw-col uldw-col-result">
          <div class="uldw-col-head"><span>② 夾重結果（MAWB 彙總）</span></div>
          <div id="uldw-mawb-table"></div>
          <div class="uldw-col-head"><span>③ 檢核</span></div>
          <div id="uldw-issues"></div>
        </div>
      </div>

      <div class="uldw-totals" id="uldw-totals"></div>
      <datalist id="uldw-contour-list">
        ${contourCodes.map(code => `<option value="${esc(code)}"></option>`).join('')}
      </datalist>
    </div>
  `;

  refreshComputed(root);
  // 「新增 MAWB」列：MAWB 輸入框接上打板計劃 Booking Record 的輸入即篩選
  // （選到後自動帶入件數／重量／Port 與 mawb_record_id；手動輸入仍可用）
  wireBookingPickers(root);
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
        ? `<input type="text" class="uldw-unit-no" data-unit-field="bulk_ref" value="${esc(unit.bulk_ref)}" placeholder="批號／RCL"${dis}>`
        : `<input type="text" class="uldw-unit-no" data-unit-field="uld_number" value="${esc(unit.uld_number)}" placeholder="PMC12345QR"${dis}>`}
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
      <label>Port<input type="text" data-unit-field="port" value="${esc(unit.port)}" placeholder="HKG"${dis}></label>
      <label>件數<input type="number" min="0" step="1" data-unit-field="pcs" value="${esc(unit.pcs)}"${dis}></label>
      <label>RCL<input type="number" min="0" step="0.1" data-unit-field="rcl_gross_weight" value="${esc(unit.rcl_gross_weight)}"${dis}></label>
    </div>
    <div class="uldw-unit-more">
      ${isBulk ? '' : `<label>Contour<input type="text" data-unit-field="contour_code" value="${esc(unit.contour_code)}" list="uldw-contour-list" placeholder="ZQ"${dis}></label>`}
      <label>RCL#<input type="text" data-unit-field="rcl_no" value="${esc(unit.rcl_no)}"${dis}></label>
      ${isBulk ? '' : `<label>Tare<input type="number" min="0" step="0.1" data-unit-field="tare_weight" value="${esc(unit.tare_weight)}"${dis}></label>`}
      <label title="裝板物料重量（只作磅差說明，仍由夾重票吸收）">物料<input type="number" min="0" step="0.1" data-unit-field="material_weight" value="${esc(unit.material_weight)}"${dis}></label>
      <label class="uldw-more-wide">LIH<select data-unit-field="lih_type"${dis}>${lihOptions(unit.lih_type)}</select></label>
      <label class="uldw-more-wide">Pre-decl<select data-unit-field="predecl_type"${dis}>${optionsHtml(ULD_PREDECL_TYPES, unit.predecl_type)}</select></label>
      <label>夾重方式<select data-unit-field="squeeze_mode"${dis}>${optionsHtml(ULD_SQUEEZE_MODES, unit.squeeze_mode)}</select></label>
    </div>
    <div class="uldw-table-wrap">
      <table class="uldw-items">
        <thead><tr>
          <th title="勾選＝這票參與夾重（可多票）">夾重</th><th>MAWB#</th><th>DEST</th><th>PCS</th>
          <th>WT</th><th class="uldw-col-optional">比例</th><th>最終</th><th class="uldw-col-optional">LIH</th><th></th>
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
      <input type="text" class="uldw-draft-xs" data-draft="port" value="${esc(draft.port || '')}" placeholder="DEST"${dis}>
      <input type="number" class="uldw-draft-xs" min="0" step="1" data-draft="pcs" value="${esc(draft.pcs || '')}" placeholder="PCS"${dis}>
      <input type="number" class="uldw-draft-xs" min="0" step="0.1" data-draft="declared_weight" value="${esc(draft.declared_weight || '')}" placeholder="WT"${dis}>
      <select class="uldw-draft-lih" data-draft="lih_type"${dis}>${lihOptions(draft.lih_type || 'N')}</select>
      <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-primary" data-action="add-item" data-uid="${esc(unit.uid)}"${dis}>＋ 加入</button>
      <button type="button" class="uldw-btn uldw-btn-sm" data-action="paste-items" data-uid="${esc(unit.uid)}"${dis}
        title="貼上多列：從 Excel／booking list 複製 MAWB、DEST、PCS、WT（Tab 分隔）一次加入">⧉ 貼上</button>
      <span class="uldw-draft-hint" data-draft-hint="mawb"></span>
    </div>
  </div>`;
}

// ===== 明細列（每板 × 每 MAWB）=====
function itemRowHtml(unit, item, idx, locked) {
  const dis = locked ? ' disabled' : '';
  const manualRatio = unit.squeeze_mode === 'manual' && item.is_squeeze;
  return `
  <tr data-item-idx="${idx}" data-item-uid="${esc(item.uid)}" class="${item.is_squeeze ? 'is-squeeze' : ''}">
    <td><input type="checkbox" data-item-field="is_squeeze"${item.is_squeeze ? ' checked' : ''}${dis} title="勾選＝參與夾重"></td>
    <td><input type="text" class="uldw-input-mawb" data-item-field="mawb" value="${esc(item.mawb)}"${item.mawb_record_id ? ` title="已連結打板計劃 Booking Record #${esc(item.mawb_record_id)}"` : ''}${dis}></td>
    <td><input type="text" class="uldw-input-xs uldw-input-dest" data-item-field="port" value="${esc(item.port)}"${dis}></td>
    <td><input type="number" min="0" step="1" class="uldw-input-xs uldw-input-pcs" data-item-field="pcs" value="${esc(item.pcs)}"${dis}></td>
    <td><input type="number" min="0" step="0.1" class="uldw-input uldw-input-wt" data-item-field="declared_weight" value="${esc(item.declared_weight)}"${dis}></td>
    <td class="uldw-ratio-cell uldw-col-optional">${manualRatio
      ? `<input type="number" min="0" step="1" class="uldw-input-xs uldw-input-ratio" data-item-field="squeeze_ratio" value="${esc(item.squeeze_ratio == null ? '' : item.squeeze_ratio)}"${dis} title="手動比例（%）">`
      : '<span data-calc="ratio">-</span>'}</td>
    <td class="uldw-final-cell"><span data-calc="final">-</span></td>
    <td class="uldw-col-optional"><select class="uldw-input-lih" data-item-field="lih_type"${dis}>${lihOptions(item.lih_type)}</select></td>
    <td class="uldw-row-btns">
      <button type="button" class="uldw-btn uldw-btn-sm" data-action="split-item" data-uid="${esc(unit.uid)}" data-item-uid="${esc(item.uid)}"${dis} title="用這票的總重量，依件數拆到各板">⇄</button>
      <button type="button" class="uldw-btn uldw-btn-sm uldw-btn-danger" data-action="del-item" data-uid="${esc(unit.uid)}" data-item-uid="${esc(item.uid)}"${dis} title="刪除這票">✕</button>
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
    </tr>`).join('');
  return `<div class="uldw-table-wrap"><table class="uldw-table uldw-table-compact">
    <thead><tr><th>MAWB#</th><th>件數</th><th>原重</th><th>夾重後</th><th>差額</th><th>Port</th></tr></thead>
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

// ===== 全表合計（照業界習慣：PLAN / RCL / DIFF，單位一律 K）=====
function totalsHtml(computed) {
  const t = computed.totals;
  // PLAN TTL＝各票申報（booking）重量合計；RCL TTL＝各板 RCL Gross 合計；DIFF＝RCL 淨重 − PLAN
  const planTotal = (computed.units || []).reduce((sum, unit) => sum + (unit.calc ? unit.calc.declaredSum : 0), 0);
  const planDiff = (t.rclTotal - t.tareTotal) - planTotal;
  const sign = (v) => (Number(v) > 0 ? '+' : '');
  return `<div class="uldw-totals-grid">
    <span class="uldw-ttl"><em>PLAN TTL</em> <b>${uldFmtKg(planTotal)}</b> K</span>
    <span class="uldw-ttl"><em>RCL TTL</em> <b>${uldFmtKg(t.rclTotal)}</b> K</span>
    <span class="uldw-ttl${Math.abs(planDiff) > 1e-9 ? ' uldw-warn-text' : ''}"><em>DIFF</em> <b>${sign(planDiff)}${uldFmtKg(planDiff)}</b> K</span>
    <span class="uldw-ttl"><em>淨重</em> <b>${uldFmtKg(t.netTotal)}</b> K</span>
    <span class="uldw-ttl"><em>磅差</em> <b class="${t.diffTotal ? 'uldw-warn-text' : ''}">${sign(t.diffTotal)}${uldFmtKg(t.diffTotal)}</b> K（${sign(t.diffTotal)}${(t.diffPct || 0).toFixed(2)}%）</span>
    <span class="uldw-ttl uldw-ttl-muted"><em>單位</em> <b>${t.unitCount}</b>${t.bulkCount ? `（散 ${t.bulkCount}）` : ''}</span>
    <span class="uldw-ttl uldw-ttl-muted"><em>MAWB</em> <b>${t.mawbCount}</b></span>
    <span class="uldw-ttl uldw-ttl-muted"><em>件數</em> <b>${t.pcsTotal}</b></span>
    <span class="uldw-ttl uldw-ttl-muted"><em>Tare</em> <b>${uldFmtKg(t.tareTotal)}</b> K</span>
    ${t.hasError ? '<span class="uldw-warn-text">⛔ 有錯誤，請先修正再儲存</span>' : ''}
  </div>`;
}

// ===== RCL 磅單匯入面板（W3）=====
const RCL_FIELD_DEFS = [
  { key: 'uld', label: 'ULD#／板號' },
  { key: 'tare', label: 'Tare（板重）' },
  { key: 'gross', label: 'RCL Gross（磅重）' },
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
        <thead><tr><th></th><th>列</th><th>ULD#</th><th>Tare</th><th>RCL Gross</th><th>件數</th><th>備註</th></tr></thead>
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
    + `　表頭 ${s.header || 0}　單位 +${s.unitsAdded || 0}／-${s.unitsRemoved || 0}／~${s.unitsChanged || 0}`
    + `　明細 +${s.itemsAdded || 0}／-${s.itemsRemoved || 0}／~${s.itemsChanged || 0}</div>`;
  if (!diff.hasChanges) {
    return `<div class="uldw-version-diff">${head}<div class="uldw-version-muted">兩者內容相同</div></div>`;
  }
  const lines = [];
  (diff.header || []).forEach(change => {
    lines.push(`<li><span class="uldw-diff-tag uldw-diff-chg">表頭</span>${esc(change.label)}：`
      + `${esc(fmtDiffValue(change, 'from'))} → <b>${esc(fmtDiffValue(change, 'to'))}</b></li>`);
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
      // 業界讀法：PCS · RCL − Tare = 淨重 K · 申報 K（磅差看 chips）
      summary.innerHTML = `<span class="uldw-sum-main">${calc.pcsSum} PCS ｜ RCL ${uldFmtKg(calc.rclGross)}`
        + `${calc.tare ? ` − Tare ${uldFmtKg(calc.tare)}` : ''} → 淨 <b>${uldFmtKg(calc.finalSum)}</b> K</span>`
        + `<span class="uldw-sum-sub">申報 ${uldFmtKg(calc.declaredSum)} K ｜ 取整 ${uldFmtKg(calc.roundInc)}${tailWarn}</span>`;
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
    // U1：沒有檢核問題時，連「③ 檢核」標題一起收起來（列印時 CSS 會還原）
    const head = issueBox.previousElementSibling;
    if (head && head.classList) head.classList.toggle('is-hidden', computed.issues.length === 0);
  }
  const totalsBox = scope.querySelector('#uldw-totals');
  if (totalsBox) totalsBox.innerHTML = totalsHtml(computed);
}


