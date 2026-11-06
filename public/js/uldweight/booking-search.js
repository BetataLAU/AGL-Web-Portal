// ===== ULD 夾重系統：MAWB 從「打板計劃 Booking Record」帶入（輸入即篩選）=====
// 選到 Booking 後自動帶入 mawb / 件數（pcs）/ 申報重量（gross_weight）/ Port（dest），
// 並把 mawb_record_id 記在 item 上（uldSheetPayload 已保留該欄位）。
// 手動輸入 MAWB 仍然可用（沒選 Booking 就是 mawb_record_id = null）。
//
// 依賴：./api.js（fetchBookings）、./calc.js（uldMawbKey / uldFmtKg）、./state.js（uldFindUnit）、
//       window.setupAutocomplete（public/js/utils/autocomplete.js；未載入就退回純手動輸入）
import { fetchBookings } from './api.js';
import { uldMawbKey, uldFmtKg } from './calc.js';
import { uldFindUnit } from './state.js';

// 下拉顯示字串的分隔符：第一段固定是 MAWB（選到時只取這段寫進 MAWB 欄位）
const LABEL_SEP = ' ｜ ';
const SNAPSHOT_LIMIT = 200;      // 取得「最近 200 筆」當本機篩選基底（一次 API）
const SNAPSHOT_TTL_MS = 60000;   // 快照存活時間
const QUERY_TTL_MS = 30000;      // 伺服器查詢結果存活時間

const bookingsByMawb = new Map();   // MAWB 鍵 → Booking Record（選到時用來還原 pcs／重量）
let snapshot = { at: 0, labels: [] };
const queryCache = new Map();       // 查詢字串 → { at, labels }

// 換頁／重新整理時清掉（Booking Record 可能在打板計劃被新增或修改）
export function resetBookingCache() {
  bookingsByMawb.clear();
  queryCache.clear();
  snapshot = { at: 0, labels: [] };
}

// 下拉顯示字串：MAWB ｜ DEST ｜ 件數 ｜ 重量（同一票 MAWB 有多筆時靠 DEST／件數區分）
export function bookingLabel(row) {
  if (!row) return '';
  const parts = [];
  const mawb = String(row.mawb || '').trim();
  if (mawb) parts.push(mawb);
  const dest = String(row.dest || '').trim();
  if (dest) parts.push(dest);
  const pcs = Number(row.pcs);
  if (Number.isFinite(pcs) && pcs > 0) parts.push(`${Math.trunc(pcs)}件`);
  const weight = Number(row.gross_weight);
  if (Number.isFinite(weight) && weight > 0) parts.push(`${uldFmtKg(weight)}kg`);
  return parts.join(LABEL_SEP);
}

// 下拉選到的字串 → MAWB（只取第一段，避免把 DEST／件數／重量一起寫進 MAWB 欄位）
export function bookingLabelMawb(label) {
  return String(label == null ? '' : label).split(LABEL_SEP)[0].trim();
}

// Booking Record → 「新增 MAWB」列的草稿值（純函式，方便測試）
export function bookingDraftValues(row) {
  if (!row) return null;
  const pcs = Number(row.pcs);
  const weight = Number(row.gross_weight);
  return {
    mawb: String(row.mawb || '').trim(),
    port: String(row.dest || '').trim().toUpperCase(),
    pcs: Number.isFinite(pcs) && pcs > 0 ? String(Math.trunc(pcs)) : '',
    declared_weight: Number.isFinite(weight) && weight > 0 ? String(weight) : '',
    mawb_record_id: row.id || null
  };
}

function rememberBooking(row) {
  if (!row || !row.mawb) return;
  const key = uldMawbKey(row.mawb);
  if (key) bookingsByMawb.set(key, row);
}

// 由下拉字串找回 Booking Record
export function bookingByLabel(label) {
  const key = uldMawbKey(bookingLabelMawb(label));
  return (key && bookingsByMawb.get(key)) || null;
}

// 最近 200 筆（只打一次 API；過期才重抓）
async function loadSnapshot() {
  if (snapshot.labels.length && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) return snapshot.labels;
  const rows = await fetchBookings({ limit: SNAPSHOT_LIMIT });
  rows.forEach(rememberBooking);
  snapshot = { at: Date.now(), labels: rows.map(bookingLabel).filter(Boolean) };
  return snapshot.labels;
}

