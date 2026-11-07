// ===== U2：貼上多列解析（共用純函式）=====
// 業界實務：MAWB 清單常常已經在 Excel／booking list 裡，直接複製貼上最快。
// 支援（以 Tab／逗號／多空白分隔）：
//   4 欄：MAWB / DEST / PCS / WT
//   3 欄：MAWB / PCS / WT（沒有 DEST）
//   2 欄：MAWB / PCS
//   1 欄：MAWB
// 回傳：{ rows: [{ mawb, port, pcs, weight }], skipped: [{ line, reason }] }
//   - MAWB 只做「去頭尾空白＋去標點雜訊」；真正的號碼規則交給既有的 MAWB 正規化與後端驗證
//   - 標題列（含 MAWB／DEST／PCS／WT 等字樣）自動略過
//   - 空行略過；無法辨識最少 1 個 MAWB 的行列入 skipped
const PASTE_HEADER_WORDS = ['mawb', 'hawb', 'dest', 'pcs', 'wt', 'weight', '公斤', '重量', '件數', '目的地'];

function pasteNumber(value) {
  const text = String(value == null ? '' : value).replace(/[, ]/g, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function pasteLooksLikeHeader(cells) {
  const first = String(cells[0] || '').trim().toLowerCase();
  if (!first) return false;
  return PASTE_HEADER_WORDS.some(word => first === word || first.includes(word));
}

export function uldParsePastedRows(text) {
  const rows = [];
  const skipped = [];
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, index) => {
    const raw = line.trim();
    if (!raw) return;
    // Tab 優先（從 Excel 複製一定是 Tab）；否則用逗號、或 2 個以上空白
    let cells = raw.includes('\t') ? raw.split('\t') : raw.split(/\s{2,}|,|\s*\|\s*/);
    cells = cells.map(cell => String(cell == null ? '' : cell).trim());
    if (pasteLooksLikeHeader(cells)) return;
    const mawb = cells.find(cell => /[0-9]/.test(cell) && cell.replace(/[^0-9A-Za-z]/g, '').length >= 6);
    if (!mawb) {
      skipped.push({ line: index + 1, reason: '看不出 MAWB#', text: raw });
      return;
    }
    const rest = cells.filter(cell => cell !== mawb);
    // DEST：2～4 個英文字母（HKG／LAX／TPE／TLV…），抓第一個
    const port = (rest.find(cell => /^[A-Za-z]{3,4}$/.test(cell)) || '').toUpperCase();
    // 數字欄位依序＝件數、重量（有 DEST 時也一樣）
    const numbers = rest
      .filter(cell => cell !== port && pasteNumber(cell) != null)
      .map(cell => pasteNumber(cell));
    const pcs = numbers.length >= 1 ? numbers[0] : 0;
    const weight = numbers.length >= 2 ? numbers[1] : 0;
    rows.push({ mawb: mawb.trim(), port, pcs, weight });
  });
  return { rows, skipped };
}

// 貼上的內容能不能用（至少 1 列有 MAWB）
export function uldPasteHasRows(text) {
  return uldParsePastedRows(text).rows.length > 0;
}

// 貼上事件只攔「MAWB 類」欄位（data-draft／data-item-field／data-row-field = 'mawb'）。
// 其他欄位（ULD#／Contour／RCL#／Port／件數／重量…）要讓瀏覽器照正常貼上：
// 否則把 ULD#（例：PMC40026DS）貼進 ULD# 欄也會被丟去 addPastedRows() 當成 MAWB 驗證，
// 跳出「沒有可加入的票…MAWB 是 11 位數字…格式不符」，使用者根本貼不進去。
const PASTE_MAWB_FIELD_KEYS = ['draft', 'itemField', 'rowField'];

export function uldPasteIsMawbField(dataset) {
  const data = dataset || {};
  return PASTE_MAWB_FIELD_KEYS.some(key => data[key] === 'mawb');
}
