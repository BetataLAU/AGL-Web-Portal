# ULD 夾重系統（ULD Weight Reconciliation）設計文件

> 狀態：**Phase 1 已實作**（DB + API + 前端 + 測試）；**Phase 2 的 W1（MAWB 帶入）／W2（回寫 Booking Record）／W3（RCL 磅單匯入）／W4（列印）／W5（磅差門檻）已完成**；**Phase 3 的 R1（server 端 PDF）／R2（比例上下限）／R3（明細 diff 更新）／R4（seed 競態）也已完成（2026-11-05）**。未完成事項見 `uld-weight-remaining-work.md`。
> 相關程式：`public/js/uldweight/{calc,state,render,api}.js`、`public/js/uld-weight.js`、`routes/uld-weight.js`、`public/css/uld-weight.css`、`db/database.js`（3 張表）。

---

## 1. 背景與目的

倉庫把貨裝上板（ULD）交給貨站（HACTL / AAT / CPSL）後，貨站會重新磅重並出 **RCL**（收貨單）。
RCL 的 **Gross weight 是最終權威**，但倉庫申報的每票 MAWB 重量與 RCL 之間通常有差額（裝板物料、磅重誤差）。
「夾重」＝把這個差額**回填到指定的 MAWB**（可多票按比例），讓每票 MAWB 的最終重量加總後與 RCL 對得起來。

系統只做一件事：**輸入 RCL 磅重 → 選夾重票 → 算出每票 MAWB 的最終重量**，並留下可追溯的紀錄。

---

## 2. 名詞與規則

| 名詞 | 定義 |
|---|---|
| 貨站（terminal） | **HACTL / AAT / CPSL** 三個（CPSL 為 CX 貨站，勿稱「CX 貨站」） |
| RCL WT（淨重） | 貨站磅單上的重量＝**淨重**，最終決定（2026-11-07 起不再扣 Tare；DB 欄位名仍是 `rcl_gross_weight`） |
| Tare weight | 板底重量（散貨 B 類無板底，視為 0）；**只顯示參考，不從 RCL 扣除** |
| Net weight | 目標淨重 = **RCL WT**；也＝該單位內所有 MAWB 貨物重量合計 |
| 磅差（diff） | `目標淨重 − Σ 各票申報重量`（正＝RCL 比申報重；含裝板物料） |
| 夾重 | 把磅差分配給「夾重票」；**未勾選夾重的票重量不變** |
| Pre-decl Type | `P` = Prepack（1 板 1 MAWB）／`X` = MIX（1 板 MAWB 數 ≥ 1，混裝）／`B` = Bulk（交散貨，不裝板，1 MAWB） |
| Port | **不檢核**：ULD 的 Port 可與各票不同，同一板內各票 Port 也可不同（MIX 混裝） |
| LIH | 鋰電池資訊：存檔值 `N` / `UN3481` / `UN3091`；**畫面與報表只顯示短碼 `N` / `3481` / `3091`**（`calc.uldLihLabel()`，避免下拉與表格被長文字撐寬） |
| MAWB | **11 位數字**：左 3 位航空公司代號（不足 3 位左補 0）＋右 8 位序號（前 7 位＋第 8 位檢查碼）。顯示格式 `000-0000 0000`。**檢查碼 = 序號前 7 位 mod 7**；不符時提示使用者（不擋存檔，既有／特殊資料仍可作業）。共用純函式：`public/js/uldweight/mawb-format.js` |

**MAWB 範例**：`071-6195 2074` → 數字 `07161952074` → 航空公司 `071`、序號 `61952074` → `6195207 % 7 = 4` ＝ 檢查碼 `4` → 合法。
輸入 `61952074`（只有序號）→ 航空公司補 `000` → `000-6195 2074`；輸入 `7161952074` → 補成 `071-6195 2074`。

> **2026-11-07 規則變更（RCL wt = Net weight）**：卡片／載荷表的 RCL 欄填的是貨站的**淨重**，
> 因此 **目標淨重 = RCL（不再 `RCL − Tare`）**；Tare 仍會存、仍會顯示（「Tare … 參考」），但不參與計算。
> 舊資料若當初填的是 Gross，重算後每板會比原本多一個 Tare 的重量，需自行確認／修正。

**取整（rounding）**

| 類別 | 取整單位 | 說明 |
|---|---|---|
| P / X（交板） | 固定 **1.0 → 正整數** | 極少數航司要 0.5 的特例不做 |
| B（交散貨） | **0.5 或 1.0**（夾重表表頭可選，預設 1.0） | |
| 單位 | 一律 KG | |

**尾差處理**：各票取整後與目標淨重的差（±1～2kg），預設由「申報重量最大的夾重票」吸收，
保證 `Σ 各票最終重量 = 取整後目標淨重`。另可選「平均分攤」或「不調整（只標示差額）」。

