// ===== Shipper Role Project - SLI / ELI 疊字產生器（P3）=====
// 職責：把 10 個動態欄位（依 data/templates/sli-eli-fieldmap.json 的座標）用 pdf-lib
//       疊到 data/templates/sli-eli-blank.pdf（A4、2 頁）上，輸出 {MAWB}.pdf。
//       **不需 Excel / Python / LibreOffice / 不需要 merge**（背景本身就是 SLI+ELI 兩頁）。
//
// 定位精度基礎（P2 建置期產物，勿自行推算）：
//   fieldmap 座標系＝pt、原點在頁面左上（x 右、y 下）；
//   origin＝Excel 實際文字錨點（依對齊取邊界）、textBaselineOffsetPt＝baseline 相對 origin.y、
//   box.w＝換行寬度、lineHeightPt＝行高、align＝對齊、wrap＝是否自動折行。
//   錨定邊殘差 0.00 pt（見 sli-eli-blank-meta.json）。
//
// 字型：pdf-lib 標準字型 Helvetica / Helvetica-Bold（0 byte、與 Arial 公制相容）。
//   ⚠️ 動態文字含 Latin-1 以外的字元（例：CNEE 的中文或全形標點 `，` `（`）時，
//      該筆 **不畫**（避免亂碼），回傳 status='fallback' 交由呼叫端退回舊 Excel 引擎。
//
// 用法（P4 之後由 xls-workflow.js 呼叫；在此之前用 scripts/test-sli-eli-overlay.js 驗證）：
//   const { renderRecord } = require('./sli-eli-overlay');
//   const r = await renderRecord({ mawb, sli:{D23:...}, eli:{F8:...} }, outPath);
//   if (r.status === 'fallback') { /* 退回舊引擎 */ }

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const zlib = require('zlib');
const { PDFDocument, StandardFonts, rgb, PDFName, PDFDict, PDFNumber, PDFArray, PDFRawStream } = require('pdf-lib');

// ===== 路徑與常數 =====
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TEMPLATES_DIR = path.join(DATA_DIR, 'templates');
const DEFAULT_BLANK_PDF = path.join(TEMPLATES_DIR, 'sli-eli-blank.pdf');
const DEFAULT_FIELDMAP = path.join(TEMPLATES_DIR, 'sli-eli-fieldmap.json');
const A4_SIZE = { width: 595.28, height: 841.89 };
const A4_TOLERANCE_PT = 1;

// ===== Latin-1（WinAnsi 可印）判定 =====
// 允許：TAB / LF / CR、0x20–0x7E（ASCII 可印）、0xA0–0xFF（Latin-1 補充，WinAnsi 直接對應）。
// 其餘（CJK、全形標點、WinAnsi 特殊字 U+2018 等）一律視為不支援 → 退回舊引擎。
function isLatin1Char(code) {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff);
}

/** 是否全部字元都可安全用 Helvetica（Latin-1）繪製 */
function isLatin1(text) {
  if (text === null || text === undefined) return true;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    if (!isLatin1Char(s.charCodeAt(i))) return false;
  }
  return true;
}

/** 找出不支援的字元（去重）；回傳 [{ch, code, count}] */
function findUnsupportedChars(text) {
  if (text === null || text === undefined) return [];
  const s = String(text);
  const map = new Map();
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (isLatin1Char(code)) continue;
    const key = s[i];
    const e = map.get(key);
    if (e) e.count += 1;
    else map.set(key, { ch: s[i], code, count: 1 });
  }
  return Array.from(map.values());
}

// ===== 值正規化 =====
/** Date → 本地 YYYY-MM-DD（與 xls-workflow 的 recordsPayload 一致；勿用 toISOString，UTC+8 會少一天） */
function dateToLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 任意值 → 繪製用字串（換行統一為 \n、TAB → 4 空白） */
function toText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : dateToLocalISO(value);
  return String(value).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
}

// ===== Excel 日期顯示（重要）=====
// 舊引擎把 payload 的 'YYYY-MM-DD' 字串寫進 Excel 日期格，Excel 會套用儲存格的數字格式顯示，
// 實測（job-zRSCW0 參考 PDF）：D72/N57 都顯示成 `03/Oct/2026`（dd/MMM/yyyy、英文月份）。
// 疊字必須輸出相同字串，否則 PDF 內容與舊引擎不一致。
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 解析 Date / 'YYYY-MM-DD' / 'dd/MMM/yyyy' / ISO 字串；無法解析回傳 null */
function parseDateValue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value === null || value === undefined ? '' : value).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})([T ].*)?$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS_EN.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
    if (mi >= 0) return new Date(Number(m[3]), mi, Number(m[1]));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 依 Excel 數字格式樣式輸出日期（支援 yyyy / mmm / mm / dd / m / d）。
 * 無法解析日期時原樣回傳（Excel 對純文字也是原樣顯示）。
 */
