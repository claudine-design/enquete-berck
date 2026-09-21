// Service worker du tuto ménage — permet d'ouvrir l'appli SANS RÉSEAU (caves)
// et d'envoyer les photos/heures gardées dans le téléphone dès que le réseau revient.
// Page : réseau d'abord (pour avoir la dernière version), sinon la copie gardée.
// Images (photos déco + photos modèles) : copie gardée d'abord.
const CACHE = 'tuto-menage-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('tuto-menage-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function withTimeout(p, ms){
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.hostname === 'script.google.com') return; // jamais de cache pour le serveur
  if(req.mode === 'navigate'){
    e.respondWith(
      withTimeout(fetch(req), 4000)
        .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./', copy)); return r; })
        .catch(() => caches.match('./'))
    );
    return;
  }
  if(req.destination === 'image'){
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r;
      }))
    );
  }
});

// ---------- envoi en arrière-plan (Android/Chrome) ----------
self.addEventListener('sync', e => { if(e.tag === 'menage-flush') e.waitUntil(flush()); });

function idb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open('menage-queue', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('q', {autoIncrement:true});
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function flush(){
  // Si l'appli est ouverte, c'est elle qui envoie (évite deux envois en même temps).
  const ouvertes = await self.clients.matchAll({type:'window'});
  if(ouvertes.length) return;
  const api = await apiUrl('SUIVI_API');
  if(!api) return;
  const apiRoutines = await apiUrl('ROUTINES_API_URL');
  const db = await idb();
  const keys = await new Promise(res => { const r = db.transaction('q','readonly').objectStore('q').getAllKeys(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
  const lire = key => new Promise(res => { const r = db.transaction('q','readonly').objectStore('q').get(key); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
  // Même ordre que dans l'appli : début / FIN / entretien, puis photos, vidéo en dernier.
  const prio = v => v.action === 'start' ? 0 : v.action === 'fin' ? 1 : v.action === 'routine' ? 2 : (v.action === 'photo' && v.etape === 'video') ? 5 : 3;
  const metas = [];
  for(const key of keys){ const v = await lire(key); if(v) metas.push({key, p: prio(v)}); }
  metas.sort((a, b) => a.p - b.p || a.key - b.key);
  let echec = false;
  for(const {key} of metas){
    const val = await lire(key);
    if(!val) continue;
    let ok = false;
    try {
      if(val.action === 'routine'){
        if(!apiRoutines) throw new Error('adresse');
        const r = await fetch(apiRoutines + '?' + new URLSearchParams({action:'markRoutineDone', appart:val.appart, task:val.task, label:val.label, presta:val.presta}).toString());
        ok = !!(await r.json()).success;
      } else {
        const r = await fetch(api, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(val)});
        const j = await r.json();
        ok = !!j.ok || j.error === 'cle';
      }
    } catch(e){ ok = false; }
    if(!ok){ echec = true; continue; }   // un envoi raté ne bloque pas les suivants
    await new Promise(res => { const tx = db.transaction('q','readwrite'); tx.objectStore('q').delete(key); tx.oncomplete = res; });
  }
  if(echec) throw new Error('a renvoyer');   // le navigateur relancera la synchro plus tard
}
// Les adresses des serveurs sont lues dans la page gardée (une seule source de vérité).
async function apiUrl(nom){
  const r = await caches.match('./');
  if(!r) return '';
  const m = (await r.text()).match(new RegExp("const " + nom + " = '(https:[^']+)'"));
  return m ? m[1] : '';
}