---

## 3. 演算法（`public/js/uldweight/calc.js`）

```text
（方案 B）先把「MAWB 申報列」的重量分回各板：
  每票申報重量 Σ = sheet.mawbs[].declared_weight（左邊那一欄，人工輸入）
  各板只填件數 item.pcs；重量 = 申報重量 × (該板件數 / 該票總件數)
      尾差給件數最多的一筆，保證 Σ 各板重量 = 申報重量（calc.uldAllocateByPcs）
  只有 auto_alloc ≠ 0 的列會重算；auto_alloc = 0（舊資料自動長出的列）保留各板自填重量
  這一步在 uldComputed()（前端）與 loadSheetDetail()／PUT（後端）都會先跑 → 兩邊一致

對每個收貨單位 u：
  T = Tare（B 類 = 0；只顯示參考，不參與計算）
  G = RCL WT（貨站磅單的淨重）
  R = G                        目標淨重（不再 R − T = G − T）
  D = R − Σ w_i                磅差（w_i = 該單位第 i 票申報重量＝上一步分配結果）
  夾重票集合 S（可多票）；比例 p_i：
      weight（預設）w_i / Σ_S w_j ｜ pcs 件數 ｜ equal 平均 ｜ manual 手動%
  比例上下限（選用，0＝不限）：把 p_i 限制在 [clamp_min_pct, clamp_max_pct]
      超出界線的票固定在界線，其餘依原比例重分配（water-filling，見 uldApplyRatioClamp）
      上下限互相矛盾（例：3 票各最少 50%）→ 忽略上下限 ＋ CLAMP_INFEASIBLE（warn）
  精確值 x_i = w_i + (i∈S ? D × p_i : 0)
  取整：非夾重票維持 w_i；夾重票以 tick（0.5 或 1.0 為單位）向上取整
  尾差：把 (取整後目標淨重 − 非夾重票合計) 與 Σ 取整值 的差
        依規則從最大票（或最小票／不調整）加減 tick，直到合計對齊
  守衛：目標淨重 < 非夾重票合計 → TARGET_TOO_SMALL；任何最終重量 < 0 → NEGATIVE_WEIGHT
```

**規格書 CASE 驗算**（`scripts/test-uld-weight-calc.js` 逐項斷言）

| CASE | 輸入 | 結果 |
|---|---|---|
| 1 | 1 ULD 1 MAWB：RCL 2453／Tare 115／申報 2438 | 夾重後 **2453**（= RCL） |
| 2 | 1 ULD 2 MAWB：RCL 2453／Tare 115／a 2138（夾重）／b 300 | a **2153**、b **300**（不變） |
| 3 | 2 ULD 1 MAWB：RCL 2185(T115) / 1888(T112)，原 4050 | **2185 + 1888 = 4073** |
| 4 | 板a RCL 425(T115)：a 300、b 125（夾 b）；板b RCL 888(T112)：b 888 | a **300**、b **1013**（125 + 888） |

**多票按比例**（新規則）：RCL 2453（Tare 115 只參考）、a 2138 / b 300 兩票都夾重
→ D = 15、比例 87.68% / 12.32% → 精確 2151.15 / 301.85 → 取整 2152 / 302 = 2454 → 尾差 −1 由 a 吸收 → **2151 / 302（合計 2453）**。

---

## 4. 檢核（不擋存檔者只列警示；`error` 會擋下儲存）

| 代碼 | 內容 | 級別 |
|---|---|---|
| `NEGATIVE_WEIGHT` | 夾重後重量 < 0 | error |
| `NO_SQUEEZE` | 有磅差但沒勾任何夾重票 | error |
| `TARGET_TOO_SMALL` | 非夾重票合計 > RCL 淨重 | error |
| `PIECES_MISMATCH` | 單位件數 ≠ Σ 各票件數 | warn |
| `LIH_UNIT_MISSING` | 票有 UN3481/UN3091 但收貨單位標 N | warn |
| `LIH_UNIT_ONLY` | 收貨單位標 UN 但沒有任何票標示 | warn |
| `LIH_UN_CODE_MISMATCH` | 收貨單位與票的 UN 編號不一致（例：UN3481 vs UN3091） | warn |
| `DIFF_TOO_BIG` | 磅差 > `diff_warn_kg` **且** > `diff_warn_pct`（表頭可調，預設 100kg / 2%；0 或空白＝用預設） | warn |
| `MAWB_SPLIT_MISSING` | 同一 MAWB 跨多單位但部分單位未填重量 | warn |
| `DUPLICATE_ULD` / `DUPLICATE_MAWB_IN_ULD` | ULD 號重複／同單位重複同一票 | warn |
| `SQUEEZE_ZERO_WEIGHT` | 夾重票申報重量都是 0，比例改用件數 | warn |
| `CLAMP_INFEASIBLE` | 比例上下限互相矛盾（例：3 票各最少 50%、2 票各最多 30%）→ 已忽略上下限 | warn |


