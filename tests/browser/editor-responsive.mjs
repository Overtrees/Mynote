#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = ['tokens.css', 'base.css', 'editor.css', 'cards.css', 'editor-shell.css']
  .map(name => fs.readFileSync(path.join(ROOT, 'src/styles', name), 'utf8'))
  .join('\n');
const CHROME = process.env.CHROME || '/usr/bin/chromium';
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>html,body{margin:0;min-height:100%;}body{background:var(--color-editor-bg,Canvas)}.editor-spread{padding:84px 16px 32px}.fixture-caption{padding:12px 14px}</style></head><body>
<div class="editor-spread"><div class="editor-body" contenteditable="true">
  <h1>双栏排版：标题应清晰且自然换行</h1>
  <p>这是一段用于检查中文正文、英文混排与长链接的内容。访问 https://example.com/a/very/long/path/that/should/wrap/without/causing/page/overflow ，并保留段落阅读节奏。</p>
  <h2>任务与普通列表</h2>
  <ul><li>普通列表中的连续文本应在需要时换行，不挤出页面边缘。</li><li>含有 long-unbroken-token-abcdefghijklmnopqrstuvwxyz0123456789 的列表内容。</li></ul>
  <div data-type="todo" class="editor-todo is-checked"><input class="todo-checkbox" type="checkbox" checked><span class="todo-text">已完成待办的长文本需要换行，文字使用弱化色和删除线，复选框仍保持完整触控区域。重复内容用于窄栏压力检查。</span></div>
  <div data-type="todo" class="editor-todo"><input class="todo-checkbox" type="checkbox"><span class="todo-text">未完成任务</span></div>
  <blockquote><p>引用块在每栏内保持舒适内距，并且不横向溢出。引用中也包含很长的无空格内容 ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789。</p></blockquote>
  <div class="md-preview block" data-mdtext="table"><table><thead><tr><th>事项名称</th><th>状态</th><th>备注</th><th>更多信息</th><th>时间戳</th><th>长标题字段</th></tr></thead><tbody><tr><td style="white-space:nowrap">超宽内容abcdefghijklmnopqrst</td><td>进行中</td><td>常规说明</td><td>额外描述</td><td>2026-11-17</td><td>长标题内容</td></tr></tbody></table></div>
  <div class="md-preview block" data-mdtext="code"><pre><code>const longLine = "abcdefghijklmnopqrstuvwxyz0123456789".repeat(8);
function preview() { return longLine; }</code></pre></div>
  <div class="md-preview block" data-mdtext="callout"><aside class="callout callout-note"><div class="callout-header"><span class="callout-icon">i</span><span class="callout-title">Note · 长标题也可以在窄栏中自然换行</span></div><div class="callout-body">提示块使用与阅读态相同的语义底色和排版，链接 <a href="https://example.com">example.com</a> 与行内 <code>inline_code_long_token_123456789</code> 均保持在边界内。</div></aside></div>
  <div class="atomic" data-type="image"><img alt="独立图片" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div>
  <div class="atomic attachment" contenteditable="false"><img alt="附件图片" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div>
  <div class="atomic attachment" contenteditable="false"><div class="attachment-file"><span class="att-icon">📎</span><span class="att-name">A-very-long-document-filename-without-spaces-2026-archive.pdf</span><span class="att-hint">点击打开</span></div></div>
  <div class="atomic" data-type="gallery"><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px"><img alt="画廊一" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="><img alt="画廊二" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div></div>
  <div class="img-text-card"><div class="itc-img-wrap"><img alt="图文卡片" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div><div class="itc-text">图文说明长文本用于检查全文按钮区域的间距与换行表现。</div></div>
  <div class="img-text-row"><div class="itr-img"><img alt="横排图" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div><div class="itr-text">横排图文卡片的说明文本较长，检查图像比例、文字栏宽与跨栏后的高度。</div></div>
  <div class="atomic link-card-block"><div class="lkc-cover"><img alt="链接封面" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div><div class="lkc-body"><div class="lkc-title">链接卡标题：用于检查栏内标题层级与断行</div><div class="lkc-subtitle">副标题保持两行以内，不让长文本把卡片撑出栏宽。</div><div class="lkc-source"><span class="lkc-source-icon">↗</span><span class="lkc-source-dot"></span><span class="lkc-source-text">a-very-long-source-name.example/path/without/spaces</span></div></div></div>
  <div data-type="musicCard" style="padding:12px 16px;border-radius:999px;display:flex;align-items:center;gap:10px"><span>🎵</span><span>https://example.com/music/very/long/path/without/a/space/that/should/wrap/within/the/card</span></div>
