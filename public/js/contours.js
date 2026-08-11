// ===== Contour 頁：搜尋 + 渲染 + 圖片 Modal + ZIP 匯出 =====
let currentContourData = [];
let selectedContourImages = new Set();

function setupContourSection() {
  const searchForm = document.getElementById('contour-search-form');
  const searchInput = document.getElementById('contour-search-input');
  const showAllBtn = document.getElementById('btn-contour-show-all');
  const copyLinksBtn = document.getElementById('btn-contour-copy-links');
  const zipBtn = document.getElementById('btn-contour-download-zip');

  if (!searchForm || !searchInput || !showAllBtn) {
    console.warn('Contour search form elements missing, skipping event binding');
    return;
  }

  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await fetchContourImages(searchInput.value);
  });

  searchInput.addEventListener('input', () => {
    const list = document.getElementById('contour-suggestions');
    if (!list) return;
    const query = searchInput.value.trim().toLowerCase();
    const suggestions = currentContourData
      .filter(item => item.title.toLowerCase().includes(query) || item.code.toLowerCase().includes(query))
      .slice(0, 10)
      .map(item => item.code);
    list.innerHTML = Array.from(new Set(suggestions)).map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  });

  showAllBtn.addEventListener('click', async () => {
    searchInput.value = '';
    await fetchContourImages('');
  });

  if (zipBtn) zipBtn.addEventListener('click', exportSelectedContourZip);
  if (copyLinksBtn) copyLinksBtn.addEventListener('click', copyContourLinks);

  // Load all contour images by default when the section is initialized.
  fetchContourImages('');
}

async function fetchContourImages(query = '') {
  const encoded = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  try {
    const res = await fetch(`/api/contours${encoded}`);
    if (!res.ok) {
      console.error('Contour fetch failed', res.statusText);
      showContourError('Unable to fetch contour images.');
      return;
    }

    const result = await res.json();
    currentContourData = result.data || [];
    updateContourSuggestions(currentContourData);
    renderContourResults(currentContourData, query.trim());
  } catch (err) {
    console.error('Contour fetch error', err);
    showContourError('Unable to fetch contour images.');
  }
}

