/* Rojak — memories photos: storage, reading the date a photo was taken, shrinking, and the photo backup file.
   (The collage on the home screen is core/memories.js.)

   Kept in the same on-phone database as everything else (IndexedDB, see store.js), but apart from the modules'
   data, so the main backup stays small and restoring a module never touches photos:
     'photos:index'   { items: [{ id, date: 'YYYY-MM-DD', takenAt (ISO or null), addedAt (ISO), savedAt, bytes }] }
     'photo:<id>'     { id, full: Blob (JPEG, longest side 1600px), thumb: Blob (JPEG, 480px) }
   "Delete all data" leaves photos alone; they have their own "Delete all photos" and "Back up photos".

   The photo backup is a .zip of plain JPEGs named by date (2026-11-15_1.jpg…) plus photos.json with each
   photo's date, so it opens like a folder on a computer and restores with "Restore photos". */
'use strict';

const Photos = (() => {
  const INDEX = 'photos:index';
  const FULL = 1600, THUMB = 480;
  let index = null;
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  async function load() {
    const saved = await dbGet(INDEX);
    index = saved && Array.isArray(saved.items) ? saved : { items: [] };
    return index;
  }
  const items = () => (index ? index.items : []);
  // A day's photos, in the order they were taken; photos without a time come after, in the order they were added.
  const onDay = (day) => items().filter((x) => x.date === day)
    .sort((a, b) => (!a.takenAt - !b.takenAt) || (a.takenAt || a.addedAt).localeCompare(b.takenAt || b.addedAt));
  const getPhoto = (id) => dbGet('photo:' + id);
  const saveIndex = () => dbSet(INDEX, index);
  const usage = () => ({ count: items().length, bytes: items().reduce((s, x) => s + (x.bytes || 0), 0) });

  /* ---------- When the photo was taken (EXIF, in JPEG files) ---------- */
  // Returns { date: 'YYYY-MM-DD', at: ISO-like local time } or null.
  async function takenDate(file) {
    try {
      const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
      if (buf.getUint16(0) !== 0xFFD8) return null; // not a JPEG
      let p = 2;
      while (p + 4 < buf.byteLength) {
        const marker = buf.getUint16(p), len = buf.getUint16(p + 2);
        if (marker === 0xFFE1 && buf.getUint32(p + 4) === 0x45786966) return readExif(buf, p + 10); // "Exif"
        if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break; // start of image data: no EXIF before it
        p += 2 + len;
      }
    } catch { /* no date */ }
    return null;
  }
  function readExif(v, tiff) {
    const le = v.getUint16(tiff) === 0x4949;
    const u16 = (o) => v.getUint16(tiff + o, le), u32 = (o) => v.getUint32(tiff + o, le);
    const ascii = (o, n) => { let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(tiff + o + i)); return s; };
    const tags = (ifd) => {
      const out = {}, n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        out[tag] = type === 2 ? ascii(count > 4 ? u32(e + 8) : e + 8, count) : u32(e + 8);
      }
      return out;
    };
    const ifd0 = tags(u32(4));
    const exif = ifd0[0x8769] ? tags(ifd0[0x8769]) : {};
    const s = exif[0x9003] || exif[0x9004] || ifd0[0x0132]; // taken, digitised, or the file's date
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    if (!m || m[1] === '0000') return null;
    return { date: `${m[1]}-${m[2]}-${m[3]}`, at: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}` };
  }

  /* ---------- Shrinking (turned the right way up) ---------- */
  async function decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* use an <img> */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function toJpeg(src, max, quality) {
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // transparent PNGs get a white background
    g.drawImage(src, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('could not shrink the photo'))), 'image/jpeg', quality));
  }

  // Adds photos (from the picker or the camera). `fallbackDay`: for photos with no date in their details.
  // Returns [{ id, date }] for the photos added (skips files that aren't pictures or can't be read).
  async function add(files, fallbackDay, onProgress) {
    if (!index) await load();
    const added = [];
    let i = 0;
    for (const file of files) {
      i++;
      if (onProgress) onProgress(i, files.length);
      if (file.type && !file.type.startsWith('image/')) continue;
      try {
        const when = await takenDate(file);
        const img = await decode(file);
        const full = await toJpeg(img, FULL, 0.82), thumb = await toJpeg(img, THUMB, 0.75);
        if (img.close) img.close();
        const id = newId(), now = new Date().toISOString();
        const item = { id, date: when ? when.date : fallbackDay, takenAt: when ? when.at : null, addedAt: now, savedAt: now, bytes: full.size + thumb.size };
        await dbSet('photo:' + id, { id, full, thumb });
        index.items.push(item);
        await saveIndex();
        added.push(item);
      } catch (err) { console.error('Photo not added:', err); }
    }
    return added;
  }
  async function remove(id) {
    if (!index) await load();
    await dbDel('photo:' + id);
    index.items = index.items.filter((x) => x.id !== id);
    await saveIndex();
  }
  async function removeAll() {
    const keys = (await dbKeys()).filter((k) => typeof k === 'string' && (k.startsWith('photo:') || k === INDEX));
    await dbDo('readwrite', (s) => { let r; for (const k of keys) r = s.delete(k); return r; });
    index = { items: [] };
    return keys.length - 1;
  }

  /* ---------- Photo backup: a .zip of JPEGs ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (bytes) => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  // A zip with every file stored as it is (JPEGs don't get smaller when zipped).
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), data = f.bytes, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h, name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(c, name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((s, x) => s + x.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  // Reads a zip (stored, or compressed when the browser can unzip): [{ name, bytes }].
  async function readZip(file) {
    const buf = new Uint8Array(await file.arrayBuffer()), v = new DataView(buf.buffer);
    let e = buf.length - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not a zip file');
    const n = v.getUint16(e + 10, true);
    let p = v.getUint32(e + 16, true);
    const out = [], dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip file');
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), at = v.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
      const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
      let bytes = buf.subarray(start, start + csize);
      if (method === 8) {
        if (!window.DecompressionStream) throw new Error('this zip is compressed and this browser can\'t unzip it');
        bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      } else if (method !== 0) throw new Error('unsupported zip file');
      out.push({ name, bytes });
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }

  // Makes the photo backup file: { blob, name, count }.
  async function backupFile(onProgress) {
    if (!index) await load();
    const all = [...items()].sort((a, b) => (a.date + (a.takenAt || a.addedAt)).localeCompare(b.date + (b.takenAt || b.addedAt)));
    const files = [], list = [], perDay = {};
    let i = 0;
    for (const x of all) {
      if (onProgress) onProgress(++i, all.length);
      const p = await getPhoto(x.id);
      if (!p || !p.full) continue;
      perDay[x.date] = (perDay[x.date] || 0) + 1;
      const name = `${x.date}_${perDay[x.date]}.jpg`;
      files.push({ name, bytes: new Uint8Array(await p.full.arrayBuffer()) });
      list.push({ id: x.id, file: name, date: x.date, takenAt: x.takenAt, addedAt: x.addedAt });
    }
    const manifest = { app: 'rojak-photos', version: 1, exportedAt: new Date().toISOString(), photos: list };
    files.push({ name: 'photos.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 1)) });
    return { blob: makeZip(files), name: `rojak-photos-${isoDay(new Date())}.zip`, count: list.length };
  }
  // Adds the photos from a photo backup; photos already on the phone are skipped. Returns { added, skipped }.
  async function restoreFile(file, onProgress) {
    if (!index) await load();
    const entries = await readZip(file);
    const m = entries.find((x) => x.name === 'photos.json');
    if (!m) throw new Error('not a Rojak photo backup');
    const manifest = JSON.parse(new TextDecoder().decode(m.bytes));
    if (manifest.app !== 'rojak-photos' || !Array.isArray(manifest.photos)) throw new Error('not a Rojak photo backup');
    const byName = new Map(entries.map((x) => [x.name, x.bytes]));
    const have = new Set(items().map((x) => x.id));
    let added = 0, skipped = 0, i = 0;
    for (const ph of manifest.photos) {
      if (onProgress) onProgress(++i, manifest.photos.length);
      const bytes = byName.get(ph.file);
      if (!bytes || !ph.id || !/^\d{4}-\d{2}-\d{2}$/.test(ph.date || '')) continue;
      if (have.has(ph.id)) { skipped++; continue; }
      try {
        const full = new Blob([bytes], { type: 'image/jpeg' });
        const img = await decode(full);
        const thumb = await toJpeg(img, THUMB, 0.75);
        if (img.close) img.close();
        await dbSet('photo:' + ph.id, { id: ph.id, full, thumb });
        index.items.push({ id: ph.id, date: ph.date, takenAt: ph.takenAt || null, addedAt: ph.addedAt || new Date().toISOString(), savedAt: new Date().toISOString(), bytes: full.size + thumb.size });
        have.add(ph.id);
        added++;
      } catch (err) { console.error('Photo not restored:', err); }
    }
    await saveIndex();
    return { added, skipped };
  }

  return { load, items, onDay, getPhoto, add, remove, removeAll, usage, backupFile, restoreFile, takenDate };
})();
