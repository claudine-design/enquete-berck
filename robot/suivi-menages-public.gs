// =============================================
// SUIVI MENAGES BERCK — backend du tuto menage (checklist QR code)
// Projet Apps Script separe (compte princessedopale) — 19/09/2026
// =============================================
// Recoit depuis le telephone du prestataire (GET ou POST JSON text/plain) :
//   start   : debut de menage (heure prise par le telephone)
//   photo   : photo d'une etape (base64 JPEG) -> Drive + ligne Photos
//   fin     : fin de menage -> duree
//   modele  : photo modele prise par Claudine (cle obligatoire)
// Et sert :
//   modeles : photos modeles d'un appart (public, pour le prestataire)
//   suivi   : tous les menages des N derniers jours (cle obligatoire)
// Les heures viennent du telephone (champ "heure") : un envoi differe
// (cave sans reseau) garde la vraie heure.
// =============================================

var CLE_CLAUDINE = 'REMPLACER_PAR_LA_CLE';
var RACINE = 'Suivi menages Berck';
var HEAD_SESSIONS = ['ID', 'Appart', 'Prestataire', 'Debut', 'Fin', 'Duree min', 'Nb photos', 'Taches cochees', 'Total taches', 'Statut', 'Remarque'];
var HEAD_PHOTOS = ['Session', 'Appart', 'Prestataire', 'Etape', 'Libelle', 'Heure', 'FileId', 'Cle unique'];
var HEAD_MODELES = ['Appart', 'Etape', 'FileId', 'Date'];

// A lancer une fois : cree le classeur, les dossiers Drive, et demande les autorisations.
function installer() {
  var props = PropertiesService.getScriptProperties();
  var ss = getSS_();
  getFolder_('Menages');
  getFolder_('Photos modeles');
  installerPurge();
  Logger.log('OK classeur : ' + ss.getUrl());
  Logger.log('OK dossier : ' + getRoot_().getUrl());
  return ss.getUrl();
}

function doGet(e) { return handle_(e.parameter || {}); }
function doPost(e) {
  var p = {};
  var q = e.parameter || {};
  for (var k in q) p[k] = q[k];
  if (e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      for (var j in body) p[j] = body[j];
    } catch (err) {}
  }
  return handle_(p);
}

