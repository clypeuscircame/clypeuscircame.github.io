/* Builds every page from JSON in /data. */
(() => {
  'use strict';

  const LANG_NAMES = { he:'Hebrew', grc:'Greek', arc:'Aramaic', la:'Latin', de:'German', fr:'French',
                       it:'Italian', es:'Spanish', en:'English', egy:'Egyptian', akk:'Akkadian' };

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  };

  const getJSON = async url => {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  };

  const host = u => { try { return new URL(u, location.href).hostname.replace(/^www\./, ''); } catch { return 'link'; } };

  function renderNav(site) {
    const nav = document.getElementById('site-nav');
    if (!nav || !site) return;
    const here = location.pathname.split('/').pop() || 'index.html';
    nav.append(
      el('a', { class: 'brand', href: 'index.html', text: site.title }),
      el('ul', {}, site.pages.map(p =>
        el('li', {}, el('a', { href: p.href, text: p.label, 'aria-current': p.href === here ? 'page' : null })))));
  }

  /* ---------- citation tables ---------- */

  // citation text (toggled by "Citation details") + link (toggled by "Links to originals")
  function citeLine(cls, citation, url) {
    const box = el('div', { class: cls });
    if (citation) box.append(el('span', { class: 'cite-text', text: citation }));
    if (url) box.append(el('a', { class: 'cite-url', href: url, target: '_blank', rel: 'noopener', title: url, text: `${host(url)} ↗` }));
    return box;
  }

  function renderEntry(e) {
    const art = el('article', { class: 'cite', id: e.id });
    if (e.citation || e.url) art.append(citeLine('cite-src', e.citation, e.url));
    for (const t of e.texts) {
      const trans = t.kind === 'translation';
      const div = el('div', { class: `text ${trans ? 'trans' : 'orig'}`, 'data-lang': t.lang },
        el('span', { class: 'tlabel', text: t.label || LANG_NAMES[t.lang] || t.lang }),
        el('div', { class: 'tbody', lang: t.lang, dir: 'auto', html: t.html }));
      if (t.citation || t.url) div.append(citeLine('tsrc', t.citation, t.url));
      art.append(div);
    }
    return art;
  }

  function checkbox(text, extra, checked, onchange) {
    const input = el('input', { type: 'checkbox' });
    input.checked = checked;
    input.addEventListener('change', () => onchange(input.checked));
    return { input, label: el('label', {}, input, ` ${text} `, extra ? el('span', { class: 'count', text: extra }) : null) };
  }

  function renderCitations(block, data) {
    const entries = data.entries || [];
    const sec = el('section', { class: 'citations', id: block.id });
    if (block.heading) sec.append(el('h1', { text: block.heading, dir: 'auto' }));
    if (block.intro) sec.append(el('div', { class: 'intro', html: block.intro }));

    // Original languages present, in order of first appearance, with entry counts
    const counts = new Map();
    for (const e of entries)
      new Set(e.texts.filter(t => t.kind !== 'translation').map(t => t.lang))
        .forEach(l => counts.set(l, (counts.get(l) || 0) + 1));

    const key = `filters:${location.pathname}:${block.id}`;
    const defaults = { langs: Object.fromEntries([...counts.keys()].map(l => [l, true])), trans: true, meta: true, links: true };
    let state = defaults;
    try {
      const saved = JSON.parse(localStorage.getItem(key)) || {};
      state = { ...defaults, ...saved, langs: { ...defaults.langs, ...(saved.langs || {}) } };
    } catch {}

    const list = el('div', { class: 'cite-list' }, entries.map(renderEntry));
    const status = el('p', { class: 'status', 'aria-live': 'polite' });

    function apply() {
      sec.classList.toggle('hide-trans', !state.trans);
      sec.classList.toggle('hide-meta', !state.meta);
      sec.classList.toggle('hide-links', !state.links);
      let shown = 0;
      for (const art of list.children) {
        let any = false;
        for (const o of art.querySelectorAll('.text.orig')) {
          const on = !!state.langs[o.dataset.lang];
          o.hidden = !on;
          any ||= on;
        }
        art.hidden = !any;
        if (any) shown++;
      }
      status.textContent = `Showing ${shown} of ${entries.length} comments`;
      try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
    }

    if (block.filters !== false) {
      const langBoxes = [...counts].map(([l, n]) =>
        checkbox(LANG_NAMES[l] || l, `(${n})`, state.langs[l], v => { state.langs[l] = v; apply(); }));
      const setAll = v => { langBoxes.forEach(b => (b.input.checked = v)); for (const l of counts.keys()) state.langs[l] = v; apply(); };
      const trans = checkbox('English translations', null, state.trans, v => { state.trans = v; apply(); });
      const meta  = checkbox('Citation details',    null, state.meta,  v => { state.meta  = v; apply(); });
      const links = checkbox('Links to originals',  null, state.links, v => { state.links = v; apply(); });

      sec.append(el('form', { class: 'filters', onsubmit: ev => ev.preventDefault() },
        el('fieldset', {}, el('legend', { text: 'Languages' }), langBoxes.map(b => b.label),
          el('span', { class: 'btns' },
            el('button', { type: 'button', text: 'All',  onclick: () => setAll(true) }),
            el('button', { type: 'button', text: 'None', onclick: () => setAll(false) }))),
        el('fieldset', {}, el('legend', { text: 'Show' }), trans.label, meta.label, links.label),
        status));
    }
    sec.append(list);
    apply();
    return sec;
  }

  /* ---------- page assembly ---------- */

  async function start() {
    const content = document.getElementById('content');
    try {
      const [site, page] = await Promise.all([
        getJSON('data/site.json').catch(() => null),
        getJSON(document.body.dataset.page)
      ]);
      renderNav(site);
      if (page.title) document.title = page.title;
      content.replaceChildren();
      for (const b of page.blocks) {
        if (b.type === 'citations') content.append(renderCitations(b, b.src ? await getJSON(b.src) : b));
        else content.append(el('section', { class: 'block', id: b.id, html: b.html }));
      }
      if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    } catch (err) {
      console.error(err);
      content.replaceChildren(el('p', { class: 'error',
        text: `Could not load page data (${err.message}). If you opened the file directly from disk, serve the folder instead, e.g. "python -m http.server".` }));
    }
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();