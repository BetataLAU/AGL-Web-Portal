-- ==============================================
-- AGL-Web-Portal 資料庫快照
-- 匯出時間: 2026-08-22T16:37:45.929Z
-- 共 17 張資料表
-- 還原方式: npm run db:import
-- ==============================================

-- ===== 資料表: audit_log =====
DROP TABLE IF EXISTS "audit_log";
CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT,
      actor_display TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (1, 'admin', '系統管理員', 'pallet.plan.create', 'pallet_plan', '1', '新增打板計劃 AGL-20260812-01', '2026-08-12 07:52:04');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (2, 'admin', '系統管理員', 'pallet.booking.create', 'mawb_record', '1', '新增 Booking 176-6451 7585', '2026-08-12 07:52:26');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (3, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '1', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 07:52:57');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (4, 'admin', '系統管理員', 'pallet.plan.status_change', 'pallet_plan', '1', 'draft → locked（AGL-20260812-01）', '2026-08-12 07:53:27');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (5, 'admin', '系統管理員', 'pallet.plan.status_change', 'pallet_plan', '1', 'locked → draft（AGL-20260812-01）', '2026-08-12 07:54:03');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (6, 'admin', '系統管理員', 'pallet.plan.delete', 'pallet_plan', '1', '刪除打板計劃 AGL-20260812-01', '2026-08-12 07:54:14');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (7, 'admin', '系統管理員', 'pallet.booking.delete', 'mawb_record', '1', '刪除 Booking 1', '2026-08-12 07:54:14');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (8, 'admin', '系統管理員', 'pallet.plan.create', 'pallet_plan', '2', '新增打板計劃 AGL-20260812-01', '2026-08-12 08:14:55');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (9, 'admin', '系統管理員', 'pallet.plan.delete', 'pallet_plan', '2', '刪除打板計劃 AGL-20260812-01', '2026-08-12 08:15:09');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (10, 'admin', '系統管理員', 'pallet.plan.create', 'pallet_plan', '3', '新增打板計劃 AGL-20260812-01', '2026-08-12 08:47:03');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (11, 'admin', '系統管理員', 'pallet.booking.create', 'mawb_record', '2', '新增 Booking 176-0000 0000', '2026-08-12 09:05:19');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (12, 'admin', '系統管理員', 'pallet.remark_templates.create', 'remark_template', '9', '新增備註範本 REMARK', '2026-08-12 09:05:19');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (13, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 09:05:32');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (14, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 09:07:22');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (15, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 09:07:24');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (16, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #2', '2026-08-12 09:08:36');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (17, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 09:08:43');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (18, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 09:08:57');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (19, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #2', '2026-08-12 09:08:59');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (20, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 09:09:01');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (21, 'admin', '系統管理員', 'pallet.booking.create', 'mawb_record', '3', '新增 Booking 176-6451 7585', '2026-08-12 09:12:10');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (22, 'admin', '系統管理員', 'pallet.remark_templates.create', 'remark_template', '10', '新增備註範本 今天自送到 JPS
5 PLTs
120 x 80 x 60...', '2026-08-12 09:12:10');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (23, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #2', '2026-08-12 09:12:14');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (24, 'admin', '系統管理員', 'pallet.booking.create', 'mawb_record', '4', '新增 Booking 176-6534 5232', '2026-08-12 09:13:01');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (25, 'admin', '系統管理員', 'pallet.remark_templates.create', 'remark_template', '11', '新增備註範本 JPS 卸車 (27-JUL) / 代貼 UN3481 電
...', '2026-08-12 09:13:01');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (26, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 2 筆 MAWB（重複 0 筆）', '2026-08-12 09:13:38');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (27, 'admin', '系統管理員', 'pallet.plan.create', 'pallet_plan', '4', '新增打板計劃 AGL-20260812-02', '2026-08-12 09:14:28');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (28, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 09:14:34');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (29, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 09:14:44');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (30, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 09:14:46');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (31, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 09:15:00');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (32, 'admin', '系統管理員', 'pallet.plan.status_change', 'pallet_plan', '3', 'draft → locked（AGL-20260812-01）', '2026-08-12 09:21:02');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (33, 'admin', '系統管理員', 'pallet.plan.status_change', 'pallet_plan', '3', 'locked → draft（AGL-20260812-01）', '2026-08-12 09:31:24');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (34, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #3', '2026-08-12 09:31:35');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (35, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #2', '2026-08-12 09:31:39');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (36, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #3', '2026-08-12 09:31:43');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (37, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 09:39:20');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (38, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 09:39:28');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (39, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 09:39:35');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (40, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 09:39:45');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (41, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #4', '2026-08-12 09:39:47');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (42, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 09:43:22');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (43, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #4', '2026-08-12 09:44:28');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (44, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #2', '2026-08-12 09:44:32');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (45, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #2', '2026-08-12 09:45:04');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (46, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 09:57:26');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (47, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 09:57:27');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (48, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 09:57:28');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (49, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 09:57:30');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (50, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 10:01:06');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (51, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 10:01:11');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (52, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 10:01:13');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (53, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 10:01:14');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (54, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #4', '2026-08-12 10:01:27');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (55, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #3', '2026-08-12 10:01:28');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (56, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #3', '2026-08-12 10:01:38');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (57, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 10:03:29');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (58, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #4', '2026-08-12 10:04:07');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (59, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 10:05:48');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (60, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 10:05:50');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (61, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 10:05:53');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (62, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #3', '2026-08-12 10:06:00');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (63, 'admin', '系統管理員', 'pallet.booking.create', 'mawb_record', '5', '新增 Booking 176-2334 8835', '2026-08-12 10:06:55');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (64, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 10:07:51');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (65, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 10:07:53');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (66, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #5', '2026-08-12 10:07:56');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (67, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 10:07:59');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (68, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 10:08:06');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (69, 'admin', '系統管理員', 'pallet.booking.update', 'mawb_record', '5', '更新 Booking 176-2334 8835', '2026-08-12 12:32:46');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (70, 'admin', '系統管理員', 'pallet.booking.create', 'mawb_record', '6', '新增 Booking 176-6558 1482', '2026-08-12 12:43:50');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (71, 'admin', '系統管理員', 'pallet.remark_templates.create', 'remark_template', '12', '新增備註範本 ELI 967 = 99 PKGS', '2026-08-12 12:43:50');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (72, 'admin', '系統管理員', 'pallet.booking.create', 'mawb_record', '7', '新增 Booking 176-6534 5534', '2026-08-12 12:44:53');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (73, 'admin', '系統管理員', 'pallet.remark_templates.create', 'remark_template', '13', '新增備註範本 NO BATT', '2026-08-12 12:44:53');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (74, 'admin', '系統管理員', 'pallet.booking.create', 'mawb_record', '8', '新增 Booking 176-1564 2491', '2026-08-12 12:46:05');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (75, 'admin', '系統管理員', 'pallet.spl_codes.create', 'spl_code', '20', '新增 SPL 代碼 ELI, ELM', '2026-08-12 12:46:05');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (76, 'admin', '系統管理員', 'pallet.remark_templates.create', 'remark_template', '14', '新增備註範本 ELI = 10 PKGS
ELM = 10 PKGS
-代...', '2026-08-12 12:46:05');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (77, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-12 12:48:50');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (78, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-12 12:48:52');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (79, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 2 筆 MAWB（重複 2 筆）', '2026-08-12 12:49:01');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (80, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 2 筆）', '2026-08-12 12:49:09');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (81, 'admin', '系統管理員', 'create_user', 'user', '2', '建立使用者 nelson（admin）', '2026-08-13 06:27:38');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (82, 'admin', '系統管理員', 'pallet.plan.update', 'pallet_plan', '4', '更新打板計劃 AGL-20260812-02', '2026-08-13 07:30:24');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (83, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 07:38:26');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (84, 'admin', '系統管理員', 'pallet.plan.status_change', 'pallet_plan', '4', 'draft → locked（AGL-20260812-02）', '2026-08-13 07:39:25');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (85, 'admin', '系統管理員', 'pallet.plan.status_change', 'pallet_plan', '4', 'locked → draft（AGL-20260812-02）', '2026-08-13 07:39:57');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (86, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 2 筆 MAWB（重複 0 筆）', '2026-08-13 07:43:50');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (87, 'admin', '系統管理員', 'pallet.plan.create', 'pallet_plan', '5', '新增打板計劃 AGL-20260813-01', '2026-08-13 07:49:10');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (88, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 3 筆 MAWB（重複 0 筆）', '2026-08-13 07:49:43');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (89, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 07:50:05');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (90, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 07:50:34');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (91, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #8', '2026-08-13 07:51:10');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (92, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #4', '2026-08-13 07:52:37');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (93, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #6', '2026-08-13 07:52:37');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (94, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #7', '2026-08-13 07:52:37');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (95, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #3', '2026-08-13 07:52:37');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (96, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #6', '2026-08-13 07:52:43');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (97, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #4', '2026-08-13 07:52:44');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (98, 'admin', '系統管理員', 'pallet.booking.update', 'mawb_record', '8', '更新 Booking 176-1564 2490', '2026-08-13 07:53:10');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (99, 'admin', '系統管理員', 'pallet.booking.update', 'mawb_record', '8', '更新 Booking 176-1564 2490', '2026-08-13 07:53:28');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (100, 'admin', '系統管理員', 'pallet.booking.update', 'mawb_record', '8', '更新 Booking 176-1564 2491', '2026-08-13 07:53:39');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (101, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 08:02:43');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (102, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 08:26:50');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (103, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #8', '2026-08-13 09:20:15');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (104, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #7', '2026-08-13 09:20:15');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (105, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #3', '2026-08-13 09:20:17');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (106, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #5', '2026-08-13 09:20:17');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (107, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-13 09:20:22');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (108, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:20:27');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (109, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-13 09:20:33');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (110, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-13 09:20:36');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (111, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:20:40');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (112, 'admin', '系統管理員', 'pallet.sync_orders', 'orders', '', '同步訂單→打板：新增 25，更新 0，衝突 0', '2026-08-13 09:21:20');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (113, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:21:42');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (114, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:21:50');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (115, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #27', '2026-08-13 09:21:55');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (116, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-13 09:22:35');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (117, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-13 09:24:32');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (118, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:24:39');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (119, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-13 09:24:45');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (120, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:24:50');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (121, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-13 09:25:43');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (122, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:28:21');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (123, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:28:23');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (124, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:28:25');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (125, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #7', '2026-08-13 09:29:56');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (126, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #6', '2026-08-13 09:29:56');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (127, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #3', '2026-08-13 09:29:57');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (128, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:43:15');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (129, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:43:48');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (130, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #4', '2026-08-13 09:43:51');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (131, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #7', '2026-08-13 09:43:52');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (132, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #4', '2026-08-13 09:43:53');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (133, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-13 09:45:50');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (134, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 09:47:09');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (135, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 0 筆 MAWB（重複 1 筆）', '2026-08-13 10:05:57');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (136, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #5', '2026-08-13 10:05:57');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (137, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 10:06:00');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (138, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #27', '2026-08-13 10:06:00');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (139, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 10:25:26');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (140, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #6', '2026-08-13 10:25:26');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (141, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 10:25:40');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (142, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #4', '2026-08-13 10:25:40');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (143, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 10:25:41');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (144, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #3', '2026-08-13 10:25:41');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (145, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '3', 'AGL-20260812-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 10:25:42');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (146, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #5', '2026-08-13 10:25:42');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (147, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 10:25:44');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (148, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #3', '2026-08-13 10:25:44');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (149, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 12:33:00');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (150, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #27', '2026-08-13 12:33:00');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (151, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 13:00:12');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (152, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #2', '2026-08-13 13:00:12');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (153, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 13:12:48');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (154, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #2', '2026-08-13 13:12:48');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (155, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-13 13:13:02');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (156, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 3 筆 MAWB（重複 1 筆）', '2026-08-13 13:13:16');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (157, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-14 04:16:15');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (158, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #6', '2026-08-14 04:16:15');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (159, 'admin', '系統管理員', 'create_user', 'user', '3', '建立使用者 user（staff）', '2026-08-14 04:26:45');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (160, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-14 05:08:51');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (161, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '5', 'AGL-20260813-01 移出 MAWB #8', '2026-08-14 05:08:51');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (162, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-14 05:08:53');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (163, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #31', '2026-08-14 05:08:53');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (164, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-14 05:08:53');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (165, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #30', '2026-08-14 05:08:54');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (166, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-14 05:08:54');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (167, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #29', '2026-08-14 05:08:54');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (168, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-14 05:08:55');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (169, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '4', 'AGL-20260812-02 移出 MAWB #2', '2026-08-14 05:08:55');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (170, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '4', 'AGL-20260812-02 加入 1 筆 MAWB（重複 0 筆）', '2026-08-14 05:08:57');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (171, 'admin', '系統管理員', 'pallet.plan.remove_item', 'pallet_plan', '3', 'AGL-20260812-01 移出 MAWB #7', '2026-08-14 05:08:57');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (172, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '5', 'AGL-20260813-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-14 05:09:14');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (173, 'admin', '系統管理員', 'pallet.sync_orders', 'orders', '', '同步訂單→打板：新增 0，更新 25，衝突 0', '2026-08-14 06:34:15');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (174, 'admin', '系統管理員', 'pallet.sync_orders', 'orders', '', '同步訂單→打板：新增 1，更新 0，衝突 0', '2026-08-18 04:48:55');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (175, 'admin', '系統管理員', 'pallet.sync_orders', 'orders', '', '同步訂單→打板：新增 0，更新 1，衝突 0', '2026-08-18 09:14:58');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (176, 'admin', '系統管理員', 'pallet.plan.create', 'pallet_plan', '6', '新增打板計劃 AGL-20260822-01', '2026-08-22 05:27:39');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (177, 'admin', '系統管理員', 'pallet.sync_orders', 'orders', '', '同步訂單→打板：新增 4，更新 1，衝突 0', '2026-08-22 05:27:46');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (178, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '6', 'AGL-20260822-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-22 05:27:50');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (179, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '6', 'AGL-20260822-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-22 05:27:54');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (180, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '6', 'AGL-20260822-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-22 05:28:06');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (181, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '6', 'AGL-20260822-01 加入 0 筆 MAWB（重複 1 筆）', '2026-08-22 05:29:57');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (182, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '6', 'AGL-20260822-01 加入 0 筆 MAWB（重複 1 筆）', '2026-08-22 05:29:59');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (183, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '6', 'AGL-20260822-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-22 05:30:02');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (184, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '6', 'AGL-20260822-01 加入 1 筆 MAWB（重複 0 筆）', '2026-08-22 16:33:16');

INSERT INTO "audit_log" ("id", "actor_user_id", "actor_display", "action", "target_type", "target_id", "detail", "created_at") VALUES (185, 'admin', '系統管理員', 'pallet.plan.add_items', 'pallet_plan', '6', 'AGL-20260822-01 加入 0 筆 MAWB（重複 1 筆）', '2026-08-22 16:33:26');


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
    , company_code TEXT);

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at", "company_code") VALUES (4, 'customer', 'JST', '', '', '', '', '', '2026-08-07 16:43:19', NULL);

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at", "company_code") VALUES (15, 'warehouse', '港龍 - KONG LUNG', '葵涌货柜码头路88号永得利广场二期2楼11,12号位', 'Charlie', '852-84901845', '', '', '2026-08-10 06:36:22', NULL);

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at", "company_code") VALUES (16, 'warehouse', '劍龍 - KL', '葵涌一號貨櫃碼頭現代貨倉大廈一期1樓09-10室', '', '852-21229093', 'hq@kimlung.com', '🚨🚨備注: 大廈高度限制4.3M (高櫃不能進入)🚨🚨
劍龍登記費: 
20:00前 - HKD 400.00
20:00後 - HKD 600.00
MTL大樓入閘費:
HKD 80.00', '2026-08-10 06:36:22', NULL);

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at", "company_code") VALUES (17, 'customer', 'HACTL', 'SuperTerminal 1 9 Chun Wan Road Hong Kong International Airport Hong Kong', '', '27532421', '', '', '2026-08-10 07:16:52', NULL);

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at", "company_code") VALUES (18, 'customer', 'AIR GLOBAL LIMITED - AGL', '', '', '', '', '', '2026-08-11 09:58:17', 'AGL');

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at", "company_code") VALUES (19, 'customer', '立馳行 - RS SZX', '', '', '', '', '', '2026-08-13 06:25:02', NULL);

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at", "company_code") VALUES (20, 'customer', '新鸿发', '青衣西草灣路,友聯船廠公司', '高佬', '34893823', '', '周一~周五10:00-20:00
周六    10:00-18:00', '2026-08-13 06:25:02', NULL);

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at", "company_code") VALUES (21, 'customer', 'CADICASIA HONG KONG LTD', '香港新界葵涌葵榮路27-37號成美工業大廈 7字樓 A室', 'Ricky Ng', '852 2610 1004 ext.6773', '', '(出分单）', '2026-08-18 03:11:41', NULL);

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at", "company_code") VALUES (22, 'customer', 'DGS(玖玖亿)', '', '', '', '', '', '2026-08-21 06:37:19', NULL);

