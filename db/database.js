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

  // ===== Booking Record（MAWB 主檔；執 PLAN／ULD 夾重共用） =====
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

  // mawb_records 表相容性：補上 order_id 欄位（訂單 ↔ Booking Record 同步用）
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
      -- 新 UI：允許使用 0.5kg（1 = 可 0.5；0 = 所有重量只以整數運算）
      allow_half_kg INTEGER DEFAULT 0,
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

  // ===== ULD 夾重系統：MAWB 申報列（方案 B）=====
  // 一票一列＝載荷表左邊那一欄（SEQ／MAWB／DEST／申報 PCS·WT／W/H or Booking）。
  // 各板只填件數，重量由 calc.uldApplyMawbAllocation() 依件數分到各板（Σ = 申報重量）。
  // auto_alloc：1 = 依件數自動分重量（預設）／0 = 保留各板自填重量（舊資料自動長出來的列用 0，
  //             避免升級後把使用者原本填好的分板重量改掉）。
  db.run(`
    CREATE TABLE IF NOT EXISTS uld_weight_mawbs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL,
      seq INTEGER DEFAULT 0,
      mawb TEXT,
      mawb_record_id INTEGER,
      dest TEXT,
      pcs INTEGER DEFAULT 0,
      declared_weight REAL DEFAULT 0,
      wh_ref TEXT,
      auto_alloc INTEGER DEFAULT 1,
      is_squeeze INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_uld_weight_mawbs_sheet ON uld_weight_mawbs(sheet_id)');

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

  // ===== 模擬裝板系統：雲端存檔（2026-11）=====
  // 模擬裝板本身是「免登入」的純前端工具；這張表只存使用者按下「存到雲端」的板。
  // snapshot 存整份 JSON（板型／板底／單位／貨物擺位／檢查選項…），與 uld_weight_versions 同一個思路：
  // 前端格式改了不用改資料表；其他欄位只是給清單顯示用的彙總（可由 snapshot 重算）。
  // saved_at 存「前端送來的 ISO 時間」（使用者當地時間），清單直接顯示，避免 UTC 時差。
  db.run(`
    CREATE TABLE IF NOT EXISTS loadsim_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      uld_code TEXT,
      plate_type TEXT,
      item_count INTEGER DEFAULT 0,
      board_count INTEGER DEFAULT 0,
      total_kg REAL DEFAULT 0,
      gross_kg REAL DEFAULT 0,
      utilization_pct REAL DEFAULT 0,
      saved_at TEXT,
      snapshot TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_loadsim_plans_saved ON loadsim_plans(saved_at DESC)');

  // ===== 執 PLAN（Loading Plan，2026-11）=====
  // 對應 Yat Loading Plan/AGL執PLAN.xlsx：一個「plan」＝Excel 的一個區塊（航班／板位），
  // `type='stock'` 則是「存貨」虛擬 plan（未分配的 booking 池，不計入航班 KPI）。
  // 一票 booking 同一時間只屬於一個 plan（Move = 改 plan_id）；「複製」才會出現
  // split_of_item_id 並在 KPI 標示「重複 MAWB」。
  db.run(`
    CREATE TABLE IF NOT EXISTS loading_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_no TEXT UNIQUE,
      type TEXT DEFAULT 'flight',
      day_code TEXT,
      flight_no TEXT,
      flight_date TEXT,
      etd TEXT,
      owner_company TEXT,
      contour_code TEXT,
      contour_text TEXT,
      contour_qty INTEGER DEFAULT 1,
      contour_known INTEGER DEFAULT 0,
      contour_dims TEXT,
      max_gross_weight REAL,
      max_cbm REAL,
      volume_view TEXT DEFAULT 'vol',
      status TEXT DEFAULT 'draft',
      sort_order INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      archived_at DATETIME,
      archived_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_loading_plans_sort ON loading_plans(sort_order, id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_loading_plans_day ON loading_plans(day_code)');
  // 注意：archived_at 的索引不能在此建立——既有 DB 還沒 ALTER TABLE 補欄會直接 SQLITE_ERROR，
  // 移到下面的 initTasks（補欄完成後）再建。

  db.run(`
    CREATE TABLE IF NOT EXISTS loading_plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      mawb_record_id INTEGER,
      mawb TEXT,
      client TEXT,
      dest TEXT,
      tag TEXT,
      pkgs_text TEXT,
      cartons INTEGER,
      pallets INTEGER,
      pcs_total INTEGER,
      gross_weight REAL DEFAULT 0,
      volume_weight REAL,
      volume_source TEXT DEFAULT 'calc',
      cbm REAL DEFAULT 0,
      cuft REAL DEFAULT 0,
      volume_input_unit TEXT DEFAULT 'cbm',
      cargo_receipt TEXT,
      remark TEXT,
      dg_no_power INTEGER DEFAULT 0,
      dg_966 INTEGER DEFAULT 0,
      dg_967 INTEGER DEFAULT 0,
      dg_969 INTEGER DEFAULT 0,
      dg_970 INTEGER DEFAULT 0,
      h_af INTEGER DEFAULT 0,
      h_fs INTEGER DEFAULT 0,
      h_sc INTEGER DEFAULT 0,
      h_vol INTEGER DEFAULT 0,
      h_ctg INTEGER DEFAULT 0,
      h_xray INTEGER DEFAULT 0,
      section INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      split_of_item_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(plan_id, mawb_record_id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_loading_items_plan ON loading_plan_items(plan_id, section, sort_order)');
  db.run('CREATE INDEX IF NOT EXISTS idx_loading_items_mawb ON loading_plan_items(mawb)');
  db.run('CREATE INDEX IF NOT EXISTS idx_loading_items_record ON loading_plan_items(mawb_record_id)');

  // 事件流：多人即時同步（SSE 以 id 補送）＋ 操作回溯
  db.run(`
    CREATE TABLE IF NOT EXISTS loading_plan_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER,
      actor_user_id TEXT,
      actor_display TEXT,
      action TEXT NOT NULL,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_loading_events_plan ON loading_plan_events(plan_id, id)');

  // 線上狀態（誰在看哪張 plan、正在改哪一格）；斷線即移除，重啟清空
  db.run(`
    CREATE TABLE IF NOT EXISTS loading_plan_presence (
      conn_id TEXT PRIMARY KEY,
      plan_id INTEGER,
      user_id TEXT,
      display TEXT,
      editing_item_id INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_loading_presence_plan ON loading_plan_presence(plan_id)');

  // loading_plans 表相容性：補上「封存」（archived_at／archived_by）。
  // 既有 DB 用 ALTER TABLE 補，新 DB 由上面 CREATE TABLE 就有；
  // 索引一定要「補欄完成後」才建（否則既有 DB 會 no such column: archived_at）。
  initTasks.push(new Promise((resolve) => {
    db.all('PRAGMA table_info(loading_plans)', [], (err, planCols) => {
      if (err) {
        console.error('PRAGMA table_info(loading_plans) failed:', err.message);
        return resolve();
      }
      const ensureIndex = () => {
        db.run('CREATE INDEX IF NOT EXISTS idx_loading_plans_archived ON loading_plans(archived_at)', (indexErr) => {
          if (indexErr) console.error('Failed to create idx_loading_plans_archived:', indexErr.message);
          resolve();
        });
      };
      const planColumns = planCols.map(c => c.name);
      const missing = [
        { name: 'archived_at', def: 'DATETIME' },
        { name: 'archived_by', def: 'TEXT' }
      ].filter(col => !planColumns.includes(col.name));
      if (!missing.length) return ensureIndex();
      let pending = missing.length;
      missing.forEach(col => {
        db.run(`ALTER TABLE loading_plans ADD COLUMN ${col.name} ${col.def}`, (alterErr) => {
          if (alterErr) {
            console.error(`Failed to add ${col.name} column to loading_plans:`, alterErr.message);
          } else {
            console.log(`Added ${col.name} column to loading_plans`);
          }
          pending -= 1;
          if (pending === 0) ensureIndex();
        });
      });
    });
  }));

  // MAWB 搜尋（執 PLAN 的動態搜尋會用）
  db.run('CREATE INDEX IF NOT EXISTS idx_mawb_records_mawb ON mawb_records(mawb)');

  // 多人同時操作：WAL（單寫多讀）＋ 寫入鎖等待，避免 SQLITE_BUSY 直接失敗
  db.get('PRAGMA journal_mode = WAL', (err, row) => {
    if (err) console.error('[db] 啟用 WAL 失敗（維持預設 journal 模式）:', err.message);
    else if (row && row.journal_mode) console.log(`[db] journal_mode = ${row.journal_mode}`);
  });
  db.run('PRAGMA busy_timeout = 5000');

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
        { name: 'clamp_max_pct', def: 'REAL DEFAULT 0' },
        // 2026-11-11：允許使用 0.5kg（0 = 全部以整數運算）
        { name: 'allow_half_kg', def: 'INTEGER DEFAULT 0' }
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

});

// 初始化完成訊號：schema 與相容性欄位（例：companies.company_code）都補好後才 resolve，
// server.js 會等它才跑 scripts/seed-admin.js（避免全新 DB 的 seed 競態）
const ready = Promise.all(initTasks).then(() => db);

module.exports = db;
module.exports.ready = ready;