// Screens and flow: welcome (start, resume), sheet intro, item, pause and finish.
import { h } from './dom.js';
import * as store from './storage.js';
import * as sync from './sync.js';
import * as api from './api.js';
import { renderMarkdown } from './markdown.js';
import { APP_VERSION, Session, minutesFor, formatMinutes, formatTotal, parseTrack, sheetsForTrack } from './state.js';
import { SHEET_UI, buildControls } from './controls.js';
import { createPapersPanel, createTextsPanel } from './panels.js';

const TITLE = 'Rating research profiles';
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PURPOSE = 'We are testing whether a short research profile that a language model writes from a faculty member’s publication record can stand in for the text the person wrote for their school’s web page. '
  + 'You will read profile texts of medical school faculty and judge them against each person’s recent papers. '
  + 'Every answer is saved as you go, so you can stop at any point and continue later on this or another device.';
const GUIDE_TITLE = 'How to judge';
const DOT = {
  saved: ['Saved', 'All answers are saved on the server.'],
  saving: ['Saving…', 'Saving your latest answers to the server.'],
  offline: ['Offline', 'The server cannot be reached. Your answers are kept in this browser and will be sent automatically when the connection returns.'],
  local: ['This browser only', 'No server is configured: answers are saved in this browser only.'],
};

let data = null; // the opened items; null while this browser does not have their key yet
let outline = null; // the public outline of the parts (data/outline.json): draws the start page while the items are closed
let openItems = null; // async (key) => { data }, { wrong: true } or { failed: true }; set while the items are closed
let serverGate = false; // the database gives the key to a code it knows (supabase/access.sql): nobody is asked for a phrase
let linkPhraseWrong = false; // the link carried a phrase that does not open the items
let session = null;
let screen = { kind: 'loading' };
let item = null; // the item screen's state while it is mounted
let syncInfo = sync.info();
let downloaded = false;
let bannerSig = '';

const $ = (id) => document.getElementById(id);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const time = (iso) => Date.parse(iso) || 0;

export function initUI(itemsData, closed = null) {
  data = itemsData;
  if (closed) {
    outline = closed.outline;
    openItems = closed.open;
    linkPhraseWrong = Boolean(closed.wrongLink);
    serverGate = Boolean(closed.serverGate);
  }
  sync.onStatus((info) => { syncInfo = info; paintStatus(); });
  document.addEventListener('keydown', onKey);
}

/** Called when the server has said whether a code is enough to open the items. */
export function setServerGate(on) { serverGate = Boolean(on); }

export function showFatal(message) {
  $('topbar').hidden = true;
  $('main').classList.remove('wide');
  $('main').replaceChildren(h('section', { class: 'panel' }, h('h1', {}, 'Something went wrong'), h('p', {}, message)));
}

/** Fallback when even the public outline cannot be loaded: only the access phrase is asked for. */
export function showLocked({ wrong, submit }) {
  screen = { kind: 'locked' };
  $('topbar').hidden = true;
  const input = h('input', { id: 'f-phrase', type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: 200, 'aria-label': 'Access phrase' });
  const err = h('p', { class: 'form-error', role: 'alert' }, wrong ? 'The access phrase in this link does not open the items.' : '');
  const btn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Open');
  $('main').replaceChildren(h('section', { class: 'welcome' },
    h('h1', {}, TITLE),
    h('p', { class: 'lede' }, 'This site is for invited evaluators. The texts are about real people, so they open only with the access phrase from the invitation.'),
    h('form', {
      class: 'panel', novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        err.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Opening…';
        const problem = await submit(input.value);
        if (problem) { err.textContent = problem; btn.disabled = false; btn.textContent = 'Open'; }
      },
    },
    h('h2', {}, 'Access phrase'),
    h('p', { class: 'muted' }, 'The easiest way in is the link in your invitation email, which carries the phrase. You can also paste the phrase here.'),
    h('div', { class: 'inline' }, input, btn),
    err)));
}

// ---- shared pieces --------------------------------------------------------------------------

function siteUrl() { return new URL('.', window.location.href).href; }

/** The track named in the page address (?t=...), or null. */
function urlTrack() { return parseTrack(new URLSearchParams(window.location.search).get('t')); }

/**
 * The address to continue from on any device. Where the code alone opens the items it is just the site; otherwise
 * it carries the access phrase after #, which is never sent to a server.
 */
