/* Editor 主组件：输入、块操作、附件、渲染与持久化。 */
function Editor({
  memo,
  onClose,
  onSave,
  autoFocus = false
}) {
  const [closing, setClosing] = useState(false);
// 模块化依赖导出
  const [animDone, setAnimDone] = useState(false);
  useEffect(() => {
    if (closing) return;
    const t = setTimeout(() => setAnimDone(true), 330);
    return () => clearTimeout(t);
  }, [closing]);
  const [title, setTitle] = useState(memo.title === "无标题" ? "" : memo.title);
  const [autoRenderMap, setAutoRenderMap] = useState({});
  const [editorScrolled, setEditorScrolled] = useState(() => window.scrollY > 30);
  const [editingTitle, setEditingTitle] = useState(null); // 编辑中的实时标题，null=非编辑态
  // 编辑期间冻结样式快照，防止字数跨越阈值时 DOM 重建导致光标丢失
  var editingStyleSnapshot = useRef(null);
  var overflowContainerRef = useRef(null); // 溢出容器 ref，用于光标跟随滚动
  const initialDoc = memo.doc || [{
    id: genId(),
    type: "paragraph",
    children: [{
      text: ""
    }]
  }];
  var docRef = useRef(initialDoc);
  const [renderKey, setRenderKey] = useState(0);
  const [files, setFiles] = useState({});
  // 供 useCallback 闭包读取最新附件表（避免把 files 塞进依赖导致整页重建）
  const filesRef = useRef({});
  useEffect(() => { filesRef.current = files; }, [files]);

  // 初始加载时自动渲染含 MD 语法的段落，并恢复草稿
  useEffect(() => {
    let cancelled = false;
    // 恢复草稿
    DraftStore.load(memo.id).then(draft => {
      if (cancelled) return;
      if (draft && draft.doc && draft.doc.length > 0 && draft.updatedAt) {
        const memoDate = new Date(memo.updatedAt || 0).getTime();
        const draftDate = new Date(draft.updatedAt).getTime();
        // 仅当草稿比 memo 更新时恢复
        if (draftDate > memoDate) {
          docRef.current = draft.doc;
          setEditorDocRef(draft.doc);
          setRenderKey(prev => prev + 1);
          // 同步 DOM：草稿恢复时 editor-body 可能已被 innerHTML 初始化
          // 手动更新 DOM 防止 docRef 与 DOM 脱节
          var el = editorBodyRef.current;
          if (el && domInited.current) {
            el.innerHTML = renderDocToEditorHTML(draft.doc, files);
          }
        }
      }
    }).catch(function(e) { if (!cancelled) console.warn('[此刻] draft load', e); });
    const map = {};
    for (const node of docRef.current || initialDoc) {
      if (node.type === "paragraph") {
        const text = node.children[0] && node.children[0].text || "";
        if (looksLikeCiaoMarkdown(text)) {
          map[node.id] = true;
        }
      }
    }
    if (Object.keys(map).length > 0) {
      setAutoRenderMap(map);
    }
    return () => { cancelled = true; };
  }, [memo.id]);
  const [showMenu, setShowMenu] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  var menuCloseTimerRef = useRef(null);
  var openEditorMenu = useCallback(function () {
    clearTimeout(menuCloseTimerRef.current);
    setMenuClosing(true);
    setShowMenu(true);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        setMenuClosing(false);
      });
    });
  }, []);
  var closeEditorMenu = useCallback(function () {
    clearTimeout(menuCloseTimerRef.current);
    setMenuClosing(true);
    menuCloseTimerRef.current = setTimeout(function () {
      setShowMenu(false);
      setMenuClosing(false);
    }, 220);
  }, []);
  var toggleEditorMenu = useCallback(function () {
    if (showMenu && !menuClosing) closeEditorMenu();else openEditorMenu();
  }, [showMenu, menuClosing, closeEditorMenu, openEditorMenu]);
  useEffect(() => {
    return () => clearTimeout(menuCloseTimerRef.current);
  }, []);
  useEffect(() => {
    if (!showMenu) return;
    const closeMenu = () => closeEditorMenu();
    window.addEventListener('scroll', closeMenu, {
      passive: true
    });
    return () => window.removeEventListener('scroll', closeMenu);
  }, [showMenu, closeEditorMenu]);
  /* ---------- 斜杠命令 ---------- */
  const [showSlash, setShowSlash] = useState(false);
  const [slashClosing, setSlashClosing] = useState(false);
  const [slashEntered, setSlashEntered] = useState(false);
  var closeSlashPanel = useCallback(function () {
    setSlashClosing(true);
    setTimeout(function () {
      setShowSlash(false);
      setSlashClosing(false);
      setSlashEntered(false);
      setSlashQuery('');
      setSlashTargetBlockId(null);
      slashTargetBlockRef.current = null;
    }, 150);
  }, []);
  const [slashQuery, setSlashQuery] = useState('');
  const slashQueryRef = useRef('');
  useEffect(() => { slashQueryRef.current = slashQuery; }, [slashQuery]);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashAnchor, setSlashAnchor] = useState({
    left: 40,
    top: 140,
    width: 260
  });
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
  const [slashRecent, setSlashRecent] = useState(() => {
    try {
      const raw = localStorage.getItem('memos_slash_recent_v1');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
    } catch (_) {
      return [];
    }
  });
  var slashRef = useRef(null);
  var slashRepositionRafRef = useRef(null);
  var slashApplyingRef = useRef(false);
  var slashCommandDefs = useMemo(() => window.MynoteSlashCommands || [], []);
  const SVG_ICONS = window.MynoteSlashIcons || {};

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [bgColor, setBgColor] = useState(null);
  const [hasTyped, setHasTyped] = useState(false);
  var fileInputRef = useRef(null);
  var pendingImageBlockRef = useRef(null);
  var dbRef = useRef(null);
  var saveTimer = useRef(null);
  var editorWrapperRef = useRef(null);
  var editorBodyRef = useRef(null);
  var inputTimerRef = useRef(null);
  var slashCommands = useMemo(() => {
    const GROUP_LABELS = {
      basic: '基础块',
      media: '媒体块'
    };
    const GROUP_ORDER = ['basic', 'media'];
    var q = (slashQuery || '').trim().toLowerCase();
    var all = slashCommandDefs.slice();
    if (q) {
      var searchStr = function (cmd) {
        return (cmd.title + ' ' + cmd.subtitle + ' ' + cmd.keywords + ' ' + cmd.type + (cmd.pinyin || '')).toLowerCase();
      };
      return all.filter(cmd => searchStr(cmd).includes(q)).sort((a, b) => {
        var aStarts = (a.title + ' ' + (a.keywords || '')).toLowerCase().startsWith(q) || (a.pinyin || '').startsWith(q) ? 0 : 1;
        var bStarts = (b.title + ' ' + (b.keywords || '')).toLowerCase().startsWith(q) || (b.pinyin || '').startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.title.localeCompare(b.title, 'zh-Hans-CN');
      });
    }
    var result = [];
    if (slashRecent.length > 0) {
      var order = new Map();
      slashRecent.forEach((id, i) => order.set(id, i));
      var recent = all.filter(cmd => order.has(cmd.id)).sort((a, b) => order.get(a.id) - order.get(b.id)).map(cmd => ({
        ...cmd,
        recent: true,
        sectionLabel: '最近使用'
      }));
      var rest = all.filter(cmd => !order.has(cmd.id));
      var seenRecent = recent.length > 0;
      for (var g of GROUP_ORDER) {
        var groupItems = rest.filter(cmd => cmd.group === g);
        groupItems.forEach(function (c) {
          c.sectionLabel = GROUP_LABELS[g];
        });
        var addRecent = seenRecent && result.length === 0 && recent.length > 0;
        if (addRecent) result.push(...recent);
        result.push(...groupItems);
      }
      if (result.length === 0) result = all;
    } else {
      for (var g of GROUP_ORDER) {
        var groupItems2 = all.filter(cmd => cmd.group === g);
        groupItems2.forEach(function (c) {
          c.sectionLabel = GROUP_LABELS[g];
        });
        result.push(...groupItems2);
      }
    }
    return result;
  }, [slashQuery, slashRecent, slashCommandDefs]);
  var slashHideTimerRef = useRef(null);
  var updateSlashStateFromSelection = useCallback(function () {
    if (slashApplyingRef.current) return;
    clearTimeout(slashHideTimerRef.current);
    var sel = window.getSelection();
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
    var blockEl = baseEl && baseEl.closest ? baseEl.closest('[data-blockid]') : null;
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
        // 光标在子元素上，计算该子元素之前的文本长度 + 偏移
        var children = [...blockEl.childNodes];
        var offset = range.endOffset;
        var textBefore = 0;
        for (var ci = 0; ci < offset && ci < children.length; ci++) {
          textBefore += (children[ci].textContent || '').length;
        }
        caretOffset = textBefore;
      } else if (range.endContainer.nodeType === 1 && range.endContainer === blockEl) {
        // 光标在 blockEl 自身上，偏移量代表第 N 个子节点之前
        var children = [...blockEl.childNodes];
        var offset = range.endOffset;
        var textBefore = 0;
        for (var ci = 0; ci < offset && ci < children.length; ci++) {
          textBefore += (children[ci].textContent || '').length;
        }
        caretOffset = textBefore;
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
        var marker = document.createElement('span');
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
    var viewport = window.visualViewport;
    var viewportLeft = viewport ? viewport.offsetLeft : 0;
    var viewportTop = viewport ? viewport.offsetTop : 0;
    var viewportWidth = viewport ? viewport.width : window.innerWidth;
    var viewportHeight = viewport ? viewport.height : window.innerHeight;
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
    setSlashAnchor(prev => Math.abs(prev.left - left) < 1 && Math.abs(prev.top - top) < 1 && Math.abs(prev.width - panelWidth) < 1 ? prev : {
      left,
      top,
      width: panelWidth
    });
  }, []);
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
      var sel = window.getSelection();
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
    var idx = doc.findIndex(n => n.id === blkId);
    if (idx === -1) {
      slashApplyingRef.current = false;
      return;
    }
    var text = blockEl.textContent || doc[idx].children?.[0]?.text || '';
    var slashQueryLen = (slashQueryRef.current || '').length;
    var cleanedText = String(text || '').replace(/^\/(?:[^\s]*)?/, function (match) {
      if (slashQueryLen === 0 && match.length === 1) return '';
      return match.length === slashQueryLen + 1 ? '' : match.slice(slashQueryLen + 1);
    }).replace(/^\s+/, '');
    var type = cmd.type;
    /* ---- 内联格式命令：包裹选中文字 ---- */
    if (type.startsWith('inline_')) {
      var sel = window.getSelection();
      var selectedText = '';
      if (sel && sel.rangeCount > 0) {
        selectedText = sel.toString().trim();
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
      if (selectedText && sel && sel.rangeCount) {
        var range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(wrappedText));
        try {
          range.setStartAfter(range.endContainer);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (_) {}
      } else {
        doc.splice(idx, 1, {
          id: blkId,
          type: 'paragraph',
          children: [{
            text: wrappedText
          }]
        });
        setEditorDocRef(docRef.current);
        blockEl.outerHTML = renderDocToEditorHTML([{
          id: blkId,
          type: 'paragraph',
          children: [{
            text: wrappedText
          }]
        }], files);
        var focusTarget = editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + blkId + '"]');
        if (focusTarget) {
          focusEditableWithCaret(focusTarget, wrappedText.length);
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
        var n = [cmd.id].concat(prev.filter(function (id) {
          return id !== cmd.id;
        }));
        return n.slice(0, 6);
      });
      triggerAutoSave();
      if (type && type.startsWith('inline_')) {
        clearTimeout(mdCheckTimerRef.current);
        mdCheckTimerRef.current = setTimeout(function() {
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
    // 这 5 类在插入时统一降级为普通段落：在构造时就定值，避免"先写再覆盖"的死值
    var forcedParagraph = type === 'code_block' || type === 'unordered_list' || type === 'ordered_list' || type === 'decorative_divider' || type === 'callout';
    var newBlock = {
      id: blkId,
      type: forcedParagraph ? 'paragraph' : type,
      ...(type === 'paragraph' ? {
        children: [{
          text: cleanedText
        }]
      } : {}),
      ...(type === 'heading' ? {
        children: [{
          text: cleanedText
        }],
        attrs: {
          level
        }
      } : {}),
      ...(type === 'quote' ? {
        children: [{
          text: cleanedText
        }]
      } : {}),
      ...(type === 'todo' ? {
        children: [{
          text: cleanedText
        }],
        attrs: {
          checked: false
        }
      } : {}),
      ...(type === 'musicCard' ? {
        url: '',
        meta: null,
        status: 'input'
      } : {}),
      ...(type === 'image' ? {
        attrs: {
          fileId: ''
        }
      } : {}),
      ...(type === 'gallery' ? {
        attrs: {
          items: []
        }
      } : {}),
      ...(type === 'code_block' ? {
        children: [{
          text: '```\n' + cleanedText + '\n```'
        }]
      } : {}),
      ...(type === 'unordered_list' ? {
        children: [{
          text: '- ' + (cleanedText || '列表项')
        }]
      } : {}),
      ...(type === 'ordered_list' ? {
        children: [{
          text: '1. ' + (cleanedText || '列表项')
        }]
      } : {}),
      ...(type === 'decorative_divider' ? {
        children: [{
          text: '---🌟---'
        }]
      } : {}),
      ...(type === 'callout' ? {
        children: [{
          text: '> [!NOTE]\n> 提示内容'
        }]
      } : {}),
      ...(type === 'imgTextCard' ? {
        children: [{
          text: '点击输入文字'
        }],
        attrs: {
          imgUrl: ''
        }
      } : {}),
      ...(type === 'imageTextRow' ? {
        children: [{
          text: '点击输入说明文字'
        }],
        attrs: {
          imgUrl: ''
        }
      } : {})
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
    var trailingBlock = needsTrailingParagraph ? {
      id: genId(),
      type: 'paragraph',
      children: [{
        text: ''
      }]
    } : null;
    var replacementBlocks = trailingBlock ? [newBlock, trailingBlock] : [newBlock];
    doc.splice(idx, 1, ...replacementBlocks);
    setEditorDocRef(docRef.current);
    var html = renderDocToEditorHTML(replacementBlocks, files);
    var tpl = document.createElement('template');
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
    setSlashRecent(prev => {
      var next = [cmd.id, ...prev.filter(id => id !== cmd.id)];
      return next.slice(0, 6);
    });
    requestAnimationFrame(function () {
      // musicCard input 态：聚焦输入框，光标放到文本末尾
      var musicInput = editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + newBlock.id + '"][data-music-url="pending"]');
      if (musicInput && type === 'musicCard') {
        var tn = musicInput.firstChild;
        if (tn && tn.nodeType === 3) {
          var r2 = document.createRange();
          r2.setStart(tn, tn.textContent.length);
          r2.collapse(true);
          var s2 = window.getSelection();
          s2.removeAllRanges();
          s2.addRange(r2);
        }
        musicInput.focus();
      } else {
        var focusId = trailingBlock ? trailingBlock.id : blkId;
        var target = insertedTarget && editorBodyRef.current && editorBodyRef.current.contains(insertedTarget) ? insertedTarget : editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + focusId + '"]');
        if (target) {
          focusEditableWithCaret(target, trailingBlock ? 0 : cleanedText.length);
          try {
            target.scrollIntoView({
              block: 'nearest',
              inline: 'nearest'
            });
          } catch (_) {}
        } else if (editorBodyRef.current) editorBodyRef.current.focus({
          preventScroll: true
        });
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
  }, [slashTargetBlockId, triggerAutoSave, files]);
  useEffect(() => {
    try {
      localStorage.setItem('memos_slash_recent_v1', JSON.stringify(slashRecent));
    } catch (_) {}
  }, [slashRecent]);
  useEffect(() => {
    if (!showSlash) return;
    if (slashApplyingRef.current) return;
    const requestReposition = () => {
      if (slashRepositionRafRef.current) return;
      slashRepositionRafRef.current = requestAnimationFrame(() => {
        slashRepositionRafRef.current = null;
        updateSlashStateFromSelection();
      });
    };
    const onPointerDown = e => {
      if (slashRef.current && slashRef.current.contains(e.target)) return;
      closeSlashPanel();
    };
    const onScroll = () => requestReposition();
    const onResize = () => requestReposition();
    const onSelectionChange = () => requestReposition();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', onScroll, {
      passive: true
    });
    window.addEventListener('resize', onResize, {
      passive: true
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('scroll', onScroll, {
        passive: true
      });
      window.visualViewport.addEventListener('resize', onResize, {
        passive: true
      });
    }
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('scroll', onScroll);
        window.visualViewport.removeEventListener('resize', onResize);
      }
      if (slashRepositionRafRef.current) {
        cancelAnimationFrame(slashRepositionRafRef.current);
        slashRepositionRafRef.current = null;
      }
    };
  }, [showSlash, updateSlashStateFromSelection]);
  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashQuery, showSlash]);

  /* ---------- DOM contentEditable 输入管理（替代 textarea） ---------- */
  var dragState = useRef({
    draggingId: null,
    overIndex: null
  });
  const [dragOverIndex, setDragOverIndex] = useState(null);
  var isComposingRef = useRef(false);
  var pendingAttachmentsRef = useRef({});
  var avatarInputRef = useRef(null);
  const [avatarUrl, setAvatarUrl] = useState(null);
  var isEditingTitleRef = useRef(false);
  var editorFocusedRef = useRef(false);
  var savedSelectionRef = useRef(null);
  var history = useRef({
    past: [],
    future: []
  });
  var txOps = useRef([]);
  var txTimer = useRef(null);
  var heightMap = useRef({});
  useEffect(() => {
    (async () => {
      try {
        const db = await getDB();
        dbRef.current = db;
        const av = await loadAvatarFromDB(db, memo.id).catch(() => null);
        if (av) setAvatarUrl(av);
        // 加载自定义纯色背景
        if (memo.bgColor) setBgColor(memo.bgColor);
        const fileIds = docRef.current.filter(n => n.type === "attachment" || n.type === 'image' || n.type === 'imgTextCard' || n.type === 'imageTextRow').map(n => n.fileId || n.attrs && n.attrs.fileId).filter(Boolean);
        /* 画廊从 items 中提取 fileId */
        var galleryItems = docRef.current.filter(function (n) {
          return n.type === 'gallery' && n.attrs && n.attrs.items;
        }).reduce(function (arr, n) {
          return arr.concat(n.attrs.items.map(function (item) {
            return item && item.fileId || item;
          }));
        }, []);
        var allFileIds = fileIds.concat(galleryItems).filter(Boolean);
        if (allFileIds.length === 0) return;
        const map = {};
        for (const fid of allFileIds) {
          const stored = await loadAttachmentFromDB(db, fid).catch(() => null);
          if (stored) {
            map[fid] = {
              name: stored.name,
              type: stored.type,
              url: stored.url,
              size: stored.size,
              thumb: stored.thumb || null
            };
          }
        }
        if (Object.keys(map).length > 0) setFiles(map);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  // contentEditable DOM 初始化：doc → innerHTML（仅首次加载）
  var domInited = useRef(false);
  // 块级/原子块渲染后补一个可编辑空段落，保证光标有落点（集中一处，避免多份拷贝漂移）
  function ensureTrailingParagraphBlock(blockEl) {
    var nx = blockEl.nextElementSibling;
    if (!nx || nx.contentEditable === 'false' || nx.tagName === 'HR' || nx.classList.contains('atomic')) {
      var tp = document.createElement('p');
      tp.dataset.blockid = genId();
      tp.innerHTML = '<br>';
      blockEl.after(tp);
      return tp;
    }
    return null;
  }
  useEffect(function () {
    var el = editorBodyRef.current;
    if (!el || domInited.current) return;
    domInited.current = true;
    setEditorDocRef(docRef.current);
    el.innerHTML = renderDocToEditorHTML(docRef.current, files);
    // 确保原子块后有可编辑段落，否则光标无处放置
    var atomicTypes = ['musicCard','link-card','embedCard','attachment','image','gallery','divider','decorative_divider','callout','todo'];
    var lastChild = el.lastElementChild;
    if (lastChild && atomicTypes.indexOf(lastChild.dataset.type) >= 0) {
      var trailId = 'trail_' + Date.now();
      var trailP = document.createElement('p');
      trailP.dataset.blockid = trailId;
      trailP.contentEditable = 'inherit';
      trailP.innerHTML = '<br>';
      el.appendChild(trailP);
      docRef.current.push({ id: trailId, type: 'paragraph', children: [{ text: '' }] });
    }
    /* 首次加载：应用渲染缓存 + 懒加载未缓存段落 */
    var pendingCache = {};
    /* 异步加载缓存，不阻塞 init render */
    getDB().then(function (db) {
      return loadRenderCacheFromDB(db, memo.id);
    }).then(function (c) {
      if (c) pendingCache = c;
    }).catch(function(e) { if(e) console.warn('[\u6B64\u523B]', e); });
    setTimeout(function () {
      var ps = el.querySelectorAll('p');
      if (!ps.length) return;
      var uncached = [];
      /* ---- 第一遍：应用缓存 ---- */
      for (var pi = 0; pi < ps.length; pi++) {
        var p = ps[pi];
        var bid = p.dataset.blockid;
        var cached = bid && pendingCache[bid];
        if (cached) {
          if (cached.t === 'i') {
            p.dataset.mdtext = cached.m;
            p.innerHTML = cached.h;
          } else if (cached.t === 'b') {
            var dv = document.createElement('div');
            dv.contentEditable = 'false';
            dv.className = 'md-preview block markdown-render';
            dv.dataset.blockid = bid;
            dv.dataset.mdtext = cached.m;
            dv.innerHTML = cached.h;
            p.replaceWith(dv);
          }
        } else {
          var txt = (p.textContent || '').trim();
          if (txt && looksLikeCiaoMarkdown(txt)) uncached.push(p);
        }
      }
      /* ---- 第二遍：分组渲染（表格/代码块/列表） ---- */
      var grouped = [];
      var gi = 0;
      while (gi < uncached.length) {
        var ct = (uncached[gi].textContent || '').trim();
        if (MynoteMdBlocks.isFenceLine(ct)) {
          // 收集规则（含「单段落已含完整围栏」）见 MynoteMdBlocks
          var fg2 = MynoteMdBlocks.collectFenceGroup(uncached, gi);
          // 首次加载路径历史上只替换首段的围栏段，后续行保留原样（与旧实现逐字一致，勿"顺手修好"）
          var grp2 = [uncached[fg2.start]];
          gi = fg2.end;
          var merged2 = fg2.texts.join('\n'),
            htmlG2 = renderMarkdownHtml(merged2);
          var tmpG2 = document.createElement('div');
          tmpG2.innerHTML = htmlG2;
          if (tmpG2.firstElementChild && tmpG2.firstElementChild.tagName === 'PRE') {
            MynoteMdBlocks.replaceGroupWithPreview(grp2, merged2, htmlG2);
          }
          continue;
        }
        if (MynoteMdBlocks.isListLine(ct)) {
          var lg3 = MynoteMdBlocks.collectListGroup(uncached, gi);
          var grp3 = MynoteMdBlocks.range(lg3.start, lg3.end).map(function (k) {
            return uncached[k];
          });
          gi = lg3.end;
          var merged3 = lg3.texts.join('\n'),
            htmlG3 = renderMarkdownHtml(merged3);
          var tmpG3 = document.createElement('div');
          tmpG3.innerHTML = htmlG3;
          if (tmpG3.firstElementChild && (tmpG3.firstElementChild.tagName === 'UL' || tmpG3.firstElementChild.tagName === 'OL')) {
            MynoteMdBlocks.replaceGroupWithPreview(grp3, merged3, htmlG3);
          }
          continue;
        }
        grouped.push(uncached[gi]);
        gi++;
      }
      /* ---- 第三遍：补空段落 ---- */
      var bdAll2 = el.querySelectorAll('.md-preview.block');
      for (var bdi2 = 0; bdi2 < bdAll2.length; bdi2++) {
        ensureTrailingParagraphBlock(bdAll2[bdi2]);
      }
      /* ---- 第四遍：剩余单段落懒加载（批处理，每帧5组） ---- */
      if (grouped.length > 0) {
        var batchSize = 5,
          idx2 = 0;
        (function pb() {
          var end2 = Math.min(idx2 + batchSize, grouped.length);
          for (; idx2 < end2; idx2++) {
            var cp = grouped[idx2];
            if (!cp || !cp.parentNode) continue;
            var txt2 = (cp.textContent || '').trim();
            if (!txt2 || !looksLikeCiaoMarkdown(txt2)) continue;
            // 块级/内联判定与渲染统一走 MynoteMdBlocks（与失焦路径同一实现，不完整语法保护仅在失焦路径启用）
            MynoteMdBlocks.renderSingleParagraph(cp, txt2, { ensureTrailing: ensureTrailingParagraphBlock });
          }
          if (idx2 < grouped.length) setTimeout(pb, 16);
        })();
      }
    });
    // 自动聚焦
    if (autoFocus) {
      setTimeout(function () {
        el.focus();
      }, 200);
    }
  }, [files, memo.id]);

  // 附件/卡片文件加载完成后更新编辑器中的原子块展示
  useEffect(function () {
    var el = editorBodyRef.current;
    if (!el || !domInited.current) return;
    var doc = docRef.current;
    for (var i = 0; i < doc.length; i++) {
      var node = doc[i];
      if (node.type === 'attachment') {
        var domEl = el.querySelector('[data-blockid="' + node.id + '"]');
        if (domEl) {
          var html = renderAtomicHTML(node, files);
          if (html) domEl.outerHTML = html;
        }
      }
      /* 卡片图片：files 加载后更新 DOM */
      if (node.type === 'image' || node.type === 'imgTextCard' || node.type === 'imageTextRow' || node.type === 'gallery') {
        var domEl2 = el.querySelector('[data-blockid="' + node.id + '"]');
        if (domEl2) {
          var newHtml = renderDocToEditorHTML([node], files);
          domEl2.outerHTML = newHtml;
        }
      }
    }
  }, [files]);

  // 深色模式下压暗背景色（微信风格）
  const [isDarkMode, setIsDarkMode] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  function getDarkenedColor(hex) {
    const c = hex.replace('#', '');
    const r = Math.round(parseInt(c.slice(0, 2), 16) * 0.35);
    const g = Math.round(parseInt(c.slice(2, 4), 16) * 0.35);
    const b = Math.round(parseInt(c.slice(4, 6), 16) * 0.35);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  const effectiveBg = bgColor ? isDarkMode ? getDarkenedColor(bgColor) : bgColor : null;
  const editorBg = effectiveBg || (isDarkMode ? "var(--color-black)" : "var(--color-editor-bg)");

  // 监听系统深浅模式切换
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setIsDarkMode(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // 背景色延伸到安全区
  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    // 清除上一个编辑器的残留延迟恢复定时器
    if (body.__bgTimer) {
      clearTimeout(body.__bgTimer);
      body.__bgTimer = null;
    }
    if (effectiveBg) {
      html.style.backgroundColor = effectiveBg;
      body.style.backgroundColor = effectiveBg;
    } else {
      html.style.backgroundColor = editorBg;
      body.style.backgroundColor = editorBg;
    }
    return () => {
      if (body.__bgTimer) clearTimeout(body.__bgTimer);
      body.__bgTimer = null;
      html.style.backgroundColor = '';
      body.style.backgroundColor = '';
    };
  }, [effectiveBg, isDarkMode]);
  useLayoutEffect(function() {
    var el = document.body;
    var styleId = 'body-before-bg';
    var updateGradient = function() {
      var scrollY = window.scrollY || window.pageYOffset || 0;
      var alpha = scrollY <= 0 ? 0 : scrollY >= 30 ? 1 : scrollY / 30;
      var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var bgComputed = window.getComputedStyle(document.body).backgroundColor || (isDark ? '0,0,0' : '255,255,255');
      var c = bgComputed.replace('rgba(', '').replace('rgb(', '').replace(')', '').replace(/ /g, '').split(',');
      c = c.slice(0, 3).join(',');
      var bgStyle = document.getElementById(styleId);
      if (alpha <= 0.01) {
        if (!bgStyle) {
          bgStyle = document.createElement('style');
          bgStyle.id = styleId;
          document.head.appendChild(bgStyle);
        }
        bgStyle.textContent = 'body::before { background: transparent !important; }';
      } else {
        var grad = 'linear-gradient(to bottom, rgba(' + c + ',' + (alpha*0.82) + ') 0%, rgba(' + c + ',' + (alpha*0.6) + ') 50%, rgba(' + c + ',0) 100%)';
        if (!bgStyle) {
          bgStyle = document.createElement('style');
          bgStyle.id = styleId;
          document.head.appendChild(bgStyle);
        }
        bgStyle.textContent = 'body::before { background: ' + grad + ' !important; }';
      }
    };
    updateGradient();
    // 滚动期间每帧最多执行一次（getComputedStyle + 正则解析本身不便宜）
    var onScrollThrottled = window.MynoteDom && window.MynoteDom.rafThrottle ? window.MynoteDom.rafThrottle(updateGradient) : updateGradient;
    window.addEventListener('scroll', onScrollThrottled, { passive: true });
    return function() {
      window.removeEventListener('scroll', onScrollThrottled);
      var s = document.getElementById(styleId);
      if (s) s.remove();
    };
  }, []);
  var titleValueRef = useRef(title);
  useEffect(() => {
    titleValueRef.current = title;
  }, [title]);
  var doSave = useCallback(d => {
    /* 采集 DOM 渲染缓存 → 存入 IndexedDB */
    var cachePromise = Promise.resolve();
    try {
      var el = editorBodyRef.current;
      if (el) {
        var rc = {};
        el.querySelectorAll('p[data-mdtext]').forEach(function (p) {
          var bid = p.dataset.blockid;
          if (bid) rc[bid] = { t: 'i', h: p.innerHTML, m: p.dataset.mdtext };
        });
        el.querySelectorAll('.md-preview.block[data-mdtext]').forEach(function (dv) {
          var bid = dv.dataset.blockid;
          if (bid) rc[bid] = { t: 'b', h: dv.innerHTML, m: dv.dataset.mdtext };
        });
        if (Object.keys(rc).length > 0) {
          var db = dbRef.current;
          if (!db) {
            cachePromise = getDB().then(function (db2) {
              return saveRenderCacheToDB(db2, memo.id, rc);
            });
          } else {
            cachePromise = saveRenderCacheToDB(db, memo.id, rc);
          }
        }
      }
    } catch (_) {}
    cachePromise.catch(function () {});
    const saveResult = onSave(memo.id, {
      title: titleValueRef.current.trim() || "无标题",
      doc: d,
      updatedAt: new Date().toISOString()
    });
    return Promise.all([cachePromise, Promise.resolve(saveResult)]);
  }, [memo.id, onSave]);
  var triggerAutoSave = useCallback(isDraft => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      doSave(docRef.current);
      if (isDraft) DraftStore.save(memo.id, {
        doc: docRef.current,
        title: titleValueRef.current,
        updatedAt: new Date().toISOString()
      }).catch(function(e) { console.warn('[此刻] draft save', e); });
    }, isDraft ? 300 : 600);
  }, [doSave, memo.id]);
  useEffect(() => {
    triggerAutoSave();
    return () => clearTimeout(saveTimer.current);
  }, [title, triggerAutoSave]);
  var closedRef = useRef(false);
  const handleClose = async () => {
    closedRef.current = true;
    clearTimeout(saveTimer.current);
    clearTimeout(mdCheckTimerRef.current);
    clearTimeout(inputTimerRef.current);
    clearTimeout(txTimer.current);
    const pending = Object.values(pendingAttachmentsRef.current);
    if (pending.length > 0) await Promise.allSettled(pending);
    /* 等待 CardReader 完成 */
    if (window._pendingCardReaders && window._pendingCardReaders.length > 0) {
      await Promise.allSettled(window._pendingCardReaders);
    }
    // 新建笔记且没有任何改动（未输入文字、未改背景色、未设头像）→ 不保存，直接删除
    var isNewNote = memo.__isNewNote;
    var isEmptyEnough = !hasTyped && !bgColor && !avatarUrl;
    if (isNewNote && isEmptyEnough) {
      DraftStore.clear(memo.id);
      await Promise.resolve(onSave(memo.id, { _delete: true }));
    } else {
      await doSave(JSON.parse(JSON.stringify(docRef.current)));
    }
    setClosing(true);
    setTimeout(function() {
      // 过渡动画结束后再清理编辑器样式，避免动画期间顶部露出首页背景
      document.documentElement.style.backgroundColor = '';
      document.body.style.backgroundColor = '';
      var bgStyle = document.getElementById('body-before-bg');
      if (bgStyle) bgStyle.remove();
      onClose();
    }, 350);
  };
  const handleAvatarSelected = async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const dataUrl = ev.target.result;
      setAvatarUrl(dataUrl);
      if (dbRef.current) await saveAvatarToDB(dbRef.current, memo.id, dataUrl).catch(() => {});
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  var recordOp = useCallback(patch => {
    txOps.current.push(patch);
    clearTimeout(txTimer.current);
    txTimer.current = setTimeout(() => {
      const combined = txOps.current;
      txOps.current = [];
      if (combined.length === 0) return;
      const inverse = combined.map(p => {
        if (p.op === "update") return {
          op: "update",
          index: p.index,
          prev: p.next,
          next: p.prev
        };
        if (p.op === "insert") return {
          op: "remove",
          index: p.index,
          node: p.node
        };
        if (p.op === "remove") return {
          op: "insert",
          index: p.index,
          node: p.node
        };
        return p;
      }).reverse();
      history.current.past.push({
        patch: combined,
        inverse
      });
      if (history.current.past.length > 100) history.current.past.shift();
      history.current.future = [];
    }, 200);
  }, []);
  var applyPatch = useCallback(patch => {
    if (!Array.isArray(patch) || patch.length === 0) return;
    const cur = docRef.current;
    patch.forEach(p => {
      if (p.op === "update") {
        const idx = p.next?.id ? cur.findIndex(n => n.id === p.next.id) : p.index;
        if (idx !== -1) cur[idx] = p.next || p.prev;
      } else if (p.op === "insert") {
        const idx = p.index != null ? p.index : cur.length;
        cur.splice(idx, 0, p.node);
      } else if (p.op === "remove") {
        const idx = p.node?.id ? cur.findIndex(n => n.id === p.node.id) : p.index;
        if (idx !== -1) cur.splice(idx, 1);
      }
    });
    setRenderKey(prev => prev + 1);
  }, []);
  // ===== 全量快照撤销/重做 =====
  var lastSnapshotRef = useRef(null);
  var lastPushAtRef = useRef(0);
  // 统一历史入口：所有撤销点都由此写入，条目形如 { snapshot: 撤销后应恢复的内容 }
  var recordUndoPoint = useCallback(function() {
    // 深拷贝当前 doc，确保后续 push/修改不受影响
    var snapshot = JSON.parse(JSON.stringify(docRef.current));
    var prev = lastSnapshotRef.current;
    if (!prev) { lastSnapshotRef.current = snapshot; return; }
    // 序列化比较，避免引用相等但内容已变的情况
    if (JSON.stringify(prev) === JSON.stringify(snapshot)) return;
    var h = history.current;
    var now = Date.now();
    var top = h.past[h.past.length - 1];
    // 连续输入（600ms 内）合并成一步：保留更早的 before，撤销一次回到输入前
    if (top && top.snapshot && now - lastPushAtRef.current < 600) {
      top.snapshot = prev;
    } else {
      h.past.push({ snapshot: prev });
      if (h.past.length > 100) h.past.shift();
    }
    lastPushAtRef.current = now;
    lastSnapshotRef.current = snapshot;
    h.future = [];
  }, []);
  var undo = useCallback(() => {
    var h = history.current, last = h.past[h.past.length - 1];
    if (!last) return;
    h.past.pop();
    // 撤销前先把「当前状态」深拷贝一份，redo 才能准确回到这里
    var current = JSON.parse(JSON.stringify(docRef.current));
    if (last.snapshot) {
      var restoreTo = JSON.parse(JSON.stringify(last.snapshot));
      docRef.current = restoreTo; setEditorDocRef(restoreTo);
      lastSnapshotRef.current = JSON.parse(JSON.stringify(restoreTo));
      var el = editorBodyRef.current;
      if (el) el.innerHTML = renderDocToEditorHTML(restoreTo, filesRef.current);
      setRenderKey(function(p){return p+1;});
      h.future.push({ snapshot: current });
      lastPushAtRef.current = 0;
      triggerAutoSave();
      return;
    }
    applyPatch(last.inverse);
    lastSnapshotRef.current = JSON.parse(JSON.stringify(docRef.current));
    h.future.push({ patch: last.patch, inverse: last.inverse });
    lastPushAtRef.current = 0;
    triggerAutoSave();
  }, [applyPatch, triggerAutoSave]);
  var redo = useCallback(() => {
    var h = history.current, nxt = h.future[h.future.length - 1];
    if (!nxt) return;
    h.future.pop();
    var current = JSON.parse(JSON.stringify(docRef.current));
    if (nxt.snapshot) {
      var restoreTo = JSON.parse(JSON.stringify(nxt.snapshot));
      docRef.current = restoreTo; setEditorDocRef(restoreTo);
      lastSnapshotRef.current = JSON.parse(JSON.stringify(restoreTo));
      var el = editorBodyRef.current;
      if (el) el.innerHTML = renderDocToEditorHTML(restoreTo, filesRef.current);
      setRenderKey(function(p){return p+1;});
      h.past.push({ snapshot: current });
      lastPushAtRef.current = 0;
      triggerAutoSave();
      return;
    }
    applyPatch(nxt.patch);
    lastSnapshotRef.current = JSON.parse(JSON.stringify(docRef.current));
    h.past.push({ patch: nxt.patch, inverse: nxt.inverse });
    lastPushAtRef.current = 0;
    triggerAutoSave();
  }, [applyPatch, triggerAutoSave]);
  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();else undo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.shiftKey && e.key === "Z")) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);
  // ===== beforeinput: iOS 三指手势撤销/重做 =====
  useEffect(() => {
    var handler = function(e) {
      if (e.inputType === 'historyUndo') { e.preventDefault(); setTimeout(function() { undo(); }, 0); }
      else if (e.inputType === 'historyRedo') { e.preventDefault(); setTimeout(function() { redo(); }, 0); }
    };
    var el = editorBodyRef.current;
    if (!el) return;
    el.addEventListener('beforeinput', handler);
    return function() { el.removeEventListener('beforeinput', handler); };
  }, [undo, redo]);
  // 打开已有笔记时，自动补拉 loading 态音乐/链接卡片
  useEffect(() => {
    const cards = (docRef.current || []).filter(function (n) {
      return n && n.id && n.url && (n.type === 'musicCard' || n.type === 'link-card') && (!n.meta || n.status === 'loading');
    });
    if (!cards.length) return;

    // 保存当前选区，hydrate 完成后恢复
    var savedRange = null;
    try {
      var sel = window.getSelection();
      if (sel && sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
    } catch (_) {}

    cards.forEach(function (card) {
      fetchLinkMeta(card.url).then(function (meta) {
        const cur = docRef.current || [];
        const idx = cur.findIndex(function (n) { return n.id === card.id; });
        if (idx === -1) return;
        cur[idx].meta = meta;
        cur[idx].status = meta && meta.title ? 'ready' : 'error';
        const ce = editorBodyRef.current;
        if (ce) {
          const el = ce.querySelector('[data-blockid="' + card.id + '"]');
          if (el) el.outerHTML = renderAtomicHTML(cur[idx], files);
        }
        // 恢复选区
        try {
          if (savedRange) {
            var sel2 = window.getSelection();
            if (sel2) { sel2.removeAllRanges(); sel2.addRange(savedRange); }
          }
        } catch (_) {}
      }).catch(function (e) {
        console.warn('[此刻] hydrate card meta', e);
        const cur = docRef.current || [];
        const idx = cur.findIndex(function (n) { return n.id === card.id; });
        if (idx === -1) return;
        cur[idx].status = 'error';
        const ce = editorBodyRef.current;
        if (ce) {
          const el = ce.querySelector('[data-blockid="' + card.id + '"]');
          if (el) el.outerHTML = renderAtomicHTML(cur[idx], files);
        }
        try {
          if (savedRange) {
            var sel2 = window.getSelection();
            if (sel2) { sel2.removeAllRanges(); sel2.addRange(savedRange); }
          }
        } catch (_) {}
      });
    });
  }, [memo.id]);
  useEffect(() => {
    const SCROLL_THRESHOLD = 30;
    let scrollRaf = null;
    const handleScroll = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        // 编辑标题期间不响应 scroll，防止点击胶囊时页面回弹触发竖排切换
        if (isEditingTitleRef.current) return;
        setEditorScrolled(window.scrollY > SCROLL_THRESHOLD);
      });
    };
    window.addEventListener('scroll', handleScroll, {
      passive: true
    });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 光标跟随：编辑标题时监听 selectionchange，确保光标始终在溢出容器可视区内
  useEffect(() => {
    const handleSelectionChange = () => {
      if (!isEditingTitleRef.current) return;
      const container = overflowContainerRef.current;
      if (!container) return;

      // 用双 rAF 等待 iOS Safari 布局完全稳定后再读取光标位置
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          try {
            const range = sel.getRangeAt(0).cloneRange();
            range.collapse(true);

            // iOS Safari 对折叠光标 getBoundingClientRect 返回零，改用 getClientRects
            let cursorRect = null;
            const rects = range.getClientRects();
            if (rects && rects.length > 0) {
              cursorRect = rects[0];
            } else {
              // fallback：插入零宽字符测量位置
              cursorRect = range.getBoundingClientRect();
            }
            if (!cursorRect || cursorRect.width === 0 && cursorRect.height === 0 && cursorRect.left === 0) return;
            const containerRect = container.getBoundingClientRect();
            const MARGIN = 12;
            if (cursorRect.left < containerRect.left + MARGIN) {
              const delta = containerRect.left + MARGIN - cursorRect.left;
              container.scrollLeft = Math.max(0, container.scrollLeft - delta);
            } else if (cursorRect.right > containerRect.right - MARGIN) {
              const delta = cursorRect.right - containerRect.right + MARGIN;
              container.scrollLeft = Math.min(container.scrollWidth - container.clientWidth, container.scrollLeft + delta);
            }
          } catch (_) {}
        });
      });
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  /* ===== DOM-based atomic block insertion ===== */
  var insertAtomicBlockToDOM = useCallback((html, onInsert) => {
    var el = editorBodyRef.current;
    if (!el) return null;
    var sel = window.getSelection();
    var insertBeforeEl = null;
    if (sel && sel.rangeCount) {
      var range = sel.getRangeAt(0);
      var node = range.startContainer;
      while (node && node !== el) {
        if (node.nodeType === 1 && node.dataset && node.dataset.blockid && node.contentEditable !== 'false') {
          var text = node.textContent || '';
          var offset = range.startOffset;
          if (offset > 0 && offset < text.length) {
            var afterText = text.slice(offset);
            node.textContent = text.slice(0, offset);
            var newP = document.createElement(node.tagName);
            newP.dataset.blockid = genId();
            newP.textContent = afterText;
            node.after(newP);
            insertBeforeEl = newP;
          } else if (offset === 0) {
            insertBeforeEl = node;
          } else {
            insertBeforeEl = node.nextElementSibling;
            if (!insertBeforeEl || insertBeforeEl.contentEditable === 'false') {
              var np = document.createElement(node.tagName);
              np.dataset.blockid = genId();
              np.textContent = '';
              np.innerHTML = '<br>';
              node.after(np);
              insertBeforeEl = np;
            }
          }
          break;
        }
        node = node.parentNode;
      }
    }
    if (!insertBeforeEl) {
      var endP = document.createElement('p');
      endP.dataset.blockid = genId();
      endP.innerHTML = '<br>';
      el.appendChild(endP);
      insertBeforeEl = endP;
    }
    var temp = document.createElement('div');
    temp.innerHTML = html;
    var atomicEl = temp.firstChild;
    insertBeforeEl.before(atomicEl);
    /* ---- 确保原子块后始终有空段落 ---- */
    var nextSib = atomicEl.nextElementSibling;
    if (!nextSib || nextSib.contentEditable === 'false') {
      var trailP = document.createElement('p');
      trailP.dataset.blockid = genId();
      trailP.innerHTML = '<br>';
      atomicEl.after(trailP);
      insertBeforeEl = trailP;
    }
    var newRange = document.createRange();
    newRange.setStart(insertBeforeEl, 0);
    newRange.collapse(true);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    if (typeof onInsert === 'function') onInsert(atomicEl, insertBeforeEl);
    setEditorDocRef(docRef.current);
    docRef.current = parseEditorDOM(el);
    triggerAutoSave();
    return atomicEl;
  }, [triggerAutoSave]);

  /* ===== Attachment insertion ===== */
  var insertAttachmentAtCursor = useCallback(async file => {
    recordUndoPoint();
    var id = genId();
    var html = '<div contenteditable="false" class="atomic attachment" data-blockid="' + id + '" data-fileid="' + id + '"><div class="attachment-file"><span class="att-icon">📎</span><span class="att-name">' + escapeHTML(file.name) + '</span><span class="att-hint">上传中…</span></div></div>';
    insertAtomicBlockToDOM(html, function () {
      docRef.current.push({
        id: id,
        type: 'attachment',
        fileId: id,
        status: 'loading'
      });
      var url = URL.createObjectURL(file);
      setFiles(function (prev) {
        var n = Object.assign({}, prev);
        n[id] = {
          name: file.name,
          type: file.type,
          url: url,
          size: file.size,
          thumb: null
        };
        return n;
      });
      var reader = new FileReader();
      var rollbackFailedAttachment = function (err) {
        docRef.current = docRef.current.filter(function (n) { return n.id !== id; });
        var ce = editorBodyRef.current;
        var node = ce && ce.querySelector('[data-blockid="' + id + '"]');
        if (node) node.remove();
        setFiles(function (prev) { var n = Object.assign({}, prev); delete n[id]; return n; });
        try { URL.revokeObjectURL(url); } catch (_) {}
        setEditorDocRef(docRef.current);
        triggerAutoSave();
        if (window.MynoteErrors) window.MynoteErrors.addWarn('附件保存失败，已取消插入，请重试。', err);
      };
      var savePromise = new Promise(function (resolveAttach) {
        reader.onload = async function (ev) {
          try {
            var dataUrl = ev.target.result;
            var isImg = file.type.startsWith("image/");
            var docNode = docRef.current.find(function(n){ return n.id === id; });
            if (docNode) docNode.image = isImg;
            var thumb = isImg ? await createThumbnail(dataUrl) : null;
            await saveAttachmentToDB(dbRef.current, {
              id: id,
              name: file.name,
              type: file.type,
              size: file.size,
              url: dataUrl,
              thumb: thumb
            });
            setFiles(function (prev) {
              var n = Object.assign({}, prev);
              if (n[id]) n[id] = Object.assign({}, n[id], {
                thumb: thumb,
                url: dataUrl
              });
              return n;
            });
            var ce = editorBodyRef.current;
            if (ce) {
              var docEl = ce.querySelector('[data-blockid="' + id + '"]');
              if (docEl) docEl.outerHTML = renderAtomicHTML({
                id: id,
                type: 'attachment',
                fileId: id,
                status: 'done'
              }, Object.assign({}, files, {
                [id]: {
                  name: file.name,
                  type: file.type,
                  url: dataUrl,
                  thumb: thumb
                }
              }));
            }
          } catch (err) {
            rollbackFailedAttachment(err);
            console.error("附件保存失败", err);
          } finally {
            delete pendingAttachmentsRef.current[id];
            resolveAttach();
          }
        };
        reader.onerror = function () {
          rollbackFailedAttachment(reader.error || new Error('文件读取失败'));
          delete pendingAttachmentsRef.current[id];
          resolveAttach();
        };
        reader.onabort = function () {
          rollbackFailedAttachment(new Error('文件读取已取消'));
          delete pendingAttachmentsRef.current[id];
          resolveAttach();
        };
      });
      pendingAttachmentsRef.current[id] = savePromise;
      reader.readAsDataURL(file);
    });
  }, [insertAtomicBlockToDOM]);
  var handleAddAttachment = useCallback(function () {
    closeEditorMenu();
    if (fileInputRef.current) fileInputRef.current.click();
  }, [closeEditorMenu]);
  var handleFilesSelected = useCallback(async function (e) {
    var filesArr = Array.from(e.target.files);
    e.target.value = '';
    if (!filesArr.length) return;
    /* ---- 卡片图片占位点击 → 图片填入卡片 ---- */
    var pendingBlockId = pendingImageBlockRef.current;
    if (pendingBlockId) {
      pendingImageBlockRef.current = null;
      var file = filesArr[0];
      if (file && file.type && file.type.startsWith('image/')) {
        if (!window._pendingCardReaders) window._pendingCardReaders = [];
        var pendingPromise = new Promise(function (resolve) {
          var fileId = genId();
          var reader = new FileReader();
          reader.onload = function (ev) {
            var dataUrl = ev.target.result;
            /* 保存到 IndexedDB（与附件一致） */
            (async function () {
              try {
                var db = dbRef.current || (await getDB());
                if (!dbRef.current) dbRef.current = db;
                var thumb = file.type.startsWith('image/') ? await createThumbnail(dataUrl) : null;
                await saveAttachmentToDB(db, {
                  id: fileId,
                  name: file.name,
                  type: file.type,
                  size: file.size,
                  url: dataUrl,
                  thumb: thumb
                });
                setFiles(function (prev) {
                  var n = Object.assign({}, prev);
                  n[fileId] = {
                    name: file.name,
                    type: file.type,
                    url: dataUrl,
                    thumb: thumb
                  };
                  return n;
                });
              } catch (e) {
                if (window.MynoteErrors) window.MynoteErrors.addWarn('卡片图片保存失败，未添加图片，请重试。', e);
                resolve();
                return;
              }
              var blk = docRef.current.find(function (n) {
                return n.id === pendingBlockId;
              });
              if (!blk) {
                resolve();
                return;
              }
              var isGallery = blk.type === 'gallery';
              var newAttrs;
              if (isGallery) {
                var oldItems = blk.attrs && blk.attrs.items || [];
                /* 仅存 fileId，dataUrl 不写入 localStorage 防撑爆限额 */
                newAttrs = Object.assign({}, blk.attrs || {}, {
                  items: oldItems.concat([{
                    fileId: fileId
                  }])
                });
              } else {
                newAttrs = Object.assign({}, blk.attrs || {}, {
                  fileId: fileId
                });
              }
              updateBlock(pendingBlockId, {
                attrs: newAttrs
              });
              doSave(JSON.parse(JSON.stringify(docRef.current)));
              resolve();
            })();
          };
          reader.onerror = function () {
            resolve();
          };
          reader.onabort = function () {
            resolve();
          };
          reader.readAsDataURL(file);
        });
        window._pendingCardReaders.push(pendingPromise);
      }
      return;
    }
    if (!dbRef.current) {
      try {
        dbRef.current = await getDB();
      } catch (err) {
        console.error("DB 初始化失败", err);
        return;
      }
    }
    for (var i = 0; i < filesArr.length; i++) await insertAttachmentAtCursor(filesArr[i]);
  }, [insertAttachmentAtCursor, updateBlock, doSave]);

  /* ---------- 链接卡片更新（保留） ---------- */
  var updateBlock = useCallback((id, changes) => {
    const idx = docRef.current.findIndex(n => n.id === id);
    if (idx === -1) return;
    docRef.current[idx] = Object.assign({}, docRef.current[idx], changes);
    setEditorDocRef(docRef.current);
    /* ---- 同步更新 DOM 中的对应块 ---- */
    var domEl = editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + id + '"]');
    if (domEl) {
      var newHtml = renderDocToEditorHTML([docRef.current[idx]], files);
      domEl.outerHTML = newHtml;
    }
    setRenderKey(prev => prev + 1);
    triggerAutoSave();
  }, [files, triggerAutoSave]);

  /* ===== Link card insertion ===== */
  var insertLinkCardAtDOM = useCallback(async function (url) {
    recordUndoPoint();
    var cardId = genId();
    var domain = '';
    try {
      domain = new URL(url).hostname.replace('www.', '');
    } catch (e) {
      domain = url;
    }
    /* 检测是否为音乐平台链接 → 自动升级为音乐卡片 */
    var isMusic = /music\.163\.com|163cn\.tv|y\.qq\.com|i\.y\.qq\.com|open\.spotify\.com|music\.apple\.com/.test(url);
    var cardType = isMusic ? 'musicCard' : 'link-card';
    var html = '<div contenteditable="false" class="link-card-skeleton" data-blockid="' + cardId + '" data-type="' + cardType + '" data-url="' + escapeHTML(url) + '"><div class="link-card-skeleton-cover"></div><div class="link-card-skeleton-body"><div class="link-card-skeleton-line" style="width:75%"></div><div class="link-card-skeleton-line" style="width:50%"></div></div></div>';
    docRef.current.push({
      id: cardId,
      type: cardType,
      url: url,
      meta: null,
      status: 'loading'
    });
    setEditorDocRef(docRef.current);
    insertAtomicBlockToDOM(html);
    try {
      var meta = await fetchLinkMeta(url);
      var doc = docRef.current;
      var idx = doc.findIndex(function (n) {
        return n.id === cardId;
      });
      if (idx !== -1) {
        doc[idx].meta = meta;
        doc[idx].status = meta && meta.title ? 'ready' : 'error';
      }
      var ce = editorBodyRef.current;
      if (ce) {
        var cardEl = ce.querySelector('[data-blockid="' + cardId + '"]');
        // 仅当骨架屏还在时替换，防止与 handleEditorInput 渲染冲突
        if (cardEl && cardEl.classList.contains('link-card-skeleton')) {
          cardEl.outerHTML = renderAtomicHTML({
            id: cardId,
            type: cardType,
            url: url,
            meta: meta,
            status: meta && meta.title ? 'ready' : 'error'
          }, files);
        }
      }
    } catch (e) {
      var doc2 = docRef.current;
      var idx2 = doc2.findIndex(function (n) {
        return n.id === cardId;
      });
      if (idx2 !== -1) doc2[idx2].status = 'error';
      var ce2 = editorBodyRef.current;
      if (ce2) {
        var cardEl2 = ce2.querySelector('[data-blockid="' + cardId + '"]');
        if (cardEl2 && cardEl2.classList.contains('link-card-skeleton')) {
          cardEl2.outerHTML = renderAtomicHTML({
            id: cardId,
            type: cardType,
            url: url,
            meta: null,
            status: 'error'
          }, files);
      }
    }
  }
  }, [insertAtomicBlockToDOM]);

  /* ===== DOM input handlers ===== */
  var handleEditorInput = useCallback(function () {
    if (!hasTyped) setHasTyped(true);
    // 即时检测斜杠，不等 80ms 延迟
    try {
      var curEl = editorBodyRef.current;
      if (curEl && curEl.textContent && curEl.textContent.includes('/')) {
        updateSlashStateFromSelection();
      }
    } catch (_) {}
    clearTimeout(inputTimerRef.current);
    inputTimerRef.current = setTimeout(function () {
      var el = editorBodyRef.current;
      if (!el) return;
      var prevDoc = JSON.parse(JSON.stringify(docRef.current));
      setEditorDocRef(docRef.current);
      docRef.current = parseEditorDOM(el);
      // 文本变化时记录撤销点（比较序列化差异避免引用相等误判）
      if (JSON.stringify(prevDoc) !== JSON.stringify(docRef.current)) {
        // 走统一历史入口：深拷贝 + 600ms 输入合并，避免逐字符把 100 条上限打满
        lastSnapshotRef.current = prevDoc;
        recordUndoPoint();
      }
      /* ---- 智能前缀触发 ---- */
      /* 斜杠菜单打开时跳过，避免与 / 命令冲突 */
      if (!showSlash) {
        var PATTERNS = [{
          re: /^### (.+)/,
          type: 'heading',
          level: 3,
          strip: 4
        }, {
          re: /^## (.+)/,
          type: 'heading',
          level: 2,
          strip: 3
        }, {
          re: /^# (.+)/,
          type: 'heading',
          level: 1,
          strip: 2
        }, {
          re: /^>(?!\s*\[!\S)(.+)/,
          type: 'quote',
          strip: 2
        }, {
          re: /^\[ \] (.+)/,
          type: 'todo',
          attrs: {
            checked: false
          },
          strip: 4
        }, {
          re: /^\[\] (.+)/,
          type: 'todo',
          attrs: {
            checked: false
          },
          strip: 3
        }, {
          re: /^---$/,
          type: 'divider',
          exact: true
        }];
        var doc = docRef.current;
        var changed = false;
        for (var pi = 0; pi < doc.length; pi++) {
          var block = doc[pi];
          if (block.type !== 'paragraph') continue;
          var raw = block.children && block.children[0] && block.children[0].text || '';
          if (!raw) continue;
          for (var pi2 = 0; pi2 < PATTERNS.length; pi2++) {
            var pat = PATTERNS[pi2];
            if (pat.exact) {
              if (raw === '---') {
                doc.splice(pi, 1, {
                  id: block.id,
                  type: 'divider'
                });
                changed = true;
                break;
              }
              continue;
            }
            var m = raw.match(pat.re);
            if (m) {
              var cleanText = m[1].trim();
              var newBlock = {
                id: block.id,
                type: pat.type,
                children: [{
                  text: cleanText
                }]
              };
              if (pat.level) newBlock.attrs = {
                level: pat.level
              };
              if (pat.attrs) newBlock.attrs = Object.assign({}, newBlock.attrs, pat.attrs);
              doc.splice(pi, 1, newBlock);
              changed = true;
              break;
            }
          }
          if (changed) break;
        }
        if (changed) {
          recordUndoPoint();
          setEditorDocRef(doc);
          el.innerHTML = renderDocToEditorHTML(doc, filesRef.current);
        }
      }
      updateSlashStateFromSelection();
      triggerAutoSave();
    }, 80);
  }, [triggerAutoSave, updateSlashStateFromSelection]);
  var handleEditorKeyDown = useCallback(function (e) {
    var focusedMusicLink = e.target && e.target.closest && e.target.closest('a.music-card-link[data-url]');
    if (focusedMusicLink && e.key === 'Enter') {
      e.preventDefault();
      window.open(focusedMusicLink.dataset.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (showSlash) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (slashCommands.length > 0) setSlashSelectedIndex(i => (i + 1) % slashCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (slashCommands.length > 0) setSlashSelectedIndex(i => (i - 1 + slashCommands.length) % slashCommands.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        if (slashCommands.length > 0) {
          e.preventDefault();
          applySlashCommand(slashCommands[slashSelectedIndex] || slashCommands[0]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlashPanel();
        return;
      }
    }

    /* ---- Enter 在非段落块中新建行 ---- */
    if (e.key === 'Enter' && !e.shiftKey && !showSlash) {
      var sel2 = window.getSelection();
      if (sel2 && sel2.rangeCount) {
        var fn2 = sel2.focusNode;
        var el2 = fn2 ? fn2.nodeType === 1 ? fn2 : fn2.parentElement : null;
        var blkEl2 = el2 ? el2.closest('[data-blockid]') : null;
        if (blkEl2 && blkEl2.dataset && blkEl2.dataset.type && blkEl2.dataset.type !== 'paragraph') {
          /* 卡片文字区内按 Enter → 允许浏览器默认行为（在卡片内新建行） */
          var cardTextAreas = ['imgTextCard', 'imageTextRow'];
          if (cardTextAreas.includes(blkEl2.dataset.type)) {
            var inText = el2.closest('.itc-text') || el2.closest('.itr-text');
            if (inText) return; // 让浏览器默认在 contentEditable 内换行
          }
          e.preventDefault();
          var newP = document.createElement('p');
          newP.dataset.blockid = genId();
          newP.innerHTML = '<br>';
          blkEl2.parentNode.insertBefore(newP, blkEl2.nextSibling);
          var r = document.createRange();
          r.setStart(newP, 0);
          r.collapse(true);
          sel2.removeAllRanges();
          sel2.addRange(r);
          setEditorDocRef(docRef.current);
          docRef.current = parseEditorDOM(editorBodyRef.current);
          triggerAutoSave();
          return;
        }
      }
    }
    if (e.key === 'Enter' && e.shiftKey) return;
    if (e.key === 'Backspace') {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var focusNode = sel.focusNode;
      var block = focusNode ? focusNode.nodeType === 1 ? focusNode : focusNode.parentElement : null;
      if (!block) return;
      var blockEl = block.closest('[data-blockid]');
      if (!blockEl || blockEl.contentEditable === 'false') return;
      var text = blockEl.textContent || '';
      if (sel.focusOffset === 0 && text === '') {
        e.preventDefault();
        var prevEl = blockEl.previousElementSibling;
        blockEl.remove();
        /* 如果前一个兄弟是 contentEditable=false（附件/链接卡片），也一并删除 */
        if (prevEl && prevEl.contentEditable === 'false') {
          prevEl.remove();
          var prevPrev = prevEl.previousElementSibling;
          if (prevPrev) {
            var range = document.createRange();
            range.selectNodeContents(prevPrev);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            if (prevPrev.contentEditable !== 'false') prevPrev.focus();
          }
        } else if (prevEl) {
          var range = document.createRange();
          range.selectNodeContents(prevEl);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
          if (prevEl.contentEditable !== 'false') prevEl.focus();
        }
        setEditorDocRef(docRef.current);
        docRef.current = parseEditorDOM(editorBodyRef.current);
        triggerAutoSave();
      }
    }
  }, [triggerAutoSave, showSlash, slashCommands, slashSelectedIndex, applySlashCommand]);
  var handleEditorPaste = useCallback(function (e) {
    var text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!text) return;
    var trimmed = text.trim();

    /* ---- 音乐卡片输入框内粘贴：立即处理链接，不依赖 blur ---- */
    var sel = window.getSelection();
    var focusNode = sel && sel.focusNode;
    var focusEl = focusNode ? focusNode.nodeType === 1 ? focusNode : focusNode.parentElement : null;
    var musicInput = focusEl && focusEl.closest('[data-music-url="pending"]');
    if (musicInput) {
      e.preventDefault();
      /* 从粘贴文本中提取 URL（支持文本混有链接），否则尝试补协议后直接使用 */
      var muRaw = trimmed;
      var muUrl = extractUrlFromText(muRaw);
      if (!muUrl && /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(muRaw)) muUrl = muRaw;
      if (!muUrl) muUrl = muRaw;
      if (!muUrl.startsWith('http')) muUrl = 'https://' + muUrl;
      var mId = musicInput.dataset.blockid;
      var mDoc = docRef.current;
      var mIdx = mDoc.findIndex(function (n) {
        return n.id === mId;
      });
      if (mIdx !== -1) {
        mDoc[mIdx].url = muUrl;
        mDoc[mIdx].status = 'loading';
        mDoc[mIdx].type = 'musicCard';
        delete mDoc[mIdx].children;
      }
      setEditorDocRef(docRef.current);
      var mLoad = '<div contenteditable="false" data-blockid="' + mId + '" data-type="musicCard" data-url="' + escapeHTML(muUrl) + '" class="link-card-skeleton"><div class="link-card-skeleton-cover"></div><div class="link-card-skeleton-body"><div class="link-card-skeleton-line" style="width:75%;"></div><div class="link-card-skeleton-line" style="width:50%;"></div></div></div>';
      musicInput.outerHTML = mLoad;
      fetchLinkMeta(muUrl).then(function (meta) {
        var d2 = docRef.current;
        var i2 = d2.findIndex(function (n) {
          return n.id === mId;
        });
        if (i2 !== -1) {
          d2[i2].meta = meta;
          d2[i2].status = meta && meta.title ? 'ready' : 'error';
        }
        var ce2 = editorBodyRef.current;
        if (ce2) {
          var el2 = ce2.querySelector('[data-blockid="' + mId + '"]');
          if (el2) {
            var cv = meta && meta.cover ? proxyImg(meta.cover) : '';
            var tl = meta && meta.title || muUrl;
            var sr = meta && meta.source || '音乐';
            var hasCv = !!cv;
            var rh = '<a contenteditable="false" aria-label="打开音乐链接" class="link-card-block music-card-link" href="' + escapeHTML(muUrl) + '" target="_blank" rel="noopener noreferrer" data-blockid="' + mId + '" data-type="musicCard" data-url="' + escapeHTML(muUrl) + '">';
            if (hasCv) rh += '<div class="lkc-cover"><img src="' + escapeHTML(cv) + '" alt="" onerror="var lc=this.closest(\'.lkc-cover\');if(lc)lc.style.display=\'none\'"></div>';
            rh += '<div class="lkc-body' + (hasCv ? ' has-cover' : '') + '">';
            rh += '<div class="lkc-title">' + escapeHTML(tl) + '</div>';
            if (meta && meta.subtitle) rh += '<div class="lkc-subtitle">' + escapeHTML(meta.subtitle) + '</div>';
            rh += '<div class="lkc-source"><span class="lkc-source-icon">🎵</span><span class="lkc-source-dot"></span><span class="lkc-source-text">' + escapeHTML(sr) + '</span></div>';
            rh += '</div></a>';
            el2.outerHTML = rh;
            triggerAutoSave();
          }
        }
      }).catch(function () {
        var ce2 = editorBodyRef.current;
        if (ce2) {
          var el2 = ce2.querySelector('[data-blockid="' + mId + '"]');
          if (el2) {
            el2.outerHTML = renderAtomicHTML({ id: mId, type: 'musicCard', url: muUrl, meta: null, status: 'error' }, files);
          }
        }
        triggerAutoSave();
      });
      return;
    }
    var isPureUrl = isUrl(trimmed);
    var embeddedUrl = isPureUrl ? null : extractUrlFromText(trimmed);
    if (isPureUrl || embeddedUrl && /music\.163\.com|163cn\.tv|y\.qq\.com|i\.y\.qq\.com|open\.spotify\.com|music\.apple\.com|b23\.tv|xiaohongshu\.com|xhslink\.com/i.test(embeddedUrl)) {
      e.preventDefault();
      insertLinkCardAtDOM(isPureUrl ? trimmed : embeddedUrl);
      return;
    }
    e.preventDefault();
    document.execCommand('insertText', false, text);
    clearTimeout(inputTimerRef.current);
    inputTimerRef.current = setTimeout(function () {
      setEditorDocRef(docRef.current);
      docRef.current = parseEditorDOM(editorBodyRef.current);
      triggerAutoSave();
    }, 80);
  }, [insertLinkCardAtDOM, triggerAutoSave]);
  var handleEditorClick = useCallback(function (e) {
    if (showMenu) closeEditorMenu();
    /* ---- 点击已渲染块（表格/代码块/Callout）→ 回到编辑态 ---- */
    var mdBlock = e.target.closest('.md-preview.block[data-mdtext]');
    if (mdBlock && !e.target.closest('a, button, input, [contenteditable="true"]')) {
      var mdtext = mdBlock.dataset.mdtext || '';
      var bid = mdBlock.dataset.blockid || '';
      var p = document.createElement('p');
      p.dataset.blockid = bid;
      p.textContent = mdtext;
      mdBlock.replaceWith(p);
      // 聚焦到新段落
      var r = document.createRange();
      r.selectNodeContents(p);
      r.collapse(false);
      var s = window.getSelection();
      if (s) { s.removeAllRanges(); s.addRange(r); }
      if (editorBodyRef.current) editorBodyRef.current.focus();
      clearTimeout(mdCheckTimerRef.current);
      return;
    }
    /* ---- 点击卡片图片区 → 打开图库 ---- */
    var cardImg = e.target.closest('[data-blockid]');
    if (cardImg && cardImg.dataset && cardImg.dataset.type) {
      var cType = cardImg.dataset.type;
      var cTarget = e.target;
      /* ---- 点击卡片右侧区域 → 新增一行（优先于图库/图片区） ---- */
      var cardTypes = ['imgTextCard', 'imageTextRow', 'image', 'gallery', 'musicCard', 'divider'];
      if (cardTypes.includes(cType)) {
        var rect = cardImg.getBoundingClientRect();
        if (e.clientX - rect.left > rect.width * 0.85) {
          e.preventDefault();
          var newP = document.createElement('p');
          newP.dataset.blockid = genId();
          newP.innerHTML = '<br>';
          cardImg.parentNode.insertBefore(newP, cardImg.nextSibling);
          var r2 = document.createRange();
          r2.setStart(newP, 0);
          r2.collapse(true);
          var sel2 = window.getSelection();
          if (sel2) {
            sel2.removeAllRanges();
            sel2.addRange(r2);
          }
          setEditorDocRef(docRef.current);
          docRef.current = parseEditorDOM(editorBodyRef.current);
          triggerAutoSave();
          return;
        }
      }
      var isImgArea = cType === 'image' || cType === 'gallery' || cType === 'imgTextCard' && cTarget.closest('.itc-img-wrap') || cType === 'imageTextRow' && cTarget.closest('.itr-img');
      if (isImgArea) {
        e.preventDefault();
        e.stopPropagation();
        pendingImageBlockRef.current = cardImg.dataset.blockid;
        /* 关闭键盘 */
        if (document.activeElement) document.activeElement.blur();
        if (fileInputRef.current) fileInputRef.current.click();
        return;
      }
    }
    // MD render → 点击还原为可编辑文本
    var renderedEl = e.target.closest('[data-mdtext]');
    if (renderedEl) {
      var id = renderedEl.dataset.blockid;
      var text = renderedEl.dataset.mdtext || '';
      var targetP;
      if (renderedEl.tagName === 'P') {
        renderedEl.removeAttribute('data-mdtext');
        renderedEl.textContent = text;
        targetP = renderedEl;
      } else {
        /* 块级渲染 → 替换回可编辑段落 */
        /* 表格逐行恢复为独立段落，其他（callout 等）保持单段落 */
        var lines = text.split('\n').filter(function (l) {
          return l.trim();
        });
        if (lines.length > 1 && lines[0].startsWith('|')) {
          var firstP = document.createElement('p');
          firstP.dataset.blockid = id;
          firstP.textContent = lines[0];
          renderedEl.replaceWith(firstP);
          var lastP = firstP;
          for (var li = 1; li < lines.length; li++) {
            var nextP = document.createElement('p');
            nextP.dataset.blockid = genId();
            nextP.textContent = lines[li];
            lastP.after(nextP);
            lastP = nextP;
          }
          targetP = lastP;
        } else {
          var p = document.createElement('p');
          p.dataset.blockid = id;
          p.textContent = text;
          renderedEl.replaceWith(p);
          targetP = p;
        }
      }
      /* 光标放到最后一个可编辑段落末尾 */
      var range = document.createRange();
      range.selectNodeContents(targetP);
      range.collapse(false);
      var sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      targetP.focus();
      setEditorDocRef(docRef.current);
      docRef.current = parseEditorDOM(editorBodyRef.current);
      triggerAutoSave();
      return;
    }

    // 点击图片/附件左右边缘 → 插入新段落
    // 点击音乐卡片 → 输入链接
    var musicCard = e.target && e.target.closest && e.target.closest('[data-type="musicCard"]');
    /* Some browsers retarget clicks from non-editable atoms inside contentEditable to the editor.
       Resolve the visually hit card so a rendered music link remains clickable. */
    if (!musicCard && e.target === editorBodyRef.current && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      var hitTarget = document.elementFromPoint(e.clientX, e.clientY);
      musicCard = hitTarget && hitTarget.closest && hitTarget.closest('[data-type="musicCard"]');
    }
    if (musicCard) {
      var blockId2 = musicCard.dataset.blockid;
      var url2 = musicCard.dataset.url || '';
      if (!url2) {
        e.preventDefault();
        /* 无链接 → 原地替换为可编辑输入行 */
        var inputDiv = document.createElement('div');
        inputDiv.contentEditable = 'true';
        inputDiv.dataset.blockid = blockId2;
        inputDiv.dataset.musicUrl = 'pending';
        inputDiv.style.cssText = 'padding:12px 18px;border-radius:var(--radius-999);background:var(--glass-bg);backdrop-filter:var(--glass-filter);-webkit-backdrop-filter:var(--glass-filter);border:0.5px solid var(--glass-border);font-size:var(--font-14);color:var(--text-secondary);outline:none;';
        inputDiv.textContent = '粘贴音乐链接到这里...';
        musicCard.replaceWith(inputDiv);
        /* 更新 doc 状态为 input */
        var docMc = docRef.current;
        var mcIdx = docMc.findIndex(function (n) {
          return n.id === blockId2;
        });
        if (mcIdx !== -1) {
          docMc[mcIdx].status = 'input';
        }
        var r3 = document.createRange();
        r3.selectNodeContents(inputDiv);
        r3.collapse(false);
        var s3 = window.getSelection();
        if (s3) {
          s3.removeAllRanges();
          s3.addRange(r3);
        }
        inputDiv.focus();
      }
      if (url2) {
        // Chromium can retarget clicks inside contenteditable to the editing host; open the link explicitly.
        e.preventDefault();
        window.open(url2, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    var atomic = e.target.closest('.atomic.attachment, .atomic.link-card-block, .atomic.link-card-err');
    if (atomic) {
      var rect = atomic.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var el = editorBodyRef.current;
      if (!el) return;
      if (x < 28) {
        // 左侧点击 → 在附件前插入段落
        var newP = document.createElement('p');
        newP.dataset.blockid = genId();
        newP.innerHTML = '<br>';
        atomic.before(newP);
        var range = document.createRange();
        range.selectNodeContents(newP);
        range.collapse(true);
        var sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        el.focus();
        setEditorDocRef(docRef.current);
        docRef.current = parseEditorDOM(el);
        triggerAutoSave();
        return;
      } else if (x > rect.width - 28) {
        // 右侧点击 → 在附件后插入/聚焦段落
        var next = atomic.nextElementSibling;
        if (!next || next.contentEditable === 'false' || next.tagName === 'HR') {
          var newP = document.createElement('p');
          newP.dataset.blockid = genId();
          newP.innerHTML = '<br>';
          atomic.after(newP);
          next = newP;
        } else if (!next.textContent) {
          // 空段落加零宽空格确保光标可见
          next.innerHTML = '<br>';
        }
        var range = document.createRange();
        range.selectNodeContents(next);
        range.collapse(true);
        var sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        el.focus(); // 聚焦编辑器容器而非段落
      } else if (e.target.closest('.att-hint')) {
        e.preventDefault();
        e.stopPropagation();
        // 清除选区 + blur 编辑器，阻止 iOS contenteditable 弹出自动填充菜单
        var sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
        var atomic = e.target.closest('.atomic.attachment');
        var fid = atomic ? atomic.dataset.fileid : null;
        if (fid && files[fid] && files[fid].url) {
          var fi = files[fid];
          if (!(fi.type && fi.type.indexOf('image/') === 0)) {
            var blob = window.MynoteIdb.dataURLtoBlob(fi.url);
            if (blob) {
              var sf = new File([blob], fi.name || '文件', { type: fi.type || 'application/octet-stream' });
              if (navigator.share && navigator.canShare && navigator.canShare({ files: [sf] })) {
                navigator.share({ files: [sf], title: fi.name || '文件' }).catch(function(er){ if (er.name !== 'AbortError') warn('附件分享失败', er); });
              } else {
                var dl = document.createElement('a');
                dl.href = URL.createObjectURL(blob);
                dl.download = fi.name || '文件';
                dl.click();
                URL.revokeObjectURL(dl.href);
              }
            }
          }
        }
        setEditorDocRef(docRef.current);
        docRef.current = parseEditorDOM(el);
        triggerAutoSave();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setEditorDocRef(docRef.current);
      docRef.current = parseEditorDOM(el);
      triggerAutoSave();
      return;
    }
    if (e.target.closest('[data-type="todo"] .todo-checkbox')) return;
    // Link card click to open URL
    var lc = e.target.closest('.atomic[data-url]');
    if (lc && lc.dataset.url) {
      window.open(lc.dataset.url, '_blank');
    }
  }, [triggerAutoSave, showMenu, files]);

  /* ---- 待办圆点点击：pointerdown 阶段提前拦截光标 ---- */
  var handleTodoClick = useCallback(function (e) {
    var checkbox = e.target.closest('[data-type="todo"] .todo-checkbox');
    if (!checkbox) return;
    var todoBlock = checkbox.closest('[data-type="todo"]');
    if (!todoBlock) return;
    var todoText = todoBlock.textContent || '';
    if (!todoText.trim()) return;
    var checked = checkbox.dataset.checked === 'true';
    var newChecked = !checked;
    checkbox.dataset.checked = newChecked;
    // 替换 SVG
    var iconSrc = newChecked
      ? ((window.MynoteTodoIcons || {}).checked || '')
      : ((window.MynoteTodoIcons || {}).unchecked || '');
    checkbox.innerHTML = iconSrc ? '<img src="' + iconSrc + '" alt="">' : '';
    var block = todoBlock.closest('[data-blockid]');
    if (block) {
      var id = block.dataset.blockid;
      var idx = docRef.current.findIndex(function (n) { return n.id === id; });
      if (idx !== -1) {
        docRef.current[idx].attrs = Object.assign({}, docRef.current[idx].attrs || {}, { checked: newChecked });
        setEditorDocRef(docRef.current);
        triggerAutoSave();
        // 光标定位到文字末尾
        var textEl = todoBlock.querySelector('span:last-of-type');
        if (textEl && textEl !== checkbox && editorBodyRef.current) {
          editorBodyRef.current.focus();
          var r = document.createRange();
          r.selectNodeContents(textEl);
          r.collapse(false);
          var sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(r); }
        }
      }
    }
    e.preventDefault();
  }, [triggerAutoSave]);

  /* ===== Markdown 自动渲染（blur 时触发，延迟防抖） ===== */
  var mdCheckTimerRef = useRef(null);
  var blurApplyingRef = useRef(false);
  var handleEditorBlur = useCallback(function () {
    editorFocusedRef.current = false;
    // 键盘收起时强制重排固定元素位置
    if (window.visualViewport) {
      window.scrollTo(0, 0);
    }
    // 键盘收起时复位标题胶囊
    if (isEditingTitleRef.current) {
      isEditingTitleRef.current = false;
      editingStyleSnapshot.current = null;
      setEditingTitle(null);
    }
    // 同步滚动状态（键盘收起后 iOS 可能异步恢复滚动位置，需循环覆盖）
    var retries = 0;
    function forceVertical() {
      setEditorScrolled(false);
      retries++;
      if (retries < 6) setTimeout(forceVertical, 80);
    }
    forceVertical();
    clearTimeout(mdCheckTimerRef.current);
    if (blurApplyingRef.current) return;
    mdCheckTimerRef.current = setTimeout(function () {
      if (blurApplyingRef.current || closedRef.current || slashApplyingRef.current) return;
      blurApplyingRef.current = true;
      var el = editorBodyRef.current;
      if (!el) {
        blurApplyingRef.current = false;
        return;
      }
      var changed = false;
      var ps = el.querySelectorAll('p');
      if (!ps.length) {
        blurApplyingRef.current = false;
        return;
      }
      /* 段落过多时跳过块级渲染（表格/列表/代码块），仍做轻量内联渲染 */
      var skipHeavy = ps.length > 200;

      /* ---- 第一遍：识别代码块/列表行组，合并渲染 ---- */
      var ti = 0;
      if (!skipHeavy) {
        // 代码块：以 ``` 开头和结尾的行组（收集规则见 MynoteMdBlocks）
        var codeGroups = [];
        ti = 0;
        while (ti < ps.length) {
          var txt = (ps[ti].textContent || '').trim();
          if (MynoteMdBlocks.isFenceLine(txt)) {
            var fg = MynoteMdBlocks.collectFenceGroup(ps, ti);
            codeGroups.push({
              indices: MynoteMdBlocks.range(fg.start, fg.end),
              texts: fg.texts
            });
            ti = fg.end;
          } else {
            ti++;
          }
        }

        // 列表：连续以 -、*、数字. 开头的行组（收集规则见 MynoteMdBlocks）
        var listGroups = [];
        ti = 0;
        while (ti < ps.length) {
          var txt = (ps[ti].textContent || '').trim();
          if (MynoteMdBlocks.isListLine(txt)) {
            var lg = MynoteMdBlocks.collectListGroup(ps, ti);
            listGroups.push({
              indices: MynoteMdBlocks.range(lg.start, lg.end),
              texts: lg.texts
            });
            ti = lg.end;
          } else {
            ti++;
          }
        }

        /* ---- 处理代码块组 ---- */
        for (var gi2 = 0; gi2 < codeGroups.length; gi2++) {
          var grp2 = codeGroups[gi2];
          // 跳过已不在 DOM 中的组（被表格组处理牵连删除的）
          if (!ps[grp2.indices[0]] || !ps[grp2.indices[0]].parentNode) continue;
          var merged2 = grp2.texts.join('\n');
          var html2 = renderMarkdownHtml(merged2);
          var tmp2 = document.createElement('div');
          tmp2.innerHTML = html2;
          if (tmp2.firstElementChild && tmp2.firstElementChild.tagName === 'PRE') {
            MynoteMdBlocks.replaceGroupWithPreview(grp2.indices.map(function (k) {
              return ps[k];
            }), merged2, html2);
          }
        }

        /* ---- 处理列表组 ---- */
        for (var gi3 = 0; gi3 < listGroups.length; gi3++) {
          var grp3 = listGroups[gi3];
          if (!ps[grp3.indices[0]] || !ps[grp3.indices[0]].parentNode) continue;
          var merged3 = grp3.texts.join('\n');
          var html3 = renderMarkdownHtml(merged3);
          var tmp3 = document.createElement('div');
          tmp3.innerHTML = html3;
          if (tmp3.firstElementChild && (tmp3.firstElementChild.tagName === 'UL' || tmp3.firstElementChild.tagName === 'OL')) {
            MynoteMdBlocks.replaceGroupWithPreview(grp3.indices.map(function (k) {
              return ps[k];
            }), merged3, html3);
          }
        }
      } /* end if (!skipHeavy) */

      /* ---- 统一为所有块级渲染的组补空段落，并刷新 ps ---- */
      var blockDivs = el.querySelectorAll('.md-preview.block');
      for (var bdi = 0; bdi < blockDivs.length; bdi++) {
        if (ensureTrailingParagraphBlock(blockDivs[bdi])) changed = true;
      }
      ps = el.querySelectorAll('p');

      /* ---- 处理待输入的音乐链接 ---- */
      var muPs = el.querySelectorAll('[data-music-url="pending"]');
      for (var mui = 0; mui < muPs.length; mui++) {
        var muP = muPs[mui];
        var muText = (muP.textContent || '').trim();
        /* 从文本中提取 URL（支持 "分享 xxx https://..."），否则尝试补协议后直接使用 */
        var extractedUrl = muText && muText !== '粘贴音乐链接到这里...' ? extractUrlFromText(muText) || null : null;
        var finalUrl = extractedUrl;
        if (!finalUrl) {
          /* 无 http 前缀的纯域名 → 补 https:// */
          if (/^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(muText)) {
            finalUrl = 'https://' + muText;
          }
        }
        if (finalUrl) {
          if (!finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl;
          var muId = muP.dataset.blockid;
          var muUrl3 = finalUrl;
          muP.removeAttribute('data-music-url');
          /* 立即将 doc 中的 status 改为 loading，防止后续重渲染出输入框 */
          var docMu3 = docRef.current;
          var muIdx3 = docMu3.findIndex(function (n) {
            return n.id === muId;
          });
          if (muIdx3 !== -1) {
            docMu3[muIdx3].url = muUrl3;
            docMu3[muIdx3].status = 'loading';
            docMu3[muIdx3].type = 'musicCard';
            delete docMu3[muIdx3].children;
          }
          setEditorDocRef(docRef.current);
          /* 显示加载骨架 */
          var loadDiv = document.createElement('div');
          loadDiv.contentEditable = 'false';
          loadDiv.dataset.blockid = muId;
          loadDiv.dataset.type = 'musicCard';
          loadDiv.dataset.url = muUrl3;
          loadDiv.innerHTML = '<div class="link-card-skeleton-cover"></div><div class="link-card-skeleton-body"><div class="link-card-skeleton-line" style="width:75%;"></div><div class="link-card-skeleton-line" style="width:50%;"></div></div>';
          loadDiv.className = 'link-card-skeleton';
          loadDiv.style.cssText = '';
          muP.replaceWith(loadDiv);
          /*
           * 异步获取元数据
           * 注意：doc 中的 status 已在上面改为 loading
           */
          fetchLinkMeta(muUrl3).then(function (meta) {
            var d2 = docRef.current;
            var i2 = d2.findIndex(function (n) {
              return n.id === muId;
            });
            if (i2 !== -1) {
              d2[i2].meta = meta;
              d2[i2].status = meta && meta.title ? 'ready' : 'error';
            }
            var ce2 = editorBodyRef.current;
            if (ce2) {
              var el2 = ce2.querySelector('[data-blockid="' + muId + '"]');
              if (el2) {
                var cv = meta && meta.cover ? proxyImg(meta.cover) : '';
                var tl = meta && meta.title || muUrl3;
                var sr = meta && meta.source || '音乐';
                var finalDiv = document.createElement('a');
                finalDiv.contentEditable = 'false';
                finalDiv.className = 'link-card-block music-card-link';
                finalDiv.href = muUrl3;
                finalDiv.target = '_blank';
                finalDiv.rel = 'noopener noreferrer';
                finalDiv.setAttribute('aria-label', '打开音乐链接');
                finalDiv.dataset.blockid = muId;
                finalDiv.dataset.type = 'musicCard';
                finalDiv.dataset.url = muUrl3;
                var finalHtml = '';
                if (cv) finalHtml += '<div class="lkc-cover"><img src="' + escapeHTML(cv) + '" alt="" onerror="var lc=this.closest(\'.lkc-cover\');if(lc)lc.style.display=\'none\'"></div>';
                finalHtml += '<div class="lkc-body' + (cv ? ' has-cover' : '') + '">';
                finalHtml += '<div class="lkc-title">' + escapeHTML(tl) + '</div>';
                if (meta && meta.subtitle) finalHtml += '<div class="lkc-subtitle">' + escapeHTML(meta.subtitle) + '</div>';
                finalHtml += '<div class="lkc-source"><span class="lkc-source-icon">🎵</span><span class="lkc-source-dot"></span><span class="lkc-source-text">' + escapeHTML(sr) + '</span></div>';
                finalHtml += '</div>';
                finalDiv.innerHTML = finalHtml;
                el2.replaceWith(finalDiv);
                triggerAutoSave();
              }
            }
          }).catch(function () {
            var ce2 = editorBodyRef.current;
            if (ce2) {
              var el2 = ce2.querySelector('[data-blockid="' + muId + '"]');
              if (el2) {
                el2.outerHTML = renderAtomicHTML({ id: muId, type: 'musicCard', url: muUrl3, meta: null, status: 'error' }, files);
              }
            }
            triggerAutoSave();
          });
          changed = true;
        }
      }
      /* ---- 第二遍：处理单段落（内联语法/其他块级语法） ---- */
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (p.contentEditable === 'false') continue;
        var text = (p.textContent || '').trim();
        if (!text || !looksLikeCiaoMarkdown(text)) continue;
        var id = p.dataset.blockid;
        if (!id) continue;
        var res = MynoteMdBlocks.renderSingleParagraph(p, text, { guards: true, ensureTrailing: ensureTrailingParagraphBlock });
        if (res === 'skip') continue;
        if (res === 'inline') {
          // 内联渲染后把光标放回末尾，避免失焦后选区丢失
          var range = document.createRange();
          range.selectNodeContents(p);
          range.collapse(false);
          var sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        changed = true;
      }
      if (changed) {
        setEditorDocRef(docRef.current);
        docRef.current = parseEditorDOM(el);
        /* 强制清除所有 pending 的音乐卡片输入状态（无链接的输入框 → 回退到空态） */
        var forceDoc = docRef.current;
        for (var fi = 0; fi < forceDoc.length; fi++) {
          if (forceDoc[fi].type === 'musicCard' && forceDoc[fi].status === 'input' && !forceDoc[fi].url) {
            forceDoc[fi].status = 'empty';
            // 同步替换 DOM 中的输入框为空态 pill
            var mcEl = el.querySelector('[data-blockid="' + forceDoc[fi].id + '"]');
            if (mcEl && mcEl.dataset.musicUrl === 'pending') {
              var pillDiv = document.createElement('div');
              pillDiv.contentEditable = 'false';
              pillDiv.dataset.blockid = forceDoc[fi].id;
              pillDiv.dataset.type = 'musicCard';
              pillDiv.style.cssText = 'padding:12px 16px;border-radius:var(--radius-999);background:var(--glass-bg);backdrop-filter:var(--glass-filter);-webkit-backdrop-filter:var(--glass-filter);border:0.5px solid var(--glass-border);font-size:var(--font-14);color:var(--text-secondary);display:flex;align-items:center;gap:10px;';
              pillDiv.innerHTML = '<span>🎵</span><span>点击粘贴音乐链接</span>';
              mcEl.replaceWith(pillDiv);
            }
          }
        }
        /* 清除 DOM 和 doc 中已删除的 musicCard 输入框残留（doc 已不再包含的） */
        var seenMusicIds = {};
        el.querySelectorAll('[data-type="musicCard"]').forEach(function (mcEl) {
          var mid = mcEl.dataset.blockid;
          if (mid) {
            seenMusicIds[mid] = true;
          }
        });
        el.querySelectorAll('[data-music-url="pending"]').forEach(function (remEl) {
          var dupId = remEl.dataset.blockid;
          // 只删除 doc 中已不存在的残留（有 url 的已在上面处理，无 url 的已替换为空态）
          if (dupId) {
            var docIdx = docRef.current.findIndex(function (n) { return n.id === dupId; });
            if (docIdx === -1) {
              remEl.remove();
            }
          }
        });
        triggerAutoSave();
      }
      blurApplyingRef.current = false;
    }, 400);
  }, [triggerAutoSave]);
  var handleEditorFocus = useCallback(function (e) {
    editorFocusedRef.current = true;
    if (showMenu) closeEditorMenu();
    clearTimeout(mdCheckTimerRef.current);
    // 检查是否有 MD 预览块需要还原（点击进入编辑时）
    var el = editorBodyRef.current;
    if (!el) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var node = sel.focusNode;
    var preview = node && (node.closest ? node.closest('[data-mdtext]') : null);
    if (!preview) preview = e && e.target && e.target.closest ? e.target.closest('[data-mdtext]') : null;
  }, [showMenu]);

  /* ===== Remove attachment ===== */

  /* ---------- removeAttachment（保留不变） ---------- */
  var removeAttachment = useCallback(async (nodeId, fileId) => {
    const file = files[fileId];
    if (file) {
      if (file.url && file.url.startsWith('blob:')) URL.revokeObjectURL(file.url);
      if (file.thumb && file.thumb.startsWith('blob:')) URL.revokeObjectURL(file.thumb);
    }
    // Physical deletion is deferred until the updated memo is committed and shared references are checked.
    var domEl = editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + nodeId + '"]');
    if (domEl) domEl.remove();
    const doc = docRef.current;
    const idx = doc.findIndex(n => n.id === nodeId);
    if (idx !== -1) {
      doc.splice(idx, 1);
    }
    setFiles(prev => {
      const n = Object.assign({}, prev);
      delete n[fileId];
      return n;
    });
    triggerAutoSave();
  }, [files, triggerAutoSave]);
  var resizeObserverRef = useRef(null);
  var heightRafRef = useRef(null);
  // IntersectionObserver：可视区内 MD 段落才触发预览渲染
  var ioRef = useRef(null);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      let changed = false;
      entries.forEach(entry => {
        const id = entry.target.dataset.blockid;
        if (id) {
          const newH = entry.target.offsetHeight;
          const oldH = heightMap.current[id];
          // 高度变化需超过阈值（2px）才触发重渲染，避免 iOS 光标移动等行为
          // 产生的微小抖动被 ResizeObserver 捕获后形成 renderKey 循环
          if (Math.abs((oldH || 0) - newH) >= 2) {
            heightMap.current[id] = newH;
            changed = true;
          }
        }
      });
      if (changed && !heightRafRef.current) {
        heightRafRef.current = requestAnimationFrame(() => {
          heightRafRef.current = null;
          setRenderKey(prev => prev + 1);
        });
      }
    });
    resizeObserverRef.current = observer;

    // IntersectionObserver：段落进入可视区时才触发 MD 预览（新架构下 contentEditable 原生处理）
    var io = null; // 新架构不启用 MD 预览观察器
    ioRef.current = io;
    const observeBlocks = () => {
      if (!editorWrapperRef.current) return;
      const blocks = editorWrapperRef.current.querySelectorAll('[data-blockid]');
      blocks.forEach(b => {
        observer.observe(b);
        if (io && b.dataset.type === 'paragraph' && b.contentEditable === 'true') {
          io.observe(b);
        }
      });
    };
    observeBlocks();
    const mutationObserver = new MutationObserver(observeBlocks);
    if (editorWrapperRef.current) mutationObserver.observe(editorWrapperRef.current, {
      childList: true,
      subtree: true
    });
    return () => {
      observer.disconnect();
      if (mutationObserver) mutationObserver.disconnect();
      if (io) io.disconnect();
    };
  }, []);

  // 根据文字内容预估段落高度（避免未渲染段落默认 60px 导致滚动跳闪）
  // 新建笔记时自动 focus editor body
  useEffect(() => {
    if (autoFocus) return;
    const doc = docRef.current;
    const isNewEmpty = doc.length === 1 && doc[0].type === "paragraph" && (!doc[0].children || doc[0].children.every(c => c.text === ""));
    if (!isNewEmpty) return;
    setTimeout(function () {
      var el = editorBodyRef.current;
      if (el) {
        el.focus();
      }
    }, 300);
  }, [autoFocus]);
  const onDragStart = (e, nodeId) => {
    dragState.current.draggingId = nodeId;
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.classList.add("dragging");
  };
  const onDragEnd = e => {
    e.currentTarget.classList.remove("dragging");
    const {
      draggingId,
      overIndex
    } = dragState.current;
    if (draggingId && overIndex !== null) {
      const doc = docRef.current;
      const fromIdx = doc.findIndex(n => n.id === draggingId);
      if (fromIdx !== -1 && fromIdx !== overIndex) {
        const [item] = doc.splice(fromIdx, 1);
        const adjustIndex = overIndex > fromIdx ? overIndex - 1 : overIndex;
        doc.splice(adjustIndex, 0, item);
        recordOp({
          op: "remove",
          index: fromIdx,
          node: item
        });
        recordOp({
          op: "insert",
          index: adjustIndex,
          node: item
        });
        setRenderKey(prev => prev + 1);
      }
    }
    dragState.current = {
      draggingId: null,
      overIndex: null
    };
    setDragOverIndex(null);
  };
  const onDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const y = e.clientY,
      threshold = 80;
    if (y < threshold) window.scrollBy(0, -10);else if (window.innerHeight - y < threshold) window.scrollBy(0, 10);
    dragState.current.overIndex = index;
    setDragOverIndex(index);
  };
  const doc = docRef.current;
  const charCount = doc.reduce((acc, n) => n.type === "paragraph" ? acc + (n.children[0] ? n.children[0].text : "").replace(/\n/g, "").length : acc, 0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      minHeight: "100dvh",
      zIndex: 0,
      backgroundColor: editorBg,
      ...(closing ? {
        animation: "slideOutToRight 0.35s cubic-bezier(0.32,0.94,0.6,1) forwards"
      } : animDone ? {} : {
        animation: "slideInFromRight 0.35s cubic-bezier(0.32,0.94,0.6,1) both"
      })
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      zIndex: 1,
      minHeight: "100dvh",
      paddingBottom: "env(safe-area-inset-bottom)"
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "editor-fab left",
    onPointerDown: function (e) {
      e.stopPropagation();
      if (isEditingTitleRef.current) {
        isEditingTitleRef.current = false;
        editingStyleSnapshot.current = null;
        setEditingTitle(null);
      }
      handleClose();
    }
  }, /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    width: "22",
    height: "22",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.5,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "15 18 9 12 15 6"
  }))), (() => {
    const rawTitle = title || "无标题";
    const isEditing = editingTitle !== null;

    // 非编辑态显示：超10字截断加省略号
    const displayTitle = rawTitle.length > 10 ? rawTitle.slice(0, 10) + "…" : rawTitle;

    // 实时字数：仅用于胶囊宽度/overflow判断，不驱动样式
    const liveLen = isEditing ? editingTitle.length : displayTitle.length;

    // overflow模式：仅编辑中且超11字时触发（只影响宽度和滚动，不改样式）
    // 编辑期间从快照读取，防止容器宽度切换导致光标位置被重置
    const isOverflow = isEditing ? editingStyleSnapshot.current ? editingStyleSnapshot.current.isOverflow : liveLen > 11 : false;

    // 样式（isLong/fontSize）编辑期间从快照读取，防止阈值跨越时 DOM 重建导致光标丢失
    // 非编辑态正常按 displayTitle 长度计算
    const styleIsLong = isEditing && editingStyleSnapshot.current ? editingStyleSnapshot.current.isLong : displayTitle.length > 5;
    const capsuleFontSize = isEditing && editingStyleSnapshot.current ? editingStyleSnapshot.current.fontSize : styleIsLong ? 11 : 14;

    // 胶囊内容区最大宽度（11字时的自然宽度）
    const CAPSULE_MAX_CONTENT_W = 148;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: "fixed",
        zIndex: 3000,
        top: "calc(env(safe-area-inset-top) + 7px)",
        // 收缩态：撑满两fab之间，内部居中横排
        // 展开态：同样撑满，竖排居中，高度自适应
        left: 62,
        right: 62,
        display: "flex",
        flexDirection: editorScrolled ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        gap: editorScrolled ? 8 : 6,
        transition: 'all 0.25s ease',
        pointerEvents: "none"
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => avatarInputRef.current && avatarInputRef.current.click(),
      style: {
        flexShrink: 0,
        pointerEvents: "auto",
        width: 72,
        height: 72,
        borderRadius: "var(--radius-circle)",
        border: avatarUrl ? "none" : "0.5px solid var(--glass-border)",
        background: avatarUrl ? "transparent" : "var(--glass-bg)",
        backdropFilter: avatarUrl ? "none" : "var(--glass-filter)",
        WebkitBackdropFilter: avatarUrl ? "none" : "var(--glass-filter)",
        cursor: "pointer",
        padding: 0,
        overflow: "hidden"
      }
    }, avatarUrl ? /*#__PURE__*/React.createElement("img", {
      src: avatarUrl,
      alt: "avatar",
      style: {
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
        imageRendering: "auto",
        WebkitBackfaceVisibility: "hidden"
      }
    }) : /*#__PURE__*/React.createElement("div", { style: { width: "100%", height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", overflow: "hidden" } }, /*#__PURE__*/React.createElement("svg", { viewBox: "0 0 512 512", width: 60, height: 60, fill: "none", stroke: "var(--color-icon-muted)", strokeWidth: 22, strokeLinecap: "round", strokeLinejoin: "round", style: { transform: "translateY(10px)" } }, /*#__PURE__*/React.createElement("path", { d: "M 90,460 L 90,170 C 90,110 140,70 210,70 L 380,95 C 440,95 470,130 470,185 C 470,225 450,240 410,245 C 350,250 280,230 210,265 C 190,275 190,295 210,310 C 270,350 350,380 410,360 C 435,350 440,325 410,315" }), /*#__PURE__*/React.createElement("path", { d: "M 160,330 C 180,380 230,440 280,460" }), /*#__PURE__*/React.createElement("path", { d: "M 240,365 C 220,400 240,440 310,460" }), /*#__PURE__*/React.createElement("path", { d: "M 90,460 L 310,460" }), /*#__PURE__*/React.createElement("path", { d: "M 415,135 C 425,140 435,150 435,160" }), /*#__PURE__*/React.createElement("path", { d: "M 230,115 C 260,95 310,120 355,140" }), /*#__PURE__*/React.createElement("path", { d: "M 255,140 C 255,170 290,195 320,185 C 345,175 350,150 335,135" }), /*#__PURE__*/React.createElement("path", { d: "M 290,145 C 290,165 315,165 315,150" }), /*#__PURE__*/React.createElement("path", { d: "M 250,243 L 255,265 L 265,243 M 275,245 L 282,270 L 292,245 M 302,246 L 310,273 L 320,247 M 330,248 L 340,275 L 350,248 M 360,249 L 370,274 L 380,248 M 390,248 L 400,270 L 408,246 M 415,244 L 425,263 L 432,240 M 438,235 L 448,252 L 452,228" }), /*#__PURE__*/React.createElement("path", { d: "M 250,323 L 255,305 L 263,326 M 273,329 L 280,308 L 288,333 M 298,336 L 306,313 L 314,340 M 324,343 L 333,318 L 341,346 M 351,348 L 361,323 L 369,351 M 379,352 L 389,328 L 396,353 M 404,351 L 413,330 L 418,348" })))), /*#__PURE__*/React.createElement("div", {
      style: {
        flexShrink: 1,
        pointerEvents: "auto",
        height: 66,
        minWidth: 66,
        width: isOverflow ? CAPSULE_MAX_CONTENT_W + 36 : "auto",
        maxWidth: "100%",
        borderRadius: "var(--radius-33)",
        background: "var(--glass-bg)",
        backdropFilter: "var(--glass-filter)",
        WebkitBackdropFilter: "var(--glass-filter)",
        border: "0.5px solid var(--glass-border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: styleIsLong ? "6px 18px" : "0 20px",
        gap: 3,
        boxSizing: "border-box",
        overflow: "hidden",
        // 防止编辑期间内容撑破胶囊外观
        transition: "width 0.2s ease"
      }
    }, /*#__PURE__*/React.createElement("div", {
      ref: overflowContainerRef,
      style: {
        position: "relative",
        width: isOverflow ? "100%" : "auto",
        // 始终允许横向滚动（隐藏滚动条），防止模式切换重置 scrollLeft 导致光标跳位
        overflowX: "scroll",
        overflowY: "hidden",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        // 左侧渐变遮罩，仅 overflow 模式时生效
        WebkitMaskImage: isOverflow ? "linear-gradient(to right, transparent 0%, black 22%)" : "none",
        maskImage: isOverflow ? "linear-gradient(to right, transparent 0%, black 22%)" : "none"
      }
    }, /*#__PURE__*/React.createElement("div", {
      contentEditable: true,
      suppressContentEditableWarning: true,
      ref: el => {
        if (!el) return;
        if (!isEditingTitleRef.current) {
          // 非编辑态：显示截断版本，重置滚动
          if (el.textContent !== displayTitle) el.textContent = displayTitle;
          if (el.parentNode) el.parentNode.scrollLeft = 0;
        }
      },
      onFocus: e => {
        isEditingTitleRef.current = true;
        const full = title || "";
        setEditingTitle(full);
        // 记录进入编辑时的样式快照，编辑期间冻结所有影响布局的样式
        const snapLen = full.length;
        editingStyleSnapshot.current = {
          isLong: snapLen > 5,
          fontSize: snapLen > 5 ? 11 : 14,
          isOverflow: snapLen > 11 // 冻结 overflow 状态防止容器宽度切换
        };
        // 仅在显示截断版时替换内容并移光标到末尾
        if (e.currentTarget.textContent !== full) {
          const el = e.currentTarget;
          el.textContent = full;
          requestAnimationFrame(() => {
            if (!el || !el.isConnected) return;
            try {
              const range = document.createRange();
              const sel = window.getSelection();
              range.selectNodeContents(el);
              range.collapse(false);
              sel && sel.removeAllRanges();
              sel && sel.addRange(range);
            } catch (_) {}
            if (el.parentNode) el.parentNode.scrollLeft = el.parentNode.scrollWidth;
          });
        }
      },
      onInput: e => {
        const el = e.currentTarget;
        const text = el.textContent;
        // 仅在非输入法组合状态下更新，避免中文输入被打断
        if (!isComposingRef.current) {
          setEditingTitle(text);
        }
        // 滚动容器到最右
        requestAnimationFrame(() => {
          if (el.parentNode) el.parentNode.scrollLeft = el.parentNode.scrollWidth;
        });
      },
      onCompositionStart: () => {
        isComposingRef.current = true;
      },
      onCompositionEnd: e => {
        isComposingRef.current = false;
        const el = e.currentTarget;
        // 输入法上屏后更新实时字数
        setEditingTitle(el.textContent);
        requestAnimationFrame(() => {
          if (el.parentNode) el.parentNode.scrollLeft = el.parentNode.scrollWidth;
        });
      },
      onBlur: e => {
        isEditingTitleRef.current = false;
        isComposingRef.current = false;
        editingStyleSnapshot.current = null; // 清除样式快照
        const raw = e.currentTarget.textContent.trim() || "无标题";
        setTitle(raw);
        setEditingTitle(null);
        // 显示截断版本，重置滚动
        const disp = raw.length > 10 ? raw.slice(0, 10) + "…" : raw;
        if (e.currentTarget.textContent !== disp) e.currentTarget.textContent = disp;
        if (e.currentTarget.parentNode) e.currentTarget.parentNode.scrollLeft = 0;
      },
      onKeyDown: e => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      },
      style: {
        fontSize: capsuleFontSize,
        fontWeight: 600,
        color: "var(--text-main)",
        whiteSpace: isOverflow ? "nowrap" : styleIsLong ? "normal" : "nowrap",
        wordBreak: !isOverflow && styleIsLong ? "break-all" : "normal",
        textAlign: isOverflow ? "left" : "center",
        letterSpacing: "-0.2px",
        lineHeight: 1.3,
        outline: "none",
        cursor: "text",
        // 编辑期间不限制 maxHeight，防止光标被裁切消失
        // 非编辑态由外层胶囊 overflow:hidden 自然裁切
        maxHeight: isEditing ? "none" : !isOverflow && styleIsLong ? "2.7em" : "1.4em",
        overflow: "visible",
        direction: "ltr",
        display: "block",
        // 编辑期间最小宽度撑开容器，保证 scrollLeft 可以正常工作
        minWidth: isOverflow ? "max-content" : "auto"
      }
    })), !editorScrolled && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: "var(--font-10)",
        color: "var(--text-secondary)",
        pointerEvents: "none",
        textAlign: "center",
        lineHeight: 1.2,
        whiteSpace: "nowrap"
      }
    }, timeAgo(memo.updatedAt), " \xB7 ", charCount, "\u5B57")));
  })(), /*#__PURE__*/React.createElement("input", {
    ref: avatarInputRef,
    type: "file",
    accept: "image/*",
    onChange: handleAvatarSelected,
    style: {
      display: "none"
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "editor-fab right",
    style: {
      zIndex: 3003
    },
    onPointerDown: function (e) {
      e.stopPropagation();
      toggleEditorMenu();
    }
  }, /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    width: "22",
    height: "22",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "5",
    cy: "12",
    r: "2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "19",
    cy: "12",
    r: "2"
  }))), showMenu && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    onPointerDown: closeEditorMenu,
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 3001,
      background: menuClosing ? "transparent" : "transparent",
      transition: "background 220ms ease"
    }
  }), /*#__PURE__*/React.createElement("div", {
    onPointerDown: e => e.stopPropagation(),
    style: {
      position: "fixed",
      zIndex: 3002,
      right: 16,
      top: "calc(env(safe-area-inset-top) + 7px + 46px + 6px)",
      width: 246,
      background: "var(--glass-bg)",
      backdropFilter: "var(--glass-filter)",
      WebkitBackdropFilter: "var(--glass-filter)",
      border: "0.5px solid var(--glass-border)",
      boxShadow: "var(--shadow-sheet-strong)",
      borderRadius: "var(--radius-22)",
      overflow: "hidden",
      opacity: menuClosing ? 0 : 1,
      transform: menuClosing ? "translateY(-10px) scale(0.92)" : "translateY(0) scale(1)",
      transformOrigin: "85% -18px",
      transition: "opacity 180ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1)",
      willChange: "opacity, transform"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 7
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: function() { closeEditorMenu(); var h = history.current; if (h.past.length > 0) undo(); },
    style: {
      width: "100%",
      minHeight: 50,
      border: "none",
      background: "transparent",
      borderRadius: "var(--radius-17)",
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "8px 10px",
      color: "var(--text-main)",
      fontSize: "var(--font-14)",
      fontFamily: "inherit",
      cursor: history.current.past.length > 0 ? "pointer" : "default",
      textAlign: "left",
      opacity: history.current.past.length > 0 ? 1 : 0.3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 24,
      height: 24,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none",
      color: "var(--color-accent)"
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "20",
    height: "20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "1 4 1 10 7 10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3.51 15a9 9 0 1 0 2.13-9.36L1 10"
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--font-15)",
      fontWeight: 650,
      letterSpacing: "-0.1px"
    }
  }, "\u64A4\u9500"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--font-11)",
      color: "var(--text-secondary)",
      marginTop: 2
    }
  }, "\u5FEB\u6377\u952E\u2192 Cmd+Z / \u4E09\u6307\u5DE6\u6ED1"))), /*#__PURE__*/React.createElement("button", {
    onClick: function() { closeEditorMenu(); var h = history.current; if (h.future.length > 0) redo(); },
    style: {
      width: "100%",
      minHeight: 50,
      border: "none",
      background: "transparent",
      borderRadius: "var(--radius-17)",
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "8px 10px",
      color: "var(--text-main)",
      fontSize: "var(--font-14)",
      fontFamily: "inherit",
      cursor: history.current.future.length > 0 ? "pointer" : "default",
      textAlign: "left",
      opacity: history.current.future.length > 0 ? 1 : 0.3,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 24,
      height: 24,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none",
      color: "var(--color-accent)"
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "20",
    height: "20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "23 4 23 10 17 10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--font-15)",
      fontWeight: 650,
      letterSpacing: "-0.1px"
    }
  }, "\u91CD\u505A"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--font-11)",
      color: "var(--text-secondary)",
      marginTop: 2
    }
  }, "\u5FEB\u6377\u952E\u2192 Cmd+Shift+Z / \u4E09\u6307\u53F3\u6ED1"))), /*#__PURE__*/React.createElement("button", {
    onClick: handleAddAttachment,
    style: {
      width: "100%",
      minHeight: 50,
      border: "none",
      background: "transparent",
      borderRadius: "var(--radius-17)",
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "8px 10px",
      color: "var(--text-main)",
      fontSize: "var(--font-14)",
      fontFamily: "inherit",
      cursor: "pointer",
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 24,
      height: 24,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none",
      color: "var(--color-accent)"
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "20",
    height: "20",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8.2 11.8l4.9-4.9a3 3 0 1 1 4.2 4.2l-6.5 6.5a5 5 0 1 1-7.1-7.1l7.1-7.1",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--font-15)",
      fontWeight: 650,
      letterSpacing: "-0.1px"
    }
  }, "\u6DFB\u52A0\u9644\u4EF6"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--font-11)",
      color: "var(--text-secondary)",
      marginTop: 2,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, "\u56FE\u7247\u3001PDF \u6216\u6587\u672C\u6587\u4EF6")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--font-19)",
      color: "var(--color-placeholder-strong)",
      paddingLeft: 4
    }
  }, "\u203A")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      closeEditorMenu();
      setTimeout(() => setShowColorPicker(true), 220);
    },
    style: {
      width: "100%",
      minHeight: 50,
      border: "none",
      background: "transparent",
      borderRadius: "var(--radius-17)",
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "8px 10px",
      color: "var(--text-main)",
      fontSize: "var(--font-14)",
      fontFamily: "inherit",
      cursor: "pointer",
      textAlign: "left",
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 24,
      height: 24,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none",
      color: "var(--color-purple)"
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "20",
    height: "20",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 3.5a8.5 8.5 0 1 0 8.5 8.5c0-1.1-.9-2-2-2h-1.6a1.8 1.8 0 0 1-1.8-1.8V6.5A3 3 0 0 0 12 3.5Z",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinejoin: "round"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "8",
    cy: "10",
    r: "1.1",
    fill: "currentColor"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "7.7",
    r: "1.1",
    fill: "currentColor"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "15.2",
    cy: "9",
    r: "1.1",
    fill: "currentColor"
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--font-15)",
      fontWeight: 650,
      letterSpacing: "-0.1px"
    }
  }, "\u66F4\u6362\u80CC\u666F\u8272"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--font-11)",
      color: "var(--text-secondary)",
      marginTop: 2,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, "\u4E3A\u5F53\u524D\u7B14\u8BB0\u8BBE\u7F6E\u4E13\u5C5E\u5E95\u8272")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--font-19)",
      color: "var(--color-placeholder-strong)",
      paddingLeft: 4
    }
  }, "\u203A"))))), /*#__PURE__*/React.createElement("div", {
    ref: editorWrapperRef,
    style: {
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: "calc(env(safe-area-inset-top) + 7px + 66px + 4px + 66px + 12px)",
      paddingBottom: "calc(env(safe-area-inset-bottom) + 32px)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    ref: editorBodyRef,
    className: "editor-body" + (!hasTyped && docRef.current && docRef.current.length === 1 && docRef.current[0].type === 'paragraph' && !docRef.current[0].children?.[0]?.text ? ' show-placeholder' : ''),
    contentEditable: true,
    suppressContentEditableWarning: true,
    onInput: function(e) { if (!hasTyped) setHasTyped(true); if (isComposingRef.current) return; handleEditorInput(e); },
    onCompositionStart: function() { isComposingRef.current = true; },
    onCompositionEnd: function(e) { isComposingRef.current = false; handleEditorInput(e); },
    onKeyDown: handleEditorKeyDown,
    onPaste: handleEditorPaste,
    onClick: function(e) { handleEditorClick(e); handleTodoClick(e); },
    onBlur: handleEditorBlur,
    onFocus: handleEditorFocus,
    tabIndex: 0,
    style: {
      caretColor: "var(--text-main)",
      outline: "none"
    }
  })), /*#__PURE__*/React.createElement("input", {
    ref: fileInputRef,
    type: "file",
    multiple: true,
    accept: "image/*,application/pdf,text/plain",
    onChange: handleFilesSelected,
    style: {
      display: "none"
    }
  }), showSlash && /*#__PURE__*/React.createElement("div", {
    ref: slashRef,
    onTouchStart: function (e) {
      // 阻止编辑器失焦：触摸面板时重新聚焦编辑器
      // 不用 preventDefault，保留面板内滚动能力
      if (editorBodyRef.current) editorBodyRef.current.focus();
    },
    style: {
      position: 'fixed',
      zIndex: 9999,
      left: slashAnchor.left,
      top: slashAnchor.top,
      width: slashAnchor.width,
      background: 'var(--glass-bg)',
      backdropFilter: "var(--glass-filter)",
      WebkitBackdropFilter: "var(--glass-filter)",
      border: '0.5px solid var(--glass-border)',
      boxShadow: "var(--shadow-popover)",
      borderRadius: "var(--radius-22)",
      boxShadow: "var(--shadow-modal)",
      padding: '10px 10px',
      maxHeight: 280,
      overflowY: 'auto',
      opacity: slashClosing ? 0 : slashEntered ? 1 : 0,
      transform: slashClosing ? 'scale(0.88) translateY(-6px)' : slashEntered ? 'scale(1) translateY(0)' : 'scale(0.88) translateY(-6px)',
      transition: 'opacity 0.12s ease, transform 0.16s cubic-bezier(0.34,1.56,0.64,1)',
      transformOrigin: 'top left'
    }
  }, slashCommands.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '24px 12px 20px',
      color: 'var(--text-secondary)',
      fontSize: "var(--font-13)",
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "28",
    height: "28",
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    style: {
      display: 'block',
      margin: '0 auto 8px',
      opacity: 0.4
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "8.5",
    cy: "8.5",
    r: "5.5"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12.5",
    y1: "12.5",
    x2: "17",
    y2: "17"
  })), "\u672A\u627E\u5230\u5339\u914D\u547D\u4EE4", /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--font-11)",
      marginTop: 8,
      lineHeight: 1.6,
      opacity: 0.5
    }
  }, "\u8BD5\u8BD5\u62FC\u97F3\u9996\u5B57\u6BCD\uFF1A", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      background: "var(--fill-hover)",
      padding: '1px 5px',
      borderRadius: "var(--radius-4)",
      fontFamily: 'monospace',
      fontSize: "var(--font-10)"
    }
  }, "bt"), " \u6807\u9898 \xB7 ", /*#__PURE__*/React.createElement("span", {
    style: {
      background: "var(--fill-hover)",
      padding: '1px 5px',
      borderRadius: "var(--radius-4)",
      fontFamily: 'monospace',
      fontSize: "var(--font-10)"
    }
  }, "tp"), " \u56FE\u7247 \xB7 ", /*#__PURE__*/React.createElement("span", {
    style: {
      background: "var(--fill-hover)",
      padding: '1px 5px',
      borderRadius: "var(--radius-4)",
      fontFamily: 'monospace',
      fontSize: "var(--font-10)"
    }
  }, "yykp"), " \u97F3\u4E50")), function () {
    var q = (slashQuery || '').trim().toLowerCase();
    var hasQuery = q.length > 0;
    function hl(text) {
      if (!hasQuery || !text) return text;
      var idx = text.toLowerCase().indexOf(q);
      if (idx === -1) return text;
      var before = text.slice(0, idx);
      var match = text.slice(idx, idx + q.length);
      var after = text.slice(idx + q.length);
      return React.createElement(React.Fragment, null, before, React.createElement('mark', {
        style: {
          background: "var(--fill-accent-18)",
          color: 'var(--text-main)',
          borderRadius: "var(--radius-3)",
          padding: '0 2px',
          fontWeight: 600
        }
      }, match), after);
    }
    var prevLabel = null;
    var flatIdx = -1;
    return slashCommands.map(function (cmd) {
      var showHeader = cmd.sectionLabel && cmd.sectionLabel !== prevLabel;
      var isFirstSec = prevLabel === null;
      prevLabel = cmd.sectionLabel;
      flatIdx++;
      var baseStyle = {
        padding: '10px 12px',
        borderRadius: "var(--radius-16)",
        cursor: 'pointer',
        fontSize: "var(--font-14)",
        color: 'var(--text-main)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        position: 'relative',
        overflow: 'hidden',
        background: 'transparent',
        marginBottom: 2
      };
      return React.createElement(React.Fragment, {
        key: cmd.id
      }, showHeader && React.createElement('div', {
        style: {
          padding: '6px 10px 4px',
          fontSize: "var(--font-11)",
          fontWeight: 700,
          letterSpacing: '0.4px',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
          opacity: 0.7,
          marginTop: isFirstSec ? 0 : 8,
          borderTop: isFirstSec ? 'none' : '0.5px solid var(--border-color)'
        }
      }, cmd.sectionLabel), React.createElement('div', {
        className: 'slash-row',
        onPointerDown: function (e) {
          // 不 preventDefault，保留滚动；只阻止编辑器失焦
          if (editorBodyRef.current) editorBodyRef.current.focus();
          setSlashSelectedIndex(flatIdx);
        },
        onPointerUp: function (e) {
          // pointerUp = 确认是点击（不是滚动），执行命令
          e.preventDefault();
          applySlashCommand(cmd);
        },
        onClick: function () {
          // 桌面端 fallback
          if (!slashApplyingRef.current) applySlashCommand(cmd);
        },
        onPointerEnter: function () {
          setSlashSelectedIndex(flatIdx);
        },
        onMouseEnter: function () {
          setSlashSelectedIndex(flatIdx);
        },
        style: baseStyle
      }, React.createElement('div', {
        style: {
          width: 28,
          height: 28,
          borderRadius: "var(--radius-8)",
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: "var(--fill-hover-strong)",
          fontSize: "var(--font-14)",
          flex: '0 0 28px',
          position: 'relative',
          zIndex: 1
        },
        dangerouslySetInnerHTML: {
          __html: SVG_ICONS[cmd.icon] || ''
        }
      }), React.createElement('div', {
        style: {
          minWidth: 0,
          flex: 1,
          position: 'relative',
          zIndex: 1
        }
      }, React.createElement('div', {
        style: {
          fontWeight: 600,
          fontSize: "var(--font-14)",
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }
      }, React.createElement('span', null, hl(cmd.title)), cmd.recent && React.createElement('span', {
        style: {
          fontSize: "var(--font-10)",
          color: 'var(--text-secondary)',
          background: 'var(--glass-bg)',
          backdropFilter: "var(--glass-filter)",
          WebkitBackdropFilter: "var(--glass-filter)",
          padding: '1px 6px',
          borderRadius: "var(--radius-999)",
          border: '0.5px solid var(--glass-border)',
          opacity: 0.85
        }
      }, '最近')), React.createElement('div', {
        style: {
          fontSize: "var(--font-12)",
          color: 'var(--text-secondary)',
          marginTop: 3
        }
      }, hl(cmd.subtitle))), cmd.shortcut && React.createElement('div', {
        style: {
          fontSize: "var(--font-10)",
          fontFamily: "var(--font-family-mono)",
          color: 'var(--text-secondary)',
          opacity: 0.5,
          flexShrink: 0,
          padding: '2px 6px',
          borderRadius: "var(--radius-6)",
          background: "var(--fill-hover)",
          position: 'relative',
          zIndex: 1
        }
      }, cmd.shortcut)));
    });
  }()), showColorPicker && /*#__PURE__*/React.createElement(BgSheet, {
    currentColor: bgColor,
    onSelect: value => {
      setBgColor(value);
      onSave(memo.id, {
        ...memo,
        bgColor: value
      });
      setShowColorPicker(false);
    },
    onRemove: () => {
      setBgColor(null);
      onSave(memo.id, {
        ...memo,
        bgColor: undefined
      });
      setShowColorPicker(false);
    },
    onClose: () => setShowColorPicker(false)
  })));
}

window.MynoteEditorPage = Editor;
