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
  const q7 = specs.loadsimGetSpec('Q7-00', null);
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

  // ===== 6. H2-00 底部兩端「向外」斜擴（profileX）=====
  const h2 = specs.loadsimGetSpec('H2-00', null);
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
  const pmc = specs.loadsimGetSpec('Q7-00', null);
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

  const unknownSummary = weight.loadsimSummarize({ itemMaxKg: 0, items: [] }, specs.loadsimGetSpec('A2-00', null));
  check('8.9 未設定最大總重 → unknown', weight.loadsimWeightLevel(unknownSummary) === 'unknown');

  // ===== 9. 自動放置（連續放入不重疊）=====
  const shelfSpec = specs.loadsimGetSpec('Q7-00', null);
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
  const w2Spec = specs.loadsimGetSpec('W2-00', null);
  const autoW2 = autoplace.loadsimFindAutoPlacement(
    makeItem({ id: 200, dims: { l: 120, w: 100, h: 60 }, placed: false }), w2Spec, [], {});
  check('9.5 外擴板型（W2-00）自動放置落在板面內',
    !!autoW2 && autoW2.x >= w2Spec.floorX0 - 0.01 && autoW2.x + 120 <= w2Spec.floorX1 + 0.01,
    autoW2 ? `x=${autoW2.x.toFixed(1)}（板面 ${w2Spec.floorX0.toFixed(1)}~${w2Spec.floorX1.toFixed(1)}）` : '找不到位置');

  // ===== 10. 規格覆寫（改尺寸 → 幾何改矩形）=====
  const overridden = specs.loadsimGetSpec('Q7-00', { 'Q7-00': { baseW: 200, heightCm: 250 } });
  check('10.1 覆寫寬度生效', near(overridden.baseW, 200));
  check('10.2 覆寫高度生效', near(overridden.heightCm, 250));
  check('10.3 改尺寸後輪廓變矩形（4 條邊）', overridden.planesZ.length === 4, `${overridden.planesZ.length} 條`);
  const keepSlope = specs.loadsimGetSpec('Q7-00', { 'Q7-00': { maxGrossKg: 5000 } });
  check('10.4 只改重量 → 保留原收角輪廓', keepSlope.planesZ.length === 5);

  // ===== 21. 暫存區（拖出 Contour 暫放）=====
  const stageSpec = specs.loadsimGetSpec('Q7-00', null);
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
    mk(70, 0, 50), specs.loadsimGetSpec('Q7-00', null), [bottom], { supportMinPct: 50 });
  check('22.7 支撐不足時的訊息含面積比例',
    !overReport.ok && !overReport.supported &&
    geometry.loadsimPlacementReason(overReport).includes('支撐面積'),
    geometry.loadsimPlacementReason(overReport));
  check('22.8 supportMinPct = 0 → 只要有接觸就能疊',
    loadsimEvaluatePlacement(
      mk(70, 0, 50), specs.loadsimGetSpec('Q7-00', null), [bottom], { supportMinPct: 0 }).ok);

  // ===== 23. 自動疊高（loadsimSupportHeight）也要遵守支撐比例 =====
  check('23.1 完全對齊 → 自動疊在下方貨物頂面（50cm）',
    near(geometry.loadsimSupportHeight(loadsimExtents(mk(0, 0, 90)), [bottom], 0.5), 50, 0.01));
  check('23.2 只壓 30% → 預設 50% 不疊上去（落地面）',
    near(geometry.loadsimSupportHeight(loadsimExtents(mk(70, 0, 90)), [bottom], 0.5), 0, 0.01));
  check('23.3 比例放寬到 20% → 會疊上去',
    near(geometry.loadsimSupportHeight(loadsimExtents(mk(70, 0, 90)), [bottom], 0.2), 50, 0.01));

  console.log(`\n===== 完成：PASS ${passCount} / FAIL ${failCount} =====`);
  if (failCount > 0) process.exitCode = 1;
})().catch(err => {
  console.error('測試執行失敗：', err);
  process.exitCode = 1;
});

