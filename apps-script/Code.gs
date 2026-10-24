// THEOS-2 Mission Viewer — ที่เก็บข้อมูลร่วมกัน (Google Apps Script)
// เก็บข้อมูลเป็นไฟล์ JSON ใน Google Drive ของเจ้าของสคริปต์
const KEY  = 'เปลี่ยนเป็นรหัสลับของคุณ';   // ต้องตรงกับ SYNC_KEY ใน index.html
const FILE = 'theos2_shared.json';

function file_() {
  const it = DriveApp.getFilesByName(FILE);
  return it.hasNext() ? it.next()
    : DriveApp.createFile(FILE, '{"xml":{},"status":{},"geo":{}}', 'application/json');
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  if ((e.parameter.key || '') !== KEY) return out_({ error: 'forbidden' });
  return out_(JSON.parse(file_().getBlob().getDataAsString()));
}
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.key !== KEY) return out_({ error: 'forbidden' });
    const f = file_();
    const d = JSON.parse(f.getBlob().getDataAsString());
    d[b.kind] = d[b.kind] || {};
    if (b.value === null) delete d[b.kind][b.id]; else d[b.kind][b.id] = b.value;
    f.setContent(JSON.stringify(d));
    return out_({ ok: true });
  } finally { lock.releaseLock(); }
}
