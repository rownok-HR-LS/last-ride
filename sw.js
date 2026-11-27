// The game's own copy of itself, so a returning rider loads from their device instead of the network.
//
// Every file the game asks for (models, textures, sounds, code) is kept here, stamped with the version it came from.
// Within one version it is served straight from the copy, no network at all. After a deploy (scripts/deploy-pages.mjs
// writes a new VERSION) each file is checked once with the server: unchanged ones cost a 304, changed ones are
// fetched and kept. The page itself and its manifest are always asked for first (so a new version is noticed), and
// only come from the copy with no connection. Only this site's own files; never the game server or anything else.
const VERSION = '9e06c47-mwzeytqg';
const CACHE = 'last-ride';
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  const page = req.mode === 'navigate' || url.pathname === SCOPE || /\.(html|webmanifest)$|\/sw\.js$/.test(url.pathname);
  if (page) {
    e.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || Response.error())));
    return;
  }
  e.respondWith(serve(req, url));
});

/** A copy of a response, stamped with this version (the body as plain bytes: no encoding headers to undo twice). */
function stamped(res, body) {
  const headers = new Headers(res.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set('x-lr-ver', VERSION);
  return new Response(body, { status: 200, statusText: res.statusText, headers });
}

async function keep(cache, key, res) {
  const copy = stamped(res, await res.arrayBuffer());
  await cache.put(key, copy.clone());
  return copy;
}

async function serve(req, url) {
  const cache = await caches.open(CACHE);
  const key = url.origin + url.pathname;
  const hit = await cache.match(key);
  if (hit && hit.headers.get('x-lr-ver') === VERSION) return hit;
  // the build's own files carry their contents' hash in the name: one we have is still right
  if (hit && url.pathname.startsWith(`${SCOPE}assets/`)) return keep(cache, key, hit);
  let res;
  try {
    const etag = hit?.headers.get('etag');
    res = await fetch(req.url, { cache: 'no-cache', headers: etag ? { 'If-None-Match': etag } : {} });
  } catch {
    return hit || Response.error();
  }
  if (res.status === 304 && hit) return keep(cache, key, hit);
  if (!res.ok || res.type !== 'basic') return res;
  return keep(cache, key, res);
}
