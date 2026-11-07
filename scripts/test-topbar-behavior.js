// ===== 頂部工作列（Topbar）行為測試（最小 DOM stub，免瀏覽器）=====
// 以 vm sandbox 載入 public/js/topbar.js，驗證：
//   A. ☰ 點一下 → 抽屜 .is-open（CSS 動畫）＋ aria-expanded ＋ body.topbar-nav-open
//   B. 游標離開抽屜 → 延遲後自動收合；游標回到抽屜 → 取消收合
//   C. ESC / 點擊抽屜外 → 收合
//   D. 搜尋框輸入 → 展開抽屜並過濾目錄（無權限隱藏的項目不受影響）
//   E. topbarSetSection() 同步「目前位置」；主題切換循環 light→dark→ocean
// 用法：node scripts/test-topbar-behavior.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLOSE_DELAY_GUESS = 400; // 大於 topbar.js 的 260ms 延遲

function makeClassList() {
  const set = new Set();
  return {
    add(...names) { names.forEach(n => set.add(n)); },
    remove(...names) { names.forEach(n => set.delete(n)); },
    contains(name) { return set.has(name); },
    toggle(name, force) {
      const on = force === undefined ? !set.has(name) : !!force;
      if (on) set.add(name); else set.delete(name);
      return on;
    },
    get value() { return [...set].join(' '); }
  };
}

function makeEl(id) {
  return {
    id,
    style: {},
    classList: makeClassList(),
    handlers: {},
    attrs: {},
    children: {},
    textContent: '',
    title: '',
    value: '',
    clicks: 0,
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    dispatch(type, ev) { (this.handlers[type] || []).forEach(fn => fn(ev || { preventDefault() {} })); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    focus() {},
    select() {},
    click() { this.clicks += 1; },
    contains() { return false; },
    querySelector(sel) { return this.children[sel] || null; },
    querySelectorAll() { return []; }
  };
}

// ---------- 目錄項目 ----------
function makeNavItem(href, label, opts = {}) {
  return {
    href,
    label,
    style: { display: opts.hidden ? 'none' : '' },
    classList: makeClassList(),
    handlers: {},
    get textContent() { return label; },
    getAttribute(name) { return name === 'href' ? href : null; },
    querySelector(sel) { return sel.indexOf('span') === 0 ? { textContent: label } : null; },
    addEventListener() {},
    click() { clicks.push(href); }
  };
}

const clicks = [];
const navItems = [
  makeNavItem('#section-home', 'HOME'),
  makeNavItem('#section-chat', 'AI Playground'),
  makeNavItem('#section-orders', '訂單系統'),
  makeNavItem('#section-xls-booking', 'Shipper Role Project'),
  makeNavItem('#section-uld-weight', 'ULD 夾重系統'),
  makeNavItem('users.html', '使用者管理', { hidden: true })
];

let sidebarHover = false;

function makeSidebar() {
  const el = makeEl('app-sidebar');
  el.matches = (sel) => (sel === ':hover' ? sidebarHover : false);
  el.contains = (target) => target === el || navItems.indexOf(target) !== -1 || !!target.inSidebar;
  el.querySelectorAll = (sel) => {
    if (sel === '.nav-item') return navItems.slice();
    if (sel === '.nav-item.nav-filtered-out') return navItems.filter(i => i.classList.contains('nav-filtered-out'));
    return [];
  };
  el.querySelector = (sel) => {
    if (sel === '.nav-item.active') return navItems.find(i => i.classList.contains('active')) || null;
    if (sel === '.nav-item:not(.nav-filtered-out)') return navItems.find(i => !i.classList.contains('nav-filtered-out')) || null;
    const m = sel.match(/^\.nav-item\[href="#(.+)"\]$/);
    if (m) return navItems.find(i => i.href === '#' + m[1]) || null;
    return null;
  };
  return el;
}

// ---------- DOM 組裝 ----------
const sidebar = makeSidebar();
const menuBtn = makeEl('topbar-menu-btn');
menuBtn.children['i'] = { className: 'fa-solid fa-bars' };
const scrim = makeEl('topbar-scrim');
const crumb = makeEl('topbar-crumb-text');
const searchInput = makeEl('topbar-search-input');
const navEmpty = makeEl('nav-empty');
const brand = makeEl('topbar-brand');
brand.attrs.href = '#section-home';
const themeBtn = makeEl('topbar-theme-btn');
themeBtn.children['i'] = { className: 'fa-solid fa-sun' };
const fullscreenBtn = makeEl('topbar-fullscreen-btn');
fullscreenBtn.children['i'] = { className: 'fa-solid fa-expand' };
const topBtn = makeEl('topbar-top-btn');
const clock = makeEl('topbar-clock');

const topbarEl = makeEl('topbar');
const appLayout = {
  scrollTop: 0, scrollHeight: 100, clientHeight: 100,
  addEventListener() {},
  scrollTo() {}
};

const els = {
  topbar: topbarEl,
  'app-sidebar': sidebar,
  'topbar-menu-btn': menuBtn,
  'topbar-scrim': scrim,
  'topbar-crumb-text': crumb,
  'topbar-search-input': searchInput,
  'nav-empty': navEmpty,
  'topbar-brand': brand,
  'topbar-theme-btn': themeBtn,
  'topbar-fullscreen-btn': fullscreenBtn,
  'topbar-top-btn': topBtn,
  'topbar-clock': clock
};

// 目錄項目都算「在抽屜內」（closest('.nav-item') 也在 stub 內處理）
navItems.forEach(item => {
  item.closest = (sel) => (sel === '.nav-item' ? item : null);
  item.inSidebar = true;
});

const docHandlers = {};
const documentElement = {
  attrs: { 'data-theme': 'light' },
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
  setAttribute(k, v) { this.attrs[k] = String(v); }
};

const store = {};
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    documentElement,
    body: { classList: makeClassList() },
    addEventListener(type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); },
    getElementById: (id) => els[id] || null,
    querySelector: (sel) => (sel === '.app-layout' ? appLayout : null),
    querySelectorAll: () => []
  },
  window: {
    pageYOffset: 0,
    addEventListener() {},
    scrollTo() {}
  }
};

