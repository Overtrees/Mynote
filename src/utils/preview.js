(function (w) {
  'use strict';

  /*
   * 列表预览摘要（SwipeRow / ImageCard 共用）
   * ------------------------------------------------------------------
   * 重构前：SwipeRow 与 ImageCard 各自维护一份「段落拼接 → 去 Markdown →
   * 去标签 → 截断」的实现，唯一差异是截断长度（80 / 60）与是否统计附件数。
   * 本模块把它们收敛为同一份逻辑，长度作为参数传入，保证输出逐字一致。
   */

  var EMPTY_PREVIEW = '\u65E0\u66F4\u591A\u6587\u672C';
  var TAG_RE = /#[\u4e00-\u9fa5\w-]+/g;
  var DEFAULT_MAX_LEN = 80;

  function stripTagTokens(text) {
    return String(text == null ? '' : text).replace(TAG_RE, '').trim();
  }

  /**
   * @param {Array} doc     备忘录 doc 节点数组
   * @param {number} maxLen 预览截断长度（SwipeRow=80，ImageCard=60）
   * @returns {{preview: string, tags: string[], attachCount: number}}
   */
  function summarizeMemoDoc(doc, maxLen) {
    var limit = typeof maxLen === 'number' && maxLen > 0 ? maxLen : DEFAULT_MAX_LEN;
    var result = { preview: EMPTY_PREVIEW, tags: [], attachCount: 0 };
    if (!doc || typeof doc.length !== 'number') return result;

    var paras = [];
    var tags = [];
    var attachCount = 0;

    for (var i = 0; i < doc.length; i++) {
      var node = doc[i];
      if (!node) continue;
      if (node.type === 'paragraph' && node.children && node.children[0]) {
        var text = (node.children[0].text || '').trim();
        if (text) {
          paras.push(text);
          var matched = text.match(TAG_RE);
          if (matched) {
            for (var j = 0; j < matched.length; j++) {
              if (tags.indexOf(matched[j]) === -1) tags.push(matched[j]);
            }
          }
        }
      }
      if (node.type === 'attachment') attachCount++;
    }

    result.attachCount = attachCount;
    if (paras.length === 0) return result;

    tags = tags.slice(0, 3);
    result.tags = tags;

    var joined = paras.join(' ');
    var stripped = typeof w.stripMarkdownForPreview === 'function'
      ? w.stripMarkdownForPreview(joined)
      : joined;
    stripped = stripTagTokens(stripped).slice(0, limit);

    result.preview = stripped || (tags.length > 0 ? tags[0].replace(/^#/, '') : EMPTY_PREVIEW);
    return result;
  }

  w.CikePreview = {
    EMPTY_PREVIEW: EMPTY_PREVIEW,
    summarizeMemoDoc: summarizeMemoDoc
  };
})(window);
