// Entry point: read the Supabase settings, open the items with the access phrase when the link carries it,
// then show the start page (which asks for the phrase itself when the items are still closed).
import * as config from '../config.js';
import * as api from './api.js';
import * as sync from './sync.js';
import * as store from './storage.js';
import { loadItems, loadOutline } from './state.js';
import { PhraseError, normalizePhrase } from './crypto.js';
import { initUI, showWelcome, showFatal, showLocked } from './views.js';

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

/** The access phrase of the invitation link: .../?t=p1-1of2#k=<phrase>. The fragment is never sent to a server. */
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

function begin(data) {
  initUI(data);
  sync.start();
  showWelcome();
}

async function main() {
  const { url, key } = await loadConfig();
  api.configure(url, key);
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
  if (data) { begin(data); return; }

  // Opened without the invitation link (or with a phrase that does not fit): show the same start page from the
  // public outline. The Start and Resume forms then also ask for the access phrase, and open the items with it.
  const open = async (typed) => {
    const phrase = normalizePhrase(typed);
    if (!phrase) return { error: 'Please enter the access phrase from your invitation, or open the link in the invitation.' };
    let opened;
    try { opened = await tryOpen(phrase); } catch { return { error: loadFailed }; }
    if (!opened) return { error: 'This phrase does not open the profiles. Copy it again from your invitation, or use the link there.' };
    return { data: opened };
  };
  let outline = null;
  try { outline = await loadOutline(); } catch { outline = null; }
  if (!outline) {
    showLocked({
      wrong: candidates.length > 0,
      // Returns an error message, or null once the site has started.
      submit: async (typed) => {
        const result = await open(typed);
        if (result.error) return result.error;
        begin(result.data);
        return null;
      },
    });
    return;
  }
  initUI(null, { outline, open, wrongLink: candidates.length > 0 });
  sync.start();
  showWelcome();
}

main();
