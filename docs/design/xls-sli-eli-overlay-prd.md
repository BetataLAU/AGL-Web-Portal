# PRD／交接：SLI/ELI「A4 修正 + 字型瘦身 + 疊字背景」

> 建立：2026-10-13 ｜ 狀態：**P1～P5 全部完成並驗證（需求 1～4 已交付）；後續只剩選項（PRD §2 末）**
> 適用對話：Shipper Role 專案（`routes/xls-booking.js` / `scripts/xls-*`）
> 交接用途：新對話只要讀本檔 + `CLAUDE.md` 的「Shipper Role Project」段落即可接上。

---

## 0. 需求（原始 + 追加）

**原始**：目前產生 PDF 的方式是「資料套入 XLS → 匯出 PDF」。一次做 30+ 份很慢，且檔案的 PDF 一個約 500KB。目標：**加快速度**、**降低檔案大小到 30–80KB**。

**追加（使用者 2026-10-13 提出）**：

1. 輸出**修正為 A4**
2. **原本網站功能要保留**（防新功能出問題）
3. **新的功能放到最頂**（UI 位置）
4. 提供**一個地方可以設定所有內容的位置、文字框大小、一般編輯功能**（＝版面編輯器）

---

## 1. 已完成（P1 / P2）與實測數據

### P1 輸出修正為 A4 ✅

**關鍵事實（實測，別再重試別的做法）**：Excel 匯出的 PDF 紙張尺寸由**印表機驅動的 DEVMODE ＋ 模板內嵌 `xl/printerSettings/*.bin`** 決定，**不是**工作表 `PageSetup`：

| 做法 | 結果 |
|---|---|
| 模板 `air` 的 PageSetup | 本來就已是 **A4(9)／直式／Zoom=65** |
| 改 `PageSetup.PaperSize = 9` 後直接匯出 | 仍 **915.3×1295.5 pt**（322.8×456.9mm）❌ |
| 存檔（重建 printerSettings bin）後重開再匯出 | 仍 915.3×1295.5 ❌ |
| `Zoom=False` + `FitToPagesWide/Tall=1` | 仍 915.3×1295.5 ❌ |

→ 915.3 × 0.65 = 594.9 ≈ A4 寬：**模板設計就是「A4 × 65%」**，自訂紙張只是 A4 ÷ 0.65。

**解法**：Node 端 `scripts/xls-sli-eli.js` 的 `normalizePdfToA4()` —— 合併後把非 A4 頁用 pdf-lib `page.scale(kx, ky)` 等比縮成 A4（實際是在內容流前後包 `q` + `cm` + `Q`，**原始內容逐位元保留**）。

- 開關：`PDF_PAPER=a4`（預設）| `custom`（完全不動＝舊行為，可一鍵回滾）
- Python 端同時寫入 A4 設定（對 openpyxl + LibreOffice 路徑有效，但 Excel 會忽略）
- 回報：`result.paper = { mode, measured, ok, issues }`，前端顯示實測尺寸；不符只警示不中斷
- 驗證：`python scripts/test-sli-generate.py`（印 Excel 原始尺寸）、`node scripts/test-pdf-a4.js`、`node scripts/test-a4-integration.js`
- 實測：915.3×1295.5 → **595.3×841.9**；文字（空白正規化後）**完全相同**；ELI 頁本來就是 A4（未動）

### P2a PDF 字型瘦身 ✅（本次最大戰果）

**診斷**：Excel 匯出的 PDF 約 **79% 是內嵌字型**，而字型程式內含大量 PDF 完全不需要的資料：

| 表格 | 大小 | PDF 需要嗎 |
|---|---|---|
| `name` | **9–12 KB／字型** | ❌ 純元資料（字型名稱／版權／版本字串） |
| `prep` / `fpgm` / `cvt ` | **4.6–14 KB／字型** | ❌ hinting（螢幕點陣對齊用） |
| `glyf` 內每字符指令 | 每字符數十～數百 bytes | ❌ hinting bytecode |
| `glyf` 輪廓 | — | ✅ 真正要的 |
| `hmtx`/`loca`（CJK） | 大但壓縮後僅 ~12 KB | 已非瓶頸 |

**解法**：`scripts/sli-eli-font-optimize.py`（純 Python + PyMuPDF，**免 Ghostscript**）

1. `doc.subset_fonts()` 子集化（只留實際用到的字符）
2. 移除 `name`／`prep`／`fpgm`／`cvt `／`DSIG`／`kern`／`hdmx`／`VDMX`／`LTSH`／`gasp`／`PCLT`／`meta`
3. 移除 `glyf` 內每個字符的 hinting 指令（**simple + composite 都處理**；**保留 GID** → 內容流完全不動）
4. 以 `/Length1` 掃描**全檔**字型程式 —— `page.get_fonts()` 會漏掉 Excel 產出的隱藏字型（實測漏了一個 **213 KB 的 CJK 字型程式**，它不在頁面資源內，體積主要在 `hmtx`/`loca`）

**成果**（2 頁 SLI+ELI）：**545 KB → 123.3 KB（-76.8%）**；**150dpi 逐像素差異 0.000%**；文字仍可抽取／搜尋（MAWB／CNEE／地址／日期皆驗證）。

**串接**：`runWorkflow` **Step 4.5**（合併 → A4 正規化 → 字型優化 → ZIP），用單一 Python 程序批次就地優化（`--inplace`）。

- 開關：`PDF_FONT_OPT=on`（預設）| `off`；缺 PyMuPDF **自動略過**並在前端提示
- 回報：`result.fontOpt = { files, before, after, reductionPct, skipped }`
- CLI：`--report`（組成報告）、`--diff`（逐像素差異）、`--inplace a.pdf b.pdf …`
- `Dockerfile` 已加 `pymupdf`
- 實測 48 檔 ZIP：24.3 MB → 約 5.9 MB（單份 123KB）

**剩餘瓶頸**：內容流 **49.9 KB**（Excel 繪製的表單線條／控件）＋ PDF 結構 ~16 KB → **檔案地板約 120 KB**。點陣化更差（1-bit 200dpi 兩頁 110KB，灰階底紋二值化後難壓）。**要再往 30–80KB 只能改模板**（減少字型家族數／繪圖物件數）——屬業務／版面決定，尚未做。

### P2b 疊字背景 + 欄位座標（fieldmap）✅

**建置工具**：`python scripts/build-sli-eli-blank.py`（Windows + Excel COM + PyMuPDF，**免 Ghostscript**）

流程：
```
複製模板到工作目錄（不動正式模板）
 ├ 清空 10 個動態格 → 匯出 blank[air] / blank[ELI LETTER]
 ├ 填入「短 marker」(@@D23@@)  → 匯出 markerA ×2
 ├ 填入「長 marker」(+8 個 @)   → 匯出 markerB ×2（用來實測縮放）
 ├ 讀 Excel 幾何（MergeArea 的 Left/Top/Width/Height、Font、對齊、WrapText、頁面設定）
 ├ 全部 A4 正規化（與 Node normalizePdfToA4 同一套數學）
 ├ 背景做字型優化 → data/templates/sli-eli-blank.pdf
 ├ 以 marker 實測位置錨定 origin 與 box
 ├ 自我校準 baseline（把 marker 畫回背景 → 與 Excel 逐欄比對 → 修正 → 重畫，2 輪）
 └ 產生底圖 PNG（120dpi 灰階）＋ fieldmap JSON×2 ＋ meta JSON
```

**產物（`data/templates/`）**

