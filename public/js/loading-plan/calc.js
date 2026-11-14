// ===== 執 PLAN（Loading Plan）：計算核心（純函式，無 DOM 依賴）=====
// 前後端共用（比照 public/js/uldweight/calc.js）：
//   前端 import；後端 routes/loading-plan/* 以 dynamic import() 載入同一支重算，
//   確保「畫面算的」與「存進資料庫的」永遠一致。
//
// 核心規則（2026-11 與使用者確認）：
//   VOL（體積重 kg） = CBM ÷ 0.006         ｜ CBM = VOL × 0.006
//   cu.ft            = CBM ÷ 0.028316846592 ｜ CBM = cu.ft × 0.028316846592
//   PKGS：P = Pallet、C/CTNS = Carton；pcs_total = cartons + pallets
//   合計一律「逐列四捨五入後再加總」，不可用總量回算（與 Excel 的 SUM 行為一致）

// ===== 常數（UI 與後端驗證共用）=====
export const LP_VOL_DIVISOR = 0.006;            // 1 kg 體積重 = 0.006 m³
export const LP_CBM_PER_CUFT = 0.028316846592;  // 1 cu.ft = 0.028316846592 m³

export const LP_VOLUME_UNITS = ['cbm', 'cuft', 'vol'];

export const LP_VOLUME_VIEWS = [
  { code: 'vol', label: 'VOL / CBM' },
  { code: 'cuft', label: 'cu.ft / CBM' }
];

// 各單位的顯示小數位
export const LP_UNIT_DIGITS = { cbm: 3, cuft: 2, vol: 2 };

// ===== 數值工具 =====
export function lpNum(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

// 有「明確數值」才算（null / undefined / '' 不算 0）——件數未填的判斷要用
export function lpHasNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(String(value).replace(/,/g, '').trim()));
}

export function lpNumOrNull(value) {
  return lpHasNumber(value) ? lpNum(value) : null;
}

export function lpRound(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const d = Math.max(0, Math.min(6, digits));
  const factor = Math.pow(10, d);
  return Math.round((n + (n >= 0 ? 1 : -1) * Number.EPSILON) * factor) / factor;
}

// ===== 體積／重量換算 =====
export function lpVolFromCbm(cbm) {
  return lpRound(lpNum(cbm) / LP_VOL_DIVISOR, LP_UNIT_DIGITS.vol);
}

export function lpCbmFromVol(volKg) {
  return lpRound(lpNum(volKg) * LP_VOL_DIVISOR, LP_UNIT_DIGITS.cbm);
}

export function lpCuftFromCbm(cbm) {
  return lpRound(lpNum(cbm) / LP_CBM_PER_CUFT, LP_UNIT_DIGITS.cuft);
}

export function lpCbmFromCuft(cuft) {
  return lpRound(lpNum(cuft) * LP_CBM_PER_CUFT, LP_UNIT_DIGITS.cbm);
}

// 單位換算：from / to 皆為 'cbm' | 'cuft' | 'vol'
// 一律先換成 CBM 再換目標單位；同單位只做四捨五入（避免來回換算漂移）
export function lpConvertVolume(value, from = 'cbm', to = 'cbm') {
  const src = LP_VOLUME_UNITS.includes(from) ? from : 'cbm';
  const dst = LP_VOLUME_UNITS.includes(to) ? to : 'cbm';
  const n = lpNum(value);
  let cbm;
  if (src === 'cbm') cbm = n;
  else if (src === 'cuft') cbm = n * LP_CBM_PER_CUFT;
  else cbm = n * LP_VOL_DIVISOR;
  if (dst === 'cbm') return lpRound(cbm, LP_UNIT_DIGITS.cbm);
  if (dst === 'cuft') return lpRound(cbm / LP_CBM_PER_CUFT, LP_UNIT_DIGITS.cuft);
  return lpRound(cbm / LP_VOL_DIVISOR, LP_UNIT_DIGITS.vol);
}

