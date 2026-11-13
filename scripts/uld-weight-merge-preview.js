// ===== ULD 夾重系統：③ 合併／分配頁 預覽產生器 ====
// 用途：不用登入、不用開伺服器，就能把「合併／分配」頁畫成一張 static HTML 目視檢查版面
//       （改 CSS／render 之後先看這個，再去跑測試）。
// 用法：node scripts/uld-weight-merge-preview.js [--picked] [--demo-hover]
//   --picked     多產「已點選 MAWB」畫面（卡片會長出「＋ 加入（n 件）」）
//   --demo-hover 多產「十字高亮」示意（用 class 模擬 hover：第 2 票 × 第 2 張卡）
// 輸出：data/work/uldw-merge-preview.html（用瀏覽器打開即可；data/work 不進版控）
//
// 假資料刻意照概念圖：左邊 4 票 MAWB（全部已分配）、右邊 3 塊 ULD（其中一票是 UN3481）。
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const BASE = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight')).href;
const OUT = path.join(__dirname, '..', 'data', 'work', 'uldw-merge-preview.html');
const OUT_37 = path.join(__dirname, '..', 'data', 'work', 'uldw-merge-preview-37.html');

// 最小 DOM stub（與 scripts/test-uld-weight-frontend.js 相同做法）
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, remove() {} })
};
globalThis.window = globalThis;

