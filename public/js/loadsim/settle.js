// ===== 模擬裝板：刪除貨物後的「重力」落下 =====
// 需求：貨物消失時，如果下方還有貨物，要物理地掉到合理的位置（不會往上跳）。
// 作法：只考慮「目前底面以下（含）」的支撐面，由低到高逐件重算，
//       避免上層先掉穿下層（下層先落定，上層再依它重算）。
import { loadsimState } from './state.js';
import { loadsimExtents, loadsimSupportRatio, loadsimSupportMinRatio } from './geometry.js';

const EPS = 1e-6;

function supportOptions(options = {}) {
  const requireSupport = options.requireSupport !== false;
  const minRatio = loadsimSupportMinRatio(options);
  return { requireSupport, minRatio };
}

// 單件貨物「往下掉」會停在哪個高度（不含往上跳；沒有合格支撐就落到地面）
export function loadsimFallHeight(item, others, options = {}) {
  if (!item) return 0;
  if (!item.placed || item.staged) return Math.max(0, Number(item.y) || 0);
  const { requireSupport, minRatio } = supportOptions(options);
  const ext = loadsimExtents(item);
  if (ext.y0 <= EPS) return 0;
  const height = Math.max(0, ext.y1 - ext.y0);
  const list = (others || []).filter(other =>
    other && other.id !== item.id && other.placed && !other.staged);

  const levels = [0];
  list.forEach(other => {
    const e = loadsimExtents(other);
    const overlapX = Math.min(e.x1, ext.x1) - Math.max(e.x0, ext.x0);
    const overlapZ = Math.min(e.z1, ext.z1) - Math.max(e.z0, ext.z0);
    if (overlapX <= EPS || overlapZ <= EPS) return;
    if (e.y1 > ext.y0 + EPS) return; // 只看下方（含同高）的支撐面
    levels.push(e.y1);
  });
  const sorted = [...new Set(levels.map(v => Math.round(v * 100) / 100))].sort((a, b) => b - a);

  for (const y of sorted) {
    if (y <= EPS) return 0; // 地板
    if (!requireSupport) return y;
    const shifted = { x0: ext.x0, x1: ext.x1, y0: y, y1: y + height, z0: ext.z0, z1: ext.z1 };
    const ratio = loadsimSupportRatio(shifted, list);
    // minRatio = 0（沒勾面積比例）時仍要有接觸
    if (ratio > 1e-9 && (minRatio <= 0 || ratio >= minRatio - 1e-9)) return y;
  }
  return 0;
}

// 整板重新落下（刪除貨物後呼叫）：回傳有移動的件數
export function loadsimSettleBoard(options = {}) {
  const board = loadsimState.items.filter(item => item.placed && !item.staged);
  const ordered = board.slice().sort((a, b) => (a.y - b.y) || (a.id - b.id));
  let changed = 0;
  ordered.forEach(item => {
    const y = loadsimFallHeight(item, loadsimState.items, options);
    if (Math.abs(y - item.y) > 1e-6) {
      item.y = y;
      changed += 1;
    }
  });
  return changed;
}