function formatExcelDate(value, pattern) {
  const d = parseDateValue(value);
  if (!d) return toText(value);
  return String(pattern).replace(/yyyy|mmm|mm|dd|m|d/gi, (t) => {
    switch (t.toLowerCase()) {
      case 'yyyy': return String(d.getFullYear());
      case 'mmm': return MONTHS_EN[d.getMonth()];
      case 'mm': return String(d.getMonth() + 1).padStart(2, '0');
      case 'dd': return String(d.getDate()).padStart(2, '0');
      case 'm': return String(d.getMonth() + 1);
      case 'd': return String(d.getDate());
      default: return t;
    }
  });
}

/** 欄位最終要畫的字串（含日期格式化） */
function fieldText(rec, field) {
  const raw = resolveFieldValue(rec, field);
  if (field && field.dateFormat) return toText(formatExcelDate(raw, field.dateFormat));
  return toText(raw);
}

/**
 * 由記錄取出欄位值。同時支援兩種記錄格式：
 *   1) 平鋪：{ mawb, dest, flightCompany, flightDate, cnee, cneeTel }
 *   2) payload 風格（xls-workflow 既有格式）：{ mawb, sli:{D23,D25,D27,D9,D72}, eli:{F8,P11,M16,N21,N57} }
 * 取用順序：平鋪 `rec[field.source]` → payload `rec[sli|eli][cell]` → ''（空字串表示不畫）。
 */
function resolveFieldValue(rec, field) {
  if (!rec) return '';
  const v = rec[field.source];
  if (v !== undefined && v !== null && v !== '') return v;
  const key = String(field.key || '');
  const dot = key.indexOf('.');
  if (dot > 0) {
    const bag = rec[key.slice(0, dot)];
    const cell = key.slice(dot + 1);
    if (bag && bag[cell] !== undefined && bag[cell] !== null) return bag[cell];
  }
  return v === undefined || v === null ? '' : v;
}

// ===== 排版（換行／對齊／baseline）=====
// 這組函式是「編輯器看到什麼 == PDF 長什麼」的唯一依據，P5 版面編輯器必須共用同一份。
function fontFor(field, fonts) {
  const wantBold = !!(field.font && field.font.bold);
  return wantBold ? fonts.bold : fonts.regular;
}

function fontSizeOf(field) {
  const s = field.font && Number(field.font.sizePt);
  return s && s > 0 ? s : 8;
}

function lineHeightOf(field) {
  const lh = Number(field.lineHeightPt);
  return lh > 0 ? lh : fontSizeOf(field) * 1.2;
}

/** 單字超寬時的硬切（Excel 對超長單字也是直接斷行） */
function hardBreakToken(token, font, size, maxWidth) {
  const parts = [];
  let cur = '';
  for (const ch of token) {
    const next = cur + ch;
    if (cur && font.widthOfTextAtSize(next, size) > maxWidth) {
      parts.push(cur);
      cur = ch;
    } else {
      cur = next;
    }
  }
  if (cur !== '') parts.push(cur);
  return parts.length ? parts : [''];
}

/** 單一段落折行（貪婪式、以空白斷詞；空段落回 ['']） */
function wrapParagraph(para, font, size, maxWidth) {
  if (para === '') return [''];
  if (!(maxWidth > 0)) return [para];
  const words = para.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (!cur || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      if (!cur && font.widthOfTextAtSize(word, size) > maxWidth) {
        const parts = hardBreakToken(word, font, size, maxWidth);
        for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
        cur = parts[parts.length - 1];
      } else {
        cur = candidate;
      }
    } else {
      lines.push(cur);
      cur = word;
      if (font.widthOfTextAtSize(cur, size) > maxWidth) {
        const parts = hardBreakToken(cur, font, size, maxWidth);
        for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
        cur = parts[parts.length - 1];
      }
    }
  }
  lines.push(cur);
  return lines;
}

/**
 * 折行寬度：優先 `wrapWidthPt`（Excel 實際可用寬度，實測校準），否則退回 `box.w`（編輯器顯示框）。
 * 實測差異：合併格寬（A4 校正後）比 Excel 實際可用寬度大約 4~5pt（左右內距），
 * 直接用 box.w 會讓 Excel 已斷行的長字串（例：M16 的 CNEE）不斷行 → 行數不符。
 */
