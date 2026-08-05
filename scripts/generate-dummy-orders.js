// ===== 產生 30 筆 DUMMY 訂單（含新公司資料）=====
// 執行方式：node scripts/generate-dummy-orders.js
// pick up date 分佈：2026-08-05 ~ 2026-08-15
const db = require('../db/database');
const { MAWB_LATE_LABEL, validateMawb, formatMawb } = require('../routes/orders/utils');

// ===== 公司資料（新增 10 家：3 倉庫 + 7 客戶）=====
const NEW_COMPANIES = [
  // 倉庫
  { category: 'warehouse', name: '遠雄自貿港區倉儲', address: '桃園市大園區航翔路 101 號', contact_person: '陳建宏', phone: '03-393-8800', email: 'tfc@farglory.com.tw', notes: '航空貨運站專用倉' },
  { category: 'warehouse', name: '华辉物流中心', address: '深圳市宝安区机场物流园 8 栋', contact_person: '王海涛', phone: '+86-755-2998-1122', email: 'ops@huahui-sz.com', notes: '' },
  { category: 'warehouse', name: '冠捷倉儲', address: '香港葵涌葵昌路 50 號', contact_person: '李志明', phone: '+852-2612-3300', email: 'wh@tps.com.hk', notes: 'Dangerous Goods 收貨點' },
  // 客戶
  { category: 'customer', name: '虹光精密工業股份有限公司', address: '新竹科學園區研新一路 20 號', contact_person: '林佳穎', phone: '03-578-2388', email: 'supply@avision.com.tw', notes: 'ISO 認證廠商' },
  { category: 'customer', name: '天鈺科技股份有限公司', address: '新竹縣竹北市台元二街 8 號 6 樓', contact_person: '張志豪', phone: '03-552-6688', email: 'logistics@fitipower.com', notes: '' },
  { category: 'customer', name: '聯亞光電工業股份有限公司', address: '台南市善化區南科九路 12 號', contact_person: '劉怡君', phone: '06-505-1666', email: 'procure@landmark-tw.com', notes: '需預約進廠' },
  { category: 'customer', name: '宏碁智通股份有限公司', address: '新北市汐止區新台五路一段 88 號 22 樓', contact_person: '吳佩珊', phone: '02-2696-1234', email: 'scm@acerits.com', notes: '' },
  { category: 'customer', name: '緯創資通股份有限公司', address: '新竹科學園區新安路 5 號', contact_person: '黃國倫', phone: '03-578-3456', email: 'logistics@wistron.com', notes: 'Bonded 快遞件' },
  { category: 'customer', name: '泰金寶電通股份有限公司', address: '新北市深坑區北深路三段 147 號', contact_person: '許文龍', phone: '02-2662-6688', email: 'dispatch@ccet.com.tw', notes: '' },
  { category: 'customer', name: '樺漢科技股份有限公司', address: '新北市中和區建一路 186 號 9 樓', contact_person: '鄭雅文', phone: '02-8226-7799', email: 'purchasing@enoc.com', notes: '午休不收貨' }
];

// ===== 運輸公司 =====
const TRANSPORT_COMPANIES = ['DHL', 'FedEx', '順豐速運', 'UPS', '長榮航空貨運', '中華航空貨運', '國泰航空貨運', 'TNT'];

// ===== 貨品描述（備選）=====
const CARGO_DESCS = [
  '電子零件（IC 封裝）',
  'LED 燈珠',
  'PCB 電路板',
  '精密模具',
  '紡織布料',
  '機械配件',
  '消費性電子產品',
  '塑膠射出件',
  '金屬零件',
  '光學鏡頭',
  '鋰電池組（已申報）',
  '汽車零配件',
  '醫材配件',
  '食品添加物',
  '化工原料（非危險品）',
  '半導體設備零件',
  'PCBA 模組',
  '液晶顯示面板'
];

// ===== 收件人資料池 =====
const RECEIVERS = [
  { name: '陳家豪', phone: '0912-345-678' },
  { name: '李婉婷', phone: '0933-123-456' },
  { name: '王世杰', phone: '0955-777-888' },
  { name: '林雅芳', phone: '0977-222-111' },
  { name: '張文忠', phone: '0928-666-333' },
  { name: '黃美玲', phone: '0968-444-555' },
  { name: '劉志明', phone: '0988-111-222' },
  { name: '陳淑惠', phone: '0910-999-000' }
];

// ===== 備註範例 =====
const NOTES_POOL = [
  '',
  '貴重物品，小心搬運',
  '需冷藏保存',
  '易碎品，勿重壓',
  '內含電池，需獨立存放',
  '到貨前 30 分鐘請先通知收件人',
  '',
  '棧板裝卸，需堆高機',
  '',
  '夾鏈袋包裝'
];

