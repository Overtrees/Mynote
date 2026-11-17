/* 当前笔记的 Markdown / HTML 导出转换。 */
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
        return node.attrs && node.attrs.text ? '---' + node.attrs.text + '---' : '---';
      case 'image':
      case 'imgTextCard':
      case 'imageTextRow': {
        var imgFile = getFile(node, files);
        return imageMarkdown(imgFile, text || imgFile && imgFile.name || '图片');
      }
      case 'gallery': {
        var items = node.attrs && Array.isArray(node.attrs.items) ? node.attrs.items : [];
        return items.map(function (item) {
          var file = item && item.fileId && files ? files[item.fileId] : null;
          if (!file && typeof item === 'string' && files && files[item]) file = files[item];
          if (!file && item && item.url) file = item;
          return imageMarkdown(file, file && file.name || '图片');
        }).join('\n');
      }
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
        var label = node.meta && node.meta.title || node.meta && node.meta.name || link;
        return '[' + String(label).replace(/[\[\]]/g, '\\$&') + '](' + markdownUrl(link) + ')';
      }
      default:
        return text;
    }
  }

  function toMarkdown(doc, title, files) {
    var heading = String(title || '').trim();
    var blocks = Array.isArray(doc) ? doc.map(function (node) {
      return blockToMarkdown(node, files || {});
    }).filter(function (part) { return part !== ''; }) : [];
    if (heading) blocks.unshift('# ' + heading.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&'));
    return blocks.join('\n\n').replace(/\s+$/, '') + '\n';
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toHTMLDocument(doc, title, files) {
    var name = String(title || '无标题').trim() || '无标题';
    var markdown = toMarkdown(doc, name, files);
    var body = w.MynoteMd && typeof w.MynoteMd.renderMarkdownHtml === 'function'
      ? w.MynoteMd.renderMarkdownHtml(markdown)
      : '<pre>' + escapeHTML(markdown) + '</pre>';
    return '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHTML(name) + '</title><style>' +
      'html{color-scheme:light dark}body{margin:0;padding:32px 20px;background:Canvas;color:CanvasText;font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{box-sizing:border-box;max-width:780px;margin:0 auto;padding:36px 42px;background:Canvas;border:1px solid color-mix(in srgb,CanvasText 14%,transparent);border-radius:18px;box-shadow:0 8px 32px color-mix(in srgb,CanvasText 10%,transparent);overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.2em 0 .55em}h1{margin-top:0;font-size:2em}p{margin:.65em 0}blockquote{margin:1em 0;padding:.3em 1em;border-left:3px solid GrayText;color:CanvasText;background:color-mix(in srgb,CanvasText 5%,Canvas)}pre{max-width:100%;overflow:auto;padding:14px;background:color-mix(in srgb,CanvasText 5%,Canvas);border-radius:10px}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}th,td{padding:8px 10px;border:1px solid GrayText}img{max-width:100%;height:auto;border-radius:10px}hr{border:0;border-top:1px solid GrayText;margin:1.5em 0}a{color:LinkText;text-decoration:none}li{padding:2px 0}@page{size:auto;margin:18mm}@media print{html{color-scheme:light}body{padding:0}main{max-width:none;margin:0;padding:0;border:0;border-radius:0;box-shadow:none}a{color:inherit;text-decoration:underline}pre,blockquote,table,img{break-inside:avoid}h1,h2,h3{break-after:avoid}}' +
      '</style></head><body><main>' + body + '</main></body></html>';
  }

  function toFilename(title, extension) {
    var base = String(title || '笔记').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || '笔记';
    return base + '.' + String(extension || '').replace(/^\./, '');
  }

  w.MynoteEditorExport = {
    toMarkdown: toMarkdown,
    toHTMLDocument: toHTMLDocument,
    toFilename: toFilename
  };
})(window);
