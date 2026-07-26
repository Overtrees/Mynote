(function (w) {
  'use strict';
  var ESC = '__cikeEditorDocRef__';

  function setEditorDocRef(doc) { w[ESC] = doc; }
  function getEditorDocRef() { return w[ESC] || null; }

  function escapeHTML(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderDocToEditorHTML(doc, files) {
    function esc(t) { var s = t || ''; return s ? escapeHTML(s) : '<br>'; }
    return doc.map(function (node) {
      var text, level, checked;
      switch (node.type) {
        case 'paragraph':
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          return '<p data-blockid="' + node.id + '">' + text + '</p>';
        case 'heading':
          level = node.attrs && node.attrs.level || 2;
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          return '<h' + level + ' data-blockid="' + node.id + '">' + text + '</h' + level + '>';
        case 'quote':
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          return '<blockquote data-blockid="' + node.id + '"><div>' + text + '</div></blockquote>';
        case 'todo':
          checked = node.attrs && node.attrs.checked || false;
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          var chk = checked
            ? '<img src="data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'22\' height=\'22\' viewBox=\'0 0 22 22\'%3E%3Ccircle cx=\'11\' cy=\'11\' r=\'11\' fill=\'%23007AFF\'/%3E%3Cpath d=\'M7 11l3 3 5-5\' stroke=\'white\' stroke-width=\'2.2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E" width="18" height="18" alt="">'
            : '<img src="data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'22\' height=\'22\' viewBox=\'0 0 22 22\'%3E%3Ccircle cx=\'11\' cy=\'11\' r=\'9.5\' fill=\'none\' stroke=\'%23C7C7CC\' stroke-width=\'1.8\'/%3E%3C/svg%3E" width="18" height="18" alt="">';
          return '<div data-blockid="' + node.id + '" data-type="todo" style="display:flex;align-items:center;gap:6px;margin:0.2em 0;padding:4px 12px;background:var(--glass-bg);backdrop-filter:blur(40px) saturate(2.5) brightness(1.15);-webkit-backdrop-filter:blur(40px) saturate(2.5) brightness(1.15);border:0.5px solid var(--glass-border);border-radius:999px"><span class="todo-checkbox" contenteditable="false" data-checked="' + (checked ? 'true' : 'false') + '">' + chk + '</span><span>' + text + '</span></div>';
        case 'attachment':
        case 'link-card':
        case 'musicCard':
          return renderAtomicHTML ? renderAtomicHTML(node, files) : '';
        case 'imgTextCard':
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          var imgFid = node.attrs && node.attrs.fileId;
          var imgSrc = imgFid && files && files[imgFid] && files[imgFid].url || '';
          var imgHtml = imgSrc ? '<img src="' + escapeHTML(imgSrc) + '" style="width:100%;max-height:468px;object-fit:cover;display:block;">' : '<div style="height:160px;background:rgba(0,0,0,0.03);display:flex;align-items:center;justify-content:center;color:#c7c7cc;font-size:13px;">\uD83D\uDCF7 \u70B9\u51FB\u6DFB\u52A0\u56FE\u7247</div>';
          return '<div class="img-text-card" data-blockid="' + node.id + '" data-type="imgTextCard" contenteditable="false"><div class="itc-img-wrap">' + imgHtml + '</div><div class="itc-text" contenteditable="true">' + text + '</div></div>';
        case 'imageTextRow':
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          var rFid = node.attrs && node.attrs.fileId;
          var rImg = rFid && files && files[rFid] && files[rFid].url || '';
          var rHtml = rImg ? '<img src="' + escapeHTML(rImg) + '" style="width:100%;height:100%;object-fit:cover;display:block">' : '<div class="itr-placeholder">\uD83D\uDCF7</div>';
          return '<div class="img-text-row" data-blockid="' + node.id + '" data-type="imageTextRow" contenteditable="false"><div class="itr-img">' + rHtml + '</div><div class="itr-text" contenteditable="true">' + text + '</div></div>';
        case 'gallery':
          var gItems = node.attrs && node.attrs.items || [];
          var gHtml = gItems.length > 0
            ? '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;border-radius:12px;corner-shape:squircle;">' + gItems.map(function(s) {
                var u = s && s.fileId && files && files[s.fileId] && files[s.fileId].url || s && s.url || s;
                return '<img src="' + escapeHTML(u) + '" style="width:100%;height:366px;object-fit:cover;border-radius:22px;corner-shape:squircle;">';
              }).join('') + '</div>'
            : '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;padding:6px 0 14px;"><div style="height:366px;background:rgba(0,0,0,0.03);border-radius:22px;corner-shape:squircle;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#c7c7cc;"><span style="font-size:18px;opacity:0.4;">\uD83D\uDDBC</span><span style="font-size:11px;margin-top:4px;opacity:0.5;">\u70B9\u51FB\u6DFB\u52A0</span></div><div style="height:366px;background:rgba(0,0,0,0.02);border-radius:22px;corner-shape:squircle;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#c7c7cc;"><span style="font-size:18px;opacity:0.3;">\uD83D\uDDBC</span><span style="font-size:11px;margin-top:4px;opacity:0.4;">\u591A\u5F20\u56FE\u7247</span></div></div>';
          return '<div class="atomic" data-blockid="' + node.id + '" data-type="gallery" contenteditable="false">' + gHtml + '</div>';
        case 'image':
          var iFid = node.attrs && node.attrs.fileId;
          var iSrc = iFid && files && files[iFid] && files[iFid].url || '';
          var iHtml = iSrc ? '<img src="' + escapeHTML(iSrc) + '" style="max-width:100%;max-height:668px;border-radius:22px;corner-shape:squircle;display:block;margin:8px auto;object-fit:contain;">' : '<div style="height:566px;border-radius:22px;corner-shape:squircle;background:var(--card-bg);border:0.5px solid var(--border-color);display:flex;align-items:center;justify-content:center;color:#c7c7cc;font-size:13px;margin:8px 0;">\uD83D\uDCF7 \u70B9\u51FB\u6DFB\u52A0\u56FE\u7247</div>';
          return '<div class="atomic" data-blockid="' + node.id + '" data-type="image" contenteditable="false">' + iHtml + '</div>';
        case 'divider':
          return '<hr data-blockid="' + node.id + '">';
        case 'embedCard':
        default:
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          return '<p data-blockid="' + node.id + '">' + text + '</p>';
      }
    }).join('\n');
  }

  function parseEditorDOM(containerEl) {
    var doc = [];
    var prevDoc = getEditorDocRef() || [];
    var prevMap = {};
    for (var i = 0; i < prevDoc.length; i++) prevMap[prevDoc[i].id] = prevDoc[i];
    var children = containerEl.children;
    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      if (el.nodeType !== 1) {
        var txt = (el.textContent || '').trim();
        if (txt) doc.push({ id: (w.CikeId && w.CikeId.genId ? w.CikeId.genId() : Math.random().toString(36).slice(2,10)), type:'paragraph', children:[{text:txt}] });
        continue;
      }
      var id = el.dataset.blockid || '';
      var type = el.dataset.type || (el.tagName === 'H1'||el.tagName==='H2'||el.tagName==='H3' ? 'heading' : el.tagName === 'H4'||el.tagName==='H5'||el.tagName==='H6' ? 'heading' : null) || 'paragraph';
      var prev = prevMap[id] || null;
      // 原子块与不可编辑块：保留 prev
      var atomicTypes = ['gallery','imgTextCard','imageTextRow'];
      if (atomicTypes.indexOf(type) >= 0) { doc.push(prev || { id:id, type:type }); continue; }
      if (el.contentEditable === 'false') {
        // 块级渲染优先用 data-mdtext 保存原始 md 源码，防止 prev 为 null 时丢文本
        if (el.dataset.mdtext) {
          doc.push(prev || { id:id, type:'paragraph', children:[{text:el.dataset.mdtext}] });
        } else {
          doc.push(prev || { id:id, type:type });
        }
        continue;
      }
      if (type === 'link-card' || type === 'embedCard' || type === 'musicCard') {
        if (type === 'musicCard' && el.dataset.musicUrl === 'pending') {
          doc.push(prev || { id:id, type:type, url:'', meta:null, status:'input' });
          continue;
        }
        doc.push(prev || { id:id, type:type, url:el.dataset.url||'', meta:null, status:'empty' });
        continue;
      }
      if (type === 'attachment' || type === 'image') { 
        var _fid = el.dataset.fileid || '';
        var _isImg = type === 'image' || (type === 'attachment' && el.querySelector('img'));
        doc.push(prev || { id:id, type:type, fileId:_fid, image:_isImg }); 
        continue; 
      }
      // 增量优化：对段落/标题/todo 检测文本是否变化
      if (type === 'heading') {
        var rawH = el.textContent || '';
        if (prev && prev.type === 'heading' && prev.children && prev.children[0] && prev.children[0].text === rawH) { doc.push(prev); continue; }
        var level = parseInt(el.dataset.level,10) || 2;
        doc.push({ id:id, type:type, attrs:{level:level}, children:[{text:rawH}] });
        continue;
      }
      if (type === 'todo') {
        var cb = el.querySelector('.todo-checkbox'), checked = cb ? cb.dataset.checked === 'true' : false;
        var rawTodo = el.textContent || '';
        if (prev && prev.type === 'todo' && prev.children && prev.children[0] && prev.children[0].text === rawTodo && prev.attrs && prev.attrs.checked === checked) { doc.push(prev); continue; }
        doc.push({ id:id, type:type, attrs:{checked:checked}, children:[{text:rawTodo}] });
        continue;
      }
      if (type === 'divider') { doc.push(prev || { id:id, type:type }); continue; }
      // data-mdtext 优先（渲染块如表格/代码块/Callout/内联渲染）：保存原始 markdown 文本
      if (el.dataset.mdtext) { doc.push(prev || { id:id, type:'paragraph', children:[{text:el.dataset.mdtext}] }); continue; }
      // 不可编辑块：优先 data-mdtext，其次 prev
      if (el.contentEditable === 'false') {
        if (el.dataset.mdtext) {
          doc.push(prev || { id:id, type:'paragraph', children:[{text:el.dataset.mdtext}] });
        } else {
          doc.push(prev || { id:id, type:type });
        }
        continue;
      }
      var rawText = el.textContent || '';
      if (rawText === '\u200B' || rawText === '') rawText = '';
      if (['P','BLOCKQUOTE','DIV'].indexOf(el.tagName) >= 0) {
        if (prev && prev.type === 'paragraph' && prev.children && prev.children[0]) {
          if (prev.children[0].text === rawText) { doc.push(prev); continue; }
        }
        doc.push({ id:id, type:'paragraph', children:[{text:rawText}] });
      } else {
        if (prev && prev.type === 'paragraph' && prev.children && prev.children[0] && prev.children[0].text === rawText) { doc.push(prev); continue; }
        doc.push({ id:id, type:'paragraph', children:[{text:rawText}] });
      }
    }
    // 兜底：如果解析结果为空但容器有文本，至少保留一个段落
    if (doc.length === 0) {
      var rootText = (containerEl.textContent || '').replace(/\u200B/g, '').trim();
      if (rootText) {
        doc.push({ id: (w.CikeId && w.CikeId.genId ? w.CikeId.genId() : Math.random().toString(36).slice(2,10)), type:'paragraph', children:[{text:rootText}] });
      }
    }
    // 兜底：doc 不能为空，否则保存会把 memo 写空
    if (doc.length === 0) {
      doc.push({ id: (w.CikeId && w.CikeId.genId ? w.CikeId.genId() : Math.random().toString(36).slice(2,10)), type:'paragraph', children:[{text:''}] });
    }
    return doc;
  }

  function renderAtomicHTML(node, files) {
    if (node.type === 'attachment') {
      var f = files && files[node.fileId];
      if (f && f.type && f.type.startsWith('image/') && f.url) {
        return '<div contenteditable="false" class="atomic attachment" data-blockid="' + node.id + '" data-fileid="' + node.fileId + '"><img src="' + f.url + '" alt="' + w.CikeEditor.escapeHTML(f.name || '') + '" style="max-width:100%;border-radius:32px;corner-shape:squircle;display:block"></div>';
      }
      return '<div contenteditable="false" class="atomic attachment" data-blockid="' + node.id + '" data-fileid="' + node.fileId + '"><div class="attachment-file"><span class="att-icon">\uD83D\uDCCE</span><span class="att-name">' + w.CikeEditor.escapeHTML(f ? f.name : '\u9644\u4EF6') + '</span><span class="att-hint">\u70B9\u51FB\u6253\u5F00</span></div></div>';
    }
    if (node.type === 'link-card') {
      var url = node.url || '', meta = node.meta;
      if (!meta || !meta.title) {
        var domain = '';
        try { domain = new URL(url).hostname.replace('www.', ''); } catch (e) {}
        return '<div contenteditable="false" class="atomic link-card-err" data-blockid="' + node.id + '" data-url="' + w.CikeEditor.escapeHTML(url) + '"><div class="lkc-body"><div class="lkc-title">' + w.CikeEditor.escapeHTML(domain || url) + '</div><div class="lkc-source"><span class="lkc-source-icon">\uD83D\uDD17</span><span class="lkc-source-dot"></span><span class="lkc-source-text">' + w.CikeEditor.escapeHTML(url) + '</span></div></div></div>';
      }
      var icon = typeof w.getTypeIcon === 'function' ? w.getTypeIcon(meta.type) : '\uD83D\uDD17';
      var coverUrl = typeof w.proxyImg === 'function' ? w.proxyImg(meta.cover) : meta.cover;
      var coverHTML = coverUrl ? '<div class="lkc-cover"><img src="' + coverUrl + '" alt="" onerror="this.parentNode.style.display=\'none\'"></div>' : '';
      var srcDomain = '';
      try { srcDomain = new URL(url).hostname.replace('www.', ''); } catch (e) {}
      var isBilibili = meta && (meta.source === '\u54D4\u54E9\u54D4\u54E9' || meta.type === 'video' && (url.indexOf('bilibili') >= 0 || url.indexOf('b23.tv') >= 0));
      return '<div contenteditable="false" class="atomic link-card-block" data-blockid="' + node.id + '" data-url="' + w.CikeEditor.escapeHTML(url) + '">' + coverHTML + '<div class="lkc-body' + (coverHTML ? ' has-cover' : '') + '"><div class="lkc-title">' + w.CikeEditor.escapeHTML(meta.title) + '</div>' + (!isBilibili && meta.subtitle ? '<div class="lkc-subtitle">' + w.CikeEditor.escapeHTML(meta.subtitle) + '</div>' : '') + '<div class="lkc-source"><span class="lkc-source-icon">' + icon + '</span><span class="lkc-source-dot"></span><span class="lkc-source-text">' + w.CikeEditor.escapeHTML(meta.source || srcDomain || '') + '</span></div></div></div>';
    }
    if (node.type === 'musicCard') {
      var muUrl = node.url || '', muMeta = node.meta, muStatus = node.status || 'empty';
      if (muStatus === 'input') {
        return '<div contenteditable="true" data-blockid="' + node.id + '" data-type="musicCard" data-music-url="pending" style="padding:12px 18px;border-radius:999px;background:var(--glass-bg);backdrop-filter:blur(40px) saturate(2.5) brightness(1.15);-webkit-backdrop-filter:blur(40px) saturate(2.5) brightness(1.15);border:0.5px solid var(--glass-border);font-size:14px;color:var(--text-secondary);display:flex;align-items:center;gap:10px;outline:none;">粘贴音乐链接到这里...</div>';
      }
      if (muUrl && muMeta && muMeta.title) {
        var muCover = muMeta.cover ? (typeof w.proxyImg === 'function' ? w.proxyImg(muMeta.cover) : muMeta.cover) : '';
        var muTitle = muMeta.title || '\u97F3\u4E50';
        var muHtml2 = '<div contenteditable="false" class="link-card-block" data-blockid="' + node.id + '" data-type="musicCard" data-url="' + w.CikeEditor.escapeHTML(muUrl) + '">';
        if (muCover) muHtml2 += '<div class="lkc-cover"><img src="' + muCover + '" alt="" onerror="this.closest(\'.lkc-cover\').style.display=\'none\'"></div>';
        muHtml2 += '<div class="lkc-body' + (muCover ? ' has-cover' : '') + '"><div class="lkc-title">' + w.CikeEditor.escapeHTML(muTitle) + '</div>';
        if (muMeta.subtitle) muHtml2 += '<div class="lkc-subtitle">' + w.CikeEditor.escapeHTML(muMeta.subtitle) + '</div>';
        muHtml2 += '<div class="lkc-source"><span class="lkc-source-icon">\uD83C\uDFB5</span><span class="lkc-source-dot"></span><span class="lkc-source-text">' + w.CikeEditor.escapeHTML(muMeta.source || '\u97F3\u4E50') + '</span></div></div></div>';
        return muHtml2;
      }
      if (muStatus === 'loading' && muUrl) {
        return '<div contenteditable="false" data-blockid="' + node.id + '" data-type="musicCard" data-url="' + w.CikeEditor.escapeHTML(muUrl) + '" class="link-card-skeleton"><div class="link-card-skeleton-cover"></div><div class="link-card-skeleton-body"><div class="link-card-skeleton-line" style="width:75%;"></div><div class="link-card-skeleton-line" style="width:50%;"></div></div></div>';
      }
      return '<div contenteditable="false" data-blockid="' + node.id + '" data-type="musicCard" style="padding:12px 16px;border-radius:999px;background:var(--glass-bg);backdrop-filter:blur(40px) saturate(2.5) brightness(1.15);-webkit-backdrop-filter:blur(40px) saturate(2.5) brightness(1.15);border:0.5px solid var(--glass-border);font-size:14px;color:var(--text-secondary);display:flex;align-items:center;gap:10px;"><span>\uD83C\uDFB5</span><span>' + w.CikeEditor.escapeHTML(node.url || '\u70B9\u51FB\u7C98\u8D34\u97F3\u4E50\u94FE\u63A5') + '</span></div>';
    }
    return '';
  }

  w.CikeEditor = {
    setEditorDocRef: setEditorDocRef,
    getEditorDocRef: getEditorDocRef,
    escapeHTML: escapeHTML,
    renderDocToEditorHTML: renderDocToEditorHTML,
    renderAtomicHTML: renderAtomicHTML,
    parseEditorDOM: parseEditorDOM,
    __core_inline: true
  };
})(window);