> **Port 不檢核**（可混裝）；**Pre-decl Type 完全手動**（1 板 1 MAWB 也可能是 X，不做自動判定）。

---

## 5. 資料模型（`db/database.js`）

```sql
uld_weight_sheets            -- 夾重表（一張單＝一次夾重作業）
  id, sheet_no(WGT-YYYYMMDD-XX, UNIQUE), sheet_date,
  terminal(HACTL|AAT|CPSL), flight_no, flight_date,
  round_px REAL DEFAULT 1,      -- 交板（P/X）取整單位：固定 1
  round_b  REAL DEFAULT 1,      -- 散貨（B）取整單位：0.5 / 1
  tail_mode TEXT DEFAULT 'adjust_largest',   -- adjust_largest | equal | none
  diff_warn_pct REAL DEFAULT 2,  -- 磅差警示門檻（%，與 kg 需「同時」超過）
  diff_warn_kg  REAL DEFAULT 100,
  clamp_min_pct REAL DEFAULT 0,  -- 多票夾重比例下限（%，0＝不限）
  clamp_max_pct REAL DEFAULT 0,  -- 多票夾重比例上限（%，0＝不限）
  handler, remark, status(draft|locked), created_by, created_at, updated_at

uld_weight_ulds              -- 收貨單位（P/X = 1 個 ULD；B = 1 批散貨）
  id, sheet_id, seq, kind('ULD'|'BULK'),
  uld_number, bulk_ref, rcl_no, contour_code, port, pcs,
  tare_weight, rcl_gross_weight, material_weight,
  lih_type(N|UN3481|UN3091), predecl_type(P|X|B), squeeze_mode(weight|pcs|equal|manual),
  net_weight, diff_weight        -- 儲存時由後端重算寫入（歷史可追溯）

uld_weight_items             -- 每板 × 每 MAWB（重量分攤的關鍵）
  id, uld_id, seq, mawb, mawb_record_id(可選), port, pcs,
  declared_weight, final_weight, is_squeeze(0/1), squeeze_ratio(手動%), lih_type

uld_weight_mawbs             -- MAWB 申報列（方案 B：載荷表左邊那一欄）
  id, sheet_id, seq, mawb(UNIQUE per sheet 由程式檢查), mawb_record_id(可選),
  dest, pcs, declared_weight, wh_ref(W/H or Booking 自由文字),
  auto_alloc(1=依件數自動分重量／0=保留各板自填重量), is_squeeze(0/1)

uld_weight_versions          -- 歷史版本（V3；每次異動留一份快照）
  id, sheet_id, version_no, action(create|save|lock|unlock|apply|sync_bookings|duplicate),
  status, note, snapshot(JSON：只存輸入值), summary(JSON：單位數／票數／淨重／磅差),
  created_by, created_at
```

**設計要點**

1. **重量必須存在「ULD × MAWB」層**：同一票 MAWB 可跨多板（CASE 3/4），每板各有一份重量。
2. `final_weight` / `net_weight` / `diff_weight` 一律由後端重算後寫入，前端只送原始輸入 → 畫面與 DB 不會不一致。
3. 算法只寫一份 `public/js/uldweight/calc.js`（純函式 ESM），後端以動態 `import()` 載入同一支重算。
4. `squeeze_ratio` 只存「手動模式」使用者輸入；自動模式的比例是算出來的，不落庫。
5. 明細採 **diff 更新**（R3）：前端 payload 帶 `id`（新列 `null`）→ 後端 UPDATE 既有列、INSERT 新列、DELETE 缺的列；
   沒帶 id 的舊 payload 會退回「整批重建」（相容）。

---

## 6. API（`/api/uld-weight`，`requireRole('admin','staff')`）

