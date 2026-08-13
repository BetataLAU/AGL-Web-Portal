// ===== 打板計劃：Plan 操作分派 / More 選單 / 加入移出 / 列表渲染 =====
// 依賴 window.escapeHtml

import {
  fetchPlans, deletePlan, duplicatePlan, updatePlan, fetchPlanDetail,
  addItemsToPlan, removeItemFromPlan
} from './api.js';
import {
  getPlans, setPlans, getSelectedPlanId, getSelectedBookingIds, setSelectedPlanId,
  getSelectedPlanItemIds, togglePlanItemSelection, clearSelectedPlanItems,
  clearSelectedBookings, isPlanCollapsed, togglePlanCollapsed,
  getExpandedPlanId, setExpandedPlanId, setPlanItems,
  closePlan, isPlanClosed, reopenPlan
} from './state.js';
import { buildPlanTextSummary } from './formatters.js';
import { loadBookings } from './bookingsController.js';
import { showPlanModal, showStatusModal, showContourPreview } from './planModal.js';
import { renderPlanCard } from './planCardRenderer.js';

let plansColEl = null;

// ===== 設定右欄容器（由 renderPlansColumn 呼叫） =====
export function setPlansColElement(el) { plansColEl = el; }

// ===== 載入 Plans（列表）+ 自動載入展開 Plan 的明細 =====
export async function loadPlans() {
  try {
    const list = await fetchPlans();
    setPlans(list);
    renderPlans();
    // 自動載入所有「應展開」Plan 的明細，避免首次進入時誤顯示「尚無 MAWB」
    const expandedPlans = list.filter(plan => {
      if (plan.status !== 'draft') return getExpandedPlanId() === plan.id;
      return !isPlanCollapsed(plan.id);
    });
    await Promise.all(expandedPlans.map(p => loadPlanDetail(p.id)));
  } catch (err) {
    if (plansColEl) {
      plansColEl.innerHTML = `<div class="pallet-empty">⚠️ 載入計劃失敗：${escapeHtml(err.message)}</div>`;
    }
  }
}

// ===== 渲染 Plans =====
export function renderPlans() {
  if (!plansColEl) return;
  const plans = getPlans();
  if (!plans.length) {
    plansColEl.innerHTML = `<div class="pallet-empty"><div class="empty-icon">🧱</div>尚未建立任何打板計劃<br/><span style="font-size:0.75rem;">點「＋ 新增計劃」開始</span></div>`;
    return;
  }
  plansColEl.innerHTML = plans.map(plan => {
    const collapsed = isPlanCollapsed(plan.id) || (plan.status !== 'draft' && getExpandedPlanId() !== plan.id);
    return renderPlanCard(plan, collapsed);
  }).join('');

  bindPlanCardEvents(plansColEl);
  setupMoreMenus(plansColEl);
  updateActionButtonsState();
}

// ===== More 選單（dropdown） =====
export function setupMoreMenus(container) {
  container.querySelectorAll('.pallet-more-menu[data-more-menu]').forEach(menu => {
    const toggleBtn = menu.querySelector('[data-action="more-toggle"]');
    const dropdown = menu.querySelector('.pallet-more-dropdown');

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('open');
      closeAllMoreMenus(container);
      if (!isOpen) {
        menu.classList.add('open');
        // ===== fixed 定位：徹底脫離卡片 overflow:hidden 裁切 =====
        // 用 toggle 按鈕的視窗座標，直接把 dropdown 釘在視窗層級
        requestAnimationFrame(() => {
          const btnRect = toggleBtn.getBoundingClientRect();
          const viewportH = window.innerHeight || document.documentElement.clientHeight;
          const dropdownH = dropdown.offsetHeight;
          const spaceBelow = viewportH - btnRect.bottom;
          dropdown.style.position = 'fixed';
          dropdown.style.minWidth = '150px';
          dropdown.style.right = `${Math.max(8, window.innerWidth - btnRect.right)}px`;
          dropdown.style.left = 'auto';
          // 若下方空間不足 → 向上展開
          if (spaceBelow < dropdownH + 8) {
            menu.classList.add('drop-up');
            dropdown.style.top = `${Math.max(8, btnRect.top - dropdownH - 4)}px`;
            dropdown.style.bottom = 'auto';
          } else {
            menu.classList.remove('drop-up');
            dropdown.style.top = `${btnRect.bottom + 4}px`;
            dropdown.style.bottom = 'auto';
          }
        });
      } else {
        menu.classList.remove('open');
      }
    });

    dropdown.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        menu.classList.remove('open');
      });
    });
  });
}

