// ===== 執 PLAN：Excel 匯入（預設 dry-run，不寫 DB）=====
// 來源：Yat Loading Plan/AGL執PLAN.xlsx
//   DAY 1..DAY 7 / OTH → 每個區塊（FLIGHT NO. 表頭）建一張 flight plan
//   存貨               → 建一張 type='stock' 的虛擬 plan（未分配 pool）
// 規則（2026-11 與使用者確認）：
//   - 一票 MAWB 同時存在於「存貨」與航班 plan → 保留航班、從存貨移除
//   - 同一 MAWB 出現在 >1 個航班 plan → 保留第一筆，另一筆列 conflict 給人確認
//   - VOL 有原值就保留（Excel 是人手微調的），空白才由 CBM 回算
//
// 用法：
//   node scripts/import-loading-plan-xlsx.js                  # 只印報表
//   node scripts/import-loading-plan-xlsx.js --apply           # 寫入 DB
//   node scripts/import-loading-plan-xlsx.js --apply --reset   # 先清空 loading_plan_* 再寫
//   node scripts/import-loading-plan-xlsx.js --file=path.xlsx
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const CALC_URL = pathToFileURL(path.join(ROOT, 'public', 'js', 'loading-plan', 'calc.js')).href;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RESET = args.includes('--reset');
const FILE_ARG = args.find(a => a.startsWith('--file='));
const FILE = FILE_ARG
  ? path.resolve(ROOT, FILE_ARG.slice('--file='.length))
  : path.join(ROOT, 'Yat Loading Plan', 'AGL執PLAN.xlsx');

const FLIGHT_SHEETS = ['DAY 1', 'DAY 2', 'DAY 3', 'DAY 4', 'DAY 5', 'DAY 6', 'DAY 7', 'OTH'];
const STOCK_SHEET = '存貨';
const SKIP_SHEETS = ['Plan1', 'Plan2', 'DGS'];   // 模板／舊草稿／危險品分流表，不匯入
const BLOCK_ROWS = 12;                            // 每個區塊固定 12 列
const COL = {
  seq: 2, client: 3, mawb: 8, tag: 12, dest: 14, pkgs: 15,
  gw: 16, vol: 17, cbm: 18, receipt: 19, remark: 22,
  noPower: 30, dg966: 31, dg967: 32, dg969: 33, dg970: 34,
  af: 35, fs: 36, sc: 37, hvol: 38, ctg: 39, xray: 40
};

// ===== Excel 儲存格工具 =====
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(t => t.text || '').join('').trim();
    if (value.result !== undefined) return cellText(value.result);
    if (value.text !== undefined) return String(value.text).trim();
    return '';
  }
  return String(value).trim();
}

function cellRaw(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'object') {
    if (value.result !== undefined) return cellRaw(value.result);
    if (Array.isArray(value.richText)) return value.richText.map(t => t.text || '').join('').trim();
    if (value.text !== undefined) return String(value.text).trim();
    return null;
  }
  return value;
}

