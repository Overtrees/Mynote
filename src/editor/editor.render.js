(function (w) {
  'use strict';
  var ESC = '__cikeEditorDocRef__';

  function setEditorDocRef(doc) { w[ESC] = doc; }
  function getEditorDocRef() { return w[ESC] || null; }

  function escapeHTML(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function safeImageUrl(value) {
    var url = String(value || '').trim();
    if (/^https?:\/\//i.test(url) || /^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$/i.test(url)) return escapeHTML(url);
    return '';
  }
  function safeHttpUrl(value) {
    var url = String(value || '').trim();
    return /^https?:\/\//i.test(url) ? escapeHTML(url) : '';
  }

  function sanitizeRenderedHTML(html) {
    var purifier = w.DOMPurify;
    if (purifier && typeof purifier.sanitize === 'function') {
      return purifier.sanitize(String(html || ''), { ADD_TAGS: ['input'], ADD_ATTR: ['checked', 'type', 'target', 'rel'] });
    }
    // Sanitizer must fail closed. The editor displays the escaped source rather than executing markup.
    return escapeHTML(html || '');
  }

  function renderDocToEditorHTML(doc, files) {
    if (!Array.isArray(doc)) return '';
    function esc(t) { var s = t || ''; return s ? escapeHTML(s) : '<br>'; }
    var html = doc.map(function (node) {
      var text, level, checked;
      switch (node.type) {
        case 'paragraph':
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          return '<p data-blockid="' + escapeHTML(node.id) + '">' + text + '</p>';
        case 'heading':
          level = node.attrs && node.attrs.level || 2;
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          return '<h' + level + ' data-blockid="' + escapeHTML(node.id) + '">' + text + '</h' + level + '>';
        case 'quote':
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          return '<blockquote data-blockid="' + escapeHTML(node.id) + '"><div>' + text + '</div></blockquote>';
        case 'todo':
          checked = node.attrs && node.attrs.checked || false;
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          return '<div data-blockid="' + escapeHTML(node.id) + '" data-type="todo" class="editor-todo' + (checked ? ' is-checked' : '') + '"><input class="todo-checkbox" type="checkbox" contenteditable="false" aria-checked="' + (checked ? 'true' : 'false') + '" aria-label="' + text + '" data-checked="' + (checked ? 'true' : 'false') + '"' + (checked ? ' checked' : '') + '><span class="todo-text">' + text + '</span></div>';
        case 'attachment':
        case 'link-card':
        case 'musicCard':
          return renderAtomicHTML ? renderAtomicHTML(node, files) : '';
        case 'imgTextCard':
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          var imgFid = node.attrs && node.attrs.fileId;
          var imgSrc = imgFid && files && files[imgFid] && files[imgFid].url || '';
          var imgHtml = imgSrc ? '<img src="' + safeImageUrl(imgSrc) + '" style="width:100%;max-height:468px;object-fit:cover;display:block;">' : '<div style="height:160px;background:var(--fill-subtle);display:flex;align-items:center;justify-content:center;color:var(--color-placeholder);font-size:var(--font-13);">\uD83D\uDCF7 \u70B9\u51FB\u6DFB\u52A0\u56FE\u7247</div>';
          return '<div class="img-text-card" data-blockid="' + escapeHTML(node.id) + '" data-type="imgTextCard" contenteditable="false"><div class="itc-img-wrap">' + imgHtml + '</div><div class="itc-text" contenteditable="true">' + text + '</div></div>';
        case 'imageTextRow':
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          var rFid = node.attrs && node.attrs.fileId;
          var rImg = rFid && files && files[rFid] && files[rFid].url || '';
          var rHtml = rImg ? '<img src="' + safeImageUrl(rImg) + '" style="width:100%;height:100%;object-fit:cover;display:block">' : '<div class="itr-placeholder">\uD83D\uDCF7</div>';
          return '<div class="img-text-row" data-blockid="' + escapeHTML(node.id) + '" data-type="imageTextRow" contenteditable="false"><div class="itr-img">' + rHtml + '</div><div class="itr-text" contenteditable="true">' + text + '</div></div>';
        case 'gallery':
          var gItems = node.attrs && node.attrs.items || [];
          var gHtml = gItems.length > 0
            ? '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;border-radius:var(--radius-12);corner-shape:squircle;">' + gItems.map(function(s) {
                var u = s && s.fileId && files && files[s.fileId] && files[s.fileId].url || s && s.url || s;
                return '<img src="' + safeImageUrl(u) + '" style="width:100%;height:366px;object-fit:cover;border-radius:var(--radius-22);corner-shape:squircle;">';
              }).join('') + '</div>'
            : '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;padding:6px 0 14px;"><div style="height:366px;background:var(--fill-subtle);border-radius:var(--radius-22);corner-shape:squircle;display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--color-placeholder);"><span style="font-size:var(--font-18);opacity:0.4;">\uD83D\uDDBC</span><span style="font-size:var(--font-11);margin-top:4px;opacity:0.5;">\u70B9\u51FB\u6DFB\u52A0</span></div><div style="height:366px;background:var(--fill-subtle-2);border-radius:var(--radius-22);corner-shape:squircle;display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--color-placeholder);"><span style="font-size:var(--font-18);opacity:0.3;">\uD83D\uDDBC</span><span style="font-size:var(--font-11);margin-top:4px;opacity:0.4;">\u591A\u5F20\u56FE\u7247</span></div></div>';
          return '<div class="atomic" data-blockid="' + escapeHTML(node.id) + '" data-type="gallery" contenteditable="false">' + gHtml + '</div>';
        case 'image':
          var iFid = node.attrs && node.attrs.fileId;
          var iSrc = iFid && files && files[iFid] && files[iFid].url || '';
          var iHtml = iSrc ? '<img src="' + safeImageUrl(iSrc) + '" style="max-width:100%;max-height:668px;border-radius:var(--radius-22);corner-shape:squircle;display:block;margin:8px auto;object-fit:contain;">' : '<div style="height:566px;border-radius:var(--radius-22);corner-shape:squircle;background:var(--card-bg);border:0.5px solid var(--border-color);display:flex;align-items:center;justify-content:center;color:var(--color-placeholder);font-size:var(--font-13);margin:8px 0;">\uD83D\uDCF7 \u70B9\u51FB\u6DFB\u52A0\u56FE\u7247</div>';
          return '<div class="atomic" data-blockid="' + escapeHTML(node.id) + '" data-type="image" contenteditable="false">' + iHtml + '</div>';
        case 'divider':
          return '<hr data-blockid="' + escapeHTML(node.id) + '">';
        case 'embedCard':
        default:
          text = esc(node.children && node.children[0] ? node.children[0].text : '');
          return '<p data-blockid="' + escapeHTML(node.id) + '">' + text + '</p>';
      }
    }).join('\n');
    return sanitizeRenderedHTML(html);
  }

  function parseEditorDOM(containerEl) {
    var doc = [];
    var prevDoc = getEditorDocRef() || [];
    var prevMap = {};
    for (var i = 0; i < prevDoc.length; i++) prevMap[prevDoc[i].id] = prevDoc[i];
    var children = containerEl.children;
    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      // children 是元素集合，nodeType 恒为 1（原先的文本节点分支不可达，已删除）
      var id = el.dataset.blockid || '';
      var type = el.dataset.type || (/^H[1-6]$/.test(el.tagName) ? 'heading' : el.tagName === 'BLOCKQUOTE' ? 'quote' : el.tagName === 'HR' ? 'divider' : null) || 'paragraph';
      var prev = prevMap[id] || null;
      // 原子块与不可编辑块：图片说明可编辑，解析时保留媒体属性并同步说明文字。
      var atomicTypes = ['gallery','imgTextCard','imageTextRow'];
      if (atomicTypes.indexOf(type) >= 0) {
        if (type === 'imgTextCard' || type === 'imageTextRow') {
          var captionEl = el.querySelector(type === 'imgTextCard' ? '.itc-text' : '.itr-text');
          if (captionEl) {
            var captionText = captionEl.textContent || '';
            if (prev) {
              var oldChildren = prev.children || [];
              var oldCaption = oldChildren[0] && oldChildren[0].text || '';
              if (captionText !== oldCaption) {
                var updated = Object.assign({}, prev);
                updated.children = oldChildren.length
                  ? oldChildren.map(function(child, childIndex) {
                      return childIndex === 0 ? Object.assign({}, child, { text: captionText }) : child;
                    })
                  : [{ text: captionText }];
                doc.push(updated);
                continue;
              }
            } else if (captionText) {
              // 首次解析（prev 为 null）也要把说明文字带回去，否则插入后立刻保存会丢 caption
              doc.push({ id:id, type:type, children:[{ text: captionText }] });
              continue;
            }
          }
        }
        doc.push(prev || { id:id, type:type });
        continue;
      }
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
        var level = parseInt(el.dataset.level,10) || (/^H[1-6]$/.test(el.tagName) ? parseInt(el.tagName.slice(1),10) : 2);
        doc.push({ id:id, type:type, attrs:{level:level}, children:[{text:rawH}] });
        continue;
      }
      if (type === 'quote') {
        var rawQuote = el.textContent || '';
        if (rawQuote === '\u200B') rawQuote = '';
        if (prev && prev.type === 'quote' && prev.children && prev.children[0] && prev.children[0].text === rawQuote) { doc.push(prev); continue; }
        doc.push({ id:id, type:'quote', children:[{text:rawQuote}] });
        continue;
      }
      if (type === 'todo') {
        var cb = el.querySelector('.todo-checkbox'), checked = cb ? cb.checked : false;
        var rawTodo = el.textContent || '';
        if (prev && prev.type === 'todo' && prev.children && prev.children[0] && prev.children[0].text === rawTodo && prev.attrs && prev.attrs.checked === checked) { doc.push(prev); continue; }
        doc.push({ id:id, type:type, attrs:{checked:checked}, children:[{text:rawTodo}] });
        continue;
      }
      if (type === 'divider') { doc.push(prev && prev.type === 'divider' ? prev : { id:id, type:'divider' }); continue; }
      // data-mdtext 优先（渲染块如表格/代码块/Callout/内联渲染）：保存原始 markdown 文本
      if (el.dataset.mdtext) { doc.push(prev || { id:id, type:'paragraph', children:[{text:el.dataset.mdtext}] }); continue; }
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
        doc.push({ id: (w.MynoteId && w.MynoteId.genId ? w.MynoteId.genId() : Math.random().toString(36).slice(2,10)), type:'paragraph', children:[{text:rootText}] });
      }
    }
    // 兜底：doc 不能为空，否则保存会把 memo 写空
    if (doc.length === 0) {
      doc.push({ id: (w.MynoteId && w.MynoteId.genId ? w.MynoteId.genId() : Math.random().toString(36).slice(2,10)), type:'paragraph', children:[{text:''}] });
    }
    return doc;
  }

  function renderAtomicHTMLUnsafe(node, files) {
    if (node.type === 'attachment') {
      var f = files && files[node.fileId];
      if (f && f.type && f.type.startsWith('image/') && f.url) {
        return '<div contenteditable="false" class="atomic attachment" data-blockid="' + escapeHTML(node.id) + '" data-fileid="' + escapeHTML(node.fileId) + '"><img src="' + safeImageUrl(f.url) + '" alt="' + w.MynoteEditor.escapeHTML(f.name || '') + '" style="max-width:100%;border-radius:var(--radius-32);corner-shape:squircle;display:block"></div>';
      }
      return '<div contenteditable="false" class="atomic attachment" data-blockid="' + escapeHTML(node.id) + '" data-fileid="' + escapeHTML(node.fileId) + '"><div class="attachment-file"><span class="att-icon">\uD83D\uDCCE</span><span class="att-name">' + w.MynoteEditor.escapeHTML(f ? f.name : '\u9644\u4EF6') + '</span><span class="att-hint">\u70B9\u51FB\u6253\u5F00</span></div></div>';
    }
    if (node.type === 'link-card') {
      var url = node.url || '', meta = node.meta;
      if (!meta || !meta.title) {
        var domain = '';
        try { domain = new URL(url).hostname.replace('www.', ''); } catch (e) {}
        return '<div contenteditable="false" class="atomic link-card-err" data-blockid="' + escapeHTML(node.id) + '" data-url="' + safeHttpUrl(url) + '"><div class="lkc-body"><div class="lkc-title">' + w.MynoteEditor.escapeHTML(domain || url) + '</div><div class="lkc-source"><span class="lkc-source-icon">\uD83D\uDD17</span><span class="lkc-source-dot"></span><span class="lkc-source-text">' + w.MynoteEditor.escapeHTML(url) + '</span></div></div></div>';
      }
      var icon = typeof w.getTypeIcon === 'function' ? w.getTypeIcon(meta.type) : '\uD83D\uDD17';
      var coverUrl = typeof w.proxyImg === 'function' ? w.proxyImg(meta.cover) : meta.cover;
      var coverHTML = coverUrl ? '<div class="lkc-cover"><img src="' + safeImageUrl(coverUrl) + '" alt=""></div>' : '';
      var srcDomain = '';
      try { srcDomain = new URL(url).hostname.replace('www.', ''); } catch (e) {}
      var isBilibili = meta && (meta.source === '\u54D4\u54E9\u54D4\u54E9' || meta.type === 'video' && (url.indexOf('bilibili') >= 0 || url.indexOf('b23.tv') >= 0));
      return '<div contenteditable="false" class="atomic link-card-block" data-blockid="' + escapeHTML(node.id) + '" data-url="' + safeHttpUrl(url) + '">' + coverHTML + '<div class="lkc-body' + (coverHTML ? ' has-cover' : '') + '"><div class="lkc-title">' + w.MynoteEditor.escapeHTML(meta.title) + '</div>' + (!isBilibili && meta.subtitle ? '<div class="lkc-subtitle">' + w.MynoteEditor.escapeHTML(meta.subtitle) + '</div>' : '') + '<div class="lkc-source"><span class="lkc-source-icon">' + icon + '</span><span class="lkc-source-dot"></span><span class="lkc-source-text">' + w.MynoteEditor.escapeHTML(meta.source || srcDomain || '') + '</span></div></div></div>';
    }
    if (node.type === 'musicCard') {
      var muUrl = node.url || '', muMeta = node.meta, muStatus = node.status || 'empty';
      if (muStatus === 'input') {
        return '<div contenteditable="true" data-blockid="' + escapeHTML(node.id) + '" data-type="musicCard" data-music-url="pending" style="padding:12px 18px;border-radius:var(--radius-999);background:var(--glass-bg);backdrop-filter:var(--glass-filter);-webkit-backdrop-filter:var(--glass-filter);border:0.5px solid var(--glass-border);font-size:var(--font-14);color:var(--text-secondary);display:flex;align-items:center;gap:10px;outline:none;">粘贴音乐链接到这里...</div>';
      }
      if (muUrl && muMeta && muMeta.title) {
        var muCover = muMeta.cover ? (typeof w.proxyImg === 'function' ? w.proxyImg(muMeta.cover) : muMeta.cover) : '';
        var muTitle = muMeta.title || '\u97F3\u4E50';
        var muHtml2 = '<a contenteditable="false" class="link-card-block music-card-link" href="' + safeHttpUrl(muUrl) + '" target="_blank" rel="noopener noreferrer" aria-label="打开音乐链接" data-blockid="' + escapeHTML(node.id) + '" data-type="musicCard" data-url="' + safeHttpUrl(muUrl) + '">';
        if (muCover) muHtml2 += '<div class="lkc-cover"><img src="' + safeImageUrl(muCover) + '" alt=""></div>';
        muHtml2 += '<div class="lkc-body' + (muCover ? ' has-cover' : '') + '"><div class="lkc-title">' + w.MynoteEditor.escapeHTML(muTitle) + '</div>';
        if (muMeta.subtitle) muHtml2 += '<div class="lkc-subtitle">' + w.MynoteEditor.escapeHTML(muMeta.subtitle) + '</div>';
        muHtml2 += '<div class="lkc-source"><span class="lkc-source-icon">\uD83C\uDFB5</span><span class="lkc-source-dot"></span><span class="lkc-source-text">' + w.MynoteEditor.escapeHTML(muMeta.source || '\u97F3\u4E50') + '</span></div></div></a>';
        return muHtml2;
      }
      if (muStatus === 'loading' && muUrl) {
        return '<div contenteditable="false" data-blockid="' + escapeHTML(node.id) + '" data-type="musicCard" data-url="' + safeHttpUrl(muUrl) + '" class="link-card-skeleton"><div class="link-card-skeleton-cover"></div><div class="link-card-skeleton-body"><div class="link-card-skeleton-line" style="width:75%;"></div><div class="link-card-skeleton-line" style="width:50%;"></div></div></div>';
      }
      var fallbackTag = muUrl ? 'a' : 'div';
      var fallbackAttrs = muUrl ? ' href="' + safeHttpUrl(muUrl) + '" target="_blank" rel="noopener noreferrer"' : '';
      return '<' + fallbackTag + ' contenteditable="false"' + fallbackAttrs + (muUrl ? ' aria-label="打开音乐链接"' : '') + ' class="' + (muUrl ? 'link-card-block music-card-error music-card-link' : '') + '" data-blockid="' + escapeHTML(node.id) + '" data-type="musicCard"' + (muUrl ? ' data-url="' + safeHttpUrl(muUrl) + '"' : '') + ' style="padding:12px 16px;border-radius:var(--radius-999);background:var(--glass-bg);backdrop-filter:var(--glass-filter);-webkit-backdrop-filter:var(--glass-filter);border:0.5px solid var(--glass-border);font-size:var(--font-14);color:var(--text-secondary);display:flex;align-items:center;gap:10px;"><span>\uD83C\uDFB5</span><span>' + w.MynoteEditor.escapeHTML(muUrl || '\u70B9\u51FB\u7C98\u8D34\u97F3\u4E50\u94FE\u63A5') + '</span>' + (muUrl && muStatus === 'error' ? '<span class="lkc-source-text">预览不可用 · 点击打开</span>' : '') + '</' + fallbackTag + '>';
    }
    return '';
  }

  function renderAtomicHTML(node, files) {
    return sanitizeRenderedHTML(renderAtomicHTMLUnsafe(node || {}, files));
  }

  w.MynoteEditor = {
    setEditorDocRef: setEditorDocRef,
    getEditorDocRef: getEditorDocRef,
    escapeHTML: escapeHTML,
    renderDocToEditorHTML: renderDocToEditorHTML,
    renderAtomicHTML: renderAtomicHTML,
    parseEditorDOM: parseEditorDOM,
    __core_inline: true
  };
})(window);