sandbox.window.document = sandbox.document;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'topbar.js'), 'utf8'), sandbox);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' ' + detail : ''}`);
}
const fireDoc = (type, ev) => (docHandlers[type] || []).forEach(fn => fn(ev));
const isOpen = () => sidebar.classList.contains('is-open');
const openByClick = () => {
  if (!isOpen()) menuBtn.dispatch('click', { preventDefault() {} });
};

(async () => {
  console.log('===== 頂部工作列行為測試（topbar.js）=====\n');

  sandbox.window.setupTopbar();
  await sleep(10);

  // --- A. ☰ 展開 ---
  menuBtn.dispatch('click', { preventDefault() {} });
  check('A1 點 ☰ 後抽屜展開（.is-open）', isOpen());
  check('A2 aria-expanded=true', menuBtn.attrs['aria-expanded'] === 'true', `(實際 ${menuBtn.attrs['aria-expanded']})`);
  check('A3 ☰ 圖示換成 xmark', menuBtn.children['i'].className.indexOf('fa-xmark') !== -1, menuBtn.children['i'].className);
  check('A4 body 加上 topbar-nav-open（工作列轉不透明）', sandbox.document.body.classList.contains('topbar-nav-open'));
  check('A5 遮罩同步顯示', scrim.classList.contains('is-open'));

  // --- B. 游標離開自動收合 ---
  sidebarHover = false;
  sidebar.dispatch('mouseleave');
  await sleep(CLOSE_DELAY_GUESS);
  check('B1 游標離開抽屜 → 自動收合', !isOpen());

  openByClick();
  sidebarHover = true;
  sidebar.dispatch('mouseleave');
  await sleep(CLOSE_DELAY_GUESS);
  check('B2 游標仍在抽屜內（:hover）→ 不收合', isOpen());

  sidebarHover = false;
  sidebar.dispatch('mouseleave');
  sidebar.dispatch('mouseenter'); // 立刻又移回來
  await sleep(CLOSE_DELAY_GUESS);
  check('B3 游標移回抽屜 → 取消已排定的收合', isOpen());

  // --- C. ESC / 點擊抽屜外 ---
  fireDoc('keydown', { key: 'Escape' });
  check('C1 ESC 收合抽屜', !isOpen());

  openByClick();
  fireDoc('pointerdown', { target: { outside: true } });
  check('C2 點擊抽屜外收合', !isOpen());

  openByClick();
  fireDoc('pointerdown', { target: navItems[1] }); // 抽屜內 → 不收合
  check('C3 點擊抽屜內不會收合', isOpen());

  // --- D. 搜尋過濾 ---
  searchInput.value = '訂單';
  searchInput.dispatch('input');
  check('D1 輸入關鍵字 → 抽屜展開', isOpen());
  const orders = navItems.find(i => i.href === '#section-orders');
  const home = navItems.find(i => i.href === '#section-home');
  const hiddenUsers = navItems.find(i => i.href === 'users.html');
  check('D2 符合的項目保留', !orders.classList.contains('nav-filtered-out'));
  check('D3 不符合的項目被過濾', home.classList.contains('nav-filtered-out'));
  check('D4 無權限（display:none）的項目不被標記過濾', !hiddenUsers.classList.contains('nav-filtered-out'));

  const beforeEnter = clicks.length;
  searchInput.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  check('D5 Enter 跳到第一個符合項目並收合',
    !isOpen() && clicks.slice(beforeEnter).indexOf('#section-orders') !== -1,
    `(clicks=${clicks.slice(beforeEnter).join(',')})`);
  check('D6 收合後清除搜尋字與過濾狀態',
    searchInput.value === '' && !home.classList.contains('nav-filtered-out'));

  // --- E. 目前位置 / 主題 / 時鐘 ---
  sandbox.window.topbarSetSection('section-orders');
  check('E1 topbarSetSection 更新「目前位置」', crumb.textContent === '訂單系統', `(實際 ${crumb.textContent})`);

  themeBtn.dispatch('click');
  check('E2 主題循環 light→dark', documentElement.getAttribute('data-theme') === 'dark');
  check('E3 主題選擇寫入 localStorage', store['site-theme'] === 'dark', `(實際 ${store['site-theme']})`);
  themeBtn.dispatch('click');
  check('E4 主題循環 dark→ocean', documentElement.getAttribute('data-theme') === 'ocean');
  themeBtn.dispatch('click');
  check('E5 主題循環 ocean→light', documentElement.getAttribute('data-theme') === 'light');

  check('E6 時鐘顯示 HH:MM（HKT）', /^\d{2}:\d{2}$/.test(clock.textContent), `(實際 ${clock.textContent})`);

  // --- F. 品牌回首頁 ---
  brand.dispatch('click', { preventDefault() {} });
  check('F1 點品牌回到 HOME 目錄項目', clicks[clicks.length - 1] === '#section-home', `(實際 ${clicks[clicks.length - 1]})`);

  console.log(`\n===== ${failed === 0 ? '全部通過' : failed + ' 項失敗'} =====`);
  process.exitCode = failed === 0 ? 0 : 1;
})();
