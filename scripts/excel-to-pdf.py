# -*- coding: utf-8 -*-
"""
Bridge: convert XLSX/XLSM sheet(s) to PDF via Office 365 Excel COM (pywin32).

Usage:
    python scripts/excel-to-pdf.py <input.xlsx> <output.pdf> [sheet_index_or_name]

If sheet is omitted, the first sheet is exported.
"""
import sys
import os


def convert(input_path, output_path, sheet=None):
    import win32com.client  # pywin32
    import pythoncom

    pythoncom.CoInitialize()
    excel = None
    wb = None
    try:
        excel = win32com.client.DispatchEx("Excel.Application")
        excel.Visible = False
        excel.DisplayAlerts = False

        abs_in = os.path.abspath(input_path)
        abs_out = os.path.abspath(output_path)

        wb = excel.Workbooks.Open(abs_in, ReadOnly=False, UpdateLinks=0)
        if sheet is not None:
            try:
                ws = wb.Worksheets(int(sheet))
            except (ValueError, TypeError):
                ws = wb.Worksheets(sheet)
        else:
            ws = wb.Worksheets(1)

        ws.ExportAsFixedFormat(0, abs_out)  # 0 = xlTypePDF
        print(f"PDF written: {abs_out}")
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
    if len(sys.argv) < 3:
        print("Usage: python scripts/excel-to-pdf.py <input.xlsx> <output.pdf> [sheet]", file=sys.stderr)
        sys.exit(1)
    inp = sys.argv[1]
    out = sys.argv[2]
    sh = sys.argv[3] if len(sys.argv) > 3 else None
    convert(inp, out, sh)