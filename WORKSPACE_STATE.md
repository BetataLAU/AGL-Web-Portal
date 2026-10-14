# WORKSPACE_STATE — 工作狀態交接檔

> 供 AI Agent 每次新對話快速接上進度，由開發者／AI 在完成任務後更新。
> 編寫原則：只保留**最後 commit、近期里程碑（每項一行）、待辦 REMARK**；逐 commit 的同步細節請看 `git log`。

## 📌 目前狀態

- **最後 commit**：`dd6c0ba` feat(sli-eli): 輸出改 A4、PDF 字型瘦身 -77%、疊字背景與欄位座標 (P1/P2)
- **目前分支**：main（github.com/BetataLAU/AGL-Web-Portal）
- **工作目錄狀態（尚未提交，P3 ＋ P4 前置 ＋ P4 ＋ P5 ＋ ZIP 檔名修正 ＋ 字元處理）**：
  - **(G) 字元處理（第 0/1/2 層）**：新增 `scripts/pdf-charset.js`、`scripts/pdf-cjk-font.js`、`scripts/test-sli-eli-charset.js`；修改 `scripts/sli-eli-overlay.js`（淨化／WinAnsi 放寬／CJK 子集混排／`check().reason`）、`scripts/xls-workflow.js`（`fallbackReasons.reason`＋`engine.cjkFont`）、`scripts/sli-eli-blank-widen-fonts.js`＋`scripts/build-sli-eli-blank.py`（27 個 WinAnsi 特殊字）、`routes/xls-booking-layout.js`＋`public/js/xls-booking-workflow.js`＋`public/js/sli-eli-layout-main.js`（文案）、`Dockerfile`（`fonts-droid-fallback`）、`package.json`（`@pdf-lib/fontkit`）
  - **(F) ZIP 檔名修正**：`scripts/xls-utils.js`（`sanitizeFileLabel()`）、`scripts/xls-workflow.js`（`zipBaseName()`＋Step 5 改用它）、新增 `scripts/test-zip-naming.js`
  - **(E) P5 版面編輯器**：新增 `public/sli-eli-layout.html`、`public/js/sli-eli-layout-{state,editor,main}.js`、`public/css/sli-eli-layout.css`、`routes/xls-booking-layout.js`、`scripts/test-sli-eli-layout.js`；修改 `routes/xls-booking.js`（掛載 `/layout`）、`public/index.html`（側欄最頂新項目）、`public/js/auth.js`（鎖頭／解鎖）、`scripts/fix-nav-order.js`（DEFAULT_ORDER 首項）、`.gitignore`（fieldmap 備份）、`database.db`（admin 導覽排序 10 → 11 項）
  - **(D) P4**：`scripts/xls-workflow.js`（`XLS_PDF_ENGINE=overlay|com` 分派／失敗自動退回／`result.engine`＋`result.fallbackCount`）、`routes/xls-booking.js`（`engine` 白名單，非法回 400）、`public/index.html`＋`public/css/xls-booking.css`（④ `.xls-run-row` 最前「PDF 產生方式」選擇器）、`public/js/xls-booking-state.js`＋`xls-booking-workflow.js`（`xlsState.pdfEngine`＋結果面板顯示產生方式／退回筆數）、新增 `scripts/test-p4-engine.js`
  - **(C) P3＋P4 前置**：新增 `scripts/sli-eli-overlay.js`、`scripts/sli-eli-diff.py`、`scripts/test-sli-eli-overlay.js`、`scripts/sli-eli-blank-widen-fonts.js`；修改 `scripts/build-sli-eli-blank.py`（校準表／baseline 模型／字符集加寬）、`data/templates/sli-eli-fieldmap{,.default}.json`（v2）、`data/templates/sli-eli-blank.pdf`（114.0 KB，像素不變）、`CLAUDE.md`、`docs/design/xls-sli-eli-overlay-prd.md`（+ 本檔）
  - 例行變更：`data/templates/shipper-role-summary-2026.xlsx`、`database.db`、`db/sessions.db`、`server.*.log`
- **交接文件（新對話請先讀）**：`docs/design/xls-sli-eli-overlay-prd.md`（P1～P5 已完成＋字元處理三層＋實測數據、後續選項、可執行驗證指令、31 個已踩過的陷阱、新對話提示詞（§8））

