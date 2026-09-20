
// ===================== MISSIONS : proposer / prendre / se désister =====================
// Règles Claudine 20/09/2026 : mail annonce 24 h, réattribution à 36 h, uniquement si le
// ménage est dans les 15 jours ; désistement possible jusqu'à 3 jours avant ; ménage du
// lendemain = URGENT, réponse avant 17h sinon warning ; page de confirmation avant d'envoyer.
var MISSIONS = {
  DELAI_REEL_H: 36,          // réattribution
  DELAI_ANNONCE_H: 24,       // ce qu'on écrit dans le mail
  HORIZON_JOURS: 15,         // au-delà, on ne réattribue pas (agendas pas encore remplis)
  DESISTEMENT_H: 72,         // 3 jours avant
  APP: 'https://claudine-design.github.io/enquete-berck/missions.html',
  TAG_PROP: '[MISSION-PROPOSEE ',
  TAG_PRISE: '[MISSION-PRISE '
};

function urlWeb_() { return SUIVI.API_ROBOT || ScriptApp.getService().getUrl(); }
function tokenPresta_(cle) {
  var sel = PropertiesService.getScriptProperties().getProperty('SEL_MISSIONS');
  if (!sel) { sel = Utilities.getUuid(); PropertiesService.getScriptProperties().setProperty('SEL_MISSIONS', sel); }
  var sig = Utilities.computeHmacSha256Signature(cle, sel);
  return Utilities.base64EncodeWebSafe(sig).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}
function prestaDuToken_(tok) {
  var out = null;
  Object.keys(SUIVI.PRESTAS).forEach(function (k) { if (tokenPresta_(SUIVI.PRESTAS[k].cle) === tok) out = k; });
  return out;
}
function initiales_(k) {
  var p = SUIVI.PRESTAS[k];
  return (p && p.initiales) ? p.initiales : normalize_(p ? p.prenom : k).slice(0, 2).toUpperCase();
}
function liensProposition_(apart, dateStr) {
  return Object.keys(SUIVI.PRESTAS).map(function (k) {
    return SUIVI.PRESTAS[k].prenom + ' : ' + urlWeb_() + '?action=proposer&appart=' + encodeURIComponent(apart) +
      '&date=' + dateStr + '&presta=' + k + '&cle=' + SUIVI.CLE;
  }).join('\n');
}

