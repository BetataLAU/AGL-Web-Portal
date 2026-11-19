// ===== 執 PLAN（Loading Plan）：計算核心測試 =====
// 直接以 Node 載入 public/js/loading-plan/calc.js（ESM；Node 22+ 會自動偵測模組語法）
// 用法：node scripts/test-loading-plan-calc.js
const path = require('path');
const { pathToFileURL } = require('url');

const CALC_URL = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'loading-plan', 'calc.js')).href;

let passCount = 0;
let failCount = 0;

function check(name, ok, extra = '') {
  if (ok) passCount += 1; else failCount += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

function near(a, b, tolerance = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

(async () => {
  console.log('===== 執 PLAN：計算核心測試 =====\n');
  const calc = await import(CALC_URL);
  const {
    LP_VOL_DIVISOR, LP_CBM_PER_CUFT,
    lpVolFromCbm, lpCbmFromVol, lpCuftFromCbm, lpCbmFromCuft, lpConvertVolume,
    lpParsePkgs, lpPlanLabel, lpFlightDateLabel,
    lpContourParse, lpResolveContourCode, lpScaleCapacity,
    lpTotals, lpKpi, lpNormalizeMawbKey, lpDisplayMawb, lpItemVolume
  } = calc;

  // ===== 0. 常數 =====
  console.log('--- 0. 常數 ---');
  check('0.1 VOL 係數 = 0.006', near(LP_VOL_DIVISOR, 0.006));
  check('0.2 1 cu.ft = 0.028316846592 m³', near(LP_CBM_PER_CUFT, 0.028316846592));

  // ===== 1. 單位換算（往返）=====
  console.log('--- 1. 單位換算 ---');
  check('1.1 6.82 CBM → VOL 1,136.67', near(lpVolFromCbm(6.82), 1136.67), `(${lpVolFromCbm(6.82)})`);
  check('1.2 1,136.67 VOL → CBM 6.82', near(lpCbmFromVol(1136.67), 6.82), `(${lpCbmFromVol(1136.67)})`);
  check('1.3 6.82 CBM → 240.85 cu.ft', near(lpCuftFromCbm(6.82), 240.85), `(${lpCuftFromCbm(6.82)})`);
  check('1.4 240.85 cu.ft → CBM 6.82', near(lpCbmFromCuft(240.85), 6.82), `(${lpCbmFromCuft(240.85)})`);
  check('1.5 cbm→vol', near(lpConvertVolume(6.82, 'cbm', 'vol'), 1136.67));
  check('1.6 vol→cbm', near(lpConvertVolume(1136.67, 'vol', 'cbm'), 6.82));
  check('1.7 cuft→cbm', near(lpConvertVolume(240.85, 'cuft', 'cbm'), 6.82));
  check('1.8 cbm→cuft', near(lpConvertVolume(6.82, 'cbm', 'cuft'), 240.85));
  check('1.9 同單位只做四捨五入', near(lpConvertVolume(6.8219, 'cbm', 'cbm'), 6.822), `(${lpConvertVolume(6.8219, 'cbm', 'cbm')})`);
  check('1.10 空白 → 0', lpConvertVolume('', 'cbm', 'vol') === 0);
  check('1.11 非數字 → 0', lpConvertVolume('abc', 'cbm', 'vol') === 0);

  // ===== 2. 逐列四捨五入再加總（不可用總量回算）=====
  console.log('--- 2. 逐列捨入 ---');
  const tiny = lpTotals([{ cbm: 0.004 }, { cbm: 0.004 }, { cbm: 0.004 }]);
  check('2.1 三列 0.004 CBM → 逐列 0.67，合計 2.01', near(tiny.vol, 2.01), `(${tiny.vol})`);
  check('2.2 對照：總量回算 = 2.00（證明不可用總量）', near(0.012 / LP_VOL_DIVISOR, 2), `(${(0.012 / LP_VOL_DIVISOR).toFixed(4)})`);

  // DAY 1 區塊1（Excel R7:R18）實際 CBM：無 VOL 原值 → 逐列換算
  const day1Cbm = [8.69, 0.54, 0.85, 2.04, 0.9, 1.81, 0.82, 2.21];
  const day1 = lpTotals(day1Cbm.map(cbm => ({ cbm })));
  check('2.3 DAY 1 逐列換算 VOL = 2,976.67', near(day1.vol, 2976.67), `(${day1.vol})`);
  check('2.4 DAY 1 CBM 合計 = 17.86', near(day1.cbm, 17.86), `(${day1.cbm})`);

  // DAY 7 區塊1：有 VOL 原值 → 必須保留原值（Excel Q19 = 5,934 / R19 = 35.62）
  const day7Rows = [
    { cbm: 6.82, volume_weight: 1135 }, { cbm: 1.43, volume_weight: 238 },
    { cbm: 3.4, volume_weight: 566 }, { cbm: 2.34, volume_weight: 390 },
    { cbm: 1.74, volume_weight: 290 }, { cbm: 0.36, volume_weight: 60.5 },
    { cbm: 0.95, volume_weight: 158 }, { cbm: 0.71, volume_weight: 118 },
    { cbm: 3.12, volume_weight: 519.5 }, { cbm: 14.75, volume_weight: 2459 }
  ];
  const day7 = lpTotals(day7Rows);
  check('2.5 DAY 7 保留 Excel VOL 原值 → 5,934', near(day7.vol, 5934), `(${day7.vol})`);
  check('2.6 DAY 7 CBM 合計 = 35.62', near(day7.cbm, 35.62), `(${day7.cbm})`);
  check('2.7 有原值時不計入 volCalculated', day7.volCalculated === 0, `(${day7.volCalculated})`);

  // ===== 3. PKGS 解析（P = Pallet、C/CTNS = Carton）=====
  console.log('--- 3. PKGS 解析 ---');
  const p1 = lpParsePkgs('17+7P');
  check('3.1 "17+7P" → 17 cartons + 7 pallets = 24', p1.cartons === 17 && p1.pallets === 7 && p1.pcsTotal === 24,
    JSON.stringify({ c: p1.cartons, p: p1.pallets, t: p1.pcsTotal }));
  check('3.2 "17+7P" 不算未填', p1.incomplete === false);

  const p2 = lpParsePkgs('8P');
  check('3.3 "8P" → 0 + 8 = 8', p2.cartons === 0 && p2.pallets === 8 && p2.pcsTotal === 8);
  const p3 = lpParsePkgs('4+1P');
  check('3.4 "4+1P" → 4 + 1 = 5', p3.cartons === 4 && p3.pallets === 1 && p3.pcsTotal === 5);
  const p4 = lpParsePkgs('34');
  check('3.5 "34" → 34 cartons', p4.cartons === 34 && p4.pallets === 0 && p4.pcsTotal === 34);
  const p5 = lpParsePkgs('1P');
  check('3.6 "1P" → 1 pallet', p5.pallets === 1 && p5.pcsTotal === 1);
  const p6 = lpParsePkgs('17 C + 7 P');
  check('3.7 "17 C + 7 P" 也支援', p6.cartons === 17 && p6.pallets === 7 && p6.pcsTotal === 24);

  const p7 = lpParsePkgs('CTNS');
  check('3.8 "CTNS" → 件數未填（不亂猜 1）', p7.cartons === null && p7.pcsTotal === null && p7.incomplete === true,
    JSON.stringify({ c: p7.cartons, hint: p7.unitHint }));
  check('3.9 "CTNS" 保留原文', p7.text === 'CTNS' && p7.unitHint === 'CTNS');
  check('3.10 空白 → 未填', lpParsePkgs('').incomplete === true);
  check('3.11 "-" → 未填', lpParsePkgs('-').incomplete === true);

  // ===== 4. Plan 識別名：Flight# / Flight Date + Owner =====
  console.log('--- 4. Plan 識別名 ---');
  check('4.1 完整 label', lpPlanLabel({ flight_no: 'EK9859', flight_date: '2026-11-14', owner_company: 'SKY DRAGON' })
    === 'EK9859 / 14NOV / SKY DRAGON', `(${lpPlanLabel({ flight_no: 'EK9859', flight_date: '2026-11-14', owner_company: 'SKY DRAGON' })})`);
  check('4.2 缺 Flight Date → —', lpPlanLabel({ flight_no: 'EK9859', owner_company: 'SKY DRAGON' })
    === 'EK9859 / — / SKY DRAGON');
  check('4.3 只有 day_code → D3 / — / —', lpPlanLabel({ day_code: 'D3' }) === 'D3 / — / —');
  check('4.4 yyyy/m/d → 04NOV', lpFlightDateLabel('2026/11/4') === '04NOV', `(${lpFlightDateLabel('2026/11/4')})`);
  check('4.5 ISO 字串 → 14NOV', lpFlightDateLabel('2026-11-14T22:35:00.000Z') === '14NOV');
  check('4.6 空白 → —', lpFlightDateLabel('') === '—');
  check('4.7 已是 14NOV 就原樣', lpFlightDateLabel('14NOV') === '14NOV');

  // ===== 5. Contour 解析 + 規格庫比對 =====
  console.log('--- 5. Contour ---');
  const SPEC_CODES = ['Q7-00', 'Q3-00', 'Q6-00', 'H3-00', 'W2-00', 'Z5', 'ZA'];
  const c1 = lpContourParse('1 X Q5');
  check('5.1 "1 X Q5" → qty 1 / code Q5', c1.qty === 1 && c1.code === 'Q5');
  const q5 = lpResolveContourCode('Q5', SPEC_CODES);
  check('5.2 Q5 不在規格庫 → known false', q5.code === 'Q5' && q5.known === false, JSON.stringify(q5));
  const h3 = lpResolveContourCode('H3', SPEC_CODES);
  check('5.3 H3 → H3-00（known true）', h3.code === 'H3-00' && h3.known === true, JSON.stringify(h3));
  const z5 = lpResolveContourCode('Z5', SPEC_CODES);
  check('5.4 Z5 不得亂補 -00', z5.code === 'Z5' && z5.known === true, JSON.stringify(z5));
  const c2 = lpContourParse('2 X H3-00');
  check('5.5 "2 X H3-00" → qty 2', c2.qty === 2 && c2.code === 'H3-00');
  check('5.6 "H3" → qty 1', lpContourParse('H3').qty === 1);
  const messy1 = lpContourParse("1 X Q5 '新BSA");
  check('5.9 雜訊「1 X Q5 \'新BSA」→ 取 Q5', messy1.qty === 1 && messy1.code === 'Q5', JSON.stringify(messy1));
  check('5.10 「1 X Q5 / /半板」→ 取 Q5', lpContourParse('1 X Q5 / /半板').code === 'Q5');
  check('5.11 「CO-LOAD」不亂猜代碼', lpContourParse('CO-LOAD').code === '');
  check('5.12 「\'新BSA」不亂猜代碼', lpContourParse("'新BSA").code === '');
  check('5.13 「CO-LOAD」原文保留', lpContourParse('CO-LOAD').text === 'CO-LOAD');
  check('5.7 2 板容量 ×2（6,804 → 13,608）', near(lpScaleCapacity(6804, 2), 13608), `(${lpScaleCapacity(6804, 2)})`);
  check('5.8 上限未設 → null', lpScaleCapacity(null, 2) === null);

  // ===== 6. 合計 / KPI =====
  console.log('--- 6. 合計與 KPI ---');
  const items = [
    { mawb: '176-6985 5240', gross_weight: 1302, cbm: 6.82, volume_weight: 1135, pcs_total: 24, cartons: 17, pallets: 7 },
    { mawb: '176-6840 0640', gross_weight: 220, cbm: 1.43, volume_weight: 238, pcs_total: 7, cartons: 3, pallets: 4 },
    { mawb: '', gross_weight: 59, cbm: 0.36, pcs_total: null, pkgs_text: 'CTNS' }
  ];
  const totals = lpTotals(items);
  check('6.1 票數 3', totals.tickets === 3);
  check('6.2 G.W 1,581', near(totals.grossWeight, 1581), `(${totals.grossWeight})`);
  check('6.3 CBM 8.61', near(totals.cbm, 8.61), `(${totals.cbm})`);
  check('6.4 VOL 1,433（含一列由 CBM 回算）', near(totals.vol, 1433), `(${totals.vol})`);
  check('6.5 cu.ft 304.06', near(totals.cuft, 304.06), `(${totals.cuft})`);
  check('6.6 件數 31（24+7）', totals.pcs === 31, `(${totals.pcs})`);
  check('6.7 件數未填 1 票', totals.pcsIncomplete === 1, `(${totals.pcsIncomplete})`);
  check('6.8 由 CBM 回算 VOL 的列數 = 1', totals.volCalculated === 1, `(${totals.volCalculated})`);
  check('6.9 缺 MAWB 1 票', totals.missingMawb === 1, `(${totals.missingMawb})`);
  check('6.9b MAWB 去重後 2 個（空白列不計）', totals.mawbs === 2, `(${totals.mawbs})`);
  const dupMawbTotals = lpTotals([
    { mawb: '176-6985 5240' }, { mawb: '17669855240' }, { mawb: '-' }, { mawb: '' }
  ]);
  check('6.9c 同一 MAWB 不同格式只算 1 個（空白／- 不計）',
    dupMawbTotals.mawbs === 1 && dupMawbTotals.missingMawb === 2,
    `(${dupMawbTotals.mawbs} / ${dupMawbTotals.missingMawb})`);

  const kpi = lpKpi(items, { maxGrossWeight: 1500, maxCbm: 8 });
  check('6.10 超重 81kg', near(kpi.overWeight, 81), `(${kpi.overWeight})`);
  check('6.11 超 CBM 0.61', near(kpi.overCbm, 0.61), `(${kpi.overCbm})`);
  check('6.12 G.W 使用率 105.4%', near(kpi.gwPct, 105.4), `(${kpi.gwPct})`);
  check('6.13 CBM 使用率 107.6%', near(kpi.cbmPct, 107.6), `(${kpi.cbmPct})`);
  const noLimit = lpKpi(items);
  check('6.14 未設上限 → 不檢核', noLimit.gwPct === null && noLimit.overWeight === 0);

  // ===== 7. 雜項 =====
  console.log('--- 7. MAWB 正規化 ---');
  check('7.1 去空白／符號', lpNormalizeMawbKey('176-6985 5240') === '17669855240');
  check('7.2 大小寫一致', lpNormalizeMawbKey('abc123') === lpNormalizeMawbKey('ABC 123'));
  check('7.3 "-" 視為未填', lpDisplayMawb('-') === '');
  check('7.4 原格式保留', lpDisplayMawb(' 176-6985 5240 ') === '176-6985 5240');
  const volItem = lpItemVolume({ cbm: 6.82, volume_weight: null });
  check('7.5 VOL 空白 → 由 CBM 回算', near(volItem.vol, 1136.67) && volItem.volFromCbm === true);

  console.log(`\n===== 測試結束：${passCount} 通過 / ${failCount} 失敗 =====`);
  process.exitCode = failCount ? 1 : 0;
})().catch((err) => {
  console.error('測試失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});