function wrapWidthOf(field) {
  const w = Number(field.wrapWidthPt);
  if (w > 0) return w;
  return field.box && Number(field.box.w) > 0 ? Number(field.box.w) : 0;
}

/**
 * 折行：先依明確換行（\n）分段，再依可用寬度折行；最後套 maxLines 上限。
 * @returns {string[]} 每一行的文字（可能為空字串，代表空行）
 */
function wrapText(text, field, font) {
  const size = fontSizeOf(field);
  const wrap = !!field.wrap;
  const maxWidth = wrapWidthOf(field);
  const maxLines = Number(field.maxLines) > 0 ? Math.floor(Number(field.maxLines)) : 0;
  const out = [];
  for (const para of toText(text).split('\n')) {
    if (wrap && maxWidth > 0) {
      for (const line of wrapParagraph(para, font, size, maxWidth)) out.push(line);
    } else {
      out.push(para);
    }
  }
  // 去掉尾端空白行（Excel 不會為尾端空行留位）
  while (out.length > 1 && out[out.length - 1].trim() === '') out.pop();
  if (maxLines > 0 && out.length > maxLines) out.length = maxLines;
  return out.map((l) => l.replace(/[ \t]+$/, ''));
}

/**
 * 依 origin / align / lineHeightPt / textBaselineOffsetPt 計算每行的繪製位置。
 * @returns {{text:string, x:number, baseline:number}[]} baseline 為「左上原點、y 向下」座標
 */
function layoutLines(lines, field, font) {
  const size = fontSizeOf(field);
  const lh = lineHeightOf(field);
  const origin = field.origin || { x: 0, y: 0 };
  const align = field.align || { h: 'left', v: 'top' };
  const n = lines.length;
  // 垂直：top 由 origin.y 往下；center 以 origin.y 為區塊中心；bottom 以 origin.y 為區塊底部
  const blockShift = align.v === 'center' ? -((n - 1) * lh) / 2
    : align.v === 'bottom' ? -((n - 1) * lh)
      : 0;
  const first = origin.y + blockShift + Number(field.textBaselineOffsetPt || 0);
  return lines.map((text, i) => {
    const width = font.widthOfTextAtSize(text, size);
    let x = origin.x;
    if (align.h === 'center') x -= width / 2;
    else if (align.h === 'right') x -= width;
    return { text, x, baseline: first + i * lh };
  });
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return rgb(0, 0, 0);
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255);
}

/**
 * 為 pdf-lib 的標準字型補上 /Widths（**關鍵修正**）。
 *
 * pdf-lib 的 StandardFontEmbedder 只寫 `/Type /Font /Subtype /Type1 /BaseFont /Helvetica
 * /Encoding /WinAnsiEncoding`，**不寫 /FirstChar /LastChar /Widths**。此時檢視器（含 MuPDF）
 * 只能用替代字型自己的度量來排版 → 同一行內每個字符會與 Excel（Arial，公制與 Helvetica 相同）
 * 逐字累積漂移；長字串（CNEE 地址）累積可達 1–2 px，使 150dpi 逐像素差異明顯偏高。
 * 補上 AFM 的 /Widths 後，逐字位置與 Excel 一致（實測 page1 0.638% → 見 PRD）。
 */
