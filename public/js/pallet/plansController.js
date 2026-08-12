// ===== 打板計劃：右欄 Plan 列表（渲染 + 對外轉發） =====

import { showPlanModal } from './planModal.js';
import {
  afterPlanChange, expandPlan, loadPlanDetail, loadPlans, renderPlans,
  setPlansColElement, updateActionButtonsState,
  handleAddSelectedToPlan, handleRemoveSelectedFromPlan
} from './planActions.js';
import { togglePlanCollapsed, setExpandedPlanId } from './state.js';

// ===== 渲染整個右欄 =====
export function renderPlansColumn(container) {
  container.innerHTML = `
    <div class="pallet-plans-header">
      <h3>📦 打板計劃</h3>
      <button type="button" class="pallet-btn pallet-btn-primary" id="btn-pallet-new-plan">＋ 新增計劃</button>
    </div>
    <div id="pallet-plans-list" class="pallet-plans-col">
      <div class="pallet-empty"><div class="empty-icon">🧱</div>尚未建立任何打板計劃<br/><span style="font-size:0.75rem;">點「＋ 新增計劃」開始</span></div>
    </div>
  `;
  setPlansColElement(container.querySelector('#pallet-plans-list'));

  document.getElementById('btn-pallet-new-plan').addEventListener('click', () => {
    showPlanModal(null, {
      onSaved: async (savedPlan, isEdit) => {
        // 新增時自動展開
        if (!isEdit) {
          togglePlanCollapsed(savedPlan.id);
          setExpandedPlanId(savedPlan.id);
        }
        await afterPlanChange();
      }
    });
  });
}

// ===== 對外轉發（供 pallet.js / dragController.js 使用） =====
export { loadPlans, renderPlans, loadPlanDetail, afterPlanChange, expandPlan, updateActionButtonsState };
export { handleAddSelectedToPlan, handleRemoveSelectedFromPlan };