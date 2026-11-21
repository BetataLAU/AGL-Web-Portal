// ===== Shipper Role Project - XLS Booking 前端（標準化結果預覽） =====
// 從 xls-booking.js 拆出（.clinerule.md：檔案大小控制）
// 職責：標準化資料載入/快取、勾選列、CNEE 手動補值、MAWB#／DEST／航班號 雙擊修改、欄寬調整。

// ③ 可「雙擊修改」的欄位（存成 fieldOverrides，會同步到 ④ 執行）
const XLS_STD_EDITABLE_FIELDS = ['mawb', 'dest', 'flight'];

// ③ 勾選欄的「Shift 整段勾選」錨點：{ fileIndex, mawbKey }
// 記 mawbKey 而不是 DOM（勾選後會整表重繪，DOM 節點會換掉）；資料重建／全選時清空。
let xlsStdRangeAnchor = null;


// ===== 標準化預覽（前端簡易標準化，供使用者核對 + 勾選要執行的列） =====
// 標準化資料會快取（f._stdCache）；勾選切換時僅「同步重繪」，不再重新打 API，
// 避免每次 re-render 都有網路延遲，造成「勾選沒反應／連點兩下又跳回原狀」。

async function xlsEnsureStandardized(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f) return null;
  const def = xlsState.defs.find((d) => d.fileIndex === fileIndex);
  if (!def) return null;

  const firstDataRow = def.firstDataRow || 2;
  const sheetIndex = def.sheetIndex || 0;
  const fieldMapKey = JSON.stringify(def.fieldMap || {});
  const cache = f._stdCache;
  if (cache && cache.firstDataRow === firstDataRow && cache.sheetIndex === sheetIndex && cache.fieldMapKey === fieldMapKey) {
    return cache;
  }

  // 以 ② 預覽「編輯後」的資料為準（雙擊修改／刪除 CNEE／增刪列等都會反映到 ③）；
  // 沒有開過預覽才向伺服器抓原檔。
  let rows;
  if (f.lastPreview) {
    rows = f.lastPreview.rows;
  } else {
    const res = await apiFetch(`/api/xls-booking/preview/${xlsState.uploadId}/${f.id}/${sheetIndex}`);
    rows = res.rows;
  }

  // 取得 CNEE 對照區比對結果（自動抽取 + DEST/REMARK 比對，後端為單一事實來源）。
  // 必須帶入 cneeOverrides，與 ④ 執行時看到的結果一致（否則 ③ 會顯示原檔 CNEE）。
  // editedRows 只在 ②「真正編輯過」才帶：若只是開過預覽就把整張表（最多 100 列 x 100 欄、
  // 且菜鳥/QR 檔含超長文字格）送回，body 會超過伺服器 JSON 上限而 413，導致 CNEE 全數誤判為缺。
  const cneeDef = {
    ...def,
    editedRows: f.previewEdited && f.lastPreview ? f.lastPreview.rows : undefined,
    cneeOverrides: xlsState.cneeOverrides[fileIndex] || {},
    fieldOverrides: xlsState.fieldOverrides[fileIndex] || {},
  };
  let cneeRes = null;
  let cneeError = '';
  try {
    cneeRes = await apiFetch('/api/xls-booking/cnee-preview', {
      method: 'POST',
      body: JSON.stringify({ uploadId: xlsState.uploadId, defs: [cneeDef] }),
    });
  } catch (err) {
    // 不靜默吞掉：留訊息給 ③ 顯示，避免「伺服器其實沒回傳」卻被當成「全部缺 CNEE」
    cneeError = (err && err.message) ? err.message : '網路錯誤';
  }
  const cneeInfo = cneeRes ? (cneeRes.results || []).find((r) => r.fileIndex === fileIndex) : undefined;
  const cneeMap = {};
  if (cneeInfo) {
    (cneeInfo.entries || []).forEach((e) => {
      // ③ 改過 MAWB# 時，後端回傳 sourceMawb（原 MAWB）→ 用原值對回勾選 key
      const key = e.sourceMawb || e.mawb;
      if (key) cneeMap[xlsNormMawb(key)] = e.cnee || '';
    });
    f._cneeBlocks = cneeInfo.blocks || [];
  } else {
    f._cneeBlocks = [];
  }
  f._cneeWarning = cneeError ? `CNEE 比對暫時無法取得（${cneeError}）。若此檔「CNEE 名稱」欄位已指派，已先用該列值顯示；可點下方「重試 CNEE 比對」。` : '';

  const extract = (row, type) => {
    for (const [ci, t] of Object.entries(def.fieldMap)) {
      if (t === type) return row[Number(ci)];
    }
    return null;
  };

  // 動態欄位：所有已指派（非 ignore）的欄位類型，依 XLS_FIELD_TYPES 順序
  const assignedTypes = XLS_FIELD_TYPES.filter((t) => t.value !== 'ignore' && Object.values(def.fieldMap).includes(t.value));

  // 標準化列（僅包含有 MAWB 的列）
  const fieldOverrides = xlsState.fieldOverrides[fileIndex] || {};
  const standardized = [];
  rows.slice(firstDataRow - 1).forEach((row) => {
    const mawb = extract(row, 'mawb');
    if (!mawb) return;
    const rec = { mawbKey: xlsNormMawb(mawb) };
    assignedTypes.forEach((t) => {
      rec[t.value] = xlsCellDisplay(extract(row, t.value));
    });
    // ③ 可雙擊修改的欄位：記住原值（判斷是否已改回原值）並套用手動修改
    rec._orig = {
      mawb: rec.mawb || '',
      dest: rec.dest || '',
      flight: rec.flight || '',
    };
    const fieldOver = fieldOverrides[rec.mawbKey];
    if (fieldOver) {
      XLS_STD_EDITABLE_FIELDS.forEach((k) => {
        if (fieldOver[k]) rec[k] = fieldOver[k];
      });
    }
    // CNEE 顯示順序：1) 後端比對結果（含逐列 CNEE_NAME 直取） 2) 已指派「CNEE 名稱」欄的該列值（後端比對暫時失敗時仍正確）
    // 3) 前端手動補值（③ 點擊填入，最高優先，與 ④ 執行一致）
    const hasDirectCnee = assignedTypes.some((t) => t.value === 'cnee_name');
    rec.cnee = cneeMap[rec.mawbKey] || (hasDirectCnee ? (rec.cnee_name || '') : '');
    const over = (xlsState.cneeOverrides[fileIndex] || {})[rec.mawbKey];
    if (over) rec.cnee = over;
    standardized.push(rec);
  });

  // 校正勾選狀態：移除已不存在的 mawbKey、新出現的 MAWB 預設勾選。
  // （防止拖入新檔案／欄位定義變更後沿用上一輪的舊勾選，導致全選 checkbox「按不到」）
  // 勾選清單重建 → 舊的 Shift 整段錨點一併失效
  xlsStdRangeAnchor = null;
  const mawbKeys = standardized.map((r) => r.mawbKey);
  let sel = xlsState.selections[fileIndex];
  if (!sel) {
    xlsState.selections[fileIndex] = { all: mawbKeys, selected: new Set(mawbKeys) };
  } else {
    const valid = new Set(mawbKeys);
    sel.all = mawbKeys;
    for (const k of [...sel.selected]) {
      if (!valid.has(k)) sel.selected.delete(k);
    }
    mawbKeys.forEach((k) => { if (!sel.selected.has(k)) sel.selected.add(k); });
  }

  f._stdCache = { firstDataRow, sheetIndex, fieldMapKey, assignedTypes, standardized };
  return f._stdCache;
}

