// ===== 側邊欄「主 / 子功能層級」驗證（純靜態檢查，免伺服器）=====
// 背景：主功能（Shipper Role Project）與子功能（SLI/ELI 版面編輯器）原本在側邊欄看起來一樣大，
//       看不出隸屬關係。改以「子項縮排＋樹狀連接線＋子功能標籤」呈現（public/css/layout.css 的
//       .nav-parent / .nav-child），且子項必須緊跟在主項之後（否則縮排層級看起來會相反）。
// 驗收項目：
//   A. public/index.html：正確標記 + 子項緊跟在主項之後
//   B. public/sli-eli-layout.html（子功能自己的頁面）：同樣的父子標記 + 頁首標籤
//   C. public/css/layout.css：層級樣式齊全（含「子項關光掃」與「名稱省略號」兩個必要配套）
//   D. scripts/fix-nav-order.js：預設排序與修復規則都讓子項維持在主項之後
//   E. scripts/test-nav-order-frontend.js 的 stub 目錄順序與 index.html DOM 順序一致
// 用法：node scripts/test-nav-hierarchy.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' ' + detail : ''}`);
}

const readPublic = (rel) => fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
const readRoot = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 取出 <nav class="sidebar-nav">…</nav> 內所有 href（＝側欄目錄順序）
function navHrefs(rel) {
  const m = readPublic(rel).match(/<nav class="sidebar-nav">([\s\S]*?)<\/nav>/);
  return m ? [...m[1].matchAll(/href="([^"]+)"/g)].map(x => x[1]) : [];
}

// 取出指定 id 的 nav-item 完整標籤（含子元素）
function navItemHtml(rel, id) {
  const m = readPublic(rel).match(new RegExp(`<a href="[^"]*"[^>]*id="${id}"[\\s\\S]*?</a>`, 'i'));
  return m ? m[0] : '';
}

console.log('===== 側邊欄主 / 子功能層級驗證 =====\n');

// ---------- A. index.html ----------
const parentHtml = navItemHtml('index.html', 'nav-xls-booking');
const childHtml = navItemHtml('index.html', 'nav-sli-eli-layout');
const indexNav = navHrefs('index.html');

