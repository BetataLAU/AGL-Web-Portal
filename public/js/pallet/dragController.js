// ===== 打板計劃：Drag & Drop 控制器 =====
// 支援：
// 1. 左欄 MAWB 卡片 → 拖到右欄指定 Plan（加入）
// 2. 右欄 Plan 明細行 → 拖回左欄（移出）
// 3. 右欄 Plan ↔ Plan 之間互拖（未上鎖的）
// 4. 同一 Plan 內明細拖曳排序
// 5. 整張 Plan 卡片拖曳排序（拖 header）

import {
  getPlans, getPlanItems, getCollapsedPlanIds, isPlanCollapsed, togglePlanCollapsed,
  setPlans
} from './state.js';
import { addItemsToPlan, removeItemFromPlan, reorderPlanItems, fetchPlanDetail, reorderPlans } from './api.js';
import { loadBookings } from './bookingsController.js';
import { loadPlanDetail, afterPlanChange, expandPlan, renderPlans } from './plansController.js';

let dragType = null;          // 'booking' | 'plan-item' | 'plan-card'
let dragBookings = [];        // 被拖曳的 booking ids
let dragPlanItemId = null;    // 被拖曳的 plan_item_id
let dragSourcePlanId = null;  // 來源 Plan
let dragSourceCardPlanId = null; // 卡片拖曳排序：來源 Plan id
let dragGhost = null;

