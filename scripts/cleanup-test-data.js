// ===== 清理登入系統測試資料 =====
// 移除測試客戶公司（TSTC1/TSTC2）、測試訂單（TST-*）與測試帳號
const db = require('../db/database');

function sqlRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

(async () => {
  console.log('===== 清理測試資料 =====');

  // 1. 刪除測試訂單（TST- 開頭）
  const orderDel = await sqlRun("DELETE FROM orders WHERE order_no LIKE 'TST-%'");
  console.log(`- 已刪除測試訂單：${orderDel} 筆`);

  // 2. 刪除測試客戶公司（TSTC1/TSTC2）與其使用者
  const c1 = await sqlRun("DELETE FROM users WHERE user_id IN ('cust1','cust2')");
  console.log(`- 已刪除測試使用者：${c1} 個`);

  const c2 = await sqlRun("DELETE FROM companies WHERE company_code IN ('TSTC1','TSTC2')");
  console.log(`- 已刪除測試公司：${c2} 間`);

  console.log('===== 清理完成 =====');
  process.exit(0);
})().catch(err => {
  console.error('清理失敗：', err.message);
  process.exit(1);
});