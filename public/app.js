// ===== Utility: Debounce =====
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ===== 動效 #5: 游標追蹤光暈 =====
function setupCardGlowTracking() {
  document.addEventListener('mousemove', (e) => {
    const cards = document.querySelectorAll('.card, .hero-header');
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty('--mouse-x', `${x}%`);
      card.style.setProperty('--mouse-y', `${y}%`);
    });
  });
}

// ===== 動效 #6: 游標拖尾 =====
function setupCursorTrail() {
  const canvas = document.getElementById('cursor-trail-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let trails = [];
  let rafId = null;
  let lastMove = 0;
  const MAX_TRAILS = 24;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function addTrail(x, y) {
    const now = Date.now();
    if (now - lastMove < 14) return;
    lastMove = now;
    trails.push({ x, y, life: 1 });
    if (trails.length > MAX_TRAILS) trails.shift();
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    trails.forEach((t, i) => {
      t.life -= 0.05;
      if (t.life <= 0) { trails.splice(i, 1); return; }
      const size = 10 * t.life;
      const hue = 220;
      ctx.beginPath();
      ctx.arc(t.x, t.y, size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, 85%, 65%, ${t.life * 0.5})`;
      ctx.shadowColor = `hsla(${hue}, 90%, 65%, ${t.life * 0.7})`;
      ctx.shadowBlur = 14;
      ctx.fill();
    });
    if (trails.length > 0) {
      rafId = requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      rafId = null;
    }
  }

  document.addEventListener('mousemove', (e) => {
    addTrail(e.clientX, e.clientY);
    if (!rafId) rafId = requestAnimationFrame(animate);
  });
}

// ===== 動效 #7: 背景漂浮粒子 =====
function setupBackgroundParticles() {
  const canvas = document.getElementById('bg-particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];
  let rafId = null;
  const MIN_COUNT = 40;
  const MAX_COUNT = 70;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    initParticles();
  }

  function initParticles() {
    const count = MIN_COUNT + Math.floor(Math.random() * (MAX_COUNT - MIN_COUNT));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: 1.5 + Math.random() * 3,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      alpha: 0.25 + Math.random() * 0.5,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.01 + Math.random() * 0.03
    }));
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.pulse += p.pulseSpeed;
      if (p.x < -10) p.x = canvas.width + 10;
      if (p.x > canvas.width + 10) p.x = -10;
      if (p.y < -10) p.y = canvas.height + 10;
      if (p.y > canvas.height + 10) p.y = -10;
      const a = p.alpha * (0.7 + 0.3 * Math.sin(p.pulse));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99, 132, 235, ${a})`;
      ctx.fill();
    });
    // 微細連線
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 110) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(99, 132, 235, ${(1 - dist / 110) * 0.16})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
    rafId = requestAnimationFrame(animate);
  }

  resizeCanvas();
  window.addEventListener('resize', debounce(resizeCanvas, 200));
  animate();
}

// ===== Utility: Debounce (unused helper retained) =====

// ===== 銝駁?蝟餌絞 =====
function initTheme() {
  const savedTheme = localStorage.getItem('site-theme') || 'light';
  const savedColor = localStorage.getItem('site-theme-color') || '#0ea5e9';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === savedTheme);
  });

  const picker = document.getElementById('theme-color-picker-container');
  const colorInput = document.getElementById('theme-color-input');
  if (colorInput) colorInput.value = savedColor;
  toggleOceanPicker(savedTheme === 'ocean');
  if (savedTheme === 'ocean') {
    applyCustomOceanColor(savedColor);
  } else {
    clearCustomOceanColor();
  }
}