INSERT INTO "companies" ("id", "category", "name", "address", "contact_person", "phone", "email", "notes", "created_at", "company_code") VALUES (23, 'customer', 'DGS提貨倉', '', '', '', '', '', '2026-08-21 06:37:19', NULL);


-- ===== 資料表: customers =====
DROP TABLE IF EXISTS "customers";
CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      hawb TEXT,
      customer_name TEXT,
      color_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

INSERT INTO "customers" ("id", "project_id", "hawb", "customer_name", "color_code", "created_at") VALUES (7, 4, 'TEST123456', 'GA Test', '#a29bfe', '2026-08-22 15:25:53');

INSERT INTO "customers" ("id", "project_id", "hawb", "customer_name", "color_code", "created_at") VALUES (8, 5, 'TEST123456', 'GA Test', '#a29bfe', '2026-08-22 15:26:27');

INSERT INTO "customers" ("id", "project_id", "hawb", "customer_name", "color_code", "created_at") VALUES (9, 6, 'TEST123456', 'GA Test', '#a29bfe', '2026-08-22 15:27:35');


-- ===== 資料表: items =====
DROP TABLE IF EXISTS "items";
CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      assigned_uld_id INTEGER,
      pack_type TEXT,
      length_cm REAL,
      width_cm REAL,
      height_cm REAL,
      pcs INTEGER,
      weight_kg REAL,
      is_stackable INTEGER DEFAULT 1,
      actual_type TEXT,
      note TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (7, 7, NULL, 'CTN', 60, 40, 40, 8, 15, 1, NULL, NULL, 'pending', '2026-08-22 15:25:53');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (8, 7, NULL, 'PLT', 120, 100, 150, 2, 400, 0, NULL, NULL, 'pending', '2026-08-22 15:25:53');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (9, 7, NULL, 'CTN', 80, 60, 50, 10, 25, 1, NULL, NULL, 'pending', '2026-08-22 15:25:53');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (10, 7, NULL, 'PLT', 200, 100, 80, 2, 300, 1, NULL, NULL, 'pending', '2026-08-22 15:25:53');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (11, 7, NULL, 'CTN', 40, 30, 25, 20, 5, 1, NULL, NULL, 'pending', '2026-08-22 15:25:53');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (12, 8, 18, 'CTN', 60, 40, 40, 8, 15, 1, NULL, NULL, 'pending', '2026-08-22 15:26:27');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (13, 8, 18, 'PLT', 120, 100, 150, 2, 400, 0, NULL, NULL, 'pending', '2026-08-22 15:26:27');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (14, 8, 18, 'CTN', 80, 60, 50, 10, 25, 1, NULL, NULL, 'pending', '2026-08-22 15:26:27');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (15, 8, 18, 'PLT', 200, 100, 80, 2, 300, 1, NULL, NULL, 'pending', '2026-08-22 15:26:27');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (16, 8, 18, 'CTN', 40, 30, 25, 20, 5, 1, NULL, NULL, 'pending', '2026-08-22 15:26:27');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (17, 9, 21, 'CTN', 60, 40, 40, 8, 15, 1, NULL, NULL, 'pending', '2026-08-22 15:27:35');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (18, 9, 21, 'PLT', 120, 100, 150, 2, 400, 0, NULL, NULL, 'pending', '2026-08-22 15:27:35');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (19, 9, 21, 'CTN', 80, 60, 50, 10, 25, 1, NULL, NULL, 'pending', '2026-08-22 15:27:35');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (20, 9, 21, 'PLT', 200, 100, 80, 2, 300, 1, NULL, NULL, 'pending', '2026-08-22 15:27:35');