## ✅ 近期里程碑（由新到舊；細節見 `git log`）

0. **字元處理：第 0/1/2 層（本次，尚未提交）**：舊版遇到「pdf-lib 標準字型編不出來」的字元就整筆退回 Excel（每筆 ~4 s、123–131 KB）。實測 178 個歷史 job、2,789 筆：462 筆（16.6%）含非 Latin-1，其中 **122 筆其實只含 `–`（U+2013）**、340 筆真的含中文／全形標點。
   - **第 0 層淨化**（`scripts/pdf-charset.js` `sanitizeText()`）：移除零寬（U+200B–200F／U+FEFF）／C0 控制字元／變體選擇器／U+180E；U+0085/U+2028/U+2029 → `\n`。**不做**任何可見字元替換（U+00AD／U+00A0／U+3000 保留）。
   - **第 1 層 WinAnsi 放寬**：判定由 Latin-1 改為「WinAnsiEncoding 可編碼」（ASCII＋Latin-1＋0x80–0x9F 的 27 個特殊字），`winAnsiHex` 改走 `winAnsiByte()` 對照表（舊版把 U+2013 寫成 `3F` `?`）→ **122 筆不再退回**（116.5 KB／~50 ms）。
   - **第 2 層 CJK 子集**（`scripts/pdf-cjk-font.js`＋`@pdf-lib/fontkit`）：按需子集內嵌（只有該筆用到才 +4~7 KB；`msjh.ttc` 解析 24 ms、快取 0.15 ms）；`makeMeasure()` 逐段累加寬度（全形 1em → 不位移）。**關鍵坑**：fontkit 對 `.ttc` 回傳 `TrueTypeCollection`（沒有 `createSubset`）→ 必須挑單一字型＋`new CustomFontSubsetEmbedder(...)`。`PDF_CJK=off` 一鍵回滾、`SLI_ELI_CJK_FONT` 可覆寫字型。
   - **實測**：`160-17592201`（含 `：`）＝**119.4 KB／74 ms**、150dpi 差異 **0.244%/0.396%**、文字可搜尋；P4 混合批次 `auto` → **overlay=3／com=0**、CJK 份 **123.7 KB**（Excel 退回版 131.3 KB）；`off` → overlay=2／com=1（`reason='cjk-disabled'`）。
   - **驗證**：新增 `scripts/test-sli-eli-charset.js` → **PASS**；`test-sli-eli-overlay.js` PASS、`test-p4-engine.js` PASS（含新 case 1b）、`test-sli-eli-layout.js` PASS、`test-a4-integration.js` PASS（com 模式 100% 不變）。
   - **已知限制**：字型缺字（emoji／罕見漢字）仍退回（`reason='no-glyph'`）；`sli-eli-blank.pdf` 尚未重建 → 27 個 WinAnsi 特殊字目前走標準字型（重建後會併進內嵌 Arial 子集）。
1. **修正：ZIP 檔名未過濾 Windows 非法字元（生產問題，本次，尚未提交）**：使用者實際跑 13 筆時失敗 `ENOENT ... job-Oh8QGx\20261013 - 5Y8050\ 13th Oct SLI x 13.zip`。
   - **根因**：來源「航班號」欄位的實際內容是 **`5Y8050/ 13th Oct`**（航班號＋日期），Step 5 直接用它組 ZIP 檔名 → `/` 在 Windows 既非法又是路徑分隔 → `path.join` 產生子目錄 → archiver 建檔 ENOENT（PDF 已產出，ZIP 失敗）。
   - **修法**：`scripts/xls-utils.js` 新增 `sanitizeFileLabel()`（非法字元連同前後空白→`-`、控制字元→空白、去頭尾空白與句點、長度上限 80、保留名稱 CON/NUL/COM1… 加 `_`、空字串→fallback）；`scripts/xls-workflow.js` 新增 `zipBaseName(grp)` 並改用於 Step 5（含 `path.basename()` 防禦）。
   - **相容**：既有命名慣例不變（實測仍為 `20260803 - CX257 SLI x 3.zip`；`20261013 - 5Y8050/ 13th Oct…` 變成 `20261013 - 5Y8050-13th Oct…`）。
   - **驗證**：新增 `scripts/test-zip-naming.js`（單元＋端到端＋「舊寫法會 ENOENT」對照組）→ **PASS**；回歸 `test-a4-integration.js`（ZIP 名不變）與 `test-p4-engine.js` → **PASS**。