| Method | Path | 說明 |
|---|---|---|
| GET | `/bookings?search=&dest=&limit=` | **打板計劃 Booking Record 候選清單**（W1：夾重表「新增 MAWB」輸入即篩選；只讀 `mawb_records`） |
| POST | `/sheets/:id/apply` | **回寫 Booking Record（W2）**：僅 `locked` 可套用；同票跨板加總後覆寫 `mawb_records.gross_weight`；原重量寫 `audit_log`；不動 `orders`；冪等 |
| POST | `/sheets/:id/sync-bookings` | **補建 Booking Record（V1）**：對「沒有 `mawb_record_id`」的票，打板計劃已有同號 MAWB（正規化比對）就**只連結**、沒有才**建立**（`gross_weight` = 夾重後重量、`pcs`、`dest` = 該票 Port、`remark` 註明來源表）；**預設 `dry_run`（只回預覽、不寫 DB）**，要寫入須傳 `{ "dry_run": false }`；不動 `orders`、不動夾重表重量；有 `error` 的夾重表 → 422 |
| GET | `/sheets/:id/versions?limit=` | **歷史版本清單（V3）**：新到舊，含 `version_no`／`action`／`status`／`note`／`summary`（單位數／票數／淨重／磅差）／`created_by`／`created_at` |
| GET | `/sheets/:id/versions/:versionId` | 單一版本（含完整 `snapshot`） |
| GET | `/sheets/:id/versions/diff?from=&to=` | **異動比對（V3）**：`from` 必填（沒帶 → 400）；`to` 省略＝與**目前內容**比較；回 `{ data: diff, from, to }`，diff 由 `public/js/uldweight/version-diff.js` 產生（欄位級：表頭／單位／明細） |
| POST | `/sheets/:id/import-rcl` | **RCL 磅單匯入（W3）**：上傳 `.xlsx`／`.xlsm`／`.csv`（10MB、multer 記憶體）；只解析不寫 DB，回傳欄位對應＋可建立的單位清單（`sheet`／`col_*` 可覆寫）；鎖定 → 409 |
| GET | `/sheets/:id/report.pdf` | **server 端 PDF（R1）**：`application/pdf`＋`Content-Disposition: attachment; filename="<sheet_no>.pdf"`；草稿／鎖定都能下載；由 `scripts/uld-weight-report-pdf.js` 排版（資料來自 `loadSheetDetail()`） |
| GET | `/sheets/:id/loading-sheet.pdf?unit=<uld_id>` | **單板 Loading Sheet（U3）**：A4 直式一板一頁，欄位 `MAWB／DEST／PCS／WT`（WT＝夾重後最終重量），固定 16 列（不足補空白列）、表頭 `To: <航班前兩碼>／Date／Unit: ULD#／Contour／Dest`；`unit` 省略＝每板各一頁合成一份；不存在的 `unit` → 404；資料同樣來自 `loadSheetDetail()` |
| GET | `/sheets/batch-pdf?ids=1,2,3`（或 `status=`／`search=`） | **批次 PDF（V2）**：多張夾重表打包成一個 `application/zip`（檔名 `uld-weight-batch-YYYYMMDD-HHmm.zip`）；ZIP 內含每張 `<sheet_no>.pdf` ＋ `manifest.txt`（UTF-8 BOM，列出表號／狀態／RCL／淨重／磅差與失敗清單）；`ids` 省略時依 `status`／`search` 篩選；**上限 50 張**（超過 400、沒有符合 404）；單張失敗不影響整批，成功／失敗張數放在 `X-Uld-Weight-Pdf-Count`／`X-Uld-Weight-Pdf-Failed` |
| GET | `/sheets?status=&search=` | 清單（含板數／散貨數／RCL 總重／淨重／磅差） |
| POST | `/sheets` | 新增空表（自動編號 WGT-YYYYMMDD-XX，預設貨站 CPSL） |
| GET | `/sheets/:id` | 明細（表頭 + 收貨單位 + 明細 + **即時重算結果** + 檢核） |
| PUT | `/sheets/:id` | 整份儲存（先重算，有 `error` 回 422；鎖定回 409） |
| DELETE | `/sheets/:id` | 刪除（鎖定不可刪） |
| POST | `/sheets/:id/duplicate` | 複製（新編號、草稿） |
| POST | `/sheets/:id/lock` · `/unlock` | 鎖定／解鎖 |

寫入操作都會寫 `audit_log`（action 前綴 `uld_weight.*`）。

---

## 7. UI

