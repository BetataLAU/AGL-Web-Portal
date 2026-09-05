// ===== Shipper Role Project - XLS Booking 前端（欄位定義與預覽面板） =====
// 從 xls-booking.js 拆出（.clinerule.md：檔案大小控制）
// 職責：自動偵測欄位類型、選擇工作表、預覽表格與欄位指派面板。



// ===== 自動偵測欄位類型 =====
// 依「表頭關鍵字 + 資料樣本格式」判斷；只回傳高信心判定
function xlsAutoDetect(rows) {
  const suggestions = {};
  if (!rows || !rows.length) return suggestions;
  const headerRow = rows[0] || [];
  const sampleRows = rows.slice(1, 5); // 前 4 筆資料作樣本

  const kwMap = [
    { type: 'mawb', keywords: ['主单编码', '主单号', 'mawb', 'mawno', '提单号', '主单号码'] },
    { type: 'dest', keywords: ['目的港', 'dest', 'destination', '到達港', '目的口岸'] },
    { type: 'pcs', keywords: ['件数', '件數', 'pcs', 'ctns', '数量', '箱数', 'pieces'] },
    { type: 'weight', keywords: ['重量', 'weight', 'kg', '毛重', '大包重量'] },
    { type: 'battery', keywords: ['带电', '帶電', '电池', '電池', 'battery', 'eli'] },
    { type: 'flight', keywords: ['航班', 'flight', '航班号'] },
    { type: 'flight_date', keywords: ['日期', '时间', '時間', 'date', 'etd', '创建时间', '出库时间'] },
    { type: 'remark', keywords: ['remark', '备注', '備註', '說明'] },
    { type: 'cnee_name', keywords: ['收货人', '收件人', 'consignee', '提单收件人', 'cnee'] },
  ];

  const looksMawb = (v) => /^\d{3}[- ]?\d{8}$/.test(String(v));
  const looksDest = (v) => /^[A-Z]{3}$/.test(String(v));
  const looksDate = (v) => {
    if (v instanceof Date) return true;
    return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(String(v));
  };
  const looksNumber = (v) => /^[\d.]+$/.test(String(v));

  // ===== 偏好欄位：同類型多欄命中時，優先指派到指定表頭 =====
  const preferredMap = [
    { type: 'pcs', keys: ['已拣选数量', '已揀選數量'] },
    { type: 'flight_date', keys: ['etd'] },
    { type: 'dest', keys: ['目的口岸'] },
    { type: 'battery', keys: ['主单带电数量', '主單帶電數量'] },
  ];

  const formatOk = (type, ci) => {
    const samples = sampleRows.map((r) => r[ci]).filter((v) => v !== null && v !== undefined && v !== '');
    if (!samples.length) return false;
    if (type === 'mawb') return samples.some(looksMawb);
    if (type === 'dest') return samples.some(looksDest);
    if (type === 'pcs' || type === 'weight' || type === 'battery') return samples.some(looksNumber);
    if (type === 'flight_date') return samples.some(looksDate);
    return true; // flight / remark / cnee_name 依表頭即可
  };

  // 第一輪：偏好欄位優先（避免「主单带电数量」被 数量→pcs 搶走）
  const claimedTypes = new Set();
  for (const { type, keys } of preferredMap) {
    for (let ci = 0; ci < headerRow.length; ci++) {
      const headerText = String(headerRow[ci] == null ? '' : headerRow[ci]).toLowerCase().trim();
      if (!headerText) continue;
      if (!keys.some((k) => headerText.includes(k.toLowerCase()))) continue;
      if (!formatOk(type, ci)) continue;
      suggestions[ci] = type;
      claimedTypes.add(type);
      break;
    }
  }

  // 第二輪：一般關鍵字（跳過已被偏好指派與已命中的欄位）
  headerRow.forEach((h, ci) => {
    const headerText = String(h == null ? '' : h).toLowerCase().trim();
    if (!headerText) return;
    if (suggestions[ci] !== undefined) return;
    for (const { type, keywords } of kwMap) {
      if (claimedTypes.has(type)) continue;
      if (!keywords.some((kw) => headerText.includes(kw))) continue;
      if (!formatOk(type, ci)) continue;
      suggestions[ci] = type;
      break;
    }
  });
  return suggestions;
}

// ===== 多工作表：每個 worksheet 各自的欄位定義（TAG）與預覽狀態會分開記憶 =====
// 切換 sheet 時把「目前 sheet」存起來、換上「目標 sheet」的記憶，
// 避免切走再切回時 TAG／手動指派／資料起始列被清空。
function xlsSaveSheetDefinition(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.def) return;
  if (!f.sheetDefs) f.sheetDefs = {};
  const si = f.def.sheetIndex || 0;
  f.sheetDefs[si] = {
    fieldMap: f.def.fieldMap || {},
    firstDataRow: f.def.firstDataRow || 2,
  };
}

