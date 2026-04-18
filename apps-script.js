// =============================================
// GOOGLE APPS SCRIPT — Enquete Satisfaction v5
// =============================================
// Nouveautes v5 :
//   - Nouveaux libelles 5 niveaux (Q1/Q3/Q4/Q5) + aides
//   - Suppression Q2 (Attentes)
//   - Mapping APPART -> PRESTATAIRE + EMAIL
//   - Alerte immediate si Q5=Tres sale (prestataire + princessedopale en copie)
//   - Alerte immediate si Q1/Q3/Q4=Tres decevant (princessedopale uniquement)
//   - Trigger hebdo (lundi 8h) : recap par prestataire + copie princessedopale
//   - Trigger mensuel (dernier jour du mois 18h) : bilan avec tendance
//   - Alerte auto si appart decroche vs moyenne
//   - Renommages : Apollove->Apolove, Coeur->Maisonnette (Spa/Repos supprimes)
// =============================================

var SHEET_ID = '1Yqa2l_B4-mlNWI6AU14nBisEj3Xy4Kxic9qiH67Ra-k';
var ALERT_EMAIL = 'princessedopale@gmail.com';

// ===== MAPPING APPARTEMENT -> PRESTATAIRE =====
// Prestataire geografique et email de contact
var PRESTATAIRES = {
  remi:       { nom: 'R\xe9mi',      email: ALERT_EMAIL },  // test : tous -> princessedopale
  clara:      { nom: 'Clara',       email: ALERT_EMAIL },
  christelle: { nom: 'Christelle',  email: ALERT_EMAIL }
};

var APPART_TO_PRESTA = {
  // Remi (5) - Le 23
  'Kitesurf': 'remi', 'Hamac': 'remi', 'Paddle': 'remi', 'Surf': 'remi', 'Famille': 'remi',
  // Clara (7)
  'Baln\xe9o': 'clara', 'Cocon Romantique': 'clara',
  'La R\xe9serve': 'clara', 'Kingston': 'clara', 'Apolove': 'clara', 'Apollo': 'clara',
  'Albatros': 'clara',
  // Christelle (10)
  'Face Mer': 'christelle', 'Grand Large': 'christelle',
  'Mini Love Room': 'christelle', 'Grande Love Room': 'christelle',
  'Jeanne': 'christelle', 'Evasion': 'christelle', 'Rotonde': 'christelle', 'Patio': 'christelle',
  'Terrasse': 'christelle', 'Maisonnette': 'christelle'
};

// ===== HEADERS =====
var HEAD_REPONSES = [
  'Horodatage', 'Residence', 'Appartement', 'Prestataire',
  'Nom Prenom', 'Telephone', 'WhatsApp',
  'Ville/Region/Pays', 'Zone Vacances', 'Email',
  'Q1 Arrivee', 'Q3 Appreciation', 'Q4 Qualite/Prix',
  'Q5 Proprete', 'Q5 Details', 'Q6 Ameliorations',
  'Q7 Revenir', 'Q8 Recommander', 'Q9 Commentaire libre',
  'Consent Marketing'
];
var HEAD_EMAILS = [
  'Email', 'Nom Prenom', 'Telephone', 'WhatsApp',
  'Appartement', 'Residence', 'Prestataire',
  'Ville', 'Zone Vacances',
  'Date', 'Consent Marketing'
];
var HEAD_MARKETING = ['Email', 'Nom Prenom', 'Ville', 'Zone Vacances', 'Date inscription'];
var HEAD_VR = ['Email', 'Nom Prenom', 'Telephone', 'Ville', 'Zone Vacances', 'Appartement', 'Residence', 'Prestataire', 'Note Arrivee', 'Recommande', 'Commentaire', 'Date'];
var HEAD_NR = ['Email', 'Nom Prenom', 'Telephone', 'Ville', 'Zone Vacances', 'Appartement', 'Residence', 'Prestataire', 'Note Arrivee', 'Proprete', 'Details Menage', 'Ameliorations', 'Commentaire', 'Date'];

// ===== VALEURS NEGATIVES (5 niveaux) =====
var NEG_Q1 = 'Tr\xe8s d\xe9cevant';
var NEG_Q3 = 'Tr\xe8s d\xe9cevant';
var NEG_Q4 = 'Trop cher';
var NEG_Q5 = 'Tr\xe8s sale';

function doGet(e) { return handle(e.parameter); }
function doPost(e) {
  var params = e.parameter || {};
  if (e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      for (var k in body) params[k] = body[k];
    } catch(err) {}
  }
  return handle(params);
}

