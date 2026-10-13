// ===== 建置工具：把「字符集匯出 PDF」的 Arial 字型程式搬到空白 PDF（P4 前置）=====
// 背景：`sli-eli-blank.pdf` 是「清空 10 個動態格」後匯出的，因此它內嵌的 Arial 子集
// 只涵蓋**靜態**內容的字符；疊字要畫的動態文字（CNEE 地址…）很多字元不在子集內，
// 導致 `scripts/sli-eli-overlay.js` 的 fontMode='auto'（沿用內嵌字型）幾乎都用不上。
//
// 解法（建置期，一次性）：
//   1. 建置腳本多做一份「字符集匯出」：把 10 個動態格填入全部可能用到的字元
//      （ASCII 0x20–0x7E ＋ Latin-1 0xA0–0xFF）再匯出 → 該 PDF 的 Arial 子集涵蓋全部字符。
//   2. 本工具把那份 PDF 的 **Arial 字型程式（FontFile2 + FontDescriptor + /Widths）**
//      換掉空白 PDF 對應頁面的 Arial 字型資源。頁面內容流完全不動（字型是 WinAnsi 單一位元組
//      編碼，換成同字型的超集不影響既有字符的呈現）→ 空白背景的像素必須完全一致。
//   3. 順便檢查覆蓋率（解析 TTF cmap），不足就讓建置失敗（避免靜默產出「字形缺字」的空白）。
//
// 用法：
//   node scripts/sli-eli-blank-widen-fonts.js --blank blank-a4.pdf --charset charset-air.pdf charset-eli.pdf --out widened.pdf
//   （--charset 依序對應 blank 的第 0、1… 頁）

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFRawStream } = require('pdf-lib');

const WANT_RE = /(?:^|\+)Arial(-Bold)?MT$/; // Excel 產出：<TAG>+ArialMT / <TAG>+Arial-BoldMT
const REQUIRED = [
  ...Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i),
  ...Array.from({ length: 0x100 - 0xa0 }, (_, i) => 0xa0 + i),
]; // 191 個字元（與 overlay 的 isLatin1Char 一致）

function pdfNameStr(obj) {
  if (!obj || typeof obj.asString !== 'function') return '';
  return String(obj.asString()).replace(/^\//, '');
}

function readU16(b, o) { return (b[o] << 8) | b[o + 1]; }
function readU32(b, o) { return (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0); }

/** 解析 TTF cmap（format 4 / 12）→ 實際有對應字符的 codepoint Set */
function parseTtfCmap(buf) {
  const chars = new Set();
  if (!buf || buf.length < 12) return chars;
  const numTables = readU16(buf, 4);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    if (off + 16 > buf.length) break;
    if (String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]) === 'cmap') {
      cmapOff = readU32(buf, off + 8);
      break;
    }
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
          if (ro === 0) gid = (c + delta) & 0xffff;
          else {
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
        if (readU32(buf, o + 8) === 0) continue;
        for (let c = start; c <= end && c <= 0xffff; c++) chars.add(c);
      }
    }
  }
  return chars;
}

function streamBytes(stream) {
  let bytes = Buffer.from(stream.getContents());
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  const names = filter instanceof PDFArray
    ? filter.asArray().map(pdfNameStr)
    : [pdfNameStr(filter)].filter(Boolean);
  if (names.includes('FlateDecode')) bytes = zlib.inflateSync(bytes);
  return bytes;
}

/** 複製純量／陣列值到目標文件（跨文件搬移用；會解析來源文件的間接引用） */
function importValue(obj, targetCtx, srcCtx) {
  if (!obj) return undefined;
  if (obj.constructor && obj.constructor.name === 'PDFRef') obj = srcCtx.lookup(obj);
  if (!obj) return undefined;
  if (obj instanceof PDFName) return PDFName.of(pdfNameStr(obj));
  if (obj instanceof PDFNumber) return PDFNumber.of(obj.asNumber());
  if (obj instanceof PDFArray) return targetCtx.obj(obj.asArray().map((v) => importValue(v, targetCtx, srcCtx)));
  if (obj.constructor && obj.constructor.name === 'PDFBool') return obj;
  if (obj.constructor && /^PDF(String|HexString)$/.test(obj.constructor.name)) {
    return targetCtx.obj(String(obj.asString ? obj.asString() : obj));
  }
  return undefined;
}

/** 找出一頁上的 Arial 字型資源 → {fontDict, out:[{key, dict, base}]} */
function findArialFonts(page, doc) {
  const res = page.node.Resources();
  const fontDict = res && res.lookupMaybe(PDFName.of('Font'), PDFDict);
  const out = [];
  if (!fontDict) return { fontDict, out };
  for (const [key, value] of fontDict.entries()) {
    const fd = doc.context.lookupMaybe(value, PDFDict);
    if (!fd) continue;
    const base = pdfNameStr(fd.get(PDFName.of('BaseFont')));
    if (WANT_RE.test(base)) out.push({ key, dict: fd, base });
  }
  return { fontDict, out };
}