- 側欄：`模擬裝板系統` 之後 → **ULD 夾重系統**（`#section-uld-weight`，admin/staff，鎖頭樣式同打板計劃）
- 右側版面：**清單**（夾重表列表）↔ **編輯**
  - **編輯有兩種版面**（`state.ui.view`；工具列「▤ 卡片編輯／▦ 載荷表」切換，**預設載荷表**）：
    - **載荷表（grid，U4＋方案 B，2026-11-07；2026-11-09 重畫）**：照業界 **CHARTER LOADING SHEET** 的 Excel 版面，**可直接編輯**。
      一票一列（申報列 `uld_weight_mawbs`）：`SEQ／MAWB／DEST／申報 PCS／申報 WT／W/H or Booking／自動／夾重／上數（件數｜重量）`；
      一板一組欄（`01/A`、`02/B`…，板頭顯示 `ULD#/Contour`）：每組 `PCS`（**手動填入這票在該板的件數**）＋`WT`（**可直接打字**）；
      重量分配：`calc.uldApplyMawbAllocation()` 依件數把申報 WT 分到各板（Σ = 申報 WT，尾差給件數最多的板）；
      列上的「自動」取消（`auto_alloc = 0`）→ 保留各板自填重量（舊資料自動長出的列預設就是 0，升級不會偷改重量）。
      **手改單板重量（2026-11-09）**：在任一板 WT 直接打字 → `state.uldSetCellWeight()` → `calc.uldAllocateWithFixed()`
      固定這一板、剩下的申報 WT 依件數分給同票其他板（Σ 仍等於申報 WT），該列同時轉為手動（`auto_alloc = 0`）；
      打超過申報 WT 會夾到申報 WT 並提示；要恢復自動就把「自動」勾回來。鍵盤：**Enter＝下一列、Shift+Enter＝上一列**、
      Tab＝下一格（`moveGridFocus()`），數字格聚焦即全選（打字＝覆蓋）。**板欄左右拖曳**：按住板頭 `⠿` 往左右拖即可換板序
      （`dragKind = 'grid-col'`，比 `clientX` 決定插在前／後；改的是 `seq`，存檔才寫回；鎖定時不可拖）。
      顏色：**紅字＝夾重**（`item.is_squeeze`）、**橙字＝wt 有差**（上數 − 申報 > 0.5kg）、標頭「要自己入」黃底／「會自動計」藍底；
      底部：各板 `板合計（PCS／WT）`、`RCL（淨）／ 磅差`、`PLAN TTL`（Σ 申報）／`RCL TTL`／`DIFF`（**K**）。
      操作：最下面一列輸入 MAWB# 按 Enter＝新增一票、`＋ 列`、每列 `✕` 刪除（連同各板件數）、
      `Clear Content`（清空全部申報列與明細，表頭與板資料保留、不自動存檔）、`Check & format MAWB#`（批次格式化＋列不合格）、
      `Sort by MAWB#`（**只改顯示順序**，不寫回資料）。資料一律由 `uldComputeSheet()` 轉出（`public/js/uldweight/sheet-grid.js` 的
      `uldGridModel()`／`uldGridHtml()`／`uldGridSortRows()`／`refreshGridComputed()`），**不另寫算法**。
      卡片檢視（`▤ 卡片檢視`）改板資料（ULD#／Contour／Tare／RCL（淨）／LIH／Pre-decl／夾重方式）；卡片裡的 MAWB 唯讀（由申報列管），
      **WT（kg）可直接打字**（2026-11-11）：輸入框不再 `readonly`、也隱藏上下箭頭；打字走 `state.uldSetCellWeight()`，
      固定這一板、剩下的申報 WT 依件數分給同票其他板（Σ 不變），該列轉手動（`auto_alloc = 0`），
      其他板的輸入框同步更新（跳過正在打字的那一格）；打超過申報 WT 夾到上限並提示。
    - **卡片（cards）**：原本的收貨單位卡片＋MAWB 彙總＋檢核（新增／修改明細、夾重勾選、比例、LIH 都在這裡）。
  - 表頭：**常駐 5 欄**（日期／貨站／航班／航班日期／經手人）＋備註；**B 取整／尾差／磅差警示 %／kg／比例下限 %／上限 %** 收在「⚙ 進階」內（預設收起，值照常送出、列印時自動展開）
  - ① 收貨單位卡（**網格排列、可拖曳調整板序**；板序代號 `01/A`、`02/B`…`41/AO`）：
    標頭＝`⠿` 拖曳把手＋板序＋ULD#（或散貨批號）＋chips＋`▾`收合／`⤓`單板 PDF／`🖨`單板列印／`✕`刪除；
    摘要列＝`件數 PCS ｜ RCL（淨）x ｜ Tare y 參考 → 夾重後 K`；主欄位＝Port／件數／RCL（淨）；次要欄位（Contour／RCL#／Tare／物料／LIH／Pre-decl／夾重方式）收在 `▾` 內；
    明細表＝勾選夾重、MAWB、DEST、PCS、WT、比例、最終、LIH（緊湊模式下比例／LIH 隱藏）
  - ② MAWB 彙總（原重／夾重後／差額／Port，跨板自動加總）
  - ③ 檢核清單（error 紅、warn 黃；沒有問題時**不顯示**空盒子）
  - 底部（sticky）：**`PLAN TTL`／`RCL TTL`／`DIFF`**（單位一律 **K**）＋ 淨重／磅差／單位數／MAWB／件數／Tare