| 檔案 | 內容 | 大小 |
|---|---|---|
| `sli-eli-blank.pdf` | **A4、2 頁**（p0 = SLI/`air`、p1 = ELI/`ELI LETTER`）；10 個動態格已清空、字型已優化 | **122.3 KB** |
| `sli-eli-blank-p1.png` / `-p2.png` | 編輯器底圖（993×1404 / 992×1404） | 84.4 / 108.7 KB |
| `sli-eli-fieldmap.default.json` | Excel 校準基準（供「還原成預設」） | 11.4 KB |
| `sli-eli-fieldmap.json` | **作用中**座標（版面編輯器修改的就是這份） | 11.4 KB |
| `sli-eli-blank-meta.json` | sha256／頁面尺寸／轉換參數／校準結果 | 1.2 KB |

**驗證結果（PASS）**：2 頁皆 A4、背景不含 marker、靜態內容（含中文標籤）完整、**錨定邊殘差 0.00 pt**、10/10 欄位。
驗證腳本：`python data/test-p2/verify-build.py`、`python data/test-p2/list-fieldmap.py`（都在 `.gitignore` 內，不進版控）。

**fieldmap 語意（重要）**

```json
{ "key": "sli.D9", "page": 0, "sheet": "air", "source": "cnee", "cell": "D9", "range": "D9:E13",
  "box":    { "x": 91.28, "y": 130.38, "w": 236.8, "h": 57.65 },  // 編輯器顯示／換行寬度
  "origin": { "x": 91.28, "y": 131.35 },                          // Excel 實際文字錨點（依對齊取邊界）
  "font":   { "excelName": "Arial", "sizePt": 5.72, "bold": false, "color": "#000000" },
  "align":  { "h": "left", "v": "top" }, "wrap": true, "lineHeightPt": 6.86, "maxLines": 8,
  "textBaselineOffsetPt": 6.15,        // baseline 相對 origin.y（已自我校準）
  "markerRect": [91.28, 131.35, 121.73, 137.91],
  "calibrationResidual": [0.0, 0.0, 1.31], "anchorResidualPt": 0.0 }
```

- 座標系：**pt、原點在頁面左上（x 右、y 下）**；PDF 左下原點只在繪製時轉換
- `source` 對應 `recordsPayload`：`mawb` / `dest` / `flightCompany` / `flightDate` / `cnee` / `cneeTel`
- 兩個頁面的實測縮放（**與 PageSetup 的 65%/100% 不同**）：`air` = **0.63528**、`ELI LETTER` = **1.00358**（存於 `sli-eli-blank-meta.json` 的 `transforms`）

### P3 疊字產生器 ✅（本次完成）

`scripts/sli-eli-overlay.js`：**純 Node + pdf-lib**，不需 Excel／Python／LibreOffice，**也不需 merge**（背景本身就是 SLI+ELI 兩頁）。

```
每筆 MAWB：背景 PDF（引擎建立時載入一次，快取）→ copyPages([0,1]) → 依 fieldmap 排版 10 欄位 → 寫出 {MAWB}.pdf
```

**可 require 的乾淨 API**（P4 直接使用）：

| API | 回傳 |
|---|---|
| `createOverlayEngine({ blankPdf, fieldmap, fontMode, strict, logger })` | 引擎物件（載入背景＋fieldmap＋偵測內嵌字型；`strict` 會在資產不符時 throw） |
| `engine.render(rec, outPath?)` | `{ status:'ok', mawb, file, bytes, ms, pages, sizes, fontPaths }` 或 `{ status:'fallback', reason:'non-latin1', unsupported, message, ms }`（**不寫檔**） |
| `engine.renderMany(records, outDir, { onRecord })` | `{ ok:[], fallback:[], errors:[], ms, totalMs, bytes }`（單筆例外不中斷） |
| `engine.partition(records)` | `{ renderable:[rec…], fallback:[{mawb, unsupported, record}…] }`（P4 分派舊引擎用） |
| `engine.check(rec)` / `engine.values(rec)` | 退回判定（含不支援字元清單）／逐欄位文字 |
| `engine.layout(rec)` | 只排版不繪製（P5 編輯器預覽與驗證共用同一份數學） |
| `engine.describe()` | 資產摘要（背景 sha／頁尺寸／內嵌字型覆蓋率／issues） |
| `renderRecord(rec, outPath?)` / `renderRecords(...)` | 便利函式（內部快取預設引擎） |
| `wrapText` / `layoutLines` / `wrapWidthOf` / `formatExcelDate` … | 純函式，P5 共用 |

**排版規則（= fieldmap 的語意）**

| 項目 | 規則 |
|---|---|
| 水平 | `x = origin.x`（left）／`origin.x - width/2`（center）／`origin.x - width`（right）；width 用字型實測 |
| baseline | 首行 `origin.y + textBaselineOffsetPt`，之後每行 `+= lineHeightPt` |
| 垂直區塊 | `top` 由 origin.y 往下；`center` 以 origin.y 為區塊中心；`bottom` 以 origin.y 為區塊底部 |
| 換行 | 先依 `\n` 分段 → 再依 **`wrapWidthPt`**（新增鍵）以空白貪婪折行（超長單字硬切）→ 超過 `maxLines` 截斷 |
| 日期 | `dateFormat`（新增鍵）＝ Excel 數字格式；`2026-10-03` → **`03/Oct/2026`** |
| 字型 | `fontMode='auto'`（預設）：優先沿用背景內嵌的 Excel Arial 子集；不可用時退回 pdf-lib `StandardFonts.Helvetica`／`Helvetica-Bold`（0 byte） |
| CJK／非 Latin-1 | **不畫**（避免亂碼）→ `status='fallback'`，由呼叫端退回舊 Excel 引擎 |

**P3 校準：fieldmap v1 → v2（實測 Excel 輸出後修正，兩份 fieldmap 都已更新）**

| 欄位 | v1（P2 建置腳本） | v2（P3 實測校正） | 依據 |
|---|---|---|---|
| `font.sizePt`（air 頁 5 欄） | 10.16 / 5.72 / 6.99… | **10.44 / 5.88 / 7.20…**（+2.4~3.0%） | P2 用「marker ink 寬度 ÷ Helvetica 字寬」推導縮放（0.63528）會低估；實際 = **Excel Font.Size × (A4 寬 ÷ 匯出頁寬) = 0.65035** |
| `font.sizePt`（ELI 頁） | 12.04 / 8.03 / 9.03 | **12.00 / 8.04 / 9.00**（-0.3%） | 同上（ELI 頁實際縮放 ≈ 1.0） |
| `lineHeightPt` | `size × 1.2`（假設值） | **實測**（D9 = 7.56、M16 = 10.20，其餘 `size × 1.2687`） | Excel 行距比 ≈ 1.2687（D9 為 1.2857），不是 1.2 |
| `wrapWidthPt`（新增） | 無（用 `box.w`） | **合併格寬（校正後）− 5pt** | Excel 換行有左右內距，`box.w` 會讓 M16 的 CNEE 少斷一行 |
| `maxLines` | `round(box.h / (size×1.2))` | **`floor(box.h / lineHeightPt)`**（D9/M16 皆 7） | Excel 對放不下的行是**不畫**（實測 M16 只畫 7 行） |
| `dateFormat`（新增） | 無 | `dd/MMM/yyyy`（D72 / N57） | payload 是 `2026-10-03`，Excel 顯示 **`03/Oct/2026`** |
| `calibration` / `version` | 無 | `version: 2`、`calibration` 記來源 | 可追溯 |

校正後的**逐欄位 ink 邊界**與 Excel 在 600dpi（1px = 0.12pt）下 **dx/dy = 0.00 pt 全數對齊**；折行、行距、日期字串、字級全部與 Excel 一致。

