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
