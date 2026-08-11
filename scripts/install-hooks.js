// ===== install-hooks.js =====
// 安裝 git hooks：pre-commit（自動匯出 DB 快照）與 pre-push（快照同步保險）
// 執行方式：node scripts/install-hooks.js
// 也可由 server.js 啟動時自動呼叫（換電腦免手動安裝）
const fs = require('fs');
const path = require('path');

const HOOKS_DIR = path.resolve(__dirname, '..', '.git', 'hooks');

const PRE_COMMIT = `#!/bin/sh
# AGL-Web-Portal: auto DB snapshot sync (installed by scripts/install-hooks.js)
echo "[pre-commit] 同步 DB 快照..."
node scripts/db-export.js
if [ $? -ne 0 ]; then
  echo "[pre-commit] ✘ 快照匯出失敗，中止 commit"
  exit 1
fi
git add db/db-dump.sql
exit 0
`;

const PRE_PUSH = `#!/bin/sh
# AGL-Web-Portal: pre-push DB sync guard (installed by scripts/install-hooks.js)
echo "[pre-push] 檢查 DB 快照..."
node scripts/db-export.js
if [ $? -ne 0 ]; then
  echo "[pre-push] ✘ 快照匯出失敗，中止 push"
  exit 1
fi
if git diff --quiet db/db-dump.sql; then
  exit 0
else
  git add db/db-dump.sql
  echo "[pre-push] ⚠ DB 快照已更新但尚未 commit，本次 push 已取消。請執行："
  echo "    git commit -m \"chore: sync db snapshot\""
  echo "    git push"
  exit 1
fi
`;

function installHook(name, content) {
  const filePath = path.join(HOOKS_DIR, name);
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === content) {
      console.log(`↷ ${name}: 已是最新版本，跳過`);
      return;
    }
  }
  fs.writeFileSync(filePath, content, 'utf8');
  try { fs.chmodSync(filePath, 0o755); } catch (e) { /* Windows 無副作用 */ }
  console.log(`✔ 已安裝 hook: ${filePath}`);
}

if (!fs.existsSync(HOOKS_DIR)) {
  console.error('❌ 找不到 .git/hooks 目錄（這不是一個 git repository？）');
  process.exit(1);
}

installHook('pre-commit', PRE_COMMIT);
installHook('pre-push', PRE_PUSH);
console.log('\n✅ Git hooks 就緒：');
console.log('   - pre-commit: 每次 commit 前自動匯出最新 DB 快照並加入 commit');
console.log('   - pre-push:   檢查快照是否落後，落後時提示先 commit');