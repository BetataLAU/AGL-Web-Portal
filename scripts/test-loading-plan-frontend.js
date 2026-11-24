// ===== 執 PLAN：前端（HTML / CSS / 渲染純函式）測試 =====
// 不用瀏覽器：以最小 DOM stub 載入 ESM 模組，驗證渲染輸出與頁面掛載點。
// 用法：node scripts/test-loading-plan-frontend.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

// ---- 最小 DOM stub（模組頂層只用到 addEventListener / createElement）----
const noop = () => {};
function fakeNode(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(), className: '', id: '', textContent: '', innerHTML: '',
    style: { setProperty: noop, removeProperty: noop }, dataset: {}, children: [],
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild(child) { this.children.push(child); return child; },
    removeChild: noop, remove: noop, addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, contains: () => false, focus: noop, select: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })
  };
}

global.document = {
  addEventListener: noop, removeEventListener: noop,
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null, createElement: fakeNode,
  body: fakeNode('body'), documentElement: fakeNode('html'), activeElement: null,
  fonts: null
};
global.window = {
  addEventListener: noop, removeEventListener: noop,
  innerWidth: 1440, innerHeight: 900,
  apiFetch: async () => ({ data: [] }),
  openModal: () => ({ close: noop, card: fakeNode(), element: fakeNode() })
};
global.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };

