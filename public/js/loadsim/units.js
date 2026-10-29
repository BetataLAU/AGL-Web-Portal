// ===== 模擬裝板：長度單位換算與格式化 =====
// 設計原則：內部一律以「公分 (cm)」浮點儲存與計算，
//           切換 cm / inch 只影響輸入欄位標籤與畫面顯示，避免換算漂移。
const CM_PER_INCH = 2.54;

// 顯示單位 → 內部 cm
export function loadsimUnitToCm(value, unit) {
  const v = Number(value);
  if (!isFinite(v)) return NaN;
  return unit === 'in' ? v * CM_PER_INCH : v;
}

// 內部 cm → 顯示單位
export function loadsimCmToUnit(cm, unit) {
  const v = Number(cm);
  if (!isFinite(v)) return 0;
  return unit === 'in' ? v / CM_PER_INCH : v;
}

export function loadsimUnitLabel(unit) {
  return unit === 'in' ? 'in' : 'cm';
}

export function loadsimUnitName(unit) {
  return unit === 'in' ? '吋 (inch)' : '公分 (cm)';
}

// 輸入框 step / min（cm 只接受整數；inch 1 位小數）
// 注意：step 的基準點是 min，min 與 step 必須同量級，否則整數值會被瀏覽器判為不合法
export function loadsimInputStep(unit) {
  return unit === 'in' ? '0.1' : '1';
}

export function loadsimInputMin(unit) {
  return unit === 'in' ? '0.1' : '1';
}

// 數值字串（不含單位）
// 未指定小數位時：cm → 0 位（整數，依使用者要求不使用小數點）、inch → 1 位
// 並避免 -0
export function loadsimFormatNumber(cm, unit, digits) {
  const places = digits === undefined ? (unit === 'in' ? 1 : 0) : digits;
  const v = loadsimCmToUnit(cm, unit);
  const factor = Math.pow(10, places);
  let rounded = Math.round(v * factor) / factor;
  if (Object.is(rounded, -0)) rounded = 0;
  return rounded.toFixed(places);
}

// 超出量顯示：cm 整數（不足 1cm 標「<1」避免顯示成 0）、inch 1 位小數
export function loadsimFormatAmount(cm, unit) {
  const v = Math.abs(Number(cm) || 0);
  if (unit === 'in') return loadsimFormatNumber(v, 'in', 1);
  if (v > 0 && v < 0.5) return '<1';
  return String(Math.round(v));
}

// 「163 cm」/「64.2 in」
export function loadsimFormatLength(cm, unit) {
  return `${loadsimFormatNumber(cm, unit)} ${loadsimUnitLabel(unit)}`;
}

// 刻度間距：回傳「cm」值（顯示單位為 nice number：cm 10/20/50…、inch 6/12/24…）
// pxPerCm 由目前縮放比例提供；確保刻度標籤之間至少 46px
export function loadsimTickStepCm(unit, pxPerCm) {
  const candidates = unit === 'in' ? [6, 12, 24, 48, 96] : [10, 20, 50, 100, 200];
  for (const step of candidates) {
    const stepCm = unit === 'in' ? step * CM_PER_INCH : step;
    if (stepCm * pxPerCm >= 46) return stepCm;
  }
  const last = candidates[candidates.length - 1];
  return unit === 'in' ? last * CM_PER_INCH : last;
}

// 刻度標籤（整數顯示，例如 cm: "150"；inch: "60"）
export function loadsimFormatTick(cm, unit) {
  return loadsimFormatNumber(cm, unit, 0);
}

export { CM_PER_INCH };