**實測數據（Windows / Node 24；`node scripts/test-sli-eli-overlay.js --ref <job>`）**

| 項目 | 結果 |
|---|---|
| 檔案大小 | **116.4 KB／份**（背景 114.0 KB，**未內嵌任何新字型**） |
| 每筆耗時 | **冷啟動 12–16 ms ＋ 每筆 45–55 ms**（序列；不含 Excel／Python；＝舊流程每筆約 1.5 s 的 ~3%） |
| 頁數 / 尺寸 | 2 頁、595.3×841.9 / 595.0×842.0（A4 ±1pt） |
| 文字可抽取 | ✅（MAWB 可在兩頁搜尋到） |
| 退回舊引擎 | 5 筆中 4 筆（CNEE 含全形 `，`／`（）`）→ **判定正確**、不寫檔、不畫亂碼 |
| **150dpi 逐像素差異** | **頁0 0.230% / 頁1 0.329%（皆 < 0.5% ✅）**；合成 3 筆 0.139% |

**差異的真正來源（P4 前置時找到並修掉，重要）**

- 受控實驗：把 Excel 參考檔自己的文字「原地、原字級」用 Helvetica 重畫 → 0.248%/0.355%；用真 Arial → 0.187%/0.290%。
  我們原本是 0.432%/0.638% → 高於地板，代表**不是**字型外形問題。
- 逐欄位比對後發現：`textBaselineOffsetPt`（P2 用 `@` marker 的**墨跡**校準）與 Excel 實際 baseline 差 **0.3～1.4 pt**（v=top −0.8~−1.4、v=center −0.32、v=bottom +0.7~+1.1）→ 每個字符都落在錯誤的次像素位置，大文字欄位（D9/M16）尤其明顯。
- **Excel 的垂直定位用「行盒」而非墨跡**（`@` 在 Arial 的墨跡高度剛好等於 ascent，才讓 P2 的墨跡校準看起來可用）。改成解析模型後與 Excel 實測 baseline **誤差 ≤ 0.03 pt**：

  ```
  v=top    : baseline = origin.y + 0.9053 × size      (Arial hhea ascent)
  v=bottom : baseline = origin.y − 0.2124 × size      (Arial hhea descent)
  v=center : baseline = origin.y + (0.9053−0.2124)/2 × size
  ```

  套用後差異直接從 0.432/0.638 → **0.230/0.329**（其餘為標準字型被檢視器取代後的描邊光柵，已在門檻內）。
- 量測工具：`python data/test-p3/measure-baseline-delta.py`（用參考 PDF 的 span origin 驗證模型）。

**P4 前置：讓背景內嵌的 Arial 子集更完整（已做，效果部分）**

- 空白是「清空動態格」後匯出的 → 它的 Arial 子集只有 static 字符（62/68 個），`fontMode='auto'` 幾乎用不上。
- 建置腳本新增「字符集匯出」：把 10 個動態格填入 ASCII 0x20–0x7E ＋ Latin-1 0xA0–0xFF（2pt、不換行、格子內塞得下）匯出一份 **charset PDF（不出貨，只當字型來源）**，再由 `scripts/sli-eli-blank-widen-fonts.js`（純 pdf-lib，無新相依）把它的 Arial 字型程式（FontFile2＋FontDescriptor＋/Widths）搬進空白。
- 驗證：建置時強制 assert **加寬前後空白像素差異 0.0000%**（實測通過）、字符覆蓋率（不足即建置失敗）。產出空白與 commit 版**像素與文字完全相同**，且更小（122.3 → **114.0 KB**）。
- ⚠️ **但覆蓋率只部分回復**：後續的字型優化（`subset_fonts`）會再依「未被內容引用」剃掉字元（213 → 75/72）→ 只對「字符剛好落在子集內」的資料生效（例：合成 3 筆走內嵌路徑、差異 0.139%）。**要 100% 生效**需改成：先優化空白 → 再優化 charset PDF → 最後才加寬（順序調換），代價是每份約 +35 KB（內嵌 Arial 全字符集）；因目前已在門檻內、且使用者重視檔案大小，**暫不啟用**（列為選項）。

---

## 2. P4 / P5 已完成（後續只剩選項）

### P4 接進主流程 + UI 最頂開關 ✅ 已完成

**引擎分派（`scripts/xls-workflow.js`）**
- 新增 `XLS_PDF_ENGINE=overlay|com`（未設定＝`com`＝現況）；`runWorkflow({ pdfEngine })` 可由路由覆寫（優先於環境變數）；`resolvePdfEngineMode()` 已 re-export（供測試）。
- **com**：Step 3（Excel COM）→ Step 4（merge／A4 正規化）→ Step 4.5（字型優化）＝**100% 舊行為**（同一份 payload、同一條程式碼路徑）。
- **overlay**：`engine.partition(recordsPayload)` 分派 —— 可疊字的記錄直接 `renderMany()` 寫出 `{MAWB}.pdf`（**不經 Excel／不需 merge／不做 A4 正規化**）；非 Latin-1（CNEE 中文、全形標點 `，` `（）`）與任何例外（背景／fieldmap 缺失、`blankPdfSha256` 不符、`createOverlayEngine` 失敗、單筆 render 例外）都排入**同一批**的舊 COM 路徑（混合執行）。
- 相容欄位：`result.engine = { mode, overlay, com, fallbackCount, fallbackReasons, overlayMs }`、`result.fallbackCount`；`result.paper` 照常實測（疊字背景本來就是 A4）。
- `result.fontOpt`：純 overlay → `{files:0, skipped:true, engine:'overlay'}`（背景已優化＋標準字型 0 byte 內嵌）；**若本次有退回 COM 的檔案，只對那些檔案瘦身**（否則會退回 ~545 KB，與 com 模式的 123 KB 不一致）。

**路由／前端**
- `routes/xls-booking.js`：`POST /process` 接受 `engine`（白名單 `overlay|com`；其餘回 **400** `engine 僅支援 overlay 或 com`）；結果帶 `engine` / `fallbackCount`。
- `public/index.html`：④ 執行產生的 `.xls-run-row` **最前面**加「PDF 產生方式」選擇器 `#xls-pdf-engine`（預設 `com`＝Excel（舊版）；新功能放最頂）＋ `public/css/xls-booking.css` 的 `.xls-engine-control`（主色外框）。
- `public/js/xls-booking-state.js`：`xlsState.pdfEngine`（預設 `'com'`）＋初始化綁定；`public/js/xls-booking-workflow.js`：請求帶上 `engine`，結果面板顯示「🧩 PDF 產生方式／疊字 N 份／退回 Excel N 份／疊字耗時」，退回時列出 MAWB 與不支援字元。

**實測（本機 Windows＋Excel 16.0，2026-10-13）**

