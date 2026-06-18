(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef, useCallback = R.useCallback;

  var thumbCache = {};

  function SwipeRow(_ref) {
    var memo = _ref.memo, onOpen = _ref.onOpen, onPin = _ref.onPin, onDelete = _ref.onDelete, expandText = _ref.expandText, onExpand = _ref.onExpand, weather = _ref.weather;
    var rowRef = useRef(null), wrapperRef = useRef(null), btn1Ref = useRef(null), btn2Ref = useRef(null);
    var ACTION_W = 168, THRESHOLD = 55, MIN_DX = 5;
    var _useState = useState(thumbCache[memo.id] || null), thumb = _useState[0], setThumb = _useState[1];
    var isNewCard = memo && memo.id === (w.CikeConstants ? w.CikeConstants.NEW_CARD_ID : '__new_memo_card__');
    var sw = w.CikeHooks.useSwipeGesture({ isNewCard: isNewCard });
    var idRef = useRef(memo.id);
    idRef.current = memo.id;

    // Preview text calculation
    var preview = '\u65E0\u66F4\u591A\u6587\u672C', attachCount = 0, tags = [];
    if (memo.doc) {
      var paras = [];
      for (var ni = 0; ni < memo.doc.length; ni++) {
        var n = memo.doc[ni];
        if (n.type === 'paragraph' && n.children && n.children[0]) {
          var t = (n.children[0].text || '').trim();
          if (t) { paras.push(t); var mt = t.match(/#[\u4e00-\u9fa5\w-]+/g); if (mt) for (var ti = 0; ti < mt.length; ti++) { if (tags.indexOf(mt[ti]) === -1) tags.push(mt[ti]); } }
        }
        if (n.type === 'attachment') attachCount++;
      }
      if (paras.length > 0) {
        var raw = paras.join(' ');
        tags = tags.slice(0, 3);
        var stripped = (typeof w.stripMarkdownForPreview === 'function' ? w.stripMarkdownForPreview(raw) : raw).replace(/#[\u4e00-\u9fa5\w-]+/g, '').trim().slice(0, 80);
        preview = stripped || (tags.length > 0 ? tags[0].replace(/^#/, '') : '\u65E0\u66F4\u591A\u6587\u672C');
      }
    }

    // Thumbnail loading
    useEffect(function () {
      if (isNewCard) return;
      if (thumbCache[memo.id]) { setThumb(thumbCache[memo.id]); return; }
      setThumb(null);
      var firstAttach = memo.doc && memo.doc.find(function(n){return n.type === 'attachment';});
      if (!firstAttach) return;
      var cancelled = false;
      (async function() {
        try {
          var db = await (w.CikeIdb ? w.CikeIdb.getDB() : null);
          if (!db) return;
          for (var attempt = 0; attempt < 5 && !cancelled; attempt++) {
            var stored = await (w.CikeIdb ? w.CikeIdb.loadAttachmentFromDB(db, firstAttach.fileId).catch(function(){return null;}) : null);
            if (!stored) break;
            if (stored.type && stored.type.indexOf('image/') === 0 && stored.thumb) { if (!cancelled) { setThumb(stored.thumb); thumbCache[idRef.current] = stored.thumb; } return; }
            await new Promise(function(r){setTimeout(r,300);});
          }
        } catch(e) {}
      })();
      return function() { cancelled = true; };
    }, [memo.id, memo.doc, isNewCard]);

    return R.createElement('div', { className:'swipe-wrapper', ref:sw.wrapperRef },
      !isNewCard && R.createElement('div', { className:'swipe-actions' },
        R.createElement('button', { ref:sw.btn1Ref, className:'swipe-action-btn', style:{ background:'#4A90D9', transform:'translateX(60px)', opacity:0 },
          onClick:function(e){e.stopPropagation();sw.snapClose();onPin(memo.id);}
        }, typeof w.SvgIcon === 'function' ? w.SvgIcon('pinMulti', {width:17,height:17,strokeWidth:2.2,stroke:'#fff'}) : null,
        memo.pinned ? '\u53D6\u6D88' : '\u7F6E\u9876'),
        R.createElement('button', { ref:sw.btn2Ref, className:'swipe-action-btn', style:{ background:'#E0433A', transform:'translateX(30px)', opacity:0 },
          onClick:function(e){e.stopPropagation();sw.snapClose();onDelete(memo.id);}
        }, typeof w.SvgIcon === 'function' ? w.SvgIcon('delMulti', {width:17,height:17,strokeWidth:2.2,stroke:'#fff'}) : null,
        '\u5220\u9664')),
      R.createElement('div', { ref:sw.rowRef, className:'list-item',
        onPointerDown:function(){if(isNewCard)onOpen(memo);},
        onClick:function(){if(isNewCard)return; sw.gesture.current.opened ? sw.snapClose() : onOpen(memo);}
      },
        R.createElement('div', { className:'item-left' },
          R.createElement('div', { className:'item-title' + (isNewCard?' new-card-title':''), style:{ display:'flex', alignItems:'center', gap:6, width:'100%' } },
            !isNewCard && memo.pinned && R.createElement('span', { className:'pin-dot' }),
            R.createElement('span', { className:'item-title-text' }, isNewCard ? '\u65B0\u5EFA\u7B14\u8BB0' : (memo.title || '\u65E0\u6807\u9898')),
            !isNewCard && tags.length > 0 && R.createElement('div', { style:{ display:'flex', gap:4, flexWrap:'wrap', overflow:'hidden', justifyContent:'flex-end', flex:1, minWidth:0 } },
              tags.map(function(t){return R.createElement('span', { key:t, style:{fontSize:10, color:'#007aff', background:'var(--glass-bg)', backdropFilter:'blur(40px) saturate(2.5) brightness(1.15)', WebkitBackdropFilter:'blur(40px) saturate(2.5) brightness(1.15)', padding:'0 5px', borderRadius:999, lineHeight:'18px', whiteSpace:'nowrap', border:'0.5px solid var(--glass-border)'} }, t);}))),
          R.createElement('div', { className:'item-meta', style:{ display:'flex', alignItems:'center', gap:6 } },
            R.createElement('span', { style:{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 } },
              (isNewCard ? '\u73B0\u5728' : (typeof w.timeAgo === 'function' ? w.timeAgo(memo.updatedAt) : memo.updatedAt)),
              '\u00A0\u00A0', isNewCard ? '\u70B9\u51FB\u8BB0\u5F55\u4F60\u7684\u77AC\u95F4' : preview),
            expandText && R.createElement('span', { className:'expand-btn', onClick:function(e){e.stopPropagation();onExpand&&onExpand();} }, expandText))),
        isNewCard && weather && R.createElement('div', { style:{ display:'flex', flexDirection:'column', alignItems:'flex-end', justifyContent:'center', gap:4, flexShrink:0, paddingLeft:12 } },
          R.createElement('span', { style:{ fontSize:16, fontWeight:650, color:'var(--text-main)', lineHeight:1.1, letterSpacing:-0.5 } }, weather.temp, '\u00B0'),
          R.createElement('span', { style:{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.2 } }, (weather.city || '') + (weather.condition ? ' ' + weather.condition : '')))));
  }

  w.SwipeRow = SwipeRow;
})(window);