INSERT INTO "items" ("id", "customer_id", "assigned_uld_id", "pack_type", "length_cm", "width_cm", "height_cm", "pcs", "weight_kg", "is_stackable", "actual_type", "note", "status", "created_at") VALUES (21, 9, 21, 'CTN', 40, 30, 25, 20, 5, 1, NULL, NULL, 'pending', '2026-08-22 15:27:35');


-- ===== 資料表: mawb_records =====
DROP TABLE IF EXISTS "mawb_records";
CREATE TABLE mawb_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mawb TEXT,
      hawb TEXT,
      client TEXT,
      dest TEXT,
      pcs INTEGER DEFAULT 0,
      gross_weight REAL DEFAULT 0,
      volume_weight REAL DEFAULT 0,
      cbm REAL DEFAULT 0,
      spl TEXT,
      remark TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , order_id INTEGER);

INSERT INTO "mawb_records" ("id", "mawb", "hawb", "client", "dest", "pcs", "gross_weight", "volume_weight", "cbm", "spl", "remark", "created_at", "updated_at", "order_id") VALUES (34, '176-6558 1515', 'TUN26081512', 'JST', 'TUN', 30, 287, 0, 0.94, '', '提貨號: INV# 26HKC-09436', '2026-08-18 04:48:55', '2026-08-22 05:27:46', 31);

