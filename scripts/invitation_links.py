#!/usr/bin/env python3
"""Print the invitation links, one per track. Each link carries the access phrase after '#', so treat the output
like the phrase itself: send a link only to the evaluator it is for, and do not paste it anywhere public.

  python3 scripts/invitation_links.py --base https://<account>.github.io/profile-human-eval/ p1 p2

Tracks: p1 = Part 1 (two texts, blinded; every trainee rater gets this same link), p2 = Part 2 (interests; the
authors), all = both. Every evaluator rates all 40 researchers. (Adding -KofN would give an evaluator one of N
equal shares instead; the agreed design does not use it.)
"""
import argparse, os, re, sys, urllib.parse


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tracks", nargs="+")
    ap.add_argument("--base", required=True, help="address of the site, e.g. https://<account>.github.io/profile-human-eval/")
    ap.add_argument("--phrase-file", default="~/Dropbox/medschool-navigator-paper/human_eval/private/site_access_phrase.txt")
    a = ap.parse_args()
    phrase = "".join(open(os.path.expanduser(a.phrase_file), encoding="utf-8").read().split())
    base = a.base if a.base.endswith("/") else a.base + "/"
    for t in a.tracks:
        m = re.fullmatch(r"(p1|p2|all)(?:-([1-6])of([1-6]))?", t)
        if not m or (m.group(2) and int(m.group(2)) > int(m.group(3))): sys.exit(f"not a track: {t}")
        print(f"{t}\t{base}?t={t}#k={urllib.parse.quote(phrase, safe='')}")


if __name__ == "__main__":
    main()
