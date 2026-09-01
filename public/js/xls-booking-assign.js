// ===== Shipper Role Project - XLS Booking 前端（拖曳指派欄位） =====
// 從 xls-booking.js 拆出（.clinerule.md：檔案大小控制）
// 職責：拖曳/點擊指派欄位類型、取消指派、快速指派。


// ===== 拖曳指派 =====

// 由「未指派」列拖曳標籤 → 放下到欄位上方 → 指派該欄位類型
function xlsDragStart(ev, type) {
  ev.dataTransfer.setData('text/plain', type);
  ev.dataTransfer.effectAllowed = 'move';
}

function xlsDragOver(ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  ev.currentTarget.classList.add('xls-drag-over');
}

function xlsDragLeave(ev) {
  // 移入子元素時不取消高亮，只有真正離開欄位格才移除
  if (!ev.currentTarget.contains(ev.relatedTarget)) {
    ev.currentTarget.classList.remove('xls-drag-over');
  }
}

function xlsAssignCol(fileIndex, col, ev) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('xls-drag-over');
  const type = ev.dataTransfer.getData('text/plain');
  if (!type) return;
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  const def = f.def;
  if (def.fieldMap[col] === type) return; // 同一類型不需重複指派
  // 移除其他欄位相同類型（避免重複；標記忽略防止自動偵測回填）
  Object.keys(def.fieldMap).forEach((ci) => {
    if (Number(ci) !== col && def.fieldMap[ci] === type) def.fieldMap[ci] = 'ignore';
  });
  def.fieldMap[col] = type;
  renderPreviewPanel(fileIndex, f.lastPreview);
}

// 雙擊欄位標籤 → 取消指派（回到「未指派」）
function xlsUnassignCol(fileIndex, col) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  f.def.fieldMap[col] = 'ignore';
  renderPreviewPanel(fileIndex, f.lastPreview);
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
  // 指派 + 移除其他欄位相同類型（避免重複；標記忽略防止自動偵測回填）
  Object.keys(def.fieldMap).forEach((ci) => {
    if (def.fieldMap[ci] === type) def.fieldMap[ci] = 'ignore';
  });
  def.fieldMap[targetCol] = type;
  // 重新繪製
  renderPreviewPanel(fileIndex, preview);
}
