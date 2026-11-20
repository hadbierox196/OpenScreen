/**
 * OpenScreen sheet backend (Google Apps Script).
 * Setup: create a Google Sheet > Extensions > Apps Script > paste this file > run setup() once (authorise)
 * > Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone > copy the /exec URL.
 * Share the URL and the token (shown in the log / "OpenScreen" menu) with reviewers.
 *
 * Layout: sheet "Decisions" = one tidy row per record x reviewer (the clean CSV),
 *         sheet "Summary"   = one row per record, one column per reviewer, final + status.
 * Raw project/config/reviewer JSON lives in a Drive folder so the app can resync anywhere.
 */
var HEAD = ['Record #', 'Record ID', 'Title', 'Year', 'DOI', 'Reviewer', 'Reviewer ID', 'Decision', 'Reason', 'Note', 'Decided at'];
var NAME_OK = /^(project|config|reviewer-[A-Za-z0-9_-]+)\.json$/;

function setup() {
  var P = PropertiesService.getScriptProperties();
  if (!P.getProperty('TOKEN')) P.setProperty('TOKEN', Utilities.getUuid());
  if (!P.getProperty('FOLDER')) P.setProperty('FOLDER', DriveApp.createFolder('OpenScreen data').getId());
  var ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName('Decisions')) ss.insertSheet('Decisions').appendRow(HEAD);
  if (!ss.getSheetByName('Summary')) ss.insertSheet('Summary');
  Logger.log('TOKEN: ' + P.getProperty('TOKEN'));
}
function onOpen() { SpreadsheetApp.getUi().createMenu('OpenScreen').addItem('Show token', 'showToken').addItem('Rebuild summary', 'rebuildSummary').addToUi(); }
function showToken() { SpreadsheetApp.getUi().alert('Token: ' + PropertiesService.getScriptProperties().getProperty('TOKEN')); }

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function folder() { return DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER')); }
function find(name) { var it = folder().getFilesByName(name); return it.hasNext() ? it.next() : null; }

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var b = JSON.parse(e.postData.contents);
    if (b.token !== PropertiesService.getScriptProperties().getProperty('TOKEN')) return out({ ok: false, error: 'Wrong token' });
    lock.waitLock(20000);
    if (b.action === 'list') {
      var files = [], it = folder().getFiles();
      while (it.hasNext()) { var f = it.next(); if (NAME_OK.test(f.getName())) files.push({ name: f.getName(), modified: f.getLastUpdated().getTime() }); }
      return out({ ok: true, files: files });
    }
    if (b.action === 'get') {
      if (!NAME_OK.test(b.name)) return out({ ok: false, error: 'Bad name' });
      var g = find(b.name); return out(g ? { ok: true, content: g.getBlob().getDataAsString() } : { ok: false, error: 'Not found' });
    }
    if (b.action === 'put') {
      if (!NAME_OK.test(b.name) || typeof b.content !== 'string') return out({ ok: false, error: 'Bad request' });
      var h = find(b.name); if (h) h.setContent(b.content); else folder().createFile(b.name, b.content, 'application/json');
      var m = /^reviewer-(.+)\.json$/.exec(b.name);
      if (m && b.rows) { replaceRows(m[1], b.rows); rebuildSummary(); }
      return out({ ok: true });
    }
    return out({ ok: false, error: 'Unknown action' });
  } catch (err) { return out({ ok: false, error: String(err) }); }
  finally { try { lock.releaseLock(); } catch (x) { /* not held */ } }
}

/** Replace every row of one reviewer (their file always holds their full current decisions). */
function replaceRows(rid, rows) {
  var sh = SpreadsheetApp.getActive().getSheetByName('Decisions') || SpreadsheetApp.getActive().insertSheet('Decisions');
  var all = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).getValues() : [];
  var keep = all.filter(function (r) { return String(r[6]) !== rid; });
  var next = keep.concat(rows.map(function (r) { return r.map(String); }));
  next.sort(function (a, b) { return (Number(a[0]) - Number(b[0])) || String(a[5]).localeCompare(String(b[5])); });
  sh.clearContents(); sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold'); sh.setFrozenRows(1);
  if (next.length) sh.getRange(2, 1, next.length, HEAD.length).setNumberFormat('@').setValues(next);
}

/** Wide view: one row per record, a column per reviewer, then Final and Status. */
function rebuildSummary() {
  var ss = SpreadsheetApp.getActive(), d = ss.getSheetByName('Decisions'), s = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  var rows = d && d.getLastRow() > 1 ? d.getRange(2, 1, d.getLastRow() - 1, HEAD.length).getValues() : [];
  var names = [], by = {}, order = [];
  rows.forEach(function (r) {
    var n = String(r[0]); if (names.indexOf(r[5]) < 0) names.push(r[5]);
    if (!by[n]) { by[n] = { title: r[2], year: r[3], doi: r[4], v: {} }; order.push(n); }
    by[n].v[r[5]] = r[7];
  });
  var head = ['Record #', 'Title', 'Year', 'DOI'].concat(names, ['Final', 'Status']);
  var body = order.map(function (n) {
    var o = by[n], vs = names.map(function (x) { return o.v[x] || ''; }), got = vs.filter(String);
    var same = got.length > 0 && got.every(function (x) { return x === got[0]; });
    return [n, o.title, o.year, o.doi].concat(vs, [same ? got[0] : '', got.length < 2 ? 'single' : same ? 'agree' : 'CONFLICT']);
  });
  s.clearContents(); s.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); s.setFrozenRows(1);
  if (body.length) s.getRange(2, 1, body.length, head.length).setNumberFormat('@').setValues(body);
}
