// ===== 訂單系統前端邏輯 =====
let ordersData = [];
let companiesCache = [];
let transportCompanies = [];
let templatesData = [];
let currentOrderType = 'delivery';
let editingOrderId = null;

const ORDER_TYPE_LABEL = { delivery: '🚚 送貨', pickup: '📥 收貨' };
const STATUS_LABEL = { pending: '待處理', in_progress: '進行中', completed: '已完成', cancelled: '已取消' };
const POWER_TYPE_LABEL = { no: '⚡ 無電', dry: '🔋 乾電', lithium: '🔋 鋰電' };
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

// ===== 共用函數 =====
async function apiFetch(url, options = {}) {
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

async function loadTemplates() {
  const result = await apiFetch('/api/orders/templates');
  templatesData = result.data || [];
  return templatesData;
}

function getCompanyById(id) {
  const numId = Number(id);
  if (!numId) return null;
  return companiesCache.find(c => Number(c.id) === numId) || null;
}

function formatDateTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  return date.toLocaleString('zh-HK', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
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

      // 切到列表或範本時重新載入
      if (tab.dataset.tab === 'list') {
        fetchOrders();
      } else if (tab.dataset.tab === 'templates') {
        renderTemplates();
      } else if (tab.dataset.tab === 'new') {
        renderNewOrderForm();
      }
    });
  });
}