// 一列明細的三種體積表示（cbm 為真相；VOL 有原值就保留原值）
export function lpItemVolume(item) {
  const src = item || {};
  const cbm = lpRound(lpNum(src.cbm), LP_UNIT_DIGITS.cbm);
  const hasVol = lpHasNumber(src.volume_weight);
  const vol = hasVol
    ? lpRound(lpNum(src.volume_weight), LP_UNIT_DIGITS.vol)
    : lpVolFromCbm(cbm);
  return { cbm, vol, cuft: lpCuftFromCbm(cbm), volFromCbm: !hasVol };
}


// ===== PKGS 解析（P = Pallet、C/CTNS = Carton）=====
const CARTON_UNITS = ['', 'C', 'CTN', 'CTNS', 'CARTON', 'CARTONS', 'PKG', 'PKGS'];
const PALLET_UNITS = ['P', 'PLT', 'PLTS', 'PALLET', 'PALLETS'];

export function lpParsePkgs(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  const result = {
    text,
    cartons: null,
    pallets: null,
    pcsTotal: null,
    unknownUnits: [],
    unitHint: '',
    incomplete: false
  };
  if (!text || text === '-' || text === '—') {
    result.incomplete = true;
    return result;
  }

  const re = /(\d+(?:\.\d+)?)\s*([A-Za-z]*)/g;
  let cartons = 0;
  let pallets = 0;
  let matched = false;
  let m;
  while ((m = re.exec(text)) !== null) {
    const amount = Number(m[1]);
    if (!Number.isFinite(amount)) continue;
    matched = true;
    const unit = String(m[2] || '').toUpperCase();
    if (CARTON_UNITS.includes(unit)) cartons += amount;
    else if (PALLET_UNITS.includes(unit)) pallets += amount;
    else result.unknownUnits.push(`${m[1]}${m[2]}`);
  }

  if (!matched) {
    result.unitHint = text;
    result.unknownUnits = [text];
    result.incomplete = true;
    return result;
  }

  result.cartons = cartons;
  result.pallets = pallets;
  result.pcsTotal = cartons + pallets;
  result.incomplete = result.unknownUnits.length > 0 || result.pcsTotal === 0;
  return result;
}

// ===== Plan 識別名：Flight# / Flight Date + Owner =====
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// 'YYYY-MM-DD' / 'YYYY/MM/DD' / ISO → '14NOV'；無法解析就原樣回傳（空白 → '—'）
export function lpFlightDateLabel(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) return '—';
  const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return raw;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return raw;
  return `${String(day).padStart(2, '0')}${MONTHS[month - 1]}`;
}

export function lpPlanLabel(plan) {
  const p = plan || {};
  const flight = String(p.flight_no || '').trim() || String(p.day_code || '').trim() || '—';
  const date = lpFlightDateLabel(p.flight_date);
  const owner = String(p.owner_company || '').trim() || '—';
  return `${flight} / ${date} / ${owner}`;
}

// ===== Contour 解析（1 X H3 / 2 x Q5-00 / H3）=====
// Excel 的表頭常有雜訊（`1 X Q5 '新BSA`、`1 X Q5 / /半板`、`CO-LOAD`），
// 因此先找 `數字 X 代碼`，再找「有字母＋數字」的 token；都沒有就回空代碼（只保留原文）。
export function lpContourParse(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return { text: '', qty: 1, code: '' };

  const prefixed = text.match(/^(\d+)\s*[xX×]\s*([A-Za-z0-9-]+)$/);
  if (prefixed) {
    return { text, qty: Math.max(1, Number(prefixed[1]) || 1), code: prefixed[2].toUpperCase() };
  }
  const suffixed = text.match(/^([A-Za-z0-9-]+)\s*[xX×]\s*(\d+)$/);
  if (suffixed) {
    return { text, qty: Math.max(1, Number(suffixed[2]) || 1), code: suffixed[1].toUpperCase() };
  }
  const anywhere = text.match(/(\d+)\s*[xX×]\s*([A-Za-z0-9-]+)/);
  if (anywhere) {
    return { text, qty: Math.max(1, Number(anywhere[1]) || 1), code: anywhere[2].toUpperCase() };
  }
  const token = text.match(/\b([A-Za-z]{1,3}\d{1,2}(?:-\d{2})?)\b/);
  if (token) return { text, qty: 1, code: token[1].toUpperCase() };
  return { text, qty: 1, code: '' };
}

