# ULD 夾重系統 — 未完成工作（Phase 3 交接）

> **狀態（2026-11-06）**：Phase 1 ＋ Phase 2（W1～W5）＋ **Phase 3（R1／R2／R3／R4）** ＋ **V2（批次 PDF ZIP）** ＋ **V1（補建 Booking Record）** ＋ **V3（歷史版本／異動比對）** ＋ **U1／U2／U3（直觀版 UI／輸入加速／單板 Loading Sheet）全部完成並驗證通過**。
> **V4（大表即時重算節流）已量測 → 不需要做**（單次 `uldComputeSheet()` 在 50 板 × 10 票下 median **約 0.6ms**、100 板 × 20 票 **約 2.4ms**，皆遠低於 16ms 門檻；量測工具 `npm run bench:uldweight`）。
> 本檔保留「已完成清單、新發現／陷阱、既定規則、驗證指令」，以及**剩下的選用／待決事項**。
> 規則與算法 → `docs/design/uld-weight-system.md`；陷阱／已完成清單／驗證細節 → `docs/design/uld-weight-phase2-handoff.md`。
> 程式現況 → `CLAUDE.md` 的「ULD 夾重系統」段落；工作狀態 → `WORKSPACE_STATE.md` 待辦清單。

---

## ▶ 新對話從這裡開始（本次交接摘要，2026-11-06）

1. **確認基準**：`npm run sync` → 跑 §4 全部驗證指令（應全綠：calc 101／rcl 28／frontend 131／API 端對端／nav／hierarchy／loadsim）。
2. **本輪候選**（**沒有必辦項**）：§1 的 **V4** 已於 2026-11-06 量測完畢 → **數據顯示不需要做**（見 §1.1 實測表）。
   之後若真的出現卡頓，先用 `npm run bench:uldweight` 重新量一次，仍 > 16ms 才動手。
   **V1（補建 Booking）／V2（批次 PDF ZIP）／V3（歷史版本）已於 2026-11-06 完成**。
   若使用者提 **D3／D5／D6**（散貨批號對應／0.1 取整／跨板自動拆），**先問清楚再動手**（§2.1 已列好要問的問題）。
3. **收尾SOP**：跑 §4 驗證 → 更新本檔（勾掉已完成、補新發現／新陷阱）→ 更新
   `uld-weight-phase2-handoff.md`、`CLAUDE.md`、`PROJECT_MAP.md`、`WORKSPACE_STATE.md` → 最後 `npm run sync`。
4. 想直接用提示詞接手 → 複製 §6 的內容貼給新對話即可。

**目前狀態一句話**：夾重表可建立／編輯／鎖定／複製、MAWB 帶入 Booking、反推補建 Booking Record、套用回寫 Booking、
RCL 磅單匯入、A4 列印與 server 端 PDF 下載（單張／批次打包 ZIP）、**歷史版本與異動比對**、磅差門檻可調、
多票比例上下限、明細 diff 更新、fresh DB 自動 seed admin —— 全部可用且測試全綠。

---

## 0. 已完成（勿重做）

| 項目 | 內容 | 主要位置 |
|---|---|---|
| Phase 1 | 夾重表 CRUD、多收貨單位（P/X 板、B 散貨）、多票按比例夾重、取整（P/X 整數、B 0.5/1.0）、尾差吸收、檢核、鎖定、複製、匯出 Excel／複製摘要 | `routes/uld-weight.js`、`public/js/uldweight/*`、`public/css/uld-weight.css` |
| W1 | MAWB 從打板計劃 Booking Record 帶入（輸入即篩選，帶件數／重量／Port＋`mawb_record_id`） | `GET /api/uld-weight/bookings`、`public/js/uldweight/booking-search.js` |
| W2 | 鎖定後回寫 `mawb_records.gross_weight`（同票跨板加總、冪等、原重量留 `audit_log`、**不動 orders**） | `calc.uldBookingTotals()`、`POST /sheets/:id/apply` |
| W3 | RCL 磅單（Excel／CSV）匯入收貨單位（通用欄位對應、只解析不寫 DB） | `public/js/uldweight/rcl-parse.js`（前後端共用）、`POST /sheets/:id/import-rcl` |
| W4 | 列印／另存 PDF：`@media print`＋「🖨 列印」（A4 直式、單欄、每板不跨頁、黑字白底，草稿／鎖定都能印） | `public/css/uld-weight.css`、`render.js`、`uld-weight.js` 的 `printCurrent()` |
| W5 | 磅差門檻可調（`diff_warn_pct`／`diff_warn_kg`）＋ LIH 檢核細分（`LIH_UNIT_MISSING`／`LIH_UNIT_ONLY`／`LIH_UN_CODE_MISMATCH`） | `db/database.js`、`normalizeHeader()`、表頭輸入、`calc.js` |
| **R1** | **server 端正式 PDF**：`GET /api/uld-weight/sheets/:id/report.pdf`（pdf-lib ＋ CJK 子集，A4 直式固定排版；草稿／鎖定都能下載）＋前端「⤓ PDF」按鈕 | `scripts/uld-weight-report-pdf.js`、`routes/uld-weight.js`、`api.js` 的 `fetchReportPdfBlob()` |
| **R2** | **多票夾重比例上下限**：表頭「比例下限 %／上限 %（0＝不限）」，`calc.uldApplyRatioClamp()` water-filling 重分配；無解時提 `CLAMP_INFEASIBLE`（warn） | `calc.js`、`db/database.js`（`clamp_min_pct`／`clamp_max_pct`）、`render.js` 表頭 |
| **R3** | **明細改 diff 更新**：`PUT /sheets/:id` 以 id 比對（UPDATE／INSERT／DELETE），儲存後單位／明細 id 不再變動 | `PUT /sheets/:id`、`state.uldSheetPayload()`（帶 `id`） |
| **R4** | **fresh DB 的 seed-admin 競態**：`companies` 建表就含 `company_code`，且 `db.ready` 完成後才跑 seed | `db/database.js`、`server.js` |
| **V2** | **批次 PDF（多張夾重表打包 ZIP）**：`GET /sheets/batch-pdf?ids=…`（或 `status`／`search`，上限 50 張）→ `archiver` 在記憶體打包、附 `manifest.txt`（UTF-8 BOM）；清單頁勾選列＋「⤓ 批次 PDF」 | `routes/uld-weight.js`、`public/js/uldweight/{api,render,state}.js`、`public/js/uld-weight.js`、`public/css/uld-weight.css` |
| **V1** | **補建 Booking Record（安全版）**：`POST /sheets/:id/sync-bookings`（**預設 dry_run 只回預覽**，`{dry_run:false}` 才寫入）→ 對沒有連結的票：打板計劃已有同號 MAWB **只連結**、沒有才**建立**（`gross_weight` = 夾重後重量、`pcs`、`dest`）；不動 `orders`、不動夾重表重量 | `routes/uld-weight.js`、`public/js/uldweight/{api,render}.js`、`public/js/uld-weight.js` |
| **V3** | **歷史版本／異動比對**：`uld_weight_versions`（每次建立／儲存／鎖定／解鎖／套用／補建都留快照，每張表保留最近 30 版）＋ `GET /sheets/:id/versions`／`/versions/:vid`／`/versions/diff?from=&to=`（`to` 省略＝對目前內容）；比對規則寫在共用純函式 `public/js/uldweight/version-diff.js`；編輯畫面「🕘 版本」面板列出 v1…vN 並可「與前一版比／對目前」 | `db/database.js`（新表）、`routes/uld-weight.js`、`public/js/uldweight/version-diff.js`（新）、`public/js/uldweight/{api,state,render}.js`、`public/js/uld-weight.js`、`public/css/uld-weight.css` |

