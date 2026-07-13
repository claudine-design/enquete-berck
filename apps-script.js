// =============================================
// GOOGLE APPS SCRIPT — Enquete Satisfaction v9
// =============================================
// Nouveautes v9 (13 juillet 2026) — parrainage branche de bout en bout :
//   - Validation filleul ACTIVE : champ code parrain reintroduit dans le questionnaire
//   - Fini le code generique FIDELE-10 : recompenses = BONS UNIQUES a usage unique
//     (onglet 'Bons Fidelite', pre-crees dans Beds24 en One Time Use Voucher Codes)
//   - Validite d'un bon : 18 mois a partir de l'attribution (decision Claudine 13/07/2026)
//   - Anti-fraude : parrain != filleul + un filleul ne peut etre parraine qu'UNE fois
//   - Robots : reconciliation quotidienne des bons consommes (API Beds24 read-only)
//     + detection hebdo des bons expires (liste de purge Beds24 envoyee a Claudine)
//   - Prenom/Nom separes dans le questionnaire (code parrain = prenom uniquement)
// + v6 : generation code BERCK-PRENOM-XXXX si Q7=Oui ET Q8=Oui
// + v5 : 5 niveaux Q1/Q3/Q4/Q5, mapping prestataires, recaps hebdo/mensuel
// =============================================

var SHEET_ID = '1Yqa2l_B4-mlNWI6AU14nBisEj3Xy4Kxic9qiH67Ra-k';
var ALERT_EMAIL = 'princessedopale@gmail.com';
var SITE_URL = 'https://appart-hotel-berck.com';

// ===== v9 : BONS FIDELITE UNIQUES =====
// Plus AUCUN code promo generique : chaque recompense est un bon nominatif a usage
// unique, pioche dans le pool de l'onglet 'Bons Fidelite' (statut DISPONIBLE).
// Les memes codes doivent exister dans Beds24 : (SETTINGS) BOOKING ENGINE >
// MULTIPLE PROPERTIES > One Time Use Voucher Codes (supprimes par Beds24 apres usage).
var BON_VALIDITE_MOIS = 18;   // validite d'un bon a partir de son attribution
var BON_STOCK_ALERTE = 8;     // alerte Claudine s'il reste moins de N bons disponibles

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
  'Q1 Arrivee', 'Q1 Details', 'Q3 Appreciation', 'Q4 Qualite/Prix',
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
var HEAD_PARRAINS = ['Code Parrain', 'Nom Prenom', 'Email', 'Telephone', 'Appartement', 'Residence', 'Date Creation', 'Nb Utilisations', 'Derniere Utilisation'];
var HEAD_PARRAINAGES = ['Date Validation', 'Code Parrain Utilise', 'Parrain Nom', 'Parrain Email', 'Filleul Nom', 'Filleul Email', 'Filleul Appartement', 'Filleul Date Sejour', 'Bon Parrain', 'Bon Filleul'];
var HEAD_BONS = ['Code Bon', 'Statut', 'Role', 'Attribue A', 'Email', 'Code Parrain Lie', 'Date Attribution', 'Date Expiration', 'Date Consommation', 'Note'];
var HEAD_ROUTINES = ['Date Fait', 'Appart Slug', 'Task Id', 'Task Label', 'Prestataire'];
var HEAD_SIGNALEMENTS = ['ID', 'Date Creation', 'Appart Slug', 'Source', 'Voyageur', 'Element', 'Description', 'Action Prestataire', 'Statut', 'Date Resolu', 'Resolu Par', 'Calendar Event ID'];
var DRAPS_CALENDAR_ID = '8e2aa92cb418bfa01e1a133d5835ef14be76315442ba4703e67431393ffca07b@group.calendar.google.com';

// ===== CALENDRIERS PRESTATAIRES (warning event horaire 10h en plus du DraPS) =====
// 6 calendriers prestataires partages avec princessedopale@gmail.com en ecriture.
// A la creation d un signalement, on lookup ces calendriers pour trouver qui fait l appart le jour J
// et on cree un event horaire 10h-11h dans CE calendrier (en plus de l event DraPS lifecycle 3 couleurs).
var PRESTA_CALENDARS = [
  { id: '5komu9vu780a52psebg26050mk@group.calendar.google.com',                              name: 'CLARA' },
  { id: '4028e3ed47b85a7d6b42d587706f033e92d657bce37b448b1017b8087065c974@group.calendar.google.com', name: 'REMI' },
  { id: 'a220b7d87ee6888b19af13544e40b144f11cbd59daac57f26225d576cf22a754@group.calendar.google.com', name: 'CHRISTELLE' },
  { id: 'a64e7f79aab3bc750e71306871ffbf31494f3028d4601d065fa79caab3fc4bbf@group.calendar.google.com', name: 'AIMANCE' },
  { id: 'family09571682492750317707@group.calendar.google.com',                              name: 'STEPHANIE' },
  { id: 'appart.hotel.berck@gmail.com',                                                      name: 'CLAIRE-SEBASTIEN' }
];
// Mapping slug appart -> patterns texte a matcher dans le titre de l event prestataire (case + accent insensible)
var SLUG_MATCH_PATTERNS = {
  'face-mer':         ['face mer', 'facemer'],
  'cocon-romantique': ['cocon'],
  'mini-love-room':   ['mini love', 'minilove', 'mini-love'],
  'grande-love-room': ['grande love', 'grandelove', 'grande-love'],
  'grand-large':      ['grand large', 'grand-large'],
  'balneo':           ['balneo', 'balneo garden'],
  'apolove':          ['apolove'],
  'apollo':           ['apollo'],
  'kingston':         ['kingston'],
  'jeanne':           ['jeanne', 'rue jeanne'],
  'rotonde':          ['rotonde'],
  'patio':            ['patio'],
  'evasion':          ['evasion'],
  'maisonnette':      ['maisonnette', 'coeur'],
  'famille':          ['famille'],
  'hamac':            ['hamac'],
  'kitesurf':         ['kitesurf', 'kite'],
  'surf':             ['surf'],
  'paddle':           ['paddle'],
  'albatros':         ['albatros'],
  'reserve':          ['reserve'],
  'terrasse':         ['terrasse'],
  'helene':           ['helene', 'studio helene']
};