function setupThemeSwitcher() {
  const colorInput = document.getElementById('theme-color-input');
  const oceanButton = document.querySelector('.theme-btn[data-theme="ocean"]');

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      applyTheme(theme);
    });
  });

  if (colorInput) {
    colorInput.addEventListener('input', () => {
      applyTheme('ocean');
      const color = colorInput.value;
      localStorage.setItem('site-theme-color', color);
      applyCustomOceanColor(color);
      if (oceanButton) {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        oceanButton.classList.add('active');
      }
      
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('site-theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
  const activeButton = document.querySelector(`.theme-btn[data-theme="${theme}"]`);
  if (activeButton) activeButton.classList.add('active');
  toggleOceanPicker(theme === 'ocean');
  if (theme === 'ocean') {
    const savedColor = localStorage.getItem('site-theme-color') || '#0ea5e9';
    applyCustomOceanColor(savedColor);
  } else {
    clearCustomOceanColor();
  }
}

function toggleOceanPicker(show) {
  const picker = document.getElementById('theme-color-picker-container');
  if (!picker) return;
  picker.style.display = show ? 'flex' : 'none';
}

function applyCustomOceanColor(color) {
  const root = document.documentElement;
  const bright = adjustColor(color, 25);
  const faded = `rgba(${hexToRgb(color)}, 0.18)`;
  const soft = `rgba(${hexToRgb(color)}, 0.08)`;
  const border = adjustColor(color, 35);
  const backgroundColor = adjustColor(color, 80);
  const textColors = getTextColorsForBackground(backgroundColor);

  root.style.setProperty('--primary', color);
  root.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${color}, ${bright})`);
  root.style.setProperty('--sidebar-bg', faded);
  root.style.setProperty('--card-bg', soft);
  root.style.setProperty('--border-color', border);
  root.style.setProperty('--bg-color', backgroundColor);
  root.style.setProperty('--text-main', textColors.main);
  root.style.setProperty('--text-muted', textColors.muted);
  root.style.setProperty('--input-bg', textColors.inputBg);
}

function clearCustomOceanColor() {
  const root = document.documentElement;
  root.style.removeProperty('--primary');
  root.style.removeProperty('--primary-gradient');
  root.style.removeProperty('--sidebar-bg');
  root.style.removeProperty('--card-bg');
  root.style.removeProperty('--border-color');
  root.style.removeProperty('--bg-color');
  root.style.removeProperty('--text-main');
  root.style.removeProperty('--text-muted');
  root.style.removeProperty('--input-bg');
}

function getTextColorsForBackground(bgHex) {
  const [r, g, b] = hexToRgbArray(bgHex);
  const luminance = getLuminance(r, g, b);
  const main = luminance > 0.65 ? '#0f172a' : '#f8fafc';
  const muted = luminance > 0.65 ? 'rgba(15, 23, 42, 0.72)' : 'rgba(248, 250, 252, 0.75)';
  const inputBg = luminance > 0.65 ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.86)';
  return { main, muted, inputBg };
}

function getLuminance(r, g, b) {
  const a = [r, g, b].map(v => {
    const value = v / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function hexToRgbArray(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}

function adjustColor(hex, amount) {
  const normalized = hex.replace('#', '');
  const num = parseInt(normalized, 16);
  let r = (num >> 16) + amount;
  let g = ((num >> 8) & 0x00FF) + amount;
  let b = (num & 0x0000FF) + amount;
  r = Math.max(Math.min(255, r), 0);
  g = Math.max(Math.min(255, g), 0);
  b = Math.max(Math.min(255, b), 0);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// ===== 皛曉?? (IntersectionObserver) =====
function setupScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.card').forEach(el => {
    el.classList.add('fade-in-up');
    observer.observe(el);
  });
}

// ===== ?∠?頛? =====
function animateCardsOnLoad() {
  const cards = document.querySelectorAll('.card');
  cards.forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    setTimeout(() => {
      card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, 100 + i * 150);
  });
}

// ===== ???嚗椰?渡?????喳?芷＊蝷箏???憛? =====
// ===== 動效 #1: 打字機效果 =====
function setupTypewriter() {
  const el = document.getElementById('typed-subtitle');
  if (!el) return;
  const text = el.getAttribute('data-text') || '';
  el.textContent = '';
  let index = 0;
  const speed = 55;
  function type() {
    if (index < text.length) {
      el.textContent += text.charAt(index);
      index++;
      setTimeout(type, speed);
    }
  }
  setTimeout(type, 600);
}

function setupPageNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');

  function showSection(sectionId) {
    sections.forEach(s => s.classList.remove('active'));
    const target = document.getElementById(sectionId);
    if (target) target.classList.add('active');

    navItems.forEach(item => {
      const href = item.getAttribute('href');
      item.classList.toggle('active', href === `#${sectionId}`);
    });
  }

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const href = item.getAttribute('href');
      if (href && href.startsWith('#')) {
        showSection(href.substring(1));
      }
    });
  });

  showSection('section-home');
}

// ===== ???嚗???霈? =====

