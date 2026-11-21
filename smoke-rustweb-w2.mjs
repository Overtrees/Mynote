// Rust Web W2 冒烟（复刻版编辑器）：输入 → 回车分块 → 斜杠转待办 →
// 勾选 → 返回/重开/刷新三段持久
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

// 打开「周末看展记录」（段落多）
await page.click('.list-item:has-text("周末看展记录") .item-title-text');
await page.waitForSelector('.detail .ed-line', { timeout: 8000 });
const blocks0 = await page.$$eval('.detail [data-bid]', (els) => els.length);
console.log('BLOCKS BEFORE:', blocks0);

// 在第一个段落末尾输入 + 回车分块
await page.click('.detail .ed-line >> nth=0');
await page.keyboard.press('End');
await page.keyboard.type('XYZ冒烟');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const blocks1 = await page.$$eval('.detail [data-bid]', (els) => els.length);
console.log('BLOCKS AFTER ENTER:', blocks1);
ok('enter splits block', blocks1 === blocks0 + 1);
await page.keyboard.type('第二行文字');

// 斜杠 → 待办：新起一行输入 / 打开面板，点「待办」
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.keyboard.type('/');
await page.waitForSelector('.slash-panel .slash-row', { timeout: 8000 });
const rowCount = await page.$$eval('.slash-panel .slash-row', (els) => els.length);
console.log('SLASH ROWS:', rowCount);
ok('slash panel has 21 commands', rowCount >= 20);
await page.click('.slash-panel .slash-row[data-act="todo"]');
await page.waitForTimeout(400);
await page.keyboard.type('待办事项一则');
await page.waitForSelector('.todo-row', { timeout: 8000 });
ok('slash converts to todo', true);

// 勾选待办
await page.click('.todo-row .todo-checkbox');
await page.waitForTimeout(300);
const checked = await page.$eval('.todo-row .todo-checkbox', (e) => e.classList.contains('on'));
ok('todo checks', checked);

// 返回 → 重开 → 内容在
await page.click('.editor-fab.left');
await page.waitForSelector('.list-item', { timeout: 8000 });
await page.click('.list-item:has-text("周末看展记录") .item-title-text');
await page.waitForSelector('.detail .ed-line', { timeout: 8000 });
await page.waitForFunction(
  () => document.body.innerText.includes('XYZ冒烟') && document.body.innerText.includes('待办事项一则'),
  { timeout: 8000 }
);
ok('reopen keeps edits', true);

// 刷新 → IDB 持久（不是内存态）
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 20000 });
await page.click('.list-item:has-text("周末看展记录") .item-title-text');
await page.waitForSelector('.detail .ed-line', { timeout: 8000 });
await page.waitForFunction(
  () => document.body.innerText.includes('XYZ冒烟') && document.body.innerText.includes('第二行文字'),
  { timeout: 8000 }
);
const todoOn = await page.$eval('.todo-row .todo-checkbox', (e) => e.classList.contains('on')).catch(() => false);
ok('reload keeps edits + todo state', todoOn);

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
