/* 斜杠命令面板 UI。状态与逻辑见 use-slash.js。 */
(function (w) {
  'use strict';
  var R = w.React;

  function SlashPanel(props) {
    var slashRef = props.slashRef;
    var editorBodyRef = props.editorBodyRef;
    var slashAnchor = props.slashAnchor;
    var slashClosing = props.slashClosing;
    var slashEntered = props.slashEntered;
    var slashCommands = props.slashCommands;
    var slashQuery = props.slashQuery;
    var slashSelectedIndex = props.slashSelectedIndex;
    var setSlashSelectedIndex = props.setSlashSelectedIndex;
    var applySlashCommand = props.applySlashCommand;
    var slashApplyingRef = props.slashApplyingRef;
    var SVG_ICONS = props.SVG_ICONS || {};
    var suppressPointerClickRef = props.suppressPointerClickRef;
    var pointerClickTimerRef = props.pointerClickTimerRef;

    function hl(text) {
      var q = (slashQuery || '').trim().toLowerCase();
      if (!q || !text) return text;
      var idx = text.toLowerCase().indexOf(q);
      if (idx === -1) return text;
      var before = text.slice(0, idx);
      var match = text.slice(idx, idx + q.length);
      var after = text.slice(idx + q.length);
      return R.createElement(R.Fragment, null, before, R.createElement('mark', {
        style: { background: 'var(--fill-accent-18)', color: 'var(--text-main)', borderRadius: 'var(--radius-3)', padding: '0 2px', fontWeight: 600 }
      }, match), after);
    }

    var prevLabel = null;
    var flatIdx = -1;
    return R.createElement('div', {
      ref: slashRef,
      onTouchStart: function () {
        // 阻止编辑器失焦：触摸面板时重新聚焦编辑器
        // 不用 preventDefault，保留面板内滚动能力
        if (editorBodyRef.current) editorBodyRef.current.focus();
      },
      style: {
        position: 'fixed',
        zIndex: 9999,
        left: slashAnchor.left,
        top: slashAnchor.top,
        width: slashAnchor.width,
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-filter)',
        WebkitBackdropFilter: 'var(--glass-filter)',
        border: '0.5px solid var(--glass-border)',
        boxShadow: 'var(--shadow-popover)',
        borderRadius: 'var(--radius-22)',
        padding: '10px 10px',
        maxHeight: 280,
        overflowY: 'auto',
        opacity: slashClosing ? 0 : slashEntered ? 1 : 0,
        transform: slashClosing ? 'scale(0.88) translateY(-6px)' : slashEntered ? 'scale(1) translateY(0)' : 'scale(0.88) translateY(-6px)',
        transition: 'opacity 0.12s ease, transform 0.16s cubic-bezier(0.34,1.56,0.64,1)',
        transformOrigin: 'top left'
      }
    },
      slashCommands.length === 0 && R.createElement('div', {
        style: { padding: '24px 12px 20px', color: 'var(--text-secondary)', fontSize: 'var(--font-13)', textAlign: 'center' }
      },
        R.createElement('svg', {
          width: 28, height: 28, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor',
          'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          style: { display: 'block', margin: '0 auto 8px', opacity: 0.4 }
        },
          R.createElement('circle', { cx: 8.5, cy: 8.5, r: 5.5 }),
          R.createElement('line', { x1: 12.5, y1: 12.5, x2: 17, y2: 17 })),
        '\u672A\u627E\u5230\u5339\u914D\u547D\u4EE4',
        R.createElement('div', { style: { fontSize: 'var(--font-11)', marginTop: 8, lineHeight: 1.6, opacity: 0.5 } },
          '\u8BD5\u8BD5\u62FC\u97F3\u9996\u5B57\u6BCD\uFF1A',
          R.createElement('br', null),
          R.createElement('span', { style: { background: 'var(--fill-hover)', padding: '1px 5px', borderRadius: 'var(--radius-4)', fontFamily: 'monospace', fontSize: 'var(--font-10)' } }, 'bt'),
          ' \u6807\u9898 \xB7 ',
          R.createElement('span', { style: { background: 'var(--fill-hover)', padding: '1px 5px', borderRadius: 'var(--radius-4)', fontFamily: 'monospace', fontSize: 'var(--font-10)' } }, 'tp'),
          ' \u56FE\u7247 \xB7 ',
          R.createElement('span', { style: { background: 'var(--fill-hover)', padding: '1px 5px', borderRadius: 'var(--radius-4)', fontFamily: 'monospace', fontSize: 'var(--font-10)' } }, 'yykp'),
          ' \u97F3\u4E50')),
      slashCommands.map(function (cmd) {
        var showHeader = cmd.sectionLabel && cmd.sectionLabel !== prevLabel;
        var isFirstSec = prevLabel === null;
        prevLabel = cmd.sectionLabel;
        flatIdx++;
        var baseStyle = {
          padding: '10px 12px',
          borderRadius: 'var(--radius-16)',
          cursor: 'pointer',
          fontSize: 'var(--font-14)',
          color: 'var(--text-main)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          position: 'relative',
          overflow: 'hidden',
          background: 'transparent',
          marginBottom: 2
        };
        return R.createElement(R.Fragment, { key: cmd.id },
          showHeader && R.createElement('div', {
            style: {
              padding: '6px 10px 4px',
              fontSize: 'var(--font-11)',
              fontWeight: 700,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
              opacity: 0.7,
              marginTop: isFirstSec ? 0 : 8,
              borderTop: isFirstSec ? 'none' : '0.5px solid var(--border-color)'
            }
          }, cmd.sectionLabel),
          R.createElement('div', {
            className: 'slash-row',
            onPointerDown: function () {
              // 不 preventDefault，保留滚动；只阻止编辑器失焦
              if (editorBodyRef.current) editorBodyRef.current.focus();
              setSlashSelectedIndex(flatIdx);
            },
            onPointerUp: function (e) {
              // PointerUp and the compatibility click are one physical gesture.
              // Suppress the click even if a slow device outlasts the apply lock.
              e.preventDefault();
              suppressPointerClickRef.current = true;
              clearTimeout(pointerClickTimerRef.current);
              pointerClickTimerRef.current = setTimeout(function () {
                suppressPointerClickRef.current = false;
              }, 1000);
              applySlashCommand(cmd);
            },
            onClick: function () {
              // Keep click as a fallback for keyboard/older input paths, never as
              // a second activation after pointerup.
              if (suppressPointerClickRef.current) {
                suppressPointerClickRef.current = false;
                clearTimeout(pointerClickTimerRef.current);
                return;
              }
              if (!slashApplyingRef.current) applySlashCommand(cmd);
            },
            onPointerEnter: function () { setSlashSelectedIndex(flatIdx); },
            onMouseEnter: function () { setSlashSelectedIndex(flatIdx); },
            style: baseStyle
          },
            R.createElement('div', {
              style: {
                width: 28, height: 28, borderRadius: 'var(--radius-8)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--fill-hover-strong)', fontSize: 'var(--font-14)',
                flex: '0 0 28px', position: 'relative', zIndex: 1
              },
              dangerouslySetInnerHTML: { __html: SVG_ICONS[cmd.icon] || '' }
            }),
            R.createElement('div', { style: { minWidth: 0, flex: 1, position: 'relative', zIndex: 1 } },
              R.createElement('div', { style: { fontWeight: 600, fontSize: 'var(--font-14)', display: 'flex', alignItems: 'center', gap: 6 } },
                R.createElement('span', null, hl(cmd.title)),
                cmd.recent && R.createElement('span', {
                  style: {
                    fontSize: 'var(--font-10)', color: 'var(--text-secondary)',
                    background: 'var(--glass-bg)',
                    padding: '1px 6px', borderRadius: 'var(--radius-999)', border: '0.5px solid var(--glass-border)', opacity: 0.85
                  }
                }, '\u6700\u8FD1')),
              R.createElement('div', { style: { fontSize: 'var(--font-12)', color: 'var(--text-secondary)', marginTop: 3 } }, hl(cmd.subtitle))),
            cmd.shortcut && R.createElement('div', {
              style: {
                fontSize: 'var(--font-10)', fontFamily: 'var(--font-family-mono)',
                color: 'var(--text-secondary)', opacity: 0.5, flexShrink: 0,
                padding: '2px 6px', borderRadius: 'var(--radius-6)', background: 'var(--fill-hover)',
                position: 'relative', zIndex: 1
              }
            }, cmd.shortcut)));
      }));
  }

  w.MynoteSlashPanel = SlashPanel;
})(window);
