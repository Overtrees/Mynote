/* 运行时桥接：常量、纯工具、存储/编辑器适配层。 */
const {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect
} = React;
const {
  flushSync
} = ReactDOM;
const genId = () => window.MynoteId.genId();
function focusEditableWithCaret(target, offset = 0) {
  return window.MynoteDom && window.MynoteDom.focusEditableWithCaret
    ? window.MynoteDom.focusEditableWithCaret(target, offset, typeof warn === 'function' ? warn : null)
    : false;
}

window.getDB = getDB;

/* ---------- Worker API ---------- */
const API_BASE = window.MynoteConstants.API_BASE; // 常量唯一源：src/constants.js
const URL_REGEX = window.MynoteConstants.URL_REGEX; // 常量唯一源
const URL_INLINE_REGEX = window.MynoteConstants.URL_INLINE_REGEX; // 常量唯一源
function isUrl(str) {
  return window.MynoteConstants.isUrl(str);
}
function extractUrlFromText(str) {
  return window.MynoteConstants.extractUrlFromText(str);
}
function getTypeIcon(type) {
  return window.MynoteConstants.getTypeIcon(type);
}
async function fetchLinkMeta(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${API_BASE}/meta?url=${encodeURIComponent(url)}`, {
      signal: controller.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data;
  } catch (e) {
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
function proxyImg(url) {
  if (!url) return null;
  // QQ 音乐封面：300×300 提升到 800×800
  if (url.includes('y.gtimg.cn/music/photo_new/T002R')) {
    url = url.replace(/T002R\d+x\d+/, 'T002R800x800');
  }
  return `${API_BASE}/img?url=${encodeURIComponent(url)}`;
}

/* ---------- LinkCard 组件 ---------- */
// LinkCard \u79FB\u81F3 src/components/LinkCard.js\u6A21\u5757

// 检测 iOS 系统 24 小时制开关（优先来自 MynoteTime 模块）
function is24hFormat() {
  return window.MynoteTime.is24hFormat();
}
function timeAgo(iso) {
  return window.MynoteTime.timeAgo(iso);
}
const NEW_CARD_ID = window.MynoteConstants.NEW_CARD_ID;

/* ---------- Google Drive 配置 ---------- */
const GOOGLE_CLIENT_ID = window.MynoteConstants.GOOGLE_CLIENT_ID;
const GOOGLE_API_KEY = window.MynoteConstants.GOOGLE_API_KEY;
const BACKUP_FILE_NAME = window.MynoteConstants.BACKUP_FILE_NAME;

/* ---------- DB 单例（来自 MynoteIdb 模块） ---------- */
var _dbInstance = null;
function getDB() {
  return window.MynoteIdb.getDB();
}

/* ---------- 安全日志辅助 ---------- */
// 代替静默 catch(_) {}，保留排查线索但不上报用户
const warn = (msg, err) => {
  console.warn(`[此刻] ${msg}`, err || '');
  try { if (window.MynoteErrors) window.MynoteErrors.addWarn(msg, err); } catch (_) {}
};
window.warn = warn;
function getSectionLabel(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000);
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000);
  if (date >= today) return "今天";
  if (date >= yesterday) return "昨天";
  if (date >= sevenDaysAgo) return "过去7天";
  if (date >= thirtyDaysAgo) return "过去30天";
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月`;
  }
  return `${date.getFullYear()}年`;
}

/* ---------- IndexedDB（来自 MynoteIdb 模块） ---------- */
function openDB() {
  return window.MynoteIdb.openDB();
}

// 根据文件名扩展名推断 MIME type（来自 MynoteIdb 模块）
function guessMimeFromName(fileName, bytes) {
  var m = window.MynoteIdb.guessMimeFromName(fileName);
  if (m === 'application/octet-stream' && bytes && window.MynoteIdb) { var bm = window.MynoteIdb.guessMimeFromBytes(bytes); if (bm) return bm; }
  return m;
}

// 打包附件到 ZIP data（来自 MynoteIdb 模块）
async function packAttachmentsToZip(db, zipData, onProgress) {
  return window.MynoteIdb.packAttachmentsToZip(db, zipData, onProgress);
}
// 从 ZIP 恢复附件到 IDB（来自 MynoteIdb 模块）
async function restoreAttachmentsFromZip(unzipped, db) {
  return window.MynoteIdb.restoreAttachmentsFromZip(unzipped, db);
}
async function restoreAvatars(avatars, db) {
  return window.MynoteIdb.restoreAvatars(avatars, db);
}
async function saveAttachmentToDB(db, obj) {
  return window.MynoteIdb.saveAttachmentToDB(db, obj);
}
async function loadAttachmentFromDB(db, id) {
  return window.MynoteIdb.loadAttachmentFromDB(db, id);
}
async function deleteAttachmentFromDB(db, id) {
  return window.MynoteIdb.deleteAttachmentFromDB(db, id);
}
async function saveAvatarToDB(db, memoId, dataUrl) {
  return window.MynoteIdb.saveAvatarToDB(db, memoId, dataUrl);
}

