// What the evaluator reads: the person's papers (the reference) and, in Part 1, the two texts.
import { h } from './dom.js';
import { PAPERS_SHOWN } from './state.js';

const paperRow = (p) => h('li', {}, h('span', { class: 'p-title' }, p.t), ' ',
  h('span', { class: 'p-src' }, [p.j, p.y].filter(Boolean).join(', ')));

/**
 * The reference list. Part 1 shows the 15 most recent papers only; Part 2 can open the rest
 * (the model saw up to 50), and tells the caller when that happens.
 */
export function createPapersPanel(host, { onOpenAll } = {}) {
  return {
    show(person, { expandable = false, opened = false } = {}) {
      const all = person.papers;
      const first = all.slice(0, PAPERS_SHOWN);
      const rest = expandable ? all.slice(PAPERS_SHOWN) : [];
      const list = h('ol', { class: 'papers' }, first.map(paperRow));
      const note = h('p', { class: 'papers-note' });
      const more = h('button', { type: 'button', class: 'btn btn-small' }, `Show all ${all.length} papers`);
      const describe = (open) => {
        const shown = open ? all.length : first.length;
        note.textContent = shown >= person.n_papers
          ? `All ${person.n_papers} papers on record, 2016 to 2026, newest first.`
          : `The ${shown} most recent of ${person.n_papers} papers, 2016 to 2026, newest first.`;
      };
      const openAll = (tell) => {
        list.append(...rest.map(paperRow));
        more.remove();
        describe(true);
        if (tell && onOpenAll) onOpenAll();
      };
      more.addEventListener('click', () => openAll(true));
      describe(false);
      host.replaceChildren(
        h('p', { class: 'person-name' }, person.name),
        h('p', { class: 'person-school' }, person.school),
        h('h3', { class: 'papers-title' }, 'Papers (the reference)'),
        note, list, rest.length ? more : null);
      if (rest.length && opened) openAll(false);
      host.scrollTop = 0;
    },
  };
}

/** Text A and Text B, side by side; each card ends with the place for that text's four scales. */
export function createTextsPanel(host) {
  const slots = {};
  return {
    show(item) {
      host.replaceChildren(...['a', 'b'].map((slot) => {
        slots[slot] = h('div', { class: 'card-scales' });
        return h('article', { class: 'text-card', 'aria-label': `Text ${slot.toUpperCase()}` },
          h('h3', { class: 'text-label' }, `Text ${slot.toUpperCase()}`),
          h('p', { class: 'text-body' }, item[slot]),
          slots[slot]);
      }));
    },
    slot: (name) => slots[name],
  };
}
