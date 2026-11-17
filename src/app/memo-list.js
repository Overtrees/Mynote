/* 列表页、搜索、分组与视图切换。 */
/* ---------- SettingsView ---------- */
var SettingsView = window.SettingsView;
var SwipeRow = window.SwipeRow;
var ImageCard = window.ImageCard;
var BackupView = window.BackupView;
var BgSheet = window.BgSheet;
// 支持 ?open=id URL 参数自动打开笔记（用于截图/分享）

/* ---------- 本地全文匹配（不宣称不完整的拼音模糊匹配） ---------- */
function memoSearchText(value, out) {
  out = out || [];
  if (typeof value === 'string') { out.push(value); return out; }
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) { value.forEach(function (item) { memoSearchText(item, out); }); return out; }
  Object.keys(value).forEach(function (key) {
    if (/^(id|fileId|dataUrl|url|blob|thumb|imageData)$/i.test(key)) {
      if (/^(url)$/i.test(key) && typeof value[key] === 'string' && !/^data:/i.test(value[key])) out.push(value[key]);
      return;
    }
    if (typeof value[key] === 'string' && /^(text|title|subtitle|source|name|label|alt|description|content)$/i.test(key)) out.push(value[key]);
    else if (value[key] && typeof value[key] === 'object') memoSearchText(value[key], out);
  });
  return out;
}
function matchesMemoSearch(memo, query) {
  var q = String(query || '').toLowerCase();
  var fields = [memo && memo.title].concat(memoSearchText(memo && memo.doc));
  var text = fields.filter(Boolean).join(' ').toLowerCase();
  return text.indexOf(q) >= 0;
}

/* ---------- 城市名英转中 ---------- */

