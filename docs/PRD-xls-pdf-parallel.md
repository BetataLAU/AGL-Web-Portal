# PRD：XLS Booking「產生 SLI/ELI PDF」多工並行加速

> 建立日期：2026-09-07（晚） ｜ 作者：Betata ｜ 狀態：**待執行**（Plan approved，尚未動工）
> 建議執行 branch：`feat/xls-pdf-parallel`（開好後依下方「執行 SOP」逐步進行）
> 相關主流程檔案：`scripts/xls-workflow.js`、`scripts/sli-eli-generate.py`、`scripts/xls-sli-eli.js`、`scripts/merge-pdf.py`、`routes/xls-booking.js`

---

## 1. 背景與問題

Shipper Role 專案執行 ④「產生 Report + SLI/ELI PDF + ZIP」時，UI 進度條顯示「產生 SLI/ELI PDF（x/N）」逐筆跳，使用者觀察到 **54 個 MAWB 的 PDF 是一個一個被處理**，希望利用多核 CPU 並行加速。

使用者的機器：Intel Core Ultra 7 155H（16 實體核心 / 22 邏輯執行緒）。

現行真正流程（程式碼層級，非 OS 只用一顆 CPU）：

1. **Step 3（`runWorkflow`）**：Node 把全部 records 打包成 `sli-eli-payload.json`，**只啟動 1 個** Python `sli-eli-generate.py` 子程序。
   - Windows 本機 → 偵測到 `win32com` → **Excel COM 引擎**：只開 **1 個 Excel.Application**、開 1 次模板工作簿，然後 `for` 迴圈依序填 `air` / `ELI LETTER` 兩個 sheet 並 `ExportAsFixedFormat` 逐筆產出 PDF。
   - Linux / Railway → **openpyxl + LibreOffice 引擎**：`for` 迴圈依序 load 模板、填表、另存每筆 xlsx；全部完成後再一次 `soffice --headless --convert-to pdf` 批次轉檔。
2. **Step 4**：Node **依序**對每一筆再啟動 **1 個新的** Python `merge-pdf.py`（pypdf 合併 SLI+ELI → `{MAWB}.pdf` 並壓縮），完成才刪除單獨檔。
3. **Step 5**：依航班日分組，`archiver` 依序打包 ZIP（超過 30MB 拆 Part）。

**根本原因**：程式被寫成「順序 await」，同時間只派 1 個任務出去；每個 Python/Excel 子程序本身是獨立的，OS 也會分配核心，只是程式沒讓它們同時存在。加上「一次開 Excel 避免重複啟動成本」的設計讓 54 筆導出全部串在同一序列上。

---

## 2. 目標 / 非目標

### 目標
- 在不改變產出內容的前提下，縮短「產生 SLI/ELI PDF + 合併」的總時間。
- Windows（Excel COM）與 Linux/Railway（LibreOffice）**兩套引擎都要能並行**。
- 並行度能**依系統當時資源自動調整**（CPU 使用率、可用記憶體），避免把機器塞爆。
- 進度條、取消（AbortController）、錯誤回報維持與現況一致（或更好）。

### 非目標
- 不改變 PDF / xlsx / ZIP 的檔名規則、內容、分割規則。
- 不重寫 Excel COM / openpyxl 填表邏輯本身（保留既有引擎為「每批內部」的執行單位）。
- 不處理 Step 1/2（解析、Report 寫入）——目前非瓶頸。
- 不處理 git 歷史包袱（database.db / db/sessions.db 已被追蹤的問題）。

---
## 3. 現況架構細讀（已核對程式碼）

### 3.1 執行鏈

````text
UI 勾選 → POST /api/xls-booking/process → enqueueProcess → runWorkflow()
  ├─ Step 2 : writeReport()                         （報告寫入 master xlsx）
  ├─ Step 3 : spawn 1× python sli-eli-generate.py    ── 逐筆 SLI/ELI xlsx + PDF
  │            引擎選用（sli-eli-generate.py resolve_engine）：
  │            win32com 可 import → COM（本機 Excel）
  │            否則            → openpyxl 填表 + soffice 批次轉 PDF
  ├─ Step 4 : for 迴圈，每筆 spawn 1× python merge-pdf.py（pypdf 合併+壓縮）
  └─ Step 5 : archiver 依 group 依序 zipFiles()