// ===== ROUTINES PERIODIQUES (entretien Sweepy-style) =====
// Toutes les taches sont definies cote frontend ; le backend ne fait que stocker/lire l'historique.
// Validation par format (alphanumerique + tirets, 1-40 chars) pour pouvoir ajouter
// de nouvelles routines cote frontend sans avoir a redeployer l'Apps Script.
var ROUTINE_TASK_ID_REGEX = /^[a-z0-9-]{1,40}$/;

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

    // v9 : prenom / nom separes dans le questionnaire (retro-compatible ancien champ unique)
    if (p.prenom) {
      p.nom = (String(p.prenom).trim() + ' ' + String(p.nomfamille || '').trim()).trim();
    }

    // --- Reponses ---
    var sheetR = ensureSheet(ss, 'Reponses', HEAD_REPONSES, '#0369a1');
    sheetR.appendRow([
      ts, p.residence || '', p.appart || '', prestaNom,
      p.nom || '', p.tel || '', p.whatsapp || 'non',
      p.ville || '', zone, p.email || '',
      p.q1 || '', p.q1details || '', p.q3 || '', p.q4 || '',
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
    // v8 (29 avril 2026) : on ajoute TOUS les voyageurs SAUF ceux qui ont répondu Q7=Non
    // (intérêt légitime RGPD pour ses propres clients, opt-out via lien désinscription dans les emails)
    if (p.email && p.q7 !== 'Non') {
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

    // --- PARRAINAGE : generer le code parrain si voyageur tres satisfait ---
    var parrainCodeGenere = null;
    if (p.email && p.nom && p.q7 === 'Oui' && p.q8 === 'Oui') {
      try {
        parrainCodeGenere = genererOuRecupererCodeParrain(ss, p);
      } catch(err) {}
    }

    // --- PARRAINAGE v9 : valider le code parrain entre par le filleul ---
    // La saisie dans le questionnaire (accessible uniquement dans l'appartement)
    // prouve un sejour reel. La validation attribue 2 bons uniques (parrain + filleul).
    var parrainValide = false;
    if (p.email && p.parrainUtilise) {
      try {
        parrainValide = validerEtNotifierParrainage(ss, {
          nom: p.nom || '',
          email: p.email,
          appart: p.appart || ''
        }, p.parrainUtilise);
      } catch(err) {}
    }

    return json({
      success: true,
      parrainCode: parrainCodeGenere,
      parrainValide: parrainValide
    });
  }

  if (action === 'getStats') {
    var sheetR = ss.getSheetByName('Reponses');
    if (!sheetR) return json({ data: [], count: 0 });
    var data = sheetR.getDataRange().getValues();
    return json({ data: data, count: data.length - 1 });
  }

  if (action === 'runWeeklyRecap')  { sendWeeklyRecap(); return json({ success: true }); }
  if (action === 'runMonthlyRecap') { sendMonthlyRecap(); return json({ success: true }); }

  // ===== ROUTINES PERIODIQUES (Sweepy-style) =====
  if (action === 'getRoutines') {
    // Renvoie la derniere date de chaque routine pour un appart donne.
    // Param : appart=<slug> (optionnel : si absent, renvoie tout)
    var sheetRt = ss.getSheetByName('Routines');
    if (!sheetRt) return json({ data: {} });
    var rows = sheetRt.getDataRange().getValues();
    if (rows.length < 2) return json({ data: {} });
    var byAppart = {}; // { appart_slug: { task_id: { lastDone: ISO, prestataire: '...' } } }
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var dateFait = r[0];
      var slug = String(r[1] || '').toLowerCase();
      var taskId = String(r[2] || '');
      var presta = String(r[4] || '');
      if (!slug || !taskId || !dateFait) continue;
      var t = (dateFait instanceof Date) ? dateFait.getTime() : new Date(dateFait).getTime();
      if (!byAppart[slug]) byAppart[slug] = {};
      var prev = byAppart[slug][taskId];
      // Garder la plus recente
      if (!prev || (prev._t || 0) < t) {
        byAppart[slug][taskId] = { lastDone: new Date(t).toISOString(), prestataire: presta, _t: t };
      }
    }
    // Cleanup _t (helper interne)
    Object.keys(byAppart).forEach(function(s){
      Object.keys(byAppart[s]).forEach(function(tid){ delete byAppart[s][tid]._t; });
    });
    var filterAppart = (p.appart || '').toString().toLowerCase().trim();
    if (filterAppart) {
      return json({ data: byAppart[filterAppart] || {} });
    }
    return json({ data: byAppart });
  }

  if (action === 'markRoutineDone') {
    // Enregistre qu'une routine vient d'etre faite.
    // Params : appart=<slug>, task=<taskId>, label=<task label>, presta=<nom prestataire>
    var slug = (p.appart || '').toString().toLowerCase().trim();
    var taskId = (p.task || '').toString().trim();
    var label = (p.label || '').toString().trim();
    var presta = (p.presta || '').toString().trim();
    if (!slug || !taskId) return json({ error: 'appart et task requis' });
    if (!ROUTINE_TASK_ID_REGEX.test(taskId)) return json({ error: 'task_id invalide : ' + taskId });
    var sheetRt = ensureSheet(ss, 'Routines', HEAD_ROUTINES, '#16a34a');
    sheetRt.appendRow([new Date(), slug, taskId, label, presta]);
    return json({ success: true, lastDone: new Date().toISOString() });
  }

  if (action === 'undoRoutineDone') {
    // Supprime la DERNIERE entree du sheet Routines pour ce appart+task.
    // Utilise pour annuler un click "Fait" errone.
    // Params : appart=<slug>, task=<taskId>
    var slug = (p.appart || '').toString().toLowerCase().trim();
    var taskId = (p.task || '').toString().trim();
    if (!slug || !taskId) return json({ error: 'appart et task requis' });
    if (!ROUTINE_TASK_ID_REGEX.test(taskId)) return json({ error: 'task_id invalide : ' + taskId });
    var sheetRt2 = ss.getSheetByName('Routines');
    if (!sheetRt2) return json({ error: 'Aucune routine enregistree' });
    var data = sheetRt2.getDataRange().getValues();
    // Cherche la derniere ligne (la plus recente) qui matche
    var foundRow = -1;
    var foundTime = -1;
    for (var i = 1; i < data.length; i++) {
      var rowSlug = String(data[i][1] || '').toLowerCase();
      var rowTask = String(data[i][2] || '');
      if (rowSlug === slug && rowTask === taskId) {
        var t = (data[i][0] instanceof Date) ? data[i][0].getTime() : new Date(data[i][0]).getTime();
        if (t > foundTime) { foundTime = t; foundRow = i + 1; } // +1 car sheet rows sont 1-indexed
      }
    }
    if (foundRow === -1) return json({ error: 'Aucune entree trouvee pour cet appart+task' });
    sheetRt2.deleteRow(foundRow);
    // Renvoie la nouvelle "derniere date" (precedente entree restante) ou null
    var newLast = null;
    var dataAfter = sheetRt2.getDataRange().getValues();
    var newTime = -1;
    for (var j = 1; j < dataAfter.length; j++) {
      var s2 = String(dataAfter[j][1] || '').toLowerCase();
      var t2 = String(dataAfter[j][2] || '');
      if (s2 === slug && t2 === taskId) {
        var ts = (dataAfter[j][0] instanceof Date) ? dataAfter[j][0].getTime() : new Date(dataAfter[j][0]).getTime();
        if (ts > newTime) { newTime = ts; newLast = new Date(ts).toISOString(); }
      }
    }
    return json({ success: true, lastDone: newLast });
  }

  // ===== SIGNALEMENTS VOYAGEURS (problemes a regler par le menage) =====
  if (action === 'getSignalements') {
    // Renvoie les signalements OUVERTS pour un appart (statut === 'ouvert').
    // Les statuts 'fait-prestataire', 'valide-claudine', 'resolu' sont caches sauf si incluResolus=1.
    // Param : appart=<slug> (obligatoire), incluResolus=1 (optionnel)
    var slug = (p.appart || '').toString().toLowerCase().trim();
    var sheetSig = ss.getSheetByName('Signalements');
    if (!sheetSig) return json({ data: [] });
    var rows = sheetSig.getDataRange().getValues();
    if (rows.length < 2) return json({ data: [] });
    var includeResolved = (p.incluResolus === '1' || p.incluResolus === 'true');
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var rowSlug = String(r[2] || '').toLowerCase();
      if (slug && rowSlug !== slug) continue;
      // Statut col 9 (index 8). Tout ce qui n'est pas 'ouvert' est cache du prestataire.
      var realStatut = String(r[8] || 'ouvert').toLowerCase();
      if (!includeResolved && realStatut !== 'ouvert') continue;
      out.push({
        id: r[0],
        dateCreation: r[1],
        appartSlug: r[2],
        source: r[3],
        voyageur: r[4],
        element: r[5],
        description: r[6],
        action: r[7] || '',
        statut: r[8] || 'ouvert',
        dateResolu: r[9] || null,
        resoluPar: r[10] || null,
        eventId: r[11] || null,
        rowIndex: i + 1
      });
    }
    return json({ data: out });
  }

  if (action === 'addSignalement') {
    // Cree un nouveau signalement.
    // Params : appart, source (beds24|email|whatsapp|manuel), voyageur, element, description
    var slug2 = (p.appart || '').toString().toLowerCase().trim();
    if (!slug2) return json({ error: 'appart requis' });
    var sheetSig2 = ensureSheet(ss, 'Signalements', HEAD_SIGNALEMENTS, '#dc2626');
    var sigId = 'sig-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    // ⚠️ "action" est un param reserve (= endpoint name), donc on accepte aussi "actionPresta"
    var actionPresta = (p.actionPresta || p.action_presta || '');
    var element = (p.element || '');
    var description = (p.description || '');
    var source = (p.source || 'manuel');
    var voyageur = (p.voyageur || '');

    // Creer un event Calendar dans DraPS (best-effort, ne pas bloquer si echec)
    // Lifecycle : 🔴 RED (cree) -> 🟡 YELLOW (fait par prestataire) -> 🟢 GREEN (valide Claudine)
    var eventId = '';
    try {
      var cal = CalendarApp.getCalendarById(DRAPS_CALENDAR_ID);
      if (cal) {
        var title = '🔴 ' + slug2.toUpperCase() + ' : ' + (element || description.substring(0, 60) || 'Signalement voyageur');
        var webAppUrl = '';
        try { webAppUrl = ScriptApp.getService().getUrl(); } catch (urlErr) { webAppUrl = ''; }
        var validateLink = webAppUrl ? (webAppUrl + '?action=tapValidateSignalement&id=' + encodeURIComponent(sigId)) : '';
        var bodyParts = [];
        bodyParts.push('Signalement voyageur a regler par le menage.');
        bodyParts.push('');
        if (voyageur) bodyParts.push('Voyageur : ' + voyageur);
        if (source) bodyParts.push('Source : ' + source);
        if (description) bodyParts.push('Description : ' + description);
        if (actionPresta) bodyParts.push('');
        if (actionPresta) bodyParts.push('Action prestataire : ' + actionPresta);
        bodyParts.push('');
        if (validateLink) {
          bodyParts.push('✅ Quand tu valides (passage au vert) : ' + validateLink);
          bodyParts.push('');
        }
        bodyParts.push('ID : ' + sigId);
        var event = cal.createAllDayEvent(title, new Date(), { description: bodyParts.join('\n') });
        // Supprimer les rappels par defaut du calendrier (sinon Claudine recoit popup + email = 2 notifs)
        event.removeAllReminders();
        // Couleur RED pour signaler "a faire"
        try { event.setColor(CalendarApp.EventColor.RED); } catch (colErr) {}
        eventId = event.getId();
      }
    } catch (calErr) {
      // Si Calendar non accessible, on continue sans bloquer
      eventId = 'err:' + (calErr.message || 'unknown').substring(0, 50);
    }

    // Creer aussi un event WARNING horaire 10h-11h ROUGE 🚨 dans le calendrier
    // du prestataire qui fait l appart le jour J (lookup dynamique sur les 6 calendriers).
    // Best-effort : ne pas bloquer si echec.
    var prestaEventId = '';
    try {
      prestaEventId = createPrestaWarningEvent_(slug2, sigId, voyageur, element, description, actionPresta);
    } catch (prestaErr) {
      Logger.log('addSignalement : createPrestaWarningEvent_ erreur : ' + prestaErr.message);
    }

    sheetSig2.appendRow([
      sigId,
      new Date(),
      slug2,
      source,
      voyageur,
      element,
      description,
      actionPresta,
      'ouvert',
      '',
      '',
      eventId
    ]);
    return json({ success: true, id: sigId, eventId: eventId, prestaEventId: prestaEventId });
  }

  if (action === 'markSignalementResolu' || action === 'markSignalementFaitPresta') {
    // Etape 1 du lifecycle : prestataire a fait le menage et reglé le probleme.
    // Statut 'fait-prestataire', couleur YELLOW, titre 🟡.
    // Params : id=<sigId>, par=<nom prestataire>
    var sigId3 = (p.id || '').toString().trim();
    if (!sigId3) return json({ error: 'id requis' });
    var sheetSig3 = ss.getSheetByName('Signalements');
    if (!sheetSig3) return json({ error: 'Aucun signalement' });
    var rows3 = sheetSig3.getDataRange().getValues();
    for (var k = 1; k < rows3.length; k++) {
      if (String(rows3[k][0]) === sigId3) {
        // Statut col 9, Date Resolu col 10, Resolu Par col 11
        sheetSig3.getRange(k + 1, 9).setValue('fait-prestataire');
        sheetSig3.getRange(k + 1, 10).setValue(new Date());
        sheetSig3.getRange(k + 1, 11).setValue((p.par || ''));
        // Mettre a jour event Calendar : YELLOW + titre 🟡 + qui a fait
        try {
          var existingEventId = rows3[k][11];
          if (existingEventId && existingEventId.toString().indexOf('err:') !== 0) {
            var cal3 = CalendarApp.getCalendarById(DRAPS_CALENDAR_ID);
            if (cal3) {
              var ev = cal3.getEventById(existingEventId);
              if (ev) {
                var oldTitle = ev.getTitle();
                var cleanTitle = oldTitle.replace(/^🔴\s*/, '').replace(/^🚨\s*/, '').replace(/^🟡\s*/, '').replace(/^🟢\s*/, '').replace(/^✅ RÉGLÉ — /, '').replace(/\s+— fait par .+$/, '').replace(/\s+✓$/, '');
                ev.setTitle('🟡 ' + cleanTitle + ' — fait par ' + (p.par || 'prestataire'));
                try { ev.setColor(CalendarApp.EventColor.YELLOW); } catch (colErr) {}
                var oldDesc = ev.getDescription() || '';
                ev.setDescription('🟡 Fait le ' + new Date().toISOString().substring(0,10) + ' par : ' + (p.par || 'inconnu') + ' — en attente de validation Claudine.\n\n' + oldDesc);
              }
            }
          }
        } catch (calErr2) {
          // ignore
        }
        return json({ success: true, statut: 'fait-prestataire' });
      }
    }
    return json({ error: 'Signalement ' + sigId3 + ' introuvable' });
  }

  if (action === 'tapValidateSignalement') {
    // Etape 2 du lifecycle : Claudine tape le lien dans son event Calendar pour valider.
    // Statut 'valide-claudine', couleur GREEN, titre 🟢 ✓.
    // Renvoie une page HTML conviviale (PAS du JSON) car click depuis Calendar.
    // Params : id=<sigId>
    var sigId4 = (p.id || '').toString().trim();
    if (!sigId4) return HtmlService.createHtmlOutput(htmlSignalementResult_('❌', 'ID requis', 'Lien Calendar mal forme.'));
    var sheetSig4 = ss.getSheetByName('Signalements');
    if (!sheetSig4) return HtmlService.createHtmlOutput(htmlSignalementResult_('❌', 'Erreur', 'Pas de sheet Signalements.'));
    var rows4 = sheetSig4.getDataRange().getValues();
    for (var kk = 1; kk < rows4.length; kk++) {
      if (String(rows4[kk][0]) === sigId4) {
        var appartName4 = rows4[kk][2] || '';
        var element4 = rows4[kk][5] || '';
        // Statut col 9
        sheetSig4.getRange(kk + 1, 9).setValue('valide-claudine');
        // Calendar : GREEN + titre 🟢 + ✓
        try {
          var existingEventId4 = rows4[kk][11];
          if (existingEventId4 && existingEventId4.toString().indexOf('err:') !== 0) {
            var cal4 = CalendarApp.getCalendarById(DRAPS_CALENDAR_ID);
            if (cal4) {
              var ev4 = cal4.getEventById(existingEventId4);
              if (ev4) {
                var oldTitle4 = ev4.getTitle();
                var cleanTitle4 = oldTitle4.replace(/^🔴\s*/, '').replace(/^🚨\s*/, '').replace(/^🟡\s*/, '').replace(/^🟢\s*/, '').replace(/^✅ RÉGLÉ — /, '').replace(/\s+✓$/, '');
                ev4.setTitle('🟢 ' + cleanTitle4 + ' ✓');
                try { ev4.setColor(CalendarApp.EventColor.GREEN); } catch (colErr3) {}
                var oldDesc4 = ev4.getDescription() || '';
                ev4.setDescription('🟢 Validé par Claudine le ' + new Date().toISOString().substring(0,10) + '.\n\n' + oldDesc4);
              }
            }
          }
        } catch (calErr4) {
          // ignore
        }
        return HtmlService.createHtmlOutput(htmlSignalementResult_('🟢', 'Validé !', 'Signalement <strong>' + appartName4.toString().toUpperCase() + ' — ' + element4 + '</strong> marqué comme validé. L\'event Calendar est passé au vert. Tu peux fermer cet onglet.'));
      }
    }
    return HtmlService.createHtmlOutput(htmlSignalementResult_('❌', 'Introuvable', 'Signalement ' + sigId4 + ' inexistant.'));
  }

  return json({ error: 'Action inconnue' });
}

