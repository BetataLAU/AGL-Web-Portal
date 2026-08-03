# WORKSPACE_STATE — 工作狀態交接檔

> 供 AI Agent 每次新對話快速接上進度。
> 由開發者／AI 在完成每次任務後更新（特別是最後一個 commit 之後）。

## 📌 目前狀態

- **最後 commit**：`83d98da` 訂單系統調整 + 通用工具抽取 + 電力分類自動補全
- **目前分支**：main（github.com/BetataLAU/AGL-Web-Portal）
- **工作目錄狀態**：有未 commit 的變更（GuestBook 移除，見下）

## ✅ 已完成（最近）

以 **最新 commit 為準**，開發脈絡（由新到舊）：

1. **GuestBook 移除**：Forum 功能整個移除（UI + API + 前端 JS + server 路由 + messages 建表）；REMARK：舊 messages 表與 dbviewer 引用留待日後清理
2. **通用工具抽取**：從 `orders.js` 抽出 7 個可重用工具到 `public/js/utils/`（api / datetime / mawb / modal / cbm-calculator / time-picker / autocomplete），CSS 對應搬至 `public/css/utils/`，`index.html` 已在 orders.js 之前引入
3. **訂單系統調整**：範本功能移除（UI + API，資料庫 templates 表保留）、收貨/送貨按鈕對調、HAWB# 改非必填、第 8️⃣ 區塊改為只有備註（運輸公司選擇移除）、帶電項目主類別/代碼改自動補全
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