目前測試：`calc 101`＋`rcl 28`＋`mawb 33＋frontend 165`＋API 端對端（148 項，含 R1／R2／R3／R4／V2 批次 ZIP／V1 補建 Booking／V3 版本／U3 Loading Sheet）全部 PASS；nav／hierarchy／loadsim 也全 PASS。
效能基準：`npm run bench:uldweight`（V4 決策用，量 `uldComputeSheet()` 單次耗時；50 板 × 10 票 median 約 0.6ms → 不需節流）。

### 0.1 直觀版 UI（U1／U2／U3，2026-11-06 完成）

| 項目 | 內容 | 主要位置 |
|---|---|---|
| **U1** | **減法版面**：工具列只留 `← 列表／儲存／鎖定／⋯ 更多`（其餘 7 個動作收進選單）；表頭只留 5 欄＋`⚙ 進階`（B 取整／尾差／磅差門檻／比例上下限）；卡片改成網格、**預設收合**（次要欄位收 `▾`，按 ▾ 或「全部展開」才看得到）、摘要列（`PCS ｜ RCL−Tare→淨  K`）；底部合計改**業界讀法** `PLAN TTL／RCL TTL／DIFF`（單位一律 **K**）；檢核沒有問題時不再顯示空盒子；色碼 **紅＝夾重、橙＝WT 已改**（含圖例）；**LIH 下拉／報表只顯示短碼 `N`／`3481`／`3091`**（存檔值仍是 `UN3481`／`UN3091`） | `public/js/uldweight/render.js`、`public/css/uld-weight.css` |
| **U2** | **輸入加速**：MAWB 欄 **Enter 直接加入**；**⧉ 貼上多列**（Excel 4 欄 MAWB／DEST／PCS／WT，也支援 3／2／1 欄，表頭列自動略過）；**MAWB 自動格式化 `000-0000 0000` ＋ 檢查碼驗證**（11 位、前 7 位 mod 7；不合格提示、貼上時略過；共用 `mawb-format.js`）；**ULD#／Contour／RCL#／Port／MAWB 自動轉大寫**（輸入即顯示、payload 再轉一次；`bulk_ref` 自由批號不轉）；卡片 **拖曳排序**（`⠿` 把手，改 `seq` 只影響顯示與列印）；板序代號 `01/A`…`41/AO`；**上限 41 板**；板數多時可「全部展開／收合」 | 新 `public/js/uldweight/paste-parse.js`、`public/js/uldweight/mawb-format.js`（共用純函式）、`state.js`（`ULD_MAX_UNITS`／`uldMoveUnit`）、`render.js`、`public/js/uld-weight.js` |
| **U3** | **單板 Loading Sheet**：`GET /sheets/:id/loading-sheet.pdf?unit=<uld_id>`（A4 直式、`MAWB／DEST／PCS／WT`、固定 16 列含空白列、`To:` 取航班前兩碼、`Date` 為 `6 Nov 2026`）；卡片 `⤓` 下載單板、`🖨` 只印這一張卡（`.uldw-print-single`） | `scripts/uld-weight-report-pdf.js`（`buildUldWeightLoadingSheetPdf`）、`routes/uld-weight.js`、`public/js/uldweight/{api,render}.js`、`public/js/uld-weight.js`、`public/css/uld-weight.css` |

---

## 1. 未完成工作

> **沒有必辦項**。以下全部是「選用」或「待決 D3／D5／D6 有答案才做」。
> **V1（補建 Booking）／V2（批次 PDF ZIP）／V3（歷史版本）已於 2026-11-06 完成**，見 §0。
> **V4 已量測（2026-11-06）→ 數據顯示不需要做**，見 §1.1 的實測表。

| 編號 | 內容 | 何時才做 |
|---|---|---|
| V4 | 效能：大表（>50 板 × 10 票）的即時重算節流 | **已量測，現階段不做**：50 板 × 10 票單次計算 median **約 0.6ms**、100 板 × 20 票 **約 2.4ms**（皆 < 16ms 門檻）。日後實測 > 16ms 再做 |

### 1.1 V4 — 大表即時重算節流（**已量測 2026-11-06 → 不需要做**）

**實測結果（2026-11-06，`npm run bench:uldweight`；Node v24、每情境暖機 10 次後量 60 次）**：

| 情境 | 單位／明細 | min | **median** | p95 | max |
|---|---|---|---|---|---|
| 10 板 × 3 票 | 10 / 30 | 0.051ms | **0.072ms** | 0.236ms | 0.386ms |
| 20 板 × 5 票 | 20 / 100 | 0.118ms | **0.167ms** | 0.339ms | 0.421ms |
| **50 板 × 10 票（門檻情境）** | 50 / 500 | 0.509ms | **0.619ms** | 1.484ms | 1.613ms |
| 50 板 × 10 票 ＋ 比例上下限 5~40% | 50 / 500 | 0.549ms | **0.624ms** | 1.020ms | 1.290ms |
| 50 板 × 10 票 ＋ 手動 % | 50 / 500 | 0.516ms | **0.594ms** | 1.116ms | 1.242ms |
| 100 板 × 20 票（極端） | 100 / 2000 | 1.990ms | **2.420ms** | 4.292ms | 4.444ms |

**判定**：連極端情境（2000 筆明細）的 p95 都只有 4.3～5.0ms，**遠低於 16ms（一個 frame）** → **不做節流**，
維持每次輸入整表重算（`refreshComputed()`），行為最單純、沒有 debounce 造成的「畫面數字慢半拍」。

> 上表是**一次量測**的結果；同一台機器重跑會有約 ±15% 抖動（實測第二次：50×10 median 0.672ms、100×20 median 2.454ms），
> **量級不變**（50 板 × 10 票穩定在 0.6～0.7ms）。要看趨勢請看 median，不要比較單一數字。

