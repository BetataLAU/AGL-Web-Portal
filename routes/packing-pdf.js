/**
 * routes/packing-pdf.js
 * ULD 裝箱作業單 PDF 導出（2D 俯視圖 + 側視圖 + 貨物清單）。
 *
 *   POST /api/packing/projects/:id/export-pdf — 產生作業單 PDF（回傳 blob）
 *
 * 使用 pdf-lib（已安裝）繪製：
 *   - 第一頁：全場作業摘要（專案資訊 + 各 ULD 載況）
 *   - 每 ULD 一頁：俯視圖（XY）+ 側視圖（YZ）+ 貨物清單
 *
 * 座標來源：request body 的 solution_data（GA-LNS 方案 placedItems 含 x/y/z mm）
 * 若未提供方案，則退化為顯示各 ULD 已分派貨物清單（無 2D 位置圖）。
 */
const express = require('express');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const db = require('../db/database');

const router = express.Router();

// ===== 共用工具 =====

/** 載入專案 + ULD + 客戶 + 貨物 */
function loadProjectData(projectId, callback) {
  db.get('SELECT * FROM projects WHERE id = ?', [projectId], (err, project) => {
    if (err) return callback(err);
    if (!project) return callback(new Error('專案不存在'));
    db.all('SELECT * FROM ulds WHERE project_id = ? ORDER BY seq', [projectId], (err2, ulds) => {
      if (err2) return callback(err2);
      db.all('SELECT * FROM customers WHERE project_id = ? ORDER BY id', [projectId], (err3, customers) => {
        if (err3) return callback(err3);
        db.all(
          `SELECT i.*, c.hawb, c.customer_name, c.color_code
           FROM items i JOIN customers c ON i.customer_id = c.id
           WHERE c.project_id = ? ORDER BY i.id`,
          [projectId],
          (err4, items) => {
            if (err4) return callback(err4);
            // 解析 ULD 尺寸：由 contour_config JSON 提取 baseL/baseW/maxHeightMm
            const parsedUlDs = (ulds || []).map((u) => {
              let cfg = {};
              if (u.contour_config) { try { cfg = JSON.parse(u.contour_config); } catch (e) { cfg = {}; } }
              return {
                ...u,
                l: cfg.baseL || 3175,
                w: cfg.baseW || 2438,
                h: cfg.maxHeightMm || 3000,
              };
            });
            callback(null, { ...project, ulds: parsedUlDs, customers: customers || [], items: items || [] });
          }
        );
      });
    });
  });
}

/** 建立 A4 橫向頁 */
function addPage(doc) {
  return doc.addPage([842, 595]);
}

/** 由 hex 字串轉 pdf-lib RGB 物件 */
function hexToRgb(hex) {
  try {
    const h = String(hex || '#3498db').replace('#', '');
    return rgb(
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255
    );
  } catch (e) {
    return rgb(0.5, 0.5, 0.5);
  }
}

/**
 * 繪製俯視圖（XY 平面）。
 * @param {object} page PDF page
 * @param {Array} items 方案 placedItems（mm）
 * @param {object} uld ULD（l/w/h mm）
 * @param {number} ox / oy 原點
 * @param {number} scale 比例
 * @param {object} colorMap customerId → rgb
 * @param {object} font Helvetica
 */
function drawTopView(page, items, uld, ox, oy, scale, colorMap, font) {
  const l = uld.l || 3175;
  const w = uld.w || 2438;
  page.drawRectangle({ x: ox, y: oy, width: l * scale, height: w * scale, borderColor: rgb(0.1, 0.32, 0.46), borderWidth: 1.5 });

  items.forEach((it) => {
    // it.x/y 是 bp3d 座標（原點 = ULD 中心）
    const px = ox + (it.x + l / 2) * scale;
    const py = oy + (it.y + w / 2) * scale;
    const bw = it.l * scale;
    const bh = it.w * scale;
    page.drawRectangle({
      x: px - bw / 2,
      y: py - bh / 2,
      width: bw,
      height: bh,
      color: colorMap[it.customerId] || rgb(0.5, 0.5, 0.5),
      opacity: 0.55,
      borderColor: rgb(0.1, 0.1, 0.1),
      borderWidth: 0.5,
    });
    if (bw > 22 && bh > 12) {
      page.drawText(String(it.id), { x: px - bw / 2 + 2, y: py - 4, size: 6, font, color: rgb(0, 0, 0) });
    }
  });
}

/**
 * 繪製側視圖（YZ 平面：寬 × 高）。
 */
