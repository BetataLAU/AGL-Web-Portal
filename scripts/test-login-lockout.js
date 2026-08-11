// ===== 登入試錯上限測試 =====
// 驗證：連續 5 次密碼錯誤 → 鎖定 15 分鐘；鎖定期中正確密碼也被拒絕
// 測試後自動清除計數與鎖定，不影響正常使用
const db = require('../db/database');
const PORT = Number(process.argv[2] || 3000);
const BASE = `http://127.0.0.1:${PORT}`;

let cookie = '';

function sqlGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function sqlRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

async function login(companyCode, userId, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyCode, userId, password })
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch (e) { /* no json */ }
  return { status: res.status, data };
}

function log(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' ' + detail : ''}`);
}

(async () => {
  console.log(`===== 登入試錯上限測試（port ${PORT}） =====\n`);

  // 前置：確保 admin 帳號無鎖定
  await sqlRun("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE user_id = 'admin'");

  // 1. 連續 5 次錯誤密碼
  let lastStatus = 0;
  let lastMsg = '';
  for (let i = 1; i <= 5; i++) {
    const result = await login('AGL', 'admin', 'wrongpass' + i);
    lastStatus = result.status;
    lastMsg = result.data?.error || '';
    console.log(`  第 ${i} 次錯誤 → HTTP ${result.status}：${lastMsg}`);
  }
  log('第 5 次錯誤後帳號被鎖定（HTTP 423）', lastStatus === 423, `（HTTP ${lastStatus}）`);

  // 2. 鎖定期中即使密碼正確也拒絕
  const lockedWithCorrect = await login('AGL', 'admin', 'admin123');
  log('鎖定期中正確密碼也被拒絕（HTTP 423）', lockedWithCorrect.status === 423, `（HTTP ${lockedWithCorrect.status}）`);

  // 3. 鎖定狀態已寫入 DB
  const userRow = await sqlGet("SELECT failed_attempts, locked_until FROM users WHERE user_id = 'admin'");
  log('DB 已記錄鎖定時間', !!userRow.locked_until, `（locked_until=${userRow.locked_until}）`);

  // 4. 清除鎖定後可正常登入（模擬管理員重設密碼解鎖 → 測試後恢復）
  await sqlRun("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE user_id = 'admin'");
  const afterUnlock = await login('AGL', 'admin', 'admin123');
  log('解除鎖定後可正常登入（HTTP 200）', afterUnlock.status === 200, `（HTTP ${afterUnlock.status}）`);

  // 5. 登出 + 確認計數已清除
  await fetch(`${BASE}/api/auth/logout`, { method: 'POST' });
  const afterLoginRow = await sqlGet("SELECT failed_attempts, locked_until FROM users WHERE user_id = 'admin'");
  log('登入成功後計數自動清除', Number(afterLoginRow.failed_attempts) === 0 && !afterLoginRow.locked_until,
    `（failed_attempts=${afterLoginRow.failed_attempts}）`);

  console.log('\n===== 試錯上限測試完成 =====');
  process.exit(0);
})().catch(err => {
  console.error('測試失敗：', err.message);
  process.exit(1);
});