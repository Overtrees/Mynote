// Rust Web 冒烟 · 差距清单修复批次：
// 文案（搜索占位/斜杠分组）/ md 结构预览（表格/标题/引用/
// 分隔线）/ 链接卡锚点 / 删空备忘范围（旧笔记保留、新笔记
// 删除）/ 空占位提示 / ?open= 深链 / 粘贴 URL 成卡 / 粘贴
// 图片入附件 / 斜杠拼音搜索 + 最近使用 / SW 注册 / 双栏
// 独立滚动结构。
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const url = process.argv[2] || 'http://localhost:8096/';
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';

execSync(`python3 - <<'PYEOF'
import json, zipfile, datetime
now = datetime.datetime.now().astimezone()
ts = now.isoformat()
ts3 = (now - datetime.timedelta(days=3)).isoformat()
ts10 = (now - datetime.timedelta(days=10)).isoformat()
def para(bid, text):
    return {"id": bid, "type": "paragraph", "children": [{"text": text}]}
long_doc = [para("g1a", "| 名 | 量 |\\n| --- | --- |\\n| 苹果 | 3 |\\n| 香蕉 | 5 |"),
            para("g1b", "# 大标题"),
            para("g1c", "> 引用一\\n> 引用二"),
            para("g1d", "---")]
for i in range(16):
    long_doc.append(para(f"g1x{i}", f"填充段落 {i}：" + "内容文字" * 12))
a = {"id": "gap1", "title": "表格笔记", "pinned": False, "createdAt": ts, "updatedAt": ts, "doc": long_doc}
b = {"id": "gap2", "title": "旧笔记甲", "pinned": False, "createdAt": ts3, "updatedAt": ts3,
     "doc": [para("g2a", "这篇会被清空但必须保留。")]}
link = {"id": "gaplink1", "type": "link-card", "url": "https://example.com/page",
        "meta": {"title": "示例页面", "subtitle": "副标题", "source": "example.com", "type": "link"}, "status": "done", "children": []}
att = {"id": "gapattblk", "type": "attachment", "fileId": "gapatt1", "name": "测试.pdf", "status": "done", "image": False, "children": []}
c = {"id": "gap3", "title": "链接笔记", "pinned": False, "createdAt": ts10, "updatedAt": ts10, "doc": [link, att]}
data = {"version": 2, "exportedAt": ts, "memos": [a, b, c], "avatars": {}}
man = {"version": 1, "attachments": {"gapatt1": {"name": "测试.pdf", "type": "application/pdf"}}}
z = zipfile.ZipFile('/tmp/gaps_test.zip', 'w')
z.writestr('memos.json', json.dumps(data, ensure_ascii=False))
z.writestr('manifest.json', json.dumps(man, ensure_ascii=False))
z.writestr('attachments/gapatt1', b'%PDF-1.4 fake pdf bytes')
z.close()
print('gaps_test.zip ready')
PYEOF`);

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const ok = (name, cond, val) => console.log((cond ? '✓ ' : '✗ ') + name + (val !== undefined ? ' = ' + val : ''));

async function importZip(zipPath) {
  await page.$eval('h1.page-title', (e) => e.click());
  await page.waitForSelector('.page-content', { timeout: 8000 });
  await page.click('.set-row:has-text("备份与恢复")');
  await page.waitForSelector('#file-import', { state: 'attached', timeout: 8000 });
  await page.setInputFiles('#file-import', zipPath);
  await page.waitForSelector('.backup-modal', { timeout: 8000 });
  await page.click('.backup-modal .backup-btn.primary');
  await page.waitForFunction(() => document.querySelector('.status-toast')?.innerText.includes('已导入'), null, { timeout: 15000 });
  await page.click('.editor-fab.left');
  await page.waitForSelector('.page-content', { timeout: 8000 });
  await page.click('.editor-fab.left');
  await page.waitForSelector('.list-item, .img-card', { timeout: 10000 });
}

async function openMemoByTitle(title) {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('.img-card-title-text, .list-item .item-title-text')]
      .find((e) => e.textContent.includes(t));
    if (el) el.click();
  }, title);
  await page.waitForSelector('#editor-root', { timeout: 8000 });
  await page.waitForTimeout(500);
}