````

### 3.2 關鍵程式位置

| 位置 | 內容 |
|---|---|
| `scripts/xls-workflow.js` ~L390-447 | Step 3：payload 寫檔 → `execFile(py, [sli-eli-generate.py, --payload, ...])`，從 stdout 逐行解析 `PROGRESS: i/N` 回報進度（25%→80%） |
| `scripts/xls-workflow.js` ~L449-467 | Step 4：`for i…` 依序 `mergePdfs([sli, eli], mergedPath)` |
| `scripts/xls-workflow.js` ~L469-501 | Step 5：`for grp of groups` 依序 zip（`planZipParts` 決定是否拆 Part） |
| `scripts/sli-eli-generate.py` `generate_com()` | COM 引擎：**單一 Excel.Application**，`for idx, rec` 逐筆 ExportAsFixedFormat |
| `scripts/sli-eli-generate.py` `generate_openpyxl()` | openpyxl 引擎：逐筆 load template → save xlsx，最後一次 soffice 轉全部 |
| `scripts/xls-sli-eli.js` `mergePdfs` / `mergePdfsWithPdfLib` | pypdf 優先、pdf-lib fallback |
| `scripts/merge-pdf.py` | pypdf 合併 + compress_content_streams |
| `scripts/excel-to-pdf.py` | 單檔 COM 轉 PDF（歷史工具，目前主流程未用） |

### 3.3 為何是「逐個做」

1. Node.js 主程序單執行緒；程式用順序 `await`（Step 3 等 1 個 Python 跑完；Step 4 每筆等上一個 Python 結束才 spawn 下一個）。
2. Step 3 刻意「只開一次 Excel / 一次工作簿」以節省 Excel 冷啟動與模板開檔成本，代價是所有導出序列化。
3. Excel COM 物件 non-thread-safe → **不可**在單一 Python process 內開多條 thread 並行填表；安全並行單位是「整個 Python 子程序（各自獨立 Excel）」。
4. Step 4 每筆 spawn 一個 Python 本身就有重複冷啟動浪費。

---

## 4. 物理限制與預期加速

- **Amdahl 定律**：只有「可並行段」能被線性縮短。若序列段（開 Excel、寫 Report、ZIP 大檔）佔 T_s，並行段佔 T_p，理論加速上限 = (T_s+T_p) / (T_s + T_p/N)。
- 並行不是免費：每多一個 Excel.Application 約多數百 MB RAM；多引擎同時吃 CPU/磁碟；每批要重新開一次工作簿的固定成本會吃掉紅利。
- **預期**：Step 3 單獨看可接近 4–6 倍（以 8 worker 計）；總時間取決於各段佔比 → 第 1 步要先做 profile。
- 目標機器：本機 16 實體核 / 22 緒；Railway 容器核心數通常少，需保守。

---
## 5. 詳細技術設計

### 5.1 總覽架構

````text
Node（runWorkflow Step 3）                 Python child × M（動態 W ≤ M）
┌────────────────────────────┐   spawn   ┌──────────────────────────────┐
│ 任務佇列（小批次 tasks）      │ ────────→ │ 每 child 1 個 sli-eli-generate │
│ records 切成 K 批            │           │ .py --payload … --shard k/K  │
│ 同時執行中 ≤ W（動態調整）     │ ←─exit── │ 引擎自動選 COM / openpyxl     │
│ 進度 = Σ 各批位移 + 本批 i    │ stdout    │ 內部仍是單一 Excel/soffice   │
│ 取消 → kill 全部 child       │           │ 輸出檔名以 MAWB 為準，不衝突   │
└────────────────────────────┘           └──────────────────────────────┘
````

