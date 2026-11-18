#!/usr/bin/env node
/**
 * 浏览器冒烟：用真实 Chromium 验证「线上/本地页面」的关键链路。
 *
 *   node tests/browser/smoke.mjs                        # 打 http://127.0.0.1:8080/Moment.html
 *   BASE=https://overtrees.github.io/Mynote/Moment.html node tests/browser/smoke.mjs
 *
 * 需要本机已装 playwright-core（npm i -D playwright-core）与一个 Chromium：
 *   CHROME=/usr/bin/chromium（默认值）；沙箱里若走 MITM 代理需 --proxy-server=direct://。
 *
 * 覆盖：列表渲染、编辑器打开、撤销/重做、Markdown 前缀转换不报错、
 *       原子恢复（stage 失败不改数据 / commit 失败整体回滚 / 成功路径生效）。
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8080/Moment.html';
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
// Isolate music-link metadata from external services; exercise only the app's rendering flow.
await ctx.route('https://open.spotify.com/**', async route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Mock Spotify destination</title>' }));
await page.route('**/meta?*', async route => {
  const url = route.request().url();
  if (url.includes('fail-track')) return route.fulfill({ status: 502, body: 'mock metadata failure' });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Mock Song', subtitle: 'Mock Artist', source: 'Spotify' }) });
});
const errors = [];
page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
page.on('console', m => { if (m.type() === 'error' && !/404|CERT|Failed to load resource|mock IndexedDB write failure/.test(m.text())) errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'commit', timeout: 45000 });
await page.waitForSelector('.list-item', { timeout: 30000 });
await page.waitForTimeout(1500);

const rows = await page.$$('.list-item');
check('列表渲染', rows.length >= 2, `${rows.length} 行`);

// ---- 流式 ZIP 必须包含所有基础文件，且 Worker 正常结束 ----
const streamedZip = await page.evaluate(async () => {
  const db = await window.MynoteIdb.getDB();
  const base = {
    'memos.json': window.fflate.strToU8('{"source":"mobile-smoke"}'),
    'manifest.json': window.fflate.strToU8('{"version":1}')
  };
  const zipped = await window.MynoteZip.compressZipStream(db, base, 3);
  const files = window.fflate.unzipSync(zipped);
  return { names: Object.keys(files).sort(), memo: window.fflate.strFromU8(files['memos.json']), manifest: window.fflate.strFromU8(files['manifest.json']) };
});
check('流式 ZIP 包含全部基础文件', streamedZip.names.includes('memos.json') && streamedZip.names.includes('manifest.json') && streamedZip.memo.includes('mobile-smoke') && streamedZip.manifest.includes('version'), JSON.stringify(streamedZip));

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
  const todoHost = document.createElement('div');
  todoHost.innerHTML = todoHtml;
  const todoInput = todoHost.querySelector('input.todo-checkbox');
  out.todoIcon = !!todoInput && todoInput.type === 'checkbox' && todoInput.checked && todoInput.getAttribute('aria-checked') === 'true';
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
check('待办复选框具备原生输入与无障碍状态', extra.todoIcon);
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

  await C.saveAttachmentToDB(db, { id: 'legacy_gallery_ref', name: 'legacy.txt', type: 'text/plain', url: 'data:text/plain;base64,eA==', thumb: null });
  await C.saveMemosToDB(db, [{ id: 'legacy_gallery', title: '旧画廊', doc: [{ type: 'gallery', attrs: { items: ['legacy_gallery_ref'] } }] }]);
  const legacyDeleted = await C.deleteUnreferencedAttachments(db, ['legacy_gallery_ref']);
  const legacyKept = await C.loadAttachmentFromDB(db, 'legacy_gallery_ref');
  await C.saveMemosToDB(db, [{ id: 'legacy_gallery', title: '旧画廊', doc: [{ type: 'gallery', attrs: { items: ['https://example.test/x.png', 'data:image/png;base64,AA=='] } }] }]);
  const legacyOrphanDeleted = await C.deleteUnreferencedAttachments(db, ['legacy_gallery_ref']);
  const legacyGone = await C.loadAttachmentFromDB(db, 'legacy_gallery_ref');
  return { sharedKept: !!kept, orphanDeleted: deleted.includes('shared_ref') && !gone, legacyKept: !!legacyKept && !legacyDeleted.includes('legacy_gallery_ref'), legacyOrphanDeleted: legacyOrphanDeleted.includes('legacy_gallery_ref') && !legacyGone };
});
check('附件仍被其他笔记引用时不删除', attachmentSafety.sharedKept);
check('无引用附件在提交后可安全回收', attachmentSafety.orphanDeleted);
check('旧格式画廊字符串附件 ID 仍受引用保护', attachmentSafety.legacyKept);
check('旧画廊仅剩 URL/data URL 时可回收孤儿附件', attachmentSafety.legacyOrphanDeleted);

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
  script.src = new URL('/src/services/storage.idb.js', location.href).href;
  const loaded = new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; });
  frame.contentDocument.head.appendChild(script);
  await loaded;
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

// ---- 实际可见菜单与音乐链接粘贴交互 ----
const menuLabels = await (async () => {
  await page.locator('.editor-fab.right').click();
  const menu = page.locator('button').filter({ hasText: '撤销' });
  await menu.waitFor({ state: 'visible' });
    const labels = await page.locator('.editor-fab.right').evaluate(button => {
      const menu = button.parentElement;
      return [...document.querySelectorAll('button')].filter(b => {
        const t = b.innerText || '';
        return ['撤销','重做','添加附件','导出笔记','更换背景色'].some(x => t.includes(x));
      }).map(b => b.innerText.trim().replace(/\s+/g, ' '));
    });
  await page.locator('.editor-fab.right').click();
  return labels;
})();
check('编辑器菜单五项入口可见', menuLabels.length === 5 && ['撤销','重做','添加附件','导出笔记','更换背景色'].every(x => menuLabels.some(t => t.includes(x))), JSON.stringify(menuLabels));

