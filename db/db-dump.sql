-- ==============================================
-- AGL-Web-Portal 資料庫快照
-- 匯出時間: 2026-08-11T05:00:05.148Z
-- 共 5 張資料表
-- 還原方式: npm run db:import
-- ==============================================

-- ===== 資料表: companies =====
DROP TABLE IF EXISTS "companies";
CREATE TABLE companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT DEFAULT 'customer',
      name TEXT,
      address TEXT,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (1, 'customer', 'BCD1234', '', '', '', '', '', '2026-08-07 16:41:58');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (2, 'customer', 'XX LOG', 'XX LOG', 'XX', '111', '11', 'remark 111', '2026-08-07 16:41:58');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (3, 'warehouse', 'KL', 'KLL ADDR', 'KL PIC', '222', '22@', 'TEST REMARK 2', '2026-08-07 16:41:58');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (4, 'customer', 'JST', '', '', '', '', '', '2026-08-07 16:43:19');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (5, 'warehouse', '遠雄自貿港區倉儲', '桃園市大園區航翔路 101 號', '陳建宏', '03-393-8800', 'tfc@farglory.com.tw', '航空貨運站專用倉', '2026-08-07 17:03:36');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (6, 'warehouse', '华辉物流中心', '深圳市宝安区机场物流园 8 栋', '王海涛', '+86-755-2998-1122', 'ops@huahui-sz.com', '', '2026-08-07 17:03:36');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (7, 'warehouse', '冠捷倉儲', '香港葵涌葵昌路 50 號', '李志明', '+852-2612-3300', 'wh@tps.com.hk', 'Dangerous Goods 收貨點', '2026-08-07 17:03:36');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (8, 'customer', '虹光精密工業股份有限公司', '新竹科學園區研新一路 20 號', '林佳穎', '03-578-2388', 'supply@avision.com.tw', 'ISO 認證廠商', '2026-08-07 17:03:36');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (9, 'customer', '天鈺科技股份有限公司', '', '', '', '', '', '2026-08-07 17:03:36');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (10, 'customer', '聯亞光電工業股份有限公司', '台南市善化區南科九路 12 號', '劉怡君', '06-505-1666', 'procure@landmark-tw.com', '需預約進廠', '2026-08-07 17:03:36');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (11, 'customer', '宏碁智通股份有限公司', '新北市汐止區新台五路一段 88 號 22 樓', '吳佩珊', '02-2696-1234', 'scm@acerits.com', '', '2026-08-07 17:03:36');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (12, 'customer', '緯創資通股份有限公司', '新竹科學園區新安路 5 號', '黃國倫', '03-578-3456', 'logistics@wistron.com', 'Bonded 快遞件', '2026-08-07 17:03:36');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (13, 'customer', '泰金寶電通股份有限公司', '新北市深坑區北深路三段 147 號', '許文龍', '02-2662-6688', 'dispatch@ccet.com.tw', '', '2026-08-07 17:03:36');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (14, 'customer', '樺漢科技股份有限公司', '新北市中和區建一路 186 號 9 樓', '鄭雅文', '02-8226-7799', 'purchasing@enoc.com', '午休不收貨', '2026-08-07 17:03:36');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (15, 'customer', '港龍 - KONG LUNG', '葵涌货柜码头路88号永得利广场二期2楼11,12号位', 'Charlie', '852-84901845', '', '此票货物已到港，烦请帮忙安排，谢谢！', '2026-08-10 06:36:22');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (16, 'warehouse', '劍龍 - KL', '葵涌一號貨櫃碼頭現代貨倉大廈一期1樓09-10室', '', '852-21229093', 'hq@kimlung.com', '🚨🚨備注: 大廈高度限制4.3M (高櫃不能進入)🚨🚨
劍龍登記費: 
20:00前 - HKD 400.00
20:00後 - HKD 600.00
MTL大樓入閘費:
HKD 80.00', '2026-08-10 06:36:22');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at") VALUES (17, 'customer', 'HACTL', 'SuperTerminal 1 9 Chun Wan Road Hong Kong International Airport Hong Kong', '', '27532421', '', '', '2026-08-10 07:16:52');


-- ===== 資料表: note_templates =====
DROP TABLE IF EXISTS "note_templates";
CREATE TABLE note_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

INSERT INTO "note_templates" ("id", "name", "content", "created_at") VALUES (1, 'TEST 1', 'TESTING 222', '2026-08-07 16:30:24');

INSERT INTO "note_templates" ("id", "name", "content", "created_at") VALUES (2, 'REMARK 2', '呢個係建立文字範本二', '2026-08-07 16:55:52');

INSERT INTO "note_templates" ("id", "name", "content", "created_at") VALUES (3, '收貨前, 請提供司機資料 TEL', '收貨前, 請提供司機資料', '2026-08-10 06:36:10');


-- ===== 資料表: orders =====
DROP TABLE IF EXISTS "orders";
CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT,
      order_type TEXT,
      mawb TEXT,
      hawb TEXT,
      pickup_no TEXT,
      customer_company_id INTEGER,
      pickup_company_id INTEGER,
      delivery_company_id INTEGER,
      cargo_desc TEXT,
      quantity INTEGER,
      weight_kg REAL,
      cbm REAL,
      cbm_dimensions TEXT,
      power_type TEXT DEFAULT 'no',
      power_code TEXT,
      power_items TEXT,
      urgent TEXT DEFAULT 'no',
      receiver_name TEXT,
      receiver_phone TEXT,
      address TEXT,
      notes TEXT,
      transport_company TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , receiver_note TEXT, contact_note TEXT, pickup_datetime TEXT, dest TEXT);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (1, 'AGL-20260808-002', 'pickup', '158-0000 0000', '', 'AAA1111', 4, 2, 3, '0', 100, 1500, 18, '[{"len":50,"width":60,"height":60,"qty":100}]', 'late', '後補電池資訊', '[]', 'no', '', '', '', '呢個係建立文字範本二', '', 'pending', '2026-08-07 16:41:58', '2026-08-07 16:56:00', '', '', '2026-08-08 00:45', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (2, 'AGL-20260810-003', 'pickup', '294-7938 1864', '159080745768', 'PK2608-0003', 14, 14, 5, '醫材配件', 15, 499.22, 4.679, '[{"len":39,"wid":55,"hgt":66,"qty":8}]', 'no', NULL, NULL, 'yes', '李婉婷', '0933-123-456', '', '需冷藏保存', 'UPS', 'pending', '2026-08-07 17:03:36', '2026-08-08 16:21:57', '貴重物品，小心搬運', '易碎品，勿重壓', '2026-08-10 08:45', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (3, 'AGL-20260808-007', 'delivery', '166-1467 6992', '920334184891', 'PK2608-0007', 1, 3, 1, '消費性電子產品', 2, 40.79, 6.059, '[{"len":114,"wid":115,"hgt":98,"qty":1}]', 'no', '', NULL, 'no', '陳家豪', '0912-345-678', '', '到貨前 30 分鐘請先通知收件人', 'TNT', 'in_progress', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '棧板裝卸，需堆高機', '需冷藏保存', '2026-08-08 13:00', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (4, 'AGL-20260809-008', 'pickup', '068-3455 8882', '450337598892', 'PK2608-0008', 2, 2, 6, '鋰電池組（已申報）', 14, 171.04, 8.117, '[{"len":155,"wid":30,"hgt":76,"qty":7}]', 'no', '', NULL, 'yes', '陳淑惠', '0910-999-000', '', '', 'FedEx', 'completed', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '內含電池，需獨立存放', '需冷藏保存', '2026-08-09 12:00', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (5, 'AGL-20260810-009', 'pickup', '312-4771 1963', '168989635078', 'PK2608-0009', 8, 8, 6, '光學鏡頭', 3, 642.76, 1.258, '[{"len":146,"wid":32,"hgt":94,"qty":2}]', 'no', '', NULL, 'no', '張文忠', '0928-666-333', '', '夾鏈袋包裝', '中華航空貨運', 'in_progress', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '棧板裝卸，需堆高機', '', '2026-08-10 14:30', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (6, 'AGL-20260809-010', 'pickup', '414-8756 6625', '840579040549', 'PK2608-0010', 9, 9, 6, '液晶顯示面板', 9, 150.35, 7.306, '[{"len":103,"wid":45,"hgt":94,"qty":5}]', 'no', '', NULL, 'no', '陳淑惠', '0910-999-000', '', '內含電池，需獨立存放', '國泰航空貨運', 'in_progress', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '到貨前 30 分鐘請先通知收件人', '', '2026-08-09 10:30', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (7, 'AGL-20260810-011', 'pickup', '418-5324 0762', '388259025726', 'PK2608-0011', 9, 9, 3, '消費性電子產品', 4, 220.64, 3.558, '[{"len":106,"wid":60,"hgt":81,"qty":2}]', 'dry', 'UN3480', '[{"type":"鋰金屬電池","code":"UN3480","qty":3,"weight":6}]', 'no', '張文忠', '0928-666-333', '', '到貨前 30 分鐘請先通知收件人', 'TNT', 'completed', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '內含電池，需獨立存放', '到貨前 30 分鐘請先通知收件人', '2026-08-10 09:30', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (8, 'AGL-20260809-012', 'delivery', '752-7575 4195', '571460922109', 'PK2608-0012', 14, 6, 14, '電子零件（IC 封裝）', 19, 609.29, 2.847, '[{"len":104,"wid":75,"hgt":82,"qty":10}]', 'lithium', 'UN3481', '[{"type":"鋰離子電池","code":"UN3481","qty":4,"weight":11}]', 'no', '李婉婷', '0933-123-456', '', '需冷藏保存', 'FedEx', 'completed', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '棧板裝卸，需堆高機', '夾鏈袋包裝', '2026-08-09 15:00', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (9, 'AGL-20260808-013', 'delivery', '後補MAWB#', '376632220760', 'PK2608-0013', 8, 7, 8, '電子零件（IC 封裝）', 14, 34.45, 3.212, '[{"len":178,"wid":95,"hgt":32,"qty":7}]', 'dry', 'UN3481', '[{"type":"鋰金屬電池","code":"UN3481","qty":2,"weight":4}]', 'no', '劉志明', '0988-111-222', '', '夾鏈袋包裝', '國泰航空貨運', 'pending', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '', '到貨前 30 分鐘請先通知收件人', '2026-08-08 14:30', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (10, 'AGL-20260810-014', 'pickup', '164-8873 1193', '207113939250', 'PK2608-0014', 11, 11, 5, '醫材配件', 15, 314.23, 6.802, '[{"len":152,"wid":87,"hgt":72,"qty":8}]', 'dry', 'UN3481', '[{"type":"鋰金屬電池","code":"UN3481","qty":1,"weight":14}]', 'no', '王世杰', '0955-777-888', '', '棧板裝卸，需堆高機', '長榮航空貨運', 'completed', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '到貨前 30 分鐘請先通知收件人', '貴重物品，小心搬運', '2026-08-10 18:15', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (11, 'AGL-20260810-015', 'delivery', '532-9980 2721', '722053481727', 'PK2608-0015', 14, 3, 14, '消費性電子產品', 1, 296.84, 1.902, '[{"len":78,"wid":36,"hgt":47,"qty":1}]', 'no', '', NULL, 'no', '陳淑惠', '0910-999-000', '', '需冷藏保存', 'DHL', 'pending', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '棧板裝卸，需堆高機', '易碎品，勿重壓', '2026-08-10 11:00', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (12, 'AGL-20260809-016', 'pickup', '194-6911 9746', '354787620126', 'PK2608-0016', 1, 1, 7, '機械配件', 14, 142.22, 0.727, '[{"len":197,"wid":83,"hgt":23,"qty":7}]', 'no', '', NULL, 'no', '陳家豪', '0912-345-678', '', '需冷藏保存', '順豐速運', 'completed', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '內含電池，需獨立存放', '', '2026-08-09 20:45', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (13, 'AGL-20260810-017', 'delivery', '826-0842 6876', '63218405905', 'PK2608-0017', 4, 3, 4, '鋰電池組（已申報）', 7, 321.98, 2.575, '[{"len":105,"wid":71,"hgt":29,"qty":4}]', 'dry', 'UN3480', '[{"type":"鋰金屬電池","code":"UN3480","qty":4,"weight":15}]', 'no', '陳淑惠', '0910-999-000', '', '貴重物品，小心搬運', '中華航空貨運', 'pending', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '貴重物品，小心搬運', '', '2026-08-10 11:15', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (14, 'AGL-20260810-004', 'pickup', '091-4662 3290', '955708850054', 'PK2608-0004', 10, 10, 3, 'LED 燈珠', 11, 365.25, 5.419, '[{"len":157,"wid":69,"hgt":41,"qty":6}]', 'no', '', NULL, 'yes', '張文忠', '0928-666-333', '', '', 'FedEx', 'in_progress', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '內含電池，需獨立存放', '貴重物品，小心搬運', '2026-08-10 16:30', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (15, 'AGL-20260810-005', 'delivery', '394-7165 6852', '311236341379', 'PK2608-0005', 10, 7, 10, '醫材配件', 12, 720.11, 5.328, '[{"len":131,"wid":34,"hgt":89,"qty":6}]', 'dry', 'UN3480', '[{"type":"鋰金屬電池","code":"UN3480","qty":3,"weight":13}]', 'no', '李婉婷', '0933-123-456', '', '棧板裝卸，需堆高機', 'FedEx', 'in_progress', '2026-08-07 17:03:36', '2026-08-07 17:03:36', '易碎品，勿重壓', '', '2026-08-10 17:45', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (16, 'AGL-20260808-006', 'pickup', '後補MAWB#', '953392886020', 'PK2608-0006', 9, 9, 7, '液晶顯示面板', 3, 84.3, 4.73, '[{"len":95,"wid":39,"hgt":40,"qty":2}]', 'lithium', '966', '[{"type":"lithium","main":"ELI","code":"966","qty":"1"},{"type":"no","main":"","code":"無電","qty":"2"},{"type":"dry","main":"","code":"A67","qty":"99"}]', 'no', '', '', '', '夾鏈袋包裝', '', 'pending', '2026-08-07 17:03:36', '2026-08-07 17:15:34', '', '', '2026-08-08 14:15', NULL);

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (17, 'AGL-20260809-017', 'pickup', '157-0000 0000', 'ABC22222', 'JST11111', 4, 2, 3, '0', 5, 10, 1, '[{"len":40,"width":50,"height":50,"qty":10}]', 'no', NULL, '[{"type":"no","main":"","code":"無電","qty":""}]', 'yes', '', '', '', '呢個係建立文字範本二', '', 'pending', '2026-08-08 16:15:39', '2026-08-08 17:37:49', '', '', '2026-08-09 00:00', '');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (18, 'AGL-20260809-018', 'pickup', '575-8253 0486', 'HAWB111261960', 'DMY-20260809-001', 8, 8, 5, '電子零件（IC 封裝）', 5, 42.5, 0.62, '[{"len":60,"width":40,"height":30,"qty":5}]', 'no', NULL, '[{"type":"no","main":"","code":"無電","qty":"5"}]', 'no', '', '', '', 'DUMMY 收貨訂單 1', '', 'pending', '2026-08-08 17:45:26', '2026-08-08 17:45:26', '', '', '2026-08-09 01:45', 'TPE');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (19, 'AGL-20260809-019', 'pickup', '836-0403 7364', 'HAWB111262261', 'DMY-20260809-002', 12, 12, 7, 'PCBA 模組', 12, 156.8, 2.35, '[{"len":60,"width":40,"height":30,"qty":12}]', 'dry', 'A67', '[{"type":"dry","main":"","code":"A67","qty":"12"}]', 'yes', '', '', '', 'DUMMY 收貨訂單 2', '', 'pending', '2026-08-08 17:45:26', '2026-08-08 17:45:26', '', '', '2026-08-09 01:45', 'TPE');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (20, 'AGL-20260809-020', 'delivery', '702-2808 2596', 'HAWB111262482', 'DMY-20260809-003', 14, 6, 14, '光學鏡頭', 8, 76.3, 1.18, '[{"len":60,"width":40,"height":30,"qty":8}]', 'lithium', 'PI967', '[{"type":"lithium","main":"ELI","code":"PI967","qty":"8"}]', 'no', '', '', '', 'DUMMY 送貨訂單 1', '', 'pending', '2026-08-08 17:45:26', '2026-08-08 17:45:26', '', '', '2026-08-09 01:45', 'HKG');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (21, 'AGL-20260809-021', 'pickup', '160-0000 0000', 'CCC111', 'JST123456', 4, 2, 3, '0', 15, 55, 0.1, NULL, 'dry', 'A67', '[{"type":"no","main":"","code":"無電","qty":""},{"type":"dry","main":"","code":"A67","qty":"6"}]', 'yes', '', '', '', '呢個係建立文字範本二', '', 'pending', '2026-08-08 18:20:40', '2026-08-08 18:22:14', '', '', '2026-08-09 05:45', 'SVO');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (22, 'AGL-20260810-006', 'pickup', '176-6558 7594', 'BGJST01060731', '61091657', 4, 15, 16, '0', 1, 91, 0.18, '[{"len":56,"width":53,"height":60,"qty":1}]', 'lithium', 'PI970', '[{"type":"lithium","main":"ELM","code":"PI970","qty":"1"}]', 'no', '', '', '', '收貨前, 請提供司機資料', '', 'completed', '2026-08-10 06:36:22', '2026-08-10 15:42:30', '', '', '2026-08-10 21:45', 'KWI');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (23, 'AGL-20260810-007', 'delivery', '161-0000 0000', '161AAA00000', 'JST123000', 4, 15, 17, '0', 15, 100, 0.52, NULL, 'lithium', 'PI967', '[{"type":"lithium","main":"ELI","code":"PI967","qty":"15"}]', 'yes', '', '', '', 'RCL放5006', '', 'pending', '2026-08-10 07:16:52', '2026-08-10 07:16:52', '', '', '2026-08-10 21:00', 'IKA');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (24, 'AGL-20260810-008', 'pickup', '162-0000 0000', '1234567890123', 'JST260810002', 4, 17, 16, 'CONNECTOR', 65, 450, 6, '[{"len":120,"width":100,"height":100,"qty":5}]', 'lithium', 'PI967', '[{"type":"lithium","main":"ELI","code":"PI967","qty":"10"}]', 'no', '', '', '', '機場提入口貨', '', 'pending', '2026-08-10 15:45:15', '2026-08-10 15:45:15', '', '', '2026-08-11 13:30', 'GOT');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (25, 'AGL-20260811-001', 'pickup', '163-0000 0000', 'HFS000001', 'Qwttt1222-3', 4, 15, 16, '0', 12, 550, 7.26, '[{"len":110,"width":110,"height":100,"qty":6}]', 'lithium', 'A123', '[{"type":"dry","main":"","code":"A123","qty":"12"},{"type":"lithium","main":"ELI","code":"PI967","qty":"10"}]', 'yes', '', '', '', '先去收貨，詳細資料候補
收貨前, 請提供司機資料', '', 'completed', '2026-08-11 04:42:05', '2026-08-11 04:51:04', '', '', '2026-08-11 15:30', 'DUS');


-- ===== 資料表: skills =====
DROP TABLE IF EXISTS "skills";
CREATE TABLE skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      name TEXT,
      level INTEGER
    );

INSERT INTO "skills" ("id", "category", "name", "level") VALUES (1, '核心能力', '多模態理解與生成', 95);

INSERT INTO "skills" ("id", "category", "name", "level") VALUES (2, '核心能力', '程式碼編寫與除錯', 92);

INSERT INTO "skills" ("id", "category", "name", "level") VALUES (3, '核心能力', '邏輯推理與分析', 90);

INSERT INTO "skills" ("id", "category", "name", "level") VALUES (4, '長處', '上下文處理能力', 95);

INSERT INTO "skills" ("id", "category", "name", "level") VALUES (5, '長處', '自動化工作流程整合', 88);


-- ===== 資料表: templates =====
DROP TABLE IF EXISTS "templates";
CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      company_id INTEGER,
      cargo_desc TEXT,
      quantity INTEGER,
      weight_kg REAL,
      cbm REAL,
      power_type TEXT DEFAULT 'no',
      receiver_name TEXT,
      receiver_phone TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

-- (無資料)

-- ===== sqlite_sequence (AUTOINCREMENT 計數器) =====
INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 17);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 25);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 17);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 24);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 17);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 23);

