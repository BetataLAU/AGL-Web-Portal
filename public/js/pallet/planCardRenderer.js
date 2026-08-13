// ===== 打板計劃：Plan 卡片 / Body HTML 渲染 =====
// 職責：僅負責把 plan 資料轉為 HTML 字串，不處理事件

import {
  getPlanItems, getSelectedPlanItemIds, getSelectedPlanId, getPlans, isPlanClosed
} from './state.js';
import {
  STATUS_LABEL, formatNumber, formatWeight, splBadgeClass, getFlightCountdown
} from './formatters.js';
import { getMawbSort, sortItemsByMawb } from './planSorting.js';

// ===== 跨板重複：過濾非取消的 Plan 引用 =====
function activePlanRefs(item) {
  return (item.plan_refs || []).filter(ref => ref.status !== 'cancelled');
}

// 方案 A：行內黃色警告標籤（重複存在於 2 板或以上才顯示）
function dupWarnHtml(refs) {
  if (refs.length < 2) return '';
  const tooltip = `此 MAWB 同時存在於 ${refs.length} 個打板計劃：&#10;${refs.map(r => `• ${escapeHtml(r.plan_no)}（${escapeHtml(r.status)}）`).join('&#10;')}`;
  return `<span class="pallet-multi-plan-warn" title="${tooltip}">⚠️${refs.length}板</span>`;
}

// ===== 單張 Plan Card HTML =====
export function renderPlanCard(plan, collapsed) {
  // 已被「✕ 關閉」隱藏的 Plan → 不渲染
  if (isPlanClosed(plan.id)) return '';
  const statusClass = `status-${plan.status}`;
  const statusBadge = `<span class="pallet-status-badge ${plan.status}">${STATUS_LABEL[plan.status] || plan.status}</span>`;

  const countdown = getFlightCountdown(plan);
  const isUrgent = countdown && countdown.urgent;
  const countdownHtml = countdown
    ? `<span class="pallet-plan-countdown ${isUrgent ? 'urgent' : ''}" title="${escapeHtml(countdown.text)}">${escapeHtml(countdown.text)}</span>`
    : '';

  const totals = plan.totals || {};
  const overweight = plan.max_gross_weight && Number(totals.gross_weight) > Number(plan.max_gross_weight);
  const overweightHtml = overweight
    ? `<span class="pallet-plan-overweight" title="毛重已超過最大承重上限">⚠️ 超重 +${formatWeight(Number(totals.gross_weight) - Number(plan.max_gross_weight))} kg</span>`
    : '';

  // ===== header meta 項目（航班 / 目的地 / 倒數 / 超重，以 | 分隔） =====
  const headerMetaParts = [
    `<span class="header-flight" title="航班資料">✈️ ${escapeHtml(plan.flight_no || '-')} ${escapeHtml(formatterShortDate(plan.flight_date))}</span>`,
    `<span class="header-dest" title="目的地機場">📍 ${escapeHtml(plan.arrival_airport || '-')}</span>`
  ];
  if (countdownHtml) headerMetaParts.push(countdownHtml);
  if (overweightHtml) headerMetaParts.push(overweightHtml);
  const headerMetaHtml = headerMetaParts.map((part, i) => (i > 0 ? `<span class="header-meta-sep">|</span>${part}` : part)).join('');

  const isDraft = plan.status === 'draft';
  const showBody = !collapsed;
  const isSelected = getSelectedPlanId() === plan.id;   // 已選定高亮

  let bodyHtml = '';
  if (showBody) {
    bodyHtml = renderPlanBody(plan);
  }

  return `
    <div class="pallet-plan-card ${statusClass} ${collapsed ? 'collapsed' : ''} ${isSelected ? 'is-selected-plan' : ''}" data-plan-id="${plan.id}">
      <div class="pallet-plan-header">
        <div class="pallet-plan-header-left">
          <button type="button" class="pallet-plan-arrow" data-action="arrow-toggle" title="${collapsed ? '展開' : '收合'}">
            <i class="fa-solid ${collapsed ? 'fa-chevron-right' : 'fa-chevron-down'}"></i>
          </button>
          <span class="pallet-plan-title">
            <span class="plan-no">${escapeHtml(plan.plan_no)}</span>
            ${statusBadge}
          </span>
          ${isSelected ? '<span class="pallet-selected-flag">目標</span>' : ''}
          <span class="pallet-plan-header-meta">
            ${headerMetaHtml}
          </span>
        </div>
        <div class="pallet-plan-actions">
          <div class="pallet-more-menu action-menu-wrapper" data-more-menu>
            <button type="button" class="pallet-plan-action-btn" data-action="more-toggle" title="更多操作">
              <i class="fa-solid fa-ellipsis"></i>
            </button>
            <div class="pallet-more-dropdown hidden">
              ${isDraft ? `
                <button type="button" data-action="lock" title="鎖定後不可修改"><i class="fa-solid fa-lock"></i> 上鎖</button>
              ` : `
                <button type="button" data-action="unlock" title="解鎖回草稿"><i class="fa-solid fa-unlock"></i> 解鎖</button>
              `}
              <button type="button" data-action="duplicate" title="複製計劃"><i class="fa-solid fa-copy"></i> 複製</button>
              <button type="button" data-action="print" title="列印"><i class="fa-solid fa-print"></i> 列印</button>
              <button type="button" data-action="excel" title="匯出 Excel"><i class="fa-solid fa-file-excel"></i> 匯出 Excel</button>
              <button type="button" data-action="copy-summary" title="複製總結"><i class="fa-solid fa-clipboard"></i> 複製總結</button>
              <button type="button" data-action="status" title="變更狀態"><i class="fa-solid fa-flag"></i> 變更狀態</button>
            </div>
          </div>
          ${isDraft ? `
            <button type="button" class="pallet-plan-action-btn primary-action" data-action="edit" title="編輯計劃"><i class="fa-solid fa-pen"></i></button>
          ` : ''}
          <button type="button" class="pallet-plan-action-btn close-plan-btn" data-action="close-plan" title="關閉此打板計劃（可從搜尋重新開啟）"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      ${showBody ? `<div class="pallet-plan-body">${bodyHtml}</div>` : ''}
      <div class="pallet-plan-footer">
        <button type="button" class="pallet-plan-action-btn pallet-plan-delete-btn danger" data-action="delete" title="刪除計劃（不可復原）"><i class="fa-solid fa-trash"></i> 刪除</button>
      </div>
    </div>
  `;
}

