// ===== Shipper Role Project - XLS Booking 前端（上傳與檔案列表） =====
// 從 xls-booking.js 拆出（.clinerule.md：檔案大小控制）



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
    // 全新檔案 = 全新狀態：清空上一輪的勾選與 CNEE 補值，
    // 否則新檔案會沿用舊 MAWB 選取，導致 ③ 的全選 checkbox「按不到」
    xlsState.selections = {};
    xlsState.cneeOverrides = {};
    // 清空上一輪殘留的 ②③④ 面板內容，避免舊表格的 checkbox 殘留在畫面上誤導操作
    ['xls-preview-panel', 'xls-standardized-panel', 'xls-result-panel'].forEach((pid) => {
      const p = document.getElementById(pid);
      if (p) { p.style.display = 'none'; p.innerHTML = ''; }
    });
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
    card.id = `xls-file-card-${i}`;
    const sheetSelect = f.sheets.length > 1
      ? `<label class="xls-sheet-picker">工作表
          <select onchange="xlsSelectSheet(${i}, this.value)">
            ${f.sheets.map((s, idx) => `<option value="${idx}" ${(f.def.sheetIndex || 0) === idx ? 'selected' : ''}>${xlsEscapeHtml(s.name)}</option>`).join('')}
          </select>
        </label>`
      : '';
    card.innerHTML = `
      <div class="xls-file-header">
        <strong>${xlsEscapeHtml(f.originalName)}</strong>
        <span class="xls-file-sheets">${f.sheets.length} 個 sheet</span>
      </div>
      ${sheetSelect}
      <div class="xls-file-actions">
        <button type="button" class="pill" onclick="xlsPreviewFile(${i})">預覽 / 定義欄位</button>
      </div>
      ${f.parseError ? `<div class="xls-error">${xlsEscapeHtml(f.parseError)}</div>` : ''}
    `;
    container.appendChild(card);
  });
}
