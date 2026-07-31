const express = require('express');
const router = express.Router();
const db = require('../db/database');

// API 1: 獲取 Gemini 技能與資料
router.get('/', (req, res) => {
  db.all("SELECT * FROM skills", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
});

module.exports = router;