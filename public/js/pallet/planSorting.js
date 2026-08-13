// ===== 打板計劃：MAWB 顯示層排序 + 卡片附屬互動 =====

// { [planId]: 'asc' | 'desc' | null }
const mawbSortState = {};

export function getMawbSort(planId) {
  return mawbSortState[planId] || null;
}

// 循環切換：無排序 → 小到大(asc) → 大到小(desc) → 無排序
export function cycleMawbSort(planId) {
  const current = mawbSortState[planId] || null;
  const next = current === null ? 'asc' : current === 'asc' ? 'desc' : null;
  mawbSortState[planId] = next;
  return next;
}

// 依方向排序（不修改原陣列）
export function sortItemsByMawb(items, dir) {
  if (!dir || !items) return items;
  return [...items].sort((a, b) => {
    const ma = String(a.mawb || '').trim();
    const mb = String(b.mawb || '').trim();
    const cmp = ma.localeCompare(mb, undefined, { numeric: true });
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ===== 事件綁定：排序按鈕 + 重複警告橫幅 =====
// onReorder：排序變更後需重繪卡片（由外部傳入 renderPlans）
export function bindPlanCardExtras(container, onReorder) {
  // MAWB 排序按鈕
  container.querySelectorAll('.pallet-mawb-sort-btn[data-action="sort-mawb"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.pallet-plan-card');
      if (!card) return;
      cycleMawbSort(Number(card.dataset.planId));
      onReorder();
    });
  });

  // 方案 C：重複警告橫幅展開/收合（純 DOM 切換，不需重繪）
  container.querySelectorAll('.pallet-plan-dup-banner[data-action="toggle-dup-banner"]').forEach(banner => {
    banner.addEventListener('click', (e) => {
      e.stopPropagation();
      const list = banner.nextElementSibling;
      const icon = banner.querySelector('i');
      if (!list) return;
      const isHidden = list.hidden;
      list.hidden = !isHidden;
      if (icon) {
        icon.classList.toggle('fa-chevron-down', isHidden);
        icon.classList.toggle('fa-chevron-up', !isHidden);
      }
    });
  });
}