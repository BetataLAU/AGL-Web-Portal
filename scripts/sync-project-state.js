#!/usr/bin/env node
/**
 * 專案狀態同步引擎（自動化地圖維護）
 *
 * 用法：npm run sync
 *
 * 功能：
 * 1. 掃描專案 → 更新 FILE_INVENTORY.md（檔案清單，永遠新鮮）
 * 2. 計算結構快照 → 與上次比較，輸出「新增/修改/刪除」檔案，提醒地圖更新
 * 3. 檢查 CLAUDE.md / PROJECT_MAP.md 是否仍然有效
 *
 * 設計目的：
 * - 每次新對話開頭執行一次，AI 立刻知道專案結構有沒有變
 * - 任務中改過結構，完成時執行一次，地圖自然跟上
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_INVENTORY = path.join(ROOT, 'FILE_INVENTORY.md');
const SNAPSHOT_FILE = path.join(ROOT, '.project-state.json');

// ===== 排除規則（與 .clineignore 同步） =====
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'logs',
  'tmp',
  'temp',
  'public/image',
  'public/fonts',
]);
const EXCLUDE_FILES = new Set([
  'package-lock.json',
  'database.db',
  'server_start.log',
  '.DS_Store',
  'Thumbs.db',
  path.basename(SNAPSHOT_FILE), // '.project-state.json'（快照本身不納入比較）
  'FILE_INVENTORY.md',
]);
const EXCLUDE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.ico', '.svg', '.woff', '.woff2', '.ttf',
  '.db', '.sqlite', '.sqlite3', '.log',
]);

function shouldSkip(filePath) {
  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  if (EXCLUDE_EXT.has(ext)) return true;
  if (EXCLUDE_FILES.has(name)) return true;
  return false;
}

// ===== 遞迴掃描：收集檔案 + mtime + hash =====
function collectFiles(dir, prefix = '') {
  const results = {};
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (EXCLUDE_DIRS.has(relPath)) continue;
    if (shouldSkip(fullPath)) continue;

    if (entry.isDirectory()) {
      Object.assign(results, collectFiles(fullPath, relPath));
    } else if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath);
      results[relPath] = {
        size: stat.size,
        mtime: stat.mtimeMs,
        hash: crypto.createHash('md5').update(content).digest('hex').slice(0, 8),
      };
    }
  }
  return results;
}

// ===== 讀取上次快照 =====
function loadSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// ===== 比較快照，輸出變更 =====
function diffSnapshots(prev, curr) {
  const changes = { added: [], removed: [], modified: [] };
  if (!prev) return changes;

  for (const file of Object.keys(curr)) {
    if (!prev[file]) changes.added.push(file);
    else if (prev[file].hash !== curr[file].hash) changes.modified.push(file);
  }
  for (const file of Object.keys(prev)) {
    if (!curr[file]) changes.removed.push(file);
  }
  return changes;
}

// ===== 產生 Markdown =====
function buildInventoryMarkdown(files) {
  const sorted = Object.keys(files).sort();
  const groups = new Map();
  for (const f of sorted) {
    const idx = f.lastIndexOf('/');
    const dir = idx === -1 ? '(根目錄)' : f.slice(0, idx);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(f);
  }

  let md = `# FILE_INVENTORY — 專案檔案清單（自動產生）

> ⚠️ 本檔案由 \`scripts/sync-project-state.js\` 自動產生，**請勿手動編輯**。
> 更新方式：執行 \`npm run sync\`。
> 最後更新：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}

`;

  // Git 變更狀態
  try {
    const execSync = require('child_process').execSync;
    const status = execSync('git status --short', { cwd: ROOT, encoding: 'utf8' });
    const lines = status.split('\n').filter(Boolean).map((l) => l.trim());
    if (lines.length) {
      md += `## 🔄 Git 變更狀態\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n\n`;
    }
  } catch { /* 非 git repo 略過 */ }

  md += `## 📁 檔案清單（共 ${sorted.length} 個檔案）\n\n`;

  for (const [dir, dirFiles] of [...groups.entries()].sort()) {
    md += `### ${dir}\n\n`;
    for (const f of dirFiles) {
      const stat = files[f];
      const size = stat.size < 1024
        ? `${stat.size} B`
        : `${(stat.size / 1024).toFixed(1)} KB`;
      md += `- \`${f}\`（${size}）\n`;
    }
    md += '\n';
  }
  return md;
}

// ===== 主流程 =====
const files = collectFiles(ROOT);
const prev = loadSnapshot();
const changes = diffSnapshots(prev, files);

// 儲存新快照
fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(files, null, 2), 'utf8');

// 寫入 FILE_INVENTORY
fs.writeFileSync(OUTPUT_INVENTORY, buildInventoryMarkdown(files), 'utf8');

// 輸出結果
console.log(`✔ FILE_INVENTORY.md 已更新（${Object.keys(files).length} 個檔案）`);

const total = changes.added.length + changes.removed.length + changes.modified.length;
if (total > 0) {
  console.log(`\n⚠ 自上次同步以來，有 ${total} 個檔案結構變更：`);
  if (changes.added.length) {
    console.log(`\n  ➕ 新增 (${changes.added.length}):`);
    changes.added.forEach((f) => console.log(`     ${f}`));
  }
  if (changes.modified.length) {
    console.log(`\n  ✏️  修改 (${changes.modified.length}):`);
    changes.modified.forEach((f) => console.log(`     ${f}`));
  }
  if (changes.removed.length) {
    console.log(`\n  ➖ 刪除 (${changes.removed.length}):`);
    changes.removed.forEach((f) => console.log(`     ${f}`));
  }
  console.log('\n→ 若涉及「職責描述」，請同步更新 CLAUDE.md 與 PROJECT_MAP.md。');
} else {
  console.log('✔ 結構無變更，地圖仍然新鮮。');
  console.log('  若剛完成功能開發，請更新 WORKSPACE_STATE.md 的工作狀態。');
}