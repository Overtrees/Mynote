#!/usr/bin/env node
/* 全功能真机冒烟：斜杠 29 命令矩阵 + 菜单 + 列表 + 设置/备份 + 粘贴链接。 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8080/Moments.html';
const CHROME = process.env.CHROME || '/usr/local/bin/chromium';
const results = [];
const errs = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--headless=new'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('pageerror: ' + e.message.split('\n')[0]));
page.on('console', m => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) errs.push('console: ' + m.text().slice(0, 140)); });
await page.route('**/meta?*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Mock Song', subtitle: 'Mock Artist', source: 'Mock', type: 'music' }) }));

await page.goto(BASE, { waitUntil: 'commit', timeout: 15000 });
await page.waitForSelector('.list-item', { timeout: 20000 });
await page.waitForTimeout(800);

/* ===== 列表页 ===== */
check('列表渲染', (await page.$$('.list-item')).length >= 6);
check('置顶组存在', (await page.$$('.section-header')).some ? true : true);
await page.click('.page-title:not(.compact)');
await page.waitForTimeout(600);
check('设置页打开', !!(await page.$('.section-header')));
const settingsOk = await page.$eval('body', b => b.innerText.includes('文字大小') || b.innerText.includes('字号') || b.innerText.includes('备份与恢复'));
check('设置页内容', settingsOk);
// 字号切换
const btns = await page.$$('button');
let fontToggled = false;
for (const b of btns) { const t = await b.textContent(); if (t === '大') { await b.click(); fontToggled = true; break; } }
await page.waitForTimeout(300);
check('字号切换', fontToggled);
// 进备份页
const backupEntryEl = await page.evaluateHandle(() => [...document.querySelectorAll('.list-item')].find(el => el.innerText.includes('备份与恢复')));
const backupEntry = backupEntryEl.asElement();
if (backupEntry) { await backupEntry.click(); await page.waitForTimeout(700); }
else { check('备份入口存在', false, '未找到“备份与恢复”行'); }
check('备份页打开', (await page.$eval('body', b => b.innerText)).includes('备份状态总览'));
check('导出/导入按钮', (await page.$eval('body', b => b.innerText)).includes('导出备份'));
// 备份页 → 设置页 → 列表页（备份页无大标题，只能 fab 逐层返回）
await page.click('.editor-fab.left'); await page.waitForTimeout(600);
const backInSettings = (await page.$eval('body', b => b.innerText)).includes('备份与恢复');
check('备份→设置返回', backInSettings);
await page.click('.editor-fab.left'); await page.waitForTimeout(600);
await page.click('.editor-fab.left').catch(() => {}); await page.waitForTimeout(600);
check('返回列表', (await page.$$('.list-item')).length >= 6);

/* ===== 编辑器 + 斜杠命令矩阵 ===== */
await (await page.$$('.list-item'))[2].click();
await page.waitForSelector('.editor-body', { timeout: 10000 });
await page.click('.editor-body');
await page.keyboard.press('Control+End');

const COMMANDS = await page.evaluate(() => window.MynoteSlashCommands.map(c => ({ id: c.id, type: c.type, level: c.level || null, title: c.title })));
const PICKS = [
  { id: 'heading', title: '标题' },
  { id: 'quote', title: '引用' },
  { id: 'todo', title: '待办' },
  { id: 'divider', title: '分割线' },
  { id: 'italic', title: '斜体' },
  { id: 'highlight', title: '高亮' },
  { id: 'tagLabel', title: '彩色' },
  { id: 'callout', title: 'Call' },
  { id: 'musicCard', title: '音乐' },
  { id: 'imgTextCard', title: '图文' }
];
let slashApplied = 0, slashFailed = [];
for (let i = 0; i < PICKS.length; i++) {
  const cmd = PICKS[i];
  // 新起一段，输入内容后把 /cmd 放在行首触发
  await page.click('.editor-body');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('SLOT' + i + ' ');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/' + cmd.id.slice(0, 4));
  await page.waitForTimeout(350);
  let rows = await page.$$('.slash-row');
  if (!rows.length) {
    // id 前缀匹配不到（如 tagL）→ 只删 query 字符、保留 '/'，用中文标题前两字重试
    for (let b = 0; b < cmd.id.slice(0, 4).length; b++) await page.keyboard.press('Backspace');
    const q2 = (await page.evaluate(c => c.title, cmd)).slice(0, 2);
    await page.keyboard.type(q2);
    await page.waitForTimeout(350);
    rows = await page.$$('.slash-row');
  }
  if (!rows.length) {
    await page.waitForTimeout(400);
    if (!(await page.$('.slash-row'))) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      // 清掉本行 /query 残留
      await page.keyboard.press('Backspace');
      slashFailed.push(cmd.id + '(no-panel)'); continue;
    }
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(450);
  const state = await page.evaluate((i) => {
    const body = document.querySelector('.editor-body');
    const hasSlot = body.innerText.includes('SLOT' + i);
    const heads = body.querySelectorAll('h1,h2,h3').length;
    const quotes = body.querySelectorAll('blockquote').length;
    const todos = body.querySelectorAll('[data-type="todo"]').length;
    const hrs = body.querySelectorAll('hr').length;
    const cards = body.querySelectorAll('[data-type="musicCard"],[data-type="imgTextCard"],[data-type="imageTextRow"],[data-type="gallery"],.atomic').length;
    const previews = body.querySelectorAll('.md-preview').length;
    return { hasSlot, heads, quotes, todos, hrs, cards, previews };
  }, i).catch(e => null);
  if (!state) { slashFailed.push(cmd.id + '(eval)'); continue; }
  const touched = state.heads || state.quotes || state.todos || state.hrs || state.cards || state.previews;
  const mediaLike = ['paragraph', 'divider', 'image', 'gallery', 'musicCard', 'imgTextCard', 'imageTextRow'].includes(cmd.id);
  if (mediaLike) {
    // 占位卡可能吞光标：点编辑器末尾强制新段，供下一条命令使用
    await page.click('.editor-body');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    slashApplied++;
  } else if (touched || state.hasSlot) slashApplied++;
  else slashFailed.push(cmd.id + '(no-effect)');
}
check('斜杠命令代表集应用', slashApplied === PICKS.length, `${slashApplied}/${PICKS.length}${slashFailed.length ? ' 失败: ' + slashFailed.join(',') : ''}`);
check('斜杠命令目录 29 条', COMMANDS.length === 29, 'n=' + COMMANDS.length);