// ===== ③ 標準化預覽：欄寬（可拖曳調整，記憶在 localStorage） =====
// 表格是 table-layout: fixed，預設各欄共用寬度。拖曳表頭右緣時：
//   1) 先把「每一欄目前的實際寬度」定格成 px（col.style.width）
//   2) 表格總寬改成各欄相加，之後只調整被拖曳的那一欄
// → 其他欄位不會被連帶壓縮，空間不足時表格出現橫向捲軸（與 Excel 行為一致）。
const XLS_STD_COL_WIDTH_STORAGE_KEY = 'xls-std-col-widths';
const XLS_STD_COL_DEFAULT_WIDTHS = { check: 44, mawb: 150, cnee: 220 };
const XLS_STD_COL_FALLBACK_WIDTH = 120;
const XLS_STD_COL_MAX_WIDTH = 900;

function xlsStdColMinWidth(key) {
  return key === 'check' ? 44 : 56;
}

function xlsStdColDefaultWidth(key) {
  return XLS_STD_COL_DEFAULT_WIDTHS[key] || XLS_STD_COL_FALLBACK_WIDTH;
}

// 讀取欄寬設定（xlsState.stdColWidths 為快取；第一次由 localStorage 還原）
function xlsLoadStdColWidths() {
  if (xlsState.stdColWidths) return xlsState.stdColWidths;
  const widths = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(XLS_STD_COL_WIDTH_STORAGE_KEY) || '{}');
    if (parsed && typeof parsed === 'object') {
      Object.keys(parsed).forEach((key) => {
        const w = Number(parsed[key]);
        if (Number.isFinite(w) && w > 0) {
          widths[key] = Math.round(Math.min(XLS_STD_COL_MAX_WIDTH, Math.max(xlsStdColMinWidth(key), w)));
        }
      });
    }
  } catch (e) {
    // localStorage 不可用（隱私模式）或內容毀損：改用預設寬度
  }
  xlsState.stdColWidths = widths;
  return widths;
}

