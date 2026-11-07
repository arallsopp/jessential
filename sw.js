// Jessential! service worker: keeps the app working offline, and tells the page when a
// new version is ready. It never touches saved stories or looks, which live in localStorage.
//
// VERSION is set by `npm run stamp` from the files below. A new VERSION makes devices
// download the new files and offer "Update now". The tests fail if it is out of date.
const VERSION = '82c794269684';
const CACHE = 'jessential-' + VERSION;
const FILES = [
  'index.html',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-512.png',
  'fonts/andika-400.woff2',
  'fonts/andika-700.woff2',
  'fonts/atkinson-hyperlegible-400.woff2',
  'fonts/atkinson-hyperlegible-700.woff2',
  'fonts/comic-neue-400.woff2',
  'fonts/comic-neue-700.woff2',
  'fonts/lexend-400.woff2',
  'fonts/lexend-700.woff2',
  'fonts/opendyslexic-400.woff2',
  'fonts/opendyslexic-700.woff2',
];

self.addEventListener('install', event => {
  // `reload` skips the browser's HTTP cache, so a new version never picks up old files.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(f => new Request(f, {cache:'reload'})))));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('jessential-') && k !== CACHE).map(k => caches.delete(k)))));
});

// The page asks for this when Pam taps "Update now".
self.addEventListener('message', event => {
  if (event.data === 'update') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(cache =>
    (req.mode === 'navigate' ? cache.match('index.html') : cache.match(req, {ignoreSearch:true}))
      .then(hit => hit || fetch(req))));
});