function makeRoot() {
  return {
    _html: '',
    set innerHTML(value) { this._html = value; },
    get innerHTML() { return this._html; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    appendChild() {}
  };
}

// 4 票 × 3 板（MAWB 檢查碼合法：前 7 位 mod 7）
function demoDetail() {
  return {
    id: 1, sheet_no: 'WGT-20261113-01', sheet_date: '2026-11-13', terminal: 'CPSL',
    flight_no: 'CX88', flight_date: '2026-11-13', round_px: 1, round_b: 1,
    tail_mode: 'adjust_largest', diff_warn_pct: 2, diff_warn_kg: 100,
    clamp_min_pct: 0, clamp_max_pct: 0, handler: 'tester', remark: '', status: 'draft',
    allow_half_kg: 0,
    mawb_rows: [
      { id: 1, seq: 0, mawb: '93300000000', dest: 'AMS', pcs: 100, declared_weight: 1350, auto_alloc: 1, is_squeeze: 1 },
      { id: 2, seq: 1, mawb: '93331234571', dest: 'AMS', pcs: 50, declared_weight: 954, auto_alloc: 1, is_squeeze: 1 },
      { id: 3, seq: 2, mawb: '93345460645', dest: 'AMS', pcs: 26, declared_weight: 720, auto_alloc: 1, is_squeeze: 1 },
      { id: 4, seq: 3, mawb: '93335142660', dest: 'AMS', pcs: 20, declared_weight: 444, auto_alloc: 1, is_squeeze: 1 }
    ],
    ulds: [
      {
        id: 1, kind: 'ULD', uld_number: 'PMWC11111KZ', contour_code: 'Q7', port: 'AMS',
        pcs: 101, tare_weight: 110, rcl_gross_weight: 2140, predecl_type: 'X',
        squeeze_mode: 'weight', lih_type: 'UN3481',
        items: [
          { id: 1, mawb: '93300000000', port: 'AMS', pcs: 50, declared_weight: 0, is_squeeze: 1 },
          { id: 2, mawb: '93331234571', port: 'AMS', pcs: 25, declared_weight: 0, is_squeeze: 1 },
          { id: 3, mawb: '93345460645', port: 'AMS', pcs: 26, declared_weight: 0, is_squeeze: 1, lih_type: 'UN3481' }
        ]
      },
      {
        id: 2, kind: 'ULD', uld_number: 'PMWC22222KZ', contour_code: 'Q7', port: 'AMS',
        pcs: 101, tare_weight: 110, rcl_gross_weight: 2140, predecl_type: 'X',
        squeeze_mode: 'weight', lih_type: 'UN3481',
        items: [
          { id: 4, mawb: '93300000000', port: 'AMS', pcs: 50, declared_weight: 0, is_squeeze: 1 },
          { id: 5, mawb: '93331234571', port: 'AMS', pcs: 25, declared_weight: 0, is_squeeze: 1 },
          { id: 6, mawb: '93345460645', port: 'AMS', pcs: 26, declared_weight: 0, is_squeeze: 1, lih_type: 'UN3481' }
        ]
      },
      {
        id: 3, kind: 'ULD', uld_number: 'PMC33333HK', contour_code: 'Q6', port: 'AMS',
        // 故意留白 RCL：預覽要看得到卡片頭的「未過磅」標籤
        pcs: 20, tare_weight: 105, rcl_gross_weight: 0, predecl_type: 'P',
        squeeze_mode: 'weight', lih_type: 'N',
        items: [
          { id: 7, mawb: '93335142660', port: 'AMS', pcs: 20, declared_weight: 0, is_squeeze: 1 }
        ]
      }
    ]
  };
}

// 37 板壓測：同一份 MAWB LIST，右邊鋪 37 張卡（看密度／換行；卡片不會被拉寬）
function stressDetail() {
  const detail = demoDetail();
  const mawbs = detail.mawb_rows;
  detail.id = 2;
  detail.sheet_no = 'WGT-20261113-37';
  detail.ulds = Array.from({ length: 37 }, (_, i) => ({
    id: 100 + i,
    kind: 'ULD',
    uld_number: `PMC${String(20000 + i)}HK`,
    contour_code: i % 3 === 0 ? 'Q6' : 'Q7',
    port: 'AMS',
    pcs: 20,
    tare_weight: 105,
    rcl_gross_weight: 900 + i * 10,
    predecl_type: 'P',
    squeeze_mode: 'weight',
    lih_type: i % 4 === 0 ? 'UN3481' : 'N',
    items: [{
      id: 1000 + i,
      mawb: mawbs[i % mawbs.length].mawb,
      port: 'AMS',
      pcs: 20,
      declared_weight: 0,
      is_squeeze: 1,
      lih_type: i % 4 === 0 ? 'UN3481' : 'N'
    }]
  }));
  return detail;
}

(async () => {
  const state = await import(`${BASE}/state.js`);
  const render = await import(`${BASE}/render.js`);
  const cssDir = path.join(__dirname, '..', 'public', 'css');
  const css = fs.readFileSync(path.join(cssDir, 'uld-weight.css'), 'utf8');
  // 預覽用：一併載入 base.css（主題變數）＋ components.css（按鈕／卡片），畫面才跟實際站上一致
  const baseCss = fs.existsSync(path.join(cssDir, 'base.css'))
    ? fs.readFileSync(path.join(cssDir, 'base.css'), 'utf8') : '';
  const compCss = fs.existsSync(path.join(cssDir, 'components.css'))
    ? fs.readFileSync(path.join(cssDir, 'components.css'), 'utf8') : '';

  const renderPreview = (detail, out) => {
    state.uldWeightState.current = state.uldSheetFromApi(detail);
    state.uldWeightState.ui = {
      step: 'merge', view: 'cards', gridSortMawb: false, more: false, advanced: false,
      expanded: {}, expandAll: false, printUnit: null, mergePick: null
    };
    const root = makeRoot();
    render.renderEditor(root);
    const html = root.innerHTML;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(
      out,
      `<!doctype html><meta charset="utf-8"><title>ULD 合併／分配頁預覽</title>
<style>${baseCss}
${compCss}
${css}
body { padding: 16px; background: var(--app-bg, #eef2f7); }
</style>${html}`,
      'utf8'
    );
    return html;
  };

  const html = renderPreview(demoDetail(), OUT);
  const html37 = renderPreview(stressDetail(), OUT_37);

  // 選配：--picked 會多產一張「已點選 MAWB」的畫面（每張卡會長出「＋ 加入」按鈕）
  if (process.argv.includes('--picked')) {
    const pickedSheet = demoDetail();
    state.uldWeightState.current = state.uldSheetFromApi(pickedSheet);
    const firstRow = state.uldWeightState.current.mawbs[0];
    state.uldWeightState.ui = {
      step: 'merge', view: 'cards', gridSortMawb: false, more: false, advanced: false,
      expanded: {}, expandAll: false, printUnit: null, mergePick: firstRow ? firstRow.uid : null
    };
    const pickedRoot = makeRoot();
    render.renderEditor(pickedRoot);
    const pickedOut = path.join(__dirname, '..', 'data', 'work', 'uldw-merge-preview-picked.html');
    fs.writeFileSync(
      pickedOut,
      `<!doctype html><meta charset="utf-8"><title>ULD 合併／分配頁預覽（已點選 MAWB）</title>
<style>${baseCss}
${compCss}
${css}
body { padding: 16px; background: var(--app-bg, #eef2f7); }
</style>${pickedRoot.innerHTML}`,
      'utf8'
    );
    console.log('已點選 MAWB 的預覽：', pickedOut);
  }

  // 選配：--demo-hover 會多產一張「十字高亮」示意圖（用 class 模擬 hover：第 2 票 × 第 2 張卡）
  if (process.argv.includes('--demo-hover')) {
    const hoverOut = path.join(__dirname, '..', 'data', 'work', 'uldw-merge-preview-hover.html');
    const hoverScript = `<script>
(() => {
  const items = document.querySelectorAll('.uldw-mx-cell[data-item-uid]');
  const heads = document.querySelectorAll('.uldw-mx-head');
  if (items.length < 2 || heads.length < 2) return;
  const key = items[1].dataset.mawbKey;
  const unit = heads[1].dataset.uid;
  document.querySelectorAll('[data-mawb-key]').forEach(el => {
    if (el.dataset.mawbKey === key) el.classList.add('is-xh-row');
  });
  document.querySelectorAll('[data-merge-unit]').forEach(el => {
    if (el.dataset.uid === unit) el.classList.add('is-xh-col');
  });
})();
</script>`;
    const hoverHtml = fs.readFileSync(OUT, 'utf8') + hoverScript;
    fs.writeFileSync(hoverOut, hoverHtml, 'utf8');
    console.log('十字高亮示意（模擬 hover 第 2 票 × 第 2 張卡）：', hoverOut);
  }

  const chips = (html.match(/data-mawb-chip="1"/g) || []).length;
  const columns = (html.match(/class="uldw-mx-head/g) || []).length;
  const items = (html.match(/data-merge-item="1"/g) || []).length;
  const lihBadges = (html.match(/uldw-merge-item-lih/g) || []).length;
  console.log('合併／分配頁預覽已產生：', OUT);
  console.log(`MAWB 票 ${chips} ｜ ULD 欄 ${columns} ｜ 分板明細 ${items} ｜ 票 LIH 標籤 ${lihBadges}`);
  console.log('37 板壓測預覽：', OUT_37, `（ULD 欄 ${(html37.match(/class="uldw-mx-head/g) || []).length} 欄）`);
  console.log('提示：矩陣＝一列一票 MAWB × 一欄一板；左欄 sticky、水平捲動看 37 板（每欄 198px）。');
})();