function xlsPersistStdColWidths() {
  try {
    localStorage.setItem(XLS_STD_COL_WIDTH_STORAGE_KEY, JSON.stringify(xlsLoadStdColWidths()));
  } catch (e) {
    // 無法寫入時仍可在本次工作階段使用（xlsState.stdColWidths 已有值）
  }
}

function xlsStdColWidth(key) {
  const w = Number(xlsLoadStdColWidths()[key]);
  return Number.isFinite(w) && w > 0 ? w : xlsStdColDefaultWidth(key);
}

// 拖曳中的狀態（一次只會有一個欄寬在調整）
let xlsStdColDrag = null;

function xlsStartStdColResize(ev, fileIndex, colKey) {
  if (!ev || (typeof ev.button === 'number' && ev.button > 0)) return; // 只接受左鍵／觸控
  const panel = document.getElementById('xls-standardized-panel');
  const table = panel ? panel.querySelector('.xls-standardized-table') : null;
  if (!table) return;
  const cols = Array.prototype.slice.call(table.querySelectorAll('colgroup > col'));
  const ths = Array.prototype.slice.call(table.querySelectorAll('thead > tr > th'));
  const targetCol = cols.find((c) => c.getAttribute('data-col-key') === colKey);
  if (!targetCol || cols.length !== ths.length) return;

  ev.preventDefault();
  ev.stopPropagation();

  const widths = {};
  let total = 0;
  cols.forEach((col, i) => {
    const w = Math.round(ths[i].getBoundingClientRect().width);
    widths[col.getAttribute('data-col-key')] = w;
    total += w;
    col.style.width = `${w}px`;
  });

  const startWidth = widths[colKey] || xlsStdColDefaultWidth(colKey);
  const handle = ev.currentTarget && ev.currentTarget.classList ? ev.currentTarget : null;
  if (handle) handle.classList.add('xls-resizing');
  xlsStdColDrag = { startX: ev.clientX, startWidth, total, lastWidth: null, colKey, targetCol, table, handle };
  document.body.classList.add('xls-col-resizing');
  window.addEventListener('pointermove', xlsOnStdColResizeMove);
  window.addEventListener('pointerup', xlsEndStdColResize);
  window.addEventListener('pointercancel', xlsEndStdColResize);
}

function xlsOnStdColResizeMove(ev) {
  const drag = xlsStdColDrag;
  if (!drag) return;
  const min = xlsStdColMinWidth(drag.colKey);
  const next = Math.round(Math.min(XLS_STD_COL_MAX_WIDTH, Math.max(min, drag.startWidth + (ev.clientX - drag.startX))));
  if (next === drag.lastWidth) return;
  drag.lastWidth = next;
  drag.targetCol.style.width = `${next}px`;
  drag.table.style.width = `${drag.total - drag.startWidth + next}px`;
}

