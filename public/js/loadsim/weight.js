// ===== 模擬裝板：重量 / 體積 / 利用率計算 =====
// 重量一律 kg；體積以 cm³ 計算後換算 CBM（1 CBM = 1,000,000 cm³）
import { loadsimDimsOf } from './geometry.js';

export function loadsimSummarize(state, spec) {
  // 已裝＝在板上（不含暫存）；暫存＝拖出板外暫放；待裝＝還沒放上畫面的
  const onBoard = state.items.filter(item => item.placed && !item.staged);
  const staged = state.items.filter(item => item.placed && item.staged);
  const pending = state.items.filter(item => !item.placed);

  const cargoKg = onBoard.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  const pendingKg = pending.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  const stagedKg = staged.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  const tareKg = spec ? Math.max(0, Number(spec.tareKg) || 0) : 0;
  const totalKg = cargoKg + tareKg;
  const maxKg = spec && Number(spec.maxGrossKg) > 0 ? Number(spec.maxGrossKg) : null;
  const overKg = maxKg ? Math.max(0, totalKg - maxKg) : 0;
  const ratio = maxKg ? totalKg / maxKg : 0;

  // 貨物總體積（以外箱尺寸計，不扣除空隙；只算板上的）
  const volumeCm3 = onBoard.reduce((sum, item) => {
    const d = loadsimDimsOf(item);
    return sum + d.x * d.y * d.z;
  }, 0);
  const capacityCm3 = spec && spec.envelopeVolumeCm3 > 0 ? spec.envelopeVolumeCm3 : 0;
  const utilPct = capacityCm3 ? Math.min(999, (volumeCm3 / capacityCm3) * 100) : 0;

  // 單件超過「單件重量上限」的貨物（含暫存，暫存也是要裝的貨）；沒勾選上限就不檢查
  const limit = state.itemMaxEnabled === false ? 0 : (Number(state.itemMaxKg) || 0);
  const heavy = limit > 0
    ? state.items.filter(item => item.placed && (Number(item.weight) || 0) > limit)
    : [];

  return {
    count: onBoard.length,
    stagedCount: staged.length,
    pendingCount: pending.length,
    cargoKg,
    stagedKg,
    pendingKg,
    tareKg,
    totalKg,
    maxKg,
    overKg,
    ratio,
    volumeCm3,
    capacityCm3,
    utilPct,
    cbm: volumeCm3 / 1e6,
    maxKgLimit: limit,
    heavy
  };
}

// 單件貨物的 CBM（立方公尺）＝ 目前方向 長×寬×高（cm³）÷ 1,000,000
// （明細列的「CBM」欄、出界／容積說明都用這個函式，避免各處算法不一致）
export function loadsimItemCbm(item) {
  if (!item) return 0;
  const d = loadsimDimsOf(item);
  const volume = (Number(d.x) || 0) * (Number(d.y) || 0) * (Number(d.z) || 0);
  return volume / 1e6;
}

// 重量狀態：'ok' 正常 / 'warn' 接近上限（>=90%）/ 'over' 超重 / 'unknown' 未設定上限
export function loadsimWeightLevel(summary) {
  if (!summary.maxKg) return summary.heavy.length ? 'warn' : 'unknown';
  if (summary.overKg > 0) return 'over';
  if (summary.ratio >= 0.9) return 'warn';
  return 'ok';
}

// 重量提示文字（給 banner / toast 用）
export function loadsimWeightMessage(summary, unitFormatter) {
  const fmt = typeof unitFormatter === 'function' ? unitFormatter : kg => `${kg.toFixed(1)} kg`;
  if (summary.maxKg && summary.overKg > 0) {
    return `超出板型最大總重 ${fmt(summary.overKg)}（目前 ${fmt(summary.totalKg)} / 上限 ${fmt(summary.maxKg)}）`;
  }
  if (summary.heavy.length) {
    const names = summary.heavy.slice(0, 3).map(item => item.name).join('、');
    return `${summary.heavy.length} 件超過單件上限 ${fmt(summary.maxKgLimit)}：${names}`;
  }
  return '';
}
