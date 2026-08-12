// ===== 打板計劃：格式化與輔助函式 =====

export const STATUS_LABEL = { draft: '草稿', locked: '已鎖定', completed: '已完成', cancelled: '已取消' };

// 數字格式化：千分位
export function formatNumber(value, digits = 1) {
  const num = Number(value) || 0;
  return num.toLocaleString('en-US', { maximumFractionDigits: digits });
}

// 重量顯示（kg）
export function formatWeight(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

// SPL badge class
export function splBadgeClass(spl) {
  if (!spl) return '';
  const s = String(spl).toUpperCase();
  if (/(PI967|PI968|UN3480|UN3481|UN3090|UN3091|ELI|ELM|A67|A123|A199)/.test(s)) return 'battery';
  if (/冇電|無電|NO.?POWER/i.test(s)) return 'no-power';
  return 'default-spl';
}

// SPL 是否為電池類（用於 hover tooltip）
export function isBatterySpl(spl) {
  if (!spl) return false;
  return /(PI967|PI968|UN3480|UN3481|UN3090|UN3091|ELI|ELM|A67|A123|A199)/i.test(String(spl));
}

// 日期時間格式化（本地時間）
export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('zh-HK', { year: 'numeric', month: 'short', day: 'numeric' });
}

// 航班倒數計算（IDEA 4）
// flightDate 如 '2026-07-29T18:55' 或 '2026-07-29 18:55'
export function getFlightCountdown(plan) {
  if (!plan || !plan.flight_date) return null;
  let flightTime = String(plan.flight_date).replace(' ', 'T');
  if (!/T\d{2}:\d{2}/.test(flightTime)) {
    // 只有日期沒有時間
    if (/^\d{4}-\d{2}-\d{2}$/.test(flightTime)) flightTime += 'T18:00';
    else return null;
  }
  if (flightTime.length <= 10) flightTime += 'T18:00';
  const target = new Date(flightTime);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return { diffMs, urgent: true, text: '🛫 已起飛/已過期' };
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  // 交板倒數：起飛前 handover_hours 小時
  const handoverHours = Number(plan.handover_hours) || 0;
  let urgent = false;
  let text = `🛫 ${hours}h ${mins}m 後起飛`;
  if (handoverHours > 0) {
    const handoverDiff = diffMs - handoverHours * 3600000;
    if (handoverDiff < 0) {
      urgent = true;
      text = `🚨 交板時間已過（起飛前 ${handoverHours}h）`;
    } else {
      const hh = Math.floor(handoverDiff / 3600000);
      const mm = Math.floor((handoverDiff % 3600000) / 60000);
      urgent = hh < 2;
      text = `📦 交板倒數 ${hh}h ${mm}m（起飛前 ${handoverHours}h）`;
    }
  }
  return { diffMs, urgent, text };
}

// 下載 CSV（ExcelController 共用）
export function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Plan 純文字總結（IDEA 6：複製總結）
export function buildPlanTextSummary(plan, items) {
  const lines = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`打板計劃 ${plan.plan_no}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`狀態      ：${STATUS_LABEL[plan.status] || plan.status}`);
  lines.push(`公司      ：${plan.company_name || '-'}`);
  if (plan.fax) lines.push(`傳真      ：${plan.fax}`);
  if (plan.plan_date) lines.push(`日期      ：${plan.plan_date}`);
  if (plan.flight_no) lines.push(`航班      ：${plan.flight_no} ${plan.flight_date || ''}`);
  if (plan.arrival_airport) lines.push(`目的地    ：${plan.arrival_airport}`);
  if (plan.contour_text) lines.push(`板型      ：${plan.contour_text}`);
  if (plan.planner) lines.push(`策劃人    ：${plan.planner}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (plan.remarks) {
    lines.push(`備註：`);
    lines.push(plan.remarks);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }
  lines.push('主單與分單明細 (Cargo Details)');
  lines.push('MAWB / HAWB | CLIENT | DEST | PCS | G.WT | V.WT | CBM | SPL | REMARK');
  (items || []).forEach(it => {
    lines.push(`${it.mawb || '-'} / ${it.hawb || '-'} | ${it.client || '-'} | ${it.dest || '-'} | ${it.pcs || 0} | ${formatWeight(it.gross_weight)} | ${formatWeight(it.volume_weight)} | ${formatNumber(it.cbm, 2)} | ${it.spl || '-'} | ${it.remark || '-'}`);
  });
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const totals = plan.totals || {};
  lines.push(`總計        ：${(items || []).length} MAWB | ${totals.pcs || 0} PCS | ${formatWeight(totals.gross_weight)} kg G.WT | ${formatWeight(totals.volume_weight)} kg V.WT | ${formatNumber(totals.cbm, 2)} CBM`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}