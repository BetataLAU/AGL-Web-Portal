# -*- coding: utf-8 -*-
"""
Generate SLI/ELI xlsx + PDF for all records using Excel COM directly.
Opens the original xlsm template once, fills cells, saves xlsx and exports PDF.
Reads JSON payload from a file path argument (--payload <path>):
{
  "template": "path/to/template.xlsm",
  "work_dir": "path/to/job-dir",
  "records": [
    {
      "mawb": "160-15102732",
      "sli": {"D23": "...", "D25": "CX", "D27": "LHR", "D9": "consignee", "D72": "2026-08-03"},
      "eli": {"F8": "...", "P11": "LHR", "M16": "consignee", "N21": "tel", "N57": "2026-08-03"}
    }
  ]
}
Outputs per record: {mawb} SLI.xlsx / {mawb} ELI.xlsx / {mawb} SLI.pdf / {mawb} ELI.pdf
"""
import sys
import os
import json
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


def main():
    payload = load_payload()
    template = os.path.abspath(payload["template"])
    work_dir = os.path.abspath(payload["work_dir"])
    records = payload.get("records", [])

    import win32com.client
    import pythoncom

    pythoncom.CoInitialize()
    excel = None
    wb = None
    try:
        excel = win32com.client.DispatchEx("Excel.Application")
        excel.Visible = False
        excel.DisplayAlerts = False

        wb = excel.Workbooks.Open(template, ReadOnly=False, UpdateLinks=0)

        for rec in records:
            mawb = rec["mawb"]
            sli_cells = rec.get("sli", {})
            eli_cells = rec.get("eli", {})

            # SLI sheet: air
            ws_sli = wb.Worksheets("air")
            for coord, val in sli_cells.items():
                ws_sli.Range(coord).Value = to_excel_value(val)

            # Export SLI PDF
            sli_pdf = os.path.join(work_dir, f"{mawb} SLI.pdf")
            ws_sli.ExportAsFixedFormat(0, sli_pdf)  # 0 = xlTypePDF

            # Save SLI xlsx (macro removed by Excel automatically for .xlsx)
            sli_xlsx = os.path.join(work_dir, f"{mawb} SLI.xlsx")
            ws_sli.SaveAs(sli_xlsx, 51)  # 51 = xlOpenXMLWorkbook (xlsx)

            # ELI sheet: ELI LETTER
            ws_eli = wb.Worksheets("ELI LETTER")
            for coord, val in eli_cells.items():
                ws_eli.Range(coord).Value = to_excel_value(val)

            eli_pdf = os.path.join(work_dir, f"{mawb} ELI.pdf")
            ws_eli.ExportAsFixedFormat(0, eli_pdf)

            eli_xlsx = os.path.join(work_dir, f"{mawb} ELI.xlsx")
            ws_eli.SaveAs(eli_xlsx, 51)

            print(f"OK: {mawb}")

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


if __name__ == "__main__":
    main()