// ===== 通用自動補全（輸入即篩選下拉） =====
// 用法：
//   setupAutocomplete({
//     input: <input 元素>,
//     suggestions: ['A67', 'A123', 'A199'],   // 候選清單（字串陣列）或 () => 陣列（動態）
//     onSelect: (value) => { ... }            // 選中時回呼（可選）
//   });
// 特色：可輸入任意值（支援自訂），輸入即時篩選，鍵盤 ↑↓/Enter/Tab/Esc
function setupAutocomplete({ input, suggestions = [], onSelect = null, emptyMessage = '沒有相符的選項，可繼續輸入自訂值。' }) {
  if (!input) return;

  // 建立下拉清單容器（掛到 input 的父層）
  let listEl = input.parentElement.querySelector('.app-autocomplete-list');
  if (!listEl) {
    listEl = document.createElement('div');
    listEl.className = 'app-autocomplete-list';
    input.parentElement.appendChild(listEl);
  }

  let activeIndex = -1;
  let currentItems = [];

  function closeList() {
    listEl.innerHTML = '';
    listEl.style.display = 'none';
    activeIndex = -1;
    currentItems = [];
  }

  function selectItem(value) {
    input.value = value;
    closeList();
    if (onSelect) onSelect(value);
  }

  function getMatches(query) {
    const list = (typeof suggestions === 'function') ? suggestions() : suggestions;
    const q = (query || '').trim().toLowerCase();
    if (!q) return list.slice(0, 10);
    return list.filter(s => String(s).toLowerCase().includes(q)).slice(0, 10);
  }

  function showMatches() {
    const matches = getMatches(input.value);
    currentItems = matches;
    listEl.innerHTML = '';

    if (!matches.length) {
      listEl.style.display = 'block';
      listEl.innerHTML = `<div class="app-autocomplete-empty">${emptyMessage}</div>`;
      return;
    }

    listEl.style.display = 'block';
    activeIndex = -1;
    matches.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'app-autocomplete-item';
      div.dataset.index = idx;
      div.textContent = item;
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectItem(item);
      });
      listEl.appendChild(div);
    });
  }

  function highlightItem() {
    const items = listEl.querySelectorAll('.app-autocomplete-item');
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
    const activeEl = items[activeIndex];
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', showMatches);
  input.addEventListener('focus', () => {
    if (input.value.trim()) showMatches();
  });

  input.addEventListener('keydown', (e) => {
    const items = listEl.querySelectorAll('.app-autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      highlightItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlightItem();
    } else if (e.key === 'Enter' && activeIndex >= 0 && currentItems[activeIndex]) {
      e.preventDefault();
      selectItem(currentItems[activeIndex]);
    } else if (e.key === 'Tab') {
      if (activeIndex >= 0 && currentItems[activeIndex]) {
        selectItem(currentItems[activeIndex]);
      } else {
        closeList();
      }
    } else if (e.key === 'Escape') {
      closeList();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!listEl.contains(document.activeElement)) closeList();
    }, 150);
  });
}