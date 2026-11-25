/* Books — books you want to read, are reading and have finished, stored on this device in the shared Rojak store.

   Saved under 'mod:books' (see ../core/store.js). Every entry has a date (YYYY-MM-DD), and the store adds
   `savedAt` / `updatedAt`:
     books: { id, title, author, status: 'want' | 'reading' | 'finished', start (YYYY-MM-DD or ''), finish (YYYY-MM-DD
              or '', set when finished), rating (1–5 or null), notes, date (the day it was added),
              olKey (Open Library work, e.g. '/works/OL45883W', or null), coverId (Open Library cover id or null),
              hasCover (true when a cover picture is saved on the phone) }
   Cover pictures are kept in the same on-phone database (IndexedDB) under 'bookcover:<book id>' as small JPEGs
   (longest side 400px): covers picked from Open Library are downloaded there so they show offline, and photos you
   take or upload are shrunk first. Like Memories photos they aren't in the main backup, which stays small; an
   Open Library cover still shows from its link (coverId) when the picture isn't on the phone.

   Searching sends only what you type to Open Library (openlibrary.org, free, no key). */
'use strict';

/* ---------- State ---------- */
const emptyState = () => ({ books: [], settings: {} }); // + genres (see genres.js)
let state = emptyState();

async function load() {
  const saved = await Rojak.load('books');
  state = Object.assign(emptyState(), saved || {});
  if (!Array.isArray(state.books)) state.books = [];
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  // The starting genre list, the first time this version opens (books themselves aren't changed).
  const newGenres = !Array.isArray(state.genres);
  if (newGenres) state.genres = DEFAULT_GENRES.map((g) => ({ ...g }));
  // As in Habits: saving the empty list first means the first book gets the real time it was saved.
  if (!saved || newGenres) await save();
  await loadCovers();
}
function save() {
  return Rojak.save('books', state).catch((err) => {
    console.error(err);
    toast('Could not save! Storage may be full.');
  });
}

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDay(new Date());
const dayDate = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
function niceDate(iso) {
  const d = dayDate(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
const byId = (id) => state.books.find((b) => b.id === id);

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

const STATUS = { want: 'Want to read', reading: 'Reading', finished: 'Finished' };

/* ---------- Stars ---------- */
const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></svg>';
const STAR_WORDS = ['', "Didn't like it", 'It was OK', 'Liked it', 'Really liked it', 'Loved it'];
// Small stars for display, e.g. on the list.
const miniStars = (n) => (n ? `<span class="stars mini" aria-label="${n} of 5 stars">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= n ? 'on' : 'off'}">${STAR_SVG}</span>`).join('')}</span>` : '');
// Stars you tap to rate. Tapping the star already chosen clears the rating. Returns { get, set }.
function starPicker(root, value, onChange) {
  let v = value || 0;
  root.innerHTML = [1, 2, 3, 4, 5].map((i) => `<button type="button" class="star" role="radio" data-v="${i}" aria-label="${i} star${i > 1 ? 's' : ''}">${STAR_SVG}</button>`).join('');
  const paint = (popTo) => $$('.star', root).forEach((b) => {
    const i = +b.dataset.v;
    b.classList.toggle('on', i <= v);
    b.setAttribute('aria-checked', String(i === v));
    // The stars up to the one tapped pop one after another.
    b.classList.remove('pop');
    if (popTo && i <= popTo) { void b.offsetWidth; b.querySelector('svg').style.animationDelay = `${(i - 1) * 40}ms`; b.classList.add('pop'); }
  });
  root.onclick = (e) => {
    const b = e.target.closest('.star');
    if (!b) return;
    v = +b.dataset.v === v ? 0 : +b.dataset.v;
    paint(v);
    if (onChange) onChange(v);
  };
  paint(0);
  return { get: () => v || null, set: (n) => { v = n || 0; paint(0); } };
}

/* ---------- Covers ---------- */
const COVER_MAX = 400;
const coverKey = (id) => 'bookcover:' + id;
const olCover = (coverId, size) => `https://covers.openlibrary.org/b/id/${encodeURIComponent(coverId)}-${size}.jpg`;
const coverUrls = new Map(); // book id → object URL of the picture saved on the phone

async function loadCovers() {
  for (const b of state.books) if (b.hasCover && !coverUrls.has(b.id)) {
    try {
      const blob = await dbGet(coverKey(b.id));
      if (blob instanceof Blob) coverUrls.set(b.id, URL.createObjectURL(blob));
    } catch (err) { console.error(err); }
  }
}
function setCoverUrl(id, blob) {
  if (coverUrls.has(id)) URL.revokeObjectURL(coverUrls.get(id));
  if (blob) coverUrls.set(id, URL.createObjectURL(blob)); else coverUrls.delete(id);
}
// A plain cover's colour, picked from the title so each book keeps its own.
function plainColour(title) {
  let h = 0;
  for (const c of String(title || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 38% 42%)`;
}
// A cover: the picture if there is one (saved on the phone, otherwise Open Library's), over a plain coloured
// cover with the title (shown when there's no picture or it can't load, e.g. offline).
function coverHtml(b, cls = '', url) {
  const src = url || coverUrls.get(b.id) || (b.coverId ? olCover(b.coverId, 'M') : '');
  return `<div class="cover plain ${cls}" style="background:${plainColour(b.title)}"><span>${esc(b.title)}</span>${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>`;
}

// Shrinks a picture (turned the right way up) to a small JPEG.
async function decode(blob) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* use an <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
async function shrink(blob, max = COVER_MAX) {
  const img = await decode(blob);
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  if (img.close) img.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('could not shrink the picture'))), 'image/jpeg', 0.8));
}
async function saveCover(book, blob) {
  await dbSet(coverKey(book.id), blob);
  setCoverUrl(book.id, blob);
  book.hasCover = true;
}
// Downloads an Open Library cover so it shows offline. If it can't be downloaded, its link is used instead.
async function downloadCover(book) {
  if (!book.coverId || book.hasCover) return;
  try {
    const res = await fetch(olCover(book.coverId, 'M') + '?default=false');
    if (!res.ok) return;
    const blob = await shrink(await res.blob());
    if (!byId(book.id) || book.hasCover) return; // deleted, or a photo was added meanwhile
    await saveCover(book, blob);
    await save();
    render();
  } catch (err) { console.warn('Cover not downloaded (its link is used instead):', err); }
}

/* ---------- Currently reading and Want to read: one row per book ---------- */
function bookRow(b) {
  const meta = b.status === 'finished' ? (b.finish ? `Finished ${niceDate(b.finish)}` : 'Finished')
    : b.status === 'reading' ? (b.start ? `Started ${niceDate(b.start)}` : 'Reading')
    : `Added ${niceDate(b.date)}`;
  // Actions (not the status — that's the heading the book is under).
  const quick = b.status === 'reading' ? `<button type="button" class="quick" data-finish="${b.id}">Mark as<br>finished</button>`
    : b.status === 'want' ? `<button type="button" class="quick" data-start="${b.id}">Start<br>reading</button>` : '';
  // Books you're reading or have read show their stars, which can be tapped to rate them right here.
  const rate = b.status === 'want' ? '' : `<div class="stars row-stars" data-rate="${b.id}" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5]
    .map((i) => `<button type="button" class="star ${i <= (b.rating || 0) ? 'on' : ''}" data-v="${i}" role="radio" aria-checked="${i === b.rating}" aria-label="${i} star${i > 1 ? 's' : ''}">${STAR_SVG}</button>`).join('')}</div>`;
  return `<div class="book" role="button" tabindex="0" data-open="${b.id}">
    ${coverHtml(b)}
    <div class="book-info">
      <div class="book-title">${esc(b.title)}</div>
      ${b.author ? `<div class="book-author">${esc(b.author)}</div>` : ''}
      ${rate}
      <div class="book-meta">${esc(meta)}</div>
    </div>
    ${quick}
  </div>`;
}
// The reading timeline: books you're reading at the top, then finished books by year and month (newest first),
// covers side by side within a month. Books you want to read are folded away at the bottom.
let wantOpen = false;
const monthName = (key) => new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, 1).toLocaleDateString(undefined, { month: 'long' });
const newestFinished = (a, b) => (b.finish || '').localeCompare(a.finish || '') || (b.updatedAt || '').localeCompare(a.updatedAt || '');
function timelineHtml(done) {
  if (!done.length) return `<div class="tl-empty">Books you finish appear here, on your reading timeline.</div>`;
  const years = new Map();
  for (const b of done.slice().sort(newestFinished)) {
    const y = b.finish.slice(0, 4), m = b.finish.slice(0, 7);
    if (!years.has(y)) years.set(y, new Map());
    const months = years.get(y);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(b);
  }
  return `<div class="timeline">${[...years].map(([y, months]) => {
    const n = [...months.values()].reduce((s, l) => s + l.length, 0);
    return `<section class="tl-year">
      <h3 class="tl-year-h"><span>${y}</span><small>${n} book${n === 1 ? '' : 's'}</small></h3>
      ${[...months].map(([m, list]) => `<div class="tl-month">
        <div class="tl-month-h">${esc(monthName(m))}<small> · ${list.length}</small></div>
        <div class="tl-covers">${list.map((b) => `<button type="button" class="tl-book" data-open="${b.id}" aria-label="${esc(b.title)}">
          ${coverHtml(b)}${miniStars(b.rating)}</button>`).join('')}</div>
      </div>`).join('')}
    </section>`;
  }).join('')}</div>`;
}
/* ---------- Tabs: Books (the timeline), Favourites and Insights (insights.js) ---------- */
let view = 'books';
// Small per-phone conveniences (not your data): the Favourites choices. Never required.
const prefGet = (k, d) => { try { const v = localStorage.getItem('rojak-books:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const prefSet = (k, v) => { try { localStorage.setItem('rojak-books:' + k, JSON.stringify(v)); } catch { /* not kept */ } };
function showView(v) {
  view = v;
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#fab').classList.toggle('hidden', v !== 'books');
  window.scrollTo(0, 0);
  render();
}
$('.tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b && b.dataset.view !== view) showView(b.dataset.view); });

/* ---------- Favourites: books rated 5★ (and 4★ when switched on) ---------- */
const fav = { four: prefGet('fav4', false), sort: prefGet('favSort', 'rating'), genre: prefGet('favGenre', '') };
function renderFavourites() {
  const min = fav.four ? 4 : 5;
  const all = state.books.filter((b) => (b.rating || 0) >= min);
  // Only genres that some favourite has; a genre filter that no longer matches anything goes back to All.
  const genres = state.genres.filter((g) => all.some((b) => (b.genres || []).includes(g.id)));
  if (fav.genre && !genres.some((g) => g.id === fav.genre)) fav.genre = '';
  const list = all.filter((b) => !fav.genre || (b.genres || []).includes(fav.genre));
  const byFinish = (a, b) => (b.finish || '').localeCompare(a.finish || '') || (b.updatedAt || '').localeCompare(a.updatedAt || '');
  list.sort(fav.sort === 'rating' ? (a, b) => b.rating - a.rating || byFinish(a, b) : byFinish);
  const g = genreById(fav.genre);
  $('#books').innerHTML = `
    <div class="fav-controls">
      <label class="switch"><input type="checkbox" id="fav4" ${fav.four ? 'checked' : ''}><span class="switch-ui"></span>Include 4★ books</label>
      <div class="seg sm" id="favSort" aria-label="Sort by">
        <button type="button" data-sort="rating" class="${fav.sort === 'rating' ? 'on' : ''}">★ Rating</button>
        <button type="button" data-sort="finish" class="${fav.sort === 'finish' ? 'on' : ''}">📅 Finish date</button>
      </div>
      ${genres.length ? `<div class="fav-genres" id="favGenres">
        <button type="button" class="genre-chip ${fav.genre ? '' : 'on'}" data-fg="">All</button>
        ${genres.map((x) => `<button type="button" class="genre-chip ${fav.genre === x.id ? 'on' : ''}" data-fg="${esc(x.id)}">${esc(x.name)}</button>`).join('')}
      </div>` : ''}
    </div>
    ${list.length ? `<div class="fav-count muted small">${list.length} ${list.length === 1 ? 'favourite' : 'favourites'}${g ? ` in ${esc(g.name)}` : ''}</div>
      <div class="fav-grid">${list.map((b) => `<button type="button" class="fav-book" data-open="${b.id}" aria-label="${esc(b.title)}, ${b.rating} stars">
        ${coverHtml(b)}${miniStars(b.rating)}<span class="fav-title">${esc(b.title)}</span></button>`).join('')}</div>`
    : `<div class="empty">${state.books.some((b) => b.rating) ? `No ${fav.four ? '4★ or 5★' : '5★'} books yet.` : 'No rated books yet.'}<br>Books you rate ${fav.four ? '4 or 5' : '5'} stars appear here.${fav.four ? '' : '<br>Switch on <strong>Include 4★ books</strong> to see more.'}</div>`}`;
}
$('#books').addEventListener('change', (e) => {
  if (e.target.id !== 'fav4') return;
  fav.four = e.target.checked; prefSet('fav4', fav.four); render();
});
$('#books').addEventListener('click', (e) => {
  const s = e.target.closest('[data-sort]'), g = e.target.closest('[data-fg]');
  if (s) { fav.sort = s.dataset.sort; prefSet('favSort', fav.sort); render(); }
  if (g) { fav.genre = g.dataset.fg; prefSet('favGenre', fav.genre); render(); }
});

function render() {
  const books = state.books;
  const year = today().slice(0, 4), month = today().slice(0, 7);
  const done = books.filter((b) => b.status === 'finished' && isISO(b.finish));
  const thisYear = done.filter((b) => b.finish.startsWith(year)).length;
  const thisMonth = done.filter((b) => b.finish.startsWith(month)).length;
  $('#summaryLine').textContent = books.length ? `${thisMonth} finished this month · ${thisYear} this year` : '';
  if (view === 'favourites') return renderFavourites();
  if (view === 'insights') return renderInsights();
  if (!books.length) {
    $('#books').innerHTML = `<div class="empty">No books yet.<br>Tap <strong>+</strong> to search for a book by its title or author.</div>`;
    return;
  }
  const reading = books.filter((b) => b.status === 'reading').sort((a, b) => (b.start || b.date).localeCompare(a.start || a.date));
  const want = books.filter((b) => b.status === 'want').sort((a, b) => b.date.localeCompare(a.date) || (b.savedAt || '').localeCompare(a.savedAt || ''));
  const noGenre = books.filter((b) => !hasGenre(b)).length;
  $('#books').innerHTML = `
    ${noGenre ? `<button type="button" class="tag-cta" id="tagCta"><span>🏷 <strong>Tag my books</strong></span><span class="muted">${noGenre} without a genre ›</span></button>` : ''}
    <h2 class="group-h">Currently reading${reading.length ? ` · ${reading.length}` : ''}</h2>
    ${reading.length ? reading.map(bookRow).join('') : `<div class="tl-empty">Nothing on the go. Pick a book from <strong>Want to read</strong> below, or tap <strong>+</strong>.</div>`}
    <h2 class="group-h">Reading timeline</h2>
    ${timelineHtml(done)}
    ${want.length ? `<details class="want-list" ${wantOpen ? 'open' : ''}><summary>Want to read · ${want.length}</summary>${want.map(bookRow).join('')}</details>` : ''}`;
  const w = $('.want-list');
  if (w) w.addEventListener('toggle', () => { wantOpen = w.open; });
}

/* ---------- One book's details ---------- */
function bookDetails(b) {
  const days = b.start && b.finish ? Math.round((dayDate(b.finish) - dayDate(b.start)) / 864e5) + 1 : null;
  const dates = [b.start && `Started ${niceDate(b.start)}`, b.status === 'finished' && b.finish && `Finished ${niceDate(b.finish)}`,
    days && `${days} day${days === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || `Added ${niceDate(b.date)}`;
  openSheet('', `
    <div class="detail">
      ${coverHtml(b, 'xl')}
      <div class="detail-title">${esc(b.title)}</div>
      ${b.author ? `<div class="book-author">${esc(b.author)}</div>` : ''}
      <span class="status-chip ${b.status}">${STATUS[b.status]}</span>
      ${hasGenre(b) ? `<div class="genre-tags">${bookGenres(b).map((g) => `<span>${esc(g.name)}</span>`).join('')}</div>` : ''}
      ${b.status === 'want' ? '' : `<div class="stars big" id="dStars"></div><div class="star-word" id="dWord"></div>`}
      <div class="muted small">${esc(dates)}</div>
      ${b.notes ? `<div class="detail-notes">${esc(b.notes)}</div>` : ''}
    </div>
    <div class="form" style="margin-top:16px">
      ${b.status === 'reading' ? '<button class="btn" type="button" id="dFinish">Mark as finished</button>' : ''}
      ${b.status === 'want' ? '<button class="btn" type="button" id="dStart">Start reading</button>' : ''}
      <button class="btn secondary" type="button" id="dEdit">✏️ Edit details</button>
    </div>`);
  if (b.status !== 'want') {
    const word = (n) => { $('#dWord').textContent = n ? STAR_WORDS[n] : 'Tap to rate'; };
    word(b.rating);
    starPicker($('#dStars'), b.rating, async (n) => { b.rating = n || null; word(n); await save(); render(); });
  }
  $('#dEdit').addEventListener('click', () => bookForm(b));
  if ($('#dFinish')) $('#dFinish').addEventListener('click', async () => {
    const r = await askFinish(b, b.finish, b.rating);
    if (!r) return;
    Object.assign(b, { status: 'finished', finish: r.finish, rating: r.rating });
    await save(); render(); bookDetails(b);
    toast(`Finished “${b.title}”`);
  });
  if ($('#dStart')) $('#dStart').addEventListener('click', async () => {
    Object.assign(b, { status: 'reading', start: b.start || today() });
    await save(); render(); bookDetails(b);
    toast(`Started “${b.title}”`);
  });
}
$('#books').addEventListener('click', async (e) => {
  const f = e.target.closest('[data-finish]'), s = e.target.closest('[data-start]'), o = e.target.closest('[data-open]');
  const star = e.target.closest('[data-rate] .star');
  if (star) {
    // Tap a star to rate; tap the chosen star again to clear the rating.
    const b = byId(star.parentNode.dataset.rate), n = +star.dataset.v;
    b.rating = b.rating === n ? null : n;
    await save(); render();
    const row = $(`[data-rate="${b.id}"]`);
    if (row && b.rating) $$('.star', row).slice(0, b.rating).forEach((x, i) => { x.querySelector('svg').style.animationDelay = `${i * 40}ms`; x.classList.add('pop'); });
    toast(b.rating ? `${STAR_WORDS[b.rating]} · ${b.rating} star${b.rating > 1 ? 's' : ''}` : 'Rating cleared');
  } else if (f) {
    const b = byId(f.dataset.finish);
    const r = await askFinish(b, b.finish, b.rating);
    if (!r) return;
    Object.assign(b, { status: 'finished', finish: r.finish, rating: r.rating });
    await save(); render();
    toast(`Finished “${b.title}”`);
  } else if (s) {
    const b = byId(s.dataset.start);
    Object.assign(b, { status: 'reading', start: b.start || today() });
    await save(); render();
    toast(`Started “${b.title}”`);
  } else if (o) bookDetails(byId(o.dataset.open));
});
$('#books').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.book[data-open]')) { e.preventDefault(); bookDetails(byId(e.target.dataset.open)); }
});