// ---- 双栏独立滚动模式真实菜单切换、偏好、编辑与历史回放 ----
await page.setViewportSize({ width: 1024, height: 768 });
await page.locator('.editor-fab.right').click();
const columnModeSwitch = page.getByRole('switch', { name: '双栏独立滚动' });
await columnModeSwitch.waitFor({ state: 'visible' });
const defaultColumnMode = await columnModeSwitch.getAttribute('aria-checked');
await columnModeSwitch.click();
await page.waitForFunction(() => document.querySelector('.editor-body')?.classList.contains('is-independent-scroll'));
const enabledColumnMode = await page.evaluate(() => {
  const body = document.querySelector('.editor-body');
  return {
    checked: document.querySelector('[role="switch"][aria-label="双栏独立滚动"]')?.getAttribute('aria-checked'),
    stored: localStorage.getItem('sj_editor_independent_scroll'),
    display: getComputedStyle(body).display,
    columns: body.querySelectorAll(':scope > .editor-column').length,
    hosts: { body: body.contentEditable, columns: [...body.querySelectorAll(':scope > .editor-column')].map(column => column.contentEditable) }
  };
});
check('更多菜单可启用并保存双栏独立滚动偏好', defaultColumnMode === 'false' && enabledColumnMode.checked === 'true' && enabledColumnMode.stored === '1' && enabledColumnMode.display === 'grid' && enabledColumnMode.columns === 2 && enabledColumnMode.hosts.body === 'false' && enabledColumnMode.hosts.columns.every(value => value === 'true'), JSON.stringify({ defaultColumnMode, ...enabledColumnMode }));
await page.locator('.editor-fab.right').click();
await page.locator('.editor-menu-panel').waitFor({ state: 'hidden' });
const crossColumnBackspaceSetup = await page.evaluate(() => {
  const body = document.querySelector('.editor-body');
  const left = body?.querySelector('.editor-column[data-editor-column="left"]');
  const right = body?.querySelector('.editor-column[data-editor-column="right"]');
  const target = right?.firstElementChild;
  const previous = left?.lastElementChild;
  if (!body || !target || !previous || target.tagName !== 'P') return null;
  target.innerHTML = '<br>';
  window.MynoteEditorColumns.focusEditingHost(body, target);
  const range = document.createRange();
  range.setStart(target, 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return { targetId: target.dataset.blockid, previousId: previous.dataset.blockid, previousText: previous.textContent };
});
if (!crossColumnBackspaceSetup) throw new Error('Could not prepare right-column leading empty paragraph');
await page.keyboard.press('Backspace');
await page.waitForFunction(id => !document.querySelector(`[data-blockid="${id}"]`), crossColumnBackspaceSetup.targetId);
const crossColumnBackspace = await page.evaluate(expected => {
  const body = document.querySelector('.editor-body');
  const selection = window.getSelection();
  const focusNode = selection?.focusNode;
  const focusElement = focusNode?.nodeType === 1 ? focusNode : focusNode?.parentElement;
  const focusBlock = focusElement?.closest('[data-blockid]');
  let caretOffset = -1;
  if (focusBlock && focusNode) {
    const range = document.createRange();
    range.selectNodeContents(focusBlock);
    range.setEnd(focusNode, selection.focusOffset);
    caretOffset = range.toString().length;
  }
  return {
    targetRemoved: !body.querySelector(`[data-blockid="${expected.targetId}"]`),
    focusBlockId: focusBlock?.dataset.blockid || '',
    caretOffset,
    expectedCaretOffset: expected.previousText.length,
    columns: body.querySelectorAll(':scope > .editor-column').length
  };
}, crossColumnBackspaceSetup);
check('右列首个空段落 Backspace 跨栏接回左列末块末尾', crossColumnBackspace.targetRemoved && crossColumnBackspace.focusBlockId === crossColumnBackspaceSetup.previousId && crossColumnBackspace.caretOffset === crossColumnBackspace.expectedCaretOffset && crossColumnBackspace.columns === 2, JSON.stringify(crossColumnBackspace));

const crossColumnArrowSetup = await page.evaluate(() => {
  const body = document.querySelector('.editor-body');
  const left = body.querySelector('.editor-column[data-editor-column="left"]');
  const right = body.querySelector('.editor-column[data-editor-column="right"]');
  const previous = left.lastElementChild;
  const target = right.firstElementChild;
  const textNode = target && target.firstChild;
  if (!previous || !target || !textNode || textNode.nodeType !== 3) return null;
  window.MynoteEditorColumns.focusEditingHost(body, target);
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return { previousId: previous.dataset.blockid, previousText: previous.textContent };
});
if (!crossColumnArrowSetup) throw new Error('Could not prepare cross-column arrow navigation');
await page.keyboard.press('ArrowLeft');
const crossColumnArrow = await page.evaluate(expected => {
  const selection = window.getSelection();
  const focusNode = selection?.focusNode;
  const focusElement = focusNode?.nodeType === 1 ? focusNode : focusNode?.parentElement;
  const focusBlock = focusElement?.closest('[data-blockid]');
  let caretOffset = -1;
  if (focusBlock && focusNode) {
    const range = document.createRange();
    range.selectNodeContents(focusBlock);
    range.setEnd(focusNode, selection.focusOffset);
    caretOffset = range.toString().length;
  }
  return { focusBlockId: focusBlock?.dataset.blockid || '', caretOffset, expectedCaretOffset: expected.previousText.length };
}, crossColumnArrowSetup);
check('左箭头从右列首块可按正文顺序跨栏导航', crossColumnArrow.focusBlockId === crossColumnArrowSetup.previousId && crossColumnArrow.caretOffset === crossColumnArrow.expectedCaretOffset, JSON.stringify(crossColumnArrow));

const independentCaret = await page.evaluate(() => {
  const body = document.querySelector('.editor-body');
  const right = body.querySelector('.editor-column[data-editor-column="right"]');
  const target = [...right.children].reverse().find(block => block.contentEditable !== 'false' && block.tagName !== 'HR' && block.tagName !== 'BR');
  if (!target) return null;
  window.MynoteEditorColumns.focusEditingHost(body, target);
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return { column: target.closest('.editor-column')?.dataset.editorColumn, blockId: target.dataset.blockid };
});
if (!independentCaret || independentCaret.column !== 'right') throw new Error('Could not focus the right-column editing host');
await page.keyboard.type('INDEPENDENT_MODE_EDIT');
await page.waitForTimeout(800);
const independentTyped = await page.locator('.editor-body').innerText();
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
const independentUndo = await page.evaluate(() => ({
  text: document.querySelector('.editor-body').innerText,
  columns: document.querySelectorAll('.editor-body > .editor-column').length
}));
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(300);
const independentRedo = await page.evaluate(() => ({
  text: document.querySelector('.editor-body').innerText,
  columns: document.querySelectorAll('.editor-body > .editor-column').length
}));
check('独立列内编辑及撤销/重做均保留列布局', independentTyped.includes('INDEPENDENT_MODE_EDIT') && !independentUndo.text.includes('INDEPENDENT_MODE_EDIT') && independentUndo.columns === 2 && independentRedo.text.includes('INDEPENDENT_MODE_EDIT') && independentRedo.columns === 2, JSON.stringify({ undoColumns: independentUndo.columns, redoColumns: independentRedo.columns }));

const slashCaret = await page.evaluate(() => {
  const body = document.querySelector('.editor-body');
  const right = body.querySelector('.editor-column[data-editor-column="right"]');
  const target = [...right.children].reverse().find(block => block.contentEditable !== 'false' && block.tagName === 'P');
  if (!target) return false;
  window.MynoteEditorColumns.focusEditingHost(body, target);
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return document.activeElement === right;
});
if (!slashCaret) throw new Error('Could not prepare slash command in the right-column editing host');
await page.keyboard.press('Enter');
await page.keyboard.type('/');
await page.locator('.slash-row').first().waitFor({ state: 'visible', timeout: 5000 });
await page.locator('.slash-row').filter({ hasText: '标题 1' }).first().click();
await page.locator('.editor-body > .editor-column h1').last().waitFor({ state: 'visible', timeout: 5000 });
const independentSlash = await page.evaluate(() => ({
  columns: document.querySelectorAll('.editor-body > .editor-column').length,
  headingInsideColumn: !!document.querySelector('.editor-body > .editor-column h1')
}));
check('独立列内斜杠命令可插入标题', independentSlash.columns === 2 && independentSlash.headingInsideColumn, JSON.stringify(independentSlash));
await page.waitForTimeout(900);
const independentSave = await page.evaluate(async () => {
  const body = document.querySelector('.editor-body');
  const db = await window.MynoteIdb.getDB();
  const saved = (await window.MynoteIdb.loadMemosFromDB(db)).find(memo => memo.id === 'm_long');
  const texts = (saved?.doc || []).map(node => node.children?.[0]?.text || '');
  const parsed = window.MynoteEditor.parseEditorDOM(body).map(node => node.id || '');
  const current = (window.MynoteEditor.getEditorDocRef() || []).map(node => node.id || '');
  return {
    hasTypedText: texts.some(text => text.includes('INDEPENDENT_MODE_EDIT')),
    hasSlashHeading: saved?.doc?.some(node => node.type === 'heading' && node.attrs?.level === 1),
    parsedOrderMatches: JSON.stringify(parsed) === JSON.stringify(current)
  };
});
check('两列输入与斜杠命令按正文顺序保存到笔记', independentSave.hasTypedText && independentSave.hasSlashHeading && independentSave.parsedOrderMatches, JSON.stringify(independentSave));

await page.locator('.editor-fab.right').click();
await page.getByRole('button', { name: '导出笔记' }).click();
await page.getByRole('dialog', { name: '导出笔记' }).waitFor({ state: 'visible' });
const independentHtmlDownloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: '导出为 HTML' }).click();
const independentHtmlDownload = await independentHtmlDownloadPromise;
const independentHtmlStream = await independentHtmlDownload.createReadStream();
let independentHtmlContent = '';
for await (const chunk of independentHtmlStream) independentHtmlContent += chunk.toString();
const independentHtmlCheck = await page.evaluate(html => {
  const exported = new DOMParser().parseFromString(html, 'text/html');
  return {
    columnWrappers: exported.querySelectorAll('.editor-column').length,
    hasMarker: exported.body.innerText.includes('INDEPENDENT_MODE_EDIT'),
    hasSlashHeading: exported.querySelector('.editor-body h1')?.textContent || ''
  };
}, independentHtmlContent);
check('独立模式下 HTML 导出保留正文但不导出列包装', independentHtmlCheck.columnWrappers === 0 && independentHtmlCheck.hasMarker && independentHtmlCheck.hasSlashHeading, JSON.stringify(independentHtmlCheck));

