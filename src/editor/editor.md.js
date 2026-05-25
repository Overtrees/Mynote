// ===== 此刻扩展语法预处理 + Markdown 工具函数 =====
(function (w) {
  'use strict';

  function preprocessExtendedMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/~~([^~]+)~~/g, '<del style="background:rgba(127,127,127,0.06);padding:0 2px;">$1</del>')
      .replace(/==([^=]+)==/g, '<span style="display:inline-flex;align-items:center;background:rgba(255,204,0,0.25);color:var(--text-main);padding:0 10px;border-radius:999px;line-height:1.8;font-weight:500;">$1</span>')
      .replace(/!!([^\n]+)/g, '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="font-size:0.8em;background:rgba(90,200,250,0.15);color:#007aff;padding:0 10px;border-radius:999px;font-weight:600;line-height:1.8;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg> $1</span></span>')
      .replace(/\?\?([^\n]+)/g, '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="font-size:0.8em;background:rgba(255,149,0,0.12);color:#e88b00;padding:0 10px;border-radius:999px;font-weight:600;line-height:1.8;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> $1</span></span>')
      .replace(/@@([^\n]+)/g, '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="font-size:0.8em;background:rgba(52,199,89,0.12);color:#34c759;padding:0 10px;border-radius:999px;font-weight:600;line-height:1.8;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> $1</span></span>')
      .replace(/(^|\s)#([\u4e00-\u9fa5\w-]+)/g, '$1<span style="display:inline-flex;align-items:center;color:#007aff;background:rgba(0,122,255,0.08);padding:0 8px;border-radius:999px;font-size:0.85em;font-weight:500;line-height:1.8;">#$2</span>')
      /* ---- callout > [!NOTE] / [!WARNING] / [!TIP] ---- */
      .replace(/^>\s*\[!(\w+)\]\s*([\s\S]*?)(?=\n>\s*\[|\n*$(?!\n))/gm, function(m, type, body) {
        var t = type.toLowerCase();
        var cls = 'callout callout-' + t;
        var icons = {
          note:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#007aff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
          warning:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff9500" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
          tip:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34c759" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
          important:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#af52de" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
          caution:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff453a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        };
        var titles = { note:'笔记', warning:'注意', tip:'提示', important:'重要', caution:'小心' };
        var icon = icons[t] || '\u2139\uFE0F';
        var title = titles[t] || type;
        var bodyText = body.replace(/^>\s*/gm, '').trim();
        return '<div class="' + cls + '"><div class="callout-header"><span class="callout-icon">' + icon + '</span><span class="callout-title">' + title + '</span></div><div class="callout-body">' + bodyText + '</div></div>';
      })
      /* ---- emoji shortcodes ---- */
      .replace(/:([a-z_+-]+):/g, function(m, name) {
        var map = { smile:'\uD83D\uDE0A', heart:'\u2764\uFE0F', rocket:'\uD83D\uDE80', fire:'\uD83D\uDD25', check:'\u2705', x:'\u274C', warning:'\u26A0\uFE0F', info:'\u2139\uFE0F', question:'\u2753', thumbsup:'\uD83D\uDC4D', thumbsdown:'\uD83D\uDC4E', ok:'\uD83D\uDC4C', wave:'\uD83D\uDC4B', clap:'\uD83D\uDC4F', pray:'\uD83D\uDE4F', star:'\u2B50', sparkles:'\u2728', bookmark:'\uD83D\uDD16', link:'\uD83D\uDD17', gear:'\u2699\uFE0F', lock:'\uD83D\uDD12', unlock:'\uD83D\uDD13', mail:'\uD83D\uDCE7', phone:'\uD83D\uDCDE', calendar:'\uD83D\uDCC5', clock:'\uD83D\uDD50', memo:'\uD83D\uDCDD', pushpin:'\uD83D\uDCCC', paperclip:'\uD83D\uDCCE', file:'\uD83D\uDCC4', folder:'\uD83D\uDCC1', image:'\uD83D\uDDBC\uFE0F', music:'\uD83C\uDFB5', video:'\uD83C\uDFAC', bulb:'\uD83D\uDCA1', book:'\uD83D\uDCD6', chart:'\uD83D\uDCCA', code:'\uD83D\uDCBB', database:'\uD83D\uDEE4\uFE0F', globe:'\uD83C\uDF10', bug:'\uD83D\uDC1B', flask:'\uD83E\uDDEA', robot:'\uD83E\uDD16', party:'\uD83C\uDF89', gift:'\uD83C\uDF81', trophy:'\uD83C\uDFC6', medal:'\uD83E\uDD47', zap:'\u26A1', rain:'\uD83C\uDF27\uFE0F', sun:'\u2600\uFE0F', moon:'\uD83C\uDF19', cloud:'\u2601\uFE0F', snow:'\u2744\uFE0F' };
        return map[name] || m;
      })
      /* ---- 居中文字 ->text<- ---- */
      .replace(/->(.+?)<-/g, '<div style="text-align:center;margin:0.6em 0;">$1</div>')
      /* ---- 彩色标签 $color:文字$ / $文字$ ---- */
      .replace(/\$(\w+):([^$]+)\$/g, function(m, color, text) {
        var colors = { red:'#ff453a', blue:'#007aff', green:'#34c759', orange:'#ff9500', purple:'#af52de', gray:'#8e8e93' };
        var c = colors[color.toLowerCase()] || '#007aff';
        return '<span style="display:inline-flex;align-items:center;gap:3px;background:' + c + '18;color:' + c + ';padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;line-height:1.8;">' + text.trim() + '</span>';
      })
      .replace(/\$([^$]{1,30})\$/g, '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(0,122,255,0.1);color:#007aff;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;line-height:1.8;">$1</span>')
      /* ---- 装饰分割线 ---emoji--- ---- */
      .replace(/^---(.+?)---$/gm, function(m, icon) {
        return '<hr style="border:none;margin:1.2em 0;"><div style="text-align:center;margin:-1.4em 0 1.2em;font-size:12px;color:#c7c7cc;letter-spacing:4px;position:relative;z-index:1;background:var(--card-bg,#fff);width:fit-content;padding:0 12px;margin-left:auto;margin-right:auto;">' + icon + '</div>';
      });
  }

  function looksLikeMarkdown(text) {
    var s = String(text || '').trim();
    if (!s) return false;
    return /(^|\n)#{1,6}\s|(^|\n)[-*+]\s|(^|\n)\d+\.\s|(^|\n)>\s|`{1,3}|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|!\[[^\]]*\]\([^\)]+\)|\[[^\]]+\]\([^\)]+\)|(^|\n)---+(\n|$)|==[^=]+==|!!|\?\?|@@|->.*<-|\$[^$]+\$|^\|.+\|$/m.test(s);
  }

  function looksLikeCiaoMarkdown(text) {
    if (!text || !text.trim()) return false;
    if (looksLikeMarkdown(text)) return true;
    return /==[^=]+==|!![^\n]+|\?\?[^\n]+|@@[^\n]+|~~[^~]+~~|#[\u4e00-\u9fa5\w-]+/.test(text);
  }

  function stripMarkdownForPreview(text) {
    return String(text || '')
      .replace(/==([^=]+)==/g, '$1')
      .replace(/!!([^\n]+)/g, '\uD83D\uDCA1 $1')
      .replace(/\?\?([^\n]+)/g, '\u2753 $1')
      .replace(/@@([^\n]+)/g, '\uD83D\uDC64 $1')
      .replace(/\$(\w+):([^$]+)\$/g, '$2')
      .replace(/\$([^$]{1,30})\$/g, '$1')
      .replace(/^---(.+?)---$/gm, '$1')
      .replace(/:([a-z_+-]+):/g, function(m, name) { return m; })
      .replace(/```[\s\S]*?```/g, ' \u4EE3\u7801\u5757 ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '$1')
      .replace(/(^|\n)#{1,6}\s+/g, '$1')
      .replace(/(^|\n)>\s?/g, '$1')
      .replace(/(^|\n)[-*+]\s+/g, '$1')
      .replace(/(^|\n)\d+\.\s+/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function renderMarkdownHtml(text) {
    try {
      var raw = String(text || '');
      if (!raw.trim()) return '';
      var processed = preprocessExtendedMarkdown(raw);
      var html = window.marked ? marked.parse(processed) : processed.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      return window.DOMPurify ? DOMPurify.sanitize(html, { ADD_TAGS: ['input'], ADD_ATTR: ['checked', 'type'] }) : html;
    } catch(e) {
      console.warn('[此刻] renderMarkdownHtml error', e);
      var safe = String(text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      return '<p>' + safe + '</p>';
    }
  }

  function shouldConvertPureUrlToCard(text) {
    var raw = String(text || '');
    if (!raw.trim()) return false;
    if (looksLikeMarkdown(raw)) return false;
    return (/^https?:\/\/[^\s]+$/).test(raw.trim());
  }

  w.CikeMd = {
    preprocessExtendedMarkdown: preprocessExtendedMarkdown,
    looksLikeMarkdown: looksLikeMarkdown,
    looksLikeCiaoMarkdown: looksLikeCiaoMarkdown,
    stripMarkdownForPreview: stripMarkdownForPreview,
    renderMarkdownHtml: renderMarkdownHtml,
    shouldConvertPureUrlToCard: shouldConvertPureUrlToCard
  };
})(window);