/* ---------- Sheet ---------- */
function openSheet(title, html) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.remove('hidden');
  $('.sheet-panel').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  document.body.style.overflow = '';
  if (searchAbort) searchAbort.abort();
  if (updateReady) location.reload();
}
// When a new version of the app arrives, reload to use it — but not while a form is open.
let updateReady = false;
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if ($('#sheet').classList.contains('hidden')) location.reload(); else updateReady = true;
  });
}
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#genreDlg').classList.contains('hidden')) closeGenres();
  else if (!$('#finishDlg').classList.contains('hidden')) finishDone(null);
  else if (!$('#sheet').classList.contains('hidden')) closeSheet();
});
$('#fab').addEventListener('click', () => searchSheet());
$('#books').addEventListener('click', (e) => { if (e.target.closest('#tagCta')) tagBooks(); });
bindGenreDialog();
bindInsights();

/* ---------- Search (Open Library) ---------- */
let searchAbort = null, searchTimer = 0, lastQuery = '';
function searchSheet() {
  openSheet('Add a book', `
    <div class="form">
      <input type="search" id="q" placeholder="Title or author" autocomplete="off" enterkeyhint="search" aria-label="Search by title or author">
    </div>
    <div class="results" id="results"><div class="result-msg">Search Open Library by title or author.</div></div>
    <div class="manual-box">
      <div class="muted small">Can't find it?</div>
      <button type="button" class="link-btn" id="manualBtn">Type it in yourself ›</button>
    </div>`);
  lastQuery = '';
  const q = $('#q');
  q.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search(q.value), 450); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); search(q.value, true); q.blur(); } });
  $('#manualBtn').addEventListener('click', () => bookForm(null, { title: q.value.trim() }));
  setTimeout(() => q.focus(), 50);
}
let found = [];
async function search(text, again) {
  const query = text.trim();
  const box = $('#results');
  if (!box) return;
  if (query.length < 2) { box.innerHTML = '<div class="result-msg">Search Open Library by title or author.</div>'; lastQuery = ''; return; }
  if (query === lastQuery && !again) return;
  lastQuery = query;
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  box.innerHTML = '<div class="result-msg">Searching…</div>';
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key,title,author_name,first_publish_year,cover_i,subject&limit=20`;
    const res = await fetch(url, { signal: searchAbort.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (query !== lastQuery || !$('#results')) return;
    found = (data.docs || []).filter((d) => d.title).map((d) => ({
      title: d.title, author: (d.author_name || []).slice(0, 2).join(', '), year: d.first_publish_year || null,
      olKey: d.key || null, coverId: d.cover_i || null, subjects: Array.isArray(d.subject) ? d.subject : []
    }));
    box.innerHTML = found.length ? found.map((d, i) => `<button type="button" class="result" data-i="${i}">
        ${coverHtml(d, '', d.coverId ? olCover(d.coverId, 'M') : '')}
        <div class="book-info"><div class="book-title">${esc(d.title)}</div>
          <div class="book-author">${esc(d.author || 'Unknown author')}${d.year ? ` · ${d.year}` : ''}</div></div>
      </button>`).join('')
      : `<div class="result-msg">No books found for “${esc(query)}”.<br>Try fewer words, or type it in yourself below.</div>`;
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    if ($('#results')) $('#results').innerHTML = `<div class="result-msg">Couldn't reach Open Library${navigator.onLine === false ? ' (no internet)' : ''}.<br>Try again, or type the book in yourself below.</div>`;
  }
}
$('#sheetBody').addEventListener('click', (e) => {
  const r = e.target.closest('.result');
  if (!r) return;
  const d = found[+r.dataset.i];
  const same = state.books.find((b) => (d.olKey && b.olKey === d.olKey)
    || (b.title.toLowerCase() === d.title.toLowerCase() && (b.author || '').toLowerCase() === (d.author || '').toLowerCase()));
  if (same) { toast('Already in your books'); bookForm(same); return; }
  bookForm(null, d);
});