function renderContourResults(images, query) {
  const grid = document.getElementById('contour-results-grid');
  const countEl = document.getElementById('contour-results-count');
  if (!grid || !countEl) return;

  if (!images.length) {
    const message = query ? `No contours matched "${query}".` : 'No contour images found. Try another search term.';
    countEl.textContent = message;
    grid.innerHTML = '<div class="empty-state">No images to display.</div>';
    return;
  }

  countEl.textContent = `${images.length} contour image${images.length === 1 ? '' : 's'} found.`;
  grid.innerHTML = images.map((img, idx) => {
    const imageUrl = `/api/contour-image/${encodeURIComponent(img.filename)}`;
    return `
      <div class="contour-result-card stagger-item" style="animation-delay: ${Math.min(idx * 40, 600)}ms">
        <img src="${imageUrl}" alt="${escapeHtml(img.title)}" loading="lazy" data-filename="${escapeHtml(img.filename)}" data-title="${escapeHtml(img.title)}" data-code="${escapeHtml(img.code)}" />
        <div class="contour-meta">
          <span class="contour-code">${escapeHtml(img.code)}</span>
          <span>${escapeHtml(img.title)}</span>
        </div>
        <div class="contour-actions">
          <a class="pill btn-primary" href="${imageUrl}" download="${escapeHtml(img.filename)}">Download</a>
          <button type="button" class="pill copy-link-btn" data-filename="${escapeHtml(img.filename)}">Copy URL</button>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.contour-result-card img').forEach(imgEl => {
    imgEl.addEventListener('click', () => {
      const src = imgEl.getAttribute('src');
      const title = imgEl.getAttribute('data-title') || '';
      const code = imgEl.getAttribute('data-code') || '';
      const filename = imgEl.getAttribute('data-filename');
      openContourModal(src, title, code, filename);
    });
  });

  grid.querySelectorAll('.copy-link-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filename = btn.getAttribute('data-filename');
      if (!filename) return;
      const url = `${window.location.origin}/api/contour-image/${encodeURIComponent(filename)}`;
      copyTextToClipboard(url).then(ok => {
        if (ok) {
          showTemporaryNotice(btn.closest('.contour-result-card') || document.body, 'Image link copied to clipboard.');
        } else {
          alert('Unable to copy the image link.');
        }
      });
    });
  });
}

function copyContourLinks() {
  if (!currentContourData.length) {
    alert('No contour results to copy.');
    return;
  }

  const links = currentContourData.map(img => `${window.location.origin}/api/contour-image/${encodeURIComponent(img.filename)}`);
  copyTextToClipboard(links.join('\n')).then(ok => {
    if (ok) {
      showTemporaryNotice(document.getElementById('contour-results-grid') || document.body, 'All image links copied to clipboard.');
    } else {
      alert('Unable to copy contour links.');
    }
  });
}

function showContourError(message) {
  const countEl = document.getElementById('contour-results-count');
  const grid = document.getElementById('contour-results-grid');
  if (countEl) countEl.textContent = message;
  if (grid) grid.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function updateContourSuggestions(images) {
  const list = document.getElementById('contour-suggestions');
  if (!list) return;
  list.innerHTML = images
    .slice(0, 50)
    .map(item => item.code)
    .filter((value, index, self) => value && self.indexOf(value) === index)
    .map(value => `<option value="${escapeHtml(value)}"></option>`)
    .join('');
}

async function exportSelectedContourZip() {
  if (!selectedContourImages.size) {
    alert('Please select at least one contour image.');
    return;
  }

  if (typeof JSZip === 'undefined') {
    alert('ZIP export library unavailable.');
    return;
  }

  const zip = new JSZip();
  const entries = currentContourData.filter(img => selectedContourImages.has(img.filename));
  if (!entries.length) {
    alert('Selected items are not available in the current results.');
    return;
  }

  const folder = zip.folder('contour-images');
  const promises = entries.map(async (img) => {
    const imageUrl = `/api/contour-image/${encodeURIComponent(img.filename)}`;
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to fetch ${img.filename}`);
    const blob = await res.blob();
    folder.file(img.filename, blob);
  });

  try {
    await Promise.all(promises);
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `contour_images_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    console.error('ZIP export error', err);
    alert('Unable to generate ZIP file.');
  }
}

// ===== 圖片 Modal =====
let contourModalKeyHandler = null;
let currentContourModalInfo = null; // { url, title, filename } — 供分享按鈕使用

function setupContourModal() {
  const overlay = document.getElementById('contour-image-modal');
  const closeBtn = document.getElementById('contour-modal-close');
  const shareBtn = document.getElementById('contour-modal-share');
  if (!overlay || !closeBtn) return;

  closeBtn.addEventListener('click', closeContourModal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeContourModal();
    }
  });

  if (shareBtn) {
    shareBtn.addEventListener('click', shareContourImage);
  }
}

function openContourModal(src, title, code, filename) {
  const overlay = document.getElementById('contour-image-modal');
  const imageEl = document.getElementById('contour-modal-image');
  const titleEl = document.getElementById('contour-modal-title');
  if (!overlay || !imageEl || !titleEl) return;

  imageEl.src = src;
  imageEl.alt = title || code || 'Contour preview';
  titleEl.textContent = code ? `${code} · ${title}` : title;

  // 記錄目前圖片資訊供分享按鈕使用
  currentContourModalInfo = {
    url: `${window.location.origin}/api/contour-image/${encodeURIComponent(filename || '')}`,
    title: code ? `${code} · ${title}` : title,
    filename: filename || ''
  };

  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');

  contourModalKeyHandler = (event) => {
    if (event.key === 'Escape') {
      closeContourModal();
    }
  };
  document.addEventListener('keydown', contourModalKeyHandler);
}

// ===== 分享目前圖片（手機可分享到 WhatsApp / WeChat / DingTalk 等） =====
async function shareContourImage() {
  if (!currentContourModalInfo) return;

  const { url, title, filename } = currentContourModalInfo;

  // 1) Web Share API：手機瀏覽器原生分享（可選 WhatsApp/WeChat/DingTalk 等）
  if (navigator.share) {
    try {
      await navigator.share({ title: title || 'Contour Image', text: filename || '', url });
      return; // 成功分享（或使用者取消）不需額外提示
    } catch (err) {
      // AbortError/NotAllowedError = 使用者取消分享 → 靜默返回
      if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
      // 其他錯誤（DataError / 權限被拒等）→ 落入分享選單 fallback，確保有反饋
      console.error('[contours] share failed:', err);
    }
  }

  // 2) Web Share 失敗/不可用 → 顯示分享選單（系統分享 / 複製連結 / 下載圖片）
  showShareMenu(url, title, filename);
}

// 分享選單：保證使用者一定有反饋（Web Share 失敗或手機不支援時）
function showShareMenu(url, title, filename) {
  openModal({
    title: '📤 分享圖片',
    body: `
      <div class="contour-share-menu">
        <p class="contour-share-sub">${escapeHtml(title || 'Contour Image')}</p>
        <button type="button" class="pill btn-primary contour-share-option" data-share="system">
          <i class="fa-solid fa-share-nodes"></i> 📱 系統分享（WhatsApp / WeChat / DingTalk…）
        </button>
        <button type="button" class="pill contour-share-option" data-share="copy">
          <i class="fa-solid fa-link"></i> 📋 複製圖片連結
        </button>
        <button type="button" class="pill contour-share-option" data-share="download">
          <i class="fa-solid fa-download"></i> ⬇️ 下載圖片
        </button>
      </div>
    `,
    className: 'contour-share-modal',
    actions: [{ label: '✖ 取消', className: 'pill' }]
  });

  document.querySelectorAll('.contour-share-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.share;
      // 關閉選單 modal
      document.querySelectorAll('.app-modal-overlay').forEach(el => el.remove());

      if (action === 'system') {
        // 再試一次 Web Share API
        if (navigator.share) {
          try {
            await navigator.share({ title: title || 'Contour Image', text: filename || '', url });
            return;
          } catch (err) {
            if (err.name === 'AbortError' || err.name === 'NotAllowedError') return; // 使用者取消
            console.error('[contours] share failed:', err);
          }
        }
        // 系統分享不可用 → fallback 複製連結
        const ok = await copyTextToClipboard(url);
        if (ok) {
          showTemporaryNotice(document.getElementById('contour-image-modal'), '已複製圖片連結！');
        } else {
          alert('此瀏覽器不支援系統分享，也無法複製連結。請長按圖片儲存後手動分享。');
        }
      } else if (action === 'copy') {
        const ok = await copyTextToClipboard(url);
        if (ok) {
          showTemporaryNotice(document.getElementById('contour-image-modal'), '已複製圖片連結！');
        } else {
          alert('複製失敗，請長按圖片手動複製。');
        }
      } else if (action === 'download') {
        // 下載圖片
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'contour-image.jpg';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    });
  });
}

function closeContourModal() {
  const overlay = document.getElementById('contour-image-modal');
  const imageEl = document.getElementById('contour-modal-image');
  if (!overlay || !imageEl) return;

  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
  imageEl.src = '';
  imageEl.alt = '';

  if (contourModalKeyHandler) {
    document.removeEventListener('keydown', contourModalKeyHandler);
    contourModalKeyHandler = null;
  }
}