function applyWinAnsiWidths(font) {
  font.embed(); // pdf-lib 是延遲嵌入：先建立 font dict 才能補 /Widths
  const ctx = font.doc.context;
  const dict = ctx.lookup(font.ref, PDFDict);
  const first = 32;
  const last = 255;
  const widths = [];
  for (let code = first; code <= last; code++) {
    let w = 0;
    try {
      w = font.widthOfTextAtSize(String.fromCharCode(code), 1000);
    } catch (e) {
      w = 0; // WinAnsi 未定義的碼（127–159）→ 寬度 0（Excel 亦同）
    }
    widths.push(PDFNumber.of(Math.round(w * 100) / 100));
  }
  dict.set(PDFName.of('FirstChar'), PDFNumber.of(first));
  dict.set(PDFName.of('LastChar'), PDFNumber.of(last));
  dict.set(PDFName.of('Widths'), ctx.obj(widths));
  return font;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ===== 沿用背景 PDF 內嵌的 Excel 字型（Arial 子集）=====
// 背景 PDF 是 Excel 匯出（清空動態格 + 字型優化）的結果，已內嵌 Excel 當時用的 Arial 子集
// （ArialMT / Arial-BoldMT、/Encoding /WinAnsiEncoding）。直接以這些「已在檔案內」的資源畫動態文字：
//   1) 不增加任何字型程式 → 檔案大小幾乎不變
//   2) 字形與 Excel 畫的靜態文字同一個字型程式 → 150dpi 逐像素差異大幅下降（見 PRD 實測）
// 限制：子集只含 Excel 靜態內容用到的字符 → 逐字符檢查字型 cmap，未涵蓋即退回標準字型。
// 實作方式：讀者不需新的相依套件；以原始內容流（content stream）加上 Tj 算符。
function readU16(b, o) { return (b[o] << 8) | b[o + 1]; }
function readU32(b, o) { return (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0); }

/** 解析 TTF cmap（format 4 / 12），回傳實際有對應字符的 Unicode codepoint Set */
function parseTtfCmap(buf) {
  const chars = new Set();
  if (!buf || buf.length < 12) return chars;
  const numTables = readU16(buf, 4);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    if (off + 16 > buf.length) break;
    const tag = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
    if (tag === 'cmap') { cmapOff = readU32(buf, off + 8); break; }
  }
  if (!cmapOff || cmapOff + 4 > buf.length) return chars;
  const nSub = readU16(buf, cmapOff + 2);
  for (let i = 0; i < nSub; i++) {
    const rec = cmapOff + 4 + i * 8;
    if (rec + 8 > buf.length) break;
    const sub = cmapOff + readU32(buf, rec + 4);
    if (sub + 2 > buf.length) continue;
    const fmt = readU16(buf, sub);
    if (fmt === 4) {
      const segX2 = readU16(buf, sub + 6);
      const segCount = segX2 / 2;
      const endOff = sub + 14;
      const startOff = endOff + segX2 + 2;
      const deltaOff = startOff + segX2;
      const rangeOff = deltaOff + segX2;
      for (let s = 0; s < segCount; s++) {
        const end = readU16(buf, endOff + s * 2);
        const start = readU16(buf, startOff + s * 2);
        const delta = readU16(buf, deltaOff + s * 2);
        const ro = readU16(buf, rangeOff + s * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end && c <= 0xffff; c++) {
          let gid;
          if (ro === 0) {
            gid = (c + delta) & 0xffff;
          } else {
            const gi = rangeOff + s * 2 + ro + (c - start) * 2;
            if (gi + 2 > buf.length) continue;
            gid = readU16(buf, gi);
            if (gid !== 0) gid = (gid + delta) & 0xffff;
          }
          if (gid !== 0) chars.add(c);
        }
      }
    } else if (fmt === 12) {
      const nGroups = readU32(buf, sub + 12);
      for (let g = 0; g < nGroups; g++) {
        const o = sub + 16 + g * 12;
        if (o + 12 > buf.length) break;
        const start = readU32(buf, o);
        const end = readU32(buf, o + 4);
        const gid0 = readU32(buf, o + 8);
        if (gid0 === 0) continue;
        for (let c = start; c <= end && c <= 0xffff; c++) chars.add(c);
      }
    }
  }
  return chars;
}

/** 取得（可能壓縮的）stream 內容並解壓（只處理 FlateDecode） */
function streamBytes(stream) {
  let bytes = Buffer.from(stream.getContents());
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  const names = filter instanceof PDFArray
    ? filter.asArray().map((f) => pdfNameStr(f))
    : [pdfNameStr(filter)].filter(Boolean);
  if (names.includes('FlateDecode')) bytes = zlib.inflateSync(bytes);
  return bytes;
}

/** PDFName → 不含前導 '/' 的字串（pdf-lib 的 asString() 會帶 '/'） */
function pdfNameStr(obj) {
  if (!obj || typeof obj.asString !== 'function') return '';
  return String(obj.asString()).replace(/^\//, '');
}

/** 找出頁面上 Excel 內嵌的 Arial 字型資源（含 cmap 覆蓋範圍）；找不到回傳 null */
function findEmbeddedExcelFonts(page, doc) {
  const res = page.node.Resources();
  const fontDict = res && res.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fontDict) return null;
  const found = { regular: null, bold: null };
  for (const [key, value] of fontDict.entries()) {
    const fd = value instanceof PDFDict ? value : doc.context.lookup(value, PDFDict);
    if (!fd) continue;
    const base = pdfNameStr(fd.get(PDFName.of('BaseFont')));
    if (!/Arial(-Bold)?MT/.test(base)) continue; // 只認 Excel 用的 Arial 子集
    const enc = pdfNameStr(fd.get(PDFName.of('Encoding')));
    if (enc && enc !== 'WinAnsiEncoding') continue; // 只支援單一位元組 WinAnsi 編碼
    let chars = null;
    const desc = doc.context.lookupMaybe(fd.get(PDFName.of('FontDescriptor')), PDFDict);
    if (desc) {
      const ff = doc.context.lookup(desc.get(PDFName.of('FontFile2')));
      if (ff && typeof ff.getContents === 'function') {
        try { chars = parseTtfCmap(streamBytes(ff)); } catch (e) { chars = null; }
      }
    }
    if (!chars || !chars.size) continue;
    const entry = { resName: pdfNameStr(key), baseFont: base, chars };
    if (/Bold/.test(base)) { if (!found.bold) found.bold = entry; } else if (!found.regular) found.regular = entry;
  }
  return found.regular || found.bold ? found : null;
}

