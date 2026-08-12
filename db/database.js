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

  // ===== 登入系統：審計日誌 =====
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT,
      actor_display TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== 登入系統：使用者 =====
  // 角色：admin（管理員，可管理使用者與看所有資料）、staff（內部員工）、customer（客戶，只能看自己的訂單）
  // failed_attempts：連續密碼錯誤次數；locked_until：帳號鎖定到期時間（試錯上限）
  // last_login_at：上次登入時間；permissions：JSON 權限開關（細粒度權限用）
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'customer',
      is_active INTEGER DEFAULT 1,
      failed_attempts INTEGER DEFAULT 0,
      locked_until DATETIME,
      last_login_at DATETIME,
      permissions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, user_id)
    )
  `);

  // users 表相容性：補上試錯上限 / 上次登入 / 權限欄位
  db.all("PRAGMA table_info(users)", [], (err, userCols) => {
    if (err) {
      console.error('PRAGMA table_info(users) failed:', err.message);
      return;
    }
    const userColumns = userCols.map(c => c.name);
    const ensureUserColumn = (name, type) => {
      if (!userColumns.includes(name)) {
        db.run(`ALTER TABLE users ADD COLUMN ${name} ${type}`, (alterErr) => {
          if (alterErr) {
            console.error(`Failed to add ${name} column to users table:`, alterErr.message);
          } else {
            console.log(`Added ${name} column to users table`);
          }
        });
      }
    };
    ensureUserColumn('failed_attempts', 'INTEGER DEFAULT 0');
    ensureUserColumn('locked_until', 'DATETIME');
    ensureUserColumn('last_login_at', 'DATETIME');
    ensureUserColumn('permissions', 'TEXT');
  });

  // companies 表相容性：補上 company_code 欄位（登入用的公司短碼）
  db.all("PRAGMA table_info(companies)", [], (err, companyCols) => {
    if (err) {
      console.error('PRAGMA table_info(companies) failed:', err.message);
      return;
    }
    const columns = companyCols.map(c => c.name);
    if (!columns.includes('company_code')) {
      db.run("ALTER TABLE companies ADD COLUMN company_code TEXT", (alterErr) => {
        if (alterErr) {
          console.error('Failed to add company_code column:', alterErr.message);
        } else {
          console.log('Added company_code column to companies table');
        }
      });
    }
  });

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

  // ===== 打板計劃：Booking Record（左欄 MAWB 主檔） =====
  db.run(`
    CREATE TABLE IF NOT EXISTS mawb_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mawb TEXT,
      hawb TEXT,
      client TEXT,
      dest TEXT,
      pcs INTEGER DEFAULT 0,
      gross_weight REAL DEFAULT 0,
      volume_weight REAL DEFAULT 0,
      cbm REAL DEFAULT 0,
      spl TEXT,
      remark TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== 打板計劃：計劃主表 =====
  db.run(`
    CREATE TABLE IF NOT EXISTS pallet_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_no TEXT UNIQUE,
      company_name TEXT,
      fax TEXT,
      plan_date TEXT,
      flight_no TEXT,
      flight_date TEXT,
      arrival_airport TEXT,
      contour_text TEXT,
      contour_code TEXT,
      max_gross_weight REAL,
      handover_hours INTEGER,
      planner TEXT,
      remarks TEXT,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== 打板計劃：計劃明細（MAWB ↔ Plan 多對多） =====
  db.run(`
    CREATE TABLE IF NOT EXISTS pallet_plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      mawb_record_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(plan_id, mawb_record_id)
    )
  `);

  // ===== 打板計劃：SPL 特殊代碼（可維護清單） =====
  db.run(`
    CREATE TABLE IF NOT EXISTS spl_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== 打板計劃：REMARK 備註範本（可維護清單） =====
  db.run(`
    CREATE TABLE IF NOT EXISTS remark_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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

  // 打板計劃：SPL 種子資料（若表格為空）
  db.get("SELECT COUNT(*) AS count FROM spl_codes", (err, row) => {
    if (row && row.count === 0) {
      const seedSpl = [
        ['無電', '全數無電'],
        ['全部冇電', '全部無電'],
        ['PI967', '鋰電池（隨設備）'],
        ['PI968', '鋰電池（獨立）'],
        ['UN3481', '鋰電池安裝於設備內'],
        ['UN3480', '鋰離子電池'],
        ['UN3091', '鋰金屬電池安裝於設備內'],
        ['ELI', '鋰電池'],
        ['ELM', '鋰金屬'],
        ['A67', '鋰電池（包裝）'],
        ['A123', '鋰電池（設備）'],
        ['A199', '鋰電池（內置）'],
        ['SPX', '特殊處理（Special Handling）'],
        ['PER', '易腐貨'],
        ['AVI', '活體動物'],
        ['VAL', '貴重貨'],
        ['HUM', '人體遺骸'],
        ['DIP', '外交郵袋'],
        ['EAT', '食品']
      ];
      const stmt = db.prepare("INSERT INTO spl_codes (code, description) VALUES (?, ?)");
      seedSpl.forEach(([code, desc]) => stmt.run(code, desc));
      stmt.finalize();
    }
  });

  // 打板計劃：REMARK 範本種子資料（若表格為空）
  db.get("SELECT COUNT(*) AS count FROM remark_templates", (err, row) => {
    if (row && row.count === 0) {
      const seedRemarks = [
        ['JPS 自送', '今天自送到 JPS'],
        ['卸車點', 'JPS 卸車 / 代貼 UN3481 電池 LABEL'],
        ['20% HAND SEARCH', '需要幫忙做 20% HAND SEARCH，影貨相、LABEL相、開箱相、裝板相'],
        ['不需爆箱', '不需要爆箱'],
        ['REV PLAN', 'REV PLAN（換貨）'],
        ['防火網', '要裝防火網'],
        ['AWB LABEL', '每件貨貼 2 張 AWB LABEL'],
        ['交板時間', '起飛前 8 個鐘要交到板']
      ];
      const stmt = db.prepare("INSERT INTO remark_templates (name, content) VALUES (?, ?)");
      seedRemarks.forEach(([name, content]) => stmt.run(name, content));
      stmt.finalize();
    }
  });
});

module.exports = db;