/** 把 charset 的同一字型搬進 blank：回傳 {ref, base, chars, bytes} */
function importFont(charsetDoc, charsetEntry, blankCtx) {
  const src = charsetEntry.dict;
  const srcCtx = charsetDoc.context;
  const desc = srcCtx.lookupMaybe(src.get(PDFName.of('FontDescriptor')), PDFDict);
  if (!desc) return null;
  const ff = srcCtx.lookup(desc.get(PDFName.of('FontFile2')));
  if (!ff || typeof ff.getContents !== 'function') return null;
  const raw = Buffer.from(ff.getContents());
  // 1) FontFile2 stream（保留原始壓縮位元組與字典鍵，只換所屬文件）
  const ffObj = { Length: raw.length };
  for (const [k, v] of ff.dict.entries()) {
    const name = pdfNameStr(k);
    if (name === 'Length') continue;
    ffObj[name] = importValue(v, blankCtx, srcCtx);
  }
  const newStream = PDFRawStream.of(blankCtx.obj(ffObj), new Uint8Array(raw));
  const ffRef = blankCtx.register(newStream);
  // 2) FontDescriptor
  const descObj = {};
  for (const [k, v] of desc.entries()) {
    const name = pdfNameStr(k);
    if (name === 'FontFile2' || name === 'FontFile3' || name === 'FontFile') continue;
    descObj[name] = importValue(v, blankCtx, srcCtx);
  }
  descObj.FontFile2 = ffRef;
  const descRef = blankCtx.register(blankCtx.obj(descObj));
  // 3) 字型 dict（沿用 charset 的 /Widths 與 /BaseFont）
  const fontObj = {};
  for (const [k, v] of src.entries()) {
    const name = pdfNameStr(k);
    if (name === 'FontDescriptor') continue;
    const imported = importValue(v, blankCtx, srcCtx);
    if (process.env.WIDEN_DEBUG) {
      console.log(`    DEBUG ${name}: src=${v && v.constructor && v.constructor.name}`
        + ` → ${imported && imported.constructor && imported.constructor.name}`);
    }
    fontObj[name] = imported;
  }
  fontObj.FontDescriptor = descRef;
  const fontRef = blankCtx.register(blankCtx.obj(fontObj));
  return {
    ref: fontRef,
    base: pdfNameStr(src.get(PDFName.of('BaseFont'))),
    chars: parseTtfCmap(streamBytes(newStream)),
    bytes: raw.length,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const multi = (name) => {
    const out = [];
    argv.forEach((a, i) => { if (a === name && argv[i + 1]) out.push(argv[i + 1]); });
    return out;
  };
  const one = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const blankPath = one('--blank');
  const outPath = one('--out');
  const charsetPaths = multi('--charset');
  if (!blankPath || !outPath || !charsetPaths.length) {
    console.error('用法：node scripts/sli-eli-blank-widen-fonts.js --blank <blank.pdf> --charset <p0.pdf> [p1.pdf] --out <out.pdf>');
    process.exit(2);
  }

  const blank = await PDFDocument.load(fs.readFileSync(blankPath), { ignoreEncryption: true, updateMetadata: false });
  const charsetDocs = await Promise.all(charsetPaths.map(
    (p) => PDFDocument.load(fs.readFileSync(p), { ignoreEncryption: true, updateMetadata: false }),
  ));

  let replaced = 0;
  for (let pi = 0; pi < blank.getPageCount(); pi++) {
    const srcDoc = charsetDocs[Math.min(pi, charsetDocs.length - 1)];
    if (!srcDoc || srcDoc.getPageCount() === 0) {
      console.log(`  p${pi}: 無對應的字符集 PDF（略過）`);
      continue;
    }
    const srcPage = srcDoc.getPage(Math.min(pi, srcDoc.getPageCount() - 1));
    const srcFonts = findArialFonts(srcPage, srcDoc);
    const page = blank.getPage(pi);
    const { fontDict, out: blankFonts } = findArialFonts(page, blank);
    if (!fontDict || !blankFonts.length) {
      console.log(`  p${pi}: 找不到 Arial 字型資源（略過）`);
      continue;
    }
    for (const bf of blankFonts) {
      const match = srcFonts.out.find(
        (sf) => sf.base.replace(/^.*\+/, '') === bf.base.replace(/^.*\+/, ''),
      );
      if (!match) {
        console.log(`  p${pi} ${bf.base}: 字符集 PDF 找不到對應字型`);
        continue;
      }
      const imported = importFont(srcDoc, match, blank.context);
      if (!imported) {
        console.log(`  p${pi} ${bf.base}: 無法搬移（缺 FontFile2）`);
        continue;
      }
      const bDesc = blank.context.lookupMaybe(bf.dict.get(PDFName.of('FontDescriptor')), PDFDict);
      const bFF = bDesc ? blank.context.lookup(bDesc.get(PDFName.of('FontFile2'))) : null;
      const before = bFF && typeof bFF.getContents === 'function' ? parseTtfCmap(streamBytes(bFF)).size : 0;
      const missing = REQUIRED.filter((c) => !imported.chars.has(c));
      console.log(`  p${pi} ${bf.base.padEnd(22)} 子集字符 ${before} -> ${imported.chars.size}`
        + `（${(imported.bytes / 1024).toFixed(1)} KB），缺字 ${missing.length}`
        + (missing.length ? `：${missing.slice(0, 12).map((c) => `U+${c.toString(16).toUpperCase()}`).join(' ')}` : ''));
      if (missing.length && !argv.includes('--no-assert')) {
        console.error(`ERROR: 字符集匯出未涵蓋必要字元（p${pi} ${bf.base}），請檢查建置腳本的 sink 步驟`);
        process.exit(1);
      }
      fontDict.set(bf.key, imported.ref);
      replaced += 1;
    }
  }
  if (!replaced) {
    console.error('ERROR: 沒有搬移任何字型（--charset 內容或 --blank 頁面可能不符）');
    process.exit(1);
  }
  const bytes = await blank.save({ useObjectStreams: true, updateFieldAppearances: false });
  fs.writeFileSync(outPath, bytes);
  console.log(`已寫出 ${path.basename(outPath)}：替換 ${replaced} 個 Arial 字型資源，`
    + `${(fs.statSync(blankPath).size / 1024).toFixed(1)} KB -> ${(bytes.length / 1024).toFixed(1)} KB`);
}

main().catch((e) => {
  console.error('字型搬移失敗:', e.message);
  process.exit(1);
});