// 快照裡找不到才查伺服器（舊資料仍找得到）
async function searchRemote(query) {
  const key = String(query || '').trim().toLowerCase();
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < QUERY_TTL_MS) return hit.labels;
  const rows = await fetchBookings({ search: key, limit: 50 });
  rows.forEach(rememberBooking);
  const labels = rows.map(bookingLabel).filter(Boolean);
  queryCache.set(key, { at: Date.now(), labels });
  return labels;
}

// 給 setupAutocomplete 用的候選清單（async）：先在本機快照篩選，
// 找不到才打 API（避免每打一個字就打一次伺服器），實際的比對由 autocomplete 再做一次。
export async function bookingSuggestions(query) {
  let labels = [];
  try {
    labels = await loadSnapshot();
  } catch (err) {
    labels = [];
  }
  const q = String(query || '').trim().toLowerCase();
  if (!q) return labels;
  if (labels.some(label => label.toLowerCase().includes(q))) return labels;
  try {
    const remote = await searchRemote(q);
    if (remote.length) return remote;
  } catch (err) { /* 查不到就用手上的清單（仍可手動輸入 MAWB） */ }
  return labels;
}

// ===== DOM 綁定 =====
function unitOfInput(input) {
  const card = input && input.closest ? input.closest('.uldw-unit') : null;
  return card ? uldFindUnit(card.dataset.uid) : null;
}

function formOfInput(input) {
  return input && input.closest ? input.closest('.uldw-item-add') : null;
}

function setHint(input, text) {
  const form = formOfInput(input);
  const hint = form ? form.querySelector('[data-draft-hint="mawb"]') : null;
  if (hint) hint.textContent = text;
}

// 把帶入的值同步到同一列的輸入框（草稿不進計算，所以不用重畫）
function syncDraftInputs(input, draft) {
  const form = formOfInput(input);
  if (!form || !draft) return;
  const portInput = form.querySelector('input[data-draft="port"]');
  if (portInput) portInput.value = draft.port || '';
  const pcsInput = form.querySelector('input[data-draft="pcs"]');
  if (pcsInput) pcsInput.value = draft.pcs || '';
  const weightInput = form.querySelector('input[data-draft="declared_weight"]');
  if (weightInput) weightInput.value = draft.declared_weight || '';
}

function applyBooking(input, label) {
  const unit = unitOfInput(input);
  if (!unit) return;
  unit.draft = unit.draft || {};
  const row = bookingByLabel(label);

  if (!row) {
    // 例如清單已被重新整理過：至少把 MAWB 寫回輸入框，其餘手動輸入
    const mawb = bookingLabelMawb(label);
    unit.draft.mawb = mawb;
    unit.draft.mawb_record_id = null;
    input.value = mawb;
    setHint(input, '');
    return;
  }

  const values = bookingDraftValues(row);
  unit.draft.mawb = values.mawb;
  unit.draft.pcs = values.pcs;
  unit.draft.declared_weight = values.declared_weight;
  unit.draft.mawb_record_id = values.mawb_record_id;
  // 使用者已手動填 Port 就不覆蓋（Port 不檢核）
  if (!unit.draft.port) unit.draft.port = values.port;

  input.value = values.mawb;
  syncDraftInputs(input, unit.draft);
  setHint(
    input,
    `已帶入 Booking #${row.id}：${row.dest || '-'}　${values.pcs || 0} 件　${uldFmtKg(row.gross_weight)} kg（可再修改）`
  );
}

// 在每張收貨單位卡的「新增 MAWB」列接上輸入即篩選（render 後呼叫；鎖定的表不會有輸入框）
export function wireBookingPickers(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const setup = (typeof window !== 'undefined' && typeof window.setupAutocomplete === 'function')
    ? window.setupAutocomplete
    : null;
  if (!setup) return; // 沒有共用 autocomplete 就退回純手動輸入

  const inputs = root.querySelectorAll('.uldw-item-add input[data-draft="mawb"]');
  Array.prototype.forEach.call(inputs, input => {
    setup({
      input,
      suggestions: () => bookingSuggestions(input.value),
      emptyMessage: '沒有相符的 Booking Record，可直接手動輸入 MAWB。',
      onSelect: label => applyBooking(input, label),
      // Tab 只關閉清單（不選取候選）→ 使用者按 Tab 移到下一格時，不會被塞入候選值
      tabSelects: false
    });
    // 手動改字就解除 Booking 連結（重量／件數仍保留，使用者可自行修改）
    input.addEventListener('input', () => {
      const unit = unitOfInput(input);
      if (unit && unit.draft) unit.draft.mawb_record_id = null;
      setHint(input, '');
    });
  });
}
