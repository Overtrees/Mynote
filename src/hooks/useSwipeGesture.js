(function (w) {
  'use strict';
  var R = w.React;
  var useRef = R.useRef, useCallback = R.useCallback, useEffect = R.useEffect;

  function useSwipeGesture(opts) {
    var isNewCard = opts && opts.isNewCard;
    var ACTION_W = 168, THRESHOLD = 55, MIN_DX = 5;
    var rowRef = useRef(null), wrapperRef = useRef(null), btn1Ref = useRef(null), btn2Ref = useRef(null);
    var gesture = useRef({ startX: null, startY: null, curX: 0, opened: false, swiping: false });

    var onProgress = opts && opts.onProgress;
    var applyProgress = useCallback(function (p) {
      var pinP = Math.max(0, Math.min(1, (p - 0.35) / 0.65)), delP = Math.min(1, p / 0.55);
      if (btn1Ref.current) { btn1Ref.current.style.transform = 'translateX(' + ((1 - pinP) * 60) + 'px)'; btn1Ref.current.style.opacity = pinP; btn1Ref.current.style.pointerEvents = pinP > 0.3 ? 'auto' : 'none'; }
      if (btn2Ref.current) { btn2Ref.current.style.transform = 'translateX(' + ((1 - delP) * 30) + 'px)'; btn2Ref.current.style.opacity = delP; btn2Ref.current.style.pointerEvents = delP > 0.3 ? 'auto' : 'none'; }
      if (typeof onProgress === 'function') onProgress(p);
    }, [onProgress]);

    var setTranslate = useCallback(function (x) { if (rowRef.current) rowRef.current.style.transform = 'translateX(' + x + 'px)'; applyProgress(Math.min(1, Math.abs(x) / ACTION_W)); }, [applyProgress]);

    var snapOpen = useCallback(function () { if (rowRef.current) rowRef.current.style.transition = 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)'; setTranslate(-ACTION_W); gesture.current.opened = true; gesture.current.curX = -ACTION_W; }, [setTranslate]);
    var snapClose = useCallback(function () { if (rowRef.current) rowRef.current.style.transition = 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)'; setTranslate(0); gesture.current.opened = false; gesture.current.curX = 0; gesture.current.swiping = false; }, [setTranslate]);

    var handlersRef = useRef({});
    handlersRef.current.touchStart = function (e) { if (isNewCard) return; gesture.current.startX = e.touches[0].clientX; gesture.current.startY = e.touches[0].clientY; gesture.current.swiping = false; if (rowRef.current) rowRef.current.style.transition = 'none'; };
    handlersRef.current.touchMove = function (e) { if (isNewCard) return; var g = gesture.current; if (g.startX === null) return; var dx = e.touches[0].clientX - g.startX, dy = e.touches[0].clientY - g.startY; if (!g.swiping && Math.abs(dy) > Math.abs(dx) + 8) { snapClose(); g.startX = null; return; } if (!g.swiping && Math.abs(dx) > MIN_DX) g.swiping = true; if (!g.swiping) return; e.preventDefault(); var base = g.opened ? -ACTION_W : 0, next = Math.min(0, Math.max(-ACTION_W, base + dx)); if (rowRef.current) rowRef.current.style.transform = 'translateX(' + next + 'px)'; applyProgress(Math.min(1, Math.abs(next) / ACTION_W)); g.curX = next; };
    handlersRef.current.touchEnd = function () { if (isNewCard) return; var g = gesture.current; if (g.opened) { g.curX > -ACTION_W + THRESHOLD ? snapClose() : snapOpen(); } else { g.curX < -THRESHOLD ? snapOpen() : snapClose(); } g.startX = null; };

    useEffect(function () {
      if (isNewCard) return;
      var el = rowRef.current;
      if (!el) return;
      var ts = function(e){handlersRef.current.touchStart(e);}, tm = function(e){handlersRef.current.touchMove(e);}, te = function(e){handlersRef.current.touchEnd(e);};
      el.addEventListener('touchstart', ts, { passive: true });
      el.addEventListener('touchmove', tm, { passive: false });
      el.addEventListener('touchend', te, { passive: true });
      return function(){ el.removeEventListener('touchstart',ts); el.removeEventListener('touchmove',tm); el.removeEventListener('touchend',te); };
    }, [isNewCard]);

    return {
      rowRef: rowRef, wrapperRef: wrapperRef, btn1Ref: btn1Ref, btn2Ref: btn2Ref,
      gesture: gesture,
      applyProgress: applyProgress, setTranslate: setTranslate,
      snapOpen: snapOpen, snapClose: snapClose,
      ACTION_W: ACTION_W, THRESHOLD: THRESHOLD
    };
  }

  w.CikeHooks = w.CikeHooks || {};
  w.CikeHooks.useSwipeGesture = useSwipeGesture;
})(window);