// Helper : genere page HTML conviviale pour les actions tap-depuis-Calendar
function htmlSignalementResult_(emoji, title, message) {
  var bg = emoji === '🟢' ? '#dcfce7' : (emoji === '❌' ? '#fee2e2' : '#fef3c7');
  var fg = emoji === '🟢' ? '#166534' : (emoji === '❌' ? '#991b1b' : '#92400e');
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;text-align:center;padding:80px 20px;background:' + bg + ';color:' + fg + ';margin:0;min-height:100vh;box-sizing:border-box}' +
    'h1{font-size:80px;margin:0;line-height:1}h2{font-size:32px;margin:20px 0}p{font-size:18px;line-height:1.5;max-width:500px;margin:20px auto}' +
    '</style></head><body><h1>' + emoji + '</h1><h2>' + title + '</h2><p>' + message + '</p></body></html>';
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
  var geres = ['sendWeeklyRecap', 'sendMonthlyRecap', 'robotReconciliationBons', 'robotExpirationBons'];
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (geres.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Hebdo : lundi 8h
  ScriptApp.newTrigger('sendWeeklyRecap').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  // Mensuel : dernier jour du mois 18h (on met le 28, puis la fonction v\xe9rifie)
  ScriptApp.newTrigger('sendMonthlyRecap').timeBased().onMonthDay(28).atHour(18).create();
  // v9 : reconciliation quotidienne des bons consommes (6h) + expiration hebdo (lundi 7h)
  ScriptApp.newTrigger('robotReconciliationBons').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('robotExpirationBons').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  return 'Triggers install\xe9s : recaps hebdo/mensuel + robots bons fid\xe9lit\xe9 (quotidien 6h + lundi 7h)';
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

// ===== PARRAINAGE : generation du code parrain du voyageur =====
function genererOuRecupererCodeParrain(ss, p) {
  var sheet = ensureSheet(ss, 'Parrains', HEAD_PARRAINS, '#a855f7');
  var data = sheet.getDataRange().getValues();

  // Verifier si ce voyageur (email) a deja un code parrain -> le reutiliser
  for (var i = 1; i < data.length; i++) {
    if (data[i][2] && String(data[i][2]).toLowerCase() === String(p.email).toLowerCase()) {
      return data[i][0]; // code deja existant
    }
  }

  // Generer un nouveau code unique
  // v9 : priorite au champ prenom dedie (jamais le nom de famille dans un code qui circule)
  var prenom = String(p.prenom || String(p.nom || 'AMI').split(' ')[0]).toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z]/g, '').substring(0, 10);
  if (!prenom) prenom = 'AMI';
  var code;
  var tryCount = 0;
  do {
    var rand = Math.floor(1000 + Math.random() * 9000);
    code = 'BERCK-' + prenom + '-' + rand;
    tryCount++;
  } while (codeExiste(data, code) && tryCount < 20);

  sheet.appendRow([
    code, p.nom || '', p.email || '', p.tel || '',
    p.appart || '', p.residence || '',
    new Date().toLocaleString('fr-FR'), 0, ''
  ]);

  // Envoyer mail de bienvenue parrain
  try { envoyerMailCodeParrain(p, code); } catch(err) {}

  return code;
}

function codeExiste(data, code) {
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === code) return true;
  }
  return false;
}