1. **Shipper Role P5：SLI/ELI 版面編輯器（需求 4，本次，尚未提交）**：接續 P4。
   - **新頁 `public/sli-eli-layout.html`**（獨立頁模式）＋ `sli-eli-layout-{state,editor,main}.js` ＋ `sli-eli-layout.css`：頁籤（SLI/ELI）、10 欄位清單、底圖畫布拖曳移動、8 向把手縮放、方向鍵微調（Shift=10pt）、5pt 吸附＋格線、Undo/Redo（Ctrl+Z / Ctrl+Y）、對齊工具、屬性面板（錨點／框／字級／行高／對齊／顏色／粗體／換行）、單欄位還原（草稿）＋全部還原（寫檔）、樣本或**真實 job 資料**即時預覽、縮放 50–150%、「產生測試 PDF」（iframe＋下載）、Ctrl+S 儲存、未儲存離開警告。
   - **API `routes/xls-booking-layout.js`**（掛 `/api/xls-booking/layout`）：`GET /`／`PUT /`（**admin/staff**，白名單＋邊界驗證 → 自動備份 → 寫檔）／`POST /reset`（可指定 keys）／`POST /preview`（草稿排版＋可選 PDF）／`GET /backups`／`GET /background/:page`。
   - **所見即 PDF**：前端只送 `origin/box/font/align/wrap/lineHeightPt`；`textBaselineOffsetPt`／`wrapWidthPt`／`maxLines` 由後端推導，預覽文字位置全部來自 `engine.layout()`（與 P3 同一套數學）。
   - **側欄最頂**：`index.html` 在 HOME 之後第一位加 `sli-eli-layout.html`；`auth.js` 未登入顯示鎖頭並導回登入；`scripts/fix-nav-order.js` 的 `DEFAULT_ORDER` 置首並已修復本機 admin（10 → 11 項）。
   - **實測（`node scripts/test-sli-eli-layout.js` 全 PASS）**：GET 10 欄位／2 頁／canEdit／baseline `0.9053/0.2124`；底圖 PNG 86,462 bytes；preview 排版正確、測試 PDF **116.1 KB**；PUT 超界與未知欄位均 **400**；合法變更 `changed=['sli.D23']`＋自動備份＋`wrapWidthPt 113.32 → 123.32`＋`textBaselineOffsetPt` 不變；預覽位置 `dx=+5.00 dy=+5.00`；reset 回到 Excel 校準值；備份 ≥ 2 筆。
   - **回歸**：`test-a4-integration.js`（com 123.4 KB／overlay 116.0 KB）、`test-p4-engine.js`、`test-sli-eli-overlay.js`（0.329%）皆 PASS；側欄相關 `test-nav-order.js`／`test-nav-order-frontend.js` 亦 PASS（後者 fixture 已更新為 11 項）。
   - **未驗證（需人工）**：版面編輯器的實際滑鼠拖曳手感（目前驗證到 API／靜態資源／DOM id 綁定／伺服器排版層級）；容器（Railway/Docker）上的 overlay 引擎（本機無 Docker）。
