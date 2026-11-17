// ===== 此刻扩展语法预处理 + Markdown 工具函数 =====
(function (w) {
  'use strict';

  var parseMarkdownSource = null;

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setMarkdownParser(parser) {
    parseMarkdownSource = typeof parser === 'function' ? parser : null;
  }

  function createTokenState(source) {
    var prefix = '\uE000mynote-md-' + Math.random().toString(36).slice(2) + '-';
    while (String(source || '').indexOf(prefix) >= 0) prefix = '\uE000mynote-md-' + Math.random().toString(36).slice(2) + '-';
    var parts = [];
    function stash(value, type, calloutValue) {
      var token = prefix + parts.length + '\uE001';
      parts.push({ token: token, value: String(value == null ? '' : value), type: type || 'generated', calloutValue: calloutValue });
      return token;
    }
    function restore(text, mode) {
      var restored = String(text || '');
      parts.forEach(function (part) {
        if (mode === 'code' && part.type !== 'code') return;
        var value = mode === 'callout' && part.type === 'code' && typeof part.calloutValue === 'string'
          ? part.calloutValue : part.value;
        restored = restored.split(part.token).join(value);
      });
      return restored;
    }
    return { parts: parts, stash: stash, restore: restore };
  }

  function protectCodeSegments(text, state) {
    var source = String(text || '');
    // Extract fenced code as complete slices before scanning inline backticks.
    var fenced = '';
    var offset = 0;
    while (offset < source.length) {
      var newline = source.indexOf('\n', offset);
      var end = newline < 0 ? source.length : newline + 1;
      var line = source.slice(offset, newline < 0 ? source.length : newline).replace(/\r$/, '');
      var opening = line.match(/^ {0,3}((?:>\s*)*)(`{3,}|~{3,})/);
      if (!opening) {
        fenced += source.slice(offset, end);
        offset = end;
        continue;
      }
      var fenceChar = opening[2].charAt(0);
      var fenceLength = opening[2].length;
      var quoteDepth = (opening[1].match(/>/g) || []).length;
      var blockEnd = end;
      var closed = false;
      while (blockEnd < source.length) {
        var closeNewline = source.indexOf('\n', blockEnd);
        var closeEnd = closeNewline < 0 ? source.length : closeNewline + 1;
        var closeLine = source.slice(blockEnd, closeNewline < 0 ? source.length : closeNewline).replace(/\r$/, '');
        var normalizedClose = closeLine.replace(/^ {0,3}(?:>\s*)*/, '');
        var closing = normalizedClose.match(/^(`+|~+)[ \t]*$/);
        var closeQuoteDepth = ((closeLine.match(/^ {0,3}(?:>\s*)*/) || [''])[0].match(/>/g) || []).length;
        blockEnd = closeEnd;
        if (closing && closing[1].charAt(0) === fenceChar && closing[1].length >= fenceLength && closeQuoteDepth >= quoteDepth) {
          closed = true;
          break;
        }
      }
      if (!closed) blockEnd = source.length;
      var fenceSource = source.slice(offset, blockEnd);
      var calloutFenceSource = fenceSource;
      if (quoteDepth) {
        calloutFenceSource = fenceSource.replace(/(^|\n)( {0,3}(?:>\s*)+)/g, function (whole, newlineText, prefixText) {
          var stripped = prefixText;
          for (var depth = 0; depth < quoteDepth; depth++) stripped = stripped.replace(/^ {0,3}>[ \t]?/, '');
          return newlineText + stripped;
        });
      }
      var fenceToken = state.stash(fenceSource, 'code', calloutFenceSource);
      fenced += quoteDepth ? line.match(/^ {0,3}/)[0] + opening[1] + fenceToken : fenceToken;
      offset = blockEnd;
    }

    // Protect matching inline backtick runs (including multiline spans); escaped ticks stay literal.
    var inline = '';
    var i = 0;
    while (i < fenced.length) {
      if (fenced.charAt(i) !== '`') { inline += fenced.charAt(i++); continue; }
      var slashCount = 0;
      for (var back = i - 1; back >= 0 && fenced.charAt(back) === '\\'; back--) slashCount++;
      var runEnd = i + 1;
      while (fenced.charAt(runEnd) === '`') runEnd++;
      if (slashCount % 2) { inline += fenced.slice(i, runEnd); i = runEnd; continue; }
      var runLength = runEnd - i;
      var search = runEnd;
      var closingStart = -1;
      while (search < fenced.length) {
        var tick = fenced.indexOf('`', search);
        if (tick < 0) break;
        var closeRunEnd = tick + 1;
        while (fenced.charAt(closeRunEnd) === '`') closeRunEnd++;
        if (closeRunEnd - tick === runLength) { closingStart = tick; break; }
        search = closeRunEnd;
      }
      if (closingStart < 0) { inline += fenced.slice(i, runEnd); i = runEnd; }
      else {
        var spanEnd = closingStart + runLength;
        inline += state.stash(fenced.slice(i, spanEnd), 'code');
        i = spanEnd;
      }
    }
    return inline;
  }

  function protectRawHtmlAndLinkTargets(text, state) {
    var source = String(text || '');
    // Keep URL punctuation and raw HTML attributes out of custom syntax scans.
    source = source.replace(/\]\(([^)\n]*)\)/g, function (whole, target) {
      return '](' + state.stash(target, 'opaque') + ')';
    });
    source = source.replace(/<\/?[A-Za-z][^<>]*>/g, function (tag) {
      return state.stash(tag, 'opaque');
    });
    return source;
  }

  var CALLOUT_ICONS = {
    note: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-callout-note-icon)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-callout-warning-icon)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    tip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-callout-tip-icon)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    important: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-callout-important-icon)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
    caution: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-callout-caution-icon)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
  };
  var CALLOUT_STYLE = {
    note: 'note', info: 'note', todo: 'note', abstract: 'note', quote: 'note',
    tip: 'tip', success: 'tip', example: 'tip', question: 'warning', warning: 'warning',
    important: 'important', failure: 'important', bug: 'important', caution: 'caution', danger: 'caution'
  };
  var CALLOUT_TITLE = {
    note: '笔记', info: '信息', todo: '待办', abstract: '摘要', quote: '引用',
    tip: '提示', success: '成功', example: '示例', question: '问题', warning: '注意',
    important: '重要', failure: '失败', bug: '问题', caution: '小心', danger: '危险'
  };

  function preprocessCallouts(text, state) {
    return String(text || '').replace(/^ {0,3}>[ \t]*\[!(\w+)\]([+-]?)(?:[ \t]+([^\r\n]*))?[ \t]*(?:\r?\n(?: {0,3}>[^\r\n]*(?:\r?\n|$))*)?/gm,
      function (whole, rawType, folding, customTitle) {
        var rawLines = whole.split(/\r?\n/);
        var bodyLines = rawLines.slice(1).map(function (line) { return line.replace(/^ {0,3}>[ \t]?/, ''); });
        var bodyText = state.restore(bodyLines.join('\n').trim(), 'callout');
        var type = String(rawType || '').toLowerCase();
        var style = CALLOUT_STYLE[type] || 'note';
        var title = customTitle && customTitle.trim() ? customTitle.trim() : (CALLOUT_TITLE[type] || rawType);
        title = escapeHTML(state.restore(title, 'callout'));
        var bodyHtml = bodyText ? (parseMarkdownSource ? parseMarkdownSource(bodyText) : escapeHTML(bodyText).replace(/\n/g, '<br>')) : '';
        var header = '<span class="callout-icon" aria-hidden="true">' + CALLOUT_ICONS[style] + '</span><span class="callout-title">' + title + '</span>';
        var markup;
        if (folding === '+' || folding === '-') {
          markup = '<details class="callout callout-' + style + ' callout-collapsible"' + (folding === '+' ? ' open' : '') + '><summary class="callout-header">' + header + '</summary><div class="callout-body">' + (bodyHtml || '') + '</div></details>';
        } else {
          markup = '<aside class="callout callout-' + style + '"><div class="callout-header">' + header + '</div><div class="callout-body">' + (bodyHtml || '') + '</div></aside>';
        }
        return state.stash(markup, 'generated');
      });
  }

  function footnoteId(label) {
    return 'fn-' + encodeURIComponent(String(label || '').trim()).replace(/%/g, '_').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  function preprocessFootnotes(text, state) {
    var lines = String(text || '').split('\n');
    var kept = [];
    var definitions = Object.create(null);
    var order = [];
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(/^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/);
      if (!match) { kept.push(lines[i]); continue; }
      var key = match[1].toLowerCase();
      var body = [match[2]];
      var originalLines = [lines[i]];
      while (i + 1 < lines.length) {
        var continuation = lines[i + 1].match(/^(?: {2,}|\t)(.*)$/);
        if (!continuation) break;
        i++;
        body.push(continuation[1]);
        originalLines.push(lines[i]);
      }
      if (!definitions[key]) {
        definitions[key] = { label: match[1], body: body.join('\n').trim(), original: originalLines.join('\n'), refs: [] };
        order.push(definitions[key]);
      }
    }
    var source = kept.join('\n');
    source = source.replace(/\[\^([^\]\s]+)\]/g, function (whole, label) {
      var entry = definitions[label.toLowerCase()];
      if (!entry) return whole;
      var number = order.indexOf(entry) + 1;
      var refIndex = entry.refs.length + 1;
      var target = footnoteId(entry.label);
      var refId = target + '-ref-' + refIndex;
      entry.refs.push(refId);
      return state.stash('<sup class="footnote-ref"><a href="#' + target + '" id="' + refId + '" aria-label="脚注 ' + number + '">' + number + '</a></sup>', 'generated');
    });
    var items = [];
    var unused = [];
    order.forEach(function (entry, index) {
      if (!entry.refs.length) { unused.push(entry.original); return; }
      var target = footnoteId(entry.label);
      var bodyHtml = parseMarkdownSource ? parseMarkdownSource(entry.body) : escapeHTML(entry.body).replace(/\n/g, '<br>');
      var backs = entry.refs.map(function (refId) {
        return '<a class="footnote-backref" href="#' + refId + '" aria-label="返回脚注引用">↩</a>';
      }).join(' ');
      items.push('<li id="' + target + '">' + bodyHtml + '<span class="footnote-backlinks"> ' + backs + '</span></li>');
    });
    if (items.length) source += '\n\n' + state.stash('<section class="footnotes" aria-label="脚注"><ol>' + items.join('') + '</ol></section>', 'generated');
    if (unused.length) source += '\n\n' + unused.join('\n');
    return source;
  }

  function isEscapedAt(text, index) {
    var slashes = 0;
    for (var i = index - 1; i >= 0 && text.charAt(i) === '\\'; i--) slashes++;
    return slashes % 2 === 1;
  }

  function looksLikeMathExpression(expression) {
    var value = String(expression || '').trim();
    if (!value) return false;
    if (/^[A-Za-z]$/.test(value)) return true;
    return /(?:\\[A-Za-z]+|[0-9]|[=+\-*/^_{}<>]|[\u03b1-\u03c9\u0391-\u03a9])/.test(value);
  }

  function renderMath(expression, displayMode) {
    var tex = String(expression || '').trim();
    var rendered;
    try {
      if (w.katex && typeof w.katex.renderToString === 'function') {
        rendered = w.katex.renderToString(tex, {
          displayMode: !!displayMode,
          output: 'htmlAndMathml',
          throwOnError: false,
          trust: false,
          strict: 'ignore',
          maxExpand: 100,
          maxSize: 20
        });
      } else {
        rendered = '<code class="math-source">' + escapeHTML(tex) + '</code>';
      }
    } catch (error) {
      rendered = '<code class="math-source">' + escapeHTML(tex) + '</code>';
    }
    return displayMode ? '<div class="math-block" role="math">' + rendered + '</div>' : '<span class="math-inline" role="math">' + rendered + '</span>';
  }

  function preprocessMath(text, state) {
    var source = String(text || '');
    // Display formulas on separate lines, then any remaining $$...$$ display spans.
    source = source.replace(/(^|\n)[ \t]*\$\$[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\$\$[ \t]*(?=\r?\n|$)/g,
      function (whole, lineStart, expression) { return lineStart + state.stash(renderMath(expression, true), 'generated'); });
    source = source.replace(/\$\$([\s\S]+?)\$\$/g, function (whole, expression, offset, full) {
      if (isEscapedAt(full, offset)) return whole;
      return state.stash(renderMath(expression, true), 'generated');
    });
    source = source.replace(/\$([^$\r\n]+?)\$/g, function (whole, expression, offset, full) {
      if (isEscapedAt(full, offset) || full.charAt(offset - 1) === '$' || full.charAt(offset + whole.length) === '$') return whole;
      if (!looksLikeMathExpression(expression)) return whole;
      return state.stash(renderMath(expression, false), 'generated');
    });
    return source;
  }

  function preprocessInlineExtensions(text, state) {
    var source = String(text || '');
    function html(markup) { return state.stash(markup, 'generated'); }
    source = source.replace(/~~([^~\n]+)~~/g, function (whole, value) {
      return html('<del class="mynote-strikethrough">' + value + '</del>');
    });
    source = source.replace(/==([^=\n]+)==/g, function (whole, value) {
      return html('<span class="mynote-highlight">' + value + '</span>');
    });
    source = source.replace(/\^\(([^()\n]+)\)\^/g, function (whole, value) {
      return html('<sup>' + escapeHTML(value) + '</sup>');
    });
    source = source.replace(/\^([A-Za-z0-9][A-Za-z0-9,+-]*)\^/g, function (whole, value) {
      return html('<sup>' + escapeHTML(value) + '</sup>');
    });
    source = source.replace(/~\(([^()\n]+)\)~/g, function (whole, value) {
      return html('<sub>' + escapeHTML(value) + '</sub>');
    });
    source = source.replace(/(^|[^~])~([A-Za-z0-9][A-Za-z0-9,+-]*)~(?!~)/g, function (whole, before, value) {
      return before + html('<sub>' + escapeHTML(value) + '</sub>');
    });
    source = source.replace(/\[\[([^\]\r\n|]+)(?:\|([^\]\r\n]+))?\]\]/g, function (whole, rawTarget, rawLabel) {
      var target = rawTarget.trim();
      if (!target) return whole;
      var label = rawLabel == null ? target : rawLabel.trim();
      return html('<a class="mynote-wiki-link" href="#" data-note-title="' + escapeHTML(target) + '" title="打开笔记：' + escapeHTML(target) + '">' + escapeHTML(label || target) + '</a>');
    });
    return source;
  }

  function preprocessExtendedMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    var state = createTokenState(text);
    var source = protectCodeSegments(text, state);
    source = protectRawHtmlAndLinkTargets(source, state);
    source = preprocessCallouts(source, state);
    source = preprocessMath(source, state);
    source = preprocessFootnotes(source, state);
    source = preprocessInlineExtensions(source, state);
    return state.restore(source);
  }

  function hasMathSyntax(text) {
    var source = String(text || '');
    if (/\$\$[\s\S]+?\$\$/.test(source)) return true;
    var pattern = /\$([^$\r\n]+)\$/g;
    var match;
    while ((match = pattern.exec(source))) {
      if (!isEscapedAt(source, match.index) && looksLikeMathExpression(match[1])) return true;
    }
    return false;
  }

  function looksLikeMarkdown(text) {
    var s = String(text || '').trim();
    if (!s) return false;
    var commonMarkdown = /(^|\n)#{1,6}\s|(^|\n)[-*+]\s|(^|\n)\d+\.\s|(^|\n)>\s|`{1,3}|\*\*[^*]+\*\*|(^|[^*])\*[^*\n]+\*($|[^*])|__[^_]+__|~~[^~]+~~|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|(^|\n)---+(\n|$)|==[^=]+==|\[\[[^\]]+\]\]|\[\^[^\]]+\]|\^\([^\n]+\)\^|\^[A-Za-z0-9][A-Za-z0-9,+-]*\^|~\([^\n]+\)~|(^|[^~])~[A-Za-z0-9][A-Za-z0-9,+-]*~(?!~)/m.test(s);
    return commonMarkdown || hasMathSyntax(s);
  }

  function looksLikeCiaoMarkdown(text) {
    if (!text || !text.trim()) return false;
    return looksLikeMarkdown(text);
  }

  function stripMarkdownForPreview(text) {
    return String(text || '')
      .replace(/^\[\^[^\]]+\]:.*(?:\n[ \t]+.*)*$/gm, '')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[\^([^\]]+)\]/g, '')
      .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
      .replace(/\^\(([^()\n]+)\)\^/g, '$1')
      .replace(/\^([A-Za-z0-9][A-Za-z0-9,+-]*)\^/g, '$1')
      .replace(/~\(([^()\n]+)\)~/g, '$1')
      .replace(/(^|[^~])~([A-Za-z0-9][A-Za-z0-9,+-]*)~(?!~)/g, '$1$2')
      .replace(/==([^=]+)==/g, '$1')
      .replace(/```[\s\S]*?```/g, ' 代码块 ')
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
      .replace(/\$([^$\n]+)\$/g, function (whole, value, offset, full) {
        return !isEscapedAt(full, offset) && looksLikeMathExpression(value) ? value : whole;
      })
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function renderMarkdownHtml(text) {
    try {
      var raw = String(text || '');
      if (!raw.trim()) return '';
      var html;
      if (w.marked) html = w.marked.parse(raw);
      else {
        var processed = preprocessExtendedMarkdown(raw);
        html = processed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      }
      if (w.DOMPurify && typeof w.DOMPurify.sanitize === 'function') {
        return w.DOMPurify.sanitize(html, { ADD_TAGS: ['input'], ADD_ATTR: ['checked', 'type', 'open'] });
      }
      return '<p>' + raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</p>'; // fail closed
    } catch (error) {
      console.warn('[此刻] renderMarkdownHtml error', error);
      var safe = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      return '<p>' + safe + '</p>';
    }
  }

  function shouldConvertPureUrlToCard(text) {
    var raw = String(text || '');
    if (!raw.trim()) return false;
    if (looksLikeMarkdown(raw)) return false;
    return (/^https?:\/\/[^\s]+$/).test(raw.trim());
  }

  w.MynoteMd = {
    preprocessExtendedMarkdown: preprocessExtendedMarkdown,
    setMarkdownParser: setMarkdownParser,
    looksLikeMarkdown: looksLikeMarkdown,
    looksLikeCiaoMarkdown: looksLikeCiaoMarkdown,
    stripMarkdownForPreview: stripMarkdownForPreview,
    renderMarkdownHtml: renderMarkdownHtml,
    shouldConvertPureUrlToCard: shouldConvertPureUrlToCard
  };
})(window);