- 色碼（業界慣例）：**紅＝夾重票**（MAWB 紅字＋淡紅底）、**橙＝WT 被改**（最終重量 ≠ 申報）、**綠＝可輸入**、**灰＝計算值**；圖例只在卡片區標頭出現一次
- 操作：**工具列只留 `← 列表`／`儲存`／`鎖定·解鎖`／`⋯ 更多`**；其餘（套用到 Booking／⇧ 補建 Booking／🕘 版本／🖨 列印／⤓ PDF／複製／刪除）收在「⋯ 更多」。另有新增／匯出 Excel（`xlsx.full.min.js`，3 個工作表）／複製文字摘要（`utils/clipboard-utils.js`）
- 輸入體驗：文字／數字輸入 → 只做局部重算（`refreshComputed()`），不會失去焦點；下拉／勾選才整份重畫
- **輸入加速（U2）**：
  - 「新增 MAWB」列按 **Enter 直接加入**（不必再點「加入」）
  - **⧉ 貼上**（或直接在卡片內貼上）：從 Excel／booking list 複製 `MAWB／DEST／PCS／WT`（Tab 分隔）→ 一次建立多票；
    也支援 3 欄（MAWB／PCS／WT）／2 欄（MAWB／PCS）／1 欄（MAWB）；表頭列自動略過（解析在共用純函式 `public/js/uldweight/paste-parse.js`）
  - 貼上的票若也出現在其他板 → 會提示「已在 02/B…」，可用明細列 `⇄` 依件數拆
  - **收貨單位上限 41 板**（`ULD_MAX_UNITS`）；超過會提示拆成兩張表
  - 卡片可**拖曳調整板序**（只改顯示與列印順序＝`seq`，不影響計算）；「全部收合」可在板數多時只看摘要
- 「新增 MAWB」列：MAWB 欄是**輸入即篩選**（打板計劃 Booking Record，`public/js/uldweight/booking-search.js`），
  選到後自動帶入 Port（`dest`）／件數／重量並記住 `mawb_record_id`；**手動輸入仍可用**（做法：`renderEditor()` 尾端 `wireBookingPickers(root)`）
- 明細列 `⇄`：用該票的總重量依件數拆到所有相關單位（`uldSplitByPcs`，尾差給件數最多的一筆）
- **「套用到 Booking」**（W2，僅鎖定後可按）：把每票最終重量回寫 `mawb_records.gross_weight`（`uldBookingTotals` 彙總；
  未連結 Booking／資料衝突的票不回寫），完成後跳出 applied／skipped／conflicts 明細
- **「⇪ 匯入 RCL」**（W3）：上傳貨站磅單 → 面板顯示「自動偵測的表頭列＋4 個欄位對應（可改）＋可勾選的單位表（含略過原因）」
  → 「加入選取的單位」并入草稿（Pre-decl 預設 P）→ 再按「儲存」；只重畫面板，不整份重畫
- **「🖨 列印」**（W4）：編輯畫面工具列按鈕（`data-action="print"` → `printCurrent()` → `window.print()`），**草稿與鎖定都可印**。
  紙本版面只靠 `public/css/uld-weight.css` 的 `@media print`：A4 直式（`@page size: A4 portrait`）、單欄、
  只留「表頭（表號／狀態／日期／貨站／航班／航班日期／經手人／備註）＋每板 `RCL（淨重）`＋Tare 參考＋每票最終重量＋磅差＋全表合計」；
  隱藏側欄、頁面上的匯入／匯出按鈕、`.uldw-editor-actions`、`.uldw-rcl`、勾選欄與列操作欄、`.uldw-item-add`；
  輸入框／下拉去框線只留值（`-webkit-text-fill-color: #000` 讓鎖定灰字也能印）、每張單位卡 `break-inside: avoid`、
  數字 `tabular-nums`、`.uldw-table-wrap` 改 `overflow: visible`；`@media print` 內用 `html, html[data-theme]` 強制黑字白底。
  正式 PDF 檔：**另見 R1「⤓ PDF」**（server 端 `GET /sheets/:id/report.pdf`，與列印並存，版面互不影響）。
- **「⤓ PDF」**（R1）：下載 server 端固定排版的 A4 PDF（`scripts/uld-weight-report-pdf.js`）；
  前端 `api.js` 的 `fetchReportPdfBlob()`（**不可用 `apiFetch`**，它固定解析 JSON）→ Blob 下載；
  草稿／鎖定都能下載；有未儲存的修改時會先確認（PDF 用的是已存檔內容）。
- **卡片上的 `⤓`／`🖨`（U3，單板）**：`⤓` 下載該板的 Loading Sheet（`GET /sheets/:id/loading-sheet.pdf?unit=<uld_id>`，
  A4 直式、`MAWB／DEST／PCS／WT`、固定 16 列）；`🖨` 只印這一張卡（`@media print` 的 `.uldw-print-single`）。
  WT 一律取 `calc.items[].final`（夾重後重量），表內只寫數字（不寫 kg／K，業界慣例）；表頭 `To:` 取航班號前兩碼。
