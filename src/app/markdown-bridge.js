/* Markdown 扩展语法桥接。 */
    // ===== Markdown 工具函数（来自 MynoteMd 模块） =====
    window.preprocessExtendedMarkdown = window.MynoteMd.preprocessExtendedMarkdown;
    window.looksLikeMarkdown = window.MynoteMd.looksLikeMarkdown;
    window.looksLikeCiaoMarkdown = window.MynoteMd.looksLikeCiaoMarkdown;
    window.stripMarkdownForPreview = window.MynoteMd.stripMarkdownForPreview;
    window.renderMarkdownHtml = window.MynoteMd.renderMarkdownHtml;
    window.shouldConvertPureUrlToCard = window.MynoteMd.shouldConvertPureUrlToCard;
    if (window.marked) {
        marked.setOptions({ breaks: true, gfm: true });
        var _origParse = marked.parse.bind(marked);
        marked.parse = function(src, opts) {
            if (!src) return '';
            return _origParse(preprocessExtendedMarkdown(src), opts);
        };
    }