function resumeUrl() {
  const phrase = serverGate ? '' : store.getPhrase();
  const part = session && session.track ? `?t=${encodeURIComponent(session.track.text)}` : '';
  return phrase ? `${siteUrl()}${part}#k=${encodeURIComponent(phrase)}` : `${siteUrl()}${part}`;
}

const UNREACHABLE = "Can't reach the server right now. Check your connection and try again in a minute.";
const LOAD_FAILED = 'The profiles could not be loaded. Check your connection and try again.';
const NOT_OPENED = 'The profiles could not be opened. Please write to the person who invited you.';

const registerCall = (code, who) => api.registerEvaluator({
  code, name: who.name, email: who.email, track: who.track, userAgent: navigator.userAgent.slice(0, 500),
});

/**
 * Open the items with the key the database gives to a code it knows. For a new evaluator (who is given) the
 * sign-up is sent first. Returns an error message, or '' once the items are open.
 */
async function openForCode(code, who) {
  let key;
  try {
    if (who) await registerCall(code, who);
    key = await api.getAccess(code);
    if (!key && !who) {
      // The server has never seen this code but this browser has (for example the database was reset): sign it up again.
      const local = store.getIdentity(code);
      if (local && parseTrack(local.track)) {
        await registerCall(code, local);
        key = await api.getAccess(code);
      }
    }
  } catch (err) {
    if (err && err.retryable === false) {
      return who ? 'The server did not accept the sign-up. Please check your name and email.' : 'The server did not accept this code. Please check it and try again.';
    }
    return UNREACHABLE;
  }
  if (!key) return who ? NOT_OPENED : 'We could not find this code. Check it for typos, or start as a new evaluator.';
  const result = await openItems(key);
  if (result.failed) return LOAD_FAILED;
  if (!result.data) return NOT_OPENED;
  data = result.data;
  return '';
}

/**
 * What a form needs while the items are still closed. open({ code, who }) returns an error message, or '' once
 * the items are open. Where the database gives the key to a code it knows, the form shows nothing extra;
 * otherwise it gets a field for the access phrase.
 */
function itemsGate(id) {
  if (data) return { field: null, open: async () => '' };
  if (serverGate) return { field: null, open: async ({ code, who = null }) => (data ? '' : openForCode(code, who)) };
  const input = h('input', { id, type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: 200 });
  const field = h('label', { class: 'field field-wide' },
    h('span', { class: 'field-label' }, 'Access phrase'),
    input,
    h('span', { class: 'field-hint' }, 'The link in your invitation fills this in for you. If you came here another way, paste the phrase from the invitation.'));
  return {
    field,
    open: async () => {
      if (data) return '';
      if (!input.value.trim()) { input.focus(); return 'Please enter the access phrase from your invitation, or open the link in the invitation.'; }
      const result = await openItems(input.value);
      if (result.data) { data = result.data; return ''; }
      input.focus();
      return result.failed ? LOAD_FAILED : 'This phrase does not open the profiles. Copy it again from your invitation, or use the link there.';
    },
  };
}

function mailtoHref() {
  const subject = 'My code for the research profile rating';
  const body = `Your code: ${session.code}\n\nTo continue on any device, open\n${resumeUrl()}\nand enter the code under "Resume with a code".\n`;
  const to = String(session.email).replace(/[?&#%\s]/g, encodeURIComponent);
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyCode(button) {
  const done = (ok) => {
    button.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, 1600);
  };
  try {
    await navigator.clipboard.writeText(session.code);
    done(true);
  } catch {
    const tmp = h('textarea', { class: 'offscreen', readonly: true });
    tmp.value = session.code;
    document.body.append(tmp);
    tmp.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    tmp.remove();
    done(ok);
  }
}

function statusDot() {
  const node = h('span', { class: 'save-dot', role: 'status' });
  paintDot(node);
  return node;
}

function paintDot(node) {
  const [label, tip] = DOT[syncInfo.status] || DOT.saved;
  let text = tip;
  if (syncInfo.pending && (syncInfo.status === 'saving' || syncInfo.status === 'offline')) text += ` ${syncInfo.pending} waiting to be sent.`;
  if (syncInfo.refused) text += ` ${syncInfo.refused} refused by the server; kept in this browser and in the download.`;
  node.dataset.status = syncInfo.status;
  node.title = text;
  node.setAttribute('aria-label', text);
  node.replaceChildren(h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'dot-label', 'aria-hidden': 'true' }, label));
}