1. **Shipper Role P4：接主流程（`XLS_PDF_ENGINE`）＋④ 最頂引擎選擇器＋自動退回（本次，尚未提交）**：接續 P3/P4 前置。
   - **主流程分派**（`scripts/xls-workflow.js`）：新增 `XLS_PDF_ENGINE=overlay|com`（未設定＝`com`＝**100% 舊行為**；`runWorkflow({ pdfEngine })` 由路由覆寫，`resolvePdfEngineMode()` 已 export）。overlay 模式用 `engine.partition(recordsPayload)` 分派 → 可疊字的直接 `renderMany()` 寫出 `{MAWB}.pdf`（**跳過 Step 3 Excel COM、Step 4 merge／A4 正規化、Step 4.5 字型優化**）；非 Latin-1（CNEE 中文／全形標點）與任何例外（背景／fieldmap 缺失、`blankPdfSha256` 不符、`createOverlayEngine` 失敗、單筆 render 例外）都排入同一批的舊 COM 路徑。
   - **相容欄位**：`result.engine = { mode, overlay, com, fallbackCount, fallbackReasons, overlayMs }`、`result.fallbackCount`、`result.paper`（照常實測）；`result.fontOpt` 純 overlay 為 `{files:0, skipped:true, engine:'overlay'}`，若有退回 COM 的檔案則只對那些檔案瘦身（否則會退回 ~545 KB）。
   - **路由／UI**：`POST /api/xls-booking/process` 接受 `engine`（白名單；非法回 400 `engine 僅支援 overlay 或 com`）＋結果帶 `engine`／`fallbackCount`；④ `.xls-run-row` **最前面**加「PDF 產生方式」`#xls-pdf-engine`（預設 Excel（舊版）），`xlsState.pdfEngine` 綁定，結果面板顯示產生方式／疊字份數／退回筆數／耗時與退回原因。
   - **實測（2026-10-13）**：com＝3 份 **123.4 KB**／12.1 s（與現況相同）；overlay＝3 份 **116.0 KB**／**1.1 s**（≈11× 快）；混合批次（2 疊字＋1 退回）count=3、`{overlay:2, com:1, fallbackCount:1}`、errors=[]；背景缺失 → 全部退回 COM（3 份 123.4/131.3/123.2 KB、字型優化 -76.7%）並明確回報；P3 疊字驗證無回歸（116.4 KB／0.230%/0.329%）。
   - 新驗證腳本：`node scripts/test-p4-engine.js`（case 0 環境變數解析／case 1 混合批次／case 2 全退回）；陷阱 22（`partition()` 只分類不排程，fallback 必須自己推回 COM 佇列）。
   - **下一步 P5**：版面編輯器（`public/sli-eli-layout.html`＋底圖拖曳＋`/api/xls-booking/layout`）＋側邊欄新項目置頂。詳見 `docs/design/xls-sli-eli-overlay-prd.md` §2／§8。
1. **Shipper Role P4 前置：差異根因修正 ＋ 字型加寬（本次，尚未提交）**：接續 P3。
   - **找到並修掉差異的真正根因**：`textBaselineOffsetPt`（P2 用 `@` marker **墨跡**校準）與 Excel 實際 baseline 差 0.3~1.4pt。Excel 用**行盒**定位（Arial hhea ascent 0.9053em／descent 0.2124em，`@` 墨跡高度剛好等於 ascent 才讓舊法看起來可用）→ 改成解析模型後與 Excel 誤差 ≤0.03pt，**150dpi 差異 0.432/0.638 → 0.230/0.329（< 0.5% ✅）**。
   - **建置腳本自動化**：`scripts/build-sli-eli-blank.py` 內建實測校準表（字級／行距／換行寬度／`maxLines` floor／`dateFormat`）＋ baseline 解析模型；新增「字符集匯出 + 字型加寬」（`scripts/sli-eli-blank-widen-fonts.js`，純 pdf-lib），讓背景內嵌的 Arial 子集覆蓋率提升、空白 **122.3 → 114.0 KB**，且與 commit 版**像素／文字完全相同**（建置時 assert 加寬前後 0.0000%）。
   - **實測**：每份 **116.4 KB**（更小）、每筆 45–55 ms、2 頁 A4、文字可抽取、非 Latin-1 正確退回；合成 3 筆 0.139%（走內嵌 Arial 路徑）。
   - 限制（已記錄成陷阱）：字型優化會再剃掉未被內容引用的字元，故「內嵌 Arial 全字符集」只部分生效（要 100% 需改順序，代價 ~+35 KB/份，暫不啟用）。
   - **接續**：P4（接主流程 `XLS_PDF_ENGINE` ＋ ④ 最頂引擎選擇器 ＋ 自動 fallback）已完成 → 見上方里程碑 0；下一步為 P5 版面編輯器。詳見 `docs/design/xls-sli-eli-overlay-prd.md`。
