/**
 * scripts/test-bp3d.js
 * bp3d 核心引擎單元測試（無外部相依，直接 node 執行）。
 *
 * 測項：
 *   1. 半空間幾何：矩形 ULD 箱內/箱外判斷
 *   2. AABB 碰撞
 *   3. AKE 斜切：斜切面外側的貨物應被拒絕
 *   4. 方向限制：must_stay_upright 只允許長↔寬旋轉
 *   5. 支撐率：懸空貨物應被拒絕
 *   6. 完整求解流程：PMC + 展示貨物
 *   7. AKE 求解流程
 *
 * 用法：node scripts/test-bp3d.js
 */
const geo = require('../bp3d/geometries');
const { resolveUld } = require('../bp3d/uld-definitions');
const ep = require('../bp3d/extreme-points');
const constraints = require('../bp3d/constraints');
const { solve } = require('../bp3d/solver');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== 1. 半空間幾何：矩形 ULD ===');
test('rectangle box inside', () => {
  const planes = geo.createRectangularHalfspaces(2000, 1000, 1000);
  assert(geo.boxFits(planes, -500, -200, 0, 500, 400, 300), 'center box should fit');
  assert(!geo.boxFits(planes, 2000, 0, 0, 500, 400, 300), 'box exceeds x limit');
  assert(!geo.boxFits(planes, 0, 1000, 0, 500, 400, 300), 'box exceeds y limit');
  assert(!geo.boxFits(planes, 0, 0, 1200, 500, 400, 300), 'box exceeds h limit');
});

test('shrink halfspaces', () => {
  const planes = geo.createRectangularHalfspaces(2000, 1000, 1000);
  const shrunk = geo.shrinkHalfspaces(planes, 50);
  // 縮 50mm 後，x=951 y=451 z=0 的點原在邊界上（點 1000），應被拒絕
  assert(geo.pointInside(shrunk, 900, 0, 0), '900 < 950 should pass');
  assert(!geo.pointInside(shrunk, 960, 0, 0), '960 > 950 should fail');
  assert(!geo.pointInside(shrunk, 0, 460, 0), '460 > 450 should fail');
  assert(!geo.pointInside(shrunk, 0, 0, 960), '960 > 950 should fail');
});

console.log('\n=== 2. AABB 碰撞 ===');
test('aabb overlap detection', () => {
  const a = { x: 0, y: 0, z: 0, l: 100, w: 100, h: 100 };
  const b = { x: 100, y: 0, z: 0, l: 100, w: 100, h: 100 }; // 邊界接觸
  const c = { x: 50, y: 50, z: 50, l: 100, w: 100, h: 100 }; // 重疊
  assert(!geo.aabbOverlap(a, b), 'edge contact is not overlap');
  assert(geo.aabbOverlap(a, c), 'overlap should be detected');
});

console.log('\n=== 3. AKE 斜切幾何 ===');
test('AKE resolve + halfspace containment', () => {
  const { def, planes } = resolveUld({ type: 'AKE', net_clearance_mm: 0 });
  assert(def.code === 'AKE', 'ULD code resolved');
  assert(planes.length === 8, `AKE profile should have 8 planes, got ${planes.length}`); // 2 end + 6 profile sides

  // 底部區域：斜切從 1190mm 開始，中央底部 1562mm 寬全部可用
  // 角落（y=±781, z=0）應在內
  assert(geo.pointInside(planes, 0, -700, 0), 'bottom corner y=-700 should be inside');
  assert(geo.pointInside(planes, 0, 700, 0), 'bottom corner y=700 should be inside');

  // 靠近頂部：y=±1000 在頂部 2007mm 寬內
  assert(geo.pointInside(planes, 0, 950, 1500), 'top area y=950 z=1500 should be inside');

  // 斜切面外側：y=850, z=600 應超出（底部只有 781，斜切從 1190 開始向上展開）
  // 在 z=600 時斜切面 y 上限約 781 + (1003.5-781)*(600/1190) ≈ 781 + 112 ≈ 893
  // 所以 y=850 z=600 仍在內；要測試取 y=950 z=600 應在外
  assert(!geo.pointInside(planes, 0, 950, 600), 'y=950 z=600 should be outside the slanted wall');
  assert(geo.pointInside(planes, 0, 850, 600), 'y=850 z=600 should be inside the slanted wall');
});

