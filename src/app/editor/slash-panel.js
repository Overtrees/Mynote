/* 斜杠命令面板 UI。状态与逻辑见 use-slash.js。 */
(function (w) {
  'use strict';
  var R = w.React;

  function SlashPanel(props) {
    var slashRef = props.slashRef;
    var slashAnchor = props.slashAnchor;
    var slashClosing = props.slashClosing;
    var slashEntered = props.slashEntered;
    var slashCommands = props.slashCommands || [];
    var slashQuery = props.slashQuery;
    var slashSelectedIndex = props.slashSelectedIndex;
    var setSlashSelectedIndex = props.setSlashSelectedIndex;
    var applySlashCommand = props.applySlashCommand;
    var closeSlashPanel = props.closeSlashPanel;
    var pendingLinkCommand = props.pendingLinkCommand;
    var slashLinkUrl = props.slashLinkUrl;
    var setSlashLinkUrl = props.setSlashLinkUrl;
    var slashLinkError = props.slashLinkError;
    var submitSlashLink = props.submitSlashLink;
    var cancelSlashLink = props.cancelSlashLink;
    var SVG_ICONS = props.SVG_ICONS || {};
    function hl(text) {
      var value = String(text || '');
      var q = String(slashQuery || '').trim().toLowerCase();
      if (!q || !value) return value;
      var idx = value.toLowerCase().indexOf(q);
      if (idx === -1) return value;
      return R.createElement(R.Fragment, null,
        value.slice(0, idx),
        R.createElement('mark', { className: 'slash-match' }, value.slice(idx, idx + q.length)),
        value.slice(idx + q.length));
    }

    function commandButtons() {
      return slashRef.current ? Array.prototype.slice.call(slashRef.current.querySelectorAll('[data-slash-command]')) : [];
    }

    function focusCommand(index) {
      var buttons = commandButtons();
      if (!buttons.length) return;
      var next = (index + buttons.length) % buttons.length;
      setSlashSelectedIndex(next);
      w.requestAnimationFrame(function () { if (buttons[next]) buttons[next].focus({ preventScroll: true }); });
    }

    function onPanelKeyDown(event) {
      if (pendingLinkCommand) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancelSlashLink();
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusCommand(slashSelectedIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusCommand(slashSelectedIndex - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusCommand(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusCommand(slashCommands.length - 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (typeof closeSlashPanel === 'function') closeSlashPanel(true);
      }
    }

    var previousSection = null;
    var itemRows = [];
    slashCommands.forEach(function (cmd, index) {
      var isFirstSection = previousSection === null;
      var showHeader = cmd.sectionLabel && cmd.sectionLabel !== previousSection;
      previousSection = cmd.sectionLabel;
      itemRows.push(R.createElement(R.Fragment, { key: cmd.id },
        showHeader && R.createElement('div', {
          className: 'slash-section-heading',
          role: 'presentation',
          style: { marginTop: isFirstSection ? 0 : 7 }
        }, cmd.sectionLabel),
        R.createElement('button', {
          id: 'mynote-slash-option-' + index,
          key: cmd.id + '-button',
          type: 'button',
          className: 'slash-row',
          role: 'option',
          'aria-selected': slashSelectedIndex === index ? 'true' : 'false',
          'aria-label': [cmd.title, cmd.subtitle, cmd.shortcut ? '快捷键 ' + cmd.shortcut : ''].filter(Boolean).join('，'),
          'data-slash-command': 'true',
          'data-slash-id': cmd.id,
          'data-slash-index': index,
          tabIndex: slashSelectedIndex === index ? 0 : -1,
          onPointerDown: function (event) {
            setSlashSelectedIndex(index);
            // 鼠标点选时保留编辑区原选区；触摸端不聚焦外层编辑容器，允许面板滚动。
            if (event.pointerType === 'mouse') event.preventDefault();
          },
          onFocus: function () { setSlashSelectedIndex(index); },
          onPointerEnter: function () { setSlashSelectedIndex(index); },
          onMouseEnter: function () { setSlashSelectedIndex(index); },
          onClick: function () { applySlashCommand(cmd); }
        },
          R.createElement('span', {
            className: 'slash-row-icon',
            'aria-hidden': 'true',
            dangerouslySetInnerHTML: { __html: SVG_ICONS[cmd.icon] || '' }
          }),
          R.createElement('span', { className: 'slash-row-copy' },
            R.createElement('span', { className: 'slash-row-title' },
              R.createElement('span', { className: 'slash-row-title-text' }, hl(cmd.title)),
              cmd.recent && R.createElement('span', { className: 'slash-recent-pill', 'aria-label': '最近使用' }, '最近')),
            R.createElement('span', { className: 'slash-row-subtitle' }, hl(cmd.subtitle))),
          cmd.shortcut && R.createElement('span', { className: 'slash-shortcut', 'aria-hidden': 'true' }, cmd.shortcut)
        )
      ));
    });

    var rootStyle = {
      position: 'fixed',
      zIndex: 9999,
      left: slashAnchor.left,
      top: slashAnchor.top,
      width: slashAnchor.width,
      maxHeight: 'min(320px, calc(100dvh - ' + (slashAnchor.top + 16) + 'px))',
      overflowY: 'auto',
      background: 'var(--glass-overlay-bg)',
      backdropFilter: 'var(--glass-overlay-filter)',
      WebkitBackdropFilter: 'var(--glass-overlay-filter)',
      border: '0.5px solid var(--glass-overlay-border)',
      borderRadius: 'var(--radius-22)',
      padding: '8px',
      color: 'var(--text-main)',
      opacity: slashClosing ? 0 : slashEntered ? 1 : 0,
      transform: slashClosing ? 'translateY(-4px)' : slashEntered ? 'translateY(0)' : 'translateY(-4px)',
      transition: 'opacity 140ms ease, transform 140ms ease',
      transformOrigin: 'top left',
      WebkitOverflowScrolling: 'touch'
    };

    return R.createElement('div', {
      ref: slashRef,
      id: 'mynote-slash-listbox',
      className: 'slash-panel',
      role: pendingLinkCommand ? 'dialog' : 'listbox',
      'aria-label': pendingLinkCommand ? '插入链接' : '斜杠命令',
      'aria-activedescendant': !pendingLinkCommand && slashCommands.length ? 'mynote-slash-option-' + slashSelectedIndex : undefined,
      'aria-orientation': 'vertical',
      onKeyDown: onPanelKeyDown,
      style: rootStyle
    }, pendingLinkCommand
      ? R.createElement('form', { className: 'slash-link-form', onSubmit: submitSlashLink },
          R.createElement('label', { className: 'slash-link-title', htmlFor: 'mynote-slash-link-url' }, '链接地址'),
          R.createElement('input', {
            id: 'mynote-slash-link-url',
            className: 'slash-link-input',
            type: 'url',
            autoFocus: true,
            inputMode: 'url',
            autoComplete: 'url',
            spellCheck: false,
            required: true,
            value: slashLinkUrl || '',
            placeholder: 'https://example.com',
            'aria-invalid': slashLinkError ? 'true' : 'false',
            'aria-describedby': slashLinkError ? 'mynote-slash-link-error' : undefined,
            onChange: function (event) { setSlashLinkUrl(event.target.value); },
            onFocus: function (event) { event.currentTarget.select(); },
            onKeyDown: function (event) {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancelSlashLink();
              }
            }
          }),
          slashLinkError && R.createElement('div', { id: 'mynote-slash-link-error', className: 'slash-link-error', role: 'alert' }, slashLinkError),
          R.createElement('div', { className: 'slash-link-actions' },
            R.createElement('button', { type: 'button', className: 'slash-link-cancel', onClick: cancelSlashLink }, '取消'),
            R.createElement('button', { type: 'submit', className: 'slash-link-submit' }, '插入链接')))
      : slashCommands.length === 0
        ? R.createElement('div', { className: 'slash-empty-state', role: 'status' },
            R.createElement('svg', {
              width: 28, height: 28, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor',
              'strokeWidth': '1.5', 'strokeLinecap': 'round', 'strokeLinejoin': 'round', 'aria-hidden': 'true'
            }, R.createElement('circle', { cx: 8.5, cy: 8.5, r: 5.5 }), R.createElement('line', { x1: 12.5, y1: 12.5, x2: 17, y2: 17 })),
            R.createElement('div', null, '未找到匹配命令'),
            R.createElement('div', { className: 'slash-empty-hint' }, '试试拼音首字母：',
              R.createElement('kbd', null, 'bt'), ' 标题 · ', R.createElement('kbd', null, 'tp'), ' 图片 · ', R.createElement('kbd', null, 'yykp'), ' 音乐'))
        : itemRows
    );
  }

  w.MynoteSlashPanel = SlashPanel;
})(window);
