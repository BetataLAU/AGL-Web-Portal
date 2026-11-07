// ===== 頂部工作列（Topbar）靜態驗證（免伺服器）=====
// 背景：原本常駐左側的 Sidebar 佔掉 308px 寬，改成「從頂部工作列往下展開的抽屜」後
//       主內容可吃滿整個寬度；游標離開抽屜範圍要自動捲回。
// 驗收項目：
//   A. public/index.html：工作列 + ☰ 開關 + aside#app-sidebar + CSS/JS 引用
//      （☰ 目錄與目錄搜尋是同一個膠囊 .topbar-nav-search，placeholder＝搜尋目錄）
//   B. public/sli-eli-layout.html（同版面的子功能頁）：同樣具備工作列與開關
//   C. public/css/topbar.css：工作列固定定位、抽屜收合／展開動畫、遮罩、搜尋過濾樣式
//   D. public/js/topbar.js：游標離開自動收合、ESC／點外面收合、搜尋過濾、右側工具
//   E. public/js/main.js：切換區塊時同步工作列的「目前位置」
//   F. users.html / login.html 不受影響（沒有 has-topbar）
// 用法：node scripts/test-topbar.js
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

// 取出指定選擇器的宣告區塊（避免各規則互相誤判）
function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
}

console.log('===== 頂部工作列（Topbar）驗證 =====\n');

// ---------- A. index.html ----------
const indexHtml = readPublic('index.html');
check('A1 body 標記 has-topbar', /<body class="has-topbar">/.test(indexHtml));
check('A2 有 <header class="topbar" id="topbar">', /<header class="topbar" id="topbar">/.test(indexHtml));
check('A3 最左邊有目錄開關按鈕（id=topbar-menu-btn，含 aria-expanded/aria-controls）',
  /id="topbar-menu-btn"[\s\S]{0,200}?aria-expanded="false"[\s\S]{0,200}?aria-controls="app-sidebar"/.test(indexHtml));
check('A4 原本的 Sidebar 加上 id="app-sidebar"', /<aside class="sidebar" id="app-sidebar">/.test(indexHtml));
check('A5 有遮罩元素（id=topbar-scrim）', /id="topbar-scrim"/.test(indexHtml));
check('A6 有搜尋框（id=topbar-search-input）', /id="topbar-search-input"/.test(indexHtml));
check('A7 右側工具有主題／全螢幕／回到頁頂／時鐘',
  /id="topbar-theme-btn"/.test(indexHtml) && /id="topbar-fullscreen-btn"/.test(indexHtml)
  && /id="topbar-top-btn"/.test(indexHtml) && /id="topbar-clock"/.test(indexHtml));
check('A8 引用 css/topbar.css', /<link rel="stylesheet" href="css\/topbar\.css">/.test(indexHtml));
check('A9 引用 js/topbar.js（且排在 main.js 之前）',
  indexHtml.indexOf('js/topbar.js') !== -1 && indexHtml.indexOf('js/topbar.js') < indexHtml.indexOf('js/main.js'));
check('A10 有搜尋無結果提示（id=nav-empty）', /id="nav-empty"/.test(indexHtml));
// 目錄項目必須留在 <nav class="sidebar-nav"> 內，拖曳排序／權限鎖頭才不受影響
const navBlock = (indexHtml.match(/<nav class="sidebar-nav">([\s\S]*?)<\/nav>/) || ['', ''])[1];
check('A11 nav-empty 不放在 <nav> 內（不干擾拖曳排序的 .nav-item 集合）',
  navBlock.indexOf('nav-empty') === -1);
// 「☰ 目錄」與「目錄搜尋」必須是**同一個圓角膠囊**，且在工作列左側（兩者本來就是同一組功能）
const topbarLeftBlock = (indexHtml.match(/<div class="topbar-left">([\s\S]*?)<div class="topbar-right">/) || ['', ''])[1];
check('A12 ☰ 目錄與搜尋框在同一個膠囊（.topbar-nav-search：#topbar-menu-btn＋分隔線＋#topbar-search-input）',
  /class="topbar-nav-search" id="topbar-nav-search"/.test(topbarLeftBlock)
  && topbarLeftBlock.indexOf('id="topbar-menu-btn"') !== -1
  && topbarLeftBlock.indexOf('class="topbar-nav-search-sep"') !== -1
  && topbarLeftBlock.indexOf('id="topbar-search-input"') !== -1);
check('A13 搜尋框 placeholder 為「搜尋目錄」', /placeholder="搜尋目錄"/.test(indexHtml));