function xlsEndStdColResize() {
  const drag = xlsStdColDrag;
  if (!drag) return;
  window.removeEventListener('pointermove', xlsOnStdColResizeMove);
  window.removeEventListener('pointerup', xlsEndStdColResize);
  window.removeEventListener('pointercancel', xlsEndStdColResize);
  document.body.classList.remove('xls-col-resizing');
  if (drag.handle && drag.handle.classList) drag.handle.classList.remove('xls-resizing');
  if (drag.lastWidth) {
    xlsLoadStdColWidths()[drag.colKey] = drag.lastWidth;
    xlsPersistStdColWidths();
  }
  xlsStdColDrag = null;
}

// 雙擊表頭邊界：只把那一個欄位恢復預設寬度
function xlsResetStdColWidth(ev, fileIndex, colKey) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  const widths = xlsLoadStdColWidths();
  if (widths[colKey] !== undefined) {
    delete widths[colKey];
    xlsPersistStdColWidths();
  }
  xlsRenderStandardized(fileIndex);
}

// 「重設全部欄寬」按鈕：清掉所有記憶，回到預設分配
function xlsResetStdColWidths(fileIndex) {
  xlsState.stdColWidths = {};
  try {
    localStorage.removeItem(XLS_STD_COL_WIDTH_STORAGE_KEY);
  } catch (e) {
    // 忽略：清不掉也不影響本次工作階段的預設值
  }
  xlsRenderStandardized(fileIndex);
}

