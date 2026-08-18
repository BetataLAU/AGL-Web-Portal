// ===== 資料庫檢視器前端邏輯 =====
let dbTablesData = [];
let currentDbTable = null;
let currentDbRows = [];

// 批量管理：目前顯示（過濾後）的列與已選取 id
let currentDbFilteredRows = [];
let currentDbSelectedIds = new Set();

// 表的中文顯示名稱
const TABLE_LABELS = {
  skills: '技能資料',
  messages: '論壇 / 留言',
  companies: '公司 / 地點',
  templates: '訂單範本',
  note_templates: '備註文字範本',
  orders: '訂單'
};

// 各表可編輯欄位的中文標籤
const COLUMN_LABELS = {
  id: 'ID',
  category: '類別',
  name: '名稱',
  address: '地址',
  contact_person: '聯絡人',
  phone: '電話',
  email: '電郵',
  notes: '備註',
  created_at: '建立時間',
  updated_at: '更新時間',
  user_name: '用戶名',
  title: '標題',
  content: '內容',
  parent_id: '父ID',
  company_id: '公司ID',
  cargo_desc: '貨品描述',
  quantity: '件數',
  weight_kg: '重量(KG)',
  cbm: 'CBM',
  power_type: '電力分類',
  receiver_name: '收貨人',
  receiver_phone: '聯絡電話',
  order_no: '訂單編號',
  order_type: '訂單類型',
  mawb: 'MAWB#',
  hawb: 'HAWB#',
  pickup_no: '提貨號',
  pickup_company_id: '取貨公司ID',
  delivery_company_id: '送貨公司ID',
  power_code: '電力代碼',
  urgent: '是否趕機',
  transport_company: '運輸公司',
  status: '狀態',
  level: '等級'
};

// 外鍵欄位 → 關聯表（顯示下拉選擇）
const FK_FIELDS = {
  templates: { company_id: 'companies' },
  orders: { pickup_company_id: 'companies', delivery_company_id: 'companies' }
};

// 不可編輯欄位（顯示但防修改）
const HIDDEN_FIELDS = ['id', 'created_at', 'updated_at'];

// 長文字欄位 → 表單渲染為可縮放 textarea
const TEXTAREA_COLUMNS = new Set([
  'content',      // 備註文字範本內容
  'notes',        // 備註
  'address',      // 地址
  'cargo_desc',   // 貨品描述
  'power_items',  // 電力組合（JSON）
  'cbm_dimensions', // CBM 尺寸
  'receiver_note',  // 收貨人備註
  'contact_note',   // 聯絡人備註
  'values',       // 其他可能的多行欄位
  'description'
]);

// 統一使用 apiFetch（定義於 utils/api.js）：
// 自動帶 JSON header + 401 未登入時跳轉登入頁（資料庫檢視器僅限 admin/staff）
function apiDbFetch(url, options = {}) {
  return apiFetch(url, options);
}

// 載入表清單
async function loadDbTables() {
  const result = await apiDbFetch('/api/db/tables');
  dbTablesData = result.data || [];
  renderDbTableTabs();
}

function renderDbTableTabs() {
  const container = document.getElementById('dbviewer-tables');
  if (!container) return;

  container.innerHTML = dbTablesData
    // 不顯示「訂單範本」Tab（僅移除頁面按鈕，templates 表與後端保留）
    .filter(t => t.name !== 'templates')
    .map(t => `
    <button type="button" class="db-table-tab ${currentDbTable === t.name ? 'active' : ''}" data-table="${t.name}">
      ${TABLE_LABELS[t.name] || t.name}
      <span class="db-table-count">${t.count}</span>
    </button>
  `).join('');

  container.querySelectorAll('.db-table-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentDbTable = btn.dataset.table;
      renderDbTableTabs();
      loadDbTableData(currentDbTable);
    });
  });
}

