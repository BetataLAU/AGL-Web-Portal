// ===== ULD 夾重表 → server 端 PDF（A4 直式，固定排版）=====
// 用途：GET /api/uld-weight/sheets/:id/report.pdf（R1）。與前端「🖨 列印」（W4 的 @media print）
// 並存：列印受瀏覽器／印表機設定影響，這支給「固定版面、可批次產檔／寄送」用。
//
// 重要限制
//   1) 這裡**不得**另寫一套夾重算法：傳入的 detail 一律來自 routes/uld-weight.js 的
//      loadSheetDetail()（即 calc.js 的計算結果），本模組只負責排版。
//   2) 中文字型沿用 scripts/pdf-cjk-font.js 的 fontkit 按需子集（`.ttc` 需自行挑單一字型，
//      見該檔的坑說明）；找不到字型／字型缺字時退回標準字型並以 '?' 取代，不會讓請求失敗。
//   3) 環境變數 PDF_CJK=off 可停用 CJK 子集（中文會變 '?'，供極端環境除錯）。
const {
  PDFDocument, StandardFonts, rgb, PDFFont, CustomFontSubsetEmbedder
} = require('pdf-lib');
const { isStdFont, isStdFontChar, sanitizeText } = require('./pdf-charset');
const { loadCjkFont } = require('./pdf-cjk-font');

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { top: 30, right: 28, bottom: 34, left: 28 };
const CONTENT_WIDTH = A4.width - MARGIN.left - MARGIN.right;

const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.75, 0.75, 0.75);
const HEAD_BG = rgb(0.93, 0.93, 0.93);

// ===== 字型 =====
let cjkFontPromise = null;

// 載入（並快取）CJK 字型；失敗回 null（→ 中文以 '?' 輸出，仍可下載 PDF）
function getCjkFont() {
  if (process.env.PDF_CJK === 'off') return Promise.resolve(null);
  if (!cjkFontPromise) {
    cjkFontPromise = loadCjkFont()
      .then(font => (font && !font.error ? font : null))
      .catch(() => null);
  }
  return cjkFontPromise;
}

// 把 CJK 字型以「按需子集」嵌入文件（`doc.embedFont` 對 .ttc 會爆 createSubset）
async function embedCjkFont(doc, cjk) {
  try {
    const embedder = new CustomFontSubsetEmbedder(cjk.fontkitFont, cjk.raw, 'CJKSubset');
    const ref = doc.context.nextRef();
    const pdfFont = PDFFont.of(ref, doc, embedder);
    doc.fonts.push(pdfFont); // pdf-lib 在 flush() 時才 embedIntoContext
    return pdfFont;
  } catch (e) {
    console.warn('[uld-weight][pdf] CJK 子集內嵌失敗，改用標準字型：', e.message);
    return null;
  }
}

// 依文字內容挑字型：全部可用 WinAnsi → 標準字型；否則用 CJK 子集
// 回傳 { text, font }（缺字以 '?' 取代，避免 drawText 丟錯）
function makePicker(fonts) {
  return function pick(value) {
    const clean = sanitizeText(value == null ? '' : value);
    if (isStdFont(clean)) return { text: clean, font: fonts.regular };
    if (fonts.cjkPdf && fonts.cjk) {
      let out = '';
      for (const ch of clean) {
        out += fonts.cjk.hasGlyph(ch.codePointAt(0)) ? ch : '?';
      }
      return { text: out, font: fonts.cjkPdf };
    }
    let out = '';
    for (const ch of clean) out += isStdFontChar(ch.codePointAt(0)) ? ch : '?';
    return { text: out, font: fonts.regular };
  };
}

