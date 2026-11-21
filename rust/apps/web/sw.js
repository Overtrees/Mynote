// Mynote Rust Web Service Worker（对齐原版 sw.js 的离线能力）
// 版本号由 build.sh 用 wasm md5 戳入，部署即换缓存代。
const VERSION = '__VERSION__';
const CACHE = 'mynote-rustweb-' + VERSION;
const CORE = [
  './',
  './index.html',
  './mynote-web.js',
  './mynote-web_bg.wasm',
  './manifest.json',
  './Mynoteicon.png',
  './lang/zh-CN.json',
  './lang/zh-TW.json',
  './lang/en-US.json',
  './lang/ja-JP.json',
  './lang/ko-KR.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(
        ks.filter((k) => k.indexOf('mynote-rustweb-') === 0 && k !== CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 导航与应用本体（html/js/wasm）走网络优先，保证部署即时
  // 生效；断网时回缓存。语言包/图标等走 SWR。
  const networkFirst = req.mode === 'navigate'
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.wasm')
    || url.pathname.endsWith('.html');
  if (networkFirst) {
    e.respondWith(
      fetch(req).then((r) => {
        if (r.ok) {
          const cp = r.clone();
          caches.open(CACHE).then((c) => c.put(req, cp));
        }
        return r;
      }).catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((r) => {
        if (r.ok) {
          const cp = r.clone();
          caches.open(CACHE).then((c) => c.put(req, cp));
        }
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