**重新量測方式（未來懷疑卡頓時）**：
```bash
npm run bench:uldweight            # 標準情境（10×3 / 20×5 / 50×10 / 50×10+上下限 / 50×10+手動% / 100×20）
node scripts/bench-uld-weight-calc.js --ulds=80 --tickets=12 --rounds=80
node scripts/bench-uld-weight-calc.js --ulds=50 --tickets=10 --clamp-min=5 --clamp-max=40 --squeeze=manual
```
量測腳本只呼叫 `public/js/uldweight/calc.js`（**不含任何計算邏輯**），會自動印出「median < 16ms → 不需節流」的判定。

**注意（量測的邊界）**：本工具量的是「純計算」。`refreshComputed()` 的實際成本＝calc ＋ DOM 更新
（50 板 × 10 票＝500 列的 `textContent`／`innerHTML`）。單看 calc 數據，瓶頸不在算法；若真的覺得卡，
再開 Chrome DevTools → Performance 錄製「在申報重量欄連續打字」，確認是 DOM 還是 calc 佔大宗。

**現況**：`public/js/uldweight/render.js` 的 `refreshComputed(root)` 會在每次輸入（`input` 事件）對
「整張表」重算（`state.uldComputed()` → `calc.uldComputeSheet()`）再更新 DOM。資料量小的時候完全無感
（實測 10 板 × 3 票、20 板 × 5 票都感覺不到延遲），**上面的實測也證明 50 板 × 10 票仍是次毫秒級**。

**若未來重新量測**：
1. 先跑 `npm run bench:uldweight`（純計算，最快）；要自訂規模用 `--ulds=80 --tickets=12`。
2. 若 calc 仍遠低於 16ms 但畫面會卡 → 瓶頸在 **DOM**，方向改成「只更新有變動的列」而不是節流 calc
   （任何情況都不可整份 `render()`，會失焦）。
3. 判斷門檻：單次更新 < 16ms 就不必做（一個 frame 內）。

**若未來量測真的 > 16ms，可選做法（依序，先做 1 再考慮 2；目前未實作）**：
1. **輸入節流（最小改動、風險最低）**：`onRootInput()` 對 `data-item-field`／`data-unit-field` 的呼叫改成
   `requestAnimationFrame` 或 30～60ms debounce（只節流「重算」，輸入框的值仍然即時寫進 state → 不會失焦、不會掉字）；
   `change` 事件（勾選／下拉）與存檔前**必須**立即重算，不可節流。
2. **只重算受影響的單位**：`calc.uldComputeUnit()` 已是單一單位的純函式 → 輸入事件只重算「該輸入框所在的 `.uldw-unit`」，
   再把 `totals`／MAWB 彙總用「其他單位的舊 `calc` + 新單位」組合（需要一個 `uldCombineTotals(units)` 之類的輔助，
   仍放在 `calc.js`，**不得在 render.js 另寫一套加總**）。
3. **虛擬捲動／收合遠處的單位卡**：只在「板數真的很多（>100）」時才考慮，工程量大、收益要先量。

**不可違反**：
- 算法仍只有一份 `public/js/uldweight/calc.js`（不可為了效能在前端另寫加權／取整）。
- 輸入事件**不可整份 `render()`**（會失去焦點）；結構性變更（勾選／下拉／新增／刪除列）才整份重畫。
- 節流只能影響「畫面更新時機」，**存檔 payload 一定要是最新值**（`saveCurrent()` 內先重算一次再送）。

**驗收**：
- 大表連續打字不掉字、游標不跳、捲動不抖；`npm run test:uldweight`（calc 101／rcl 28／frontend 131）與
  `npm run test:uldweight-api`（141 項）全綠；`npm run test:loadsim`、nav／hierarchy 不受影響。

---

## 2. 要先用決策的待決事項（別自己假設）

| 編號 | 問題 | 影響 |
|---|---|---|
| **D3** | 交散貨（B）要不要「批號／RCL 號」對應？目前只有 `bulk_ref` 自由欄位 | 報表欄位、匯入對應 |
| **D5** | 取整是否需要支援 0.1（少數航司）？`roundInc` 已支援任意值，只缺 UI 選項 | 表頭多一個選項 |
| **D6** | 「同一 MAWB 跨板」目前要手動按 `⇄` 依件數拆分，要不要改成存檔時自動拆？ | 會影響是否覆蓋使用者手改的重量 |

> **D4 已決（2026-11-05）：要做 server 端 `report.pdf` → R1 已完成**（與 W4 的瀏覽器列印並存）。
> D1（只改 `mawb_records.gross_weight`、不動 `orders`）、D2（RCL 用通用欄位對應）也已決，不要翻案。

### 2.1 若要動 D3／D5／D6，先問這幾句（不要自己假設）

**D3（散貨批號對應）**
- 要問：「散貨（B）除了 `bulk_ref` 自由文字，要不要再加一個**正式的批號欄位**？它要不要跟 RCL 磅單的
  ULD No／RCL No 對應（匯入時自動比對）？同一批號能不能拆成兩張夾重表？」
- 若要：`uld_weight_ulds` 需要新欄位（`bulk_lot_no` 之類，走 `PRAGMA table_info` ＋ `ALTER TABLE` 並 push 進 `initTasks`）、
  `rcl-parse.js` 的欄位對應要多一個 `col_lot`、PDF／Excel 匯出要多一欄、`calc.js` 的 `uldUnitLabel()` 可能要一起改（顯示名稱）。
- 風險：`DUPLICATE_ULD` 檢核目前只看 `uld_number`；批號要不要一起納入重複檢核要先確認。

**D5（0.1 取整）**
- 要問：「哪幾家航司／哪種情況要用 0.1？是**只有散貨 B** 要 0.1，還是 P/X 也可能要？要不要限制只影響畫面上顯示、
  不影響尾差吸收規則？」
- 若要：`round_b` 的 `<select>` 多一個 `0.1`（`calc.uldCeilTo()` 已支援任意 tick，**不用改算法**）；
  要注意取整後合計＝目標淨重的保證由尾差吸收維持（`tail_mode` 規則不變），測試要加 0.1 的案例（尾差可能出現 0.1）。

**D6（跨板自動拆）**
- 要問：「存檔時要不要自動把『同一 MAWB 跨多板』的申報重量依件數重算？如果使用者**手動改過**某板重量，
  要覆蓋它還是保留（例如：標記為手動的列不自動改）？」
- 若要：建議做成「只有該票在某板的重量為 0（或從未手動編輯）時才自動拆」，並在檢核加一個提示；
  `calc.uldSplitByPcs()` 已存在（`state.uldSplitMawb()` 在用），**不要另寫一套拆分**。
