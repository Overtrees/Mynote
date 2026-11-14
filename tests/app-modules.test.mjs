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

test('列表搜索与城市转换辅助函数保持可用', () => {
  const { win } = makeAppEnv();
  assert.equal(win.MynoteSearch.toPy('标题'), 'bt');
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