function xlsRenderStandardized(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f || !f._stdCache) return;
  const { assignedTypes, standardized } = f._stdCache;

  // 勾選狀態：第一次建立時預設全選
  if (!xlsState.selections[fileIndex]) {
    xlsState.selections[fileIndex] = {
      all: standardized.map((r) => r.mawbKey),
      selected: new Set(standardized.map((r) => r.mawbKey)),
    };
  }
  const sel = xlsState.selections[fileIndex];
  const total = standardized.length;
  const selectedCount = standardized.filter((r) => sel.selected.has(r.mawbKey)).length;
  const allSelected = total > 0 && selectedCount === total;

  const panel = document.getElementById('xls-standardized-panel');
  if (!panel) return;
  // 重繪前記住表格捲動位置（避免勾選後跳回最上面）
  const prevWrap = panel.querySelector('.xls-standardized-table-wrap');
  const savedScroll = prevWrap ? { left: prevWrap.scrollLeft, top: prevWrap.scrollTop } : null;
  const otherTypes = assignedTypes.filter((t) => t.value !== 'mawb');
  // 欄位順序＝畫面順序；key 用來記住欄寬（可拖曳表頭右緣調整，見 xlsStartStdColResize）
  const cols = [
    { key: 'check', label: '', cls: 'xls-check-col' },
    { key: 'mawb', label: 'MAWB#', cls: '' },
    { key: 'cnee', label: 'CNEE', cls: 'xls-cnee-col' },
    ...otherTypes.map((t) => ({ key: t.value, label: t.label, cls: '' })),
  ];
  const colWidths = cols.map((c) => xlsStdColWidth(c.key));
  const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const missingCnee = standardized.filter((r) => !r.cnee).length;
  // 可雙擊修改的欄位標籤（MAWB# 一定有；DEST／航班號 有指派才列出）
  const editableLabels = ['MAWB#'].concat(
    assignedTypes.filter((t) => t.value === 'dest' || t.value === 'flight').map((t) => t.label)
  );
  const cneeHint = (f._cneeBlocks && f._cneeBlocks.length) ? '（CNEE 自動由下方對照區比對，點擊 CNEE 格可手動補值）' : '（點擊 CNEE 格可手動補值）';
  panel.innerHTML = `
    <h4>標準化結果預覽（${xlsEscapeHtml(f.originalName)}）</h4>
    <p class="xls-standardized-count">☑ 已勾選 <b>${selectedCount}</b> / ${total} 筆（有勾選的才會執行）${missingCnee ? ` &nbsp;🔴 <b>${missingCnee}</b> 筆缺 CNEE（執行時<b>不會製作</b>）<button type="button" class="pill xls-jump-cnee" onclick="xlsJumpFirstMissingCnee(${fileIndex})">📍 跳至第一筆</button>` : ''}</p>
    <p class="xls-preview-note">⇧ 按住 <b>Shift</b> 點選勾選框可「整段勾選／取消」（例：先勾第 1 列，再按住 Shift 勾第 4 列 → 第 1～4 列全勾）</p>
    ${missingCnee ? '<p class="xls-preview-note">🚫 缺 CNEE 的列執行時會直接跳過（不會產生 SLI／ELI／Report）；請先點擊該列紅色 CNEE 格補值。</p>' : ''}
    <p class="xls-preview-note">${cneeHint}</p>
    <p class="xls-preview-note">✏️ 雙擊 <b>${xlsEscapeHtml(editableLabels.join('／'))}</b> 可修改內容（Enter 儲存／Esc 取消；會同步到 ④ 執行，不需重新上傳）</p>
    <p class="xls-preview-note">↔ 拖曳表頭右緣可調整欄寬（雙擊該邊界只恢復該欄；欄寬會記住）
      <button type="button" class="pill xls-reset-col-widths" onclick="xlsResetStdColWidths(${fileIndex})">重設全部欄寬</button>
    </p>
    ${f._cneeWarning ? `<div class="xls-warning-box">⚠️ ${xlsEscapeHtml(f._cneeWarning)}<br><button type="button" class="pill" onclick="xlsRetryStandardized(${fileIndex})">↻ 重試 CNEE 比對</button></div>` : ''}
    <div class="xls-standardized-table-wrap">
      <table class="xls-preview-table xls-standardized-table" style="width:${tableWidth}px; min-width:100%;">
        <colgroup>
          ${cols.map((c, i) => `<col data-col-key="${c.key}" style="width:${colWidths[i]}px" />`).join('')}
        </colgroup>
        <thead><tr>
          ${cols.map((c) => {
            if (c.key === 'check') {
              return `<th class="xls-check-col" data-col-key="check">
            <label title="全選 / 全部不選">
              <input type="checkbox" id="xls-select-all-${fileIndex}" ${allSelected ? 'checked' : ''} onchange="xlsToggleAll(${fileIndex})" />
            </label>
          </th>`;
            }
            return `<th${c.cls ? ` class="${c.cls}"` : ''} data-col-key="${c.key}">${xlsEscapeHtml(c.label)}<span class="xls-col-resizer" title="拖曳調整欄寬（雙擊恢復預設）" onpointerdown="xlsStartStdColResize(event, ${fileIndex}, '${c.key}')" ondblclick="xlsResetStdColWidth(event, ${fileIndex}, '${c.key}')"></span></th>`;
          }).join('')}
        </tr></thead>
        <tbody>
          ${standardized.map((r) => {
            const isSel = sel.selected.has(r.mawbKey);
            // 已勾選（會執行）的列才提示：缺 MAWB#/CNEE/DEST/航班號 → 該格持續脈動
            const cneeMissing = !(r.cnee || '').trim();
            const mawbMissing = isSel && !(r.mawb || '').trim(); // 無 MAWB 的列不會進入標準化，通常不觸發
            const cellMissing = (t) => {
              if (!isSel || (t.value !== 'dest' && t.value !== 'flight')) return false;
              return !(r[t.value] || '').trim();
            };
            return `
            <tr>
              <td class="xls-check-col">
                <label title="選擇此列（按住 Shift 可整段勾選／取消）" onclick="xlsStdCheckCellClick(event, ${fileIndex}, '${xlsEscapeHtml(r.mawbKey)}')">
                  <input type="checkbox" data-mawb="${xlsEscapeHtml(r.mawbKey)}" ${isSel ? 'checked' : ''} onclick="xlsToggleRow(event, ${fileIndex}, '${xlsEscapeHtml(r.mawbKey)}')" />
                </label>
              </td>
              <td class="xls-std-editable${mawbMissing ? ' xls-required-missing' : ''}" title="${mawbMissing ? '🔴 缺少 MAWB#（此列已勾選，執行時將被略過）；' : ''}雙擊編輯 MAWB#" ondblclick="xlsEditStandardField(event, ${fileIndex}, '${xlsEscapeHtml(r.mawbKey)}', 'mawb')">${xlsEscapeHtml(r.mawb || '')}</td>
              <td class="xls-cnee-cell${cneeMissing ? ' xls-cnee-missing' : ''}${isSel && cneeMissing ? ' xls-missing-pulse' : ''}" title="${r.cnee ? '點擊編輯 CNEE' : '🔴 無 CNEE（執行時不會製作）— 點擊填入'}" onclick="xlsEditCnee(event, ${fileIndex}, '${xlsEscapeHtml(r.mawbKey)}')">
                ${r.cnee ? xlsEscapeHtml(r.cnee.length > 30 ? r.cnee.slice(0, 30) + '…' : r.cnee) : '🔴 無 CNEE（點擊填入）'}
              </td>
              ${otherTypes.map((t) => {
                const canEdit = XLS_STD_EDITABLE_FIELDS.indexOf(t.value) >= 0;
                const miss = cellMissing(t);
                const cls = [miss ? 'xls-required-missing' : '', canEdit ? 'xls-std-editable' : ''].filter(Boolean).join(' ');
                const tip = `${miss ? `🔴 缺少 ${t.label}（此列已勾選，執行時此欄會留空）；` : ''}${canEdit ? `雙擊編輯 ${t.label}` : ''}`;
                return `<td${cls ? ` class="${cls}"` : ''}${tip ? ` title="${tip}"` : ''}${canEdit ? ` ondblclick="xlsEditStandardField(event, ${fileIndex}, '${xlsEscapeHtml(r.mawbKey)}', '${t.value}')"` : ''}>${xlsEscapeHtml(r[t.value] || '')}</td>`;
              }).join('')}
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  // 還原表格捲動位置
  if (savedScroll) {
    const newWrap = panel.querySelector('.xls-standardized-table-wrap');
    if (newWrap) {
      newWrap.scrollLeft = savedScroll.left;
      newWrap.scrollTop = savedScroll.top;
    }
  }
  panel.style.display = 'block';
}