test('AKE boxFits near slant', () => {
  const { def, planes } = resolveUld({ type: 'AKE', net_clearance_mm: 0 });

  // 一個貼在底部中央的精細盒子應能放入
  const fitBox = { x: -200, y: -100, z: 0, l: 400, w: 200, h: 300 };
  assert(geo.boxFits(planes, fitBox.x, fitBox.y, fitBox.z, fitBox.l, fitBox.w, fitBox.h), 'center box fits AKE');

  // 一個太寬的盒子：y=-200 起點、寬 1700mm → 延伸到 +1500，超出底部 ±781
  assert(!geo.boxFits(planes, -200, -200, 0, 400, 1700, 300), 'box 1700mm wide at bottom should exceed AKE');
  // 另一個：y=-500 起點、寬 1000mm → -500..+500，仍在 ±781 內（應通過）
  assert(geo.boxFits(planes, -200, -500, 0, 400, 1000, 300), 'box 1000mm wide centered at y=0 should fit');

  // 一個放在高位的寬盒子可能可以（頂部較寬）
  assert(geo.boxFits(planes, -200, -400, 1300, 400, 800, 200), 'wide box at high z may fit');
});

console.log('\n=== 4. 旋轉方向控制 ===');
test('must_stay_upright only rotates around Z', () => {
  const orient = ep.generateOrientations({
    l: 100, w: 60, h: 50,
    mustStayUpright: true,
    allowRotateX: false,
    allowRotateY: true,
    allowRotateZ: true,
  });
  const keys = orient.map((o) => o.join('x'));
  assert(keys.includes('100x60x50'), 'original orientation');
  assert(keys.includes('60x100x50'), 'L-W swap allowed');
  assert(keys.length === 2, `should have only 2 orientations, got ${orient.length}`);
});

test('allow_tilt=false blocks height changes', () => {
  const orient = ep.generateOrientations({
    l: 100, w: 60, h: 50,
    allowTilt: false,
    allowRotateX: false,
    allowRotateY: false,
  });
  const keys = orient.map((o) => o.join('x'));
  assert(keys.length === 1 && keys[0] === '100x60x50', 'no tilt means single orientation');
});

test('full rotation allowed gives 6 orientations (non-cube)', () => {
  const orient = ep.generateOrientations({
    l: 100, w: 60, h: 50,
    allowRotateX: true,
    allowRotateY: true,
    allowRotateZ: true,
  });
  assert(orient.length === 6, `all rotations should give 6, got ${orient.length}`);
});

test('cube dedupe gives 1 orientation', () => {
  const orient = ep.generateOrientations({ l: 50, w: 50, h: 50 });
  assert(orient.length === 1, 'cube should have 1 orientation');
});

console.log('\n=== 5. 支撐率檢查 ===');
test('support ratio floor = 1', () => {
  const support = constraints.checkSupportRatio(
    { id: 'A', x: 0, y: 0, z: 0, l: 100, w: 100, h: 50 },
    [],
    0.7
  );
  assert(support.ratio === 1 && support.supported, 'floor item fully supported');
});

test('suspended box rejected', () => {
  // 下方 40x40 的支撐物，上方 100x100 的貨物，支撐率只有 16%
  const placed = [{ id: 'B', x: 0, y: 0, z: 0, l: 40, w: 40, h: 50, isStackable: true }];
  const support = constraints.checkSupportRatio(
    { id: 'A', x: 0, y: 0, z: 50, l: 100, w: 100, h: 50 },
    placed,
    0.7
  );
  assert(support.ratio < 0.7 && !support.supported, `ratio ${support.ratio} should be < 0.7`);
});

test('non-stackable below blocks stacking', () => {
  const placed = [{ id: 'B', x: 0, y: 0, z: 0, l: 200, w: 200, h: 50, isStackable: false }];
  const support = constraints.checkSupportRatio(
    { id: 'A', x: 0, y: 0, z: 50, l: 100, w: 100, h: 50 },
    placed,
    0.7
  );
  assert(!support.supported, 'should reject stacking on non-stackable');
});

