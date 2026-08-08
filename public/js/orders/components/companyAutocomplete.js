// ===== 公司自動補全元件（收貨/交回地點輸入框） =====
// 採「輸入即時篩選已載入的 companiesCache」；若輸入值不在 cache 即為新公司名（提交時自動儲存）
// escapeHtml 為 window 全域函式（main.js）

import { getCompanies, deleteCompanySnapshot } from '../state.js';
import { isTransportCategory } from '../formatters.js';
import { highlightMatch } from '../highlight.js';
import { captureCompanySnapshot, renderCompanyDetailCard, handleCompanySelected } from './companyCard.js';

export function setupCompanyAutocomplete(inputId, hiddenId) {
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
    const candidates = getCompanies().filter(c => !isTransportCategory(c.category));
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
      const detail = detailParts.length ? `<span class="company-autocomplete-sub">${highlightMatch(detailParts.join(' · '), q)}</span>` : '';
      div.innerHTML = `${highlightMatch(c.name, q)}${detail}`;
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
    deleteCompanySnapshot(hiddenId);
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