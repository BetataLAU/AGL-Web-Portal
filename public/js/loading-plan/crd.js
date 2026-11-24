// ===== 執 PLAN：CRD（Cargo Ready Date）純函式 =====
// 畫面格式固定 DDMMM（例 24NOV），DB 存 ISO（YYYY-MM-DD）。
// 年份推斷／±N 日／Flight Date 檢核都放在 calc.js（前後端共用），
// 這裡只處理「鍵盤 ↑↓」與「手動輸入字串」兩種操作 → 回傳 { iso, text, issue }。
import { lpCrdToIso, lpFormatCrd, lpShiftIsoDate, lpCrdIssue, lpTodayIso } from './calc.js';

export const LP_CRD_DIRECTIONS = ['up', 'down'];

// 鍵盤 ↑ = +1 日、↓ = −1 日（跨月／跨年自動）
// 例：今天 30NOV，↑ → 01DEC；01DEC 按 ↓ → 30NOV。
// 回傳 null＝無法推算（值壞掉且沒有 Flight Date／今天可參考）。
export function lpCrdStep(value, direction, flightDate, todayIso = lpTodayIso()) {
  const delta = direction === 'up' ? 1 : direction === 'down' ? -1 : 0;
  if (!delta) return null;
  const ref = String(flightDate || '').trim() || todayIso;
  const base = lpCrdToIso(value, ref) || lpCrdToIso(flightDate, ref) || ref;
  const iso = lpShiftIsoDate(base, delta, ref);
  if (!iso) return null;
  return { iso, text: lpFormatCrd(iso), issue: lpCrdIssue(iso, flightDate) };
}

// 手動輸入：'24'（只給日，月份沿用這格原本的值／Flight Date）／'24NOV'／'24/11'／'YYYY-MM-DD'
// 回傳 null＝格式錯誤；空白＝清除（iso: ''）。
export function lpCrdParseInput(text, flightDate, currentValue = '', todayIso = lpTodayIso()) {
  const ref = String(flightDate || '').trim() || todayIso;
  const raw = String(text === null || text === undefined ? '' : text).trim();
  if (!raw) return { iso: '', text: '', issue: '' };
  // 只輸入日（例 24）：月份／年份沿用這格原本的值（沒有就用 Flight Date／今天）
  let value = raw;
  if (/^\d{1,2}$/.test(raw)) {
    const base = lpCrdToIso(currentValue, ref) || lpCrdToIso(flightDate, ref) || ref;
    value = `${raw}${lpFormatCrd(base).slice(2)}`;
  }
  const iso = lpCrdToIso(value, ref);
  if (!iso) return null;
  return { iso, text: lpFormatCrd(iso), issue: lpCrdIssue(iso, flightDate) };
}
