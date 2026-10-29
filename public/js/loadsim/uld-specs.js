// ===== 模擬裝板：板型（Contour）規格庫 =====
// 資料來源：**只採用 HACTL 規格圖** public/image/HACTL_contour_spec/*.jpeg 上的英吋標註
//           （1 inch = 2.54 cm 精確換算）；收角以剖面多邊形描述。
//           CX_Contour 的圖**暫不採用**：同一板型的尺寸／收角與 HACTL 標註有出入，
//           尤其有 OVERHANG（上部收角）的輪廓，會讓人誤判可裝高度與頂寬。
// code 直接沿用 HACTL 的 contour code（Q7-00 / Q3-00 …），方便對照 HACTL 規格圖。
// 標註「預設值」的重量為業界常用值，可在畫面「板型設定」即時修改（存 localStorage）。
// 圖上未標明的長／寬一律以 HACTL 標準板（125" × 96"）補齊，並於 note 說明。
import {
  loadsimBuildPlanes,
  loadsimEnsureCcw,
  loadsimPolyArea,
  loadsimPolyBounds
} from './geometry.js';

const IN = 2.54;
const inch = value => Math.round(value * IN * 100) / 100;

// 寬 × 高 的矩形剖面（z, y）
function rectZ(widthCm, heightCm) {
  return [
    [-widthCm / 2, 0],
    [widthCm / 2, 0],
    [widthCm / 2, heightCm],
    [-widthCm / 2, heightCm]
  ];
}

// 長 × 高 的矩形剖面（x, y）
function rectX(lengthCm, heightCm) {
  return [
    [0, 0],
    [lengthCm, 0],
    [lengthCm, heightCm],
    [0, heightCm]
  ];
}

// 寬 × 高剖面：只有「右側（+Z）」上方收角（Q7 系列：一側貼艙壁）
// widthCm = 底寬、wallCm = 垂直壁高、heightCm = 總高、topWidthCm = 頂寬
function chamferTopOneSideZ(widthCm, wallCm, heightCm, topWidthCm) {
  const half = widthCm / 2;
  return [
    [-half, 0],
    [half, 0],
    [half, wallCm],
    [topWidthCm - half, heightCm],
    [-half, heightCm]
  ];
}

// 寬 × 高剖面：左右對稱上方收角（Q3-00）
function chamferTopBothSidesZ(widthCm, wallCm, heightCm, topWidthCm) {
  const half = widthCm / 2;
  const topHalf = topWidthCm / 2;
  return [
    [-half, 0],
    [half, 0],
    [half, wallCm],
    [topHalf, heightCm],
    [-topHalf, heightCm],
    [-half, wallCm]
  ];
}

// 長 × 高剖面：前後兩端「上方」收角（Q9-01 / A4-00）
// runCm = 水平收角、riseCm = 垂直收角（垂直壁 = height - rise）
function chamferTopBothEndsX(lengthCm, heightCm, runCm, riseCm) {
  const wall = heightCm - riseCm;
  return [
    [0, 0],
    [lengthCm, 0],
    [lengthCm, wall],
    [lengthCm - runCm, heightCm],
    [runCm, heightCm],
    [0, wall]
  ];
}

// 長 × 高剖面：底部兩端「向外斜擴」（H2 / H3 / H4 / W2-00）
// 貼地（板面）就是圖上標的 125"；往上 rise 的這一段，兩端各向外擴 run，
// 所以「輪廓上限」比板面長 2 × run。垂直壁 = height - rise。
//   floorCm = 貼地長度、heightCm = 總高、runCm = 水平外擴、riseCm = 外擴高度
function flareOutwardX(floorCm, heightCm, runCm, riseCm) {
  return [
    [runCm, 0],
    [floorCm + runCm, 0],
    [floorCm + runCm * 2, riseCm],
    [floorCm + runCm * 2, heightCm],
    [0, heightCm],
    [0, riseCm]
  ];
}

