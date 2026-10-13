# -*- coding: utf-8 -*-
"""建置 SLI/ELI「疊字」用的空白背景與欄位座標（建置期；Windows + Excel COM + PyMuPDF）。

產出（都在 data/templates/）：
    sli-eli-blank.pdf         A4、2 頁（p0 = SLI/air、p1 = ELI/ELI LETTER），10 個動態格已清空
    sli-eli-blank-p1.png      編輯器底圖（p0）
    sli-eli-blank-p2.png      編輯器底圖（p1）
    sli-eli-fieldmap.default.json  預設欄位座標（Excel 校準值，供「還原」用）
    sli-eli-fieldmap.json          作用中欄位座標（不存在時由 default 複製）
    sli-eli-blank-meta.json        產出資訊（sha256／尺寸／校準誤差／工具版本）

作法是「兩份匯出 + 交叉驗證」：
  1. 清空 10 個動態格 → 匯出空白 PDF（＝背景）
  2. 把 10 個動態格填入唯一 marker（例如 @@D23@@）→ 匯出 marker PDF
  3. 以 Excel COM 讀取每個欄位的合併範圍框（Left/Top/Width/Height）＋字型／對齊／換行／頁面設定
  4. 兩份 PDF 都做 A4 正規化（與執行期 Node 端 normalizePdfToA4() 同一套數學）
  5. 以 marker 在 PDF 中的實測位置「交叉驗證」解析式換算的座標（誤差 > 容許值就列警告）
  6. 背景再做字型優化（scripts/sli-eli-font-optimize.py）與底圖渲染

座標系：一律用 **pt、原點在頁面左上**（與編輯器一致）；PDF 左下原點只在繪製時轉換。

用法：
    python scripts/build-sli-eli-blank.py            # 產出／覆寫全部產物
    python scripts/build-sli-eli-blank.py --keep-work # 保留中間檔（除錯用）
"""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime

import pymupdf as fitz

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA = os.environ.get('DATA_DIR') or os.path.join(ROOT, 'data')
TEMPLATES = os.path.join(DATA, 'templates')
WORK = os.path.join(DATA, 'test-blank-build')

TEMPLATE = os.path.join(TEMPLATES, 'cainiao-sli-eli-template.xlsx')
A4_W, A4_H = 595.28, 841.89
A4_TOLERANCE_PT = 1.0
CALIBRATION_TOLERANCE_PT = 2.5
BACKDROP_DPI = 120

# ===== P4 前置：讓背景內嵌的 Arial 子集涵蓋「疊字可能畫出的所有字元」 =====
# 空白 PDF 是「清空動態格」後匯出的，子集只有 static 字符（缺 J/Q/部分數字…），
# 疊字的 fontMode='auto'（沿用內嵌 Arial）幾乎用不上。做法：清空／marker 匯出完成後，
# 再把動態格填入「全字符集」匯出一份 charset PDF（**不出貨，只當字型來源**），
# 由 scripts/sli-eli-blank-widen-fonts.js 把它的 Arial 字型程式搬進空白（像素必須完全相同）。
CHARSET = ''.join(chr(c) for c in list(range(0x20, 0x7f)) + list(range(0xa0, 0x100)))
CHARSET_FONT_SIZE = 2          # 只為撐出字型子集，內容不會出貨
CHARSET_CELL_CHUNKS = 2        # 每個字型（regular/bold）用幾個動態格

# ===== fieldmap 校準（實測 Excel 參考 PDF 後得到的值；見 docs/design/xls-sli-eli-overlay-prd.md §1 P3）=====
# 為何不靠建置腳本自己算：
#  1) font.sizePt：建置腳本用 marker 墨跡寬度推導縮放會低估 air 頁 ~2.4%（實測值直接寫入較準）
#  2) lineHeightPt：Excel 行距 ≈ size × 1.27（不是 1.2）；D9/M16 實測 7.56 / 10.20
#  3) textBaselineOffsetPt：Excel 用「行盒」定位（Arial hhea ascent 0.9053em / descent 0.2124em），
#     不是墨跡 → 見 baseline_offset()；P2 用 `@` 墨跡校準會偏 0.3~1.4pt（實測已修正）
#  4) dateFormat：日期格會把 payload 的 'YYYY-MM-DD' 顯示成 Excel 數字格式（例 03/Oct/2026）
CALIB_SIZE_PT = {
    'sli.D23': 10.44, 'sli.D25': 10.44, 'sli.D27': 10.44, 'sli.D9': 5.88, 'sli.D72': 7.20,
    'eli.F8': 12.00, 'eli.P11': 12.00, 'eli.M16': 8.04, 'eli.N21': 8.04, 'eli.N57': 9.00,
}
CALIB_LINE_HEIGHT_PT = {
    'sli.D23': 13.25, 'sli.D25': 13.25, 'sli.D27': 13.25, 'sli.D9': 7.56, 'sli.D72': 9.13,
    'eli.F8': 15.22, 'eli.P11': 15.22, 'eli.M16': 10.20, 'eli.N21': 10.20, 'eli.N57': 11.42,
}
CALIB_DATE_FORMAT = {'sli.D72': 'dd/MMM/yyyy', 'eli.N57': 'dd/MMM/yyyy'}
WRAP_PAD_PT = 5.0              # Excel 可用換行寬度 = 合併格寬 − 左右內距（實測）
ARIAL_ASCENT_EM = 0.9053       # Arial hhea ascent（Excel 垂直定位用行盒）
ARIAL_DESCENT_EM = 0.2124      # Arial hhea descent

