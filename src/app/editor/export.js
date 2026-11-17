/* 当前笔记导出：优先快照编辑器实际 DOM 与样式，避免导出卡片视觉与编辑页脱节。 */
(function (w) {
  'use strict';

  function nodeText(node) {
    return node && node.children && node.children[0] ? String(node.children[0].text || '') : '';
  }

  function safeHttpUrl(value) {
    var url = String(value || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function safeImageUrl(value) {
    var url = String(value || '').trim();
    if (/^https?:\/\//i.test(url) || /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$/i.test(url)) return url;
    return '';
  }

  function safeAttachmentUrl(value) {
    var url = String(value || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
    if (/^data:(?:application\/(?:pdf|msword|vnd\.openxmlformats-officedocument\.[a-z0-9.+-]+)|text\/plain|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+);base64,[a-z0-9+/=]+$/i.test(url)) return url;
    return '';
  }

  function markdownAlt(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').replace(/[\\\[\]]/g, '\\$&').trim();
  }

  function markdownUrl(value) {
    return String(value || '').replace(/\s/g, '%20').replace(/[()<>]/g, function (ch) {
      return encodeURIComponent(ch);
    });
  }

  function getFile(node, files) {
    var id = node && (node.fileId || node.attrs && node.attrs.fileId);
    return id && files ? files[id] || null : null;
  }

  function imageMarkdown(file, alt) {
    var url = safeImageUrl(file && file.url);
    if (!url) return alt ? '[图片：' + alt + ']' : '[图片]';
    return '![' + markdownAlt(alt || file.name || '图片') + '](' + markdownUrl(url) + ')';
  }

  function galleryItems(node, files) {
    var items = node && node.attrs && Array.isArray(node.attrs.items) ? node.attrs.items : [];
    return items.map(function (item) {
      if (typeof item === 'string') return files && files[item] || { url: item };
      if (item && item.fileId && files && files[item.fileId]) return files[item.fileId];
      return item || null;
    }).filter(Boolean);
  }

  function markdownImageWithCaption(file, caption) {
    var image = imageMarkdown(file, file && file.name || '图片');
    var text = String(caption || '').trim();
    return text ? image + '\n\n说明：' + text : image;
  }

  function blockToMarkdown(node, files) {
    if (!node) return '';
    var text = nodeText(node);
    switch (node.type) {
      case 'paragraph':
      case 'code_block':
      case 'unordered_list':
      case 'ordered_list':
      case 'callout':
        return text;
      case 'heading':
        return '#'.repeat(Math.max(1, Math.min(6, Number(node.attrs && node.attrs.level) || 2))) + ' ' + text;
      case 'quote':
        return text.split('\n').map(function (line) { return '> ' + line; }).join('\n');
      case 'todo':
        return '- [' + (node.attrs && node.attrs.checked ? 'x' : ' ') + '] ' + text;
      case 'divider':
        return '---';
      case 'decorative_divider':
        return node.attrs && node.attrs.text ? '---' + node.attrs.text + '---' : (text || '---');
      case 'image': {
        var imageFile = getFile(node, files);
        return imageMarkdown(imageFile, imageFile && imageFile.name || '图片');
      }
      case 'imgTextCard':
      case 'imageTextRow':
        return markdownImageWithCaption(getFile(node, files), text);
      case 'gallery':
        return galleryItems(node, files).map(function (file) {
          return imageMarkdown(file, file.name || '图片');
        }).join('\n');
      case 'attachment': {
        var attachment = getFile(node, files);
        if (attachment && attachment.type && attachment.type.indexOf('image/') === 0) {
          return imageMarkdown(attachment, attachment.name || '图片');
        }
        return '📎 ' + (attachment && attachment.name || '附件');
      }
      case 'link-card':
      case 'musicCard': {
        var link = safeHttpUrl(node.url);
        if (!link) return text;
        var label = node.meta && (node.meta.title || node.meta.name) || link;
        return '[' + String(label).replace(/[\\\[\]]/g, '\\$&') + '](' + markdownUrl(link) + ')';
      }
      default:
        return text;
    }
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toSemanticMarkdown(doc, title, files) {
    var heading = String(title || '').trim();
    var blocks = Array.isArray(doc) ? doc.map(function (node) {
      return blockToMarkdown(node, files || {});
    }).filter(function (part) { return part !== ''; }) : [];
    if (heading) blocks.unshift('# ' + heading.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&'));
    return blocks.join('\n\n').replace(/\s+$/, '') + '\n';
  }

  function renderMarkdownBlock(text) {
    var source = String(text || '');
    if (!source.trim()) return '';
    if (w.MynoteMd && typeof w.MynoteMd.renderMarkdownHtml === 'function' && w.DOMPurify && typeof w.DOMPurify.sanitize === 'function') {
      return w.MynoteMd.renderMarkdownHtml(source);
    }
    return '<p>' + escapeHTML(source).replace(/\n/g, '<br>') + '</p>';
  }

  function renderInline(text) {
    var source = String(text || '');
    if (w.MynoteMd && typeof w.MynoteMd.preprocessExtendedMarkdown === 'function' && w.marked && typeof w.marked.parseInline === 'function' && w.DOMPurify && typeof w.DOMPurify.sanitize === 'function') {
      return w.DOMPurify.sanitize(w.marked.parseInline(w.MynoteMd.preprocessExtendedMarkdown(source)));
    }
    return escapeHTML(source).replace(/\n/g, '<br>');
  }

  function formatBytes(value) {
    var bytes = Number(value);
    if (!isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function imageElement(url, alt, className) {
    var safeUrl = safeImageUrl(url);
    if (!safeUrl) return '<div class="media-placeholder">图片未能导出</div>';
    return '<img class="' + className + '" src="' + escapeHTML(safeUrl) + '" alt="' + escapeHTML(alt || '') + '">';
  }

  function renderLinkCard(node, isMusic) {
    var url = safeHttpUrl(node.url);
    var meta = node.meta || {};
    var title = meta.title || meta.name || url || (isMusic ? '音乐链接' : '网页链接');
    var subtitle = meta.subtitle || '';
    var source = meta.source || '';
    var cover = safeImageUrl(meta.cover);
    var label = isMusic ? '🎵' : '🔗';
    var card = '<span class="lkc-card">' + (cover ? '<span class="lkc-cover">' + imageElement(cover, '', 'lkc-cover-image') + '</span>' : '') +
      '<span class="lkc-body' + (cover ? ' has-cover' : '') + '"><span class="lkc-title">' + escapeHTML(title) + '</span>' +
      (subtitle ? '<span class="lkc-subtitle">' + escapeHTML(subtitle) + '</span>' : '') +
      '<span class="lkc-source"><span class="lkc-source-icon">' + label + '</span>' + (source ? '<span class="lkc-source-dot"></span><span class="lkc-source-text">' + escapeHTML(source) + '</span>' : '') + '</span></span></span>';
    return '<div class="note-media note-link-card' + (isMusic ? ' note-music-card' : '') + '">' + (url ? '<a class="lkc-link" href="' + escapeHTML(url) + '" target="_blank" rel="noopener noreferrer">' + card + '</a>' : card) + '</div>';
  }

  function renderBlock(node, files) {
    var text = nodeText(node);
    var type = String(node.type || 'paragraph');
    var file;
    switch (type) {
      case 'paragraph':
        return '<div class="note-text note-paragraph">' + renderMarkdownBlock(text) + '</div>';
      case 'heading': {
        var level = Math.max(1, Math.min(6, Number(node.attrs && node.attrs.level) || 2));
        return '<div class="note-text note-heading"><h' + level + '>' + renderInline(text) + '</h' + level + '></div>';
      }
      case 'quote':
        return '<div class="note-text"><blockquote>' + escapeHTML(text).replace(/\n/g, '<br>') + '</blockquote></div>';
      case 'todo': {
        var checked = !!(node.attrs && node.attrs.checked);
        return '<div class="note-text note-todo' + (checked ? ' is-checked' : '') + '"><span class="todo-checkbox' + (checked ? ' is-checked' : '') + '" aria-hidden="true">' + (checked ? '✓' : '') + '</span><span class="todo-text">' + escapeHTML(text).replace(/\n/g, '<br>') + '</span></div>';
      }
      case 'divider':
        return '<div class="note-text"><hr></div>';
      case 'decorative_divider':
        return '<div class="note-text note-decorative-divider"><hr><span>' + escapeHTML(node.attrs && node.attrs.text || text.replace(/^---|---$/g, '').trim()) + '</span></div>';
      case 'imgTextCard': {
        file = getFile(node, files);
        return '<figure class="note-media img-text-card">' + imageElement(file && file.url, file && file.name || '图片', 'itc-image') + '<figcaption class="itc-text">' + (text ? escapeHTML(text) : '<span class="muted">点击查看完整文本</span>') + '</figcaption></figure>';
      }
      case 'imageTextRow': {
        file = getFile(node, files);
        return '<figure class="note-media img-text-row"><div class="itr-img">' + imageElement(file && file.url, file && file.name || '图片', 'itr-image') + '</div><figcaption class="itr-text">' + (text ? escapeHTML(text) : '<span class="muted">点击查看完整文本</span>') + '</figcaption></figure>';
      }
      case 'gallery': {
        var gallery = galleryItems(node, files);
        return '<div class="note-media gallery-grid" aria-label="图片画廊">' + (gallery.length ? gallery.map(function (item, index) {
          return imageElement(item.url, item.name || ('画廊图片 ' + (index + 1)), 'gallery-image');
        }).join('') : '<div class="media-placeholder">空画廊</div>') + '</div>';
      }
      case 'image': {
        file = getFile(node, files);
        return '<figure class="note-media note-image">' + imageElement(file && file.url, file && file.name || '图片', 'standalone-image') + '</figure>';
      }
      case 'attachment': {
        file = getFile(node, files);
        if (file && file.type && file.type.indexOf('image/') === 0) {
          return '<figure class="note-media note-attachment-image">' + imageElement(file.url, file.name || '图片', 'standalone-image') + '</figure>';
        }
        var filename = file && file.name || '附件';
        var href = safeAttachmentUrl(file && file.url);
        var fileCard = '<span class="attachment-icon">📎</span><span class="attachment-info"><span class="attachment-name">' + escapeHTML(filename) + '</span>' + (file && file.type ? '<span class="attachment-meta">' + escapeHTML(file.type) + (file.size ? ' · ' + formatBytes(file.size) : '') + '</span>' : '') + '</span><span class="attachment-hint">下载附件</span>';
        return '<div class="note-media attachment-card">' + (href ? '<a href="' + escapeHTML(href) + '" download="' + escapeHTML(filename) + '">' + fileCard + '</a>' : '<span class="attachment-card-inner">' + fileCard + '</span>') + '</div>';
      }
      case 'link-card':
        return renderLinkCard(node, false);
      case 'musicCard':
        return renderLinkCard(node, true);
      case 'code_block':
      case 'unordered_list':
      case 'ordered_list':
      case 'callout':
        return '<div class="note-text note-markdown">' + renderMarkdownBlock(text) + '</div>';
      default:
        return '<div class="note-text note-paragraph">' + renderMarkdownBlock(text) + '</div>';
    }
  }

  function rewriteCssUrls(cssText, baseUrl) {
    return String(cssText || '').replace(/url\(([^)]*)\)/gi, function (match, raw) {
      var value = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
      if (!value || /^(?:data:|https?:|blob:|#|\/\/)/i.test(value) || !baseUrl) return match;
      try { return 'url("' + new URL(value, baseUrl).href.replace(/"/g, '%22') + '")'; }
      catch (_) { return match; }
    });
  }

  function readStyleSheet(sheet, visited) {
    if (!sheet || visited.indexOf(sheet) >= 0) return '';
    visited.push(sheet);
    var rules;
    try { rules = sheet.cssRules; } catch (_) { return ''; }
    if (!rules) return '';
    var out = [];
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule && rule.styleSheet) {
        var imported = readStyleSheet(rule.styleSheet, visited);
        if (imported) out.push(imported);
      } else if (rule && rule.cssText) {
        out.push(rewriteCssUrls(rule.cssText, sheet.href || (w.document && w.document.baseURI) || ''));
      }
    }
    return out.join('\n');
  }

  function collectStyleText() {
    var doc = w.document;
    if (!doc || !doc.styleSheets) return '';
    var sheets = doc.styleSheets;
    var visited = [];
    var out = [];
    for (var i = 0; i < sheets.length; i++) {
      var text = readStyleSheet(sheets[i], visited);
      if (text) out.push(text);
    }
    return out.join('\n');
  }

  function sanitizeSnapshotMarkup(html) {
    var source = String(html || '');
    if (w.DOMPurify && typeof w.DOMPurify.sanitize === 'function') {
      return w.DOMPurify.sanitize(source, {
        ADD_TAGS: ['input'],
        ADD_ATTR: ['checked', 'type', 'aria-checked', 'aria-label', 'target', 'rel', 'download']
      });
    }
    return source;
  }

  function captureEditorSnapshot(editorBody) {
    var body = editorBody || null;
    var html = '';
    if (body && typeof body.cloneNode === 'function') {
      try {
        var clone = body.cloneNode(true);
        if (typeof body.querySelectorAll === 'function' && typeof clone.querySelectorAll === 'function') {
          var originalChecks = body.querySelectorAll('input[type="checkbox"]');
          var clonedChecks = clone.querySelectorAll('input[type="checkbox"]');
          for (var i = 0; i < originalChecks.length && i < clonedChecks.length; i++) {
            if (originalChecks[i].checked) clonedChecks[i].setAttribute('checked', '');
            else clonedChecks[i].removeAttribute('checked');
          }
        }
        html = clone.innerHTML;
      } catch (_) { html = body.innerHTML || ''; }
    } else if (body && typeof body.innerHTML === 'string') {
      html = body.innerHTML;
    } else if (w.MynoteEditor && typeof w.MynoteEditor.renderDocToEditorHTML === 'function') {
      html = w.MynoteEditor.renderDocToEditorHTML([], {});
    }
    return {
      html: sanitizeSnapshotMarkup(html),
      cssText: collectStyleText()
    };
  }

  function snapshotMarkup(doc, files, snapshot) {
    if (snapshot && typeof snapshot.html === 'string') return sanitizeSnapshotMarkup(snapshot.html);
    return Array.isArray(doc) ? doc.map(function (node) { return renderBlock(node || {}, files || {}); }).join('\n') : '';
  }

  function snapshotStyles(snapshot, includeEditorCss) {
    var shouldIncludeCss = includeEditorCss !== false;
    var supplied = snapshot && typeof snapshot.cssText === 'string' ? snapshot.cssText : (shouldIncludeCss ? collectStyleText() : '');
    return (shouldIncludeCss ? (supplied || '') : '') + '\n' +
      '.mynote-export-shell{box-sizing:border-box;width:min(100%,1120px);margin:0 auto;padding:24px 16px 40px;color:var(--text-main,CanvasText)}' +
      '.note-title{box-sizing:border-box;width:min(100%,72ch);margin:0 auto 18px;padding:0 0 10px;border-bottom:1px solid var(--border-color,rgba(0,0,0,.12));color:var(--text-main,CanvasText);font:700 24px/1.3 var(--font-family-base,-apple-system,BlinkMacSystemFont,sans-serif);letter-spacing:-.02em;overflow-wrap:anywhere}' +
      '.mynote-export-shell .editor-body{box-sizing:border-box;min-height:0;padding:4px 0;color:var(--text-main,CanvasText);font:var(--md-font-body,16px)/var(--md-line-height,1.75) var(--font-family-base,-apple-system,BlinkMacSystemFont,sans-serif);overflow-wrap:anywhere}' +
      '.mynote-export-shell .editor-body>*:first-child{margin-top:0}' +
      '.mynote-export-shell .editor-body>*:last-child{margin-bottom:0}' +
      '@page{size:auto;margin:16mm}' +
      '@media print{html,body{print-color-adjust:exact;-webkit-print-color-adjust:exact}body{padding:0}.mynote-export-shell{width:100%;max-width:none;margin:0;padding:0}.mynote-export-shell .editor-body{min-height:0}.note-title{break-after:avoid}}';
  }

  function visualSnapshotMarkup(doc, title, files, snapshot) {
    var name = String(title || '无标题').trim() || '无标题';
    var content = snapshotMarkup(doc, files, snapshot);
    return '<main class="mynote-export-shell"><h1 class="note-title">' + escapeHTML(name) + '</h1><div class="editor-body">' + content + '</div></main>';
  }

  function toMarkdown(doc, title, files, snapshot) {
    if (snapshot && typeof snapshot.html === 'string') {
      var css = snapshotStyles(snapshot).replace(/<\/style/gi, '<\\/style');
      return '<style>\n' + css + '\n</style>\n\n' + visualSnapshotMarkup(doc, title, files, snapshot) + '\n';
    }
    return toSemanticMarkdown(doc, title, files);
  }

  function fallbackStyles() {
    return [
      ':root{color-scheme:light dark;--primary-bg:Canvas;--text-main:CanvasText;--text-secondary:GrayText;--border-color:GrayText;--glass-content-bg:Canvas;--glass-content-border:GrayText;--fill-subtle:Canvas;--code-bg:Canvas;--color-accent:LinkText;--md-text-muted:GrayText;--font-family-base:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;--font-family-mono:ui-monospace,Menlo,Consolas,monospace;--font-11:11px;--font-12:12px;--font-13:13px;--font-14:14px;--font-24:24px;--radius-10:10px;--radius-12:12px;--radius-14:14px;--radius-18:18px;--radius-22:22px;--radius-999:999px;--radius-circle:50%}',
      '@media(prefers-color-scheme:dark){:root{--primary-bg:Canvas;--text-main:CanvasText;--text-secondary:GrayText;--glass-content-bg:Canvas;--glass-content-border:GrayText;--border-color:GrayText;--fill-subtle:Canvas;--code-bg:Canvas}}',
      '*{box-sizing:border-box}html{background:var(--primary-bg);color:var(--text-main);font:16px/1.75 var(--font-family-base)}body{margin:0;background:var(--primary-bg);color:var(--text-main);overflow-wrap:anywhere}.editor-body{min-height:0}.editor-body p{margin:0 0 .65em}.editor-body h1,.editor-body h2,.editor-body h3,.editor-body h4{line-height:1.28;margin:1.25em 0 .4em}.editor-body blockquote{margin:.75em 0;padding:10px 14px;border-left:3px solid var(--color-accent);border-radius:var(--radius-10);background:var(--fill-subtle)}.editor-body pre{max-width:100%;overflow:auto;padding:12px 14px;border:1px solid var(--border-color);border-radius:var(--radius-12);background:var(--code-bg)}.editor-body .img-text-card,.editor-body .img-text-row,.editor-body .link-card-block,.editor-body .link-card-err,.editor-body .attachment-file{margin:8px 0;overflow:hidden;border:1px solid var(--glass-content-border);border-radius:var(--radius-22);background:var(--glass-content-bg)}.editor-body .itc-img-wrap img,.editor-body .lkc-cover img{display:block;width:100%;max-width:100%;height:auto;object-fit:cover}.editor-body .itc-text{padding:12px 14px;font-size:var(--font-14);white-space:pre-wrap}.editor-body .img-text-row{display:flex;min-height:181px;max-height:196px}.editor-body .itr-img{flex:0 0 50%;overflow:hidden}.editor-body .itr-img img{width:100%;height:100%;object-fit:cover}.editor-body .itr-text{flex:1;overflow:hidden;padding:10px 14px;font-size:var(--font-14);white-space:pre-wrap}.editor-body .atomic[data-type="gallery"]{margin:8px 36px}.editor-body .atomic[data-type="image"]{margin:8px 36px}.editor-body .atomic.attachment img{max-width:100%;border-radius:var(--radius-22)}.editor-body .attachment-file{display:flex;align-items:center;gap:10px;padding:16px 20px}.editor-body .att-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.editor-body .lkc-cover{width:100%;aspect-ratio:2.4/1;overflow:hidden}.editor-body .lkc-body{padding:10px 14px 12px}.editor-body .lkc-title{font-size:var(--font-14);font-weight:600;line-height:1.4}.editor-body .lkc-subtitle,.editor-body .lkc-source{font-size:var(--font-12);color:var(--text-secondary)}.editor-body .todo-checkbox{accent-color:var(--color-accent)}img{max-width:100%}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}'
    ].join('');
  }

  function toHTMLDocument(doc, title, files, snapshot) {
    var name = String(title || '无标题').trim() || '无标题';
    var body = visualSnapshotMarkup(doc, name, files, snapshot);
    var appCss = snapshot && typeof snapshot.cssText === 'string' ? snapshot.cssText : collectStyleText();
    var css = (appCss || fallbackStyles()) + '\n' + snapshotStyles(snapshot, false).replace(/<\/style/gi, '<\\/style');
    return '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>' + escapeHTML(name) + '</title><style>' + css + '</style></head><body>' + body + '</body></html>';
  }

  function toFilename(title, extension) {
    var base = String(title || '笔记').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || '笔记';
    return base + '.' + String(extension || '').replace(/^\./, '');
  }

  w.MynoteEditorExport = {
    toMarkdown: toMarkdown,
    toHTMLDocument: toHTMLDocument,
    captureEditorSnapshot: captureEditorSnapshot,
    toFilename: toFilename
  };
})(window);
