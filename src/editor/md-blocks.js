/* 编辑器内 Markdown 块级渲染的公共构件。
 * 三条渲染路径（首次加载、失焦、点击还原）原本各自复制了一套「识别组 → 合并 → 建块 → 删余行」，
 * 这里只抽出其中完全相同的部分，各路径的编排顺序与判断条件保持原样。 */
(function (w) {
  'use strict';

  var FENCE_RE = /^```/;
  var LIST_RE = /^[-*]\s|^\d+\.\s/;

  function isFenceLine(text) { return FENCE_RE.test(text); }
  function isListLine(text) { return LIST_RE.test(text); }

  /* 从 i 开始收集一个 ``` 围栏组：含「单段落里已含完整围栏 → 不再向下收集」的既有规则 */
  function collectFenceGroup(ps, i) {
    var texts = [(ps[i].textContent || '').trim()];
    var end = i + 1;
    if (texts[0].indexOf('```', 3) < 0) {
      while (end < ps.length) {
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
    while (end < ps.length) {
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

  /* 建立块级预览 div（contentEditable=false + mdtext 缓存） */
  function makePreviewBlock(blockId, merged, html) {
    var dv = document.createElement('div');
    dv.contentEditable = 'false';
    dv.className = 'md-preview block markdown-render';
    if (blockId != null) dv.dataset.blockid = blockId;
    dv.dataset.mdtext = merged;
    dv.innerHTML = html;
    return dv;
  }

  /* 用预览块替换组内首个段落，并删掉其余段落 */
  function replaceGroupWithPreview(pEls, merged, html) {
    var first = pEls[0];
    if (!first || !first.parentNode) return null;
    var dv = makePreviewBlock(first.dataset.blockid, merged, html);
    first.replaceWith(dv);
    for (var i = pEls.length - 1; i >= 1; i--) {
      if (pEls[i] && pEls[i].parentNode) pEls[i].remove();
    }
    return dv;
  }

  w.CikeMdBlocks = {
    isFenceLine: isFenceLine,
    isListLine: isListLine,
    collectFenceGroup: collectFenceGroup,
    collectListGroup: collectListGroup,
    range: range,
    makePreviewBlock: makePreviewBlock,
    replaceGroupWithPreview: replaceGroupWithPreview
  };
})(window);