function handle(p) {
  var action = p.action;
  var ss = SpreadsheetApp.openById(SHEET_ID);

  if (action === 'submitEnquete') {
    var zone = getZone(p.ville);
    var ts = new Date().toLocaleString('fr-FR');
    var prestaKey = APPART_TO_PRESTA[p.appart] || '';
    var prestaNom = (PRESTATAIRES[prestaKey] || {}).nom || '';

    // --- Reponses ---
    var sheetR = ensureSheet(ss, 'Reponses', HEAD_REPONSES, '#0369a1');
    sheetR.appendRow([
      ts, p.residence || '', p.appart || '', prestaNom,
      p.nom || '', p.tel || '', p.whatsapp || 'non',
      p.ville || '', zone, p.email || '',
      p.q1 || '', p.q3 || '', p.q4 || '',
      p.q5 || '', p.q5details || '', p.q6 || '',
      p.q7 || '', p.q8 || '', p.q9 || '',
      p.consent || 'non'
    ]);
    colorRowBySentiment(sheetR, sheetR.getLastRow(), p, HEAD_REPONSES.length);

    // --- Emails ---
    if (p.email) {
      var sheetE = ensureSheet(ss, 'Emails', HEAD_EMAILS, '#10b981');
      sheetE.appendRow([
        p.email, p.nom || '', p.tel || '', p.whatsapp || 'non',
        p.appart || '', p.residence || '', prestaNom,
        p.ville || '', zone,
        ts, p.consent || 'non'
      ]);
    }

    // --- Emails Marketing ---
    if (p.consent === 'oui' && p.email) {
      var sheetM = ensureSheet(ss, 'Emails Marketing', HEAD_MARKETING, '#f59e0b');
      sheetM.appendRow([p.email, p.nom || '', p.ville || '', zone, ts]);
    }

    // --- Veulent Revenir ---
    if (p.email && (p.q7 === 'Oui' || p.q7 === 'Peut-\xeatre')) {
      var sheetVR = ensureSheet(ss, 'Veulent Revenir', HEAD_VR, '#10b981');
      sheetVR.appendRow([
        p.email, p.nom || '', p.tel || '', p.ville || '', zone,
        p.appart || '', p.residence || '', prestaNom,
        p.q1 || '', p.q8 || '', p.q9 || '', ts
      ]);
    }

    // --- Ne veulent pas revenir ---
    if (p.email && p.q7 === 'Non') {
      var sheetNR = ensureSheet(ss, 'Ne veulent pas revenir', HEAD_NR, '#dc2626');
      sheetNR.appendRow([
        p.email, p.nom || '', p.tel || '', p.ville || '', zone,
        p.appart || '', p.residence || '', prestaNom,
        p.q1 || '', p.q5 || '',
        p.q5details || '', p.q6 || '', p.q9 || '', ts
      ]);
    }

    // --- ALERTES IMMEDIATES ---
    try { sendImmediateAlerts(p, zone, prestaKey, prestaNom); } catch(err) {}

    return json({ success: true });
  }

  if (action === 'getStats') {
    var sheetR = ss.getSheetByName('Reponses');
    if (!sheetR) return json({ data: [], count: 0 });
    var data = sheetR.getDataRange().getValues();
    return json({ data: data, count: data.length - 1 });
  }

  if (action === 'runWeeklyRecap')  { sendWeeklyRecap(); return json({ success: true }); }
  if (action === 'runMonthlyRecap') { sendMonthlyRecap(); return json({ success: true }); }

  return json({ error: 'Action inconnue' });
}

// ===== ALERTES IMMEDIATES =====
function sendImmediateAlerts(p, zone, prestaKey, prestaNom) {
  var alertes = [];
  var isUrgent = false;

  if (p.q5 === NEG_Q5) { alertes.push('M\xe9nage : TR\xc8S SALE'); isUrgent = true; }
  if (p.q5 === 'Quelques d\xe9fauts') alertes.push('M\xe9nage : quelques d\xe9fauts');
  if (p.q1 === NEG_Q1) alertes.push('Arriv\xe9e : TR\xc8S D\xc9CEVANT');
  if (p.q3 === NEG_Q3) alertes.push('Appr\xe9ciation : TR\xc8S D\xc9CEVANT');
  if (p.q4 === NEG_Q4) alertes.push('Qualit\xe9/prix : TROP CHER');
  if (p.q7 === 'Non')  alertes.push('Ne veut PAS revenir');
  if (p.q8 === 'Non')  alertes.push('Ne recommande PAS');

  if (alertes.length === 0) return;

  // Alerte prestataire si menage = Tres sale
  if (isUrgent && prestaKey && PRESTATAIRES[prestaKey]) {
    sendPrestaCleaningAlert(p, prestaKey, prestaNom);
  }

  // Alerte directive : pour toutes les alertes
  sendAlertEmail(p, alertes, zone, prestaNom);
}

