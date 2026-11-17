/* 斜杠命令子系统：状态、选区检测、面板定位、命令应用。从 Editor 主组件抽出。 */
(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef, useCallback = R.useCallback, useMemo = R.useMemo;

  function useSlash(opts) {
    var editorBodyRef = opts.editorBodyRef;
    var docRef = opts.docRef;
    var files = opts.files;
    var recordUndoPoint = opts.recordUndoPoint;
    var triggerAutoSave = opts.triggerAutoSave;
    var mdCheckTimerRef = opts.mdCheckTimerRef;
    var blurApplyingRef = opts.blurApplyingRef;
    var closedRef = opts.closedRef;
    var slashCommandDefs = opts.slashCommandDefs;

    const [showSlash, setShowSlash] = useState(false);
    const [slashClosing, setSlashClosing] = useState(false);
    const [slashEntered, setSlashEntered] = useState(false);
    var closeSlashPanel = useCallback(function () {
      // Hide and clear synchronously: Enter immediately after a paste must not
      // apply the stale highlighted slash command during the exit animation.
      setShowSlash(false);
      setSlashQuery('');
      setSlashTargetBlockId(null);
      slashTargetBlockRef.current = null;
      setSlashSelectedIndex(0);
      setSlashClosing(true);
      clearTimeout(slashHideTimerRef.current);
      slashHideTimerRef.current = setTimeout(function () {
        setSlashClosing(false);
        setSlashEntered(false);
      }, 150);
    }, []);
    const [slashQuery, setSlashQuery] = useState('');
    const slashQueryRef = useRef('');
    useEffect(function () { slashQueryRef.current = slashQuery; }, [slashQuery]);
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
    const [slashAnchor, setSlashAnchor] = useState({ left: 40, top: 140, width: 260 });
    const [slashTargetBlockId, setSlashTargetBlockId] = useState(null);
    var slashTargetBlockRef = useRef(null);
    useEffect(function () {
      if (showSlash) {
        var active = true;
        requestAnimationFrame(function () {
          if (active) setSlashEntered(true);
        });
        setTimeout(function () {
          if (active) setSlashEntered(true);
        }, 50);
        return function () { active = false; };
      } else {
        setSlashEntered(false);
      }
    }, [showSlash]);
    const [slashRecent, setSlashRecent] = useState(function () {
      try {
        var raw = w.localStorage.getItem('memos_slash_recent_v1');
        var parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
      } catch (_) {
        return [];
      }
    });
    var slashRef = useRef(null);
    var slashRepositionRafRef = useRef(null);
    var slashApplyingRef = useRef(false);
    var slashHideTimerRef = useRef(null);
    var suppressPointerClickRef = useRef(false);
    var pointerClickTimerRef = useRef(null);

    var slashCommands = useMemo(function () {
      return (w.MynoteSlashModel && w.MynoteSlashModel.filter
        ? w.MynoteSlashModel.filter
        : function (d, q, r) { return d.slice(); })(slashCommandDefs, slashQuery, slashRecent);
    }, [slashQuery, slashRecent, slashCommandDefs]);

    /** 焦点被浏览器抢到编辑器容器时，把选区钉回 [data-blockid] 块内（否则 / 检测永远失效） */
  function pinCaretIntoBlock(target, atEnd) {
    var selNow = w.getSelection();
    if (!selNow || !selNow.rangeCount || !target || !target.parentNode) return;
    var anchor = selNow.focusNode;
    var anchorEl = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    if (!anchorEl || (anchorEl.closest && anchorEl.closest('[data-blockid]'))) return;
    console.warn('[pin] caret outside block, re-pinning', target && target.dataset && target.dataset.blockid, anchorEl.tagName);
    try {
      if (typeof target.focus === 'function') { try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); } }
      if (target.firstChild && target.firstChild.nodeType !== 3) target.innerHTML = '<br>';
      var rr = w.document.createRange();
      var node = (target.firstChild && target.firstChild.nodeType === 3) ? target.firstChild : target;
      rr.selectNodeContents(node);
      rr.collapse(!atEnd);
      selNow.removeAllRanges();
      selNow.addRange(rr);
    } catch (_) {}
  }

  /** 游离块自救：光标落在无 blockid 的裸 div/p 上时，给它补 id 并注册进 docRef（防 / 检测永久失效） */
  function rescueOrphanCaret() {
    var sel = w.getSelection();
    if (!sel || !sel.rangeCount) return false;
    var anchor = sel.focusNode;
    var el = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    if (!el) return false;
    var host = editorBodyRef.current;
    if (!host || !host.contains(el)) return false;
    var block = el.closest ? el.closest('[data-blockid]') : null;
    if (block) return false;
    // 找最近的游离容器（editor-body 的直接子节点）
    var orphan = el;
    while (orphan && orphan.parentNode !== host) orphan = orphan.parentNode;
    if (!orphan || orphan === host || orphan.nodeType !== 1) return false;
    if (orphan.tagName !== 'P' && orphan.tagName !== 'DIV') return false;
    var newId = w.MynoteId.genId();
    orphan.dataset.blockid = newId;
    if (!orphan.innerHTML.trim()) orphan.innerHTML = '<br>';
    // 按 DOM 顺序重建 doc（可靠且幂等）
    docRef.current = parseEditorDOM(host);
    setEditorDocRef(docRef.current);
    return true;
  }

  var updateSlashStateFromSelection = useCallback(function () {
      if (slashApplyingRef.current) return;
      clearTimeout(slashHideTimerRef.current);
      var sel = w.getSelection();
      if (!sel || !sel.rangeCount) {
        // 延迟关闭：给点击斜杠面板留出时间触发 applySlashCommand
        slashHideTimerRef.current = setTimeout(function () {
          if (slashApplyingRef.current) return;
          setShowSlash(false);
        }, 150);
        return;
      }
      var focusNode = sel.focusNode;
      var baseEl = focusNode ? focusNode.nodeType === 1 ? focusNode : focusNode.parentElement : null;
      // URLs pasted into the music-card editor contain slashes, but are never slash commands.
      if (baseEl && baseEl.closest && baseEl.closest('[data-music-url="pending"]')) {
        setShowSlash(false);
        setSlashQuery('');
        setSlashTargetBlockId(null);
        slashTargetBlockRef.current = null;
        return;
      }
      var rescued = rescueOrphanCaret();
      var blockEl = baseEl && baseEl.closest ? baseEl.closest('[data-blockid]') : null;
      if (rescued && !blockEl && baseEl) {
        // rescue 可能刚给光标所在游离块补了 id，重取 closest
        blockEl = baseEl.closest ? baseEl.closest('[data-blockid]') : null;
      }
      if (!blockEl || blockEl.contentEditable === 'false') {
        setShowSlash(false);
        setSlashTargetBlockId(null);
        slashTargetBlockRef.current = null;
        return;
      }
      var text = blockEl.textContent || '';
      var caretOffset = 0;
      try {
        var range = sel.getRangeAt(0).cloneRange();
        // 如果 focusNode 是元素节点（非文本），说明光标在块级边界上
        // 需要把偏移量转换为相对于 blockEl 的文本偏移
        if (range.endContainer.nodeType === 1 && range.endContainer !== blockEl) {
          var children = [...blockEl.childNodes];
          var offset = range.endOffset;
          var textBefore = 0;
          for (var ci = 0; ci < offset && ci < children.length; ci++) {
            textBefore += (children[ci].textContent || '').length;
          }
          caretOffset = textBefore;
        } else if (range.endContainer.nodeType === 1 && range.endContainer === blockEl) {
          var children2 = [...blockEl.childNodes];
          var offset2 = range.endOffset;
          var textBefore2 = 0;
          for (var ci2 = 0; ci2 < offset2 && ci2 < children2.length; ci2++) {
            textBefore2 += (children2[ci2].textContent || '').length;
          }
          caretOffset = textBefore2;
        } else {
          var preRange = range.cloneRange();
          preRange.selectNodeContents(blockEl);
          preRange.setEnd(range.endContainer, range.endOffset);
          caretOffset = preRange.toString().length;
        }
      } catch (_) {
        caretOffset = 0;
      }
      var slashPos = text.lastIndexOf('/', Math.min(caretOffset - 1, text.length - 1));
      // URL path slashes are text, but keep slash commands usable mid-sentence.
      var beforeSlash = slashPos >= 0 ? text.slice(0, slashPos + 1) : '';
      var slashTokenMatch = beforeSlash.match(/\S+$/);
      var slashToken = slashTokenMatch ? slashTokenMatch[0].replace(/^[([{<\"'“‘]+/, '') : '';
      if (/^(?:https?:\/\/|www\.)\S*$/i.test(slashToken)) slashPos = -1;
      if (slashPos < 0 || slashPos >= caretOffset) {
        setShowSlash(false);
        setSlashQuery('');
        setSlashTargetBlockId(null);
        slashTargetBlockRef.current = null;
        return;
      }
      var rawQuery = text.slice(slashPos + 1, caretOffset);
      if (rawQuery.length > 30 || /\s/.test(rawQuery)) {
        setShowSlash(false);
        setSlashTargetBlockId(null);
        slashTargetBlockRef.current = null;
        return;
      }
      setSlashQuery(rawQuery);
      setSlashTargetBlockId(blockEl.dataset.blockid || null);
      slashTargetBlockRef.current = blockEl;
      setShowSlash(true);
      var anchorRect = null;
      try {
        var caretRange = sel.getRangeAt(0).cloneRange();
        caretRange.collapse(true);
        var rects = caretRange.getClientRects();
        anchorRect = rects && rects.length > 0 ? rects[0] : caretRange.getBoundingClientRect();
        if (!anchorRect || !anchorRect.left && !anchorRect.top && !anchorRect.right && !anchorRect.bottom) {
          var marker = w.document.createElement('span');
          marker.textContent = '\u200b';
          marker.style.cssText = 'display:inline-block;width:1px;height:1em;line-height:1;overflow:hidden;pointer-events:none;';
          caretRange.insertNode(marker);
          anchorRect = marker.getBoundingClientRect();
          marker.parentNode && marker.parentNode.removeChild(marker);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (_) {
        anchorRect = null;
      }
      if (!anchorRect || !anchorRect.left && !anchorRect.top && !anchorRect.right && !anchorRect.bottom) {
        anchorRect = blockEl.getBoundingClientRect();
      }
      var viewport = w.visualViewport;
      var viewportLeft = viewport ? viewport.offsetLeft : 0;
      var viewportTop = viewport ? viewport.offsetTop : 0;
      var viewportWidth = viewport ? viewport.width : w.innerWidth;
      var viewportHeight = viewport ? viewport.height : w.innerHeight;
      var maxContentW = 240;
      for (var _i = 0; _i < slashCommandDefs.length; _i++) {
        var _c = slashCommandDefs[_i];
        var titleW = (_c.title || '').length * 16;
        var shortW = (_c.shortcut || '').length * 8;
        var rowW = 24 + 10 + titleW + (shortW > 0 ? 8 + shortW : 0) + 22;
        var withGroupPad = _c.group ? rowW + 20 : rowW;
        if (withGroupPad > maxContentW) maxContentW = withGroupPad;
      }
      var panelWidth = Math.min(360, Math.max(220, maxContentW + 12, viewportWidth - 24));
      var left = Math.max(viewportLeft + 12, Math.min(viewportLeft + viewportWidth - panelWidth - 12, anchorRect.left - 8));
      var panelHeight = 260;
      var top = anchorRect.bottom + 10;
      if (top + panelHeight > viewportTop + viewportHeight - 8) {
        top = Math.max(viewportTop + 76, anchorRect.top - panelHeight - 10);
      }
      setSlashAnchor(function (prev) {
        return Math.abs(prev.left - left) < 1 && Math.abs(prev.top - top) < 1 && Math.abs(prev.width - panelWidth) < 1 ? prev : { left: left, top: top, width: panelWidth };
      });
    }, [slashCommandDefs]);

    var applySlashCommand = useCallback(function (cmd) {
      recordUndoPoint();
      if (!cmd || slashApplyingRef.current) return;
      slashApplyingRef.current = true;
      clearTimeout(slashHideTimerRef.current);
      if (slashRepositionRafRef.current) {
        cancelAnimationFrame(slashRepositionRafRef.current);
        slashRepositionRafRef.current = null;
      }
      var el = editorBodyRef.current;
      if (!el) {
        slashApplyingRef.current = false;
        return;
      }
      var blockEl = slashTargetBlockRef.current && el.contains(slashTargetBlockRef.current) ? slashTargetBlockRef.current : null;
      if (!blockEl && slashTargetBlockId) blockEl = el.querySelector('[data-blockid="' + slashTargetBlockId + '"]');
      if (!blockEl) {
        var sel = w.getSelection();
        var focusNode = sel && sel.rangeCount ? sel.focusNode : null;
        var baseEl = focusNode ? focusNode.nodeType === 1 ? focusNode : focusNode.parentElement : null;
        blockEl = baseEl && baseEl.closest ? baseEl.closest('[data-blockid]') : null;
      }
      if (!blockEl) {
        slashApplyingRef.current = false;
        return;
      }
      var blkId = blockEl.dataset.blockid;
      var doc = docRef.current;
      var idx = doc.findIndex(function (n) { return n.id === blkId; });
      if (idx === -1) {
        slashApplyingRef.current = false;
        return;
      }
      var text = blockEl.textContent || (doc[idx].children && doc[idx].children[0] ? doc[idx].children[0].text : '') || '';
      var slashQueryLen = (slashQueryRef.current || '').length;
      // 行首 /cmd 与句中 /cmd 都要剥掉，否则“hello /p”转段落后还带着命令词
      var cleanedText = String(text || '');
      var cmdToken = '/' + (slashQueryRef.current || '');
      var cmdPos = cleanedText.indexOf(cmdToken);
      if (cmdPos >= 0) {
        cleanedText = cleanedText.slice(0, cmdPos) + cleanedText.slice(cmdPos + cmdToken.length);
      } else {
        cleanedText = cleanedText.replace(/^\/(?:[^\s]*)?/, function (match) {
          if (slashQueryLen === 0 && match.length === 1) return '';
          return match.length === slashQueryLen + 1 ? '' : match.slice(slashQueryLen + 1);
        });
      }
      cleanedText = cleanedText.replace(/^\s+/, '');
      var type = cmd.type;
      /* ---- 内联格式命令：包裹选中文字 ---- */
      if (type.startsWith('inline_')) {
        var selInline = w.getSelection();
        var selectedText = '';
        if (selInline && selInline.rangeCount > 0) {
          selectedText = selInline.toString().trim();
        }
        var inlineText = selectedText || cleanedText || '文字';
        var INLINE_MAP = {
          inline_bold: ['**', '**'],
          inline_italic: ['*', '*'],
          inline_link: ['[', '](url)'],
          inline_code: ['`', '`'],
          inline_strike: ['~~', '~~'],
          inline_highlight: ['==', '=='],
          inline_tip: ['!!', ''],
          inline_question: ['??', ''],
          inline_mention: ['@@', ''],
          inline_hashtag: ['#', ''],
          inline_centered: ['->', '<-'],
          inline_tag: ['$', '$']
        };
        var pair = INLINE_MAP[type] || ['', ''];
        var wrappedText = pair[0] + inlineText + pair[1];
        if (selectedText && selInline && selInline.rangeCount) {
          var range2 = selInline.getRangeAt(0);
          range2.deleteContents();
          range2.insertNode(w.document.createTextNode(wrappedText));
          try {
            range2.setStartAfter(range2.endContainer);
            selInline.removeAllRanges();
            selInline.addRange(range2);
          } catch (_) {}
        } else {
          doc.splice(idx, 1, {
            id: blkId,
            type: 'paragraph',
            children: [{ text: wrappedText }]
          });
          setEditorDocRef(docRef.current);
          blockEl.outerHTML = renderDocToEditorHTML([{ id: blkId, type: 'paragraph', children: [{ text: wrappedText }] }], files);
          var focusTarget = editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + blkId + '"]');
          if (focusTarget) {
            focusEditableWithCaret(focusTarget, wrappedText.length);
            pinCaretIntoBlock(focusTarget, true);
          }
        }
        setEditorDocRef(docRef.current);
        docRef.current = parseEditorDOM(editorBodyRef.current);
        setShowSlash(false);
        setSlashQuery('');
        setSlashTargetBlockId(null);
        slashTargetBlockRef.current = null;
        setSlashSelectedIndex(0);
        setSlashRecent(function (prev) {
          var n = [cmd.id].concat(prev.filter(function (id) { return id !== cmd.id; }));
          return n.slice(0, 6);
        });
        triggerAutoSave();
        if (type && type.startsWith('inline_')) {
          clearTimeout(mdCheckTimerRef.current);
          mdCheckTimerRef.current = setTimeout(function () {
            if (blurApplyingRef.current || closedRef.current) return;
            blurApplyingRef.current = true;
            var _el = editorBodyRef.current;
            if (!_el) { blurApplyingRef.current = false; return; }
            var _ps = _el.querySelectorAll('p');
            if (!_ps.length) { blurApplyingRef.current = false; return; }
            for (var pi = 0; pi < _ps.length; pi++) {
              var p = _ps[pi];
              var txt = p.innerText || '';
              if (!txt) continue;
              var html = renderMarkdownHtml(txt);
              if (html !== txt) { p.dataset.mdtext = txt; p.innerHTML = html; }
            }
            blurApplyingRef.current = false;
          }, 50);
        }
        setTimeout(function () {
          slashApplyingRef.current = false;
        }, 80);
        return;
      }
      var level = cmd.level || 1;
      // 这 5 类在插入时统一降级为普通段落：在构造时就定值，避免“先写再覆盖”的死值
      var forcedParagraph = type === 'code_block' || type === 'unordered_list' || type === 'ordered_list' || type === 'decorative_divider' || type === 'callout';
      var newBlock = {
        id: blkId,
        type: forcedParagraph ? 'paragraph' : type,
        ...(type === 'paragraph' ? { children: [{ text: cleanedText }] } : {}),
        ...(type === 'heading' ? { children: [{ text: cleanedText }], attrs: { level: level } } : {}),
        ...(type === 'quote' ? { children: [{ text: cleanedText }] } : {}),
        ...(type === 'todo' ? { children: [{ text: cleanedText }], attrs: { checked: false } } : {}),
        ...(type === 'musicCard' ? { url: '', meta: null, status: 'input' } : {}),
        ...(type === 'image' ? { attrs: { fileId: '' } } : {}),
        ...(type === 'gallery' ? { attrs: { items: [] } } : {}),
        ...(type === 'code_block' ? { children: [{ text: '```\n' + cleanedText + '\n```' }] } : {}),
        ...(type === 'unordered_list' ? { children: [{ text: '- ' + (cleanedText || '列表项') }] } : {}),
        ...(type === 'ordered_list' ? { children: [{ text: '1. ' + (cleanedText || '列表项') }] } : {}),
        ...(type === 'decorative_divider' ? { children: [{ text: '---🌟---' }] } : {}),
        ...(type === 'callout' ? { children: [{ text: '> [!NOTE]\n> 提示内容' }] } : {}),
        ...(type === 'imgTextCard' ? { children: [{ text: '点击输入文字' }], attrs: { imgUrl: '' } } : {}),
        ...(type === 'imageTextRow' ? { children: [{ text: '点击输入说明文字' }], attrs: { imgUrl: '' } } : {})
      };
      if (type === 'callout') {
        newBlock.children[0].text = cleanedText || newBlock.children[0].text;
      }
      var needsTrailingParagraph = ['divider', 'musicCard', 'image', 'gallery', 'decorative_divider', 'callout', 'imgTextCard', 'imageTextRow', 'todo'].includes(type);
      // 如果原块后面已经是空段落，不需要再加 trailing
      var nextBlock = doc[idx + 1];
      if (nextBlock && nextBlock.type === 'paragraph' && !(nextBlock.children && nextBlock.children[0] && nextBlock.children[0].text)) {
        needsTrailingParagraph = false;
      }
      var trailingBlock = needsTrailingParagraph ? { id: w.MynoteId.genId(), type: 'paragraph', children: [{ text: '' }] } : null;
      var replacementBlocks = trailingBlock ? [newBlock, trailingBlock] : [newBlock];
      doc.splice(idx, 1, ...replacementBlocks);
      setEditorDocRef(docRef.current);
      var html = renderDocToEditorHTML(replacementBlocks, files);
      var tpl = w.document.createElement('template');
      tpl.innerHTML = html;
      var insertedNodes = Array.from(tpl.content.childNodes);
      var insertedFocusId = trailingBlock ? trailingBlock.id : blkId;
      var insertedTarget = insertedNodes.find(function (n) {
        return n.nodeType === 1 && n.dataset && n.dataset.blockid === insertedFocusId;
      }) || null;
      blockEl.replaceWith(...insertedNodes);
      setShowSlash(false);
      setSlashQuery('');
      setSlashTargetBlockId(null);
      slashTargetBlockRef.current = null;
      setSlashSelectedIndex(0);
      setSlashRecent(function (prev) {
        var next = [cmd.id, ...prev.filter(function (id) { return id !== cmd.id; })];
        return next.slice(0, 6);
      });
      requestAnimationFrame(function () {
        // musicCard input 态：聚焦输入框，光标放到文本末尾
        var musicInput = editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + newBlock.id + '"][data-music-url="pending"]');
        if (musicInput && type === 'musicCard') {
          if (editorBodyRef.current) editorBodyRef.current.dataset.activeMusicInputId = newBlock.id;
          var tn = musicInput.firstChild;
          if (tn && tn.nodeType === 3) {
            var r2 = w.document.createRange();
            r2.setStart(tn, tn.textContent.length);
            r2.collapse(true);
            var s2 = w.getSelection();
            s2.removeAllRanges();
            s2.addRange(r2);
          }
          musicInput.focus();
        } else {
          var focusId = trailingBlock ? trailingBlock.id : blkId;
          var target = insertedTarget && editorBodyRef.current && editorBodyRef.current.contains(insertedTarget) ? insertedTarget : editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + focusId + '"]');
          if (target) {
            focusEditableWithCaret(target, trailingBlock ? 0 : cleanedText.length);
            pinCaretIntoBlock(target, !trailingBlock && !cleanedText.length ? false : true);
            try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
          } else if (editorBodyRef.current) {
            // 兜底：找不到目标块时新建段落聚焦，绝不把光标留在容器上
            var hostEl = editorBodyRef.current;
            var tailP = hostEl.lastElementChild;
            if (!tailP || tailP.contentEditable === 'false' || tailP.tagName === 'HR' || !tailP.dataset || !tailP.dataset.blockid) {
              tailP = w.document.createElement('p');
              tailP.dataset.blockid = w.MynoteId.genId();
              tailP.innerHTML = '<br>';
              hostEl.appendChild(tailP);
              docRef.current.push({ id: tailP.dataset.blockid, type: 'paragraph', children: [{ text: '' }] });
              setEditorDocRef(docRef.current);
            }
            focusEditableWithCaret(tailP, 0);
            pinCaretIntoBlock(tailP, true);
          }
        }
        setTimeout(function () {
          slashApplyingRef.current = false;
        }, 80);
      });
      triggerAutoSave();
      // 初始化 todo 圆点图片：replaceWith 插入的 <img data:image> 可能未立即渲染
      if (type === 'todo') {
        requestAnimationFrame(function () {
          var todoImg = editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + blkId + '"] .todo-checkbox img');
          if (todoImg && todoImg.complete === false) {
            var src = todoImg.src;
            todoImg.src = src;
          }
        });
      }
    }, [slashTargetBlockId, triggerAutoSave, files, recordUndoPoint, editorBodyRef, docRef]);

    // 最近使用持久化
    useEffect(function () {
      try { w.localStorage.setItem('memos_slash_recent_v1', JSON.stringify(slashRecent)); } catch (_) {}
    }, [slashRecent]);

    // 面板打开期间的全局监听（点外关闭 / 滚动重定位）
    useEffect(function () {
      if (!showSlash) return;
      if (slashApplyingRef.current) return;
      var requestReposition = function () {
        if (slashRepositionRafRef.current) return;
        slashRepositionRafRef.current = requestAnimationFrame(function () {
          slashRepositionRafRef.current = null;
          updateSlashStateFromSelection();
        });
      };
      var onPointerDown = function (e) {
        if (slashRef.current && slashRef.current.contains(e.target)) return;
        closeSlashPanel();
      };
      var onScroll = function () { requestReposition(); };
      var onResize = function () { requestReposition(); };
      var onSelectionChange = function () { requestReposition(); };
      w.document.addEventListener('pointerdown', onPointerDown);
      w.document.addEventListener('selectionchange', onSelectionChange);
      w.addEventListener('scroll', onScroll, { passive: true });
      w.addEventListener('resize', onResize);
      if (w.visualViewport) {
        w.visualViewport.addEventListener('scroll', onScroll);
        w.visualViewport.addEventListener('resize', onResize);
      }
      return function () {
        w.document.removeEventListener('pointerdown', onPointerDown);
        w.document.removeEventListener('selectionchange', onSelectionChange);
        w.removeEventListener('scroll', onScroll);
        w.removeEventListener('resize', onResize);
        if (w.visualViewport) {
          w.visualViewport.removeEventListener('scroll', onScroll);
          w.visualViewport.removeEventListener('resize', onResize);
        }
        if (slashRepositionRafRef.current) {
          cancelAnimationFrame(slashRepositionRafRef.current);
          slashRepositionRafRef.current = null;
        }
      };
    }, [showSlash, updateSlashStateFromSelection, closeSlashPanel]);

    // 查询/开关变化时重置选中项
    useEffect(function () {
      setSlashSelectedIndex(0);
    }, [slashQuery, showSlash]);

    return {
      showSlash: showSlash,
      slashClosing: slashClosing,
      slashEntered: slashEntered,
      closeSlashPanel: closeSlashPanel,
      slashQuery: slashQuery,
      setSlashQuery: setSlashQuery,
      slashQueryRef: slashQueryRef,
      slashSelectedIndex: slashSelectedIndex,
      setSlashSelectedIndex: setSlashSelectedIndex,
      slashAnchor: slashAnchor,
      slashTargetBlockRef: slashTargetBlockRef,
      slashRef: slashRef,
      slashApplyingRef: slashApplyingRef,
      slashHideTimerRef: slashHideTimerRef,
      suppressPointerClickRef: suppressPointerClickRef,
      pointerClickTimerRef: pointerClickTimerRef,
      slashRepositionRafRef: slashRepositionRafRef,
      slashCommands: slashCommands,
      slashRecent: slashRecent,
      setSlashRecent: setSlashRecent,
      updateSlashStateFromSelection: updateSlashStateFromSelection,
      applySlashCommand: applySlashCommand,
      SVG_ICONS: w.MynoteSlashIcons || {}
    };
  }

  w.MynoteEditorHooks = w.MynoteEditorHooks || {};
  w.MynoteEditorHooks.useSlash = useSlash;
})(window);
