// ===== CJK／全形字元用字型（fontkit 子集內嵌；疊字產生器第 2 層）=====
// 為什麼需要：pdf-lib 標準字型只有 WinAnsi（見 scripts/pdf-charset.js），中文／全形標點
// 一律編不出來，舊做法是整筆退回 Excel 引擎（每筆 ~4 秒、123 KB）。這裡改用 fontkit
// **按需子集**：只有該筆真的有 CJK 字元時才內嵌，且只內嵌用到的字形
// （實測：微軟正黑體 1 個字形 +4.1 KB、11 個漢字 +6.9 KB、解析 24 ms）。
//
// 重點（實測踩過的坑）：
//   1) `@pdf-lib/fontkit` 對 `.ttc` 會回傳 TrueTypeCollection（沒有 createSubset）→
//      pdf-lib 的 `doc.embedFont(ttcBytes)` 會直接爆 `createSubset is not a function`。
//      必須自己挑出 collection 裡的單一字型（本模組負責），並用
//      `new CustomFontSubsetEmbedder(fontkitFont, rawBytes)` 建 PDFFont。
//   2) 解析結果可跨文件重用（20 MB 的 .ttc 只解析一次），差異：24 ms vs 每筆 24 ms。
//   3) 可變字型（VF，例如 NotoSansTC-VF.ttf 的預設是 Thin）預設跳過 —— 筆畫粗細與 Excel 不同。
//
// 環境變數：
//   SLI_ELI_CJK_FONT  自訂字型檔（逗號分隔，優先於平台預設）
//   PDF_CJK           auto（預設）| off（停用 → 含 CJK 的記錄照舊退回 Excel 引擎）

const fs = require('fs');
const path = require('path');

