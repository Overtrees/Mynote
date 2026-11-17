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
        if (typeof marked.use === 'function') {
            marked.use({ hooks: { preprocess: function (src) { return preprocessExtendedMarkdown(src); } } });
            window.MynoteMd.setMarkdownParser(function (src, opts) {
                return src ? marked.parse(src, opts) : '';
            });
        } else {
            var _origParse = marked.parse.bind(marked);
            var _parseWithExtendedMarkdown = function(src, opts) {
                if (!src) return '';
                return _origParse(preprocessExtendedMarkdown(src), opts);
            };
            window.MynoteMd.setMarkdownParser(_parseWithExtendedMarkdown);
            marked.parse = _parseWithExtendedMarkdown;
        }
    }