| 驗收 | 指令 | 結果 |
|---|---|---|
| com 模式與現況相同 | `node scripts/test-a4-integration.js` | **PASS**：3 份 **123.4 KB**、2 頁 A4（595.3×841.9 / 595.0×842.0）、fontOpt 3 份 **-76.9%**（1.56 → 0.36 MB）、耗時 **12.1 s** |
| overlay 模式 | `$env:XLS_PDF_ENGINE='overlay'; node scripts/test-a4-integration.js` | **PASS**：3 份 **116.0 KB**、2 頁 A4、`fontOpt.skipped=true`、耗時 **1.1 s**（≈11× 快） |
| 混合批次（2 疊字＋1 退回） | `node scripts/test-p4-engine.js` | **PASS**：`engine={mode:'overlay',overlay:2,com:1,fallbackCount:1}`、116.0／131.3／115.9 KB、2 頁 A4、`errors=[]` |
| 引擎不可用 → 全退回 COM | 同上 case 2（`SLI_ELI_BLANK_PDF` 指向不存在檔） | **PASS**：overlay=0／com=3／fallbackCount=3、明確回報「疊字引擎無法使用」、123.4／131.3／123.2 KB（字型優化 **-76.7%**） |
| 路由白名單＋結果欄位 | 端對端（登入→上傳→`POST /process`） | `engine:'bogus'` → **400** `engine 僅支援 overlay 或 com`；`engine:'overlay'` → `mode='overlay'`、overlay=1／com=1／fallbackCount=1、fontOpt 只瘦身退回檔（**-76.4%**）、`paper.ok=true` |
| P3 無回歸 | `node scripts/test-sli-eli-overlay.js --ref data/work/job-zRSCW0` | **PASS**：116.4 KB／61.1 ms、150dpi 差異 **0.230%／0.329%**、4 筆非 Latin-1 正確退回 |

**側邊欄（需求 3「新功能放最頂」）**：`public/index.html` 的 nav 在 **HOME 之後第一位**新增 `sli-eli-layout.html`（`#nav-sli-eli-layout`）；`public/js/auth.js` 未登入時顯示鎖頭並導向登入頁、登入後解鎖；`scripts/fix-nav-order.js` 的 `DEFAULT_ORDER` 把它列為第一項（既有自訂排序的使用者執行該腳本即會就近補上；本機 admin 已修復 10 → 11 項）。

### P5 版面編輯器（需求 4）✅ 已完成

**新頁**：`public/sli-eli-layout.html` ＋ `public/js/sli-eli-layout-{state,editor,main}.js` ＋ `public/css/sli-eli-layout.css`（比照 `uld-packing.html` 的獨立頁模式；純靜態底圖、無新 CDN 相依）。

**功能**：頁籤（SLI/ELI）、10 欄位清單（跨頁標示／超界警示）、畫布拖曳移動、8 向把手縮放、方向鍵微調（Shift=10pt）、5pt 格線吸附＋格線顯示、Undo/Redo（Ctrl+Z / Ctrl+Y，上限 60）、對齊工具（左／中／右／上／中／下＋「置中於框」）、屬性面板（錨點 X/Y、框 X/Y/W/H、字級、行高、水平／垂直對齊、顏色、粗體、換行）、單欄位「還原成 Excel 校準值」、全部還原、樣本或真實 job 資料即時預覽、縮放 50–150%、「產生測試 PDF」（iframe 預覽＋下載）、Ctrl+S 儲存、未儲存離開警告。

**API（`routes/xls-booking-layout.js`，掛 `/api/xls-booking/layout`）**

| Method | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/layout` | 登入 | 作用中 fieldmap ＋ `defaultFieldmap` ＋ 頁面／底圖／樣本清單／備份清單／`canEdit`（admin or staff）＋ baseline 模型 |
| PUT | `/layout` | admin／staff | 驗證（欄位白名單、box/origin 邊界、字級 4–72pt、顏色 `#RRGGBB`）→ 自動備份 → 寫檔；無變更不寫檔 |
| POST | `/layout/reset` | admin／staff | 由 `sli-eli-fieldmap.default.json` 還原（可指定 `keys`）→ 備份 → 寫檔 |
| POST | `/layout/preview` | 登入 | 用（可選）草稿 fieldmap 產生**排版結果**（`engine.layout()`）＋可選測試 PDF（base64）；非 Latin-1 樣本回報 `renderable=false` |
| GET | `/layout/backups` | admin／staff | 備份清單（`sli-eli-fieldmap.bak-<ts>.json`，含毫秒避免同秒覆蓋） |
| GET | `/layout/background/:page` | 登入 | 底圖 PNG（`data/templates/sli-eli-blank-pN.png`） |

**推導值由後端統一計算（關鍵）**：編輯器只送 `origin / box / font / align / wrap / lineHeightPt`，後端推導並寫回
`textBaselineOffsetPt`（依 baseline 模型 `v=top → +ascent×size`、`v=bottom → −descent×size`、`v=center → +(ascent−descent)/2×size`；
實測與現有 fieldmap 完全一致：3.62 / 7.28 / −1.71 / −1.91）、`wrapWidthPt`（＝原值 ＋ 框寬變動量）、`maxLines`（`floor(box.h/lineHeightPt)`，`wrap=false` 時 1）。
**預覽的文字行位置一律由伺服器 `engine.layout()` 回傳**（前端只做 pt→px 換算）→ 編輯器所見即 PDF 所見。

**實測（`node scripts/test-sli-eli-layout.js`，自帶伺服器端對端，2026-10-13）**

| 驗收 | 結果 |
|---|---|
| GET `/layout` | **OK**：10 欄位／2 頁（SLI+ELI）／`canEdit=true`／baseline `0.9053/0.2124`／`engineIssue=null` |
| 底圖 PNG | **OK**：86,462 bytes（PNG magic 正確） |
| POST `/preview`（樣本） | **OK**：`renderable=true`、`sli.D23` 1 行且有位置、未要求 PDF 時不回傳（省頻寬） |
| POST `/preview`（wantPdf） | **OK**：**116.1 KB** PDF（含完整背景） |
| PUT 超界／未知欄位 | **OK**：`400`「sli.D23：文字框超出頁面（頁面 595.28×841.89pt）」／`400`「zz.NOPE：未知欄位」 |
| PUT 合法變更（位移 +5/+5、框寬 +10） | **OK**：`changed=['sli.D23']`、自動備份、`wrapWidthPt 113.32 → 123.32`、`textBaselineOffsetPt` 維持 3.62 |
| 幾何一致性 | **OK**：預覽文字位置 `dx=+5.00 dy=+5.00` |
| POST `/reset`（指定 key） | **OK**：`changed=['sli.D23']`、回到 `box x=91.88 w=113.87`（Excel 校準值） |
| 備份清單 | **OK**：≥ 2 筆 |

**尚待（選項，非需求）**：① 若要檔案 <120 KB → 簡化 `cainiao-sli-eli-template.xlsx`（減少字型家族／繪圖物件）；② 讓內嵌 Arial 全字符集生效（順序調整，代價約 +35 KB/份）。

### P4 前置 ＋ P4 原始規格（已完成，保留供追溯）
- 建置腳本內建「字符集匯出 + 字型加寬」（`scripts/sli-eli-blank-widen-fonts.js`）：背景的 Arial 子集覆蓋率提升（並使空白 122.3 → 114.0 KB、像素與 commit 版完全相同；建置時 assert 加寬前後 0.0000%）
- 建置腳本內建 **baseline 解析模型**（Arial 行盒）＋ 實測校準值（字級／行距／換行寬度／`maxLines`／`dateFormat`）→ 150dpi 差異 0.432/0.638 → **0.230/0.329（已在門檻內）**
- 選項（暫不啟用）：把「優化空白 → 優化 charset → 加寬」的順序調換可讓內嵌 Arial 100% 生效（差異再降到 ~0.14/0.25），代價每份約 +35 KB

- `scripts/xls-workflow.js`：`XLS_PDF_ENGINE=overlay|com`（未設定＝`com`，保留舊行為）
  - overlay 模式**跳過 Step 3（Excel COM 產生 SLI/ELI PDF）與 Step 4（merge／A4 正規化）**，直接用 `engine.render()` 寫出 `{MAWB}.pdf`（背景已是 A4，**不需 Step 4.5 字型優化**——只有已優化的背景字型＋標準字型參照）
  - 用 `engine.partition(records)` 分派：`fallback` 的記錄（非 Latin-1）走舊 COM 路徑，其餘用疊字；仍要保留 `result.fontOpt` / `result.paper` 的相容欄位（overlay 模式可回報 `skipped`／實測尺寸）