- 風險：會覆蓋使用者輸入 → 必須有「手動值不被覆蓋」的規則與測試，否則容易變成人為錯誤來源。

---

## 3. 不可改動的既定規則（違反會破壞既有驗證）

1. **算法只能有一份**：`public/js/uldweight/calc.js`（純函式 ESM，前後端共用；後端用 `import()` 載入）。
   不要在 route 或 PDF 產生器裡另寫一套加權／取整邏輯（PDF 只吃 `loadSheetDetail()` 的結果）。
2. **磅單解析只有一份**：`public/js/uldweight/rcl-parse.js`。
3. `目標淨重 R = RCL Gross − Tare`；**B（散貨）Tare 一律 0**；磅差 `D = R − Σ 申報重量`；未勾夾重的票重量不變。
4. 取整：**P／X 一律正整數**；**B 可選 0.5／1.0**；尾差預設由申報重量最大的夾重票吸收。
5. **不檢核 Port**（可混裝）；**Pre-decl Type 完全手動**。
6. 磅差警示：**% 與 kg 需「同時」超過**才算 `DIFF_TOO_BIG`（預設 2%／100kg；0 或空白＝用預設）。
7. **前端輸入事件只做局部重算**（`refreshComputed()` / `refreshRclImport()`），不要整份 `render()`（會失焦）。
   只有下拉／勾選等結構性變更才整份重畫。
8. 回寫 Booking Record **只改 `mawb_records.gross_weight`**，不動 `orders`（D1）；`import-rcl` 只解析不寫 DB。
9. 舊 DB 補欄位：`db/database.js` 內用 `PRAGMA table_info(<table>)` ＋ `ALTER TABLE`（`ensureColumn` 只給 `orders` 用）。
10. **R2 的比例上下限只管「磅差的分攤比例」**（`ratio` ∈ [min%, max%]，0＝不限）：
    - 只在 **≥2 票夾重**時生效（1 票必然 100%）；
    - 上下限無解（例：3 票各最少 50%、2 票各最多 30%）→ **忽略上下限**＋提 `CLAMP_INFEASIBLE`（warn，不擋存檔）；
    - 尾差調整仍可能讓單票加減 1 tick（合計＝取整後目標淨重的保證優先）。
11. **R3：明細以 id 比對更新**。前端 `uldSheetPayload()` 必須帶 `id`（新列為 `null`）；
    後端只 UPDATE 屬於該表／該單位的列，沒帶到的列才 DELETE。
12. **R1：PDF 不在 route 內算重量**，且不可改動 `@media print` 的版面（兩者並存）。
13. **V1：補建 Booking Record 必須「先預覽再寫入」**：
    - `POST /sheets/:id/sync-bookings` **預設 dry_run**（只有明確 `{ "dry_run": false }` 才寫 DB）；
    - 只處理**沒有 `mawb_record_id`** 的票（`calc.uldBookingTotals().unlinked`）；
    - MAWB 比對用 `calc.uldMawbKey()` 的正規化規則（去空白／連字號、大寫；SQL 以 `REPLACE(REPLACE(UPPER(...)))` 對齊）；
    - 打板計劃**已有同號 MAWB → 只連結，不重複建立**；同號多筆 → `skipped(duplicate_booking)`，**不猜**；
    - 新 Booking 的 `gross_weight` = 夾重後重量加總（`uldBookingTotals` 的 `final`）、`pcs` = 件數加總、`dest` = 該票 Port、`remark` = 「由夾重表 `<sheet_no>` 建立」；
    - **不動 `orders`**（D1）、**不動夾重表的重量**（只更新 `uld_weight_items.mawb_record_id`，鎖定中也可執行）；
    - 夾重表有 `error`（未勾夾重／目標過小…）→ **422**，不寫入（重量還不確定）。
14. **V3：版本快照只存「輸入值」**（`buildSnapshot()` 挑欄位，不含 calc 的重算結果）＋**比對規則只有一份**
    （`public/js/uldweight/version-diff.js`，後端用 `import()` 載入；前端只負責畫）。
    - 留版時機：create／save／lock／unlock／apply／sync_bookings／duplicate；**內容相同的 `save` 不重複留**（避免洗版）；
    - 每張表保留最近 **30** 版（`VERSION_KEEP`），超過就刪舊的；
    - 比對以 **DB id** 配對（R3 之後 id 穩定），沒有 id 的新列才退回「MAWB + 序」；
    - `diff?to=` 省略＝與**目前內容**比較（`from` 必填，沒帶 → 400）。

---

## 4. 驗證指令（改完必跑，全部應通過）

```bash
npm run sync                                  # 更新 FILE_INVENTORY.md／結構快照
npm run test:uldweight                        # calc 101 項 + rcl 28 項 + mawb 33＋frontend 165 項（§14 列印、§15 門檻／LIH、§16 比例上下限、§17 diff／PDF、§18 批次 ZIP、§19 補建 Booking、§20 版本比對、§21 直觀版 UI）
npm run test:uldweight-api                    # API 端對端（148 項，自帶伺服器 + 暫存 DB，port 3157；含 R1 PDF／R2 上下限／R3 明細 id／R4 fresh DB seed／V2 批次 ZIP／V1 補建 Booking／V3 版本／U3 Loading Sheet）
node scripts/test-nav-order-frontend.js       # 側欄排序
node scripts/test-nav-hierarchy.js            # 側欄主/子層級
npm run test:loadsim                          # 模擬裝板（避免動到共用模組）
node scripts/uld-weight-report-pdf.js --selftest   # 免伺服器產一份 PDF（檢查 %PDF- 檔頭／大小）
npm run bench:uldweight                       # V4 效能量測（同 scripts/bench-uld-weight-calc.js；應顯示「median < 16ms → 不需做 V4 節流」）
```

手動驗收（挑對應的做）：
- **直觀版 UI（U1）**：新增一張夾重表 → 第一眼只有 `← 列表／儲存／鎖定／⋯ 更多` 四個按鈕、表頭 5 欄；點「⚙ 進階」才出現 B 取整／尾差／磅差門檻／比例上下限（存檔後重開，值仍保留）；底部合計顯示 `PLAN TTL／RCL TTL／DIFF`（單位 K）。
- **輸入加速（U2）**：在 MAWB 欄打號碼按 **Enter** 直接加入；從 Excel 複製 4 欄貼在卡片內 → 一次多票；拖 `⠿` 可換板序（存檔重開順序保留）；加到第 42 板會被擋下並提示。
- **單板 Loading Sheet（U3）**：卡片按 `⤓` → 下載 `<sheet_no>-<ULD#>-loading.pdf` → A4 直式、`MAWB／DEST／PCS／WT`、固定 16 列（不足是空白列可手寫）、右上角 `01/A`、`To:` 是航班前兩碼；按 `🖨` 只印這一張卡。
- **server 端 PDF（R1）**：開一張 3～5 板的夾重表 → 按「⤓ PDF」→ 下載 `<sheet_no>.pdf` →
  用 PDF 閱讀器開：A4 直式、中文字正常（不是 `?`）、每板不跨頁、數字右對齊；鎖定後再下一次也要能下載。