# 要清空／校準的動態欄位（依 sheet）— 與 scripts/xls-workflow.js 的 recordsPayload 對應
FIELDS = [
    {'key': 'sli.D23', 'page': 0, 'sheet': 'air', 'cell': 'D23', 'source': 'mawb',
     'label': 'MAWB（SLI）'},
    {'key': 'sli.D25', 'page': 0, 'sheet': 'air', 'cell': 'D25', 'source': 'flightCompany',
     'label': '航空公司（SLI）'},
    {'key': 'sli.D27', 'page': 0, 'sheet': 'air', 'cell': 'D27', 'source': 'dest',
     'label': 'DEST（SLI）'},
    {'key': 'sli.D9', 'page': 0, 'sheet': 'air', 'cell': 'D9', 'source': 'cnee',
     'label': 'Consignee（SLI）'},
    {'key': 'sli.D72', 'page': 0, 'sheet': 'air', 'cell': 'D72', 'source': 'flightDate',
     'label': '航班日期（SLI）'},
    {'key': 'eli.F8', 'page': 1, 'sheet': 'ELI LETTER', 'cell': 'F8', 'source': 'mawb',
     'label': 'MAWB（ELI）'},
    {'key': 'eli.P11', 'page': 1, 'sheet': 'ELI LETTER', 'cell': 'P11', 'source': 'dest',
     'label': 'DEST（ELI）'},
    {'key': 'eli.M16', 'page': 1, 'sheet': 'ELI LETTER', 'cell': 'M16', 'source': 'cnee',
     'label': 'Consignee（ELI）'},
    {'key': 'eli.N21', 'page': 1, 'sheet': 'ELI LETTER', 'cell': 'N21', 'source': 'cneeTel',
     'label': '聯絡電話（ELI）'},
    {'key': 'eli.N57', 'page': 1, 'sheet': 'ELI LETTER', 'cell': 'N57', 'source': 'flightDate',
     'label': '航班日期（ELI）'},
]
SHEETS = ['air', 'ELI LETTER']

# Excel 常數
XL_A4 = 9
XL_PORTRAIT = 1
XL_LEFT, XL_CENTER_H, XL_RIGHT = -4131, -4108, -4152
XL_TOP, XL_CENTER_V, XL_BOTTOM = -4160, -4108, -4109


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_font_optimizer():
    """載入 scripts/sli-eli-font-optimize.py（檔名含連字號，無法直接 import）。"""
    path = os.path.join(ROOT, 'scripts', 'sli-eli-font-optimize.py')
    spec = importlib.util.spec_from_file_location('sli_eli_font_optimize', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def h_align_name(v):
    return {XL_LEFT: 'left', XL_CENTER_H: 'center', XL_RIGHT: 'right'}.get(v, 'left')


def v_align_name(v):
    return {XL_TOP: 'top', XL_CENTER_V: 'center', XL_BOTTOM: 'bottom'}.get(v, 'bottom')


def excel_color_to_hex(bgr):
    """Excel 顏色是 BGR 整數（0xBBGGRR）→ '#rrggbb'。"""
    c = int(bgr or 0)
    r, g, b = c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF
    return '#%02x%02x%02x' % (r, g, b)



# ===== Excel COM 操作 =====
def export_sheet(wb, sheet, out_pdf, retries=3):
    """把單一工作表匯出成 PDF（沿用主流程的重試策略）。"""
    ws = wb.Worksheets(sheet)
    last = None
    for attempt in range(1, retries + 1):
        try:
            if os.path.exists(out_pdf):
                os.remove(out_pdf)
            ws.ExportAsFixedFormat(0, out_pdf, 1)  # 0 = xlTypePDF, 1 = xlQualityMinimum
            if os.path.exists(out_pdf) and os.path.getsize(out_pdf) > 0:
                return
            raise RuntimeError('匯出後找不到 PDF')
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.8 * attempt)
    raise RuntimeError(f'{sheet} 匯出失敗：{last}')


def set_cell_values(wb, sheet, values):
    """values: {cell: value}；value 為 None 代表清空。

    注意：合併格必須對「整個合併範圍」操作，否則 Excel 會回
    「We can't do that to a merged cell.」（實測 ClearContents 單一格會失敗）。
    """
    ws = wb.Worksheets(sheet)
    for cell, value in values.items():
        ma = ws.Range(cell).MergeArea
        if value is None:
            ma.ClearContents()
        else:
            ma.Value = value


