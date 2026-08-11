// ===== db-import.js =====
// 用 db/db-dump.sql 快照完整重建 database.db
// 執行方式：node scripts/db-import.js
// 警告：會覆蓋目前 database.db 的所有資料！
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, '..', 'database.db');
const DUMP_PATH = path.resolve(__dirname, '..', 'db', 'db-dump.sql');

// 簡單 SQL 語句分割器：僅在有換行的分號處切割，並忽略註解行
// 支援 LF（\n）與 CRLF（\r\n）兩種行尾，避免 Windows 環境下切割失敗
function splitSqlStatements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== '' && !trimmed.startsWith('--');
    })
    .join('\n')
    .split(/;\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s + ';');
}

if (!fs.existsSync(DUMP_PATH)) {
  console.error(`❌ 找不到快照檔: ${DUMP_PATH}`);
  console.error('   請先執行 npm run db:export 產生快照，或確認已從 git pull 取得 db/db-dump.sql。');
  process.exit(1);
}

console.log(`📦 讀取快照: ${DUMP_PATH}`);
const dumpSql = fs.readFileSync(DUMP_PATH, 'utf8');
const statements = splitSqlStatements(dumpSql);

if (!statements.length) {
  console.error('❌ 快照內容為空，無法匯入。');
  process.exit(1);
}

console.log(`   解析到 ${statements.length} 個 SQL 語句`);

// 移除現有資料庫檔案（若存在且未被鎖定）
if (fs.existsSync(DB_PATH)) {
  try {
    fs.unlinkSync(DB_PATH);
    console.log(`🗑  已移除舊資料庫: ${DB_PATH}`);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      console.error(`❌ 無法刪除 ${DB_PATH}：檔案可能被其他程式鎖定（請先關閉開發伺服器）。`);
      console.error(`   ${err.message}`);
      process.exit(1);
    }
    console.error(`❌ 無法刪除 ${DB_PATH}:`, err.message);
    process.exit(1);
  }
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ 建立新資料庫失敗:', err.message);
    process.exit(1);
  }
});

// 依序執行每個語句（先建表插資料，再處理 sqlite_sequence）
let idx = 0;
const runNext = () => {
  if (idx >= statements.length) {
    db.close(() => {
      console.log('\n✅ 匯入完成！資料庫已從快照重建。');
      console.log('   下一步：重新啟動開發伺服器（npm start）。');
      process.exit(0);
    });
    return;
  }
  const stmt = statements[idx];
  idx += 1;
  // 依序執行語句
  db.run(stmt, (err) => {
    if (err) {
      // sqlite_sequence 的 INSERT 需要該表存在；若 snapshot 無此表會失敗，視為非致命
      const isSeqTable = /INSERT INTO "sqlite_sequence"/i.test(stmt) || /DROP TABLE IF EXISTS "sqlite_sequence"/i.test(stmt);
      if (isSeqTable) {
        console.log(`  ⚠ 略過 sqlite_sequence 語句（新資料庫可能無此表）: ${err.message}`);
        runNext();
        return;
      }
      console.error(`❌ 執行 SQL 失敗: ${stmt.slice(0, 120)}...`);
      console.error(`   ${err.message}`);
      db.close();
      process.exit(1);
    }
    runNext();
  });
};

runNext();