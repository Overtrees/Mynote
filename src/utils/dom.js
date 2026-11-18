(function (w) {
  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getTextOffsetWithin(root, node, offset) {
    if (!root || !node || (node !== root && !root.contains(node))) return null;
    var maxOffset = node.nodeType === Node.TEXT_NODE ? node.textContent.length : (node.childNodes || []).length;
    var safeOffset = Math.max(0, Math.min(Math.floor(Number(offset) || 0), maxOffset));
    try {
      var range = document.createRange();
      range.selectNodeContents(root);
      range.setEnd(node, safeOffset);
      return range.toString().length;
    } catch (_) {
      return null;
    }
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

    function collectTextNodes(node, out) {
      Array.from(node.childNodes || []).forEach(function (child) {
        if (child.nodeType === Node.TEXT_NODE) {
          var parent = child.parentElement;
          // 独立列外层 editor-body 可能是 contenteditable=false，而列宿主本身
          // 是可编辑岛；检查实际继承状态，不能让更外层 false 覆盖内层 true。
          if (parent && parent.isContentEditable) out.push(child);
        } else if (child.nodeType === Node.ELEMENT_NODE && child.getAttribute('contenteditable') !== 'false') {
          collectTextNodes(child, out);
        }
      });
    }
    var textNodes = [];
    if (target.getAttribute && target.getAttribute('contenteditable') !== 'false') collectTextNodes(target, textNodes);
    if (!textNodes.length) {
      function findTextContainer(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE || node.getAttribute('contenteditable') === 'false') return null;
        var children = Array.from(node.childNodes || []);
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (child.nodeType !== Node.ELEMENT_NODE || child.getAttribute('contenteditable') === 'false') continue;
          if (child.tagName === 'BR') return node;
          var nested = findTextContainer(child);
          if (nested) return nested;
        }
        return node;
      }
      var textContainer = findTextContainer(target);
      if (textContainer) {
        var marker = document.createTextNode('\u200B');
        var emptyBreak = Array.from(textContainer.childNodes || []).find(function (child) {
          return child.nodeType === Node.ELEMENT_NODE && child.tagName === 'BR';
        });
        if (emptyBreak) textContainer.replaceChild(marker, emptyBreak);
        else textContainer.appendChild(marker);
        textNodes.push(marker);
      }
    }
    if (!textNodes.length) return document.activeElement === target || document.activeElement === root;

    var remaining = Math.max(0, Number(offset) || 0);
    var textNode = textNodes[textNodes.length - 1];
    var anchorOffset = 0;
    for (var ti = 0; ti < textNodes.length; ti++) {
      var candidate = textNodes[ti];
      var candidateText = candidate.textContent || '';
      if (remaining <= candidateText.length) {
        textNode = candidate;
        anchorOffset = candidateText === '\u200B' ? 1 : remaining;
        break;
      }
      remaining -= candidateText.length;
      anchorOffset = candidateText.length;
    }

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
        try { fn.apply(null, a || []); } catch (e) { console.warn('[此刻] rafThrottle', e); }
      });
    };
  }

  w.MynoteDom = {
    escapeHTML: escapeHTML,
    getTextOffsetWithin: getTextOffsetWithin,
    focusEditableWithCaret: focusEditableWithCaret,
    rafThrottle: rafThrottle
  };
})(window);
