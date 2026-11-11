#!/usr/bin/env python3
"""Scrape d-tamer-idle sprites, rename to our skb ids, save to data/ as separate files.

Usage: python3 scrape_sprites.py [--out DIR]
Reads id->name mapping from data/digimon-sprites-id-map.json.
Each downloaded sprite is saved as skb-{id}.png in the output dir.
"""
import argparse
import json
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

BASE_URL = "https://d-tamer-idle.vercel.app/sprites/"
DEFAULT_OUT = "data/sprites-idle"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 "
        "Chrome/140.0 Safari/537.36"
    )
}


def variants(name: str) -> list[str]:
    """Return candidate filenames for a digimon name, most specific first.

    The site is case-insensitive and treats space / '-' / '_' interchangeably,
    so we just try the raw name, a space->hyphen form, and a hyphen->underscore
    form to be safe.
    """
    name = name.strip()
    v = [name]
    if " " in name:
        v.append(name.replace(" ", "-"))
    if "-" in name:
        v.append(name.replace("-", "_"))
        # space variant didn't cover e.g. "Cherubimon (Black)" -> "(Black)"
    if "(" in name:
        v.append(name.replace(" (", "_").replace(")", ""))
        v.append(name.replace("(", "_").replace(")", ""))
    # de-dupe preserving order
    seen, out = set(), []
    for x in v:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def download_one(did: str, name: str, output: Path):
    dest = output / f"{did}.png"
    if dest.exists() and dest.stat().st_size > 0:
        return {"id": did, "name": name, "status": "exists"}

    for cand in variants(name):
        url = f"{BASE_URL}{cand}.png"
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
        except requests.RequestException as e:
            return {"id": did, "name": name, "status": "error", "error": str(e)}
        if r.status_code == 200 and "image" in r.headers.get("content-type", "").lower():
            dest.write_bytes(r.content)
            return {"id": did, "name": name, "status": "downloaded",
                    "size": len(r.content), "url": url}
        if r.status_code != 404:
            # transient error, keep trying next variant
            continue
    return {"id": did, "name": name, "status": "not_found"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--map", default="data/digimon-sprites-id-map.json")
    ap.add_argument("-w", "--workers", type=int, default=12)
    args = ap.parse_args()

    map_file = Path(args.map)
    if not map_file.exists():
        print(f"map not found: {map_file}")
        sys.exit(1)

    with open(map_file) as fh:
        mapping = json.load(fh)
    print(f"{len(mapping)} digimons in map.")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    print(f"Saving to: {out.resolve()}")

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(download_one, did, name, out): did
                for did, name in mapping.items()}
        for fut in as_completed(futs):
            r = fut.result()
            results.append(r)
            s = r["status"]
            tag = {"downloaded": "OK", "exists": "SKIP", "not_found": "404",
                   "error": "ERR"}.get(s, s)
            extra = f" ({r['size']}B)" if s == "downloaded" else ""
            print(f"[{tag}] {r['id']} {r['name']}{extra}")

    ok = sum(1 for r in results if r["status"] in ("downloaded", "exists"))
    downloaded = sum(1 for r in results if r["status"] == "downloaded")
    missing = sum(1 for r in results if r["status"] == "not_found")
    errors = sum(1 for r in results if r["status"] == "error")
    print()
    print("=" * 40)
    print("RESULTADO")
    print("=" * 40)
    print(f"Total:       {len(results)}")
    print(f"Baixados:    {downloaded}")
    print(f"Já existiam: {ok - downloaded}")
    print(f"Não existem: {missing}")
    print(f"Erros:       {errors}")

    # report of which were not found
    if missing or errors:
        report = out / "missing-report.txt"
        with open(report, "w") as fh:
            for r in results:
                if r["status"] in ("not_found", "error"):
                    fh.write(f"{r['id']}\t{r['name']}\t{r['status']}\n")
        print(f"Missing/error report: {report}")


if __name__ == "__main__":
    main()