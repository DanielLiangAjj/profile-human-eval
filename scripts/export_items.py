#!/usr/bin/env python3
"""Build data/items.json for the rating site from the blinded rating kit of the paper project.

The kit (human_eval/rating_sheet.xlsx + human_eval/private/rating_key.csv in the paper folder) holds 120 drawn
researchers and fixes which text is shown as A and which as B. The site carries a fixed share of them: by default
one of three school-balanced thirds, 40 researchers, and every evaluator rates all 40 (decided 17 Nov 2026: one
common set, and no more than about two hours per evaluator). This script rebuilds every item from the source
files, checks all 120 cell by cell against the kit's sheet, keeps the share, and writes the items as one
readable JSON file, as the outcome taxonomy rating site does (decided 20 Nov 2026; until then the file was
published encrypted).

  python3 scripts/export_items.py [--paper ~/Dropbox/medschool-navigator-paper] [--tag gpt-6.1-sol] [--share 1of3]

The researchers on the site are listed in <paper>/human_eval/private/rating_set.csv (item number, id, school).

What the items hold: per researcher the name, school and up to 50 papers (title, journal, year; Part 1 shows the
first 15, Part 2 can open all, because the model saw up to 50); for Part 1 the two texts as "a" and "b" with NO
mark of which is the self-written one; for Part 2 the ten generated interests; the instructions from
human_eval/rating_guide.md; and a rank per researcher, which could share them out over smaller item sets
(track "p1-1of2" = researchers whose rank is even, and so on), each school in proportion. With the common set
every evaluator gets the plain tracks: p1 (Part 1) or p2 (Part 2).

The file is public, so the script refuses to write anything that would say which text is the self-written one.
That key (human_eval/private/rating_key.csv) stays in the paper folder.

Needs the package openpyxl (in the Anaconda base environment).
"""
import argparse, collections, csv, datetime, json, os, random, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
RANK_SEED = 20261117
PAPERS_KEPT, PAPERS_IN_KIT = 50, 15


def fail(msg):
    sys.exit(f"export_items: {msg}")


def guide_sections(path):
    text = re.sub(r"<!--.*?-->", "", open(path, encoding="utf-8").read(), flags=re.S)
    out, name = collections.OrderedDict(), None
    for line in text.splitlines():
        m = re.match(r"^##\s+(\S+)\s*$", line)
        if m: name = m.group(1); out[name] = []; continue
        if name: out[name].append(line)
    return {k: "\n".join(v).strip() for k, v in out.items()}


