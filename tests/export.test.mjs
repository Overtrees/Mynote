import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAppEnv } from './helpers/app-env.mjs';

test('Markdown 导出保留标题、常见块类型和内嵌图片', () => {
  const { win } = makeAppEnv();
  const markdown = win.MynoteEditorExport.toMarkdown([
    { id: 'p', type: 'paragraph', children: [{ text: '一段 **笔记**' }] },
    { id: 'h', type: 'heading', attrs: { level: 3 }, children: [{ text: '小标题' }] },
    { id: 'q', type: 'quote', children: [{ text: '引用\n第二行' }] },
    { id: 't', type: 'todo', attrs: { checked: true }, children: [{ text: '完成任务' }] },
    { id: 'img', type: 'image', attrs: { fileId: 'photo' } },
    { id: 'link', type: 'link-card', url: 'https://example.com/note', meta: { title: '参考链接' } }
  ], '我的笔记', { photo: { name: '图片.png', type: 'image/png', url: 'data:image/png;base64,AA==' } });

  assert.match(markdown, /^# 我的笔记/m);
  assert.match(markdown, /一段 \*\*笔记\*\*/);
  assert.match(markdown, /### 小标题/);
  assert.match(markdown, /> 引用\n> 第二行/);
  assert.match(markdown, /- \[x\] 完成任务/);
  assert.match(markdown, /!\[图片\.png\]\(data:image\/png;base64,AA==\)/);
  assert.match(markdown, /\[参考链接\]\(https:\/\/example\.com\/note\)/);
});

test('HTML 导出是独立文档并转义文档标题', () => {
  const { win } = makeAppEnv();
  const html = win.MynoteEditorExport.toHTMLDocument([
    { id: 'p', type: 'paragraph', children: [{ text: '安全内容' }] }
  ], 'A&B <笔记>', {});

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>A&amp;B &lt;笔记&gt;<\/title>/);
  assert.match(html, /@media print/);
  assert.match(html, /安全内容/);
});

test('不导出不安全链接，文件名移除系统保留字符', () => {
  const { win } = makeAppEnv();
  const markdown = win.MynoteEditorExport.toMarkdown([
    { id: 'link', type: 'musicCard', url: 'javascript:alert(1)', meta: { title: '恶意链接' } }
  ], '', {});

  assert.doesNotMatch(markdown, /javascript:/i);
  assert.equal(win.MynoteEditorExport.toFilename('a/b:c*?', '.md'), 'a_b_c__.md');
});


test('无编辑器快照时 Markdown 回退仍补全图文卡片语义说明', () => {
  const { win } = makeAppEnv();
  const markdown = win.MynoteEditorExport.toMarkdown([
    { id: 'card', type: 'imgTextCard', attrs: { fileId: 'photo' }, children: [{ text: '卡片里的完整说明' }] },
    { id: 'row', type: 'imageTextRow', attrs: { fileId: 'photo' }, children: [{ text: '并排图片说明' }] }
  ], '', { photo: { name: '风景.jpg', type: 'image/jpeg', url: 'data:image/jpeg;base64,AA==' } });

  assert.match(markdown, /!\[风景\.jpg\]\(data:image\/jpeg;base64,AA==\)\n\n说明：卡片里的完整说明/);
  assert.match(markdown, /说明：并排图片说明/);
});

test('HTML 按原始编辑器块导出图文卡片、画廊、音乐及网页元数据', () => {
  const { win } = makeAppEnv();
  const html = win.MynoteEditorExport.toHTMLDocument([
    { id: 'captioned', type: 'imgTextCard', attrs: { fileId: 'photo' }, children: [{ text: '完整图注' }] },
    { id: 'row', type: 'imageTextRow', attrs: { fileId: 'photo' }, children: [{ text: '横向说明' }] },
    { id: 'gallery', type: 'gallery', attrs: { items: [{ fileId: 'photo' }, { url: 'https://example.com/two.jpg' }] } },
    { id: 'link', type: 'link-card', url: 'https://example.com/article', meta: { title: '网页标题', subtitle: '网页摘要', source: 'example.com', cover: 'https://example.com/cover.jpg' } },
    { id: 'music', type: 'musicCard', url: 'https://music.example/song', meta: { title: '歌曲名', subtitle: '歌手', source: '音乐服务' } }
  ], '图文笔记', { photo: { name: '照片.jpg', type: 'image/jpeg', url: 'data:image/jpeg;base64,AA==' } });

  assert.match(html, /class="note-title">图文笔记/);
  assert.match(html, /class="note-media img-text-card"/);
  assert.match(html, /class="itc-text">完整图注/);
  assert.match(html, /class="note-media img-text-row"/);
  assert.match(html, /class="itr-text">横向说明/);
  assert.match(html, /class="note-media gallery-grid"/);
  assert.match(html, /class="gallery-image"/);
  assert.match(html, /class="note-media note-link-card"/);
  assert.match(html, /网页摘要/);
  assert.match(html, /class="note-media note-link-card note-music-card"/);
  assert.match(html, /data:image\/jpeg;base64,AA==/);
  assert.match(html, /@media\(prefers-color-scheme:dark\)/);
  assert.match(html, /@media print/);
  assert.doesNotMatch(html, /box-shadow\s*:/);
});

test('HTML 导出保留非图片附件下载信息，同时过滤不安全链接', () => {
  const { win } = makeAppEnv();
  const html = win.MynoteEditorExport.toHTMLDocument([
    { id: 'file', type: 'attachment', fileId: 'doc' },
    { id: 'bad', type: 'link-card', url: 'javascript:alert(1)', meta: { title: '恶意地址' } }
  ], '', {
    doc: { name: '参考资料.pdf', type: 'application/pdf', size: 2048, url: 'data:application/pdf;base64,AA==' }
  });

  assert.match(html, /参考资料\.pdf/);
  assert.match(html, /download="参考资料\.pdf"/);
  assert.match(html, /data:application\/pdf;base64,AA==/);
  assert.doesNotMatch(html, /javascript:/i);
});


test('Markdown、HTML 导出共用编辑器 DOM/CSS 快照以保留卡片视觉结构', () => {
  const { win } = makeAppEnv();
  const snapshot = {
    html: '<div class="img-text-card"><img src="data:image/png;base64,AA=="><div class="itc-text">图文卡片完整说明</div></div><div class="link-card-block music-card-link"><div class="lkc-body"><div class="lkc-title">音乐卡片标题</div></div></div><div class="editor-todo is-checked"><input type="checkbox" checked><span class="todo-text">勾选项</span></div>',
    cssText: '.img-text-card{display:grid;border-radius:var(--radius-22)}.link-card-block{display:block}.music-card-link .lkc-title{font-weight:600}'
  };
  const markdown = win.MynoteEditorExport.toMarkdown([], '快照笔记', {}, snapshot);
  const html = win.MynoteEditorExport.toHTMLDocument([], '快照笔记', {}, snapshot);

  for (const content of [markdown, html]) {
    assert.match(content, /img-text-card/);
    assert.match(content, /图文卡片完整说明/);
    assert.match(content, /link-card-block/);
    assert.match(content, /music-card-link/);
    assert.match(content, /音乐卡片标题/);
    assert.match(content, /editor-todo is-checked/);
    assert.match(content, /\.img-text-card\{display:grid;border-radius:var\(--radius-22\)\}/);
    assert.match(content, /data:image\/png;base64,AA==/);
  }
  assert.match(markdown, /^<style>/);
  assert.match(markdown, /<main class="mynote-export-shell">/);
  assert.match(html, /^<!doctype html>/i);
});


test('HTML 快照导出只嵌入一份编辑器样式表', () => {
  const { win } = makeAppEnv();
  const html = win.MynoteEditorExport.toHTMLDocument([], '去重测试', {}, {
    html: '<div class="img-text-card">图片笔记</div>',
    cssText: '.img-text-card{display:grid}'
  });
  assert.equal((html.match(/\.img-text-card\{display:grid\}/g) || []).length, 1);
});