// ===== Plan Body（重複警告橫幅 + 摘要 + 資訊 Accordion + 備註 + 明細表 + 總計） =====
function renderPlanBody(plan) {
  const items = getPlanItems(plan.id);
  const isDraft = plan.status === 'draft';
  const selectedSet = getSelectedPlanItemIds(plan.id);
  const sortDir = getMawbSort(plan.id);
  const sortedItems = sortItemsByMawb(items, sortDir);
  const contourChip = plan.contour_code
    ? `<span class="pallet-contour-chip" data-contour-code="${escapeHtml(plan.contour_code)}" title="點擊查看 Contour 圖片">🖼 ${escapeHtml(plan.contour_code)}</span>`
    : '';

  // ===== 方案 C：卡片內重複警告橫幅（展開時顯示於 Body 頂部） =====
  const dupItems = sortedItems.filter(it => activePlanRefs(it).length >= 2);
  const dupBannerHtml = dupItems.length
    ? `
    <div class="pallet-plan-dup-banner" data-action="toggle-dup-banner" title="點擊展開/收合重複 MAWB 清單">
      <span>⚠️ 本板有 <b>${dupItems.length}</b> 個 MAWB 亦存在於其他打板計劃</span>
      <i class="fa-solid fa-chevron-down"></i>
    </div>
    <div class="pallet-plan-dup-list" hidden>
      ${dupItems.map(it => {
        const otherRefs = activePlanRefs(it).filter(r => r.plan_id !== plan.id);
        return `<div class="pallet-plan-dup-item">
          <span class="dup-mawb">${escapeHtml(it.mawb || '-')}</span>
          <span class="dup-refs">${otherRefs.map(r => `<span class="dup-ref">${escapeHtml(r.plan_no)}（${escapeHtml(r.status)}）</span>`).join('')}</span>
        </div>`;
      }).join('')}
    </div>`
    : '';

  const rows = sortedItems.length ? sortedItems.map((it, idx) => {
    const selected = selectedSet.has(it.plan_item_id);
    const splClass = splBadgeClass(it.spl);
    const splHtml = it.spl
      ? `<span class="pallet-spl-badge ${splClass}">${escapeHtml(it.spl)}</span>`
      : `<span class="t-subtle">-</span>`;
    const refs = activePlanRefs(it);
    const dupHtml = dupWarnHtml(refs);
    return `
      <tr data-plan-item-id="${it.plan_item_id}" class="${selected ? 'selected-row' : ''}" ${isDraft ? 'draggable="true"' : ''}>
        <td class="t-subtle drag-cell">${isDraft ? '<span class="drag-handle" title="可拖曳到其他打板計劃或左欄">⠿</span>' : ''}${idx + 1}</td>
        <td class="mawb-cell">${escapeHtml(it.mawb || '-')}${dupHtml}</td>
        <td class="t-value">${escapeHtml(it.hawb || '-')}</td>
        <td class="t-value">${escapeHtml(truncateText(it.client, 18))}</td>
        <td class="t-value">${escapeHtml(it.dest || '-')}</td>
        <td class="num">${formatNumber(it.pcs, 0)}</td>
        <td class="num">${formatWeight(it.gross_weight)}</td>
        <td class="num">${formatWeight(it.volume_weight)}</td>
        <td class="num">${formatNumber(it.cbm, 2)}</td>
        <td>${splHtml}</td>
        <td class="cell-remark" title="${escapeHtml(it.remark || '')}">${it.remark ? escapeHtml(it.remark) : '<span class="t-subtle">-</span>'}</td>
        ${isDraft ? `<td><button type="button" class="pallet-btn pallet-btn-sm remove-item-btn" data-action="remove-item" data-plan-item-id="${it.plan_item_id}">移出</button></td>` : ''}
      </tr>
    `;
  }).join('') : `<tr><td colspan="12" class="pallet-empty-row">尚無 MAWB，拖曳或使用按鈕加入</td></tr>`;

  const totals = plan.totals || {};

  // ===== meta summary 次要項目（策劃 / 板型規格 / 上限，以 | 分隔） =====
  const metaParts = [];
  if (plan.planner) metaParts.push(`<span class="meta-planner">策劃：${escapeHtml(plan.planner)}</span>`);
  if (plan.contour_text) metaParts.push(`<span class="meta-contour">板型規格：${escapeHtml(plan.contour_text)}</span>`);
  if (plan.max_gross_weight) metaParts.push(`<span class="meta-max-weight">上限 ${formatWeight(plan.max_gross_weight)}kg</span>`);
  const metaItemsHtml = metaParts.map((part, i) => (i > 0 ? `<span class="meta-sep">|</span>${part}` : part)).join('');

  // ===== MAWB 排序表頭 =====
  const sortIcon = sortDir === 'asc' ? 'fa-sort-up' : sortDir === 'desc' ? 'fa-sort-down' : 'fa-sort';
  const sortTitle = sortDir === 'asc' ? '目前：小到大 — 點擊改為大到小'
    : sortDir === 'desc' ? '目前：大到小 — 點擊取消排序'
    : '點擊排序 MAWB（小到大）';

  return `
    ${dupBannerHtml}
    <div class="pallet-plan-meta-summary" data-action="info-toggle" title="點擊展開/收合詳細資訊">
      <span class="meta-company">${escapeHtml(plan.company_name || '-')}</span>
      ${metaItemsHtml}
      <span class="pallet-plan-info-toggle">
        <i class="fa-solid fa-chevron-down"></i> 詳情
      </span>
    </div>
    <div class="pallet-plan-info-grid" hidden>
      <div class="pallet-plan-info-item"><span class="label">公司：</span><span class="value">${escapeHtml(plan.company_name || '-')}</span></div>
      <div class="pallet-plan-info-item"><span class="label">航班：</span><span class="value">${escapeHtml(plan.flight_no || '-')} / ${escapeHtml(plan.flight_date || '')}</span></div>
      <div class="pallet-plan-info-item"><span class="label">目的地機場：</span><span class="value">${escapeHtml(plan.arrival_airport || '-')}</span></div>
      <div class="pallet-plan-info-item"><span class="label">板型規格：</span><span class="value">${escapeHtml(plan.contour_text || '-')} ${contourChip}</span></div>
      <div class="pallet-plan-info-item"><span class="label">策劃人：</span><span class="value">${escapeHtml(plan.planner || '-')}</span></div>
      ${plan.max_gross_weight ? `<div class="pallet-plan-info-item"><span class="label">最大承重：</span><span class="value">${formatWeight(plan.max_gross_weight)} kg</span></div>` : ''}
      ${plan.handover_hours ? `<div class="pallet-plan-info-item"><span class="label">交板時間：</span><span class="value">起飛前 ${plan.handover_hours} 小時</span></div>` : ''}
    </div>
    ${plan.remarks ? `<div class="pallet-plan-remarks"><span class="remarks-label">REMARKS：</span>${escapeHtml(plan.remarks)}</div>` : ''}
    <div class="pallet-items-table-wrap">
      <table class="pallet-items-table">
        <thead>
          <tr>
            <th>#</th>
            <th class="mawb-th">
              <button type="button" class="pallet-mawb-sort-btn" data-action="sort-mawb" title="${sortTitle}">
                MAWB <i class="fa-solid ${sortIcon}"></i>
              </button>
            </th>
            <th>HAWB</th>
            <th>CLIENT</th>
            <th>DEST</th>
            <th class="num">PCS</th>
            <th class="num">G.WT</th>
            <th class="num">V.WT</th>
            <th class="num">CBM</th>
            <th>SPL</th>
            <th>REMARK</th>
            ${isDraft ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr class="pallet-total-row">
            <td class="total-label" colspan="5">總計（<b>${items.length}</b> 單）</td>
            <td class="num"><b>${formatNumber(totals.pcs, 0)}</b></td>
            <td class="num"><b>${formatWeight(totals.gross_weight)}</b></td>
            <td class="num"><b>${formatWeight(totals.volume_weight)}</b></td>
            <td class="num"><b>${formatNumber(totals.cbm, 2)}</b></td>
            <td class="t-subtle">—</td>
            <td class="t-subtle">—</td>
            ${isDraft ? '<td></td>' : ''}
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

// 工具：取日期前 10 字元（yyyy-mm-dd）
function formatterShortDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

// 工具：文字截斷（配合 tabindex/CSS ellipsis）
function truncateText(text, maxLen) {
  if (!text) return '-';
  const s = String(text);
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}