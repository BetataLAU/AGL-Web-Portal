# WORKSPACE_STATE — 工作狀態交接檔

> 供 AI Agent 每次新對話快速接上進度，由開發者／AI 在完成任務後更新。
> 編寫原則：只保留**最後 commit、近期里程碑（每項一行）、待辦 REMARK**；逐 commit 的同步細節請看 `git log`。

## 📌 目前狀態

- **最後 commit**：`86db6d9` docs: 文件分類整合（docs/design|archive|research）並更新現況文件
- **目前分支**：main（github.com/BetataLAU/AGL-Web-Portal）
- **工作目錄狀態**：乾淨（未進版控的本機產出由 `.gitignore` 忽略：`data/work/`、`data/uploads/`、`data/templates/* (BAK).xlsx`、`database.db`、`db/sessions.db`、`docs/research/*-latest.txt`）

## ✅ 近期里程碑（由新到舊；細節見 `git log`）

1. **Shipper Role ② 預覽公式格修正（本輪）**：來源檔整欄是 `VLOOKUP` 外部連結公式時，② 預覽顯示 `[object Object]`（應顯示 Excel 快取結果，例：航班號 `TK0171`）。
   - 新增 `scripts/xls-utils.js` 的 `resolveCellValue()`（公式／富文字／超連結／錯誤值 → 實際值；無快取結果 → 空字串）與 `formatLocalDateTime()`（本地時區顯示，修掉 UTC+8 日期少一天的既有 bug）。
   - `routes/xls-booking-helpers.js` `sheetPreview()` 改用上述工具（API 回應不再含物件）。
   - 前端 `public/js/xls-booking-state.js` `xlsCellDisplay()` 同步解析複合物件（`xlsDateDisplay()` 本地日期）。
   - 新增 `scripts/test-xls-preview-formula.js`（26 項斷言：後端預覽／前端顯示函式／`resolveCellValue`／③ `standardizeRows`），並以實際來源檔驗證 AD2 → `TK0171`。
2. **文件分類整合**（`86db6d9`）：歷史規格 → `docs/archive/`、設計 → `docs/design/`、研究產物 → `docs/research/`、新增 `docs/README.md`；`README.md` 重寫；`CLAUDE.md` / `PROJECT_MAP.md` 補齊模組與 17 張表；`sync-project-state.js` 排除 `data/work`、`data/uploads`、`__pycache__`。
2. **側邊欄排序修復**（`549289c`）：`*.html` 頁面連結項目不再被後端過濾，排序能正確保存。
3. **資料庫 / Report 快照同步**（`540dda3`、`8ae904d`、`2fd2122`、`ed1617c`、`eb69bd3`、`d1bb695`、`24ef13e`、`7f4e45b`…）：`data/templates/shipper-role-summary-2026.xlsx` 的 202609 sheet 逐次累加（1411 → 1792 列）、`database.db` / `db-dump.sql` 差異主要是 `users.last_login_at`、`db/sessions.db` 本機 session 換新。
4. **打板計劃 + ULD 智能裝箱**（`8fdf148` 等）：`routes/pallet.js`、`routes/packing-{projects,solutions,solve,pdf}.js`、`bp3d/ga-lns/`、`public/uld-packing.html` + `public/js/uld-packing/*`（多 ULD 專案、拖拽、求解方案、PDF 匯出）。
5. **Shipper Role 模組化**（`1578210` 等）：`scripts/xls-workflow.js` 拆出 `xls-utils` / `xls-cnee` / `xls-report` / `xls-sli-eli`；前端 `public/js/xls-booking.js` 拆成 7 支（state / upload / preview / grid / assign / standard / workflow）；PDF 產生加入 worker pool 並行（`XLS_PDF_CONCURRENCY`，PRD 見 `docs/design/xls-pdf-parallel-prd.md`）。
6. **登入與權限**：Session 登入（`routes/auth/`）、角色 admin / staff / customer、客戶資料隔離、`users.html` 使用者管理、導航排序持久化。
7. **CNEE 對照區自動化**：`extractCneeLookupArea` + `matchCnee`（DEST / REMARK 加權）、缺 CNEE 與重覆 MAWB 警告清單。
8. **GuestBook（Forum）移除**：UI + API + 建表；舊 `messages` 表待清理（見待辦 REMARK）。
9. **通用工具抽取**：`public/js/utils/`（api / datetime / mawb / hawb / clipboard / modal / cbm / time-picker / autocomplete）與 `public/css/utils/`。
10. **訂單系統調整**：範本功能移除、HAWB# 改非必填、帶電項目累積新增、備註範本、訂單編號改 `AGL-`。

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
