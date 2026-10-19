/**
 * Ener.co Warehouse Surplus — Google Drive ⇄ sale page sync (Google Apps Script)
 *
 * Runs under the Google account that owns the photo folders, every 5 minutes:
 *   Drive → site  New photos in the inbox folders become draft listings on surplus.html.
 *                 A loose photo = one listing (named after the file unless it's IMG_1234-style).
 *                 A sub-folder = one listing named after the folder; every photo in it goes
 *                 into that listing, including photos added to it later.
 *   Site → Drive  Photos uploaded directly on the site are copied into
 *                 "<first inbox>/From the sale site/<listing title>/", so Drive holds every photo.
 *
 * Setup (one time, about 3 minutes; see README "Google Drive photo sync"):
 *   1. script.google.com → New project → paste this file → Save.
 *   2. Run setup() once and approve the Drive + external-request permissions.
 *   That's it: setup() runs a first sync and installs the 5-minute trigger.
 */
const CONFIG = {
  FIREBASE: 'https://enerco-field-hub-default-rtdb.firebaseio.com/warehouse/surplus/',
  INBOX_FOLDERS: ['1hef2OTstGg7KqUptneVIFi3CoIcZUVB2', '18QWq6VE1So6Cmiero9rmCKuXqpa3lGNf'],
  BACKUP_FOLDER_NAME: 'From the sale site',
  FULL_PX: 1400,
  THUMB_PX: 480,
  MAX_PER_RUN: 40, // keeps each run well under Apps Script's 6-minute limit
};

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(5).create();
  sync();
}

function sync() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  const log = { imported: 0, appended: 0, backedUp: 0, pending: 0, errors: [] };
  try {
    const budget = { left: CONFIG.MAX_PER_RUN };
    importFromDrive(log, budget);
    backupToDrive(log, budget);
  } catch (e) {
    log.errors.push(String(e.message || e));
  } finally {
    log.errors = log.errors.slice(0, 5);
    fb('driveSync/status', 'put', Object.assign({ ts: Date.now() }, log));
    lock.releaseLock();
  }
}

/* ── Drive → site ─────────────────────────────────────────── */

function importFromDrive(log, budget) {
  const seen = fb('driveSync/seen') || {};        // Drive file id → item id
  const folders = fb('driveSync/folders') || {};  // Drive sub-folder id → item id
  for (const inboxId of CONFIG.INBOX_FOLDERS) {
    const inbox = DriveApp.getFolderById(inboxId);
    // Loose photos: one listing each.
    eachImage(inbox, file => {
      if (seen[file.getId()] || budget.left <= 0) return;
      const pic = fetchPhoto(file, log); if (!pic) return;
      const id = newItem(titleFromFile(file.getName()), [pic], file.getDescription());
      markSeen(file.getId(), id); log.imported++; budget.left--;
    });
    // Sub-folders: one listing per folder.
    const subs = inbox.getFolders();
    while (subs.hasNext()) {
      const sub = subs.next();
      if (sub.getName() === CONFIG.BACKUP_FOLDER_NAME) continue;
      const fresh = [];
      eachImage(sub, file => { if (!seen[file.getId()] && fresh.length < budget.left) fresh.push(file); });
      if (!fresh.length) continue;
      const pics = [], ids = [];
      fresh.forEach(f => { const p = fetchPhoto(f, log); if (p) { pics.push(p); ids.push(f.getId()); } });
      if (!pics.length) continue;
      let itemId = folders[sub.getId()];
      if (itemId && fb('items/' + itemId + '/id')) {
        const existing = fb('photos/' + itemId) || [];
        const all = existing.concat(pics.map(p => p.full));
        fb('photos/' + itemId, 'put', all);
        fb('items/' + itemId, 'patch', { photoCount: all.length, updated: Date.now() });
        log.appended += pics.length;
      } else {
        itemId = newItem(sub.getName(), pics, sub.getDescription());
        fb('driveSync/folders/' + sub.getId(), 'put', itemId);
        log.imported++;
      }
      ids.forEach(fid => markSeen(fid, itemId));
      budget.left -= pics.length;
    }
  }
}

