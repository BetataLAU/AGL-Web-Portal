const express = require('express');
const db = require('../../db/database');
const router = express.Router();
const { ORDER_NO_PREFIX } = require('./utils');

// 將舊版 ORD- 開頭的訂單編號轉為 AGL-（一次性資料遷移）
db.all("SELECT id, order_no FROM orders WHERE order_no LIKE 'ORD-%'", [], (err, rows) => {
  if (err) {
    console.error('訂單編號遷移查詢失敗:', err.message);
    return;
  }
  if (!rows || !rows.length) return;
  const stmt = db.prepare("UPDATE orders SET order_no = ? WHERE id = ?");
  rows.forEach(row => {
    const newNo = ORDER_NO_PREFIX + row.order_no.slice(4);
    stmt.run(newNo, row.id, (updateErr) => {
      if (updateErr) console.error(`訂單 ${row.id} 編號遷移失敗:`, updateErr.message);
    });
  });
  stmt.finalize();
  console.log(`已將 ${rows.length} 筆訂單編號由 ORD- 遷移至 AGL-`);
});

// 子模組路由（對外路徑保持不變）
router.use('/companies', require('./companies'));
router.use('/', require('./orders-router'));

module.exports = router;
