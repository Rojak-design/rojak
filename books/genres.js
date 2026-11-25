/* Books — genres: the genre list, suggestions from Open Library subjects, the genre chips in forms, editing the
   list, and the "Tag my books" screen. (Uses the helpers and state in app.js, which loads after this file; nothing
   here runs until app.js calls it.)

   Saved in 'mod:books':
     genres:       [{ id, name }]   your genre list, in the order shown (the store dates each one)
     book.genres:  [genre id, …]    1–3 per book (ids, so renaming a genre changes it on every book)
   Books saved before genres existed have no `genres`: they count as "no genre yet". */
'use strict';

const MAX_GENRES = 3;
const DEFAULT_GENRES = [
  ['fiction', 'Fiction'], ['nonfiction', 'Non-fiction'], ['fantasy', 'Fantasy'], ['scifi', 'Sci-fi'], ['mystery', 'Mystery/Thriller'],
  ['romance', 'Romance'], ['historical', 'Historical'], ['literary', 'Literary'], ['selfhelp', 'Self-help'], ['business', 'Business'],
  ['biography', 'Biography/Memoir'], ['history', 'History'], ['science', 'Science'], ['philosophy', 'Philosophy'], ['poetry', 'Poetry']
].map(([id, name]) => ({ id, name }));

const genreById = (id) => (state.genres || []).find((g) => g.id === id);
// A book's genres that still exist, in the order of the genre list.
const bookGenres = (b) => (state.genres || []).filter((g) => (b.genres || []).includes(g.id));
const hasGenre = (b) => bookGenres(b).length > 0;

/* ---------- Suggestions from Open Library subjects ---------- */
// Words in Open Library's subjects that point to each starting genre (matched without caring about case).
const SUBJECT_HINTS = {
  fantasy: /fantasy|magic|wizard|witch|dragon|fairies|elves|sorcer/,
  scifi: /science fiction|sci-fi|space opera|space travel|dystopi|time travel|robot|extraterrestrial|aliens|cyberpunk|interplanetary/,
  mystery: /myster|detective|thriller|suspense|crime|murder|police procedural|espionage|spy stories|spies/,
  romance: /romance|love stories|love story|romantic/,
  historical: /historical fiction|fiction, historical|historical novel/,
  literary: /literary fiction|psychological fiction|domestic fiction|bildungsroman|classic/,
  selfhelp: /self-help|self help|personal development|self-actualization|self-improvement|motivation|happiness|success|habit/,
  business: /business|management|economics|entrepreneur|leadership|finance|marketing|investing|investment/,
  biography: /biograph|memoir|autobiograph/,
  history: /\bhistory\b|world war|civilization|ancient|medieval/,
  science: /\bscience\b|physics|biology|chemistry|astronomy|cosmology|evolution|neuroscience|mathematics|genetics/,
  philosophy: /philosoph|ethics|stoic|metaphysics|existentialism/,
  poetry: /poetry|poems|\bverse\b/
};
const NONFICTION = ['selfhelp', 'business', 'biography', 'history', 'science', 'philosophy'];
// Up to 3 genre ids for a book from its Open Library subjects: the most specific ones first, plus Fiction or
// Non-fiction when it's clear which. Genres you added yourself are suggested when their name is in a subject.
function suggestGenres(subjects) {
  const subs = (subjects || []).slice(0, 80).map((s) => String(s).toLowerCase());
  if (!subs.length) return [];
  const ids = new Set((state.genres || []).map((g) => g.id));
  const isFiction = subs.some((s) => /fiction|novel|stories|fairy tales/.test(s) && !/non-?fiction/.test(s));
  const hits = {};
  for (const [id, re] of Object.entries(SUBJECT_HINTS)) {
    if (!ids.has(id)) continue;
    let n = subs.filter((s) => re.test(s)).length;
    // History and science subjects on a novel mean a historical novel / sci-fi, not a history or science book.
    if (isFiction && NONFICTION.includes(id)) n = 0;
    if (!isFiction && ['historical', 'literary'].includes(id)) n = 0;
    if (n) hits[id] = n;
  }
  if (isFiction && hits.history) hits.historical = (hits.historical || 0) + 1;
  for (const g of state.genres || []) {
    if (DEFAULT_GENRES.some((d) => d.id === g.id)) continue;
    const name = g.name.toLowerCase().trim();
    if (name.length > 2 && subs.some((s) => s.includes(name))) hits[g.id] = (hits[g.id] || 0) + 2;
  }
  const specific = Object.keys(hits).filter((id) => id !== 'fiction' && id !== 'nonfiction').sort((a, b) => hits[b] - hits[a]);
  const broad = isFiction ? 'fiction' : specific.some((id) => NONFICTION.includes(id)) || subs.some((s) => /non-?fiction/.test(s)) ? 'nonfiction' : null;
  const out = specific.slice(0, broad && ids.has(broad) ? MAX_GENRES - 1 : MAX_GENRES);
  if (broad && ids.has(broad)) out.push(broad);
  return out;
}
// A book's subjects from Open Library (for books already saved; new ones get them with the search).
async function fetchSubjects(olKey, signal) {
  if (!/^\/works\/OL\w+$/.test(olKey || '')) return [];
  const res = await fetch(`https://openlibrary.org${olKey}.json`, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.subjects) ? data.subjects : [];
}