// 載入指定表資料
async function loadDbTableData(tableName) {
  const container = document.getElementById('dbviewer-content');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const result = await apiDbFetch(`/api/db/tables/${tableName}`);
    const { table, columns, rows } = result.data;
    currentDbRows = rows;
    renderDbTable(table, columns, rows);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(err.message)}</div>`;
  }
}

// 建立外鍵下拉選項
async function buildFkOptions(tableName, column, selectedValue) {
  const fkTable = FK_FIELDS[tableName]?.[column];
  if (!fkTable) return null;
  try {
    const result = await apiDbFetch(`/api/db/tables/${fkTable}`);
    const rows = result.data.rows;
    const nameCol = fkTable === 'companies' ? 'name' : 'name';
    return rows.map(r => `<option value="${r.id}" ${Number(r.id) === Number(selectedValue) ? 'selected' : ''}>${escapeHtml(r[nameCol] || `#${r.id}`)}</option>`).join('');
  } catch (e) {
    return null;
  }
}

// 渲染表格
async function renderDbTable(tableName, columns, rows) {
  const container = document.getElementById('dbviewer-content');
  if (!container) return;

  // 載入新資料時重置選擇狀態
  currentDbFilteredRows = rows;
  currentDbSelectedIds.clear();

  // 找出可編輯欄位（隱藏 system 欄位）
  const editableColumns = columns.filter(c => !HIDDEN_FIELDS.includes(c));

  // 為外鍵欄位預載下拉選項
  const fkOptions = {};
  const fkCols = Object.keys(FK_FIELDS[tableName] || {});
  for (const col of fkCols) {
    if (columns.includes(col)) {
      fkOptions[col] = `<option value="">-- 未選擇 --</option>${await buildFkOptions(tableName, col, '')}`;
    }
  }

  container.innerHTML = `
    <div class="dbviewer-toolbar">
      <div class="dbviewer-toolbar-left">
        <div class="dbviewer-search-wrap">
          <i class="fa-solid fa-magnifying-glass dbviewer-search-icon"></i>
          <input type="text" class="dbviewer-search-input" id="dbviewer-search-input" placeholder="搜尋…" autocomplete="off" spellcheck="false" />
          <button type="button" class="dbviewer-search-clear" id="dbviewer-search-clear" title="清除搜尋" aria-label="清除搜尋">×</button>
        </div>
        <button type="button" class="pill btn-primary" id="btn-dbviewer-add">＋ 新增記錄</button>

        <div class="dbviewer-batch-bar" id="dbviewer-batch-bar" style="display:none;">
          <span class="db-batch-count" id="db-batch-count">已選 0 筆</span>
          ${tableName === 'orders' ? `
            <select class="db-batch-status-select" id="db-batch-status-select" title="批量更改狀態">
              <option value="">改狀態…</option>
              <option value="pending">待處理</option>
              <option value="in_progress">進行中</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
            <button type="button" class="pill btn-primary" id="btn-db-batch-status" disabled>套用</button>
          ` : ''}
          <button type="button" class="pill btn-danger" id="btn-db-batch-delete" disabled>🗑️ 批量刪除</button>
          <button type="button" class="pill" id="btn-db-batch-clear">取消選擇</button>
        </div>
      </div>
      <div>
        <strong>${TABLE_LABELS[tableName] || tableName}</strong>
        <span class="db-record-count" id="dbviewer-record-count">共 ${rows.length} 筆</span>
      </div>
    </div>

    <div class="dbviewer-table-wrap">
      <table class="dbviewer-table">
        <thead>
          <tr>
            <th class="db-checkbox-col"><input type="checkbox" id="db-checkbox-all" title="全選 / 取消全選（目前顯示的資料）" /></th>
            <th>操作</th>
            ${editableColumns.map(c => `<th>${COLUMN_LABELS[c] || c}</th>`).join('')}
          </tr>
        </thead>
        <tbody id="dbviewer-table-body">
          ${renderDbRowsHTML(tableName, editableColumns, rows)}
        </tbody>
      </table>
    </div>

    <div id="dbviewer-empty-state"></div>
  `;

  // 新增記錄按鈕（位於搜尋框右側）
  document.getElementById('btn-dbviewer-add').addEventListener('click', () => {
    openAddFormForTable(tableName);
  });

  // 列的操作事件（編輯 / 刪除）
  bindDbRowEvents(tableName, rows, editableColumns, fkOptions);

  // 批量操作列事件（全選 / 批量刪除 / 批量改狀態）
  bindBatchBarEvents(tableName);

  // 搜尋（autocomplete + 即時過濾）
  setupDbSearch(tableName, rows, editableColumns, fkOptions);
}

// 渲染表格 tbody 列
function renderDbRowsHTML(tableName, editableColumns, rows, emptyMessage = '此表目前沒有資料。') {
  if (rows.length === 0) {
    return `<tr><td colspan="100" class="db-no-rows">${emptyMessage}</td></tr>`;
  }
  return rows.map((row, idx) => {
    const isSelected = currentDbSelectedIds.has(Number(row.id));
    return `
    <tr data-id="${row.id}" class="db-row ${isSelected ? 'selected' : ''}">
      <td class="db-checkbox-col">
        <input type="checkbox" class="db-row-checkbox" data-id="${row.id}" ${isSelected ? 'checked' : ''} title="選擇此列" />
      </td>
      <td class="db-row-actions">
        <button type="button" class="db-btn-edit" data-id="${row.id}" title="編輯">✏️</button>
        <button type="button" class="db-btn-delete" data-id="${row.id}" title="刪除">🗑️</button>
      </td>
      ${editableColumns.map(c => `
        <td class="db-cell" data-column="${c}" data-id="${row.id}" data-value="${escapeAttr(row[c] ?? '')}">
          ${renderCellValue(tableName, c, row[c])}
        </td>
      `).join('')}
    </tr>
  `;
  }).join('');
}

// 綁定表格列的編輯 / 刪除 / checkbox 事件
function bindDbRowEvents(tableName, rows, editableColumns, fkOptions) {
  const container = document.getElementById('dbviewer-content');
  if (!container) return;

  // 每列 checkbox 勾選 → 更新已選集合與批量工具列
  container.querySelectorAll('.db-row-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) {
        currentDbSelectedIds.add(id);
      } else {
        currentDbSelectedIds.delete(id);
        const allCb = container.querySelector('#db-checkbox-all');
        if (allCb) {
          allCb.checked = false;
          allCb.indeterminate = false;
        }
      }
      updateRowSelectionState(container);
    });
  });

  // 編輯按鈕
  container.querySelectorAll('.db-btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const row = rows.find(r => Number(r.id) === Number(id));
      if (row) showEditForm(tableName, editableColumns, row, fkOptions);
    });
  });

  // 刪除按鈕
  container.querySelectorAll('.db-btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const row = rows.find(r => Number(r.id) === Number(id));
      const displayName = row?.name || row?.order_no || row?.title || `#${id}`;
      if (!confirm(`確定刪除「${displayName}」(id=${id})？此操作無法復原。`)) return;
      try {
        const result = await apiDbFetch(`/api/db/tables/${tableName}/${id}`, { method: 'DELETE' });
        if (result.changes === 0) {
          alert('找不到該記錄，可能已被刪除');
        } else {
          alert('已刪除');
        }
        await loadDbTableData(tableName);
        await loadDbTables();
      } catch (err) {
        alert(`刪除失敗：${err.message}`);
      }
    });
  });
}

