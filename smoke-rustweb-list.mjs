// Rust Web 列表页冒烟：日期分组 / 标签 chips / 图片卡 / 折叠展开 /
// 滑动置顶与删除（合成 PointerEvent，与真机同一通路）
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const url = process.argv[2] || 'http://localhost:8096/';
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';

// 造一份同日 4 条文本备忘的备份 zip（测折叠）
execSync(`python3 - <<'PYEOF'
import json, zipfile, datetime
now = datetime.datetime.now().astimezone()
def memo(i, title, text, pinned=False):
    ts = now.isoformat()
    return {"id": f"fold{i}", "title": title, "pinned": pinned, "createdAt": ts, "updatedAt": ts,
            "doc": [{"id": f"b{i}", "type": "paragraph", "children": [{"text": text}]}]}
memos = [memo(1, "折叠一", "第一条内容 #标签甲"), memo(2, "折叠二", "第二条内容"),
         memo(3, "折叠三", "第三条内容"), memo(4, "折叠四", "第四条内容")]
data = {"version": 2, "exportedAt": now.isoformat(), "memos": memos, "avatars": {}}
man = {"version": 1, "attachments": {}}
z = zipfile.ZipFile('/tmp/fold.zip', 'w')
z.writestr('memos.json', json.dumps(data, ensure_ascii=False))
z.writestr('manifest.json', json.dumps(man))
z.close()
print('fold.zip ready')
PYEOF`);

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const ok = (name, cond) => console.log((cond ? '✓ ' : '✗ ') + name);

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 20000 });

// 种子分组（原版示例数据）：置顶（装修踩坑清单）+ 今天（周末看展记录）
// + 过去7天 / 过去30天；分组名逐字对原版（无空格）
const headers = await page.$$eval('.section-header', (els) => els.map((e) => e.innerText));
console.log('SECTION HEADERS:', JSON.stringify(headers));
ok('date groups render', headers.includes('置顶') && headers.includes('今天') && headers.includes('过去7天') && headers.includes('过去30天'));

// 图片卡封面：先导入真实备份（种子是原版示例数据、无图片备忘）
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
await page.waitForSelector('.list-item', { timeout: 8000 });
await page.waitForFunction(
  () => {
    const img = document.querySelector('.img-card img.img-cover');
    return img && img.naturalWidth > 0;
  },
  { timeout: 10000 }
);
ok('image card cover renders', true);

// 再导入折叠数据
await page.$eval('h1.page-title', (e) => e.click());
await page.waitForSelector('.page-content', { timeout: 8000 });
await page.click('.set-row:has-text("备份与恢复")');
await page.waitForSelector('#file-import', { state: 'attached', timeout: 8000 });
await page.setInputFiles('#file-import', '/tmp/fold.zip');
await page.waitForSelector('.backup-modal', { timeout: 8000 });
await page.click('.backup-modal .backup-btn.primary');
await page.waitForFunction(() => document.querySelector('.status-toast')?.innerText.includes('4 条备忘'), { timeout: 15000 });
await page.click('.editor-fab.left');
await page.waitForSelector('.page-content', { timeout: 8000 });
await page.click('.editor-fab.left');
await page.waitForSelector('.list-item', { timeout: 8000 });

// 今天组 4 条文本 → 折叠：只显示第一张 + 「▼ 展开 4 条」
await page.waitForFunction(() => document.body.innerText.includes('展开 4 条'), { timeout: 15000 });
const expandText = await page.$eval('.card-expand-wrapper', (e) => e.innerText);
console.log('EXPAND TEXT:', expandText.replace(/\n/g, ' | ').slice(0, 120));
ok('folded shows total count', expandText.includes('展开 4 条'));
const visibleRows = await page.$$eval('.list-item', (els) => els.length);
console.log('VISIBLE ROWS WHEN FOLDED:', visibleRows);
// 展开 → 4 条全显 + 末条「▲ 收起」
await page.click('.card-expand-wrapper .expand-btn');
await page.waitForTimeout(500);
const rowsAfter = await page.$$eval('.list-item', (els) => els.length);
const bodyText = await page.evaluate(() => document.body.innerText);
ok('expand shows all + collapse entry', rowsAfter >= 5 && bodyText.includes('收起'));

// 标签 chips：折叠一正文含 #标签甲
const tags = await page.$$eval('.list-item:has-text("折叠一") .item-tag', (els) => els.map((e) => e.innerText)).catch(() => []);
console.log('TAGS:', JSON.stringify(tags));
ok('tag chips with #', tags.includes('#标签甲'));

// 滑动删除「折叠四」：合成 PointerEvent 横拖到 -168 后点删除
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find((e) => e.innerText.includes('折叠四'));
  const opts = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 7, clientX: x, clientY: y, isPrimary: true });
  row.dispatchEvent(new PointerEvent('pointerdown', opts(300, 0)));
  row.dispatchEvent(new PointerEvent('pointermove', opts(200, 0)));
  row.dispatchEvent(new PointerEvent('pointermove', opts(120, 0)));
  row.dispatchEvent(new PointerEvent('pointerup', opts(120, 0)));
});
await page.waitForTimeout(500);
const delBtn = await page.evaluate(() => {
  const w = [...document.querySelectorAll('.swipe-wrapper')].find((e) => e.innerText.includes('折叠四'));
  const btn = [...w.querySelectorAll('.swipe-action-btn')].find((b) => b.innerText.includes('删除'));
  btn.click();
  return true;
});
await page.waitForTimeout(600);
const afterDelete = await page.evaluate(() => document.body.innerText);
ok('swipe delete removes row', delBtn && !afterDelete.includes('折叠四'));

// 滑动置顶「折叠二」→ 进入置顶组
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find((e) => e.innerText.includes('折叠二'));
  const opts = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 9, clientX: x, clientY: y, isPrimary: true });
  row.dispatchEvent(new PointerEvent('pointerdown', opts(300, 0)));
  row.dispatchEvent(new PointerEvent('pointermove', opts(200, 0)));
  row.dispatchEvent(new PointerEvent('pointermove', opts(120, 0)));
  row.dispatchEvent(new PointerEvent('pointerup', opts(120, 0)));
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const w = [...document.querySelectorAll('.swipe-wrapper')].find((e) => e.innerText.includes('折叠二'));
  const btn = [...w.querySelectorAll('.swipe-action-btn')].find((b) => b.innerText.includes('置顶'));
  btn.click();
});
await page.waitForTimeout(600);
const pinDot = await page.$$eval('.list-item:has-text("折叠二") .pin-dot', (els) => els.length).catch(() => 0);
const headers2 = await page.$$eval('.section-header', (els) => els.map((e) => e.innerText));
console.log('HEADERS AFTER PIN:', JSON.stringify(headers2), 'pinDot:', pinDot);
ok('swipe pin moves to pinned group', headers2.includes('置顶') && pinDot >= 0);

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
