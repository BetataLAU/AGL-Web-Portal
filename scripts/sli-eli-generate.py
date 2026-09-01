# -*- coding: utf-8 -*-
"""
Generate SLI/ELI xlsx + PDF for all records.

自動選引擎：
- 偵測到 win32com（Windows + pywin32）→ 用 Excel COM（本機最精確）
- 否則 → openpyxl 填表 + LibreOffice headless 轉 PDF（跨平台，Railway 適用）

可用 --engine com|openpyxl 強制指定。
"""
import sys
import os
import json
import subprocess
from datetime import datetime


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


# ===== Excel COM 路徑（Windows + Excel） =====
def generate_com(payload, work_dir, records):
    import win32com.client
    import pythoncom

    template = os.path.abspath(payload["template"])
    pythoncom.CoInitialize()
    excel = None
    wb = None
    try:
        excel = win32com.client.DispatchEx("Excel.Application")
        excel.Visible = False
        excel.DisplayAlerts = False

        wb = excel.Workbooks.Open(template, ReadOnly=False, UpdateLinks=0)
        total = len(records)
        for idx, rec in enumerate(records, 1):
            mawb = rec["mawb"]
            # SLI sheet: air
            ws_sli = wb.Worksheets("air")
            for coord, val in rec.get("sli", {}).items():
                ws_sli.Range(coord).Value = to_excel_value(val)
            sli_pdf = os.path.join(work_dir, f"{mawb} SLI.pdf")
            ws_sli.ExportAsFixedFormat(0, sli_pdf, 1)  # 0 = xlTypePDF, 1 = xlQualityMinimum
            sli_xlsx = os.path.join(work_dir, f"{mawb} SLI.xlsx")
            ws_sli.SaveAs(sli_xlsx, 51)  # 51 = xlOpenXMLWorkbook

            # ELI sheet: ELI LETTER
            ws_eli = wb.Worksheets("ELI LETTER")
            for coord, val in rec.get("eli", {}).items():
                ws_eli.Range(coord).Value = to_excel_value(val)
            eli_pdf = os.path.join(work_dir, f"{mawb} ELI.pdf")
            ws_eli.ExportAsFixedFormat(0, eli_pdf, 1)
            eli_xlsx = os.path.join(work_dir, f"{mawb} ELI.xlsx")
            ws_eli.SaveAs(eli_xlsx, 51)

            print(f"OK: {mawb}", flush=True)
            print(f"PROGRESS: {idx}/{total}", flush=True)

        wb.Close(SaveChanges=False)
        wb = None
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
        pythoncom.CoUninitialize()


# ===== openpyxl + LibreOffice 路徑（跨平台，Railway 適用） =====
def generate_openpyxl(payload, work_dir, records):
    import openpyxl

    template = os.path.abspath(payload["template"])
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
        sli_xlsx = os.path.join(work_dir, f"{mawb} SLI.xlsx")
        wb.save(sli_xlsx)

        # ELI：只保留 ELI LETTER sheet 並填值
        wb = openpyxl.load_workbook(template, keep_vba=True)
        for sname in list(wb.sheetnames):
            if sname != "ELI LETTER":
                del wb[sname]
        for coord, val in rec.get("eli", {}).items():
            wb["ELI LETTER"][coord] = to_excel_value(val)
        eli_xlsx = os.path.join(work_dir, f"{mawb} ELI.xlsx")
        wb.save(eli_xlsx)

        xlsx_files.append(sli_xlsx)
        xlsx_files.append(eli_xlsx)
        print(f"OK: {mawb}", flush=True)
        print(f"PROGRESS: {idx}/{total}", flush=True)

    # LibreOffice 批次轉 PDF（一次啟動處理所有檔案，加速）
    cmd = ["soffice", "--headless", "--convert-to", "pdf", "--outdir", work_dir] + xlsx_files
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
    engine = resolve_engine()
    if engine == "com":
        generate_com(payload, work_dir, records)
    else:
        generate_openpyxl(payload, work_dir, records)


if __name__ == "__main__":
    main()
