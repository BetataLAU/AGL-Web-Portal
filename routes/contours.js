const express = require('express');
const fs = require('fs');
const path = require('path');

const CONTOUR_DIR = path.join(__dirname, '..', 'public', 'image', 'HACTL_contour_spec');

// ===== Contour 列表與搜尋 =====
const contoursRouter = express.Router();

// API 1.5: 獲取 Contour 圖片列表，可搜尋型號或檔名
contoursRouter.get('/', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  fs.readdir(CONTOUR_DIR, (err, files) => {
    if (err) {
      console.error('Contour API error:', err);
      return res.status(500).json({ error: err.message });
    }

    const result = files
      .filter(name => /\.(jpe?g|png|gif|webp)$/i.test(name))
      .map(name => {
        const cleanName = name.replace(/\.[^/.]+$/, '');
        const code = cleanName.split(/\s|-/)[0] || cleanName;
        return {
          filename: name,
          code,
          title: cleanName
        };
      })
      .filter(item => {
        if (!query) return true;
        const normalized = `${item.title} ${item.code}`.toLowerCase();
        return normalized.includes(query);
      })
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));

    res.json({ data: result });
  });
});

// API: Contour Autocomplete Suggestions
contoursRouter.get('/suggestions', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  fs.readdir(CONTOUR_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: err.message });

    const allCodes = files
      .filter(name => /\.(jpe?g|png|gif|webp)$/i.test(name))
      .map(name => {
        const cleanName = name.replace(/\.[^/.]+$/, '');
        return cleanName.split(/[\s-]/)[0] || cleanName;
      })
      .filter((value, index, self) => self.indexOf(value) === index); // 去重

    const matched = query
      ? allCodes.filter(code => code.toLowerCase().includes(query))
      : allCodes;

    res.json({ suggestions: matched.slice(0, 10) });
  });
});

// ===== 獨立圖片服務路由（保持舊路徑 /api/contour-image/:filename）=====
const contourImageRouter = express.Router();

contourImageRouter.get('/:filename', (req, res) => {
  const filename = req.params.filename;
  const safeName = path.basename(filename);
  const filepath = path.join(CONTOUR_DIR, safeName);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Image not found' });
  }

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
  res.sendFile(filepath);
});

module.exports = { contoursRouter, contourImageRouter };