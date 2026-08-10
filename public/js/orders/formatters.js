// ===== 訂單系統格式化/跳脫/公司輔助（無網路與事件依賴） =====
// 從原 orders.js 抽出的純格式化邏輯
// 註：日期/時間格式化（formatDateTime、formatPickupDatetime、getTodayDateStr、getNowTimeStr）
//     沿用 utils/datetime-utils.js 的全域函式；escapeHtml 沿用 main.js 的全域函式。

import { getCompanies } from './state.js';
import { ORDER_TYPE_LABEL, STATUS_LABEL, POWER_TYPE_LABEL, POWER_LATE_LABEL } from './constants.js';

// ===== HTML 跳脫 =====
export function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '\x26amp;')
    .replace(/"/g, '\x26quot;')
    .replace(/</g, '\x26lt;')
    .replace(/>/g, '\x26gt;');
}

// 顯示用跳脫（null/空字串 → '-'）
export function escHtml(str) {
  return String(str == null || str === '' ? '-' : str)
    .replace(/&/g, '\x26amp;')
    .replace(/</g, '\x26lt;')
    .replace(/>/g, '\x26gt;');
}

// ===== 公司輔助查詢 =====
// 依公司 id 找公司
export function getCompanyById(id) {
  const numId = Number(id);
  if (!numId) return null;
  return getCompanies().find(c => Number(c.id) === numId) || null;
}

// 判斷某公司是否屬「運輸公司」類別（category 可能是逗號分隔多值，如 "customer,transport"）
export function isTransportCategory(category) {
  if (!category) return false;
  return String(category).split(',').map(s => s.trim()).includes('transport');
}

// 依公司 id 找公司名稱
export function getCompanyNameById(id) {
  const company = getCompanyById(id);
  return company ? company.name : '';
}

// ===== CBM DIM 格式化 =====
export function formatCbmDimensions(dims) {
  if (!dims || !dims.length) return '';
  const lines = dims.map(d => `${d.len} x ${d.width} x ${d.height} / ${d.qty}`);
  return `DIM(cm):\n${lines.join('\n')}`;
}

// ===== 電力組合格式化 =====
// 將電力組合轉為可讀文字，如「A67 × 5 件 ｜ A199 × 11 件」或「ELI/PI967 × 2 件」
export function formatPowerItems(order) {
  if (!order) return '⚡ 無電';
  // 後補電池資訊標記
  if (order.power_type === 'late') return '🔋 後補電池資訊';
  if (order.power_items && order.power_items.length) {
    // 純無電（只有一項且是 no）→ 只顯示「⚡ 無電」
    if (order.power_items.length === 1 && order.power_items[0].type === 'no') {
      return '⚡ 無電';
    }
    return order.power_items.map(item => {
      if (item.type === 'no') return `⚡ 無電 × ${item.qty} 件`;
      const label = item.main ? `${item.main}/${item.code}` : (item.code || '');
      return `${label} × ${item.qty} 件`;
    }).join('｜');
  }
  // 舊資料相容
  if (order.power_type === 'no' || !order.power_type) return '⚡ 無電';
  return `${POWER_TYPE_LABEL[order.power_type] || order.power_type}${order.power_code ? ` (${order.power_code})` : ''}`;
}

