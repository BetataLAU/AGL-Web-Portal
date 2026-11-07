// ===== ULD 夾重系統：載荷表（CHARTER LOADING SHEET）預覽產生器 ====
// 用途：不用登入、不用開伺服器，就能把「載荷表」畫成一張 static HTML 目視檢查版面
//       （改 CSS／render 之後先看這個，再去跑測試）。
// 用法：node scripts/uld-weight-grid-preview.js
// 輸出：data/work/uldw-grid-preview.html（用瀏覽器打開即可；data/work 不進版控）
//
// 注意：這裡的假資料只用來「看版面」，數字不必是實單；正式驗證請跑
//       npm run test:uldweight（§22 載荷表）。
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const BASE = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight')).href;
const OUT = path.join(__dirname, '..', 'data', 'work', 'uldw-grid-preview.html');

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

// 5 票 × 3 板：故意包含「同票分兩板」、「夾重」（紅字）、「上數 ≠ 申報」（橙字）
// 方案 B：申報 PCS／WT 放 mawb_rows（左邊），各板只填件數，重量由 calc 依件數分配。
function demoDetail() {
  return {
    id: 1, sheet_no: 'CHT-20261107-01', sheet_date: '2026-11-07', terminal: 'CPSL',
    flight_no: 'CX88', flight_date: '2026-11-07', round_px: 1, round_b: 1,
    tail_mode: 'adjust_largest', diff_warn_pct: 2, diff_warn_kg: 100,
    clamp_min_pct: 0, clamp_max_pct: 0, handler: 'tester', remark: '', status: 'draft',
    mawb_rows: [
      { id: 1, seq: 0, mawb: '574-3429 3523', dest: 'LGG', pcs: 107, declared_weight: 1400, wh_ref: 'W/H-001', auto_alloc: 1, is_squeeze: 1 },
      { id: 2, seq: 1, mawb: '574-3429 3512', dest: 'LGG', pcs: 150, declared_weight: 2423, wh_ref: '', auto_alloc: 1, is_squeeze: 1 },
      { id: 3, seq: 2, mawb: '574-3429 3490', dest: 'LGG', pcs: 69, declared_weight: 1146, wh_ref: '', auto_alloc: 1, is_squeeze: 1 },
      { id: 4, seq: 3, mawb: '574-3429 3453', dest: 'LGG', pcs: 65, declared_weight: 1000, wh_ref: '', auto_alloc: 1, is_squeeze: 1 },
      // 同票分板：3534 在 02/B 與 03/C（67 + 42 件），申報 2109
      { id: 5, seq: 4, mawb: '574-3429 3534', dest: 'LGG', pcs: 109, declared_weight: 2109, wh_ref: 'BULK-1', auto_alloc: 1, is_squeeze: 1 }
    ],
    ulds: [
      {
        id: 1, kind: 'ULD', uld_number: 'PMC90936NAS', contour_code: 'H3', port: 'LGG',
        pcs: 257, tare_weight: 115, rcl_gross_weight: 3708, predecl_type: 'X',
        squeeze_mode: 'weight', lih_type: 'N',
        items: [
          { id: 1, mawb: '574-3429 3523', port: 'LGG', pcs: 107, declared_weight: 0, is_squeeze: 1 },
          { id: 2, mawb: '574-3429 3512', port: 'LGG', pcs: 150, declared_weight: 0, is_squeeze: 1 }
        ]
      },
      {
        id: 2, kind: 'ULD', uld_number: 'PMC28420FF', contour_code: 'H3', port: 'LGG',
        pcs: 176, tare_weight: 110, rcl_gross_weight: 1990, predecl_type: 'X',
        squeeze_mode: 'weight', lih_type: 'N',
        items: [
          { id: 3, mawb: '574-3429 3490', port: 'LGG', pcs: 69, declared_weight: 0, is_squeeze: 1 },
          { id: 4, mawb: '574-3429 3453', port: 'LGG', pcs: 65, declared_weight: 0, is_squeeze: 1 },
          { id: 6, mawb: '574-3429 3534', port: 'LGG', pcs: 42, declared_weight: 0, is_squeeze: 1 }
        ]
      },
      {
        id: 3, kind: 'BULK', bulk_ref: 'BULK-1', port: 'LGG',
        pcs: 67, tare_weight: 0, rcl_gross_weight: 1350, predecl_type: 'B',
        squeeze_mode: 'weight', lih_type: 'N',
        items: [
          { id: 5, mawb: '574-3429 3534', port: 'LGG', pcs: 67, declared_weight: 0, is_squeeze: 1 }
        ]
      }
    ]
  };
}

(async () => {
  const state = await import(`${BASE}/state.js`);
  const render = await import(`${BASE}/render.js`);

  state.uldWeightState.current = state.uldSheetFromApi(demoDetail());
  state.uldWeightState.ui = {
    view: 'grid', gridSortMawb: false, more: false, advanced: false,
    expanded: {}, expandAll: false, printUnit: null
  };

  const root = makeRoot();
  render.renderEditor(root);
  const html = root.innerHTML;
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'uld-weight.css'), 'utf8');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    `<!doctype html><meta charset="utf-8"><title>ULD 載荷表預覽</title>
<style>${css}
body { padding: 16px; background: #eef2f7; }
</style>${html}`,
    'utf8'
  );

  const rows = (html.match(/<tr data-row-uid=/g) || []).length;
  const units = (html.match(/uldw-grid-unit-th/g) || []).length;
  const totals = [...html.matchAll(/<td colspan="4" class="uldw-grid-label">([A-Z ]+)<\/td>\s*<td[^>]*>\s*<span[^>]*>([^<]+)<\/span>/g)]
    .map(m => `${m[1]}=${m[2]}`).join('  ');
  console.log('載荷表預覽已產生：', OUT);
  console.log(`MAWB 列 ${rows} ｜ 板欄 ${units} ｜ 紅字(is-squeeze) ${(html.match(/is-squeeze/g) || []).length} ｜ 橙字(is-diff) ${(html.match(/is-diff/g) || []).length}`);
  console.log('底部：', totals);
})();