async function backToList() {
  await page.click('.editor-fab.left');
  await page.waitForSelector('.list-item, .img-card', { timeout: 8000 });
  await page.waitForTimeout(300);
}

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.list-item, .img-card', { timeout: 15000 });
await importZip('/tmp/gaps_test.zip');

// 文案：搜索占位
await page.evaluate(() => {
  const el = document.querySelector('.glass-search-trigger');
  if (el) el.click();
});
await page.waitForTimeout(600);
const ph = await page.evaluate(() => document.querySelector('.glass-search-input')?.getAttribute('placeholder') || '');
ok('search placeholder 搜索笔记...', ph === '搜索笔记...', ph);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// SW 注册
const swReg = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'n/a';
  const r = await navigator.serviceWorker.getRegistration();
  return r ? r.scope : '';
});
ok('service worker registered', !!swReg, swReg);

// md 结构预览
await openMemoByTitle('表格笔记');
const md = await page.evaluate(() => ({
  table: !!document.querySelector('.md-preview table td'),
  tdText: document.querySelector('.md-preview table td')?.textContent || '',
  h1: document.querySelector('.md-preview h1')?.textContent || '',
  quote: document.querySelector('.md-preview blockquote')?.textContent || '',
  hr: !!document.querySelector('.md-preview hr'),
}));
ok('md table preview', md.table && md.tdText.includes('苹果'), md.tdText);
ok('md heading preview', md.h1.includes('大标题'), md.h1);
ok('md quote preview', md.quote.includes('引用一') && md.quote.includes('引用二'), md.quote);
ok('md divider preview', md.hr);
await backToList();

// 链接卡锚点 + 附件行
await openMemoByTitle('链接笔记');
const card = await page.evaluate(() => {
  const a = document.querySelector('#editor-root a.link-card-block');
  return { tag: a ? a.tagName : '', href: a?.getAttribute('href') || '', att: !!document.querySelector('.attachment-file .att-hint') };
});
ok('link card is anchor', card.tag === 'A' && card.href === 'https://example.com/page', card.tag + ' ' + card.href);
ok('attachment row present', card.att);
await backToList();

// 删空范围：旧笔记清空后保留
await openMemoByTitle('旧笔记甲');
await page.evaluate(() => {
  const el = document.querySelector('#editor-root [data-bid]');
  if (el) { el.focus(); document.execCommand('selectAll', false, null); }
});
await page.keyboard.press('Backspace');
await page.waitForTimeout(600);
await backToList();
const keptOld = await page.evaluate(() =>
  [...document.querySelectorAll('.img-card-title-text, .list-item .item-title-text')].some((e) => e.textContent.includes('旧笔记甲')));
ok('emptied OLD memo is kept', keptOld);

// 新建空笔记：占位提示 + 关闭即删除
const beforeCount = await page.evaluate(() => document.querySelectorAll('.list-item, .img-card').length);
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.new-card, [class*=new]')].find((e) => e.textContent.includes('新建'));
  if (el) el.click();
});
await page.waitForSelector('#editor-root', { timeout: 8000 });
await page.waitForTimeout(600);
const phClass = await page.evaluate(() => document.querySelector('.editor-body')?.className || '');
ok('empty editor placeholder class', phClass.includes('show-placeholder'), phClass);
await backToList();
const afterCount = await page.evaluate(() => document.querySelectorAll('.list-item, .img-card').length);
ok('empty NEW memo deleted on close', afterCount === beforeCount, beforeCount + '->' + afterCount);

// 深链 ?open=
await page.goto(url + '?open=' + encodeURIComponent('表格'), { waitUntil: 'load' });
await page.waitForSelector('#editor-root', { timeout: 12000 });
await page.waitForTimeout(600);
const deepTitle = await page.evaluate(() => document.querySelector('#editor-title-text')?.textContent || '');
ok('deep link opens memo', deepTitle.includes('表格'), deepTitle);

