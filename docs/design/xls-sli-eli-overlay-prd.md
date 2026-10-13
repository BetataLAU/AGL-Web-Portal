# PRD／交接：SLI/ELI「A4 修正 + 字型瘦身 + 疊字背景」

> 建立：2026-10-13 ｜ 狀態：**P1、P2 已完成並驗證；P3～P5 待做**
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

---

## 2. 未完成（P3 ～ P5）

### P3 疊字產生器（下一步，建議先做）

新增 `scripts/sli-eli-overlay.js`（純 Node + pdf-lib，**不需要 Python／Excel／LibreOffice**）：

```
每筆 MAWB：
  背景 PDF（快取在記憶體）→ copyPages([0,1]) → 依 fieldmap 畫 10 段文字 → 寫出 `{MAWB}.pdf`
```

實作要點：
- 文字起點：`x = origin.x`（left）／`origin.x - width/2`（center）／`origin.x - width`（right，width 由 Helvetica 或嵌入字型量測）
- 首行 baseline：`origin.y + textBaselineOffsetPt`；多行則每行 `+= lineHeightPt`
- 垂直區塊對齊：`top` 由 origin.y 往下；`center` 以 origin.y 為區塊中心；`bottom` 以 origin.y 為區塊底部（即上面三個鍵的語意）
- 換行：`wrap=true` 時依 `box.w` 自動折行（可用 `@pdf-lib` 無內建 → 需自寫；量測字寬用 Helvetica / 嵌入字型）
- 字型：預設用 pdf-lib `StandardFonts.Helvetica` / `Helvetica-Bold`（**0 byte**，與 Arial 公制相容）
  - ⚠️ 動態字串若含 Latin-1 以外的字元（CNEE 偶爾有中文）→ **該筆自動退回舊引擎**並在結果面板示警
- 產出檔名與現行相同（`{MAWB}.pdf`），**不需再 merge**（背景本身就是 SLI+ELI 兩頁）

預期：**每份 ~125 KB、每筆 5–20 ms**（vs 現在每筆約 1.5 秒 Excel 匯出＋每筆一次 Python merge）。

驗收：與 Excel 版逐頁 150dpi 比對 < 0.5%、頁數 2、尺寸 A4、文字可抽取、30 筆總時間 < 3 秒。

### P4 接進主流程 + UI 最頂開關

- `scripts/xls-workflow.js`：`XLS_PDF_ENGINE=overlay|com`（未設定＝`com`，保留舊行為）；overlay 模式跳過 Step 3/4，改呼叫 P3，但仍要走 Step 4.5（A4 驗證／字型優化視情況）
- **失敗自動退回舊引擎**：背景 PDF／fieldmap 缺失、`templateSha256` 不符、CJK 內容、任何例外 → 退回 `com` 路徑並在結果標示
- `routes/xls-booking.js`：`POST /process` 接受 `engine`（白名單）、結果帶 `engine`／`fallbackWarning`
- UI（需求 3「新的功能放到最頂」與需求 2「舊網站保留」）：
  - `public/index.html`：④ 執行產生的 `.xls-run-row` **最前面**加「PDF 產生方式」選擇器（預設舊版 Excel）
  - 側邊欄新 nav-item（`sli-eli-layout.html`）放 **HOME 之後第一位**（`sanitizeNavOrder` 的 `NAV_PAGE_RE` 已允許 `*.html`，`MAX_ORDER_ITEMS=20`）
  - 驗收：`XLS_PDF_ENGINE` 未設定時行為與現況 100% 相同

### P5 版面編輯器（需求 4）

- 新頁 `public/sli-eli-layout.html` + `public/js/sli-eli-layout.js` + `public/css/sli-eli-layout.css`（比照 `uld-packing.html` 的獨立頁模式）
- 底圖：直接用 `data/templates/sli-eli-blank-p{1,2}.png`（純靜態、無 CDN 相依）
- 功能：頁籤（SLI/ELI）、10 欄位清單、拖曳移動、把手縮放、方向鍵微調（Shift=10pt）、格線吸附、Undo/Redo、對齊工具、單欄位／全部「還原成 Excel 校準值」、樣本或真實資料即時預覽、「產生測試 PDF」
- API（掛在 `/api/xls-booking/layout`，**寫入需 `requireRole('admin','staff')`**）：
  - `GET /layout`（fieldmap + default + 底圖 URL + 頁面尺寸）
  - `PUT /layout`（驗證座標範圍／欄位白名單 → 寫檔並備份 `sli-eli-fieldmap.bak-<ts>.json`）
  - `POST /layout/reset`（還原 `default`）
  - `POST /layout/preview`（用單筆資料產生測試 PDF）
