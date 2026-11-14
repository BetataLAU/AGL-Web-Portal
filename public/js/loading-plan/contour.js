// ===== 執 PLAN：Contour 規格（TAG → 彈窗看尺寸）=====
// 規格來源：public/js/loadsim/uld-specs.js（HACTL 圖面尺寸；1 inch = 2.54 cm）
import { LOADSIM_ULD_SPECS, loadsimGetSpec, loadsimSpecImageUrl } from '../loadsim/uld-specs.js';
import { lpResolveContourCode } from './calc.js';
import { esc } from './dom.js';

const IN = 2.54;
const toInch = cm => Math.round((Number(cm) / IN) * 10) / 10;
const fmt = (value, digits = 1) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—');

function gotoContourLibrary() {
  const link = document.querySelector('a[href="#section-contour"]');
  if (link) link.click();
}

export function openContourSpec(code) {
  const resolved = lpResolveContourCode(code, LOADSIM_ULD_SPECS.map(s => s.code));
  const close = () => {};

  if (!resolved.known) {
    const body = `
      <div class="lp-form">
        <p>系統的板型規格庫沒有收錄 <b>${esc(resolved.code)}</b>，所以無法自動帶尺寸與上限。</p>
        <p class="lp-muted">你可以：① 在「編輯 PLAN」手動輸入上限（kg / CBM）；② 去 Contour 圖庫找這張板型的圖面。</p>
      </div>
    `;
    const modal = window.openModal({
      title: `板型：${esc(resolved.code)}（未收錄）`,
      body,
      className: 'lp-modal',
      actions: [
        { label: '📷 去 Contour 圖庫', className: 'pill btn-primary', onClick: (m) => { m.close(); gotoContourLibrary(); } },
        { label: '關閉', className: 'pill' }
      ]
    });
    return modal;
  }

  const spec = loadsimGetSpec(resolved.code);
  const image = loadsimSpecImageUrl(spec);
  const volume = spec.envelopeVolumeCm3 ? spec.envelopeVolumeCm3 / 1000000 : null;
  const rows = [
    ['板型代碼', `${spec.code}`],
    ['名稱', spec.name || '—'],
    ['適用機型', spec.aircraft || '—'],
    ['貼地面（長 × 寬）', `${toInch(spec.floorL || spec.baseL)}" × ${toInch(spec.floorW || spec.baseW)}" ／ ${fmt(spec.floorL || spec.baseL, 1)} × ${fmt(spec.floorW || spec.baseW, 1)} cm`],
    ['輪廓（長 × 寬 × 高）', `${toInch(spec.baseL)}" × ${toInch(spec.baseW)}" × ${toInch(spec.heightCm)}" ／ ${fmt(spec.baseL)} × ${fmt(spec.baseW)} × ${fmt(spec.heightCm)} cm`],
    ['板底類型', spec.plateLabel || '—'],
    ['皮重（參考）', spec.tareKg ? `${spec.tareKg} kg` : '—'],
    ['最大總重', spec.maxGrossKg ? `${Number(spec.maxGrossKg).toLocaleString('en-US')} kg` : '未提供（請依航空公司規格手動輸入）'],
    ['理論包絡容積', volume ? `${fmt(volume, 2)} m³（僅供參考，非可用容積）` : '—']
  ];

  const body = `
    <div class="lp-spec">
      ${image ? `<img src="${image}" alt="${esc(spec.code)}" loading="lazy" />` : ''}
      <table class="lp-spec-table">
        <tbody>${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</tbody>
      </table>
      ${spec.note ? `<p class="lp-muted">${esc(spec.note)}</p>` : ''}
      ${spec.weightNote ? `<p class="lp-muted">※ ${esc(spec.weightNote)}</p>` : ''}
    </div>
  `;
  return window.openModal({ title: `板型規格：${esc(spec.code)}`, body, className: 'lp-modal lp-modal-wide' });
}
