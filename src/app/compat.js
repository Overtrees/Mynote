/* 旧浏览器兼容垫片：可选链时代之前的 Safari/Chrome 也能跑。 */
(function (w) {
  'use strict';

  // AbortSignal.timeout：Safari 15.4+ 才有；weather.js 依赖它。
  if (typeof w.AbortSignal === 'function' && typeof w.AbortSignal.timeout !== 'function') {
    w.AbortSignal.timeout = function (ms) {
      var ctrl = new w.AbortController();
      setTimeout(function () {
        try { ctrl.abort(new Error('timeout')); } catch (_) { ctrl.abort(); }
      }, ms);
      return ctrl.signal;
    };
  }

  // Promise.allSettled：ES2020； handleClose 用它等附件写完。
  if (typeof w.Promise === 'function' && typeof w.Promise.allSettled !== 'function') {
    w.Promise.allSettled = function (list) {
      var items = Array.prototype.slice.call(list || []);
      return w.Promise.all(items.map(function (p) {
        return w.Promise.resolve(p).then(
          function (v) { return { status: 'fulfilled', value: v }; },
          function (e) { return { status: 'rejected', reason: e }; }
        );
      }));
    };
  }
})(window);