function sendPrestaCleaningAlert(p, prestaKey, prestaNom) {
  var presta = PRESTATAIRES[prestaKey];
  var appart = p.appart || '?';
  var residence = p.residence || '';
  var sujet = '\u{1f6a8} URGENT m\xe9nage - ' + appart + ' - ' + prestaNom;

  var body = ''
    + '<div style="font-family:sans-serif;max-width:600px">'
    + '<div style="background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:22px;border-radius:10px 10px 0 0">'
    + '<h1 style="margin:0;font-size:20px">\u{1f9f9} Alerte m\xe9nage urgente</h1>'
    + '<p style="margin:4px 0 0;opacity:0.9">Appart ' + escapeHtml(appart) + (residence ? ' &middot; ' + escapeHtml(residence) : '') + '</p>'
    + '</div>'
    + '<div style="background:#fff;padding:20px;border:1px solid #e2e8f0;border-top:none">'
    + '<p>Bonjour ' + escapeHtml(prestaNom) + ',</p>'
    + '<p>Un voyageur vient de signaler un probl\xe8me de propret\xe9 <b>TR\xc8S SALE</b> dans l\'appartement <b>' + escapeHtml(appart) + '</b>.</p>'
    + (p.q5details ? '<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px;border-radius:6px;margin:12px 0"><strong>D\xe9tails rapport\xe9s :</strong><br><span style="white-space:pre-wrap">' + escapeHtml(p.q5details) + '</span></div>' : '')
    + (p.q6 ? '<div style="background:#f8fafc;border-left:4px solid #64748b;padding:12px;border-radius:6px;margin:12px 0"><strong>Autres remarques :</strong><br><span style="white-space:pre-wrap">' + escapeHtml(p.q6) + '</span></div>' : '')
    + '<p><b>Merci de faire un contr\xf4le approfondi avant le prochain check-in.</b></p>'
    + '<p style="color:#64748b;font-size:13px;margin-top:20px">Message automatique - Appart-H\xf4tel Berck<br>Copie envoy\xe9e \xe0 Claudine.</p>'
    + '</div></div>';

  MailApp.sendEmail({
    to: presta.email,
    cc: ALERT_EMAIL,
    subject: sujet,
    htmlBody: body
  });
}

