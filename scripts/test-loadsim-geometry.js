// ===== 模擬裝板系統：幾何 / 重量 / 單位 邏輯測試 =====
// 直接以 Node 載入 public/js/loadsim/*.js（ESM；Node 22+ 會自動偵測模組語法）
// 用法：node scripts/test-loadsim-geometry.js
const path = require('path');
const { pathToFileURL } = require('url');

const LOADSIM_DIR = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'loadsim')).href;

let passCount = 0;
let failCount = 0;

function check(name, ok, extra = '') {
  if (ok) passCount += 1; else failCount += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

function near(a, b, tolerance = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function makeItem(overrides) {
  return {
    id: 1,
    name: 'Ctn',
    dims: { l: 100, w: 80, h: 60 },
    weight: 100,
    color: '#2563eb',
    orient: 0,
    x: 0, y: 0, z: 0,
    placed: true,
    ...overrides
  };
}

(async () => {
  console.log('===== 模擬裝板系統：邏輯測試 =====\n');

  const geometry = await import(`${LOADSIM_DIR}/geometry.js`);
  const specs = await import(`${LOADSIM_DIR}/uld-specs.js`);
  const units = await import(`${LOADSIM_DIR}/units.js`);
  const weight = await import(`${LOADSIM_DIR}/weight.js`);
  const autoplace = await import(`${LOADSIM_DIR}/autoplace.js`);

  const {
    loadsimOrientations, loadsimDimsOf, loadsimExtents, loadsimRectsOverlap,
    loadsimIsSupported, loadsimEvaluatePlacement, loadsimEnsureCcw,
    loadsimBuildPlanes, loadsimTestRectInPolygon
  } = geometry;

  // 本檔多數檢查只驗「輪廓幾何」；板底 ring track（第一層不可壓在 ring 上）由第 30 節專測。
  // 為了不讓 ring 規則干擾輪廓檢查，這裡一律取「沒有 ring」的板型。
  const specNoRing = (code, override) => {
    const spec = specs.loadsimGetSpec(code, override);
    spec.ringRect = { ...(spec.ringRect || {}), disabled: true };
    return spec;
  };

  // ===== 1. 單位換算 =====
  check('1.1 1 inch = 2.54 cm', near(units.loadsimUnitToCm(1, 'in'), 2.54));
  check('1.2 cm → inch', near(units.loadsimCmToUnit(163, 'in'), 64.17, 0.01));
  check('1.3 顯示格式 cm（整數，無小數點）', units.loadsimFormatNumber(163, 'cm') === '163');
  check('1.4 顯示格式 inch（1 位小數）', units.loadsimFormatNumber(163, 'in') === '64.2');
  check('1.4b 超出量格式 cm 整數', units.loadsimFormatAmount(62.08, 'cm') === '62');
  check('1.4c 超出量不足 1cm 顯示 <1', units.loadsimFormatAmount(0.28, 'cm') === '<1');
  check('1.4d 超出量 inch 1 位小數', units.loadsimFormatAmount(62.08, 'in') === '24.4');
  check('1.5 cm 刻度間距（2px/cm）', near(units.loadsimTickStepCm('cm', 2), 50, 0.001));
  check('1.6 inch 刻度間距（2px/cm）', near(units.loadsimTickStepCm('in', 2), 30.48, 0.001));
  check('1.6b 輸入框 step/min：cm 為整數', units.loadsimInputStep('cm') === '1' && units.loadsimInputMin('cm') === '1');
  check('1.6c 輸入框 step/min：inch 為 0.1', units.loadsimInputStep('in') === '0.1' && units.loadsimInputMin('in') === '0.1');
  check('1.6d 整數值符合 step 格線（60 在 1/1 格線上）', Math.abs((60 - Number(units.loadsimInputMin('cm'))) / Number(units.loadsimInputStep('cm')) - 59) < 1e-9);
  check('1.7 來回換算不漂移', near(units.loadsimCmToUnit(units.loadsimUnitToCm(64.2, 'in'), 'in'), 64.2, 0.0001));

  // ===== 2. 6 種方向 =====
  const dims = { l: 100, w: 80, h: 60 };
  const orients = loadsimOrientations(dims);
  check('2.1 共 6 種方向', orients.length === 6);
  const keys = orients.map(o => `${o.x}x${o.y}x${o.z}`);
  check('2.2 6 種方向不重複', new Set(keys).size === 6, JSON.stringify(keys));
  check('2.3 每種方向都是 (長,寬,高) 的排列', orients.every(o =>
    [o.x, o.y, o.z].slice().sort((a, b) => a - b).join() === [100, 80, 60].slice().sort((a, b) => a - b).join()
  ));
  check('2.4 體積不變', orients.every(o => near(o.x * o.y * o.z, 100 * 80 * 60, 0.001)));
  const rolled = loadsimDimsOf(makeItem({ orient: 4 }));
  check('2.5 orient=4 為「前倒」(x=w, y=l, z=h)', rolled.x === 80 && rolled.y === 100 && rolled.z === 60);

  // ===== 3. 重疊判定 =====
  const boxA = loadsimExtents(makeItem({ x: 0, y: 0, z: -40 }));
  const boxB = loadsimExtents(makeItem({ x: 0, y: 0, z: -40 }));
  const boxC = loadsimExtents(makeItem({ x: 100, y: 0, z: -40 }));
  const boxD = loadsimExtents(makeItem({ x: 50, y: 60, z: -40 }));
  check('3.1 同位置 → 重疊', loadsimRectsOverlap(boxA, boxB));
  check('3.2 邊貼邊（x 相接）→ 不算重疊', !loadsimRectsOverlap(boxA, boxC));
  check('3.3 疊在上方且底面貼齊 → 不算重疊', !loadsimRectsOverlap(boxA, boxD));
  check('3.4 稍微侵入 → 重疊', loadsimRectsOverlap(boxA, loadsimExtents(makeItem({ x: 99.9, y: 0, z: -40 }))));

  // ===== 4. 支撐判定 =====
  const ground = makeItem({ id: 1, x: 0, y: 0, z: -40 });
  const onTop = makeItem({ id: 2, x: 10, y: 60, z: -30 });
  const floating = makeItem({ id: 3, x: 10, y: 90, z: -30 });
  check('4.1 貼地 → 有支撐', loadsimIsSupported(loadsimExtents(ground), []));
  check('4.2 放在其他貨物頂面 → 有支撐', loadsimIsSupported(loadsimExtents(onTop), [ground]));
  check('4.3 懸空 → 沒有支撐', !loadsimIsSupported(loadsimExtents(floating), [ground]));

  // ===== 5. 板型規格與 Contour 輪廓 =====
  const q7 = specNoRing('Q7-00', null);
  check('5.1 Q7-00 尺寸（125×96×118 吋）', near(q7.baseL, 317.5) && near(q7.baseW, 243.84) && near(q7.heightCm, 299.72));
  check('5.2 Q7-00 剖面有 5 條邊', q7.planesZ.length === 5);
  check('5.3 方位名稱正確', q7.planesZ.map(p => p.label).join('/') === '底部/右側/右上斜角/上方/左側',
    q7.planesZ.map(p => p.label).join('/'));

  const fitsCenter = loadsimEvaluatePlacement(makeItem({ dims: { l: 200, w: 150, h: 100 }, x: 50, y: 0, z: -75 }), q7, [], {});
  check('5.4 200×150×100 置中 → 完全在輪廓內', fitsCenter.ok && fitsCenter.fits && !fitsCenter.overflows.length);

  const tooTall = loadsimEvaluatePlacement(makeItem({ dims: { l: 200, w: 150, h: 300 }, x: 50, y: 0, z: -75 }), q7, [], {});
  const topOverflow = tooTall.overflows.find(o => o.label === '上方');
  check('5.5 超高 → 上方超出 0.28cm', !!topOverflow && near(topOverflow.amount, 0.28));

  const inSlope = loadsimEvaluatePlacement(makeItem({ dims: { l: 100, w: 150, h: 50 }, x: 50, y: 250, z: 34 }), q7, [], {});
  const rightOverflow = inSlope.overflows.find(o => o.label === '右側');
  check('5.6 撞收角 → 右側超出 62.08cm', !!rightOverflow && near(rightOverflow.amount, 62.08, 0.1),
    rightOverflow ? `實際 ${rightOverflow.amount.toFixed(2)}` : '無');
  check('5.7 撞收角 → 也有斜角超出', inSlope.overflows.some(o => o.label.includes('斜角')));

  const inside = loadsimEvaluatePlacement(makeItem({ dims: { l: 100, w: 100, h: 50 }, x: 0, y: 0, z: -50 }), q7, [], {});
  check('5.8 完全合法位置 → ok', inside.ok);

  const beyondFront = loadsimEvaluatePlacement(makeItem({ dims: { l: 100, w: 100, h: 50 }, x: -30, y: 0, z: -50 }), q7, [], {});
  const frontOverflow = beyondFront.overflows.find(o => o.label === '前端');
  check('5.9 超出板前端 30cm', !!frontOverflow && near(frontOverflow.amount, 30));
  check('5.10 嚴格模式 → 超出不可放', !beyondFront.ok);
  const relaxed = loadsimEvaluatePlacement(makeItem({ dims: { l: 100, w: 100, h: 50 }, x: -30, y: 0, z: -50 }), q7, [], { allowOverhang: true });
  check('5.11 允許超出 → 可放但記錄超出量', relaxed.ok && relaxed.overflows.length > 0);

  // ===== 5B. ZA / ZB / ZC：B747-400 主艙「前後端收角」型（收角在 profileX）=====
  const IN = 2.54;
  const inch = value => value * IN;
  // 「上方」平面的線段長 = 頂面可用的長度（沿 X）
  const topLengthOf = spec => {
    const plane = spec.planesX.find(p => p.label === '上方');
    return plane ? Math.hypot(plane.u2 - plane.u1, plane.v2 - plane.v1) : 0;
  };
  const overflowLabels = report => report.overflows.map(o => o.label).join('/');

  const za = specNoRing('ZA', null);
  check('5.12 ZA 尺寸（125×96×96 吋）且板面 = 輪廓',
    near(za.baseL, inch(125)) && near(za.baseW, inch(96)) && near(za.heightCm, inch(96)) &&
    near(za.floorL, inch(125)) && near(za.floorW, inch(96)) && !za.flared,
    `${za.baseL.toFixed(2)}×${za.baseW.toFixed(2)}×${za.heightCm.toFixed(2)}`);
  check('5.13 ZA 收角在「長×高」剖面（6 條邊）、寬×高仍為矩形（4 條邊）',
    za.planesX.length === 6 && za.planesZ.length === 4,
    `X ${za.planesX.map(p => p.label).join('/')}｜Z ${za.planesZ.map(p => p.label).join('/')}`);
  check('5.14 ZA 頂面長 29"（48"+29"+48" = 125"）', near(topLengthOf(za), inch(29), 0.02),
    `${topLengthOf(za).toFixed(2)}cm`);

  const zx = inch(48) + (inch(29) - 60) / 2; // 60cm 貨物置於 29" 頂面中央
  const zaTopCenter = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 60, w: 100, h: 30 }, x: zx, y: inch(96) - 30, z: -50 }), za, [], { requireSupport: false });
  check('5.15 ZA 頂層（y=96"）放在 29" 頂面內 → 可放', zaTopCenter.ok && !zaTopCenter.overflows.length,
    overflowLabels(zaTopCenter));
  const zaTopFront = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 60, w: 100, h: 30 }, x: 0, y: inch(96) - 30, z: -50 }), za, [], { requireSupport: false });
  check('5.16 ZA 頂層伸到前端 → 撞「前上斜角」',
    !zaTopFront.fits && zaTopFront.overflows.some(o => o.label === '前上斜角'),
    overflowLabels(zaTopFront));
  const zaLow = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 200, w: 200, h: 60 }, x: 10, y: 0, z: -100 }), za, [], {});
  check('5.17 ZA 低層（60cm ＜ 61" 壁高）整片板面都能用', zaLow.ok, overflowLabels(zaLow));

  const zb = specNoRing('ZB', null);
  check('5.18 ZB 尺寸與頂面長 94"（15.5"+94"+15.5" = 125"）',
    near(zb.baseL, inch(125)) && near(zb.heightCm, inch(96)) && near(topLengthOf(zb), inch(94), 0.02) &&
    zb.planesX.some(p => p.label === '前上斜角') && zb.planesX.some(p => p.label === '後上斜角'),
    `頂面 ${topLengthOf(zb).toFixed(2)}cm｜${zb.planesX.map(p => p.label).join('/')}`);
  check('5.19 ZB 收角只有 15.5"：前端 67" 壁高可放、超過就撞斜角',
    loadsimEvaluatePlacement(
      makeItem({ dims: { l: 80, w: 80, h: inch(67) - 1 }, x: 0, y: 0, z: -40 }), zb, [], {}).ok &&
    !loadsimEvaluatePlacement(
      makeItem({ dims: { l: 80, w: 80, h: inch(67) + 3 }, x: 0, y: 0, z: -40 }), zb, [], {}).fits,
    `壁高 ${inch(67).toFixed(2)}cm`);

  const zc = specNoRing('ZC', null);
  check('5.20 ZC 只有一端收角（5 條邊、頂面長 113"，113"+12" = 125"）',
    zc.planesX.length === 5 && near(topLengthOf(zc), inch(113), 0.02) &&
    !zc.planesX.some(p => p.label === '前上斜角'),
    `頂面 ${topLengthOf(zc).toFixed(2)}cm｜${zc.planesX.map(p => p.label).join('/')}`);
  check('5.21 ZC 前端全高 96" 可放、後端超過 84" 撞斜角',
    loadsimEvaluatePlacement(
      makeItem({ dims: { l: 80, w: 80, h: inch(96) }, x: 0, y: 0, z: -40 }), zc, [], {}).ok &&
    !loadsimEvaluatePlacement(
      makeItem({ dims: { l: 40, w: 80, h: 40 }, x: inch(125) - 40, y: inch(96) - 40, z: -40 }), zc, [], {}).fits,
    `壁高 ${inch(84).toFixed(2)}cm`);

  // 方位名稱門檻：36° 上下的斜切不能標成「上方」（舊門檻 0.8 會標錯）
  const q9 = specNoRing('Q9-01', null);
  check('5.22 方位名稱門檻：Q9-01 的 30"×22" 斜切算「斜角」而不是「上方」',
    q9.planesX.filter(p => p.label === '上方').length === 1 &&
    q9.planesX.some(p => p.label === '前上斜角') && q9.planesX.some(p => p.label === '後上斜角'),
    q9.planesX.map(p => p.label).join('/'));

  // ===== 5C. A1 / A3 / XJ / ZJ / ZQ / ZR / Z2–Z5（2026-11 新增，依 HACTL 圖標註）=====
  const topWidthOf = spec => {
    const plane = spec.planesZ.find(p => p.label === '上方');
    return plane ? Math.hypot(plane.u2 - plane.u1, plane.v2 - plane.v1) : 0;
  };
  const newCodes = ['A1', 'A3', 'XJ', 'ZJ', 'ZQ', 'ZR', 'Z2', 'Z3', 'Z4', 'Z5'];
  check('5.23 10 個新板型都在規格庫（共 26 個）',
    newCodes.every(code => specs.LOADSIM_ULD_SPECS.some(spec => spec.code === code)) &&
    specs.LOADSIM_ULD_SPECS.length === 26,
    `${specs.LOADSIM_ULD_SPECS.length} 個`);

  // 圖檔必須存在（板型圖按鈕與 Contour 頁共用 /api/contour-image）
  const fs = require('fs');
  const imageDir = path.join(__dirname, '..', 'public', 'image', 'HACTL_contour_spec');
  const missingImages = newCodes
    .map(code => specs.loadsimBaseSpec(code))
    .filter(spec => !fs.existsSync(path.join(imageDir, spec.image)));
  check('5.24 新板型的 HACTL 圖檔都存在', missingImages.length === 0,
    missingImages.map(spec => `${spec.code}:${spec.image}`).join(', '));

  // --- A1：階梯型（凹多邊形），半平面交集會誤判凹角 → 需用真正的點在多邊形內
  const a1 = specNoRing('A1', null);
  check('5.25 A1 尺寸（125×96×94.5 吋）',
    near(a1.baseL, inch(125)) && near(a1.baseW, inch(96)) && near(a1.heightCm, inch(94.5)),
    `${a1.baseL.toFixed(2)}×${a1.baseW.toFixed(2)}×${a1.heightCm.toFixed(2)}`);
  check('5.26 A1 長×高剖面為 6 條邊的階梯（凹多邊形）',
    a1.planesX.length === 6 && geometry.loadsimPolyIsConvex(a1.profileX) === false,
    `${a1.planesX.map(p => p.label).join('/')}`);
  const a1Low = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 300, w: 200, h: 60 }, x: 5, y: 0, z: -100 }), a1, [], {});
  check('5.27 A1 低層（< 63"）整片板面都能放（凹角上方不會被誤判出界）',
    a1Low.ok && !a1Low.overflows.length, overflowLabels(a1Low));
  const a1TallFront = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 200, w: 100, h: inch(94.5) - 2 }, x: 0, y: 0, z: -50 }), a1, [], {});
  check('5.28 A1 前端（x < 105"）可以放到 94.5"', a1TallFront.ok, overflowLabels(a1TallFront));
  const a1StepOver = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 60, w: 100, h: inch(90) }, x: inch(105) - 20, y: 0, z: -50 }), a1, [], {});
  check('5.29 A1 跨過階梯又超過 63" → 判為超出（上方）',
    !a1StepOver.fits && a1StepOver.overflows.some(o => o.label === '上方'),
    overflowLabels(a1StepOver));

  // --- A3 / XJ：收角在長×高剖面（前後兩端）
  const a3 = specNoRing('A3', null);
  check('5.30 A3 總高 81"、頂長 67"（29"+67"+29" = 125"）',
    near(a3.heightCm, inch(81)) && near(topLengthOf(a3), inch(67)) &&
    a3.planesX.some(p => p.label === '前上斜角') && a3.planesX.some(p => p.label === '後上斜角'),
    `頂長 ${topLengthOf(a3).toFixed(2)}cm｜${a3.planesX.map(p => p.label).join('/')}`);
  const xj = specNoRing('XJ', null);
  check('5.31 XJ 總高 96"、頂長 85"（20"+85"+20" = 125"）',
    near(xj.heightCm, inch(96)) && near(topLengthOf(xj), inch(85)) && xj.planesX.length === 6,
    `頂長 ${topLengthOf(xj).toFixed(2)}cm`);
  check('5.32 XJ 壁高 84"：整片板面可放到 84"，再高就要落在 85" 頂面內',
    loadsimEvaluatePlacement(
      makeItem({ dims: { l: 200, w: 100, h: inch(84) - 1 }, x: 0, y: 0, z: -50 }), xj, [], {}).ok &&
    !loadsimEvaluatePlacement(
      makeItem({ dims: { l: 200, w: 100, h: inch(84) + 5 }, x: 0, y: 0, z: -50 }), xj, [], {}).fits);

  // --- ZJ：左右兩側都收角（14"×14"）→ 頂寬 68"
  const zj = specNoRing('ZJ', null);
  check('5.33 ZJ 總高 86"、兩側收角、頂寬 68"',
    near(zj.heightCm, inch(86)) && near(topWidthOf(zj), inch(68)) && zj.planesZ.length === 6,
    `頂寬 ${topWidthOf(zj).toFixed(2)}cm｜${zj.planesZ.map(p => p.label).join('/')}`);
  const zjLow = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 100, w: 200, h: inch(72) - 1 }, x: 10, y: 0, z: -100 }), zj, [], {});
  const zjEdgeHigh = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 100, w: 60, h: inch(84) }, x: 10, y: 0, z: inch(48) - 60 }), zj, [], {});
  check('5.34 ZJ 壁高 72"：低於 72" 全寬可放，靠邊又超高就撞斜角',
    zjLow.ok && !zjEdgeHigh.fits,
    `${overflowLabels(zjLow)}｜${overflowLabels(zjEdgeHigh)}`);

  // --- ZQ / ZR / Z2–Z5：一側收角（頂寬 + 收角 = 96"、側壁 + 收角 = 總高）
  const sideChamferCases = [
    ['ZQ', 118, 48], ['ZR', 116, 41], ['Z2', 116, 48],
    ['Z3', 96, 80], ['Z4', 114, 41], ['Z5', 96, 66]
  ];
  sideChamferCases.forEach(([code, heightIn, topIn], idx) => {
    const spec = specNoRing(code, null);
    check(`5.35.${idx + 1} ${code} 總高 ${heightIn}"、頂寬 ${topIn}"、單側收角（5 條邊）`,
      near(spec.heightCm, inch(heightIn)) && near(topWidthOf(spec), inch(topIn)) && spec.planesZ.length === 5,
      `${spec.heightCm.toFixed(2)}×頂寬${topWidthOf(spec).toFixed(2)}｜${spec.planesZ.map(p => p.label).join('/')}`);
  });
  const z3 = specNoRing('Z3', null);
  const z3High = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 100, w: 60, h: inch(92) }, x: 10, y: 0, z: inch(48) - 60 }), z3, [], {});
  check('5.36 Z3 側壁 76"：靠收角側放太高會撞收角',
    !z3High.fits && z3High.overflows.some(o => o.label.includes('右')),
    overflowLabels(z3High));

  // ===== 6. H2-00 底部兩端「向外」斜擴（profileX）=====
  const h2 = specNoRing('H2-00', null);
  // 貼地 125"×96"，兩端各向外 12" → 輪廓 149"，板面從 12" 開始
  check('6.0a H2-00 輪廓長 = 149"（125+12×2）', near(h2.baseL, 378.46), `${h2.baseL.toFixed(2)}cm`);
  check('6.0b H2-00 板面長 = 125"（貼地）', near(h2.floorL, 317.5) && near(h2.floorX0, 30.48),
    `${h2.floorL.toFixed(2)}cm @ ${h2.floorX0.toFixed(2)}`);
  check('6.0c H2-00 寬度仍為 96" 且不外擴', near(h2.floorW, 243.84) && near(h2.baseW, 243.84));
  const h2Front = loadsimEvaluatePlacement(makeItem({ dims: { l: 40, w: 40, h: 50 }, x: 0, y: 0, z: -20 }), h2, [], {});
  check('6.1 H2-00 貼地時不能站在外擴區（x=0、y=0 不合法）', !h2Front.fits);
  check('6.2 H2-00 超出方位含「斜角」', h2Front.overflows.some(o => o.label.includes('斜角')),
    h2Front.overflows.map(o => o.label).join('/'));
  const h2Mid = loadsimEvaluatePlacement(makeItem({ dims: { l: 40, w: 40, h: 50 }, x: 40, y: 0, z: -20 }), h2, [], {});
  check('6.3 H2-00 板面內位置合法', h2Mid.ok);
  // 疊高到 12" 以上（外擴區的高度）就能使用外擴空間
  const h2High = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 40, w: 40, h: 50 }, x: 0, y: 40, z: -20 }), h2, [], { requireSupport: false });
  check('6.4 H2-00 疊高（y=40）後可伸進外擴區', h2High.ok);

  // ===== 7. 多邊形工具 =====
  const clockwise = [[-50, 0], [-50, 60], [50, 60], [50, 0]];
  const ccw = loadsimEnsureCcw(clockwise);
  check('7.1 順時針輸入會被轉成逆時針', geometry.loadsimPolyArea(ccw) > 0);
  const planesCw = loadsimBuildPlanes(clockwise, 'z');
  const rectCw = loadsimTestRectInPolygon(-40, 10, 40, 50, planesCw);
  const rectCcw = loadsimTestRectInPolygon(-40, 10, 40, 50, loadsimBuildPlanes(ccw, 'z'));
  check('7.2 兩種旋向判定結果一致', rectCw.fit === rectCcw.fit && rectCw.fit === true);
  const rectOut = loadsimTestRectInPolygon(-40, 10, 60, 50, planesCw);
  check('7.3 越界會被偵測且量值正確', !rectOut.fit && near(rectOut.worst, 10, 0.01),
    `worst=${rectOut.worst.toFixed(2)}`);

  // 7.4~7.6 超出區域裁切（3D 紅色體積用）
  const topPlane = loadsimBuildPlanes([[-50, 0], [50, 0], [50, 60], [-50, 60]], 'z')
    .find(plane => plane.label === '上方');
  const clipped = geometry.loadsimClipRectOutside([[-40, 40], [40, 40], [40, 80], [-40, 80]], topPlane);
  const maxY = clipped.length ? Math.max(...clipped.map(p => p[1])) : 0;
  const minY = clipped.length ? Math.min(...clipped.map(p => p[1])) : 0;
  check('7.4 超出上方時裁切區域從邊界到貨物頂端', clipped.length >= 3 && near(minY, 60, 0.01) && near(maxY, 80, 0.01),
    `y ${minY.toFixed(1)}~${maxY.toFixed(1)}`);
  const insideClip = geometry.loadsimClipRectOutside([[-40, 10], [40, 10], [40, 50], [-40, 50]], topPlane);
  check('7.5 完全在輪廓內 → 裁切結果為空', insideClip.length === 0);
  const rightPlane = loadsimBuildPlanes([[-50, 0], [50, 0], [50, 60], [-50, 60]], 'z')
    .find(plane => plane.label === '右側');
  const rightClip = geometry.loadsimClipRectOutside([[30, 10], [70, 10], [70, 50], [30, 50]], rightPlane);
  const maxU = rightClip.length ? Math.max(...rightClip.map(p => p[0])) : 0;
  check('7.6 超出右側時裁切區域從 50 到 70', rightClip.length >= 3 && near(maxU, 70, 0.01),
    `maxU=${maxU.toFixed(1)}`);


  // ===== 8. 重量 / 利用率 =====
  const pmc = specNoRing('Q7-00', null);
  const weightState = {
    itemMaxKg: 1000,
    items: [
      makeItem({ id: 1, weight: 1500, placed: true }),
      makeItem({ id: 2, weight: 500, placed: true }),
      makeItem({ id: 3, weight: 200, placed: false })
    ]
  };
  const summary = weight.loadsimSummarize(weightState, pmc);
  check('8.1 貨重只算已裝（2000kg）', near(summary.cargoKg, 2000));
  check('8.2 總重 = 貨重 + 板重（2120kg）', near(summary.totalKg, 2120));
  check('8.3 未裝件數 = 1', summary.pendingCount === 1);
  check('8.4 重量狀態 = ok', weight.loadsimWeightLevel(summary) === 'ok');
  check('8.5 單件超限被標記', summary.heavy.length === 1 && summary.heavy[0].id === 1);
  check('8.6 容積利用率 > 0 且 < 100', summary.utilPct > 0 && summary.utilPct < 100);

  const overState = { itemMaxKg: 1000, items: [makeItem({ weight: 7000, placed: true })] };
  const overSummary = weight.loadsimSummarize(overState, pmc);
  check('8.7 超重計算（7000+120-6804=316）', near(overSummary.overKg, 316, 0.01));
  check('8.8 重量狀態 = over', weight.loadsimWeightLevel(overSummary) === 'over');

  const unknownSummary = weight.loadsimSummarize({ itemMaxKg: 0, items: [] }, specNoRing('A2-00', null));
  check('8.9 未設定最大總重 → unknown', weight.loadsimWeightLevel(unknownSummary) === 'unknown');

  // ===== 9. 自動放置（連續放入不重疊）=====
  const shelfSpec = specNoRing('Q7-00', null);
  const autoItems = [];
  let autoOk = true;
  let autoDetail = '';
  for (let i = 0; i < 6; i++) {
    const item = makeItem({ id: 100 + i, dims: { l: 120, w: 100, h: 80 }, placed: false });
    const found = autoplace.loadsimFindAutoPlacement(item, shelfSpec, autoItems, {});
    if (!found) {
      autoOk = false;
      autoDetail = `第 ${i + 1} 件找不到位置`;
      break;
    }
    autoItems.push({ ...item, placed: true, x: found.x, y: found.y, z: found.z });
  }
  check('9.1 6 件 120×100×80 都能自動放置', autoOk, autoDetail);
  let overlapFound = false;
  for (let i = 0; i < autoItems.length; i++) {
    for (let j = i + 1; j < autoItems.length; j++) {
      if (loadsimRectsOverlap(loadsimExtents(autoItems[i]), loadsimExtents(autoItems[j]))) overlapFound = true;
    }
  }
  check('9.2 自動放置後彼此不重疊', !overlapFound);
  check('9.3 自動放置位置都在板內', autoItems.every(item => {
    const e = loadsimExtents(item);
    return e.x0 >= -0.01 && e.x1 <= shelfSpec.baseL + 0.01 &&
      e.z0 >= -shelfSpec.baseW / 2 - 0.01 && e.z1 <= shelfSpec.baseW / 2 + 0.01;
  }));
  check('9.4 第 2 件起會往上堆（y > 0）', autoItems.slice(1).some(item => item.y > 0),
    autoItems.map(item => item.y).join(','));

  // 9.5 外擴型板型（W2-00）：自動放置只會在板面（貼地 125"）內，不會擺到外擴區
  const w2Spec = specNoRing('W2-00', null);
  const autoW2 = autoplace.loadsimFindAutoPlacement(
    makeItem({ id: 200, dims: { l: 120, w: 100, h: 60 }, placed: false }), w2Spec, [], {});
  check('9.5 外擴板型（W2-00）自動放置落在板面內',
    !!autoW2 && autoW2.x >= w2Spec.floorX0 - 0.01 && autoW2.x + 120 <= w2Spec.floorX1 + 0.01,
    autoW2 ? `x=${autoW2.x.toFixed(1)}（板面 ${w2Spec.floorX0.toFixed(1)}~${w2Spec.floorX1.toFixed(1)}）` : '找不到位置');

  // ===== 10. 規格覆寫（改尺寸 → 幾何改矩形）=====
  const overridden = specNoRing('Q7-00', { 'Q7-00': { baseW: 200, heightCm: 250 } });
  check('10.1 覆寫寬度生效', near(overridden.baseW, 200));
  check('10.2 覆寫高度生效', near(overridden.heightCm, 250));
  check('10.3 改尺寸後輪廓變矩形（4 條邊）', overridden.planesZ.length === 4, `${overridden.planesZ.length} 條`);
  const keepSlope = specNoRing('Q7-00', { 'Q7-00': { maxGrossKg: 5000 } });
  check('10.4 只改重量 → 保留原收角輪廓', keepSlope.planesZ.length === 5);

  // ===== 21. 暫存區（拖出 Contour 暫放）=====
  const stageSpec = specNoRing('Q7-00', null);
  const stage = geometry.loadsimStageRect(stageSpec);
  check('21.1 暫存區在板後方（x0 = 板長 + 30cm、深度 130cm）',
    near(stage.x0, stageSpec.baseL + 30, 0.01) && near(stage.x1 - stage.x0, 130, 0.01),
    `${stage.x0.toFixed(1)}~${stage.x1.toFixed(1)}`);
  check('21.2 暫存區寬度同板寬',
    near(stage.z0, -stageSpec.baseW / 2) && near(stage.z1, stageSpec.baseW / 2));
  const stageCenterItem = makeItem({ dims: { l: 60, w: 60, h: 60 }, x: (stage.x0 + stage.x1) / 2 - 30, y: 0, z: -30 });
  check('21.3 中心落在暫存區 → loadsimInStage = true',
    geometry.loadsimInStage(loadsimExtents(stageCenterItem), stage));
  check('21.4 板上的貨物 → loadsimInStage = false',
    !geometry.loadsimInStage(loadsimExtents(makeItem({ x: 100, y: 0, z: -40 })), stage));
  const clamped = geometry.loadsimClampToStage(
    makeItem({ dims: { l: 60, w: 60, h: 60 }, x: stage.x1 + 500, y: 40, z: -500 }), stage);
  check('21.5 暫存位置會被夾回暫存區內（且貼地 y = 0）',
    clamped.x <= stage.x1 - 60 + 0.01 && clamped.z >= stage.z0 - 0.01 && clamped.y === 0,
    `x=${clamped.x.toFixed(1)} z=${clamped.z.toFixed(1)} y=${clamped.y}`);

  // 第二個暫存區（② 板前方 +Z）：板前另有一塊空地可以暫放
  const stage2 = geometry.loadsimStageRect2(stageSpec);
  check('21.6 第二暫存區在板前方（z0 = 板寬/2 + 30cm、深度 110cm）',
    near(stage2.z0, stageSpec.baseW / 2 + 30, 0.01) && near(stage2.z1 - stage2.z0, 110, 0.01),
    `z=${stage2.z0.toFixed(1)}~${stage2.z1.toFixed(1)}`);
  check('21.7 第二暫存區長度同板長、貼地（y = 0）',
    near(stage2.x0, 0, 0.01) && near(stage2.x1, stageSpec.baseL, 0.01) && stage2.y === 0,
    `x=${stage2.x0.toFixed(1)}~${stage2.x1.toFixed(1)}`);
  const stageRects = geometry.loadsimStageRects(stageSpec);
  check('21.8 loadsimStageRects 回傳「板後方＋板前方＋角落」三個暫存區',
    stageRects.length === 3 && stageRects[0].id === 'back' &&
    stageRects[1].id === 'front' && stageRects[2].id === 'corner',
    stageRects.map(r => r.id).join('/'));
  // 第三個暫存區（③）＝①（板後 +X）與 ②（板前 +Z）延伸出去的重疊角落
  const stage3 = geometry.loadsimStageRect3(stageSpec);
  check('21.8b 第三暫存區＝暫存區① × ② 的延伸重疊角落（x 同 ①、z 同 ②）',
    near(stage3.x0, stage.x0, 0.01) && near(stage3.x1, stage.x1, 0.01) &&
    near(stage3.z0, stage2.z0, 0.01) && near(stage3.z1, stage2.z1, 0.01),
    `x=${stage3.x0.toFixed(1)}~${stage3.x1.toFixed(1)} z=${stage3.z0.toFixed(1)}~${stage3.z1.toFixed(1)}`);
  const cornerItem = makeItem({
    dims: { l: 60, w: 60, h: 60 },
    x: (stage3.x0 + stage3.x1) / 2 - 30, y: 0, z: (stage3.z0 + stage3.z1) / 2 - 30
  });
  const cornerAt = geometry.loadsimStageAt(loadsimExtents(cornerItem), stageSpec);
  check('21.8c 角落的貨物 → loadsimStageAt 回傳第三區', !!cornerAt && cornerAt.id === 'corner',
    cornerAt ? cornerAt.id : 'null');
  const frontItem = makeItem({ dims: { l: 60, w: 60, h: 60 }, x: 60, y: 0, z: stage2.z0 + 10 });
  const frontAt = geometry.loadsimStageAt(loadsimExtents(frontItem), stageSpec);
  check('21.9 中心落在前方暫存區 → loadsimStageAt 回傳第二區',
    !!frontAt && frontAt.id === 'front', frontAt ? frontAt.id : 'null');
  check('21.10 板上的貨物不會被誤判成暫存（z = 板寬/2 − 30）',
    geometry.loadsimStageAt(loadsimExtents(makeItem({ x: 100, y: 0, z: stageSpec.baseW / 2 - 30 })), stageSpec) === null);
  const frontClamped = geometry.loadsimClampToStage(
    makeItem({ dims: { l: 60, w: 60, h: 60 }, x: -500, y: 40, z: stage2.z1 + 500 }), stage2);
  check('21.11 前方暫存位置會被夾回第二區內（且貼地 y = 0）',
    frontClamped.x >= stage2.x0 - 0.01 && frontClamped.z <= stage2.z1 - 60 + 0.01 && frontClamped.y === 0,
    `x=${frontClamped.x.toFixed(1)} z=${frontClamped.z.toFixed(1)} y=${frontClamped.y}`);
  const stageMax = geometry.loadsimStageMaxExtent(stageSpec, { x: 60, z: 60 });
  check('21.12 可拖曳範圍放寬到兩個暫存區末端（X = 板後 ① 末端、Z = 板前 ② 末端）',
    near(stageMax.x, stage.x1 - 60, 0.01) && near(stageMax.z, stage2.z1 - 60, 0.01),
    `x=${stageMax.x.toFixed(1)} z=${stageMax.z.toFixed(1)}`);

  // ===== 22. 上貨支撐面積比例（預設需 ≥ 50%）=====
  const mk = (x, z, y, l = 100, w = 100) => makeItem({ id: 900 + x + z + y, dims: { l, w, h: 50 }, x, y, z });
  const bottom = mk(0, 0, 0);
  check('22.1 完全對齊 → 支撐比例 100%',
    near(geometry.loadsimSupportRatio(loadsimExtents(mk(0, 0, 50)), [bottom]), 1, 0.001));
  check('22.2 錯開 50%（一半面積）→ 支撐比例 50%',
    near(geometry.loadsimSupportRatio(loadsimExtents(mk(50, 0, 50)), [bottom]), 0.5, 0.001));
  check('22.3 錯開 70%（只壓 30%）→ 支撐比例 30%',
    near(geometry.loadsimSupportRatio(loadsimExtents(mk(70, 0, 50)), [bottom]), 0.3, 0.001));
  check('22.4 預設 50%：一半面積可放、30% 不可放',
    geometry.loadsimIsSupported(loadsimExtents(mk(50, 0, 50)), [bottom], 0.5) &&
    !geometry.loadsimIsSupported(loadsimExtents(mk(70, 0, 50)), [bottom], 0.5));
  check('22.5 比例放寬到 20% → 30% 也可放',
    geometry.loadsimIsSupported(loadsimExtents(mk(70, 0, 50)), [bottom], 0.2));
  // 兩個相鄰的支撐物（各 25%）→ 聯集 50%，不能重複計算
  const left = makeItem({ id: 910, dims: { l: 50, w: 100, h: 40 }, x: 0, y: 0, z: 0 });
  const right = makeItem({ id: 911, dims: { l: 50, w: 100, h: 40 }, x: 50, y: 0, z: 0 });
  check('22.6 兩塊各半的支撐物 → 聯集 100%',
    near(geometry.loadsimSupportRatio(loadsimExtents(mk(0, 0, 40)), [left, right]), 1, 0.001));
  const overReport = loadsimEvaluatePlacement(
    mk(70, 0, 50), specNoRing('Q7-00', null), [bottom], { supportMinPct: 50 });
  check('22.7 支撐不足時的訊息含面積比例',
    !overReport.ok && !overReport.supported &&
    geometry.loadsimPlacementReason(overReport).includes('支撐面積'),
    geometry.loadsimPlacementReason(overReport));
  check('22.8 supportMinPct = 0 → 只要有接觸就能疊',
    loadsimEvaluatePlacement(
      mk(70, 0, 50), specNoRing('Q7-00', null), [bottom], { supportMinPct: 0 }).ok);

  // ===== 23. 自動疊高（loadsimSupportHeight）也要遵守支撐比例 =====
  check('23.1 完全對齊 → 自動疊在下方貨物頂面（50cm）',
    near(geometry.loadsimSupportHeight(loadsimExtents(mk(0, 0, 90)), [bottom], 0.5), 50, 0.01));
  check('23.2 只壓 30% → 預設 50% 不疊上去（落地面）',
    near(geometry.loadsimSupportHeight(loadsimExtents(mk(70, 0, 90)), [bottom], 0.5), 0, 0.01));
  check('23.3 比例放寬到 20% → 會疊上去',
    near(geometry.loadsimSupportHeight(loadsimExtents(mk(70, 0, 90)), [bottom], 0.2), 50, 0.01));

  // ===== 30. 板底 ring track（厚板 / 薄板）=====
  const thinSpec = specs.loadsimGetSpec('Q7-00', null, { plateType: 'thin' });
  const thickSpec = specs.loadsimGetSpec('Q7-00', null, { plateType: 'thick' });
  const defaultSpec = specs.loadsimGetSpec('Q7-00', null);
  check('30.1 預設板底＝薄板（ring 內側 120" × 90"）',
    defaultSpec.plateType === 'thin' && near(thinSpec.ringRect.widthCm, inch(120), 0.02) &&
    near(thinSpec.ringRect.depthCm, inch(90), 0.02),
    `${thinSpec.plateType} ${thinSpec.ringRect.widthCm.toFixed(1)}×${thinSpec.ringRect.depthCm.toFixed(1)}`);
  check('30.2 厚板 ring 內側 118" × 88"',
    near(thickSpec.ringRect.widthCm, inch(118), 0.02) && near(thickSpec.ringRect.depthCm, inch(88), 0.02),
    `${thickSpec.ringRect.widthCm.toFixed(1)}×${thickSpec.ringRect.depthCm.toFixed(1)}`);
  check('30.3 ring 內框置中於板面（四邊各內縮 2.5"／3"）',
    near(thinSpec.ringRect.insetX, inch(2.5), 0.01) && near(thinSpec.ringRect.insetZ, inch(3), 0.01) &&
    near((thinSpec.ringRect.x0 + thinSpec.ringRect.x1) / 2, thinSpec.floorX1 / 2, 0.02) &&
    near((thinSpec.ringRect.z0 + thinSpec.ringRect.z1) / 2, 0, 0.02));

  const onRingItem = makeItem({ dims: { l: 60, w: 60, h: 50 }, x: -50, y: 0, z: thinSpec.floorZ0 + 5 });
  const onRingReport = loadsimEvaluatePlacement(onRingItem, thinSpec, [], { allowOverhang: true });
  check('30.4 最底層壓在 ring track 上 → 允許但標記 onRing（與超出輪廓同一套）',
    onRingReport.ok && onRingReport.onRing && onRingReport.ringOverlap > 0 && !onRingReport.ringBlocked,
    `ok=${onRingReport.ok} onRing=${onRingReport.onRing} overlap=${(onRingReport.ringOverlap || 0).toFixed(1)}`);
  const onRingStrict = loadsimEvaluatePlacement(onRingItem, thinSpec, [], { allowOverhang: false });
  check('30.4b 嚴格模式（超出輪廓就不能放）→ ring track 也一起擋下',
    !onRingStrict.ok && onRingStrict.ringBlocked,
    `ok=${onRingStrict.ok} ringBlocked=${onRingStrict.ringBlocked}`);
  check('30.4c 被擋下時的訊息會說明第一層可用範圍',
    geometry.loadsimPlacementReason(onRingStrict).includes('ring track') &&
    geometry.loadsimPlacementReason(onRingStrict).includes('第一層'),
    geometry.loadsimPlacementReason(onRingStrict));
  check('30.4d 壓到 ring 的區塊會回傳可畫斜線的矩形（loadsimRingHitRects）',
    geometry.loadsimRingHitRects(loadsimExtents(onRingItem), thinSpec).length > 0,
    `${geometry.loadsimRingHitRects(loadsimExtents(onRingItem), thinSpec).length} 塊`);
  const upperAtSameSpot = loadsimEvaluatePlacement(
    { ...onRingItem, y: 100 }, thinSpec, [], { allowOverhang: true, requireSupport: false });
  check('30.5 同一位置的「第二層」不受 ring track 限制',
    !upperAtSameSpot.onRing && upperAtSameSpot.ok);
  const insideFloor = loadsimEvaluatePlacement(
    makeItem({ dims: { l: 60, w: 60, h: 50 }, x: 50, y: 0, z: -30 }), thinSpec, [], { allowOverhang: true });
  check('30.6 ring 內框裡的最底層 → 可放', insideFloor.ok && !insideFloor.onRing);
  check('30.6b 厚板的內框更小（同位置貼近板面邊緣時，薄板可放、厚板不可放）',
    (() => {
      const edgeItem = makeItem({
        dims: { l: 100, w: 100, h: 50 },
        x: 50, y: 0, z: 13
      });
      const thinOk = !loadsimEvaluatePlacement(edgeItem, thinSpec, [], { allowOverhang: true }).onRing;
      const thickOk = !loadsimEvaluatePlacement(edgeItem, thickSpec, [], { allowOverhang: true }).onRing;
      return thinOk && !thickOk;
    })());
  // ===== 31. 拖曳範圍以「輪廓」為基準 → 第二層推得到 OVERHANG =====
  const h3Spec = specNoRing('H3-00', null);
  const h3Item = makeItem({ dims: { l: 100, w: 100, h: 40 }, x: 0, y: 20, z: 0 });
  h3Item.x = 1e6;
  geometry.loadsimClampToMoveArea(h3Item, h3Spec);
  check('31.1 外擴型（H3-00）往板後可推到「輪廓末端」（不是板面 + 40cm）',
    near(h3Item.x, h3Spec.baseL - 100 + geometry.LOADSIM_MOVE_MARGIN_CM, 0.01) &&
    h3Item.x > h3Spec.floorX1 - 100 + geometry.LOADSIM_MOVE_MARGIN_CM + 1,
    `x=${h3Item.x.toFixed(1)}｜板面 ${h3Spec.floorX1.toFixed(1)}、輪廓 ${h3Spec.baseL.toFixed(1)}`);
  const h3Push = loadsimEvaluatePlacement(
    { ...h3Item, x: h3Spec.baseL - 100, y: h3Spec.heightCm - 40 }, h3Spec, [], { allowOverhang: true });
  check('31.2 推到輪廓末端時剛好貼齊輪廓（不再被判出界）', h3Push.overflows.length === 0,
    overflowLabels(h3Push));
  const q7Item = makeItem({ dims: { l: 100, w: 100, h: 40 }, x: 0, y: 20, z: 0 });
  q7Item.x = 1e6;
  geometry.loadsimClampToMoveArea(q7Item, q7);
  check('31.3 一般板型（輪廓＝板面）可移動範圍不變（板面 + 40cm）',
    near(q7Item.x, q7.floorX1 - 100 + geometry.LOADSIM_MOVE_MARGIN_CM, 0.01), `x=${q7Item.x.toFixed(1)}`);

  // ===== 32. 自動放置：最底層不會壓在 ring track 上 =====
  const autoSpec = specs.loadsimGetSpec('Q7-00', null, { plateType: 'thick' });
  const autoItem = makeItem({ id: 999, dims: { l: 60, w: 60, h: 50 }, x: 0, y: 0, z: 0, placed: false });
  const auto = autoplace.loadsimFindAutoPlacement(autoItem, autoSpec, [], { allowOverhang: true });
  check('32.1 自動放置的最底層落在 ring 內框裡',
    !!auto && auto.x >= autoSpec.ringRect.x0 - 0.01 &&
    auto.x + 60 <= autoSpec.ringRect.x1 + 0.01 &&
    auto.z >= autoSpec.ringRect.z0 - 0.01 && auto.z + 60 <= autoSpec.ringRect.z1 + 0.01,
    auto ? `x=${auto.x} z=${auto.z}` : '找不到位置');

  console.log(`\n===== 完成：PASS ${passCount} / FAIL ${failCount} =====`);
  if (failCount > 0) process.exitCode = 1;
})().catch(err => {
  console.error('測試執行失敗：', err);
  process.exitCode = 1;
});