function cellNumber(value) {
  const raw = cellRaw(value);
  if (raw === null || raw === '') return 0;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function cellNumberOrNull(value) {
  const raw = cellRaw(value);
  if (raw === null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function cellFlag(value) {
  return cellText(value) ? 1 : 0;
}

// 'ETD:  ' + 可能有值 → 只留時間；抓不到就空字串
function parseEtdLabel(text) {
  return String(text || '').replace(/ETD\s*[:：]?/i, '').trim();
}

// 找出每個區塊的表頭列（C 欄 = FLIGHT NO.:）
// 注意：Excel 每個區塊的表頭佔「連續兩列」（合併儲存格），兩列的 C 欄都是 FLIGHT NO.:，
// 只取第一列；否則同一個區塊會被解析兩次（第二份資料列還會錯位）。
function findBlockHeaders(ws) {
  const rows = [];
  const max = Math.min(ws.rowCount || 0, 300);
  for (let r = 1; r <= max; r += 1) {
    const text = cellText(ws.getRow(r).getCell(3).value).replace(/\s+/g, '').toUpperCase();
    if (text !== 'FLIGHTNO.:') continue;
    if (rows.length && rows[rows.length - 1] === r - 1) continue;
    rows.push(r);
  }
  return rows;
}

let CALC = null;

// ===== Plan / 明細解析 =====
function parseItemRow(ws, rowNumber, section) {
  const row = ws.getRow(rowNumber);
  const mawbText = cellText(row.getCell(COL.mawb).value);
  const client = cellText(row.getCell(COL.client).value);
  const dest = cellText(row.getCell(COL.dest).value);
  const pkgsText = cellText(row.getCell(COL.pkgs).value);
  const gw = cellNumber(row.getCell(COL.gw).value);
  const cbm = cellNumber(row.getCell(COL.cbm).value);
  if (!mawbText && !dest && !pkgsText && !gw && !cbm) return null;

  const pkgs = CALC.lpParsePkgs(pkgsText);
  const volRaw = cellNumberOrNull(row.getCell(COL.vol).value);
  return {
    mawb: CALC.lpDisplayMawb(mawbText),
    client,
    dest,
    tag: cellText(row.getCell(COL.tag).value),
    pkgs_text: pkgsText,
    cartons: pkgs.cartons,
    pallets: pkgs.pallets,
    pcs_total: pkgs.pcsTotal,
    pkgs_incomplete: pkgs.incomplete,
    pkgs_hint: pkgs.unitHint,
    gross_weight: gw,
    volume_weight: volRaw,
    volume_source: volRaw === null ? 'calc' : 'excel',
    cbm,
    cargo_receipt: cellText(row.getCell(COL.receipt).value),
    remark: cellText(row.getCell(COL.remark).value),
    dg_no_power: cellFlag(row.getCell(COL.noPower).value),
    dg_966: cellFlag(row.getCell(COL.dg966).value),
    dg_967: cellFlag(row.getCell(COL.dg967).value),
    dg_969: cellFlag(row.getCell(COL.dg969).value),
    dg_970: cellFlag(row.getCell(COL.dg970).value),
    h_af: cellFlag(row.getCell(COL.af).value),
    h_fs: cellFlag(row.getCell(COL.fs).value),
    h_sc: cellFlag(row.getCell(COL.sc).value),
    h_vol: cellFlag(row.getCell(COL.hvol).value),
    h_ctg: cellFlag(row.getCell(COL.ctg).value),
    h_xray: cellFlag(row.getCell(COL.xray).value),
    section,
    source_row: rowNumber
  };
}

function parseFlightPlan(ws, sheetName, headerRow, sortOrder) {
  const head = ws.getRow(headerRow);
  const head2 = ws.getRow(headerRow + 1);
  // 表頭配置：E = 日碼（D7/D3）、H:J = FLIGHT NO.（EK9859）、K:L = ETD、O:R = CONTOUR、S:X = owner
  const dayCell = cellText(head.getCell(5).value);
  const flightNo = cellText(head.getCell(8).value) || cellText(head.getCell(9).value) || cellText(head.getCell(10).value);
  const etd = parseEtdLabel(cellText(head.getCell(11).value)) || parseEtdLabel(cellText(head.getCell(12).value));
  const contourText = cellText(head.getCell(15).value) || cellText(head.getCell(16).value);
  const contour = CALC.lpContourParse(contourText);
  const owner = cellText(head.getCell(19).value);
  const ownerAlt = cellText(head2.getCell(19).value);

  const items = [];
  for (let i = 0; i < BLOCK_ROWS; i += 1) {
    const item = parseItemRow(ws, headerRow + 4 + i, 1);
    if (item) {
      item.sort_order = items.length;
      items.push(item);
    }
  }

  const totalsRow = ws.getRow(headerRow + 16);
  return {
    key: `${sheetName}#${headerRow}`,
    type: 'flight',
    source_sheet: sheetName,
    day_code: dayCell || (sheetName === 'OTH' ? 'OTH' : sheetName.replace('DAY ', 'D')),
    flight_no: flightNo,
    flight_date: '',                 // Excel 的 ETD 欄是空白，由使用者事後補
    etd: etd || '',
    owner_company: owner || ownerAlt,
    owner_alt: owner && ownerAlt && owner !== ownerAlt ? ownerAlt : '',
    contour_text: contourText,
    contour_code: contour.code,
    contour_qty: contour.qty,
    excel_totals: {
      gw: cellNumberOrNull(totalsRow.getCell(COL.gw).value),
      vol: cellNumberOrNull(totalsRow.getCell(COL.vol).value),
      cbm: cellNumberOrNull(totalsRow.getCell(COL.cbm).value)
    },
    sort_order: sortOrder,
    items
  };
}

function parseStockPlan(ws, sortOrder) {
  const items = [];
  const last = Math.min(ws.rowCount || 0, 500);
  for (let r = 7; r <= last; r += 1) {
    const item = parseItemRow(ws, r, 1);
    if (item) {
      item.sort_order = items.length;
      items.push(item);
    }
  }
  return {
    key: STOCK_SHEET,
    type: 'stock',
    source_sheet: STOCK_SHEET,
    day_code: 'STOCK',
    flight_no: '',
    flight_date: '',
    etd: '',
    owner_company: '',
    owner_alt: '',
    contour_text: '',
    contour_code: '',
    contour_qty: 1,
    excel_totals: null,
    sort_order: sortOrder,
    items
  };
}

// ===== 去重（存貨 → 航班）＝ 一票只能在一處 =====
function collectPlacements(plans) {
  const map = new Map();
  plans.forEach((plan) => {
    plan.items.forEach((item) => {
      const key = CALC.lpNormalizeMawbKey(item.mawb);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ plan, item });
    });
  });
  return map;
}

function dedupeStock(stockPlan, flightPlacements) {
  const kept = [];
  const removed = [];
  stockPlan.items.forEach((item) => {
    const key = CALC.lpNormalizeMawbKey(item.mawb);
    if (key && flightPlacements.has(key)) removed.push(item);
    else kept.push(item);
  });
  stockPlan.items = kept;
  stockPlan.items.forEach((item, idx) => { item.sort_order = idx; });
  return removed;
}

// ===== 驗算（與 Excel 合計列比對）=====
// VOL：只要有任何一列是「Excel 沒填、由 CBM 回算」，就不跟 Excel 合計比
//（Excel 的 SUM 不含空白 VOL，硬比會出現假錯誤）
function verifyPlan(plan) {
  const totals = CALC.lpTotals(plan.items);
  const excel = plan.excel_totals;
  const checks = [];
  const volFromCbm = plan.items.filter(i => i.volume_source === 'calc' && i.cbm > 0).length;
  if (excel) {
    const cmp = (label, ours, theirs) => {
      if (theirs === null || theirs === undefined) return;
      checks.push({ label, ours, theirs, ok: Math.abs(ours - theirs) <= 0.011 });
    };
    cmp('G.W', totals.grossWeight, excel.gw);
    if (!volFromCbm) cmp('VOL', totals.vol, excel.vol);
    cmp('CBM', totals.cbm, excel.cbm);
  }
  return { totals, ok: checks.every(c => c.ok), checks, volFromCbm };
}

// ===== 報表 =====
const num = (v, digits = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(digits));
const pad = (v, width) => String(v === null || v === undefined ? '' : v).padEnd(width);

function printReport(plans, stockPlan, removed, conflicts) {
  console.log('\n' + '='.repeat(92));
  console.log(`執 PLAN 匯入${APPLY ? '' : '預檢（dry-run，不會寫入 DB）'}`);
  console.log(`來源：${path.relative(ROOT, FILE)}`);
  console.log('='.repeat(92));
  console.log(`${pad('Plan（Flight / Date / Owner）', 40)}${pad('票數', 6)}${pad('G.W', 10)}${pad('VOL', 11)}${pad('CBM', 9)}驗算`);

  let failed = 0;
  plans.forEach((plan) => {
    const { totals, ok, checks, volFromCbm } = verifyPlan(plan);
    if (!ok) failed += 1;
    const label = `${CALC.lpPlanLabel(plan)} (${plan.day_code})`;
    const mark = checks.length === 0 ? '—' : (ok ? '✅' : '❌');
    console.log(`${pad(label.length > 39 ? label.slice(0, 38) + '…' : label, 40)}${pad(totals.tickets, 6)}${pad(num(totals.grossWeight), 10)}${pad(num(totals.vol), 11)}${pad(num(totals.cbm, 3), 9)}${mark}`);
    if (!ok) {
      checks.filter(c => !c.ok).forEach((c) => {
        console.log(`    ↳ ${c.label}：系統 ${num(c.ours)} vs Excel ${num(c.theirs)}`);
      });
    }
    if (volFromCbm) {
      console.log(`    ↳ VOL 有 ${volFromCbm} 筆 Excel 未填、由 CBM 回算（不與 Excel 合計比對）`);
    }
    if (plan.owner_alt && plan.owner_alt !== 'SPACE') {
      console.log(`    ↳ owner 表頭有兩行：主要 «${plan.owner_company}»、第二行 «${plan.owner_alt}»（請確認哪個才是實際 owner）`);
    }
  });

  if (stockPlan) {
    const totals = CALC.lpTotals(stockPlan.items);
    console.log(`${pad('存貨（未分配 pool）', 40)}${pad(totals.tickets, 6)}${pad(num(totals.grossWeight), 10)}${pad(num(totals.vol), 11)}${pad(num(totals.cbm, 3), 9)}—`);
  }

  const allPlans = stockPlan ? [...plans, stockPlan] : plans;
  const missingMawb = allPlans.reduce((sum, p) => sum + p.items.filter(i => !i.mawb).length, 0);
  const pkgsIncomplete = allPlans.reduce((sum, p) => sum + p.items.filter(i => i.pkgs_incomplete).length, 0);
  const volCalc = allPlans.reduce((sum, p) => sum + p.items.filter(i => i.volume_source === 'calc' && i.cbm > 0).length, 0);
  const warnings = [];
  if (missingMawb) warnings.push(`缺 MAWB ${missingMawb} 筆（仍計入重量，UI 會標黃字）`);
  if (pkgsIncomplete) warnings.push(`件數未填 ${pkgsIncomplete} 筆（CTNS 等）`);
  if (volCalc) warnings.push(`VOL 由 CBM 回算 ${volCalc} 筆`);

  console.log('-'.repeat(92));
  if (stockPlan) {
    const withMawb = stockPlan.items.filter(i => i.mawb).length;
    const total = stockPlan.items.length + removed.length;
    console.log(`存貨 ${total} 筆 → 移除 ${removed.length}（已在航班 plan）→ 保留 ${stockPlan.items.length} 筆（有 MAWB ${withMawb} 筆、無 MAWB ${stockPlan.items.length - withMawb} 筆）`);
  }
  if (conflicts.length) {
    console.log(`重複 MAWB（跨航班 plan）：${conflicts.length} 筆（保留第一筆，其餘列為 conflict 待人工確認）`);
    conflicts.forEach(([key, list]) => {
      console.log(`  • ${key} → ${list.map(x => `${x.plan.source_sheet}:${x.item.source_row}`).join(', ')}`);
    });
  } else {
    console.log('重複 MAWB（跨航班 plan）：0 筆');
  }
  if (warnings.length) console.log(`警告：${warnings.join('、')}`);
  const nonEmptyPlans = plans.filter(p => p.items.length > 0).length;
  console.log(`FLIGHT DATE 未填：${nonEmptyPlans} 張有貨的 plan（Excel 的 ETD 欄是空白，匯入後請補）`);
  if (failed) console.log(`\n❌ 有 ${failed} 張 plan 與 Excel 合計不符，請先修正解析規則再 --apply`);
  console.log('='.repeat(92));
  return { failed };
}

// ===== 寫入 DB =====
function makePlanNo(plan, seq) {
  const n = String(seq || 1).padStart(2, '0');
  if (plan.type === 'stock') return `LP-STOCK-${n}`;
  const day = (plan.day_code || 'X').replace(/[^A-Za-z0-9]/g, '');
  const flight = (plan.flight_no || 'NOFLT').replace(/[^A-Za-z0-9]/g, '') || 'NOFLT';
  return `LP-${day}-${flight}-${n}`;
}

async function applyImport(plans, stockPlan) {
  const db = require('../db/database');
  await Promise.resolve(db.ready);
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { return err ? reject(err) : resolve(this); });
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
  const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });

  await run('BEGIN IMMEDIATE');
  try {
    if (RESET) {
      await run('DELETE FROM loading_plan_items');
      await run('DELETE FROM loading_plan_events');
      await run('DELETE FROM loading_plans');
    } else {
      const row = await get('SELECT COUNT(*) AS n FROM loading_plans');
      if (row && row.n > 0) throw new Error('loading_plans 已有資料；請加 --reset 重新匯入');
    }

    // 清掉「沒有任何明細」的存貨 plan（UI 開過頁面會自動建一張空的，避免匯入後有兩張存貨）
    await run('DELETE FROM loading_plans WHERE type = ? AND id NOT IN (SELECT DISTINCT plan_id FROM loading_plan_items)', ['stock']);

    const existing = await all('SELECT id, mawb FROM mawb_records');
    const recordIds = new Map();
    existing.forEach((r) => {
      const key = CALC.lpNormalizeMawbKey(r.mawb);
      if (key && !recordIds.has(key)) recordIds.set(key, r.id);
    });

    const ensureRecord = async (item) => {
      const key = CALC.lpNormalizeMawbKey(item.mawb);
      if (!key) return null;
      if (recordIds.has(key)) return recordIds.get(key);
      const vol = item.volume_weight === null ? CALC.lpVolFromCbm(item.cbm) : item.volume_weight;
      const res = await run(
        `INSERT INTO mawb_records (mawb, hawb, client, dest, pcs, gross_weight, volume_weight, cbm, spl, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
        [item.mawb, item.tag || '', item.client || '', item.dest || '', item.pcs_total || 0,
          item.gross_weight || 0, vol, item.cbm || 0, item.remark || '']
      );
      recordIds.set(key, res.lastID);
      return res.lastID;
    };

    const inserted = [];
    const queue = stockPlan ? [...plans, stockPlan] : plans;
    for (const plan of queue) {
      const planNo = makePlanNo(plan, inserted.length + 1);
      const planRes = await run(
        `INSERT INTO loading_plans
           (plan_no, type, day_code, flight_no, flight_date, etd, owner_company,
            contour_code, contour_text, contour_qty, contour_known, contour_dims,
            max_gross_weight, max_cbm, volume_view, status, sort_order, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'vol', 'draft', ?, 1, CURRENT_TIMESTAMP)`,
        [planNo, plan.type, plan.day_code, plan.flight_no || '', plan.flight_date || '', plan.etd || '',
          plan.owner_company || '', plan.contour_code || '', plan.contour_text || '',
          plan.contour_qty || 1, 0, plan.sort_order]
      );
      const planId = planRes.lastID;
      for (const item of plan.items) {
        const recordId = await ensureRecord(item);
        const vol = item.volume_weight === null ? CALC.lpVolFromCbm(item.cbm) : item.volume_weight;
        await run(
          `INSERT INTO loading_plan_items
             (plan_id, mawb_record_id, mawb, client, dest, tag, pkgs_text, cartons, pallets, pcs_total,
              gross_weight, volume_weight, volume_source, cbm, cuft, volume_input_unit, cargo_receipt, remark,
              dg_no_power, dg_966, dg_967, dg_969, dg_970,
              h_af, h_fs, h_sc, h_vol, h_ctg, h_xray, section, sort_order, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cbm', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [planId, recordId, item.mawb || '', item.client || '', item.dest || '', item.tag || '',
            item.pkgs_text || '', item.cartons, item.pallets, item.pcs_total,
            item.gross_weight || 0, vol, item.volume_source || 'calc', item.cbm || 0,
            CALC.lpCuftFromCbm(item.cbm), item.cargo_receipt || '', item.remark || '',
            item.dg_no_power || 0, item.dg_966 || 0, item.dg_967 || 0, item.dg_969 || 0, item.dg_970 || 0,
            item.h_af || 0, item.h_fs || 0, item.h_sc || 0, item.h_vol || 0, item.h_ctg || 0, item.h_xray || 0,
            item.section || 1, item.sort_order || 0]
        );
      }
      inserted.push({ planNo, planId, tickets: plan.items.length });
    }

    await run('COMMIT');
    return inserted;
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

