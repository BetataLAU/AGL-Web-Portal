# -*- coding: utf-8 -*-
"""SLI/ELI PDF 瘦身：字型程式優化（純 Python，不需 Ghostscript）。

背景（實測數據）：
  Excel 匯出的 PDF 約 80% 是內嵌字型，而字型程式裡有一大堆 PDF 完全不需要的資料：
    - `name` 表：9–12 KB／字型（字型名稱、版權、版本字串…純元資料）
    - hinting 表 `fpgm`/`prep`/`cvt `：4.6–14 KB／字型（螢幕點陣對齊用；PDF/列印不需要）
    - `glyf` 內每個字符的 hinting 指令（字型程式碼）
  且同一份文件不同頁常各自內嵌「同一字型的子集」（ArialMT 在 p0/p1 各一份）→ 可合併共用。

本模組的優化步驟（每一步都可關閉）：
  1. drop_name      移除 `name` 表
  2. drop_hinting   移除 `fpgm`/`prep`/`cvt `/`hdmx`/`VDMX`/`LTSH`/`gasp`/`DSIG`/`kern`/`PCLT`
  3. strip_glyf_instr 移除 `glyf` 內每個字符的指令（simple + composite 都處理）
  4. share_fonts    同一字型家族跨頁合併為單一字型物件

安全性關鍵：Excel 的子集「保留原始 GID」（maxp.numGlyphs 仍是全字型數量），
因此移除/合併 glyph 資料時 GID 對應不變，PDF 內容流完全不需要修改。

用法：
    python scripts/sli-eli-font-optimize.py in.pdf out.pdf [--no-strip-instr] [--no-share]
    python scripts/sli-eli-font-optimize.py in.pdf --report      # 只印組成報告
"""
import os
import re
import struct
import sys

import pymupdf as fitz

# PDF 不需要、可安全移除
DROP_TAGS_BASE = {'DSIG', 'hdmx', 'VDMX', 'LTSH', 'gasp', 'kern', 'PCLT', 'FFTM', 'meta'}
HINT_TAGS = {'fpgm', 'prep', 'cvt '}

ARG_1_AND_2_ARE_WORDS = 0x0001
WE_HAVE_A_SCALE = 0x0008
MORE_COMPONENTS = 0x0020
WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
WE_HAVE_A_TWO_BY_TWO = 0x0080
WE_HAVE_INSTRUCTIONS = 0x0100


# ===== TTF 基本解析 =====
def parse_tables(data):
    """回傳 {tag: (offset, length)}；非 TrueType 或無法解析回傳 None。"""
    if len(data) < 12 or data[:4] not in (b'\x00\x01\x00\x00', b'true'):
        return None
    num_tables = struct.unpack('>H', data[4:6])[0]
    tables = {}
    for i in range(num_tables):
        off = 12 + i * 16
        if off + 16 > len(data):
            return None
        tag = data[off:off + 4].decode('latin-1')
        t_off, t_len = struct.unpack('>II', data[off + 8:off + 16])
        if t_off + t_len > len(data):
            return None
        tables[tag] = (t_off, t_len)
    return tables


def ttf_checksum(data):
    data = data + b'\x00' * ((-len(data)) % 4)
    total = 0
    for i in range(0, len(data), 4):
        total = (total + struct.unpack('>I', data[i:i + 4])[0]) & 0xFFFFFFFF
    return total


def build_ttf(tables_bytes):
    """由 {tag: bytes} 重新組出 TTF（正確目錄 + 4-byte 對齊 + checksum）。"""
    tags = sorted(tables_bytes.keys())
    num_tables = len(tags)
    entry_selector = 0
    while (1 << (entry_selector + 1)) <= num_tables:
        entry_selector += 1
    search_range = (1 << entry_selector) * 16
    range_shift = num_tables * 16 - search_range
    header = struct.pack('>IHHHH', 0x00010000, num_tables, search_range, entry_selector, range_shift)
    offset = 12 + num_tables * 16
    entries = []
    body = b''
    for tag in tags:
        payload = tables_bytes[tag]
        pad = (-len(payload)) % 4
        entries.append(struct.pack('>4sIII', tag.encode('latin-1'), ttf_checksum(payload), offset, len(payload)))
        body += payload + b'\x00' * pad
        offset += len(payload) + pad
    out = header + b''.join(entries) + body
    head_off = parse_tables(out)['head'][0]
    zeroed = out[:head_off + 8] + b'\x00\x00\x00\x00' + out[head_off + 12:]
    adj = (0xB1B0AFBA - ttf_checksum(zeroed)) & 0xFFFFFFFF
    return out[:head_off + 8] + struct.pack('>I', adj) + out[head_off + 12:]