1. **Shipper Role P3：疊字 PDF 產生器（工具與驗收腳本，已隨 P4 前置一起完成）**：`scripts/sli-eli-overlay.js`＋`scripts/sli-eli-diff.py`＋`scripts/test-sli-eli-overlay.js`；fieldmap v2。
1. **Shipper Role：A4 修正 + PDF 字型瘦身 + 疊字背景（P1/P2，已於 `dd6c0ba` 提交）**：使用者需求＝加快 PDF 產生、把檔案從 ~500KB 降到 30–80KB，追加＝輸出改 A4、保留舊功能、新功能放最頂、提供版面編輯器。
   - **P1 A4**：實測 Excel 匯出紙張由「印表機驅動 DEVMODE ＋模板 printerSettings bin」決定，`PageSetup` 已是 A4/65% 仍匯出 915.3×1295.5pt（322.8×456.9mm = A4÷0.65）；改 PaperSize／存檔重開／FitToPage 皆無效。解法＝Node `normalizePdfToA4()`（pdf-lib `page.scale()`，內容流包 `q cm Q`、原始內容逐位元保留）→ 兩頁皆 A4、文字完全相同；`PDF_PAPER=custom` 可一鍵回滾。
   - **P2a 字型瘦身**：實測 Excel PDF 有 79% 是字型，且字型程式含 PDF 無用的 `name`（9–12KB/字型）與 hinting 表（4.6–14KB/字型）。新增 `scripts/sli-eli-font-optimize.py`（subset_fonts + 移除 name/hinting/glyf 指令 + 掃描 `/Length1` 找出隱藏字型）→ **545KB → 123.3KB（-76.8%）**、150dpi 逐像素差異 **0.000%**、文字仍可搜尋；接為 `runWorkflow` Step 4.5，`PDF_FONT_OPT=off` 可停用。48 檔 ZIP 24.3MB → 約 5.9MB。
   - **P2b 疊字背景＋fieldmap**：新增 `scripts/build-sli-eli-blank.py`（Excel COM + PyMuPDF，免 Ghostscript）產出 `sli-eli-blank.pdf`（A4、2 頁、動態格已清空、122KB）、編輯器底圖 PNG×2、`sli-eli-fieldmap.json`（10 欄位，**以 marker 實測位置錨定 + 自我校準 baseline，錨定邊殘差 0.00pt**）。
   - **驗證**：`node scripts/test-a4-integration.js`（免伺服器端對端 PASS）、`node scripts/test-pdf-a4.js`、`python scripts/test-sli-generate.py`、`python data/test-p2/verify-build.py`（PASS）。
   - **待辦 P3→P5**：疊字產生器（pdf-lib，每份 ~125KB、每筆 5–20ms）→ 接主流程＋④ 最頂引擎選擇器＋自動 fallback → 版面編輯器頁（底圖 + 拖曳 + fieldmap API）。詳見 `docs/design/xls-sli-eli-overlay-prd.md`。
1. **SLI/ELI 批次產生失敗修正（使用者先前 WIP，尚未提交）**：使用者以 4 workers 跑 35 筆，其中 shard 3 最後一筆 `369-10824144` 的 ELI 在 `ExportAsFixedFormat` 失敗（`-2147352567 'Document not saved. The document may be open, or an error may have been encountered when saving.'`）→ 因為一個 worker 失敗就丟棄全部 worker 的 stdout，整個 SLI/ELI 步驟（含 ZIP）全部白做（實測 `data/work/job-*` 只有 SLI/ELI PDF、無合併檔與 ZIP）。
   - 重現：以同一份 payload 併行跑 4 shards 可全數成功（9+9+9+8=35），確認是**偶發**（輸出目錄不存在／目標檔被短暫鎖住／Excel 實例狀態異常皆會回同一錯誤碼），非資料或模板問題。
   - 修正：`scripts/sli-eli-generate.py` 新增 `export_sheet_pdf()`（先刪殘檔 → 最多重試 3 次 → 驗證檔案存在且 > 0 byte）、單筆失敗改印 `FAIL: {MAWB} …` 後續跑（最後 exit 1）、Excel 清理僅在 PID 仍為 `EXCEL.EXE` 時 `taskkill`。
   - 修正：`scripts/xls-workflow.js` 的 `runPdfWorkers()` 改回傳 `{ outputs, failures }`（失敗 worker 保留 stdout、失敗 shard 自動再排一次），SLI/ELI 改以 **MAWB 配對**（原本用陣列索引，缺一筆就會讓後面全部錯位），`count` 改為「實際合併完成的 PDF 數」。
   - 驗證：python 單 shard 正常 9/9 + `DONE`（exit 0）；輸出目錄不存在時 9 筆都印 `RETRY`／`FAIL` 但 `PROGRESS` 仍走完 9/9（exit 1）；Node 端以真實 Excel COM 跑 5 筆 → count 5、1 個 ZIP、每個 `{MAWB}.pdf` 皆 2 頁（SLI+ELI）、合併後清除中間檔；模擬「shard 1 持續失敗」→ 其他 4 筆照常合併／打包，errors 明確指出 `369-10000001`；`scripts/test-xls-preview-formula.js` 26/26 通過。