// ===== 主流程 =====
(async () => {
  if (!fs.existsSync(FILE)) {
    console.error(`找不到檔案：${FILE}`);
    process.exit(1);
  }

  CALC = await import(CALC_URL);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(FILE);

  const plans = [];
  FLIGHT_SHEETS.forEach((sheetName) => {
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) return;
    findBlockHeaders(ws).forEach((headerRow) => {
      plans.push(parseFlightPlan(ws, sheetName, headerRow, plans.length));
    });
  });

  const stockWs = workbook.getWorksheet(STOCK_SHEET);
  const stockPlan = stockWs ? parseStockPlan(stockWs, plans.length) : null;

  // 存貨去重（不影響航班合計，先做才能報「保留幾筆」）
  const placements = collectPlacements(plans);
  const removed = stockPlan ? dedupeStock(stockPlan, placements) : [];
  const conflicts = [...placements.entries()].filter(([, list]) => list.length > 1);

  // 先驗算（此時航班資料仍與 Excel 一致）
  const report = printReport(plans, stockPlan, removed, conflicts);

  // 跨航班重複：保留第一處，其餘移除（會讓該 plan 與 Excel 合計不同，屬預期）
  const dropped = [];
  conflicts.forEach(([key, list]) => {
    list.slice(1).forEach(({ plan, item }) => {
      const idx = plan.items.indexOf(item);
      if (idx < 0) return;
      plan.items.splice(idx, 1);
      plan.items.forEach((it, i) => { it.sort_order = i; });
      dropped.push({ key, sheet: plan.source_sheet, row: item.source_row });
    });
  });
  if (dropped.length) {
    console.log(`已移除跨 plan 重複 ${dropped.length} 筆（保留第一處，該 plan 合計會略低於 Excel）：`);
    dropped.forEach(d => console.log(`  • ${d.key} ← ${d.sheet}:${d.row}`));
  }

  if (!APPLY) {
    console.log('\n（dry-run 完成；加 --apply 才會寫入 DB）');
    process.exitCode = report.failed ? 1 : 0;
    return;
  }
  if (report.failed) {
    console.error('\n驗算未通過，已中止寫入。');
    process.exit(1);
  }

  const importable = plans.filter(p => p.items.length > 0);
  const stockToWrite = stockPlan && stockPlan.items.length > 0 ? stockPlan : null;
  const inserted = await applyImport(importable, stockToWrite);
  const totalItems = inserted.reduce((n, p) => n + p.tickets, 0);
  console.log(`\n✅ 已寫入 ${inserted.length} 張 plan／${totalItems} 筆明細：`);
  inserted.forEach(p => console.log(`  • #${p.planId} ${p.planNo}（${p.tickets} 筆）`));
  process.exit(0);
})().catch((err) => {
  console.error('匯入失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});