function envoyerMailCodeParrain(p, code) {
  var waMsg = 'Coucou ! J\'ai s\xe9journ\xe9 \xe0 Berck chez Claudine, c\'\xe9tait super ! '
    + 'R\xe9serve en direct sur ' + SITE_URL + ' et indique mon code parrain ' + code
    + ' dans le questionnaire de fin de s\xe9jour : on gagne chacun un bon -10% \u{1F60A}';
  var waUrl = 'https://wa.me/?text=' + encodeURIComponent(waMsg);
  var mailUrl = 'mailto:?subject=' + encodeURIComponent('Mon code parrain Appart-H\xf4tel Berck (-10%)')
              + '&body=' + encodeURIComponent(waMsg);

  var html = ''
    + '<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">'
    + '<div style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:24px;border-radius:12px 12px 0 0">'
    + '<h1 style="margin:0;font-size:22px">\u{1F381} Votre code parrain est pr\xeat !</h1>'
    + '<p style="margin:6px 0 0;opacity:0.9">Partagez, gagnez -10%</p>'
    + '</div>'
    + '<div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none">'
    + '<p>Bonjour ' + escapeHtml(p.nom || '') + ',</p>'
    + '<p>Merci d\'avoir s\xe9journ\xe9 \xe0 Berck ! En recommandant notre Appart-H\xf4tel, vous et vos proches b\xe9n\xe9ficiez d\'un avantage mutuel :</p>'
    + '<div style="background:linear-gradient(135deg,#faf5ff,#f3e8ff);border:2px solid #a855f7;border-radius:12px;padding:20px;text-align:center;margin:20px 0">'
    + '<p style="font-size:12px;color:#6d28d9;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;font-weight:600">Votre code parrain</p>'
    + '<div style="font-size:22px;font-weight:800;color:#7c3aed;letter-spacing:2px;background:#fff;padding:14px;border-radius:8px;display:inline-block">' + code + '</div>'
    + '</div>'
    + '<h2 style="font-size:16px;color:#7c3aed;margin:20px 0 10px">Comment \xe7a marche ?</h2>'
    + '<ol style="padding-left:20px;line-height:1.8;color:#475569">'
    + '<li>Vous partagez votre code avec un proche</li>'
    + '<li>Il r\xe9serve en direct sur <a href="' + SITE_URL + '" style="color:#7c3aed">appart-hotel-berck.com</a> et s\xe9journe \xe0 Berck</li>'
    + '<li>\xc0 la fin de son s\xe9jour, il indique votre code dans notre questionnaire de satisfaction</li>'
    + '<li>Vous recevez chacun un <strong>bon -10% personnel</strong>, \xe0 usage unique, valable ' + BON_VALIDITE_MOIS + ' mois sur une r\xe9servation directe</li>'
    + '</ol>'
    + '<h2 style="font-size:16px;color:#7c3aed;margin:24px 0 10px">Partager votre code</h2>'
    + '<a href="' + waUrl + '" style="display:inline-block;padding:12px 20px;background:#25d366;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;margin-right:8px">\u{1F4AC} WhatsApp</a>'
    + '<a href="' + mailUrl + '" style="display:inline-block;padding:12px 20px;background:#8b5cf6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">\u2709\ufe0f Email</a>'
    + '<p style="margin-top:20px;font-size:13px;color:#64748b">\xc0 bient\xf4t \xe0 Berck,<br>Claudine</p>'
    + '</div></div>';

  MailApp.sendEmail({
    to: p.email,
    bcc: ALERT_EMAIL,
    subject: '\u{1F381} Votre code parrain Appart-H\xf4tel Berck : ' + code,
    htmlBody: html
  });
}

// ===== PARRAINAGE : validation d'un code utilise par un filleul (v9) =====
function validerEtNotifierParrainage(ss, filleul, codeUtilise) {
  var codeNorm = String(codeUtilise || '').toUpperCase().replace(/\s+/g, '');
  if (!codeNorm) return false;

  var sheetParrains = ensureSheet(ss, 'Parrains', HEAD_PARRAINS, '#a855f7');
  var data = sheetParrains.getDataRange().getValues();

  // Chercher le code parrain (insensible casse/espaces)
  var parrainRow = -1;
  var parrainInfo = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase().replace(/\s+/g, '') === codeNorm) {
      parrainRow = i + 1; // ligne reelle (1-indexed)
      parrainInfo = {
        code: data[i][0],
        nom: data[i][1],
        email: data[i][2],
        tel: data[i][3],
        appart: data[i][4],
        nbUtilisations: Number(data[i][7]) || 0
      };
      break;
    }
  }

  if (!parrainInfo) return false; // code invalide

  // Anti-fraude 1 : le parrain ne peut pas se parrainer lui-meme (meme email)
  if (String(parrainInfo.email).toLowerCase().trim() === String(filleul.email).toLowerCase().trim()) {
    return false;
  }

  // Anti-fraude 2 (v9) : un meme filleul (email) ne peut etre parraine qu'UNE seule
  // fois, tous codes parrains confondus — sinon le meme sejour genererait des bons en boucle.
  var sheetPV = ensureSheet(ss, 'Parrainages Valides', HEAD_PARRAINAGES, '#10b981');
  var pvData = sheetPV.getDataRange().getValues();
  var filleulEmail = String(filleul.email).toLowerCase().trim();
  for (var j = 1; j < pvData.length; j++) {
    if (String(pvData[j][5]).toLowerCase().trim() === filleulEmail) return false;
  }

  // Incrementer compteur parrain
  sheetParrains.getRange(parrainRow, 8).setValue(parrainInfo.nbUtilisations + 1);
  sheetParrains.getRange(parrainRow, 9).setValue(new Date().toLocaleString('fr-FR'));

  // v9 : attribuer 2 bons uniques depuis le pool (18 mois de validite chacun)
  var bonParrain = null;
  var bonFilleul = null;
  try { bonParrain = attribuerBon(ss, 'PARRAIN', parrainInfo.nom, parrainInfo.email, parrainInfo.code); } catch(err) {}
  try { bonFilleul = attribuerBon(ss, 'FILLEUL', filleul.nom, filleul.email, parrainInfo.code); } catch(err) {}

  // Logger dans Parrainages Valides
  var ts = new Date().toLocaleString('fr-FR');
  sheetPV.appendRow([
    ts, parrainInfo.code,
    parrainInfo.nom, parrainInfo.email,
    filleul.nom || '', filleul.email || '',
    filleul.appart || '', ts,
    bonParrain ? bonParrain.code : 'EN ATTENTE',
    bonFilleul ? bonFilleul.code : 'EN ATTENTE'
  ]);

  // Envoyer mails
  try { envoyerMailParrainValide(parrainInfo, filleul, bonParrain); } catch(err) {}
  try { envoyerMailFilleulValide(filleul, parrainInfo, bonFilleul); } catch(err) {}

  return true;
}

function envoyerMailParrainValide(parrain, filleul, bon) {
  var bonHtml;
  if (bon) {
    bonHtml = ''
      + '<div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid #10b981;border-radius:12px;padding:20px;text-align:center;margin:20px 0">'
      + '<p style="font-size:12px;color:#166534;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;font-weight:600">Votre bon fid\xe9lit\xe9 personnel</p>'
      + '<div style="font-size:24px;font-weight:800;color:#10b981;letter-spacing:3px;background:#fff;padding:16px;border-radius:8px;display:inline-block">' + escapeHtml(bon.code) + '</div>'
      + '<p style="font-size:12px;color:#64748b;margin:12px 0 0">Valable jusqu\'au <strong>' + escapeHtml(bon.expiration) + '</strong> \u2014 utilisable <strong>une seule fois</strong>, lors d\'une r\xe9servation directe sur <strong>' + SITE_URL.replace('https://','') + '</strong></p>'
      + '</div>';
  } else {
    bonHtml = '<p><strong>Votre bon personnel -10% vous sera envoy\xe9 dans un email s\xe9par\xe9 tr\xe8s prochainement.</strong></p>';
  }
  var html = ''
    + '<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">'
    + '<div style="background:linear-gradient(135deg,#10b981,#34d399);color:#fff;padding:24px;border-radius:12px 12px 0 0">'
    + '<h1 style="margin:0;font-size:22px">\u2728 F\xe9licitations ' + escapeHtml((parrain.nom || '').split(' ')[0]) + ' !</h1>'
    + '<p style="margin:6px 0 0;opacity:0.9">Votre parrainage a \xe9t\xe9 valid\xe9</p>'
    + '</div>'
    + '<div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none">'
    + '<p>Bonne nouvelle ! <strong>' + escapeHtml(filleul.nom || 'Un proche') + '</strong> a s\xe9journ\xe9 \xe0 Berck et a utilis\xe9 votre code parrain <strong>' + escapeHtml(parrain.code) + '</strong>.</p>'
    + '<p>Comme promis, voici votre bon <strong>-10% de r\xe9duction</strong> \xe0 utiliser sur votre prochain s\xe9jour en direct :</p>'
    + bonHtml
    + '<p style="font-size:14px;color:#64748b">Ce bon est <strong>strictement personnel</strong> : il ne fonctionne qu\'une fois, puis s\'\xe9teint automatiquement.</p>'
    + '<p style="font-size:14px;color:#64748b">Votre code parrain <strong>' + escapeHtml(parrain.code) + '</strong> reste actif : continuez \xe0 le partager, chaque nouveau filleul = un nouveau bon -10% !</p>'
    + '<p style="margin-top:20px;font-size:13px;color:#64748b">Merci pour votre confiance,<br>Claudine</p>'
    + '</div></div>';

  MailApp.sendEmail({
    to: parrain.email,
    bcc: ALERT_EMAIL,
    subject: '\u2728 Votre parrainage a \xe9t\xe9 valid\xe9 : voici votre -10% !',
    htmlBody: html
  });
}

