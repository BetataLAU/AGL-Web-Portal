// ===== 修復側邊欄導航排序資料（users.sidebar_nav_order）=====
// 背景：舊版 PUT /api/auth/me/nav-order 的白名單只允許 `#section-*` 與 `users.html`，
//       頁面連結型目錄（uld-packing.html / packing.html）會被過濾掉，
//       前端套用排序時這兩個項目會浮回最上方（使用者感覺「位置記不住」）。
// 本腳本會針對已有自訂排序的使用者：
//   1. 移除非法 / 重複的 key（驗證規則與 routes/auth/auth-router.js 一致）
//   2. 補回缺少但合法的目錄項目，位置依 index.html 的預設順序就近插入
// 用法：node scripts/fix-nav-order.js
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = process.env.DATA_DIR;
const DB_PATH = process.env.DB_PATH || (DATA_DIR ? path.join(DATA_DIR, 'database.db') : path.join(__dirname, '..', 'database.db'));

// index.html 目錄的預設順序（不含固定不動的 HOME）
const DEFAULT_ORDER = [
  '#section-chat',
  '#section-skills',
  '#section-contour',
  '#section-orders',
  '#section-xls-booking',
  '#section-palletization',
  'uld-packing.html',
  'packing.html',
  '#section-dbviewer',
  'users.html'
];

// 與後端相同的驗證規則（站內錨點 + 頁面連結）
const NAV_KEY_MAX_LEN = 100;
const NAV_ANCHOR_RE = /^#section-[A-Za-z0-9_-]+$/;
const NAV_PAGE_RE = /^[A-Za-z0-9_-]+\.html$/;

function sanitizeNavOrder(rawOrder) {
  const seen = new Set();
  const clean = [];
  (Array.isArray(rawOrder) ? rawOrder : []).forEach(item => {
    const key = String(item).trim();
    if (!key || key.length > NAV_KEY_MAX_LEN) return;
    if (!NAV_ANCHOR_RE.test(key) && !NAV_PAGE_RE.test(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    clean.push(key);
  });
  return clean;
}

// 補回缺少的合法項目：依預設順序，插在「預設順序中之後第一個已存在項目」之前
function repairNavOrder(rawOrder) {
  const result = sanitizeNavOrder(rawOrder);
  DEFAULT_ORDER.forEach((key, idx) => {
    if (result.includes(key)) return;
    let insertAt = result.length;
    for (let i = idx + 1; i < DEFAULT_ORDER.length; i++) {
      const pos = result.indexOf(DEFAULT_ORDER[i]);
      if (pos !== -1) { insertAt = pos; break; }
    }
    result.splice(insertAt, 0, key);
  });
  return result;
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('數據庫連接失敗:', err.message);
    process.exit(1);
  }
});

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { return err ? reject(err) : resolve(this.changes); });
  });
}

(async () => {
  console.log(`===== 修復側邊欄導航排序（${DB_PATH}）=====`);

  const rows = await dbAll("SELECT id, user_id, sidebar_nav_order FROM users ORDER BY id");
  let fixed = 0;

  for (const row of rows) {
    const label = `[user#${row.id} ${row.user_id}]`;
    if (!row.sidebar_nav_order) {
      console.log(`- ${label} 無自訂排序（使用預設順序），略過`);
      continue;
    }

    let parsed = [];
    try {
      const json = JSON.parse(row.sidebar_nav_order);
      if (Array.isArray(json)) parsed = json;
    } catch (e) { /* 舊資料格式異常 → 以空陣列重建 */ }

    if (parsed.length === 0) {
      console.log(`- ${label} 排序資料為空，略過`);
      continue;
    }

    const before = JSON.stringify(sanitizeNavOrder(parsed));
    const repaired = repairNavOrder(parsed);
    const after = JSON.stringify(repaired);

    if (before === after) {
      console.log(`- ${label} 無需修改（${repaired.length} 項）`);
      continue;
    }

    await dbRun("UPDATE users SET sidebar_nav_order = ? WHERE id = ?", [after, row.id]);
    fixed += 1;
    console.log(`- ${label} 已修復：${JSON.parse(before).length} 項 → ${repaired.length} 項`);
    console.log(`    舊：${before}`);
    console.log(`    新：${after}`);
  }

  console.log(`===== 完成（修復 ${fixed} 筆）=====`);
  db.close();
  process.exit(0);
})().catch(err => {
  console.error('修復失敗：', err.message);
  db.close();
  process.exit(1);
});