- 每批任務 = 「payload 的子集」。child 啟動參數為 `--shard <k> <K>`：只處理 `records[k-1::K]`（或 offset/count 等價切片）。
- 批次大小 = 每批約 5–10 筆（避免批次過小造成重複開工作簿成本）；總批數 K = ceil(N / 每批筆數)。
- Node 端最多同時執行 W 個 child；每完成一個就從佇列補下一個，並**重新量一次系統資源更新 W**。

### 5.2 資源感知並行度 W（`auto` 模式）

新增模組/函式（建議放 `scripts/xls-sli-eli.js` 或獨立 `scripts/xls-concurrency.js`）：

````js
// 概念 pseudo-code
function detectResources() {
  const cores = os.cpus().length;
  const freeMem = os.freemem();                       // bytes
  let cpuLoadPct = null;                              // 0-100
  if (process.platform === 'win32') {
    // PowerShell: Get-CimInstance Win32_Processor | Select LoadPercentage（全域平均）
    cpuLoadPct = parseFloat(powershell(...));
  } else {
    // Linux: loadavg[0] / cores 為「每核平均負載」，含排程佇列 → 近似使用率
    cpuLoadPct = Math.min(100, (os.loadavg()[0] / cores) * 100);
  }
  return { cores, freeMem, cpuLoadPct };
}

function pickConcurrency(engine) {
  // 環境變數優先：XLS_PDF_CONCURRENCY = auto(預設) | 數字
  const env = process.env.XLS_PDF_CONCURRENCY || 'auto';
  if (/^\d+$/.test(env)) return clamp(Number(env), 1, 16);
  const { cores, freeMem, cpuLoadPct } = detectResources();
  const headroom = cpuLoadPct == null ? 1 : Math.max(0, 1 - cpuLoadPct / 100);
  const cpuCap = Math.max(1, Math.round(cores * headroom));
  const perWorkerMB = engine === 'com' ? 400 : 300;   // Excel vs soffice/openpyxl 估量
  const memCap = Math.max(1, Math.floor(freeMem / (perWorkerMB * 1024 * 1024)));
  const maxCap = Math.min(8, cores);                   // 硬上限，可用 XLS_PDF_MAX_CONCURRENCY 覆寫
  return Math.min(Math.min(cpuCap, memCap), maxCap);
}
````

規則：
- Windows 讀不到 CIM → `cpuLoadPct = null` → headroom 視為 1（保守偏小其實較好，可再改 0.5）。
- Linux 容器：Railway 下 `os.cpus()` 可能回報 host 核心數 → 可讀 cgroup v2 `cpu.max` 或 `/sys/fs/cgroup/…`；讀不到就採保守預設（`cores` 視為 min(os.cpus().length, 2)）。
- 偵測整個失敗 → 回退 Windows=4 / Linux=1–2。
- `XLS_PDF_CONCURRENCY=1` 即完全現況序列行為（回歸測試用）。

### 5.3 `sli-eli-generate.py` 改造（`--shard`）

- 新增 CLI 參數：`--shard <index> <total>`（index 1-based）。
- `main()`：讀 payload 後，若帶 shard → `records = records.filter((r, i) => (i % total) === (index - 1))`。
- `generate_com()` 不變（對傳入的子集依序處理）。注意 Python 側 `PROGRESS: i/len(子集)` 是「本批」計數，Node 端需加位移。
- `generate_openpyxl()`：
  - 填表階段：每 child 處理自己的 xlsx 子集 → 寫入同一 work_dir（檔名以 MAWB 命名，不衝突）。
  - 轉 PDF 階段：若本批仍有檔要轉，soffice 批次指令需加**獨立 profile**：`-env:UserInstallation=file:///<work_dir>/lo-profile-<k>`，避免多個 soffice 同時鎖同 profile。

### 5.4 Node 端 worker-pool dispatcher（Step 3 重寫）

放在 `runWorkflow()` Step 3 區塊，取代「單一 execFile + 讀 stdout」：