/* ---------- renderCache 读写（来自 MynoteIdb 模块） ---------- */
async function saveRenderCacheToDB(db, memoId, cache) {
  return window.MynoteIdb.saveRenderCacheToDB(db, memoId, cache);
}
async function loadRenderCacheFromDB(db, memoId) {
  return window.MynoteIdb.loadRenderCacheFromDB(db, memoId);
}
async function loadAvatarFromDB(db, memoId) {
  return window.MynoteIdb.loadAvatarFromDB(db, memoId);
}
function createThumbnail(dataUrl) {
  return window.MynoteIdb.createThumbnail(dataUrl);
}
function dataURLtoBlob(dataURL) {
  return window.MynoteIdb.dataURLtoBlob(dataURL);
}

/* ---------- SwipeRow ---------- */

/* ---------- ImageCard ---------- */
const DraftStore = window.MynoteLocal ? window.MynoteLocal.DraftStore : {
  KEY: 'memo_draft_',
  async save(memoId, data) { try { localStorage.setItem(this.KEY + memoId, JSON.stringify(data)); } catch (e) { console.warn('[此刻] DraftStore save', e); } },
  async load(memoId) { try { var raw = localStorage.getItem(this.KEY + memoId); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } },
  async clear(memoId) { try { localStorage.removeItem(this.KEY + memoId); } catch (e) { console.warn('[此刻] DraftStore clear', e); } }
};
/* ---------- 编辑器变量 ---------- */
function escapeHTML(str) { return window.MynoteEditor ? window.MynoteEditor.escapeHTML(str) : String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
var __editorDocRef = window.MynoteEditor ? window.MynoteEditor.getEditorDocRef() : null;
function setEditorDocRef(doc) { __editorDocRef = doc; if(window.MynoteEditor) window.MynoteEditor.setEditorDocRef(doc); }
function renderAtomicHTML(node, files) {
  if (window.MynoteEditor && window.MynoteEditor.renderAtomicHTML) {
    var html = window.MynoteEditor.renderAtomicHTML(node, files);
    if (!html && node.type === 'musicCard') {
      if (node.status === 'input') {
        return '<div contenteditable="true" data-blockid="' + node.id + '" data-type="musicCard" data-music-url="pending" style="padding:12px 18px;border-radius:var(--radius-999);background:var(--glass-bg);backdrop-filter:var(--glass-filter);-webkit-backdrop-filter:var(--glass-filter);border:0.5px solid var(--glass-border);font-size:var(--font-14);color:var(--text-secondary);display:flex;align-items:center;gap:10px;outline:none;">粘贴音乐链接到这里...</div>';
      }
      if (node.status === 'empty' || (!node.url && !node.meta)) {
        return '<div contenteditable="false" data-blockid="' + node.id + '" data-type="musicCard" style="padding:12px 16px;border-radius:var(--radius-999);background:var(--glass-bg);backdrop-filter:var(--glass-filter);-webkit-backdrop-filter:var(--glass-filter);border:0.5px solid var(--glass-border);font-size:var(--font-14);color:var(--text-secondary);display:flex;align-items:center;gap:10px;"><span>🎵</span><span>点击粘贴音乐链接</span></div>';
      }
    }
    return html;
  }
  return '';
}
function renderDocToEditorHTML(doc, files) {
  // 实现只在 src/editor/editor.render.js，这里不再保留第二份
  return window.MynoteEditor.renderDocToEditorHTML(doc, files);
}

function parseEditorDOM(containerEl) {
  return window.MynoteEditor.parseEditorDOM(containerEl);
}

/* ---------- 运行时对子模块的显式导出 ---------- */
window.fetchLinkMeta = fetchLinkMeta;
window.proxyImg = proxyImg;
window.escapeHTML = escapeHTML;
window.createThumbnail = createThumbnail;
window.renderAtomicHTML = renderAtomicHTML;
window.renderDocToEditorHTML = renderDocToEditorHTML;
window.parseEditorDOM = parseEditorDOM;
window.timeAgo = timeAgo;
window.getDB = getDB;

window.MynoteRuntime = {
  genId: genId,
  focusEditableWithCaret: focusEditableWithCaret,
  isUrl: isUrl,
  extractUrlFromText: extractUrlFromText,
  getTypeIcon: getTypeIcon,
  fetchLinkMeta: fetchLinkMeta,
  proxyImg: proxyImg,
  is24hFormat: is24hFormat,
  timeAgo: timeAgo,
  getSectionLabel: getSectionLabel,
  warn: warn,
  getDB: getDB,
  escapeHTML: escapeHTML,
  renderAtomicHTML: renderAtomicHTML,
  renderDocToEditorHTML: renderDocToEditorHTML,
  parseEditorDOM: parseEditorDOM,
  DraftStore: DraftStore,
  API_BASE: API_BASE
};