// 載入標準化資料（首次或欄位定義／資料列變更時）後重繪
async function renderStandardizedPreview(fileIndex) {
  const data = await xlsEnsureStandardized(fileIndex);
  if (!data) return;
  xlsRenderStandardized(fileIndex);
}

// ===== 標準化預覽：CNEE 比對失敗後的手動重試（清快取強制重新向後端抓） =====
function xlsRetryStandardized(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (f) {
    f._stdCache = null;
    f._cneeWarning = '';
  }
  renderStandardizedPreview(fileIndex);
}

// ===== 標準化預覽：勾選 / 取消勾選單一列（Shift＝整段勾選／取消） =====
// Excel 手感：先勾第 1 列（一般點擊＝記住錨點）→ 按住 Shift 勾第 4 列 → 第 1~4 列一起勾。
// 若 Shift 點的目標原本已勾選，整段就跟著取消。
// 錨點（xlsStdRangeAnchor）在檔案頂端宣告，記 mawbKey 讓重繪後仍有效。

// 取得「錨點列 ~ 目標列」的勾選 key 清單；沒有錨點／跨檔／找不到列 → null（退回單列切換）
function xlsStdRangeKeys(fileIndex, mawbKey) {
  if (!xlsStdRangeAnchor || xlsStdRangeAnchor.fileIndex !== fileIndex) return null;
  const f = xlsState.files[fileIndex];
  const list = (f && f._stdCache && f._stdCache.standardized) || [];
  const keys = list.map((r) => r.mawbKey);
  const from = keys.indexOf(xlsStdRangeAnchor.mawbKey);
  const to = keys.indexOf(mawbKey);
  if (from < 0 || to < 0 || from === to) return null;
  return keys.slice(Math.min(from, to), Math.max(from, to) + 1);
}

