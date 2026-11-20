# Research profiles, human rating site

A static site (GitHub Pages) where invited evaluators rate short research profiles of 40 medical school
faculty against each person's recent papers. Every evaluator rates the same 40 researchers. It is the rating instrument of the profile study
(`medschool-navigator-paper`, Evaluation 3) and is built like the outcome taxonomy rating site: one
personal code per evaluator, every answer saved on Next, resume on any device, results pulled into
tables by a script.

- **Part 1, blinded.** Per researcher: the 15 most recent papers, and two texts in random order (the
  text the researcher wrote for the school's page, and the overview a language model wrote from the
  publication record). Each text gets four ratings from 1 to 5 (accurate, covers the main work,
  specific to this person, useful); then the preferred text and a guess at which one the model wrote.
- **Part 2, not blinded.** Per researcher: the ten research interests the model listed, each marked
  supported, partly supported, not supported or cannot judge. The paper list can be opened to all the
  papers the model saw (up to 50).

The site never shows which text is the self-written one; that key is not in this repository.

## Why the items are encrypted, and how they open

The items hold names, texts and paper titles of real people, and generated profiles that have not been
released. This repository is public (GitHub Pages needs that on a free account), so it carries only
`data/items.enc.json`: the items compressed and encrypted (AES-256-GCM, key derived from an access
phrase with PBKDF2-SHA256). The phrase is kept in the paper folder
(`human_eval/private/site_access_phrase.txt`), never in this repository.

An evaluator never sees or types the phrase: **the personal code is enough** (decided 20 Nov 2026).
The database keeps the phrase in a table that visitors cannot read (`pr_access`) and gives it to any
code it knows (`supabase/access.sql`). So the items open when a person signs up with name and email, or
enters their code under "Resume with a code"; the browser then remembers the key.

- What this keeps: the texts cannot be read in the repository or found by a search engine, and everyone
  who opens them has left a name, an e-mail address and a time in `pr_evaluators`.
- What it does not keep: sign-up is open, so anyone who signs up can read the texts of the 40
  researchers.
- To close the profiles again, for example when the rating is over, delete the key from the database
  (one line, given at the top of `supabase/access.sql`).

Setting it up, once: `python3 scripts/make_access_sql.py` writes `human_eval/private/access_setup.sql`
in the paper folder (the content of `supabase/access.sql` plus one statement that stores the phrase).
Paste that file into the Supabase SQL editor and press Run. Until that has been done, and whenever the
key is deleted again, the site asks for the phrase instead: the Start and Resume forms get one more
field, "Access phrase", and a link that carries the phrase after `#k=` fills it in
(`scripts/invitation_links.py --with-phrase`; the part of an address after `#` is not sent to any
server). The site finds out by itself which of the two is the case (it asks `pr_access_ready`).

The start page is the same however the site is opened: what the study is, how to judge, the parts with
their times, **Start** (name and email) and **Resume with a code**. It is drawn from
`data/outline.json` (part titles, numbers and the general instructions; nothing about any person), so
no researcher is shown before the items are open.

## The researchers and the invitation links

The site carries 40 researchers: a fixed third of the 120 drawn for the rating kit, taken so that every
school keeps its proportion (11 schools, at most 7 researchers from one school). Every evaluator rates
all 40, so each profile is judged by every rater and agreement can be measured over the whole set. The
size was chosen to keep one evaluator's work under two hours (decided 17 Nov 2026).

An evaluator's link says which part is theirs (the "track"). The track is stored with the evaluator at
sign-up and cannot change afterwards.

```
python3 scripts/invitation_links.py --base https://<account>.github.io/profile-human-eval/ p1 p2
```

| Track | Meaning |
|---|---|
| `p1` | Part 1 (two texts, blinded), all 40 researchers. For the trainee raters: they all get this same link. |
| `p2` | Part 2 (interests, not blinded), all 40 researchers. For the two authors. |
| `all` | both parts, Part 1 first. Also what a new evaluator gets who signs up without a part in the address. |
| `p1-1of2`, `p2-2of3`, ... | one of N equal, school-balanced shares of the 40 (up to 6). Not used in the agreed design. |

The links carry no secret: they are the site's address plus the part. (With `--with-phrase` they also
carry the access phrase after `#`, for a database where `supabase/access.sql` has not been run; such
links go only to the evaluators.)

Each evaluator sees the researchers in an order seeded by their own code. Once an evaluator has begun
Part 2, Part 1 can no longer be changed (Back stays inside a part), so the unblinded part cannot
influence the blinded one.

## How long it takes

Reading is most of the work. Per researcher, Part 1 has about 470 words to read (median: about 200
words of titles, 157 and 124 words of text) and ten decisions; Part 2 about 320 words and ten decisions.

| | per researcher | all 40 researchers |
|---|---|---|
| Part 1 | about 2 min 45 s | about 1 h 50 min (1 h 45 min to 2 h at 250 to 200 words a minute) |
| Part 2 | about 2 min | about 1 h 20 min (1 h 15 min to 1 h 30 min) |

With four trainee raters on Part 1 and two authors on Part 2 that is about 10 person-hours. The welcome
screen shows the figure for the evaluator's own part, and the work can be spread over any number of
sittings. The time actually spent on each screen is saved with every answer (`elapsed_ms`), so the real
figure can be reported.

## Run it locally

```
cd profile-human-eval
python3 -m http.server 8000
python3 scripts/invitation_links.py --with-phrase --base http://localhost:8000/ p1   # prints the link to open
```

