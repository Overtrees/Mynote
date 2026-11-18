/* 编辑器内 Markdown 块级渲染的公共构件。
 * 三条渲染路径（首次加载、失焦、点击还原）原本各自复制了一套「识别组 → 合并 → 建块 → 删余行」，
 * 这里只抽出其中完全相同的部分，各路径的编排顺序与判断条件保持原样。 */
(function (w) {
  'use strict';

  var FENCE_RE = /^```/;
  var LIST_RE = /^[-*]\s|^\d+\.\s/;

  function isFenceLine(text) { return FENCE_RE.test(text); }
  function isListLine(text) { return LIST_RE.test(text); }

  function flowContainer(node) {
    return node && node.closest ? node.closest('.editor-column') || node.parentElement : node && node.parentElement;
  }

  function adjacentInSameFlow(previous, current) {
    return !!previous && !!current && flowContainer(previous) === flowContainer(current) && previous.nextElementSibling === current;
  }

  /* 从 i 开始收集一个 ``` 围栏组：含「单段落里已含完整围栏 → 不再向下收集」的既有规则 */
  function collectFenceGroup(ps, i) {
    var texts = [(ps[i].textContent || '').trim()];
    var end = i + 1;
    if (texts[0].indexOf('```', 3) < 0) {
      while (end < ps.length && adjacentInSameFlow(ps[end - 1], ps[end])) {
        var nt = (ps[end].textContent || '').trim();
        texts.push(nt);
        end++;
        if (FENCE_RE.test(nt)) break;
      }
    }
    return { start: i, end: end, texts: texts };
  }

  /* 从 i 开始收集连续的列表行 */
  function collectListGroup(ps, i) {
    var texts = [];
    var end = i;
    while (end < ps.length && (end === i || adjacentInSameFlow(ps[end - 1], ps[end]))) {
      var nt = (ps[end].textContent || '').trim();
      if (!LIST_RE.test(nt)) break;
      texts.push(nt);
      end++;
    }
    return { start: i, end: end, texts: texts };
  }

  function range(from, to) {
    var out = [];
    for (var k = from; k < to; k++) out.push(k);
    return out;
  }

  function markInlinePreview(p) {
    p.contentEditable = 'false';
    p.classList.add('md-preview-inline');
    p.tabIndex = 0;
    p.setAttribute('role', 'group');
    p.setAttribute('aria-label', 'Markdown 预览，按回车或空格编辑');
    return p;
  }

  /* 建立块级预览 div（contentEditable=false + mdtext 缓存） */
  function makePreviewBlock(blockId, merged, html) {
    var dv = document.createElement('div');
    dv.contentEditable = 'false';
    dv.className = 'md-preview block markdown-render';
    dv.tabIndex = 0;
    dv.setAttribute('role', 'group');
    dv.setAttribute('aria-label', 'Markdown 预览，按回车或空格编辑');
    if (blockId != null) dv.dataset.blockid = blockId;
    dv.dataset.mdtext = merged;
    dv.innerHTML = html;
    return dv;
  }

  /* 用预览块替换组内首个段落，并删掉其余段落 */
  function replaceGroupWithPreview(pEls, merged, html) {
    var first = pEls[0];
    if (!first || !first.parentNode) return null;
    for (var check = 1; check < pEls.length; check++) {
      if (!adjacentInSameFlow(pEls[check - 1], pEls[check])) return null;
    }
    var dv = makePreviewBlock(first.dataset.blockid, merged, html);
    first.replaceWith(dv);
    for (var i = pEls.length - 1; i >= 1; i--) {
      if (pEls[i] && pEls[i].parentNode) pEls[i].remove();
    }
    return dv;
  }


  /* 单段落渲染：
   *  - 结果首元素是块级标签 → 换成块级预览 div（guards 为真时按失焦路径的规则跳过残缺语法）
   *  - 否则按内联处理：把 SPAN/MARK/DEL 设为不可编辑，并把 markdown 源码存进 mdtext
   * 返回 'block' | 'inline' | 'skip'，需要补空段落时通过 opts.ensureTrailing(div) 回调。 */
  var BLOCK_TAGS = { DIV: 1, HR: 1, ASIDE: 1, DETAILS: 1, BLOCKQUOTE: 1, TABLE: 1, PRE: 1, UL: 1, OL: 1 };

  function renderSingleParagraph(p, text, opts) {
    opts = opts || {};
    var html = renderMarkdownHtml(text);
    var temp = document.createElement('div');
    temp.innerHTML = html;
    var first = temp.firstElementChild;
    var tag = first && first.tagName;
    if (tag && BLOCK_TAGS[tag]) {
      if (opts.guards) {
        if (tag === 'BLOCKQUOTE') {
          var textAfter = text.replace(/^>\s*/, '');
          if (!textAfter || textAfter.length < 2) return 'skip';
        }
        if (tag === 'BLOCKQUOTE' || tag === 'DIV') {
          if (/^>\s*\[!/.test(text) && !/^>\s*\[!\w+\]/.test(text)) return 'skip';
        }
        if (tag === 'PRE' && (!text.replace(/```/g, '').trim() || text.trim() === '```')) return 'skip';
      }
      var div = makePreviewBlock(p.dataset.blockid, text, html);
      p.replaceWith(div);
      if (typeof opts.ensureTrailing === 'function') opts.ensureTrailing(div);
      return 'block';
    }
    var nodes = temp.childNodes;
    for (var ni = 0; ni < nodes.length; ni++) {
      if (nodes[ni].nodeType === 1 && (nodes[ni].tagName === 'SPAN' || nodes[ni].tagName === 'MARK' || nodes[ni].tagName === 'DEL')) {
        nodes[ni].contentEditable = 'false';
      }
    }
    p.dataset.mdtext = text;
    markInlinePreview(p);
    // marked.parse 对内联内容会包 <p>，取其子内容避免 p 嵌套 p
    if (temp.children.length === 1 && temp.children[0].tagName === 'P') {
      p.innerHTML = temp.children[0].innerHTML;
    } else {
      p.innerHTML = temp.innerHTML;
    }
    return 'inline';
  }

  function renderMarkdownHtml(text) {
    return w.renderMarkdownHtml(text);
  }

  w.MynoteMdBlocks = {
    isFenceLine: isFenceLine,
    isListLine: isListLine,
    collectFenceGroup: collectFenceGroup,
    collectListGroup: collectListGroup,
    range: range,
    markInlinePreview: markInlinePreview,
    makePreviewBlock: makePreviewBlock,
    renderSingleParagraph: renderSingleParagraph,
    replaceGroupWithPreview: replaceGroupWithPreview
  };
})(window);
