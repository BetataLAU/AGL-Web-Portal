# -*- coding: utf-8 -*-
"""Verify fill-sli-eli.py output can be opened by Excel COM."""
import json
import subprocess
import sys
import os

payload = {
    "template": os.path.abspath("data/templates/cainiao-sli-eli-template.xlsm"),
    "out": os.path.abspath("data/test-openpyxl.xlsx"),
    "sheet": "air",
    "cells": {
        "D23": "157-87751101",
        "D25": "QR",
        "D27": "MAD",
        "D9": "Test Consignee",
        "D72": "2026-08-03",
    },
}

# 1) run fill bridge with JSON on stdin
r = subprocess.run(
    [sys.executable, "scripts/fill-sli-eli.py"],
    input=json.dumps(payload),
    capture_output=True,
    text=True,
)
print("fill stdout:", r.stdout.strip())
print("fill stderr:", r.stderr.strip())
if r.returncode != 0:
    sys.exit(1)

# 2) open with Excel COM
import win32com.client
import pythoncom

pythoncom.CoInitialize()
excel = win32com.client.DispatchEx("Excel.Application")
excel.Visible = False
excel.DisplayAlerts = False
try:
    wb = excel.Workbooks.Open(payload["out"], ReadOnly=False, UpdateLinks=0)
    ws = wb.Worksheets("air")
    print("OPEN OK, D23 =", ws.Range("D23").Value)
    print("OPEN OK, D25 =", ws.Range("D25").Value)
    print("OPEN OK, D72 =", ws.Range("D72").Value)
    wb.Close(False)
finally:
    excel.Quit()
    pythoncom.CoUninitialize()

print("SUCCESS")