/** Latin-1 可印字元 → WinAnsi 單一位元組（與字型 /Encoding /WinAnsiEncoding 一致） */
function winAnsiHex(text) {
  let hex = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    hex += (c > 0xff ? 0x3f : c).toString(16).padStart(2, '0'); // 理論上不會發生（已先擋非 Latin-1）
  }
  return hex.toUpperCase();
}

function fmtNum(n) {
  return String(Math.round(n * 10000) / 10000);
}

/** 檔名安全化（MAWB 正常形如 065-12345678，防萬一） */
function safeFileName(name) {
  return String(name || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
}

// ===== 引擎 =====
/**
 * 建立疊字引擎（載入背景 PDF + fieldmap，之後每筆渲染共用）。
 * @param {{blankPdf?:string, fieldmap?:string, strict?:boolean, logger?:object}} options
 */
async function createOverlayEngine(options = {}) {
  const blankPdf = options.blankPdf || process.env.SLI_ELI_BLANK_PDF || DEFAULT_BLANK_PDF;
  const fieldmapPath = options.fieldmap || process.env.SLI_ELI_FIELDMAP || DEFAULT_FIELDMAP;
  const logger = options.logger || console;
  // 選用：自訂 /BaseFont 名稱（例：讓檢視器以系統 Arial 取代 Helvetica；預設不啟用）
  const fontCustomNames = options.fontCustomNames || null;

  const blankBytes = await fsp.readFile(blankPdf);
  const fieldmap = JSON.parse(await fsp.readFile(fieldmapPath, 'utf-8'));
  const fields = Array.isArray(fieldmap.fields) ? fieldmap.fields : [];
  if (!fields.length) throw new Error(`fieldmap 無欄位資料：${fieldmapPath}`);

  // 背景只載入一次；每筆渲染以 copyPages 複製到新文件（不改動來源 → 可安全共用）
  const tplDoc = await PDFDocument.load(blankBytes, { ignoreEncryption: true, updateMetadata: false });
  const pageSizes = tplDoc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width, height };
  });
  if (pageSizes.length < 2) {
    throw new Error(`背景 PDF 需 2 頁（SLI+ELI），實測 ${pageSizes.length} 頁：${blankPdf}`);
  }

  // 過期／完整性偵測（模板或背景變更後 fieldmap 座標可能失效）
  const issues = [];
  const blankSha256 = sha256(blankBytes);
  if (fieldmap.blankPdfSha256 && fieldmap.blankPdfSha256 !== blankSha256) {
    issues.push('背景 PDF 與 fieldmap.blankPdfSha256 不符（fieldmap 可能已過期，請重跑 build-sli-eli-blank.py）');
  }
  const badFields = fields.filter((f) => !f.origin || !f.font || !f.align);
  if (badFields.length) issues.push(`欄位缺少 origin/font/align：${badFields.map((f) => f.key).join(', ')}`);
  if (options.strict && issues.length) throw new Error(`疊字引擎資產檢查失敗：${issues.join('；')}`);
  if (issues.length && logger && logger.warn) issues.forEach((m) => logger.warn(`[sli-eli-overlay] ${m}`));

  const fieldsByPage = [];
  for (const f of fields) {
    const pi = Number(f.page) || 0;
    (fieldsByPage[pi] = fieldsByPage[pi] || []).push(f);
  }
  let measureFonts = null; // layout() 量測字寬用（丟棄式文件）

  // 沿用背景內嵌的 Excel Arial 子集（fontMode='auto' 時優先使用）
  const fontMode = options.fontMode === 'standard' ? 'standard' : 'auto';
  const embeddedFonts = tplDoc.getPages().map((p, i) => {
    try {
      return findEmbeddedExcelFonts(p, tplDoc);
    } catch (e) {
      issues.push(`page ${i} 讀取內嵌 Arial 字型失敗：${e.message}`);
      return null;
    }
  });

  const engine = {
    blankPdf,
    fieldmapPath,
    fieldmap,
    fields,
    fieldsByPage,
    pageSizes,
    blankSha256,
    blankBytes: blankBytes.length,
    issues,
    fontMode,
    embeddedFonts,
    fontNames: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold },

    /** 檢查記錄是否需要退回舊引擎（不繪製） */
    check(rec) {
      const unsupported = [];
      for (const field of fields) {
        const text = fieldText(rec, field);
        const bad = findUnsupportedChars(text);
        if (bad.length) {
          unsupported.push({
            key: field.key,
            source: field.source,
            label: field.label || field.key,
            chars: bad,
            sample: bad.map((b) => b.ch).join(''),
          });
        }
      }
      return { ok: unsupported.length === 0, unsupported };
    },

    /** 依欄位順序回傳記錄的欄位文字（供除錯／驗證） */
    values(rec) {
      return fields.map((field) => ({ key: field.key, value: fieldText(rec, field) }));
    },

    /** 只做排版（不繪製）；供 P5 編輯器預覽與驗證腳本檢查折行結果 */
    async layout(rec) {
      const fonts = await engine.measureFonts();
      return fields.map((field) => {
        const value = fieldText(rec, field);
        const font = fontFor(field, fonts);
        const lines = value.trim() === '' ? [] : wrapText(value, field, font);
        return {
          key: field.key,
          page: field.page,
          source: field.source,
          value,
          lines,
          positions: lines.length ? layoutLines(lines, field, font) : [],
          sizePt: fontSizeOf(field),
          lineHeightPt: lineHeightOf(field),
        };
      });
    },

    /**
     * 量測用字型（與繪製用的標準字型同一份公制；pdf-lib 的字型綁定文件，
     * 因此用一個丟棄式 PDFDocument 產生，專供 layout() 量測字寬）。
     */
    async measureFonts() {
      if (!measureFonts) {
        const tmp = await PDFDocument.create();
        measureFonts = {
          regular: await tmp.embedFont(StandardFonts.Helvetica),
          bold: await tmp.embedFont(StandardFonts.HelveticaBold),
        };
      }
      return measureFonts;
    },
  };

  return Object.assign(engine, makeRenderer(engine, tplDoc, fontCustomNames));
}