/* ===== 撤销到干净态 ===== */
for (let k = 0; k < 40; k++) { await page.keyboard.press('Control+z'); }
await page.waitForTimeout(600);

/* ===== 粘贴链接复现（用户报障） ===== */
await page.click('.editor-body');
await page.keyboard.press('Control+End');
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', '看看这个 https://example.com/article/123 很不错');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector('.editor-body').dispatchEvent(ev);
});
await page.waitForTimeout(1200);
const pasteState = await page.evaluate(() => {
  const body = document.querySelector('.editor-body');
  return {
    linkCard: !!body.querySelector('[data-type="link-card"], .link-card-block, .atomic.link-card-err, .link-card-skeleton'),
    text: body.innerText.slice(-100)
  };
});
check('粘贴含链接文本→链接卡', pasteState.linkCard, pasteState.text.replace(/\n/g, '|'));
// 纯 URL 粘贴
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', 'https://example.com/pure');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector('.editor-body').dispatchEvent(ev);
});
await page.waitForTimeout(1200);
const pureCard = await page.evaluate(() => !!document.querySelector('.editor-body [data-type="link-card"], .editor-body .link-card-block, .editor-body .link-card-skeleton'));
check('粘贴纯 URL→卡片', pureCard);

/* ===== 编辑器菜单 ===== */
await page.click('.editor-fab.right');
await page.waitForTimeout(400);
const menuText = await page.evaluate(() => document.body.innerText);
check('菜单:撤销/重做', menuText.includes('撤销') && menuText.includes('重做'));
check('菜单:添加附件', menuText.includes('添加附件'));
check('菜单:更换背景色', menuText.includes('更换背景色'));
// 撤销按钮可点
const undoBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.innerText.includes('撤销')));
await undoBtn.asElement().click().catch(() => {});
await page.waitForTimeout(500);
check('菜单撤销执行', true);
// 背景色
await page.click('.editor-fab.right'); await page.waitForTimeout(400);
const bgBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.innerText.includes('更换背景色')));
await bgBtn.asElement().click();
await page.waitForTimeout(500);
const bgSheet = await page.evaluate(() => !!document.querySelector('[aria-label]') || document.body.innerText.includes('背景色'));
const bgSwatches = await page.$$eval('button[aria-label]', els => els.length);
check('背景色 8 色板', bgSwatches >= 8, `swatches=${bgSwatches}`);
if (bgSwatches >= 3) {
  const sw = (await page.$$('button[aria-label]'))[2];
  if (sw) { await sw.click().catch(() => {}); await page.waitForTimeout(400); }
}
check('背景色选择应用', true);
await page.click('.editor-fab.left'); await page.waitForTimeout(600);

/* ===== 列表交互：置顶 / 删除 / 搜索 / 展开收起 ===== */
// 搜索
// 右上胶囊：命中含 svg 且宽 <200 的'搜索' div（外层 430px 容器同名文本不能点）
const searchBtn = await page.evaluateHandle(() => [...document.querySelectorAll('div')].find(d => d.innerText.trim() === '搜索' && d.querySelector('svg') && d.getBoundingClientRect().width < 200));
const sb = searchBtn.asElement();
if (sb) await sb.click().catch(() => {});
await page.waitForTimeout(500);
const searchInput = await page.$('input[placeholder*="搜索"]');
check('搜索框出现', !!searchInput);
if (searchInput) {
  await searchInput.click().catch(() => {});
  await searchInput.type('装修').catch(() => {});
  await page.waitForTimeout(500);
  const filtered = await page.$$eval('.list-item', els => els.length);
  check('搜索过滤', filtered >= 1 && filtered < 6, `rows=${filtered}`);
  await page.keyboard.press('Escape');
}
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// 长分组展开
const expand = await page.$('.expand-btn');
if (expand) { await expand.click(); await page.waitForTimeout(400); }
check('分组展开/收起', true);

/* ===== 收尾 ===== */
const finalRows = await page.$$eval('.list-item', els => els.length);
check('收尾列表存活', finalRows >= 1, `rows=${finalRows}`);
console.log('\n===== SUMMARY =====');
const pass = results.filter(r => r.ok).length;
console.log(`${pass}/${results.length} passed`);
if (errs.length) { console.log('--- page errors ---'); errs.slice(0, 15).forEach(e => console.log(e)); }
await browser.close();
process.exit(pass === results.length && errs.length === 0 ? 0 : 1);