check('A1 #nav-xls-booking（Shipper Role Project）標記為 .nav-parent',
  /class="[^"]*\bnav-item\b[^"]*\bnav-parent\b/.test(parentHtml), parentHtml ? '' : '（找不到項目）');
check('A2 #nav-sli-eli-layout（SLI/ELI 版面編輯器）標記為 .nav-child',
  /class="[^"]*\bnav-item\b[^"]*\bnav-child\b/.test(childHtml), childHtml ? '' : '（找不到項目）');
check('A3 子項含「子功能」標籤', /<span class="nav-badge">\s*子功能\s*<\/span>/.test(childHtml));
check('A4 子項標明所屬主項（data-nav-parent="#section-xls-booking"）',
  /data-nav-parent="#section-xls-booking"/.test(childHtml));
check('A5 子項有 title（縮排後名稱可能被省略號截短，hover 仍可看全名）',
  /\btitle="SLI\/ELI 版面編輯器/.test(childHtml));
const parentIdx = indexNav.indexOf('#section-xls-booking');
check('A6 子項緊跟在主項之後（DOM 順序）',
  parentIdx !== -1 && indexNav[parentIdx + 1] === 'sli-eli-layout.html',
  `（主項位置 ${parentIdx}，其後為 ${indexNav[parentIdx + 1]}）`);

// ---------- B. sli-eli-layout.html（子功能頁自己的側欄）----------
const subHtml = readPublic('sli-eli-layout.html');
const subNav = navHrefs('sli-eli-layout.html');
const subParentIdx = subNav.indexOf('index.html#section-xls-booking');
const subChildHtml = (subHtml.match(/<a href="sli-eli-layout\.html"[\s\S]*?<\/a>/) || [''])[0];
check('B1 子功能頁面的側欄：主項排在子項之前',
  subParentIdx !== -1 && subNav[subParentIdx + 1] === 'sli-eli-layout.html',
  `（主項位置 ${subParentIdx}，其後為 ${subNav[subParentIdx + 1]}）`);
check('B2 子功能頁面的側欄：主項 .nav-parent、子項 .nav-child.active',
  /class="[^"]*\bnav-parent\b/.test(subHtml) && /class="[^"]*\bnav-child active\b/.test(subChildHtml));
check('B3 子功能頁面的側欄：子項含「子功能」標籤', /<span class="nav-badge">\s*子功能\s*<\/span>/.test(subChildHtml));
check('B4 子功能頁首顯示所屬主功能（Shipper Role Project 子功能）',
  /<h1>[\s\S]*?Shipper Role Project 子功能[\s\S]*?<\/h1>/.test(subHtml));

// ---------- C. layout.css ----------
const css = readPublic('css/layout.css');
// 取出指定選擇器的宣告區塊（避免各規則互相誤判）
const cssBlock = (selector) => {
  const m = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};
check('C1 .nav-parent 加粗', /font-weight:\s*700/.test(cssBlock('.nav-parent')));
check('C2 .nav-parent::after 左緣強調條', /background:\s*var\(--primary-gradient\)/.test(cssBlock('.nav-parent::after')));
const childCss = cssBlock('.nav-child');
check('C3 .nav-child 縮排 + 縮小字級 + 淡化',
  /margin-left:\s*14px/.test(childCss) && /font-size:\s*0\.85rem/.test(childCss) && /color:\s*var\(--text-muted\)/.test(childCss));
check('C4 .nav-child 用 overflow:visible 讓樹狀線跨過與主項之間的間距',
  /overflow:\s*visible/.test(childCss));
check('C5 .nav-child::before 關閉光掃（避免 overflow:visible 溢出圓角）',
  /display:\s*none/.test(cssBlock('.nav-child::before')));
const tree = cssBlock('.nav-child::after');
check('C6 .nav-child::after 樹狀連接線（L 型）',
  /border-left:/.test(tree) && /border-bottom:/.test(tree) && /border-bottom-left-radius/.test(tree));
check('C7 .nav-badge 標籤樣式 + 子項配色',
  /border-radius:\s*999px/.test(cssBlock('.nav-badge')) && /color:\s*var\(--primary\)/.test(cssBlock('.nav-child .nav-badge')));
check('C8 名稱過長時省略號（保住右側鎖頭／拖曳把手）',
  /text-overflow:\s*ellipsis/.test(cssBlock('.nav-item > span:not(.nav-badge):not(.nav-right-wrap)')));
check('C9 未動到拖曳排序需要的 .nav-right-wrap / .nav-drag-handle',
  /\.nav-right-wrap\s*\{/.test(css) && /\.nav-drag-handle\s*\{/.test(css));

// ---------- D. fix-nav-order.js ----------
const fixSrc = readRoot(path.join('scripts', 'fix-nav-order.js'));
const orderKeys = [...(fixSrc.match(/const DEFAULT_ORDER = \[([\s\S]*?)\];/) || ['', ''])[1]
  .matchAll(/'([^']+)'/g)].map(x => x[1]);
const dIdx = orderKeys.indexOf('#section-xls-booking');
check('D1 DEFAULT_ORDER：子項緊跟在主項之後',
  dIdx !== -1 && orderKeys[dIdx + 1] === 'sli-eli-layout.html',
  `（主項位置 ${dIdx}，其後為 ${orderKeys[dIdx + 1]}）`);
check('D2 CHILD_AFTER_PARENT 對應正確',
  /const CHILD_AFTER_PARENT = \{[\s\S]*?'sli-eli-layout\.html':\s*'#section-xls-booking'[\s\S]*?\};/.test(fixSrc));
check('D3 修復流程會把子項搬回主項之後',
  /return moveChildrenAfterParents\(result\);/.test(fixSrc) && /function moveChildrenAfterParents/.test(fixSrc));

// ---------- E. 測試 stub 與 index.html DOM 順序一致 ----------
const stubKeys = [...(readRoot(path.join('scripts', 'test-nav-order-frontend.js'))
  .match(/const NAV_ITEM_HREFS = \[([\s\S]*?)\];/) || ['', ''])[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
check('E1 test-nav-order-frontend.js 的 stub 順序 = index.html DOM 順序',
  JSON.stringify(stubKeys) === JSON.stringify(indexNav),
  `（stub ${stubKeys.length} 項 / DOM ${indexNav.length} 項）`);

console.log(`\n===== ${failed === 0 ? '全部通過' : `${failed} 項失敗`} =====`);
process.exitCode = failed === 0 ? 0 : 1;