function renderTopbar({ sheet = '', count = '', pause = false } = {}) {
  const top = $('topbar');
  if (!session) { top.hidden = true; top.replaceChildren(); return; }
  const done = session.totalAnswered();
  const pct = session.total ? (100 * done) / session.total : 0;
  const copy = h('button', { type: 'button', class: 'btn-link', onclick: () => copyCode(copy) }, 'Copy');
  top.hidden = false;
  top.replaceChildren(
    h('div', { class: 'tb-row' },
      h('div', { class: 'tb-left' },
        h('span', { class: 'brand' }, TITLE),
        sheet ? h('span', { class: 'tb-sheet' }, sheet) : null,
        count ? h('span', { class: 'tb-count' }, count) : null),
      h('div', { class: 'tb-right' },
        h('span', { class: 'code-chip', title: 'Your code is how you resume on another device: choose "Resume with a code" there.' },
          h('span', { class: 'code-label' }, 'Your code'), h('code', { class: 'code' }, session.code), copy,
          h('a', { class: 'btn-link', href: mailtoHref() }, 'Email me my code')),
        statusDot(),
        pause ? h('button', { type: 'button', class: 'btn btn-small', onclick: pauseNow }, 'Pause') : null)),
    h('div', {
      class: 'progress', role: 'progressbar', 'aria-label': 'Overall progress',
      'aria-valuemin': 0, 'aria-valuemax': session.total, 'aria-valuenow': done, title: `${done} of ${session.total} researchers rated`,
    }, h('div', { class: 'progress-fill', style: `width:${pct.toFixed(2)}%` })));
}

function renderBanners() {
  const list = [];
  if (!api.configured()) list.push(['banner banner-local', 'Saving to this browser only (no server configured)']);
  else if (syncInfo.status === 'offline') list.push(['banner banner-offline', "Offline: the server can't be reached right now. Your answers are kept in this browser and will be sent automatically when the connection returns."]);
  if (!store.storageWorks()) list.push(['banner banner-error', 'This browser is not keeping data between visits (private window or storage blocked). Keep this page open, and download your answers before you close it.']);
  const sig = JSON.stringify(list);
  if (sig === bannerSig) return;
  bannerSig = sig;
  $('banners').replaceChildren(...list.map(([cls, text]) => h('div', { class: cls }, text)));
}

function paintStatus() {
  document.querySelectorAll('.save-dot').forEach(paintDot);
  renderBanners();
  paintSavedNote();
}

function paintSavedNote() {
  const note = $('saved-note');
  if (!note || !session) return;
  const { status, pending } = syncInfo;
  let text;
  if (status === 'local') {
    text = screen.kind === 'finish'
      ? (downloaded ? 'Your answers are saved; you can close this page.' : 'Your answers are in this browser only until you download them.')
      : 'Your answers are saved in this browser only (no server is configured). Download a copy if you might switch devices.';
  } else if (status === 'offline') {
    text = `The server can't be reached right now: ${pending || 'your'} answer${pending === 1 ? ' is' : 's are'} kept in this browser and will be sent automatically. Keep this page open if you can, or come back later on this device.`;
  } else if (pending) {
    text = `Saving… ${pending} answer${pending === 1 ? '' : 's'} still to send. Please keep this page open until the dot at the top says Saved.`;
  } else {
    text = screen.kind === 'finish' ? 'Your answers are saved; you can close this page.' : 'Your answers are saved.';
  }
  note.textContent = text;
  note.dataset.status = status;
}

function codeLine() {
  return h('p', { class: 'code-line' },
    'Your code is ', h('code', {}, session.code),
    '. It is how you resume on another device: open the link from your invitation there and choose “Resume with a code”. ',
    h('a', { href: mailtoHref() }, 'Email me my code'));
}

function guideDetails(summary, md) {
  return h('details', { class: 'guide' }, h('summary', {}, summary), h('div', { class: 'md', html: renderMarkdown(md) }));
}

function sheetTable(sheets) {
  const totalMin = sheets.reduce((n, s) => n + minutesFor(s), 0);
  // both parts are about the same researchers, so the total counts each researcher once
  const totalItems = new Set(sheets.flatMap((s) => s.items.map((it) => it.rank))).size;
  return h('table', { class: 'sheet-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Part'), h('th', {}, 'What you judge'), h('th', { class: 'num' }, 'Researchers'), h('th', { class: 'num' }, 'Time'))),
    h('tbody', {}, sheets.map((s) => h('tr', {},
      h('td', {}, s.title), h('td', {}, s.short),
      h('td', { class: 'num' }, s.items.length), h('td', { class: 'num' }, formatMinutes(minutesFor(s)))))),
    sheets.length > 1 ? h('tfoot', {}, h('tr', {},
      h('td', {}, 'In all'), h('td', {}, 'over as many sittings as you like'),
      h('td', { class: 'num' }, totalItems), h('td', { class: 'num' }, formatMinutes(totalMin)))) : null);
}

