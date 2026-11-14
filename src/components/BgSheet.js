(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef, useCallback = R.useCallback;

  var BgSheet = function BgSheet(_ref) {
    var currentColor = _ref.currentColor, onSelect = _ref.onSelect, onRemove = _ref.onRemove, onClose = _ref.onClose;
    var presetColors = (w.MynoteTokens && w.MynoteTokens.palette.backgroundColors) || [];
    var _useState = useState(false), closing = _useState[0], setClosing = _useState[1];
    var closeTimerRef = useRef(null);
    var colorNames = ['\u51B7\u96FE', '\u6696\u6C99', '\u6D45\u7EFF', '\u6D45\u84DD', '\u6D45\u7C89', '\u7C73\u6A59', '\u6DE1\u7D2B', '\u6D45\u674F'];

    var closeWithAnim = useCallback(function (afterClose) {
      clearTimeout(closeTimerRef.current);
      setClosing(true);
      closeTimerRef.current = setTimeout(function () {
        if (afterClose) afterClose(); else if (onClose) onClose();
      }, 220);
    }, [onClose]);
    useEffect(function () { return function () { clearTimeout(closeTimerRef.current); }; }, []);

    return R.createElement(R.Fragment, null,
      R.createElement('div', { onPointerDown:function(){closeWithAnim();}, style:w.MynoteInlineStyles.fixedOverlay}),
      R.createElement('div', { style:{ position:'fixed', left:0, right:0, bottom:'calc(env(safe-area-inset-bottom) + 14px)', zIndex:4001, display:'flex', justifyContent:'center', padding:'0 14px', pointerEvents:'none', opacity:closing?0:1, transform:closing?'translateY(20px)':'translateY(0)', transition:'opacity 200ms ease, transform 250ms cubic-bezier(0.34,1.56,0.64,1)' }, onPointerDown:function(e){e.stopPropagation();} },
        R.createElement('div', { style:{ width:'100%', maxWidth:600, background:'var(--glass-bg)', backdropFilter:"var(--glass-filter)", WebkitBackdropFilter:"var(--glass-filter)", border:'0.5px solid var(--glass-border)', borderRadius:"var(--radius-28)", boxShadow:"var(--shadow-float-strong)", padding:'20px 20px calc(20px + env(safe-area-inset-bottom))', overflow:'hidden', pointerEvents:'auto' } },
          R.createElement('div', { style:{ textAlign:'center', marginBottom:16 } },
            R.createElement('div', { style:{ fontSize:"var(--font-20)", fontWeight:700, color:'var(--text-main)', letterSpacing:'-0.3px' } }, '\u80CC\u666F\u8272'),
            R.createElement('div', { style:{ fontSize:"var(--font-13)", color:'var(--text-main)', marginTop:4, opacity:0.7 } }, '\u4E3A\u5F53\u524D\u7B14\u8BB0\u8BBE\u7F6E\u5E95\u8272')),
          R.createElement('div', { style:{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:16 } },
            presetColors.map(function (c, i) {
              var selected = currentColor === c;
              return R.createElement('button', { key:c, 'aria-label':colorNames[i], onClick:function(){closeWithAnim(function(){onSelect && onSelect(c);});}, style:{ width:44, height:44, borderRadius:"var(--radius-22)", background:c, cursor:'pointer', padding:0, justifySelf:'center', border:selected?'2px solid var(--color-accent)':'0.5px solid var(--color-black-12)', boxShadow:selected?'0 0 0 3px var(--fill-accent-16)':'0 2px 8px var(--color-black-08)', display:'flex', alignItems:'center', justifyContent:'center', transition:'transform 160ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 160ms ease, border 160ms ease' } },
                selected && R.createElement('svg', { viewBox:'0 0 24 24', width:20, height:20, fill:'none', xmlns:'http://www.w3.org/2000/svg', style:{ filter:'drop-shadow(0 1px 2px var(--color-black-18))' } },
                  R.createElement('path', { d:'M5.5 12.3 10 16.7 18.8 7.8', stroke:'var(--color-accent)', strokeWidth:'2.5', strokeLinecap:'round', strokeLinejoin:'round' })));
            })),
          currentColor && R.createElement('div', { style:{ borderTop:'0.5px solid var(--border-color)', paddingTop:10, marginTop:4 } },
            R.createElement('button', { onClick:function(){closeWithAnim(function(){onRemove && onRemove();});}, style:{ width:'100%', minHeight:44, border:'none', background:'transparent', borderRadius:"var(--radius-16)", display:'flex', alignItems:'flex-start', justifyContent:'center', gap:6, padding:'8px 0', color:"var(--color-danger-bright)", fontSize:"var(--font-15)", fontFamily:'inherit', cursor:'pointer' } },
              R.createElement('span', { style:{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 } },
                R.createElement('span', { style:w.MynoteInlineStyles.centerRow6 },
                  R.createElement('span', { style:{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }, 'aria-hidden':'true' },
                    R.createElement('svg', { viewBox:'0 0 24 24', width:20, height:20, fill:'none', xmlns:'http://www.w3.org/2000/svg' },
                      R.createElement('path', { d:'M4.5 7.5h15M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M8.5 7.5l.4 10a1.5 1.5 0 0 0 1.5 1.4h3.2a1.5 1.5 0 0 0 1.5-1.4l.4-10M10.2 11v4.5M13.8 11v4.5', stroke:'currentColor', strokeWidth:'2.5', strokeLinecap:'round', strokeLinejoin:'round' }))),
                  R.createElement('span', { style:{ fontSize:"var(--font-15)", fontWeight:650, letterSpacing:'-0.1px', lineHeight:'24px' } }, '\u79FB\u9664\u80CC\u666F')),
                R.createElement('span', { style:{ fontSize:"var(--font-11)", color:'var(--text-secondary)' } }, '\uFF08\u6062\u590D\u9ED8\u8BA4\u80CC\u666F\uFF09')))))));
  };

  w.BgSheet = BgSheet;
})(window);