/**
 * 以背景已內嵌的 Excel 字型資源繪製文字（附加一個原始 content stream）。
 * 使用 WinAnsi 單一位元組編碼，與該字型的 /Encoding 一致 → 文字仍可抽取／搜尋。
 * @param {import('pdf-lib').PDFPage} page
 * @param {import('pdf-lib').PDFDocument} out
 * @param {Array<{text:string,x:number,y:number,size:number,bold:boolean}>} items
 * @param {{regular:object,bold:object}} embedded
 */
function drawWithEmbeddedFont(page, out, items, embedded) {
  const ops = ['q', '0 g'];
  for (const it of items) {
    const fe = it.bold ? embedded.bold : embedded.regular;
    ops.push(`BT /${fe.resName} ${fmtNum(it.size)} Tf 1 0 0 1 ${fmtNum(it.x)} ${fmtNum(it.y)} Tm `
      + `<${winAnsiHex(it.text)}> Tj ET`);
  }
  ops.push('Q');
  const bytes = Buffer.from(ops.join('\n'), 'latin1');
  const stream = PDFRawStream.of(out.context.obj({ Length: bytes.length }), new Uint8Array(bytes));
  page.node.addContentStream(out.context.register(stream));
}

/**
 * 渲染方法（與 engine 分開定義，避免 createOverlayEngine 過長）。
 * @param {object} engine 引擎（需 fields/fieldsByPage/check/pageSizes）
 * @param {import('pdf-lib').PDFDocument} tplDoc 已載入的背景 PDF（只讀）
 * @param {{regular?:string,bold?:string}|null} fontCustomNames 自訂 /BaseFont 名稱
 */
