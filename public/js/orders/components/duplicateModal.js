// ===== 重複訂單浮動卡片 =====
// escapeHtml 為 window 全域函式（main.js）；openModal 為 window 全域函式（utils/modal.js）
// displayMawb 為 window 全域函式（utils/mawb-utils.js）；formatDateTime 為 window 全域函式（utils/datetime-utils.js）

import { setDuplicateConfirmed } from '../state.js';

// 顯示重複訂單浮動卡片
// mode: 'submit' = 提交時（按「仍然繼續」會直接提交已收集的資料）；'blur' = 離開欄位即時檢查（按「知道了」只關閉卡片）
// onConfirm: 可選，submit 模式按下「仍然繼續」時呼叫（用於直接提交已收集的 data，避免重跑 submit handler）
export function showDuplicateCard(orders, mode = 'submit', onConfirm = null) {
  // 移除舊卡片
  document.querySelectorAll('.duplicate-order-modal').forEach(el => el.remove());

  if (!orders || !orders.length) return;
  const isBlurMode = mode === 'blur';
  // 是否已選「需要提貨的客戶」；未選客戶時 pickup_no 重複只是提醒（不同客戶可用同號）
  const customerCompanyId = (document.getElementById('order-customer-id')?.value || '').trim();
  const isPickupReminderOnly = isBlurMode && !customerCompanyId;

  const entries = orders.map(order => {
    // 找出哪個欄位重複
    const mawbVal = (document.getElementById('order-mawb')?.value || '').trim();
    const hawbVal = (document.getElementById('order-hawb')?.value || '').trim();
    const pickupVal = (document.getElementById('order-pickup-no')?.value || '').trim();
    const matchFields = [];
    if (mawbVal && displayMawb(order.mawb) === displayMawb(mawbVal)) matchFields.push('MAWB#');
    if (hawbVal && order.hawb === hawbVal) matchFields.push('HAWB#');
    if (pickupVal && order.pickup_no === pickupVal) matchFields.push('客戶提貨號');

    // 沒有任何欄位真正與輸入值重複 → 不顯示（避免無重複的記錄混入）
    if (matchFields.length === 0) return null;

    // 顯示時優先使用客戶公司名稱（後端已 join 回傳）
    const companyName = order.customer_company_name
      || (order.order_type === 'delivery'
        ? (order.delivery_company_name || order.pickup_company_name || '-')
        : (order.pickup_company_name || order.delivery_company_name || '-'));

    // 只顯示有重複的欄位；不重複的欄位顯示「─」
    const mawbLabel = matchFields.includes('MAWB#')
      ? `<span class="duplicate-order-blink">${escapeHtml(displayMawb(order.mawb))}</span>`
      : '<span class="duplicate-order-nomatch">─</span>';
    const hawbLabel = matchFields.includes('HAWB#')
      ? `<span class="duplicate-order-blink">${escapeHtml(order.hawb || '-')}</span>`
      : '<span class="duplicate-order-nomatch">─</span>';
    const pickupLabel = matchFields.includes('客戶提貨號')
      ? `<span class="duplicate-order-blink">${escapeHtml(order.pickup_no || '-')}</span>`
      : '<span class="duplicate-order-nomatch">─</span>';

    return `
      <div class="duplicate-order-item">
        <div class="duplicate-order-head">
          <span class="duplicate-order-no duplicate-order-blink">${escapeHtml(order.order_no)}</span>
          <span class="duplicate-order-badge">${escapeHtml(matchFields.join('、'))}重複</span>
        </div>
        <div class="duplicate-order-meta">
          <span>${isPickupReminderOnly ? '🏢 ' : ''}${escapeHtml(companyName)}</span>
          <span>${formatDateTime(order.created_at)}</span>
        </div>
        <div class="duplicate-order-meta">
          <span>MAWB: ${mawbLabel}</span>
          <span>HAWB: ${hawbLabel}</span>
          <span>提貨: ${pickupLabel}</span>
        </div>
        <div class="duplicate-order-meta">
          <span>${escapeHtml(order.cargo_desc || '-')}</span>
          <span>${order.quantity || 0}件 / ${order.weight_kg || 0}KG / ${order.cbm || 0}CBM</span>
        </div>
      </div>
    `;
  }).filter(Boolean).join('');

  // 未選客戶時：顯示提醒說明（不同客戶可以使用相同提貨號）
  const reminderHtml = isPickupReminderOnly
    ? `<div class="duplicate-order-reminder">ℹ️ 尚未選擇「需要提貨的客戶」。此提貨號曾在以下公司出現；<strong>不同客戶可以使用相同提貨號</strong>，請確認後繼續。選擇客戶後如屬同一客戶，提交時會再精確檢查。</div>`
    : '';

  openModal({
    title: isPickupReminderOnly ? '🔔 提貨號曾被使用（提醒）' : '⚠️ 發現重複訂單',
    body: `${reminderHtml}<div class="duplicate-order-list">${entries}</div>`,
    className: 'duplicate-order-modal',
    actions: [
      {
        label: isBlurMode ? '🔍 知道了，繼續填寫' : '✅ 仍然繼續',
        className: 'pill btn-primary',
        onClick: (modal) => {
          if (isBlurMode) {
            // blur 模式：只關閉卡片，不觸發提交，用戶可繼續填寫
            modal.close();
            return;
          }
          // submit 模式：關閉卡片並直接提交已收集的資料（onConfirm）
          modal.close();
          if (typeof onConfirm === 'function') {
            onConfirm();
          } else {
            // 沒有 onConfirm（例如 blur check 誤觸 submit）→ 退回重新觸發提交
            setDuplicateConfirmed(true);
            const submitBtn = document.querySelector('.orders-submit-btn');
            if (submitBtn) submitBtn.click();
          }
        }
      },
      {
        label: '✏️ 返回修改',
        className: 'pill',
        onClick: (modal) => modal.close()
      }
    ]
  });
}