// ---- welcome --------------------------------------------------------------------------------

export function showWelcome() {
  closeItemScreen();
  session = null;
  screen = { kind: 'welcome' };
  renderTopbar();
  renderBanners();
  const current = store.getCurrent();
  const known = current && current.code && parseTrack(current.track) ? current : null;
  // The invitation link names the part (?t=p1 or ?t=p2). Without it, a new evaluator gets both parts, Part 1 first.
  const track = known ? parseTrack(known.track) : (urlTrack() || parseTrack('all'));
  // While the items are closed, the public outline holds what this page shows (parts, numbers, instructions).
  const shown = data || outline;
  $('main').replaceChildren(h('section', { class: 'welcome' },
    h('h1', {}, TITLE),
    h('p', { class: 'lede' }, PURPOSE),
    guideDetails(GUIDE_TITLE, shown.common_instructions),
    sheetTable(sheetsForTrack(shown, track)),
    h('p', { class: 'consent' }, 'Your name and email are stored so we can credit and contact you; nothing else about you is collected.'),
    known ? continuePanel(known) : [startPanel(track), resumePanel()]));
  window.scrollTo(0, 0);
}

function continuePanel(cur) {
  const gate = itemsGate('f-phrase');
  const err = h('p', { class: 'form-error', role: 'alert' });
  const label = `Continue as ${cur.name}`;
  const go = h('button', {
    type: 'button', class: 'btn btn-primary',
    onclick: async () => {
      go.disabled = true;
      go.textContent = 'Loading…';
      const problem = (await gate.open({ code: cur.code })) || (await resume(cur.code));
      if (problem) { err.textContent = problem; go.disabled = false; go.textContent = label; }
    },
  }, label);
  const other = h('button', { type: 'button', class: 'btn-link', onclick: () => { store.clearCurrent(); showWelcome(); } }, 'I am someone else');
  return h('div', { class: 'panel' },
    h('h2', {}, 'Welcome back'),
    h('p', {}, 'This browser remembers you (code ', h('code', {}, cur.code), ').'),
    gate.field ? h('div', { class: 'fields' }, gate.field) : null,
    h('div', { class: 'actions' }, go, other),
    err);
}

function startPanel(track) {
  const name = h('input', { id: 'f-name', type: 'text', autocomplete: 'name', maxlength: 80, required: true });
  const email = h('input', { id: 'f-email', type: 'email', autocomplete: 'email', maxlength: 254, required: true });
  const gate = itemsGate('f-phrase');
  const err = h('p', { class: 'form-error', role: 'alert' },
    gate.field && linkPhraseWrong ? 'The access phrase in this link does not open the profiles. Please paste the phrase from your invitation below.' : '');
  const btn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Start');
  // Where the sign-up itself opens the items, the same code is used again if the person has to press Start twice.
  let pendingCode = null;
  return h('form', {
    class: 'panel', novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      const n = name.value.trim().replace(/\s+/g, ' ');
      const m = email.value.trim();
      if (n.length < 2 || n.length > 80) { err.textContent = 'Please enter your full name (2 to 80 characters).'; name.focus(); return; }
      if (m.length > 254 || !EMAIL_RE.test(m)) { err.textContent = 'Please enter a valid email address.'; email.focus(); return; }
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Starting…';
      const viaServer = !data && serverGate;
      if (viaServer && !pendingCode) pendingCode = newCode();
      const problem = await gate.open({ code: pendingCode, who: { name: n, email: m, track: track.text } });
      btn.disabled = false;
      btn.textContent = 'Start';
      if (problem) { err.textContent = problem; return; }
      if (viaServer) startNew(n, m, track, pendingCode, true);
      else startNew(n, m, track);
    },
  },
  h('h2', {}, 'Start'),
  h('div', { class: 'fields' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Full name'), name),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Email'), email)),
  gate.field ? h('div', { class: 'fields' }, gate.field) : null,
  err,
  h('div', { class: 'actions' }, btn));
}