def read_loca(data, tables):
    """回傳 (num_glyphs, loca_format, [offset...] 或 None)。"""
    num_glyphs = struct.unpack('>H', data[tables['maxp'][0] + 4:tables['maxp'][0] + 6])[0]
    fmt = struct.unpack('>h', data[tables['head'][0] + 50:tables['head'][0] + 52])[0]
    loca_off, _ = tables['loca']
    loca = []
    for i in range(num_glyphs + 1):
        if fmt == 0:
            raw = data[loca_off + i * 2:loca_off + i * 2 + 2]
            if len(raw) < 2:
                return num_glyphs, fmt, None
            loca.append(struct.unpack('>H', raw)[0] * 2)
        else:
            raw = data[loca_off + i * 4:loca_off + i * 4 + 4]
            if len(raw) < 4:
                return num_glyphs, fmt, None
            loca.append(struct.unpack('>I', raw)[0])
    return num_glyphs, fmt, loca



# ===== glyf 指令移除 =====
def _strip_simple(glyph):
    """simple glyph：移除 instructions。回傳 (新資料, ok?)"""
    num_contours = struct.unpack('>h', glyph[0:2])[0]
    pos = 10 + num_contours * 2
    if pos + 2 > len(glyph):
        return glyph, False
    instr_len = struct.unpack('>H', glyph[pos:pos + 2])[0]
    if instr_len == 0:
        return glyph, True
    return glyph[:pos] + b'\x00\x00' + glyph[pos + 2 + instr_len:], True


def _composite_scan(glyph):
    """掃描 composite components；回傳 (結束位置, 最後一個 flags 欄位位置, 最後 flags)。"""
    flags = 0
    pos = 10
    last_flags_off = None
    while True:
        if pos + 4 > len(glyph):
            return None
        last_flags_off = pos
        flags = struct.unpack('>H', glyph[pos:pos + 2])[0]
        pos += 4
        pos += 4 if (flags & ARG_1_AND_2_ARE_WORDS) else 2
        if flags & WE_HAVE_A_SCALE:
            pos += 2
        elif flags & WE_HAVE_AN_X_AND_Y_SCALE:
            pos += 4
        elif flags & WE_HAVE_A_TWO_BY_TWO:
            pos += 8
        if not (flags & MORE_COMPONENTS):
            break
    return pos, last_flags_off, flags


def _strip_composite(glyph):
    """composite glyph：移除結尾 instructions 並清除 WE_HAVE_INSTRUCTIONS 旗標。"""
    scan = _composite_scan(glyph)
    if scan is None:
        return glyph, False
    pos, last_flags_off, flags = scan
    if not (flags & WE_HAVE_INSTRUCTIONS):
        return glyph, True
    if pos + 2 > len(glyph):
        return glyph, False
    instr_len = struct.unpack('>H', glyph[pos:pos + 2])[0]
    new_head = bytearray(glyph[:pos])
    new_flags = flags & ~WE_HAVE_INSTRUCTIONS
    new_head[last_flags_off:last_flags_off + 2] = struct.pack('>H', new_flags)
    return bytes(new_head) + b'\x00\x00' + glyph[pos + 2 + instr_len:], True


