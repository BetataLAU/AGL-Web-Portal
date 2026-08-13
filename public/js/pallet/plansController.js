// ===== 打板計劃：右欄 Plan 列表（渲染 + 對外轉發） =====

import { showPlanModal } from './planModal.js';
import {
  afterPlanChange, expandPlan, loadPlanDetail, loadPlans, renderPlans,
  setPlansColElement, updateActionButtonsState,
  handleAddSelectedToPlan, handleRemoveSelectedFromPlan
} from './planActions.js';
import { togglePlanCollapsed, setExpandedPlanId, getPlans, getClosedPlans, reopenPlan } from './state.js';

// ===== 渲染整個右欄 =====
export function renderPlansColumn(container) {
  container.innerHTML = `
    <div class="pallet-plans-header">
      <h3>📦 打板計劃</h3>
      <div class="pallet-plans-header-right">
        <div class="pallet-closed-plans-search">
          <input type="search" id="pallet-closed-plans-search" placeholder="🔍 搜尋已關閉計劃..." autocomplete="off" />
          <div class="pallet-closed-plans-list" id="pallet-closed-plans-list" style="display:none;"></div>
        </div>
        <button type="button" class="pallet-btn pallet-btn-primary" id="btn-pallet-new-plan">＋ 新增計劃</button>
      </div>
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

  // ===== 搜尋已關閉計劃：輸入時浮出清單，點擊重新開啟 =====
  const searchInput = document.getElementById('pallet-closed-plans-search');
  const listEl = document.getElementById('pallet-closed-plans-list');
  if (searchInput && listEl) {
    const renderClosedList = () => {
      const q = searchInput.value.trim().toLowerCase();
      const closed = getClosedPlans(getPlans()).filter(p =>
        !q || String(p.plan_no).toLowerCase().includes(q) || String(p.flight_no || '').toLowerCase().includes(q)
      );
      if (!closed.length) {
        listEl.style.display = 'none';
        return;
      }
      listEl.innerHTML = closed.map(p => `
        <button type="button" class="pallet-closed-plan-item" data-plan-id="${p.id}">
          <span>${escapeHtml(p.plan_no)}</span>
          <small>${escapeHtml(p.status === 'draft' ? '草稿' : p.status)}</small>
        </button>
      `).join('');
      listEl.style.display = 'block';
      // 點擊 → 重新開啟並清除搜尋
      listEl.querySelectorAll('.pallet-closed-plan-item').forEach(btn => {
        btn.addEventListener('click', () => {
          reopenPlan(Number(btn.dataset.planId));
          searchInput.value = '';
          listEl.style.display = 'none';
          renderPlans();
        });
      });
    };
    searchInput.addEventListener('input', renderClosedList);
    searchInput.addEventListener('focus', renderClosedList);
    // 點擊外部關閉清單
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.pallet-closed-plans-search')) {
        listEl.style.display = 'none';
      }
    });
  }
}

// ===== 對外轉發（供 pallet.js / dragController.js 使用） =====
export { loadPlans, renderPlans, loadPlanDetail, afterPlanChange, expandPlan, updateActionButtonsState };
export { handleAddSelectedToPlan, handleRemoveSelectedFromPlan };