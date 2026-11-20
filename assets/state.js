// Item data and the evaluator's session: which items are theirs (the track), per-sheet item orders,
// answers and progress.

import { seededShuffle } from './prng.js';

/** Stored with every answer; bump it whenever an answer format changes. */
export const APP_VERSION = '1.0';

export const SHEET_ORDER = ['compare', 'interests'];
/** Planning figures: reading the papers and the texts takes most of the time (see README, "How long it takes"). */
export const SECONDS_PER_ITEM = { compare: 165, interests: 120 };
/** Papers shown in the reference list before "Show all". */
export const PAPERS_SHOWN = 15;

/** Fetch the items; attaches each item's person (name, school, papers). */
export async function loadItems() {
  const res = await fetch('data/items.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`data/items.json: HTTP ${res.status}`);
  const data = await res.json();
  const byId = new Map(data.sheets.map((s) => [s.id, s]));
  data.sheets = SHEET_ORDER.map((id) => byId.get(id)).filter(Boolean);
  for (const sheet of data.sheets) {
    for (const it of sheet.items) it.person = data.people[it.id];
  }
  return data;
}

// ---- tracks ---------------------------------------------------------------------------------
// A track says which part and which share of the researchers an evaluator rates. It comes with the
// invitation link (?t=...), is stored with the evaluator at sign-up, and never changes afterwards.
//   p1, p2, all            Part 1 only, Part 2 only, or both (Part 1 first), every researcher
//                          (a new evaluator who opens the site without ?t= gets "all")
//   p1-1of2, p2-3of4, ...  the same, for researchers whose rank leaves remainder k-1 when divided by n
// Ranks are written by scripts/export_items.py so that every share holds each school in proportion.

const TRACK_RE = /^(p1|p2|all)(?:-([1-6])of([1-6]))?$/;

export function parseTrack(text) {
  const m = TRACK_RE.exec(String(text || '').trim().toLowerCase());
  if (!m) return null;
  const k = m[2] ? Number(m[2]) : 1;
  const n = m[3] ? Number(m[3]) : 1;
  if (k > n) return null;
  return { part: m[1], k, n, text: n === 1 ? m[1] : `${m[1]}-${k}of${n}` };
}

/** The sheets of a track, each with only the items of that track. */
export function sheetsForTrack(data, track) {
  const ids = track.part === 'p1' ? ['compare'] : track.part === 'p2' ? ['interests'] : SHEET_ORDER;
  return data.sheets.filter((s) => ids.includes(s.id)).map((s) => ({
    ...s,
    items: s.items.filter((it) => it.rank % track.n === track.k - 1),
  }));
}

/** "Part 1" / "Part 1 and Part 2", plus "set 2 of 3" when the researchers are shared out. */
export function describeTrack(track) {
  const part = track.part === 'p1' ? 'Part 1' : track.part === 'p2' ? 'Part 2' : 'Part 1 and Part 2';
  return track.n === 1 ? part : `${part}, set ${track.k} of ${track.n}`;
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class Session {
  constructor(data, code, who, answers) {
    this.data = data;
    this.code = code;
    this.name = who.name;
    this.email = who.email;
    this.track = parseTrack(who.track);
    if (!this.track) throw new Error('This code has no item set.');
    this.sheets = sheetsForTrack(data, this.track);
    this.answers = answers; // Map "sheet/item_id" -> {answer, elapsed_ms, client_ts, app_version}
    this.serverCompleted = undefined; // true / false once the server has been asked, else undefined
    this.order = {};
    for (const sheet of this.sheets) {
      // Sort first so the order depends only on the code and the item ids, never on file order.
      this.order[sheet.id] = seededShuffle(sheet.items.slice().sort(byId), `${code}:${sheet.id}`);
    }
    this.total = this.sheets.reduce((n, s) => n + s.items.length, 0);
  }

  key(sheetId, itemId) { return `${sheetId}/${itemId}`; }
  record(sheetId, itemId) { return this.answers.get(this.key(sheetId, itemId)) || null; }
  answeredIn(sheetId) { return this.order[sheetId].reduce((n, it) => n + (this.answers.has(this.key(sheetId, it.id)) ? 1 : 0), 0); }
  totalAnswered() { return this.sheets.reduce((n, s) => n + this.answeredIn(s.id), 0); }

  /** Index of the first unanswered item of sheet number s, or -1 when the sheet is complete. */
  firstUnansweredIn(s) {
    const sheetId = this.sheets[s].id;
    return this.order[sheetId].findIndex((it) => !this.answers.has(this.key(sheetId, it.id)));
  }

  /** {s, i} of the first unanswered item in sheet order, or null when everything is answered. */
  firstUnanswered() {
    for (let s = 0; s < this.sheets.length; s++) {
      const i = this.firstUnansweredIn(s);
      if (i >= 0) return { s, i };
    }
    return null;
  }
}

export function minutesFor(sheet) {
  return (sheet.items.length * (SECONDS_PER_ITEM[sheet.id] || 120)) / 60;
}

/** "about 25 min", "about 1 h 30 min" (rounded to 5 minutes). */
export function formatMinutes(min) {
  const m = Math.max(5, Math.round(min / 5) * 5);
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `about ${h} h ${rest} min` : `about ${h} h`;
}

/** Total rounded to the quarter hour: "about 3 hours", "about 2 h 45 min". */
export function formatTotal(min) {
  const q = Math.max(15, Math.round(min / 15) * 15);
  const h = Math.floor(q / 60);
  const rest = q % 60;
  if (!h) return `about ${rest} min`;
  if (!rest) return `about ${h} hour${h === 1 ? '' : 's'}`;
  return `about ${h} h ${rest} min`;
}
