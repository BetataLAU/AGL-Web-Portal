// ===== 執 PLAN：靜態預覽產生器 =====
// 用途：不用登入、不用開伺服器，就能把工作台（存貨＋PLANS）畫成一張 static HTML 目視檢查版面。
// 用法：node scripts/loading-plan-preview.js
// 輸出：data/work/loading-plan-preview.html（用瀏覽器打開即可；data/work 不進版控）
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'work', 'loading-plan-preview.html');
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const noop = () => {};
function fakeNode() {
  return {
    innerHTML: '', textContent: '', style: {}, dataset: {},
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: noop, appendChild: noop, remove: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false }
  };
}

const registry = new Map();
function reg(id) {
  if (!registry.has(id)) registry.set(id, fakeNode());
  return registry.get(id);
}
['lp-stock-list', 'lp-stock-count', 'lp-stock-summary', 'lp-plan-list',
  'lp-plans-total', 'lp-plan-count', 'lp-btn-undo', 'lp-btn-add-selected', 'lp-conn'].forEach(reg);

global.document = {
  getElementById: (id) => (registry.has(id) ? registry.get(id) : null),
  createElement: () => fakeNode(),
  addEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
  body: fakeNode(), activeElement: null
};
global.window = { addEventListener: noop, innerWidth: 1440, innerHeight: 900 };

