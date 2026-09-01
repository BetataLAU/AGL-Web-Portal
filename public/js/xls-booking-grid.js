// ===== Shipper Role Project - XLS Booking 前端（預覽表格編輯） =====
// 從 xls-booking.js 拆出（.clinerule.md：檔案大小控制）
// 職責：雙擊編輯 / 右鍵選單（新增刪除平移）/ 復原重做。


// ===== 預覽表格編輯（雙擊修改 / 右鍵新增刪除平移 / 復原重做） =====
let xlsCtxMenuEl = null;
let xlsCtxAnchor = null;
let xlsCtxReposition = null;

function xlsMarkEdited(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (f) f.previewEdited = true;
}

// ===== 編輯歷史（復原 / 重做） =====
function xlsCloneGrid(rows) {
  return rows.map((row) => row.map((v) => {
    if (v instanceof Date) return new Date(v.getTime());
    return v;
  }));
}

function xlsPushUndo(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  if (!f.undoStack) f.undoStack = [];
  f.undoStack.push(xlsCloneGrid(f.lastPreview.rows));
  if (f.undoStack.length > 50) f.undoStack.shift();
  f.redoStack = [];
}

function xlsUndo(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview || !f.undoStack || !f.undoStack.length) return;
  f.redoStack.push(xlsCloneGrid(f.lastPreview.rows));
  f.lastPreview.rows = f.undoStack.pop();
  xlsMarkEdited(fileIndex);
  renderPreviewPanel(fileIndex, f.lastPreview);
}

function xlsRedo(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview || !f.redoStack || !f.redoStack.length) return;
  f.undoStack.push(xlsCloneGrid(f.lastPreview.rows));
  f.lastPreview.rows = f.redoStack.pop();
  xlsMarkEdited(fileIndex);
  renderPreviewPanel(fileIndex, f.lastPreview);
}

// ② 預覽：空格「按一下即編輯」（保留雙擊與右鍵功能）
function xlsEditCellIfEmpty(ev, fileIndex, r, c) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  const cell = ev.currentTarget;
  if (!cell || cell.querySelector('input')) return;
  const cur = f.lastPreview.rows[r] ? f.lastPreview.rows[r][c] : '';
  if (xlsCellDisplay(cur)) return; // 非空格不觸發
  xlsEditCell(ev, fileIndex, r, c);
}

function xlsEditCell(ev, fileIndex, r, c) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  const cell = ev.currentTarget;
  if (!cell || cell.querySelector('input')) return;
  const oldVal = f.lastPreview.rows[r] ? f.lastPreview.rows[r][c] : '';
  const display = xlsCellDisplay(oldVal);
  cell.innerHTML = '<input class="xls-cell-input" type="text" value="' + xlsEscapeHtml(display) + '" />';
  const input = cell.querySelector('input');
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    let newVal = input.value;
    if (typeof oldVal === 'number') {
      const n = Number(newVal);
      if (newVal.trim() !== '' && !isNaN(n)) newVal = n;
    }
    xlsPushUndo(fileIndex);
    f.lastPreview.rows[r][c] = newVal;
    xlsMarkEdited(fileIndex);
    renderPreviewPanel(fileIndex, f.lastPreview);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { done = true; renderPreviewPanel(fileIndex, f.lastPreview); }
  });
  input.addEventListener('blur', commit);
  input.addEventListener('click', (e) => e.stopPropagation());
}

function xlsCloseContextMenu() {
  if (xlsCtxReposition) {
    document.removeEventListener('scroll', xlsCtxReposition, true);
    window.removeEventListener('scroll', xlsCtxReposition);
    xlsCtxReposition = null;
  }
  if (xlsCtxMenuEl) {
    xlsCtxMenuEl.remove();
    xlsCtxMenuEl = null;
  }
  xlsCtxAnchor = null;
}

function xlsPositionContextMenu() {
  if (!xlsCtxMenuEl || !xlsCtxAnchor) return;
  const rect = xlsCtxAnchor.getBoundingClientRect();
  const mw = xlsCtxMenuEl.offsetWidth || 190;
  const mh = xlsCtxMenuEl.offsetHeight || 260;
  let left = rect.left;
  let top = rect.bottom + 2;
  if (left + mw > window.innerWidth - 6) left = Math.max(4, window.innerWidth - mw - 6);
  if (top + mh > window.innerHeight - 6) top = Math.max(4, rect.top - mh - 2);
  xlsCtxMenuEl.style.left = left + 'px';
  xlsCtxMenuEl.style.top = top + 'px';
}

