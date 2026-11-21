// Rust Web 冒烟 · Wiki 链接与反向链接：
// 导入「目标笔记」+「来源笔记」（含别名链、不存在链、代码围栏内
// 假链、行内代码内链）→ 来源篇里链接成锚点可点 → 点别名链跳
// 目标篇 → 目标篇反向链接区块出现且可回跳 → 点不存在链新建
// 同名备忘 → 围栏/行内代码里的 [[…]] 不成链。
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const url = process.argv[2] || 'http://localhost:8096/';
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';

execSync(`python3 - <<'PYEOF'
import json, zipfile, datetime
now = datetime.datetime.now().astimezone()
ts = now.isoformat()
def para(bid, text):
    return {"id": bid, "type": "paragraph", "children": [{"text": text}]}
a = {"id": "wikitarget1", "title": "目标笔记", "pinned": False, "createdAt": ts, "updatedAt": ts,
     "doc": [para("wa1", "这是目标笔记正文。")]}
b = {"id": "wikisource1", "title": "来源笔记", "pinned": False, "createdAt": ts, "updatedAt": ts,
     "doc": [para("wb1", "参考 [[目标笔记|打开目标]]，之后 [[新建笔记]]。"),
             para("wb2", "\`\`\`\\n[[假链接]]\\n\`\`\`"),
             para("wb3", "行内代码 \`[[目标笔记]]\` 不成链")]}
data = {"version": 2, "exportedAt": ts, "memos": [a, b], "avatars": {}}
man = {"version": 1, "attachments": {}}
z = zipfile.ZipFile('/tmp/wiki_test.zip', 'w')
z.writestr('memos.json', json.dumps(data, ensure_ascii=False))
z.writestr('manifest.json', json.dumps(man))
z.close()
print('wiki_test.zip ready')
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
  await page.waitForSelector('.detail', { timeout: 10000 });
  await page.waitForTimeout(400);
}

async function editorTitle() {
  return page.evaluate(() => document.querySelector('#editor-title-text')?.textContent || '');
}

async function backToList() {
  await page.click('.editor-fab.left');
  await page.waitForSelector('.list-item, .img-card', { timeout: 10000 });
  await page.waitForTimeout(300);
}

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 20000 });
await importZip('/tmp/wiki_test.zip');

// —— 来源篇：链接成锚点 ——
await openMemoByTitle('来源笔记');
const links = await page.$$eval('a.mynote-wiki-link', (els) => els.map((e) => ({ t: e.getAttribute('data-note-title'), label: e.textContent })));
console.log('WIKI LINKS:', JSON.stringify(links));
ok('two wiki anchors render', links.length === 2, links.length);
ok('alias link target/label', links.some((l) => l.t === '目标笔记' && l.label === '打开目标'));
ok('missing-target link renders too', links.some((l) => l.t === '新建笔记' && l.label === '新建笔记'));
const fenceText = await page.evaluate(() => document.querySelector('.md-preview pre code')?.textContent || '');
ok('fence content stays code (no anchor inside)', fenceText.includes('[[假链接]]'), fenceText.trim());

// —— 点别名链 → 跳目标篇（编辑器重挂） ——
await page.click('a.mynote-wiki-link[data-note-title="目标笔记"]');
await page.waitForTimeout(800);
ok('nav to target memo', (await editorTitle()).includes('目标笔记'), await editorTitle());

// —— 目标篇反向链接区块 ——
const bl = await page.evaluate(() => {
  const sec = document.querySelector('.wiki-backlinks');
  if (!sec) return null;
  return { title: sec.querySelector('.wiki-backlinks-title')?.textContent, items: [...sec.querySelectorAll('.wiki-backlink')].map((b) => b.textContent) };
});
console.log('BACKLINKS:', JSON.stringify(bl));
ok('backlinks section shows source memo', !!bl && bl.items.some((t) => t.includes('来源笔记')), JSON.stringify(bl));
await page.click('.wiki-backlink');
await page.waitForTimeout(800);
ok('backlink click returns to source', (await editorTitle()).includes('来源笔记'), await editorTitle());

// —— 点不存在链 → 新建同名备忘并打开 ——
await page.click('a.mynote-wiki-link[data-note-title="新建笔记"]');
await page.waitForTimeout(800);
ok('missing target creates + opens memo', (await editorTitle()).includes('新建笔记'), await editorTitle());
await backToList();
const titles = await page.$$eval('.img-card-title-text, .list-item .item-title-text', (els) => els.map((e) => e.textContent));
ok('created memo appears in list', titles.some((t) => t.includes('新建笔记')), titles.join('/'));

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
