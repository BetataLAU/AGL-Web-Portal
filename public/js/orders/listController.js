// ===== 訂單列表 Controller（列表/搜尋/詳情/複製/刪除） =====
// escapeHtml 為 window 全域函式（main.js）
// displayMawb / isLateMawb / formatMawb 為 window 全域函式（utils/mawb-utils.js）
// formatDateTime / formatPickupDatetime / getTodayDateStr 為 window 全域函式（utils/datetime-utils.js）
// debounce 為 window 全域函式（main.js）
// 註：與 formController.js 存在執行期才使用的循環依賴（ES Module 支援，安全）

import { ORDER_TYPE_LABEL, STATUS_LABEL } from './constants.js';
import {
  setOrdersData,
  getOrdersData,
  getTodayPickupActive,
  setTodayPickupActive,
  getDateFilterValue,
  setDateFilterValue
} from './state.js';
import {
  fetchOrdersList,
  fetchOrder,
  updateOrder,
  deleteOrder as deleteOrderApi,
  createOrder
} from './api.js';
import { formatPowerItems, buildOrderSummary, buildOrderSummaryText } from './formatters.js';
import { renderNewOrderForm, loadOrderToForm, sendOrderEmail } from './formController.js';

// ===== Tab 切換 =====
export function setupOrdersTabs() {
  const tabs = document.querySelectorAll('.orders-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.orders-tab-panel').forEach(panel => panel.classList.remove('active'));
      const target = document.getElementById(`orders-tab-${tab.dataset.tab}`);
      if (target) target.classList.add('active');

      // 切到列表時重新載入
      if (tab.dataset.tab === 'list') {
        fetchOrders();
      } else if (tab.dataset.tab === 'new') {
        renderNewOrderForm();
      }
    });
  });
}