// 外擴型下艙貨板：一次算好 baseL（輪廓上限）與 profileX，避免兩者對不上
function flareSpec(floorIn, heightIn, runIn, riseIn) {
  const floorCm = inch(floorIn);
  const heightCm = inch(heightIn);
  const runCm = inch(runIn);
  const riseCm = inch(riseIn);
  return {
    baseL: floorCm + runCm * 2,
    heightCm,
    profileX: flareOutwardX(floorCm, heightCm, runCm, riseCm)
  };
}

// ===== 板型清單（全部依 HACTL 規格圖；第一筆為預設板型）=====
// baseL = 板長 (X)、baseW = 板寬 (Z)、heightCm = 最高點 (Y)
export const LOADSIM_ULD_SPECS = [
  {
    code: 'Q7-00',
    name: 'Q7-00 主艙輪廓貨板（右上 22"×22" 收角）',
    aircraft: '125" × 96" 主艙板（B747F / B767F 等）',
    image: 'Q7-00.jpeg',
    imageSource: 'HACTL',
    baseL: inch(125), baseW: inch(96), heightCm: inch(118),
    profileZ: chamferTopOneSideZ(inch(96), inch(96), inch(118), inch(74)),
    maxGrossKg: 6804, tareKg: 120,
    weightNote: '最大總重為業界常用值，請依航空公司規格確認',
    note: 'HACTL Q7-00：底 125" × 88"/96"、總高 118"；側壁 96"，右上收角 22"(水平) × 22"(垂直) → 頂寬 74"'
  },
  {
    code: 'Q7-02',
    name: 'Q7-02 主艙輪廓貨板（右上 34"×22" 收角）',
    aircraft: '125" × 96" 主艙板',
    image: 'Q7-02.jpeg',
    imageSource: 'HACTL',
    baseL: inch(125), baseW: inch(96), heightCm: inch(118),
    profileZ: chamferTopOneSideZ(inch(96), inch(96), inch(118), inch(62)),
    maxGrossKg: 6804, tareKg: 120,
    weightNote: '最大總重為業界常用值，請依航空公司規格確認',
    note: 'HACTL Q7-02：底 125" × 88"/96"、總高 118"；側壁 96"，右上收角 34"(水平) × 22"(垂直) → 頂寬 62"'
  },
  {
    code: 'Q7-04',
    name: 'Q7-04 主艙輪廓貨板（右上 40"×17" 收角／PMD・Q7D）',
    aircraft: 'B747-400SF / ERF，Pos PL（PMD / Q7D）',
    image: 'Q7-04 - HC, B747-400SF or ERF, Pos PL (PMD or Q7D).jpeg',
    imageSource: 'HACTL',
    baseL: inch(125), baseW: inch(96), heightCm: inch(113),
    profileZ: chamferTopOneSideZ(inch(96), inch(96), inch(113), inch(56)),
    maxGrossKg: 6804, tareKg: 120,
    weightNote: '最大總重為業界常用值，請依航空公司規格確認',
    note: 'HACTL Q7-04：底 125" × 96"、總高 113"；側壁 96"，右上收角 40"(水平) × 17"(垂直) → 頂寬 56"'
  },
  {
    code: 'Q3-00',
    name: 'Q3-00 主艙輪廓貨板（左右上角各 22"×17" 收角）',
    aircraft: 'B747F，N6 / N1',
    image: 'Q3-00 - B747F N6, N1.jpeg',
    imageSource: 'HACTL',
    baseL: inch(125), baseW: inch(96), heightCm: inch(113),
    profileZ: chamferTopBothSidesZ(inch(96), inch(96), inch(113), inch(52)),
    maxGrossKg: 6804, tareKg: 120,
    weightNote: '最大總重為業界常用值，請依航空公司規格確認',
    note: 'HACTL Q3-00：底 125" × 88"/96"、總高 113"；側壁 96"，左右上角各收角 22"(水平) × 17"(垂直) → 頂寬 52"'
  },
  {
    code: 'Q9-01',
    name: 'Q9-01 主艙長貨板（兩端 30"×22" 收角）',
    aircraft: 'B777 / B747-400F',
    image: 'Q9-01 - B777 or B747-400 Freighter.jpeg',
    imageSource: 'HACTL',
    baseL: inch(222), baseW: inch(96), heightCm: inch(118),
    profileX: chamferTopBothEndsX(inch(222), inch(118), inch(30), inch(22)),
    maxGrossKg: 11340, tareKg: 190,
    weightNote: '最大總重為業界常用值，請依航空公司規格確認',
    note: 'HACTL Q9-01：寬 96"、總高 118"、側壁 96"；頂面 162"，兩端各收角 30"(水平) × 22"(垂直) → 全長 222"（圖上另標板長 192"／238.5" NK・NX，請依實際 Pos 選用）'
  },
  {
    code: 'Q6-00',
    name: 'Q6-00 主艙貨板（平頂 96"）',
    aircraft: '125" × 96" 主艙板',
    image: 'Q6-00.jpeg',
    imageSource: 'HACTL',
    baseL: inch(125), baseW: inch(96), heightCm: inch(96),
    maxGrossKg: 6804, tareKg: 120,
    weightNote: '最大總重為業界常用值，請依航空公司規格確認',
    note: 'HACTL Q6-00：高度 96"，無收角（矩形輪廓）；底 125" × 96" 依 HACTL 標準主艙板'
  },

  {
    code: 'A4-00',
    name: 'A4-00 下艙貨板（前後上角 22"×24" 收角）',
    aircraft: '下艙貨板（125" × 96"）',
    image: 'A4-00.jpeg',
    imageSource: 'HACTL',
    baseL: inch(125), baseW: inch(96), heightCm: inch(64),
    profileX: chamferTopBothEndsX(inch(125), inch(64), inch(22), inch(24)),
    maxGrossKg: null, tareKg: 100,
    note: 'HACTL A4-00：貼地 125" × 96"、總高 64"；兩端垂直壁 40"，上角各向內收 22"(水平) × 24"(垂直) → 頂長 81"（上緣往內收，非外擴）'
  },
  {
    code: 'A2-00',
    name: 'A2-00 下艙貨板（平頂 64"）',
    aircraft: '下艙貨板（125" × 88"/96"）',
    image: 'A2-00.jpeg',
    imageSource: 'HACTL',
    baseL: inch(125), baseW: inch(96), heightCm: inch(64),
    maxGrossKg: null, tareKg: 100,
    note: 'HACTL A2-00：長 125"、寬 88"/96"、高 64"，無收角（矩形輪廓）'
  },
  {
    code: 'H2-00',
    name: 'H2-00 下艙貨板（底部兩端各向外 12"）',
    aircraft: '下艙貨板（貼地 125" × 96"）',
    image: 'H2-00.jpeg',
    imageSource: 'HACTL',
    baseW: inch(96),
    // 貼地 125"×96"；底部兩端各向外擴 12"(水平) × 12"(垂直)；垂直壁 52"
    ...flareSpec(125, 64, 12, 12),
    maxGrossKg: null, tareKg: 110,
    note: 'HACTL H2-00：貼地 125" × 96"、總高 64"；底部兩端各向外擴 12"(水平) × 12"(垂直)，垂直壁 52" → 輪廓上限 149" × 96" × 64"'
  },
  {
    code: 'H3-00',
    name: 'H3-00 下艙貨板（底部兩端各向外 18"）',
    aircraft: '下艙貨板（貼地 125" × 96"）',
    image: 'H3-00.jpeg',
    imageSource: 'HACTL',
    baseW: inch(96),
    // 貼地 125"×96"；底部兩端各向外擴 18"(水平) × 18"(垂直)；垂直壁 46"
    ...flareSpec(125, 64, 18, 18),
    maxGrossKg: null, tareKg: 110,
    note: 'HACTL H3-00：貼地 125" × 96"、總高 64"；底部兩端各向外擴 18"(水平) × 18"(垂直)，垂直壁 46" → 輪廓上限 161" × 96" × 64"'
  },
  {
    code: 'H4-00',
    name: 'H4-00 下艙貨板（底部兩端各向外 7.5"）',
    aircraft: '下艙貨板（貼地 125" × 96"）',
    image: 'H4-00.jpeg',
    imageSource: 'HACTL',
    baseW: inch(96),
    // 貼地 125"×96"；底部兩端各向外擴 7.5"(水平) × 22"(垂直)；垂直壁 42"
    ...flareSpec(125, 64, 7.5, 22),
    maxGrossKg: null, tareKg: 110,
    note: 'HACTL H4-00：貼地 125" × 96"、總高 64"；底部兩端各向外擴 7.5"(水平) × 22"(垂直)，垂直壁 42" → 輪廓上限 140" × 96" × 64"'
  },
  {
    code: 'W2-00',
    name: 'W2-00 下艙貨板（底部兩端各向外 30"）',
    aircraft: '下艙貨板（貼地 125" × 88"/96"）',
    image: 'W2-00.jpeg',
    imageSource: 'HACTL',
    baseW: inch(96),
    // 貼地 125"×(88"/96")；底部兩端各向外擴 30"(水平) × 30"(垂直)；垂直壁 34"
    ...flareSpec(125, 64, 30, 30),
    maxGrossKg: null, tareKg: 150,
    note: 'HACTL W2-00：貼地 125" × 88"/96"、總高 64"；底部兩端各向外擴 30"(水平) × 30"(垂直)，垂直壁 34" → 輪廓上限 185" × 96" × 64"'
  },
  {
    code: 'W2-03',
    name: 'W2-03 下艙 OVERHANG 貨板（B747-400F）',
    aircraft: 'B747-400F',
    image: 'W2-03 - B747-400F.jpeg',
    imageSource: 'HACTL',
    // 輪廓總長 186"、板底 125"（置中，左右各 30.5"）、高 64"；兩端底部 33" 外擴
    baseL: inch(186), baseW: inch(96), heightCm: inch(64),
    profileX: [
      [inch(30.5), 0],
      [inch(155.5), 0],
      [inch(186), inch(33)],
      [inch(186), inch(64)],
      [0, inch(64)],
      [0, inch(33)]
    ],
    maxGrossKg: null, tareKg: 170,
    note: 'HACTL W2-03：輪廓總長 186"、板底 125"、高 64"；右端底部收角 30"(水平) × 33"(垂直)，左端對稱（水平 30.5"）→ 上部為 OVERHANG'
  }
];


