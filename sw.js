/* Magabi Notes — service worker
   - Página: busca a versão nova na rede, sem usar a cópia velha do navegador.
     Se a rede demorar ou faltar, abre a cópia salva, mas continua baixando
     em segundo plano: a versão nova fica salva e o app avisa para atualizar.
   - Ícones: cópia salva primeiro.
   - Fontes do Google: cópia salva e atualização em segundo plano,
     para o app abrir também sem internet. */
const VERSAO = 'magabinotes-v3';
const ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSAO).then(cache => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(c => c.startsWith('magabinotes-') && c !== VERSAO).map(c => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

function comTempoLimite(promessa, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tempo esgotado')), ms);
    promessa.then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
  });
}

function redePrimeiro(req, chaveCache, reserva) {
  return comTempoLimite(fetch(req), 4000)
    .then(resp => {
      if (resp && resp.ok) {
        const copia = resp.clone();
        caches.open(VERSAO).then(c => c.put(chaveCache, copia));
      }
      return resp;
    })
    .catch(() => caches.match(chaveCache).then(r => r || (reserva ? caches.match(reserva) : undefined)));
}

function pagina(event) {
  let usouCopia = false;
  const rede = fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' });
  const atualizar = rede.then(async resp => {
    if (!resp || !resp.ok) return;
    const cache = await caches.open(VERSAO);
    const antigo = await cache.match('./index.html');
    const antigoTxt = antigo ? await antigo.text() : null;
    const novoTxt = await resp.clone().text();
    await cache.put('./index.html', resp.clone());
    if (usouCopia && antigoTxt !== null && antigoTxt !== novoTxt) {
      const janelas = await self.clients.matchAll({ type: 'window' });
      janelas.forEach(j => j.postMessage('nova-versao'));
    }
  }).catch(() => {});
  event.waitUntil(atualizar);
  return comTempoLimite(rede.then(r => { if (!r.ok) throw new Error('falha'); return r.clone(); }), 4000)
    .catch(() => {
      usouCopia = true;
      return caches.match('./index.html')
        .then(r => r || caches.match('./'))
        .then(r => r || rede.then(x => x.clone()));
    });
}

function salvoEAtualiza(req) {
  return caches.open(VERSAO).then(cache =>
    cache.match(req).then(salvo => {
      const rede = fetch(req).then(resp => {
        if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
        return resp;
      }).catch(() => salvo);
      return salvo || rede;
    })
  );
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Página do app
  if (req.mode === 'navigate') {
    event.respondWith(pagina(event));
    return;
  }

  // Fontes do Google
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(salvoEAtualiza(req));
    return;
  }

  // Arquivos do próprio app
  if (url.origin === location.origin) {
    if (/\.png$/i.test(url.pathname)) {
      event.respondWith(caches.match(req).then(s => s || fetch(req)));
    } else {
      event.respondWith(redePrimeiro(req, req, null));
    }
  }
});
