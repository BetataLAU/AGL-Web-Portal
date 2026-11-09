// ===== ULD 夾重系統：計算邏輯測試 =====
// 直接以 Node 載入 public/js/uldweight/calc.js（ESM；Node 22+ 會自動偵測模組語法）
// 用法：node scripts/test-uld-weight-calc.js
const path = require('path');
const { pathToFileURL } = require('url');

const CALC_URL = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'calc.js')).href;

let passCount = 0;
let failCount = 0;

function check(name, ok, extra = '') {
  if (ok) passCount += 1; else failCount += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

function near(a, b, tolerance = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function findItem(result, mawb) {
  return result.items.find(it => it.mawb === mawb);
}

function codes(result) {
  return result.issues.map(i => i.code);
}

(async () => {
  console.log('===== ULD 夾重系統：計算邏輯測試 =====\n');
  const calc = await import(CALC_URL);
  const {
    uldComputeUnit, uldComputeSheet, uldSplitByPcs, uldCeilTo, uldFmtKg, uldNormalizeMawb, uldBookingTotals
  } = calc;

  // ===== 0. RCL WT = 淨重（2026-11-07 規則變更）=====
  console.log('--- 0. RCL WT = 淨重（Tare 只顯示參考）---');
  const rclIsNet = uldComputeUnit({
    kind: 'ULD', tare_weight: 115, rcl_gross_weight: 1000,
    items: [{ mawb: '160-00000091', pcs: 1, declared_weight: 900, is_squeeze: true }]
  });
  check('0.1 目標淨重 = RCL 1000（不是 1000 − 115 = 885）', near(rclIsNet.targetNet, 1000), `(${rclIsNet.targetNet})`);
  check('0.2 磅差 = RCL 1000 − 申報 900 = 100', near(rclIsNet.diff, 100), `(${rclIsNet.diff})`);
  check('0.3 夾重後合計 = 1000（Tare 不影響分配）', near(rclIsNet.finalSum, 1000), `(${rclIsNet.finalSum})`);
  check('0.4 Tare 仍回傳、僅供顯示', near(rclIsNet.tare, 115), `(${rclIsNet.tare})`);
  check('0.5 磅差 % 以 RCL 為分母（100 / 1000 = 10%）', near(rclIsNet.diffPct, 10), `(${rclIsNet.diffPct})`);
  const rclIsNetSheet = uldComputeSheet({
    ulds: [{
      uid: 'a', kind: 'ULD', uld_number: 'PMC1', tare_weight: 115, rcl_gross_weight: 1000,
      items: [{ mawb: '160-00000091', pcs: 1, declared_weight: 900, is_squeeze: true }]
    }]
  });
  check('0.6 全表 netTotal／rclTotal 都以 RCL（淨重）為準（1000）',
    near(rclIsNetSheet.totals.netTotal, 1000) && near(rclIsNetSheet.totals.rclTotal, 1000),
    `(${rclIsNetSheet.totals.netTotal} / ${rclIsNetSheet.totals.rclTotal})`);

  // ===== 1. 需求規格 4 個 CASE =====
  console.log('--- 1. 需求規格 CASE 1~4 ---');

  // CASE 1：1 ULD 裝 1 MAWB
  const case1 = uldComputeUnit({
    kind: 'ULD', tare_weight: 115, rcl_gross_weight: 2453,
    items: [{ mawb: '160-00000001', pcs: 10, declared_weight: 2438, is_squeeze: true }]
  });
  check('1.1 CASE1 目標淨重 = RCL 2453（Tare 115 不扣）', near(case1.targetNet, 2453), `(${case1.targetNet})`);
  check('1.2 CASE1 夾重後 MAWB = 2453', near(case1.items[0].final, 2453), `(${case1.items[0].final})`);
  check('1.3 CASE1 磅差 = +15', near(case1.diff, 15), `(${case1.diff})`);
  check('1.4 CASE1 無檢核問題', case1.issues.length === 0, JSON.stringify(codes(case1)));

  // CASE 2：1 ULD 裝 2 MAWB，指定 MAWB a 夾重
  const case2 = uldComputeUnit({
    kind: 'ULD', tare_weight: 115, rcl_gross_weight: 2453, pcs: 13,
    items: [
      { mawb: '160-00000002', pcs: 10, declared_weight: 2138, is_squeeze: true },
      { mawb: '160-00000003', pcs: 3, declared_weight: 300, is_squeeze: false }
    ]
  });
  check('2.1 CASE2 夾重 MAWB a = 2153', near(findItem(case2, '160-00000002').final, 2153));
  check('2.2 CASE2 未夾重 MAWB b = 300（不變）', near(findItem(case2, '160-00000003').final, 300));
  check('2.3 CASE2 板內合計 = 2453（= RCL 淨重）', near(case2.finalSum, 2453), `(${case2.finalSum})`);

  // CASE 3：2 ULD 裝 1 MAWB（交板，同一 MAWB 分兩板）
  const case3Sheet = uldComputeSheet({
    round_px: 1, round_b: 1, tail_mode: 'adjust_largest',
    ulds: [
      {
        uid: 'a', kind: 'ULD', uld_number: 'PMC0001XX', tare_weight: 115, rcl_gross_weight: 2185, pcs: 20,
        items: [{ mawb: '160-00000004', pcs: 20, declared_weight: 2185, is_squeeze: true }]
      },
      {
        uid: 'b', kind: 'ULD', uld_number: 'PMC0002XX', tare_weight: 112, rcl_gross_weight: 1888, pcs: 18,
        items: [{ mawb: '160-00000004', pcs: 18, declared_weight: 1865, is_squeeze: true }]
      }
    ]
  });
  check('3.1 CASE3 板 a 淨重 = RCL 2185（Tare 115 不扣）', near(case3Sheet.units[0].calc.finalSum, 2185));
  check('3.2 CASE3 板 b 淨重 = RCL 1888（Tare 112 不扣）', near(case3Sheet.units[1].calc.finalSum, 1888));
  check('3.3 CASE3 MAWB 合計 = 4073', near(case3Sheet.mawbs[0].final, 4073), `(${case3Sheet.mawbs[0].final})`);
  check('3.4 CASE3 原申報 4050 → 差 +23', near(case3Sheet.mawbs[0].diff, 23));

  // CASE 4：2 ULD 裝 2 MAWB，用 MAWB b 夾重
  const case4Sheet = uldComputeSheet({
    round_px: 1, round_b: 1,
    ulds: [
      {
        uid: 'a', kind: 'ULD', uld_number: 'PMC0003XX', tare_weight: 115, rcl_gross_weight: 425, pcs: 8,
        items: [
          { mawb: '160-00000005', pcs: 5, declared_weight: 300, is_squeeze: false },
          { mawb: '160-00000006', pcs: 3, declared_weight: 125, is_squeeze: true }
        ]
      },
      {
        uid: 'b', kind: 'ULD', uld_number: 'PMC0004XX', tare_weight: 112, rcl_gross_weight: 888, pcs: 3,
        items: [{ mawb: '160-00000006', pcs: 3, declared_weight: 888, is_squeeze: true }]
      }
    ]
  });
  const mawbA = case4Sheet.mawbs.find(m => m.mawb === '160-00000005');
  const mawbB = case4Sheet.mawbs.find(m => m.mawb === '160-00000006');
  check('4.1 CASE4 MAWB a 合計 = 300（不夾重）', near(mawbA.final, 300), `(${mawbA.final})`);
  check('4.2 CASE4 MAWB b 合計 = 125 + 888 = 1013', near(mawbB.final, 1013), `(${mawbB.final})`);
  check('4.3 CASE4 板 a 內 MAWB b = 125', near(findItem(case4Sheet.units[0].calc, '160-00000006').final, 125));
  check('4.4 CASE4 板 b 內 MAWB b = 888', near(findItem(case4Sheet.units[1].calc, '160-00000006').final, 888));


  // ===== 2. 多票按比例夾重（新規則）=====
  console.log('\n--- 2. 多票按比例夾重 ---');
  const multi = uldComputeUnit({
    kind: 'ULD', tare_weight: 115, rcl_gross_weight: 2453, pcs: 13, squeeze_mode: 'weight',
    items: [
      { mawb: '160-00000011', pcs: 10, declared_weight: 2138, is_squeeze: true },
      { mawb: '160-00000012', pcs: 3, declared_weight: 300, is_squeeze: true }
    ]
  });
  const m11 = findItem(multi, '160-00000011');
  const m12 = findItem(multi, '160-00000012');
  check('5.1 重量比例 ≈ 87.7% / 12.3%', near(m11.ratio, 2138 / 2438, 1e-9) && near(m12.ratio, 300 / 2438, 1e-9));
  check('5.2 精確值 a = 2138 + 15×87.68%', near(m11.exact, 2138 + 15 * (2138 / 2438), 1e-6), `(${m11.exact.toFixed(3)})`);
  check('5.3 取整後 a = 2151（尾差由最大票吸收）', near(m11.final, 2151), `(${m11.final})`);
  check('5.4 取整後 b = 302', near(m12.final, 302), `(${m12.final})`);
  check('5.5 合計 = 目標淨重 2453', near(multi.finalSum, 2453), `(${multi.finalSum})`);

  const byPcs = uldComputeUnit({
    kind: 'ULD', tare_weight: 115, rcl_gross_weight: 2453, pcs: 13, squeeze_mode: 'pcs',
    items: [
      { mawb: 'A', pcs: 12, declared_weight: 2138, is_squeeze: true },
      { mawb: 'B', pcs: 1, declared_weight: 300, is_squeeze: true }
    ]
  });
  check('6.1 件數比例 12:1 → 比例 92.31% / 7.69%',
    near(findItem(byPcs, 'A').ratio, 12 / 13, 1e-9) && near(findItem(byPcs, 'B').ratio, 1 / 13, 1e-9));
  check('6.2 件數比例合計 = 2453', near(byPcs.finalSum, 2453), `(${byPcs.finalSum})`);

  const equal = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 1000, squeeze_mode: 'equal',
    items: [
      { mawb: 'A', pcs: 1, declared_weight: 100, is_squeeze: true },
      { mawb: 'B', pcs: 1, declared_weight: 200, is_squeeze: true }
    ]
  });
  check('7.1 平均分攤比例 50% / 50%', near(findItem(equal, 'A').ratio, 0.5) && near(findItem(equal, 'B').ratio, 0.5));
  check('7.2 平均分攤磅差 +700 → A 450 / B 550（合計 1000）',
    near(findItem(equal, 'A').final, 450) && near(findItem(equal, 'B').final, 550) && near(equal.finalSum, 1000),
    `(${findItem(equal, 'A').final} / ${findItem(equal, 'B').final})`);

  const manual = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 1000, squeeze_mode: 'manual',
    items: [
      { mawb: 'A', pcs: 1, declared_weight: 300, is_squeeze: true, squeeze_ratio: 75 },
      { mawb: 'B', pcs: 1, declared_weight: 300, is_squeeze: true, squeeze_ratio: 25 }
    ]
  });
  check('8.1 手動 % 75/25 正規化為 75% / 25%',
    near(findItem(manual, 'A').ratio, 0.75) && near(findItem(manual, 'B').ratio, 0.25));
  check('8.2 手動 % 合計 = 1000', near(manual.finalSum, 1000), `(${manual.finalSum})`);

  // ===== 3. 取整規則 =====
  console.log('\n--- 3. 取整規則（P/X 整數、B 可 0.5/1.0）---');
  check('9.1 uldCeilTo(2230.08, 1) = 2231', near(uldCeilTo(2230.08, 1), 2231));
  check('9.2 uldCeilTo(312.92, 1) = 313', near(uldCeilTo(312.92, 1), 313));
  check('9.3 uldCeilTo(800.3, 0.5) = 800.5', near(uldCeilTo(800.3, 0.5), 800.5));
  check('9.4 uldCeilTo(800, 1) = 800（整數不再加）', near(uldCeilTo(800, 1), 800));

  const bulkHalf = uldComputeUnit({
    kind: 'BULK', rcl_gross_weight: 800.3, tare_weight: 999,
    items: [{ mawb: '160-00000021', pcs: 5, declared_weight: 700, is_squeeze: true }]
  }, { roundBulk: 0.5 });
  check('9.5 B 散貨 Tare 一律視為 0（輸入 999 也不計）', near(bulkHalf.tare, 0), `(${bulkHalf.tare})`);
  check('9.6 B 散貨取整 0.5 → 800.5', near(bulkHalf.items[0].final, 800.5), `(${bulkHalf.items[0].final})`);

  const bulkOne = uldComputeUnit({
    kind: 'BULK', rcl_gross_weight: 800.3,
    items: [{ mawb: '160-00000022', pcs: 5, declared_weight: 700, is_squeeze: true }]
  }, { roundBulk: 1 });
  check('9.7 B 散貨取整 1.0 → 801', near(bulkOne.items[0].final, 801), `(${bulkOne.items[0].final})`);

  const fractional = uldComputeUnit({
    kind: 'ULD', tare_weight: 100.4, rcl_gross_weight: 1000.9,
    items: [
      { mawb: 'A', pcs: 1, declared_weight: 400.3, is_squeeze: true },
      { mawb: 'B', pcs: 1, declared_weight: 300.7, is_squeeze: true }
    ]
  }, { roundBoard: 1 });
  check('9.8 P/X 交板一律正整數',
    [findItem(fractional, 'A').final, findItem(fractional, 'B').final].every(v => Number.isInteger(v)),
    `(${findItem(fractional, 'A').final} / ${findItem(fractional, 'B').final})`);
  check('9.9 取整後合計 = ceil(淨重)',
    near(fractional.finalSum, uldCeilTo(fractional.targetNet, 1)),
    `(${fractional.finalSum} / ${uldCeilTo(fractional.targetNet, 1)})`);

  // ===== 4. 尾差處理模式 =====
  console.log('\n--- 4. 尾差處理 ---');
  const unitTail = {
    kind: 'ULD', tare_weight: 115, rcl_gross_weight: 2453,
    items: [
      { mawb: 'A', pcs: 10, declared_weight: 2138, is_squeeze: true },
      { mawb: 'B', pcs: 3, declared_weight: 300, is_squeeze: true }
    ]
  };
  const tailNone = uldComputeUnit(unitTail, { tailMode: 'none' });
  check('10.1 不調整：a 2152 / b 302（合計 2454）',
    near(findItem(tailNone, 'A').final, 2152) && near(findItem(tailNone, 'B').final, 302) &&
    near(tailNone.finalSum, 2454), `(${tailNone.finalSum})`);
  check('10.2 不調整：顯示與目標的差額 −1', near(tailNone.diffAfterFinal, -1), `(${tailNone.diffAfterFinal})`);
  const tailEqual = uldComputeUnit(unitTail, { tailMode: 'equal' });
  check('10.3 平均分攤：合計仍 = 2453', near(tailEqual.finalSum, 2453), `(${tailEqual.finalSum})`);
  check('10.4 平均分攤：小票被扣（b = 301）', near(findItem(tailEqual, 'B').final, 301), `(${findItem(tailEqual, 'B').final})`);

  // ===== 5. 檢核 =====
  console.log('\n--- 5. 檢核 ---');
  const noSqueeze = uldComputeUnit({
    kind: 'ULD', tare_weight: 115, rcl_gross_weight: 2453,
    items: [{ mawb: 'A', pcs: 1, declared_weight: 2000, is_squeeze: false }]
  });
  check('11.1 有磅差但未勾夾重 → NO_SQUEEZE（error）',
    codes(noSqueeze).includes('NO_SQUEEZE') && noSqueeze.hasError === true);
  check('11.2 未夾重時重量維持申報值', near(noSqueeze.items[0].final, 2000));

  const negative = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 300, squeeze_mode: 'manual',
    items: [
      { mawb: 'A', pcs: 1, declared_weight: 10, is_squeeze: true, squeeze_ratio: 100 },
      { mawb: 'B', pcs: 1, declared_weight: 500, is_squeeze: true, squeeze_ratio: 0 }
    ]
  });
  check('11.3 手動比例造成負重 → NEGATIVE_WEIGHT（error）',
    codes(negative).includes('NEGATIVE_WEIGHT'), JSON.stringify(codes(negative)));

  const tooSmall = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 100,
    items: [
      { mawb: 'A', pcs: 1, declared_weight: 50, is_squeeze: true },
      { mawb: 'B', pcs: 1, declared_weight: 200, is_squeeze: false }
    ]
  });
  check('11.4 非夾重票合計 > RCL 淨重 → TARGET_TOO_SMALL（error）',
    codes(tooSmall).includes('TARGET_TOO_SMALL'));

  const pcsMismatch = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 100, pcs: 10,
    items: [{ mawb: 'A', pcs: 8, declared_weight: 100, is_squeeze: true }]
  });
  check('11.5 板件數 ≠ 各票件數 → PIECES_MISMATCH',
    codes(pcsMismatch).includes('PIECES_MISMATCH'), JSON.stringify(codes(pcsMismatch)));

  const lihMismatch = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 100, lih_type: 'N',
    items: [{ mawb: 'A', pcs: 8, declared_weight: 100, is_squeeze: true, lih_type: 'UN3481' }]
  });
  check('11.6 票有 UN3481 但板標 N → LIH_UNIT_MISSING', codes(lihMismatch).includes('LIH_UNIT_MISSING'),
    JSON.stringify(codes(lihMismatch)));
  check('11.7 LIH_UNIT_MISSING 的說明帶出票的 UN 編號',
    calc.uldIssueText(lihMismatch.issues.find(i => i.code === 'LIH_UNIT_MISSING')).includes('UN3481'));

  const lihUnitOnly = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 100, lih_type: 'UN3481',
    items: [{ mawb: 'A', pcs: 8, declared_weight: 100, is_squeeze: true, lih_type: 'N' }]
  });
  check('11.8 板標 UN3481 但票都標 N → LIH_UNIT_ONLY', codes(lihUnitOnly).includes('LIH_UNIT_ONLY'),
    JSON.stringify(codes(lihUnitOnly)));

  const lihCodeMismatch = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 100, lih_type: 'UN3481',
    items: [{ mawb: 'A', pcs: 8, declared_weight: 100, is_squeeze: true, lih_type: 'UN3091' }]
  });
  check('11.9 板 UN3481、票 UN3091 → LIH_UN_CODE_MISMATCH', codes(lihCodeMismatch).includes('LIH_UN_CODE_MISMATCH'),
    JSON.stringify(codes(lihCodeMismatch)));
  check('11.10 板與票 UN 相同時沒有 LIH 檢核',
    codes(uldComputeUnit({
      kind: 'ULD', tare_weight: 0, rcl_gross_weight: 100, lih_type: 'UN3481',
      items: [{ mawb: 'A', pcs: 8, declared_weight: 100, is_squeeze: true, lih_type: 'UN3481' }]
    })).filter(c => c.startsWith('LIH_')).length === 0);

  const bigDiff = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 2000,
    items: [{ mawb: 'A', pcs: 1, declared_weight: 1000, is_squeeze: true }]
  });
  check('11.11 磅差 1000kg（50%）→ DIFF_TOO_BIG（預設門檻 2% / 100kg）', codes(bigDiff).includes('DIFF_TOO_BIG'));
  check('11.12 回傳實際使用的門檻（預設 2 / 100）',
    bigDiff.diffWarnPct === 2 && bigDiff.diffWarnKg === 100,
    `(${bigDiff.diffWarnPct}% / ${bigDiff.diffWarnKg}kg)`);
  check('11.13 門檻放寬到 2% / 1200kg → 同一個磅差不提示',
    !codes(uldComputeUnit({
      kind: 'ULD', tare_weight: 0, rcl_gross_weight: 2000,
      items: [{ mawb: 'A', pcs: 1, declared_weight: 1000, is_squeeze: true }]
    }, { diffWarnPct: 2, diffWarnKg: 1200 })).includes('DIFF_TOO_BIG'));
  check('11.14 門檻放寬到 60% / 100kg → 同一個磅差不提示（% 與 kg 需同時超過）',
    !codes(uldComputeUnit({
      kind: 'ULD', tare_weight: 0, rcl_gross_weight: 2000,
      items: [{ mawb: 'A', pcs: 1, declared_weight: 1000, is_squeeze: true }]
    }, { diffWarnPct: 60, diffWarnKg: 100 })).includes('DIFF_TOO_BIG'));
  const smallDiff = {
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 1000,
    items: [{ mawb: 'A', pcs: 1, declared_weight: 980, is_squeeze: true }]
  };
  check('11.15 小磅差 20kg（2%）在預設門檻下不提示',
    !codes(uldComputeUnit(smallDiff)).includes('DIFF_TOO_BIG'));
  check('11.16 門檻收緊到 1% / 10kg → 同一個小磅差會提示',
    codes(uldComputeUnit(smallDiff, { diffWarnPct: 1, diffWarnKg: 10 })).includes('DIFF_TOO_BIG'));

  // 表頭（夾重表）帶入的門檻要能生效（W5：DB／API → calc.uldComputeSheet 的 src.diff_warn_pct / diff_warn_kg）
  const sheetTight = uldComputeSheet({
    diff_warn_pct: 1, diff_warn_kg: 10,
    ulds: [{ uid: 'a', kind: 'ULD', uld_number: 'PMC1', tare_weight: 0, rcl_gross_weight: 1000,
      items: [{ mawb: '160-00000101', pcs: 1, declared_weight: 980, is_squeeze: true }] }]
  });
  const sheetLoose = uldComputeSheet({
    diff_warn_pct: 5, diff_warn_kg: 500,
    ulds: [{ uid: 'a', kind: 'ULD', uld_number: 'PMC1', tare_weight: 0, rcl_gross_weight: 1000,
      items: [{ mawb: '160-00000101', pcs: 1, declared_weight: 980, is_squeeze: true }] }]
  });
  check('11.17 夾重表的門檻（1% / 10kg）會讓小磅差提示 DIFF_TOO_BIG',
    sheetTight.issues.some(i => i.code === 'DIFF_TOO_BIG'));
  check('11.18 夾重表的門檻（5% / 500kg）放寬後不提示，且 options 有帶入',
    !sheetLoose.issues.some(i => i.code === 'DIFF_TOO_BIG') &&
    sheetLoose.options.diffWarnPct === 5 && sheetLoose.options.diffWarnKg === 500);

  const dupMawb = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 200,
    items: [
      { mawb: '160-00000031', pcs: 1, declared_weight: 100, is_squeeze: true },
      { mawb: '16000000031', pcs: 1, declared_weight: 100, is_squeeze: false }
    ]
  });
  check('11.19 同板重複同一 MAWB（含格式差異）→ DUPLICATE_MAWB_IN_ULD',
    codes(dupMawb).includes('DUPLICATE_MAWB_IN_ULD'));

  // ===== 6. 整表彙總 =====
  console.log('\n--- 6. 整表彙總 ---');
  check('12.1 彙總 MAWB 數 = 2（CASE4）', case4Sheet.mawbs.length === 2);
  check('12.2 板數 = 2、散貨數 = 0',
    case4Sheet.totals.unitCount === 2 && case4Sheet.totals.bulkCount === 0);
  check('12.3 RCL（淨）總計 = 1313', near(case4Sheet.totals.rclTotal, 1313), `(${case4Sheet.totals.rclTotal})`);
  check('12.4 Tare 總重 = 227', near(case4Sheet.totals.tareTotal, 227), `(${case4Sheet.totals.tareTotal})`);
  check('12.5 夾重後總計 = 1313', near(case4Sheet.totals.netTotal, 1313), `(${case4Sheet.totals.netTotal})`);
  check('12.6 磅差總計 = 0', near(case4Sheet.totals.diffTotal, 0), `(${case4Sheet.totals.diffTotal})`);
  check('12.7 CASE3 全表無 error', case3Sheet.totals.hasError === false);

  const splitSheet = uldComputeSheet({
    ulds: [
      {
        uid: 'a', kind: 'ULD', uld_number: 'PMC9', tare_weight: 100, rcl_gross_weight: 700,
        items: [{ mawb: '160-00000041', pcs: 5, declared_weight: 600, is_squeeze: true }]
      },
      {
        uid: 'b', kind: 'ULD', uld_number: 'PMC9', tare_weight: 100, rcl_gross_weight: 500,
        items: [{ mawb: '160-00000041', pcs: 3, declared_weight: 0, is_squeeze: true }]
      }
    ]
  });
  check('13.1 同一 MAWB 多板但有一板未填重量 → MAWB_SPLIT_MISSING',
    splitSheet.issues.map(i => i.code).includes('MAWB_SPLIT_MISSING'));
  check('13.2 ULD 號重複 → DUPLICATE_ULD',
    splitSheet.issues.map(i => i.code).includes('DUPLICATE_ULD'));

  // ===== 7. 依件數拆分重量 =====
  console.log('\n--- 7. 依件數拆分重量 ---');
  const split1 = uldSplitByPcs(1013, [{ pcs: 3 }, { pcs: 3 }]);
  check('14.1 1013kg 分 3:3 → 507 + 506（合計 1013）',
    near(split1[0], 507) && near(split1[1], 506) && near(split1[0] + split1[1], 1013),
    `(${split1.join(' + ')})`);
  const split2 = uldSplitByPcs(1000, [{ pcs: 1 }, { pcs: 3 }]);
  check('14.2 1000kg 分 1:3 → 250 / 750',
    near(split2[0], 250) && near(split2[1], 750), `(${split2.join(' / ')})`);
  const split3 = uldSplitByPcs(1000, [{ pcs: 0 }, { pcs: 0 }]);
  check('14.3 件數皆 0 → 平均 500 / 500', near(split3[0], 500) && near(split3[1], 500), `(${split3.join(' / ')})`);
  const split4 = uldSplitByPcs(1000.3, [{ pcs: 2 }, { pcs: 2 }], 0.5);
  check('14.4 取整 0.5 → 合計 = 1000.5',
    near(split4[0] + split4[1], 1000.5), `(${split4.join(' + ')})`);

  // ===== 8. 工具函式 =====
  console.log('\n--- 8. 工具函式 ---');
  check('15.1 MAWB 正規化去空白連字號', uldNormalizeMawb('160-1234 5675') === '16012345675');
  check('15.2 磅重顯示 2453 → "2453"', uldFmtKg(2453) === '2453');
  check('15.3 磅重顯示 2453.5 → "2453.5"', uldFmtKg(2453.5) === '2453.5');
  check('15.4 板型選項 3 種（P/X/B）', calc.ULD_PREDECL_TYPES.length === 3);
  check('15.5 貨站 3 個（HACTL/AAT/CPSL）',
    calc.ULD_TERMINALS.join(',') === 'HACTL,AAT,CPSL', calc.ULD_TERMINALS.join(','));

  // ===== 9. 回寫 Booking Record 的彙總（W2）=====
  console.log('\n--- 9. Booking Record 彙總（W2 回寫用）---');
  const bookingSheet = uldComputeSheet({
    round_px: 1, round_b: 1, tail_mode: 'adjust_largest',
    ulds: [
      {
        uid: 'a', kind: 'ULD', uld_number: 'PMC0003XX', tare_weight: 115, rcl_gross_weight: 425,
        items: [
          { mawb: '160-00000005', mawb_record_id: 11, pcs: 5, declared_weight: 300, is_squeeze: false },
          { mawb: '160-00000006', mawb_record_id: 12, pcs: 3, declared_weight: 125, is_squeeze: true }
        ]
      },
      {
        uid: 'b', kind: 'ULD', uld_number: 'PMC0004XX', tare_weight: 112, rcl_gross_weight: 888,
        items: [{ mawb: '160-00000006', mawb_record_id: 12, pcs: 3, declared_weight: 888, is_squeeze: true }]
      }
    ]
  });
  const bookingTotals = uldBookingTotals(bookingSheet);
  const entryA = bookingTotals.entries.find(e => e.mawb_record_id === 11);
  const entryB = bookingTotals.entries.find(e => e.mawb_record_id === 12);
  check('16.1 同一票跨板加總（Booking 12 = 125 + 888 = 1013）', near(entryB.final, 1013), entryB && `(${entryB.final})`);
  check('16.2 不夾重的票維持申報重量（Booking 11 = 300）', near(entryA.final, 300), entryA && `(${entryA.final})`);
  check('16.3 每票帶回板數／件數（Booking 12：2 板 6 件）',
    entryB.unitCount === 2 && entryB.pcs === 6, entryB && `${entryB.unitCount}／${entryB.pcs}`);
  check('16.4 兩票都可回寫、沒有衝突',
    bookingTotals.entries.length === 2 && bookingTotals.conflicts.length === 0);
  check('16.5 未連結 Booking 的票列在 unlinked', bookingTotals.unlinked.length === 0);

  const unlinkedSheet = uldComputeSheet({
    ulds: [{
      uid: 'a', kind: 'ULD', tare_weight: 0, rcl_gross_weight: 300,
      items: [{ mawb: '160-00000009', pcs: 2, declared_weight: 300, is_squeeze: false }]
    }]
  });
  const unlinkedTotals = uldBookingTotals(unlinkedSheet);
  check('16.6 手動輸入的 MAWB（沒有 mawb_record_id）不會被回寫',
    unlinkedTotals.entries.length === 0 && unlinkedTotals.unlinked.length === 1 &&
    unlinkedTotals.unlinked[0].mawb === '160-00000009');

  const dupBookingSheet = uldComputeSheet({
    ulds: [{
      uid: 'x', kind: 'ULD', tare_weight: 0, rcl_gross_weight: 100,
      items: [
        { mawb: '160-00000051', mawb_record_id: 21, pcs: 1, declared_weight: 100, is_squeeze: false },
        { mawb: '160-00000051', mawb_record_id: 22, pcs: 1, declared_weight: 0, is_squeeze: false }
      ]
    }]
  });
  check('16.7 同一 MAWB 對到兩個 Booking → duplicate_booking（不回寫）',
    uldBookingTotals(dupBookingSheet).conflicts.some(c => c.reason === 'duplicate_booking'));

  const mismatchSheet = uldComputeSheet({
    ulds: [{
      uid: 'y', kind: 'ULD', tare_weight: 0, rcl_gross_weight: 200,
      items: [
        { mawb: '160-00000061', mawb_record_id: 31, pcs: 1, declared_weight: 200, is_squeeze: false },
        { mawb: '160-00000062', mawb_record_id: 31, pcs: 1, declared_weight: 0, is_squeeze: false }
      ]
    }]
  });
  check('16.8 同一 Booking 有兩個 MAWB 號碼 → mawb_mismatch（不回寫）',
    uldBookingTotals(mismatchSheet).conflicts.some(c => c.reason === 'mawb_mismatch'));

  // ===== 17. 多票夾重比例上下限（R2）=====
  console.log('\n--- 17. 多票夾重比例上下限（R2）---');
  const clampFn = calc.uldApplyRatioClamp;
  check('17.1 沒設限（0／0）→ 比例原封不動',
    JSON.stringify(clampFn([0.9, 0.05, 0.05], 0, 0).ratios) === JSON.stringify([0.9, 0.05, 0.05]) &&
    clampFn([0.9, 0.05, 0.05], 0, 0).clamped.every(v => v === false));

  const clampMax = clampFn([0.9, 0.05, 0.05], 0, 40);
  check('17.2 上限 40% → 0.9 被壓到 0.4，其餘按比例重分配（0.4／0.3／0.3）',
    near(clampMax.ratios[0], 0.4) && near(clampMax.ratios[1], 0.3) && near(clampMax.ratios[2], 0.3),
    JSON.stringify(clampMax.ratios));
  check('17.3 被限制的票標記 clamped、比例合計仍為 1',
    clampMax.clamped[0] === true && clampMax.clamped[1] === false &&
    near(clampMax.ratios.reduce((s, v) => s + v, 0), 1));

  const clampMin = clampFn([0.9, 0.05, 0.05], 30, 0);
  check('17.4 下限 30% → 兩張小票被拉到 0.3，其餘 0.4',
    near(clampMin.ratios[0], 0.4) && near(clampMin.ratios[1], 0.3) && near(clampMin.ratios[2], 0.3),
    JSON.stringify(clampMin.ratios));

  const clampBoth = clampFn([0.5, 0.5], 20, 60);
  check('17.5 上下限同時設定且不越界 → 不改比例', JSON.stringify(clampBoth.ratios) === JSON.stringify([0.5, 0.5]));

  const clampBadMax = clampFn([0.8, 0.2], 0, 30);
  check('17.6 上限 30% × 2 票 < 100% → infeasible（比例不動、不丟錯）',
    clampBadMax.infeasible === true && clampBadMax.reason === 'max_sum_below_100' &&
    JSON.stringify(clampBadMax.ratios) === JSON.stringify([0.8, 0.2]));
  const clampBadMin = clampFn([0.5, 0.5], 60, 0);
  check('17.7 下限 60% × 2 票 > 100% → infeasible（min_sum_exceeds_100）',
    clampBadMin.infeasible === true && clampBadMin.reason === 'min_sum_exceeds_100');
  check('17.7b 只有 1 票參與夾重 → 忽略上下限（比例 100%、不視為無解）',
    (() => {
      const one = clampFn([1], 0, 60);
      return one.infeasible === false && near(one.ratios[0], 1);
    })());

  // 單位層：RCL 2000／Tare 0、三票 900／50／50（磅差 1000），上限 40%
  const clampUnit = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 2000, squeeze_mode: 'weight',
    items: [
      { mawb: '160-00000071', pcs: 9, declared_weight: 900, is_squeeze: true },
      { mawb: '160-00000072', pcs: 1, declared_weight: 50, is_squeeze: true },
      { mawb: '160-00000073', pcs: 1, declared_weight: 50, is_squeeze: true }
    ]
  }, { clampMaxPct: 40 });
  const clamped70 = findItem(clampUnit, '160-00000071');
  const clamped72 = findItem(clampUnit, '160-00000072');
  check('17.8 單位層：上限 40% → 最大票比例 40%（原本 90%）',
    near(clamped70.ratio, 0.4) && clamped70.ratioClamped === true, `(${(clamped70.ratio * 100).toFixed(1)}%)`);
  check('17.9 單位層：重分配後小票比例各 30%',
    near(clamped72.ratio, 0.3), `(${(clamped72.ratio * 100).toFixed(1)}%)`);
  check('17.10 單位層：取整後合計仍等於目標淨重 2000',
    near(clampUnit.finalSum, 2000), `(${clampUnit.finalSum})`);
  check('17.11 單位層：最終重量 1300／350／350',
    near(clamped70.final, 1300) && near(clamped72.final, 350),
    `(${clamped70.final}／${clamped72.final})`);
  check('17.12 回傳實際套用的上下限（clampMaxPct = 40）', near(clampUnit.clampMaxPct, 40));

  const clampInfeasibleUnit = uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 1100, squeeze_mode: 'weight',
    items: [
      { mawb: '160-00000081', pcs: 8, declared_weight: 800, is_squeeze: true },
      { mawb: '160-00000082', pcs: 2, declared_weight: 200, is_squeeze: true }
    ]
  }, { clampMaxPct: 30 });
  check('17.13 上下限無解 → 提 CLAMP_INFEASIBLE 警示、仍可算出合計',
    codes(clampInfeasibleUnit).includes('CLAMP_INFEASIBLE') && near(clampInfeasibleUnit.finalSum, 1100),
    JSON.stringify(codes(clampInfeasibleUnit)));
  check('17.14 CLAMP_INFEASIBLE 是 warn（不擋存檔）',
    clampInfeasibleUnit.issues.find(i => i.code === 'CLAMP_INFEASIBLE').level === 'warn');

  // 整張表：表頭 clamp_max_pct 會傳進每個單位
  const clampSheet = uldComputeSheet({
    clamp_min_pct: 0, clamp_max_pct: 40, round_px: 1, round_b: 1,
    ulds: [{
      uid: 'a', kind: 'ULD', uld_number: 'PMC9999XX', tare_weight: 0, rcl_gross_weight: 2000,
      predecl_type: 'X', squeeze_mode: 'weight',
      items: [
        { mawb: '160-00000071', pcs: 9, declared_weight: 900, is_squeeze: true },
        { mawb: '160-00000072', pcs: 1, declared_weight: 50, is_squeeze: true },
        { mawb: '160-00000073', pcs: 1, declared_weight: 50, is_squeeze: true }
      ]
    }]
  });
  const sheetItems = clampSheet.units[0].calc.items;
  check('17.15 表頭 clamp_max_pct 傳進 calc（所有夾重票比例 ≤ 40%）',
    sheetItems.every(it => !it.squeeze || it.ratio <= 0.4 + 1e-9),
    JSON.stringify(sheetItems.map(it => Number(it.ratio.toFixed(3)))));
  check('17.16 表頭 clamp_max_pct 不影響未設限的表（0 = 不限）',
    Math.abs(uldComputeSheet({
      ulds: [{
        uid: 'b', kind: 'ULD', tare_weight: 0, rcl_gross_weight: 2000,
        items: [
          { mawb: '160-00000071', pcs: 9, declared_weight: 900, is_squeeze: true },
          { mawb: '160-00000072', pcs: 1, declared_weight: 50, is_squeeze: true },
          { mawb: '160-00000073', pcs: 1, declared_weight: 50, is_squeeze: true }
        ]
      }]
    }).units[0].calc.items[0].ratio - 0.9) < 1e-9);

  // ===== 18. 方案 B：MAWB 申報列 → 各板重量分配 =====
  console.log('\n--- 18. MAWB 申報列重量分配（方案 B）---');
  const {
    uldAllocateByPcs, uldApplyMawbAllocation
  } = calc;

  const allocEven = uldAllocateByPcs(1000, [{ pcs: 3 }, { pcs: 1 }]);
  check('18.1 依件數分重量（3:1 → 750／250），合計 = 申報重量',
    near(allocEven[0], 750) && near(allocEven[1], 250));

  const allocOdd = uldAllocateByPcs(1000, [{ pcs: 1 }, { pcs: 1 }, { pcs: 1 }]);
  check('18.2 除不盡時尾差給第一筆，合計仍等於申報重量',
    near(allocOdd.reduce((sum, v) => sum + v, 0), 1000) && near(allocOdd[0], 333.334, 1e-3),
    JSON.stringify(allocOdd));

  const allocNoPcs = uldAllocateByPcs(500, [{ pcs: 0 }, { pcs: 0 }]);
  check('18.3 件數都是 0 → 平均分（250／250）', near(allocNoPcs[0], 250) && near(allocNoPcs[1], 250));

  const allocOne = uldAllocateByPcs(1400, [{ pcs: 10 }]);
  check('18.4 一票只在一板 → 整票重量都在那一板（1400）', near(allocOne[0], 1400));

  const allocSheet = {
    mawbs: [{ mawb: '160-00000101', declared_weight: 1000, auto_alloc: 1 }],
    ulds: [
      { uid: 'a', items: [{ mawb: '160-00000101', pcs: 3, declared_weight: 0 }] },
      { uid: 'b', items: [{ mawb: '160-00000101', pcs: 1, declared_weight: 0 }] }
    ]
  };
  const allocResult = uldApplyMawbAllocation(allocSheet);
  check('18.5 申報列套回各板（3 件 750／1 件 250，共改 2 筆）',
    near(allocSheet.ulds[0].items[0].declared_weight, 750) &&
    near(allocSheet.ulds[1].items[0].declared_weight, 250) && allocResult.changed === 2);

  const manualSheet = {
    mawbs: [{ mawb: '160-00000102', declared_weight: 2000, auto_alloc: 0 }],
    ulds: [{ uid: 'a', items: [{ mawb: '160-00000102', pcs: 5, declared_weight: 125 }] }]
  };
  uldApplyMawbAllocation(manualSheet);
  check('18.6 auto_alloc = 0 的列不改各板重量（舊資料安全）',
    near(manualSheet.ulds[0].items[0].declared_weight, 125));

  const orphanSheet = {
    mawbs: [],
    ulds: [{ uid: 'a', items: [{ mawb: '160-00000103', pcs: 5, declared_weight: 300 }] }]
  };
  uldApplyMawbAllocation(orphanSheet);
  check('18.7 沒有申報列時不改任何明細重量', near(orphanSheet.ulds[0].items[0].declared_weight, 300));

  // 分配 → 夾重：單板整票重量都在該板，夾重後合計 = RCL 淨重
  const allocSqueezeSheet = {
    round_px: 1, round_b: 1, tail_mode: 'adjust_largest',
    mawbs: [{ mawb: '160-00000104', declared_weight: 1400, auto_alloc: 1 }],
    ulds: [{
      uid: 'a', kind: 'ULD', tare_weight: 100, rcl_gross_weight: 1250,
      items: [{ mawb: '160-00000104', pcs: 10, declared_weight: 0, is_squeeze: true }]
    }]
  };
  uldApplyMawbAllocation(allocSqueezeSheet);
  const allocSqueezeComputed = uldComputeSheet(allocSqueezeSheet);
  check('18.8 分配後再夾重：申報 1400 → 最終 = RCL 淨重 1250',
    near(allocSqueezeSheet.ulds[0].items[0].declared_weight, 1400) &&
    near(allocSqueezeComputed.units[0].calc.finalSum, 1250),
    String(allocSqueezeComputed.units[0].calc.finalSum));

  // ===== 19. 手動指定單板重量（載荷表 WT 直接打字）=====
  console.log('\n--- 19. 手動指定單板重量（uldAllocateWithFixed）---');
  const fixed3 = calc.uldAllocateWithFixed(2000, [{ pcs: 3 }, { pcs: 3 }, { pcs: 2 }], 0, 1000);
  check('19.1 指定第 1 板 1000 → 其餘 1000 依件數（3:2）分 600／400',
    near(fixed3[0], 1000) && near(fixed3[1], 600) && near(fixed3[2], 400),
    JSON.stringify(fixed3));
  check('19.2 分配後合計仍等於申報重量（2000）',
    near(fixed3.reduce((sum, v) => sum + v, 0), 2000));

  const fixedOver = calc.uldAllocateWithFixed(1013, [{ pcs: 3 }, { pcs: 3 }], 1, 5000);
  check('19.3 打的重量超過申報 WT → 夾到申報 WT（其他板不吃負數）',
    near(fixedOver[1], 1013) && near(fixedOver[0], 0), JSON.stringify(fixedOver));

  const fixedZeroPcs = calc.uldAllocateWithFixed(900, [{ pcs: 0 }, { pcs: 0 }, { pcs: 0 }], 0, 300);
  check('19.4 其他板都沒件數 → 剩下的平均分（300／300）',
    near(fixedZeroPcs[0], 300) && near(fixedZeroPcs[1], 300) && near(fixedZeroPcs[2], 300),
    JSON.stringify(fixedZeroPcs));

  const fixedSingle = calc.uldAllocateWithFixed(1400, [{ pcs: 10 }], 0, 500);
  check('19.5 一票只在一板 → 整票重量都在那一板（500 被夾成 1400）',
    near(fixedSingle[0], 1400), JSON.stringify(fixedSingle));

  const fixedBad = calc.uldAllocateWithFixed(800, [{ pcs: 1 }, { pcs: 1 }], 9, 400);
  check('19.6 索引超出範圍 → 退回原本的依件數分配（400／400）',
    near(fixedBad[0], 400) && near(fixedBad[1], 400), JSON.stringify(fixedBad));

  console.log(`\n===== ${failCount === 0 ? '全部通過' : failCount + ' 項失敗'}（PASS ${passCount} / FAIL ${failCount}）=====`);
  process.exitCode = failCount === 0 ? 0 : 1;
})();
