(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef, useCallback = R.useCallback;

  var BgSheet = function BgSheet(_ref) {
    var currentColor = _ref.currentColor, onSelect = _ref.onSelect, onRemove = _ref.onRemove, onClose = _ref.onClose;
    var presetColors = ['#eaeef2', '#e8e0d4', '#d4e8d0', '#d0e0e8', '#e8d0d4', '#fff3e0', '#e8e0f0', '#f0e8d0'];
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
      R.createElement('div', { onPointerDown:function(){closeWithAnim();}, style:{ position:'fixed', inset:0, zIndex:4000, background:'transparent' }}),
      R.createElement('div', { style:{ position:'fixed', left:0, right:0, bottom:'calc(env(safe-area-inset-bottom) + 14px)', zIndex:4001, display:'flex', justifyContent:'center', padding:'0 14px', pointerEvents:'none', opacity:closing?0:1, transform:closing?'translateY(20px)':'translateY(0)', transition:'opacity 200ms ease, transform 250ms cubic-bezier(0.34,1.56,0.64,1)' }, onPointerDown:function(e){e.stopPropagation();} },
        R.createElement('div', { style:{ width:'100%', maxWidth:600, background:'var(--glass-bg)', backdropFilter:'blur(40px) saturate(2.5) brightness(1.15)', WebkitBackdropFilter:'blur(40px) saturate(2.5) brightness(1.15)', border:'0.5px solid var(--glass-border)', borderRadius:28, boxShadow:'0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.25)', padding:'20px 20px calc(20px + env(safe-area-inset-bottom))', overflow:'hidden', pointerEvents:'auto' } },
          R.createElement('div', { style:{ textAlign:'center', marginBottom:16 } },
            R.createElement('div', { style:{ fontSize:20, fontWeight:700, color:'var(--text-main)', letterSpacing:'-0.3px' } }, '\u80CC\u666F\u8272'),
            R.createElement('div', { style:{ fontSize:13, color:'var(--text-main)', marginTop:4, opacity:0.7 } }, '\u4E3A\u5F53\u524D\u7B14\u8BB0\u8BBE\u7F6E\u5E95\u8272')),
          R.createElement('div', { style:{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:16 } },
            presetColors.map(function (c, i) {
              var selected = currentColor === c;
              return R.createElement('button', { key:c, 'aria-label':colorNames[i], onClick:function(){closeWithAnim(function(){onSelect && onSelect(c);});}, style:{ width:44, height:44, borderRadius:22, background:c, cursor:'pointer', padding:0, justifySelf:'center', border:selected?'2px solid #007aff':'0.5px solid rgba(0,0,0,0.12)', boxShadow:selected?'0 0 0 3px rgba(0,122,255,0.16)':'0 2px 8px rgba(0,0,0,0.08)', display:'flex', alignItems:'center', justifyContent:'center', transition:'transform 160ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 160ms ease, border 160ms ease' } },
                selected && R.createElement('svg', { viewBox:'0 0 24 24', width:20, height:20, fill:'none', xmlns:'http://www.w3.org/2000/svg', style:{ filter:'drop-shadow(0 1px 2px rgba(0,0,0,0.18))' } },
                  R.createElement('path', { d:'M5.5 12.3 10 16.7 18.8 7.8', stroke:'#007aff', strokeWidth:'2.5', strokeLinecap:'round', strokeLinejoin:'round' })));
            })),
          currentColor && R.createElement('div', { style:{ borderTop:'0.5px solid var(--border-color)', paddingTop:10, marginTop:4 } },
            R.createElement('button', { onClick:function(){closeWithAnim(function(){onRemove && onRemove();});}, style:{ width:'100%', minHeight:44, border:'none', background:'transparent', borderRadius:16, display:'flex', alignItems:'flex-start', justifyContent:'center', gap:6, padding:'8px 0', color:'#ff3b30', fontSize:15, fontFamily:'inherit', cursor:'pointer' } },
              R.createElement('span', { style:{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 } },
                R.createElement('span', { style:{ display:'flex', alignItems:'center', gap:6 } },
                  R.createElement('span', { style:{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }, 'aria-hidden':'true' },
                    R.createElement('svg', { viewBox:'0 0 24 24', width:20, height:20, fill:'none', xmlns:'http://www.w3.org/2000/svg' },
                      R.createElement('path', { d:'M4.5 7.5h15M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M8.5 7.5l.4 10a1.5 1.5 0 0 0 1.5 1.4h3.2a1.5 1.5 0 0 0 1.5-1.4l.4-10M10.2 11v4.5M13.8 11v4.5', stroke:'currentColor', strokeWidth:'2.5', strokeLinecap:'round', strokeLinejoin:'round' }))),
                  R.createElement('span', { style:{ fontSize:15, fontWeight:650, letterSpacing:'-0.1px', lineHeight:'24px' } }, '\u79FB\u9664\u80CC\u666F')),
                R.createElement('span', { style:{ fontSize:11, color:'var(--text-secondary)' } }, '\uFF08\u6062\u590D\u9ED8\u8BA4\u80CC\u666F\uFF09')))))));
  };

  w.BgSheet = BgSheet;
})(window);