function xlsShowContextMenu(ev, fileIndex, r, c) {
  ev.preventDefault();
  ev.stopPropagation();
  xlsCloseContextMenu();
  const menu = document.createElement('div');
  menu.className = 'xls-context-menu';
  const defs = [
    { label: '↩ 復原（Undo）', fn: () => xlsUndo(fileIndex) },
    { label: '↪ 重做（Redo）', fn: () => xlsRedo(fileIndex) },
    { divider: true },
    { label: '插入一格 → 右移', fn: () => xlsInsertCell(fileIndex, r, c, 'right') },
    { label: '插入一格 → 下移', fn: () => xlsInsertCell(fileIndex, r, c, 'down') },
    { divider: true },
    { label: '刪除一格 → 左移', fn: () => xlsDeleteCell(fileIndex, r, c, 'left') },
    { label: '刪除一格 → 上移', fn: () => xlsDeleteCell(fileIndex, r, c, 'up') },
    { divider: true },
    { label: '插入整列（下方）', fn: () => xlsInsertRow(fileIndex, r, 'after') },
    { label: '刪除整列', fn: () => xlsDeleteRow(fileIndex, r) },
    { divider: true },
    { label: '插入整欄（右側）', fn: () => xlsInsertColumn(fileIndex, c, 'after') },
    { label: '刪除整欄', fn: () => xlsDeleteColumn(fileIndex, c) },
  ];
  defs.forEach((d) => {
    if (d.divider) {
      const div = document.createElement('div');
      div.className = 'xls-ctx-divider';
      menu.appendChild(div);
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xls-ctx-item';
    btn.textContent = d.label;
    btn.addEventListener('click', () => { xlsCloseContextMenu(); d.fn(); });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  xlsCtxMenuEl = menu;
  xlsCtxAnchor = ev.currentTarget;
  xlsPositionContextMenu();
  xlsCtxReposition = () => xlsPositionContextMenu();
  document.addEventListener('scroll', xlsCtxReposition, true);
  window.addEventListener('scroll', xlsCtxReposition);
}

function xlsInsertCell(fileIndex, r, c, dir) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  xlsPushUndo(fileIndex);
  const grid = f.lastPreview.rows;
  if (dir === 'right') {
    if (grid[r]) { grid[r].splice(c, 0, ''); grid[r].pop(); }
  } else if (dir === 'down') {
    for (let rr = grid.length - 1; rr > r; rr--) {
      grid[rr][c] = grid[rr - 1][c];
    }
    if (grid[r]) grid[r][c] = '';
  }
  xlsMarkEdited(fileIndex);
  renderPreviewPanel(fileIndex, f.lastPreview);
}

function xlsDeleteCell(fileIndex, r, c, dir) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  xlsPushUndo(fileIndex);
  const grid = f.lastPreview.rows;
  if (dir === 'left') {
    if (grid[r] && c < grid[r].length) {
      grid[r].splice(c, 1);
      grid[r].push('');
    }
  } else if (dir === 'up') {
    for (let rr = r; rr < grid.length - 1; rr++) {
      grid[rr][c] = grid[rr + 1][c];
    }
    if (grid.length) grid[grid.length - 1][c] = '';
  }
  xlsMarkEdited(fileIndex);
  renderPreviewPanel(fileIndex, f.lastPreview);
}

function xlsInsertRow(fileIndex, r, dir) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  xlsPushUndo(fileIndex);
  const grid = f.lastPreview.rows;
  const cols = Math.max(0, ...grid.map((row) => row.length));
  const at = Math.min(grid.length, r + (dir === 'after' ? 1 : 0));
  grid.splice(at, 0, Array(cols).fill(''));
  xlsMarkEdited(fileIndex);
  renderPreviewPanel(fileIndex, f.lastPreview);
}

function xlsDeleteRow(fileIndex, r) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  xlsPushUndo(fileIndex);
  const grid = f.lastPreview.rows;
  if (r >= 0 && r < grid.length) grid.splice(r, 1);
  xlsMarkEdited(fileIndex);
  renderPreviewPanel(fileIndex, f.lastPreview);
}

function xlsInsertColumn(fileIndex, c, dir) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  xlsPushUndo(fileIndex);
  const grid = f.lastPreview.rows;
  const at = c + (dir === 'after' ? 1 : 0);
  grid.forEach((row) => { row.splice(at, 0, ''); });
  xlsMarkEdited(fileIndex);
  renderPreviewPanel(fileIndex, f.lastPreview);
}

function xlsDeleteColumn(fileIndex, c) {
  const f = xlsState.files[fileIndex];
  if (!f || !f.lastPreview) return;
  xlsPushUndo(fileIndex);
  const grid = f.lastPreview.rows;
  grid.forEach((row) => { if (c < row.length) row.splice(c, 1); });
  xlsMarkEdited(fileIndex);
  renderPreviewPanel(fileIndex, f.lastPreview);
}
