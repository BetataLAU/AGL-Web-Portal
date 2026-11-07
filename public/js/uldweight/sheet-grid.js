// ===== ULD 夾重系統：CHARTER LOADING SHEET（載荷表＝Excel 式矩陣「編輯」畫面，方案 B）=====
// 版面照業界包機載荷表：
//   ㈠ 左邊一票一列（SEQ／MAWB／DEST／申報 PCS·WT／W/H or Booking／自動／夾重／MAWB 上數）
//   ㈡ 右邊一板一組欄（01/A、02/B…；每組 PCS＝這票在該板的件數、WT＝該板拿到的重量）
//   ㈢ 底部各板合計＋PLAN TTL／RCL TTL／DIFF（單位 K）
//
// 方案 B 的資料關係（很重要，改之前先看）：
//   - **申報來源在表級**：`sheet.mawbs`（= DB `uld_weight_mawbs`），一票一列，存 MAWB／DEST／
//     申報件數／申報重量／W/H／auto_alloc／is_squeeze。
//   - **各板只填件數**（item.pcs）；重量由 `calc.uldApplyMawbAllocation()` 依件數分到各板
//     （Σ 一定等於該票申報重量）。所以右邊的 WT 是**算出來的**，不能直接改。
//   - `auto_alloc = 0` 的列（舊資料自動長出來的）保留各板原本填的重量，不重算。
//
// 這一支只負責「畫」與「局部更新」；事件綁定在 uld-weight.js（root 委派）。
// 顏色照圖：紅字＝夾重（該格重量有參與夾重）、橙字＝wt 有差（上數 ≠ 申報）。
import { uldNum, uldMawbKey } from './calc.js';
import { uldFormatMawb } from './mawb-format.js';

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, m => ({
    '\x26': '\x26amp;', '\x3C': '\x26lt;', '\x3E': '\x26gt;', '\x22': '\x26quot;', "'": '\x26#39;'
  }[m]));
}