- 排版數學（換行／對齊／baseline）必須與 P3 共用同一份程式，避免「編輯器看到什麼 ≠ PDF 長什麼」

---

## 3. 檔案地圖（本次工作）

### 新增

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

---

## 4. 環境需求與開關

| 項目 | 說明 |
|---|---|
| 本機（Windows） | Excel **16.0**（COM 可用）、Python 3.13 + `pymupdf 1.28.2` + `pypdf` + `openpyxl` + `pillow`、Node 24。**Ghostscript 未安裝也不需要** |
| Railway / Docker | `Dockerfile` 已含 libreoffice + openpyxl + pypdf + **pymupdf**（A4／瘦身／建置都能跑） |
| `PDF_PAPER` | `a4`（預設）｜`custom`（完全還原舊行為） |
| `PDF_FONT_OPT` | `on`（預設）｜`off` |
| `XLS_PDF_ENGINE` | 尚未實作（P4）；未設定＝舊版 Excel 引擎 |
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
python scripts/build-sli-eli-blank.py --keep-work --force
python data/test-p2/verify-build.py      # 期望：驗證 PASS、錨定邊殘差 0.00 pt
python data/test-p2/list-fieldmap.py     # 列出 10 欄位座標與殘差

# 字型瘦身單獨用
python scripts/sli-eli-font-optimize.py <in.pdf> <out.pdf> --diff
python scripts/sli-eli-font-optimize.py <in.pdf> --report
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

---

## 7. 未提交變更（寫本文件當下）

```
M CLAUDE.md / Dockerfile / README.md / WORKSPACE_STATE.md
M data/templates/shipper-role-summary-2026.xlsx / database.db / db/sessions.db   ← 使用者跑 job 造成的例行變更
M docs/design/xls-pdf-parallel-prd.md
M public/css/xls-booking.css / public/js/xls-booking-workflow.js
M routes/xls-booking.js
M scripts/sli-eli-generate.py / scripts/test-sli-generate.py / scripts/xls-sli-eli.js / scripts/xls-workflow.js
?? data/templates/sli-eli-blank*.{pdf,png,json} / sli-eli-fieldmap*.json
?? scripts/{build-sli-eli-blank,sli-eli-font-optimize}.py, scripts/{test-a4-integration,test-pdf-a4}.js
```

包含**使用者先前的 WIP**（Excel `Document not saved` 容錯強化）＋ 本次 P1/P2，建議一起 commit 成 checkpoint 後再開新對話做 P3。

---

## 8. 新對話提示詞（直接複製）

```text
延續 AGL-Web-Portal 的 Shipper Role 專案（SLI/ELI PDF）。

請先讀 docs/design/xls-sli-eli-overlay-prd.md（交接待辦 + 已完成事項 + 陷阱），
以及 CLAUDE.md 的「Shipper Role Project」段落。

現況：
- P1（輸出修正為 A4）與 P2（字型瘦身 545KB→123KB、疊字背景 sli-eli-blank.pdf、
  fieldmap 10 欄位、編輯器底圖 PNG）都已完成並通過驗證。
- 未提交變更尚未 commit（含使用者先前的 WIP）。

請從 P3 開始：新增 scripts/sli-eli-overlay.js，用 pdf-lib 把 10 個欄位資料疊到
data/templates/sli-eli-blank.pdf 上，輸出 `{MAWB}.pdf`（2 頁 A4，不需 merge）。
要求：
1. 依 data/templates/sli-eli-fieldmap.json 的 origin / textBaselineOffsetPt /
   align / wrap / lineHeightPt / box.w 排版（多行要自行折行）。
2. 動態文字含非 Latin-1 字元時，回報「需退回舊引擎」而不是畫出亂碼。
3. 寫一支驗證腳本：與 Excel 版逐頁 150dpi 比對（差異 < 0.5%）、頁數 2、尺寸 A4、
   文字可抽取，並印出每份檔案大小與每筆耗時。
4. 先不要動主流程（P4 才接 xls-workflow.js），但請保留可被 require 的乾淨 API。

完成後把實測數據（大小／耗時／差異%）給我，再決定是否進 P4。
```
