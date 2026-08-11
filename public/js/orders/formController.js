// escapeHtml 為 window 全域函式（main.js）
// validateMawb / formatMawb / isLateMawb / displayMawb 為 window 全域函式（utils/mawb-utils.js）
// validateHawb / setupHawbInput 為 window 全域函式（utils/hawb-utils.js）
// getTodayDateStr / getNowTimeStr / formatPickupDatetime / formatDateTime 為 window 全域函式（utils/datetime-utils.js）
// openCbmCalculator / setupTimePicker / openModal 為 window 全域函式（utils/）
// 註：與 listController.js 存在執行期才使用的循環依賴（ES Module 支援，安全）

import { MAWB_LATE_LABEL, POWER_LATE_LABEL, CATEGORY_LABEL } from './constants.js';
import {
  getCurrentOrderType,
  setCurrentOrderType,
  getEditingOrderId,
  setEditingOrderId,
  getDuplicateConfirmed,
  setDuplicateConfirmed,
  getPowerItemsList,
  setPowerItemsList,
  getCurrentCbmDimensions,
  setCurrentCbmDimensions,
  setDuplicateCheckTimer,
  clearDuplicateCheckTimer
} from './state.js';
import {
  loadCompanies,
  loadTransportCompanies,
  saveCompany,
  updateCompany,
  checkDuplicateOrder as apiCheckDuplicateOrder,
  fetchOrder,
  createOrder,
  updateOrder,
  getEmailApps,
  openEmailClient
} from './api.js';
import { getCompanyById, escapeAttr, buildOrderSummary, buildOrderSummaryText, isTransportCategory } from './formatters.js';
import { validateDest } from './validation.js';
import { setupCompanyAutocomplete } from './components/companyAutocomplete.js';
import {
  renderCompanyDetailCard,
  captureCompanySnapshot,
  detectCompanyChanges,
  getCompanyDetailData
} from './components/companyCard.js';
import { renderCbmDimPreview } from './components/cbmModal.js';
import { setupNoteTemplateSearch } from './components/noteTemplates.js';
import { addPowerItem, renderPowerItemsList } from './components/powerItemsEditor.js';
import { showDuplicateCard } from './components/duplicateModal.js';
import { fetchOrders, setupOrdersTabs, setupOrdersSearch, setupOrdersAutoRefresh } from './listController.js';

// ===== 重複檢查參數收集（DOM → params，供 api.checkDuplicateOrder 使用） =====
// 原 orders.js checkDuplicateOrder：從表單讀取 MAWB/HAWB/提貨號/客戶後組查詢參數
function collectDuplicateCheckParams() {
  const mawbVal = document.getElementById('order-mawb')?.value.trim() || '';
  const hawbVal = document.getElementById('order-hawb')?.value.trim() || '';
  const pickupVal = document.getElementById('order-pickup-no')?.value.trim() || '';
  const customerCompanyId = document.getElementById('order-customer-id')?.value?.trim() || '';

  const params = {};
  if (mawbVal && !isLateMawb(mawbVal)) {
    // MAWB 標準化後查詢
    const mawbResult = validateMawb(mawbVal);
    if (mawbResult.valid && !mawbResult.late) params.mawb = mawbResult.formatted;
  }
  if (hawbVal) params.hawb = hawbVal;
  if (pickupVal) params.pickup_no = pickupVal;
  // 已選客戶 → 後端只比對同一客戶的提貨號（精確）；未選客戶 → 全表提醒
  if (customerCompanyId) params.customer_company_id = customerCompanyId;
  if (getEditingOrderId()) params.exclude_id = getEditingOrderId();

  return params;
}

