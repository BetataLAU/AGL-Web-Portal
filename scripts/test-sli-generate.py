# -*- coding: utf-8 -*-
"""Verify sli-eli-generate.py produces PDF + xlsx for a single record via Excel COM."""
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
    "template": os.path.abspath("data/templates/cainiao-sli-eli-template.xlsm"),
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

print("\nSUCCESS" if os.path.exists(os.path.join(work_dir, "160-15102732 SLI.pdf")) else "FAIL")