// ===== 打板計劃：Plan 卡片 / Body HTML 渲染 =====
// 職責：僅負責把 plan 資料轉為 HTML 字串，不處理事件

import {
  getPlanItems, getSelectedPlanItemIds, getSelectedPlanId
} from './state.js';
import {
  STATUS_LABEL, formatNumber, formatWeight, splBadgeClass, getFlightCountdown
} from './formatters.js';

// ===== 單張 Plan Card HTML =====
export function renderPlanCard(plan, collapsed) {
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
    ? `<span class="pallet-plan-overweight" title="毛重已超過最大承重上限">⚠️ 超重 ${formatWeight(totals.gross_weight)} / 上限 ${formatWeight(plan.max_gross_weight)} kg</span>`
    : '';

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
          <span class="pallet-plan-header-meta">
            <span class="header-flight" title="航班資料">✈️ ${escapeHtml(plan.flight_no || '-')} ${escapeHtml(formatterShortDate(plan.flight_date))}</span>
            <span class="header-dest" title="目的地機場">📍 ${escapeHtml(plan.arrival_airport || '-')}</span>
            ${countdownHtml}
            ${overweightHtml}
            <span class="h-stats">
              <span>PCS <b>${formatNumber(totals.pcs, 0)}</b></span>
              <span>G.WT <b>${formatWeight(totals.gross_weight)}</b>kg</span>
              <span>CBM <b>${formatNumber(totals.cbm, 2)}</b></span>
            </span>
          </span>
          ${isSelected ? '<span class="pallet-selected-flag">目標</span>' : ''}
        </div>
        <div class="pallet-plan-actions">
          ${isDraft ? `
            <button type="button" class="pallet-plan-action-btn primary-action" data-action="edit" title="編輯計劃"><i class="fa-solid fa-pen"></i></button>
          ` : ''}
          <div class="pallet-more-menu" data-more-menu>
            <button type="button" class="pallet-plan-action-btn" data-action="more-toggle" title="更多操作">
              <i class="fa-solid fa-ellipsis"></i>
            </button>
            <div class="pallet-more-dropdown">
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
          <button type="button" class="pallet-plan-action-btn danger" data-action="delete" title="刪除計劃"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      ${showBody ? `<div class="pallet-plan-body">${bodyHtml}</div>` : ''}
    </div>
  `;
}

// ===== Plan Body（摘要 + 資訊 Accordion + 備註 + 明細表 + 總計） =====
function renderPlanBody(plan) {
  const items = getPlanItems(plan.id);
  const isDraft = plan.status === 'draft';
  const selectedSet = getSelectedPlanItemIds(plan.id);
  const contourChip = plan.contour_code
    ? `<span class="pallet-contour-chip" data-contour-code="${escapeHtml(plan.contour_code)}" title="點擊查看 Contour 圖片">🖼 ${escapeHtml(plan.contour_code)}</span>`
    : '';

  const rows = items.length ? items.map((it, idx) => {
    const selected = selectedSet.has(it.plan_item_id);
    const splClass = splBadgeClass(it.spl);
    const splHtml = it.spl
      ? `<span class="pallet-spl-badge ${splClass}">${escapeHtml(it.spl)}</span>`
      : `<span class="t-subtle">-</span>`;
    return `
      <tr data-plan-item-id="${it.plan_item_id}" class="${selected ? 'selected-row' : ''}">
        <td class="t-subtle">${idx + 1}</td>
        <td class="mawb-cell">${escapeHtml(it.mawb || '-')}</td>
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

  return `
    <div class="pallet-plan-meta-summary" data-action="info-toggle" title="點擊展開/收合詳細資訊">
      <span class="meta-company">${escapeHtml(plan.company_name || '-')}</span>
      ${plan.planner ? `<span class="meta-planner">策劃：${escapeHtml(plan.planner)}</span>` : ''}
      ${plan.max_gross_weight ? `<span class="meta-max-weight">上限 ${formatWeight(plan.max_gross_weight)}kg</span>` : ''}
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
            <th>MAWB</th>
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
      </table>
    </div>
    <div class="pallet-plan-total">
      <div class="pallet-plan-total-inner ${isDraft ? 'has-remove-col' : ''}">
        <span class="total-label">總計</span>
        <span class="total-value"><b>${items.length}</b> 單</span>
        <span class="total-value t-subtle">—</span>
        <span class="total-value t-subtle">—</span>
        <span class="total-value t-subtle">—</span>
        <span class="total-value num"><b>${formatNumber(totals.pcs, 0)}</b></span>
        <span class="total-value num"><b>${formatWeight(totals.gross_weight)}</b></span>
        <span class="total-value num"><b>${formatWeight(totals.volume_weight)}</b></span>
        <span class="total-value num"><b>${formatNumber(totals.cbm, 2)}</b></span>
        <span class="total-value t-subtle">—</span>
        <span class="total-value t-subtle">—</span>
        ${isDraft ? '<span class="total-value"></span>' : ''}
      </div>
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