// 把 Excel 的短碼對到規格庫的完整碼（需傳入規格庫代碼清單，例如 LOADSIM_ULD_SPECS.map(s => s.code)）
// 規則：原碼有就直接用；否則試 '<碼>-00'；都沒有 → known = false（UI 顯示「未收錄」TAG）
export function lpResolveContourCode(code, knownCodes = []) {
  const raw = String(code === null || code === undefined ? '' : code).trim().toUpperCase();
  const list = Array.isArray(knownCodes) ? knownCodes : [];
  if (!raw) return { code: '', known: false };
  if (list.includes(raw)) return { code: raw, known: true };
  const padded = `${raw}-00`;
  if (list.includes(padded)) return { code: padded, known: true };
  return { code: raw, known: false };
}

// Plan 容量依「板數」放大（2 X H3-00 → 上限 ×2）
export function lpScaleCapacity(value, qty) {
  const base = lpNumOrNull(value);
  if (base === null) return null;
  const n = Math.max(1, Math.floor(lpNum(qty) || 1));
  return lpRound(base * n, 3);
}

// ===== 明細合計（逐列四捨五入再加總）=====
export function lpTotals(items) {
  const list = Array.isArray(items) ? items : [];
  const totals = {
    tickets: 0,
    grossWeight: 0,
    cbm: 0,
    vol: 0,
    cuft: 0,
    pcs: 0,
    cartons: 0,
    pallets: 0,
    pcsIncomplete: 0,
    volCalculated: 0,
    missingMawb: 0
  };

  list.forEach((raw) => {
    const item = raw || {};
    totals.tickets += 1;
    totals.grossWeight += lpRound(lpNum(item.gross_weight), 2);

    const volume = lpItemVolume(item);
    totals.cbm += volume.cbm;
    totals.vol += volume.vol;
    totals.cuft += volume.cuft;
    if (volume.volFromCbm) totals.volCalculated += 1;

    if (lpHasNumber(item.pcs_total)) {
      totals.pcs += lpNum(item.pcs_total);
      totals.cartons += lpNum(item.cartons);
      totals.pallets += lpNum(item.pallets);
    } else {
      totals.pcsIncomplete += 1;
    }

    if (!lpNormalizeMawbKey(item.mawb)) totals.missingMawb += 1;
  });

  totals.grossWeight = lpRound(totals.grossWeight, 2);
  totals.cbm = lpRound(totals.cbm, 3);
  totals.vol = lpRound(totals.vol, 2);
  totals.cuft = lpRound(totals.cuft, 2);
  return totals;
}

// ===== KPI（含上限檢核）=====
export function lpKpi(items, limits = {}) {
  const totals = lpTotals(items);
  const maxGw = lpNumOrNull(limits.maxGrossWeight);
  const maxCbm = lpNumOrNull(limits.maxCbm);
  return {
    ...totals,
    maxGrossWeight: maxGw,
    maxCbm,
    gwPct: maxGw ? lpRound((totals.grossWeight / maxGw) * 100, 1) : null,
    cbmPct: maxCbm ? lpRound((totals.cbm / maxCbm) * 100, 1) : null,
    overWeight: maxGw ? Math.max(0, lpRound(totals.grossWeight - maxGw, 2)) : 0,
    overCbm: maxCbm ? Math.max(0, lpRound(totals.cbm - maxCbm, 3)) : 0
  };
}

// ===== MAWB 正規化（去重／比對用）=====
export function lpNormalizeMawbKey(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase();
}

// 顯示用：保留原始格式，空白／'-' 視為未填
export function lpDisplayMawb(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw || raw === '-') return '';
  return raw;
}
