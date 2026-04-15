// =============================================
// GOOGLE APPS SCRIPT — Enquete Satisfaction
// =============================================
// A deployer dans un NOUVEAU Google Sheet
// (ne pas modifier le Apps Script du Reassort)
//
// INSTRUCTIONS :
// 1. Creer un nouveau Google Sheet (ex: "Enquete Berck")
// 2. Extensions > Apps Script
// 3. Coller ce code (remplacer tout le contenu)
// 4. Deployer > Nouveau deploiement
//    - Type: Application Web
//    - Executer en tant que: Moi
//    - Acces: Tout le monde
// 5. Copier l'URL du deploiement
// 6. Coller cette URL dans questionnaire/index.html
//    (remplacer REMPLACER_PAR_URL_APPS_SCRIPT)
// =============================================

function doGet(e) {
  var action = e.parameter.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // === SOUMISSION ENQUETE ===
  if (action === 'submitEnquete') {
    var p = e.parameter;

    // --- Onglet Reponses ---
    var sheetR = ss.getSheetByName('Reponses');
    if (!sheetR) {
      sheetR = ss.insertSheet('Reponses');
      sheetR.appendRow([
        'Horodatage', 'Residence', 'Appartement',
        'Nom Prenom', 'Telephone', 'WhatsApp', 'Ville/Region/Pays', 'Email',
        'Q1 Accueil', 'Q2 Attentes', 'Q3 Appreciation',
        'Q4 Qualite/Prix', 'Q5 Proprete', 'Q6 Ameliorations',
        'Q7 Revenir', 'Q8 Recommander', 'Q9 Commentaire libre',
        'Consent Marketing'
      ]);
      // Style en-tete
      sheetR.getRange(1, 1, 1, 18).setFontWeight('bold').setBackground('#0369a1').setFontColor('#ffffff');
      sheetR.setFrozenRows(1);
    }

    sheetR.appendRow([
      new Date().toLocaleString('fr-FR'),
      p.residence || '',
      p.appart || '',
      p.nom || '',
      p.tel || '',
      p.whatsapp || 'non',
      p.ville || '',
      p.email || '',
      p.q1 || '',
      p.q2 || '',
      p.q3 || '',
      p.q4 || '',
      p.q5 || '',
      p.q6 || '',
      p.q7 || '',
      p.q8 || '',
      p.q9 || '',
      p.consent || 'non'
    ]);

    // --- Onglet Emails (tous les emails) ---
    var sheetE = ss.getSheetByName('Emails');
    if (!sheetE) {
      sheetE = ss.insertSheet('Emails');
      sheetE.appendRow(['Email', 'Nom Prenom', 'Telephone', 'WhatsApp', 'Appartement', 'Residence', 'Ville', 'Date', 'Consent Marketing']);
      sheetE.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#10b981').setFontColor('#ffffff');
      sheetE.setFrozenRows(1);
    }

    if (p.email) {
      sheetE.appendRow([
        p.email,
        p.nom || '',
        p.tel || '',
        p.whatsapp || 'non',
        p.appart || '',
        p.residence || '',
        p.ville || '',
        new Date().toLocaleString('fr-FR'),
        p.consent || 'non'
      ]);
    }

    // --- Onglet Emails Marketing (seulement ceux qui ont consenti) ---
    if (p.consent === 'oui' && p.email) {
      var sheetM = ss.getSheetByName('Emails Marketing');
      if (!sheetM) {
        sheetM = ss.insertSheet('Emails Marketing');
        sheetM.appendRow(['Email', 'Nom Prenom', 'Ville', 'Date inscription']);
        sheetM.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#f59e0b').setFontColor('#ffffff');
        sheetM.setFrozenRows(1);
      }
      sheetM.appendRow([
        p.email,
        p.nom || '',
        p.ville || '',
        new Date().toLocaleString('fr-FR')
      ]);
    }

    // --- Onglet "Veulent Revenir" (Q7 = Oui ou Peut-etre) ---
    if (p.email && (p.q7 === 'Oui' || p.q7 === 'Peut-\u00eatre')) {
      var sheetVR = ss.getSheetByName('Veulent Revenir');
      if (!sheetVR) {
        sheetVR = ss.insertSheet('Veulent Revenir');
        sheetVR.appendRow(['Email', 'Nom Prenom', 'Telephone', 'Ville', 'Appartement', 'Residence', 'Note Accueil', 'Recommande', 'Commentaire', 'Date']);
        sheetVR.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#10b981').setFontColor('#ffffff');
        sheetVR.setFrozenRows(1);
      }
      sheetVR.appendRow([
        p.email, p.nom || '', p.tel || '', p.ville || '',
        p.appart || '', p.residence || '',
        p.q1 || '', p.q8 || '', p.q9 || '',
        new Date().toLocaleString('fr-FR')
      ]);
    }

    // --- Onglet "Ne veulent pas revenir" (Q7 = Non) ---
    if (p.email && p.q7 === 'Non') {
      var sheetNR = ss.getSheetByName('Ne veulent pas revenir');
      if (!sheetNR) {
        sheetNR = ss.insertSheet('Ne veulent pas revenir');
        sheetNR.appendRow(['Email', 'Nom Prenom', 'Telephone', 'Ville', 'Appartement', 'Residence', 'Note Accueil', 'Attentes OK', 'Proprete', 'Ameliorations', 'Commentaire', 'Date']);
        sheetNR.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#dc2626').setFontColor('#ffffff');
        sheetNR.setFrozenRows(1);
      }
      sheetNR.appendRow([
        p.email, p.nom || '', p.tel || '', p.ville || '',
        p.appart || '', p.residence || '',
        p.q1 || '', p.q2 || '', p.q5 || '',
        p.q6 || '', p.q9 || '',
        new Date().toLocaleString('fr-FR')
      ]);
    }

    // --- ALERTE EMAIL automatique si avis negatif ---
    var alertes = [];
    if (p.q5 === 'Sale') alertes.push('\u26a0\ufe0f Propret\u00e9 : SALE');
    if (p.q1 === 'M\u00e9diocre') alertes.push('\u26a0\ufe0f Accueil : M\u00c9DIOCRE');
    if (p.q2 === 'Non') alertes.push('\u26a0\ufe0f Attentes NON respect\u00e9es');
    if (p.q4 === 'M\u00e9diocre') alertes.push('\u26a0\ufe0f Qualit\u00e9/prix : M\u00c9DIOCRE');
    if (p.q7 === 'Non') alertes.push('\u26a0\ufe0f Ne veut PAS revenir');

    if (alertes.length > 0) {
      var sujet = '\u{1f6a8} ALERTE ENQUETE - ' + (p.appart || '?') + ' (' + (p.residence || '') + ')';
      var corps = 'Bonjour Claudine,\n\n'
        + 'Un voyageur vient de donner un avis n\u00e9gatif :\n\n'
        + '\u{1f3e0} Appartement : ' + (p.appart || '?') + ' (' + (p.residence || '') + ')\n'
        + '\u{1f464} Voyageur : ' + (p.nom || '?') + '\n'
        + '\u{1f4e7} Email : ' + (p.email || '?') + '\n'
        + '\u{1f4de} T\u00e9l : ' + (p.tel || 'non renseign\u00e9') + (p.whatsapp === 'oui' ? ' (WhatsApp \u2705)' : '') + '\n'
        + '\u{1f4cd} Ville : ' + (p.ville || '?') + '\n\n'
        + '--- ALERTES ---\n'
        + alertes.join('\n') + '\n\n'
        + '--- D\u00c9TAIL DES NOTES ---\n'
        + 'Accueil : ' + (p.q1 || '?') + '\n'
        + 'Attentes : ' + (p.q2 || '?') + '\n'
        + 'Appr\u00e9ciation : ' + (p.q3 || '?') + '\n'
        + 'Qualit\u00e9/prix : ' + (p.q4 || '?') + '\n'
        + 'Propret\u00e9 : ' + (p.q5 || '?') + '\n'
        + 'Am\u00e9liorations : ' + (p.q6 || 'aucune') + '\n'
        + 'Revenir : ' + (p.q7 || '?') + '\n'
        + 'Recommande : ' + (p.q8 || '?') + '\n\n'
        + '--- COMMENTAIRE LIBRE ---\n'
        + (p.q9 || '(aucun commentaire)') + '\n\n'
        + '---\nEnqu\u00eate Appart-H\u00f4tel Berck (automatique)';

      try {
        MailApp.sendEmail('princessedopale@gmail.com', sujet, corps);
      } catch(err) {
        // silencieux si quota email depasse
      }
    }

    return json({ success: true });
  }

  // === STATISTIQUES (pour usage futur) ===
  if (action === 'getStats') {
    var sheetR = ss.getSheetByName('Reponses');
    if (!sheetR) return json({ data: [], count: 0 });
    var data = sheetR.getDataRange().getValues();
    return json({ data: data, count: data.length - 1 });
  }

  return json({ error: 'Action inconnue' });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}