function normalizeCode(text) {
  return String(text || '').toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

function resumePanel() {
  const input = h('input', {
    id: 'f-code', type: 'text', class: 'code-input', autocomplete: 'off', autocapitalize: 'characters',
    spellcheck: 'false', maxlength: 20, placeholder: 'for example 7K3QX9M2PA', 'aria-label': 'Your code',
  });
  const gate = itemsGate('f-phrase-resume');
  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { type: 'submit', class: 'btn' }, 'Resume');
  return h('form', {
    class: 'panel resume', novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      const code = normalizeCode(input.value);
      if (!CODE_RE.test(code)) { err.textContent = 'A code has 10 letters and digits, for example 7K3QX9M2PA.'; return; }
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Checking…';
      const problem = (await gate.open({ code })) || (await resume(code));
      if (problem) { err.textContent = problem; btn.disabled = false; btn.textContent = 'Resume'; }
    },
  },
  h('h2', {}, 'Resume with a code'),
  h('p', { class: 'muted' }, 'Already started, here or on another device? Enter the code you were given.'),
  gate.field ? h('div', { class: 'fields' }, gate.field) : null,
  h('div', { class: 'inline' }, input, btn),
  err);
}

// ---- identity and resume --------------------------------------------------------------------

function newCode() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b & 31]).join('');
}

const registerOp = (code, who) => ({ kind: 'register', code, name: who.name, email: who.email, track: who.track, user_agent: navigator.userAgent.slice(0, 500) });
const ratingOp = (code, sheet, itemId, rec) => ({
  kind: 'rating', code, sheet, item_id: itemId, answer: rec.answer,
  elapsed_ms: rec.elapsed_ms ?? null, client_ts: rec.client_ts, app_version: rec.app_version || APP_VERSION,
});

/** Begin as a new evaluator. `registered` says the sign-up has already reached the server (it opened the items). */
function startNew(name, email, track, code = newCode(), registered = false) {
  const who = { name, email, track: track.text };
  store.setIdentity(code, who);
  store.setCurrent({ code, ...who });
  if (!registered) sync.enqueue(registerOp(code, who));
  session = new Session(data, code, who, new Map());
  session.serverCompleted = false;
  downloaded = false;
  showIntro(0);
}

/** Look the code up (server first, then this browser). Returns an error message, or null after moving on. */
async function resume(code) {
  const localWho = store.getIdentity(code);
  const local = store.loadAnswers(code);
  if (!api.configured()) {
    if (!localWho) return 'This code is not known in this browser, and no server is configured to look it up.';
    return begin(code, localWho, local, undefined);
  }
  let progress;
  try {
    progress = await api.getProgress(code);
  } catch (err) {
    if (localWho) {
      sync.markOffline();
      return begin(code, localWho, local, undefined);
    }
    if (err && err.retryable === false) return 'The server did not accept this code. Please check it and try again.';
    return "Can't reach the server right now. Check your connection and try again in a minute.";
  }
  if (!progress) {
    if (!localWho) return 'We could not find this code. Check it for typos, or start as a new evaluator.';
    // The server has never seen this code: register it from this browser and send what is stored here.
    sync.enqueue(registerOp(code, localWho));
    for (const [key, rec] of local) {
      const [sheet, itemId] = key.split('/');
      if (!store.isQueued(code, sheet, itemId)) sync.enqueue(ratingOp(code, sheet, itemId, rec));
    }
    return begin(code, localWho, local, false);
  }
  // The item set was fixed at sign-up: the server's copy wins over anything stored here or in the link.
  const who = { name: progress.name, email: progress.email, track: progress.track || (localWho && localWho.track) };
  const server = new Map((progress.ratings || []).map((r) => [`${r.sheet}/${r.item_id}`, r]));
  for (const [key, r] of server) {
    const mine = local.get(key);
    if (!mine || time(r.client_ts) > time(mine.client_ts)) {
      const rec = { answer: r.answer, elapsed_ms: null, client_ts: r.client_ts, app_version: null };
      local.set(key, rec);
      const [sheet, itemId] = key.split('/');
      store.saveAnswer(code, sheet, itemId, rec);
    }
  }
  for (const [key, rec] of local) {
    const theirs = server.get(key);
    if (!theirs || time(rec.client_ts) > time(theirs.client_ts)) {
      const [sheet, itemId] = key.split('/');
      if (!store.isQueued(code, sheet, itemId)) sync.enqueue(ratingOp(code, sheet, itemId, rec));
    }
  }
  return begin(code, who, local, Boolean(progress.completed_at));
}

