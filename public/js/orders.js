// ===== 訂單系統前端邏輯 =====
let ordersData = [];
let companiesCache = [];
let transportCompanies = [];
let currentOrderType = 'pickup';
let editingOrderId = null;
let duplicateConfirmed = false;
// 「今天的收貨」過濾（依提貨日期 pickup_datetime）
let todayPickupActive = false;
// 日期搜尋過濾（依提貨日期 pickup_datetime，'YYYY-MM-DD'）
let dateFilterValue = '';
// blur 重複檢查的 debounce timer（全域：submit handler 需 clearTimeout，防止 blur 卡片覆蓋「仍然繼續」卡片）
let duplicateCheckTimer = null;

// 每個公司欄位的「原始資料快照」（偵測用戶修改既有公司資料）
let companySnapshots = {};
// 備註範本暫存
let noteTemplatesCache = [];
// CBM DIM 尺寸資料 { len, width, height, qty }[]
let currentCbmDimensions = [];

const CATEGORY_LABEL = {
  customer: '客戶公司',
  warehouse: '倉庫/自家地點',
  transport: '運輸公司'
};

const ORDER_TYPE_LABEL = { delivery: '🚚 送貨', pickup: '📥 收貨' };
const STATUS_LABEL = { pending: '待處理', in_progress: '進行中', completed: '已完成', cancelled: '已取消' };
const POWER_TYPE_LABEL = { no: '⚡ 無電', dry: '🔋 乾電', lithium: '🔋 鋰電' };
// 「後補電池資訊」標記（提交時未選擇電池類型的訂單）
const POWER_LATE_LABEL = '後補電池資訊';
const POWER_CODES = {
  dry: ['A67', 'A123', 'A199'],
  lithium: ['PI965', 'PI966', 'PI967', 'PI968', 'PI969', 'PI970']
};
// 鋰電主選項 → PI 子代碼
const LITHIUM_MAIN = {
  ELI: ['PI965', 'PI966', 'PI967'],
  ELM: ['PI968', 'PI969', 'PI970']
};
// 電力組合項目（power_items 元素結構）: { type, main?, code, qty }
const POWER_ITEMS = [];
let powerItemsList = [];

// ===== 訂單 API 載入 =====
async function loadCompanies() {
  const result = await apiFetch('/api/orders/companies');
  companiesCache = result.data || [];
  return companiesCache;
}

async function loadTransportCompanies() {
  const result = await apiFetch('/api/orders/companies?category=transport');
  transportCompanies = result.data || [];
  return transportCompanies;
}

function getCompanyById(id) {
  const numId = Number(id);
  if (!numId) return null;
  return companiesCache.find(c => Number(c.id) === numId) || null;
}

// 判斷某公司是否屬「運輸公司」類別（category 可能是逗號分隔多值，如 "customer,transport"）
function isTransportCategory(category) {
  if (!category) return false;
  return String(category).split(',').map(s => s.trim()).includes('transport');
}

// 依公司 id 找公司名稱
function getCompanyNameById(id) {
  const company = getCompanyById(id);
  return company ? company.name : '';
}

// ===== 公司自動補全（收貨/交回地點） =====
// 為兩個地點輸入框建立 Google 式自動補全
// 採「輸入即時篩選已載入的 companiesCache」；若輸入值不在 cache 即為新公司名（提交時自動儲存）
function setupCompanyAutocomplete(inputId, hiddenId) {
  const input = document.getElementById(inputId);
  const hidden = document.getElementById(hiddenId);
  if (!input) return;

  const listEl = input.parentElement.querySelector('.company-autocomplete-list');
  if (!listEl) return;

  let activeIndex = -1;
  let currentItems = [];

  function closeList() {
    listEl.innerHTML = '';
    listEl.style.display = 'none';
    activeIndex = -1;
    currentItems = [];
  }

  function selectCompany(company) {
    input.value = company.name;
    if (hidden) hidden.value = company.id;
    closeList();
    // 記錄原始快照 + 渲染詳細資料卡
    captureCompanySnapshot(hiddenId);
    renderCompanyDetailCard(inputId, hiddenId);
    handleCompanySelected();
  }

  function showMatches(query) {
    const q = (query || '').trim();
    const candidates = companiesCache.filter(c => !isTransportCategory(c.category));
    let matches;
    if (!q) {
      // 空 → 顯示前 8 間
      matches = candidates.slice(0, 8);
    } else {
      matches = candidates.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 10);
    }
    currentItems = matches;
    listEl.innerHTML = '';
    if (!matches.length) {
      // 無匹配 → 顯示「以新名稱儲存」的提示（但仍允許用戶手動輸入）
      listEl.style.display = 'block';
      listEl.innerHTML = `<div class="company-autocomplete-empty">「${escapeHtml(q)}」不在公司庫，提交時會自動新增。</div>`;
      return;
    }
    listEl.style.display = 'block';
    activeIndex = -1;
    matches.forEach((c, idx) => {
      const div = document.createElement('div');
      div.className = 'company-autocomplete-item';
      div.dataset.index = idx;
      const detailParts = [];
      if (c.address) detailParts.push(c.address);
      if (c.contact_person) detailParts.push(c.contact_person);
      const detail = detailParts.length ? `<span class="company-autocomplete-sub">${escapeHtml(detailParts.join(' · '))}</span>` : '';
      div.innerHTML = `${escapeHtml(c.name)}${detail}`;
      div.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 防止 input blur 關閉清單
        selectCompany(c);
      });
      listEl.appendChild(div);
    });
  }

  input.addEventListener('input', () => {
    // 手動輸入 → 清除已選 id
    if (hidden) hidden.value = '';
    showMatches(input.value);
    // 手動輸入 → 清除快照 + 改為新公司模式
    delete companySnapshots[hiddenId];
    renderCompanyDetailCard(inputId, hiddenId);
  });

  input.addEventListener('focus', () => {
    showMatches(input.value);
  });

  input.addEventListener('keydown', (e) => {
    const items = listEl.querySelectorAll('.company-autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      highlightItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlightItem(items);
    } else if (e.key === 'Enter' && activeIndex >= 0 && currentItems[activeIndex]) {
      e.preventDefault(); // 選中建議，不觸發表單提交
      selectCompany(currentItems[activeIndex]);
    } else if (e.key === 'Escape') {
      closeList();
    } else if (e.key === 'Tab') {
      // 若目前有高亮的建議，先選中它
      if (activeIndex >= 0 && currentItems[activeIndex]) {
        selectCompany(currentItems[activeIndex]);
        // 不 preventDefault，讓 Tab 正常跳到下一欄位
      } else {
        closeList();
      }
    }
  });

  input.addEventListener('blur', () => {
    // 延遲關閉，讓 mousedown 有時間選中項目
    setTimeout(() => {
      if (!listEl.contains(document.activeElement)) closeList();
    }, 150);
  });

  function highlightItem(items) {
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  }
}

// ===== 公司詳細資料卡（快照、渲染、變更偵測） =====
// 記錄公司原始資料快照（existed company 選中時）
function captureCompanySnapshot(hiddenId) {
  const hidden = document.getElementById(hiddenId);
  if (!hidden) return;
  const company = getCompanyById(hidden.value);
  if (!company) {
    delete companySnapshots[hiddenId];
    return;
  }
  companySnapshots[hiddenId] = {
    companyId: company.id,
    name: company.name || '',
    address: company.address || '',
    contact_person: company.contact_person || '',
    phone: company.phone || '',
    email: company.email || '',
    category: company.category || '',
    notes: company.notes || ''
  };
}

// 自動補全選擇公司後，把該公司的聯絡資料靜默帶入訂單 data（不顯示於表單）
function handleCompanySelected() {
  // 資料在 getCurrentFormData 時從公司卡取得，無需額外 UI
}

// 讓公司詳細卡的「備註」textarea 高度至少完全顯示當前文字
function setupCompanyNotesAutosize(card) {
  if (!card) return;
  const box = card.querySelector('textarea');
  if (!box) return;
  const fit = () => {
    box.style.height = 'auto';
    box.style.height = box.scrollHeight + 'px';
  };
  fit();
  box.addEventListener('input', fit);
}

// 每個公司欄位下方渲染詳細資料卡
function renderCompanyDetailCard(inputId, hiddenId) {
  const input = document.getElementById(inputId);
  const hidden = document.getElementById(hiddenId);
  const card = document.getElementById(`${inputId}-detail`);
  if (!input || !card) return;

  const name = (input.value || '').trim();
  const company = hidden && hidden.value ? getCompanyById(hidden.value) : null;

  if (!name) {
    card.innerHTML = '';
    card.style.display = 'none';
    return;
  }

  // 既有公司 → 顯示資料（可編輯，偵測變更）
  if (company) {
    card.style.display = 'block';
    card.className = 'company-detail-card company-detail-existing';
    const cats = (company.category || '').split(',').map(s => s.trim()).filter(Boolean);
    card.innerHTML = `
      <div class="company-detail-header">
        <span>📍 ${escapeHtml(company.name)}</span>
        <span class="company-detail-badge">既有公司（可編輯）</span>
      </div>
      <div class="company-detail-grid">
        <div class="company-detail-field">
          <label>地址</label>
          <input type="text" id="${inputId}-detail-address" value="${escapeAttr(company.address || '')}" placeholder="－" />
        </div>
        <div class="company-detail-field">
          <label>聯絡人</label>
          <input type="text" id="${inputId}-detail-contact" value="${escapeAttr(company.contact_person || '')}" placeholder="－" />
        </div>
        <div class="company-detail-field">
          <label>電話</label>
          <input type="text" id="${inputId}-detail-phone" value="${escapeAttr(company.phone || '')}" placeholder="－" />
        </div>
        <div class="company-detail-field">
          <label>電郵</label>
          <input type="text" id="${inputId}-detail-email" value="${escapeAttr(company.email || '')}" placeholder="－" />
        </div>
        <div class="company-detail-field full">
          <label>類別（可多選）</label>
          <div class="company-detail-categories">
            ${['customer', 'warehouse', 'transport'].map(cat => {
              const checked = cats.includes(cat) ? 'checked' : '';
              return `<label class="orders-category-checkbox"><input type="checkbox" data-cat="${cat}" ${checked} /> ${CATEGORY_LABEL[cat] || cat}</label>`;
            }).join('')}
          </div>
        </div>
      <div class="company-detail-field full">
        <label>備註</label>
        <textarea id="${inputId}-detail-notes" placeholder="－">${escapeAttr(company.notes || '')}</textarea>
      </div>
    </div>
    `;
    setupCompanyNotesAutosize(card); // 備註欄高度完整顯示目前文字
    return;
  }

  // 新公司 → 可編輯空欄位 + 提示
  card.style.display = 'block';
  card.className = 'company-detail-card company-detail-new';
  card.innerHTML = `
    <div class="company-detail-header">
      <span>➕ ${escapeHtml(name)}（新公司）</span>
      <span class="company-detail-badge warn">⚠️ 無資料，待 USER 提供</span>
    </div>
    <div class="company-detail-hint">此公司不在公司庫，提交訂單時會自動新增一筆資料。可現在補充以下資料：</div>
    <div class="company-detail-grid">
      <div class="company-detail-field">
        <label>地址</label>
        <input type="text" id="${inputId}-detail-address" placeholder="地址（可留空）" />
      </div>
      <div class="company-detail-field">
        <label>聯絡人</label>
        <input type="text" id="${inputId}-detail-contact" placeholder="聯絡人（可留空）" />
      </div>
      <div class="company-detail-field">
        <label>電話</label>
        <input type="text" id="${inputId}-detail-phone" placeholder="電話（可留空）" />
      </div>
      <div class="company-detail-field">
        <label>電郵</label>
        <input type="text" id="${inputId}-detail-email" placeholder="電郵（可留空）" />
      </div>
      <div class="company-detail-field full">
        <label>類別（可多選）</label>
        <div class="company-detail-categories">
          <label class="orders-category-checkbox"><input type="checkbox" data-cat="customer" checked /> 客戶公司</label>
          <label class="orders-category-checkbox"><input type="checkbox" data-cat="warehouse" /> 倉庫/自家地點</label>
          <label class="orders-category-checkbox"><input type="checkbox" data-cat="transport" /> 運輸公司</label>
        </div>
      </div>
      <div class="company-detail-field full">
        <label>備註</label>
        <textarea id="${inputId}-detail-notes" placeholder="備註（可留空）"></textarea>
      </div>
    </div>
  `;
  setupCompanyNotesAutosize(card); // 備註欄高度完整顯示目前文字
}

