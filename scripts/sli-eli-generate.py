# -*- coding: utf-8 -*-
"""
Generate SLI/ELI xlsx + PDF for all records.

自動選引擎：
- 偵測到 win32com（Windows + pywin32）→ 用 Excel COM（本機最精確）
- 否則 → openpyxl 填表 + LibreOffice headless 轉 PDF（跨平台，Railway 適用）

可用 --engine com|openpyxl 強制指定。

紙張（A4 修正）：
- 預設 PDF_PAPER=a4 → 匯出前把工作表頁面設定設成 A4 直式（對 LibreOffice 等引擎有效）
- PDF_PAPER=custom → 完全不動模板頁面設定（＝舊行為，可一鍵回滾）
- 可用 --paper a4|custom、--a4-zoom <百分比> 或 PDF_A4_ZOOM 覆寫
- 注意：Windows Excel 的匯出紙張由「印表機驅動的 DEVMODE」決定，實測無法在此強制 A4
  （模板 PageSetup 已是 A4/65%，air sheet 仍匯出 322.8×456.9mm = A4 ÷ 0.65）→
  最終 A4 由 Node 端 scripts/xls-sli-eli.js 的 normalizePdfToA4() 等比正規化保證。
"""
import sys
import os
import json
import subprocess
import gc
import time
from datetime import datetime
from pathlib import Path


