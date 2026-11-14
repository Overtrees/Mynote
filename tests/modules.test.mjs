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

test('已知缺陷快照：URL_INLINE_REGEX 中文区间写错，含中文链接被截断', () => {
  const env = makeEnv();
  load(env, 'src/constants.js');
  const w = env.win;
  // 现状：字符类里 \u9fa5 少了区间起点，导致第一个汉字处截断。
  // 修复该正则属于可见行为变更，本次重构不动它，只把现状固定为快照。
  assert.equal(w.CikeConstants.extractUrlFromText('看这个 https://zh.wikipedia.org/wiki/中文条目 很好'), 'https://zh.wikipedia.org/wiki/');
});
