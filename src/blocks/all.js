(function (w) {
  'use strict';
  if (!w.BlockSystem) return;
  var BS = w.BlockSystem;
  var R = w.React;

  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  /* ===== paragraph ===== */
  BS.register('paragraph', {
    isAtomic: false,
    render: function (node, ctx) {
      var text = (node.children && node.children[0] && node.children[0].text) || '';
      if (ctx.autoRenderMap && ctx.autoRenderMap[node.id] && (w.looksLikeCiaoMarkdown && w.looksLikeCiaoMarkdown(text))) {
        return R.createElement('div', {
          key: node.id + '_' + ctx.renderKey, 'data-blockid': node.id, 'data-type': 'paragraph',
          contentEditable: false, className: 'markdown-render',
          style: { minHeight: '1.5em', cursor: 'pointer', padding: '2px 0' },
          dangerouslySetInnerHTML: { __html: (w.renderMarkdownHtml && w.renderMarkdownHtml(text)) || '<p><br></p>' },
          onClick: function () { ctx.setAutoRenderMap && ctx.setAutoRenderMap(function (p) { var n = Object.assign({}, p); delete n[node.id]; return n; }); }
        });
      }
      return R.createElement('p', {
        key: node.id + '_' + ctx.renderKey, 'data-blockid': node.id, 'data-type': 'paragraph',
        style: { margin: '1px 0', minHeight: '1.5em' }
      }, text || '\u200B');
    }
  });

  /* ===== heading ===== */
  BS.register('heading', {
    isAtomic: false,
    render: function (node, ctx) {
      var text = (node.children && node.children[0] && node.children[0].text) || '';
      var level = (node.attrs && node.attrs.level) || 2;
      var sizes = { 1:1.5, 2:1.25, 3:1.1, 4:1, 5:0.9, 6:0.85 };
      var size = sizes[level] || 1.25;
      return R.createElement('h' + level, {
        key: node.id + '_' + ctx.renderKey, 'data-blockid': node.id, 'data-type': 'heading', 'data-level': level,
        style: { margin: '0.5em 0 0.2em', fontSize: size + 'em', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.3 }
      }, text || '\u200B');
    }
  });

  /* ===== quote ===== */
  BS.register('quote', {
    isAtomic: false,
    render: function (node, ctx) {
      var text = (node.children && node.children[0] && node.children[0].text) || '';
      return R.createElement('blockquote', {
        key: node.id + '_' + ctx.renderKey, 'data-blockid': node.id, 'data-type': 'quote',
        style: { margin:'0.6em 0', padding:'10px 14px 10px 16px', borderLeft:'3px solid rgba(0,122,255,0.35)',
                 background:'var(--card-bg)', borderRadius:'999px', borderTop:'0.5px solid var(--border-color)',
                 borderRight:'0.5px solid var(--border-color)', borderBottom:'0.5px solid var(--border-color)',
                 color:'var(--text-secondary)', fontSize:'14px', lineHeight:'1.6', boxShadow:'0 1px 3px rgba(0,0,0,0.03)' }
      }, text || '\u200B');
    }
  });

  /* ===== todo ===== */
  BS.register('todo', {
    isAtomic: false,
    render: function (node, ctx) {
      var text = (node.children && node.children[0] && node.children[0].text) || '';
      var checked = (node.attrs && node.attrs.checked) || false;
      return R.createElement('div', {
        key: node.id + '_' + ctx.renderKey, 'data-blockid': node.id, 'data-type': 'todo',
        style: { display:'flex', alignItems:'center', gap:8, margin:'4px 0' }
      }, R.createElement('input', { type:'checkbox', checked:checked, readOnly:true,
        style:{ width:18, height:18, margin:0, cursor:'pointer' },
        onClick:function(e){ e.preventDefault(); ctx.updateBlock && ctx.updateBlock(node.id, { attrs: Object.assign({}, node.attrs||{}, { checked:!checked }) }); }
      }), R.createElement('span', { style:{ flex:1, textDecoration:checked?'line-through':'none', opacity:checked?0.5:1 } }, text || '\u200B'));
    }
  });

  /* ===== divider ===== */
  BS.register('divider', {
    isAtomic: true,
    render: function (node, ctx) {
      return R.createElement('hr', { key:node.id, 'data-blockid':node.id, 'data-type':'divider',
        style:{ border:'none', height:'1px', background:'linear-gradient(to right, transparent, var(--border-color), transparent)', margin:'0.8em auto', width:'60%', opacity:0.6 }
      });
    }
  });

  /* ===== image ===== */
  BS.register('image', {
    isAtomic: true,
    render: function (node, ctx) {
      var attrs = node.attrs || {};
      var src = attrs.src || '';
      if (!src) {
        return R.createElement('div', { key:node.id, 'data-blockid':node.id, 'data-type':'image',
          style:{ borderRadius:14, overflow:'hidden', margin:'8px 36px', background:'var(--card-bg)', border:'0.5px solid var(--border-color)', height:160, display:'flex', alignItems:'center', justifyContent:'center', color:'#c7c7cc', fontSize:13 }
        }, '\uD83D\uDCF7 \u70B9\u51FB\u6DFB\u52A0\u56FE\u7247');
      }
      return R.createElement('img', { key:node.id, 'data-blockid':node.id, 'data-type':'image',
        src:(typeof w.proxyImg === 'function' ? w.proxyImg(src) : src) || src, alt:attrs.alt||'',
        style:{ maxWidth:'100%', borderRadius:10, margin:'8px 0', display:'block' },
        onError:function(e){ e.target.style.display='none'; }
      });
    }
  });

  /* ===== gallery ===== */
  BS.register('gallery', {
    isAtomic: true,
    render: function (node, ctx) {
      var items = (node.attrs && node.attrs.items) || [];
      if (items.length === 0) {
        return R.createElement('div', { key:node.id, 'data-blockid':node.id, 'data-type':'gallery',
          style:{ borderRadius:14, overflow:'hidden', margin:'8px 36px', background:'var(--card-bg)', border:'0.5px solid var(--border-color)' }
        }, R.createElement('div', { style:{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:6, padding:'6px 0 14px' } },
          R.createElement('div', { style:{ height:366, background:'rgba(0,0,0,0.03)', borderRadius:22, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', color:'#c7c7cc' } },
            R.createElement('span', { style:{ fontSize:18, opacity:0.4 } }, '\uD83D\uDDBC'),
            R.createElement('span', { style:{ fontSize:11, marginTop:4, opacity:0.5 } }, '\u70B9\u51FB\u6DFB\u52A0')),
          R.createElement('div', { style:{ height:366, background:'rgba(0,0,0,0.02)', borderRadius:22, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', color:'#c7c7cc' } },
            R.createElement('span', { style:{ fontSize:18, opacity:0.3 } }, '\uD83D\uDDBC'),
            R.createElement('span', { style:{ fontSize:11, marginTop:4, opacity:0.4 } }, '\u591A\u5F20\u56FE\u7247'))));
      }
      return R.createElement('div', { key:node.id, 'data-blockid':node.id, 'data-type':'gallery',
        style:{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:4, margin:'8px 0', borderRadius:12, overflow:'hidden' }
      }, items.map(function (item, i) {
        var fi = item && item.fileId;
        var src = (fi && ctx && ctx.files && ctx.files[fi] && ctx.files[fi].url) || (item && item.url) || item;
        return R.createElement('img', { key:i, src:(typeof w.proxyImg === 'function' ? w.proxyImg(src) : src) || src,
          style:{ width:'100%', height:366, objectFit:'cover', borderRadius:22 },
          onError:function(e){ e.target.style.display='none'; }
        });
      }));
    }
  });

  /* ===== imgTextCard ===== */
  BS.register('imgTextCard', {
    isAtomic: true,
    render: function (node, ctx) {
      var text = (node.children && node.children[0] && node.children[0].text) || '';
      return R.createElement('div', { key:node.id, 'data-blockid':node.id, 'data-type':'imgTextCard',
        style:{ borderRadius:16, overflow:'hidden', margin:'8px 0', background:'var(--card-bg)', border:'0.5px solid var(--border-color)', boxShadow:'0 2px 8px rgba(0,0,0,0.03)' }
      }, R.createElement('div', { style:{ width:'100%', height:160, background:'rgba(0,0,0,0.03)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, color:'#c7c7cc' } },
        '\uD83D\uDCF7 \u70B9\u51FB\u6DFB\u52A0\u56FE\u7247'),
        R.createElement('div', { contentEditable:true, suppressContentEditableWarning:true,
          style:{ padding:'12px 14px', fontSize:14, lineHeight:1.6, color:'var(--text-main)', minHeight:44, outline:'none' }
        }, text || '\u70B9\u51FB\u8F93\u5165\u6587\u5B57'));
    }
  });

  /* ===== imageTextRow ===== */
  BS.register('imageTextRow', {
    isAtomic: true,
    render: function (node, ctx) {
      var text = (node.children && node.children[0] && node.children[0].text) || '';
      return R.createElement('div', { key:node.id, 'data-blockid':node.id, 'data-type':'imageTextRow',
        style:{ display:'flex', gap:10, borderRadius:16, overflow:'hidden', margin:'8px 0', background:'var(--card-bg)', border:'0.5px solid var(--border-color)', minHeight:100 }
      }, R.createElement('div', { style:{ flex:'0 0 50%', minWidth:0, background:'rgba(0,0,0,0.03)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, opacity:0.3 } },
        '\uD83D\uDCF7'), R.createElement('div', { contentEditable:true, suppressContentEditableWarning:true,
          style:{ flex:1, padding:'10px 12px 10px 0', fontSize:14, lineHeight:1.6, color:'var(--text-main)', display:'flex', alignItems:'center', outline:'none' }
        }, text || '\u70B9\u51FB\u8F93\u5165\u8BF4\u660E\u6587\u5B57'));
    }
  });

  /* ===== musicCard ===== */
  BS.register('musicCard', {
    isAtomic: true,
    render: function (node, ctx) {
      var url = node.url || '';
      var meta = node.meta;
      var status = node.status || 'empty';
      if (status === 'loading' && url) {
        return R.createElement('div', { key:node.id, 'data-blockid':node.id, 'data-type':'musicCard', className:'link-card-skeleton' },
          R.createElement('div', { className:'link-card-skeleton-cover' }),
          R.createElement('div', { className:'link-card-skeleton-body' },
            R.createElement('div', { className:'link-card-skeleton-line', style:{ width:'75%' } }),
            R.createElement('div', { className:'link-card-skeleton-line', style:{ width:'50%' } })));
      }
      if (!meta || !meta.title) {
        return R.createElement('div', { key:node.id, 'data-blockid':node.id, 'data-type':'musicCard',
          style:{ padding:'12px 16px', borderRadius:999, background:'var(--card-bg)', border:'0.5px solid var(--border-color)', fontSize:14, color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:10 }
        }, R.createElement('span', null, '\uD83C\uDFB5'), R.createElement('span', null, url || '\u70B9\u51FB\u7C98\u8D34\u97F3\u4E50\u94FE\u63A5'));
      }
      var coverUrl = (typeof w.proxyImg === 'function' ? w.proxyImg(meta.cover) : meta.cover) || meta.cover;
      var hasCover = !!coverUrl;
      return R.createElement('div', { key:node.id, className:'link-card-block', 'data-blockid':node.id, 'data-type':'musicCard', 'data-url':url,
        onClick:function(){ window.open(url, '_blank'); }
      }, hasCover && R.createElement('div', { className:'lkc-cover' },
        R.createElement('img', { src:coverUrl, alt:'', onError:function(e){ var p=e.target.closest('.lkc-cover'); if(p)p.style.display='none'; } })),
        R.createElement('div', { className:'lkc-body' + (hasCover?' has-cover':'') },
          R.createElement('div', { className:'lkc-title' }, meta.title),
          meta.subtitle && R.createElement('div', { className:'lkc-subtitle' }, meta.subtitle),
          R.createElement('div', { className:'lkc-source' },
            R.createElement('span', { className:'lkc-source-icon' }, '\uD83C\uDFB5'),
            R.createElement('span', { className:'lkc-source-dot' }),
            R.createElement('span', { className:'lkc-source-text' }, meta.source || '\u97F3\u4E50'))));
    }
  });

  /* ===== embedCard ===== */
  BS.register('embedCard', {
    isAtomic: true,
    render: function (node, ctx) {
      var comp = w.LinkCard;
      return comp ? R.createElement(comp, { key:node.id, node:Object.assign({}, node, { type:'link-card' }) }) : null;
    }
  });

  /* ===== attachment ===== */
  BS.register('attachment', {
    isAtomic: true,
    render: function (node, ctx) {
      return (ctx.renderAttachment && ctx.renderAttachment(node, ctx.files && ctx.files[node.fileId], ctx.LazyImage)) || null;
    }
  });

  /* ===== link-card ===== */
  BS.register('link-card', {
    isAtomic: true,
    render: function (node, ctx) {
      var comp = w.LinkCard;
      return comp ? R.createElement(comp, { key:node.id, node:Object.assign({}, node, { url:node.url, meta:node.meta, status:node.status }) }) : null;
    }
  });
})(window);
