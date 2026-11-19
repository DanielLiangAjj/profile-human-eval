#!/usr/bin/env python3
"""Pull the answers of the rating site from Supabase into plain tables (standard library only).

Reads the two tables either through the Supabase REST endpoint with the service-role key (read from
--service-key-file at run time, never printed or written anywhere), or, with no key at all, from the two CSV
files the Supabase table editor exports (Table Editor > pr_evaluators > Export to CSV, same for pr_ratings):

  # who has done what so far
  python3 scripts/pull_ratings.py --evaluators-csv pr_evaluators_rows.csv --ratings-csv pr_ratings_rows.csv --progress

  # write the tables (keep them out of this repository: they hold names and e-mail addresses)
  python3 scripts/pull_ratings.py --evaluators-csv ... --ratings-csv ... \
      --out ~/Dropbox/medschool-navigator-paper/human_eval/private/ratings/2026-12-01 [--drop TESTCODE01]

  python3 scripts/pull_ratings.py --url https://<ref>.supabase.co --service-key-file ~/.profile_rating_service_key --progress

Writes into --out:
  evaluators.csv  rater, code, name, email, track, sign-up / last seen / finish times, answered and expected counts
  compare.csv     Part 1, one row per evaluator and researcher: the eight ratings (a_* for Text A, b_* for Text B),
                  prefer (A / B / none), model_guess (A / B / cannot tell), problem, comment, seconds on screen
  interests.csv   Part 2, one row per evaluator, researcher and interest (k = 1..10): support, opened_all, seconds
  ratings.jsonl   the raw rows; progress.json
Nothing here says which text is the self-written one: that key stays in the paper folder, and
human_eval/analyze_ratings.py there joins it.
"""
import argparse
import csv
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request

SHEETS = ('compare', 'interests')
CRITERIA = ('accurate', 'covers', 'specific', 'useful')
TRACK_RE = re.compile(r'^(p1|p2|all)(?:-([1-6])of([1-6]))?$')
PAGE = 1000


def fail(message):
    sys.exit(f'pull_ratings: {message}')


