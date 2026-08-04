// ===== 資料庫檢視器前端邏輯 =====
let dbTablesData = [];
let currentDbTable = null;
let currentDbRows = [];

// 表的中文顯示名稱
const TABLE_LABELS = {
  skills: '技能資料',
  messages: '論壇 / 留言',
  companies: '公司 / 地點',
  templates: '訂單範本',
  note_templates: '備註文件範本',
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

async function apiDbFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    let errorMsg = '請求失敗';
    try {
      const errData = await res.json();
      if (errData.error) errorMsg = errData.error;
    } catch (e) { /* ignore */ }
    throw new Error(errorMsg);
  }
  return res.json();
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

  container.innerHTML = dbTablesData.map(t => `
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

  // 找出可編輯欄位（隱藏 system 欄位）
  const editableColumns = columns.filter(c => !HIDDEN_FIELDS.includes(c));
  const idColumn = columns.find(c => c === 'id');

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
      <div>
        <strong>${TABLE_LABELS[tableName] || tableName}</strong>
        <span class="db-record-count">共 ${rows.length} 筆</span>
      </div>
      <button type="button" class="pill btn-primary" id="btn-dbviewer-add">＋ 新增記錄</button>
    </div>

    <div class="dbviewer-table-wrap">
      <table class="dbviewer-table">
        <thead>
          <tr>
            <th>操作</th>
            ${editableColumns.map(c => `<th>${COLUMN_LABELS[c] || c}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, idx) => `
            <tr data-id="${row.id}">
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
          `).join('')}
        </tbody>
      </table>
    </div>

    ${rows.length === 0 ? '<div class="empty-state">此表目前沒有資料。</div>' : ''}
  `;

  // 新增記錄按鈕
  document.getElementById('btn-dbviewer-add').addEventListener('click', () => {
    showAddForm(tableName, editableColumns, fkOptions);
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
              return `<div class="db-form-field">
                <label>${COLUMN_LABELS[c] || c}</label>
                <input type="${c === 'quantity' || c === 'weight_kg' || c === 'cbm' || c === 'level' || c === 'parent_id' ? 'number' : 'text'} step="any" class="db-form-input" data-col="${c}" value="${escapeAttr(currentVal)}" />
              </div>`;
            }).join('')}
          </div>
          <div class="db-form-note">
            ⚠️ <strong>注意</strong>：id / 建立時間 / 更新時間 / 訂單狀態由系統自動管理。
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

// 初始化
function setupDbViewerSection() {
  const refreshBtn = document.getElementById('btn-dbviewer-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await loadDbTables();
      if (currentDbTable) await loadDbTableData(currentDbTable);
    });
  }
  loadDbTables();
}