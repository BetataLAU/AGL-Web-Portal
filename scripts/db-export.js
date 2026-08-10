// ===== db-export.js =====
// 將 database.db 全部資料匯出為 SQL 快照（db/db-dump.sql）
// 執行方式：node scripts/db-export.js
// 用途：讓開發夥伴能透過 git 同步資料庫內容（二進位檔無法 merge）
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, '..', 'database.db');
const DUMP_PATH = path.resolve(__dirname, '..', 'db', 'db-dump.sql');

// 將 JS 值轉換為 SQL 字面值（處理字串跳脫 / NULL / 數字 / Buffer）
function sqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return 'NULL';
    return String(val);
  }
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (val instanceof Buffer) return `X'${val.toString('hex')}'`;
  const str = String(val);
  return `'${str.replace(/'/g, "''")}'`;
}

// 產生一筆 INSERT 語句
function sqlInsert(tableName, columns, row) {
  const colList = columns.map((c) => `"${c}"`).join(', ');
  const valList = columns.map((c) => sqlValue(row[c])).join(', ');
  return `INSERT INTO "${tableName}" (${colList}) VALUES (${valList});\n`;
}

console.log(`📦 讀取資料庫: ${DB_PATH}`);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('無法開啟資料庫:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  db.all(
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    (err, tables) => {
      if (err) {
        console.error('讀取資料表清單失敗:', err.message);
        db.close();
        process.exit(1);
      }
      if (!tables.length) {
        console.error('找不到任何資料表（資料庫尚未初始化？）');
        db.close();
        process.exit(1);
      }

      const lines = [];
      lines.push('-- ==============================================');
      lines.push('-- AGL-Web-Portal 資料庫快照');
      lines.push(`-- 匯出時間: ${new Date().toISOString()}`);
      lines.push(`-- 共 ${tables.length} 張資料表`);
      lines.push('-- 還原方式: npm run db:import');
      lines.push('-- ==============================================');
      lines.push('');

      let tableIndex = 0;

      const processTable = (t) => {
        const tableName = t.name;
        const createSql = (t.sql || '').trim().replace(/;?\s*$/, '') + ';';

        lines.push(`-- ===== 資料表: ${tableName} =====`);
        lines.push(`DROP TABLE IF EXISTS "${tableName}";`);
        lines.push(createSql);
        lines.push('');

        db.all(`PRAGMA table_info("${tableName}")`, [], (colErr, cols) => {
          if (colErr) {
            console.error(`讀取 ${tableName} 欄位失敗:`, colErr.message);
            db.close();
            process.exit(1);
          }
          const columns = cols.map((c) => c.name);
          if (!columns.length) {
            console.log(`  ⚠ ${tableName}: 無欄位，跳過`);
            tableIndex += 1;
            processNext();
            return;
          }

          db.all(`SELECT * FROM "${tableName}"`, [], (rowErr, rows) => {
            if (rowErr) {
              console.error(`讀取 ${tableName} 資料失敗:`, rowErr.message);
              db.close();
              process.exit(1);
            }
            if (rows.length) {
              for (const row of rows) {
                lines.push(sqlInsert(tableName, columns, row));
              }
            } else {
              lines.push('-- (無資料)');
            }
            lines.push('');
            console.log(`  ✔ ${tableName}: ${rows.length} 列`);
            tableIndex += 1;
            processNext();
          });
        });
      };

      const finish = () => {
        // 匯出 AUTOINCREMENT 計數器（sqlite_sequence），確保 id 不重疊
        db.all('SELECT name, seq FROM sqlite_sequence', (seqErr, seqRows) => {
          if (!seqErr && seqRows && seqRows.length) {
            lines.push('-- ===== sqlite_sequence (AUTOINCREMENT 計數器) =====');
            for (const r of seqRows) {
              lines.push(sqlInsert('sqlite_sequence', ['name', 'seq'], r));
            }
            lines.push('');
          }
          fs.writeFileSync(DUMP_PATH, lines.join('\n'), 'utf8');
          console.log(`\n✅ 匯出完成: ${DUMP_PATH}`);
          console.log('   接著請 commit 並 push 這個檔案，夥伴 pull 後執行 npm run db:import 即可同步資料。');
          db.close();
        });
      };

      const processNext = () => {
        if (tableIndex >= tables.length) {
          finish();
          return;
        }
        processTable(tables[tableIndex]);
      };

      processNext();
    }
  );
});