function fmtKg(value) {
  const n = Number(value) || 0;
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function fmtSigned(value) {
  const n = Number(value) || 0;
  return `${n > 0 ? '+' : ''}${fmtKg(n)}`;
}

function fmtPct(value) {
  const n = Number(value) || 0;
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function timestampText(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}


// ===== 畫布（自動換頁）=====
function createPainter(doc, fonts) {
  const pick = makePicker(fonts);
  const painter = {
    doc,
    fonts,
    pick,
    page: null,
    y: 0,
    pages: [],
    width: CONTENT_WIDTH,
    left: MARGIN.left,
    // 開新頁（第一頁也走這裡，統一初始 y）
    newPage() {
      painter.page = doc.addPage([A4.width, A4.height]);
      painter.pages.push(painter.page);
      painter.y = A4.height - MARGIN.top;
      return painter.page;
    },
    // 剩餘高度不足 → 換頁
    ensure(height) {
      if (!painter.page || painter.y - height < MARGIN.bottom) painter.newPage();
    },
    // 在目前 y（視為文字基線上方）畫一行，之後 y -= lineHeight
    line(text, opts = {}) {
      const size = opts.size || 9;
      const lineHeight = opts.lineHeight || size * 1.5;
      painter.ensure(lineHeight);
      const baseline = painter.y - size;
      const { text: safe, font } = pick(text);
      const usedFont = opts.bold && font === fonts.regular ? fonts.bold : font;
      painter.page.drawText(safe, { x: painter.left, y: baseline, size, font: usedFont, color: opts.color || BLACK });
      const width = usedFont.widthOfTextAtSize(safe, size);
      if (opts.right) {
        const { text: rightSafe, font: rightFont } = pick(opts.right);
        painter.page.drawText(rightSafe, {
          x: painter.left + painter.width - rightFont.widthOfTextAtSize(rightSafe, size),
          y: baseline, size, font: rightFont, color: opts.rightColor || BLACK
        });
      }
      painter.y -= lineHeight;
      return width;
    },
    gap(height) { painter.y -= height; },
    rule(opts = {}) {
      painter.ensure(6);
      painter.page.drawLine({
        start: { x: painter.left, y: painter.y },
        end: { x: painter.left + painter.width, y: painter.y },
        thickness: opts.thickness || 0.6,
        color: opts.color || LINE
      });
      painter.y -= opts.after == null ? 6 : opts.after;
    },
    // 表格一列：cells = [{ text, width, align, bold }]
    row(cells, opts = {}) {
      const size = opts.size || 8.5;
      const height = opts.height || 13;
      painter.ensure(height);
      const top = painter.y;
      if (opts.fill) {
        painter.page.drawRectangle({
          x: painter.left, y: top - height, width: painter.width, height, color: opts.fill
        });
      }
      let x = painter.left;
      cells.forEach(cell => {
        const width = cell.width || 0;
        const { text: safe, font } = pick(cell.text == null ? '' : cell.text);
        const usedFont = cell.bold && font === fonts.regular ? fonts.bold : font;
        const textWidth = usedFont.widthOfTextAtSize(safe, size);
        let drawX = x + 3;
        if (cell.align === 'right') drawX = x + width - 3 - textWidth;
        else if (cell.align === 'center') drawX = x + (width - textWidth) / 2;
        painter.page.drawText(safe, {
          x: drawX, y: top - height + 3.4, size, font: usedFont, color: cell.color || BLACK
        });
        x += width;
      });
      if (opts.underline) {
        painter.page.drawLine({
          start: { x: painter.left, y: top - height },
          end: { x: painter.left + painter.width, y: top - height },
          thickness: 0.6,
          color: LINE
        });
      }
      painter.y = top - height;
      return height;
    }
  };
  return painter;
}

// 長字串截斷（表格內不換行，避免版面爆掉）
function fitText(pick, text, size, maxWidth) {
  const { text: safe, font } = pick(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let out = '';
  for (const ch of safe) {
    const { text: probe, font: probeFont } = pick(`${out}${ch}...`);
    if (probeFont.widthOfTextAtSize(probe, size) > maxWidth) break;
    out += ch;
  }
  return `${out}...`;
}

// 明細表欄位（總寬 ≈ 538pt，配合 A4 內容寬 539.28pt）
const ITEM_COLUMNS = [
  { label: 'MAWB#', width: 150, align: 'left' },
  { label: 'Port', width: 50, align: 'left' },
  { label: '件數', width: 45, align: 'right' },
  { label: '申報重量', width: 70, align: 'right' },
  { label: '比例', width: 55, align: 'right' },
  { label: '最終重量', width: 75, align: 'right' },
  { label: 'LIH', width: 55, align: 'center' },
  { label: '夾重', width: 38, align: 'center' }
];

// MAWB 彙總表欄位
const MAWB_COLUMNS = [
  { label: 'MAWB#', width: 158, align: 'left' },
  { label: '件數', width: 50, align: 'right' },
  { label: '原重', width: 80, align: 'right' },
  { label: '夾重後', width: 90, align: 'right' },
  { label: '差額', width: 80, align: 'right' },
  { label: 'Port', width: 80, align: 'left' }
];

function unitTitle(unit) {
  const calc = unit.calc || {};
  const isBulk = calc.kind === 'BULK';
  const name = isBulk ? (unit.bulk_ref || 'BULK') : (unit.uld_number || 'ULD');
  const parts = [`${name}（${unit.predecl_type || (isBulk ? 'B' : 'P')}）`];
  if (unit.contour_code) parts.push(`Contour ${unit.contour_code}`);
  if (unit.port) parts.push(`Port ${unit.port}`);
  parts.push(`件數 ${unit.pcs || 0}`);
  parts.push(`LIH ${unit.lih_type || 'N'}`);
  if (unit.rcl_no) parts.push(`RCL# ${unit.rcl_no}`);
  return parts.join('   ');
}

// ===== U3：單板 Loading Sheet 版面常數與小工具 =====
// 用途：GET /api/uld-weight/sheets/:id/loading-sheet.pdf?unit=<uld_id>
//   - 一板一頁；欄位固定 MAWB／DEST／PCS／WT（WT＝夾重後最終重量）
//   - 表格固定列數（預設 16 列），不足補空白列（現場可手寫）
//   - To＝航班號前兩碼（CX1234 → CX）；Date＝表頭日期（6 Nov 2026）
// 資料一律來自 loadSheetDetail()（含 unit.calc.items 的最終重量），這裡不重算。
const LOADING_COLUMNS = [
  { label: 'MAWB', width: 250, align: 'left' },
  { label: 'DEST', width: 78, align: 'center' },
  { label: 'PCS', width: 70, align: 'right' },
  { label: 'WT', width: 90, align: 'right' }
];
const LOADING_ROWS_PER_PAGE = 16;

// 板序代號：01/A、02/B…27/AA（與前端 render.js 的 unitCode() 同一規則；純顯示）
function unitCodeLabel(index) {
  let n = Math.max(0, Number(index) || 0);
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${String((Number(index) || 0) + 1).padStart(2, '0')}/${letters}`;
}

// 航班號前兩碼＝航空公司代碼（抓不到就空白，紙本可手寫）
function airlineCode(flightNo) {
  const m = String(flightNo || '').trim().toUpperCase().match(/^([A-Z0-9]{2})/);
  return m ? m[1] : '';
}

// '2026-11-06' → '6 Nov 2026'（不用 toISOString，避免 UTC+8 變成前一天）
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function longDate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(value || '');
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`;
}

/**
 * 產生夾重表 PDF。
 * @param {object} detail loadSheetDetail() 的回傳值（表頭 + ulds[].calc + mawbs + issues + totals）
 * @param {{ issueText?: (issue:object)=>string }} [options] issueText：由呼叫端傳入 calc.uldIssueText
 *        （calc.js 是 ESM，這裡不重寫一份中文對照表）
 * @returns {Promise<Uint8Array>}
 */
async function buildUldWeightReportPdf(detail, options = {}) {
  const sheet = detail || {};
  const issueText = typeof options.issueText === 'function'
    ? options.issueText
    : (issue => `${issue && issue.code ? issue.code : ''}${issue && issue.detail ? `：${issue.detail}` : ''}`);

  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cjk = await getCjkFont();
  const cjkPdf = cjk ? await embedCjkFont(doc, cjk) : null;
  const painter = createPainter(doc, { regular, bold, cjk, cjkPdf });
  const pick = painter.pick;

  // ===== 表頭 =====
  painter.newPage();
  painter.line(`ULD 夾重表　${sheet.sheet_no || ''}`, {
    size: 15, bold: true, lineHeight: 22,
    right: sheet.status === 'locked' ? '已鎖定' : '草稿',
    rightColor: GRAY
  });
  painter.line([
    `日期 ${sheet.sheet_date || '-'}`,
    `貨站 ${sheet.terminal || '-'}`,
    `航班 ${[sheet.flight_no, sheet.flight_date].filter(Boolean).join(' / ') || '-'}`,
    `經手人 ${sheet.handler || '-'}`
  ].join('　　'), { size: 9, lineHeight: 14 });
  if (sheet.remark) {
    painter.line(`備註 ${sheet.remark}`, { size: 9, lineHeight: 13, color: GRAY });
  }

  const totals = sheet.totals || {};
  painter.rule({ after: 8 });
  painter.line(
    `合計：單位 ${totals.unitCount || 0}（散貨 ${totals.bulkCount || 0}）｜MAWB ${totals.mawbCount || 0}`
    + `｜件數 ${totals.pcsTotal || 0}｜RCL ${fmtKg(totals.rclTotal)} kg｜Tare ${fmtKg(totals.tareTotal)} kg`
    + `｜淨重 ${fmtKg(totals.netTotal)} kg｜磅差 ${fmtSigned(totals.diffTotal)} kg（${fmtPct(totals.diffPct)}）`,
    { size: 9, lineHeight: 15 }
  );

  // ===== 每個收貨單位（整塊不跨頁）=====
  (sheet.ulds || []).forEach((unit, idx) => {
    const calc = unit.calc || {};
    const items = Array.isArray(calc.items) ? calc.items : [];
    const needed = 3 * 14 + 13 + Math.max(1, items.length) * 12 + 12;
    painter.ensure(needed);
    painter.gap(6);
    painter.rule({ after: 6 });
    painter.line(`#${idx + 1}　${unitTitle(unit)}`, { size: 10, bold: true, lineHeight: 15 });
    painter.line(
      `RCL ${fmtKg(calc.rclGross)} - Tare ${fmtKg(calc.tare)} = 淨重 ${fmtKg(calc.targetNet)} kg`
      + `　｜　申報合計 ${fmtKg(calc.declaredSum)} kg　｜　磅差 ${fmtSigned(calc.diff)} kg（${fmtPct(calc.diffPct)}）`
      + (Math.abs(Number(calc.diffAfterFinal) || 0) > 1e-9
        ? `　｜　與目標差 ${fmtSigned(calc.diffAfterFinal)} kg`
        : ''),
      { size: 9, lineHeight: 14 }
    );
    if (Number(unit.material_weight) > 0) {
      painter.line(`物料 ${fmtKg(unit.material_weight)} kg`, { size: 8.5, lineHeight: 12, color: GRAY });
    }

    painter.row(ITEM_COLUMNS.map(col => ({
      text: col.label, width: col.width, align: col.align === 'right' ? 'right' : 'center', bold: true
    })), { size: 8.5, fill: HEAD_BG });

    items.forEach(item => {
      const ratioText = item.squeeze ? `${((Number(item.ratio) || 0) * 100).toFixed(1)}%` : '-';
      painter.row([
        { text: fitText(pick, item.mawb || '', 8.5, ITEM_COLUMNS[0].width - 6), width: ITEM_COLUMNS[0].width },
        { text: item.port || '', width: ITEM_COLUMNS[1].width },
        { text: String(item.pcs || 0), width: ITEM_COLUMNS[2].width, align: 'right' },
        { text: fmtKg(item.declared), width: ITEM_COLUMNS[3].width, align: 'right' },
        { text: ratioText, width: ITEM_COLUMNS[4].width, align: 'right' },
        { text: fmtKg(item.final), width: ITEM_COLUMNS[5].width, align: 'right' },
        { text: item.lih_type || 'N', width: ITEM_COLUMNS[6].width, align: 'center' },
        { text: item.squeeze ? 'Y' : 'N', width: ITEM_COLUMNS[7].width, align: 'center' }
      ], { size: 8.5, height: 12 });
    });
    if (!items.length) {
      painter.line('（沒有 MAWB 明細）', { size: 8.5, lineHeight: 12, color: GRAY });
    }
  });


  // ===== MAWB 彙總 =====
  const mawbs = Array.isArray(sheet.mawbs) ? sheet.mawbs : [];
  if (mawbs.length) {
    painter.ensure(34 + mawbs.length * 12);
    painter.gap(10);
    painter.rule({ after: 6 });
    painter.line('MAWB 彙總', { size: 10, bold: true, lineHeight: 15 });
    painter.row(MAWB_COLUMNS.map(col => ({
      text: col.label, width: col.width, align: col.align === 'right' ? 'right' : 'center', bold: true
    })), { size: 8.5, fill: HEAD_BG });
    mawbs.forEach(row => {
      painter.row([
        { text: fitText(pick, row.mawb || '', 8.5, MAWB_COLUMNS[0].width - 6), width: MAWB_COLUMNS[0].width },
        { text: String(row.pcs || 0), width: MAWB_COLUMNS[1].width, align: 'right' },
        { text: fmtKg(row.declared), width: MAWB_COLUMNS[2].width, align: 'right' },
        { text: fmtKg(row.final), width: MAWB_COLUMNS[3].width, align: 'right', bold: true },
        { text: fmtSigned(row.diff), width: MAWB_COLUMNS[4].width, align: 'right' },
        { text: (row.ports || []).join('/') || '-', width: MAWB_COLUMNS[5].width }
      ], { size: 8.5, height: 12 });
    });
  }

  // ===== 檢核 =====
  const issues = Array.isArray(sheet.issues) ? sheet.issues : [];
  painter.ensure(40);
  painter.gap(10);
  painter.rule({ after: 6 });
  painter.line('檢核', { size: 10, bold: true, lineHeight: 15 });
  if (!issues.length) {
    painter.line('沒有發現問題', { size: 8.5, lineHeight: 13, color: GRAY });
  }
  issues.forEach(issue => {
    const level = issue.level === 'error' ? '[錯誤]' : '[警示]';
    const label = issue.label ? `${issue.label}：` : '';
    painter.line(`${level} ${label}${issueText(issue)}`, {
      size: 8.5, lineHeight: 13, color: issue.level === 'error' ? BLACK : GRAY
    });
  });

  // ===== 頁尾（頁碼／產生時間）=====
  const generatedAt = timestampText();
  painter.pages.forEach((page, index) => {
    const footer = `${sheet.sheet_no || ''}　第 ${index + 1} / ${painter.pages.length} 頁　產生 ${generatedAt}`;
    const { text: safe, font } = pick(footer);
    page.drawText(safe, { x: MARGIN.left, y: MARGIN.bottom - 14, size: 7.5, font, color: GRAY });
    page.drawLine({
      start: { x: MARGIN.left, y: MARGIN.bottom - 4 },
      end: { x: A4.width - MARGIN.right, y: MARGIN.bottom - 4 },
      thickness: 0.5,
      color: LINE
    });
  });

  return doc.save();
}

/**
 * 產生「單板 Loading Sheet」PDF（U3）。unitId 省略＝每一板各一頁（合成一份）。
 * @param {object} detail loadSheetDetail() 的回傳值
 * @param {{ unitId?: number|null, blankRows?: number }} [options]
 * @returns {Promise<Uint8Array>}
 */
async function buildUldWeightLoadingSheetPdf(detail, options = {}) {
  const sheet = detail || {};
  const onlyUnitId = options.unitId == null ? null : Number(options.unitId);
  const rowsPerPage = Math.max(4, Number(options.blankRows) || LOADING_ROWS_PER_PAGE);

  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cjk = await getCjkFont();
  const cjkPdf = cjk ? await embedCjkFont(doc, cjk) : null;
  const painter = createPainter(doc, { regular, bold, cjk, cjkPdf });
  const pick = painter.pick;

  const allUnits = Array.isArray(sheet.ulds) ? sheet.ulds : [];
  const units = allUnits
    .map((unit, index) => ({ unit, index }))
    .filter(row => onlyUnitId == null || Number(row.unit.id) === onlyUnitId);

  const tableX = MARGIN.left + 26;
  const tableWidth = LOADING_COLUMNS.reduce((sum, col) => sum + col.width, 0);
  const rowHeight = 18;
  const toCode = airlineCode(sheet.flight_no);
  const dateText = longDate(sheet.sheet_date || sheet.flight_date);

  // 外框＋欄線（照舊表的方格）
  function drawTableGrid(top, bottom) {
    painter.page.drawRectangle({
      x: tableX, y: bottom, width: tableWidth, height: top - bottom,
      borderColor: BLACK, borderWidth: 0.8, color: undefined
    });
    let x = tableX;
    LOADING_COLUMNS.slice(0, -1).forEach(col => {
      x += col.width;
      painter.page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.6, color: BLACK });
    });
  }

  units.forEach(({ unit, index }) => {
    const calc = unit.calc || {};
    const items = Array.isArray(calc.items) ? calc.items : [];
    const unitNo = unit.uld_number || unit.bulk_ref || '';
    const contour = unit.contour_code || '';
    const dest = unit.port || (items.find(it => it.port) || {}).port || '';
    const pagesNeeded = Math.max(1, Math.ceil(items.length / rowsPerPage));

    for (let pageIdx = 0; pageIdx < pagesNeeded; pageIdx += 1) {
      painter.newPage();

      // 右上角：板序代號（04/D）
      const codeText = unitCodeLabel(index);
      const codePicked = pick(codeText);
      painter.page.drawText(codePicked.text, {
        x: MARGIN.left + CONTENT_WIDTH - codePicked.font.widthOfTextAtSize(codeText, 13),
        y: painter.y - 13, size: 13, font: codePicked.font, color: BLACK
      });
      painter.gap(26);

      // To（航空公司代碼）／Date
      const labelSize = 10;
      painter.line(`To:   ${toCode}`, { size: labelSize, lineHeight: 22, bold: true });
      const baseY = painter.y + 6;
      painter.page.drawLine({
        start: { x: MARGIN.left + 34, y: baseY },
        end: { x: MARGIN.left + 34 + 190, y: baseY }, thickness: 0.8, color: BLACK
      });
      const dateLine = `Date:   ${dateText}`;
      const datePicked = pick(dateLine);
      painter.page.drawText(datePicked.text, {
        x: MARGIN.left + CONTENT_WIDTH - datePicked.font.widthOfTextAtSize(dateLine, labelSize),
        y: baseY + 6, size: labelSize, font: datePicked.font, color: BLACK
      });
      painter.gap(10);

      painter.line('The Following Consignment (s) are Loaded Inside Pre-Packed Unit', {
        size: 9.5, lineHeight: 20
      });

      // Unit（ULD# / Contour）／Dest
      painter.line(`Unit:   ${unitNo}${contour ? ` / ${contour}` : ''}`, {
        size: 11, lineHeight: 26, bold: true
      });
      const unitY = painter.y + 7;
      painter.page.drawLine({
        start: { x: MARGIN.left + 40, y: unitY },
        end: { x: MARGIN.left + 40 + 210, y: unitY }, thickness: 0.8, color: BLACK
      });
      const destLine = `Dest :   ${dest}`;
      const destPicked = pick(destLine);
      painter.page.drawText(destPicked.text, {
        x: MARGIN.left + CONTENT_WIDTH - destPicked.font.widthOfTextAtSize(destLine, 10),
        y: unitY + 7, size: 10, font: destPicked.font, color: BLACK
      });
      painter.gap(14);

      // 表格（固定列數；不足補空白列）
      const tableTop = painter.y;
      const drawRowLine = () => {
        painter.page.drawLine({
          start: { x: tableX, y: painter.y },
          end: { x: tableX + tableWidth, y: painter.y },
          thickness: 0.5, color: BLACK
        });
      };
      painter.row(LOADING_COLUMNS.map(col => ({
        text: col.label, width: col.width, align: col.align === 'right' ? 'right' : 'center', bold: true
      })), { size: 10, height: rowHeight, fill: HEAD_BG });
      drawRowLine();
      const start = pageIdx * rowsPerPage;
      for (let i = 0; i < rowsPerPage; i += 1) {
        const item = items[start + i];
        painter.row([
          { text: item ? item.mawb || '' : '', width: LOADING_COLUMNS[0].width },
          { text: item ? item.port || dest : '', width: LOADING_COLUMNS[1].width, align: 'center' },
          { text: item ? String(item.pcs || 0) : '', width: LOADING_COLUMNS[2].width, align: 'right' },
          { text: item ? fmtKg(item.final) : '', width: LOADING_COLUMNS[3].width, align: 'right', bold: !!item }
        ], { size: 10, height: rowHeight });
        drawRowLine();
      }
      drawTableGrid(tableTop, painter.y);
      painter.gap(8);

      // 表格下方核對小字
      painter.line(
        `PCS ${calc.pcsSum || 0}　｜　WT ${fmtKg(calc.finalSum)} K　｜　RCL ${fmtKg(calc.rclGross)} K`
        + `${unit.tare_weight ? ` − Tare ${fmtKg(calc.tare)} K` : ''}`
        + `　｜　${sheet.sheet_no || ''}${pagesNeeded > 1 ? `（第 ${pageIdx + 1} / ${pagesNeeded} 頁）` : ''}`,
        { size: 8, lineHeight: 12, color: GRAY }
      );
    }
  });

  // 頁尾：表號＋頁碼＋產生時間
  const generatedAt = timestampText();
  painter.pages.forEach((page, index) => {
    const footer = `${sheet.sheet_no || ''}　Loading Sheet　第 ${index + 1} / ${painter.pages.length} 頁　${generatedAt}`;
    const { text: safe, font } = pick(footer);
    page.drawText(safe, { x: MARGIN.left, y: MARGIN.bottom - 14, size: 7.5, font, color: GRAY });
  });

  return doc.save();
}

module.exports = {
  buildUldWeightReportPdf,
  buildUldWeightLoadingSheetPdf,
  ITEM_COLUMNS,
  MAWB_COLUMNS,
  LOADING_COLUMNS,
  A4_PAGE: A4
};


// ===== 快速自我檢查（node scripts/uld-weight-report-pdf.js --selftest）=====
// 用 calc.js 產生一份 CASE 4 資料 → 產 PDF → 檢查檔頭與大小（不需啟動伺服器）
if (require.main === module && process.argv.includes('--selftest')) {
  (async () => {
    const path = require('path');
    const { pathToFileURL } = require('url');
    const calc = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'calc.js')).href);
    const computed = calc.uldComputeSheet({
      round_px: 1, round_b: 1, tail_mode: 'adjust_largest', diff_warn_pct: 2, diff_warn_kg: 100,
      ulds: [
        {
          uid: 'a', kind: 'ULD', uld_number: 'PMC0003XX', contour_code: 'ZQ', port: 'HKG', pcs: 8,
          tare_weight: 115, rcl_gross_weight: 540, material_weight: 0, lih_type: 'N', predecl_type: 'X',
          squeeze_mode: 'weight',
          items: [
            { mawb: '160-00000005', port: 'HKG', pcs: 5, declared_weight: 300, is_squeeze: false, lih_type: 'N' },
            { mawb: '160-00000006', port: 'TPE', pcs: 3, declared_weight: 125, is_squeeze: true, lih_type: 'UN3481' }
          ]
        },
        {
          uid: 'b', kind: 'ULD', uld_number: 'PMC0004XX', contour_code: 'PMC', port: 'HKG', pcs: 3,
          tare_weight: 112, rcl_gross_weight: 1000, material_weight: 0, lih_type: 'N', predecl_type: 'P',
          squeeze_mode: 'weight',
          items: [{ mawb: '160-00000006', port: 'TPE', pcs: 3, declared_weight: 888, is_squeeze: true, lih_type: 'N' }]
        }
      ]
    });
    const bytes = await module.exports.buildUldWeightReportPdf({
      id: 1, sheet_no: 'WGT-20261105-01', sheet_date: '2026-11-05', terminal: 'CPSL',
      flight_no: 'CX1234', flight_date: '2026-11-05', handler: '測試人員', remark: '中文備註測試',
      status: 'draft', ulds: computed.units, mawbs: computed.mawbs,
      issues: computed.issues, totals: computed.totals
    }, { issueText: calc.uldIssueText });
    const header = Buffer.from(bytes.slice(0, 5)).toString('latin1');
    console.log(`PDF ${bytes.length} bytes / header=${header}`);
    if (header !== '%PDF-' || !(bytes.length > 0)) process.exitCode = 1;
    // U3：單板 Loading Sheet（每板各一頁）
    const loading = await module.exports.buildUldWeightLoadingSheetPdf({
      id: 1, sheet_no: 'WGT-20261105-01', sheet_date: '2026-11-05', terminal: 'CPSL',
      flight_no: 'CX1234', flight_date: '2026-11-05', handler: '測試人員', remark: '',
      status: 'draft', ulds: computed.units
    }, {});
    const loadingHeader = Buffer.from(loading.slice(0, 5)).toString('latin1');
    console.log(`LoadingSheet PDF ${loading.length} bytes / header=${loadingHeader}`);
    if (loadingHeader !== '%PDF-' || !(loading.length > 0)) process.exitCode = 1;
  })().catch(err => { console.error(err); process.exitCode = 1; });
}
