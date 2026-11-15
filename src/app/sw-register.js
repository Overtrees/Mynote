/* Service Worker 注册：仅 https / localhost；file:// 静默跳过。 */
(function (w) {
  'use strict';
  if (!('serviceWorker' in w.navigator)) return;
  var host = w.location.hostname;
  var secure = w.location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
  if (!secure) return;
  w.addEventListener('load', function () {
    w.navigator.serviceWorker.register('./sw.js').catch(function (e) {
      console.warn('[此刻] Service Worker 注册失败', e);
    });
  });
})(window);
