// Answer controls for each sheet: the scales and buttons under the texts, when an answer is valid,
// and the exact answer JSON that is saved (scripts/pull_ratings.py depends on these keys).
import { h } from './dom.js';

const OK = { ok: true, need: '' };
const need = (text) => ({ ok: false, need: text });
const filled = (s, n = 3) => String(s || '').trim().length >= n;

export const SLOTS = ['a', 'b'];
const SLOT_NAME = { a: 'Text A', b: 'Text B' };
const PREFER = [{ value: 'A', label: 'Text A' }, { value: 'B', label: 'Text B' }, { value: 'none', label: 'No preference' }];
const GUESS = [{ value: 'A', label: 'Text A' }, { value: 'B', label: 'Text B' }, { value: 'cannot tell', label: 'Cannot tell' }];
const SUPPORT = [
  { value: 'supported', label: 'Supported', color: 'var(--green)' },
  { value: 'partly supported', label: 'Partly', color: 'var(--amber)' },
  { value: 'not supported', label: 'Not supported', color: 'var(--red)' },
  { value: 'cannot judge', label: 'Cannot judge', color: 'var(--muted)' },
];
const SUPPORT_VALUES = SUPPORT.map((o) => o.value);

const isScore = (v) => Number.isInteger(v) && v >= 1 && v <= 5;
const scoresOf = (sheet, src) => Object.fromEntries(sheet.criteria.map((c) => [c.id, isScore(src && src[c.id]) ? src[c.id] : null]));

/** The eight scales of the compare sheet in rating order: each criterion for Text A, then for Text B. */
const scaleOrder = (sheet) => sheet.criteria.flatMap((c) => SLOTS.map((slot) => ({ slot, id: c.id })));

export const SHEET_UI = {
  compare: {
    question: 'Read the papers and both texts. Rate each text under it, then compare the two.',
    keys: 'Keys: 1 to 5 fill the highlighted scale (Text A, then Text B, one criterion at a time) · Enter goes to the next researcher',
    empty: (sheet) => ({ a: scoresOf(sheet, null), b: scoresOf(sheet, null), prefer: null, model_guess: null, comment: '', problem: false }),
    fromAnswer: (ans, sheet) => ({
      a: scoresOf(sheet, ans.a), b: scoresOf(sheet, ans.b),
      prefer: PREFER.some((o) => o.value === ans.prefer) ? ans.prefer : null,
      model_guess: GUESS.some((o) => o.value === ans.model_guess) ? ans.model_guess : null,
      comment: ans.comment ?? '', problem: Boolean(ans.problem),
    }),
    validate(d, sheet) {
      if (d.problem) return filled(d.comment) ? OK : need('Say in the comment what is wrong with the text.');
      const left = scaleOrder(sheet).filter(({ slot, id }) => !isScore(d[slot][id])).length;
      if (left) return need(`Rate both texts on every scale (${left} left).`);
      if (!d.prefer) return need('Say which text you prefer.');
      if (!d.model_guess) return need('Say which text you think the model wrote.');
      return OK;
    },
    finalize: (d) => ({
      a: { ...d.a }, b: { ...d.b }, prefer: d.prefer, model_guess: d.model_guess,
      comment: d.comment.trim(), problem: Boolean(d.problem),
    }),
  },
  interests: {
    question: 'Do this person’s papers support each interest?',
    keys: 'Keys: 1 supported · 2 partly · 3 not supported · 4 cannot judge (fills the highlighted interest) · Enter goes to the next researcher',
    empty: (sheet, item) => ({ support: item.interests.map(() => null), comment: '', opened_all: false }),
    fromAnswer: (ans, sheet, item) => ({
      support: item.interests.map((_, i) => (Array.isArray(ans.support) && SUPPORT_VALUES.includes(ans.support[i]) ? ans.support[i] : null)),
      comment: ans.comment ?? '', opened_all: Boolean(ans.opened_all),
    }),
    validate(d) {
      const left = d.support.filter((v) => !v).length;
      return left ? need(`Answer for every interest (${left} left).`) : OK;
    },
    finalize: (d) => ({ support: d.support.slice(), comment: d.comment.trim(), opened_all: Boolean(d.opened_all) }),
  },
};

// ---- small building blocks ------------------------------------------------------------------

function choiceRow(options, onPick, { small = false, label = '' } = {}) {
  const buttons = options.map((o) => h('button', {
    type: 'button', class: small ? 'choice choice-small' : 'choice', 'data-value': o.value, 'aria-pressed': 'false',
    onclick: () => onPick(o.value),
  }, h('span', {}, o.label)));
  buttons.forEach((b, i) => b.style.setProperty('--sel', options[i].color || 'var(--blue)'));
  return {
    el: h('div', { class: 'choices', role: 'group', 'aria-label': label || null }, buttons),
    set(selected, disabled = false) {
      for (const b of buttons) {
        const on = b.dataset.value === selected;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', String(on));
        b.disabled = disabled;
      }
    },
  };
}

/** A 1-to-5 scale for one text and one criterion: the criterion's name, then five buttons. */
function scale(slot, criterion, onPick) {
  const buttons = [1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button', class: 'score', 'aria-pressed': 'false',
    'aria-label': `${SLOT_NAME[slot]}, ${criterion.label}: ${n} of 5`, onclick: () => onPick(n),
  }, String(n)));
  const el = h('div', { class: 'scale', role: 'group', 'aria-label': `${SLOT_NAME[slot]}: ${criterion.label}`, title: `${criterion.label}: ${criterion.help}` },
    h('span', { class: 'scale-name' }, criterion.label), h('div', { class: 'scores' }, buttons));
  return {
    el,
    set(value, disabled, active) {
      buttons.forEach((b, i) => {
        const on = value === i + 1;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', String(on));
        b.disabled = disabled;
      });
      el.classList.toggle('active', Boolean(active));
    },
  };
}

