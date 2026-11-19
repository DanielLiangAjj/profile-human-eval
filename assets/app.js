// Entry point: read the Supabase settings, open the items with the access phrase, then show the welcome screen.
import * as config from '../config.js';
import * as api from './api.js';
import * as sync from './sync.js';
import * as store from './storage.js';
import { loadItems } from './state.js';
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
  showLocked({
    wrong: candidates.length > 0,
    // Returns an error message, or null once the site has started.
    submit: async (typed) => {
      const phrase = normalizePhrase(typed);
      if (!phrase) return 'Paste the access phrase from your invitation.';
      let opened;
      try { opened = await tryOpen(phrase); } catch { return loadFailed; }
      if (!opened) return 'This phrase does not open the items. Copy it again from your invitation, or use the link there.';
      begin(opened);
      return null;
    },
  });
}

main();
