// ===== 驗證 DUMMY 訂單資料 =====
// 執行方式：node scripts/verify-dummy-orders.js
const db = require('../db/database');

db.serialize(() => {
  // 公司數量
  db.get('SELECT COUNT(*) AS c FROM companies', (e, r) => {
    if (e) { console.error('查詢公司失敗:', e.message); process.exit(1); }
    console.log('公司總數:', r.c);

    // 新建立的公司（id >= 6）
    db.all('SELECT id, category, name FROM companies WHERE id >= 6 ORDER BY id', (e2, rows2) => {
      if (e2) { console.error('查詢新公司失敗:', e2.message); process.exit(1); }
      console.log('新建立公司數:', rows2.length);
      rows2.forEach(x => console.log(`  id=${x.id} [${x.category}] ${x.name}`));

      // 訂單總數
      db.get('SELECT COUNT(*) AS c FROM orders', (e3, r3) => {
        if (e3) { console.error('查詢訂單失敗:', e3.message); process.exit(1); }
        console.log('\n訂單總數:', r3.c);

        // DUMMY 訂單 (id > 4)
        db.all('SELECT order_no, order_type, pickup_datetime, status FROM orders WHERE id > 4 ORDER BY order_no', (e4, rows4) => {
          if (e4) { console.error('查詢 DUMMY 訂單失敗:', e4.message); process.exit(1); }
          console.log('DUMMY 訂單數:', rows4.length);
          if (rows4.length) {
            console.log('訂單編號範圍:', rows4[0].order_no, '~', rows4[rows4.length - 1].order_no);
          }

          // 依 pickup 日期分佈
          db.all("SELECT substr(pickup_datetime,1,10) AS d, COUNT(*) AS c FROM orders WHERE id > 4 GROUP BY d ORDER BY d", (e5, dist) => {
            if (e5) { console.error('查詢日期分佈失敗:', e5.message); process.exit(1); }
            console.log('\nPickup 日期分佈:');
            dist.forEach(x => console.log(`  ${x.d}: ${x.c} 筆`));

            // 檢查範圍外（小於 08-05 或大於等於 08-16）
            db.all("SELECT COUNT(*) AS c FROM orders WHERE id > 4 AND (pickup_datetime < '2026-08-05' OR pickup_datetime >= '2026-08-16')", (e6, out) => {
              if (e6) { console.error('查詢範圍外訂單失敗:', e6.message); process.exit(1); }
              console.log('\n範圍外訂單（08-05 ~ 08-15 以外）:', out[0].c);

              // 訂單類型分佈
              db.all("SELECT order_type, COUNT(*) AS c FROM orders WHERE id > 4 GROUP BY order_type", (e7, types) => {
                if (e7) { console.error('查詢類型分佈失敗:', e7.message); process.exit(1); }
                console.log('\n訂單類型分佈:');
                types.forEach(t => console.log(`  ${t.order_type}: ${t.c} 筆`));

                // 狀態分佈
                db.all("SELECT status, COUNT(*) AS c FROM orders WHERE id > 4 GROUP BY status", (e8, statuses) => {
                  if (e8) { console.error('查詢狀態分佈失敗:', e8.message); process.exit(1); }
                  console.log('\n狀態分佈:');
                  statuses.forEach(s => console.log(`  ${s.status}: ${s.c} 筆`));

                  // 檢查是否有缺漏的 order_no 序號
                  const expected = [];
                  for (let i = 5; i <= rows4.length + 4; i++) {
                    expected.push(`AGL-20260805-${String(i).padStart(3, '0')}`);
                  }
                  const actual = rows4.map(r => r.order_no);
                  const missing = expected.filter(x => !actual.includes(x));
                  const extra = actual.filter(x => !expected.includes(x));
                  console.log('\n訂單號碼完整性:');
                  console.log('  缺少:', missing.length ? missing.join(', ') : '無');
                  console.log('  多餘:', extra.length ? extra.join(', ') : '無');

                  process.exit(0);
                });
              });
            });
          });
        });
      });
    });
  });
});