// ===== 訂單列表 =====
export async function fetchOrders() {
  const container = document.getElementById('orders-list-container');
  if (!container) return;

  const search = document.getElementById('orders-search-input')?.value.trim() || '';
  const status = document.getElementById('orders-status-filter')?.value || '';

  try {
    const result = await fetchOrdersList({ search, status });
    setOrdersData(result);

    let visible = getOrdersData();
    // 「今天的收貨」過濾：訂單類型 = 收貨 且 提貨日期 = 今天
    if (getTodayPickupActive()) {
      const today = getTodayDateStr(); // 'YYYY-MM-DD'
      visible = getOrdersData().filter(o => {
        if (o.order_type !== 'pickup') return false;
        if (!o.pickup_datetime) return false;
        return String(o.pickup_datetime).slice(0, 10) === today;
      });
    }
    // 日期搜尋過濾：依提貨日期 pickup_datetime 篩選
    const dateFilterValue = getDateFilterValue();
    if (dateFilterValue) {
      visible = visible.filter(o => {
        if (!o.pickup_datetime) return false;
        return String(o.pickup_datetime).slice(0, 10) === dateFilterValue;
      });
    }
    renderOrdersList(visible);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(err.message)}</div>`;
  }
}

export function renderOrdersList(orders) {
  const container = document.getElementById('orders-list-container');
  if (!container) return;

  if (!orders.length) {
    container.innerHTML = '<div class="empty-state">沒有找到訂單。切換到「＋ 新建訂單」建立第一張訂單吧！</div>';
    return;
  }

  container.innerHTML = orders.map(order => {
    // 第一行：類型 + 起點 到 終點
    const fromName = order.pickup_company_name || order.pickup_company_id || '-';
    const toName = order.delivery_company_name || order.delivery_company_id || '';
    const typeLabel = ORDER_TYPE_LABEL[order.order_type] || order.order_type;
    const titleLine = toName
      ? `${typeLabel} ${escapeHtml(fromName)} 到 ${escapeHtml(toName)}`
      : `${typeLabel} ${escapeHtml(fromName)}`;
    const powerLabel = order.power_type === 'no'
      ? '<span class="orders-tag power-no">⚡ 無電</span>'
      : `<span class="orders-tag ${order.power_type === 'dry' ? 'power-dry' : 'power-lithium'}">${escapeHtml(formatPowerItems(order))}</span>`;
    const urgentTag = order.urgent === 'yes' ? '<span class="orders-tag urgent">🚨 趕機</span>' : '';

    return `
      <div class="orders-card-item" data-id="${order.id}">
        <div class="orders-card-header">
          <div class="orders-card-title">${titleLine}</div>
          <span class="order-status-badge ${escapeHtml(order.status)}" title="點擊收起卡片">${STATUS_LABEL[order.status] || order.status}</span>
        </div>
        <div class="orders-card-meta">
          <span>📅 ${formatDateTime(order.created_at)}</span>
        </div>
        <div class="orders-card-meta">
          <span>🏢 需要提貨的客戶：${escapeHtml(order.customer_company_name || '-')}</span>
        </div>
        <div class="orders-card-meta">
          <span>🧾 MAWB: ${escapeHtml(displayMawb(order.mawb))}</span>
          <span>| HAWB: ${escapeHtml(order.hawb || '-')}</span>
          <span>| DEST: ${escapeHtml(order.dest || '-')}</span>
          <span>| 提貨: ${escapeHtml(order.pickup_no || '-')}</span>
        </div>
        <div class="orders-card-meta">
          <span>📦 ${order.quantity || 0} 件 / ${order.weight_kg || 0} KG / ${order.cbm || 0} CBM</span>
        </div>
        <div class="orders-card-meta">
          ${powerLabel}
          ${urgentTag}
        </div>
        <div class="orders-card-footer">
          <span class="orders-card-order-no">流水號：${escapeHtml(order.order_no)}</span>
        </div>
        <div class="orders-card-detail" id="order-detail-${order.id}"></div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.orders-card-item').forEach(card => {
    card.addEventListener('click', (e) => {
      // 點擊互動元素（SELECT/BUTTON/INPUT 等）→ 不切換展開/收合，避免誤觸收合
      const tag = e.target.tagName;
      if (['SELECT', 'BUTTON', 'INPUT', 'TEXTAREA', 'A', 'LABEL'].includes(tag)) return;
      const id = card.dataset.id;
      const isOpen = card.classList.contains('open');
      // 關閉其他
      container.querySelectorAll('.orders-card-item.open').forEach(c => {
        if (c !== card) c.classList.remove('open');
      });
      if (!isOpen) {
        card.classList.add('open');
        renderOrderDetail(id);
      } else {
        card.classList.remove('open');
      }
    });

    // 點擊「狀態」徽章 → 自動收起整個 Record
    const badge = card.querySelector('.order-status-badge');
    if (badge) {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        card.classList.remove('open');
      });
    }
  });
}

export async function renderOrderDetail(id) {
  const detailContainer = document.getElementById(`order-detail-${id}`);
  if (!detailContainer) return;
  detailContainer.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const order = await fetchOrder(id);
    detailContainer.innerHTML = buildOrderDetailHtml(order);
    setupOrderDetailActions(order);
  } catch (err) {
    detailContainer.innerHTML = `<div class="empty-state">無法載入詳情：${escapeHtml(err.message)}</div>`;
  }
}

