// ===== 通用日期/時間工具 =====

// 今日日期 YYYY-MM-DD（用本地時區）
function getTodayDateStr() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 目前時間 HH:MM（24 小時制），分鐘向下取整至最近 15 分鐘（00/15/30/45）
function getNowTimeStr() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  // 向下取整：分鐘 ÷ 15 取整再 ×15（如 9:07 → 9:00、9:17 → 9:15）
  const roundedMin = Math.floor(now.getMinutes() / 15) * 15;
  const mi = String(roundedMin).padStart(2, '0');
  return `${hh}:${mi}`;
}

// 顯示提貨日期時間（如 2026-08-02 18:30）
function formatPickupDatetime(value) {
  if (!value) return '';
  const v = String(value).trim();
  if (!v) return '';
  // 值本身就是「日期 時間」或「日期」
  return v;
}

// 格式化 ISO 時間字串為可讀的本地日期時間
function formatDateTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  return date.toLocaleString('zh-HK', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}