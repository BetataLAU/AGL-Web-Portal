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
      navigator.clipboard.writeText(url).then(() => {
        showTemporaryNotice(btn.closest('.contour-result-card') || document.body, 'Image link copied to clipboard.');
      }).catch(() => {
        alert('Unable to copy the image link.');
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
  navigator.clipboard.writeText(links.join('\n')).then(() => {
    showTemporaryNotice(document.getElementById('contour-results-grid') || document.body, 'All image links copied to clipboard.');
  }).catch(() => {
    alert('Unable to copy contour links.');
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

function setupContourModal() {
  const overlay = document.getElementById('contour-image-modal');
  const closeBtn = document.getElementById('contour-modal-close');
  if (!overlay || !closeBtn) return;

  closeBtn.addEventListener('click', closeContourModal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeContourModal();
    }
  });
}

function openContourModal(src, title, code, filename) {
  const overlay = document.getElementById('contour-image-modal');
  const imageEl = document.getElementById('contour-modal-image');
  const titleEl = document.getElementById('contour-modal-title');
  if (!overlay || !imageEl || !titleEl) return;

  imageEl.src = src;
  imageEl.alt = title || code || 'Contour preview';
  titleEl.textContent = code ? `${code} · ${title}` : title;

  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');

  contourModalKeyHandler = (event) => {
    if (event.key === 'Escape') {
      closeContourModal();
    }
  };
  document.addEventListener('keydown', contourModalKeyHandler);
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