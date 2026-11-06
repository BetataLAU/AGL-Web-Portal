const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// 初始化 SQLite 數據庫
// 路徑可透過環境變數覆寫（Railway：DATA_DIR 指向持久 Volume，避免 rebuild 時重置）
const DATA_DIR = process.env.DATA_DIR;
const DB_PATH = process.env.DB_PATH || (DATA_DIR ? path.join(DATA_DIR, 'database.db') : path.join(__dirname, '..', 'database.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('數據庫連接失敗:', err.message);
  else console.log(`已成功連接 SQLite 數據庫（${DB_PATH}）`);
});

// 初始化完成訊號（R4）：schema 與相容性欄位都補好後才 resolve。
// server.js 用它決定「什麼時候可以跑 seed-admin」——全新 DB 若在 ALTER TABLE 完成前就 seed，
// 會因為 companies.company_code 不存在而失敗（→ 沒有 admin 帳號）。
const initTasks = [];

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- 登入用的公司短碼（R4：全新 DB 必須直接有這個欄位，否則 server.js 的 seed-admin
      -- 會比下面的 ALTER TABLE 更早讀取 companies → no such column: company_code → 沒有 admin）
      company_code TEXT
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
    ensureUserColumn('sidebar_bg_url', 'TEXT'); // 登入卡背景圖（伺服器端持久化）
    ensureUserColumn('sidebar_nav_order', 'TEXT'); // 側邊欄導航自訂排序（JSON 陣列，伺服器端持久化）
  });

  // companies 表相容性：補上 company_code 欄位（登入用的公司短碼）
  // R4：包成 promise 併進 initTasks，等 ALTER TABLE 真的完成才讓 seed 有機會跑
  initTasks.push(new Promise((resolve) => {
    db.all("PRAGMA table_info(companies)", [], (err, companyCols) => {
      if (err) {
        console.error('PRAGMA table_info(companies) failed:', err.message);
        return resolve();
      }
      const columns = companyCols.map(c => c.name);
      if (columns.includes('company_code')) return resolve();
      db.run("ALTER TABLE companies ADD COLUMN company_code TEXT", (alterErr) => {
        if (alterErr) {
          console.error('Failed to add company_code column:', alterErr.message);
        } else {
          console.log('Added company_code column to companies table');
        }
        resolve();
      });
    });
  }));

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
      sort_order INTEGER DEFAULT 0,
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

  // mawb_records 表相容性：補上 order_id 欄位（訂單 ↔ 打板 雙向同步用）
  db.all("PRAGMA table_info(mawb_records)", [], (err, mawbCols) => {
    if (err) {
      console.error('PRAGMA table_info(mawb_records) failed:', err.message);
      return;
    }
    const mawbColumns = mawbCols.map(c => c.name);
    if (!mawbColumns.includes('order_id')) {
      db.run("ALTER TABLE mawb_records ADD COLUMN order_id INTEGER", (alterErr) => {
        if (alterErr) {
          console.error('Failed to add order_id column to mawb_records:', alterErr.message);
        } else {
          console.log('Added order_id column to mawb_records');
        }
      });
    }
  });

  // pallet_plans 表相容性：補上 sort_order 欄位（整張卡片拖曳排序用）
  db.all("PRAGMA table_info(pallet_plans)", [], (err, planCols) => {
    if (err) {
      console.error('PRAGMA table_info(pallet_plans) failed:', err.message);
      return;
    }
    const planColumns = planCols.map(c => c.name);
    if (!planColumns.includes('sort_order')) {
      db.run("ALTER TABLE pallet_plans ADD COLUMN sort_order INTEGER DEFAULT 0", (alterErr) => {
        if (alterErr) {
          console.error('Failed to add sort_order column to pallet_plans:', alterErr.message);
        } else {
          console.log('Added sort_order column to pallet_plans');
        }
      });
    }
  });

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

  // ===== ULD 夾重系統：夾重表（一張單＝一次夾重作業）=====
  db.run(`
    CREATE TABLE IF NOT EXISTS uld_weight_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_no TEXT UNIQUE,
      sheet_date TEXT,
      terminal TEXT DEFAULT 'CPSL',
      flight_no TEXT,
      flight_date TEXT,
      round_px REAL DEFAULT 1,
      round_b REAL DEFAULT 1,
      tail_mode TEXT DEFAULT 'adjust_largest',
      diff_warn_pct REAL DEFAULT 2,
      diff_warn_kg REAL DEFAULT 100,
      -- R2：多票夾重比例的上下限（%，0 = 不限）；寫入時由 calc.js 依此 clamp 比例
      clamp_min_pct REAL DEFAULT 0,
      clamp_max_pct REAL DEFAULT 0,
      handler TEXT,
      remark TEXT,
      status TEXT DEFAULT 'draft',
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== ULD 夾重系統：收貨單位（P/X = 1 個 ULD；B = 1 批散貨）=====
  db.run(`
    CREATE TABLE IF NOT EXISTS uld_weight_ulds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL,
      seq INTEGER DEFAULT 0,
      kind TEXT DEFAULT 'ULD',
      uld_number TEXT,
      bulk_ref TEXT,
      rcl_no TEXT,
      contour_code TEXT,
      port TEXT,
      pcs INTEGER DEFAULT 0,
      tare_weight REAL DEFAULT 0,
      rcl_gross_weight REAL DEFAULT 0,
      material_weight REAL DEFAULT 0,
      lih_type TEXT DEFAULT 'N',
      predecl_type TEXT DEFAULT 'P',
      squeeze_mode TEXT DEFAULT 'weight',
      net_weight REAL DEFAULT 0,
      diff_weight REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== ULD 夾重系統：明細（每板 × 每 MAWB，重量分攤的關鍵）=====
  db.run(`
    CREATE TABLE IF NOT EXISTS uld_weight_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uld_id INTEGER NOT NULL,
      seq INTEGER DEFAULT 0,
      mawb TEXT,
      mawb_record_id INTEGER,
      port TEXT,
      pcs INTEGER DEFAULT 0,
      declared_weight REAL DEFAULT 0,
      final_weight REAL DEFAULT 0,
      is_squeeze INTEGER DEFAULT 0,
      squeeze_ratio REAL,
      lih_type TEXT DEFAULT 'N',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_uld_weight_ulds_sheet ON uld_weight_ulds(sheet_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_uld_weight_items_uld ON uld_weight_items(uld_id)');

  // ===== ULD 夾重系統：歷史版本（V3）=====
  // 每次「新增／儲存／鎖定／解鎖／套用／補建 Booking」都留一份 snapshot（JSON，只存輸入值），
  // 供版本清單與異動比對用。每張表只保留最近 N 版（見 routes/uld-weight.js 的 VERSION_KEEP）。
  db.run(`
    CREATE TABLE IF NOT EXISTS uld_weight_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL,
      version_no INTEGER DEFAULT 1,
      action TEXT,
      status TEXT,
      note TEXT,
      snapshot TEXT,
      summary TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_uld_weight_versions_sheet ON uld_weight_versions(sheet_id, version_no)'
  );

  // uld_weight_sheets 表相容性：補上「磅差警示門檻」（W5）與「比例上下限」（R2）；
  // 既有 DB 用 ALTER TABLE 補，新 DB 由上面 CREATE TABLE 就有
  initTasks.push(new Promise((resolve) => {
    db.all("PRAGMA table_info(uld_weight_sheets)", [], (err, sheetCols) => {
      if (err) {
        console.error('PRAGMA table_info(uld_weight_sheets) failed:', err.message);
        return resolve();
      }
      const sheetColumns = sheetCols.map(c => c.name);
      const missing = [
        { name: 'diff_warn_pct', def: 'REAL DEFAULT 2' },
        { name: 'diff_warn_kg', def: 'REAL DEFAULT 100' },
        { name: 'clamp_min_pct', def: 'REAL DEFAULT 0' },
        { name: 'clamp_max_pct', def: 'REAL DEFAULT 0' }
      ].filter(col => !sheetColumns.includes(col.name));
      if (!missing.length) return resolve();
      let pending = missing.length;
      missing.forEach(col => {
        db.run(`ALTER TABLE uld_weight_sheets ADD COLUMN ${col.name} ${col.def}`, (alterErr) => {
          if (alterErr) {
            console.error(`Failed to add ${col.name} column to uld_weight_sheets:`, alterErr.message);
          } else {
            console.log(`Added ${col.name} column to uld_weight_sheets`);
          }
          pending -= 1;
          if (pending === 0) resolve();
        });
      });
    });
  }));

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

// 初始化完成訊號：schema 與相容性欄位（例：companies.company_code）都補好後才 resolve，
// server.js 會等它才跑 scripts/seed-admin.js（避免全新 DB 的 seed 競態）
const ready = Promise.all(initTasks).then(() => db);

module.exports = db;
module.exports.ready = ready;