INSERT INTO "mawb_records" ("id", "mawb", "hawb", "client", "dest", "pcs", "gross_weight", "volume_weight", "cbm", "spl", "remark", "created_at", "updated_at", "order_id") VALUES (35, '176-6557 6840', '', 'JST', 'TUN', 2, 19, 0, 0.1, '後補電池資訊', '提貨號: 962471551', '2026-08-22 05:27:46', '2026-08-22 05:27:46', 36);

INSERT INTO "mawb_records" ("id", "mawb", "hawb", "client", "dest", "pcs", "gross_weight", "volume_weight", "cbm", "spl", "remark", "created_at", "updated_at", "order_id") VALUES (36, '176-6557 6851', '', 'JST', 'CPT', 1, 35, 0, 0.35, '後補電池資訊', '提貨號: 962471653', '2026-08-22 05:27:46', '2026-08-22 05:27:46', 33);

INSERT INTO "mawb_records" ("id", "mawb", "hawb", "client", "dest", "pcs", "gross_weight", "volume_weight", "cbm", "spl", "remark", "created_at", "updated_at", "order_id") VALUES (37, '176-6557 6873', '', 'JST', 'AMM', 12, 115, 0, 0.68, '後補電池資訊', '提貨號: 962484518', '2026-08-22 05:27:46', '2026-08-22 05:27:46', 35);