def set_charset_sink(wb, sheet):
    """把「全字符集」塞進該 sheet 的動態格（P4 前置）。

    目的：讓 Excel 匯出時把這些字符的字形放進 Arial 子集，之後疊字就能沿用背景內嵌的
    Arial（0 額外位元組、字形與 Excel 完全相同）。這份匯出**不會出貨**，只是字型來源。
    - 每個字型（regular / bold）用 CHARSET_CELL_CHUNKS 個動態格分攤全部字元
    - 字級小（2pt）、WrapText=Off、內容都在格子寬度內 → 不會被裁掉、不會重排
    """
    ws = wb.Worksheets(sheet)
    cells = [f['cell'] for f in FIELDS if f['sheet'] == sheet]
    per_font = max(1, len(CHARSET) // CHARSET_CELL_CHUNKS + 1)
    chunks = [CHARSET[i:i + per_font] for i in range(0, len(CHARSET), per_font)]
    for ci, cell in enumerate(cells):
        ma = ws.Range(cell).MergeArea
        ma.ClearContents()
    idx = 0
    for want_bold in (False, True):
        for chunk in chunks:
            if idx >= len(cells):
                break
            ma = ws.Range(cells[idx]).MergeArea
            ma.Value = chunk
            ma.Font.Name = 'Arial'
            ma.Font.Size = CHARSET_FONT_SIZE
            ma.Font.Bold = want_bold
            ma.WrapText = False
            idx += 1


def dump_geometry(wb):
    """讀取 10 個欄位的合併範圍框與樣式、兩個工作表的頁面設定。"""
    geo = {'fields': {}, 'pages': {}}
    for sheet in SHEETS:
        ps = wb.Worksheets(sheet).PageSetup
        print_area = str(ps.PrintArea or '')
        ws = wb.Worksheets(sheet)
        try:
            area = ws.Range(print_area) if print_area else ws.UsedRange
            area_left, area_top = float(area.Left), float(area.Top)
            area_w, area_h = float(area.Width), float(area.Height)
        except Exception:  # noqa: BLE001
            area_left, area_top, area_w, area_h = 0.0, 0.0, 0.0, 0.0
        geo['pages'][sheet] = {
            'paperSize': int(ps.PaperSize), 'orientation': int(ps.Orientation),
            'zoom': (False if ps.Zoom is False else float(ps.Zoom)),
            'fitWide': int(ps.FitToPagesWide), 'fitTall': int(ps.FitToPagesTall),
            'leftMargin': float(ps.LeftMargin), 'rightMargin': float(ps.RightMargin),
            'topMargin': float(ps.TopMargin), 'bottomMargin': float(ps.BottomMargin),
            'headerMargin': float(ps.HeaderMargin), 'footerMargin': float(ps.FooterMargin),
            'printArea': print_area, 'areaLeft': area_left, 'areaTop': area_top,
            'areaWidth': area_w, 'areaHeight': area_h,
            'centerH': bool(ps.CenterHorizontally), 'centerV': bool(ps.CenterVertically),
            'printTitleRows': str(ps.PrintTitleRows or ''),
        }
    for f in FIELDS:
        rng = wb.Worksheets(f['sheet']).Range(f['cell'])
        ma = rng.MergeArea
        font = rng.Font
        geo['fields'][f['key']] = {
            'sheet': f['sheet'], 'cell': f['cell'],
            'mergeArea': str(ma.Address).replace('$', ''),
            'left': float(ma.Left), 'top': float(ma.Top),
            'width': float(ma.Width), 'height': float(ma.Height),
            'fontName': str(font.Name), 'fontSize': float(font.Size),
            'bold': bool(font.Bold), 'italic': bool(font.Italic),
            'color': int(font.Color),  # Excel 為 BGR 編碼，輸出時再轉 RGB
            'hAlign': h_align_name(int(rng.HorizontalAlignment)),
            'vAlign': v_align_name(int(rng.VerticalAlignment)),
            'wrap': bool(rng.WrapText), 'indent': int(rng.IndentLevel),
            'shrink': bool(rng.ShrinkToFit), 'numberFormat': str(rng.NumberFormat),
        }
    return geo


# ===== PDF（PyMuPDF）工具 =====
def merge_pdfs(paths, out):
    doc = fitz.open()
    for p in paths:
        src = fitz.open(p)
        doc.insert_pdf(src)
        src.close()
    doc.save(out, garbage=4, deflate=True, use_objstms=1)
    doc.close()


def widen_fonts(blank_pdf, charset_pdfs, out_pdf):
    """把「字符集匯出 PDF」的 Arial 字型程式搬進空白（呼叫 Node 工具）。

    會驗證字符覆蓋率（不足即建置失敗）並印出子集字符數變化。
    """
    cmd = ['node', os.path.join(ROOT, 'scripts', 'sli-eli-blank-widen-fonts.js'),
           '--blank', blank_pdf, '--out', out_pdf]
    for p in charset_pdfs:
        cmd += ['--charset', p]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8',
                         errors='replace', timeout=180000)
    for line in (res.stdout or '').strip().splitlines():
        print(f'   {line}', flush=True)
    if res.returncode != 0:
        print(f'ERROR: 字型加寬失敗：{(res.stderr or "").strip()}', file=sys.stderr)
        sys.exit(1)


def a4_normalize(src, out):
    """把非 A4 頁面等比縮放成 A4（與 Node 端 normalizePdfToA4() 同一套數學）。

    作法：把頁面內容流用 `q <kx> 0 0 <ky> 0 0 cm ... Q` 包起來，再把 MediaBox/CropBox 設成 A4
    —— 原始內容完全不動，只是整體等比縮放。
    """
    doc = fitz.open(src)
    changed = []
    for page in doc:
        r = page.rect
        if abs(r.width - A4_W) <= A4_TOLERANCE_PT and abs(r.height - A4_H) <= A4_TOLERANCE_PT:
            continue
        kx, ky = A4_W / r.width, A4_H / r.height
        try:
            page.clean_contents()
        except Exception as e:  # noqa: BLE001
            print(f'  clean_contents 失敗（略過）：{e}')
        for xref in (page.get_contents() or []):
            data = doc.xref_stream(xref) or b''
            wrapper = f'q\n{kx:.6f} 0 0 {ky:.6f} 0 0 cm\n'.encode('ascii')
            doc.update_stream(xref, wrapper + data + b'\nQ\n', compress=True)
        page.set_mediabox(fitz.Rect(0, 0, A4_W, A4_H))
        page.set_cropbox(fitz.Rect(0, 0, A4_W, A4_H))
        changed.append((round(r.width, 1), round(r.height, 1), round(kx, 5), round(ky, 5)))
    doc.save(out, garbage=4, deflate=True, use_objstms=1)
    doc.close()
    return changed


def measure_markers(pdf_path, markers):
    """回傳 {marker: {page, x0, y0, x1, y1}}（左上原點 pt）；找不到則不在結果中。"""
    doc = fitz.open(pdf_path)
    found = {}
    for page_index, page in enumerate(doc):
        for marker in markers:
            hits = page.search_for(marker)
            if hits:
                r = hits[0]
                found[marker] = {'page': page_index, 'x0': r.x0, 'y0': r.y0,
                                 'x1': r.x1, 'y1': r.y1}
    doc.close()
    return found


def render_backdrops(pdf_path, out_prefix, dpi=BACKDROP_DPI):
    """把背景每頁渲染成 PNG（編輯器底圖）；回傳 [(path, w, h, bytes)]。"""
    doc = fitz.open(pdf_path)
    outs = []
    for i, page in enumerate(doc):
        path = f'{out_prefix}-p{i + 1}.png'
        pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
        pix.save(path)
        outs.append((path, pix.width, pix.height, os.path.getsize(path)))
    doc.close()
    return outs


