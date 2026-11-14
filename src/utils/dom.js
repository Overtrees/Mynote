(function (w) {
  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function focusEditableWithCaret(target, offset, warnFn) {
    if (offset === void 0) offset = 0;
    if (!target) return false;
    var root = target.closest && target.closest('[contenteditable="true"]');
    try {
      (root || target).focus({ preventScroll: true });
    } catch (_) {
      try {
        (root || target).focus();
      } catch (err) {
        if (typeof warnFn === 'function') warnFn('focusEditableWithCaret focus', err);
      }
    }

    var hasTextNode = Array.from(target.childNodes || []).some(function (n) {
      return n.nodeType === Node.TEXT_NODE;
    });
    if (!hasTextNode) target.textContent = '\u200B';

    var textNode = Array.from(target.childNodes || []).find(function (n) {
      return n.nodeType === Node.TEXT_NODE;
    });
    if (!textNode) return document.activeElement === target || document.activeElement === root;

    var raw = textNode.textContent || '';
    var logicalLen = raw.replace(/\u200B/g, '').length;
    var anchorOffset = raw === '\u200B' ? 1 : Math.min(offset, logicalLen);

    try {
      var range = document.createRange();
      range.setStart(textNode, anchorOffset);
      range.collapse(true);
      var sel = window.getSelection();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err2) {
      if (typeof warnFn === 'function') warnFn('focusEditableWithCaret sel', err2);
    }

    return document.activeElement === target || document.activeElement === root;
  }

  // 滚动/高频事件节流：同一帧内的多次调用只执行一次（每个包装函数各自一个待执行槽）
  function rafThrottle(fn) {
    var pending = false;
    var lastArgs = null;
    return function () {
      lastArgs = arguments;
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        var a = lastArgs;
        lastArgs = null;
        try { fn.apply(null, a || []); } catch (e) { if (typeof warnFn === 'function') warnFn('rafThrottle', e); }
      });
    };
  }

  w.MynoteDom = {
    escapeHTML: escapeHTML,
    focusEditableWithCaret: focusEditableWithCaret,
    rafThrottle: rafThrottle
  };
})(window);
