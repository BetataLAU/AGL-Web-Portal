// ===== 執 PLAN：DUMMY 資料（3 張 PLAN、共 20 票 MAWB ＋ 存貨）=====
// 用途：給同事試玩／示範（拖曳、右鍵、配艙建議、Excel 匯出）。
// 用法：
//   node scripts/seed-loading-plan-demo.js            # DB 已有 plan 會拒絕（安全）
//   node scripts/seed-loading-plan-demo.js --reset    # 清空 loading_plan_* 再灌
//   DB_PATH=/tmp/x.db node scripts/seed-loading-plan-demo.js   # 灌到暫存 DB
//
// 只會動 loading_plan_* 相關表；MAWB 主檔（mawb_records）缺的會補建。
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const CALC_URL = pathToFileURL(path.join(ROOT, 'public', 'js', 'loading-plan', 'calc.js')).href;
const RESET = process.argv.includes('--reset');

// MAWB 檢查碼：prefix(3) + 7 位 + (前 7 位 mod 7)
function mawb(prefix, seed) {
  const first7 = String(seed).padStart(7, '0').slice(-7);
  const check = Number(first7) % 7;
  const digits = `${prefix}${first7}${check}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)} ${digits.slice(7, 11)}`;
}

// 每筆：prefix / seed / client / dest / pkgs / gw / cbm / tag / receipt / remark / flags
const PLANS = [
  {
    day_code: 'D7', flight_no: 'EK9859', flight_date: '2026-11-14', etd: '22:35',
    owner_company: 'SKY DRAGON', contour_text: '1 X H3', contour_code: 'H3', contour_qty: 1,
    max_gross_weight: 9000, max_cbm: 65, sort_order: 0, status: 'draft', volume_view: 'vol',
    items: [
      [176, 6985524, 'MAERSK', 'DWC', '17+7P', 1560, 9.23, '1 / D7', '2026-11-14', '120*80*121/1, ETA 15 Nov前', { dg_no_power: 1 }],
      [176, 6839740, 'MAERSK', 'DWC', '8P', 1560, 9.23, '5 / CP / D2', '2026-11-13', '', {}],
      [176, 6989079, 'MAERSK', 'DWC', '8P', 1560, 9.23, '7 / WWP / D5', '2026-11-14', '', { h_xray: 1 }],
      [176, 6985528, 'MAERSK', 'DWC', '8P', 1302, 6.82, '4 / D6', '2026-11-14', '120*80*121/1, 29/1, ETA 15 Nov前', {}],
      [176, 6843063, 'RS', 'DWC', 'CTNS', 1000, 6, 'D3/11', '2026-11-10', 'RMB 40.5', { h_ctg: 1 }],
      [176, 6840064, 'MAERSK', 'DWC', '3+4P', 523, 2.34, '1 / D7', '2026-11-14', '', {}],
      [176, 6843069, 'Soaring', 'DWC', '4P', 298, 3.4, '直單', '2026-11-13', '92X80X210/2', {}]
    ]
  },
  {
    day_code: 'D6', flight_no: 'EK9845', flight_date: '2026-11-15', etd: '03:10',
    owner_company: 'SPACE', contour_text: '1 X Q5', contour_code: 'Q5', contour_qty: 1,
    max_gross_weight: 9000, max_cbm: 65, sort_order: 1, status: 'draft', volume_view: 'vol',
    items: [
      [176, 6985531, 'MAERSK', 'DXB', '17+7P', 1302, 6.82, '2 / D6', '2026-11-14', 'ETA 16 Nov前', { dg_967: 1 }],
      [176, 6839741, 'MAERSK', 'DWC', '8P', 1560, 9.23, '5 / D6', '2026-11-13', '', {}],
      [176, 6989080, 'MAERSK', 'DWC', '2P', 523, 2.34, '3 / D6', '2026-11-14', '', {}],
      [176, 6985532, 'RS', 'AMS', 'CTNS', 380, 1.74, 'D2/22', '2026-11-11', 'RMB 45.0', { h_fs: 1 }],
      [157, 3606932, 'TEMU', 'DXB', 'CTNS', 298, 3.4, 'BOOKING', '2026-11-12', '', {}],
      [157, 3606933, 'TEMU', 'DWC', 'CTNS', 220, 1.43, 'BOOKING', '2026-11-12', '', {}],
      [157, 3606934, 'Soaring', 'AMS', '1P', 118, 0.95, '3 / D6', '2026-11-13', '', {}]
    ]
  },
  {
    day_code: 'D5', flight_no: 'CX840', flight_date: '2026-11-16', etd: '01:05',
    owner_company: 'SKY DRAGON', contour_text: '1 X A2', contour_code: 'A2-00', contour_qty: 1,
    max_gross_weight: 8000, max_cbm: 55, sort_order: 2, status: 'draft', volume_view: 'vol',
    // 這一張刻意「超重」（8,542 / 8,000），用來示範紅色警示
    items: [
      [160, 6558749, 'MAERSK', 'LHR', '8P', 1560, 9.23, '1 / D5', '2026-11-14', '', {}],
      [160, 6558750, 'MAERSK', 'LHR', '8P', 1560, 9.23, '2 / D5', '2026-11-14', '', {}],
      [160, 6558751, 'MAERSK', 'AMS', '8P', 1560, 9.23, '3 / D5', '2026-11-14', '', { h_fs: 1 }],
      [160, 6558752, 'MAERSK', 'AMS', '8P', 1560, 9.23, '4 / D5', '2026-11-14', '', {}],
      [160, 6558753, 'RS', 'LHR', '4+1P', 1302, 6.82, 'D5/11', '2026-11-12', 'RMB 42.0', { dg_no_power: 1 }],
      [160, 6558754, 'TEMU', 'LHR', 'CTNS', 1000, 6, 'BOOKING', '2026-11-12', '', {}]
    ]
  }
];