- **「比例下限 %／上限 %」**（R2）：多票夾重時單票分攤比例的限制（0＝不限）；被限制的比例後面會多一個 `*`
  （滑鼠移上去有說明）；無解時檢核會出現「夾重比例上下限無解」。
- **「⤓ 批次 PDF」（V2，清單頁）**：每列多一個勾選框（表頭有全選），工具列右側顯示「已選 N 張」與「⤓ 批次 PDF」按鈕
  → `api.js` 的 `fetchBatchPdfBlob({ ids })` → 下載 ZIP（`manifest.txt` ＋ 每張 `<sheet_no>.pdf`）。
  勾選狀態存在 `state.batchSelected`；**只更新計數／按鈕／列底色／全選框，不整份重畫**（焦點與捲動位置不變）；
  清單重新載入時會剔除已不存在的 id。單張 PDF 仍是「⤓ PDF」（R1）。
- **「⇧ 補建 Booking」（V1，編輯畫面）**：把還沒連結 Booking 的票反推回打板計劃 →
  `api.js` 的 `syncSheetBookings(id, { dryRun })`。流程固定是**預覽 → confirm → 才寫入**：
  先 `dryRun: true` 拿 `created`／`linked`／`skipped`，在 confirm 裡列出「將建立 N 筆／將連結 M 筆／略過 K 票」，
  使用者確定後才 `dryRun: false`；完成後用回應的 `sheet` 覆蓋狀態並重畫。
  草稿與已鎖定都能按（建立 Booking 不算改重量）；有未儲存的修改會先提醒（用的是已存檔內容）。
- **「🕘 版本」（V3，編輯畫面）**：開啟版本面板（`#uldw-versions`，只重畫面板不整份重畫）→
  `fetchSheetVersions()` 列出 v1…vN（時間／動作／狀態／單位·明細／淨重／磅差／建立者）→
  每列「與前一版比」／「對目前」呼叫 `fetchVersionDiff()`，下方列出表頭／單位／明細的欄位級差異
  （新增綠 `uldw-diff-add`、刪除紅 `uldw-diff-del`、修改黃 `uldw-diff-chg`）；列印時整個面板不印。

---

## 8. 檔案清單

| 檔案 | 說明 |
|---|---|
| `public/js/uldweight/calc.js` | **計算核心**（前後端共用，純函式；含 `uldBookingTotals()`：W2 回寫 Booking Record 的彙總、`uldApplyRatioClamp()`：R2 比例上下限、**`uldAllocateByPcs()`／`uldApplyMawbAllocation()`：方案 B 申報重量→各板分配**、**`uldAllocateWithFixed()`：2026-11-09 手動指定單板重量（其餘依件數分剩下的）**） |
| `public/js/uldweight/state.js` | 前端狀態、API↔編輯狀態轉換、拆分、payload 帶 DB `id`（R3）、**`uldSetCellWeight()`（載荷表 WT 直接打字：固定那一板＋其餘依件數分＋轉手動）** |
| `public/js/uldweight/render.js` | 清單／編輯畫面渲染 + 局部更新（`ui.view === 'grid'` 時改呼叫 `sheet-grid.js`） |
| `public/js/uldweight/sheet-grid.js` | **U4 載荷表（CHARTER LOADING SHEET）／方案 B**：`uldGridModel()`（純函式：申報列 × 一板一組欄、上數／PLAN／RCL／DIFF）、`uldGridHtml()`（可編輯矩陣：申報列輸入、各板 PCS＋**可打字的 WT**、自動／夾重、**可拖曳的板頭**、紅橙字、底部合計）、`uldGridSortRows()`（只排顯示順序）、`refreshGridComputed()`（輸入時只更新數字與顏色，不重畫；**跳過正在打字的那一格**） |
| `scripts/uld-weight-grid-preview.js` | **U4 版面預覽**：用假資料（5 票 × 3 板）產出 `data/work/uldw-grid-preview.html`，免登入／免伺服器即可目視檢查載荷表版面（`npm run preview:uldweight`） |
| `scripts/uld-weight-merge-preview.js` | **③ 合併／分配頁版面預覽**：用概念圖假資料（4 票 × 3 板）產出 `data/work/uldw-merge-preview.html`；`--picked` 多產「已點選 MAWB」、`--demo-hover` 產十字高亮示意，並同時產 37 板壓測 `uldw-merge-preview-37.html`（`npm run preview:uldweight:merge`） |
| `public/js/uldweight/booking-search.js` | **W1**：打板計劃 Booking Record 的輸入即篩選／自動帶入（`wireBookingPickers`） |
| `public/js/uldweight/rcl-parse.js` | **W3**：RCL 磅單解析純函式（**前後端共用**：表頭偵測、欄位對應、列驗證／略過規則） |
| `public/js/uldweight/rcl-import.js` | **W3**：選檔、上傳預覽、改欄位後本機重算、勾選列（前端輔助） |
| `public/js/uldweight/version-diff.js` | **V3**：版本快照摘要 ＋ 欄位級異動比對（**前後端共用純函式**；後端以 `import()` 載入） |
| `public/js/uldweight/api.js` | API 呼叫層（含 `fetchReportPdfBlob()`：R1 PDF 下載、`fetchBatchPdfBlob()`：V2 批次 ZIP、`syncSheetBookings()`：V1 補建 Booking） |
| `public/js/uld-weight.js` | 入口 `setupUldWeightSection()`、事件委派、列印、PDF 下載（單張／批次 ZIP）、補建 Booking、Excel／摘要匯出 |
| `public/css/uld-weight.css` | 樣式（theme 變數） |
| `routes/uld-weight.js` | 後端 API（sqlite3 callback → Promise 包裝） |
| `scripts/uld-weight-report-pdf.js` | **R1**：夾重表 A4 PDF 產生器（pdf-lib＋CJK 子集；`--selftest`） |
| `scripts/test-uld-weight-calc.js` | 計算邏輯（CASE 1–4、比例、取整、檢核、拆分） |
| `scripts/test-uld-weight-frontend.js` | DOM stub：狀態轉換、渲染、鎖定、邊界 |
| `scripts/test-uld-weight-api.js` | 端對端（自帶伺服器 + 暫存 DB）：權限／CRUD／422／409 |