# ===== fieldmap 建置（實測校準法） =====
EXTRA_CHARS = 8          # marker B 額外附加的 '@' 數量（用來反推真實縮放）
INK_TOP_FRAC = 0.17      # 頂對齊：文字 ink 上緣距行盒上緣（em，用於推回 box）
INK_BOTTOM_FRAC = 0.21   # 底對齊：文字 ink 下緣距行盒下緣（em）
HELV = fitz.Font('helv')  # 內建 Helvetica 字寬（與 Arial 公制相容）


def _anchor_axis(g, axis):
    """依對齊方式回傳（用於擬合的 Excel 座標, 用於觀測的 marker 邊界）。

    axis='x'：left→(left, x0)、center→(left+w/2, 中心)、right→(left+w, x1)
    axis='y'：top →(top, y0)、center→(top+h/2, 中心)、bottom→(top+h, y1)
    """
    if axis == 'x':
        align = g['hAlign']
        start, size = g['left'], g['width']
    else:
        align = g['vAlign']
        start, size = g['top'], g['height']
    if align in ('left', 'top'):
        return start, 'min'
    if align in ('right', 'bottom'):
        return start + size, 'max'
    return start + size / 2.0, 'mid'


def fit_page_transform(geo, short_hits, long_hits):
    """每個 sheet 擬合 (scale, ox, oy)（A4、左上原點 pt）。

    - scale：由 markerB 的實測寬度 ÷ Helvetica 字寬（同一串文字，對齊不影響寬度）
    - ox/oy：以 markerA 的實測位置對 Excel 儲存格座標做最小平方法（依對齊取對應邊界）
    """
    result = {}
    for sheet in SHEETS:
        rows = []
        for f in FIELDS:
            if f['sheet'] != sheet:
                continue
            g = geo['fields'][f['key']]
            short_marker = '@@' + f['cell'] + '@@'
            long_marker = short_marker + '@' * EXTRA_CHARS
            a, b = short_hits.get(short_marker), long_hits.get(long_marker)
            if not a or not b:
                continue
            # 換行的 marker（高度明顯變兩倍）不能用寬度推縮放
            if (b['y1'] - b['y0']) > (a['y1'] - a['y0']) * 1.5:
                continue
            expected = HELV.text_length(long_marker, fontsize=g['fontSize'])
            if expected <= 0:
                continue
            scale = (b['x1'] - b['x0']) / expected
            if 0.05 < scale < 3.0:
                rows.append({'f': f, 'g': g, 'a': a, 'scale': scale})
        if not rows:
            result[sheet] = None
            continue
        scales = sorted(r['scale'] for r in rows)
        scale = scales[len(scales) // 2]  # 中位數（抗震）
        ox_obs, oy_obs = [], []
        for r in rows:
            g, a = r['g'], r['a']
            bx, edge_x = _anchor_axis(g, 'x')
            by, edge_y = _anchor_axis(g, 'y')
            ax = a['x0'] if edge_x == 'min' else (a['x1'] if edge_x == 'max' else (a['x0'] + a['x1']) / 2)
            ay = a['y0'] if edge_y == 'min' else (a['y1'] if edge_y == 'max' else (a['y0'] + a['y1']) / 2)
            ox_obs.append(ax - scale * bx)
            oy_obs.append(ay - scale * by)
        result[sheet] = {
            'scale': scale,
            'ox': sum(ox_obs) / len(ox_obs),
            'oy': sum(oy_obs) / len(oy_obs),
            'samples': len(rows),
            'scaleSpread': round(scales[-1] - scales[0], 5),
        }
    return result


def _draw_probe(blank_pdf, fields, out_path):
    """把 marker 文字依 fieldmap 畫在空白背景上（模擬疊字產生器）。"""
    font = fitz.Font('helv')
    doc = fitz.open(blank_pdf)
    for f in fields:
        page = doc[f['page']]
        size = f['font']['sizePt']
        text = f['marker']
        width = font.text_length(text, fontsize=size)
        if f['align']['h'] == 'left':
            x = f['origin']['x']
        elif f['align']['h'] == 'right':
            x = f['origin']['x'] - width
        else:
            x = f['origin']['x'] - width / 2.0
        page.insert_text((x, f['origin']['y'] + f['textBaselineOffsetPt']), text,
                         fontsize=size, fontname='helv', color=(0, 0, 0))
    doc.save(out_path)
    doc.close()
    return out_path


def _measure_probe(marker_pdf, probe_pdf, fields):
    """量測疊字結果與 Excel（marker）的差異；回傳 {key: (d_x0, d_top, d_bot)}。"""
    ground, mine = fitz.open(marker_pdf), fitz.open(probe_pdf)
    res = {}
    for f in fields:
        a = ground[f['page']].search_for(f['marker'])
        b = mine[f['page']].search_for(f['marker'])
        if a and b:
            res[f['key']] = (b[0].x0 - a[0].x0, b[0].y0 - a[0].y0, b[0].y1 - a[0].y1)
    ground.close()
    mine.close()
    return res


def baseline_offset(f):
    """Excel 的垂直定位＝「行盒」（Arial hhea ascent/descent），不是墨跡。

    實測（5 筆參考 PDF 的 span origin）驗證：與 Excel 實際 baseline 誤差 ≤ 0.03 pt。
    P2 舊法用 `@` 字元的**墨跡**反推（`@` 在 Arial 的墨跡高度剛好等於 ascent）→ 真實資料偏 0.3~1.4pt。
    """
    size = f['font']['sizePt']
    v = f['align']['v']
    if v == 'top':
        return round(ARIAL_ASCENT_EM * size, 2)
    if v == 'bottom':
        return round(-ARIAL_DESCENT_EM * size, 2)
    return round((ARIAL_ASCENT_EM - ARIAL_DESCENT_EM) / 2.0 * size, 2)


def apply_calibration(fields, transforms, kpage):
    """把「實測 Excel 參考 PDF」得到的校準值寫進欄位（見 CALIB_* 常數註解）。"""
    for f in fields:
        key = f['key']
        tr = transforms.get(f['sheet']) or {}
        if key in CALIB_SIZE_PT:
            f['font']['sizePt'] = CALIB_SIZE_PT[key]
        if key in CALIB_LINE_HEIGHT_PT:
            f['lineHeightPt'] = CALIB_LINE_HEIGHT_PT[key]
        merge_w = f['box']['w'] / (tr.get('scale') or 1.0)   # 還原成 Excel 點
        page_scale = (kpage.get(f['sheet']) or (1.0, 1.0))[0]
        f['wrapWidthPt'] = round((merge_w - WRAP_PAD_PT) * page_scale, 2)
        f['textBaselineOffsetPt'] = baseline_offset(f)
        if key in CALIB_DATE_FORMAT:
            f['dateFormat'] = CALIB_DATE_FORMAT[key]
        else:
            f.pop('dateFormat', None)
        if f.get('wrap'):
            # Excel 對「放不下的行」是不畫 → 行數上限 = floor(儲存格高 / 行距)
            f['maxLines'] = max(1, int(f['box']['h'] // f['lineHeightPt']))
        f['calibration'] = {
            'note': 'P3/P4 校準（實測 Excel 輸出；見 docs/design/xls-sli-eli-overlay-prd.md）',
            'wrapPadPt': WRAP_PAD_PT,
        }


def calibrate_baselines(blank_pdf, marker_pdf, fields, rounds=0):
    """量測 `textBaselineOffsetPt` 與 Excel 的殘差（殘差寫回 calibrationResidual）。

    `textBaselineOffsetPt` 由 apply_calibration() 用解析模型設定（**不再用 `@` 墨跡迭代**，
    那正是 P2 偏 0.3~1.4pt 的原因）。rounds>0 時才做迭代修正（僅除錯用）。
    """
    for f in fields:
        f['textBaselineOffsetPt'] = baseline_offset(f)

    probe = os.path.join(WORK, 'baseline-probe.pdf')
    for _ in range(max(0, rounds)):
        _draw_probe(blank_pdf, fields, probe)
        for f in fields:
            d = _measure_probe(marker_pdf, probe, fields).get(f['key'])
            if not d:
                continue
            v = f['align']['v']
            fix = -(d[1] if v == 'top' else d[2] if v == 'bottom' else (d[1] + d[2]) / 2.0)
            f['textBaselineOffsetPt'] = round(f['textBaselineOffsetPt'] + fix, 2)

    _draw_probe(blank_pdf, fields, probe)
    final = _measure_probe(marker_pdf, probe, fields)
    worst = 0.0
    for f in fields:
        d = final.get(f['key'])
        if not d:
            continue
        v = f['align']['v']
        # QA 指標只看「錨定邊」（top→上緣、bottom→下緣、center→中心）：
        # 非錨定邊的差來自 Helvetica 與 Arial 的 '@' 字形高度不同，與定位無關。
        if v == 'top':
            anchor_err = abs(d[1])
        elif v == 'bottom':
            anchor_err = abs(d[2])
        else:
            anchor_err = abs((d[1] + d[2]) / 2.0)
        f['calibrationResidual'] = [round(d[0], 2), round(d[1], 2), round(d[2], 2)]
        f['anchorResidualPt'] = round(anchor_err, 2)
        worst = max(worst, anchor_err)
    return worst


def build_fieldmap(geo, short_hits, transforms):
    """產生欄位座標。

    - origin：marker 在 PDF 的實測位置（ground truth 文字錨點，依對齊取對應邊界）
    - box：以 marker 錨定 + Excel 儲存格尺寸 × 實測縮放（保證貼合 Excel 實際輸出）
      （先前用「解析式換算」會因 Excel 的雙重縮放／FitToPage 而偏差 40pt 以上，故改此法）
    - calibrationDelta：解析式（fit）預測與 marker 實測的差，僅供診斷
    """
    fields = []
    worst = 0.0
    out_of_bounds = []
    for f in FIELDS:
        g = geo['fields'][f['key']]
        tr = transforms.get(f['sheet'])
        if not tr:
            print(f'   警告：{f["key"]} 所屬工作表無法取得縮放（略過）', flush=True)
            continue
        s = tr['scale']
        size_pt = round(g['fontSize'] * s, 2)
        box_w, box_h = g['width'] * s, g['height'] * s
        short_marker = '@@' + f['cell'] + '@@'
        m = short_hits.get(short_marker)
        if not m:
            print(f'   警告：{f["key"]} 找不到 marker，略過', flush=True)
            continue

        bx, edge_x = _anchor_axis(g, 'x')
        by, edge_y = _anchor_axis(g, 'y')
        ink_cx, ink_cy = (m['x0'] + m['x1']) / 2.0, (m['y0'] + m['y1']) / 2.0
        # origin：依對齊取 marker 的對應邊界（等於 Excel 實際畫出的文字錨點）
        if edge_x == 'min':
            origin_x = m['x0']
        elif edge_x == 'max':
            origin_x = m['x1']
        else:
            origin_x = ink_cx
        if edge_y == 'min':
            origin_y = m['y0']
        elif edge_y == 'max':
            origin_y = m['y1']
        else:
            origin_y = ink_cy
        dx = origin_x - (tr['ox'] + s * bx)
        dy = origin_y - (tr['oy'] + s * by)
        worst = max(worst, abs(dx), abs(dy))

        # box：以 marker 錨定（文字一定落在 box 內）
        if edge_x == 'min':
            box_x = m['x0']
        elif edge_x == 'max':
            box_x = m['x1'] - box_w
        else:
            box_x = ink_cx - box_w / 2.0
        if edge_y == 'min':
            box_y = m['y0'] - INK_TOP_FRAC * size_pt
        elif edge_y == 'max':
            box_y = m['y1'] + INK_BOTTOM_FRAC * size_pt - box_h
        else:
            box_y = ink_cy - box_h / 2.0
        if box_x < -1 or box_y < -1 or box_x + box_w > A4_W + 1 or box_y + box_h > A4_H + 1:
            out_of_bounds.append(f['key'])

        fields.append({
            'key': f['key'], 'page': f['page'], 'sheet': f['sheet'], 'label': f['label'],
            'source': f['source'], 'cell': f['cell'], 'range': g['mergeArea'],
            'box': {'x': round(box_x, 2), 'y': round(box_y, 2),
                    'w': round(box_w, 2), 'h': round(box_h, 2)},
            'origin': {'x': round(origin_x, 2), 'y': round(origin_y, 2)},
            'font': {'excelName': g['fontName'], 'sizePt': size_pt,
                     'bold': g['bold'], 'italic': g['italic'],
                     'color': excel_color_to_hex(g['color'])},
            'align': {'h': g['hAlign'], 'v': g['vAlign']},
            'wrap': g['wrap'], 'lineHeightPt': round(size_pt * 1.2, 2),
            'maxLines': max(1, int(round(box_h / max(0.1, size_pt * 1.2)))),
            'marker': short_marker,
            'markerRect': [round(m['x0'], 2), round(m['y0'], 2), round(m['x1'], 2), round(m['y1'], 2)],
            'calibrationDelta': [round(dx, 2), round(dy, 2)],
        })
    return fields, worst, out_of_bounds




# ===== 主流程 =====
def main():
    keep_work = '--keep-work' in sys.argv
    force = '--force' in sys.argv
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(TEMPLATES, exist_ok=True)
    # 清掉舊中間檔（被 Excel 鎖住的檔就跳過，避免整支中斷）
    for stale in os.listdir(WORK):
        p = os.path.join(WORK, stale)
        if not os.path.isfile(p):
            continue
        try:
            os.remove(p)
        except OSError:
            pass
    # 每次用不同檔名的工作複本（殘留 Excel 鎖住舊檔時也不會卡住）
    work_copy = os.path.join(WORK, f'template-copy-{os.getpid()}.xlsx')
    shutil.copyfile(TEMPLATE, work_copy)

    import pythoncom
    import win32com.client
    import win32process

    marker_map = {}
    long_marker_map = {}
    for f in FIELDS:
        short = '@@' + f['cell'] + '@@'
        marker_map.setdefault(f['sheet'], {})[f['cell']] = short
        long_marker_map.setdefault(f['sheet'], {})[f['cell']] = short + '@' * EXTRA_CHARS

    pythoncom.CoInitialize()
    excel = None
    wb = None
    excel_pid = None
    geo = None
    blank_pdfs, short_pdfs, long_pdfs, charset_pdfs = {}, {}, {}, {}
    try:
        excel = win32com.client.DispatchEx('Excel.Application')
        excel.Visible = False
        excel.DisplayAlerts = False
        try:
            excel_pid = win32process.GetWindowThreadProcessId(excel.Hwnd)[1]
        except Exception:  # noqa: BLE001
            excel_pid = None
        wb = excel.Workbooks.Open(work_copy, ReadOnly=False, UpdateLinks=0)

        print('1) 清空 10 個動態格並匯出「空白」PDF ...', flush=True)
        for sheet in SHEETS:
            set_cell_values(wb, sheet, {cell: None for cell in marker_map[sheet]})
        for sheet in SHEETS:
            out = os.path.join(WORK, f'blank-{sheet.replace(" ", "_")}.pdf')
            export_sheet(wb, sheet, out)
            blank_pdfs[sheet] = out
            print(f'   blank[{sheet}] {os.path.getsize(out) / 1024:.1f} KB', flush=True)

        print('2) 填入 marker 並匯出（座標校準用；短 + 長各一份）...', flush=True)
        for sheet in SHEETS:
            set_cell_values(wb, sheet, marker_map[sheet])
        for sheet in SHEETS:
            out = os.path.join(WORK, f'markerA-{sheet.replace(" ", "_")}.pdf')
            export_sheet(wb, sheet, out)
            short_pdfs[sheet] = out
            print(f'   markerA[{sheet}] {os.path.getsize(out) / 1024:.1f} KB', flush=True)
        for sheet in SHEETS:
            set_cell_values(wb, sheet, long_marker_map[sheet])
        for sheet in SHEETS:
            out = os.path.join(WORK, f'markerB-{sheet.replace(" ", "_")}.pdf')
            export_sheet(wb, sheet, out)
            long_pdfs[sheet] = out
            print(f'   markerB[{sheet}] {os.path.getsize(out) / 1024:.1f} KB', flush=True)

        print('3) 讀取欄位幾何與頁面設定 ...', flush=True)
        geo = dump_geometry(wb)
        for s in SHEETS:
            p = geo['pages'][s]
            print(f'   {s}: zoom={p["zoom"]} paper={p["paperSize"]} area={p["printArea"]} '
                  f'邊界(L{p["leftMargin"]:.1f} T{p["topMargin"]:.1f}) centerH={p["centerH"]}', flush=True)

        print('3b) 填入「全字符集」匯出（P4 前置；僅作字型來源，不出貨）...', flush=True)
        for sheet in SHEETS:
            set_charset_sink(wb, sheet)
        for sheet in SHEETS:
            out = os.path.join(WORK, f'charset-{sheet.replace(" ", "_")}.pdf')
            export_sheet(wb, sheet, out)
            charset_pdfs[sheet] = out
            print(f'   charset[{sheet}] {os.path.getsize(out) / 1024:.1f} KB', flush=True)
    finally:
        if wb is not None:
            try:
                wb.Close(SaveChanges=False)
            except Exception:  # noqa: BLE001
                pass
        if excel is not None:
            try:
                excel.Quit()
            except Exception:  # noqa: BLE001
                pass
        if excel_pid:
            try:
                out = subprocess.run(['tasklist', '/FI', f'PID eq {excel_pid}', '/FO', 'CSV', '/NH'],
                                     capture_output=True, text=True, timeout=15000).stdout or ''
                if 'EXCEL.EXE' in out.upper():
                    subprocess.run(['taskkill', '/PID', str(excel_pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            except Exception:  # noqa: BLE001
                pass
        pythoncom.CoUninitialize()

    if geo is None:
        print('ERROR: 無法取得 Excel 幾何資料（匯出失敗？）', file=sys.stderr)
        sys.exit(1)

    return build_outputs(geo, blank_pdfs, short_pdfs, long_pdfs, charset_pdfs, keep_work, force)


def build_outputs(geo, blank_pdfs, short_pdfs, long_pdfs, charset_pdfs, keep_work, force):
    print('4) 量測原始頁面尺寸並 A4 正規化 ...', flush=True)
    pre_sizes, kpage = {}, {}
    for sheet in SHEETS:
        doc = fitz.open(blank_pdfs[sheet])
        r = doc[0].rect
        pre_sizes[sheet] = (r.width, r.height)
        kpage[sheet] = (A4_W / r.width, A4_H / r.height)
        doc.close()
        print(f'   {sheet}: {r.width:.1f}x{r.height:.1f} pt '
              f'({r.width / 72 * 25.4:.1f}x{r.height / 72 * 25.4:.1f} mm) -> A4 縮放 '
              f'({kpage[sheet][0]:.5f}, {kpage[sheet][1]:.5f})', flush=True)

    blank_2p = os.path.join(WORK, 'blank-2p.pdf')
    blank_a4 = os.path.join(WORK, 'blank-a4.pdf')
    merge_pdfs([blank_pdfs[s] for s in SHEETS], blank_2p)
    a4_normalize(blank_2p, blank_a4)

    marker_hits = {}
    for tag, pdfs in (('short', short_pdfs), ('long', long_pdfs)):
        merged = os.path.join(WORK, f'marker-{tag}-2p.pdf')
        a4 = os.path.join(WORK, f'marker-{tag}-a4.pdf')
        merge_pdfs([pdfs[s] for s in SHEETS], merged)
        a4_normalize(merged, a4)
        names = ['@@' + f['cell'] + '@@' for f in FIELDS]
        if tag == 'long':
            names = [n + '@' * EXTRA_CHARS for n in names]
        marker_hits[tag] = measure_markers(a4, names)
        print(f'   marker[{tag}]: A4 正規化完成，實測 {len(marker_hits[tag])}/{len(names)} 個', flush=True)

    print('5) 背景字型加寬（沿用 Excel 內嵌 Arial 子集；P4 前置）...', flush=True)
    blank_widened = os.path.join(WORK, 'blank-widened.pdf')
    widen_fonts(blank_a4, [charset_pdfs[s] for s in SHEETS if s in charset_pdfs], blank_widened)
    diff_ratio, _ = load_font_optimizer().diff_pages(blank_a4, blank_widened, dpi=150)
    print(f'   加寬前後背景像素差異 {diff_ratio * 100:.4f}%'
          f'{"（必須 0.0000，否則字型搬移破壞了外觀）" if diff_ratio else "（外觀完全不變）"}', flush=True)
    if diff_ratio > 0:
        print('ERROR: 字型搬移改變了背景外觀，已中止', file=sys.stderr)
        sys.exit(1)

    print('6) 背景字型優化 ...', flush=True)
    blank_out = os.path.join(TEMPLATES, 'sli-eli-blank.pdf')
    load_font_optimizer().optimize_pdf(blank_widened, blank_out)
    print(f'   {os.path.getsize(blank_widened) / 1024:.1f} KB -> {os.path.getsize(blank_out) / 1024:.1f} KB',
          flush=True)

    print('6) marker 校準（實測寬度求縮放 + 最小平方法求頁面原點）...', flush=True)
    with open(os.path.join(WORK, 'geometry.json'), 'w', encoding='utf-8') as fh:
        json.dump({'geo': geo, 'markers': marker_hits}, fh, ensure_ascii=False, indent=2)
    print(f'   中間資料已寫入 {os.path.join(WORK, "geometry.json")}', flush=True)
    transforms = fit_page_transform(geo, marker_hits['short'], marker_hits['long'])
    for sheet in SHEETS:
        t = transforms.get(sheet)
        if t:
            print(f'   {sheet}: scale={t["scale"]:.5f} ox={t["ox"]:.2f} oy={t["oy"]:.2f}'
                  f'（樣本 {t["samples"]}，scale 散布 {t["scaleSpread"]}）', flush=True)
        else:
            print(f'   {sheet}: 無法擬合！', flush=True)
    fields, worst, oob = build_fieldmap(geo, marker_hits['short'], transforms)
    print(f'   解析式 vs 實測最大差異 {worst:.2f} pt（僅診斷；box 已改以 marker 錨定）', flush=True)
    if oob:
        print(f'   警告：以下欄位的 box 超出 A4 頁面範圍: {", ".join(oob)}', flush=True)
    if len(fields) != len(FIELDS):
        print(f'   警告：只產生 {len(fields)}/{len(FIELDS)} 個欄位', flush=True)

    print('7) 套用實測校準（字級／行距／baseline 解析模型／換行寬度／日期格式）...', flush=True)
    apply_calibration(fields, transforms, kpage)
    for f in fields:
        print(f'   {f["key"]:9s} size={f["font"]["sizePt"]:5.2f} lh={f["lineHeightPt"]:5.2f} '
              f'baseline={f["textBaselineOffsetPt"]:6.2f} wrapW={f["wrapWidthPt"]:6.2f} '
              f'maxLines={f["maxLines"]}{" dateFormat=" + f["dateFormat"] if f.get("dateFormat") else ""}',
              flush=True)

    print('7b) 量測 baseline 殘差（畫一次 → 與 Excel marker 比對）...', flush=True)
    marker_short_a4 = os.path.join(WORK, 'marker-short-a4.pdf')
    base_worst = calibrate_baselines(blank_out, marker_short_a4, fields, rounds=0)
    print(f'   校準後與 Excel 的最大差異 {base_worst:.2f} pt', flush=True)

    print('8) 產生編輯器底圖 ...', flush=True)
    pngs = render_backdrops(blank_out, os.path.join(TEMPLATES, 'sli-eli-blank'), BACKDROP_DPI)
    for path, w, h, size in pngs:
        print(f'   {os.path.basename(path)} {w}x{h}px {size / 1024:.1f} KB', flush=True)

    now = datetime.now().isoformat(timespec='seconds')
    doc = fitz.open(blank_out)
    pages = []
    for i, page in enumerate(doc):
        sheet = SHEETS[i] if i < len(SHEETS) else ''
        pages.append({
            'index': i, 'sheet': sheet, 'label': 'SLI' if i == 0 else 'ELI',
            'widthPt': round(page.rect.width, 2), 'heightPt': round(page.rect.height, 2),
            'background': f'sli-eli-blank-p{i + 1}.png', 'pngDpi': BACKDROP_DPI,
            'pageScale': ({'x': round(kpage[sheet][0], 5), 'y': round(kpage[sheet][1], 5)}
                          if sheet else None),
        })
    doc.close()

    fieldmap = {
        'version': 2, 'generatedAt': now,
        'template': os.path.basename(TEMPLATE), 'templateSha256': sha256(TEMPLATE),
        'blankPdf': os.path.basename(blank_out), 'blankPdfSha256': sha256(blank_out),
        'paper': {'name': 'A4', 'widthPt': A4_W, 'heightPt': A4_H},
        'coordinateSystem': 'pt, origin top-left (x right / y down)',
        'font': {'mode': 'auto', 'regular': 'Helvetica', 'bold': 'Helvetica-Bold',
                 'note': '優先沿用背景內嵌的 Arial 子集（字形與 Excel 相同、0 額外位元組）；'
                         '未涵蓋的字符自動退回 pdf-lib 標準字型（公制與 Arial 相容）'},
        'calibration': {
            'appliedAt': now,
            'method': 'measure Excel reference PDFs (A4-normalized) with PyMuPDF spans',
            'baselineModel': {'ascentEm': ARIAL_ASCENT_EM, 'descentEm': ARIAL_DESCENT_EM,
                              'note': 'Excel 用行盒定位；勿用 `@` 墨跡迭代（P2 曾偏 0.3~1.4pt）'},
            'wrapPadPt': WRAP_PAD_PT,
        },
        'pages': pages, 'fields': fields,
    }
    default_path = os.path.join(TEMPLATES, 'sli-eli-fieldmap.default.json')
    active_path = os.path.join(TEMPLATES, 'sli-eli-fieldmap.json')
    with open(default_path, 'w', encoding='utf-8') as fh:
        json.dump(fieldmap, fh, ensure_ascii=False, indent=2)
    if force or not os.path.exists(active_path):
        shutil.copyfile(default_path, active_path)
        print(f'   寫入 {os.path.basename(active_path)}（由 default 複製）', flush=True)
    else:
        print(f'   保留既有 {os.path.basename(active_path)}（未覆寫；--force 可強制）', flush=True)

    meta = {
        'generatedAt': now, 'templateSha256': fieldmap['templateSha256'],
        'blankPdfSha256': fieldmap['blankPdfSha256'], 'blankPdfBytes': os.path.getsize(blank_out),
        'calibrationResidualPt': round(base_worst, 2),
        'analyticDeltaMaxPt': round(worst, 2),
        'notes': [
            'calibrationResidualPt＝以 `@` marker 量到的最大殘差（**僅診斷**：`@` 在 Arial 的墨跡'
            '高度＝ascent，與 Helvetica 不同 → 這個數字不代表真實資料的定位精度）',
            'textBaselineOffsetPt 已改用解析模型（Arial 行盒 ascent 0.9053em / descent 0.2124em）：'
            '與 Excel 實際 baseline 的誤差 ≤ 0.03pt（實測 5 筆參考 PDF）',
            'analyticDeltaMaxPt＝僅供診斷：先前用「頁面設定解析式換算」的偏差，box 已改為以 marker 錨定',
            '真正的保真度指標＝scripts/test-sli-eli-overlay.js 的 150dpi 逐像素差異',
        ],
        'prePageSizes': {s: [round(v, 2) for v in pre_sizes[s]] for s in SHEETS},
        'transforms': {s: transforms.get(s) for s in SHEETS},
        'pymupdf': str(fitz.version[0]), 'backdropDpi': BACKDROP_DPI,
    }
    with open(os.path.join(TEMPLATES, 'sli-eli-blank-meta.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)

    print('')
    print('=== 欄位座標（A4、左上原點 pt）===')
    for f in fields:
        print(f'  {f["key"]:9s} {f["range"]:12s} '
              f'box=({f["box"]["x"]:6.1f},{f["box"]["y"]:6.1f},{f["box"]["w"]:5.1f}x{f["box"]["h"]:5.1f}) '
              f'origin=({f["origin"]["x"]:6.1f},{f["origin"]["y"]:6.1f}) '
              f'{f["font"]["sizePt"]:5.2f}pt {f["align"]["h"]}/{f["align"]["v"]} '
              f'wrap={int(f["wrap"])} delta={f["calibrationDelta"]}')
    if not keep_work:
        shutil.rmtree(WORK, ignore_errors=True)
    print('')
    print(f'完成：{blank_out}')
    print(f'      {default_path}')
    print(f'      底圖 {len(pngs)} 張（{BACKDROP_DPI} dpi）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