function xlsToggleRow(ev, fileIndex, mawbKey) {
  const sel = xlsState.selections[fileIndex];
  if (!sel) return;
  // 點在勾選格留白（label）時，Chrome 仍會把 click 轉發給 checkbox（實測）；
  // 此時 label 已由 xlsStdCheckCellClick 處理並重繪 → 轉發事件落在「已被換掉的舊 DOM」，
  // 用 isConnected 判斷並忽略，避免同一次點擊被切換兩次（整段勾選後又被加回來）。
  const box = ev && ev.currentTarget;
  if (box && box.isConnected === false) return;
  // click 一定切換勾選狀態；用勾選清單推算「切換後」的狀態（不依賴 DOM/瀏覽器時序）
  const next = !sel.selected.has(mawbKey);
  const range = (ev && ev.shiftKey) ? xlsStdRangeKeys(fileIndex, mawbKey) : null;
  if (range) {
    range.forEach((k) => { if (next) sel.selected.add(k); else sel.selected.delete(k); });
    // 錨點維持不變：可再 Shift+點其他列，整段重新計算
  } else {
    if (next) sel.selected.add(mawbKey);
    else sel.selected.delete(mawbKey);
    xlsStdRangeAnchor = { fileIndex, mawbKey };
  }
  xlsRenderStandardized(fileIndex); // 同步重繪，即時反應
}

// 勾選格整格（label）都可點：點在 checkbox 外的留白也要支援 Shift 整段勾選。
// Chrome 即使 preventDefault() 仍會把 click 再轉發給 checkbox（實測），且轉發事件的 Shift 可能遺失
// → 這裡先套用整段勾選；轉發事件則由 xlsToggleRow 的 isConnected 檢查忽略（避免切換兩次）。
function xlsStdCheckCellClick(ev, fileIndex, mawbKey) {
  if (!ev || !ev.shiftKey) return;              // 一般點擊：交給 checkbox 自己的 onclick
  if (ev.target && ev.target.type === 'checkbox') return; // 直接點 checkbox：已由 xlsToggleRow 處理
  if (!xlsStdRangeKeys(fileIndex, mawbKey)) return;       // 沒有錨點：走預設（單列切換）
  if (ev.preventDefault) ev.preventDefault();
  xlsToggleRow(ev, fileIndex, mawbKey);
}

// ===== 標準化預覽：全選 / 全部不選（頂部 checkbox） =====
function xlsToggleAll(fileIndex) {
  const sel = xlsState.selections[fileIndex];
  if (!sel) return;
  xlsStdRangeAnchor = null; // 全選／全不選後重新建立錨點，避免 Shift 整段選到非預期的範圍
  const allChecked = sel.all.length > 0 && sel.all.every((k) => sel.selected.has(k));
  if (allChecked) {
    sel.selected.clear();
  } else {
    sel.all.forEach((k) => sel.selected.add(k));
  }
  xlsRenderStandardized(fileIndex); // 同步重繪，即時反應
}

// ===== 標準化預覽：跳至第一筆缺 CNEE（捲動到該列 + 短暫高亮） =====
function xlsJumpFirstMissingCnee(fileIndex) {
  const panel = document.getElementById('xls-standardized-panel');
  if (!panel) return;
  const cell = panel.querySelector('.xls-cnee-cell.xls-cnee-missing');
  if (!cell) return;
  cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
  cell.classList.add('xls-cnee-flash');
  setTimeout(() => cell.classList.remove('xls-cnee-flash'), 1400);
}

// ===== 標準化預覽：點擊 CNEE 格補值（存為 overrides，不需重新上傳） =====
function xlsEditCnee(ev, fileIndex, mawbKey) {
  const f = xlsState.files[fileIndex];
  if (!f || !f._stdCache) return;
  const cell = ev.currentTarget;
  if (!cell || cell.querySelector('textarea')) return;
  const rec = f._stdCache.standardized.find((r) => r.mawbKey === mawbKey);
  if (!rec) return;
  const oldVal = rec.cnee || '';
  cell.innerHTML = `<textarea class="xls-cnee-input" rows="4" placeholder="輸入 CNEE 名稱／地址（可多行）">${xlsEscapeHtml(oldVal)}</textarea>`;
  const ta = cell.querySelector('textarea');
  ta.focus();
  ta.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const newVal = ta.value.trim();
    if (!xlsState.cneeOverrides[fileIndex]) xlsState.cneeOverrides[fileIndex] = {};
    if (newVal === '') {
      delete xlsState.cneeOverrides[fileIndex][mawbKey];
    } else {
      xlsState.cneeOverrides[fileIndex][mawbKey] = newVal;
    }
    rec.cnee = newVal;
    xlsRenderStandardized(fileIndex);
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { done = true; xlsRenderStandardized(fileIndex); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
  });
  ta.addEventListener('blur', commit);
  ta.addEventListener('click', (e) => e.stopPropagation());
}