// ===== 工具函式 =====
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// 產生合法 MAWB（11 位：prefix 3 位 + suffix 8 位，checksum = 前 7 位 mod 7）
function randomMawb() {
  let mawb;
  do {
    const prefix = String(randInt(1, 999)).padStart(3, '0');
    const first7 = String(randInt(0, 9999999)).padStart(7, '0');
    const checkDigit = parseInt(first7, 10) % 7;
    mawb = prefix + first7 + String(checkDigit);
  } while (mawb.length !== 11);
  return mawb;
}

// 產生 HAWB（10~12 位數字）
function randomHawb() {
  return String(randInt(1000000000, 999999999999));
}

// 產生提貨號（使用訂單序號確保唯一，避免與用戶輸入撞號）
function randomPickupNo(seq) {
  const yymm = '2608';
  return `PK${yymm}-${String(seq).padStart(4, '0')}`;
}

// 產生 pickup_datetime（2026-08-05 ~ 2026-08-15，08:00~22:00）
function randomPickupDatetime() {
  const day = randInt(5, 15);
  const hour = randInt(8, 21);
  const minute = pick([0, 15, 30, 45]);
  return `2026-08-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// 檢查字串長度（SQLite / 顯示用）
function truncate(s, maxLen) {
  if (s == null) return '';
  const str = String(s);
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

// ===== 主流程 =====
db.serialize(() => {
  // 1. 建立新公司（依名稱檢查，避免重複建立），回傳 id 對照
  const insertedCompanyIds = {};
  let companyIdx = 0;
  const createCompany = (company, done) => {
    // 先檢查名稱是否已存在（避免重複執行腳本時重複建立）
    db.get('SELECT id FROM companies WHERE name = ?', [company.name], (err, existing) => {
      if (err) {
        console.error(`查詢公司失敗 [${company.name}]:`, err.message);
        return done(err);
      }
      if (existing) {
        insertedCompanyIds[company.name] = existing.id;
        console.log(`⏭ 公司已存在，跳過: ${company.name} (id=${existing.id}, ${company.category})`);
        companyIdx += 1;
        return done(null);
      }
      db.run(
        `INSERT INTO companies (category, name, address, contact_person, phone, email, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [company.category, company.name, company.address, company.contact_person,
         company.phone, company.email, truncate(company.notes || '', 500)],
        function (insertErr) {
          if (insertErr) {
            console.error(`建立公司失敗 [${company.name}]:`, insertErr.message);
            return done(insertErr);
          }
          insertedCompanyIds[company.name] = this.lastID;
          console.log(`✔ 建立公司: ${company.name} (id=${this.lastID}, ${company.category})`);
          companyIdx += 1;
          done(null);
        }
      );
    });
  };

  // 2. 查詢現有公司（倉庫 / 客戶分類）
  const fetchCompanies = (cb) => {
    db.all('SELECT id, category, name FROM companies ORDER BY id', (err, rows) => {
      if (err) return cb(err);
      cb(null, rows);
    });
  };

  // 3. 產生一筆訂單
  const insertOrder = (order, done) => {
    db.run(
      `INSERT INTO orders (
         order_no, order_type, mawb, hawb, pickup_no, pickup_datetime,
         customer_company_id, pickup_company_id, delivery_company_id,
         cargo_desc, quantity, weight_kg, cbm, cbm_dimensions,
         power_type, power_code, power_items, urgent,
         receiver_name, receiver_phone, address, receiver_note, contact_note,
         notes, transport_company, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.order_no, order.order_type, order.mawb, order.hawb, order.pickup_no,
        order.pickup_datetime,
        order.customer_company_id, order.pickup_company_id, order.delivery_company_id,
        order.cargo_desc, order.quantity, order.weight_kg, order.cbm, order.cbm_dimensions,
        order.power_type, order.power_code, order.power_items, order.urgent,
        order.receiver_name, order.receiver_phone, order.address,
        order.receiver_note, order.contact_note,
        order.notes, order.transport_company, order.status
      ],
      function (err) {
        if (err) {
          console.error(`建立訂單失敗 [${order.order_no}]:`, err.message);
          return done(err);
        }
        done(null);
      }
    );
  };

  // 依序建立公司
  const createCompaniesSeq = (idx, cb) => {
    if (idx >= NEW_COMPANIES.length) return cb();
    createCompany(NEW_COMPANIES[idx], () => createCompaniesSeq(idx + 1, cb));
  };

  createCompaniesSeq(0, () => {
    fetchCompanies((err, companies) => {
      if (err) {
        console.error('查詢公司失敗:', err.message);
        process.exit(1);
      }
      const warehouses = companies.filter(c => c.category === 'warehouse');
      const customers = companies.filter(c => c.category === 'customer');
      if (!warehouses.length || !customers.length) {
        console.error('公司資料不足（需要至少 1 倉庫 + 1 客戶）');
        process.exit(1);
      }

      // 找到目前最大的訂單號碼序號（預設 4，承接既有 4 筆）
      db.get("SELECT order_no FROM orders WHERE order_no LIKE 'AGL-20260805-%' ORDER BY id DESC LIMIT 1", (err, row) => {
        let seq = 4;
        if (row) {
          const lastSeq = parseInt(String(row.order_no).split('-').pop(), 10);
          if (!isNaN(lastSeq)) seq = lastSeq;
        }

        const TOTAL = 30;
        let doneCount = 0;
        let mawbUsed = new Set();

        for (let i = 0; i < TOTAL; i++) {
          seq += 1;
          const orderType = Math.random() < 0.6 ? 'pickup' : 'delivery'; // 60% 收貨、40% 送貨
          const customer = pick(customers);
          const warehouse = pick(warehouses);

          // 依訂單類型決定收/送貨地點
          // pickup（收貨）：收貨地點 = 客戶公司，交回地點 = 倉庫
          // delivery（送貨）：取貨地點 = 倉庫，送貨目的地 = 客戶公司
          let pickupCompanyId, deliveryCompanyId;
          if (orderType === 'pickup') {
            pickupCompanyId = customer.id;
            deliveryCompanyId = warehouse.id;
          } else {
            pickupCompanyId = warehouse.id;
            deliveryCompanyId = customer.id;
          }

          // MAWB：10% 後補（用「後補MAWB#」），其餘產生合法 MAWB；確保不重複
          let mawb = MAWB_LATE_LABEL;
          if (Math.random() < 0.9) {
            let candidate;
            do {
              candidate = randomMawb();
            } while (mawbUsed.has(candidate));
            mawbUsed.add(candidate);
            const v = validateMawb(candidate);
            mawb = v.valid ? v.formatted : MAWB_LATE_LABEL;
          }

          const powerType = (() => {
            const r = Math.random();
            if (r < 0.6) return 'no';
            if (r < 0.85) return 'dry';
            return 'lithium';
          })();
          const powerCode = powerType === 'no' ? '' : pick(['UN3480', 'UN3481', 'UN3171']);
          const powerItems = powerType === 'no'
            ? null
            : JSON.stringify([
                { type: powerType === 'dry' ? '鋰金屬電池' : '鋰離子電池', code: powerCode, qty: randInt(1, 4), weight: randInt(1, 15) }
              ]);

          const status = (() => {
            const r = Math.random();
            if (r < 0.4) return 'pending';
            if (r < 0.7) return 'in_progress';
            return 'completed';
          })();

          const quantity = randInt(1, 20);
          const weight = Number((Math.random() * 800 + 10).toFixed(2));
          const cbm = Number((Math.random() * 8 + 0.3).toFixed(3));
          const cbmDimensions = JSON.stringify([
            { len: randInt(30, 200), wid: randInt(30, 120), hgt: randInt(20, 100), qty: clamp(Math.ceil(quantity / 2), 1, quantity) }
          ]);
          const receiver = pick(RECEIVERS);
          const urgent = Math.random() < 0.2 ? 'yes' : 'no';
          const notes = truncate(pick(NOTES_POOL), 500);
          const receiverNote = truncate(pick(NOTES_POOL), 500);
          const contactNote = truncate(pick(NOTES_POOL), 500);

          const order = {
            order_no: `AGL-20260805-${String(seq).padStart(3, '0')}`,
            order_type: orderType,
            mawb,
            hawb: randomHawb(),
            pickup_no: randomPickupNo(seq),
            pickup_datetime: randomPickupDatetime(),
            customer_company_id: customer.id,
            pickup_company_id: pickupCompanyId,
            delivery_company_id: deliveryCompanyId,
            cargo_desc: pick(CARGO_DESCS),
            quantity,
            weight_kg: weight,
            cbm,
            cbm_dimensions: cbmDimensions,
            power_type: powerType,
            power_code: powerCode,
            power_items: powerItems,
            urgent,
            receiver_name: receiver.name,
            receiver_phone: receiver.phone,
            address: customer.address || '',
            receiver_note: receiverNote,
            contact_note: contactNote,
            notes,
            transport_company: pick(TRANSPORT_COMPANIES),
            status
          };

          insertOrder(order, (insertErr) => {
            if (insertErr) {
              console.error(`✘ 訂單 ${order.order_no} 建立失敗`);
            } else {
              const typeLabel = orderType === 'pickup' ? '收貨' : '送貨';
              console.log(
                `✔ 訂單 ${order.order_no} | ${typeLabel} | pickup=${order.pickup_datetime} | ` +
                `${customer.name} ↔ ${warehouse.name} | ${quantity}件 ${weight}kg ${cbm}cbm | ${status}`
              );
            }
            doneCount += 1;
            if (doneCount === TOTAL) {
              console.log(`\n✅ 完成！共建立 ${TOTAL} 筆 DUMMY 訂單（序號 AGL-20260805-005 ~ AGL-20260805-${String(seq).padStart(3, '0')}）`);
              process.exit(0);
            }
          });
        }
      });
    });
  });
});