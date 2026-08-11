const express = require('express');
const { exec, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../../db/database');
const router = express.Router();
const {
  MAWB_LATE_LABEL,
  validateMawb,
  validateHawb,
  validateDest,
  generateOrderNo,
  serializeOrder,
  ORDER_SELECT_SQL
} = require('./utils');

// ===== 客戶資料隔離 =====
// customer 角色只能存取「自己公司」的訂單（依 customer_company_id = session.company_id 過濾）
// admin / staff 可看全部訂單
function buildCustomerScope(req, params) {
  const { user } = req.session || {};
  if (user && user.role === 'customer') {
    params.push(user.company_id);
    return ' AND o.customer_company_id = ?';
  }
  return '';
}

// 客戶只能操作自己公司的訂單；回傳 true 代表有權限
function verifyOrderAccess(req, res, orderId, cb) {
  const { user } = req.session || {};
  if (!user || user.role !== 'customer') return cb(true);
  db.get(
    "SELECT id FROM orders WHERE id = ? AND customer_company_id = ?",
    [orderId, user.company_id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      cb(!!row);
    }
  );
}

// ===== 訂單 API =====
// GET /api/orders?search=&status=
router.get('/', (req, res) => {
  const search = (req.query.search || '').trim();
  const status = (req.query.status || '').trim();
  const params = [];
  let sql = ORDER_SELECT_SQL + ' WHERE 1=1';
  if (search) {
    sql += " AND (o.order_no LIKE ? OR o.mawb LIKE ? OR o.hawb LIKE ? OR o.pickup_no LIKE ? OR pc.name LIKE ? OR dc.name LIKE ? OR o.transport_company LIKE ?)";
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (status) {
    sql += " AND o.status = ?";
    params.push(status);
  }
  // 客戶資料隔離：只回傳自己公司的訂單
  sql += buildCustomerScope(req, params);
  sql += " ORDER BY o.created_at DESC LIMIT 100";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows.map(serializeOrder) });
  });
});

// 掃描系統上的 Outlook Classic 執行檔路徑
function findOutlookClassic() {
  const candidates = [
    'C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE',
    'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE',
    'C:\\Program Files\\Microsoft Office\\Office16\\OUTLOOK.EXE',
    'C:\\Program Files (x86)\\Microsoft Office\\Office16\\OUTLOOK.EXE'
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

// GET /api/orders/email-apps → 列出現有可用的郵件應用程式
router.get('/email-apps', (req, res) => {
  const apps = [{ id: 'default', label: '系統預設郵件' }];
  if (findOutlookClassic()) {
    apps.push({ id: 'outlook-classic', label: 'Outlook Classic' });
  }
  res.json({ data: apps });
});

// POST /api/orders/open-email-client
// 新協議：{ client, subject, htmlBody, plainText }
// 依使用者要求：TO:/CC: 一律不自動填入（收件人留空，由使用者在郵件程式自行輸入）
// - outlook-classic：優先以 PowerShell + Outlook COM 建立 HTML 格線草稿（Display），失敗時 fallback mailto 純文字
// - default：由前端自行處理（window.location.href = mailto:，body 用 plainText）
function writeTempFile(filename, content) {
  const filePath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(filePath, '\uFEFF' + content, 'utf8'); // 加 BOM 確保 PowerShell 讀中文無亂碼
  return filePath;
}

function cleanTempFiles(files) {
  files.forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } });
}

