// ===== 執 PLAN：DIM（L × W × H / PCS）純函式 =====
// 一組一行，例：「60 x 40 x 50 / 10」；DIM 區塊上方固定有一行「DIM(CM):」，
// 多組以換行附加到 REMARK（tag）。不碰 DOM，前端 UI 與測試共用。
export const LP_DIM_MAX_LEN = 500;
export const LP_DIM_FIELDS = ['length', 'width', 'height', 'pcs'];
export const LP_DIM_LABELS = { length: 'L', width: 'W', height: 'H', pcs: 'PCS' };
export const LP_DIM_HEADER = 'DIM(CM):';

const DIM_LINE_RE = /^\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*\/\s*\d+$/i;
const DIM_HEADER_RE = /^dim\s*\(\s*cm\s*\)\s*[:：]?$/i;

// 一行是否為 DIM（例：60 x 40 x 50 / 10）
export function lpIsDimLine(line) {
  return DIM_LINE_RE.test(String(line === null || line === undefined ? '' : line).trim());
}

// 一行是否為 DIM 標題（容忍大小寫、空白、全形冒號）
export function lpIsDimHeaderLine(line) {
  return DIM_HEADER_RE.test(String(line === null || line === undefined ? '' : line).trim());
}

// 去掉多餘小數 0（60.000 → 60、60.50 → 60.5）
export function lpFormatDimNumber(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (text === '') return '';
  const n = Number(text);
  return Number.isFinite(n) ? String(Number(n.toFixed(3))) : '';
}

export function lpDimLine(values) {
  const src = values || {};
  return `${lpFormatDimNumber(src.length)} x ${lpFormatDimNumber(src.width)} x ${lpFormatDimNumber(src.height)} / ${lpFormatDimNumber(src.pcs)}`;
}

// rows: [{ length, width, height, pcs }]（字串或數字；整列空白＝略過）
// 回傳 { lines, error }：error = { code, field, rowIndex, message }
export function lpNormalizeDimRows(rows) {
  const lines = [];
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i] || {};
    const values = {};
    LP_DIM_FIELDS.forEach((field) => {
      const value = raw[field];
      values[field] = String(value === null || value === undefined ? '' : value).trim();
    });
    if (LP_DIM_FIELDS.every(field => values[field] === '')) continue;
    const missing = LP_DIM_FIELDS.find(field => values[field] === '');
    if (missing) {
      return { lines, error: { code: 'incomplete', field: missing, rowIndex: i, message: 'DIM 每列都要填 L、W、H、PCS' } };
    }
    const length = Number(values.length);
    const width = Number(values.width);
    const height = Number(values.height);
    const pcs = Number(values.pcs);
    if (![length, width, height].every(n => Number.isFinite(n) && n > 0)) {
      return { lines, error: { code: 'size', field: 'length', rowIndex: i, message: 'DIM 的 L／W／H 需大於 0' } };
    }
    if (!Number.isInteger(pcs) || pcs <= 0) {
      return { lines, error: { code: 'pcs', field: 'pcs', rowIndex: i, message: 'PCS 需為正整數' } };
    }
    lines.push(lpDimLine({ length, width, height, pcs }));
  }
  return { lines, error: null };
}

// DIM 區塊結尾（標題後連續的 DIM 行；空行可跳過，遇到其他文字就停）
function dimBlockEnd(rows, headerIndex) {
  let end = headerIndex + 1;
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const line = rows[i];
    if (String(line || '').trim() === '') continue;
    if (!lpIsDimLine(line)) break;
    end = i + 1;
  }
  return end;
}

// 把 DIM 行接進既有 REMARK：
// - 沒有 DIM 標題 → 在 DIM 上一行補「DIM(CM):」（既有 DIM 行也會被標到）
// - 已有標題 → 接在同一區塊最後一行 DIM 之後（不重複標題、不跨到其他備註）
export function lpAppendDim(existing, lines, max = LP_DIM_MAX_LEN) {
  const base = String(existing === null || existing === undefined ? '' : existing).trim();
  const add = (Array.isArray(lines) ? lines : [])
    .map(line => String(line || '').trim())
    .filter(Boolean);
  const rows = base ? base.split('\n') : [];
  let next = rows;

  if (add.length) {
    const headerIndex = rows.findIndex(lpIsDimHeaderLine);
    if (headerIndex >= 0) {
      const end = dimBlockEnd(rows, headerIndex);
      next = [...rows.slice(0, end), ...add, ...rows.slice(end)];
    } else {
      const dimIndexes = rows
        .map((line, index) => (lpIsDimLine(line) ? index : -1))
        .filter(index => index >= 0);
      if (dimIndexes.length) {
        const first = dimIndexes[0];
        const last = dimIndexes[dimIndexes.length - 1];
        next = [
          ...rows.slice(0, first),
          LP_DIM_HEADER,
          ...rows.slice(first, last + 1),
          ...add,
          ...rows.slice(last + 1)
        ];
      } else {
        next = [...rows, LP_DIM_HEADER, ...add];
      }
    }
  }

  const text = next.join('\n');
  return { text, overflow: text.length > max };
}
