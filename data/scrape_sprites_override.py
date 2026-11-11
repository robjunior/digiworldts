#!/usr/bin/env python3
"""Download still-missing sprites using name-equivalent overrides.

Reads id->name map + a name->site-name override map. For each digimon still
missing a file, tries the EN name variants then the override, writing the
sprite as skb-{id}.png into the output dir.
"""
import argparse
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

BASE_URL = "https://d-tamer-idle.vercel.app/sprites/"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36"}


def variants(base: str) -> list[str]:
    v = [base]
    if " " in base:
        v.append(base.replace(" ", "-"))
    if "-" in base:
        v.append(base.replace("-", ""))
        v.append(base.replace("-", "_"))
    seen, out = set(), []
    for x in v:
        if x not in seen:
            seen.add(x); out.append(x)
    return out


def try_names(did, names, output):
    for base in names:
        for cand in variants(base):
            url = f"{BASE_URL}{cand}.png"
            try:
                r = requests.get(url, headers=HEADERS, timeout=15)
            except requests.RequestException:
                continue
            if r.status_code == 200 and "image" in r.headers.get("content-type", "").lower():
                (output / f"{did}.png").write_bytes(r.content)
                return {"id": did, "status": "downloaded", "size": len(r.content)}
            if r.status_code != 404:
                continue
    return {"id": did, "status": "not_found"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/sprites-idle")
    ap.add_argument("--map", default="data/digimon-sprites-id-map.json")
    ap.add_argument("--overrides", default="data/digimon-sprite-name-overrides.json")
    ap.add_argument("-w", "--workers", type=int, default=12)
    args = ap.parse_args()

    idmap = json.load(open(args.map))
    overrides = json.load(open(args.overrides))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    todo = [did for did in idmap if not (out / f"{did}.png").exists()]
    print(f"{len(todo)} still missing, trying overrides...")

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {}
        for did in todo:
            en = idmap[did]
            cand = [en]
            jp = overrides.get(en)
            if jp:
                cand.append(jp)
            futs[ex.submit(try_names, did, cand, out)] = did
        for fut in as_completed(futs):
            results.append(fut.result())

    got = sum(1 for r in results if r["status"] == "downloaded")
    missing = sum(1 for r in results if r["status"] == "not_found")
    print(f"downloaded now: {got}   still missing: {missing}")

    def num(x):
        try:
            return int(''.join(ch for ch in x if ch.isdigit()) or 0)
        except ValueError:
            return 0
    report = out / "missing-report.txt"
    with open(report, "w") as fh:
        for did in sorted(idmap, key=num):
            if not (out / f"{did}.png").exists():
                fh.write(f"{did}\t{idmap[did]}\n")
    print(f"updated missing report: {report} ({len(list(open(report)))} lines)")


if __name__ == "__main__":
    main()