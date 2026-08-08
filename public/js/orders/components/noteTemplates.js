// ===== 備註文字範本搜尋/建立/修改 =====
// escapeHtml 為 window 全域函式（main.js）
// searchNoteTemplates / saveNoteTemplate 由 ../api.js 提供

import { searchNoteTemplates, saveNoteTemplate } from '../api.js';

export function setupNoteTemplateSearch() {
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
        <span class="note-template-name">${highlightMatch(t.name, q)}</span>
        <span class="note-template-sub">${highlightMatch((t.content || '').slice(0, 40), q)}</span>
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