var __preopenNoteId = (function(){try{var m=window.location.search.match(/[?&]open=([^&]+)/);return m?decodeURIComponent(m[1]):null}catch(e){return null}})();
function MemoList() {
  // ===== IndexedDB 主存储：先清，挂载后从 IDB 加载（localStorage 为只读备份） =====
  const [memos, setMemos] = useState([]);
  const memosRef = useRef([]);
  const skipSaveCountRef = useRef(0);
  const saveMountedRef = useRef(true);
  useEffect(function() { return function() { saveMountedRef.current = false; }; }, []);
  useEffect(() => { memosRef.current = memos; }, [memos]);
  const [weather, setWeather] = useState(function() {
    try { var d = WeatherCache.get(); return d || null; } catch(e) { return null; }
  }());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [homeAvatar, setHomeAvatar] = useState(localStorage.getItem("google_avatar") || null);
  const [view, setView] = useState('list'); // 'list' | 'settings' | 'backup'
  const weatherRefreshRef = useRef(null);
  useEffect(function() {
    setHomeAvatar(localStorage.getItem("google_avatar") || null);
    refreshGoogleAvatar().then(function(){
      setHomeAvatar(localStorage.getItem("google_avatar") || null);
    });
    if (view === 'list') {
      clearTimeout(weatherRefreshRef.current);
      weatherRefreshRef.current = setTimeout(function() {
        fetchWeather().then(function(r){ if (r && r !== weather) setWeather(r); });
      }, 1500);
    }
  }, [view]);
  useEffect(function() {
    return function() { clearTimeout(weatherRefreshRef.current); };
  }, []);
  var idbInited = useRef(false);
  function tryOpenNote(list) {
    if (typeof __preopenNoteId !== 'undefined' && __preopenNoteId) {
      var found = list.filter(function(m) { return m && (m.id === __preopenNoteId || (m.title || '').indexOf(__preopenNoteId) >= 0); });
      if (found.length > 0) { setEditingMemoId(found[0].id); }
    }
  }
  /* 历史数据修复：早期待办图标曾以内联 data:URI 文本落进正文，读入时清除 */
  var ICON_TEXT_RE = /data:image\/svg\+xml[\s\S]*?%3C\/svg%3E|data:image\/svg\+xml[^\s]*/g;
  function cleanDocIconText(doc) {
    var changed = false;
    if (!Array.isArray(doc)) return changed;
    for (var bi = 0; bi < doc.length; bi++) {
      var blk = doc[bi];
      if (!blk || !Array.isArray(blk.children)) continue;
      for (var ci = 0; ci < blk.children.length; ci++) {
        var ch = blk.children[ci];
        if (!ch || typeof ch.text !== 'string' || ch.text.indexOf('data:image/svg+xml') === -1) continue;
        var cleaned = ch.text.replace(ICON_TEXT_RE, '').replace(/\s+/g, ' ').trim();
        if (cleaned !== ch.text) { ch.text = cleaned; changed = true; }
      }
    }
    return changed;
  }

  function normalizeMemo(m) {
    if (!m.doc && m.content !== undefined) {
      return Object.assign({}, m, {
        doc: [{ id: genId(), type: "paragraph", children: [{ text: m.content || "" }] }],
        content: undefined,
        createdAt: m.createdAt || m.updatedAt || new Date().toISOString()
      });
    }
    if (!m.doc) return Object.assign({}, m, {
      doc: [{ id: genId(), type: "paragraph", children: [{ text: "" }] }],
      createdAt: m.createdAt || m.updatedAt || new Date().toISOString()
    });
    if (!m.createdAt) m.createdAt = m.updatedAt || new Date().toISOString();
    cleanDocIconText(m.doc);
    return m;
  }
  function runAttachmentMigration(db, memos) {
    if (!db || !memos) return;
    setTimeout(function() {
      (async function() {
        try {
          var changed = false;
          for (var mi = 0; mi < memos.length; mi++) {
            var m = memos[mi];
            if (!m.doc) continue;
            for (var ni2 = 0; ni2 < m.doc.length; ni2++) {
              var nd = m.doc[ni2];
              if (nd.type === 'attachment' && nd.image === undefined && nd.fileId) {
                try {
                  var att = await loadAttachmentFromDB(db, nd.fileId);
                  nd.image = att && att.type ? att.type.indexOf('image/') === 0 : false;
                  changed = true;
                } catch(_) { nd.image = false; }
              }
            }
          }
          if (changed) {
            setMemos(memos.slice());
            try { localStorage.setItem("memos_app_v2", JSON.stringify(memos)); } catch(e) {}
            // image 标记也要写回 IDB，否则下次启动重跑迁移
            (async function() {
              try {
                var db2 = await (window.MynoteIdb ? window.MynoteIdb.getDB() : null);
                if (db2) await window.MynoteIdb.saveMemosToDB(db2, memos);
              } catch(_) {}
            })();
          }
        } catch(_) {}
      })();
    }, 0);
  }
  useEffect(function() {
    if (idbInited.current) return;
    idbInited.current = true;
    (async function() {
      try {
        var db = await window.MynoteIdb.getDB();
        if (db) {
          var stored = await window.MynoteIdb.loadMemosFromDB(db);
          if (stored && stored.length > 0) {
            var ns = stored.map(normalizeMemo);
            // 给已有附件补 image 标记
            runAttachmentMigration(db, ns);
            setMemos(ns);
            tryOpenNote(ns);
            return;
          }
        }
        // IDB 无数据 → localStorage 回退（迁移）
        var saved = localStorage.getItem("memos_app_v2");
        var parsed = saved ? JSON.parse(saved) : [];
        var normalized = parsed.map(normalizeMemo);
        if (normalized.length === 0) {
          normalized = window.MynoteDemo.buildBuiltinMemos();
        }
        if (db && normalized.length > 0) {
          await window.MynoteIdb.saveMemosToDB(db, normalized);
        }
        try { localStorage.setItem("memos_app_v2", JSON.stringify(normalized)); } catch(e) {}
        setMemos(normalized);
        // migration: add image flag to existing attachments
        (async function() {
          runAttachmentMigration(db, normalized);
        })();
        tryOpenNote(normalized);
      } catch(e) { console.warn('[此刻] MemoList IDB init', e); }
    })();
  }, []);
  const [editingMemoId, setEditingMemoId] = useState(null);
  const [newEditorAutoFocusId, setNewEditorAutoFocusId] = useState(null);
  const isNewNoteRef = useRef(false);
  const editingMemo = editingMemoId ? memos.find(m => m.id === editingMemoId) || null : null;
  const scrollRestoreRef = useRef(0);

  const [scrollY, setScrollY] = useState(0);
  const TITLE_THRESHOLD = 30;
  const scrollTimerRef = useRef(null);
  const rafRef = useRef(null);
  useEffect(() => {
    const titleEl = document.querySelector('.page-title');
    const handleScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setScrollY(Math.max(0, window.scrollY));
        if (titleEl) titleEl.classList.add('scrolling');
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = setTimeout(() => {
          if (titleEl) titleEl.classList.remove('scrolling');
        }, 200);
      });
    };
    window.addEventListener('scroll', handleScroll, {
      passive: true
    });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);
  const shrinkProgress = Math.min(Math.max(scrollY / TITLE_THRESHOLD, 0), 1);
  const titleScale = 1 - shrinkProgress * 0.45;
  const titleTranslateY = shrinkProgress * -4;
  const titleOpacity = 1 - shrinkProgress * 0.3;
  const isCompact = shrinkProgress >= 1;
  useEffect(() => {
    if (skipSaveCountRef.current > 0) return;
    try {
      const safe = memos.map(m => ({
        ...m,
        doc: m.doc
      }));
      localStorage.setItem("memos_app_v2", JSON.stringify(safe));
      // 同步到 IndexedDB
      (async function() {
        try {
          var db = await window.MynoteIdb.getDB();
          if (db) await window.MynoteIdb.saveMemosToDB(db, safe);
        } catch(e) { console.warn('[此刻] IDB save', e); }
      })();
    } catch (e) { console.warn('[此刻] localStorage save', e); }
  }, [memos]);
  const openEditor = memo => {
    if (memo.id === NEW_CARD_ID) {
      handleNew();
      return;
    }
    isNewNoteRef.current = false;
    scrollRestoreRef.current = window.scrollY;
    window.scrollTo(0, 0);
    setEditingMemoId(memo.id);
  };
  const closeEditor = () => {
    const savedScroll = scrollRestoreRef.current;
    setEditingMemoId(null);
    setNewEditorAutoFocusId(null);
    if (savedScroll > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo(0, savedScroll);
        });
      });
    }
  };
  const handleNew = () => {
    const now = new Date().toISOString();
    const newMemo = {
      id: genId(),
      title: "无标题",
      doc: [{
        id: genId(),
        type: "paragraph",
        children: [{
          text: ""
        }]
      }],
      pinned: false,
      createdAt: now,
      updatedAt: now
    };
    scrollRestoreRef.current = window.scrollY;
    isNewNoteRef.current = true;
    setNewEditorAutoFocusId(newMemo.id);
    flushSync(() => {
      setMemos(ms => [newMemo, ...ms]);
      setEditingMemoId(newMemo.id);
    });
    const focusNow = () => {
      const firstBlock = document.querySelector('[data-type="paragraph"]');
      if (!firstBlock) return false;
      return focusEditableWithCaret(firstBlock, 0);
    };
    if (!focusNow()) {
      requestAnimationFrame(() => {
        focusNow() || requestAnimationFrame(() => focusNow());
      });
    }
  };
  const togglePin = id => {
    if (id === NEW_CARD_ID) return;
    setMemos(ms => ms.map(m => m.id === id ? Object.assign({}, m, {
      pinned: !m.pinned,
      updatedAt: new Date().toISOString()
    }) : m));
  };
  // 收集一条笔记引用到的全部附件 fileId（attachment / image / gallery / imgTextCard / imageTextRow）
  const collectMemoFileIds = (memo) => {
    const ids = [];
    const push = fid => { if (fid && ids.indexOf(fid) === -1) ids.push(fid); };
    const doc = (memo && memo.doc) || [];
    for (let i = 0; i < doc.length; i++) {
      const n = doc[i];
      if (!n) continue;
      if (n.type === 'attachment') { push(n.fileId); continue; }
      const a = n.attrs || {};
      push(a.fileId);
      if (Array.isArray(a.items)) {
        for (let j = 0; j < a.items.length; j++) {
          const it = a.items[j];
          if (it && typeof it === 'object') push(it.fileId);
          else if (typeof it === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(it)) push(it);
        }
      }
    }
    return ids;
  };
  const deleteMemo = async id => {
    if (id === NEW_CARD_ID) return;
    const before = memosRef.current || memos;
    const target = before.find(m => m.id === id);
    const next = before.filter(m => m.id !== id);
    // Persist the memo removal first; never remove a shared file while any memo references it.
    memosRef.current = next;
    setMemos(next);
    if (editingMemo && editingMemo.id === id) closeEditor();
    try {
      const db = await getDB();
      await window.MynoteIdb.saveMemosToDB(db, next);
      if (!target) return;
      await window.MynoteIdb.deleteUnreferencedAttachments(db, collectMemoFileIds(target));
    } catch(e) {
      console.warn('[此刻] delete memo persistence', e);
      if (memosRef.current === next) { memosRef.current = before; setMemos(before); }
    }
  };
  const saveMemo = useCallback((id, changes) => {
    const before = memosRef.current || [];
    const previousMemo = before.find(m => m.id === id);
    let next = changes && changes._delete
      ? before.filter(m => m.id !== id)
      : before.map(m => m.id === id ? Object.assign({}, m, changes) : m);
    // bgColor: null → 删除字段，而不是留一个 null/undefined
    if (changes && !changes._delete && Object.prototype.hasOwnProperty.call(changes, 'bgColor') && changes.bgColor == null) {
      next = next.map(m => {
        if (m.id !== id) return m;
        const copy = Object.assign({}, m);
        delete copy.bgColor;
        return copy;
      });
    }
    skipSaveCountRef.current += 1;
    memosRef.current = next;
    setMemos(next);
    // localStorage 先同步落盘：IDB 失败/页面关闭时缓存不丢
    try { localStorage.setItem("memos_app_v2", JSON.stringify(next.map(m => ({ ...m, doc: m.doc })))); }
    catch (cacheError) { console.warn('[此刻] memo cache write failed', cacheError); }
    return (async function() {
      try {
        const safe = next.map(m => ({
          ...m,
          doc: m.doc
        }));
        if (saveMountedRef.current) {
          var db = await window.MynoteIdb.getDB();
          if (saveMountedRef.current && db) {
            await window.MynoteIdb.saveMemosToDB(db, safe);
            // Reclaim removed files only after the memo commit and only when no remaining note references them.
            if (previousMemo && previousMemo.doc) {
              const nextMemo = next.find(m => m.id === id);
              const stillInEdited = new Set(nextMemo ? collectMemoFileIds(nextMemo) : []);
              const removed = collectMemoFileIds(previousMemo).filter(fid => !stillInEdited.has(fid));
              await window.MynoteIdb.deleteUnreferencedAttachments(db, removed);
            }
          }
        }
      } catch (e) { console.warn('[此刻] memo save flush', e); }
      finally { skipSaveCountRef.current = Math.max(0, skipSaveCountRef.current - 1); }
    })();
  }, []);
  const newCardDoc = useMemo(() => [{
    id: genId(),
    type: "paragraph",
    children: [{
      text: ""
    }]
  }], []);
  const sorted = useMemo(() => {
    return [...memos].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [memos]);
  const filteredMemos = useMemo(() => {
    if (!searchQuery) return sorted;
    var q = searchQuery.toLowerCase();
    return sorted.filter(function(m) { return matchesMemoSearch(m, q); });
  }, [sorted, searchQuery]);
  const hasImageAttachment = useCallback(memo => {
    return memo.doc && memo.doc.some(function(n) {
      return n.type === 'image' || n.type === 'gallery' || n.type === 'imgTextCard' || n.type === 'imageTextRow' || (n.type === 'attachment' && n.image);
    });
  }, []);
  const [expandedBlocks, setExpandedBlocks] = useState(() => new Set());
  const toggleBlock = useCallback(id => {
    setExpandedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);else next.add(id);
      return next;
    });
  }, []);
  const groupedItems = useMemo(() => {
    const groups = [];
    let pinnedImageMemos = [],
      pinnedTextMemos = [];
    let currentLabel = null,
      curImg = [],
      curTxt = [];
    filteredMemos.forEach(memo => {
      var isImage = hasImageAttachment(memo);
      if (memo.pinned) {
        if (isImage) pinnedImageMemos.push(memo);else pinnedTextMemos.push(memo);
        return;
      }
      const label = getSectionLabel(memo.createdAt || memo.updatedAt);
      if (label !== currentLabel) {
        if (currentLabel !== null && (curImg.length > 0 || curTxt.length > 0)) groups.push({
          label: currentLabel,
          imageMemos: curImg,
          textMemos: curTxt
        });
        currentLabel = label;
        curImg = [];
        curTxt = [];
      }
      if (isImage) curImg.push(memo);else curTxt.push(memo);
    });
    if (currentLabel !== null && (curImg.length > 0 || curTxt.length > 0)) groups.push({
      label: currentLabel,
      imageMemos: curImg,
      textMemos: curTxt
    });
    if (pinnedImageMemos.length > 0 || pinnedTextMemos.length > 0) groups.unshift({
      label: "置顶",
      imageMemos: pinnedImageMemos,
      textMemos: pinnedTextMemos
    });
    return groups;
  }, [filteredMemos, hasImageAttachment]);
  const isEditorOpen = !!editingMemo;
  if (view === 'backup') {
    return /*#__PURE__*/React.createElement(BackupView, {
      onClose: () => setView('settings')
    });
  }
  if (view === 'settings') {
    return /*#__PURE__*/React.createElement(SettingsView, {
      onClose: () => setView('list'),
      onOpenBackup: () => setView('backup')
    });
  }
  if (editingMemo) return /*#__PURE__*/React.createElement(Editor, { memo: editingMemo ? Object.assign({}, editingMemo, { __isNewNote: isNewNoteRef.current }) : null, onClose: closeEditor, onSave: saveMemo, autoFocus: newEditorAutoFocusId === editingMemo.id });
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", { className: "page-title compact", style: { visibility: isCompact ? 'visible' : 'hidden', opacity: isCompact ? 1 : 0, pointerEvents: 'auto', cursor: 'pointer', width: 'fit-content', margin: '0 auto' }, onClick: () => setView('settings') }, "\u6B64\u523B"), /*#__PURE__*/React.createElement("div", { style: { position: "relative", backgroundColor: "var(--primary-bg)", animation: "slideInFromRight var(--motion-page-transition) cubic-bezier(0.22,0.61,0.36,1) both" } }, /*#__PURE__*/React.createElement("header", {
    className: "main-header"
  }, /*#__PURE__*/React.createElement("div", {
    className: "header-actions"
  })), /*#__PURE__*/React.createElement("div", { style: { position: "relative" } }, /*#__PURE__*/React.createElement("h1", {
    className: "page-title",
    style: {
      transform: `scale(${titleScale}) translateY(${titleTranslateY}px)`,
      opacity: isCompact ? 0 : titleOpacity,
      visibility: isCompact ? 'hidden' : 'visible',
      transformOrigin: 'left center',
      pointerEvents: 'auto',
      cursor: 'pointer',
      display: 'inline-block',
      width: 'fit-content'
    },
    onClick: () => setView('settings')
  }, homeAvatar ? /*#__PURE__*/React.createElement("img", {
    src: homeAvatar,
    alt: "",
    style: {
      width: 72,
      height: 72,
      borderRadius: "var(--radius-circle)",
      display: "block",
      objectFit: "cover"
    }
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      width: 72,
      height: 72,
      backdropFilter: "var(--glass-control-filter)",
      WebkitBackdropFilter: "var(--glass-control-filter)",
      borderRadius: "var(--radius-circle)",
      background: "var(--glass-control-bg)",
      border: "0.5px solid var(--glass-control-border)",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 512 512",
    style: { transform: "translateY(10px)" },
    width: 64,
    height: 64,
    fill: "none",
    stroke: "var(--color-icon-muted)",
    strokeWidth: 22,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", { d: "M 90,460 L 90,170 C 90,110 140,70 210,70 L 380,95 C 440,95 470,130 470,185 C 470,225 450,240 410,245 C 350,250 280,230 210,265 C 190,275 190,295 210,310 C 270,350 350,380 410,360 C 435,350 440,325 410,315" }),
    /*#__PURE__*/React.createElement("path", { d: "M 160,330 C 180,380 230,440 280,460" }),
    /*#__PURE__*/React.createElement("path", { d: "M 240,365 C 220,400 240,440 310,460" }),
    /*#__PURE__*/React.createElement("path", { d: "M 90,460 L 310,460" }),
    /*#__PURE__*/React.createElement("path", { d: "M 415,135 C 425,140 435,150 435,160" }),
    /*#__PURE__*/React.createElement("path", { d: "M 230,115 C 260,95 310,120 355,140" }),
    /*#__PURE__*/React.createElement("path", { d: "M 255,140 C 255,170 290,195 320,185 C 345,175 350,150 335,135" }),
    /*#__PURE__*/React.createElement("path", { d: "M 290,145 C 290,165 315,165 315,150" }),
    /*#__PURE__*/React.createElement("path", { d: "M 250,243 L 255,265 L 265,243 M 275,245 L 282,270 L 292,245 M 302,246 L 310,273 L 320,247 M 330,248 L 340,275 L 350,248 M 360,249 L 370,274 L 380,248 M 390,248 L 400,270 L 408,246 M 415,244 L 425,263 L 432,240 M 438,235 L 448,252 L 452,228" }),
    /*#__PURE__*/React.createElement("path", { d: "M 250,323 L 255,305 L 263,326 M 273,329 L 280,308 L 288,333 M 298,336 L 306,313 L 314,340 M 324,343 L 333,318 L 341,346 M 351,348 L 361,323 L 369,351 M 379,352 L 389,328 L 396,353 M 404,351 L 413,330 L 418,348" })))), searchOpen ? /*#__PURE__*/React.createElement("div", {
    className: "glass-search-panel",
    style: {
      position: "absolute",
      right: 20,
      top: 7,
      height: 66,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 14px",
      borderRadius: "var(--radius-999)",
      background: "var(--glass-overlay-bg)",
      backdropFilter: "var(--glass-overlay-filter)",
      WebkitBackdropFilter: "var(--glass-overlay-filter)",
      border: "0.5px solid var(--glass-overlay-border)",
      opacity: isCompact ? 0 : 1,
      visibility: isCompact ? "hidden" : "visible",
      transition: "opacity var(--motion-page-transition) ease"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    fill: "none",
    stroke: "var(--text-secondary)",
    strokeWidth: 2.5,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("circle", { cx: 11, cy: 11, r: 8 }), /*#__PURE__*/React.createElement("line", { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })), /*#__PURE__*/React.createElement("input", {
    className: "glass-search-input",
    "aria-label": "搜索笔记",
    autoFocus: true,
    placeholder: "\u641C\u7D22\u7B14\u8BB0...",
    value: searchQuery,
    onChange: (e) => setSearchQuery(e.target.value),
    onBlur: () => setSearchOpen(false),
    onKeyDown: (e) => { if (e.key === "Escape") { e.preventDefault(); setSearchOpen(false); } },
    style: {
      width: 140,
      height: 40,
      border: "none",
      background: "transparent",
      fontSize: "var(--font-15)",
      color: "var(--text-main)",
      outline: "none",
      fontFamily: "inherit"
    }
  })) : /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "glass-search-trigger",
    "aria-label": "搜索笔记",
    onClick: () => setSearchOpen(true),
    style: {
      position: "absolute",
      right: 20,
      top: 7,
      height: 66,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      padding: "0 18px",
      borderRadius: "var(--radius-999)",
      background: "var(--glass-control-bg)",
      backdropFilter: "var(--glass-control-filter)",
      WebkitBackdropFilter: "var(--glass-control-filter)",
      border: "0.5px solid var(--glass-control-border)",
      cursor: "pointer",
      pointerEvents: "auto",
      opacity: isCompact ? 0 : 1,
      visibility: isCompact ? "hidden" : "visible",
      transition: "opacity var(--motion-page-transition) ease",
      color: "var(--glass-label-color)",
      fontFamily: "inherit"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: 20,
    height: 20,
    fill: "none",
    stroke: "var(--text-secondary)",
    strokeWidth: 2.5,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("circle", { cx: 11, cy: 11, r: 8 }), /*#__PURE__*/React.createElement("line", { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })), /*#__PURE__*/React.createElement("span", {
    style: { fontSize: "var(--font-14)", color: "var(--glass-label-color)", letterSpacing: "-0.1px" }
  }, "\u641C\u7D22"))), /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement("div", {
    className: "list-group"
  }, /*#__PURE__*/React.createElement(SwipeRow, {
    memo: {
      id: NEW_CARD_ID,
      title: "新建笔记",
      doc: newCardDoc,
      pinned: true,
      createdAt: "",
      updatedAt: "",
      isVirtual: true
    },
    onOpen: () => handleNew(),
    onPin: () => {},
    onDelete: () => {},
    weather: weather
  })), sorted.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty-tip"
  }, "\u6682\u65E0\u7B14\u8BB0\uFF0C\u70B9\u51FB\u4E0A\u65B9\u65B0\u5EFA") : groupedItems.map((group, gi) => /*#__PURE__*/React.createElement("div", {
    key: `group-${group.label}-${gi}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-header"
  }, group.label), group.imageMemos.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "list-group"
  }, group.imageMemos.length > 2 && !expandedBlocks.has(`${group.label}-img`) ? /*#__PURE__*/React.createElement("div", {
    className: "card-expand-wrapper",
    onClick: () => toggleBlock(`${group.label}-img`)
  }, /*#__PURE__*/React.createElement(ImageCard, {
    memo: group.imageMemos[0],
    onOpen: () => toggleBlock(`${group.label}-img`),
    onPin: togglePin,
    onDelete: deleteMemo,
    expandText: `▼ 展开 ${group.imageMemos.length} 条`,
    onExpand: () => toggleBlock(`${group.label}-img`)
  })) : group.imageMemos.map((memo, mi) => /*#__PURE__*/React.createElement("div", {
    key: memo.id,
    onClick: () => openEditor(memo)
  }, /*#__PURE__*/React.createElement(ImageCard, {
    memo: memo,
    onOpen: openEditor,
    onPin: togglePin,
    onDelete: deleteMemo,
    expandText: mi === group.imageMemos.length - 1 && group.imageMemos.length > 2 ? '▲ 收起' : undefined,
    onExpand: () => toggleBlock(`${group.label}-img`)
  })))), group.imageMemos.length > 0 && group.textMemos.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "gap-16"
  }), group.textMemos.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "list-group"
  }, group.textMemos.length > 2 && !expandedBlocks.has(`${group.label}-txt`) ? /*#__PURE__*/React.createElement("div", {
    className: "card-expand-wrapper",
    onClick: () => toggleBlock(`${group.label}-txt`)
  }, /*#__PURE__*/React.createElement(SwipeRow, {
    memo: group.textMemos[0],
    onOpen: () => {},
    onPin: togglePin,
    onDelete: deleteMemo,
    expandText: `▼ 展开 ${group.textMemos.length} 条`,
    onExpand: () => toggleBlock(`${group.label}-txt`)
  })) : group.textMemos.map((memo, mi) => /*#__PURE__*/React.createElement("div", {
    key: memo.id
  }, /*#__PURE__*/React.createElement(SwipeRow, {
    memo: memo,
    onOpen: () => openEditor(memo),
    onPin: togglePin,
    onDelete: deleteMemo,
    expandText: mi === group.textMemos.length - 1 && group.textMemos.length > 2 ? '▲ 收起' : undefined,
    onExpand: () => toggleBlock(`${group.label}-txt`)
  })))))))))
}

window.MynoteMemoList = MemoList;
window.MynoteSearch = { toCn: window.MynoteDemo.toCn, memoSearchText: memoSearchText, matchesMemoSearch: matchesMemoSearch };
