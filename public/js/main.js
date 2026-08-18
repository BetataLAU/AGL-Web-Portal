// ===== 共用工具 =====
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, match => ({
    '\x26': '\x26amp;', '\x3C': '\x26lt;', '\x3E': '\x26gt;', '\x22': '\x26quot;', "'": '\x26#39;'
  }[match]));
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

// ===== HOME AGL 背景圖：讀取實際比例，設定容器 aspect-ratio =====
// 讓容器高度跟隨圖片比例自動縮放：視窗拉窄 → 容器等比變矮 → 圖片填滿無留白
function setupAgdBgRatio() {
  const img = new Image();
  img.onload = () => {
    const ratio = (img.naturalWidth / img.naturalHeight).toFixed(4);
    try {
      document.documentElement.style.setProperty('--agl-bg-ratio', ratio);
    } catch (e) { /* ignore */ }
  };
  img.onerror = () => { /* 讀取失敗時使用預設比例 */ };
  img.src = 'image/AGL bg.jfif';
}

// ===== 頁面導航與區塊切換（含動效 #10 轉場） =====
function setupPageNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');

  function showSection(sectionId) {
    sections.forEach(s => s.classList.remove('active'));
    const target = document.getElementById(sectionId);
    if (target) {
      target.classList.remove('section-enter');
      void target.offsetWidth; // 強制 reflow，重新觸發轉場動畫
      target.classList.add('active');
      target.classList.add('section-enter');
    }

    navItems.forEach(item => {
      const href = item.getAttribute('href');
      item.classList.toggle('active', href === `#${sectionId}`);
    });
  }

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const href = item.getAttribute('href');
      if (href && href.startsWith('#')) {
        e.preventDefault();
        showSection(href.substring(1));
      }
      // href 非 # 開頭（如 users.html / login.html）→ 不攔截，讓瀏覽器正常跳轉
    });
  });

  showSection('section-home');
}

