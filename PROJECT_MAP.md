# AGL-Web-Portal — 專案地圖（詳細版）

> 用途：供 AI Agent 快速定位功能位置，避免探索整個專案。
> 配合 `CLAUDE.md` 使用：新任務先看 CLAUDE.md 摘要，需要細節再查本檔案。
> 修改專案時請同步更新本檔案。

---

## 1. 檔案總覽

### 根目錄

| 檔案 | 說明 |
|------|------|
| `server.js` | Express 入口：靜態服務、JSON body、掛載 7 組 API 路由；Port 被佔用自動 +1 |
| `package.json` | 名稱 gemini-intro-site；依賴僅 express ^4.18.2、sqlite3 ^5.1.6 |
| `database.db` | SQLite 資料庫（自動建立，勿手動編輯） |
| `ORDER_SYSTEM_PLAN.md` | 訂單系統設計紀錄：欄位規格、電力分類、訂單類型邏輯、電郵總結格式 |
| `README.md` | 專案說明、API 清單、常見問題 |
| `CLAUDE.md` | AI 專案記憶檔（新對話自動載入，含自動開機流程） |
| `PROJECT_MAP.md` | 本檔案：詳細專案地圖 |
| `WORKSPACE_STATE.md` | 工作狀態交接檔（最後 commit、待辦清單） |
| `FILE_INVENTORY.md` | 自動產生的檔案清單（執行 `npm run sync` 更新） |
| `.project-state.json` | 結構快照（sync 引擎比對用，勿手動編輯） |
| `.clineignore` | AI 忽略清單（node_modules、圖片、db 檔等） |
| `scripts/sync-project-state.js` | 同步引擎：掃描專案、偵測結構變更、更新 FILE_INVENTORY |

### 後端 `routes/`

| 檔案 | 說明 |
|------|------|
| `skills.js` | 技能 API（GET /api/skills） |
| `contours.js` | Contour 影像：匯出 `contoursRouter`（/api/contours）與 `contourImageRouter`（/api/contour-image） |
| `forum.js` | 論壇/留言：主題列表、回覆、CRUD、SSE 推播（`broadcastMessagesChange`） |
| `dbviewer.js` | 資料庫檢視器：`isAllowedTable` 白名單保護；含 `doDelete` 刪除邏輯 |
| `orders/index.js` | 訂單 Router 入口 + ORD- → AGL- 編號一次性遷移 |
| `orders/orders-router.js` | 訂單 CRUD（233 行） |
| `orders/companies.js` | 公司/地點 CRUD，`normalizeCategory` |
| `orders/templates.js` | 訂單範本 CRUD |
| `orders/utils.js` | MAWB 工具、`generateOrderNo`、`serializeOrder`、`ORDER_SELECT_SQL` |

### 前端 `public/`

| 檔案 | 說明 |
|------|------|
| `index.html` | 單一頁面結構 + Sidebar 導航 |
| `css/base.css` | 主題變數（Light/Dark/Ocean）與全域樣式 |
| `css/layout.css` | 版面與響應式 |
| `css/components.css` | 共用元件 |
| `css/animations.css` | 動畫 |
| `css/orders.css` | 訂單系統樣式（手機優先） |
| `css/dbviewer.css` | 資料庫檢視器樣式 |
| `js/theme.js` | 主題切換 + Ocean 自訂色盤 |
| `js/animations.js` | 動畫效果 |
| `js/skills.js` | 技能頁邏輯 |
| `js/contours.js` | Contour 頁邏輯 |
| `js/forum.js` | 論壇頁邏輯（含 SSE EventSource） |
| `js/chat.js` | AI Playground 邏輯 |
| `js/orders.js` | 訂單系統邏輯（前端主軸） |
| `js/dbviewer.js` | 資料庫檢視器邏輯（19.6 KB） |
| `js/main.js` | 共用工具與初始化 |

---

## 2. 訂單系統詳解

### 資料模型

**companies 表**（公司/地點）
```
id, category ('customer'|'warehouse'|'transport' 等), name, address,
contact_person, phone, email, notes, created_at
```

**templates 表**（範本，按公司分類）
```
id, name, company_id, cargo_desc, quantity, weight_kg, cbm,
power_type ('no'|'dry'|'lithium'), receiver_name, receiver_phone, notes, created_at
```

