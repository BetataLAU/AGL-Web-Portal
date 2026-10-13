# WORKSPACE_STATE — 工作狀態交接檔

> 供 AI Agent 每次新對話快速接上進度，由開發者／AI 在完成任務後更新。
> 編寫原則：只保留**最後 commit、近期里程碑（每項一行）、待辦 REMARK**；逐 commit 的同步細節請看 `git log`。

## 📌 目前狀態

- **最後 commit**：`708fa1f` chore(sync): 同步 20261010 shipper report、DB 與 sessions 快照
- **目前分支**：main（github.com/BetataLAU/AGL-Web-Portal）
- **工作目錄狀態（尚未提交，含兩批工作）**：
  - **(A) 使用者先前 WIP**：SLI/ELI 批次產生失敗（Excel `Document not saved`）容錯強化 → `scripts/sli-eli-generate.py`、`scripts/xls-workflow.js`、`docs/design/xls-pdf-parallel-prd.md`
  - **(B) 本次 P1/P2**：A4 修正、PDF 字型瘦身、疊字背景＋fieldmap → 新增 `scripts/{sli-eli-font-optimize.py,build-sli-eli-blank.py,test-pdf-a4.js,test-a4-integration.js}`、`data/templates/sli-eli-blank*`、`data/templates/sli-eli-fieldmap*.json`、`data/templates/sli-eli-blank-meta.json`；修改 `scripts/xls-sli-eli.js`、`scripts/sli-eli-generate.py`、`routes/xls-booking.js`、`public/js/xls-booking-workflow.js`、`public/css/xls-booking.css`、`Dockerfile`、`CLAUDE.md`、`README.md`
  - 例行變更：`data/templates/shipper-role-summary-2026.xlsx`、`database.db`、`db/sessions.db`
- **交接文件（新對話請先讀）**：`docs/design/xls-sli-eli-overlay-prd.md`（P1/P2 已完成＋實測數據、P3～P5 待辦設計、可執行驗證指令、10 個已踩過的陷阱、新對話提示詞）

## ✅ 近期里程碑（由新到舊；細節見 `git log`）

0. **Shipper Role：A4 修正 + PDF 字型瘦身 + 疊字背景（本次 P1/P2，尚未提交）**：使用者需求＝加快 PDF 產生、把檔案從 ~500KB 降到 30–80KB，追加＝輸出改 A4、保留舊功能、新功能放最頂、提供版面編輯器。
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

- [ ] **P3 疊字產生器**：`scripts/sli-eli-overlay.js`（pdf-lib，背景＋10 欄位疊字；每份 ~125KB、每筆 5–20ms）＋與 Excel 版 150dpi 逐像素比對的驗證腳本
- [ ] **P4 接主流程**：`XLS_PDF_ENGINE=overlay|com`（未設定＝舊版）、失敗自動退回舊引擎、④ 執行產生的引擎選擇器放最前面、側邊欄新項目置頂、結果面板顯示工程
- [ ] **P5 版面編輯器**：`public/sli-eli-layout.html`＋底圖拖曳編輯＋`/api/xls-booking/layout`（GET/PUT/reset/preview，寫入需 admin/staff）
- [ ] **可選（若要 <120KB）**：簡化 `cainiao-sli-eli-template.xlsx`（減少字型家族與繪圖物件）；目前 123KB 的地板來自內容流 49.9KB＋PDF 結構 16KB
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
