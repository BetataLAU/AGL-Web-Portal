// ===== 執 PLAN：拖曳排序計算（純函式）=====
// 把 ids（可多筆）插到 anchorId 之前／之後，回傳新的完整順序。
// 規則：
//   - 先把 ids 從原順序移除（其餘保持原順序）
//   - anchorId 為 null（或找不到）→ 放尾端
//   - anchorId 在 ids 之內 → 視為放尾端（拖到自己身上不會亂跳）
//   - before = true 插在 anchor 前、false 插在後
export function lpMoveOrder(order, ids, anchorId = null, before = false) {
  const list = (Array.isArray(order) ? order : []).map(Number).filter(Number.isFinite);
  const moving = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isFinite);
  if (!moving.length) return list;

  const movingSet = new Set(moving);
  const rest = list.filter(id => !movingSet.has(id));
  const anchor = anchorId === null || anchorId === undefined ? null : Number(anchorId);
  if (anchor !== null && movingSet.has(anchor)) {
    return rest.concat(moving);
  }

  let index = anchor === null ? rest.length : rest.indexOf(anchor);
  if (index < 0) index = rest.length;
  if (anchor !== null && !before) index += 1;

  return rest.slice(0, index).concat(moving, rest.slice(index));
}