function handle_(p) {
  var lock = LockService.getScriptLock();
  try {
    var a = p.action;
    if (a === 'modeles') return json_(getModeles_(p.appart));
    if (a === 'ping') return json_({ ok: true });
    if (a === 'suivi') {
      if (p.cle !== CLE_CLAUDINE) return json_({ ok: false, error: 'cle' });
      return json_(getSuivi_(Number(p.jours) || 14));
    }
    lock.waitLock(20000);
    if (a === 'start') return json_(start_(p));
    if (a === 'photo') return json_(photo_(p));
    if (a === 'fin') return json_(fin_(p));
    if (a === 'modele') {
      if (p.cle !== CLE_CLAUDINE) return json_({ ok: false, error: 'cle' });
      return json_(modele_(p));
    }
    return json_({ ok: false, error: 'action inconnue' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// ---------- actions ----------

function start_(p) {
  if (!p.id || !p.appart || !p.presta) return { ok: false, error: 'id/appart/presta manquant' };
  var row = findSession_(p.id);
  var sh = sheet_('Sessions', HEAD_SESSIONS);
  if (row) {
    // deja cree (renvoi ou photo arrivee avant) : on complete le debut
    sh.getRange(row, 4).setValue(asDate_(p.heure));
    return { ok: true, id: p.id, deja: true };
  }
  sh.appendRow([p.id, p.appart, p.presta, asDate_(p.heure), '', '', 0, '', '', 'EN COURS', '']);
  return { ok: true, id: p.id };
}

function photo_(p) {
  if (!p.id || !p.etape || !p.file) return { ok: false, error: 'id/etape/file manquant' };
  var cle = p.id + '|' + p.etape + '|' + (p.heure || '');
  var shP = sheet_('Photos', HEAD_PHOTOS);
  var existing = findRow_(shP, 8, cle);
  if (existing) return { ok: true, deja: true, fileId: shP.getRange(existing, 7).getValue() };
  var row = findSession_(p.id);
  var shS = sheet_('Sessions', HEAD_SESSIONS);
  if (!row) {
    shS.appendRow([p.id, p.appart || '', p.presta || '', '', '', '', 0, '', '', 'EN COURS', 'photo recue avant le debut']);
    row = shS.getLastRow();
  }
  var h = asDate_(p.heure);
  var jour = Utilities.formatDate(h, 'Europe/Paris', 'yyyy-MM-dd');
  var dossier = sub_(sub_(getFolder_('Menages'), jour), (p.appart || 'appart') + ' - ' + (p.presta || '') + ' - ' + p.id);
  var ext = (p.mime && p.mime.indexOf('video') === 0) ? '.mp4' : '.jpg';
  var nom = p.etape + '_' + Utilities.formatDate(h, 'Europe/Paris', 'HH-mm-ss') + ext;
  var blob = Utilities.newBlob(Utilities.base64Decode(p.file), p.mime || 'image/jpeg', nom);
  var f = dossier.createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  shP.appendRow([p.id, p.appart || '', p.presta || '', p.etape, p.libelle || '', h, f.getId(), cle]);
  var nb = Number(shS.getRange(row, 7).getValue()) || 0;
  shS.getRange(row, 7).setValue(nb + 1);
  return { ok: true, fileId: f.getId() };
}

function fin_(p) {
  if (!p.id) return { ok: false, error: 'id manquant' };
  var sh = sheet_('Sessions', HEAD_SESSIONS);
  var row = findSession_(p.id);
  if (!row) {
    sh.appendRow([p.id, p.appart || '', p.presta || '', '', '', '', 0, '', '', 'EN COURS', 'fin recue avant le debut']);
    row = sh.getLastRow();
  }
  var fin = asDate_(p.heure);
  sh.getRange(row, 5).setValue(fin);
  var debut = sh.getRange(row, 4).getValue();
  if (debut instanceof Date) sh.getRange(row, 6).setValue(Math.round((fin - debut) / 60000));
  sh.getRange(row, 8).setValue(p.taches || '');
  sh.getRange(row, 9).setValue(p.total || '');
  sh.getRange(row, 10).setValue('TERMINE');
  if (p.remarque) sh.getRange(row, 11).setValue(p.remarque);
  return { ok: true };
}

function modele_(p) {
  if (!p.appart || !p.etape || !p.file) return { ok: false, error: 'appart/etape/file manquant' };
  var dossier = sub_(getFolder_('Photos modeles'), p.appart);
  var blob = Utilities.newBlob(Utilities.base64Decode(p.file), p.mime || 'image/jpeg', p.etape + '.jpg');
  var f = dossier.createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var sh = sheet_('Modeles', HEAD_MODELES);
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === p.appart && data[i][1] === p.etape) {
      try { DriveApp.getFileById(data[i][2]).setTrashed(true); } catch (e) {}
      sh.deleteRow(i + 1);
    }
  }
  sh.appendRow([p.appart, p.etape, f.getId(), new Date()]);
  return { ok: true, fileId: f.getId() };
}

function getModeles_(appart) {
  var sh = sheet_('Modeles', HEAD_MODELES);
  var data = sh.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < data.length; i++) {
    if (!appart || data[i][0] === appart) {
      if (!out[data[i][0]]) out[data[i][0]] = {};
      out[data[i][0]][data[i][1]] = data[i][2];
    }
  }
  return { ok: true, modeles: appart ? (out[appart] || {}) : out };
}

function getSuivi_(jours) {
  var limite = new Date(Date.now() - jours * 86400000);
  var s = sheet_('Sessions', HEAD_SESSIONS).getDataRange().getValues();
  var ph = sheet_('Photos', HEAD_PHOTOS).getDataRange().getValues();
  var sessions = [];
  var index = {};
  for (var i = 1; i < s.length; i++) {
    var d = s[i][3] instanceof Date ? s[i][3] : (s[i][4] instanceof Date ? s[i][4] : null);
    if (d && d < limite) continue;
    var o = {
      id: s[i][0], appart: s[i][1], presta: s[i][2],
      debut: s[i][3] instanceof Date ? s[i][3].toISOString() : '',
      fin: s[i][4] instanceof Date ? s[i][4].toISOString() : '',
      duree: s[i][5], nbPhotos: s[i][6], taches: s[i][7], total: s[i][8],
      statut: s[i][9], remarque: s[i][10], photos: []
    };
    index[o.id] = o;
    sessions.push(o);
  }
  for (var j = 1; j < ph.length; j++) {
    var o2 = index[ph[j][0]];
    if (!o2) continue;
    o2.photos.push({ etape: ph[j][3], libelle: ph[j][4], heure: ph[j][5] instanceof Date ? ph[j][5].toISOString() : '', fileId: ph[j][6] });
  }
  sessions.sort(function (a, b) { return (b.debut || b.fin) > (a.debut || a.fin) ? 1 : -1; });
  return { ok: true, sessions: sessions, modeles: getModeles_('').modeles };
}

// ---------- outils ----------

function getSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SS_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create('Suivi menages Berck');
  DriveApp.getFileById(ss.getId()).moveTo(getRoot_());
  props.setProperty('SS_ID', ss.getId());
  sheet_('Sessions', HEAD_SESSIONS, ss);
  sheet_('Photos', HEAD_PHOTOS, ss);
  sheet_('Modeles', HEAD_MODELES, ss);
  var def = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  return ss;
}

