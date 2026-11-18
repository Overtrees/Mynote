/* Editor 生命周期钩子：pagehide 落盘 + 封面加载失败委托。从 Editor 主组件抽出。 */
(function (w) {
  'use strict';
  var R = w.React;

  /**
   * 防抖窗口内关页 / 切后台不丢稿。
   * 依赖 Editor 已有的 closedRef / saveTimer / doSave / docRef / titleValueRef。
   */
  function usePageHideFlush(opts) {
    var closedRef = opts.closedRef;
    var saveTimer = opts.saveTimer;
    var doSave = opts.doSave;
    var memo = opts.memo;
    var titleValueRef = opts.titleValueRef;
    var docRef = opts.docRef;
    var layoutRef = opts.layoutRef;
    R.useEffect(function () {
      var flushNow = function () {
        if (closedRef.current) return;
        clearTimeout(saveTimer.current);
        doSave(docRef.current);
        if (w.MynoteLocal && w.MynoteLocal.DraftStore && w.MynoteLocal.DraftStore.save) {
          w.MynoteLocal.DraftStore.save(memo.id, {
            doc: docRef.current,
            layout: layoutRef && layoutRef.current || undefined,
            title: titleValueRef.current,
            updatedAt: new Date().toISOString()
          }).catch(function () {});
        }
      };
      var onVis = function () {
        if (w.document.visibilityState === 'hidden') flushNow();
      };
      w.addEventListener('pagehide', flushNow);
      w.document.addEventListener('visibilitychange', onVis);
      return function () {
        w.removeEventListener('pagehide', flushNow);
        w.document.removeEventListener('visibilitychange', onVis);
      };
    }, [doSave, memo.id]);
  }

  /** DOMPurify 会剥内联 onerror；封面破图改捕获阶段委托隐藏。 */
  function useCoverErrorGuard() {
    R.useEffect(function () {
      function onImgError(e) {
        var t = e.target;
        if (!t || t.tagName !== 'IMG') return;
        var cover = t.closest && t.closest('.lkc-cover');
        if (cover) cover.style.display = 'none';
        var wrap = t.closest && t.closest('.link-card-cover-wrap');
        if (wrap) wrap.className = 'link-card-cover-wrap no-cover';
        var body = t.closest && t.closest('.link-card, .link-card-block');
        if (body) {
          var bodyInner = body.querySelector('.lkc-body, .link-card-body');
          if (bodyInner) bodyInner.classList.remove('has-cover');
        }
      }
      w.document.addEventListener('error', onImgError, true);
      return function () { w.document.removeEventListener('error', onImgError, true); };
    }, []);
  }

  w.MynoteEditorHooks = {
    usePageHideFlush: usePageHideFlush,
    useCoverErrorGuard: useCoverErrorGuard
  };
})(window);