// ===== 公司下拉選項（新建/編輯表單用） =====
export function companySelectOptions(selectedId) {
  const options = getCompanies()
    .filter(c => !isTransportCategory(c.category))
    .map(c => `<option value="${c.id}" ${Number(c.id) === Number(selectedId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  return `<option value="">-- 搜尋/選擇公司 --</option>${options}`;
}

// ===== 訂單總結 HTML =====
export function buildCompanyDetailHtml(title, companyName, address, contact, phone, email, notes) {
  const hasName = !!companyName;
  if (!hasName) return '';
  return `
    <tr><td colspan="2" style="background:#f0f4ff;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">${title}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;width:110px;">名稱</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(companyName)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">地址</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(address)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">聯絡人</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(contact)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">電話</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(phone)}</td></tr>
    ${email ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">電郵</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(email)}</td></tr>` : ''}
    ${notes ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">備註</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(notes).replace(/\r\n|\r|\n/g, '<br>\n')}</td></tr>` : ''}
  `;
}

// 建立訂單純文字總結（複製用，適合貼到 WhatsApp 等通訊軟體，不含 HTML）
export function buildOrderSummaryText(order) {
  const typeLabel = ORDER_TYPE_LABEL[order.order_type] || order.order_type;
  const powLabel = formatPowerItems(order);
  const urgentLabel = order.urgent === 'yes' ? '🔴 是 - 需優先處理' : '⚪ 否 - 普通';
  // 純文字顯示：null/空字串 → '-'
  const fmt = (val) => (val == null || val === '' ? '-' : String(val));

  const pickupTitle = order.order_type === 'delivery' ? '📍 取貨公司（FULL DETAILS）' : '📍 收貨公司（FULL DETAILS）';
  const deliveryTitle = order.order_type === 'delivery' ? '📍 送貨目的地（FULL DETAILS）' : '📍 交回/轉交目的地（FULL DETAILS）';

  // 公司詳細資料（純文字，名稱不存在時整個區塊省略）
  const companyDetailText = (title, companyName, address, contact, phone, email, notes) => {
    if (!companyName) return '';
    return [
      title,
      `名稱：${fmt(companyName)}`,
      `地址：${fmt(address)}`,
      `聯絡人：${fmt(contact)}`,
      `電話：${fmt(phone)}`,
      email ? `電郵：${fmt(email)}` : '',
      notes ? `備註：${fmt(notes)}` : ''
    ].filter(Boolean).join('\n');
  };

  const pickupDetail = companyDetailText(
    pickupTitle,
    order.pickup_company_name,
    order.pickup_company_address,
    order.pickup_company_contact,
    order.pickup_company_phone,
    order.pickup_company_email,
    order.pickup_company_notes
  );
  const deliveryDetail = companyDetailText(
    deliveryTitle,
    order.delivery_company_name,
    order.delivery_company_address,
    order.delivery_company_contact,
    order.delivery_company_phone,
    order.delivery_company_email,
    order.delivery_company_notes
  );

  // 收貨人（receiver）資料
  const receiverLines = [];
  if (order.receiver_name || order.receiver_phone || order.address) {
    receiverLines.push('📋 收貨人資料');
    receiverLines.push(`收貨人：${fmt(order.receiver_name)}`);
    receiverLines.push(`電話：${fmt(order.receiver_phone)}`);
    receiverLines.push(`地址：${fmt(order.address)}`);
    if (order.receiver_note) receiverLines.push(`收貨人備註：${fmt(order.receiver_note)}`);
    if (order.contact_note) receiverLines.push(`聯絡人備註：${fmt(order.contact_note)}`);
  }

  // DIM(cm) 純文字
  const dimLines = (order.cbm_dimensions && order.cbm_dimensions.length)
    ? ['📐 DIM(cm)', ...order.cbm_dimensions.map(d => `尺寸：${fmt(`${d.len} x ${d.width} x ${d.height}`)} / ${fmt(d.qty)} 件`)]
    : [];

  // 區塊分隔線（手機友善：不要太長）
  const SEPARATOR = '---';

  // 各區塊內容（空區塊會被過濾，選填區塊自動省略）
  const sections = [
    [`📦 訂單總結 ${fmt(order.order_no)}`],
    [
      '🧾 提單資訊',
      `類型：${fmt(typeLabel)}`,
      `MAWB#：${fmt(displayMawb(order.mawb))}`,
      `HAWB#：${fmt(order.hawb)}`,
      `DEST：${fmt(order.dest)}`,
      `提貨號：${fmt(order.pickup_no)}`,
      order.pickup_datetime ? `提貨時間：${fmt(formatPickupDatetime(order.pickup_datetime))}` : ''
    ],
    order.customer_company_name
      ? ['🏢 需要收貨的客戶', `客戶公司：${fmt(order.customer_company_name)}`]
      : [],
    pickupDetail ? pickupDetail.split('\n') : [],
    deliveryDetail ? deliveryDetail.split('\n') : [],
    receiverLines.length ? receiverLines : [],
    [
      '📦 貨物資料',
      `貨品：${fmt(order.cargo_desc)}`,
      `件數：${order.quantity || 0} 件`,
      `重量：${order.weight_kg || 0} KG`,
      `CBM：${order.cbm || 0} cbm`
    ],
    dimLines.length ? dimLines : [],
    [
      '⚡ 其他資訊',
      `⚡ 電力：${fmt(powLabel)}`,
      `🚨 趕機：${fmt(urgentLabel)}`,
      order.notes ? `備註：${fmt(order.notes)}` : '',
      `狀態：${fmt(STATUS_LABEL[order.status] || order.status)}`,
      `建立日期：${fmt(formatDateTime(order.created_at))}`
    ]
  ];

  // 以 --- 分隔各區塊
  const blocks = sections
    .filter(sec => sec.some(line => line))
    .map(sec => sec.filter(Boolean).join('\n'));

  return blocks.join(`\n${SEPARATOR}\n`);
}