await page.locator('.editor-fab.right').click();
await page.getByRole('switch', { name: '双栏独立滚动' }).click();
await page.waitForFunction(() => !document.querySelector('.editor-body')?.classList.contains('is-independent-scroll'));
const disabledColumnMode = await page.evaluate(() => ({
  stored: localStorage.getItem('sj_editor_independent_scroll'),
  columns: document.querySelectorAll('.editor-body > .editor-column').length
}));
check('关闭模式后恢复线性正文并保存关闭状态', disabledColumnMode.stored === '0' && disabledColumnMode.columns === 0, JSON.stringify(disabledColumnMode));
await page.locator('.editor-fab.right').click();
await page.setViewportSize({ width: 430, height: 900 });

await page.locator('.editor-fab.right').click();
await page.getByRole('button', { name: '导出笔记' }).click();
const exportDialog = page.getByRole('dialog', { name: '导出笔记' });
await exportDialog.waitFor({ state: 'visible' });
const exportFormats = await exportDialog.locator('[data-export-format]').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
check('导出入口打开浮层并显示三种格式', exportFormats.join('|') === '导出为 Markdown|导出为 HTML|导出为 PDF', exportFormats.join(', '));
const exportButtonUX = await exportDialog.locator('[data-export-format="markdown"]').evaluate(button => ({ minHeight: parseFloat(getComputedStyle(button).minHeight), transition: getComputedStyle(button).transitionDuration }));
check('格式选项具备触控尺寸与点击动画', exportButtonUX.minHeight >= 44 && exportButtonUX.transition.includes('0.15s'), JSON.stringify(exportButtonUX));
await page.setViewportSize({ width: 430, height: 240 });
await page.waitForTimeout(100);
const shortExportPanel = await exportDialog.evaluate(dialog => {
  const rect = dialog.getBoundingClientRect();
  const style = getComputedStyle(dialog);
  const sections = dialog.children[0]?.children || [];
  const options = sections[1];
  const footer = sections[2];
  const title = sections[0];
  const titleRect = title?.getBoundingClientRect();
  const footerRect = footer?.getBoundingClientRect();
  return {
    bottom: rect.bottom,
    viewportHeight: window.innerHeight,
    maxHeight: style.maxHeight,
    maxHeightPx: parseFloat(style.maxHeight),
    optionsOverflowY: options ? getComputedStyle(options).overflowY : '',
    optionsClientHeight: options?.clientHeight || 0,
    optionsScrollHeight: options?.scrollHeight || 0,
    titleVisible: !!titleRect && titleRect.top >= 0 && titleRect.bottom <= window.innerHeight,
    footerVisible: !!footerRect && footerRect.top >= 0 && footerRect.bottom <= window.innerHeight
  };
});
check('极矮视口下导出面板不越界且限制最大高度', shortExportPanel.bottom <= shortExportPanel.viewportHeight && shortExportPanel.maxHeightPx < shortExportPanel.viewportHeight, JSON.stringify(shortExportPanel));
check('极矮视口下格式选项区域可内部滚动且标题/说明可见', /auto|scroll/.test(shortExportPanel.optionsOverflowY) && shortExportPanel.optionsScrollHeight > shortExportPanel.optionsClientHeight && shortExportPanel.titleVisible && shortExportPanel.footerVisible, JSON.stringify(shortExportPanel));
await page.setViewportSize({ width: 430, height: 900 });
await page.waitForTimeout(100);
await page.waitForFunction(() => document.activeElement?.getAttribute('data-export-format') === 'markdown');
await page.keyboard.press('Shift+Tab');
const exportBackFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
await page.keyboard.press('Shift+Tab');
const exportReverseWrap = await page.evaluate(() => document.activeElement?.getAttribute('data-export-format'));
await page.keyboard.press('Tab');
const exportForwardWrap = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
check('格式浮层键盘焦点可循环', exportBackFocus === '返回更多菜单' && exportReverseWrap === 'pdf' && exportForwardWrap === '返回更多菜单', JSON.stringify({ exportBackFocus, exportReverseWrap, exportForwardWrap }));
await page.mouse.click(20, 450);
await exportDialog.waitFor({ state: 'hidden' });
check('点击浮层外部可关闭格式面板', true);