// 粘贴 URL 成卡
await page.evaluate(() => {
  const el = document.querySelector('#editor-root [data-bid]');
  el.focus();
  const dt = { getData: (t) => (t === 'text/plain' ? 'https://example.com/hello' : ''), items: [], types: ['text/plain'] };
  const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: dt });
  el.dispatchEvent(ev);
});
await page.waitForTimeout(2500);
const pastedCard = await page.evaluate(() =>
  !!document.querySelector('#editor-root .link-card-skeleton, #editor-root a.link-card-err, #editor-root a.link-card-block, #editor-root .link-card-block'));
ok('paste URL creates link card', pastedCard);

// 粘贴图片入附件
await page.evaluate(async () => {
  const el = document.querySelector('#editor-root [data-bid]');
  el.focus();
  const resp = await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  const blob = await resp.blob();
  const file = new File([blob], 'shot.png', { type: 'image/png' });
  const dt = { getData: () => '', items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], types: ['Files'] };
  const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: dt });
  el.dispatchEvent(ev);
});
await page.waitForTimeout(2000);
const pastedImg = await page.evaluate(() =>
  !!document.querySelector('#editor-root .atomic[data-type="image"] img'));
ok('paste image inserts image block', pastedImg);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#editor-root', { timeout: 12000 });
await page.waitForTimeout(800);
const pastedImgAfterReload = await page.evaluate(() =>
  !!document.querySelector('#editor-root .atomic[data-type="image"] img'));
ok('pasted image persists after reload', pastedImgAfterReload);
await backToList();

// 斜杠：拼音搜索 + 分组文案 + 最近使用
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.new-card, [class*=new]')].find((e) => e.textContent.includes('新建'));
  if (el) el.click();
});
await page.waitForSelector('#editor-root', { timeout: 8000 });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const el = document.querySelector('#editor-root [data-bid]');
  if (el) el.focus();
});
await page.keyboard.type('/');
await page.waitForSelector('#slash-panel', { timeout: 5000 });
const heads = await page.evaluate(() =>
  [...document.querySelectorAll('.slash-section-heading')].map((e) => e.textContent));
ok('slash group labels 基础块/媒体块', heads.some((h) => h.includes('基础块')) && heads.some((h) => h.includes('媒体块')), heads.join('/'));
await page.keyboard.type('fgx');
await page.waitForTimeout(500);
const fgx = await page.evaluate(() =>
  [...document.querySelectorAll('.slash-row-title-text')].map((e) => e.textContent));
ok('slash pinyin search fgx -> 分割线', fgx.some((t) => t.includes('分割')), fgx.join('/'));
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#slash-panel button')].find((b) => b.textContent.includes('分割'));
  if (row) row.click();
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const el = document.querySelector('#editor-root [data-bid]');
  if (el) el.focus();
});
await page.keyboard.type('/');
await page.waitForSelector('#slash-panel', { timeout: 5000 });
const recent = await page.evaluate(() => ({
  heads: [...document.querySelectorAll('.slash-section-heading')].map((e) => e.textContent),
  pill: !!document.querySelector('.slash-recent-pill'),
  firstRow: document.querySelector('#slash-panel button')?.textContent || '',
}));
ok('slash recent section', recent.heads.some((h) => h.includes('最近使用')) && recent.pill, recent.heads.join('/'));
await page.keyboard.press('Escape');
await backToList();

// 双栏独立滚动（宽屏）
await page.setViewportSize({ width: 1280, height: 800 });
await openMemoByTitle('表格笔记');
await page.evaluate(() => document.querySelector('.editor-fab.right')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.twopane-row')][0];
  if (row) row.click();
});
await page.waitForTimeout(800);
const cols = await page.evaluate(() => {
  const body = document.querySelector('.editor-body.is-independent-scroll');
  if (!body) return { two: false };
  const cs = body.querySelectorAll('.editor-column');
  if (cs.length !== 2) return { two: false, n: cs.length };
  cs[0].scrollTop = 60;
  return { two: true, c0: cs[0].children.length, c1: cs[1].children.length, st: cs[0].scrollTop, sh: cs[0].scrollHeight, ch: cs[0].clientHeight };
});
ok('two-column independent structure', cols.two && cols.c0 > 0 && cols.c1 > 0, JSON.stringify(cols));
ok('first column scrolls independently', cols.sh > cols.ch && cols.st > 0, 'st=' + cols.st);

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