// 收集某欄位的公司資料（從詳細卡 input 讀取）
function getCompanyDetailData(inputId) {
  const getVal = (suffix) => {
    const el = document.getElementById(`${inputId}-detail-${suffix}`);
    return el ? el.value.trim() : '';
  };
  const cats = [];
  document.querySelectorAll(`#${inputId}-detail .company-detail-categories input[type="checkbox"]:checked`).forEach(cb => {
    if (cb.dataset && cb.dataset.cat) cats.push(cb.dataset.cat);
  });
  return {
    address: getVal('address'),
    contact_person: getVal('contact'),
    phone: getVal('phone'),
    email: getVal('email'),
    notes: getVal('notes'),
    category: cats.join(',')
  };
}

// 偵測某欄位是否改動了既有公司資料 → 回傳變更清單
function detectCompanyChanges(inputId, hiddenId) {
  const snapshot = companySnapshots[hiddenId];
  if (!snapshot) return [];
  const hidden = document.getElementById(hiddenId);
  if (!hidden || !hidden.value) return [];
  const current = getCompanyDetailData(inputId);

  const fieldMap = [
    ['address', '地址'],
    ['contact_person', '聯絡人'],
    ['phone', '電話'],
    ['email', '電郵'],
    ['notes', '備註']
  ];
  const changes = [];
  const inputEl = document.getElementById(inputId);
  const nameVal = inputEl ? inputEl.value.trim() : '';
  if (nameVal !== snapshot.name) {
    changes.push({ field: 'name', label: '名稱', oldVal: snapshot.name, newVal: nameVal });
  }
  fieldMap.forEach(([key, label]) => {
    const oldVal = snapshot[key] || '';
    const newVal = current[key] || '';
    if (oldVal !== newVal) {
      changes.push({ field: key, label, oldVal, newVal });
    }
  });
  const oldCat = snapshot.category || '';
  const newCat = current.category || '';
  if (oldCat !== newCat) {
    changes.push({
      field: 'category', label: '類別',
      oldVal: oldCat.split(',').filter(Boolean).map(c => CATEGORY_LABEL[c] || c).join('、') || '—',
      newVal: newCat.split(',').filter(Boolean).map(c => CATEGORY_LABEL[c] || c).join('、') || '—'
    });
  }
  return changes;
}

// 彈出「修改既有公司資料」通知 modal（現在值以閃爍文字顯示）
function showCompanyUpdateModal(changesByField, onConfirm) {
  const entries = Object.entries(changesByField).map(([hiddenId, changes]) => {
    const inputEl = document.getElementById(hiddenId.replace('-id', ''));
    const companyName = inputEl ? escapeHtml(inputEl.value.trim()) : '';
    const rows = changes.map(ch => `
      <div class="company-change-row">
        <span class="company-change-field">${escapeHtml(ch.label)}：</span>
        <span class="company-change-old">原本 ${escapeHtml(ch.oldVal || '—')}</span>
        <span class="company-change-arrow">→</span>
        <span class="company-change-new blink-text">${escapeHtml(ch.newVal || '—')}</span>
      </div>
    `).join('');
    return `
      <div class="company-change-group">
        <div class="company-change-title">🏢 ${companyName}</div>
        ${rows}
      </div>
    `;
  }).join('');

  openModal({
    title: '⚠️ 以下公司資料有改動',
    body: `
      <div class="company-change-modal">
        <p>你修改了以下既有公司的資料。確認後會一併更新公司庫，並儲存訂單。</p>
        ${entries}
      </div>
    `,
    actions: [
      {
        label: '✅ 確認更新並儲存',
        className: 'pill btn-primary',
        onClick: (modal) => {
          modal.close();
          onConfirm();
        }
      },
      {
        label: '✏️ 返回修改',
        className: 'pill',
        onClick: (modal) => modal.close()
      }
    ]
  });
}

// ===== 備註文字範本 =====
async function searchNoteTemplates(query) {
  try {
    const params = new URLSearchParams();
    if (query) params.set('search', query);
    const result = await apiFetch(`/api/orders/note-templates?${params.toString()}`);
    noteTemplatesCache = result.data || [];
    return noteTemplatesCache;
  } catch (err) {
    console.warn('備註範本搜尋失敗：', err.message);
    return [];
  }
}

async function saveNoteTemplate(name, content) {
  const result = await apiFetch('/api/orders/note-templates', {
    method: 'POST',
    body: JSON.stringify({ name, content })
  });
  return result;
}

// ===== CBM DIM 處理 =====
function formatCbmDimensions(dims) {
  if (!dims || !dims.length) return '';
  const lines = dims.map(d => `${d.len} x ${d.width} x ${d.height} / ${d.qty}`);
  return `DIM(cm):\n${lines.join('\n')}`;
}

function renderCbmDimPreview() {
  const container = document.getElementById('cbm-dim-preview');
  if (!container) return;
  if (!currentCbmDimensions.length) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  container.style.display = 'block';
  container.innerHTML = `
    <div class="cbm-dim-box">
      <div class="cbm-dim-title">📐 尺寸明細（將加入訂單總結）</div>
      <pre>${escapeHtml(formatCbmDimensions(currentCbmDimensions))}</pre>
    </div>
  `;
}

// 查詢是否已有重複的訂單（MAWB# / HAWB# / 客戶提貨號）
async function checkDuplicateOrder() {
  const mawbVal = document.getElementById('order-mawb')?.value.trim() || '';
  const hawbVal = document.getElementById('order-hawb')?.value.trim() || '';
  const pickupVal = document.getElementById('order-pickup-no')?.value.trim() || '';
  const customerCompanyId = document.getElementById('order-customer-id')?.value?.trim() || '';

  const params = new URLSearchParams();
  if (mawbVal && !isLateMawb(mawbVal)) {
    // MAWB 標準化後查詢
    const mawbResult = validateMawb(mawbVal);
    if (mawbResult.valid && !mawbResult.late) params.set('mawb', mawbResult.formatted);
  }
  if (hawbVal) params.set('hawb', hawbVal);
  if (pickupVal) params.set('pickup_no', pickupVal);
  // 已選客戶 → 後端只比對同一客戶的提貨號（精確）；未選客戶 → 全表提醒
  if (customerCompanyId) params.set('customer_company_id', customerCompanyId);
  if (editingOrderId) params.set('exclude_id', editingOrderId);

  const query = params.toString();
  if (!query) return [];

  try {
    const result = await apiFetch(`/api/orders/check-duplicate?${query}`);
    return result.data || [];
  } catch (err) {
    console.warn('重複檢查失敗：', err.message);
    return [];
  }
}

// 顯示重複訂單浮動卡片
// mode: 'submit' = 提交時（按「仍然繼續」會直接提交已收集的資料）；'blur' = 離開欄位即時檢查（按「知道了」只關閉卡片）
// onConfirm: 可選，submit 模式按下「仍然繼續」時呼叫（用於直接提交已收集的 data，避免重跑 submit handler）
function showDuplicateCard(orders, mode = 'submit', onConfirm = null) {
  // 移除舊卡片
  document.querySelectorAll('.duplicate-order-modal').forEach(el => el.remove());

  if (!orders || !orders.length) return;
  const isBlurMode = mode === 'blur';
  // 是否已選「需要提貨的客戶」；未選客戶時 pickup_no 重複只是提醒（不同客戶可用同號）
  const customerCompanyId = (document.getElementById('order-customer-id')?.value || '').trim();
  const isPickupReminderOnly = isBlurMode && !customerCompanyId;

  const entries = orders.map(order => {
    // 找出哪個欄位重複
    const mawbVal = (document.getElementById('order-mawb')?.value || '').trim();
    const hawbVal = (document.getElementById('order-hawb')?.value || '').trim();
    const pickupVal = (document.getElementById('order-pickup-no')?.value || '').trim();
    const matchFields = [];
    if (mawbVal && displayMawb(order.mawb) === displayMawb(mawbVal)) matchFields.push('MAWB#');
    if (hawbVal && order.hawb === hawbVal) matchFields.push('HAWB#');
    if (pickupVal && order.pickup_no === pickupVal) matchFields.push('客戶提貨號');

    // 沒有任何欄位真正與輸入值重複 → 不顯示（避免無重複的記錄混入）
    if (matchFields.length === 0) return null;

    // 顯示時優先使用客戶公司名稱（後端已 join 回傳）
    const companyName = order.customer_company_name
      || (order.order_type === 'delivery'
        ? (order.delivery_company_name || order.pickup_company_name || '-')
        : (order.pickup_company_name || order.delivery_company_name || '-'));

    // 只顯示有重複的欄位；不重複的欄位顯示「─」
    const mawbLabel = matchFields.includes('MAWB#')
      ? `<span class="duplicate-order-blink">${escapeHtml(displayMawb(order.mawb))}</span>`
      : '<span class="duplicate-order-nomatch">─</span>';
    const hawbLabel = matchFields.includes('HAWB#')
      ? `<span class="duplicate-order-blink">${escapeHtml(order.hawb || '-')}</span>`
      : '<span class="duplicate-order-nomatch">─</span>';
    const pickupLabel = matchFields.includes('客戶提貨號')
      ? `<span class="duplicate-order-blink">${escapeHtml(order.pickup_no || '-')}</span>`
      : '<span class="duplicate-order-nomatch">─</span>';

    return `
      <div class="duplicate-order-item">
        <div class="duplicate-order-head">
          <span class="duplicate-order-no duplicate-order-blink">${escapeHtml(order.order_no)}</span>
          <span class="duplicate-order-badge">${escapeHtml(matchFields.join('、'))}重複</span>
        </div>
        <div class="duplicate-order-meta">
          <span>${isPickupReminderOnly ? '🏢 ' : ''}${escapeHtml(companyName)}</span>
          <span>${formatDateTime(order.created_at)}</span>
        </div>
        <div class="duplicate-order-meta">
          <span>MAWB: ${mawbLabel}</span>
          <span>HAWB: ${hawbLabel}</span>
          <span>提貨: ${pickupLabel}</span>
        </div>
        <div class="duplicate-order-meta">
          <span>${escapeHtml(order.cargo_desc || '-')}</span>
          <span>${order.quantity || 0}件 / ${order.weight_kg || 0}KG / ${order.cbm || 0}CBM</span>
        </div>
      </div>
    `;
  }).filter(Boolean).join('');

  // 未選客戶時：顯示提醒說明（不同客戶可以使用相同提貨號）
  const reminderHtml = isPickupReminderOnly
    ? `<div class="duplicate-order-reminder">ℹ️ 尚未選擇「需要提貨的客戶」。此提貨號曾在以下公司出現；<strong>不同客戶可以使用相同提貨號</strong>，請確認後繼續。選擇客戶後如屬同一客戶，提交時會再精確檢查。</div>`
    : '';

  openModal({
    title: isPickupReminderOnly ? '🔔 提貨號曾被使用（提醒）' : '⚠️ 發現重複訂單',
    body: `${reminderHtml}<div class="duplicate-order-list">${entries}</div>`,
    className: 'duplicate-order-modal',
    actions: [
      {
        label: isBlurMode ? '🔍 知道了，繼續填寫' : '✅ 仍然繼續',
        className: 'pill btn-primary',
        onClick: (modal) => {
          if (isBlurMode) {
            // blur 模式：只關閉卡片，不觸發提交，用戶可繼續填寫
            modal.close();
            return;
          }
          // submit 模式：關閉卡片並直接提交已收集的資料（onConfirm）
          modal.close();
          if (typeof onConfirm === 'function') {
            onConfirm();
          } else {
            // 沒有 onConfirm（例如 blur check 誤觸 submit）→ 退回重新觸發提交
            duplicateConfirmed = true;
            const submitBtn = document.querySelector('.orders-submit-btn');
            if (submitBtn) submitBtn.click();
          }
        }
      },
      {
        label: '✏️ 返回修改',
        className: 'pill',
        onClick: (modal) => modal.close()
      }
    ]
  });
}

// ===== Tab 切換 =====
function setupOrdersTabs() {
  const tabs = document.querySelectorAll('.orders-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.orders-tab-panel').forEach(panel => panel.classList.remove('active'));
      const target = document.getElementById(`orders-tab-${tab.dataset.tab}`);
      if (target) target.classList.add('active');

      // 切到列表時重新載入
      if (tab.dataset.tab === 'list') {
        fetchOrders();
      } else if (tab.dataset.tab === 'new') {
        renderNewOrderForm();
      }
    });
  });
}

