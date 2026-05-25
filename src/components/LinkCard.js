(function (w) {
  'use strict';
  var R = w.React;

  function LinkCard(_ref) {
    var node = _ref.node;
    var url = node.url, meta = node.meta, status = node.status;
    var isBilibili = meta && (meta.source === '\u54D4\u54E9\u54D4\u54E9' || meta.type === 'video' && (url.indexOf('bilibili') >= 0 || url.indexOf('b23.tv') >= 0));

    var handleCardClick = function (e) {
      var rect = e.currentTarget.getBoundingClientRect();
      var x = e.clientX - rect.left;
      if (x < 24 || x > rect.width - 24) { e.preventDefault(); e.stopPropagation(); return; }
      e.preventDefault(); e.stopPropagation();
      window.location.assign(url);
    };

    if (status === 'loading') {
      return R.createElement('div', { className:'link-card-skeleton', contentEditable:false },
        R.createElement('div', { className:'link-card-skeleton-cover' }),
        R.createElement('div', { className:'link-card-skeleton-body' },
          R.createElement('div', { className:'link-card-skeleton-line', style:{ width:'75%' } }),
          R.createElement('div', { className:'link-card-skeleton-line', style:{ width:'50%' } })));
    }

    if (status === 'error' || !meta || !meta.title) {
      var domain = url || '';
      try { domain = new URL(url).hostname.replace('www.', ''); } catch (e) {}
      return R.createElement('div', { className:'link-card-error', role:'link', tabIndex:0, 'data-href':url, contentEditable:false, onClick:handleCardClick },
        R.createElement('span', { className:'link-card-type-icon' }, '\uD83D\uDD17'),
        R.createElement('div', { style:{ flex:1, minWidth:0 } },
          R.createElement('div', { className:'link-card-title', style:{ WebkitLineClamp:1 } }, domain),
          R.createElement('div', { className:'link-card-subtitle', style:{ WebkitLineClamp:1, marginTop:2 } }, url)));
    }

    var coverUrl = (typeof w.proxyImg === 'function' ? w.proxyImg(meta.cover) : meta.cover) || meta.cover;
    var icon = (typeof w.getTypeIcon === 'function' ? w.getTypeIcon(meta.type) : '\uD83D\uDD17');
    var sourceDomain = url || '';
    try { sourceDomain = new URL(url).hostname.replace('www.', ''); } catch (e) {}
    var hasCover = Boolean(coverUrl || meta.cover);
    var _isBilibili = isBilibili;

    return R.createElement('div', { className:'link-card', role:'link', tabIndex:0, 'data-href':url, contentEditable:false, onClick:handleCardClick },
      R.createElement('div', { className:'link-card-cover-wrap' + (hasCover ? ' has-cover' : ' no-cover') },
        hasCover && R.createElement('img', { src:coverUrl || meta.cover, alt:'', onError:function(e){ e.target.parentNode.className = 'link-card-cover-wrap no-cover'; } })),
      R.createElement('div', { className:'link-card-body' + (hasCover ? ' has-cover' : '') },
        R.createElement('div', { className:'link-card-title' }, meta.title),
        !_isBilibili && meta.subtitle && R.createElement('div', { className:'link-card-subtitle' }, meta.subtitle),
        R.createElement('div', { className:'link-card-source' },
          R.createElement('span', null, icon),
          R.createElement('span', { className:'link-card-source-dot' }),
          R.createElement('span', null, meta.source || sourceDomain))));
  }

  w.LinkCard = LinkCard;
})(window);
