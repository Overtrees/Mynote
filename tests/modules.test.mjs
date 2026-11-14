import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv, loadScript } from './helpers/env.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const load = (env, rel) => loadScript(env, path.join(ROOT, rel));

test('构建脚本清单：Moments.html 引用的本地脚本全部存在', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Moments.html'), 'utf8');
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
  for (const key of ['CikeConstants', 'CikeId', 'CikeTime', 'CikeDom', 'CikePreview', 'CikeLocal', 'CikeMd']) {
    assert.ok(w[key], '未注册全局: ' + key);
  }
  assert.equal(typeof w.CikePreview.summarizeMemoDoc, 'function');
  assert.equal(typeof w.CikeMd.stripMarkdownForPreview, 'function');
});

test('id / time / dom / constants 基础行为', () => {
  const env = makeEnv();
  for (const f of ['src/constants.js', 'src/utils/id.js', 'src/utils/time.js', 'src/utils/dom.js']) load(env, f);
  const w = env.win;
  assert.match(w.CikeId.genId(), /^[a-z0-9]+$/i);
  assert.notEqual(w.CikeId.genId(), w.CikeId.genId());
  assert.equal(w.CikeDom.escapeHTML('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(w.CikeConstants.isUrl('https://example.com/a?b=1'), true);
  assert.equal(w.CikeConstants.isUrl('不是链接'), false);
  assert.ok(typeof w.CikeTime.timeAgo(new Date().toISOString()) === 'string');
});

test('URL 提取：中文路径不再被截断（回归用例，原缺陷已修复）', () => {
  const env = makeEnv();
  load(env, 'src/constants.js');
  const w = env.win;
  assert.equal(w.CikeConstants.extractUrlFromText('看这个 https://zh.wikipedia.org/wiki/中文条目 很好'), 'https://zh.wikipedia.org/wiki/中文条目');
  // 多个链接只取第一个；纯 ASCII 链接行为不变
  assert.equal(w.CikeConstants.extractUrlFromText('见 https://example.com/a?b=1 和 https://b.cn/x'), 'https://example.com/a?b=1');
  assert.equal(w.CikeConstants.extractUrlFromText('没有链接'), null);
  assert.equal(w.CikeConstants.isUrl('https://zh.wikipedia.org/wiki/中文条目'), true);
});

