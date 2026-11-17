import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEnv, loadScript } from './helpers/env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (env, rel) => loadScript(env, path.join(ROOT, rel));

test('构建脚本清单：Moment.html 引用的本地脚本全部存在', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Moment.html'), 'utf8');
  const refs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]).filter(r => !/^https?:/.test(r));
  assert.ok(refs.length > 15, '脚本引用数量异常: ' + refs.length);
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, ref.split('?')[0])), '缺少脚本: ' + ref);
  }
});

test('核心模块可在浏览器环境桩下完成注册', () => {
  const env = makeEnv();
  for (const f of ['src/app-config.js', 'src/constants.js', 'src/utils/id.js', 'src/utils/time.js',
    'src/utils/dom.js', 'src/utils/preview.js', 'src/utils/svg.js', 'src/services/storage.local.js',
    'src/editor/editor.md.js', 'src/editor/editor.render.js']) load(env, f);
  const w = env.win;
  for (const key of ['MynoteConstants', 'MynoteId', 'MynoteTime', 'MynoteDom', 'MynotePreview', 'MynoteLocal', 'MynoteMd']) {
    assert.ok(w[key], '未注册全局: ' + key);
  }
  assert.equal(typeof w.MynotePreview.summarizeMemoDoc, 'function');
  assert.equal(typeof w.MynoteMd.stripMarkdownForPreview, 'function');
});