function textField(label, maxLength, onInput) {
  const input = h('input', { type: 'text', maxlength: String(maxLength), autocomplete: 'off' });
  input.addEventListener('input', () => onInput(input.value));
  const hint = h('span', { class: 'field-hint' });
  const el = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, ' ', hint), input);
  return {
    el,
    set(value) { if (input.value !== value) input.value = value; },
    hint(text, required = false) {
      hint.textContent = text;
      el.classList.toggle('required', required);
    },
  };
}

function checkField(label, onToggle) {
  const box = h('input', { type: 'checkbox' });
  box.addEventListener('change', () => onToggle(box.checked));
  return { el: h('label', { class: 'check' }, box, h('span', {}, label)), set(on) { box.checked = on; } };
}

// ---- per sheet ------------------------------------------------------------------------------

function compareControls(sheet, item, st) {
  const order = scaleOrder(sheet);
  const scales = new Map(); // "a/accurate" -> scale
  // One block of four scales per text; it is mounted at the foot of that text's card (see mount below).
  const blocks = Object.fromEntries(SLOTS.map((slot) => [slot, h('div', { class: 'scale-block' }, sheet.criteria.map((c) => {
    const sc = scale(slot, c, (n) => { st.draft[slot][c.id] = n; st.changed(); });
    scales.set(`${slot}/${c.id}`, sc);
    return sc.el;
  }))]));
  const legend = h('p', { class: 'legend' },
    h('span', {}, '1 = poor · 2 = weak · 3 = acceptable · 4 = good · 5 = excellent. '),
    sheet.criteria.map((c, i) => [h('strong', {}, c.label), `: ${c.help}${i + 1 < sheet.criteria.length ? '; ' : '.'}`]));
  const prefer = choiceRow(PREFER, (v) => { st.draft.prefer = v; st.changed(); }, { label: 'Preferred text' });
  const guess = choiceRow(GUESS, (v) => { st.draft.model_guess = v; st.changed(); }, { label: 'Text written by the model' });
  const comment = textField('Comment', 1000, (v) => { st.draft.comment = v; st.changed(); });
  const problem = checkField('A text is cut off, unreadable or not about research (say which one in the comment; the ratings are then not needed)',
    (on) => { st.draft.problem = on; st.changed(); });
  const firstEmpty = () => order.find(({ slot, id }) => !isScore(st.draft[slot][id])) || null;
  return {
    el: h('div', { class: 'controls' },
      legend,
      h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'Overall, which text do you prefer?'), prefer.el),
      h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'Which text do you think the language model wrote?'), guess.el),
      h('div', { class: 'fields' }, comment.el),
      problem.el),
    refresh() {
      const d = st.draft;
      const active = d.problem ? null : firstEmpty();
      for (const { slot, id } of order) {
        scales.get(`${slot}/${id}`).set(d[slot][id], d.problem, active && active.slot === slot && active.id === id);
      }
      prefer.set(d.prefer, d.problem);
      guess.set(d.model_guess, d.problem);
      comment.set(d.comment);
      comment.hint(d.problem ? '(required)' : '(optional)', d.problem);
      problem.set(d.problem);
    },
    /** Put each text's scales at the foot of its card. */
    mount(texts) {
      for (const slot of SLOTS) texts.slot(slot).replaceChildren(blocks[slot]);
    },
    /** A digit key fills the highlighted scale. Returns false when there is nothing to fill. */
    digit(n) {
      if (st.draft.problem || n < 1 || n > 5) return false;
      const next = firstEmpty();
      if (!next) return false;
      st.draft[next.slot][next.id] = n;
      st.changed();
      return true;
    },
  };
}

function interestsControls(sheet, item, st) {
  const rows = item.interests.map((text, i) => {
    const choices = choiceRow(SUPPORT, (v) => { st.draft.support[i] = v; st.changed(); }, { small: true, label: `Interest ${i + 1}` });
    const el = h('li', { class: 'interest' },
      h('p', { class: 'interest-text' }, h('span', { class: 'interest-num', 'aria-hidden': 'true' }, `${i + 1}`), h('span', {}, text)),
      choices.el);
    return { el, choices };
  });
  const comment = textField('Comment', 1000, (v) => { st.draft.comment = v; st.changed(); });
  comment.hint('(optional)');
  return {
    el: h('div', { class: 'controls' }, h('ol', { class: 'interests' }, rows.map((r) => r.el)), h('div', { class: 'fields' }, comment.el)),
    refresh() {
      const d = st.draft;
      const active = d.support.findIndex((v) => !v);
      rows.forEach((r, i) => {
        r.choices.set(d.support[i]);
        r.el.classList.toggle('active', i === active);
        r.el.classList.toggle('answered', Boolean(d.support[i]));
      });
      comment.set(d.comment);
    },
    digit(n) {
      if (n < 1 || n > SUPPORT.length) return false;
      const i = st.draft.support.findIndex((v) => !v);
      if (i < 0) return false;
      st.draft.support[i] = SUPPORT[n - 1].value;
      st.changed();
      return true;
    },
  };
}

const BUILDERS = { compare: compareControls, interests: interestsControls };

/** st: {draft, changed()}; the builder reads st.draft each time it refreshes. */
export function buildControls(sheet, item, st) {
  return BUILDERS[sheet.id](sheet, item, st);
}