export function buildOrderDetailHtml(order) {
  const powLabel = formatPowerItems(order);

  return `
    <div class="orders-detail-grid">
      <div class="orders-detail-field">
        <span class="detail-label">訂單編號</span>
        <span class="detail-value">${escapeHtml(order.order_no)}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">狀態更新</span>
        <span class="detail-value">${formatDateTime(order.updated_at)}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">MAWB#</span>
        <span class="detail-value">${escapeHtml(displayMawb(order.mawb))}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">HAWB#</span>
        <span class="detail-value">${escapeHtml(order.hawb || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">DEST</span>
        <span class="detail-value">${escapeHtml(order.dest || '-')}</span>
      </div>
      <div class="orders-detail-field full">
        <span class="detail-label">客戶提貨號</span>
        <span class="detail-value">${escapeHtml(order.pickup_no || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">📅 提貨日期時間</span>
        <span class="detail-value">${escapeHtml(formatPickupDatetime(order.pickup_datetime) || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">${order.order_type === 'delivery' ? '取貨地點' : '收貨地點'}</span>
        <span class="detail-value">${escapeHtml(order.pickup_company_name || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">${order.order_type === 'delivery' ? '送貨目的地' : '交回/轉交地點'}</span>
        <span class="detail-value">${escapeHtml(order.delivery_company_name || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">貨品</span>
        <span class="detail-value">${escapeHtml(order.cargo_desc || '-')}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">件數 / 重量 / CBM</span>
        <span class="detail-value">${order.quantity || 0} 件 / ${order.weight_kg || 0} KG / ${order.cbm || 0} CBM</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">⚡ 電力</span>
        <span class="detail-value">${escapeHtml(powLabel)}</span>
      </div>
      <div class="orders-detail-field">
        <span class="detail-label">🚨 趕機</span>
        <span class="detail-value">${order.urgent === 'yes' ? '🔴 是' : '⚪ 否'}</span>
      </div>
      ${order.receiver_note ? `
      <div class="orders-detail-field full">
        <span class="detail-label">收貨人備註</span>
        <span class="detail-value">${escapeHtml(order.receiver_note)}</span>
      </div>` : ''}
      ${order.contact_note ? `
      <div class="orders-detail-field full">
        <span class="detail-label">聯絡人備註</span>
        <span class="detail-value">${escapeHtml(order.contact_note)}</span>
      </div>` : ''}
      <div class="orders-detail-field full orders-detail-status">
        <span class="detail-label">狀態</span>
        <span class="detail-value">
          <select class="order-status-select ${escapeHtml(order.status)}" data-order-id="${order.id}">
            <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>⏳ 待處理</option>
            <option value="in_progress" ${order.status === 'in_progress' ? 'selected' : ''}>🔄 進行中</option>
            <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>✅ 已完成</option>
            <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>⛔ 已取消</option>
          </select>
        </span>
      </div>
      ${order.notes ? `
      <div class="orders-detail-field full">
        <span class="detail-label">備註</span>
        <span class="detail-value">${escapeHtml(order.notes)}</span>
      </div>` : ''}
    </div>
    <div class="orders-card-actions">
      <button type="button" class="pill" data-action="edit" data-id="${order.id}">✏️ 編輯</button>
      <button type="button" class="pill" data-action="duplicate" data-id="${order.id}">📄 複製此訂單</button>
      <button type="button" class="pill btn-primary" data-action="email" data-id="${order.id}">📧 電郵總結</button>
      <button type="button" class="pill" data-action="copy" data-id="${order.id}">📋 複製總結</button>
      <button type="button" class="pill" data-action="delete" data-id="${order.id}">🗑️ 刪除</button>
    </div>
  `;
}

export function setupOrderDetailActions(order) {
  // 狀態變更
  const statusSelect = document.querySelector(`.order-status-select[data-order-id="${order.id}"]`);
  if (statusSelect) {
    // 防止點擊/展開狀態選單時冒泡到卡片 handler 造成瞬間收合
    statusSelect.addEventListener('click', (e) => e.stopPropagation());
    statusSelect.addEventListener('change', async () => {
      try {
        await updateOrder(order.id, { ...order, status: statusSelect.value });
        // 更新成功 → 自動收起整張卡片（先從 DOM 移除 open，再重新載入列表）
        const card = document.querySelector(`.orders-card-item[data-id="${order.id}"]`);
        if (card) card.classList.remove('open');
        fetchOrders();
      } catch (err) {
        alert(`更新失敗：${err.message}`);
        statusSelect.value = order.status;
      }
    });
  }

  // 按鈕動作
  document.querySelectorAll(`.orders-card-actions [data-id="${order.id}"]`).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'email') {
        sendOrderEmail(order, buildOrderSummary(order));
      } else if (action === 'copy') {
        navigator.clipboard.writeText(buildOrderSummaryText(order)).then(() => {
          alert('總結內容已複製！');
        }).catch(() => alert('複製失敗'));
      } else if (action === 'edit') {
        loadOrderToForm(order);
      } else if (action === 'duplicate') {
        duplicateOrder(order);
      } else if (action === 'delete') {
        deleteOrder(order);
      }
    });
  });
}