async function fetchSkills() {
  const res = await fetch('/api/skills');
  const result = await res.json();
  const container = document.getElementById('skills-list');

  container.innerHTML = result.data.map(skill => `
    <div class="skill-item">
      <div class="skill-info">
        <span><strong>${skill.name}</strong> (${skill.category})</span>
        <span>${skill.level}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress" style="width: ${skill.level}%"></div>
      </div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, match => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[match]));
}

let currentMessagesData = [];
let currentContourData = [];
let selectedContourImages = new Set();
let currentCategory = 'General';
let currentThreadId = null;
const categories = ['General', 'Announcements', 'Feedback'];
const CONTOUR_RECENT_KEY = 'contourRecentlyViewed';

function setupChat() {
  const form = document.getElementById('chat-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    const chatBox = document.getElementById('chat-box');
    if (chatBox) {
      const el = document.createElement('div');
      el.className = 'chat-message user';
      el.innerHTML = `<div class="avatar">You</div><div class="msg-bubble">${escapeHtml(val)}</div>`;
      chatBox.appendChild(el);
      chatBox.scrollTop = chatBox.scrollHeight;
    }
    input.value = '';
  });
}

function setupFilters() {
  const container = document.getElementById('skills-filter');
  if (!container) return;
  container.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupThemeSwitcher();
  setupScrollAnimations();
  animateCardsOnLoad();
  setupPageNavigation();
  setupTypewriter();
  setupCardGlowTracking();
  setupCursorTrail();
  setupBackgroundParticles();

  // ???
  fetchSkills();
  fetchThreads();
  setupChat();
  setupFilters();
  setupForumSection();
  setupContourSection();
  setupContourModal();

  setupMessageStream();
});

// ===== Forum Setup =====

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
  grid.innerHTML = images.map(img => {
    const imageUrl = `/api/contour-image/${encodeURIComponent(img.filename)}`;
    return `
      <div class="contour-result-card">
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

function toggleContourSelection(filename) {
  if (!filename) return;
  if (selectedContourImages.has(filename)) {
    selectedContourImages.delete(filename);
  } else {
    selectedContourImages.add(filename);
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  const countEl = document.getElementById('contour-selected-count');
  const zipBtn = document.getElementById('btn-contour-download-zip');
  if (!countEl || !zipBtn) return;
  countEl.textContent = `${selectedContourImages.size} selected`;
  zipBtn.disabled = selectedContourImages.size === 0;
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

let contourModalKeyHandler = null;

function setupContourKeyboardNavigation() {
  const grid = document.getElementById('contour-results-grid');
  if (!grid) return;

  grid.querySelectorAll('.contour-result-card').forEach(card => {
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const downloadButton = card.querySelector('a[href][download]');
        if (downloadButton) downloadButton.click();
      }
    });
  });
}

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


function showTemporaryNotice(container, text) {
  let existing = container.querySelector('.table-notice');
  if (existing) existing.remove();
  const notice = document.createElement('div');
  notice.className = 'table-notice';
  notice.style.cssText = 'position:absolute; right:14px; top:14px; background:var(--bg-muted); color:var(--text); padding:8px 12px; border-radius:8px; box-shadow:var(--card-shadow); font-size:0.85rem; z-index:50;';
  notice.innerText = text;
  if (getComputedStyle(container).position === 'static') {
    document.body.appendChild(notice);
    notice.style.position = 'fixed';
    notice.style.right = '20px';
    notice.style.top = '90px';
  } else {
    container.appendChild(notice);
  }
  setTimeout(() => notice.remove(), 2500);
}

// ===== Data Fetching & Rendering =====
async function fetchThreads(category = '') {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  const res = await fetch(`/api/threads${query}`);
  const result = await res.json();
  currentMessagesData = result.data || [];

  renderThreadList(currentMessagesData);
  if (!currentThreadId && currentMessagesData.length) {
    loadThread(currentMessagesData[0].id);
  }
}

function setupForumSection() {
  const tabs = document.getElementById('forum-category-tabs');
  const categorySelect = document.getElementById('forum-category-select');
  const refreshBtn = document.getElementById('btn-forum-refresh');
  const threadForm = document.getElementById('forum-thread-form');

  if (tabs) {
    tabs.innerHTML = categories.map(category => `
      <button class="pill ${category === currentCategory ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
    `).join('');
    tabs.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = btn.dataset.category;
        fetchThreads(currentCategory);
      });
    });
  }

  if (categorySelect) {
    categorySelect.innerHTML = categories.map(category => `
      <option value="${escapeHtml(category)}">${escapeHtml(category)}</option>
    `).join('');
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => fetchThreads(currentCategory));
  }

  if (threadForm) {
    threadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('thread-title').value.trim();
      const category = document.getElementById('forum-category-select').value;
      const content = document.getElementById('thread-content').value.trim();
      const user_name = document.getElementById('thread-username').value.trim();

      if (!title || !content || !user_name) return;

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_name, title, category, content })
      });

      if (res.ok) {
        document.getElementById('thread-title').value = '';
        document.getElementById('thread-content').value = '';
        document.getElementById('thread-username').value = '';
        fetchThreads(currentCategory);
      }
    });
  }
}

