// ===== Shipper Role Project - 前端互動介面 =====
// 功能：上傳 XLS → 預覽 → 定義欄位 → 標準化預覽 → 執行完整工作流程

const XLS_FIELD_TYPES = [
  { value: 'ignore', label: '忽略' },
  { value: 'mawb', label: 'MAWB#' },
  { value: 'dest', label: 'DEST' },
  { value: 'pcs', label: '件數' },
  { value: 'weight', label: '重量' },
  { value: 'battery', label: '帶電件數' },
  { value: 'flight', label: '航班號' },
  { value: 'flight_date', label: '航班日期' },
  { value: 'remark', label: 'REMARK' },
  { value: 'cnee_name', label: 'CNEE 名稱' },
];

let xlsState = {
  uploadId: null,
  files: [],
  defs: [], // 每個檔案一個欄位定義
};

// ===== 工具 =====
function xlsEscapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (m) => (
    { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[m]
  ));
}

function xlsCellDisplay(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('');
  return String(v);
}

// ===== 上傳 =====
async function uploadFiles(files) {
  const formData = new FormData();
  for (const f of files) formData.append('files', f);
  const btn = document.getElementById('xls-upload-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await apiFetch('/api/xls-booking/upload', { method: 'POST', body: formData });
    xlsState.uploadId = res.uploadId;
    xlsState.files = res.files.map((f) => ({ ...f, def: { sheetIndex: 0, fieldMap: {} } }));
    xlsState.defs = [];
    renderFileList();
  } catch (err) {
    alert('上傳失敗：' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ===== 檔案列表 =====
function renderFileList() {
  const container = document.getElementById('xls-file-list');
  if (!container) return;
  container.innerHTML = '';
  xlsState.files.forEach((f, i) => {
    const card = document.createElement('div');
    card.className = 'xls-file-card';
    card.innerHTML = `
      <div class="xls-file-header">
        <strong>${xlsEscapeHtml(f.originalName)}</strong>
        <span class="xls-file-sheets">${f.sheets.length} 個 sheet</span>
      </div>
      <div class="xls-file-actions">
        <button type="button" class="pill" onclick="xlsPreviewFile(${i})">預覽 / 定義欄位</button>
      </div>
      ${f.parseError ? `<div class="xls-error">${xlsEscapeHtml(f.parseError)}</div>` : ''}
    `;
    container.appendChild(card);
  });
}

// ===== 自動偵測欄位類型 =====
// 依「表頭關鍵字 + 資料樣本格式」判斷；只回傳高信心判定
function xlsAutoDetect(rows) {
  const suggestions = {};
  if (!rows || !rows.length) return suggestions;
  const headerRow = rows[0] || [];
  const sampleRows = rows.slice(1, 5); // 前 4 筆資料作樣本

  const kwMap = [
    { type: 'mawb', keywords: ['主单编码', '主单号', 'mawb', 'mawno', '提单号', '主单号码'] },
    { type: 'dest', keywords: ['目的港', 'dest', 'destination', '到達港'] },
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

  headerRow.forEach((h, ci) => {
    const headerText = String(h == null ? '' : h).toLowerCase().trim();
    if (!headerText) return;
    for (const { type, keywords } of kwMap) {
      if (!keywords.some((kw) => headerText.includes(kw))) continue;
      const samples = sampleRows.map((r) => r[ci]).filter((v) => v !== null && v !== undefined && v !== '');
      if (!samples.length) continue;
      // 高信心判定：表頭關鍵字 + 樣本格式符合
      if (type === 'mawb' && samples.some(looksMawb)) { suggestions[ci] = type; break; }
      if (type === 'dest' && samples.some(looksDest)) { suggestions[ci] = type; break; }
      if (type === 'pcs' && samples.some(looksNumber)) { suggestions[ci] = type; break; }
      if (type === 'weight' && samples.some(looksNumber)) { suggestions[ci] = type; break; }
      if (type === 'battery' && samples.some(looksNumber)) { suggestions[ci] = type; break; }
      if (type === 'flight_date' && samples.some(looksDate)) { suggestions[ci] = type; break; }
      // 純文字類型（航班/REMARK/CNEE）依表頭即可
      if (type === 'flight' || type === 'remark' || type === 'cnee_name') { suggestions[ci] = type; break; }
    }
  });
  return suggestions;
}

// ===== 預覽與欄位定義面板 =====
async function xlsPreviewFile(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f || f.parseError) return;
  const res = await apiFetch(`/api/xls-booking/preview/${xlsState.uploadId}/${f.id}/0`);
  f.lastPreview = res; // 儲存供重新繪製/快速指派
  renderPreviewPanel(fileIndex, res);
}

function renderPreviewPanel(fileIndex, data) {
  const panel = document.getElementById('xls-preview-panel');
  if (!panel) return;
  const f = xlsState.files[fileIndex];
  const def = f.def;

  // ===== 自動偵測：僅填入尚未指派的欄位 =====
  const autoSuggest = xlsAutoDetect(data.rows);
  let autoCount = 0;
  Object.entries(autoSuggest).forEach(([ci, type]) => {
    if (!def.fieldMap[ci]) {
      def.fieldMap[ci] = type;
      autoCount++;
    }
  });

  // ===== 未指派欄位清單 =====
  const allTypes = XLS_FIELD_TYPES.filter((t) => t.value !== 'ignore');
  const assignedValues = new Set(Object.values(def.fieldMap));
  const unassignedTypes = allTypes.filter((t) => !assignedValues.has(t.value));

  let html = `
    <div class="xls-unassigned-bar">
      ${unassignedTypes.length
        ? `<span class="xls-unassigned-label">未指派：</span>${unassignedTypes
            .map((t) => `<button type="button" class="xls-unassigned-tag" onclick="xlsAssignNext(${fileIndex}, '${t.value}')" title="點擊指派到第一個符合的欄位">${t.label}</button>`)
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
      <p class="xls-preview-note">點選每一欄上方的下拉選單指定欄位類型，然後按「套用欄位定義」。</p>
    </div>
    <div class="xls-preview-table-wrap">
      <table class="xls-preview-table">
        <thead>
          <tr>
            <th>列</th>
            ${data.rows[0] ? data.rows[0].map((_, ci) => `
              <th>
                <select data-col="${ci}" class="xls-col-type" onchange="xlsUpdateUnassignedBar(${fileIndex})">
                  <option value="ignore">忽略</option>
                  ${XLS_FIELD_TYPES.filter((t) => t.value !== 'ignore').map((t) => `
                    <option value="${t.value}" ${def.fieldMap[ci] === t.value ? 'selected' : ''}>${t.label}</option>
                  `).join('')}
                </select>
                <div class="xls-col-letter">${xlsColName(ci)}</div>
              </th>
            `).join('') : ''}
          </tr>
          <tr>${data.rows[0] ? data.rows[0].map((_, ci) => `<th class="xls-col-header-cell">${xlsEscapeHtml(xlsCellDisplay(data.rows[0][ci]))}</th>`).join('') : ''}</tr>
        </thead>
        <tbody>
          ${data.rows.slice(1).map((r, ri) => `
            <tr>
              <td class="xls-row-num">${ri + 2}</td>
              ${r.map((c) => `<td>${xlsEscapeHtml(xlsCellDisplay(c))}</td>`).join('')}
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
  panel.style.display = 'block';
  document.getElementById('xls-preview-panel').scrollIntoView({ behavior: 'smooth' });
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
    xlsState.files[fileIndex].def.firstDataRow = v;
    alert(`資料起始列已設為第 ${v} 列`);
  }
}

function xlsApplyFieldMap(fileIndex) {
  const selects = document.querySelectorAll('.xls-col-type');
  const def = xlsState.files[fileIndex].def;
  def.fieldMap = {};
  selects.forEach((sel) => {
    if (sel.value !== 'ignore') {
      def.fieldMap[Number(sel.dataset.col)] = sel.value;
    }
  });
  // 儲存/更新 xlsState.defs
  const existing = xlsState.defs.findIndex((d) => d.fileIndex === fileIndex);
  if (existing >= 0) xlsState.defs.splice(existing, 1);
  xlsState.defs.push({ fileIndex, sheetIndex: 0, firstDataRow: def.firstDataRow || 2, fieldMap: def.fieldMap });
  renderStandardizedPreview(fileIndex);
  document.getElementById('xls-standardized-panel').scrollIntoView({ behavior: 'smooth' });
}

function xlsClosePreview() {
  document.getElementById('xls-preview-panel').style.display = 'none';
}

// ===== 即時更新「未指派欄位」TAG 條 =====
// 在下拉選單變更時呼叫：指派了某類型 → 該類型 TAG 消失；轉回忽略 → TAG 重現
function xlsUpdateUnassignedBar(fileIndex) {
  const panel = document.getElementById('xls-preview-panel');
  if (!panel) return;
  const bar = panel.querySelector('.xls-unassigned-bar');
  if (!bar) return;

  // 同步更新 def.fieldMap（與下拉選單一致）
  const def = xlsState.files[fileIndex].def;
  const newFieldMap = {};
  panel.querySelectorAll('.xls-col-type').forEach((sel) => {
    if (sel.value && sel.value !== 'ignore') {
      newFieldMap[Number(sel.dataset.col)] = sel.value;
    }
  });
  def.fieldMap = newFieldMap;

  // 讀取目前所有下拉選單的選取值
  const assignedValues = new Set(Object.values(newFieldMap));

  const allTypes = XLS_FIELD_TYPES.filter((t) => t.value !== 'ignore');
  const unassignedTypes = allTypes.filter((t) => !assignedValues.has(t.value));

  bar.innerHTML = unassignedTypes.length
    ? `<span class="xls-unassigned-label">未指派：</span>${unassignedTypes
        .map((t) => `<button type="button" class="xls-unassigned-tag" onclick="xlsAssignNext(${fileIndex}, '${t.value}')" title="點擊指派到第一個符合的欄位">${t.label}</button>`)
        .join('')}`
    : '<span class="xls-unassigned-ok">✅ 所有欄位類型已指派完成</span>';
}

// ===== 快速指派：點擊未指派 TAG → 指派到第一個「未指派類型」的欄位 =====
function xlsAssignNext(fileIndex, type) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  const preview = f.lastPreview;
  const headerRow = preview.rows[0] || [];
  const def = f.def;

  // 找第一個未指派（含自動偵測後仍為空白/忽略）的欄位
  let targetCol = null;
  for (let ci = 0; ci < headerRow.length; ci++) {
    const existingType = def.fieldMap[ci] || '';
    if (existingType === 'ignore' || !existingType) {
      // 該欄位有資料才指派
      const hasData = preview.rows.slice(1).some((r) => r[ci] !== null && r[ci] !== undefined && r[ci] !== '');
      if (hasData) { targetCol = ci; break; }
    }
  }
  if (targetCol === null) {
    alert(`沒有可指派的欄位給「${type}」`);
    return;
  }
  // 指派 + 移除其他欄位相同類型（避免重複）
  Object.keys(def.fieldMap).forEach((ci) => {
    if (def.fieldMap[ci] === type) delete def.fieldMap[ci];
  });
  def.fieldMap[targetCol] = type;
  // 重新繪製
  renderPreviewPanel(fileIndex, preview);
}

// ===== 標準化預覽（前端簡易標準化，供使用者核對） =====
async function renderStandardizedPreview(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f) return;
  const res = await apiFetch(`/api/xls-booking/preview/${xlsState.uploadId}/${f.id}/0`);
  const rows = res.rows;
  const def = xlsState.defs.find((d) => d.fileIndex === fileIndex);
  if (!def) return;

  const extract = (row, type) => {
    for (const [ci, t] of Object.entries(def.fieldMap)) {
      if (t === type) return row[Number(ci)];
    }
    return null;
  };

  const standardized = [];
  rows.slice((def.firstDataRow || 2) - 1).forEach((row) => {
    const mawb = extract(row, 'mawb');
    if (!mawb) return;
    const d = extract(row, 'flight_date');
    standardized.push({
      date: d ? (d instanceof Date ? d.toISOString().slice(0, 10) : d) : '',
      flight: extract(row, 'flight') || '',
      mawb: String(mawb).replace(/[^0-9-]/g, ''),
      dest: extract(row, 'dest') || '',
      pcs: extract(row, 'pcs') || '',
      weight: extract(row, 'weight') || '',
      remark: extract(row, 'remark') || '',
    });
  });

  const panel = document.getElementById('xls-standardized-panel');
  if (!panel) return;
  panel.innerHTML = `
    <h4>標準化結果預覽（${xlsEscapeHtml(f.originalName)}）</h4>
    <div class="xls-standardized-table-wrap">
      <table class="xls-preview-table">
        <thead><tr><th>日期</th><th>航班號</th><th>MAWB#</th><th>DEST</th><th>件數</th><th>重量</th><th>REMARK</th></tr></thead>
        <tbody>
          ${standardized.slice(0, 50).map((r) => `
            <tr><td>${xlsEscapeHtml(r.date)}</td><td>${xlsEscapeHtml(r.flight)}</td><td>${xlsEscapeHtml(r.mawb)}</td><td>${xlsEscapeHtml(r.dest)}</td><td>${xlsEscapeHtml(r.pcs)}</td><td>${xlsEscapeHtml(r.weight)}</td><td>${xlsEscapeHtml(r.remark)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${standardized.length > 50 ? `<p class="xls-preview-note">僅顯示前 50 筆，共 ${standardized.length} 筆。</p>` : ''}
    ${standardized.some((r) => !r.cnee) ? '' : ''}
  `;
  panel.style.display = 'block';
}

// ===== 執行 =====
async function runXlsWorkflow() {
  if (!xlsState.uploadId || !xlsState.defs.length) {
    alert('請先上傳檔案並定義至少一個檔案的欄位');
    return;
  }
  const btn = document.getElementById('xls-run-btn');
  if (btn) btn.disabled = true;
  const status = document.getElementById('xls-status');
  try {
    const res = await apiFetch('/api/xls-booking/process', {
      method: 'POST',
      body: JSON.stringify({ uploadId: xlsState.uploadId, defs: xlsState.defs }),
    });
    if (status) status.textContent = `完成：${res.count} 份 PDF。` + (res.errors.length ? ` 有 ${res.errors.length} 個錯誤。` : '');
    renderResult(res);
  } catch (err) {
    if (status) status.textContent = '執行失敗：' + err.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderResult(res) {
  const panel = document.getElementById('xls-result-panel');
  if (!panel) return;
  let html = `<h4>執行結果</h4>`;
  if (res.errors && res.errors.length) {
    html += `<div class="xls-error">${res.errors.map((e) => xlsEscapeHtml(e)).join('<br>')}</div>`;
  }
  html += `<p>成功產生 ${res.count} 份 PDF（已合併 SLI + ELI）。</p>`;
  html += `<div class="xls-downloads">`;
  // report 下載
  const reportName = res.reportPath ? res.reportPath.split(/[\\/]/).pop() : '';
  if (reportName) {
    html += `<a class="pill btn-primary" href="/api/xls-booking/download/report/${res.jobId}/${encodeURIComponent(reportName)}" download>📊 下載 Report</a>`;
  }
  // zip 下載
  (res.zipPaths || []).forEach((z) => {
    html += `<a class="pill" href="/api/xls-booking/download/zip/${res.jobId}/${encodeURIComponent(z.name)}" download>📦 ${xlsEscapeHtml(z.name)}</a>`;
  });
  html += `</div>`;
  if (res.fileResults && res.fileResults.length) {
    html += `<p class="xls-preview-note">${res.fileResults.map((r) => `${xlsEscapeHtml(r.file)}：${r.records} 筆`).join('；')}</p>`;
  }
  panel.innerHTML = html;
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });
}

// ===== 拖曳上傳 =====
function setupXlsDropZone() {
  const zone = document.getElementById('xls-drop-zone');
  const input = document.getElementById('xls-file-input');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files.length) uploadFiles([...input.files]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((evt) => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add('xls-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove('xls-dragging');
    });
  });
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]);
  });
}

// ===== 初始化 =====
function setupXlsBookingSection() {
  setupXlsDropZone();
  const runBtn = document.getElementById('xls-run-btn');
  if (runBtn) runBtn.addEventListener('click', runXlsWorkflow);
}