- **比例上下限（R2）**：3 票夾重（900／50／50、RCL 2000）→ 表頭「比例上限 %」填 40 →
  最大票比例從 90% 變成 **40%（後面多一個 `*`）**、最終重量 1300／350／350；
  改成 30%（2 票時）→ 檢核出現「夾重比例上下限無解」；存檔重開仍保留；列印不顯示這兩個欄位。
- **列印（W4）**：3～5 板的夾重表 → 按「🖨 列印」→ A4 直式預覽：看不到側欄／按鈕／匯入面板，每板不跨頁、數字不截斷；切 Dark 主題再印一次應為黑字白底。
- **門檻（W5）**：門檻改 1%／10kg → 小磅差立刻出現「磅差過大」；存檔重開仍保留；列印不顯示門檻欄位。
- **明細 id 不變（R3）**：同一張表連續按兩次「儲存」→ 用資料庫檢視器看 `uld_weight_items.id` 不變。
- **fresh DB（R4）**：刪掉 `database.db`（或指到新 `DB_PATH`）啟動 → 日誌應有「已建立預設管理員」→ 可直接用 `AGL / admin / admin123` 登入。
- **批次 PDF（V2）**：清單頁勾 2～3 張（含草稿與已鎖定各一）→ 按「⤓ 批次 PDF」→ 下載 `uld-weight-batch-YYYYMMDD-HHmm.zip` →
  解開應有 `manifest.txt` ＋每張一個 `<sheet_no>.pdf`；PDF 內容與單張「⤓ PDF」一致；`manifest.txt` 第一行是表頭（記事本開啟中文不亂碼）。
  全選框可一次勾選目前清單的全部列；搜尋／切換狀態篩選後，勾選只保留還看得到的表。
- **補建 Booking Record（V1）**：開一張有「手動輸入、沒連結 Booking」的票的夾重表 → 按「⇧ 補建 Booking」→
  跳出預覽（將建立 N 筆／將連結 M 筆／略過 K 票）→ 按確定 → 打板計劃出現新 Booking（`gross_weight` = 夾重後重量、
  `dest` = 該票 Port、`remark` 有夾重表號），原本就有的同號 MAWB 只被連結、不會多一筆；再按一次應顯示「不需要補建」。
- **歷史版本（V3）**：開一張已存過幾次的夾重表 → 按「🕘 版本」→ 面板列出 v1…vN（時間／動作／狀態／淨重／建立者）→
  按某一版的「與前一版比」→ 下方列出表頭／單位／明細差異（新增綠、刪除紅、修改黃）；按「對目前」則與目前內容比較；
  再存一次檔（改一個欄位）→ 面板會多一版；沒改內容連按兩次儲存 → 版數不變；面板在列印時不會印出來。
- 其他既有手動驗收（CASE 4、W1、W2、W3）見 `uld-weight-phase2-handoff.md` §5。

---

## 5. 新發現／新陷阱（Phase 3 實際踩到的）

1. **`pdf-lib` 的 CJK 子集要走 `CustomFontSubsetEmbedder` ＋ `PDFFont.of` ＋ `doc.fonts.push()`**（照 `scripts/sli-eli-overlay.js` 的 `embedCjkFontInto()` 寫法）。
   只 `doc.embedFont(ttcBytes)` 會爆 `createSubset is not a function`；少了 `doc.fonts.push()` 字型不會被寫進 PDF（檔案小到 2 KB、中文變空白）。
   實測：含中文的夾重表 **≈37 KB**、`PDF_CJK=off` 時只剩 **≈2 KB**（可據此判斷字型有沒有真的內嵌）。
2. **字型缺字（emoji／罕見漢字）會讓 `drawText` 丟錯**。`scripts/uld-weight-report-pdf.js` 先用 `hasGlyph()` 逐字檢查，缺字以 `?` 取代；
   純 WinAnsi 字串走 Helvetica（`scripts/pdf-charset.js` 的 `isStdFont()`），其餘整串走 CJK 子集。
   PDF 內**不要用 emoji／箭頭**（`→`、`⛔`、`⚠️`）——改用 `-`、`=`、`[錯誤]`、`[警示]`。
3. **比例上下限只在「≥2 票夾重」時有意義**：1 票必然 100%，若硬套上限（例 60%）會被判成無解而噴 `CLAMP_INFEASIBLE`（噪音）→ `uldApplyRatioClamp()` 對 `n < 2` 直接放行。
4. **water-filling 每輪要用「同一份」`cap`／`weightSum` 快照**：若邊算邊扣 `remaining`，同一輪裡的票會拿到不一致的基準（比例總和不為 1）。
   收尾一定要做一次「總和歸一」保險（極端資料／浮點誤差）。
5. **R3 之後「不帶 id 的 payload」仍必須可用**（舊前端／外部呼叫）：沒有 id 一律視為新列 → 整批重建（舊行為相容），但 id 會變。
   前端 `saveCurrent()` 會用回應的 detail 覆蓋 `state.current`，所以下一次儲存自然帶得到新 id。
6. **item id 必須以 `uld_id` 為範圍比對**（`WHERE id = ? AND uld_id = ?`）：避免把別的板的明細改掉。
7. **`db.ready` 只保證「有登記進 `initTasks` 的工作」完成**：目前是 `companies.company_code` 與 `uld_weight_sheets` 的相容性欄位。
   新增其他表的 `ALTER TABLE` 時，若 seed／路由需要它，記得也 push 進 `initTasks`。
8. **`express` 的 `/sheets/:id/report.pdf` 不會被 `/sheets/:id` 攔到**（路徑段數不同），但要放在 `PUT /sheets/:id` 之前才不會誤觸存檔邏輯。
9. **前端不能用 `apiFetch()` 下載 PDF**（它固定 `res.json()`）→ 另寫 `fetchReportPdfBlob()`，並自行處理 401 導向登入頁。

### 5.1 V2（批次 PDF ZIP）實際踩到的

10. **`archiver.append()` 只吃 `Buffer`／`Stream`，不吃 `Uint8Array`**：`pdf-lib` 的 `doc.save()` 回傳的是 `Uint8Array`
    → 直接丟給 archiver 會拋 `input source must be valid Stream or Buffer instance`（整批 500）。
    一律先 `Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)`（單張 `report.pdf` 也是 `res.end(Buffer.from(bytes))`）。
