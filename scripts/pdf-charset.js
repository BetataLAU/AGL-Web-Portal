// ===== SLI/ELI／PDF 文字「字元支援」判定（疊字產生器與建置工具共用）=====
// 三層處理（見 docs/design/xls-sli-eli-overlay-prd.md §文字支援判定）：
//   1) WinAnsi：pdf-lib 標準字型（Helvetica／Helvetica-Bold）可直接編碼的字元
//      ＝ ASCII 0x20–0x7E ＋ Latin-1 0xA0–0xFF ＋ WinAnsiEncoding 0x80–0x9F 的 27 個特殊字
//      （實測 2789 筆歷史資料，`–` U+2013 出現 266 次，舊版把它當「不支援」而整筆退回 Excel）
//   2) 淨化（sanitize）：Excel 自己也不會畫的「不可見」字元 → 直接移除（無損，內容與尺寸都一致）
//   3) 其餘（CJK 漢字、全形標點…）→ 交給 CJK 字型子集（scripts/sli-eli-overlay.js）；
//      環境沒有可用字型時才退回舊 Excel 引擎。
//
// ⚠️ 這一層**不做任何可見字元的替換**（例：不把 `：` 換成 `:`）——那會改動報關文件內容、
//    也會改變字寬使折行與 Excel 不一致。詳見 PRD 的「字元處理政策」。

const ASCII_MIN = 0x20;
const ASCII_MAX = 0x7e;
const LATIN1_MIN = 0xa0;
const LATIN1_MAX = 0xff;

/**
 * WinAnsiEncoding 0x80–0x9F 區的 Unicode → 單一位元組對照表。
 * 與 @pdf-lib/standard-fonts `Encodings.WinAnsi` 的 unicodeMappings 逐筆核對過
 * （scripts/test-sli-eli-charset.js 會再自動核對一次，避免未來升級 pdf-lib 後失真）。
 */
const WINANSI_EXTRA = new Map([
  [0x20ac, 0x80], // Euro
  [0x201a, 0x82], // quotesinglbase
  [0x0192, 0x83], // florin
  [0x201e, 0x84], // quotedblbase
  [0x2026, 0x85], // ellipsis
  [0x2020, 0x86], // dagger
  [0x2021, 0x87], // daggerdbl
  [0x02c6, 0x88], // circumflex
  [0x2030, 0x89], // perthousand
  [0x0160, 0x8a], // Scaron
  [0x2039, 0x8b], // guilsinglleft
  [0x0152, 0x8c], // OE
  [0x017d, 0x8e], // Zcaron
  [0x2018, 0x91], // quoteleft
  [0x2019, 0x92], // quoteright
  [0x201c, 0x93], // quotedblleft
  [0x201d, 0x94], // quotedblright
  [0x2022, 0x95], // bullet
  [0x2013, 0x96], // endash
  [0x2014, 0x97], // emdash
  [0x02dc, 0x98], // tilde
  [0x2122, 0x99], // trademark
  [0x0161, 0x9a], // scaron
  [0x203a, 0x9b], // guilsinglright
  [0x0153, 0x9c], // oe
  [0x017e, 0x9e], // zcaron
  [0x0178, 0x9f], // Ydieresis
]);

/** WinAnsi 特殊字的 codepoint 清單（供建置腳本的「字符集匯出」使用） */
const WINANSI_EXTRA_CODES = Array.from(WINANSI_EXTRA.keys());

/** 標準字型（WinAnsi）可直接編碼的 codepoint 集合 */
const STD_FONT_CHARS = new Set([
  ...[0x09, 0x0a, 0x0d],
  ...Array.from({ length: ASCII_MAX - ASCII_MIN + 1 }, (_, i) => ASCII_MIN + i),
  ...Array.from({ length: LATIN1_MAX - LATIN1_MIN + 1 }, (_, i) => LATIN1_MIN + i),
  ...WINANSI_EXTRA.keys(),
]);

/** 該 codepoint 是否可用 pdf-lib 標準字型（WinAnsi）正確輸出 */
function isStdFontChar(code) {
  return STD_FONT_CHARS.has(code);
}

/** 字串是否全部可由標準字型輸出（true ＝ 不需要 CJK 字型） */
function isStdFont(text) {
  if (text === null || text === undefined) return true;
  for (const ch of String(text)) {
    if (!isStdFontChar(ch.codePointAt(0))) return false;
  }
  return true;
}

/** codepoint → WinAnsi 單一位元組；不可編碼回 -1 */
function winAnsiByte(code) {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return code;
  if ((code >= ASCII_MIN && code <= ASCII_MAX) || (code >= LATIN1_MIN && code <= LATIN1_MAX)) return code;
  const b = WINANSI_EXTRA.get(code);
  return b === undefined ? -1 : b;
}

/**
 * 文字 → WinAnsi 十六進位字串（供「原始內容流 + Tj」路徑使用；不可編碼 → '?' 0x3F）。
 * 注意：這裡輸出的是**位元組**，所以 WinAnsi 特殊字（例 U+2013 → 0x96）必須走對照表。
 */
function winAnsiHex(text) {
  let hex = '';
  for (const ch of String(text === null || text === undefined ? '' : text)) {
    const b = winAnsiByte(ch.codePointAt(0));
    hex += (b < 0 ? 0x3f : b).toString(16).padStart(2, '0');
  }
  return hex.toUpperCase();
}

// ===== 第 0 層：無損淨化（只處理「Excel 也不會畫」的不可見字元）=====
// 1) 行分隔符號（U+0085 / U+2028 / U+2029）→ `\n`（換行語意相同）
// 2) 零寬／格式字元（ZWSP/ZWNJ/ZWJ/LRM/RLM/WJ、deprecated 格式字、蒙古母音分隔）→ 移除
// 3) C0 控制字元（保留 TAB/LF/CR）與 DEL → 移除
// 4) 變體選擇器（U+FE00–FE0F）與 BOM（U+FEFF）→ 移除
// 刻意**不**處理：U+00AD soft hyphen（WinAnsi 可編碼、Excel 亦不顯示）、U+3000 全形空白、
// U+00A0 NBSP（皆為可見寬度 → 不屬於無損範圍）。
const LINE_SEP_RE = /[\u0085\u2028\u2029]/g;
const INVISIBLE_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u180e\u200b-\u200f\u2060-\u2064\u206a-\u206f\ufe00-\ufe0f\ufeff]/g;

/** 淨化字串：回傳「可安全比對／繪製」的版本 */
function sanitizeText(input) {
  if (input === null || input === undefined) return '';
  return String(input).replace(LINE_SEP_RE, '\n').replace(INVISIBLE_RE, '');
}

/**
 * 找出不支援的字元（去重）；回傳 [{ch, code, count}]
 * @param {string} text
 * @param {(code:number)=>boolean} [isSupported] 預設＝標準字型；疊字引擎會傳入「標準字型 or CJK 字型涵蓋」
 */
function findUnsupportedChars(text, isSupported = isStdFontChar) {
  if (text === null || text === undefined) return [];
  const map = new Map();
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (isSupported(code)) continue;
    const e = map.get(ch);
    if (e) e.count += 1;
    else map.set(ch, { ch, code, count: 1 });
  }
  return Array.from(map.values());
}

module.exports = {
  ASCII_MIN,
  ASCII_MAX,
  LATIN1_MIN,
  LATIN1_MAX,
  WINANSI_EXTRA,
  WINANSI_EXTRA_CODES,
  STD_FONT_CHARS,
  isStdFontChar,
  isStdFont,
  winAnsiByte,
  winAnsiHex,
  sanitizeText,
  findUnsupportedChars,
};
