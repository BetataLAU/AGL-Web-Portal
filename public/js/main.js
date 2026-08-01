// ===== 共用工具 =====
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, match => ({
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
      e.preventDefault();
      const href = item.getAttribute('href');
      if (href && href.startsWith('#')) {
        showSection(href.substring(1));
      }
    });
  });

  showSection('section-home');
}

// ===== 入口 =====
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
  setupScrollProgressBar();

  // 各功能頁
  fetchSkills();
  fetchThreads();
  setupChat();
  setupFilters();
  setupForumSection();
  setupContourSection();
  setupContourModal();
  setupOrdersSection();

  setupMessageStream();
});