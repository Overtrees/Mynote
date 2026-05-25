(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef, useCallback = R.useCallback;

  function ImageCard(_ref) {
    var memo = _ref.memo, onOpen = _ref.onOpen, onPin = _ref.onPin, onDelete = _ref.onDelete, expandText = _ref.expandText, onExpand = _ref.onExpand;
    var isNewCard = memo.id === (w.CikeConstants ? w.CikeConstants.NEW_CARD_ID : '__new_memo_card__');
    var _useState = useState(null), thumb = _useState[0], setThumb = _useState[1];

    useEffect(function () {
      if (isNewCard) { setThumb(null); return; }
      setThumb(null);
      var firstAtt = memo.doc && memo.doc.find(function(n){return n.type === 'attachment';});
      if (!firstAtt) return;
      var cancelled = false;
      (async function() {
        try {
          var db = await (w.CikeIdb ? w.CikeIdb.getDB() : null);
          if (!db) return;
          for (var attempt = 0; attempt < 5 && !cancelled; attempt++) {
            var stored = await (w.CikeIdb ? w.CikeIdb.loadAttachmentFromDB(db, firstAtt.fileId).catch(function(){return null;}) : null);
            if (!stored) break;
            if (stored.type && stored.type.indexOf('image/') === 0 && (stored.url || stored.thumb)) { if (!cancelled) setThumb(stored.url || stored.thumb); return; }
            await new Promise(function(r){setTimeout(r,300);});
          }
        } catch(e) {}
      })();
      return function(){ cancelled = true; };
    }, [memo.id, memo.doc, isNewCard]);

    var preview = '\u65E0\u66F4\u591A\u6587\u672C', tags = [];
    if (memo.doc) {
      var paras = [];
      for (var ni = 0; ni < memo.doc.length; ni++) {
        var n = memo.doc[ni];
        if (n.type === 'paragraph' && n.children && n.children[0] && n.children[0].text) {
          var t = n.children[0].text.trim();
          if (t) { paras.push(t); var mt = t.match(/#[\u4e00-\u9fa5\w-]+/g); if (mt) for (var ti=0; ti<mt.length; ti++) { if (tags.indexOf(mt[ti])===-1) tags.push(mt[ti]); } }
        }
      }
      if (paras.length > 0) {
        tags = tags.slice(0, 3);
        var s = (typeof w.stripMarkdownForPreview === 'function' ? w.stripMarkdownForPreview(paras.join(' ')) : paras.join(' ')).replace(/#[\u4e00-\u9fa5\w-]+/g, '').trim().slice(0, 60);
        preview = s || (tags.length > 0 ? tags[0].replace(/^#/, '') : '\u65E0\u66F4\u591A\u6587\u672C');
      }
    }

    // Swipe gesture (via shared hook)
    var sw = w.CikeHooks.useSwipeGesture({ isNewCard: isNewCard });

    return R.createElement('div', { className:'swipe-wrapper', ref:sw.wrapperRef },
      !isNewCard && R.createElement('div', { className:'swipe-actions' },
        R.createElement('button', { ref:sw.btn1Ref, className:'swipe-action-btn', style:{ background:'#4A90D9', transform:'translateX(60px)', opacity:0 }, onClick:function(e){e.stopPropagation();sw.snapClose();onPin(memo.id);} },
          typeof w.SvgIcon === 'function' ? w.SvgIcon('pinMulti', {width:17,height:17,strokeWidth:2.2,stroke:'#fff'}) : null,
          memo.pinned ? '\u53D6\u6D88' : '\u7F6E\u9876'),
        R.createElement('button', { ref:sw.btn2Ref, className:'swipe-action-btn', style:{ background:'#E0433A', transform:'translateX(30px)', opacity:0 }, onClick:function(e){e.stopPropagation();sw.snapClose();onDelete(memo.id);} },
          typeof w.SvgIcon === 'function' ? w.SvgIcon('delMulti', {width:17,height:17,strokeWidth:2.2,stroke:'#fff'}) : null,
          '\u5220\u9664')),
      R.createElement('div', { ref:sw.rowRef, className:'img-card', onClick:function(){ if (!isNewCard && !sw.gesture.current.opened) onOpen(memo); }, style:{ borderBottom:'none' } },
        thumb ? R.createElement('img', { className:'img-cover', src:thumb, alt:'', style:{ pointerEvents:'none' } }) : R.createElement('div', { className:'img-cover-fb' }, '\uD83D\uDCF7'),
        R.createElement('div', { className:'img-body' },
          R.createElement('div', { className:'img-text' },
            R.createElement('div', { className:'t', style:{ display:'flex', alignItems:'center', gap:6, width:'100%' } },
              R.createElement('span', { style:{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' } }, memo.title || '\u65E0\u6807\u9898'),
              !isNewCard && tags.length > 0 && R.createElement('div', { style:{ display:'flex', gap:4, flexWrap:'wrap', overflow:'hidden', justifyContent:'flex-end', flex:1, minWidth:0 } },
                tags.map(function(t){ return R.createElement('span', { key:t, style:{ fontSize:10, color:'#007aff', background:'var(--glass-bg)', backdropFilter:'blur(40px) saturate(2.5) brightness(1.15)', WebkitBackdropFilter:'blur(40px) saturate(2.5) brightness(1.15)', padding:'0 5px', borderRadius:999, lineHeight:'18px', whiteSpace:'nowrap', border:'0.5px solid var(--glass-border)' } }, t); }))),
            R.createElement('div', { className:'m', style:{ display:'flex', alignItems:'center', gap:6 } },
              R.createElement('span', null, typeof w.timeAgo === 'function' ? w.timeAgo(memo.updatedAt) : memo.updatedAt),
              R.createElement('span', { style:{ color:'var(--text-secondary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 } }, '\u00B7 ' + preview),
              expandText && R.createElement('span', { className:'expand-btn', onClick:function(e){e.stopPropagation();onExpand&&onExpand();} }, expandText))))));
  }

  w.ImageCard = ImageCard;
})(window);
