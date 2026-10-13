# -*- coding: utf-8 -*-
"""SLI/ELI 疊字驗證用橋接：逐頁 150dpi 逐像素比較 + 文字可抽取檢查。

為什麼需要獨立一支：diff 數學（dpi / 灰階 / 門檻 24）與 P2 的
`scripts/sli-eli-font-optimize.py` 必須完全一致，因此直接以 importlib 載入它
（陷阱 #7：檔名含連字號的 Python 檔不能 `import`），不重寫一份。

用法：
    # 批次（建議：Node 驗證腳本用）
    python scripts/sli-eli-diff.py --jobs jobs.json [--dpi 150] [--json]
    #   jobs.json = [{"mawb":"065-...","mine":"a.pdf","ref":"b.pdf","needle":"065-..."}]
    #   ref 可省略（只做文字檢查，不做 diff）

    # 單筆
    python scripts/sli-eli-diff.py --mine a.pdf [--ref b.pdf] [--needle 065-49876385] [--dpi 150] [--json]

輸出（--json）：每筆一行的 JSON 陣列，欄位：
    {mawb, pages, sizes:[[w,h],...], diffPerPage:[..], diffMax, textHits:{needle:bool},
     textLen:[..], diffsAgree:bool}
"""
import argparse
import importlib.util
import json
import os
import sys

import pymupdf as fitz

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def load_font_opt():
    """載入 scripts/sli-eli-font-optimize.py（回傳模組；內含 diff_pages）。"""
    p = os.path.join(SCRIPT_DIR, 'sli-eli-font-optimize.py')
    spec = importlib.util.spec_from_file_location('sli_eli_font_opt', p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def per_page_diff(mine, ref, dpi):
    """逐頁差異比例（與 font-optimize 的 diff_pages 同一套數學）。

    回傳 (list[float], str|None)；尺寸或頁數不一致時回傳 (None, 原因)。
    """
    a, b = fitz.open(mine), fitz.open(ref)
    try:
        if a.page_count != b.page_count:
            return None, f'頁數不同 mine={a.page_count} ref={b.page_count}'
        ratios = []
        for i in range(a.page_count):
            pa = a[i].get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
            pb = b[i].get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
            if (pa.width, pa.height) != (pb.width, pb.height):
                return None, f'page {i} 尺寸不同 {pa.width}x{pa.height} vs {pb.width}x{pb.height}'
            sa, sb = pa.samples, pb.samples
            # 門檻 24 灰階：與 sli-eli-font-optimize.py 的 diff_pages 一致（只算明顯差異）
            diff = sum(1 for x, y in zip(sa, sb) if abs(x - y) > 24)
            ratios.append(diff / max(1, len(sa)))
        return ratios, None
    finally:
        a.close()
        b.close()


def inspect(path, needles, dpi):
    """頁數／尺寸／文字抽取檢查。"""
    doc = fitz.open(path)
    try:
        sizes = [[round(p.rect.width, 2), round(p.rect.height, 2)] for p in doc]
        texts = [p.get_text() for p in doc]
        joined = '\n'.join(texts)
        hits = {n: (n in joined) for n in needles}
        return {
            'pages': doc.page_count,
            'sizes': sizes,
            'textHits': hits,
            'textLen': [len(t) for t in texts],
        }
    finally:
        doc.close()


def run_job(job, dpi, font_opt):
    mine = job['mine']
    ref = job.get('ref')
    needles = job.get('needles') or ([job['needle']] if job.get('needle') else [])
    out = {'mawb': job.get('mawb') or os.path.basename(mine)}
    out.update(inspect(mine, needles, dpi))
    if ref and os.path.exists(ref):
        ratios, why = per_page_diff(mine, ref, dpi)
        out['diffPerPage'] = [round(r * 100, 4) for r in ratios] if ratios else None
        out['diffMax'] = round(max(ratios) * 100, 4) if ratios else None
        out['diffError'] = why
        # 交叉驗證：與 font-optimize 的 diff_pages（取最差頁）必須一致
        if ratios:
            worst, _ = font_opt.diff_pages(mine, ref, dpi=dpi)
            out['diffsAgree'] = abs(worst - max(ratios)) < 1e-9
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', help='批次 job JSON 檔')
    ap.add_argument('--mine', help='單筆：疊字產出 PDF')
    ap.add_argument('--ref', help='單筆：Excel 參考 PDF（可省略）')
    ap.add_argument('--needle', action='append', default=[], help='需出現於抽取文字的關鍵字（可重複）')
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    if args.jobs:
        with open(args.jobs, encoding='utf-8') as fh:
            jobs = json.load(fh)
    elif args.mine:
        jobs = [{'mawb': None, 'mine': args.mine, 'ref': args.ref, 'needles': args.needle}]
    else:
        ap.print_help()
        sys.exit(2)

    font_opt = load_font_opt()
    results = [run_job(j, args.dpi, font_opt) for j in jobs]

    if args.json:
        print(json.dumps(results, ensure_ascii=False))
        return
    for r in results:
        sizes = ' | '.join(f'{w}x{h}' for w, h in r['sizes'])
        diff = ('n/a' if r.get('diffMax') is None
                else ' / '.join(f'{v:.3f}%' for v in r['diffPerPage']) + f' (max {r["diffMax"]:.3f}%)')
        hits = ','.join(k for k, v in r['textHits'].items() if v)
        print(f'{r["mawb"]}: pages={r["pages"]} sizes={sizes} diff={diff} textHit={hits or "-"}')


if __name__ == '__main__':
    main()