function eachImage(folder, fn) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (/^image\//.test(f.getMimeType()) || /\.(heic|heif)$/i.test(f.getName())) fn(f);
  }
}

function newItem(title, pics, desc) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  fb('photos/' + id, 'put', pics.map(p => p.full));
  fb('items/' + id, 'put', {
    id, title: title || '', cat: 'equip', condition: 'Good', qty: 1, desc: desc || '', mode: 'fixed',
    status: 'draft', created: Date.now(), updated: Date.now(), thumb: pics[0].thumb,
    photoCount: pics.length, publicPrice: null, source: 'drive', addedBy: 'Google Drive',
  });
  return id;
}

function markSeen(fileId, itemId) { fb('driveSync/seen/' + fileId, 'put', itemId); }

// Drive renders every image type (HEIC included) as a JPEG thumbnail at any size we ask for,
// so photos arrive resized and in a format every browser can show.
function fetchPhoto(file, log) {
  try {
    const meta = JSON.parse(UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + file.getId() + '?fields=thumbnailLink&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getContentText());
    if (!meta.thumbnailLink) { log.pending++; return null; } // Drive is still processing it; next run
    const get = px => {
      const url = meta.thumbnailLink.replace(/=s\d+(-[a-z]+)?$/, '') + '=s' + px;
      const blob = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob();
      return 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes());
    };
    return { full: get(CONFIG.FULL_PX), thumb: get(CONFIG.THUMB_PX) };
  } catch (e) {
    log.errors.push(file.getName() + ': ' + (e.message || e));
    return null;
  }
}

function titleFromFile(name) {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return /^(img|dsc|pxl|photo|image|screenshot)\s*\d*/i.test(base) || /^[0-9a-f]{8}\s/i.test(base) ? '' : base;
}

/* ── Site → Drive ─────────────────────────────────────────── */

function backupToDrive(log, budget) {
  const items = fb('items') || {};
  const done = fb('driveSync/backup') || {}; // item id → { folder, count }
  let root = null;
  for (const id in items) {
    const it = items[id];
    if (!it || it.source === 'drive' || !it.photoCount) continue;
    const rec = done[id] || { count: 0 };
    const title = (it.title || 'Untitled ' + id).replace(/[\/\\]/g, '-');
    if (rec.folder && rec.count >= it.photoCount) {
      const f = DriveApp.getFolderById(rec.folder);
      if (f.getName() !== title) f.setName(title); // keep folder names in step with the listing
      continue;
    }
    if (budget.left <= 0) break;
    root = root || backupRoot();
    const folder = rec.folder ? DriveApp.getFolderById(rec.folder) : root.createFolder(title);
    const photos = fb('photos/' + id) || [];
    for (let i = rec.count; i < photos.length && budget.left > 0; i++, budget.left--) {
      const b64 = String(photos[i]).replace(/^data:image\/\w+;base64,/, '');
      const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', title + ' ' + (i + 1) + '.jpg'));
      fb('driveSync/seen/' + file.getId(), 'put', id); // never re-import our own backups
      rec.count = i + 1; log.backedUp++;
    }
    rec.folder = folder.getId();
    fb('driveSync/backup/' + id, 'put', rec);
  }
}

function backupRoot() {
  const inbox = DriveApp.getFolderById(CONFIG.INBOX_FOLDERS[0]);
  const it = inbox.getFoldersByName(CONFIG.BACKUP_FOLDER_NAME);
  return it.hasNext() ? it.next() : inbox.createFolder(CONFIG.BACKUP_FOLDER_NAME);
}

/* ── Firebase REST ────────────────────────────────────────── */

function fb(path, method, body) {
  const opts = { method: method || 'get', muteHttpExceptions: true, contentType: 'application/json' };
  if (body !== undefined) opts.payload = JSON.stringify(body);
  const r = UrlFetchApp.fetch(CONFIG.FIREBASE + path + '.json', opts);
  if (r.getResponseCode() >= 300) throw new Error('Firebase ' + r.getResponseCode() + ' on ' + path);
  return JSON.parse(r.getContentText() || 'null');
}
