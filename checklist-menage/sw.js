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
  const api = await apiUrl();
  if(!api) return;
  const db = await idb();
  const items = await new Promise(res => {
    const out = []; db.transaction('q','readonly').objectStore('q').openCursor().onsuccess = ev => {
      const c = ev.target.result; if(c){ out.push({key:c.key, val:c.value}); c.continue(); } else res(out);
    };
  });
  for(const {key, val} of items){
    const r = await fetch(api, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(val)});
    const j = await r.json();
    if(!j.ok && j.error !== 'cle') throw new Error('refus');
    await new Promise(res => { const tx = db.transaction('q','readwrite'); tx.objectStore('q').delete(key); tx.oncomplete = res; });
  }
}
// L'adresse du serveur est lue dans la page gardée (une seule source de vérité).
async function apiUrl(){
  const r = await caches.match('./');
  if(!r) return '';
  const m = (await r.text()).match(/const SUIVI_API = '(https:[^']+)'/);
  return m ? m[1] : '';
}