function sheet_(name, head, ss) {
  ss = ss || getSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#1f3b57').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getRoot_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ROOT_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(RACINE);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(RACINE);
  props.setProperty('ROOT_ID', f.getId());
  return f;
}

function getFolder_(name) { return sub_(getRoot_(), name); }

function sub_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function findSession_(id) { return findRow_(sheet_('Sessions', HEAD_SESSIONS), 1, id); }

function findRow_(sh, col, val) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var vals = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]) === String(val)) return i + 2;
  return 0;
}

function asDate_(s) {
  var d = s ? new Date(s) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Effacement automatique après 2 mois (décision Claudine 20/09/2026) ----------
// Photos, vidéos et lignes de suivi sont gardées 60 jours, puis supprimées (corbeille Drive).
var RETENTION_JOURS = 60;

function purgeAnciennes() {
  var limite = new Date(Date.now() - RETENTION_JOURS * 86400000);
  var shP = sheet_('Photos', HEAD_PHOTOS), shS = sheet_('Sessions', HEAD_SESSIONS);
  var dP = shP.getDataRange().getValues(), supp = 0;
  for (var i = dP.length - 1; i >= 1; i--) {
    var h = dP[i][5];
    if (!(h instanceof Date) || h >= limite) continue;
    try { DriveApp.getFileById(dP[i][6]).setTrashed(true); supp++; } catch (e) {}
    shP.deleteRow(i + 1);
  }
  var dS = shS.getDataRange().getValues(), suppS = 0;
  for (var j = dS.length - 1; j >= 1; j--) {
    var d = dS[j][3] instanceof Date ? dS[j][3] : dS[j][4];
    if (!(d instanceof Date) || d >= limite) continue;
    shS.deleteRow(j + 1); suppS++;
  }
  // dossiers de jour devenus vides
  var jours = getFolder_('Menages').getFolders();
  while (jours.hasNext()) {
    var f = jours.next();
    if (!f.getFiles().hasNext() && !f.getFolders().hasNext()) f.setTrashed(true);
    else {
      var sous = f.getFolders(), vide = true;
      while (sous.hasNext()) { var s2 = sous.next(); if (!s2.getFiles().hasNext()) s2.setTrashed(true); else vide = false; }
      if (vide && !f.getFiles().hasNext()) f.setTrashed(true);
    }
  }
  Logger.log('Purge ' + RETENTION_JOURS + ' jours : ' + supp + ' fichiers, ' + suppS + ' ménages supprimés.');
  return supp + ' fichiers supprimés';
}

function installerPurge() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'purgeAnciennes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('purgeAnciennes').timeBased().everyDays(1).atHour(3).create();
  Logger.log('Purge quotidienne installée (3h).');
}
