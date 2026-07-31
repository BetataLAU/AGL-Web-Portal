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

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT,
      title TEXT,
      category TEXT,
      content TEXT,
      parent_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.all("PRAGMA table_info(messages)", [], (err, rows) => {
    if (err) {
      console.error('PRAGMA table_info failed:', err.message);
    } else {
      const columns = rows.map(column => column.name);
      if (!columns.includes('parent_id')) {
        db.run("ALTER TABLE messages ADD COLUMN parent_id INTEGER", (alterErr) => {
          if (alterErr) {
            console.error('Failed to add parent_id column:', alterErr.message);
          } else {
            console.log('Added parent_id column to messages table');
          }
        });
      }
      if (!columns.includes('title')) {
        db.run("ALTER TABLE messages ADD COLUMN title TEXT", (alterErr) => {
          if (alterErr) {
            console.error('Failed to add title column:', alterErr.message);
          } else {
            console.log('Added title column to messages table');
          }
        });
      }
      if (!columns.includes('category')) {
        db.run("ALTER TABLE messages ADD COLUMN category TEXT", (alterErr) => {
          if (alterErr) {
            console.error('Failed to add category column:', alterErr.message);
          } else {
            console.log('Added category column to messages table');
          }
        });
      }
    }
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