await page.locator('.editor-fab.right').click();
await page.getByRole('button', { name: '导出笔记' }).click();
await page.getByRole('button', { name: '返回更多菜单' }).click();
await page.locator('button').filter({ hasText: '撤销' }).waitFor({ state: 'visible' });
check('格式浮层返回键可回到更多菜单', true);
await page.keyboard.press('Escape');
await page.waitForTimeout(240);

await page.locator('.editor-fab.right').click();
await page.getByRole('button', { name: '导出笔记' }).click();
await page.getByRole('dialog', { name: '导出笔记' }).waitFor({ state: 'visible' });
await page.keyboard.press('Escape');
await page.getByRole('dialog', { name: '导出笔记' }).waitFor({ state: 'hidden' });
check('格式浮层支持 Escape 关闭', true);

await page.locator('.editor-fab.right').click();
await page.getByRole('button', { name: '导出笔记' }).click();
await page.getByRole('dialog', { name: '导出笔记' }).waitFor({ state: 'visible' });
const markdownDownloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: '导出为 Markdown' }).click();
const markdownDownload = await markdownDownloadPromise;
check('Markdown 导出触发文件下载', markdownDownload.suggestedFilename().endsWith('.md'), markdownDownload.suggestedFilename());
await page.waitForTimeout(260);

await page.locator('.editor-fab.right').click();
await page.getByRole('button', { name: '导出笔记' }).click();
await page.getByRole('dialog', { name: '导出笔记' }).waitFor({ state: 'visible' });
const htmlDownloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: '导出为 HTML' }).click();
const htmlDownload = await htmlDownloadPromise;
check('HTML 导出触发文件下载', htmlDownload.suggestedFilename().endsWith('.html'), htmlDownload.suggestedFilename());
await page.waitForTimeout(260);

await page.evaluate(() => {
  window.__nativeOpenForPdfTest = window.open;
  window.__pdfPrintCalled = false;
  window.open = function (...args) {
    const popup = window.__nativeOpenForPdfTest.apply(window, args);
    if (popup) {
      popup.print = function () { window.__pdfPrintCalled = true; };
      window.__pdfPrintPopup = popup;
    }
    return popup;
  };
});
await page.locator('.editor-fab.right').click();
await page.getByRole('button', { name: '导出笔记' }).click();
await page.getByRole('dialog', { name: '导出笔记' }).waitFor({ state: 'visible' });
const pdfPopupPromise = page.waitForEvent('popup');
await page.getByRole('button', { name: '导出为 PDF' }).click();
const pdfPopup = await pdfPopupPromise;
await page.waitForFunction(() => window.__pdfPrintCalled === true);
const pdfPreviewText = await pdfPopup.locator('main').innerText();
check('PDF 打开包含笔记内容的打印页面', pdfPreviewText.includes('长文') && pdfPreviewText.includes('第59段'), pdfPreviewText.slice(0, 60).replace(/\s+/g, ' '));
await pdfPopup.close();
await page.evaluate(() => { window.open = window.__nativeOpenForPdfTest; });
await page.waitForTimeout(260);

await page.locator('.editor-body').click();
await page.keyboard.press('Control+End');
await page.keyboard.type('MENU_ACTION');
await page.waitForTimeout(500);
await page.locator('.editor-fab.right').click();
await page.locator('button').filter({ hasText: '撤销' }).click({ force: true });
await page.waitForTimeout(350);
const menuUndoOk = !(await page.locator('.editor-body').innerText()).includes('MENU_ACTION');
await page.locator('.editor-fab.right').click();
await page.locator('button').filter({ hasText: '重做' }).click({ force: true });
await page.waitForTimeout(350);
const menuRedoOk = (await page.locator('.editor-body').innerText()).includes('MENU_ACTION');
check('菜单撤销/重做可用', menuUndoOk && menuRedoOk, `undo=${menuUndoOk}, redo=${menuRedoOk}`);

await page.locator('.editor-fab.right').click();
const chooserPromise = page.waitForEvent('filechooser');
await page.locator('button').filter({ hasText: '添加附件' }).click({ force: true });
const chooser = await chooserPromise;
await page.evaluate(() => {
  window.__saveAttachmentOriginal = window.MynoteIdb.saveAttachmentToDB;
  window.MynoteIdb.saveAttachmentToDB = async () => { throw new Error('mock IndexedDB write failure'); };
});
await chooser.setFiles({ name: 'fault-test.txt', mimeType: 'text/plain', buffer: Buffer.from('safe test payload') });
await page.waitForFunction(() => !document.querySelector('.editor-body [data-type="attachment"][data-fileid]'), { timeout: 5000 }).catch(() => {});
const attachmentRollback = await page.evaluate(() => {
  const errorLogged = window.MynoteErrors && window.MynoteErrors.errors.some(e => /附件保存失败/.test(e.message || e.text || ''));
  window.MynoteIdb.saveAttachmentToDB = window.__saveAttachmentOriginal;
  return { noRef: !document.querySelector('.editor-body [data-type="attachment"][data-fileid]'), errorLogged };
});
check('附件写库失败时菜单插入回滚且提示', attachmentRollback.noRef && attachmentRollback.errorLogged, JSON.stringify(attachmentRollback));

await page.locator('.editor-fab.right').click();
await page.locator('button').filter({ hasText: '更换背景色' }).click({ force: true });
await page.getByRole('button', { name: '暖沙' }).waitFor({ state: 'visible' });
await page.getByRole('button', { name: '暖沙' }).click();
await page.waitForTimeout(350);
const backgroundSaved = await page.evaluate(async () => {
  const memos = await window.MynoteIdb.loadMemosFromDB(await window.MynoteIdb.getDB());
  const target = memos.find(m => m.id === 'm_long');
  return !!(target && target.bgColor);
});
check('背景色面板可选择并持久化', backgroundSaved);