// ===== Sidebar 導航排序（HOME 固定不動，可拖曳調整順序） =====
// 依 localStorage 記憶排序；可重複呼叫（會清除舊把手再重建，事件用委派不重複）
function setupSidebarReorder() {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;

  const SORT_KEY = 'sidebar-nav-order';
  const HOME_HREF = '#section-home';

  function getVisibleItems() {
    return [...nav.querySelectorAll('.nav-item')]
      .filter(item => item.getAttribute('href') !== HOME_HREF && item.style.display !== 'none');
  }

  function getItemKey(item) { return item.getAttribute('href'); }

  // ===== 清除舊把手 + 重設 draggable（防重複呼叫） =====
  nav.querySelectorAll('.nav-drag-handle').forEach(btn => btn.remove());
  getVisibleItems().forEach(item => { item.draggable = true; });

  // ===== 加入拖曳把手（包裝在右側容器，避免與 lock icon 排列衝突） =====
  getVisibleItems().forEach(item => {
    const wrap = document.createElement('span');
    wrap.className = 'nav-right-wrap';

    const lockIcon = item.querySelector('.nav-lock-icon');
    if (lockIcon) wrap.appendChild(lockIcon);

    const handleBtn = document.createElement('button');
    handleBtn.type = 'button';
    handleBtn.className = 'nav-drag-handle';
    handleBtn.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
    handleBtn.title = '拖曳調整位置';
    handleBtn.setAttribute('aria-label', '拖曳調整位置');

    wrap.appendChild(handleBtn);
    item.appendChild(wrap);
  });

  // ===== 依 localStorage 儲存順序重排 =====
  function loadSavedOrder() {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_KEY) || '[]');
      if (!Array.isArray(saved)) return [];
      const visibleKeys = new Set(getVisibleItems().map(getItemKey));
      return saved.filter(key => visibleKeys.has(key));
    } catch { return []; }
  }

  // 套用排序（依指定順序重排項目，HOME 不動）
  function applyOrder(order) {
    const itemsByKey = new Map(getVisibleItems().map(i => [getItemKey(i), i]));
    order.forEach(key => {
      const item = itemsByKey.get(key);
      if (item && item !== nav.lastElementChild) nav.appendChild(item);
    });
  }

  // 儲存排序：寫入 localStorage（立即生效）+ 伺服器（換瀏覽器/重啟仍保留）
  function saveOrder() {
    const order = getVisibleItems().map(getItemKey);
    localStorage.setItem(SORT_KEY, JSON.stringify(order));
    // 伺服器端持久化（僅已登入時可寫入；未登入時 fire-and-forget，失敗不影響本地）
    try {
      fetch('/api/auth/me/nav-order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
        cache: 'no-store'
      }).catch(() => { /* 未登入或失敗時保留 localStorage */ });
    } catch (e) { /* ignore */ }
  }

  // 從伺服器讀取排序（登入後才有效；優先於 localStorage，確保跨裝置一致）
  function loadServerOrder() {
    fetch('/api/auth/me/nav-order', { cache: 'no-store' })
      .then(res => { if (!res.ok) return null; return res.json(); })
      .then(data => {
        if (!data || !Array.isArray(data.order)) return;
        // 只取目前可見的項目（排除已被隱藏/刪除的）
        const visibleKeys = new Set(getVisibleItems().map(getItemKey));
        const validOrder = data.order.filter(key => visibleKeys.has(key));
        if (validOrder.length > 0) {
          applyOrder(validOrder);
          try { localStorage.setItem(SORT_KEY, JSON.stringify(validOrder)); } catch (e) { /* ignore */ }
        }
      })
      .catch(() => { /* 伺服器錯誤時保留 localStorage */ });
  }

  const order = loadSavedOrder();
  if (order.length > 0) {
    applyOrder(order);
  }
  // 非同步：從伺服器讀取最新排序（若與本地不同會覆蓋）
  loadServerOrder();

  // ===== 拖曳排序（整個項目都可拖，把手為視覺提示） =====
  let draggingItem = null;

  function resetDrag() {
    if (draggingItem) draggingItem.classList.remove('dragging');
    draggingItem = null;
    nav.querySelectorAll('.nav-item').forEach(i => i.classList.remove('drag-over-top', 'drag-over-bottom'));
  }

  nav.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item || item.getAttribute('href') === HOME_HREF) {
      e.preventDefault();
      return;
    }
    draggingItem = item;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', getItemKey(item));
  });

  nav.addEventListener('dragend', resetDrag);

  nav.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggingItem) return;
    const item = e.target.closest('.nav-item');
    if (!item || item === draggingItem || item.getAttribute('href') === HOME_HREF) return;
    const rect = item.getBoundingClientRect();
    const after = (e.clientY - rect.top) > rect.height / 2;
    item.classList.toggle('drag-over-bottom', after);
    item.classList.toggle('drag-over-top', !after);
  });

  nav.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.nav-item');
    if (item) item.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  nav.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggingItem) return;
    const target = e.target.closest('.nav-item');
    if (!target || target === draggingItem || target.getAttribute('href') === HOME_HREF) {
      resetDrag();
      return;
    }
    const rect = target.getBoundingClientRect();
    const after = (e.clientY - rect.top) > rect.height / 2;
    if (after) {
      nav.insertBefore(draggingItem, target.nextElementSibling);
    } else {
      nav.insertBefore(draggingItem, target);
    }
    resetDrag();
    saveOrder();
  });
}

// 供 auth.js 登入後重新整理（nav-users 顯示時需要補上把手）
window.setupSidebarReorder = setupSidebarReorder;

// ===== 受保護區塊初始化（訂單系統 / 資料庫檢視器 / 打板計劃） =====
// 僅在「已登入」時由 auth.js 呼叫（user 為登入者資訊）：
// - 未登入時不初始化 → 不會發出受保護 API 請求 → 公開頁面（HOME/AI/Capabilities/Contour）仍可正常瀏覽
// - 若直接呼叫會觸發 apiFetch 401 自動跳轉登入頁
// - 打板計劃僅限 admin / staff，其餘角色不初始化
window.initProtectedSections = function (user) {
  if (typeof setupOrdersSection === 'function') setupOrdersSection();
  if (typeof setupDbViewerSection === 'function') setupDbViewerSection();
  if (typeof setupXlsBookingSection === 'function') setupXlsBookingSection();
  const role = user && user.role;
  if ((role === 'admin' || role === 'staff') && typeof setupPalletSection === 'function') {
    setupPalletSection();
  }
};

// ===== 入口 =====
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupThemeSwitcher();
  setupAgdBgRatio();
  setupScrollAnimations();
  animateCardsOnLoad();
  setupPageNavigation();
  setupSidebarReorder();
  setupTypewriter();
  setupCardGlowTracking();
  setupCursorTrail();
  setupBackgroundParticles();
  setupScrollProgressBar();

  // 公開功能頁（不需登入）
  fetchSkills();
  setupChat();
  setupFilters();
  setupContourSection();
  setupContourModal();

  // 受保護區塊（訂單/資料庫）由 auth.js 視登入狀態延後初始化
});