// ===== 批量操作：全選 / 批量刪除 / 批量改狀態 =====

// 依目前已選 id 更新每列 selected class 與批量工具列狀態
function updateRowSelectionState(container) {
  const selectedCount = currentDbSelectedIds.size;

  // 列高亮與 checkbox 同步
  container.querySelectorAll('.db-row').forEach(tr => {
    const id = Number(tr.dataset.id);
    tr.classList.toggle('selected', currentDbSelectedIds.has(id));
    const cb = tr.querySelector('.db-row-checkbox');
    if (cb) cb.checked = currentDbSelectedIds.has(id);
  });

  const batchBar = container.querySelector('#dbviewer-batch-bar');
  const countEl = container.querySelector('#db-batch-count');
  const deleteBtn = container.querySelector('#btn-db-batch-delete');
  const statusBtn = container.querySelector('#btn-db-batch-status');
  const statusSel = container.querySelector('#db-batch-status-select');

  if (batchBar) batchBar.style.display = selectedCount > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = `已選 ${selectedCount} 筆`;
  if (deleteBtn) deleteBtn.disabled = selectedCount === 0;
  if (statusBtn) statusBtn.disabled = selectedCount === 0;
  if (statusSel) statusSel.disabled = selectedCount === 0;
}

// 綁定批量操作工具列事件（renderDbTable 時呼叫一次）
function bindBatchBarEvents(tableName) {
  const container = document.getElementById('dbviewer-content');
  if (!container) return;

  const allCb = container.querySelector('#db-checkbox-all');
  const deleteBtn = container.querySelector('#btn-db-batch-delete');
  const statusBtn = container.querySelector('#btn-db-batch-status');
  const statusSel = container.querySelector('#db-batch-status-select');
  const clearBtn = container.querySelector('#btn-db-batch-clear');

  // 全選 / 取消全選（作用於目前顯示、過濾後的資料）
  if (allCb) {
    allCb.addEventListener('change', () => {
      if (allCb.checked) {
        currentDbFilteredRows.forEach(r => currentDbSelectedIds.add(Number(r.id)));
        allCb.indeterminate = false;
      } else {
        currentDbFilteredRows.forEach(r => currentDbSelectedIds.delete(Number(r.id)));
      }
      // 更新每列 checkbox 的 checked 狀態
      container.querySelectorAll('.db-row-checkbox').forEach(cb => {
        cb.checked = allCb.checked;
      });
      updateRowSelectionState(container);
    });
  }

  // 取消選擇
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      currentDbSelectedIds.clear();
      if (allCb) {
        allCb.checked = false;
        allCb.indeterminate = false;
      }
      updateRowSelectionState(container);
    });
  }

  // 批量刪除
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const ids = [...currentDbSelectedIds];
      if (ids.length === 0) return;
      const displayNames = currentDbFilteredRows
        .filter(r => ids.includes(Number(r.id)))
        .map(r => r.name || r.order_no || r.title || `#${r.id}`)
        .slice(0, 10)
        .join('、');
      const more = ids.length > 10 ? ` 等 ${ids.length} 筆` : '';
      if (!confirm(`確定刪除這 ${ids.length} 筆？\n${displayNames}${more}\n此操作無法復原。`)) return;
      try {
        const result = await apiDbFetch(`/api/db/tables/${tableName}/batch-delete`, {
          method: 'POST',
          body: JSON.stringify({ ids })
        });
        alert(`已刪除 ${result.changes} 筆`);
        currentDbSelectedIds.clear();
        await loadDbTableData(tableName);
        await loadDbTables();
      } catch (err) {
        alert(`批量刪除失敗：${err.message}`);
      }
    });
  }

  // 批量改狀態（訂單表專用）
  if (statusBtn && statusSel) {
    statusBtn.addEventListener('click', async () => {
      const newStatus = statusSel.value;
      if (!newStatus) { alert('請先選擇要套用的狀態'); return; }
      const ids = [...currentDbSelectedIds];
      if (ids.length === 0) return;
      const statusLabels = { pending: '待處理', in_progress: '進行中', completed: '已完成', cancelled: '已取消' };
      if (!confirm(`確定將這 ${ids.length} 筆訂單的狀態改為「${statusLabels[newStatus] || newStatus}」？`)) return;
      try {
        const result = await apiDbFetch(`/api/db/tables/${tableName}/batch-update`, {
          method: 'PUT',
          body: JSON.stringify({ ids, data: { status: newStatus } })
        });
        alert(`已更新 ${result.changes} 筆訂單狀態`);
        currentDbSelectedIds.clear();
        await loadDbTableData(tableName);
        await loadDbTables();
      } catch (err) {
        alert(`批量更新失敗：${err.message}`);
      }
    });
  }
}