// Use genuine paste event handling, with metadata fetch stubbed above (no third-party playback/account).
const music = await page.evaluate(async () => {
  const body = document.querySelector('.editor-body');
  body.focus();
  const range = document.createRange(); range.selectNodeContents(body); range.collapse(false);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  const paste = value => {
    const data = new DataTransfer(); data.setData('text/plain', value);
    body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  };
  paste('https://open.spotify.com/track/mock-track');
  await new Promise(r => setTimeout(r, 500));
  const card = body.querySelector('[data-type="musicCard"][data-url*="spotify"]');
  const ready = card && card.classList.contains('link-card-block') && card.querySelector('.lkc-title')?.textContent === 'Mock Song';
  const visible = card && card.getBoundingClientRect().width > 0 && card.getBoundingClientRect().height > 0 && getComputedStyle(card).display !== 'none';
  const access = card && card.tagName === 'A' && card.getAttribute('href') === 'https://open.spotify.com/track/mock-track' && card.getAttribute('target') === '_blank' && card.getAttribute('rel') === 'noopener noreferrer';
  return { ready: !!ready, visible: !!visible, access: !!access, url: card?.dataset.url || '' };
});
check('粘贴 Spotify 链接自动成可见可访问音乐卡', music.ready && music.visible && music.access, JSON.stringify(music));
const musicCardLocator = page.locator('.editor-body [data-type="musicCard"][data-url*="spotify"]');
await musicCardLocator.scrollIntoViewIfNeeded();
await page.evaluate(() => {
  window.__openedMusic = null;
  window.open = (...args) => { window.__openedMusic = args; return null; };
});
const musicAnchor = await musicCardLocator.evaluate(e => ({
  tag: e.tagName, href: e.getAttribute('href'), target: e.getAttribute('target'), rel: e.getAttribute('rel'),
  visible: e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0
}));
await musicCardLocator.click({ position: { x: 190, y: 40 }, timeout: 5000 });
const musicClickResult = await page.evaluate(() => window.__openedMusic);
check('点击音乐卡安全打开原链接', musicAnchor.tag === 'A' && musicAnchor.href === 'https://open.spotify.com/track/mock-track' && musicAnchor.target === '_blank' && musicAnchor.rel.includes('noopener') && musicAnchor.visible && musicClickResult?.[0] === musicAnchor.href && musicClickResult?.[1] === '_blank' && musicClickResult?.[2] === 'noopener,noreferrer', JSON.stringify({ ...musicAnchor, opened: musicClickResult }));
await musicCardLocator.focus();
await page.keyboard.press('Enter');
const musicKeyboardResult = await page.evaluate(() => window.__openedMusic);
check('键盘 Enter 可打开音乐卡', musicKeyboardResult?.[0] === musicAnchor.href && musicKeyboardResult?.[1] === '_blank' && musicKeyboardResult?.[2] === 'noopener,noreferrer', JSON.stringify(musicKeyboardResult));

const musicFailure = await page.evaluate(async () => {
  const body = document.querySelector('.editor-body');
  body.focus(); const range = document.createRange(); range.selectNodeContents(body); range.collapse(false);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  const data = new DataTransfer(); data.setData('text/plain', 'https://open.spotify.com/track/fail-track');
  body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 400));
  const card = [...body.querySelectorAll('[data-type="musicCard"]')].find(e => e.dataset.url?.includes('fail-track'));
  return { fallback: !!(card && card.classList.contains('music-card-error') && card.innerText.includes('点击打开')), visible: !!(card && card.getBoundingClientRect().width > 0), url: card?.dataset.url || '' };
});
check('音乐元数据失败仍显示可恢复链接卡', musicFailure.fallback && musicFailure.visible && musicFailure.url.includes('fail-track'), JSON.stringify(musicFailure));

// Slash menu: verify real menu rendering and apply a non-destructive heading command.
await page.locator('.editor-body').click();
await page.keyboard.press('Control+End');
await page.keyboard.type('/');
await page.locator('.slash-row').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
const slashCount = await page.locator('.slash-row').count();
check('22 项斜杠命令菜单可渲染', slashCount >= 22, `当前可见命令 ${slashCount}`);
const headingCommand = page.locator('.slash-row').filter({ hasText: '标题 1' }).first();
await headingCommand.click();
await page.locator('.editor-body h1').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
const headingApplied = await page.locator('.editor-body h1').count() > 0;
check('斜杠标题命令可执行', headingApplied);
await page.waitForTimeout(900);
const headingPersistence = await page.evaluate(async () => {
  const node = [...document.querySelectorAll('.editor-body h1')].at(-1);
  if (!node) return null;
  const id = node.dataset.blockid;
  const memos = await MynoteIdb.loadMemosFromDB(await MynoteIdb.getDB());
  const memo = memos.find(m => Array.isArray(m.doc) && m.doc.some(b => b.id === id));
  const block = memo?.doc.find(b => b.id === id);
  return block && { type: block.type, level: block.attrs?.level };
});
check('H1 命令保存后仍是一级标题', headingPersistence?.type === 'heading' && headingPersistence.level === 1, JSON.stringify(headingPersistence));

async function applyExactSlash(title) {
  const body = page.locator('.editor-body');
  await body.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('/');
  await page.locator('.slash-row').first().waitFor({ state: 'visible', timeout: 5000 });
  const index = await page.locator('.slash-row').evaluateAll((els, wanted) => els.findIndex(e => e.children[1]?.children[0]?.querySelector('span')?.textContent?.trim() === wanted), title);
  if (index < 0) throw new Error(`Slash command not found: ${title}`);
  await page.locator('.slash-row').nth(index).click();
  await page.waitForTimeout(900);
}
async function storedBlockForLast(selector) {
  return page.evaluate(async selector => {
    const node = [...document.querySelectorAll('.editor-body ' + selector)].at(-1);
    if (!node) return null;
    const id = node.dataset.blockid;
    const memos = await MynoteIdb.loadMemosFromDB(await MynoteIdb.getDB());
    const memo = memos.find(m => Array.isArray(m.doc) && m.doc.some(b => b.id === id));
    const block = memo?.doc.find(b => b.id === id);
    return block && { type: block.type, attrs: block.attrs || {}, text: block.children?.[0]?.text || '' };
  }, selector);
}
await applyExactSlash('引用');
const quoteSaved = await storedBlockForLast('blockquote');
check('引用命令保存后保留引用块', quoteSaved?.type === 'quote', JSON.stringify(quoteSaved));
await applyExactSlash('分割线');
const dividerSaved = await storedBlockForLast('hr');
check('分割线命令保存后保留分割线', dividerSaved?.type === 'divider', JSON.stringify(dividerSaved));
await applyExactSlash('待办');
const todo = page.locator('.editor-body [data-type="todo"]').last();
await todo.click({ position: { x: 80, y: 12 } });
await page.keyboard.type('AUDIT_TASK');
await page.waitForTimeout(800);
const todoCheckbox = todo.locator('input.todo-checkbox');
await todoCheckbox.focus();
await page.evaluate(() => { window.__todoEvents = []; const host = document.querySelector('.editor-body'); for (const type of ['keydown','keyup','click','change']) host?.addEventListener(type, e => { if (e.target.matches?.('.todo-checkbox')) window.__todoEvents.push([type,e.key || '',e.target.checked,e.defaultPrevented]); }, true); });
await todoCheckbox.press('Space');
await page.waitForTimeout(800);
const firstToggle = await todoCheckbox.evaluate(el => ({ checked: el.checked, aria: el.getAttribute('aria-checked'), focused: document.activeElement === el }));
await todoCheckbox.press('Space');
await page.waitForTimeout(800);
const todoSaved = await page.evaluate(async () => {
  const node = [...document.querySelectorAll('.editor-body [data-type="todo"]')].at(-1);
  const id = node?.dataset.blockid;
  const memos = await MynoteIdb.loadMemosFromDB(await MynoteIdb.getDB());
  const memo = memos.find(m => Array.isArray(m.doc) && m.doc.some(b => b.id === id));
  const block = memo?.doc.find(b => b.id === id);
  const checkbox = node?.querySelector('input.todo-checkbox');
  return { checked: checkbox?.dataset.checked === 'true', actualChecked: checkbox?.checked, ariaChecked: checkbox?.getAttribute('aria-checked'), keyboardFocus: document.activeElement === checkbox, events: window.__todoEvents, text: block?.children?.[0]?.text || '', savedChecked: block?.attrs?.checked };
});
check('待办支持空格键切换、焦点保持与状态保存', firstToggle.checked && firstToggle.aria === 'true' && firstToggle.focused && !todoSaved.checked && todoSaved.ariaChecked === 'false' && todoSaved.text.includes('AUDIT_TASK') && todoSaved.savedChecked === false, JSON.stringify({ firstToggle, secondToggle: todoSaved }));

