const sqlite3 = require('sqlite3').verbose();

// 初始化 SQLite 數據庫
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) console.error('數據庫連接失敗:', err.message);
  else console.log('已成功連接 SQLite 數據庫');
});

// 建表與預設數據初始化
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      name TEXT,
      level INTEGER
    )
  `);

  // ===== 訂單系統：公司/地點 =====
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT DEFAULT 'customer',
      name TEXT,
      address TEXT,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== 訂單系統：範本 =====
  db.run(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      company_id INTEGER,
      cargo_desc TEXT,
      quantity INTEGER,
      weight_kg REAL,
      cbm REAL,
      power_type TEXT DEFAULT 'no',
      receiver_name TEXT,
      receiver_phone TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== 訂單系統：訂單 =====
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT,
      order_type TEXT,
      mawb TEXT,
      hawb TEXT,
      dest TEXT,
      pickup_no TEXT,
      customer_company_id INTEGER,
      pickup_company_id INTEGER,
      delivery_company_id INTEGER,
      cargo_desc TEXT,
      quantity INTEGER,
      weight_kg REAL,
      cbm REAL,
      cbm_dimensions TEXT,
      power_type TEXT DEFAULT 'no',
      power_code TEXT,
      power_items TEXT,
      urgent TEXT DEFAULT 'no',
      receiver_name TEXT,
      receiver_phone TEXT,
      address TEXT,
      notes TEXT,
      transport_company TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== 訂單系統：備註文字範本 =====
  db.run(`
    CREATE TABLE IF NOT EXISTS note_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // orders 表相容性：確保新資料庫（少了欄位）補上
  db.all("PRAGMA table_info(orders)", [], (err, ordersCols) => {
    if (err) {
      console.error('PRAGMA table_info(orders) failed:', err.message);
      return;
    }
    const orderColumns = ordersCols.map(c => c.name);
    const ensureColumn = (name, type) => {
      if (!orderColumns.includes(name)) {
        db.run(`ALTER TABLE orders ADD COLUMN ${name} ${type}`, (alterErr) => {
          if (alterErr) {
            console.error(`Failed to add ${name} column:`, alterErr.message);
          } else {
            console.log(`Added ${name} column to orders table`);
          }
        });
      }
    };
    ensureColumn('power_items', 'TEXT');
    ensureColumn('pickup_datetime', 'TEXT');
    ensureColumn('receiver_note', 'TEXT');
    ensureColumn('contact_note', 'TEXT');
    ensureColumn('customer_company_id', 'INTEGER');
    ensureColumn('cbm_dimensions', 'TEXT');
    ensureColumn('dest', 'TEXT');
  });

  // 插入初始技能資料（若表格為空）
  db.get("SELECT COUNT(*) AS count FROM skills", (err, row) => {
    if (row && row.count === 0) {
      const stmt = db.prepare("INSERT INTO skills (category, name, level) VALUES (?, ?, ?)");
      stmt.run("核心能力", "多模態理解與生成", 95);
      stmt.run("核心能力", "程式碼編寫與除錯", 92);
      stmt.run("核心能力", "邏輯推理與分析", 90);
      stmt.run("長處", "上下文處理能力", 95);
      stmt.run("長處", "自動化工作流程整合", 88);
      stmt.finalize();
    }
  });
});

module.exports = db;