On this computer the site runs in **local-only mode**: `config.local.js` (git-ignored, never published)
holds empty values, and a value in that file wins over `config.js`, also when it is empty. There is no
database to give out the key, which is why the local link carries the phrase. Everything
works, answers stay in the browser's localStorage, a yellow banner says so, and the finish screen insists
on downloading the answers as JSON; nothing is written to the shared database. Delete `config.local.js`
to test the local copy against the real database. To start over as a tester, clear the site's storage in
the browser (all keys start with `profrate:`).

## Put it online

1. **Database.** Paste `supabase/schema.sql` into the SQL editor of the Supabase project and run it
   (`supabase/README.md`). Decided 18 Nov 2026: the project that already serves the taxonomy rating
   site and the evidence base rating site (`xfpuahqpfndjgzgcgzic`). Every name here starts with `pr_`;
   the check of 18 Nov is in `supabase/README.md`. Run on 19 Nov 2026 (the four functions answer; the
   two tables are closed to the public key).
2. **Settings.** Done 18 Nov 2026: `config.js` holds that project's URL and anon (publishable) key.
3. **Publish.** Done 19 Nov 2026: repository `DanielLiangAjj/profile-human-eval`, Pages on the main branch (root).
   The site is at <https://danielliangajj.github.io/profile-human-eval/>.
4. **Let the code open the profiles.** Paste `human_eval/private/access_setup.sql` (paper folder) into
   the SQL editor and run it; it should end with one row saying `true` (see "Why the items are
   encrypted, and how they open"). Until then the site asks for the access phrase.
5. **Invite.** Print the links (above) and send them.

Before step 5, open one link yourself, rate two researchers, check the rows in the `pr_ratings` table,
and delete the test rows (or leave them and pass `--drop <code>` when pulling).

## Rebuild the items

```
python3 scripts/export_items.py            # needs the paper folder; uses Anaconda's cryptography and openpyxl
```

The script rebuilds every item from the source files, checks all 120 of the kit cell by cell against
the kit's sheet (`human_eval/rating_sheet.xlsx`), keeps the 40 (`--share 1of3`, the default), lists
them in `human_eval/private/rating_set.csv`, reads the wording raters see from
`human_eval/rating_guide.md`, and refuses to write if anything differs or if the items would say which
text is which. Run it again after any change to the guide. Do not rebuild once evaluators have started.
It also writes `data/outline.json`; `--outline-only` writes just that file from the published items.

## Pull the results

```
# who has done what so far (CSV exports from the Supabase table editor: pr_evaluators, pr_ratings)
python3 scripts/pull_ratings.py --evaluators-csv pr_evaluators_rows.csv --ratings-csv pr_ratings_rows.csv --progress

# the tables, written into the paper folder (they hold names and e-mail addresses; never into this repository)
python3 scripts/pull_ratings.py --evaluators-csv ... --ratings-csv ... \
    --out ~/Dropbox/medschool-navigator-paper/human_eval/private/ratings/<date> [--drop <test code>]

# the analysis of the protocol (in the paper folder; it joins the key)
python ~/Dropbox/medschool-navigator-paper/human_eval/analyze_ratings.py --ratings <that folder>
```

With a service-role key in a file outside the repository, `--url https://<ref>.supabase.co
--service-key-file <file>` reads the tables directly instead of the CSV exports; the key is never
printed or written.

## Answer formats

Every answer is stored per evaluator, sheet and researcher (`pr_ratings.answer`, jsonb), with
`elapsed_ms` (time on screen before Next, summed over visits), `client_ts` (browser time) and
`app_version` (`APP_VERSION` in `assets/state.js`; bump it when a format changes). When the same item
is saved twice, the copy with the later `client_ts` wins, on the server and when merging on resume.

| Sheet | `answer` | Valid when |
|---|---|---|
| `compare` | `{"a": {"accurate": 1-5, "covers": 1-5, "specific": 1-5, "useful": 1-5}, "b": {...}, "prefer": "A" \| "B" \| "none", "model_guess": "A" \| "B" \| "cannot tell", "comment": "...", "problem": false}` | all eight ratings, the preference and the guess are given; or `problem` is true with a comment of 3+ characters (a text is cut off, unreadable or not about research; ratings may then be null) |
| `interests` | `{"support": ["supported" \| "partly supported" \| "not supported" \| "cannot judge", x10], "comment": "...", "opened_all": false}` | all ten are answered; `opened_all` records that the evaluator opened the full paper list |

Item ids are the item numbers of the kit (`R001` to `R120`); 40 of them are on the site.

## Files

```
index.html, 404.html, config.js        page shell, deep-link redirect, Supabase settings (public)
assets/app.js                          entry: settings, how the items open, first screen
assets/views.js                        screens and flow (welcome with start and resume, intro, item, pause, finish)
assets/controls.js                     scales and buttons, validity and answer JSON per sheet
assets/panels.js                       the paper list and the two text cards
assets/crypto.js                       opens data/items.enc.json with its key (the access phrase)
assets/state.js, storage.js,           tracks, session and item order, localStorage, save queue with
  sync.js, api.js, prng.js,            retries, Supabase RPC calls, seeded shuffle, guide markdown
  markdown.js, dom.js
assets/style.css
data/items.enc.json                    the items, encrypted (generated)
data/outline.json                      part titles, numbers and general instructions, readable (generated)
supabase/schema.sql, supabase/README.md
supabase/access.sql                    lets a personal code open the items (the key itself is not in it)
scripts/export_items.py, scripts/invitation_links.py, scripts/pull_ratings.py
scripts/make_access_sql.py             writes the private file that stores the key in the database
```
