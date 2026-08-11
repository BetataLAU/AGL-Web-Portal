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
          <a class="pill btn-primary contour-download-link" href="${imageUrl}" download="${escapeHtml(img.filename)}" data-filename="${escapeHtml(img.filename)}">Download</a>
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

  // Download 改用 blob 方式：iOS Safari 對無 Content-Disposition header 的圖片，
  // <a download> 可能直接開啟圖片（看似無反應）。
  grid.querySelectorAll('.contour-download-link').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const filename = anchor.getAttribute('data-filename') || '';
      downloadContourImage(anchor.href, filename);
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

// ===== 裝置偵測 =====
// iPhone / iPad 的 iOS Safari 在 non-secure context（http:// 內網 IP）下
// 不提供 navigator.share，只能靠「長按圖片儲存」後手動分享到其他 APP。
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 偽裝成 Mac
}

// ===== 嘗試分享圖片「檔案」本身到其他 APP（Web Share API Level 2）=====
// 回傳 'shared'：已分享或使用者取消（流程結束，不需再 fallback）
// 回傳 'unsupported'：不支援或失敗，需要 fallback 到 URL 分享 / 選單
async function tryShareContourImageFile(url, filename) {
  if (!navigator.share || !navigator.canShare) return 'unsupported';
  try {
    const res = await fetch(url);
    if (!res.ok) return 'unsupported';
    const blob = await res.blob();
    if (!blob.type || !blob.type.startsWith('image/')) return 'unsupported';

    const fileName = filename || 'contour-image.jpg';
    const file = new File([blob], fileName, { type: blob.type });
    if (!navigator.canShare({ files: [file] })) return 'unsupported';

    await navigator.share({ files: [file], title: 'Contour Image' });
    return 'shared';
  } catch (err) {
    if (err.name === 'AbortError') return 'shared'; // 使用者取消 → 視為流程結束
    console.warn('[contours] file share failed:', err.name, err.message);
    return 'unsupported';
  }
}

// ===== 分享目前圖片（手機可直接分享圖片到 WhatsApp / WeChat / DingTalk 等） =====
async function shareContourImage() {
  if (!currentContourModalInfo) return;

  const { url, title, filename } = currentContourModalInfo;

  // iOS Safari 在 non-secure context（http:// 內網 IP）下沒有 navigator.share，
  // 直接顯示 iPhone 專屬指引：長按圖片儲存 → 手動分享到 WhatsApp/WeChat
  if (isIOS() && !navigator.share) {
    showShareMenu(url, title, filename);
    return;
  }

  // 1) 優先分享圖片「檔案」本身（目標 APP 直接收到圖片，而非網址）
  //    Android Chrome / Safari iOS 15+（https）支援 navigator.share + files
  const fileShareResult = await tryShareContourImageFile(url, filename);
  if (fileShareResult === 'shared') return;

  // 2) 檔案分享不支援/失敗 → 再試 Web Share API 分享網址
  //    注意：手機透過內網 http://IP（non-secure context）訪問，或部分 Android WebView，
  //    即使 navigator.share 存在，對 http:// 網址仍可能拋 NotAllowedError / DataError。
  //    只有 AbortError 才是「使用者取消」；其餘錯誤一律 fallback 到分享選單，確保有反應。
  if (navigator.share) {
    try {
      await navigator.share({ title: title || 'Contour Image', text: filename || '', url });
      return; // 分享成功
    } catch (err) {
      if (err.name === 'AbortError') return; // 使用者取消 → 靜默
      console.warn('[contours] url share failed, fallback to menu:', err.name, err.message);
    }
  }

  // 3) Web Share 失敗/不可用 → 顯示分享選單（系統分享 / 複製連結 / 下載圖片）
  showShareMenu(url, title, filename);
}