INSERT INTO "mawb_records" ("id", "mawb", "hawb", "client", "dest", "pcs", "gross_weight", "volume_weight", "cbm", "spl", "remark", "created_at", "updated_at", "order_id") VALUES (38, '176-6557 6906', '', 'JST', 'EBB', 2, 128, 0, 0.75, '後補電池資訊', '提貨號: 61090108', '2026-08-22 05:27:46', '2026-08-22 05:27:46', 37);


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

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (31, 'AGL-20260818-001', 'pickup', '176-6558 1515', 'TUN26081512', 'INV# 26HKC-09436', 4, 21, 16, '0', 30, 287, 0.94, NULL, 'no', NULL, '[{"type":"no","main":"","code":"無電","qty":""}]', 'no', '', '', '', '此票货物请帮忙安排今天提货，提前1-2小时给司机资料，按以下订好的航班安排，谢谢！', '', 'pending', '2026-08-18 03:11:42', '2026-08-18 06:54:25', '', '', '2026-08-18 14:45', 'TUN');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (32, 'AGL-20260821-001', 'pickup', '後補MAWB#', '', 'AGL-DE-20260821', 22, 23, 16, '0', 17, 462, 3.06, '[{"len":50,"width":60,"height":60,"qty":17}]', 'late', '後補電池資訊', '[]', 'no', '', '', '', '請司機自備卡板', '', 'pending', '2026-08-21 06:37:21', '2026-08-21 06:37:21', '', '', '2026-08-21 16:00', 'AMS');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (33, 'AGL-20260821-002', 'pickup', '176-6557 6851', '', '962471653', 4, 15, 16, '0', 1, 35, 0.35, '[{"len":84,"width":73,"height":57,"qty":1}]', 'late', '後補電池資訊', '[]', 'no', '', '', '', '此票货物预计21号到港，烦请先安排订舱，谢谢！
JST01026082077', '', 'pending', '2026-08-21 06:48:34', '2026-08-21 08:12:41', '', '', NULL, 'CPT');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (34, 'AGL-20260821-003', 'pickup', '後補MAWB#', '', '62207922', 4, 15, 16, '0', 3, 78, 0.5, '[{"len":207,"width":51,"height":31,"qty":1},{"len":70,"width":46,"height":46,"qty":1},{"len":32,"width":41,"height":16,"qty":1}]', 'late', '後補電池資訊', '[]', 'no', '', '', '', '此票货物预计21号到港，烦请先安排订舱，谢谢！
此票提单请按100KG计费出单，谢谢！
BGJST01026082079', '', 'pending', '2026-08-21 07:39:27', '2026-08-21 07:40:04', '', '', NULL, 'KWI');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (35, 'AGL-20260821-004', 'pickup', '176-6557 6873', '', '962484518', 4, 15, 16, '0', 12, 115, 0.68, '[{"len":84,"width":73,"height":57,"qty":1}]', 'late', '後補電池資訊', '[]', 'no', '', '', '', 'D6 EK9845/22AUG', '', 'pending', '2026-08-21 08:14:37', '2026-08-21 08:14:37', '', '', NULL, 'AMM');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (36, 'AGL-20260821-005', 'pickup', '176-6557 6840', '', '962471551', 4, 15, 16, '0', 2, 19, 0.1, '[{"len":84,"width":73,"height":57,"qty":1}]', 'late', '後補電池資訊', '[]', 'no', '', '', '', '此票货物预计21号到港，烦请帮忙安排，谢谢！
-JST01026081996', '', 'pending', '2026-08-21 10:29:27', '2026-08-21 10:29:27', '', '', NULL, 'TUN');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (37, 'AGL-20260821-006', 'pickup', '176-6557 6906', '', '61090108', 4, 15, 16, '0', 2, 128, 0.75, '[{"len":84,"width":73,"height":57,"qty":1}]', 'late', '後補電池資訊', '[]', 'no', '', '', '', '此票货预计22号到港,提单号：176-6557 6906  D7 , EK9859 / 23AUG
-JST00826081901', '', 'pending', '2026-08-21 10:30:49', '2026-08-21 10:30:49', '', '', NULL, 'EBB');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (38, 'AGL-20260822-001', 'pickup', '176-6557 6884', '', '962471654', 4, 15, 16, '0', 2, 40, 0.25, '[{"len":43,"width":66,"height":46,"qty":1},{"len":54,"width":46,"height":49,"qty":1}]', 'no', NULL, '[{"type":"no","main":"","code":"無電","qty":""}]', 'no', '', '', '', '此票货物已到港，烦请帮忙安排，谢谢', '', 'pending', '2026-08-22 07:07:16', '2026-08-22 07:07:16', '', '', '2026-08-22 16:00', 'IST');

INSERT INTO "orders" ("id", "order_no", "order_type", "mawb", "hawb", "pickup_no", "customer_company_id", "pickup_company_id", "delivery_company_id", "cargo_desc", "quantity", "weight_kg", "cbm", "cbm_dimensions", "power_type", "power_code", "power_items", "urgent", "receiver_name", "receiver_phone", "address", "notes", "transport_company", "status", "created_at", "updated_at", "receiver_note", "contact_note", "pickup_datetime", "dest") VALUES (39, 'AGL-20260822-002', 'pickup', '176-6557 6910', '', '176-6557 6910', 4, 15, 16, '0', 26, 204, 0.46, '[{"len":31,"width":23,"height":25,"qty":26}]', 'no', NULL, '[{"type":"no","main":"","code":"無電","qty":""}]', 'no', '', '', '', '此票货已到港', '', 'pending', '2026-08-22 07:15:41', '2026-08-22 07:15:41', '', '', '2026-08-22 16:00', 'LHR');


-- ===== 資料表: pallet_plan_items =====
DROP TABLE IF EXISTS "pallet_plan_items";
CREATE TABLE pallet_plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      mawb_record_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(plan_id, mawb_record_id)
    );

