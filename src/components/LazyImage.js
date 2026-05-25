(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef;

  function LazyImage(_ref) {
    var file = _ref.file;
    var _useState = useState('skeleton'), phase = _useState[0], setPhase = _useState[1];
    var _useState2 = useState(false), fullLoaded = _useState2[0], setFullLoaded = _useState2[1];
    var elRef = useRef(null);

    useEffect(function () {
      var el = elRef.current;
      if (!el) return;
      var observer = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          setPhase('thumb');
          observer.unobserve(el);
        }
      }, { rootMargin: '100px' });
      observer.observe(el);
      return function () { observer.disconnect(); };
    }, []);

    var handleFullLoad = function () {
      setFullLoaded(true);
      if (file.thumb && file.thumb.indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(file.thumb); } catch (e) {}
      }
    };

    if (phase === 'skeleton') {
      return R.createElement('div', { ref:elRef, className:'attachment-placeholder' });
    }

    return R.createElement('div', { className:'lazy-img-wrapper' },
      R.createElement('img', { src:file.thumb || file.url, alt:file.name, className:'lazy-img-thumb' }),
      R.createElement('img', { src:file.url, alt:file.name, className:'lazy-img-full ' + (fullLoaded ? 'loaded' : ''), onLoad:handleFullLoad, loading:'lazy' }));
  }

  w.LazyImage = LazyImage;
})(window);
