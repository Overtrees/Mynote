/* Mynote Service Worker: precache the complete local runtime; never cache cross-origin services. */
const CACHE = 'mynote-2.2.7';
const PRECACHE = [
  './',
  './index.html',
  './Moment.html',
  './manifest.json',
  './Mynoteicon.png',
  './src/styles/tokens.css?v=2.2.7',
  './src/styles/launch.css?v=2.2.7',
  './src/styles/base.css?v=2.2.7',
  './vendor/katex.min.css?v=2.2.7',
  './src/styles/editor.css?v=2.2.7',
  './src/styles/panels.css?v=2.2.7',
  './src/styles/cards.css?v=2.2.7',
  './src/styles/editor-shell.css?v=2.2.7',
  './vendor/react.production.min.js',
  './vendor/react-dom.production.min.js',
  './vendor/fflate.min.js',
  './vendor/marked.min.js',
  './vendor/katex.min.js',
  './vendor/purify.min.js',
  './vendor/google-gsi-client.js',
  './src/styles/tokens.js?v=2.2.7',
  './src/styles/inline.js?v=2.2.7',
  './src/app/font-boot.js?v=2.2.7',
  './src/app/compat.js?v=2.2.7',
  './src/app/launch.js?v=2.2.7',
  './src/app-config.js?v=2.2.7',
  './src/constants.js?v=2.2.7',
  './src/utils/id.js?v=2.2.7',
  './src/utils/time.js?v=2.2.7',
  './src/utils/dom.js?v=2.2.7',
  './src/utils/preview.js?v=2.2.7',
  './src/utils/svg.js?v=2.2.7',
  './src/services/backup-validate.js?v=2.2.7',
  './src/services/storage.idb.js?v=2.2.7',
  './src/services/zip.js?v=2.2.7',
  './src/services/zip.worker.js',
  './src/services/drive.js?v=2.2.7',
  './src/services/storage.local.js?v=2.2.7',
  './src/editor/editor.md.js?v=2.2.7',
  './src/editor/md-blocks.js?v=2.2.7',
  './src/editor/editor.render.js?v=2.2.7',
  './src/hooks/useSwipeGesture.js?v=2.2.7',
  './src/components/BgSheet.js?v=2.2.7',
  './src/components/ImageTextSheet.js?v=2.2.7',
  './src/components/LazyImage.js?v=2.2.7',
  './src/components/SettingsView.js?v=2.2.7',
  './src/components/SwipeRow.js?v=2.2.7',
  './src/components/ImageCard.js?v=2.2.7',
  './src/components/BackupView.js?v=2.2.7',
  './src/error-boundary.js?v=2.2.7',
  './src/app/markdown-bridge.js?v=2.2.7',
  './src/app/runtime.js?v=2.2.7',
  './src/app/editor/commands.js?v=2.2.7',
  './src/app/demo-memos.js?v=2.2.7',
  './src/app/editor/slash-model.js?v=2.2.7',
  './src/app/editor/lifecycle-hooks.js?v=2.2.7',
  './src/app/editor/use-history.js?v=2.2.7',
  './src/app/editor/use-editor-dom.js?v=2.2.7',
  './src/app/editor/use-slash.js?v=2.2.7',
  './src/app/editor/slash-panel.js?v=2.2.7',
  './src/app/editor/export.js?v=2.2.7',
  './src/app/editor.js?v=2.2.7',
  './src/services/weather.js?v=2.2.7',
  './src/app/memo-list.js?v=2.2.7',
  './src/app/bootstrap.js?v=2.2.7',
  './src/app/standalone.js?v=2.2.7',
  './src/app/sw-register.js?v=2.2.7',
  './vendor/fonts/KaTeX_AMS-Regular.woff2',
  './vendor/fonts/KaTeX_Caligraphic-Bold.woff2',
  './vendor/fonts/KaTeX_Caligraphic-Regular.woff2',
  './vendor/fonts/KaTeX_Fraktur-Bold.woff2',
  './vendor/fonts/KaTeX_Fraktur-Regular.woff2',
  './vendor/fonts/KaTeX_Main-Bold.woff2',
  './vendor/fonts/KaTeX_Main-BoldItalic.woff2',
  './vendor/fonts/KaTeX_Main-Italic.woff2',
  './vendor/fonts/KaTeX_Main-Regular.woff2',
  './vendor/fonts/KaTeX_Math-BoldItalic.woff2',
  './vendor/fonts/KaTeX_Math-Italic.woff2',
  './vendor/fonts/KaTeX_SansSerif-Bold.woff2',
  './vendor/fonts/KaTeX_SansSerif-Italic.woff2',
  './vendor/fonts/KaTeX_SansSerif-Regular.woff2',
  './vendor/fonts/KaTeX_Script-Regular.woff2',
  './vendor/fonts/KaTeX_Size1-Regular.woff2',
  './vendor/fonts/KaTeX_Size2-Regular.woff2',
  './vendor/fonts/KaTeX_Size3-Regular.woff2',
  './vendor/fonts/KaTeX_Size4-Regular.woff2',
  './vendor/fonts/KaTeX_Typewriter-Regular.woff2'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Fail installation if any required local runtime asset is missing.
      return cache.addAll(PRECACHE.map(function (url) {
        return new Request(url, { cache: 'reload' });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  // Keep Google, Drive, weather and metadata services network-only.
  if (url.origin !== self.location.origin) return;
  // Do not cache query-based HTML routes (for example ?open=note-id).
  if (url.search && url.pathname.endsWith('.html')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () {
        return caches.match(request).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Local static files use stale-while-revalidate; cached files remain usable offline.
  event.respondWith(
    caches.match(request).then(function (hit) {
      var network = fetch(request).then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () {
        return hit;
      });
      return hit || network;
    })
  );
});