1. **Shipper Role 上傳 OOM 修正**（`3c47aa5`）：使用者上傳 WPS 產出的 xlsx 後伺服器崩潰（`FATAL ERROR: ... JavaScript heap out of memory`），前端只看到「上傳失敗：Failed to fetch」。
   - 根因：該檔（僅 88KB）的 `_xlnm._FilterDatabase` = `配舱计划!$A$3:$XFB$1048462`（16384 欄 × 1048460 列 ≈ 171 億格）；ExcelJS 解析 defined name 時逐格展開（`DefinedNames.set model` → `CellMatrix.addCellEx`），瞬間吃爆約 4GB heap。實測縮到 571 萬格仍佔 ~500MB（記憶體 ∝ 範圍格數）；同檔以 SheetJS 讀取僅 ~18MB。
   - 修正：新增 `scripts/xls-exceljs-guard.js`（prototype patch，略過 > 1,000,000 格的 defined-name 範圍），並在 `routes/xls-booking.js` / `routes/xls-booking-helpers.js` / `scripts/xls-workflow.js` / `scripts/test-cnee-lookup.js` 載入（須早於 `require('exceljs')`）。
   - 驗證：同檔讀取 4GB+（OOM）→ 約 22MB；端對端 login → upload 200 → preview 200 → cnee-preview 200；`scripts/test-xls-preview-formula.js` 26/26 通過；SLI/ELI 模板 Print_Area（數百格）不受影響。

1. **Report / DB 快照同步**（`24fd653`；歷次 `540dda3`、`8ae904d`、`2fd2122`、`ed1617c`、`eb69bd3`、`d1bb695`、`24ef13e`、`7f4e45b`…）：`data/templates/shipper-role-summary-2026.xlsx` 的 202609 sheet 1793 → 2183 列（+390 筆新資料；其餘 6 個 sheet 列數／欄數完全不變，彙總列公式自動跟隨至新範圍；重存後 zip 內部結構改變故 bytes 670,181 → 559,322，已逐 sheet 比對確認資料無縮減）、`database.db` 與 `db/db-dump.sql` 例行變更（`users.last_login_at` 等）、`db/sessions.db` 本機 session 換新。
2. **Shipper Role ② 預覽公式格修正**（`305fa23`）：來源檔整欄是 `VLOOKUP` 外部連結公式時，② 預覽顯示 `[object Object]`（應顯示 Excel 快取結果，例：航班號 `TK0171`）。
   - 新增 `scripts/xls-utils.js` 的 `resolveCellValue()`（公式／富文字／超連結／錯誤值 → 實際值；無快取結果 → 空字串）與 `formatLocalDateTime()`（本地時區顯示，修掉 UTC+8 日期少一天的既有 bug）。
   - `routes/xls-booking-helpers.js` `sheetPreview()` 改用上述工具（API 回應不再含物件）。
   - 前端 `public/js/xls-booking-state.js` `xlsCellDisplay()` 同步解析複合物件（`xlsDateDisplay()` 本地日期）。
   - 新增 `scripts/test-xls-preview-formula.js`（26 項斷言：後端預覽／前端顯示函式／`resolveCellValue`／③ `standardizeRows`），並以實際來源檔驗證 AD2 → `TK0171`。
