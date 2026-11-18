#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', args: ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'] });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/Moment.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.list-item', { timeout: 30000 });
  await page.waitForTimeout(400); // Ignore the app's initial slide-in transform during overflow measurements.
  const markdownPipeline = await page.evaluate(() => {
    const code = "const literal = '~~strike~~ ==highlight== !!idea ??question @@name :smile: #tag $blue:x$ ->center<-';";
    const source = '```js\n' + code + '\n```\n\n~~~txt\n' + code + '\n~~~\n\nInline: `' + code + '`';
    const host = document.createElement('div');
    host.innerHTML = window.MynoteMd.renderMarkdownHtml(source);
    const codeNodes = [...host.querySelectorAll('pre code, p code')];
    const calloutHost = document.createElement('div');
    calloutHost.innerHTML = window.MynoteMd.renderMarkdownHtml('> [!NOTE]\n> **粗体文字** 与 [安全链接](https://example.com)\n> - 列表一\n> - 列表二');
    const callout = calloutHost.querySelector('.callout');
    const codeCalloutHost = document.createElement('div');
    codeCalloutHost.innerHTML = window.MynoteMd.renderMarkdownHtml('> [!TIP]\n> ```js\n> const nested = \'~~keep~~ ==keep==\';\n> ```');
    const extensionHost = document.createElement('div');
    extensionHost.innerHTML = window.MynoteMd.renderMarkdownHtml('> [!TIP]- 自定义标题\n> 正文 **粗体**\n\n行内 $x^2$ 与块公式：\n\n$$\n\\frac{1}{2}\n$$\n\n[[目标笔记|显示文字]]\n\n脚注引用[^note]\n\n[^note]: 脚注内容\n\n上^(高1)^ 下~(低1)~，旧标签 $blue:标签$，短码 :smile:，链接 [网址](https://example.com/$blue:keep$)');
    const hostileHost = document.createElement('div');
    hostileHost.innerHTML = window.MynoteMd.renderMarkdownHtml('<img src="x" onerror="window.__mynoteXss=1"><script>window.__mynoteXss=2</script>');
    const disabledSyntax = '!!提示 ??问题 @@提及 #标签 $标签$ $blue:标签$ ->居中<- ---装饰线---';
    const disabledHost = document.createElement('div');
    disabledHost.innerHTML = window.MynoteMd.renderMarkdownHtml(disabledSyntax);
    const wiki = extensionHost.querySelector('.mynote-wiki-link');
    const footnoteRef = extensionHost.querySelector('.footnote-ref a');
    const footnoteTarget = extensionHost.querySelector('.footnotes li');
    const customCallout = extensionHost.querySelector('details.callout');
    return {
      codeCount: codeNodes.length,
      codeText: codeNodes.map(node => node.textContent),
      codeMarkup: codeNodes.map(node => node.innerHTML),
      calloutBody: callout?.querySelector('.callout-body')?.innerHTML || '',
      calloutStrong: !!callout?.querySelector('.callout-body strong'),
      calloutLink: callout?.querySelector('.callout-body a')?.getAttribute('href') || '',
      calloutItems: callout?.querySelectorAll('.callout-body li').length || 0,
      calloutFence: codeCalloutHost.querySelector('.callout-body pre code')?.textContent || '',
      customCallout: !!customCallout,
      customCalloutTitle: customCallout?.querySelector('.callout-title')?.textContent || '',
      customCalloutBodyStrong: !!customCallout?.querySelector('.callout-body strong'),
      inlineMath: !!extensionHost.querySelector('.math-inline .katex'),
      displayMath: !!extensionHost.querySelector('.math-block .katex-display'),
      wiki: wiki ? [wiki.textContent, wiki.getAttribute('data-note-title')] : null,
      markdownUrl: extensionHost.querySelector('a[href^="https://example.com/"]')?.getAttribute('href') || '',
      footnote: !!footnoteRef && !!footnoteTarget && footnoteRef.getAttribute('href') === '#' + footnoteTarget.id && !!footnoteTarget.querySelector('.footnote-backref'),
      superscript: [...extensionHost.querySelectorAll('sup')].find(node => node.textContent === '高1')?.textContent || '',
      subscript: extensionHost.querySelector('sub')?.textContent || '',
      disabledSyntaxText: disabledHost.textContent.trim(),
      disabledSyntaxStyles: disabledHost.querySelectorAll('.mynote-color-tag, .mynote-tag, .mynote-align-center, .mynote-inline-note, .mynote-inline-question, .mynote-inline-person, .mynote-decorative-divider').length,
      shortcodeText: extensionHost.textContent.includes(':smile:'),
      hostileMarkupRemoved: !hostileHost.querySelector('script, img[onerror]')
    };
  });
  const expectedCode = "const literal = '~~strike~~ ==highlight== !!idea ??question @@name :smile: #tag $blue:x$ ->center<-';";
  check('反引号/波浪号围栏与行内代码中的扩展标记逐字保留', markdownPipeline.codeCount === 3 && markdownPipeline.codeText[0] === expectedCode + '\n' && markdownPipeline.codeText[1] === expectedCode + '\n' && markdownPipeline.codeText[2] === expectedCode && markdownPipeline.codeMarkup.every(markup => !/<(?:del|span|svg)\b/i.test(markup)), JSON.stringify(markdownPipeline.codeText));
  check('提示块正文继续解析加粗、链接与 Markdown 列表', markdownPipeline.calloutStrong && markdownPipeline.calloutLink === 'https://example.com' && markdownPipeline.calloutItems === 2, markdownPipeline.calloutBody.replace(/\s+/g, ' ').slice(0, 180));
  check('提示块内部围栏代码保留扩展标记字面量', markdownPipeline.calloutFence === "const nested = '~~keep~~ ==keep==';\n", JSON.stringify(markdownPipeline.calloutFence));
  check('可折叠提示块支持自定义标题且正文继续解析 Markdown', markdownPipeline.customCallout && markdownPipeline.customCalloutTitle === '自定义标题' && markdownPipeline.customCalloutBodyStrong, JSON.stringify(markdownPipeline.customCallout));
  check('KaTeX 本地渲染行内与块级公式', markdownPipeline.inlineMath && markdownPipeline.displayMath, JSON.stringify({ inline: markdownPipeline.inlineMath, display: markdownPipeline.displayMath }));
  check('双链保留目标笔记名与自定义显示文字', JSON.stringify(markdownPipeline.wiki) === JSON.stringify(['显示文字', '目标笔记']), JSON.stringify(markdownPipeline.wiki));
  check('Markdown 链接目标内的旧标签符号保持原样', markdownPipeline.markdownUrl === 'https://example.com/$blue:keep$', markdownPipeline.markdownUrl);
  check('脚注引用与返回链接 ID 对应', markdownPipeline.footnote, JSON.stringify(markdownPipeline.footnote));
  check('上标与下标扩展仍可渲染', markdownPipeline.superscript === '高1' && markdownPipeline.subscript === '低1', JSON.stringify({ sup: markdownPipeline.superscript, sub: markdownPipeline.subscript }));
  check('停用的自定义标记按原文显示且没有旧装饰节点', markdownPipeline.disabledSyntaxText === '!!提示 ??问题 @@提及 #标签 $标签$ $blue:标签$ ->居中<- ---装饰线---' && markdownPipeline.disabledSyntaxStyles === 0, JSON.stringify({ text: markdownPipeline.disabledSyntaxText, styled: markdownPipeline.disabledSyntaxStyles }));
  check('emoji 短码作为原文保留，恶意 HTML 属性与脚本被清理', markdownPipeline.shortcodeText && markdownPipeline.hostileMarkupRemoved, JSON.stringify({ shortcode: markdownPipeline.shortcodeText, sanitized: markdownPipeline.hostileMarkupRemoved }));
  const resultsByTheme = {};
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      resultsByTheme[width + ':' + scheme] = await page.evaluate(() => {
        document.querySelectorAll('.visual-fixture').forEach(e => e.remove());
        const make = (cls, html) => { const el = document.createElement('div'); el.className = cls + ' visual-fixture'; el.innerHTML = html; document.body.appendChild(el); return el; };
        const calloutHtml = ['NOTE','WARNING','TIP','IMPORTANT','CAUTION'].map(type => window.MynoteMd.renderMarkdownHtml(`> [!${type}]\n> 提示 <a href=\"#\">链接</a> <code>code</code>`)).join('');
        const markdown = '<h1>标题一</h1><h2>标题二</h2><h3>标题三</h3><h4>标题四</h4><p>正文 <a href="#">正文链接</a> <code><a href="#">代码底链接</a></code></p><blockquote>引用样式</blockquote>' + calloutHtml + '<ul class="task-list"><li class="task-list-item"><input type="checkbox" disabled>预览任务项</li></ul><table><thead><tr><th>表头</th></tr></thead><tbody><tr>' + Array.from({length: 8}, (_, i) => '<td style="white-space:nowrap">列' + i + '不换行长内容abcdefghijklmno</td>').join('') + '</tr></tbody></table><pre><code>' + 'const longLine = "'.padEnd(700, 'x') + '";</code></pre>';
        const preview = make('markdown-render', markdown);
        preview.style.backgroundColor = 'var(--card-bg)';
        const editor = make('editor-body', '<h1>标题一</h1><h2>标题二</h2><h3>标题三</h3><h4>标题四</h4><p>正文 <a href="#">编辑态链接</a></p><blockquote>引用样式</blockquote><div data-type="todo" class="editor-todo"><input class="todo-checkbox" type="checkbox" contenteditable="false" aria-label="任务" aria-checked="false"><span class="todo-text">任务</span></div>');
        editor.style.backgroundColor = 'var(--card-bg)';
        let readingLayout = null;
        if (window.innerWidth >= 900) {
          const reading = make('editor-body', '<p>桌面文字阅读宽度测量</p><div class="img-text-card" data-type="imgTextCard"><div class="itc-img-wrap">图片</div><div class="itc-text">说明</div></div><a class="link-card-block music-card-link" href="#"><div class="lkc-cover"></div><div class="lkc-body">音乐</div></a>');
          reading.style.cssText = 'width:100%;padding:0;margin:0;';
          const bodyRect = reading.getBoundingClientRect();
          const textRect = reading.querySelector('p').getBoundingClientRect();
          const imageRect = reading.querySelector('.img-text-card').getBoundingClientRect();
          const musicRect = reading.querySelector('.music-card-link').getBoundingClientRect();
          readingLayout = { bodyWidth: bodyRect.width, bodyCenter: bodyRect.left + bodyRect.width / 2, textWidth: textRect.width, textCenter: textRect.left + textRect.width / 2, imageWidth: imageRect.width, musicWidth: musicRect.width };
        }
        const style = (el, prop) => getComputedStyle(el)[prop];
        const ratio = (fg, bg) => { const rgb = c => c.match(/[\d.]+/g).slice(0,3).map(Number).map(v => {v/=255; return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}); const a=rgb(fg),b=rgb(bg), lum=x=>.2126*x[0]+.7152*x[1]+.0722*x[2]; const l1=lum(a),l2=lum(b); return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05); };
        const link = preview.querySelector('p a'), codeLink=preview.querySelector('code a'), code=preview.querySelector('code'), table=preview.querySelector('table'), pre=preview.querySelector('pre'), task=editor.querySelector('[data-type="todo"]'), checkbox=editor.querySelector('input.todo-checkbox'), editorLink=editor.querySelector('p a'), previewTask=preview.querySelector('.task-list-item'), previewCheckbox=previewTask.querySelector('input[type=checkbox]');
        const baseBg = style(preview, 'backgroundColor');
        const composite = (top, bottom) => { const c = v => { const a=v.match(/[\d.]+/g).map(Number); return {rgb:a.slice(0,3),alpha:a.length>3?a[3]:1}; }; const t=c(top), b=c(bottom); return 'rgb(' + t.rgb.map((v,i)=>Math.round(v*t.alpha+b.rgb[i]*(1-t.alpha))).join(',') + ')'; };
        editorLink.focus({ focusVisible: true });
        const editorLinkFocus = [style(editorLink,'textDecorationLine'), style(editorLink,'outlineStyle'), style(editorLink,'outlineWidth')];
        checkbox.focus({ focusVisible: true });
        const previewCheckboxIcon = getComputedStyle(previewCheckbox, '::before');
        const previewTaskTouch = [parseFloat(style(previewTask,'minHeight')), parseFloat(style(previewCheckbox,'width')), parseFloat(style(previewCheckbox,'height')), parseFloat(previewCheckboxIcon.width), parseFloat(previewCheckboxIcon.height)];
        return {
          headings: ['h1','h2','h3','h4'].map(tag => [style(preview.querySelector(tag),'fontSize'), style(editor.querySelector(tag),'fontSize')]),
          linkContrast: ratio(style(link,'color'), baseBg),
          codeLinkContrast: ratio(style(codeLink,'color'), style(code,'backgroundColor')),
          calloutLinkContrast: [...preview.querySelectorAll('.callout')].map(box => { const surface=composite(style(box,'backgroundColor'),baseBg); return [box.className,ratio(style(box.querySelector('a'),'color'),surface)]; }),
          calloutCodeContrast: [...preview.querySelectorAll('.callout')].map(box => { const surface=composite(style(box,'backgroundColor'),baseBg); const codeBg=composite(style(box.querySelector('code'),'backgroundColor'),surface); return [box.className,ratio(style(box.querySelector('code'),'color'),codeBg)]; }),
          calloutIconContrast: [...preview.querySelectorAll('.callout')].map(box => { const surface=composite(style(box,'backgroundColor'),baseBg); const stroke=getComputedStyle(box.querySelector('.callout-icon svg')).stroke; return [box.className,ratio(stroke,surface)]; }),
          quoteContrast: ratio(style(preview.querySelector('blockquote'),'color'), composite(style(preview.querySelector('blockquote'),'backgroundColor'),baseBg)),
          tableHeaderContrast: ratio(style(table.querySelector('th'),'color'), baseBg),
          editorLinkFocus, previewTaskTouch, readingLayout,
          quoteRadius: style(preview.querySelector('blockquote'),'borderRadius'), calloutRadius: style(preview.querySelector('.callout'),'borderRadius'),
          table: { client: table.clientWidth, scroll: table.scrollWidth, max: style(table,'maxWidth'), overflow: style(table,'overflowX') },
          pre: { client: pre.clientWidth, scroll: pre.scrollWidth, overflow: style(pre,'overflowX') },
          viewport: window.innerWidth, page: { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
          taskMinHeight: style(task,'minHeight'), checkboxWidth: style(checkbox,'width'), checkboxHeight: style(checkbox,'height'), checkboxOutline: style(checkbox,'outlineStyle'), checkboxOutlineWidth: style(checkbox,'outlineWidth'), checkboxType: checkbox.type, checkboxAria: checkbox.getAttribute('aria-checked')
        };
      });
      await page.screenshot({ path: `/tmp/mynote-markdown-${width}-${scheme}.png` });
    }
  }
  for (const width of [360,390,1280]) for (const scheme of ['light','dark']) {
    const r=resultsByTheme[width + ':' + scheme];
    check(`${width}px ${scheme} 预览/编辑标题字阶一致`, r.headings.every(([a,b])=>a===b), JSON.stringify(r.headings));
    check(`${width}px ${scheme} 正文/代码底及提示块链接对比度 ≥4.5:1`, r.linkContrast>=4.5 && r.codeLinkContrast>=4.5 && r.calloutLinkContrast.every(([,v])=>v>=4.5), `正文 ${r.linkContrast.toFixed(2)}:1；代码 ${r.codeLinkContrast.toFixed(2)}:1；提示 ${JSON.stringify(r.calloutLinkContrast.map(([n,v])=>[n.split(' ').at(-1),v.toFixed(2)]))}`);
    check(`${width}px ${scheme} 提示块内联代码对比度 ≥4.5:1`, r.calloutCodeContrast.every(([,v])=>v>=4.5), JSON.stringify(r.calloutCodeContrast.map(([n,v])=>[n.split(' ').at(-1),v.toFixed(2)])));
    check(`${width}px ${scheme} 提示图标对比度 ≥3:1`, r.calloutIconContrast.every(([,v])=>v>=3), JSON.stringify(r.calloutIconContrast.map(([n,v])=>[n.split(' ').at(-1),v.toFixed(2)])));
    check(`${width}px ${scheme} 引用与表头辅助文字对比度 ≥4.5:1`, r.quoteContrast>=4.5 && r.tableHeaderContrast>=4.5, `引用 ${r.quoteContrast.toFixed(2)}:1；表头 ${r.tableHeaderContrast.toFixed(2)}:1`);
    check(`${width}px ${scheme} 编辑态链接有下划线和可见键盘焦点`, r.editorLinkFocus[0].includes('underline') && r.editorLinkFocus[1]==='solid' && parseFloat(r.editorLinkFocus[2])>=3, JSON.stringify(r.editorLinkFocus));
    check(`${width}px ${scheme} 宽表格与代码块可内部滚动`, r.table.client<=width && r.table.scroll>=r.table.client && r.table.overflow==='auto' && r.pre.scroll>r.pre.client && r.pre.overflow==='auto' && r.page.scroll<=r.page.client+1, JSON.stringify({table:r.table,pre:r.pre,page:r.page}));
    check(`${width}px ${scheme} 编辑态待办复选框与键盘焦点可见`, r.checkboxType==='checkbox' && r.checkboxAria==='false' && parseFloat(r.checkboxWidth)>=44 && parseFloat(r.checkboxHeight)>=44 && r.checkboxOutline==='solid' && parseFloat(r.checkboxOutlineWidth)>=3, JSON.stringify({type:r.checkboxType,aria:r.checkboxAria,width:r.checkboxWidth,height:r.checkboxHeight,outline:r.checkboxOutline,outlineWidth:r.checkboxOutlineWidth}));
    check(`${width}px ${scheme} 预览任务项与复选框触控区不小于44px且圆形图标保持22px`, r.previewTaskTouch[0]>=44 && r.previewTaskTouch[1]>=44 && r.previewTaskTouch[2]>=44 && r.previewTaskTouch[3]===22 && r.previewTaskTouch[4]===22, JSON.stringify(r.previewTaskTouch));
    check(`${width}px ${scheme} 引用与提示块使用非胶囊圆角`, parseFloat(r.quoteRadius)<50 && parseFloat(r.calloutRadius)<50, `引用 ${r.quoteRadius}；提示 ${r.calloutRadius}`);
    if (width >= 900) check('桌面普通文字居中限宽，图文卡与音乐卡保持全宽', r.readingLayout.textWidth < r.readingLayout.bodyWidth && Math.abs(r.readingLayout.textCenter-r.readingLayout.bodyCenter)<=1 && r.readingLayout.imageWidth >= r.readingLayout.bodyWidth-2 && r.readingLayout.musicWidth >= r.readingLayout.bodyWidth-2, JSON.stringify(r.readingLayout));
  }
  check('桌面和手机宽度均不横向撑开页面', [resultsByTheme['360:light'],resultsByTheme['390:light'],resultsByTheme['1280:light']].every(r=>r.page.scroll<=r.page.client+1), '360px、390px 与 1280px');
  const wikiContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const wikiOrigin = `http://127.0.0.1:${port}`;
  const wikiMemos = [
    { id: 'wiki-source', title: '来源笔记', doc: [
      { id: 'wiki-source-callout', type: 'paragraph', children: [{ text: '> [!TIP]- 可折叠\n> 提示正文。' }] },
      { id: 'wiki-source-p', type: 'paragraph', children: [{ text: '参考 [[目标笔记|打开目标]]，之后 [[新建笔记]]。' }] }
    ] },
    { id: 'wiki-target', title: '目标笔记', doc: [{ id: 'wiki-target-p', type: 'paragraph', children: [{ text: '目标正文。' }] }] }
  ];
  await wikiContext.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== wikiOrigin) return route.abort();
    return route.continue();
  });
  const wikiPage = await wikiContext.newPage();
  await wikiPage.goto(`${wikiOrigin}/Moment.html`, { waitUntil: 'domcontentloaded' });
  await wikiPage.waitForSelector('.list-item', { timeout: 30000 });
  await wikiPage.evaluate(async memos => {
    const storage = window.MynoteIdb;
    if (!storage?.getDB || !storage?.saveMemosToDB) throw new Error('MynoteIdb test API is unavailable');
    const db = await storage.getDB();
    await storage.saveMemosToDB(db, memos);
    localStorage.setItem('memos_app_v2', JSON.stringify(memos));
  }, wikiMemos);
  await wikiPage.reload({ waitUntil: 'domcontentloaded' });
  await wikiPage.waitForSelector('.list-item', { timeout: 30000 });
  await wikiPage.locator('.list-item').filter({ hasText: '来源笔记' }).first().click();
  await wikiPage.waitForFunction(() => document.querySelector('.editor-title-input')?.textContent.trim() === '来源笔记', null, { timeout: 15000 });
  await wikiPage.waitForTimeout(400);
  await wikiPage.evaluate(() => { document.body.style.minHeight = '1400px'; window.scrollTo(0, 120); });
  await wikiPage.waitForTimeout(100);
  await wikiPage.setViewportSize({ width: 240, height: 640 });
  await wikiPage.waitForTimeout(80);
  const narrowTitleDock = await wikiPage.evaluate(() => {
    const dock = document.querySelector('.editor-title-dock');
    const avatar = dock.querySelector('.editor-avatar-button').getBoundingClientRect();
    const input = dock.querySelector('.editor-title-input');
    const capsule = input.parentElement.parentElement.getBoundingClientRect();
    const left = document.querySelector('.editor-fab.left').getBoundingClientRect();
    const right = document.querySelector('.editor-fab.right').getBoundingClientRect();
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return { direction: getComputedStyle(dock).flexDirection, wrap: getComputedStyle(dock).flexWrap, avatar, capsule, left, right, avatarCapsuleOverlap: overlap(avatar, capsule), leftOverlap: overlap(left, avatar) || overlap(left, capsule), rightOverlap: overlap(right, avatar) || overlap(right, capsule), inside: [avatar, capsule, left, right].every(r => r.left >= -0.5 && r.right <= innerWidth + 0.5) };
  });
  check('240px 极窄视口标题头像与两侧按钮不重叠且内容留在屏内', narrowTitleDock.direction === 'row' && narrowTitleDock.wrap === 'wrap' && !narrowTitleDock.avatarCapsuleOverlap && !narrowTitleDock.leftOverlap && !narrowTitleDock.rightOverlap && narrowTitleDock.inside, JSON.stringify(narrowTitleDock));
  await wikiPage.setViewportSize({ width: 390, height: 844 });
  await wikiPage.evaluate(() => { document.body.style.minHeight = ''; window.scrollTo(0, 0); });
  await wikiPage.waitForTimeout(100);
  await wikiPage.evaluate(() => { document.body.style.minHeight = '1400px'; window.scrollTo(0, 120); document.querySelector('.editor-body').focus(); });
  await wikiPage.waitForTimeout(80);
  await wikiPage.locator('.editor-title-input').click();
  await wikiPage.waitForTimeout(100);
  const titleFocusTransfer = await wikiPage.evaluate(() => ({ focused: document.activeElement === document.querySelector('.editor-title-input'), scrollY: window.scrollY, direction: getComputedStyle(document.querySelector('.editor-title-dock')).flexDirection }));
  check('正文切换焦点到标题时不误滚顶或重排标题栏', titleFocusTransfer.focused && titleFocusTransfer.scrollY >= 60 && titleFocusTransfer.direction === 'row', JSON.stringify(titleFocusTransfer));
  await wikiPage.locator('.editor-title-input').evaluate(el => el.blur());
  await wikiPage.evaluate(() => { document.body.style.minHeight = ''; window.scrollTo(0, 0); });
  const calloutSummary = wikiPage.locator('.callout-collapsible > summary');
  await calloutSummary.waitFor({ state: 'visible', timeout: 15000 });
  await calloutSummary.click();
  await wikiPage.waitForFunction(() => document.querySelector('.callout-collapsible')?.open === true, null, { timeout: 5000 });
  check('可折叠提示块的标题点击保持 Markdown 预览并切换展开状态', await wikiPage.locator('.md-preview.block').count() > 0, 'details 已展开');
  const editedSourceTitle = '来源笔记-保存验证';
  await wikiPage.locator('.editor-title-input').fill(editedSourceTitle);
  await wikiPage.waitForSelector('a.mynote-wiki-link[data-note-title="目标笔记"]', { timeout: 15000 });
  await wikiPage.locator('a.mynote-wiki-link[data-note-title="目标笔记"]').click();
  await wikiPage.waitForFunction(() => document.querySelector('.editor-title-input')?.textContent.trim() === '目标笔记', null, { timeout: 15000 });
  const persistedSource = await wikiPage.evaluate(() => JSON.parse(localStorage.getItem('memos_app_v2') || '[]').find(memo => memo.id === 'wiki-source'));
  check('双链导航前即时保存当前笔记的未提交标题', persistedSource?.title === editedSourceTitle, persistedSource?.title || '未找到来源笔记');
  const backlink = wikiPage.locator('.wiki-backlink').filter({ hasText: editedSourceTitle });
  await backlink.waitFor({ state: 'visible', timeout: 15000 });
  check('双链点击打开已存在的同名笔记，并在目标笔记展示反向链接', await backlink.count() === 1, '目标：目标笔记；来源：' + editedSourceTitle);
  await backlink.click();
  await wikiPage.waitForFunction(title => document.querySelector('.editor-title-input')?.textContent.trim() === title, editedSourceTitle, { timeout: 15000 });
  await wikiPage.locator('a.mynote-wiki-link[data-note-title="新建笔记"]').click();
  await wikiPage.waitForFunction(() => document.querySelector('.editor-title-input')?.textContent.trim() === '新建笔记', null, { timeout: 15000 });
  check('双链目标未匹配时自动创建并打开同名笔记', true, '新建笔记');

  const titleInput = wikiPage.locator('.editor-title-input');
  const fastTitle = '标题连续输入光标测试'.repeat(4);
  await titleInput.click();
  await titleInput.press('Control+A');
  await titleInput.pressSequentially(fastTitle, { delay: 0 });
  await wikiPage.waitForFunction(value => document.querySelector('.editor-title-input')?.textContent === value, fastTitle, { timeout: 10000 });
  await wikiPage.waitForTimeout(80);
  const fastTitleState = await wikiPage.evaluate(() => {
    const input = document.querySelector('.editor-title-input');
    const container = input.parentElement;
    const sel = getSelection();
    const range = document.createRange();
    range.setStart(sel.focusNode, sel.focusOffset);
    range.collapse(true);
    const caret = range.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    return { text: input.textContent, whiteSpace: getComputedStyle(input).whiteSpace, maxScroll: container.scrollWidth - container.clientWidth, scrollLeft: container.scrollLeft, caret: { left: caret.left, right: caret.right, top: caret.top, height: caret.height }, box: { left: box.left, right: box.right }, focusOffset: sel.focusOffset, focusNodeType: sel.focusNode?.nodeType, caretVisible: caret.height > 0 && caret.left >= box.left + 8 && caret.right <= box.right - 8 };
  });
  check('标题胶囊快速连续输入长文本后光标仍可见且进入横向滚动模式', fastTitleState.text === fastTitle && fastTitleState.whiteSpace === 'nowrap' && fastTitleState.maxScroll > 0 && fastTitleState.caretVisible, JSON.stringify(fastTitleState));

  const insertionOffset = 10;
  await titleInput.evaluate((el, offset) => {
    const text = el.firstChild;
    const range = document.createRange();
    range.setStart(text, offset);
    range.collapse(true);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, insertionOffset);
  await wikiPage.waitForTimeout(80);
  const middleBefore = await wikiPage.evaluate(() => {
    const input = document.querySelector('.editor-title-input');
    const container = input.parentElement;
    const selection = getSelection();
    const range = document.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
    const caret = range.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    return { offset: selection.focusOffset, scrollLeft: container.scrollLeft, caretVisible: caret.height > 0 && caret.left >= box.left + 8 && caret.right <= box.right - 8 };
  });
  await titleInput.press('Space');
  const titleAfterSpace = fastTitle.slice(0, insertionOffset) + ' ' + fastTitle.slice(insertionOffset);
  await wikiPage.waitForFunction(value => document.querySelector('.editor-title-input')?.textContent === value, titleAfterSpace, { timeout: 5000 });
  await wikiPage.waitForTimeout(80);
  const middleAfter = await wikiPage.evaluate(() => {
    const input = document.querySelector('.editor-title-input');
    const container = input.parentElement;
    const selection = getSelection();
    const range = document.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
    const caret = range.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    return { text: input.textContent, offset: selection.focusOffset, scrollLeft: container.scrollLeft, maxScroll: container.scrollWidth - container.clientWidth, caretVisible: caret.height > 0 && caret.left >= box.left + 8 && caret.right <= box.right - 8 };
  });
  check('中段移动光标后输入空格不会跳到标题末尾，且光标留在可视区', middleBefore.offset === insertionOffset && middleBefore.caretVisible && middleAfter.text === titleAfterSpace && middleAfter.offset === insertionOffset + 1 && middleAfter.caretVisible && middleAfter.scrollLeft < middleAfter.maxScroll - 8, JSON.stringify({ before: middleBefore, after: middleAfter }));
  await titleInput.evaluate(el => {
    const range = document.createRange();
    range.setStart(el.firstChild, 0);
    range.collapse(true);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await wikiPage.waitForTimeout(80);
  const startCaretState = await wikiPage.evaluate(() => {
    const input = document.querySelector('.editor-title-input');
    const container = input.parentElement;
    const selection = getSelection();
    const range = document.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
    const caret = range.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    const style = getComputedStyle(container);
    return { offset: selection.focusOffset, scrollLeft: container.scrollLeft, caretLeft: caret.left, boxLeft: box.left, boxRight: box.right, caretHeight: caret.height, paddingLeft: style.paddingLeft, paddingRight: getComputedStyle(input).paddingRight, scrollPaddingInline: style.scrollPaddingInline, mask: style.maskImage, webkitMask: style.webkitMaskImage };
  });
  check('长标题起始光标不受遮罩且两侧留出16px安全间距', startCaretState.offset === 0 && startCaretState.caretHeight > 0 && startCaretState.caretLeft >= startCaretState.boxLeft + 14 && startCaretState.caretLeft <= startCaretState.boxRight - 14 && startCaretState.paddingLeft === '16px' && startCaretState.paddingRight === '16px' && startCaretState.scrollPaddingInline === '16px' && startCaretState.mask === 'none' && startCaretState.webkitMask === 'none', JSON.stringify(startCaretState));
  await wikiPage.setViewportSize({ width: 390, height: 480 });
  await wikiPage.waitForTimeout(100);
  const shortViewportTitle = await wikiPage.evaluate(() => {
    const input = document.querySelector('.editor-title-input');
    const dock = document.querySelector('.editor-title-dock').getBoundingClientRect();
    const box = input.getBoundingClientRect();
    return { focused: document.activeElement === input, viewportHeight: window.visualViewport ? window.visualViewport.height : innerHeight, dockTop: dock.top, dockBottom: dock.bottom, inputTop: box.top, inputBottom: box.bottom };
  });
  check('模拟可视视口高度缩小后标题输入仍完整位于屏幕内', shortViewportTitle.focused && shortViewportTitle.dockTop >= 0 && shortViewportTitle.dockBottom <= shortViewportTitle.viewportHeight && shortViewportTitle.inputTop >= 0 && shortViewportTitle.inputBottom <= shortViewportTitle.viewportHeight, JSON.stringify(shortViewportTitle));
  await wikiPage.setViewportSize({ width: 390, height: 844 });
  const imeEnterState = await titleInput.evaluate(el => {
    el.focus();
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '日' }));
    const composingEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
    el.dispatchEvent(composingEnter);
    const duringComposition = { focused: document.activeElement === el, prevented: composingEnter.defaultPrevented };
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }));
    const doneEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    el.dispatchEvent(doneEnter);
    return { duringComposition, normalEnterPrevented: doneEnter.defaultPrevented, blurredAfterNormalEnter: document.activeElement !== el };
  });
  check('输入法组合期间 Enter 不强制失焦，组合结束后 Enter 正常完成标题', imeEnterState.duringComposition.focused && !imeEnterState.duringComposition.prevented && imeEnterState.normalEnterPrevented && imeEnterState.blurredAfterNormalEnter, JSON.stringify(imeEnterState));
  await titleInput.evaluate(el => el.blur());

  await wikiPage.locator('[aria-label="打开更多菜单"]').click();
  const menuPanel = wikiPage.locator('.editor-menu-panel');
  await menuPanel.waitFor({ state: 'visible', timeout: 5000 });
  const menuAlignment = await wikiPage.evaluate(() => {
    const panel = document.querySelector('.editor-menu-panel');
    const exportEntry = panel.querySelector('.editor-export-entry');
    const exportIcon = exportEntry.querySelector('span');
    const otherIcon = panel.querySelector('button:not(.editor-export-entry) span');
    return { exportLeft: exportIcon.getBoundingClientRect().left, otherLeft: otherIcon.getBoundingClientRect().left };
  });
  check('更多菜单导出图标与其他项目图标左边缘对齐', Math.abs(menuAlignment.exportLeft - menuAlignment.otherLeft) <= 0.5, JSON.stringify(menuAlignment));
  await wikiPage.locator('.editor-export-entry').click();
  await wikiPage.locator('.editor-export-back').waitFor({ state: 'visible', timeout: 5000 });
  const exportAppearance = await wikiPage.evaluate(() => {
    const back = document.querySelector('.editor-export-back');
    const backStyle = getComputedStyle(back);
    const icons = [...document.querySelectorAll('.editor-export-choice-icon')].map(icon => {
      const style = getComputedStyle(icon);
      return { background: style.backgroundColor, borderWidth: style.borderWidth, radius: style.borderRadius };
    });
    return { fab: back.classList.contains('editor-fab'), width: backStyle.width, height: backStyle.height, radius: backStyle.borderRadius, iconPoints: back.querySelector('polyline')?.getAttribute('points') || '', choices: icons };
  });
  check('导出格式图标无方形底框，返回按钮沿用 46px 玻璃圆形样式并显示返回图标', exportAppearance.fab && exportAppearance.width === '46px' && exportAppearance.height === '46px' && exportAppearance.radius === '50%' && exportAppearance.iconPoints === '15 18 9 12 15 6' && exportAppearance.choices.length === 3 && exportAppearance.choices.every(icon => icon.background === 'rgba(0, 0, 0, 0)' && icon.borderWidth === '0px' && icon.radius === '0px'), JSON.stringify(exportAppearance));
  await wikiPage.locator('.editor-export-back').click();
  await wikiPage.locator('.editor-export-panel').waitFor({ state: 'hidden', timeout: 5000 });
  await wikiPage.locator('.editor-fab.right').click();
  await wikiPage.locator('.editor-menu-panel').waitFor({ state: 'hidden', timeout: 5000 });
  await wikiPage.waitForTimeout(240);
  const closeSaveTitle = '未失焦直接返回保存验证';
  const closeSaveTitleInput = wikiPage.locator('.editor-title-input');
  await closeSaveTitleInput.click();
  await closeSaveTitleInput.fill(closeSaveTitle);
  await wikiPage.waitForFunction(value => document.querySelector('.editor-title-input')?.textContent === value, closeSaveTitle, { timeout: 5000 });
  await wikiPage.locator('.editor-fab.left').click();
  await wikiPage.waitForFunction(() => !document.querySelector('.editor-title-input'), null, { timeout: 10000 });
  const savedOnClose = await wikiPage.evaluate(title => JSON.parse(localStorage.getItem('memos_app_v2') || '[]').some(memo => memo.title === title), closeSaveTitle);
  check('标题输入仍聚焦时直接返回也会先提交并保存最新文本', savedOnClose, closeSaveTitle);
  await wikiPage.waitForTimeout(360);
  await wikiPage.locator('.list-item').filter({ hasText: '新建笔记' }).first().click();
  await wikiPage.waitForSelector('.editor-title-input', { timeout: 10000 });
  const firstTitleInput = wikiPage.locator('.editor-title-input');
  const composedLongTitle = '新建笔记首次输入法组合阶段胶囊布局留白与副标题居中验证'.repeat(2);
  await firstTitleInput.click();
  await firstTitleInput.evaluate((el, value) => {
    el.focus();
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    [8, 16, value.length].forEach(length => {
      el.textContent = value.slice(0, length);
      const text = el.firstChild;
      const range = document.createRange();
      range.setStart(text, text.length);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: value.slice(0, length) }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: value.slice(0, length) }));
    });
  }, composedLongTitle);
  await wikiPage.setViewportSize({ width: 390, height: 480 });
  await wikiPage.waitForTimeout(100);
  const compositionLayout = await wikiPage.evaluate(() => {
    const input = document.querySelector('.editor-title-input');
    const scroller = input.parentElement;
    const capsule = scroller.parentElement;
    const meta = capsule.querySelector('.editor-title-meta');
    const capsuleBox = capsule.getBoundingClientRect();
    const metaBox = meta && meta.getBoundingClientRect();
    return {
      focused: document.activeElement === input,
      text: input.textContent,
      capsuleWidth: capsuleBox.width,
      inputWhiteSpace: getComputedStyle(input).whiteSpace,
      inputTextAlign: getComputedStyle(input).textAlign,
      inputMinWidth: getComputedStyle(input).minWidth,
      scrollerWidth: scroller.clientWidth,
      scrollerScrollWidth: scroller.scrollWidth,
      scrollerScrollLeft: scroller.scrollLeft,
      scrollerScrollRemaining: scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft,
      metaExists: !!metaBox,
      metaCenterDelta: metaBox && (metaBox.left + metaBox.width / 2 - (capsuleBox.left + capsuleBox.width / 2)),
      metaInsideCapsule: !!metaBox && metaBox.left >= capsuleBox.left && metaBox.right <= capsuleBox.right,
      metaText: meta?.textContent.trim() || ''
    };
  });
  check('输入法组合尚未确认且键盘缩小视口时标题已进入防溢出布局、副标题保持居中', compositionLayout.focused && compositionLayout.text === composedLongTitle && compositionLayout.inputWhiteSpace === 'nowrap' && compositionLayout.inputTextAlign === 'left' && compositionLayout.inputMinWidth === 'max-content' && compositionLayout.scrollerScrollWidth > compositionLayout.scrollerWidth && compositionLayout.scrollerScrollLeft > 0 && Math.abs(compositionLayout.scrollerScrollRemaining) <= 1 && compositionLayout.metaExists && Math.abs(compositionLayout.metaCenterDelta) <= 1 && compositionLayout.metaInsideCapsule && compositionLayout.metaText.length > 0, JSON.stringify(compositionLayout));
  await firstTitleInput.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: el.textContent })));
  await wikiPage.setViewportSize({ width: 390, height: 844 });
  await wikiPage.waitForTimeout(80);
  const firstLongTitle = '新建笔记首次快速输入长标题测试左右留白与副标题居中'.repeat(2);
  await firstTitleInput.click();
  await firstTitleInput.press('Control+A');
  await firstTitleInput.pressSequentially(firstLongTitle, { delay: 0 });
  await wikiPage.waitForFunction(value => document.querySelector('.editor-title-input')?.textContent === value, firstLongTitle, { timeout: 10000 });
  await wikiPage.waitForTimeout(100);
  const firstTitleLayout = await wikiPage.evaluate(() => {
    const input = document.querySelector('.editor-title-input');
    const scroller = input.parentElement;
    const capsule = scroller.parentElement;
    const meta = capsule.querySelector('.editor-title-meta');
    const selection = getSelection();
    const range = document.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
    const caret = range.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const capsuleBox = capsule.getBoundingClientRect();
    const metaBox = meta && meta.getBoundingClientRect();
    return {
      text: input.textContent,
      maxScroll: scroller.scrollWidth - scroller.clientWidth,
      leftGap: caret.left - box.left,
      rightGap: box.right - caret.right,
      capsuleCenterDelta: capsuleBox.left + capsuleBox.width / 2 - innerWidth / 2,
      metaCenterDelta: metaBox && (metaBox.left + metaBox.width / 2 - (capsuleBox.left + capsuleBox.width / 2)),
      metaInsideCapsule: !!metaBox && metaBox.left >= capsuleBox.left && metaBox.right <= capsuleBox.right,
      metaClientWidth: meta?.clientWidth || 0,
      metaScrollWidth: meta?.scrollWidth || 0,
      metaText: meta?.textContent.trim() || ''
    };
  });
  check('新建笔记首次快速输入长标题时光标两侧留白，时间/计数完整并保持胶囊中轴', firstTitleLayout.text === firstLongTitle && firstTitleLayout.maxScroll > 0 && firstTitleLayout.leftGap >= 14 && firstTitleLayout.rightGap >= 14 && Math.abs(firstTitleLayout.capsuleCenterDelta) <= 1 && Math.abs(firstTitleLayout.metaCenterDelta) <= 1 && firstTitleLayout.metaInsideCapsule && firstTitleLayout.metaText.length > 0 && firstTitleLayout.metaScrollWidth <= firstTitleLayout.metaClientWidth, JSON.stringify(firstTitleLayout));
  const boundaryCaretLayout = await wikiPage.evaluate(async () => {
    const input = document.querySelector('.editor-title-input');
    const scroller = input.parentElement;
    const text = input.firstChild;
    scroller.scrollLeft = 0;
    const range = document.createRange();
    range.setStart(input, input.childNodes.length);
    range.collapse(true);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const proto = Range.prototype;
    const nativeRect = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () {
      if (this.collapsed && this.startContainer === input) return new DOMRect(0, 0, 0, 0);
      return nativeRect.call(this);
    };
    try {
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise(resolve => setTimeout(resolve, 120));
      const glyphRange = document.createRange();
      glyphRange.setStart(text, Math.max(0, text.length - 1));
      glyphRange.setEnd(text, text.length);
      const glyph = glyphRange.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      return {
        focusNodeType: selection.focusNode.nodeType,
        scrollerScrollLeft: scroller.scrollLeft,
        scrollerMaxScroll: scroller.scrollWidth - scroller.clientWidth,
        caretRightGap: box.right - glyph.right
      };
    } finally {
      proto.getBoundingClientRect = nativeRect;
    }
  });
  check('contenteditable 元素边界选区也能用相邻字形同步标题滚动并留出光标边距', boundaryCaretLayout.focusNodeType === 1 && boundaryCaretLayout.scrollerScrollLeft > 0 && Math.abs(boundaryCaretLayout.scrollerMaxScroll - boundaryCaretLayout.scrollerScrollLeft) <= 1 && boundaryCaretLayout.caretRightGap >= 14, JSON.stringify(boundaryCaretLayout));
  const nestedBoundaryOffset = await wikiPage.evaluate(() => {
    const root = document.createElement('p');
    root.innerHTML = 'ab<strong>cd<em>ef</em>gh</strong>ij';
    const strong = root.querySelector('strong');
    return window.MynoteDom.getTextOffsetWithin(root, strong, 2);
  });
  check('嵌套元素边界选区映射为完整正文文字偏移', nestedBoundaryOffset === 6, String(nestedBoundaryOffset));
  const nestedFocus = await wikiPage.evaluate(() => {
    const host = document.createElement('div');
    host.contentEditable = 'true';
    const quote = document.createElement('blockquote');
    quote.innerHTML = '<div>引用块内层文字</div>';
    host.appendChild(quote);
    document.body.appendChild(host);
    const originalText = quote.textContent;
    const focused = window.MynoteDom.focusEditableWithCaret(quote, originalText.length);
    const selection = getSelection();
    const result = {
      focused,
      textPreserved: quote.textContent === originalText,
      caretInText: selection.focusNode?.nodeType === 3 && selection.focusNode.textContent === originalText && selection.focusOffset === originalText.length
    };
    selection.removeAllRanges();
    host.remove();
    return result;
  });
  check('嵌套引用块定位光标不会覆盖块内现有文字', nestedFocus.focused && nestedFocus.textPreserved && nestedFocus.caretInText, JSON.stringify(nestedFocus));
  await wikiContext.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const failed=results.filter(r=>!r.ok); console.log(`\n${results.length-failed.length}/${results.length} 通过`); process.exitCode=failed.length?1:0;