function envoyerMailFilleulValide(filleul, parrain, bon) {
  var bonHtml;
  if (bon) {
    bonHtml = ''
      + '<div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid #10b981;border-radius:12px;padding:20px;text-align:center;margin:20px 0">'
      + '<p style="font-size:12px;color:#166534;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;font-weight:600">Votre bon fid\xe9lit\xe9 personnel</p>'
      + '<div style="font-size:24px;font-weight:800;color:#10b981;letter-spacing:3px;background:#fff;padding:16px;border-radius:8px;display:inline-block">' + escapeHtml(bon.code) + '</div>'
      + '<p style="font-size:12px;color:#64748b;margin:12px 0 0">Valable jusqu\'au <strong>' + escapeHtml(bon.expiration) + '</strong> — utilisable <strong>une seule fois</strong>, lors d\'une r\xe9servation directe sur <strong>' + SITE_URL.replace('https://','') + '</strong></p>'
      + '</div>';
  } else {
    bonHtml = '<p><strong>Votre bon personnel -10% vous sera envoy\xe9 dans un email s\xe9par\xe9 tr\xe8s prochainement.</strong></p>';
  }
  var html = ''
    + '<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">'
    + '<div style="background:linear-gradient(135deg,#10b981,#34d399);color:#fff;padding:24px;border-radius:12px 12px 0 0">'
    + '<h1 style="margin:0;font-size:22px">\u{1F381} Merci ' + escapeHtml((filleul.nom || '').split(' ')[0]) + ' !</h1>'
    + '<p style="margin:6px 0 0;opacity:0.9">Votre code parrain a \xe9t\xe9 accept\xe9</p>'
    + '</div>'
    + '<div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none">'
    + '<p>Bonne nouvelle ! Le code parrain de <strong>' + escapeHtml(parrain.nom || 'votre proche') + '</strong> est bien valid\xe9. Voici votre <strong>bonus parrainage -10%</strong> :</p>'
    + bonHtml
    + '<p style="font-size:14px;color:#64748b">Ce bon est <strong>strictement personnel</strong> : il ne fonctionne qu\'une fois, puis s\'\xe9teint automatiquement.</p>'
    + '<p style="font-size:14px;color:#64748b">Vous aussi, <strong>parrainez vos proches</strong> ! Votre propre code parrain personnel vous a \xe9t\xe9 envoy\xe9 dans un email s\xe9par\xe9 si vous avez dit souhaiter revenir ET recommander notre Appart-H\xf4tel.</p>'
    + '<p style="margin-top:20px;font-size:13px;color:#64748b">\xc0 tr\xe8s bient\xf4t \xe0 Berck !<br>Claudine</p>'
    + '</div></div>';

  MailApp.sendEmail({
    to: filleul.email,
    bcc: ALERT_EMAIL,
    subject: '\u{1F381} Parrainage valid\xe9 : votre -10% est l\xe0 !',
    htmlBody: html
  });
}

// =====================================================================
// v9 : GESTION DU POOL DE BONS FIDELITE UNIQUES (onglet 'Bons Fidelite')
// =====================================================================
// Cycle de vie d'un bon : DISPONIBLE -> ATTRIBUE -> CONSOMME (ou EXPIRE).
// Les codes DOIVENT aussi exister dans Beds24 : (SETTINGS) BOOKING ENGINE >
// MULTIPLE PROPERTIES > One Time Use Voucher Codes (Beds24 les supprime a l'usage).

function formatDateFR(d) {
  return Utilities.formatDate(d, 'Europe/Paris', 'dd/MM/yyyy');
}

// A executer manuellement depuis l'editeur (ou via une session assistee) pour
// remplir le pool. Genere nb codes, les ajoute au Sheet en DISPONIBLE et envoie
// a Claudine la liste exacte a coller dans Beds24.
function genererPoolBons(nb) {
  nb = nb || 40;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ensureSheet(ss, 'Bons Fidelite', HEAD_BONS, '#f59e0b');
  var data = sheet.getDataRange().getValues();
  var existants = {};
  for (var i = 1; i < data.length; i++) existants[String(data[i][0]).toUpperCase()] = true;

  // Alphabet sans caracteres ambigus (pas de O/0, I/1/L) ni caracteres speciaux (regle Beds24)
  var alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var codes = [];
  while (codes.length < nb) {
    var c = 'FIDELE-';
    for (var k = 0; k < 8; k++) {
      if (k === 4) c += '-';
      c += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    if (!existants[c]) { existants[c] = true; codes.push(c); }
  }
  codes.forEach(function(code) {
    sheet.appendRow([code, 'DISPONIBLE', '', '', '', '', '', '', '', '']);
  });

  MailApp.sendEmail({
    to: ALERT_EMAIL,
    subject: '\u{1F39F} ' + nb + ' nouveaux bons fid\xe9lit\xe9 g\xe9n\xe9r\xe9s — \xe0 coller dans Beds24',
    htmlBody: '<p>' + nb + ' bons uniques ont \xe9t\xe9 ajout\xe9s \xe0 l\'onglet <strong>Bons Fidelite</strong> (statut DISPONIBLE).</p>'
      + '<p><strong>\xc0 coller dans Beds24</strong> lors de la prochaine session : (SETTINGS) BOOKING ENGINE &gt; MULTIPLE PROPERTIES &gt; One Time Use Voucher Codes (valeur : -10%, selon le format du champ constat\xe9 sur la page) :</p>'
      + '<pre style="background:#f1f5f9;padding:12px;border-radius:8px;font-size:13px">' + codes.join('<br>') + '</pre>'
      + '<p style="font-size:12px;color:#64748b">Tant que le collage n\'est pas fait, les bons envoy\xe9s aux voyageurs ne fonctionneront pas sur le moteur de r\xe9servation.</p>'
  });
  return codes.join('\n');
}

// Pioche le premier bon DISPONIBLE, le marque ATTRIBUE avec expiration a +18 mois.
// Renvoie { code, expiration } ou null si le pool est vide (alerte envoyee).
function attribuerBon(ss, role, nom, email, codeParrainLie) {
  var sheet = ensureSheet(ss, 'Bons Fidelite', HEAD_BONS, '#f59e0b');
  var data = sheet.getDataRange().getValues();
  var row = -1;
  var dispo = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === 'DISPONIBLE') {
      dispo++;
      if (row === -1) row = i + 1;
    }
  }

  if (row === -1) {
    MailApp.sendEmail({
      to: ALERT_EMAIL,
      subject: '\u{1F6A8} URGENT — plus aucun bon fid\xe9lit\xe9 disponible',
      htmlBody: '<p>Un parrainage vient d\'\xeatre valid\xe9 (' + escapeHtml(nom || '') + ', ' + escapeHtml(email || '') + ', r\xf4le ' + role + ') mais <strong>le pool de bons est vide</strong>.</p>'
        + '<p>\xc0 faire : ex\xe9cuter <strong>genererPoolBons()</strong> dans l\'\xe9diteur Apps Script, coller les codes dans Beds24, puis envoyer son bon manuellement \xe0 ce voyageur (ligne EN ATTENTE dans Parrainages Valides).</p>'
    });
    return null;
  }

  var now = new Date();
  var exp = new Date(now.getFullYear(), now.getMonth() + BON_VALIDITE_MOIS, now.getDate());
  var code = data[row - 1][0];
  // Colonnes 2..8 : Statut, Role, Attribue A, Email, Code Parrain Lie, Date Attribution, Date Expiration
  sheet.getRange(row, 2, 1, 7).setValues([[
    'ATTRIBUE', role, nom || '', email || '', codeParrainLie || '',
    now.toLocaleString('fr-FR'), formatDateFR(exp)
  ]]);

  var restants = dispo - 1;
  if (restants <= BON_STOCK_ALERTE) {
    MailApp.sendEmail({
      to: ALERT_EMAIL,
      subject: '⚠️ Stock bons fid\xe9lit\xe9 bas : ' + restants + ' restant(s)',
      htmlBody: '<p>Il ne reste que <strong>' + restants + '</strong> bon(s) DISPONIBLE dans le pool.</p>'
        + '<p>\xc0 faire : ex\xe9cuter <strong>genererPoolBons()</strong> puis coller les nouveaux codes dans Beds24 lors de la prochaine session.</p>'
    });
  }

  return { code: code, expiration: formatDateFR(exp) };
}

