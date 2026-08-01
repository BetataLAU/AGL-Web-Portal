# Gemini 全棧介紹網站 (Full-Stack Intro Site)

這是一個以 Node.js + Express + SQLite 建立的簡單全棧展示網站，包含前端頁面、後端 API 與資料庫儲存功能。

## 這個網站目前包含什麼

- 前端展示頁：首頁、AI Playground、Capabilities、Contour、Forum、訂單系統
- 後端 API：取得技能、留言列表、新增/修改/刪除留言、Contour 影像、訂單系統 API
- SQLite 資料庫：儲存留言、技能、公司/地點、範本與訂單資料
- 主題切換：Light / Dark / Ocean，並支援 Ocean 主題自訂色盤
- 匯出功能：可匯出 CSV / XLSX
- 彈窗操作：匯出視窗支援 ESC 關閉

## 📦 訂單系統（收/送貨落 ORDER）

手機優先的「收貨/送貨」訂單管理系統，整合在網站左側 Sidebar 的「📦 訂單系統」入口。

### 功能特色

| 功能 | 說明 |
|------|------|
| 🚚 / 📥 訂單類型 | 送貨（取貨→送到客戶）／收貨（客戶收貨→交回/轉交）大按鈕選擇 |
| 提單資訊 | MAWB# / HAWB# / 客戶提貨號 |
| 公司資料庫 | 客戶公司、倉庫/自家地點、運輸公司統一存入 SQLite，自動帶出地址/聯絡人/電話（可修改） |
| 電力分類 | ⚡ 無電 / 🔋 乾電 (A67/A123/A199) / 🔋 鋰電 (ELI/ELM) 三選一，強制標示 |
| 🚨 趕機 | 🔴 趕機 / ⚪ 普通 大按鈕 |
| 範本系統 | 按公司分類管理範本，新建訂單時一鍵載入 |
| 訂單列表 | 卡片式列表、搜尋（訂單編號/公司名/提單號）、狀態篩選、狀態顏色標籤 |
| 訂單操作 | 詳情展開、編輯、複製此訂單、刪除、狀態變更 |
| 📧 電郵總結 | `mailto:` 零設定，自動填收件人（運輸公司 email）、主旨、完整總結內容；另可「複製總結內容」用 WhatsApp 等發送 |
| 手機優先 | 大按鈕（≥48px）、響應式 Sidebar、分步驟表單 |

### 訂單電郵總結格式

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 訂單總結 ORD-20260108-001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
類型    ：🚚 送貨
MAWB#   ：157-12345678
HAWB#   ：HKG-987654
提貨號  ：PU-20260108-001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
收貨公司：XX物流（香港）有限公司
地址    ：香港新界葵涌...
聯絡人  ：陳大文
電話    ：9123 4567
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
貨品    ：電子零件
件數    ：3 箱
重量    ：45 KG
CBM     ：0.52
⚡ 電力  ：有鋰電 (ELI)
🚨 趕機  ：🔴 是 - 需優先處理
備註    ：送貨前請致電
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
運輸公司：XX速運
狀態    ：待處理
建立日期：2026-01-08 15:00
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 📁 專案目錄結構

```text
gemini-intro-site/
├── package.json
├── server.js                # Express 伺服器與資料庫初始化
├── database.db              # SQLite 資料庫檔案
├── README.md                # 專案說明文件
├── db/
│   └── database.js          # SQLite 建表與預設數據初始化
├── routes/
│   ├── skills.js            # 技能 API
│   ├── contours.js          # Contour 影像 API
│   ├── forum.js             # 論壇/留言 API
│   └── orders.js            # 訂單系統 API（公司/範本/訂單）
└── public/
    ├── index.html           # 頁面結構 + Sidebar 導航
    ├── css/
    │   ├── base.css         # 主題變數與全域樣式
    │   ├── layout.css       # 版面與響應式
    │   ├── components.css   # 共用元件
    │   ├── animations.css   # 動畫
    │   └── orders.css       # 訂單系統樣式（手機優先）
    └── js/
        ├── theme.js         # 主題切換
        ├── animations.js    # 動畫效果
        ├── skills.js        # 技能頁邏輯
        ├── contours.js      # Contour 頁邏輯
        ├── forum.js         # 論壇頁邏輯（含 SSE）
        ├── chat.js          # AI Playground 邏輯
        ├── orders.js        # 訂單系統邏輯
        └── main.js          # 共用工具與初始化
```