/** Start the session for a known evaluator. Returns an error message, or null after moving on. */
function begin(code, who, answers, serverCompleted) {
  let next;
  try {
    next = new Session(data, code, who, answers);
  } catch {
    return 'This code has no set of researchers assigned. Please write to the person who invited you.';
  }
  store.setIdentity(code, who);
  store.setCurrent({ code, ...who });
  session = next;
  session.serverCompleted = serverCompleted;
  downloaded = false;
  const first = session.firstUnanswered();
  if (first) showIntro(first.s);
  else showFinish();
  return null;
}

// ---- sheet intro ----------------------------------------------------------------------------

function showIntro(s, { note = '' } = {}) {
  closeItemScreen();
  screen = { kind: 'intro', s };
  const sheet = session.sheets[s];
  const n = session.order[sheet.id].length;
  const first = session.firstUnansweredIn(s);
  renderTopbar({ sheet: sheet.title, count: `${session.answeredIn(sheet.id)} of ${n} rated` });
  renderBanners();
  const actions = first < 0
    ? [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => goForward(s + 1) }, 'Go on'),
      h('button', { type: 'button', class: 'btn', onclick: () => showItem(s, 0, 0) }, 'Review from the first researcher')]
    : [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => showItem(s, first, 0) }, first > 0 ? `Continue at researcher ${first + 1}` : 'Begin')];
  $('main').replaceChildren(h('section', { class: 'intro' },
    note ? h('p', { class: 'note-done' }, note) : null,
    session.sheets.length > 1 ? h('p', { class: 'eyebrow' }, `Part ${s + 1} of ${session.sheets.length}`) : null,
    h('h1', {}, sheet.title),
    h('p', { class: 'lede' }, `${capitalize(sheet.short)} · ${n} researchers · ${formatMinutes(minutesFor(sheet))}`),
    h('div', { class: 'md instructions', html: renderMarkdown(sheet.instructions) }),
    guideDetails(GUIDE_TITLE, data.common_instructions),
    codeLine(),
    h('div', { class: 'actions' }, actions)));
  actions[0].focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function goForward(from, note = '') {
  for (let t = from; t < session.sheets.length; t++) {
    if (session.firstUnansweredIn(t) >= 0) { showIntro(t, { note }); return; }
  }
  showFinish();
}

// ---- item screen ----------------------------------------------------------------------------

function stopwatch() {
  let total = 0;
  let since = document.hidden ? null : performance.now();
  const onVisibility = () => {
    if (document.hidden) {
      if (since != null) { total += performance.now() - since; since = null; }
    } else if (since == null) {
      since = performance.now();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return {
    ms: () => total + (since != null ? performance.now() - since : 0),
    stop: () => document.removeEventListener('visibilitychange', onVisibility),
  };
}

function buildItemScreen(s) {
  closeItemScreen();
  const sheet = session.sheets[s];
  const ui = SHEET_UI[sheet.id];
  const papersHost = h('aside', { class: 'papers-col', 'aria-label': 'Papers' });
  const textsHost = sheet.id === 'compare' ? h('div', { class: 'texts' }) : null;
  const heading = sheet.id === 'interests' ? h('p', { class: 'interests-head' }) : null;
  const question = h('h2', { class: 'question', tabindex: '-1' }, ui.question);
  const controlsHost = h('div', { class: 'controls-host' });
  const back = h('button', { type: 'button', class: 'btn', onclick: goBack }, 'Back');
  const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: goNext }, 'Next');
  const hint = h('span', { class: 'nav-hint' });
  const body = h('div', { class: 'item-grid' },
    papersHost,
    h('div', { class: 'work-col' }, heading, question, textsHost, controlsHost));
  const root = h('section', { class: `item-screen sheet-${sheet.id}` },
    body,
    h('div', { class: 'nav' }, back, hint, next),
    h('div', { class: 'below' },
      h('p', { class: 'keys' }, ui.keys),
      h('details', { class: 'guide' }, h('summary', {}, 'Instructions for this part'),
        h('div', { class: 'md', html: renderMarkdown(sheet.instructions) }),
        h('h3', {}, GUIDE_TITLE),
        h('div', { class: 'md', html: renderMarkdown(data.common_instructions) }))));
  $('main').classList.add('wide');
  $('main').replaceChildren(root);
  const st = {
    s, i: -1, sheet, it: null, draft: null, ctrl: null, watch: null,
    root, body, papersHost, heading, question, controlsHost, back, next, hint,
    changed: () => refreshItem(),
  };
  st.papers = createPapersPanel(papersHost, {
    onOpenAll: () => { if (item === st && st.draft && 'opened_all' in st.draft) { st.draft.opened_all = true; refreshItem(); } },
  });
  st.texts = textsHost ? createTextsPanel(textsHost) : null;
  item = st;
}

