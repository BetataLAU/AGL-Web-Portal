// ===== 執 PLAN（Loading Plan）：入口 =====
// 三欄工作台：左＝存貨｜中＝KPI＋操作｜右＝PLANS 卡片（展開是明細表）
// 由 main.js 的 initProtectedSections 呼叫（登入即可用，不設角色限制）
import { renderLayout } from './loading-plan/render.js';
import { setupInteractions } from './loading-plan/interactions.js';

let initialized = false;
let controller = null;

export function setupLoadingPlanSection() {
  if (initialized) return;
  const root = document.getElementById('lp-root');
  if (!root) return;
  initialized = true;
  renderLayout(root);
  controller = setupInteractions(root);
}

// 登出時清掉（下次登入會重新載入）
export function resetLoadingPlanSection() {
  initialized = false;
  controller = null;
}

window.setupLoadingPlanSection = setupLoadingPlanSection;
window.resetLoadingPlanSection = resetLoadingPlanSection;