// ===== 新建訂單表單 =====
function companySelectOptions(selectedId) {
  const options = companiesCache
    .filter(c => !isTransportCategory(c.category))
    .map(c => `<option value="${c.id}" ${Number(c.id) === Number(selectedId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  return `<option value="">-- 搜尋/選擇公司 --</option>${options}`;
}

function renderNewOrderForm(prefill = null, preserveCurrentType = false) {
  const container = document.getElementById('orders-new-form');
  if (!container) return;
  if (!prefill) {
    // 新增模式：重置編輯狀態，避免誤將「新增」當作對上一單的「更新」（會覆蓋舊訂單資料）
    editingOrderId = null;
    // 切換訂單類型時（preserveCurrentType=true）保留目前類型，其餘情況重設為收貨
    if (!preserveCurrentType) {
      currentOrderType = 'pickup';
    }
  }
  duplicateConfirmed = false; // 新表單重置重複確認狀態

  // 載入公司資料
  Promise.all([loadCompanies(), loadTransportCompanies()]).then(() => {
    const fields = {};
    if (prefill) {
      // 編輯訂單時帶入既有值
      fields.cargoDesc = prefill.cargo_desc || '';
      fields.quantity = prefill.quantity || '';
      fields.weight = prefill.weight_kg || '';
      fields.cbm = prefill.cbm || '';
      fields.receiverName = prefill.receiver_name || '';
      fields.receiverPhone = prefill.receiver_phone || '';
      fields.notes = prefill.notes || '';
    }

    container.innerHTML = `
      <form id="orders-create-form">
        <div class="orders-form-section">
          <div class="orders-form-section-title">1️⃣ 訂單類型</div>
          <div class="orders-choice-row">
            <button type="button" class="orders-choice-btn ${currentOrderType === 'pickup' ? 'selected' : ''}" data-order-type="pickup">
              📥 收貨 <span class="choice-sub">客戶收貨 → 交回/轉交</span>
            </button>
            <button type="button" class="orders-choice-btn ${currentOrderType === 'delivery' ? 'selected' : ''}" data-order-type="delivery">
              🚚 送貨 <span class="choice-sub">取貨 → 送到客戶</span>
            </button>
          </div>
        </div>

        <div class="orders-form-section">
          <div class="orders-form-section-title">2️⃣ 提單資訊</div>
          <div class="orders-form-grid">
            <div class="orders-form-field">
              <label>MAWB# *</label>
              <input type="text" id="order-mawb" inputmode="numeric" placeholder="如 157-1234 5678" />
              <div class="orders-field-hint" id="mawb-hint">格式：000-0000 0000（如 157-1234 5678）</div>
            </div>
            <div class="orders-form-field">
              <label>HAWB#</label>
              <input type="text" id="order-hawb" placeholder="如 ABC123456789（選填）" maxlength="13" />
              <div class="orders-field-hint" id="hawb-hint">限英文字母或數字（自動轉大楷），最多 13 字（選填）</div>
            </div>
            <div class="orders-form-field">
              <label>DEST（選填）</label>
              <input type="text" id="order-dest" placeholder="如 HKG" maxlength="4" />
              <div class="orders-field-hint" id="dest-hint">只接受 3 個英文字（特例：SVO2）</div>
            </div>
            <div class="orders-form-field full">
              <label>需要提貨的客戶 *</label>
              <div class="company-autocomplete">
                <input type="text" id="order-customer" placeholder="輸入客戶公司名搜尋..." autocomplete="off" />
                <input type="hidden" id="order-customer-id" />
                <div class="company-autocomplete-list"></div>
              </div>
            </div>
            <div class="orders-form-field full">
              <label>客戶提貨號 *</label>
              <input type="text" id="order-pickup-no" required placeholder="客戶提供的提貨/取貨編號" />
              <div class="orders-field-hint" id="pickup-hint"></div>
            </div>
            <div class="orders-form-field">
              <label>📅 提貨日期</label>
              <input type="date" id="order-pickup-date" value="${getTodayDateStr()}" />
            </div>
            <div class="orders-form-field">
              <label>⏰ 提貨時間</label>
              <div class="pickup-time-picker">
                <input type="text" id="order-pickup-time" value="${getNowTimeStr()}" readonly placeholder="--:--" />
                <button type="button" class="pickup-time-clock" id="btn-pickup-time-clock" title="開啟時間選擇器">🕐</button>
                <div class="pickup-time-popup" id="pickup-time-popup"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="orders-form-section">
          <div class="orders-form-section-title" id="order-locations-title">3️⃣ ${currentOrderType === 'delivery' ? '取貨地點 & 送貨目的地' : '收貨地點 & 交回/轉交地點'}</div>
          <div class="orders-form-grid">
            <div class="orders-form-field">
              <label id="order-location-a-label">${currentOrderType === 'delivery' ? '取貨地點（倉庫/公司）*' : '收貨地點（客戶公司）*'}</label>
              <div class="company-autocomplete">
                <input type="text" id="order-location-a" placeholder="輸入公司名搜尋..." autocomplete="off" />
                <input type="hidden" id="order-location-a-id" />
                <div class="company-autocomplete-list"></div>
              </div>
            </div>
            <div class="orders-form-field">
              <label id="order-location-b-label">${currentOrderType === 'delivery' ? '送貨目的地 *' : '交回/轉交地點 *'}</label>
              <div class="company-autocomplete">
                <input type="text" id="order-location-b" placeholder="輸入公司名搜尋..." autocomplete="off" />
                <input type="hidden" id="order-location-b-id" />
                <div class="company-autocomplete-list"></div>
              </div>
            </div>
          </div>
          <div id="order-location-a-detail" class="company-detail-card"></div>
          <div id="order-location-b-detail" class="company-detail-card"></div>
          <div class="orders-autocomplete-hint">🔍 可輸入新公司名並補充資料，提交訂單時會自動加入公司庫，下次輸入即可搜尋到。</div>
        </div>

        <div class="orders-form-section">
          <div class="orders-form-section-title">4️⃣ 貨物資料</div>
          <div class="orders-form-grid">
            <div class="orders-form-field full">
              <label>貨品描述 *</label>
              <input type="text" id="order-cargo-desc" required value="${escapeAttr(fields.cargoDesc)}" placeholder="如 電子零件 / 文件" />
            </div>
            <div class="orders-form-field">
              <label>件數 *</label>
              <input type="number" id="order-quantity" required min="1" step="1" value="${escapeAttr(fields.quantity)}" placeholder="如 3" />
            </div>
            <div class="orders-form-field">
              <label>重量 (KG) *</label>
              <input type="number" id="order-weight" required min="0" step="0.01" value="${escapeAttr(fields.weight)}" placeholder="如 45" />
            </div>
            <div class="orders-form-field">
              <label>CBM（方數）*</label>
              <div class="cbm-input-wrapper">
                <input type="number" id="order-cbm" required min="0" step="0.01" value="${escapeAttr(fields.cbm)}" placeholder="如 0.52" />
                <button type="button" class="cbm-calc-btn" id="btn-open-cbm-calc" title="開啟 CBM 計算機">🧮 計算機</button>
              </div>
            </div>
          </div>
        </div>

        <div class="orders-form-section">
          <div class="orders-form-section-title">5️⃣ ⚡ 帶電種類及件數 *</div>
          <p class="power-hint">點下方按鈕逐項加入（可混合多種電力，每項各自輸入件數）</p>
          <div class="orders-choice-row">
            <button type="button" class="orders-choice-btn power-no" id="power-add-no" data-add-power="no">
              ⚡ 無電 <span class="choice-sub">點擊加入一行</span>
            </button>
            <button type="button" class="orders-choice-btn power-dry" id="power-add-dry" data-add-power="dry">
              🔋 乾電 <span class="choice-sub">A67 / A123 / A199</span>
            </button>
            <button type="button" class="orders-choice-btn power-lithium" id="power-add-lithium" data-add-power="lithium">
              🔋 鋰電 <span class="choice-sub">ELI / ELM</span>
            </button>
          </div>

          <!-- 電力組合編輯區 -->
          <div id="power-items-editor" style="margin-top:14px;">
            <div id="power-items-list"></div>
          </div>
        </div>

        <div class="orders-form-section">
          <div class="orders-form-section-title">6️⃣ 🚨 是否趕機 *</div>
          <div class="orders-choice-row">
            <button type="button" class="orders-choice-btn urgent-yes" data-urgent="yes">🔴 趕機 <span class="choice-sub">需優先處理</span></button>
            <button type="button" class="orders-choice-btn urgent-no selected" data-urgent="no">⚪ 普通 <span class="choice-sub">正常航班</span></button>
          </div>
        </div>

        <div class="orders-form-section">
          <div class="orders-form-section-title">7️⃣ 備註</div>
          <div class="orders-form-grid">
            <div class="orders-form-field full">
              <label>備註（選填）</label>
              <textarea id="order-notes" placeholder="其他特殊指示...">${escapeAttr(fields.notes)}</textarea>
            </div>
            <div class="orders-form-field full">
              <label>備註文字範本</label>
              <div class="note-template-search">
                <input type="text" id="note-template-input" placeholder="輸入關鍵字搜尋備註範本..." autocomplete="off" />
                <div class="note-template-list" id="note-template-list"></div>
              </div>
              <div class="note-template-status" id="note-template-status"></div>
              <div class="note-template-creator">
                <button type="button" class="note-template-creator-toggle" aria-expanded="false">
                  <span>➕ 建立新文字範本</span>
                  <span class="note-template-creator-arrow">▶</span>
                </button>
                <div class="note-template-creator-body">
                  <div class="note-template-creator-grid">
                    <div class="note-template-creator-field">
                      <label>範本名稱</label>
                      <input type="text" id="note-template-new-name" placeholder="例如：貴重物品搬運提醒" autocomplete="off" />
                    </div>
                    <div class="note-template-creator-field full">
                      <label>範本內容</label>
                      <textarea id="note-template-new-content" placeholder="輸入範本文字內容..."></textarea>
                    </div>
                  </div>
                  <button type="button" class="pill note-template-save-btn" id="btn-save-note-template-new">💾 儲存為範本</button>
                </div>
              </div>
            </div>
            <div id="cbm-dim-preview" class="orders-form-field full" style="display:none;"></div>
          </div>
        </div>

        <button type="submit" class="orders-submit-btn">📦 提交訂單</button>
      </form>
    `;

    // 初始化電力組合（編輯時帶入既有項目）
    if (prefill && prefill.power_items && Array.isArray(prefill.power_items) && prefill.power_items.length) {
      powerItemsList = prefill.power_items.map(item => ({ ...item }));
    } else if (prefill && prefill.power_code && prefill.power_type && prefill.power_type !== 'no') {
      // 舊資料只有單一代碼的相容處理
      powerItemsList = [{ type: prefill.power_type, main: '', code: prefill.power_code, qty: '' }];
    } else {
      powerItemsList = [];
    }
    renderPowerItemsList();

    setupNewOrderFormEvents();
  }).catch(err => {
    container.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(err.message)}</div>`;
  });
}

function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '\x26amp;')
    .replace(/"/g, '\x22quot;')
    .replace(/</g, '\x26lt;')
    .replace(/>/g, '\x26gt;');
}

// 驗證 DEST：選填欄位；有值必須為 3 個英文字母（自動轉大楷），唯一特例：SVO2
function validateDest(value) {
  const raw = (value == null ? '' : String(value)).trim().toUpperCase();
  if (!raw) {
    return { valid: true, value: '', error: null };
  }
  if (raw === 'SVO2') {
    return { valid: true, value: raw, error: null };
  }
  if (!/^[A-Z]{3}$/.test(raw)) {
    return { valid: false, value: null, error: 'DEST 只接受 3 個英文字（特例：SVO2）' };
  }
  return { valid: true, value: raw, error: null };
}

// ===== 帶電種類及件數編輯器 =====
// 新增一項電力（無電/乾電/鋰電 均可累積加入）
function addPowerItem(type) {
  if (type === 'no') {
    powerItemsList.push({ type: 'no', main: '', code: '', qty: '' });
  } else if (type === 'dry') {
    powerItemsList.push({ type: 'dry', main: '', code: '', qty: '' });
  } else if (type === 'lithium') {
    powerItemsList.push({ type: 'lithium', main: '', code: '', qty: '' });
  }
  renderPowerItemsList();
}

