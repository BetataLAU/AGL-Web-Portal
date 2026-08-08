// ===== 帶電種類及件數編輯器 =====
// setupAutocomplete 為 window 全域函式（utils/autocomplete.js）
// escapeAttr 由 ../formatters.js 提供

import { POWER_TYPE_LABEL, LITHIUM_MAIN } from '../constants.js';
import { escapeAttr } from '../formatters.js';
import { getPowerItemsList } from '../state.js';

// 新增一項電力（無電/乾電/鋰電 均可累積加入）
export function addPowerItem(type) {
  const powerItemsList = getPowerItemsList();
  if (type === 'no') {
    powerItemsList.push({ type: 'no', main: '', code: '', qty: '' });
  } else if (type === 'dry') {
    powerItemsList.push({ type: 'dry', main: '', code: '', qty: '' });
  } else if (type === 'lithium') {
    powerItemsList.push({ type: 'lithium', main: '', code: '', qty: '' });
  }
  renderPowerItemsList();
}

export function renderPowerItemsList() {
  const powerItemsList = getPowerItemsList();
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