## 🚀 快速啟動

1. 進入專案目錄
   ```bash
   cd gemini-intro-site
   ```

2. 安裝依賴
   ```bash
   npm install
   ```

3. 啟動服務
   ```bash
   npm start
   # 或
   node server.js
   ```

4. 開啟瀏覽器
   ```text
   http://localhost:3000
   ```

5. 內網可訪問
   若要讓同一網段其他裝置看見，伺服器已設定為可從內網訪問：
   ```text
   http://192.168.2.103:3000
   ```

> 第一次啟動時，系統會自動建立 database.db 並建立全部資料表。

## 🔧 主要技術

- Node.js
- Express
- SQLite3
- Vanilla JavaScript
- HTML / CSS

## 🔗 主要 API

### 技能
```http
GET /api/skills
```

### 論壇 / 留言
```http
GET  /api/threads                     # 論壇主題列表
GET  /api/threads/:id                 # 主題 + 回覆
POST /api/messages                    # 新增主題/回覆
PUT  /api/messages/:id                # 修改留言
DELETE /api/messages/:id              # 刪除留言
GET  /api/messages/stream             # SSE 即時推播
```

### 訂單系統
```http
GET    /api/orders/companies          # 公司/地點清單（支援 ?search= & ?category=）
POST   /api/orders/companies          # 新增公司（落單時順手儲存）
GET    /api/orders/templates          # 範本清單（可按 ?company_id= 過濾）
POST   /api/orders/templates          # 新增範本
DELETE /api/orders/templates/:id      # 刪除範本
GET    /api/orders                    # 訂單列表（搜尋：訂單編號/公司名/提單號 + ?status=）
POST   /api/orders                    # 建立訂單（自動產生 ORD-YYYYMMDD-XXX 編號）
GET    /api/orders/:id                # 訂單詳情
PUT    /api/orders/:id                # 更新訂單（狀態/修改）
DELETE /api/orders/:id                # 刪除訂單
```

### Contour 影像
```http
GET /api/contours
GET /api/contour-image/...
```

## 🧩 常見修改位置

- 前端內容：public/index.html
- 前端樣式：public/css/
- 前端互動 / API：public/js/
- 後端邏輯與資料庫初始化：server.js、db/database.js
- 訂單系統後端：routes/orders.js
- 訂單系統前端：public/js/orders.js、public/css/orders.css

## 🎨 主題相關

目前支援以下主題切換：
- Light
- Dark
- Ocean

Ocean 主題可透過色盤自訂主題色，網站主色、背景與文字對比會跟著變化。

## ✅ 已完成功能總結

- 可在網站中瀏覽介紹內容
- 可進行留言互動 / 論壇主題與回覆
- 可查看技能與能力展示
- 可匯出 CSV / XLSX
- 可從內網連入觀看
- 支援 ESC 關閉匯出彈窗
- 收/送貨訂單管理（新建、列表、搜尋、狀態、編輯、複製、刪除）
- 公司/地點資料庫（客戶、倉庫、運輸公司）
- 訂單範本一鍵載入
- 訂單電郵總結（mailto: 免設定）

## 💡 日後可擴展方向

- 把後端拆成 routes / controllers / services
- 把前端拆成更細的模組
- 加入使用者登入與權限
- 加入圖片上傳或資料編輯功能
- 改成部署到雲端服務（如 Render / Railway / Vercel + Node）
- 訂單系統加入 PDF 匯出 / 批次列印
- 訂單系統加入日期範圍統計報表

## 🛠️ 常見問題

### 1. 啟動後打開空白頁
- 確認 Node.js 已安裝
- 確認已執行 `npm install`
- 確認伺服器有正常啟動

### 2. 內網其他裝置無法開啟
- 確認本機服務有啟動
- 確認防火牆允許 Node / 3000 Port
- 改用 `http://你的本機內網IP:3000`

### 3. 資料庫無法使用
- 檢查根目錄是否有 `database.db`
- 重新啟動服務，系統會自動初始化