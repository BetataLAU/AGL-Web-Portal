// ===== 公司詳細資料卡（快照、渲染、變更偵測） =====
// escapeHtml 為 window 全域函式（main.js）；openModal 為 window 全域函式（utils/modal.js）
// escapeAttr 由 ../formatters.js 提供

import { CATEGORY_LABEL } from '../constants.js';
import { getCompanyById, escapeAttr } from '../formatters.js';
import {
  getCompanySnapshot,
  setCompanySnapshot,
  deleteCompanySnapshot
} from '../state.js';

// 記錄公司原始資料快照（existed company 選中時）
export function captureCompanySnapshot(hiddenId) {
  const hidden = document.getElementById(hiddenId);
  if (!hidden) return;
  const company = getCompanyById(hidden.value);
  if (!company) {
    deleteCompanySnapshot(hiddenId);
    return;
  }
  setCompanySnapshot(hiddenId, {
    companyId: company.id,
    name: company.name || '',
    address: company.address || '',
    contact_person: company.contact_person || '',
    phone: company.phone || '',
    email: company.email || '',
    category: company.category || '',
    company_code: company.company_code || '',
    notes: company.notes || ''
  });
}

// 自動補全選擇公司後，把該公司的聯絡資料靜默帶入訂單 data（不顯示於表單）
export function handleCompanySelected() {
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
export function renderCompanyDetailCard(inputId, hiddenId) {
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
          <label>Company Code（登入用）</label>
          <input type="text" id="${inputId}-detail-code" value="${escapeAttr(company.company_code || '')}" placeholder="－" maxlength="20" />
        </div>
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
        <label>Company Code（登入用，選填）</label>
        <input type="text" id="${inputId}-detail-code" placeholder="例如：HUAZONG" maxlength="20" />
      </div>
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
export function getCompanyDetailData(inputId) {
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
    company_code: getVal('code'),
    category: cats.join(',')
  };
}

// 偵測某欄位是否改動了既有公司資料 → 回傳變更清單
export function detectCompanyChanges(inputId, hiddenId) {
  const snapshot = getCompanySnapshot(hiddenId);
  if (!snapshot) return [];
  const hidden = document.getElementById(hiddenId);
  if (!hidden || !hidden.value) return [];
  const current = getCompanyDetailData(inputId);

  const fieldMap = [
    ['address', '地址'],
    ['contact_person', '聯絡人'],
    ['phone', '電話'],
    ['email', '電郵'],
    ['notes', '備註'],
    ['company_code', 'Company Code']
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
export function showCompanyUpdateModal(changesByField, onConfirm) {
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