11. **`/sheets/batch-pdf` 必須宣告在 `GET /sheets/:id` 之前**：`batch-pdf` 會被 `:id` 吃進去（`parseInt` → NaN → 400）。
    （`/sheets/:id/report.pdf` 因為路徑段數不同不會被攔，但批次是同一層，順序有差。）
12. **ZIP 不需要落暫存檔**：`archiver('zip')` 是 Transform stream，`on('data')` 收集到 `on('end')` → `Buffer.concat()` 即可；
    50 張 × 約 40KB 只有 ~2MB，直接 `res.end(zipBytes)`（不需要 `fs.createWriteStream`，也沒有清理問題）。
13. **單張失敗不要讓整批失敗**：逐張 try/catch，失敗的寫進 `manifest.txt` 的「失敗」區塊與
    `X-Uld-Weight-Pdf-Count`／`X-Uld-Weight-Pdf-Failed` 回應標頭；**全部失敗**才回 500、**一張都沒有**回 404。
14. **ZIP 內檔名要 sanitize ＋去重**：表號雖然是 `WGT-YYYYMMDD-XX`（安全），仍走 `xls-utils` 的 `sanitizeFileLabel()`；
    同名會互相蓋掉 → 補 `-2`／`-3`。（`manifest.txt` 先佔位，避免被 PDF 撞名。）
15. **manifest 的換行與編碼**：`\r\n` ＋ UTF-8 **BOM**（`\uFEFF`），Windows 記事本才不會把中文顯示成亂碼。
16. **時間戳一律用本地時間手動組**（`getFullYear()` 等），不可用 `toISOString()`（UTC+8 會變成前一天／少 8 小時）。
17. **前端的勾選狀態不要靠重畫**：批次勾選只更新 `#uldw-batch-count`／按鈕 `disabled`／列的 `is-batch-selected`／全選框，
    不要 `render()`（會把搜尋框焦點與捲動位置洗掉）；清單重新載入時要把已不存在的 id 從 `state.batchSelected` 剔除。

### 5.2 V1（補建 Booking Record）實際踩到的

18. **MAWB 比對不能用 SQL 等於比對**：明細可能是 `160 00000006`／`160-00000006`，`calc.uldMawbKey()` 會去空白與連字號再大寫
    → SQL 要用 `REPLACE(REPLACE(UPPER(IFNULL(mawb,'')), '-', ''), ' ', '') = ?` 才對得上，
    回填連結則用「撈出該表明細後以 `calc.uldMawbKey()` 比對」逐筆 UPDATE（不可用 SQL LIKE，會誤中）。
19. **預設一定要 dry_run**：這個功能會**寫進打板計劃**（`mawb_records`）。API 端只有明確 `{ dry_run: false }` 才寫；
    前端要「先預覽 → confirm → 再送寫入」，且 UI 必須講清楚「只會新增／連結 Booking、不動訂單與夾重表重量」。
20. **同號 MAWB 已存在就只連結**（避免打板計劃出現兩筆同 MAWB）；同號多筆時**不猜**哪一筆 → `skipped(duplicate_booking)`。
21. **`gross_weight` 要用 `uldBookingTotals().final`**（同票跨板加總、與 W2 的 `/apply` 完全同源），不要在 route 內自己加總。
22. **有 `error` 的夾重表一律 422**：未勾夾重／目標淨重過小等情況下重量還沒確定，寫進 Booking 會污染打板計劃
    （正常流程存檔就會 422，所以這條是防禦性的）。
23. **回填連結只動 `uld_weight_items.mawb_record_id`**：夾重表鎖定中也能執行（不是改重量），
    但寫完要重讀 `loadSheetDetail()` 回傳給前端覆蓋畫面，避免前端狀態與 DB 不一致。

### 5.3 V3（歷史版本）實際踩到的

24. **版本比對不能用「JSON 字串比對」假裝 diff**：要能講出「哪個單位、哪張票、哪個欄位從 X 改成 Y」，
    所以要有欄位級規則（`version-diff.js` 的 `HEADER_FIELDS`／`UNIT_FIELDS`／`ITEM_FIELDS`，含中文標籤與 kg 標記）。
25. **配對鍵一定要用 DB id**：R3 之後 id 穩定；若用「MAWB + 序」配對，改 MAWB 會被誤判成「刪一筆 + 新增一筆」。
    只有**沒有 id 的新列**才退回「MAWB + 序」。
26. **不帶 id 的舊格式 payload 每次儲存都會重建列 → id 全變 → 版本內容也跟著變**（測試踩到：第二次「相同內容」儲存仍多一版）。
    前端 `uldSheetPayload()` 一律帶 id；API 測試要重複儲存時，payload 必須先從 detail 補回 id（`withIds()`）。
27. **「內容相同的儲存不留版」只針對 `save`**：lock／unlock／apply／sync_bookings 即使內容一樣也要留（狀態或連結有變）。
28. **`/versions/diff` 必須宣告在 `/versions/:versionId` 之前**（同層路徑，`diff` 會被當成 versionId → 400）。
29. **版本面板不要整份重畫**：比對結果只更新 `#uldw-versions`（`refreshVersions()`），否則畫面捲動位置會跳掉；
    切換表（openSheet／createNew／backToList）要把 `state.versions`／`state.versionDiff` 重設，避免沿用上一張的資料。

### 5.4 V4（效能量測）實際踩到的

30. **量測一定要「暖機 ＋ 取 median」，不要用單次 `console.time`**：Node／V8 第一次呼叫含 JIT 與物件配置，
    單次量會看到 3～5 倍的抖動（本專案首次呼叫比 median 慢 2～3 倍）。`scripts/bench-uld-weight-calc.js`
    固定先跑 10 次暖機、再量 60 次並輸出 min／median／p95／max；**判定用 median**（p95 看最壞情況）。
31. **`bench-uld-weight-calc.js` 只量 `calc.js`，不含 DOM**：`refreshComputed()` 的成本＝calc ＋ 500 列
    `textContent`／`innerHTML`。calc 只有約 0.6ms（50 板 × 10 票）不代表整體 0.6ms；真要抓卡頓仍需
    Chrome DevTools Performance。**不要因為「calc 很快」就宣稱整個畫面很快**，也不要用 DOM stub（前端測試那種）去量，
    stub 的 `querySelectorAll` 回空陣列，會得到假的 0ms。
32. **PowerShell 會把 node 的 stderr 警告當成失敗（exit code 1）**：跑 `node scripts/bench-uld-weight-calc.js`
    或 `--selftest` 時會出現 `MODULE_TYPELESS_PACKAGE_JSON` 警告（`calc.js` 是 ESM、`package.json` 無 `"type"`），
    PowerShell 會顯示 `[Command exited with code 1]`／`NativeCommandError`，**但腳本其實成功**。
    要看真實結果請看 stdout 內容（或 `node …; $LASTEXITCODE`），不要被紅色文字誤導。