/* ---------- Genre chips: tap 1–3 ---------- */
// Returns { get, set, suggest }. Suggested genres are ticked and labelled until you change them.
function genrePicker(root, selected, onChange) {
  let on = (selected || []).filter((id) => genreById(id));
  let suggested = new Set();
  const paint = () => {
    root.innerHTML = `<div class="genre-chips">${(state.genres || []).map((g) => `<button type="button" class="genre-chip ${on.includes(g.id) ? 'on' : ''} ${suggested.has(g.id) ? 'sug' : ''}" data-g="${esc(g.id)}" aria-pressed="${on.includes(g.id)}">${esc(g.name)}</button>`).join('')}</div>
      ${suggested.size ? '<div class="hint genre-hint">✨ Suggested from Open Library — tap to change</div>' : ''}`;
  };
  root.onclick = (e) => {
    const c = e.target.closest('.genre-chip');
    if (!c) return;
    const id = c.dataset.g;
    if (on.includes(id)) on = on.filter((x) => x !== id);
    else if (on.length >= MAX_GENRES) return toast(`Up to ${MAX_GENRES} genres — untick one first`);
    else on.push(id);
    suggested = new Set();
    paint();
    if (onChange) onChange(on);
  };
  paint();
  return {
    get: () => on.slice(),
    set: (ids) => { on = (ids || []).filter((id) => genreById(id)); suggested = new Set(); paint(); },
    // Ticks suggestions, but only while you haven't picked anything yourself.
    suggest: (ids) => { if (on.length || !ids.length) return; on = ids.slice(0, MAX_GENRES); suggested = new Set(on); paint(); },
    refresh: () => { on = on.filter((id) => genreById(id)); paint(); }
  };
}

/* ---------- Editing the genre list (over the sheet) ---------- */
let genresClosed = null;
function editGenres(onClose) {
  genresClosed = onClose || null;
  paintGenreList();
  $('#genreDlg').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function paintGenreList() {
  const used = (id) => state.books.filter((b) => (b.genres || []).includes(id)).length;
  $('#genreList').innerHTML = state.genres.map((g, i) => `<div class="genre-row" data-id="${esc(g.id)}">
      <input value="${esc(g.name)}" maxlength="30" aria-label="Genre name" data-rename>
      <span class="genre-used">${used(g.id) || ''}</span>
      <button type="button" class="icon-btn sm" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button type="button" class="icon-btn sm" data-down ${i === state.genres.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
      <button type="button" class="icon-btn sm del" data-remove aria-label="Remove ${esc(g.name)}">🗑</button>
    </div>`).join('') || '<div class="muted small">No genres. Add one below.</div>';
}
function closeGenres() {
  $('#genreDlg').classList.add('hidden');
  if ($('#sheet').classList.contains('hidden')) document.body.style.overflow = '';
  const f = genresClosed;
  genresClosed = null;
  if (f) f();
  render();
}
// The genre list's buttons (called from app.js once its helpers exist).
function bindGenreDialog() {
  $('#genreDlg').addEventListener('click', async (e) => {
    if (e.target.closest('[data-gclose]')) return closeGenres();
    const row = e.target.closest('.genre-row');
    if (!row) return;
    const i = state.genres.findIndex((g) => g.id === row.dataset.id);
    const g = state.genres[i];
    if (e.target.closest('[data-up]') && i > 0) [state.genres[i - 1], state.genres[i]] = [state.genres[i], state.genres[i - 1]];
    else if (e.target.closest('[data-down]') && i < state.genres.length - 1) [state.genres[i + 1], state.genres[i]] = [state.genres[i], state.genres[i + 1]];
    else if (e.target.closest('[data-remove]')) {
      const books = state.books.filter((b) => (b.genres || []).includes(g.id));
      if (!confirm(books.length ? `Remove “${g.name}”? It's on ${books.length} book${books.length > 1 ? 's' : ''} — it will be taken off ${books.length > 1 ? 'them' : 'it'} (nothing else changes).` : `Remove “${g.name}”?`)) return;
      state.genres.splice(i, 1);
      for (const b of books) b.genres = b.genres.filter((x) => x !== g.id);
      toast(`Removed “${g.name}”`);
    } else return;
    await save();
    paintGenreList();
  });
  // Renaming saves when you leave the box.
  $('#genreDlg').addEventListener('change', async (e) => {
    if (!e.target.matches('[data-rename]')) return;
    const g = genreById(e.target.closest('.genre-row').dataset.id);
    const name = e.target.value.trim().replace(/\s+/g, ' ');
    if (!name) { e.target.value = g.name; return toast("A genre needs a name"); }
    if (state.genres.some((x) => x !== g && x.name.toLowerCase() === name.toLowerCase())) { e.target.value = g.name; return toast(`There's already a “${name}”`); }
    if (name === g.name) return;
    g.name = name;
    await save();
    toast('Renamed');
  });
  $('#genreAdd').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#genreNew').value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (state.genres.some((x) => x.name.toLowerCase() === name.toLowerCase())) return toast(`There's already a “${name}”`);
    state.genres.push({ id: uid(), name });
    $('#genreNew').value = '';
    await save();
    paintGenreList();
    $('#genreList').lastElementChild.scrollIntoView({ block: 'nearest' });
  });
}