// ===== UTIL : cree onglet ou migre si structure differente =====
function ensureSheet(ss, name, expectedHeader, color) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(expectedHeader);
    sheet.getRange(1, 1, 1, expectedHeader.length).setFontWeight('bold').setBackground(color).setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    return sheet;
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol < expectedHeader.length) {
    sheet.setName(name + '_archive_' + new Date().getTime());
    sheet = ss.insertSheet(name);
    sheet.appendRow(expectedHeader);
    sheet.getRange(1, 1, 1, expectedHeader.length).setFontWeight('bold').setBackground(color).setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    return sheet;
  }
  var currentHeader = sheet.getRange(1, 1, 1, expectedHeader.length).getValues()[0];
  var matches = true;
  for (var i = 0; i < expectedHeader.length; i++) {
    if (currentHeader[i] !== expectedHeader[i]) { matches = false; break; }
  }
  if (!matches) {
    sheet.setName(name + '_archive_' + new Date().getTime());
    sheet = ss.insertSheet(name);
    sheet.appendRow(expectedHeader);
    sheet.getRange(1, 1, 1, expectedHeader.length).setFontWeight('bold').setBackground(color).setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ===== COLORATION LIGNE SELON SENTIMENT (5 niveaux) =====
function sentimentScore(p) {
  var s = 0;
  // Q1
  if (p.q1 === 'Tr\xe8s d\xe9cevant') s -= 2;
  else if (p.q1 === 'D\xe9cevant') s -= 1;
  else if (p.q1 === 'Bon') s += 1;
  else if (p.q1 === 'Excellent') s += 2;
  // Q3
  if (p.q3 === 'Tr\xe8s d\xe9cevant') s -= 2;
  else if (p.q3 === 'D\xe9cevant') s -= 1;
  else if (p.q3 === 'Bon') s += 1;
  else if (p.q3 === 'Excellent') s += 2;
  // Q4
  if (p.q4 === 'Trop cher') s -= 2;
  else if (p.q4 === 'Un peu cher') s -= 1;
  else if (p.q4 === 'Bon rapport') s += 1;
  else if (p.q4 === 'Excellent') s += 2;
  // Q5
  if (p.q5 === 'Tr\xe8s sale') s -= 2;
  else if (p.q5 === 'Quelques d\xe9fauts') s -= 1;
  else if (p.q5 === 'Propre') s += 1;
  else if (p.q5 === 'Tr\xe8s propre') s += 2;
  // Q7
  if (p.q7 === 'Non') s -= 3;
  else if (p.q7 === 'Oui') s += 2;
  // Q8
  if (p.q8 === 'Non') s -= 2;
  else if (p.q8 === 'Oui') s += 1;
  return s;
}
function colorRowBySentiment(sheet, rowNum, p, nbCols) {
  var score = sentimentScore(p);
  var bg = null;
  if (score <= -3 || p.q7 === 'Non') bg = '#fecaca';
  else if (score >= 6 && p.q7 === 'Oui') bg = '#bbf7d0';
  else if (score >= 3) bg = '#dcfce7';
  else if (score <= -1) bg = '#fee2e2';
  if (bg) sheet.getRange(rowNum, 1, 1, nbCols).setBackground(bg);
}

// ===== ZONE DE VACANCES SCOLAIRES (France) =====
function getZone(ville) {
  if (!ville) return '?';
  var v = String(ville).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  var zA = ['lyon','bordeaux','grenoble','dijon','besancon','clermontferrand','limoges','poitiers','saintetienne','chambery','valence','angouleme','larochelle','pau','bayonne','biarritz','niort','roanne','annecy','aurillac','lepuyenvelay','brivelagaillarde','tulle','macon','auxerre','nevers','montlucon','vichy','moulins','perigueux','agen','montdemarsan','bourges','villeurbanne','anglet','dax'];
  var zB = ['marseille','aixenprovence','nice','cannes','antibes','toulon','lille','amiens','caen','lehavre','rouen','nantes','rennes','brest','lorient','quimper','vannes','saintmalo','strasbourg','metz','nancy','reims','orleans','tours','angers','lemans','laval','colmar','mulhouse','troyes','chalonsenchampagne','beauvais','cherbourg','dieppe','evreux','saintbrieuc','saintnazaire','cholet','chartres','blois','epinal','charlevillemezieres','arras','boulognesurmer','calais','dunkerque','valenciennes','douai','lens','compiegne','laon','soissons','monaco','menton','frejus','saintraphael','hyeres','avignon','carpentras','orange','grasse','berck','letouquet','hardelot'];
  var zC = ['paris','versailles','creteil','nanterre','boulognebillancourt','saintdenis','argenteuil','montreuil','vitrysurseine','courbevoie','asnieres','neuillysurseine','levalloisperret','issy','rueil','vincennes','antony','aulnaysousbois','champignysurmarne','drancy','meaux','melun','evry','corbeilessonnes','cergy','pontoise','sartrouville','mantes','poissy','saintgermainenlaye','saintmaur','ivry','colombes','saintouen','tremblay','noisy','toulouse','albi','cahors','montauban','foix','tarbes','auch','rodez','montpellier','nimes','beziers','perpignan','carcassonne','narbonne','sete','ales','castres','lunel','frontignan','canet','balaruc'];
  for (var i = 0; i < zA.length; i++) if (v.indexOf(zA[i]) !== -1) return 'A';
  for (var i = 0; i < zB.length; i++) if (v.indexOf(zB[i]) !== -1) return 'B';
  for (var i = 0; i < zC.length; i++) if (v.indexOf(zC[i]) !== -1) return 'C';
  return '?';
}

// ===== EMAIL ALERTE HTML DIRECTION =====
function sendAlertEmail(p, alertes, zone, prestaNom) {
  var appart = p.appart || '?';
  var residence = p.residence || '';
  var nom = p.nom || '?';
  var tel = p.tel || '';
  var email = p.email || '';
  var ville = p.ville || '?';
  var whatsapp = p.whatsapp === 'oui';
  var telIntl = tel.replace(/\D/g,'');
  if (telIntl.charAt(0) === '0') telIntl = '33' + telIntl.substring(1);

  var sujet = '\u{1f6a8} AVIS N\xc9GATIF - ' + appart + (residence ? ' (' + residence + ')' : '');
  var severity = (p.q7 === 'Non') ? 'tr\xe8s n\xe9gatif' : 'n\xe9gatif';

  var alertesHtml = alertes.map(function(a){
    return '<li style="margin:4px 0;color:#991b1b;font-weight:600">\u26a0\ufe0f ' + escapeHtml(a) + '</li>';
  }).join('');

  function noteRow(label, val, bad) {
    var color = bad ? '#dc2626' : '#475569';
    var bg = bad ? '#fef2f2' : 'transparent';
    return '<tr>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b">' + label + '</td>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;background:' + bg + ';color:' + color + ';font-weight:600">' + escapeHtml(val || '-') + '</td>'
    + '</tr>';
  }
  var notes = ''
    + noteRow('Arriv\xe9e', p.q1, p.q1 === NEG_Q1)
    + noteRow('Appr\xe9ciation', p.q3, p.q3 === NEG_Q3)
    + noteRow('Qualit\xe9/prix', p.q4, p.q4 === NEG_Q4)
    + noteRow('Propret\xe9', p.q5, p.q5 === NEG_Q5 || p.q5 === 'Quelques d\xe9fauts')
    + noteRow('Souhaite revenir', p.q7, p.q7 === 'Non')
    + noteRow('Recommanderait', p.q8, p.q8 === 'Non');

  var btn = 'display:inline-block;padding:12px 18px;margin:4px 6px 4px 0;border-radius:8px;text-decoration:none;font-weight:600;font-family:sans-serif;font-size:14px;';
  var btnCall = tel ? '<a href="tel:' + tel + '" style="' + btn + 'background:#0ea5e9;color:#fff">\u{1f4de} Appeler</a>' : '';
  var btnWa = (whatsapp && telIntl) ? '<a href="https://wa.me/' + telIntl + '" style="' + btn + 'background:#25d366;color:#fff">\u{1f4ac} WhatsApp</a>' : '';
  var btnMail = email ? '<a href="mailto:' + email + '?subject=Votre%20s\xe9jour%20\xe0%20' + encodeURIComponent(appart) + '" style="' + btn + 'background:#8b5cf6;color:#fff">\u2709\ufe0f Email</a>' : '';
  var btnBooking = '<a href="https://admin.booking.com/" style="' + btn + 'background:#003580;color:#fff">\u{1f3e8} Booking</a>';
  var btnAirbnb = '<a href="https://www.airbnb.fr/hosting/reservations" style="' + btn + 'background:#ff5a5f;color:#fff">\u{1f3e0} Airbnb</a>';
  var btnBeds24 = '<a href="https://beds24.com/control3.php?pagetype=rbooking" style="' + btn + 'background:#f59e0b;color:#fff">\u{1f4c5} Beds24</a>';

  var zoneBadge = zone && zone !== '?' ? '<span style="background:#ede9fe;color:#6d28d9;padding:3px 10px;border-radius:10px;font-size:12px;margin-left:8px;font-weight:700">Zone ' + zone + '</span>' : '';
  var prestaBadge = prestaNom ? '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:10px;font-size:12px;margin-left:8px;font-weight:700">Pres. ' + escapeHtml(prestaNom) + '</span>' : '';

  var detailsMenage = p.q5details ? '<div style="background:#fef2f2;padding:12px 14px;border-radius:8px;border-left:4px solid #dc2626;margin:8px 0"><strong style="color:#991b1b">\u{1f9f9} D\xe9tails m\xe9nage :</strong><br><span style="color:#7f1d1d;white-space:pre-wrap">' + escapeHtml(p.q5details) + '</span></div>' : '';
  var commentQ6 = p.q6 ? '<div style="background:#f8fafc;padding:12px 14px;border-radius:8px;border-left:4px solid #64748b;margin:8px 0"><strong>\u{1f4a1} Am\xe9liorations sugg\xe9r\xe9es :</strong><br><span style="white-space:pre-wrap">' + escapeHtml(p.q6) + '</span></div>' : '';
  var commentQ9 = p.q9 ? '<div style="background:#fef3c7;padding:12px 14px;border-radius:8px;border-left:4px solid #f59e0b;margin:8px 0"><strong>\u{1f4ac} Commentaire libre :</strong><br><span style="white-space:pre-wrap">' + escapeHtml(p.q9) + '</span></div>' : '';

  var html = ''
    + '<div style="font-family:-apple-system,sans-serif;max-width:640px;margin:0 auto;color:#1e293b">'
    + '<div style="background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:24px;border-radius:12px 12px 0 0">'
    + '<h1 style="margin:0;font-size:22px">\u{1f6a8} Avis ' + severity + ' re\xe7u</h1>'
    + '<p style="margin:6px 0 0;opacity:0.9">' + escapeHtml(appart) + (residence ? ' &middot; ' + escapeHtml(residence) : '') + ' &middot; ' + new Date().toLocaleString('fr-FR') + '</p>'
    + '</div>'
    + '<div style="background:#fff;padding:20px;border:1px solid #e2e8f0;border-top:none">'
    + '<div style="background:#fef2f2;border:2px solid #fecaca;border-radius:10px;padding:14px 18px;margin-bottom:20px"><strong style="color:#991b1b;font-size:15px">Alertes d\xe9clench\xe9es :</strong><ul style="margin:8px 0 0;padding-left:20px">' + alertesHtml + '</ul></div>'
    + '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u{1f464} Fiche client</h2>'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px">'
    + '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;width:40%">Nom Pr\xe9nom</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-weight:700">' + escapeHtml(nom) + '</td></tr>'
    + '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b">T\xe9l\xe9phone</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">' + (tel ? '<a href="tel:' + tel + '" style="color:#0ea5e9;font-weight:600">' + escapeHtml(tel) + '</a>' : '-') + (whatsapp ? ' <span style="background:#25d366;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">WhatsApp OK</span>' : '') + '</td></tr>'
    + '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b">Email</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">' + (email ? '<a href="mailto:' + email + '" style="color:#8b5cf6;font-weight:600">' + escapeHtml(email) + '</a>' : '-') + '</td></tr>'
    + '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b">Ville</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">' + escapeHtml(ville) + zoneBadge + '</td></tr>'
    + '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b">Appartement</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">' + escapeHtml(appart) + prestaBadge + '</td></tr>'
    + '</table>'
    + '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u{1f4de} Contacter imm\xe9diatement</h2>'
    + '<div>' + btnCall + btnWa + btnMail + '</div>'
    + '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u{1f50d} Retrouver la r\xe9servation</h2>'
    + '<p style="font-size:13px;color:#64748b;margin:0 0 8px">Cherchez "<strong>' + escapeHtml(nom) + '</strong>" ou "<strong>' + escapeHtml(email) + '</strong>" :</p>'
    + '<div>' + btnBooking + btnAirbnb + btnBeds24 + '</div>'
    + '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u2b50 Notes</h2>'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">' + notes + '</table>'
    + detailsMenage + commentQ6 + commentQ9
    + '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center">'
    + '<a href="https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit" style="color:#0369a1">\u{1f4ca} Voir tous les avis</a> &middot; Enqu\xeate Appart-H\xf4tel Berck</div>'
    + '</div></div>';

  MailApp.sendEmail({ to: ALERT_EMAIL, subject: sujet, htmlBody: html });
}

// ===== RECAP HEBDO PAR PRESTATAIRE =====
function sendWeeklyRecap() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheetR = ss.getSheetByName('Reponses');
  if (!sheetR) return;
  var data = sheetR.getDataRange().getValues();
  var header = data[0];
  var now = new Date();
  var oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Regrouper par prestataire
  var byPresta = { remi: [], clara: [], christelle: [] };
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowDate = parseFrDate(row[0]);
    if (!rowDate || rowDate < oneWeekAgo) continue;
    var appart = row[2];
    var prestaKey = APPART_TO_PRESTA[appart];
    if (!prestaKey || !byPresta[prestaKey]) continue;
    byPresta[prestaKey].push(rowToObj(row, header));
  }

  // Envoyer un mail a chaque prestataire (meme si 0 avis : pas de mail)
  Object.keys(byPresta).forEach(function(key) {
    var avis = byPresta[key];
    if (avis.length === 0) return;
    sendPrestaRecapEmail(key, avis, 'hebdo');
  });
}

