"""Search GitHub for air cargo ULD / 3D bin packing related open-source projects."""
import json
import urllib.request
import urllib.parse
import time

QUERIES = [
    "ULD packing air cargo",
    "3d bin packing",
    "pallet loading optimization",
    "air cargo loading",
    "container loading 3d",
]


def search(q, per_page=8):
    url = "https://api.github.com/search/repositories?" + urllib.parse.urlencode(
        {"q": q, "sort": "stars", "per_page": per_page}
    )
    req = urllib.request.Request(url, headers={
        "User-Agent": "AGL-Research/1.0",
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    lines = []
    for q in QUERIES:
        try:
            data = search(q)
            items = data.get("items", [])
            lines.append(f"\n=== GitHub search: {q} ({data.get('total_count', 0)} total) ===")
            for r in items:
                desc = (r.get("description") or "")[:200]
                lang = r.get("language") or ""
                lines.append(f"  {r['full_name']} | ★{r['stargazers_count']} | {lang} | {desc}")
        except Exception as ex:
            lines.append(f"\n=== GitHub search FAILED: {q} -> {ex}")
        time.sleep(1)  # GitHub search API rate limit is 10/min unauthenticated
    out = "scripts/github-repos-output.txt"
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Wrote {len(lines)} lines to {out}")


if __name__ == "__main__":
    main()