/** 依平台列出候選字型（依「與該環境 Excel／LibreOffice 實際使用的字型最接近」排序） */
function defaultCandidates() {
  if (process.platform === 'win32') {
    const dir = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts';
    return [
      path.join(dir, 'msjh.ttc'),     // 微軟正黑體（模板靜態中文用 MicrosoftJhengHei → 字形最接近）
      path.join(dir, 'mingliu.ttc'),  // 新細明體 / PMingLiU
      path.join(dir, 'msyh.ttc'),     // 微軟雅黑（zh-CN 資料）
      path.join(dir, 'simsun.ttc'),   // 宋體（zh-CN）
      path.join(dir, 'kaiu.ttf'),     // 標楷體
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts/PingFang.ttc',
      '/Library/Fonts/Arial Unicode.ttf',
    ];
  }
  // Linux（Dockerfile 已安裝 fonts-noto-cjk；fonts-droid-fallback 為 standalone TTF 保險）
  return [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
    '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  ];
}

/** 環境變數指定的字型（逗號分隔）＋平台預設；strict=true 時只用 extra（維運用來「鎖定」字型） */
function candidatePaths(extra, strict) {
  const list = extra ? [extra].flat().filter(Boolean) : [];
  if (strict) {
    const seenStrict = new Set();
    return list.filter((p) => !seenStrict.has(p) && (seenStrict.add(p), true));
  }
  const env = String(process.env.SLI_ELI_CJK_FONT || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const all = [...list, ...env, ...defaultCandidates()];
  const seen = new Set();
  return all.filter((p) => p && !seen.has(p) && (seen.add(p), true));
}

/** 取得（並快取）fontkit：未安裝時回傳 null（不 throw，讓呼叫端優雅退回 Excel） */
let fontkitCache;
function loadFontkit() {
  if (fontkitCache !== undefined) return fontkitCache;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    fontkitCache = require('@pdf-lib/fontkit');
  } catch (e) {
    fontkitCache = null;
  }
  return fontkitCache;
}

/** 是否為可變字型（預設不用：預設實例常常是 Thin/Light，筆畫與 Excel 不符） */
function isVariableFont(font) {
  try {
    return Array.isArray(font.variationAxes) && font.variationAxes.length > 0;
  } catch (e) {
    return false;
  }
}

/** 由 TrueTypeCollection 挑出最合適的成員（找不到就用第一個非 VF 成員） */
function pickFromCollection(collection) {
  const fonts = collection.fonts || [];
  if (!fonts.length) return null;
  const prefer = [
    /^MicrosoftJhengHeiRegular$/,
    /^PMingLiU$/,
    /^MingLiU$/,
    /^NotoSansCJK(tc|sc|jp|kr)?-Regular$/,
    /^NotoSans.*(TC|CJK).*Regular$/,
    /^DroidSansFallback/,
  ];
  for (const re of prefer) {
    const hit = fonts.find((f) => re.test(String(f.postscriptName || '')));
    if (hit) return hit;
  }
  return fonts.find((f) => !isVariableFont(f)) || fonts[0];
}

/** 由 fontkit 物件取單一字型（collection → 挑成員；單一字型 → 直接回傳） */
function pickFont(fontkit, obj) {
  if (obj && typeof obj.createSubset === 'function') return obj;
  if (obj && Array.isArray(obj.fonts)) {
    const picked = pickFromCollection(obj);
    if (picked && typeof picked.createSubset === 'function') return picked;
  }
  if (obj && typeof obj.getFont === 'function') {
    try {
      const f = obj.getFont();
      if (f && typeof f.createSubset === 'function') return f;
    } catch (e) { /* ignore */ }
  }
  return null;
}

// 解析結果快取：key＝檔案路徑＋size＋mtime（同一字型只解析一次，跨引擎／跨筆共用）
const parsedCache = new Map();

function makeFontApi(file, raw, font) {
  const glyphMemo = new Map();
  const unitsPerEm = Number(font.unitsPerEm) || 1000;
  return {
    path: file,
    postscriptName: String(font.postscriptName || ''),
    fullName: String(font.fullName || ''),
    unitsPerEm,
    raw,
    fontkitFont: font,
    /** 字型是否涵蓋該 codepoint（含 memo；呼叫端以 codePointAt 傳入） */
    hasGlyph(cp) {
      let hit = glyphMemo.get(cp);
      if (hit === undefined) {
        try {
          hit = !!font.hasGlyphForCodePoint(cp);
        } catch (e) {
          hit = false;
        }
        glyphMemo.set(cp, hit);
      }
      return hit;
    },
    /** 以 fontkit 公制量測（與 pdf-lib CustomFontEmbedder 同一條公式：Σadvance / unitsPerEm × size） */
    measureWidth(text, size) {
      if (!text) return 0;
      const glyphs = font.layout(String(text)).glyphs;
      let total = 0;
      for (const g of glyphs) total += g.advanceWidth;
      return (total / unitsPerEm) * size;
    },
    describe() {
      return `${path.basename(file)} (${this.postscriptName || '?'})`;
    },
  };
}

/**
 * 載入 CJK 字型（依候選順序找第一個可用的）。
 * @returns {Promise<object|null>} 成功：makeFontApi() 的物件；失敗：{ error, failures, candidates }
 */
async function loadCjkFont(options = {}) {
  const fontkit = options.fontkit || loadFontkit();
  if (!fontkit) {
    return { error: '未安裝 @pdf-lib/fontkit（npm i @pdf-lib/fontkit）', failures: [], candidates: [] };
  }
  const failures = [];
  const candidates = candidatePaths(options.fonts, options.strict);
  if (!candidates.length) {
    return { error: '沒有候選字型（strict 模式且未提供 fonts）', failures, candidates };
  }
  for (const file of candidates) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch (e) {
      failures.push(`${file}：不存在`);
      continue;
    }
    const key = `${file}|${stat.size}|${stat.mtimeMs}`;
    let parsed = parsedCache.get(key);
    if (!parsed) {
      try {
        const raw = fs.readFileSync(file);
        const obj = await fontkit.create(raw);
        const font = pickFont(fontkit, obj);
        if (!font) { failures.push(`${file}：找不到可子集化的字型`); continue; }
        if (!options.allowVariableFont && isVariableFont(font)) {
          failures.push(`${file}：可變字型（${font.postscriptName}）已跳過`);
          continue;
        }
        const unitsPerEm = Number(font.unitsPerEm) || 1000;
        parsed = { raw, font, unitsPerEm };
        parsedCache.set(key, parsed);
      } catch (e) {
        failures.push(`${file}：${e.message}`);
        continue;
      }
    }
    return makeFontApi(file, parsed.raw, parsed.font);
  }
  return { error: '找不到可用的 CJK 字型', failures, candidates };
}

/** 清空解析快取（測試用） */
function clearCache() { parsedCache.clear(); }

module.exports = {
  defaultCandidates,
  candidatePaths,
  loadFontkit,
  loadCjkFont,
  isVariableFont,
  pickFromCollection,
  clearCache,
};