console.log('\n=== 6. 完整求解：PMC 托盤 ===');
test('solve PMC demo cargo', () => {
  const result = solve(
    { type: 'PMC', net_clearance_mm: 30 },
    [
      { id: 'PKG-A', length_mm: 600, width_mm: 400, height_mm: 400, weight_kg: 45, quantity: 12, is_stackable: true },
      { id: 'PKG-B', length_mm: 800, width_mm: 500, height_mm: 350, weight_kg: 80, quantity: 8, is_stackable: true },
      { id: 'PKG-C', length_mm: 1200, width_mm: 800, height_mm: 600, weight_kg: 250, quantity: 4, is_stackable: false },
      { id: 'PKG-D', length_mm: 400, width_mm: 300, height_mm: 200, weight_kg: 15, quantity: 20, is_stackable: true, allow_tilt: false },
      { id: 'PKG-E', length_mm: 1000, width_mm: 700, height_mm: 500, weight_kg: 180, quantity: 3, is_stackable: true, max_stack_weight: 400 },
    ]
  );
  assert(result.success === true, 'solve returns success');
  assert(result.summary.totalItems === 47, `total items should be 47, got ${result.summary.totalItems}`);
  assert(result.summary.placedCount > 20, `expected most items placed, got ${result.summary.placedCount}`);
  assert(result.sequence.length === result.summary.placedCount, 'sequence matches placed count');
  assert(Array.isArray(result.strategies) && result.strategies.length >= 4, '4 strategies evaluated');
  assert(result.summary.volumeUtilizationPct > 0, 'volume utilization > 0');
  console.log(`    → placed ${result.summary.placedCount}/${result.summary.totalItems}, util ${result.summary.volumeUtilizationPct}%, weight ${result.summary.totalWeightKg}kg, strategy ${result.strategy}`);
});

test('solve AKE container', () => {
  const result = solve(
    { type: 'AKE', net_clearance_mm: 20 },
    [
      { id: 'SML', length_mm: 400, width_mm: 300, height_mm: 250, weight_kg: 12, quantity: 20, is_stackable: true },
      { id: 'MED', length_mm: 600, width_mm: 400, height_mm: 350, weight_kg: 35, quantity: 10, is_stackable: true },
      { id: 'BIG', length_mm: 900, width_mm: 600, height_mm: 500, weight_kg: 90, quantity: 2, is_stackable: false },
    ]
  );
  assert(result.success === true, 'AKE solve succeeds');
  assert(result.uld.type === 'AKE', 'ULD type AKE');
  console.log(`    → AKE placed ${result.summary.placedCount}/${result.summary.totalItems}, util ${result.summary.volumeUtilizationPct}%, weight ${result.summary.totalWeightKg}kg`);
});

test('oversized single item reported as unplaced', () => {
  const result = solve(
    { type: 'AKE' },
    [
      { id: 'HUGE', length_mm: 5000, width_mm: 5000, height_mm: 3000, weight_kg: 1000, quantity: 1 },
    ]
  );
  assert(result.summary.placedCount === 0, 'oversized item cannot fit');
  assert(result.unplaced.length === 1, 'one unplaced reported');
  assert(result.unplaced[0].reason.includes('exceed'), `reason should mention exceed, got: ${result.unplaced[0].reason}`);
});

