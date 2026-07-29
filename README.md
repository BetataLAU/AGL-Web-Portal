# Gemini 全棧介紹網站 (Full-Stack Intro Site)

這是一個以 Node.js + Express + SQLite 建立的簡單全棧展示網站，包含前端頁面、後端 API 與資料庫儲存功能。

## 這個網站目前包含什麼

- 前端展示頁：首頁、AI Playground、Capabilities、Guestbook
- 後端 API：取得技能、留言列表、新增/修改/刪除留言
- SQLite 資料庫：儲存留言與技能資料
- 主題切換：Light / Dark / Ocean，並支援 Ocean 主題自訂色盤
- 匯出功能：可匯出 CSV / XLSX
- 彈窗操作：匯出視窗支援 ESC 關閉

## 📁 專案目錄結構

```text
gemini-intro-site/
├── package.json
├── server.js                # Express 伺服器與資料庫初始化
├── database.db              # SQLite 資料庫檔案
├── README.md                # 專案說明文件
└── public/
    ├── index.html           # 頁面結構
    ├── style.css            # 全站樣式與主題樣式
    └── app.js               # 前端互動與 API 呼叫邏輯
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

> 第一次啟動時，系統會自動建立 database.db，並初始化預設技能資料。

## 🔧 主要技術

- Node.js
- Express
- SQLite3
- Vanilla JavaScript
- HTML / CSS

## 🔗 主要 API

### 取得技能資料
```http
GET /api/skills
```

### 取得留言列表
```http
GET /api/messages
```

### 新增留言
```http
POST /api/messages
Content-Type: application/json

{
  "user_name": "Alice",
  "content": "Hello"
}
```

### 修改留言
```http
PUT /api/messages/:id
```

### 刪除留言
```http
DELETE /api/messages/:id
```

## 🧩 常見修改位置

- 前端內容：public/index.html
- 前端樣式：public/style.css
- 前端互動 / API：public/app.js
- 後端邏輯與資料庫初始化：server.js

## 🎨 主題相關

目前支援以下主題切換：
- Light
- Dark
- Ocean

Ocean 主題可透過色盤自訂主題色，網站主色、背景與文字對比會跟著變化。

## ✅ 已完成功能總結

- 可在網站中瀏覽介紹內容
- 可進行留言互動
- 可查看技能與能力展示
- 可匯出 CSV / XLSX
- 可從內網連入觀看
- 支援 ESC 關閉匯出彈窗

## 💡 日後可擴展方向

- 把後端拆成 routes / controllers / services
- 把前端拆成更細的模組
- 加入使用者登入與權限
- 加入圖片上傳或資料編輯功能
- 改成部署到雲端服務（如 Render / Railway / Vercel + Node）

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
