// Rust Web i18n 冒烟：语言包按需下载（只拉一次）→ 全 UI 切换 →
// 刷新保持 → 切回中文
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:8096/';
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const ok = (name, cond) => console.log((cond ? '✓ ' : '✗ ') + name);
const fetches = [];
page.on('request', (r) => {
  if (r.url().includes('/lang/')) fetches.push(r.url());
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 20000 });
ok('no pack fetched for builtin zh-CN', fetches.length === 0);

// 设置 → 语言 → English (US)
await page.$eval('h1.page-title', (e) => e.click());
await page.waitForSelector('.page-content', { timeout: 8000 });
await page.click('.set-row:has-text("语言")');
await page.waitForSelector('.list-item:has-text("English")', { timeout: 8000 });
await page.click('.list-item:has-text("English")');
await page.waitForFunction(() => document.body.innerText.includes('Language'), { timeout: 10000 });
console.log('FETCHES:', JSON.stringify(fetches));
ok('en-US pack fetched exactly once', fetches.filter((u) => u.includes('en-US')).length === 1);

// 返回列表：英文 UI
await page.click('.editor-fab.left');
await page.waitForSelector('.page-content', { timeout: 8000 });
await page.click('.editor-fab.left');
await page.waitForSelector('.list-item', { timeout: 8000 });
const listText = await page.evaluate(() => document.body.innerText);
ok('list UI in English', listText.includes('Search') && listText.includes('New note'));

// 编辑器斜杠面板英文
await page.click('.list-item .item-title-text >> nth=0');
await page.waitForSelector('.detail .ed-line', { timeout: 8000 });
await page.click('.detail .ed-line >> nth=0');
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('/');
await page.waitForSelector('.slash-panel .slash-row', { timeout: 8000 });
const slashText = await page.$eval('.slash-panel', (e) => e.innerText);
ok('slash panel in English', slashText.includes('Heading 1') || slashText.includes('Bold'));
await page.keyboard.press('Escape');
await page.click('.editor-fab.left');
await page.waitForSelector('.list-item', { timeout: 8000 });

// 刷新保持英文
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 20000 });
const afterReload = await page.evaluate(() => document.body.innerText);
ok('language persists after reload', afterReload.includes('Search'));

// 切回简体中文
await page.$eval('h1.page-title', (e) => e.click());
await page.waitForSelector('.page-content', { timeout: 8000 });
await page.click('.set-row:has-text("Language")');
await page.waitForSelector('.list-item:has-text("简体中文")', { timeout: 8000 });
await page.click('.list-item:has-text("简体中文")');
await page.waitForFunction(() => document.body.innerText.includes('语言'), { timeout: 10000 });
ok('switch back to zh-CN', true);

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
