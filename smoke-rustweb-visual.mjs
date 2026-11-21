// Rust Web 视觉度量冒烟：把原版关键度量逐项量出来断言（头像 72 /
// 搜索胶囊 66 / 行圆角 32 / fab 46 / 标题胶囊 66 / 菜单 246 /
// 待办勾选圈 22 / 原子块边距 36 / 斜杠行 48 / 设置页顶距 126）
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:8096/';
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const ok = (name, cond, val) => console.log((cond ? '✓ ' : '✗ ') + name + (val !== undefined ? ' = ' + val : ''));
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 20000 });

// —— 列表页 ——
const avatarBox = await page.$eval('h1.page-title > *', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; });
ok('avatar 72x72', near(avatarBox.w, 72) && near(avatarBox.h, 72), `${avatarBox.w}x${avatarBox.h}`);
const triggerH = await page.$eval('.glass-search-trigger', (e) => e.getBoundingClientRect().height);
ok('search trigger height 66', near(triggerH, 66), triggerH);
const sh = await page.$eval('.section-header', (e) => { const cs = getComputedStyle(e); return { fs: cs.fontSize, fw: cs.fontWeight }; });
ok('section-header 14px/600', sh.fs === '14px' && sh.fw === '600', JSON.stringify(sh));
const rowRadius = await page.$eval('.list-item', (e) => getComputedStyle(e).borderRadius);
ok('list row radius 32', rowRadius === '32px', rowRadius);
const newInFirstGroup = await page.evaluate(() => {
  const g = document.querySelector('.container .list-group');
  return g && g.innerText.includes('新建笔记');
});
ok('new-note card in first list-group', !!newInFirstGroup);

// —— 设置页 ——
await page.$eval('h1.page-title', (e) => e.click());
await page.waitForSelector('.page-content', { timeout: 8000 });
const padTop = await page.$eval('.page-content', (e) => getComputedStyle(e).paddingTop);
ok('settings content padding-top 126', padTop === '126px', padTop);
await page.click('.editor-fab.left');
await page.waitForSelector('.list-item', { timeout: 8000 });

// —— 编辑器 ——（先导入真实备份拿到图片块）
await page.$eval('h1.page-title', (e) => e.click());
await page.waitForSelector('.page-content', { timeout: 8000 });
await page.click('.set-row:has-text("备份与恢复")');
await page.waitForSelector('#file-import', { state: 'attached', timeout: 8000 });
await page.setInputFiles('#file-import', process.env.HOME + '/workspace/mynote-zip-acceptance/real_backup.zip');
await page.waitForSelector('.backup-modal', { timeout: 8000 });
await page.click('.backup-modal .backup-btn.primary');
await page.waitForFunction(() => document.querySelector('.status-toast')?.innerText.includes('已导入'), { timeout: 15000 });
await page.click('.editor-fab.left');
await page.waitForSelector('.page-content', { timeout: 8000 });
await page.click('.editor-fab.left');
await page.waitForSelector('.img-card', { timeout: 8000 });
await page.click('.img-card:has-text("冬日")');
await page.waitForSelector('.detail', { timeout: 8000 });

const fabBox = await page.$eval('.editor-fab.left', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; });
ok('editor fab 46x46', near(fabBox.w, 46) && near(fabBox.h, 46), `${fabBox.w}x${fabBox.h}`);
const capsuleH = await page.$eval('.editor-title-capsule', (e) => e.getBoundingClientRect().height);
ok('title capsule height 66', near(capsuleH, 66), capsuleH);
const atomicMl = await page.$eval('.detail .atomic', (e) => getComputedStyle(e).marginLeft);
ok('attachment atomic full-bleed (margin-left 0)', atomicMl === '0px', atomicMl);
const bodyCs = await page.$eval('.editor-body', (e) => { const cs = getComputedStyle(e); return { fs: cs.fontSize, lh: cs.lineHeight }; });
ok('editor body 16px/28px', bodyCs.fs === '16px' && bodyCs.lh === '28px', JSON.stringify(bodyCs));

// 待办勾选圈：把首个段落转待办后量 ::before
await page.click('.editor-fab.left');
await page.waitForSelector('.list-item', { timeout: 8000 });
await page.click('.list-item:has-text("实用技巧") .item-title-text');
await page.waitForSelector('.detail .ed-line', { timeout: 8000 });
const titleFs = await page.$eval('.editor-title-input', (e) => getComputedStyle(e).fontSize);
ok('title input 14px (short title)', titleFs === '14px', titleFs);
await page.click('.detail .ed-line >> nth=0');
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('/');
await page.waitForSelector('.slash-panel .slash-row', { timeout: 8000 });
const slashW = await page.$eval('.slash-panel', (e) => e.getBoundingClientRect().width);
ok('slash panel width 360 (原版公式 min(360, vw-24))', near(slashW, 360), slashW);
const rowH = await page.$eval('.slash-panel .slash-row', (e) => e.getBoundingClientRect().height);
ok('slash row height >= 48', rowH >= 47.5, rowH);
await page.click('.slash-panel .slash-row[data-act="todo"]');
await page.waitForSelector('.todo-checkbox', { timeout: 8000 });
const cb = await page.$eval('.todo-checkbox', (e) => { const cs = getComputedStyle(e, '::before'); return { w: cs.width, br: cs.borderRadius }; });
ok('todo checkbox ::before 22px circle', cb.w === '22px' && cb.br === '50%', JSON.stringify(cb));

// 纯图片块：斜杠「图片」选图 → .atomic[data-type=image] 两侧 36px
await page.evaluate(() => {
  const f = document.getElementById('file-media');
  f.dataset.armed = '1';
});
await page.click('.detail .ed-line >> nth=0');
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('/');
await page.waitForSelector('.slash-panel .slash-row', { timeout: 8000 });
const mediaDl = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
await page.click('.slash-panel .slash-row[data-act="image"]');
const chooser = await mediaDl;
if (chooser) await chooser.setFiles('/tmp/px.png');
await page.waitForSelector('.detail .atomic[data-type="image"]', { timeout: 10000 });
const imgMl = await page.$eval('.detail .atomic[data-type="image"]', (e) => getComputedStyle(e).marginLeft);
ok('image atomic margin-left 36', imgMl === '36px', imgMl);

// 背景底表：悬浮（底边距 14）
await page.click('.editor-fab.right');
await page.waitForSelector('.editor-menu-panel', { timeout: 8000 });
await page.waitForTimeout(400);
await page.locator('.editor-menu-panel .menu-item:has-text("更换背景色")').click();
await page.waitForSelector('.bg-sheet', { timeout: 8000 });
await page.waitForTimeout(400);
const sheetGap = await page.evaluate(() => {
  const r = document.querySelector('.sheet-wrap').getBoundingClientRect();
  return window.innerHeight - r.bottom;
});
ok('bg sheet floats 14px above bottom', near(sheetGap, 14, 2), sheetGap);

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
