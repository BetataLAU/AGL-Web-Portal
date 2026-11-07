// ===== 頂部工作列（Topbar）=====
// 目的：把原本常駐左側的 Sidebar 改成「從工作列往下展開的抽屜」，主內容因此吃滿整個寬度。
// 行為（對應 public/css/topbar.css）：
//   1. 最左邊 ☰ 點一下 → 目錄（.sidebar）以動畫往下展開；再點一下收起
//   2. 游標離開抽屜範圍 → 自動往回收（延遲 260ms，避免滑鼠移動路徑中誤關）
//   3. ESC／點擊抽屜外／點目錄項目 → 收起（拖曳排序時不收起）
//   4. 搜尋框：輸入關鍵字即時過濾目錄並展開抽屜（搜尋中不自動收起）
//   5. 右側工具：主題切換、全螢幕、回到頁頂、香港時間（HKT）
// 依賴：theme.js 的 applyTheme()（缺少時直接改 data-theme）；捲動容器沿用 .app-layout。

(function () {
  'use strict';

  const CLOSE_DELAY = 260; // 游標離開抽屜後延遲收合（ms）
  const THEMES = ['light', 'dark', 'ocean'];
  const THEME_ICONS = { light: 'fa-sun', dark: 'fa-moon', ocean: 'fa-water' };
  const THEME_LABELS = { light: '淺色', dark: '深色', ocean: '海洋' };

  let sidebar = null;
  let menuBtn = null;
  let scrim = null;
  let searchInput = null;
  let closeTimer = null;
  let draggingNav = false;

  function byId(id) { return document.getElementById(id); }
  function isOpen() { return !!(sidebar && sidebar.classList.contains('is-open')); }

  function cancelScheduledClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  // ---------- 抽屜開關 ----------
  function setOpen(open) {
    if (!sidebar) return;
    cancelScheduledClose();
    sidebar.classList.toggle('is-open', open);

    if (scrim) {
      scrim.classList.toggle('is-open', open);
    }

    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      const icon = menuBtn.querySelector('i');
      if (icon) icon.className = open ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
    }

    document.body.classList.toggle('topbar-nav-open', open);

    if (!open) {
      clearNavFilter();
      if (searchInput) searchInput.value = '';
    }
  }

  function toggleNav() { setOpen(!isOpen()); }

  // 游標離開抽屜 → 自動收合；搜尋中或游標又回到抽屜內則取消
  function scheduleClose() {
    cancelScheduledClose();
    closeTimer = setTimeout(function () {
      closeTimer = null;
      if (sidebar && sidebar.matches(':hover')) return;
      if (searchInput && searchInput.value.trim()) return;
      setOpen(false);
    }, CLOSE_DELAY);
  }

  // ---------- 目錄搜尋過濾 ----------
  function clearNavFilter() {
    if (!sidebar) return;
    sidebar.querySelectorAll('.nav-item.nav-filtered-out').forEach(function (item) {
      item.classList.remove('nav-filtered-out');
    });
    const empty = byId('nav-empty');
    if (empty) empty.classList.remove('is-visible');
  }

  // 回傳符合的項目數；query 為空字串時恢復全部
  function applyNavFilter(query) {
    if (!sidebar) return 0;
    const q = String(query || '').trim().toLowerCase();
    let visible = 0;
    sidebar.querySelectorAll('.nav-item').forEach(function (item) {
      if (item.style.display === 'none') return; // 無權限而隱藏的項目維持隱藏
      const text = (item.textContent || '').toLowerCase();
      const match = !q || text.indexOf(q) !== -1;
      item.classList.toggle('nav-filtered-out', !match);
      if (match) visible += 1;
    });
    const empty = byId('nav-empty');
    if (empty) empty.classList.toggle('is-visible', visible === 0);
    return visible;
  }

  // ---------- 目前位置（breadcrumb） ----------
  function navLabelOf(item) {
    if (!item) return '';
    const span = item.querySelector('span:not(.nav-badge)');
    const text = (span ? span.textContent : item.textContent) || '';
    return text.replace(/\s+/g, ' ').trim();
  }

  // 由 main.js 的 showSection() 呼叫（切換區塊時同步工作列上的位置顯示）
  window.topbarSetSection = function (sectionId) {
    const el = byId('topbar-crumb-text');
    if (!el || !sectionId || !sidebar) return;
    const item = sidebar.querySelector('.nav-item[href="#' + sectionId + '"]');
    const label = navLabelOf(item);
    if (!label) return;
    el.textContent = label;
    el.title = label;
  };

  // ---------- 綁定：☰ 按鈕 + 游標離開自動收起 ----------
  function setupMenuToggle() {
    if (menuBtn) {
      menuBtn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleNav();
      });
      // 點開後若游標直接離開按鈕（沒有進入抽屜）也要收合
      menuBtn.addEventListener('mouseleave', function () {
        if (isOpen()) scheduleClose();
      });
    }

    sidebar.addEventListener('mouseenter', cancelScheduledClose);
    sidebar.addEventListener('mouseleave', function () {
      if (isOpen()) scheduleClose();
    });

    // 拖曳排序時不要把抽屜收起來
    sidebar.addEventListener('dragstart', function () { draggingNav = true; });
    sidebar.addEventListener('dragend', function () {
      setTimeout(function () { draggingNav = false; }, 120);
    });
  }

  // ---------- 綁定：點目錄項目 / 抽屜外 / ESC 收起 ----------
  function setupDismiss() {
    sidebar.addEventListener('click', function (e) {
      if (draggingNav) return;
      if (e.target.closest('.nav-drag-handle')) return; // 拖曳把手不是「選擇目錄」
      if (!e.target.closest('.nav-item')) return;       // 主題切換 / 登入卡的按鈕不收合
      setOpen(false);
    });

    if (scrim) {
      scrim.addEventListener('click', function () { setOpen(false); });
    }

    document.addEventListener('pointerdown', function (e) {
      if (!isOpen()) return;
      const t = e.target;
      if (sidebar.contains(t)) return;
      if (menuBtn && menuBtn.contains(t)) return;
      if (searchInput && searchInput.contains(t)) return;
      setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
      const key = e.key || '';
      if (key === 'Escape' && isOpen()) {
        setOpen(false);
        if (menuBtn) menuBtn.focus({ preventScroll: true });
        return;
      }
      // Alt+M：開關目錄；Ctrl/Cmd+K：跳到搜尋框
      if (e.altKey && (key === 'm' || key === 'M')) {
        e.preventDefault();
        toggleNav();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (key === 'k' || key === 'K')) {
        if (!searchInput) return;
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });
  }

  // ---------- 綁定：搜尋過濾目錄 ----------
  function setupSearch() {
    if (!searchInput) return;

    searchInput.addEventListener('input', function () {
      const q = searchInput.value.trim();
      if (!q) {
        clearNavFilter();
        return;
      }
      setOpen(true);       // 一邊打字一邊展開目錄
      cancelScheduledClose();
      applyNavFilter(q);
    });

    searchInput.addEventListener('focus', function () {
      if (searchInput.value.trim()) setOpen(true);
    });

    // 按 Enter 直接跳到第一個符合的項目
    searchInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = sidebar.querySelector('.nav-item:not(.nav-filtered-out)');
      if (!first) return;
      if (first.style.display === 'none') return;
      setOpen(false);
      first.click();
    });
  }

  // ---------- 綁定：品牌（回首頁） ----------
  function setupBrand() {
    const brand = byId('topbar-brand');
    if (!brand) return;
    brand.addEventListener('click', function (e) {
      const href = brand.getAttribute('href') || '';
      if (href.charAt(0) !== '#') return; // 跨頁連結（如 index.html）交給瀏覽器
      e.preventDefault();
      const home = sidebar.querySelector('.nav-item[href="#section-home"]');
      if (home) {
        setOpen(false);
        home.click();
      } else {
        window.location.hash = href;
      }
    });
  }

  // ---------- 右側工具：主題切換 ----------
  function syncThemeButton() {
    const btn = byId('topbar-theme-btn');
    if (!btn) return;
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'fa-solid ' + (THEME_ICONS[theme] || 'fa-circle-half-stroke');
    const label = '切換主題（目前：' + (THEME_LABELS[theme] || theme) + '）';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  function setupTheme() {
    const btn = byId('topbar-theme-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
        if (typeof window.applyTheme === 'function') {
          window.applyTheme(next);
        } else {
          // 沒有 theme.js 的頁面（例如 sli-eli-layout.html）：直接切換並記住選擇
          document.documentElement.setAttribute('data-theme', next);
          try { localStorage.setItem('site-theme', next); } catch (err) { /* ignore */ }
        }
        syncThemeButton();
      });
    }
    // 目錄裡的主題按鈕（theme.js）改主題時，工作列圖示也跟著更新
    document.addEventListener('click', function (e) {
      if (e.target.closest('.theme-btn')) setTimeout(syncThemeButton, 0);
    });
    applySavedTheme();
    syncThemeButton();
    setTimeout(syncThemeButton, 0); // theme.js initTheme() 可能晚於此處執行
  }

  // 頁面沒有 theme.js 時（例如 sli-eli-layout.html），仍套用上次選的主題
  function applySavedTheme() {
    if (typeof window.initTheme === 'function') return;
    let saved = null;
    try { saved = localStorage.getItem('site-theme'); } catch (err) { /* ignore */ }
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }

  // ---------- 右側工具：全螢幕 ----------
  function setupFullscreen() {
    const btn = byId('topbar-fullscreen-btn');
    if (!btn) return;
    if (!document.documentElement.requestFullscreen) {
      btn.style.display = 'none';
      return;
    }
    const sync = function () {
      const on = !!document.fullscreenElement;
      const icon = btn.querySelector('i');
      if (icon) icon.className = on ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
      const label = on ? '結束全螢幕' : '全螢幕';
      btn.title = label;
      btn.setAttribute('aria-label', label);
    };
    btn.addEventListener('click', function () {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
      } else {
        document.documentElement.requestFullscreen().catch(function () {});
      }
    });
    document.addEventListener('fullscreenchange', sync);
    sync();
  }

  // ---------- 右側工具：回到頁頂 + 捲動陰影 ----------
  function setupScrollTools() {
    const topbar = byId('topbar');
    const layout = document.querySelector('.app-layout');
    const topBtn = byId('topbar-top-btn');

    // 桌面版實際捲動容器是 .app-layout（height:100vh; overflow-y:auto）；手機版可能是視窗
    const isLayoutScroller = function () {
      return !!(layout && layout.scrollHeight > layout.clientHeight + 4);
    };

    const scrollTop = function () {
      if (isLayoutScroller()) return layout.scrollTop;
      return window.pageYOffset || document.documentElement.scrollTop || 0;
    };

    const update = function () {
      if (topbar) topbar.classList.toggle('is-scrolled', scrollTop() > 8);
    };

    if (layout) {
      layout.addEventListener('scroll', function () { requestAnimationFrame(update); }, { passive: true });
    }
    window.addEventListener('scroll', function () { requestAnimationFrame(update); }, { passive: true });

    if (topBtn) {
      topBtn.addEventListener('click', function () {
        if (isLayoutScroller()) layout.scrollTo({ top: 0, behavior: 'smooth' });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    update();
  }

  // ---------- 右側工具：香港時間（HKT） ----------
  function setupClock() {
    const el = byId('topbar-clock');
    if (!el) return;
    const render = function () {
      let text;
      try {
        text = new Date().toLocaleTimeString('zh-HK', {
          timeZone: 'Asia/Hong_Kong', hour12: false, hour: '2-digit', minute: '2-digit'
        });
      } catch (err) {
        text = new Date().toLocaleTimeString('zh-HK', { hour12: false });
      }
      el.textContent = text;
      el.title = '香港時間 ' + text + '（HKT）';
    };
    render();
    setInterval(render, 20000); // 每 20 秒對時一次（分鐘顯示足夠）
  }

  // ---------- 入口 ----------
  function setupTopbar() {
    sidebar = byId('app-sidebar');
    menuBtn = byId('topbar-menu-btn');
    if (!byId('topbar') || !sidebar) return; // 此頁沒有工作列（例如 users.html）
    scrim = byId('topbar-scrim');
    searchInput = byId('topbar-search-input');

    setupMenuToggle();
    setupDismiss();
    setupSearch();
    setupBrand();
    setupTheme();
    setupFullscreen();
    setupScrollTools();
    setupClock();

    // 初始位置顯示 = 目前 active 的目錄項目
    const active = sidebar.querySelector('.nav-item.active');
    if (active) {
      const el = byId('topbar-crumb-text');
      const label = navLabelOf(active);
      if (el && label) {
        el.textContent = label;
        el.title = label;
      }
    }
  }

  window.setupTopbar = setupTopbar;
  document.addEventListener('DOMContentLoaded', setupTopbar);
})();
