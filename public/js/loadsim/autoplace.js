// ===== 模擬裝板：自動放置（找第一個合法空位）=====
// 策略：由低到高、由板前端到後端、由左到右掃描；
//       候選位置優先取「貼齊既有貨物邊緣 / 板邊」的座標，再補均勻網格避免漏位。
import {
  loadsimDimsOf, loadsimExtents, loadsimEvaluatePlacement
} from './geometry.js';

const round2 = value => Math.round(value * 100) / 100;

export function loadsimFindAutoPlacement(item, spec, allItems, options = {}) {
  const dims = loadsimDimsOf(item);
  const others = (allItems || []).filter(other => other.placed && other.id !== item.id);

  // 候選位置以「板面（貼地）」為範圍；外擴型板型的輪廓比板面大，
  // 貼地那層只能擺在板面內（疊高後才可能伸進外擴區）。
  const fX0 = spec.floorX0 === undefined ? 0 : spec.floorX0;
  const fX1 = spec.floorX1 === undefined ? spec.baseL : spec.floorX1;
  const fZ0 = spec.floorZ0 === undefined ? -spec.baseW / 2 : spec.floorZ0;
  const fZ1 = spec.floorZ1 === undefined ? spec.baseW / 2 : spec.floorZ1;

  const xs = new Set([fX0]);
  const zs = new Set([round2(fZ0)]);
  const ys = new Set([0]);

  others.forEach(other => {
    const e = loadsimExtents(other);
    xs.add(round2(e.x1));
    xs.add(round2(e.x0 - dims.x));
    zs.add(round2(e.z1));
    zs.add(round2(e.z0 - dims.z));
    if (e.y1 <= spec.heightCm) ys.add(round2(e.y1));
  });

  // 均勻網格（步長 10cm，避免邊緣候選全部失效時找不到位置）
  for (let x = fX0; x <= fX1 - dims.x; x += 10) xs.add(round2(x));
  for (let z = fZ0; z <= fZ1 - dims.z; z += 10) zs.add(round2(z));

  const xsList = [...xs]
    .filter(v => v >= fX0 - 0.01 && v <= fX1 - dims.x + 0.01)
    .sort((a, b) => a - b);
  const zsList = [...zs]
    .filter(v => v >= fZ0 - 0.01 && v <= fZ1 - dims.z + 0.01)
    .sort((a, b) => a - b);
  const ysList = [...ys]
    .filter(v => v >= 0 && v <= spec.heightCm - dims.y + 0.01)
    .sort((a, b) => a - b);

  for (const y of ysList) {
    for (const x of xsList) {
      for (const z of zsList) {
        const candidate = { ...item, x, y, z };
        const report = loadsimEvaluatePlacement(candidate, spec, others, options);
        if (report.ok) {
          return { x, y, z, report };
        }
      }
    }
  }
  return null;
}