// 存貨（給「配艙建議」試玩）
const STOCK = [
  [176, 6558481, 'MAERSK', 'DWC', '8P', 1560, 9.23, '2 / D1', '2026-11-11', '', {}],
  [176, 6843065, 'RS', 'AMS', 'CTNS', 1000, 6, 'D3/12', '2026-11-10', 'RMB 40.5', {}],
  [176, 6985073, 'MAERSK', 'DXB', '2P', 302, 3.09, '1 / D2', '2026-11-11', '', {}],
  [157, 3606935, 'Soaring', 'DXB', '4P', 298, 1.03, '3 / D2', '2026-11-11', '', {}],
  [157, 3606936, 'TEMU', 'DWC', '2+1P', 166, 1.11, 'BOOKING', '2026-11-12', '', {}],
  [160, 6558755, 'RS', 'AMS', 'CTNS', 129, 0.75, 'D4/18', '2026-11-12', 'RMB 45.0', { h_ctg: 1 }],
  [160, 6558756, 'Soaring', 'DWC', '1P', 85, 0.58, '直單', '2026-11-12', '', {}]
];

module.exports = { mawb, PLANS, STOCK };

// ===== 寫入 DB =====
async function seed() {
  const calc = await import(CALC_URL);
  const db = require('../db/database');
  await Promise.resolve(db.ready);

  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { return err ? reject(err) : resolve(this); });
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });

  const buildItem = (row) => {
    const [prefix, seedNo, client, dest, pkgs, gw, cbm, tag, receipt, remark, flags] = row;
    const parsed = calc.lpParsePkgs(pkgs);
    return Object.assign({
      mawb: mawb(prefix, seedNo),
      client, dest, tag: tag || '', remark: remark || '',
      pkgs_text: pkgs,
      cartons: parsed.cartons,
      pallets: parsed.pallets,
      pcs_total: parsed.pcsTotal,
      gross_weight: gw,
      cbm,
      volume_weight: calc.lpVolFromCbm(cbm),
      cuft: calc.lpCuftFromCbm(cbm),
      cargo_receipt: receipt || ''
    }, flags || {});
  };

  await run('BEGIN IMMEDIATE');
  try {
    // 先清掉「UI 開過頁面自動建立、但沒有任何明細」的存貨（不影響已有資料）
    await run("DELETE FROM loading_plans WHERE type = 'stock' AND id NOT IN (SELECT DISTINCT plan_id FROM loading_plan_items)");

    const count = await get('SELECT COUNT(*) AS n FROM loading_plans');
    if (!RESET && count && Number(count.n) > 0) {
      throw new Error('loading_plans 已有資料；如要覆蓋請加 --reset');
    }
    if (RESET) {
      await run('DELETE FROM loading_plan_items');
      await run('DELETE FROM loading_plan_events');
      await run('DELETE FROM loading_plan_presence');
      await run('DELETE FROM loading_plans');
    }

    const existing = await all('SELECT id, mawb FROM mawb_records');
    const recordIds = new Map();
    existing.forEach((row) => {
      const key = calc.lpNormalizeMawbKey(row.mawb);
      if (key && !recordIds.has(key)) recordIds.set(key, row.id);
    });
    const ensureRecord = async (item) => {
      const key = calc.lpNormalizeMawbKey(item.mawb);
      if (!key) return null;
      if (recordIds.has(key)) return recordIds.get(key);
      const res = await run(
        `INSERT INTO mawb_records (mawb, hawb, client, dest, pcs, gross_weight, volume_weight, cbm, spl, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
        [item.mawb, item.tag || '', item.client || '', item.dest || '', item.pcs_total || 0,
          item.gross_weight || 0, item.volume_weight || 0, item.cbm || 0, item.remark || '']
      );
      recordIds.set(key, res.lastID);
      return res.lastID;
    };

    const insertPlan = async (plan, seq, type) => {
      const planNo = type === 'stock'
        ? `LP-STOCK-${seq}`
        : `LP-${plan.day_code}-${String(plan.flight_no || 'NOFLT').replace(/[^A-Za-z0-9]/g, '')}-${String(seq).padStart(2, '0')}`;
      const res = await run(
        `INSERT INTO loading_plans
           (plan_no, type, day_code, flight_no, flight_date, etd, owner_company,
            contour_code, contour_text, contour_qty, contour_known, contour_dims,
            max_gross_weight, max_cbm, volume_view, status, sort_order, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        [planNo, type, plan.day_code, plan.flight_no || '', plan.flight_date || '', plan.etd || '',
          plan.owner_company || '', plan.contour_code || '', plan.contour_text || '', plan.contour_qty || 1,
          plan.max_gross_weight != null ? plan.max_gross_weight : null,
          plan.max_cbm != null ? plan.max_cbm : null,
          plan.volume_view || 'vol', plan.status || 'draft', plan.sort_order || seq]
      );
      return { id: res.lastID, planNo };
    };

    const insertItem = async (planId, item, sortOrder) => {
      const recordId = await ensureRecord(item);
      await run(
        `INSERT INTO loading_plan_items
           (plan_id, mawb_record_id, mawb, client, dest, tag, pkgs_text, cartons, pallets, pcs_total,
            gross_weight, volume_weight, volume_source, cbm, cuft, volume_input_unit, cargo_receipt, remark,
            dg_no_power, dg_966, dg_967, dg_969, dg_970, h_af, h_fs, h_sc, h_vol, h_ctg, h_xray,
            section, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calc', ?, ?, 'cbm', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)`,
        [planId, recordId, item.mawb, item.client || '', item.dest || '', item.tag || '',
          item.pkgs_text || '', item.cartons, item.pallets, item.pcs_total,
          item.gross_weight || 0, item.volume_weight || 0, item.cbm || 0, item.cuft || 0,
          item.cargo_receipt || '', item.remark || '',
          item.dg_no_power ? 1 : 0, item.dg_966 ? 1 : 0, item.dg_967 ? 1 : 0,
          item.dg_969 ? 1 : 0, item.dg_970 ? 1 : 0,
          item.h_af ? 1 : 0, item.h_fs ? 1 : 0, item.h_sc ? 1 : 0,
          item.h_vol ? 1 : 0, item.h_ctg ? 1 : 0, item.h_xray ? 1 : 0,
          sortOrder]
      );
    };

    const report = [];
    let seq = 0;
    for (const plan of PLANS) {
      seq += 1;
      const created = await insertPlan(plan, seq, 'flight');
      const items = plan.items.map(buildItem);
      for (let i = 0; i < items.length; i += 1) await insertItem(created.id, items[i], i);
      const totals = calc.lpKpi(items, { maxGrossWeight: plan.max_gross_weight, maxCbm: plan.max_cbm });
      report.push({
        planNo: created.planNo,
        label: calc.lpPlanLabel(plan),
        totals,
        tickets: items.length
      });
    }

    seq += 1;
    const stockCreated = await insertPlan(
      { day_code: 'STOCK', flight_no: '', owner_company: '', contour_code: '', contour_qty: 1, sort_order: 9999 },
      seq,
      'stock'
    );
    const stockItems = STOCK.map(buildItem);
    for (let i = 0; i < stockItems.length; i += 1) await insertItem(stockCreated.id, stockItems[i], i);
    const stockTotals = calc.lpKpi(stockItems);

    await run('COMMIT');

    console.log('✅ 已建立 DUMMY 資料：');
    report.forEach((row) => {
      const totals = row.totals;
      console.log(`  ${row.planNo.padEnd(18)} ${row.label}`);
      console.log(`    ${row.tickets} 票 ｜ ${totals.grossWeight.toFixed(2)} / ${totals.maxGrossWeight} kg（${totals.gwPct}%）`
        + ` ｜ ${totals.cbm.toFixed(2)} / ${totals.maxCbm} m³（${totals.cbmPct}%）`
        + (totals.overWeight ? `  ⛔ 超重 ${totals.overWeight} kg` : ''));
    });
    console.log(`  ${stockCreated.planNo.padEnd(18)} 存貨（未分配）`);
    console.log(`    ${stockItems.length} 票 ｜ ${stockTotals.grossWeight.toFixed(2)} kg ｜ ${stockTotals.cbm.toFixed(2)} m³`);
    return { report, stockTotals };
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    throw err;
  }
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ 建立 DUMMY 失敗：', err && err.message ? err.message : err);
      process.exit(1);
    });
}