export function closeAllMoreMenus(container) {
  container.querySelectorAll('.pallet-more-menu.open').forEach(m => m.classList.remove('open'));
}

// ===== 綁定卡片事件（Header 選定 / 明細多選 / 箭頭 / Body 切換） =====
export function bindPlanCardEvents(container) {
  if (!bindPlanCardEvents.docBound) {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.pallet-more-menu')) {
        closeAllMoreMenus(container);
      }
    });
    bindPlanCardEvents.docBound = true;
  }

  container.querySelectorAll('.pallet-plan-card').forEach(card => {
    const planId = Number(card.dataset.planId);
    const plan = getPlans().find(p => p.id === planId);
    if (!plan) return;

    // Header 點擊 → 選定目標（排除按鈕/選單）
    const header = card.querySelector('.pallet-plan-header');
    header.addEventListener('click', (e) => {
      if (e.target.closest('.pallet-plan-actions') ||
          e.target.closest('.pallet-plan-action-btn') ||
          e.target.closest('.pallet-plan-arrow') ||
          e.target.closest('.pallet-more-menu')) return;
      setSelectedPlanId(planId);
      renderPlans();
    });

    // 箭頭 → 展開/收合
    card.querySelector('.pallet-plan-arrow[data-action]').addEventListener('click', (e) => {
      e.stopPropagation();
      handlePlanAction(planId, 'arrow-toggle');
    });

    // 明細表格：點選行多選
    card.querySelectorAll('.pallet-items-table tbody tr').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.remove-item-btn')) return;
        const planItemId = Number(row.dataset.planItemId);
        togglePlanItemSelection(planId, planItemId);
        renderPlans();
      });
    });

    // Metadata 摘要 → 展開/收合詳細資訊（Accordion）
    const metaSummary = card.querySelector('.pallet-plan-meta-summary[data-action="info-toggle"]');
    if (metaSummary) {
      metaSummary.addEventListener('click', (e) => {
        e.stopPropagation();
        const grid = card.querySelector('.pallet-plan-info-grid');
        const toggleIcon = metaSummary.querySelector('.pallet-plan-info-toggle i');
        if (!grid) return;
        const isHidden = grid.hidden;
        grid.hidden = !isHidden;
        if (toggleIcon) {
          toggleIcon.classList.toggle('fa-chevron-down', isHidden);
          toggleIcon.classList.toggle('fa-chevron-up', !isHidden);
        }
        updateActionButtonsState();
      });
    }
  });

  // 操作按鈕（data-action：edit/lock/unlock/duplicate/print/excel/copy-summary/status/delete）
  container.querySelectorAll('.pallet-plan-action-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.pallet-plan-card');
      if (!card) return;
      handlePlanAction(Number(card.dataset.planId), btn.dataset.action);
    });
  });

  // More dropdown 內的操作按鈕
  container.querySelectorAll('.pallet-more-dropdown button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.pallet-plan-card');
      if (!card) return;
      handlePlanAction(Number(card.dataset.planId), btn.dataset.action);
    });
  });

  // 明細移出按鈕
  container.querySelectorAll('.remove-item-btn[data-action="remove-item"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.pallet-plan-card');
      if (!card) return;
      const planItemId = Number(btn.dataset.planItemId);
      handleRemoveItem(Number(card.dataset.planId), planItemId);
    });
  });

  // Contour chip
  container.querySelectorAll('.pallet-contour-chip[data-contour-code]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      import('./api.js').then(({ searchContours }) => {
        searchContours(chip.dataset.contourCode).then(results => {
          if (results.length) showContourPreview(results[0].filename);
        });
      });
    });
  });
}

// ===== 動態更新中間按鈕啟用狀態 =====
export function updateActionButtonsState() {
  const addBtn = document.getElementById('btn-pallet-add-selected');
  const removeBtn = document.getElementById('btn-pallet-remove-selected');
  if (!addBtn || !removeBtn) return;

  const hasBookingsSelected = getSelectedBookingIds().size > 0;
  const targetPlanId = getSelectedPlanId();
  const targetPlan = getPlans().find(p => p.id === targetPlanId);
  const hasDraftTarget = !!(targetPlan && targetPlan.status === 'draft');
  const hasTargetItemsSelected = !!(targetPlanId && getSelectedPlanItemIds(targetPlanId).size > 0);

  addBtn.disabled = !(hasBookingsSelected && hasDraftTarget);
  removeBtn.disabled = !(hasDraftTarget && hasTargetItemsSelected);

  // 目標顯示
  const targetEl = document.getElementById('pallet-target-plan-display');
  if (targetEl) {
    if (!hasDraftTarget) {
      targetEl.textContent = '';
      targetEl.dataset.hasTarget = '0';
    } else {
      targetEl.textContent = `目標：${targetPlan.plan_no}${targetPlan.flight_no ? ' ✈️ ' + targetPlan.flight_no : ''}`;
      targetEl.dataset.hasTarget = '1';
    }
  }
}

