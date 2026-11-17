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

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [bgColor, setBgColor] = useState(null);
  const [hasTyped, setHasTyped] = useState(false);
  var fileInputRef = useRef(null);
  var pendingImageBlockRef = useRef(null);
  var dbRef = useRef(null);
  var saveTimer = useRef(null);
  var editorWrapperRef = useRef(null);
  var editorBodyRef = useRef(null);
  var inputTimerRef = useRef(null);

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
  const [isDarkMode, setIsDarkMode] = useState(() => window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false);
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
  var mdCheckTimerRef = useRef(null);
  var blurApplyingRef = useRef(false);
  // pagehide 落盘 + 封面破图委托：实现抽到 src/app/editor/lifecycle-hooks.js
  var EditorHooks = window.MynoteEditorHooks;
  if (EditorHooks && EditorHooks.usePageHideFlush) {
    EditorHooks.usePageHideFlush({
      closedRef: closedRef,
      saveTimer: saveTimer,
      doSave: doSave,
      memo: memo,
      titleValueRef: titleValueRef,
      docRef: docRef
    });
  }
  if (EditorHooks && EditorHooks.useCoverErrorGuard) {
    EditorHooks.useCoverErrorGuard();
  }

  var History = window.MynoteEditorHooks.useEditorHistory({
    docRef: docRef,
    filesRef: filesRef,
    editorBodyRef: editorBodyRef,
    setRenderKey: setRenderKey,
    triggerAutoSave: triggerAutoSave,
    setEditorDocRef: setEditorDocRef
  });
  var history = History.history;
  var txTimer = History.txTimer;
  var lastSnapshotRef = History.lastSnapshotRef;
  var recordOp = History.recordOp;
  var recordUndoPoint = History.recordUndoPoint;
  var undo = History.undo;
  var redo = History.redo;
  var Slash = window.MynoteEditorHooks.useSlash({
    editorBodyRef: editorBodyRef,
    docRef: docRef,
    files: files,
    recordUndoPoint: recordUndoPoint,
    triggerAutoSave: triggerAutoSave,
    mdCheckTimerRef: mdCheckTimerRef,
    blurApplyingRef: blurApplyingRef,
    closedRef: closedRef,
    slashCommandDefs: window.MynoteSlashCommands || []
  });
  var showSlash = Slash.showSlash;
  var slashClosing = Slash.slashClosing;
  var slashEntered = Slash.slashEntered;
  var closeSlashPanel = Slash.closeSlashPanel;
  var slashQuery = Slash.slashQuery;
  var setSlashQuery = Slash.setSlashQuery;
  var slashQueryRef = Slash.slashQueryRef;
  var slashSelectedIndex = Slash.slashSelectedIndex;
  var setSlashSelectedIndex = Slash.setSlashSelectedIndex;
  var slashAnchor = Slash.slashAnchor;
  var slashTargetBlockRef = Slash.slashTargetBlockRef;
  var slashRef = Slash.slashRef;
  var slashApplyingRef = Slash.slashApplyingRef;
  var slashHideTimerRef = Slash.slashHideTimerRef;
  var suppressPointerClickRef = Slash.suppressPointerClickRef;
  var pointerClickTimerRef = Slash.pointerClickTimerRef;
  var slashCommands = Slash.slashCommands;
  var setSlashTargetBlockId = function (v) { if (!v) Slash.slashTargetBlockRef.current = null; };
  var updateSlashStateFromSelection = Slash.updateSlashStateFromSelection;
  var applySlashCommand = Slash.applySlashCommand;
  var SlashSVGIcons = Slash.SVG_ICONS;

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
      var pendingBlock = docRef.current.find(function (n) { return n.id === pendingBlockId; });
      var isGalleryTarget = pendingBlock && pendingBlock.type === 'gallery';
      var imageFiles = isGalleryTarget ? filesArr.filter(function (f) { return f && f.type && f.type.startsWith('image/'); }) : [filesArr[0]];
      if (!imageFiles.length || !imageFiles[0] || !imageFiles[0].type || !imageFiles[0].type.startsWith('image/')) {
        if (window.MynoteErrors) window.MynoteErrors.addWarn('此处只接受图片文件，请重新选择。', new Error('non-image for card placeholder'));
      } else {
        if (!window._pendingCardReaders) window._pendingCardReaders = [];
        var pendingPromise = (async function () {
          var savedImages = [];
          for (var imageIndex = 0; imageIndex < imageFiles.length; imageIndex++) {
            var file = imageFiles[imageIndex];
            var dataUrl = await new Promise(function (resolve) {
              var reader = new FileReader();
              reader.onload = function (ev) { resolve(ev.target.result); };
              reader.onerror = function () { resolve(null); };
              reader.onabort = function () { resolve(null); };
              reader.readAsDataURL(file);
            });
            if (!dataUrl) {
              if (window.MynoteErrors) window.MynoteErrors.addWarn('图片读取失败，未添加该图片。', new Error('image file read failed'));
              continue;
            }
            var fileId = genId();
            try {
              var db = dbRef.current || (await getDB());
              if (!dbRef.current) dbRef.current = db;
              var thumb = await createThumbnail(dataUrl);
              await saveAttachmentToDB(db, {
                id: fileId,
                name: file.name,
                type: file.type,
                size: file.size,
                url: dataUrl,
                thumb: thumb
              });
              savedImages.push({
                id: fileId,
                name: file.name,
                type: file.type,
                url: dataUrl,
                thumb: thumb
              });
            } catch (saveErr) {
              if (window.MynoteErrors) window.MynoteErrors.addWarn('卡片图片保存失败，未添加图片，请重试。', saveErr);
            }
          }
          if (!savedImages.length) return;
          setFiles(function (prev) {
            var next = Object.assign({}, prev);
            savedImages.forEach(function (image) {
              next[image.id] = { name: image.name, type: image.type, url: image.url, thumb: image.thumb };
            });
            return next;
          });
          var block = docRef.current.find(function (n) { return n.id === pendingBlockId; });
          if (!block) return;
          var newAttrs = Object.assign({}, block.attrs || {});
          if (block.type === 'gallery') {
            /* 仅存 fileId，dataUrl 不写入 localStorage 防撑爆限额 */
            newAttrs.items = (newAttrs.items || []).concat(savedImages.map(function (image) { return { fileId: image.id }; }));
          } else {
            newAttrs.fileId = savedImages[0].id;
          }
          updateBlock(pendingBlockId, { attrs: newAttrs });
          doSave(JSON.parse(JSON.stringify(docRef.current)));
        })();
        window._pendingCardReaders.push(pendingPromise);
        pendingPromise.then(function () {
          var idx = window._pendingCardReaders.indexOf(pendingPromise);
          if (idx >= 0) window._pendingCardReaders.splice(idx, 1);
        });
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
  var handleEditorInput = useCallback(function (e) {
    var inputTarget = e && e.target;
    if (editorBodyRef.current && !(inputTarget && inputTarget.closest && inputTarget.closest('[data-music-url="pending"]'))) {
      delete editorBodyRef.current.dataset.activeMusicInputId;
    }
    if (!hasTyped) setHasTyped(true);
    // Contenteditable may copy data-blockid when Enter splits a paragraph. Normalize
    // immediately so slash commands target the new line instead of replacing its sibling.
    var curEl = editorBodyRef.current;
    if (curEl) {
      var seenBlockIds = Object.create(null);
      var repairedBlockIds = false;
      Array.prototype.forEach.call(curEl.children, function (block) {
        if (!block || !block.dataset) return;
        var blockId = block.dataset.blockid;
        if (!blockId || seenBlockIds[blockId]) {
          blockId = genId();
          block.dataset.blockid = blockId;
          repairedBlockIds = true;
        }
        seenBlockIds[blockId] = true;
      });
      if (repairedBlockIds) {
        docRef.current = parseEditorDOM(curEl);
        setEditorDocRef(docRef.current);
      }
    }
    // 即时检测斜杠，不等 80ms 延迟
    try {
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
        var convertedBlock = null;
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
                convertedBlock = doc[pi];
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
              convertedBlock = newBlock;
              changed = true;
              break;
            }
          }
          if (changed) break;
        }
        if (changed) {
          recordUndoPoint();
          setEditorDocRef(doc);
          // 只替换命中块，不全量重渲 —— 全量 innerHTML 会丢光标
          var hitEl = convertedBlock ? el.querySelector('[data-blockid="' + convertedBlock.id + '"]') : null;
          if (hitEl && convertedBlock) {
            hitEl.outerHTML = renderDocToEditorHTML([convertedBlock], filesRef.current);
            var focusEl = el.querySelector('[data-blockid="' + convertedBlock.id + '"]');
            var caretAt = convertedBlock.children && convertedBlock.children[0] ? (convertedBlock.children[0].text || '').length : 0;
            if (focusEl) {
              focusEditableWithCaret(focusEl, caretAt);
              try { focusEl.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
            }
          } else {
            el.innerHTML = renderDocToEditorHTML(doc, filesRef.current);
          }
        }
      }
      updateSlashStateFromSelection();
      triggerAutoSave();
    }, 80);
  }, [triggerAutoSave, updateSlashStateFromSelection]);
  var handleEditorKeyDown = useCallback(function (e) {
    var host = editorBodyRef.current;
    if (host && host.dataset.activeMusicInputId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) {
      var keySel = window.getSelection();
      var keyNode = keySel && keySel.focusNode;
      var keyEl = keyNode ? keyNode.nodeType === 1 ? keyNode : keyNode.parentElement : null;
      if (!keyEl || !keyEl.closest || !keyEl.closest('[data-music-url="pending"]')) delete host.dataset.activeMusicInputId;
    }
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
        /* 空段落 Backspace 不再连带删除前一个原子块（图片/附件/链接卡），只合拢光标 */
        if (prevEl && prevEl.contentEditable === 'false') {
          var target = prevEl.previousElementSibling;
          while (target && target.contentEditable === 'false') target = target.previousElementSibling;
          if (target) {
            var range = document.createRange();
            range.selectNodeContents(target);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            if (target.contentEditable !== 'false') target.focus();
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
    // React paste events can target the editable music placeholder before the browser selection updates.
    var eventMusicInput = e.target && e.target.closest && e.target.closest('[data-music-url="pending"]');
    // Mobile paste can be retargeted to the editor host while the capsule itself
    // remains the focused editable. Prefer the real focused element before a stale selection.
    var activeEl = document.activeElement;
    var activeMusicInput = activeEl && activeEl.closest && activeEl.closest('[data-music-url="pending"]');
    var markedMusicInput = null;
    var host = editorBodyRef.current;
    var markedId = host && host.dataset.activeMusicInputId;
    if (!eventMusicInput && e.target === host && markedId) {
      markedMusicInput = host.querySelector('[data-blockid="' + markedId + '"][data-music-url="pending"]');
    }
    var musicInput = eventMusicInput || activeMusicInput || markedMusicInput || (focusEl && focusEl.closest('[data-music-url="pending"]'));
    if (musicInput) {
      e.preventDefault();
      closeSlashPanel();
      /* 从粘贴文本中提取 URL（支持文本混有链接），否则尝试补协议后直接使用 */
      var muRaw = trimmed;
      var muUrl = extractUrlFromText(muRaw);
      if (!muUrl && /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(muRaw)) muUrl = muRaw;
      if (!muUrl) muUrl = muRaw;
      if (!muUrl.startsWith('http')) muUrl = 'https://' + muUrl;
      var mId = musicInput.dataset.blockid;
      if (host && host.dataset.activeMusicInputId === mId) delete host.dataset.activeMusicInputId;
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
      var musicCardEl = editorBodyRef.current && editorBodyRef.current.querySelector('[data-blockid="' + mId + '"]');
      var afterMusicCard = musicCardEl && musicCardEl.nextElementSibling;
      if (afterMusicCard && afterMusicCard.contentEditable !== 'false') {
        var afterRange = document.createRange();
        afterRange.selectNodeContents(afterMusicCard);
        afterRange.collapse(true);
        var afterSelection = window.getSelection();
        if (afterSelection) { afterSelection.removeAllRanges(); afterSelection.addRange(afterRange); }
        afterMusicCard.focus();
      }
      triggerAutoSave();
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
            if (hasCv) rh += '<div class="lkc-cover"><img src="' + escapeHTML(cv) + '" alt=""></div>';
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
        var errIdx = docRef.current.findIndex(function (n) { return n.id === mId; });
        if (errIdx !== -1) docRef.current[errIdx].status = 'error';
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
    var MUSIC_OR_MEDIA_RE = /music\.163\.com|163cn\.tv|y\.qq\.com|i\.y\.qq\.com|open\.spotify\.com|music\.apple\.com|b23\.tv|xiaohongshu\.com|xhslink\.com/i;
    if (isPureUrl) {
      e.preventDefault();
      closeSlashPanel();
      insertLinkCardAtDOM(trimmed);
      return;
    }
    if (embeddedUrl && MUSIC_OR_MEDIA_RE.test(embeddedUrl)) {
      e.preventDefault();
      closeSlashPanel();
      insertLinkCardAtDOM(embeddedUrl);
      return;
    }
    if (embeddedUrl && !looksLikeMarkdown(trimmed)) {
      // 文本里夹着普通链接：链接转链接卡，剩余文本保留原位
      e.preventDefault();
      closeSlashPanel();
      insertLinkCardAtDOM(embeddedUrl).then(function () {
        var remain = trimmed.replace(embeddedUrl, '').trim();
        if (remain) {
          var el = editorBodyRef.current;
          if (!el) return;
          var lastP = el.lastElementChild;
          if (!lastP || lastP.contentEditable === 'false' || lastP.tagName === 'HR') {
            lastP = document.createElement('p');
            lastP.dataset.blockid = window.MynoteId.genId();
            lastP.innerHTML = '<br>';
            el.appendChild(lastP);
          }
          lastP.textContent = remain;
          setEditorDocRef(docRef.current);
          docRef.current = parseEditorDOM(el);
          triggerAutoSave();
        }
      });
      return;
    }
    /* 截图 / 复制图片：直接作为附件插入，而不是把二进制当文本丢掉 */
    var clipItems = e.clipboardData && e.clipboardData.items;
    if (clipItems) {
      var imageFiles = [];
      for (var ci = 0; ci < clipItems.length; ci++) {
        var item = clipItems[ci];
        if (item.kind === 'file' && item.type && item.type.indexOf('image/') === 0) {
          var f = item.getAsFile();
          if (f) imageFiles.push(f);
        }
      }
      if (imageFiles.length) {
        e.preventDefault();
        for (var fi = 0; fi < imageFiles.length; fi++) insertAttachmentAtCursor(imageFiles[fi]);
        return;
      }
    }
    e.preventDefault();
    document.execCommand('insertText', false, text);
    clearTimeout(inputTimerRef.current);
    inputTimerRef.current = setTimeout(function () {
      setEditorDocRef(docRef.current);
      docRef.current = parseEditorDOM(editorBodyRef.current);
      triggerAutoSave();
    }, 80);
  }, [insertLinkCardAtDOM, triggerAutoSave, insertAttachmentAtCursor, closeSlashPanel]);

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
  // click/todo/blur/focus 管线抽到 use-editor-dom.js
  var Dom = window.MynoteEditorHooks.useEditorDom({
    editorBodyRef: editorBodyRef,
    docRef: docRef,
    filesRef: filesRef,
    files: files,
    setFiles: setFiles,
    memo: memo,
    triggerAutoSave: triggerAutoSave,
    recordUndoPoint: recordUndoPoint,
    setRenderKey: setRenderKey,
    setEditorScrolled: setEditorScrolled,
    setEditingTitle: setEditingTitle,
    isEditingTitleRef: isEditingTitleRef,
    editingStyleSnapshot: editingStyleSnapshot,
    editorFocusedRef: editorFocusedRef,
    closedRef: closedRef,
    mdCheckTimerRef: mdCheckTimerRef,
    blurApplyingRef: blurApplyingRef,
    showMenu: showMenu,
    closeEditorMenu: closeEditorMenu,
    showSlash: showSlash,
    slashApplyingRef: slashApplyingRef,
    slashHideTimerRef: slashHideTimerRef,
    slashTargetBlockRef: slashTargetBlockRef,
    setSlashQuery: setSlashQuery,
    setSlashTargetBlockId: setSlashTargetBlockId,
    setLightboxSrc: setLightboxSrc,
    pendingImageBlockRef: pendingImageBlockRef,
    fileInputRef: fileInputRef,
    heightMap: heightMap,
    ensureTrailingParagraphBlock: ensureTrailingParagraphBlock,
    setHasTyped: setHasTyped,
    inputTimerRef: inputTimerRef,
    parseEditorDOM: parseEditorDOM,
    renderDocToEditorHTML: renderDocToEditorHTML,
    renderAtomicHTML: renderAtomicHTML,
    renderMarkdownHtml: renderMarkdownHtml,
    escapeHTML: escapeHTML
  });
  var handleEditorClick = Dom.handleEditorClick;
  var handleTodoClick = Dom.handleTodoClick;
  var handleEditorBlur = Dom.handleEditorBlur;
  var handleEditorFocus = Dom.handleEditorFocus;
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
    className: "editor-body" + (!hasTyped && docRef.current && docRef.current.length === 1 && docRef.current[0].type === 'paragraph' && !(docRef.current[0].children && docRef.current[0].children[0] && docRef.current[0].children[0].text) ? ' show-placeholder' : ''),
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
    accept: "image/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    onChange: handleFilesSelected,
    style: {
      display: "none"
    }
  }), showSlash && /*#__PURE__*/window.MynoteSlashPanel({
    slashRef: slashRef,
    editorBodyRef: editorBodyRef,
    slashAnchor: slashAnchor,
    slashClosing: slashClosing,
    slashEntered: slashEntered,
    slashCommands: slashCommands,
    slashQuery: slashQuery,
    slashSelectedIndex: slashSelectedIndex,
    setSlashSelectedIndex: setSlashSelectedIndex,
    applySlashCommand: applySlashCommand,
    slashApplyingRef: slashApplyingRef,
    suppressPointerClickRef: suppressPointerClickRef,
    pointerClickTimerRef: pointerClickTimerRef,
    SVG_ICONS: SlashSVGIcons
  }), showColorPicker && /*#__PURE__*/React.createElement(BgSheet, {
    currentColor: bgColor,
    onSelect: value => {
      setBgColor(value);
      // 只传 delta；展开旧 memo 会把 __isNewNote 和可能过期的 doc 写回存储
      onSave(memo.id, { bgColor: value });
      setShowColorPicker(false);
    },
    onRemove: () => {
      setBgColor(null);
      onSave(memo.id, { bgColor: null });
      setShowColorPicker(false);
    },
    onClose: () => setShowColorPicker(false)
  }), lightboxSrc && /*#__PURE__*/React.createElement('div', {
    onClick: function () { setLightboxSrc(null); },
    style: { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }
  }, /*#__PURE__*/React.createElement('img', { src: lightboxSrc, alt: '', style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 'var(--radius-12)' } }))));
}

window.MynoteEditorPage = Editor;