function renderPowerItemsList() {
  const listEl = document.getElementById('power-items-list');
  if (!listEl) return;

  if (!powerItemsList.length) {
    listEl.innerHTML = '<div class="power-items-empty">尚未加入帶電項目。按「＋ 新增帶電項目」開始。</div>';
    return;
  }

  listEl.innerHTML = powerItemsList.map((item, idx) => {
    const isDry = item.type === 'dry';
    const isLithium = item.type === 'lithium';
    const typeLabel = POWER_TYPE_LABEL[item.type] || item.type;

    return `
      <div class="power-item-row" data-idx="${idx}" data-item-type="${item.type}">
        <span class="power-item-type-label">${typeLabel}</span>
        ${isLithium ? `
          <div class="app-autocomplete power-item-main">
            <input type="text" class="power-item-main-input" data-field="main" placeholder="主類別" value="${escapeAttr(item.main)}" autocomplete="off" />
          </div>
        ` : ''}
        ${(isDry || isLithium) ? `
          <div class="app-autocomplete power-item-code">
            <input type="text" class="power-item-code-input" data-field="code" placeholder="代碼" value="${escapeAttr(item.code)}" autocomplete="off" />
          </div>
        ` : ''}
        <input type="number" class="power-item-qty" data-field="qty" min="1" step="1" placeholder="件數" value="${escapeAttr(item.qty)}" />
        <button type="button" class="power-item-remove" title="移除此行">✕</button>
      </div>
    `;
  }).join('');

  // 綁定事件（主類別/代碼使用通用自動補全）
  listEl.querySelectorAll('.power-item-row').forEach((row, idx) => {
    const rowType = row.dataset.itemType;

    // 主類別自動補全（鋰電）→ ELI/ELM
    const mainInput = row.querySelector('.power-item-main-input');
    if (mainInput) {
      mainInput.addEventListener('input', () => {
        powerItemsList[idx].main = mainInput.value.trim();
      });
      setupAutocomplete({
        input: mainInput,
        suggestions: ['ELI', 'ELM'],
        onSelect: (val) => {
          powerItemsList[idx].main = val;
          // 主類別變更 → 清空代碼，讓候選隨之切換
          const codeInput = row.querySelector('.power-item-code-input');
          if (codeInput) {
            powerItemsList[idx].code = '';
            codeInput.value = '';
            codeInput.focus();
          }
        }
      });
    }

    // 代碼自動補全（乾電固定清單；鋰電依主類別動態切換）
    const codeInput = row.querySelector('.power-item-code-input');
    if (codeInput) {
      codeInput.addEventListener('input', () => {
        powerItemsList[idx].code = codeInput.value.trim();
      });
      setupAutocomplete({
        input: codeInput,
        suggestions: () => {
          if (rowType === 'dry') {
            return ['A67', 'A123', 'A199'];
          }
          // 鋰電：依目前主類別切換候選
          const main = powerItemsList[idx].main || (mainInput ? mainInput.value : '');
          return LITHIUM_MAIN[main] || LITHIUM_MAIN.ELI;
        },
        onSelect: (val) => {
          powerItemsList[idx].code = val;
        }
      });
    }

    // 件數輸入
    const qtyInput = row.querySelector('.power-item-qty');
    if (qtyInput) {
      qtyInput.addEventListener('input', () => {
        powerItemsList[idx].qty = qtyInput.value;
      });
    }

    // 移除行
    const removeBtn = row.querySelector('.power-item-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        powerItemsList.splice(idx, 1);
        renderPowerItemsList();
      });
    }
  });
}

// 將電力組合轉為可讀文字，如「A67 × 5 件 ｜ A199 × 11 件」或「ELI/PI967 × 2 件」
function formatPowerItems(order) {
  if (!order) return '⚡ 無電';
  // 後補電池資訊標記
  if (order.power_type === 'late') return '🔋 後補電池資訊';
  if (order.power_items && order.power_items.length) {
    // 純無電（只有一項且是 no）→ 只顯示「⚡ 無電」
    if (order.power_items.length === 1 && order.power_items[0].type === 'no') {
      return '⚡ 無電';
    }
    return order.power_items.map(item => {
      if (item.type === 'no') return `⚡ 無電 × ${item.qty} 件`;
      const label = item.main ? `${item.main}/${item.code}` : (item.code || '');
      return `${label} × ${item.qty} 件`;
    }).join('｜');
  }
  // 舊資料相容
  if (order.power_type === 'no' || !order.power_type) return '⚡ 無電';
  return `${POWER_TYPE_LABEL[order.power_type] || order.power_type}${order.power_code ? ` (${order.power_code})` : ''}`;
}

// ===== 備註文字範本搜尋 =====
function setupNoteTemplateSearch() {
  const input = document.getElementById('note-template-input');
  if (!input) return;
  const listEl = document.getElementById('note-template-list');
  const statusEl = document.getElementById('note-template-status');

  let searchTimer = null;
  let currentTemplates = [];
  let activeIndex = -1;
  let editingTemplateId = null; // 目前正在修改的範本 id

  // 「➕ 建立新文字範本」卡片：預設收埋，點標題列展開/收回
  const creatorEl = document.querySelector('.note-template-creator');
  const creatorToggle = creatorEl ? creatorEl.querySelector('.note-template-creator-toggle') : null;
  if (creatorToggle) {
    creatorToggle.addEventListener('click', () => {
      const isOpen = creatorEl.classList.toggle('open');
      creatorToggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // 展開「建立新文字範本」卡片（修改範本 / 搜尋無結果時自動展開）
  function expandCreator() {
    if (!creatorEl) return;
    creatorEl.classList.add('open');
    const btn = creatorEl.querySelector('.note-template-creator-toggle');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function closeList() {
    listEl.innerHTML = '';
    listEl.style.display = 'none';
    activeIndex = -1;
    currentTemplates = [];
  }

  // 選中範本 → 內容加入「備註（選填）」textarea 底部
  function selectTemplate(tpl) {
    if (!tpl) return;
    const notesEl = document.getElementById('order-notes');
    const current = notesEl.value.trim();
    const content = tpl.content || '';
    notesEl.value = current ? `${current}\n${content}` : content;
    input.value = tpl.name;
    closeList();
    input.blur();
    // 選中提示
    statusEl.innerHTML = `<div class="note-template-saved">✅ 已將範本「${escapeHtml(tpl.name)}」加入備註。</div>`;
    setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 3000);
  }

  // 進入「修改模式」：將範本名稱/內容載入下方「建立新文字範本」區域，顯示修改工具列
  function enterEditMode(tpl) {
    if (!tpl) return;
    editingTemplateId = tpl.id;
    expandCreator(); // 展開卡片，讓使用者看到已載入的欄位
    const newNameInput = document.getElementById('note-template-new-name');
    const newContentInput = document.getElementById('note-template-new-content');
    if (newNameInput) newNameInput.value = tpl.name || '';
    if (newContentInput) newContentInput.value = tpl.content || '';
    statusEl.innerHTML = `
      <div class="note-template-edit-bar">
        <span class="note-template-edit-label">✏️ 正在修改範本「${escapeHtml(tpl.name)}」（下方欄位已載入，請修改後儲存）</span>
        <span class="note-template-edit-actions">
          <button type="button" class="pill" id="btn-save-edit-template">✅ 儲存修改</button>
          <button type="button" class="pill" id="btn-cancel-edit-template">✖ 取消</button>
        </span>
      </div>
    `;
    closeList();

    // 儲存修改 → 使用下方「建立新文字範本」區域的名稱與內容（同名覆寫）
    const saveBtn = document.getElementById('btn-save-edit-template');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const name = (newNameInput ? newNameInput.value : '').trim();
        const content = (newContentInput ? newContentInput.value : '').trim();
        if (!name || !content) {
          alert('請填寫範本名稱與內容。');
          return;
        }
        try {
          await saveNoteTemplate(name, content);
          statusEl.innerHTML = `<div class="note-template-saved">✅ 範本「${escapeHtml(name)}」已更新。</div>`;
          editingTemplateId = null;
          if (newNameInput) newNameInput.value = '';
          if (newContentInput) newContentInput.value = '';
        } catch (err) {
          statusEl.innerHTML = `<div class="note-template-saved">❌ 儲存失敗：${escapeHtml(err.message)}</div>`;
        }
      });
    }

    // 取消修改 → 清空下方區域
    const cancelBtn = document.getElementById('btn-cancel-edit-template');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        editingTemplateId = null;
        statusEl.innerHTML = '';
        if (newNameInput) newNameInput.value = '';
        if (newContentInput) newContentInput.value = '';
        input.focus();
      });
    }
  }

  // 以指定名稱儲存為範本；若已有同名範本則先確認（避免誤覆蓋）
  async function saveAs(name, content) {
    name = (name || '').trim();
    content = (content || '').trim();
    if (!name) {
      alert('請輸入範本名稱。');
      return false;
    }
    if (!content) {
      alert('請輸入範本內容。');
      return false;
    }
    // 檢查是否存在同名範本（精確比對）
    const existing = (await searchNoteTemplates(name)).find(t => t.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!confirm(`⚠️ 已存在同名範本「${name}」。\n\n確定要以目前的備註內容覆蓋它嗎？`)) {
        return false;
      }
    }
    try {
      await saveNoteTemplate(name, content);
      statusEl.innerHTML = `<div class="note-template-saved">✅ 範本「${escapeHtml(name)}」已儲存。</div>`;
      setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 3000);
      return true;
    } catch (err) {
      statusEl.innerHTML = `<div class="note-template-saved">❌ 儲存失敗：${escapeHtml(err.message)}</div>`;
      return false;
    }
  }

  // 「儲存為範本」按鈕：以下方「建立新文字範本」區域的名稱與內容儲存
  const newNameInput = document.getElementById('note-template-new-name');
  const newContentInput = document.getElementById('note-template-new-content');
  const newSaveBtn = document.getElementById('btn-save-note-template-new');
  if (newSaveBtn && newNameInput && newContentInput) {
    newSaveBtn.addEventListener('click', async () => {
      await saveAs(newNameInput.value, newContentInput.value);
    });
  }

  function highlightItem(items) {
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
    // 確保高亮項目可見（滾動到視野內）
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  async function doSearch(query) {
    const q = (query || '').trim();
    const templates = await searchNoteTemplates(q);
    currentTemplates = templates;
    activeIndex = -1;
    if (!templates.length) {
      listEl.style.display = 'none';
      statusEl.innerHTML = `
        <div class="note-template-empty">「${escapeHtml(q || '')}」沒有找到範本。可用下方「➕ 建立新文字範本」填寫名稱與內容後儲存。</div>
      `;
      expandCreator(); // 無結果時自動展開建立區，方便直接填寫
      return;
    }
    statusEl.innerHTML = '';
    listEl.style.display = 'block';
    listEl.innerHTML = templates.map((t, idx) => `
      <div class="note-template-item" data-index="${idx}">
        <span class="note-template-name">${escapeHtml(t.name)}</span>
        <span class="note-template-sub">${escapeHtml((t.content || '').slice(0, 40))}</span>
        <button type="button" class="note-template-edit-btn" data-edit-index="${idx}" title="修改此範本">📝</button>
      </div>
    `).join('');

    listEl.querySelectorAll('.note-template-item').forEach((el, idx) => {
      // 滑鼠點選項目本體 → 選中
      el.addEventListener('mousedown', (e) => {
        // 若點擊的是「📝 修改」按鈕，不觸發選中
        if (e.target.closest('.note-template-edit-btn')) return;
        e.preventDefault();
        selectTemplate(currentTemplates[idx]);
      });
      // 滑鼠 hover → 同步 activeIndex（與鍵盤高亮視覺一致）
      el.addEventListener('mouseenter', () => {
        activeIndex = idx;
        listEl.querySelectorAll('.note-template-item').forEach(other => other.classList.toggle('active', other === el));
      });
      // 「📝 修改」按鈕 → 進入修改模式
      const editBtn = el.querySelector('.note-template-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          enterEditMode(currentTemplates[idx]);
        });
      }
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(input.value), 300);
    if (!input.value.trim()) {
      closeList();
      statusEl.innerHTML = '';
    }
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) doSearch(input.value);
  });

  input.addEventListener('blur', () => {
    setTimeout(closeList, 150);
  });

  // ===== 鍵盤導航（上下 arrow key 選擇）=====
  input.addEventListener('keydown', (e) => {
    const items = listEl.querySelectorAll('.note-template-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!items.length) return;
      activeIndex = activeIndex >= items.length - 1 ? 0 : activeIndex + 1;
      highlightItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
      highlightItem(items);
    } else if (e.key === 'Enter' && activeIndex >= 0 && currentTemplates[activeIndex]) {
      e.preventDefault();
      selectTemplate(currentTemplates[activeIndex]);
    } else if (e.key === 'Escape') {
      closeList();
    } else if (e.key === 'Tab') {
      // 若目前有高亮項目，先選中；不 preventDefault 讓 Tab 正常跳轉
      if (activeIndex >= 0 && currentTemplates[activeIndex]) {
        selectTemplate(currentTemplates[activeIndex]);
      } else {
        closeList();
      }
    }
  });
}