INSERT INTO "pallet_plan_items" ("id", "plan_id", "mawb_record_id", "sort_order", "created_at") VALUES (93, 6, 37, 0, '2026-08-22 05:27:50');

INSERT INTO "pallet_plan_items" ("id", "plan_id", "mawb_record_id", "sort_order", "created_at") VALUES (94, 6, 36, 1, '2026-08-22 05:27:54');

INSERT INTO "pallet_plan_items" ("id", "plan_id", "mawb_record_id", "sort_order", "created_at") VALUES (95, 6, 34, 2, '2026-08-22 05:28:06');

INSERT INTO "pallet_plan_items" ("id", "plan_id", "mawb_record_id", "sort_order", "created_at") VALUES (98, 6, 38, 3, '2026-08-22 05:30:02');

INSERT INTO "pallet_plan_items" ("id", "plan_id", "mawb_record_id", "sort_order", "created_at") VALUES (99, 6, 35, 4, '2026-08-22 16:33:16');


-- ===== 資料表: pallet_plans =====
DROP TABLE IF EXISTS "pallet_plans";
CREATE TABLE pallet_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_no TEXT UNIQUE,
      company_name TEXT,
      fax TEXT,
      plan_date TEXT,
      flight_no TEXT,
      flight_date TEXT,
      arrival_airport TEXT,
      contour_text TEXT,
      contour_code TEXT,
      max_gross_weight REAL,
      handover_hours INTEGER,
      planner TEXT,
      remarks TEXT,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , sort_order INTEGER DEFAULT 0);

INSERT INTO "pallet_plans" ("id", "plan_no", "company_name", "fax", "plan_date", "flight_no", "flight_date", "arrival_airport", "contour_text", "contour_code", "max_gross_weight", "handover_hours", "planner", "remarks", "status", "created_at", "updated_at", "sort_order") VALUES (6, 'AGL-20260822-01', 'AIR GLOBAL LIMITED 世航貨運有限公司', '', NULL, '', NULL, '', '', '', NULL, 8, '', '', 'draft', '2026-08-22 05:27:39', '2026-08-22 05:27:39', 0);