// ===== v9 : ROBOT QUOTIDIEN — reconciliation des bons consommes =====
// Lit les resas recentes via l'API Beds24 (token READ-ONLY dans les Script
// Properties, cle BEDS24_REFRESH_TOKEN — jamais dans le code, le repo est public).
// Le code voucher utilise apparait dans la resa (rate description / invoice items).
function robotReconciliationBons() {
  var refresh = PropertiesService.getScriptProperties().getProperty('BEDS24_REFRESH_TOKEN');
  if (!refresh) return; // pas configure : robot inactif, aucun impact

  var tokenResp = UrlFetchApp.fetch('https://api.beds24.com/v2/authentication/token', {
    headers: { refreshToken: refresh }, muteHttpExceptions: true
  });
  if (tokenResp.getResponseCode() !== 200) return;
  var token = JSON.parse(tokenResp.getContentText()).token;
  if (!token) return;

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ensureSheet(ss, 'Bons Fidelite', HEAD_BONS, '#f59e0b');
  var data = sheet.getDataRange().getValues();
  var rowByCode = {};
  for (var i = 1; i < data.length; i++) rowByCode[String(data[i][0]).toUpperCase()] = i + 1;

  var since = new Date();
  since.setDate(since.getDate() - 30);
  var sinceStr = Utilities.formatDate(since, 'Europe/Paris', 'yyyy-MM-dd');

  var page = 1;
  while (page <= 5) {
    var url = 'https://api.beds24.com/v2/bookings?bookingTimeFrom=' + sinceStr
            + '&includeInvoiceItems=true&page=' + page;
    var resp = UrlFetchApp.fetch(url, { headers: { token: token }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) break;
    var body = JSON.parse(resp.getContentText());
    var bookings = body.data || [];
    if (!bookings.length) break;

    bookings.forEach(function(b) {
      var matches = JSON.stringify(b).match(/FIDELE-[A-Z2-9]{4}-[A-Z2-9]{4}/g) || [];
      matches.forEach(function(code) {
        var r = rowByCode[code];
        if (!r) {
          MailApp.sendEmail({
            to: ALERT_EMAIL,
            subject: '\u{1F6A8} Bon fid\xe9lit\xe9 INCONNU utilis\xe9 : ' + code,
            htmlBody: '<p>Le code <strong>' + code + '</strong> appara\xeet dans la r\xe9sa Beds24 #' + b.id + ' mais n\'existe pas dans l\'onglet Bons Fidelite. \xc0 v\xe9rifier.</p>'
          });
          return;
        }
        var statut = sheet.getRange(r, 2).getValue();
        if (statut === 'ATTRIBUE') {
          sheet.getRange(r, 2).setValue('CONSOMME');
          sheet.getRange(r, 9).setValue(new Date().toLocaleString('fr-FR'));
          sheet.getRange(r, 10).setValue('Resa Beds24 #' + b.id);
        } else if (statut === 'EXPIRE') {
          MailApp.sendEmail({
            to: ALERT_EMAIL,
            subject: '\u{1F6A8} Bon fid\xe9lit\xe9 EXPIR\xc9 utilis\xe9 : ' + code,
            htmlBody: '<p>Le bon <strong>' + code + '</strong> (expir\xe9) a \xe9t\xe9 utilis\xe9 dans la r\xe9sa Beds24 #' + b.id + '. Il n\'avait pas encore \xe9t\xe9 retir\xe9 de Beds24 — \xe0 purger, et d\xe9cision \xe0 prendre sur cette r\xe9sa.</p>'
          });
        }
        // CONSOMME deja : rien a faire
      });
    });

    if (!body.pages || !body.pages.nextPageExists) break;
    page++;
  }
}

// ===== v9 : ROBOT HEBDO — bons arrives a expiration (18 mois) =====
// Marque EXPIRE les bons ATTRIBUE dont la date est depassee et envoie a Claudine
// la liste exacte a retirer de Beds24 (pas d'expiration native cote Beds24).
function robotExpirationBons() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ensureSheet(ss, 'Bons Fidelite', HEAD_BONS, '#f59e0b');
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var expires = [];

  for (var i = 1; i < data.length; i++) {
    if (data[i][1] !== 'ATTRIBUE') continue;
    var m = String(data[i][7] || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) continue;
    var exp = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59);
    if (exp < now) {
      sheet.getRange(i + 1, 2).setValue('EXPIRE');
      expires.push(String(data[i][0]));
    }
  }

  if (expires.length) {
    MailApp.sendEmail({
      to: ALERT_EMAIL,
      subject: '⏳ ' + expires.length + ' bon(s) fid\xe9lit\xe9 expir\xe9(s) — \xe0 retirer de Beds24',
      htmlBody: '<p>Ces bons ont d\xe9pass\xe9 leurs ' + BON_VALIDITE_MOIS + ' mois de validit\xe9 et sont pass\xe9s en EXPIRE dans le Sheet.</p>'
        + '<p><strong>\xc0 retirer de la liste Beds24</strong> ((SETTINGS) BOOKING ENGINE &gt; MULTIPLE PROPERTIES &gt; One Time Use Voucher Codes) lors de la prochaine session :</p>'
        + '<pre style="background:#f1f5f9;padding:12px;border-radius:8px;font-size:13px">' + expires.join('<br>') + '</pre>'
    });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// HELPERS ONE-SHOT (a executer manuellement depuis l'editeur)
// ============================================================

// A executer une fois pour autoriser l'acces au calendrier DraPS
function authorizeCalendar() {
  var cal = CalendarApp.getCalendarById(DRAPS_CALENDAR_ID);
  Logger.log('Calendar trouve : ' + (cal ? cal.getName() : 'NON'));
}

// One-shot : applique le nouveau code couleur RED + lien tap-valider aux events existants
// A executer apres deploiement du lifecycle 3 couleurs.
function migrateExistingSignalementsToColorLifecycle() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Signalements');
  if (!sheet) { Logger.log('Pas de sheet Signalements'); return; }
  var data = sheet.getDataRange().getValues();
  var cal = CalendarApp.getCalendarById(DRAPS_CALENDAR_ID);
  if (!cal) { Logger.log('Calendar DraPS introuvable'); return; }
  var webAppUrl = '';
  try { webAppUrl = ScriptApp.getService().getUrl(); } catch (e) { webAppUrl = ''; }
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    var sigId = data[i][0];
    var statut = (data[i][8] || 'ouvert').toString().toLowerCase();
    var eventId = data[i][11];
    if (!eventId || eventId.toString().indexOf('err:') === 0) continue;
    try {
      var ev = cal.getEventById(eventId);
      if (!ev) continue;
      var title = ev.getTitle();
      var desc = ev.getDescription() || '';
      // Color selon statut
      if (statut === 'ouvert') {
        ev.setColor(CalendarApp.EventColor.RED);
        // Remplacer prefixe titre 🚨 par 🔴
        if (title.indexOf('🚨') === 0) ev.setTitle('🔴 ' + title.substring(2).trim());
        else if (title.indexOf('🔴') !== 0) ev.setTitle('🔴 ' + title);
        // Ajouter lien tap-valider si pas deja present
        if (webAppUrl && desc.indexOf('tapValidateSignalement') === -1) {
          var validateLink = webAppUrl + '?action=tapValidateSignalement&id=' + encodeURIComponent(sigId);
          ev.setDescription('✅ Quand tu valides (passage au vert) : ' + validateLink + '\n\n' + desc);
        }
      } else if (statut === 'fait-prestataire') {
        ev.setColor(CalendarApp.EventColor.YELLOW);
      } else if (statut === 'valide-claudine') {
        ev.setColor(CalendarApp.EventColor.GREEN);
      } else if (statut === 'resolu') {
        // Legacy : on retro-classe en valide-claudine (deja fait+vu)
        ev.setColor(CalendarApp.EventColor.GREEN);
      }
      count++;
      Logger.log('Event mis a jour : ' + title + ' -> statut=' + statut);
    } catch (e) {
      Logger.log('Erreur sur sig ' + sigId + ' : ' + e.message);
    }
  }
  Logger.log('Total events migres : ' + count);
}

// One-shot : retire les rappels de tous les events DraPS lies aux signalements OUVERTS
// A executer apres deploiement de la nouvelle version pour nettoyer les events existants
function cleanupSignalementsReminders() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Signalements');
  if (!sheet) { Logger.log('Pas de sheet Signalements'); return; }
  var data = sheet.getDataRange().getValues();
  var cal = CalendarApp.getCalendarById(DRAPS_CALENDAR_ID);
  if (!cal) { Logger.log('Calendar DraPS introuvable'); return; }
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    var statut = data[i][8];      // col Statut
    var eventId = data[i][11];    // col Calendar Event ID
    if (statut !== 'ouvert') continue;
    if (!eventId || eventId.toString().indexOf('err:') === 0) continue;
    try {
      var ev = cal.getEventById(eventId);
      if (ev) {
        ev.removeAllReminders();
        count++;
        Logger.log('Rappels retires : ' + data[i][5] + ' (' + eventId + ')');
      }
    } catch (e) {
      Logger.log('Erreur sur ' + eventId + ' : ' + e.message);
    }
  }
  Logger.log('Total events nettoyes : ' + count);
}

// ============================================================
// WARNING EVENTS PRESTATAIRES (event horaire 10h dans le calendrier du presta du jour)
// ============================================================
// A la creation d un signalement, en plus de l event DraPS (lifecycle 3 couleurs),
// on cherche QUEL prestataire fait l appart le jour J (en regardant ses events all-day)
// et on cree un event horaire 10h-11h ROUGE 🚨 dans son calendrier, sans rappel popup.
// Le prestataire voit ainsi l alerte dans son propre agenda en haut de sa journee.

