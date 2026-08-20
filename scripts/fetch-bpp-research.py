"""
Fetch BPP (Bin Packing Problem) related research papers for AGL 3D ULD packing system.
Queries: arXiv API + Crossref API + Semantic Scholar API
Output: plain text summary file
"""
import json
import sys
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime

OUT_FILE = "scripts/research-output.txt"

ARXIV_QUERIES = [
    'all:"bin packing" AND all:"container loading"',
    'all:"3d bin packing"',
    'all:"three-dimensional packing" AND all:"constraints"',
    'ti:"ULD" AND all:"air cargo"',
    'all:"air cargo" AND all:"packing optimization"',
    'all:"center of gravity" AND all:"bin packing"',
]

CROSSREF_QUERIES = [
    "three dimensional bin packing center of gravity",
    "air cargo ULD loading optimization",
    "pallet loading problem air cargo stability",
    "container loading problem support constraint",
]

SEMANTIC_QUERIES = [
    "3D bin packing air freight ULD",
    "container loading problem stability constraints",
    "air cargo pallet loading optimization",
]


def http_get_json(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "AGL-BPP-Research/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def http_get_text(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "AGL-BPP-Research/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def clean(text, max_len=400):
    if not text:
        return ""
    t = " ".join(text.split())
    if len(t) > max_len:
        t = t[:max_len] + "..."
    return t


def fetch_arxiv():
    lines = []
    for q in ARXIV_QUERIES:
        try:
            url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode(
                {"search_query": q, "start": 0, "max_results": 6}
            )
            xml_text = http_get_text(url)
            ns = {"a": "http://www.w3.org/2005/Atom"}
            root = ET.fromstring(xml_text)
            entries = root.findall("a:entry", ns)
            lines.append(f"\n=== arXiv query: {q} ({len(entries)} results) ===")
            for e in entries[:6]:
                title = clean(e.findtext("a:title", "", ns), 150)
                link = e.findtext("a:id", "", ns)
                summary = clean(e.findtext("a:summary", "", ns), 350)
                pub = e.findtext("a:published", "", ns)[:10]
                lines.append(f"  [{pub}] {title}")
                lines.append(f"    URL: {link}")
                lines.append(f"    Abstract: {summary}")
        except Exception as ex:
            lines.append(f"\n=== arXiv query FAILED: {q} -> {ex}")
    return lines


def fetch_crossref():
    lines = []
    for q in CROSSREF_QUERIES:
        try:
            url = "https://api.crossref.org/works?" + urllib.parse.urlencode(
                {"query": q, "rows": 5, "select": "title,author,published,DOI,abstract"}
            )
            data = http_get_json(url)
            items = data.get("message", {}).get("items", [])
            lines.append(f"\n=== Crossref query: {q} ({len(items)} results) ===")
            for it in items:
                title = clean(" ".join(it.get("title", [])), 150)
                doi = it.get("DOI", "")
                year = ""
                pubs = it.get("published", {})
                if pubs.get("date-parts"):
                    year = pubs["date-parts"][0][0]
                abstract = clean(it.get("abstract", ""), 300)
                # strip jats html tags roughly
                abstract = abstract.replace("<jats:p>", "").replace("</jats:p>", " ").replace("<", "<").replace(">", ">").replace("&", "&")
                lines.append(f"  [{year}] {title}")
                lines.append(f"    DOI: https://doi.org/{doi}")
                if abstract:
                    lines.append(f"    Abstract: {abstract}")
        except Exception as ex:
            lines.append(f"\n=== Crossref query FAILED: {q} -> {ex}")
    return lines


def fetch_semantic():
    lines = []
    for q in SEMANTIC_QUERIES:
        try:
            url = "https://api.semanticscholar.org/graph/v1/paper/search?" + urllib.parse.urlencode(
                {"query": q, "limit": 5, "fields": "title,year,abstract,url,externalIds"}
            )
            data = http_get_json(url)
            items = data.get("data", [])
            lines.append(f"\n=== Semantic Scholar query: {q} ({len(items)} results) ===")
            for it in items:
                title = clean(it.get("title", ""), 150)
                year = it.get("year", "")
                url_ = it.get("url", "")
                abstract = clean(it.get("abstract", ""), 300)
                lines.append(f"  [{year}] {title}")
                lines.append(f"    URL: {url_}")
                if abstract:
                    lines.append(f"    Abstract: {abstract}")
        except Exception as ex:
            lines.append(f"\n=== SemanticScholar query FAILED: {q} -> {ex}")
    return lines


def main():
    lines = [f"# BPP Research Fetch ({datetime.now().isoformat()})", ""]
    lines += fetch_arxiv()
    lines += fetch_crossref()
    lines += fetch_semantic()
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Wrote {len(lines)} lines to {OUT_FILE}")


if __name__ == "__main__":
    main()