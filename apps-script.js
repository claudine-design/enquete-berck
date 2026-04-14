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
        'Nom Prenom', 'Telephone', 'Ville/Region/Pays', 'Email',
        'Q1 Accueil', 'Q2 Attentes', 'Q3 Appreciation',
        'Q4 Qualite/Prix', 'Q5 Proprete', 'Q6 Ameliorations',
        'Q7 Revenir', 'Q8 Recommander', 'Consent Marketing'
      ]);
      // Style en-tete
      sheetR.getRange(1, 1, 1, 16).setFontWeight('bold').setBackground('#0369a1').setFontColor('#ffffff');
      sheetR.setFrozenRows(1);
    }

    sheetR.appendRow([
      new Date().toLocaleString('fr-FR'),
      p.residence || '',
      p.appart || '',
      p.nom || '',
      p.tel || '',
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
      p.consent || 'non'
    ]);

    // --- Onglet Emails (tous les emails) ---
    var sheetE = ss.getSheetByName('Emails');
    if (!sheetE) {
      sheetE = ss.insertSheet('Emails');
      sheetE.appendRow(['Email', 'Nom Prenom', 'Appartement', 'Residence', 'Ville', 'Date', 'Consent Marketing']);
      sheetE.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#10b981').setFontColor('#ffffff');
      sheetE.setFrozenRows(1);
    }

    if (p.email) {
      sheetE.appendRow([
        p.email,
        p.nom || '',
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