function normalizeForMatch_(s) {
  return (s || '').toString().toLowerCase()
    .replace(/[éèêë]/g, 'e').replace(/[àâä]/g, 'a').replace(/[îï]/g, 'i')
    .replace(/[ôö]/g, 'o').replace(/[ûü]/g, 'u').replace(/ç/g, 'c');
}

function findPrestaCalendarForSlug_(slug, dateObj) {
  var patterns = SLUG_MATCH_PATTERNS[slug] || [slug.replace(/-/g, ' ')];
  var normalizedPatterns = patterns.map(normalizeForMatch_);
  for (var i = 0; i < PRESTA_CALENDARS.length; i++) {
    var entry = PRESTA_CALENDARS[i];
    try {
      var cal = CalendarApp.getCalendarById(entry.id);
      if (!cal) continue;
      var events = cal.getEventsForDay(dateObj);
      for (var j = 0; j < events.length; j++) {
        var titleNorm = normalizeForMatch_(events[j].getTitle());
        // Ignorer nos propres warning events (commencent par 🚨)
        if (events[j].getTitle().indexOf('🚨') === 0) continue;
        for (var k = 0; k < normalizedPatterns.length; k++) {
          if (titleNorm.indexOf(normalizedPatterns[k]) >= 0) {
            return { id: entry.id, name: entry.name, matchedEvent: events[j].getTitle() };
          }
        }
      }
    } catch (e) {
      Logger.log('findPrestaCalendarForSlug_ erreur sur ' + entry.name + ' : ' + e.message);
    }
  }
  return null;
}

function createPrestaWarningEvent_(slug, signalementId, voyageur, element, description, actionPresta) {
  var tz = 'Europe/Paris';
  var dateObj = new Date(); // jour J = aujourd hui
  var found = findPrestaCalendarForSlug_(slug, dateObj);
  if (!found) {
    Logger.log('createPrestaWarningEvent_ : aucun calendrier presta trouve pour ' + slug + ' le ' + Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd'));
    return '';
  }
  try {
    var cal = CalendarApp.getCalendarById(found.id);
    var start = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 10, 0, 0);
    var end = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 11, 0, 0);
    var title = '🚨 ' + slug + ' : ' + (element || (description ? description.substring(0, 60) : 'signalement voyageur'));
    var webAppUrl = '';
    try { webAppUrl = ScriptApp.getService().getUrl(); } catch (e) { webAppUrl = ''; }
    var validateLink = webAppUrl ? (webAppUrl + '?action=tapValidateSignalement&id=' + encodeURIComponent(signalementId)) : '';
    var lines = [];
    lines.push('🔴 Signalement voyageur — ' + slug + ' (' + found.name + ')');
    lines.push('');
    if (voyageur) lines.push('Voyageur : ' + voyageur);
    if (description) lines.push('Message : ' + description);
    lines.push('');
    if (actionPresta) lines.push('Action : ' + actionPresta);
    lines.push('');
    lines.push('✅ Quand fait : clique le bouton "✓ Réglé" dans la checklist QR code de ' + slug + ',');
    if (validateLink) lines.push('OU tape ce lien pour valider directement : ' + validateLink);
    lines.push('');
    lines.push('ID signalement : ' + signalementId);
    var event = cal.createEvent(title, start, end, { description: lines.join('\n') });
    try { event.setColor(CalendarApp.EventColor.RED); } catch (e) {}
    try { event.removeAllReminders(); } catch (e) {}
    Logger.log('Warning event cree dans ' + found.name + ' (match event "' + found.matchedEvent + '") : ' + event.getId());
    return event.getId();
  } catch (e) {
    Logger.log('createPrestaWarningEvent_ creation echec : ' + e.message);
    return 'err:' + (e.message || 'unknown').substring(0, 80);
  }
}

// ============================================================
// SCAN BEDS24 QUOTIDIEN A 9H30
// ============================================================
// Filtre via Claude API les messages voyageurs des departs J-1 / J0
// et cree automatiquement les signalements pour les vrais problemes.

var BEDS24_API_URL = 'https://api.beds24.com/v2';
var ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_MODEL = 'claude-haiku-4-5';

// Mapping propertyId Beds24 -> slug checklist-menage (convention dash)
// Source : skill livret-accueil-berck §2 Beds24
// 165649 = fantome SPA, ignore (remplace par 322705 Cocon Romantique)
var PROPERTY_TO_SLUG = {
  '130359': 'face-mer',         '130360': 'terrasse',
  '139315': 'hamac',            '139457': 'paddle',
  '139836': 'kitesurf',         '158760': 'surf',
  '159616': 'balneo',           '189737': 'grand-large',
  '218166': 'albatros',         '229691': 'apolove',
  '230322': 'apollo',           '249462': 'maisonnette',
  '257174': 'famille',          '262694': 'kingston',
  '262835': 'jeanne',           '271266': 'grande-love-room',
  '284349': 'mini-love-room',   '288628': 'patio',
  '311800': 'rotonde',          '318990': 'evasion',
  '322705': 'cocon-romantique'
};

// System prompt pour Claude API — version compacte du skill scan-feedback-voyageurs
var SCAN_FEEDBACK_SYSTEM_PROMPT = [
  'Tu filtres les messages voyageurs Beds24 pour decider si on doit notifier la prestataire de menage.',
  '',
  'NOTIFIER (notify:true) si le voyageur signale :',
  '- REGLE CASSE ABSOLUE : TOUT objet/equipement casse, abime ou endommage — peu importe le responsable (voyageur, son chien, l usure). Verre casse, couteau casse pour ouvrir une huitre, assiette ebrechee, manche de poele casse, tasse felee, ampoule grillee, telecommande inerte, vitre fissuree, store coince, ressort de lit casse, etc. → TOUJOURS NOTIFIER meme si le voyageur s excuse et propose de payer. La prestataire doit verifier + ramener un remplacement (ou signaler stock vide a Claudine). Sans signalement, le voyageur suivant arrive avec un manque.',
  '- Equipement casse/en panne (TV, balneo, frigo, lave-vaisselle, micro-onde, bouilloire, machine a laver, lampe, chauffage, climatisation, telecommande, serrure, robinet, douche, chasse d eau, etc.)',
  '- Proprete insatisfaisante (taches, odeurs persistantes, cheveux, poussiere, salissures visibles)',
  '- Element manquant qui devrait etre la (papier toilette, savon, sel/poivre, cafe/the, drap, peignoir, telecommande, mode d emploi)',
  '- Element a remplacer/abime/use (matelas affaisse, alese tachee, serviette trouee, couette tachee, paroi douche fissuree)',
  '- Doleance forte ou demande de remboursement/compensation',
  '- Animaux nuisibles (cafards, punaises, fourmis)',
  '- Securite (fuite gaz/eau, fil denude, fenetre qui ne ferme pas, serrure cassee)',
  '',
  'NE PAS NOTIFIER (notify:false) si :',
  '- Politesses & remerciements ("merci beaucoup", "logement parfait", "passe un bon moment")',
  '- Demandes pratiques sans probleme (check-in tardif, codes/cles, vinaigrettes, packs linge supplementaires, paiements)',
  '- Sujets factuels neutres (confirmation arrivee/depart, telephone, mail, parking, transports)',
  '- Doleances exprimees AVANT le sejour (le voyageur ne peut pas signaler de probleme dans le logement avant d y etre)',
  '',
  'EXEMPLES POSITIFS (a NOTIFIER imperativement) :',
  '- "Bonjour, mon ami a casse un verre en faisant la vaisselle. Combien vous dois-t-on pour cela ?" → notify:true, categorie A changer, element verre, action "Verifier le nombre de verres. Si un manque, en ressortir un du local menage. Si stock vide, signaler a Claudine."',
  '- "On a casse un couteau en ouvrant des huitres." → notify:true, categorie A changer, element couteau, action "Verifier l etat du couteau casse et le retirer. Remplacer depuis le local menage. Si pas de couteau de remplacement, signaler a Claudine pour rachat."',
  '',
  'EXEMPLES NEGATIFS (a NE PAS notifier) :',
  '- "Merci beaucoup pour tout. Je suis vraiment heureuse d avoir passe ce bon moment chez vous." → notify:false (politesse pure, rien de casse/sale/manquant)',
  '',
  'REPONSE OBLIGATOIRE EN JSON STRICT :',
  '{"notify":true|false,"category":"\\ud83d\\udd27 Casse/Panne"|"\\ud83e\\uddf9 Proprete"|"\\u274c Manquant"|"\\ud83d\\ude21 Doleance"|"\\ud83d\\udcb0 Remboursement"|"\\ud83d\\udd04 A changer"|null,"element":"balneo|TV|verre|...|null","action":"Action concrete pour la prestataire (max 200 chars). TOUJOURS inclure : (1) ce qu elle fait elle-meme (jeter, remplacer, nettoyer, verifier) et (2) le fallback \'signaler a Claudine\'. Pour equipement non remplacable (balneo, TV, frigo) : verifier puis signaler Claudine pour SAV.","reason":"Justification courte max 100 chars"}',
  '',
  'REGLE ABSOLUE : dans le doute, NOTIFIER plutot que IGNORER. Un faux positif (anodin remontre a la prestataire) est moins grave qu un vrai probleme ignore.'
].join('\n');

