// Rust Web 编辑器菜单冒烟：••• 面板结构 → 撤销/重做 → 背景色
// 底表 → 导出面板 MD 下载 → 添加附件
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:8096/';
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const ok = (name, cond) => console.log((cond ? '✓ ' : '✗ ') + name);

// 1x1 PNG 供附件测试
writeFileSync('/tmp/px.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));


// 菜单开关助手：面板打开走全量同步 eval，重复点击会翻转状态，
// 一律先查状态再点，避免竞态
const openMenu = async () => {
  if (await page.$('.editor-menu-panel')) return;
  await page.click('.editor-fab.right');
  await page.waitForSelector('.editor-menu-panel', { timeout: 12000 });
  await page.waitForTimeout(400);
};
const closeMenu = async () => {
  if (!(await page.$('.editor-menu-panel'))) return;
  await page.click('.menu-scrim');
  await page.waitForSelector('.editor-menu-panel', { state: 'detached', timeout: 8000 }).catch(() => {});
};

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 20000 });
await page.click('.list-item:has-text("周末看展记录") .item-title-text');
await page.waitForSelector('.detail .ed-line', { timeout: 8000 });

// 菜单面板：宽度 246、条目齐全、双栏行在窄屏隐藏
await openMenu();
const menuBox = await page.$eval('.editor-menu-panel', (e) => e.getBoundingClientRect().width);
console.log('MENU WIDTH:', menuBox);
ok('menu panel width 246', Math.round(menuBox) === 246);
const menuText = await page.$eval('.editor-menu-panel', (e) => e.textContent);
ok('menu items complete', ['双栏独立滚动', '撤销', '重做', '添加附件', '导出笔记', '更换背景色'].every((s) => menuText.includes(s)));
const twopaneVisible = await page.$eval('.menu-item.twopane-row', (e) => getComputedStyle(e).display !== 'none');
ok('twopane row hidden on narrow screen', !twopaneVisible);
await closeMenu();

// 输入 → 撤销 → 重做
await page.click('.detail .ed-line >> nth=0');
await page.keyboard.press('End');
await page.keyboard.type('撤销测试文字');
await page.waitForTimeout(400);
await openMenu();
const undoBtn = page.locator('.editor-menu-panel .menu-item:has-text("撤销")');
ok('undo enabled after typing', await undoBtn.isEnabled());
await undoBtn.click();
await page.waitForTimeout(500);
const afterUndo = await page.evaluate(() => document.body.innerText);
ok('undo reverts typing', !afterUndo.includes('撤销测试文字'));
await openMenu();
await page.locator('.editor-menu-panel .menu-item:has-text("重做")').click();
await page.waitForTimeout(500);
const afterRedo = await page.evaluate(() => document.body.innerText);
ok('redo restores typing', afterRedo.includes('撤销测试文字'));

// 背景色：菜单 → 底表 → 选色 → 根背景生效 → 移除
await openMenu();
await page.locator('.editor-menu-panel .menu-item:has-text("更换背景色")').click();
await page.waitForSelector('.bg-sheet', { timeout: 8000 });
await page.click('.bg-dot >> nth=2');
await page.waitForTimeout(400);
const bgStyle = await page.$eval('#editor-root', (e) => e.style.background);
console.log('BG STYLE:', bgStyle);
ok('bg color applies', bgStyle.includes('rgb(212, 232, 208)'));
await openMenu();
await page.locator('.editor-menu-panel .menu-item:has-text("更换背景色")').click();
await page.waitForSelector('.bg-sheet', { timeout: 8000 });
await page.click('.bg-remove');
await page.waitForTimeout(400);
const bgStyle2 = await page.$eval('#editor-root', (e) => e.style.background);
ok('bg color removed', !bgStyle2.includes('rgb(212, 232, 208)'));

// 导出面板：MD 下载
await openMenu();
await page.locator('.editor-menu-panel .menu-item:has-text("导出笔记")').click();
await page.waitForSelector('.editor-export-panel', { timeout: 8000 });
const expText = await page.$eval('.editor-export-panel', (e) => e.innerText);
ok('export panel has MD/HTML/PDF', expText.includes('Markdown') && expText.includes('HTML') && expText.includes('PDF'));
const dlPromise = page.waitForEvent('download', { timeout: 15000 });
await page.locator('.editor-export-choice:has-text("Markdown")').click();
const dl = await dlPromise;
await dl.saveAs('/tmp/note-export.md');
const md = await import('node:fs').then((fs) => fs.readFileSync('/tmp/note-export.md', 'utf8'));
console.log('MD HEAD:', md.slice(0, 60).replace(/\n/g, ' '));
ok('md export contains content', md.includes('UCCA') || md.includes('所谓的边界'));

// 添加附件：菜单 label 里的 file input
await openMenu();
await page.setInputFiles('#file-attach', '/tmp/px.png');
await page.waitForSelector('.detail .atomic[data-type="image"] img', { timeout: 10000 });
ok('attach appends image block', true);

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
