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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('pageerror', e => check('页面运行期间无未处理异常', false, e.message));
  await page.goto(`http://127.0.0.1:${port}/Moment.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.list-item', { timeout: 30000 });
  await page.waitForTimeout(500);

  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      const trigger = page.locator('.glass-search-trigger').first();
      await trigger.waitFor({ state: 'visible', timeout: 5000 });
      await trigger.evaluate(el => el.focus({ focusVisible: true }));
      const triggerFocus = await trigger.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
      check(`${width}px ${scheme} 搜索按钮有可见键盘焦点`, triggerFocus.outline === 'solid' && triggerFocus.width >= 3, JSON.stringify(triggerFocus));
      await trigger.click();
      await page.waitForSelector('.glass-search-panel .glass-search-input', { timeout: 5000 });
      const searchFocus = await page.locator('.glass-search-panel').evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth), input: document.activeElement === el.querySelector('input') }));
      check(`${width}px ${scheme} 搜索面板聚焦态清晰且输入框可聚焦`, searchFocus.outline === 'solid' && searchFocus.width >= 3 && searchFocus.input, JSON.stringify(searchFocus));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      const m = await page.evaluate(() => {
        document.querySelectorAll('.glass-a11y-fixture').forEach(el => el.remove());
        const parse = value => {
          if (value.startsWith('#')) { const h = value.slice(1); const full = h.length === 3 ? [...h].map(c => c + c).join('') : h; return [parseInt(full.slice(0,2),16),parseInt(full.slice(2,4),16),parseInt(full.slice(4,6),16),1]; }
          const n = value.match(/[\d.]+/g).map(Number); return [n[0],n[1],n[2],n.length > 3 ? n[3] : 1];
        };
        const over = (top, bottom) => { const a=parse(top), b=parse(bottom); return a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3])); };
        const lum = rgb => { const c=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4); return .2126*c[0]+.7152*c[1]+.0722*c[2]; };
        const ratio = (a,b) => { const x=lum(a), y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
        const samples = [...window.MynoteTokens.palette.backgroundColors, '#000000','#ffffff','#ff3b30','#00ff00','#0000ff','#ff00ff'];
        const host = document.createElement('div'); host.className='glass-a11y-fixture'; host.style.cssText='position:absolute;left:-10000px;top:0;visibility:hidden;'; document.body.appendChild(host);
        let labelMin=99, tagMin=99;
        for (const background of samples) {
          const parent=document.createElement('div'); parent.style.backgroundColor=background; host.appendChild(parent);
          for (const layer of ['overlay','content','control']) {
            const label=document.createElement('span'); label.className='glass-label'; label.textContent='小标签'; label.style.backgroundColor=`var(--glass-${layer}-bg)`; parent.appendChild(label);
            const fg=parse(getComputedStyle(label).color), bg=over(getComputedStyle(label).backgroundColor, background); labelMin=Math.min(labelMin,ratio(fg,bg));
          }
          const tag=document.createElement('span'); tag.className='glass-tag'; tag.textContent='标签'; parent.appendChild(tag);
          tagMin=Math.min(tagMin,ratio(parse(getComputedStyle(tag).color),over(getComputedStyle(tag).backgroundColor,background)));
        }
        host.remove();

        const list=document.createElement('section'); list.className='glass-a11y-fixture'; list.style.cssText='width:100%;max-width:100%;';
        for(let i=0;i<72;i++) { const row=document.createElement('div'); row.className='list-item'; row.tabIndex=0; row.setAttribute('role','group'); row.innerHTML='<div class="item-left"><div class="item-title"><span class="item-title-text">长列表条目 '+i+' 超长测试 abcdefghijklmnopqrstuvwxyz</span><span class="glass-tag">标签</span></div><div class="item-meta">长期列表项说明</div></div>'; list.appendChild(row); }
        document.body.appendChild(list);
        const row=list.firstElementChild; row.focus({focusVisible:true});
        const rowFocus={outline:getComputedStyle(row).outlineStyle,width:parseFloat(getComputedStyle(row).outlineWidth)};
        const rowMetrics={count:list.children.length,client:list.clientWidth,scroll:list.scrollWidth,pageClient:document.documentElement.clientWidth,pageScroll:document.documentElement.scrollWidth,height:list.scrollHeight};

        const media=document.createElement('div'); media.className='editor-body glass-a11y-fixture'; media.style.cssText='width:calc(100% - 24px);max-width:100%;margin:16px auto;box-sizing:border-box;';
        media.innerHTML='<div class="img-text-card" data-type="imgTextCard"><div class="itc-img-wrap"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div><div class="itc-text">图文卡说明'+(' 很长说明'.repeat(20))+'</div></div><div class="img-text-row" data-type="imageTextRow"><div class="itr-img"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div><div class="itr-text">横排媒体说明'+(' 多媒体内容'.repeat(20))+'</div></div><div class="link-card-block"><div class="lkc-body"><div class="lkc-title">内容卡片标题</div><div class="lkc-subtitle">多媒体卡片副标题</div></div></div><a href="#" class="link-card-block music-card-link"><div class="lkc-body">音乐卡片</div></a>';
        document.body.appendChild(media);
        const cardNodes=[...media.querySelectorAll('.img-text-card,.img-text-row,.link-card-block')];
        const cards=cardNodes.map(el=>({name:el.className,client:el.clientWidth,scroll:el.scrollWidth,rect:el.getBoundingClientRect().width,background:getComputedStyle(el).backgroundColor}));
        const imageCard=document.createElement('div'); imageCard.className='img-card glass-a11y-fixture'; imageCard.tabIndex=0; imageCard.style.cssText='width:100%;height:60px;'; document.body.appendChild(imageCard); imageCard.focus({focusVisible:true});
        const imageFocus={outline:getComputedStyle(imageCard).outlineStyle,width:parseFloat(getComputedStyle(imageCard).outlineWidth)};

        const sheetA=document.createElement('div'); sheetA.className='image-text-sheet glass-a11y-fixture'; sheetA.textContent='阅读面板'; sheetA.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;width:calc(100vw - 24px);max-width:600px;box-sizing:border-box;z-index:4001;'; document.body.appendChild(sheetA);
        const sheetB=document.createElement('div'); sheetB.className='glass-a11y-fixture'; sheetB.textContent='重叠控件'; sheetB.style.cssText='position:fixed;right:20px;bottom:24px;width:140px;height:54px;box-sizing:border-box;z-index:4002;background:var(--glass-control-bg);border:1px solid var(--glass-control-border);'; document.body.appendChild(sheetB);
        const stack={firstZ:getComputedStyle(sheetA).zIndex,secondZ:getComputedStyle(sheetB).zIndex,firstRect:sheetA.getBoundingClientRect().toJSON(),secondRect:sheetB.getBoundingClientRect().toJSON(),firstBackground:getComputedStyle(sheetA).backgroundColor,secondBackground:getComputedStyle(sheetB).backgroundColor};
        const pageMetrics={client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth};
        document.querySelectorAll('.glass-a11y-fixture').forEach(el=>el.remove());
        return {labelMin,tagMin,rowFocus,rowMetrics,cards,imageFocus,stack,pageMetrics};
      });
      check(`${width}px ${scheme} 玻璃小标签跨明暗/彩色底色对比度 ≥4.5:1`, m.labelMin >= 4.5 && m.tagMin >= 4.5, `正文最小 ${m.labelMin.toFixed(2)}:1，彩色标签最小 ${m.tagMin.toFixed(2)}:1`);
      check(`${width}px ${scheme} 72 行长列表无横向溢出且列表卡焦点可见`, m.rowMetrics.count===72 && m.rowMetrics.scroll<=m.rowMetrics.client+1 && m.rowMetrics.height>m.rowMetrics.client && m.rowFocus.outline==='solid' && m.rowFocus.width>=3, JSON.stringify({rows:m.rowMetrics,focus:m.rowFocus}));
      check(`${width}px ${scheme} 多媒体卡片在手机视口内`, m.cards.length>=4 && m.cards.every(c=>c.scroll<=c.client+1 && c.rect<=width+1) && m.pageMetrics.scroll<=m.pageMetrics.client+1, JSON.stringify({cards:m.cards,page:m.pageMetrics}));
      check(`${width}px ${scheme} 图片卡焦点可见，叠层面板均在视口且层级有序`, m.imageFocus.outline==='solid' && m.imageFocus.width>=3 && Number(m.stack.secondZ)>Number(m.stack.firstZ) && m.stack.firstRect.right<=width+1 && m.stack.firstRect.left>=-1 && m.stack.firstRect.bottom<=844+1, JSON.stringify({focus:m.imageFocus,stack:m.stack}));
      await page.evaluate(() => { history.scrollRestoration = 'manual'; window.scrollTo(0, 0); });
      await page.waitForTimeout(320);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.list-item', { timeout: 30000 });
      await page.waitForTimeout(150);
    }
  }

  // Exercise the real React editor event handler for both inline and block Markdown previews.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.list-item', { timeout: 30000 });
  await page.locator('.list-item').nth(2).click();
  await page.waitForSelector('.editor-body', { timeout: 10000 });
  await page.waitForTimeout(250);
  const setup = await page.evaluate(() => {
    const body=document.querySelector('.editor-body');
    const inline=document.createElement('p'); inline.dataset.blockid='glass-inline-keyboard-test'; inline.textContent='**Inline keyboard restore**'; body.appendChild(inline);
    const inlineResult=window.MynoteMdBlocks.renderSingleParagraph(inline,'**Inline keyboard restore**');
    const block=document.createElement('p'); block.dataset.blockid='glass-block-keyboard-test'; block.textContent='- Block keyboard restore'; body.appendChild(block);
    const blockResult=window.MynoteMdBlocks.renderSingleParagraph(block,'- Block keyboard restore');
    return {inlineResult,blockResult,inline:!!body.querySelector('.md-preview-inline[data-mdtext="**Inline keyboard restore**"]'),block:!!body.querySelector('.md-preview.block[data-mdtext="- Block keyboard restore"]')};
  });
  check('行内和块级 Markdown 预览都支持键盘聚焦', setup.inlineResult==='inline' && setup.blockResult==='block' && setup.inline && setup.block, JSON.stringify(setup));
  const inlinePreview=page.locator('.md-preview-inline[data-mdtext="**Inline keyboard restore**"]');
  await inlinePreview.evaluate(el=>el.focus({focusVisible:true}));
  const inlineFocus=await inlinePreview.evaluate(el=>({tabIndex:el.tabIndex,label:el.getAttribute('aria-label'),outline:getComputedStyle(el).outlineStyle,width:parseFloat(getComputedStyle(el).outlineWidth)}));
  check('行内 Markdown 预览有无障碍名称和可见焦点', inlineFocus.tabIndex===0 && !!inlineFocus.label && inlineFocus.outline==='solid' && inlineFocus.width>=3, JSON.stringify(inlineFocus));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => { const p=document.querySelector('[data-blockid="glass-inline-keyboard-test"]'); return p && !p.classList.contains('md-preview-inline') && !p.hasAttribute('contenteditable') && p.textContent==='**Inline keyboard restore**'; });
  const blockPreview=page.locator('.md-preview.block[data-mdtext="- Block keyboard restore"]');
  await blockPreview.evaluate(el=>el.focus({focusVisible:true}));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => { const p=document.querySelector('[data-blockid="glass-block-keyboard-test"]'); return p && p.tagName==='P' && p.textContent==='- Block keyboard restore'; });
  check('Enter / 空格都能把 Markdown 预览还原为可编辑段落', true);

  // Add several genuine editor media cards and open the app's image-text sheet on a phone width.
  await page.evaluate(() => {
    const body=document.querySelector('.editor-body');
    body.insertAdjacentHTML('beforeend','<div class="img-text-card" data-blockid="glass-media-a" data-type="imgTextCard"><div class="itc-img-wrap"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div><div class="itc-text">媒体说明 A '+('long description '.repeat(14))+'</div></div><div class="img-text-row" data-blockid="glass-media-b" data-type="imageTextRow"><div class="itr-img"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div><div class="itr-text">媒体说明 B</div></div><a class="link-card-block music-card-link" data-blockid="glass-media-c" data-type="musicCard" href="#"><div class="lkc-body">音乐卡 C</div></a>');
  });
  const liveMedia=await page.evaluate(()=>{const body=document.querySelector('.editor-body');return {page:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,cards:[...body.querySelectorAll('[data-blockid^="glass-media-"]')].map(e=>({w:e.getBoundingClientRect().width,scroll:e.scrollWidth,client:e.clientWidth}))};});
  check('编辑器内多张真实媒体卡片在 390px 视口内', liveMedia.cards.length===3 && liveMedia.cards.every(c=>c.w<=390 && c.scroll<=c.client+1) && liveMedia.page<=liveMedia.client+1, JSON.stringify(liveMedia));
  await page.locator('[data-blockid="glass-media-a"] .itc-text').click();
  await page.waitForSelector('.image-text-sheet', { timeout: 5000 });
  const liveSheet=await page.locator('.image-text-sheet').evaluate(el=>{const wrap=el.closest('.image-text-sheet-wrap');const backdrop=document.querySelector('.image-text-sheet-backdrop');return {width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,maxHeight:getComputedStyle(el).maxHeight,background:getComputedStyle(el).backgroundColor,filter:getComputedStyle(el).backdropFilter,z:getComputedStyle(wrap).zIndex,backdropZ:getComputedStyle(backdrop).zIndex,viewport:innerWidth};});
  check('真实图文说明抽屉作为 overlay 完整适配手机视口', liveSheet.width<=liveSheet.viewport && liveSheet.height>0 && liveSheet.height<=680 && liveSheet.z==='4001' && Number(liveSheet.backdropZ)<Number(liveSheet.z) && liveSheet.background!=='rgba(0, 0, 0, 0)', JSON.stringify(liveSheet));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
const failed=results.filter(r=>!r.ok);
console.log(`\n${results.length-failed.length}/${results.length} 通过`);
process.exitCode=failed.length?1:0;