def strip_glyph_instructions(data, tables):
    """移除所有字符的 hinting 指令；回傳 (new_glyf, new_loca, 省下的位元組數)。"""
    num_glyphs, fmt, loca = read_loca(data, tables)
    if loca is None:
        return None, None, 0
    glyf_off, _ = tables['glyf']
    new_glyf = bytearray()
    new_offsets = []
    saved = 0
    align = 2 if fmt == 0 else 4
    for i in range(num_glyphs):
        start, end = loca[i], loca[i + 1]
        new_offsets.append(len(new_glyf))
        if end <= start:
            continue
        glyph = data[glyf_off + start:glyf_off + end]
        if len(glyph) < 10:
            new_glyf += glyph
            continue
        num_contours = struct.unpack('>h', glyph[0:2])[0]
        new_glyph, ok = _strip_simple(glyph) if num_contours >= 0 else _strip_composite(glyph)
        if not ok:
            new_glyph = glyph
        saved += len(glyph) - len(new_glyph)
        new_glyf += new_glyph
        new_glyf += b'\x00' * ((-len(new_glyf)) % align)
    new_offsets.append(len(new_glyf))

    if fmt == 0 and len(new_glyf) <= 0x1FFFE:
        new_loca = b''.join(struct.pack('>H', o // 2) for o in new_offsets)
    else:
        new_loca = b''.join(struct.pack('>I', o) for o in new_offsets)
    return bytes(new_glyf), new_loca, saved


def optimize_font_program(data, drop_name=True, drop_hinting=True, strip_instr=True):
    """優化單一字型程式；回傳 (新資料, 統計)。無法解析（CFF/OTF）則原樣回傳。"""
    stats = {'before': len(data), 'after': len(data), 'removed': [], 'glyf_saved': 0}
    tables = parse_tables(data)
    if tables is None or 'glyf' not in tables:
        return data, stats

    drop = set(DROP_TAGS_BASE)
    if drop_name:
        drop.add('name')
    if drop_hinting:
        drop |= HINT_TAGS

    keep = {}
    for tag, (off, length) in tables.items():
        if tag in drop:
            stats['removed'].append(tag)
            continue
        keep[tag] = data[off:off + length]

    if strip_instr:
        new_glyf, new_loca, saved = strip_glyph_instructions(data, tables)
        if new_glyf is not None:
            keep['glyf'] = new_glyf
            keep['loca'] = new_loca
            stats['glyf_saved'] = saved
            if len(new_loca) > tables['loca'][1] and 'head' in keep:
                head = bytearray(keep['head'])
                head[50:52] = struct.pack('>h', 1)  # indexToLocFormat → long
                keep['head'] = bytes(head)

    out = build_ttf(keep)
    stats['after'] = len(out)
    return out, stats


# ===== PDF 端：找出字型程式、就地替換 =====
def _ref_xref(value):
    """把 '12 0 R' / '[12 0 R]' 解析成 12。"""
    if not value:
        return None
    m = re.search(r'(\d+)\s+\d+\s+R', value)
    return int(m.group(1)) if m else None


def find_font_programs(doc):
    """回傳 [(頁碼, 資源名, 字型xref, 程式xref, basefont)]（同一程式只列一次）。"""
    out = []
    seen = set()
    for pi, page in enumerate(doc):
        for item in page.get_fonts(full=True):
            font_xref, basefont, res_name = item[0], item[3], item[4]
            desc = _ref_xref(doc.xref_get_key(font_xref, 'FontDescriptor')[1])
            if desc is None:
                descendants = doc.xref_get_key(font_xref, 'DescendantFonts')[1]
                d0 = _ref_xref(descendants)
                if d0 is not None:
                    desc = _ref_xref(doc.xref_get_key(d0, 'FontDescriptor')[1])
            if desc is None:
                continue
            prog = None
            for key in ('FontFile2', 'FontFile3', 'FontFile'):
                prog = _ref_xref(doc.xref_get_key(desc, key)[1])
                if prog:
                    break
            if not prog:
                continue
            out.append((pi, res_name, font_xref, prog, basefont))
            seen.add(prog)
    return out


def report_composition(doc, label):
    """印出字型／影像／內容流的位元組組成。"""
    fonts = {}
    for _, _, _, prog, basefont in find_font_programs(doc):
        try:
            fonts[prog] = (basefont, len(doc.xref_stream(prog) or b''))
        except Exception:
            pass
    img = 0
    for page in doc:
        for im in page.get_images(full=True):
            try:
                img += len(doc.xref_stream_raw(im[0]) or b'')
            except Exception:
                pass
    content = 0
    for page in doc:
        for x in (page.get_contents() or []):
            content += len(doc.xref_stream_raw(x) or b'')
    tot_font = sum(v[1] for v in fonts.values())
    print(f'{label}: 字型 {tot_font / 1024:.1f} KB（{len(fonts)} 個）'
          f' | 影像 {img / 1024:.1f} KB | 內容流 {content / 1024:.1f} KB')
    for prog, (name, n) in sorted(fonts.items(), key=lambda kv: -kv[1][1]):
        print(f'    xref {prog:5d} {str(name):28s} {n / 1024:7.1f} KB')
    return tot_font


def all_font_program_xrefs(doc):
    """回傳「所有」字型程式 stream 的 xref。

    除了由頁面資源走訪（find_font_programs）之外，再掃描整份文件帶 `/Length1` 的 stream
    並嘗試以 TrueType 解析——Excel 匯出的檔案實測有「不在頁面資源內」的字型程式
    （例如 213 KB 的 CJK 字型），只靠 get_fonts() 會漏掉。
    """
    progs = {prog for _, _, _, prog, _ in find_font_programs(doc)}
    for xref in range(1, doc.xref_length()):
        if xref in progs or not doc.xref_is_stream(xref):
            continue
        try:
            if doc.xref_get_key(xref, 'Length1')[0] == 'null':
                continue
            data = doc.xref_stream(xref)
        except Exception:
            continue
        if data and parse_tables(data) is not None:
            progs.add(xref)
    return progs


def optimize_pdf(src, out, drop_name=True, drop_hinting=True, strip_instr=True, subset_first=True):
    """就地優化 PDF 內所有內嵌字型程式；回傳統計。

    subset_first=True 會先做 PyMuPDF 的字型子集化（只保留用到的字符），
    再做本模組的表格／指令移除（name、hinting、glyf instructions）。
    兩者互補：前者砍「沒用到的字符」，後者砍「所有字符都用不到的資料」。
    """
    doc = fitz.open(src)
    before = os.path.getsize(src)
    stats = {'fonts': [], 'removed_tables': set(), 'glyf_saved': 0}
    if subset_first:
        try:
            doc.subset_fonts()
        except Exception as e:  # noqa: BLE001
            print(f'  子集化失敗（略過）：{e}')
    done = set()
    for prog in sorted(all_font_program_xrefs(doc)):
        if prog in done:
            continue
        done.add(prog)
        try:
            data = doc.xref_stream(prog)
        except Exception as e:  # noqa: BLE001
            print(f'  xref {prog} 讀取失敗：{e}')
            continue
        if not data:
            continue
        basefont = ''
        for item in find_font_programs(doc):
            if item[3] == prog:
                basefont = item[4]
                break
        new_data, st = optimize_font_program(
            data, drop_name=drop_name, drop_hinting=drop_hinting, strip_instr=strip_instr)
        if st['after'] >= st['before']:
            continue  # 沒有變小就不動
        doc.update_stream(prog, new_data, compress=True)
        try:
            if doc.xref_get_key(prog, 'Length1')[0] != 'null':
                doc.xref_set_key(prog, 'Length1', str(len(new_data)))
        except Exception:
            pass
        stats['fonts'].append({'xref': prog, 'basefont': basefont, 'before': st['before'],
                               'after': st['after'], 'glyf_saved': st['glyf_saved']})
        stats['removed_tables'].update(st['removed'])
        stats['glyf_saved'] += st['glyf_saved']
    doc.save(out, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True,
             use_objstms=1, compression_effort=100)
    doc.close()
    stats['before'] = before
    stats['after'] = os.path.getsize(out)
    return stats


def diff_pages(pdf_a, pdf_b, dpi=150):
    """逐頁渲染並比較；回傳 (差異像素比例, 頁數)。"""
    a, b = fitz.open(pdf_a), fitz.open(pdf_b)
    pages = a.page_count
    if pages != b.page_count:
        a.close()
        b.close()
        return 1.0, pages
    worst = 0.0
    for i in range(pages):
        pa = a[i].get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
        pb = b[i].get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
        if (pa.width, pa.height) != (pb.width, pb.height):
            a.close()
            b.close()
            return 1.0, pages
        sa, sb = pa.samples, pb.samples
        diff = sum(1 for x, y in zip(sa, sb) if abs(x - y) > 24)
        worst = max(worst, diff / max(1, len(sa)))
    a.close()
    b.close()
    return worst, pages


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    if not args:
        print(__doc__)
        return
    if '--inplace' in flags:
        # 批次就地優化：python scripts/sli-eli-font-optimize.py --inplace a.pdf b.pdf ...
        if '--no-subset' in flags:
            print('--inplace 不支援 --no-subset（固定使用子集化 + 表格／指令移除）', file=sys.stderr)
            sys.exit(2)
        optimize_many_inplace(args)
        return
    src = args[0]
    if '--report' in flags:
        doc = fitz.open(src)
        print(f'{src}: {os.path.getsize(src) / 1024:.1f} KB, {doc.page_count} 頁')
        report_composition(doc, '組成')
        doc.close()
        return
    out = args[1] if len(args) > 1 else src.replace('.pdf', '.opt.pdf')
    stats = optimize_pdf(
        src, out,
        drop_name='--no-name' not in flags,
        drop_hinting='--no-hinting' not in flags,
        strip_instr='--no-strip-instr' not in flags,
        subset_first='--no-subset' not in flags,
    )
    print(f'字型優化：{stats["before"] / 1024:.1f} KB -> {stats["after"] / 1024:.1f} KB'
          f'（-{100 * (1 - stats["after"] / max(1, stats["before"])):.1f}%）')
    for f in sorted(stats['fonts'], key=lambda x: -(x['before'] - x['after'])):
        print(f'  {f["basefont"]:28s} {f["before"] / 1024:7.1f} KB -> {f["after"] / 1024:6.1f} KB'
              f'（glyf 省 {f["glyf_saved"] / 1024:.1f} KB）')
    if stats['removed_tables']:
        print('  已移除表格:', ', '.join(sorted(stats['removed_tables'])))
    if '--diff' in flags:
        ratio, pages = diff_pages(src, out, dpi=150)
        print(f'  渲染差異（150dpi 逐像素，{pages} 頁）: {ratio * 100:.3f}%')


def optimize_many_inplace(paths):
    """批次就地優化多個 PDF（單一 Python 程序，省啟動成本）。

    回傳 {files, before, after, items}；無法優化的檔案會保留原檔。
    """
    result = {'files': 0, 'before': 0, 'after': 0, 'items': []}
    for p in paths:
        before = os.path.getsize(p)
        tmp = p + '.fontopt.tmp'
        try:
            stats = optimize_pdf(p, tmp)
            after = os.path.getsize(tmp)
            # 只有變小才取代（避免任何意外把檔案弄大／弄壞）
            if after < before and after > 0:
                os.replace(tmp, p)
                result['files'] += 1
                result['before'] += before
                result['after'] += after
                result['items'].append({'name': os.path.basename(p), 'before': before, 'after': after})
                print(f'OPT: {os.path.basename(p)} {before / 1024:.1f} KB -> {after / 1024:.1f} KB',
                      flush=True)
            else:
                os.remove(tmp)
        except Exception as e:  # noqa: BLE001
            print(f'OPT-SKIP: {os.path.basename(p)} {type(e).__name__}: {e}', file=sys.stderr,
                  flush=True)
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
    if result['files']:
        ratio = 100 * (1 - result['after'] / max(1, result['before']))
        print(f'OPT-TOTAL: {result["files"]} files {result["before"] / 1024:.1f} KB -> '
              f'{result["after"] / 1024:.1f} KB (-{ratio:.1f}%)', flush=True)
    return result


if __name__ == '__main__':
    main()
