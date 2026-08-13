// ===== 打板計劃：入口模組 =====
// 三欄佈局：左（Booking Records）｜中（操作按鈕）｜右（Plan Containers）
// admin/staff 限定（由 main.js 的 initProtectedSections 依角色呼叫）

import { renderBookingsColumn, loadBookings, loadReferenceData } from './pallet/bookingsController.js';
import { syncOrders } from './pallet/api.js';
import {
  renderPlansColumn, loadPlans,
  handleAddSelectedToPlan, handleRemoveSelectedFromPlan
} from './pallet/plansController.js';
import { setupDragAndDrop } from './pallet/dragController.js';
import { clearSelectedPlanItems } from './pallet/state.js';
import { updateActionButtonsState } from './pallet/planActions.js';

let initialized = false;

export function setupPalletSection() {
  if (initialized) return;
  initialized = true;

  const root = document.getElementById('pallet-root');
  if (!root) return;

  renderLayout(root);
  setupActions();
  setupDragAndDrop();

  // 重新整理按鈕
  const refreshBtn = document.getElementById('btn-pallet-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await Promise.all([loadBookings(), loadPlans()]);
    });
  }

  // 「⇄ 同步訂單」按鈕：將訂單系統的訂單同步為 Booking Record
  const syncBtn = document.getElementById('btn-pallet-sync-orders');
  if (syncBtn) {
    syncBtn.style.display = '';
    syncBtn.addEventListener('click', async () => {
      try {
        syncBtn.disabled = true;
        syncBtn.textContent = '⏳ 同步中...';
        // 第一次同步（不覆寫衝突）
        let result = await syncOrders({});
        let counts = result;
        // 若有衝突 → 詢問用戶是否覆寫
        if (result && result.conflicts && result.conflicts.length) {
          const conflictList = result.conflicts.map(c => `• ${c.mawb}（訂單 ${c.order_no}）`).join('\n');
          const overwrite = confirm(`⚠️ ${result.conflicts.length} 筆 MAWB 已存在於打板但由其他來源建立：\n\n${conflictList}\n\n按「確定」= 以訂單資料覆寫這些 MAWB\n按「取消」= 略過衝突（保留現有）`);
          if (overwrite) {
            result = await syncOrders({ overwrite_conflicts: true });
            counts = result;
          }
        }
        alert(`✅ 同步完成！\n\n新增 ${counts.added || 0} 筆\n更新 ${counts.updated || 0} 筆\n衝突 ${(counts.conflicts || []).length} 筆`);
        await Promise.all([loadBookings(), loadPlans()]);
      } catch (err) {
        alert(`❌ 同步失敗：${err.message}`);
      } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> ⇄ 同步訂單';
      }
    });
  }

  // 排列切換按鈕（上下/左右）
  const layoutToggleBtn = document.getElementById('btn-pallet-layout-toggle');
  const layoutToggleLabel = document.getElementById('pallet-layout-toggle-label');
  if (layoutToggleBtn) {
    layoutToggleBtn.style.display = '';
    layoutToggleBtn.addEventListener('click', () => {
      const plansList = document.getElementById('pallet-plans-list');
      if (!plansList) return;
      const isHorizontal = plansList.classList.toggle('horizontal');
      layoutToggleBtn.classList.toggle('active', isHorizontal);
      if (layoutToggleLabel) {
        layoutToggleLabel.textContent = isHorizontal ? '上下排列' : '左右排列';
      }
    });
  }

  // 左欄選取變更 → 動態啟用/停用中間按鈕
  window.addEventListener('pallet:selection-changed', () => {
    updateActionButtonsState();
  });

  // 初始載入
  loadReferenceData().then(() => {
    return Promise.all([loadBookings(), loadPlans()]);
  }).catch(err => {
    console.error('[pallet] 初始載入失敗:', err);
  });

  // 資料變更事件（例如 Booking 更新後重整 Plans 的目標顯示）
  window.addEventListener('pallet:data-changed', () => {
    updateActionButtonsState();
  });
}

// ===== 渲染三欄佈局 =====
function renderLayout(root) {
  root.innerHTML = `
    <div class="pallet-layout">
      <!-- 左欄：Booking Records -->
      <div class="pallet-col">
        <div class="pallet-col-label">
          <span>📋 Booking Records</span>
          <span>未入板</span>
        </div>
        <div id="pallet-bookings-col"></div>
      </div>

      <!-- 中間：操作按鈕（精簡） -->
      <div class="pallet-actions-col">
        <div class="pallet-target-display" id="pallet-target-plan-display" data-has-target="0"></div>
        <button type="button" class="pallet-action-btn add" id="btn-pallet-add-selected" title="將左欄已選 MAWB 加入目標計劃" disabled>
          ▶ 加入所選
        </button>
        <button type="button" class="pallet-action-btn remove" id="btn-pallet-remove-selected" title="將已選明細移出計劃" disabled>
          ◀ 移出所選
        </button>
      </div>

      <!-- 右欄：Plans -->
      <div class="pallet-col">
        <div class="pallet-col-label">
          <span>🧱 打板計劃</span>
        </div>
        <div id="pallet-plans-col"></div>
      </div>
    </div>
  `;

  const bookingsColContainer = document.getElementById('pallet-bookings-col');
  const plansColContainer = document.getElementById('pallet-plans-col');
  renderBookingsColumn(bookingsColContainer);
  renderPlansColumn(plansColContainer);
}

// ===== 中間操作按鈕 =====
function setupActions() {
  document.getElementById('btn-pallet-add-selected').addEventListener('click', () => {
    handleAddSelectedToPlan();
  });

  document.getElementById('btn-pallet-remove-selected').addEventListener('click', () => {
    handleRemoveSelectedFromPlan();
  });
}

// 供外部（例如 auth.js 登出）清理狀態
export function resetPalletSection() {
  initialized = false;
  clearSelectedPlanItems();
}

// ===== 掛載到 window（供 main.js 的 initProtectedSections 呼叫） =====
// module 屬 defer，於 DOMContentLoaded 前執行完畢
window.setupPalletSection = setupPalletSection;