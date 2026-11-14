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
  ['.lp-layout', '.lp-col-stock', '.lp-kpi', '.lp-plan', '.lp-row', '.lp-context-menu',
    '.lp-tag-contour', '.lp-tag-owner', '.lp-inline-input', '.lp-toast', '@media print',
    'grid-template-columns: 330px 300px'].forEach((token) => {
    check(`3.x 有 ${token}`, css.includes(token));
  });

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
  check('5.12 顯示 VOL 與 CBM', row.includes('1,135.00') && row.includes('6.820'));
  check('5.13 DG flag（966）有標示', row.includes('lp-flags') && row.includes('966'));
  check('5.14 hover 位置屬性', row.includes('data-hover-mawb="176-6985 5240"'));

  const cuftRow = render.itemRow(item, { id: 7, volume_view: 'cuft' }, 0, { selectedSet: new Set() });
  check('5.15 cu.ft 模式顯示 240.85', cuftRow.includes('240.85'));

  const missing = render.itemRow(
    { id: 12, mawb: '', cbm: 1, volume: { cbm: 1, vol: 166.67, cuft: 35.31 } },
    plan, 1, { selectedSet: new Set() }
  );
  check('5.16 缺 MAWB → 黃字警告', missing.includes('is-warn') && missing.includes('缺 MAWB'));

  const dup = render.itemRow(Object.assign({}, item, { split_of_item_id: 5 }), plan, 2, { selectedSet: new Set() });
  check('5.17 複製的明細有重複標記', dup.includes('is-dup') && dup.includes('lp-dup'));

  const selected = render.itemRow(item, plan, 0, { selectedSet: new Set([11]) });
  check('5.18 已選取 → is-selected + checked',
    selected.includes('is-selected') && selected.includes('checked'));

  const card = render.planCard({
    id: 7, type: 'flight', flight_no: 'EK9859', flight_date: '2026-11-14',
    owner_company: 'SKY DRAGON', day_code: 'D7', volume_view: 'vol',
    totals: { grossWeight: 4304, cbm: 35.62, tickets: 10, pcs: 148, maxGrossWeight: 9000, gwPct: 47.8, overWeight: 0 }
  });
  check('5.19 卡片標題 = Flight / Date / Owner', card.includes('EK9859 / 14NOV / SKY DRAGON'));
  check('5.20 卡片有 KPI 與展開箭頭',
    card.includes('4,304 / 9,000') && card.includes('data-action="toggle-plan"'));
  check('5.21 超重時卡片標紅', render.planCard({
    id: 8, type: 'flight', flight_no: 'EK1', owner_company: 'X', volume_view: 'vol',
    totals: { grossWeight: 9500, maxGrossWeight: 9000, overWeight: 500, gwPct: 105.6, cbm: 1, tickets: 1, pcs: 1 }
  }).includes('is-over'));

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

  // ===== 9. Excel 貼上／匯出／列印 =====
  console.log('--- 9. Excel 整合 ---');
  const chatKpi = render.renderKpi; // 保持函式存在（下面用字串檢查按鈕）
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
  check('9.10 KPI 函式仍存在', typeof chatKpi === 'function');

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

  console.log(`\n===== 測試結束：${pass} 通過 / ${fail} 失敗 =====`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => {
  console.error('測試失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});