function closeItemScreen() {
  $('main').classList.remove('wide');
  if (!item) return;
  if (item.watch) item.watch.stop();
  item = null;
}

/** Slide the new researcher in from the side the evaluator is moving towards. */
function slide(node, dir) {
  node.classList.remove('enter-next', 'enter-prev');
  if (!dir) return;
  void node.offsetWidth; // restart the animation
  node.classList.add(dir > 0 ? 'enter-next' : 'enter-prev');
}

function showItem(s, i, dir = 0) {
  if (!item || item.s !== s || !item.root.isConnected) { buildItemScreen(s); dir = 0; }
  const st = item;
  if (st.watch) st.watch.stop();
  const sheet = st.sheet;
  const ui = SHEET_UI[sheet.id];
  const it = session.order[sheet.id][i];
  screen = { kind: 'item', s, i };
  st.i = i;
  st.it = it;
  const rec = session.record(sheet.id, it.id);
  st.draft = rec ? ui.fromAnswer(rec.answer, sheet, it) : ui.empty(sheet, it);
  st.watch = stopwatch();
  st.papers.show(it.person, { expandable: sheet.id === 'interests', opened: Boolean(st.draft.opened_all) });
  if (st.texts) st.texts.show(it);
  if (st.heading) st.heading.textContent = `Research interests listed in the generated profile of ${it.person.name}`;
  st.ctrl = buildControls(sheet, it, st);
  st.controlsHost.replaceChildren(st.ctrl.el);
  if (st.texts && st.ctrl.mount) st.ctrl.mount(st.texts);
  refreshItem();
  st.back.disabled = i === 0;
  renderTopbar({ sheet: sheet.title, count: `researcher ${i + 1} of ${session.order[sheet.id].length}`, pause: true });
  renderBanners();
  slide(st.body, dir);
  window.scrollTo(0, 0);
  st.question.focus({ preventScroll: true });
}

function refreshItem() {
  if (!item || !item.ctrl) return;
  item.ctrl.refresh();
  const v = SHEET_UI[item.sheet.id].validate(item.draft, item.sheet);
  item.next.disabled = !v.ok;
  item.hint.textContent = v.ok ? '' : v.need;
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Save the answer on screen if it is valid and new or changed. Returns false when it is not valid. */
function commit() {
  if (!item || !item.it) return false;
  const sheet = item.sheet;
  const ui = SHEET_UI[sheet.id];
  if (!ui.validate(item.draft, sheet).ok) return false;
  const answer = ui.finalize(item.draft);
  const prev = session.record(sheet.id, item.it.id);
  if (prev && canonical(prev.answer) === canonical(answer)) return true;
  const elapsed = Math.min(2147483647, Math.round((prev && prev.elapsed_ms ? prev.elapsed_ms : 0) + item.watch.ms()));
  const rec = { answer, elapsed_ms: elapsed, client_ts: new Date().toISOString(), app_version: APP_VERSION };
  session.answers.set(session.key(sheet.id, item.it.id), rec);
  store.saveAnswer(session.code, sheet.id, item.it.id, rec);
  sync.enqueue(ratingOp(session.code, sheet.id, item.it.id, rec));
  return true;
}

function goNext() {
  if (!item || screen.kind !== 'item') return;
  if (!SHEET_UI[item.sheet.id].validate(item.draft, item.sheet).ok) return;
  commit();
  const { s, i, sheet } = item;
  if (i + 1 < session.order[sheet.id].length) showItem(s, i + 1, +1);
  else goForward(s + 1, `${sheet.title} complete: you rated all ${sheet.items.length} researchers.`);
}

// Back stays inside the part: once the next part has begun, the earlier part's answers are final,
// so the unblinded Part 2 can never lead to a change in the blinded Part 1.
function goBack() {
  if (!item || screen.kind !== 'item') return;
  commit();
  const { s, i } = item;
  if (i > 0) showItem(s, i - 1, -1);
}

function onKey(event) {
  if (screen.kind !== 'item' || !item) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const target = event.target instanceof Element ? event.target : null;
  const tag = target ? target.tagName : '';
  const inText = tag === 'TEXTAREA' || (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(target.type));
  if (event.key === 'Enter') {
    if (event.repeat) return;
    if (!inText && target && target.closest('button, a, summary')) return; // those act on Enter themselves
    event.preventDefault();
    goNext();
    return;
  }
  if (inText) {
    if (event.key === 'Escape') target.blur();
    return;
  }
  if (/^[1-5]$/.test(event.key)) {
    event.preventDefault();
    if (item.ctrl && item.ctrl.digit) item.ctrl.digit(Number(event.key));
  }
}

// ---- pause and finish -----------------------------------------------------------------------

function pauseNow() {
  if (screen.kind !== 'item' || !item) return;
  commit();
  showPause({ s: item.s, i: item.i });
}

function showPause(where) {
  closeItemScreen();
  screen = { kind: 'pause', where };
  renderTopbar({ sheet: 'Paused' });
  renderBanners();
  const local = !api.configured();
  $('main').replaceChildren(h('section', { class: 'panel-page' },
    h('h1', {}, 'Paused'),
    h('p', { class: 'saved-note', id: 'saved-note' }),
    local
      ? h('p', {}, 'To continue later, open this page again in this same browser; it remembers where you stopped.')
      : h('p', {}, 'To continue later, open this page again: this browser remembers you. On another device, open the link from your invitation and enter your code under “Resume with a code”.'),
    h('p', { class: 'code-big' }, h('span', { class: 'muted' }, 'Your code '), h('code', {}, session.code), ' ',
      h('a', { href: mailtoHref() }, 'Email me my code')),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-primary', id: 'continue-rating', onclick: () => showItem(where.s, where.i, 0) }, 'Continue rating'),
      h('button', { type: 'button', class: 'btn', onclick: downloadAnswers }, 'Download my answers (JSON)'))));
  paintSavedNote();
  $('continue-rating').focus({ preventScroll: true });
  sync.kick();
}