3. **文件分類整合**（`86db6d9`）：歷史規格 → `docs/archive/`、設計 → `docs/design/`、研究產物 → `docs/research/`、新增 `docs/README.md`；`README.md` 重寫；`CLAUDE.md` / `PROJECT_MAP.md` 補齊模組與 17 張表；`sync-project-state.js` 排除 `data/work`、`data/uploads`、`__pycache__`。
4. **側邊欄排序修復**（`549289c`）：`*.html` 頁面連結項目不再被後端過濾，排序能正確保存。
5. **打板計劃 + ULD 智能裝箱**（`8fdf148` 等）：`routes/pallet.js`、`routes/packing-{projects,solutions,solve,pdf}.js`、`bp3d/ga-lns/`、`public/uld-packing.html` + `public/js/uld-packing/*`（多 ULD 專案、拖拽、求解方案、PDF 匯出）。
6. **Shipper Role 模組化**（`1578210` 等）：`scripts/xls-workflow.js` 拆出 `xls-utils` / `xls-cnee` / `xls-report` / `xls-sli-eli`；前端 `public/js/xls-booking.js` 拆成 7 支（state / upload / preview / grid / assign / standard / workflow）；PDF 產生加入 worker pool 並行（`XLS_PDF_CONCURRENCY`，PRD 見 `docs/design/xls-pdf-parallel-prd.md`）。
7. **登入與權限**：Session 登入（`routes/auth/`）、角色 admin / staff / customer、客戶資料隔離、`users.html` 使用者管理、導航排序持久化。
8. **CNEE 對照區自動化**：`extractCneeLookupArea` + `matchCnee`（DEST / REMARK 加權）、缺 CNEE 與重覆 MAWB 警告清單。
9. **GuestBook（Forum）移除**：UI + API + 建表；舊 `messages` 表待清理（見待辦 REMARK）。
10. **通用工具抽取**：`public/js/utils/`（api / datetime / mawb / hawb / clipboard / modal / cbm / time-picker / autocomplete）與 `public/css/utils/`。
11. **訂單系統調整**：範本功能移除、HAWB# 改非必填、帶電項目累積新增、備註範本、訂單編號改 `AGL-`。

## 🔧 專案地圖機制（已建置）

| 檔案 | 用途 |
|------|------|
| `.clineignore` | AI 忽略清單（node_modules、圖片、db 檔等） |
| `CLAUDE.md` | AI 專案記憶檔，**新對話自動載入** |
| `PROJECT_MAP.md` | 詳細專案地圖（資料模型、API 總表） |
| `FILE_INVENTORY.md` | 自動產生的檔案清單 |
| `.project-state.json` | 結構快照（sync 引擎比對用） |
| `WORKSPACE_STATE.md` | 本檔案：工作狀態交接 |
| `docs/README.md` | 文件分類規則與索引（根目錄 vs docs/design|archive|research） |
| `scripts/sync-project-state.js` | 同步引擎：掃描 + 結構變更偵測（已排除 `data/work`、`data/uploads`） |
| `package.json` | `npm run sync` / `db:export` / `db:import` / `hooks:install` |

## 📋 下一步（待辦）

