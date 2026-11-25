/* Books — the Insights tab: quick stats, top authors and four simple charts, for This year / Last year / All time.
   Everything counts finished books, by their finish date. A book with several genres counts in each of them.
   Charts are plain HTML (no chart library, so they work offline); tap or hover a bar for its numbers.
   (Uses the helpers and state in app.js, which loads after this file; nothing here runs until app.js calls it.) */
'use strict';

const INS_SERIES = 5; // genres with their own colour in "Genres over time"; the rest are "Other"
const INS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let insPeriod = 'year';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

// The finished books in a period, and that period's columns for the time charts.
function insPeriodData(period) {
  const done = state.books.filter((b) => b.status === 'finished' && isISO(b.finish));
  const y = +today().slice(0, 4);
  if (period === 'all') {
    const first = done.reduce((m, b) => Math.min(m, +b.finish.slice(0, 4)), y);
    const cols = [];
    for (let k = first; k <= y; k++) cols.push({ key: String(k), label: String(k), long: String(k) });
    return { books: done, cols, colOf: (b) => b.finish.slice(0, 4), word: 'year', name: 'all time' };
  }
  const year = period === 'last' ? y - 1 : y;
  return {
    books: done.filter((b) => +b.finish.slice(0, 4) === year),
    cols: INS_MONTHS.map((m, i) => ({ key: `${year}-${String(i + 1).padStart(2, '0')}`, label: m[0], long: `${m} ${year}` })),
    colOf: (b) => b.finish.slice(0, 7), word: 'month', name: period === 'last' ? `in ${year}` : 'this year'
  };
}

// Horizontal bars: [{ label, value, text, tip }], longest first; scaled to `max`.
function hbars(rows, max) {
  return `<div class="hbars">${rows.map((r) => `<button type="button" class="hbar" data-tip="${esc(r.tip)}" aria-label="${esc(r.tip)}">
      <span class="hbar-label">${esc(r.label)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(2, (r.value / max) * 100)}%"></span></span>
      <span class="hbar-value">${esc(r.text)}</span>
    </button>`).join('')}</div>`;
}
// Vertical bars over time: cols [{ label, segs: [{ v, cls }], total, tip }]. Totals over the bars (only where > 0).
function vbars(cols, max) {
  return `<div class="vbars" style="--cols:${cols.length}">${cols.map((c) => `<button type="button" class="vbar" data-tip="${esc(c.tip)}" aria-label="${esc(c.tip)}">
      <span class="vbar-plot">
        ${c.total ? `<span class="vbar-num">${c.total}</span>` : ''}
        <span class="vbar-stack" style="height:${c.total ? Math.max(3, (c.total / max) * 100) : 0}%">${c.segs.filter((s) => s.v)
          .map((s) => `<span class="vseg ${s.cls}" style="flex-grow:${s.v}"></span>`).join('')}</span>
      </span>
      <span class="vbar-label">${esc(c.label)}</span>
    </button>`).join('')}</div>`;
}
const chartCard = (id, title, sub, body, tip) => `<section class="ins-card" id="${id}">
    <h3>${title}</h3>${sub ? `<div class="ins-sub">${sub}</div>` : ''}
    ${body}
    <div class="ins-tip" aria-live="polite">${tip || 'Tap a bar for its numbers.'}</div>
  </section>`;