// ===== 新建訂單表單 =====
function companySelectOptions(selectedId) {
  const options = companiesCache
    .filter(c => c.category !== 'transport')
    .map(c => `<option value="${c.id}" ${Number(c.id) === Number(selectedId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  return `<option value="">-- 搜尋/選擇公司 --</option>${options}`;
}

function transportSelectOptions(selectedId) {
  const options = transportCompanies.map(c => `<option value="${escapeHtml(c.name)}" ${c.name === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  return `<option value="">-- 選擇運輸公司 --</option>${options}`;
}

function renderNewOrderForm(applyTemplate = null) {
  const container = document.getElementById('orders-new-form');
  if (!container) return;

  // 載入公司資料
  Promise.all([loadCompanies(), loadTransportCompanies()]).then(() => {
    const t = applyTemplate || {};
    const fields = {};

    if (applyTemplate) {
      // 套用範本後帶入值
      fields.cargoDesc = applyTemplate.cargo_desc || '';
      fields.quantity = applyTemplate.quantity || '';
      fields.weight = applyTemplate.weight_kg || '';
      fields.cbm = applyTemplate.cbm || '';
      fields.powerType = applyTemplate.power_type || 'no';
      fields.receiverName = applyTemplate.receiver_name || '';
      fields.receiverPhone = applyTemplate.receiver_phone || '';
      fields.notes = applyTemplate.notes || '';
    }

    container.innerHTML = `
      <form id="orders-create-form">
        <div class="orders-form-section">
          <div class="orders-form-section-title">1️⃣ 訂單類型</div>
          <div class="orders-choice-row">
            <button type="button" class="orders-choice-btn ${currentOrderType === 'delivery' ? 'selected' : ''}" data-order-type="delivery">
              🚚 送貨 <span class="choice-sub">取貨 → 送到客戶</span>
            </button>
            <button type="button" class="orders-choice-btn ${currentOrderType === 'pickup' ? 'selected' : ''}" data-order-type="pickup">
              📥 收貨 <span class="choice-sub">客戶收貨 → 交回/轉交</span>
            </button>
          </div>
        </div>

        <div class="orders-form-section">
          <div class="orders-form-section-title">2️⃣ 提單資訊</div>
          <div class="orders-form-grid">
            <div class="orders-form-field">
              <label>MAWB# *</label>
              <input type="text" id="order-mawb" required placeholder="如 157-12345678" />
            </div>
            <div class="orders-form-field">
              <label>HAWB# *</label>
              <input type="text" id="order-hawb" required placeholder="如 HKG-987654" />
            </div>
            <div class="orders-form-field full">
              <label>客戶提貨號 *</label>
              <input type="text" id="order-pickup-no" required placeholder="客戶提供的提貨/取貨編號" />
            </div>
          </div>
        </div>

        <div class="orders-form-section">
          <div class="orders-form-section-title" id="order-locations-title">3️⃣ ${currentOrderType === 'delivery' ? '取貨地點 & 送貨目的地' : '收貨地點 & 交回/轉交地點'}</div>
          <div class="orders-form-grid">
            <div class="orders-form-field">
              <label id="order-location-a-label">${currentOrderType === 'delivery' ? '取貨地點（倉庫/公司）*' : '收貨地點（客戶公司）*'}</label>
              <select id="order-location-a">${companySelectOptions()}</select>
            </div>
            <div class="orders-form-field">
              <label id="order-location-b-label">${currentOrderType === 'delivery' ? '送貨目的地 *' : '交回/轉交地點 *'}</label>
              <select id="order-location-b">${companySelectOptions()}</select>
            </div>
          </div>
          <details class="orders-company-add">
            <summary>＋ 新增公司 / 地點（落單時順手儲存）</summary>
            <div class="orders-form-grid" style="margin-top:10px;">
              <div class="orders-form-field">
                <label>公司名稱 *</label>
                <input type="text" id="new-company-name" />
              </div>
              <div class="orders-form-field">
                <label>聯絡人</label>
                <input type="text" id="new-company-contact" />
              </div>
              <div class="orders-form-field">
                <label>電話</label>
                <input type="text" id="new-company-phone" />
              </div>
              <div class="orders-form-field">
                <label>地址</label>
                <input type="text" id="new-company-address" />
              </div>
              <div class="orders-form-field">
                <label>電郵（運輸公司用）</label>
                <input type="email" id="new-company-email" placeholder="transport@company.com" />
              </div>
              <div class="orders-form-field">
                <label>類別</label>
                <select id="new-company-category">
                  <option value="customer">客戶公司</option>
                  <option value="warehouse">倉庫/自家地點</option>
                  <option value="transport">運輸公司</option>
                </select>
              </div>
            </div>
            <button type="button" class="pill btn-primary" id="btn-save-new-company" style="margin-top:10px;">＋ 儲存公司</button>
          </details>
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
              <input type="number" id="order-cbm" required min="0" step="0.01" value="${escapeAttr(fields.cbm)}" placeholder="如 0.52" />
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
          <div class="orders-form-section-title">7️⃣ 收貨人 / 聯絡人</div>
          <div class="orders-form-grid">
            <div class="orders-form-field">
              <label>收貨人 *</label>
              <input type="text" id="order-receiver-name" required value="${escapeAttr(fields.receiverName)}" />
            </div>
            <div class="orders-form-field">
              <label>聯絡電話 *</label>
              <input type="text" id="order-receiver-phone" required value="${escapeAttr(fields.receiverPhone)}" />
            </div>
            <div class="orders-form-field full">
              <label>地址 *</label>
              <textarea id="order-address" required></textarea>
            </div>
          </div>
          <div class="orders-recipient" id="recipient-auto-hint" style="display:none;">選公司後自動帶出聯絡人資料。</div>
        </div>

        <div class="orders-form-section">
          <div class="orders-form-section-title">8️⃣ 運輸公司 & 備註</div>
          <div class="orders-form-grid">
            <div class="orders-form-field">
              <label>運輸公司</label>
              <select id="order-transport-company">${transportSelectOptions()}</select>
            </div>
            <div class="orders-form-field full">
              <label>備註（選填）</label>
              <textarea id="order-notes" placeholder="其他特殊指示...">${escapeAttr(fields.notes)}</textarea>
            </div>
          </div>
        </div>

        <button type="submit" class="orders-submit-btn">📦 提交訂單</button>
      </form>
    `;

    // 初始化電力組合（累積載入既有項目或範本）
    if (applyTemplate && applyTemplate.power_items && Array.isArray(applyTemplate.power_items) && applyTemplate.power_items.length) {
      powerItemsList = applyTemplate.power_items.map(item => ({ ...item }));
    } else {
      powerItemsList = [];
      // 舊範本只有單一代碼的相容處理
      if (applyTemplate && applyTemplate.power_code && applyTemplate.power_type && applyTemplate.power_type !== 'no') {
        powerItemsList = [{ type: applyTemplate.power_type, main: '', code: applyTemplate.power_code, qty: '' }];
      }
    }
    renderPowerItemsList();

    // 嘗試帶出公司（範本）
    if (applyTemplate && applyTemplate.company_id) {
      if (currentOrderType === 'delivery') {
        document.getElementById('order-location-b').value = applyTemplate.company_id;
      } else {
        document.getElementById('order-location-a').value = applyTemplate.company_id;
      }
      handleCompanySelected();
    }

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
    // 鋰電主下拉（ELI/ELM）
    const mainOptions = ['ELI', 'ELM'].map(m =>
      `<option value="${m}" ${item.main === m ? 'selected' : ''}>${m}</option>`
    ).join('');
    // 乾電代碼
    const dryCodes = ['A67', 'A123', 'A199', 'custom', 'custom2'];
    const dryOptions = ['A67', 'A123', 'A199'].map(c =>
      `<option value="${c}" ${item.code === c ? 'selected' : ''}>${c}</option>`
    ).join('');
    // 鋰電子代碼（依主選項）— 由 JS 動態填，這裡先放預設
    const subCodes = LITHIUM_MAIN[item.main] || ['PI965', 'PI966', 'PI967'];

    const typeLabel = POWER_TYPE_LABEL[item.type] || item.type;

    return `
      <div class="power-item-row" data-idx="${idx}" data-item-type="${item.type}">
        <span class="power-item-type-label">${typeLabel}</span>
        ${isLithium ? `
          <select class="power-item-main" data-field="main">
            <option value="">-- 主類別 --</option>
            ${mainOptions}
          </select>
        ` : ''}
        ${isDry ? `
          <select class="power-item-code" data-field="code">
            <option value="">-- 代碼 --</option>
            ${dryOptions}
            <option value="custom" ${item.code === 'custom' ? 'selected' : ''}>其他（自訂）...</option>
          </select>
        ` : isLithium ? `
          <select class="power-item-code" data-field="code">
            <option value="">-- 代碼 --</option>
            ${subCodes.map(c => `<option value="${c}" ${item.code === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        ` : ''}
        <input type="number" class="power-item-qty" data-field="qty" min="1" step="1" placeholder="件數" value="${escapeAttr(item.qty)}" />
        <button type="button" class="power-item-remove" title="移除此行">✕</button>
      </div>
    `;
  }).join('');

  // 綁定事件
  listEl.querySelectorAll('.power-item-row').forEach((row, idx) => {
    // 主類別變化（鋰電）→ 更新子代碼選項
    const mainSelect = row.querySelector('.power-item-main');
    if (mainSelect) {
      mainSelect.addEventListener('change', () => {
        powerItemsList[idx].main = mainSelect.value;
        // 重繪該行以更新子代碼
        const codeSelect = row.querySelector('.power-item-code');
        if (codeSelect) {
          const subs = LITHIUM_MAIN[mainSelect.value] || [];
          codeSelect.innerHTML = '<option value="">-- 代碼 --</option>' +
            subs.map(c => `<option value="${c}">${c}</option>`).join('') +
            '<option value="custom">其他（自訂）...</option>';
          powerItemsList[idx].code = '';
        }
      });
    }

    // 代碼選擇（含「其他」自訂）
    const codeSelect = row.querySelector('.power-item-code');
    if (codeSelect) {
      // 處理已有自訂值
      if (itemHasCustomCode(powerItemsList[idx])) {
        const customVal = powerItemsList[idx].customVal || powerItemsList[idx].code;
        codeSelect.insertAdjacentHTML('beforeend', `<option value="customval" selected>${escapeHtml('自訂: ' + customVal)}</option>`);
      }
      codeSelect.addEventListener('change', () => {
        const val = codeSelect.value;
        if (val === 'custom') {
          // 開啟自訂輸入
          showCustomCodeInput(row, idx, '');
        } else if (val === 'customval') {
          showCustomCodeInput(row, idx, powerItemsList[idx].customVal || '');
        } else {
          powerItemsList[idx].code = val;
          powerItemsList[idx].customVal = '';
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

function itemHasCustomCode(item) {
  return item.customVal && item.customVal !== '';
}

function showCustomCodeInput(row, idx, defaultVal) {
  // 移除舊的 custom input（若有）
  const oldCustom = row.querySelector('.power-item-custom-input');
  if (oldCustom) oldCustom.remove();

  const qtyInput = row.querySelector('.power-item-qty');
  const wrapper = document.createElement('div');
  wrapper.className = 'power-item-custom-input';
  wrapper.innerHTML = '<input type="text" placeholder="輸入自訂代碼（如 A999）" />';
  const input = wrapper.querySelector('input');
  input.value = defaultVal;

  const codeSelect = row.querySelector('.power-item-code');
  if (codeSelect) codeSelect.insertAdjacentElement('afterend', wrapper);

  input.addEventListener('input', () => {
    const val = input.value.trim();
    powerItemsList[idx].customVal = val;
    powerItemsList[idx].code = val;
  });
  input.focus();
}

// 將電力組合轉為可讀文字，如「A67 × 5 件、A199 × 11 件」或「ELI/PI967 × 2 件」
function formatPowerItems(order) {
  if (!order) return '⚡ 無電';
  if (order.power_items && order.power_items.length) {
    // 純無電（只有一項且是 no）→ 只顯示「⚡ 無電」
    if (order.power_items.length === 1 && order.power_items[0].type === 'no') {
      return '⚡ 無電';
    }
    return order.power_items.map(item => {
      if (item.type === 'no') return `⚡ 無電 × ${item.qty} 件`;
      const label = item.main ? `${item.main}/${item.code}` : (item.code || '');
      return `${label} × ${item.qty} 件`;
    }).join('、');
  }
  // 舊資料相容
  if (order.power_type === 'no' || !order.power_type) return '⚡ 無電';
  return `${POWER_TYPE_LABEL[order.power_type] || order.power_type}${order.power_code ? ` (${order.power_code})` : ''}`;
}

function getCurrentFormData() {
  const form = document.getElementById('orders-create-form');
  if (!form) return null;

  // 收集電力組合（累積所有行：無電/乾電/鋰電）
  let items = [];
  document.querySelectorAll('.power-item-row').forEach((row) => {
    const rowType = row.dataset.itemType || 'no';
    const mainSel = row.querySelector('.power-item-main');
    const codeSel = row.querySelector('.power-item-code');
    const qtyInput = row.querySelector('.power-item-qty');
    const customInput = row.querySelector('.power-item-custom-input input');
    const main = mainSel ? mainSel.value : '';
    let code = '';
    if (rowType === 'no') {
      code = '無電';
    } else if (customInput) {
      code = customInput.value.trim();
    } else if (codeSel) {
      code = codeSel.value;
    }
    const qty = qtyInput ? qtyInput.value : '';
    if (qty) {
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

  // 驗證：至少需要一筆有效項目
  if (items.length === 0) {
    alert('請在「帶電種類及件數」加入至少一筆項目並輸入件數。（如全部無電，點「⚡ 無電」加入並輸入件數）');
    return null;
  }

  return {
    order_type: currentOrderType,
    mawb: document.getElementById('order-mawb').value.trim(),
    hawb: document.getElementById('order-hawb').value.trim(),
    pickup_no: document.getElementById('order-pickup-no').value.trim(),
    pickup_company_id: currentOrderType === 'delivery'
      ? document.getElementById('order-location-a').value
      : document.getElementById('order-location-a').value,
    delivery_company_id: currentOrderType === 'delivery'
      ? document.getElementById('order-location-b').value
      : document.getElementById('order-location-b').value,
    cargo_desc: document.getElementById('order-cargo-desc').value.trim(),
    quantity: document.getElementById('order-quantity').value,
    weight_kg: document.getElementById('order-weight').value,
    cbm: document.getElementById('order-cbm').value,
    power_type: powerType,
    power_code: powerCode,
    power_items: items,
    urgent,
    receiver_name: document.getElementById('order-receiver-name').value.trim(),
    receiver_phone: document.getElementById('order-receiver-phone').value.trim(),
    address: document.getElementById('order-address').value.trim(),
    notes: document.getElementById('order-notes').value.trim(),
    transport_company: document.getElementById('order-transport-company').value,
    status: editingOrderId ? 'pending' : 'pending'
  };
}

function handleCompanySelected() {
  const locationA = document.getElementById('order-location-a');
  const locationB = document.getElementById('order-location-b');
  const receiverName = document.getElementById('order-receiver-name');
  const receiverPhone = document.getElementById('order-receiver-phone');
  const address = document.getElementById('order-address');
  const hint = document.getElementById('recipient-auto-hint');

  // 送貨：目的地 = 收貨人公司；收貨：收貨地點 = 客戶公司
  const selectedCompanyId = currentOrderType === 'delivery'
    ? (locationB ? locationB.value : '')
    : (locationA ? locationA.value : '');
  const company = getCompanyById(selectedCompanyId);

  if (company) {
    if (!receiverName.value.trim()) receiverName.value = company.contact_person || '';
    if (!receiverPhone.value.trim()) receiverPhone.value = company.phone || '';
    if (!address.value.trim()) address.value = company.address || '';
    if (hint) hint.style.display = 'none';
  } else if (hint) {
    hint.style.display = 'block';
  }
}

function setupNewOrderFormEvents() {
  // 訂單類型按鈕
  document.querySelectorAll('.orders-choice-btn[data-order-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.orders-choice-btn[data-order-type]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      currentOrderType = btn.dataset.orderType;
      // 重新渲染表單（切換欄位標籤）
      renderNewOrderForm();
    });
  });

  // 電力新增按鈕（無電 / 乾電 / 鋰電 → 累積新增一行）
  document.querySelectorAll('.orders-choice-btn[data-add-power]').forEach(btn => {
    btn.addEventListener('click', () => {
      addPowerItem(btn.dataset.addPower);
    });
  });

  // 公司選擇 → 自動帶出
  ['order-location-a', 'order-location-b'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', handleCompanySelected);
    }
  });

  // 新增公司
  const saveCompanyBtn = document.getElementById('btn-save-new-company');
  if (saveCompanyBtn) {
    saveCompanyBtn.addEventListener('click', async () => {
      const name = document.getElementById('new-company-name').value.trim();
      if (!name) {
        alert('請輸入公司名稱');
        return;
      }
      const payload = {
        category: document.getElementById('new-company-category').value,
        name,
        contact_person: document.getElementById('new-company-contact').value.trim(),
        phone: document.getElementById('new-company-phone').value.trim(),
        address: document.getElementById('new-company-address').value.trim(),
        email: document.getElementById('new-company-email').value.trim()
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
      const data = getCurrentFormData();
      if (!data) return;

      try {
        const url = editingOrderId ? `/api/orders/${editingOrderId}` : '/api/orders';
        const method = editingOrderId ? 'PUT' : 'POST';
        const result = await apiFetch(url, { method, body: JSON.stringify(data) });
        showOrderSuccess(result.order_no || `ORD-${Date.now()}`, result.id);
      } catch (err) {
        alert(`提交失敗：${err.message}`);
      }
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
    currentOrderType = 'delivery';
    renderNewOrderForm();
  });

  // 載入訂單資料生成總結
  apiFetch(`/api/orders/${orderId}`).then(result => {
    const order = result.data;
    const summary = buildOrderSummary(order);
    const output = document.getElementById('orders-summary-output');
    if (output) {
      output.innerHTML = `<div class="orders-summary-text">${escapeHtml(summary)}</div>`;
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

// ===== 電郵總結 =====
function buildOrderSummary(order) {
  const line = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const typeLabel = ORDER_TYPE_LABEL[order.order_type] || order.order_type;
  const powLabel = formatPowerItems(order);
  const urgentLabel = order.urgent === 'yes' ? '🔴 是 - 需優先處理' : '⚪ 否 - 普通';

  let lines = [];
  lines.push(line);
  lines.push(`📦 訂單總結 ${order.order_no}`);
  lines.push(line);
  lines.push(`類型    ：${typeLabel}`);
  lines.push(`MAWB#   ：${order.mawb || '-'}`);
  lines.push(`HAWB#   ：${order.hawb || '-'}`);
  lines.push(`提貨號  ：${order.pickup_no || '-'}`);
  lines.push(line);
  lines.push(`收貨公司：${order.delivery_company_name || order.pickup_company_name || '-'}`);
  lines.push(`地址    ：${order.address || '-'}`);
  lines.push(`聯絡人  ：${order.receiver_name || '-'}`);
  lines.push(`電話    ：${order.receiver_phone || '-'}`);
  lines.push(line);
  lines.push(`貨品    ：${order.cargo_desc || '-'}`);
  lines.push(`件數    ：${order.quantity || '0'} 件`);
  lines.push(`重量    ：${order.weight_kg || '0'} KG`);
  lines.push(`CBM     ：${order.cbm || '0'}`);
  lines.push(`⚡ 電力  ：${powLabel}`);
  lines.push(`🚨 趕機  ：${urgentLabel}`);
  if (order.notes) lines.push(`備註    ：${order.notes}`);
  lines.push(line);
  lines.push(`運輸公司：${order.transport_company || '-'}`);
  lines.push(`狀態    ：${STATUS_LABEL[order.status] || order.status}`);
  lines.push(`建立日期：${formatDateTime(order.created_at)}`);
  lines.push(line);
  return lines.join('\n');
}

function sendOrderEmail(order, summary) {
  // 嘗試從公司資料找運輸公司 email
  const transportCompany = transportCompanies.find(c => c.name === order.transport_company);
  const mailTo = transportCompany && transportCompany.email ? transportCompany.email : '';

  const subject = encodeURIComponent(`📦 訂單總結 ${order.order_no} - ${ORDER_TYPE_LABEL[order.order_type]} - ${order.delivery_company_name || order.pickup_company_name || ''}`);
  const body = encodeURIComponent(summary);

  const mailtoLink = `mailto:${mailTo}?subject=${subject}&body=${body}`;
  window.location.href = mailtoLink;
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
    renderOrdersList(ordersData);
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
    const companyName = order.order_type === 'delivery'
      ? (order.delivery_company_name || order.pickup_company_name || '-')
      : (order.pickup_company_name || order.delivery_company_name || '-');
    const powerLabel = order.power_type === 'no'
      ? '<span class="orders-tag power-no">⚡ 無電</span>'
      : `<span class="orders-tag ${order.power_type === 'dry' ? 'power-dry' : 'power-lithium'}">${escapeHtml(formatPowerItems(order))}</span>`;
    const urgentTag = order.urgent === 'yes' ? '<span class="orders-tag urgent">🚨 趕機</span>' : '';

    return `
      <div class="orders-card-item" data-id="${order.id}">
        <div class="orders-card-header">
          <div class="orders-card-title">${ORDER_TYPE_LABEL[order.order_type] || order.order_type} ${escapeHtml(companyName)}</div>
          <span class="order-status-badge ${escapeHtml(order.status)}">${STATUS_LABEL[order.status] || order.status}</span>
        </div>
        <div class="orders-card-meta">
          <span>${escapeHtml(order.order_no)}</span>
          <span>📅 ${formatDateTime(order.created_at)}</span>
        </div>
        <div class="orders-card-meta">
          <span>MAWB: ${escapeHtml(order.mawb || '-')}</span>
          <span>HAWB: ${escapeHtml(order.hawb || '-')}</span>
          <span>提貨: ${escapeHtml(order.pickup_no || '-')}</span>
        </div>
        <div class="orders-card-meta">
          ${powerLabel}
          ${urgentTag}
        </div>
        <div class="orders-card-detail" id="order-detail-${order.id}"></div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.orders-card-item').forEach(card => {
    card.addEventListener('click', async () => {
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
        <span class="detail-value">${escapeHtml(order.mawb || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">HAWB#</span>
        <span class="detail-value">${escapeHtml(order.hawb || '-')}</span>
      </div>
      <div class="orders-detail-field full">
        <span class="detail-label">客戶提貨號</span>
        <span class="detail-value">${escapeHtml(order.pickup_no || '-')}</span>
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
      <div class="orders-detail-field full">
        <span class="detail-label">地址</span>
        <span class="detail-value">${escapeHtml(order.address || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">運輸公司</span>
        <span class="detail-value">${escapeHtml(order.transport_company || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">狀態</span>
        <span class="detail-value">
          <select class="order-status-select" data-order-id="${order.id}">
            <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>待處理</option>
            <option value="in_progress" ${order.status === 'in_progress' ? 'selected' : ''}>進行中</option>
            <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>已完成</option>
            <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>已取消</option>
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
    statusSelect.addEventListener('change', async () => {
      try {
        await apiFetch(`/api/orders/${order.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...order, status: statusSelect.value })
        });
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
    const apply = {
      cargo_desc: order.cargo_desc,
      quantity: order.quantity,
      weight_kg: order.weight_kg,
      cbm: order.cbm,
      power_type: order.power_type,
      power_code: order.power_code,
      power_items: order.power_items || null,
      receiver_name: order.receiver_name,
      receiver_phone: order.receiver_phone,
      notes: order.notes
    };
    renderNewOrderForm(apply);

    // 稍後填上其餘欄位
    setTimeout(() => {
      document.getElementById('order-mawb').value = order.mawb || '';
      document.getElementById('order-hawb').value = order.hawb || '';
      document.getElementById('order-pickup-no').value = order.pickup_no || '';
      document.getElementById('order-mawb').dispatchEvent(new Event('change'));
      document.getElementById('order-location-a').value = order.pickup_company_id || '';
      document.getElementById('order-location-b').value = order.delivery_company_id || '';
      document.getElementById('order-address').value = order.address || '';
      document.getElementById('order-transport-company').value = order.transport_company || '';
      document.getElementById('order-notes').value = order.notes || '';
      document.getElementById('order-receiver-name').value = order.receiver_name || '';
      document.getElementById('order-receiver-phone').value = order.receiver_phone || '';

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
          const data = getCurrentFormData();
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

// ===== 範本管理 =====
async function renderTemplates() {
  const container = document.getElementById('orders-templates-container');
  if (!container) return;

  try {
    const promises = [loadTemplates(), loadCompanies()];
    await Promise.all(promises);

    // 按公司分組
    const byCompany = {};
    templatesData.forEach(t => {
      const key = t.company_id || 'uncategorized';
      if (!byCompany[key]) {
        byCompany[key] = {
          companyId: key,
          companyName: t.company_name || '未分類',
          templates: []
        };
      }
      byCompany[key].templates.push(t);
    });

    const companyOptionsForModal = companiesCache
      .filter(c => c.category !== 'transport')
      .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join('');

    const groupsHtml = Object.values(byCompany).length ? Object.values(byCompany).map(group => `
      <div class="orders-template-group">
        <h4>🏢 ${escapeHtml(group.companyName)} <span style="font-weight:400; color:var(--text-muted); font-size:0.85rem;">(${group.templates.length})</span></h4>
        ${group.templates.map(t => `
          <div class="orders-template-item">
            <div class="template-info">
              <div class="template-name">⭐ ${escapeHtml(t.name)}</div>
              <div class="template-desc">
                ${escapeHtml(t.cargo_desc || '')}
                ${t.quantity ? ` · ${t.quantity} 件` : ''}
                ${t.weight_kg ? ` · ${t.weight_kg} KG` : ''}
                ${t.cbm ? ` · ${t.cbm} CBM` : ''}
                ${t.power_type && t.power_type !== 'no' ? ` · ⚡ ${POWER_TYPE_LABEL[t.power_type]}${t.power_code ? ` (${t.power_code})` : ''}` : ''}
              </div>
            </div>
            <div class="template-actions">
              <button type="button" class="template-btn-use" data-template-id="${t.id}" style="background: var(--primary-gradient); color:white;">使用</button>
              <button type="button" class="template-btn-delete" data-template-id="${t.id}">刪除</button>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('') : '<div class="empty-state">尚未建立任何範本。</div>';

    container.innerHTML = `
      <div class="orders-template-add-form">
        <div class="orders-form-section-title">＋ 新增範本</div>
        <div class="orders-form-grid">
          <div class="orders-form-field">
            <label>範本名稱 *</label>
            <input type="text" id="new-template-name" placeholder="如：電子零件 - 3箱" />
          </div>
          <div class="orders-form-field">
            <label>綁定公司 *</label>
            <select id="new-template-company"><option value="">-- 選擇公司 --</option>${companyOptionsForModal}</select>
          </div>
          <div class="orders-form-field full">
            <label>貨品描述</label>
            <input type="text" id="new-template-cargo-desc" />
          </div>
          <div class="orders-form-field">
            <label>件數</label>
            <input type="number" id="new-template-quantity" min="1" step="1" />
          </div>
          <div class="orders-form-field">
            <label>重量 (KG)</label>
            <input type="number" id="new-template-weight" min="0" step="0.01" />
          </div>
          <div class="orders-form-field">
            <label>CBM</label>
            <input type="number" id="new-template-cbm" min="0" step="0.01" />
          </div>
          <div class="orders-form-field">
            <label>⚡ 電力分類</label>
            <select id="new-template-power-type">
              <option value="no">無電</option>
              <option value="dry">乾電</option>
              <option value="lithium">鋰電</option>
            </select>
          </div>
          <div class="orders-form-field">
            <label>收貨人</label>
            <input type="text" id="new-template-receiver-name" />
          </div>
          <div class="orders-form-field">
            <label>聯絡電話</label>
            <input type="text" id="new-template-receiver-phone" />
          </div>
          <div class="orders-form-field full">
            <label>備註</label>
            <input type="text" id="new-template-notes" />
          </div>
        </div>
        <button type="button" class="orders-submit-btn" id="btn-save-template" style="margin-top:14px;">＋ 儲存範本</button>
      </div>

      ${groupsHtml}
    `;

    // 新增範本
    const saveTemplateBtn = document.getElementById('btn-save-template');
    if (saveTemplateBtn) {
      saveTemplateBtn.addEventListener('click', async () => {
        const name = document.getElementById('new-template-name').value.trim();
        const company_id = document.getElementById('new-template-company').value;
        if (!name || !company_id) {
          alert('請填寫範本名稱與選擇公司');
          return;
        }
        const payload = {
          name,
          company_id,
          cargo_desc: document.getElementById('new-template-cargo-desc').value.trim(),
          quantity: document.getElementById('new-template-quantity').value || null,
          weight_kg: document.getElementById('new-template-weight').value || null,
          cbm: document.getElementById('new-template-cbm').value || null,
          power_type: document.getElementById('new-template-power-type').value,
          receiver_name: document.getElementById('new-template-receiver-name').value.trim(),
          receiver_phone: document.getElementById('new-template-receiver-phone').value.trim(),
          notes: document.getElementById('new-template-notes').value.trim()
        };
        try {
          await apiFetch('/api/orders/templates', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          alert('範本已儲存！');
          renderTemplates();
        } catch (err) {
          alert(`儲存失敗：${err.message}`);
        }
      });
    }

    // 刪除範本
    container.querySelectorAll('.template-btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.templateId;
        if (!confirm('確定刪除此範本？')) return;
        try {
          await apiFetch(`/api/orders/templates/${id}`, { method: 'DELETE' });
          renderTemplates();
        } catch (err) {
          alert(`刪除失敗：${err.message}`);
        }
      });
    });

    // 使用範本
    container.querySelectorAll('.template-btn-use').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.templateId;
        const template = templatesData.find(t => Number(t.id) === Number(id));
        if (!template) return;
        // 切到新建訂單
        document.querySelectorAll('.orders-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.orders-tab[data-tab="new"]').classList.add('active');
        document.querySelectorAll('.orders-tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('orders-tab-new').classList.add('active');
        renderNewOrderForm(template);
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(err.message)}</div>`;
  }
}

// ===== 訂單列表搜尋（防抖） =====
function setupOrdersSearch() {
  const searchInput = document.getElementById('orders-search-input');
  const statusFilter = document.getElementById('orders-status-filter');
  const refreshBtn = document.getElementById('btn-orders-refresh');

  if (searchInput) {
    searchInput.addEventListener('input', debounce(fetchOrders, 350));
  }
  if (statusFilter) {
    statusFilter.addEventListener('change', fetchOrders);
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', fetchOrders);
  }
}

// ===== 訂單系統初始化 =====
function setupOrdersSection() {
  setupOrdersTabs();
  setupOrdersSearch();
  renderNewOrderForm();
}