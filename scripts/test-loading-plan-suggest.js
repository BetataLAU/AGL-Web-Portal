// ===== 執 PLAN：一鍵配艙建議 測試 =====
// 用法：node scripts/test-loading-plan-suggest.js
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'loading-plan', 'suggest.js')).href;

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}
const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol;

// 測試資料（照 Excel 真實數值）
const RAW = [
  { id: 1, mawb: 'A', dest: 'DWC', gross_weight: 1302, cbm: 6.82 },
  { id: 2, mawb: 'B', dest: 'DWC', gross_weight: 220, cbm: 1.43 },
  { id: 3, mawb: 'C', dest: 'DXB', gross_weight: 298, cbm: 3.4 },
  { id: 4, mawb: 'D', dest: 'DWC', gross_weight: 523, cbm: 2.34 },
  { id: 5, mawb: 'E', dest: 'AMS', gross_weight: 118, cbm: 0.95 },
  { id: 6, mawb: 'F', dest: 'DWC', gross_weight: 1560, cbm: 9.23 },
  { id: 7, mawb: 'G', dest: 'AMS', gross_weight: 59, cbm: 0.36 }
];
const clone = (value) => JSON.parse(JSON.stringify(value));

(async () => {
  console.log('===== 執 PLAN：配艙建議 測試 =====\n');
  const { lpSuggestLoad, LP_SUGGEST_MODES } = await import(SRC);

  // ---- 1. 空 PLAN、充足上限 → 全部放入 ----
  console.log('--- 1. 空 PLAN ---');
  const r1 = lpSuggestLoad({ candidates: RAW, limits: { maxGrossWeight: 9000, maxCbm: 65 } });
  check('1.1 ok 且 7 票全放', r1.ok === true && r1.pickedIds.length === 7, String(r1.pickedIds.length));
  check('1.2 合計 G.W 4,080', near(r1.totals.gw, 4080), String(r1.totals.gw));
  check('1.3 合計 CBM 24.53', near(r1.totals.cbm, 24.53), String(r1.totals.cbm));
  check('1.4 利用率 G.W 45.3% / CBM 37.7% / 平均 41.5%',
    near(r1.utilization.gwPct, 45.3, 0.05) && near(r1.utilization.cbmPct, 37.7, 0.05) && near(r1.utilization.avgPct, 41.5, 0.05),
    JSON.stringify(r1.utilization));
  check('1.5 剩餘容量正確', near(r1.remaining.gw, 4920) && near(r1.remaining.cbm, 40.47), JSON.stringify(r1.remaining));
  check('1.6 沒有 skipped', r1.skipped.length === 0);

  // ---- 2. 重量上限：絕不超重 ----
  console.log('--- 2. 重量上限 ---');
  const r2 = lpSuggestLoad({ candidates: RAW, limits: { maxGrossWeight: 1600, maxCbm: 65 } });
  check('2.1 不超過 1,600 kg', r2.totals.gw <= 1600 + 1e-6, String(r2.totals.gw));
  check('2.2 先放大件（F 1560）', r2.pickedIds[0] === 6, JSON.stringify(r2.pickedIds));
  check('2.3 其餘票沒有被硬塞（只挑 1 票）', r2.pickedIds.length === 1, JSON.stringify(r2.pickedIds));

  // ---- 3. CBM 上限 ----
  console.log('--- 3. CBM 上限 ---');
  const r3 = lpSuggestLoad({ candidates: RAW, limits: { maxGrossWeight: 9000, maxCbm: 10 } });
  check('3.1 不超過 10 CBM', r3.totals.cbm <= 10 + 1e-6, String(r3.totals.cbm));
  check('3.2 挑到 F + G（9.59）', r3.pickedIds.length === 2 && near(r3.totals.cbm, 9.59), JSON.stringify(r3.pickedIds));

  // ---- 4. 已有固定明細 → 只補剩餘 ----
  console.log('--- 4. 固定條件 ---');
  const fixed = [{ id: 99, mawb: 'FIX', dest: 'DWC', gross_weight: 4304, cbm: 35.62 }];
  const r4 = lpSuggestLoad({ candidates: RAW, fixed, limits: { maxGrossWeight: 9000, maxCbm: 65 } });
  check('4.1 固定明細計入合計', r4.fixed.tickets === 1 && near(r4.fixed.gw, 4304));
  check('4.2 加入後仍不超標', r4.totals.gw <= 9000 + 1e-6 && r4.totals.cbm <= 65 + 1e-6,
    JSON.stringify({ gw: r4.totals.gw, cbm: r4.totals.cbm }));
  check('4.3 只補剩餘容量（不會放滿 9000）', r4.totals.gw <= 9000, String(r4.totals.gw));
  check('4.4 票數 = 固定 1 + 建議 n', r4.totals.tickets === 1 + r4.pickedIds.length);

  // ---- 5. 固定明細本身已超標 ----
  console.log('--- 5. 已超標 ---');
  const r5 = lpSuggestLoad({ candidates: RAW, fixed, limits: { maxGrossWeight: 4000, maxCbm: 65 } });
  check('5.1 警告「現有明細已超重」', r5.warnings.some(w => w.includes('已超重')), JSON.stringify(r5.warnings));
  check('5.2 不再建議加入', r5.pickedIds.length === 0);

  // ---- 6. 單票太大 ----
  console.log('--- 6. 單票太大 ---');
  const r6 = lpSuggestLoad({
    candidates: [{ id: 50, mawb: 'BIG', gross_weight: 10000, cbm: 5 }],
    limits: { maxGrossWeight: 9000, maxCbm: 65 }
  });
  check('6.1 列 skipped 並說明原因',
    r6.skipped.length === 1 && r6.skipped[0].reason.includes('超出'), JSON.stringify(r6.skipped));
  check('6.2 沒有建議 + 有警告', r6.pickedIds.length === 0 && r6.warnings.length > 0);

  // ---- 7. 沒有上限 ----
  console.log('--- 7. 沒有上限 ---');
  const r7 = lpSuggestLoad({ candidates: RAW, limits: {} });
  check('7.1 回錯誤訊息（TRIAL 前要先輸入上限）', !!r7.error && r7.error.includes('上限'), String(r7.error));
  check('7.2 不會回建議', r7.pickedIds.length === 0);

  // ---- 8. 存貨為空 ----
  console.log('--- 8. 存貨為空 ---');
  const r8 = lpSuggestLoad({ candidates: [], limits: { maxGrossWeight: 9000 } });
  check('8.1 ok 但提示沒有貨', r8.ok === true && r8.warnings.some(w => w.includes('沒有可用')), JSON.stringify(r8.warnings));

  // ---- 9. 模式 ----
  console.log('--- 9. 排序模式 ---');
  const r9 = lpSuggestLoad({ candidates: RAW, limits: { maxGrossWeight: 2000, maxCbm: 65 }, mode: 'weight' });
  check('9.1 重量優先：先放最大票 F', r9.pickedIds[0] === 6, JSON.stringify(r9.pickedIds));
  check('9.2 重量優先：接著放 C / E',
    r9.pickedIds.includes(3) && r9.pickedIds.includes(5), JSON.stringify(r9.pickedIds));
  check('9.3 模式清單有 3 種', LP_SUGGEST_MODES.length === 3);

  // ---- 10. 同 DEST ----
  console.log('--- 10. 同 DEST 優先 ---');
  const r10 = lpSuggestLoad({ candidates: RAW, limits: { maxGrossWeight: 9000, maxCbm: 65 }, sameDest: true });
  check('10.1 只挑一個 DEST（利用率最高的 DWC）', r10.groupDest === 'DWC', r10.groupDest);
  check('10.2 所有建議同一個 DEST',
    r10.picked.every(item => item.dest === 'DWC'), JSON.stringify(r10.picked.map(i => i.dest)));

  const r11 = lpSuggestLoad({
    candidates: RAW,
    fixed: [{ id: 98, dest: 'DXB', gross_weight: 100, cbm: 1 }],
    limits: { maxGrossWeight: 9000, maxCbm: 65 },
    sameDest: true
  });
  check('11.1 有固定 DEST 時沿用（DXB）', r11.groupDest === 'DXB', r11.groupDest);
  check('11.2 建議也都是 DXB', r11.picked.every(item => item.dest === 'DXB'));

  // ---- 12. 穩定性 / 不變性 ----
  console.log('--- 12. 穩定性 ---');
  const snapshot = clone(RAW);
  const a = lpSuggestLoad({ candidates: RAW, limits: { maxGrossWeight: 3000, maxCbm: 30 } });
  const b = lpSuggestLoad({ candidates: RAW, limits: { maxGrossWeight: 3000, maxCbm: 30 } });
  check('12.1 同一輸入 → 同一結果', JSON.stringify(a.pickedIds) === JSON.stringify(b.pickedIds),
    JSON.stringify(a.pickedIds));
  check('12.2 不會修改傳入的候選資料', JSON.stringify(RAW) === JSON.stringify(snapshot));

  // ---- 13. 只有一個維度 ----
  console.log('--- 13. 只有 CBM 上限 ---');
  const r13 = lpSuggestLoad({ candidates: RAW, limits: { maxCbm: 12 } });
  check('13.1 只比 CBM（gwPct 為 null）', r13.utilization.gwPct === null && r13.utilization.cbmPct !== null,
    JSON.stringify(r13.utilization));
  check('13.2 仍不超過 CBM', r13.totals.cbm <= 12 + 1e-6, String(r13.totals.cbm));

  console.log(`\n===== 測試結束：${pass} 通過 / ${fail} 失敗 =====`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => {
  console.error('測試失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});