function xlsSaveSheetState(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.def) return;
  if (!f.sheetState) f.sheetState = {};
  const si = f.def.sheetIndex || 0;
  f.sheetState[si] = {
    previewEdited: !!f.previewEdited,
    lastPreview: f.lastPreview || null,
    undoStack: f.undoStack || [],
    redoStack: f.redoStack || [],
    stdCache: f._stdCache || null,
    cneeBlocks: f._cneeBlocks || null,
    cneeWarning: f._cneeWarning || '',
  };
}

// 讓 xlsState.defs（③ 標準化 / ④ 執行用）對齊「目前 sheet」。
// 尚未「套用欄位定義」過的檔案不自動建立 defs（維持原本行為）。
function xlsSyncDefToActiveSheet(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.def) return;
  const idx = xlsState.defs.findIndex((d) => d.fileIndex === fileIndex);
  if (idx < 0) return;
  xlsState.defs[idx] = {
    fileIndex,
    sheetIndex: f.def.sheetIndex || 0,
    firstDataRow: f.def.firstDataRow || 2,
    fieldMap: f.def.fieldMap || {},
    cneeLookup: { enabled: true, auto: true },
  };
}

// ===== 選擇工作表（多 sheet 時） =====
function xlsSelectSheet(fileIndex, sheetIndex) {
  const f = xlsState.files[fileIndex];
  if (!f) return;
  const idx = Number(sheetIndex);
  if (isNaN(idx) || idx < 0) return;
  const cur = f.def.sheetIndex || 0;
  if (cur === idx) return;

  // 1) 先把目前 sheet 的 TAG／預覽編輯狀態存入 per-sheet 記憶
  xlsSaveSheetDefinition(fileIndex);
  xlsSaveSheetState(fileIndex);

  // 2) 切到目標 sheet，並還原該 sheet 自己的記憶（無記憶 → 空定義，等「預覽」自動偵測）
  const d = (f.sheetDefs || {})[idx];
  const s = (f.sheetState || {})[idx];
  f.def.sheetIndex = idx;
  f.def.fieldMap = d && d.fieldMap ? d.fieldMap : {};
  f.def.firstDataRow = d && d.firstDataRow ? d.firstDataRow : 2;
  f.previewEdited = s ? !!s.previewEdited : false;
  f.lastPreview = s && s.lastPreview ? s.lastPreview : null;
  f.undoStack = s && Array.isArray(s.undoStack) ? s.undoStack : [];
  f.redoStack = s && Array.isArray(s.redoStack) ? s.redoStack : [];
  f._stdCache = s ? (s.stdCache || null) : null;
  f._cneeBlocks = s ? (s.cneeBlocks || null) : null;
  f._cneeWarning = s ? (s.cneeWarning || '') : '';

  // 3) ③/④ 用的 defs 對齊目前 sheet，避免誤用到其他 sheet 的舊定義
  xlsSyncDefToActiveSheet(fileIndex);

  xlsState.selections[fileIndex] = null;
  renderFileList();
  const sheetName = (f.sheets[idx] || {}).name;
  alert(`已切換到工作表「${sheetName != null ? sheetName : idx}」。各工作表的欄位定義（TAG）會分開記憶；若此表尚未定義過，請按「預覽 / 定義欄位」自動偵測。`);
}

// ===== 預覽與欄位定義面板 =====
async function xlsPreviewFile(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f || f.parseError) return;
  if (f.lastPreview) {
    // ② 已開過：直接沿用記憶體中的預覽結果（各 sheet 分開記憶），
    // 避免重新抓檔把編輯（如刪除 CNEE、改格）與已定義的 TAG 蓋掉。
    renderPreviewPanel(fileIndex, f.lastPreview);
    return;
  }
  const res = await apiFetch(`/api/xls-booking/preview/${xlsState.uploadId}/${f.id}/${f.def.sheetIndex || 0}`);
  f.lastPreview = res; // 儲存供重新繪製/快速指派
  renderPreviewPanel(fileIndex, res);
}

