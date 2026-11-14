// ===== 執 PLAN：拖曳排序計算 測試 =====
// 用法：node scripts/test-loading-plan-order.js
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'loading-plan', 'order.js')).href;

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  console.log('===== 執 PLAN：拖曳排序 測試 =====\n');
  const { lpMoveOrder } = await import(SRC);
  const ORDER = [1, 2, 3, 4, 5];

  check('1. 放尾端（anchor = null）', eq(lpMoveOrder(ORDER, [9], null), [1, 2, 3, 4, 5, 9]),
    JSON.stringify(lpMoveOrder(ORDER, [9], null)));
  check('2. 插在 3 之前', eq(lpMoveOrder(ORDER, [9], 3, true), [1, 2, 9, 3, 4, 5]));
  check('3. 插在 3 之後', eq(lpMoveOrder(ORDER, [9], 3, false), [1, 2, 3, 9, 4, 5]));
  check('4. 搬動既有項目（1 移到 3 前）', eq(lpMoveOrder(ORDER, [1], 3, true), [2, 1, 3, 4, 5]));
  check('5. 多選（1,5 移到 2 後）', eq(lpMoveOrder(ORDER, [1, 5], 2, false), [2, 1, 5, 3, 4]));
  check('6. 拖到自己身上 → 放尾端', eq(lpMoveOrder(ORDER, [3], 3, true), [1, 2, 4, 5, 3]));
  check('7. anchor 不存在 → 放尾端', eq(lpMoveOrder(ORDER, [9], 99, true), [1, 2, 3, 4, 5, 9]));
  check('8. 沒有要搬的 → 原順序', eq(lpMoveOrder(ORDER, [], null), ORDER));
  check('9. 空順序 → 直接放入', eq(lpMoveOrder([], [7, 8], null), [7, 8]));
  check('10. 跨 plan（ids 不在原順序）插在 2 後', eq(lpMoveOrder([1, 2, 3], [9, 10], 2, false), [1, 2, 9, 10, 3]));
  check('11. 插在最前', eq(lpMoveOrder(ORDER, [9], 1, true), [9, 1, 2, 3, 4, 5]));
  check('12. 插在最後（anchor = 5 之後）', eq(lpMoveOrder(ORDER, [9], 5, false), [1, 2, 3, 4, 5, 9]));

  const before = JSON.stringify(ORDER);
  lpMoveOrder(ORDER, [1], 3, true);
  check('13. 不會修改傳入的 order', JSON.stringify(ORDER) === before);

  check('14. 多選保持原本相對順序（[3,1] → 3 在 1 前）',
    eq(lpMoveOrder(ORDER, [3, 1], 2, false), [2, 3, 1, 4, 5]),
    JSON.stringify(lpMoveOrder(ORDER, [3, 1], 2, false)));

  check('15. 字串 id 也能處理', eq(lpMoveOrder(['1', '2', '3'], ['2'], '3', true), [1, 2, 3]),
    JSON.stringify(lpMoveOrder(['1', '2', '3'], ['2'], '3', true)));

  console.log(`\n===== 測試結束：${pass} 通過 / ${fail} 失敗 =====`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => {
  console.error('測試失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});