function showFinish() {
  closeItemScreen();
  screen = { kind: 'finish' };
  const code = session.code;
  if (!store.getFinished(code) || session.serverCompleted === false) {
    store.setFinished(code, new Date().toISOString());
    sync.enqueue({ kind: 'finish', code });
    session.serverCompleted = true;
  }
  renderTopbar({ sheet: 'Finished' });
  renderBanners();
  const local = !api.configured();
  const download = h('button', {
    type: 'button', class: local ? 'btn btn-primary' : 'btn',
    onclick: () => { downloadAnswers(); downloaded = true; paintSavedNote(); },
  }, 'Download my answers (JSON)');
  $('main').replaceChildren(h('section', { class: 'panel-page finish' },
    h('h1', {}, `Thank you, ${session.name}.`),
    h('p', { class: 'lede' }, 'You have rated every researcher in your set.'),
    h('table', { class: 'sheet-table compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Part'), h('th', { class: 'num' }, 'Rated'))),
      h('tbody', {}, session.sheets.map((s) => h('tr', {},
        h('td', {}, s.title), h('td', { class: 'num' }, `${session.answeredIn(s.id)} of ${s.items.length}`))))),
    local
      ? h('div', { class: 'warn-box' }, h('strong', {}, 'Please download your answers now. '),
        'No server is configured, so they exist only in this browser. Send the file to the person who invited you.')
      : h('p', {}, 'If you like, keep a copy of your answers as a backup.'),
    h('div', { class: 'actions' }, download),
    h('p', { class: 'saved-note', id: 'saved-note' })));
  paintSavedNote();
  window.scrollTo(0, 0);
}

function downloadAnswers() {
  if (!session) return;
  const answers = [];
  for (const sheet of session.sheets) {
    for (const it of sheet.items.slice().sort(byId)) {
      const rec = session.record(sheet.id, it.id);
      if (rec) {
        answers.push({
          sheet: sheet.id, item_id: it.id, answer: rec.answer,
          elapsed_ms: rec.elapsed_ms ?? null, client_ts: rec.client_ts, app_version: rec.app_version ?? null,
        });
      }
    }
  }
  const payload = {
    what: 'Research profile rating: backup of one evaluator’s answers',
    site: siteUrl(),
    items_version: data.version,
    app_version: APP_VERSION,
    exported_at: new Date().toISOString(),
    code: session.code,
    name: session.name,
    email: session.email,
    track: session.track.text,
    counts: Object.fromEntries(session.sheets.map((s) => [s.id, session.answeredIn(s.id)])),
    answers,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 1)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `profile-ratings-${session.code}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