router.post('/open-email-client', (req, res) => {
  const { client, subject, htmlBody, plainText } = req.body;
  console.log('[open-email-client] 收到請求：', { client, subject: subject ? subject.slice(0, 50) + '...' : '', hasHtml: !!htmlBody, hasText: !!plainText });
  if (!subject) {
    return res.status(400).json({ error: '缺少 subject' });
  }

  if (client === 'outlook-classic') {
    // ===== 層級 1：PowerShell + Outlook COM 建立 HTML 格線草稿（TO/CC 留空）=====
    const tmpFiles = [];
    try {
      const bodyFile = writeTempFile('agl-email-body.html', htmlBody || '');
      const subjectFile = writeTempFile('agl-email-subject.txt', subject);
      const psFile = writeTempFile('agl-email-com.ps1', [
        "$ErrorActionPreference = 'Stop'",
        "$bodyFile = '" + bodyFile + "'",
        "$subjectFile = '" + subjectFile + "'",
        "$bodyHtml = Get-Content -Path $bodyFile -Raw -Encoding UTF8",
        "$subject = Get-Content -Path $subjectFile -Raw -Encoding UTF8",
        "try {",
        "  $outlook = New-Object -ComObject Outlook.Application",
        "  $mail = $outlook.CreateItem(0)",
        "  $mail.To = ''",
        "  $mail.CC = ''",
        "  $mail.Subject = $subject.Trim()",
        "  # 觸發 GetInspector 讓 Outlook 自動載入使用者已設定的預設簽名檔",
        "  $inspector = $mail.GetInspector()",
        "  $signatureHtml = $mail.HTMLBody",
        "  # 合併：訂單總結插入到 <body> 開頭，Outlook 簽名檔保留在最後",
        "  $bodyOpenIdx = $signatureHtml.IndexOf('<body', [System.StringComparison]::OrdinalIgnoreCase)",
        "  if ($bodyOpenIdx -ge 0) {",
        "    $bodyTagEnd = $signatureHtml.IndexOf('>', $bodyOpenIdx)",
        "    if ($bodyTagEnd -ge 0) {",
        "      $mail.HTMLBody = $signatureHtml.Insert($bodyTagEnd + 1, $bodyHtml)",
        "    } else {",
        "      $mail.HTMLBody = $bodyHtml + $signatureHtml",
        "    }",
        "  } else {",
        "    $mail.HTMLBody = $bodyHtml + $signatureHtml",
        "  }",
        "  $mail.Display()",
        "  $mail = $null",
        "  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($outlook) | Out-Null",
        "  Write-Output 'COM_OK'",
        "} catch {",
        "  Write-Error $_.Exception.Message",
        "  exit 1",
        "}"
      ].join('\n'));
      tmpFiles.push(bodyFile, subjectFile, psFile);

      const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], {
        encoding: 'utf8', timeout: 60000, windowsHide: true
      });
      cleanTempFiles(tmpFiles);
      if (String(out).includes('COM_OK')) {
        console.log('[open-email-client] ✅ Outlook COM HTML 草稿已開啟（TO/CC 留空）');
        return res.json({ success: true, layer: 'outlook-com-html' });
      }
      console.warn('[open-email-client] COM 未回傳成功標記，改用 mailto fallback');
    } catch (comErr) {
      cleanTempFiles(tmpFiles);
      console.warn('[open-email-client] Outlook COM 失敗（' + (comErr.message || comErr) + '），改用 mailto fallback');
    }

    // ===== 層級 2：mailto fallback（純文字 body，收件人留空）=====
    const outlookExe = findOutlookClassic();
    const fallbackMailto = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(plainText || '');
    if (outlookExe) {
      const mailtoCmd = fallbackMailto.replace(/^mailto:/i, '');
      const tryLayers = [
        {
          name: 'execFile 直接執行',
          run: (cb) => execFile(outlookExe, ['/c', 'ipm.note', '/m', mailtoCmd], { windowsHide: true }, cb)
        },
        {
          name: 'execFile 帶引號參數',
          run: (cb) => execFile(outlookExe, ['/c', 'ipm.note', '/m', `"${mailtoCmd}"`], { windowsHide: true }, cb)
        },
        {
          name: 'Outlook Protocol (start outlook:)',
          run: (cb) => exec('start outlook:', { windowsHide: true }, cb)
        }
      ];

      let layerIndex = 0;
      const tryNextLayer = (prevErr) => {
        if (layerIndex >= tryLayers.length) {
          console.error('[open-email-client] 所有 mailto fallback 皆失敗：', prevErr && prevErr.message);
          return res.status(500).json({
            error: `開啟 Outlook Classic 失敗：${prevErr ? prevErr.message : '未知錯誤'}`
          });
        }
        const layer = tryLayers[layerIndex++];
        console.log(`[open-email-client] fallback 嘗試層級 ${layerIndex}/${tryLayers.length}：${layer.name}`);
        try {
          layer.run((err) => {
            if (err) {
              console.warn(`[open-email-client] ${layer.name} 失敗：`, err.message);
              tryNextLayer(err);
              return;
            }
            console.log(`[open-email-client] ✅ fallback ${layer.name} 成功`);
            res.json({ success: true, layer: 'mailto-fallback-' + layer.name });
          });
        } catch (e) {
          console.warn(`[open-email-client] ${layer.name} 拋出例外：`, e.message);
          tryNextLayer(e);
        }
      };
      tryNextLayer(null);
    } else {
      console.warn('[open-email-client] 找不到 Outlook Classic 執行檔，改用系統預設 mailto');
      res.json({ success: true, fallback: 'default-mailto' });
    }
  } else {
    // 系統預設郵件由前端自行處理（window.location.href = mailto:，body 用 plainText）
    console.log('[open-email-client] 使用系統預設郵件（前端 mailto:)');
    res.json({ success: true });
  }
});