const longImageText = '图文卡说明文字用于验证完整阅读面板。'.repeat(18);
await page.evaluate(text => {
  const body = document.querySelector('.editor-body');
  body.innerHTML = window.MynoteEditor.renderDocToEditorHTML([{ id: 'smoke-image-text', type: 'imgTextCard', children: [{ text }] }], {});
}, longImageText);
await page.locator('.editor-body .itc-text').click();
await page.locator('.image-text-sheet-content').waitFor();
const fullImageText = await page.locator('.image-text-sheet-content').innerText();
check('点击图文说明区打开底部面板并显示完整长文本', fullImageText === longImageText, `字数=${fullImageText.length}`);
const dialogHasFocus = await page.locator('.image-text-sheet').evaluate(el => document.activeElement === el);
check('打开全文面板后焦点进入对话框', dialogHasFocus);
await page.keyboard.press('Tab');
check('阅读模式 Tab 从对话框进入面板操作按钮', await page.locator('.image-text-sheet-action').evaluate(el => document.activeElement === el));
await page.keyboard.press('Shift+Tab');
check('阅读模式 Shift+Tab 不会离开面板', await page.locator('.image-text-sheet').evaluate(el => el.contains(document.activeElement)));
await page.locator('.image-text-sheet-action').click();
check('进入编辑后焦点落在文本编辑框', await page.locator('.image-text-sheet-editor').evaluate(el => document.activeElement === el));
await page.keyboard.press('Tab');
check('编辑模式 Tab 到面板操作按钮', await page.locator('.image-text-sheet-action').evaluate(el => document.activeElement === el));
await page.keyboard.press('Tab');
check('编辑模式 Tab 在面板内循环到文本编辑框', await page.locator('.image-text-sheet-editor').evaluate(el => document.activeElement === el));
await page.keyboard.press('Shift+Tab');
check('编辑模式 Shift+Tab 在面板内循环到操作按钮', await page.locator('.image-text-sheet-action').evaluate(el => document.activeElement === el));
await page.locator('.image-text-sheet-editor').fill('面板内编辑已同步');
const updatedImageText = await page.$eval('.editor-body .itc-text', el => el.textContent);
check('全文面板显式编辑后同步回图文卡', updatedImageText === '面板内编辑已同步', updatedImageText);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('图文全文面板支持 Escape 关闭', await page.locator('.image-text-sheet').count() === 0);
check('Escape 关闭后焦点恢复到触发文本区', await page.locator('.editor-body .itc-text').evaluate(el => document.activeElement === el));
await page.locator('.editor-body .itc-text').click();
await page.locator('.image-text-sheet').waitFor();
await page.locator('.image-text-sheet-backdrop').click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(300);
check('点击背景关闭后焦点恢复到触发文本区', await page.locator('.image-text-sheet').count() === 0 && await page.locator('.editor-body .itc-text').evaluate(el => document.activeElement === el));

await page.setViewportSize({ width: 1024, height: 768 });
const slashColumns = await page.evaluate(() => {
  const body = document.querySelector('.editor-body');
  if (body.querySelector('.editor-column')) window.MynoteEditorColumns.setIndependentScroll(body, false);
  const seed = [
    { id: 'slash-seed-left', type: 'paragraph', children: [{ text: '左栏回归起点' }] },
    { id: 'slash-seed-right', type: 'paragraph', children: [{ text: '右栏回归起点' }] }
  ];
  window.MynoteEditor.setEditorDocRef(seed);
  body.innerHTML = window.MynoteEditor.renderDocToEditorHTML(seed, {});
  window.MynoteEditorColumns.setIndependentScroll(body, true);
  return Array.from(body.querySelectorAll('.editor-column')).map(column => column.dataset.editorColumn);
});
check('斜杠专项回归在左右独立编辑列运行', slashColumns.join(',') === 'left,right', slashColumns.join(','));