def to_excel_value(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    # 日期一律以字串寫入（避免 pywintypes.datetime 在新版 pywin32 不存在；
    # 對 SLI/ELI 表單「填日期文字」已是足夠的呈現方式）
    if isinstance(v, str):
        return v
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    return v


def load_payload():
    """支援 --payload <file> 或直接以 JSON 內容作為參數；否則從 stdin 讀（相容舊用法）"""
    args = sys.argv[1:]
    if "--payload" in args:
        idx = args.index("--payload")
        path = args[idx + 1]
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    data = sys.stdin.read()
    if data.strip():
        return json.loads(data)
    raise SystemExit("沒有提供 payload（請用 --payload <json-file> 或 stdin）")


def get_option(name, default=None):
    args = sys.argv[1:]
    if name not in args:
        return default
    idx = args.index(name)
    if idx + 1 >= len(args):
        raise SystemExit(f"{name} 缺少參數")
    return args[idx + 1]


def resolve_engine():
    """auto：win32com 可匯入就用 Excel COM，否則用 openpyxl + LibreOffice"""
    args = sys.argv[1:]
    if "--engine" in args:
        idx = args.index("--engine")
        if len(args) > idx + 1:
            return args[idx + 1]
    try:
        import win32com.client  # noqa: F401
        return "com"
    except Exception:
        return "openpyxl"


# ===== 紙張設定（A4 修正） =====
# 實測（Excel 16.0 + 網路印表機）：模板工作表 PageSetup 明明已是 A4(9)/直式/65%，air sheet
# 仍匯出成 915.3×1295.5pt（322.8×456.9mm = A4 ÷ 0.65）→ 匯出紙張由「印表機驅動的
# DEVMODE / printerSettings1.bin」決定，改 PageSetup、存檔後重開、改 FitToPage 都無法改變。
# 這裡仍然寫入 A4 設定（對 LibreOffice／其他引擎有效，也讓設定顯性化），
# 最終 A4 由 Node 端 xls-sli-eli.js 的 normalizePdfToA4() 等比正規化保證：
#   PDF_PAPER=a4（預設）→ 匯出後把非 A4 頁等比縮成 A4（＝原設計的 A4 × 65%）
#   PDF_PAPER=custom     → 完全不動頁面設定（＝舊行為，可一鍵回滾）
# 可用 --paper / --a4-zoom 或環境變數 PDF_PAPER / PDF_A4_ZOOM 覆寫。
A4_PAPER_SIZE = 9    # xlPaperA4
XL_PORTRAIT = 1      # xlPortrait
SHEET_NAMES = ("air", "ELI LETTER")


def paper_mode():
    """'a4'（預設）或 'custom'（維持模板原設定）。--paper 優先於環境變數 PDF_PAPER。"""
    raw = get_option("--paper", os.environ.get("PDF_PAPER", "a4"))
    mode = str(raw or "a4").strip().lower()
    return mode if mode in ("a4", "custom") else "a4"


def a4_zoom():
    """可選的固定縮放百分比（PDF_A4_ZOOM / --a4-zoom）；未設定則用 FitToPage。"""
    raw = get_option("--a4-zoom", os.environ.get("PDF_A4_ZOOM"))
    if not raw:
        return None
    try:
        zoom = int(float(raw))
    except (TypeError, ValueError):
        return None
    return zoom if 10 <= zoom <= 400 else None


def apply_page_setup_com(ws, zoom):
    """Excel COM：把工作表頁面設定改成 A4 直式（FitToPage 或固定縮放）。"""
    ws.PageSetup.PaperSize = A4_PAPER_SIZE
    ws.PageSetup.Orientation = XL_PORTRAIT
    if zoom:
        ws.PageSetup.Zoom = zoom
        return f"zoom={zoom}"
    # Zoom 必須為 False，FitToPagesWide/Tall 才會生效
    ws.PageSetup.Zoom = False
    ws.PageSetup.FitToPagesWide = 1
    ws.PageSetup.FitToPagesTall = 1
    return "fit=1x1"


def setup_paper_com(wb, mode, zoom):
    """對 air / ELI LETTER 套用 A4 設定；回傳描述字串供 log 與除錯（單一 sheet 失敗不中斷整批）。"""
    if mode != "a4":
        return "custom（維持模板原設定）"
    notes = []
    for sname in SHEET_NAMES:
        try:
            notes.append(f"{sname}={apply_page_setup_com(wb.Worksheets(sname), zoom)}")
        except Exception as e:  # noqa: BLE001 - COM 例外種類繁多
            notes.append(f"{sname}=設定失敗（{e}）")
    return " ".join(notes)


def setup_paper_openpyxl(ws, mode, zoom):
    """openpyxl：把工作表頁面設定改成 A4 直式（LibreOffice 轉檔時遵循）。"""
    if mode != "a4":
        return
    ws.page_setup.paperSize = getattr(ws, "PAPERSIZE_A4", "9")
    ws.page_setup.orientation = "portrait"
    if zoom:
        ws.page_setup.scale = zoom
        return
    from openpyxl.worksheet.properties import PageSetupProperties
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.page_setup.scale = None  # 與 fitToPage 互斥，留著會被 Excel 誤判


# ===== Excel COM 路徑（Windows + Excel） =====
# ExportAsFixedFormat 偶發失敗（-2147352567「Document not saved…」）多半是：
#   1) 目標 PDF 被防毒／索引／同步程序短暫鎖住（同一批其他筆卻成功）
#   2) 多個 worker 併行時，該 Excel 實例剛好被資源競爭或清理程序影響
# 這類失敗是暫時性的，刪掉殘檔後重試即可成功 → 一律重試並驗證檔案真的產出。
PDF_EXPORT_RETRIES = 3        # 每個工作表最多嘗試次數
PDF_EXPORT_RETRY_DELAY = 0.8  # 重試前的等待秒數（每次線性遞增）


def excel_pid_state(pid):
    """判斷 pid 現在是不是 EXCEL.EXE。

    回傳 'excel'（確定是）、'other'（確定不是／行程已結束）、'unknown'（查詢失敗，無法判定）。
    Excel 的 `Quit()` 常無法真正結束行程（實測仍會殘留），因此清理一律靠 taskkill；
    只有在「確定該 PID 已經不是 EXCEL.EXE」時才放掉（PID 被回收給 Node／Python 等行程時，
    誤殺會更嚴重）；查詢失敗（unknown）則沿用舊行為照殺，避免殘留 Excel 實例一直累積。
    """
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=15000,
        ).stdout or ""
    except Exception:
        return "unknown"
    return "excel" if "EXCEL.EXE" in out.upper() else "other"


