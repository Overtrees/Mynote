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
    return {
      codeCount: codeNodes.length,
      codeText: codeNodes.map(node => node.textContent),
      codeMarkup: codeNodes.map(node => node.innerHTML),
      calloutBody: callout?.querySelector('.callout-body')?.innerHTML || '',
      calloutStrong: !!callout?.querySelector('.callout-body strong'),
      calloutLink: callout?.querySelector('.callout-body a')?.getAttribute('href') || '',
      calloutItems: callout?.querySelectorAll('.callout-body li').length || 0,
      calloutFence: codeCalloutHost.querySelector('.callout-body pre code')?.textContent || ''
    };
  });
  const expectedCode = "const literal = '~~strike~~ ==highlight== !!idea ??question @@name :smile: #tag $blue:x$ ->center<-';";
  check('反引号/波浪号围栏与行内代码中的扩展标记逐字保留', markdownPipeline.codeCount === 3 && markdownPipeline.codeText[0] === expectedCode + '\n' && markdownPipeline.codeText[1] === expectedCode + '\n' && markdownPipeline.codeText[2] === expectedCode && markdownPipeline.codeMarkup.every(markup => !/<(?:del|span|svg)\b/i.test(markup)), JSON.stringify(markdownPipeline.codeText));
  check('提示块正文继续解析加粗、链接与 Markdown 列表', markdownPipeline.calloutStrong && markdownPipeline.calloutLink === 'https://example.com' && markdownPipeline.calloutItems === 2, markdownPipeline.calloutBody.replace(/\s+/g, ' ').slice(0, 180));
  check('提示块内部围栏代码保留扩展标记字面量', markdownPipeline.calloutFence === "const nested = '~~keep~~ ==keep==';\n", JSON.stringify(markdownPipeline.calloutFence));
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
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const failed=results.filter(r=>!r.ok); console.log(`\n${results.length-failed.length}/${results.length} 通过`); process.exitCode=failed.length?1:0;
