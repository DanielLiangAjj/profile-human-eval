# Supabase setup (once, about ten minutes)

The rating site saves every answer to a free Supabase project (a hosted Postgres database). Until the
two values in `config.js` are filled in, the site runs in local-only mode: everything works, but answers
stay in each evaluator's browser and a yellow banner says so.

## Decision and check, 18 Nov 2026

The site uses the project that already serves the outcome taxonomy rating site and the evidence base
rating site (`xfpuahqpfndjgzgcgzic`, free plan, production branch). `config.js` already holds its URL
and anon key, and the schema was run there on 19 Nov 2026, so the steps below are kept only as a record
(and for a move to another project).

What the project held on 18 Nov 2026 (read from the dashboard, nothing changed there): the tables
`evaluators`, `ratings`, `leb_evaluators`, `leb_ratings` with their primary keys and unique indexes;
the functions `register_evaluator`, `save_rating`, `get_progress`, `finish_evaluation` and the same four
with the prefix `leb_`; Supabase's own function `rls_auto_enable` with the event trigger `ensure_rls`,
which switches on row-level security for every new table in `public` (this schema does the same itself);
no data triggers, no enumerated types, no policies. Nothing there has a name that starts with `pr_`.

The schema was also run, twice, on a throwaway local database that held the other two sites' schemas,
a copy of that event trigger and rows written through the sites' functions. Of the 9 functions and 12
tables, sequences and indexes that existed before, none changed (same body, same permissions, same row
level security); the full dump lost no line; the other two sites' functions still worked as the public
role; the public role could read none of the six tables. The only statement that reaches beyond the
`pr_` names is the last line, `notify pgrst, 'reload schema'`, which asks the API layer to re-read the
list of functions; the other two sites' schemas end with the same line.

## The five steps

1. **Choose the project.** Either create a new one (go to <https://supabase.com>, sign in with GitHub,
   new project on the free plan, any name; keep the database password somewhere safe, the site never
   needs it), or use the project that already serves the outcome taxonomy rating site. Sharing is safe:
   every table and function here starts with `pr_`, and the schema was tested next to the taxonomy
   schema in one database. A free account holds two active projects.
2. **Open the SQL editor.** In the project dashboard, choose *SQL Editor* and start a new query.
3. **Paste and run the schema.** Paste the whole of `supabase/schema.sql` and press *Run*. It creates
   the two tables (`pr_evaluators`, `pr_ratings`), switches on row-level security with no policies, and
   adds the four functions the site calls (`pr_register_evaluator`, `pr_save_rating`,
   `pr_get_progress`, `pr_finish_evaluation`). It should finish with "Success. No rows returned".
4. **Copy the URL and the anon key into `config.js`.** In *Settings > API* copy the *Project URL*
   (`https://<project-ref>.supabase.co`) and the *anon public* key, and paste them into
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js`. (Newer dashboards split this page: the URL is
   under *Settings > Data API*, the key under *Settings > API Keys*; use the `anon` `public` key from the
   legacy tab, or the publishable key.)
5. **Commit and push.** `git add config.js && git commit -m "Connect the rating site to Supabase" && git push`.
   GitHub Pages redeploys within a minute or two; the yellow banner disappears and the dot in the
   header turns green after the first saved answer.

## Is it safe to publish the anon key?

(The access phrase of the items is a different thing and is never published; see the main README.)

Yes. The anon key is designed to be public: it is shipped to every visitor's browser anyway, and it
only identifies the project. What it can do is decided by the database. Here row-level security is on
for both tables with no policies, and the table privileges are revoked from `anon`, so the key cannot
read or write any row directly. The four `security definer` functions in `schema.sql` are the only
door: they accept one evaluator's code, check every input (code format, track, sheet name, item id,
answer size, name and email length), and `pr_get_progress` returns only the rows of the code it is given.
A code is 10 random characters (about 50 bits), so codes cannot be guessed.

Never put the **service role** key (or a secret key) in this repository. It bypasses row-level
security. Keep it in a file outside the repository (for example `chmod 600 ~/.profile_rating_service_key`) and
pass that path to `scripts/pull_ratings.py --service-key-file`.

## Checking that it works

- Open the site with an invitation link, start as a test evaluator, rate one researcher, and look at
  *Table Editor > pr_ratings* in the dashboard: the row should be there. Delete test rows afterwards
  (`delete from pr_ratings where code = '...'; delete from pr_evaluators where code = '...';` in the SQL
  editor), or leave them and pass `--drop <code>` to `scripts/pull_ratings.py`.
- `python3 scripts/pull_ratings.py --evaluators-csv pr_evaluators_rows.csv --ratings-csv pr_ratings_rows.csv --progress`
  (the two CSV exports of the table editor) prints each evaluator's counts per part. The table editor
  shows 100 rows per page in insertion order; filter by `code` to see one evaluator.

## Good to know

- Free projects are paused after about a week without any requests. If the dot in the header stays on
  "Offline", open the dashboard and restore the project; answers waiting in the evaluators' browsers
  are sent automatically once it is back.
- The answer formats are listed in the main `README.md`. Every row also carries `elapsed_ms` (time on
  screen before Next), `client_ts` (the browser's clock) and `app_version`.