def export_sheet_pdf(ws, pdf_path, kind, mawb):
    """將工作表匯出成 PDF，失敗時自動重試；回傳成功與否。

    Excel 的 ExportAsFixedFormat 失敗時常不會留下檔案，或留下 0 byte 殘檔，
    因此每次重試前先刪掉殘檔，並在匯出後確認檔案存在且大小 > 0。
    """
    last_err = None
    for attempt in range(1, PDF_EXPORT_RETRIES + 1):
        try:
            if os.path.exists(pdf_path):
                try:
                    os.remove(pdf_path)
                except OSError:
                    pass  # 刪不掉（被鎖）也照樣嘗試覆寫
            ws.ExportAsFixedFormat(0, pdf_path, 1)  # 0 = xlTypePDF, 1 = xlQualityMinimum
            if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0:
                return
            raise RuntimeError(f"匯出後找不到 PDF（{pdf_path}）")
        except Exception as e:  # noqa: BLE001 - COM 例外種類繁多，一律重試
            last_err = e
            if attempt < PDF_EXPORT_RETRIES:
                print(f"RETRY: {mawb} {kind} 第 {attempt} 次失敗（{e}），將重試", flush=True)
                time.sleep(PDF_EXPORT_RETRY_DELAY * attempt)
    raise RuntimeError(f"{kind} PDF 匯出失敗（已重試 {PDF_EXPORT_RETRIES} 次）: {last_err}")


