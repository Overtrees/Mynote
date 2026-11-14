#!/usr/bin/env node
/**
 * 浏览器冒烟：用真实 Chromium 验证「线上/本地页面」的关键链路。
 *
 *   node tests/browser/smoke.mjs                        # 打 http://127.0.0.1:8080/Moments.html
 *   BASE=https://overtrees.github.io/Mynote/Moments.html node tests/browser/smoke.mjs
 *
 * 需要本机已装 playwright-core（npm i -D playwright-core）与一个 Chromium：
 *   CHROME=/usr/bin/chromium（默认值）；沙箱里若走 MITM 代理需 --proxy-server=direct://。
 *
 * 覆盖：列表渲染、编辑器打开、撤销/重做、Markdown 前缀转换不报错、
 *       原子恢复（stage 失败不改数据 / commit 失败整体回滚 / 成功路径生效）。
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8080/Moments.html';
const CHROME = process.env.CHROME || '/usr/bin/chromium';
const ARGS = ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
page.on('console', m => { if (m.type() === 'error' && !/404|CERT|Failed to load resource/.test(m.text())) errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
await page.waitForSelector('.list-item', { timeout: 30000 });
await page.waitForTimeout(1500);

const rows = await page.$$('.list-item');
check('列表渲染', rows.length >= 2, `${rows.length} 行`);

// ---- 撤销 / 重做 ----
await rows[2].click();
await page.waitForSelector('.editor-body');
await page.waitForTimeout(800);
await page.click('.editor-body');
await page.keyboard.press('Control+End');
await page.keyboard.type('ZZTEST');
await page.waitForTimeout(900);
const typed = await page.$eval('.editor-body', e => e.innerText);
await page.keyboard.press('Control+z'); await page.waitForTimeout(700);
const undone = await page.$eval('.editor-body', e => e.innerText);
await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(700);
const redone = await page.$eval('.editor-body', e => e.innerText);
check('输入生效', typed.includes('ZZTEST'));
check('撤销移除输入', !undone.includes('ZZTEST'));
check('重做恢复输入', redone.includes('ZZTEST'));

// ---- 前缀转换 ----
await page.click('.editor-body');
await page.keyboard.press('Control+End');
await page.keyboard.type('\n## 标题转换测试');
await page.waitForTimeout(1200);
const conv = await page.evaluate(() => ({
  has: document.querySelector('.editor-body').innerText.includes('标题转换测试'),
  blocks: document.querySelectorAll('.md-preview.block').length
}));
check('前缀转换后正文仍在', conv.has, `blocks=${conv.blocks}`);

// ---- 原子恢复 ----
const restore = await page.evaluate(async () => {
  const C = window.MynoteIdb, db = await C.getDB();
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  const keys = s => new Promise(res => { const t = db.transaction(s, 'readonly'); const r = t.objectStore(s).getAllKeys(); r.onsuccess = () => res(r.result.slice().sort()); });
  const good = {
    'memos.json': fflate.strToU8('{"version":2,"memos":[]}'),
    'manifest.json': fflate.strToU8('{"version":1,"attachments":{"a9":{"name":"n.png","type":"image/png"}}}'),
    'attachments/a9_n.png': png
  };
  const before = { att: await keys('attachments'), memos: await keys('memos') };
  let stageErr = null, commitErr = null;
  try { await C.restoreFromZipAtomic(db, { ...good, 'attachments/zz_bad.png': null }, { memos: [{ id: 'nope', title: 'x', doc: [] }] }, {}); }
  catch (e) { stageErr = e.message; }
  const afterStage = { att: await keys('attachments'), memos: await keys('memos') };
  try { await C.restoreFromZipAtomic(db, good, { memos: [{ title: '缺 id 的脏数据', doc: [] }] }, {}); }
  catch (e) { commitErr = (e && e.name) || 'error'; }
  const afterCommit = { att: await keys('attachments'), memos: await keys('memos') };
  const ok = await C.restoreFromZipAtomic(db, good, { memos: [{ id: 'ok1', title: '正常', doc: [] }] }, {});
  return {
    stageErr, commitErr, ok,
    stageIntact: JSON.stringify(before) === JSON.stringify(afterStage),
    commitIntact: JSON.stringify(before) === JSON.stringify(afterCommit),
    finalAtt: await keys('attachments')
  };
});
check('stage 失败被拦截且数据未动', !!restore.stageErr && restore.stageIntact, restore.stageErr || '');
check('commit 失败整体回滚', !!restore.commitErr && restore.commitIntact, restore.commitErr || '');
check('正常恢复生效', restore.finalAtt.includes('a9'), JSON.stringify(restore.finalAtt));

// ---- 待办图标统一常量 / 附件导出导入往返 / 长文档全渲染 ----
const extra = await page.evaluate(async () => {
  const C = window.MynoteIdb, db = await C.getDB();
  const out = {};
  const todoHtml = window.MynoteEditor.renderDocToEditorHTML([{ id: 't1', type: 'todo', attrs: { checked: true }, children: [{ text: 'x' }] }], {});
  out.todoIcon = todoHtml.includes(window.MynoteTodoIcons.checked);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await C.saveAttachmentToDB(db, { id: 'att_cn_1', name: '中文 名字(1).png', type: 'image/png', url: png, thumb: null });
  const zipData = { 'memos.json': fflate.strToU8('{"version":2,"memos":[]}') };
  await C.packAttachmentsToZip(db, zipData, () => {});
  out.hasIdKey = !!zipData['attachments/att_cn_1'];
  zipData['manifest.json'] = fflate.strToU8(JSON.stringify({ version: 1, attachments: { att_cn_1: { name: '中文 名字(1).png', type: 'image/png' } } }));
  await C.restoreFromZipAtomic(db, fflate.unzipSync(fflate.zipSync(zipData)), { memos: [{ id: 'm_cn', title: '往返', doc: [] }] }, {});
  const rec = await C.loadAttachmentFromDB(db, 'att_cn_1');
  out.roundTripOk = !!(rec && rec.name === '中文 名字(1).png' && rec.type === 'image/png' && rec.url);
  const longDoc = [];
  for (let i = 0; i < 60; i++) longDoc.push({ id: 'L' + i, type: 'paragraph', children: [{ text: '第' + i + '段' }] });
  await C.saveMemosToDB(db, [{ id: 'm_long', title: '长文', doc: longDoc, updatedAt: Date.now() }]);
  return out;
});
check('待办勾选图标来自统一常量', extra.todoIcon);
check('附件导出只写 id', extra.hasIdKey, extra.hasIdKey ? '' : '未找到 attachments/att_cn_1');
check('附件导出→导入往返保留 id/中文名/MIME', extra.roundTripOk);

// ---- 流式后台解压与实际输出上限 ----
const zipSafety = await page.evaluate(async () => {
  const src = { 'memos.json': fflate.strToU8('{"version":2,"memos":[]}'), 'attachments/small.txt': fflate.strToU8('A'.repeat(4096)) };
  const zipped = await window.MynoteBackupUtils.compressZip(src, 3);
  const decoded = await window.MynoteBackupUtils.checkedZip(zipped, { maxExpanded: 8192, maxFile: 8192 });
  let limited = false;
  try { await window.MynoteBackupUtils.checkedZip(zipped, { maxExpanded: 512, maxFile: 8192 }); }
  catch (e) { limited = /实际解压总量|实际解压限制/.test(e.message); }
  return { packed: zipped && zipped.length > 0, ok: decoded['attachments/small.txt'] && decoded['attachments/small.txt'].length === 4096, limited };
});
check('ZIP 后台压缩与流式解压完成', !!zipSafety.packed && !!zipSafety.ok);
check('ZIP 实际解压量超限时拒绝', zipSafety.limited);

// ---- 合并基于最新本地快照且按事务队列提交 ----
const mergeSafety = await page.evaluate(async () => {
  const C = window.MynoteIdb, db = await C.getDB();
  const prior = await C.loadMemosFromDB(db);
  await C.saveMemosToDB(db, (prior || []).concat([{ id: 'local_latest', title: '本地最新', doc: [] }]));
  const merged = await C.commitMergedData(db, [{ id: 'cloud_only', title: '云端', doc: [] }], [], {});
  const rows = await C.loadMemosFromDB(db);
  return { returned: merged.map(m => m.id).sort(), stored: rows.map(m => m.id).sort(), hasLong: rows.some(m => m.id === 'm_long') };
});
check('云端合并保留事务时刻最新的本地笔记', mergeSafety.stored.includes('cloud_only') && mergeSafety.stored.includes('local_latest') && JSON.stringify(mergeSafety.returned) === JSON.stringify(mergeSafety.stored) && mergeSafety.hasLong);

const attachmentSafety = await page.evaluate(async () => {
  const C = window.MynoteIdb, db = await C.getDB();
  await C.saveAttachmentToDB(db, { id: 'shared_ref', name: 'x.txt', type: 'text/plain', url: 'data:text/plain;base64,eA==', thumb: null });
  await C.saveMemosToDB(db, [
    { id: 'ref_a', title: 'A', doc: [{ type: 'attachment', fileId: 'shared_ref' }] },
    { id: 'ref_b', title: 'B', doc: [{ type: 'attachment', fileId: 'shared_ref' }] }
  ]);
  await C.deleteUnreferencedAttachments(db, ['shared_ref']);
  const kept = await C.loadAttachmentFromDB(db, 'shared_ref');
  await C.saveMemosToDB(db, [{ id: 'ref_b', title: 'B', doc: [] }]);
  const deleted = await C.deleteUnreferencedAttachments(db, ['shared_ref']);
  const gone = await C.loadAttachmentFromDB(db, 'shared_ref');
  return { sharedKept: !!kept, orphanDeleted: deleted.includes('shared_ref') && !gone };
});
check('附件仍被其他笔记引用时不删除', attachmentSafety.sharedKept);
check('无引用附件在提交后可安全回收', attachmentSafety.orphanDeleted);

const writeOrder = await page.evaluate(async () => {
  const C = window.MynoteIdb, db = await C.getDB();
  const a = C.saveMemosToDB(db, [{ id: 'queued_old', title: '旧快照', doc: [] }]);
  const b = C.saveMemosToDB(db, [{ id: 'queued_new', title: '新快照', doc: [] }]);
  await Promise.all([a, b]);
  return (await C.loadMemosFromDB(db)).map(m => m.id);
});
check('并发全量保存按调用顺序串行提交', writeOrder.length === 1 && writeOrder[0] === 'queued_new', JSON.stringify(writeOrder));


const crossTab = await page.evaluate(async () => {
  const C = window.MynoteIdb, db = await C.getDB();
  const base = (await C.loadMemosFromDB(db)).filter(m => m.id !== 'cross_a' && m.id !== 'cross_b');
  const seed = base.concat([
    { id: 'cross_a', title: 'A0', doc: [] },
    { id: 'cross_b', title: 'B0', doc: [] }
  ]);
  await C.saveMemosToDB(db, seed);
  const first = await C.loadMemosFromDB(db);
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  document.body.appendChild(frame);
  const script = frame.contentDocument.createElement('script');
  script.textContent = await (await fetch('/src/services/storage.idb.js')).text();
  frame.contentDocument.body.appendChild(script);
  const C2 = frame.contentWindow.MynoteIdb, db2 = await C2.getDB();
  const second = await C2.loadMemosFromDB(db2);
  const one = first.map(m => m.id === 'cross_a' ? { ...m, title: 'A1' } : m);
  const two = second.map(m => m.id === 'cross_b' ? { ...m, title: 'B1' } : m);
  await Promise.all([C.saveMemosToDB(db, one), C2.saveMemosToDB(db2, two)]);
  const final = await C.loadMemosFromDB(db);
  frame.remove();
  return { a: final.find(m => m.id === 'cross_a')?.title, b: final.find(m => m.id === 'cross_b')?.title };
});
check('跨标签页并发编辑不同笔记不会互相覆盖', crossTab.a === 'A1' && crossTab.b === 'B1', JSON.stringify(crossTab));

await page.evaluate(async () => {
  const longDoc = [];
  for (let i = 0; i < 60; i++) longDoc.push({ id: 'L' + i, type: 'paragraph', children: [{ text: '第' + i + '段' }] });
  await window.MynoteIdb.saveMemosToDB(await window.MynoteIdb.getDB(), [{ id: 'm_long', title: '长文', doc: longDoc, updatedAt: Date.now() }]);
});

await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.list-item', { timeout: 30000 });
await page.waitForTimeout(1500);
const long = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.list-item')];
  const t = rows.find(r => r.innerText.includes('长文')) || rows[0];
  t.click();
  await new Promise(r => setTimeout(r, 1500));
  const body = document.querySelector('.editor-body');
  return body ? { paras: body.querySelectorAll('p').length, hasLast: body.innerText.includes('第59段') } : { paras: 0, hasLast: false };
});
check('长文档全量渲染（虚拟滚动已移除）', long.paras >= 60 && long.hasLast, JSON.stringify(long));

check('无 JS 异常', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exitCode = failed.length ? 1 : 0;
