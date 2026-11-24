// ===== 執 PLAN：CRD（Cargo Ready Date）純函式測試 =====
// 直接以 Node 載入 public/js/loading-plan/crd.js（ESM；Node 22+ 會自動偵測模組語法）
// 用法：node scripts/test-loading-plan-crd.js
const path = require('path');
const { pathToFileURL } = require('url');

const CRD_URL = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'loading-plan', 'crd.js')).href;

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

(async () => {
  console.log('===== 執 PLAN：CRD 測試 =====\n');
  const { lpCrdStep, lpCrdParseInput } = await import(CRD_URL);
  const TODAY = '2026-11-30';

  // ===== 1. 鍵盤 ↑↓：±1 日、自動跨月／跨年（使用者提供的例子）=====
  console.log('--- 1. ↑↓ ±1 日 ---');
  const up = lpCrdStep('30NOV', 'up', '2026-11-30', TODAY);
  check('1.1 今天 30NOV 按 ↑ → 01DEC', up && up.text === '01DEC' && up.iso === '2026-12-01',
    up && `${up.text} ${up.iso}`);
  const down = lpCrdStep('01DEC', 'down', '2026-11-30', TODAY);
  check('1.2 01DEC 按 ↓ → 30NOV', down && down.text === '30NOV' && down.iso === '2026-11-30',
    down && `${down.text} ${down.iso}`);
  const yearUp = lpCrdStep('31DEC', 'up', '2027-01-02', '2026-12-31');
  check('1.3 跨年：31DEC ↑ → 01JAN（取最近年份 2027）',
    yearUp && yearUp.text === '01JAN' && yearUp.iso === '2027-01-01', yearUp && yearUp.iso);
  const leap = lpCrdStep('28FEB', 'up', '2028-03-05', '2028-02-28');
  check('1.4 閏年：28FEB ↑ → 29FEB（2028）', leap && leap.text === '29FEB', leap && leap.iso);
  check('1.5 沒有 Flight Date 也能用今天推算',
    lpCrdStep('30NOV', 'up', '', TODAY).iso === '2026-12-01');
  const invalidDir = lpCrdStep('30NOV', 'left', '2026-11-30', TODAY);
  check('1.6 非 ↑↓ 方向 → null', invalidDir === null);
  const emptyBase = lpCrdStep('', 'up', '2026-11-14', TODAY);
  check('1.7 空白值以 Flight Date 起算（14NOV ↑ → 15NOV）',
    emptyBase && emptyBase.iso === '2026-11-15', emptyBase && emptyBase.iso);

  // ===== 2. 邏輯決策：CRD 不可遲於 Flight Date =====
  console.log('--- 2. Flight Date 檢核 ---');
  const late = lpCrdStep('24NOV', 'up', '2026-11-14', TODAY);
  check('2.1 24NOV ↑ → 25NOV 比 Flight Date（14NOV）遲 → 回報錯誤',
    late && late.iso === '2026-11-25' && /CRD 25NOV/.test(late.issue) && /Flight Date 14NOV/.test(late.issue),
    late && late.issue);
  const sameDay = lpCrdStep('13NOV', 'up', '2026-11-14', TODAY);
  check('2.2 同日（14NOV ≤ 14NOV）不報錯', sameDay && sameDay.issue === '' && sameDay.text === '14NOV');
  const earlier = lpCrdStep('14NOV', 'down', '2026-11-14', TODAY);
  check('2.3 往前一天一定合法（13NOV）', earlier && earlier.issue === '' && earlier.text === '13NOV');
  check('2.4 沒有 Flight Date → 不檢核（存貨）',
    lpCrdStep('24NOV', 'up', '', TODAY).issue === '');

  // ===== 3. 手動輸入解析 =====
  console.log('--- 3. 手動輸入 ---');
  const ddmmy = lpCrdParseInput('24NOV', '2026-11-14', '', TODAY);
  check('3.1 "24NOV" → ISO 2026-11-24（依 Flight Date 補年份）',
    ddmmy && ddmmy.iso === '2026-11-24' && ddmmy.text === '24NOV', ddmmy && ddmmy.iso);
  const dayOnly = lpCrdParseInput('24', '2026-11-14', '2026-12-05', TODAY);
  check('3.2 只輸入 "24" → 月份沿用這格原本的值（DEC）',
    dayOnly && dayOnly.iso === '2026-12-24' && dayOnly.text === '24DEC', dayOnly && dayOnly.iso);
  const dayOnlyNoCurrent = lpCrdParseInput('24', '2026-11-14', '', TODAY);
  check('3.3 只輸入 "24" 且原本空白 → 月份沿用 Flight Date（NOV）',
    dayOnlyNoCurrent && dayOnlyNoCurrent.iso === '2026-11-24', dayOnlyNoCurrent && dayOnlyNoCurrent.iso);
  const slash = lpCrdParseInput('14/11', '2026-11-14', '', TODAY);
  check('3.4 "14/11" → 2026-11-14', slash && slash.iso === '2026-11-14');
  const iso = lpCrdParseInput('2026-11-10', '2026-11-14', '', TODAY);
  check('3.5 ISO 輸入直接採用', iso && iso.iso === '2026-11-10' && iso.issue === '');
  const empty = lpCrdParseInput('   ', '2026-11-14', '2026-11-10', TODAY);
  check('3.6 空白 → 清除（iso 空字串）', empty && empty.iso === '' && empty.text === '');
  check('3.7 無法解析（ABC）→ null', lpCrdParseInput('ABC', '2026-11-14', '', TODAY) === null);
  check('3.8 不存在的日期（31FEB）→ null', lpCrdParseInput('31FEB', '2026-11-14', '', TODAY) === null);
  const parseLate = lpCrdParseInput('15NOV', '2026-11-14', '', TODAY);
  check('3.9 手動輸入比 Flight Date 遲 → 帶錯誤訊息',
    parseLate && /不可遲於 Flight Date 14NOV/.test(parseLate.issue), parseLate && parseLate.issue);
  const parseOk = lpCrdParseInput('14NOV', '2026-11-14', '', TODAY);
  check('3.10 手動輸入同日 → 不報錯', parseOk && parseOk.issue === '');
  const noFlight = lpCrdParseInput('30NOV', '', '', TODAY);
  check('3.11 沒有 Flight Date（存貨）→ 以今天補年份、不檢核',
    noFlight && noFlight.iso === '2026-11-30' && noFlight.issue === '', noFlight && noFlight.iso);

  console.log(`\n===== 測試結束：${pass} 通過 / ${fail} 失敗 =====`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => {
  console.error('測試失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});