// ===== Plan 操作分派 =====
async function handlePlanAction(planId, action) {
  const plan = getPlans().find(p => p.id === planId);
  if (!plan) return;

  switch (action) {
    case 'more-toggle':
      // 由 setupMoreMenus 處理 dropdown 開關
      return;
    case 'close-plan':
      // 「✕」→ 隱藏此打板計劃（可從搜尋重新開啟）
      closePlan(planId);
      renderPlans();
      break;
    case 'arrow-toggle': {
      const collapsed = isPlanCollapsed(planId);
      if (collapsed) {
        togglePlanCollapsed(planId);
        setExpandedPlanId(planId);
        await loadPlanDetail(planId);
      } else {
        togglePlanCollapsed(planId);
        setExpandedPlanId(null);
        renderPlans();
      }
      break;
    }
    case 'edit': {
      if (plan.status !== 'draft') {
        alert('計劃已上鎖/完成，請先解鎖再編輯');
        return;
      }
      showPlanModal(plan, { onSaved: async (savedPlan, isEdit) => {
        // 新增時自動展開
        if (!isEdit) {
          togglePlanCollapsed(savedPlan.id);
          setExpandedPlanId(savedPlan.id);
        }
        await afterPlanChange();
      }});
      break;
    }
    case 'lock': {
      if (!confirm(`確定鎖定計劃 ${plan.plan_no}？\n鎖定後左欄的 MAWB 將不再顯示，需解鎖才能修改。`)) return;
      try {
        await updatePlan(planId, { status: 'locked' });
        await afterPlanChange();
        alert('🔒 計劃已鎖定');
      } catch (err) { alert(err.message); }
      break;
    }
    case 'unlock': {
      if (!confirm(`解鎖計劃 ${plan.plan_no} 回「草稿」？`)) return;
      try {
        await updatePlan(planId, { status: 'draft' });
        await afterPlanChange();
        alert('🔓 已解鎖回草稿');
      } catch (err) { alert(err.message); }
      break;
    }
    case 'duplicate': {
      const copyItems = confirm(`複製計劃 ${plan.plan_no}？\n按「確定」→ 連同明細一齊複製\n按「取消」→ 只複製計劃資料（不含 MAWB）`);
      try {
        const newPlan = await duplicatePlan(planId, copyItems);
        await loadPlans();
        if (copyItems) {
          togglePlanCollapsed(newPlan.id);
          setExpandedPlanId(newPlan.id);
          await loadPlanDetail(newPlan.id);
        }
        await loadBookings();
      } catch (err) { alert(err.message); }
      break;
    }
    case 'print': {
      if (isPlanCollapsed(planId)) {
        togglePlanCollapsed(planId);
        setExpandedPlanId(planId);
        await loadPlanDetail(planId);
      }
      setTimeout(() => window.print(), 300);
      break;
    }
    case 'excel': {
      exportPlanExcel(planId);
      break;
    }
    case 'copy-summary': {
      try {
        const detail = await fetchPlanDetail(planId);
        const text = buildPlanTextSummary(detail, detail.items);
        await navigator.clipboard.writeText(text);
        alert('📋 計劃總結已複製到剪貼簿');
      } catch (err) {
        alert('複製失敗：' + err.message);
      }
      break;
    }
    case 'status': {
      showStatusModal(plan, { onChanged: afterPlanChange });
      break;
    }
    case 'delete': {
      // 單一但更明確的確認（避免誤刪）
      if (!confirm(`⚠️ 確定刪除計劃 ${plan.plan_no}？\n\n其內所有 MAWB 將移回左欄。\n此操作不可復原！`)) return;
      try {
        await deletePlan(planId);
        clearSelectedPlanItems();
        await afterPlanChange();
      } catch (err) { alert(err.message); }
      break;
    }
  }
}

// ===== 移出單一明細 =====
async function handleRemoveItem(planId, planItemId) {
  try {
    await removeItemFromPlan(planId, planItemId);
    await afterPlanChange();
    await loadBookings();
  } catch (err) {
    alert(err.message);
  }
}

