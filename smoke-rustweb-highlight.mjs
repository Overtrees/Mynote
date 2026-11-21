// Rust Web 高亮冒烟：编辑器 ==高亮== 实时效果三路——
// ① 手打 ==重点== 闭合瞬间就地包 <mark>（不等重开）
// ② 斜杠高亮命令空选区插入 mark 占位、键入即带高亮
// ③ __mnInline 有选区时直接包 mark
// 以及往返持久：刷新后 mark 仍在且 == 不露字面（存 ==、显 mark）
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
await page.click('.list-item:has-text("周末看展记录") .item-title-text');
await page.waitForSelector('.detail .ed-line', { timeout: 8000 });

// 度量对原版：正文左内距 16（段落宽 361 @393）、字数 114
// （原版口径：只统计段落块首叶；标题 4 字不计）
const padLeft = await page.$eval('.detail .ed-line', (e) => Math.round(e.getBoundingClientRect().left));
const metaText = await page.$eval('.editor-title-meta', (e) => e.innerText);
console.log('PAD LEFT:', padLeft, 'META:', metaText);
ok('editor padding-left 16', padLeft === 16);
ok('word count matches original formula (114)', metaText.includes('114字'));

// ⓪ 种子备忘自带的 ==…==（周末看展记录第二段）打开编辑器即应是 mark
const seedMark = await page.$$eval('.detail mark.mynote-highlight', (els) => els.map((e) => e.textContent));
console.log('SEED MARKS:', JSON.stringify(seedMark));
ok('existing == renders as mark on open', seedMark.some((t) => t.includes('所谓的边界')));

// ① 手打 ==重点==：闭合 == 打完应立即成 mark
await page.click('.detail .ed-line >> nth=0');
await page.keyboard.press('End');
await page.keyboard.type('前==重点==后');
await page.waitForTimeout(500);
const mark1 = await page.$eval('.detail [data-bid] mark.mynote-highlight', (e) => e.textContent).catch(() => null);
console.log('MARK1:', mark1);
ok('typed ==x== becomes mark in place', mark1 === '重点');
const blockText1 = await page.$eval('.detail .ed-line >> nth=0', (e) => e.innerText).catch(() => '');
ok('no literal == left in block', !blockText1.includes('=='));

// ② 斜杠高亮（空选区）：新块输入 / → 点高亮 → 键入带高亮
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.keyboard.type('/');
await page.waitForSelector('.slash-panel .slash-row[data-act="highlight"]', { timeout: 8000 });
await page.click('.slash-panel .slash-row[data-act="highlight"]');
await page.waitForTimeout(400);
await page.keyboard.type('斜杠亮');
await page.waitForTimeout(400);
const marks2 = await page.$$eval('.detail mark.mynote-highlight', (els) => els.map((e) => e.textContent));
console.log('MARKS2:', JSON.stringify(marks2));
ok('slash highlight types into mark', marks2.some((t) => t.includes('斜杠亮')));

// ③ 有选区包 mark：直接走桥函数（与斜杠行内命令同一通路）
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.keyboard.type('包裹测试');
await page.waitForTimeout(300);
const wrapped = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('.detail [data-bid]'));
  const el = els.find((e) => e.textContent.includes('包裹测试'));
  if (!el) return 'no-el';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n && !n.textContent.includes('包裹测试')) n = walker.nextNode();
  if (!n) return 'no-text';
  const range = document.createRange();
  range.setStart(n, n.textContent.indexOf('包裹测试'));
  range.setEnd(n, n.textContent.indexOf('包裹测试') + 4);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return new Promise((resolve) => setTimeout(() => {
    const html = window.__mnInline ? window.__mnInline('highlight', el.dataset.bid) : 'no-fn';
    resolve(html);
  }, 250));
});
console.log('WRAPPED:', wrapped);
ok('selection wrapped in mark', typeof wrapped === 'string' && wrapped.includes('<mark class="mynote-highlight">包裹测试</mark>'));

// 诊断：实时高亮同步应有 EDIT 日志
await page.waitForTimeout(300);
const diag = await page.evaluate(() => localStorage.getItem('mynote_diag_v1') || '');
ok('diag logs highlight sync', diag.includes('highlight mark synced'));

// ④ 刷新持久：mark 仍在（存字面 ==、打开重写 mark），且不露 ==
await page.click('.editor-fab.left');
await page.waitForSelector('.list-item', { timeout: 8000 });
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 20000 });
await page.click('.list-item:has-text("周末看展记录") .item-title-text');
await page.waitForSelector('.detail .ed-line', { timeout: 8000 });
await page.waitForFunction(
  () => Array.from(document.querySelectorAll('.detail mark.mynote-highlight')).some((e) => e.textContent === '重点'),
  { timeout: 8000 }
);
const marksAfter = await page.$$eval('.detail mark.mynote-highlight', (els) => els.map((e) => e.textContent));
console.log('MARKS AFTER RELOAD:', JSON.stringify(marksAfter));
ok('marks survive reload', marksAfter.includes('重点') && marksAfter.some((t) => t.includes('斜杠亮')));
const detailText = await page.$eval('.detail', (e) => e.innerText);
ok('no literal == after reload', !detailText.includes('=='));

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