function makeRenderer(engine, tplDoc, fontCustomNames) {
  const { fieldsByPage } = engine;

  const api = {
    /**
     * 產生單筆 {MAWB}.pdf。
     * @param {object} rec 記錄（平鋪或 payload 風格）
     * @param {string} [outputPath] 若未給，只回傳 bytes（不寫檔）
     * @returns {Promise<object>} status='ok'：{ file, bytes, ms, pages, sizes, mawb }
     *                            status='fallback'：{ reason:'non-latin1', unsupported, message, ms, mawb }
     */
    async render(rec, outputPath) {
      const t0 = process.hrtime.bigint();
      const mawb = String((rec && rec.mawb) || '').trim();
      const elapsedMs = () => Number(process.hrtime.bigint() - t0) / 1e6;

      const check = engine.check(rec);
      if (!check.ok) {
        const detail = check.unsupported
          .map((u) => `${u.label}${u.sample ? `（含 ${u.sample}）` : ''}`).join('、');
        return {
          status: 'fallback',
          reason: 'non-latin1',
          mawb,
          file: null,
          bytes: 0,
          ms: elapsedMs(),
          unsupported: check.unsupported,
          message: `需退回舊引擎（Excel COM）：MAWB ${mawb || '(無)'} 的 ${detail} 含非 Latin-1 字元，pdf-lib 標準字型無法正確輸出`,
        };
      }

      const out = await PDFDocument.create();
      const copied = await out.copyPages(tplDoc, tplDoc.getPageIndices());
      for (const p of copied) out.addPage(p);
      const embedOpts = (which) => (fontCustomNames && fontCustomNames[which]
        ? { customName: fontCustomNames[which] } : {});
      const fonts = {
        regular: applyWinAnsiWidths(await out.embedFont(engine.fontNames.regular, embedOpts('regular'))),
        bold: applyWinAnsiWidths(await out.embedFont(engine.fontNames.bold, embedOpts('bold'))),
      };
      const pages = out.getPages();
      const fontPaths = [];
      for (let pi = 0; pi < pages.length; pi++) {
        const page = pages[pi];
        const { height } = page.getSize();
        // 1) 先用標準字型量測（公制與 Arial 相容）排出每一行
        const items = [];
        for (const field of fieldsByPage[pi] || []) {
          const value = fieldText(rec, field);
          if (value.trim() === '') continue;
          const bold = !!(field.font && field.font.bold);
          const size = fontSizeOf(field);
          const font = bold ? fonts.bold : fonts.regular;
          const color = hexToRgb(field.font && field.font.color);
          const isBlack = !(field.font && field.font.color) || /^#?0{6}$/i.test(field.font.color);
          for (const ln of layoutLines(wrapText(value, field, font), field, font)) {
            if (ln.text === '') continue;
            items.push({ text: ln.text, x: ln.x, y: height - ln.baseline, size, bold, color, isBlack });
          }
        }
        // 2) 優先用背景內嵌的 Arial 子集（字形與 Excel 完全相同、0 額外位元組）；
        //    字符未被子集涵蓋或非黑色時，退回標準字型。
        const embedded = engine.fontMode === 'auto' ? engine.embeddedFonts[pi] : null;
        const canUseEmbedded = !!embedded && items.length > 0 && items.every((it) => {
          if (!it.isBlack) return false;
          const fe = it.bold ? embedded.bold : embedded.regular;
          if (!fe) return false;
          for (let i = 0; i < it.text.length; i++) {
            if (!fe.chars.has(it.text.charCodeAt(i))) return false;
          }
          return true;
        });
        if (canUseEmbedded) {
          drawWithEmbeddedFont(page, out, items, embedded);
          fontPaths.push('embedded');
        } else {
          for (const it of items) {
            page.drawText(it.text, {
              x: it.x,
              y: it.y,
              size: it.size,
              font: it.bold ? fonts.bold : fonts.regular,
              color: it.color,
            });
          }
          fontPaths.push(embedded ? 'standard(字符未涵蓋)' : (engine.fontMode === 'standard' ? 'standard' : 'standard(無內嵌Arial)'));
        }
      }
      const bytes = await out.save({ useObjectStreams: true, updateFieldAppearances: false });
      if (outputPath) await fsp.writeFile(outputPath, bytes);
      return {
        status: 'ok',
        mawb,
        file: outputPath || null,
        bytes: bytes.length,
        ms: elapsedMs(),
        pages: pages.length,
        sizes: engine.pageSizes,
        fontPaths,
      };
    },

    /** 便利方法：輸出到 outDir/{MAWB}.pdf（目錄不存在會自動建立） */
    async renderToDir(rec, outDir) {
      await fsp.mkdir(outDir, { recursive: true });
      return api.render(rec, path.join(outDir, `${safeFileName(rec && rec.mawb)}.pdf`));
    },

    /**
     * 批次渲染。回傳 { ok:[...], fallback:[...], errors:[...], ms, totalMs, bytes }
     * 單筆例外不中斷（列入 errors，由呼叫端決定是否退回舊引擎）。
     */
    async renderMany(records, outDir, opts = {}) {
      const t0 = Date.now();
      const result = { ok: [], fallback: [], errors: [], ms: 0, totalMs: 0, bytes: 0 };
      if (outDir) await fsp.mkdir(outDir, { recursive: true });
      const list = records || [];
      let i = 0;
      for (const rec of list) {
        i += 1;
        try {
          const r = await api.render(
            rec,
            outDir ? path.join(outDir, `${safeFileName(rec && rec.mawb)}.pdf`) : undefined,
          );
          if (r.status === 'ok') {
            result.ok.push(r);
            result.bytes += r.bytes;
          } else {
            result.fallback.push(r);
          }
          if (opts.onRecord) opts.onRecord(r, i, list.length);
        } catch (e) {
          const item = { status: 'error', mawb: String((rec && rec.mawb) || ''), message: e.message, ms: 0 };
          result.errors.push(item);
          if (opts.onRecord) opts.onRecord(item, i, list.length);
        }
      }
      result.totalMs = Date.now() - t0;
      result.ms = result.ok.length ? result.totalMs / result.ok.length : 0;
      return result;
    },

    /** 把記錄分成「可疊字」與「需退回舊引擎」兩堆（P4 用） */
    partition(records) {
      const renderable = [];
      const fallback = [];
      for (const rec of records || []) {
        const c = engine.check(rec);
        if (c.ok) renderable.push(rec);
        else fallback.push({ mawb: String((rec && rec.mawb) || ''), unsupported: c.unsupported, record: rec });
      }
      return { renderable, fallback };
    },

    /** 資產摘要（記錄用／除錯用） */
    describe() {
      return {
        blankPdf: engine.blankPdf,
        fieldmapPath: engine.fieldmapPath,
        fieldCount: engine.fields.length,
        pageSizes: engine.pageSizes.map((s) => `${s.width.toFixed(2)}x${s.height.toFixed(2)}`),
        blankBytes: engine.blankBytes,
        blankSha256: engine.blankSha256,
        fonts: engine.fontNames,
        fontMode: engine.fontMode,
        embeddedFonts: engine.embeddedFonts.map((f, i) => (f
          ? `p${i}: ${f.regular ? `${f.regular.resName}=${f.regular.baseFont}(${f.regular.chars.size} chars)` : '-'}`
            + ` / ${f.bold ? `${f.bold.resName}=${f.bold.baseFont}(${f.bold.chars.size} chars)` : '-'}`
          : `p${i}: 無內嵌 Arial（用標準字型）`)),
        issues: engine.issues,
      };
    },
  };

  return api;
}