</div></div></body></html>`;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const cases = [
    { name: '手机竖屏', width: 390, height: 844, columns: 1 },
    { name: '平板窄栏', width: 768, height: 900, columns: 2 },
    { name: '平板', width: 820, height: 1180, columns: 2 },
    { name: '桌面', width: 1440, height: 1000, columns: 2 },
    { name: '窄屏手机横屏', width: 844, height: 430, columns: 1 }
  ];
  const report = [];
  for (const item of cases) {
    await page.setViewportSize({ width: item.width, height: item.height });
    await page.setContent(html, { waitUntil: 'load' });
    const state = await page.evaluate(() => {
      const body = document.querySelector('.editor-body');
      const style = getComputedStyle(body);
      const todo = body.querySelector('[data-type="todo"]');
      const checkbox = todo.querySelector('.todo-checkbox');
      const link = body.querySelector('.link-card-block');
      const spread = document.querySelector('.editor-spread');
      const rect = el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right }; };
      const colGap = parseFloat(style.columnGap) || 0;
      const columnWidth = style.columnCount === '2' ? (body.clientWidth - colGap) / 2 : body.clientWidth;
      const table = body.querySelector('table');
      const pre = body.querySelector('pre');
      const media = [...body.querySelectorAll(':scope > .atomic[data-type="image"], :scope > .atomic[data-type="gallery"], :scope > .img-text-card, :scope > .img-text-row, :scope > .atomic.attachment:has(> img)')];
      const checkedText = body.querySelector('[data-type="todo"].is-checked .todo-text');
      return {
        columns: style.columnCount === '2' ? 2 : 1,
        columnGap: colGap,
        body: rect(body),
        columnWidth,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        todoHit: rect(checkbox),
        todoCircle: getComputedStyle(checkbox, '::before').width,
        checked: { color: getComputedStyle(checkedText).color, decoration: getComputedStyle(checkedText).textDecorationLine },
        link: { width: rect(link).width, span: getComputedStyle(link).columnSpan },
        mediaSpans: media.map(el => getComputedStyle(el).columnSpan),
        table: { overflowX: getComputedStyle(table).overflowX, width: rect(table).width, clientWidth: table.clientWidth, scrollWidth: table.scrollWidth },
        code: { overflowX: getComputedStyle(pre).overflowX, width: rect(pre).width, clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth },
        music: rect(body.querySelector('[data-type="musicCard"]')),
        spread: rect(spread)
      };
    });
    assert.equal(state.columns, item.columns, `${item.name}: 双栏状态错误 (${state.columns})`);
    assert.ok(state.pageWidth <= state.viewportWidth + 1, `${item.name}: 页面横向溢出 ${state.pageWidth}/${state.viewportWidth}`);
    assert.ok(state.todoHit.width >= 44 && state.todoHit.height >= 44, `${item.name}: 待办命中区小于44px`);
    assert.equal(state.todoCircle, '22px', `${item.name}: 待办可见圆圈不是22px`);
    assert.ok(state.checked.decoration.includes('line-through'), `${item.name}: 完成态待办缺少删除线`);
    assert.ok(state.link.width <= state.columnWidth + 1, `${item.name}: 链接卡超过栏宽`);
    assert.ok(['auto', 'scroll'].includes(state.table.overflowX), `${item.name}: 表格没有内部横滚规则`);
    assert.equal(state.code.overflowX, 'auto', `${item.name}: 代码块没有内部横滚规则`);
    if (item.columns === 2) {
      assert.ok(state.columnGap >= 28 && state.columnGap <= 52, `${item.name}: 栏间距不在舒适范围内 (${state.columnGap})`);
      assert.equal(state.mediaSpans.every(value => value === 'all'), true, `${item.name}: 媒体块未保持跨栏`);
      assert.ok(state.music.width <= state.body.width + 1, `${item.name}: 音乐卡超过正文宽度`);
      if (item.width <= 820) assert.ok(state.table.scrollWidth > state.table.clientWidth, `${item.name}: 多列 Markdown 表格未进入内部横滚`);
    }
    report.push({ name: item.name, columns: state.columns, columnWidth: Math.round(state.columnWidth), columnGap: Math.round(state.columnGap), noPageOverflow: true, todoHit: `${Math.round(state.todoHit.width)}x${Math.round(state.todoHit.height)}`, mediaSpans: state.mediaSpans.length, tableScroll: state.table.scrollWidth > state.table.clientWidth, codeScroll: state.code.scrollWidth > state.code.clientWidth });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