function renderInsights() {
  const P = insPeriodData(insPeriod);
  const books = P.books;
  const filter = `<div class="seg sm ins-period" role="tablist" aria-label="Period">
    ${[['year', 'This year'], ['last', 'Last year'], ['all', 'All time']].map(([k, t]) => `<button type="button" data-period="${k}" class="${insPeriod === k ? 'on' : ''}" role="tab" aria-selected="${insPeriod === k}">${t}</button>`).join('')}
  </div>`;
  if (!books.length) {
    $('#books').innerHTML = `${filter}<div class="empty">No books finished ${P.name}.<br>Finished books (with their finish date) are counted here.</div>`;
    return;
  }

  /* Quick stats */
  const rated = books.filter((b) => b.rating);
  const avgRating = rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : null;
  const timed = books.filter((b) => isISO(b.start) && b.start <= b.finish);
  const avgDays = timed.length ? timed.reduce((s, b) => s + Math.round((dayDate(b.finish) - dayDate(b.start)) / 864e5) + 1, 0) / timed.length : null;
  const authors = new Map();
  for (const b of books) {
    const name = (b.author || '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    const a = authors.get(k) || { name, n: 0, r: [] };
    a.n++; if (b.rating) a.r.push(b.rating);
    authors.set(k, a);
  }
  const avg = (r) => (r.length ? r.reduce((s, x) => s + x, 0) / r.length : 0);
  const top = [...authors.values()].sort((a, b) => b.n - a.n || avg(b.r) - avg(a.r) || a.name.localeCompare(b.name)).slice(0, 5);
  const stats = `<div class="ins-stats">
      <div class="ins-stat"><div class="v">${books.length}</div><div class="l">${books.length === 1 ? 'book' : 'books'} finished</div></div>
      <div class="ins-stat"><div class="v">${avgRating == null ? '–' : `${fmt1(avgRating)}<small>★</small>`}</div><div class="l">average rating${rated.length && rated.length < books.length ? `<br>${rated.length} rated` : ''}</div></div>
      <div class="ins-stat"><div class="v">${avgDays == null ? '–' : Math.round(avgDays)}</div><div class="l">${avgDays == null ? 'days to finish<br>(add start dates)' : `days to finish${timed.length < books.length ? `<br>${plural(timed.length, 'book')} with dates` : ''}`}</div></div>
    </div>
    ${top.length ? `<section class="ins-card"><h3>Top authors</h3><ol class="ins-authors">${top.map((a) => `<li><span class="name">${esc(a.name)}</span><span class="n">${plural(a.n, 'book')}${a.r.length ? ` · ★${fmt1(avg(a.r))}` : ''}</span></li>`).join('')}</ol></section>` : ''}`;

  /* Books per genre, and favourite genres (average rating) */
  const perGenre = state.genres.map((g) => {
    const list = books.filter((b) => (b.genres || []).includes(g.id));
    const r = list.filter((b) => b.rating).map((b) => b.rating);
    return { g, n: list.length, r };
  }).filter((x) => x.n);
  const noGenre = books.filter((b) => !hasGenre(b)).length;
  const genreRows = perGenre.slice().sort((a, b) => b.n - a.n || a.g.name.localeCompare(b.g.name));
  const genreMax = Math.max(1, ...genreRows.map((x) => x.n));
  const tagLink = noGenre ? `<div class="ins-note">${plural(noGenre, 'book')} without a genre ${noGenre === 1 ? "isn't" : "aren't"} counted. <button type="button" class="link-btn sm" id="insTag">Tag my books ›</button></div>` : '';
  const perGenreCard = chartCard('insGenres', 'Books per genre', 'A book with more than one genre counts in each.',
    genreRows.length ? hbars(genreRows.map((x) => ({ label: x.g.name, value: x.n, text: String(x.n), tip: `${x.g.name}: ${plural(x.n, 'book')} ${P.name}` })), genreMax) + tagLink
      : `<div class="ins-empty">None of these books has a genre yet.</div>${tagLink}`);
  const favRows = perGenre.filter((x) => x.r.length).map((x) => ({ ...x, a: avg(x.r) })).sort((a, b) => b.a - a.a || b.r.length - a.r.length);
  const favCard = chartCard('insFav', 'Favourite genres', 'Average rating of the rated books in each genre (out of 5).',
    favRows.length ? hbars(favRows.map((x) => ({ label: x.g.name, value: x.a, text: `★${fmt1(x.a)}`, tip: `${x.g.name}: ★${fmt1(x.a)} average from ${plural(x.r.length, 'rated book')}` })), 5)
      : '<div class="ins-empty">No rated books with a genre yet.</div>');

  /* Books finished per month (or per year) */
  const count = new Map();
  for (const b of books) count.set(P.colOf(b), (count.get(P.colOf(b)) || 0) + 1);
  const perCol = P.cols.map((c) => ({ ...c, total: count.get(c.key) || 0 }));
  const colMax = Math.max(1, ...perCol.map((c) => c.total));
  const perMonthCard = chartCard('insMonths', `Books finished per ${P.word}`, '',
    vbars(perCol.map((c) => ({ label: c.label, total: c.total, segs: [{ v: c.total, cls: 'one' }], tip: `${c.long}: ${plural(c.total, 'book')} finished` })), colMax));

  /* Genres over time: your most-read genres (all time) keep their own colour whatever the period; the rest are Other */
  const allDone = state.books.filter((b) => b.status === 'finished' && isISO(b.finish));
  const series = state.genres.map((g) => ({ g, n: allDone.filter((b) => (b.genres || []).includes(g.id)).length }))
    .filter((x) => x.n).sort((a, b) => b.n - a.n || state.genres.indexOf(a.g) - state.genres.indexOf(b.g)).slice(0, INS_SERIES).map((x) => x.g.id);
  const tally = P.cols.map((c) => {
    const inCol = books.filter((b) => P.colOf(b) === c.key);
    const by = series.map((id) => inCol.filter((b) => (b.genres || []).includes(id)).length);
    const other = inCol.reduce((s, b) => s + (b.genres || []).filter((id) => genreById(id) && !series.includes(id)).length, 0);
    return { c, by, other, total: by.reduce((s, x) => s + x, 0) + other };
  });
  const stackMax = Math.max(1, ...tally.map((t) => t.total));
  const hasOther = tally.some((t) => t.other);
  const shown = series.filter((id, i) => tally.some((t) => t.by[i]));
  const legend = `<div class="ins-legend">${series.map((id, i) => (shown.includes(id) ? `<span><i class="vseg s${i + 1}"></i>${esc(genreById(id).name)}</span>` : '')).join('')}${hasOther ? '<span><i class="vseg other"></i>Other</span>' : ''}</div>`;
  const overTimeCard = chartCard('insOver', 'Genres over time', `Which genres you read each ${P.word}. A book counts once in each of its genres.`,
    tally.some((t) => t.total) ? legend + vbars(tally.map((t) => ({
      label: t.c.label, total: t.total,
      segs: [...t.by.map((v, i) => ({ v, cls: 's' + (i + 1) })), { v: t.other, cls: 'other' }],
      tip: t.total ? `${t.c.long}: ${[...series.map((id, i) => (t.by[i] ? `${genreById(id).name} ${t.by[i]}` : '')), t.other ? `Other ${t.other}` : ''].filter(Boolean).join(' · ')}` : `${t.c.long}: no genres`
    })), stackMax) : '<div class="ins-empty">None of these books has a genre yet.</div>');

  $('#books').innerHTML = filter + stats + perGenreCard + favCard + perMonthCard + overTimeCard;
}

// The period buttons, Tag my books, and tapping / hovering a bar to show its numbers under the chart.
function bindInsights() {
  const root = $('#books');
  const tip = (bar) => {
    const card = bar.closest('.ins-card');
    if (!card) return;
    card.querySelector('.ins-tip').textContent = bar.dataset.tip;
    card.querySelectorAll('.hbar, .vbar').forEach((x) => x.classList.toggle('sel', x === bar));
  };
  root.addEventListener('click', (e) => {
    if (view !== 'insights') return;
    const p = e.target.closest('[data-period]');
    if (p) { insPeriod = p.dataset.period; prefSet('insPeriod', insPeriod); return render(); }
    if (e.target.closest('#insTag')) return tagBooks();
    const bar = e.target.closest('.hbar, .vbar');
    if (bar) tip(bar);
  });
  root.addEventListener('pointerover', (e) => {
    if (view !== 'insights' || e.pointerType !== 'mouse') return;
    const bar = e.target.closest('.hbar, .vbar');
    if (bar) tip(bar);
  });
  insPeriod = prefGet('insPeriod', 'year');
}