// ---------- B. sli-eli-layout.html ----------
const subHtml = readPublic('sli-eli-layout.html');
check('B1 子功能頁同樣標記 has-topbar', /<body class="has-topbar">/.test(subHtml));
check('B2 子功能頁有工作列與目錄開關',
  /<header class="topbar" id="topbar">/.test(subHtml) && /id="topbar-menu-btn"/.test(subHtml));
check('B3 子功能頁的 Sidebar 加上 id="app-sidebar"', /<aside class="sidebar" id="app-sidebar">/.test(subHtml));
check('B4 子功能頁品牌連結回 index.html', /id="topbar-brand"[^>]*href="index\.html"|href="index\.html"[^>]*id="topbar-brand"/.test(subHtml));
check('B5 子功能頁引用 css/topbar.css 與 js/topbar.js',
  /css\/topbar\.css/.test(subHtml) && /js\/topbar\.js/.test(subHtml));
check('B6 子功能頁同樣是「☰ 目錄＋搜尋」同一膠囊（placeholder 搜尋目錄）',
  /class="topbar-nav-search"/.test(subHtml) && /class="topbar-nav-search-sep"/.test(subHtml)
  && /placeholder="搜尋目錄"/.test(subHtml));

// ---------- C. public/css/topbar.css ----------
const css = readPublic('css/topbar.css');
check('C1 定義 --topbar-h', /--topbar-h:\s*\d+px/.test(cssBlock(css, ':root')));
const topbarCss = cssBlock(css, '.topbar');
check('C2 工作列 fixed 且在最上層（z-index 高於抽屜）',
  /position:\s*fixed/.test(topbarCss) && Number((topbarCss.match(/z-index:\s*(\d+)/) || [0, 0])[1]) >= 1200);
