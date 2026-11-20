#!/usr/bin/env python3
"""Write the private file that makes a personal code enough to open the profiles (no access phrase for evaluators).

The output is supabase/access.sql plus one statement that stores the access phrase in the database. Paste it into
the Supabase SQL editor and press Run, once. It holds the phrase, so it is written outside this repository and its
contents are never printed.

  python3 scripts/make_access_sql.py

Before writing, the script checks that the phrase really opens data/items.enc.json, so a wrong key is never stored.
Needs the package cryptography (in the Anaconda base environment).
"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_items import open_box  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRIVATE = "~/Dropbox/medschool-navigator-paper/human_eval/private"
TAG = "$pr_key$"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--phrase-file", default=f"{PRIVATE}/site_access_phrase.txt")
    ap.add_argument("--out", default=f"{PRIVATE}/access_setup.sql")
    a = ap.parse_args()
    out = os.path.realpath(os.path.expanduser(a.out))
    if os.path.commonpath([out, os.path.realpath(REPO)]) == os.path.realpath(REPO):
        sys.exit("The output holds the access phrase and must not be written inside the site's repository.")
    phrase = "".join(open(os.path.expanduser(a.phrase_file), encoding="utf-8").read().split())
    if not phrase or TAG in phrase:
        sys.exit("The access phrase is empty or cannot be written into the file.")
    try:
        data = open_box(os.path.join(REPO, "data", "items.enc.json"), phrase)
    except Exception:
        sys.exit("This phrase does not open data/items.enc.json. Nothing was written.")
    ddl = open(os.path.join(REPO, "supabase", "access.sql"), encoding="utf-8").read().rstrip("\n")
    notify = "notify pgrst, 'reload schema';"
    if not ddl.endswith(notify):
        sys.exit("supabase/access.sql does not end with the schema reload line; check the file.")
    body = ddl[: -len(notify)].rstrip("\n")
    comment = "-- Ask the API layer to pick up the new functions straight away."
    if body.endswith(comment):
        body = body[: -len(comment)].rstrip("\n")
    text = (
        "-- PRIVATE: this file holds the access phrase of the profile rating site. Do not share or commit it.\n"
        "-- Paste the whole file into the Supabase SQL editor and press Run, once.\n\n"
        f"{body}\n\n"
        "-- The key of the items (the access phrase): kept in a table that visitors cannot read.\n"
        "insert into public.pr_access (name, value)\n"
        f"values ('items_phrase', {TAG}{phrase}{TAG})\n"
        "on conflict (name) do update set value = excluded.value, updated_at = now();\n\n"
        "-- Ask the API layer to pick up the new functions straight away.\n"
        f"{notify}\n\n"
        "-- What to expect below after Run: one row saying true.\n"
        "select public.pr_access_ready() as code_opens_the_profiles;\n"
    )
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(out, 0o600)
    people = len(data.get("people", {}))
    print(f"Wrote {out} ({len(text.splitlines())} lines; the phrase opens the items: {people} researchers).")
    print("Paste its contents into the Supabase SQL editor and press Run. On a Mac:  pbcopy < that file")


if __name__ == "__main__":
    main()
