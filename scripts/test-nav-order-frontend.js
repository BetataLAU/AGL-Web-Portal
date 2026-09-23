// ===== 側邊欄排序「前端邏輯」測試腳本 =====
// 以最小 DOM stub 實際載入 public/js/main.js，驗證 setupSidebarReorder() 的行為：
//   A. 伺服器回傳「不完整排序」時，未被列到的項目要排到最後（不再浮到最上方）
//   B. setupSidebarReorder 重複呼叫時，拖曳事件只綁定一次（避免同一次拖放被處理多次）
//   C. 拖放後立即送出 PUT，且內容包含頁面連結（uld-packing.html / packing.html）
// 用法：node scripts/test-nav-order-frontend.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const NAV_ITEM_HREFS = [
  '#section-home', '#section-chat', '#section-skills', '#section-contour',
  '#section-orders', '#section-xls-booking', '#section-palletization',
  'uld-packing.html', 'packing.html', '#section-dbviewer', 'users.html'
];

// 舊版伺服器實際存下的不完整排序（缺 uld-packing.html / packing.html）
const LEGACY_PARTIAL = [
  '#section-xls-booking', '#section-contour', '#section-chat', '#section-skills',
  '#section-orders', '#section-palletization', '#section-dbviewer', 'users.html'
];

function makeItem(href) {
  return {
    href,
    style: {},
    draggable: false,
    children: [],
    title: '',
    innerHTML: '',
    setAttribute() {},
    classList: { add() {}, remove() {}, toggle() {} },
    getAttribute(name) { return name === 'href' ? this.href : null; },
    querySelector() { return null; },
    closest(sel) { return sel === '.nav-item' ? this : null; },
    appendChild(child) { this.children.push(child); },
    getBoundingClientRect() { return { top: 0, height: 30 }; }
  };
}

function makeNav() {
  const items = NAV_ITEM_HREFS.map(makeItem);
  return {
    items,
    handlers: {},
    dataset: {},
    get lastElementChild() { return this.items[this.items.length - 1] || null; },
    querySelectorAll(sel) { return sel === '.nav-item' ? this.items.slice() : []; },
    appendChild(item) {
      const idx = this.items.indexOf(item);
      if (idx !== -1) this.items.splice(idx, 1);
      this.items.push(item);
      return item;
    },
    insertBefore(item, ref) {
      const idx = this.items.indexOf(item);
      if (idx !== -1) this.items.splice(idx, 1);
      const refIdx = ref == null ? -1 : this.items.indexOf(ref);
      this.items.splice(refIdx === -1 ? this.items.length : refIdx, 0, item);
      return item;
    },
    addEventListener(type, fn) {
      (this.handlers[type] = this.handlers[type] || []).push(fn);
    }
  };
}


const nav = makeNav();
const store = {};
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    querySelector: sel => (sel === '.sidebar-nav' ? nav : null),
    createElement: tag => makeItem('#' + tag),
    addEventListener() {},
    querySelectorAll() { return []; }
  },
  window: {}
};

const calls = [];
sandbox.fetch = (url, opts = {}) => {
  const method = opts.method || 'GET';
  calls.push({ url, method, body: opts.body });
  if (method === 'GET') {
    return Promise.resolve({ ok: true, json: async () => ({ order: LEGACY_PARTIAL }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
};
sandbox.window.fetch = sandbox.fetch;

// 以 sandbox 為全域載入真正的前端程式碼
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'main.js'), 'utf8'), sandbox);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const orderOf = () => nav.items.map(i => i.href);
let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' ' + detail : ''}`);
}


(async () => {
  console.log('===== 側邊欄排序前端邏輯測試（main.js）=====\n');

  // --- A. 不完整排序：未被列到的項目要排到最後 ---
  sandbox.setupSidebarReorder();
  await sleep(20);
  const orderA = orderOf();
  console.log(`A. DOM 順序：${JSON.stringify(orderA)}`);
  check('A1 HOME 仍是最上方', orderA[0] === '#section-home');
  check('A2 未被列到的項目排在最後',
    JSON.stringify(orderA.slice(-2).slice().sort()) === JSON.stringify(['packing.html', 'uld-packing.html']),
    `→ 尾兩項 ${JSON.stringify(orderA.slice(-2))}`);
  check('A3 已列出的項目維持伺服器順序',
    JSON.stringify(orderA.slice(1, 9)) === JSON.stringify(LEGACY_PARTIAL));

  // --- B. 重複呼叫：事件只綁一次 ---
  sandbox.setupSidebarReorder();
  await sleep(20);
  check('B1 呼叫兩次後 drop 只綁 1 個 handler', (nav.handlers.drop || []).length === 1, `(實際 ${(nav.handlers.drop || []).length})`);
  check('B2 dragstart 只綁 1 個 handler', (nav.handlers.dragstart || []).length === 1, `(實際 ${(nav.handlers.dragstart || []).length})`);

  // --- C. 拖放後立即寫入的排序要包含頁面連結 ---
  const itemByHref = href => nav.items.find(i => i.href === href);
  nav.handlers.dragstart[0]({
    target: itemByHref('packing.html'), preventDefault() {}, dataTransfer: { setData() {}, effectAllowed: null }
  });
  nav.handlers.drop[0]({
    target: itemByHref('#section-chat'), clientY: 5, preventDefault() {}
  });
  await sleep(50); // 立即送出 PUT，不需等待 debounce

  const putCall = [...calls].reverse().find(c => c.method === 'PUT');
  const putBody = putCall ? JSON.parse(putCall.body).order : [];
  console.log(`C. PUT 內容：${JSON.stringify(putBody)}`);
  check('C1 已立即送出 PUT 到 /api/auth/me/nav-order', !!putCall && putCall.url === '/api/auth/me/nav-order');
  check('C2 PUT 包含 packing.html', putBody.includes('packing.html'));
  check('C3 PUT 包含 uld-packing.html', putBody.includes('uld-packing.html'));
  check('C4 PUT 包含全部 10 個目錄項目（不含 HOME）', putBody.length === 10, `(實際 ${putBody.length} 項)`);
  const dragIdx = putBody.indexOf('packing.html');
  check('C5 拖到 #section-chat 上方後順序正確',
    dragIdx !== -1 && putBody[dragIdx + 1] === '#section-chat',
    `(packing.html 位置 ${dragIdx}，其後為 ${putBody[dragIdx + 1]})`);
  check('C6 拖放後 localStorage 已同步',
    JSON.parse(store['sidebar-nav-order'] || '[]').join() === putBody.join());
  check('C7 一次拖放只送出 1 次 PUT', calls.filter(c => c.method === 'PUT').length === 1,
    `(實際 ${calls.filter(c => c.method === 'PUT').length} 次)`);

  console.log(`\n===== ${failed === 0 ? '全部通過' : failed + ' 項失敗'} =====`);
  process.exitCode = failed === 0 ? 0 : 1;
})();