function getCurrentFormData() {
  const form = document.getElementById('orders-create-form');
  if (!form) return null;

  // 收集電力組合（累積所有行：無電/乾電/鋰電）
  let items = [];
  document.querySelectorAll('.power-item-row').forEach((row) => {
    const rowType = row.dataset.itemType || 'no';
    const mainInput = row.querySelector('.power-item-main-input');
    const codeInput = row.querySelector('.power-item-code-input');
    const qtyInput = row.querySelector('.power-item-qty');
    const main = mainInput ? mainInput.value.trim() : '';
    let code = '';
    if (rowType === 'no') {
      code = '無電';
    } else if (codeInput) {
      code = codeInput.value.trim();
    }
    const qty = qtyInput ? qtyInput.value : '';
    // 「無電」行可不輸入件數（本身代表無電池）；其他類型仍需件數
    if (qty || rowType === 'no') {
      items.push({ type: rowType, main, code, qty });
    }
  });
  // 若 DOM 再渲染過，回退到 powerItemsList
  if (items.length === 0 && powerItemsList.length) {
    items = powerItemsList.filter(item => item.qty);
  }

  // 摘要：以總體的 power_type / power_code 保底
  let powerType = 'no';
  let powerCode = '';
  if (items.length) {
    const dryCount = items.filter(i => i.type === 'dry').length;
    const lithCount = items.filter(i => i.type === 'lithium').length;
    if (lithCount > 0) powerType = 'lithium';
    else if (dryCount > 0) powerType = 'dry';
    const firstCodeItem = items.find(i => i.type !== 'no') || null;
    if (firstCodeItem && firstCodeItem.code) powerCode = firstCodeItem.code;
  }
  // 若純無電，power_type 設為 no（方便顯示）
  if (items.every(i => i.type === 'no')) powerType = 'no';

  const urgent = document.querySelector('.orders-choice-btn[data-urgent].selected')?.dataset.urgent || 'no';

  // 完全沒輸入電池類型 → 標記為後補（power_type='late'），由提交時向用戶確認
  if (items.length === 0) {
    powerType = 'late';
    powerCode = POWER_LATE_LABEL;
  }

  const pickupDate = document.getElementById('order-pickup-date')?.value || '';
  const pickupTime = document.getElementById('order-pickup-time')?.value || '';
  let pickupDatetime = '';
  if (pickupDate) {
    pickupDatetime = pickupTime ? `${pickupDate} ${pickupTime}` : pickupDate;
  }

  const customerCompanyId = document.getElementById('order-customer-id')?.value || '';
  const pickupCompanyId = document.getElementById('order-location-a-id')?.value || '';
  const deliveryCompanyId = document.getElementById('order-location-b-id')?.value || '';

  // 收貨人資料：由「需要提貨的客戶」公司靜默帶入（優先），其次目的地/收貨公司
  let receiverCompany = null;
  if (customerCompanyId) receiverCompany = getCompanyById(customerCompanyId);
  if (!receiverCompany && currentOrderType === 'delivery' && deliveryCompanyId) receiverCompany = getCompanyById(deliveryCompanyId);
  if (!receiverCompany && currentOrderType === 'pickup' && pickupCompanyId) receiverCompany = getCompanyById(pickupCompanyId);

  return {
    order_type: currentOrderType,
    mawb: document.getElementById('order-mawb').value.trim(),
    hawb: document.getElementById('order-hawb').value.trim(),
    dest: document.getElementById('order-dest')?.value.trim() || '',
    pickup_no: document.getElementById('order-pickup-no').value.trim(),
    pickup_datetime: pickupDatetime,
    customer_company_id: customerCompanyId,
    pickup_company_id: pickupCompanyId,
    delivery_company_id: deliveryCompanyId,
    cargo_desc: document.getElementById('order-cargo-desc').value.trim(),
    quantity: document.getElementById('order-quantity').value,
    weight_kg: document.getElementById('order-weight').value,
    cbm: document.getElementById('order-cbm').value,
    cbm_dimensions: currentCbmDimensions.length ? currentCbmDimensions : null,
    power_type: powerType,
    power_code: powerCode,
    power_items: items,
    urgent,
    receiver_name: receiverCompany ? (receiverCompany.contact_person || '') : '',
    receiver_phone: receiverCompany ? (receiverCompany.phone || '') : '',
    address: receiverCompany ? (receiverCompany.address || '') : '',
    receiver_note: '',
    contact_note: '',
    notes: document.getElementById('order-notes').value.trim(),
    transport_company: '',
    status: editingOrderId ? 'pending' : 'pending'
  };
}

function handleCompanySelected() {
  // 收貨人資料在 getCurrentFormData 時從公司帶入，無需操作表單欄位
}

function setupNewOrderFormEvents() {
  // 訂單類型按鈕
  document.querySelectorAll('.orders-choice-btn[data-order-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.orders-choice-btn[data-order-type]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      currentOrderType = btn.dataset.orderType;
      // 重新渲染表單（切換欄位標籤），保留目前的訂單類型（避免被重設回收貨）
      renderNewOrderForm(null, true);
    });
  });

  // 是否趕機按鈕（🔴 趕機 / ⚪ 普通）
  document.querySelectorAll('.orders-choice-btn[data-urgent]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.orders-choice-btn[data-urgent]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // 電力新增按鈕（無電 / 乾電 / 鋰電 → 累積新增一行）
  document.querySelectorAll('.orders-choice-btn[data-add-power]').forEach(btn => {
    btn.addEventListener('click', () => {
      addPowerItem(btn.dataset.addPower);
    });
  });

  // 公司自動補全（客戶 + 地點 A/B）
  ['order-customer', 'order-location-a', 'order-location-b'].forEach(id => {
    const hiddenId = `${id}-id`;
    setupCompanyAutocomplete(id, hiddenId);
    renderCompanyDetailCard(id, hiddenId);
  });

  // CBM 計算機開啟按鈕（傳入 onCommit 收集尺寸）
  const cbmCalcBtn = document.getElementById('btn-open-cbm-calc');
  if (cbmCalcBtn) {
    cbmCalcBtn.addEventListener('click', () => {
      openCbmCalculator({
        targetInput: document.getElementById('order-cbm'),
        onCommit: (dims) => {
          currentCbmDimensions = dims || [];
          renderCbmDimPreview();
        }
      });
    });
  }

  // 自訂提貨時間選擇器（通用工具，傳入元素）
  setupTimePicker({
    input: document.getElementById('order-pickup-time'),
    clockBtn: document.getElementById('btn-pickup-time-clock'),
    popup: document.getElementById('pickup-time-popup')
  });

  // 備註文字範本搜尋
  setupNoteTemplateSearch();

  // MAWB# 輸入即時格式化 + 失焦驗證
  const mawbInput = document.getElementById('order-mawb');
  if (mawbInput) {
    // 輸入時自動格式化成 000-0000 0000（最多 11 位數字）
    mawbInput.addEventListener('input', () => {
      const digits = mawbInput.value.replace(/[^\d]/g, '').slice(0, 11);
      let formatted = digits;
      if (digits.length > 3) formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`;
      if (digits.length > 7) formatted = `${digits.slice(0, 3)}-${digits.slice(3, 7)} ${digits.slice(7)}`;
      mawbInput.value = formatted;
      const hint = document.getElementById('mawb-hint');
      if (hint) hint.style.color = '';
    });

    // 失焦即時驗證
    mawbInput.addEventListener('blur', () => {
      const val = mawbInput.value.trim();
      if (!val || isLateMawb(val)) {
        const hint = document.getElementById('mawb-hint');
        if (hint) {
          hint.style.color = '';
          hint.textContent = '格式：000-0000 0000（如 157-1234 5678）';
        }
        return;
      }
      const result = validateMawb(val);
      const hint = document.getElementById('mawb-hint');
      if (hint) {
        if (result.valid) {
          hint.style.color = '#16a34a';
          hint.textContent = `✅ 有效 MAWB#：${result.formatted}`;
        } else {
          hint.style.color = '#dc2626';
          hint.textContent = `❌ ${result.error}`;
        }
      }
    });
  }

  // HAWB# 輸入即時過濾 + 失焦驗證（邏輯於 utils/hawb-utils.js）
  setupHawbInput({
    input: document.getElementById('order-hawb'),
    hintEl: document.getElementById('hawb-hint')
  });

  // DEST 輸入即時過濾 + 失焦驗證（只接受 3 個英文字，特例：SVO2）
  const destInput = document.getElementById('order-dest');
  if (destInput) {
    // 輸入時：保留英文字母（A-Z）及數字 2（容納特例 SVO2）、自動轉大楷、最多 4 字
    destInput.addEventListener('input', () => {
      const filtered = destInput.value.replace(/[^a-zA-Z2]/g, '').toUpperCase().slice(0, 4);
      if (destInput.value !== filtered) destInput.value = filtered;
      const hint = document.getElementById('dest-hint');
      if (hint) hint.style.color = '';
    });

    // 失焦即時驗證
    destInput.addEventListener('blur', () => {
      const val = destInput.value.trim();
      const hint = document.getElementById('dest-hint');
      if (!hint) return;
      if (!val) {
        hint.style.color = '';
        hint.textContent = '只接受 3 個英文字（特例：SVO2）';
        return;
      }
      const result = validateDest(val);
      if (result.valid) {
        destInput.value = result.value;
        hint.style.color = '#16a34a';
        hint.textContent = `✅ 有效 DEST：${result.value}`;
      } else {
        hint.style.color = '#dc2626';
        hint.textContent = `❌ ${result.error}`;
      }
    });
  }

  // ===== 三個欄位（MAWB / HAWB / 客戶提貨號）blur 即時重複檢查 =====
  // 共用 debounce：快速跳欄位時只發一次請求（變數在全域，submit handler 需 clearTimeout 防止 blur 卡片覆蓋「仍然繼續」卡片）
  duplicateCheckTimer = null;
  // 防重複彈卡：記住上次已確認過的欄位值組合，值沒變就不再次彈卡
  let lastCheckedDuplicateKey = '';

  function getDuplicateCheckKey() {
    return [
      document.getElementById('order-mawb')?.value.trim() || '',
      document.getElementById('order-hawb')?.value.trim() || '',
      document.getElementById('order-pickup-no')?.value.trim() || ''
    ].join('|');
  }

  async function runBlurDuplicateCheck() {
    const currentKey = getDuplicateCheckKey();
    if (!currentKey) return;

    const duplicates = await checkDuplicateOrder();
    // 無重複 → 更新標記（表示這組值已檢查過無問題）
    if (!duplicates || !duplicates.length) {
      lastCheckedDuplicateKey = currentKey;
      return;
    }

    // 有重複 → 若這組值已確認過就不再彈卡
    if (lastCheckedDuplicateKey === currentKey) return;
    lastCheckedDuplicateKey = currentKey;

    // 彈出浮動卡片（blur 模式，按「知道了」只關閉卡片）
    showDuplicateCard(duplicates, 'blur');
  }

  const blurFields = [
    { id: 'order-mawb', hintId: 'mawb-hint' },
    { id: 'order-hawb', hintId: 'hawb-hint' },
    { id: 'order-pickup-no', hintId: 'pickup-hint' }
  ];

  blurFields.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', () => {
      const val = el.value.trim();
      if (!val) return;
      // 共用 debounce：350ms 內多次 blur 只執行一次
      clearTimeout(duplicateCheckTimer);
      duplicateCheckTimer = setTimeout(() => {
        runBlurDuplicateCheck();
      }, 350);
    });
  });

  // 新增公司（第 3️⃣ 區塊）
  const saveCompanyBtn = document.getElementById('btn-save-new-company');
  if (saveCompanyBtn) {
    saveCompanyBtn.addEventListener('click', async () => {
      const name = document.getElementById('new-company-name').value.trim();
      if (!name) {
        alert('請輸入公司名稱');
        return;
      }
      // 收集勾選的類別（checkbox 可多選）→ 逗號分隔多值
      const checkedCategories = Array.from(
        document.querySelectorAll('input[name="new-company-category"]:checked')
      ).map(cb => cb.value);
      const payload = {
        category: checkedCategories,
        name,
        contact_person: document.getElementById('new-company-contact').value.trim(),
        phone: document.getElementById('new-company-phone').value.trim(),
        address: document.getElementById('new-company-address').value.trim(),
        email: document.getElementById('new-company-email').value.trim(),
        notes: document.getElementById('new-company-notes').value.trim()
      };
      try {
        const result = await apiFetch('/api/orders/companies', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        alert('公司已儲存！');
        // 重載公司並重繪表單
        renderNewOrderForm();
      } catch (err) {
        alert(`儲存失敗：${err.message}`);
      }
    });
  }

  // 提交表單
  const form = document.getElementById('orders-create-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // 取消排程中的 blur 重複檢查，防止 350ms 後 blur 卡片覆蓋「仍然繼續」卡片
      clearTimeout(duplicateCheckTimer);
      const data = getCurrentFormData();
      if (!data) return;

      // ===== 電池資訊後補確認（完全沒輸入電池類型時）=====
      if (data.power_type === 'late') {
        if (!confirm(`⚠️ 尚未選擇電池類型（帶電種類及件數）。\n\n電池資訊是否後補？\n\n按「確定」= 以後補電池資訊提交訂單\n按「取消」= 返回填寫電池資料`)) {
          const powerBtn = document.querySelector('[data-add-power="no"]');
          if (powerBtn) powerBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
      }

      // ===== 自動儲存新公司（收貨/交回地點手動輸入的新名字）=====
      // 若地點輸入框有值但 hidden id 為空 → 表示是新公司名，先建立到公司庫
      const locationAInput = document.getElementById('order-location-a');
      const locationBInput = document.getElementById('order-location-b');
      const locationAId = document.getElementById('order-location-a-id');
      const locationBId = document.getElementById('order-location-b-id');

      // 「需要提貨的客戶」新公司也要自動儲存（含詳細資料）
      const customerInput = document.getElementById('order-customer');
      const customerId = document.getElementById('order-customer-id');

      const pendingNewCompanies = [];
      if (customerInput && customerInput.value.trim() && (!customerId || !customerId.value)) {
        pendingNewCompanies.push({ input: customerInput, hidden: customerId, category: 'customer' });
      }
      if (locationAInput && locationAInput.value.trim() && (!locationAId || !locationAId.value)) {
        pendingNewCompanies.push({ input: locationAInput, hidden: locationAId, category: currentOrderType === 'delivery' ? 'warehouse' : 'customer' });
      }
      if (locationBInput && locationBInput.value.trim() && (!locationBId || !locationBId.value)) {
        pendingNewCompanies.push({ input: locationBInput, hidden: locationBId, category: currentOrderType === 'delivery' ? 'customer' : 'warehouse' });
      }

      if (pendingNewCompanies.length) {
        try {
          // 逐個建立（避免重名同時建立；新公司在詳細卡填的地址/聯絡人/電話等一併儲存）
          for (const item of pendingNewCompanies) {
            const name = item.input.value.trim();
            // 先檢查是否已存在（可能剛被其他欄位使用）
            const existing = companiesCache.find(c => c.name.toLowerCase() === name.toLowerCase() && !isTransportCategory(c.category));
            let companyId;
            if (existing) {
              companyId = existing.id;
            } else {
              // 從詳細資料卡收集用戶填寫的資料（欄位 id = `${inputId}-detail-*`）
              const detail = getCompanyDetailData(item.input.id);
              const result = await apiFetch('/api/orders/companies', {
                method: 'POST',
                body: JSON.stringify({
                  category: item.category,
                  name,
                  address: detail.address || '',
                  contact_person: detail.contact_person || '',
                  phone: detail.phone || '',
                  email: detail.email || '',
                  notes: detail.notes || ''
                })
              });
              companyId = result.id;
            }
            if (item.hidden) item.hidden.value = companyId;
          }
          // 更新 data 的 company id（客戶 + 地點 A/B）
          data.customer_company_id = document.getElementById('order-customer-id').value || '';
          data.pickup_company_id = document.getElementById('order-location-a-id').value || '';
          data.delivery_company_id = document.getElementById('order-location-b-id').value || '';
        } catch (err) {
          alert(`儲存新公司失敗：${err.message}`);
          return;
        }
      }

      // ===== 更新既有公司變更（用戶在詳細卡修改了既有公司的資料）=====
      try {
        const companyFieldsToCheck = [
          { inputId: 'order-customer', hiddenId: 'order-customer-id' },
          { inputId: 'order-location-a', hiddenId: 'order-location-a-id' },
          { inputId: 'order-location-b', hiddenId: 'order-location-b-id' }
        ];
        for (const { inputId, hiddenId } of companyFieldsToCheck) {
          const hiddenEl = document.getElementById(hiddenId);
          if (!hiddenEl || !hiddenEl.value) continue; // 只處理已選中的既有公司
          const changes = detectCompanyChanges(inputId, hiddenId);
          if (!changes.length) continue;
          const companyId = hiddenEl.value;
          const current = getCompanyDetailData(inputId);
          const inputEl = document.getElementById(inputId);
          const nameVal = inputEl ? inputEl.value.trim() : '';
          const existingCompany = getCompanyById(companyId);
          await apiFetch(`/api/orders/companies/${companyId}`, {
            method: 'PUT',
            body: JSON.stringify({
              category: current.category || (existingCompany ? existingCompany.category : 'customer'),
              name: nameVal,
              address: current.address || '',
              contact_person: current.contact_person || '',
              phone: current.phone || '',
              email: current.email || '',
              notes: current.notes || ''
            })
          });
        }
      } catch (err) {
        alert(`更新公司資料失敗：${err.message}`);
        return;
      }

      // MAWB# 驗證
      const mawbValue = document.getElementById('order-mawb').value.trim();
      if (!mawbValue) {
        // 沒填 MAWB# → 確認是否後補
        if (!confirm('⚠️ 沒有 MAWB#？\n\n確定以「後補MAWB#」提交訂單嗎？\n\n按「確定」= 後補 MAWB#（可稍後編輯補上）\n按「取消」= 返回輸入 MAWB#')) {
          document.getElementById('order-mawb').focus();
          return;
        }
        data.mawb = MAWB_LATE_LABEL;
      } else {
        const mawbResult = validateMawb(mawbValue);
        if (!mawbResult.valid) {
          alert(`❌ ${mawbResult.error}`);
          document.getElementById('order-mawb').focus();
          return;
        }
        // 統一儲存為標準格式 000-0000 0000
        data.mawb = mawbResult.formatted;
      }

      // HAWB# 驗證：只允許英數字、最多 13 字（輸入時已自動過濾轉大楷；此處攔截編輯舊資料中的符號）
      const hawbValue = document.getElementById('order-hawb').value.trim();
      if (hawbValue) {
        const hawbResult = validateHawb(hawbValue);
        if (!hawbResult.valid) {
          alert(`❌ ${hawbResult.error}`);
          document.getElementById('order-hawb').focus();
          return;
        }
      }

      // DEST 驗證：選填；有值必須為 3 個英文字（特例：SVO2）
      const destValue = document.getElementById('order-dest').value.trim();
      if (destValue) {
        const destResult = validateDest(destValue);
        if (!destResult.valid) {
          alert(`❌ ${destResult.error}`);
          document.getElementById('order-dest').focus();
          return;
        }
        data.dest = destResult.value;
      }

      // 定義提交函數（「仍然繼續」時直接呼叫，避免重跑整個 handler 與重複彈 MAWB 確認）
      const performSubmit = async () => {
        try {
          const url = editingOrderId ? `/api/orders/${editingOrderId}` : '/api/orders';
          const method = editingOrderId ? 'PUT' : 'POST';
          const result = await apiFetch(url, { method, body: JSON.stringify(data) });
          showOrderSuccess(result.order_no || `ORD-${Date.now()}`, result.id);
        } catch (err) {
          alert(`提交失敗：${err.message}`);
        }
      };

      // 重複檢查（已確認繼續則跳過）
      if (!duplicateConfirmed) {
        const duplicates = await checkDuplicateOrder();
        if (duplicates && duplicates.length) {
          // 彈出重複卡；按「仍然繼續」直接提交已收集的 data（onConfirm）
          showDuplicateCard(duplicates, 'submit', performSubmit);
          return;
        }
      }
      duplicateConfirmed = false; // 重置，確保下次提交再次檢查
      await performSubmit();
    });
  }
}

