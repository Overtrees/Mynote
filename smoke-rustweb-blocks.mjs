// Rust Web 全块渲染冒烟：导入 fixtures/allblocks.zip（原版 canonical
// 形状：attrs.level/checked/items + md 源段落），逐项断言渲染度量。
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:8096/';
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const ok = (name, cond) => console.log((cond ? '✓ ' : '✗ ') + name);

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 20000 });
await page.$eval('h1.page-title', (e) => e.click());
await page.waitForSelector('.page-content', { timeout: 8000 });
await page.click('.set-row:has-text("备份与恢复")');
await page.waitForSelector('#file-import', { state: 'attached', timeout: 8000 });
await page.setInputFiles('#file-import', process.env.HOME + '/workspace/Mynote/fixtures/allblocks.zip');
await page.waitForSelector('.backup-modal', { timeout: 8000 });
await page.click('.backup-modal .backup-btn.primary');
await page.waitForFunction(() => document.querySelector('.status-toast')?.innerText.includes('已导入'), { timeout: 15000 });
await page.click('.editor-fab.left');
await page.waitForSelector('.page-content', { timeout: 8000 });
await page.click('.editor-fab.left');
await page.waitForFunction(() => document.body.innerText.includes('全块渲染测试'), { timeout: 15000 });
await page.evaluate(() => {
  const t = document.querySelector('.img-card-title-text') || document.querySelector('.list-item .item-title-text');
  if (t) t.click();
});
await page.waitForSelector('.detail', { timeout: 8000 });
await page.waitForTimeout(1200);

// 标题三级字号（原版实测 h1 28 / h2 23 / h3 20）
const hSizes = await page.evaluate(() => {
  const out = {};
  for (const lv of [1, 2, 3]) {
    const el = document.querySelector('.blk-h' + lv);
    out[lv] = el ? getComputedStyle(el).fontSize : null;
  }
  return out;
});
console.log('HEADING SIZES:', JSON.stringify(hSizes));
ok('heading levels from attrs (28/23/20)', hSizes[1] === '28px' && hSizes[2] === '23px' && hSizes[3] === '20px');

// 待办勾选（attrs.checked）
const todo = await page.evaluate(() => {
  const done = document.querySelector('.todo-row.done');
  return { doneText: done ? done.innerText : '', onBox: !!document.querySelector('.todo-checkbox.on') };
});
ok('todo checked from attrs', todo.doneText.includes('已完成待办') && todo.onBox);

// Callout 预览卡（md 源段落）
const callouts = await page.$$eval('.md-preview .callout .callout-title', (els) => els.map((e) => e.innerText));
console.log('CALLOUTS:', JSON.stringify(callouts));
ok('callout previews with orig titles', callouts.includes('笔记') && callouts.includes('注意') && callouts.includes('提示'));

// 代码预览
const code = await page.$eval('.md-preview pre code', (e) => e.innerText).catch(() => '');
ok('code preview renders inner code', code.includes('fn main()') && !code.includes('```'));

// 列表预览（无序 2 + 有序 3）
const lis = await page.$$eval('.md-preview li', (els) => els.map((e) => e.innerText));
console.log('LIST ITEMS:', JSON.stringify(lis));
ok('list previews render 5 items', lis.length === 5 && lis[4].includes('有序项三'));

// 图库（attrs.items 两张图）
await page.waitForFunction(() => {
  const g = document.querySelector('[data-type="gallery"]');
  return g && [...g.querySelectorAll('img')].filter((i) => i.naturalWidth > 0).length >= 2;
}, { timeout: 10000 }).catch(() => {});
const galImgs = await page.$$eval('[data-type="gallery"] img', (els) => els.filter((i) => i.naturalWidth > 0).length);
ok('gallery renders attrs.items images', galImgs >= 2);

// 链接卡 / 音乐卡
const lk = await page.evaluate(() => document.body.innerText.includes('示例文章标题'));
const mu = await page.evaluate(() => !!document.querySelector('.music-card-link'));
ok('link card + music card render', lk && mu);

// 点 Callout 预览 → 源码编辑态；失焦 → 回预览
await page.click('.md-preview .callout-note');
await page.waitForTimeout(600);
const srcOn = await page.evaluate(() => document.activeElement?.dataset?.btype || '');
ok('callout preview click enters source edit', srcOn === 'mdsrc');
await page.click('.detail .ed-line >> nth=0');
await page.waitForTimeout(600);
const backPrev = await page.$$eval('.md-preview .callout', (els) => els.length);
ok('blur returns to callout preview', backPrev >= 3);

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