function getBeds24Token_() {
  var refresh = PropertiesService.getScriptProperties().getProperty('BEDS24_REFRESH_TOKEN');
  if (!refresh) throw new Error('BEDS24_REFRESH_TOKEN non configure dans PropertiesService. Lance setupScanSecrets() une fois.');
  var resp = UrlFetchApp.fetch(BEDS24_API_URL + '/authentication/token', {
    method: 'get',
    headers: { 'refreshToken': refresh },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var data = JSON.parse(resp.getContentText());
  if (code !== 200 || !data.token) {
    throw new Error('Beds24 auth ' + code + ' : ' + resp.getContentText().substring(0, 200));
  }
  return data.token;
}

function getBeds24Bookings_(token, dateFrom, dateTo) {
  // departureFrom / departureTo : on cible les departs de la periode
  var url = BEDS24_API_URL + '/bookings?departureFrom=' + dateFrom + '&departureTo=' + dateTo + '&includeInfoItems=false';
  var all = [];
  var safety = 0;
  while (url && safety < 20) {
    safety++;
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'token': token },
      muteHttpExceptions: true
    });
    var data = JSON.parse(resp.getContentText());
    if (data && data.data && data.data.length) all = all.concat(data.data);
    if (data && data.pages && data.pages.nextPageExists && data.pages.nextPageLink) {
      url = data.pages.nextPageLink;
      Utilities.sleep(800);
    } else {
      break;
    }
  }
  return all;
}

function getBeds24Messages_(token, bookingIds) {
  var byBooking = {};
  for (var i = 0; i < bookingIds.length; i += 30) {
    var chunk = bookingIds.slice(i, i + 30);
    var url = BEDS24_API_URL + '/bookings/messages?bookingId=' + chunk.join(',');
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'token': token },
      muteHttpExceptions: true
    });
    var data = JSON.parse(resp.getContentText());
    if (data && data.data) {
      for (var j = 0; j < data.data.length; j++) {
        var m = data.data[j];
        var bid = String(m.bookingId);
        if (!byBooking[bid]) byBooking[bid] = [];
        byBooking[bid].push(m);
      }
    }
    if (i + 30 < bookingIds.length) Utilities.sleep(1500);
  }
  return byBooking;
}

function callClaudeFilter_(message, apartName, voyageur) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configure dans PropertiesService. Lance setupScanSecrets() une fois.');

  var userPrompt = 'Appartement : ' + (apartName || 'inconnu') + '\n' +
                   'Voyageur : ' + (voyageur || 'inconnu') + '\n\n' +
                   '---DEBUT MESSAGE---\n' + message + '\n---FIN MESSAGE---\n\n' +
                   'Decide notify=true/false selon les regles. Retourne UNIQUEMENT le JSON, sans markdown.';

  var resp = UrlFetchApp.fetch(ANTHROPIC_API_URL, {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    payload: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system: SCAN_FEEDBACK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var txt = resp.getContentText();
  if (code !== 200) {
    Logger.log('Anthropic ' + code + ' : ' + txt.substring(0, 300));
    return null;
  }
  var data = JSON.parse(txt);
  if (!data.content || !data.content.length) return null;
  var raw = data.content[0].text || '';
  var match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    Logger.log('Anthropic reponse sans JSON : ' + raw.substring(0, 200));
    return null;
  }
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    Logger.log('Parse JSON echoue : ' + match[0].substring(0, 200));
    return null;
  }
}

// Reutilise la logique addSignalement existante de handle()
function addSignalementInternal_(params) {
  return handle({
    action: 'addSignalement',
    appart: params.appart,
    source: params.source,
    voyageur: params.voyageur,
    element: params.element,
    description: params.description,
    actionPresta: params.actionPresta
  });
}

// === MAIN — Scan quotidien declenche par trigger 9h30 ===
function dailyScanBeds24() {
  var tz = 'Europe/Paris';
  var todayDate = new Date();
  var yesterdayDate = new Date(todayDate.getTime() - 86400000);
  var today = Utilities.formatDate(todayDate, tz, 'yyyy-MM-dd');
  var yesterday = Utilities.formatDate(yesterdayDate, tz, 'yyyy-MM-dd');
  Logger.log('=== Scan Beds24 ' + today + ' (departs ' + yesterday + ' -> ' + today + ') ===');

  var token;
  try { token = getBeds24Token_(); }
  catch (e) { Logger.log('FAIL auth Beds24 : ' + e.message); return; }

  var bookings = getBeds24Bookings_(token, yesterday, today);
  var actifs = [];
  for (var b = 0; b < bookings.length; b++) {
    var st = bookings[b].status;
    if (st !== 'cancelled' && st !== 'black' && st !== 'inquiry') actifs.push(bookings[b]);
  }
  Logger.log(bookings.length + ' bookings, ' + actifs.length + ' actifs (status confirmed/new)');
  if (actifs.length === 0) { Logger.log('Aucun depart aujourd hui ou hier. Fin.'); return; }

  // Recuperer les messages
  var ids = [];
  for (var k = 0; k < actifs.length; k++) ids.push(actifs[k].id);
  var msgsByBooking = getBeds24Messages_(token, ids);

  // Lire les signalements existants pour eviter les doublons par bookingId
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sigSheet = ss.getSheetByName('Signalements');
  var seenBookings = {};
  if (sigSheet) {
    var sigData = sigSheet.getDataRange().getValues();
    for (var s = 1; s < sigData.length; s++) {
      var src = sigData[s][3] ? sigData[s][3].toString() : '';
      var mBid = src.match(/Beds24 #(\d+)/);
      if (mBid) seenBookings[mBid[1]] = true;
    }
  }

  var notifyCount = 0;
  var skipCount = 0;
  var ignoredCount = 0;
  var unknownProps = {};

  for (var i = 0; i < actifs.length; i++) {
    var bk = actifs[i];
    var bid = String(bk.id);
    if (seenBookings[bid]) { skipCount++; continue; }
    var msgs = msgsByBooking[bid];
    if (!msgs || msgs.length === 0) continue;

    var slug = PROPERTY_TO_SLUG[String(bk.propertyId)];
    if (!slug) {
      unknownProps[bk.propertyId] = true;
      Logger.log('Propriete inconnue (id=' + bk.propertyId + ') booking #' + bid + ' — non traitee');
      continue;
    }

    var voyageur = ((bk.firstName || '') + ' ' + (bk.lastName || '')).trim() || 'Voyageur';

    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      if (msg.source !== 'guest') continue;
      var text = (msg.message || '').toString().trim();
      if (text.length < 10) continue;

      try {
        var decision = callClaudeFilter_(text, slug, voyageur);
        if (!decision) { Logger.log('  decision nulle, skip'); continue; }
        if (!decision.notify) { ignoredCount++; continue; }

        addSignalementInternal_({
          appart: slug,
          source: 'Beds24 #' + bid + ' (scan auto ' + today + ')',
          voyageur: voyageur,
          element: decision.element || '',
          description: text.substring(0, 480),
          actionPresta: decision.action || ''
        });
        notifyCount++;
        Logger.log('+ NOTIFY ' + slug + ' / ' + (decision.element || '?') + ' / ' + (decision.reason || ''));
      } catch (e) {
        Logger.log('Erreur traitement message booking #' + bid + ' : ' + e.message);
      }
      Utilities.sleep(1200); // rate limit anthropic
    }
  }

  Logger.log('=== FIN scan : ' + notifyCount + ' nouveaux signalements, ' +
             ignoredCount + ' messages ignores (faux positifs LLM), ' +
             skipCount + ' bookings deja traites');
  var unknownKeys = Object.keys(unknownProps);
  if (unknownKeys.length) {
    Logger.log('PROPRIETES INCONNUES (a mapper dans PROPERTY_TO_SLUG) : ' + unknownKeys.join(', '));
  }
}

// One-shot : configurer les secrets dans PropertiesService
// EXECUTER UNE FOIS depuis l editeur apres avoir colle les valeurs.
function setupScanSecrets() {
  // ⚠️ Mettre les vraies valeurs avant d executer, puis les enlever apres
  var BEDS24_REFRESH_TOKEN = ''; // PASTE HERE
  var ANTHROPIC_API_KEY = '';    // PASTE HERE
  if (!BEDS24_REFRESH_TOKEN || !ANTHROPIC_API_KEY) {
    Logger.log('STOP — colle les 2 secrets en haut de la fonction puis re-execute.');
    return;
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('BEDS24_REFRESH_TOKEN', BEDS24_REFRESH_TOKEN);
  props.setProperty('ANTHROPIC_API_KEY', ANTHROPIC_API_KEY);
  Logger.log('Secrets enregistres. Tu peux maintenant retirer les valeurs du code et sauvegarder.');
}

// One-shot : installer le trigger quotidien 9h30
function installDailyScanTrigger() {
  // Supprimer les anciens triggers dailyScanBeds24
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailyScanBeds24') {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log('Trigger existant supprime');
    }
  }
  ScriptApp.newTrigger('dailyScanBeds24')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .nearMinute(30)
    .inTimezone('Europe/Paris')
    .create();
  Logger.log('Trigger dailyScanBeds24 installe : tous les jours entre 9h30 et 10h00 (heure Paris)');
}

// Pour tester le scan manuellement avant le trigger 9h30
function testDailyScanNow() {
  dailyScanBeds24();
}