- **失敗自動退回**：背景 PDF／fieldmap 缺失、`blankPdfSha256` 不符、`engine` 建立例外、單筆 render 例外 → 該筆退回 `com`
- `routes/xls-booking.js`：`POST /process` 接受 `engine`（白名單）、結果帶 `engine`／`fallbackCount`
- UI（需求 3「新的功能放到最頂」與需求 2「舊網站保留」）：
  - `public/index.html`：④ 執行產生的 `.xls-run-row` **最前面**加「PDF 產生方式」選擇器（預設舊版 Excel）
  - 側邊欄新 nav-item（`sli-eli-layout.html`）放 **HOME 之後第一位**（`sanitizeNavOrder` 的 `NAV_PAGE_RE` 已允許 `*.html`，`MAX_ORDER_ITEMS=20`）
  - 驗收：`XLS_PDF_ENGINE` 未設定時行為與現況 100% 相同

### P5 原始規格（已完成，保留供追溯）

- 新頁 `public/sli-eli-layout.html` + `public/js/sli-eli-layout-{state,editor,main}.js` + `public/css/sli-eli-layout.css`（比照 `uld-packing.html` 的獨立頁模式）
- 底圖：直接用 `data/templates/sli-eli-blank-p{1,2}.png`（純靜態、無 CDN 相依）
- 功能：頁籤（SLI/ELI）、10 欄位清單、拖曳移動、把手縮放、方向鍵微調（Shift=10pt）、格線吸附、Undo/Redo、對齊工具、單欄位／全部「還原成 Excel 校準值」、樣本或真實資料即時預覽、「產生測試 PDF」
- API（掛在 `/api/xls-booking/layout`，**寫入需 `requireRole('admin','staff')`**）：`GET /layout`、`PUT /layout`、`POST /layout/reset`、`POST /layout/preview`
- 排版數學（換行／對齊／baseline）必須與 P3 共用同一份程式，避免「編輯器看到什麼 ≠ PDF 長什麼」

---

## 3. 檔案地圖（本次工作）

### 新增（P3）

| 檔案 | 角色 |
|---|---|
| `scripts/sli-eli-overlay.js` | **疊字產生器引擎**（pdf-lib；可 require 的 API、排版純函式、內嵌 Arial 子集沿用、非 Latin-1 退回判定） |
| `scripts/sli-eli-diff.py` | 150dpi 逐像素比對＋文字抽取橋接（以 importlib 重用 `sli-eli-font-optimize.py` 的 `diff_pages`；`--jobs` 批次模式） |
| `scripts/test-sli-eli-overlay.js` | P3 驗收腳本（頁數／A4／文字可抽取／差異 < 0.5%／檔案大小／每筆耗時／fallback 判定） |
| `scripts/sli-eli-blank-widen-fonts.js` | **P4 前置**：把「字符集匯出 PDF」的 Arial 字型程式搬進空白（跨文件搬移 FontFile2/Descriptor/Widths；驗證覆蓋率、像素必須不變） |

### 新增（P1 / P2）

| 檔案 | 角色 |
|---|---|
| `scripts/sli-eli-font-optimize.py` | 字型瘦身（CLI + 可被 importlib 載入的函式庫）：`--report` / `--diff` / `--inplace` |
| `scripts/build-sli-eli-blank.py` | 建置 A4 空白背景 + fieldmap + 底圖（含自我校準與 QA） |
| `scripts/test-pdf-a4.js` | A4 正規化驗證（合併→正規化→斷言 A4） |
| `scripts/test-a4-integration.js` | 免伺服器端對端（合成 3 筆跑完 Step 1~5，驗證 A4 + 字型優化 + ZIP） |
| `data/templates/sli-eli-blank.pdf` | 空白背景（**執行期需要，要進版控**） |
| `data/templates/sli-eli-blank-p1.png` / `-p2.png` | 編輯器底圖（P5 需要） |
| `data/templates/sli-eli-fieldmap.default.json` / `sli-eli-fieldmap.json` | 欄位座標 |
| `data/templates/sli-eli-blank-meta.json` | 產出資訊（sha256／transforms／殘差） |
| `docs/design/xls-sli-eli-overlay-prd.md` | 本文件 |

### 修改

| 檔案 | 變更 |
|---|---|
| `scripts/xls-sli-eli.js` | 新增 `readPdfPageSizes()`、`normalizePdfToA4()`、`optimizePdfFontsInPlace()`、`A4_SIZE` |
| `scripts/xls-workflow.js` | Step 4 加 A4 正規化＋紙張驗證；新增 Step 4.5 字型優化；`result.paper` / `result.fontOpt`；`--paper` 傳給 worker |
| `scripts/sli-eli-generate.py` | `PDF_PAPER` / `--paper` / `--a4-zoom`；兩條引擎都設定 A4 頁面設定；多印 `PAPER:` 行 |
| `scripts/test-sli-generate.py` | 新增頁面尺寸量測輸出 |
| `routes/xls-booking.js` | 結果帶出 `paper` / `fontOpt` |
| `public/js/xls-booking-workflow.js` | 結果面板顯示紙張實測與字型優化幅度 |
| `public/css/xls-booking.css` | `.xls-paper-info` / `.xls-paper-warn` |
| `Dockerfile` | pip 加 `pymupdf` |
| `CLAUDE.md` / `README.md` | A4 修正、字型優化、P2 產物與陷阱（**已寫入，供新對話自動載入**） |

### 新增（P5）

| 檔案 | 角色 |
|---|---|
| `public/sli-eli-layout.html` | 版面編輯器獨立頁（比照 `uld-packing.html`；側欄：返回主頁／本頁／Shipper Role Project） |
| `public/js/sli-eli-layout-state.js` | state／幾何（移動、縮放、對齊、吸附、推導值）／API 包裝／預覽排程 |
| `public/js/sli-eli-layout-editor.js` | 畫布渲染（底圖＋欄位框＋文字行）、拖曳縮放、鍵盤、屬性面板、Undo/Redo |
| `public/js/sli-eli-layout-main.js` | 入口、工具列綁定、儲存／還原／產生測試 PDF、PDF modal、備份顯示 |
| `public/css/sli-eli-layout.css` | 編輯器樣式（畫布、把手、屬性面板、modal） |
| `routes/xls-booking-layout.js` | 版面編輯器 API（GET／PUT／reset／preview／backups／background）＋驗證與推導 |
| `scripts/test-sli-eli-layout.js` | P5 驗收（自帶伺服器端對端；結束自動還原 fieldmap 並清除備份） |

### 修改（P5）

| 檔案 | 變更 |
|---|---|
| `routes/xls-booking.js` | 掛載 `router.use('/layout', layoutRouter)`（上層 `requireAuth`，寫入另檢 `requireRole`） |
| `public/index.html` | 側欄 HOME 之後第一位新增 `sli-eli-layout.html`（`#nav-sli-eli-layout`） |
| `public/js/auth.js` | 未登入顯示鎖頭並導向登入頁（`login-redirect` 記頁面路徑）、登入後解鎖 |
| `scripts/fix-nav-order.js` | `DEFAULT_ORDER` 首項加 `sli-eli-layout.html`（既有自訂排序的使用者執行後會就近補上） |
| `.gitignore` | 排除 `data/templates/sli-eli-fieldmap.bak-*.json`（編輯器自動備份，可重建） |
| `scripts/test-nav-order-frontend.js` | 側欄 fixture 加入 `sli-eli-layout.html`（11 項）——新增頁面後同步更新，避免測試與實際側欄不一致 |

