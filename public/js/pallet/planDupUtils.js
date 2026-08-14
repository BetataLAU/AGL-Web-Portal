// ===== 打板計劃：跨板重複 MAWB 檢查工具 =====
// 職責：統一「加入前重複攔截」邏輯，供 批量加入 / 雙擊加入 / 拖曳加入 共用
// 依賴 window.displayMawb（utils/mawb-utils.js 提供全域格式化）

// 取得某 booking 在指定 Plan（可為單一 id 或 id 陣列）以外的非取消 plan_refs
export function otherPlanRefs(booking, excludePlanId = null) {
  const excludes = Array.isArray(excludePlanId) ? excludePlanId : (excludePlanId != null ? [excludePlanId] : []);
  return (booking.plan_refs || []).filter(r =>
    r.status !== 'cancelled' && !excludes.includes(r.plan_id)
  );
}

// 找出「已存在於其他打板計劃」的 bookings（加入後將造成跨板重複）
export function findDupBookings(bookings, excludePlanId = null) {
  return (bookings || []).filter(b => otherPlanRefs(b, excludePlanId).length > 0);
}

// 格式化 MAWB（若全域 displayMawb 存在則使用）
function formatMawbValue(mawb) {
  return window.displayMawb ? window.displayMawb(mawb) : (mawb || '-');
}

// 加入前確認：若有跨板重複 → 彈出確認，由使用者決定繼續或取消
// 回傳 true = 繼續加入 / false = 取消
export function confirmAddDuplicates(bookings, excludePlanId = null) {
  const dups = findDupBookings(bookings, excludePlanId);
  if (!dups.length) return true;
  const lines = dups.map(b => {
    const refs = otherPlanRefs(b, excludePlanId)
      .map(r => r.plan_no + '（' + r.status + '）')
      .join('、');
    return '• ' + formatMawbValue(b.mawb) + ' → ' + refs;
  });
  const countText = '⚠️ 以下 ' + dups.length + ' 個 MAWB 已存在於其他打板計劃，加入後將造成跨板重複：';
  const msg = countText + '\n\n' + lines.join('\n') + '\n\n確定仍要加入？';
  return confirm(msg);
}