// ===== 新建訂單表單 =====
export function renderNewOrderForm(prefill = null, preserveCurrentType = false) {
  const container = document.getElementById('orders-new-form');
  if (!container) return;
  if (!prefill) {
    // 新增模式：重置編輯狀態，避免誤將「新增」當作對上一單的「更新」（會覆蓋舊訂單資料）
    setEditingOrderId(null);
    // 切換訂單類型時（preserveCurrentType=true）保留目前類型，其餘情況重設為收貨
    if (!preserveCurrentType) {
      setCurrentOrderType('pickup');
    }
  }
  setDuplicateConfirmed(false); // 新表單重置重複確認狀態

  // 載入公司資料
  Promise.all([loadCompanies(), loadTransportCompanies()]).then(() => {
    const currentOrderType = getCurrentOrderType();
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
      setPowerItemsList(prefill.power_items.map(item => ({ ...item })));
    } else if (prefill && prefill.power_code && prefill.power_type && prefill.power_type !== 'no') {
      // 舊資料只有單一代碼的相容處理
      setPowerItemsList([{ type: prefill.power_type, main: '', code: prefill.power_code, qty: '' }]);
    } else {
      setPowerItemsList([]);
    }
    renderPowerItemsList();

    setupNewOrderFormEvents();
  }).catch(err => {
    container.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(err.message)}</div>`;
  });
}

// ===== 收集目前表單資料 =====
export function getCurrentFormData() {
  const form = document.getElementById('orders-create-form');
  if (!form) return null;

  const currentOrderType = getCurrentOrderType();
  const powerItemsList = getPowerItemsList();

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
    cbm_dimensions: getCurrentCbmDimensions().length ? getCurrentCbmDimensions() : null,
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
    status: 'pending'
  };
}

// ===== 新表單事件綁定 + 提交流程 =====
export function setupNewOrderFormEvents() {
  // 訂單類型按鈕
  document.querySelectorAll('.orders-choice-btn[data-order-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.orders-choice-btn[data-order-type]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      setCurrentOrderType(btn.dataset.orderType);
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
          setCurrentCbmDimensions(dims || []);
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
  // 共用 debounce：快速跳欄位時只發一次請求（變數在 state，submit handler 需 clearTimeout 防止 blur 卡片覆蓋「仍然繼續」卡片）
  setDuplicateCheckTimer(null);
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

    const duplicates = await apiCheckDuplicateOrder(collectDuplicateCheckParams());
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
      clearDuplicateCheckTimer();
      setDuplicateCheckTimer(setTimeout(() => {
        runBlurDuplicateCheck();
      }, 350));
    });
  });

  // 提交表單
  const form = document.getElementById('orders-create-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // 取消排程中的 blur 重複檢查，防止 350ms 後 blur 卡片覆蓋「仍然繼續」卡片
      clearDuplicateCheckTimer();
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
      const currentOrderType = getCurrentOrderType();
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
            const companies = await loadCompanies();
            const existing = companies.find(c => c.name.toLowerCase() === name.toLowerCase() && !isTransportCategory(c.category));
            let companyId;
            if (existing) {
              companyId = existing.id;
            } else {
              // 從詳細資料卡收集用戶填寫的資料（欄位 id = `${inputId}-detail-*`）
              const detail = getCompanyDetailData(item.input.id);
              const result = await saveCompany({
                category: item.category,
                name,
                address: detail.address || '',
                contact_person: detail.contact_person || '',
                phone: detail.phone || '',
                email: detail.email || '',
                notes: detail.notes || ''
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
          await updateCompany(companyId, {
            category: current.category || (existingCompany ? existingCompany.category : 'customer'),
            name: nameVal,
            address: current.address || '',
            contact_person: current.contact_person || '',
            phone: current.phone || '',
            email: current.email || '',
            notes: current.notes || ''
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
      const editingOrderId = getEditingOrderId();
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
      if (!getDuplicateConfirmed()) {
        const duplicates = await apiCheckDuplicateOrder(collectDuplicateCheckParams());
        if (duplicates && duplicates.length) {
          // 彈出重複卡；按「仍然繼續」直接提交已收集的 data（onConfirm）
          showDuplicateCard(duplicates, 'submit', performSubmit);
          return;
        }
      }
      setDuplicateConfirmed(false); // 重置，確保下次提交再次檢查
      await performSubmit();
    });
  }
}

// ===== 成功頁面 =====
export function showOrderSuccess(orderNo, orderId) {
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
    setEditingOrderId(null);
    setCurrentOrderType('pickup');
    renderNewOrderForm();
  });

  // 載入訂單資料生成總結
  fetchOrder(orderId).then(order => {
    const summary = buildOrderSummary(order);
    const output = document.getElementById('orders-summary-output');
    if (output) {
      // 顯示 HTML 表格（不轉義，讓 <table> 正常渲染）
      output.innerHTML = `<div class="orders-summary-html">${summary}</div>`;
    }

    document.getElementById('btn-order-email-summary').addEventListener('click', () => {
      sendOrderEmail(order, summary);
    });
    // 複製用純文字總結（不含 HTML，適合貼到 WhatsApp 等通訊軟體）
    const summaryText = buildOrderSummaryText(order);
    document.getElementById('btn-order-copy-summary').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(summaryText);
        alert('總結內容已複製！可使用 WhatsApp 等發送。');
      } catch (err) {
        const textarea = document.createElement('textarea');
        textarea.value = summaryText;
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

// HTML 表格 → 純文字（mailto body 只接受純文字）
function htmlToText(html) {
  if (!html) return '';
  const dom = new DOMParser().parseFromString(html, 'text/html');
  // 將 <br> 轉為換行符，讓純文字 body 保留原有 ENTER
  dom.querySelectorAll('br').forEach(br => {
    const nl = document.createTextNode('\n');
    br.replaceWith(nl);
  });
  dom.querySelectorAll('table').forEach(table => {
    const rows = table.querySelectorAll('tr');
    rows.forEach(tr => {
      const cells = tr.querySelectorAll('td, th');
      const line = Array.from(cells).map(c => c.textContent.trim()).join(' | ');
      const lineEl = document.createElement('div');
      lineEl.textContent = line;
      tr.replaceWith(lineEl);
    });
  });
  return (dom.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

// ===== 開啟「選擇郵件應用程式」Modal（用戶可選 Outlook Classic 或系統預設郵件） =====
export async function sendOrderEmail(order, summary) {
  // 依使用者要求：TO:/CC: 一律不自動填入（收件人留空，由使用者自行輸入）
  // HTML 格線表格總結（buildOrderSummary 已是藍色標題列 + 細格線）
  const htmlBody = summary;
  const plainText = htmlToText(summary);

  // ===== SUBJECT 新格式： [AGL - 收貨ORDER (URGENT)] 客戶 / 提貨日期 / M# MAWB / 件數 | 重量 | CBM
  const subjectType = order.order_type === 'delivery' ? '送貨ORDER' : '收貨ORDER';
  const urgentPart = order.urgent === 'yes' ? ' (URGENT)' : '';
  const subjectCustomer = order.customer_company_name || '-';
  // 提貨日期（只取日期部分，不含時間；無值 → '-'）
  const subjectPickup = order.pickup_datetime ? String(order.pickup_datetime).slice(0, 10) : '-';
  const subjectMawb = `M# ${displayMawb(order.mawb)}`;
  const subjectCargo = `${order.quantity || 0}件 | ${order.weight_kg || 0} KG | ${order.cbm || 0} cbm`;
  const subject = `[AGL - ${subjectType}${urgentPart}] ${subjectCustomer} / ${subjectPickup} / ${subjectMawb} / ${subjectCargo}`;

  // 系統預設郵件 → mailto（收件人留空，body 用純文字）
  const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;

  // 查詢系統可用的郵件應用程式
  let apps = [];
  try {
    apps = await getEmailApps();
  } catch (err) {
    console.warn('查詢郵件應用程式失敗：', err.message);
  }
  if (!apps.length) {
    // 查不到 → 直接使用預設 mailto（純文字）
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
        btn.disabled = true;
        btn.textContent = '⏳ 正在開啟 Outlook Classic...';
        try {
          // 後端：優先 PowerShell + Outlook COM 建立 HTML 格線草稿（TO/CC 留空），失敗時 fallback 純文字 mailto
          const result = await openEmailClient({ client, subject, htmlBody, plainText });
          console.log('[sendOrderEmail] Outlook Classic 開啟結果：', result);
          alert(result && result.layer === 'outlook-com-html'
            ? '✅ Outlook Classic 已開啟（HTML 格線表格草稿）'
            : '✅ Outlook Classic 已開啟（mailto 純文字草稿）');
        } catch (err) {
          console.error('[sendOrderEmail] Outlook Classic 開啟失敗：', err);
          alert(`❌ 開啟 Outlook Classic 失敗：${err.message}`);
          btn.disabled = false;
          btn.textContent = originalLabel;
          return;
        }
      } else if (client === 'default') {
        // 系統預設郵件 → 瀏覽器 mailto 協議（收件人留空，純文字 body）
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

// ===== 編輯訂單：載入既有資料到表單 =====
export function loadOrderToForm(order) {
  setEditingOrderId(order.id);
  setCurrentOrderType(order.order_type);
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
        setCurrentCbmDimensions(order.cbm_dimensions);
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
          clearDuplicateCheckTimer();
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
              await updateOrder(order.id, data);
              alert('訂單已更新！');
              setEditingOrderId(null);
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
          if (!getDuplicateConfirmed()) {
            const duplicates = await apiCheckDuplicateOrder(collectDuplicateCheckParams());
            if (duplicates && duplicates.length) {
              // 彈出重複卡；按「仍然繼續」直接提交已收集的 data（onConfirm）
              showDuplicateCard(duplicates, 'submit', performSubmit);
              return;
            }
          }
          setDuplicateConfirmed(false); // 重置，確保下次提交再次檢查
          await performSubmit();
        };
      }
    }, 50);
  });
}

// ===== 訂單系統初始化（組裝入口） =====
export function setupOrdersSection() {
  setupOrdersTabs();
  setupOrdersSearch();
  setupOrdersAutoRefresh(10000); // 每 10 秒自動同步其他設備的更新
  renderNewOrderForm();
}

// ===== 初始化（entry point 呼叫；掛載 window 讓 main.js 的 DOMContentLoaded 可直接呼用） =====
export function initOrderModule() {
  // 方案 1A：main.js 在 DOMContentLoaded 呼叫 window.setupOrdersSection
  // module 屬 defer，於 DOMContentLoaded 前執行完畢，掛載到 window 後 main.js 即可正常使用
  window.setupOrdersSection = setupOrdersSection;
}