// Rust Web misc 冒烟：启动页外壳（原始 HTML 即含 splash、挂载后
// 消失）→ 深色模式令牌 → 灯箱开关
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:8096/';
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const errors = [];
const ok = (name, cond) => console.log((cond ? '✓ ' : '✗ ') + name);

// 1) 启动页：原始 HTML 含 splash（恐龙 SVG + spinner），挂载后移除
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
const resp = await page.goto(url, { waitUntil: 'commit' });
const html = await resp.text();
ok('shell html has splash + dino svg', html.includes('class="splash"') && html.includes('viewBox="0 0 512 512"') && html.includes('class="spinner"'));
await page.waitForSelector('.list-item', { timeout: 20000 });
const splashGone = await page.$('.splash') === null;
ok('splash removed after mount', splashGone);
await ctx.close();

// 2) 深色模式：卡片底色切到暗色令牌
const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, colorScheme: 'dark' });
const page2 = await ctx2.newPage();
page2.on('pageerror', (e) => errors.push(String(e)));
await page2.goto(url, { waitUntil: 'load' });
await page2.waitForSelector('.list-item', { timeout: 20000 });
const cardBg = await page2.$eval('.list-item', (e) => getComputedStyle(e).backgroundColor);
console.log('DARK CARD BG:', cardBg);
ok('dark mode card token', cardBg === 'rgba(32, 32, 36, 0.86)' || cardBg === 'rgb(28, 28, 30)');
await ctx2.close();

// 3) 灯箱：导入真实备份 → 冬日详情点图 → 灯箱开/关
const ctx3 = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, acceptDownloads: true });
const page3 = await ctx3.newPage();
page3.on('pageerror', (e) => errors.push(String(e)));
await page3.goto(url, { waitUntil: 'load' });
await page3.waitForSelector('.list-item', { timeout: 20000 });
await page3.$eval('h1.page-title', (e) => e.click());
await page3.waitForSelector('.page-content', { timeout: 8000 });
await page3.click('.set-row:has-text("备份与恢复")');
await page3.waitForSelector('#file-import', { state: 'attached', timeout: 8000 });
await page3.setInputFiles('#file-import', process.env.HOME + '/workspace/mynote-zip-acceptance/real_backup.zip');
await page3.waitForSelector('.backup-modal', { timeout: 8000 });
await page3.click('.backup-modal .backup-btn.primary');
await page3.waitForFunction(() => document.querySelector('.status-toast')?.innerText.includes('已导入'), { timeout: 15000 });
await page3.click('.editor-fab.left');
await page3.waitForSelector('.page-content', { timeout: 8000 });
await page3.click('.editor-fab.left');
await page3.waitForSelector('.img-card', { timeout: 8000 });
await page3.click('.img-card:has-text("冬日")');
await page3.waitForSelector('.detail img.blk-media', { timeout: 8000 });
await page3.waitForFunction(() => document.querySelector('.detail img.blk-media')?.naturalWidth > 0, { timeout: 10000 });
await page3.click('.detail img.blk-media');
await page3.waitForSelector('.lightbox', { timeout: 8000 });
ok('lightbox opens', true);
await page3.click('.lightbox');
await page3.waitForTimeout(400);
ok('lightbox closes', await page3.$('.lightbox') === null);
await ctx3.close();

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