export function setupDragAndDrop() {
  // ===== 委派 dragstart / dragend =====
  document.addEventListener('dragstart', (e) => {
    const bookingCard = e.target.closest('.pallet-booking-card');
    if (bookingCard) {
      e.dataTransfer.effectAllowed = 'copy';
      dragType = 'booking';
      const id = Number(bookingCard.dataset.id);
      dragBookings = [id];
      e.dataTransfer.setData('text/plain', `booking:${id}`);
      bookingCard.classList.add('dragging');
      createGhost(`✈️ ${escapeHtml(bookingCard.querySelector('.pallet-booking-mawb span')?.textContent || 'MAWB')}`);
      return;
    }

    const planItemRow = e.target.closest('tr[data-plan-item-id]');
    if (planItemRow) {
      const planCard = planItemRow.closest('.pallet-plan-card');
      if (!planCard) return;
      const planId = Number(planCard.dataset.planId);
      const plan = getPlans().find(p => p.id === planId);
      if (!plan || plan.status !== 'draft') {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = 'move';
      dragType = 'plan-item';
      dragPlanItemId = Number(planItemRow.dataset.planItemId);
      dragSourcePlanId = planId;
      e.dataTransfer.setData('text/plain', `plan-item:${dragPlanItemId}`);
      planItemRow.classList.add('dragging-row');
      const mawbCell = planItemRow.querySelector('.mawb-cell');
      createGhost(`⛓ ${escapeHtml(mawbCell ? mawbCell.textContent : 'MAWB')} → 移至其他板/左欄`);
      return;
    }

    // 整張 Plan 卡片拖曳排序：只允許從 header 開始拖
    const planCardHeader = e.target.closest('.pallet-plan-card .pallet-plan-header');
    if (planCardHeader) {
      const planCard = planCardHeader.closest('.pallet-plan-card');
      if (!planCard) return;
      if (e.target.closest('button, .pallet-more-menu, a, input, select')) return;
      const planId = Number(planCard.dataset.planId);
      const plan = getPlans().find(p => p.id === planId);
      if (!plan) return;
      e.dataTransfer.effectAllowed = 'move';
      dragType = 'plan-card';
      dragSourceCardPlanId = planId;
      e.dataTransfer.setData('text/plain', `plan-card:${planId}`);
      planCard.classList.add('dragging');
      createGhost(`🗂 ${escapeHtml(plan.plan_no)} → 調整位置`);
      return;
    }
  });

  document.addEventListener('dragend', (e) => {
    // ===== 只清理視覺效果，不清空拖曳變數 =====
    // 原因：drop handler 是 async，await 期間 dragend 會觸發；
    //       若在此清空 dragSourcePlanId / dragPlanItemId，await 後的
    //       removeItemFromPlan 會傳入 null → 404「打板計劃不存在」
    const bookingCard = e.target.closest('.pallet-booking-card');
    if (bookingCard) bookingCard.classList.remove('dragging');
    const planItemRow = e.target.closest('tr[data-plan-item-id]');
    if (planItemRow) planItemRow.classList.remove('dragging-row');
    const planCard = e.target.closest('.pallet-plan-card');
    if (planCard) planCard.classList.remove('dragging');
    removeGhost();
    document.querySelectorAll('.pallet-plan-card.dragover').forEach(el => el.classList.remove('dragover'));
  });

  // ===== dragover：決定允許的目標 =====
  document.addEventListener('dragover', (e) => {
    const targetPlanCard = e.target.closest('.pallet-plan-card');
    const bookingsCol = e.target.closest('.pallet-bookings-col');

    if (dragType === 'booking') {
      if (targetPlanCard) {
        const planId = Number(targetPlanCard.dataset.planId);
        const plan = getPlans().find(p => p.id === planId);
        if (plan && plan.status === 'draft') {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          markDragover(targetPlanCard, true);
          return;
        }
      } else {
        markDragover(targetPlanCard, false);
      }
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    if (dragType === 'plan-item') {
      if (bookingsCol) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return;
      }
      if (targetPlanCard) {
        const planId = Number(targetPlanCard.dataset.planId);
        const plan = getPlans().find(p => p.id === planId);
        if (plan && plan.status === 'draft') {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          markDragover(targetPlanCard, true);
          return;
        }
      } else {
        markDragover(targetPlanCard, false);
      }
      return;
    }

    if (dragType === 'plan-card') {
      if (targetPlanCard) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        markDragover(targetPlanCard, true);
      }
    }
  });

  document.addEventListener('dragleave', (e) => {
    const targetPlanCard = e.target.closest('.pallet-plan-card');
    if (targetPlanCard) targetPlanCard.classList.remove('dragover');
  });

  // ===== drop =====
  document.addEventListener('drop', async (e) => {
    const targetPlanCard = e.target.closest('.pallet-plan-card');
    const bookingsCol = e.target.closest('.pallet-bookings-col');

    // ===== 先快照拖曳變數到局部變數（防止 dragend 清除變數造成 null） =====
    const srcBookings = [...dragBookings];
    const srcPlanItemId = dragPlanItemId;
    const srcPlanId = dragSourcePlanId;

    if (dragType === 'plan-card') {
      if (targetPlanCard) {
        e.preventDefault();
        const targetPlanId = Number(targetPlanCard.dataset.planId);
        if (targetPlanId !== dragSourceCardPlanId) {
          const plans = getPlans();
          const fromIdx = plans.findIndex(p => p.id === dragSourceCardPlanId);
          const toIdx = plans.findIndex(p => p.id === targetPlanId);
          if (fromIdx >= 0 && toIdx >= 0) {
            const newPlans = [...plans];
            const [moved] = newPlans.splice(fromIdx, 1);
            newPlans.splice(toIdx, 0, moved);
            setPlans(newPlans);
            renderPlans();
            reorderPlans(newPlans.map(p => p.id)).catch(err => {
              console.error('[pallet] 儲存卡片排序失敗:', err);
              alert('排序已更新，但儲存失敗：' + err.message);
            });
          }
        }
      }
      markDragover(targetPlanCard, false);
      return;
    }

    if (dragType === 'booking') {
      if (targetPlanCard) {
        e.preventDefault();
        const planId = Number(targetPlanCard.dataset.planId);
        const plan = getPlans().find(p => p.id === planId);
        if (plan && plan.status === 'draft') {
          try {
            await addItemsToPlan(planId, srcBookings);
            await afterPlanChange();
            await loadBookings();
            if (isPlanCollapsed(planId)) {
              togglePlanCollapsed(planId);
            }
            await loadPlanDetail(planId);
          } catch (err) {
            alert(err.message);
          }
        }
      }
    } else if (dragType === 'plan-item') {
      if (bookingsCol) {
        e.preventDefault();
        try {
          await removeItemFromPlan(srcPlanId, srcPlanItemId);
          await afterPlanChange();
          await loadBookings();
        } catch (err) {
          alert(err.message);
        }
      } else if (targetPlanCard) {
        const planId = Number(targetPlanCard.dataset.planId);
        if (planId !== srcPlanId) {
          const plan = getPlans().find(p => p.id === planId);
          if (plan && plan.status === 'draft') {
            e.preventDefault();
            try {
              let sourceItem = getPlanItems(srcPlanId).find(it => it.plan_item_id === srcPlanItemId);
              if (!sourceItem) {
                const sourceDetail = await fetchPlanDetail(srcPlanId);
                sourceItem = (sourceDetail.items || []).find(it => it.plan_item_id === srcPlanItemId);
              }
              if (sourceItem) {
                await addItemsToPlan(planId, [sourceItem.id]);
                await removeItemFromPlan(srcPlanId, srcPlanItemId);
                await afterPlanChange();
                await loadBookings();
                expandPlan(planId);
              } else {
                alert('找不到該 MAWB 的來源資料，無法移動');
              }
            } catch (err) {
              alert(err.message);
            }
          }
        }
      }
    }
    markDragover(targetPlanCard, false);
  });

  // ===== 同一 Plan 內排序 =====
  document.addEventListener('drop', (e) => {
    if (dragType !== 'plan-item') return;
    const targetRow = e.target.closest('tr[data-plan-item-id]');
    if (!targetRow) return;
    const targetPlanCard = e.target.closest('.pallet-plan-card');
    if (!targetPlanCard) return;
    const targetPlanId = Number(targetPlanCard.dataset.planId);
    const targetPlanItemId = Number(targetRow.dataset.planItemId);
    const srcPlanId = dragSourcePlanId;
    const srcPlanItemId = dragPlanItemId;
    if (targetPlanId === srcPlanId && targetPlanItemId !== srcPlanItemId) {
      e.preventDefault();
      e.stopPropagation();
      const items = getPlanItems(targetPlanId);
      const fromIdx = items.findIndex(it => it.plan_item_id === srcPlanItemId);
      const toIdx = items.findIndex(it => it.plan_item_id === targetPlanItemId);
      if (fromIdx >= 0 && toIdx >= 0) {
        const newItems = [...items];
        const [moved] = newItems.splice(fromIdx, 1);
        newItems.splice(toIdx, 0, moved);
        const orderedIds = newItems.map(it => it.plan_item_id);
        reorderPlanItems(targetPlanId, orderedIds)
          .then(() => loadPlanDetail(targetPlanId))
          .catch(err => alert(err.message));
      }
    }
  });
}

function markDragover(card, active) {
  document.querySelectorAll('.pallet-plan-card.dragover').forEach(el => el.classList.remove('dragover'));
  if (active && card) card.classList.add('dragover');
}

function createGhost(text) {
  removeGhost();
  dragGhost = document.createElement('div');
  dragGhost.className = 'pallet-drag-ghost';
  dragGhost.innerHTML = text;
  document.body.appendChild(dragGhost);
}

function removeGhost() {
  if (dragGhost) {
    dragGhost.remove();
    dragGhost = null;
  }
}