33. **不要在 `calc.js` 裡加「快取上次結果」之類的效能優化**：`uldComputeSheet()` 是前後端共用的純函式，
    加快取會讓後端（每次存檔重算）與前端行為分歧，且目前數據根本不需要。

---

### 5.5 U1／U2／U3（直觀版 UI）實際踩到的

34. **測試對 markup 有硬性要求，改版面時不能「順手」加 class**：
    - `scripts/test-uld-weight-frontend.js` §7.7 用 `/class="uldw-unit"/g` 計數 → 卡片根節點**必須剛好是 `class="uldw-unit"`**，
      狀態改放 data 屬性（`data-compact`）或子元素 class。
    - §15.x 用 `/class="uldw-print-hide"[^>]*>磅差警示 %/` → 進階欄位包進 `<div class="uldw-adv">` 時，
      `<label>` 的 `class="uldw-print-hide"` **不可附加其他 class**（附加就配對不到）。
    - §14.3 要求 `data-action="print"` 出現在 `.uldw-editor-actions` 之後、且中間不能有 `</div>` →
      「⋯ 更多」選單必須包在 `.uldw-editor-actions` 內（開 `<div class="uldw-more">` 在 print 之前、關閉在之後）。
35. **顯示狀態（more／advanced／expanded）放 `state.ui`，用 class 切換、不要 `render()`**：
     `toggleMore()`／`toggleAdvanced()`／`toggleUnitCard()` 只改 class，避免打字中失焦；只有 `toggle-compact`、拖曳完成、
     貼上多列這種「結構性變更」才 `render()`。切換夾重表時 `resetUiState()` 歸零，避免沿用上一張的展開狀態。
36. **板序代號算法**：`unitCode(idx)` 用 `n % 26` → **第 41 板是 `41/AO`**（不是 AP）；前端 `render.js` 與 PDF
     `scripts/uld-weight-report-pdf.js` 各有一份（純顯示），兩邊要一致。
37. **Loading Sheet 的 WT 一律取 `item.final`（夾重後）**，不是 `declared`；表內**只寫數字**（不寫 kg／K，照舊表）；
    `To:` 取航班號前兩碼（`CX1234 → CX`），抓不到就空白——**不要猜航空公司**（5Y 這類代碼不是規律可推的）。
38. **pdf-lib 畫「只有邊框的矩形」要 `drawRectangle({ borderColor, borderWidth, color: undefined })`**：
    省略 `color` 與明確給 `undefined` 行為不同，前者在某些版本會被當成黑底填滿。
39. **卡片拖曳只能「按住把手才啟用 `draggable`」**（`pointerdown` 在 `[data-drag-handle]` 才設 `true`，`dragend` 收回 false）；
    直接讓整張卡 `draggable="true"` 會讓卡片內的 input 無法選字／拖選文字。
40. **貼上解析不要直接用 `String.split(/\s+/)`**：MAWB 本身含空白（`369-9649 4182`），會被切成兩欄。
    做法：Tab 優先（Excel 一定是 Tab）→ 逗號 → 2 個以上空白；再用「含數字且去符號後長度 ≥6」挑出 MAWB。
41. **`state.ui` 是「畫面狀態」，不可進 `uldSheetPayload()`**（否則會多送欄位、也會讓版本快照出現噪音）。
42. **「精簡模式」的預設值很容易做反**（第一版就踩到）：若寫成 `compact = ui.allCompact && !expanded`，
    預設 `allCompact=false` → 卡片**全部展開**，新表看起來比改版前更長。正確做法是**預設收合**：
    `expanded = ui.expanded[uid] ?? ui.expandAll; compact = !expanded;`（`expandAll` 給「全部展開」用）。
43. **新增的欄位容器一定要「共用」既有樣式**：`.uldw-unit-more` 若沒套 `.uldw-unit-fields label`／`input`／`select`
    的 `font-size`／`font-weight`／`padding`／`border-radius`，會掉回瀏覽器預設（字體格格不入、方方正正）。
    改版面時把選擇器一起列進去，不要另寫一套。
44. **原生 `<select>` 會依「最長 option」撐寬**（`N — 無鋰電池`、`P — Prepack（每板 1 個 MAWB）`）→ 會爆出卡片。
    解法：容器 `min-width: 0`、`select { width:100%; max-width:100% }`，長選項欄位加 `grid-column: span 2`。
45. **自動大寫要做三層**：① CSS `text-transform: uppercase`（輸入時就顯示大寫、**不動 value 所以游標不會跳**）；
    ② `onRootInput`／`onRootChange` 寫進 state 時 `toUpperCase()`；③ `uldSheetPayload()` 再轉一次（貼上／舊資料／API 來源）。
    `bulk_ref`（散貨批號）是自由文字，**不要**轉大寫。
46. **TAB 會亂跳的真正原因：`change` 事件裡呼叫 `render()`**。按 TAB 時瀏覽器先送 `change`／`blur`，
    若 handler 同步把整份畫面重畫，被聚焦的 input 被銷毀 → 焦點回到 `body`，下一個 TAB 就從文件最前面跑
    （使用者會覺得「TAB 都從原本那一格開始」）。
    規則：`change` 只寫 state ＋ `refreshComputed(rootEl)`；**只有會改變結構的才 `render()`**
    （目前只有「夾重方式 → 手動 %」會多出比例輸入框）。
47. **明細表欄寬不能用 `width: 100%`**：input 沒有內在寬度，`table-layout: auto` 會把欄位壓到 `min-width`
    （DEST 只看到 1～2 個字母、PCS 只剩 1 位數）。要用**實際最大內容**給固定寬：
    MAWB `000-0000 0000`＝13 字 → 134px；DEST 3 字母 → 58px；PCS ≤9999 → 64px；WT → 84px。
48. **`utils/autocomplete.js` 的預設 Tab 行為會「選取候選並寫回 input」**：使用者只是要移到下一格，
    卻可能被塞入候選值（甚至看起來像「上一格的値跑到這一格」）。夾重表已傳 `tabSelects: false`；
    **其他頁面若也要「Tab 純移動」，要記得一起改**（預設 true 是為了不影響既有訂單／打板的操作習慣）。
49. **瀏覽器自動填入（autofill）會跨欄位塞值**：夾重表所有文字輸入都加 `autocomplete="off"`＋`spellcheck="false"`；
    新增欄位時**不要忘記**（漏一個就可能重現「值跑到別格」）。另外 `addItem()` 有最後一道防線：
    MAWB 與同卡 ULD# 相同時直接擋下並提示。
