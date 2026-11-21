// Rust Web 根治尾巴冒烟：本批次四项修复的覆盖——
// ① 音乐卡状态机（loading 骨架 / error / ready，不再是附件文件行）
// ② 编辑器背景系统（html/body 背景延伸 + body::before 滚动渐变）
// ③ 列表预览剥 Markdown 源码（原版 stripMarkdownForPreview 口径）
// ④ 标题编辑（聚焦输入 / 失焦截断 10 字+… / 清空变无标题）
//
// 关于 ③ 的断言口径（与原版算法逐字仿真核对过）：原版是先把各段
// children[0] 文本以空格 join 再整体 strip，行首锚点 (^|\n) 对每段
// 首行不生效（被 join 的空格挡住），故 allblocks 夹具卡面会保留
// 「> [!NOTE]」段首残片——这与原版自身输出一致（1:1 口径），不断言
// 其消失；断言的是围栏整体吞掉（无 ```、无代码原文、出现「代码块」
// 占位）、段内第二行起的行首标记被剥（无「> 注释」等）。另造一份
// md 段落位于文首的备份，断言完全剥净的形态（无「> [!NOTE]」等）。
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const url = process.argv[2] || 'http://localhost:8096/';
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';

// 造一份「md 源段落位于文首」的备份 zip（测预览剥净形态）
execSync(`python3 - <<'PYEOF'
import json, zipfile, datetime
now = datetime.datetime.now().astimezone()
ts = now.isoformat()
def para(bid, text):
    return {"id": bid, "type": "paragraph", "children": [{"text": text}]}
memo = {"id": "pvstrip1", "title": "预览剥源测试", "pinned": False, "createdAt": ts, "updatedAt": ts,
        "doc": [para("pv1", "> [!NOTE]\\n> 标注正文甲。"),
                para("pv2", "\`\`\`\\nlet x = 1;\\n\`\`\`"),
                para("pv3", "- 无序甲\\n- 无序乙"),
                para("pv4", "1. 有序甲\\n2. 有序乙")]}
data = {"version": 2, "exportedAt": ts, "memos": [memo], "avatars": {}}
man = {"version": 1, "attachments": {}}
z = zipfile.ZipFile('/tmp/preview_strip.zip', 'w')
z.writestr('memos.json', json.dumps(data, ensure_ascii=False))
z.writestr('manifest.json', json.dumps(man))
z.close()
print('preview_strip.zip ready')
PYEOF`);

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const ok = (name, cond, val) => console.log((cond ? '✓ ' : '✗ ') + name + (val !== undefined ? ' = ' + val : ''));

async function openMemoByTitle(title) {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('.img-card-title-text, .list-item .item-title-text')]
      .find((e) => e.textContent.includes(t));
    if (el) el.click();
  }, title);
  await page.waitForSelector('.detail', { timeout: 10000 });
}

async function importZip(zipPath, toastText) {
  await page.$eval('h1.page-title', (e) => e.click());
  await page.waitForSelector('.page-content', { timeout: 8000 });
  await page.click('.set-row:has-text("备份与恢复")');
  await page.waitForSelector('#file-import', { state: 'attached', timeout: 8000 });
  await page.setInputFiles('#file-import', zipPath);
  await page.waitForSelector('.backup-modal', { timeout: 8000 });
  await page.click('.backup-modal .backup-btn.primary');
  await page.waitForFunction(
    (t) => document.querySelector('.status-toast')?.innerText.includes(t),
    toastText,
    { timeout: 15000 }
  );
  await page.click('.editor-fab.left');
  await page.waitForSelector('.page-content', { timeout: 8000 });
  await page.click('.editor-fab.left');
  await page.waitForSelector('.list-item, .img-card', { timeout: 10000 });
}

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 20000 });

// —— ① 音乐卡状态机（种子「最近在听的歌」：4 张 loading 音乐卡） ——
await openMemoByTitle('最近在听的歌');
await page.waitForTimeout(600);
// 轮询捕捉骨架（hydrate 拉取可能很快把它转成 ready/error）
let sawSkel = 0;
let sawLines = 0;
let sawCover = false;
for (let i = 0; i < 25; i++) {
  const s = await page.evaluate(() => ({
    skel: document.querySelectorAll('.detail .link-card-skeleton').length,
    lines: document.querySelectorAll('.detail .link-card-skeleton-line').length,
    cover: !!document.querySelector('.detail .link-card-skeleton-cover'),
  }));
  if (s.skel > 0) {
    sawSkel = s.skel;
    sawLines = s.lines;
    sawCover = s.cover;
    break;
  }
  await page.waitForTimeout(400);
}
await page.waitForTimeout(1500); // 等 hydrate 落定（成功→ready / 失败→error）
const musicFinal = await page.evaluate(() => ({
  skel: document.querySelectorAll('.detail .link-card-skeleton').length,
  err: document.querySelectorAll('.detail .music-card-error').length,
  ready: document.querySelectorAll('.detail .music-card-link').length,
  attFile: document.querySelectorAll('.detail .attachment-file').length,
}));
console.log('MUSIC STATE:', JSON.stringify({ sawSkel, sawLines, sawCover, ...musicFinal }));
ok('music cards no longer render as attachment-file rows', musicFinal.attFile === 0, musicFinal.attFile);
ok(
  'music loading skeleton (cover + >=3 lines) or resolved ready/error',
  (sawSkel > 0 && sawLines >= 3 && sawCover) || musicFinal.skel > 0 || musicFinal.err > 0 || musicFinal.ready > 0
);