**orders 表**（訂單主表）
```
id, order_no, order_type, mawb, hawb, pickup_no,
pickup_company_id, delivery_company_id,   -- 公司關聯
cargo_desc, quantity, weight_kg, cbm,
power_type ('no'|'dry'|'lithium'), power_code (A67/A123/A199/ELI/ELM), power_items,
urgent ('no'|'yes'), receiver_name, receiver_phone, address, notes,
transport_company, status ('pending'|'progress'|'done'|'cancelled'),
created_at, updated_at
```
相容欄位（自動補齊）：`power_items`、`pickup_datetime`、`receiver_note`、`contact_note`

### 訂單編號格式
- 前綴：`ORDER_NO_PREFIX`（在 `utils.js`，目前為 `AGL-`）
- 格式：`AGL-YYYYMMDD-XXX`（`generateOrderNo` 產生）
- 啟動時會把舊 `ORD-` 開頭編號一次性遷移為 `AGL-`

### 電力分類（航空貨運）
| 選擇 | 代碼 |
|------|------|
| 無電 no | - |
| 乾電 dry | A67 / A123 / A199 |
| 鋰電 lithium | ELI / ELM |

### API Endpoint 總表

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/orders` | 訂單列表（`?search=` 訂單編號/公司名/提單號、`?status=`） |
| GET | `/api/orders/check-duplicate` | 重複檢查（`?mawb=&hawb=&pickup_no=&exclude_id=`） |
| GET | `/api/orders/:id` | 訂單詳情 |
| POST | `/api/orders` | 建立訂單 |
| PUT | `/api/orders/:id` | 更新訂單 |
| DELETE | `/api/orders/:id` | 刪除訂單 |
| GET | `/api/orders/companies` | 公司清單（`?search=&category=`） |
| POST | `/api/orders/companies` | 新增公司 |
| GET | `/api/orders/templates` | 範本清單（`?company_id=`） |
| POST | `/api/orders/templates` | 新增範本 |
| DELETE | `/api/orders/templates/:id` | 刪除範本 |

### 電郵總結（`mailto:` 免設定）
- 自動填收件人（運輸公司 email）、主旨、總結內容
- 支援 `複製總結內容` 用 WhatsApp 等發送
- 格式範例見 `ORDER_SYSTEM_PLAN.md` / `README.md`

---

## 3. 其他後端模組

### forum.js（論壇）
| Endpoint | 說明 |
|----------|------|
| GET `/api/threads` | 主題列表 |
| GET `/api/threads/:id` | 主題 + 回覆 |
| POST `/api/messages` | 新增主題/回覆（`parent_id` 區分） |
| PUT `/api/messages/:id` | 修改留言 |
| DELETE `/api/messages/:id` | 刪除留言 |
| GET `/api/messages/stream` | SSE 即時推播 |

### dbviewer.js（資料庫檢視器）
- `isAllowedTable(name)`：白名單檢查，防止存取非預期表格
- 支援欄位列出、編輯欄位、刪除（`doDelete`）

---

## 4. 前端重點

### 訂單前端流程（public/js/orders.js）
1. 表單分步驟（Mobile 優先），大按鈕選擇訂單類型 🚚/📥
2. 公司選取後自動帶出地址/聯絡人/電話（可修改）
3. 電力分類三選一 + 代碼下拉
4. 列表卡片式顯示、搜尋、狀態篩選、狀態顏色標籤
5. 詳情展開、編輯、複製、刪除、狀態變更
6. 電郵總結（mailto:）與複製總結

### 主題系統
- base.css 定義 CSS 變數，`theme.js` 切換 `data-theme`（light/dark/ocean）
- Ocean 支援色盤自訂主題色

---

## 5. 開發注意事項

- **Callback 風格**：sqlite3 套件用 callback，不要改寫成 async/await
- **無 build step**：前端改完直接 refresh 即可，無需 compile
- **Port 自動 +1**：3000 被佔用會嘗試 3001、3002…
- **中文字串**：全專案以繁體中文為主要 UI 文字
- **路由掛載順序**：Express 依序匹配，`/api/orders/check-duplicate` 必須在 `/:id` 之前（目前 arrange 正確）
- **搜尋上限**：訂單列表 SQL `LIMIT 100`