function sendPrestaRecapEmail(prestaKey, avis, periode) {
  var presta = PRESTATAIRES[prestaKey];
  var prestaNom = presta.nom;
  var nb = avis.length;
  var isWeekly = periode === 'hebdo';
  var titrePeriode = isWeekly ? 'Ton r\xe9cap de la semaine' : 'Ton r\xe9cap du mois';

  // Stats
  var stats = computeStats(avis);
  var headerColor = stats.menageScore >= 80 ? '#10b981' : (stats.menageScore >= 60 ? '#f59e0b' : '#dc2626');

  // Tableau par appart
  var byAppart = {};
  avis.forEach(function(a) {
    if (!byAppart[a.appart]) byAppart[a.appart] = [];
    byAppart[a.appart].push(a);
  });

  var apartRows = Object.keys(byAppart).map(function(name) {
    var list = byAppart[name];
    var pbMenage = list.filter(function(a) { return a.q5 === NEG_Q5 || a.q5 === 'Quelques d\xe9fauts'; }).length;
    var bonMenage = list.filter(function(a) { return a.q5 === 'Propre' || a.q5 === 'Tr\xe8s propre'; }).length;
    var statusIcon = pbMenage > 0 ? '\u26a0\ufe0f' : (bonMenage === list.length ? '\u2705' : '\u{1f7e1}');
    var statusText = pbMenage > 0 ? pbMenage + ' probl\xe8me(s) m\xe9nage signal\xe9(s)' : (bonMenage === list.length ? 'Tous positifs' : '');
    var statusColor = pbMenage > 0 ? '#dc2626' : (bonMenage === list.length ? '#10b981' : '#64748b');
    return '<tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0"><b>' + escapeHtml(name) + '</b><br><span style="font-size:12px;color:#94a3b8">' + list.length + ' avis</span></td>'
      + '<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:' + statusColor + ';font-weight:600">' + statusIcon + ' ' + statusText + '</td></tr>';
  }).join('');

  // Problemes menage detail
  var pbList = avis.filter(function(a) { return a.q5 === NEG_Q5 || a.q5 === 'Quelques d\xe9fauts'; });
  var pbHtml = pbList.map(function(a) {
    var level = a.q5 === NEG_Q5 ? '\u{1f534} TR\xc8S SALE' : '\u{1f7e0} Quelques d\xe9fauts';
    return '<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 14px;border-radius:6px;margin:8px 0">'
      + '<b>' + escapeHtml(a.appart) + ' &mdash; ' + a.horodatage + '</b> &middot; <span style="color:#991b1b">' + level + '</span><br>'
      + (a.q5details ? '<span style="color:#7f1d1d;white-space:pre-wrap">"' + escapeHtml(a.q5details) + '"</span>' : '<span style="color:#64748b;font-style:italic">Aucun d\xe9tail rapport\xe9</span>')
      + '</div>';
  }).join('');

  // Ameliorations suggerees
  var q6List = avis.filter(function(a) { return a.q6; });
  var q6Html = q6List.length > 0 ? ''
    + '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u{1f4a1} Suggestions d\'am\xe9lioration</h2>'
    + q6List.map(function(a) {
      return '<div style="background:#f8fafc;padding:10px 14px;border-radius:6px;margin:6px 0"><b>' + escapeHtml(a.appart) + ' :</b> "' + escapeHtml(a.q6) + '"</div>';
    }).join('') : '';

  var sujet = '\u{1f9f9} ' + titrePeriode + ' - ' + prestaNom + ' (' + nb + ' avis)';

  var html = ''
    + '<div style="font-family:-apple-system,sans-serif;max-width:640px;margin:0 auto;color:#1e293b">'
    + '<div style="background:linear-gradient(135deg,' + headerColor + ',' + shadeColor(headerColor, -20) + ');color:#fff;padding:24px;border-radius:12px 12px 0 0">'
    + '<h1 style="margin:0;font-size:22px">\u{1f9f9} ' + titrePeriode + ' - ' + escapeHtml(prestaNom) + '</h1>'
    + '<p style="margin:6px 0 0;opacity:0.9">' + (isWeekly ? 'Semaine du ' + formatDate(new Date(Date.now() - 7*86400000)) + ' au ' + formatDate(new Date()) : 'Mois de ' + monthName(new Date())) + ' &middot; ' + nb + ' avis</p>'
    + '</div>'
    + '<div style="background:#fff;padding:20px;border:1px solid #e2e8f0;border-top:none">'
    + '<p>Bonjour ' + escapeHtml(prestaNom) + ',</p>'
    + '<p>Voici le r\xe9sum\xe9 des avis voyageurs pour tes appartements ' + (isWeekly ? 'cette semaine' : 'ce mois-ci') + '.</p>'
    + '<div style="display:flex;gap:12px;margin:18px 0;flex-wrap:wrap">'
    + '<div style="flex:1;min-width:120px;background:#f0f9ff;padding:14px;border-radius:10px;text-align:center"><div style="font-size:12px;color:#64748b">Avis re\xe7us</div><div style="font-size:26px;font-weight:800;color:#0369a1">' + nb + '</div></div>'
    + '<div style="flex:1;min-width:120px;background:' + (stats.menageScore >= 80 ? '#f0fdf4' : '#fef2f2') + ';padding:14px;border-radius:10px;text-align:center"><div style="font-size:12px;color:#64748b">Score m\xe9nage</div><div style="font-size:26px;font-weight:800;color:' + (stats.menageScore >= 80 ? '#10b981' : '#dc2626') + '">' + stats.menageScore + '%</div></div>'
    + '<div style="flex:1;min-width:120px;background:#fef3c7;padding:14px;border-radius:10px;text-align:center"><div style="font-size:12px;color:#64748b">Reviennent</div><div style="font-size:26px;font-weight:800;color:#92400e">' + stats.returnScore + '%</div></div>'
    + '</div>'
    + '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u{1f3e0} Par appartement</h2>'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">' + apartRows + '</table>'
    + (pbList.length > 0 ? '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u{1f9f9} D\xe9tails des probl\xe8mes m\xe9nage</h2>' + pbHtml : '<div style="background:#f0fdf4;border-left:4px solid #10b981;padding:14px;border-radius:8px;margin:16px 0"><b style="color:#166534">\u2728 Aucun probl\xe8me m\xe9nage ' + (isWeekly ? 'cette semaine' : 'ce mois-ci') + ' !</b></div>')
    + q6Html
    + '<p style="margin-top:24px;font-size:13px;color:#64748b">Bon courage pour ' + (isWeekly ? 'la semaine qui commence' : 'le mois qui vient') + ' \u{1f64f}<br>Claudine</p>'
    + '<div style="margin-top:20px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center">Envoy\xe9 automatiquement ' + (isWeekly ? 'tous les lundis' : 'chaque fin de mois') + ' - Appart-H\xf4tel Berck</div>'
    + '</div></div>';

  MailApp.sendEmail({ to: presta.email, cc: ALERT_EMAIL, subject: sujet, htmlBody: html });
}

