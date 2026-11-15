/* Rojak — daily memories collage at the bottom of the home screen (not a module). One day at a time, as a
   scrapbook grid; swipe or use ‹ › to move between days (it starts on today and doesn't go past today); tap the
   date to jump to any day. + adds photos (choose several, or take one); tap a photo to see it full screen, swipe
   through the day's photos, and delete. Photos are stored by core/photostore.js. */
'use strict';

const Memories = (() => {
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const dayDate = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const addDays = (iso, n) => { const d = dayDate(iso); d.setDate(d.getDate() + n); return isoDay(d); };
  const todayIso = () => isoDay(new Date());
  const label = (iso) => dayDate(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) +
    (iso.slice(0, 4) !== todayIso().slice(0, 4) ? ` ${iso.slice(0, 4)}` : '');
  const $m = (s) => document.querySelector(s);
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Scrapbook layouts on a 6-column grid: [columns, rows] for each photo, for 1 to 7 photos. More than 7 photos
  // repeat the layouts (e.g. 9 = the 7-photo layout, then the 2-photo one).
  const PATTERNS = {
    1: [[6, 4]],
    2: [[3, 4], [3, 4]],
    3: [[4, 4], [2, 2], [2, 2]],
    4: [[4, 3], [2, 3], [2, 3], [4, 3]],
    5: [[3, 4], [3, 2], [3, 2], [2, 2], [4, 2]],
    6: [[4, 4], [2, 2], [2, 2], [2, 2], [2, 2], [2, 2]],
    7: [[2, 2], [4, 4], [2, 2], [3, 3], [3, 3], [2, 2], [4, 2]]
  };
  function layout(n) {
    const out = [];
    while (out.length < n) { const k = Math.min(7, n - out.length); out.push(...PATTERNS[k]); }
    return out;
  }

  let day = todayIso();
  let urls = [];      // thumbnail links shown now (released when the day changes)
  let viewUrls = [];  // full-size links in the full-screen view

  async function render() {
    const box = $m('#memories');
    if (!box) return;
    const t = todayIso();
    if (day > t) day = t;
    const list = Photos.onDay(day);
    $m('#memDate').textContent = `📸 ${label(day)}`;
    $m('#memSub').textContent = list.length ? `${list.length} photo${list.length > 1 ? 's' : ''}` : day === t ? 'Today' : '';
    $m('#memNext').disabled = day >= t;
    $m('#memToday').classList.toggle('hidden', day === t);
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    const grid = $m('#memGrid');
    if (!list.length) {
      grid.className = 'mem-empty';
      grid.innerHTML = `<div class="mem-empty-art">🌤️</div><p>No photos for this day yet.<br>Add a few memories?</p>
        <button type="button" class="btn mem-add-big" data-add>+ Add photos</button>`;
      $m('#memAdd').classList.add('hidden');
    } else {
      grid.className = 'mem-grid';
      const sizes = layout(list.length);
      grid.innerHTML = list.map((x, i) => `<button type="button" class="mem-tile" data-i="${i}" style="grid-column:span ${sizes[i][0]};grid-row:span ${sizes[i][1]}"
        aria-label="Photo ${i + 1} of ${list.length}${x.takenAt ? `, taken ${new Date(x.takenAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}"></button>`).join('');
      $m('#memAdd').classList.remove('hidden');
      // Thumbnails load after the grid is in place.
      const stamp = day;
      for (const [i, x] of list.entries()) {
        const p = await Photos.getPhoto(x.id);
        if (stamp !== day) return; // moved to another day meanwhile
        const tile = grid.querySelector(`[data-i="${i}"]`);
        if (!p || !tile) continue;
        const u = URL.createObjectURL(p.thumb || p.full);
        urls.push(u);
        tile.innerHTML = `<img src="${u}" alt="" draggable="false">`;
      }
    }
  }
  function go(newDay) {
    const t = todayIso();
    day = newDay > t ? t : newDay;
    render();
  }

  /* ---------- Adding photos ---------- */
  function addMenu() {
    openSheet(`<div class="mem-menu">
        <button type="button" class="btn" id="memPick">🖼️ Choose photos</button>
        <button type="button" class="btn secondary" id="memCam">📷 Take a photo</button>
        <p class="muted small">Each photo goes on the day it was taken. Photos without a date go on ${label(day)}.</p>
      </div>`, 'Add photos');
    $m('#memPick').addEventListener('click', () => { closeSheet(); $m('#memFiles').click(); });
    $m('#memCam').addEventListener('click', () => { closeSheet(); $m('#memCamera').click(); });
  }
  async function addFiles(input) {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const shown = day;
    toast(`Adding ${files.length} photo${files.length > 1 ? 's' : ''}…`);
    const added = await Photos.add(files, shown, (i, n) => { if (n > 1) toast(`Adding photos… ${i} of ${n}`); });
    if (!added.length) { toast('Those photos couldn\'t be added'); return; }
    const elsewhere = added.filter((x) => x.date !== shown);
    const days = [...new Set(elsewhere.map((x) => x.date))];
    let msg = `${added.length} photo${added.length > 1 ? 's' : ''} added`;
    if (elsewhere.length) msg += days.length === 1 ? ` (${elsewhere.length} to ${label(days[0])})` : ` (${elsewhere.length} to other days)`;
    if (added.length < files.length) msg += ` · ${files.length - added.length} couldn't be read`;
    // Nothing landed on this day: show the day they went to.
    if (!added.some((x) => x.date === shown) && days.length === 1) day = days[0];
    await render();
    toast(msg);
    if (window.refreshPhotoInfo) refreshPhotoInfo();
  }

  /* ---------- Full screen ---------- */
  let viewList = [], viewAt = 0;
  async function openView(i) {
    viewList = Photos.onDay(day);
    viewAt = i;
    $m('#memView').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    await showView();
  }
  async function showView() {
    const x = viewList[viewAt];
    if (!x) return closeView();
    viewUrls.forEach((u) => URL.revokeObjectURL(u));
    viewUrls = [];
    const p = await Photos.getPhoto(x.id);
    const img = $m('#memViewImg');
    if (p) { const u = URL.createObjectURL(p.full || p.thumb); viewUrls.push(u); img.src = u; }
    const when = x.takenAt ? `${label(x.date)}, ${new Date(x.takenAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : `${label(x.date)} (no time in the photo's details)`;
    $m('#memViewInfo').textContent = `${when}${viewList.length > 1 ? ` · ${viewAt + 1} of ${viewList.length}` : ''}`;
    $m('#memViewPrev').classList.toggle('hidden', viewAt === 0);
    $m('#memViewNext').classList.toggle('hidden', viewAt >= viewList.length - 1);
  }
  function closeView() {
    $m('#memView').classList.add('hidden');
    document.body.style.overflow = '';
    $m('#memViewImg').removeAttribute('src');
    viewUrls.forEach((u) => URL.revokeObjectURL(u));
    viewUrls = [];
  }
  async function deleteShown() {
    const x = viewList[viewAt];
    if (!x || !confirm('Delete this photo from Rojak? (It stays in your phone\'s gallery.)')) return;
    await Photos.remove(x.id);
    viewList.splice(viewAt, 1);
    if (viewAt >= viewList.length) viewAt = viewList.length - 1;
    await render();
    if (window.refreshPhotoInfo) refreshPhotoInfo();
    toast('Photo deleted');
    if (!viewList.length) closeView(); else showView();
  }

  // Horizontal swipe on an element: calls fn(+1) for a swipe to the left (next), fn(-1) to the right.
  function onSwipe(el, fn) {
    let x0 = null, y0 = 0;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) fn(dx < 0 ? 1 : -1);
    });
  }
  function slide(k) {
    if (k > 0 && day >= todayIso()) return;
    const g = $m('#memGrid');
    if (!reduceMotion()) { g.classList.remove('slide-l', 'slide-r'); void g.offsetWidth; g.classList.add(k > 0 ? 'slide-l' : 'slide-r'); }
    go(addDays(day, k));
  }

  async function start() {
    const box = $m('#memories');
    if (!box) return;
    $m('#memPrev').addEventListener('click', () => slide(-1));
    $m('#memNext').addEventListener('click', () => slide(1));
    $m('#memToday').addEventListener('click', () => go(todayIso()));
    // Tap the date to jump to any day.
    const pick = $m('#memPickDate');
    $m('#memDateBtn').addEventListener('click', () => {
      pick.max = todayIso(); pick.value = day;
      if (pick.showPicker) { try { pick.showPicker(); return; } catch { /* fall back */ } }
      pick.focus(); pick.click();
    });
    pick.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(pick.value)) go(pick.value); });
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]') || e.target.closest('#memAdd')) return addMenu();
      const tile = e.target.closest('.mem-tile');
      if (tile) openView(+tile.dataset.i);
    });
    onSwipe($m('#memGrid'), slide);
    $m('#memFiles').addEventListener('change', (e) => addFiles(e.target));
    $m('#memCamera').addEventListener('change', (e) => addFiles(e.target));
    // Full screen
    $m('#memViewClose').addEventListener('click', closeView);
    $m('#memViewDel').addEventListener('click', deleteShown);
    $m('#memViewPrev').addEventListener('click', () => { if (viewAt > 0) { viewAt--; showView(); } });
    $m('#memViewNext').addEventListener('click', () => { if (viewAt < viewList.length - 1) { viewAt++; showView(); } });
    onSwipe($m('#memView'), (k) => { const n = viewAt + k; if (n >= 0 && n < viewList.length) { viewAt = n; showView(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$m('#memView').classList.contains('hidden')) closeView(); });
    // A new day while the app is open: today moves on (only if you were looking at today).
    let shownToday = todayIso();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const t = todayIso();
      if (t !== shownToday) { if (day === shownToday) day = t; shownToday = t; render(); }
    });
    try { await Photos.load(); } catch (err) { console.error(err); }
    render();
  }
  async function reload() { try { await Photos.load(); } catch (err) { console.error(err); } render(); }

  return { start, render, reload, go };
})();