async function createSlashInput(id, columnName) {
  await page.evaluate(({ id, columnName }) => {
    const body = document.querySelector('.editor-body');
    const column = body.querySelector(`.editor-column[data-editor-column="${columnName}"]`);
    const p = document.createElement('p');
    p.dataset.blockid = id;
    p.innerHTML = '<br>';
    column.appendChild(p);
    window.MynoteEditorColumns.focusEditingHost(body, p);
    const range = document.createRange();
    range.selectNodeContents(p);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, { id, columnName });
  await page.keyboard.type('/');
  await page.locator('.slash-panel').waitFor({ state: 'visible' });
}

await createSlashInput('slash-keyboard', 'left');
const slashMenuA11y = await page.evaluate(() => {
  const list = document.querySelector('.slash-panel[role="listbox"]');
  const first = list?.querySelector('[data-slash-index="0"]');
  const icon = first?.querySelector('.slash-row-icon');
  const title = first?.querySelector('.slash-row-title');
  const subtitle = first?.querySelector('.slash-row-subtitle');
  const style = node => node ? getComputedStyle(node) : null;
  return { role: list?.getAttribute('role'), options: list?.querySelectorAll('[role="option"]').length || 0,
    firstCommand: first?.dataset.slashId || '', activeDescendant: document.querySelector('.editor-column:focus')?.getAttribute('aria-activedescendant') || '',
    rowHeight: first?.getBoundingClientRect().height || 0, iconWidth: icon?.getBoundingClientRect().width || 0,
    iconHeight: icon?.getBoundingClientRect().height || 0, titleFontSize: style(title)?.fontSize || '', subtitleFontSize: style(subtitle)?.fontSize || '',
    rowGap: style(first)?.columnGap || style(first)?.gap || '' };
});
check('斜杠菜单提供 listbox/option 语义与初始活动项', slashMenuA11y.role === 'listbox' && slashMenuA11y.options === 22 && !!slashMenuA11y.activeDescendant, JSON.stringify(slashMenuA11y));
check('斜杠菜单触控热区、图标与标题/副标题字号符合设计', slashMenuA11y.rowHeight >= 48 && slashMenuA11y.iconWidth === 30 && slashMenuA11y.iconHeight === 30 && parseFloat(slashMenuA11y.titleFontSize) >= 14 && parseFloat(slashMenuA11y.subtitleFontSize) >= 12, JSON.stringify(slashMenuA11y));
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(50);
const slashMoved = await page.locator('.editor-column:focus').getAttribute('aria-activedescendant');
check('斜杠菜单方向键更新活动命令', slashMoved && slashMoved !== slashMenuA11y.activeDescendant, slashMoved || '无活动项');
const activeRowStyle = await page.locator('.slash-panel [aria-selected="true"]').evaluate(el => ({ focused: el === document.activeElement, background: getComputedStyle(el).backgroundColor }));
check('键盘活动命令有可见选中状态', !activeRowStyle.focused && activeRowStyle.background !== 'rgba(0, 0, 0, 0)' && activeRowStyle.background !== 'transparent', JSON.stringify(activeRowStyle));
await page.keyboard.press('ArrowUp');
const keyboardSelectedId = await page.locator('.slash-panel [aria-selected="true"]').getAttribute('data-slash-id');
check('方向键可返回初始活动命令', keyboardSelectedId === slashMenuA11y.firstCommand, `${keyboardSelectedId} / ${slashMenuA11y.firstCommand}`);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const keyboardCommand = await page.evaluate(() => ({
  type: window.MynoteEditor.getEditorDocRef()?.find(block => block.id === 'slash-keyboard')?.type,
  focusedColumn: document.activeElement?.dataset?.editorColumn || ''
}));
const keyboardExpectedTypes = { heading: 'heading', heading2: 'heading', heading3: 'heading', paragraph: 'paragraph', quote: 'quote', todo: 'todo', divider: 'divider', bold: 'paragraph', italic: 'paragraph', highlight: 'paragraph', codeBlock: 'paragraph', unorderedList: 'paragraph', orderedList: 'paragraph', callout: 'paragraph', imgTextCard: 'imgTextCard', imageTextRow: 'imageTextRow', link: 'paragraph', code: 'paragraph', strikethrough: 'paragraph', musicCard: 'musicCard', image: 'image', gallery: 'gallery' };
check('斜杠菜单可用 Enter 应用活动命令并留在原编辑列', keyboardCommand.type === keyboardExpectedTypes[keyboardSelectedId] && keyboardCommand.focusedColumn === 'left', JSON.stringify({ ...keyboardCommand, command: keyboardSelectedId }));

const slashCommands = [
  ['heading', 'heading', ''], ['heading2', 'heading', ''], ['heading3', 'heading', ''],
  ['paragraph', 'paragraph', ''], ['quote', 'quote', ''], ['todo', 'todo', ''],
  ['divider', 'divider', ''], ['bold', 'paragraph', '**文字**'], ['italic', 'paragraph', '*文字*'],
  ['highlight', 'paragraph', '==文字=='], ['codeBlock', 'paragraph', '```'], ['unorderedList', 'paragraph', '- 列表项'],
  ['orderedList', 'paragraph', '1. 列表项'], ['callout', 'paragraph', '> [!NOTE]'], ['imgTextCard', 'imgTextCard', ''],
  ['imageTextRow', 'imageTextRow', ''], ['link', 'paragraph', 'https://example.com/slash'], ['code', 'paragraph', '`文字`'],
  ['strikethrough', 'paragraph', '~~文字~~'], ['musicCard', 'musicCard', ''], ['image', 'image', ''], ['gallery', 'gallery', '']
];
for (let i = 0; i < slashCommands.length; i++) {
  const [commandId, expectedType, expectedText] = slashCommands[i];
  const id = `slash-each-${commandId}`;
  const columnName = i % 2 === 0 ? 'left' : 'right';
  await createSlashInput(id, columnName);
  const row = page.locator(`.slash-panel [data-slash-id="${commandId}"]`);
  const available = await row.count();
  check(`斜杠菜单包含 ${commandId} 命令`, available === 1);
  if (!available) continue;
  await row.click();
  if (commandId === 'link') {
    await page.locator('.slash-link-input').waitFor({ state: 'visible' });
    await page.locator('.slash-link-input').fill('https://example.com/slash?q=1');
    await page.locator('.slash-link-submit').click();
  }
  await page.waitForTimeout(130);
  const state = await page.evaluate(id => {
    const block = window.MynoteEditor.getEditorDocRef()?.find(item => item.id === id);
    const node = document.querySelector(`.editor-body [data-blockid="${id}"]`);
    return { type: block?.type || '', text: (block?.children || []).map(child => child.text || '').join(''),
      level: block?.attrs?.level, fileId: block?.attrs?.fileId, items: block?.attrs?.items,
      checked: block?.attrs?.checked, column: node?.closest('.editor-column')?.dataset.editorColumn || '' };
  }, id);
  let ok = state.type === expectedType && state.column === columnName;
  if (expectedText) ok = ok && state.text.includes(expectedText);
  if (commandId === 'heading') ok = ok && state.level === 1;
  if (commandId === 'heading2') ok = ok && state.level === 2;
  if (commandId === 'heading3') ok = ok && state.level === 3;
  if (commandId === 'todo') ok = ok && state.checked === false;
  if (commandId === 'imgTextCard' || commandId === 'imageTextRow' || commandId === 'image') ok = ok && state.fileId === '';
  if (commandId === 'gallery') ok = ok && Array.isArray(state.items);
  if (commandId === 'link') ok = ok && state.text.includes('[链接文字](https://example.com/slash?q=1)');
  check(`独立双栏中 ${commandId} 命令应用、Markdown/普通文本与列归属正确`, ok, JSON.stringify(state));
}

const generatedPreview = await page.evaluate(() => {
  const body = document.querySelector('.editor-body');
  const left = body.querySelector('.editor-column[data-editor-column="left"]');
  const right = body.querySelector('.editor-column[data-editor-column="right"]');
  const make = (parent, id, source) => {
    const p = document.createElement('p');
    p.dataset.blockid = id;
    p.textContent = source;
    parent.appendChild(p);
    const result = window.MynoteMdBlocks.renderSingleParagraph(p, source);
    return { result, node: parent.querySelector(`[data-blockid="${id}"]`) };
  };
  const list = make(left, 'slash-preview-list', '- 第一项\n- 第二项');
  const callout = make(right, 'slash-preview-callout', '> [!NOTE]\n> **提示内容**');
  const inline = make(left, 'slash-preview-inline', '**普通文本加粗**');
  const crossLeft = document.createElement('p');
  crossLeft.textContent = '- 左列列表';
  const crossRight = document.createElement('p');
  crossRight.textContent = '- 右列列表';
  left.appendChild(crossLeft);
  right.appendChild(crossRight);
  const grouped = window.MynoteMdBlocks.collectListGroup([crossLeft, crossRight], 0);
  const crossReplacement = window.MynoteMdBlocks.replaceGroupWithPreview([crossLeft, crossRight], '- 左列列表\n- 右列列表', window.MynoteMd.renderMarkdownHtml('- 左列列表\n- 右列列表'));
  const docs = window.MynoteEditor.getEditorDocRef() || [];
  const markdown = window.MynoteEditorExport.toMarkdown(docs, '斜杠回归', []);
  return {
    listResult: list.result, listItems: list.node?.querySelectorAll('li').length || 0,
    calloutResult: callout.result, calloutVisible: !!callout.node?.querySelector('.callout'), calloutStrong: !!callout.node?.querySelector('.callout strong'),
    inlineResult: inline.result, inlinePreview: inline.node?.classList.contains('md-preview-inline') && !!inline.node.querySelector('strong'),
    groupedCount: grouped.texts.length, crossReplacement: !!crossReplacement,
    crossNodesRemain: !!crossLeft.parentNode && !!crossRight.parentNode,
    markdownHasList: markdown.includes('- 列表项') && markdown.includes('1. 列表项'),
    markdownHasCallout: markdown.includes('> [!NOTE]') && markdown.includes('提示内容'),
    markdownHasLink: markdown.includes('https://example.com/slash?q=1')
  };
});
check('斜杠生成的列表与 Callout 可渲染为块级 Markdown 预览', generatedPreview.listResult === 'block' && generatedPreview.listItems === 2 && generatedPreview.calloutResult === 'block' && generatedPreview.calloutVisible && generatedPreview.calloutStrong, JSON.stringify(generatedPreview));
check('普通文本行内 Markdown 预览保留加粗语义', generatedPreview.inlineResult === 'inline' && generatedPreview.inlinePreview, JSON.stringify(generatedPreview));
check('Markdown 列表分组不跨独立编辑列合并', generatedPreview.groupedCount === 1 && !generatedPreview.crossReplacement && generatedPreview.crossNodesRemain, JSON.stringify(generatedPreview));
check('斜杠命令生成的列表、Callout 与链接可进入 Markdown 导出', generatedPreview.markdownHasList && generatedPreview.markdownHasCallout && generatedPreview.markdownHasLink, JSON.stringify(generatedPreview));

await createSlashInput('slash-link-validation', 'right');
await page.locator('.slash-panel [data-slash-id="link"]').click();
await page.locator('.slash-link-input').waitFor({ state: 'visible' });
await page.locator('.slash-link-input').fill('ftp://example.com/not-allowed');
await page.locator('.slash-link-submit').click();
const invalidLinkState = await page.evaluate(() => ({
  error: document.querySelector('.slash-link-error')?.textContent || '',
  role: document.querySelector('.slash-panel')?.getAttribute('role'),
  blockType: window.MynoteEditor.getEditorDocRef()?.find(block => block.id === 'slash-link-validation')?.type || ''
}));
check('链接命令拒绝非 HTTP(S) URL 并保留可修正输入表单', invalidLinkState.error.includes('http 或 https') && invalidLinkState.role === 'dialog' && invalidLinkState.blockType === 'paragraph', JSON.stringify(invalidLinkState));
await page.locator('.slash-link-cancel').click();

await createSlashInput('slash-repeat-token', 'left');
await page.evaluate(() => {
  const p = document.querySelector('[data-blockid="slash-repeat-token"]');
  p.textContent = '前缀 /p 中间 /p 后缀';
  const range = document.createRange();
  range.setStart(p.firstChild, 5);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  p.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'p' }));
});
await page.locator('.slash-panel').waitFor({ state: 'visible' });
await page.locator('.slash-panel [data-slash-id="paragraph"]').click();
await page.waitForTimeout(150);
const repeatedSlash = await page.evaluate(() => window.MynoteEditor.getEditorDocRef()?.find(block => block.id === 'slash-repeat-token')?.children?.[0]?.text || '');
check('重复 slash token 仅删除光标处活动 token', repeatedSlash === '前缀  中间 /p 后缀', repeatedSlash);
await page.keyboard.press('Control+z');
await page.waitForTimeout(180);
const repeatUndo = await page.evaluate(() => ({ text: window.MynoteEditor.getEditorDocRef()?.find(block => block.id === 'slash-repeat-token')?.children?.[0]?.text || '',
  column: document.activeElement?.dataset?.editorColumn || '',
  offset: (() => { const block = document.querySelector('[data-blockid="slash-repeat-token"]'); const selection = window.getSelection(); return block && selection?.rangeCount ? window.MynoteDom.getTextOffsetWithin(block, selection.focusNode, selection.focusOffset) : null; })() }));