1. 計算每批大小與批數 K（可先用固定 8 筆/批；profile 後再調）。
2. `W = pickConcurrency(engine)`；engine 判斷 = 預先跑 `resolvePython()` + 試 import win32com？較省事做法：直接以「是否有環境變數 FORCE_ENGINE / 或預設 com 嘗試」——**建議**新增 `--engine` 參數保留，Node 可先 `ensurePythonModule('openpyxl')`；COM 偵測留給 Python，Node 無法便宜判斷 → 以「W 依平台」計算即可（win32 → 引擎可能是 com，perWorkerMB 用 400；Linux → 300）。
3. 建立 child pool：
   - 每個 task = { k }；同時 spawn ≤ W 個 `execFile(py, [script, '--payload', payloadFile, '--shard', k, K])`。
   - 每 child stdout 即時解析：`PROGRESS: i/c` → 總完成數 = Σ_{已完批次整批筆數} + 本批位移；`reportProgress(25 + 55 × done/N)`。
   - child exit：若 code ≠ 0 → 記 `errors`；每結束一個補派下一個，並**重新 `pickConcurrency`**（更新 W，向下收斂只影響「是否續派」，向上放寬可多用閒置核心）。
   - 收集 `OK: {mawb}` 行與產出 PDF 路徑（沿用現行 glob 方式）。
4. 取消：`assertActive()`/AbortController 觸發 → kill 所有仍在跑的 child，拋出既有取消錯誤路徑。
5. 保持 `recordsPayload.length` 為 0 時跳過（現況行為）。

### 5.5 Step 4 合併有限並行 pool

- 把 `for i` 依序迴圈改為「同時最多 W2 個」的 promise pool（W2 預設 4–6，或沿用 pickConcurrency 的較小值）。每筆 merge 完全獨立（讀 2 PDF → 寫 1 PDF → unlink 原檔）。
- **抉擇點（由 Step 0 profile 數據決定）**：
  - 路徑 A：維持 `mergePdfs`（每筆 spawn python merge-pdf.py），以 pool 限制並行數 4–6。
  - 路徑 B：改用 Node `pdf-lib` 平行合併（`mergePdfsWithPdfLib` 已是 fallback），省 Python 冷啟動；但需驗證檔案大小與 pypdf 版差異可接受。
- 順序不需保證（每筆輸出檔名不同）。

### 5.6 Step 5 ZIP（低優先）

- group 之間獨立 → group 數 > 1 時可平行 `zipFiles`（同時 2–3 個）；多為單 group 時效益低。先不做或最後做。
---

## 6. 預期變更檔案清單

| 檔案 | 變更 |
|---|---|
| `scripts/sli-eli-generate.py` | 新增 `--shard <index> <total>`；openpyxl 引擎的 soffice 加獨立 profile |
| `scripts/xls-workflow.js` | Step 3 重寫為 worker-pool dispatcher；Step 4 改有限並行 pool；取消/錯誤彙整 |
| `scripts/xls-sli-eli.js` 或新增 `scripts/xls-concurrency.js` | 資源感知 `pickConcurrency()`、批次切分、promise pool 工具 |
| （可選）`public/js/xls-booking-workflow.js` | 若進度訊息格式調整，前端不需改（只要仍收到 progress/message） |

不變：產出檔名、PDF 內容、ZIP 分割規則、`sli-eli-payload.json` 結構、API 契約。

---

## 7. 驗證計劃

### Step 0（最先做）：Profile 計時
在 Step 2/3/4/5 之間加臨時時間戳，跑一次實際 job（建議 50+ 筆），記錄：
- Step 3 總秒數、每筆平均（可從 PROGRESS 推估）
- Step 4 總秒數、每筆 merge 平均
- Step 5 總秒數
用途：決定 W、每批筆數、Step 4 走路徑 A 或 B。完成後移除或保留為正式 logging。

### 驗證項目
1. **產出等價性**：同一輸入跑 `XLS_PDF_CONCURRENCY=1`（現況序列）與並行模式，比較：
   - PDF 檔名集合一致（{MAWB}.pdf）
   - SLI/ELI xlsx 檔名一致
   - ZIP 檔名與「Part 分割」一致
   - 抽查 PDF 頁數（可用 pdf-lib/pypdf 讀頁數比對）