// ===== RECAP MENSUEL =====
function sendMonthlyRecap() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheetR = ss.getSheetByName('Reponses');
  if (!sheetR) return;
  var data = sheetR.getDataRange().getValues();
  var header = data[0];
  var now = new Date();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  var byPresta = { remi: { current: [], prev: [] }, clara: { current: [], prev: [] }, christelle: { current: [], prev: [] } };
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowDate = parseFrDate(row[0]);
    if (!rowDate) continue;
    var prestaKey = APPART_TO_PRESTA[row[2]];
    if (!prestaKey || !byPresta[prestaKey]) continue;
    if (rowDate >= monthStart) byPresta[prestaKey].current.push(rowToObj(row, header));
    else if (rowDate >= prevMonthStart) byPresta[prestaKey].prev.push(rowToObj(row, header));
  }

  Object.keys(byPresta).forEach(function(key) {
    var curr = byPresta[key].current;
    var prev = byPresta[key].prev;
    if (curr.length === 0) return;
    sendPrestaRecapEmail(key, curr, 'mensuel');
  });
}

// ===== UTILS DATA =====
function rowToObj(row, header) {
  var obj = {};
  obj.horodatage = row[0];
  obj.residence = row[1];
  obj.appart = row[2];
  obj.prestataire = row[3];
  obj.nom = row[4];
  obj.tel = row[5];
  obj.whatsapp = row[6];
  obj.ville = row[7];
  obj.zone = row[8];
  obj.email = row[9];
  obj.q1 = row[10];
  obj.q3 = row[11];
  obj.q4 = row[12];
  obj.q5 = row[13];
  obj.q5details = row[14];
  obj.q6 = row[15];
  obj.q7 = row[16];
  obj.q8 = row[17];
  obj.q9 = row[18];
  return obj;
}