const sidebarClosed = cssBlock(css, 'body.has-topbar .sidebar');
check('C3 抽屜預設收合（往上平移 + 透明 + 不可點）',
  /position:\s*fixed/.test(sidebarClosed) && /translateY\(/.test(sidebarClosed)
  && /opacity:\s*0/.test(sidebarClosed) && /pointer-events:\s*none/.test(sidebarClosed));
const sidebarOpen = cssBlock(css, 'body.has-topbar .sidebar.is-open');
check('C4 展開狀態 translateY(0) 且可互動、有轉場動畫',
  /translateY\(0\)/.test(sidebarOpen) && /opacity:\s*1/.test(sidebarOpen)
  && /pointer-events:\s*auto/.test(sidebarOpen) && /transition:/.test(sidebarOpen));
// 主內容實際從工作列下方開始：body 用 padding-top 讓位（padding 不會 margin collapse）
// ⚠️ 不可改回 `.app-layout { margin-top: var(--topbar-h) }`：子元素的 margin-top 會與 body 上外邊界合併，
//    讓 html 文件高度多出一個 topbar 高度（實測 56px）→ 視窗本身還能再捲 56px，
//    一旦被 anchor／scrollIntoView／window.scrollTo 捲動，內容與 sticky 步驟列就會滑到工作列底下（看起來像重疊）。
const bodyHasTopbar = cssBlock(css, 'body.has-topbar');
const appLayoutTopbar = cssBlock(css, 'body.has-topbar .app-layout');
check('C5 主內容從工作列下方開始（body padding-top＋固定高度＋不可捲，非 margin-top）',
  /padding-top:\s*var\(--topbar-h\)/.test(bodyHasTopbar)
  && /height:\s*100dvh/.test(bodyHasTopbar)
  && /overflow:\s*hidden/.test(bodyHasTopbar)
  && /margin-top:\s*0/.test(appLayoutTopbar)
  && /height:\s*100%/.test(appLayoutTopbar)
  && !/margin-top:\s*var\(--topbar-h\)/.test(appLayoutTopbar));
check('C6 有遮罩樣式與展開狀態', /position:\s*fixed/.test(cssBlock(css, '.topbar-scrim'))
  && /visibility:\s*visible/.test(cssBlock(css, '.topbar-scrim.is-open')));
check('C7 搜尋過濾樣式（.nav-item.nav-filtered-out 隱藏）',
  /display:\s*none\s*!important/.test(cssBlock(css, '.nav-item.nav-filtered-out')));
check('C8 響應式：≤900px 抽屜仍為 fixed 覆蓋層',
  /@media \(max-width: 900px\)[\s\S]*?body\.has-topbar \.sidebar\s*\{[\s\S]*?position:\s*fixed/.test(css));
// 滿版對齊：內容區變寬後，卡片不可再有 1200px 上限（否則右側留白、和滿版步驟列不齊）
const xlsCss = readPublic('css/xls-booking.css');
check('C9 .xls-card 不再限制 1200px（與滿版 .xls-step-nav 對齊）',
  !/\.xls-card\s*\{[^}]*max-width:\s*min\(1200px/.test(xlsCss));
// 工作列左右 padding 要跟 .main-content 對齊，內容邊界才會齊一
const layoutCss = readPublic('css/layout.css');
const mainPadding = (cssBlock(layoutCss, '.main-content').match(/padding:\s*(\d+)px/) || [0, 0])[1];
check('C10 .topbar 左右 padding 與 .main-content 一致',
  mainPadding !== '0' && new RegExp(`padding:\\s*0\\s+${mainPadding}px`).test(topbarCss),
  `（.main-content padding=${mainPadding}px）`);
// 頁面層級 sticky（步驟快速跳轉列）貼在捲動容器上緣（＝工作列下緣）下方，且要有不透明底色
const stepNavCss = cssBlock(css, 'body.has-topbar .xls-step-nav');
check('C11 步驟列緊貼工作列下方（top 8~10px）且不透明',
  /top:\s*(8|10)px/.test(stepNavCss) && /background:/.test(stepNavCss)
  && /--input-bg/.test(stepNavCss));
// 任何地方都不可再用 margin-top 讓位（桌面與 ≤900px 響應式都一樣），否則視窗會多出可捲高度
// 註解裡提到舊做法是允許的 → 先去掉 CSS 註解再檢查
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
check('C12 整份 topbar.css 沒有 margin-top: var(--topbar-h)（避免 margin collapse 讓視窗可捲）',
  !/margin-top:\s*var\(--topbar-h\)/.test(cssNoComments));
// 「☰ 目錄 ＋ 目錄搜尋」膠囊：圓角外框、焦點光環畫在**外框**（:focus-within）、中間細分隔線
const navSearchCss = cssBlock(css, '.topbar-nav-search');
const navSearchFocusCss = cssBlock(css, '.topbar-nav-search:focus-within');
const navSearchSepCss = cssBlock(css, '.topbar-nav-search-sep');
check('C13 「目錄＋搜尋」膠囊：圓角外框＋:focus-within 光環＋1px 分隔線',
  /border-radius:\s*\d+px/.test(navSearchCss) && /border:\s*1px solid/.test(navSearchCss)
  && /box-shadow:\s*0 0 0 3px var\(--surface-glow\)/.test(navSearchFocusCss)
  && /width:\s*1px/.test(navSearchSepCss));

// ---------- D. public/js/topbar.js ----------
const js = readPublic('js/topbar.js');
check('D1 有 ☰ 開關（toggleNav / setOpen）', /function setOpen\(/.test(js) && /function toggleNav\(/.test(js));
check('D2 切換抽屜時同步 .is-open（CSS 動畫用）', /classList\.toggle\('is-open', open\)/.test(js));
check('D3 游標離開抽屜 → 自動收合（mouseleave + 延遲）',
  /addEventListener\('mouseleave'/.test(js) && /function scheduleClose\(/.test(js) && /CLOSE_DELAY\s*=\s*\d+/.test(js));
check('D4 游標回到抽屜 → 取消收合（mouseenter）',
  /addEventListener\('mouseenter', cancelScheduledClose\)/.test(js));
check('D5 ESC 與點擊抽屜外可收起', /'Escape'/.test(js) && /'pointerdown'/.test(js));
check('D6 搜尋框即時過濾目錄並展開', /function applyNavFilter\(/.test(js) && /setOpen\(true\)/.test(js));
check('D7 拖曳排序時不收合抽屜（draggingNav）', /draggingNav/.test(js));
check('D8 提供 topbarSetSection 給 main.js 同步目前位置', /window\.topbarSetSection\s*=/.test(js));
check('D9 主題切換有 theme.js 時走 applyTheme（含 fallback）',
  /window\.applyTheme/.test(js) && /localStorage\.setItem\('site-theme'/.test(js));
check('D10 全螢幕與 HKT 時鐘', /requestFullscreen/.test(js) && /Asia\/Hong_Kong/.test(js));

// ---------- E. main.js 同步目前位置 ----------
const mainJs = readPublic('js/main.js');
check('E1 showSection 會呼叫 window.topbarSetSection', /window\.topbarSetSection\(sectionId\)/.test(mainJs));

// ---------- F. 其他頁面不受影響 ----------
check('F1 users.html 沒有 has-topbar（維持原版面）', !/has-topbar/.test(readPublic('users.html')));
check('F2 login.html 沒有 has-topbar（維持原版面）', !/has-topbar/.test(readPublic('login.html')));

console.log(`\n===== ${failed === 0 ? '全部通過' : `${failed} 項失敗`} =====`);
process.exitCode = failed === 0 ? 0 : 1;
