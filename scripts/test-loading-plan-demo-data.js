// ===== 執 PLAN：DUMMY 資料檢查（防止 fixture 走鐘）=====
// 用法：node scripts/test-loading-plan-demo-data.js
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'seed-loading-plan-demo.js');
const CALC = pathToFileURL(path.join(ROOT, 'public', 'js', 'loading-plan', 'calc.js')).href;

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

(async () => {
  console.log('===== 執 PLAN：DUMMY 資料檢查 =====\n');
  const demo = require(SRC);
  const calc = await import(CALC);
  const { PLANS, STOCK, mawb } = demo;

  check('1. 共 3 張 PLAN', PLANS.length === 3, String(PLANS.length));
  const flightItems = PLANS.reduce((sum, plan) => sum + plan.items.length, 0);
  check('2. 3 張 PLAN 合計 20 票', flightItems === 20, String(flightItems));
  check('3. 存貨 7 票（給配艙建議用）', STOCK.length === 7, String(STOCK.length));

  // MAWB：11 位、prefix 1-999、檢查碼正確、全域唯一
  const all = [...PLANS.flatMap(p => p.items), ...STOCK];
  const keys = new Set();
  let invalid = 0;
  all.forEach((row) => {
    const digits = mawb(row[0], row[1]).replace(/[\s-]/g, '');
    if (!/^\d{11}$/.test(digits)) { invalid += 1; return; }
    if (Number(digits.slice(3, 10)) % 7 !== Number(digits.slice(10))) invalid += 1;
    if (keys.has(digits)) invalid += 1;
    keys.add(digits);
  });
  check('4. 全部 MAWB 檢查碼正確且不重複', invalid === 0, `invalid=${invalid}, unique=${keys.size}`);

  const totals = PLANS.map((plan) => {
    const items = plan.items.map((row) => ({ gross_weight: row[5], cbm: row[6] }));
    return calc.lpKpi(items, { maxGrossWeight: plan.max_gross_weight, maxCbm: plan.max_cbm });
  });
  check('5. PLAN 1 = 7,803 kg（86.7%）',
    Math.abs(totals[0].grossWeight - 7803) < 0.01 && Math.abs(totals[0].gwPct - 86.7) < 0.05,
    `${totals[0].grossWeight} / ${totals[0].gwPct}%`);
  check('6. PLAN 2 = 4,401 kg（48.9%）',
    Math.abs(totals[1].grossWeight - 4401) < 0.01 && Math.abs(totals[1].gwPct - 48.9) < 0.05,
    `${totals[1].grossWeight} / ${totals[1].gwPct}%`);
  check('7. PLAN 3 刻意超重（8,542 / 8,000，超 542）',
    Math.abs(totals[2].grossWeight - 8542) < 0.01 && Math.abs(totals[2].overWeight - 542) < 0.01,
    `${totals[2].grossWeight} / over ${totals[2].overWeight}`);

  const dests = new Set(PLANS[0].items.map(row => row[3]));
  check('8. PLAN 1 全部同一個 DEST（示範同 DEST 優先）', dests.size === 1, [...dests].join(','));
  const flags = PLANS.flatMap(p => p.items).some(row => row[10] && Object.keys(row[10]).length);
  check('9. 有 DG／handling 旗標可看', flags);

  console.log(`\n===== 測試結束：${pass} 通過 / ${fail} 失敗 =====`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => {
  console.error('測試失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});
