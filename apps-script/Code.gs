/** THEOS-2 Mission Viewer — Google Drive record store (v2)
 * Each XML / status / GeoJSON record is stored as an individual JSON file.
 * The original theos2_shared.json is retained as a migration source/backup.
 */
const KEY = 'theos2-kuy8472'; // Must match SYNC_KEY in index.html. Client-side keys are public; do not treat as a secret.
const LEGACY_FILE = 'theos2_shared.json';
const ROOT_FOLDER = 'THEOS2_SHARED_RECORDS_V2';
const KINDS = ['xml', 'status', 'geo'];

function setup() {
  const root = getOrCreateFolder_(ROOT_FOLDER);
  KINDS.forEach(k => getOrCreateChildFolder_(root, k));
  migrateLegacy_();
  Logger.log('THEOS-2 shared store v2 is ready. Legacy JSON retained unchanged.');
}
function getOrCreateFolder_(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function getOrCreateChildFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function root_() { return getOrCreateFolder_(ROOT_FOLDER); }
function folder_(kind) {
  if (KINDS.indexOf(kind) < 0) throw new Error('invalid-kind');
  return getOrCreateChildFolder_(root_(), kind);
}
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function authorized_(key) { return !KEY || String(key || '') === KEY; }
function recordFile_(folder, id) {
  const name = Utilities.base64EncodeWebSafe(Utilities.newBlob(String(id), 'text/plain').getBytes()) + '.json';
  const it = folder.getFilesByName(name);
  return { name: name, file: it.hasNext() ? it.next() : null };
}
function readKind_(kind, sinceMs) {
  const result = {};
  let total = 0;
  const it = folder_(kind).getFiles();
  while (it.hasNext()) {
    const f = it.next(); total++;
    try {
      // Drive metadata avoids downloading unchanged record contents on incremental pulls.
      if (sinceMs && f.getLastUpdated().getTime() <= sinceMs) continue;
      const rec = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
      if (rec && rec.id != null && Object.prototype.hasOwnProperty.call(rec, 'value')) result[rec.id] = rec.value;
    } catch (err) { console.warn('Skipped unreadable record: ' + f.getName()); }
  }
  return { values: result, total: total };
}
function writeRecord_(kind, id, value) {
  const folder = folder_(kind), info = recordFile_(folder, id);
  const content = JSON.stringify({ id: String(id), value: value, updatedAt: new Date().toISOString() });
  if (info.file) info.file.setContent(content);
  else folder.createFile(info.name, content, 'application/json');
}
function migrateLegacy_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('THEOS2_V2_MIGRATED') === 'yes') return;
  const it = DriveApp.getFilesByName(LEGACY_FILE);
  if (it.hasNext()) {
    let legacy = {};
    try { legacy = JSON.parse(it.next().getBlob().getDataAsString('UTF-8')) || {}; }
    catch (err) { throw new Error('Legacy JSON cannot be parsed; original file was not changed.'); }
    KINDS.forEach(kind => {
      const values = legacy[kind] || {};
      Object.keys(values).forEach(id => {
        const existing = recordFile_(folder_(kind), id).file;
        if (!existing) writeRecord_(kind, id, values[id]);
      });
    });
  }
  props.setProperty('THEOS2_V2_MIGRATED', 'yes');
}
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!authorized_(p.key)) return out_({ error: 'forbidden' });
  try {
    migrateLegacy_();
    // Capture the cursor before reading. A small overlap protects against Drive timestamp granularity.
    const snapshotTime = Date.now();
    const requestedSince = p.since ? Number(p.since) : 0;
    const sinceMs = requestedSince ? Math.max(0, requestedSince - 5000) : 0;
    const x = readKind_('xml', sinceMs), s = readKind_('status', sinceMs), g = readKind_('geo', sinceMs);
    return out_({ ver: 2, full: !requestedSince, serverTime: snapshotTime, counts: { xml: x.total, status: s.total, geo: g.total }, xml: x.values, status: s.values, geo: g.values });
  } catch (err) { return out_({ error: 'read-failed', message: String(err.message || err) }); }
}
function applyOp_(op) {
  if (!op || KINDS.indexOf(op.kind) < 0 || op.id == null) throw new Error('invalid-operation');
  if (op.value === null) {
    const info = recordFile_(folder_(op.kind), op.id);
    if (info.file) info.file.setContent(JSON.stringify({ id: String(op.id), value: '__DELETED__', updatedAt: new Date().toISOString() }));
  } else {
    writeRecord_(op.kind, op.id, op.value);
  }
}
function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) return out_({ error: 'no-post-data' });
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const body = JSON.parse(e.postData.contents);
    if (!authorized_(body.key)) return out_({ error: 'forbidden' });
    migrateLegacy_();
    if (Array.isArray(body.ops)) {
      if (body.ops.length > 25) return out_({ error: 'batch-too-large', max: 25 });
      body.ops.forEach(applyOp_);
    } else {
      applyOp_({ kind: body.kind, id: body.id, value: body.value });
    }
    return out_({ ok: true, ver: 2 });
  } catch (err) {
    return out_({ error: 'write-failed', message: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
