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
    var recordUndoTransaction = opts.recordUndoTransaction;
    var setEditorDocRef = opts.setEditorDocRef;
    var parseEditorDOM = opts.parseEditorDOM || (w.MynoteEditor && w.MynoteEditor.parseEditorDOM);
    var captureLayout = opts.captureLayout;
    var isComposingRef = opts.isComposingRef;
    var triggerAutoSave = opts.triggerAutoSave;
    var mdCheckTimerRef = opts.mdCheckTimerRef;
    var inputTimerRef = opts.inputTimerRef;
    var blurApplyingRef = opts.blurApplyingRef;
    var closedRef = opts.closedRef;
    var slashCommandDefs = opts.slashCommandDefs;

    const [showSlash, setShowSlash] = useState(false);
    const [slashClosing, setSlashClosing] = useState(false);
    const [slashEntered, setSlashEntered] = useState(false);
    var slashTokenRef = useRef(null);
    var slashSelectionSnapshotRef = useRef(null);
    const [pendingLinkCommand, setPendingLinkCommand] = useState(null);
    const [slashLinkUrl, setSlashLinkUrl] = useState('');
    const [slashLinkError, setSlashLinkError] = useState('');
    function restoreSavedSelection() {
      var saved = slashSelectionSnapshotRef.current;
      var body = editorBodyRef.current;
      if (!saved || !body) return false;
      var block = saved.blockId && Array.prototype.slice.call(body.querySelectorAll('[data-blockid]')).find(function (node) { return node.dataset.blockid === saved.blockId; });
      if (!block) return false;
      try {
        if (w.MynoteEditorColumns && typeof w.MynoteEditorColumns.focusEditingHost === 'function') {
          w.MynoteEditorColumns.focusEditingHost(body, block);
        } else if (typeof block.focus === 'function') block.focus({ preventScroll: true });
        var sel = w.getSelection();
        if (saved.range && block.contains(saved.range.startContainer) && block.contains(saved.range.endContainer) && sel) {
          sel.removeAllRanges();
          sel.addRange(saved.range.cloneRange());
          return true;
        }
        if (w.MynoteDom && typeof w.MynoteDom.focusEditableWithCaret === 'function') {
          return w.MynoteDom.focusEditableWithCaret(block, saved.focusOffset || 0);
        }
      } catch (_) {}
      return false;
    }
    var closeSlashPanel = useCallback(function (restoreCaret) {
      // Hide and clear synchronously: Enter immediately after a paste must not
      // apply the stale highlighted slash command during the exit animation.
      if (restoreCaret) restoreSavedSelection();
      setShowSlash(false);
      setSlashQuery('');
      setSlashTargetBlockId(null);
      slashTargetBlockRef.current = null;
      slashTokenRef.current = null;
      setSlashSelectedIndex(0);
      setPendingLinkCommand(null);
      setSlashLinkUrl('');
      setSlashLinkError('');
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
      var container = editorBodyRef.current;
      if (w.MynoteEditorColumns && typeof w.MynoteEditorColumns.focusEditingHost === 'function') {
        w.MynoteEditorColumns.focusEditingHost(container, target);
      } else if (typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
      }
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
    // 在独立滚动布局中，游离块的直接父级是列容器而不是 editor-body。
    var column = el.closest ? el.closest('.editor-column') : null;
    var limit = column || host;
    var orphan = el;
    while (orphan && orphan.parentNode !== limit) orphan = orphan.parentNode;
    if (column && (!orphan || orphan === column)) {
      orphan = w.document.createElement('p');
      orphan.innerHTML = '<br>';
      column.appendChild(orphan);
    }
    if (!orphan || orphan === limit || orphan.nodeType !== 1) return false;
    if (orphan.tagName !== 'P' && orphan.tagName !== 'DIV') return false;
    var newId = w.MynoteId.genId();
    orphan.dataset.blockid = newId;
    if (!orphan.innerHTML.trim()) orphan.innerHTML = '<br>';
    // 按 DOM 顺序重建 doc（可靠且幂等）
    if (typeof parseEditorDOM === 'function') {
      docRef.current = parseEditorDOM(host);
      if (typeof setEditorDocRef === 'function') setEditorDocRef(docRef.current);
    }
    return true;
  }

    var updateSlashStateFromSelection = useCallback(function () {
      if (slashApplyingRef.current) return;
      if (isComposingRef && isComposingRef.current) return;
      if (slashRef.current && slashRef.current.contains(w.document.activeElement)) return;
      clearTimeout(slashHideTimerRef.current);
      var sel = w.getSelection();
      if (!sel || !sel.rangeCount) {
        if (slashRef.current && slashRef.current.contains(w.document.activeElement)) return;
        // 延迟关闭：给点击斜杠面板留出时间触发 applySlashCommand
        slashHideTimerRef.current = setTimeout(function () {
          if (slashApplyingRef.current) return;
          setShowSlash(false);
          setSlashQuery('');
          setSlashTargetBlockId(null);
          slashTargetBlockRef.current = null;
          slashTokenRef.current = null;
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
      if (!blockEl || blockEl.contentEditable === 'false' || !editorBodyRef.current || !editorBodyRef.current.contains(blockEl)) {
        setShowSlash(false);
        setSlashQuery('');
        setSlashTargetBlockId(null);
        slashTargetBlockRef.current = null;
        slashTokenRef.current = null;
        return;
      }
      var text = blockEl.textContent || '';
      var caretOffset = 0;
      try {
        var range = sel.getRangeAt(0).cloneRange();
        // 用 Selection.focus 而非 Range.end：反向选区的焦点可能位于另一端。
        var mappedOffset = w.MynoteDom && w.MynoteDom.getTextOffsetWithin
          ? w.MynoteDom.getTextOffsetWithin(blockEl, sel.focusNode, sel.focusOffset)
          : null;
        if (mappedOffset !== null) caretOffset = mappedOffset;
        else {
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
        slashTokenRef.current = null;
        return;
      }
      var rawQuery = text.slice(slashPos + 1, caretOffset);
      if (rawQuery.length > 30 || /\s/.test(rawQuery)) {
        setShowSlash(false);
        setSlashQuery('');
        setSlashTargetBlockId(null);
        slashTargetBlockRef.current = null;
        slashTokenRef.current = null;
        return;
      }
      var selectionRange = null;
      var selectionStartOffset = caretOffset;
      var selectionEndOffset = caretOffset;
      try {
        selectionRange = sel.getRangeAt(0).cloneRange();
        var anchorOffset = w.MynoteDom && w.MynoteDom.getTextOffsetWithin
          ? w.MynoteDom.getTextOffsetWithin(blockEl, sel.anchorNode, sel.anchorOffset) : null;
        var focusOffset = w.MynoteDom && w.MynoteDom.getTextOffsetWithin
          ? w.MynoteDom.getTextOffsetWithin(blockEl, sel.focusNode, sel.focusOffset) : caretOffset;
        if (anchorOffset !== null && focusOffset !== null) {
          selectionStartOffset = Math.min(anchorOffset, focusOffset);
          selectionEndOffset = Math.max(anchorOffset, focusOffset);
        }
      } catch (_) {}
      slashTokenRef.current = {
        blockId: blockEl.dataset.blockid || null,
        startOffset: slashPos,
        endOffset: caretOffset,
        query: rawQuery
      };
      slashQueryRef.current = rawQuery;
      slashSelectionSnapshotRef.current = {
        blockId: blockEl.dataset.blockid || null,
        column: (blockEl.closest('.editor-column') && blockEl.closest('.editor-column').dataset.editorColumn) || null,
        range: selectionRange,
        startOffset: selectionStartOffset,
        endOffset: selectionEndOffset,
        focusOffset: caretOffset
      };
      setSlashQuery(rawQuery);
      setSlashTargetBlockId(blockEl.dataset.blockid || null);
      slashTargetBlockRef.current = blockEl;
      setShowSlash(true);
      var anchorRect = null;
      try {
        var caretRange = w.document.createRange();
        caretRange.setStart(sel.focusNode, sel.focusOffset);
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

    var applySlashCommand = useCallback(function (cmd, linkUrl) {
      if (!cmd || slashApplyingRef.current || isComposingRef && isComposingRef.current) return;
      if (cmd.type === 'inline_link' && linkUrl === undefined) {
        setPendingLinkCommand(cmd);
        setSlashLinkUrl('https://');
        setSlashLinkError('');
        return;
      }
      var safeLinkUrl = '';
      if (cmd.type === 'inline_link') {
        try {
          var parsedLink = new URL(String(linkUrl || '').trim());
          if (parsedLink.protocol !== 'http:' && parsedLink.protocol !== 'https:') throw new Error('unsupported protocol');
          safeLinkUrl = parsedLink.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
        } catch (_) {
          setSlashLinkError('请输入有效的 http 或 https 链接');
          return;
        }
      }
      // 命令会立刻解析并替换当前 DOM；取消斜杠前尚未执行的普通输入快照，
      // 否则该旧 timer 可能在命令事务之后把命令后的文档再推入撤销栈。
      if (inputTimerRef && inputTimerRef.current) {
        clearTimeout(inputTimerRef.current);
        inputTimerRef.current = null;
      }
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
      if (typeof parseEditorDOM === 'function') {
        docRef.current = parseEditorDOM(el);
        if (typeof setEditorDocRef === 'function') setEditorDocRef(docRef.current);
      }
      var beforeLayout = typeof captureLayout === 'function' ? captureLayout(docRef.current) : null;
      var beforeDoc = JSON.parse(JSON.stringify(docRef.current || []));
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
      if (!blkId || !el.contains(blockEl)) {
        slashApplyingRef.current = false;
        return;
      }
      var activeColumn = blockEl.closest('.editor-column');
      var activeColumnName = activeColumn && activeColumn.dataset.editorColumn || null;
      var doc = docRef.current;
      var idx = doc.findIndex(function (n) { return n.id === blkId; });
      if (idx === -1) {
        slashApplyingRef.current = false;
        return;
      }
      var text = blockEl.textContent || (doc[idx].children && doc[idx].children[0] ? doc[idx].children[0].text : '') || '';
      text = String(text || '');
      var expectedToken = '/' + (slashQueryRef.current || '');
      var tokenInfo = slashTokenRef.current;
      var tokenStart = -1;
      var tokenEnd = -1;
      if (tokenInfo && tokenInfo.blockId === blkId && tokenInfo.endOffset <= text.length && tokenInfo.startOffset >= 0 && text.slice(tokenInfo.startOffset, tokenInfo.endOffset) === expectedToken) {
        tokenStart = tokenInfo.startOffset;
        tokenEnd = tokenInfo.endOffset;
      } else {
        var liveSelection = w.getSelection();
        var liveCaret = -1;
        if (liveSelection && liveSelection.rangeCount && w.MynoteDom && w.MynoteDom.getTextOffsetWithin) {
          liveCaret = w.MynoteDom.getTextOffsetWithin(blockEl, liveSelection.focusNode, liveSelection.focusOffset);
        }
        if (liveCaret !== null && liveCaret >= expectedToken.length && text.slice(liveCaret - expectedToken.length, liveCaret) === expectedToken) {
          tokenStart = liveCaret - expectedToken.length;
          tokenEnd = liveCaret;
        }
      }
      // 仅剥离本次光标前的活动 token；没有可靠位置时保留正文，绝不误删同名字符串。
      var cleanedText = tokenStart >= 0 ? text.slice(0, tokenStart) + text.slice(tokenEnd) : text;
      var savedFocusOffset = slashSelectionSnapshotRef.current && typeof slashSelectionSnapshotRef.current.focusOffset === 'number'
        ? slashSelectionSnapshotRef.current.focusOffset : text.length;
      var commandCaretOffset = tokenStart >= 0 ? tokenStart : Math.min(text.length, savedFocusOffset);
      var beforeSelection = { blockId: blkId, column: activeColumnName, offset: tokenStart >= 0 ? tokenEnd : commandCaretOffset };
      var type = cmd.type;
      /* ---- 内联格式命令：包裹选中文字 ---- */
      if (type.startsWith('inline_')) {
        var pairs = {
          inline_bold: ['**', '**'],
          inline_italic: ['*', '*'],
          inline_link: ['[', '](' + safeLinkUrl + ')'],
          inline_code: ['`', '`'],
          inline_strike: ['~~', '~~'],
          inline_highlight: ['==', '==']
        };
        var pair = pairs[type] || ['', ''];
        var savedSelection = slashSelectionSnapshotRef.current;
        var selectionStart = savedSelection && savedSelection.blockId === blkId ? savedSelection.startOffset : commandCaretOffset;
        var selectionEnd = savedSelection && savedSelection.blockId === blkId ? savedSelection.endOffset : commandCaretOffset;
        if (tokenStart >= 0 && tokenEnd <= selectionStart) {
          selectionStart -= tokenEnd - tokenStart;
          selectionEnd -= tokenEnd - tokenStart;
        } else if (tokenStart >= 0 && tokenStart < selectionEnd && tokenEnd > selectionStart) {
          selectionStart = selectionEnd = commandCaretOffset;
        }
        var hasSelection = selectionEnd > selectionStart;
        var insertionOffset = Math.max(0, Math.min(cleanedText.length, commandCaretOffset));
        var sourceText = hasSelection ? cleanedText.slice(selectionStart, selectionEnd) : (type === 'inline_link' ? '链接文字' : '文字');
        var leadingSpace = (sourceText.match(/^\s+/) || [''])[0];
        var trailingSpace = (sourceText.match(/\s+$/) || [''])[0];
        if (leadingSpace.length === sourceText.length) trailingSpace = '';
        var coreText = sourceText.slice(leadingSpace.length, sourceText.length - trailingSpace.length);
        if (type === 'inline_link') coreText = coreText.replace(/([\\[\]])/g, '\\$1').replace(/[\r\n]+/g, ' ');
        var wrappedSelection = leadingSpace + pair[0] + coreText + pair[1] + trailingSpace;
        var wrappedText = hasSelection
          ? cleanedText.slice(0, selectionStart) + wrappedSelection + cleanedText.slice(selectionEnd)
          : cleanedText.slice(0, insertionOffset) + wrappedSelection + cleanedText.slice(insertionOffset);
        var inlineCaretOffset = hasSelection ? selectionStart + wrappedSelection.length : insertionOffset + wrappedSelection.length;
        var inlineBlock = { id: blkId, type: 'paragraph', children: [{ text: wrappedText }] };
        doc.splice(idx, 1, inlineBlock);
        docRef.current = doc;
        var inlineHtml = renderDocToEditorHTML([inlineBlock], files);
        var inlineTemplate = w.document.createElement('template');
        inlineTemplate.innerHTML = inlineHtml;
        blockEl.replaceWith(inlineTemplate.content.firstChild);
        if (typeof parseEditorDOM === 'function') docRef.current = parseEditorDOM(el);
        if (typeof setEditorDocRef === 'function') setEditorDocRef(docRef.current);
        var inlineAfterLayout = typeof captureLayout === 'function' ? captureLayout(docRef.current) : null;
        if (typeof recordUndoTransaction === 'function') {
          recordUndoTransaction(beforeDoc, docRef.current, beforeSelection, { blockId: blkId, column: activeColumnName, offset: inlineCaretOffset }, beforeLayout, inlineAfterLayout);
        } else if (typeof recordUndoPoint === 'function') recordUndoPoint();
        setShowSlash(false);
        setSlashQuery('');
        setSlashTargetBlockId(null);
        slashTargetBlockRef.current = null;
        slashTokenRef.current = null;
        setPendingLinkCommand(null);
        setSlashLinkUrl('');
        setSlashLinkError('');
        setSlashSelectedIndex(0);
        setSlashRecent(function (prev) {
          var n = [cmd.id].concat(prev.filter(function (id) { return id !== cmd.id; }));
          return n.slice(0, 6);
        });
        triggerAutoSave();
        w.requestAnimationFrame(function () {
          var focusTarget = Array.prototype.slice.call(el.querySelectorAll('[data-blockid]')).find(function (node) { return node.dataset.blockid === blkId; });
          if (focusTarget) {
            if (w.MynoteEditorColumns && typeof w.MynoteEditorColumns.focusEditingHost === 'function') w.MynoteEditorColumns.focusEditingHost(el, focusTarget);
            if (w.MynoteDom && typeof w.MynoteDom.focusEditableWithCaret === 'function') w.MynoteDom.focusEditableWithCaret(focusTarget, inlineCaretOffset);
            pinCaretIntoBlock(focusTarget, true);
            try { focusTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
          }
          slashApplyingRef.current = false;
        });
        setTimeout(function () {
          slashApplyingRef.current = false;
        }, 80);
        return;
      }
      var level = cmd.level || 1;
      // 这 4 类在插入时统一降级为普通段落。
      var forcedParagraph = type === 'code_block' || type === 'unordered_list' || type === 'ordered_list' || type === 'callout';
      var codeFence = '```';
      while (type === 'code_block' && cleanedText.indexOf(codeFence) >= 0) codeFence += '`';
      var codeSource = codeFence + '\n' + cleanedText + '\n' + codeFence;
      var listLines = (cleanedText || '列表项').split(/\r?\n/);
      var listSource = listLines.map(function (line, lineIndex) {
        return type === 'ordered_list' ? (lineIndex + 1) + '. ' + line : '- ' + line;
      }).join('\n');
      var calloutLines = (cleanedText || '提示内容').split(/\r?\n/);
      var calloutSource = '> [!NOTE]\n' + calloutLines.map(function (line) { return '> ' + line; }).join('\n');
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
        ...(type === 'code_block' ? { children: [{ text: codeSource }] } : {}),
        ...(type === 'unordered_list' || type === 'ordered_list' ? { children: [{ text: listSource }] } : {}),
        ...(type === 'callout' ? { children: [{ text: calloutSource }] } : {}),
        ...(type === 'imgTextCard' ? { children: [{ text: '点击输入文字' }], attrs: { fileId: '' } } : {}),
        ...(type === 'imageTextRow' ? { children: [{ text: '点击输入说明文字' }], attrs: { fileId: '' } } : {})
      };
      var needsTrailingParagraph = ['divider', 'musicCard', 'image', 'gallery', 'callout', 'imgTextCard', 'imageTextRow', 'todo'].includes(type);
      // 如果原块后面已经是空段落，不需要再加 trailing
      var nextBlock = doc[idx + 1];
      if (nextBlock && nextBlock.type === 'paragraph' && !(nextBlock.children && nextBlock.children[0] && nextBlock.children[0].text)) {
        needsTrailingParagraph = false;
      }
      var trailingBlock = needsTrailingParagraph ? { id: w.MynoteId.genId(), type: 'paragraph', children: [{ text: '' }] } : null;
      var replacementBlocks = trailingBlock ? [newBlock, trailingBlock] : [newBlock];
      doc.splice(idx, 1, ...replacementBlocks);
      docRef.current = doc;
      if (typeof setEditorDocRef === 'function') setEditorDocRef(doc);
      var html = renderDocToEditorHTML(replacementBlocks, files);
      var tpl = w.document.createElement('template');
      tpl.innerHTML = html;
      var insertedNodes = Array.from(tpl.content.childNodes);
      var existingTailParagraph = nextBlock && nextBlock.type === 'paragraph' && !(nextBlock.children && nextBlock.children[0] && nextBlock.children[0].text) ? nextBlock : null;
      var shouldFocusAfterBlock = ['divider', 'image', 'gallery', 'imgTextCard', 'imageTextRow'].includes(type);
      var insertedFocusId = trailingBlock ? trailingBlock.id : shouldFocusAfterBlock && existingTailParagraph ? existingTailParagraph.id : blkId;
      var insertedTarget = insertedNodes.find(function (n) {
        return n.nodeType === 1 && n.dataset && n.dataset.blockid === insertedFocusId;
      }) || null;
      blockEl.replaceWith(...insertedNodes);
      if (typeof parseEditorDOM === 'function') docRef.current = parseEditorDOM(el);
      if (typeof setEditorDocRef === 'function') setEditorDocRef(docRef.current);
      var afterLayout = typeof captureLayout === 'function' ? captureLayout(docRef.current) : null;
      var markdownPrefixLength = type === 'code_block' ? codeFence.length + 1
        : type === 'unordered_list' ? 2
        : type === 'ordered_list' ? String(1).length + 2
        : type === 'callout' ? '> [!NOTE]\n> '.length : 0;
      var targetOffset = type === 'musicCard' ? '粘贴音乐链接到这里...'.length : markdownPrefixLength + commandCaretOffset;
      var afterSelection = { blockId: insertedFocusId, column: activeColumnName, offset: insertedFocusId === blkId ? targetOffset : 0 };
      if (typeof recordUndoTransaction === 'function') {
        recordUndoTransaction(beforeDoc, docRef.current, beforeSelection, afterSelection, beforeLayout, afterLayout);
      } else if (typeof recordUndoPoint === 'function') recordUndoPoint();
      setShowSlash(false);
      setSlashQuery('');
      setSlashTargetBlockId(null);
      slashTargetBlockRef.current = null;
      slashTokenRef.current = null;
      setPendingLinkCommand(null);
      setSlashLinkUrl('');
      setSlashLinkError('');
      setSlashSelectedIndex(0);
      setSlashRecent(function (prev) {
        var next = [cmd.id, ...prev.filter(function (id) { return id !== cmd.id; })];
        return next.slice(0, 6);
      });
      w.requestAnimationFrame(function () {
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
          if (w.MynoteEditorColumns && typeof w.MynoteEditorColumns.focusEditingHost === 'function') w.MynoteEditorColumns.focusEditingHost(editorBodyRef.current, musicInput);
          else musicInput.focus();
        } else {
          var focusId = insertedFocusId;
          var target = insertedTarget && editorBodyRef.current && editorBodyRef.current.contains(insertedTarget) ? insertedTarget : editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + focusId + '"]');
          if (target) {
            if (w.MynoteEditorColumns && typeof w.MynoteEditorColumns.focusEditingHost === 'function') w.MynoteEditorColumns.focusEditingHost(editorBodyRef.current, target);
            if (w.MynoteDom && typeof w.MynoteDom.focusEditableWithCaret === 'function') w.MynoteDom.focusEditableWithCaret(target, insertedFocusId === blkId ? targetOffset : 0);
            pinCaretIntoBlock(target, true);
            try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
          } else if (editorBodyRef.current) {
            // 兜底：找不到目标块时新建段落聚焦，绝不把光标留在容器上
            var hostEl = editorBodyRef.current;
            var preferredHost = w.MynoteEditorColumns && w.MynoteEditorColumns.getPreferredEditingHost
              ? w.MynoteEditorColumns.getPreferredEditingHost(hostEl)
              : hostEl;
            var appendColumn = activeColumn && hostEl.contains(activeColumn) ? activeColumn : preferredHost || hostEl;
            var tailP = appendColumn.lastElementChild;
            if (!tailP || tailP.contentEditable === 'false' || tailP.tagName === 'HR' || !tailP.dataset || !tailP.dataset.blockid) {
              tailP = w.document.createElement('p');
              tailP.dataset.blockid = w.MynoteId.genId();
              tailP.innerHTML = '<br>';
              appendColumn.appendChild(tailP);
              docRef.current.push({ id: tailP.dataset.blockid, type: 'paragraph', children: [{ text: '' }] });
              setEditorDocRef(docRef.current);
            }
            focusEditableWithCaret(tailP, 0);
            pinCaretIntoBlock(tailP, true);
            if (typeof parseEditorDOM === 'function') docRef.current = parseEditorDOM(hostEl);
            if (typeof setEditorDocRef === 'function') setEditorDocRef(docRef.current);
          }
        }
        setTimeout(function () {
          slashApplyingRef.current = false;
        }, 80);
      });
      triggerAutoSave();
    }, [slashTargetBlockId, triggerAutoSave, files, recordUndoPoint, recordUndoTransaction, editorBodyRef, docRef, parseEditorDOM, setEditorDocRef, isComposingRef]);

    var submitSlashLink = useCallback(function (event) {
      if (event && event.preventDefault) event.preventDefault();
      if (pendingLinkCommand) applySlashCommand(pendingLinkCommand, slashLinkUrl);
    }, [pendingLinkCommand, slashLinkUrl, applySlashCommand]);
    var cancelSlashLink = useCallback(function () {
      setPendingLinkCommand(null);
      setSlashLinkUrl('');
      setSlashLinkError('');
      w.requestAnimationFrame(function () {
        var first = slashRef.current && slashRef.current.querySelector('[data-slash-command]');
        if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
      });
    }, []);

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
        closeSlashPanel(true);
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
      pendingLinkCommand: pendingLinkCommand,
      slashLinkUrl: slashLinkUrl,
      setSlashLinkUrl: setSlashLinkUrl,
      slashLinkError: slashLinkError,
      submitSlashLink: submitSlashLink,
      cancelSlashLink: cancelSlashLink,
      updateSlashStateFromSelection: updateSlashStateFromSelection,
      applySlashCommand: applySlashCommand,
      SVG_ICONS: w.MynoteSlashIcons || {}
    };
  }

  w.MynoteEditorHooks = w.MynoteEditorHooks || {};
  w.MynoteEditorHooks.useSlash = useSlash;
})(window);