- [x] **P3 疊字產生器**：`scripts/sli-eli-overlay.js`（pdf-lib，背景＋10 欄位疊字）＋ `scripts/sli-eli-diff.py` ＋ `scripts/test-sli-eli-overlay.js`；每份 116.4KB、每筆 45–55ms、150dpi 差異 0.230%/0.329%
- [x] **P4 前置**：建置腳本內建 baseline 解析模型＋實測校準值（fieldmap v2 直接產出）＋「字符集匯出＋字型加寬」（`scripts/sli-eli-blank-widen-fonts.js`）；空白 122.3→114.0KB 且像素不變
- [x] **P4 接主流程**：`XLS_PDF_ENGINE=overlay|com`（未設定＝舊版，行為 100% 不變）、`engine.partition()` 分派＋失敗自動退回舊引擎（同批混合）、④ 執行產生最前面的「PDF 產生方式」選擇器、`/process` 白名單＋結果帶 `engine`／`fallbackCount`、結果面板顯示產生方式與退回筆數；實測 com 123.4KB／12.1s、overlay 116.0KB／1.1s、混合批次與全退回皆 PASS（`scripts/test-p4-engine.js`）
- [x] **P5 版面編輯器**：`public/sli-eli-layout.html`＋底圖拖曳／把手縮放／方向鍵／吸附／Undo-Redo／對齊／屬性面板＋`/api/xls-booking/layout`（GET/PUT/reset/preview/backups/background，寫入需 admin/staff）＋側欄新項目置頂（`NAV_PAGE_RE` 已允許 `*.html`）；驗收 `scripts/test-sli-eli-layout.js` 全 PASS（測試 PDF 116.1 KB）
- [x] **字元處理（第 0/1/2 層）**：`scripts/pdf-charset.js`（淨化＋WinAnsi 放寬，與官方表逐筆核對）＋`scripts/pdf-cjk-font.js`（`@pdf-lib/fontkit` 按需子集、`.ttc` 取單一字型、解析快取）；`PDF_CJK=auto|off`、`SLI_ELI_CJK_FONT`；實測 CJK 份 **119.4 KB／74 ms**、diff 0.244%/0.396%（Excel 退回版 131.3 KB／~4 s）；`–` 的 122 筆不再退回；驗收 `scripts/test-sli-eli-charset.js` **PASS**
- [ ] **待重建背景（建議）**：`python scripts/build-sli-eli-blank.py --keep-work --force` —— 讓 27 個 WinAnsi 特殊字併進內嵌 Arial 子集（字形與 Excel 完全相同）。不重建也能正確輸出（走標準字型），且重建後需重跑 `node scripts/test-sli-eli-overlay.js` 與 `python data/test-p2/verify-build.py`
- [ ] **可選（非需求）**：① 若要 <120KB → 簡化 `cainiao-sli-eli-template.xlsx`（目前地板＝內容流 49.9KB＋PDF 結構 16KB）；② 讓內嵌 Arial 全字符集 100% 生效（順序調整，+35KB/份）；③ 為 CJK 準備「粗體專用字型」`SLI_ELI_CJK_BOLD_FONT`（Excel 的粗體格用 MicrosoftJhengHeiBold，目前粗體格也用同一支 regular CJK）
- [ ] 確認地圖機制運作：開新 chat，驗證 AI 會自動讀 `CLAUDE.md` + 執行 `npm run sync`
- [ ] **REMARK：本機 log 清理** —— `server.err.log` / `server.out.log` 被執行中的服務鎖住無法刪除；停掉服務後執行 `Remove-Item server.*.log`（已在 `.gitignore`，不影響版控）
- [ ] **REMARK：template 備份管理** —— `data/templates/cainiao-sli-eli-template (BAK).xlsx` 目前僅存本機（已加入 `.gitignore`）；如需進版控請用 `git add -f`
- [ ] **REMARK：GuestBook（messages）殘留清理** —— 已移除 forum UI/API/建表，但舊 `messages` 表仍在 `database.db`（SQLite 不會自動刪）；`routes/dbviewer.js` 與 `public/js/dbviewer.js` 仍引用 `messages`。日後處理：① 加 `DROP TABLE IF EXISTS messages` ② 移除 dbviewer 的 `ALLOWED_TABLES` / 標籤引用
- [ ] **REMARK：`sqlite_sequence` 重複列累積** —— 本機 `database.db` 的 `sqlite_sequence` 已有 178 列（正常應為 17 列＝每個 AUTOINCREMENT 表 1 列）。原因：`scripts/db-import.js` 先刪庫重建，之後又執行 dump 內歷史的 `INSERT INTO "sqlite_sequence"`。日後處理擇一：① `scripts/db-export.js` 匯出時依 `name` 去重（保留最大 `seq`）② `scripts/db-import.js` 執行該區塊前先 `DELETE FROM sqlite_sequence`
- [ ] 日後每次結構性變更後執行 `npm run sync`，並同步更新本檔

## ⚠️ 專案注意事項速查

- 使用 sqlite3 callback 風格（非 async/await）
- 前端無框架、無 build step，改完直接 refresh
- 訂單編號前綴 `ORDER_NO_PREFIX` 在 `routes/orders/utils.js`（目前 `AGL-`）
- 電力分類代碼：乾電 A67/A123/A199、鋰電 ELI/ELM（存於 `power_items`）
- 文件只放兩處：根目錄（現役導航）與 `docs/`（design / archive / research）——判準見 `docs/README.md`
- 完整細節見 `CLAUDE.md` 與 `PROJECT_MAP.md`
