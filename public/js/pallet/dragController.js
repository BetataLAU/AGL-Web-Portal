// ===== 打板計劃：Drag & Drop 控制器 =====
// 支援：
// 1. 左欄 MAWB 卡片 → 拖到右欄指定 Plan（加入）
// 2. 右欄 Plan 明細行 → 拖回左欄（移出）
// 3. 右欄 Plan ↔ Plan 之間互拖（未上鎖的）
// 4. 同一 Plan 內明細拖曳排序

import {
  getPlans, getPlanItems, getCollapsedPlanIds, isPlanCollapsed, togglePlanCollapsed
} from './state.js';
import { addItemsToPlan, removeItemFromPlan, reorderPlanItems, fetchPlanDetail } from './api.js';
import { loadBookings } from './bookingsController.js';
import { loadPlanDetail, afterPlanChange, expandPlan } from './plansController.js';

let dragType = null;          // 'booking' | 'plan-item' | 'plan-item-reorder'
let dragBookings = [];        // 被拖曳的 booking ids
let dragPlanItemId = null;    // 被拖曳的 plan_item_id
let dragSourcePlanId = null;  // 來源 Plan
let dragGhost = null;

export function setupDragAndDrop() {
  // ===== 委派 dragstart / dragend =====
  document.addEventListener('dragstart', (e) => {
    const bookingCard = e.target.closest('.pallet-booking-card');
    if (bookingCard) {
      // 左欄 MAWB → 拖曳
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
      const isHandle = e.target.closest('.drag-handle');
      // 只有拖曳 handle（⣿）或整行都可拖
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
  });

  document.addEventListener('dragend', (e) => {
    const bookingCard = e.target.closest('.pallet-booking-card');
    if (bookingCard) bookingCard.classList.remove('dragging');
    const planItemRow = e.target.closest('tr[data-plan-item-id]');
    if (planItemRow) planItemRow.classList.remove('dragging-row');
    removeGhost();
    dragType = null;
    dragBookings = [];
    dragPlanItemId = null;
    dragSourcePlanId = null;
  });

  // ===== dragover：決定允許的目標 =====
  document.addEventListener('dragover', (e) => {
    const targetPlanCard = e.target.closest('.pallet-plan-card');
    const bookingsCol = e.target.closest('.pallet-bookings-col');

    if (dragType === 'booking') {
      // 左欄 → 只能拖到「未上鎖」的 Plan
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
      // 右欄 → 左欄（移出）
      if (bookingsCol) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return;
      }
      // 右欄 → 其他未上鎖 Plan
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

    if (dragType === 'booking') {
      if (targetPlanCard) {
        e.preventDefault();
        const planId = Number(targetPlanCard.dataset.planId);
        const plan = getPlans().find(p => p.id === planId);
        if (plan && plan.status === 'draft') {
          try {
            await addItemsToPlan(planId, dragBookings);
            await afterPlanChange();
            await loadBookings();
            // 確保目標 Plan 展開並顯示明細
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
      // 拖回左欄 → 移出
      if (bookingsCol) {
        e.preventDefault();
        try {
          await removeItemFromPlan(dragSourcePlanId, dragPlanItemId);
          await afterPlanChange();
          await loadBookings();
        } catch (err) {
          alert(err.message);
        }
      }
      // 拖到另一個 Plan → 移出並加入
      else if (targetPlanCard) {
        const planId = Number(targetPlanCard.dataset.planId);
        if (planId !== dragSourcePlanId) {
          const plan = getPlans().find(p => p.id === planId);
          if (plan && plan.status === 'draft') {
            e.preventDefault();
            try {
              // 取得該 plan_item 對應的 mawb_record_id（來源明細可能未載入，先用快取、再 fetch 兜底）
              let sourceItem = getPlanItems(dragSourcePlanId).find(it => it.plan_item_id === dragPlanItemId);
              if (!sourceItem) {
                const sourceDetail = await fetchPlanDetail(dragSourcePlanId);
                sourceItem = (sourceDetail.items || []).find(it => it.plan_item_id === dragPlanItemId);
              }
              if (sourceItem) {
                await addItemsToPlan(planId, [sourceItem.id]);
                await removeItemFromPlan(dragSourcePlanId, dragPlanItemId);
                await afterPlanChange();
                await loadBookings();
                expandPlan(planId);   // 確保目標 Plan 展開並顯示明細
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

  // ===== 同一 Plan 內排序（拖曳行 handle → 鬆開時 reorder） =====
  // 用 dragstart 時記錄 dragPlanItemId，drop 到同一個 plan 的不同行時觸發
  document.addEventListener('drop', (e) => {
    if (dragType !== 'plan-item') return;
    const targetRow = e.target.closest('tr[data-plan-item-id]');
    if (!targetRow) return;
    const targetPlanCard = e.target.closest('.pallet-plan-card');
    if (!targetPlanCard) return;
    const targetPlanId = Number(targetPlanCard.dataset.planId);
    const targetPlanItemId = Number(targetRow.dataset.planItemId);
    // 同 Plan 內不同行 → 排序
    if (targetPlanId === dragSourcePlanId && targetPlanItemId !== dragPlanItemId) {
      e.preventDefault();
      e.stopPropagation();
      const items = getPlanItems(targetPlanId);
      const fromIdx = items.findIndex(it => it.plan_item_id === dragPlanItemId);
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

  // 清除所有 dragover 標記（避免殘留）
  document.addEventListener('dragend', () => {
    document.querySelectorAll('.pallet-plan-card.dragover').forEach(el => el.classList.remove('dragover'));
  });
}

// 標記目標 Plan card 的 dragover 狀態
function markDragover(card, active) {
  document.querySelectorAll('.pallet-plan-card.dragover').forEach(el => el.classList.remove('dragover'));
  if (active && card) card.classList.add('dragover');
}

// 建立拖曳提示浮層
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