// GET /api/orders/check-duplicate?mawb=&hawb=&pickup_no=&customer_company_id=&exclude_id=
router.get('/check-duplicate', (req, res) => {
  const mawb = (req.query.mawb || '').trim();
  const hawb = (req.query.hawb || '').trim();
  const pickupNo = (req.query.pickup_no || '').trim();
  const customerCompanyId = req.query.customer_company_id ? parseInt(req.query.customer_company_id, 10) : null;
  const excludeId = req.query.exclude_id ? parseInt(req.query.exclude_id, 10) : null;

  const conditions = [];
  const params = [];
  if (mawb && mawb !== MAWB_LATE_LABEL) {
    conditions.push('o.mawb = ?');
    params.push(mawb);
  }
  if (hawb) {
    conditions.push('o.hawb = ?');
    params.push(hawb);
  }
  if (pickupNo) {
    if (customerCompanyId) {
      // 已選客戶 → 只比對同一客戶的提貨號（精確防呆）
      conditions.push('(o.pickup_no = ? AND o.customer_company_id = ?)');
      params.push(pickupNo, customerCompanyId);
    } else {
      // 未選客戶 → 全表比對（提醒用：不同客戶可有相同提貨號）
      conditions.push('o.pickup_no = ?');
      params.push(pickupNo);
    }
  }
  if (excludeId) {
    conditions.push('o.id != ?');
    params.push(excludeId);
  }
  if (conditions.length === 0) {
    return res.json({ data: [] });
  }

  const sql = `
    SELECT o.*,
           cc.name AS customer_company_name,
           pc.name AS pickup_company_name,
           dc.name AS delivery_company_name,
           strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) AS created_at,
           strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) AS updated_at
    FROM orders o
    LEFT JOIN companies cc ON cc.id = o.customer_company_id
    LEFT JOIN companies pc ON pc.id = o.pickup_company_id
    LEFT JOIN companies dc ON dc.id = o.delivery_company_id
    WHERE ${conditions.join(' OR ')}
    ORDER BY o.created_at DESC LIMIT 20
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows.map(serializeOrder) });
  });
});

// POST /api/orders
router.post('/', (req, res) => {
  const {
    order_type, mawb, hawb, dest, pickup_no, pickup_datetime,
    customer_company_id: requestCustomerCompanyId, pickup_company_id, delivery_company_id,
    cargo_desc, quantity, weight_kg, cbm, cbm_dimensions,
    power_type, power_code, power_items, urgent,
    receiver_name, receiver_phone, address, receiver_note, contact_note,
    notes, transport_company, status = 'pending'
  } = req.body;

  // 客戶資料隔離：customer 下單時，客戶公司強制為自己的公司（不可幫別人下單）
  const sessionUser = req.session && req.session.user;
  const customerCompanyId = (sessionUser && sessionUser.role === 'customer')
    ? sessionUser.company_id
    : requestCustomerCompanyId;

  if (!order_type || !pickup_no) {
    return res.status(400).json({ error: '請填寫訂單類型與客戶提貨號' });
  }
  // MAWB# 驗證：可留空代表「後補MAWB#」，有值則必須通過格式 + checksum 驗證
  let finalMawb = MAWB_LATE_LABEL;
  if (mawb != null && String(mawb).trim() !== '') {
    const mawbResult = validateMawb(mawb);
    if (!mawbResult.valid) {
      return res.status(400).json({ error: 'MAWB# 有問題，請再輸入' });
    }
    finalMawb = mawbResult.formatted;
  }
  // HAWB# 驗證：選填；有值必須為 1-13 位英文字母或數字（自動轉大楷）
  const hawbResult = validateHawb(hawb);
  if (!hawbResult.valid) {
    return res.status(400).json({ error: hawbResult.error });
  }
  const finalHawb = hawbResult.value;
  // DEST# 驗證：選填；有值必須為 3 個英文字（唯一特例：SVO2）
  const destResult = validateDest(dest);
  if (!destResult.valid) {
    return res.status(400).json({ error: destResult.error });
  }
  const finalDest = destResult.value;
  if (!pickup_company_id && !delivery_company_id) {
    return res.status(400).json({ error: '請選擇收/送貨公司' });
  }
  if (!cargo_desc || !quantity || !weight_kg || !cbm) {
    return res.status(400).json({ error: '請填寫貨品描述、件數、重量與 CBM' });
  }
  if (!power_type) {
    return res.status(400).json({ error: '請選擇電力分類' });
  }
  if (!urgent) {
    return res.status(400).json({ error: '請選擇是否趕機' });
  }

  generateOrderNo((err, orderNo) => {
    if (err) return res.status(500).json({ error: err.message });

    const stmt = db.prepare(`
      INSERT INTO orders (
        order_no, order_type, mawb, hawb, dest, pickup_no, pickup_datetime,
        customer_company_id, pickup_company_id, delivery_company_id,
        cargo_desc, quantity, weight_kg, cbm, cbm_dimensions,
        power_type, power_code, power_items, urgent,
        receiver_name, receiver_phone, address, receiver_note, contact_note,
        notes, transport_company, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      orderNo, order_type, finalMawb, finalHawb, finalDest, pickup_no,
      pickup_datetime || null,
      customerCompanyId || null, pickup_company_id || null, delivery_company_id || null,
      cargo_desc, quantity, weight_kg, cbm,
      cbm_dimensions ? JSON.stringify(cbm_dimensions) : null,
      power_type, power_code || null,
      power_items ? JSON.stringify(power_items) : null,
      urgent,
      receiver_name || '', receiver_phone || '', address || '',
      receiver_note || '', contact_note || '',
      notes || '', transport_company || '', status,
      function (insertErr) {
        if (insertErr) return res.status(500).json({ error: insertErr.message });
        res.json({ success: true, id: this.lastID, order_no: orderNo });
      }
    );
    stmt.finalize();
  });
});

