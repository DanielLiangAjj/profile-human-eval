#!/usr/bin/env python3
"""Print the invitation links, one per track.

  python3 scripts/invitation_links.py --base https://<account>.github.io/profile-human-eval/ p1 p2

Tracks: p1 = Part 1 (two texts, blinded; every trainee rater gets this same link), p2 = Part 2 (interests; the
authors), all = both. Every evaluator rates all 40 researchers. (Adding -KofN would give an evaluator one of N
equal shares instead; the agreed design does not use it.)

A link is the address of the site plus the part. It carries no secret.
"""
import argparse, re, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tracks", nargs="+")
    ap.add_argument("--base", required=True, help="address of the site, e.g. https://<account>.github.io/profile-human-eval/")
    a = ap.parse_args()
    base = a.base if a.base.endswith("/") else a.base + "/"
    for t in a.tracks:
        m = re.fullmatch(r"(p1|p2|all)(?:-([1-6])of([1-6]))?", t)
        if not m or (m.group(2) and int(m.group(2)) > int(m.group(3))): sys.exit(f"not a track: {t}")
        print(f"{t}\t{base}?t={t}")


if __name__ == "__main__":
    main()
