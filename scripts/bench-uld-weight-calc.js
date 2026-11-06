// ===== ULD 夾重系統：計算效能量測（V4 決策用）=====
// 目的：量「單次 uldComputeSheet()」的耗時，決定要不要做「大表即時重算節流」（V4）。
// 判定基準（見 docs/design/uld-weight-remaining-work.md §1.1）：
//   大表（>50 板 × 10 票）單次計算 median < 16ms（一個 frame 內）→ **不要做**節流。
// 算法只有一份：本檔只呼叫 public/js/uldweight/calc.js，不含任何計算邏輯。
//
// 用法：
//   node scripts/bench-uld-weight-calc.js                 # 標準情境（10×3 / 20×5 / 50×10 / 50×10+上下限 / 50×10+手動% / 100×20）
//   node scripts/bench-uld-weight-calc.js --ulds=50 --tickets=10 --rounds=80
//   node scripts/bench-uld-weight-calc.js --clamp-min=5 --clamp-max=40 --squeeze=manual
// 參數：
//   --ulds=N        板數（預設標準情境；給了就只跑這一個情境）
//   --tickets=M     每板票數（預設 10）
//   --rounds=K      量測次數（預設 60；會先暖機 10 次）
//   --clamp-min=P   比例下限 %（預設 0＝不限）
//   --clamp-max=P   比例上限 %（預設 0＝不限）
//   --squeeze=MODE  weight | pcs | equal | manual（預設 weight）
//   --no-squeeze    最後一票不勾夾重（預設行為）；--all-squeeze 全部夾重
const path = require('path');
const { pathToFileURL } = require('url');
const { performance } = require('perf_hooks');

const CALC_URL = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'calc.js')).href;
const FRAME_BUDGET_MS = 16;

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(prefix));
  if (!hit) return fallback;
  const raw = hit.slice(prefix.length);
  const num = Number(raw);
  return Number.isFinite(num) && raw.trim() !== '' ? num : raw;
}

function flag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

// 產生測試資料：每板 ticketsPerUld 票、RCL 帶 +0.7% 磅差 → 夾重／取整／尾差都會真的跑
function makeSheet(uldCount, ticketsPerUld, option = {}) {
  const ulds = [];
  for (let u = 0; u < uldCount; u += 1) {
    const items = [];
    for (let t = 0; t < ticketsPerUld; t += 1) {
      items.push({
        id: u * 1000 + t + 1,
        mawb: `160-${String(10000000 + t).slice(0, 8)}`,
        port: ['HKG', 'TPE', 'LAX', 'AMS'][t % 4],
        lih_type: t % 5 === 0 ? 'UN3481' : 'N',
        pcs: 20 + t,
        declared_weight: 100 + t * 37,
        is_squeeze: option.allSqueeze ? true : t < ticketsPerUld - 1,
        squeeze_ratio: null
      });
    }
    const declared = items.reduce((sum, it) => sum + it.declared_weight, 0);
    ulds.push({
      uid: `u${u + 1}`,
      id: u + 1,
      kind: 'ULD',
      uld_number: `PMC${100000 + u}XX`,
      predecl_type: u % 3 === 0 ? 'P' : 'X',
      port: 'HKG',
      lih_type: u % 4 === 0 ? 'UN3481' : 'N',
      tare_weight: 115,
      rcl_gross_weight: Math.round(declared * 1.007) + 115,
      material_weight: 12,
      pcs: items.reduce((sum, it) => sum + it.pcs, 0),
      squeeze_mode: option.squeezeMode || 'weight',
      items
    });
  }
  return {
    round_px: 1,
    round_b: 1,
    tail_mode: 'adjust_largest',
    diff_warn_pct: 2,
    diff_warn_kg: 100,
    clamp_min_pct: option.clampMin || 0,
    clamp_max_pct: option.clampMax || 0,
    ulds
  };
}