/* ---------- Tag my books: books without a genre, one at a time ---------- */
let tagAbort = null;
// Newest first: books you've finished (newest finish), then reading, then want to read.
function untagged() {
  const order = { finished: 0, reading: 1, want: 2 };
  return state.books.filter((b) => !hasGenre(b))
    .sort((a, b) => order[a.status] - order[b.status] || (b.finish || b.start || b.date || '').localeCompare(a.finish || a.start || a.date || ''));
}
function tagBooks() {
  const queue = untagged().map((b) => b.id);
  let i = 0, tagged = 0;
  const show = () => {
    if (tagAbort) tagAbort.abort();
    while (i < queue.length && (!byId(queue[i]) || hasGenre(byId(queue[i])))) i++;
    if (i >= queue.length) {
      openSheet('Tag my books', `<div class="empty">${tagged ? `🎉 ${tagged} book${tagged > 1 ? 's' : ''} tagged.` : 'Nothing tagged this time.'}<br>${untagged().length ? `${untagged().length} still without a genre (the ones you skipped).` : 'Every book has a genre.'}</div>
        <button class="btn" type="button" data-close>Done</button>`);
      return;
    }
    const b = byId(queue[i]);
    openSheet('Tag my books', `
      <div class="tag-count muted small">${i + 1} of ${queue.length}</div>
      <div class="detail">
        ${coverHtml(b, 'lg')}
        <div class="detail-title">${esc(b.title)}</div>
        ${b.author ? `<div class="book-author">${esc(b.author)}</div>` : ''}
      </div>
      <div class="label-t tag-label">Genres <span class="hint">(1–3)</span> <button type="button" class="link-btn sm" id="tEdit">Edit genres ›</button></div>
      <div id="tGenres"></div>
      <div class="tag-btns">
        <button class="btn secondary" type="button" id="tSkip">Skip</button>
        <button class="btn" type="button" id="tNext">${i + 1 < queue.length ? 'Save & next ›' : 'Save'}</button>
      </div>
      <button class="link-btn" type="button" data-close>Done for now</button>`);
    const picker = genrePicker($('#tGenres'), []);
    $('#tEdit').addEventListener('click', () => editGenres(() => picker.refresh()));
    $('#tSkip').addEventListener('click', () => { i++; show(); });
    $('#tNext').addEventListener('click', async () => {
      const ids = picker.get();
      if (!ids.length) return toast('Tap a genre, or Skip');
      b.genres = ids;
      tagged++;
      await save();
      render();
      i++;
      show();
    });
    if (b.olKey && navigator.onLine !== false) {
      tagAbort = new AbortController();
      const ask = tagAbort;
      fetchSubjects(b.olKey, ask.signal).then((subs) => { if (!ask.signal.aborted && $('#tGenres')) picker.suggest(suggestGenres(subs)); }).catch(() => {});
    }
  };
  show();
}