def read_csv_export(path):
    """Rows of a Supabase table-editor CSV export as dicts; empty cells and 'null' become None."""
    with open(os.path.expanduser(path), encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    return [{k: (None if v in ('', 'null', 'NULL') else v) for k, v in r.items()} for r in rows]


def read_key(path):
    try:
        with open(os.path.expanduser(path), encoding='utf-8') as f:
            key = f.read().strip()
    except OSError as e:
        fail(f'cannot read the service key file ({e.strerror})')
    if not key:
        fail('the service key file is empty')
    return key


class Rest:
    """Minimal PostgREST reader with Range paging."""

    def __init__(self, url, key):
        self.url = url.rstrip('/')
        self.key = key
        self.bearer = True

    def _get(self, path, start):
        headers = {'apikey': self.key, 'Accept': 'application/json', 'Range-Unit': 'items', 'Range': f'{start}-{start + PAGE - 1}'}
        if self.bearer:
            headers['Authorization'] = f'Bearer {self.key}'
        req = urllib.request.Request(self.url + path, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def table(self, name, order):
        rows, start = [], 0
        while True:
            try:
                chunk = self._get(f'/rest/v1/{name}?select=*&order={order}', start)
            except urllib.error.HTTPError as e:
                if e.code == 416:  # asked past the last row
                    break
                if e.code == 401 and self.bearer and not self.key.startswith('eyJ'):
                    self.bearer = False  # newer non-JWT secret keys go in the apikey header only
                    continue
                body = e.read().decode('utf-8', 'replace')[:300].replace(self.key, '***')
                fail(f'reading {name} failed: HTTP {e.code} {body}')
            except urllib.error.URLError as e:
                fail(f'reading {name} failed: {e.reason}')
            if not isinstance(chunk, list):
                fail(f'reading {name} returned something unexpected')
            rows.extend(chunk)
            if len(chunk) < PAGE:
                break
            start += PAGE
        return rows


def clean(text):
    return ' '.join(str(text if text is not None else '').split())


def expected(track, n_people):
    """Researchers per sheet for a track: ranks 0..n-1 are shared out by remainder."""
    m = TRACK_RE.match(track or '')
    if not m:
        return {s: 0 for s in SHEETS}
    k, n = (int(m.group(2)), int(m.group(3))) if m.group(2) else (1, 1)
    share = sum(1 for r in range(n_people) if r % n == k - 1)
    return {'compare': share if m.group(1) in ('p1', 'all') else 0, 'interests': share if m.group(1) in ('p2', 'all') else 0}


def summarise(evaluators, ratings, raters, n_people):
    counts = {}
    for r in ratings:
        if r.get('sheet') in SHEETS:
            counts.setdefault(r['code'], {}).setdefault(r['sheet'], set()).add(r['item_id'])
    people = []
    for e in evaluators:
        want = expected(e.get('track'), n_people)
        answered = {s: len(counts.get(e['code'], {}).get(s, ())) for s in SHEETS}
        people.append({'rater': raters.get(e['code']), 'code': e['code'], 'name': e.get('name'), 'track': e.get('track'),
                       'created_at': e.get('created_at'), 'last_seen': e.get('last_seen'), 'completed_at': e.get('completed_at'),
                       'answered': answered, 'expected': want, 'all_answered': all(answered[s] >= want[s] for s in SHEETS)})
    return {'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'), 'evaluators': people}


def print_progress(summary):
    print(f"{'rater':<6}{'code':<12}{'name':<24}{'track':<10}{'part 1':>10}{'part 2':>10}  status")
    for p in summary['evaluators']:
        cells = ''.join(f"{p['answered'][s]:>6}/{p['expected'][s]:<3}" for s in SHEETS)
        if p['completed_at']:
            status = f"finished {p['completed_at'][:16]}"
        elif p['all_answered']:
            status = 'all answered, finish not recorded'
        else:
            status = f"in progress (last seen {(p['last_seen'] or '-')[:16]})"
        print(f"{str(p['rater'] or '-'):<6}{p['code']:<12}{(p['name'] or '')[:22]:<24}{(p['track'] or '?'):<10}{cells}  {status}")
    if not summary['evaluators']:
        print('(no evaluators yet)')


def main():
    ap = argparse.ArgumentParser(description='Pull the profile ratings from Supabase into plain tables.')
    ap.add_argument('--url', help='Supabase project URL, https://<ref>.supabase.co')
    ap.add_argument('--service-key-file', help='file holding the service-role key (read, never printed)')
    ap.add_argument('--evaluators-csv', help='CSV export of the pr_evaluators table from the Supabase table editor (no key needed)')
    ap.add_argument('--ratings-csv', help='CSV export of the pr_ratings table')
    ap.add_argument('--out', help='output folder; keep it outside this repository')
    ap.add_argument('--only', action='append', default=[], metavar='CODE', help='keep only these evaluators (repeatable)')
    ap.add_argument('--drop', action='append', default=[], metavar='CODE', help='leave these evaluators out, e.g. test codes (repeatable)')
    ap.add_argument('--progress', action='store_true', help='only print counts per evaluator')
    ap.add_argument('--researchers', type=int, default=40, help='number of researchers on the site (default 40)')
    a = ap.parse_args()
    if not a.progress and not a.out:
        ap.error('--out is required unless --progress is given')

    if a.evaluators_csv or a.ratings_csv:
        if not (a.evaluators_csv and a.ratings_csv):
            ap.error('give both --evaluators-csv and --ratings-csv')
        evaluators = read_csv_export(a.evaluators_csv)
        ratings = read_csv_export(a.ratings_csv)
        for r in ratings:
            if isinstance(r.get('answer'), str):
                r['answer'] = json.loads(r['answer'])
            elif not r.get('answer'):
                r['answer'] = {}
            for k in ('id', 'elapsed_ms'):
                if r.get(k) not in (None, ''):
                    r[k] = int(float(r[k]))
    else:
        if not (a.url and a.service_key_file):
            ap.error('give --url and --service-key-file, or the two CSV exports')
        rest = Rest(a.url, read_key(a.service_key_file))
        evaluators = rest.table('pr_evaluators', 'created_at.asc')
        ratings = rest.table('pr_ratings', 'id.asc')
    only, drop = {c.strip().upper() for c in a.only}, {c.strip().upper() for c in a.drop}
    for c in (only | drop) - {e['code'] for e in evaluators}:
        print(f'warning: code {c} is not in the evaluators table', file=sys.stderr)
    evaluators = [e for e in evaluators if (not only or e['code'] in only) and e['code'] not in drop]
    evaluators.sort(key=lambda e: (e.get('created_at') or '', e['code']))
    keep = {e['code'] for e in evaluators}
    ratings = sorted((r for r in ratings if r['code'] in keep), key=lambda r: r.get('id') or 0)
    raters = {e['code']: i + 1 for i, e in enumerate(evaluators)}
    summary = summarise(evaluators, ratings, raters, a.researchers)
    print_progress(summary)
    if a.progress:
        return

    out = os.path.expanduser(a.out)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'evaluators.csv'), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['rater', 'code', 'name', 'email', 'track', 'created_at', 'last_seen', 'completed_at',
                    'compare_answered', 'compare_expected', 'interests_answered', 'interests_expected'])
        for e, p in zip(evaluators, summary['evaluators']):
            w.writerow([raters[e['code']]] + [e.get(c) or '' for c in ('code', 'name', 'email', 'track', 'created_at', 'last_seen', 'completed_at')]
                       + [p['answered']['compare'], p['expected']['compare'], p['answered']['interests'], p['expected']['interests']])
    with open(os.path.join(out, 'ratings.jsonl'), 'w', encoding='utf-8') as f:
        for r in ratings:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')

    seconds = lambda r: '' if r.get('elapsed_ms') in (None, '') else round(int(r['elapsed_ms']) / 1000, 1)
    n_cmp = n_int = 0
    with open(os.path.join(out, 'compare.csv'), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['rater', 'code', 'item', 'item_id'] + [f'{s}_{c}' for s in ('a', 'b') for c in CRITERIA]
                   + ['prefer', 'model_guess', 'problem', 'comment', 'seconds', 'client_ts'])
        for r in ratings:
            if r['sheet'] != 'compare':
                continue
            ans = r['answer'] or {}
            w.writerow([raters[r['code']], r['code'], int(r['item_id'][1:]), r['item_id']]
                       + [(ans.get(s) or {}).get(c) if (ans.get(s) or {}).get(c) is not None else '' for s in ('a', 'b') for c in CRITERIA]
                       + [ans.get('prefer') or '', ans.get('model_guess') or '', int(bool(ans.get('problem'))), clean(ans.get('comment')), seconds(r), r.get('client_ts') or ''])
            n_cmp += 1
    with open(os.path.join(out, 'interests.csv'), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['rater', 'code', 'item', 'item_id', 'k', 'support', 'opened_all', 'comment', 'seconds', 'client_ts'])
        for r in ratings:
            if r['sheet'] != 'interests':
                continue
            ans = r['answer'] or {}
            for k, label in enumerate(ans.get('support') or [], 1):
                w.writerow([raters[r['code']], r['code'], int(r['item_id'][1:]), r['item_id'], k, label or '', int(bool(ans.get('opened_all'))),
                            clean(ans.get('comment')) if k == 1 else '', seconds(r), r.get('client_ts') or ''])
            n_int += 1
    with open(os.path.join(out, 'progress.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=1)
    print(f'wrote {out}: {len(evaluators)} evaluators, {n_cmp} Part 1 answers, {n_int} Part 2 answers ({n_int * 10} interests)')


if __name__ == '__main__':
    main()