### 新增（P4）

| 檔案 | 用途 |
|---|---|
| `scripts/test-p4-engine.js` | 引擎分派驗證：case 0 `XLS_PDF_ENGINE` 解析（純函式）／case 1 混合批次（2 疊字＋1 退回）／case 2 背景缺失全退回 |

### 修改（P4）

| 檔案 | 變更 |
|---|---|
| `scripts/xls-workflow.js` | 新增 `resolvePdfEngineMode()`；`runWorkflow({ pdfEngine })`；`engine.partition()` 分派（overlay 直接 `renderMany()` 寫 `{MAWB}.pdf`、fallback 排入同批 COM）；`result.engine` / `result.fallbackCount`；overlay 只對退回檔做 Step 4.5 |
| `routes/xls-booking.js` | `POST /process` 接受 `engine`（白名單，非法回 400）並傳入 `runWorkflow`；結果帶 `engine` / `fallbackCount` |
| `public/index.html` | `.xls-run-row` 最前面新增「PDF 產生方式」`#xls-pdf-engine`（預設 Excel（舊版）） |
| `public/js/xls-booking-state.js` | `xlsState.pdfEngine`（預設 `'com'`）＋初始化綁定 |
| `public/js/xls-booking-workflow.js` | 請求帶 `engine`；結果面板顯示產生方式／疊字份數／退回筆數／耗時與退回原因 |
| `public/css/xls-booking.css` | `.xls-engine-control`（與並行數選擇器同款式＋主色外框） |

### 修改（P3）

| 檔案 | 變更 |
|---|---|
| `data/templates/sli-eli-fieldmap.json` / `.default.json` | **v2 校準**（建置腳本現在會直接產出）：實測字級、行距、`wrapWidthPt`、`dateFormat`、`maxLines` floor、**baseline 解析模型** |
| `scripts/build-sli-eli-blank.py` | P4 前置：新增「字符集匯入格」匯出＋呼叫 `sli-eli-blank-widen-fonts.js`＋assert 加寬像素不變；內建實測校準表與 baseline 解析模型 |
| `data/templates/sli-eli-blank.pdf` | 加寬後再優化 → **114.0 KB**（與 commit 版像素／文字完全相同） |

---

## 4. 環境需求與開關

| 項目 | 說明 |
|---|---|
| 本機（Windows） | Excel **16.0**（COM 可用）、Python 3.13 + `pymupdf 1.28.2` + `pypdf` + `openpyxl` + `pillow`、Node 24。**Ghostscript 未安裝也不需要** |
| Railway / Docker | `Dockerfile` 已含 libreoffice + openpyxl + pypdf + **pymupdf**（A4／瘦身／建置都能跑） |
| `PDF_PAPER` | `a4`（預設）｜`custom`（完全還原舊行為） |
| `PDF_FONT_OPT` | `on`（預設）｜`off` |
| `XLS_PDF_ENGINE` | `com`（預設／未設定＝舊版 Excel 引擎，行為 100% 不變）｜`overlay`（疊字引擎，P4） |
| `SLI_ELI_BLANK_PDF` / `SLI_ELI_FIELDMAP` | 既有（P3 引擎可覆寫背景 PDF／fieldmap 路徑；缺失即自動退回 `com`） |
| `fontMode`（P3 引擎參數） | `auto`（預設，優先沿用背景內嵌的 Arial 子集）｜`standard`（強制 pdf-lib 標準字型） |
| `XLS_PDF_CONCURRENCY` | 既有（預設 2；Windows COM 建議 1） |
| `DATA_DIR` | 既有（覆寫 `data/`） |

---

## 5. 驗證指令（可直接跑，全部應通過）

```powershell
# P1 A4：Excel 原始匯出尺寸 → 合併後正規化 → 斷言 A4
python scripts/test-sli-generate.py
node scripts/test-pdf-a4.js

# 端對端（免伺服器）：合成 3 筆跑完 Step 1~5
# 期望：count=3、errors=[]、每份 2 頁 A4（595.3x841.9 / 595.0x842.0）、
#       fontOpt {"files":3,"reductionPct":76.8}、ZIP 正常
node scripts/test-a4-integration.js

# 回滾驗證：$env:PDF_FONT_OPT='off' / $env:PDF_PAPER='custom' → 應回到 532.9KB / 915.3pt
$env:PDF_FONT_OPT='off'; node scripts/test-a4-integration.js; Remove-Item Env:PDF_FONT_OPT

# P2 產物：重建（模板變更時必須重跑）＋ 驗證
#   註：重建現在包含「字符集匯出 + 字型加寬」（P4 前置）與實測校準表，全部自動化
python scripts/build-sli-eli-blank.py --keep-work --force
python data/test-p2/verify-build.py      # 期望：驗證 PASS、加寬前後像素 0.0000%、空白 ~114 KB
python data/test-p2/list-fieldmap.py     # 列出 10 欄位座標與殘差

# P4 前置：baseline 解析模型驗證（期望模型誤差 ≤ 0.03pt）
python data/test-p3/measure-baseline-delta.py

# 字型加寬單獨用（把 charset PDF 的 Arial 搬進空白）
node scripts/sli-eli-blank-widen-fonts.js --blank blank-a4.pdf --charset charset-air.pdf charset-eli.pdf --out widened.pdf

# 字型瘦身單獨用
python scripts/sli-eli-font-optimize.py <in.pdf> <out.pdf> --diff
python scripts/sli-eli-font-optimize.py <in.pdf> --report

# ===== P3 疊字產生器 =====
# 驗收（會自動找最近含 payload + {MAWB}.pdf 的 job；建議指定真實 job）
# 期望：2 頁 A4、文字可抽取、每份 ~125 KB、每筆 15–55 ms、差異 < 0.5%（未達時會列出逐頁數字與地板值）
node scripts/test-sli-eli-overlay.js --ref data/work/job-zRSCW0
node scripts/test-sli-eli-overlay.js --ref data/work/job-zRSCW0 --limit 1 --dpi 150
node scripts/test-sli-eli-overlay.js --no-diff          # 只驗結構（無參考檔時）

# 單筆／批次（API 冒煙測試）
node -e "require('./scripts/sli-eli-overlay').renderRecord({mawb:'999-12345678',dest:'LHR',flightCompany:'CX',flightDate:new Date(),cnee:'ACME LTD',cneeTel:'+44 20 1234'}, 'data/test-p3/one.pdf').then(r=>console.log(r.status,r.bytes,r.fontPaths))"

# 逐像素比對橋接（單筆／批次）
python scripts/sli-eli-diff.py --mine a.pdf --ref b.pdf --dpi 150 --needle 065-49876385 --json
```

### P4 引擎分派驗證（2026-10-13 實測，全部 PASS）

```powershell
# com（預設／未設定）：與現況 100% 相同 → count=3、每份 123.4 KB、fontOpt -76.9%、耗時 ~12 s
node scripts/test-a4-integration.js

# overlay：3 份 116.0 KB、2 頁 A4、fontOpt {files:0, skipped:true}、耗時 ~1.1 s（≈11× 快）
$env:XLS_PDF_ENGINE='overlay'; node scripts/test-a4-integration.js; Remove-Item Env:XLS_PDF_ENGINE

# 引擎分派專用：case 0 環境變數解析／case 1 混合批次（2 疊字＋1 退回）／case 2 背景缺失全退回
node scripts/test-p4-engine.js
```

### P5 版面編輯器驗證（2026-10-13 實測，全部 PASS）