export async function duplicateOrder(order) {
  // 複製現有訂單（新訂單編號）
  const { id, order_no, created_at, updated_at, ...rest } = order;
  const payload = { ...rest, status: 'pending' };
  try {
    const result = await createOrder(payload);
    alert(`已複製訂單！新訂單編號：${result.order_no}`);
    fetchOrders();
  } catch (err) {
    alert(`複製失敗：${err.message}`);
  }
}

export async function deleteOrder(order) {
  if (!confirm(`確定刪除訂單 ${order.order_no}？`)) return;
  try {
    await deleteOrderApi(order.id);
    alert('訂單已刪除');
    fetchOrders();
  } catch (err) {
    alert(`刪除失敗：${err.message}`);
  }
}

// ===== 訂單列表搜尋（防抖） =====
export function setupOrdersSearch() {
  const searchInput = document.getElementById('orders-search-input');
  const statusFilter = document.getElementById('orders-status-filter');
  const refreshBtn = document.getElementById('btn-orders-refresh');
  const todayPickupBtn = document.getElementById('btn-orders-today-pickup');
  const dateFilterInput = document.getElementById('orders-date-filter-input');
  const dateClearBtn = document.getElementById('btn-orders-date-clear');

  if (searchInput) {
    searchInput.addEventListener('input', debounce(fetchOrders, 350));
  }
  if (statusFilter) {
    statusFilter.addEventListener('change', fetchOrders);
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', fetchOrders);
  }
  // 日期搜尋：依提貨日期篩選
  if (dateFilterInput) {
    dateFilterInput.addEventListener('change', () => {
      setDateFilterValue(dateFilterInput.value || '');
      if (dateClearBtn) dateClearBtn.style.display = getDateFilterValue() ? 'flex' : 'none';
      // 與「今天的收貨」互斥：手動選日期時關閉今天的收貨
      if (getDateFilterValue() && getTodayPickupActive()) {
        setTodayPickupActive(false);
        if (todayPickupBtn) {
          todayPickupBtn.classList.remove('active');
          todayPickupBtn.textContent = '📥 今天的收貨';
        }
      }
      fetchOrders();
    });
  }
  // 清除日期
  if (dateClearBtn) {
    dateClearBtn.addEventListener('click', () => {
      setDateFilterValue('');
      if (dateFilterInput) dateFilterInput.value = '';
      dateClearBtn.style.display = 'none';
      fetchOrders();
    });
  }
  // 「今天的收貨」切換按鈕
  if (todayPickupBtn) {
    todayPickupBtn.addEventListener('click', () => {
      const nextActive = !getTodayPickupActive();
      setTodayPickupActive(nextActive);
      todayPickupBtn.classList.toggle('active', nextActive);
      todayPickupBtn.textContent = nextActive ? '📥 今天的收貨 ✓' : '📥 今天的收貨';
      // 與日期搜尋互斥：啟用今天的收貨時清除日期
      if (nextActive && getDateFilterValue()) {
        setDateFilterValue('');
        if (dateFilterInput) dateFilterInput.value = '';
        if (dateClearBtn) dateClearBtn.style.display = 'none';
      }
      fetchOrders();
    });
  }
}