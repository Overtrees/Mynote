/* 图文卡片全文阅读面板；阅读模式不唤起键盘，编辑由用户显式进入。 */
(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef, useCallback = R.useCallback;

  function ImageTextSheet(props) {
    var text = typeof props.text === 'string' ? props.text : '';
    var onChange = props.onChange, onClose = props.onClose;
    var _editing = useState(false), editing = _editing[0], setEditing = _editing[1];
    var _closing = useState(false), closing = _closing[0], setClosing = _closing[1];
    var closeTimerRef = useRef(null);
    var closingRef = useRef(false);
    var onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    var closeWithAnim = useCallback(function () {
      if (closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      closeTimerRef.current = setTimeout(function () { onCloseRef.current && onCloseRef.current(); }, 220);
    }, []);

    useEffect(function () {
      var onKeyDown = function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeWithAnim();
        }
      };
      document.addEventListener('keydown', onKeyDown);
      return function () {
        document.removeEventListener('keydown', onKeyDown);
        clearTimeout(closeTimerRef.current);
      };
    }, [closeWithAnim]);

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
          className: 'image-text-sheet',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'image-text-sheet-title'
        },
          R.createElement('header', { className: 'image-text-sheet-header' },
            R.createElement('h2', { id: 'image-text-sheet-title', style: w.MynoteInlineStyles.sheetTitle }, '完整文本')),
          editing
            ? R.createElement('textarea', {
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
              type: 'button',
              className: 'image-text-sheet-action',
              onClick: function () { setEditing(function (value) { return !value; }); }
            }, editing ? '完成编辑' : '编辑文字')))));
  }

  w.ImageTextSheet = ImageTextSheet;
})(window);
