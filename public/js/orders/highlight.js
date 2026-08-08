// ===== 搜尋匹配文字高亮工具（Highlight + 閃爍） =====
// 將字串中的搜尋關鍵字包成 <span class="autocomplete-match">（黃底 + 閃爍，樣式於 orders.css）
// 避免 XSS：輸入片段一律先經 escapeHtml 處理（window 全域函式，來自 main.js），
// 再將關鍵字（同樣已跳脫）以字串替換技巧包成 mark span。

export function escapeForRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 將 text 中所有出現 query（不區分大小寫）包成高亮 span；回傳已跳脫的 HTML
export function highlightMatch(text, query) {
  const raw = String(text == null ? '' : text);
  const q = String(query == null ? '' : query).trim();
  if (!q || !raw) {
    // 沒有關鍵字 → 直接跳脫輸出
    return escapeHtml(raw);
  }
  // 先全部跳脫，再對「跳脫後的關鍵字」做大小寫不敏感替換
  const escapedText = escapeHtml(raw);
  const escapedQ = escapeHtml(q);
  const lowerText = escapedText.toLowerCase();
  const lowerQ = escapedQ.toLowerCase();

  // 若關鍵字在跳脫後不存在（例如使用者輸入 & < > 等會變成實體）→ 直接回傳
  if (!lowerText.includes(lowerQ)) {
    return escapedText;
  }

  const parts = [];
  let pos = 0;
  while (true) {
    const idx = lowerText.indexOf(lowerQ, pos);
    if (idx === -1) {
      parts.push(escapedText.slice(pos));
      break;
    }
    if (idx > pos) parts.push(escapedText.slice(pos, idx));
    parts.push(`<span class="autocomplete-match">${escapedText.slice(idx, idx + q.length)}</span>`);
    pos = idx + q.length;
  }
  return parts.join('');
}
// 掛載到 window，供經典 script（utils/autocomplete.js 等）呼叫
window.highlightMatch = highlightMatch;