function parseFrDate(str) {
  if (!str) return null;
  // Format "18/04/2026 12:00:00" ou "18/04/2026, 12:00:00"
  var m = String(str).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[\s,]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
}

function computeStats(avis) {
  if (avis.length === 0) return { menageScore: 100, returnScore: 0 };
  var menageOK = 0;
  var retour = 0;
  avis.forEach(function(a) {
    if (a.q5 === 'Correct' || a.q5 === 'Propre' || a.q5 === 'Tr\xe8s propre') menageOK++;
    if (a.q7 === 'Oui') retour++;
  });
  return {
    menageScore: Math.round(menageOK / avis.length * 100),
    returnScore: Math.round(retour / avis.length * 100)
  };
}

function formatDate(d) {
  return d.getDate() + '/' + (d.getMonth()+1) + '/' + d.getFullYear();
}
function monthName(d) {
  var m = ['janvier','f\xe9vrier','mars','avril','mai','juin','juillet','ao\xfbt','septembre','octobre','novembre','d\xe9cembre'];
  return m[d.getMonth()] + ' ' + d.getFullYear();
}
function shadeColor(hex, percent) {
  var R = parseInt(hex.substring(1,3),16), G = parseInt(hex.substring(3,5),16), B = parseInt(hex.substring(5,7),16);
  R = Math.min(255, Math.max(0, R + (R * percent / 100)));
  G = Math.min(255, Math.max(0, G + (G * percent / 100)));
  B = Math.min(255, Math.max(0, B + (B * percent / 100)));
  return '#' + Math.round(R).toString(16).padStart(2,'0') + Math.round(G).toString(16).padStart(2,'0') + Math.round(B).toString(16).padStart(2,'0');
}

// ===== INSTALLER LES TRIGGERS (a executer une fois manuellement) =====
function installTriggers() {
  // Supprimer anciens triggers
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendWeeklyRecap' || t.getHandlerFunction() === 'sendMonthlyRecap') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Hebdo : lundi 8h
  ScriptApp.newTrigger('sendWeeklyRecap').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  // Mensuel : dernier jour du mois 18h (on met le 28, puis la fonction v\xe9rifie)
  ScriptApp.newTrigger('sendMonthlyRecap').timeBased().onMonthDay(28).atHour(18).create();
  return 'Triggers install\xe9s : hebdo lundi 8h, mensuel le 28 du mois 18h';
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