// 建立訂單 HTML 總結（電郵/複製用，含 <table> 樣式）
export function buildOrderSummary(order) {
  const typeLabel = ORDER_TYPE_LABEL[order.order_type] || order.order_type;
  const powLabel = formatPowerItems(order);
  const urgentLabel = order.urgent === 'yes' ? '🔴 是 - 需優先處理' : '⚪ 否 - 普通';

  const pickupTitle = order.order_type === 'delivery' ? '📍 取貨公司（FULL DETAILS）' : '📍 收貨公司（FULL DETAILS）';
  const deliveryTitle = order.order_type === 'delivery' ? '📍 送貨目的地（FULL DETAILS）' : '📍 交回/轉交目的地（FULL DETAILS）';

  // 收貨公司與目的地 FULL DETAILS
  const pickupDetail = buildCompanyDetailHtml(
    pickupTitle,
    order.pickup_company_name,
    order.pickup_company_address,
    order.pickup_company_contact,
    order.pickup_company_phone,
    order.pickup_company_email,
    order.pickup_company_notes
  );
  const deliveryDetail = buildCompanyDetailHtml(
    deliveryTitle,
    order.delivery_company_name,
    order.delivery_company_address,
    order.delivery_company_contact,
    order.delivery_company_phone,
    order.delivery_company_email,
    order.delivery_company_notes
  );

  // 收貨人（receiver）資料備份顯示
  const receiverDetail = (order.receiver_name || order.receiver_phone || order.address) ? `
    <tr><td colspan="2" style="background:#f0f4ff;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">📋 收貨人資料</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;width:110px;">收貨人</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.receiver_name)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">電話</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.receiver_phone)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">地址</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.address)}</td></tr>
    ${order.receiver_note ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">收貨人備註</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.receiver_note).replace(/\r\n|\r|\n/g, '<br>\n')}</td></tr>` : ''}
    ${order.contact_note ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">聯絡人備註</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.contact_note).replace(/\r\n|\r|\n/g, '<br>\n')}</td></tr>` : ''}
  ` : '';

  // DIM(cm) 表格化
  const dimHtml = (order.cbm_dimensions && order.cbm_dimensions.length) ? `
    <tr><td colspan="2" style="background:#f0f4ff;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">📐 DIM(cm)</td></tr>
    ${order.cbm_dimensions.map(d => `
      <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">尺寸</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(`${d.len} x ${d.width} x ${d.height}`)} / ${escHtml(d.qty)} 件</td></tr>
    `).join('')}
  ` : '';

  return `
    <div style="font-family:Arial,sans-serif;">
      <h3 style="margin:0 0 12px;">📦 訂單總結 ${escHtml(order.order_no)}</h3>
      <table style="border-collapse:collapse;font-size:14px;max-width:640px;">
        <tr><td colspan="2" style="background:#e8eefc;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">🧾 提單資訊</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;width:110px;">類型</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(typeLabel)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">MAWB#</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(displayMawb(order.mawb))}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">HAWB#</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.hawb)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">DEST</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.dest)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">提貨號</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.pickup_no)}</td></tr>
        ${order.pickup_datetime ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">提貨時間</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(formatPickupDatetime(order.pickup_datetime))}</td></tr>` : ''}
        ${order.customer_company_name ? `
        <tr><td colspan="2" style="background:#f0f4ff;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">🏢 需要收貨的客戶</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">客戶公司</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.customer_company_name)}</td></tr>` : ''}
        ${pickupDetail}
        ${deliveryDetail}
        ${receiverDetail}
        <tr><td colspan="2" style="background:#e8eefc;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">📦 貨物資料</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">貨品</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.cargo_desc)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">件數</td><td style="padding:6px 10px;border:1px solid #ccc;">${order.quantity || 0} 件</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">重量</td><td style="padding:6px 10px;border:1px solid #ccc;">${order.weight_kg || 0} KG</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">CBM</td><td style="padding:6px 10px;border:1px solid #ccc;">${order.cbm || 0} cbm</td></tr>
        ${dimHtml}
        <tr><td colspan="2" style="background:#e8eefc;font-weight:700;padding:7px 10px;border:1px solid #ccc;text-align:center;">⚡ 其他資訊</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">⚡ 電力</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(powLabel)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">🚨 趕機</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(urgentLabel)}</td></tr>
        ${order.notes ? `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">備註</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(order.notes).replace(/\r\n|\r|\n/g, '<br>\n')}</td></tr>` : ''}
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">狀態</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(STATUS_LABEL[order.status] || order.status)}</td></tr>
        <tr><td style="padding:6px 10px;border:1px solid #ccc;background:#fafafa;">建立日期</td><td style="padding:6px 10px;border:1px solid #ccc;">${escHtml(formatDateTime(order.created_at))}</td></tr>
      </table>
    </div>
  `;
}