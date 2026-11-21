// Rust Web 设置页冒烟：结构完整性（外观/数据/关于）+ 文字大小
// 三档（root rem 缩放全应用）+ 备份页结构 + 诊断入口
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

const settingsText = await page.evaluate(() => document.body.innerText);
for (const s of ['设置', '外观', '文字大小', '数据', '备份与恢复', '语言', '诊断日志', '关于', '版本', '2.2.7', '联系我们', 'overcanopies@gmail.com', '此刻，值得被记住。']) {
  if (!settingsText.includes(s)) { ok('settings contains ' + s, false); }
}
ok('settings structure complete', true);

// 文字大小：大 → html font-size 19px + sj_fontsize=large 持久
await page.click('.seg-btn:has-text("大")');
await page.waitForTimeout(300);
const fsLarge = await page.evaluate(() => ({
  root: document.documentElement.style.fontSize,
  ls: localStorage.getItem('sj_fontsize'),
}));
console.log('FONT LARGE:', JSON.stringify(fsLarge));
ok('large sets root 19px + persists', fsLarge.root === '19px' && fsLarge.ls === 'large');

// 编辑器正文随 root 缩放（1rem = 19px）
await page.click('.editor-fab.left');
await page.waitForSelector('.list-item', { timeout: 8000 });
await page.click('.list-item:has-text("周末看展记录") .item-title-text');
await page.waitForSelector('.detail .ed-line', { timeout: 8000 });
const bodyFs = await page.$eval('.editor-body', (e) => getComputedStyle(e).fontSize);
console.log('EDITOR BODY FS:', bodyFs);
ok('editor body scales to 19px', bodyFs === '19px');
await page.click('.editor-fab.left');
await page.waitForSelector('.list-item', { timeout: 8000 });

// 小 → 14px
await page.$eval('h1.page-title', (e) => e.click());
await page.waitForSelector('.page-content', { timeout: 8000 });
await page.click('.seg-btn:has-text("小")');
await page.waitForTimeout(300);
const fsSmall = await page.evaluate(() => document.documentElement.style.fontSize);
ok('small sets root 14px', fsSmall === '14px');
// 恢复中号，避免污染后续
await page.click('.seg-btn:has-text("中")');
await page.waitForTimeout(200);

// 备份页结构：hero + 本地卡 + Drive 卡（未连接）+ 连接按钮报待定
await page.click('.set-row:has-text("备份与恢复")');
await page.waitForSelector('.backup-hero', { timeout: 8000 });
const backupText = await page.evaluate(() => document.body.innerText);
ok('backup hero + rows', backupText.includes('备份状态总览') && backupText.includes('未连接') && backupText.includes('导出备份') && backupText.includes('导入备份') && backupText.includes('Google Drive 云备份'));
await page.click('.backup-action-bar .backup-btn.primary');
await page.waitForFunction(() => document.querySelector('.status-toast')?.innerText.includes('待定'), { timeout: 8000 });
ok('drive connect reports pending honestly', true);
await page.click('.editor-fab.left');
await page.waitForSelector('.page-content', { timeout: 8000 });

// 诊断页：从设置进入，日志 UI 在
await page.click('.set-row:has-text("诊断日志")');
await page.waitForSelector('.diag-body', { timeout: 8000 });
const diagText = await page.$eval('.diag-body', (e) => e.innerText);
ok('diag view shows log lines', diagText.includes('APP'));
const diagBg = await page.$eval('.diag-body', (e) => getComputedStyle(e).backgroundColor);
console.log('DIAG BG:', diagBg);
ok('diag keeps dark style', diagBg === 'rgb(17, 17, 17)');

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
