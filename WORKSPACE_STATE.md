# WORKSPACE_STATE — 工作狀態交接檔

> 供 AI Agent 每次新對話快速接上進度。
> 由開發者／AI 在完成每次任務後更新（特別是最後一個 commit 之後）。

## 📌 目前狀態

- **最後 commit**：`83d98da` 訂單系統調整 + 通用工具抽取 + 電力分類自動補全
- **目前分支**：main（github.com/BetataLAU/AGL-Web-Portal）
- **工作目錄狀態**：有未 commit 的變更（GuestBook 移除 + CNEE 對照區自動化，見下）

## ✅ 已完成（最近）

以 **最新 commit 為準**，開發脈絡（由新到舊）：

1. **Shipper Role PDF 並行化與資源清理**（工作目錄未 commit）：`scripts/xls-workflow.js` 以 `XLS_PDF_CONCURRENCY` 控制 1–4 個 Python/Excel worker，`scripts/sli-eli-generate.py` 支援 shard 與獨立 LibreOffice profile；PDF 合併也採有限並行。預設 2，設為 1 可回退序列流程。`POST /api/xls-booking/cleanup` 可由 admin/staff 清理過期 job、report、uploads，中間 XLSX 於合併後自動移除。
1. **Shipper Role Project 程式碼拆分重構**（對照 Global Rule `.clinerule.md` 檔案大小限制）：
   - `routes/xls-booking.js`（321→281 行）：路徑/Multer/session 儲存/讀檔工具拆至 `routes/xls-booking-helpers.js`；新增 multer 錯誤轉 JSON；`/download/report` 改為從 job 結果解析路徑（擋掉路徑穿越）
   - `scripts/xls-workflow.js`（837→483 行）：拆出 `xls-utils.js` / `xls-cnee.js` / `xls-report.js` / `xls-sli-eli.js`；`xls-workflow.js` 保留主流程並 re-export 全部歷史 API（`require` 相容）
   - `public/js/xls-booking.js`（1066→刪除）：拆為 7 個全域 script（state/upload/preview/grid/assign/standard/workflow），`index.html` 依序載入，inline onclick 不受影響
   - 驗證：node --check 全過、HTTP 端對端冒煙測試（上傳/預覽/CNEE/process 產出 2 份 PDF + ZIP + report 下載）、路徑穿越回 404
2. **Shipper Role Project：CNEE 對照區自動化**（`scripts/xls-workflow.js` / `routes/xls-booking.js` / `public/js/xls-booking.js` / `public/css/xls-booking.css`）：
   - `extractCneeLookupArea`：自動掃 sheet 的 A/B/C 欄（A=區塊 key、B=`CNEE:`、C=值＋續行）建立對照表
   - `matchCnee`：DEST + REMARK 加權比對（含 `DEST_COUNTRY_KEYWORDS` 國家關鍵字）；REMARK 空白取純 DEST 預設區塊
   - `standardizeRows` 支援 `cneeLookup.auto` + `cneeOverrides`（手動補值優先）；舊手動模式保留相容
   - `runWorkflow` 收集缺 CNEE 警告清單（不阻斷，SLI/ELI 留空）
   - 新 API `POST /api/xls-booking/cnee-preview`；`/process` 結果帶 `warnings` 與 `workDir`
   - ③ 標準化預覽新增 CNEE 欄（缺漏 🔴，點擊行內補值）；② 預覽空格單擊編輯
   - 測試：`scripts/test-cnee-lookup.js`（單元 + 端對端，全部通過）
2. **GuestBook 移除**：Forum 功能整個移除（UI + API + 前端 JS + server 路由 + messages 建表）；REMARK：舊 messages 表與 dbviewer 引用留待日後清理
3. **通用工具抽取**：從 `orders.js` 抽出 7 個可重用工具到 `public/js/utils/`（api / datetime / mawb / modal / cbm-calculator / time-picker / autocomplete），CSS 對應搬至 `public/css/utils/`，`index.html` 已在 orders.js 之前引入
4. **訂單系統調整**：範本功能移除（UI + API，資料庫 templates 表保留）、收貨/送貨按鈕對調、HAWB# 改非必填、第 8️⃣ 區塊改為只有備註（運輸公司選擇移除）、帶電項目主類別/代碼改自動補全
4. 提貨時間選擇器：自訂 ±15 分鐘跨小時進位、CLOCK 彈出 00/15/30/45、stopPropagation 修正
5. 訂單系統重大更新：6 項新功能 + 後端重構 + 多類別支援
6. MAWB# 驗證／後補、重複檢查、AGL 流水號
7. 電力分類改為累積新增模式（可混合無電/乾電/鋰電，各自輸入件數）
8. 資料庫檢視器新增（白名單保護、外鍵下拉、刪除關聯保護）

## 🔧 已建立的地圖機制（未 commit）

本輪新增的 AI 專案地圖系統（尚未 commit，作為工作目錄變更）：

| 檔案 | 用途 |
|------|------|
| `.clineignore` | AI 忽略清單（node_modules、圖片、db 檔等） |
| `CLAUDE.md` | AI 專案記憶檔，**新對話自動載入** |
| `PROJECT_MAP.md` | 詳細專案地圖（資料模型、API 總表） |
| `FILE_INVENTORY.md` | 自動產生的檔案清單 |
| `.project-state.json` | 結構快照（sync 引擎比對用） |
| `WORKSPACE_STATE.md` | 本檔案：工作狀態交接 |
| `scripts/sync-project-state.js` | 同步引擎：掃描 + 結構變更偵測 |
| `package.json` | 新增 `npm run sync` |

## 📋 下一步（待辦）

- [ ] 確認地圖機制運作：開新 chat，驗證 AI 會自動讀 CLAUDE.md + 執行 sync
- [ ] commit 本輪工作（訂單系統調整 + 通用工具抽取 + GuestBook 移除）
- [ ] **REMARK：GuestBook（messages）殘留清理** —— 已移除 forum UI/API/建表，但舊 `messages` 表仍在 database.db（SQLite 不會自動刪）；`routes/dbviewer.js` 與 `public/js/dbviewer.js` 仍引用 `messages`（資料庫檢視器會看到舊表）。日後處理：① 加 `DROP TABLE IF EXISTS messages` ② 移除 dbviewer 的 `ALLOWED_TABLES` / 標籤引用
- [ ] 日後每次結構性變更後執行 `npm run sync`，並同步更新本檔

## ⚠️ 專案注意事項速查

- 使用 sqlite3 callback 風格（非 async/await）
- 前端無框架、無 build step，改完直接 refresh
- 訂單編號前綴 `ORDER_NO_PREFIX` 在 `routes/orders/utils.js`（目前 `AGL-`）
- 電力分類代碼：乾電 A67/A123/A199、鋰電 ELI/ELM（儲存於 `power_items`）
- 完整細節見 `CLAUDE.md` 與 `PROJECT_MAP.md`