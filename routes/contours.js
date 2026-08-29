const express = require('express');
const fs = require('fs');
const path = require('path');

// Contour 圖片庫目錄：HACTL 規格 + CX 規格（兩者皆有獨立子目錄）
const CONTOUR_DIRS = [
  { dir: path.join(__dirname, '..', 'public', 'image', 'HACTL_contour_spec'), source: 'HACTL' },
  { dir: path.join(__dirname, '..', 'public', 'image', 'CX_Contour'), source: 'CX' }
];

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp)$/i;

// 掃描所有 contour 目錄，回傳統一結構的圖片清單（含來源標記）
function scanContourDirs() {
  const all = [];
  for (const { dir, source } of CONTOUR_DIRS) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (err) {
      console.error(`Contour API error (${dir}):`, err.message);
      continue;
    }
    for (const name of files) {
      if (!IMAGE_EXT_RE.test(name)) continue;
      const cleanName = name.replace(/\.[^/.]+$/, '');
      // 取第一個空白/連字號前的 token 作為 code，並移除尾端非字母數字字元（如 "P1P." → "P1P"）
      const code = (cleanName.split(/[\s-]/)[0] || cleanName).replace(/[^A-Za-z0-9]+$/g, '');
      all.push({ filename: name, code, title: cleanName, source });
    }
  }
  return all.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
}

// ===== Contour 列表與搜尋 =====
const contoursRouter = express.Router();

// API 1.5: 獲取 Contour 圖片列表，可搜尋型號或檔名
contoursRouter.get('/', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  const allImages = scanContourDirs();

  const result = allImages
    .filter(item => {
      if (!query) return true;
      const normalized = `${item.title} ${item.code} ${item.source}`.toLowerCase();
      return normalized.includes(query);
    });

  res.json({ data: result });
});

// API: Contour Autocomplete Suggestions
contoursRouter.get('/suggestions', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  const allImages = scanContourDirs();

  const allCodes = allImages
    .map(item => item.code)
    .filter((value, index, self) => value && self.indexOf(value) === index); // 去重

  const matched = query
    ? allCodes.filter(code => code.toLowerCase().includes(query))
    : allCodes;

  res.json({ suggestions: matched.slice(0, 10) });
});

// ===== 獨立圖片服務路由（保持舊路徑 /api/contour-image/:filename）=====
const contourImageRouter = express.Router();

contourImageRouter.get('/:filename', (req, res) => {
  const filename = req.params.filename;
  const safeName = path.basename(filename);

  // 依序在每個 contour 目錄中尋找圖片（HACTL → CX）
  for (const { dir } of CONTOUR_DIRS) {
    const filepath = path.join(dir, safeName);
    if (fs.existsSync(filepath)) {
      const ext = path.extname(filepath).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      return res.sendFile(filepath);
    }
  }

  return res.status(404).json({ error: 'Image not found' });
});

module.exports = { contoursRouter, contourImageRouter };