// ===== 模組層便利 API（延遲建立快取引擎；P4 主流程可直接用單例省下每筆重載背景） =====
let _defaultEnginePromise = null;

/** 取得（並快取）預設引擎 */
function getDefaultEngine(options = {}) {
  if (!_defaultEnginePromise) {
    _defaultEnginePromise = createOverlayEngine(options).catch((err) => {
      _defaultEnginePromise = null; // 失敗不留下壞快取
      throw err;
    });
  }
  return _defaultEnginePromise;
}

/** 便利函式：產生單筆 {MAWB}.pdf（首次呼叫會自動載入背景＋fieldmap） */
async function renderRecord(rec, outputPath, options = {}) {
  const engine = await getDefaultEngine(options);
  return engine.render(rec, outputPath);
}

/** 便利函式：批次產生 */
async function renderRecords(records, outDir, options = {}) {
  const engine = await getDefaultEngine(options);
  return engine.renderMany(records, outDir, options);
}

module.exports = {
  // 常數
  DATA_DIR,
  TEMPLATES_DIR,
  DEFAULT_BLANK_PDF,
  DEFAULT_FIELDMAP,
  A4_SIZE,
  A4_TOLERANCE_PT,
  // 文字支援判定
  isLatin1,
  isLatin1Char,
  findUnsupportedChars,
  toText,
  resolveFieldValue,
  fieldText,
  formatExcelDate,
  parseDateValue,
  // 排版（P5 版面編輯器共用）
  wrapText,
  wrapParagraph,
  wrapWidthOf,
  layoutLines,
  fontSizeOf,
  lineHeightOf,
  // 引擎
  createOverlayEngine,
  getDefaultEngine,
  renderRecord,
  renderRecords,
  safeFileName,
  // 字型（診斷／測試用）
  parseTtfCmap,
  findEmbeddedExcelFonts,
  applyWinAnsiWidths,
};