async function setupMessageStream() {
  if (typeof EventSource === 'undefined') return;
  const source = new EventSource('/api/messages/stream');

  source.addEventListener('messages_update', async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'new_thread') {
        fetchThreads(currentCategory);
      } else if (payload.type === 'new_reply') {
        if (payload.thread_id && payload.thread_id === currentThreadId) {
          loadThread(currentThreadId);
        }
      } else if (payload.type === 'refresh') {
        fetchThreads(currentCategory);
        if (currentThreadId) loadThread(currentThreadId);
      }
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  });

  source.addEventListener('error', () => {
    console.warn('Forum SSE connection lost.');
    source.close();
  });
}

// Fallback formatter for ISO timestamps.
function formatLocalDateTime(isoString) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  return date.toLocaleString('zh-HK', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
}

function renderThreadList(threads) {
  const listEl = document.getElementById('forum-thread-list');
  if (!listEl) return;

  if (!threads.length) {
    listEl.innerHTML = '<div class="empty-state">No topics yet in this category.</div>';
    return;
  }

  listEl.innerHTML = threads.map(thread => `
    <div class="forum-thread-card" data-id="${thread.id}">
      <div class="forum-thread-title">${escapeHtml(thread.title)}</div>
      <div class="forum-thread-meta">
        <span>${escapeHtml(thread.category)}</span>
        <span>${escapeHtml(thread.user_name)}</span>
        <span>${formatLocalDateTime(thread.created_at)}</span>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.forum-thread-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      if (id) loadThread(id);
    });
  });
}

async function loadThread(id) {
  currentThreadId = parseInt(id, 10);
  const res = await fetch(`/api/threads/${encodeURIComponent(currentThreadId)}`);
  if (!res.ok) {
    console.error('Failed to load thread', res.statusText);
    return;
  }
  const result = await res.json();
  renderThreadDetail(result.thread, result.replies || []);
}

function renderThreadDetail(thread, replies) {
  const detailEl = document.getElementById('forum-thread-detail');
  if (!detailEl) return;

  detailEl.innerHTML = `
    <div class="forum-detail-header">
      <div>
        <h3>${escapeHtml(thread.title)}</h3>
        <div class="forum-thread-meta">
          <span>${escapeHtml(thread.category)}</span>
          <span>by ${escapeHtml(thread.user_name)}</span>
          <span>${formatLocalDateTime(thread.created_at)}</span>
        </div>
      </div>
    </div>
    <div class="forum-detail-body">
      <p>${escapeHtml(thread.content)}</p>
    </div>
    <div class="forum-detail-replies">
      <h4>Replies</h4>
      ${replies.length ? replies.map(reply => `
        <div class="forum-reply-card">
          <div class="forum-reply-meta">
            <strong>${escapeHtml(reply.user_name)}</strong>
            <span>${formatLocalDateTime(reply.created_at)}</span>
          </div>
          <p>${escapeHtml(reply.content)}</p>
        </div>
      `).join('') : '<div class="empty-state">No replies yet. Be the first to reply.</div>'}
    </div>
    <div class="forum-reply-form">
      <h4>Reply to this thread</h4>
      <div class="form-group">
        <input type="text" id="reply-username" placeholder="Your Name" required />
      </div>
      <div class="form-group">
        <textarea id="reply-content" placeholder="Write your reply..." required></textarea>
      </div>
      <button type="button" id="reply-submit" class="btn-primary"><i class="fa-solid fa-reply"></i> Post Reply</button>
    </div>
  `;

  const replyBtn = document.getElementById('reply-submit');
  if (replyBtn) {
    replyBtn.addEventListener('click', async () => {
      const user_name = document.getElementById('reply-username').value.trim();
      const content = document.getElementById('reply-content').value.trim();
      if (!user_name || !content) return;

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_name, content, parent_id: currentThreadId })
      });

      if (res.ok) {
        document.getElementById('reply-username').value = '';
        document.getElementById('reply-content').value = '';
        loadThread(currentThreadId);
      }
    });
  }
}



