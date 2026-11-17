/* 图文卡片全文阅读面板；阅读模式不唤起键盘，编辑由用户显式进入。 */
(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef, useCallback = R.useCallback;

  function focusElement(element) {
    if (!element || typeof element.focus !== 'function') return;
    try { element.focus({ preventScroll: true }); }
    catch (_) { element.focus(); }
  }

  function getFocusableElements(container) {
    var selector = 'a[href], area[href], input:not([type="hidden"]), select, textarea, button, iframe, object, embed, [contenteditable="true"], [tabindex]';
    return Array.prototype.slice.call(container.querySelectorAll(selector)).filter(function (element) {
      if (element.disabled || element.hidden || element.tabIndex < 0 || element.getAttribute('aria-hidden') === 'true') return false;
      if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
      if (w.getComputedStyle && w.getComputedStyle(element).visibility === 'hidden') return false;
      return true;
    });
  }

  function ImageTextSheet(props) {
    var text = typeof props.text === 'string' ? props.text : '';
    var onChange = props.onChange, onClose = props.onClose;
    var _editing = useState(false), editing = _editing[0], setEditing = _editing[1];
    var _closing = useState(false), closing = _closing[0], setClosing = _closing[1];
    var closeTimerRef = useRef(null);
    var closingRef = useRef(false);
    var onCloseRef = useRef(onClose);
    var triggerRef = useRef(props.triggerElement || null);
    var dialogRef = useRef(null);
    var actionRef = useRef(null);
    var editorRef = useRef(null);
    var editingRef = useRef(false);
    onCloseRef.current = onClose;

    var closeWithAnim = useCallback(function () {
      if (closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      closeTimerRef.current = setTimeout(function () {
        focusElement(triggerRef.current);
        onCloseRef.current && onCloseRef.current();
      }, 220);
    }, []);

    useEffect(function () {
      focusElement(dialogRef.current);
      var onKeyDown = function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeWithAnim();
          return;
        }
        if (e.key !== 'Tab') return;
        var dialog = dialogRef.current;
        if (!dialog) return;
        var focusable = getFocusableElements(dialog);
        if (!focusable.length) {
          e.preventDefault();
          focusElement(dialog);
          return;
        }
        var activeIndex = focusable.indexOf(w.document.activeElement);
        if (e.shiftKey) {
          if (activeIndex <= 0) {
            e.preventDefault();
            focusElement(focusable[focusable.length - 1]);
          }
        } else if (activeIndex < 0 || activeIndex === focusable.length - 1) {
          e.preventDefault();
          focusElement(focusable[0]);
        }
      };
      w.document.addEventListener('keydown', onKeyDown);
      return function () {
        w.document.removeEventListener('keydown', onKeyDown);
        clearTimeout(closeTimerRef.current);
      };
    }, [closeWithAnim]);

    useEffect(function () {
      if (editing) focusElement(editorRef.current);
      else if (editingRef.current) focusElement(actionRef.current);
      editingRef.current = editing;
    }, [editing]);

    return R.createElement(R.Fragment, null,
      R.createElement('div', {
        className: 'image-text-sheet-backdrop' + (closing ? ' is-closing' : ''),
        onPointerDown: closeWithAnim,
        style: w.MynoteInlineStyles.fixedOverlay,
        'aria-hidden': 'true'
      }),
      R.createElement('div', {
        className: 'image-text-sheet-wrap' + (closing ? ' is-closing' : ''),
        onPointerDown: function (e) { e.stopPropagation(); }
      },
        R.createElement('section', {
          ref: dialogRef,
          className: 'image-text-sheet',
          role: 'dialog',
          tabIndex: -1,
          'aria-modal': 'true',
          'aria-labelledby': 'image-text-sheet-title'
        },
          R.createElement('header', { className: 'image-text-sheet-header' },
            R.createElement('h2', { id: 'image-text-sheet-title', style: w.MynoteInlineStyles.sheetTitle }, '完整文本')),
          editing
            ? R.createElement('textarea', {
                ref: editorRef,
                className: 'image-text-sheet-editor',
                value: text,
                onChange: function (e) { onChange && onChange(e.target.value); },
                placeholder: '输入图片说明文字…',
                'aria-label': '编辑图片说明文字',
                autoFocus: true
              })
            : R.createElement('div', { className: 'image-text-sheet-content' }, text || '暂无文本内容'),
          R.createElement('footer', { className: 'image-text-sheet-footer' },
            R.createElement('button', {
              ref: actionRef,
              type: 'button',
              className: 'image-text-sheet-action',
              onClick: function () { setEditing(function (value) { return !value; }); }
            }, editing ? '完成编辑' : '编辑文字')))));
  }

  w.ImageTextSheet = ImageTextSheet;
})(window);
