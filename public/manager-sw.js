// Installation support only. Authenticated pages and API responses are never cached.
const CACHE='va-manager-shell-v1';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/manager-offline.html')).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||event.request.mode!=='navigate'||url.origin!==self.location.origin||!(/^\/cleaner(?:\/|$)/.test(url.pathname)))return;
 event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(cache=>cache.match('/manager-offline.html'))));
});