50. **MAWB 驗證只能「提示」不能「硬擋」**：舊資料／測試資料（`160-00000005` 這類）本來就不符合 mod 7 檢查碼，
    若在 `calc.js` 或存檔流程硬擋，會讓既有表無法儲存。做法：`mawb-format.js` 只提供純函式，
    由 UI 在「加入／貼上」時提示（`confirm` 可選擇仍加入），明細列僅標紅。

---

## 6. 新對話提示詞（直接複製）

```text
延續 AGL-Web-Portal 的「ULD 夾重系統」（Phase 1 ＋ W1～W5 ＋ R1～R4 ＋ V1／V2／V3 ＋ U1／U2／U3 已完成並驗證）。

請先做這幾件事（順序照做）：
1) npm run sync
2) 讀 docs/design/uld-weight-remaining-work.md（▶ 交接摘要、§1 未完成、§2 待決、§3 既定規則、§4 驗證指令、§5 新陷阱）
3) 再讀 docs/design/uld-weight-phase2-handoff.md（陷阱 §4、驗證 §5）、
   docs/design/uld-weight-system.md（規則與算法）、
   CLAUDE.md 的「ULD 夾重系統」段落、WORKSPACE_STATE.md 的待辦清單
4) 先跑一次基準驗證確認環境正常（應全綠：calc 101／rcl 28／mawb 33＋frontend 165／API 148）：
   npm run test:uldweight
   npm run test:uldweight-api
   node scripts/test-nav-order-frontend.js
   node scripts/test-nav-hierarchy.js
   npm run test:loadsim
   node scripts/uld-weight-report-pdf.js --selftest

目前狀態：Phase 1／W1～W5／R1～R4／V1（補建 Booking，預設 dry_run）／V2（批次 PDF 打包 ZIP）／
V3（歷史版本／異動比對）／U1（減法版面）／U2（Enter 加入＋貼上多列＋拖曳板序）／
U3（單板 Loading Sheet PDF）全部完成並驗證通過，**沒有任何必辦項**。

本次目標（只剩這些）：
A. V4 — 大表（>50 板 × 10 票）即時重算節流：**已量測 2026-11-06 → 不需要做**
   （50×10 median 約 0.6ms、100×20 median 約 2.4ms，皆 < 16ms；重測用 `npm run bench:uldweight`）。
   若你要重驗，先跑量測；真的 > 16ms 才依 remaining-work §1.1 做輸入節流。
B. D3／D5／D6（散貨批號對應／0.1 取整／跨板自動拆）：**先問我**再做，不要自己假設
   （remaining-work §2.1 已列好要問的問題）。
C. 若我沒指定，就先回報「目前無必辦項」＋基準驗證結果，並列出 A／B 的取捨等我決定。

限制（不可改動的既定規則）：
- 算法只有一份 public/js/uldweight/calc.js（前後端共用，後端用 import() 載入）；
  磅單解析只有一份 public/js/uldweight/rcl-parse.js；版本比對只有一份 public/js/uldweight/version-diff.js；
  PDF 只吃 loadSheetDetail() 的結果（不在 route／PDF 內另寫算法）。
- P/X 取整一律正整數、B 可選 0.5/1.0；未勾夾重的票重量不變；Port 不檢核；Pre-decl Type 手動。
- 磅差警示是「% 與 kg 同時超過」才算（預設 2%／100kg；0 或空白＝用預設）。
- 比例上下限（clamp_min_pct／clamp_max_pct）只管分攤比例、0＝不限、≥2 票才生效、無解提 CLAMP_INFEASIBLE（warn）。
- 明細以 id 做 diff 更新：前端 payload 要帶 id（新列 null），item 比對要加 uld_id 範圍。
- 前端輸入事件只做局部重算（refreshComputed），不要整份重畫（會失焦）；結構性變更才整份重畫。
- 回寫 Booking Record 只改 mawb_records.gross_weight，不動 orders（D1 已決）。
- 補建 Booking Record 一律「預設 dry_run → 預覽 → 確認才寫入」；已存在的同號 MAWB 只連結、不重複建立。
- 版本快照只存輸入值、以 DB id 配對、每張表保留最近 30 版；`/versions/diff` 必須宣告在 `/versions/:versionId` 之前。
- 舊 DB 補欄位用 PRAGMA table_info ＋ ALTER TABLE；需要 seed／啟動流程的相容性工作要 push 進 db/database.js 的 initTasks（db.ready）。
- PDF 的 CJK 子集必須 CustomFontSubsetEmbedder ＋ PDFFont.of ＋ doc.fonts.push()；PDF 內不要用 emoji／箭頭。
- 直觀版規則（U1／U2／U3）：板數上限 41（ULD_MAX_UNITS）；單位一律 K（Loading Sheet 表內只寫數字）；
  `To:` 取航班號前兩碼；卡片 `class="uldw-unit"` 不可加其他 class；顯示狀態放 state.ui，不進 payload、不進版本快照；
  拖曳只改 seq（顯示與列印順序），不影響計算。

完成後：跑 remaining-work §4 的全部驗證指令、更新
docs/design/uld-weight-remaining-work.md（補新發現／新陷阱）、
docs/design/uld-weight-phase2-handoff.md、CLAUDE.md／PROJECT_MAP.md／WORKSPACE_STATE.md，
最後 npm run sync。
```

> 若 D3／D5／D6 還沒決定，先問使用者再做，不要自己假設。

---

## 7. 相關檔案

| 用途 | 檔案 |
|---|---|
| 未完成工作（本檔） | `docs/design/uld-weight-remaining-work.md` |
| 規則／算法／資料模型／API／UI | `docs/design/uld-weight-system.md` |
| 已完成清單、陷阱、驗證、手動驗收 | `docs/design/uld-weight-phase2-handoff.md` |
| 計算核心（唯一來源） | `public/js/uldweight/calc.js` |
| 版本比對（唯一來源） | `public/js/uldweight/version-diff.js` |
| 貼上多列解析（唯一來源） | `public/js/uldweight/paste-parse.js` |
| 前端狀態／渲染／API | `public/js/uldweight/{state,render,api,booking-search,rcl-parse,rcl-import}.js` |
| 入口與事件委派、列印、PDF 下載、Excel／摘要 | `public/js/uld-weight.js` |
| server 端 PDF 產生器（A4 直式） | `scripts/uld-weight-report-pdf.js` |
| 樣式（含 `@media print`） | `public/css/uld-weight.css` |
| 後端 API | `routes/uld-weight.js`（掛在 `server.js`） |
| 資料表 | `db/database.js`：`uld_weight_sheets` / `uld_weight_ulds` / `uld_weight_items` / `uld_weight_versions` |
| 測試 | `scripts/test-uld-weight-{calc,rcl,frontend,api}.js`；指令 `test:uldweight`、`test:uldweight-api` |
| 效能量測（V4 決策） | `scripts/bench-uld-weight-calc.js`；指令 `npm run bench:uldweight` |
