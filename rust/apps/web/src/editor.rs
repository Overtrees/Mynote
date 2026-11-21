//! W2 块编辑器：DOM contenteditable（每块一个，非受控——初始
//! HTML 只写一次，之后的键入完全归浏览器，Dioxus 重渲染不碰
//! 已挂载块的内容）+ JS 桥（回车分块/退格合并/斜杠面板/自动
//! 同步的事件采集与光标数学）+ Rust 侧模型操作（core 的行内
//! HTML 桥做 DOM⇄模型转换）。
//!
//! 拼音安全要点：组合输入期间 JS 桥不拦截任何按键（回车确认
//! 候选词不会被误判为分块）；结构操作的消息都自带块的当前
//! HTML，模型永远以 DOM 为准对齐。

use dioxus::prelude::*;
use mynote_core::{html_to_inlines, inlines_to_html, BackupFile, Node};
use serde_json::{json, Map, Value};

use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

use crate::blocks::BlockView;
use crate::diag;
use crate::idb;

const EDITOR_JS: &str = r#"
  const root = document.getElementById('editor-root');
  if (!root || root.__mnBound) return null;
  root.__mnBound = true;
  let composing = false;
  root.addEventListener('compositionstart', () => { composing = true; });
  root.addEventListener('compositionend', () => { composing = false; });

  const editableOf = (e) => e.target.closest ? e.target.closest('[data-bid]') : null;

  function fragHtml(range) {
    const d = document.createElement('div');
    d.appendChild(range.cloneContents());
    return d.innerHTML;
  }
  function caretInfo(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return { offset: 0, collapsed: true, beforeHtml: '', afterHtml: el.innerHTML };
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) {
      return { offset: 0, collapsed: range.collapsed, beforeHtml: '', afterHtml: el.innerHTML };
    }
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    const post = range.cloneRange();
    post.selectNodeContents(el);
    post.setStart(range.endContainer, range.endOffset);
    return { offset: pre.toString().length, collapsed: range.collapsed, beforeHtml: fragHtml(pre), afterHtml: fragHtml(post) };
  }
  function stripSlash(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n = walker.nextNode();
    while (n) {
      if (n.textContent.startsWith('/')) { n.textContent = n.textContent.slice(1); return; }
      if (n.textContent.length > 0) return;
      n = walker.nextNode();
    }
  }
  function moveSel(panel, dir) {
    const items = Array.from(panel.querySelectorAll('.slash-row'));
    if (!items.length) return;
    let i = items.findIndex((x) => x.classList.contains('sel'));
    items.forEach((x) => x.classList.remove('sel'));
    i = (i + dir + items.length) % items.length;
    items[i].classList.add('sel');
    items[i].scrollIntoView({ block: 'nearest' });
  }
  function collectSync() {
    const map = {};
    root.querySelectorAll('[data-bid]').forEach((el) => {
      // md 源编辑态由 mdText 消息单独同步（innerText），不走 HTML 同步
      if (el.dataset.btype === 'mdsrc') return;
      map[el.dataset.bid] = el.innerHTML;
    });
    return map;
  }

  root.addEventListener('keydown', (e) => {
    const el = editableOf(e);
    if (!el) return;
    const panel = document.getElementById('slash-panel');
    if (panel) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(panel, 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(panel, -1); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const sel = panel.querySelector('.slash-row.sel') || panel.querySelector('.slash-row');
        if (sel) {
          const act = sel.dataset.act;
          if (act === 'link') {
            dioxus.send(JSON.stringify({ op: 'slashLink', id: el.dataset.bid }));
          } else if (INLINE_ACTS.indexOf(act) >= 0) {
            stripSlash(el);
            const html = applyInline(act, el);
            dioxus.send(JSON.stringify({ op: 'pasteSync', id: el.dataset.bid, html }));
            dioxus.send(JSON.stringify({ op: 'slashClose' }));
          } else {
            stripSlash(el);
            dioxus.send(JSON.stringify({ op: 'slashApply', id: el.dataset.bid, act, html: el.innerHTML }));
          }
        }
        return;
      }
      if (e.key === 'Escape') { dioxus.send(JSON.stringify({ op: 'slashClose' })); return; }
    }
    if ((e.metaKey || e.ctrlKey) && !composing && !e.isComposing) {
      const k = e.key.toLowerCase();
      let cmd = null;
      if (k === 'b') cmd = 'bold';
      else if (k === 'i') cmd = 'italic';
      else if (k === 'u') cmd = 'underline';
      else if (k === 's' && e.shiftKey) cmd = 'strikeThrough';
      if (cmd) { e.preventDefault(); document.execCommand(cmd); return; }
    }
    if (composing || e.isComposing) return;
    if (el.dataset.btype === 'codeBlock') return;
    if (el.dataset.btype === 'mdsrc') return; // md 源编辑：回车即换行，不分块
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = caretInfo(el);
      dioxus.send(JSON.stringify({ op: 'split', id: el.dataset.bid, before: c.beforeHtml, after: c.afterHtml }));
    } else if (e.key === 'Backspace') {
      const c = caretInfo(el);
      if (c.collapsed && c.offset === 0) {
        e.preventDefault();
        dioxus.send(JSON.stringify({ op: 'merge', id: el.dataset.bid, html: el.innerHTML }));
      }
    }
  });

  // 实时高亮：光标刚落在一对 ==…== 的闭合 == 之后时，就地把
  // 内段包成 <mark> 并把光标移到 mark 之后。只处理光标所在的
  // 单个文本节点、且该节点不在已有 mark 内；组合输入期间不
  // 调用（input 监听先查 composing），拼音确认后才触发。
  function realtimeHighlight(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return false;
    const node = range.startContainer;
    if (node.nodeType !== 3) return false;
    if (node.parentElement && node.parentElement.closest('mark')) return false;
    const off = range.startOffset;
    const text = node.textContent;
    if (off < 2 || text.slice(off - 2, off) !== '==') return false;
    if (text[off] === '=') return false;
    const closeStart = off - 2;
    const openIdx = text.lastIndexOf('==', closeStart - 1);
    if (openIdx < 0) return false;
    if (openIdx > 0 && text[openIdx - 1] === '=') return false;
    const inner = text.slice(openIdx + 2, closeStart);
    if (!inner) return false;
    const parent = node.parentNode;
    const mark = document.createElement('mark');
    mark.className = 'mynote-highlight';
    mark.textContent = inner;
    const beforeNode = document.createTextNode(text.slice(0, openIdx));
    // afterNode 前置零宽空格并把光标放到其后：否则光标贴在
    // mark 边界上，后续键入会被浏览器吸进 mark 里。零宽空格
    // 在 core 解析时统一剥掉，不进模型。
    const afterNode = document.createTextNode('\u200b' + text.slice(off));
    parent.insertBefore(beforeNode, node);
    parent.insertBefore(mark, node);
    parent.insertBefore(afterNode, node);
    parent.removeChild(node);
    const r = document.createRange();
    r.setStart(afterNode, 1);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }

  // 标题组合期布局同步（原版 syncTitleCompositionLayout 的移植）：
  // 组合期间不走 Rust 状态，直接按文本长度改胶囊/滚动区/标题
  // 的内联样式（单向升级：>5 长标题、>11 横向溢出），失焦/组合
  // 结束时由 Rust 侧清掉内联样式回到类驱动。
  function syncTitleLayout(el) {
    const len = (el.textContent || '').length;
    const isLong = len > 5;
    const isOverflow = len > 11;
    const scroller = el.parentElement;
    const capsule = scroller && scroller.parentElement;
    if (!scroller || !capsule) return;
    capsule.style.width = isOverflow ? '184px' : 'auto';
    capsule.style.padding = isLong ? '6px 18px' : '0px 20px';
    scroller.style.width = isOverflow ? '100%' : 'auto';
    scroller.style.minWidth = '0';
    scroller.style.maxWidth = '100%';
    scroller.style.boxSizing = 'border-box';
    scroller.style.paddingLeft = isOverflow ? '16px' : '0px';
    scroller.style.paddingRight = isOverflow ? '16px' : '0px';
    scroller.style.scrollPaddingInline = isOverflow ? '16px' : '0px';
    el.style.fontSize = isLong ? '11px' : '14px';
    el.style.whiteSpace = isOverflow ? 'nowrap' : isLong ? 'normal' : 'nowrap';
    el.style.wordBreak = !isOverflow && isLong ? 'break-all' : 'normal';
    el.style.textAlign = isOverflow ? 'left' : 'center';
    el.style.minWidth = isOverflow ? 'max-content' : 'auto';
    el.style.paddingRight = '0px';
  }

  root.addEventListener('compositionupdate', (e) => {
    if (e.target && e.target.id === 'editor-title-text') syncTitleLayout(e.target);
  });

  root.addEventListener('compositionend', (e) => {
    // 标题组合输入结束：提交全文（组合期间 input 不提交，同原版）
    if (e.target && e.target.id === 'editor-title-text') {
      dioxus.send(JSON.stringify({ op: 'titleText', text: e.target.textContent || '' }));
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'editor-title-text') {
      if (composing) syncTitleLayout(e.target);
      else dioxus.send(JSON.stringify({ op: 'titleText', text: e.target.textContent || '' }));
      return;
    }
    const el = editableOf(e);
    if (!el || composing) return;
    if (el.dataset.btype === 'mdsrc') {
      dioxus.send(JSON.stringify({ op: 'mdText', id: el.dataset.bid, text: el.innerText || '' }));
      return;
    }
    if (el.dataset.btype === 'codeBlock') return;
    if (realtimeHighlight(el)) {
      dioxus.send(JSON.stringify({ op: 'pasteSync', id: el.dataset.bid, html: el.innerHTML }));
      return;
    }
    const t = (el.innerText || '').replace(/\n$/, '');
    const panel = document.getElementById('slash-panel');
    if (t.startsWith('/')) {
      // 过滤词 = '/' 与光标之间的文字（不是整块文本）
      const c = caretInfo(el);
      const filter = t.slice(1, Math.max(1, c.offset));
      const r = el.getBoundingClientRect();
      dioxus.send(JSON.stringify({ op: 'slash', id: el.dataset.bid, filter, x: r.left, y: r.top, b: r.bottom }));
    } else if (panel) {
      dioxus.send(JSON.stringify({ op: 'slashClose' }));
    }
  });

  root.addEventListener('focusout', (e) => {
    const el = editableOf(e);
    if (el && el.dataset.btype === 'mdsrc') {
      dioxus.send(JSON.stringify({ op: 'mdDone', id: el.dataset.bid }));
    }
  });

  // 原子块点击（原版 use-editor-dom.js 的边缘区语义）：点块体
  // 左右 28px 边带 = 在块前/块后落段；点中央 = 选中该块（块
  // 操作钮只在选中后出现）。按钮/链接/图片（灯箱）/图文文本
  // 区（开面板）各自的行为优先，不发消息。
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('button, input, label')) return;
    const wrap = t.closest('.blk-wrap');
    if (!wrap) {
      if (t.closest('[contenteditable="true"]')) {
        dioxus.send(JSON.stringify({ op: 'clearSelect' }));
      }
      return;
    }
    const bid = wrap.getAttribute('data-wrapbid');
    if (!bid) return;
    if (t.closest('[contenteditable="true"], .itc-text')) {
      dioxus.send(JSON.stringify({ op: 'clearSelect' }));
      return;
    }
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < 28) {
      dioxus.send(JSON.stringify({ op: 'insertPara', id: bid, where: 'before' }));
      return;
    }
    if (x > r.width - 28) {
      dioxus.send(JSON.stringify({ op: 'insertPara', id: bid, where: 'after' }));
      return;
    }
    // 链接（音乐成品卡）保持跳转；图片保持灯箱（图片块的既有
    // 行为），同时选中该块——关掉灯箱后块操作钮就在原地。
    if (t.closest('a')) return;
    dioxus.send(JSON.stringify({ op: 'selectBlock', id: bid }));
  });

  // 选中态的键盘删除（原版单一编辑器里原子块随选区 Delete；
  // 分块架构下由选中态承载）：焦点不在可编辑区时 Backspace/
  // Delete 删选中块，Escape 取消选中。
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Escape') return;
    const t = e.target;
    if (t && t.closest && t.closest('[contenteditable="true"], input, textarea')) return;
    if (e.key === 'Escape') {
      dioxus.send(JSON.stringify({ op: 'clearSelect' }));
    } else {
      e.preventDefault();
      dioxus.send(JSON.stringify({ op: 'deleteSelected' }));
    }
  });

  root.addEventListener('paste', (e) => {
    const el = editableOf(e);
    if (!el) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    const trimmed = (text || '').trim();
    const URL_RE = /^https?:\/\/(www\.)?[-\u4e00-\u9fa5a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-\u4e00-\u9fa5a-zA-Z0-9()@:%_+.~#?&\/=]*)$/i;
    const URL_INLINE_RE = /https?:\/\/[-\u4e00-\u9fa5a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&\/=]*/i;
    const MEDIA_RE = /music\.163\.com|163cn\.tv|y\.qq\.com|i\.y\.qq\.com|open\.spotify\.com|music\.apple\.com|b23\.tv|xiaohongshu\.com|xhslink\.com/i;
    const looksMd = (t) => /(^|\n)#{1,6}\s|(^|\n)[-*+]\s|(^|\n)\d+\.\s|(^|\n)>\s|`{1,3}|\*\*[^*]+\*\*|(^|[^*])\*[^*\n]+\*($|[^*])|__[^_]+__|~~[^~]+~~|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|(^|\n)---+($|\n)|==[^=]+==|\[\[[^\]]+\]\]|\$\$[\s\S]+?\$\$|\$[^$\n]+\$/m.test(t);
    const inlineM = trimmed.match(URL_INLINE_RE);
    const embeddedUrl = inlineM ? inlineM[0] : null;
    const sendCard = (url, remain) => {
      const c = caretInfo(el);
      dioxus.send(JSON.stringify({ op: 'pasteCard', id: el.dataset.bid, url: url, remain: remain, before: c.beforeHtml, after: c.afterHtml }));
    };
    if (trimmed && URL_RE.test(trimmed)) {
      e.preventDefault();
      sendCard(trimmed, '');
      return;
    }
    if (trimmed && embeddedUrl && MEDIA_RE.test(embeddedUrl)) {
      e.preventDefault();
      sendCard(embeddedUrl, '');
      return;
    }
    if (trimmed && embeddedUrl && !looksMd(trimmed)) {
      e.preventDefault();
      sendCard(embeddedUrl, trimmed.replace(embeddedUrl, '').trim());
      return;
    }
    const imgItems = cd.items ? Array.from(cd.items).filter((it) => it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) : [];
    if (imgItems.length) {
      e.preventDefault();
      imgItems.forEach((it) => {
        const f = it.getAsFile();
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          const b64 = String(reader.result || '').split(',')[1] || '';
          dioxus.send(JSON.stringify({ op: 'pasteImage', id: el.dataset.bid, name: f.name || 'image.png', mime: f.type || 'image/png', b64: b64 }));
        };
        reader.readAsDataURL(f);
      });
      return;
    }
    const html = cd.getData('text/html');
    if (html) {
      e.preventDefault();
      // JS 侧净化后直接插入 DOM（光标天然正确），再把结果 HTML
      // 发回 Rust 对齐模型——DOM 与模型按构造一致
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      tmp.querySelectorAll('script,style,iframe,object,embed,link,meta,title').forEach((n) => n.remove());
      tmp.querySelectorAll('*').forEach((n) => {
        Array.from(n.attributes || []).forEach((a) => {
          if (a.name.toLowerCase().startsWith('on')) n.removeAttribute(a.name);
          if (a.name === 'href' && /^javascript:/i.test(a.value)) n.removeAttribute('href');
          if (a.name === 'style' || a.name === 'class') n.removeAttribute(a.name);
        });
      });
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const frag = document.createDocumentFragment();
        Array.from(tmp.childNodes).forEach((n) => frag.appendChild(n));
        const last = frag.lastChild;
        range.insertNode(frag);
        if (last) {
          range.setStartAfter(last);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      dioxus.send(JSON.stringify({ op: 'pasteSync', id: el.dataset.bid, html: el.innerHTML }));
    } else if (text && text.indexOf('\n') >= 0) {
      e.preventDefault();
      const c = caretInfo(el);
      dioxus.send(JSON.stringify({ op: 'pasteText', id: el.dataset.bid, before: c.beforeHtml, after: c.afterHtml, lines: text.split(/\r?\n/) }));
    }
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') {
      dioxus.send(JSON.stringify({ op: 'sync', map: collectSync() }));
    }
  }, 20000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      dioxus.send(JSON.stringify({ op: 'sync', map: collectSync() }));
    }
  });

  const INLINE_ACTS = ['bold', 'italic', 'highlight', 'code', 'strikethrough'];
  let savedRange = null;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (root.contains(r.startContainer)) savedRange = r.cloneRange();
    }
  });
  function restoreSel(el) {
    if (savedRange && el.contains(savedRange.startContainer)) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
      return true;
    }
    return false;
  }
  function caretBack(n) {
    const sel = window.getSelection();
    try { for (let i = 0; i < n; i++) sel.modify('move', 'backward', 'character'); } catch (_) {}
  }
  function applyInline(act, el) {
    el.focus();
    restoreSel(el);
    if (act === 'bold') document.execCommand('bold');
    else if (act === 'italic') document.execCommand('italic');
    else if (act === 'strikethrough') document.execCommand('strikeThrough');
    else if (act === 'highlight') {
      // 实时高亮：有选区直接包 <mark>；无选区插入带零宽空格
      // 占位的 <mark> 并把光标放进去，随后键入即带高亮（回写
      // 解析时零宽空格被 core 剥掉，未键入则 mark 自动消失）。
      const sel = window.getSelection();
      if (sel.rangeCount && !sel.getRangeAt(0).collapsed) {
        const range = sel.getRangeAt(0);
        const mark = document.createElement('mark');
        mark.className = 'mynote-highlight';
        try { range.surroundContents(mark); }
        catch (_) { mark.appendChild(range.extractContents()); range.insertNode(mark); }
        const r = document.createRange();
        r.setStartAfter(mark);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } else if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const mark = document.createElement('mark');
        mark.className = 'mynote-highlight';
        mark.textContent = '\u200b';
        range.insertNode(mark);
        const r = document.createRange();
        r.setStart(mark.firstChild, 1);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
    else if (act === 'code') { document.execCommand('insertText', false, '``'); caretBack(1); }
    return el.innerHTML;
  }
  window.__mnInline = (act, bid) => {
    const el = root.querySelector('[data-bid="' + bid + '"]');
    if (!el) return '';
    stripSlash(el);
    return applyInline(act, el);
  };
  window.__mnApplyLink = (url, bid) => {
    const el = root.querySelector('[data-bid="' + bid + '"]');
    if (!el) return '';
    el.focus();
    const had = restoreSel(el);
    const sel = window.getSelection();
    if (had && sel.rangeCount && !sel.getRangeAt(0).collapsed) {
      document.execCommand('createLink', false, url);
    } else {
      const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      document.execCommand('insertHTML', false, '<a href="' + safe + '">' + safe + '</a>');
    }
    return el.innerHTML;
  };
  window.__mnFocus = (bid, offset) => {
    let tries = 0;
    const attempt = () => {
      const el = root.querySelector('[data-bid="' + bid + '"]');
      if (!el) { if (tries++ < 10) setTimeout(attempt, 50); return; }
      el.focus();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let remaining = offset;
      let n = walker.nextNode();
      let last = null;
      while (n) {
        last = n;
        if (remaining <= n.textContent.length) {
          const range = document.createRange();
          range.setStart(n, remaining);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        remaining -= n.textContent.length;
        n = walker.nextNode();
      }
      const range = document.createRange();
      if (last) range.setStart(last, last.textContent.length);
      else range.selectNodeContents(el);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
    attempt();
  };
  window.__mnSetHtml = (bid, html, offset) => {
    const el = root.querySelector('[data-bid="' + bid + '"]');
    if (!el) return;
    el.innerHTML = html;
    window.__mnFocus(bid, offset);
  };
  window.__mnSyncAll = () => collectSync();
  window.__mnStripSlash = (bid) => {
    const el = root.querySelector('[data-bid="' + bid + '"]');
    if (!el) return '';
    stripSlash(el);
    return el.innerHTML;
  };
  return null;
"#;

/// 斜杠命令全集（原版 commands.js 的顺序与文案口径）：
/// 动作 / 图标名 / 标题键 / 副标题键 / 快捷键标记 / 分组
/// （0 基础、1 媒体）。行内命令（bold 等）由 JS 桥就地执行。
struct SlashCmd {
    act: &'static str,
    /// 原版 commands.js 的 id（最近使用按它存 localStorage）
    oid: &'static str,
    icon: &'static str,
    title: &'static str,
    sub: &'static str,
    shortcut: &'static str,
    group: u8,
    /// 原版 keywords（搜索全集的一部分，含中文词）
    kw: &'static str,
    /// 原版 pinyin 首字母
    py: &'static str,
}
const SLASH_CMDS: &[SlashCmd] = &[
    SlashCmd { act: "heading1", icon: "heading", title: "slash.heading1", sub: "slash.heading1_sub", shortcut: "# ", group: 0, oid: "heading", kw: "h1 heading 标题 一级", py: "bt1" },
    SlashCmd { act: "heading2", icon: "heading2", title: "slash.heading2", sub: "slash.heading2_sub", shortcut: "## ", group: 0, oid: "heading2", kw: "h2 heading2 标题 二级", py: "bt2" },
    SlashCmd { act: "heading3", icon: "heading3", title: "slash.heading3", sub: "slash.heading3_sub", shortcut: "### ", group: 0, oid: "heading3", kw: "h3 heading3 标题 三级", py: "bt3" },
    SlashCmd { act: "paragraph", icon: "paragraph", title: "slash.paragraph", sub: "slash.paragraph_sub", shortcut: "", group: 0, oid: "paragraph", kw: "p paragraph 文本", py: "wb" },
    SlashCmd { act: "quote", icon: "quote", title: "slash.quote", sub: "slash.quote_sub", shortcut: "> ", group: 0, oid: "quote", kw: "q quote 引用", py: "yy" },
    SlashCmd { act: "todo", icon: "todo", title: "slash.todo", sub: "slash.todo_sub", shortcut: "[ ] ", group: 0, oid: "todo", kw: "t todo 待办", py: "db" },
    SlashCmd { act: "divider", icon: "divider", title: "slash.divider", sub: "slash.divider_sub", shortcut: "---", group: 0, oid: "divider", kw: "d divider 分割线", py: "fgx" },
    SlashCmd { act: "bold", icon: "bold", title: "slash.bold", sub: "slash.bold_sub", shortcut: "** **", group: 0, oid: "bold", kw: "b bold 加粗 粗体", py: "jc" },
    SlashCmd { act: "italic", icon: "italic", title: "slash.italic", sub: "slash.italic_sub", shortcut: "* *", group: 0, oid: "italic", kw: "i italic 斜体 倾斜", py: "xt" },
    SlashCmd { act: "highlight", icon: "highlight", title: "slash.highlight", sub: "slash.highlight_sub", shortcut: "== ==", group: 0, oid: "highlight", kw: "h highlight 高亮", py: "gl" },
    SlashCmd { act: "codeBlock", icon: "codeBlock", title: "slash.code_block", sub: "slash.code_block_sub", shortcut: "```", group: 0, oid: "codeBlock", kw: "code codeblock 代码块", py: "dmk" },
    SlashCmd { act: "bulletList", icon: "list", title: "slash.bullet_list", sub: "slash.bullet_list_sub", shortcut: "- ", group: 0, oid: "unorderedList", kw: "list ul 无序列表 列表", py: "wxl" },
    SlashCmd { act: "numberList", icon: "olist", title: "slash.number_list", sub: "slash.number_list_sub", shortcut: "1. ", group: 0, oid: "orderedList", kw: "ol list 有序列表 列表", py: "yxl" },
    SlashCmd { act: "callout", icon: "callout", title: "slash.callout", sub: "slash.callout_sub", shortcut: "> [!]", group: 0, oid: "callout", kw: "callout note tip warning 提示 警告", py: "callout" },
    SlashCmd { act: "link", icon: "link", title: "slash.link", sub: "slash.link_sub", shortcut: "[](url)", group: 0, oid: "link", kw: "l link 链接 超链接", py: "lj" },
    SlashCmd { act: "code", icon: "code", title: "slash.code", sub: "slash.code_sub", shortcut: "` `", group: 0, oid: "code", kw: "c code 代码 内联", py: "dm" },
    SlashCmd { act: "strikethrough", icon: "strikethrough", title: "slash.strikethrough", sub: "slash.strikethrough_sub", shortcut: "~~ ~~", group: 0, oid: "strikethrough", kw: "s strike strikethrough 删除线", py: "scx" },
    SlashCmd { act: "imgTextCard", icon: "imgTextCard", title: "slash.img_text_card", sub: "slash.img_text_card_sub", shortcut: "", group: 1, oid: "imgTextCard", kw: "image text card 图文 卡片", py: "twkp" },
    SlashCmd { act: "imageTextRow", icon: "imageTextRow", title: "slash.image_text_row", sub: "slash.image_text_row_sub", shortcut: "", group: 1, oid: "imageTextRow", kw: "image text row 图文 混排 左右", py: "twhp" },
    SlashCmd { act: "musicCard", icon: "music", title: "slash.music_card", sub: "slash.music_card_sub", shortcut: "", group: 1, oid: "musicCard", kw: "m music 音乐 卡片", py: "yykp" },
    SlashCmd { act: "image", icon: "image", title: "slash.image", sub: "slash.image_sub", shortcut: "", group: 1, oid: "image", kw: "i image 图片", py: "tp" },
    SlashCmd { act: "gallery", icon: "gallery", title: "slash.gallery", sub: "slash.gallery_sub", shortcut: "", group: 1, oid: "gallery", kw: "g gallery 画廊", py: "hl" },
];

/// 最近使用（原版 use-slash.js 口径）：localStorage
/// memos_slash_recent_v1 存原版 id 数组，最多 6 条，最新在前。
fn slash_recent_ids() -> Vec<String> {
    let raw = web_sys::window()
        .and_then(|w| w.local_storage().ok().flatten())
        .and_then(|st| st.get_item("memos_slash_recent_v1").ok().flatten())
        .unwrap_or_default();
    let mut ids: Vec<String> = serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default();
    ids.truncate(6);
    ids
}

fn slash_record_recent(act: &str) {
    let Some(cmd) = SLASH_CMDS.iter().find(|c| c.act == act) else {
        return;
    };
    let mut ids = slash_recent_ids();
    ids.retain(|i| i != cmd.oid);
    ids.insert(0, cmd.oid.to_string());
    ids.truncate(6);
    if let Some(st) = web_sys::window()
        .and_then(|w| w.local_storage().ok().flatten())
    {
        let _ = st.set_item(
            "memos_slash_recent_v1",
            &serde_json::to_string(&ids).unwrap_or_default(),
        );
    }
    diag::log("EDIT", &format!("slash recent <- {}", cmd.oid));
}

/// 行内斜杠命令：不改块类型，由 JS 桥对选区就地执行。
const INLINE_ACTS: &[&str] = &["bold", "italic", "highlight", "code", "strikethrough"];

/// 媒体文件请求：斜杠「图片/画廊」替换当前块，或给图文块换图。
#[derive(Clone, PartialEq)]
pub(crate) enum MediaReq {
    Replace { bid: String, gallery: bool },
    SetImage { bid: String },
}

/// 历史快照压栈：与栈顶不同才压（截断重做尾，上限 50）。
fn hist_push(
    mut hist: Signal<Vec<String>>,
    mut hist_idx: Signal<usize>,
    json: String,
) {
    let mut h = hist.read().clone();
    let idx = *hist_idx.read();
    if h.get(idx).map(|x| x.as_str()) != Some(json.as_str()) {
        h.truncate(idx + 1);
        h.push(json);
        if h.len() > 50 {
            h.remove(0);
        }
        hist_idx.set(h.len() - 1);
        hist.set(h);
    }
}

/// 把标题+文档合并进总数据（persist 与离开/删除路径共用）。
fn build_backup(
    data: Signal<BackupFile>,
    memo_id: &str,
    doc_snapshot: Vec<Node>,
    title_snapshot: String,
) -> BackupFile {
    let mut backup = data.read().clone();
    if let Some(m) = backup
        .memos
        .iter_mut()
        .find(|m| m.id.to_string() == memo_id)
    {
        m.title = if title_snapshot.is_empty() {
            None
        } else {
            Some(title_snapshot)
        };
        m.doc = doc_snapshot;
        m.updated_at = mynote_core::model::Timestamp::Iso(now_iso());
    }
    backup
}

async fn save_backup(backup: &BackupFile) {
    match serde_json::to_string(backup) {
        Ok(json) => match idb::save_memos(&json).await {
            Ok(()) => diag::log("EDIT", &format!("save_memos ok {}B", json.len())),
            Err(e) => diag::log("EDIT", &format!("save err: {e:?}")),
        },
        Err(e) => diag::log("EDIT", &format!("serialize err: {e}")),
    }
}

fn now_iso() -> String {
    js_sys::Date::new_0()
        .to_iso_string()
        .as_string()
        .unwrap_or_default()
}

fn now_millis() -> i64 {
    js_sys::Date::now() as i64
}

fn gen_id() -> String {
    let r = js_sys::Math::random();
    format!("b{:x}", (r * 1e12) as u64)
}

fn empty_text_node() -> Node {
    Node {
        text: Some(String::new()),
        node_type: None,
        id: None,
        children: None,
        extra: Map::new(),
    }
}

fn new_block(block_type: &str) -> Node {
    Node {
        text: None,
        node_type: Some(block_type.to_string()),
        id: Some(gen_id()),
        children: Some(vec![empty_text_node()]),
        extra: Map::new(),
    }
}

/// 打开编辑器时给所有可编辑节点补 id（真实数据的块都带 id，
/// 列表项等个别可能没有）——DOM 桥按 id 寻址。
fn ensure_ids(doc: &mut [Node]) {
    for block in doc.iter_mut() {
        if block.id.is_none() {
            block.id = Some(gen_id());
        }
        if let Some(kids) = &mut block.children {
            for item in kids.iter_mut() {
                if item.is_block() && item.id.is_none() {
                    item.id = Some(gen_id());
                }
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Loc {
    Top(usize),
    Item(usize, usize),
}

fn find_loc(doc: &[Node], bid: &str) -> Option<Loc> {
    for (i, b) in doc.iter().enumerate() {
        if b.id.as_deref() == Some(bid) {
            return Some(Loc::Top(i));
        }
        if let Some(kids) = &b.children {
            for (j, item) in kids.iter().enumerate() {
                if item.is_block() && item.id.as_deref() == Some(bid) {
                    return Some(Loc::Item(i, j));
                }
            }
        }
    }
    None
}

fn node_at<'a>(doc: &'a [Node], loc: Loc) -> &'a Node {
    match loc {
        Loc::Top(i) => &doc[i],
        Loc::Item(li, ii) => &doc[li].children.as_ref().unwrap()[ii],
    }
}

fn node_at_mut<'a>(doc: &'a mut [Node], loc: Loc) -> &'a mut Node {
    match loc {
        Loc::Top(i) => &mut doc[i],
        Loc::Item(li, ii) => &mut doc[li].children.as_mut().unwrap()[ii],
    }
}

/// 文档顺序里上一个可编辑文本块（合并的目标）。
fn prev_editable(doc: &[Node], loc: Loc) -> Option<Loc> {
    let mut prev: Option<Loc> = None;
    for (i, b) in doc.iter().enumerate() {
        let ty = b.block_type().unwrap_or("");
        if is_text_block(ty) {
            let cur = Loc::Top(i);
            if cur == loc {
                return prev;
            }
            prev = Some(cur);
        }
        if ty == "bulleted-list" || ty == "numbered-list" {
            if let Some(kids) = &b.children {
                for (j, item) in kids.iter().enumerate() {
                    if item.is_block() {
                        let cur = Loc::Item(i, j);
                        if cur == loc {
                            return prev;
                        }
                        prev = Some(cur);
                    }
                }
            }
        }
    }
    None
}

fn is_text_block(ty: &str) -> bool {
    matches!(
        ty,
        "paragraph" | "heading" | "quote" | "todo" | "callout" | "list-item" | "codeBlock"
    )
}

fn plain_len(node: &Node) -> usize {
    node.plain_text().chars().count()
}

/// 字数口径逐字对原版 editor.js:2454：只统计顶层 paragraph 块
/// 的第一个叶子的文本（去掉 \n）。标题/待办/列表等不计入——
/// 此前按全块纯文本统计，看展备忘多出标题 4 字（118 vs 114）。
fn orig_char_count(doc: &[Node]) -> usize {
    doc.iter()
        .filter(|n| n.block_type() == Some("paragraph"))
        .map(|n| {
            n.children
                .as_ref()
                .and_then(|c| c.first())
                .and_then(|f| f.text.as_ref())
                .map(|t| t.replace('\n', "").chars().count())
                .unwrap_or(0)
        })
        .sum()
}

/// 深色模式（渲染期读 matchMedia；切换由 scheme_tick 触发重渲染）。
fn is_dark_mode() -> bool {
    web_sys::window()
        .and_then(|w| w.match_media("(prefers-color-scheme: dark)").ok().flatten())
        .map(|m| m.matches())
        .unwrap_or(false)
}

/// 深色下压暗自定义背景（原版 getDarkenedColor：每通道 ×0.35）。
fn darken_hex(hex: &str) -> String {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return hex.to_string();
    }
    let ch = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).unwrap_or(0);
    let f = |v: u8| ((v as f32 * 0.35).round() as u8);
    format!("#{:02x}{:02x}{:02x}", f(ch(0)), f(ch(2)), f(ch(4)))
}

/// 拉取链接元数据（原版 fetchLinkMeta：GET Worker /meta?url=，
/// 非 2xx 或解析失败返回 None）。
async fn fetch_link_meta(url: &str) -> Option<serde_json::Value> {
    use wasm_bindgen::JsCast;
    let win = web_sys::window()?;
    let api = format!(
        "https://mynote.overtrees.workers.dev/meta?url={}",
        crate::blocks::url_encode(url)
    );
    let resp_val = wasm_bindgen_futures::JsFuture::from(win.fetch_with_str(&api))
        .await
        .ok()?;
    let resp: web_sys::Response = resp_val.dyn_into().ok()?;
    if !resp.ok() {
        return None;
    }
    let json_val = wasm_bindgen_futures::JsFuture::from(resp.json().ok()?)
        .await
        .ok()?;
    let text = js_sys::JSON::stringify(&json_val)
        .ok()
        .and_then(|s| s.as_string())?;
    serde_json::from_str(&text).ok()
}

/// 解析一张卡片（原版 hydrate / retry / 设链后的公共路径）：
/// 拉元数据 → 回写 meta + status（有 title=ready，否则 error）；
/// 期间 URL 已被改掉则放弃（防竞态，同原版守卫）。
fn spawn_resolve_card(
    mut doc: Signal<Vec<Node>>,
    bid: String,
    url: String,
    title: Signal<String>,
    data: Signal<BackupFile>,
    persist: PersistHandle,
) {
    spawn(async move {
        let meta = fetch_link_meta(&url).await;
        let mut d = doc.read().clone();
        if let Some(loc) = find_loc(&d, &bid) {
            let cur_url = {
                let n = node_at_mut(&mut d, loc);
                n.extra
                    .get("url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string()
            };
            if cur_url != url {
                return;
            }
            let ready = meta
                .as_ref()
                .and_then(|m| m.get("title"))
                .and_then(|v| v.as_str())
                .map(|s| !s.is_empty())
                .unwrap_or(false);
            let n = node_at_mut(&mut d, loc);
            if ready {
                n.extra.insert("meta".into(), meta.clone().unwrap());
                n.extra.insert("status".into(), json!("ready"));
            } else {
                n.extra.insert("meta".into(), serde_json::Value::Null);
                n.extra.insert("status".into(), json!("error"));
            }
            doc.set(d.clone());
            persist.call(d, title.read().clone(), data);
            diag::log(
                "CARD",
                &format!("resolve {bid} -> {}", if ready { "ready" } else { "error" }),
            );
        }
    });
}

/// 编辑器有效背景（原版 editorBg）：自定义色（深色压暗）优先，
/// 否则浅色 #FAFAFA（--color-editor-bg）/ 深色 #000。
fn effective_bg(bg: &Option<String>) -> String {
    match bg {
        Some(c) => {
            if is_dark_mode() {
                darken_hex(c)
            } else {
                c.clone()
            }
        }
        None => {
            if is_dark_mode() {
                "#000000".to_string()
            } else {
                "#FAFAFA".to_string()
            }
        }
    }
}

/// 标题显示口径（原版 editor.js）：空标题显示「无标题」，
/// 超 10 字截断加省略号（仅非编辑态显示用）。
fn display_title_of(raw: &str) -> String {
    if raw.is_empty() {
        crate::i18n::t("editor.untitled")
    } else if raw.chars().count() > 10 {
        format!("{}…", raw.chars().take(10).collect::<String>())
    } else {
        raw.to_string()
    }
}

/// 标题输入（原版是 contenteditable div，不是 <input>：input 的
/// 固有宽度会把胶囊撑大、且不能换行）。非受控：初始文本只在
/// 挂载时写一次；文本同步走桥的 titleText 消息（组合期间不
/// 提交）；聚焦时由 JS 就地展开全文并把光标移到末尾，失焦时
/// 就地回截断显示——都不重挂载，避免键盘/光标被打断。
#[component]
fn TitleText(
    display: String,
    cls: String,
    font_px: u32,
    title: Signal<String>,
    mut editing: Signal<bool>,
    mut composing: Signal<bool>,
) -> Element {
    let initial = use_hook(|| {
        display
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    });
    rsx! {
        div {
            id: "editor-title-text",
            class: "{cls}",
            style: "font-size:{font_px}px",
            contenteditable: "true",
            role: "textbox",
            "aria-label": "{crate::i18n::t(\"editor.untitled\")}",
            "enterkeyhint": "done",
            dangerous_inner_html: "{initial}",
            onfocus: move |_| {
                editing.set(true);
                let full = title.read().clone();
                spawn(async move {
                    let js = format!(
                        "const el = document.getElementById('editor-title-text'); if (el) {{ const full = {}; if (el.textContent !== full) {{ el.textContent = full; const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); if (s) {{ s.removeAllRanges(); s.addRange(r); }} }} if (el.parentElement) el.parentElement.scrollLeft = 0; }} dioxus.send(null);",
                        serde_json::to_string(&full).unwrap_or_default()
                    );
                    let mut eval = document::eval(&js);
                    let _ = eval.recv::<serde_json::Value>().await;
                });
            },
            onblur: move |_| {
                editing.set(false);
                // 提交口径（原版 commitTitleFromDOM）：全文 trim，
                // 空则存「无标题」；随后回截断显示并清掉组合期
                // 由 JS 直改的胶囊/滚动区内联样式（回到类驱动）
                let mut title = title;
                spawn(async move {
                    let mut eval = document::eval(
                        "const el = document.getElementById('editor-title-text'); dioxus.send(el ? (el.textContent || '') : '');",
                    );
                    if let Ok(raw) = eval.recv::<String>().await {
                        let trimmed = raw.trim().to_string();
                        let committed = if trimmed.is_empty() {
                            crate::i18n::t("editor.untitled")
                        } else {
                            trimmed
                        };
                        title.set(committed.clone());
                        let disp = display_title_of(&committed);
                        let js = format!(
                            "const el = document.getElementById('editor-title-text'); if (el) {{ if (el.textContent !== {}) el.textContent = {}; const sc = el.parentElement; const cap = sc && sc.parentElement; if (sc) {{ sc.scrollLeft = 0; sc.style.width = ''; sc.style.paddingLeft = ''; sc.style.paddingRight = ''; sc.style.scrollPaddingInline = ''; }} if (cap) {{ cap.style.width = ''; cap.style.padding = ''; }} el.style.fontSize = ''; el.style.whiteSpace = ''; el.style.wordBreak = ''; el.style.textAlign = ''; el.style.minWidth = ''; }} dioxus.send(null);",
                            serde_json::to_string(&disp).unwrap_or_default(),
                            serde_json::to_string(&disp).unwrap_or_default()
                        );
                        let mut eval2 = document::eval(&js);
                        let _ = eval2.recv::<serde_json::Value>().await;
                    }
                });
            },
            oncompositionstart: move |_| composing.set(true),
            oncompositionend: move |_| composing.set(false),
            onkeydown: move |evt: KeyboardEvent| {
                if evt.key() == Key::Enter && !*composing.read() {
                    evt.prevent_default();
                    spawn(async move {
                        let mut eval = document::eval(
                            "const el = document.getElementById('editor-title-text'); if (el) el.blur(); dioxus.send(null);",
                        );
                        let _ = eval.recv::<serde_json::Value>().await;
                    });
                }
            },
        }
    }
}

#[component]
pub fn Editor(
    memo_id: String,
    data: Signal<BackupFile>,
    manifest: Signal<String>,
    gen: Signal<u32>,
    on_close: EventHandler<()>,
    on_open_wiki: EventHandler<String>,
    /// 本会话新建的备忘（原版 __isNewNote）：仅它适用「空白
    /// 关闭即删除」，旧备忘清空后退出保留空壳（原版口径）。
    is_new: bool,
) -> Element {
    let memo = data
        .read()
        .memos
        .iter()
        .find(|m| m.id.to_string() == memo_id)
        .cloned();
    let Some(memo) = memo else {
        return rsx! { div { class: "empty", "{crate::i18n::t(\"editor.missing\")}" } };
    };

    let mut doc = use_signal(|| {
        let mut d = memo.doc.clone();
        ensure_ids(&mut d);
        d
    });
    let mut title = use_signal(|| memo.title.clone().unwrap_or_default());
    // 原版 hasTyped 的等价追踪：doc/title 任一偏离初始快照即
    // 置位且不回落（打过字再删光也算 typed）。供「空白关闭即
    // 删除」与空占位提示共用。
    let initial_doc_json = serde_json::to_string(&doc.read().clone()).unwrap_or_default();
    let initial_title = title.read().clone();
    let mut typed = use_signal(|| false);
    {
        let initial_doc_json = initial_doc_json.clone();
        let initial_title = initial_title.clone();
        use_effect(move || {
            let dj = serde_json::to_string(&doc.read().clone()).unwrap_or_default();
            if dj != initial_doc_json || *title.read() != initial_title {
                typed.set(true);
            }
        });
    }
    let mut panel = use_signal(|| Option::<(String, String, f64, f64, f64)>::None);
    let mut focus_req = use_signal(|| Option::<(String, usize)>::None);
    let mut slash_click = use_signal(|| Option::<(String, String)>::None);
    // 斜杠链接表单：Some(块 id) 时面板切为链接表单；提交后由
    // link_click 触发 __mnApplyLink（选区由桥的 savedRange 恢复）
    let mut link_for = use_signal(|| Option::<String>::None);
    let mut link_click = use_signal(|| Option::<(String, String)>::None);
    // 链接表单的位置：Enter 路径下面板已关，坐标从最后一次
    // slash 消息的位置继承
    let mut link_pos = use_signal(|| (20f64, 160f64, 200f64));
    // 媒体选择请求（斜杠图片/画廊、图文块换图）
    let mut media_req = use_signal(|| Option::<MediaReq>::None);
    // 导出面板（菜单内切换，不是独立弹窗）
    let mut show_export = use_signal(|| false);
    // 页面滚动量：标题坞 >30 切换紧凑行态
    let mut ed_scroll = use_signal(|| 0f64);
    // 标题编辑态（原版 editingTitle）：聚焦时展开全文、失焦回截断
    // 显示；组合输入期间不提交标题信号（拼音安全，同原版口径）
    let mut title_editing = use_signal(|| false);
    let mut title_composing = use_signal(|| false);
    // 深浅模式切换计数（原版监听 matchMedia change 后重算背景）
    let mut scheme_tick = use_signal(|| 0u32);
    // 图文全文面板（blocks::TextSheet 上下文）
    let mut text_sheet = use_signal(|| Option::<(String, String)>::None);
    let mut sheet_edit = use_signal(|| false);
    let mut sheet_draft = use_signal(String::new);
    // 本篇头像（原版 per-note avatar，存 backup.avatars[memoId]）
    let mut avatar_url = use_signal(|| {
        data.read()
            .avatars
            .as_ref()
            .and_then(|a| a.get(&memo_id))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    });
    let mut dom_set = use_signal(|| Option::<(String, String, usize)>::None);
    // 背景色 / 双栏：存 memo.extra（原版 bgColor 顶层字段、layout 透传）
    let mut bg = use_signal(|| {
        memo.extra
            .get("bgColor")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    });
    let mut twopane = use_signal(|| {
        let layout = memo.extra.get("layout");
        if let Some(mode) = layout.and_then(|v| v.get("mode")).and_then(|v| v.as_str()) {
            return mode == "independent";
        }
        if layout
            .and_then(|v| v.get("twoPane"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            return true;
        }
        if layout.is_some() {
            return false;
        }
        web_sys::window()
            .and_then(|w| w.local_storage().ok().flatten())
            .and_then(|st| st.get_item("sj_editor_independent_scroll").ok().flatten())
            .map(|v| v == "1")
            .unwrap_or(false)
    });
    // 宽屏判定（原版双栏媒体查询）：(min-width:768px 且
    // min-height:600px) 或 min-width:1100px；matchMedia 监听
    let mut wide = use_signal(|| {
        web_sys::window()
            .map(|w| {
                w.match_media("(min-width: 768px) and (min-height: 600px), (min-width: 1100px)")
                    .ok()
                    .flatten()
                    .map(|m| m.matches())
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    });
    use_effect(move || {
        spawn(async move {
            let mut eval = document::eval(
                "const mq = window.matchMedia('(min-width: 768px) and (min-height: 600px), (min-width: 1100px)'); dioxus.send(mq.matches); mq.addEventListener('change', (e) => dioxus.send(e.matches));",
            );
            while let Ok(v) = eval.recv::<bool>().await {
                wide.set(v);
            }
        });
    });
    let mut menu_open = use_signal(|| false);
    let mut bg_open = use_signal(|| false);
    let mut ed_status = use_signal(String::new);
    // 撤销/重做：文档 JSON 快照栈（与原版 use-history 的全量快照思路一致）
    let mut hist = use_signal(|| {
        vec![serde_json::to_string(&memo.doc).unwrap_or_default()]
    });
    let mut hist_idx = use_signal(|| 0usize);
    let mut epoch = use_signal(|| 0u32);
    let mut lightbox = use_signal(|| Option::<String>::None);
    use_context_provider(|| crate::blocks::Lightbox(lightbox));
    use_context_provider(|| crate::blocks::TextSheet(text_sheet));
    let mut md_edit = use_signal(|| Option::<String>::None);
    use_context_provider(|| crate::blocks::MdEdit(md_edit));
    // 卡片重试（blocks::CardRetry 上下文）：音乐卡 error 态点重试
    let mut card_retry = use_signal(|| Option::<String>::None);
    use_context_provider(|| crate::blocks::CardRetry(card_retry));
    // Wiki 导航（blocks::WikiNav 上下文）：md 预览里的 wiki
    // 链接点击 → 先落盘当前编辑再导航（原版双链优先 + flush）
    let mut wiki_nav = use_signal(|| Option::<String>::None);
    use_context_provider(|| crate::blocks::WikiNav(wiki_nav));
    // 原子块选中态（blocks::SelBlock 上下文）
    let mut sel_block = use_signal(|| Option::<String>::None);
    use_context_provider(|| crate::blocks::SelBlock(sel_block));

    // 持久化：把当前标题+文档写回总数据并落 IndexedDB
    let persist = PersistHandle(std::rc::Rc::new({
        let memo_id = memo_id.clone();
        move |doc_snapshot: Vec<Node>, title_snapshot: String, mut data: Signal<BackupFile>| {
            let backup = build_backup(data, &memo_id, doc_snapshot, title_snapshot);
            data.set(backup.clone());
            spawn(async move {
                save_backup(&backup).await;
            });
        }
    }));

    // JS 桥：挂载时装一次，消息循环处理全部编辑操作
    {
        let memo_id = memo_id.clone();
        let persist_bridge = persist.clone();
        use_effect(move || {
            let persist = persist_bridge.clone();
            diag::log("EDIT", &format!("open memo={memo_id}"));
            spawn(async move {
                let mut eval = document::eval(EDITOR_JS);
                while let Ok(msg) = eval.recv::<String>().await {
                    let before = serde_json::to_string(&*doc.read()).unwrap_or_default();
                    handle_bridge_msg(&msg, doc, title, data, panel, link_for, link_pos, focus_req, dom_set, md_edit, sel_block, manifest, &persist);
                    let after = serde_json::to_string(&*doc.read()).unwrap_or_default();
                    if after != before {
                        hist_push(hist, hist_idx, after);
                    }
                }
                diag::log("EDIT", "bridge channel closed");
            });
        });
    }

    // 结构操作后的光标恢复
    use_effect(move || {
        let req = focus_req.read().clone();
        if let Some((bid, off)) = req {
            focus_req.set(None);
            spawn(async move {
                let js = format!(
                    "if (window.__mnFocus) window.__mnFocus({}, {}); dioxus.send(null);",
                    serde_json::to_string(&bid).unwrap_or_default(),
                    off
                );
                let mut eval = document::eval(&js);
                let _ = eval.recv::<Value>().await;
            });
        }
    });

    // 多行粘贴后，当前块的 DOM 由桥按模型回写（非受控块不会
    // 自己重渲染）并把光标放到首行末尾
    use_effect(move || {
        let req = dom_set.read().clone();
        if let Some((bid, html, off)) = req {
            dom_set.set(None);
            spawn(async move {
                let js = format!(
                    "if (window.__mnSetHtml) window.__mnSetHtml({}, {}, {}); dioxus.send(null);",
                    serde_json::to_string(&bid).unwrap_or_default(),
                    serde_json::to_string(&html).unwrap_or_default(),
                    off
                );
                let mut eval = document::eval(&js);
                let _ = eval.recv::<Value>().await;
            });
        }
    });

    // 斜杠面板的点击在 Editor 作用域里执行（SlashPanel 点击后
    // 立即卸载，它自己 spawn 的异步会被一并取消——踩过）。
    // 按命令类别分流：行内命令走 __mnInline 就地执行；图片/画廊
    // 走文件选择替换当前块；其余走 strip + op_convert。
    {
        let persist = persist.clone();
        use_effect(move || {
            let click = slash_click.read().clone();
            if let Some((bid, act)) = click {
                slash_click.set(None);
                slash_record_recent(&act);
                let persist = persist.clone();
                if INLINE_ACTS.contains(&act.as_str()) {
                    spawn(async move {
                        let js = format!(
                            "dioxus.send(window.__mnInline ? window.__mnInline({}, {}) : '');",
                            serde_json::to_string(&act).unwrap_or_default(),
                            serde_json::to_string(&bid).unwrap_or_default()
                        );
                        let mut eval = document::eval(&js);
                        let html = eval.recv::<String>().await.unwrap_or_default();
                        let mut d = doc.read().clone();
                        if let Some(loc) = find_loc(&d, &bid) {
                            node_at_mut(&mut d, loc).children =
                                Some(html_to_inlines(&html));
                            doc.set(d.clone());
                            persist.call(d, title.read().clone(), data);
                            diag::log("EDIT", &format!("slash inline {act} {bid}"));
                        }
                    });
                } else if act == "image" || act == "gallery" {
                    media_req.set(Some(MediaReq::Replace {
                        bid: bid.clone(),
                        gallery: act == "gallery",
                    }));
                    spawn(async move {
                        let mut eval = document::eval(
                            "const i = document.getElementById('file-media'); if (i) i.click(); dioxus.send(null);",
                        );
                        let _ = eval.recv::<Value>().await;
                    });
                } else {
                    spawn(async move {
                        let js = format!(
                            "dioxus.send(window.__mnStripSlash ? window.__mnStripSlash({}) : '');",
                            serde_json::to_string(&bid).unwrap_or_default()
                        );
                        let mut eval = document::eval(&js);
                        let html = eval.recv::<String>().await.unwrap_or_default();
                        let mut doc = doc;
                        let mut focus_req = focus_req;
                        let mut md_edit = md_edit;
                        let mut dom_set = dom_set;
                        if let Some(src) = op_convert(&mut doc, &bid, &act, &html, &mut focus_req, &mut md_edit) {
                            // md 源转换：DOM 回写为源码（<br> 换行）并聚焦
                            let esc = src
                                .replace('&', "&amp;")
                                .replace('<', "&lt;")
                                .replace('>', "&gt;")
                                .replace('\n', "<br>");
                            let len = src.chars().count();
                            dom_set.set(Some((bid.clone(), esc, len)));
                        }
                        persist.call(doc.read().clone(), title.read().clone(), data);
                    });
                }
            }
        });
    }

    // 链接表单提交：__mnStripSlash 后 __mnApplyLink（桥内恢复
    // 打开表单前保存的选区），返回的 HTML 对齐模型
    {
        let persist = persist.clone();
        use_effect(move || {
            let click = link_click.read().clone();
            if let Some((bid, url)) = click {
                link_click.set(None);
                link_for.set(None);
                slash_record_recent("link");
                let persist = persist.clone();
                spawn(async move {
                    let js = format!(
                        "if (window.__mnStripSlash) window.__mnStripSlash({0}); dioxus.send(window.__mnApplyLink ? window.__mnApplyLink({1}, {0}) : '');",
                        serde_json::to_string(&bid).unwrap_or_default(),
                        serde_json::to_string(&url).unwrap_or_default()
                    );
                    let mut eval = document::eval(&js);
                    let html = eval.recv::<String>().await.unwrap_or_default();
                    let mut d = doc.read().clone();
                    if let Some(loc) = find_loc(&d, &bid) {
                        node_at_mut(&mut d, loc).children =
                            Some(html_to_inlines(&html));
                        doc.set(d.clone());
                        persist.call(d, title.read().clone(), data);
                        diag::log("EDIT", &format!("slash link {bid}"));
                    }
                });
            }
        });
    }

    // 滚动量订阅：标题坞紧凑态切换（>30px）
    use_effect(move || {
        spawn(async move {
            let mut eval = document::eval(
                "let last = -1; const f = () => { const y = window.scrollY || 0; if (Math.abs(y - last) > 2) { last = y; dioxus.send(y); } }; window.addEventListener('scroll', f, { passive: true }); f();",
            );
            while let Ok(y) = eval.recv::<f64>().await {
                ed_scroll.set(y);
            }
        });
    });

    // 背景系统（原版 editor.js 两段 useLayoutEffect 的移植）：
    // ① 顶部 body::before 渐变随滚动 alpha=scrollY/30 变化，
    //    颜色取 body 计算背景（即当前编辑器背景）；rAF 节流。
    // ② 深浅模式切换时通知 Rust 重渲染（根节点颜色在渲染期算）。
    use_effect(move || {
        spawn(async move {
            let mut eval = document::eval(
                "(() => { \
                   if (window.__mnBgCleanup) window.__mnBgCleanup(); \
                   const update = () => { \
                     if (!window.__mnBgActive) return; \
                     const y = window.scrollY || 0; \
                     const alpha = y <= 0 ? 0 : y >= 30 ? 1 : y / 30; \
                     let st = document.getElementById('body-before-bg'); \
                     if (!st) { st = document.createElement('style'); st.id = 'body-before-bg'; document.head.appendChild(st); } \
                     if (alpha <= 0.01) { st.textContent = 'body::before { background: transparent !important; }'; return; } \
                     const cs = getComputedStyle(document.body).backgroundColor || 'rgb(250,250,250)'; \
                     const m = cs.match(/[\\d.]+/g) || [250, 250, 250]; \
                     const rgb = m.slice(0, 3).join(','); \
                     st.textContent = 'body::before { background: linear-gradient(to bottom, rgba(' + rgb + ',' + (alpha * 0.82) + ') 0%, rgba(' + rgb + ',' + (alpha * 0.6) + ') 50%, rgba(' + rgb + ',0) 100%) !important; }'; \
                   }; \
                   let ticking = false; \
                   const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } }; \
                   window.addEventListener('scroll', onScroll, { passive: true }); \
                   window.__mnBgUpdate = update; \
                   window.__mnBgActive = true; \
                   window.__mnBgCleanup = () => { window.__mnBgActive = false; window.removeEventListener('scroll', onScroll); const s = document.getElementById('body-before-bg'); if (s) s.remove(); window.__mnBgUpdate = null; }; \
                   update(); \
                   const mq = window.matchMedia('(prefers-color-scheme: dark)'); \
                   mq.addEventListener('change', () => dioxus.send('scheme')); \
                 })(); dioxus.send('ready');",
            );
            while let Ok(msg) = eval.recv::<String>().await {
                if msg == "scheme" {
                    let next = scheme_tick.read().wrapping_add(1);
                    scheme_tick.set(next);
                    spawn(async move {
                        let mut eval = document::eval(
                            "if (window.__mnBgUpdate) window.__mnBgUpdate(); dioxus.send(null);",
                        );
                        let _ = eval.recv::<Value>().await;
                    });
                }
            }
        });
    });

    // 背景色延伸到安全区（原版：编辑期间 html/body 背景 = 编辑器
    // 背景）；bg 变化（底表选色）时同步更新并刷新顶部渐变
    use_effect(move || {
        let c = effective_bg(&bg.read().clone());
        spawn(async move {
            let js = format!(
                "document.documentElement.style.backgroundColor = {}; document.body.style.backgroundColor = {}; if (window.__mnBgUpdate) window.__mnBgUpdate(); dioxus.send(null);",
                serde_json::to_string(&c).unwrap_or_default(),
                serde_json::to_string(&c).unwrap_or_default()
            );
            let mut eval = document::eval(&js);
            let _ = eval.recv::<Value>().await;
        });
    });

    // 卸载清理：恢复 html/body 背景、撤顶部渐变（原版 cleanup）
    use_drop(move || {
        spawn(async move {
            let mut eval = document::eval(
                "if (window.__mnBgCleanup) window.__mnBgCleanup(); document.documentElement.style.backgroundColor = ''; document.body.style.backgroundColor = ''; dioxus.send(null);",
            );
            let _ = eval.recv::<Value>().await;
        });
    });

    // 打开时补拉（原版 hydrate）：musicCard/link-card 有 url 且
    // 无标题 meta 或仍在 loading → 逐张解析（挂载快照，只跑一次）
    {
        let persist = persist.clone();
        use_effect(move || {
            let snapshot = doc.peek().clone();
            for n in &snapshot {
                let ty = n.node_type.as_deref().unwrap_or("");
                if ty != "musicCard" && ty != "music" && ty != "link-card" {
                    continue;
                }
                let url = n.extra.get("url").and_then(|v| v.as_str()).unwrap_or("");
                if url.is_empty() {
                    continue;
                }
                let status = n.extra.get("status").and_then(|v| v.as_str()).unwrap_or("");
                let has_title = n
                    .extra
                    .get("meta")
                    .and_then(|m| m.get("title"))
                    .and_then(|v| v.as_str())
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
                if has_title && status != "loading" {
                    continue;
                }
                if let Some(bid) = n.id.clone() {
                    spawn_resolve_card(doc, bid, url.to_string(), title, data, persist.clone());
                }
            }
        });
    }

    // 卡片重试（原版 retryMusicCard）：先置 loading 再解析
    {
        let persist = persist.clone();
        use_effect(move || {
            let retry_req = card_retry.read().clone();
            if let Some(bid) = retry_req {
                card_retry.set(None);
                let mut d = doc.read().clone();
                if let Some(loc) = find_loc(&d, &bid) {
                    let url = {
                        let n = node_at_mut(&mut d, loc);
                        n.extra.insert("meta".into(), serde_json::Value::Null);
                        n.extra.insert("status".into(), json!("loading"));
                        n.extra
                            .get("url")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string()
                    };
                    if !url.is_empty() {
                        doc.set(d.clone());
                        persist.call(d, title.read().clone(), data);
                        diag::log("CARD", &format!("retry {bid}"));
                        spawn_resolve_card(doc, bid, url, title, data, persist.clone());
                    }
                }
            }
        });
    }

    // Wiki 导航：收到 target 后先落盘当前 doc/title（原版
    // flushAutoSave 后导航；落盘失败也照样导航，仅记日志），
    // 再回调宿主解析目标（命中打开 / 未命中新建同名备忘）。
    {
        let persist = persist.clone();
        let on_open_wiki = on_open_wiki.clone();
        let from_id = memo_id.clone();
        use_effect(move || {
            let req = wiki_nav.read().clone();
            if let Some(target) = req {
                wiki_nav.set(None);
                persist.call(doc.read().clone(), title.read().clone(), data);
                diag::log("WIKI", &format!("nav '{target}' from {from_id}"));
                on_open_wiki.call(target);
            }
        });
    }

    // 图文面板打开时重置草稿（编辑态从只读开始）
    use_effect(move || {
        if let Some((_, t)) = text_sheet.read().clone() {
            sheet_draft.set(t);
            sheet_edit.set(false);
        }
    });

    // 返回：全量同步 → 落库 → 关页；空笔记（无文本、无卡片块、
    // 无背景、标题为空）按原版规则关闭即删除
    let go_back = {
        let memo_id = memo_id.clone();
        let initial_title = initial_title.clone();
        move |_| {
            let memo_id = memo_id.clone();
            let initial_title = initial_title.clone();
            spawn(async move {
                let mut eval = document::eval(
                    "dioxus.send(window.__mnSyncAll ? JSON.stringify(window.__mnSyncAll()) : '{}');",
                );
                let mut d = doc.read().clone();
                match eval.recv::<String>().await {
                    Ok(s) => apply_sync_map(&mut d, &s),
                    Err(e) => {
                        diag::log("EDIT", &format!("back-sync recv err: {e:?}"))
                    }
                }
                doc.set(d.clone());
                let has_text = d.iter().any(|b| !b.plain_text().trim().is_empty());
                let has_card = d.iter().any(|b| {
                    matches!(
                        b.node_type.as_deref(),
                        Some(
                            "image"
                                | "video"
                                | "music"
                                | "attachment"
                                | "link-card"
                                | "gallery"
                                | "divider"
                        )
                    )
                });
                let norm_title = |v: &str| {
                    let t = v.trim();
                    if t.is_empty() { "无标题".to_string() } else { t.to_string() }
                };
                let empty = is_new
                    && !*typed.read()
                    && !has_text
                    && !has_card
                    && bg.read().is_none()
                    && avatar_url.read().is_none()
                    && norm_title(&title.read()) == norm_title(&initial_title);
                if empty {
                    let mut backup = data.read().clone();
                    backup.memos.retain(|m| m.id.to_string() != memo_id);
                    data.set(backup.clone());
                    diag::log("EDIT", &format!("close empty memo -> deleted {memo_id}"));
                    save_backup(&backup).await;
                    on_close.call(());
                    return;
                }
                // 双栏开启时把归一化 layout 一并落库（原版
                // 保存路径 captureCurrentColumnLayout 口径）
                let boundary = if *twopane.read() {
                    let cur = data
                        .read()
                        .memos
                        .iter()
                        .find(|m| m.id.to_string() == memo_id)
                        .and_then(|m| m.extra.get("layout").cloned());
                    Some(column_boundary(&d, cur.as_ref()))
                } else {
                    None
                };
                let mut backup = build_backup(data, &memo_id, d.clone(), title.read().clone());
                if let Some(b) = boundary {
                    if let Some(m) = backup
                        .memos
                        .iter_mut()
                        .find(|m| m.id.to_string() == memo_id)
                    {
                        let ids: Vec<Value> = d
                            .iter()
                            .map(|n| {
                                Value::String(
                                    n.id.as_ref().map(|i| i.to_string()).unwrap_or_default(),
                                )
                            })
                            .collect();
                        let (left, right) = ids.split_at(b.min(ids.len()));
                        m.extra.insert(
                            "layout".to_string(),
                            json!({"version": 1, "mode": "independent", "left": left, "right": right}),
                        );
                    }
                }
                data.set(backup.clone());
                save_backup(&backup).await;
                on_close.call(());
            });
        }
    };

    // 撤销：先把当前 DOM 全量同步进模型并压栈（保证重做能回来），
    // 再恢复上一快照并整体重挂载块（非受控块靠 epoch 换代重初始化）
    let do_undo = {
        let persist = persist.clone();
        move |_| {
            menu_open.set(false);
            let persist = persist.clone();
            spawn(async move {
                let mut eval = document::eval(
                    "dioxus.send(window.__mnSyncAll ? JSON.stringify(window.__mnSyncAll()) : '{}');",
                );
                let mut d = doc.read().clone();
                if let Ok(s) = eval.recv::<String>().await {
                    apply_sync_map(&mut d, &s);
                    doc.set(d.clone());
                }
                let cur = serde_json::to_string(&d).unwrap_or_default();
                let mut h = hist.read().clone();
                let mut idx = *hist_idx.read();
                if h.get(idx).map(|x| x.as_str()) != Some(cur.as_str()) {
                    h.truncate(idx + 1);
                    h.push(cur);
                    idx = h.len() - 1;
                }
                if idx == 0 {
                    hist.set(h);
                    hist_idx.set(idx);
                    return;
                }
                idx -= 1;
                if let Ok(nd) = serde_json::from_str::<Vec<Node>>(&h[idx]) {
                    doc.set(nd.clone());
                    let e = *epoch.read();
                    epoch.set(e + 1);
                    persist.call(nd, title.read().clone(), data);
                    diag::log("EDIT", &format!("undo -> snapshot {idx}"));
                }
                hist.set(h);
                hist_idx.set(idx);
            });
        }
    };

    let do_redo = {
        let persist = persist.clone();
        move |_| {
            menu_open.set(false);
            let h = hist.read().clone();
            let idx = *hist_idx.read();
            if idx + 1 < h.len() {
                if let Ok(nd) = serde_json::from_str::<Vec<Node>>(&h[idx + 1]) {
                    doc.set(nd.clone());
                    let e = *epoch.read();
                    epoch.set(e + 1);
                    hist_idx.set(idx + 1);
                    persist.call(nd, title.read().clone(), data);
                    diag::log("EDIT", &format!("redo -> snapshot {}", idx + 1));
                }
            }
        }
    };

    // 导出笔记：语义 Markdown 下载（对齐原版 export 的 MD 路径）
    let export_md = {
        let memo_id = memo_id.clone();
        move |_| {
            menu_open.set(false);
            show_export.set(false);
            let t = title.read().clone();
            let md = memo_to_markdown(&t, &doc.read(), &manifest.read());
            let name = if t.trim().is_empty() {
                "note".to_string()
            } else {
                t.trim().to_string()
            };
            download_text(&format!("{name}.md"), &md, "text/markdown");
            ed_status.set(crate::i18n::t("export.done"));
            diag::log("EDIT", &format!("export md memo={memo_id} {}B", md.len()));
        }
    };

    // 背景色：写 memo.extra["bgColor"]（原版同名字段），落库
    let set_bg = {
        let memo_id = memo_id.clone();
        move |color: Option<String>| {
            bg_open.set(false);
            bg.set(color.clone());
            let mut backup = data.read().clone();
            if let Some(m) = backup
                .memos
                .iter_mut()
                .find(|m| m.id.to_string() == memo_id)
            {
                match &color {
                    Some(c) => {
                        m.extra
                            .insert("bgColor".to_string(), Value::String(c.clone()));
                    }
                    None => {
                        m.extra.remove("bgColor");
                    }
                }
            }
            data.set(backup.clone());
            diag::log("EDIT", &format!("bg -> {color:?}"));
            spawn(async move {
                save_backup(&backup).await;
            });
        }
    };

    // 双栏开关（原版 toggleIndependentColumns 口径）：layout
    // 写原版形状 {version:1, mode, left, right}（归一化后
    // left/right 即分界点前后），并记 localStorage 默认值
    // 供无 layout 的备忘下次打开沿用。
    let toggle_twopane = {
        let memo_id = memo_id.clone();
        move |_| {
            let next = !*twopane.read();
            twopane.set(next);
            if let Some(st) = web_sys::window()
                .and_then(|w| w.local_storage().ok().flatten())
            {
                let _ = st.set_item(
                    "sj_editor_independent_scroll",
                    if next { "1" } else { "0" },
                );
            }
            let mut backup = data.read().clone();
            if let Some(m) = backup
                .memos
                .iter_mut()
                .find(|m| m.id.to_string() == memo_id)
            {
                let d = doc.read().clone();
                let b = column_boundary(&d, m.extra.get("layout"));
                let ids: Vec<Value> = d
                    .iter()
                    .map(|n| Value::String(n.id.as_ref().map(|i| i.to_string()).unwrap_or_default()))
                    .collect();
                let (left, right) = ids.split_at(b.min(ids.len()));
                m.extra.insert(
                    "layout".to_string(),
                    json!({
                        "version": 1,
                        "mode": if next { "independent" } else { "flow" },
                        "left": left,
                        "right": right,
                    }),
                );
            }
            data.set(backup.clone());
            diag::log("EDIT", &format!("twopane -> {next}"));
            spawn(async move {
                save_backup(&backup).await;
            });
        }
    };

    let doc_snapshot = doc.read().clone();
    let panel_state = panel.read().clone();

    let bg_state = bg.read().clone();
    let menu_state = *menu_open.read();
    let bg_sheet_state = *bg_open.read();
    let can_undo = *hist_idx.read() > 0;
    let can_redo = *hist_idx.read() + 1 < hist.read().len();
    let words = orig_char_count(&doc_snapshot);
    let sub_line = format!(
        "{} · {}",
        time_label(memo.updated_at.to_millis().unwrap_or(0)),
        crate::i18n::tf("editor.words", &[("n", &words.to_string())])
    );
    let ed_status_text = ed_status.read().clone();
    let persist_attach = persist.clone();
    // 导出 HTML / PDF（原版导出面板的另两条路径）
    let export_html = {
        let memo_id = memo_id.clone();
        let memo_upd = memo.updated_at.to_millis().unwrap_or(0);
        move |_| {
            menu_open.set(false);
            show_export.set(false);
            let t = title.read().clone();
            let d = doc.read().clone();
            let subtitle = format!(
                "{} · {}",
                time_label(memo_upd),
                crate::i18n::tf("editor.words", &[("n", &orig_char_count(&d).to_string())])
            );
            let av = avatar_url.read().clone();
            let bgc = bg.read().clone();
            let mut ed_status2 = ed_status;
            let memo_id = memo_id.clone();
            spawn(async move {
                let css = collect_app_css().await;
                let html = doc_to_html(&t, &d, &subtitle, av.as_deref(), bgc.as_deref(), &css);
                let name = if t.trim().is_empty() {
                    "note".to_string()
                } else {
                    t.trim().to_string()
                };
                download_text(&format!("{name}.html"), &html, "text/html");
                ed_status2.set(crate::i18n::t("export.done"));
                diag::log("EDIT", &format!("export html memo={memo_id} {}B", html.len()));
            });
        }
    };
    let export_pdf = {
        let memo_id = memo_id.clone();
        let memo_upd = memo.updated_at.to_millis().unwrap_or(0);
        move |_| {
            menu_open.set(false);
            show_export.set(false);
            let t = title.read().clone();
            let d = doc.read().clone();
            let subtitle = format!(
                "{} · {}",
                time_label(memo_upd),
                crate::i18n::tf("editor.words", &[("n", &orig_char_count(&d).to_string())])
            );
            let av = avatar_url.read().clone();
            let bgc = bg.read().clone();
            diag::log("EDIT", &format!("export pdf memo={memo_id}"));
            spawn(async move {
                let css = collect_app_css().await;
                let html = doc_to_html(&t, &d, &subtitle, av.as_deref(), bgc.as_deref(), &css);
                diag::log("EDIT", &format!("export pdf doc {}B", html.len()));
                let js = format!(
                    "const w = window.open('', '_blank'); if (w) {{ w.document.write({}); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }} dioxus.send(null);",
                    serde_json::to_string(&html).unwrap_or_default()
                );
                let mut eval = document::eval(&js);
                let _ = eval.recv::<Value>().await;
            });
        }
    };

    // 头像选择：读为 data URL 存入 backup.avatars[memoId]（原版
    // saveAvatarToDB 的备份等价物），整包落库
    let pick_avatar = {
        let memo_id = memo_id.clone();
        move |_| {
            let memo_id = memo_id.clone();
            spawn(async move {
                let mut eval = document::eval(
                    "const f = document.getElementById('file-avatar'); const file = f && f.files && f.files[0]; if (!file) { dioxus.send(''); } else { const r = new FileReader(); r.onload = () => dioxus.send(String(r.result || '')); r.onerror = () => dioxus.send(''); r.readAsDataURL(file); }",
                );
                if let Ok(url) = eval.recv::<String>().await {
                    if !url.is_empty() {
                        avatar_url.set(Some(url.clone()));
                        let mut backup = data.read().clone();
                        let mut av = backup
                            .avatars
                            .take()
                            .filter(|v| v.is_object())
                            .unwrap_or_else(|| json!({}));
                        if let Some(obj) = av.as_object_mut() {
                            obj.insert(memo_id.clone(), Value::String(url));
                        }
                        backup.avatars = Some(av);
                        data.set(backup.clone());
                        save_backup(&backup).await;
                        diag::log("EDIT", &format!("avatar set memo={memo_id}"));
                    }
                }
            });
        }
    };

    // 媒体文件选择完成：按 media_req 分发（替换块 / 图文换图）
    let on_media_files = {
        let persist = persist.clone();
        move |_| {
            let persist = persist.clone();
            spawn(async move {
                handle_media_files(doc, title, data, manifest, media_req, &persist).await;
            });
        }
    };

    let _scheme = *scheme_tick.read();
    let scrolled = *ed_scroll.read() > 30.0;
    let avatar_state = avatar_url.read().clone();
    // 标题坞口径（原版 editor.js 标题坞段）：非编辑态显示截断
    // 标题（超 10 字加 …），字号长标题（>5 字）11px 否则 14px；
    // 横向溢出模式仅编辑态且 >11 字时进入（胶囊定宽 184px）
    let raw_title = title.read().clone();
    let editing_now = *title_editing.read();
    let display_title = display_title_of(&raw_title);
    let shown_len = if editing_now {
        raw_title.chars().count()
    } else {
        display_title.chars().count()
    };
    let is_long = shown_len > 5;
    let is_overflow = editing_now && raw_title.chars().count() > 11;
    let capsule_cls = format!(
        "editor-title-capsule{}{}{}",
        if is_long { " long" } else { "" },
        if is_overflow { " overflow" } else { "" },
        if editing_now { " editing" } else { "" }
    );
    let title_cls = format!(
        "editor-title-input{}",
        if is_overflow {
            " is-overflow"
        } else if is_long {
            " is-long"
        } else {
            ""
        }
    );
    let meta_line = format!(
        "{} · {}",
        crate::list::time_ago(&memo.updated_at),
        crate::i18n::tf("editor.words", &[("n", &words.to_string())])
    );
    let sheet_state = text_sheet.read().clone();
    let sheet_editing = *sheet_edit.read();
    let twopane_state = *twopane.read();
    // 双栏独立滚动：开关开 + 宽屏时按 layout 分界拆两栏
    let two_col = twopane_state && *wide.read();
    let boundary = if two_col {
        let layout = data
            .read()
            .memos
            .iter()
            .find(|m| m.id.to_string() == memo_id)
            .and_then(|m| m.extra.get("layout").cloned());
        column_boundary(&doc_snapshot, layout.as_ref())
    } else {
        0
    };
    let export_open = *show_export.read();
    let link_state = link_for.read().clone();
    let (link_x, link_top, link_bottom) = *link_pos.read();

    rsx! {
        div {
            id: "editor-root",
            // 有效背景（自定义色深色压暗 / 默认 #FAFAFA / 深色 #000）；
            // 写具体色不用 var()（CSSOM 对 var() 简写静默拒绝的坑）
            style: format!("background:{}", effective_bg(&bg_state)),
            button {
                class: "editor-fab left",
                onclick: go_back,
                dangerous_inner_html: "{crate::icons::back_markup()}",
            }
            button {
                class: "editor-fab right",
                onclick: move |_| {
                    // 读信号现值而非渲染期快照：状态刚变而未重渲染时
                    // 快照会让开关方向反转（冒烟实测踩过）
                    if *menu_open.read() {
                        menu_open.set(false);
                        show_export.set(false);
                    } else {
                        spawn(async move {
                            let mut eval = document::eval(
                                "dioxus.send(window.__mnSyncAll ? JSON.stringify(window.__mnSyncAll()) : '{}');",
                            );
                            let mut d = doc.read().clone();
                            if let Ok(s) = eval.recv::<String>().await {
                                apply_sync_map(&mut d, &s);
                                doc.set(d.clone());
                                hist_push(
                                    hist,
                                    hist_idx,
                                    serde_json::to_string(&d).unwrap_or_default(),
                                );
                            }
                            menu_open.set(true);
                        });
                    }
                },
                dangerous_inner_html: "{crate::icons::dots_markup()}",
            }
            div {
                class: if scrolled { "editor-title-dock scrolled" } else { "editor-title-dock" },
                label {
                    class: "editor-avatar-button",
                    style: if avatar_state.is_some() { "border:none;background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none" } else { "" },
                    if let Some(u) = &avatar_state {
                        img { src: "{u}", style: "width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" }
                    } else {
                        span { dangerous_inner_html: "{crate::icons::dino_markup(60, 10)}" }
                    }
                    input {
                        id: "file-avatar",
                        r#type: "file",
                        accept: "image/*",
                        class: "hidden-input",
                        onchange: pick_avatar,
                    }
                }
                div { class: "{capsule_cls}",
                    div {
                        class: if is_overflow { "editor-title-scroller overflow" } else { "editor-title-scroller" },
                        TitleText {
                            display: display_title.clone(),
                            cls: title_cls.clone(),
                            font_px: if is_long { 11 } else { 14 },
                            title,
                            editing: title_editing,
                            composing: title_composing,
                        }
                    }
                    div { class: "editor-title-meta", "{meta_line}" }
                }
            }
            if !ed_status_text.is_empty() {
                div { key: "{ed_status_text}", class: "status-toast", "{ed_status_text}" }
            }
            if menu_state {
                div {
                    class: "menu-scrim",
                    onclick: move |_| {
                        menu_open.set(false);
                        show_export.set(false);
                    },
                }
                if export_open {
                    div { class: "editor-export-panel",
                        div { class: "export-head",
                            button {
                                class: "export-back",
                                onclick: move |_| show_export.set(false),
                                dangerous_inner_html: "{crate::icons::back_markup()}",
                            }
                            div { class: "export-title", "{crate::i18n::t(\"export.title\")}" }
                        }
                        div { class: "export-choices",
                            button { class: "editor-export-choice", onclick: export_md,
                                span { class: "export-badge", "MD" }
                                span { class: "export-copy",
                                    span { class: "export-label", "{crate::i18n::t(\"export.md\")}" }
                                    span { class: "export-detail", "{crate::i18n::t(\"export.md_detail\")}" }
                                }
                            }
                            button { class: "editor-export-choice", onclick: export_html,
                                span { class: "export-badge", "<>" }
                                span { class: "export-copy",
                                    span { class: "export-label", "{crate::i18n::t(\"export.html\")}" }
                                    span { class: "export-detail", "{crate::i18n::t(\"export.html_detail\")}" }
                                }
                            }
                            button { class: "editor-export-choice", onclick: export_pdf,
                                span { class: "export-badge", "PDF" }
                                span { class: "export-copy",
                                    span { class: "export-label", "{crate::i18n::t(\"export.pdf\")}" }
                                    span { class: "export-detail", "{crate::i18n::t(\"export.pdf_detail\")}" }
                                }
                            }
                        }
                    }
                } else {
                    div { class: "editor-menu-panel",
                        button {
                            class: "menu-item twopane-row",
                            onclick: toggle_twopane,
                            span { class: "menu-icon", crate::icons::Icon { name: "columns".to_string(), size: 20, stroke_width: "2.5".to_string(), stroke: "var(--color-accent)".to_string() } }
                            span { class: "menu-copy",
                                span { class: "menu-title", "{crate::i18n::t(\"menu.twopane\")}" }
                                span { class: "menu-sub", "{crate::i18n::t(\"menu.twopane_sub\")}" }
                            }
                            span { class: if twopane_state { "switch on" } else { "switch" },
                                span { class: "knob" }
                            }
                        }
                        button {
                            class: if can_undo { "menu-item" } else { "menu-item dis" },
                            disabled: !can_undo,
                            onclick: do_undo,
                            span { class: "menu-icon", crate::icons::Icon { name: "undo".to_string(), size: 20, stroke_width: "2.5".to_string(), stroke: "var(--color-accent)".to_string() } }
                            span { class: "menu-copy",
                                span { class: "menu-title", "{crate::i18n::t(\"menu.undo\")}" }
                                span { class: "menu-sub", "{crate::i18n::t(\"menu.undo_sub\")}" }
                            }
                        }
                        button {
                            class: if can_redo { "menu-item" } else { "menu-item dis" },
                            disabled: !can_redo,
                            onclick: do_redo,
                            span { class: "menu-icon", crate::icons::Icon { name: "redo".to_string(), size: 20, stroke_width: "2.5".to_string(), stroke: "var(--color-accent)".to_string() } }
                            span { class: "menu-copy",
                                span { class: "menu-title", "{crate::i18n::t(\"menu.redo\")}" }
                                span { class: "menu-sub", "{crate::i18n::t(\"menu.redo_sub\")}" }
                            }
                        }
                        label { class: "menu-item", style: "margin-top:4px", r#for: "file-attach",
                            span { class: "menu-icon", crate::icons::Icon { name: "attach".to_string(), size: 20, stroke_width: "2.5".to_string(), stroke: "var(--color-accent)".to_string() } }
                            span { class: "menu-copy",
                                span { class: "menu-title", "{crate::i18n::t(\"menu.attach\")}" }
                                span { class: "menu-sub", "{crate::i18n::t(\"menu.attach_sub\")}" }
                            }
                        }
                        div { class: "menu-section",
                            button {
                                class: "menu-item",
                                onclick: move |_| show_export.set(true),
                                span { class: "menu-icon", crate::icons::Icon { name: "export".to_string(), size: 20, stroke_width: "2.5".to_string(), stroke: "var(--color-accent)".to_string() } }
                                span { class: "menu-copy",
                                    span { class: "menu-title", "{crate::i18n::t(\"menu.export\")}" }
                                    span { class: "menu-sub", "{crate::i18n::t(\"menu.export_sub\")}" }
                                }
                                span { class: "menu-chevron", "›" }
                            }
                        }
                        button {
                            class: "menu-item",
                            style: "margin-top:4px",
                            onclick: move |_| {
                                menu_open.set(false);
                                bg_open.set(true);
                            },
                            span { class: "menu-icon", crate::icons::Icon { name: "palette".to_string(), size: 20, stroke_width: "2.5".to_string(), stroke: "var(--color-accent)".to_string() } }
                            span { class: "menu-copy",
                                span { class: "menu-title", "{crate::i18n::t(\"menu.bg\")}" }
                                span { class: "menu-sub", "{crate::i18n::t(\"menu.bg_sub\")}" }
                            }
                        }
                    }
                }
            }
            if bg_sheet_state {
                div {
                    class: "sheet-scrim",
                    onclick: move |_| bg_open.set(false),
                }
                div { class: "sheet-wrap",
                    div { class: "bg-sheet",
                        div { class: "bg-head",
                            div { class: "bg-title", "{crate::i18n::t(\"bg.title\")}" }
                            div { class: "bg-sub", "{crate::i18n::t(\"bg.sub\")}" }
                        }
                        div { class: "bg-grid",
                            for c in BG_COLORS {
                                button {
                                    key: "{c}",
                                    class: if bg_state.as_deref() == Some(c) { "bg-dot sel" } else { "bg-dot" },
                                    style: "background:{c}",
                                    onclick: {
                                        let mut set_bg = set_bg.clone();
                                        move |_| set_bg(Some(c.to_string()))
                                    },
                                    if bg_state.as_deref() == Some(c) {
                                        span { dangerous_inner_html: "{crate::icons::svg_markup(\"check\", 20, \"2.5\", \"#007AFF\")}" }
                                    }
                                }
                            }
                        }
                        if bg_state.is_some() {
                            div { class: "bg-remove-wrap",
                                button {
                                    class: "bg-remove",
                                    onclick: {
                                        let mut set_bg = set_bg.clone();
                                        move |_| set_bg(None)
                                    },
                                    span { class: "col",
                                        span { class: "row",
                                            crate::icons::Icon { name: "del".to_string(), size: 17, stroke_width: "2.5".to_string(), stroke: "var(--color-danger-bright)".to_string() }
                                            span { class: "tx", "{crate::i18n::t(\"bg.remove\")}" }
                                        }
                                        span { class: "note", "{crate::i18n::t(\"bg.note\")}" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            div {
                class: if twopane_state { "detail spread" } else { "detail" },
                key: "{epoch}",
                div { class: "editor-pad editor-spread",
                    if two_col {
                        div { class: "editor-body is-independent-scroll",
                            div { class: "editor-column", "data-editor-column": "left",
                                for block in doc_snapshot[..boundary].iter() {
                                    EditorBlock { key: "{epoch}-{block.id.clone().unwrap_or_default()}", node: block.clone(), gen, doc, title, data, persist: persist.clone(), media_req }
                                }
                            }
                            div { class: "editor-column", "data-editor-column": "right",
                                for block in doc_snapshot[boundary..].iter() {
                                    EditorBlock { key: "{epoch}-{block.id.clone().unwrap_or_default()}", node: block.clone(), gen, doc, title, data, persist: persist.clone(), media_req }
                                }
                            }
                        }
                    } else {
                        div { class: if !*typed.read()
                            && doc_snapshot.len() == 1
                            && doc_snapshot[0].node_type.as_deref() == Some("paragraph")
                            && doc_snapshot[0].plain_text().trim().is_empty()
                        { "editor-body show-placeholder" } else { "editor-body" },
                            for block in doc_snapshot.iter() {
                                EditorBlock { key: "{epoch}-{block.id.clone().unwrap_or_default()}", node: block.clone(), gen, doc, title, data, persist: persist.clone(), media_req }
                            }
                        }
                    }
                }
                {
                    // 反向链接（原版 editor.js:3271-3284）：引用本篇
                    // 标题的备忘现算列表，非空才渲染；条目点击直接
                    // 导航（来源必存在，不新建）。切篇前先落盘。
                    let backlinks = crate::wiki::compute_backlinks(&data.read().memos, &memo_id, &title.read());
                    if backlinks.is_empty() {
                        rsx! {}
                    } else {
                        let bl_aria = crate::i18n::t("editor.backlinks_aria");
                        let bl_title = crate::i18n::t("editor.backlinks");
                        rsx! {
                            section { class: "wiki-backlinks", "aria-label": "{bl_aria}",
                                h2 { class: "wiki-backlinks-title", "{bl_title}" }
                                div { class: "wiki-backlinks-list",
                                    for (sid, stitle) in backlinks.iter() {
                                        {
                                            let stitle = stitle.clone();
                                            let persist_b = persist.clone();
                                            let label = if stitle.trim().is_empty() { crate::i18n::t("editor.untitled") } else { stitle.clone() };
                                            rsx! {
                                                button {
                                                    key: "{sid}",
                                                    r#type: "button",
                                                    class: "wiki-backlink",
                                                    onclick: move |_| {
                                                        persist_b.call(doc.read().clone(), title.read().clone(), data);
                                                        diag::log("WIKI", &format!("backlink -> '{stitle}'"));
                                                        on_open_wiki.call(stitle.clone());
                                                    },
                                                    "{label}"
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            input {
                id: "file-attach",
                r#type: "file",
                accept: "image/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                multiple: true,
                class: "hidden-input",
                onchange: move |_| {
                    menu_open.set(false);
                    show_export.set(false);
                    let persist = persist_attach.clone();
                    spawn(async move {
                        attach_file(doc, title, data, manifest, &persist, ed_status).await;
                    });
                },
            }
            input {
                id: "file-media",
                r#type: "file",
                accept: "image/*",
                multiple: true,
                class: "hidden-input",
                onchange: on_media_files,
            }
            if let Some(u) = lightbox.read().clone() {
                div {
                    class: "lightbox",
                    onclick: move |_| lightbox.set(None),
                    img { src: "{u}" }
                }
            }
            if let Some((bid, _txt)) = sheet_state {
                div {
                    class: "image-text-sheet-backdrop",
                    onclick: {
                        let persist = persist.clone();
                        let bid_bg = bid.clone();
                        move |_| {
                            if *sheet_edit.read() {
                                save_sheet_text(doc, title, data, &persist, &bid_bg, &sheet_draft.read().clone());
                            }
                            text_sheet.set(None);
                        }
                    },
                }
                div { class: "image-text-sheet-wrap",
                    section { class: "image-text-sheet",
                        div { class: "image-text-sheet-header",
                            h2 { "{crate::i18n::t(\"sheet.full_text\")}" }
                        }
                        if sheet_editing {
                            textarea {
                                class: "image-text-sheet-editor",
                                value: "{sheet_draft}",
                                oninput: move |e| sheet_draft.set(e.value()),
                            }
                        } else {
                            div { class: "image-text-sheet-content",
                                if sheet_draft.read().trim().is_empty() {
                                    "{crate::i18n::t(\"sheet.empty\")}"
                                } else {
                                    "{sheet_draft}"
                                }
                            }
                        }
                        div { class: "image-text-sheet-footer",
                            button {
                                class: "image-text-sheet-action",
                                onclick: {
                                    let persist = persist.clone();
                                    move |_| {
                                        if *sheet_edit.read() {
                                            save_sheet_text(doc, title, data, &persist, &bid, &sheet_draft.read().clone());
                                            text_sheet.set(None);
                                        } else {
                                            sheet_edit.set(true);
                                        }
                                    }
                                },
                                if sheet_editing {
                                    "{crate::i18n::t(\"sheet.done\")}"
                                } else {
                                    "{crate::i18n::t(\"sheet.edit\")}"
                                }
                            }
                        }
                    }
                }
            }
            if let Some((bid, filter, ax, atop, abottom)) = panel_state {
                SlashPanel { bid, filter, anchor_x: ax, anchor_top: atop, anchor_bottom: abottom, panel, slash_click, link_for, link_click }
            } else if let Some(bid) = link_state {
                SlashPanel { bid, filter: String::new(), anchor_x: link_x, anchor_top: link_top, anchor_bottom: link_bottom, panel, slash_click, link_for, link_click }
            }
        }
    }
}

type PersistFn = dyn Fn(Vec<Node>, String, Signal<BackupFile>) + 'static;

/// 持久化句柄：包一层以满足 Dioxus 组件 props 的 PartialEq 要求。
#[derive(Clone)]
struct PersistHandle(std::rc::Rc<PersistFn>);

impl PartialEq for PersistHandle {
    fn eq(&self, other: &Self) -> bool {
        std::rc::Rc::ptr_eq(&self.0, &other.0)
    }
}

impl PersistHandle {
    fn call(&self, doc: Vec<Node>, title: String, data: Signal<BackupFile>) {
        (self.0)(doc, title, data)
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_bridge_msg(
    msg: &str,
    mut doc: Signal<Vec<Node>>,
    title: Signal<String>,
    data: Signal<BackupFile>,
    mut panel: Signal<Option<(String, String, f64, f64, f64)>>,
    mut link_for: Signal<Option<String>>,
    mut link_pos: Signal<(f64, f64, f64)>,
    mut focus_req: Signal<Option<(String, usize)>>,
    mut dom_set: Signal<Option<(String, String, usize)>>,
    mut md_edit: Signal<Option<String>>,
    mut sel_block: Signal<Option<String>>,
    mut manifest: Signal<String>,
    persist: &PersistHandle,
) {
    let Ok(v) = serde_json::from_str::<Value>(msg) else {
        diag::log("EDIT", &format!("bad bridge msg: {}", &msg[..msg.len().min(80)]));
        return;
    };
    let op = v.get("op").and_then(|x| x.as_str()).unwrap_or("");
    let bid = v.get("id").and_then(|x| x.as_str()).unwrap_or("");
    match op {
        "titleText" => {
            let text = v.get("text").and_then(|x| x.as_str()).unwrap_or("");
            let mut title = title;
            title.set(text.to_string());
        }
        "selectBlock" => {
            sel_block.set(Some(bid.to_string()));
        }
        "clearSelect" => {
            if sel_block.read().is_some() {
                sel_block.set(None);
            }
        }
        "deleteSelected" => {
            let target = sel_block.read().clone();
            if let Some(tid) = target {
                sel_block.set(None);
                let mut d = doc.read().clone();
                if let Some(Loc::Top(i)) = find_loc(&d, &tid) {
                    d.remove(i);
                    doc.set(d.clone());
                    persist.call(d, title.read().clone(), data);
                    diag::log("EDIT", &format!("delete selected block {tid}"));
                }
            }
        }
        "insertPara" => {
            // 原版原子块边缘点击（use-editor-dom.js）：左 28px 在
            // 块前插空段并聚焦；右 28px 聚焦下一个可编辑兄弟，
            // 没有才在块后插空段。
            let where_ = v.get("where").and_then(|x| x.as_str()).unwrap_or("before");
            let mut d = doc.read().clone();
            if let Some(Loc::Top(i)) = find_loc(&d, bid) {
                sel_block.set(None);
                if where_ == "after" {
                    let next_ed = ((i + 1)..d.len()).find(|&j| {
                        matches!(
                            d[j].block_type().unwrap_or(""),
                            "paragraph" | "heading" | "quote" | "todo"
                        )
                    });
                    if let Some(j) = next_ed {
                        let nid = d[j].id.clone().unwrap_or_default();
                        focus_req.set(Some((nid, 0)));
                    } else {
                        let para = new_block("paragraph");
                        let pid = para.id.clone().unwrap_or_default();
                        d.insert(i + 1, para);
                        doc.set(d.clone());
                        persist.call(d, title.read().clone(), data);
                        focus_req.set(Some((pid, 0)));
                        diag::log("EDIT", &format!("insert para after {bid}"));
                    }
                } else {
                    let para = new_block("paragraph");
                    let pid = para.id.clone().unwrap_or_default();
                    d.insert(i, para);
                    doc.set(d.clone());
                    persist.call(d, title.read().clone(), data);
                    focus_req.set(Some((pid, 0)));
                    diag::log("EDIT", &format!("insert para before {bid}"));
                }
            }
        }
        "split" => {
            let before = v.get("before").and_then(|x| x.as_str()).unwrap_or("");
            let after = v.get("after").and_then(|x| x.as_str()).unwrap_or("");
            op_split(&mut doc, bid, before, after, &mut focus_req);
            persist.call(doc.read().clone(), title.read().clone(), data);
        }
        "merge" => {
            let html = v.get("html").and_then(|x| x.as_str()).unwrap_or("");
            op_merge(&mut doc, bid, html, &mut focus_req);
            persist.call(doc.read().clone(), title.read().clone(), data);
        }
        "slash" => {
            let filter = v.get("filter").and_then(|x| x.as_str()).unwrap_or("");
            let x = v.get("x").and_then(|x| x.as_f64()).unwrap_or(20.0);
            let top = v.get("y").and_then(|x| x.as_f64()).unwrap_or(160.0);
            let bottom = v.get("b").and_then(|x| x.as_f64()).unwrap_or(200.0);
            panel.set(Some((bid.to_string(), filter.to_string(), x, top, bottom)));
        }
        "slashLink" => {
            // 链接命令：面板切换为链接表单（斜杠字符留在块里，
            // 插入时由 __mnApplyLink 前的 __mnStripSlash 清掉）
            if let Some((_, _, x, top, bottom)) = panel.read().clone() {
                link_pos.set((x, top, bottom));
            }
            panel.set(None);
            link_for.set(Some(bid.to_string()));
        }
        "slashClose" => panel.set(None),
        "slashApply" => {
            let act = v.get("act").and_then(|x| x.as_str()).unwrap_or("");
            let html = v.get("html").and_then(|x| x.as_str()).unwrap_or("");
            panel.set(None);
            if let Some(src) = op_convert(&mut doc, bid, act, html, &mut focus_req, &mut md_edit) {
                let esc = src
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
                    .replace('\n', "<br>");
                let len = src.chars().count();
                dom_set.set(Some((bid.to_string(), esc, len)));
            }
            persist.call(doc.read().clone(), title.read().clone(), data);
        }
        "mdText" => {
            // md 源编辑：整块文本就是源码，单文本节点落模型
            let text = v.get("text").and_then(|x| x.as_str()).unwrap_or("");
            let text = text.trim_end_matches('\n').to_string();
            let mut d = doc.read().clone();
            if let Some(loc) = find_loc(&d, bid) {
                let n = node_at_mut(&mut d, loc);
                n.children = Some(vec![text_node(&text)]);
                doc.set(d);
            }
        }
        "mdDone" => {
            if md_edit.read().as_deref() == Some(bid) {
                md_edit.set(None);
                persist.call(doc.read().clone(), title.read().clone(), data);
                diag::log("EDIT", &format!("md source done {bid}"));
            }
        }
        "pasteSync" => {
            // 富文本粘贴已由 JS 插入 DOM，这里只对齐模型
            let html = v.get("html").and_then(|x| x.as_str()).unwrap_or("");
            let mut d = doc.read().clone();
            if let Some(loc) = find_loc(&d, bid) {
                node_at_mut(&mut d, loc).children = Some(html_to_inlines(html));
                doc.set(d);
                diag::log("EDIT", &format!("paste html synced {bid}"));
                if html.contains("<mark") {
                    diag::log("EDIT", &format!("highlight mark synced {bid}"));
                }
            } else {
                diag::log("EDIT", &format!("pasteSync: block not found {bid}"));
            }
            persist.call(doc.read().clone(), title.read().clone(), data);
        }
        "pasteText" => {
            let before = v.get("before").and_then(|x| x.as_str()).unwrap_or("");
            let after = v.get("after").and_then(|x| x.as_str()).unwrap_or("");
            let lines: Vec<String> = v
                .get("lines")
                .and_then(|x| x.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            op_paste_text(&mut doc, bid, before, after, &lines, &mut focus_req, &mut dom_set);
            persist.call(doc.read().clone(), title.read().clone(), data);
        }
        "pasteCard" => {
            let url = v.get("url").and_then(|x| x.as_str()).unwrap_or("");
            let remain = v.get("remain").and_then(|x| x.as_str()).unwrap_or("");
            let before = v.get("before").and_then(|x| x.as_str()).unwrap_or("");
            let after = v.get("after").and_then(|x| x.as_str()).unwrap_or("");
            if let Some(card_id) =
                op_paste_card(&mut doc, bid, url, remain, before, after, &mut focus_req)
            {
                persist.call(doc.read().clone(), title.read().clone(), data);
                spawn_resolve_card(doc, card_id, url.to_string(), title, data, persist.clone());
                diag::log("EDIT", &format!("pasteCard {url} remain={}", remain.len()));
            }
        }
        "pasteImage" => {
            let name = v
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("image.png")
                .to_string();
            let mime = v
                .get("mime")
                .and_then(|x| x.as_str())
                .unwrap_or("image/png")
                .to_string();
            let b64 = v.get("b64").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let bid_owned = bid.to_string();
            let persist2 = persist.clone();
            spawn(async move {
                let bytes = b64_decode(&b64);
                if bytes.is_empty() {
                    diag::log("EDIT", "pasteImage: empty bytes");
                    return;
                }
                let fid = gen_id();
                if idb::put_attachment(&fid, &bytes).await.is_err() {
                    diag::log("EDIT", "pasteImage: idb put failed");
                    return;
                }
                let mut man: Value = serde_json::from_str(&manifest.read())
                    .unwrap_or_else(|_| json!({"version": 1}));
                if !man.get("attachments").map(|a| a.is_object()).unwrap_or(false) {
                    man["attachments"] = json!({});
                }
                man["attachments"][&fid] = json!({"name": name, "type": mime});
                let man_str = man.to_string();
                manifest.set(man_str.clone());
                let _ = idb::save_manifest(&man_str).await;
                let mut d = doc.read().clone();
                if let Some(loc) = find_loc(&d, &bid_owned) {
                    let top = match loc {
                        Loc::Top(i) => i,
                        Loc::Item(li, _) => li,
                    };
                    let mut extra = Map::new();
                    extra.insert("attrs".to_string(), json!({"fileId": fid}));
                    let node = Node {
                        text: None,
                        node_type: Some("image".to_string()),
                        id: Some(gen_id()),
                        children: Some(vec![]),
                        extra,
                    };
                    d.insert(top + 1, node);
                    doc.set(d.clone());
                    persist2.call(d, title.read().clone(), data);
                    diag::log("EDIT", &format!("pasteImage {fid} {}B", bytes.len()));
                }
            });
        }
        "sync" => {
            // 自动同步：只更新持久副本，不动正在编辑的 doc 信号
            if let Some(map) = v.get("map") {
                let map_str = map.to_string();
                let mut shadow = doc.read().clone();
                let before_json = serde_json::to_string(&shadow).unwrap_or_default();
                apply_sync_map(&mut shadow, &map_str);
                if serde_json::to_string(&shadow).unwrap_or_default() != before_json {
                    persist.call(shadow, title.read().clone(), data);
                    diag::log_once("autosync", "EDIT", "autosync applied");
                }
            }
        }
        _ => diag::log("EDIT", &format!("unknown op: {op}")),
    }
}

/// 把 {bid: innerHTML} 同步进文档的文本块（行内重解析）。
fn apply_sync_map(doc: &mut Vec<Node>, map_json: &str) {
    let Ok(map) = serde_json::from_str::<Map<String, Value>>(map_json) else {
        return;
    };
    fn apply(nodes: &mut [Node], map: &Map<String, Value>) {
        for n in nodes.iter_mut() {
            let ty = n.block_type().unwrap_or("").to_string();
            if is_text_block(&ty) {
                if let Some(bid) = &n.id {
                    if let Some(html) = map.get(bid).and_then(|v| v.as_str()) {
                        n.children = Some(html_to_inlines(html));
                    }
                }
            }
            if ty == "bulleted-list" || ty == "numbered-list" {
                if let Some(kids) = &mut n.children {
                    apply(kids, map);
                }
            }
        }
    }
    apply(doc, &map);
}

fn op_split(
    doc: &mut Signal<Vec<Node>>,
    bid: &str,
    before_html: &str,
    after_html: &str,
    focus_req: &mut Signal<Option<(String, usize)>>,
) {
    let mut d = doc.read().clone();
    let Some(loc) = find_loc(&d, bid) else {
        diag::log("EDIT", &format!("split: block not found {bid}"));
        return;
    };
    let cur = node_at(&d, loc).clone();
    let ty = cur.block_type().unwrap_or("paragraph").to_string();
    let before_inlines = html_to_inlines(before_html);
    let after_inlines = html_to_inlines(after_html);
    let before_text: String = before_inlines.iter().map(|n| n.plain_text()).collect();
    let after_text: String = after_inlines.iter().map(|n| n.plain_text()).collect();

    // 空列表项回车 = 退出列表（该项变段落，后续项另起一表）
    if let Loc::Item(li, ii) = loc {
        if before_text.is_empty() && after_text.is_empty() {
            let list = d[li].clone();
            let items = list.children.clone().unwrap_or_default();
            let tail: Vec<Node> = items.iter().skip(ii + 1).cloned().collect();
            let para = new_block("paragraph");
            let para_id = para.id.clone().unwrap_or_default();
            let insert_at = if ii > 0 {
                d[li].children = Some(items[..ii].to_vec());
                li + 1
            } else {
                d.remove(li);
                li
            };
            d.insert(insert_at, para);
            if !tail.is_empty() {
                let mut nl = list.clone();
                nl.id = Some(gen_id());
                nl.children = Some(tail);
                d.insert(insert_at + 1, nl);
            }
            doc.set(d);
            focus_req.set(Some((para_id, 0)));
            diag::log("EDIT", &format!("split-exit-list {bid}"));
            return;
        }
    }

    // 空样式块回车 = 退出样式（标题/引用/标注/待办）
    if before_text.is_empty()
        && after_text.is_empty()
        && matches!(ty.as_str(), "heading" | "quote" | "callout" | "todo")
    {
        let n = node_at_mut(&mut d, loc);
        n.node_type = Some("paragraph".into());
        clear_type_fields(n);
        doc.set(d);
        focus_req.set(Some((bid.to_string(), 0)));
        diag::log("EDIT", &format!("split-exit-style {bid}"));
        return;
    }

    let new_ty = match ty.as_str() {
        "heading" | "quote" | "callout" => "paragraph",
        "todo" => "todo",
        "list-item" => "list-item",
        _ => "paragraph",
    };
    let mut new_block = new_block(new_ty);
    if new_ty == "todo" {
        set_attr(&mut new_block, "checked", json!(false));
    }
    new_block.children = Some(after_inlines);
    let new_id = new_block.id.clone().unwrap_or_default();

    {
        let n = node_at_mut(&mut d, loc);
        n.children = Some(before_inlines);
    }
    match loc {
        Loc::Top(i) => d.insert(i + 1, new_block),
        Loc::Item(li, ii) => {
            d[li].children.as_mut().unwrap().insert(ii + 1, new_block);
        }
    }
    doc.set(d);
    focus_req.set(Some((new_id, 0)));
}

fn op_merge(
    doc: &mut Signal<Vec<Node>>,
    bid: &str,
    html: &str,
    focus_req: &mut Signal<Option<(String, usize)>>,
) {
    let mut d = doc.read().clone();
    let Some(loc) = find_loc(&d, bid) else {
        diag::log("EDIT", &format!("merge: block not found {bid}"));
        return;
    };
    let Some(prev_loc) = prev_editable(&d, loc) else {
        return; // 已是第一个可编辑块，无处合并
    };
    let junction = plain_len(node_at(&d, prev_loc));
    let prev_id = node_at(&d, prev_loc).id.clone().unwrap_or_default();
    let cur_inlines = html_to_inlines(html);
    {
        let prev = node_at_mut(&mut d, prev_loc);
        let mut kids = prev.children.clone().unwrap_or_default();
        kids.extend(cur_inlines);
        prev.children = Some(kids);
    }
    match loc {
        Loc::Top(i) => {
            d.remove(i);
        }
        Loc::Item(li, ii) => {
            d[li].children.as_mut().unwrap().remove(ii);
            if d[li].children.as_ref().map(|c| c.is_empty()).unwrap_or(false) {
                d.remove(li);
            }
        }
    }
    doc.set(d);
    focus_req.set(Some((prev_id, junction)));
}

fn text_node(s: &str) -> Node {
    Node {
        text: Some(s.to_string()),
        node_type: None,
        id: None,
        children: None,
        extra: Map::new(),
    }
}

fn inlines_len(nodes: &[Node]) -> usize {
    nodes.iter().map(|n| n.plain_text().chars().count()).sum()
}

/// 纯文本多行粘贴：首行并入当前块，中间行成新块，末行带上
/// 光标后的原内容。当前块的 DOM 由 dom_set 回写对齐。
/// 双栏分界（原版 normalizeColumnLayout 的等价归一化）：
/// layout.right 中第一个仍存在的块即右栏起点；只有 left
/// 时按 left 计数；无 layout 时按文本量均衡分半。
fn column_boundary(doc: &[Node], layout: Option<&Value>) -> usize {
    let ids: Vec<String> = doc
        .iter()
        .map(|n| n.id.as_ref().map(|i| i.to_string()).unwrap_or_default())
        .collect();
    if let Some(l) = layout {
        if let Some(right) = l.get("right").and_then(|v| v.as_array()) {
            for rid in right.iter().filter_map(|x| x.as_str()) {
                if let Some(pos) = ids.iter().position(|i| i == rid) {
                    return pos;
                }
            }
        }
        if let Some(left) = l.get("left").and_then(|v| v.as_array()) {
            let cnt = left
                .iter()
                .filter_map(|x| x.as_str())
                .filter(|lid| ids.iter().any(|i| i == lid))
                .count();
            if cnt > 0 {
                return cnt.min(doc.len());
            }
        }
    }
    let weights: Vec<usize> = doc
        .iter()
        .map(|n| n.plain_text().chars().count().max(12))
        .collect();
    let total: usize = weights.iter().sum();
    let mut acc = 0usize;
    for (i, w) in weights.iter().enumerate() {
        acc += w;
        if acc * 2 >= total {
            return (i + 1).min(doc.len());
        }
    }
    doc.len()
}

/// 粘贴 URL 生成卡片（原版 insertLinkCardAtDOM 口径）：当前
/// 块按光标拆分（前段留原块、后段成新段落），卡片插中间；
/// 音乐域名 → musicCard，其余 → link-card，均先 loading
/// 再由 spawn_resolve_card 回填 meta。remain 非空时在卡后
/// 另起一段（原版「剩余文本保留为卡后段落」）并聚焦它。
fn op_paste_card(
    doc: &mut Signal<Vec<Node>>,
    bid: &str,
    url: &str,
    remain: &str,
    before_html: &str,
    after_html: &str,
    focus_req: &mut Signal<Option<(String, usize)>>,
) -> Option<String> {
    const MUSIC_HOSTS: [&str; 6] = [
        "music.163.com",
        "163cn.tv",
        "y.qq.com",
        "i.y.qq.com",
        "open.spotify.com",
        "music.apple.com",
    ];
    let is_music = MUSIC_HOSTS.iter().any(|h| url.contains(h));
    let mut d = doc.read().clone();
    let loc = find_loc(&d, bid)?;
    let before = html_to_inlines(before_html);
    let after = html_to_inlines(after_html);
    node_at_mut(&mut d, loc).children = Some(before);
    let top_idx = match loc {
        Loc::Top(i) => i,
        Loc::Item(li, _) => li,
    };
    let mut card = new_block(if is_music { "musicCard" } else { "link-card" });
    card.extra.insert("url".to_string(), json!(url));
    card.extra.insert("status".to_string(), json!("loading"));
    let card_id = card.id.clone().unwrap_or_default();
    let mut at = top_idx + 1;
    d.insert(at, card);
    at += 1;
    let mut focus: Option<(String, usize)> = None;
    if !remain.trim().is_empty() {
        let mut pnode = new_block("paragraph");
        pnode.children = Some(vec![text_node(remain.trim())]);
        let pid = pnode.id.clone().unwrap_or_default();
        d.insert(at, pnode);
        at += 1;
        focus = Some((pid, usize::MAX));
    }
    let after_text: String = after.iter().map(|n| n.plain_text()).collect();
    if !after_text.is_empty() {
        let mut pnode = new_block("paragraph");
        pnode.children = Some(after);
        let pid = pnode.id.clone().unwrap_or_default();
        d.insert(at, pnode);
        if focus.is_none() {
            focus = Some((pid, 0));
        }
    }
    doc.set(d);
    if let Some(f) = focus {
        focus_req.set(Some(f));
    }
    Some(card_id)
}

/// 极小 base64 解码（粘贴图片字节通路；无第三方依赖）。
fn b64_decode(s: &str) -> Vec<u8> {
    let mut table = [255u8; 256];
    for (i, c) in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        .iter()
        .enumerate()
    {
        table[*c as usize] = i as u8;
    }
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut nbits = 0u32;
    for &b in s.as_bytes() {
        if b == b'=' {
            break;
        }
        let v = table[b as usize];
        if v == 255 {
            continue;
        }
        acc = (acc << 6) | v as u32;
        nbits += 6;
        if nbits >= 8 {
            nbits -= 8;
            out.push((acc >> nbits) as u8);
        }
    }
    out
}

fn op_paste_text(
    doc: &mut Signal<Vec<Node>>,
    bid: &str,
    before_html: &str,
    after_html: &str,
    lines: &[String],
    focus_req: &mut Signal<Option<(String, usize)>>,
    dom_set: &mut Signal<Option<(String, String, usize)>>,
) {
    if lines.len() < 2 {
        return;
    }
    let mut d = doc.read().clone();
    let Some(loc) = find_loc(&d, bid) else {
        diag::log("EDIT", &format!("pasteText: block not found {bid}"));
        return;
    };
    let before = html_to_inlines(before_html);
    let after = html_to_inlines(after_html);
    let mut first_kids = before;
    first_kids.push(text_node(&lines[0]));
    let first_html = inlines_to_html(&first_kids);
    let first_len = inlines_len(&first_kids);
    node_at_mut(&mut d, loc).children = Some(first_kids);

    let last_idx = lines.len() - 1;
    let mut new_blocks: Vec<Node> = Vec::new();
    for (k, line) in lines.iter().enumerate().skip(1) {
        let mut kids = vec![text_node(line)];
        if k == last_idx {
            kids.extend(after.clone());
        }
        let mut b = match loc {
            Loc::Top(_) => new_block("paragraph"),
            Loc::Item(..) => new_block("list-item"),
        };
        b.children = Some(kids);
        new_blocks.push(b);
    }
    let last_id = new_blocks
        .last()
        .and_then(|b| b.id.clone())
        .unwrap_or_default();
    let last_len = lines[last_idx].chars().count();
    match loc {
        Loc::Top(i) => {
            for (k, b) in new_blocks.into_iter().enumerate() {
                d.insert(i + 1 + k, b);
            }
        }
        Loc::Item(li, ii) => {
            for (k, b) in new_blocks.into_iter().enumerate() {
                d[li].children.as_mut().unwrap().insert(ii + 1 + k, b);
            }
        }
    }
    doc.set(d);
    dom_set.set(Some((bid.to_string(), first_html, first_len)));
    focus_req.set(Some((last_id, last_len)));
    diag::log("EDIT", &format!("paste text {} lines into {bid}", lines.len()));
}

/// attrs 字段读写（原版节点工厂把 level/checked/fileId 放 attrs）。
fn set_attr(n: &mut Node, key: &str, val: Value) {
    let mut attrs = n
        .extra
        .get("attrs")
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    attrs.insert(key.to_string(), val);
    n.extra.insert("attrs".into(), Value::Object(attrs));
}

fn del_attr(n: &mut Node, key: &str) {
    if let Some(attrs) = n
        .extra
        .get_mut("attrs")
        .and_then(|v| v.as_object_mut())
    {
        attrs.remove(key);
    }
}

/// 清掉标题/待办的类型字段（顶层旧形 + attrs 正形都清）。
fn clear_type_fields(n: &mut Node) {
    n.extra.remove("level");
    n.extra.remove("checked");
    del_attr(n, "level");
    del_attr(n, "checked");
}

/// md 源段落 → 纯文本（去围栏/引用/列表前缀），转换出口径。
fn strip_md_prefixes(text: &str) -> String {
    match crate::blocks::md_classify(text) {
        Some(crate::blocks::MdKind::Code(code)) => code,
        Some(crate::blocks::MdKind::Callout { body, .. }) => body.join("\n"),
        Some(crate::blocks::MdKind::List { items, .. }) => items.join("\n"),
        Some(crate::blocks::MdKind::Rich(src)) => src,
        Some(crate::blocks::MdKind::Heading { text, .. }) => text,
        Some(crate::blocks::MdKind::Quote(paras)) => paras.join("\n"),
        Some(crate::blocks::MdKind::Table { .. }) => text.to_string(),
        Some(crate::blocks::MdKind::Divider) => text.to_string(),
        None => text.to_string(),
    }
}

fn apply_type(n: &mut Node, act: &str) {
    match act {
        "heading1" | "heading2" | "heading3" => {
            n.node_type = Some("heading".into());
            let lv: u64 = act[7..].parse().unwrap_or(2);
            clear_type_fields(n);
            set_attr(n, "level", json!(lv));
        }
        "todo" => {
            n.node_type = Some("todo".into());
            clear_type_fields(n);
            set_attr(n, "checked", json!(false));
        }
        "quote" => {
            n.node_type = Some("quote".into());
            clear_type_fields(n);
        }
        "imgTextCard" => {
            n.node_type = Some("imgTextCard".into());
            clear_type_fields(n);
        }
        "imageTextRow" => {
            n.node_type = Some("imageTextRow".into());
            clear_type_fields(n);
        }
        "musicCard" => {
            n.node_type = Some("musicCard".into());
            clear_type_fields(n);
            n.extra.entry("url".to_string()).or_insert_with(|| json!(""));
            // 原版新建音乐卡 = input 态（粘贴链接胶囊）
            n.extra
                .entry("status".to_string())
                .or_insert_with(|| json!("input"));
        }
        _ => {
            n.node_type = Some("paragraph".into());
            clear_type_fields(n);
        }
    }
}

fn op_convert(
    doc: &mut Signal<Vec<Node>>,
    bid: &str,
    act: &str,
    html: &str,
    focus_req: &mut Signal<Option<(String, usize)>>,
    md_edit: &mut Signal<Option<String>>,
) -> Option<String> {
    let mut d = doc.read().clone();
    let Some(loc) = find_loc(&d, bid) else {
        diag::log("EDIT", &format!("convert: block not found {bid}"));
        return None;
    };
    let inlines = html_to_inlines(html);

    // 列表项：列表类型互换只改父列表；其余转换把该项提出列表
    if let Loc::Item(li, ii) = loc {
        if act == "bulletList" || act == "numberList" {
            d[li].node_type = Some(
                if act == "bulletList" {
                    "bulleted-list"
                } else {
                    "numbered-list"
                }
                .to_string(),
            );
            let len = plain_len(node_at(&d, loc));
            doc.set(d);
            focus_req.set(Some((bid.to_string(), len)));
            diag::log("EDIT", &format!("convert list type -> {act}"));
            return None;
        }
        let list = d[li].clone();
        let items = list.children.clone().unwrap_or_default();
        let mut converted = items[ii].clone();
        converted.children = Some(inlines);
        let head: Vec<Node> = items[..ii].to_vec();
        let tail: Vec<Node> = items[ii + 1..].to_vec();
        let mut replacement: Vec<Node> = Vec::new();
        if !head.is_empty() {
            let mut hl = list.clone();
            hl.children = Some(head);
            replacement.push(hl);
        }
        let mut focus = (bid.to_string(), 0usize);
        if act == "divider" {
            let mut div = new_block("divider");
            div.id = Some(bid.to_string());
            div.children = None;
            replacement.push(div);
            let para = new_block("paragraph");
            focus = (para.id.clone().unwrap_or_default(), 0);
            replacement.push(para);
        } else {
            apply_type(&mut converted, act);
            focus = (bid.to_string(), plain_len(&converted));
            replacement.push(converted);
        }
        if !tail.is_empty() {
            let mut tl = list.clone();
            tl.id = Some(gen_id());
            tl.children = Some(tail);
            replacement.push(tl);
        }
        d.remove(li);
        for (k, b) in replacement.into_iter().enumerate() {
            d.insert(li + k, b);
        }
        doc.set(d);
        focus_req.set(Some(focus));
        diag::log("EDIT", &format!("convert lift {bid} -> {act}"));
        return None;
    }

    let Loc::Top(i) = loc else { return None };

    // 代码/列表/Callout：原版模型是 md 源段落（use-slash.js 实证），
    // 不造 codeBlock/bulleted-list/callout 类型。转后直接进源码
    // 编辑态（原版转换后光标落在源码段落里）。
    if matches!(act, "bulletList" | "numberList" | "codeBlock" | "callout") {
        let cur_text: String = inlines.iter().map(|n| n.plain_text()).collect();
        let plain = strip_md_prefixes(&cur_text);
        let plain = if plain.trim().is_empty() {
            match act {
                "bulletList" | "numberList" => "列表项".to_string(),
                "callout" => "提示内容".to_string(),
                _ => String::new(),
            }
        } else {
            plain
        };
        let src = match act {
            "bulletList" => plain
                .lines()
                .map(|l| format!("- {l}"))
                .collect::<Vec<_>>()
                .join("\n"),
            "numberList" => plain
                .lines()
                .enumerate()
                .map(|(k, l)| format!("{}. {l}", k + 1))
                .collect::<Vec<_>>()
                .join("\n"),
            "codeBlock" => format!("```\n{plain}\n```"),
            _ => {
                let body = plain
                    .lines()
                    .map(|l| format!("> {l}"))
                    .collect::<Vec<_>>()
                    .join("\n");
                format!("> [!NOTE]\n{body}")
            }
        };
        let n = node_at_mut(&mut d, loc);
        n.node_type = Some("paragraph".into());
        clear_type_fields(n);
        n.children = Some(vec![text_node(&src)]);
        doc.set(d);
        md_edit.set(Some(bid.to_string()));
        diag::log("EDIT", &format!("convert {bid} -> md source ({act})"));
        return Some(src);
    }

    if act == "divider" {
        let mut divider = new_block("divider");
        divider.id = Some(bid.to_string());
        divider.children = None;
        let para = new_block("paragraph");
        let para_id = para.id.clone().unwrap_or_default();
        d[i] = divider;
        d.insert(i + 1, para);
        doc.set(d);
        focus_req.set(Some((para_id, 0)));
        diag::log("EDIT", &format!("convert {bid} -> divider"));
        return None;
    }

    let n = node_at_mut(&mut d, loc);
    n.children = Some(inlines);
    apply_type(n, act);
    let len = plain_len(node_at(&d, loc));
    doc.set(d);
    focus_req.set(Some((bid.to_string(), len)));
    diag::log("EDIT", &format!("convert {bid} -> {act}"));
    None
}

/// 块删除按钮（原子块共用）：删顶层块并落库。
#[component]
fn BlockDelBtn(
    bid: String,
    doc: Signal<Vec<Node>>,
    title: Signal<String>,
    data: Signal<BackupFile>,
    persist: PersistHandle,
) -> Element {
    let sel_ctx = try_use_context::<crate::blocks::SelBlock>();
    rsx! {
        button {
            class: "blk-del",
            onclick: move |_| {
                let mut doc = doc;
                let mut d = doc.read().clone();
                if let Some(Loc::Top(i)) = find_loc(&d, &bid) {
                    d.remove(i);
                    doc.set(d.clone());
                    persist.call(d, title.read().clone(), data);
                    diag::log("EDIT", &format!("delete block {bid}"));
                }
                if let Some(c) = sel_ctx {
                    let mut s = c.0;
                    if s.read().as_deref() == Some(bid.as_str()) {
                        s.set(None);
                    }
                }
            },
            "{crate::i18n::t(\"editor.delete_block\")}"
        }
    }
}

/// 图文块换图按钮：登记 SetImage 请求并唤起文件选择。
#[component]
fn BlockImgBtn(bid: String, mut media_req: Signal<Option<MediaReq>>) -> Element {
    rsx! {
        button {
            class: "blk-del",
            style: "right:86px",
            onclick: move |_| {
                media_req.set(Some(MediaReq::SetImage { bid: bid.clone() }));
                spawn(async move {
                    let mut eval = document::eval(
                        "const i = document.getElementById('file-media'); if (i) i.click(); dioxus.send(null);",
                    );
                    let _ = eval.recv::<Value>().await;
                });
            },
            "{crate::i18n::t(\"editor.change_image\")}"
        }
    }
}

#[component]
fn EditorBlock(
    node: Node,
    gen: Signal<u32>,
    doc: Signal<Vec<Node>>,
    title: Signal<String>,
    data: Signal<BackupFile>,
    persist: PersistHandle,
    media_req: Signal<Option<MediaReq>>,
) -> Element {
    let ty = node.block_type().unwrap_or("").to_string();
    // 上下文钩子必须无条件、同序地在组件顶部调用：块类型转换会让
    // 同一实例在 match 分支间切换，分支内调用 try_use_context 会让
    // 钩子槽位类型错位（MdEdit 槽被 SelBlock 读）直接 panic——斜杠
    // 转分割线时实测崩溃。分支内只许用这里算好的 editing / sel。
    let md_ctx = try_use_context::<crate::blocks::MdEdit>();
    let sel_ctx = try_use_context::<crate::blocks::SelBlock>();
    let bid0 = node.id.clone().unwrap_or_default();
    let editing = md_ctx
        .as_ref()
        .map(|c| c.0.read().as_deref() == Some(bid0.as_str()))
        .unwrap_or(false);
    let sel = sel_ctx
        .as_ref()
        .map(|c| c.0.read().as_deref() == Some(bid0.as_str()))
        .unwrap_or(false);
    match ty.as_str() {
        "paragraph" => {
            // md 源段落：预览态（点回源码编辑）/ 源码编辑态。
            // 编辑态优先于分类结果：源码打字中间态（如只打了「-」）
            // 暂时不构成合法 md，若按分类切换分支会把编辑区重挂载
            // 成普通段落、丢掉 mdsrc 语义——原版源码段落编辑期间
            // 始终是普通 <p>，同理编辑态必须稳定不 flicker。
            let plain = node.plain_text();
            let bid = node.id.clone().unwrap_or_default();
            if editing || crate::blocks::md_classify(&plain).is_some() {
                if editing {
                    let esc = plain
                        .replace('&', "&amp;")
                        .replace('<', "&lt;")
                        .replace('>', "&gt;")
                        .replace('\n', "<br>");
                    rsx! {
                        EditableDiv {
                            node,
                            cls: "blk-p ed-line".to_string(),
                            force_btype: "mdsrc".to_string(),
                            initial_html: esc,
                        }
                    }
                } else {
                    let ctx = md_ctx;
                    rsx! {
                        div {
                            class: "md-hit",
                            onclick: move |_| {
                                if let Some(c) = ctx {
                                    let mut s = c.0;
                                    s.set(Some(bid.clone()));
                                    diag::log("EDIT", &format!("md preview -> source edit {bid}"));
                                    // 挂载后聚焦源码区、光标落末尾（原版同行为）
                                    let bid2 = bid.clone();
                                    spawn(async move {
                                        let js = format!(
                                            "setTimeout(() => {{ const el = document.querySelector('[data-bid={}]'); if (el) {{ el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }} }}, 60); dioxus.send(null);",
                                            serde_json::to_string(&bid2).unwrap_or_default()
                                        );
                                        let mut eval = document::eval(&js);
                                        let _ = eval.recv::<Value>().await;
                                    });
                                }
                            },
                            crate::blocks::MdPreview { text: plain }
                        }
                    }
                }
            } else {
                rsx! { EditableDiv { node, cls: "blk-p ed-line".to_string() } }
            }
        }
        "heading" | "quote" => {
            let cls = match ty.as_str() {
                "heading" => {
                    let lv = crate::blocks::heading_level(&node);
                    format!("blk-h{lv} ed-line")
                }
                _ => "blk-quote ed-line".to_string(),
            };
            rsx! { EditableDiv { node, cls } }
        }
        "callout" => {
            let variant = node
                .extra
                .get("calloutType")
                .or_else(|| node.extra.get("kind"))
                .or_else(|| node.extra.get("variant"))
                .and_then(|v| v.as_str())
                .unwrap_or("note")
                .to_lowercase();
            let (icon, title_key) = match variant.as_str() {
                "warning" => ("⚠", "callout.warning"),
                "tip" => ("💡", "callout.tip"),
                "important" => ("❗", "callout.important"),
                "caution" => ("⛔", "callout.caution"),
                _ => ("ℹ", "callout.note"),
            };
            let vcls = if matches!(
                variant.as_str(),
                "note" | "warning" | "tip" | "important" | "caution"
            ) {
                variant.clone()
            } else {
                "note".to_string()
            };
            rsx! {
                div { class: "callout callout-{vcls}",
                    div { class: "callout-header",
                        span { class: "callout-icon", "{icon}" }
                        span { class: "callout-title", "{crate::i18n::t(title_key)}" }
                    }
                    EditableDiv { node, cls: "callout-body ed-line".to_string() }
                }
            }
        }
        "codeBlock" => {
            rsx! { EditableDiv { node, cls: "blk-code ed-line".to_string() } }
        }
        "todo" => {
            let done = crate::blocks::todo_checked(&node);
            let bid = node.id.clone().unwrap_or_default();
            rsx! {
                div { class: if done { "todo-row done" } else { "todo-row" },
                    button {
                        class: if done { "todo-checkbox on" } else { "todo-checkbox" },
                        onclick: {
                            let bid = bid.clone();
                            let mut doc = doc;
                            let persist = persist.clone();
                            move |_| {
                                let mut d = doc.read().clone();
                                if let Some(loc) = find_loc(&d, &bid) {
                                    let n = node_at_mut(&mut d, loc);
                                    let cur = crate::blocks::todo_checked(n);
                                    set_attr(n, "checked", json!(!cur));
                                    n.extra.remove("checked");
                                    doc.set(d.clone());
                                    persist.call(d, title.read().clone(), data);
                                    diag::log("EDIT", &format!("todo toggle {bid} -> {}", !cur));
                                }
                            }
                        },
                    }
                    EditableDiv { node, cls: "todo-text ed-line".to_string() }
                }
            }
        }
        "bulleted-list" | "numbered-list" => {
            let ordered = ty == "numbered-list";
            let kids = node.children.clone().unwrap_or_default();
            rsx! {
                div { class: "list-wrap",
                    for (j, item) in kids.iter().enumerate() {
                        div { key: "{item.id.clone().unwrap_or_default()}", class: "list-row",
                            span { class: "list-marker",
                                if ordered { "{j + 1}." } else { "•" }
                            }
                            EditableDiv { node: item.clone(), cls: "ed-line".to_string() }
                        }
                    }
                }
            }
        }
        "imgTextCard" | "imageTextRow" => {
            let bid = node.id.clone().unwrap_or_default();
            rsx! {
                div { class: if sel { "blk-wrap sel" } else { "blk-wrap" }, "data-wrapbid": "{bid}",
                    BlockView { node, gen }
                    if sel {
                        BlockImgBtn { bid: bid.clone(), media_req }
                        BlockDelBtn { bid: bid.clone(), doc, title, data, persist }
                    }
                }
            }
        }
        "musicCard" => {
            let bid = node.id.clone().unwrap_or_default();
            rsx! {
                div { class: if sel { "blk-wrap sel" } else { "blk-wrap" }, "data-wrapbid": "{bid}",
                    BlockView { node, gen }
                    if sel {
                    button {
                        class: "blk-del",
                        style: "right:86px",
                        onclick: {
                            let bid = bid.clone();
                            let mut doc = doc;
                            let persist = persist.clone();
                            move |_| {
                                let bid2 = bid.clone();
                                let persist = persist.clone();
                                spawn(async move {
                                    let mut eval = document::eval(&format!(
                                        "dioxus.send(window.prompt({}, '') || '');",
                                        serde_json::to_string(&crate::i18n::t("music.url_prompt")).unwrap_or_default()
                                    ));
                                    if let Ok(url) = eval.recv::<String>().await {
                                        let url = url.trim().to_string();
                                        if !url.is_empty() {
                                            // 原版设链路径：先置 loading
                                            // （骨架）再拉元数据落 ready/error
                                            let mut d = doc.read().clone();
                                            if let Some(loc) = find_loc(&d, &bid2) {
                                                let n = node_at_mut(&mut d, loc);
                                                n.extra.insert("url".into(), json!(url.clone()));
                                                n.extra.insert("meta".into(), serde_json::Value::Null);
                                                n.extra.insert("status".into(), json!("loading"));
                                                doc.set(d.clone());
                                                persist.call(d, title.read().clone(), data);
                                                diag::log("EDIT", &format!("music url set {bid2}"));
                                                spawn_resolve_card(doc, bid2.clone(), url, title, data, persist.clone());
                                            }
                                        }
                                    }
                                });
                            }
                        },
                        "{crate::i18n::t(\"music.set_url\")}"
                    }
                    BlockDelBtn { bid: bid.clone(), doc, title, data, persist: persist.clone() }
                    }
                }
            }
        }
        _ => {
            let bid = node.id.clone().unwrap_or_default();
            rsx! {
                div { class: if sel { "blk-wrap sel" } else { "blk-wrap" }, "data-wrapbid": "{bid}",
                    BlockView { node, gen }
                    if sel {
                        BlockDelBtn { bid: bid.clone(), doc, title, data, persist }
                    }
                }
            }
        }
    }
}

/// 非受控可编辑区：初始 HTML 只在挂载时写一次（use_hook 锁定），
/// 此后内容归浏览器，模型同步走 JS 桥消息。data-btype 供桥区分
/// 代码块（回车不分块、斜杠不触发）。
#[component]
fn EditableDiv(
    node: Node,
    cls: String,
    force_btype: Option<String>,
    initial_html: Option<String>,
) -> Element {
    let bid = node.id.clone().unwrap_or_default();
    let btype = force_btype
        .clone()
        .unwrap_or_else(|| node.block_type().unwrap_or("paragraph").to_string());
    let initial = use_hook(|| {
        initial_html
            .clone()
            .unwrap_or_else(|| inlines_to_html(node.children.as_deref().unwrap_or(&[])))
    });
    rsx! {
        div {
            class: "{cls}",
            "data-bid": "{bid}",
            "data-btype": "{btype}",
            contenteditable: "true",
            dangerous_inner_html: "{initial}",
        }
    }
}

/// 斜杠面板：21 条命令（基础/媒体两组）+ 链接表单态。定位用
/// 桥传来的光标矩形（fixed），靠下时上翻避免溢出屏幕。
#[component]
fn SlashPanel(
    bid: String,
    filter: String,
    anchor_x: f64,
    anchor_top: f64,
    anchor_bottom: f64,
    mut panel: Signal<Option<(String, String, f64, f64, f64)>>,
    mut slash_click: Signal<Option<(String, String)>>,
    mut link_for: Signal<Option<String>>,
    mut link_click: Signal<Option<(String, String)>>,
) -> Element {
    // 定位/宽度 = 原版 use-slash.js 公式逐项移植：宽度由命令标题
    // 启发式估算（title 字数×16 + shortcut×8 + 固定 56，分组 +20），
    // min(360, max(220, 内容宽+12, 视口宽-24))；left 钳制在视口内
    // 12px 边距；top = 锚底 + 10，放不下（高 260 估算）则上翻。
    let (vw, vh) = web_sys::window()
        .map(|w| {
            (
                w.inner_width().ok().and_then(|v| v.as_f64()).unwrap_or(0.0),
                w.inner_height().ok().and_then(|v| v.as_f64()).unwrap_or(0.0),
            )
        })
        .unwrap_or((0.0, 0.0));
    let mut max_content_w: f64 = 240.0;
    for c in SLASH_CMDS.iter() {
        let title_w = crate::i18n::t(c.title).chars().count() as f64 * 16.0;
        let short_w = c.shortcut.chars().count() as f64 * 8.0;
        let mut row_w = 24.0 + 10.0 + title_w + (if short_w > 0.0 { 8.0 + short_w } else { 0.0 }) + 22.0;
        if c.group > 0 {
            row_w += 20.0;
        }
        if row_w > max_content_w {
            max_content_w = row_w;
        }
    }
    let width = 360.0f64.min((max_content_w + 12.0).max(220.0).max(vw - 24.0));
    let left = (vw - width - 12.0).min(anchor_x - 8.0).max(12.0);
    let mut top = anchor_bottom + 10.0;
    if top + 260.0 > vh - 8.0 {
        top = (anchor_top - 260.0 - 10.0).max(76.0);
    }
    let style = format!("left:{left}px;top:{top}px;width:{width}px");
    if link_for.read().as_deref() == Some(bid.as_str()) {
        let mut url = use_signal(String::new);
        let mut err = use_signal(|| false);
        return rsx! {
            div { id: "slash-panel", class: "slash-panel", style: "{style}",
                div { class: "slash-link-form",
                    div { class: "slash-link-title", "{crate::i18n::t(\"slash.link_form_title\")}" }
                    input {
                        class: "slash-link-input",
                        placeholder: "https://",
                        value: "{url}",
                        oninput: move |e| {
                            err.set(false);
                            url.set(e.value());
                        },
                    }
                    if *err.read() {
                        div { class: "slash-link-error", "{crate::i18n::t(\"slash.link_invalid\")}" }
                    }
                    div { class: "slash-link-actions",
                        button {
                            onclick: move |_| {
                                link_for.set(None);
                                panel.set(None);
                            },
                            "{crate::i18n::t(\"action.cancel\")}"
                        }
                        button {
                            class: "slash-link-submit",
                            onclick: {
                                let bid = bid.clone();
                                move |_| {
                                    let u = url.read().trim().to_string();
                                    if u.is_empty()
                                        || !(u.starts_with("http://") || u.starts_with("https://"))
                                    {
                                        err.set(true);
                                        return;
                                    }
                                    link_click.set(Some((bid.clone(), u)));
                                }
                            },
                            "{crate::i18n::t(\"slash.link_insert\")}"
                        }
                    }
                }
            }
        };
    }
    // 过滤/分组逐项对原版 slash-model.js filter：
    // 有查询 → 全串（本地化标题+副标题+keywords+type+拼音）
    // 小写包含匹配，前缀命中（标题+keywords 或拼音以查询
    // 开头）优先，其余按标题排序，无分组头；
    // 无查询 → 「最近使用」组置顶（按存储顺序，行尾带
    // 「最近」胶囊），其余命令按基础/媒体分组且排除已在
    // 最近组里的。
    let q = filter.trim().to_lowercase();
    struct SRow {
        head: Option<String>,
        cmd: Option<&'static SlashCmd>,
        sel: bool,
        recent: bool,
    }
    let mut rows: Vec<SRow> = Vec::new();
    if !q.is_empty() {
        let mut hits: Vec<&'static SlashCmd> = SLASH_CMDS
            .iter()
            .filter(|c| {
                let hay = format!(
                    "{} {} {} {} {}",
                    crate::i18n::t(c.title),
                    crate::i18n::t(c.sub),
                    c.kw,
                    c.act,
                    c.py
                )
                .to_lowercase();
                hay.contains(&q)
            })
            .collect();
        hits.sort_by(|a, b| {
            let starts = |c: &SlashCmd| {
                let tk = format!("{} {}", crate::i18n::t(c.title), c.kw).to_lowercase();
                (tk.starts_with(&q) || c.py.starts_with(&q)) as u8
            };
            starts(b)
                .cmp(&starts(a))
                .then_with(|| crate::i18n::t(a.title).cmp(&crate::i18n::t(b.title)))
        });
        for (i, c) in hits.into_iter().enumerate() {
            rows.push(SRow { head: None, cmd: Some(c), sel: i == 0, recent: false });
        }
    } else {
        let recent_ids = slash_recent_ids();
        let recent_cmds: Vec<&'static SlashCmd> = recent_ids
            .iter()
            .filter_map(|oid| SLASH_CMDS.iter().find(|c| &c.oid == oid))
            .collect();
        let mut first = true;
        if !recent_cmds.is_empty() {
            rows.push(SRow {
                head: Some(crate::i18n::t("slash.recent")),
                cmd: None,
                sel: false,
                recent: false,
            });
            for c in &recent_cmds {
                rows.push(SRow { head: None, cmd: Some(c), sel: first, recent: true });
                first = false;
            }
        }
        for g in [0u8, 1u8] {
            let items: Vec<&'static SlashCmd> = SLASH_CMDS
                .iter()
                .filter(|c| c.group == g && !recent_ids.iter().any(|oid| oid == c.oid))
                .collect();
            if items.is_empty() {
                continue;
            }
            rows.push(SRow {
                head: Some(crate::i18n::t(if g == 0 {
                    "slash.group_basic"
                } else {
                    "slash.group_media"
                })),
                cmd: None,
                sel: false,
                recent: false,
            });
            for c in items {
                rows.push(SRow { head: None, cmd: Some(c), sel: first, recent: false });
                first = false;
            }
        }
    }
    let any = rows.iter().any(|r| r.cmd.is_some());
    rsx! {
        div { id: "slash-panel", class: "slash-panel", style: "{style}",
            for row in rows {
                if let Some(label) = row.head {
                    div { class: "slash-section-heading", "{label}" }
                }
                if let Some(c) = row.cmd {
                    button {
                        class: if row.sel { "slash-row sel" } else { "slash-row" },
                        "data-act": "{c.act}",
                        "aria-selected": if row.sel { "true" } else { "false" },
                        onclick: {
                            let act = c.act;
                            let bid = bid.clone();
                            move |_| {
                                if act == "link" {
                                    link_for.set(Some(bid.clone()));
                                } else {
                                    panel.set(None);
                                    slash_click.set(Some((bid.clone(), act.to_string())));
                                }
                            }
                        },
                        span { class: "slash-row-icon",
                            crate::icons::Icon { name: c.icon.to_string(), size: 20, stroke_width: "2.5".to_string(), stroke: "var(--color-accent)".to_string() }
                        }
                        span { class: "slash-row-copy",
                            span { class: "slash-row-title",
                                span { class: "slash-row-title-text", "{crate::i18n::t(c.title)}" }
                            }
                            span { class: "slash-row-subtitle", "{crate::i18n::t(c.sub)}" }
                        }
                        if !c.shortcut.is_empty() {
                            span { class: "slash-shortcut", "{c.shortcut}" }
                        }
                        if row.recent {
                            span { class: "slash-recent-pill", "aria-label": "{crate::i18n::t(\"slash.recent\")}", "{crate::i18n::t(\"slash.recent_pill\")}" }
                        }
                    }
                }
            }
            if !any {
                div { class: "slash-empty-state", "{crate::i18n::t(\"slash.no_match\")}" }
            }
        }
    }
}

/// 图文面板保存：文本写回块 extra["text"] 并落库（编辑器头部
/// 的两处调用——遮罩点击与「完成编辑」——共用）。
fn save_sheet_text(
    mut doc: Signal<Vec<Node>>,
    title: Signal<String>,
    data: Signal<BackupFile>,
    persist: &PersistHandle,
    bid: &str,
    txt: &str,
) {
    let mut d = doc.read().clone();
    if let Some(loc) = find_loc(&d, bid) {
        node_at_mut(&mut d, loc)
            .extra
            .insert("text".to_string(), json!(txt));
        doc.set(d.clone());
        persist.call(d, title.read().clone(), data);
        diag::log("EDIT", &format!("imgtext sheet save {bid}"));
    }
}

/// 媒体文件处理：上传全部选中文件到 IDB + manifest，再按请求
/// 分发——SetImage 给图文块换图；Replace 把斜杠所在块替换为
/// 图片块（多选依次插入）或单个画廊块。
async fn handle_media_files(
    mut doc: Signal<Vec<Node>>,
    title: Signal<String>,
    data: Signal<BackupFile>,
    mut manifest: Signal<String>,
    mut media_req: Signal<Option<MediaReq>>,
    persist: &PersistHandle,
) {
    let Some(req) = media_req.read().clone() else {
        return;
    };
    media_req.set(None);
    let Some(window) = web_sys::window() else {
        return;
    };
    let Some(document) = window.document() else {
        return;
    };
    let Some(input) = document
        .get_element_by_id("file-media")
        .and_then(|e| e.dyn_into::<web_sys::HtmlInputElement>().ok())
    else {
        return;
    };
    let Some(files) = input.files() else {
        return;
    };
    let mut man: Value =
        serde_json::from_str(&manifest.read()).unwrap_or_else(|_| json!({"version": 1}));
    if !man.get("attachments").map(|a| a.is_object()).unwrap_or(false) {
        man["attachments"] = json!({});
    }
    let mut fids: Vec<String> = Vec::new();
    for i in 0..files.length() {
        let Some(file) = files.get(i) else { continue };
        let name = file.name();
        let mime = file.type_();
        let Ok(buf) = JsFuture::from(file.array_buffer()).await else {
            continue;
        };
        let bytes = js_sys::Uint8Array::new(&buf).to_vec();
        let fid = gen_id();
        if idb::put_attachment(&fid, &bytes).await.is_err() {
            continue;
        }
        man["attachments"][&fid] = json!({"name": name, "type": mime});
        fids.push(fid);
    }
    if fids.is_empty() {
        return;
    }
    let man_str = man.to_string();
    manifest.set(man_str.clone());
    let _ = idb::save_manifest(&man_str).await;

    let img_node = |fid: &str| {
        let mut extra = Map::new();
        extra.insert("attrs".to_string(), json!({"fileId": fid}));
        Node {
            text: None,
            node_type: Some("image".to_string()),
            id: Some(gen_id()),
            children: Some(vec![]),
            extra,
        }
    };
    let mut d = doc.read().clone();
    match req {
        MediaReq::SetImage { bid } => {
            if let Some(loc) = find_loc(&d, &bid) {
                node_at_mut(&mut d, loc)
                    .extra
                    .insert("attrs".to_string(), json!({"fileId": fids[0]}));
                diag::log("EDIT", &format!("imgtext set image {bid}"));
            }
        }
        MediaReq::Replace { bid, gallery } => {
            let nodes: Vec<Node> = if gallery {
                let mut g = new_block("gallery");
                g.children = Some(fids.iter().map(|f| img_node(f)).collect());
                vec![g]
            } else {
                fids.iter().map(|f| img_node(f)).collect()
            };
            match find_loc(&d, &bid) {
                Some(Loc::Top(i)) => {
                    d.remove(i);
                    for (k, n) in nodes.into_iter().enumerate() {
                        d.insert(i + k, n);
                    }
                }
                Some(Loc::Item(li, _)) => {
                    for (k, n) in nodes.into_iter().enumerate() {
                        d.insert(li + 1 + k, n);
                    }
                }
                None => {
                    for n in nodes {
                        d.push(n);
                    }
                }
            }
            diag::log("EDIT", &format!("slash media replace {bid} gallery={gallery}"));
        }
    }
    doc.set(d.clone());
    persist.call(d, title.read().clone(), data);
}

fn esc_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// 导出 HTML：独立网页（原版导出面板的 HTML 路径），PDF 导出
/// 复用同一份 HTML 走打印窗。
/// 收集页面当前全部样式表文本（原版 collectStyleText 的
/// 等价物：导出文档要带应用 CSS 才能保真渲染）。
async fn collect_app_css() -> String {
    let mut eval = document::eval(
        "dioxus.send((() => { let out = ''; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) out += r.cssText + '\\n'; } catch (e) {} } return out; })());",
    );
    eval.recv::<String>().await.unwrap_or_default()
}

/// 导出文档的兜底样式（原版 export.js fallbackStyles 逐字）。
const EXPORT_FALLBACK_CSS: &str = r#":root{color-scheme:light dark;--primary-bg:Canvas;--text-main:CanvasText;--text-secondary:GrayText;--border-color:GrayText;--glass-content-bg:Canvas;--glass-content-border:GrayText;--fill-subtle:Canvas;--code-bg:Canvas;--color-accent:LinkText;--md-text-muted:GrayText;--font-family-base:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;--font-family-mono:ui-monospace,Menlo,Consolas,monospace;--font-11:11px;--font-12:12px;--font-13:13px;--font-14:14px;--font-24:24px;--radius-10:10px;--radius-12:12px;--radius-14:14px;--radius-18:18px;--radius-22:22px;--radius-999:999px;--radius-circle:50%}
@media(prefers-color-scheme:dark){:root{--primary-bg:Canvas;--text-main:CanvasText;--text-secondary:GrayText;--glass-content-bg:Canvas;--glass-content-border:GrayText;--border-color:GrayText;--fill-subtle:Canvas;--code-bg:Canvas}}
*{box-sizing:border-box}html{background:var(--primary-bg);color:var(--text-main);font:16px/1.75 var(--font-family-base)}body{margin:0;background:var(--primary-bg);color:var(--text-main);overflow-wrap:anywhere}.editor-body{min-height:0}.editor-body p{margin:0 0 .65em}.editor-body h1,.editor-body h2,.editor-body h3,.editor-body h4{line-height:1.28;margin:1.25em 0 .4em}.editor-body blockquote{margin:.75em 0;padding:10px 14px;border-left:3px solid var(--color-accent);border-radius:var(--radius-10);background:var(--fill-subtle)}.editor-body pre{max-width:100%;overflow:auto;padding:12px 14px;border:1px solid var(--border-color);border-radius:var(--radius-12);background:var(--code-bg)}.editor-body .img-text-card,.editor-body .img-text-row,.editor-body .link-card-block,.editor-body .link-card-err,.editor-body .attachment-file{margin:8px 0;overflow:hidden;border:1px solid var(--glass-content-border);border-radius:var(--radius-22);background:var(--glass-content-bg)}.editor-body .itc-img-wrap img,.editor-body .lkc-cover img{display:block;width:100%;max-width:100%;height:auto;object-fit:cover}.editor-body .itc-text{padding:12px 14px;font-size:var(--font-14);white-space:pre-wrap}.editor-body .img-text-row{display:flex;min-height:181px;max-height:196px}.editor-body .itr-img{flex:0 0 50%;overflow:hidden}.editor-body .itr-img img{width:100%;height:100%;object-fit:cover}.editor-body .itr-text{flex:1;overflow:hidden;padding:10px 14px;font-size:var(--font-14);white-space:pre-wrap}.editor-body .atomic[data-type="gallery"]{margin:8px 36px}.editor-body .atomic[data-type="image"]{margin:8px 36px}.editor-body .atomic.attachment img{max-width:100%;border-radius:var(--radius-22)}.editor-body .attachment-file{display:flex;align-items:center;gap:10px;padding:16px 20px}.editor-body .att-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.editor-body .lkc-cover{width:100%;aspect-ratio:2.4/1;overflow:hidden}.editor-body .lkc-body{padding:10px 14px 12px}.editor-body .lkc-title{font-size:var(--font-14);font-weight:600;line-height:1.4}.editor-body .lkc-subtitle,.editor-body .lkc-source{font-size:var(--font-12);color:var(--text-secondary)}.editor-body .todo-checkbox{accent-color:var(--color-accent)}img{max-width:100%}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}"#;

/// 导出外壳/页眉/打印样式（原版 snapshotStyles 的固定部分）。
const EXPORT_SHELL_CSS: &str = r#".mynote-export-shell{box-sizing:border-box;width:min(100%,1120px);margin:0 auto;padding:24px 16px 40px;color:var(--text-main,CanvasText)}
.mynote-export-header{position:relative;box-sizing:border-box;display:block;width:100vw;height:185px;margin:0 0 28px calc(50% - 50vw);padding:0}
.mynote-export-control{box-sizing:border-box;position:absolute;top:7px;display:grid;place-items:center;width:46px;height:46px;border:0.5px solid var(--glass-control-border,var(--border-color,rgba(0,0,.14)));border-radius:50%;background:var(--glass-control-bg,Canvas);color:var(--text-secondary,GrayText)}
.mynote-export-back{left:16px}.mynote-export-more{right:16px}
.mynote-export-dock{position:absolute;top:7px;left:62px;right:62px;display:flex;flex-direction:column;align-items:center;gap:6px}
.mynote-export-avatar{box-sizing:border-box;width:72px;height:72px;overflow:hidden;border:0.5px solid var(--glass-control-border,var(--border-color,rgba(0,0,.14)));border-radius:50%;background:var(--glass-control-bg,Canvas);display:flex;align-items:flex-end;justify-content:center}
.mynote-export-avatar img{display:block;width:100%;height:100%;object-fit:cover}
.mynote-export-avatar-fallback{display:flex;width:100%;height:100%;align-items:flex-end;justify-content:center;overflow:hidden}
.mynote-export-title-pill{box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-width:66px;max-width:100%;height:66px;overflow:hidden;padding:0 20px;border:0.5px solid var(--glass-control-border,var(--border-color,rgba(0,0,.14)));border-radius:var(--radius-33,33px);background:var(--glass-control-bg,Canvas);backdrop-filter:var(--glass-control-filter);-webkit-backdrop-filter:var(--glass-control-filter)}
.mynote-export-title-pill .note-title{box-sizing:border-box;max-width:100%;margin:0;color:var(--text-main,CanvasText);font:600 14px/1.3 var(--font-family-base,-apple-system,BlinkMacSystemFont,sans-serif);letter-spacing:-.2px;text-align:center;overflow-wrap:anywhere}
.mynote-export-meta{width:100%;color:var(--text-secondary,GrayText);font:var(--font-10,10px)/1.2 var(--font-family-base,-apple-system,BlinkMacSystemFont,sans-serif);text-align:center;white-space:nowrap}
@media(max-width:560px){.mynote-export-shell{padding:18px 14px 32px}.mynote-export-header{margin-bottom:24px}}
.mynote-export-shell .editor-body{box-sizing:border-box;min-height:0;padding:4px 0;color:var(--text-main,CanvasText);font:var(--md-font-body,16px)/var(--md-line-height,1.75) var(--font-family-base,-apple-system,BlinkMacSystemFont,sans-serif);overflow-wrap:anywhere}
.mynote-export-shell .editor-body>*:first-child{margin-top:0}
.mynote-export-shell .editor-body>*:last-child{margin-bottom:0}
@page{size:auto;margin:16mm}
@media print{html,body{print-color-adjust:exact;-webkit-print-color-adjust:exact}body{padding:0}.mynote-export-shell{width:100%;max-width:none;margin:0;padding:0}.mynote-export-header{width:100%;height:185px;margin:0 0 22px;break-inside:avoid}.mynote-export-shell .editor-body{min-height:0}.note-title{break-after:avoid}}"#;

/// 无头像时的恐龙兜底（原版 dinosaurAvatarMarkup 逐字路径）。
fn export_avatar_fallback() -> String {
    const PATHS: [&str; 10] = [
        "M 90,460 L 90,170 C 90,110 140,70 210,70 L 380,95 C 440,95 470,130 470,185 C 470,225 450,240 410,245 C 350,250 280,230 210,265 C 190,275 190,295 210,310 C 270,350 350,380 410,360 C 435,350 440,325 410,315",
        "M 160,330 C 180,380 230,440 280,460",
        "M 240,365 C 220,400 240,440 310,460",
        "M 90,460 L 310,460",
        "M 415,135 C 425,140 435,150 435,160",
        "M 230,115 C 260,95 310,120 355,140",
        "M 255,140 C 255,170 290,195 320,185 C 345,175 350,150 335,135",
        "M 290,145 C 290,165 315,165 315,150",
        "M 250,243 L 255,265 L 265,243 M 275,245 L 282,270 L 292,245 M 302,246 L 310,273 L 320,247 M 330,248 L 340,275 L 350,248 M 360,249 L 370,274 L 380,248 M 390,248 L 400,270 L 408,246 M 415,244 L 425,263 L 432,240 M 438,235 L 448,252 L 452,228",
        "M 250,323 L 255,305 L 263,326 M 273,329 L 280,308 L 288,333 M 298,336 L 306,313 L 314,340 M 324,343 L 333,318 L 341,346 M 351,348 L 361,323 L 369,351 M 379,352 L 389,328 L 396,353 M 404,351 L 413,330 L 418,348",
    ];
    let paths: String = PATHS
        .iter()
        .map(|d| format!("<path d=\"{d}\"></path>"))
        .collect();
    format!("<span class=\"mynote-export-avatar-fallback\" aria-hidden=\"true\"><svg viewBox=\"0 0 512 512\" width=\"60\" height=\"60\" fill=\"none\" stroke=\"var(--color-icon-muted)\" stroke-width=\"22\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"transform:translateY(10px)\">{paths}</svg></span>")
}

/// 导出 HTML 文档（原版 toHTMLDocument + visualSnapshotMarkup
/// 口径）：页眉（头像+标题胶囊+meta）+ 应用 CSS（或兜底）+
/// 外壳样式 + 主题属性 + 自定义底色。
fn doc_to_html(
    title: &str,
    doc: &[Node],
    subtitle: &str,
    avatar_url: Option<&str>,
    bg: Option<&str>,
    app_css: &str,
) -> String {
    let name = {
        let t = title.trim();
        if t.is_empty() { "无标题" } else { t }
    };
    let mut content = String::new();
    for n in doc {
        block_html(n, &mut content);
    }
    let avatar_markup = match avatar_url {
        Some(u) if !u.is_empty() => format!("<img src=\"{}\" alt=\"avatar\">", esc_html(u)),
        _ => export_avatar_fallback(),
    };
    let title_size = if name.chars().count() > 5 { "11px" } else { "14px" };
    let header = format!(
        "<header class=\"mynote-export-header\" aria-label=\"笔记页眉\" style=\"height:185px\">\
         <span class=\"mynote-export-control mynote-export-back\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"15 18 9 12 15 6\"></polyline></svg></span>\
         <div class=\"mynote-export-dock\"><div class=\"mynote-export-avatar\">{avatar_markup}</div>\
         <div class=\"mynote-export-title-pill\"><h1 class=\"note-title\" style=\"font-size:{title_size}\">{}</h1></div>\
         <div class=\"mynote-export-meta\">{}</div></div>\
         <span class=\"mynote-export-control mynote-export-more\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"currentColor\"><circle cx=\"5\" cy=\"12\" r=\"2\"></circle><circle cx=\"12\" cy=\"12\" r=\"2\"></circle><circle cx=\"19\" cy=\"12\" r=\"2\"></circle></svg></span></header>",
        esc_html(name),
        esc_html(subtitle)
    );
    let css = if app_css.trim().is_empty() {
        format!("{EXPORT_FALLBACK_CSS}\n{EXPORT_SHELL_CSS}")
    } else {
        format!("{app_css}\n{EXPORT_SHELL_CSS}")
    };
    let body_style = match bg {
        Some(c) if !c.is_empty() => {
            format!(" style=\"background-color:{};color:var(--text-main,CanvasText)\"", esc_html(c))
        }
        _ => String::new(),
    };
    format!(
        "<!doctype html>\n<html lang=\"zh-CN\" data-export-theme=\"system\" style=\"color-scheme:light dark\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title><style>{}</style></head><body{}><main class=\"mynote-export-shell\">{}<div class=\"editor-body\">{}</div></main></body></html>",
        esc_html(name),
        css,
        body_style,
        header,
        content
    )
}

fn block_html(node: &Node, out: &mut String) {
    let ty = node.node_type.as_deref().unwrap_or("paragraph");
    let inner = inlines_to_html(node.children.as_deref().unwrap_or(&[]));
    match ty {
        "heading" => {
            let lv = crate::blocks::heading_level(node);
            out.push_str(&format!("<h{lv}>{inner}</h{lv}>"));
        }
        "quote" | "callout" => {
            out.push_str(&format!("<blockquote>{inner}</blockquote>"));
        }
        "todo" => {
            let c = crate::blocks::todo_checked(node);
            out.push_str(&format!(
                "<p>{} {}</p>",
                if c { "☑" } else { "☐" },
                inner
            ));
        }
        "codeBlock" => {
            out.push_str(&format!("<pre>{}</pre>", esc_html(&node.plain_text())));
        }
        "divider" => out.push_str("<div class=\"note-text\"><hr></div>"),
        "decorative_divider" => {
            let t = node
                .extra
                .get("attrs")
                .and_then(|a| a.get("text"))
                .and_then(|v| v.as_str())
                .map(|v| v.to_string())
                .unwrap_or_else(|| {
                    let raw = node.plain_text();
                    raw.trim_start_matches('-').trim_end_matches('-').trim().to_string()
                });
            out.push_str(&format!(
                "<div class=\"note-text note-decorative-divider\"><hr><span>{}</span></div>",
                esc_html(&t)
            ));
        }
        "bulleted-list" | "numbered-list" => {
            let tag = if ty == "numbered-list" { "ol" } else { "ul" };
            out.push_str(&format!("<{tag}>"));
            if let Some(items) = &node.children {
                for it in items {
                    out.push_str(&format!(
                        "<li>{}</li>",
                        inlines_to_html(it.children.as_deref().unwrap_or(&[]))
                    ));
                }
            }
            out.push_str(&format!("</{tag}>"));
        }
        _ => {
            if !inner.is_empty() {
                out.push_str(&format!("<p>{inner}</p>"));
            }
        }
    }
}

/// 语义 Markdown 导出（对齐原版 export.js 的 toSemanticMarkdown
/// 思路，Rust 侧递归生成；附件以 manifest 中的文件名引用）。
fn memo_to_markdown(title: &str, doc: &[Node], manifest_raw: &str) -> String {
    let manifest: Value = serde_json::from_str(manifest_raw).unwrap_or(Value::Null);
    let att_name = |fid: &str| -> String {
        manifest
            .get("attachments")
            .and_then(|a| a.get(fid))
            .and_then(|e| e.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or(fid)
            .to_string()
    };
    let mut out = String::new();
    if !title.trim().is_empty() {
        out.push_str(&format!("# {}\n\n", title.trim()));
    }
    for node in doc {
        block_md(node, 0, &att_name, &mut out);
    }
    out
}

fn block_md(
    node: &Node,
    depth: usize,
    att_name: &dyn Fn(&str) -> String,
    out: &mut String,
) {
    let ty = node.node_type.as_deref().unwrap_or("paragraph");
    let text = node.plain_text();
    match ty {
        "heading" => {
            let lv = crate::blocks::heading_level(node).clamp(1, 3);
            out.push_str(&format!("{} {}\n\n", "#".repeat((lv + 1) as usize), text));
        }
        "todo" => {
            let checked = crate::blocks::todo_checked(node);
            out.push_str(&format!("- [{}] {}\n", if checked { "x" } else { " " }, text));
        }
        "quote" => out.push_str(&format!("> {}\n\n", text.replace('\n', "\n> "))),
        "callout" => out.push_str(&format!("> {}\n\n", text)),
        "divider" => out.push_str("---\n\n"),
        "bulleted-list" | "numbered-list" => {
            if let Some(items) = &node.children {
                for (i, item) in items.iter().enumerate() {
                    let mark = if ty == "numbered-list" {
                        format!("{}.", i + 1)
                    } else {
                        "-".to_string()
                    };
                    out.push_str(&format!(
                        "{}{} {}\n",
                        "  ".repeat(depth),
                        mark,
                        item.plain_text()
                    ));
                    if let Some(subs) = &item.children {
                        for s in subs {
                            if matches!(
                                s.node_type.as_deref(),
                                Some("bulleted-list" | "numbered-list")
                            ) {
                                block_md(s, depth + 1, att_name, out);
                            }
                        }
                    }
                }
            }
            out.push('\n');
        }
        "image" => {
            let fid = node
                .extra
                .get("attrs")
                .and_then(|a| a.get("fileId"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            out.push_str(&format!("![{}]({})\n\n", att_name(fid), att_name(fid)));
        }
        "attachment" => {
            let fid = node
                .extra
                .get("fileId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            out.push_str(&format!("[📎 {}]({})\n\n", att_name(fid), att_name(fid)));
        }
        "link-card" => {
            let url = node
                .extra
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let t = node
                .extra
                .get("meta")
                .and_then(|m| m.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or(url);
            out.push_str(&format!("[{}]({})\n\n", t, url));
        }
        "gallery" => {
            if let Some(items) = &node.children {
                for it in items {
                    block_md(it, depth, att_name, out);
                }
            }
        }
        _ => {
            if !text.is_empty() {
                out.push_str(&format!("{}\n\n", text));
            }
        }
    }
}

/// 浏览器下载一段文本（Blob + a[download]）。
fn download_text(filename: &str, text: &str, mime: &str) {
    let Some(window) = web_sys::window() else {
        return;
    };
    let Some(document) = window.document() else {
        return;
    };
    let parts = js_sys::Array::new();
    parts.push(&wasm_bindgen::JsValue::from_str(text));
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type(mime);
    let Ok(blob) = web_sys::Blob::new_with_str_sequence_and_options(&parts, &opts) else {
        return;
    };
    let Ok(url) = web_sys::Url::create_object_url_with_blob(&blob) else {
        return;
    };
    if let Ok(a) = document.create_element("a") {
        if let Ok(a) = a.dyn_into::<web_sys::HtmlAnchorElement>() {
            a.set_href(&url);
            a.set_download(filename);
            a.click();
        }
    }
    let _ = web_sys::Url::revoke_object_url(&url);
}

/// 编辑器副行时间格式（对齐原版 timeAgo 今日形态：24h 设备
/// H:mm，否则上午/下午 h:mm）。
pub(crate) fn time_label(ms: i64) -> String {
    let d = js_sys::Date::new(&wasm_bindgen::JsValue::from_f64(ms as f64));
    let h = d.get_hours();
    let m = d.get_minutes();
    if crate::list::is_24h() {
        return format!("{h}:{m:02}");
    }
    let (ap, h12) = if h < 12 {
        ("上午", if h == 0 { 12 } else { h })
    } else {
        ("下午", if h == 12 { 12 } else { h - 12 })
    };
    format!("{ap} {h12}:{m:02}")
}

/// 背景色 8 色（原版 BgSheet：冷雾/暖沙/浅绿/浅蓝/浅粉/米橙/淡紫/浅杏）。
const BG_COLORS: [&str; 8] = [
    "#eaeef2", "#e8e0d4", "#d4e8d0", "#d0e0e8", "#e8d0d4", "#fff3e0", "#e8e0f0",
    "#f0e8d0",
];

/// 添加附件：读 #file-attach 选中的文件 → 写 IDB 附件库 →
/// 更新 manifest → 文档末尾插入图片/附件块并落库。
async fn attach_file(
    mut doc: Signal<Vec<Node>>,
    title: Signal<String>,
    data: Signal<BackupFile>,
    mut manifest: Signal<String>,
    persist: &PersistHandle,
    mut ed_status: Signal<String>,
) {
    let Some(window) = web_sys::window() else {
        return;
    };
    let Some(document) = window.document() else {
        return;
    };
    let Some(input) = document
        .get_element_by_id("file-attach")
        .and_then(|e| e.dyn_into::<web_sys::HtmlInputElement>().ok())
    else {
        return;
    };
    let Some(files) = input.files() else {
        return;
    };
    for fi in 0..files.length() {
        let Some(file) = files.get(fi) else {
            continue;
        };
        attach_one(&file, doc, title, data, manifest, persist, ed_status).await;
    }
}

/// 单个附件文件：写 IDB → 更新 manifest → 末尾插块并落库。
async fn attach_one(
    file: &web_sys::File,
    mut doc: Signal<Vec<Node>>,
    title: Signal<String>,
    data: Signal<BackupFile>,
    mut manifest: Signal<String>,
    persist: &PersistHandle,
    mut ed_status: Signal<String>,
) {
    let name = file.name();
    let mime = file.type_();
    let Ok(buf) = JsFuture::from(file.array_buffer()).await else {
        return;
    };
    let bytes = js_sys::Uint8Array::new(&buf).to_vec();
    let fid = gen_id();
    if let Err(e) = idb::put_attachment(&fid, &bytes).await {
        diag::log("EDIT", &format!("attach put err: {e:?}"));
        return;
    }
    // manifest.attachments[fid] = {name, type}
    let mut man: Value =
        serde_json::from_str(&manifest.read()).unwrap_or_else(|_| json!({"version": 1}));
    if !man.get("attachments").map(|a| a.is_object()).unwrap_or(false) {
        man["attachments"] = json!({});
    }
    man["attachments"][&fid] = json!({"name": name, "type": mime});
    let man_str = man.to_string();
    manifest.set(man_str.clone());
    let _ = idb::save_manifest(&man_str).await;

    let is_image = mime.starts_with("image/");
    let mut extra = Map::new();
    let node = if is_image {
        extra.insert("attrs".to_string(), json!({"fileId": fid}));
        Node {
            text: None,
            node_type: Some("image".to_string()),
            id: Some(gen_id()),
            children: Some(vec![]),
            extra,
        }
    } else {
        extra.insert("fileId".to_string(), Value::String(fid.clone()));
        extra.insert("status".to_string(), Value::String("done".to_string()));
        extra.insert("image".to_string(), Value::Bool(false));
        Node {
            text: None,
            node_type: Some("attachment".to_string()),
            id: Some(gen_id()),
            children: Some(vec![]),
            extra,
        }
    };
    let mut d = doc.read().clone();
    d.push(node);
    doc.set(d.clone());
    persist.call(d, title.read().clone(), data);
    ed_status.set(crate::i18n::t("attach.done"));
    diag::log("EDIT", &format!("attach {fid} {name} {mime} {}B", bytes.len()));
}
