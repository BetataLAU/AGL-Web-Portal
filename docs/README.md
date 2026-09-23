# 📚 docs — 文件索引與分類規則

> 專案文件的分類準則：**根目錄只放「現役導航文件」**，其餘一律歸入本目錄。
> 新增文件時請先對照下方判準，避免再次散落。

## 根目錄（現役，需隨程式同步更新）

| 檔案 | 角色 | 更新時機 |
|------|------|----------|
| `README.md` | 對外說明（GitHub 首頁）：功能、啟動、API 概覽、常見問題 | 功能/啟動方式變更時 |
| `CLAUDE.md` | AI 專案記憶檔（新對話自動載入，含開機流程） | 結構性變更後（搭配 `npm run sync`） |
| `PROJECT_MAP.md` | 詳細專案地圖：資料模型、API 總表、模組職責 | 同上 |
| `WORKSPACE_STATE.md` | 工作狀態交接：最後 commit、近期里程碑、待辦 REMARK | 任務完成後 |
| `FILE_INVENTORY.md` | 自動產生的檔案清單（**勿手改**） | 由 `npm run sync` 產生 |

## `docs/` 分類

| 目錄 | 放什麼 | 生命週期 |
|------|--------|----------|
| `design/` | 現役功能的設計紀錄／PRD（實作仍會演進，內容需持續補註） | 會更新 |
| `archive/` | 已被實作取代、或僅具歷史價值的規格與 prompt | 只讀，不再更新 |
| `research/` | 研究與外部資料抓取的產物（`*-latest.txt` 為可再生成檔，已列入 `.gitignore`） | 可丟棄 |

### design/

| 檔案 | 說明 |
|------|------|
| `order-system-design.md` | 收/送貨訂單系統原始設計（2026-01，已實作；含「與現況差異」對照表） |
| `xls-pdf-parallel-prd.md` | Shipper Role「SLI/ELI PDF 多工並行」PRD（2026-09 已完成，含實作結果摘要） |

### archive/

| 檔案 | 說明 |
|------|------|
| `uld-packing-spec-deepseek.md` | 3D ULD 裝箱規格 prompt（2026-08-20，附實作對照） |
| `uld-packing-prd-v2.txt` | ULD 智能裝載系統 PRD v2.0（2026-08-21，附實作對照） |

### research/

| 檔案 | 說明 |
|------|------|
| `bpp-research-2026-08-20.txt` | BPP/裝箱文獻抓取快照（由 `scripts/fetch-bpp-research.py` 產生） |
| `github-repos-2026-08-20.txt` | GitHub 開源專案搜尋快照（由 `scripts/fetch-github-repos.py` 產生） |

> 兩支 fetch 腳本的新輸出改寫入 `docs/research/*-latest.txt`（不進版控）。