2. **回歸**：`XLS_PDF_CONCURRENCY=1` 行為與現況完全相同（含進度順序）。
3. **計時對比**：同筆數下 序列 vs W=4 vs W=8 的 Step 3/4 秒數。
4. **取消**：執行中按取消 → 所有 child 都被 kill、無殘留 python/excel 程序。
5. **錯誤注入**：故意讓某 MAWB 填表失敗（如改壞模板路徑）→ errors 彙整、不卡死、其餘批次照常。
6. **資源保護**：背景跑 CPU 燒機（如 node 吃滿 8 核）時啟動 job → W 自動下降（可打 log 驗證）。

---

## 8. 回滾

- 若 branch 上出問題：`git checkout main` 即回現況（PRD 保留在 main）。
- merge 後若需回滾：`git revert <merge-commit>`。
- 執行期安全網：`XLS_PDF_CONCURRENCY=1` 立即還原為序列行為，不需改程式。

---

## 9. 執行 SOP（明天回到公司用）

在**公司電腦**（已 clone repo）：

1. `git pull origin main` → 應可看到本檔 `docs/PRD-xls-pdf-parallel.md`。
   （若本地有其他未提交變更擋 pull，先 stash：`git stash` → pull → 需要的話 `git stash pop`）
2. `git checkout -b feat/xls-pdf-parallel`（從最新 main 開 branch）。
3. 依序執行：
   - Step 0：profile 計時（§7）
   - Step 1：資源感知模組（§5.2）
   - Step 2：`sli-eli-generate.py` 加 `--shard` + soffice profile（§5.3）
   - Step 3：Node worker-pool dispatcher（§5.4）
   - Step 4：merge 有限並行 pool（§5.5）
   - Step 5：ZIP group 平行（可選，§5.6）
   - Step 6：驗證（§7）
   - Step 7：commit + push branch → 回公司/家再決定 merge
4. 注意：
   - **公司電腦是否裝 pywin32/Excel？** `sli-eli-generate.py` 引擎自動選：有 win32com → Excel COM；沒有 → openpyxl + LibreOffice。若公司機兩者皆無會直接報錯，需先裝（本機 Dockerfile 已含 python3/libreoffice/openpyxl/pypdf 的資訊在 `xls-sli-eli.js resolvePython()` 錯誤訊息中）。
   - 若無法同時跑測試與現況（單機資料庫），確認 process 前的上傳 session 是新的（job 用 uploadId 綁 session）。

---

## 10. 開放問題（執行前需確認/實測）

1. **批次大小**：每批 5–10 筆是否最佳？由 Step 0 profile 的「每筆成本」與「開工作簿成本」決定。
2. **Step 4 路徑 A/B**：pypdf 子程序並行 vs Node pdf-lib 並行，檔案大小/品質差異是否可接受？
3. **Excel COM 多實例**：同一機同時開 4–8 個 Excel.Application 是否穩定？記憶體實際用量？（需實測，這是最大不確定點）
4. **Railway 資源**：容器實際 CPU 配額？`os.cpus()` 回報的是 host 還是容器？需實測或查 Railway dashboard。
5. **soffice 多實例**：獨立 `-env:UserInstallation` 是否確實避開 profile 鎖？（需在 Linux 實測）
6. **進度平滑度**：並行時每批完成時間不均，進度可能跳動；是否要改成「每完成一批才跳一次」的粗糙進度即可？
7. **工作目錄其他 runtime 檔**：`database.db` / `db/sessions.db` / Report 模板在 `git status` 的既有變更如何處理（commit / restore / skip-worktree）。

---

## 11. 附錄：量測紀錄表（執行 Step 0 時填寫）

| 環境 | 筆數 N | 模式 | Step3 秒 | Step4 秒 | Step5 秒 | 總秒 | W/每批 | 備註 |
|---|---|---|---|---|---|---|---|---|
| 本機 Windows/Excel COM | | 序列 (1) | | | | | | |
| 本機 Windows/Excel COM | | W=4 | | | | | | |
| 本機 Windows/Excel COM | | W=8 | | | | | | |
| Railway/LibreOffice | | W=1 | | | | | | |
| Railway/LibreOffice | | W=auto | | | | | | |