(async () => {
  console.log('===== 執 PLAN：前端測試 =====\n');

  // ===== 1. index.html 掛載點 =====
  console.log('--- 1. index.html ---');
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  check('1.1 NAV 有 #nav-loading-plan', /id="nav-loading-plan"/.test(html));
  check('1.2 NAV 連到 #section-loading-plan', /href="#section-loading-plan"/.test(html));
  check('1.3 有 <section id="section-loading-plan">', /<section id="section-loading-plan"/.test(html));
  check('1.4 有 #lp-root 容器', /id="lp-root"/.test(html));
  check('1.5 已載入 loading-plan.css', /css\/loading-plan\.css/.test(html));
  check('1.6 已載入 loading-plan.js（module）', /type="module" src="\.\/js\/loading-plan\.js"/.test(html));
  check('1.7 NAV 不顯示鎖頭（不設權限）', !/id="nav-loading-plan"[\s\S]{0,200}nav-lock-icon/.test(html));

  // ===== 2. main.js 初始化 =====
  console.log('--- 2. main.js ---');
  const mainJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'main.js'), 'utf8');
  check('2.1 initProtectedSections 會呼叫 setupLoadingPlanSection', /setupLoadingPlanSection\(\)/.test(mainJs));

  // ===== 3. CSS 關鍵樣式 =====
  console.log('--- 3. loading-plan.css ---');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'loading-plan.css'), 'utf8');
  ['.lp-layout', '.lp-col-stock', '.lp-toolbar', '.lp-plan', '.lp-row', '.lp-context-menu',
    '.lp-tag-contour', '.lp-tag-owner', '.lp-inline-input', '.lp-toast', '.lp-row-total', '@media print',
    '.lp-view-btn', 'grid-template-columns: 330px minmax(0, 1fr)'].forEach((token) => {
    check(`3.x 有 ${token}`, css.includes(token));
  });
  check('3.11 KPI 欄樣式已移除', !css.includes('.lp-kpi'));
  check('3.14 體積切換＝緊貼分段按鈕（內側直角、選中字級放大、選中實心）',
    /\.lp-view-toggle \{[^}]*border-radius: 8px/.test(css) &&
    /\.lp-view-btn:first-child \{[^}]*border-radius: 7px 0 0 7px/.test(css) &&
    /\.lp-view-btn:last-child \{[^}]*border-radius: 0 7px 7px 0/.test(css) &&
    /\.lp-view-btn\.is-on \{[^}]*font-size: \.78rem/.test(css) &&
    /\.lp-view-btn\[data-view="vol"\]\.is-on \{[^}]*background: var\(--primary\)/.test(css) &&
    /\.lp-view-btn\[data-view="cuft"\]\.is-on \{[^}]*background: #0d9488/.test(css) &&
    /\.lp-view-btn\[data-view="vol"\]\.is-on \{[^}]*color: #fff/.test(css));
  check('3.12 存貨列有完整 MAWB／客戶名樣式',
    ['.lp-stock-row', '.lp-stock-mawb', '.lp-stock-client'].every(token => css.includes(token)));
  check('3.13 存貨 MAWB 樣式不截斷',
    /\.lp-stock-mawb \{[^}]*white-space: nowrap/.test(css) && !/\.lp-stock-mawb \{[^}]*text-overflow/.test(css));
  check('3.15 列 hover 會閃爍高亮（明細／存貨／Booking 清單共用動畫）',
    /@keyframes lpRowHoverFlash/.test(css) &&
    /\.lp-row:not\(\.lp-row-head\):not\(\.lp-row-total\):hover,[\s\S]*?\.lp-find-row:hover,[\s\S]*?\.lp-sg-row:hover \{[^}]*animation: lpRowHoverFlash/.test(css));
  check('3.16 作用中 PLAN 外框會脈動高亮（拖曳時暫停）',
    /\.lp-plan\.is-active \{[^}]*animation: lpPlanActivePulse/.test(css) &&
    /@keyframes lpPlanActivePulse/.test(css) &&
    css.includes('.lp-plan.is-active.is-drop { animation: none; }'));
  check('3.17 尊重 prefers-reduced-motion（列／PLAN 動畫關閉）',
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none;[\s\S]*?\.lp-plan\.is-active \{ animation: none/.test(css));
  check('3.18 REMARK hover 展開／DIM 輸入器樣式齊全',
    ['.lp-remark-pop', '.lp-remark-pop-text', '.lp-dim-btn', '.lp-dim-editor', '.lp-dim-input', '.lp-inline-textarea']
      .every(token => css.includes(token)));
  check('3.19 列印時隱藏 REMARK 展開／DIM 編輯器',
    /@media print \{[\s\S]*?\.lp-remark-pop, \.lp-dim-editor \{ display: none !important; \}/.test(css));
  check('3.20 MAWB／DEST 固定寬度、CLIENT 保留 15 字元寬度（縮短三欄間距）',
    /\.lp-row \{\s*display: grid;\s*grid-template-columns: 24px 24px 104px 42px 116px/.test(css) &&
    /@media print \{[\s\S]*?\.lp-row \{ grid-template-columns: 24px 104px 42px 116px/.test(css));

  // ===== 4. 模組載入（不會碰真 DOM）=====
  console.log('--- 4. ESM 模組 ---');
  const calc = await import(url('public/js/loading-plan/calc.js'));
  const stateMod = await import(url('public/js/loading-plan/state.js'));
  const render = await import(url('public/js/loading-plan/render.js'));
  const api = await import(url('public/js/loading-plan/api.js'));
  const interactions = await import(url('public/js/loading-plan/interactions.js'));
  const contour = await import(url('public/js/loading-plan/contour.js'));
  const realtime = await import(url('public/js/loading-plan/realtime.js'));
  check('4.1 calc 載入', typeof calc.lpVolFromCbm === 'function');
  check('4.2 state 載入', typeof stateMod.planLabel === 'function');
  check('4.3 render 載入', typeof render.renderLayout === 'function');
  check('4.4 api 載入', typeof api.lpApi.plans === 'function' && typeof api.lpApi.copyItem === 'function');
  check('4.5 interactions 匯出 setupInteractions', typeof interactions.setupInteractions === 'function');
  check('4.6 contour 匯出 openContourSpec', typeof contour.openContourSpec === 'function');
  check('4.7 realtime 匯出 startRealtime / setEditingItem / notifyPlanChange',
    typeof realtime.startRealtime === 'function' &&
    typeof realtime.setEditingItem === 'function' &&
    typeof realtime.notifyPlanChange === 'function');

  // ===== 5. 渲染輸出 =====
  console.log('--- 5. 渲染純函式 ---');
  const knownTag = render.contourTag({ contour_code: 'H3', contour_qty: 1 });
  check('5.1 已收錄板型 → 綠 TAG（無 ?）',
    knownTag.includes('lp-tag-contour') && !knownTag.includes('is-unknown') && !knownTag.includes('H3 ?'),
    knownTag.slice(0, 90));
  const unknownTag = render.contourTag({ contour_code: 'Q5', contour_qty: 1 });
  check('5.2 未收錄板型 → 虛線 TAG + ?', unknownTag.includes('is-unknown') && unknownTag.includes('Q5 ?'));
  const multi = render.contourTag({ contour_code: 'H3', contour_qty: 2 });
  check('5.3 多板顯示 2 × H3-00', multi.includes('2 × H3-00'), multi.slice(0, 80));

  const ownerTag = render.ownerTag({ owner_company: 'SKY DRAGON' });
  check('5.4 owner TAG 帶顏色變數', ownerTag.includes('--lp-owner:') && ownerTag.includes('SKY DRAGON'));
  check('5.5 同一個 owner 顏色穩定', render.ownerTag({ owner_company: 'SKY DRAGON' }) === ownerTag);
  check('5.6 空 owner 不輸出 TAG', render.ownerTag({ owner_company: '' }) === '');

  check('5.7 表頭 VOL 模式', render.rowHead('vol').includes('>VOL<'));
  check('5.8 表頭 cu.ft 模式', render.rowHead('cuft').includes('>cu.ft<'));
  check('5.8b 表頭 G.W / VOL / CBM 與數值右對齊',
    /lp-c-gw num/.test(render.rowHead('vol')) &&
    /lp-c-vol num/.test(render.rowHead('vol')) &&
    /lp-c-cbm num/.test(render.rowHead('vol')));
  check('5.8c 表頭 TAG 欄改名 REMARK（class 仍為 lp-c-tag）',
    /<span class="lp-c-tag"[^>]*>REMARK<\/span>/.test(render.rowHead('vol')));

  const plan = { id: 7, volume_view: 'vol', day_code: 'D7', contour_code: 'H3', owner_company: 'SKY DRAGON' };
  const item = {
    id: 11, mawb: '176-6985 5240', client: 'MAERSK', dest: 'DWC', pkgs_text: '17+7P',
    pcs_total: 24, gross_weight: 1302, cbm: 6.82, volume_weight: 1135, cuft: 240.85,
    volume: { cbm: 6.82, vol: 1135, cuft: 240.85 }, tag: '4 / D6', dg_966: 1
  };
  const row = render.itemRow(item, plan, 0, { selectedSet: new Set() });
  check('5.9 列有 item-id / plan-id', row.includes('data-item-id="11"') && row.includes('data-plan-id="7"'));
  check('5.10 列可拖曳', row.includes('draggable="true"'));
  check('5.11 顯示 MAWB / DEST / PKGS',
    row.includes('176-6985 5240') && row.includes('DWC') && row.includes('17+7P'));
  check('5.11b 欄位順序 MAWB → DEST → CLIENT（表頭與明細一致）', (() => {
    const cols = (html) => [html.indexOf('lp-c-mawb'), html.indexOf('lp-c-dest'), html.indexOf('lp-c-client')];
    const head = cols(render.rowHead('vol'));
    const body = cols(row);
    const ordered = (list) => list[0] >= 0 && list[0] < list[1] && list[1] < list[2];
    return ordered(head) && ordered(body);
  })());
  check('5.12 顯示 VOL 與 CBM', row.includes('1,135.00') && row.includes('6.820'));
  check('5.13 DG flag（966）有標示', row.includes('lp-flags') && row.includes('966'));
  check('5.14 一般列不帶 hover 屬性（只 highlight）',
    !row.includes('data-hover-mawb') && !row.includes('data-hover-error'));

  const cuftRow = render.itemRow(item, { id: 7, volume_view: 'cuft' }, 0, { selectedSet: new Set() });
  check('5.15 cu.ft 模式顯示 240.85', cuftRow.includes('240.85'));

  const missing = render.itemRow(
    { id: 12, mawb: '', cbm: 1, volume: { cbm: 1, vol: 166.67, cuft: 35.31 } },
    plan, 1, { selectedSet: new Set() }
  );
  check('5.16 缺 MAWB → 黃字警告＋hover 訊息',
    missing.includes('is-warn') && missing.includes('缺 MAWB') && missing.includes('data-hover-error="缺 MAWB'));

  const dup = render.itemRow(Object.assign({}, item, { split_of_item_id: 5 }), plan, 2, { selectedSet: new Set() });
  check('5.17 複製的明細有重複標記＋hover 訊息',
    dup.includes('is-dup') && dup.includes('lp-dup') && dup.includes('data-hover-error="重複 MAWB'));

  const dupAcross = render.itemRow(Object.assign({}, item, {
    duplicate_mawb: true,
    duplicate_places: [{ plan_id: 8, item_id: 21, label: 'EK9845 / — / SKY DRAGON' }]
  }), plan, 3, { selectedSet: new Set() });
  check('5.17b 跨 PLAN 重複：所有列都標色，hover 列出其他位置',
    dupAcross.includes('is-dup') && dupAcross.includes('lp-dup') &&
    dupAcross.includes('重複 MAWB（也在 EK9845 / — / SKY DRAGON）'));

  const dupSamePlan = render.itemRow(Object.assign({}, item, {
    plan_id: 7,
    duplicate_mawb: true,
    duplicate_places: [{ plan_id: 7, item_id: 99, label: 'EK9859 / 14NOV / SKY DRAGON' }]
  }), plan, 4, { selectedSet: new Set() });
  check('5.17c 同 PLAN 重複 → 訊息不重複列同一張 PLAN',
    dupSamePlan.includes('重複 MAWB（同一 PLAN 多筆）'));

  const selected = render.itemRow(item, plan, 0, { selectedSet: new Set([11]) });
  check('5.18 已選取 → is-selected + checked',
    selected.includes('is-selected') && selected.includes('checked'));

  // 明細最下方合計列：總 MAWB（去重）＋ PKGS／G.W／VOL（cu.ft）／CBM，欄位與上方對齊
  const totalRow = render.planTotalRow({
    totals: {
      mawbs: 3, tickets: 4, pcs: 31, pcsIncomplete: 1,
      grossWeight: 1581, vol: 1433, cuft: 304.06, cbm: 8.61
    }
  }, 'vol');
  check('5.18a 合計列有總 MAWB 數', totalRow.includes('lp-row-total') &&
    totalRow.includes('TOTAL <b>3</b> MAWB'), totalRow.slice(0, 120));
  check('5.18b 合計列沿用上方欄位 class（逐欄對齊）',
    ['lp-c-sel', 'lp-c-idx', 'lp-c-mawb', 'lp-c-client', 'lp-c-dest', 'lp-c-pkgs', 'lp-c-gw', 'lp-c-vol', 'lp-c-cbm', 'lp-c-crd', 'lp-c-tag']
      .every(cls => totalRow.includes(`class="${cls}`) || totalRow.includes(` ${cls}`)));
  check('5.18c PKGS／G.W／VOL／CBM 數值正確（與上方同欄右對齊）',
    totalRow.includes('>31 <span class="lp-warn"') &&
    /lp-c-gw num">1,581\.00</.test(totalRow) &&
    /lp-c-vol num">1,433\.00</.test(totalRow) &&
    /lp-c-cbm num">8\.610</.test(totalRow));
  check('5.18d 件數未填 → PKGS 加 ⚠（title 說明不含）',
    totalRow.includes('筆件數未填'));
  const totalCuft = render.planTotalRow({
    totals: { mawbs: 1, tickets: 1, pcs: 1, grossWeight: 1, vol: 166.67, cuft: 35.31, cbm: 1 }
  }, 'cuft');
  check('5.18e cu.ft 模式合計列顯示 cu.ft 值', /lp-c-vol num">35\.31</.test(totalCuft));

  const card = render.planCard({
    id: 7, type: 'flight', flight_no: 'EK9859', flight_date: '2026-11-14',
    owner_company: 'SKY DRAGON', day_code: 'D7', volume_view: 'vol',
    totals: { grossWeight: 4304, cbm: 35.62, tickets: 10, mawbs: 9, pcs: 148, maxGrossWeight: 9000, gwPct: 47.8, overWeight: 0 }
  });
  check('5.19 卡片標題 = Flight / Date / Owner', card.includes('EK9859 / 14NOV / SKY DRAGON'));
  check('5.20 卡片有 KPI 與展開箭頭',
    card.includes('4,304 / max 9,000') && card.includes('data-action="toggle-plan"'));
  const cardLimits = render.planCard({
    id: 9, type: 'flight', flight_no: 'EK1', owner_company: 'X', volume_view: 'vol',
    totals: {
      grossWeight: 8229, maxGrossWeight: 9000, gwPct: 91.4,
      cbm: 49.78, maxCbm: 65, cbmPct: 76.6, tickets: 10, pcs: 62
    }
  });
  check('5.20b KPI 上限前有 "max"（G.W／CBM）',
    cardLimits.includes('8,229 / max 9,000 kg') && cardLimits.includes('49.78 / max 65.00 m³'));
  const cardCuft = render.planCard({
    id: 10, type: 'flight', flight_no: 'EK1', owner_company: 'X', volume_view: 'cuft',
    totals: {
      grossWeight: 8229, maxGrossWeight: 9000, gwPct: 91.4,
      cbm: 49.78, maxCbm: 65, cbmPct: 76.6, cuft: 1757.77, tickets: 10, pcs: 62
    }
  });
  check('5.20c cu.ft 模式 KPI 上限也標 "max"（跟隨檢視單位）',
    cardCuft.includes('1,757.77 / max ') && cardCuft.includes('cu.ft') && !cardCuft.includes('m³'));
  check('5.21 超重時卡片標紅', render.planCard({
    id: 8, type: 'flight', flight_no: 'EK1', owner_company: 'X', volume_view: 'vol',
    totals: { grossWeight: 9500, maxGrossWeight: 9000, overWeight: 500, gwPct: 105.6, cbm: 1, tickets: 1, pcs: 1 }
  }).includes('is-over'));

  stateMod.state.expanded.add(7);
  stateMod.state.details.set(7, [item]);
  const cardExpanded = render.planCard({
    id: 7, type: 'flight', flight_no: 'EK9859', flight_date: '2026-11-14',
    owner_company: 'SKY DRAGON', day_code: 'D7', volume_view: 'vol',
    totals: { grossWeight: 4304, cbm: 35.62, tickets: 10, mawbs: 9, pcs: 148, vol: 5934, maxGrossWeight: 9000, gwPct: 47.8, overWeight: 0 }
  });
  check('5.21b 展開後最下方（最後一個 MAWB 之後）有合計列',
    cardExpanded.includes('lp-row-total') &&
    cardExpanded.indexOf('lp-row-total') > cardExpanded.lastIndexOf('data-item-id=') &&
    cardExpanded.includes('TOTAL <b>9</b> MAWB') &&
    cardExpanded.includes('5,934.00'));
  stateMod.state.expanded.delete(7);
  stateMod.state.details.delete(7);

  const stockPlan = { id: 30, type: 'stock', volume_view: 'vol' };
  const srow = render.stockRow(item, stockPlan, 0, { selectedSet: new Set() });
  check('5.22 存貨列完整顯示 MAWB／客戶名',
    srow.includes('lp-stock-row') && srow.includes('lp-stock-mawb') && srow.includes('lp-stock-client') &&
    srow.includes('176-6985 5240') && srow.includes('MAERSK'));
  check('5.23 存貨列保留拖曳／選取／就地編輯與第二行統計',
    srow.includes('draggable="true"') && srow.includes('data-plan-id="30"') &&
    srow.includes('data-action="select-item"') &&
    ['mawb', 'client', 'dest', 'pkgs_text', 'gross_weight', 'volume_weight']
      .every(field => srow.includes(`data-field="${field}"`)) &&
    srow.includes('G.W') && srow.includes('VOL'));
  const srowCrd = render.stockRow(Object.assign({}, item, { cargo_receipt: '2026-11-14' }),
    stockPlan, 0, { selectedSet: new Set() });
  check('5.24 存貨列在 VOL 右邊顯示 CRD（DDMMM）', (() => {
    const volIdx = srowCrd.indexOf('VOL ');
    const crdIdx = srowCrd.indexOf('lp-stock-crd');
    return volIdx > -1 && crdIdx > volIdx && srowCrd.includes('CRD 14NOV');
  })(), srowCrd.slice(Math.max(0, srowCrd.indexOf('lp-stock-meta')), srowCrd.length - 8));
  check('5.24b 存貨沒有 CRD → 顯示「CRD —」', srow.includes('CRD —'));
  check('5.24c 存貨 CRD 以圓角按鈕顯示（button.lp-stock-crd）',
    /<button type="button" class="lp-stock-crd"[^>]*>CRD 14NOV<\/button>/.test(srowCrd) &&
    /\.lp-stock-crd \{[^}]*border-radius: 999px/.test(css));

  // ===== 6. state 純函式 =====
  console.log('--- 6. state ---');
  check('6.1 volumeText VOL', stateMod.volumeText({ volume: { vol: 1135, cuft: 240.85 } }, 'vol') === '1,135.00');
  check('6.2 volumeText cu.ft', stateMod.volumeText({ volume: { vol: 1135, cuft: 240.85 } }, 'cuft') === '240.85');
  check('6.3 planLabel 缺日期 → —',
    stateMod.planLabel({ flight_no: 'EK9859', owner_company: 'SKY DRAGON' }) === 'EK9859 / — / SKY DRAGON');
  check('6.4 選取切換', (() => {
    stateMod.clearSelection('items');
    stateMod.toggleSelection('items', 5);
    const on = stateMod.selectedIdList('items').includes(5);
    stateMod.toggleSelection('items', 5);
    return on && stateMod.selectedIdList('items').length === 0;
  })());
  check('6.5 Undo stack 上限 30', (() => {
    for (let i = 0; i < 40; i += 1) stateMod.pushUndo({ type: 'move', i });
    return stateMod.state.undoStack.length === 30;
  })());

  // ===== 7. API 路徑 =====
  console.log('--- 7. API 路徑 ---');
  let calledUrl = '';
  global.window.apiFetch = async (u) => { calledUrl = u; return { data: [] }; };
  await api.lpApi.plans({ search: 'EK' });
  check('7.1 /plans 帶 search',
    calledUrl.startsWith('/api/loading-plan/plans?') && calledUrl.includes('search=EK'), calledUrl);
  await api.lpApi.stock();
  check('7.2 /stock 路徑', calledUrl === '/api/loading-plan/stock', calledUrl);
  await api.lpApi.copyItem(9, 3);
  check('7.3 copy 走 /items/9/copy', calledUrl === '/api/loading-plan/items/9/copy', calledUrl);
  await api.lpApi.createBooking({ mawb: '176-9999 8888' });
  check('7.4 新增 Booking 走 POST /bookings', calledUrl === '/api/loading-plan/bookings', calledUrl);

  // ===== 8. 即時同步（SSE / presence）=====
  console.log('--- 8. 即時同步 ---');
  const interactionsSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'loading-plan', 'interactions.js'), 'utf8');
  const realtimeSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'loading-plan', 'realtime.js'), 'utf8');
  check('8.1 CSS 有他人編輯中的樣式', css.includes('.lp-row.is-locked'));
  check('8.2 CSS 有連線狀態顏色', css.includes('.lp-conn[data-state="warn"]'));
  check('8.3 layout 有 #lp-online', render.layoutHtml().includes('id="lp-online"'));
  check('8.4 setupInteractions 會啟動 realtime', interactionsSrc.includes('startRealtime({ reload: loadAll })'));
  check('8.5 切換 plan 會更新 presence', interactionsSrc.includes('notifyPlanChange()'));
  check('8.6 就地編輯會送 presence', interactionsSrc.includes('setEditingItem(item.id)') && interactionsSrc.includes('setEditingItem(null)'));
  check('8.7 SSE 帶 Last-Event-ID / since 補送', realtimeSrc.includes('lastEventId') && realtimeSrc.includes('since='));
  check('8.8 SSE 失敗會退回輪詢（5 秒）', realtimeSrc.includes('events.json') && realtimeSrc.includes('5000'));
  check('8.9 離開頁面會 DELETE presence', realtimeSrc.includes('beforeunload') && realtimeSrc.includes('DELETE'));
  check('8.10 applyPresence 可呼叫（不會丟錯）', (() => {
    try { render.applyPresence(); render.updateOnline(); return true; } catch (err) { return false; }
  })());
  const layoutHtml = render.layoutHtml();
  check('8.11 layout 已移除 KPI 欄', !layoutHtml.includes('id="lp-kpi"') && !layoutHtml.includes('lp-col-kpi'));
  check('8.12 操作按鈕移到頂部公用工具列',
    ['add-selected', 'to-stock', 'copy-selected', 'suggest', 'export-xlsx', 'print', 'edit-plan']
      .every(action => layoutHtml.includes(`data-action="${action}"`)));
  check('8.12b 體積切換＝兩個緊貼按鈕（無分隔線 span＋aria-pressed）',
    (layoutHtml.match(/class="lp-view-btn/g) || []).length === 2 &&
    !layoutHtml.includes('lp-view-sep') &&
    (layoutHtml.match(/aria-pressed=/g) || []).length === 2);
  check('8.13 hover 只在錯誤列查詢錯誤訊息', interactionsSrc.includes('data-hover-error') && !interactionsSrc.includes('data-hover-mawb'));

  // ===== 9. Excel 貼上／匯出／列印 =====
  console.log('--- 9. Excel 整合 ---');
  const chatKpi = render.renderToolbar; // 保持函式存在（下面用字串檢查按鈕）
  check('9.1 KPI 有匯出 Excel 按鈕', /data-action="export-xlsx"/.test(
    fs.readFileSync(path.join(ROOT, 'public', 'js', 'loading-plan', 'render.js'), 'utf8')));
  check('9.2 KPI 有列印按鈕', /data-action="print"/.test(
    fs.readFileSync(path.join(ROOT, 'public', 'js', 'loading-plan', 'render.js'), 'utf8')));
  check('9.3 interactions 有 Excel 貼上/複製', interactionsSrc.includes('lpParseTsv') && interactionsSrc.includes('lpBuildTsv'));
  check('9.4 有 paste 事件（Ctrl+V）', /addEventListener\('paste'/.test(interactionsSrc));
  check('9.5 右鍵有「複製到 Excel」', interactionsSrc.includes('複製到 Excel'));
  check('9.6 右鍵有「貼上 Excel（TSV）」', interactionsSrc.includes('貼上 Excel（TSV）'));
  check('9.7 匯出走 export.xlsx', interactionsSrc.includes('/export.xlsx'));
  check('9.8 列印會先展開全部 plan', /printPlans/.test(interactionsSrc) && /window\.print/.test(interactionsSrc));
  check('9.9 paste.js 可載入', typeof (await import(url('public/js/loading-plan/paste.js'))).lpParseTsv === 'function');
  check('9.10 工具列狀態函式仍存在', typeof chatKpi === 'function');

  // ===== 10. 一鍵配艙建議 =====
  console.log('--- 10. 配艙建議 ---');
  const suggest = await import(url('public/js/loading-plan/suggest.js'));
  const renderSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'loading-plan', 'render.js'), 'utf8');
  check('10.1 KPI 有「配艙建議」按鈕', /data-action="suggest"/.test(renderSrc));
  check('10.2 interactions 有 TRIAL 試算', interactionsSrc.includes('openSuggestModal') && interactionsSrc.includes('TRY 試算'));
  check('10.3 interactions 有「套用勾選」', interactionsSrc.includes('套用勾選的'));
  check('10.4 有「保留現有明細」選項', interactionsSrc.includes('保留現有明細'));
  check('10.5 CSS 有建議清單樣式', css.includes('.lp-sg-row') && css.includes('.lp-sg-summary'));
  check('10.6 suggest.js 可載入', typeof suggest.lpSuggestLoad === 'function');
  const sg = suggest.lpSuggestLoad({
    candidates: [{ id: 1, gross_weight: 1000, cbm: 5 }, { id: 2, gross_weight: 900, cbm: 4 }],
    limits: { maxGrossWeight: 1200, maxCbm: 10 }
  });
  check('10.7 不會超過上限', sg.totals.gw <= 1200 + 1e-6 && sg.totals.cbm <= 10 + 1e-6,
    JSON.stringify({ gw: sg.totals.gw, cbm: sg.totals.cbm }));
  check('10.8 建議只回勾選用的 pickedIds', Array.isArray(sg.pickedIds) && sg.pickedIds.length === 1,
    JSON.stringify(sg.pickedIds));
  check('10.9 套用時會用 item_ids 走 Move', interactionsSrc.includes('applySuggestion') && interactionsSrc.includes('item_ids'));

  // ===== 11. Ctrl+V 與拖曳插入 =====
  console.log('--- 11. 貼上與拖曳排序 ---');
  check('11.1 Ctrl+V 掛在 document（任何位置都收得到）', /document\.addEventListener\('paste'/.test(interactionsSrc));
  check('11.2 只在「執 PLAN」可見時攔截貼上', interactionsSrc.includes('isLoadingPlanVisible'));
  check('11.3 開著 modal 時不搶貼上', interactionsSrc.includes("querySelector('.app-modal-overlay')"));
  check('11.4 拖曳會記住插入位置（dropTarget）', interactionsSrc.includes('dropTarget'));
  check('11.5 有插入線樣式 class', interactionsSrc.includes('is-drop-above') && interactionsSrc.includes('is-drop-below'));
  check('11.6 CSS 有插入線', css.includes('.lp-row.is-drop-above') && css.includes('.lp-row.is-drop-below'));
  check('11.7 同 plan 內拖曳 → reorder', interactionsSrc.includes('reorderWithinPlan'));
  check('11.8 跨 plan → Move 後再 reorder 到位置', interactionsSrc.includes('moveAndInsert') && interactionsSrc.includes('lpApi.reorder'));
  check('11.9 Undo 支援排序復原', interactionsSrc.includes("entry.type === 'reorder'"));
  const orderMod = await import(url('public/js/loading-plan/order.js'));
  check('11.10 order.js 可載入', typeof orderMod.lpMoveOrder === 'function');
  check('11.11 插入計算正確', JSON.stringify(orderMod.lpMoveOrder([1, 2, 3], [9], 2, false)) === JSON.stringify([1, 2, 9, 3]),
    JSON.stringify(orderMod.lpMoveOrder([1, 2, 3], [9], 2, false)));

  // ===== 12. 找 Booking／新增 Booking =====
  console.log('--- 12. 找 Booking／新增 Booking ---');
  check('12.1 「找 Booking」modal 有兩個分頁', interactionsSrc.includes('data-find-tab="search"') && interactionsSrc.includes('data-find-tab="new"'));
  check('12.2 新增分頁有建立後加入存貨的按鈕', interactionsSrc.includes('lp-bk-create') && interactionsSrc.includes('建立並加入存貨'));
  check('12.3 新增表單欄位齊全（MAWB／HAWB／CLIENT／DEST／PKGS／G.W／CBM／CRD／REMARK）',
    ['lp-bk-mawb', 'lp-bk-hawb', 'lp-bk-client', 'lp-bk-dest', 'lp-bk-pkgs',
      'lp-bk-gw', 'lp-bk-cbm', 'lp-bk-crd', 'lp-bk-remark']
      .every(id => interactionsSrc.includes(`id="${id}"`)));
  check('12.3b TAG 已刪除（與 REMARK 合併成同一欄；同時寫 tag 與 remark）',
    !interactionsSrc.includes('id="lp-bk-tag"') &&
    /tag: readField\('lp-bk-remark'\)/.test(interactionsSrc) &&
    /remark: readField\('lp-bk-remark'\)/.test(interactionsSrc));
  check('12.3c 新 Booking 的 CRD（DDMMM、↑↓ ±1 日、送出前轉 ISO）',
    interactionsSrc.includes("document.getElementById('lp-bk-crd')") &&
    interactionsSrc.includes('lpCrdStep(crdField.value') &&
    /payload\.cargo_receipt = crdParsed\.iso/.test(interactionsSrc));
  check('12.4 MAWB 已存在（409）會自動切到「找現有」並帶入搜尋',
    interactionsSrc.includes('err.status === 409') && interactionsSrc.includes("switchTab('search')"));
  check('12.5 CSS 有分頁／兩欄表單／錯誤訊息樣式',
    ['.lp-find-tab', '.lp-form.lp-bk-grid', '.lp-find-error'].every(token => css.includes(token)));
  check('12.6 apiFetch 會帶 HTTP 狀態碼（供 409 分支使用）',
    fs.readFileSync(path.join(ROOT, 'public', 'js', 'utils', 'api.js'), 'utf8').includes('error.status = res.status'));
  check('12.7 備註 REMARK 是多行 textarea（DIM 一組一行）＋「📐 輸入 DIM」按鈕',
    interactionsSrc.includes('<textarea id="lp-bk-remark"') &&
    interactionsSrc.includes('id="lp-bk-dim"') &&
    interactionsSrc.includes('📐 輸入 DIM') &&
    css.includes('.lp-bk-remark'));
  check('12.8 備註欄的 DIM 按鈕接到共用輸入器（openBookingDimEditor）',
    /openBookingDimEditor\(remarkField\)/.test(interactionsSrc) &&
    /function openBookingDimEditor\(field\)/.test(interactionsSrc));
  check('12.9 存貨工具列按鈕文案改為「找/新增Booking」', renderSrc.includes('🔍 找/新增Booking'));
  check('12.10 新增 Booking 的 MAWB 做嚴格驗證（validateMawb＋自動格式化）',
    interactionsSrc.includes('checkMawbField') &&
    interactionsSrc.includes('window.validateMawb') &&
    /payload\.mawb = mawbCheck\.formatted/.test(interactionsSrc));
  check('12.11 MAWB 驗證失敗標紅（.lp-input.is-invalid）',
    /classList\.toggle\('is-invalid'/.test(interactionsSrc) && css.includes('.lp-input.is-invalid'));

  // ===== 13. 連續選取 / 日期選擇 / 位置跳轉 =====
  console.log('--- 13. 操作增強 ---');
  check('13.1 明細／存貨 checkbox 有 Shift 連續選取提示',
    render.itemRow(item, plan, 0, { selectedSet: new Set() }).includes('Shift+點擊可連續選取') &&
    render.stockRow(item, stockPlan, 0, { selectedSet: new Set([item.id]) })
      .includes('Shift+點擊可連續選取'));
  check('13.2 Shift+點擊 → 整段選取（記住 anchor、避免 change 重複 toggle）',
    interactionsSrc.includes('applyRangeSelection') && interactionsSrc.includes('e.shiftKey') &&
    interactionsSrc.includes('rangeAnchor') && interactionsSrc.includes('rangeHandledBox'));
  check('13.3 連續選取會同步勾選狀態與 is-selected 樣式',
    /targetBox\.checked = box\.checked/.test(interactionsSrc) &&
    /classList\.toggle\('is-selected', box\.checked\)/.test(interactionsSrc));
  check('13.4 Flight Date 改用 <input type="date">（點擊開日曆）',
    /id="lp-f-date"[^>]*type="date"/.test(interactionsSrc) &&
    interactionsSrc.includes('toDateValue') && !interactionsSrc.includes('toDateInput'));
  check('13.5 「查看所有位置」清單可點擊跳轉（保留 lp-find-row class）',
    interactionsSrc.includes('lp-find-row lp-place-row') &&
    interactionsSrc.includes('jumpToItem') && interactionsSrc.includes('data-plan-id="${p.plan_id}"'));
  check('13.6 跳轉會展開 PLAN、載入明細並捲到該列',
    /state\.expanded\.add\(pid\)/.test(interactionsSrc) &&
    /loadDetail\(pid\)/.test(interactionsSrc) && interactionsSrc.includes('scrollIntoView'));
  check('13.7 目標列有閃爍 highlight（含 reduced-motion 靜態版）',
    css.includes('.lp-row.is-flash') && css.includes('@keyframes lpRowJumpFlash') &&
    /prefers-reduced-motion[\s\S]*?\.lp-row\.is-flash/.test(css));
  check('13.8 位置清單會標示「📍 現在的位置」（右鍵來源那一列）',
    interactionsSrc.includes('showPlacements(item.mawb, { planId, itemId: item.id })') &&
    interactionsSrc.includes('placeRowHtml') && interactionsSrc.includes('現在的位置') &&
    interactionsSrc.includes('is-current') && interactionsSrc.includes('aria-current="true"') &&
    css.includes('.lp-place-row.is-current') && css.includes('.lp-find-now'));

  // ===== 14. REMARK 自由文字／DIM 快捷輸入 =====
  console.log('--- 14. REMARK／DIM ---');
  const routesSrc = fs.readFileSync(path.join(ROOT, 'routes', 'loading-plan', 'index.js'), 'utf8');
  check('14.1 REMARK 雙擊改用 textarea 就地編輯（可多行）',
    interactionsSrc.includes('lp-inline-textarea') && interactionsSrc.includes("field === 'tag'") &&
    interactionsSrc.includes("createElement(multiline ? 'textarea' : 'input')"));
  check('14.2 滑鼠移入 REMARK 向下展開完整內容（fixed 定位不裁切）',
    interactionsSrc.includes('showRemark') && interactionsSrc.includes('lp-remark-pop') &&
    interactionsSrc.includes('placeFloating') && interactionsSrc.includes("closest('.lp-c-tag[data-field=\"tag\"]')"));
  check('14.3 展開面板右側有 DIM 按鈕（右鍵選單也有入口）',
    interactionsSrc.includes('lp-dim-btn') && interactionsSrc.includes('📐 DIM') &&
    interactionsSrc.includes('📐 輸入 DIM（L×W×H / PCS）'));
  check('14.4 DIM 格式 L × W × H / PCS（四格輸入＋純函式）',
    interactionsSrc.includes('data-dim="${field}"') &&
    interactionsSrc.includes('lpNormalizeDimRows') && interactionsSrc.includes('lpAppendDim'));
  check('14.5 Tab 換下一格；PCS 後 Tab 新增一列',
    interactionsSrc.includes("e.key === 'Tab'") && interactionsSrc.includes('addDimRow(editor)'));
  check('14.6 Enter 完成（附加到 REMARK 後 PATCH tag）',
    interactionsSrc.includes('saveDim') && interactionsSrc.includes('lpApi.patchItem(item.id, { tag: appended.text })'));
  check('14.7 後端 tag／remark 保留換行（DIM 一組一行，上限 500）',
    routesSrc.includes('strMultiline') && /field === 'tag' \|\| field === 'remark'/.test(routesSrc) &&
    /strMultiline\(\(row \|\| \{\}\)\.tag, 500\)/.test(routesSrc));
  const dimMod = await import(url('public/js/loading-plan/dim.js'));
  check('14.8 dim.js 可載入（DIM 格式／驗證純函式）',
    typeof dimMod.lpNormalizeDimRows === 'function' && typeof dimMod.lpAppendDim === 'function' &&
    typeof dimMod.lpDimLine === 'function' && dimMod.LP_DIM_HEADER === 'DIM(CM):');
  check('14.9 DIM 上一行自動加 DIM(CM):（重複附加不重複）', (() => {
    const once = dimMod.lpAppendDim('4 / D6', ['60 x 40 x 50 / 10']).text;
    const twice = dimMod.lpAppendDim(once, ['30 x 20 x 10 / 5']).text;
    return once === '4 / D6\nDIM(CM):\n60 x 40 x 50 / 10' &&
      (twice.match(/DIM\(CM\):/g) || []).length === 1 &&
      twice.endsWith('60 x 40 x 50 / 10\n30 x 20 x 10 / 5');
  })());
  check('14.10 DIM 輸入器抽成共用（openDimPanel；PLAN 用 tag 當 existingText）',
    interactionsSrc.includes('function openDimPanel(anchorEl, ctx)') &&
    /openDimPanel\(cell, \{/.test(interactionsSrc) &&
    /existingText: item\.tag/.test(interactionsSrc));
  check('14.11 Booking modal 的 DIM 只寫回 textarea（建立時才送出，不打 API）', (() => {
    const start = interactionsSrc.indexOf('function openBookingDimEditor');
    const end = start >= 0 ? interactionsSrc.indexOf('async function addRecords', start) : -1;
    const block = start >= 0 ? interactionsSrc.slice(start, end > start ? end : start + 600) : '';
    return block.includes('field.value = appended.text') && !block.includes('lpApi.');
  })());
  check('14.12 Booking 建立時 remark 保留換行（fieldsFromRow 用 strMultiline）',
    /remark: strMultiline\(\(row \|\| \{\}\)\.remark, 500\)/.test(routesSrc));
  check('14.13 DIM 內的 Esc 不會關掉外層 modal（stopPropagation）',
    /e\.key === 'Escape'[\s\S]{0,160}e\.stopPropagation\(\)/.test(interactionsSrc));

  // ===== 15. CRD（Cargo Ready Date）：CBM 與 REMARK 之間；DDMMM；↑↓ ±1 日；不可遲於 Flight Date =====
  console.log('--- 15. CRD ---');
  const crdSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'loading-plan', 'crd.js'), 'utf8');
  const crdMod = await import(url('public/js/loading-plan/crd.js'));
  check('15.0 crd.js 可載入（lpCrdStep／lpCrdParseInput）',
    typeof crdMod.lpCrdStep === 'function' && typeof crdMod.lpCrdParseInput === 'function');
  const head = render.rowHead('vol');
  const crdHeadIdx = head.indexOf('lp-c-crd');
  check('15.1 表頭在 CBM 與 REMARK 之間多一欄 CRD',
    crdHeadIdx > head.indexOf('lp-c-cbm') && crdHeadIdx < head.indexOf('lp-c-tag') &&
    /class="lp-c-crd"[^>]*>CRD</.test(head), head.slice(0, 400));
  const crdPlain = render.itemRow(item, plan, 0, { selectedSet: new Set() });
  check('15.2 明細列有 CRD 輸入框（空白時顯示空白）',
    crdPlain.includes('lp-crd-input') && crdPlain.includes('data-crd-input') &&
    crdPlain.includes('data-crd-item="11"') && crdPlain.includes('value=""'));
  const crdOk = render.itemRow(Object.assign({}, item, { cargo_receipt: '2026-11-14' }),
    { id: 7, volume_view: 'vol', flight_date: '2026-11-14' }, 0, { selectedSet: new Set() });
  check('15.3 CRD 以 DDMMM 顯示（ISO → 14NOV）且不標紅',
    crdOk.includes('value="14NOV"') && !/lp-crd-input[^"]*is-invalid/.test(crdOk) &&
    !crdOk.includes('不可遲於'));
  const crdBad = render.itemRow(Object.assign({}, item, { cargo_receipt: '2026-11-16' }),
    { id: 7, volume_view: 'vol', flight_date: '2026-11-14' }, 0, { selectedSet: new Set() });
  check('15.4 CRD 比 Flight Date 遲 → 紅框＋hover 錯誤訊息（通知 USER）',
    /class="lp-crd-input is-invalid"/.test(crdBad) &&
    /data-hover-error="[^"]*CRD 16NOV 不可遲於 Flight Date 14NOV/.test(crdBad));
  check('15.5 存貨／沒有 Flight Date 的列不做 CRD 檢核',
    !/lp-crd-input[^"]*is-invalid/.test(render.itemRow(
      Object.assign({}, item, { cargo_receipt: '2026-11-16' }), { id: 30, volume_view: 'vol' }, 0, { selectedSet: new Set() })));
  check('15.6 合計列的 CRD 欄留空（逐欄對齊）', /class="lp-c-crd"><\/span>/.test(totalRow));
  check('15.7 CSS 有 CRD 欄寬／輸入框／錯誤樣式',
    /grid-template-columns: 24px 24px 104px 42px 116px 70px 76px 76px 70px 62px/.test(css) &&
    css.includes('.lp-c-crd') && css.includes('.lp-crd-input') && css.includes('.lp-crd-input.is-invalid'));
  check('15.7b CRD 表頭與下方日期一起靠右（右緣對齊）',
    /\.lp-c-crd \{[^}]*justify-content: flex-end/.test(css) &&
    /\.lp-crd-input \{[^}]*text-align: right/.test(css) &&
    /\.lp-row-head \.lp-c-crd \{[^}]*padding-right: 3px/.test(css));
  check('15.7c CRD 與 REMARK 之間加大欄距（不影響其他欄位）',
    /\.lp-c-crd \{[^}]*margin-right: 10px/.test(css));
  check('15.8 游標進入停在 DD 位（前 2 碼）＋空白先帶入今天',
    interactionsSrc.includes('selectCrdDay') && interactionsSrc.includes('setSelectionRange(0') &&
    interactionsSrc.includes('lpFormatCrd(lpTodayIso())'));
  check('15.9 ↑ +1 日／↓ −1 日（跨月／跨年由 lpShiftIsoDate 處理）',
    interactionsSrc.includes("e.key === 'ArrowUp'") && interactionsSrc.includes("e.key === 'ArrowDown'") &&
    interactionsSrc.includes('lpCrdStep(input.value') && crdSrc.includes('lpShiftIsoDate(base'));
  check('15.10 邏輯檢核：CRD 不可遲於 Flight Date（前端 toast／後端 422）',
    interactionsSrc.includes('toastCrdError') && interactionsSrc.includes('toastCrdError(parsed.issue)') &&
    interactionsSrc.includes('lpCrdParseInput(raw, flight, saved, lpTodayIso())') &&
    routesSrc.includes("code: 'crd_after_flight'") && routesSrc.includes('c.lpCrdIssue(iso, flightDate)'));
  check('15.11 只有真的改過才存；Enter 立即存、Esc 還原',
    interactionsSrc.includes('commitCrd(input, { refocus: true })') &&
    interactionsSrc.includes("input.dataset.crdDirty") && interactionsSrc.includes('resetCrdDisplay(input)'));
  check('15.12 即時同步打字中不重畫（含 CRD 輸入框）',
    realtimeSrc.includes("classList.contains('lp-crd-input')"));
  check('15.13 CRD 走 PATCH /items（cargo_receipt，DB 存 ISO）',
    /lpApi\.patchItem\(itemId, \{ cargo_receipt: iso \}\)/.test(interactionsSrc) &&
    /cargo_receipt = \?/.test(routesSrc));

  // ===== 16. 封存（ARCHIVE）／RECALL =====
  console.log('--- 16. 封存 / RECALL ---');
  const planArchived = {
    id: 41, type: 'flight', plan_no: 'LP-D7-EK9859-09', day_code: 'D7',
    flight_no: 'EK1000', flight_date: '2026-11-24', owner_company: 'SKY DRAGON',
    contour_code: 'H3', volume_view: 'vol', archived_at: '2026-11-24 06:30:00', archived_by: 'admin',
    totals: { grossWeight: 100, cbm: 1, tickets: 1, mawbs: 1, pcs: 1, vol: 166.67 }
  };
  const archivedCard = render.planCard(planArchived);
  check('16.1 封存卡片有 is-archived（虛線／淡化）',
    /class="lp-plan[^"]*is-archived/.test(archivedCard) &&
    /\.lp-plan\.is-archived \{[^}]*border-style: dashed/.test(css));
  check('16.2 封存卡片提供「♻ RECALL」按鈕',
    archivedCard.includes('data-action="recall-plan"') && archivedCard.includes('♻ RECALL'));
  check('16.3 封存卡片不展開明細、也不提供封存／收合按鈕',
    !archivedCard.includes('lp-plan-body') &&
    !archivedCard.includes('data-action="archive-plan"') &&
    !archivedCard.includes('data-action="toggle-plan"'));
  check('16.4 封存卡片標示封存時間與提示',
    archivedCard.includes('lp-archived-note') && archivedCard.includes('已封存') &&
    archivedCard.includes('lp-archived-hint'));
  check('16.5 封存卡片標題不啟動 PLAN（只能 RECALL）',
    archivedCard.includes('data-action="archived-plan"') &&
    !archivedCard.includes('data-action="activate-plan"'));
  check('16.6 封存時間格式化（UTC → 當地 yyyy/mm/dd hh:mm）',
    /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(render.archivedStamp(planArchived)));
  const normalCard = render.planCard({ id: 42, type: 'flight', flight_no: 'EK1', volume_view: 'vol', totals: {} });
  check('16.7 一般卡片有「封存」文字按鈕（不是只有圖示）',
    normalCard.includes('data-action="archive-plan"') &&
    /data-action="archive-plan"[\s\S]{0,200}>封存<\/button>/.test(normalCard) &&
    /\.lp-archive-btn \{[^}]*border-color: rgba\(180, 83, 9/.test(css));
  check('16.8 PLAN 欄表頭有封存清單切換＋張數', (() => {
    const layout = render.layoutHtml();
    return layout.includes('id="lp-archive-toggle"') &&
      layout.includes('data-action="toggle-archived"') &&
      layout.includes('id="lp-archived-count"') &&
      /\.lp-archive-toggle\.is-on \{/.test(css);
  })());
  check('16.9 state 有 archivedPlans／showArchived＋archivedFlightPlans／archivedPlanById', (() => {
    stateMod.state.archivedPlans = [{ id: 41, type: 'flight' }, { id: 30, type: 'stock' }];
    const onlyFlight = stateMod.archivedFlightPlans();
    const found = stateMod.archivedPlanById(41);
    const before = stateMod.state.showArchived;
    stateMod.toggleShowArchived();
    const toggled = stateMod.state.showArchived !== before;
    stateMod.toggleShowArchived();
    stateMod.state.archivedPlans = [];
    return onlyFlight.length === 1 && onlyFlight[0].id === 41 && !!found && toggled;
  })());
  calledUrl = '';
  await api.lpApi.plans({ archived: 1 });
  check('16.10 /plans?archived=1（封存清單）', calledUrl === '/api/loading-plan/plans?archived=1', calledUrl);
  await api.lpApi.archivePlan(5);
  check('16.11 封存走 POST /plans/5/archive', calledUrl === '/api/loading-plan/plans/5/archive', calledUrl);
  await api.lpApi.recallPlan(5);
  check('16.12 RECALL 走 POST /plans/5/recall', calledUrl === '/api/loading-plan/plans/5/recall', calledUrl);
  check('16.13 loadAll 會同時抓封存清單', interactionsSrc.includes('lpApi.plans({ archived: 1 })'));
  check('16.14 封存／RECALL 有確認與提示，並會重新載入',
    interactionsSrc.includes('function archivePlan') && interactionsSrc.includes('window.confirm') &&
    interactionsSrc.includes('lpApi.archivePlan') && interactionsSrc.includes('lpApi.recallPlan') &&
    interactionsSrc.includes('已 RECALL'));
  check('16.15 右鍵選單：正常可封存、封存只能 RECALL',
    interactionsSrc.includes('🗄 封存 PLAN（可 RECALL）') &&
    interactionsSrc.includes('♻ RECALL（取回 PLAN 列表）'));
  check('16.16 封存卡片不接受拖入', interactionsSrc.includes('.lp-plan:not(.is-archived)'));
  check('16.17 CSS：RECALL 按鈕／封存提示／列印隱藏封存切換',
    css.includes('.lp-recall-btn') && css.includes('.lp-archived-hint') &&
    /@media print \{[\s\S]*?\.lp-archive-toggle/.test(css));
  check('16.18 後端：archive／recall 路由＋預設排除封存',
    /router\.post\('\/plans\/:id\/archive'/.test(routesSrc) &&
    /router\.post\('\/plans\/:id\/recall'/.test(routesSrc) && /return !p\.archived_at/.test(routesSrc));
  check('16.19 後端：封存的 PLAN 不列入重複 MAWB／不可加入明細',
    /WHERE p\.archived_at IS NULL/.test(routesSrc) &&
    /已封存，請先 RECALL 再加入明細/.test(routesSrc));
  check('16.20 位置清單標示「（已封存）」且不展開（只能 RECALL）',
    interactionsSrc.includes('lp-archived-place-tag') &&
    interactionsSrc.includes('已封存；按「♻ RECALL」取回後才能查看明細') &&
    /p\.archived_at/.test(routesSrc));
  check('16.21 CSS 有位置清單封存樣式',
    css.includes('.lp-archived-place-tag') && css.includes('.lp-place-row.is-archived-place'));

  console.log(`\n===== 測試結束：${pass} 通過 / ${fail} 失敗 =====`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => {
  console.error('測試失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});