// ===== 成功頁面 =====
function showOrderSuccess(orderNo, orderId) {
  const container = document.getElementById('orders-new-form');
  if (!container) return;

  container.innerHTML = `
    <div class="orders-success">
      <div style="font-size:3rem;">✅</div>
      <h3>訂單已建立！</h3>
      <div class="orders-success-no">${escapeHtml(orderNo)}</div>
      <div class="orders-success-actions">
        <button type="button" class="pill btn-primary" id="btn-order-email-summary">📧 電郵總結發送</button>
        <button type="button" class="pill" id="btn-order-copy-summary">📋 複製總結內容</button>
        <button type="button" class="pill" id="btn-order-new-another">＋ 再建一單</button>
      </div>
      <div id="orders-summary-output"></div>
    </div>
  `;

  document.getElementById('btn-order-new-another').addEventListener('click', () => {
    editingOrderId = null;
    currentOrderType = 'pickup';
    renderNewOrderForm();
  });

  // 載入訂單資料生成總結
  apiFetch(`/api/orders/${orderId}`).then(result => {
    const order = result.data;
    const summary = buildOrderSummary(order);
    const output = document.getElementById('orders-summary-output');
    if (output) {
      // 顯示 HTML 表格（不轉義，讓 <table> 正常渲染）
      output.innerHTML = `<div class="orders-summary-html">${summary}</div>`;
    }

    document.getElementById('btn-order-email-summary').addEventListener('click', () => {
      sendOrderEmail(order, summary);
    });
    document.getElementById('btn-order-copy-summary').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(summary);
        alert('總結內容已複製！可使用 WhatsApp 等發送。');
      } catch (err) {
        const textarea = document.createElement('textarea');
        textarea.value = summary;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        alert('總結內容已複製！可使用 WhatsApp 等發送。');
      }
    });
  }).catch(() => {
    const output = document.getElementById('orders-summary-output');
    if (output) output.innerHTML = '<div class="empty-state">無法載入訂單總結。</div>';
  });
}

// ===== 電郵總結（HTML 表格格式，供 Outlook 等郵件程式顯示） =====
function escHtml(str) {
  return String(str == null || str === '' ? '-' : str)
    .replace(/&/g, '\x26amp;')
    .replace(/</g, '\x26lt;')
    .replace(/>/g, '\x26gt;');
}

