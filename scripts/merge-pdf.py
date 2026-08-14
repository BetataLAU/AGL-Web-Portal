# -*- coding: utf-8 -*-
"""
Merge multiple PDF files into one and compress with pypdf.

Usage:
    python scripts/merge-pdf.py --out <output.pdf> <input1.pdf> [<input2.pdf> ...]
"""
import sys
import os
from pypdf import PdfWriter, PdfReader


def compress_pdf(path):
    """Rewrite PDF to remove unused objects & compress."""
    reader = PdfReader(path)
    writer = PdfWriter()
    writer.append_pages_from_reader(reader)
    for page in writer.pages:
        try:
            page.compress_content_streams()  # 壓縮內容流
        except Exception:
            pass
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        writer.write(f)
    os.replace(tmp, path)


def main():
    args = sys.argv[1:]
    if "--out" not in args:
        print("ERROR: 缺少 --out <output.pdf>", file=sys.stderr)
        sys.exit(1)
    idx = args.index("--out")
    out_path = args[idx + 1]
    inputs = args[idx + 2:]
    if not inputs:
        print("ERROR: 沒有輸入 PDF", file=sys.stderr)
        sys.exit(1)

    writer = PdfWriter()
    try:
        for p in inputs:
            reader = PdfReader(p)
            writer.append_pages_from_reader(reader)
        with open(out_path, "wb") as f:
            writer.write(f)
        # 二次壓縮（移除未使用物件 / 壓縮內容流）
        compress_pdf(out_path)
        print(f"MERGED: {out_path}")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()