function drawSideView(page, items, uld, ox, oy, scale, colorMap, font) {
  const w = uld.w || 2438;
  const h = uld.h || 3000;
  page.drawRectangle({ x: ox, y: oy, width: w * scale, height: h * scale, borderColor: rgb(0.1, 0.32, 0.46), borderWidth: 1.5 });

  items.forEach((it) => {
    const px = ox + (it.y + w / 2) * scale;
    const py = oy + (it.z || 0) * scale;
    const bw = it.w * scale;
    const bh = it.h * scale;
    page.drawRectangle({
      x: px - bw / 2,
      y: py,
      width: bw,
      height: bh,
      color: colorMap[it.customerId] || rgb(0.5, 0.5, 0.5),
      opacity: 0.55,
      borderColor: rgb(0.1, 0.1, 0.1),
      borderWidth: 0.5,
    });
  });
}

// ===== 主導出 =====

router.post('/projects/:id/export-pdf', (req, res) => {
  const projectId = Number(req.params.id);
  const { solution_data } = req.body || {};
  if (!projectId) return res.status(400).json({ error: '無效的專案 ID' });

  loadProjectData(projectId, async (err, project) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

      // 客戶色表
      const colorMap = {};
      project.customers.forEach((c) => { colorMap[c.id] = hexToRgb(c.color_code); });

      // 方案資料（若提供）：placedItems 依 uldId 分類
      const itemsByUld = {};
      if (solution_data && solution_data.placedItems) {
        solution_data.placedItems.forEach((p) => {
          if (!itemsByUld[p.uldId]) itemsByUld[p.uldId] = [];
          itemsByUld[p.uldId].push(p);
        });
      }

      // ===== 摘要頁 =====
      const summaryPage = addPage(doc);
      summaryPage.drawText(`ULD 裝箱作業單 - ${project.mawb}`, {
        x: 40, y: 540, size: 22, font: fontBold, color: rgb(0.1, 0.1, 0.1),
      });
      summaryPage.drawText(`DEST: ${project.dest}    建立: ${new Date().toLocaleString()}`, {
        x: 40, y: 515, size: 11, font,
      });

      let y = 475;
      project.ulds.forEach((uld) => {
        const assigned = project.items.filter((i) => i.assigned_uld_id === uld.id);
        const gross = assigned.reduce((s, i) => s + (i.weight_kg * i.pcs || 0), 0);
        const vw = assigned.reduce((s, i) => s + (i.length_cm * i.width_cm * i.height_cm * i.pcs / 6000 || 0), 0);
        const pcs = assigned.reduce((s, i) => s + (i.pcs || 0), 0);
        summaryPage.drawText(
          `${uld.label} (${uld.uld_type})    ${pcs} 件   毛重 ${gross.toFixed(1)}kg   體積重 ${vw.toFixed(1)}kg`,
          { x: 40, y, size: 11, font }
        );
        y -= 20;
      });

      // ===== 每 ULD 一頁 =====
      project.ulds.forEach((uld) => {
        const page = addPage(doc);
        const planItems = itemsByUld[uld.id] || [];
        const assigned = project.items.filter((i) => i.assigned_uld_id === uld.id);

        page.drawText(`${uld.label} - ${uld.uld_type}`, { x: 40, y: 555, size: 18, font: fontBold });
        page.drawText(`尺寸: ${uld.l || '?'} × ${uld.w || '?'} × ${uld.h || '?'} mm`, { x: 40, y: 535, size: 10, font });

        if (planItems.length > 0) {
          // 俯視圖 / 側視圖（方案座標）
          const scale = 0.13;
          drawTopView(page, planItems, uld, 40, 180, scale, colorMap, font);
          page.drawText('俯視圖 (TOP)', { x: 40, y: 165, size: 10, font });

          drawSideView(page, planItems, uld, 450, 120, 0.13, colorMap, font);
          page.drawText('側視圖 (SIDE)', { x: 450, y: 105, size: 10, font });
        } else {
          page.drawText('（無方案座標資料：請先執行智能裝箱並將方案套用至 ULD）', {
            x: 40, y: 400, size: 11, font, color: rgb(0.8, 0.3, 0.2),
          });
        }

        // 貨物清單
        let ly = 60;
        page.drawText('貨物清單:', { x: 40, y: ly, size: 10, font: fontBold });
        ly -= 16;
        assigned.forEach((it) => {
          page.drawText(
            `${it.id} | ${it.customer_name || '-'} | ${it.length_cm}x${it.width_cm}x${it.height_cm}cm x${it.pcs} | ${it.weight_kg}kg`,
            { x: 45, y: ly, size: 8, font }
          );
          ly -= 12;
          if (ly < 20) {
            ly = 555;
            page.drawText('（續）', { x: 45, y: ly, size: 8, font });
            ly -= 12;
          }
        });
      });

      const bytes = await doc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="uld-packing-${project.mawb}.pdf"`);
      res.send(Buffer.from(bytes));
    } catch (err2) {
      console.error('PDF 導出失敗:', err2.message);
      res.status(500).json({ error: `PDF 導出失敗：${err2.message}` });
    }
  });
});

module.exports = router;