// Entry point: read the Supabase settings, open the items when this browser already has their key, then show
// the start page. While the items are closed, the start page opens them when a person signs up or enters
// a code: the database gives the key to a code it knows (supabase/access.sql). Where that is not set up,
// the forms ask for the access phrase instead.
import * as config from '../config.js';
import * as api from './api.js';
import * as sync from './sync.js';
import * as store from './storage.js';
import { loadItems, loadOutline } from './state.js';
import { PhraseError, normalizePhrase } from './crypto.js';
import { initUI, setServerGate, showWelcome, showFatal, showLocked } from './views.js';

async function loadConfig() {
  let url = config.SUPABASE_URL || '';
  let key = config.SUPABASE_ANON_KEY || '';
  // config.local.js (git-ignored) overrides config.js for local testing. It never exists on
  // GitHub Pages, so the lookup is skipped there (no 404 in the console).
  if (!/\.github\.io$/.test(window.location.hostname)) {
    try {
      const local = await import('../config.local.js');
      // an export that is present wins, also when it is empty: empty values force local-only mode
      if (typeof local.SUPABASE_URL === 'string') url = local.SUPABASE_URL;
      if (typeof local.SUPABASE_ANON_KEY === 'string') key = local.SUPABASE_ANON_KEY;
    } catch {
      // no local override
    }
  }
  return { url, key };
}

/**
 * Who gives the browser the key of the items: 'server' when the database gives it to a code it knows
 * (supabase/access.sql has been run and the key is stored there), otherwise 'phrase' (the person supplies it).
 */
async function probeGate() {
  if (!api.configured()) return 'phrase';
  try {
    return (await api.accessReady()) === true ? 'server' : 'phrase';
  } catch (err) {
    // 404: the database does not have the functions of supabase/access.sql. Anything else: the server could not
    // be asked just now; the forms then report the connection problem when they are sent.
    return err && err.status === 404 ? 'phrase' : 'server';
  }
}

/** An access phrase carried by the link (.../?t=p1#k=<phrase>), as older invitations have it. The fragment is never sent to a server. */
function phraseFromUrl() {
  const m = /(?:^#|&)k=([^&]*)/.exec(window.location.hash);
  if (!m) return '';
  try { return normalizePhrase(decodeURIComponent(m[1])); } catch { return ''; }
}

/** The items, or null when the phrase is wrong. Other failures (network, format) are thrown. */
async function tryOpen(phrase) {
  try {
    const data = await loadItems(phrase);
    store.setPhrase(phrase);
    return data;
  } catch (err) {
    if (err instanceof PhraseError) return null;
    throw err;
  }
}

async function main() {
  const { url, key } = await loadConfig();
  api.configure(url, key);
  const gateProbe = probeGate();
  const candidates = [...new Set([phraseFromUrl(), store.getPhrase()].filter(Boolean))];
  const loadFailed = 'The items could not be loaded. Check your connection and reload the page.';
  let data = null;
  try {
    for (const phrase of candidates) {
      data = await tryOpen(phrase);
      if (data) break;
    }
  } catch {
    showFatal(loadFailed);
    return;
  }
  if (data) {
    // This browser already has the key. The answer of the probe only decides whether the "continue on another
    // device" link still has to carry the phrase, so the page does not wait for it.
    initUI(data);
    gateProbe.then((gate) => setServerGate(gate === 'server'));
    sync.start();
    showWelcome();
    return;
  }

  // The items are still closed: draw the same start page from the public outline. The Start and Resume forms open
  // the items: with the key the database gives to the person's code, or else with the access phrase they type.
  // open() returns { data }, { wrong: true } for a key that does not fit, or { failed: true } when the file did not load.
  const open = async (text) => {
    const phrase = normalizePhrase(text);
    if (!phrase) return { wrong: true };
    try {
      const opened = await tryOpen(phrase);
      return opened ? { data: opened } : { wrong: true };
    } catch {
      return { failed: true };
    }
  };
  const [gate, outline] = await Promise.all([gateProbe, loadOutline().catch(() => null)]);
  if (!outline) {
    showLocked({
      wrong: candidates.length > 0,
      // Returns an error message, or null once the site has started.
      submit: async (typed) => {
        if (!normalizePhrase(typed)) return 'Please enter the access phrase from your invitation.';
        const result = await open(typed);
        if (result.failed) return loadFailed;
        if (!result.data) return 'This phrase does not open the profiles. Copy it again from your invitation.';
        initUI(result.data);
        sync.start();
        showWelcome();
        return null;
      },
    });
    return;
  }
  initUI(null, { outline, open, wrongLink: candidates.length > 0, serverGate: gate === 'server' });
  sync.start();
  showWelcome();
}

main();