-- ===== 資料表: projects =====
DROP TABLE IF EXISTS "projects";
CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mawb TEXT,
      dest TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

INSERT INTO "projects" ("id", "mawb", "dest", "created_at") VALUES (4, 'GA-LNS-TEST', 'HKG', '2026-08-22 15:25:53');

INSERT INTO "projects" ("id", "mawb", "dest", "created_at") VALUES (5, 'GA-LNS-TEST', 'HKG', '2026-08-22 15:26:27');

INSERT INTO "projects" ("id", "mawb", "dest", "created_at") VALUES (6, 'GA-LNS-TEST', 'HKG', '2026-08-22 15:27:35');


-- ===== 資料表: remark_templates =====
DROP TABLE IF EXISTS "remark_templates";
CREATE TABLE remark_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (1, 'JPS 自送', '今天自送到 JPS', '2026-08-12 07:47:02');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (2, '卸車點', 'JPS 卸車 / 代貼 UN3481 電池 LABEL', '2026-08-12 07:47:02');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (3, '20% HAND SEARCH', '需要幫忙做 20% HAND SEARCH，影貨相、LABEL相、開箱相、裝板相', '2026-08-12 07:47:02');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (4, '不需爆箱', '不需要爆箱', '2026-08-12 07:47:02');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (5, 'REV PLAN', 'REV PLAN（換貨）', '2026-08-12 07:47:02');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (6, '防火網', '要裝防火網', '2026-08-12 07:47:02');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (7, 'AWB LABEL', '每件貨貼 2 張 AWB LABEL', '2026-08-12 07:47:02');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (8, '交板時間', '起飛前 8 個鐘要交到板', '2026-08-12 07:47:02');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (9, 'REMARK', 'REMARK', '2026-08-12 09:05:19');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (10, '今天自送到 JPS
5 PLTs
120 x 80 x 60...', '今天自送到 JPS
5 PLTs
120 x 80 x 60 / 4
120 x 80 x 24 / 1
不需要爆箱', '2026-08-12 09:12:10');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (11, 'JPS 卸車 (27-JUL) / 代貼 UN3481 電
...', 'JPS 卸車 (27-JUL) / 代貼 UN3481 電
池 LABEL
S/O# 994-3032 8572 (93 CTNS)
需要幫忙做20% HAND SEARCH , 影貨
相,LABEL相,開箱相,裝板相', '2026-08-12 09:13:01');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (12, 'ELI 967 = 99 PKGS', 'ELI 967 = 99 PKGS', '2026-08-12 12:43:50');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (13, 'NO BATT', 'NO BATT', '2026-08-12 12:44:53');

INSERT INTO "remark_templates" ("id", "name", "content", "created_at") VALUES (14, 'ELI = 10 PKGS
ELM = 10 PKGS
-代...', 'ELI = 10 PKGS
ELM = 10 PKGS
-代做LABEL', '2026-08-12 12:46:05');


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


-- ===== 資料表: solutions =====
DROP TABLE IF EXISTS "solutions";
CREATE TABLE solutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      solution_data TEXT,
      utilization_rate REAL,
      weight_utilization REAL,
      cog_x REAL,
      cog_y REAL,
      cog_z REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

-- (無資料)

-- ===== 資料表: spl_codes =====
DROP TABLE IF EXISTS "spl_codes";
CREATE TABLE spl_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (1, '無電', '全數無電', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (2, '全部冇電', '全部無電', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (3, 'PI967', '鋰電池（隨設備）', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (4, 'PI968', '鋰電池（獨立）', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (5, 'UN3481', '鋰電池安裝於設備內', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (6, 'UN3480', '鋰離子電池', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (7, 'UN3091', '鋰金屬電池安裝於設備內', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (8, 'ELI', '鋰電池', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (9, 'ELM', '鋰金屬', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (10, 'A67', '鋰電池（包裝）', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (11, 'A123', '鋰電池（設備）', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (12, 'A199', '鋰電池（內置）', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (13, 'SPX', '特殊處理（Special Handling）', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (14, 'PER', '易腐貨', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (15, 'AVI', '活體動物', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (16, 'VAL', '貴重貨', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (17, 'HUM', '人體遺骸', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (18, 'DIP', '外交郵袋', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (19, 'EAT', '食品', '2026-08-12 07:47:02');

INSERT INTO "spl_codes" ("id", "code", "description", "created_at") VALUES (20, 'ELI, ELM', '', '2026-08-12 12:46:05');


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

-- ===== 資料表: ulds =====
DROP TABLE IF EXISTS "ulds";
CREATE TABLE ulds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      uld_type TEXT,
      label TEXT,
      max_weight_kg REAL,
      contour_config TEXT,
      status TEXT DEFAULT 'pending',
      seq INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

INSERT INTO "ulds" ("id", "project_id", "uld_type", "label", "max_weight_kg", "contour_config", "status", "seq", "created_at") VALUES (16, 4, 'Q7-00', 'Q7-00-01', 6804, '{"geometryType":"extrudedProfile","profileKey":"Q7_00","baseL":3175,"baseW":2438.4,"maxHeightMm":2997.2}', 'pending', 1, '2026-08-22 15:25:53');

INSERT INTO "ulds" ("id", "project_id", "uld_type", "label", "max_weight_kg", "contour_config", "status", "seq", "created_at") VALUES (17, 4, 'PMC', 'PMC-02', 6804, '{"geometryType":"rectangular","baseL":3160,"baseW":2438,"maxHeightMm":3000}', 'pending', 2, '2026-08-22 15:25:53');

INSERT INTO "ulds" ("id", "project_id", "uld_type", "label", "max_weight_kg", "contour_config", "status", "seq", "created_at") VALUES (18, 5, 'Q7-00', 'Q7-00-01', 6804, '{"geometryType":"extrudedProfile","profileKey":"Q7_00","baseL":3175,"baseW":2438.4,"maxHeightMm":2997.2}', 'pending', 1, '2026-08-22 15:26:27');

INSERT INTO "ulds" ("id", "project_id", "uld_type", "label", "max_weight_kg", "contour_config", "status", "seq", "created_at") VALUES (20, 6, 'Q7-00', 'Q7-00-01', 6804, '{"geometryType":"extrudedProfile","profileKey":"Q7_00","baseL":3175,"baseW":2438.4,"maxHeightMm":2997.2}', 'pending', 1, '2026-08-22 15:27:35');

INSERT INTO "ulds" ("id", "project_id", "uld_type", "label", "max_weight_kg", "contour_config", "status", "seq", "created_at") VALUES (21, 6, 'PMC', 'PMC-02', 6804, '{"geometryType":"rectangular","baseL":3160,"baseW":2438,"maxHeightMm":3000}', 'pending', 2, '2026-08-22 15:27:35');


-- ===== 資料表: users =====
DROP TABLE IF EXISTS "users";
CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'customer',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, locked_until DATETIME, failed_attempts INTEGER DEFAULT 0, permissions TEXT, last_login_at DATETIME, sidebar_bg_url TEXT, sidebar_nav_order TEXT,
      UNIQUE(company_id, user_id)
    );

INSERT INTO "users" ("id", "company_id", "user_id", "password_hash", "display_name", "role", "is_active", "created_at", "locked_until", "failed_attempts", "permissions", "last_login_at", "sidebar_bg_url", "sidebar_nav_order") VALUES (1, 18, 'admin', '$2b$10$KqitQ3CklAqO2dF.B6fn0efvXk8vGa687H7Fg.eLZRAAAoNaus/ki', '系統管理員', 'admin', 1, '2026-08-11 09:58:17', NULL, 0, NULL, '2026-08-22 16:32:37', '{"url":"data:image/webp;base64,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","scale":1.05,"posX":-4.3500000000000005,"posY":7.1}', '["#section-chat","#section-skills","#section-contour","#section-orders","#section-xls-booking","#section-palletization","#section-dbviewer","users.html"]');

INSERT INTO "users" ("id", "company_id", "user_id", "password_hash", "display_name", "role", "is_active", "created_at", "locked_until", "failed_attempts", "permissions", "last_login_at", "sidebar_bg_url", "sidebar_nav_order") VALUES (2, 18, 'nelson', '$2b$10$n6ERUS97EGQUQy5//Qn1beUDcSc1JKZptaqVD1iyccpg3vAi1jMee', 'Nelson WONG', 'admin', 1, '2026-08-13 06:27:38', NULL, 0, NULL, '2026-08-13 06:31:01', NULL, NULL);

INSERT INTO "users" ("id", "company_id", "user_id", "password_hash", "display_name", "role", "is_active", "created_at", "locked_until", "failed_attempts", "permissions", "last_login_at", "sidebar_bg_url", "sidebar_nav_order") VALUES (3, 18, 'user', '$2b$10$6rqE01y8QC4RvoUgSh64keH/yl2rSeY1K4nOPPXtca.PphW5b5sDy', 'user', 'staff', 1, '2026-08-14 04:26:45', NULL, 0, NULL, '2026-08-14 04:33:10', NULL, NULL);


-- ===== sqlite_sequence (AUTOINCREMENT 計數器) =====
INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('audit_log', 185);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 23);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('mawb_records', 38);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 39);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plan_items', 100);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plans', 6);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('remark_templates', 14);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('spl_codes', 20);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('users', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('audit_log', 183);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 23);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('mawb_records', 38);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 39);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plan_items', 98);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plans', 6);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('remark_templates', 14);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 9);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('spl_codes', 20);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('users', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('audit_log', 156);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 20);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('mawb_records', 33);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 30);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plan_items', 84);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plans', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('remark_templates', 14);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('spl_codes', 20);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('users', 2);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('audit_log', 148);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 20);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('mawb_records', 33);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 30);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plan_items', 76);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plans', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('remark_templates', 14);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('spl_codes', 20);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('users', 2);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('audit_log', 80);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 18);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('mawb_records', 8);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 28);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plan_items', 42);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plans', 4);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('remark_templates', 14);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('spl_codes', 20);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('users', 1);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 18);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 28);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('users', 1);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 18);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 28);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('users', 1);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 20);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 28);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 17);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 24);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('skills', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('note_templates', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('companies', 17);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('orders', 23);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('users', 3);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('spl_codes', 19);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('remark_templates', 11);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plans', 4);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('audit_log', 68);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('mawb_records', 5);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('pallet_plan_items', 34);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('projects', 16);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('ulds', 47);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('customers', 21);

INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('items', 65);