check('斜杠命令撤销恢复原文本、列内焦点与 slash 光标位置', repeatUndo.text === '前缀 /p 中间 /p 后缀' && ['left', 'right'].includes(repeatUndo.column) && repeatUndo.offset === 5, JSON.stringify(repeatUndo));
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(180);
const repeatRedo = await page.evaluate(() => ({ text: window.MynoteEditor.getEditorDocRef()?.find(block => block.id === 'slash-repeat-token')?.children?.[0]?.text || '',
  column: document.activeElement?.dataset?.editorColumn || '',
  offset: (() => { const block = document.querySelector('[data-blockid="slash-repeat-token"]'); const selection = window.getSelection(); return block && selection?.rangeCount ? window.MynoteDom.getTextOffsetWithin(block, selection.focusNode, selection.focusOffset) : null; })() }));
check('斜杠命令重做再次只移除活动 token 并恢复列内光标', repeatRedo.text === '前缀  中间 /p 后缀' && ['left', 'right'].includes(repeatRedo.column) && repeatRedo.offset === 3, JSON.stringify(repeatRedo));

await createSlashInput('slash-spaces', 'right');
await page.evaluate(() => {
  const p = document.querySelector('[data-blockid="slash-spaces"]');
  p.textContent = '  前文  /b  后文  ';
  const range = document.createRange();
  range.setStart(p.firstChild, 8);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  p.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'b' }));
});
await page.locator('.slash-panel').waitFor({ state: 'visible' });
await page.locator('.slash-panel [data-slash-id="bold"]').click();
await page.waitForTimeout(150);
const spacedText = await page.evaluate(() => window.MynoteEditor.getEditorDocRef()?.find(block => block.id === 'slash-spaces')?.children?.[0]?.text || '');
check('行内斜杠命令保留句中与首尾空白并插入占位格式', spacedText === '  前文  **文字**  后文  ', JSON.stringify(spacedText));

check('无 JS 异常', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exitCode = failed.length ? 1 : 0;
