// =============================================
// GOOGLE APPS SCRIPT — Enquete Satisfaction v4
// =============================================
// Nouveautes v4 :
//   - Email HTML enrichi (fiche client, boutons clic-direct)
//   - Liens Booking / Airbnb / Beds24 pour retrouver la reservation
//   - Nouvelle colonne Q5 Details (description probleme menage)
//   - Nouvelle colonne Zone Vacances (A/B/C) selon la ville
//   - Migration auto : renomme les anciens onglets en _archive si structure differente
// =============================================

var SHEET_ID = '1Yqa2l_B4-mlNWI6AU14nBisEj3Xy4Kxic9qiH67Ra-k';
var ALERT_EMAIL = 'princessedopale@gmail.com';

// ===== HEADERS =====
var HEAD_REPONSES = [
  'Horodatage', 'Residence', 'Appartement',
  'Nom Prenom', 'Telephone', 'WhatsApp',
  'Ville/Region/Pays', 'Zone Vacances', 'Email',
  'Q1 Accueil', 'Q2 Attentes', 'Q3 Appreciation',
  'Q4 Qualite/Prix', 'Q5 Proprete', 'Q5 Details', 'Q6 Ameliorations',
  'Q7 Revenir', 'Q8 Recommander', 'Q9 Commentaire libre',
  'Consent Marketing'
];
var HEAD_EMAILS = [
  'Email', 'Nom Prenom', 'Telephone', 'WhatsApp',
  'Appartement', 'Residence',
  'Ville', 'Zone Vacances',
  'Date', 'Consent Marketing'
];
var HEAD_MARKETING = ['Email', 'Nom Prenom', 'Ville', 'Zone Vacances', 'Date inscription'];
var HEAD_VR = ['Email', 'Nom Prenom', 'Telephone', 'Ville', 'Zone Vacances', 'Appartement', 'Residence', 'Note Accueil', 'Recommande', 'Commentaire', 'Date'];
var HEAD_NR = ['Email', 'Nom Prenom', 'Telephone', 'Ville', 'Zone Vacances', 'Appartement', 'Residence', 'Note Accueil', 'Attentes OK', 'Proprete', 'Details Menage', 'Ameliorations', 'Commentaire', 'Date'];

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

    // --- Reponses ---
    var sheetR = ensureSheet(ss, 'Reponses', HEAD_REPONSES, '#0369a1');
    sheetR.appendRow([
      ts, p.residence || '', p.appart || '',
      p.nom || '', p.tel || '', p.whatsapp || 'non',
      p.ville || '', zone, p.email || '',
      p.q1 || '', p.q2 || '', p.q3 || '',
      p.q4 || '', p.q5 || '', p.q5details || '', p.q6 || '',
      p.q7 || '', p.q8 || '', p.q9 || '',
      p.consent || 'non'
    ]);
    colorRowBySentiment(sheetR, sheetR.getLastRow(), p, HEAD_REPONSES.length);

    // --- Emails ---
    if (p.email) {
      var sheetE = ensureSheet(ss, 'Emails', HEAD_EMAILS, '#10b981');
      sheetE.appendRow([
        p.email, p.nom || '', p.tel || '', p.whatsapp || 'non',
        p.appart || '', p.residence || '',
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
        p.appart || '', p.residence || '',
        p.q1 || '', p.q8 || '', p.q9 || '', ts
      ]);
    }

    // --- Ne veulent pas revenir ---
    if (p.email && p.q7 === 'Non') {
      var sheetNR = ensureSheet(ss, 'Ne veulent pas revenir', HEAD_NR, '#dc2626');
      sheetNR.appendRow([
        p.email, p.nom || '', p.tel || '', p.ville || '', zone,
        p.appart || '', p.residence || '',
        p.q1 || '', p.q2 || '', p.q5 || '',
        p.q5details || '', p.q6 || '', p.q9 || '', ts
      ]);
    }

    // --- ALERTE EMAIL ---
    var alertes = [];
    if (p.q5 === 'Sale') alertes.push('Propret\xe9 : SALE');
    if (p.q1 === 'M\xe9diocre') alertes.push('Accueil : M\xc9DIOCRE');
    if (p.q2 === 'Non') alertes.push('Attentes NON respect\xe9es');
    if (p.q4 === 'M\xe9diocre') alertes.push('Qualit\xe9/prix : M\xc9DIOCRE');
    if (p.q7 === 'Non') alertes.push('Ne veut PAS revenir');
    if (p.q8 === 'Non') alertes.push('Ne recommande PAS');

    if (alertes.length > 0) {
      try { sendAlertEmail(p, alertes, zone); } catch(err) {}
    }

    return json({ success: true });
  }

  if (action === 'getStats') {
    var sheetR = ss.getSheetByName('Reponses');
    if (!sheetR) return json({ data: [], count: 0 });
    var data = sheetR.getDataRange().getValues();
    return json({ data: data, count: data.length - 1 });
  }

  return json({ error: 'Action inconnue' });
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
  // Check header
  var lastCol = sheet.getLastColumn();
  if (lastCol < expectedHeader.length) {
    // Rename old, create new
    var archiveName = name + '_archive_' + new Date().getTime();
    sheet.setName(archiveName);
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
    var archiveName2 = name + '_archive_' + new Date().getTime();
    sheet.setName(archiveName2);
    sheet = ss.insertSheet(name);
    sheet.appendRow(expectedHeader);
    sheet.getRange(1, 1, 1, expectedHeader.length).setFontWeight('bold').setBackground(color).setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ===== COLORATION LIGNE SELON SENTIMENT =====
function sentimentScore(p) {
  var s = 0;
  if (p.q1 === 'M\xe9diocre') s -= 1;
  if (p.q1 === 'Tr\xe8s Bon') s += 1;
  if (p.q2 === 'Non') s -= 1;
  if (p.q2 === 'Oui') s += 1;
  if (p.q3 === 'M\xe9diocre') s -= 1;
  if (p.q3 === 'Tr\xe8s Bon') s += 1;
  if (p.q4 === 'M\xe9diocre') s -= 1;
  if (p.q4 === 'Tr\xe8s Bon') s += 1;
  if (p.q5 === 'Sale') s -= 1;
  if (p.q5 === 'Tr\xe8s propre') s += 1;
  if (p.q7 === 'Non') s -= 2;
  if (p.q7 === 'Oui') s += 2;
  if (p.q8 === 'Non') s -= 1;
  if (p.q8 === 'Oui') s += 1;
  return s;
}
function colorRowBySentiment(sheet, rowNum, p, nbCols) {
  var score = sentimentScore(p);
  var bg = null;
  if (score <= -2 || p.q7 === 'Non') bg = '#fecaca';       // rouge (mecontent)
  else if (score >= 4 && p.q7 === 'Oui') bg = '#bbf7d0';   // vert (tres content)
  else if (score >= 2) bg = '#dcfce7';                      // vert clair (content)
  else if (score <= -1) bg = '#fee2e2';                     // rouge clair (mitige neg)
  if (bg) sheet.getRange(rowNum, 1, 1, nbCols).setBackground(bg);
}

// ===== ZONE DE VACANCES SCOLAIRES (France) =====
function getZone(ville) {
  if (!ville) return '?';
  var v = String(ville).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');

  // Zone A : Besancon, Bordeaux, Clermont-Ferrand, Dijon, Grenoble, Limoges, Lyon, Poitiers
  var zA = ['lyon','bordeaux','grenoble','dijon','besancon','clermontferrand','limoges','poitiers','saintetienne','chambery','valence','angouleme','larochelle','pau','bayonne','biarritz','niort','roanne','annecy','aurillac','lepuyenvelay','brivelagaillarde','tulle','macon','auxerre','nevers','montlucon','vichy','moulins','perigueux','agen','montdemarsan','bourges','villeurbanne','villefranchesursone','anglet','dax'];

  // Zone B : Aix-Marseille, Amiens, Caen, Lille, Nancy-Metz, Nantes, Nice, Orleans-Tours, Reims, Rennes, Rouen, Strasbourg
  var zB = ['marseille','aixenprovence','nice','cannes','antibes','toulon','lille','amiens','caen','lehavre','rouen','nantes','rennes','brest','lorient','quimper','vannes','saintmalo','strasbourg','metz','nancy','reims','orleans','tours','angers','lemans','laval','colmar','mulhouse','troyes','chalonsenchampagne','beauvais','cherbourg','dieppe','evreux','saintbrieuc','saintnazaire','cholet','chartres','blois','epinal','charlevillemezieres','arras','boulognesurmer','calais','dunkerque','valenciennes','douai','lens','compiegne','laon','soissons','monaco','menton','frejus','saintraphael','hyeres','lavalette','avignon','carpentras','orange','menton','grasse','berck','letouquet','hardelot','stelle'];

  // Zone C : Creteil, Montpellier, Paris, Toulouse, Versailles
  var zC = ['paris','versailles','creteil','nanterre','boulognebillancourt','saintdenis','argenteuil','montreuil','vitrysurseine','courbevoie','asnieres','neuillysurseine','levalloisperret','issy','rueil','vincennes','antony','aulnaysousbois','champignysurmarne','drancy','meaux','melun','evry','corbeilessonnes','cergy','pontoise','sartrouville','mantes','poissy','saintgermainenlaye','saintmaur','ivry','colombes','saintouen','tremblay','noisy','sartrouville','toulouse','albi','cahors','montauban','foix','tarbes','auch','rodez','montpellier','nimes','beziers','perpignan','carcassonne','narbonne','sete','ales','castres','lunel','frontignan','canet','balaruc'];

  for (var i = 0; i < zA.length; i++) if (v.indexOf(zA[i]) !== -1) return 'A';
  for (var i = 0; i < zB.length; i++) if (v.indexOf(zB[i]) !== -1) return 'B';
  for (var i = 0; i < zC.length; i++) if (v.indexOf(zC[i]) !== -1) return 'C';

  // Etranger / inconnu
  return '?';
}

// ===== EMAIL ALERTE HTML =====
function sendAlertEmail(p, alertes, zone) {
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
    + noteRow('Accueil', p.q1, p.q1 === 'M\xe9diocre')
    + noteRow('Attentes respect\xe9es', p.q2, p.q2 === 'Non')
    + noteRow('Appr\xe9ciation g\xe9n\xe9rale', p.q3, p.q3 === 'M\xe9diocre')
    + noteRow('Qualit\xe9/prix', p.q4, p.q4 === 'M\xe9diocre')
    + noteRow('Propret\xe9', p.q5, p.q5 === 'Sale')
    + noteRow('Souhaite revenir', p.q7, p.q7 === 'Non')
    + noteRow('Recommanderait', p.q8, p.q8 === 'Non');

  var btn = 'display:inline-block;padding:12px 18px;margin:4px 6px 4px 0;border-radius:8px;text-decoration:none;font-weight:600;font-family:sans-serif;font-size:14px;';
  var btnCall = tel ? '<a href="tel:' + tel + '" style="' + btn + 'background:#0ea5e9;color:#fff">\u{1f4de} Appeler</a>' : '';
  var btnWa = (whatsapp && telIntl) ? '<a href="https://wa.me/' + telIntl + '" style="' + btn + 'background:#25d366;color:#fff">\u{1f4ac} WhatsApp</a>' : '';
  var btnMail = email ? '<a href="mailto:' + email + '?subject=Votre%20s\xe9jour%20\xe0%20' + encodeURIComponent(appart) + '" style="' + btn + 'background:#8b5cf6;color:#fff">\u2709\ufe0f Email</a>' : '';

  var btnBooking = '<a href="https://admin.booking.com/hotel/hoteladmin/groups/reservations/index.html" style="' + btn + 'background:#003580;color:#fff">\u{1f3e8} Booking Extranet</a>';
  var btnAirbnb = '<a href="https://www.airbnb.fr/hosting/reservations/upcoming" style="' + btn + 'background:#ff5a5f;color:#fff">\u{1f3e0} Airbnb H\xf4te</a>';
  var btnBeds24 = '<a href="https://beds24.com/control3.php?pagetype=rbooking" style="' + btn + 'background:#f59e0b;color:#fff">\u{1f4c5} Beds24</a>';

  var zoneBadge = zone && zone !== '?' ? '<span style="background:#ede9fe;color:#6d28d9;padding:3px 10px;border-radius:10px;font-size:12px;margin-left:8px;font-weight:700">Zone ' + zone + '</span>' : '';

  var detailsMenage = p.q5details ? ''
    + '<div style="background:#fef2f2;padding:12px 14px;border-radius:8px;border-left:4px solid #dc2626;margin:8px 0">'
    + '<strong style="color:#991b1b">\u{1f9f9} D\xe9tails m\xe9nage :</strong><br>'
    + '<span style="color:#7f1d1d;white-space:pre-wrap">' + escapeHtml(p.q5details) + '</span>'
    + '</div>' : '';

  var commentQ6 = p.q6 ? ''
    + '<div style="background:#f8fafc;padding:12px 14px;border-radius:8px;border-left:4px solid #64748b;margin:8px 0">'
    + '<strong>\u{1f4a1} Am\xe9liorations sugg\xe9r\xe9es :</strong><br>'
    + '<span style="white-space:pre-wrap">' + escapeHtml(p.q6) + '</span>'
    + '</div>' : '';

  var commentQ9 = p.q9 ? ''
    + '<div style="background:#fef3c7;padding:12px 14px;border-radius:8px;border-left:4px solid #f59e0b;margin:8px 0">'
    + '<strong>\u{1f4ac} Commentaire libre :</strong><br>'
    + '<span style="white-space:pre-wrap">' + escapeHtml(p.q9) + '</span>'
    + '</div>' : '';

  var html = ''
    + '<div style="font-family:-apple-system,sans-serif;max-width:640px;margin:0 auto;color:#1e293b">'
    + '<div style="background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:24px;border-radius:12px 12px 0 0">'
    + '<h1 style="margin:0;font-size:22px">\u{1f6a8} Avis ' + severity + ' re\xe7u</h1>'
    + '<p style="margin:6px 0 0;opacity:0.9">' + escapeHtml(appart) + (residence ? ' &middot; ' + escapeHtml(residence) : '') + ' &middot; ' + new Date().toLocaleString('fr-FR') + '</p>'
    + '</div>'

    + '<div style="background:#fff;padding:20px;border:1px solid #e2e8f0;border-top:none">'

    + '<div style="background:#fef2f2;border:2px solid #fecaca;border-radius:10px;padding:14px 18px;margin-bottom:20px">'
    + '<strong style="color:#991b1b;font-size:15px">Alertes d\xe9clench\xe9es :</strong>'
    + '<ul style="margin:8px 0 0;padding-left:20px">' + alertesHtml + '</ul>'
    + '</div>'

    + '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u{1f464} Fiche client</h2>'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px">'
    + '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;width:40%">Nom Pr\xe9nom</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-weight:700">' + escapeHtml(nom) + '</td></tr>'
    + '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b">T\xe9l\xe9phone</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">' + (tel ? '<a href="tel:' + tel + '" style="color:#0ea5e9;font-weight:600">' + escapeHtml(tel) + '</a>' : '-') + (whatsapp ? ' <span style="background:#25d366;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">WhatsApp OK</span>' : '') + '</td></tr>'
    + '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b">Email</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">' + (email ? '<a href="mailto:' + email + '" style="color:#8b5cf6;font-weight:600">' + escapeHtml(email) + '</a>' : '-') + '</td></tr>'
    + '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b">Ville</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">' + escapeHtml(ville) + zoneBadge + '</td></tr>'
    + '</table>'

    + '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u{1f4de} Contacter imm\xe9diatement</h2>'
    + '<div>' + btnCall + btnWa + btnMail + '</div>'

    + '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u{1f50d} Retrouver la r\xe9servation</h2>'
    + '<p style="font-size:13px;color:#64748b;margin:0 0 8px">Cherchez "<strong>' + escapeHtml(nom) + '</strong>" ou "<strong>' + escapeHtml(email) + '</strong>" :</p>'
    + '<div>' + btnBooking + btnAirbnb + btnBeds24 + '</div>'

    + '<h2 style="font-size:16px;color:#0369a1;margin:20px 0 10px">\u2b50 Notes d\xe9taill\xe9es</h2>'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">' + notes + '</table>'

    + detailsMenage
    + commentQ6
    + commentQ9

    + '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center">'
    + '<a href="https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit" style="color:#0369a1">\u{1f4ca} Voir tous les avis</a>'
    + ' &middot; Enqu\xeate Appart-H\xf4tel Berck (automatique)'
    + '</div>'

    + '</div>'
    + '</div>';

  MailApp.sendEmail({
    to: ALERT_EMAIL,
    subject: sujet,
    htmlBody: html
  });
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
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