def generate_com(payload, work_dir, records):
    import win32com.client
    import pythoncom
    import win32process

    template = os.path.abspath(payload["template"])
    pythoncom.CoInitialize()
    excel = None
    wb = None
    excel_pid = None
    try:
        excel = win32com.client.DispatchEx("Excel.Application")
        excel.Visible = False
        excel.DisplayAlerts = False
        try:
            excel_pid = win32process.GetWindowThreadProcessId(excel.Hwnd)[1]
        except Exception:
            excel_pid = None

        wb = excel.Workbooks.Open(template, ReadOnly=True, UpdateLinks=0)

        # ===== A4 修正：先把兩張工作表的紙張設定改成 A4 直式（詳見上方說明）=====
        mode = paper_mode()
        paper_desc = setup_paper_com(wb, mode, a4_zoom())
        print(f"PAPER: mode={mode} {paper_desc}", flush=True)
        # FitToPage 需要重新計算列印範圍 → 允許 Excel 重算（AutoFit 不影響填值）
        try:
            excel.Calculate()
        except Exception:
            pass

        total = len(records)
        failed = 0
        for idx, rec in enumerate(records, 1):
            mawb = rec["mawb"]
            try:
                # SLI sheet: air
                ws_sli = wb.Worksheets("air")
                for coord, val in rec.get("sli", {}).items():
                    ws_sli.Range(coord).Value = to_excel_value(val)
                sli_pdf = os.path.join(work_dir, f"{mawb} SLI.pdf")
                export_sheet_pdf(ws_sli, sli_pdf, "SLI", mawb)

                # ELI sheet: ELI LETTER
                ws_eli = wb.Worksheets("ELI LETTER")
                for coord, val in rec.get("eli", {}).items():
                    ws_eli.Range(coord).Value = to_excel_value(val)
                eli_pdf = os.path.join(work_dir, f"{mawb} ELI.pdf")
                export_sheet_pdf(ws_eli, eli_pdf, "ELI", mawb)
            except Exception as e:  # 單筆失敗不中斷整批（其餘照常產生），最後以非 0 結束碼回報
                failed += 1
                print(f"FAIL: {mawb} {e}", flush=True)
            else:
                print(f"OK: {mawb}", flush=True)
            print(f"PROGRESS: {idx}/{total}", flush=True)

        wb.Close(SaveChanges=False)
        wb = None
        if failed:
            print(f"ERROR: {failed} 筆 SLI/ELI 產生失敗（詳見上列 FAIL: 行）", file=sys.stderr)
            sys.exit(1)
        print("DONE")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if wb is not None:
            try:
                wb.Close(SaveChanges=False)
            except Exception:
                pass
        if excel is not None:
            try:
                excel.Quit()
            except Exception:
                pass
        wb = None
        excel = None
        gc.collect()
        if excel_pid and excel_pid_state(excel_pid) != "other":
            # 結束殘留 Excel（Quit 常常沒用）；僅在確定該 PID 已不是 EXCEL.EXE 時才放過
            subprocess.run(
                ["taskkill", "/PID", str(excel_pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        pythoncom.CoUninitialize()


# ===== openpyxl + LibreOffice 路徑（跨平台，Railway 適用） =====
def generate_openpyxl(payload, work_dir, records, lo_profile=None):
    import openpyxl

    template = os.path.abspath(payload["template"])
    mode = paper_mode()
    zoom = a4_zoom()
    print(
        f"PAPER: mode={mode} "
        + ("custom（維持模板原設定）" if mode != "a4" else (f"openpyxl a4 zoom={zoom}" if zoom else "openpyxl a4 fit=1x1")),
        flush=True,
    )
    total = len(records)
    xlsx_files = []
    for idx, rec in enumerate(records, 1):
        mawb = rec["mawb"]

        # SLI：只保留 air sheet 並填值
        wb = openpyxl.load_workbook(template, keep_vba=True)
        for sname in list(wb.sheetnames):
            if sname != "air":
                del wb[sname]
        for coord, val in rec.get("sli", {}).items():
            wb["air"][coord] = to_excel_value(val)
        setup_paper_openpyxl(wb["air"], mode, zoom)
        sli_xlsx = os.path.join(work_dir, f"{mawb} SLI.xlsx")
        wb.save(sli_xlsx)

        # ELI：只保留 ELI LETTER sheet 並填值
        wb = openpyxl.load_workbook(template, keep_vba=True)
        for sname in list(wb.sheetnames):
            if sname != "ELI LETTER":
                del wb[sname]
        for coord, val in rec.get("eli", {}).items():
            wb["ELI LETTER"][coord] = to_excel_value(val)
        setup_paper_openpyxl(wb["ELI LETTER"], mode, zoom)
        eli_xlsx = os.path.join(work_dir, f"{mawb} ELI.xlsx")
        wb.save(eli_xlsx)

        xlsx_files.append(sli_xlsx)
        xlsx_files.append(eli_xlsx)
        print(f"OK: {mawb}", flush=True)
        print(f"PROGRESS: {idx}/{total}", flush=True)

    # LibreOffice 批次轉 PDF（一次啟動處理所有檔案，加速）
    cmd = ["soffice", "--headless"]
    if lo_profile:
        profile_url = Path(lo_profile).resolve().as_uri()
        cmd.append(f"-env:UserInstallation={profile_url}")
    cmd += ["--convert-to", "pdf", "--outdir", work_dir] + xlsx_files
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=1800000)
    except FileNotFoundError:
        print("ERROR: 找不到 soffice（LibreOffice）。請在部署環境安裝 LibreOffice，或改用本地 Excel 版。", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"ERROR: LibreOffice 轉 PDF 失敗: {e.stderr or e.stdout}", file=sys.stderr)
        sys.exit(1)
    print("DONE")


def main():
    payload = load_payload()
    work_dir = os.path.abspath(payload["work_dir"])
    records = payload.get("records", [])
    shard_index = int(get_option("--shard-index", "0"))
    shard_total = int(get_option("--shard-total", "0"))
    if shard_total:
        if shard_index < 1 or shard_index > shard_total:
            raise SystemExit("--shard-index 必須介於 1 和 --shard-total 之間")
        records = records[shard_index - 1::shard_total]
    engine = resolve_engine()
    if engine == "com":
        generate_com(payload, work_dir, records)
    else:
        lo_profile = get_option("--lo-profile")
        generate_openpyxl(payload, work_dir, records, lo_profile)


if __name__ == "__main__":
    main()