/* ---------- Finished: the date and the stars ---------- */
let finishResolve = null, finishStars = null;
// Asks when a book was finished (today unless changed) and how many stars it gets. Resolves to
// { finish, rating } or null if cancelled.
function askFinish(b, finish, rating) {
  $('#finishCover').innerHTML = coverHtml(b, 'lg', b.coverUrl);
  $('#finishBook').textContent = b.title + (b.author ? ` · ${b.author}` : '');
  $('#finishDate').value = finish || today();
  $('#finishDate').max = today();
  $('#finishWarn').classList.add('hidden');
  const word = (n) => { $('#finishWord').textContent = n ? STAR_WORDS[n] : 'Tap the stars to rate it (optional)'; };
  finishStars = starPicker($('#finishStars'), rating, word);
  word(rating);
  finishStart = b.start || '';
  $('#finishDlg').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  return new Promise((res) => { finishResolve = res; });
}
let finishStart = '';
function finishDone(result) {
  $('#finishDlg').classList.add('hidden');
  if ($('#sheet').classList.contains('hidden')) document.body.style.overflow = '';
  const r = finishResolve;
  finishResolve = null;
  if (r) r(result);
}
$('#finishDlg').addEventListener('click', (e) => { if (e.target.closest('[data-fclose]')) finishDone(null); });
$('#finishOk').addEventListener('click', () => {
  const d = $('#finishDate').value;
  const warn = (m) => { $('#finishWarn').textContent = m; $('#finishWarn').classList.remove('hidden'); };
  if (!isISO(d)) return warn('Pick the day you finished it.');
  if (d > today()) return warn("The finish date can't be in the future.");
  if (finishStart && d < finishStart) return warn(`That's before you started it (${niceDate(finishStart)}).`);
  finishDone({ finish: d, rating: finishStars.get() });
});

