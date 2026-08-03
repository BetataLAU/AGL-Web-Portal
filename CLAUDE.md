# AGL-Web-Portal — AI 專案記憶檔

> 本檔案供 AI Agent 在每次新對話自動載入，避免重讀整個專案。
> 修改專案結構時請同步更新本檔案、`PROJECT_MAP.md`、`FILE_INVENTORY.md` 與 `WORKSPACE_STATE.md`。

## 🚀 新對話自動開機流程（必讀，強制執行）

> 每次新對話開始，**第一步就執行以下流程**，確保站在同一條跑線上。完成後才處理用戶問題。

1. **執行 `npm run sync`**
   - 自動更新檔案清單 + 偵測結構變更（新增/修改/刪除檔案）
   - 若輸出顯示有結構變更，先閱讀本檔案與 `PROJECT_MAP.md` 是否有對應內容，有需要就更新
2. **讀取 `WORKSPACE_STATE.md`**
   - 了解最後 commit、最近完成事項、待辦清單
3. **查詢 git 狀態**（若上一步輸出的 Git 變更狀態不清/不存在）：
   ```bash
   git status --short
   git --no-pager log --oneline -5
   ```
4. 對照 `WORKSPACE_STATE.md` 的待辦清單，確認用戶任務是哪一項（或新任務），再開始工作

## 🤖 同步與維護機制

### 結構變更自動偵測（半自動）

本檔案本身**不會自動更新**，靠以下機制保持新鮮：

1. **每次新對話開頭**：執行 `npm run sync`（見上方自動開機流程）
2. **任務中發生結構性變更時**：完成任務後**必須執行 `npm run sync`**，並同步更新本檔案、`PROJECT_MAP.md` 與 `WORKSPACE_STATE.md`
3. **執行 `npm run sync`**：掃描專案 → 取得最新結構變更 → 更新 `FILE_INVENTORY.md` → 保存 `.project-state.json` 快照

### 同步引擎（scripts/sync-project-state.js）

| 產物 | 說明 |
|------|------|
| `FILE_INVENTORY.md` | 自動產生的檔案清單（含大小、Git 變更狀態） |
| `.project-state.json` | 結構快照（hash 比對用，勿手動編輯） |
| 控制台輸出 | 列出 自上次同步以來 新增/修改/刪除 的檔案，提醒更新職責描述 |

### 結構性變更觸發表

| 觸發事件 | 例子 |
|----------|------|
| 新增/刪除/改名檔案 | 新增 `routes/xxx.js`、移動 `public/js/...` |
| 新增/移除 API 路由 | `server.js` 或任一 router 掛載新路徑 |
| 資料表變更 | `db/database.js` 新增/修改 `CREATE TABLE` |
| 依賴變更 | `package.json` 新增套件 |
| 核心邏輯變更 | `ORDER_NO_PREFIX` 改動、狀態值/電力分類代碼新增 |

---

## 專案概覽

個人全棧介紹網站（gemini-intro-site），含「訂單系統」子專案。

- **技術棧**：Node.js + Express 4 + SQLite3，前端純 Vanilla JS + HTML + CSS（無框架、無 build step）
- **啟動**：`npm start`（node server.js）；PORT 被佔用會自動 +1；資料庫首次啟動自動建檔建表
- **資料庫檔案**：根目錄 `database.db`（程式自動維護，勿直接編輯）

## 目錄地圖（摘要）

| 路徑 | 職責 |
|------|------|
| `server.js` | Express 入口，掛載全部 API 路由 |
| `db/database.js` | SQLite 建表（含 orders 相容欄位自動補齊）、skills seed |
| `routes/` | 後端 API 模組（見下方分節） |
| `public/index.html` | 單一頁面 + Sidebar 導航 |
| `public/css/` | base / layout / components / animations / orders / dbviewer |
| `public/js/` | theme / animations / skills / contours / forum / chat / orders / main / dbviewer |
| `ORDER_SYSTEM_PLAN.md` | 訂單系統設計紀錄（欄位邏輯、電力分類等） |
| `README.md` | 專案說明與 API 清單 |
| `PROJECT_MAP.md` | 詳細專案地圖（資料模型、API 總表） |
| `FILE_INVENTORY.md` | 自動產生的檔案清單（執行 `npm run sync` 更新） |

## API 路由掛載（server.js）

| 路徑前綴 | 模組 | 說明 |
|----------|------|------|
| `/api/skills` | `routes/skills.js` | 技能 API |
| `/api/contours` | `routes/contours.js` | Contour 影像 |
| `/api/contour-image` | `routes/contours.js` | 舊路徑的 Contour 影像 |
| `/api/threads` | `routes/forum.js` | 論壇主題 |
| `/api/messages` | `routes/forum.js` | 留言/回覆 + SSE 推播（`/stream`） |
| `/api/orders` | `routes/orders/index.js` | 訂單系統（見下） |
| `/api/db` | `routes/dbviewer.js` | 資料庫檢視器（白名單保護） |

## 訂單系統（routes/orders/）

入口 `index.js` 掛載三個子路由，並執行一次性的 ORD- → AGL- 訂單編號遷移。

| 檔名 | 職責 |
|------|------|
| `index.js` | Router 入口 + 訂單編號遷移 |
| `orders-router.js` | 訂單 CRUD、搜尋（編號/公司/提單號）、狀態篩選、`/check-duplicate` |
| `companies.js` | 公司/地點 CRUD（客戶/倉庫/運輸公司），`normalizeCategory` |
| `templates.js` | 訂單範本 CRUD（按公司分類，一鍵載入） |
| `utils.js` | MAWB 正規化/驗證、`generateOrderNo`、`serializeOrder`、`ORDER_SELECT_SQL` 共用查詢 |

**訂單資料模型重點**：`orders` 表有 `power_type`（no/dry/lithium 電力分類）、`urgent`（趕機）、`status`（pending/progress/done/cancelled）；公司以 `company_id` 關聯。

**前端對應**：`public/js/orders.js`（邏輯）、`public/css/orders.css`（手機優先樣式）

## 資料表（db/database.js）

| 表 | 用途 |
|----|------|
| `skills` | 技能展示（自動 seed） |
| `messages` | 論壇/留言（`parent_id` 支援回覆） |
| `companies` | 訂單系統：公司/地點（客戶、倉庫、運輸公司） |
| `templates` | 訂單系統：範本 |
| `orders` | 訂單主表（含電郵總結所需欄位） |

## 常見任務指引

- **改訂單功能**：後端改 `routes/orders/`，前端改 `public/js/orders.js` + `public/css/orders.css`
- **改網站內容**：`public/index.html`
- **改主題**：`public/css/base.css`（主題變數）+ `public/js/theme.js`
- **新增資料表**：`db/database.js` 加 `CREATE TABLE`，並在 `routes/` 建對應路由模組，`server.js` 掛載
- **前端無框架**：所有前端 JS 直接在 `public/js/` 用全域函式開發

## 注意事項

- 使用 sqlite3 套件的 callback 風格（非 async/await）
- 不要直接編輯 `database.db`
- 修改 `routes/orders/utils.js` 的 `ORDER_NO_PREFIX` 會影響訂單編號產生