function renderPreviewPanel(fileIndex, data) {
  const panel = document.getElementById('xls-preview-panel');
  if (!panel) return;
  // 記住目前表格的捲動位置（重繪後還原，避免每次指派/取消指派都跳回最左邊）
  const prevWrap = panel.querySelector('.xls-preview-table-wrap');
  const savedScroll = prevWrap ? { left: prevWrap.scrollLeft, top: prevWrap.scrollTop } : null;
  const f = xlsState.files[fileIndex];
  const def = f.def;

  // ===== 讓「無 VALUE」的空格也可以雙擊編輯 =====
  // 部分來源檔（菜鳥 / QR / CX 匯出）資料列短於表頭：列末沒有值的欄位在
  // 資料陣列中根本不存在（後端 eachRow 只讀到該列最後一個有值欄位），
  // DOM 因此沒有產生 <td>，雙擊無效。這裡把每一列補到全表最大欄數
  // （補 null），讓空格以一般空格呈現，並與其他格子一樣可雙擊編輯 / 右鍵操作。
  if (Array.isArray(data.rows)) {
    const maxCols = data.rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
    data.rows.forEach((r) => {
      if (!Array.isArray(r)) return;
      while (r.length < maxCols) r.push(null);
    });
  }

  // ===== 去重：每個類型最多只用在一個欄位（保留最左邊，重複的還原為未指派）=====
  const seenTypes = new Set();
  Object.keys(def.fieldMap).forEach((ci) => {
    const t = def.fieldMap[ci];
    if (!t || t === 'ignore') return;
    if (seenTypes.has(t)) def.fieldMap[ci] = 'ignore';
    else seenTypes.add(t);
  });

  // ===== 自動偵測：僅填入「空欄」且「類型尚未被使用」的欄位 =====
  const autoSuggest = xlsAutoDetect(data.rows);
  let autoCount = 0;
  Object.entries(autoSuggest).forEach(([ci, type]) => {
    if (!def.fieldMap[ci] && !seenTypes.has(type)) {
      def.fieldMap[ci] = type;
      seenTypes.add(type);
      autoCount++;
    }
  });

  // ===== 未指派欄位清單 =====
  const allTypes = XLS_FIELD_TYPES.filter((t) => t.value !== 'ignore');
  const assignedValues = new Set(Object.values(def.fieldMap).filter((v) => v && v !== 'ignore'));
  const unassignedTypes = allTypes.filter((t) => !assignedValues.has(t.value));

  let html = `
    <div class="xls-unassigned-bar">
      ${unassignedTypes.length
        ? `<span class="xls-unassigned-label">未指派：</span>${unassignedTypes
            .map((t) => `<span class="xls-unassigned-tag" draggable="true" ondragstart="xlsDragStart(event, '${t.value}')" onclick="xlsAssignNext(${fileIndex}, '${t.value}')" title="拖曳到欄位，或點擊指派到第一個符合的欄位">${t.label}</span>`)
            .join('')}`
        : '<span class="xls-unassigned-ok">✅ 所有欄位類型已指派完成</span>'}
    </div>
    ${autoCount ? `<p class="xls-preview-note">✨ 已自動偵測 ${autoCount} 個欄位（可手動調整）。</p>` : ''}
    <div class="xls-preview-header">
      <h4>${xlsEscapeHtml(data.fileName)} — ${xlsEscapeHtml(data.sheetName)}</h4>
      <div class="xls-preview-controls">
        <label>資料起始列 <input type="number" id="xls-first-data-row" value="${def.firstDataRow || 2}" min="1" style="width:70px" /></label>
        <button type="button" class="pill" onclick="xlsConfirmDataRow(${fileIndex})">套用</button>
      </div>
      <p class="xls-preview-note">將上方「未指派」標籤拖曳到欄位，或拖曳欄位上的 TAG 到其他欄位搬移指派；雙擊欄位標籤可取消指派，然後按「套用欄位定義」。</p>
    </div>
    <div class="xls-preview-table-wrap">
      <table class="xls-preview-table">
        <thead>
          <tr>
            <th>列</th>
            ${data.rows[0] ? data.rows[0].map((_, ci) => {
              const curType = def.fieldMap[ci] || 'ignore';
              const curDef = XLS_FIELD_TYPES.find((x) => x.value === curType);
              return `
                <th class="xls-col-th" data-col="${ci}" ondragover="xlsDragOver(event)" ondragleave="xlsDragLeave(event)" ondrop="xlsAssignCol(${fileIndex}, ${ci}, event)">
                  ${curType !== 'ignore' && curDef
                    ? `<span class="xls-col-type xls-tag-assigned" data-col="${ci}" data-type="${curDef.value}" draggable="true" ondragstart="xlsDragStart(event, '${curDef.value}')" title="拖曳到其他欄位搬移指派；雙擊取消指派" ondblclick="xlsUnassignCol(${fileIndex}, ${ci})">${curDef.label}</span>`
                    : `<span class="xls-col-type xls-tag-unassigned" data-col="${ci}" data-type="ignore" title="從上方「未指派」標籤拖曳到此欄位">未指派</span>`}
                  <div class="xls-col-letter">${xlsColName(ci)}</div>
                </th>`;
            }).join('') : ''}
          </tr>
          <tr>
            <th class="xls-col-header-cell"></th>
            ${data.rows[0] ? data.rows[0].map((h, ci) => `
              <th class="xls-col-header-cell xls-editable" data-r="0" data-c="${ci}" ondblclick="xlsEditCell(event, ${fileIndex}, 0, ${ci})" oncontextmenu="xlsShowContextMenu(event, ${fileIndex}, 0, ${ci})" title="雙擊編輯；右鍵新增/刪除">${xlsEscapeHtml(xlsCellDisplay(h))}</th>
            `).join('') : ''}
          </tr>
        </thead>
        <tbody>
          ${data.rows.slice(1).map((r, ri) => `
            <tr>
              <td class="xls-row-num">${ri + 2}</td>
              ${r.map((c, ci) => {
                const disp = xlsCellDisplay(c);
                const isEmpty = !disp;
                return `<td class="xls-editable${isEmpty ? ' xls-cell-empty' : ''}" data-r="${ri + 1}" data-c="${ci}" ondblclick="xlsEditCell(event, ${fileIndex}, ${ri + 1}, ${ci})" oncontextmenu="xlsShowContextMenu(event, ${fileIndex}, ${ri + 1}, ${ci})" title="${isEmpty ? '點擊填入；' : ''}雙擊編輯；右鍵新增/刪除"${isEmpty ? ` onclick="xlsEditCellIfEmpty(event, ${fileIndex}, ${ri + 1}, ${ci})"` : ''}>${xlsEscapeHtml(disp)}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="xls-preview-footer">
      <button type="button" class="pill btn-primary" onclick="xlsApplyFieldMap(${fileIndex})">套用欄位定義</button>
      <button type="button" class="pill" onclick="xlsClosePreview()">關閉</button>
    </div>
  `;
  panel.innerHTML = html;
  // 還原表格捲動位置
  if (savedScroll) {
    const newWrap = panel.querySelector('.xls-preview-table-wrap');
    if (newWrap) {
      newWrap.scrollLeft = savedScroll.left;
      newWrap.scrollTop = savedScroll.top;
    }
  }
  panel.style.display = 'block';
  xlsScrollToEl(document.getElementById('xls-preview-panel'));
}

function xlsColName(idx) {
  let s = '';
  idx += 1;
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
}

function xlsConfirmDataRow(fileIndex) {
  const input = document.getElementById('xls-first-data-row');
  if (!input) return;
  const v = Number(input.value);
  if (v >= 1) {
    const f = xlsState.files[fileIndex];
    if (!f) return;
    f.def.firstDataRow = v;
    xlsSaveSheetDefinition(fileIndex); // 資料起始列也依 sheet 分開記住
    alert(`資料起始列已設為第 ${v} 列`);
  }
}

function xlsApplyFieldMap(fileIndex) {
  const panel = document.getElementById('xls-preview-panel');
  const def = xlsState.files[fileIndex].def;
  def.fieldMap = {};
  const used = new Set();
  panel.querySelectorAll('.xls-col-type').forEach((tag) => {
    const type = tag.dataset.type;
    if (type && type !== 'ignore' && !used.has(type)) {
      def.fieldMap[Number(tag.dataset.col)] = type;
      used.add(type);
    }
  });
  // 儲存/更新 xlsState.defs（自動啟用 CNEE 對照區；無對照區的檔案不受影響）
  const existing = xlsState.defs.findIndex((d) => d.fileIndex === fileIndex);
  if (existing >= 0) xlsState.defs.splice(existing, 1);
  xlsState.defs.push({
    fileIndex,
    sheetIndex: def.sheetIndex || 0,
    firstDataRow: def.firstDataRow || 2,
    fieldMap: def.fieldMap,
    cneeLookup: { enabled: true, auto: true },
  });
  xlsSaveSheetDefinition(fileIndex); // 套用後把「目前 sheet」的 TAG 也存進 per-sheet 記憶
  xlsState.files[fileIndex]._stdCache = null; // 欄位定義／表格編輯有變更，標準化需重新計算
  renderStandardizedPreview(fileIndex);
  xlsScrollToEl(document.getElementById('xls-standardized-panel'));
}

function xlsClosePreview() {
  document.getElementById('xls-preview-panel').style.display = 'none';
}