/* ---------- Book form: add or edit ---------- */
// `b`: a saved book to edit, or null to add one; `pre`: a book picked from the search ({ title, author, olKey,
// coverId }) or the title typed so far ({ title }).
function bookForm(b, pre = {}) {
  const ex = b;
  const v = ex ? { ...ex } : { title: pre.title || '', author: pre.author || '', olKey: pre.olKey || null, coverId: pre.coverId || null,
    status: 'want', start: '', finish: '', rating: null, notes: '' };
  const fromOL = !!v.olKey;
  let photo = null, photoUrl = null; // a new cover photo, saved with the book
  openSheet(ex ? 'Edit book' : 'Add a book', `
    <form class="form" id="bookForm" novalidate>
      <div class="cover-edit">
        <div id="coverPrev"></div>
        <div class="cover-btns">
          <button type="button" class="btn secondary" id="takePhoto">📷 Take a photo</button>
          <button type="button" class="btn secondary" id="choosePhoto">🖼 Choose a photo</button>
          <span class="hint">${fromOL ? 'The cover is from Open Library. Add a photo to use your own instead.' : 'Take or upload a photo of the cover (optional).'}</span>
        </div>
      </div>
      <label>Title <input id="bTitle" value="${esc(v.title)}" autocomplete="off" required></label>
      <label>Author <input id="bAuthor" value="${esc(v.author)}" autocomplete="off"></label>
      <div>
        <div class="label-t genre-label">Genres <span class="hint">(1–3)</span> <button type="button" class="link-btn sm" id="bEditGenres">Edit genres ›</button></div>
        <div id="bGenres"></div>
      </div>
      <div class="label-t">Status</div>
      <div class="seg" id="bStatus">${Object.entries(STATUS).map(([k, t]) => `<button type="button" data-s="${k}" class="${v.status === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="row2">
        <label id="startL">Started <input type="date" id="bStart" value="${esc(v.start)}" max="${today()}"></label>
        <label id="finishL">Finished <input type="date" id="bFinish" value="${esc(v.finish)}" max="${today()}"></label>
      </div>
      <div>
        <div class="label-t" style="margin-bottom:6px">Rating <span class="hint">(optional — tap a star again to clear)</span></div>
        <div class="stars" id="bStars"></div>
      </div>
      <label>Notes <textarea id="bNotes" placeholder="Thoughts, favourite quotes, who recommended it…">${esc(v.notes)}</textarea></label>
      <div class="warn-line hidden" id="bWarn"></div>
      <button class="btn" type="submit">${ex ? 'Save' : 'Add book'}</button>
      ${ex ? '<button class="btn danger" type="button" id="bDel">Delete book</button>' : ''}
    </form>`);

  const preview = () => { $('#coverPrev').innerHTML = coverHtml({ ...v, id: ex && ex.id, title: $('#bTitle').value || v.title }, 'lg', photoUrl); };
  preview();
  $('#bTitle').addEventListener('change', preview);
  const stars = starPicker($('#bStars'), v.rating);
  const genres = genrePicker($('#bGenres'), v.genres || []);
  // A book picked from the search: its Open Library subjects suggest genres (ticked, for you to confirm or change).
  if (!ex && pre.subjects) genres.suggest(suggestGenres(pre.subjects));
  $('#bEditGenres').addEventListener('click', () => editGenres(() => genres.refresh()));
  const showDates = () => {
    $('#startL').classList.toggle('hidden', v.status === 'want');
    $('#finishL').classList.toggle('hidden', v.status !== 'finished');
  };
  showDates();
  $('#bStatus').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-s]');
    if (!btn || btn.dataset.s === v.status) return;
    const s = btn.dataset.s;
    if (s === 'finished') {
      // Finishing asks for the day (today unless changed) and the stars.
      const r = await askFinish({ ...v, title: $('#bTitle').value || v.title, author: $('#bAuthor').value, start: $('#bStart').value, coverUrl: photoUrl }, $('#bFinish').value, stars.get());
      if (!r) return;
      $('#bFinish').value = r.finish;
      stars.set(r.rating);
    }
    if (s === 'reading' && !$('#bStart').value) $('#bStart').value = today();
    v.status = s;
    $$('#bStatus button').forEach((x) => x.classList.toggle('on', x.dataset.s === s));
    showDates();
  });

  const pick = (input) => {
    input.value = '';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        photo = await shrink(file);
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        photoUrl = URL.createObjectURL(photo);
        preview();
      } catch (err) { console.error(err); toast("Couldn't read that picture"); }
    };
    input.click();
  };
  $('#takePhoto').addEventListener('click', () => pick($('#coverCamera')));
  $('#choosePhoto').addEventListener('click', () => pick($('#coverFile')));

  $('#bookForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const warn = (m) => { $('#bWarn').textContent = m; $('#bWarn').classList.remove('hidden'); };
    const title = $('#bTitle').value.trim(), author = $('#bAuthor').value.trim();
    let start = v.status === 'want' ? '' : $('#bStart').value;
    let finish = v.status === 'finished' ? $('#bFinish').value : '';
    if (!title) return warn('Give the book a title.');
    if (start && !isISO(start)) start = '';
    if (v.status === 'finished' && !isISO(finish)) return warn('Pick the day you finished it.');
    if (start > today() || finish > today()) return warn("Dates can't be in the future.");
    if (start && finish && finish < start) return warn('The finish date is before the start date.');
    const data = { title, author, status: v.status, start, finish, rating: stars.get(), notes: $('#bNotes').value.trim(), genres: genres.get(), olKey: v.olKey || null, coverId: v.coverId || null };
    let book = ex;
    if (ex) Object.assign(ex, data);
    else { book = Object.assign({ id: uid(), date: today(), hasCover: false }, data); state.books.push(book); }
    if (photo) {
      try { await saveCover(book, photo); } catch (err) { console.error(err); toast("Couldn't save the photo — storage may be full"); }
    }
    await save();
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    closeSheet();
    render();
    toast(ex ? 'Saved' : `Added “${title}”`);
    downloadCover(book);
  });

  if (ex) $('#bDel').addEventListener('click', async () => {
    if (!confirm(`Delete “${ex.title}”? (Its cover and notes are deleted too.)`)) return;
    state.books = state.books.filter((x) => x.id !== ex.id);
    try { await dbDel(coverKey(ex.id)); } catch (err) { console.error(err); }
    setCoverUrl(ex.id, null);
    await save();
    closeSheet();
    render();
    toast('Book deleted');
  });
}

/* ---------- Start ---------- */
async function init() {
  try {
    await load();
  } catch (err) {
    console.error(err);
    $('#books').innerHTML = '<div class="empty">Could not open storage on this browser.</div>';
    return;
  }
  render();
  // Covers picked while offline are downloaded the next time the app opens.
  for (const b of state.books) if (b.coverId && !b.hasCover) downloadCover(b);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
}
init();
// Coming back to the app (e.g. on a new day) shows fresh numbers.
function refresh() { if ($('#sheet').classList.contains('hidden') && $('#finishDlg').classList.contains('hidden') && $('#genreDlg').classList.contains('hidden')) render(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });
