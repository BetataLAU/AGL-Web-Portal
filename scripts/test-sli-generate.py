# -*- coding: utf-8 -*-
"""Verify sli-eli-generate.py produces PDF + xlsx for a single record via Excel COM.

用法：
    python scripts/test-sli-generate.py                # 預設 A4（PDF_PAPER=a4）
    $env:PDF_PAPER='custom'; python scripts/test-sli-generate.py   # 舊紙張行為（對照用）

會印出產出檔案大小與每個 PDF 的頁面尺寸（pt）＋是否為 A4，用來驗證 A4 修正。
"""
import json
import subprocess
import sys
import os
import shutil

work_dir = os.path.abspath("data/test-sli-job")
if os.path.exists(work_dir):
    shutil.rmtree(work_dir)
os.makedirs(work_dir, exist_ok=True)

payload = {
    "template": os.path.abspath("data/templates/cainiao-sli-eli-template.xlsx"),
    "work_dir": work_dir,
    "records": [
        {
            "mawb": "160-15102732",
            "sli": {
                "D23": "160-15102732",
                "D25": "CX",
                "D27": "LHR",
                "D9": "GLOBEXAIR LTD (DAY)\nUNIT 7A FAIRLIE ROAD SLOUGH SL1 4PY",
                "D72": "2026-08-03",
            },
            "eli": {
                "F8": "160-15102732",
                "P11": "LHR",
                "M16": "GLOBEXAIR LTD (DAY)\nUNIT 7A FAIRLIE ROAD SLOUGH SL1 4PY",
                "N21": "+44 208 897 0490",
                "N57": "2026-08-03",
            },
        }
    ],
}

r = subprocess.run(
    [sys.executable, "scripts/sli-eli-generate.py"],
    input=json.dumps(payload),
    capture_output=True,
    text=True,
    timeout=300,
)
print("returncode:", r.returncode)
print("stdout:", r.stdout.strip())
print("stderr:", r.stderr.strip())

if r.returncode != 0:
    sys.exit(1)

print("\n--- Work dir contents ---")
for f in sorted(os.listdir(work_dir)):
    full = os.path.join(work_dir, f)
    print(f, f"({os.path.getsize(full)} bytes)")

print()
print('--- PDF page sizes (pt) ---')
from pypdf import PdfReader  # noqa: E402  (測試腳本：延後載入；缺 pypdf 不影響上方流程)

A4_W, A4_H = 595.3, 841.9
all_a4 = True
pdf_names = [f for f in sorted(os.listdir(work_dir)) if f.lower().endswith('.pdf')]
for f in pdf_names:
    full = os.path.join(work_dir, f)
    reader = PdfReader(full)
    sizes = [(round(float(p.mediabox.width), 1), round(float(p.mediabox.height), 1)) for p in reader.pages]
    is_a4 = bool(sizes) and all(abs(w - A4_W) < 2 and abs(h - A4_H) < 2 for w, h in sizes)
    all_a4 = all_a4 and is_a4
    print('  ' + f + ': pages=' + str(len(reader.pages)) + ' sizes=' + str(sizes) + ' -> ' + ('A4' if is_a4 else 'NOT-A4'))

mode = os.environ.get('PDF_PAPER', 'a4')
if pdf_names:
    print()
    print('PAPER=' + mode + ' -> ' + ('ALL A4 OK' if all_a4 else 'NOT A4'))
    if mode != 'custom' and not all_a4:
        print('  註：Excel 原始匯出紙張可能非 A4（由印表機驅動的 DEVMODE 決定）')
        print('      A4 修正由 Node 端 normalizePdfToA4() 負責；請接著跑：node scripts/test-pdf-a4.js')


print("\nSUCCESS" if os.path.exists(os.path.join(work_dir, "160-15102732 SLI.pdf")) else "FAIL")