function bench(calc, label, sheet, rounds) {
  for (let i = 0; i < 10; i += 1) calc.uldComputeSheet(sheet); // 暖機（JIT）
  const times = [];
  for (let i = 0; i < rounds; i += 1) {
    const t0 = performance.now();
    calc.uldComputeSheet(sheet);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const pick = p => times[Math.min(times.length - 1, Math.floor(times.length * p))];
  return {
    label,
    ulds: sheet.ulds.length,
    items: sheet.ulds.reduce((s, u) => s + u.items.length, 0),
    min: times[0],
    median: pick(0.5),
    p95: pick(0.95),
    max: times[times.length - 1],
    mean: times.reduce((a, b) => a + b, 0) / times.length
  };
}

function fmt(n) {
  return n.toFixed(3).padStart(7);
}

(async () => {
  const rounds = Math.max(5, Number(argValue('rounds', 60)) || 60);
  const uldArg = argValue('ulds', null);
  const tickets = Number(argValue('tickets', 10)) || 10;
  const option = {
    clampMin: Number(argValue('clamp-min', 0)) || 0,
    clampMax: Number(argValue('clamp-max', 0)) || 0,
    squeezeMode: String(argValue('squeeze', 'weight')),
    allSqueeze: flag('all-squeeze')
  };

  const calc = await import(CALC_URL);
  console.log('===== ULD 夾重系統：計算效能量測（V4 決策用）=====');
  console.log(`Node ${process.version} / rounds=${rounds}（暖機 10 次）/ 判定基準：median < ${FRAME_BUDGET_MS}ms → 不需節流\n`);

  const cases = [];
  if (uldArg != null) {
    cases.push(bench(calc, `${uldArg} 板 × ${tickets} 票（自訂）`, makeSheet(Number(uldArg), tickets, option), rounds));
  } else {
    cases.push(bench(calc, '10 板 × 3 票', makeSheet(10, 3), rounds));
    cases.push(bench(calc, '20 板 × 5 票', makeSheet(20, 5), rounds));
    cases.push(bench(calc, '50 板 × 10 票（門檻情境）', makeSheet(50, 10), rounds));
    cases.push(bench(calc, '50 板 × 10 票 + 上下限 5~40%', makeSheet(50, 10, { clampMin: 5, clampMax: 40 }), rounds));
    cases.push(bench(calc, '50 板 × 10 票 + 手動 %', makeSheet(50, 10, { squeezeMode: 'manual' }), rounds));
    cases.push(bench(calc, '100 板 × 20 票（極端）', makeSheet(100, 20), rounds));
  }

  console.log('情境                              單位 / 明細 |    min | median |    p95 |    max |   mean');
  console.log('-'.repeat(100));
  cases.forEach(c => {
    console.log(
      `${c.label.padEnd(30)} ${String(c.ulds).padStart(4)} / ${String(c.items).padStart(4)} |` +
      `${fmt(c.min)} |${fmt(c.median)} |${fmt(c.p95)} |${fmt(c.max)} |${fmt(c.mean)}`
    );
  });

  const worst = cases.reduce((a, b) => (b.median > a.median ? b : a), cases[0]);
  console.log('');
  if (worst.median < FRAME_BUDGET_MS) {
    console.log(`✅ 最慢情境「${worst.label}」median ${worst.median.toFixed(3)}ms < ${FRAME_BUDGET_MS}ms → 不需做 V4 節流（維持每次輸入整表重算）。`);
  } else {
    console.log(`⚠️ 最慢情境「${worst.label}」median ${worst.median.toFixed(3)}ms ≥ ${FRAME_BUDGET_MS}ms → 建議依 remaining-work §1.1 做輸入節流（rAF／30~60ms debounce）。`);
  }
  console.log('註：本工具只量 calc（純計算）；畫面上的 DOM 更新成本需用 Chrome DevTools Performance 實測。');
})().catch(err => {
  console.error('效能量測失敗：', err);
  process.exit(1);
});