console.log('\n=== 6.5 Q7-00 Contoured ULD ===');
test('Q7-00 geometry match user spec', () => {
  const { def, planes } = resolveUld({ type: 'Q7-00', net_clearance_mm: 0 });
  assert(def.code === 'Q7-00', 'ULD code resolved');
  // 96" x 125" x 118" → 2438.4 x 3175 x 2997.2
  assert(Math.abs(def.baseL - 3175) < 0.1, `depth 3175mm, got ${def.baseL}`);
  assert(Math.abs(def.baseW - 2438.4) < 0.1, `width 2438.4mm, got ${def.baseW}`);
  assert(Math.abs(def.maxHeightMm - 2997.2) < 0.1, `height 2997.2mm, got ${def.maxHeightMm}`);

  // 底部全寬可用（左右 ±48" = ±1219.2mm）
  assert(geo.pointInside(planes, 0, -1200, 0), 'bottom left inside');
  assert(geo.pointInside(planes, 0, 1200, 0), 'bottom right inside');

  // 左側：垂直壁全高 118"（z=2900, y=-1200 應在內；左側沒有收角）
  assert(geo.pointInside(planes, 0, -1200, 2900), 'left wall full height inside');

  // 右側：z=96"(2438.4) 以下全寬可用
  assert(geo.pointInside(planes, 0, 1200, 2400), 'right wall below 96" inside');

  // 右側 45° 收角：收角線 (y=+48",z=96") → (y=+26",z=118")
  //   y+z = 144"（96+48 = 144；118+26 = 144）
  // 收角區（y>26" 且 z>96"）內必須 y+z <= 144"
  //   y=+30"(762mm), z=105"(2667mm)：30+105=135 < 144 → 在內
  assert(geo.pointInside(planes, 0, 762, 2667), 'chamfer inner (30,105) y+z=135 < 144');
  //   y=+40"(1016mm), z=110"(2794mm)：40+110=150 > 144 → 在外
  assert(!geo.pointInside(planes, 0, 1016, 2794), 'chamfer outer (40,110) y+z=150 > 144 rejected');
  //   y=+45"(1143mm), z=112"(2844.8mm)：45+112=157 > 144 → 在外
  assert(!geo.pointInside(planes, 0, 1143, 2844.8), 'chamfer outer (45,112) rejected');
  //   邊界附近 y=+30"(762), z=113"(2870)：30+113=143 < 144 → 在內
  assert(geo.pointInside(planes, 0, 762, 2870), 'chamfer near boundary (30,113) y+z=143 < 144');
});

test('Q7-00 box placement respects chamfer', () => {
  const { def, planes } = resolveUld({ type: 'Q7-00', net_clearance_mm: 0 });

  // 中央安全箱可放
  assert(geo.boxFits(planes, -1587.5, -600, 0, 800, 1200, 1000), 'center box fits');

  // 右上角高箱應被斜切拒絕：
  // 箱從 y=700(28") 到 1900mm(75")、z=2400 到 3000 → 超出垂直壁+收角
  assert(!geo.boxFits(planes, 0, 700, 2400, 500, 1200, 500), 'tall box in chamfer zone rejected');

  // 低矮箱在右側可放（z < 96"）且 y 在 ±48" 內
  // y=0 起點、寬 1000mm → 0..1000mm < 1219.2mm、h=2300mm < 2438.4mm
  assert(geo.boxFits(planes, 0, 0, 0, 500, 1000, 2300), 'low box right side fits below 96"');
  // 但寬度超過 ±48" 的箱會被拒絕
  assert(!geo.boxFits(planes, 0, 0, 0, 500, 2500, 500), 'box wider than 96" rejected');
});

test('Q7-00 solve demo cargo', () => {
  const result = solve(
    { type: 'Q7-00', net_clearance_mm: 20 },
    [
      { id: 'A', length_mm: 800, width_mm: 600, height_mm: 500, weight_kg: 80, quantity: 10, is_stackable: true },
      { id: 'B', length_mm: 1200, width_mm: 800, height_mm: 600, weight_kg: 200, quantity: 4, is_stackable: true },
      { id: 'C', length_mm: 2000, width_mm: 1000, height_mm: 800, weight_kg: 500, quantity: 2, is_stackable: false },
    ]
  );
  assert(result.success === true, 'Q7-00 solve succeeds');
  assert(result.uld.type === 'Q7-00', 'ULD type Q7-00');
  console.log(`    → Q7-00 placed ${result.summary.placedCount}/${result.summary.totalItems}, util ${result.summary.volumeUtilizationPct}%, weight ${result.summary.totalWeightKg}kg`);
});

console.log('\n=== 7. 重量限制 ===');
test('weight limit enforcement', () => {
  const result = solve(
    { type: 'AKE', max_weight_kg: 100 },
    [
      { id: 'H1', length_mm: 100, width_mm: 100, height_mm: 100, weight_kg: 80, quantity: 5 },
    ]
  );
  assert(result.summary.placedCount === 1, `only 1 item fits under 100kg limit, got ${result.summary.placedCount}`);
  assert(result.summary.totalWeightKg <= 100, `total weight ${result.summary.totalWeightKg} <= 100`);
});

// ===== 總結 =====
console.log(`\n==================================`);
console.log(`Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.err.message}`);
  }
  process.exit(1);
} else {
  console.log('All tests passed!');
}