// ===== 驗證 db:import 後的資料庫完整性 =====
const db = require('../db/database');

function count(table) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) AS c FROM ${table}`, (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.c : 0);
    });
  });
}

function getUser() {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT u.user_id, u.role, c.company_code, c.name AS company_name
       FROM users u LEFT JOIN companies c ON c.id = u.company_id`,
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
}

(async () => {
  console.log('===== 資料庫還原驗證 =====');
  console.log(`- users 表：${await count('users')} 筆`);
  console.log(`- companies 表：${await count('companies')} 筆`);
  console.log(`- orders 表：${await count('orders')} 筆`);
  console.log(`- note_templates 表：${await count('note_templates')} 筆`);
  console.log(`- skills 表：${await count('skills')} 筆`);

  const user = await getUser();
  console.log(`- 登入帳號：${user ? JSON.stringify(user) : '(無)'}`);

  console.log('===== 驗證完成 =====');
  process.exit(0);
})().catch(err => {
  console.error('驗證失敗：', err.message);
  process.exit(1);
});