// ===== 表格搜尋（autocomplete + 即時過濾） =====
function setupDbSearch(tableName, allRows, editableColumns, fkOptions) {
  const container = document.getElementById('dbviewer-content');
  if (!container) return;

  const searchInput = container.querySelector('#dbviewer-search-input');
  const clearBtn = container.querySelector('#dbviewer-search-clear');
  const countEl = container.querySelector('#dbviewer-record-count');
  if (!searchInput || !clearBtn || !countEl) return;

  let totalCount = allRows.length;

  // 收集該表常見欄位值作為 autocomplete 候選（名稱 / 編號 / 電話等優先）
  function buildSuggestions() {
    const suggestions = getSearchSuggestionColumns(editableColumns)
      .map(c => allRows.map(r => r[c]))
      .flat()
      .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
      .map(v => String(v).trim());
    return [...new Set(suggestions)];
  }

  // 依關鍵字過濾並重新渲染表格，同時保留編輯 / 刪除事件
  function applyFilter() {
    const q = searchInput.value.trim();
    const qLower = q.toLowerCase();

    const filteredRows = qLower
      ? allRows.filter(row =>
          editableColumns.some(c => {
            const v = row[c];
            return v !== null && v !== undefined && String(v).toLowerCase().includes(qLower);
          })
        )
      : allRows;

    currentDbFilteredRows = filteredRows;

    const emptyMessage = qLower && filteredRows.length === 0
      ? `沒有符合「${escapeHtml(q)}」的資料。`
      : '此表目前沒有資料。';

    const tbody = container.querySelector('#dbviewer-table-body');
    if (tbody) tbody.innerHTML = renderDbRowsHTML(tableName, editableColumns, filteredRows, emptyMessage);

    countEl.textContent = qLower
      ? `符合 ${filteredRows.length} / 共 ${totalCount} 筆`
      : `共 ${totalCount} 筆`;

    const emptyEl = container.querySelector('#dbviewer-empty-state');
    if (emptyEl) emptyEl.innerHTML = '';

    clearBtn.style.display = qLower ? 'flex' : 'none';

    // 重新綁定列的編輯 / 刪除事件
    bindDbRowEvents(tableName, filteredRows, editableColumns, fkOptions);
  }

  // 輸入即時過濾
  searchInput.addEventListener('input', applyFilter);

  // 清除搜尋
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    applyFilter();
    searchInput.focus();
  });

  // 掛載通用 autocomplete（點選建議值後套用過濾）
  setupAutocomplete({
    input: searchInput,
    suggestions: buildSuggestions,
    onSelect: () => applyFilter(),
    emptyMessage: '沒有相符的欄位值，可繼續輸入自訂關鍵字。'
  });
}

// 決定哪些欄位值進入 autocomplete 建議（名稱 / 編號類優先，其餘補齊）
function getSearchSuggestionColumns(editableColumns) {
  const priority = editableColumns.filter(c => /name|no|title|phone|email|address|category|status|level|type/.test(c));
  const rest = editableColumns.filter(c => !priority.includes(c));
  return [...priority, ...rest];
}

// 渲染單元格內容
function renderCellValue(tableName, column, value) {
  if (value === null || value === undefined || value === '') return '<span class="db-null">(空)</span>';

  // 訂單狀態顯示顏色
  if (column === 'status' && typeof value === 'string') {
    const statusLabels = { pending: '待處理', in_progress: '進行中', completed: '已完成', cancelled: '已取消' };
    const cls = value;
    return `<span class="db-status-badge ${cls}">${statusLabels[value] || value}</span>`;
  }

  // 訂單類型
  if (column === 'order_type') {
    return value === 'delivery' ? '🚚 送貨' : value === 'pickup' ? '📥 收貨' : value;
  }

  // 電力分類
  if (column === 'power_type') {
    const labels = { no: '⚡ 無電', dry: '🔋 乾電', lithium: '🔋 鋰電' };
    return labels[value] || value;
  }

  // 趕機
  if (column === 'urgent') {
    return value === 'yes' ? '🔴 趕機' : '⚪ 普通';
  }

  // 外鍵欄位帶出關聯名稱
  if (FK_FIELDS[tableName]?.[column]) {
    return `<span class="db-fk-value">#${value}</span>`;
  }

  return escapeHtml(String(value));
}

function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '\x26amp;')
    .replace(/"/g, '\x22quot;')
    .replace(/</g, '\x26lt;')
    .replace(/>/g, '\x26gt;');
}