(async () => {
  const calc = await import(url('public/js/loading-plan/calc.js'));
  const stateMod = await import(url('public/js/loading-plan/state.js'));
  const render = await import(url('public/js/loading-plan/render.js'));

  // ---- 假資料（照 AGL執PLAN.xlsx 真實數值）----
  const mkItem = (id, mawb, client, dest, pkgs, gw, cbm, vol, tag, extra = {}) => Object.assign({
    id, mawb, client, dest, pkgs_text: pkgs,
    cartons: calc.lpParsePkgs(pkgs).cartons,
    pallets: calc.lpParsePkgs(pkgs).pallets,
    pcs_total: calc.lpParsePkgs(pkgs).pcsTotal,
    gross_weight: gw, cbm, volume_weight: vol,
    cuft: calc.lpCuftFromCbm(cbm),
    volume: calc.lpItemVolume({ cbm, volume_weight: vol }),
    tag
  }, extra);

  const planA = {
    id: 31, type: 'flight', plan_no: 'LP-D7-EK9859-01', day_code: 'D7',
    flight_no: 'EK9859', flight_date: '2026-11-14', etd: '22:35', owner_company: 'SKY DRAGON',
    contour_code: 'H3', contour_qty: 2, contour_text: '2 X H3', volume_view: 'vol',
    max_gross_weight: 9000, max_cbm: 65, status: 'draft', sort_order: 0
  };
  const planB = {
    id: 32, type: 'flight', plan_no: 'LP-D6-EK9845-02', day_code: 'D6',
    flight_no: 'EK9845', flight_date: '', owner_company: 'SPACE',
    contour_code: 'Q5', contour_qty: 1, contour_text: '1 X Q5', volume_view: 'vol',
    max_gross_weight: 9000, max_cbm: 65, status: 'draft', sort_order: 1
  };
  const itemsA = [
    mkItem(101, '176-6985 5240', 'MAERSK', 'DWC', '17+7P', 1302, 6.82, 1135, '4 / D6', { dg_no_power: 1 }),
    mkItem(102, '176-6840 0640', 'MAERSK', 'DWC', '3+4P', 220, 1.43, 238, '1 / D7'),
    mkItem(103, '176-6840 0636', 'MAERSK', 'DWC', '4P', 298, 3.4, 566, '5 / D7', { h_xray: 1 }),
    mkItem(104, '', '', 'DXB', 'CTNS', 59, 0.36, 60.5, '', { pcs_total: null }),
    mkItem(105, '176-6840 0721', 'Soaring', 'ABJ', '1P', 118, 0.95, 158, '直單', { split_of_item_id: 101 })
  ];
  const itemsB = [
    mkItem(201, '176-6839 7405', 'MAERSK', 'DWC', '8P', 1560, 9.23, 1538, '5 / CP / D2'),
    mkItem(202, '176-6839 7416', 'MAERSK', 'DWC', '8P', 1560, 9.23, 1538, '6 / CP / D2')
  ];

  planA.totals = calc.lpKpi(itemsA, { maxGrossWeight: 9000, maxCbm: 65 });
  planB.totals = calc.lpKpi(itemsB, { maxGrossWeight: 9000, maxCbm: 65 });

  stateMod.state.stock = {
    id: 30, type: 'stock', plan_no: 'LP-STOCK-99', day_code: 'STOCK',
    volume_view: 'vol', totals: calc.lpKpi(itemsB)
  };
  stateMod.state.stockItems = [
    mkItem(301, '176-6558 7491', 'MAERSK', 'DXB', '60', 318, 2.04, 340, '2 / D1'),
    mkItem(302, '176-6985 5074', 'MAERSK', 'DWC', '2P', 163, 0.92, 153, '1 / D2'),
    mkItem(303, '176-6843 9976', 'RS', 'AMS', 'CTNS', 1000, 6, 1000, 'D3/11', { pcs_total: null })
  ];
  stateMod.state.plans = [planA, planB];
  stateMod.state.details.set(31, itemsA);
  stateMod.state.details.set(32, itemsB);
  stateMod.state.expanded.add(31);
  stateMod.state.selectedStock.add(301);
  stateMod.state.selectedItems.add(103);
  stateMod.setActivePlan(31);

  render.renderStock();
  render.renderToolbar();
  render.renderPlans();

  const countEl = reg('lp-stock-count');
  const planCountEl = reg('lp-plan-count');
  const plansTotalEl = reg('lp-plans-total');

  let html = render.layoutHtml();
  html = html
    .replace('<div class="lp-stock-list" id="lp-stock-list"></div>',
      `<div class="lp-stock-list" id="lp-stock-list">${reg('lp-stock-list').innerHTML}</div>`)
    .replace('<div class="lp-plan-list" id="lp-plan-list"></div>',
      `<div class="lp-plan-list" id="lp-plan-list">${reg('lp-plan-list').innerHTML}</div>`)
    .replace('<span class="lp-count" id="lp-stock-count"></span>',
      `<span class="lp-count" id="lp-stock-count">${countEl.textContent || '3 筆'}</span>`)
    .replace('<span class="lp-count" id="lp-plans-total"></span>',
      `<span class="lp-count" id="lp-plans-total">${plansTotalEl.textContent || '2 張'}</span>`)
    .replace('<span class="lp-count" id="lp-plan-count"></span>',
      `<span class="lp-count" id="lp-plan-count">${planCountEl.textContent || ''}</span>`)
    .replace('<footer class="lp-stock-foot" id="lp-stock-summary"></footer>',
      `<footer class="lp-stock-foot" id="lp-stock-summary">${reg('lp-stock-summary').innerHTML}</footer>`);

  const baseCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'base.css'), 'utf8');
  const lpCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'loading-plan.css'), 'utf8');

  const page = `<!doctype html><meta charset="utf-8">
<title>執 PLAN 工作台（靜態預覽）</title>
<style>${baseCss}
${lpCss}
body { padding: 14px; background: var(--app-bg, #eef2f7); }
.lp-preview-note { margin: 0 0 10px; font-size: .78rem; color: #64748b; }
</style>
<p class="lp-preview-note">靜態預覽（假資料，不會連伺服器）｜左欄＝存貨、右欄＝PLANS；H3 是已收錄板型（綠 TAG）、Q5 未收錄（虛線 TAG）。</p>
${html}`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, page, 'utf8');
  console.log('預覽已產生：', OUT);
})().catch((err) => {
  console.error('產生預覽失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});
