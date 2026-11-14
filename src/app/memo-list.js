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
var CN_CITY = {"Beijing":"北京","Shanghai":"上海","Guangzhou":"广州","Shenzhen":"深圳","Hangzhou":"杭州","Nanjing":"南京","Chengdu":"成都","Wuhan":"武汉","Tianjin":"天津","Chongqing":"重庆","Shenyang":"沈阳","Changchun":"长春","Harbin":"哈尔滨","Dalian":"大连","Qingdao":"青岛","Jinan":"济南","Zhengzhou":"郑州","Changsha":"长沙","Nanchang":"南昌","Hefei":"合肥","Fuzhou":"福州","Xiamen":"厦门","Kunming":"昆明","Guiyang":"贵阳","Lanzhou":"兰州","Xi'an":"西安","Xining":"西宁","Yinchuan":"银川","Nanning":"南宁","Haikou":"海口","Zhuhai":"珠海","Foshan":"佛山","Dongguan":"东莞","Suzhou":"苏州","Wuxi":"无锡","Ningbo":"宁波","Wenzhou":"温州","Changzhou":"常州","Zhongshan":"中山","Huizhou":"惠州","Shantou":"汕头","Zhanjiang":"湛江","Taizhou":"台州","Jiaxing":"嘉兴","Shaoxing":"绍兴","Yangzhou":"扬州","Zhenjiang":"镇江","Nantong":"南通","Xuzhou":"徐州","Luoyang":"洛阳","Guilin":"桂林","Lhasa":"拉萨","Urumqi":"乌鲁木齐","Hohhot":"呼和浩特","Macau":"澳门","Hong Kong":"香港","Taipei":"台北","Kaohsiung":"高雄","Taichung":"台中","Tainan":"台南"};
function toCn(name) {
  if (!name) return name;
  var c = CN_CITY[name];
  if (c) return c;
  return name;
}

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
      var found = list.filter(function(m) { return m && (m.id === __preopenNoteId || m.title.indexOf(__preopenNoteId) >= 0); });
      if (found.length > 0) { setEditingMemoId(found[0].id); console.log('[此刻] auto-open', found[0].id); }
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
          }
        } catch(_) {}
      })();
    }, 0);
  }
  function buildBuiltinMemos() {
    var now = Date.now();
    var day = 86400000;
    function gid() { return genId(); }
    return [
      {
        id: 'demo_exhibit',
        title: '周末看展记录',
        pinned: false,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        doc: [
          { id: gid(), type: 'paragraph', children: [{ text: '今天去了 UCCA 的「非物质再现」展。光线透过亚克力板投射在墙上的影子会随着人的移动变化，站久了会忘记时间。' }] },
          { id: gid(), type: 'paragraph', children: [{ text: '想起上周看的书里那句话：==所谓的边界，只是我们还没习惯的过渡带==' }] },
          { id: gid(), type: 'heading', attrs: { level: 2 }, children: [{ text: '实用信息' }] },
          { id: gid(), type: 'paragraph', children: [{ text: '地址：798 艺术区 UCCA。票价 100 元。' }] }
        ]
      },
      {
        id: 'demo_home',
        title: '装修踩坑清单',
        pinned: true,
        createdAt: new Date(now - day).toISOString(),
        updatedAt: new Date(now - day).toISOString(),
        doc: [
          { id: gid(), type: 'todo', attrs: { checked: true }, children: [{ text: '厨房插座至少留 6 个，台面要带开关' }] },
          { id: gid(), type: 'todo', attrs: { checked: true }, children: [{ text: '卫生间防水刷到 1.8m，闭水试验做满 48h' }] },
          { id: gid(), type: 'todo', attrs: { checked: false }, children: [{ text: '地板和瓷砖之间用极窄收边条，不要过门石' }] },
          { id: gid(), type: 'todo', attrs: { checked: false }, children: [{ text: '衣柜做到顶，不要成品柜，顶部积灰严重' }] }
        ]
      },
      {
        id: 'demo_tools',
        title: '好用的工具网站',
        pinned: false,
        createdAt: new Date(now - 3 * day).toISOString(),
        updatedAt: new Date(now - 3 * day).toISOString(),
        doc: [
          { id: gid(), type: 'paragraph', children: [{ text: '几个日常高频用到的小工具，免费无广告。' }] },
          { id: gid(), type: 'paragraph', children: [{ text: 'Excalidraw — 画架构图和流程图最顺手的白板。' }] },
          { id: gid(), type: 'paragraph', children: [{ text: 'Carbon — 把代码生成漂亮的分享图，支持 20+ 主题。' }] }
        ]
      },
      {
        id: 'demo_book',
        title: '读书笔记｜设计的觉醒',
        pinned: false,
        createdAt: new Date(now - 7 * day).toISOString(),
        updatedAt: new Date(now - 7 * day).toISOString(),
        doc: [
          { id: gid(), type: 'paragraph', children: [{ text: '田中一光的随笔集，断断续续读了一个月。' }] },
          { id: gid(), type: 'paragraph', children: [{ text: '「设计不是一种技能，而是捕捉事物本质的感觉和洞察力。」' }] },
          { id: gid(), type: 'paragraph', children: [{ text: '「整理、排布、思考——设计的本质就是这三件事的循环。」' }] }
        ]
      },
      {
        id: 'demo_music',
        title: '最近在听的歌',
        pinned: false,
        createdAt: new Date(now - 14 * day).toISOString(),
        updatedAt: new Date(now - 14 * day).toISOString(),
        doc: [
          { id: gid(), type: 'heading', attrs: { level: 2 }, children: [{ text: '上周循环最多的几首' }] },
          { id: gid(), type: 'paragraph', children: [{ text: 'She Her Her Hers — Arrows — 吉他前奏一响整个人都松下来了。适合下雨天窝在沙发上单曲循环。' }] },
          { id: gid(), type: 'musicCard', url: 'https://c6.y.qq.com/base/fcgi-bin/u?__=1RE7gOYaMZgO', meta: null, status: 'loading' },
          { id: gid(), type: 'paragraph', children: [{ text: '陶喆 — 月亮代表谁的心 — 晚上十一点半的地铁上听到这首歌，老歌新唱居然听出了不一样的味道。原来有些旋律不管过多少年都不会过期。' }] },
          { id: gid(), type: 'musicCard', url: 'https://music.apple.com/cn/album/%E6%9C%88%E4%BA%AE%E4%BB%A3%E8%A1%A8%E8%B0%81%E7%9A%84%E5%BF%83/914664926?i=914664941', meta: null, status: 'loading' },
          { id: gid(), type: 'paragraph', children: [{ text: '黑裙子 — Our Own Summer — 前奏的鼓点一出来就感觉回到了某个无所事事的夏天傍晚，风吹在脸上是热的，但心里是凉的。' }] },
          { id: gid(), type: 'musicCard', url: 'https://163cn.tv/7ceoWN8', meta: null, status: 'loading' },
          { id: gid(), type: 'paragraph', children: [{ text: '落日飞车 — My Jinji — 适合晚上开车听，吉他音色软软的，像夏天的风从车窗缝里吹进来。' }] },
          { id: gid(), type: 'musicCard', url: 'https://open.spotify.com/track/7npPPrZEDmeHMk6mxvIeFa?si=zp0-QuSsTBWvhaGVKVUfjg', meta: null, status: 'loading' }
        ]
      }
    ];
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
          normalized = buildBuiltinMemos();
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
      id: Date.now().toString(),
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
    const next = changes && changes._delete
      ? before.filter(m => m.id !== id)
      : before.map(m => m.id === id ? Object.assign({}, m, changes) : m);
    skipSaveCountRef.current += 1;
    memosRef.current = next;
    setMemos(next);
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
        // IDB is the source of truth. A full/disabled localStorage must not block its commit.
        try { localStorage.setItem("memos_app_v2", JSON.stringify(safe)); }
        catch (cacheError) { console.warn('[此刻] memo cache write failed', cacheError); }
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
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", { className: "page-title compact", style: { visibility: isCompact ? 'visible' : 'hidden', opacity: isCompact ? 1 : 0, pointerEvents: 'auto', cursor: 'pointer', width: 'fit-content', margin: '0 auto' }, onClick: () => setView('settings') }, "\u6B64\u523B"), /*#__PURE__*/React.createElement("div", { style: { position: "relative", backgroundColor: "var(--primary-bg)", animation: "slideInFromRight 0.35s cubic-bezier(0.32,0.94,0.6,1) both" } }, /*#__PURE__*/React.createElement("header", {
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
      backdropFilter: "var(--glass-filter)",
      WebkitBackdropFilter: "var(--glass-filter)",
      borderRadius: "var(--radius-circle)",
      background: "var(--glass-bg)",
      border: "0.5px solid var(--glass-border)",
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
      background: "var(--glass-bg)",
      backdropFilter: "var(--glass-filter)",
      WebkitBackdropFilter: "var(--glass-filter)",
      border: "0.5px solid var(--glass-border)",
      opacity: isCompact ? 0 : 1,
      visibility: isCompact ? "hidden" : "visible",
      transition: "opacity 280ms ease"
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
  })) : /*#__PURE__*/React.createElement("div", {
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
      background: "var(--glass-bg)",
      backdropFilter: "var(--glass-filter)",
      WebkitBackdropFilter: "var(--glass-filter)",
      border: "0.5px solid var(--glass-border)",
      cursor: "pointer",
      pointerEvents: "auto",
      opacity: isCompact ? 0 : 1,
      visibility: isCompact ? "hidden" : "visible",
      transition: "opacity 280ms ease"
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
    style: { fontSize: "var(--font-14)", color: "var(--text-secondary)", letterSpacing: "-0.1px" }
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
  }, group.imageMemos.length > 2 && !expandedBlocks.has(`${gi}-img`) ? /*#__PURE__*/React.createElement("div", {
    onClick: () => toggleBlock(`${gi}-img`)
  }, /*#__PURE__*/React.createElement(ImageCard, {
    memo: group.imageMemos[0],
    onOpen: () => toggleBlock(`${gi}-img`),
    onPin: togglePin,
    onDelete: deleteMemo,
    expandText: `▼ 展开 ${group.imageMemos.length} 条`,
    onExpand: () => toggleBlock(`${gi}-img`)
  })) : group.imageMemos.map((memo, mi) => /*#__PURE__*/React.createElement("div", {
    key: memo.id,
    onClick: () => openEditor(memo)
  }, /*#__PURE__*/React.createElement(ImageCard, {
    memo: memo,
    onOpen: openEditor,
    onPin: togglePin,
    onDelete: deleteMemo,
    expandText: mi === group.imageMemos.length - 1 && group.imageMemos.length > 2 ? '▲ 收起' : undefined,
    onExpand: () => toggleBlock(`${gi}-img`)
  })))), group.imageMemos.length > 0 && group.textMemos.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "gap-16"
  }), group.textMemos.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "list-group"
  }, group.textMemos.length > 2 && !expandedBlocks.has(`${gi}-txt`) ? /*#__PURE__*/React.createElement("div", {
    onClick: () => toggleBlock(`${gi}-txt`)
  }, /*#__PURE__*/React.createElement(SwipeRow, {
    memo: group.textMemos[0],
    onOpen: () => {},
    onPin: togglePin,
    onDelete: deleteMemo,
    expandText: `▼ 展开 ${group.textMemos.length} 条`,
    onExpand: () => toggleBlock(`${gi}-txt`)
  })) : group.textMemos.map((memo, mi) => /*#__PURE__*/React.createElement("div", {
    key: memo.id
  }, /*#__PURE__*/React.createElement(SwipeRow, {
    memo: memo,
    onOpen: () => openEditor(memo),
    onPin: togglePin,
    onDelete: deleteMemo,
    expandText: mi === group.textMemos.length - 1 && group.textMemos.length > 2 ? '▲ 收起' : undefined,
    onExpand: () => toggleBlock(`${gi}-txt`)
  })))))))))
}

window.MynoteMemoList = MemoList;
window.MynoteSearch = { toCn: toCn, memoSearchText: memoSearchText, matchesMemoSearch: matchesMemoSearch };