// 分享選單：保證使用者一定有反饋（Web Share 失敗、手機不支援或 iOS non-secure context）
function showShareMenu(url, title, filename) {
  const isIphone = isIOS();

  const systemBtnHtml = isIphone
    ? // iPhone（無 navigator.share）→ 主要動作是「長按圖片儲存」後手動分享
      `
      <p class="contour-share-hint"><i class="fa-solid fa-hand-pointer"></i> iPhone：請長按下方圖片「儲存圖片」，再到 WhatsApp / WeChat 選擇照片傳送。</p>
      <img class="contour-share-preview-img" src="${escapeHtml(url)}" alt="長按儲存此圖片" />
      <button type="button" class="pill btn-primary contour-share-option" data-share="ios-save">
        <i class="fa-solid fa-image"></i> 📸 長按圖片儲存後手動分享
      </button>
      `
    : // Android / 桌面 → 系統分享（檔案）
      `
      <button type="button" class="pill btn-primary contour-share-option" data-share="system">
        <i class="fa-solid fa-share-nodes"></i> 📱 系統分享（WhatsApp / WeChat / DingTalk…）
      </button>
      `;

  openModal({
    title: '📤 分享圖片',
    body: `
      <div class="contour-share-menu">
        <p class="contour-share-sub">${escapeHtml(title || 'Contour Image')}</p>
        ${systemBtnHtml}
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

      if (action === 'ios-save') {
        // iPhone：直接在新分頁開啟圖片，讓使用者長按儲存；同時提示步驟
        window.open(url, '_blank');
        alert('圖片已開啟。請在圖片上長按 → 「儲存圖片」，再到 WhatsApp / WeChat 選擇照片傳送。');
      } else if (action === 'system') {
        // Android / 桌面：1) 優先分享圖片「檔案」本身
        const fileShareResult = await tryShareContourImageFile(url, filename);
        if (fileShareResult === 'shared') return;

        // 2) 檔案分享不支援/失敗 → 再試 Web Share API 分享網址
        if (navigator.share) {
          try {
            await navigator.share({ title: title || 'Contour Image', text: filename || '', url });
            return;
          } catch (err) {
            // 只有 AbortError 是使用者取消；其餘錯誤繼續 fallback，確保有反饋
            if (err.name === 'AbortError') return;
            console.warn('[contours] system share failed:', err.name, err.message);
          }
        }
        // 3) 系統分享不可用 → fallback 複製連結
        const ok = await copyTextToClipboard(url);
        if (ok) {
          showTemporaryNotice(document.body, '已複製圖片連結！');
        } else {
          alert('此瀏覽器不支援系統分享，也無法複製連結。請長按圖片儲存後手動分享。');
        }
      } else if (action === 'copy') {
        const ok = await copyTextToClipboard(url);
        if (ok) {
          showTemporaryNotice(document.body, '已複製圖片連結！');
        } else {
          alert('複製失敗，請長按圖片手動複製。');
        }
      } else if (action === 'download') {
        // 行動裝置建議使用 blob + objectURL 下載（<a download> 在 iOS Safari 上
        // 對無 Content-Disposition header 的圖片可能無效/直接開啟圖片）
        await downloadContourImage(url, filename || 'contour-image.jpg');
      }
    });
  });
}

// ===== 下載圖片（行動裝置相容） =====
// iOS Safari 對 <a download> + 伺服器未附 Content-Disposition: attachment 的圖片，
// 可能直接開啟圖片（看起來像無反應）。改用 fetch → blob → objectURL 方式，
// 失敗時 fallback 直接導向圖片，確保一定有反應。
async function downloadContourImage(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    // 避免誤下載非圖片內容（例如 404 的 JSON/HTML 回應）
    if (blob.type && !blob.type.startsWith('image/')) {
      throw new Error(`Unexpected content type: ${blob.type}`);
    }
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'contour-image.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  } catch (err) {
    console.error('[contours] download failed:', err);
    // Fallback：直接開啟圖片，讓使用者可長按儲存 / 選擇下載
    window.location.href = url;
  }
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