---

## 9. 測試指令

```bash
node scripts/test-uld-weight-calc.js      # 109 項（含 §18 申報列重量分配）
node scripts/test-uld-weight-rcl.js       # 28 項（磅單解析）
node scripts/test-uld-weight-mawb.js      # 33 項（MAWB 11 位／航空公司補 0／mod 7 檢查碼／格式化）
node scripts/test-uld-weight-frontend.js  # 269 項（含 §18 批次勾選、§19 補建 Booking、§20 版本比對、§21 直觀版 UI、§22 載荷表、§23 方案 B 申報列、§24 鍵盤手改重量／板欄拖曳、§27 合併／分配頁重建 22 項）
node scripts/uld-weight-grid-preview.js   # U4：產出載荷表預覽（data/work/uldw-grid-preview.html）
node scripts/uld-weight-merge-preview.js --picked --demo-hover  # ③ 合併／分配頁預覽（data/work/uldw-merge-preview*.html；含 37 板壓測）
node scripts/test-uld-weight-api.js       # API 端對端（會自己啟伺服器，port 3157；含 U3 Loading Sheet、B1～B11 申報列）
node scripts/test-nav-order-frontend.js   # 側欄排序（新增目錄後必跑）
node scripts/test-nav-hierarchy.js        # 側欄主/子層級
```

---

## 10. 已知限制與後續（Phase 2 之後）

- **已完成（Phase 3）**：server 端正式 PDF 檔（`GET /sheets/:id/report.pdf`，`scripts/uld-weight-report-pdf.js`）＝R1；
  多票比例上下限（`clamp_min_pct`／`clamp_max_pct`）＝R2；明細 diff 更新＝R3；fresh DB seed 競態＝R4；
  **批次 PDF（多張打包 ZIP，`GET /sheets/batch-pdf`）＝V2**；**補建 Booking Record（`POST /sheets/:id/sync-bookings`，預設 dry_run）＝V1**；
  **歷史版本／異動比對（`uld_weight_versions` ＋ `GET /sheets/:id/versions`／`/versions/diff`）＝V3**。
- **尚未做（選用）**：大表即時重算節流（V4，實測卡頓才做）
  （詳見 `uld-weight-remaining-work.md` §1）。
  （列印／另存 PDF 的瀏覽器版 W4、磅差門檻可調＋LIH 檢核細分的 W5 都已完成，見 §7 的「🖨 列印」與 §4 檢核表。）
  **已做**：MAWB 從「打板計劃 Booking Record」帶入（W1）、夾重結果回寫 `mawb_records.gross_weight`（W2）、
  RCL 磅單匯入（W3：`POST /sheets/:id/import-rcl`，通用欄位對應、只解析不寫 DB、鎖定 409）。
- 物料重量目前只作「磅差說明」，仍全額由夾重票吸收（實務上 MAWB 最終重量含物料）。
- 多票夾重的比例基準（重量／件數／平均／手動）已可選；若需要「按比例但有上下限」再擴充。
- 取整只支援 0.5 / 1.0；特殊航司的 0.1 精度未做。