// GET /api/orders/:id
router.get('/:id', (req, res) => {
  const { id } = req.params;
  verifyOrderAccess(req, res, id, (hasAccess) => {
    if (!hasAccess) return res.status(404).json({ error: '訂單不存在' });
    db.get(ORDER_SELECT_SQL + ' WHERE o.id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Order not found' });
      res.json({ data: serializeOrder(row) });
    });
  });
});

// PUT /api/orders/:id
router.put('/:id', (req, res) => {
  const { id } = req.params;
  verifyOrderAccess(req, res, id, (hasAccess) => {
    if (!hasAccess) return res.status(404).json({ error: '訂單不存在' });
    doUpdate();
  });

  function doUpdate() {
  const {
    order_type, mawb, hawb, dest, pickup_no, pickup_datetime,
    customer_company_id, pickup_company_id, delivery_company_id,
    cargo_desc, quantity, weight_kg, cbm, cbm_dimensions,
    power_type, power_code, power_items, urgent,
    receiver_name, receiver_phone, address, receiver_note, contact_note,
    notes, transport_company, status
  } = req.body;

  if (!status) {
    return res.status(400).json({ error: '缺少狀態欄位' });
  }
  // MAWB# 驗證：可留空代表「後補MAWB#」，有值則必須通過格式 + checksum 驗證
  let finalMawb = MAWB_LATE_LABEL;
  if (mawb != null && String(mawb).trim() !== '') {
    const mawbResult = validateMawb(mawb);
    if (!mawbResult.valid) {
      return res.status(400).json({ error: 'MAWB# 有問題，請再輸入' });
    }
    finalMawb = mawbResult.formatted;
  }
  // HAWB# 驗證：選填；有值必須為 1-13 位英文字母或數字（自動轉大楷）
  const hawbResult = validateHawb(hawb);
  if (!hawbResult.valid) {
    return res.status(400).json({ error: hawbResult.error });
  }
  const finalHawb = hawbResult.value;
  // DEST# 驗證：選填；有值必須為 3 個英文字（唯一特例：SVO2）
  const destResult = validateDest(dest);
  if (!destResult.valid) {
    return res.status(400).json({ error: destResult.error });
  }
  const finalDest = destResult.value;

    const stmt = db.prepare(`
      UPDATE orders SET
        order_type = ?, mawb = ?, hawb = ?, dest = ?, pickup_no = ?, pickup_datetime = ?,
        customer_company_id = ?, pickup_company_id = ?, delivery_company_id = ?,
        cargo_desc = ?, quantity = ?, weight_kg = ?, cbm = ?, cbm_dimensions = ?,
        power_type = ?, power_code = ?, power_items = ?, urgent = ?,
        receiver_name = ?, receiver_phone = ?, address = ?, receiver_note = ?, contact_note = ?,
        notes = ?, transport_company = ?, status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(
      order_type, finalMawb, finalHawb, finalDest, pickup_no,
      pickup_datetime || null,
      customer_company_id || null, pickup_company_id || null, delivery_company_id || null,
      cargo_desc, quantity, weight_kg, cbm,
      cbm_dimensions ? JSON.stringify(cbm_dimensions) : null,
      power_type, power_code || null,
      power_items ? JSON.stringify(power_items) : null,
      urgent,
      receiver_name || '', receiver_phone || '', address || '',
      receiver_note || '', contact_note || '',
      notes || '', transport_company || '', status,
      id,
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, changes: this.changes });
      }
    );
    stmt.finalize();
  }
});

// DELETE /api/orders/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  verifyOrderAccess(req, res, id, (hasAccess) => {
    if (!hasAccess) return res.status(404).json({ error: '訂單不存在' });
    const stmt = db.prepare("DELETE FROM orders WHERE id = ?");
    stmt.run(id, function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    });
    stmt.finalize();
  });
});

module.exports = router;