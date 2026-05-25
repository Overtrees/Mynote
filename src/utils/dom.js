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

  w.CikeDom = {
    escapeHTML: escapeHTML,
    focusEditableWithCaret: focusEditableWithCaret
  };
})(window);
