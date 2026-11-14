import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAppEnv, runInApp } from './helpers/app-env.mjs';

test('全部非 vendor 脚本可按页面顺序加载并注册核心模块', () => {
  const { win, loaded } = makeAppEnv();
  assert.ok(loaded.length >= 30, '加载模块数量异常: ' + loaded.length);
  assert.ok(win.MynoteRuntime, '缺少 MynoteRuntime');
  assert.equal(typeof win.MynoteEditorPage, 'function');
  assert.equal(typeof win.MynoteMemoList, 'function');
  assert.ok(win.MynoteWeather && typeof win.MynoteWeather.fetchWeather === 'function');
  assert.ok(win.MynoteErrors && typeof win.MynoteErrors.addWarn === 'function');
});

test('跨脚本全局词法环境仍可共享 Hook 与组件', () => {
  const { env } = makeAppEnv();
  assert.equal(runInApp(env, 'typeof useState'), 'function');
  assert.equal(runInApp(env, 'typeof Editor'), 'function');
  assert.equal(runInApp(env, 'typeof fetchWeather'), 'function');
  assert.equal(runInApp(env, 'typeof refreshGoogleAvatar'), 'function');
});

test('斜杠命令目录保持 29 条且 id 唯一', () => {
  const { win } = makeAppEnv();
  const commands = win.MynoteSlashCommands;
  assert.equal(commands.length, 29);
  assert.equal(new Set(commands.map(c => c.id)).size, 29);
  assert.ok(commands.every(c => c.id && c.title && c.type && c.group));
  assert.ok(win.MynoteSlashIcons && typeof win.MynoteSlashIcons.heading === 'string');
});

test('列表搜索不暴露不完整拼音映射，城市转换辅助函数可用', () => {
  const { win } = makeAppEnv();
  assert.equal('toPy' in win.MynoteSearch, false);
  assert.equal(win.MynoteSearch.toCn('Beijing'), '北京');
  assert.equal(win.MynoteSearch.toCn('Unknown'), 'Unknown');
});

test('运行时桥接导出关键工具函数', () => {
  const { win } = makeAppEnv();
  for (const name of ['genId', 'escapeHTML', 'timeAgo', 'getSectionLabel', 'parseEditorDOM', 'renderDocToEditorHTML', 'getDB']) {
    assert.equal(typeof win.MynoteRuntime[name], 'function', '缺少运行时方法: ' + name);
  }
  assert.equal(win.MynoteRuntime.getSectionLabel(new Date().toISOString()), '今天');
});
test('搜索覆盖嵌套块与附件可读名称，但不索引附件数据', () => {
  const { win } = makeAppEnv();
  const memo = { title: '标题', doc: [{ type: 'paragraph', children: [{ text: '父级' }, { children: [{ text: '深层关键词' }] }] }, { type: 'attachment', name: '旅行照片.jpg', url: 'https://example.test/cover.jpg', fileId: 'opaque-id', dataUrl: 'data:image/png;base64,SECRET' }] };
  assert.equal(win.MynoteSearch.matchesMemoSearch(memo, '深层关键词'), true);
  assert.equal(win.MynoteSearch.matchesMemoSearch(memo, '旅行照片'), true);
  assert.equal(win.MynoteSearch.matchesMemoSearch(memo, 'opaque-id'), false);
  assert.equal(win.MynoteSearch.matchesMemoSearch(memo, 'SECRET'), false);
});

test('ErrorBoundary 在错误态显示独立兜底 UI', async () => {
  const { makeEnv, loadScript } = await import('./helpers/env.mjs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const env = makeEnv();
  env.doc.readyState = 'loading';
  env.win.addEventListener = function () {};
  env.win.removeEventListener = function () {};
  env.win.React.Component = function (props) { this.props = props || {}; this.state = {}; };
  env.win.React.Component.prototype.setState = function (s) { this.state = { ...this.state, ...s }; };
  env.win.React.createElement = (type, props, ...children) => ({ type, props: props || {}, children });
  loadScript(env, path.join(ROOT, 'src/error-boundary.js'));
  const Boundary = env.win.MynoteErrors.Badge;
  const derived = Boundary.getDerivedStateFromError(new Error('boom'));
  const instance = new Boundary({ children: 'broken subtree' });
  instance.state = { ...instance.state, ...derived };
  const fallback = instance.render();
  assert.equal(fallback.props.role, 'alert');
  assert.equal(fallback.children[0].type, 'h2');
  assert.match(fallback.children[0].children[0], /页面遇到问题/);
  assert.equal(fallback.children[2].type, 'button');
  assert.equal(instance.props.children, 'broken subtree');
});

test('Drive 备份选择优先使用最新 ZIP，且不会丢失完整附件 ID', () => {
  const { win } = makeAppEnv();
  const choose = win.MynoteBackupUtils.selectMynoteBackup;
  const result = choose([
    { id: 'oldzip', name: 'memories_backup.zip', modifiedTime: '2025-01-01T00:00:00Z' },
    { id: 'newjson', name: 'memories_backup.json', modifiedTime: '2026-01-01T00:00:00Z' },
    { id: 'newzip', name: 'memories_backup.zip', modifiedTime: '2025-05-01T00:00:00Z' },
    { name: 'memories_backup.zip', modifiedTime: '2027-01-01T00:00:00Z' }
  ]);
  assert.equal(result.id, 'newzip');
  assert.equal(win.MynoteIdb.resolveAttachmentId('att_cn_1', { att_cn_1: { name: '照片.png' } }), 'att_cn_1');
  assert.equal(win.MynoteIdb.resolveAttachmentId('att_cn_1', {}, ['att_cn_1']), 'att_cn_1');
  assert.deepEqual(Array.from(win.MynoteIdb.collectAttachmentIds([{ fileId: 'att_cn_1' }, { attrs: { fileId: 'att_other' } }])).sort(), ['att_cn_1', 'att_other']);
});