// ===== ③ 標準化預覽：雙擊修改 MAWB#／DEST／航班號（會同步到 ④ 執行） =====
// 修改值存在 xlsState.fieldOverrides[fileIndex][原 mawbKey]，後端 standardizeRows 以「原 MAWB」
// 識別同一列套用，因此勾選清單、CNEE 補值仍以原 MAWB 為 key，不會因改 MAWB 而對不上。
function xlsStdFieldPlaceholder(field) {
  if (field === 'mawb') return '例如 157-12345678';
  if (field === 'dest') return '例如 HKG';
  if (field === 'flight') return '例如 CX0450';
  return '';
}

// 雙擊 → 直接在格子裡換成 input（值用 property 指派，避免特殊字元破壞 HTML）
function xlsEditStandardField(ev, fileIndex, mawbKey, field) {
  if (XLS_STD_EDITABLE_FIELDS.indexOf(field) < 0) return;
  const f = xlsState.files[fileIndex];
  if (!f || !f._stdCache) return;
  const cell = ev && ev.currentTarget;
  if (!cell || (cell.querySelector && cell.querySelector('input'))) return;
  const rec = f._stdCache.standardized.find((r) => r.mawbKey === mawbKey);
  if (!rec) return;

  cell.classList.add('xls-std-editing');
  cell.innerHTML = '<input type="text" class="xls-std-input" />';
  const input = cell.querySelector('input');
  if (!input) return;
  input.value = rec[field] || '';
  input.placeholder = xlsStdFieldPlaceholder(field);
  input.spellcheck = false;
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    let changed = false;
    if (commit) changed = xlsApplyStandardFieldEdit(fileIndex, rec, field, input.value);
    // DEST 會影響 CNEE 對照區比對 → 重新向後端取一次（③ 顯示與 ④ 執行一致）
    if (changed && field === 'dest') {
      f._stdCache = null;
      renderStandardizedPreview(fileIndex);
      return;
    }
    xlsRenderStandardized(fileIndex); // 同步重繪（取消＝還原原值，不留 input 在格內）
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

// 套用單一欄位的修改：空白／改回原值 → 移除覆寫；回傳「顯示值是否改變」
function xlsApplyStandardFieldEdit(fileIndex, rec, field, raw) {
  if (!rec || XLS_STD_EDITABLE_FIELDS.indexOf(field) < 0) return false;
  const prev = rec[field] || '';
  let value = String(raw == null ? '' : raw).trim();
  if (field === 'mawb') {
    value = xlsNormMawb(value);
    if (!value) return false; // 空白或無法辨識 → 不改（避免整列在 ④ 被略過）
  } else {
    value = value.toUpperCase();
  }

  const orig = (rec._orig && rec._orig[field]) || '';
  const origCmp = field === 'mawb' ? xlsNormMawb(orig) : String(orig).trim().toUpperCase();
  if (!xlsState.fieldOverrides[fileIndex]) xlsState.fieldOverrides[fileIndex] = {};
  const bag = xlsState.fieldOverrides[fileIndex][rec.mawbKey] || {};
  if (!value || value === origCmp) delete bag[field];
  else bag[field] = value;
  if (Object.keys(bag).length) xlsState.fieldOverrides[fileIndex][rec.mawbKey] = bag;
  else delete xlsState.fieldOverrides[fileIndex][rec.mawbKey];

  rec[field] = value || orig; // 立即反映在 ③（不必等重新載入）
  return (rec[field] || '') !== prev;
}

