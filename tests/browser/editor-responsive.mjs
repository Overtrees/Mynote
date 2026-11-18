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
const renderer = fs.readFileSync(path.join(ROOT, 'src/editor/editor.render.js'), 'utf8');
assert.doesNotMatch(`${css}\n${renderer}`, /corner-shape\s*:\s*squircle/i, '源码和内联渲染样式不能依赖设备支持不一致的 squircle 曲线');
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
  <div data-type="musicCard" data-music-url="pending" style="padding:12px 16px;border-radius:999px;display:flex;align-items:center;gap:10px"><span>🎵</span><span>https://example.com/music/very/long/path/without/a/space/that/should/wrap/within/the/card</span></div>
  <div class="link-card-skeleton" data-type="musicCard" data-url="https://music.apple.com/hk/album/long"><div class="link-card-skeleton-cover"></div></div>
  <div class="link-card-block music-card-error" data-type="musicCard" data-url="https://music.apple.com/hk/album/error"><span class="music-card-error-icon">🎵</span><a class="music-card-error-url" href="https://music.apple.com/hk/album/error">https://music.apple.com/hk/album/error</a><button class="music-card-retry">重试</button></div>
  <p data-layout-case="before">混排前正文保持一个完整片段，并在窄栏中自然换行。</p>
  <div class="atomic link-card-block" data-layout-case="card"><div class="lkc-body"><div class="lkc-title">混排中的链接卡片标题</div><div class="lkc-subtitle">正文—卡片—媒体—后续正文顺序回归。</div></div></div>
  <div class="img-text-card" data-layout-case="media"><div class="itc-img-wrap"><img alt="组合媒体" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div><div class="itc-text">媒体块跨栏后仍应完整，并保留后续文本的阅读顺序。</div></div>
  <p data-layout-case="after">混排后正文仍应位于媒体卡之后，不与前文或卡片重叠。</p>
  <div class="link-card-skeleton" data-layout-case="link-skeleton"><div class="link-card-skeleton-cover"></div><div class="link-card-skeleton-body"><div class="link-card-skeleton-line" style="width:75%"></div><div class="link-card-skeleton-line" style="width:50%"></div></div></div>
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
    await page.evaluate(() => {
      const body = document.querySelector('.editor-body');
      const longToken = 'LongCardTextWithoutSpaces0123456789'.repeat(16);
      const appendText = selector => { const node = body.querySelector(selector); if (node) node.textContent += longToken; };
      ['p', 'h1', 'blockquote p', '.todo-text', '.itc-text', '.itr-text', '.lkc-title', '.lkc-subtitle', '.music-card-error-url'].forEach(appendText);
      const source = body.querySelector('.lkc-source-text');
      if (source) source.textContent = longToken;
      const musicText = body.querySelector('[data-music-url="pending"] span:last-child');
      if (musicText) musicText.textContent = longToken + ' https://music.apple.com/hk/album/' + longToken;
      const toggle = document.createElement('button');
      toggle.className = 'editor-column-mode-toggle';
      toggle.style.display = 'flex';
      toggle.textContent = '双栏独立滚动';
      document.body.appendChild(toggle);
    });
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
      const columnModeToggle = document.querySelector('.editor-column-mode-toggle');
      const media = [...body.querySelectorAll(':scope > .atomic[data-type="image"], :scope > .atomic[data-type="gallery"], :scope > .img-text-card, :scope > .img-text-row, :scope > .atomic.attachment:has(> img)')];
      const checkedText = body.querySelector('[data-type="todo"].is-checked .todo-text');
      const musicSkeleton = body.querySelector('.link-card-skeleton[data-type="musicCard"]');
      const linkSkeleton = body.querySelector('.link-card-skeleton[data-layout-case="link-skeleton"]');
      const combo = ['before', 'card', 'media', 'after'].map(key => body.querySelector(`[data-layout-case="${key}"]`));
      const musicErrorUrl = body.querySelector('.music-card-error-url');
      const widthBoundCards = [...body.querySelectorAll('.atomic, .img-text-card, .img-text-row, .attachment-file, .link-card-block, .link-card-err, .link-card-skeleton, [data-music-url="pending"]')].map(el => ({ type: el.dataset.type || el.className, width: rect(el).width, parent: el.parentElement ? el.parentElement.clientWidth : 0 }));
      const wrappedTexts = [...body.querySelectorAll('p, h1, h2, blockquote, .todo-text, .itc-text, .itr-text, .lkc-title, .lkc-subtitle, .music-card-error-url, [data-music-url="pending"] span')].map(el => ({ className: el.className || el.tagName, client: el.clientWidth, scroll: el.scrollWidth }));
      return {
        columns: style.columnCount === '2' ? 2 : 1,
        toggleDisplay: getComputedStyle(columnModeToggle).display,
        columnGap: colGap,
        body: rect(body),
        columnWidth,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        todoHit: rect(checkbox),
        todoCircle: getComputedStyle(checkbox, '::before').width,
        checked: { color: getComputedStyle(checkedText).color, decoration: getComputedStyle(checkedText).textDecorationLine },
        link: { width: rect(link).width, span: getComputedStyle(link).columnSpan },
        buttonAppearance: getComputedStyle(columnModeToggle).appearance,
        combo: {
          order: combo.map(el => el.dataset.layoutCase),
          fragments: combo.map(el => el.getClientRects().length),
          breakInside: combo.map(el => getComputedStyle(el).breakInside),
          mediaSpan: getComputedStyle(combo[2]).columnSpan,
          mediaWidth: rect(combo[2]).width,
          skeleton: { present: !!linkSkeleton, animation: getComputedStyle(linkSkeleton.querySelector('.link-card-skeleton-cover'), '::after').animationName, breakInside: getComputedStyle(linkSkeleton).breakInside },
          musicCenterDelta: Math.abs((rect(musicSkeleton).left + rect(musicSkeleton).width / 2) - (rect(body).left + rect(body).width / 2)),
          markdownBreakInside: getComputedStyle(body.querySelector('.md-preview.block[data-mdtext="table"]')).breakInside
        },
        mediaSpans: media.map(el => getComputedStyle(el).columnSpan),
        table: { overflowX: getComputedStyle(table).overflowX, width: rect(table).width, clientWidth: table.clientWidth, scrollWidth: table.scrollWidth },
        code: { overflowX: getComputedStyle(pre).overflowX, width: rect(pre).width, clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth },
        music: rect(body.querySelector('[data-type="musicCard"]')),
        musicSkeleton: { ratio: rect(musicSkeleton).width / rect(musicSkeleton).height, radius: getComputedStyle(musicSkeleton).borderTopLeftRadius },
        musicError: { width: rect(musicErrorUrl).width, scrollWidth: musicErrorUrl.scrollWidth, retryVisible: !!body.querySelector('.music-card-error .music-card-retry') },
        widthBoundCards,
        wrappedTexts,
        spread: rect(spread)
      };
    });
    assert.equal(state.columns, item.columns, `${item.name}: 双栏状态错误 (${state.columns})`);
    assert.equal(state.toggleDisplay, item.columns === 2 ? 'flex' : 'none', `${item.name}: 独立模式按钮显示状态与双栏支持条件不符 (${state.toggleDisplay})`);
    assert.ok(state.pageWidth <= state.viewportWidth + 1, `${item.name}: 页面横向溢出 ${state.pageWidth}/${state.viewportWidth}`);
    assert.ok(state.todoHit.width >= 44 && state.todoHit.height >= 44, `${item.name}: 待办命中区小于44px`);
    assert.equal(state.todoCircle, '22px', `${item.name}: 待办可见圆圈不是22px`);
    assert.equal(state.buttonAppearance, 'none', `${item.name}: 自定义按钮仍保留设备原生外观`);
    assert.ok(state.checked.decoration.includes('line-through'), `${item.name}: 完成态待办缺少删除线`);
    assert.ok(state.link.width <= state.columnWidth + 1, `${item.name}: 链接卡超过栏宽`);
    assert.ok(state.widthBoundCards.every(card => card.width <= card.parent + 1), `${item.name}: 至少一张 atomic/媒体卡超出父级宽度 ${JSON.stringify(state.widthBoundCards)}`);
    assert.ok(state.wrappedTexts.every(text => text.scroll <= text.client + 1), `${item.name}: 长文本仍存在横向溢出 ${JSON.stringify(state.wrappedTexts.filter(text => text.scroll > text.client + 1))}`);
    assert.ok(Math.abs(state.musicSkeleton.ratio - 2.4) < 0.03, `${item.name}: 普通音乐加载骨架应保持横向比例 (${JSON.stringify(state.musicSkeleton)})`);
    assert.equal(state.musicSkeleton.radius, '26px', `${item.name}: 音乐加载骨架圆角不是26px`);
    assert.equal(state.combo.skeleton.present, true, `${item.name}: 普通链接骨架未被引用`);
    assert.equal(state.combo.skeleton.animation, 'mynoteSkeletonSpin', `${item.name}: 链接骨架旋转加载动画未生效`);
    assert.equal(state.combo.skeleton.breakInside, 'avoid', `${item.name}: 链接骨架允许在内容流中被拆分`);
    assert.ok(state.combo.musicCenterDelta <= 1, `${item.name}: 普通音乐加载骨架未水平居中 (${state.combo.musicCenterDelta}px)`);
    assert.ok(state.musicError.width <= item.width && state.musicError.scrollWidth <= state.musicError.width + 1 && state.musicError.retryVisible, `${item.name}: 长 URL 失败卡溢出或重试操作不可见 (${JSON.stringify(state.musicError)})`);
    assert.ok(['auto', 'scroll'].includes(state.table.overflowX), `${item.name}: 表格没有内部横滚规则`);
    assert.equal(state.code.overflowX, 'auto', `${item.name}: 代码块没有内部横滚规则`);
    if (item.columns === 2) {
      assert.ok(state.columnGap >= 28 && state.columnGap <= 52, `${item.name}: 栏间距不在舒适范围内 (${state.columnGap})`);
      assert.equal(state.mediaSpans.every(value => value === 'all'), true, `${item.name}: 媒体块未保持跨栏`);
      assert.deepEqual(state.combo.order, ['before', 'card', 'media', 'after'], `${item.name}: 混排内容 DOM 阅读顺序改变`);
      assert.ok(state.combo.fragments.every(count => count === 1), `${item.name}: 正文/卡片/媒体出现分片 ${JSON.stringify(state.combo.fragments)}`);
      assert.ok(state.combo.breakInside.every(value => value === 'avoid'), `${item.name}: 混排块未启用完整分页规则 ${JSON.stringify(state.combo.breakInside)}`);
      assert.equal(state.combo.mediaSpan, 'all', `${item.name}: 组合媒体卡未跨越两栏`);
      assert.ok(state.combo.mediaWidth >= state.body.width - 1, `${item.name}: 组合媒体卡没有占满书页宽度`);
      assert.equal(state.combo.markdownBreakInside, 'avoid', `${item.name}: Markdown 表格预览可能在两栏间拆开`);
      assert.ok(state.music.width <= state.body.width + 1, `${item.name}: 音乐卡超过正文宽度`);
      if (item.width <= 820) assert.ok(state.table.scrollWidth > state.table.clientWidth, `${item.name}: 多列 Markdown 表格未进入内部横滚`);
    }
    report.push({ name: item.name, columns: state.columns, toggleDisplay: state.toggleDisplay, columnWidth: Math.round(state.columnWidth), columnGap: Math.round(state.columnGap), noPageOverflow: true, todoHit: `${Math.round(state.todoHit.width)}x${Math.round(state.todoHit.height)}`, mediaSpans: state.mediaSpans.length, tableScroll: state.table.scrollWidth > state.table.clientWidth, codeScroll: state.code.scrollWidth > state.code.clientWidth });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent(html, { waitUntil: 'load' });
  const reducedMotionAnimation = await page.locator('.link-card-skeleton[data-layout-case="link-skeleton"] .link-card-skeleton-cover').evaluate(el => getComputedStyle(el, '::after').animationName);
  assert.equal(reducedMotionAnimation, 'none', '减少动态效果设置下骨架旋转动画必须关闭');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.addScriptTag({ path: path.join(ROOT, 'src/editor/editor.render.js') });
  const independent = await page.evaluate(() => {
    const body = document.querySelector('.editor-body');
    for (let i = 0; i < 36; i++) {
      const p = document.createElement('p');
      p.dataset.blockid = `independent-test-${i}`;
      p.textContent = `独立滚动压力段落 ${i}：${'长文本用于验证每一栏都能独立滚动，而不是整个正文一起移动。'.repeat(3)}`;
      body.appendChild(p);
    }
    const orderedIds = () => window.MynoteEditorColumns.getBlocks(body).map(el => el.dataset.blockid || '');
    const before = orderedIds();
    window.MynoteEditorColumns.setIndependentScroll(body, true);
    const columns = [...body.querySelectorAll(':scope > .editor-column')];
    const left = columns[0], right = columns[1];
    const editInColumn = (column, marker) => {
      const target = column.querySelector('p');
      const text = target && target.firstChild;
      if (!target || !text || text.nodeType !== 3) return false;
      window.MynoteEditorColumns.focusEditingHost(body, target);
      const range = document.createRange();
      range.setStart(text, text.length);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand('insertText', false, marker);
    };
    const leftEdit = editInColumn(left, ' LEFT_HOST_EDIT');
    const rightEdit = editInColumn(right, ' RIGHT_HOST_EDIT');
    left.scrollTop = 48;
    const scrollIndependence = left.scrollTop > 0 && right.scrollTop === 0;
    const state = {
      count: columns.length,
      display: getComputedStyle(body).display,
      columnDisplay: columns.map(column => getComputedStyle(column).display),
      editorHosts: { body: body.contentEditable, columns: columns.map(column => column.contentEditable) },
      separateEditing: leftEdit && rightEdit && left.textContent.includes('LEFT_HOST_EDIT') && right.textContent.includes('RIGHT_HOST_EDIT'),
      overflows: columns.map(column => column.scrollHeight > column.clientHeight),
      scrollIndependence,
      noHorizontalPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      skeletonInIndependentColumn: !!body.querySelector('.link-card-skeleton[data-layout-case="link-skeleton"]')?.closest('.editor-column'),
      skeletonAnimation: getComputedStyle(body.querySelector('.link-card-skeleton[data-layout-case="link-skeleton"] .link-card-skeleton-cover'), '::after').animationName,
      orderPreserved: JSON.stringify(orderedIds()) === JSON.stringify(before),
      parsedOrderPreserved: JSON.stringify(window.MynoteEditor.parseEditorDOM(body).map(node => node.id || '')) === JSON.stringify(before),
      firstLast: [orderedIds()[0], orderedIds().at(-1)]
    };
    window.MynoteEditorColumns.flatten(body);
    state.flattened = !body.classList.contains('is-independent-scroll') && !body.querySelector(':scope > .editor-column');
    state.flattenedOrderPreserved = JSON.stringify([...body.children].map(el => el.dataset.blockid || '')) === JSON.stringify(before);
    return state;
  });
  assert.equal(independent.count, 2, '独立模式应建立两个滚动容器');
  assert.equal(independent.display, 'grid', '独立模式应以双列网格承载两栏');
  assert.deepEqual(independent.columnDisplay, ['block', 'block'], '桌面列容器应为独立块级滚动区');
  assert.deepEqual(independent.editorHosts, { body: 'false', columns: ['true', 'true'] }, '外层正文不可编辑且两栏各自是编辑宿主');
  assert.equal(independent.separateEditing, true, '键盘输入应分别写入左右列自己的编辑宿主');
  assert.deepEqual(independent.overflows, [true, true], '左右两栏都应拥有自己的垂直溢出');
  assert.equal(independent.scrollIndependence, true, '滚动左栏不能带动右栏');
  assert.equal(independent.noHorizontalPageOverflow, true, '独立列不能造成页面横向溢出');
  assert.equal(independent.skeletonInIndependentColumn, true, '链接骨架必须保留在独立列内');
  assert.equal(independent.skeletonAnimation, 'mynoteSkeletonSpin', '独立双栏中的骨架旋转加载动画未生效');
  assert.equal(independent.orderPreserved, true, '包装成两栏后笔记块顺序必须保持');
  assert.equal(independent.parsedOrderPreserved, true, '解析保存时必须按左右列顺序还原原始笔记块');
  assert.equal(independent.flattened, true, '关闭模式后列包装应被移除');
  assert.equal(independent.flattenedOrderPreserved, true, '关闭模式后线性 DOM 顺序应恢复');

  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => { window.DOMPurify = { sanitize: value => value }; });
  await page.addScriptTag({ path: path.join(ROOT, 'src/editor/editor.render.js') });
  const layoutRoundTrip = await page.evaluate(() => {
    const body = document.querySelector('.editor-body');
    const doc = [
      { id: 'persist-p0', type: 'paragraph', children: [{ text: '左栏短正文' }] },
      { id: 'persist-h1', type: 'heading', attrs: { level: 2 }, children: [{ text: '左栏标题' }] },
      { id: 'persist-music', type: 'musicCard', url: 'https://open.spotify.com/track/layout', status: 'ready', meta: { title: '左栏音乐卡', source: '测试' } },
      { id: 'persist-todo', type: 'todo', attrs: { checked: false }, children: [{ text: '左栏待办' }] },
      ...Array.from({ length: 16 }, (_, index) => ({ id: `persist-right-${index}`, type: 'paragraph', children: [{ text: `右栏长正文 ${index}：${'高度变化不应重新切分列成员。'.repeat(12)}` }] }))
    ];
    const ids = doc.map(node => node.id);
    const requested = { version: 1, mode: 'independent', left: ids.slice(0, 4), right: ids.slice(4) };
    const members = () => [...body.querySelectorAll(':scope > .editor-column')].map(column => [...column.children].map(block => block.dataset.blockid));
    window.MynoteEditor.setEditorDocRef(doc);
    body.innerHTML = window.MynoteEditor.renderDocToEditorHTML(doc);
    const firstApplied = window.MynoteEditorColumns.setIndependentScroll(body, true, requested);
    const firstMembers = members();
    const rightParagraph = body.querySelector('.editor-column[data-editor-column="right"] p');
    rightParagraph.textContent += ' '.repeat(1800);
    const parsedAfterEdit = window.MynoteEditor.parseEditorDOM(body);
    const savedLayout = window.MynoteEditorColumns.captureLayout(body, parsedAfterEdit, 'independent', firstApplied);
    body.innerHTML = window.MynoteEditor.renderDocToEditorHTML(parsedAfterEdit);
    window.MynoteEditor.setEditorDocRef(parsedAfterEdit);
    window.MynoteEditorColumns.setIndependentScroll(body, true, savedLayout);
    const reopenedMembers = members();
    const left = body.querySelector('.editor-column[data-editor-column="left"]');
    const inserted = document.createElement('p');
    inserted.dataset.blockid = 'persist-inserted-left';
    inserted.textContent = '插入在左栏';
    left.appendChild(inserted);
    const afterInsert = window.MynoteEditor.parseEditorDOM(body);
    const afterInsertLayout = window.MynoteEditorColumns.captureLayout(body, afterInsert, 'independent', savedLayout);
    body.innerHTML = window.MynoteEditor.renderDocToEditorHTML(afterInsert);
    window.MynoteEditor.setEditorDocRef(afterInsert);
    window.MynoteEditorColumns.setIndependentScroll(body, true, afterInsertLayout);
    const afterInsertMembers = members();
    window.MynoteEditorColumns.focusEditingHost(body, body.querySelector('.editor-column[data-editor-column="left"] p'));
    return {
      firstMembers,
      reopenedMembers,
      afterInsertMembers,
      expectedLeft: ids.slice(0, 4),
      expectedRight: ids.slice(4),
      parsedOrder: window.MynoteEditor.parseEditorDOM(body).map(node => node.id),
      preferredHostIsLeft: window.MynoteEditorColumns.getPreferredEditingHost(body) === body.querySelector('.editor-column[data-editor-column="left"]'),
      layoutMode: afterInsertLayout.mode
    };
  });
  assert.deepEqual(layoutRoundTrip.firstMembers[0], layoutRoundTrip.expectedLeft, '初始独立列成员应严格按显式映射建立');
  assert.deepEqual(layoutRoundTrip.firstMembers[1], layoutRoundTrip.expectedRight, '右列成员不得受高度影响');
  assert.deepEqual(layoutRoundTrip.reopenedMembers, layoutRoundTrip.firstMembers, '保存并模拟首页重开后列成员不得漂移');
  assert.deepEqual(layoutRoundTrip.afterInsertMembers[0], [...layoutRoundTrip.expectedLeft, 'persist-inserted-left'], '左列插入的新块应留在左列');
  assert.deepEqual(layoutRoundTrip.afterInsertMembers[1], layoutRoundTrip.expectedRight, '左列插入不应挤动右列成员');
  assert.deepEqual(layoutRoundTrip.parsedOrder, [...layoutRoundTrip.expectedLeft, 'persist-inserted-left', ...layoutRoundTrip.expectedRight], '解析/保存顺序应保持左栏后右栏');
  assert.equal(layoutRoundTrip.preferredHostIsLeft, true, '无选区插入兜底应优先最近编辑列');
  assert.equal(layoutRoundTrip.layoutMode, 'independent', '布局模式应继续保持独立编辑');

  await page.setViewportSize({ width: 844, height: 430 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.addScriptTag({ path: path.join(ROOT, 'src/editor/editor.render.js') });
  const narrowFallback = await page.evaluate(() => {
    const body = document.querySelector('.editor-body');
    window.MynoteEditorColumns.setIndependentScroll(body, true);
    const column = body.querySelector(':scope > .editor-column');
    return { display: getComputedStyle(column).display, columns: getComputedStyle(body).columnCount };
  });
  assert.equal(narrowFallback.display, 'contents', '窄屏横屏不能留下两个互相挤压的滚动窗格');
  assert.equal(narrowFallback.columns, '1', '窄屏手机横屏仍应回退为单栏');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