```powershell
# 自帶伺服器端對端：GET／preview／wantPdf／PUT 驗證（400）／備份／reset／幾何一致性
# （會暫時改寫 data/templates/sli-eli-fieldmap.json，結束自動還原並清除本次備份）
node scripts/test-sli-eli-layout.js

# 瀏覽器手動檢查：登入後 → 側欄最上方「SLI/ELI 版面編輯器」
#   http://127.0.0.1:3000/sli-eli-layout.html
```

### P3 校準工具（`.gitignore` 內，需要時重跑；產生 fieldmap v2 的實測值）

```powershell
python data/test-p3/measure-refs.py     # 逐欄位實測字級／行距（期望：D9 5.88/7.56、M16 8.04/10.20）
python data/test-p3/measure-wrap.py     # 交期換行寬度上下界、日期顯示格式（期望：03/Oct/2026）
node   data/test-p3/apply-calibration.js  # 把實測值寫進兩份 fieldmap（可重複執行；值由 box/meta 推導）
python data/test-p3/ink-bbox.py a.pdf b.pdf   # 逐欄位 ink 邊界位移（期望 0.00 pt）
python data/test-p3/probe-visual.py a.pdf b.pdf  # 逐欄位「ref/mine/差異」目視對照圖
```

---

## 6. 陷阱（踩過的，別再重試）

1. **不要用「頁面設定解析式」算座標**：Excel 的紙張由印表機 DEVMODE 決定、FitToPage 不可推算 → 誤差 **42 pt**。一律以 marker 實測位置為準（`analyticDeltaMaxPt` 就是這個診斷值）。
2. **Excel 無法從 COM 強制 A4**：改 `PageSetup.PaperSize`／存檔重開／`FitToPagesWide` 都無效（已實測）。A4 一律由 Node `normalizePdfToA4()` 保證。
3. **合併格要清空必須用 `MergeArea`**：`ws.Range(cell).ClearContents()` 會拋 `We can't do that to a merged cell.`；要 `ws.Range(cell).MergeArea.ClearContents()`。
4. **`page.get_fonts()` 抓不到所有字型程式**：Excel 會產出不在頁面資源內的字型（實測 213 KB 的 CJK 字型）。要改用「掃描所有帶 `/Length1` 的 stream」。
5. **PyMuPDF 的 `subset_fonts()` 只做子集化**：仍保留 `name`（9–12KB）與 hinting（4.6–14KB）→ 必須再做表格／指令移除（本專案的 `sli-eli-font-optimize.py`）。
6. **`rewrite_images(dpi_threshold, dpi_target)`** 要求 `dpi_target < dpi_threshold`，否則 `ValueError`；實測點陣化對本表單沒幫助（灰階底紋二值化後更難壓）。
7. **檔名含連字號的 Python 檔不能 `import`**：`sli-eli-font-optimize.py` 要用 `importlib.util.spec_from_file_location` 載入。
8. **Excel 殘留行程會鎖住檔案**：建置腳本每次用不同檔名的工作複本（`template-copy-<pid>.xlsx`）；清理用 `taskkill`（`Quit()` 常無效），並先用 `tasklist` 確認 PID 仍是 `EXCEL.EXE`。
9. **`FILE_INVENTORY.md` 是自動產生，勿手改**：要更新請跑 `npm run sync`（會一併更新 `PROJECT_MAP.md` / `WORKSPACE_STATE.md` / `.project-state.json`）。
10. **`data/work` 已累積 ~2.5 GB / 148 個 job**（`.gitignore` 內）：需要時用 `POST /api/xls-booking/cleanup`。
11. **`PDFName.asString()` 會帶前導 `/`**（pdf-lib）：比對 `/WinAnsiEncoding`、`/FlateDecode`、資源名（`/F1`）時要先去掉 `/`，否則會靜默比對失敗（P3 一開始就是這樣抓不到內嵌字型）。
12. **pdf-lib 的標準字型「延遲嵌入」**：`embedFont()` 不會立刻建立 font dict，要改動它必須先 `font.embed()`，否則 `context.lookup(font.ref, PDFDict)` 得到 `undefined`。
13. **pdf-lib 的標準字型不寫 `/Widths`**：`StandardFontEmbedder` 只寫 `/BaseFont`＋`/Encoding`。P3 已自行補上 Helvetica AFM 的 `/Widths`（32–255）；雖然對 MuPDF 的取代字型排版沒有差別，但對其他檢視器是正確且必要的。
14. **Excel 對「放不下的行」是不畫（不是溢出）**：換行欄位若行數超過儲存格高度，Excel 直接省略後面幾行 → `maxLines = floor(box.h / lineHeightPt)`，不要用 `round`、也不要用 `size×1.2`。
15. **Excel 的日期格會格式化 payload 字串**：`2026-10-03` 會被 Excel 當日期、以格子的數字格式顯示成 **`03/Oct/2026`**。疊字必須套用同樣格式（fieldmap `dateFormat`），否則 PDF 內容與舊引擎不同。
16. **Excel 實際字級 ≠ `Font.Size × transforms.scale`**：P2 建置腳本用 marker ink 寬度推導縮放（air = 0.63528）會低估 ~2.4%；正確值是 **`Font.Size × (A4 寬 ÷ 匯出頁寬)` = 0.65035**（ELI 頁 ≈ 1.0）。目前 `font.sizePt` 由實測校準表（`CALIB_SIZE_PT`）給定、`box.w/h` 仍用 marker 縮放（只影響編輯器顯示框與 `wrapWidthPt` 推導，已驗證安全）；**重建時若要改，請兩者一起改**。
17. **`textBaselineOffsetPt` 不要用 `@` 墨跡校準（P2 的坑）**：Excel 的垂直定位用**行盒**（Arial hhea ascent 0.9053em／descent 0.2124em），`@` 的墨跡高度剛好等於 ascent 才讓墨跡法看起來可用，但真實資料會偏 **0.3~1.4pt**（v=top −0.8~−1.4、v=center −0.32、v=bottom +0.7~+1.1）→ 150dpi 差異從 0.33% 惡化到 0.64%。改用解析模型（`baseline_offset()`）後與 Excel 誤差 ≤ 0.03pt。驗證：`python data/test-p3/measure-baseline-delta.py`。
18. **150dpi 逐像素差異的地板 ≈ 0.19~0.29%**：把 Excel 自己的文字原地原字級重畫（真 Arial）仍有 0.187%/0.290%（Helvetica 0.248%/0.355%）→ 判讀差異值要扣掉地板；目前實測 0.230/0.329（已 < 0.5%）。差異幾乎全部在 10 個欄位框內（框外 0.002%）。
19. **字型優化會把「未被內容引用」的字元剃掉**：`sli-eli-font-optimize.py` 的 `subset_fonts()` 只保留內容流用到的字符 → 「先加寬空白再優化」會把 charset 的字元又剃掉（213 → 75/72）。若要用內嵌 Arial 全字符集，順序必須是「優化空白 → 優化 charset PDF → 加寬」，且加寬後**不能再跑優化**。
20. **驗證腳本不要平行跑**：`scripts/test-sli-eli-overlay.js` 的輸出目錄固定為 `data/test-p3-overlay/`，同時跑兩份會互相刪檔，造成 diff 靜默略過（曾出現「假 PASS」；已在腳本內改成明確 FAIL）。
21. **跨文件搬移 PDF 物件要小心間接引用**：`/Widths` 在 Excel 產出常是 `12 0 R`（間接），只複製純量值會讓它整個消失（PDF 仍可讀、只有排版會變）→ 搬移前必須 `context.lookup(ref)`。
22. **`engine.partition()` 只做分類、不會排程**：回傳的 `fallback[]` 記錄必須自己推回舊 COM 的 `comPayload` 佇列（`f.record`）。只把它們算進 `fallbackCount` 而不排程，會**靜默少產出**那些 PDF（count 變少、errors 卻是空的）——P4 實作時踩過一次，`scripts/test-p4-engine.js` case 1 就是防這個。
23. **`engine.render()` 回傳的 `bytes` 是「位元組數」不是 PDF 內容**：要拿內容必須給 `outputPath` 再讀檔（`render(rec, tmpPath)` → `fs.readFile`）。用 `Buffer.from(r.bytes).toString('base64')` 只會得到全零 buffer／空 base64（P5 預覽 PDF 時踩過，測試才抓到）。
24. **備份檔名只到「秒」會互相覆蓋**：同一秒內連續 PUT／reset（例如前端「儲存」後立刻「還原全部」）會讓後一次備份蓋掉前一次 → 檔名要帶毫秒，並在碰撞時加隨機後綴。`test-sli-eli-layout.js` 的「備份清單 ≥ 2 筆」就是防這個。
25. **Windows 上用 PowerShell 對檔案做「插行」要小心**：以行號插入的編輯若錨點落在函式內部，會把後面的內容（含 `main().catch(...)`）擠到函式尾巴，造成「語法通過但 `main()` 從未被呼叫」的靜默失敗（P5 撰寫測試腳本時踩過）。寫大型檔案請用「附加到檔尾」或先刪檔重建。