// 板序代號：01/A、02/B…41/AO（與卡片檢視的 render.unitCode() 同一規則）
export function uldGridUnitCode(idx) {
  let n = Math.max(0, Number(idx) || 0);
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${String((Number(idx) || 0) + 1).padStart(2, '0')}/${letters}`;
}

// 重量照 Excel 固定 1 位小數（1400.0／0.0），件數整數
function kg1(value) {
  return (Math.round(uldNum(value) * 10) / 10).toFixed(1);
}
function pcs0(value) {
  return String(Math.round(uldNum(value)));
}
function mawbText(mawb) {
  const raw = String(mawb == null ? '' : mawb).trim();
  if (!raw) return '';
  return uldFormatMawb(raw) || raw;
}
function unitHeadLabel(unit) {
  const name = unit.kind === 'BULK' ? (unit.bulk_ref || 'BULK') : (unit.uld_number || '/');
  const contour = unit.contour_code ? `/${unit.contour_code}` : '';
  return `${name || '/'}${contour}`;
}
// 輸入框的值：0 顯示空白（Excel 手感；不要一進來就是一堆 0）
function inputValue(value) {
  const n = uldNum(value);
  return n === 0 ? '' : String(n);
}

// 舊資料沒有申報列（理論上後端會補，這裡再保險一層）：用 calc 的 MAWB 彙總反推
function legacyRows(computed) {
  return ((computed && computed.mawbs) || []).map(row => ({
    uid: `legacy-${row.key}`,
    id: null,
    mawb: row.mawb,
    dest: (row.ports || [])[0] || '',
    pcs: uldNum(row.pcs),
    declared_weight: uldNum(row.declared),
    wh_ref: '',
    auto_alloc: 0,
    is_squeeze: !!row.squeeze,
    legacy: true
  }));
}

// ===== 載荷表模型（純函式，測試可直接呼叫）=====
// computed：uldComputeSheet() 的回傳值；sheet：編輯狀態（有 sheet.mawbs 就以它為「申報來源」）
// 回傳 { units, rows, unitTotals, planWt, loadedWt, rclTotal, netTotal, planDiff, pcsTotal }
//   rows[].cells[unitUid] = { itemUid, pcs(分配件數), wt(最終重量), declared, squeeze }
export function uldGridModel(computed, sheet) {
  const src = computed || {};
  const units = src.units || [];
  const sheetRows = (sheet && Array.isArray(sheet.mawbs) && sheet.mawbs.length) ? sheet.mawbs : null;
  const rowsSrc = sheetRows || legacyRows(src);

  // 每板每票的計算結果（依 MAWB key 收集）
  const cellsByKey = new Map();
  units.forEach(unit => {
    (unit.calc && unit.calc.items || []).forEach(item => {
      const key = uldMawbKey(item.mawb);
      if (!key) return;
      if (!cellsByKey.has(key)) cellsByKey.set(key, []);
      cellsByKey.get(key).push({ unit, item });
    });
  });

  const rows = rowsSrc.map((row, idx) => {
    const key = uldMawbKey(row.mawb);
    const list = (key && cellsByKey.get(key)) || [];
    const cells = {};
    let upPcs = 0;
    let upWt = 0;
    let squeeze = !!row.is_squeeze;
    list.forEach(({ unit, item }) => {
      const cell = cells[unit.uid] || (cells[unit.uid] = { itemUid: item.uid, pcs: 0, wt: 0, declared: 0, squeeze: false });
      cell.pcs += uldNum(item.pcs);
      cell.wt += uldNum(item.final);
      cell.declared += uldNum(item.declared);
      cell.squeeze = cell.squeeze || !!item.squeeze;
      upPcs += uldNum(item.pcs);
      upWt += uldNum(item.final);
      squeeze = squeeze || !!item.squeeze;
    });
    const declared = uldNum(row.declared_weight);
    return {
      uid: row.uid || `row-${idx}`,
      mawb: row.mawb || '',
      dest: row.dest || '',
      pcs: uldNum(row.pcs),
      declaredWeight: declared,
      whRef: row.wh_ref || '',
      autoAlloc: Number(row.auto_alloc) === 0 ? 0 : 1,
      legacy: !!row.legacy,
      squeeze,
      upPcs,
      upWt: Number(upWt.toFixed(6)),
      // 上數與申報差超過 0.5kg → 橙字「wt 有差」
      changed: Math.abs(upWt - declared) > 0.5,
      cells
    };
  });

  const unitTotals = units.map((unit, idx) => {
    const calc = unit.calc || {};
    return {
      uid: unit.uid,
      code: uldGridUnitCode(idx),
      label: unitHeadLabel(unit),
      kind: unit.kind === 'BULK' ? 'BULK' : 'ULD',
      pcs: uldNum(calc.pcsSum),
      wt: uldNum(calc.finalSum),
      rcl: uldNum(calc.rclGross),
      tare: uldNum(calc.tare),
      net: uldNum(calc.targetNet),
      diff: uldNum(calc.diffAfterFinal)
    };
  });

  const sumBy = key => units.reduce((sum, unit) => sum + uldNum((unit.calc || {})[key]), 0);
  const planWt = rows.reduce((sum, row) => sum + row.declaredWeight, 0);
  const loadedWt = sumBy('finalSum');
  const rclTotal = sumBy('rclGross');
  const netTotal = sumBy('targetNet');

  return {
    units,
    rows,
    unitTotals,
    planWt: Number(planWt.toFixed(6)),
    loadedWt,
    rclTotal,
    netTotal,
    // DIFF＝Σ RCL（淨重）− PLAN（Σ 申報），與卡片檢視的 DIFF 同一個定義（RCL 已是淨重，不扣 Tare）
    planDiff: Number((netTotal - planWt).toFixed(6)),
    pcsTotal: rows.reduce((sum, row) => sum + row.pcs, 0)
  };
}

// 「Sort by MAWB#」：只排顯示順序（不寫回資料，存檔後仍是原本的加入順序）
export function uldGridSortRows(rows) {
  return (rows || []).slice().sort((a, b) => String(uldMawbKey(a.mawb)).localeCompare(String(uldMawbKey(b.mawb)), 'en', { numeric: true }));
}


// ===== 載荷表 HTML（可編輯：左邊申報列、右邊各板件數）=====
export function uldGridHtml(computed, sheet, ui = {}) {
  const model = uldGridModel(computed, sheet);
  const rows = ui.gridSortMawb ? uldGridSortRows(model.rows) : model.rows;
  const units = model.units;
  const locked = !!(sheet && sheet.status === 'locked');
  const dis = locked ? ' disabled' : '';
  const unitCols = units.length * 2;
  // 固定左欄 11 欄：SEQ／MAWB／DEST／PCS／WT／W-H／自動／夾重／上數 PCS／上數 WT／操作
  const LEFT_COLS = 11;
  const meta = [sheet && sheet.flight_no, sheet && sheet.flight_date, sheet && sheet.terminal]
    .filter(Boolean).join(' · ');
  const titleMeta = [sheet && sheet.sheet_no, meta].filter(Boolean).join(' · ');
  const sign = value => (Number(value) > 0 ? '+' : '');

  const headUnits = units.map((unit, idx) => `
        <th colspan="2" class="uldw-grid-auto uldw-grid-unit-th${unit.kind === 'BULK' ? ' is-bulk' : ''}"
          title="${esc(unitHeadLabel(unit))}（第 ${idx + 1} 板）">
          <span class="uldw-grid-code">${esc(uldGridUnitCode(idx))}</span>
          <span class="uldw-grid-uld">${esc(unitHeadLabel(unit))}</span>
        </th>`).join('');

  const bodyRows = rows.map((row, idx) => {
    // 舊資料自動長出來的列（前端 fallback）沒有 uid 對應 → 一律唯讀，避免改了存不回去
    const ro = row.legacy ? ' readonly' : '';
    const roChk = row.legacy ? ' disabled' : '';
    const cells = units.map((unit, unitIdx) => {
      const cell = row.cells[unit.uid];
      const pcsValue = cell ? inputValue(cell.pcs) : '';
      const wtClass = !cell
        ? ' is-empty'
        : (cell.squeeze ? ' is-squeeze' : (Math.abs(cell.wt - cell.declared) > 1e-9 ? ' is-diff' : ''));
      return `<td class="uldw-grid-cell-pcs"><input type="number" min="0" step="1" class="uldw-grid-input"
          data-cell-unit="${esc(unit.uid)}" data-cell-field="pcs" value="${esc(pcsValue)}"${dis}${ro}
          placeholder="0" aria-label="${esc(uldGridUnitCode(unitIdx))} 件數"></td>`
        + `<td class="uldw-grid-num${wtClass}"><span data-calc-cell="wt" data-cell-unit="${esc(unit.uid)}">${cell ? kg1(cell.wt) : '0.0'}</span></td>`;
    }).join('');
    const upWtClass = row.squeeze ? ' is-squeeze' : (row.changed ? ' is-diff' : '');
    return `
        <tr data-row-uid="${esc(row.uid)}"${row.squeeze ? ' class="is-squeeze-row"' : ''}>
          <td class="uldw-grid-seq">${String(idx + 1).padStart(3, '0')}</td>
          <td class="uldw-grid-mawb"><input type="text" class="uldw-grid-input uldw-grid-input-mawb"
            data-row-field="mawb" value="${esc(row.mawb)}" placeholder="000-0000 0000" autocomplete="off" spellcheck="false"${dis}${ro}></td>
          <td class="uldw-grid-dest"><input type="text" class="uldw-grid-input uldw-grid-input-dest"
            data-row-field="dest" value="${esc(row.dest)}" placeholder="DEST" autocomplete="off" spellcheck="false"${dis}${ro}></td>
          <td class="uldw-grid-num"><input type="number" min="0" step="1" class="uldw-grid-input uldw-grid-input-num"
            data-row-field="pcs" value="${esc(inputValue(row.pcs))}"${dis}${ro}></td>
          <td class="uldw-grid-num"><input type="number" min="0" step="0.1" class="uldw-grid-input uldw-grid-input-num"
            data-row-field="declared_weight" value="${esc(inputValue(row.declaredWeight))}"${dis}${ro}></td>
          <td class="uldw-grid-wh"><input type="text" class="uldw-grid-input uldw-grid-input-wh"
            data-row-field="wh_ref" value="${esc(row.whRef)}" autocomplete="off" spellcheck="false"${dis}${ro}></td>
          <td class="uldw-grid-flag"><input type="checkbox" data-row-field="auto_alloc"
            ${row.autoAlloc ? 'checked' : ''}${dis}${roChk} title="勾選＝依件數自動把申報重量分到各板（取消＝保留各板原本重量）"
            aria-label="自動分配重量"></td>
          <td class="uldw-grid-flag"><input type="checkbox" data-row-field="is_squeeze"
            ${row.squeeze ? 'checked' : ''}${dis}${roChk} title="勾選＝這票參與夾重（紅字）" aria-label="夾重"></td>
          <td class="uldw-grid-num"><span data-calc-row="upPcs">${pcs0(row.upPcs)}</span></td>
          <td class="uldw-grid-num${upWtClass}"><span data-calc-row="upWt">${kg1(row.upWt)}</span></td>
          ${cells}
          <td class="uldw-grid-row-x"><button type="button" class="uldw-grid-x" data-action="grid-del-row"
            data-row-uid="${esc(row.uid)}"${dis}${roChk} title="刪除這一票（連同各板的件數）">✕</button></td>
        </tr>`;
  }).join('');

  const unitTotalCells = model.unitTotals.map(total => `<td class="uldw-grid-num"><span data-calc-total="pcs" data-unit="${esc(total.uid)}">${pcs0(total.pcs)}</span></td>`
    + `<td class="uldw-grid-num"><span data-calc-total="wt" data-unit="${esc(total.uid)}">${kg1(total.wt)}</span></td>`).join('');

  const unitRclCells = model.unitTotals.map(total => `<td class="uldw-grid-num"><span data-calc-total="rcl" data-unit="${esc(total.uid)}">${kg1(total.rcl)}</span></td>`
    + `<td class="uldw-grid-num${Math.abs(total.diff) > 1e-9 ? ' is-diff' : ''}"><span data-calc-total="diff" data-unit="${esc(total.uid)}">${kg1(total.diff)}</span></td>`).join('');

  const table = !units.length
    ? `<div class="uldw-grid-empty">
        還沒有收貨單位。按上面的「＋ ULD」或「⇪ 匯入 RCL」開始，
        或在「▤ 卡片編輯」裡建板。
      </div>`
    : `
      <div class="uldw-grid-wrap">
        <table class="uldw-grid-table">
          <colgroup>
            <col class="uldw-grid-col-seq"><col class="uldw-grid-col-mawb"><col class="uldw-grid-col-dest">
            <col class="uldw-grid-col-pcs"><col class="uldw-grid-col-wt"><col class="uldw-grid-col-wh">
            <col class="uldw-grid-col-flag"><col class="uldw-grid-col-flag">
            <col class="uldw-grid-col-pcs"><col class="uldw-grid-col-wt">
            ${units.map(() => '<col class="uldw-grid-col-pcs"><col class="uldw-grid-col-wt">').join('')}
            <col class="uldw-grid-col-x">
          </colgroup>
          <thead>
            <tr class="uldw-grid-group">
              <th rowspan="2" class="uldw-grid-seq uldw-grid-manual">SEQ</th>
              <th rowspan="2" class="uldw-grid-mawb uldw-grid-manual">MAWB</th>
              <th rowspan="2" class="uldw-grid-dest uldw-grid-manual">DEST</th>
              <th rowspan="2" class="uldw-grid-manual">PCS</th>
              <th rowspan="2" class="uldw-grid-manual">WT</th>
              <th rowspan="2" class="uldw-grid-wh uldw-grid-manual" title="W/H 單號或打板計劃 Booking（#id）">W/H or Booking</th>
              <th rowspan="2" class="uldw-grid-manual" title="自動分配重量：依各板件數把申報重量分下去（Σ = 申報 WT）">自動</th>
              <th rowspan="2" class="uldw-grid-manual" title="勾選＝這票參與夾重（紅字）">夾重</th>
              <th colspan="2" class="uldw-grid-auto">MAWB 上數</th>
              ${headUnits}
              <th rowspan="2" class="uldw-grid-x"></th>
            </tr>
            <tr class="uldw-grid-sub">
              <th class="uldw-grid-auto">PCS</th><th class="uldw-grid-auto">WT</th>
              ${units.map(() => '<th class="uldw-grid-auto" title="這票在這一板的件數（重量依件數自動分）">PCS</th><th class="uldw-grid-auto">WT</th>').join('')}
            </tr>
          </thead>
          <tbody>
            ${bodyRows || `<tr><td colspan="${LEFT_COLS + unitCols}" class="uldw-grid-no-rows">
              還沒有一票 MAWB：在下面輸入 MAWB# 按 Enter，或按「＋ 列」。</td></tr>`}
            <tr class="uldw-grid-addrow">
              <td colspan="${LEFT_COLS + unitCols}">
                <input type="text" id="uldw-grid-new-mawb" class="uldw-grid-input uldw-grid-new-mawb"
                  placeholder="輸入 MAWB# 後按 Enter 新增一票" autocomplete="off" spellcheck="false"${dis}>
                <button type="button" class="uldw-grid-btn" data-action="grid-add-row"${dis}>＋ 列</button>
                <span class="uldw-grid-hint-inline">申報 PCS／WT 在左邊；右邊每一板只填件數，重量自動分。</span>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="uldw-grid-total">
              <td colspan="8">板合計（PCS／WT）</td>
              <td class="uldw-grid-num"><span data-calc-grand="pcs">${pcs0(model.pcsTotal)}</span></td>
              <td class="uldw-grid-num"><span data-calc-grand="wt">${kg1(model.loadedWt)}</span></td>
              ${unitTotalCells}
              <td></td>
            </tr>
            <tr class="uldw-grid-total">
              <td colspan="8">RCL（淨）／ 磅差</td>
              <td class="uldw-grid-num">-</td>
              <td class="uldw-grid-num">-</td>
              ${unitRclCells}
              <td></td>
            </tr>
            <tr class="uldw-grid-plan">
              <td colspan="4" class="uldw-grid-label">PLAN TTL</td>
              <td class="uldw-grid-num"><span data-calc-plan="planWt">${kg1(model.planWt)}</span></td>
              <td></td><td></td><td></td><td></td>
              <td class="uldw-grid-num"><span data-calc-plan="loadedWt">${kg1(model.loadedWt)}</span></td>
              <td colspan="${unitCols + 1}"></td>
            </tr>
            <tr class="uldw-grid-plan">
              <td colspan="4" class="uldw-grid-label">RCL TTL</td>
              <td class="uldw-grid-num"><span data-calc-plan="rclTotal">${kg1(model.rclTotal)}</span></td>
              <td></td><td></td><td></td><td></td><td></td>
              <td colspan="${unitCols + 1}"></td>
            </tr>
            <tr class="uldw-grid-plan">
              <td colspan="4" class="uldw-grid-label">DIFF</td>
              <td class="uldw-grid-num${Math.abs(model.planDiff) > 1e-9 ? ' is-diff' : ''}" data-calc-plan-cell="diff">
                <span data-calc-plan="planDiff">${sign(model.planDiff)}${kg1(model.planDiff)}</span></td>
              <td></td><td></td><td></td><td></td><td></td>
              <td colspan="${unitCols + 1}"></td>
            </tr>
          </tfoot>
        </table>
      </div>`;

  return `
    <div class="uldw-grid" data-grid-sort="${ui.gridSortMawb ? '1' : '0'}">
      <div class="uldw-grid-title">
        <span class="uldw-grid-title-main">CHARTER LOADING SHEET</span>
        <span class="uldw-grid-title-meta">${esc(titleMeta)}</span>
        <span class="uldw-grid-title-actions">
          <button type="button" class="uldw-grid-btn uldw-grid-btn-danger" data-action="grid-clear"${dis}
            title="清空所有板的 MAWB 明細（表頭與板資料保留；不會立即存檔）">Clear Content</button>
        </span>
      </div>

      <div class="uldw-grid-tools">
        <button type="button" class="uldw-grid-btn" data-action="grid-add-row"${dis}
          title="新增一票 MAWB（也可以在最下面那列輸入 MAWB# 後按 Enter）">＋ 列</button>
        <span class="uldw-grid-sep"></span>
        <button type="button" class="uldw-grid-btn" data-action="add-uld"${dis}>＋ ULD</button>
        <button type="button" class="uldw-grid-btn" data-action="add-bulk"${dis}>＋ 散貨</button>
        <button type="button" class="uldw-grid-btn" data-action="import-rcl"${dis}
          title="從貨站 RCL 磅單（Excel／CSV）匯入 ULD、Tare、RCL 淨重（WT）與件數">⇪ 匯入 RCL</button>
        <span class="uldw-grid-sep"></span>
        <button type="button" class="uldw-grid-btn" data-action="grid-check-mawb"${dis}
          title="把全部 MAWB# 檢查一遍：合格的格式化成 000-0000 0000，不合格的列出來（不改值）">Check &amp; format MAWB#</button>
        <button type="button" class="uldw-grid-btn${ui.gridSortMawb ? ' is-on' : ''}" data-action="grid-sort"
          title="只改顯示順序（不寫回資料）：依 MAWB# 排序">Sort by MAWB#</button>
        <span class="uldw-grid-spacer"></span>
        <button type="button" class="uldw-grid-btn" data-action="view-cards"
          title="切到卡片檢視（板資料：ULD#／Contour／Tare／RCL（淨）／LIH／Pre-decl、夾重方式）">▤ 卡片檢視</button>
      </div>

      <div class="uldw-grid-legend">
        <span class="uldw-grid-legend-item is-manual">要自己入</span>
        <span class="uldw-grid-legend-item is-auto">會自動計</span>
        <span class="uldw-grid-legend-item is-squeeze">紅字=夾重</span>
        <span class="uldw-grid-legend-item is-diff">橙字=wt有差</span>
        <span class="uldw-grid-hint">左邊申報 PCS／WT 自己入；右邊每板只入 PCS，WT 會依件數自動分（Σ = 申報 WT）。板資料（ULD#／Tare／RCL）在「▤ 卡片檢視」。</span>
      </div>

      ${table}

      <div class="uldw-grid-issues">
        <div class="uldw-col-head"><span>檢核</span></div>
        <div id="uldw-issues"></div>
      </div>
    </div>`;
}

// ===== 局部更新（輸入時只改數字與顏色，不重畫 → 游標不會跳）=====
// computed：uldComputed() 的最新結果（呼叫端已重算）；sheet：目前編輯狀態
export function refreshGridComputed(root, computed, sheet) {
  if (!root || !root.querySelectorAll) return;
  const model = uldGridModel(computed, sheet);
  const rows = new Map(model.rows.map(row => [row.uid, row]));
  const unitTotals = new Map(model.unitTotals.map(total => [total.uid, total]));

  root.querySelectorAll('tr[data-row-uid]').forEach(tr => {
    const row = rows.get(tr.dataset.rowUid);
    if (!row) return;
    const upPcs = tr.querySelector('[data-calc-row="upPcs"]');
    if (upPcs) upPcs.textContent = pcs0(row.upPcs);
    const upWt = tr.querySelector('[data-calc-row="upWt"]');
    if (upWt) {
      upWt.textContent = kg1(row.upWt);
      const td = upWt.closest ? upWt.closest('td') : null;
      if (td && td.classList) {
        td.classList.toggle('is-squeeze', !!row.squeeze);
        td.classList.toggle('is-diff', !row.squeeze && !!row.changed);
      }
    }
    model.unitTotals.forEach(total => {
      const span = tr.querySelector(`[data-calc-cell="wt"][data-cell-unit="${total.uid}"]`);
      if (!span) return;
      const cell = row.cells[total.uid];
      const td = span.closest ? span.closest('td') : null;
      if (!cell) {
        span.textContent = '0.0';
        if (td && td.classList) {
          td.classList.remove('is-squeeze');
          td.classList.remove('is-diff');
          td.classList.add('is-empty');
        }
        return;
      }
      span.textContent = kg1(cell.wt);
      if (td && td.classList) {
        td.classList.toggle('is-squeeze', !!cell.squeeze);
        td.classList.toggle('is-diff', !cell.squeeze && Math.abs(cell.wt - cell.declared) > 1e-9);
        td.classList.remove('is-empty');
      }
    });
  });

  unitTotals.forEach(total => {
    const pcs = root.querySelector(`[data-calc-total="pcs"][data-unit="${total.uid}"]`);
    if (pcs) pcs.textContent = pcs0(total.pcs);
    const wt = root.querySelector(`[data-calc-total="wt"][data-unit="${total.uid}"]`);
    if (wt) wt.textContent = kg1(total.wt);
    const rcl = root.querySelector(`[data-calc-total="rcl"][data-unit="${total.uid}"]`);
    if (rcl) rcl.textContent = kg1(total.rcl);
    const diff = root.querySelector(`[data-calc-total="diff"][data-unit="${total.uid}"]`);
    if (diff) {
      diff.textContent = kg1(total.diff);
      const td = diff.closest ? diff.closest('td') : null;
      if (td && td.classList) td.classList.toggle('is-diff', Math.abs(total.diff) > 1e-9);
    }
  });

  const setText = (selector, text) => {
    const el = root.querySelector(selector);
    if (el) el.textContent = text;
  };
  setText('[data-calc-grand="pcs"]', pcs0(model.pcsTotal));
  setText('[data-calc-grand="wt"]', kg1(model.loadedWt));
  setText('[data-calc-plan="planWt"]', kg1(model.planWt));
  setText('[data-calc-plan="loadedWt"]', kg1(model.loadedWt));
  setText('[data-calc-plan="rclTotal"]', kg1(model.rclTotal));
  setText('[data-calc-plan="planDiff"]', `${model.planDiff > 0 ? '+' : ''}${kg1(model.planDiff)}`);
  const planDiffCell = root.querySelector('[data-calc-plan-cell="diff"]');
  if (planDiffCell && planDiffCell.classList) {
    planDiffCell.classList.toggle('is-diff', Math.abs(model.planDiff) > 1e-9);
  }
}