// ===== 批量加入所選 =====
export async function handleAddSelectedToPlan(planId) {
  const selectedIds = [...getSelectedBookingIds()];
  if (!selectedIds.length) return alert('請先在左欄選擇 MAWB');
  let targetId = planId;
  if (!targetId) {
    targetId = getSelectedPlanId();
  }
  if (!targetId) return alert('請先點擊一個「草稿」打板計劃作為目標');
  const targetPlan = getPlans().find(p => p.id === targetId);
  if (!targetPlan || targetPlan.status !== 'draft') {
    return alert('目標計劃已上鎖/完成，請選擇其他草稿計劃');
  }
  try {
    await addItemsToPlan(targetId, selectedIds);
    clearSelectedBookings();
    await afterPlanChange();
    await loadBookings();
  } catch (err) {
    alert(err.message);
  }
}

// ===== 批量移出所選 =====
export async function handleRemoveSelectedFromPlan(planId) {
  let targetId = planId;
  if (!targetId) {
    targetId = getSelectedPlanId();
  }
  if (!targetId) return alert('請先點擊一個「草稿」打板計劃作為目標');
  const set = getSelectedPlanItemIds(targetId);
  const items = [...set];
  if (!items.length) return alert('請先在計劃明細中選擇要移出的 MAWB');
  if (!confirm(`確定將 ${items.length} 筆 MAWB 移出該計劃？`)) return;
  try {
    for (const planItemId of items) {
      await removeItemFromPlan(targetId, planItemId);
    }
    set.clear();
    await afterPlanChange();
    await loadBookings();
  } catch (err) {
    alert(err.message);
  }
}

// ===== 展開指定 Plan（供拖曳目標使用） =====
export async function expandPlan(planId) {
  if (isPlanCollapsed(planId)) togglePlanCollapsed(planId);
  setExpandedPlanId(planId);
  await loadPlanDetail(planId);
}

// ===== 資料變更後：重整 Plans + 明細 =====
export async function afterPlanChange() {
  const expandedId = getExpandedPlanId();
  if (expandedId) {
    setExpandedPlanId(expandedId);
    await loadPlanDetail(expandedId);
  }
  await loadPlans();
  updateActionButtonsState();
}

// ===== 載入單一 Plan 明細 =====
export async function loadPlanDetail(planId) {
  try {
    const detail = await fetchPlanDetail(planId);
    setPlanItems(planId, detail.items);
    // 更新 Plans 列表中的 totals
    const plans = getPlans();
    const idx = plans.findIndex(p => p.id === planId);
    if (idx >= 0) {
      plans[idx] = { ...plans[idx], totals: detail.totals };
      setPlans(plans);
    }
    renderPlans();
  } catch (err) {
    console.error('[pallet] 載入 Plan 明細失敗:', err);
  }
}

// ===== Excel 匯出（Q28-B） =====
export async function exportPlanExcel(planId) {
  try {
    const detail = await fetchPlanDetail(planId);
    if (typeof XLSX === 'undefined') {
      alert('Excel 匯出功能未載入（需要 XLSX 函式庫）');
      return;
    }
    const aoa = [
      ['打板計劃', detail.plan_no],
      ['公司名稱', detail.company_name || ''],
      ['航班資料 (FLT#)', `${detail.flight_no || ''} / ${detail.flight_date || ''}`],
      ['目的地機場', detail.arrival_airport || ''],
      ['板型規格', detail.contour_text || ''],
      ['策劃人', detail.planner || ''],
      ['狀態', detail.status],
      [],
      ['MAWB', 'HAWB', 'CLIENT', 'DEST', 'PCS', 'G.WT (kg)', 'V.WT (kg)', 'CBM', 'SPL', 'REMARK']
    ];
    (detail.items || []).forEach(it => {
      aoa.push([
        it.mawb || '', it.hawb || '', it.client || '', it.dest || '',
        it.pcs || 0, it.gross_weight || 0, it.volume_weight || 0, it.cbm || 0,
        it.spl || '', it.remark || ''
      ]);
    });
    const totals = detail.totals || {};
    aoa.push([]);
    aoa.push(['總計', '', '', '', totals.pcs || 0, totals.gross_weight || 0, totals.volume_weight || 0, totals.cbm || 0, '', '']);
    if (detail.remarks) {
      aoa.push([]);
      aoa.push(['備註', detail.remarks]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '打板計劃');
    XLSX.writeFile(wb, `${detail.plan_no}.xlsx`);
  } catch (err) {
    alert('匯出失敗：' + err.message);
  }
}