def norm(s):
    """Comparison form: Excel drops control characters and normalises line ends."""
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(s or ""))).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--paper", default="~/Dropbox/medschool-navigator-paper")
    ap.add_argument("--tag", default="gpt-6.1-sol")
    ap.add_argument("--out", default=os.path.join(SITE, "data", "items.json"))
    ap.add_argument("--share", default="1of3", help="which school-balanced share of the kit's researchers goes on the site, KofN "
                    "(default 1of3 = 40 of 120; 1of1 = all)")
    a = ap.parse_args()
    paper = os.path.realpath(os.path.expanduser(a.paper))
    kit = os.path.join(paper, "human_eval")
    base = os.path.expanduser(f"~/.cache/medschool-navigator/metrics_input/{a.tag}")

    key = list(csv.DictReader(open(os.path.join(kit, "private", "rating_key.csv"), encoding="utf-8")))
    mach = {}
    for l in open(os.path.join(base, "machine_profiles.jsonl"), encoding="utf-8"):
        r = json.loads(l); mach[r["id"]] = r
    want = {k["id"] for k in key}
    human = {}
    for l in open(os.path.join(paper, "..", "medschool-faculty-crawler", "output", "all_profiles.jsonl"), encoding="utf-8"):
        r = json.loads(l)
        if r["id"] in want: human[r["id"]] = " ".join((r.get("self_text") or "").split())
    missing = (want - set(human)) | (want - set(mach))
    if missing: fail(f"{len(missing)} researchers of the key are missing from the source files")

    # the kit's sheet, to check every item against
    from openpyxl import load_workbook
    wb = load_workbook(os.path.join(kit, "rating_sheet.xlsx"), read_only=True)
    sheet1 = {int(r[0]): r for r in wb["Part 1 - two texts"].iter_rows(min_row=2, values_only=True) if r[0] is not None}
    sheet2 = collections.defaultdict(list)
    for r in wb["Part 2 - interests"].iter_rows(min_row=2, values_only=True):
        if r[0] is not None: sheet2[int(r[0])].append(r[3])

    people, compare, interests, by_school = {}, [], [], collections.defaultdict(list)
    for k in key:
        n, cid = int(k["item"]), k["id"]; rid = f"R{n:03d}"; m = mach[cid]
        papers = json.load(open(os.path.join(base, "pubmed", f"{cid}.json"), encoding="utf-8"))
        ref = "\n".join(f"{i}. {p['Title']} ({p['Journal']}, {p['PubDate']})" for i, p in enumerate(papers[:PAPERS_IN_KIT], 1))
        a_is_human = k["self_written_is"] == "A"
        ta, tb = (human[cid], m["mesh_overview"]) if a_is_human else (m["mesh_overview"], human[cid])
        row = sheet1.get(n)
        if row is None: fail(f"item {n} is not in the kit's sheet")
        for what, mine, theirs in (("researcher", f"{m['name']} ({k['school']})", row[1]), ("papers", ref, row[2]), ("text A", ta, row[3]), ("text B", tb, row[4])):
            if norm(mine) != norm(theirs): fail(f"item {n}: {what} differs from the kit's sheet; rebuild the kit or the metrics input first")
        if [norm(x) for x in m["mesh_interests"]] != [norm(x) for x in sheet2[n]]: fail(f"item {n}: interests differ from the kit's sheet")
        people[rid] = {"name": m["name"], "school": k["school"], "n_papers": len(papers),
                       "papers": [{"t": " ".join(str(p["Title"]).split()), "j": str(p["Journal"] or ""), "y": str(p["PubDate"] or "")[:4]} for p in papers[:PAPERS_KEPT]]}
        compare.append({"id": rid, "a": ta, "b": tb})
        interests.append({"id": rid, "interests": [" ".join(str(x).split()) for x in m["mesh_interests"]]})
        by_school[k["school"]].append(rid)

    # ranks: schools one after another (largest first), researchers in random order inside a school, so that
    # "rank mod n" gives n sets with every school in proportion
    rnd = random.Random(RANK_SEED); rank = {}
    for school in sorted(by_school, key=lambda s: (-len(by_school[s]), s)):
        ids = sorted(by_school[school]); rnd.shuffle(ids)
        for rid in ids: rank[rid] = len(rank)
    # the share that goes on the site: every N-th researcher of that order, so each school keeps its proportion
    m = re.fullmatch(r"([1-9])of([1-9])", a.share)
    if not m or int(m.group(1)) > int(m.group(2)): fail("--share must look like 1of3")
    share_k, share_n = int(m.group(1)), int(m.group(2))
    kept = sorted((rid for rid in rank if rank[rid] % share_n == share_k - 1), key=rank.get)
    n_kit = len(rank); rank = {rid: i for i, rid in enumerate(kept)}
    compare = [it for it in compare if it["id"] in rank]; interests = [it for it in interests if it["id"] in rank]
    people = {rid: people[rid] for rid in kept}
    for it in compare + interests: it["rank"] = rank[it["id"]]
    key_by_rid = {f"R{int(k['item']):03d}": k for k in key}
    with open(os.path.join(kit, "private", "rating_set.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["item", "id", "school", "rank_on_site"])
        for rid in sorted(kept): w.writerow([int(rid[1:]), key_by_rid[rid]["id"], key_by_rid[rid]["school"], rank[rid]])

    g = guide_sections(os.path.join(kit, "rating_guide.md"))
    for need in ("common", "compare", "interests", "criteria", "purpose_short_compare", "purpose_short_interests"):
        if not g.get(need): fail(f"rating_guide.md has no section '{need}'")
    criteria = []
    for line in g["criteria"].splitlines():
        if line.strip().startswith("- "):
            cid, label, helptext = [x.strip() for x in line.strip()[2:].split("|")]
            criteria.append({"id": cid, "label": label, "help": helptext})
    if [c["id"] for c in criteria] != ["accurate", "covers", "specific", "useful"]:
        fail("the criteria ids must stay accurate, covers, specific, useful (the answer format and the analysis use them)")

    data = {"version": datetime.date.today().isoformat(), "generator_tag": a.tag, "sample": {"drawn": n_kit, "on_site": len(kept), "share": a.share},
            "common_instructions": g["common"], "people": people,
            "sheets": [{"id": "compare", "title": "Part 1: two texts", "short": g["purpose_short_compare"], "instructions": g["compare"], "criteria": criteria, "items": compare},
                       {"id": "interests", "title": "Part 2: research interests", "short": g["purpose_short_interests"], "instructions": g["interests"], "items": interests}]}
    plain = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    # nothing in the items may say which text is the self-written one
    for bad in ("self_written", "a_is_human", "profile_url", "generated_words"):
        if bad.encode() in plain: fail(f"the items contain '{bad}'")

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "wb") as f: f.write(plain + b"\n")
    assert json.load(open(a.out, encoding="utf-8")) == data
    per_school = collections.Counter(p["school"] for p in people.values())
    as_a = sum(key_by_rid[rid]["self_written_is"] == "A" for rid in kept)
    import statistics
    med = lambda v: round(statistics.median(v))
    print(f"checked against the kit's sheet: {n_kit} text pairs, {n_kit * 10} interests; on the site (share {a.share}): {len(people)} researchers at {len(per_school)} schools, "
          f"at most {max(per_school.values())} per school")
    print(f"self-written text shown as A for {as_a} of {len(kept)}; median words self-written {med([int(key_by_rid[r]['self_written_words']) for r in kept])}, "
          f"generated {med([int(key_by_rid[r]['generated_words']) for r in kept])}; papers kept per person: median {med([len(p['papers']) for p in people.values()])}, "
          f"{sum(1 for p in people.values() if p['n_papers'] > PAPERS_IN_KIT)} have more than {PAPERS_IN_KIT}")
    print(f"{os.path.getsize(a.out):,} bytes -> {os.path.relpath(a.out, SITE)}; list of the researchers -> human_eval/private/rating_set.csv")


if __name__ == "__main__":
    main()