export const LOADSIM_DEFAULT_ULD = 'Q7-00';



// 取原始（未套用使用者覆寫）的板型
export function loadsimBaseSpec(code) {
  return LOADSIM_ULD_SPECS.find(spec => spec.code === code) || LOADSIM_ULD_SPECS[0];
}

// 套用使用者在畫面上的修改（override 只存差異；undefined = 不變、'' = 清除）
// 若長/寬/高被改動 → 原廠斜切幾何不再可信，改用矩形剖面重建
export function loadsimNormalizeSpec(base, override) {
  const ov = override || {};
  const spec = { ...base };
  const hasNum = v => v !== undefined && v !== null && v !== '' && isFinite(Number(v)) && Number(v) > 0;

  if (hasNum(ov.baseL)) spec.baseL = Number(ov.baseL);
  if (hasNum(ov.baseW)) spec.baseW = Number(ov.baseW);
  if (hasNum(ov.heightCm)) spec.heightCm = Number(ov.heightCm);
  if (ov.maxGrossKg !== undefined) spec.maxGrossKg = hasNum(ov.maxGrossKg) ? Number(ov.maxGrossKg) : null;
  if (ov.tareKg !== undefined) spec.tareKg = hasNum(ov.tareKg) ? Number(ov.tareKg) : 0;

  const dimsChanged =
    (hasNum(ov.baseL) && Math.abs(Number(ov.baseL) - base.baseL) > 0.01) ||
    (hasNum(ov.baseW) && Math.abs(Number(ov.baseW) - base.baseW) > 0.01) ||
    (hasNum(ov.heightCm) && Math.abs(Number(ov.heightCm) - base.heightCm) > 0.01);

  const srcZ = dimsChanged ? null : base.profileZ;
  const srcX = dimsChanged ? null : base.profileX;

  spec.profileZ = loadsimEnsureCcw(srcZ && srcZ.length >= 3 ? srcZ : rectZ(spec.baseW, spec.heightCm));
  spec.profileX = loadsimEnsureCcw(srcX && srcX.length >= 3 ? srcX : rectX(spec.baseL, spec.heightCm));

  const boundsZ = loadsimPolyBounds(spec.profileZ);
  const boundsX = loadsimPolyBounds(spec.profileX);
  spec.baseW = Math.max(spec.baseW, boundsZ.u1 - boundsZ.u0);
  spec.baseL = Math.max(spec.baseL, boundsX.u1 - boundsX.u0);
  spec.heightCm = Math.max(boundsZ.v1, boundsX.v1);

  // ===== 貼地（板面）範圍 =====
  // baseL / baseW 是「輪廓上限」（外擴型板型會比板子大），實際放貨的貼地範圍
  // 由剖面在 y = 0 的底邊決定（例：H3-00 貼地 125"，輪廓 161"）。
  // 沒有底邊資訊時退回整個輪廓範圍。
  const bottomSpan = (poly, fallback0, fallback1) => {
    const flat = poly.filter(([, v]) => Math.abs(v) <= 0.01).map(([u]) => u);
    if (flat.length < 2) return [fallback0, fallback1];
    const lo = Math.min(...flat);
    const hi = Math.max(...flat);
    return hi - lo > 0.01 ? [lo, hi] : [fallback0, fallback1];
  };
  const [floorX0, floorX1] = bottomSpan(spec.profileX, 0, spec.baseL);
  const [floorZ0, floorZ1] = bottomSpan(spec.profileZ, -spec.baseW / 2, spec.baseW / 2);
  spec.floorX0 = floorX0;
  spec.floorX1 = floorX1;
  spec.floorZ0 = floorZ0;
  spec.floorZ1 = floorZ1;
  spec.floorL = floorX1 - floorX0;
  spec.floorW = floorZ1 - floorZ0;
  // 輪廓是否比板面大（外擴型）→ UI 要另外標示
  spec.flared = spec.floorL < spec.baseL - 0.01 || spec.floorW < spec.baseW - 0.01;

  spec.planesZ = loadsimBuildPlanes(spec.profileZ, 'z');
  spec.planesX = loadsimBuildPlanes(spec.profileX, 'x');

  // 可用容積（cm³）：兩個剖面體積取小值（近似值，僅用於顯示利用率）
  const areaZ = Math.abs(loadsimPolyArea(spec.profileZ));
  const areaX = Math.abs(loadsimPolyArea(spec.profileX));
  spec.envelopeVolumeCm3 = Math.min(areaZ * spec.baseL, areaX * spec.baseW);

  return spec;
}

// 取得目前生效的板型（含使用者覆寫）
export function loadsimGetSpec(code, overrides) {
  const base = loadsimBaseSpec(code);
  const ov = overrides ? overrides[base.code] : null;
  return loadsimNormalizeSpec(base, ov);
}

// 板型圖片的 API 路徑（沿用 routes/contours.js 的舊路徑；HACTL 目錄優先）
export function loadsimSpecImageUrl(spec) {
  if (!spec || !spec.image) return '';
  return `/api/contour-image/${encodeURIComponent(spec.image)}`;
}