function buildCompanyDetailHtml(title, companyName, address, contact, phone, email) {
  const hasName = !!companyName;
  if (!hasName) return '';
  return `
    <tr><td colspan="2" style="background:#f0f4ff;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">${title}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;width:110px;">名稱</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(companyName)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">地址</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(address)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">聯絡人</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(contact)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">電話</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(phone)}</td></tr>
    ${email ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">電郵</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(email)}</td></tr>` : ''}
  `;
}

function buildOrderSummary(order) {
  const typeLabel = ORDER_TYPE_LABEL[order.order_type] || order.order_type;
  const powLabel = formatPowerItems(order);
  const urgentLabel = order.urgent === 'yes' ? '🔴 是 - 需優先處理' : '⚪ 否 - 普通';

  const pickupTitle = order.order_type === 'delivery' ? '📍 取貨公司（FULL DETAILS）' : '📍 收貨公司（FULL DETAILS）';
  const deliveryTitle = order.order_type === 'delivery' ? '📍 送貨目的地（FULL DETAILS）' : '📍 交回/轉交目的地（FULL DETAILS）';

  // 收貨公司與目的地 FULL DETAILS
  const pickupDetail = buildCompanyDetailHtml(
    pickupTitle,
    order.pickup_company_name,
    order.pickup_company_address,
    order.pickup_company_contact,
    order.pickup_company_phone,
    order.pickup_company_email
  );
  const deliveryDetail = buildCompanyDetailHtml(
    deliveryTitle,
    order.delivery_company_name,
    order.delivery_company_address,
    order.delivery_company_contact,
    order.delivery_company_phone,
    order.delivery_company_email
  );

  // 收貨人（receiver）資料備份顯示
  const receiverDetail = (order.receiver_name || order.receiver_phone || order.address) ? `
    <tr><td colspan="2" style="background:#f0f4ff;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">📋 收貨人資料</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;width:110px;">收貨人</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.receiver_name)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">電話</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.receiver_phone)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">地址</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.address)}</td></tr>
    ${order.receiver_note ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">收貨人備註</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.receiver_note)}</td></tr>` : ''}
    ${order.contact_note ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">聯絡人備註</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.contact_note)}</td></tr>` : ''}
  ` : '';

  // DIM(cm) 表格化
  const dimHtml = (order.cbm_dimensions && order.cbm_dimensions.length) ? `
    <tr><td colspan="2" style="background:#f0f4ff;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">📐 DIM(cm)</td></tr>
    ${order.cbm_dimensions.map(d => `
      <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">尺寸</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(`${d.len} x ${d.width} x ${d.height}`)} / ${escHtml(d.qty)} 件</td></tr>
    `).join('')}
  ` : '';

  return `
    <div style="font-family:Arial,sans-serif;">
      <h3 style="margin:0 0 12px;">📦 訂單總結 ${escHtml(order.order_no)}</h3>
      <table style="border-collapse:collapse;font-size:14px;max-width:640px;">
        <tr><td colspan="2" style="background:#e8eefc;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">🧾 提單資訊</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;width:110px;">類型</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(typeLabel)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">MAWB#</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(displayMawb(order.mawb))}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">HAWB#</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.hawb)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">DEST</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.dest)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">提貨號</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.pickup_no)}</td></tr>
        ${order.pickup_datetime ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">提貨時間</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(formatPickupDatetime(order.pickup_datetime))}</td></tr>` : ''}
        ${order.customer_company_name ? `
        <tr><td colspan="2" style="background:#f0f4ff;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">🏢 需要收貨的客戶</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">客戶公司</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.customer_company_name)}</td></tr>` : ''}
        ${pickupDetail}
        ${deliveryDetail}
        ${receiverDetail}
        <tr><td colspan="2" style="background:#e8eefc;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">📦 貨物資料</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">貨品</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.cargo_desc)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">件數</td><td style="padding:6px 10px;border:1px solid #ccc;">${order.quantity || 0} 件</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">重量</td><td style="padding:6px 10px;border:1px solid #ccc;">${order.weight_kg || 0} KG</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">CBM</td><td style="padding:6px 10px;border:1px solid #ccc;">${order.cbm || 0} cbm</td></tr>
        ${dimHtml}
        <tr><td colspan="2" style="background:#e8eefc;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">⚡ 其他資訊</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">⚡ 電力</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(powLabel)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">🚨 趕機</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(urgentLabel)}</td></tr>
        ${order.notes ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">備註</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.notes)}</td></tr>` : ''}
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">狀態</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(STATUS_LABEL[order.status] || order.status)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">建立日期</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(formatDateTime(order.created_at))}</td></tr>
      </table>
    </div>
  `;
}

// 開啟「選擇郵件應用程式」Modal（用戶可選 Outlook Classic 或系統預設郵件）
async function sendOrderEmail(order, summary) {
  // 嘗試從公司資料找運輸公司 email
  const transportCompany = transportCompanies.find(c => c.name === order.transport_company);
  const mailTo = transportCompany && transportCompany.email ? transportCompany.email : '';

  // ===== SUBJECT 新格式： [AGL - 收貨ORDER (URGENT)] 客戶 / A > B / MAWB# / 件數 | 重量 | CBM
  const subjectType = order.order_type === 'delivery' ? '送貨ORDER' : '收貨ORDER';
  const urgentPart = order.urgent === 'yes' ? ' (URGENT)' : '';
  const subjectCustomer = order.customer_company_name || '-';
  const subjectRoute = `${order.pickup_company_name || '-'} > ${order.delivery_company_name || '-'}`;
  const subjectMawb = displayMawb(order.mawb);
  const subjectCargo = `${order.quantity || 0}件 | ${order.weight_kg || 0} KG | ${order.cbm || 0} cbm`;
  const subject = encodeURIComponent(`[AGL - ${subjectType}${urgentPart}] ${subjectCustomer} / ${subjectRoute} / ${subjectMawb} / ${subjectCargo}`);
  const body = encodeURIComponent(summary);
  const mailtoLink = `mailto:${mailTo}?subject=${subject}&body=${body}`;

  // 查詢系統可用的郵件應用程式
  let apps = [];
  try {
    const result = await apiFetch('/api/orders/email-apps');
    apps = result.data || [];
  } catch (err) {
    console.warn('查詢郵件應用程式失敗：', err.message);
  }
  if (!apps.length) {
    // 查不到 → 直接使用預設 mailto
    window.location.href = mailtoLink;
    return;
  }

  // 彈出選擇 Modal
  openModal({
    title: '📧 選擇郵件應用程式',
    body: `
      <p style="margin:0 0 12px; font-size:0.9rem; color:var(--text-muted);">請選擇要開啟哪一個郵件應用程式發送總結：</p>
      <div class="email-app-picker">
        ${apps.map(app => `
          <button type="button" class="email-app-btn" data-client="${escapeAttr(app.id)}" data-label="${escapeAttr(app.label)}">
            ${app.id === 'outlook-classic'
              ? '<svg class="email-app-icon" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="48" height="48" rx="8" fill="#0078D4"/><path d="M8 15a3 3 0 0 1 3-3h26a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V15z" fill="white"/><path d="M8 16.5 24 27l16-10.5" stroke="#0078D4" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 38l8-8M37 38l-8-8" stroke="#0078D4" stroke-width="3" fill="none" stroke-linecap="round"/></svg>'
              : '<span class="email-app-icon-default">📨</span>'}
            ${escapeHtml(app.label)}
          </button>
        `).join('')}
      </div>
    `,
    actions: [
      {
        label: '✖ 取消',
        className: 'pill',
        onClick: (modal) => modal.close()
      }
    ]
  });

  // 綁定應用程式按鈕事件
  document.querySelectorAll('.email-app-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const client = btn.dataset.client;
      const originalLabel = btn.textContent;

      if (client === 'outlook-classic') {
        // 顯示執行中狀態（防止重複點擊）
        btn.disabled = true;
        btn.textContent = '⏳ 正在開啟 Outlook Classic...';
        console.log('[sendOrderEmail] 正在啟動 Outlook Classic，mailto:', mailtoLink.slice(0, 80) + '...');
        try {
          const result = await apiFetch('/api/orders/open-email-client', {
            method: 'POST',
            body: JSON.stringify({ client, mailtoUrl: mailtoLink })
          });
          console.log('[sendOrderEmail] Outlook Classic 啟動成功：', result);
          alert('✅ Outlook Classic 已啟動（新郵件視窗應已彈出）');
        } catch (err) {
          console.error('[sendOrderEmail] Outlook Classic 啟動失敗：', err);
          alert(`❌ 開啟 Outlook Classic 失敗：${err.message}`);
          btn.disabled = false;
          btn.textContent = originalLabel;
          return; // 失敗時不關閉 Modal，讓用戶可以改選其他選項
        }
      } else if (client === 'default') {
        // 系統預設郵件 → 瀏覽器 mailto 協議
        console.log('[sendOrderEmail] 使用系統預設郵件');
        window.location.href = mailtoLink;
      }
      // 關閉 Modal
      const modalRoot = document.querySelector('.modal-overlay');
      if (modalRoot) modalRoot.remove();
      document.body.classList.remove('modal-open');
    });
  });
}

// ===== 訂單列表 =====
async function fetchOrders() {
  const container = document.getElementById('orders-list-container');
  if (!container) return;

  const search = document.getElementById('orders-search-input')?.value.trim() || '';
  const status = document.getElementById('orders-status-filter')?.value || '';
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  const query = params.toString() ? `?${params.toString()}` : '';

  try {
    const result = await apiFetch(`/api/orders${query}`);
    ordersData = result.data || [];

    let visible = ordersData;
    // 「今天的收貨」過濾：訂單類型 = 收貨 且 提貨日期 = 今天
    if (todayPickupActive) {
      const today = getTodayDateStr(); // 'YYYY-MM-DD'
      visible = ordersData.filter(o => {
        if (o.order_type !== 'pickup') return false;
        if (!o.pickup_datetime) return false;
        return String(o.pickup_datetime).slice(0, 10) === today;
      });
    }
    // 日期搜尋過濾：依提貨日期 pickup_datetime 篩選
    if (dateFilterValue) {
      visible = visible.filter(o => {
        if (!o.pickup_datetime) return false;
        return String(o.pickup_datetime).slice(0, 10) === dateFilterValue;
      });
    }
    renderOrdersList(visible);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(err.message)}</div>`;
  }
}