test('id / time / dom / constants 基础行为', () => {
  const env = makeEnv();
  for (const f of ['src/constants.js', 'src/utils/id.js', 'src/utils/time.js', 'src/utils/dom.js']) load(env, f);
  const w = env.win;
  assert.match(w.MynoteId.genId(), /^[a-z0-9]+$/i);
  assert.notEqual(w.MynoteId.genId(), w.MynoteId.genId());
  assert.equal(w.MynoteDom.escapeHTML('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(w.MynoteConstants.isUrl('https://example.com/a?b=1'), true);
  assert.equal(w.MynoteConstants.isUrl('不是链接'), false);
  assert.ok(typeof w.MynoteTime.timeAgo(new Date().toISOString()) === 'string');
});

test('URL 提取：中文路径不再被截断（回归用例，原缺陷已修复）', () => {
  const env = makeEnv();
  load(env, 'src/constants.js');
  const w = env.win;
  assert.equal(w.MynoteConstants.extractUrlFromText('看这个 https://zh.wikipedia.org/wiki/中文条目 很好'), 'https://zh.wikipedia.org/wiki/中文条目');
  // 多个链接只取第一个；纯 ASCII 链接行为不变
  assert.equal(w.MynoteConstants.extractUrlFromText('见 https://example.com/a?b=1 和 https://b.cn/x'), 'https://example.com/a?b=1');
  assert.equal(w.MynoteConstants.extractUrlFromText('没有链接'), null);
  assert.equal(w.MynoteConstants.isUrl('https://zh.wikipedia.org/wiki/中文条目'), true);
});


test('斜体斜杠命令生成的单星号 Markdown 可在重载时识别', () => {
  const env = makeEnv();
  load(env, 'src/editor/editor.md.js');
  assert.equal(env.win.MynoteMd.looksLikeCiaoMarkdown('*斜体文字*'), true);
  assert.equal(env.win.MynoteMd.looksLikeCiaoMarkdown('普通 *带星号但不成对'), false);
  assert.equal(env.win.MynoteMd.looksLikeCiaoMarkdown('**粗体文字**'), true);
});

test('Markdown 渲染在 DOMPurify 缺失时失败关闭', () => {
  const env = makeEnv();
  load(env, 'src/editor/editor.md.js');
  const html = env.win.MynoteMd.renderMarkdownHtml('<img src=x onerror=alert(1)>');
  assert.ok(!/<img\b/i.test(html), '不得返回可执行的原始标签');
  assert.match(html, /&lt;img/);
  assert.match(html, /onerror=alert/);
});

test('文档渲染在 DOMPurify 缺失时转义不可信属性', () => {
  const env = makeEnv();
  load(env, 'src/constants.js');
  load(env, 'src/editor/editor.render.js');
  const html = env.win.MynoteEditor.renderDocToEditorHTML([{ id: 'x" onmouseover="alert(1)', type: 'paragraph', children: [{ text: 'safe' }] }], {});
  assert.ok(!/<p\s+data-blockid="x" onmouseover/i.test(html));
  assert.match(html, /&lt;p/);
});

test('编辑器待办输出可访问语义与稳定状态类', () => {
  const env = makeEnv();
  load(env, 'src/utils/svg.js');
  env.win.DOMPurify = { sanitize: html => html };
  load(env, 'src/editor/editor.render.js');
  const html = env.win.MynoteEditor.renderDocToEditorHTML([
    { id: 'todo-open', type: 'todo', attrs: { checked: false }, children: [{ text: '未完成 <任务>' }] },
    { id: 'todo-done', type: 'todo', attrs: { checked: true }, children: [{ text: '已完成' }] }
  ], {});
  assert.match(html, /<input class=\"todo-checkbox\" type=\"checkbox\" contenteditable=\"false\" aria-checked=\"false\"/);
  assert.match(html, /aria-label=\"未完成 &lt;任务&gt;\"/);
  assert.match(html, /class=\"editor-todo is-checked\"/);
  assert.match(html, /aria-checked=\"true\"[^>]* checked/);
});

test('编辑器解析保留 H1/H2/H3、引用块与分割线类型', () => {
  const env = makeEnv();
  load(env, 'src/editor/editor.render.js');
  const nodes = [
    { tagName: 'H1', dataset: { blockid: 'h1' }, textContent: '一级', contentEditable: 'inherit', querySelector: () => null },
    { tagName: 'H2', dataset: { blockid: 'h2' }, textContent: '二级', contentEditable: 'inherit', querySelector: () => null },
    { tagName: 'H3', dataset: { blockid: 'h3' }, textContent: '三级', contentEditable: 'inherit', querySelector: () => null },
    { tagName: 'BLOCKQUOTE', dataset: { blockid: 'quote' }, textContent: '引用内容', contentEditable: 'inherit', querySelector: () => null },
    { tagName: 'HR', dataset: { blockid: 'divider' }, textContent: '', contentEditable: 'inherit', querySelector: () => null }
  ];
  const parsed = env.win.MynoteEditor.parseEditorDOM({ children: nodes });
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), [
    { id: 'h1', type: 'heading', attrs: { level: 1 }, children: [{ text: '一级' }] },
    { id: 'h2', type: 'heading', attrs: { level: 2 }, children: [{ text: '二级' }] },
    { id: 'h3', type: 'heading', attrs: { level: 3 }, children: [{ text: '三级' }] },
    { id: 'quote', type: 'quote', children: [{ text: '引用内容' }] },
    { id: 'divider', type: 'divider' }
  ]);
});

test('图文卡片与图文横排的说明文字编辑后保存且保留媒体属性', () => {
  const env = makeEnv();
  load(env, 'src/editor/editor.render.js');
  const original = [
    { id: 'card', type: 'imgTextCard', attrs: { imgUrl: 'data:image/png;base64,AA==' }, children: [{ text: '旧说明' }] },
    { id: 'row', type: 'imageTextRow', attrs: { imgUrl: 'data:image/png;base64,BB==' }, children: [{ text: '旧横排说明' }] },
    { id: 'gallery', type: 'gallery', attrs: { items: ['file-a'] } }
  ];
  env.win.MynoteEditor.setEditorDocRef(original);
  const elements = [
    { dataset: { blockid: 'card', type: 'imgTextCard' }, tagName: 'DIV', contentEditable: 'false',
      querySelector: selector => selector === '.itc-text' ? { textContent: '新说明' } : null },
    { dataset: { blockid: 'row', type: 'imageTextRow' }, tagName: 'DIV', contentEditable: 'false',
      querySelector: selector => selector === '.itr-text' ? { textContent: '新横排说明' } : null },
    { dataset: { blockid: 'gallery', type: 'gallery' }, tagName: 'DIV', contentEditable: 'false',
      querySelector: () => null }
  ];
  const parsed = JSON.parse(JSON.stringify(env.win.MynoteEditor.parseEditorDOM({ children: elements })));
  assert.deepEqual(parsed, [
    { id: 'card', type: 'imgTextCard', attrs: { imgUrl: 'data:image/png;base64,AA==' }, children: [{ text: '新说明' }] },
    { id: 'row', type: 'imageTextRow', attrs: { imgUrl: 'data:image/png;base64,BB==' }, children: [{ text: '新横排说明' }] },
    { id: 'gallery', type: 'gallery', attrs: { items: ['file-a'] } }
  ]);
  assert.equal(original[0].children[0].text, '旧说明', '解析不应改写已保存对象');
  assert.equal(original[1].children[0].text, '旧横排说明', '解析不应改写已保存对象');
});

test('ZIP 预检拒绝超大声明与危险路径', () => {
  const env = makeEnv();
  env.win.TextDecoder = TextDecoder;
  load(env, 'src/services/backup-validate.js');
  load(env, 'src/services/storage.idb.js');
  assert.throws(() => env.win.MynoteIdb.validateZipInput(new Uint8Array(10)), /安全限制|目录损坏/);
  const b = new Uint8Array(22);
  // 合法 EOCD 结构，声明一个目录项但没有目录内容，必须拒绝而非解压。
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(10, 1, true);
  assert.throws(() => env.win.MynoteIdb.validateZipInput(b), /目录项损坏|长度/);
});

test('ZIP 预检校验本地文件头与中央目录一致', () => {
  const env = makeEnv();
  env.win.TextDecoder = TextDecoder;
  load(env, 'vendor/fflate.min.js');
  load(env, 'src/services/backup-validate.js');
  load(env, 'src/services/storage.idb.js');
  const bytes = env.win.fflate.zipSync({ 'memos.json': env.win.fflate.strToU8('{"memos":[]}') });
  assert.ok(env.win.MynoteIdb.validateZipInput(bytes).entries === 1);
  const corrupt = bytes.slice();
  // Local file-name byte and central-directory name disagree.
  corrupt[30] ^= 1;
  assert.throws(() => env.win.MynoteIdb.validateZipInput(corrupt), /本地头与目录不一致/);
});


test('导入备份递归校验拒绝注入 ID 与危险协议', () => {
  const env = makeEnv();
  env.win.TextDecoder = TextDecoder;
  load(env, 'src/services/backup-validate.js');
  load(env, 'src/services/storage.idb.js');
  const validate = env.win.MynoteIdb.validateBackupData;
  assert.equal(validate({ memos: [{ id: 'm_1', title: 'ok', doc: [{ id: 'b1', type: 'paragraph', children: [{ text: '安全' }] }] }] }), true);
  assert.throws(() => validate({ memos: [{ id: 'm1', doc: [{ id: 'x" onerror=1', type: 'paragraph' }] }] }), /正文块 ID/);
  assert.throws(() => validate({ memos: [{ id: 'm1', doc: [{ id: 'b1', type: 'link-card', url: 'javascript:alert(1)' }] }] }), /不安全的链接/);
});

test('备份校验兼容旧版并覆盖当前所有 block 类型与恶意字段', () => {
  const env = makeEnv();
  load(env, 'src/services/backup-validate.js');
  load(env, 'src/services/storage.idb.js');
  const validate = env.win.MynoteIdb.validateBackupData;
  const blocks = [
    { id: 'p', type: 'paragraph', children: [{ text: '正文' }] },
    { id: 'h', type: 'heading', attrs: { level: 2 }, children: [{ text: '标题' }] },
    { id: 'q', type: 'quote', children: [{ text: '引用' }] },
    { id: 't', type: 'todo', attrs: { checked: true }, children: [{ text: '待办' }] },
    { id: 'd', type: 'divider' },
    { id: 'i', type: 'image', attrs: { src: 'https://example.test/a.png', alt: '图', fileId: 'att_1' } },
    { id: 'g', type: 'gallery', attrs: { items: [{ fileId: 'att_1', alt: '图' }, 'https://example.test/b.png'] } },
    { id: 'itc', type: 'imgTextCard', attrs: { fileId: 'att_1' }, children: [{ text: '图文卡' }] },
    { id: 'itr', type: 'imageTextRow', attrs: { fileId: 'att_1' }, children: [{ text: '图文行' }] },
    { id: 'm', type: 'musicCard', url: 'https://music.example.test/track', status: 'ready', meta: { title: '歌', cover: 'https://example.test/cover.jpg' } },
    { id: 'e', type: 'embedCard', url: 'https://example.test/embed', status: 'loading', meta: null },
    { id: 'a', type: 'attachment', fileId: 'att_1', image: false, status: 'done' },
    { id: 'l', type: 'link-card', url: 'https://example.test', status: 'error', meta: null }
  ];
  assert.equal(validate({ memos: [{ id: 'm1', doc: blocks }] }), true, '无版本旧备份与全部当前类型应可导入');
  assert.equal(validate({ version: 1, memos: [{ id: 'm1', doc: [{ id: 'legacy', type: 'historic-widget', payload: { text: '保留旧数据' } }] }] }), true);
  assert.equal(validate({ version: 2, memos: [{ id: 'm1', doc: [] }] }), true);
  assert.throws(() => validate({ version: 3, memos: [] }), /备份版本/);
  const bad = doc => validate({ version: 2, memos: [{ id: 'm1', doc }] });
  assert.throws(() => bad([{ id: 'b', type: 'heading', attrs: { level: 9 } }]), /标题级别/);
  assert.throws(() => bad([{ id: 'b', type: 'todo', attrs: { checked: 'yes' } }]), /待办状态/);
  assert.throws(() => bad([{ id: 'b', type: 'gallery', attrs: { items: ['javascript:alert(1)'] } }]), /画廊图片项目/);
  assert.throws(() => bad([{ id: 'b', type: 'paragraph', children: [{ text: { html: '<img>' } }] }]), /正文块文本/);
  assert.throws(() => bad([{ id: 'b', type: 'link-card', url: 'javascript:alert(1)' }]), /不安全的链接/);
  assert.throws(() => bad([{ id: 'b', type: 'musicCard', url: 'https://example.test', status: 'mystery' }]), /卡片状态/);
  assert.throws(() => bad([{ id: 'b', type: 'embedCard', url: 'https://example.test', meta: [] }]), /卡片元数据/);
  assert.throws(() => bad([{ id: 'same', type: 'paragraph' }, { id: 'same', type: 'quote' }]), /重复正文块 ID/);
});

test('Drive 列表错误路径区分授权、HTTP 错误与损坏响应', async () => {
  const env = makeEnv();
  env.win.BACKUP_FILE_NAME = 'memories_backup.zip';
  load(env, 'src/services/zip.js');
  load(env, 'src/services/drive.js');
  load(env, 'src/components/BackupView.js');
  const api = env.win.MynoteBackupUtils;
  for (const status of [401, 403]) {
    env.win.fetch = async () => ({ status, ok: false, json: async () => ({ error: 'denied' }) });
    const result = await api.listMynoteBackups('test-token', r => api.classifyDriveResponse(r.status) !== null);
    assert.equal(result.interrupted, true);
    assert.deepEqual(Array.from(result.files), []);
  }
  env.win.fetch = async () => ({ status: 500, ok: false, json: async () => ({}) });
  await assert.rejects(api.listMynoteBackups('test-token', () => false), /HTTP 500/);
  env.win.fetch = async () => ({ status: 200, ok: true, json: async () => { throw new Error('invalid JSON'); } });
  await assert.rejects(api.listMynoteBackups('test-token', () => false), /invalid JSON/);
});

test('无生产构建脚本，危险 Drive 清理页保持无脚本且应用入口不引用', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.description.includes('无构建步骤'), true);
  assert.equal(Object.hasOwn(pkg.scripts || {}, 'build'), false);
  const entry = ['Moment.html', 'index.html'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.doesNotMatch(entry, /clear_drive|dev\/clear_drive/i);
  for (const f of ['clear_drive.html', 'dev/clear_drive.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(html, /<script\b|googleapis\.com\/drive|drive\.appdata|appDataFolder|oauth2|\.delete\s*\(/i, f + ' 不得包含可执行清理能力');
  }
});

test('搜索递归覆盖嵌套正文且不作不完整拼音误匹配', () => {
  const env = makeEnv();
  load(env, 'src/app/demo-memos.js');
  load(env, 'src/app/memo-list.js');
  const search = env.win.MynoteSearch.matchesMemoSearch;
  const memo = { id: 'm1', title: '随记', doc: [{ type: 'gallery', attrs: { items: [{ alt: '深层关键词' }] }, children: [{ text: '中文内容' }] }] };
  assert.equal(search(memo, '深层关键词'), true);
  assert.equal(search(memo, '中文内容'), true);
  assert.equal(search(memo, 'zhongwen'), false);
});

test('Drive 备份候选优先 ZIP 并选最新版本', () => {
  const env = makeEnv();
  load(env, 'src/services/zip.js');
  load(env, 'src/services/drive.js');
  load(env, 'src/components/BackupView.js');
  const select = env.win.MynoteBackupUtils.selectMynoteBackup;
  assert.equal(select([
    { id: 'old', name: 'memories_backup.zip', modifiedTime: '2026-01-01' },
    { id: 'newjson', name: 'memories_backup.json', modifiedTime: '2026-12-01' },
    { id: 'newzip', name: 'memories_backup.zip', modifiedTime: '2026-10-01' }
  ]).id, 'newzip');
  assert.equal(select([{ id: '', name: 'memories_backup.zip' }]), null);
});


test('Drive 401 与 403 分类分离，权限错误不代表 token 过期', () => {
  const env = makeEnv();
  load(env, 'src/services/zip.js');
  load(env, 'src/services/drive.js');
  load(env, 'src/components/BackupView.js');
  const classify = env.win.MynoteBackupUtils.classifyDriveResponse;
  assert.equal(classify(401), 'expired');
  assert.equal(classify(403), 'forbidden');
  assert.equal(classify(500), null);
});
