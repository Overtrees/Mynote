(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState;

  function SettingsView(_ref) {
    var onClose = _ref.onClose, onOpenBackup = _ref.onOpenBackup;
    var _useState = useState(function () { return localStorage.getItem('sj_fontsize') || 'medium'; });
    var fontSize = _useState[0];
    var setFontSize = _useState[1];

    var applyFontSize = function (size) {
      var map = { small:'14px', medium:'16px', large:'19px' };
      document.documentElement.style.fontSize = map[size] || '16px';
      localStorage.setItem('sj_fontsize', size);
      setFontSize(size);
    };

    var sizeOptions = [
      { key:'small', label:'\u5C0F', fs:'0.8125rem' },
      { key:'medium', label:'\u4E2D', fs:'0.9375rem' },
      { key:'large', label:'\u5927', fs:'1.0625rem' }
    ];

    return R.createElement('div', { style:{ background:'var(--primary-bg)', minHeight:'100vh' } },
      R.createElement('button', { className:'editor-fab left', onPointerDown:function(e){e.stopPropagation();onClose();} },
        R.createElement('svg', { xmlns:'http://www.w3.org/2000/svg', viewBox:'0 0 24 24', width:22, height:22, fill:'none', stroke:'currentColor', strokeWidth:'2.5', strokeLinecap:'round', strokeLinejoin:'round' },
          R.createElement('path', { d:'M15 18l-6-6 6-6' }))),
      R.createElement('div', { className:'page-title compact', style:{ visibility:'visible', opacity:1, pointerEvents:'none' } }, '\u8BBE\u7F6E'),
      R.createElement('div', { style:{ animation:'slideInFromRight 0.32s cubic-bezier(0.25,0.46,0.45,0.94) both' } },
        R.createElement('div', { style:{ padding:'126px 20px calc(40px + env(safe-area-inset-bottom))' } },
          R.createElement('div', { className:'section-header', style:{ paddingTop:4 } }, '\u5916\u89C2'),
          R.createElement('div', { className:'list-group' },
            R.createElement('div', { className:'list-item', style:{ cursor:'default' } },
              R.createElement('div', { className:'item-left' },
                R.createElement('div', { className:'item-title' },
                  R.createElement('span', { className:'item-title-text' }, '\u6587\u5B57\u5927\u5C0F')),
                R.createElement('div', { className:'item-meta' }, '\u8DDF\u968F\u6D4F\u89C8\u5668\u7F29\u653E')),
              R.createElement('div', { style:{ display:'flex', gap:6, flexShrink:0 } },
                sizeOptions.map(function(opt) {
                  var sel = fontSize === opt.key;
                  return R.createElement('button', { key:opt.key, onClick:function(){applyFontSize(opt.key);},
                    style:{ height:32, minWidth:40, padding:'0 12px', borderRadius:16,
                      border:sel ? '0.5px solid rgba(0,122,255,0.35)' : '0.5px solid var(--glass-border)',
                      background:sel ? 'rgba(0,122,255,0.1)' : 'var(--glass-bg)',
                      color:sel ? '#007aff' : 'var(--text-main)',
                      fontSize:opt.fs, fontWeight:sel ? 700 : 500,
                      fontFamily:'inherit', cursor:'pointer',
                      backdropFilter:'blur(40px) saturate(2.5) brightness(1.15)', WebkitBackdropFilter:'blur(40px) saturate(2.5) brightness(1.15)',
                      transition:'all 0.18s ease', lineHeight:1 }
                  }, opt.label);
                })))),
          R.createElement('div', { style:{ height:12 } }),
          R.createElement('div', { className:'section-header', style:{ paddingTop:4 } }, '\u6570\u636E'),
          R.createElement('div', { className:'list-group' },
            R.createElement('div', { className:'list-item', onClick:onOpenBackup },
              R.createElement('div', { className:'item-left' },
                R.createElement('div', { className:'item-title' },
                  R.createElement('span', { className:'item-title-text' }, '\u5907\u4EFD\u4E0E\u6062\u590D')),
                R.createElement('div', { className:'item-meta' }, 'Google Drive \u4E91\u7AEF\u540C\u6B65')),
              R.createElement('span', { style:{ color:'var(--text-secondary)', fontSize:'1.125rem', opacity:0.45, lineHeight:1 } }, '\u203A'))),
          R.createElement('div', { style:{ height:12 } }),
          R.createElement('div', { className:'section-header', style:{ paddingTop:4 } }, '\u5173\u4E8E'),
          R.createElement('div', { className:'list-group' },
            R.createElement('div', { className:'list-item' },
              R.createElement('div', { className:'item-left' },
              R.createElement("span", { style:{ color:"var(--text-secondary)", fontSize:"0.875rem", fontWeight:400 } }, "2.0.2")),'
            R.createElement("div", { style:{ height:"0.5px", background:"var(--border-color)", marginLeft:16, marginRight:16 } }),'
            R.createElement("div", { style:{ padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" } },'
              R.createElement("div", { className:"item-title" }, "'联系我们"'),'
              R.createElement("span", { style:{ color:"var(--text-secondary)", fontSize:"0.85rem" } }, "overcanopies@gmail.com"))),'


  w.SettingsView = SettingsView;
})(window);