function renderOrdersList(orders) {
  const container = document.getElementById('orders-list-container');
  if (!container) return;

  if (!orders.length) {
    container.innerHTML = '<div class="empty-state">沒有找到訂單。切換到「＋ 新建訂單」建立第一張訂單吧！</div>';
    return;
  }

  container.innerHTML = orders.map(order => {
    // 第一行：類型 + 起點 到 終點
    const fromName = order.pickup_company_name || order.pickup_company_id || '-';
    const toName = order.delivery_company_name || order.delivery_company_id || '';
    const typeLabel = ORDER_TYPE_LABEL[order.order_type] || order.order_type;
    const titleLine = toName
      ? `${typeLabel} ${escapeHtml(fromName)} 到 ${escapeHtml(toName)}`
      : `${typeLabel} ${escapeHtml(fromName)}`;
    const powerLabel = order.power_type === 'no'
      ? '<span class="orders-tag power-no">⚡ 無電</span>'
      : `<span class="orders-tag ${order.power_type === 'dry' ? 'power-dry' : 'power-lithium'}">${escapeHtml(formatPowerItems(order))}</span>`;
    const urgentTag = order.urgent === 'yes' ? '<span class="orders-tag urgent">🚨 趕機</span>' : '';

    return `
      <div class="orders-card-item" data-id="${order.id}">
        <div class="orders-card-header">
          <div class="orders-card-title">${titleLine}</div>
          <span class="order-status-badge ${escapeHtml(order.status)}" title="點擊收起卡片">${STATUS_LABEL[order.status] || order.status}</span>
        </div>
        <div class="orders-card-meta">
          <span>📅 ${formatDateTime(order.created_at)}</span>
        </div>
        <div class="orders-card-meta">
          <span>🏢 需要提貨的客戶：${escapeHtml(order.customer_company_name || '-')}</span>
        </div>
        <div class="orders-card-meta">
          <span>🧾 MAWB: ${escapeHtml(displayMawb(order.mawb))}</span>
          <span>| HAWB: ${escapeHtml(order.hawb || '-')}</span>
          <span>| DEST: ${escapeHtml(order.dest || '-')}</span>
          <span>| 提貨: ${escapeHtml(order.pickup_no || '-')}</span>
        </div>
        <div class="orders-card-meta">
          <span>📦 ${order.quantity || 0} 件 / ${order.weight_kg || 0} KG / ${order.cbm || 0} CBM</span>
        </div>
        <div class="orders-card-meta">
          ${powerLabel}
          ${urgentTag}
        </div>
        <div class="orders-card-footer">
          <span class="orders-card-order-no">流水號：${escapeHtml(order.order_no)}</span>
        </div>
        <div class="orders-card-detail" id="order-detail-${order.id}"></div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.orders-card-item').forEach(card => {
    card.addEventListener('click', (e) => {
      // 點擊互動元素（SELECT/BUTTON/INPUT 等）→ 不切換展開/收合，避免誤觸收合
      const tag = e.target.tagName;
      if (['SELECT', 'BUTTON', 'INPUT', 'TEXTAREA', 'A', 'LABEL'].includes(tag)) return;
      const id = card.dataset.id;
      const isOpen = card.classList.contains('open');
      // 關閉其他
      container.querySelectorAll('.orders-card-item.open').forEach(c => {
        if (c !== card) c.classList.remove('open');
      });
      if (!isOpen) {
        card.classList.add('open');
        renderOrderDetail(id);
      } else {
        card.classList.remove('open');
      }
    });

    // 點擊「狀態」徽章 → 自動收起整個 Record
    const badge = card.querySelector('.order-status-badge');
    if (badge) {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        card.classList.remove('open');
      });
    }
  });
}

async function renderOrderDetail(id) {
  const detailContainer = document.getElementById(`order-detail-${id}`);
  if (!detailContainer) return;
  detailContainer.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const result = await apiFetch(`/api/orders/${id}`);
    const order = result.data;
    detailContainer.innerHTML = buildOrderDetailHtml(order);
    setupOrderDetailActions(order);
  } catch (err) {
    detailContainer.innerHTML = `<div class="empty-state">無法載入詳情：${escapeHtml(err.message)}</div>`;
  }
}

function buildOrderDetailHtml(order) {
  const powLabel = formatPowerItems(order);

  return `
    <div class="orders-detail-grid">
      <div class="orders-detail-field">
        <span class="detail-label">訂單編號</span>
        <span class="detail-value">${escapeHtml(order.order_no)}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">狀態更新</span>
        <span class="detail-value">${formatDateTime(order.updated_at)}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">MAWB#</span>
        <span class="detail-value">${escapeHtml(displayMawb(order.mawb))}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">HAWB#</span>
        <span class="detail-value">${escapeHtml(order.hawb || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">DEST</span>
        <span class="detail-value">${escapeHtml(order.dest || '-')}</span>
      </div>
      <div class="orders-detail-field full">
        <span class="detail-label">客戶提貨號</span>
        <span class="detail-value">${escapeHtml(order.pickup_no || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">📅 提貨日期時間</span>
        <span class="detail-value">${escapeHtml(formatPickupDatetime(order.pickup_datetime) || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">${order.order_type === 'delivery' ? '取貨地點' : '收貨地點'}</span>
        <span class="detail-value">${escapeHtml(order.pickup_company_name || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">${order.order_type === 'delivery' ? '送貨目的地' : '交回/轉交地點'}</span>
        <span class="detail-value">${escapeHtml(order.delivery_company_name || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">貨品</span>
        <span class="detail-value">${escapeHtml(order.cargo_desc || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">件數 / 重量 / CBM</span>
        <span class="detail-value">${order.quantity || 0} 件 / ${order.weight_kg || 0} KG / ${order.cbm || 0} CBM</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">⚡ 電力</span>
        <span class="detail-value">${escapeHtml(powLabel)}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">🚨 趕機</span>
        <span class="detail-value">${order.urgent === 'yes' ? '🔴 是' : '⚪ 否'}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">收貨人</span>
        <span class="detail-value">${escapeHtml(order.receiver_name || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">電話</span>
        <span class="detail-value">${escapeHtml(order.receiver_phone || '-')}</span>
      </div>
      ${order.receiver_note ? `
      <div class="orders-detail-field full">
        <span class="detail-label">收貨人備註</span>
        <span class="detail-value">${escapeHtml(order.receiver_note)}</span>
      </div>` : ''}
      ${order.contact_note ? `
      <div class="orders-detail-field full">
        <span class="detail-label">聯絡人備註</span>
        <span class="detail-value">${escapeHtml(order.contact_note)}</span>
      </div>` : ''}
      <div class="orders-detail-field full">
        <span class="detail-label">地址</span>
        <span class="detail-value">${escapeHtml(order.address || '-')}</span>
      </div>
      <div class="orders-detail-field full orders-detail-status">
        <span class="detail-label">狀態</span>
        <span class="detail-value">
          <select class="order-status-select ${escapeHtml(order.status)}" data-order-id="${order.id}">
            <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>⏳ 待處理</option>
            <option value="in_progress" ${order.status === 'in_progress' ? 'selected' : ''}>🔄 進行中</option>
            <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>✅ 已完成</option>
            <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>⛔ 已取消</option>
          </select>
        </span>
      </div>
      ${order.notes ? `
      <div class="orders-detail-field full">
        <span class="detail-label">備註</span>
        <span class="detail-value">${escapeHtml(order.notes)}</span>
      </div>` : ''}
    </div>
    <div class="orders-card-actions">
      <button type="button" class="pill" data-action="edit" data-id="${order.id}">✏️ 編輯</button>
      <button type="button" class="pill" data-action="duplicate" data-id="${order.id}">📄 複製此訂單</button>
      <button type="button" class="pill btn-primary" data-action="email" data-id="${order.id}">📧 電郵總結</button>
      <button type="button" class="pill" data-action="copy" data-id="${order.id}">📋 複製總結</button>
      <button type="button" class="pill" data-action="delete" data-id="${order.id}">🗑️ 刪除</button>
    </div>
  `;
}

function setupOrderDetailActions(order) {
  // 狀態變更
  const statusSelect = document.querySelector(`.order-status-select[data-order-id="${order.id}"]`);
  if (statusSelect) {
    // 防止點擊/展開狀態選單時冒泡到卡片 handler 造成瞬間收合
    statusSelect.addEventListener('click', (e) => e.stopPropagation());
    statusSelect.addEventListener('change', async () => {
      try {
        await apiFetch(`/api/orders/${order.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...order, status: statusSelect.value })
        });
        // 更新成功 → 自動收起整張卡片（先從 DOM 移除 open，再重新載入列表）
        const card = document.querySelector(`.orders-card-item[data-id="${order.id}"]`);
        if (card) card.classList.remove('open');
        fetchOrders();
      } catch (err) {
        alert(`更新失敗：${err.message}`);
        statusSelect.value = order.status;
      }
    });
  }

  // 按鈕動作
  document.querySelectorAll(`.orders-card-actions [data-id="${order.id}"]`).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'email') {
        sendOrderEmail(order, buildOrderSummary(order));
      } else if (action === 'copy') {
        navigator.clipboard.writeText(buildOrderSummary(order)).then(() => {
          alert('總結內容已複製！');
        }).catch(() => alert('複製失敗'));
      } else if (action === 'edit') {
        loadOrderToForm(order);
      } else if (action === 'duplicate') {
        duplicateOrder(order);
      } else if (action === 'delete') {
        deleteOrder(order);
      }
    });
  });
}

function loadOrderToForm(order) {
  editingOrderId = order.id;
  currentOrderType = order.order_type;
  // 切到新建 Tab
  document.querySelectorAll('.orders-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.orders-tab[data-tab="new"]').classList.add('active');
  document.querySelectorAll('.orders-tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('orders-tab-new').classList.add('active');

  const container = document.getElementById('orders-new-form');
  container.innerHTML = '<div class="loading-spinner"></div>';

  Promise.all([loadCompanies(), loadTransportCompanies()]).then(() => {
    renderNewOrderForm({
      cargo_desc: order.cargo_desc,
      quantity: order.quantity,
      weight_kg: order.weight_kg,
      cbm: order.cbm,
      cbm_dimensions: order.cbm_dimensions || null,
      power_type: order.power_type,
      power_code: order.power_code,
      power_items: order.power_items || null,
      notes: order.notes,
      customer_company_id: order.customer_company_id,
      pickup_company_id: order.pickup_company_id,
      delivery_company_id: order.delivery_company_id
    });

    // 稍後填上其餘欄位
    setTimeout(() => {
      // 後補MAWB# → 輸入框留空（提交時再確認）
      document.getElementById('order-mawb').value = (order.mawb && !isLateMawb(order.mawb)) ? formatMawb(order.mawb) : '';
      document.getElementById('order-hawb').value = String(order.hawb || '').toUpperCase();
      document.getElementById('order-dest').value = String(order.dest || '').toUpperCase();
      document.getElementById('order-pickup-no').value = order.pickup_no || '';
      document.getElementById('order-mawb').dispatchEvent(new Event('change'));

      // 提貨日期/時間
      let pickupDate = '';
      let pickupTime = '';
      if (order.pickup_datetime) {
        const parts = String(order.pickup_datetime).split(' ');
        if (parts[0]) pickupDate = parts[0];
        if (parts[1]) pickupTime = parts[1];
      }
      const pickupDateEl = document.getElementById('order-pickup-date');
      if (pickupDateEl) pickupDateEl.value = pickupDate || getTodayDateStr();
      const pickupTimeEl = document.getElementById('order-pickup-time');
      if (pickupTimeEl) pickupTimeEl.value = pickupTime || '';

      // 公司欄位（客戶 + 地點 A/B：input 顯示名稱 + hidden id）
      const companyFields = [
        { inputId: 'order-customer', hiddenId: 'order-customer-id', companyId: order.customer_company_id },
        { inputId: 'order-location-a', hiddenId: 'order-location-a-id', companyId: order.pickup_company_id },
        { inputId: 'order-location-b', hiddenId: 'order-location-b-id', companyId: order.delivery_company_id }
      ];
      companyFields.forEach(({ inputId, hiddenId, companyId }) => {
        const inputEl = document.getElementById(inputId);
        const hiddenEl = document.getElementById(hiddenId);
        if (!inputEl || !hiddenEl) return;
        const company = companyId ? getCompanyById(companyId) : null;
        if (company) {
          inputEl.value = company.name;
          hiddenEl.value = company.id;
          captureCompanySnapshot(hiddenId);
          renderCompanyDetailCard(inputId, hiddenId);
        }
      });

      document.getElementById('order-notes').value = order.notes || '';

      // CBM DIM 預覽
      if (order.cbm_dimensions && order.cbm_dimensions.length) {
        currentCbmDimensions = order.cbm_dimensions;
        renderCbmDimPreview();
      }

      // 趕機
      document.querySelectorAll('.orders-choice-btn[data-urgent]').forEach(b => {
        b.classList.toggle('selected', b.dataset.urgent === order.urgent);
      });

      // 按鈕文字改為更新
      const submitBtn = document.querySelector('.orders-submit-btn');
      if (submitBtn) {
        submitBtn.textContent = '💾 更新訂單';
        submitBtn.style.background = 'linear-gradient(135deg, #2563eb, #3b82f6)';
      }

      // 表單提交改為 update
      const form = document.getElementById('orders-create-form');
      if (form) {
        form.onsubmit = async (e) => {
          e.preventDefault();
          // 取消排程中的 blur 重複檢查，防止 350ms 後 blur 卡片覆蓋「仍然繼續」卡片
          clearTimeout(duplicateCheckTimer);
          const data = getCurrentFormData();
          if (!data) return;

          // MAWB# 驗證
          const mawbValue = document.getElementById('order-mawb').value.trim();
          if (!mawbValue) {
            if (!confirm('⚠️ 沒有 MAWB#？\n\n確定以「後補MAWB#」提交訂單嗎？\n\n按「確定」= 後補 MAWB#（可稍後編輯補上）\n按「取消」= 返回輸入 MAWB#')) {
              document.getElementById('order-mawb').focus();
              return;
            }
            data.mawb = MAWB_LATE_LABEL;
          } else {
            const mawbResult = validateMawb(mawbValue);
            if (!mawbResult.valid) {
              alert(`❌ ${mawbResult.error}`);
              document.getElementById('order-mawb').focus();
              return;
            }
            data.mawb = mawbResult.formatted;
          }

          // DEST 驗證：選填；有值必須為 3 個英文字（特例：SVO2）
          const destValue = document.getElementById('order-dest')?.value.trim() || '';
          if (destValue) {
            const destResult = validateDest(destValue);
            if (!destResult.valid) {
              alert(`❌ ${destResult.error}`);
              document.getElementById('order-dest').focus();
              return;
            }
            data.dest = destResult.value;
          }

          // 定義提交函數（「仍然繼續」時直接呼叫，避免重跑整個 handler 與重複彈 MAWB 確認）
          const performSubmit = async () => {
            try {
              await apiFetch(`/api/orders/${order.id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
              });
              alert('訂單已更新！');
              editingOrderId = null;
              // 切回列表
              document.querySelectorAll('.orders-tab').forEach(t => t.classList.remove('active'));
              document.querySelector('.orders-tab[data-tab="list"]').classList.add('active');
              document.querySelectorAll('.orders-tab-panel').forEach(p => p.classList.remove('active'));
              document.getElementById('orders-tab-list').classList.add('active');
              fetchOrders();
            } catch (err) {
              alert(`更新失敗：${err.message}`);
            }
          };

          // 重複檢查（已確認繼續則跳過）
          if (!duplicateConfirmed) {
            const duplicates = await checkDuplicateOrder();
            if (duplicates && duplicates.length) {
              // 彈出重複卡；按「仍然繼續」直接提交已收集的 data（onConfirm）
              showDuplicateCard(duplicates, 'submit', performSubmit);
              return;
            }
          }
          duplicateConfirmed = false; // 重置，確保下次提交再次檢查
          await performSubmit();
        };
      }
    }, 50);
  });
}

async function duplicateOrder(order) {
  // 複製現有訂單（新訂單編號）
  const { id, order_no, created_at, updated_at, ...rest } = order;
  const payload = { ...rest, status: 'pending' };
  try {
    const result = await apiFetch('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    alert(`已複製訂單！新訂單編號：${result.order_no}`);
    fetchOrders();
  } catch (err) {
    alert(`複製失敗：${err.message}`);
  }
}

async function deleteOrder(order) {
  if (!confirm(`確定刪除訂單 ${order.order_no}？`)) return;
  try {
    await apiFetch(`/api/orders/${order.id}`, { method: 'DELETE' });
    alert('訂單已刪除');
    fetchOrders();
  } catch (err) {
    alert(`刪除失敗：${err.message}`);
  }
}

// ===== 訂單列表搜尋（防抖） =====
function setupOrdersSearch() {
  const searchInput = document.getElementById('orders-search-input');
  const statusFilter = document.getElementById('orders-status-filter');
  const refreshBtn = document.getElementById('btn-orders-refresh');
  const todayPickupBtn = document.getElementById('btn-orders-today-pickup');
  const dateFilterInput = document.getElementById('orders-date-filter-input');
  const dateClearBtn = document.getElementById('btn-orders-date-clear');

  if (searchInput) {
    searchInput.addEventListener('input', debounce(fetchOrders, 350));
  }
  if (statusFilter) {
    statusFilter.addEventListener('change', fetchOrders);
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', fetchOrders);
  }
  // 日期搜尋：依提貨日期篩選
  if (dateFilterInput) {
    dateFilterInput.addEventListener('change', () => {
      dateFilterValue = dateFilterInput.value || '';
      if (dateClearBtn) dateClearBtn.style.display = dateFilterValue ? 'flex' : 'none';
      // 與「今天的收貨」互斥：手動選日期時關閉今天的收貨
      if (dateFilterValue && todayPickupActive) {
        todayPickupActive = false;
        if (todayPickupBtn) {
          todayPickupBtn.classList.remove('active');
          todayPickupBtn.textContent = '📥 今天的收貨';
        }
      }
      fetchOrders();
    });
  }
  // 清除日期
  if (dateClearBtn) {
    dateClearBtn.addEventListener('click', () => {
      dateFilterValue = '';
      if (dateFilterInput) dateFilterInput.value = '';
      dateClearBtn.style.display = 'none';
      fetchOrders();
    });
  }
  // 「今天的收貨」切換按鈕
  if (todayPickupBtn) {
    todayPickupBtn.addEventListener('click', () => {
      todayPickupActive = !todayPickupActive;
      todayPickupBtn.classList.toggle('active', todayPickupActive);
      todayPickupBtn.textContent = todayPickupActive ? '📥 今天的收貨 ✓' : '📥 今天的收貨';
      // 與日期搜尋互斥：啟用今天的收貨時清除日期
      if (todayPickupActive && dateFilterValue) {
        dateFilterValue = '';
        if (dateFilterInput) dateFilterInput.value = '';
        if (dateClearBtn) dateClearBtn.style.display = 'none';
      }
      fetchOrders();
    });
  }
}

// ===== 訂單系統初始化 =====
function setupOrdersSection() {
  setupOrdersTabs();
  setupOrdersSearch();
  renderNewOrderForm();
}