// —— ② 背景系统（同一编辑器会话内测） ——
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(600);
const bgTop = await page.evaluate(() => ({
  body: getComputedStyle(document.body).backgroundColor,
  html: getComputedStyle(document.documentElement).backgroundColor,
  before: getComputedStyle(document.body, '::before').backgroundImage,
}));
console.log('BG AT TOP:', JSON.stringify(bgTop));
ok('editor extends bg to html/body (#FAFAFA)', bgTop.body === 'rgb(250, 250, 250)' && bgTop.html === 'rgb(250, 250, 250)');
ok('body::before transparent at scrollY 0', bgTop.before === 'none' || bgTop.before.includes('rgba(0, 0, 0, 0)') || bgTop.before.includes('transparent'), bgTop.before.slice(0, 40));
await page.evaluate(() => window.scrollTo(0, 150));
await page.waitForTimeout(800);
const bgScrolled = await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage);
console.log('BG SCROLLED ::before:', bgScrolled.slice(0, 90));
ok(
  'body::before gradient fades in with editor bg color',
  bgScrolled.includes('linear-gradient') && bgScrolled.includes('rgba(250, 250, 250, 0.82'),
  bgScrolled.slice(0, 60)
);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.click('.editor-fab.left');
await page.waitForSelector('.list-item', { timeout: 10000 });

// —— ③ 预览剥 md（自定义文首 md 备份：完全剥净形态） ——
await importZip('/tmp/preview_strip.zip', '已导入');
const customPreview = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.item-title-text')].find((e) => e.textContent.includes('预览剥源测试'));
  const card = t && t.closest('.list-item');
  const meta = card && card.querySelector('.item-meta');
  return meta ? meta.textContent : '';
});
console.log('CUSTOM PREVIEW:', customPreview);
ok('preview keeps callout body text', customPreview.includes('标注正文甲'));
ok('preview has no > [!NOTE] remnant', !customPreview.includes('> [!NOTE]'));
ok('preview fence becomes 代码块 placeholder', customPreview.includes('代码块') && !customPreview.includes('```') && !customPreview.includes('let x'));
// 注意：段首项的「- 」「1. 」在原版里同样保留——summarizeMemoDoc 先以
// 空格 join 各段再整体 strip，行首锚点对 join 后的段首项不生效（已用
// 同一 zip 在原版实测比对，输出逐字一致）；能判别的是后续行前缀被剥。
ok('preview strips bullet/number prefixes (inner lines)', !customPreview.includes('- 无序乙') && !customPreview.includes('2. 有序') && customPreview.includes('无序乙') && customPreview.includes('有序乙'));

// —— ③′ 预览剥 md（allblocks 夹具卡：与原版 join+strip 口径一致） ——
await importZip(process.env.HOME + '/workspace/Mynote/fixtures/allblocks.zip', '已导入');
const fixturePreview = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.img-card-title-text, .item-title-text')].find((e) => e.textContent.includes('全块渲染测试'));
  const card = t && t.closest('.list-item, .img-card');
  const meta = card && card.querySelector('.item-meta, .glass-label');
  return meta ? meta.textContent : '';
});
console.log('FIXTURE PREVIEW:', fixturePreview);
ok('fixture preview starts with first paragraph text', fixturePreview.includes('普通段落：行内样式混合'));
ok('fixture preview shows callout body as plain text', fixturePreview.includes('注释类标注块正文'));
ok('fixture preview has no fence backticks or code text', !fixturePreview.includes('```') && !fixturePreview.includes('fn main()'));
ok('fixture preview strips inner-line quote markers', !fixturePreview.includes('> 注释') && !fixturePreview.includes('> 警告') && !fixturePreview.includes('> 提示'));

// —— ④ 标题编辑（全块渲染测试编辑器内） ——
await openMemoByTitle('全块渲染测试');
await page.waitForSelector('#editor-title-text', { timeout: 8000 });
const titleInit = await page.$eval('#editor-title-text', (e) => e.textContent);
ok('title shows memo title initially', titleInit === '全块渲染测试', titleInit);

const LONG_TITLE = '这是一个非常长的标题用来测试截断';
await page.click('#editor-title-text');
await page.waitForTimeout(300);
const focused = await page.evaluate(() => document.activeElement && document.activeElement.id === 'editor-title-text');
if (!focused) await page.$eval('#editor-title-text', (e) => e.focus());
await page.keyboard.press('Control+a');
await page.keyboard.type(LONG_TITLE);
await page.waitForTimeout(400);
await page.click('.detail .ed-line >> nth=0'); // 失焦提交
await page.waitForTimeout(600);
const titleShown = await page.$eval('#editor-title-text', (e) => e.textContent);
const expectTrunc = LONG_TITLE.slice(0, 10) + '…';
console.log('TITLE AFTER BLUR:', titleShown, '| expect:', expectTrunc);
ok('long title truncates to 10 chars + … on blur', titleShown === expectTrunc, titleShown);

await page.click('#editor-title-text');
await page.waitForTimeout(300);
await page.keyboard.press('Control+a');
await page.keyboard.press('Backspace');
await page.waitForTimeout(200);
await page.click('.detail .ed-line >> nth=0'); // 失焦提交
await page.waitForTimeout(600);
const titleCleared = await page.$eval('#editor-title-text', (e) => e.textContent);
ok('cleared title falls back to 无标题 on blur', titleCleared === '无标题', titleCleared);

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