// 顯示新增表單
function showAddForm(tableName, editableColumns, fkOptions) {
  const container = document.getElementById('dbviewer-content');

  const formHtml = `
    <div class="db-form-overlay">
      <div class="db-form-card">
        <div class="db-form-header">
          <h3>＋ 新增記錄（${TABLE_LABELS[tableName] || tableName}）</h3>
          <button type="button" class="db-form-close" id="btn-db-form-close">&times;</button>
        </div>
        <div class="db-form-body">
          <div class="db-form-grid">
            ${editableColumns.map(c => `
              <div class="db-form-field">
                <label>${COLUMN_LABELS[c] || c}</label>
                ${fkOptions[c] !== undefined
                  ? `<select data-col="${c}" class="db-form-input">
                      <option value="">-- 未選擇 --</option>
                      ${fkOptions[c].replace('<option value="">-- 未選擇 --</option>', '')}
                    </select>`
                  : c === 'status' ? `<select data-col="${c}" class="db-form-input">
                      <option value="pending">待處理</option>
                      <option value="in_progress">進行中</option>
                      <option value="completed">已完成</option>
                      <option value="cancelled">已取消</option>
                    </select>`
                  : c === 'order_type' ? `<select data-col="${c}" class="db-form-input">
                      <option value="delivery">🚚 送貨</option>
                      <option value="pickup">📥 收貨</option>
                    </select>`
                  : c === 'power_type' ? `<select data-col="${c}" class="db-form-input">
                      <option value="no">⚡ 無電</option>
                      <option value="dry">🔋 乾電</option>
                      <option value="lithium">🔋 鋰電</option>
                    </select>`
                  : c === 'urgent' ? `<select data-col="${c}" class="db-form-input">
                      <option value="no">⚪ 普通</option>
                      <option value="yes">🔴 趕機</option>
                    </select>`
                  : c === 'parent_id' ? `<input type="number" class="db-form-input" data-col="${c}" placeholder="留空 = 主題" />`
                  : TEXTAREA_COLUMNS.has(c) ? `<textarea class="db-form-input db-form-textarea" data-col="${c}" rows="4"></textarea>`
                  : `<input type="text" class="db-form-input" data-col="${c}" />`
                }
              </div>
            `).join('')}
          </div>
          <div class="db-form-note">
            ⚠️ <strong>注意</strong>：id / 建立時間等系統欄位會自動產生，不需填寫。
          </div>
        </div>
        <div class="db-form-actions">
          <button type="button" class="pill" id="btn-db-form-cancel">取消</button>
          <button type="button" class="pill btn-primary" id="btn-db-form-submit">✅ 儲存</button>
        </div>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', formHtml);

  const overlay = container.querySelector('.db-form-overlay');
  const closeBtn = overlay.querySelector('#btn-db-form-close');
  const cancelBtn = overlay.querySelector('#btn-db-form-cancel');
  const submitBtn = overlay.querySelector('#btn-db-form-submit');

  function closeForm() {
    overlay.remove();
  }

  closeBtn.addEventListener('click', closeForm);
  cancelBtn.addEventListener('click', closeForm);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeForm();
  });

  submitBtn.addEventListener('click', async () => {
    const payload = {};
    let hasValue = false;
    editableColumns.forEach(c => {
      const input = overlay.querySelector(`[data-col="${c}"]`);
      if (input) {
        const val = input.value.trim();
        payload[c] = val;
        if (val !== '') hasValue = true;
      }
    });
    if (!hasValue) {
      alert('請至少填寫一個欄位');
      return;
    }
    try {
      const result = await apiDbFetch(`/api/db/tables/${tableName}`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      alert(`新增成功 (id=${result.id})`);
      closeForm();
      await loadDbTableData(tableName);
      await loadDbTables();
    } catch (err) {
      alert(`新增失敗：${err.message}`);
    }
  });
}

// 顯示編輯表單
function showEditForm(tableName, editableColumns, row, fkOptions) {
  const container = document.getElementById('dbviewer-content');

  // 編輯時預先載入外鍵選項（帶上目前值）
  const formHtml = `
    <div class="db-form-overlay">
      <div class="db-form-card">
        <div class="db-form-header">
          <h3>✏️ 編輯記錄 #${row.id}（${TABLE_LABELS[tableName] || tableName}）</h3>
          <button type="button" class="db-form-close" id="btn-db-form-close">&times;</button>
        </div>
        <div class="db-form-body">
          <div class="db-form-grid">
            ${editableColumns.map(c => {
              const currentVal = row[c] ?? '';
              if (fkOptions[c] !== undefined) {
                const options = fkOptions[c].replace('<option value="">-- 未選擇 --</option>', '');
                return `<div class="db-form-field">
                  <label>${COLUMN_LABELS[c] || c}</label>
                  <select data-col="${c}" class="db-form-input">
                    <option value="">-- 未選擇 --</option>
                    ${options.split('</option>').map(opt => {
                      const m = opt.match(/value="([^"]*)"/);
                      const val = m ? m[1] : '';
                      return `${opt}</option>`.replace(`value="${val}"`, `value="${val}" ${String(currentVal) === String(val) ? 'selected' : ''}`);
                    }).join('')}
                  </select>
                </div>`;
              }
              if (c === 'status') {
                return `<div class="db-form-field">
                  <label>${COLUMN_LABELS[c] || c}</label>
                  <select data-col="${c}" class="db-form-input">
                    <option value="pending" ${currentVal === 'pending' ? 'selected' : ''}>待處理</option>
                    <option value="in_progress" ${currentVal === 'in_progress' ? 'selected' : ''}>進行中</option>
                    <option value="completed" ${currentVal === 'completed' ? 'selected' : ''}>已完成</option>
                    <option value="cancelled" ${currentVal === 'cancelled' ? 'selected' : ''}>已取消</option>
                  </select>
                </div>`;
              }
              if (c === 'order_type') {
                return `<div class="db-form-field">
                  <label>${COLUMN_LABELS[c] || c}</label>
                  <select data-col="${c}" class="db-form-input">
                    <option value="delivery" ${currentVal === 'delivery' ? 'selected' : ''}>🚚 送貨</option>
                    <option value="pickup" ${currentVal === 'pickup' ? 'selected' : ''}>📥 收貨</option>
                  </select>
                </div>`;
              }
              if (c === 'power_type') {
                return `<div class="db-form-field">
                  <label>${COLUMN_LABELS[c] || c}</label>
                  <select data-col="${c}" class="db-form-input">
                    <option value="no" ${currentVal === 'no' ? 'selected' : ''}>⚡ 無電</option>
                    <option value="dry" ${currentVal === 'dry' ? 'selected' : ''}>🔋 乾電</option>
                    <option value="lithium" ${currentVal === 'lithium' ? 'selected' : ''}>🔋 鋰電</option>
                  </select>
                </div>`;
              }
              if (c === 'urgent') {
                return `<div class="db-form-field">
                  <label>${COLUMN_LABELS[c] || c}</label>
                  <select data-col="${c}" class="db-form-input">
                    <option value="no" ${currentVal === 'no' ? 'selected' : ''}>⚪ 普通</option>
                    <option value="yes" ${currentVal === 'yes' ? 'selected' : ''}>🔴 趕機</option>
                  </select>
                </div>`;
              }
              if (c === 'category') {
                return `<div class="db-form-field">
                  <label>${COLUMN_LABELS[c] || c}</label>
                  <input type="text" class="db-form-input" data-col="${c}" value="${escapeAttr(currentVal)}" />
                </div>`;
              }
              if (TEXTAREA_COLUMNS.has(c)) {
                return `<div class="db-form-field">
                  <label>${COLUMN_LABELS[c] || c}</label>
                  <textarea class="db-form-input db-form-textarea" data-col="${c}" rows="4">${escapeHtml(currentVal)}</textarea>
                </div>`;
              }
              return `<div class="db-form-field">
                <label>${COLUMN_LABELS[c] || c}</label>
                <input type="${c === 'quantity' || c === 'weight_kg' || c === 'cbm' || c === 'level' || c === 'parent_id' ? 'number' : 'text'} step="any" class="db-form-input" data-col="${c}" value="${escapeAttr(currentVal)}" />
              </div>`;
            }).join('')}
          </div>
          <div class="db-form-note">
            ⚠️ <strong>注意</strong>：id / 建立時間 / 更新時間由系統自動管理。
          </div>
        </div>
        <div class="db-form-actions">
          <button type="button" class="pill" id="btn-db-form-cancel">取消</button>
          <button type="button" class="pill btn-primary" id="btn-db-form-submit">💾 儲存變更</button>
        </div>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', formHtml);

  const overlay = container.querySelector('.db-form-overlay');
  const closeBtn = overlay.querySelector('#btn-db-form-close');
  const cancelBtn = overlay.querySelector('#btn-db-form-cancel');
  const submitBtn = overlay.querySelector('#btn-db-form-submit');

  function closeForm() {
    overlay.remove();
  }

  closeBtn.addEventListener('click', closeForm);
  cancelBtn.addEventListener('click', closeForm);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeForm();
  });

  submitBtn.addEventListener('click', async () => {
    const payload = {};
    let hasValue = false;
    editableColumns.forEach(c => {
      const input = overlay.querySelector(`[data-col="${c}"]`);
      if (input) {
        payload[c] = input.value;
        hasValue = true;
      }
    });
    if (!hasValue) {
      alert('沒有可儲存的欄位');
      return;
    }
    try {
      const result = await apiDbFetch(`/api/db/tables/${tableName}/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (result.changes === 0) {
        alert('沒有變更（或記錄不存在）');
      } else {
        alert(`已更新 ${result.changes} 筆`);
      }
      closeForm();
      await loadDbTableData(tableName);
      await loadDbTables();
    } catch (err) {
      alert(`更新失敗：${err.message}`);
    }
  });
}

// ===== 備註文字範本管理（獨立介面） =====
let noteTemplatesData = [];

// 載入所有備註文字範本
async function loadNoteTemplates() {
  const result = await apiDbFetch('/api/orders/note-templates');
  noteTemplatesData = result.data || [];
  renderNoteTemplatesList();
}

// 渲染範本列表
function renderNoteTemplatesList() {
  const listEl = document.getElementById('note-templates-list');
  if (!listEl) return;

  if (noteTemplatesData.length === 0) {
    listEl.innerHTML = '<div class="empty-state">目前沒有備註文字範本。</div>';
    return;
  }

  listEl.innerHTML = noteTemplatesData.map(t => `
    <button type="button" class="note-template-item" data-id="${t.id}">
      <span class="note-template-name">${escapeHtml(t.name)}</span>
      <span class="note-template-meta">#${t.id}</span>
    </button>
  `).join('');

  listEl.querySelectorAll('.note-template-item').forEach(btn => {
    btn.addEventListener('click', () => {
      listEl.querySelectorAll('.note-template-item').forEach(i => i.classList.remove('active'));
      btn.classList.add('active');
      showNoteTemplateDetail(Number(btn.dataset.id));
    });
  });
}

// 顯示範本詳細內容（含編輯）
function showNoteTemplateDetail(id) {
  const template = noteTemplatesData.find(t => Number(t.id) === Number(id));
  const detailEl = document.getElementById('note-template-detail');
  if (!detailEl || !template) return;

  detailEl.innerHTML = `
    <div class="note-template-detail-header">
      <div>
        <strong>${escapeHtml(template.name)}</strong>
        <span class="db-record-count">#${template.id}</span>
      </div>
      <div class="note-template-detail-actions">
        <button type="button" class="pill" id="btn-note-template-save">💾 儲存</button>
        <button type="button" class="pill btn-danger" id="btn-note-template-delete">🗑️ 刪除</button>
      </div>
    </div>
    <label class="note-template-field-label">範本名稱</label>
    <input type="text" class="db-form-input" id="note-template-name-input" value="${escapeAttr(template.name)}" />
    <label class="note-template-field-label">範本內容</label>
    <textarea class="db-form-input note-template-textarea" id="note-template-content-input" rows="14">${escapeHtml(template.content || '')}</textarea>
  `;

  const saveBtn = detailEl.querySelector('#btn-note-template-save');
  const deleteBtn = detailEl.querySelector('#btn-note-template-delete');

  saveBtn.addEventListener('click', async () => {
    const nameInput = detailEl.querySelector('#note-template-name-input');
    const contentInput = detailEl.querySelector('#note-template-content-input');
    const name = nameInput.value.trim();
    const content = contentInput.value.trim();
    if (!name) { alert('範本名稱不可為空'); return; }
    if (!content) { alert('範本內容不可為空'); return; }
    try {
      const result = await apiDbFetch('/api/orders/note-templates', {
        method: 'POST',
        body: JSON.stringify({ name, content })
      });
      alert(result.updated ? '已更新範本內容' : `已新增範本 (id=${result.id})`);
      await loadNoteTemplates();
      // 若名稱變更，重新選取該筆
      showNoteTemplateDetail(Number(result.id));
      renderNoteTemplateCount();
    } catch (err) {
      alert(`儲存失敗：${err.message}`);
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`確定刪除範本「${template.name}」？此操作無法復原。`)) return;
    try {
      const result = await apiDbFetch(`/api/db/tables/note_templates/${id}`, { method: 'DELETE' });
      if (result.changes === 0) {
        alert('找不到該範本，可能已被刪除');
      } else {
        alert('已刪除');
      }
      await loadNoteTemplates();
      showNoteTemplateDetail(null);
      renderNoteTemplateCount();
    } catch (err) {
      alert(`刪除失敗：${err.message}`);
    }
  });
}

// 顯示空白的新增表單
function showNoteTemplateAddForm() {
  const detailEl = document.getElementById('note-template-detail');
  if (!detailEl) return;

  document.querySelectorAll('.note-template-item').forEach(i => i.classList.remove('active'));

  detailEl.innerHTML = `
    <div class="note-template-detail-header">
      <div>
        <strong>＋ 新增範本</strong>
      </div>
      <div class="note-template-detail-actions">
        <button type="button" class="pill btn-primary" id="btn-note-template-save">✅ 儲存</button>
      </div>
    </div>
    <label class="note-template-field-label">範本名稱</label>
    <input type="text" class="db-form-input" id="note-template-name-input" placeholder="例如：提貨注意事項" />
    <label class="note-template-field-label">範本內容</label>
    <textarea class="db-form-input note-template-textarea" id="note-template-content-input" rows="14" placeholder="輸入備註文件內容..."></textarea>
  `;

  const saveBtn = detailEl.querySelector('#btn-note-template-save');
  saveBtn.addEventListener('click', async () => {
    const nameInput = detailEl.querySelector('#note-template-name-input');
    const contentInput = detailEl.querySelector('#note-template-content-input');
    const name = nameInput.value.trim();
    const content = contentInput.value.trim();
    if (!name) { alert('範本名稱不可為空'); return; }
    if (!content) { alert('範本內容不可為空'); return; }
    try {
      const result = await apiDbFetch('/api/orders/note-templates', {
        method: 'POST',
        body: JSON.stringify({ name, content })
      });
      alert(result.updated ? '已更新範本內容' : `已新增範本 (id=${result.id})`);
      await loadNoteTemplates();
      showNoteTemplateDetail(Number(result.id));
      renderNoteTemplateCount();
    } catch (err) {
      alert(`儲存失敗：${err.message}`);
    }
  });
}

// 更新按鈕上的範本數量
function renderNoteTemplateCount() {
  const btn = document.getElementById('btn-dbviewer-note-templates');
  if (btn) {
    const count = noteTemplatesData.length;
    btn.innerHTML = `<i class="fa-solid fa-note-sticky"></i> 📝 備註文字範本${count > 0 ? ` (${count})` : ''}`;
  }
}

// 開啟備註文字範本管理 Modal
function openNoteTemplatesModal() {
  let overlay = document.getElementById('note-templates-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'note-templates-modal';
    overlay.className = 'db-form-overlay';
    overlay.innerHTML = `
      <div class="db-form-card note-templates-modal-card">
        <div class="db-form-header">
          <h3><i class="fa-solid fa-note-sticky"></i> 📝 備註文字範本管理</h3>
          <button type="button" class="db-form-close" id="btn-note-templates-close">&times;</button>
        </div>
        <div class="note-templates-modal-body">
          <div class="note-templates-sidebar">
            <div class="note-templates-sidebar-header">
              <strong>範本列表</strong>
              <button type="button" class="pill btn-primary note-templates-add-btn" id="btn-note-template-add">＋ 新增</button>
            </div>
            <div class="note-templates-list" id="note-templates-list">
              <div class="loading-spinner"></div>
            </div>
          </div>
          <div class="note-template-detail" id="note-template-detail">
            <div class="empty-state">請選擇左側範本，或點「＋ 新增」建立新文字範本。</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('#btn-note-templates-close');
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const addBtn = overlay.querySelector('#btn-note-template-add');
    addBtn.addEventListener('click', () => showNoteTemplateAddForm());
  }

  loadNoteTemplates();
  renderNoteTemplateCount();
}

// 開啟「選擇資料表」Modal（尚未選擇任何表時按「＋ 新增記錄」使用）
function showDbTablePicker() {
  const tables = dbTablesData.filter(t => t.name !== 'templates');
  if (tables.length === 0) {
    alert('目前沒有可新增記錄的資料表。');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'db-form-overlay';
  overlay.innerHTML = `
    <div class="db-form-card db-table-picker-card">
      <div class="db-form-header">
        <h3>＋ 選擇要新增記錄的資料表</h3>
        <button type="button" class="db-form-close" id="btn-db-table-picker-close">&times;</button>
      </div>
      <div class="db-table-picker-grid">
        ${tables.map(t => `
          <button type="button" class="db-table-picker-btn" data-table="${t.name}">
            <span>${TABLE_LABELS[t.name] || t.name}</span>
            <span class="db-table-count">${t.count}</span>
          </button>
        `).join('')}
      </div>
      <div class="db-form-actions">
        <button type="button" class="pill" id="btn-db-table-picker-cancel">取消</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#btn-db-table-picker-close');
  const cancelBtn = overlay.querySelector('#btn-db-table-picker-cancel');
  function closePicker() {
    overlay.remove();
  }
  closeBtn.addEventListener('click', closePicker);
  cancelBtn.addEventListener('click', closePicker);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePicker();
  });

  overlay.querySelectorAll('.db-table-picker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tableName = btn.dataset.table;
      closePicker();
      openAddFormForTable(tableName);
    });
  });
}

// 開啟指定資料表的新增表單（載入欄位後顯示）
async function openAddFormForTable(tableName) {
  try {
    const result = await apiDbFetch(`/api/db/tables/${tableName}`);
    const { columns } = result.data;
    const editableColumns = columns.filter(c => !HIDDEN_FIELDS.includes(c));

    // 預載外鍵下拉選項
    const fkOptions = {};
    const fkCols = Object.keys(FK_FIELDS[tableName] || {});
    for (const col of fkCols) {
      if (columns.includes(col)) {
        fkOptions[col] = `<option value="">-- 未選擇 --</option>${await buildFkOptions(tableName, col, '')}`;
      }
    }

    showAddForm(tableName, editableColumns, fkOptions);
  } catch (err) {
    alert(`載入資料表失敗：${err.message}`);
  }
}

// 初始化
function setupDbViewerSection() {
  const refreshBtn = document.getElementById('btn-dbviewer-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await loadDbTables();
      if (currentDbTable) await loadDbTableData(currentDbTable);
    });
  }

  const noteTemplatesBtn = document.getElementById('btn-dbviewer-note-templates');
  if (noteTemplatesBtn) {
    noteTemplatesBtn.addEventListener('click', openNoteTemplatesModal);
    // 預先載入範本數量顯示在按鈕上
    apiDbFetch('/api/orders/note-templates').then(result => {
      noteTemplatesData = result.data || [];
      renderNoteTemplateCount();
    }).catch(() => {});
  }

  loadDbTables();
}