---

## 7. 未提交變更（P5 完成當下）

```
M  CLAUDE.md / WORKSPACE_STATE.md / FILE_INVENTORY.md / .gitignore
M  docs/design/xls-sli-eli-overlay-prd.md
M  scripts/xls-workflow.js                       ← P4：XLS_PDF_ENGINE 分派 ＋ 自動退回 ＋ result.engine
M  routes/xls-booking.js                         ← P4：engine 白名單（非法 400）＋ P5：掛載 /layout
?? routes/xls-booking-layout.js                  ← P5：版面編輯器 API（GET/PUT/reset/preview/backups/background）
M  public/index.html                             ← P4：PDF 產生方式選擇器；P5：側欄最頂新項目
M  public/js/auth.js                             ← P5：新項目的鎖頭／登入後解鎖
M  public/css/xls-booking.css / public/js/xls-booking-state.js / public/js/xls-booking-workflow.js   ← P4：引擎選擇器與結果面板
?? public/sli-eli-layout.html / public/js/sli-eli-layout-{state,editor,main}.js / public/css/sli-eli-layout.css   ← P5：版面編輯器
M  scripts/fix-nav-order.js                      ← P5：DEFAULT_ORDER 首項加 sli-eli-layout.html
?? scripts/test-p4-engine.js / scripts/test-sli-eli-layout.js   ← P4／P5 驗收腳本
M  database.db                                   ← P5：fix-nav-order.js 就近補上 sli-eli-layout.html（admin 10 → 11 項）
M  scripts/build-sli-eli-blank.py / data/templates/sli-eli-fieldmap.json / .default.json / sli-eli-blank.pdf / sli-eli-blank-meta.json  ← P4 前置（校準＋字符集加寬，空白 114.0 KB）
?? scripts/sli-eli-overlay.js / sli-eli-diff.py / test-sli-eli-overlay.js / sli-eli-blank-widen-fonts.js
（P1/P2 的變更與使用者先前 WIP 已於 dd6c0ba commit）
```

*註：`data/templates/sli-eli-fieldmap.json` 目前內容與 commit 版相同（P5 測試結束會還原）；編輯器產生的 `sli-eli-fieldmap.bak-*.json` 已加入 `.gitignore`。*

---

## 8. 新對話提示詞（P1～P5 已完成；沿用／維護用，直接複製）

```text
延續 AGL-Web-Portal 的 Shipper Role 專案（SLI/ELI PDF）。

請先讀 docs/design/xls-sli-eli-overlay-prd.md（交接待辦＋已完成事項＋25 條陷阱）
與 CLAUDE.md 的「Shipper Role Project」段落；開頭照例先跑 npm run sync。

現況：P1～P5 全部完成並驗證（細節在 PRD §1／§2），需求 1～4 都已交付：
- P1 A4 修正、P2a 字型瘦身 -77%、P2b 疊字背景＋fieldmap、P3 疊字產生器
- P4 主流程引擎分派：XLS_PDF_ENGINE=overlay|com（未設定＝com＝舊行為 100% 不變）；
  overlay 直接輸出 {MAWB}.pdf（116.0 KB／3 筆 1.1 秒）；非 Latin-1 或任何例外自動退回同批 COM；
  ④ 執行產生最前面有「PDF 產生方式」選擇器；POST /process 接受 engine（白名單、非法 400）。
- P5 版面編輯器：public/sli-eli-layout.html（側欄最上方）＋ /api/xls-booking/layout
  （GET／PUT／reset／preview／backups／background；寫入需 admin/staff；每次寫檔自動備份）；
  編輯器只送 origin/box/font/align/wrap/lineHeightPt，推導值（baseline 偏移／換行寬／maxLines）
  一律由後端算，預覽文字位置由 engine.layout() 回傳 → 所見即 PDF 所見。

驗收（都要 PASS；勿平行跑，overlay 測試輸出目錄固定）：
  node scripts/test-sli-eli-overlay.js --ref data/work/job-zRSCW0
  node scripts/test-a4-integration.js                                  # com：123.4 KB／~12 s
  $env:XLS_PDF_ENGINE='overlay'; node scripts/test-a4-integration.js   # overlay：116.0 KB／~1.1 s
  node scripts/test-p4-engine.js                                       # 引擎分派／自動退回
  node scripts/test-sli-eli-layout.js                                  # 版面編輯器（自帶伺服器）

若還要繼續，只剩「選項（非需求）」：
1. 檔案再小於 120 KB → 簡化 cainiao-sli-eli-template.xlsx（減少字型家族／繪圖物件）；
   目前地板＝內容流 49.9 KB ＋ PDF 結構 16 KB（詳見 PRD §1 P2a 剩餘瓶頸）。
2. 讓「背景內嵌 Arial 全字符集」100% 生效 → 建置順序改為「優化空白 → 優化 charset PDF → 加寬」
   （此後不可再優化），代價約 +35 KB/份；150dpi 差異可再降到 ~0.14/0.25。
3. 若要動 fieldmap 結構（新增欄位／改來源）→ 必須同步 scripts/sli-eli-overlay.js 的
   resolveFieldValue 對應與 build-sli-eli-blank.py 的建置，並跑上面的驗收。
改完請更新 PRD、CLAUDE.md、WORKSPACE_STATE.md，最後 npm run sync。
```

---

## 9. 舊提示詞（P3，已完成，保留供追溯）

```text
延續 AGL-Web-Portal 的 Shipper Role 專案（SLI/ELI PDF）。請先讀
docs/design/xls-sli-eli-overlay-prd.md 與 CLAUDE.md 的「Shipper Role Project」段落。
請從 P3 開始：新增 scripts/sli-eli-overlay.js，用 pdf-lib 把 10 個欄位資料疊到
data/templates/sli-eli-blank.pdf 上，輸出 `{MAWB}.pdf`（2 頁 A4，不需 merge）。
要求：依 fieldmap 的 origin / textBaselineOffsetPt / align / wrap / lineHeightPt / box.w
排版（多行自行折行）；非 Latin-1 回報退回舊引擎；寫驗證腳本（150dpi 差異 < 0.5%、
頁數 2、A4、文字可抽取、印出檔案大小與每筆耗時）；先不要動主流程但保留可 require 的 API。
→ 已完成（見 §1 P3）。
```