// ------------------------------- web app -------------------------------
function doGet(e) {
  var p = e.parameter || {};
  try {
    if (p.action === 'proposer')   return pageConfirmation_(p);
    if (p.action === 'proposerOk') return proposerOk_(p);
    if (p.action === 'missions')   return jsonWeb_(listeMissions_(p));
    if (p.action === 'prendre')    return jsonWeb_(prendreMission_(p));
    if (p.action === 'refuser')    return jsonWeb_(refuserMission_(p));
    if (p.action === 'desister')   return jsonWeb_(desisterMission_(p));
    return htmlWeb_('Appart-Hôtel Berck', 'Rien à afficher ici.');
  } catch (err) {
    return htmlWeb_('Erreur', String(err));
  }
}
function jsonWeb_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function htmlWeb_(titre, corps, bouton) {
  var h = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:40px auto;padding:24px;' +
    'background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08);color:#1f2933">' +
    '<h2 style="margin:0 0 12px;color:#1f3b57">' + titre + '</h2><div style="font-size:16px;line-height:1.5">' + corps + '</div>' +
    (bouton || '') + '</div>';
  return HtmlService.createHtmlOutput(h).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Étape 1 : page de confirmation (aucun envoi tant que Claudine n'a pas confirmé)
function pageConfirmation_(p) {
  if (p.cle !== SUIVI.CLE) return htmlWeb_('Lien incomplet', 'Ce lien n\'est pas valable.');
  var pr = SUIVI.PRESTAS[p.presta];
  if (!pr) return htmlWeb_('Prestataire inconnu', p.presta);
  var url = urlWeb_() + '?action=proposerOk&appart=' + encodeURIComponent(p.appart) + '&date=' + p.date +
    '&presta=' + p.presta + '&cle=' + SUIVI.CLE;
  var bouton = '<div style="margin-top:20px"><a href="' + url + '" style="display:block;text-align:center;background:#16a34a;' +
    'color:#fff;text-decoration:none;padding:16px;border-radius:12px;font-weight:700;font-size:17px">Oui, proposer à ' + pr.prenom + '</a>' +
    '<p style="text-align:center;color:#6b7280;font-size:13px;margin-top:12px">Fermez cette page pour annuler.</p></div>';
  return htmlWeb_('Proposer ce ménage ?',
    '<b>' + p.appart + '</b><br>' + frDate_(p.date) + '<br><br>Prestataire : <b>' + pr.prenom + '</b>' +
    (pr.email ? '' : '<br><span style="color:#b45309">Pas d\'adresse e-mail : le mail vous sera envoyé à transmettre.</span>'), bouton);
}

// Étape 2 : création de la mission + mail au prestataire
function proposerOk_(p) {
  if (p.cle !== SUIVI.CLE) return htmlWeb_('Lien incomplet', 'Ce lien n\'est pas valable.');
  var pr = SUIVI.PRESTAS[p.presta];
  if (!pr) return htmlWeb_('Prestataire inconnu', p.presta);
  var jour = parse_(p.date);
  var cal = CalendarApp.getCalendarById(pr.calendrier ? CFG.CAL[pr.calendrier] : CFG.CAL.CLAUDINE);
  var deja = cal.getEventsForDay(jour).filter(function (ev) {
    return (ev.getDescription() || '').indexOf(MISSIONS.TAG_PROP + p.appart) !== -1 ||
           (ev.getDescription() || '').indexOf(MISSIONS.TAG_PRISE + p.appart) !== -1;
  });
  if (deja.length) return htmlWeb_('Déjà proposé', 'Ce ménage est déjà proposé ou déjà pris : <b>' + deja[0].getTitle() + '</b>');
  var urgent = diffJours_(fmt_(today_()), p.date) <= 1;
  var titre = '❔ ' + p.appart + ' — proposé à ' + pr.prenom + (urgent ? ' (URGENT)' : '');
  var desc = 'Mission proposée le ' + Utilities.formatDate(new Date(), TZ, 'dd/MM à HH:mm') + ' à ' + pr.prenom + '.\n' +
    'Réponse attendue sous ' + MISSIONS.DELAI_ANNONCE_H + ' h' + (urgent ? ' — URGENT : avant 17h.' : '.') + '\n' +
    'Sans réponse, le ménage revient dans votre agenda à réattribuer.\n' +
    MISSIONS.TAG_PROP + p.appart + ' ' + p.presta + ' ' + new Date().toISOString() + ']';
  var ev = cal.createAllDayEvent(titre, jour, { description: desc });
  try { ev.setColor(urgent ? '11' : '5'); ev.removeAllReminders(); } catch (e2) {}
  envoyerProposition_(p.presta, p.appart, p.date, urgent);
  return htmlWeb_('Proposition envoyée ✅',
    '<b>' + p.appart + '</b> — ' + frDate_(p.date) + '<br>Proposé à <b>' + pr.prenom + '</b>.<br><br>' +
    'Vous serez prévenue dès qu\'il ou elle répond.' + (urgent ? '<br><b>Ménage urgent : réponse attendue avant 17h.</b>' : ''));
}

function envoyerProposition_(k, apart, dateStr, urgent) {
  var pr = SUIVI.PRESTAS[k];
  var lien = MISSIONS.APP + '?presta=' + pr.cle + '&k=' + tokenPresta_(pr.cle);
  var corps = 'Bonjour ' + pr.prenom + ',\n\n' +
    'Proposition de ménage : ' + apart + ', le ' + frDate_(dateStr) + '.\n\n' +
    (urgent ? 'URGENT : un voyageur arrive tout de suite après. Merci de répondre AVANT 17h.\n\n'
            : 'Merci de répondre dans les ' + MISSIONS.DELAI_ANNONCE_H + ' heures. Après, il sera attribué à quelqu\'un d\'autre.\n\n') +
    'Pour accepter ou refuser, ouvrez vos missions :\n' + lien + '\n\n' +
    'Une fois accepté, le ménage apparaît dans votre planning avec le tuto à suivre.\n' +
    'Les packs de linge, arrivées anticipées et départs tardifs peuvent changer au dernier moment : vérifiez votre calendrier le jour même.\n\n' +
    'Merci beaucoup,\nClaudine';
  var sujet = (urgent ? '🚨 URGENT — ' : '') + 'Proposition de ménage : ' + apart + ' le ' + frDate_(dateStr);
  if (SUIVI.ENVOYER_AUX_PRESTAS && pr.email) GmailApp.sendEmail(pr.email, sujet, corps, { cc: SUIVI.CC, name: 'Claudine — Appart-Hôtel Berck' });
  else GmailApp.sendEmail(SUIVI.CC, '[À TRANSMETTRE] ' + sujet, corps);
}

// ------------------------------- côté prestataire -------------------------------
function missionsDuPresta_(k) {
  var pr = SUIVI.PRESTAS[k];
  var du = today_(), au = addDays_(du, 45);
  var cals = [CFG.CAL.CLAUDINE];
  if (pr.calendrier && CFG.CAL[pr.calendrier]) cals.push(CFG.CAL[pr.calendrier]);
  var out = [];
  cals.forEach(function (id) {
    CalendarApp.getCalendarById(id).getEvents(du, au).forEach(function (ev) {
      var d = ev.getDescription() || '';
      var prop = d.indexOf(MISSIONS.TAG_PROP) !== -1, prise = d.indexOf(MISSIONS.TAG_PRISE) !== -1;
      if (!prop && !prise) return;
      var m = d.match(/\[MISSION-(PROPOSEE|PRISE) ([^\]]+)\]/);
      if (!m) return;
      var bits = m[2].split(' ');
      var apart = bits.slice(0, bits.length - 2).join(' '), qui = bits[bits.length - 2], quand = bits[bits.length - 1];
      if (qui !== k) return;
      var date = fmt_(ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime());
      out.push({
        id: ev.getId(), cal: id, appart: apart, slug: SUIVI.SLUG[apart] || '', date: date,
        statut: prise ? 'PRISE' : 'PROPOSEE', depuis: quand, titre: ev.getTitle(),
        urgent: diffJours_(fmt_(today_()), date) <= 1,
        desistementPossible: (parse_(date) - new Date()) / 3600000 > MISSIONS.DESISTEMENT_H,
        infos: infosDuJour_(apart, date)
      });
    });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return out;
}

// Packs de linge / check-in / check-out notés sur DRAP pour ce logement ce jour-là (ça bouge au dernier moment)
function infosDuJour_(apart, dateStr) {
  var infos = [];
  try {
    CalendarApp.getCalendarById(CFG.CAL.DRAP).getEventsForDay(parse_(dateStr)).forEach(function (ev) {
      var t = ev.getTitle();
      if (matchApart_(t, apart) && /pack|check|🕔/i.test(normalize_(t))) infos.push(t);
    });
  } catch (e) {}
  return infos;
}

function listeMissions_(p) {
  var k = prestaDuToken_(p.k || '');
  if (!k) return { ok: false, error: 'lien' };
  return { ok: true, presta: SUIVI.PRESTAS[k].prenom, cle: SUIVI.PRESTAS[k].cle, missions: missionsDuPresta_(k) };
}

function evParId_(calId, evId) {
  var evs = CalendarApp.getCalendarById(calId).getEvents(addDays_(today_(), -1), addDays_(today_(), 60));
  for (var i = 0; i < evs.length; i++) if (evs[i].getId() === evId) return evs[i];
  return null;
}

function prendreMission_(p) {
  var k = prestaDuToken_(p.k || '');
  if (!k) return { ok: false, error: 'lien' };
  var ev = evParId_(p.cal, p.id);
  if (!ev) return { ok: false, error: 'mission introuvable' };
  var d = ev.getDescription() || '';
  if (d.indexOf(MISSIONS.TAG_PRISE) !== -1) return { ok: false, error: 'deja prise' };
  if (d.indexOf(MISSIONS.TAG_PROP + '') === -1) return { ok: false, error: 'plus disponible' };
  var m = d.match(/\[MISSION-PROPOSEE ([^\]]+)\]/);
  var bits = m[1].split(' '), apart = bits.slice(0, bits.length - 2).join(' ');
  if (bits[bits.length - 2] !== k) return { ok: false, error: 'pas pour vous' };
  var date = fmt_(ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime());
  ev.setTitle(initiales_(k) + ' ' + apart);
  ev.setDescription(d.replace(MISSIONS.TAG_PROP, MISSIONS.TAG_PRISE) + '\nPrise le ' + Utilities.formatDate(new Date(), TZ, 'dd/MM à HH:mm') + '.');
  try { ev.setColor('10'); } catch (e) {}
  supprimerWarning_(apart, date);
  GmailApp.sendEmail(SUIVI.CC, '✅ ' + SUIVI.PRESTAS[k].prenom + ' prend ' + apart + ' le ' + frDate_(date),
    SUIVI.PRESTAS[k].prenom + ' vient d\'accepter le ménage de ' + apart + ' du ' + frDate_(date) + '.\nSes initiales sont sur votre agenda.');
  return { ok: true };
}

function refuserMission_(p) {
  var k = prestaDuToken_(p.k || '');
  if (!k) return { ok: false, error: 'lien' };
  var ev = evParId_(p.cal, p.id);
  if (!ev) return { ok: false, error: 'mission introuvable' };
  var d = ev.getDescription() || '';
  var m = d.match(/\[MISSION-(PROPOSEE|PRISE) ([^\]]+)\]/);
  if (!m) return { ok: false, error: 'mission introuvable' };
  var bits = m[2].split(' '), apart = bits.slice(0, bits.length - 2).join(' ');
  var date = fmt_(ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime());
  var etaitPrise = m[1] === 'PRISE';
  if (etaitPrise && (parse_(date) - new Date()) / 3600000 <= MISSIONS.DESISTEMENT_H) {
    return { ok: false, error: 'trop tard' };
  }
  ev.deleteEvent();
  alerteAReattribuer_(apart, date, (etaitPrise ? SUIVI.PRESTAS[k].prenom + ' s\'est désisté(e)' : SUIVI.PRESTAS[k].prenom + ' a refusé'));
  return { ok: true };
}
function desisterMission_(p) { return refuserMission_(p); }

function supprimerWarning_(apart, dateStr) {
  try {
    CalendarApp.getCalendarById(CFG.CAL.CLAUDINE).getEventsForDay(parse_(dateStr)).forEach(function (ev) {
      if ((ev.getDescription() || '').indexOf('[AUTO-WARN ' + apart + ' ' + dateStr + ']') !== -1) ev.deleteEvent();
    });
  } catch (e) {}
}

function alerteAReattribuer_(apart, dateStr, pourquoi) {
  var desc = pourquoi + '.\n\nÀ réattribuer — ouvrez un lien pour proposer :\n' + liensProposition_(apart, dateStr) +
    '\n\n[AUTO-REATTRIBUER ' + apart + ' ' + dateStr + ']';
  creerEventClaudine_('♻️ À réattribuer — ' + apart + ' (' + frDate_(dateStr) + ')', today_(), desc, '11');
  GmailApp.sendEmail(SUIVI.CC, '♻️ À réattribuer : ' + apart + ' le ' + frDate_(dateStr), desc);
}

// ------------------------------- relance / expiration (toutes les heures) -------------------------------
function verifierPropositions() {
  var maintenant = new Date();
  var cals = [CFG.CAL.CLAUDINE];
  Object.keys(SUIVI.PRESTAS).forEach(function (k) {
    var c = SUIVI.PRESTAS[k].calendrier;
    if (c && CFG.CAL[c] && cals.indexOf(CFG.CAL[c]) === -1) cals.push(CFG.CAL[c]);
  });
  cals.forEach(function (id) {
    CalendarApp.getCalendarById(id).getEvents(today_(), addDays_(today_(), MISSIONS.HORIZON_JOURS + 1)).forEach(function (ev) {
      var d = ev.getDescription() || '';
      var m = d.match(/\[MISSION-PROPOSEE ([^\]]+)\]/);
      if (!m) return;
      var bits = m[1].split(' '), apart = bits.slice(0, bits.length - 2).join(' '), qui = bits[bits.length - 2], depuis = new Date(bits[bits.length - 1]);
      var date = fmt_(ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime());
      var heures = (maintenant - depuis) / 3600000;
      var urgent = diffJours_(fmt_(today_()), date) <= 1;
      var h = Number(Utilities.formatDate(maintenant, TZ, 'H'));
      if (urgent && h >= 17) {
        ev.deleteEvent();
        alerteAReattribuer_(apart, date, 'URGENT : ' + SUIVI.PRESTAS[qui].prenom + ' n\'a pas répondu avant 17h');
        return;
      }
      if (heures >= MISSIONS.DELAI_REEL_H && diffJours_(fmt_(today_()), date) <= MISSIONS.HORIZON_JOURS) {
        ev.deleteEvent();
        alerteAReattribuer_(apart, date, 'Pas de réponse de ' + SUIVI.PRESTAS[qui].prenom + ' en ' + MISSIONS.DELAI_REEL_H + ' h');
      }
    });
  });
}

function installerMissions() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'verifierPropositions') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('verifierPropositions').timeBased().everyHours(1).create();
  var lignes = Object.keys(SUIVI.PRESTAS).map(function (k) {
    var pr = SUIVI.PRESTAS[k];
    return pr.prenom + ' : ' + MISSIONS.APP + '?presta=' + pr.cle + '&k=' + tokenPresta_(pr.cle);
  });
  Logger.log('Liens personnels des prestataires :\n' + lignes.join('\n'));
  Logger.log('URL du service web : ' + urlWeb_());
  return lignes.join('\n');
}
