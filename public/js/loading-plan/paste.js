// ===== 執 PLAN：Excel（TSV）貼上／複製（純函式）=====
// 為什麼用 TSV：從 Excel 複製整區塊時，剪貼簿就是 tab 分隔；貼回 Excel 也一樣。
// 標題列會先嘗試「按名稱對欄」，認不出 ≥3 欄才退回固定順序（Agl 執PLAN 的欄位順序）。

export const LP_TSV_HEADERS = ['MAWB', 'CLIENT', 'DEST', 'PKGS', 'G.W', 'VOL', 'CBM', 'TAG', 'REMARK'];

// header 別名（大小寫、空格、標點都忽略）
const ALIASES = {
  mawb: ['mawb', 'mawbnumber', 'mawbno', 'masterawb', '主號'],
  client: ['client', 'shipper', 'customer', '客戶', '客人'],
  dest: ['dest', 'destination', '目的港', '目的地'],
  pkgs_text: ['pkgs', 'pkg', 'packages', '件數', '件'],
  gross_weight: ['gw', 'grossweight', 'grosswt', 'weight', '重量'],
  volume_weight: ['vol', 'volumeweight', 'volwt', '體積重'],
  cuft: ['cuft', 'cubicfeet', '立方英尺'],
  cbm: ['cbm', 'm3', '立方'],
  tag: ['tag', 'hawb', 'hawbno', '備註標籤', '標籤'],
  cargo_receipt: ['cargoreceipt', 'receipt', '收貨日期', '收貨'],
  remark: ['remark', 'remarks', '備註', '備註說明']
};

const POSITIONAL = ['client', 'mawb', 'tag', 'dest', 'pkgs_text', 'gross_weight', 'volume_weight', 'cbm', 'cargo_receipt', 'remark'];


function normalizeHeader(text) {
  return String(text || '').toLowerCase().replace(/[\s._#/()（）-]/g, '');
}

function detectField(cell) {
  const key = normalizeHeader(cell);
  if (!key) return null;
  return Object.keys(ALIASES).find(field => ALIASES[field].includes(key)) || null;
}

function splitLines(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim() !== '');
}

function toNumber(value) {
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/,/g, '').replace(/[^\d.+-]/g, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// 解析：回傳 { rows, mapping, headerUsed, skipped }
// rows 的欄位：mawb / client / dest / pkgs_text / gross_weight / cbm / volume_weight / cuft / tag / cargo_receipt / remark
export function lpParseTsv(text) {
  const lines = splitLines(text);
  if (!lines.length) return { rows: [], mapping: [], headerUsed: false, skipped: 0 };

  const first = lines[0].split('\t').map(cell => cell.trim());
  const detected = first.map(detectField);
  const headerUsed = detected.filter(Boolean).length >= 2;
  const mapping = headerUsed ? detected : POSITIONAL;
  const body = headerUsed ? lines.slice(1) : lines;

  const rows = [];
  let skipped = 0;
  body.forEach((line) => {
    const cells = line.split('\t');
    const row = {};
    mapping.forEach((field, index) => {
      if (!field) return;
      const raw = cells[index];
      if (raw === undefined) return;
      const value = String(raw).trim();
      if (value === '') return;
      if (field === 'gross_weight' || field === 'cbm' || field === 'volume_weight' || field === 'cuft') {
        const n = toNumber(value);
        if (n !== null) row[field] = n;
        return;
      }
      row[field] = value;
    });
    const hasData = ['mawb', 'client', 'dest', 'pkgs_text', 'cargo_receipt', 'remark']
      .some(field => row[field]) || row.gross_weight != null || row.cbm != null || row.cuft != null;
    if (!hasData) { skipped += 1; return; }
    rows.push(row);
  });

  return { rows, mapping, headerUsed, skipped };
}

// 產生 TSV（含標題列）→ 貼回 Excel；view = 'vol' | 'cuft'
export function lpBuildTsv(items, view = 'vol') {
  const headers = LP_TSV_HEADERS.slice();
  if (view === 'cuft') headers[5] = 'cu.ft';
  const lines = [headers.join('\t')];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const volume = item.volume || {};
    const vol = view === 'cuft' ? volume.cuft : volume.vol;
    lines.push([
      item.mawb || '',
      item.client || '',
      item.dest || '',
      item.pkgs_text || '',
      item.gross_weight != null ? item.gross_weight : '',
      vol != null ? vol : '',
      item.cbm != null ? item.cbm : '',
      item.tag || '',
      String(item.remark || '').replace(/[\t\r\n]+/g, ' ')
    ].join('\t'));
  });
  return lines.join('\n');
}
